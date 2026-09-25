-- tests/sql/anticheat-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0015 (see the
-- plan), from the repo root: it re-runs the migration with \i and reads tests/sql/anticheat-guards.sql. Every check is
-- an ASSERT; the first failure stops psql (ON_ERROR_STOP). It runs twice on one database: the fixed names are removed
-- first, every other account has a random name, and every phase sets the anti-cheat mode it needs.
\set ON_ERROR_STOP on

create temp table smoke (k text primary key, v text);

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---------- H5: usernames and login (§6.1) ----------
delete from public.accounts where public._name_norm(username) in ('đạt', 'lan_99', 'minh anh');

do $$
declare n text; r record; a uuid;
begin
  foreach n in array array['A', repeat('x', 25), 'Ao cá', 'AO CA', 'Ao  cá', 'Hợp tác xã', 'hop-tac-xa', 'root',
                           'Lan' || U&'\200B', 'Lan' || U&'\00A0', 'La' || U&'\0301\0301' || 'n',
                           'Lan' || U&'\202E', 'Lan' || U&'\2028', 'Lan' || U&'\FEFF', 'Lan' || U&'\+0E0001'] loop
    assert pg_temp.err(format('select public.register(%L, %L)', n, 'pw123456')) = 'invalid username', format('refused: %s', n);
  end loop;
  select * into r from public.register('Đạt', 'pw123456');
  assert r.username = 'Đạt' and r.token is not null, 'Đạt accepted';
  perform public.register('lan_99', 'pw123456');
  select * into r from public.register('  Minh   Anh ', 'pw123456');
  assert r.username = 'Minh Anh' and (select username from public.accounts where id = r.account_id) = 'Minh Anh',
    'stored NFC with single spaces';
  assert pg_temp.err(format('select public.register(%L, %L)', 'minh  anh', 'pw123456')) = 'username already taken', 'twin';
  assert pg_temp.err(format('select public.register(%L, %L)', normalize('Đạt', NFD), 'pw123456')) = 'username already taken',
    'decomposed twin';
  select * into r from public.login(normalize('Đạt', NFD), 'pw123456');
  assert r.username = 'Đạt' and r.token is not null, 'login with the NFD form';
  select * into r from public.login('  minh   ANH ', 'pw123456');
  assert r.username = 'Minh Anh', 'login with extra spaces';
  assert pg_temp.err(format('select public.login(%L, %L)', 'lan_99', 'wrong')) = 'invalid username or password', 'password';
  a := (select id from public.accounts where username = 'lan_99');
  update public.accounts set is_banned = true where id = a;
  assert pg_temp.err(format('select public.login(%L, %L)', 'lan_99', 'wrong')) = 'invalid username or password',
    'a ban is not revealed to a wrong password';
  assert pg_temp.err(format('select public.login(%L, %L)', 'lan_99', 'pw123456')) = 'account banned', 'banned';
end $$;

-- ---------- system lines (§6.1): members write system = false; the backfill marks the well-formed announcer lines ----------
insert into smoke select 't1', token from public.register('ac1_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Chống gian lận', 'pw', (select v from smoke where k = 't1'));

do $$
declare t1 text := (select v from smoke where k = 't1'); room uuid := (select v from smoke where k = 'room')::uuid;
        v_id uuid;
begin
  v_id := public.send_chat_message(t1, room, '[catch:00000000-0000-0000-0000-000000000000|ca_ro|200] fake');
  assert (select not system and about_account_id is null from public.chat_messages where id = v_id),
    'a member line is never a system line';
  -- old lines from before 0015: two well-formed, one without the prefix, one with a member author
  insert into public.chat_messages (room_id, account_id, username, body) values
    (room, null, 'Ao cá', '[catch:11111111-2222-3333-4444-555555555555|ca_tra|3150] 🎣 Lan vừa câu được Cá tra 3,2 kg (Hiếm)!'),
    (room, null, 'Hợp tác xã', '[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.'),
    (room, null, 'Ao cá', 'no prefix here'),
    (room, (select v from smoke where k = 'a1')::uuid, 'Ao cá', '[catch:11111111-2222-3333-4444-555555555555|ca_tra|3150] x');
end $$;

-- ---------- H4: queue metadata (§6.2) ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); room uuid := (select v from smoke where k = 'room')::uuid;
        v_id uuid; q public.queue_items; n int; bad text;
