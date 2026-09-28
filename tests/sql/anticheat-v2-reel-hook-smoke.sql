-- tests/sql/anticheat-v2-reel-hook-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0059,
-- from the repo root, with the reel fixtures' absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/reel-cases.json -f tests/sql/anticheat-v2-reel-hook-smoke.sql
-- It re-runs 0059 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql. Time passing is
-- simulated by moving the cast's bite_at / hooked_at back (each DO block is one transaction: now() stands still).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0059_reel_hook.sql
\i supabase/migrations/0059_reel_hook.sql
reset client_min_messages;

create temp table fx as select pg_read_file(:'fixtures')::jsonb j;
create or replace function pg_temp.params(c jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('zone_pct', c->'params'->'zonePct', 'difficulty', c->'params'->'difficulty',
                            'min_reel_ms', c->'params'->'minReelMs')
$$;
create or replace function pg_temp.toggles(c jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(c->'toggles') with ordinality t(x, o)
$$;

-- ---------- 1. The timing statistics (the same cases as tests/unit/anticheat-v2-part2.test.ts) ----------
do $$
declare t jsonb;
begin
  t := public._reel_timing(array(select g * 10 from generate_series(0, 11) g));
  assert t = '{"n": 12, "fast": 0, "var": 0}'::jsonb and public._reel_timing_suspect(t), format('a metronome %s', t);
  t := public._reel_timing('{0,1,30,31,60,62,90,91,120,121}');
  assert (t->>'n')::int = 10 and (t->>'fast')::int = 5 and public._reel_timing_suspect(t), format('flicks %s', t);
  t := public._reel_timing('{0,9,21,28,43,50,66,71,90,97,113,121}');
  assert (t->>'n')::int = 12 and (t->>'fast')::int = 0 and (t->>'var')::numeric = 20.7273 and not public._reel_timing_suspect(t),
    format('a hand %s', t);
  t := public._reel_timing('{}');
  assert t = '{"n": 0, "fast": 0, "var": 0}'::jsonb and not public._reel_timing_suspect(t), format('none %s', t);
  raise notice 'timing ok';
end $$;

-- ---------- 2. The flow ----------
create temp table rh (k text primary key, v text);
insert into rh select 't', token from public.register('rh_' || floor(random() * 1e9)::text, 'pw123456');
insert into rh select 'a', public._auth_account(v)::text from rh where k = 't';
insert into rh select 'room', room_id::text from public.create_room('Reel hook', 'pw', (select v from rh where k = 't'));
update public.anticheat_config set mode = 'log';

-- a dock cell of the pond
create or replace function pg_temp.dock() returns integer[] language sql stable as $$
  select array[c, r] from generate_series(0, 79) c, generate_series(0, 49) r where public._pond_spot(c, r) = 'dock'
   order by r, c limit 1
$$;
-- a cast of a fixture's reel (or of the given params and seed), bitten `ago` seconds back, hooked `hooked` seconds back
create or replace function pg_temp.cast_of(p_params jsonb, p_seed bigint, ago numeric, hooked numeric, big boolean default false)
returns uuid language plpgsql as $$
declare a uuid := (select v from rh where k = 'a')::uuid; room uuid := (select v from rh where k = 'room')::uuid; id uuid;
begin
  delete from public.casts where account_id = a;
  delete from public.fish where account_id = a;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at, reel_seed, reel_params,
                            big, hooked_at)
  values (a, room, 'ca_ro', 100, (p_params->>'min_reel_ms')::int, now() - make_interval(secs => ago),
          now() - make_interval(secs => ago) + interval '1.5 seconds' + interval '90 seconds', p_seed, p_params, big,
          case when hooked is not null then now() - make_interval(secs => hooked) end)
  returning casts.id into id;
  return id;
end $$;

do $$
declare t text := (select v from rh where k = 't'); a uuid := (select v from rh where k = 'a')::uuid;
        room uuid := (select v from rh where k = 'room')::uuid; c jsonb; h jsonb; row public.casts; d integer[] := pg_temp.dock();
begin
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  delete from public.player_pos where account_id = a;
  c := public.start_cast(room, t, d[1], d[2]);
  assert c->>'cast_id' is not null and not (c ? 'reel_seed'), format('no seed at the cast %s', c);
  assert c ? 'abandoned' and c->'abandoned' = 'null'::jsonb, format('nothing abandoned %s', c);
  select * into row from public.casts where id = (c->>'cast_id')::uuid;
  assert row.reel_seed is not null and row.hooked_at is null, 'kept, not hooked';
  update public.casts set bites = true where id = row.id;
  -- before the bite: refused, soft, the cast stays
  h := public.hook_cast(t, row.id);
  assert h->>'why' = 'too_early' and h->'anticheat'->>'code' = 'reel_early_hook' and (h->'anticheat'->>'strike')::int = 0
     and not (h ? 'reel_seed'), format('early %s', h);
  assert exists (select 1 from public.casts where id = row.id and hooked_at is null), 'the cast stays';
  -- in the window: hooked, with the seed; a retry answers the same
  update public.casts set bite_at = now() - interval '0.5 seconds' where id = row.id;
  h := public.hook_cast(t, row.id);
  assert h->>'result' = 'hooked' and (h->>'reel_seed')::bigint = row.reel_seed, format('hooked %s', h);
  assert (select hooked_at = now() from public.casts where id = row.id), 'hooked_at';
  h := public.hook_cast(t, row.id);
  assert h->>'result' = 'hooked' and (h->>'reel_seed')::bigint = row.reel_seed, format('retry %s', h);
  -- late: missed; nothing bites: no_bite
  update public.casts set hooked_at = null, bite_at = now() - interval '10 seconds',
         expires_at = now() - interval '10 seconds' + interval '91.5 seconds' where id = row.id;
  h := public.hook_cast(t, row.id);
  assert h->>'why' = 'missed', format('late %s', h);
  update public.casts set bites = false where id = row.id;
  h := public.hook_cast(t, row.id);
  assert h->>'why' = 'no_bite', format('no bite %s', h);
  raise notice 'hook ok';
end $$;

-- ---------- 3. finish_cast: the server's hook ----------
do $$
declare t text := (select v from rh where k = 't'); a uuid := (select v from rh where k = 'a')::uuid;
        won jsonb := (select x from fx, jsonb_array_elements(j) x where x->'expected'->>'outcome' = 'caught' limit 1);
        r jsonb; wt integer;
begin
  wt := (won->'expected'->>'ticks')::int;
  -- hooked a minute ago: the honest reel lands
  r := public.finish_cast(t, pg_temp.cast_of(pg_temp.params(won), (won->'params'->>'seed')::bigint, 61, 60), true, false,
                          pg_temp.toggles(won), wt);
  assert r->>'result' = 'caught', format('honest %s', r);
  -- never hooked: the same input is refused, hard
  r := public.finish_cast(t, pg_temp.cast_of(pg_temp.params(won), (won->'params'->>'seed')::bigint, 61, null), true, true,
                          pg_temp.toggles(won), wt);
  assert r->>'why' = 'reel_invalid' and r->'anticheat'->>'code' = 'reel_unhooked', format('unhooked %s', r);
  -- hooked just now: the gate counts from the hook, not the bite
  r := public.finish_cast(t, pg_temp.cast_of(pg_temp.params(won), (won->'params'->>'seed')::bigint, 61, 0.1), true, false,
                          pg_temp.toggles(won), wt);
  assert r->>'why' = 'too_early' and r->'anticheat'->>'code' = 'reel_too_fast', format('from the hook %s', r);
  -- a big fish hooked and given up pulls me in, whatever p_hooked says
  r := public.finish_cast(t, pg_temp.cast_of(pg_temp.params(won), 1, 5, 4, true), false, false);
  assert r->>'why' = 'overboard', format('overboard %s', r);
  -- not hooked: a plain give-up, whatever p_hooked says
  r := public.finish_cast(t, pg_temp.cast_of(pg_temp.params(won), 1, 5, null, true), false, true);
  assert r->>'why' = 'gave_up', format('gave up %s', r);
  raise notice 'finish ok';
end $$;

-- ---------- 4. A metronome that lands fish: soft four times, the 5th voids the catch ----------
do $$
declare t text := (select v from rh where k = 't'); a uuid := (select v from rh where k = 'a')::uuid;
        p jsonb := '{"zone_pct": 90, "difficulty": 0, "min_reel_ms": 2000}'; tg integer[]; seed bigint; rep jsonb; r jsonb;
        n0 bigint; k integer;
begin
  for s in 1 .. 200 loop
    for per in 6 .. 16 loop
      tg := array(select g * per from generate_series(0, 60) g);
      rep := public._reel_replay(p, s, tg);
      if rep->>'outcome' = 'caught' then
        tg := array(select x from unnest(tg) x where x < (rep->>'ticks')::int);
        if cardinality(tg) >= 12 then seed := s; exit; end if;
      end if;
    end loop;
    exit when seed is not null;
  end loop;
  assert seed is not null, 'a metronome that lands a fish';
  assert public._reel_timing_suspect(public._reel_timing(tg)), 'suspect';
  delete from public.anticheat_events where account_id = a and code like 'reel_timing%';
  for k in 1 .. 4 loop
    r := public.finish_cast(t, pg_temp.cast_of(p, seed, 61, 60), true, false, tg, (rep->>'ticks')::int);
    assert r->>'result' = 'caught', format('soft %s: %s', k, r);
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = a and code = 'reel_timing' and outcome = 'soft') = 4, 'four soft';
  r := public.finish_cast(t, pg_temp.cast_of(p, seed, 61, 60), true, false, tg, (rep->>'ticks')::int);
  assert r->>'why' = 'reel_invalid' and r->'anticheat'->>'code' = 'reel_timing_repeat', format('the 5th %s', r);
  raise notice 'timing flags ok';
