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
  -- C and S characters become spaces and the runs collapse; Z characters stay in the stored title (R26)
  assert q.title = left('Never Gonna Give' || U&'\200B\202E' || ' You Up ' || repeat('x', 250), 200) and char_length(q.title) = 200,
    format('title %s', q.title);
  assert q.thumbnail_url = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', 'derived thumbnail';
  assert q.duration_seconds is null, 'duration 0 is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa1', U&'\200B\00A0', null, -5);
  select * into q from public.queue_items where id = v_id;
  assert q.title = 'aaaaaaaaaa1' and q.duration_seconds is null, 'an empty title falls back to the id; -5 is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa2', 'Long', null, 90000);
  assert (select duration_seconds is null from public.queue_items where id = v_id), '90 000 s is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa3', 'Ok', null, 86400);
  assert (select duration_seconds = 86400 from public.queue_items where id = v_id), '86 400 s is kept';
  -- an emoji keeps its variation selector and its joiners: only the keyword check reads the title without them
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa5', 'Yêu ' || U&'\2764\FE0F' || ' ' || U&'\+01F468\200D\+01F469\200D\+01F467',
                                null, 100);
  assert (select title = 'Yêu ' || U&'\2764\FE0F' || ' ' || U&'\+01F468\200D\+01F469\200D\+01F467'
            from public.queue_items where id = v_id), 'a heart keeps its U+FE0F, a family its joiners';
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
  assert q.title = 'Two ' || U&'\2060' || 'lines' and q.thumbnail_url = 'https://i.ytimg.com/vi/bbbbbbbbbb1/mqdefault.jpg'
     and q.duration_seconds is null,
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
                      and p.proname in ('_name_norm', '_name_key', '_clean_title', '_title_key', '_yt_thumb')
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