begin
  update public.rooms set max_duration_seconds = 0 where id = room;   -- unlimited: a null duration is allowed
  foreach bad in array array['abc', 'dQw4w9WgXcQ?', 'dQw4w9WgXc', 'dQw4w9WgXcQQ', 'dQw4w9 gXcQ'] loop
    assert pg_temp.err(format('select public.add_queue_item(%L, %L, %L, %L, null, 100)', room, t1, bad, 'x'))
           = 'invalid video', format('bad id %s', bad);
  end loop;
  assert pg_temp.err(format('select public.add_queue_item(%L, %L, null, %L, null, 100)', room, t1, 'x')) = 'invalid video', 'null id';
  v_id := public.add_queue_item(room, t1, 'dQw4w9WgXcQ',
          E'  Never\tGonna' || U&'\00A0\00A0' || 'Give' || U&'\200B\202E\2028' || ' You   Up  ' || repeat('x', 250),
          'https://evil.example/pixel.gif', 0);
  select * into q from public.queue_items where id = v_id;
  assert q.title = left('Never Gonna Give You Up ' || repeat('x', 250), 200) and char_length(q.title) = 200, format('title %s', q.title);
  assert q.thumbnail_url = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', 'derived thumbnail';
  assert q.duration_seconds is null, 'duration 0 is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa1', U&'\200B\00A0', null, -5);
  select * into q from public.queue_items where id = v_id;
  assert q.title = 'aaaaaaaaaa1' and q.duration_seconds is null, 'an empty title falls back to the id; -5 is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa2', 'Long', null, 90000);
  assert (select duration_seconds is null from public.queue_items where id = v_id), '90 000 s is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa3', 'Ok', null, 86400);
  assert (select duration_seconds = 86400 from public.queue_items where id = v_id), '86 400 s is kept';
  -- a zero-width character no longer splits a banned keyword (R26)
  update public.rooms set banned_keywords = array['remix'] where id = room;
  assert pg_temp.err(format('select public.add_queue_item(%L, %L, %L, %L, null, 100)', room, t1, 'aaaaaaaaaa4',
                            'Song (re' || U&'\200B' || 'mix)')) = 'banned keyword: remix', 'keyword';
  update public.rooms set banned_keywords = '{}' where id = room;
  -- the batch skips bad ids and cleans the rest
  n := public.add_queue_items(room, t1, jsonb_build_array(
         jsonb_build_object('video_id', 'bad', 'title', 'x', 'thumb', 'https://evil.example/a.gif', 'duration', 100),
         jsonb_build_object('video_id', 'bbbbbbbbbb1', 'title', E'Two\n' || U&'\2060' || 'lines', 'thumb', 'https://evil.example/b.gif',
                            'duration', 100000),
         jsonb_build_object('video_id', 'bbbbbbbbbb2', 'title', '', 'duration', 42.9),
         jsonb_build_object('title', 'no id')));
  assert n = 2, format('batch added %s', n);
  select * into q from public.queue_items where room_id = room and youtube_video_id = 'bbbbbbbbbb1';
  assert q.title = 'Two lines' and q.thumbnail_url = 'https://i.ytimg.com/vi/bbbbbbbbbb1/mqdefault.jpg' and q.duration_seconds is null,
    format('batch row 1: %s / %s / %s', q.title, q.thumbnail_url, q.duration_seconds);
  select * into q from public.queue_items where room_id = room and youtube_video_id = 'bbbbbbbbbb2';
  assert q.title = 'bbbbbbbbbb2' and q.duration_seconds = 42, 'batch row 2';
  -- rows from before 0015, for the re-run below
  insert into public.queue_items (room_id, youtube_video_id, title, thumbnail_url, added_by_name, position)
  values (room, 'ccccccccccc', 'old', 'https://evil.example/c.gif', 'x', 99), (room, 'old!', 'older', 'https://evil.example/d.gif', 'x', 98);
  insert into public.play_history (room_id, youtube_video_id, title, thumbnail_url)
  values (room, 'ccccccccccc', 'old', 'https://evil.example/e.gif'), (room, 'old!', 'older', 'https://evil.example/f.gif');
end $$;

-- Re-running the migration backfills the old chat lines and rewrites the old thumbnails (and proves it re-runs).
\i supabase/migrations/0015_anticheat.sql

do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
begin
  assert (select system and about_account_id = '11111111-2222-3333-4444-555555555555' from public.chat_messages
           where room_id = room and account_id is null and body like '[catch:%'), 'old catch line marked, with its catcher';
  assert (select system and about_account_id is null from public.chat_messages where room_id = room and body like '[land:3]%'),
    'old land line marked, unattributed (R13)';
  assert (select not system from public.chat_messages where room_id = room and body = 'no prefix here'), 'no prefix → not system';
  assert (select not system from public.chat_messages where room_id = room and account_id is not null and body like '[catch:%x'),
    'a member author → not system';
  assert (select thumbnail_url from public.queue_items where room_id = room and youtube_video_id = 'ccccccccccc')
         = 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg'
     and (select thumbnail_url is null from public.queue_items where room_id = room and youtube_video_id = 'old!'), 'queue rewritten';
  assert (select thumbnail_url from public.play_history where room_id = room and youtube_video_id = 'ccccccccccc')
         = 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg'
     and (select thumbnail_url is null from public.play_history where room_id = room and youtube_video_id = 'old!'), 'history rewritten';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('_name_norm', '_name_key', '_clean_title', '_yt_thumb')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the name and queue helpers are private';
end $$;

select 'anticheat names and queue smoke ok' as result;