end $$;

-- ---------- 5. A hooked cast replaced by a new one is given up ----------
do $$
declare t text := (select v from rh where k = 't'); a uuid := (select v from rh where k = 'a')::uuid;
        room uuid := (select v from rh where k = 'room')::uuid; c jsonb; d integer[] := pg_temp.dock(); h0 numeric;
begin
  update public.vitals set hunger = 100, thirst = 100, fainted_until = null where account_id = a;
  perform pg_temp.cast_of('{"zone_pct": 25, "difficulty": 10, "min_reel_ms": 2000}', 5, 5, 4, true);
  h0 := (select hunger from public.vitals where account_id = a);
  c := public.start_cast(room, t, d[1], d[2]);
  assert c->'abandoned'->>'big' = 'true' and (c->'abandoned'->>'hunger')::int = 10, format('abandoned big %s', c);
  assert (select hunger from public.vitals where account_id = a) < h0 - 9, 'the hunger is taken';
  perform pg_temp.cast_of('{"zone_pct": 25, "difficulty": 10, "min_reel_ms": 2000}', 5, 5, 4, false);
  c := public.start_cast(room, t, d[1], d[2]);
  assert c->'abandoned'->>'big' = 'false' and (c->'abandoned'->>'hunger')::int = 0, format('abandoned small %s', c);
  c := public.start_cast(room, t, d[1], d[2]);                                        -- not hooked: nothing to settle
  assert c->'abandoned' = 'null'::jsonb, format('not hooked %s', c);
  raise notice 'abandon ok';
end $$;

select 'anticheat-v2 reel hook smoke ok';
