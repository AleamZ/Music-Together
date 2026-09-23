-- =========================================================
-- 0010_v12_replay_history.sql — v12: Auto-replay from play_history when queue is empty. ADDITIVE (no data drop).
-- =========================================================

-- ---------- A. Schema ----------
alter table public.rooms
  add column if not exists auto_replay_history boolean not null default false;

alter table public.play_history
  add column if not exists thumbnail_url text,
  add column if not exists duration_seconds integer;

alter table public.queue_items
  add column if not exists is_replay boolean not null default false;

-- ---------- B. advance_queue: auto-replay from play_history if approved queue is empty ----------
create or replace function public.advance_queue(p_room_id uuid, p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_cur public.queue_items%rowtype;
  v_mode text;
  v_auto_replay boolean;
  v_next uuid;
  v_hist public.play_history%rowtype;
begin
  perform public._auth(p_room_id, p_session_token, 'dj');

  select play_mode, auto_replay_history
    into v_mode, v_auto_replay
    from public.rooms where id = p_room_id;

  -- 1. Archive currently playing item into play_history and remove it from queue
  select qi.* into v_cur from public.queue_items qi
  join public.rooms r on r.current_item_id = qi.id where r.id = p_room_id;
  if found then
    insert into public.play_history (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_name)
    values (p_room_id, v_cur.youtube_video_id, v_cur.title, v_cur.thumbnail_url, v_cur.duration_seconds, v_cur.added_by_name);
    update public.rooms set current_item_id = null where id = p_room_id;
    delete from public.queue_items where id = v_cur.id;
  end if;

  -- 2. Pick next track from queue_items (approved only)
  if v_mode = 'shuffle' then
    select id into v_next from public.queue_items where room_id = p_room_id and status = 'approved' order by random() limit 1;
  else
    select id into v_next from public.queue_items where room_id = p_room_id and status = 'approved' order by position asc limit 1;
  end if;

  -- 3. If queue is empty and auto_replay_history is enabled, pick a candidate from play_history
  if v_next is null and coalesce(v_auto_replay, false) then
    -- Try to pick a track from play_history distinct from the one that just finished
    if v_mode = 'shuffle' then
      select * into v_hist from public.play_history
      where room_id = p_room_id
        and (v_cur.youtube_video_id is null or youtube_video_id <> v_cur.youtube_video_id)
      order by random()
      limit 1;
    else
      select * into v_hist from public.play_history
      where room_id = p_room_id
        and (v_cur.youtube_video_id is null or youtube_video_id <> v_cur.youtube_video_id)
      order by played_at asc
      limit 1;
    end if;

    -- If no other distinct track exists, fallback to picking any track from play_history
    if not found then
      if v_mode = 'shuffle' then
        select * into v_hist from public.play_history
        where room_id = p_room_id
        order by random()
        limit 1;
      else
        select * into v_hist from public.play_history
        where room_id = p_room_id
        order by played_at asc
        limit 1;
      end if;
    end if;

    -- If candidate found, insert into queue_items and mark as is_replay
    if found then
      insert into public.queue_items
        (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position, status, is_replay)
      values
        (p_room_id, v_hist.youtube_video_id, v_hist.title,
         coalesce(v_hist.thumbnail_url, 'https://i.ytimg.com/vi/' || v_hist.youtube_video_id || '/hqdefault.jpg'),
         v_hist.duration_seconds,
         null,
         v_hist.added_by_name,
         1,
         'approved',
         true)
      returning id into v_next;
    end if;
  end if;

  -- 4. Update room playback state
  update public.rooms set
    current_item_id = v_next,
    started_at = case when v_next is not null then now() else null end,
    is_playing = v_next is not null,
    paused_elapsed_ms = 0
  where id = p_room_id;

  return v_next;
end;
$$;
grant execute on function public.advance_queue(uuid,text) to anon, authenticated;

-- ---------- C. update_room_settings (+ auto_replay_history) ----------
drop function if exists public.update_room_settings(uuid,text,integer,boolean,text[],integer);
create or replace function public.update_room_settings(
  p_room_id uuid, p_session_token text,
  p_max_duration_seconds integer, p_require_approval boolean, p_banned_keywords text[],
  p_max_orders_per_member integer default null,
  p_auto_replay_history boolean default null
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
    max_orders_per_member = coalesce(p_max_orders_per_member, max_orders_per_member),
    auto_replay_history = coalesce(p_auto_replay_history, auto_replay_history)
  where id = p_room_id;
  if not coalesce(p_require_approval, false) then
    perform public._approve_all(p_room_id);
  end if;
end; $$;
grant execute on function public.update_room_settings(uuid,text,integer,boolean,text[],integer,boolean) to anon, authenticated;
