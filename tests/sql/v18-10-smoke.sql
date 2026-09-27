-- tests/sql/v18-10-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0031 (see the plan),
-- from the repo root: it re-runs 0033 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0033_heat_swim.sql
\i supabase/migrations/0033_heat_swim.sql
reset client_min_messages;

create temp table hx (k text primary key, v text);
insert into hx select 'tok', token from public.register('hx_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into hx select 'tok2', token from public.register('hx_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into hx select 'room', room_id::text from public.create_room('Nắng', 'pw', (select v from hx where k = 'tok'));
select public.join_room((select code from public.rooms where id = (select v from hx where k = 'room')::uuid), 'pw',
                        (select v from hx where k = 'tok2'));

-- 1) pure rules and the shade
do $$ begin
  assert public._heat_hot('clear', true, 35) and not public._heat_hot('clear', true, 34.9), 'hot at 35';
  assert not public._heat_hot('clear', false, 40) and not public._heat_hot('cloudy', true, 40), 'clear day only';
  assert not public._heat_hot('clear', true, null), 'unknown temp';
  assert public._cramp_chance(true, false) = 0.10 and public._cramp_chance(true, true) = 0.005
     and public._cramp_chance(false, false) = 0 and public._cramp_chance(null, null) = 0, 'cramp chances';
  assert public._in_shade('market', 140, 176) and public._in_shade('pond', 576, 308), 'porches';
  assert not public._in_shade('pond', 100, 300) and not public._in_shade('hall', 320, 200), 'outdoors';
  assert public._in_shade(null, 1, 1) and public._in_shade('road', 1, 1) and public._in_shade('pond', null, 1), 'unknown';
end $$;

-- 2) the temperature: stored, validated, optional (an older client)
do $$ declare r uuid := (select v from hx where k = 'room')::uuid; t text := (select v from hx where k = 'tok'); j jsonb;
        ok boolean := false; begin
  begin perform public.set_room_weather(r, t, 0, true, null, null, 0, 5, 61); exception when others then ok := sqlerrm = 'invalid weather'; end;
  assert ok, 'temp > 60 refused';
  j := public.set_room_weather(r, t, 0, true, null, null, 0, 5, 36.5);
  assert (j->>'temp_c')::numeric = 36.5 and j->>'kind' = 'clear', 'temp stored';
  update public.room_weather set updated_at = now() - interval '11 minutes' where room_id = r;
  j := public.set_room_weather(p_room_id => r, p_session_token => t, p_code => 0, p_is_day => true, p_sunrise => null,
                               p_sunset => null, p_rain_mm => 0, p_wind_kmh => 5);
  assert j->>'temp_c' is null, 'no temp from an older client';
  update public.room_weather set temp_c = 36.5 where room_id = r;
end $$;

-- 3) heat accrual: outdoors 10 min continuously → shocked, thirst ×2; shade clears it; a gap restarts it
do $$ declare r uuid := (select v from hx where k = 'room')::uuid; t text := (select v from hx where k = 'tok');
        a uuid := public._auth_account((select v from hx where k = 'tok')); j jsonb; th numeric; begin
  j := public.vitals_tick(t, r, 'pond', 100, 300);
  assert not (j->'heat'->>'shocked')::boolean and (select outdoor_since from public.heat_state where account_id = a) is not null, 'counting';
  update public.heat_state set outdoor_since = now() - interval '601 seconds', last_seen = now() - interval '30 seconds' where account_id = a;
  j := public.vitals_tick(t, r, 'pond', 100, 300);
  assert (j->'heat'->>'shocked')::boolean, 'shocked after 10 min';
  -- thirst: 60 s at clear (1.3) × 2
  update public.vitals set thirst = 50, last_tick = now() - interval '60 seconds' where account_id = a;
  update public.heat_state set last_seen = now() - interval '30 seconds' where account_id = a;
  j := public.vitals_tick(t, r, 'pond', 100, 300);
  th := (j->>'thirst')::numeric;
  assert abs((50 - th) - 60 * 100.0 / 57600 * 1.3 * 2) < 0.01, 'thirst x2: ' || th;
  j := public.vitals_tick(t, r, 'market', 140, 176);
  assert not (j->'heat'->>'shocked')::boolean and (j->'heat'->>'outdoor_s')::int = 0, 'shade clears';
  j := public.vitals_tick(t, r, 'pond', 100, 300);
  update public.heat_state set outdoor_since = now() - interval '601 seconds', last_seen = now() - interval '200 seconds' where account_id = a;
  j := public.vitals_tick(t, r, 'pond', 100, 300);
  assert not (j->'heat'->>'shocked')::boolean, 'a heartbeat gap restarts';
  j := public.vitals_tick(t, r);
  assert (select outdoor_since from public.heat_state where account_id = a) is null, 'no position = shade';
