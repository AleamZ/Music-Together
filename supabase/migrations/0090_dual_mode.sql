-- =========================================================
-- 0090_dual_mode.sql — 2D and 3D side by side on one Supabase data (owner: "trên 1 nền data Supabase, tôi muốn tồn tại
-- song song 2D và cả 3D — hai game chỉ khác đồ họa, còn tương tác vẫn vậy"). ADDITIVE and re-runnable. Run after 0089.
-- Until now 'unified_world' was GLOBAL: on, every claim was judged in world px (a 2D client's portal hop was too fast,
-- skip_trip refused). Now each claim is judged by the model of the client that sent it:
--   A. The mode of a claim: 'w' (the world: a 3D client) or '2' (the portal graph: a 2D client). pos_report_w → 'w',
--      pos_report on a zone → '2' (on an interior it keeps the mode it came with); any other RPC's claim takes the mode its tab last reported with (player_pos.tabs → {w: 'w'}),
--      else the account's (player_pos.mode, 'w' or null = 2D). With the flag off every claim is '2'. Accepted, a claim
--      stores its mode (a 2D claim writes exactly what it wrote before: no key in tabs, mode null).
--   B. _pos_world(): which model _pos_need_s / _pos_road_s apply — the transaction-local app.pos_world _pos_claim sets
--      around its calls ('1' / '0'), else (a direct call) the flag as before. The two re-created bodies (0089's) read
--      it instead of the flag; nothing else changes in them.
--   C. _pos_claim (0088's): a '2' claim is judged exactly as 0057 / 0078 did (the portal graph, road seconds and
--      skip_trip, the wild off the map, no waypoint exemption); a 'w' claim as 0088 / 0089 with the flag on. The first
--      claim after a mode change (a player switching graphics mid-session) is judged by BOTH models and the more
--      permissive wins (least of the two needs; the wild and the waypoint exemption allowed) — no strike for switching.
--      map / x / y (zone-local) and wx / wy (player_pos_world) are written by both, so both games read the same row.
--   D. skip_trip (0089's): refused ('no road trips') only for a caller whose tab plays the world; 2D keeps road trips.
--   E. 'unified_world' now means "world mode is available to 3D clients"; the first run of this migration turns it ON
--      (a re-run keeps whatever the owner set since; app_flags() is unchanged in shape).
-- Re-created functions I did not create: _pos_road_s (0089's), _pos_need_s (0089's), _pos_claim (0088's), skip_trip
-- (0089's) — each verbatim but for the lines marked 0090. Lock order unchanged: heat_state → vitals → player_pos →
-- wallet → anticheat_status.
-- =========================================================

-- ---------- E. World mode available by default (first: the first run is the one without player_pos.mode) ----------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'player_pos' and column_name = 'mode') then
    update public.app_flags set enabled = true, changed_at = now() where key = 'unified_world';
  end if;
end $$;

-- ---------- A. The stored mode ----------
alter table public.player_pos add column if not exists mode text;
alter table public.player_pos drop constraint if exists player_pos_mode_check;
alter table public.player_pos add constraint player_pos_mode_check check (mode is null or mode = 'w');

-- The mode a tab last claimed with: its entry in tabs (a 'w' key, none = 2D), else the account's.
create or replace function public._pos_mode_of(p_tabs jsonb, p_mode text, p_tab text) returns text
language sql immutable
as $$
  select case when p_tab is not null and coalesce(p_tabs, '{}'::jsonb) ? p_tab then coalesce(p_tabs -> p_tab ->> 'w', '2')
              else coalesce(p_mode, '2') end
$$;
revoke all on function public._pos_mode_of(jsonb, text, text) from public, anon, authenticated;

-- _pos_tabs (0058's) and the mode: a world claim marks its tab's entry; a 2D one is 0058's entry, byte for byte.
create or replace function public._pos_tabs_m(p_tabs jsonb, p_tab text, p_map text, p_x integer, p_y integer, p_mode text)
returns jsonb
language sql stable
as $$
  select case when p_mode = 'w' and t ? p_tab then jsonb_set(t, array[p_tab, 'w'], '"w"') else t end
    from (select public._pos_tabs(p_tabs, p_tab, p_map, p_x, p_y) t) q
$$;
revoke all on function public._pos_tabs_m(jsonb, text, text, integer, integer, text) from public, anon, authenticated;

-- ---------- B. Which model ----------
create or replace function public._pos_world() returns boolean
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v text := nullif(current_setting('app.pos_world', true), '');
begin
  return case v when '1' then true when '0' then false else public._app_flag('unified_world') end;
end $$;
revoke all on function public._pos_world() from public, anon, authenticated;

-- _pos_road_s (0089_world_p3.sql's, verbatim but for the line marked 0090)
create or replace function public._pos_road_s(p_account uuid, p_map text, p_since timestamptz, p_skip timestamptz)
returns numeric
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_ride text; v_to text; v_wx integer; v_wy integer; pp public.player_pos;                -- 0089
begin
  -- 0089 {
  if public._pos_world() then                                                                    -- 0090: the claim's model
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

-- _pos_need_s (0089_world_p3.sql's, verbatim but for the line marked 0090)
create or replace function public._pos_need_s(p_m0 text, p_x0 integer, p_y0 integer, p_m1 text, p_x1 integer, p_y1 integer,
                                              p_road numeric) returns numeric
language plpgsql stable
as $$
declare a integer[]; b integer[];                                                        -- 0088
        v_v numeric := 260.0;                                                            -- 0089: px/s
begin
  -- 0088 {
  if public._pos_world() then                                                            -- 0090: the claim's model
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

-- ---------- C. Claims ----------
-- _pos_claim (0088_unified_world.sql's, verbatim but for the lines marked 0090)
create or replace function public._pos_claim(p_account uuid, p_map text, p_x integer, p_y integer, p_rpc text,
                                             p_room uuid default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare pp public.player_pos; v_dt numeric; v_need numeric; v_why text; v_n integer; v_ac jsonb; v_road numeric;
        v_tab text := public._pos_tab(); v_old boolean; v_own jsonb;                     -- 0058
        v_world boolean;                                                                 -- 0090: this claim may use the world
        v_flag boolean := public._app_flag('unified_world');                             -- 0090
        v_mode text; v_prev text; v_switch boolean := false; v_m text; v_nm numeric;     -- 0090
        v_first boolean := true; v_saved text := current_setting('app.pos_world', true);  -- 0090
begin
  select * into pp from public.player_pos where account_id = p_account for update;
  -- 0090 {
  -- the claim's model: the world for pos_report_w, the portal graph for pos_report, else the one its tab last used
  v_prev := public._pos_mode_of(pp.tabs, pp.mode, v_tab);
  -- (an interior claimed by pos_report — the 3D client's too — keeps the mode it came with)
  v_mode := case when not v_flag then '2' when p_rpc = 'pos_report_w' then 'w'
                 when p_rpc = 'pos_report' and exists (select 1 from public._world_zones() z where z.zone = p_map) then '2'
                 else v_prev end;
  -- the first claim after a switch of graphics: judged by both, the more permissive wins
  v_switch := v_flag and pp.account_id is not null and v_prev <> v_mode;
  v_world := v_mode = 'w' or v_switch;
  -- 0090 }
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
    -- 0090 {
    foreach v_m in array case when v_switch then array['w', '2'] else array[v_mode] end loop
      perform set_config('app.pos_world', case when v_m = 'w' then '1' else '0' end, true);
      v_road := public._pos_road_s(p_account, p_map, pp.at, pp.skip_at);
      v_nm := public._pos_need_s(pp.map, pp.x, pp.y, p_map, p_x, p_y, v_road);
      v_need := case when v_first then v_nm else least(v_need, v_nm) end;                -- least: a null (no path) loses
      v_first := false;
    end loop;
    perform set_config('app.pos_world', coalesce(v_saved, ''), true);                  -- back as it was
    -- 0090 }
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
      update public.player_pos set tabs = public._pos_tabs_m(tabs, v_tab, p_map, p_x, p_y, v_mode)   -- 0090: + its mode
       where account_id = p_account;
      return null;
    end if;
    -- 0058 }
    insert into public.player_pos (account_id, map, x, y, at) values (p_account, p_map, p_x, p_y, now())   -- 0088: wx / wy by player_pos_world
    on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at;
    update public.player_pos set tab = coalesce(v_tab, tab),                                                            -- 0058
           tabs = case when v_tab is null then tabs else public._pos_tabs_m(tabs, v_tab, p_map, p_x, p_y, v_mode) end, -- 0058 (0090: + mode)
           mode = case when v_mode = 'w' then 'w' end                                                                  -- 0090
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

-- ---------- D. Road trips for the 2D game ----------
-- skip_trip (0089_world_p3.sql's, verbatim but for the lines marked 0090)
create or replace function public.skip_trip(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins int; v_bal int;
begin
  v_account := public._auth_account(p_session_token);
  if public._app_flag('unified_world')                                                   -- 0089: vehicles ride the roads;
     and (select public._pos_mode_of(p.tabs, p.mode, public._pos_tab()) from public.player_pos p
           where p.account_id = v_account) = 'w' then                                    -- 0090: only in the world (3D)
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

