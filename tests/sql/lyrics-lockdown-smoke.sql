-- tests/sql/lyrics-lockdown-smoke.sql — hotfix H1 (supabase/migrations/0014_lyrics_lockdown.sql).
-- Run as the superuser on a throwaway PostgreSQL cluster after replaying 0004…0011_v13_video_lyrics, then 0014 twice.
-- The cluster must mirror Supabase's grants, or the anon checks prove nothing. Before the migrations run:
--   create schema extensions; create role anon nologin; create role authenticated nologin;
--   create publication supabase_realtime;
--   grant usage on schema public to anon, authenticated;
--   alter default privileges in schema public grant all on tables    to anon, authenticated;
--   alter default privileges in schema public grant all on functions to anon, authenticated;
-- Every check is an ASSERT inside a DO block; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on

-- ---------- setup: a room whose creator is admin + DJ, a member, an outsider with a room of their own ----------
create temp table smoke (k text primary key, v text);
do $$
declare v_dj text; v_member text; v_outsider text; v_room uuid; v_room2 uuid;
begin
  select token into v_dj from public.register('smoke_ly_dj_' || floor(random() * 1e9)::text, 'pw123456');
  select token into v_member from public.register('smoke_ly_mb_' || floor(random() * 1e9)::text, 'pw123456');
  select token into v_outsider from public.register('smoke_ly_ot_' || floor(random() * 1e9)::text, 'pw123456');
  select room_id into v_room from public.create_room('Lyrics lockdown', 'pw', v_dj);
  perform public.join_room((select code from public.rooms where id = v_room), 'pw', v_member);
  perform public.add_queue_item(v_room, v_dj, 'dQw4w9WgXcQ', 'Now playing', null, 213);
  perform public.add_queue_item(v_room, v_member, 'kJQP7kiw5Fk', 'Up next', null, 282);
  perform public.advance_queue(v_room, v_dj);                          -- dQw4w9WgXcQ plays, kJQP7kiw5Fk waits
  select room_id into v_room2 from public.create_room('Other room', 'pw', v_outsider);
  perform public.add_queue_item(v_room2, v_outsider, '9bZkp7q19f0', 'Elsewhere', null, 253);
  insert into smoke values ('dj', v_dj), ('member', v_member), ('outsider', v_outsider),
                           ('room', v_room::text), ('room2', v_room2::text);
  -- the anon blocks cannot read this temp table: hand them the DJ's token and the room through settings
  perform set_config('smoke.dj', v_dj, false);
  perform set_config('smoke.room', v_room::text, false);
end $$;

-- Error text of one call ('ok' when it succeeds). Defaults: a small, valid write.
create function pg_temp.upsert_err(
  p_room uuid, p_token text, p_video text,
  p_track text default 'Track', p_artist text default 'Artist', p_synced text default '[00:01.00]line', p_plain text default null,
  p_offset integer default 0, p_source text default 'auto'
) returns text language plpgsql as $$
begin
  perform public.upsert_video_lyrics(p_room, p_token, p_video, p_track, p_artist, p_synced, p_plain, p_offset, p_source);
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.offset_err(p_room uuid, p_token text, p_video text, p_offset integer) returns text
language plpgsql as $$
begin
  perform public.update_video_lyric_offset(p_room, p_token, p_video, p_offset);
  return 'ok';
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.seek_err(p_room uuid, p_token text) returns text language plpgsql as $$
begin
  perform public.seek_playback(p_room, p_token, 0);
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- ---------- 1. no direct writes: anon and authenticated may read video_lyrics, never write it ----------
create function pg_temp.assert_read_only_table() returns void language plpgsql as $$
begin
  perform count(*) from public.video_lyrics;   -- reading stays public
  begin
    insert into public.video_lyrics (youtube_video_id, synced_lyrics, updated_by_name) values ('AAAAAAAAAAA', '[00:01.00]pwned', 'Hacker');
    raise exception '% may insert into video_lyrics', current_user;
  exception when insufficient_privilege then null;
  end;
  begin
    update public.video_lyrics set synced_lyrics = '[00:01.00]pwned', offset_ms = 59999;
    raise exception '% may update video_lyrics', current_user;
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.video_lyrics;
    raise exception '% may delete from video_lyrics', current_user;
  exception when insufficient_privilege then null;
  end;
end $$;
set role anon;
do $$ begin perform pg_temp.assert_read_only_table(); end $$;
set role authenticated;
do $$ begin perform pg_temp.assert_read_only_table(); end $$;
reset role;