end $$;

-- 4) warm-up: a shore cell, 10 s apart, 5 min validity; bad cells refused
do $$ declare r uuid := (select v from hx where k = 'room')::uuid; t text := (select v from hx where k = 'tok');
        a uuid := public._auth_account((select v from hx where k = 'tok')); j jsonb; ok boolean := false; vc int; vr int; begin
  select g1, g2 into vc, vr from generate_series(0, 79) g1, generate_series(0, 49) g2 where public._pond_spot(g1, g2) = 'shore' limit 1;
  insert into hx values ('col', vc::text), ('row', vr::text);
  begin perform public.warm_up_start(r, t, 2, 30); exception when others then ok := sqlerrm = 'bad spot'; end;
  assert ok, 'far grass refused';
  perform public.warm_up_start(r, t, vc, vr);
  ok := false;
  begin perform public.warm_up_finish(r, t); exception when others then ok := sqlerrm = 'warm up'; end;
  assert ok, 'too early';
  perform public.warm_up_start(r, t, vc, vr);
  update public.heat_state set warm_started_at = now() - interval '10 seconds' where account_id = a;
  j := public.warm_up_finish(r, t);
  assert (j->>'warm_until_ms')::bigint > (j->>'server_now_ms')::bigint + 299000, 'warm 5 min';
end $$;

-- 5) the cramp roll: about 10% heat-shocked, never cool; leave_water gives 10 min immunity
do $$ declare r uuid := (select v from hx where k = 'room')::uuid; t text := (select v from hx where k = 'tok');
        a uuid := public._auth_account((select v from hx where k = 'tok')); j jsonb; n int := 0;
        vc int := (select v from hx where k = 'col')::int; vr int := (select v from hx where k = 'row')::int; ok boolean := false; begin
  begin perform public.leave_water(r, t); exception when others then ok := sqlerrm = 'not swimming'; end;
  assert ok, 'leave dry refused';
  update public.heat_state set warm_until = null where account_id = a;
  for i in 1..1000 loop
    update public.heat_state set shocked = true, swimming = false, cramp_until = null where account_id = a;
    j := public.jump_in(r, t, vc, vr);
    if (j->>'cramp')::boolean then n := n + 1; end if;
  end loop;
  assert n between 60 and 145, 'about 10%: ' || n;
  n := 0;
  for i in 1..300 loop
    update public.heat_state set shocked = false, swimming = false, cramp_until = null where account_id = a;
    j := public.jump_in(r, t, vc, vr);
    if (j->>'cramp')::boolean then n := n + 1; end if;
  end loop;
  assert n = 0, 'never cool';
  assert (j->>'swimming')::boolean, 'swimming';
  j := public.leave_water(r, t);
  assert (j->>'immune_until_ms')::bigint > (j->>'server_now_ms')::bigint + 599000 and not (j->>'swimming')::boolean, 'immune';
  update public.heat_state set outdoor_since = now() - interval '700 seconds', last_seen = now() where account_id = a;
  j := public.vitals_tick(t, r, 'pond', 100, 300);
  assert not (j->'heat'->>'shocked')::boolean and (j->'heat'->>'outdoor_s')::int = 0, 'immunity stops the count';
