-- =========================================================
-- 0057_server_position.sql — anti-cheat v2 #3, #11, #14, #15: a server-side position (docs/superpowers/plans/
-- 2026-09-28-anticheat-v2-part1.md, part B). ADDITIVE and re-runnable. Run after 0056.
--   A. player_pos: the last ACCEPTED claim of where an account stands (map, x, y, at), the last paid skip of the road,
--      and the refused claims of the last hour.
--   B. The town's geometry (lib/game/maps mirrors it; tests/unit/anticheat-v2-position.test.ts pins them equal): the
--      maps' sizes, the portals (the use point on one map → the arrive spot on the next; the two roads) and the hall's
--      spawn. _pos_road_s, _pos_need_s: the least seconds from one point to another — walking at VMAX 260 px/s over at
--      most 3 portal hops, less 64 px and 40 px a hop of slack, plus each road hop at 0.9 × the fastest trip the account
--      could take (its own vehicles; a car when someone with a vehicle arrived on that map since; none after a paid skip).
--   C. _pos_claim: a claim is accepted when that time ≤ the seconds since the last accepted claim + 1 s (always: the first
--      claim, the hall's spawn). A refused one keeps the old position, logs the soft 'pos_teleport' and counts; the 30th
--      within an hour is the hard 'pos_teleport_repeat'. pos_report(token, map, x, y): the claim on every map arrival.
--   D. Claims and uses: vitals_tick (0045) claims where it stands and judges the shade, the rain and the swim from the
--      server's position (none known = outdoors); sell_*_market (0028) claim their depot on Chợ Lớn ('not at market');
--      start_cast (0047) and start_net (0056) claim their cell ('too far'; a cast without a cell is 'bad spot');
--      jump_in / rescue_swimmer (0033) claim their cell, and a rescue needs the victim's server position within reach
--      ('too far'); skip_trip (0027) marks the paid skip.
--   E. _vitals_apply (all three overloads, 0045): the real seconds since the last tick up to 1 800 (was 120) — ticks
--      that stop no longer stop hunger and thirst; a longer gap is a logout and drains its first 30 min.
-- Lock order: heat_state → vitals → player_pos → wallet → anticheat_status.
-- =========================================================

-- ---------- A. The position ----------
create table if not exists public.player_pos (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  map text not null,
  x integer not null,
  y integer not null,
  at timestamptz not null default now(),   -- when this claim was accepted
  skip_at timestamptz,                     -- the last paid skip of the road (skip_trip)
  bad_since timestamptz,                   -- the refused claims of the hour that started then
  bad_count integer not null default 0
);
create index if not exists idx_player_pos_map on public.player_pos (map, at);
alter table public.player_pos enable row level security;
revoke all on public.player_pos from anon, authenticated;

-- ---------- B. The geometry ----------
create or replace function public._pos_maps() returns table (map text, w integer, h integer)
language sql immutable parallel safe
as $$
  values ('hall', 640, 400), ('pond', 640, 400), ('field', 800, 480), ('market', 1280, 400), ('khu_nha', 800, 400),
         ('bai_dat', 800, 400), ('ham_ngam', 480, 320)
$$;

-- Each way across: where one stands to use it (ux, uy) and where one arrives (ax, ay). The roads are the cutscenes.
create or replace function public._pos_portals() returns table (from_map text, to_map text, ux integer, uy integer,
                                                                ax integer, ay integer, road boolean)
language sql immutable parallel safe
as $$
  values ('hall', 'pond', 516, 334, 300, 356, false), ('hall', 'field', 62, 236, 60, 106, false),
         ('hall', 'market', 604, 200, 72, 252, true),
         ('pond', 'hall', 352, 374, 516, 334, false), ('pond', 'field', 190, 348, 760, 244, false),
         ('field', 'hall', 60, 106, 62, 236, false), ('field', 'pond', 760, 244, 190, 348, false),
         ('market', 'hall', 40, 244, 584, 224, true), ('market', 'khu_nha', 1236, 196, 68, 208, true),
         ('market', 'bai_dat', 1180, 358, 400, 48, false), ('market', 'ham_ngam', 640, 352, 48, 84, false),
         ('khu_nha', 'market', 40, 196, 1206, 204, true), ('bai_dat', 'market', 400, 36, 1180, 356, false),
         ('ham_ngam', 'market', 48, 52, 640, 350, false)
$$;
revoke all on function public._pos_maps() from public, anon, authenticated;
revoke all on function public._pos_portals() from public, anon, authenticated;

-- Seconds a road hop takes at least for this account arriving on p_map (claims after p_since): 0.9 × the fastest trip it
-- could have taken — on foot 15 s, its own vehicles, or the fastest vehicle when another account owning one made an
-- accepted claim on that map since (đi nhờ xe); 0 once a skip was paid since.
create or replace function public._pos_road_s(p_account uuid, p_map text, p_since timestamptz, p_skip timestamptz)
returns numeric
language sql stable security definer set search_path = public, extensions
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
revoke all on function public._pos_road_s(uuid, text, timestamptz, timestamptz) from public, anon, authenticated;

-- The least seconds from (m0, x0, y0) to (m1, x1, y1) with road hops of p_road s: null when no path of ≤ 3 hops.
create or replace function public._pos_need_s(p_m0 text, p_x0 integer, p_y0 integer, p_m1 text, p_x1 integer, p_y1 integer,
                                              p_road numeric) returns numeric
language sql immutable parallel safe
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
revoke all on function public._pos_need_s(text, integer, integer, text, integer, integer, numeric) from public, anon, authenticated;

-- ---------- C. Claims ----------
-- A client says where it stands. Accepted (null) when reachable from the last accepted claim in the time since (+ 1 s),
-- the first claim ever or the hall's spawn (entering game mode, a faint). Refused: the envelope of the soft
-- 'pos_teleport' (with p_error, the refusal the caller stands for), or at the 30th refusal within the hour the hard
-- 'pos_teleport_repeat'; the position stays where it was.
create or replace function public._pos_claim(p_account uuid, p_map text, p_x integer, p_y integer, p_rpc text,
                                             p_room uuid default null, p_error text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare pp public.player_pos; v_dt numeric; v_need numeric; v_why text; v_n integer; v_ac jsonb; v_road numeric;
begin
  select * into pp from public.player_pos where account_id = p_account for update;
  if p_map is null or p_x is null or p_y is null
     or not exists (select 1 from public._pos_maps() m where m.map = p_map and p_x between 0 and m.w and p_y between 0 and m.h) then
    v_why := 'off_map';
  elsif pp.account_id is not null and not (p_map = 'hall' and abs(p_x - 612) <= 16 and abs(p_y - 300) <= 16) then
    v_dt := extract(epoch from now() - pp.at);
    v_road := public._pos_road_s(p_account, p_map, pp.at, pp.skip_at);
    v_need := public._pos_need_s(pp.map, pp.x, pp.y, p_map, p_x, p_y, v_road);
    if v_need is null then v_why := 'no_path';
    elsif v_need > v_dt + 1 then v_why := 'too_fast';
    end if;
  end if;
  if v_why is null then
    insert into public.player_pos (account_id, map, x, y, at) values (p_account, p_map, p_x, p_y, now())
    on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at;
    return null;
  end if;
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

-- Where I arrived (the client sends it on every map change). Not a game action: it runs during a lock too.
create or replace function public.pos_report(p_session_token text, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_ac jsonb;
begin
  v_ac := public._pos_claim(v_account, p_map, p_x, p_y, 'pos_report');
  return coalesce(v_ac, jsonb_build_object('ok', true));
end $$;
revoke all on function public.pos_report(text, text, integer, integer) from public;
grant execute on function public.pos_report(text, text, integer, integer) to anon, authenticated;

-- ---------- D. The claims in the game RPCs ----------
-- skip_trip (0027's, verbatim but for the line marked 0057)
create or replace function public.skip_trip(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins int; v_bal int;
begin
  v_account := public._auth_account(p_session_token);
  update public.player_pos set skip_at = now() where account_id = v_account;   -- 0057: the road may take no time (before the wallet: the lock order)
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < 20 then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -20, 'skip', 'xe om');
  return jsonb_build_object('coins', v_bal);
end; $$;
revoke all on function public.skip_trip(text) from public;
grant execute on function public.skip_trip(text) to anon, authenticated;

-- sell_fish_market, sell_rice_market, sell_produce_market (0028's, verbatim but for the lines marked 0057): the sale is a
-- claim at the depot's counter on Chợ Lớn (Vựa cá at (80, 360), Vựa nông sản at (720, 360)).
create or replace function public.sell_fish_market(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer; v_pay integer;
        v_ac jsonb;                                                                      -- 0057
begin
  v_account := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_account, 'market', 80, 360, 'sell_fish_market', null, 'not at market');   -- 0057: at Vựa cá Chợ Lớn
  if v_ac is not null then return v_ac; end if;                                                       -- 0057
  perform public._wallet_lock(v_account);
  with sold as (
    delete from public.fish where account_id = v_account and id = any(coalesce(p_fish_ids, '{}'::uuid[])) returning price
  ) select count(*), coalesce(sum(price), 0) into v_count, v_sum from sold;
  if v_count = 0 then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  v_pay := public._market_depot_pay(v_sum);
  perform public._pay(v_account, v_pay, 'sell', v_count || ' con (Chợ Lớn)');
  return jsonb_build_object('sold', v_count, 'earned', v_pay, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.sell_rice_market(p_session_token text, p_variety text, p_dry boolean, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v public.rice_varieties; rs public.rice_stock; v_pay integer;
        v_ac jsonb;                                                                      -- 0057
begin
  v_account := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_account, 'market', 720, 360, 'sell_rice_market', null, 'not at market');  -- 0057: at Vựa nông sản
  if v_ac is not null then return v_ac; end if;                                                       -- 0057
  perform public._wallet_lock(v_account);
  if p_kg is null or p_kg < 1 or p_dry is null then
    return public._ac_flag(v_account, 'bad_qty', 'sell_rice_market',
                           jsonb_build_object('variety', left(p_variety, 32), 'kg', p_kg, 'dry', p_dry), null, 'invalid quantity');
  end if;
  v := public._variety(p_variety);
  if v.id is null then
    raise exception 'invalid variety' using errcode = '22023';
  end if;
  select * into rs from public.rice_stock where account_id = v_account and variety = p_variety for update;
  if not found or (case when p_dry then rs.dry_kg else rs.wet_kg end) < p_kg then
    raise exception 'not enough rice' using errcode = '22023';
  end if;
  v_pay := case when p_dry then p_kg * v.price_per_kg else (p_kg * v.price_per_kg * 7) / 10 end;
  v_pay := public._market_depot_pay(v_pay);
  update public.rice_stock
     set dry_kg = dry_kg - case when p_dry then p_kg else 0 end, wet_kg = wet_kg - case when p_dry then 0 else p_kg end
   where account_id = v_account and variety = p_variety;
  perform public._pay(v_account, v_pay, 'rice_sell',
                      p_variety || case when p_dry then ' dry ' else ' wet ' end || p_kg || ' kg (Chợ Lớn)');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

create or replace function public.sell_produce_market(p_session_token text, p_upland text, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; u public.upland_crops; ps public.produce_stock;
        v_ac jsonb;                                                                      -- 0057
begin
  v_account := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_account, 'market', 720, 360, 'sell_produce_market', null, 'not at market');   -- 0057: at Vựa nông sản
  if v_ac is not null then return v_ac; end if;                                                          -- 0057
  perform public._wallet_lock(v_account);
  if p_kg is null or p_kg < 1 then
    return public._ac_flag(v_account, 'bad_qty', 'sell_produce_market', jsonb_build_object('upland', left(p_upland, 32), 'kg', p_kg),
                           null, 'invalid quantity');
  end if;
  u := public._upland(p_upland);
  if u.id is null then
    raise exception 'invalid crop' using errcode = '22023';
  end if;
  select * into ps from public.produce_stock where account_id = v_account and upland = p_upland for update;
  if not found or ps.kg < p_kg then
    raise exception 'not enough crop' using errcode = '22023';
  end if;
  update public.produce_stock set kg = kg - p_kg where account_id = v_account and upland = p_upland;
  perform public._pay(v_account, public._market_depot_pay(p_kg * u.price_per_kg), 'produce_sell',
                      p_upland || ' ' || p_kg || ' kg (Chợ Lớn)');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;
revoke all on function public.sell_fish_market(text, uuid[]) from public;
revoke all on function public.sell_rice_market(text, text, boolean, integer) from public;
revoke all on function public.sell_produce_market(text, text, integer) from public;
grant execute on function public.sell_fish_market(text, uuid[]) to anon, authenticated;
grant execute on function public.sell_rice_market(text, text, boolean, integer) to anon, authenticated;
grant execute on function public.sell_produce_market(text, text, integer) to anon, authenticated;

-- start_cast (0047's, verbatim but for the lines marked 0057): the cast's cell is a claim on the pond.
create or replace function public.start_cast(p_room_id uuid, p_session_token text, p_col integer default null,
                                             p_row integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);                                   -- v18.8
        v_spot text := 'dock'; v_bites boolean := true;                                  -- v18.1
        v_boost real;                                                                    -- v18.2
        v_seed bigint := floor(random() * 4294967296)::bigint;                           -- 0046: the reel's seed (u32)
        v_vitals jsonb;                                                                  -- 0047
        v_ac jsonb;                                                                      -- 0057
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_col is null or p_row is null then raise exception 'bad spot' using errcode = '22023'; end if;   -- 0057: the cell is where I stand (every client since v18.1)
  if p_col is not null or p_row is not null then                                         -- v18.1: null = an older client (docks only)
    v_spot := public._pond_spot(p_col, p_row);
    if v_spot is null then raise exception 'bad spot' using errcode = '22023'; end if;
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;   -- v18.8
  perform public._vitals_guard(v_account);
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'start_cast', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                     -- 0057
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then                                       -- v18.2
    raise exception 'rod broken' using errcode = '22023';
  end if;
  -- 1. / 1b. 0047: no hourly or daily cast cap (casts cost hunger and thirst instead, step 6)
  -- 2. a new cast abandons the previous one (its bait is already spent)
  delete from public.casts where account_id = v_account;
  -- 3. room for the catch
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  -- 4. one bait: the selected kind, else worms
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);    -- v18.2
  -- 5. roll the fish (v14 spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,          -- v18.8: weather
                                  not (public._room_weather(p_room_id)).is_day);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);   -- v18.8: fewer bites = longer wait
  v_bite := greatest(1000, round(v_bite * v_boost)::int);                                 -- v18.2: a boosting bait
  if v_spot = 'shore' then                                                                -- v18.1: the shore's odds
    v_bite := least(60000, round(v_bite * 1.5)::int);
    v_bites := random() < case when v_boost < 1 then 0.8 else 0.4 end;                    -- v18.2: 80% with a boost
  end if;
  if v_bites and public._rain_cold(v_account) and random() < 0.3 then                     -- v18.9: cảm lạnh
    v_bites := false;
  end if;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod,                                         -- v18.1
                            reel_seed, reel_params)                                        -- 0046
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          v_spot, v_bites, sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,   -- v18.1
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),                        -- 0046
                                     'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
  returning id into v_id;
  -- 6. 0047: the effort — hunger 1.8, thirst 2.2 (no cap counters, no cast_daily_cap flag)
  v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'reel_seed', v_seed,                                                                  -- 0046
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;
grant execute on function public.start_cast(uuid, text, integer, integer) to anon, authenticated;

-- start_net (0056's, verbatim but for the lines marked 0057): the throw's cell is a claim on the pond.
create or replace function public.start_net(p_room_id uuid, p_session_token text, p_col integer, p_row integer,
                                            p_net text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_d integer; v_seed integer;
        v_id uuid; v_beat integer; v_bucket integer;
        v_vitals jsonb;                                                                  -- 0047
        v_arrow bigint := floor(random() * 2147483648)::bigint;                          -- 0056: kéo lưới's seed, kept until the haul
        v_ac jsonb;                                                                      -- 0057
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'start_net', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                    -- 0057
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_net and kind = 'net') then
    raise exception 'no net' using errcode = '22023';
  end if;
  select durability into v_d from public.inventory where account_id = v_account and item_id = p_net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  -- 0047: no hourly or daily cast cap
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then raise exception 'hands full' using errcode = '22023'; end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  delete from public.casts where account_id = v_account;
  delete from public.net_throws where account_id = v_account;
  -- 0056 was: if v_d <= 1 then
  -- 0056 was:   delete from public.inventory where account_id = v_account and item_id = p_net;
  -- 0056 was: else
  -- 0056 was:   update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = p_net;
  -- 0056 was: end if;
  v_seed := floor(random() * 2147483647)::int;
  v_beat := public._net_beat_ms(v_seed);
  insert into public.net_throws (account_id, room_id, net, seed, beat_ms, arrow_seed)   -- 0056 was: insert into public.net_throws (account_id, room_id, net, seed, beat_ms)
  values (v_account, p_room_id, p_net, v_seed, v_beat, v_arrow) returning id into v_id;   -- 0056 was: values (v_account, p_room_id, p_net, v_seed, v_beat) returning id into v_id;
  -- 0056 was: v_vitals := public._fishing_effort(v_account, 3, 3.5);                                 -- 0047: a throw's effort
  return jsonb_build_object('throw_id', v_id, 'seed', v_seed, 'beat_ms', v_beat,
    'radius_px', (select radius_px from public.shop_items where id = p_net),
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;
revoke all on function public.start_net(uuid, text, integer, integer, text) from public;
grant execute on function public.start_net(uuid, text, integer, integer, text) to anon, authenticated;

-- jump_in (0033's, verbatim but for the lines marked 0057): the bank cell is a claim on the pond.
create or replace function public.jump_in(p_room_id uuid, p_session_token text, p_col integer, p_row integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token); h public.heat_state; v_cramp boolean;
        v_ac jsonb;                                                                      -- 0057
begin
  h := public._heat_resolve(v_account);
  perform public._vitals_guard(v_account);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'jump_in', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                  -- 0057
  if h.cramp_until is not null then raise exception 'cramp' using errcode = '53400'; end if;
  v_cramp := random() < public._cramp_chance(h.shocked, coalesce(h.warm_until > now(), false));
  update public.heat_state set swimming = true, swim_room = p_room_id, warm_started_at = null,
    outdoor_since = null, shocked = false,
    cramp_until = case when v_cramp then now() + interval '10 seconds' end,
    cramp_room = case when v_cramp then p_room_id end
   where account_id = v_account returning * into h;
  return public._heat_json(h) || jsonb_build_object('cramp', v_cramp);
end; $$;

-- rescue_swimmer (0033's, verbatim but for the lines marked 0057): the rescuer's cell is a claim, and the victim's server
-- position must be on the pond within reach (28 px, 64 px of slack, 35 px/s of swimming since its claim, ≤ 20 s).
create or replace function public.rescue_swimmer(p_room_id uuid, p_session_token text, p_victim uuid,
                                                 p_col integer, p_row integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._heat_member(p_room_id, p_session_token); h public.heat_state;
        v_ac jsonb; vp public.player_pos;                                                -- 0057
begin
  if p_victim is null or p_victim = v_account then raise exception 'bad victim' using errcode = '22023'; end if;
  perform public._vitals_guard(v_account);
  if public._pond_spot(p_col, p_row) is null
     and not (p_col between 0 and 79 and p_row between 0 and 49
              and public._pond_in(p_col * 8 + 4, p_row * 8 + 4, 6)) then
    raise exception 'bad spot' using errcode = '22023';
  end if;
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'rescue_swimmer', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                         -- 0057
  if not exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = p_victim) then
    raise exception 'bad victim' using errcode = '22023';
  end if;
  h := public._heat_resolve(p_victim);
  if h.cramp_until is null or h.cramp_room is distinct from p_room_id then
    raise exception 'not cramping' using errcode = '53400';
  end if;
  -- 0057 {
  select * into vp from public.player_pos where account_id = p_victim;
  if vp.map is distinct from 'pond'
     or sqrt(((vp.x - (p_col * 8 + 4))::numeric) ^ 2 + ((vp.y - (p_row * 8 + 4))::numeric) ^ 2)
        > 28 + 64 + 35 * least(20, extract(epoch from now() - vp.at)) then
    raise exception 'too far' using errcode = '22023';
  end if;
  -- 0057 }
  update public.heat_state set cramp_until = null, cramp_room = null, swimming = false, swim_room = null,
    immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
   where account_id = p_victim;
  return jsonb_build_object('rescued', p_victim);
end; $$;
revoke all on function public.jump_in(uuid, text, integer, integer) from public;
revoke all on function public.rescue_swimmer(uuid, text, uuid, integer, integer) from public;
grant execute on function public.jump_in(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.rescue_swimmer(uuid, text, uuid, integer, integer) to anon, authenticated;

-- vitals_tick (0045's, verbatim but for the lines marked 0057): where I stand is a claim; the shade, the rain and the
-- swim are judged from the server's position (none known: outdoors).
create or replace function public.vitals_tick(p_session_token text, p_room_id uuid, p_map text default null,
                                              p_x integer default null, p_y integer default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
        v_member boolean; h public.heat_state; w public.room_weather; v_out boolean; v_hot boolean;   -- v18.10
        v_since timestamptz; v_fainted boolean; v_vit public.vitals;                                   -- v18.10
        v_cat numeric := public._pet_cat_factor(v_account);                                             -- v18.12
        rs public.rain_state; v_rainy boolean; v_dt numeric := 0; u public.umbrellas;                   -- v18.9
        v_exposed boolean := false; v_fast boolean := false; v_faint boolean := false;                   -- v18.9
        v_rest numeric := public._rest_factor(v_account);                                                -- v19.1
        v_len interval;                                                                                  -- faint ladder
        pp public.player_pos;                                                                            -- 0057
begin
  v_member := p_room_id is not null
              and exists (select 1 from public.members m where m.room_id = p_room_id and m.account_id = v_account);
  h := public._heat_resolve(v_account);                                                  -- v18.10: drowning
  -- 0057 {
  perform 1 from public.vitals where account_id = v_account for update;                  -- the lock order: vitals, then the position
  if p_map is not null or p_x is not null or p_y is not null then
    perform public._pos_claim(v_account, p_map, p_x, p_y, 'vitals_tick', case when v_member then p_room_id end);
  end if;
  select * into pp from public.player_pos where account_id = v_account;
  -- 0057 }
  v_fainted := coalesce((select fainted_until > now() from public.vitals where account_id = v_account), false);
  if v_member then w := public._room_weather(p_room_id); end if;
  v_hot := v_member and w.updated_at is not null and public._heat_hot(w.kind, w.is_day, w.temp_c);
  -- a swimmer who reports a spot out of the pond's water (a reload mid-swim, another map) is not swimming any more
  if h.swimming and h.cramp_until is null and pp.map is not null                         -- 0057 was: if h.swimming and h.cramp_until is null and p_map is not null and p_x is not null and p_y is not null
     and not (pp.map = 'pond' and public._pond_in(pp.x, pp.y, 6)) then                  -- 0057 was: and not (p_map = 'pond' and public._pond_in(p_x, p_y, 6)) then
    update public.heat_state set swimming = false, swim_room = null where account_id = v_account returning * into h;
  end if;
  v_out := (pp.map is null or not public._in_shade(pp.map, pp.x, pp.y)) and not h.swimming and h.cramp_until is null and not v_fainted;   -- 0057 was: v_out := not public._in_shade(p_map, p_x, p_y) and not h.swimming and h.cramp_until is null and not v_fainted;
  if v_hot and v_out and not coalesce(h.immune_until > now(), false) then
    v_since := case when h.outdoor_since is null or h.last_seen is null or h.last_seen < now() - interval '120 seconds'
                    then now() else h.outdoor_since end;
  end if;
  update public.heat_state set outdoor_since = v_since,
    shocked = v_since is not null and v_since <= now() - interval '10 minutes', last_seen = now()
   where account_id = v_account returning * into h;
  -- v18.9: the rain, over the seconds since the last heartbeat (at most 120)
  rs := public._rain_row(v_account);                                                     -- v18.9
  if rs.last_seen is not null then                                                       -- v18.9
    v_dt := least(120, greatest(0, extract(epoch from now() - rs.last_seen)));           -- v18.9
  end if;                                                                                -- v18.9
  v_rainy := v_member and w.updated_at is not null and public._rain_kind(w.kind);        -- v18.9
  if v_rainy and v_out then                                                              -- v18.9
    select * into u from public.umbrellas where account_id = v_account and held for update;
    if u.id is not null then                                                             -- v18.9: the umbrella wears
      u.left_s := u.left_s - v_dt * case when w.kind = 'storm' then 3 else 1 end;
      if u.left_s <= 0 then
        delete from public.umbrellas where id = u.id;
        rs.broke_at := now();
      else
        update public.umbrellas set left_s = u.left_s where id = u.id;
      end if;
    end if;
    v_exposed := u.id is null or u.left_s <= 0;                                          -- v18.9: a broken one is gone
  end if;
  if v_exposed then                                                                      -- v18.9: wet
    v_fast := rs.wet_s >= 300;
    rs.wet_s := rs.wet_s + v_dt; rs.dry_s := 0;
    if rs.cold_until > now() then rs.cold_wet_s := rs.cold_wet_s + v_dt; end if;
  elsif rs.wet_s > 0 then                                                                -- v18.9: drying
    rs.dry_s := rs.dry_s + v_dt;
    if rs.dry_s >= 120 then rs.wet_s := 0; rs.dry_s := 0; rs.cold_wet_s := 0; end if;
  end if;
  v_vit := public._vitals_apply(v_account,
    (case when v_member then (public._room_effects(p_room_id)->>'thirst')::numeric else 1 end)
    * case when h.shocked then 2 else 1 end                                              -- v18.10: ×2 heat-shocked
    * v_cat                                                                              -- v18.12: the mèo
    * v_rest,                                                                            -- v19.1: Ngủ ngon
    v_cat * case when v_fast then 24 else 1 end                                          -- v18.12: the mèo; v18.9: ×24 wet
    * v_rest);                                                                           -- v19.1: Ngủ ngon
  if v_fast and v_vit.hunger <= 0 and not coalesce(rs.cold_until > now(), false) then   -- v18.9: cảm lạnh
    rs.cold_until := now() + interval '30 minutes'; rs.cold_wet_s := 0;
  end if;
  if rs.cold_until > now() and rs.cold_wet_s >= 300 and v_vit.fainted_until is null then -- v18.9: the cold faint
    v_faint := true;
    rs.wet_s := 0; rs.dry_s := 0; rs.cold_wet_s := 0;
  end if;
  if v_rainy and v_out and v_vit.fainted_until is null and not v_faint                  -- v18.9: lightning
     and not coalesce(rs.strike_cd_until > now(), false) and v_dt > 0
     and random() < public._strike_chance(v_dt) then
    v_faint := true;
    rs.struck_at := now(); rs.strike_cd_until := now() + interval '30 minutes';
  end if;
  if v_faint then                                                                        -- v18.9: the v18.3 faint
    v_len := public._faint(v_account);                                                   -- faint ladder
    update public.vitals set fainted_until = now() + v_len, starve_s = 0                 -- faint ladder
     where account_id = v_account returning * into v_vit;
  end if;
  update public.rain_state set wet_s = rs.wet_s, dry_s = rs.dry_s, cold_until = rs.cold_until,          -- v18.9
    cold_wet_s = rs.cold_wet_s, strike_cd_until = rs.strike_cd_until, struck_at = rs.struck_at,
    broke_at = rs.broke_at, last_seen = now()
   where account_id = v_account;
  return public._vitals_json(v_vit) || jsonb_build_object('heat', public._heat_json(h))
         || jsonb_build_object('rain', public._rain_json(v_account, v_exposed));          -- v18.9
end; $$;
revoke all on function public.vitals_tick(text, uuid, text, integer, integer) from public;
grant execute on function public.vitals_tick(text, uuid, text, integer, integer) to anon, authenticated;

-- ---------- E. The drain by real time ----------
-- _vitals_apply, 1 argument (0045's, verbatim but for the line marked 0057).
create or replace function public._vitals_apply(p_account uuid) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400;
  tr constant numeric := 100.0 / 57600;
  dt numeric; zh numeric; zt numeric; nh numeric; nt numeric;
begin
  insert into public.vitals(account_id) values (p_account) on conflict do nothing;
  select * into v from public.vitals where account_id = p_account for update;
  if v.fainted_until is not null then
    if v.fainted_until <= now() then
      v.fainted_until := null; v.hunger := 30; v.thirst := 30; v.starve_s := 0;
    end if;
  else
    dt := least(1800, greatest(0, extract(epoch from now() - v.last_tick)));   -- 0057 was: dt := least(120, greatest(0, extract(epoch from now() - v.last_tick)));
    if dt > 0 then
      nh := greatest(0, v.hunger - dt * hr);
      nt := greatest(0, v.thirst - dt * tr);
      zh := case when v.hunger <= 0 then dt else greatest(0, dt - v.hunger / hr) end;
      zt := case when v.thirst <= 0 then dt else greatest(0, dt - v.thirst / tr) end;
      v.starve_s := case when nh > 0 and nt > 0 then 0 else v.starve_s + greatest(zh, zt) end;
      v.hunger := nh; v.thirst := nt;
      if v.starve_s >= 600 then
        v.fainted_until := now() + public._faint(p_account); v.starve_s := 0;                        -- faint ladder
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account
    returning * into v;                                                                                 -- faint ladder
  return v;
end; $$;

-- _vitals_apply, 2 arguments (0045's, verbatim but for the line marked 0057).
create or replace function public._vitals_apply(p_account uuid, p_thirst numeric) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400;
  tr constant numeric := 100.0 / 57600 * greatest(coalesce(p_thirst, 1), 0.1);         -- v18.8: × thirst
  dt numeric; zh numeric; zt numeric; nh numeric; nt numeric;
begin
  insert into public.vitals(account_id) values (p_account) on conflict do nothing;
  select * into v from public.vitals where account_id = p_account for update;
  if v.fainted_until is not null then
    if v.fainted_until <= now() then
      v.fainted_until := null; v.hunger := 30; v.thirst := 30; v.starve_s := 0;
    end if;
  else
    dt := least(1800, greatest(0, extract(epoch from now() - v.last_tick)));   -- 0057 was: dt := least(120, greatest(0, extract(epoch from now() - v.last_tick)));
    if dt > 0 then
      nh := greatest(0, v.hunger - dt * hr);
      nt := greatest(0, v.thirst - dt * tr);
      zh := case when v.hunger <= 0 then dt else greatest(0, dt - v.hunger / hr) end;
      zt := case when v.thirst <= 0 then dt else greatest(0, dt - v.thirst / tr) end;
      v.starve_s := case when nh > 0 and nt > 0 then 0 else v.starve_s + greatest(zh, zt) end;
      v.hunger := nh; v.thirst := nt;
      if v.starve_s >= 600 then
        v.fainted_until := now() + public._faint(p_account); v.starve_s := 0;                        -- faint ladder
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account
    returning * into v;                                                                                 -- faint ladder
  return v;
end; $$;

-- _vitals_apply, 3 arguments (0045's, verbatim but for the line marked 0057).
create or replace function public._vitals_apply(p_account uuid, p_thirst numeric, p_hunger numeric) returns public.vitals
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v public.vitals;
  hr constant numeric := 100.0 / 86400 * greatest(coalesce(p_hunger, 1), 0.1);          -- v18.12: × hunger
  tr constant numeric := 100.0 / 57600 * greatest(coalesce(p_thirst, 1), 0.1);         -- v18.8: × thirst
  dt numeric; zh numeric; zt numeric; nh numeric; nt numeric;
begin
  insert into public.vitals(account_id) values (p_account) on conflict do nothing;
  select * into v from public.vitals where account_id = p_account for update;
  if v.fainted_until is not null then
    if v.fainted_until <= now() then
      v.fainted_until := null; v.hunger := 30; v.thirst := 30; v.starve_s := 0;
    end if;
  else
    dt := least(1800, greatest(0, extract(epoch from now() - v.last_tick)));   -- 0057 was: dt := least(120, greatest(0, extract(epoch from now() - v.last_tick)));
    if dt > 0 then
      nh := greatest(0, v.hunger - dt * hr);
      nt := greatest(0, v.thirst - dt * tr);
      zh := case when v.hunger <= 0 then dt else greatest(0, dt - v.hunger / hr) end;
      zt := case when v.thirst <= 0 then dt else greatest(0, dt - v.thirst / tr) end;
      v.starve_s := case when nh > 0 and nt > 0 then 0 else v.starve_s + greatest(zh, zt) end;
      v.hunger := nh; v.thirst := nt;
      if v.starve_s >= 600 then
        v.fainted_until := now() + public._faint(p_account); v.starve_s := 0;                        -- faint ladder
      end if;
    end if;
  end if;
  v.last_tick := now();
  update public.vitals set hunger = v.hunger, thirst = v.thirst, starve_s = v.starve_s,
    fainted_until = v.fainted_until, last_tick = v.last_tick where account_id = p_account
    returning * into v;                                                                                 -- faint ladder
  return v;
end; $$;
revoke all on function public._vitals_apply(uuid) from public, anon, authenticated;
revoke all on function public._vitals_apply(uuid, numeric) from public, anon, authenticated;
revoke all on function public._vitals_apply(uuid, numeric, numeric) from public, anon, authenticated;
