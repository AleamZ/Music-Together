-- tests/sql/reel-verify-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain
-- (0004 … newest, 0014 before 0013), from the repo root, with the fixture's absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/reel-cases.json -f <this file>
-- It no longer re-runs 0046 with \i: that put 0046's finish_cast back over 0059's (and 0065's). Since 0059 the seed is
-- answered by hook_cast at the bite, not by start_cast, and a won reel needs the server's hook (hooked_at); since 0057
-- a cast claims its cell. Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on

-- ---------- 1. The shared fixtures: _reel_replay = replayReel (tests/unit/game-reel.test.ts) ----------
create temp table fx as select pg_read_file(:'fixtures')::jsonb j;

create or replace function pg_temp.params(c jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('zone_pct', c->'params'->'zonePct', 'difficulty', c->'params'->'difficulty',
                            'min_reel_ms', c->'params'->'minReelMs')
$$;
create or replace function pg_temp.toggles(c jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(c->'toggles') with ordinality t(x, o)
$$;

do $$
declare c jsonb; r jsonb; n integer := 0; caught integer := 0;
begin
  for c in select jsonb_array_elements(j) from fx loop
    r := public._reel_replay(pg_temp.params(c), (c->'params'->>'seed')::bigint, pg_temp.toggles(c));
    assert r = c->'expected', format('%s: sql %s, ts %s', c->>'name', r, c->'expected');
    assert public._reel_input_error(pg_temp.toggles(c), (r->>'ticks')::int) is null or c->>'name' like 'jitter%',
      format('%s: an honest input is refused (%s)', c->>'name', public._reel_input_error(pg_temp.toggles(c), (r->>'ticks')::int));
    n := n + 1;
    if r->>'outcome' = 'caught' then caught := caught + 1; end if;
  end loop;
  assert n >= 10 and caught >= 4 and caught < n, format('fixtures: %s cases, %s caught', n, caught);
  raise notice 'fixtures ok: % cases, % caught', n, caught;
end $$;

-- mulberry32 on u32s: the first outputs for seed 42 (Math.imul semantics: JS gives 2581720956, 1925393290)
do $$
declare r bigint[];
begin
  r := public._reel_rand(42);
  assert r[1] = 2581720956 and r[2] = 1831565855, format('rand(42) = %s', r);
  r := public._reel_rand(r[2]);
  assert r[1] = 1925393290, format('rand 2 = %s', r);
  r := public._reel_rand(4294967295);
  assert r[1] between 0 and 4294967295 and r[2] = 1831565812, format('wraps %s', r);
end $$;

-- ---------- 2. Input validation ----------
do $$
declare burst integer[] := array(select g from generate_series(0, 45) g);                -- 46 flips in 46 ticks
        steady integer[] := array(select g * 2 from generate_series(0, 44) g);           -- 45 flips in 89 ticks: fine
begin
  assert public._reel_input_error('{}', 200) is null, 'no toggles';
  assert public._reel_input_error('{0,10,20}', 200) is null, 'a few';
  assert public._reel_input_error('{0,10,20}', 0) = 'ticks', 'no ticks';
  assert public._reel_input_error('{0,10,20}', 3601) = 'ticks', 'past 60 s';
  assert public._reel_input_error('{0,10,20}', null) = 'ticks', 'null ticks';
  assert public._reel_input_error('{0,20,10}', 200) = 'order', 'unsorted';
  assert public._reel_input_error('{0,10,10}', 200) = 'order', 'twice';
  assert public._reel_input_error('{-1,10}', 200) = 'range', 'negative';
  assert public._reel_input_error('{0,200}', 200) = 'range', 'at the end';
  assert public._reel_input_error('{0,NULL}', 200) = 'range', 'a null';
  assert public._reel_input_error('[2:3]={0,10}', 200) = 'shape', 'lower bound';
  assert public._reel_input_error('{{0,1},{2,3}}', 200) = 'shape', '2-d';
  assert public._reel_input_error(burst, 300) = 'rate', 'a burst';
  assert public._reel_input_error(steady, 300) is null, format('steady %s', public._reel_input_error(steady, 300));
end $$;

-- the longest reel (60 s) replays fast enough for an RPC
do $$
declare t0 timestamptz := clock_timestamp(); r jsonb; ms numeric;
begin
  r := public._reel_replay('{"zone_pct": 90, "difficulty": 100, "min_reel_ms": 60000}', 1,
                           array(select g * 40 from generate_series(0, 89) g));
  ms := extract(epoch from clock_timestamp() - t0) * 1000;
  raise notice 'replay of % ticks: % ms', r->>'ticks', round(ms);
  assert ms < 1500, format('replay too slow: %s ms', ms);
end $$;

-- ---------- 3. start_cast rolls and keeps the seed and the params ----------
create temp table rs (k text primary key, v text);
insert into rs select 't', token from public.register('rv_' || floor(random() * 1e9)::text, 'pw123456');
insert into rs select 'a', public._auth_account(v)::text from rs where k = 't';
insert into rs select 'room', room_id::text from public.create_room('Reel verify', 'pw', (select v from rs where k = 't'));

do $$
declare t text := (select v from rs where k = 't'); a uuid := (select v from rs where k = 'a')::uuid;
        room uuid := (select v from rs where k = 'room')::uuid; c jsonb; row public.casts; d integer[];
begin
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  delete from public.player_pos where account_id = a;
  select array[cc, r] into d from generate_series(0, 79) cc, generate_series(0, 49) r where public._pond_spot(cc, r) = 'dock'
   order by r, cc limit 1;
  c := public.start_cast(room, t, d[1], d[2]);
  assert c->>'cast_id' is not null and not (c ? 'reel_seed'), format('no seed at the cast (0059) %s', c);
  select * into row from public.casts where id = (c->>'cast_id')::uuid;
  assert row.reel_seed between 0 and 4294967295, 'the seed is kept';
  assert row.reel_params = jsonb_build_object('zone_pct', (c->>'zone_pct')::int, 'difficulty', (c->>'difficulty')::int,
                                              'min_reel_ms', (c->>'min_reel_ms')::int), format('params %s / %s', row.reel_params, c);
  -- hook_cast answers it at the bite
  update public.casts set bites = true, bite_at = now() - interval '1 second', expires_at = now() + interval '100 seconds'
   where id = row.id;
  c := public.hook_cast(t, row.id);
  assert c->>'result' = 'hooked' and (c->>'reel_seed')::bigint = row.reel_seed, format('hook %s', c);
  -- a won reel without its input: an old page
  c := public.finish_cast(t, row.id, true);
  assert c->>'result' = 'lost' and c->>'why' = 'outdated' and c->>'message' = 'Cập nhật trang để câu tiếp'
     and c->'anticheat' is null, format('outdated %s', c);
  assert not exists (select 1 from public.anticheat_events where account_id = a), 'an old page is not flagged';
end $$;

-- ---------- 4. finish_cast replays the reel ----------
-- A cast of a fixture's reel, bitten and hooked `ago` seconds ago (0059: the server's hook).
create or replace function pg_temp.cast_of(c jsonb, ago numeric) returns uuid language plpgsql as $$
declare a uuid := (select v from rs where k = 'a')::uuid; room uuid := (select v from rs where k = 'room')::uuid; id uuid;
begin
  delete from public.casts where account_id = a;
  delete from public.fish where account_id = a;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, reel_seed, reel_params,
                            hooked_at)
  values (a, room, 'ca_ro', 100, (c->'params'->>'minReelMs')::int, now() - make_interval(secs => ago),
          now() + interval '1 minute', (c->'params'->>'seed')::bigint, pg_temp.params(c), now() - make_interval(secs => ago))
  returning casts.id into id;
  return id;
end $$;

do $$
declare t text := (select v from rs where k = 't'); a uuid := (select v from rs where k = 'a')::uuid;
        won jsonb := (select x from fx, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'caught' limit 1);
        lost jsonb := (select x from fx, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'escaped' limit 1);
        r jsonb; wt integer; lt integer;
begin
  update public.anticheat_config set mode = 'log';
  wt := (won->'expected'->>'ticks')::int;
  lt := (lost->'expected'->>'ticks')::int;
  -- the honest reel lands the fish
  r := public.finish_cast(t, pg_temp.cast_of(won, 60), true, false, pg_temp.toggles(won), wt);
  assert r->>'result' = 'caught', format('honest %s', r);
  -- a reel that escaped, claimed as caught: mismatch
  r := public.finish_cast(t, pg_temp.cast_of(lost, 60), true, false, pg_temp.toggles(lost), lt);
  assert r->>'result' = 'lost' and r->>'why' = 'reel_invalid' and r->'anticheat'->>'code' = 'reel_mismatch', format('escaped %s', r);
  assert (select detail->'replay'->>'outcome' = 'escaped' and rpc = 'finish_cast' and outcome = 'log_only'
            from public.anticheat_events where account_id = a order by id desc limit 1), 'mismatch evidence';
  -- the right input, the wrong end tick
  r := public.finish_cast(t, pg_temp.cast_of(won, 60), true, false, pg_temp.toggles(won), wt + 1);
  assert r->>'why' = 'reel_invalid' and r->'anticheat'->>'code' = 'reel_mismatch', format('ticks %s', r);
  -- no input at all for a caught claim (a client that just says "caught")
  r := public.finish_cast(t, pg_temp.cast_of(won, 60), true, false, '{}', wt);
  assert r->>'why' = 'reel_invalid' and r->'anticheat'->>'code' = 'reel_mismatch', format('empty %s', r);
  -- input no hand makes
  r := public.finish_cast(t, pg_temp.cast_of(won, 60), true, false, '{5,3}', wt);
  assert r->>'why' = 'reel_invalid' and r->'anticheat'->>'code' = 'reel_bad_input', format('bad %s', r);
  assert (select detail->>'error' = 'order' from public.anticheat_events where account_id = a order by id desc limit 1), 'bad evidence';
  -- the honest input, reported sooner than its ticks took
  r := public.finish_cast(t, pg_temp.cast_of(won, wt / 60.0 * 0.5), true, false, pg_temp.toggles(won), wt);
  assert r->>'why' = 'too_early' and r->'anticheat'->>'code' = 'reel_too_fast', format('fast %s', r);
  assert (select (detail->>'ticks')::int = wt from public.anticheat_events where account_id = a order by id desc limit 1), 'fast evidence';
  -- a lost reel stays the client's word (and is never flagged)
  r := public.finish_cast(t, pg_temp.cast_of(won, 60), false);
  assert r->>'why' = 'gave_up' and r->'anticheat' is null, format('gave up %s', r);
  -- enforce: a mismatch is a hard strike
  update public.anticheat_config set mode = 'enforce';
  r := public.finish_cast(t, pg_temp.cast_of(lost, 60), true, false, pg_temp.toggles(lost), lt);
  assert (r->'anticheat'->>'strike')::int = 1, format('strike %s', r);
  update public.anticheat_config set mode = 'log';
  update public.anticheat_status set strikes = 0, locked_until = null where account_id = a;
end $$;

select 'reel-verify smoke ok' as result;