-- ---------- 2. objects: old signatures gone, policies, grants, pinned search_path ----------
do $$
declare v_fn text;
begin
  assert to_regprocedure('public.upsert_video_lyrics(text,text,text,text,text,integer,text,text)') is null,
         'the old upsert_video_lyrics(text,…) still exists';
  assert to_regprocedure('public.update_video_lyric_offset(text,integer,text)') is null,
         'the old update_video_lyric_offset(text,integer,text) still exists';
  assert (select array_agg(policyname::text order by policyname) from pg_policies
          where schemaname = 'public' and tablename = 'video_lyrics') = array['video_lyrics_select'],
         'only the select policy may remain on video_lyrics';
  assert has_table_privilege('anon', 'public.video_lyrics', 'select')
     and has_table_privilege('authenticated', 'public.video_lyrics', 'select'), 'reading stays public';
  foreach v_fn in array array['public.upsert_video_lyrics(uuid,text,text,text,text,text,text,integer,text)',
                              'public.update_video_lyric_offset(uuid,text,text,integer)'] loop
    assert has_function_privilege('anon', v_fn, 'execute') and has_function_privilege('authenticated', v_fn, 'execute'),
           v_fn || ' must be callable by the client roles';
  end loop;
  assert not has_function_privilege('anon', 'public._lyrics_writer(uuid,text,text)', 'execute')
     and not has_function_privilege('authenticated', 'public._lyrics_writer(uuid,text,text)', 'execute'),
         '_lyrics_writer must stay private';
  assert (select bool_and(p.prosecdef and p.proconfig @> array['search_path=public, extensions'])
          from pg_proc p where p.oid in ('public.upsert_video_lyrics(uuid,text,text,text,text,text,text,integer,text)'::regprocedure,
                                         'public.update_video_lyric_offset(uuid,text,text,integer)'::regprocedure,
                                         'public._lyrics_writer(uuid,text,text)'::regprocedure)),
         'every 0014 function is SECURITY DEFINER with search_path = public, extensions';
end $$;

-- ---------- 3. refusals: session, role, id, room, sizes, offset (nothing is written) ----------
do $$
declare dj text := (select v from smoke where k = 'dj'); member text := (select v from smoke where k = 'member');
        outsider text := (select v from smoke where k = 'outsider'); room uuid := (select v from smoke where k = 'room')::uuid;
        v text;
begin
  assert pg_temp.upsert_err(room, 'forged-token', 'dQw4w9WgXcQ') = 'invalid session', 'upsert: bad session';
  assert pg_temp.offset_err(room, 'forged-token', 'dQw4w9WgXcQ', 500) = 'invalid session', 'offset: bad session';
  assert pg_temp.upsert_err(room, null, 'dQw4w9WgXcQ') = 'invalid session', 'upsert: no session';
  assert pg_temp.upsert_err(room, outsider, 'dQw4w9WgXcQ') = 'account is not a member of this room', 'upsert: outsider';
  assert pg_temp.offset_err(room, outsider, 'dQw4w9WgXcQ', 500) = 'account is not a member of this room', 'offset: outsider';
  assert pg_temp.upsert_err(room, member, 'dQw4w9WgXcQ') = 'dj role required', 'upsert: a member who is not the DJ';
  assert pg_temp.offset_err(room, member, 'dQw4w9WgXcQ', 500) = 'dj role required', 'offset: a member who is not the DJ';

  foreach v in array array['dQw4w9WgXc', 'dQw4w9WgXcQQ', 'dQw4w9WgX!Q', 'dQw4w9 gXcQ', E'dQw4w9WgXcQ\n', '', '../../etc/x'] loop
    assert pg_temp.upsert_err(room, dj, v) = 'invalid video', format('upsert: malformed id %L', v);
    assert pg_temp.offset_err(room, dj, v, 500) = 'invalid video', format('offset: malformed id %L', v);
  end loop;
  assert pg_temp.upsert_err(room, dj, null) = 'invalid video', 'upsert: null id';
  assert pg_temp.offset_err(room, dj, null, 500) = 'invalid video', 'offset: null id';

  assert pg_temp.upsert_err(room, dj, 'AAAAAAAAAAA') = 'video not in room', 'upsert: invented id';
  assert pg_temp.offset_err(room, dj, 'AAAAAAAAAAA', 500) = 'video not in room', 'offset: invented id';
  assert pg_temp.upsert_err(room, dj, '9bZkp7q19f0') = 'video not in room', 'upsert: a song queued in another room';
  assert pg_temp.offset_err(room, dj, '9bZkp7q19f0', 500) = 'video not in room', 'offset: a song queued in another room';

  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_synced => repeat('x', 20001)) = 'lyrics too long', 'synced > 20 000';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_plain => repeat('x', 20001)) = 'lyrics too long', 'plain > 20 000';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_track => repeat('x', 201)) = 'lyrics too long', 'track name > 200';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_artist => repeat('x', 201)) = 'lyrics too long', 'artist name > 200';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_source => 'estimated') = 'lyrics too long', 'unknown timing source';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_source => repeat('a', 5000)) = 'lyrics too long', 'huge timing source';

  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_offset => 600001) = 'invalid offset', 'upsert: offset > 10 min';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_offset => -600001) = 'invalid offset', 'upsert: offset < -10 min';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_offset => -2147483648) = 'invalid offset', 'upsert: offset int min';
  assert pg_temp.offset_err(room, dj, 'dQw4w9WgXcQ', 600001) = 'invalid offset', 'offset: > 10 min';
  assert pg_temp.offset_err(room, dj, 'dQw4w9WgXcQ', -600001) = 'invalid offset', 'offset: < -10 min';
  assert pg_temp.offset_err(room, dj, 'dQw4w9WgXcQ', -2147483648) = 'invalid offset', 'offset: int min';

  assert not exists (select 1 from public.video_lyrics), 'a refused call must not write';
