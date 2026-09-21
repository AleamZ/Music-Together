-- =========================================================
-- 0008_v9_room_rules.sql — v9: room rules (max duration, approval queue, banned keywords). ADDITIVE (no data drop).
-- Existing queue rows become status = 'approved'.
-- =========================================================
create extension if not exists unaccent with schema extensions;

-- ---------- A. Schema ----------
alter table public.rooms
  add column if not exists max_duration_seconds integer not null default 600,   -- 0 = unlimited
  add column if not exists require_approval     boolean not null default false,
  add column if not exists banned_keywords      text[]  not null default '{}';

alter table public.queue_items add column if not exists status text not null default 'approved';
alter table public.queue_items drop constraint if exists queue_items_status_check;
alter table public.queue_items add constraint queue_items_status_check check (status in ('pending','approved'));
create index if not exists queue_items_room_status_idx on public.queue_items (room_id, status);

-- ---------- B. Internal helpers (not callable by clients) ----------
-- Raises errcode 23514 with one of: 'duration unknown' | 'video too long' | 'banned keyword: <kw>'.
create or replace function public._check_queue_rules(p_room_id uuid, p_title text, p_duration integer)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_max integer; v_kw text; v_title text;
begin
  select max_duration_seconds into v_max from public.rooms where id = p_room_id;
  if coalesce(v_max, 0) > 0 then
    if p_duration is null then
      raise exception 'duration unknown' using errcode = '23514';
    elsif p_duration > v_max then
      raise exception 'video too long' using errcode = '23514';
    end if;
  end if;
  v_title := lower(extensions.unaccent(coalesce(p_title, '')));
  for v_kw in select unnest(banned_keywords) from public.rooms where id = p_room_id loop
    if v_kw <> '' and position(lower(extensions.unaccent(v_kw)) in v_title) > 0 then
      raise exception 'banned keyword: %', v_kw using errcode = '23514';
    end if;
  end loop;
end; $$;
revoke all on function public._check_queue_rules(uuid,text,integer) from public, anon, authenticated;

-- 'pending' when the room requires approval and the member is neither admin nor dj; else 'approved'.
create or replace function public._queue_status_for(p_room_id uuid, p_member_id uuid) returns text
language sql security definer set search_path = public, extensions
as $$
  select case when r.require_approval
               and p_member_id is distinct from r.admin_member_id
               and p_member_id is distinct from r.dj_member_id
              then 'pending' else 'approved' end
  from public.rooms r where r.id = p_room_id;
$$;
revoke all on function public._queue_status_for(uuid,uuid) from public, anon, authenticated;

-- Approve every pending row of a room in request order; returns the count.
create or replace function public._approve_all(p_room_id uuid) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pos double precision; v_row record; v_count int := 0;
begin
  select coalesce(max(position), 0) into v_pos from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_row in select id from public.queue_items where room_id = p_room_id and status = 'pending' order by created_at, id loop
    v_pos := v_pos + 1;
    update public.queue_items set status = 'approved', position = v_pos where id = v_row.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end; $$;
revoke all on function public._approve_all(uuid) from public, anon, authenticated;

