-- =========================================================
-- 0089_world_p3.sql — the unified world, phase P3 (docs/superpowers/specs/2026-09-29-unified-world-design.md §3, §5):
-- vehicles drive the world's roads. Owner (P3): "vehicles drive on the roads, up to 3× walking speed; the fixed road-trip
-- hops are removed". ADDITIVE and re-runnable. Run after 0088. With the unified_world flag OFF nothing changes.
--   A. vehicle_catalog.speed_mul: how many times the walking speed a vehicle rides the world, derived from its old trip
--      (walking the road took 15 s): 1 + 2 × (15000 − trip_ms) / 13000, capped at 3.0 — bike 1.77, moto 2.54, car 3.00.
--      lib/game/travel/vehicles.ts speedMul mirrors it.
--   B. player_pos.ride / ride_at: what the account last reported riding with an accepted pos_report_w ('bike' | 'moto' |
--      'car' | 'lift' = đi nhờ, or null on foot) and when.
--   C. _pos_ride_mul: the speed multiplier a claim may use — its own vehicle when it owns it; for a lift, the fastest
--      driver (another account riding a vehicle it owns, with an accepted claim in the last 10 s) within 48 px of the
--      claimed point, plus how far that driver may have ridden since its claim (the two heartbeats are not in step).
--   D. _pos_road_s (0057's, flag off verbatim): flag on — no road hops any more: it returns that multiplier (1 on foot),
--      the greater of the one the claim reports (pos_report_w, through the transaction-local app.pos_ride / app.pos_to)
--      and the one stored from the last report (a claim by any other RPC keeps the vehicle it was reported on).
--      _pos_need_s (0088's): flag on — the world trips are judged at 260 × that multiplier px/s; a trip the portal graph
--      judges (between two interiors) has no road seconds.
--   E. pos_report_w(token, wx, wy, ride): the heartbeat with what I ride. The 3-arg one (0088's; old clients) = on foot.
--   F. skip_trip (0057's, flag off verbatim): flag on — refused ('no road trips'): the paid xe ôm is gone, the fast travel
--      is waypoint_travel (0070 / 0088's world waypoints).
-- Re-created functions I did not create: _pos_road_s (0057's), _pos_need_s (0088's), pos_report_w (0088's), skip_trip
-- (0057's) — each verbatim but for the lines marked 0089. _pos_claim (0088's) is untouched: it calls both with the same
-- signatures. Lock order unchanged: heat_state → vitals → player_pos → wallet → anticheat_status.
-- =========================================================

-- ---------- A. Vehicle speed ----------
alter table public.vehicle_catalog add column if not exists speed_mul numeric(4, 2);
update public.vehicle_catalog set speed_mul = round(least(3.0, 1 + 2 * (15000 - trip_ms) / 13000.0), 2)
 where speed_mul is distinct from round(least(3.0, 1 + 2 * (15000 - trip_ms) / 13000.0), 2);
alter table public.vehicle_catalog alter column speed_mul set not null;
alter table public.vehicle_catalog drop constraint if exists vehicle_catalog_speed_mul_check;
alter table public.vehicle_catalog add constraint vehicle_catalog_speed_mul_check check (speed_mul between 1 and 3);

-- ---------- B. What I ride ----------
alter table public.player_pos add column if not exists ride text;
alter table public.player_pos add column if not exists ride_at timestamptz;
alter table public.player_pos drop constraint if exists player_pos_ride_check;
alter table public.player_pos add constraint player_pos_ride_check check (ride is null or ride in ('bike', 'moto', 'car', 'lift'));

-- ---------- C. The multiplier ----------
-- p_ride: a vehicle id, 'lift', or null (on foot). p_wx / p_wy: the claimed point (world px), needed for a lift.
create or replace function public._pos_ride_mul(p_account uuid, p_ride text, p_wx integer, p_wy integer) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when p_ride in ('bike', 'moto', 'car') then
      coalesce((select c.speed_mul from public.owned_vehicles o join public.vehicle_catalog c on c.id = o.vehicle_id
                 where o.account_id = p_account and o.vehicle_id = p_ride), 1)
    when p_ride = 'lift' and p_wx is not null and p_wy is not null then
      coalesce((select max(c.speed_mul) from public.player_pos d
                  join public.owned_vehicles o on o.account_id = d.account_id and o.vehicle_id = d.ride
                  join public.vehicle_catalog c on c.id = d.ride
                 where d.account_id <> p_account and d.wx is not null
                   and d.ride_at > now() - interval '10 seconds' and d.at > now() - interval '10 seconds'
                   and sqrt(((d.wx - p_wx)::numeric) ^ 2 + ((d.wy - p_wy)::numeric) ^ 2)
                       <= 48 + 260 * c.speed_mul * extract(epoch from now() - d.at)), 1)
    else 1 end
$$;
revoke all on function public._pos_ride_mul(uuid, text, integer, integer) from public, anon, authenticated;

-- ---------- D. The road seconds / the multiplier; the least seconds ----------
-- _pos_road_s (0057_server_position.sql's, verbatim in its flag-off branch; the rest marked 0089). Now plpgsql: it
-- reads the flag and the claim's settings.
create or replace function public._pos_road_s(p_account uuid, p_map text, p_since timestamptz, p_skip timestamptz)
returns numeric
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_ride text; v_to text; v_wx integer; v_wy integer; pp public.player_pos;                -- 0089
begin
  -- 0089 {
  if public._app_flag('unified_world') then
    v_ride := nullif(current_setting('app.pos_ride', true), '');      -- '-' = on foot, reported; null = not a report
    v_to := nullif(current_setting('app.pos_to', true), '');
    if v_to is not null then
      v_wx := split_part(v_to, ',', 1)::integer;
      v_wy := split_part(v_to, ',', 2)::integer;
    end if;
    select * into pp from public.player_pos where account_id = p_account;
    return greatest(1, public._pos_ride_mul(p_account, nullif(v_ride, '-'), v_wx, v_wy),
                       public._pos_ride_mul(p_account, pp.ride, v_wx, v_wy));
  end if;
  -- 0089 }
  return (
  select case when p_skip is not null and p_skip >= p_since then 0::numeric
    else 0.9 * least(15000,
      coalesce((select min(c.trip_ms) from public.owned_vehicles o join public.vehicle_catalog c on c.id = o.vehicle_id
                 where o.account_id = p_account), 15000),
      case when exists (select 1 from public.player_pos d
                         where d.map = p_map and d.at >= p_since and d.account_id <> p_account
                           and exists (select 1 from public.owned_vehicles o where o.account_id = d.account_id))
           then (select min(trip_ms) from public.vehicle_catalog) else 15000 end) / 1000.0 end
  );
end $$;
revoke all on function public._pos_road_s(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

-- _pos_need_s (0088_unified_world.sql's, verbatim but for the lines marked 0089). Flag on, p_road is _pos_road_s's
-- multiplier (1 … 3).
create or replace function public._pos_need_s(p_m0 text, p_x0 integer, p_y0 integer, p_m1 text, p_x1 integer, p_y1 integer,
                                              p_road numeric) returns numeric
language plpgsql stable
as $$
declare a integer[]; b integer[];                                                        -- 0088
        v_v numeric := 260.0;                                                            -- 0089: px/s
begin
  -- 0088 {
  if public._app_flag('unified_world') then
    v_v := 260.0 * greatest(1, least(3, coalesce(p_road, 1)));                           -- 0089: riding
    a := public._zone_to_world(p_m0, p_x0, p_y0);
    b := public._zone_to_world(p_m1, p_x1, p_y1);
    if a is not null and b is not null then
      return greatest(0, sqrt(((b[1] - a[1])::numeric) ^ 2 + ((b[2] - a[2])::numeric) ^ 2)
                         * case when public._world_adjacent(p_m0, p_m1) then 1 else 1.35 end - 64) / v_v;   -- 0089: v_v
    end if;
    -- P2: one end in an interior (the hầm, Mỏ đá underground): inside it to one of its portals, then through the world
    -- from where that portal comes out (× 1.35 unless the two are joined), less the slack and one hop's
    if a is null and b is not null and p_x0 is not null then
      return (select min(greatest(0, sqrt(((p.ux - p_x0)::numeric) ^ 2 + ((p.uy - p_y0)::numeric) ^ 2)
                          + sqrt(((b[1] - o.w[1])::numeric) ^ 2 + ((b[2] - o.w[2])::numeric) ^ 2)
                            * case when public._world_adjacent(p.to_map, p_m1) then 1 else 1.35 end - 64 - 40) / v_v)   -- 0089: v_v
                from public._world_portals() p cross join lateral (select public._zone_to_world(p.to_map, p.ax, p.ay) w) o
               where p.from_map = p_m0 and o.w is not null);
    end if;
    if b is null and a is not null and p_x1 is not null then
      return (select min(greatest(0, sqrt(((o.w[1] - a[1])::numeric) ^ 2 + ((o.w[2] - a[2])::numeric) ^ 2)
                            * case when public._world_adjacent(p_m0, p.from_map) then 1 else 1.35 end
                          + sqrt(((p_x1 - p.ax)::numeric) ^ 2 + ((p_y1 - p.ay)::numeric) ^ 2) - 64 - 40) / v_v)   -- 0089: v_v
                from public._world_portals() p cross join lateral (select public._zone_to_world(p.from_map, p.ux, p.uy) w) o
               where p.to_map = p_m1 and o.w is not null);
    end if;
    if (a is null and p_m0 = 'wild') or (b is null and p_m1 = 'wild') then return null; end if;
    p_road := 0;                                                                         -- 0089: no road hops in the world
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

-- ---------- E. The heartbeat with the ride ----------
-- Where I stand, in world px, and what I ride (null on foot; 'lift' riding along on someone's vehicle). The claim is the
-- zone's, judged at my ride's speed; accepted, the ride is stored for the next claims. {ok, map, x, y} or the refusal.
create or replace function public.pos_report_w(p_session_token text, p_wx integer, p_wy integer, p_ride text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_ac jsonb; z record;
        v_ride text := case when p_ride in ('bike', 'moto', 'car', 'lift') then p_ride end;
begin
  select * into z from public._world_to_zone(p_wx, p_wy) limit 1;
  perform set_config('app.pos_ride', coalesce(v_ride, '-'), true);
  perform set_config('app.pos_to', coalesce(p_wx::text || ',' || p_wy::text, ''), true);
  v_ac := public._pos_claim(v_account, z.zone, z.x, z.y, 'pos_report_w');
  perform set_config('app.pos_ride', '', true);
  perform set_config('app.pos_to', '', true);
  if v_ac is null and z.zone is not null then
    update public.player_pos set ride = v_ride, ride_at = case when v_ride is null then null else now() end
     where account_id = v_account;
  end if;
  return coalesce(v_ac, jsonb_build_object('ok', true, 'map', z.zone, 'x', z.x, 'y', z.y));
end $$;
revoke all on function public.pos_report_w(text, integer, integer, text) from public;
grant execute on function public.pos_report_w(text, integer, integer, text) to anon, authenticated;

-- pos_report_w (0088_unified_world.sql's 3-arg one, re-created 0089): an old client's heartbeat — on foot.
create or replace function public.pos_report_w(p_session_token text, p_wx integer, p_wy integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public.pos_report_w(p_session_token, p_wx, p_wy, null::text);                  -- 0089
end $$;
revoke all on function public.pos_report_w(text, integer, integer) from public;
grant execute on function public.pos_report_w(text, integer, integer) to anon, authenticated;

-- ---------- F. No road trips in the world ----------
-- skip_trip (0057_server_position.sql's, verbatim but for the lines marked 0089)
create or replace function public.skip_trip(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins int; v_bal int;
begin
  v_account := public._auth_account(p_session_token);
  if public._app_flag('unified_world') then                                              -- 0089: vehicles ride the roads;
    raise exception 'no road trips' using errcode = '22023';                             -- 0089: fast travel = waypoints
  end if;                                                                                -- 0089
  update public.player_pos set skip_at = now() where account_id = v_account;   -- 0057: the road may take no time (before the wallet: the lock order)
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < 20 then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -20, 'skip', 'xe om');
  return jsonb_build_object('coins', v_bal);
end; $$;
revoke all on function public.skip_trip(text) from public;
grant execute on function public.skip_trip(text) to anon, authenticated;