-- ---------- fishing (§6.3, §7.2–§7.4, §10.2): the daily cap, reel_too_fast, the shop checks, gate hugs, catch lines ----------
insert into smoke select 'f1', token from public.register('acf1_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'f2', token from public.register('acf2_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'f3', token from public.register('acf3_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'b' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('f1', 'f2', 'f3');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
  from smoke where k in ('f1', 'f2', 'f3');
-- An angler with worms, the hourly window fresh and nothing in hand.
create or replace function pg_temp.angler(a uuid) returns void language sql as $$
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  update public.fishing_profiles set window_start = now(), window_casts = 0, bait = 'bait_worm' where account_id = a;
  delete from public.fish where account_id = a;
$$;

do $$
declare f1 text := (select v from smoke where k = 'f1'); b1 uuid := (select v from smoke where k = 'b1')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; c jsonb; e jsonb; r jsonb;
begin
  perform pg_temp.angler(b1);
  -- the daily cap (§6.3): the 300th cast works and is logged once; the 301st is refused until the Vietnam midnight
  update public.fishing_profiles set day_on = public._vn_today(), day_casts = 298 where account_id = b1;
  c := public.start_cast(room, f1);
  assert (select day_casts from public.fishing_profiles where account_id = b1) = 299
     and not exists (select 1 from public.anticheat_events where account_id = b1), '299: nothing logged';
  c := public.start_cast(room, f1);
  assert (select day_casts from public.fishing_profiles where account_id = b1) = 300, '300 casts';
  assert (select outcome = 'soft' and code = 'cast_daily_cap' and rpc = 'start_cast' and room_id = room
                 and detail = jsonb_build_object('day', public._vn_today(), 'casts', 300)
            from public.anticheat_events where account_id = b1), 'cast_daily_cap logged';
  e := pg_temp.errd(format('select public.start_cast(%L, %L)', room, f1));
  assert e->>'message' = 'daily cast limit' and (e->>'detail')::int between 1 and 86400, format('daily limit %s', e);
  assert (select count(*) from public.anticheat_events where account_id = b1) = 1, 'the refusal is not logged';
  update public.fishing_profiles set day_on = public._vn_today() - 1 where account_id = b1;
  c := public.start_cast(room, f1);
  assert (select day_on = public._vn_today() and day_casts = 1 from public.fishing_profiles where account_id = b1), 'a new day';

  -- log mode: a won reel reported at once is reel_too_fast, logged only; the answer stays the lost one
  update public.anticheat_config set mode = 'log';
  r := public.finish_cast(f1, (c->>'cast_id')::uuid, true);
  assert r->>'result' = 'lost' and r->>'why' = 'too_early' and r->'state'->>'coins' is not null, format('lost %s', r);
  assert r->'anticheat'->>'code' = 'reel_too_fast' and (r->'anticheat'->>'strike')::int = 0 and r->'anticheat'->'error' = 'null',
    format('envelope %s', r->'anticheat');
  assert (select outcome = 'log_only' and rpc = 'finish_cast' and room_id = room
                 and detail ?& array['cast_id', 'species_id', 'bite_at', 'min_reel_ms', 'finished_at', 'ratio']
                 and detail->>'cast_id' = c->>'cast_id'
            from public.anticheat_events where account_id = b1 and code = 'reel_too_fast'), 'the reel_too_fast row';
  assert not exists (select 1 from public.casts where account_id = b1), 'the cast is consumed';

  -- the fishing shop: bad quantities are hard, farm items soft, unknown and unpriced items plain refusals
  update public.wallets set coins = 5000 where account_id = b1;
  foreach e in array array[jsonb_build_array('bait_shrimp', 500), jsonb_build_array('bait_shrimp', 0),
                           jsonb_build_array('bait_shrimp', null), jsonb_build_array('rod_bamboo', 2),
                           jsonb_build_array('bucket_small', 0)] loop
    r := public.buy_item(f1, e->>0, (e->>1)::int);
    assert r = jsonb_build_object('anticheat', jsonb_build_object('code', 'bad_qty', 'strike', 0, 'error', 'invalid quantity',
                                  'locked_until', null, 'banned', false, 'server_now', now())), format('bad_qty %s: %s', e, r);
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = b1 and code = 'bad_qty' and outcome = 'log_only') = 5,
    'five bad_qty rows';
  assert (select detail = '{"item": "bait_shrimp", "qty": 500}' from public.anticheat_events
           where account_id = b1 and code = 'bad_qty' order by id limit 1), 'bad_qty detail';
  r := public.buy_item(f1, 'seed_short', 5);
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'error' = 'item not available', 'kind_mismatch';
  assert (select outcome = 'soft' and detail = '{"item": "seed_short", "kind": "seed"}' from public.anticheat_events
           where account_id = b1 and code = 'kind_mismatch'), 'soft kind_mismatch row';
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', f1, 'no_such_item')) = 'item not available', 'unknown';
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', f1, 'rod_wood')) = 'item not available', 'unpriced';
  assert not exists (select 1 from public.anticheat_events where account_id = b1 and detail->>'item' in ('no_such_item', 'rod_wood')),
    'plain refusals are not logged';
  assert (select coins from public.wallets where account_id = b1) = 5000, 'nothing was bought';
  r := public.buy_item(f1, 'bait_shrimp', 3);
  assert (r->'state'->'bait'->>'bait_shrimp')::int = 3, 'an honest purchase';
end $$;

do $$
declare f2 text := (select v from smoke where k = 'f2'); b2 uuid := (select v from smoke where k = 'b2')::uuid;
        f3 text := (select v from smoke where k = 'f3'); b3 uuid := (select v from smoke where k = 'b3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; c jsonb; r jsonb; e jsonb; call text;
begin
  update public.anticheat_config set mode = 'enforce';
  perform pg_temp.angler(b2);
  -- no false positives in enforce (§7.3): give up, a double finish, a finish after expiry, a won reel at the gate
  c := public.start_cast(room, f2);
  r := public.finish_cast(f2, (c->>'cast_id')::uuid, false);
  assert r->>'why' = 'gave_up' and r->'anticheat' is null, 'gave up';
  assert pg_temp.err(format('select public.finish_cast(%L, %L, true)', f2, c->>'cast_id')) = 'cast not found', 'double finish';
  c := public.start_cast(room, f2);
  update public.casts set expires_at = now() - interval '1 second' where account_id = b2;
  r := public.finish_cast(f2, (c->>'cast_id')::uuid, true);
  assert r->>'why' = 'expired' and r->'anticheat' is null, 'expired';
  c := public.start_cast(room, f2);
  update public.casts set species_id = 'ca_tra', weight_g = 3150, bite_at = now() - make_interval(secs => min_reel_ms / 1000.0)
   where account_id = b2;
  r := public.finish_cast(f2, (c->>'cast_id')::uuid, true);
  assert r->>'result' = 'caught' and r->'anticheat' is null, 'a won reel at ratio 1.0 is caught';
  assert (select hug_count = 1 and hug_on = public._vn_today() from public.anticheat_status where account_id = b2), 'a gate hug';
  assert (select system and account_id is null and username = 'Ao cá' and about_account_id = b2
            from public.chat_messages where room_id = room and body like '[catch:' || b2 || '|ca_tra|3150]%'), 'a system catch line';
  assert not exists (select 1 from public.anticheat_events where account_id = b2), 'nothing logged';
  r := public.buy_item(f2, 'seed_short', 5);
  assert (r->'anticheat'->>'strike')::int = 0 and (select outcome from public.anticheat_events where account_id = b2) = 'soft'
     and not exists (select 1 from public.anticheat_status where account_id = b2 and locked_until is not null),
    'the old v14 client buying a farm item: soft only';

  -- enforce: reel_too_fast is strike 1, the lock stops every fishing RPC with the seconds left
  perform pg_temp.angler(b3);
  c := public.start_cast(room, f3);
  r := public.finish_cast(f3, (c->>'cast_id')::uuid, true);
  assert r->>'why' = 'too_early' and (r->'anticheat'->>'strike')::int = 1
     and (r->'anticheat'->>'locked_until')::timestamptz = now() + interval '5 minutes', format('strike 1 %s', r->'anticheat');
  foreach call in array array[
    format('select public.claim_daily(%L)', f3), format('select public.dig_worms(%L)', f3),
    format('select public.buy_item(%L, %L, 1)', f3, 'bait_shrimp'),
    format('select public.set_loadout(%L, %L, %L, %L)', f3, 'rod_wood', 'bobber_feather', 'bait_worm'),
    format('select public.start_cast(%L, %L)', room, f3), format('select public.finish_cast(%L, %L, false)', f3, gen_random_uuid()),
    format('select public.sell_fish(%L, %L)', f3, array[gen_random_uuid()]), format('select public.release_fish(%L, %L)', f3, gen_random_uuid())] loop
    e := pg_temp.errd(call);
    assert e->>'message' = 'account locked' and e->>'hint' = 'anticheat' and (e->>'detail')::int = 300, format('%s: %s', call, e);
  end loop;
  assert public.fishing_state(f3)->>'coins' is not null and public.fishing_board(room, f3)->>'my_rank' is not null, 'reads stay open';
  update public.anticheat_config set mode = 'log';
end $$;

select 'anticheat fishing smoke ok' as result;

-- ---------- farm and land (§7.2, §7.3, §10.3): the hard signals, the lock, foreign offers, no false positives ----------
insert into smoke select 'g' || n, token from generate_series(1, 5) n,
  lateral public.register('acg' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'h' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('g1', 'g2', 'g3', 'g4', 'g5');
insert into smoke select 'froom', room_id::text from public.create_room('Đồng gian lận', 'pw', (select v from smoke where k = 'g1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'froom')::uuid), 'pw', v)
  from smoke where k in ('g2', 'g3', 'g4', 'g5');
create or replace function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
-- An envelope with this code, strike and error, and nothing else in the answer.
create or replace function pg_temp.env(r jsonb, code text, strike int, error text) returns boolean language sql
as $$ select r->'anticheat'->>'code' = code and (r->'anticheat'->>'strike')::int = strike and r->'anticheat'->>'error' = error
             and r - 'anticheat' = '{}'::jsonb $$;

-- g1 farms village plot 8 (prepared, flooded); g4 owns plot 1; g5 offers on it
do $$
declare h1 uuid := (select v from smoke where k = 'h1')::uuid; h4 uuid := (select v from smoke where k = 'h4')::uuid;
        h5 uuid := (select v from smoke where k = 'h5')::uuid; room uuid := (select v from smoke where k = 'froom')::uuid;
        t timestamptz := now();
begin
  perform pg_temp.set_coins(h1, 10750);
  perform public._farm_do_rent(room, h1, 8, t);
  perform public._farm_do_prepare(room, h1, 8, t);
  perform pg_temp.set_coins(h4, 801000);
  perform public._farm_do_buy_plot(room, h4, 1, t);
  perform pg_temp.set_coins(h5, 20000);
  perform public._farm_do_offer(room, h5, 1, 5000, t);
  insert into smoke select 'o5', id::text from public.land_offers where room_id = room and buyer_id = h5;
end $$;

-- Every hard signal of the farm and the shops (§7.2) as g1 sends it, with the refusal it stands for.
create temp table hard_calls as
select v.code, v.error, v.call
  from (select (select v from smoke where k = 'froom') as room, (select v from smoke where k = 'g1') as g1,
               (select v from smoke where k = 'o5') as o5) s,
       lateral (values
         ('bad_plot', 'invalid plot', format('select public.rent_plot(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.buy_plot(%L, %L, 11)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.sell_plot_to_village(%L, %L, null)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.list_plot(%L, %L, -1, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.buy_listed_plot(%L, %L, 11, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.offer_plot(%L, %L, 0, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.set_sublease(%L, %L, 11, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.rent_sublease(%L, %L, 0, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.abandon_crop(%L, %L, 99)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.prepare_plot(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.apply_fertilizer(%L, %L, 0, %L)', s.room, s.g1, 'fert_urea')),
         ('bad_plot', 'invalid plot', format('select public.soak_seed(%L, %L, 0, %L)', s.room, s.g1, 'seed_nep')),
         ('bad_plot', 'invalid plot', format('select public.sow_seed(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.begin_work(%L, %L, 0, %L)', s.room, s.g1, 'transplant')),
         ('bad_plot', 'invalid plot', format('select public.transplant(%L, %L, 0, 1)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.water(%L, %L, 0, 1)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.spray(%L, %L, 0, %L)', s.room, s.g1, 'spray_insect')),
         ('bad_plot', 'invalid plot', format('select public.pick_snails(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.harvest(%L, %L, 0, 1)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.list_plot(%L, %L, 1, 0)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.list_plot(%L, %L, 1, 5000001)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.set_sublease(%L, %L, 1, 100001)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.offer_plot(%L, %L, 1, null)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.offer_plot(%L, %L, 1, 0)', s.room, s.g1)),
         ('bad_slot', 'invalid slot', format('select public.dry_collect(%L, %L, 0)', s.room, s.g1)),
         ('bad_slot', 'invalid slot', format('select public.dry_collect(%L, %L, 5)', s.room, s.g1)),
         ('bad_slot', 'invalid slot', format('select public.dry_collect(%L, %L, null)', s.room, s.g1)),
         ('bad_water', 'invalid quantity', format('select public.water(%L, %L, 8, 5)', s.room, s.g1)),
         ('bad_water', 'invalid quantity', format('select public.water(%L, %L, 8, 0)', s.room, s.g1)),
         ('bad_water', 'invalid quantity', format('select public.water(%L, %L, 8, null)', s.room, s.g1)),
         ('bad_work', 'invalid work', format('select public.begin_work(%L, %L, 8, %L)', s.room, s.g1, 'dig')),
         ('bad_work', 'invalid work', format('select public.begin_work(%L, %L, 8, null)', s.room, s.g1)),
         ('quality_range', 'invalid quality', format('select public.transplant(%L, %L, 8, %L)', s.room, s.g1, 'NaN')),
         ('quality_range', 'invalid quality', format('select public.transplant(%L, %L, 8, 1.2)', s.room, s.g1)),
         ('quality_range', 'invalid quality', format('select public.transplant(%L, %L, 8, 0.8)', s.room, s.g1)),
         ('quality_range', 'invalid quality', format('select public.harvest(%L, %L, 8, %L)', s.room, s.g1, 'Infinity')),
         ('quality_range', 'invalid quality', format('select public.harvest(%L, %L, 8, null)', s.room, s.g1)),
         ('bad_qty', 'invalid quantity', format('select public.dry_start(%L, %L, %L, 0)', s.room, s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.dry_start(%L, %L, %L, null)', s.room, s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.sell_rice(%L, %L, true, 0)', s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.sell_rice(%L, %L, null, 5)', s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.buy_farm_item(%L, %L, 0)', s.g1, 'fert_urea')),
         ('bad_qty', 'invalid quantity', format('select public.buy_farm_item(%L, %L, 100)', s.g1, 'fert_urea')),
         ('bad_qty', 'invalid quantity', format('select public.buy_item(%L, %L, 500)', s.g1, 'bait_shrimp')),
         ('bad_qty', 'invalid quantity', format('select public.buy_item(%L, %L, 2)', s.g1, 'rod_bamboo')),
         ('foreign_offer', 'offer not found', format('select public.withdraw_offer(%L, %L, %L)', s.room, s.g1, s.o5)),
         ('foreign_offer', 'offer not found', format('select public.decline_offer(%L, %L, %L)', s.room, s.g1, s.o5)),
         ('foreign_offer', 'not your plot', format('select public.accept_offer(%L, %L, %L)', s.room, s.g1, s.o5))
       ) v(code, error, call);

do $$
declare g1 text := (select v from smoke where k = 'g1'); h1 uuid := (select v from smoke where k = 'h1')::uuid;
        h4 uuid := (select v from smoke where k = 'h4')::uuid; h5 uuid := (select v from smoke where k = 'h5')::uuid;
        room uuid := (select v from smoke where k = 'froom')::uuid; o5 uuid := (select v from smoke where k = 'o5')::uuid;
        v_log jsonb; r jsonb; c record; n int := 0;
begin
  update public.anticheat_config set mode = 'log';
  select water_log into v_log from public.crops where room_id = room and plot_no = 8;
  -- log mode: every hard signal is an envelope with strike 0 and the refusal it replaces, logged, nothing changed
  for c in select * from hard_calls loop
    n := n + 1;
    execute c.call into r;
    assert pg_temp.env(r, c.code, 0, c.error), format('%s → %s', c.call, r);
    assert pg_temp.last_outcome(h1) = 'log_only'
       and (select code from public.anticheat_events where account_id = h1 order by id desc limit 1) = c.code, c.call;
  end loop;
  assert n = 48 and (select count(*) from public.anticheat_events where account_id = h1 and outcome = 'log_only') = 48, 'all logged';
  assert (pg_temp.status(h1)).strikes = 0 and (pg_temp.status(h1)).locked_until is null, 'no strike, no lock in log mode';
  assert (select water_log from public.crops where room_id = room and plot_no = 8) = v_log, 'water with delta 5 changed nothing';
  assert (select detail from public.anticheat_events where account_id = h1 and code = 'quality_range' order by id limit 1)
         = '{"plot": 8, "quality": "NaN"}', 'NaN kept as text';
  assert (select detail from public.anticheat_events where account_id = h1 and code = 'foreign_offer' and rpc = 'withdraw_offer')
         = jsonb_build_object('offer_id', o5, 'buyer_id', h5), 'withdraw detail';
  assert (select detail from public.anticheat_events where account_id = h1 and code = 'foreign_offer' and rpc = 'accept_offer')
         = jsonb_build_object('offer_id', o5, 'plot', 1, 'owner_id', h4), 'accept detail';
  assert exists (select 1 from public.land_offers where id = o5) and (select coins from public.wallets where account_id = h1) = 750,
    'nothing changed';

  -- a huge input stays out of the evidence (§8.1): a work or a variety keeps 32 characters, any detail 2 000
  assert pg_temp.env(public.begin_work(room, g1, 8, repeat('w', 1048576)), 'bad_work', 0, 'invalid work'), 'a 1 MB work';
  assert (select detail = jsonb_build_object('plot', 8, 'work', repeat('w', 32)) and octet_length(row_to_json(e)::text) < 2200
            from public.anticheat_events e where account_id = h1 order by id desc limit 1), 'the evidence row stays under 2.2 kB';
  assert pg_temp.env(public.dry_start(room, g1, repeat('v', 100000), 0), 'bad_qty', 0, 'invalid quantity'), 'a long variety';
  assert (select detail = jsonb_build_object('variety', repeat('v', 32), 'kg', 0)
            from public.anticheat_events where account_id = h1 order by id desc limit 1), 'the drying variety is cut';
  assert pg_temp.env(public.sell_rice(g1, repeat('v', 100000), true, 0), 'bad_qty', 0, 'invalid quantity'), 'a long variety';
  assert (select detail = jsonb_build_object('variety', repeat('v', 32), 'kg', 0, 'dry', true)
            from public.anticheat_events where account_id = h1 order by id desc limit 1), 'the depot variety is cut';
  perform public._ac_flag(h1, 'bad_plot', 'water', jsonb_build_object('plot', repeat('9', 5000)), room, 'invalid plot');
  assert (select detail = jsonb_build_object('truncated', true, 'head', left(jsonb_build_object('plot', repeat('9', 5000))::text, 2000))
            from public.anticheat_events where account_id = h1 order by id desc limit 1), 'a long detail keeps its head';

  -- soft kind mismatches (§7.4) and plain refusals of unknown items
  assert pg_temp.env(public.buy_farm_item(g1, 'rod_bamboo', 1), 'kind_mismatch', 0, 'item not available'), 'buy_farm_item kind';
  assert pg_temp.env(public.apply_fertilizer(room, g1, 8, 'seed_nep'), 'kind_mismatch', 0, 'invalid item'), 'fertilizer kind';
  assert pg_temp.env(public.soak_seed(room, g1, 8, 'fert_urea'), 'kind_mismatch', 0, 'invalid item'), 'seed kind';
  assert pg_temp.env(public.spray(room, g1, 8, 'fert_urea'), 'kind_mismatch', 0, 'invalid item'), 'pesticide kind';
  assert (select count(*) from public.anticheat_events where account_id = h1 and outcome = 'soft' and code = 'kind_mismatch') = 4,
    'four soft rows';
  assert pg_temp.err(format('select public.apply_fertilizer(%L, %L, 8, %L)', room, g1, 'no_such_item')) = 'invalid item', 'unknown';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', g1, 'no_such_item')) = 'item not available', 'unknown';

  -- honest calls still work
  perform public.water(room, g1, 8, -1);
  assert (select jsonb_array_length(water_log) from public.crops where room_id = room and plot_no = 8) = 2, 'a real water change';
end $$;

do $$
declare h1 uuid := (select v from smoke where k = 'h1')::uuid; r jsonb; c record;
begin
  -- enforce: every hard signal is strike 1, a strike_1 row and a 5-minute lock (each call starts unlocked)
  update public.anticheat_config set mode = 'enforce';
  for c in select * from hard_calls loop
    update public.anticheat_status set strikes = 0, locked_until = null where account_id = h1;
    execute c.call into r;
    assert pg_temp.env(r, c.code, 1, c.error) and (r->'anticheat'->>'locked_until')::timestamptz = now() + interval '5 minutes',
      format('%s → %s', c.call, r);
    assert pg_temp.last_outcome(h1) = 'strike_1' and (pg_temp.status(h1)).locked_until = now() + interval '5 minutes', c.call;
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = h1 and outcome = 'strike_1') = 48, 'every one struck';
  update public.anticheat_status set strikes = 0, locked_until = null where account_id = h1;
  update public.anticheat_config set mode = 'log';
end $$;

do $$
declare g2 text := (select v from smoke where k = 'g2'); h2 uuid := (select v from smoke where k = 'h2')::uuid;
        g3 text := (select v from smoke where k = 'g3'); h3 uuid := (select v from smoke where k = 'h3')::uuid;
        g4 text := (select v from smoke where k = 'g4'); h4 uuid := (select v from smoke where k = 'h4')::uuid;
        g5 text := (select v from smoke where k = 'g5'); h5 uuid := (select v from smoke where k = 'h5')::uuid;
        room uuid := (select v from smoke where k = 'froom')::uuid; other uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := now(); r jsonb; e jsonb; o5 uuid; call text;
begin
  update public.anticheat_config set mode = 'enforce';
  -- no false positives in enforce (§7.3)
  perform pg_temp.set_coins(h3, 10750);
  perform public._farm_do_rent(room, h3, 9, t);
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, water_log, work, work_started_at)
  values (room, 9, h3, 'short', t - interval '20 hours', t - interval '20 hours', t - interval '18 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '1 hour', 'l', 2)), 'transplant', t - interval '3 seconds')
  on conflict (room_id, plot_no) do nothing;
  r := public.transplant(room, g3, 9, 1);
  assert (select transplant_at = t from public.crops where room_id = room and plot_no = 9), 'transplanted';
  assert pg_temp.err(format('select public.transplant(%L, %L, 9, 1)', room, g3)) = 'too fast', 'a repeated transplant is refused';
  perform public.water(room, g3, 9, 1);
  perform public.water(room, g3, 9, 1);   -- level 3: "Bơm thêm nước (giữ Sâu)"
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at) values (room, 3, h3, 'short', 5, t - interval '25 hours');
  assert pg_temp.err(format('select public.dry_collect(%L, %L, 3)', room, g3)) = 'invalid slot', 'the sweep collected it first';
  update public.field_plots set sale_price = 9000 where room_id = room and plot_no = 1;
  perform pg_temp.set_coins(h3, 20000);
  assert pg_temp.err(format('select public.buy_listed_plot(%L, %L, 1, 8000)', room, g3)) = 'price changed', 'price changed';
  select id into o5 from public.land_offers where room_id = room and buyer_id = h5;
  perform public.join_room((select code from public.rooms where id = other), 'pw', g5);
  assert pg_temp.err(format('select public.withdraw_offer(%L, %L, %L)', other, g5, o5)) = 'offer not found', 'another room';
  assert pg_temp.err(format('select public.accept_offer(%L, %L, %L)', other, g5, o5)) = 'offer expired', 'another room';
  assert pg_temp.err(format('select public.add_queue_item(%L, %L, %L, %L, null, 100)', room, g3, 'short', 'x')) = 'invalid video',
    'a refused queue add';
  assert pg_temp.err(format('select public.register(%L, %L)', 'Ao cá', 'pw123456')) = 'invalid username', 'a refused register';
  assert not exists (select 1 from public.anticheat_events where account_id in (h3, h5) and outcome <> 'soft')
     and not exists (select 1 from public.anticheat_status where account_id in (h3, h5) and locked_until is not null),
    'no hard row, no lock';

  -- a player-to-player sale is a system line about the buyer (R12)
  r := public.buy_listed_plot(room, g5, 1, 9000);
  assert (select system and about_account_id = h5 and account_id is null and username = 'Hợp tác xã'
            from public.chat_messages where room_id = room and body like '[land:1] %'), 'the land line';

  -- enforce: a hard signal is strike 1; the farm RPCs are locked, the reads, chat and the queue are not
  r := public.water(room, g2, 8, 5);
  assert pg_temp.env(r, 'bad_water', 1, 'invalid quantity'), format('strike 1 %s', r);
  foreach call in array array[
    format('select public.water(%L, %L, 8, 1)', room, g2), format('select public.dry_collect(%L, %L, 1)', room, g2),
    format('select public.sell_rice(%L, %L, true, 1)', g2, 'nep'), format('select public.buy_farm_item(%L, %L, 1)', g2, 'fert_urea'),
    format('select public.claim_farm_gift(%L)', g2)] loop
    e := pg_temp.errd(call);
    assert e->>'message' = 'account locked' and e->>'hint' = 'anticheat' and (e->>'detail')::int = 300, format('%s: %s', call, e);
  end loop;
  perform public.field_state(room, g2);
  perform public.touch_room(room, g2);
  perform public.send_chat_message(g2, room, 'vẫn chat được');
  perform public.add_queue_item(room, g2, 'ddddddddddd', 'vẫn gọi bài được', null, 200);
  update public.anticheat_config set mode = 'log';
end $$;

select 'anticheat farm smoke ok' as result;

-- ---------- shared functions (§10.4, R10, R11, R30): the fishing state, the board, the song bonus, the sweep ----------
insert into smoke select 'k' || n, token from generate_series(1, 5) n,
  lateral public.register('ack' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'm' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('k1', 'k2', 'k3', 'k4', 'k5');
insert into smoke select 'sroom', room_id::text from public.create_room('Ruộng quét', 'pw', (select v from smoke where k = 'k1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'sroom')::uuid), 'pw', v)
  from smoke where k in ('k2', 'k3', 'k4', 'k5');

do $$
declare k2 text := (select v from smoke where k = 'k2'); m2 uuid := (select v from smoke where k = 'm2')::uuid; s jsonb;
begin
  -- the fishing state carries the daily cap and the running lock
  s := public.fishing_state(k2);
  assert (s->>'casts_today_left')::int = 300 and s->'day_resets_at' = 'null' and s->'lock' = 'null', format('fresh %s', s);
  insert into public.fishing_profiles (account_id, day_on, day_casts) values (m2, public._vn_today(), 120);
  assert (public.fishing_state(k2)->>'casts_today_left')::int = 180, '180 left';
  update public.fishing_profiles set day_casts = 300 where account_id = m2;
  s := public.fishing_state(k2);
  assert (s->>'casts_today_left')::int = 0
     and (s->>'day_resets_at')::timestamptz = (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh', 'the day is over';
  update public.fishing_profiles set day_on = public._vn_today() - 1 where account_id = m2;
  assert (public.fishing_state(k2)->>'casts_today_left')::int = 300, 'yesterday does not count';
  insert into public.anticheat_status (account_id, locked_until, last_strike_code) values (m2, now() + interval '4 minutes', 'bad_plot');
  s := public.fishing_state(k2);
  assert s->'lock' = jsonb_build_object('until', now() + interval '4 minutes', 'code', 'bad_plot'), format('lock %s', s->'lock');
  update public.anticheat_status set locked_until = now() - interval '1 second' where account_id = m2;
  assert public.fishing_state(k2)->'lock' = 'null', 'the lock ended';
end $$;

do $$
declare k1 text := (select v from smoke where k = 'k1'); m1 uuid := (select v from smoke where k = 'm1')::uuid;
        m2 uuid := (select v from smoke where k = 'm2')::uuid;
        m3 uuid := (select v from smoke where k = 'm3')::uuid; m4 uuid := (select v from smoke where k = 'm4')::uuid;
        m5 uuid := (select v from smoke where k = 'm5')::uuid; room uuid := (select v from smoke where k = 'sroom')::uuid;
        aroot uuid := (select v from smoke where k = 'aroot')::uuid; b jsonb; q uuid; t timestamptz := now();
begin
  -- m3 cheats later; m4 subleases m3's plot; m5 owns plot 3
  insert into public.wallets (account_id, coins) values (m1, 100), (m3, 999999), (m4, 500), (m5, 500)
  on conflict (account_id) do update set coins = excluded.coins;
  insert into public.personal_bests (account_id, species_id, weight_g) values (m3, 'ca_ho', 39000), (m4, 'ca_ho', 12000);
  b := public.fishing_board(room, k1);
  assert b->'records'->0->>'username' = (select username from public.accounts where id = m3)
     and (b->'richest'->0->>'coins')::int = 999999 and (b->>'my_rank')::int = 4, format('before the ban %s', b);

  -- the ban (strike 2 sets these): the board hides m3 and the song bonus skips it (R30)
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (m3, 2, 'pending_wipe', t);
  update public.accounts set is_banned = true where id = m3;
  -- the fish price index averages the others only: (100 + 0 + 500 + 500) / 4, not m3's 999 999 too (R30)
  assert public._room_wealth(room, now()) = 275, format('the index without m3: %s', public._room_wealth(room, now()));
  b := public.fishing_board(room, k1);
  assert b->'records'->0->>'username' = (select username from public.accounts where id = m4)
     and not (b->'richest' @> jsonb_build_array(jsonb_build_object('coins', 999999))) and (b->>'my_rank')::int = 3,
    format('after the ban %s', b);
  insert into public.queue_items (room_id, youtube_video_id, title, duration_seconds, added_by_account_id, added_by_name, position)
  values (room, 'eeeeeeeeeee', 'Bài của m3', 240, m3, 'm3', 1) returning id into q;
  update public.rooms set current_item_id = q where id = room;
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  perform public.advance_queue(room, k1);
  assert not exists (select 1 from public.coin_ledger where account_id = m3 and reason = 'song'), 'no song bonus for a banned account';
  insert into public.queue_items (room_id, youtube_video_id, title, duration_seconds, added_by_account_id, added_by_name, position)
  values (room, 'fffffffffff', 'Bài của m4', 240, m4, 'm4', 2) returning id into q;
  update public.rooms set current_item_id = q where id = room;
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  perform public.advance_queue(room, k1);
  assert exists (select 1 from public.coin_ledger where account_id = m4 and reason = 'song' and delta = 10), 'others still earn it';

  -- the market freeze at the next sweep (R10): offers gone, listing and sublease price cleared, the plot kept
  perform public._field_init(room);
  update public.field_plots set owner_id = m3, owned_at = t - interval '2 days', sale_price = 9000, sublease_price = 300
   where room_id = room and plot_no = 2;
  update public.field_plots set owner_id = m5, owned_at = t - interval '2 days' where room_id = room and plot_no = 3;
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (room, 3, m3, 7000, t - interval '1 hour');
  -- a ban root sets by hand freezes the market too: m2 lists plot 4 and offers on plot 3, then is banned in the Accounts tab
  update public.field_plots set owner_id = m2, owned_at = t - interval '2 days', sale_price = 7000 where room_id = room and plot_no = 4;
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (room, 3, m2, 6000, t - interval '1 hour');
  update public.accounts set is_banned = true where id = m2;
  perform public._field_open(room, t);
  assert not exists (select 1 from public.land_offers where room_id = room and buyer_id = m3), 'the offer is gone';
  assert (select owner_id = m3 and sale_price is null and sublease_price is null from public.field_plots
           where room_id = room and plot_no = 2), 'listing and sublease cleared, the plot kept until the wipe';
  assert not exists (select 1 from public.land_offers where room_id = room and buyer_id = m2)
     and (select owner_id = m2 and sale_price is null from public.field_plots where room_id = room and plot_no = 4),
    'a manual ban: the offer is gone and the listing cleared, the plot kept';

  -- what m3 holds when the owner wipes it: plot 2 subleased to m4, village plot 7 with a crop, a batch, an offer
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until) values
    (room, 2, m4, 'owner', 300, t - interval '1 day', t + interval '3 days'),
    (room, 7, m3, 'village', 250, t - interval '1 day', t + interval '3 days');
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at) values (room, 7, m3, 'nep', t - interval '1 day');
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at) values (room, 1, m3, 'nep', 40, t + interval '1 hour');
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (room, 3, m3, 7500, t - interval '1 minute');
  perform public._ac_wipe(m3, aroot);
  -- the next field call releases it all, without refund; m4's sublease runs on (R11)
  perform public._field_open(room, t);
  assert (select owner_id is null and owned_at is null from public.field_plots where room_id = room and plot_no = 2), 'plot released';
  assert not exists (select 1 from public.coin_ledger where account_id = m3 and reason = 'land_refund'), 'no refund';
  assert exists (select 1 from public.plot_leases where room_id = room and plot_no = 2 and farmer_id = m4), 'the sublease runs on';
  assert not exists (select 1 from public.plot_leases where room_id = room and farmer_id = m3)
     and not exists (select 1 from public.crops where room_id = room and farmer_id = m3)
     and not exists (select 1 from public.drying_slots where room_id = room and account_id = m3)
     and not exists (select 1 from public.land_offers where room_id = room and buyer_id = m3), 'lease, crop, batch and offer gone';
  assert not exists (select 1 from public.rice_stock where account_id = m3), 'no dry rice from the batch';
  assert (select owner_id = m5 from public.field_plots where room_id = room and plot_no = 3), 'innocent land stays';
  perform public._field_open(room, t + interval '3 days');
  assert (select owner_id is null from public.field_plots where room_id = room and plot_no = 2)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 2), 'the village gets it after the lease';
end $$;

select 'anticheat shared functions smoke ok' as result;

-- ---------- admin (§9.5–§9.8, §10.5): the preview, the wipe, the pardon, the ban switch, the mode, the list ----------
insert into smoke select 'n' || n, token from generate_series(1, 6) n,
  lateral public.register('acn' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'p' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('n1', 'n2', 'n3', 'n4', 'n5', 'n6');
insert into smoke select 'aroom', room_id::text from public.create_room('Phòng xử', 'pw', (select v from smoke where k = 'n1'));
insert into smoke select 'aroom2', room_id::text from public.create_room('Phòng xử 2', 'pw', (select v from smoke where k = 'n1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = r)::uuid), 'pw', v)
  from smoke, unnest(array['aroom', 'aroom2']) r where k in ('n2', 'n3', 'n4', 'n5', 'n6');

do $$
declare n1 text := (select v from smoke where k = 'n1'); p2 uuid := (select v from smoke where k = 'p2')::uuid;
        troot text := (select v from smoke where k = 'troot'); aroot uuid := (select v from smoke where k = 'aroot')::uuid;
        call text; r jsonb;
begin
  foreach call in array array[format('select public.admin_anticheat_list(%L)', n1),
                              format('select public.admin_anticheat_account(%L, %L)', n1, p2),
                              format('select public.admin_anticheat_resolve(%L, %L, %L)', n1, p2, 'pardon'),
                              format('select public.admin_anticheat_set_mode(%L, %L)', n1, 'log')] loop
    assert pg_temp.err(call) = 'root role required', call;
  end loop;
  assert pg_temp.err(format('select public.admin_anticheat_set_mode(%L, %L)', troot, 'off')) = 'invalid mode', 'no off mode (R2)';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p2, 'erase')) = 'invalid action', 'action';
  assert not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_ac_case'
                       and has_function_privilege('anon', oid, 'execute')), '_ac_case is private';
  r := public.admin_anticheat_set_mode(troot, 'enforce');
  assert r = jsonb_build_object('mode', 'enforce', 'mode_changed_at', now()), format('set mode %s', r);
  assert (select mode = 'enforce' and mode_changed_by = aroot from public.anticheat_config), 'recorded';
end $$;

do $$
declare n2 text := (select v from smoke where k = 'n2'); p2 uuid := (select v from smoke where k = 'p2')::uuid;
        troot text := (select v from smoke where k = 'troot'); room uuid := (select v from smoke where k = 'aroom')::uuid;
        room2 uuid := (select v from smoke where k = 'aroom2')::uuid; r jsonb; a jsonb; h jsonb; c jsonb;
begin
  -- p2 holds xu, a fish, a record, rice, a catch line and a plot in each room, then strikes twice
  perform pg_temp.set_coins(p2, 1230);
  insert into public.fish (account_id, species_id, weight_g, price) values (p2, 'ca_loc', 900, 54);
  insert into public.personal_bests (account_id, species_id, weight_g) values (p2, 'ca_loc', 900);
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (p2, 'short', 12, 30);
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id) values
    (room, null, 'Ao cá', '[catch:' || p2 || '|ca_ho|39000] 🎣 x', true, p2),
    (room, p2, 'x', 'tin nhắn thường', false, null);
  perform public._field_init(room);
  perform public._field_init(room2);
  update public.field_plots set owner_id = p2, owned_at = now() - interval '1 day' where room_id in (room, room2) and plot_no = 2;
  r := public.water(room, n2, 5, 5);
  assert (r->'anticheat'->>'strike')::int = 1, 'strike 1';
  update public.anticheat_status set locked_until = now() - interval '1 second' where account_id = p2;
  r := public.water(room, n2, 5, 5);
  assert (r->'anticheat'->>'strike')::int = 2 and (r->'anticheat'->>'banned')::boolean, 'strike 2';
  assert pg_temp.err(format('select public.login(%L, %L)', (select username from public.accounts where id = p2), 'pw123456'))
         = 'account banned', 'login refused';

  -- the case, the preview and the evidence, newest first
  a := public.admin_anticheat_account(troot, p2);
  assert a->'case'->>'ban_state' = 'pending_wipe' and (a->'case'->>'active_strikes')::int = 2 and (a->'case'->>'strikes')::int = 2
     and (a->'case'->>'hard_events')::int = 2 and (a->'case'->>'soft_events')::int = 0 and a->'case'->>'last_strike_code' = 'bad_water'
     and a->'case'->'locked_until' = 'null' and (a->'case'->>'is_banned')::boolean, format('case %s', a->'case');
  assert a->'holdings' = public._ac_holdings(p2) and jsonb_array_length(a->'holdings'->'plots') = 2, 'the preview';
  assert jsonb_array_length(a->'events') = 2 and a->'events'->0->>'outcome' = 'strike_2' and a->'events'->1->>'outcome' = 'strike_1'
     and a->'events'->0->'detail' = '{"plot": 5, "delta": 5}' and a->'events'->0->>'rpc' = 'water'
     and a->'events'->0->>'room_id' = room::text and a->'wipes' = '[]', format('events %s', a->'events');

  -- the wipe (§9.6)
  h := public._ac_holdings(p2);
  c := public.admin_anticheat_resolve(troot, p2, 'wipe');
  assert c->>'ban_state' = 'wiped' and (c->>'wiped_at')::timestamptz = now() and c->>'account_id' = p2::text, format('wiped %s', c);
  assert (select snapshot = h from public.anticheat_wipes where account_id = p2), 'the snapshot is the preview';
  assert (select delta = -1230 and balance = 0 from public.coin_ledger where account_id = p2 and reason = 'wipe'), 'ledger';
  assert not exists (select 1 from public.wallets where account_id = p2) and not exists (select 1 from public.fish where account_id = p2)
     and not exists (select 1 from public.personal_bests where account_id = p2)
     and not exists (select 1 from public.rice_stock where account_id = p2), 'data gone';
  assert not exists (select 1 from public.chat_messages where about_account_id = p2)
     and exists (select 1 from public.chat_messages where account_id = p2 and body = 'tin nhắn thường'), 'catch line gone, chat kept';
  a := public.admin_anticheat_account(troot, p2);
  assert a->'wipes'->0->>'wiped_by' = (select username from public.accounts where id = (select v from smoke where k = 'aroot')::uuid)
     and a->'wipes'->0->'snapshot' = h, 'the wipe as the tab shows it';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p2, 'wipe')) = 'not pending', 'wiped once';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, (select v from smoke where k = 'p1'), 'wipe'))
         = 'not pending', 'nothing pending';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, gen_random_uuid(), 'wipe')) = 'not pending',
    'unknown account';
  -- room 1 is swept now; room 2 is not
  perform public._field_open(room, now());
  assert (select owner_id is null from public.field_plots where room_id = room and plot_no = 2)
     and (select owner_id = p2 from public.field_plots where room_id = room2 and plot_no = 2), 'released lazily';
