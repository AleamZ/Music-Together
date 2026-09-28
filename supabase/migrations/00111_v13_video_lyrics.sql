-- =========================================================
-- 0011_v13_video_lyrics.sql — v13: Cache song lyrics and offset config by youtube_video_id. ADDITIVE (no data drop).
-- =========================================================

-- ---------- A. Table ----------
create table if not exists public.video_lyrics (
  youtube_video_id text primary key,
  track_name text,
  artist_name text,
  synced_lyrics text,
  plain_lyrics text,
  offset_ms integer not null default 0,
  timing_source text,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_video_lyrics_updated
  on public.video_lyrics (updated_at desc);

-- ---------- B. RLS ----------
alter table public.video_lyrics enable row level security;

drop policy if exists video_lyrics_select on public.video_lyrics;
create policy video_lyrics_select on public.video_lyrics
  for select to anon, authenticated using (true);

drop policy if exists video_lyrics_insert on public.video_lyrics;
create policy video_lyrics_insert on public.video_lyrics
  for insert to anon, authenticated with check (true);

drop policy if exists video_lyrics_update on public.video_lyrics;
create policy video_lyrics_update on public.video_lyrics
  for update to anon, authenticated using (true) with check (true);

-- ---------- C. RPC Helpers ----------
create or replace function public.upsert_video_lyrics(
  p_video_id text,
  p_track_name text default null,
  p_artist_name text default null,
  p_synced_lyrics text default null,
  p_plain_lyrics text default null,
  p_offset_ms integer default 0,
  p_timing_source text default null,
  p_updated_by text default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  insert into public.video_lyrics (
    youtube_video_id, track_name, artist_name, synced_lyrics, plain_lyrics,
    offset_ms, timing_source, updated_by_name, updated_at
  )
  values (
    p_video_id, p_track_name, p_artist_name, p_synced_lyrics, p_plain_lyrics,
    coalesce(p_offset_ms, 0), p_timing_source, p_updated_by, now()
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
    updated_by_name = coalesce(excluded.updated_by_name, video_lyrics.updated_by_name),
    updated_at = now();
end;
$$;
grant execute on function public.upsert_video_lyrics(text,text,text,text,text,integer,text,text) to anon, authenticated;

create or replace function public.update_video_lyric_offset(
  p_video_id text,
  p_offset_ms integer,
  p_updated_by text default null
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.video_lyrics set
    offset_ms = p_offset_ms,
    updated_by_name = coalesce(p_updated_by, updated_by_name),
    updated_at = now()
  where youtube_video_id = p_video_id;
end;
$$;
grant execute on function public.update_video_lyric_offset(text,integer,text) to anon, authenticated;