end $$;

-- 6) rescue by another member; drowning without one → the faint
do $$ declare r uuid := (select v from hx where k = 'room')::uuid; t text := (select v from hx where k = 'tok');
        t2 text := (select v from hx where k = 'tok2');
        a uuid := public._auth_account((select v from hx where k = 'tok')); j jsonb; ok boolean := false;
        vc int := (select v from hx where k = 'col')::int; vr int := (select v from hx where k = 'row')::int; begin
  update public.heat_state set swimming = true, swim_room = r, cramp_until = now() + interval '10 seconds', cramp_room = r
   where account_id = a;
  begin perform public.leave_water(r, t); exception when others then ok := sqlerrm = 'cramp'; end;
  assert ok, 'no climbing out while cramping';
  ok := false;
  begin perform public.rescue_swimmer(r, t, a, vc, vr); exception when others then ok := sqlerrm = 'bad victim'; end;
  assert ok, 'no self-rescue';
  ok := false;
  begin perform public.rescue_swimmer(r, t2, a, 2, 30); exception when others then ok := sqlerrm = 'bad spot'; end;
  assert ok, 'rescuer off the pond';
  j := public.rescue_swimmer(r, t2, a, 37, 10);                              -- swimming out to them
  assert (select cramp_until is null and not swimming and immune_until > now() from public.heat_state where account_id = a), 'rescued';
  ok := false;
  begin perform public.rescue_swimmer(r, t2, a, vc, vr); exception when others then ok := sqlerrm = 'not cramping'; end;
  assert ok, 'nothing to rescue';
  -- drowning
  update public.heat_state set swimming = true, swim_room = r, cramp_until = now() - interval '1 second', cramp_room = r
   where account_id = a;
  j := public.vitals_tick(t, r, 'pond', 300, 100);
  assert (j->>'fainted_until_ms') is not null and not (j->'heat'->>'swimming')::boolean
     and j->'heat'->>'cramp_until_ms' is null, 'drowned: fainted';
  ok := false;
  begin perform public.jump_in(r, t, vc, vr); exception when others then ok := sqlerrm = 'fainted'; end;
  assert ok, 'fainted cannot jump';
end $$;

-- 7) a stale swim ends when the tick reports a spot out of the water; privileges
do $$ declare r uuid := (select v from hx where k = 'room')::uuid; t text := (select v from hx where k = 'tok');
        a uuid := public._auth_account((select v from hx where k = 'tok')); begin
  update public.vitals set fainted_until = null, hunger = 80, thirst = 80 where account_id = a;
  update public.heat_state set swimming = true, cramp_until = null where account_id = a;
  perform public.vitals_tick(t, r, 'hall', 300, 200);
  assert not (select swimming from public.heat_state where account_id = a), 'stale swim ended';
  assert not has_function_privilege('anon', 'public._heat_resolve(uuid)', 'execute'), '_heat_resolve private';
  assert not has_function_privilege('anon', 'public._in_shade(text, integer, integer)', 'execute'), '_in_shade private';
  assert has_function_privilege('anon', 'public.jump_in(uuid, text, integer, integer)', 'execute'), 'jump_in public';
  assert has_function_privilege('anon', 'public.vitals_tick(text, uuid, text, integer, integer)', 'execute'), 'tick public';
  assert not has_table_privilege('anon', 'public.heat_state', 'select'), 'heat_state private';
  assert (select count(*) from pg_proc where proname = 'vitals_tick') = 1, 'one vitals_tick';
  assert (select count(*) from pg_proc where proname = 'set_room_weather') = 1, 'one set_room_weather';
end $$;

select 'v18.10 smoke ok';