end $$;

-- ---------- 4. the DJ writes: limits accepted, name from the account, the row = what the DJ applied ----------
do $$
declare dj text := (select v from smoke where k = 'dj'); room uuid := (select v from smoke where k = 'room')::uuid;
        dj_name text; r public.video_lyrics%rowtype;
begin
  select a.username into dj_name from public.accounts a where a.id = public._auth_account(dj);
  -- the old hole left a forged row behind for the queued song
  insert into public.video_lyrics (youtube_video_id, synced_lyrics, offset_ms, updated_by_name)
  values ('kJQP7kiw5Fk', '[00:01.00]pwned', 999, 'Hacker');

  -- both RPCs accept offsets up to ±10 minutes (inclusive)
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_offset => 600000) = 'ok', 'upsert: offset +600 000 accepted';
  assert (select offset_ms from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ') = 600000, 'upsert: +600 000 stored';
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ', p_offset => -600000) = 'ok', 'upsert: offset -600 000 accepted';
  assert (select offset_ms from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ') = -600000, 'upsert: -600 000 stored';
  assert pg_temp.offset_err(room, dj, 'dQw4w9WgXcQ', 600000) = 'ok', 'offset: +600 000 accepted';
  assert (select offset_ms from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ') = 600000, 'offset: +600 000 stored';
  assert pg_temp.offset_err(room, dj, 'dQw4w9WgXcQ', -600000) = 'ok', 'offset: -600 000 accepted';
  assert (select offset_ms from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ') = -600000, 'offset: -600 000 stored';

  -- every limit is inclusive; lengths count characters, not bytes
  perform public.upsert_video_lyrics(room, dj, 'dQw4w9WgXcQ', repeat('t', 200), repeat('a', 200),
                                     repeat('ể', 20000), repeat('p', 20000), 60000, 'auto');
  select * into r from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ';
  assert r.updated_by_name = dj_name, format('updated_by_name %L, expected the account name %L', r.updated_by_name, dj_name);
  assert r.track_name = repeat('t', 200) and r.artist_name = repeat('a', 200) and r.synced_lyrics = repeat('ể', 20000)
     and r.plain_lyrics = repeat('p', 20000) and r.offset_ms = 60000 and r.timing_source = 'auto', 'first write stored';

  -- the row becomes exactly what the DJ applied: plain-only lyrics clear the stored synced text, names and the
  -- timing source are replaced as sent (null included), and an offset of 0 is stored as 0
  update public.video_lyrics set updated_at = now() - interval '1 day', updated_by_name = 'Hacker' where youtube_video_id = 'dQw4w9WgXcQ';
  perform public.upsert_video_lyrics(room, dj, 'dQw4w9WgXcQ', 'Plain song', null, null, 'plain words', 0, 'custom');
  select * into r from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ';
  assert r.synced_lyrics is null and r.plain_lyrics = 'plain words',
         format('plain-only upsert: synced %L, plain %L', left(r.synced_lyrics, 12), left(r.plain_lyrics, 12));
  assert r.track_name = 'Plain song' and r.artist_name is null and r.timing_source = 'custom',
         format('names and source replaced as sent: %L, %L, %L', left(r.track_name, 12), left(r.artist_name, 12), r.timing_source);
  assert r.offset_ms = 0, format('an upsert with offset 0 stores 0, got %s', r.offset_ms);
  assert r.updated_by_name = dj_name and r.updated_at = now(), 'name and time refreshed';
  -- synced lyrics replace plain ones the same way; a null timing source is stored as null
  perform public.upsert_video_lyrics(room, dj, 'dQw4w9WgXcQ', 'Song', 'Artist', '[00:02.00]new', null, -1500, null);
  select * into r from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ';
  assert r.synced_lyrics = '[00:02.00]new' and r.plain_lyrics is null and r.timing_source is null and r.offset_ms = -1500,
         'synced-only upsert replaces the plain text';
  -- a null offset (never sent by the client) keeps the stored one
  perform public.upsert_video_lyrics(room, dj, 'dQw4w9WgXcQ', 'Song', 'Artist', '[00:02.00]new', null, null, 'custom');
  select * into r from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ';
  assert r.offset_ms = -1500 and r.timing_source = 'custom', 'a null offset keeps the stored one';

  -- update_video_lyric_offset changes only the offset, the name (from the account) and the time
  update public.video_lyrics set updated_at = now() - interval '1 day', updated_by_name = 'Hacker' where youtube_video_id = 'dQw4w9WgXcQ';
  perform public.update_video_lyric_offset(room, dj, 'dQw4w9WgXcQ', 1500);
  select * into r from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ';
  assert r.offset_ms = 1500 and r.updated_by_name = dj_name and r.updated_at = now(), 'offset, name and time updated';
  assert r.synced_lyrics = '[00:02.00]new' and r.track_name = 'Song' and r.timing_source = 'custom', 'lyrics untouched';
  perform public.update_video_lyric_offset(room, dj, 'dQw4w9WgXcQ', null);
  assert (select offset_ms from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ') = 1500, 'a null offset keeps it';

  -- the queued (not yet playing) song may be written too: the forged name is replaced by the account's
  perform public.update_video_lyric_offset(room, dj, 'kJQP7kiw5Fk', 0);
  select * into r from public.video_lyrics where youtube_video_id = 'kJQP7kiw5Fk';
  assert r.offset_ms = 0 and r.updated_by_name = dj_name, 'queued song: offset 0 set, forged name replaced';

  assert (select count(*) from public.video_lyrics) = 2, 'no other rows';
end $$;

-- ---------- 5. from the anon role, as the real client calls it: the DJ writes only through the RPCs ----------
set role anon;
do $$
declare room uuid := current_setting('smoke.room')::uuid; dj text := current_setting('smoke.dj');
begin
  perform public.update_video_lyric_offset(room, dj, 'dQw4w9WgXcQ', -2500);
  assert (select offset_ms from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ') = -2500, 'anon client: DJ offset write';
  perform public.upsert_video_lyrics(room, dj, 'dQw4w9WgXcQ', 'Song', 'Artist', '[00:03.00]from anon', null, 0, 'custom');
  assert (select synced_lyrics from public.video_lyrics where youtube_video_id = 'dQw4w9WgXcQ') = '[00:03.00]from anon',
         'anon client: DJ lyrics write';
  begin
    perform public.upsert_video_lyrics(room, 'forged-token', 'dQw4w9WgXcQ', 'x', 'x', '[00:01.00]pwned', null, 0, null);
    raise exception 'expected invalid session';
  exception when others then
    assert sqlerrm = 'invalid session', sqlerrm;
  end;
end $$;
reset role;

-- ---------- 6. who may write lyrics = who may control playback (seek_playback), with and without admin = DJ ----------
do $$
declare dj text := (select v from smoke where k = 'dj'); member text := (select v from smoke where k = 'member');
        room uuid := (select v from smoke where k = 'room')::uuid; tok text; seek text; lyr text; off text;
begin
  for round in 1..2 loop
    for tok in select v from smoke where k in ('dj', 'member', 'outsider') union all select 'forged-token' loop
      seek := pg_temp.seek_err(room, tok);
      off := pg_temp.offset_err(room, tok, 'dQw4w9WgXcQ', 500);
      lyr := pg_temp.upsert_err(room, tok, 'dQw4w9WgXcQ');
      assert off = seek and lyr = seek, format('round %s: seek_playback %L, update_video_lyric_offset %L, upsert_video_lyrics %L',
                                               round, seek, off, lyr);
    end loop;
    -- round 2: the admin hands the DJ role to the member, so the admin is no longer the DJ
    perform public.assign_dj(room, dj, (select id from public.members where room_id = room and account_id = public._auth_account(member)));
  end loop;
  assert pg_temp.upsert_err(room, dj, 'dQw4w9WgXcQ') = 'dj role required', 'an admin who is not the DJ may not write';
  assert pg_temp.upsert_err(room, member, 'dQw4w9WgXcQ') = 'ok', 'the new DJ may write';
end $$;

select 'lyrics lockdown smoke ok' as result;
