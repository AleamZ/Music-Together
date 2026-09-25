-- =========================================================
-- 0014_lyrics_lockdown.sql — hotfix H1: only a room's DJ may write the shared video-lyrics cache.
-- ADDITIVE and re-runnable (no data drop). Needs 0011_v13_video_lyrics.sql (the video_lyrics table and the two RPCs
-- replaced here): run it by hand in the Supabase SQL editor after 0011_v13_video_lyrics. It does not depend on 0012+.
--
-- Closes:
--   * direct INSERT / UPDATE / DELETE on video_lyrics by anon and authenticated (open RLS policies + table grants);
--   * the session-less RPCs upsert_video_lyrics(text,…) and update_video_lyric_offset(text,integer,text).
-- The new RPCs take (p_room_id, p_session_token, …) and only let the room's DJ write — the same _auth(…, 'dj') check as
-- set_playback / seek_playback / advance_queue, i.e. the UI's canControl (role.canControlPlayback = isDj) — for a
-- well-formed YouTube id that is the room's current or queued song, within size caps (offset within ±10 minutes).
-- updated_by_name comes from the account. Reading stays public: the video_lyrics_select policy and the select grant
-- are untouched.
-- Old clients call the old signatures, get PGRST202, and their cache writes stop until they reload.
-- =========================================================

-- ---------- A. Close direct writes ----------
drop policy if exists video_lyrics_insert on public.video_lyrics;
drop policy if exists video_lyrics_update on public.video_lyrics;
revoke insert, update, delete on public.video_lyrics from anon, authenticated;

-- ---------- B. Remove the session-less RPCs ----------
drop function if exists public.upsert_video_lyrics(text,text,text,text,text,integer,text,text);
drop function if exists public.update_video_lyric_offset(text,integer,text);

-- ---------- C. Internal: who may write, and for which video ----------
-- The room's DJ (errors from _auth: 'invalid session', 'account banned', 'account is not a member of this room',
-- 'dj role required'); an 11-character YouTube id ('invalid video') that is the room's current or queued song
-- ('video not in room'). Returns the writer's username, for updated_by_name.
create or replace function public._lyrics_writer(p_room_id uuid, p_session_token text, p_video_id text)
returns text language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_name text;
begin
  v_member := public._auth(p_room_id, p_session_token, 'dj');
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid video' using errcode = '22023';
  end if;
  -- the playing row stays in queue_items until advance_queue, so this covers the current song and the queued ones
  if not exists (select 1 from public.queue_items q where q.room_id = p_room_id and q.youtube_video_id = p_video_id) then
    raise exception 'video not in room' using errcode = '42501';
  end if;
  select a.username into v_name from public.members m join public.accounts a on a.id = m.account_id where m.id = v_member;
  return v_name;
end; $$;
revoke all on function public._lyrics_writer(uuid,text,text) from public, anon, authenticated;

-- ---------- D. upsert_video_lyrics (DJ only) ----------
-- Old semantics kept: null fields keep the stored value, an offset of 0 or null keeps the stored offset, updated_at = now().
create or replace function public.upsert_video_lyrics(
  p_room_id uuid, p_session_token text, p_video_id text,
  p_track_name text, p_artist_name text, p_synced_lyrics text, p_plain_lyrics text,
  p_offset_ms integer, p_timing_source text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_name text;
begin
  v_name := public._lyrics_writer(p_room_id, p_session_token, p_video_id);
  -- timing sources the client sends: 'auto' (search result cached by the DJ) and 'custom' (DJ's own choice)
  if char_length(p_synced_lyrics) > 20000 or char_length(p_plain_lyrics) > 20000
     or char_length(p_track_name) > 200 or char_length(p_artist_name) > 200
     or (p_timing_source is not null and p_timing_source not in ('auto', 'custom')) then
    raise exception 'lyrics too long' using errcode = '22023';
  end if;
  if p_offset_ms is not null and p_offset_ms not between -600000 and 600000 then
    raise exception 'invalid offset' using errcode = '22023';
  end if;

  insert into public.video_lyrics (
    youtube_video_id, track_name, artist_name, synced_lyrics, plain_lyrics,
    offset_ms, timing_source, updated_by_name, updated_at
  )
  values (
    p_video_id, p_track_name, p_artist_name, p_synced_lyrics, p_plain_lyrics,
    coalesce(p_offset_ms, 0), p_timing_source, v_name, now()
  )
  on conflict (youtube_video_id) do update set
    track_name = coalesce(excluded.track_name, video_lyrics.track_name),
    artist_name = coalesce(excluded.artist_name, video_lyrics.artist_name),
    synced_lyrics = coalesce(excluded.synced_lyrics, video_lyrics.synced_lyrics),
    plain_lyrics = coalesce(excluded.plain_lyrics, video_lyrics.plain_lyrics),
    offset_ms = case
      when excluded.offset_ms is not null and excluded.offset_ms <> 0 then excluded.offset_ms
      else video_lyrics.offset_ms
    end,
    timing_source = coalesce(excluded.timing_source, video_lyrics.timing_source),
    updated_by_name = excluded.updated_by_name,
    updated_at = now();
end;
$$;

-- ---------- E. update_video_lyric_offset (DJ only): only the offset, the name and the time change ----------
create or replace function public.update_video_lyric_offset(
  p_room_id uuid, p_session_token text, p_video_id text, p_offset_ms integer
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_name text;
begin
  v_name := public._lyrics_writer(p_room_id, p_session_token, p_video_id);
  if p_offset_ms is not null and p_offset_ms not between -600000 and 600000 then
    raise exception 'invalid offset' using errcode = '22023';
  end if;
  update public.video_lyrics set
    offset_ms = coalesce(p_offset_ms, offset_ms),
    updated_by_name = v_name,
    updated_at = now()
  where youtube_video_id = p_video_id;
end;
$$;

-- ---------- F. Grants (the helper above stays private) ----------
grant execute on function public.upsert_video_lyrics(uuid,text,text,text,text,text,text,integer,text) to anon, authenticated;
grant execute on function public.update_video_lyric_offset(uuid,text,text,integer)                  to anon, authenticated;
