-- tests/sql/unified-world-smoke.sql — 0088 (the unified world, P1: world coords under the portals, flag off). Run as the
-- superuser on the throwaway cluster after the full chain, from the repo root. It re-runs 0088 twice with \i. Every check
-- is an ASSERT; the first failure stops psql. It sets the flag on for its own checks and puts it back off at the end.
--   1. The world's geometry; the flag starts off; privileges.
--   2. Flag off: _pos_need_s is 0057's, value for value (a verbatim copy compared over every map pair); a claim on the
--      wild is off the map; pos_report_w is the zone's claim; wx / wy follow every writer.
--   3. Flag on: the world's speed check (distance, the detour factor, the slack), old portal hops refused, interiors by
--      the portal graph, the wild as a map, the waypoint exemption, the zone's level gate, _pos_on_zone.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0088_unified_world.sql
\i supabase/migrations/0088_unified_world.sql
reset client_min_messages;
update public.app_flags set enabled = false where key = 'unified_world';

create temp table ux (k text primary key, v text);
insert into ux select 'ta', token from public.register('uw_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into ux select 'a', public._auth_account(v)::text from ux where k = 'ta';
update public.anticheat_config set mode = 'log';

create or replace function pg_temp.put(p_map text, p_x integer, p_y integer, p_ago numeric) returns void
language sql as $$
  insert into public.player_pos (account_id, map, x, y, at, skip_at, bad_since, bad_count, tab, tabs)
  values ((select v from ux where k = 'a')::uuid, p_map, p_x, p_y, now() - make_interval(secs => p_ago), null, null, 0, null, '{}')
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at,
    skip_at = null, bad_since = null, bad_count = 0, tab = null, tabs = '{}'
$$;
create or replace function pg_temp.pos() returns text language sql as $$
  select map || ':' || x || ',' || y || '@' || coalesce(wx::text, '-') || ',' || coalesce(wy::text, '-')
    from public.player_pos where account_id = (select v from ux where k = 'a')::uuid
$$;

-- 0057's _pos_need_s, verbatim (the flag-off reference)
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

-- ---------- 1. Geometry, the flag, privileges ----------
do $$
declare r record;
begin
  assert public.app_flags() = '{"unified_world": false}'::jsonb, format('flags %s', public.app_flags());
  assert (select count(*) from public._world_zones()) = 8, 'eight zones';
  assert (select count(*) from public._pos_maps()) = 10 and exists (select 1 from public._pos_maps() where map = 'wild' and w = 4160 and h = 2240), 'wild map';
  assert (select min_level from public.map_levels where map = 'wild') = 1, 'wild level';
  -- no two zones overlap; all inside the world
  assert not exists (select 1 from public._world_zones() a, public._world_zones() b
                      where a.zone < b.zone and a.ox < b.ox + b.w and b.ox < a.ox + a.w and a.oy < b.oy + b.h and b.oy < a.oy + a.h), 'overlap';
  assert not exists (select 1 from public._world_zones() where ox + w > 4160 or oy + h > 2240), 'fits';
  assert public._zone_to_world('hall', 612, 300) = array[1572, 780], 'hall spawn';
  assert public._zone_to_world('wild', 5, 6) = array[5, 6], 'wild identity';
  assert public._zone_to_world('ham_ngam', 48, 84) is null and public._zone_to_world('moon', 1, 1) is null, 'no world';
  for r in select z.zone, x, y from public._world_zones() z, generate_series(0, 3) i,
             lateral (select (i * 997) % z.w as x, (i * 331) % z.h as y) p loop
    assert (select row(t.zone, t.x, t.y)::text from public._world_to_zone((public._zone_to_world(r.zone, r.x, r.y))[1],
                                                                          (public._zone_to_world(r.zone, r.x, r.y))[2]) t)
           = row(r.zone, r.x, r.y)::text, format('round trip %s', r);
  end loop;
  assert (select zone from public._world_to_zone(100, 100)) = 'wild', 'wild point';
  assert (select count(*) from public._world_to_zone(1572, 780)) = 1, 'one zone';
  assert not exists (select 1 from public._world_to_zone(5000, 10)), 'outside';
  assert (select count(*) from public.world_waypoints) = 8
     and (select wx from public.world_waypoints where id = 'ww_pond') = 1260
     and (select waypoint from public.world_waypoints where id = 'ww_pond') = 'wp_pond', 'waypoints';
  assert has_function_privilege('anon', 'public.pos_report_w(text, integer, integer)', 'execute')
     and has_function_privilege('anon', 'public.app_flags()', 'execute'), 'granted';
  assert not has_function_privilege('anon', 'public._world_to_zone(integer, integer)', 'execute')
     and not has_function_privilege('anon', 'public._zone_to_world(text, integer, integer)', 'execute')
     and not has_function_privilege('anon', 'public._pos_on_zone(uuid, text, integer, integer, integer)', 'execute')
     and not has_function_privilege('anon', 'public._app_flag(text)', 'execute')
     and not has_function_privilege('anon', 'public._pos_at_waypoint(uuid, text, integer, integer)', 'execute')
     and not has_table_privilege('anon', 'public.app_flags', 'select')
     and not has_table_privilege('anon', 'public.world_waypoints', 'select'), 'private';
  raise notice 'geometry ok';
end $$;

-- ---------- 2. Flag off: nothing changes ----------
do $$
declare n integer := 0; m0 text; m1 text; pts integer[] := array[0, 40, 200, 356, 612]; x0 integer; y0 integer; x1 integer; y1 integer;
        rd numeric;
begin
  for m0 in select map from public._pos_maps() where map <> 'wild' loop
    for m1 in select map from public._pos_maps() where map <> 'wild' loop
      foreach x0 in array pts loop
        foreach y1 in array pts loop
          y0 := (x0 * 7) % 400; x1 := (y1 * 3) % 640;
          foreach rd in array array[0, 1.8, 13.5]::numeric[] loop
            assert public._pos_need_s(m0, x0, y0, m1, x1, y1, rd) is not distinct from pg_temp.old_need(m0, x0, y0, m1, x1, y1, rd),
              format('need %s %s,%s → %s %s,%s road %s: %s vs %s', m0, x0, y0, m1, x1, y1, rd,
                     public._pos_need_s(m0, x0, y0, m1, x1, y1, rd), pg_temp.old_need(m0, x0, y0, m1, x1, y1, rd));
            n := n + 1;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  assert n = 9 * 9 * 25 * 3, format('%s pairs', n);
  assert public._pos_need_s('hall', 1, 1, 'wild', 100, 600, 0) is null, 'the wild: no path with the flag off';
  raise notice 'flag off: _pos_need_s identical over % cases', n;
end $$;

do $$
declare t text := (select v from ux where k = 'ta'); a uuid := (select v from ux where k = 'a')::uuid; j jsonb;
begin
  delete from public.player_pos where account_id = a;
  j := public.pos_report(t, 'pond', 300, 204);
  assert j = '{"ok": true}'::jsonb and pg_temp.pos() = 'pond:300,204@1260,1244', format('first claim %s %s', j, pg_temp.pos());
  j := public.pos_report(t, 'wild', 100, 600);                                   -- the wild is not a map yet
  assert j->'anticheat'->>'code' = 'pos_teleport' and pg_temp.pos() = 'pond:300,204@1260,1244', format('wild off %s', j);
  assert (select detail->>'why' from public.anticheat_events where account_id = a and code = 'pos_teleport' order by id desc limit 1) = 'off_map', 'off_map';
  j := public.pos_report_w(t, 960 + 500, 1040 + 204);                            -- pond (500, 204), in world px
  assert j = '{"ok": true, "map": "pond", "x": 500, "y": 204}'::jsonb and pg_temp.pos() = 'pond:500,204@1460,1244', format('pos_report_w %s', j);
  j := public.pos_report_w(t, 99999, 5);
  assert j->'anticheat'->>'code' = 'pos_teleport', format('outside the world %s', j);
  -- the old portal hop is still instant with the flag off: pond exit → the hall's dock
  perform pg_temp.put('pond', 352, 374, 0);
  j := public.pos_report(t, 'hall', 516, 334);
  assert j->>'ok' = 'true', format('portal hop, flag off %s', j);
  -- every writer keeps wx / wy: the river, a waypoint trip (a plain update), an interior
  perform public._river_move(a, 'song_cai', 80, 240);
  assert pg_temp.pos() = 'song_cai:80,240@1040,1840', format('river %s', pg_temp.pos());
  update public.player_pos set map = 'market', x = 72, y = 252 where account_id = a;
  assert pg_temp.pos() = 'market:72,252@1832,732', format('update %s', pg_temp.pos());
  perform pg_temp.put('ham_ngam', 48, 84, 0);
  assert pg_temp.pos() = 'ham_ngam:48,84@-,-', format('interior %s', pg_temp.pos());
  raise notice 'flag off claims ok';
end $$;

-- ---------- 3. Flag on ----------
update public.app_flags set enabled = true where key = 'unified_world';

do $$
declare n numeric;
begin
  assert public.app_flags() = '{"unified_world": true}'::jsonb, 'on';
  -- same zone: (500 − 64) / 260
  n := public._pos_need_s('hall', 0, 0, 'hall', 300, 400, 13.5);
  assert abs(n - (500 - 64) / 260.0) < 0.001, format('same zone %s', n);
  -- hall → market (an old portal joined them): straight, no factor; road seconds do not apply
  n := public._pos_need_s('hall', 604, 200, 'market', 72, 252, 13.5);
  assert abs(n - greatest(0, sqrt(268.0 ^ 2 + 52.0 ^ 2) - 64) / 260.0) < 0.001, format('hall → market %s', n);
  -- hall → Bãi đất (never joined): × 1.35
  n := public._pos_need_s('hall', 612, 300, 'bai_dat', 400, 48, 0);
  assert abs(n - (sqrt((2800 - 1572)::numeric ^ 2 + (1088 - 780)::numeric ^ 2) * 1.35 - 64) / 260.0) < 0.001, format('detour %s', n);
  -- the wild and a zone: no factor
  n := public._pos_need_s('wild', 900, 700, 'hall', 0, 236, 0);
  assert abs(n - greatest(0, sqrt(60.0 ^ 2 + 16.0 ^ 2) - 64) / 260.0) < 0.001, format('wild → hall %s', n);
  -- an interior: the portal graph (the hầm ↔ the market's hatch)
  assert public._pos_need_s('ham_ngam', 48, 52, 'market', 640, 350, 0) = pg_temp.old_need('ham_ngam', 48, 52, 'market', 640, 350, 0), 'interior';
  assert public._pos_need_s('pond', 1, 1, 'moon', 1, 1, 0) is null, 'no path';
  raise notice 'world need ok';
end $$;

do $$
declare t text := (select v from ux where k = 'ta'); a uuid := (select v from ux where k = 'a')::uuid; j jsonb;
begin
  -- the old portal hop (pond exit → the hall's dock, 600 world px) is now a walk: refused at once, fine after 3 s
  perform pg_temp.put('pond', 352, 374, 0.2);
  j := public.pos_report(t, 'hall', 516, 334);
  assert j->'anticheat'->>'code' = 'pos_teleport' and pg_temp.pos() = 'pond:352,374@1312,1414', format('hop refused %s', j);
  assert (select detail->>'why' from public.anticheat_events where account_id = a and code = 'pos_teleport' order by id desc limit 1) = 'too_fast', 'too_fast';
  perform pg_temp.put('pond', 352, 374, 3);
  j := public.pos_report_w(t, 1476, 814);
  assert j = '{"ok": true, "map": "hall", "x": 516, "y": 334}'::jsonb, format('walked %s', j);
  -- the wild is a map now: a road point, reached in time
  perform pg_temp.put('hall', 516, 334, 2);
  j := public.pos_report_w(t, 1476, 930);
  assert j = '{"ok": true, "map": "wild", "x": 1476, "y": 930}'::jsonb and pg_temp.pos() = 'wild:1476,930@1476,930', format('wild %s', j);
  -- 'wild' inside a zone's rect is off the map (the zone owns it)
  j := public.pos_report(t, 'wild', 1476, 800);
  assert j->'anticheat'->>'code' = 'pos_teleport'
     and (select detail->>'why' from public.anticheat_events where account_id = a and code = 'pos_teleport' order by id desc limit 1) = 'off_map', format('wild in a zone %s', j);
  -- far and fast: refused
  perform pg_temp.put('field', 60, 106, 1);
  j := public.pos_report_w(t, 3500, 700);
  assert j ? 'anticheat' and pg_temp.pos() = 'field:60,106@60,666', format('across the world %s', j);
  -- the hall's spawn: always
  j := public.pos_report(t, 'hall', 612, 300);
  assert j->>'ok' = 'true', format('spawn %s', j);
  raise notice 'world claims ok';
end $$;

do $$
declare t text := (select v from ux where k = 'ta'); a uuid := (select v from ux where k = 'a')::uuid; j jsonb;
begin
  -- a discovered waypoint is exempt; an undiscovered one is not
  delete from public.player_waypoints where account_id = a;
  insert into public.player_waypoints (account_id, waypoint) values (a, 'wp_pond');
  perform pg_temp.put('khu_nha', 400, 200, 0);
  j := public.pos_report(t, 'pond', 300, 356);
  assert j->>'ok' = 'true' and pg_temp.pos() = 'pond:300,356@1260,1396', format('waypoint %s', j);
  perform pg_temp.put('khu_nha', 400, 200, 0);
  j := public.pos_report(t, 'field', 60, 106);
  assert j ? 'anticheat', format('undiscovered %s', j);
  -- with the flag off the waypoint is no exemption
  update public.app_flags set enabled = false where key = 'unified_world';
  perform pg_temp.put('khu_nha', 400, 200, 0);
  j := public.pos_report(t, 'pond', 300, 356);
  assert j ? 'anticheat', format('waypoint, flag off %s', j);
  update public.app_flags set enabled = true where key = 'unified_world';
  -- the zone's level gate: Mỏ đá (level 5) from its gate on Bãi đất, in time: map_locked, not counted
  perform pg_temp.put('bai_dat', 748, 268, 5);
  j := public.pos_report_w(t, 3360 + 44, 1040 + 200);
  assert j->'anticheat'->>'why' = 'map_locked' and pg_temp.pos() = 'bai_dat:748,268@3148,1308', format('gate %s', j);
  -- _pos_on_zone: in the world across a zone border, on the map for an interior
  perform pg_temp.put('wild', 1476, 900, 0);
  assert public._pos_on_zone(a, 'hall', 516, 390, 40), 'on zone (world)';
  assert not public._pos_on_zone(a, 'hall', 516, 300, 40), 'too far';
  perform pg_temp.put('ham_ngam', 48, 84, 0);
  assert public._pos_on_zone(a, 'ham_ngam', 50, 90, 10) and not public._pos_on_zone(a, 'market', 50, 90, 10), 'interior';
  raise notice 'waypoints, gates, _pos_on_zone ok';
end $$;

update public.app_flags set enabled = false where key = 'unified_world';
do $$ begin assert public.app_flags() = '{"unified_world": false}'::jsonb, 'back off'; raise notice 'unified world smoke ok'; end $$;