-- ---------- C. add_queue_item: rules + pending ----------
create or replace function public.add_queue_item(
  p_room_id uuid, p_session_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_name text; v_status text; v_pos double precision; v_id uuid;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  perform public._check_queue_rules(p_room_id, p_title, p_duration);
  v_status := public._queue_status_for(p_room_id, v_member);
  if v_status = 'pending' then
    v_pos := 0;
  else
    select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id and status = 'approved';
  end if;
  insert into public.queue_items
    (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position, status)
  values (p_room_id, p_video_id, p_title, p_thumb, p_duration, v_account, v_name, v_pos, v_status)
  returning id into v_id;
  return v_id;
end; $$;

-- ---------- D. add_queue_items (playlist): elements { video_id, title, thumb, duration }; violators are skipped ----------
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_member uuid; v_account uuid; v_name text; v_status text; v_base double precision;
  v_idx int := 0; v_count int := 0; v_item jsonb; v_title text; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  v_status := public._queue_status_for(p_room_id, v_member);
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    if coalesce(v_item->>'video_id', '') = '' then continue; end if;
    v_title := coalesce(nullif(v_item->>'title', ''), v_item->>'video_id');
    v_duration := case when jsonb_typeof(v_item->'duration') = 'number' then floor((v_item->>'duration')::numeric)::int else null end;
    begin
      perform public._check_queue_rules(p_room_id, v_title, v_duration);
    exception when check_violation then
      continue;   -- skip this element, keep going
    end;
    v_idx := v_idx + 1;
    insert into public.queue_items
      (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position, status)
    values (
      p_room_id, v_item->>'video_id', v_title, nullif(v_item->>'thumb', ''), v_duration,
      v_account, v_name,
      case when v_status = 'pending' then 0 else v_base + v_idx end,
      v_status
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------- E. advance_queue: approved rows only ----------
create or replace function public.advance_queue(p_room_id uuid, p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_cur public.queue_items%rowtype; v_mode text; v_next uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'dj');
  select play_mode into v_mode from public.rooms where id = p_room_id;
  select qi.* into v_cur from public.queue_items qi
  join public.rooms r on r.current_item_id = qi.id where r.id = p_room_id;
  if found then
    insert into public.play_history (room_id, youtube_video_id, title, added_by_name)
    values (p_room_id, v_cur.youtube_video_id, v_cur.title, v_cur.added_by_name);
    update public.rooms set current_item_id = null where id = p_room_id;
    delete from public.queue_items where id = v_cur.id;
  end if;
  if v_mode = 'shuffle' then
    select id into v_next from public.queue_items where room_id = p_room_id and status = 'approved' order by random() limit 1;
  else
    select id into v_next from public.queue_items where room_id = p_room_id and status = 'approved' order by position asc limit 1;
  end if;
  update public.rooms set
    current_item_id = v_next,
    started_at = case when v_next is not null then now() else null end,
    is_playing = v_next is not null, paused_elapsed_ms = 0
  where id = p_room_id;
  return v_next;
end; $$;

-- ---------- F. delete_item: admin/dj, or the owner of a pending row (withdraw) ----------
create or replace function public.delete_item(
  p_room_id uuid, p_session_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_admin uuid; v_dj uuid; v_status text; v_owner uuid;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  select admin_member_id, dj_member_id into v_admin, v_dj from public.rooms where id = p_room_id;
  select status, added_by_account_id into v_status, v_owner
    from public.queue_items where id = p_item_id and room_id = p_room_id;
  if not found then return; end if;
  if v_member is distinct from v_admin and v_member is distinct from v_dj
     and not (v_status = 'pending' and coalesce(v_owner = v_account, false)) then
    raise exception 'admin or dj role required' using errcode = '42501';
  end if;
  if exists (select 1 from public.rooms where id = p_room_id and current_item_id = p_item_id) then
    raise exception 'cannot delete the currently playing item' using errcode = '42501';
  end if;
  delete from public.queue_items where id = p_item_id and room_id = p_room_id;
end;
$$;

-- ---------- G. Approval + settings RPCs (admin_or_dj) ----------
create or replace function public.approve_queue_item(p_room_id uuid, p_session_token text, p_item_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_pos double precision;
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id and status = 'approved';
  update public.queue_items set status = 'approved', position = v_pos
  where id = p_item_id and room_id = p_room_id and status = 'pending';
end; $$;

create or replace function public.approve_all_pending(p_room_id uuid, p_session_token text)
returns int language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  return public._approve_all(p_room_id);
end; $$;

create or replace function public.reject_queue_item(p_room_id uuid, p_session_token text, p_item_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  delete from public.queue_items where id = p_item_id and room_id = p_room_id and status = 'pending';
end; $$;

-- Validates and stores the three rules. Turning approval OFF approves everything still pending.
create or replace function public.update_room_settings(
  p_room_id uuid, p_session_token text,
  p_max_duration_seconds integer, p_require_approval boolean, p_banned_keywords text[]
) returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_kws text[] := '{}'; v_kw text; v_clean text;
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  if p_max_duration_seconds is null or p_max_duration_seconds < 0 or p_max_duration_seconds > 86400 then
    raise exception 'invalid max duration' using errcode = '22023';
  end if;
  foreach v_kw in array coalesce(p_banned_keywords, '{}'::text[]) loop
    v_clean := btrim(v_kw);
    if v_clean = '' then continue; end if;
    if length(v_clean) > 30 then raise exception 'keyword too long' using errcode = '22023'; end if;
    if exists (select 1 from unnest(v_kws) k where lower(extensions.unaccent(k)) = lower(extensions.unaccent(v_clean))) then continue; end if;
    v_kws := array_append(v_kws, v_clean);
  end loop;
  if coalesce(array_length(v_kws, 1), 0) > 50 then raise exception 'too many keywords' using errcode = '22023'; end if;
  update public.rooms set
    max_duration_seconds = p_max_duration_seconds,
    require_approval = coalesce(p_require_approval, false),
    banned_keywords = v_kws
  where id = p_room_id;
  if not coalesce(p_require_approval, false) then
    perform public._approve_all(p_room_id);
  end if;
end; $$;

grant execute on function public.approve_queue_item(uuid,text,uuid)                       to anon, authenticated;
grant execute on function public.approve_all_pending(uuid,text)                            to anon, authenticated;
grant execute on function public.reject_queue_item(uuid,text,uuid)                        to anon, authenticated;
grant execute on function public.update_room_settings(uuid,text,integer,boolean,text[])   to anon, authenticated;