end $$;

-- A later transaction: the pardon, and land bought after it.
do $$
declare p2 uuid := (select v from smoke where k = 'p2')::uuid; troot text := (select v from smoke where k = 'troot');
        room uuid := (select v from smoke where k = 'aroom')::uuid; room2 uuid := (select v from smoke where k = 'aroom2')::uuid;
        c jsonb; l record;
begin
  c := public.admin_anticheat_resolve(troot, p2, 'pardon');
  assert c->'ban_state' = 'null' and not (c->>'is_banned')::boolean and (c->>'active_strikes')::int = 0
     and (c->>'pardoned_at')::timestamptz = now() and c->'wiped_at' <> 'null', format('pardoned %s', c);
  select * into l from public.login((select username from public.accounts where id = p2), 'pw123456');
  assert (public.fishing_state(l.token)->>'coins')::int = 0 and public.fishing_state(l.token)->'fish' = '[]', 'back with zero data (R8)';
  perform pg_temp.set_coins(p2, 801000);
  perform public.buy_plot(room, l.token, 4);
  assert (select owned_at > (select wiped_at from public.anticheat_status where account_id = p2)
            from public.field_plots where room_id = room and plot_no = 4 and owner_id = p2), 'bought after the wipe';
  insert into smoke values ('p2token', l.token);
