-- =========================================================
-- 0009_v11_order_limit.sql — v11: per-member order limit (default 5; 0 = unlimited). ADDITIVE (no data drop).
-- Admin and DJ are exempt. The playing row (rooms.current_item_id) does not count.
-- =========================================================

-- ---------- A. Schema ----------
alter table public.rooms
  add column if not exists max_orders_per_member integer not null default 5;   -- 0 = unlimited

-- ---------- B. Helpers ----------
-- Rows this account has waiting in the room (pending + approved), excluding the row that is playing.
create or replace function public._order_count(p_room_id uuid, p_account_id uuid) returns int
language sql security definer set search_path = public, extensions
as $$
  select count(*)::int from public.queue_items qi
  join public.rooms r on r.id = qi.room_id
  where qi.room_id = p_room_id
    and qi.added_by_account_id = p_account_id
    and qi.id is distinct from r.current_item_id;
$$;
revoke all on function public._order_count(uuid,uuid) from public, anon, authenticated;

-- How many more rows this member may add: null = unlimited (limit 0, or admin/dj), else max(0, limit - count).
create or replace function public._orders_remaining(p_room_id uuid, p_member_id uuid, p_account_id uuid) returns int
language sql security definer set search_path = public, extensions
as $$
  select case
    when r.max_orders_per_member <= 0 then null
    when p_member_id = r.admin_member_id or p_member_id = r.dj_member_id then null
    else greatest(0, r.max_orders_per_member - public._order_count(p_room_id, p_account_id))
  end
  from public.rooms r where r.id = p_room_id;
$$;
revoke all on function public._orders_remaining(uuid,uuid,uuid) from public, anon, authenticated;

-- ---------- C. add_queue_item: rules + order limit + pending ----------
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
  if coalesce(public._orders_remaining(p_room_id, v_member, v_account), 1) <= 0 then
    raise exception 'order limit reached' using errcode = '23514';
  end if;
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

-- ---------- D. add_queue_items (playlist): rule violators skipped; stops when the member's slots are used ----------
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_member uuid; v_account uuid; v_name text; v_status text; v_base double precision; v_remaining int;
  v_idx int := 0; v_count int := 0; v_item jsonb; v_title text; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  v_status := public._queue_status_for(p_room_id, v_member);
  v_remaining := public._orders_remaining(p_room_id, v_member, v_account);   -- null = unlimited
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    if coalesce(v_item->>'video_id', '') = '' then continue; end if;
    v_title := coalesce(nullif(v_item->>'title', ''), v_item->>'video_id');
    v_duration := case when jsonb_typeof(v_item->'duration') = 'number' then floor((v_item->>'duration')::numeric)::int else null end;
    begin
      perform public._check_queue_rules(p_room_id, v_title, v_duration);
    exception when check_violation then
      continue;   -- skip this element, keep going (does not use a slot)
    end;
    if v_remaining is not null and v_count >= v_remaining then exit; end if;   -- slots used up
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

-- ---------- E. update_room_settings: + max_orders_per_member (null = keep). Old 5-arg signature dropped: two
-- overloads would make a 5-argument PostgREST call ambiguous. ----------
drop function if exists public.update_room_settings(uuid,text,integer,boolean,text[]);
create or replace function public.update_room_settings(
  p_room_id uuid, p_session_token text,
  p_max_duration_seconds integer, p_require_approval boolean, p_banned_keywords text[],
  p_max_orders_per_member integer default null
) returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_kws text[] := '{}'; v_kw text; v_clean text;
begin
  perform public._auth(p_room_id, p_session_token, 'admin_or_dj');
  if p_max_duration_seconds is null or p_max_duration_seconds < 0 or p_max_duration_seconds > 86400 then
    raise exception 'invalid max duration' using errcode = '22023';
  end if;
  if p_max_orders_per_member is not null and (p_max_orders_per_member < 0 or p_max_orders_per_member > 100) then
    raise exception 'invalid order limit' using errcode = '22023';
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
    banned_keywords = v_kws,
    max_orders_per_member = coalesce(p_max_orders_per_member, max_orders_per_member)
  where id = p_room_id;
  if not coalesce(p_require_approval, false) then
    perform public._approve_all(p_room_id);
  end if;
end; $$;
grant execute on function public.update_room_settings(uuid,text,integer,boolean,text[],integer) to anon, authenticated;
