-- 0095_river_world.sql — the seamless river: the boat rows and fishes the whole river and its canals in the 3D world,
-- not only Sông Cái's rect. The 2D Sông Cái map is unchanged (start_river_cast, river_row_start / river_row_finish stay
-- 0086's / 0087's).
--   A. _polyline_dist(pts, x, y): the distance (px) from a point to a polyline (int[][2]).
--   B. _river_world_water(wx, wy): is world px (wx, wy) boat water? Mirrors lib/game/world/boat.ts boatWater, leniently
--      (the client rows the exact water, so every point it floats on passes): inside the world; in Sông Cái's rect its
--      own water (0086 _river_water, zone-local) or, on the zone's two short ends, the river band; in the wild the
--      river band (the centreline of lib/game/world/terrain.ts RIVER_PTS, half-width ≤ 184 + 24 of hull) or a canal
--      (CANALS, 13 + 8); any other zone: no.
--   C. start_river_cast_w(room, token, map, x, y): 0086's start_river_cast from the boat on the wild's water (map
--      'wild', world px; the claim is where the boat floats, judged by the world model); map 'song_cai' is
--      start_river_cast itself. No shoals off Sông Cái.
-- Idempotent.

-- A.
create or replace function public._polyline_dist(p_pts integer[], p_x double precision, p_y double precision)
returns double precision
language plpgsql immutable parallel safe
as $$
declare d double precision := 'infinity'; i integer; ax double precision; ay double precision; bx double precision;
        by_ double precision; t double precision; l2 double precision;
begin
  for i in 1 .. array_length(p_pts, 1) - 1 loop
    ax := p_pts[i][1]; ay := p_pts[i][2]; bx := p_pts[i + 1][1]; by_ := p_pts[i + 1][2];
    l2 := (bx - ax) ^ 2 + (by_ - ay) ^ 2;
    t := case when l2 = 0 then 0 else greatest(0, least(1, ((p_x - ax) * (bx - ax) + (p_y - ay) * (by_ - ay)) / l2)) end;
    d := least(d, sqrt((p_x - ax - t * (bx - ax)) ^ 2 + (p_y - ay - t * (by_ - ay)) ^ 2));
  end loop;
  return d;
end $$;
revoke all on function public._polyline_dist(integer[], double precision, double precision) from public, anon, authenticated;

-- B.
create or replace function public._river_world_water(p_x integer, p_y integer) returns boolean
language plpgsql stable
as $$
declare v_zone text; lx integer; ly integer;
        v_river integer[] := '{{-1300,1560},{-600,1640},{-200,1700},{150,1790},{424,1900},{660,1930},{880,1862},{960,1840},{1920,1840},{2060,1826},{2250,1770},{2450,1860},{2624,1960},{2820,1990},{3050,1905},{3300,1850},{3560,1905},{3820,1990},{4120,1985},{4450,1910},{5400,1840}}'::int[];
begin
  if p_x is null or p_y is null or p_x < 0 or p_y < 0 or p_x > 4160 or p_y > 2240 then return false; end if;
  select z.zone, z.x, z.y into v_zone, lx, ly from public._world_to_zone(p_x, p_y) z limit 1;
  if v_zone = 'song_cai' then
    if public._river_water(lx, ly) then return true; end if;
    return (lx < 56 or lx > 936) and public._polyline_dist(v_river, p_x, p_y) < 208;
  end if;
  if v_zone is distinct from 'wild' then return false; end if;
  if public._polyline_dist(v_river, p_x, p_y) < 208 then return true; end if;
  return public._polyline_dist('{{-200,300},{700,320},{1700,290},{2700,330},{3600,300},{4400,320}}'::int[], p_x, p_y) < 21 or
      public._polyline_dist('{{560,1080},{650,1250},{700,1400},{760,1580},{830,1880}}'::int[], p_x, p_y) < 21 or
      public._polyline_dist('{{2150,900},{2210,1150},{2250,1400},{2250,1790}}'::int[], p_x, p_y) < 21 or
      public._polyline_dist('{{3340,900},{3330,1300},{3360,1600},{3320,1870}}'::int[], p_x, p_y) < 21 or
      public._polyline_dist('{{4060,300},{4080,800},{4130,1000},{4300,1100}}'::int[], p_x, p_y) < 21 or
      public._polyline_dist('{{60,1100},{250,1300},{300,1600},{310,1800}}'::int[], p_x, p_y) < 21;
end $$;
revoke all on function public._river_world_water(integer, integer) from public, anon, authenticated;

-- C. start_river_cast_w: 0086's start_river_cast, verbatim but for the lines marked 0095
create or replace function public.start_river_cast_w(p_room_id uuid, p_session_token text, p_map text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);
        v_boost real;
        v_seed bigint := floor(random() * 4294967296)::bigint;
        v_vitals jsonb; v_ac jsonb; v_abandoned jsonb; v_shoal boolean;
begin
  -- 0095: Sông Cái's own water is 0086's cast, zone-local
  if p_map = 'song_cai' then return public.start_river_cast(p_room_id, p_session_token, p_x, p_y); end if;
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if p_map is distinct from 'wild' or not public._river_world_water(p_x, p_y)   -- 0095: the wild's water only
     or not exists (select 1 from public._world_to_zone(p_x, p_y) z where z.zone = 'wild') then
    return public._ac_flag(v_account, 'bad_spot', 'start_river_cast_w', jsonb_build_object('map', left(p_map, 16), 'x', p_x, 'y', p_y), p_room_id, 'bad spot');
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  v_ac := public._pos_claim(v_account, 'wild', p_x, p_y, 'start_river_cast_w',   -- 0095
                           p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  v_shoal := false;                                                    -- 0095: the shoals are Sông Cái's
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);
  p := public._fishing_profile(v_account);
  if not public._rod_usable(v_account, p.rod) then
    raise exception 'rod broken' using errcode = '22023';
  end if;
  delete from public.casts where account_id = v_account;
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
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
  v_boost := coalesce((select bite_boost from public.shop_items where id = p.bait), 1);
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait, (v_fx->>'bigRare')::double precision,
                                  not (public._room_weather(p_room_id)).is_day);
  if v_rarity < 3 and random() < (case when v_shoal then 1.0 / 3 else 0.2 end) then v_rarity := 3; end if;   -- the river
  select * into sp from public.fish_species
   where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);
  v_bite := greatest(1000, round(v_bite * v_boost)::int);
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod, reel_seed, reel_params)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          'boat', not (public._rain_cold(v_account) and random() < 0.3),
          sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),
                                     'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
  returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

revoke all on function public.start_river_cast_w(uuid, text, text, integer, integer) from public;
grant execute on function public.start_river_cast_w(uuid, text, text, integer, integer) to anon, authenticated;