end $$;

do $$
declare p2 uuid := (select v from smoke where k = 'p2')::uuid; room uuid := (select v from smoke where k = 'aroom')::uuid;
        room2 uuid := (select v from smoke where k = 'aroom2')::uuid;
begin
  perform public._field_open(room, now());
  perform public._field_open(room2, now());
  assert (select owner_id = p2 from public.field_plots where room_id = room and plot_no = 4), 'land bought after the pardon stays (R11)';
  assert (select owner_id is null from public.field_plots where room_id = room2 and plot_no = 2), 'pre-wipe land is still released';
end $$;

do $$
declare n3 text := (select v from smoke where k = 'n3'); p3 uuid := (select v from smoke where k = 'p3')::uuid;
        p4 uuid := (select v from smoke where k = 'p4')::uuid; p5 uuid := (select v from smoke where k = 'p5')::uuid;
        n6 text := (select v from smoke where k = 'n6'); p6 uuid := (select v from smoke where k = 'p6')::uuid;
        troot text := (select v from smoke where k = 'troot'); c jsonb; r jsonb; bad int;
begin
  -- pardon while pending: unbanned, no strike, login works
  perform pg_temp.flag(p3);
  update public.anticheat_status set locked_until = null where account_id = p3;
  perform pg_temp.flag(p3);
  assert (pg_temp.status(p3)).ban_state = 'pending_wipe', 'p3 pending';
  c := public.admin_anticheat_resolve(troot, p3, 'pardon');
  assert c->'ban_state' = 'null' and (c->>'strikes')::int = 0 and not (c->>'is_banned')::boolean and c->'wiped_at' = 'null', 'pardon';
  perform public.login((select username from public.accounts where id = p3), 'pw123456');
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p3, 'pardon')) = 'nothing to pardon', 'twice';
  -- the Accounts tab's unban of an anti-cheat ban is the pardon (R9); a manual ban stays a plain ban
  perform pg_temp.flag(p4);
  update public.anticheat_status set locked_until = null where account_id = p4;
  perform pg_temp.flag(p4);
  perform public.admin_set_ban(troot, p4, false);
  assert not (select is_banned from public.accounts where id = p4)
     and (select ban_state is null and strikes = 0 and pardoned_at = now() from public.anticheat_status where account_id = p4),
    'admin_set_ban false = pardon';
  perform public.admin_set_ban(troot, p5, true);
  assert (select is_banned from public.accounts where id = p5) and not exists (select 1 from public.sessions where account_id = p5)
     and not exists (select 1 from public.anticheat_status where account_id = p5), 'a manual ban';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p5, 'pardon')) = 'nothing to pardon',
    'a manual ban is not the anti-cheat''s';
  perform public.admin_set_ban(troot, p5, false);
  assert not (select is_banned from public.accounts where id = p5), 'a manual unban';
  -- the list: pending wipes first, then running locks, then by the last event
  perform pg_temp.flag(p5);
  update public.anticheat_status set locked_until = null where account_id = p5;
  perform pg_temp.flag(p5);
  r := public.water((select v from smoke where k = 'aroom')::uuid, n6, 5, 5);
  assert (r->'anticheat'->>'strike')::int = 1, 'p6 locked';
  r := public.admin_anticheat_list(troot);
  assert r->>'mode' = 'enforce' and (r->>'server_now')::timestamptz = now() and r->>'mode_changed_at' is not null, 'list header';
  assert exists (select 1 from jsonb_array_elements(r->'cases') x where x->>'account_id' = p6::text
                   and (x->>'locked_until')::timestamptz = now() + interval '5 minutes' and (x->>'active_strikes')::int = 1),
    'the locked case';
  assert (select count(*) from jsonb_object_keys(r->'cases'->0)) = 16, 'sixteen keys a case';
  select count(*) into bad from jsonb_array_elements(r->'cases') with ordinality a(x, i)
    join jsonb_array_elements(r->'cases') with ordinality b(y, j) on j > i
   where ((y->>'ban_state') = 'pending_wipe' and (x->>'ban_state') is distinct from 'pending_wipe')
      or ((x->>'ban_state') is distinct from 'pending_wipe' and (y->>'ban_state') is distinct from 'pending_wipe'
          and x->'locked_until' = 'null' and y->'locked_until' <> 'null');
  assert bad = 0, format('%s cases out of order', bad);
  -- back to log mode: running locks end, bans stay (R6)
  r := public.admin_anticheat_set_mode(troot, 'log');
  assert r->>'mode' = 'log' and (pg_temp.status(p6)).locked_until is null, 'the lock is lifted';
  assert (select is_banned from public.accounts where id = p5) and (pg_temp.status(p5)).ban_state = 'pending_wipe', 'the ban stays';
  -- a pardon lifts the strike, not a ban root set by hand in the Accounts tab
  perform public.admin_set_ban(troot, p6, true);
  c := public.admin_anticheat_resolve(troot, p6, 'pardon');
  assert (c->>'is_banned')::boolean and (c->>'strikes')::int = 0 and (c->>'active_strikes')::int = 0 and c->'ban_state' = 'null',
    format('pardoned, still banned %s', c);
  assert (select is_banned from public.accounts where id = p6), 'the manual ban stays';
end $$;

select 'anticheat admin smoke ok' as result;

\i tests/sql/anticheat-guards.sql
