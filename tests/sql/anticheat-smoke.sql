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

-- ---------- the flow (§9): the lock gate, the evidence, strikes, root, log mode, the caps, holdings, wipe, pardon ----------
-- An error as {message, detail, hint}, or null when the statement succeeds.
create or replace function pg_temp.errd(p_sql text) returns jsonb language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return jsonb_build_object('message', v_msg, 'detail', v_detail, 'hint', v_hint);
end $$;
-- A flagged input of the kind the room RPCs report (hard by default).
create or replace function pg_temp.flag(a uuid, code text default 'bad_plot', hard boolean default true) returns jsonb
language sql as $$ select public._ac_flag(a, code, 'water', jsonb_build_object('plot', 99), null, 'invalid plot', hard) $$;
create or replace function pg_temp.status(a uuid) returns public.anticheat_status language sql
as $$ select * from public.anticheat_status where account_id = a $$;
create or replace function pg_temp.last_outcome(a uuid) returns text language sql
as $$ select outcome from public.anticheat_events where account_id = a order by id desc limit 1 $$;

insert into smoke select 't2', token from public.register('ac2_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('ac3_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't4', token from public.register('ac4_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't5', token from public.register('ac5_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't6', token from public.register('ac6_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'troot', token from public.register('acroot_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('t2', 't3', 't4', 't5', 't6', 'troot');
update public.accounts set is_root = true where id = (select v from smoke where k = 'aroot')::uuid;
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw',
                        (select v from smoke where k = 't2'));

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; e jsonb; f text;
begin
  -- private objects
  assert (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('_ac_guard', '_ac_account', '_ac_play', '_ac_flag', '_ac_hug', '_ac_lock_state', '_ac_holdings',
                             '_ac_wipe', '_ac_pardon')) = 9, 'nine helpers';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_ac\_%'
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
  foreach f in array array['anticheat_config', 'anticheat_status', 'anticheat_events', 'anticheat_wipes'] loop
    assert not has_table_privilege('anon', 'public.' || f, 'select') and not has_table_privilege('anon', 'public.' || f, 'insert'), f;
  end loop;
  assert (select count(*) from public.anticheat_config) = 1, 'one config row';

  -- the lock gate: the account RPCs and the room RPCs raise 'account locked' with the seconds and the hint
  assert public._ac_account(t2) = a2 and public._ac_play(room, t2) = a2, 'no lock';
  insert into public.anticheat_status (account_id, locked_until) values (a2, now() + interval '125 seconds')
  on conflict (account_id) do update set locked_until = excluded.locked_until;
  e := pg_temp.errd(format('select public._ac_account(%L)', t2));
  assert e->>'message' = 'account locked' and e->>'hint' = 'anticheat' and e->>'detail' = '125', format('lock %s', e);
  e := pg_temp.errd(format('select public._ac_play(%L, %L)', room, t2));
  assert e->>'message' = 'account locked' and e->>'detail' = '125', format('room lock %s', e);
  assert pg_temp.err(format('select public._ac_play(%L, %L)', gen_random_uuid(), t2)) = 'account is not a member of this room',
    'membership first';
  assert pg_temp.err(format('select public._ac_account(%L)', 'no such token')) = 'invalid session', 'session first';
  assert public._ac_lock_state(a2) = jsonb_build_object('until', now() + interval '125 seconds', 'code', null), 'lock state';
  update public.anticheat_status set locked_until = null where account_id = a2;
  assert public._ac_lock_state(a2) is null and public._ac_lock_state(gen_random_uuid()) is null, 'no lock state';
end $$;

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; aroot uuid := (select v from smoke where k = 'aroot')::uuid;
        r jsonb; s public.anticheat_status;
begin
  -- log mode (D5): recorded, never escalated, and never counted later (R7)
  update public.anticheat_config set mode = 'log';
  r := pg_temp.flag(a2);
  assert r = jsonb_build_object('anticheat', jsonb_build_object('code', 'bad_plot', 'strike', 0, 'error', 'invalid plot',
                                'locked_until', null, 'banned', false, 'server_now', now())), format('log envelope %s', r);
  assert pg_temp.last_outcome(a2) = 'log_only', 'log_only row';
  assert (select username = (select username from public.accounts where id = a2) and rpc = 'water' and detail = '{"plot": 99}'
            and client is null and user_agent is null
            from public.anticheat_events where account_id = a2 order by id desc limit 1), 'the evidence row';
  s := pg_temp.status(a2);
  assert s.strikes = 0 and s.locked_until is null and s.events_count = 1 and s.events_on = public._vn_today(), 'counted, not struck';

  -- enforce: strike 1 locks for 5 minutes
  update public.anticheat_config set mode = 'enforce';
  r := pg_temp.flag(a2);
  assert (r->'anticheat'->>'strike')::int = 1 and (r->'anticheat'->>'locked_until')::timestamptz = now() + interval '5 minutes'
     and not (r->'anticheat'->>'banned')::boolean, format('strike 1 %s', r);
  s := pg_temp.status(a2);
  assert s.strikes = 1 and s.last_strike_code = 'bad_plot' and s.last_strike_at = now()
     and s.locked_until = now() + interval '5 minutes' and s.events_count = 1, 'locked; strike rows are not counted';
  assert pg_temp.last_outcome(a2) = 'strike_1', 'strike_1 row';
  assert public._ac_lock_state(a2) = jsonb_build_object('until', now() + interval '5 minutes', 'code', 'bad_plot'), 'lock state';
  -- one strike per lock (§9.4)
  r := pg_temp.flag(a2, 'bad_water');
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(a2) = 'in_lock' and (pg_temp.status(a2)).strikes = 1, 'in_lock';
  -- after the lock, the next hard signal bans (D3)
  update public.anticheat_status set locked_until = now() - interval '1 second' where account_id = a2;
  r := pg_temp.flag(a2, 'bad_water');
  assert (r->'anticheat'->>'strike')::int = 2 and (r->'anticheat'->>'banned')::boolean and r->'anticheat'->'locked_until' = 'null',
    format('strike 2 %s', r);
  s := pg_temp.status(a2);
  assert s.strikes = 2 and s.ban_state = 'pending_wipe' and s.banned_at = now() and s.locked_until is null
     and s.last_strike_code = 'bad_water', 'pending wipe';
  assert (select is_banned from public.accounts where id = a2) and not exists (select 1 from public.sessions where account_id = a2),
    'banned, sessions deleted';
  assert pg_temp.err(format('select public._ac_account(%L)', t2)) = 'invalid session', 'the old token is dead';
  r := pg_temp.flag(a2);
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(a2) = 'in_lock', 'a banned account: in_lock';

  -- a lone strike 1 older than 30 days has expired (D4)
  insert into public.anticheat_status (account_id, strikes, last_strike_at, last_strike_code)
  values (a3, 1, now() - interval '31 days', 'bad_plot')
  on conflict (account_id) do update set strikes = 1, last_strike_at = excluded.last_strike_at, locked_until = null, ban_state = null;
  r := pg_temp.flag(a3);
  assert (r->'anticheat'->>'strike')::int = 1 and (pg_temp.status(a3)).last_strike_at = now(), 'strike 1 again';
  update public.anticheat_status set locked_until = null, last_strike_at = now() - interval '29 days' where account_id = a3;
  r := pg_temp.flag(a3);
  assert (r->'anticheat'->>'strike')::int = 2, 'within 30 days: strike 2';

  -- root is never locked or banned (§9.8)
  r := pg_temp.flag(aroot);
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(aroot) = 'root'
     and (pg_temp.status(aroot)).locked_until is null and not (select is_banned from public.accounts where id = aroot), 'root';
end $$;

do $$
declare a4 uuid := (select v from smoke where k = 'a4')::uuid; a5 uuid := (select v from smoke where k = 'a5')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; r jsonb; i int;
begin
  update public.anticheat_config set mode = 'enforce';
  -- soft signals never escalate, in any mode
  r := pg_temp.flag(a4, 'kind_mismatch', false);
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(a4) = 'soft' and (pg_temp.status(a4)).locked_until is null, 'soft';
  -- at most 200 non-strike rows per account and Vietnam day; strike rows are always written (R31)
  for i in 2..201 loop
    perform pg_temp.flag(a4, 'kind_mismatch', false);
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = a4) = 200, '200 rows a day';
  r := pg_temp.flag(a4);
  assert (r->'anticheat'->>'strike')::int = 1 and (select count(*) from public.anticheat_events where account_id = a4) = 201,
    'the strike row is written past the cap';
  update public.anticheat_status set events_on = events_on - 1 where account_id = a4;
  perform pg_temp.flag(a4, 'kind_mismatch', false);
  assert (select count(*) from public.anticheat_events where account_id = a4) = 202, 'a new day restarts the count';
  -- the purge: other rows live 90 days, strike rows forever (§8.4)
  insert into public.anticheat_events (account_id, username, code, outcome, rpc, created_at) values
    (a4, 'x', 'kind_mismatch', 'soft', 'buy_item', now() - interval '91 days'),
    (a4, 'x', 'bad_plot', 'strike_1', 'water', now() - interval '91 days');
  perform pg_temp.flag(a4, 'kind_mismatch', false);
  assert not exists (select 1 from public.anticheat_events where account_id = a4 and outcome = 'soft'
                       and created_at < now() - interval '90 days'), 'old soft row purged';
  assert exists (select 1 from public.anticheat_events where account_id = a4 and outcome = 'strike_1'
                   and created_at < now() - interval '90 days'), 'old strike row kept';
  -- the client build and the browser come from the request headers, capped; a bad value is ignored (R32)
  perform set_config('request.headers',
    json_build_object('x-client-info', 'music-together/' || repeat('9', 120), 'user-agent', repeat('U', 300))::text, true);
  perform pg_temp.flag(a5, 'kind_mismatch', false);
  assert (select client = left('music-together/' || repeat('9', 120), 100) and user_agent = repeat('U', 200)
            from public.anticheat_events where account_id = a5 order by id desc limit 1), 'headers';
  perform set_config('request.headers', 'not json', true);
  perform pg_temp.flag(a5, 'kind_mismatch', false);
  assert (select client is null and user_agent is null from public.anticheat_events where account_id = a5 order by id desc limit 1),
    'a bad header value';
  perform set_config('request.headers', '', true);
  -- reel gate hugs: counted per Vietnam day, logged once at the 20th (R20)
  for i in 1..19 loop
    perform public._ac_hug(a5, 0.95, room);
  end loop;
  assert not exists (select 1 from public.anticheat_events where account_id = a5 and code = 'reel_gate_hug'), '19 hugs: nothing';
  perform public._ac_hug(a5, 0.97, room);
  perform public._ac_hug(a5, 0.95, room);
  assert (select count(*) from public.anticheat_events where account_id = a5 and code = 'reel_gate_hug') = 1, 'logged once';
  assert (select outcome = 'soft' and rpc = 'finish_cast' and room_id = room
                 and detail = jsonb_build_object('day', public._vn_today(), 'count', 20, 'ratio', 0.97)
            from public.anticheat_events where account_id = a5 and code = 'reel_gate_hug'), 'the hug row';
  update public.anticheat_status set hug_on = hug_on - 1 where account_id = a5;
  perform public._ac_hug(a5, 0.95, room);
  assert (pg_temp.status(a5)).hug_count = 1 and (pg_temp.status(a5)).hug_on = public._vn_today(), 'a new day';
  assert (pg_temp.status(a5)).strikes = 0, 'hugs never strike';
end $$;

do $$
declare a5 uuid := (select v from smoke where k = 'a5')::uuid; a6 uuid := (select v from smoke where k = 'a6')::uuid;
        aroot uuid := (select v from smoke where k = 'aroot')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        h jsonb; snap jsonb; w public.anticheat_wipes;
begin
  -- holdings: everything a wipe would remove (§9.6)
  insert into public.wallets (account_id, coins, daily_on, bonus_on, bonus_count) values (a6, 1230, '2026-10-01', '2026-10-01', 3);
  insert into public.inventory (account_id, item_id, qty) values (a6, 'rod_bamboo', 1), (a6, 'bait_worm', 7), (a6, 'seed_nep', 2);
  insert into public.fishing_profiles (account_id, rod) values (a6, 'rod_bamboo');
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (a6, room, 'ca_ro', 100, 2600, now(), now() + interval '1 minute');
  insert into public.fish (account_id, species_id, weight_g, price) values (a6, 'ca_tra', 3150, 221);
  insert into public.personal_bests (account_id, species_id, weight_g) values (a6, 'ca_tra', 3150);
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (a6, 'nep', 0, 70);
  perform public._field_init(room);
  update public.field_plots set owner_id = a6, owned_at = now(), sublease_price = 300 where room_id = room and plot_no = 3;
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (room, 7, a6, 'village', 250, now(), now() + interval '96 hours');
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (room, 2, a6, 8000, now());
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at) values (room, 7, a6, 'nep', now());
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at) values (room, 2, a6, 'nep', 70, now());
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id) values
    (room, null, 'Ao cá', '[catch:' || a6 || '|ca_tra|3150] 🎣 x', true, a6),
    (room, a6, 'x', 'a line of my own', false, null);
  h := public._ac_holdings(a6);
  assert h->'wallet' = '{"coins": 1230, "daily_on": "2026-10-01", "bonus_on": "2026-10-01", "bonus_count": 3}', format('wallet %s', h->'wallet');
  assert h->'inventory' = '[{"qty": 7, "item_id": "bait_worm"}, {"qty": 1, "item_id": "rod_bamboo"}, {"qty": 2, "item_id": "seed_nep"}]',
    format('inventory %s', h->'inventory');
  assert h->'fishing_profile' = '{"rod": "rod_bamboo", "bait": "bait_worm", "bobber": "bobber_feather"}', 'profile';
  assert h->'fish'->0->>'species_id' = 'ca_tra' and h->'personal_bests'->0->>'weight_g' = '3150', 'fish and bests';
  assert h->'rice' = '[{"dry_kg": 70, "wet_kg": 0, "variety": "nep"}]', 'rice';
  assert h->'plots'->0->>'plot_no' = '3' and h->'plots'->0->>'sublease_price' = '300' and h->'plots'->0->>'kind' = 'private', 'plot';
  assert h->'leases'->0->>'plot_no' = '7' and h->'offers'->0->>'price' = '8000' and h->'crops'->0->>'variety' = 'nep'
     and h->'drying'->0->>'kg' = '70' and h->>'announcements' = '1', 'land, crops, drying, lines';
  assert public._ac_holdings(a5) = jsonb_build_object('wallet', null, 'inventory', '[]'::jsonb, 'fishing_profile', null,
           'fish', '[]'::jsonb, 'personal_bests', '[]'::jsonb, 'rice', '[]'::jsonb, 'plots', '[]'::jsonb, 'leases', '[]'::jsonb,
           'offers', '[]'::jsonb, 'crops', '[]'::jsonb, 'drying', '[]'::jsonb, 'announcements', 0), 'nothing held';

  -- the wipe (the admin RPC checks pending_wipe and takes the wallet lock first)
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a6, 2, 'pending_wipe', now());
  snap := public._ac_wipe(a6, aroot);
  select * into w from public.anticheat_wipes where account_id = a6 order by id desc limit 1;
  assert snap = h and w.snapshot = h and w.wiped_by = aroot and w.username = (select username from public.accounts where id = a6),
    'the snapshot';
  assert (select delta = -1230 and balance = 0 and ref = 'wipe #' || w.id from public.coin_ledger
           where account_id = a6 and reason = 'wipe'), 'the last ledger row';
  assert not exists (select 1 from public.wallets where account_id = a6) and not exists (select 1 from public.inventory where account_id = a6)
     and not exists (select 1 from public.fishing_profiles where account_id = a6) and not exists (select 1 from public.casts where account_id = a6)
     and not exists (select 1 from public.fish where account_id = a6) and not exists (select 1 from public.personal_bests where account_id = a6)
     and not exists (select 1 from public.rice_stock where account_id = a6), 'the game data is gone';
  assert not exists (select 1 from public.chat_messages where about_account_id = a6)
     and exists (select 1 from public.chat_messages where account_id = a6 and body = 'a line of my own'), 'only the system lines go (D6)';
  assert (pg_temp.status(a6)).ban_state = 'wiped' and (pg_temp.status(a6)).wiped_at = now(), 'wiped';
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 3) = a6, 'land waits for the sweep';

  -- pardon (§9.7)
  assert pg_temp.err(format('select public._ac_pardon(%L, %L)', a5, aroot)) = 'nothing to pardon', 'no strike, lock or ban';
  assert pg_temp.err(format('select public._ac_pardon(%L, %L)', gen_random_uuid(), aroot)) = 'nothing to pardon', 'no status row';
  update public.accounts set is_banned = true where id = a6;
  perform public._ac_pardon(a6, aroot);
  assert not (select is_banned from public.accounts where id = a6), 'unbanned';
  assert (select strikes = 0 and last_strike_at is null and last_strike_code is null and locked_until is null and ban_state is null
                 and banned_at is null and pardoned_at = now() and pardoned_by = aroot and wiped_at = now()
            from public.anticheat_status where account_id = a6), 'pardoned; wiped_at kept (R11)';
  update public.anticheat_config set mode = 'log';
end $$;

select 'anticheat flow smoke ok' as result;
