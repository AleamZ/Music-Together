-- tests/sql/anticheat-v2-part3-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0067,
-- from the repo root, with the fixtures' absolute paths:
--   psql -v harvest=<repo>/tests/fixtures/harvest-cases.json -v crab=<repo>/tests/fixtures/crab-cases.json -f …
-- It re-runs 0064–0067 with \i (re-runnable), so it may follow any smoke that re-ran an older migration of theirs.
-- Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0064_client_build.sql
\i supabase/migrations/0065_ac_stats.sql
\i supabase/migrations/0066_pet_song.sql
\i supabase/migrations/0067_pvp_lag.sql
\i supabase/migrations/0064_client_build.sql
\i supabase/migrations/0065_ac_stats.sql
\i supabase/migrations/0066_pet_song.sql
\i supabase/migrations/0067_pvp_lag.sql
reset client_min_messages;

create temp table hx as select pg_read_file(:'harvest')::jsonb j;
create temp table cx as select pg_read_file(:'crab')::jsonb j;
create or replace function pg_temp.ints(v jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;
create or replace function pg_temp.build(b text) returns void language sql as $$
  select set_config('request.headers', case when b is null then '' else json_build_object('x-client-info', b)::text end, false)
$$;
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_hint text; v_detail text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text, v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_msg || '|' || coalesce(v_hint, '') || '|' || coalesce(v_detail, '');
end $$;

create temp table p3 (k text primary key, v text);
insert into p3 values ('vp', substr(md5(random()::text), 1, 3));   -- a video id prefix of this run (3 + 8 = 11)
insert into p3 select 'root', token from public.register('p3root_' || floor(random() * 1e9)::text, 'pw123456');
insert into p3 select 't', token from public.register('p3a_' || floor(random() * 1e9)::text, 'pw123456');
insert into p3 select 't2', token from public.register('p3b_' || floor(random() * 1e9)::text, 'pw123456');
insert into p3 select 't3', token from public.register('p3c_' || floor(random() * 1e9)::text, 'pw123456');
insert into p3 select 'a' || substr(k, 2), public._auth_account(v)::text from p3 where k in ('t', 't2', 't3');
insert into p3 select 'a1', v from p3 where k = 'a';
insert into p3 select 'room', room_id::text from public.create_room('Phần ba', 'pw', (select v from p3 where k = 't'));
insert into p3 select 'code', code from public.rooms where id = (select v from p3 where k = 'room')::uuid;
update public.accounts set is_root = true where id = public._auth_account((select v from p3 where k = 'root'));
update public.anticheat_config set mode = 'log', min_client_build = 0;
select public.join_room((select v from p3 where k = 'code'), 'pw', (select v from p3 where k = 't2'));
select public.join_room((select v from p3 where k = 'code'), 'pw', (select v from p3 where k = 't3'));

-- ---------- 1. The minimum build (0064) ----------
do $$
declare t text := (select v from p3 where k = 't'); root text := (select v from p3 where k = 'root'); j jsonb; e text;
begin
  perform pg_temp.build('music-together/202609281530-abc1234');
  assert public._client_build() = 202609281530, format('build %s', public._client_build());
  perform pg_temp.build('music-together/202609281530');
  assert public._client_build() = 202609281530, 'a bare stamp';
  perform pg_temp.build('music-together/abc1234');
  assert public._client_build() = 0, 'a bare commit';
  perform pg_temp.build('music-together/dev');
  assert public._client_build() = 0, 'dev';
  perform pg_temp.build(null);
  assert public._client_build() = 0, 'no header';
  -- off: any page plays
  e := pg_temp.err(format('select public.claim_daily(%L)', t));
  assert e = 'no error', e;
  -- the switch is root's
  e := pg_temp.err(format('select public.admin_anticheat_config(%L, %L)', t, '{"min_client_build": 202609280000}'));
  assert e like '%root%' or e like '%not authorized%' or e like '%42501%' or e <> 'no error', format('non-root %s', e);
  j := public.admin_anticheat_config(root, '{"min_client_build": 202609280000}');
  assert (j->>'min_client_build')::bigint = 202609280000 and (j->>'auto_blacklist')::boolean and (j->>'auto_blacklist_hard')::int = 8, format('config %s', j);
  e := pg_temp.err(format('select public.admin_anticheat_config(%L, %L)', root, '{"min_client_build": "x"}'));
  assert e like 'invalid config|%', e;
  e := pg_temp.err(format('select public.admin_anticheat_config(%L, %L)', root, '{"auto_blacklist_hard": 1}'));
  assert e like 'invalid config|%', e;
  -- an older page is refused by every guarded RPC, a newer one plays
  perform pg_temp.build('music-together/202609271200-old0000');
  e := pg_temp.err(format('select public.claim_daily(%L)', t));
  assert e = 'client outdated|build|202609280000', e;
  perform pg_temp.build(null);
  e := pg_temp.err(format('select public.claim_daily(%L)', t));
  assert e = 'client outdated|build|202609280000', format('no header %s', e);
  perform pg_temp.build('music-together/202609281530-new0000');
  e := pg_temp.err(format('select public.claim_daily(%L)', t));
  assert e = 'no error', e;
  -- the lock still comes first
  insert into public.anticheat_status (account_id, locked_until) values (public._auth_account(t), now() + interval '1 minute')
  on conflict (account_id) do update set locked_until = excluded.locked_until;
  perform pg_temp.build('music-together/202609271200-old0000');
  e := pg_temp.err(format('select public.claim_daily(%L)', t));
  assert e like 'account locked|anticheat|%', e;
  update public.anticheat_status set locked_until = null where account_id = public._auth_account(t);
  perform public.admin_anticheat_config(root, '{"min_client_build": 0}');
  perform pg_temp.build(null);
  raise notice 'build ok';
end $$;

-- ---------- 2. The pet's heartbeat (0066 A) ----------
do $$
declare t text := (select v from p3 where k = 't'); t2 text := (select v from p3 where k = 't2');
        a uuid := (select v from p3 where k = 'a')::uuid; room uuid := (select v from p3 where k = 'room')::uuid;
        other uuid; pid bigint; j jsonb; c0 integer; e text;
begin
  insert into public.pets (account_id, species, variant, name, fullness, happy) values (a, 'soc', 'nau', 'Sóc', 90, 90)
  returning id into pid;
  insert into public.pet_owner (account_id, active_pet) values (a, pid)
  on conflict (account_id) do update set active_pet = pid, forage_at = null, forage_today = 0;
  insert into public.wallets (account_id, coins) values (a, 0) on conflict (account_id) do nothing;
  delete from public.player_pos where account_id = a;
  delete from public.heat_state where account_id = a;
  -- no heartbeat yet
  j := public.pet_tick(t, room);
  assert (j->>'found')::int = 0 and j->>'idle' = 'no_heartbeat', format('no beat %s', j);
  -- an old heartbeat
  insert into public.player_pos (account_id, map, x, y, at) values (a, 'hall', 612, 300, now() - interval '2 minutes');
  j := public.pet_tick(t, room);
  assert (j->>'found')::int = 0 and j->>'idle' = 'no_heartbeat', format('old beat %s', j);
  -- a live one, in a room I belong to: the sóc forages
  update public.player_pos set at = now() - interval '30 seconds' where account_id = a;
  select coins into c0 from public.wallets where account_id = a;
  j := public.pet_tick(t, room);
  assert (j->>'found')::int between 5 and 30 and j->'idle' is null, format('live %s', j);
  assert (select coins from public.wallets where account_id = a) = c0 + (j->>'found')::int, 'paid';
  -- vitals_tick's heartbeat counts too
  update public.pet_owner set forage_at = null where account_id = a;
  update public.player_pos set at = now() - interval '10 minutes' where account_id = a;
  perform public._heat_row(a);
  update public.heat_state set last_seen = now() where account_id = a;
  j := public.pet_tick(t, room);
  assert (j->>'found')::int > 0, format('vitals beat %s', j);
  -- a room I do not belong to
  update public.pet_owner set forage_at = null where account_id = a;
  other := (select room_id from public.create_room('Khác', 'pw', t2));
  j := public.pet_tick(t, other);
  assert (j->>'found')::int = 0 and j->>'idle' = 'not_member', format('not member %s', j);
  j := public.pet_tick(t, null);
  assert j->>'idle' = 'not_member', 'no room';
  -- the old signature never pays
  j := public.pet_tick(t);
  assert (j->>'found')::int = 0 and (j->>'outdated')::boolean, format('old %s', j);
  -- the lock gate
  insert into public.anticheat_status (account_id, locked_until) values (a, now() + interval '1 minute')
  on conflict (account_id) do update set locked_until = excluded.locked_until;
  e := pg_temp.err(format('select public.pet_tick(%L, %L)', t, room));
  assert e like 'account locked|anticheat|%', e;
  e := pg_temp.err(format('select public.pet_tick(%L)', t));
  assert e like 'account locked|anticheat|%', e;
  update public.anticheat_status set locked_until = null where account_id = a;
  -- the heartbeat runs the statistics job lazily
  update public.ac_stats_state set run_at = null;
  perform public.pet_tick(t, room);
  assert (select run_at > now() - interval '1 minute' from public.ac_stats_state), 'the job ran';
  update public.ac_stats_state set run_at = now() - interval '5 minutes';
  perform public.pet_tick(t, room);
  assert (select run_at < now() - interval '4 minutes' from public.ac_stats_state), 'not again within 15 minutes';
  raise notice 'pet ok';
end $$;

-- ---------- 3. The song bonus (0066 B, C) ----------
-- a song of p_dur claimed seconds by p_tok, on air: began p_wall s ago, at timeline position p_line s; then advanced.
create or replace function pg_temp.play(p_tok text, p_video text, p_dur integer, p_wall numeric, p_line numeric) returns integer
language plpgsql as $$
declare room uuid := (select v from p3 where k = 'room')::uuid; dj text := (select v from p3 where k = 't');
        acc uuid := public._auth_account(p_tok); q uuid; c0 integer; c1 integer;
begin
  update public.rooms set current_item_id = null where id = room;
  q := public.add_queue_item(room, p_tok, (select v from p3 where k = 'vp') || p_video, 'Bài ' || p_video, null, p_dur);
  update public.rooms set current_item_id = q where id = room;
  update public.rooms set item_began_at = now() - make_interval(secs => p_wall), is_playing = true,
                          started_at = now() - make_interval(secs => p_line), paused_elapsed_ms = 0 where id = room;
  update public.wallets set bonus_on = null, bonus_count = 0 where account_id = acc;
  c0 := coalesce((select coins from public.wallets where account_id = acc), 0);
  perform public.advance_queue(room, dj);
  c1 := coalesce((select coins from public.wallets where account_id = acc), 0);
  return c1 - c0;
end $$;

do $$
declare t text := (select v from p3 where k = 't'); t2 text := (select v from p3 where k = 't2'); t3 text := (select v from p3 where k = 't3');
        a uuid := (select v from p3 where k = 'a')::uuid; room uuid := (select v from p3 where k = 'room')::uuid;
        root text := (select v from p3 where k = 'root'); n integer;
begin
  update public.rooms set dj_member_id = (select id from public.members where room_id = room and account_id = a) where id = room;
  insert into public.wallets (account_id, coins) values (a, 0) on conflict (account_id) do nothing;
  perform pg_temp.build('music-together/202609281530-abc1234');
  -- honest: 200 s claimed, 180 s on air
  assert pg_temp.play(t, 'A0000001', 200, 180, 180) = 10, 'honest';
  assert (select client_build from public.queue_items where youtube_video_id = (select v from p3 where k = 'vp') || 'A0000001' order by created_at desc limit 1) is null
      or true, 'the row is gone after the advance';
  assert (select duration_s from public.video_durations where video_id = (select v from p3 where k = 'vp') || 'A0000001' and account_id = a) = 200, 'claim kept';
  -- not long enough: 140 s of a 200 s song
  assert pg_temp.play(t, 'A0000002', 200, 140, 140) = 0, '70 %';
  -- a short claim for a long video: 60 s claimed, it ran on 100 s — soft, unpaid
  assert pg_temp.play(t, 'A0000003', 60, 100, 100) = 0, 'short claim';
  assert exists (select 1 from public.anticheat_events where account_id = a and code = 'song_duration_short' and outcome = 'soft'), 'short flag';
  -- the same short claim advanced after 70 s: paid (≥ 60 s and ≥ 75 %)
  assert pg_temp.play(t, 'A0000004', 60, 70, 70) = 10, 'a real 1-minute song';
  -- under a minute on air is never paid, whatever the claim
  assert pg_temp.play(t, 'A0000005', 60, 50, 50) = 0, 'under 60 s';
  -- a seek forward (or a forged started_at): the wall clock caps it
  assert pg_temp.play(t, 'A0000006', 200, 50, 190) = 0, 'seek';
  -- a pause: the timeline caps it
  update public.rooms set current_item_id = null where id = room;
  assert pg_temp.play(t, 'A0000007', 200, 190, 40) = 0, 'paused early';
  -- the others' claims: two other accounts say 300 s, a 60 s claim is a lie (soft, unpaid)
  perform public.add_queue_item(room, t2, (select v from p3 where k = 'vp') || 'B0000001', 'x', null, 300);
  perform public.add_queue_item(room, t3, (select v from p3 where k = 'vp') || 'B0000001', 'x', null, 302);
  assert pg_temp.play(t, 'B0000001', 60, 100, 100) = 0, 'mismatch';
  assert exists (select 1 from public.anticheat_events where account_id = a and code = 'song_duration_mismatch'
                   and (detail->>'peers_s')::numeric = 301), 'mismatch flag';
  -- an honest claim of it needs 75 % of the others' length too
  assert pg_temp.play(t, 'B0000001', 298, 200, 200) = 0, '200 of 301';
  assert pg_temp.play(t, 'B0000001', 298, 230, 230) = 10, '230 of 301';
  -- one other claim is not enough to judge
  perform public.add_queue_item(room, t2, (select v from p3 where k = 'vp') || 'C0000001', 'x', null, 300);
  assert pg_temp.play(t, 'C0000001', 100, 90, 90) = 10, 'one peer';
  -- the minimum build: a song queued from an older page earns nothing
  perform public.admin_anticheat_config(root, '{"min_client_build": 202609290000}');
  assert pg_temp.play(t, 'A0000008', 200, 180, 180) = 0, 'old build';
  perform pg_temp.build('music-together/202609300000-new0000');
  assert pg_temp.play(t, 'A0000009', 200, 180, 180) = 10, 'new build';
  perform public.admin_anticheat_config(root, '{"min_client_build": 0}');
  perform pg_temp.build(null);
  select count(*) into n from public.coin_ledger where account_id = a and reason = 'song';
  assert n = 5, format('%s song rows', n);
  delete from public.queue_items where room_id = room;
  update public.rooms set current_item_id = null where id = room;
  raise notice 'song ok';
end $$;

-- ---------- 4. The farm's timing (0065 B) ----------
do $$
declare c jsonb; r jsonb; tm jsonb; n integer := 0; ex integer := 0; g integer[]; h integer; tk integer; seed bigint;
begin
  for c in select jsonb_array_elements(j) from hx loop
    r := public._harvest_replay((c->>'seed')::bigint, pg_temp.ints(c->'toggles'));
    tm := public._harvest_timing((c->>'seed')::bigint, pg_temp.ints(c->'toggles'));
    assert (tm->>'exact')::int <= (tm->>'cuts')::int and (tm->>'cuts')::int <= 8, format('%s: %s', c->>'name', tm);
    assert r->>'outcome' <> 'pass' or (tm->>'cuts')::int = 8, format('%s: a pass has 8 cuts (%s)', c->>'name', tm);
    assert 2 * (tm->>'exact')::int <= (r->>'score2')::int, format('%s: an exact cut scores 2 (%s, %s)', c->>'name', tm, r);
    n := n + 1;
    ex := ex + (tm->>'exact')::int;
  end loop;
  assert n >= 20, format('%s harvest cases', n);
  n := 0;
  for c in select jsonb_array_elements(j) from cx loop
    r := public._crab_replay((c->>'seed')::bigint, pg_temp.ints(c->'grabs'), (c->>'ticks')::int);
    tm := public._crab_timing((c->>'seed')::bigint, pg_temp.ints(c->'grabs'), (c->>'ticks')::int);
    assert (tm->>'hits')::int = (r->>'hits')::int and (tm->>'exact')::int <= (tm->>'hits')::int, format('%s: %s / %s', c->>'name', tm, r);
    n := n + 1;
  end loop;
  -- a grab on the first open tick of each try, found by trying every tick: 3 exact hits
  seed := 424242;
  g := '{}';
  h := 0;
  for tk in 0 .. 3000 loop
    r := public._crab_replay(seed, g || tk, tk + 1);
    if (r->>'hits')::int > h then g := g || tk; h := h + 1; end if;
    exit when h = 3;
  end loop;
  r := public._crab_replay(seed, g, 7200);
  tm := public._crab_timing(seed, g, (r->>'ticks')::int);
  assert (r->>'hits')::int = 3 and (tm->>'exact')::int = 3, format('first open ticks %s %s %s', g, r, tm);
  -- one tick later on each is a hit but not exact (each try starts a tick later than the one before it ended)
  tm := public._crab_timing(seed, array[g[1] + 1, g[2] + 2, g[3] + 3], 7200);
  assert (tm->>'hits')::int = 3 and (tm->>'exact')::int = 0, format('a tick later %s', tm);
  raise notice 'farm timing ok: % harvest exact cuts in the fixtures', ex;
end $$;

-- the RPCs: a harvest round of 7+ exact cuts is soft; the 5th in 24 h is hard and cuts nothing
create temp table fm (k text primary key, v text);
insert into fm select 't', token from public.register('p3fm_' || floor(random() * 1e9)::text, 'pw123456');
insert into fm select 'a', public._auth_account(v)::text from fm where k = 't';
insert into fm select 'room', room_id::text from public.create_room('Đồng phần ba', 'pw', (select v from fm where k = 't'));
do $$
declare a uuid := (select v from fm where k = 'a')::uuid; room uuid := (select v from fm where k = 'room')::uuid;
begin
  perform public._field_open(room, now());
  insert into public.wallets (account_id, coins) values (a, 100000) on conflict (account_id) do update set coins = 100000;
  perform public._farm_do_rent(room, a, 5, now() - interval '1 hour');
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
  values (room, 5, a, 'nep', now() - interval '64 hours', now() - interval '63 hours', now() - interval '60 hours',
          now() - interval '50 hours', jsonb_build_array(jsonb_build_object('t', now() - interval '64 hours', 'l', 3),
                                                          jsonb_build_object('t', now() - interval '5 hours', 'l', 1)));
  insert into public.inventory (account_id, item_id, qty) values (a, 'tool_sickle', 1)
  on conflict (account_id, item_id) do update set qty = excluded.qty;
  insert into public.vitals (account_id) values (a) on conflict do nothing;
  update public.vitals set hunger = 90, thirst = 90, last_tick = now() where account_id = a;
  delete from public.player_pos where account_id = a;
end $$;
do $$
declare t text := (select v from fm where k = 't'); a uuid := (select v from fm where k = 'a')::uuid;
        room uuid := (select v from fm where k = 'room')::uuid; c jsonb; j jsonb; p0 integer;
begin
  -- a pass fixture whose cuts are exact (a generated, perfect round)
  select x into c from hx, jsonb_array_elements(hx.j) x
   where x->'expected'->>'outcome' = 'pass'
     and (public._harvest_timing((x->>'seed')::bigint, pg_temp.ints(x->'toggles'))->>'exact')::int >= 7 limit 1;
  assert c is not null, 'an exact fixture';
  update public.player_pos set at = now() - interval '5 minutes' where account_id = a;
  perform public.begin_work(room, t, 5, 'harvest');
  update public.crops set work_seed = (c->>'seed')::bigint, work_started_at = now() - interval '30 seconds' where room_id = room and plot_no = 5;
  j := public.harvest_part(room, t, 5, pg_temp.ints(c->'toggles'), (c->'expected'->>'ticks')::int, true);
  assert (j->'harvest_part'->>'parts')::int = 1 and j->'anticheat' is null, format('soft only %s', j);
  assert (select count(*) from public.anticheat_events where account_id = a and code = 'harvest_timing' and outcome = 'soft') = 1, 'soft';
  assert (select plays = 1 and wins = 1 and exact = 1 from public.ac_play_stats where account_id = a and game = 'harvest'), 'recorded';
  -- the 5th within 24 h
  insert into public.anticheat_events (account_id, username, code, outcome, rpc)
  select a, 'x', 'harvest_timing', 'soft', 'harvest_part' from generate_series(1, 3);
  select harvested_parts into p0 from public.crops where room_id = room and plot_no = 5;
  update public.player_pos set at = now() - interval '5 minutes' where account_id = a;
  perform public.begin_work(room, t, 5, 'harvest');
  update public.crops set work_seed = (c->>'seed')::bigint, work_started_at = now() - interval '30 seconds' where room_id = room and plot_no = 5;
  j := public.harvest_part(room, t, 5, pg_temp.ints(c->'toggles'), (c->'expected'->>'ticks')::int, true);
  assert j->'anticheat'->>'code' = 'harvest_timing_repeat' and j->'harvest_part' is null, format('hard %s', j->'anticheat');
  assert (select harvested_parts from public.crops where room_id = room and plot_no = 5) = p0, 'nothing cut';
  assert (select outcome from public.anticheat_events where account_id = a and code = 'harvest_timing_repeat') = 'log_only', 'hard';
  raise notice 'harvest timing rpc ok';
end $$;

-- ---------- 5. The statistics job and the admin list (0065 D, F) ----------
create temp table pop (i integer primary key, acc uuid);
do $$
declare i integer; acc uuid; tok text;
begin
  for i in 1 .. 8 loop
    select account_id into acc from public.register('p3pop_' || i || '_' || floor(random() * 1e9)::text, 'pw123456');
    insert into pop values (i, acc);
  end loop;
end $$;
do $$
declare cheat uuid := (select acc from pop where i = 1); root text := (select v from p3 where k = 'root'); r jsonb; j jsonb;
        x jsonb;
begin
  delete from public.ac_stat_flags;
  -- a run of this smoke before this one: its players leave the window
  update public.coin_ledger set created_at = created_at - interval '3 days' where ref = 'p3';
  delete from public.ac_play_stats where account_id in (select id from public.accounts where username like 'p3pop\_%');
  -- 7 honest players: 20 harvest rounds a day for 3 days, 30 % won, 10 % exact; one with 60 rounds, all won and exact
  insert into public.ac_play_stats (account_id, day, game, plays, wins, exact)
  select p.acc, public._vn_today() - d, 'harvest', 20, 6, 2 from pop p, generate_series(0, 2) d where p.i > 1;
  insert into public.ac_play_stats (account_id, day, game, plays, wins, exact)
  select cheat, public._vn_today() - d, 'harvest', 20, 20, 20 from generate_series(0, 2) d;
  -- income: 7 earners of 1 000 xu of fish; one of 60 000 over 21 distinct hours
  insert into public.coin_ledger (account_id, delta, balance, reason, ref, created_at)
  select p.acc, 1000, 1000, 'sell', 'p3', now() - interval '2 hours' from pop p where p.i > 1;
  insert into public.coin_ledger (account_id, delta, balance, reason, ref, created_at)
  select cheat, 3000, 3000, 'sell', 'p3', now() - make_interval(hours => hh) - interval '5 minutes' from generate_series(0, 19) hh;
  r := public._ac_stats_run();
  assert exists (select 1 from public.ac_stat_flags where account_id = cheat and kind = 'stat_win_rate' and key = 'harvest'), format('win rate %s', r);
  assert exists (select 1 from public.ac_stat_flags where account_id = cheat and kind = 'stat_exact_rate' and key = 'harvest'), 'exact rate';
  assert exists (select 1 from public.ac_stat_flags where account_id = cheat and kind = 'stat_earnings' and key = 'sell'
                   and value = 60000 and baseline <= 20000), 'earnings';
  assert exists (select 1 from public.ac_stat_flags where account_id = cheat and kind = 'stat_marathon' and value = 20), 'marathon';
  assert not exists (select 1 from public.ac_stat_flags f join pop p on p.acc = f.account_id where p.i > 1), 'the honest ones';
  assert (select count(*) from public.anticheat_events where account_id = cheat and code = 'stat_outlier' and outcome = 'soft') = 4, 'evidence';
  -- a second run: the flags count again, no new evidence the same day
  perform public._ac_stats_run();
  assert (select hits from public.ac_stat_flags where account_id = cheat and kind = 'stat_win_rate') = 2, 'hits';
  assert (select count(*) from public.anticheat_events where account_id = cheat and code = 'stat_outlier') = 4, 'once a day';
  -- the admin list
  j := public.admin_anticheat_stats(root);
  select e into x from jsonb_array_elements(j->'accounts') e where (e->>'account_id')::uuid = cheat;
  assert x is not null and jsonb_array_length(x->'flags') = 4 and not (x->>'blacklisted')::boolean, format('listed %s', x);
  assert (select e->>'plays' from jsonb_array_elements(x->'games') e where e->>'game' = 'harvest') = '60', format('games %s', x->'games');
  assert (x->'income'->>'sell')::int = 60000, format('income %s', x->'income');
  assert j->'config'->>'min_client_build' = '0' and j->>'run_at' is not null, format('config %s', j->'config');
  -- blacklist by hand, and off again
  j := public.admin_blacklist_set(root, cheat, true, 'p3 test');
  assert (j->>'blacklisted')::boolean and (select note from public.blacklisted_accounts where account_id = cheat) = 'p3 test', 'on';
  j := public.admin_anticheat_stats(root);
  assert (select (e->>'blacklisted')::boolean from jsonb_array_elements(j->'accounts') e where (e->>'account_id')::uuid = cheat), 'shown';
  j := public.admin_blacklist_set(root, cheat, false);
  assert not (j->>'blacklisted')::boolean and (select blacklist_cleared_at > now() - interval '1 minute' from public.anticheat_status where account_id = cheat), 'off';
  -- reviewed: off the list
  j := public.admin_stat_review(root, cheat);
  assert (j->>'reviewed')::int = 4, format('reviewed %s', j);
  j := public.admin_anticheat_stats(root);
  assert not exists (select 1 from jsonb_array_elements(j->'accounts') e where (e->>'account_id')::uuid = cheat), 'gone';
  -- root only
  assert pg_temp.err(format('select public.admin_anticheat_stats(%L)', (select v from p3 where k = 't'))) <> 'no error', 'root only';
  assert pg_temp.err(format('select public.admin_blacklist_set(%L, %L, true)', (select v from p3 where k = 't'), cheat)) <> 'no error', 'root only 2';
  j := public.admin_anticheat_stats_run(root);
  assert j->'accounts' is not null, 'run';
  raise notice 'stats ok';
end $$;

-- ---------- 6. The auto-blacklist (0065 C) ----------
do $$
declare vic uuid := (select acc from pop where i = 2); ro uuid := public._auth_account((select p3.v from p3 where k = 'root'));
        root text := (select p3.v from p3 where k = 'root'); i integer;
begin
  delete from public.blacklisted_accounts where account_id in (vic, ro);
  -- 7 hard events yesterday: not yet
  for i in 1 .. 7 loop
    perform public._ac_flag(vic, 'net_mismatch', 'net_haul', '{}'::jsonb, null, null, true);
  end loop;
  update public.anticheat_events set created_at = now() - interval '1 day' where account_id = vic and code = 'net_mismatch';
  assert not exists (select 1 from public.blacklisted_accounts where account_id = vic), '7';
  -- the 8th today (two Vietnam days): blacklisted
  perform public._ac_flag(vic, 'net_mismatch', 'net_haul', '{}'::jsonb, null, null, true);
  assert (select note like 'auto %' from public.blacklisted_accounts where account_id = vic), 'auto';
  assert exists (select 1 from public.anticheat_events where account_id = vic and code = 'auto_blacklist' and outcome = 'soft'), 'logged';
  -- soft events never count
  perform public._ac_flag(ro, 'x', 'y', '{}'::jsonb, null, null, false);
  -- root is exempt
  for i in 1 .. 9 loop
    perform public._ac_flag(ro, 'net_mismatch', 'net_haul', '{}'::jsonb, null, null, true);
  end loop;
  update public.anticheat_events set created_at = now() - interval '1 day' where account_id = ro and id in
    (select id from public.anticheat_events where account_id = ro order by id limit 4);
  perform public._ac_flag(ro, 'net_mismatch', 'net_haul', '{}'::jsonb, null, null, true);
  assert not exists (select 1 from public.blacklisted_accounts where account_id = ro), 'root';
  -- unblacklisted by hand: only later hard events count
  perform public.admin_blacklist_set(root, vic, false);
  perform public._ac_flag(vic, 'net_mismatch', 'net_haul', '{}'::jsonb, null, null, true);
  assert not exists (select 1 from public.blacklisted_accounts where account_id = vic), 'cleared';
  -- switched off: nothing
  perform public.admin_anticheat_config(root, '{"auto_blacklist": false}');
  update public.anticheat_status set blacklist_cleared_at = null where account_id = vic;
  perform public._ac_flag(vic, 'net_mismatch', 'net_haul', '{}'::jsonb, null, null, true);
  assert not exists (select 1 from public.blacklisted_accounts where account_id = vic), 'off';
  -- the job catches up once it is on again
  perform public.admin_anticheat_config(root, '{"auto_blacklist": true}');
  perform public._ac_stats_run();
  assert exists (select 1 from public.blacklisted_accounts where account_id = vic), 'the job';
  delete from public.blacklisted_accounts where account_id = vic;
  raise notice 'auto-blacklist ok';
end $$;

-- ---------- 7. PvP: the server's lag and the look-ahead (0067) ----------
-- a live ring match between t and t2, frame 0 p_ago seconds back
create or replace function pg_temp.ring(p_ago numeric) returns uuid language plpgsql as $$
declare a1 uuid := (select v from p3 where k = 'a')::uuid; a2 uuid := (select v from p3 where k = 'a2')::uuid;
        st public.martial_styles; pa jsonb; pr jsonb; mid uuid;
begin
  select * into st from public.martial_styles order by sort limit 1;
  update public.fight_matches set status = 'void' where status = 'live' and (p1 in (a1, a2) or p2 in (a1, a2));
  pa := jsonb_build_object('style', st.sort, 'rank', 1, 'movesMask', 3, 'hpPct', 100, 'bot', 0, 'en0', 0, 'atk', st.atk,
                           'def', st.def, 'walk', st.walk, 'jump', st.jump, 'energy', st.energy);
  pr := jsonb_build_object('seed', 777, 'rounds', 3, 'maxRounds', 5, 'p1', pa, 'p2', pa);
  insert into public.fight_matches (kind, p1, p2, params, started_at, sim)
  values ('pvp', a1, a2, pr, now() - make_interval(secs => p_ago), public._fx_new(pr)) returning id into mid;
  update public.fight_matches set sim_hash = public._fx_hash(sim) where id = mid;
  insert into public.fight_logs (match_id, side, account_id) values (mid, 1, a1), (mid, 2, a2);
  return mid;
end $$;

-- the stall blame is the server's: the side whose frames arrive late, whatever the other one claims
do $$
declare t text := (select v from p3 where k = 't'); t2 text := (select v from p3 where k = 't2'); mid uuid; j jsonb; k integer;
begin
  mid := pg_temp.ring(12);
  for k in 0 .. 9 loop
    -- side 1 on time, claiming a huge stall against side 2
    update public.fight_matches set started_at = now() - make_interval(secs => (k * 60 + 60) / 60.0) where id = mid;
    j := public.fight_push(t, mid, k * 60, '{0,60}', null, null, null, null, 5000);
    -- side 2 a second and a half late
    update public.fight_matches set started_at = now() - make_interval(secs => (k * 60 + 60 + 90) / 60.0) where id = mid;
    j := public.fight_push(t2, mid, k * 60, '{0,60}', null, null, null, null, 0);
  end loop;
  assert (select lag_n = 10 and late_frames = 0 and stall_frames = 50000 from public.fight_logs where match_id = mid and side = 1),
    format('side 1 %s', (select row_to_json(l) from public.fight_logs l where match_id = mid and side = 1));
  assert (select lag_n = 10 and late_frames = 600 and lag_max >= 90 from public.fight_logs where match_id = mid and side = 2),
    format('side 2 %s', (select row_to_json(l) from public.fight_logs l where match_id = mid and side = 2));
  perform public._fx_settle(mid, 1::smallint, 'decision');
  assert (select blamed from public.fight_logs where match_id = mid and side = 2), 'the late side';
  assert not (select blamed from public.fight_logs where match_id = mid and side = 1), 'not the claimed one';
  raise notice 'lag ok';
end $$;

-- the look-ahead: side 2 blocks 2 frames after every attack start of side 1 — hard, and side 2 loses
do $$
declare t text := (select v from p3 where k = 't'); t2 text := (select v from p3 where k = 't2');
        a2 uuid := (select v from p3 where k = 'a2')::uuid; mid uuid; j jsonb; m integer[] := public._fx_moves(); s integer[];
        a integer[] := '{}'; b integer[] := '{}'; f integer; blk integer := -100; starts integer := 0; k integer; n integer := 2400;
        hard boolean := false;
begin
  mid := pg_temp.ring(60);
  s := (select sim from public.fight_matches where id = mid);
  -- side 1 jabs (LP) for 2 frames every 30; side 2 holds block (BL) for 3 frames starting 2 frames after each attack start
  for f in 0 .. n - 1 loop
    a := a || case when f % 30 < 2 then 16 else 0 end;
    b := b || case when f - blk between 0 and 2 then 256 else 0 end;
    s := public._fx_step_bots(s, a[f + 1], b[f + 1], m);
    if (s[49 + 7] = 9 or s[49 + 7] = 10) and s[49 + 8] = 1 then blk := f + 2; starts := starts + 1; end if;
    exit when s[1 + 1] = 3;
  end loop;
  n := cardinality(a);
  assert starts > 30, format('only %s attack starts', starts);
  for k in 0 .. (n - 1) / 300 loop
    j := public.fight_push(t, mid, k * 300, public._fx_runs_encode(a[k * 300 + 1 : least(n, k * 300 + 300)]), null, null, null, null, 0);
    j := public.fight_push(t2, mid, k * 300, public._fx_runs_encode(b[k * 300 + 1 : least(n, k * 300 + 300)]), null, null, null, null, 0);
    if j->'anticheat'->>'code' = 'fight_lookahead' then hard := true; exit; end if;
  end loop;
  assert hard, format('no look-ahead flag: %s', (select rx from public.fight_logs where match_id = mid and side = 2));
  assert (select rx[2] > 24 and rx[4] = 1 from public.fight_logs where match_id = mid and side = 2), 'counted';
  assert (select status = 'done' and winner = 1 and end_reason = 'forfeit' from public.fight_matches where id = mid), 'side 2 lost';
  assert (select outcome from public.anticheat_events where account_id = a2 and code = 'fight_lookahead') = 'log_only', 'hard';
  assert (select jsonb_array_length(detail->'lag') = 2 from public.anticheat_events where account_id = a2 and code = 'fight_lookahead'), 'lag evidence';
  raise notice 'look-ahead ok: % attack starts, rx %', starts, (select rx from public.fight_logs where match_id = mid and side = 2);
end $$;

-- a player who blocks on a rhythm of its own is never flagged
do $$
declare t text := (select v from p3 where k = 't'); t2 text := (select v from p3 where k = 't2'); mid uuid; j jsonb;
        a integer[]; b integer[]; k integer; n integer := 2400;
begin
  mid := pg_temp.ring(60);
  a := array(select case when f % 30 < 2 then 16 else 0 end from generate_series(0, n - 1) f);
  b := array(select case when f % 23 < 3 then 256 else 0 end from generate_series(0, n - 1) f);
  for k in 0 .. (n - 1) / 300 loop
    j := public.fight_push(t, mid, k * 300, public._fx_runs_encode(a[k * 300 + 1 : k * 300 + 300]), null, null, null, null, 0);
    j := public.fight_push(t2, mid, k * 300, public._fx_runs_encode(b[k * 300 + 1 : k * 300 + 300]), null, null, null, null, 0);
    assert j->'anticheat' is null or j->'anticheat'->>'code' <> 'fight_lookahead', format('flagged %s', j->'anticheat');
  end loop;
  assert (select rx[4] = 0 from public.fight_logs where match_id = mid and side = 2), 'not flagged';
  raise notice 'rhythm ok: rx %', (select rx from public.fight_logs where match_id = mid and side = 2);
  update public.fight_matches set status = 'void' where id = mid;
end $$;

-- ---------- 8. Privileges ----------
do $$
declare f text;
begin
  foreach f in array array['_client_build()', '_ac_config_json()', '_ac_stat(uuid,text,integer,integer,integer)',
    '_harvest_timing(bigint,integer[])', '_crab_timing(bigint,integer[],integer)', '_ac_auto_blacklist(uuid)',
    '_ac_stats_run()', '_ac_stats_maybe()', '_ac_stat_flag(uuid,text,text,numeric,numeric,integer,jsonb)', '_ac_games()',
    '_video_peer_s(text,uuid)', '_queue_stamp()', '_fx_react(integer[],integer,integer,integer,integer)',
    '_xidach_start(uuid,timestamptz,integer[])', '_xidach_due(uuid,timestamptz,integer[])'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), f;
  end loop;
  foreach f in array array['admin_anticheat_config(text,jsonb)', 'admin_anticheat_stats(text)', 'admin_anticheat_stats_run(text)',
    'admin_blacklist_set(text,uuid,boolean,text)', 'admin_stat_review(text,uuid)', 'pet_tick(text,uuid)', 'pet_tick(text)'] loop
    assert has_function_privilege('anon', 'public.' || f, 'execute'), f;
  end loop;
  foreach f in array array['ac_play_stats', 'ac_stat_flags', 'ac_stats_state', 'video_durations'] loop
    assert not has_table_privilege('anon', 'public.' || f, 'select'), f;
  end loop;
  raise notice 'privileges ok';
end $$;

select 'anticheat-v2 part 3 smoke ok' as result;
