-- tests/sql/world-p3-smoke.sql — 0089 (the unified world, P3: vehicles ride the world's roads). Run as the superuser on
-- the throwaway cluster after the full chain and unified-world-smoke.sql, from the repo root. It re-runs 0089 twice with
-- \i. Every check is an ASSERT; the first failure stops psql. It sets the flag on for its own checks and back off.
--   1. speed_mul (derived from trip_ms, ≤ 3), the new columns, privileges.
--   2. Flag off: _pos_road_s is 0057's value (road seconds), skip_trip charges as before, pos_report_w stores the ride.
--   3. Flag on: on foot 260 px/s; riding an owned vehicle 260 × speed_mul; a vehicle not owned is on foot; a ride stored
--      from the last report covers a later claim; a lift near a fresh driver rides at the driver's speed, far or stale
--      not; skip_trip refused.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0089_world_p3.sql
\i supabase/migrations/0089_world_p3.sql
reset client_min_messages;
update public.app_flags set enabled = false where key = 'unified_world';

create temp table px (k text primary key, v text);
insert into px select 'ta', token from public.register('p3_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into px select 'a', public._auth_account(v)::text from px where k = 'ta';
insert into px select 'td', token from public.register('p3_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into px select 'd', public._auth_account(v)::text from px where k = 'td';
update public.anticheat_config set mode = 'log';

create or replace function pg_temp.put(p_who text, p_map text, p_x integer, p_y integer, p_ago numeric, p_ride text default null)
returns void
language sql as $$
  insert into public.player_pos (account_id, map, x, y, at, skip_at, bad_since, bad_count, tab, tabs, ride, ride_at)
  values ((select v from px where k = p_who)::uuid, p_map, p_x, p_y, now() - make_interval(secs => p_ago), null, null, 0, null,
          '{}', p_ride, case when p_ride is null then null else now() - make_interval(secs => p_ago) end)
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at,
    skip_at = null, bad_since = null, bad_count = 0, tab = null, tabs = '{}', ride = excluded.ride, ride_at = excluded.ride_at
$$;
create or replace function pg_temp.pos(p_who text) returns text language sql as $$
  select map || ':' || x || ',' || y || coalesce('/' || ride, '')
    from public.player_pos where account_id = (select v from px where k = p_who)::uuid
$$;

-- ---------- 1. Speed, columns, privileges ----------
do $$
begin
  assert (select jsonb_object_agg(id, speed_mul) from public.vehicle_catalog)
         = '{"bike": 1.77, "moto": 2.54, "car": 3.00}'::jsonb, format('speed_mul %s', (select jsonb_object_agg(id, speed_mul) from public.vehicle_catalog));
  assert not exists (select 1 from public.vehicle_catalog where speed_mul > 3 or speed_mul < 1), 'cap';
  assert exists (select 1 from information_schema.columns where table_name = 'player_pos' and column_name = 'ride')
     and exists (select 1 from information_schema.columns where table_name = 'player_pos' and column_name = 'ride_at'), 'columns';
  assert has_function_privilege('anon', 'public.pos_report_w(text, integer, integer, text)', 'execute')
     and has_function_privilege('anon', 'public.pos_report_w(text, integer, integer)', 'execute'), 'granted';
  assert not has_function_privilege('anon', 'public._pos_ride_mul(uuid, text, integer, integer)', 'execute')
     and not has_function_privilege('anon', 'public._pos_road_s(uuid, text, timestamptz, timestamptz)', 'execute'), 'private';
  raise notice 'speed ok';
end $$;

-- ---------- 2. Flag off ----------
do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid; j jsonb;
begin
  -- 0057's road seconds: on foot 0.9 × 15 s, a car owner 0.9 × 2 s
  assert public._pos_road_s(a, 'moon', now() - interval '1 minute', null) = 13.5, 'foot road';
  insert into public.owned_vehicles (account_id, vehicle_id) values (a, 'car') on conflict do nothing;
  assert public._pos_road_s(a, 'moon', now() - interval '1 minute', null) = 1.8, 'car road';
  assert public._pos_road_s(a, 'moon', now() - interval '1 minute', now()) = 0, 'skipped';
  delete from public.owned_vehicles where account_id = a;
  -- skip_trip charges as before
  insert into public.wallets (account_id, coins) values (a, 100) on conflict (account_id) do update set coins = 100;
  perform pg_temp.put('a', 'hall', 604, 200, 1);
  j := public.skip_trip(t);
  assert (j->>'coins')::integer = 80, format('skip %s', j);
  -- a report stores what I ride
  perform pg_temp.put('a', 'pond', 300, 204, 1);
  j := public.pos_report_w(t, 1262, 1244, 'bike');
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'pond:302,204/bike', format('stored %s %s', j, pg_temp.pos('a'));
  j := public.pos_report_w(t, 1264, 1244, 'jetpack');                            -- unknown: on foot
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'pond:304,204', format('unknown ride %s', pg_temp.pos('a'));
  j := public.pos_report_w(t, 1266, 1244);                                       -- the 3-arg one: on foot
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'pond:306,204', format('3-arg %s', j);
  raise notice 'flag off ok';
end $$;

-- ---------- 3. Flag on ----------
update public.app_flags set enabled = true where key = 'unified_world';

do $$
declare t text := (select v from px where k = 'ta'); a uuid := (select v from px where k = 'a')::uuid;
        td text := (select v from px where k = 'td'); d uuid := (select v from px where k = 'd')::uuid; j jsonb;
begin
  -- the need at a multiplier: hall (0,0) → (300,400) = (500 − 64) / (260 × m)
  assert abs(public._pos_need_s('hall', 0, 0, 'hall', 300, 400, 1) - 436 / 260.0) < 0.001, 'foot need';
  assert abs(public._pos_need_s('hall', 0, 0, 'hall', 300, 400, 3) - 436 / 780.0) < 0.001, 'car need';
  assert abs(public._pos_need_s('hall', 0, 0, 'hall', 300, 400, 9) - 436 / 780.0) < 0.001, 'capped at 3';
  assert public._pos_need_s('ham_ngam', 48, 52, 'mo_da', 44, 200, 5) is not null, 'interior ↔ interior: graph, no road seconds';
  -- road "seconds" are the multiplier now: 1 on foot
  assert public._pos_road_s(a, 'moon', now() - interval '1 minute', null) = 1, 'foot mul';

  -- 1 s after a hall claim: 600 px along the hall's row is too fast on foot (need (600−64)/260 ≈ 2.06 s > 1 + 1)
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1500, 700, 'car');                                -- a car I don't own: on foot
  assert j ? 'anticheat', format('car not owned %s', j);
  insert into public.owned_vehicles (account_id, vehicle_id) values (a, 'car'), (a, 'bike') on conflict do nothing;
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1500, 700, null);                                 -- owned but walking: refused
  assert j ? 'anticheat', format('on foot %s', j);
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1500, 700, 'car');                                -- (536 / 780) ≈ 0.69 s ≤ 2
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'hall:540,220/car', format('car %s %s', j, pg_temp.pos('a'));
  assert (select ride_at from public.player_pos where account_id = a) > now() - interval '5 seconds', 'ride_at';
  -- the bike (1.77): 700 px in 1 s needs (700 − 64) / 460 ≈ 1.38 s ≤ 2 — fine; 1000 px ≈ 2.03 s — refused
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1600, 700, 'bike');
  assert j->>'ok' = 'true', format('bike %s', j);
  perform pg_temp.put('a', 'wild', 600, 700, 1);
  j := public.pos_report_w(t, 1600, 700, 'bike');
  assert j ? 'anticheat', format('bike too far %s', j);
  -- a claim from another RPC keeps the ride stored from the last report (_pos_claim, zone-local)
  perform pg_temp.put('a', 'wild', 900, 700, 1, 'car');
  assert public._pos_claim(a, 'hall', 540, 220, 'test') is null, 'stored ride';
  perform pg_temp.put('a', 'wild', 900, 700, 1, null);
  assert public._pos_claim(a, 'hall', 540, 220, 'test') is not null, 'stored foot';

  -- đi nhờ: a driver on a car it owns, claimed 0.5 s ago at (1500, 700)
  insert into public.owned_vehicles (account_id, vehicle_id) values (d, 'car') on conflict do nothing;
  delete from public.owned_vehicles where account_id = a;
  perform pg_temp.put('d', 'wild', 1500, 700, 0.5, 'car');
  update public.player_pos set map = 'hall', x = 540, y = 220 where account_id = d;   -- (1500, 700) in the hall
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1510, 700, 'lift');                               -- within 48 (+ what the driver may ride)
  assert j->>'ok' = 'true' and pg_temp.pos('a') = 'hall:550,220/lift', format('lift %s %s', j, pg_temp.pos('a'));
  update public.player_pos set at = now(), ride_at = now() where account_id = d;
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1500, 1000, 'lift');                              -- 300 px from the driver: on foot
  assert j ? 'anticheat', format('lift far %s', j);
  update public.player_pos set at = now() - interval '20 seconds', ride_at = now() - interval '20 seconds' where account_id = d;
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1510, 700, 'lift');                               -- a stale driver: on foot
  assert j ? 'anticheat', format('lift stale %s', j);
  update public.player_pos set at = now(), ride_at = now(), ride = null where account_id = d;
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1510, 700, 'lift');                               -- the driver walks: on foot
  assert j ? 'anticheat', format('lift walker %s', j);
  update public.player_pos set ride = 'lift', ride_at = now() where account_id = d;
  perform pg_temp.put('a', 'wild', 900, 700, 1);
  j := public.pos_report_w(t, 1510, 700, 'lift');                               -- a passenger is no driver
  assert j ? 'anticheat', format('lift of a lift %s', j);
  assert current_setting('app.pos_ride', true) = '' and current_setting('app.pos_to', true) = '', 'settings cleared';

  -- no road trips: skip_trip refused, nothing charged
  begin
    perform public.skip_trip(t);
    assert false, 'skip_trip must be refused';
  exception when sqlstate '22023' then
    assert sqlerrm = 'no road trips', sqlerrm;
  end;
  raise notice 'flag on ok';
end $$;

update public.app_flags set enabled = false where key = 'unified_world';
