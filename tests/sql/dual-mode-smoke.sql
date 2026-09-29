-- tests/sql/dual-mode-smoke.sql — 0090 (2D and 3D side by side on one data: each claim judged by its client's model). Run
-- as the superuser on the throwaway cluster after the full chain, from the repo root. It re-runs 0090 twice with \i.
-- Every check is an ASSERT; the first failure stops psql. It leaves the flag ON (0090's default).
--   1. The flag: on after the first run, a re-run keeps what the owner set; the columns and privileges.
--   2. 2D is unchanged with the flag ON: _pos_need_s / _pos_road_s under the 2D model = 0057's verbatim copies over the
--      6075 cases of 0088's smoke; 2D claims (pos_report) accepted / refused exactly as 0057's model says, case by case.
--   3. Two accounts in the same room: A plays 2D (tab tA), B plays 3D (tab tB). Portal hops for A, the world for B (the
--      wild, the hop as a walk, RPC claims from B's tab in the world), vehicles: B rides at speed_mul, A's road trip and
--      skip_trip; skip_trip refused for B only.
--   4. A switches graphics mid-session: the first claim after each switch is judged by both models (no strike); the
--      next one by the new model only; a real teleport is refused even on a switch.
--   5. Level gates and waypoints in both modes; real teleports caught in both modes.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0090_dual_mode.sql
\i supabase/migrations/0090_dual_mode.sql
reset client_min_messages;

-- ---------- 1. The flag ----------
-- the first run (a server without player_pos.mode) turns world mode on, whatever an older smoke left
update public.app_flags set enabled = false where key = 'unified_world';
alter table public.player_pos drop column mode;
set client_min_messages = warning;
\i supabase/migrations/0090_dual_mode.sql
reset client_min_messages;
do $$
begin
  assert public.app_flags() = '{"unified_world": true}'::jsonb, format('flags %s (0090 turns world mode on)', public.app_flags());
end $$;
update public.app_flags set enabled = false where key = 'unified_world';
set client_min_messages = warning;
\i supabase/migrations/0090_dual_mode.sql
reset client_min_messages;
do $$ begin assert public.app_flags() = '{"unified_world": false}'::jsonb, 'a re-run keeps the owner''s choice'; end $$;
update public.app_flags set enabled = true where key = 'unified_world';
do $$
begin
  assert exists (select 1 from information_schema.columns where table_name = 'player_pos' and column_name = 'mode'), 'mode column';
  assert not has_function_privilege('anon', 'public._pos_world()', 'execute')
     and not has_function_privilege('anon', 'public._pos_mode_of(jsonb, text, text)', 'execute')
     and not has_function_privilege('anon', 'public._pos_tabs_m(jsonb, text, text, integer, integer, text)', 'execute')
     and not has_function_privilege('anon', 'public._pos_claim(uuid, text, integer, integer, text, uuid, text)', 'execute'), 'private';
  assert has_function_privilege('anon', 'public.skip_trip(text)', 'execute')
     and has_function_privilege('anon', 'public.pos_report(text, text, integer, integer)', 'execute')
     and has_function_privilege('anon', 'public.pos_report_w(text, integer, integer, text)', 'execute'), 'granted';
  assert public._pos_mode_of('{}', null, 'x') = '2' and public._pos_mode_of('{}', 'w', 'x') = 'w'
     and public._pos_mode_of('{"x": {"m": "hall"}}', 'w', 'x') = '2' and public._pos_mode_of('{"x": {"w": "w"}}', null, 'x') = 'w'
     and public._pos_mode_of('{"x": {"w": "w"}}', null, null) = '2', 'mode of';
  raise notice 'flag ok';
end $$;

create temp table dm (k text primary key, v text);
insert into dm select 'ta', token from public.register('dm_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into dm select 'a', public._auth_account(v)::text from dm where k = 'ta';
insert into dm select 'tb', token from public.register('dm_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into dm select 'b', public._auth_account(v)::text from dm where k = 'tb';
insert into dm select 'tc', token from public.register('dm_c_' || floor(random() * 1e9)::text, 'pw123456');   -- section 2's claims
insert into dm select 'c', public._auth_account(v)::text from dm where k = 'tc';                               -- (200 events a day)
update public.anticheat_config set mode = 'log';

-- a fresh position (no tabs, no mode: the first claim sets them)
create or replace function pg_temp.put(p_who text, p_map text, p_x integer, p_y integer, p_ago numeric) returns void
language sql as $$
  insert into public.player_pos (account_id, map, x, y, at, skip_at, bad_since, bad_count, tab, tabs, ride, ride_at, mode)
  values ((select v from dm where k = p_who)::uuid, p_map, p_x, p_y, now() - make_interval(secs => p_ago), null, null, 0,
          null, '{}', null, null, null)
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at,
    skip_at = null, bad_since = null, bad_count = 0, tab = null, tabs = '{}', ride = null, ride_at = null, mode = null
$$;
-- the last accepted claim was p_ago s ago (the tabs' track too); the mode and tabs stay
create or replace function pg_temp.ago(p_who text, p_ago numeric) returns void
language sql as $$
  update public.player_pos set at = now() - make_interval(secs => p_ago), bad_count = 0, bad_since = null,
         tabs = coalesce((select jsonb_object_agg(k, v || jsonb_build_object('at', now() - make_interval(secs => p_ago)))
                            from jsonb_each(tabs) e(k, v)), '{}')
   where account_id = (select v from dm where k = p_who)::uuid
$$;
create or replace function pg_temp.pos(p_who text) returns text language sql as $$
  select map || ':' || x || ',' || y || '@' || coalesce(wx::text, '-') || ',' || coalesce(wy::text, '-') || '/' || coalesce(mode, '2')
    from public.player_pos where account_id = (select v from dm where k = p_who)::uuid
$$;
create or replace function pg_temp.tab(p_tab text) returns void language sql as $$
  select set_config('request.headers', case when p_tab is null then '' else json_build_object('x-tab-id', p_tab)::text end, true)
$$;
create or replace function pg_temp.why(p_who text) returns text language sql as $$
  select detail->>'why' from public.anticheat_events where account_id = (select v from dm where k = p_who)::uuid
     and code = 'pos_teleport' order by id desc limit 1
$$;

-- 0057's _pos_need_s and _pos_road_s, verbatim (the 2D reference)
create or replace function pg_temp.old_need(p_m0 text, p_x0 integer, p_y0 integer, p_m1 text, p_x1 integer, p_y1 integer,
                                            p_road numeric) returns numeric
language sql stable
as $$
  with recursive walk(map, x, y, dist, hops, roads) as (
    select p_m0, p_x0::numeric, p_y0::numeric, 0::numeric, 0, 0
    union all
    select p.to_map, p.ax::numeric, p.ay::numeric, w.dist + sqrt((p.ux - w.x) ^ 2 + (p.uy - w.y) ^ 2), w.hops + 1,
           w.roads + case when p.road then 1 else 0 end
      from walk w join public._pos_portals() p on p.from_map = w.map
     where w.hops < 3
  )
  select min(greatest(0, dist + sqrt((p_x1 - x) ^ 2 + (p_y1 - y) ^ 2) - 64 - 40 * hops) / 260.0 + p_road * roads)
    from walk where map = p_m1
$$;
create or replace function pg_temp.old_road(p_account uuid, p_map text, p_since timestamptz, p_skip timestamptz)
returns numeric
language sql stable
as $$
  select case when p_skip is not null and p_skip >= p_since then 0::numeric
    else 0.9 * least(15000,
      coalesce((select min(c.trip_ms) from public.owned_vehicles o join public.vehicle_catalog c on c.id = o.vehicle_id
                 where o.account_id = p_account), 15000),
      case when exists (select 1 from public.player_pos d
                         where d.map = p_map and d.at >= p_since and d.account_id <> p_account
                           and exists (select 1 from public.owned_vehicles o where o.account_id = d.account_id))
           then (select min(trip_ms) from public.vehicle_catalog) else 15000 end) / 1000.0 end
$$;

-- ---------- 2. 2D unchanged, flag ON ----------
do $$
declare n integer := 0; m0 text; m1 text; pts integer[] := array[0, 40, 200, 356, 612]; x0 integer; y0 integer; x1 integer; y1 integer;
        rd numeric; a uuid := (select v from dm where k = 'a')::uuid;
begin
  assert public._app_flag('unified_world'), 'flag on';
  perform set_config('app.pos_world', '0', true);                                -- the model of a 2D claim
  for m0 in select map from public._pos_maps() where map <> 'wild' loop
    for m1 in select map from public._pos_maps() where map <> 'wild' loop
      foreach x0 in array pts loop
        foreach y1 in array pts loop
          y0 := (x0 * 7) % 400; x1 := (y1 * 3) % 640;
          foreach rd in array array[0, 1.8, 13.5]::numeric[] loop
            assert public._pos_need_s(m0, x0, y0, m1, x1, y1, rd) is not distinct from pg_temp.old_need(m0, x0, y0, m1, x1, y1, rd),
              format('need %s %s,%s → %s %s,%s road %s', m0, x0, y0, m1, x1, y1, rd);
            n := n + 1;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  assert n = 6075, format('%s cases', n);
  -- the road seconds: on foot, a car owner, skipped, another car owner on the map
  assert public._pos_road_s(a, 'hall', now() - interval '1 minute', null) = pg_temp.old_road(a, 'hall', now() - interval '1 minute', null)
     and public._pos_road_s(a, 'moon', now() - interval '1 minute', null) = 13.5, 'foot road';
  insert into public.owned_vehicles (account_id, vehicle_id) values (a, 'car') on conflict do nothing;
  assert public._pos_road_s(a, 'moon', now() - interval '1 minute', null) = 1.8, 'car road';
  assert public._pos_road_s(a, 'moon', now() - interval '1 minute', now()) = 0, 'skipped';
  delete from public.owned_vehicles where account_id = a;
  perform set_config('app.pos_world', '', true);
  raise notice '2D model identical over % cases, flag on', n;
end $$;

-- 2D claims, case by case: accepted iff 0057's model accepts (bounds, the hall's spawn, the need within dt + 1 s)
do $$
declare t text := (select v from dm where k = 'tc'); a uuid := (select v from dm where k = 'c')::uuid; j jsonb;
        m0 text; m1 text; x1 integer; y1 integer; need numeric; ago numeric; ok boolean; n integer := 0; na integer := 0;
begin
  perform pg_temp.tab('tA');
  for m0 in select map from public._pos_maps() where map <> 'wild' and public._map_unlocked(a, map) loop
    for m1 in select map from public._pos_maps() where map <> 'wild' and public._map_unlocked(a, map) loop
      foreach x1 in array array[20, 300, 612, 700] loop
        foreach ago in array array[0.3, 2, 6, 20]::numeric[] loop
          y1 := (x1 * 3) % 380;
          perform pg_temp.put('c', m0, 40, 300, ago);
          need := pg_temp.old_need(m0, 40, 300, m1, x1, y1, pg_temp.old_road(a, m1, now() - make_interval(secs => ago), null));
          continue when need is not null and abs(need - (ago + 1)) < 0.01;
          ok := exists (select 1 from public._pos_maps() m where m.map = m1 and x1 between 0 and m.w and y1 between 0 and m.h)
                and ((m1 = 'hall' and abs(x1 - 612) <= 16 and abs(y1 - 300) <= 16) or (need is not null and need <= ago + 1));
          j := public.pos_report(t, m1, x1, y1);
          assert (j = '{"ok": true}'::jsonb) = ok and (j ? 'anticheat') = not ok,
            format('2D claim %s 40,300 → %s %s,%s after %s s (need %s): %s', m0, m1, x1, y1, ago, need, j);
          assert ok = (pg_temp.pos('c') like m1 || ':' || x1 || ',' || y1 || '@%'), format('stored %s', pg_temp.pos('c'));
          assert pg_temp.pos('c') like '%/2', 'stays 2D';
          n := n + 1; na := na + ok::integer;
        end loop;
      end loop;
    end loop;
  end loop;
  assert n > 500 and na > 100 and n - na > 100, format('%s claims, %s accepted', n, na);
  perform pg_temp.tab(null);
  raise notice '2D claims = 0057''s model over % claims (% accepted)', n, na;
end $$;

-- ---------- 3. A (2D) and B (3D) in the same room ----------
do $$
declare ta text := (select v from dm where k = 'ta'); tb text := (select v from dm where k = 'tb');
        a uuid := (select v from dm where k = 'a')::uuid; b uuid := (select v from dm where k = 'b')::uuid; j jsonb;
begin
  -- both stand at the pond's exit, 0.2 s ago
  perform pg_temp.put('a', 'pond', 352, 374, 0.2);
  perform pg_temp.put('b', 'pond', 352, 374, 0.2);
  perform pg_temp.tab('tA');
  j := public.pos_report(ta, 'pond', 352, 374);                                  -- A's tab reports 2D
  perform pg_temp.tab('tB');
  j := public.pos_report_w(tb, 1312, 1414);                                      -- B's tab reports the world
  assert j->>'ok' = 'true' and pg_temp.pos('b') = 'pond:352,374@1312,1414/w', format('B in the world %s %s', j, pg_temp.pos('b'));
  assert (select tabs->'tB'->>'w' from public.player_pos where account_id = b) = 'w', 'B''s tab marked';
  assert (select tabs->'tA' from public.player_pos where account_id = a) ? 'm'
     and not (select tabs->'tA' from public.player_pos where account_id = a) ? 'w', 'A''s tab: 0058''s entry';
  perform pg_temp.ago('a', 0.2); perform pg_temp.ago('b', 0.2);
  -- the portal hop pond exit → the hall's dock: instant for A (2D), a 600 px walk for B (3D)
  perform pg_temp.tab('tA');
  j := public.pos_report(ta, 'hall', 516, 334);
  assert j = '{"ok": true}'::jsonb and pg_temp.pos('a') = 'hall:516,334@1476,814/2', format('A hops %s %s', j, pg_temp.pos('a'));
  perform pg_temp.tab('tB');
  j := public.pos_report_w(tb, 1476, 814);
  assert j->'anticheat'->>'code' = 'pos_teleport' and pg_temp.why('b') = 'too_fast' and pg_temp.pos('b') = 'pond:352,374@1312,1414/w',
    format('B cannot hop %s', j);
  perform pg_temp.ago('b', 3);
  j := public.pos_report_w(tb, 1476, 814);
  assert j = '{"ok": true, "map": "hall", "x": 516, "y": 334}'::jsonb and pg_temp.pos('b') = 'hall:516,334@1476,814/w', format('B walked %s', j);
  -- the wild: a map for B (a heartbeat and another RPC's claim from B's tab), off the map for A
  perform pg_temp.ago('b', 2);
  j := public.pos_report_w(tb, 1476, 930);
  assert j = '{"ok": true, "map": "wild", "x": 1476, "y": 930}'::jsonb, format('B in the wild %s', j);
  perform pg_temp.ago('b', 1);
  assert public._pos_claim(b, 'wild', 1476, 1000, 'cast') is null and pg_temp.pos('b') = 'wild:1476,1000@1476,1000/w', 'B''s RPC claim in the wild';
  perform pg_temp.tab('tA');
  perform pg_temp.ago('a', 5);
  j := public.pos_report(ta, 'wild', 1476, 930);
  assert j->'anticheat'->>'code' = 'pos_teleport' and pg_temp.why('a') = 'off_map' and pg_temp.pos('a') = 'hall:516,334@1476,814/2', format('A: no wild %s', j);
  assert public._pos_claim(a, 'wild', 1476, 930, 'cast') is not null and pg_temp.why('a') = 'off_map', 'A''s RPC claim: no wild';
  -- an RPC claim from B's tab after a hop: judged in the world (refused), from A's tab by the portal graph (accepted)
  perform pg_temp.put('a', 'pond', 352, 374, 0.2); perform pg_temp.put('b', 'pond', 352, 374, 0.2);
  update public.player_pos set mode = 'w', tab = 'tB', tabs = jsonb_build_object('tB', jsonb_build_object('m', 'pond', 'x', 352, 'y', 374, 'at', at, 'w', 'w'))
   where account_id = b;
  perform pg_temp.tab('tB');
  assert public._pos_claim(b, 'hall', 516, 334, 'cast') is not null and pg_temp.why('b') = 'too_fast', 'B''s RPC hop refused';
  perform pg_temp.tab('tA');
  assert public._pos_claim(a, 'hall', 516, 334, 'cast') is null, 'A''s RPC hop accepted';
  perform pg_temp.tab(null);
  raise notice 'same room: 2D hops, 3D walks ok';
end $$;

-- vehicles: B rides at speed_mul; A's road trip and skip_trip
do $$
declare ta text := (select v from dm where k = 'ta'); tb text := (select v from dm where k = 'tb');
        a uuid := (select v from dm where k = 'a')::uuid; b uuid := (select v from dm where k = 'b')::uuid; j jsonb; e text;
begin
  insert into public.owned_vehicles (account_id, vehicle_id) values (a, 'car'), (b, 'car') on conflict do nothing;
  insert into public.wallets (account_id, coins) values (a, 100), (b, 100) on conflict (account_id) do update set coins = 100;
  -- B: pond (300, 204) → the wild (2300, 1000): 1068 px — on foot 3.86 s, by car 1.29 s; 2.5 s passed
  perform pg_temp.tab('tB');
  perform pg_temp.put('b', 'pond', 300, 204, 0.2);
  j := public.pos_report_w(tb, 1260, 1244);
  perform pg_temp.ago('b', 2.5);
  j := public.pos_report_w(tb, 2300, 1000);
  assert j ? 'anticheat' and pg_temp.why('b') = 'too_fast', format('B on foot %s', j);
  perform pg_temp.ago('b', 2.5);
  j := public.pos_report_w(tb, 2300, 1000, 'car');
  assert j = '{"ok": true, "map": "wild", "x": 2300, "y": 1000}'::jsonb
     and (select ride from public.player_pos where account_id = b) = 'car', format('B by car %s', j);
  -- B: no road trips
  begin
    perform public.skip_trip(tb);
    e := 'none';
  exception when others then e := sqlerrm;
  end;
  assert e = 'no road trips' and (select coins from public.wallets where account_id = b) = 100, format('B skip_trip %s', e);
  -- A (2D, a car owner): the road trip hall → market takes 0.9 × 2 s + the walk; skip_trip pays 20 and makes it instant
  perform pg_temp.tab('tA');
  perform pg_temp.put('a', 'hall', 604, 200, 0.2);
  j := public.pos_report(ta, 'hall', 604, 200);
  perform pg_temp.ago('a', 0.5);
  j := public.pos_report(ta, 'market', 72, 252);
  assert j ? 'anticheat' and pg_temp.why('a') = 'too_fast', format('A''s road trip takes time %s %s', j, pg_temp.why('a'));
  j := public.skip_trip(ta);
  assert (j->>'coins')::integer = 80, format('A skip_trip %s', j);
  j := public.pos_report(ta, 'market', 72, 252);
  assert j = '{"ok": true}'::jsonb and pg_temp.pos('a') = 'market:72,252@1832,732/2', format('A after the xe ôm %s', j);
  -- by car without skipping: 1.8 s of road + 0 walk
  perform pg_temp.put('a', 'hall', 604, 200, 2.5);
  j := public.pos_report(ta, 'market', 72, 252);
  assert j = '{"ok": true}'::jsonb, format('A by car %s', j);
  delete from public.owned_vehicles where account_id in (a, b);
  perform pg_temp.tab(null);
  raise notice 'vehicles per mode ok';
end $$;

-- ---------- 4. A switches graphics mid-session ----------
do $$
declare ta text := (select v from dm where k = 'ta'); a uuid := (select v from dm where k = 'a')::uuid; j jsonb; n0 integer;
begin
  perform pg_temp.tab('tA');
  perform pg_temp.put('a', 'pond', 352, 374, 0.2);
  j := public.pos_report(ta, 'pond', 352, 374);                                  -- 2D
  perform pg_temp.ago('a', 0.2);
  n0 := (select count(*) from public.anticheat_events where account_id = a);
  -- to 3D: the first world claim is the hop A's 2D client just made (the portal graph allows it) — no strike
  j := public.pos_report_w(ta, 1476, 814);
  assert j = '{"ok": true, "map": "hall", "x": 516, "y": 334}'::jsonb and pg_temp.pos('a') = 'hall:516,334@1476,814/w', format('switch to 3D %s', j);
  assert (select tabs->'tA'->>'w' from public.player_pos where account_id = a) = 'w', 'tab now 3D';
  -- now in the world: the same hop back is a walk
  perform pg_temp.ago('a', 0.2);
  j := public.pos_report_w(ta, 1312, 1414);
  assert j ? 'anticheat' and pg_temp.why('a') = 'too_fast', format('3D after the switch %s', j);
  -- an RPC claim from the tab follows its new mode: the wild is a map
  perform pg_temp.ago('a', 2);
  assert public._pos_claim(a, 'wild', 1476, 930, 'cast') is null, 'the tab''s RPC claim in the world';
  -- back to 2D: the first 2D claim is judged by both (the world walk from the wild into the hall), then 2D only
  perform pg_temp.ago('a', 0.5);
  j := public.pos_report(ta, 'hall', 516, 334);
  assert j = '{"ok": true}'::jsonb and pg_temp.pos('a') = 'hall:516,334@1476,814/2', format('switch to 2D %s %s', j, pg_temp.pos('a'));
  assert not (select tabs->'tA' from public.player_pos where account_id = a) ? 'w', 'tab 2D again';
  perform pg_temp.ago('a', 0.2);
  j := public.pos_report(ta, 'pond', 352, 374);                                  -- the portal hop back: 2D
  assert j = '{"ok": true}'::jsonb, format('2D hop after the switch %s', j);
  assert (select count(*) from public.anticheat_events where account_id = a) = n0 + 1, 'one strike only: the walk refused in 3D';
  -- a real teleport is refused on a switch too: pond → Khu nhà in 0.3 s (far in both models)
  perform pg_temp.ago('a', 0.3);
  j := public.pos_report_w(ta, 3600, 680);
  assert j ? 'anticheat' and pg_temp.why('a') = 'too_fast' and pg_temp.pos('a') like 'pond:352,374@%/2', format('teleport on a switch %s', j);
  perform pg_temp.tab(null);
  raise notice 'mode switch ok';
end $$;

-- ---------- 5. Gates, waypoints, teleports in both modes ----------
do $$
declare ta text := (select v from dm where k = 'ta'); tb text := (select v from dm where k = 'tb');
        a uuid := (select v from dm where k = 'a')::uuid; b uuid := (select v from dm where k = 'b')::uuid; j jsonb;
        lvl integer := (select min_level from public.map_levels where map = 'bai_dat');
        wpm text; wpx integer; wpy integer;
begin
  -- the level gate: Bãi đất locked for both (A by a hop, B by walking in)
  update public.map_levels set min_level = 99 where map = 'bai_dat';
  perform pg_temp.tab('tA');
  perform pg_temp.put('a', 'bai_dat', 400, 48, 0); perform pg_temp.put('a', 'market', 72, 252, 60);
  j := public.pos_report(ta, 'bai_dat', 400, 48);
  assert j->'anticheat'->>'why' = 'map_locked' and pg_temp.pos('a') like 'market:%', format('A gate %s', j);
  perform pg_temp.tab('tB');
  perform pg_temp.put('b', 'wild', 2300, 1000, 60);
  update public.player_pos set mode = 'w' where account_id = b;
  j := public.pos_report_w(tb, 2800, 1088);
  assert j->'anticheat'->>'why' = 'map_locked' and pg_temp.pos('b') like 'wild:%', format('B gate %s', j);
  update public.map_levels set min_level = coalesce(lvl, 1) where map = 'bai_dat';
  j := public.pos_report_w(tb, 2800, 1088);
  assert j = '{"ok": true, "map": "bai_dat", "x": 400, "y": 48}'::jsonb, format('B gate open %s', j);
  -- waypoints: right after a paid trip (the server wrote the target) both claim the arrival
  select map, x, y into wpm, wpx, wpy from public.waypoints where id = 'wp_pond';
  insert into public.player_waypoints (account_id, waypoint) values (a, 'wp_pond'), (b, 'wp_pond') on conflict do nothing;
  insert into public.player_progress (account_id) values (a), (b) on conflict (account_id) do nothing;
  perform pg_temp.tab('tA');
  perform pg_temp.put('a', wpm, wpx, wpy, 0);
  update public.player_progress set tp_at = now() where account_id = a;
  j := public.pos_report(ta, 'pond', 300, 356);
  assert j = '{"ok": true}'::jsonb, format('A at the waypoint %s', j);
  perform pg_temp.tab('tB');
  perform pg_temp.put('b', wpm, wpx, wpy, 0);
  update public.player_pos set mode = 'w' where account_id = b;
  update public.player_progress set tp_at = (select at from public.player_pos where account_id = b) where account_id = b;
  j := public.pos_report_w(tb, 1260, 1396);
  assert j = '{"ok": true, "map": "pond", "x": 300, "y": 356}'::jsonb, format('B at the waypoint %s', j);
  -- a discovered waypoint is no free teleport in either mode
  update public.player_progress set tp_at = null where account_id in (a, b);
  perform pg_temp.tab('tA');
  perform pg_temp.put('a', 'khu_nha', 400, 200, 0.5);
  j := public.pos_report(ta, 'pond', 300, 356);
  assert j ? 'anticheat' and pg_temp.why('a') = 'too_fast', format('A teleport %s', j);
  perform pg_temp.tab('tB');
  perform pg_temp.put('b', 'khu_nha', 400, 200, 0.5);
  update public.player_pos set mode = 'w' where account_id = b;
  j := public.pos_report_w(tb, 1260, 1396);
  assert j ? 'anticheat' and pg_temp.why('b') = 'too_fast', format('B teleport %s', j);
  -- across the world in a second, on a vehicle it does not own
  perform pg_temp.put('b', 'field', 60, 106, 1);
  update public.player_pos set mode = 'w' where account_id = b;
  j := public.pos_report_w(tb, 3500, 700, 'car');
  assert j ? 'anticheat' and pg_temp.pos('b') like 'field:60,106@%', format('B across the world %s', j);
  perform pg_temp.tab(null);
  raise notice 'gates, waypoints, teleports ok';
end $$;

-- ---------- 6. Flag off: everyone is 2D (pos_report_w is a zone claim judged by the portal graph) ----------
update public.app_flags set enabled = false where key = 'unified_world';
do $$
declare tb text := (select v from dm where k = 'tb'); j jsonb;
begin
  perform pg_temp.put('b', 'pond', 352, 374, 0.2);
  update public.player_pos set mode = 'w' where account_id = (select v from dm where k = 'b')::uuid;
  j := public.pos_report_w(tb, 1476, 814);                                       -- the hop: instant by the portal graph
  assert j->>'ok' = 'true' and pg_temp.pos('b') like '%/2', format('flag off hop %s %s', j, pg_temp.pos('b'));
  j := public.pos_report_w(tb, 1476, 930);                                       -- the wild: off the map
  assert j ? 'anticheat', format('flag off wild %s', j);
  raise notice 'flag off ok';
end $$;
update public.app_flags set enabled = true where key = 'unified_world';
do $$ begin assert public.app_flags() = '{"unified_world": true}'::jsonb, 'left on'; raise notice 'dual mode smoke ok'; end $$;
