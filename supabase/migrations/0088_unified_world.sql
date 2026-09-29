-- =========================================================
-- 0088_unified_world.sql — the unified world, phase P1 (docs/superpowers/specs/2026-09-29-unified-world-design.md §3):
-- the server learns world coordinates UNDER the old portals. ADDITIVE and re-runnable. Run after 0087.
--   A. app_flags: named switches the client reads (app_flags()); 'unified_world' starts FALSE — with it off every claim
--      is judged exactly as before (the portal graph), so this migration changes no behaviour until the owner flips it.
--   B. The world (lib/game/world/zones.ts mirrors it; tests/unit/world-zones.test.ts pins them): _world_zones() — each
--      outdoor map's rectangle in the 4160 × 2240 world; _zone_to_world / _world_to_zone (the rest of the world is
--      'wild', whose local coords are world coords; interiors — the hầm — have none); _pos_on_zone (is the account's
--      server position within r px of a zone-local point, measured in the world when both have world coords).
--   C. player_pos.wx / wy: the accepted position in world px, derived from (map, x, y) by a BEFORE trigger on every
--      writer (_pos_claim, _river_move, waypoint_travel, the smokes' fixtures), backfilled; null in an interior.
--      map / x / y stay zone-local (map may be 'wild'). _pos_maps gets 'wild'; map_levels ('wild', 1).
--   D. _pos_need_s (0057's): flag off — verbatim. Flag on — between two world points: the straight distance, × 1.35
--      when the two zones are neither the same, nor joined by an old portal, nor either one the wild; less 64 px of
--      slack, at 260 px/s (road seconds do not apply: vehicles are decided later, _pos_road_s is unchanged). A trip to or
--      from an interior still goes by the portal graph.
--   E. _pos_claim (0078's, same signature: every proximity RPC keeps calling it zone-local): flag on — 'wild' is a map
--      (off the map when the point lies in a zone's rect: the zone owns it), and a claim on a discovered world waypoint is
--      exempt from the speed check like the hall's spawn. The level gate is the zone's (the claimed map is the zone).
--      pos_report_w(token, wx, wy): the claim from world px (converted to the zone). pos_report is unchanged.
--   F. world_waypoints: the old maps' arrival spots in world px, linked to 0070's waypoints where one exists.
--   G. P2 (owner: Mỏ đá goes underground): mo_da leaves _world_zones and is an interior like the hầm; its door in the
--      world is the mine mouth on the eastern hills — _world_portals() (0072's _pos_portals, the flag-off graph untouched,
--      plus wild (3624, 1232) ↔ mo_da (44, 200) / (28, 200) → wild (3600, 1232)). _pos_need_s (flag on) judges a trip between an interior and a world point through the interior's
--      portals, then straight through the world. The level gate (map_levels mo_da, lv5) still applies: the claim at the
--      cave's arrival is a claim on mo_da.
--   H. P2 review: a world waypoint exempts a claim from the speed check only right after a paid waypoint_travel to it
--      (_pos_at_waypoint reads player_progress.tp_at; before, any discovered waypoint was a free teleport).
-- Re-created functions I did not create: _pos_maps (0086's, + the row marked 0088), _pos_need_s (0057's), _pos_claim
-- (0078's) — each verbatim but for the lines marked 0088.
-- Lock order unchanged: heat_state → vitals → player_pos → wallet → anticheat_status.
-- =========================================================

-- ---------- A. Flags ----------
create table if not exists public.app_flags (
  key text primary key,
  enabled boolean not null default false,
  changed_at timestamptz not null default now()
);
alter table public.app_flags enable row level security;
revoke all on public.app_flags from anon, authenticated;
insert into public.app_flags (key, enabled) values ('unified_world', false) on conflict (key) do nothing;   -- a re-run keeps it

create or replace function public._app_flag(p_key text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select enabled from public.app_flags where key = p_key), false) $$;
revoke all on function public._app_flag(text) from public, anon, authenticated;

-- Every flag, for the client ({"unified_world": false}).
create or replace function public.app_flags() returns jsonb
language sql stable security definer set search_path = public, extensions
as $$ select coalesce(jsonb_object_agg(key, enabled), '{}'::jsonb) from public.app_flags $$;
revoke all on function public.app_flags() from public;
grant execute on function public.app_flags() to anon, authenticated;

-- ---------- B. The world ----------
create or replace function public._world_zones() returns table (zone text, ox integer, oy integer, w integer, h integer)
language sql immutable parallel safe
as $$
  values ('field', 0, 560, 800, 480), ('hall', 960, 480, 640, 400), ('pond', 960, 1040, 640, 400),
         ('market', 1760, 480, 1280, 400), ('khu_nha', 3200, 480, 800, 400), ('bai_dat', 2400, 1040, 800, 400),
         ('song_cai', 960, 1600, 960, 480)                                          -- P2: mo_da is an interior (underground)
$$;

-- Zone-local → world px ({wx, wy}); the wild is the identity; null for an interior or an unknown map.
create or replace function public._zone_to_world(p_zone text, p_x integer, p_y integer) returns integer[]
language sql immutable parallel safe
as $$
  select case when p_x is null or p_y is null then null
              when p_zone = 'wild' then array[p_x, p_y]
              else (select array[p_x + z.ox, p_y + z.oy] from public._world_zones() z where z.zone = p_zone) end
$$;

-- World px → the zone holding it (half-open rect) and its local px; the wild elsewhere in the world; no row outside it.
create or replace function public._world_to_zone(p_wx integer, p_wy integer) returns table (zone text, x integer, y integer)
language sql immutable parallel safe
as $$
  select z.zone, p_wx - z.ox, p_wy - z.oy from public._world_zones() z
   where p_wx >= z.ox and p_wx < z.ox + z.w and p_wy >= z.oy and p_wy < z.oy + z.h
  union all
  select 'wild', p_wx, p_wy
   where p_wx between 0 and 4159 and p_wy between 0 and 2239
     and not exists (select 1 from public._world_zones() z
                      where p_wx >= z.ox and p_wx < z.ox + z.w and p_wy >= z.oy and p_wy < z.oy + z.h)
$$;

-- The world's portals (P2): 0072's _pos_portals — the flag-off graph, unchanged — plus Mỏ đá's door in the world since it
-- went underground: the mine mouth on the eastern hills (lib/game/world/mine.ts MINE: use (3624, 1232); out of the cave at
-- (3600, 1232)), a portal between the wild (world px) and the mo_da interior. Read only with the flag on (the interior
-- trips of _pos_need_s, _world_adjacent); the old Bãi đất ↔ Mỏ đá gate stays for the per-map client.
create or replace function public._world_portals() returns table (from_map text, to_map text, ux integer, uy integer,
                                                                  ax integer, ay integer, road boolean)
language sql immutable parallel safe
as $$
  select * from public._pos_portals()
  union all
  values ('wild', 'mo_da', 3624, 1232, 44, 200, false), ('mo_da', 'wild', 28, 200, 3600, 1232, false)
$$;
revoke all on function public._world_portals() from public, anon, authenticated;
-- Two zones an old portal joined (the roads of the world); a zone and itself; the wild and anything.
create or replace function public._world_adjacent(p_a text, p_b text) returns boolean
language sql immutable parallel safe
as $$
  select p_a = p_b or p_a = 'wild' or p_b = 'wild'
      or exists (select 1 from public._world_portals() p where p.from_map = p_a and p.to_map = p_b)
$$;

-- Is the account's server position within p_r px of (zone, x, y)? In the world when both have world coords, else on the
-- same map. For the proximity RPCs of the later phases.
create or replace function public._pos_on_zone(p_account uuid, p_zone text, p_x integer, p_y integer, p_r integer)
returns boolean
language plpgsql stable security definer set search_path = public, extensions
as $$
declare pp public.player_pos; w integer[] := public._zone_to_world(p_zone, p_x, p_y);
begin
  select * into pp from public.player_pos where account_id = p_account;
  if pp.account_id is null or p_r is null then return false; end if;
  if w is not null and pp.wx is not null then
    return (pp.wx - w[1])::numeric ^ 2 + (pp.wy - w[2])::numeric ^ 2 <= p_r::numeric ^ 2;
  end if;
  return pp.map = p_zone and (pp.x - p_x)::numeric ^ 2 + (pp.y - p_y)::numeric ^ 2 <= p_r::numeric ^ 2;
end $$;
revoke all on function public._world_zones() from public, anon, authenticated;
revoke all on function public._zone_to_world(text, integer, integer) from public, anon, authenticated;
revoke all on function public._world_to_zone(integer, integer) from public, anon, authenticated;
revoke all on function public._world_adjacent(text, text) from public, anon, authenticated;
revoke all on function public._pos_on_zone(uuid, text, integer, integer, integer) from public, anon, authenticated;

-- ---------- C. World coords on the position ----------
alter table public.player_pos add column if not exists wx integer;
alter table public.player_pos add column if not exists wy integer;

create or replace function public._pos_world_trg() returns trigger
language plpgsql
as $$
declare w integer[] := public._zone_to_world(new.map, new.x, new.y);
begin
  new.wx := w[1];
  new.wy := w[2];
  return new;
end $$;
revoke all on function public._pos_world_trg() from public, anon, authenticated;
drop trigger if exists player_pos_world on public.player_pos;
create trigger player_pos_world before insert or update of map, x, y on public.player_pos
  for each row execute function public._pos_world_trg();

update public.player_pos p set wx = w[1], wy = w[2]
  from (select account_id, public._zone_to_world(map, x, y) w from public.player_pos) q
 where q.account_id = p.account_id and (p.wx is distinct from q.w[1] or p.wy is distinct from q.w[2]);

-- _pos_maps (0086_explore_minigames.sql's, verbatim but for the row marked 0088)
create or replace function public._pos_maps() returns table (map text, w integer, h integer)
language sql immutable parallel safe
as $$
  values ('hall', 640, 400), ('pond', 640, 400), ('field', 800, 480), ('market', 1280, 400), ('khu_nha', 800, 400),
         ('bai_dat', 800, 400), ('ham_ngam', 480, 320),
         ('mo_da', 640, 400),                                                                            -- 0072
         ('song_cai', 960, 480),                                                                         -- 0086
         ('wild', 4160, 2240)                                                                            -- 0088
$$;
revoke all on function public._pos_maps() from public, anon, authenticated;

insert into public.map_levels (map, min_level) values ('wild', 1) on conflict (map) do nothing;

-- ---------- D. The least seconds ----------
-- _pos_need_s (0057_server_position.sql's, verbatim in its flag-off branch; the rest marked 0088). Now plpgsql and
-- stable: it reads the flag.
create or replace function public._pos_need_s(p_m0 text, p_x0 integer, p_y0 integer, p_m1 text, p_x1 integer, p_y1 integer,
                                              p_road numeric) returns numeric
language plpgsql stable
as $$
declare a integer[]; b integer[];                                                        -- 0088
begin
  -- 0088 {
  if public._app_flag('unified_world') then
    a := public._zone_to_world(p_m0, p_x0, p_y0);
    b := public._zone_to_world(p_m1, p_x1, p_y1);
    if a is not null and b is not null then
      return greatest(0, sqrt(((b[1] - a[1])::numeric) ^ 2 + ((b[2] - a[2])::numeric) ^ 2)
                         * case when public._world_adjacent(p_m0, p_m1) then 1 else 1.35 end - 64) / 260.0;
    end if;
    -- P2: one end in an interior (the hầm, Mỏ đá underground): inside it to one of its portals, then through the world
    -- from where that portal comes out (× 1.35 unless the two are joined), less the slack and one hop's
    if a is null and b is not null and p_x0 is not null then
      return (select min(greatest(0, sqrt(((p.ux - p_x0)::numeric) ^ 2 + ((p.uy - p_y0)::numeric) ^ 2)
                          + sqrt(((b[1] - o.w[1])::numeric) ^ 2 + ((b[2] - o.w[2])::numeric) ^ 2)
                            * case when public._world_adjacent(p.to_map, p_m1) then 1 else 1.35 end - 64 - 40) / 260.0)
                from public._world_portals() p cross join lateral (select public._zone_to_world(p.to_map, p.ax, p.ay) w) o
               where p.from_map = p_m0 and o.w is not null);
    end if;
    if b is null and a is not null and p_x1 is not null then
      return (select min(greatest(0, sqrt(((o.w[1] - a[1])::numeric) ^ 2 + ((o.w[2] - a[2])::numeric) ^ 2)
                            * case when public._world_adjacent(p_m0, p.from_map) then 1 else 1.35 end
                          + sqrt(((p_x1 - p.ax)::numeric) ^ 2 + ((p_y1 - p.ay)::numeric) ^ 2) - 64 - 40) / 260.0)
                from public._world_portals() p cross join lateral (select public._zone_to_world(p.from_map, p.ux, p.uy) w) o
               where p.to_map = p_m1 and o.w is not null);
    end if;
    if (a is null and p_m0 = 'wild') or (b is null and p_m1 = 'wild') then return null; end if;
  end if;
  -- 0088 }
  return (
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
  );
end $$;
revoke all on function public._pos_need_s(text, integer, integer, text, integer, integer, numeric) from public, anon, authenticated;

-- ---------- F. World waypoints (before E: _pos_claim reads them) ----------
create table if not exists public.world_waypoints (
  id text primary key,
  zone text not null,
  x integer not null,
  y integer not null,
  wx integer not null,
  wy integer not null,
  waypoint text references public.waypoints(id) on delete set null   -- 0070's, when the spot is one
);
alter table public.world_waypoints enable row level security;
revoke all on public.world_waypoints from anon, authenticated;
-- The old maps' spawns (lib/game/maps/*: each map's spawn = its main arrival). Mỏ đá is an interior since P2: no world
-- waypoint (a re-run over the P1 version drops its row).
delete from public.world_waypoints where id = 'ww_mo_da';
insert into public.world_waypoints (id, zone, x, y, wx, wy, waypoint)
select v.id, v.zone, v.x, v.y, (public._zone_to_world(v.zone, v.x, v.y))[1], (public._zone_to_world(v.zone, v.x, v.y))[2],
       (select w.id from public.waypoints w where w.id = v.wp)
  from (values ('ww_hall', 'hall', 612, 300, 'wp_hall'), ('ww_pond', 'pond', 300, 356, 'wp_pond'),
               ('ww_field', 'field', 60, 106, 'wp_field'), ('ww_market', 'market', 72, 252, 'wp_market'),
               ('ww_khu_nha', 'khu_nha', 68, 208, 'wp_khu_nha'), ('ww_bai_dat', 'bai_dat', 400, 48, 'wp_bai_dat'),
               ('ww_song_cai', 'song_cai', 80, 240, null)) v(id, zone, x, y, wp)
on conflict (id) do update set zone = excluded.zone, x = excluded.x, y = excluded.y, wx = excluded.wx, wy = excluded.wy,
  waypoint = excluded.waypoint;

-- Is (zone, x, y) within 16 px of a world waypoint this account has discovered (0070's player_waypoints) — AND was the
-- account just moved there by a paid waypoint_travel? P2 review ("free teleport"): being at a discovered waypoint alone
-- exempted any claim from the speed check, so one could walk off and claim any discovered waypoint for free. Now the
-- exemption holds only while the server position is still the one waypoint_travel wrote (no claim accepted since:
-- player_progress.tp_at >= player_pos.at), at that trip's target (the waypoint the position stands on), within 60 s.
drop function if exists public._pos_at_waypoint(uuid, text, integer, integer);
create or replace function public._pos_at_waypoint(p_account uuid, p_map text, p_x integer, p_y integer,
                                                   p_from_map text, p_from_x integer, p_from_y integer, p_since timestamptz)
returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (select 1 from public.world_waypoints ww
                   join public.player_waypoints pw on pw.waypoint = ww.waypoint and pw.account_id = p_account
                   join public.waypoints w on w.id = ww.waypoint
                   join public.player_progress r on r.account_id = p_account
                  where ww.zone = p_map and abs(ww.x - p_x) <= 16 and abs(ww.y - p_y) <= 16
                    and w.map = p_from_map and w.x = p_from_x and w.y = p_from_y          -- the trip's target
                    and r.tp_at is not null and r.tp_at >= p_since                          -- nothing accepted since
                    and r.tp_at > now() - interval '60 seconds')
$$;
revoke all on function public._pos_at_waypoint(uuid, text, integer, integer, text, integer, integer, timestamptz)
  from public, anon, authenticated;

-- ---------- E. Claims ----------
-- _pos_claim (0078_v21_fixes.sql's, verbatim but for the lines marked 0088)
create or replace function public._pos_claim(p_account uuid, p_map text, p_x integer, p_y integer, p_rpc text,
                                             p_room uuid default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare pp public.player_pos; v_dt numeric; v_need numeric; v_why text; v_n integer; v_ac jsonb; v_road numeric;
        v_tab text := public._pos_tab(); v_old boolean; v_own jsonb;                     -- 0058
        v_world boolean := public._app_flag('unified_world');                            -- 0088
begin
  select * into pp from public.player_pos where account_id = p_account for update;
  -- 0058 {
  -- an older tab of the account: judged against its own last claim
  v_old := v_tab is not null and pp.account_id is not null and pp.tab is not null and v_tab <> pp.tab and pp.tabs ? v_tab;
  if v_old then
    v_own := pp.tabs -> v_tab;
    pp.map := v_own->>'m';
    pp.x := (v_own->>'x')::integer;
    pp.y := (v_own->>'y')::integer;
    pp.at := (v_own->>'at')::timestamptz;
  end if;
  -- 0058 }
  if p_map is null or p_x is null or p_y is null
     or not exists (select 1 from public._pos_maps() m where m.map = p_map and p_x between 0 and m.w and p_y between 0 and m.h)
     or (p_map = 'wild' and (not v_world                                                  -- 0088: the wild is only a map in the world
         or not exists (select 1 from public._world_to_zone(p_x, p_y) z where z.zone = 'wild'))) then   -- 0088: a zone owns its rect
    v_why := 'off_map';
  elsif pp.account_id is not null and not (p_map = 'hall' and abs(p_x - 612) <= 16 and abs(p_y - 300) <= 16)
        and not (v_world and public._pos_at_waypoint(p_account, p_map, p_x, p_y, pp.map, pp.x, pp.y, pp.at)) then  -- 0088: just travelled there
    v_dt := extract(epoch from now() - pp.at);
    v_road := public._pos_road_s(p_account, p_map, pp.at, pp.skip_at);
    v_need := public._pos_need_s(pp.map, pp.x, pp.y, p_map, p_x, p_y, v_road);
    if v_need is null then v_why := 'no_path';
    elsif v_need > v_dt + 1 then v_why := 'too_fast';
    end if;
  end if;
  -- 0078 {
  -- a map the account's level has not unlocked (0070's map_levels): refused, not logged or counted (the client's
  -- portal gate normally stops it first); the position stays where it was
  -- 0088: the claimed map is the zone at the new point (map_levels has 'wild' at 1), so this is the zone's gate
  if v_why is null and p_map is distinct from pp.map and not public._map_unlocked(p_account, p_map) then
    return jsonb_build_object('anticheat', jsonb_build_object('code', 'pos_teleport', 'why', 'map_locked', 'strike', 0,
             'error', coalesce(p_error, 'map locked'), 'locked_until', null, 'banned', false, 'server_now', now()));
  end if;
  -- 0078 }
  if v_why is null then
    -- 0058 {
    if v_old then                                                                         -- only that tab's track moves
      update public.player_pos set tabs = public._pos_tabs(tabs, v_tab, p_map, p_x, p_y) where account_id = p_account;
      return null;
    end if;
    -- 0058 }
    insert into public.player_pos (account_id, map, x, y, at) values (p_account, p_map, p_x, p_y, now())   -- 0088: wx / wy by player_pos_world
    on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at;
    update public.player_pos set tab = coalesce(v_tab, tab),                                                            -- 0058
           tabs = case when v_tab is null then tabs else public._pos_tabs(tabs, v_tab, p_map, p_x, p_y) end            -- 0058
     where account_id = p_account;                                                                                    -- 0058
    return null;
  end if;
  -- 0058 {
  if v_old then                                                                           -- refused, not logged or counted
    return jsonb_build_object('anticheat', jsonb_build_object('code', 'pos_teleport', 'strike', 0, 'error', p_error,
             'locked_until', null, 'banned', false, 'server_now', now()));
  end if;
  -- 0058 }
  update public.player_pos
     set bad_count = case when bad_since is null or bad_since < now() - interval '1 hour' then 1 else bad_count + 1 end,
         bad_since = case when bad_since is null or bad_since < now() - interval '1 hour' then now() else bad_since end
   where account_id = p_account
  returning bad_count into v_n;
  v_ac := public._ac_flag(p_account, 'pos_teleport', p_rpc,
            jsonb_build_object('why', v_why, 'to', jsonb_build_object('map', left(p_map, 16), 'x', p_x, 'y', p_y),
                               'from', case when pp.account_id is not null then jsonb_build_object('map', pp.map, 'x', pp.x,
                                                                                    'y', pp.y, 'at', pp.at) end,
                               'dt', round(v_dt, 2), 'need', round(v_need, 2), 'count', v_n),
            p_room, p_error, false);
  if v_n = 30 then
    v_ac := public._ac_flag(p_account, 'pos_teleport_repeat', p_rpc,
              jsonb_build_object('count', v_n, 'since', (select bad_since from public.player_pos where account_id = p_account),
                                 'last', jsonb_build_object('map', left(p_map, 16), 'x', p_x, 'y', p_y)),
              p_room, p_error, true);
  end if;
  return v_ac;
end $$;
revoke all on function public._pos_claim(uuid, text, integer, integer, text, uuid, text) from public, anon, authenticated;

-- Where I stand, in world px (the unified client). The claim is the zone's: {ok, map, x, y} or the refusal's envelope.
create or replace function public.pos_report_w(p_session_token text, p_wx integer, p_wy integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_ac jsonb; z record;
begin
  select * into z from public._world_to_zone(p_wx, p_wy) limit 1;
  v_ac := public._pos_claim(v_account, z.zone, z.x, z.y, 'pos_report_w');
  return coalesce(v_ac, jsonb_build_object('ok', true, 'map', z.zone, 'x', z.x, 'y', z.y));
end $$;
revoke all on function public.pos_report_w(text, integer, integer) from public;
grant execute on function public.pos_report_w(text, integer, integer) to anon, authenticated;
