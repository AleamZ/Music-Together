-- =========================================================
-- 0101_econ_fishing.sql — Kinh tế v2, fishing (spec docs/superpowers/specs/2026-09-30-economy-v2-design.md §4).
-- ADDITIVE and re-runnable. Run after 0100.
--   A. F1 fish_species.price_per_kg for the 23 species, calibrated with the audit's simulator (the bit-exact reel, skilled
--      and average bots) to the §4 targets — gross fish xu per active hour, skilled, fish_mult 1.00: pond wood rod +
--      feather + worms ≈ 1 800, fiber + foam + shrimp ≈ 2 900, master + lamp + bloodworm ≈ 4 400; river master + lamp +
--      bloodworm ≈ 6 500 (≈ 1.5× the pond with the same gear). Cá tra dầu 30–150 → 12–45 kg, cá vồ đém 20–100 → 10–35 kg.
--      A common still sells for ≥ 2 xu. Fish already caught keep their price.
--   B. F2 the river's bump (a Thường / Khá roll becomes Hiếm): 0.20 (on a Sông Cái shoal 1/3) → 0.05 (0.10).
--   C. F3 the boat costs 25 000 (_boat_geo; was 4 000). start_river_cast_w (the wild river) needs Sông Cái unlocked
--      (level 3), like river_row_start.
--   D. F4 treasure maps: a map drops on 1 % of pond or net catches, 2 % of deep catches, 0.5 % of worm digs (was 2 / 5 /
--      3 %); a chest holds 150–800 xu (a clean dig ×1.1, at most 800), one in fifty a jackpot of 3 000 (was 400–2 500,
--      one in twenty 8 000); at most 3 chests found per account per Vietnam day — after the third no map drops and
--      treasure_dig_start refuses ('treasure day cap') until the next day; the maps wait. A chest rolled higher before
--      0101 re-rolls (an 8 000 jackpot becomes 3 000).
--   E. F5 rarity lifts. The luck potion, the rod's upgrade level, the Ngư dân perk and the rare-fish meal buff lift a cast
--      at most once, together at most 20 % — in the new _cast_lift, which the three start functions call BEFORE they set
--      the reel's difficulty and min_reel_ms. 0072's casts_luck and 0077's casts_prof lifted the fish in BEFORE INSERT
--      triggers after the reel was fixed, so a lifted fish was reeled at the easier fish's difficulty, and two lifts could
--      stack; casts_luck is now a no-op and casts_prof spends the stamina only. A pond cast picks a pond species itself
--      (it drew the reel from any species of the rarity, deep ones too, and casts_zz_water swapped the fish afterwards;
--      that trigger stays, idle). The bobber shows the cast fish's rarity.
--   F. F6 effort: a cast costs hunger 0.35 / thirst 0.45 (was 1.8 / 2.2), a net haul 0.6 / 0.7 (was 3 / 3.5), a fall
--      overboard 5 hunger (was 10: _overboard_outcome for the rod, finish_net for the net). The perk fish_effort_pct
--      still lowers them (_fishing_effort is unchanged).
--   G. F7 thương lái (0100's _npc_sale): sell_fish and sell_fish_market pay through it — the gross is the fish's prices
--      (×1.10 at Chợ Lớn) — and answer 'earned' (what was paid), 'npc_cut' and 'npc'; fishing_board adds 'npc' (the
--      day's line in the "Giá cá" tab).
--   H. A fishing battle scores only the catches made in its room: finish_cast and finish_net pass the cast's room to
--      _fx_on_fish in mt.catch_room (a river cast in another hall no longer wins a pond battle).
--   I. The shop at the new fish prices (the old bait and nets cost more than the fish they bring): Mồi tép 5 → 1,
--      Mồi trùn chỉ 12 → 3, Mồi vàng 25 → 6 xu a bait; Lưới nhỏ 250 → 50 (20 hauls), Lưới lớn 600 → 120 xu (30 hauls).
--   J. The treasure panel's day: _fx_extras_state (fishing_extras_state) answers found_today — the chests found this
--      Vietnam day, of the 3 allowed.
-- Re-created from their newest bodies, only the lines marked "econ v2" changed: start_cast (0059), start_river_cast
-- (0086), start_river_cast_w (0095), _cast_luck (0072), _prof_on_cast (0077), net_haul (0065, the overload the client
-- calls), finish_net (0078), _overboard_outcome (0031), finish_cast (0078), _fx_on_fish (0078), _fx_on_dig (0076),
-- _treasure_drop (0076), treasure_dig_start (0087), treasure_dig_finish (0087), _boat_geo (0076), sell_fish (0015),
-- sell_fish_market (0057), fishing_board (0015), _fx_extras_state (0076). New: _cast_lift (private).
-- Unchanged: buy_boat (reads _boat_geo), _fishing_effort (the amounts are its arguments), _cast_settle_hooked (reads
-- _overboard_outcome), _cast_water, dig_worms and the fb_* RPCs.
-- =========================================================

-- ---------- A. F1: the fish's prices (and the two heaviest deep species' weights) ----------
-- Fitted with the audit's Monte-Carlo: lib/game/fishing/reel.ts's reel (= _reel_replay) played by a skilled and an average
-- bot (1 000 reels per rod and difficulty), the rarity roll, the weights and the timing of the casts below, the season
-- factor's mean ×1.095, fish_mult 1.00, stamina 3 a cast at 600 an hour (≤ 200 casts an hour). Gross fish xu per active
-- hour, skilled (average):
--   pond:  wood + feather + worms 1 800 (1 000) · bamboo + shrimp 2 500 (1 700) · fiber + foam + shrimp 2 900 (2 200)
--          carbon + lamp + bloodworm 4 000 (3 200) · master + lamp + bloodworm 4 400 (4 400)
--   river: bamboo + worms 2 700 (1 900) · fiber + shrimp 3 700 (2 500) · carbon + bloodworm 5 500 (4 000)
--          master + bloodworm 6 500 (6 200)
-- The mean fish (wooden rod, ×1.00): Thường 4–7 xu, Khá 8–12, Hiếm 17–21 (the river's 28–30), Quý 31–37 (51–53),
-- Huyền thoại 420 (644–660).
update public.fish_species s set price_per_kg = v.ppk, min_g = v.min_g, max_g = v.max_g
  from (values
    ('ca_ro',           40,     50,    300),   -- 1 pond was  45/kg; ≈ 5 xu at the wooden rod
    ('ca_sac',          38,     50,    250),   -- 1 pond was  40/kg; ≈ 4 xu at the wooden rod
    ('ca_me_vinh',      30,    100,    500),   -- 1 pond was  35/kg; ≈ 7 xu at the wooden rod
    ('ca_loc',          10,    300,   2500),   -- 2 pond was  60/kg; ≈ 10 xu at the wooden rod
    ('ca_tre',          15,    200,   1200),   -- 2 pond was  50/kg; ≈ 8 xu at the wooden rod
    ('ca_chep',          9,    500,   3000),   -- 2 pond was  55/kg; ≈ 12 xu at the wooden rod
    ('ca_tra',           8,   1000,   6000),   -- 3 pond was  70/kg; ≈ 21 xu at the wooden rod
    ('ca_that_lat',     27,    300,   1500),   -- 3 pond was 120/kg; ≈ 19 xu at the wooden rod
    ('tom_cang',       129,     50,    300),   -- 3 pond was 400/kg; ≈ 17 xu at the wooden rod
    ('ca_leo',           9,   1000,   8000),   -- 3 deep was 110/kg; ≈ 30 xu at the wooden rod
    ('ca_bong_tuong',   27,    300,   2500),   -- 3 deep was 260/kg; ≈ 28 xu at the wooden rod
    ('ca_lang',         12,    800,   6000),   -- 3 deep was 150/kg; ≈ 30 xu at the wooden rod
    ('ca_ngat',         16,    600,   4000),   -- 3 deep was 180/kg; ≈ 28 xu at the wooden rod
    ('ca_bong_lau',     16,   1000,   5000),   -- 4 pond was 120/kg; ≈ 37 xu at the wooden rod
    ('ca_he_vang',      45,    300,   1500),   -- 4 pond was 150/kg; ≈ 31 xu at the wooden rod
    ('ca_chien',         8,   2000,  15000),   -- 4 deep was 160/kg; ≈ 51 xu at the wooden rod
    ('ca_duoi_song',     6,   3000,  20000),   -- 4 deep was 130/kg; ≈ 52 xu at the wooden rod
    ('ca_dua',          12,   1500,  10000),   -- 4 deep was 170/kg; ≈ 52 xu at the wooden rod
    ('ca_anh_vu',       35,    500,   3500),   -- 4 deep was 480/kg; ≈ 52 xu at the wooden rod
    ('ca_ho',           21,  10000,  40000),   -- 5 pond was 200/kg; ≈ 420 xu at the wooden rod
    ('ca_tra_dau',      28,  12000,  45000),   -- 5 deep was 120/kg and 30–150 kg; ≈ 644 xu at the wooden rod
    ('rua_mai_vang',    49,   5000,  30000),   -- 5 deep was 500/kg; ≈ 653 xu at the wooden rod
    ('ca_vo_dem',       36,  10000,  35000)    -- 5 deep was 170/kg and 20–100 kg; ≈ 660 xu at the wooden rod
  ) v(id, ppk, min_g, max_g)
 where s.id = v.id and (s.price_per_kg, s.min_g, s.max_g) is distinct from (v.ppk, v.min_g, v.max_g);

-- ---------- B–E. The casts: the river's bump (F2), the wild river's level gate (F3), one lift before the reel (F5), the
-- effort (F6). start_cast from 0059, start_river_cast from 0086, start_river_cast_w from 0095. ----------
-- econ v2 (F5), new: the one rarity lift a cast may get. The chance adds the luck potion (20 % per power), the rod's
-- upgrade level (3 % per level), the Ngư dân perk rare_fish_pct and the rare_fish meal buff (%), and is at most 20 %.
-- The lifted fish is a random species one rarity up in the cast's water (the river's deep water from Hiếm up: p_boat),
-- its weight at the same place in its range. Returns the species and weight to cast — the same ones when nothing lifts.
-- The start functions call it before they set the reel's difficulty and min_reel_ms, so a lifted fish is reeled at its
-- own difficulty.
create or replace function public._cast_lift(p_account uuid, p_rod text, p_species text, p_weight integer, p_boat boolean,
                                             out o_species text, out o_weight integer)
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare cur public.fish_species; sp public.fish_species; v_chance numeric;
begin
  o_species := p_species;
  o_weight := p_weight;
  select * into cur from public.fish_species where id = p_species;
  if not found or cur.rarity >= 5 then return; end if;
  v_chance := least(0.20, 0.20 * public._buff_power(p_account, 'luck')
                          + 0.03 * public._upgrade_level(p_account, coalesce(p_rod, 'rod_wood'))
                          + (public._perk(p_account, 'rare_fish_pct') + public._buff(p_account, 'rare_fish')) / 100.0);
  if v_chance <= 0 or random() >= v_chance then return; end if;
  select * into sp from public.fish_species
   where rarity = cur.rarity + 1 and water = case when p_boat and cur.rarity + 1 >= 3 then 'deep' else 'pond' end
   order by random() limit 1;
  if not found then return; end if;
  o_species := sp.id;
  o_weight := sp.min_g + round(greatest(0, least(1, (p_weight - cur.min_g)::numeric / greatest(1, cur.max_g - cur.min_g)))
                               * (sp.max_g - sp.min_g))::int;
end $$;
revoke all on function public._cast_lift(uuid, text, text, integer, boolean) from public, anon, authenticated;

-- start_cast (0059_reel_hook.sql's, verbatim but for the lines marked econ v2)
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
        v_abandoned jsonb;                                                               -- 0059
        v_lift text;                                                                     -- econ v2
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
  v_abandoned := public._cast_settle_hooked(v_account);                                  -- 0059: a hooked cast replaced is given up
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
  select * into sp from public.fish_species where rarity = v_rarity and water = 'pond' order by random() limit 1;   -- econ v2 was: select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, false) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
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
  -- econ v2 (F6): hunger 0.35, thirst 0.45
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'abandoned', v_abandoned,                                                             -- 0059 was: 'reel_seed', v_seed,                                                                  -- 0046
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;

-- start_river_cast (0086_explore_minigames.sql's, verbatim but for the lines marked econ v2)
create or replace function public.start_river_cast(p_room_id uuid, p_session_token text, p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
        v_fx jsonb := public._room_effects(p_room_id);
        v_boost real;
        v_seed bigint := floor(random() * 4294967296)::bigint;
        v_vitals jsonb; v_ac jsonb; v_abandoned jsonb; v_shoal boolean;
        v_lift text;                                                                     -- econ v2
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if not public._river_water(p_x, p_y) then
    return public._ac_flag(v_account, 'bad_spot', 'start_river_cast', jsonb_build_object('x', p_x, 'y', p_y), p_room_id, 'bad spot');
  end if;
  if not (v_fx->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  if not exists (select 1 from public.boats where account_id = v_account) then
    raise exception 'no boat' using errcode = '22023';
  end if;
  v_ac := public._pos_claim(v_account, 'song_cai', p_x, p_y, 'start_river_cast', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  v_shoal := public._river_shoal(p_x, p_y);
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
  if v_rarity < 3 and random() < (case when v_shoal then 0.10 else 0.05 end) then v_rarity := 3; end if;   -- econ v2 was: if v_rarity < 3 and random() < (case when v_shoal then 1.0 / 3 else 0.2 end) then v_rarity := 3; end if;   -- the river
  select * into sp from public.fish_species
   where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, true) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
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
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

-- start_river_cast_w (0095_river_world.sql's, verbatim but for the lines marked econ v2)
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
        v_lift text;                                                                     -- econ v2
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
  -- econ v2 (F3): the river needs Sông Cái unlocked (level 3), like the row out
  if not public._map_unlocked(v_account, 'song_cai') then raise exception 'map locked' using errcode = '22023'; end if;   -- econ v2
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
  if v_rarity < 3 and random() < (case when v_shoal then 0.10 else 0.05 end) then v_rarity := 3; end if;   -- econ v2 was: if v_rarity < 3 and random() < (case when v_shoal then 1.0 / 3 else 0.2 end) then v_rarity := 3; end if;   -- the river
  select * into sp from public.fish_species
   where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, true) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
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
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

-- _cast_luck (0072_mining_crafting.sql's): no lift here any more (econ v2)
create or replace function public._cast_luck() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  -- econ v2 (F5): the luck potion and the rod's upgrade level lift a cast in _cast_lift now, which the start functions call
  -- BEFORE the reel's difficulty is set (0072 lifted the fish here, after it: a lifted fish was reeled at the easier
  -- fish's difficulty). The trigger stays, a no-op.
  return new;
end $$;

-- _prof_on_cast (0077_professions.sql's): the stamina only (econ v2)
create or replace function public._prof_on_cast() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._stamina_spend(new.account_id, 3, 'fish');
  -- econ v2 (F5): the perk rare_fish_pct and the rare_fish buff lift a cast in _cast_lift now (with the luck: one lift, at
  -- most 20 %), before the reel is set; this trigger only spends the stamina
  return new;
end $$;

-- ---------- F. The effort (F6): the net haul, the nets' and the rod's overboard ----------
-- net_haul (0065_ac_stats.sql's overload that the client calls (press, release, aim, hits), verbatim but for the lines marked econ v2)
create or replace function public.net_haul(p_session_token text, p_throw_id uuid, p_press integer, p_release integer,
                                           p_aim_x integer, p_aim_y integer, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_n integer; v_free integer; sp public.fish_species;
        v_w integer; v_price integer; r public.fish_price_index; v_mult numeric := 1; v_room boolean;
        v_haul jsonb := '[]'::jsonb; v_d integer; v_vitals jsonb; v_bad text; v_rep jsonb; v_ac jsonb;
        v_radius integer; v_in jsonb;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select * into t from public.net_throws where account_id = v_account and id = p_throw_id for update;
  if not found or t.haul is not null then raise exception 'throw not found' using errcode = '22023'; end if;
  if t.arrow_seed is null then                                                            -- rolled before 0056
    delete from public.net_throws where id = t.id;
    return public._net_outdated(v_account);
  end if;
  -- the throw is spent: one use of the net (a net at 0 is removed) and the throw's effort
  select durability into v_d from public.inventory where account_id = v_account and item_id = t.net and qty >= 1 for update;
  if not found or coalesce(v_d, 0) < 1 then raise exception 'no net' using errcode = '22023'; end if;
  if v_d <= 1 then
    delete from public.inventory where account_id = v_account and item_id = t.net;
  else
    update public.inventory set durability = v_d - 1 where account_id = v_account and item_id = t.net;
  end if;
  perform public._vitals_apply(v_account);
  v_vitals := public._fishing_effort(v_account, 0.6, 0.7);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 3, 3.5);
  v_in := jsonb_build_object('press', p_press, 'release', p_release, 'aim_x', p_aim_x, 'aim_y', p_aim_y, 'hits', p_hits);
  if now() > t.started_at + interval '120 seconds' then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'vitals', v_vitals, 'state', public._fishing_state(v_account));
  end if;
  v_bad := coalesce(public._net_throw_error(p_press, p_release, p_aim_x, p_aim_y),
                    case when p_hits is null or p_hits < 0 or p_hits > 5 then 'hits' end);
  if v_bad is not null then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_bad_input', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'error', v_bad, 'inputs', v_in), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  v_radius := coalesce((select radius_px from public.shop_items where id = t.net), 24);
  v_rep := public._net_haul_replay(t.seed, v_radius, p_press, p_release, p_aim_x, p_aim_y);
  if (v_rep->>'hits')::int <> p_hits then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_mismatch', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'seed', t.seed, 'radius', v_radius, 'inputs', v_in, 'replay', v_rep), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  if now() < t.started_at + make_interval(secs => 0.9 * (p_release + 42 + 90) / 60.0) then
    delete from public.net_throws where id = t.id;
    v_ac := public._ac_flag(v_account, 'net_too_fast', 'net_haul',
              jsonb_build_object('throw_id', t.id, 'started_at', t.started_at, 'hauled_at', now(), 'inputs', v_in,
                                 'need_s', round(0.9 * (p_release + 42 + 90) / 60.0, 3)), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'vitals', v_vitals, 'state', public._fishing_state(v_account))
           || v_ac;
  end if;
  perform public._ac_stat(v_account, 'net', 1, case when (v_rep->>'hits')::int >= 3 then 1 else 0 end,   -- 0065: the round
                          case when (v_rep->>'hits')::int = 5 then 1 else 0 end);                             -- 0065
  v_n := (v_rep->>'count')::int;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  v_n := least(v_n, v_free);
  if v_n = 0 then
    delete from public.net_throws where id = t.id;
    return jsonb_build_object('result', 'empty', 'count', 0, 'fish', '[]'::jsonb, 'vitals', v_vitals,
                              'state', public._fishing_state(v_account));
  end if;
  v_room := t.room_id is not null and exists (select 1 from public.rooms where id = t.room_id);
  if v_room then
    r := public._fish_index(t.room_id, now());
    v_mult := r.mult;
  end if;
  for i in 1 .. v_n loop
    select * into sp from public.fish_species where rarity in (1, 2) order by random() limit 1;
    v_w := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), 2.0))::int);
    v_price := greatest(1, round(sp.price_per_kg * v_w / 1000.0 * v_mult
                                 * case when v_room then public._fish_factor(t.room_id, sp.id, r.period) else 1 end)::int);
    v_haul := v_haul || jsonb_build_array(jsonb_build_object('species_id', sp.id, 'weight_g', v_w, 'price', v_price,
                                                             'rarity', sp.rarity));
  end loop;
  update public.net_throws set haul = v_haul, hauled_at = now(), land_tick = (v_rep->>'land_tick')::int, inputs = v_in
   where id = t.id;
  return jsonb_build_object('result', 'haul', 'count', v_n, 'fish', v_haul, 'quality', (v_rep->>'quality')::int,
    'arrow_seed', t.arrow_seed, 'vitals', v_vitals, 'state', public._fishing_state(v_account));
end; $$;

-- finish_net (0078_v21_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public.finish_net(p_session_token text, p_throw_id uuid, p_keys integer[], p_ticks integer,
                                             p_mistakes integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_free integer; f jsonb; v_id uuid; v_fish jsonb := '[]'::jsonb;
        v_vit public.vitals; v_n integer := 0; v_keep jsonb; v_bad text; v_plan integer[]; v_rep jsonb; v_ac jsonb;
        v_m integer; v_ev jsonb;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  delete from public.net_throws where account_id = v_account and id = p_throw_id returning * into t;
  if not found or t.haul is null then raise exception 'throw not found' using errcode = '22023'; end if;
  if t.arrow_seed is null then return public._net_outdated(v_account); end if;           -- hauled before 0056
  if now() > t.hauled_at + interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._fishing_state(v_account));
  end if;
  v_ev := jsonb_build_object('throw_id', t.id, 'ticks', p_ticks, 'mistakes', p_mistakes,
                             'n', coalesce(cardinality(p_keys), 0), 'keys', to_jsonb(p_keys[1:64]));
  v_bad := coalesce(public._net_keys_error(p_keys, p_ticks),
                    case when p_mistakes is null or p_mistakes < 0 or p_mistakes > 4 then 'mistakes' end);
  v_plan := public._net_plan(t.haul);
  if v_bad is null then
    v_rep := public._net_arrow_replay(t.arrow_seed, v_plan, p_keys);
    v_bad := v_rep->>'error';
  end if;
  if v_bad is not null then
    v_ac := public._ac_flag(v_account, 'net_bad_input', 'finish_net', v_ev || jsonb_build_object('error', v_bad), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'state', public._fishing_state(v_account)) || v_ac;
  end if;
  if (v_rep->>'mistakes')::int <> p_mistakes or (v_rep->>'ticks')::int <> p_ticks then
    v_ac := public._ac_flag(v_account, 'net_mismatch', 'finish_net',
              v_ev || jsonb_build_object('seed', t.arrow_seed, 'plan', to_jsonb(v_plan), 'replay', v_rep), t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'net_invalid', 'state', public._fishing_state(v_account)) || v_ac;
  end if;
  v_m := (v_rep->>'mistakes')::int;
  if v_m >= 4 then                                                                        -- kéo hụt (0037)
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - 5) where account_id = v_account returning * into v_vit;   -- econ v2 was: update public.vitals set hunger = greatest(0, hunger - 10) where account_id = v_account returning * into v_vit;
    perform public._heat_row(v_account);
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', null, 'rod_lost', false, 'hunger', 5),   -- econ v2 was: 'overboard', jsonb_build_object('rod', null, 'rod_lost', false, 'hunger', 10),
      'vitals', public._vitals_json(v_vit), 'state', public._fishing_state(v_account));
  end if;
  if now() < t.hauled_at + make_interval(secs => 0.9 * p_ticks / 60.0) then               -- sooner than the ticks took
    v_ac := public._ac_flag(v_account, 'net_too_fast', 'finish_net',
              v_ev || jsonb_build_object('hauled_at', t.hauled_at, 'finished_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3)),
              t.room_id);
    return jsonb_build_object('result', 'lost', 'why', 'too_early', 'state', public._fishing_state(v_account)) || v_ac;
  end if;
  -- one random fish escapes per mistake (0037)
  select coalesce(jsonb_agg(x.v), '[]'::jsonb) into v_keep
    from (select value v from jsonb_array_elements(t.haul) order by random()
          offset least(v_m, jsonb_array_length(t.haul))) x;
  v_free := greatest(0, 1 + public._bucket_cap(v_account) - (select count(*)::int from public.fish where account_id = v_account));
  for f in select value from jsonb_array_elements(v_keep) loop
    exit when v_n >= v_free;
    perform set_config('mt.catch', '1', true);                                      -- 0078: a verified catch
    perform set_config('mt.catch_room', coalesce(t.room_id::text, ''), true);   -- econ v2 (H: a battle counts its room's catches)
    insert into public.fish (account_id, species_id, weight_g, price)
    values (v_account, f->>'species_id', (f->>'weight_g')::int, (f->>'price')::int) returning id into v_id;
    perform set_config('mt.catch', '', true);                                       -- 0078
    perform set_config('mt.catch_room', '', true);   -- econ v2
    v_fish := v_fish || jsonb_build_array(f || jsonb_build_object('id', v_id));
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('result', 'caught', 'count', v_n, 'fish', v_fish,
    'escaped', jsonb_array_length(t.haul) - jsonb_array_length(v_keep),
    'state', public._fishing_state(v_account));
end; $$;

-- _overboard_outcome (0031_pond_life.sql's, verbatim but for the lines marked econ v2)
create or replace function public._overboard_outcome(p_rod text, p_roll double precision) returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select jsonb_build_object('wear', 3, 'hunger', 5,   -- econ v2 was: select jsonb_build_object('wear', 3, 'hunger', 10,
                            'rod_lost', coalesce(p_rod, 'rod_wood') <> 'rod_wood' and coalesce(p_roll, 1) < 0.1)
$$;

-- ---------- D. Treasure maps (F4) and the fishing battles' room (H) ----------
-- finish_cast (0078_v21_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,
                                              p_hooked boolean default false,
                                              p_inputs integer[] default null,             -- 0046: the toggle ticks
                                              p_ticks integer default null) returns jsonb  -- 0046: the tick it ended on
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
        v_out jsonb; v_rod text; v_vit public.vitals;                                     -- v18.1
        v_broke boolean := false;                                                         -- v18.2
        v_bad text; v_replay jsonb;                                                       -- 0046
        v_hooked boolean; v_t jsonb;                                                      -- 0059
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  v_hooked := c.hooked_at is not null;                                                    -- 0059: the server's hook (p_hooked is ignored)
  -- 0046: a won reel is replayed from the cast's seed and params; the client's word alone lands nothing
  if coalesce(p_success, false) and c.reel_seed is not null and p_inputs is not null and p_ticks is not null then
    v_bad := public._reel_input_error(p_inputs, p_ticks);
    if v_bad is null then
      v_replay := public._reel_replay(c.reel_params, c.reel_seed, p_inputs);
    end if;
  end if;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not c.bites then                                                                  -- v18.1: nothing bit
    v_why := 'no_bite';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
    if v_hooked and c.big then                                                            -- 0059 was: if coalesce(p_hooked, false) and c.big and now() >= c.bite_at then                   -- v18.1: pulled in
      v_why := 'overboard';
    end if;
  elsif c.reel_seed is null or p_inputs is null or p_ticks is null then                     -- 0046: a page before the replay
    v_why := 'outdated';
  elsif not v_hooked then                                                                 -- 0059: a won reel needs the hook
    v_why := 'reel_invalid';                                                              -- 0059
    v_ac := public._ac_flag(v_account, 'reel_unhooked', 'finish_cast',                   -- 0059
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'ticks', p_ticks), c.room_id);   -- 0059
  elsif v_bad is not null then                                                            -- 0046: input no reel can make
    v_why := 'reel_invalid';
    v_ac := public._ac_flag(v_account, 'reel_bad_input', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'error', v_bad, 'ticks', p_ticks,
                                 'toggles', cardinality(p_inputs), 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif v_replay->>'outcome' is distinct from 'caught' or (v_replay->>'ticks')::int <> p_ticks then   -- 0046
    v_why := 'reel_invalid';                                                              -- the reel did not land it
    v_ac := public._ac_flag(v_account, 'reel_mismatch', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'seed', c.reel_seed, 'params', c.reel_params,
                                 'claimed_ticks', p_ticks, 'replay', v_replay, 'toggles', cardinality(p_inputs),
                                 'inputs', to_jsonb(p_inputs[1:200])),
              c.room_id);
  elsif now() < c.hooked_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then   -- 0059 was: elsif now() < c.bite_at + make_interval(secs => 0.9 * greatest(c.min_reel_ms, p_ticks * 1000.0 / 60) / 1000.0) then
    -- the existing gate, and (0046) no sooner in real time than the replayed ticks took
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3),
                                 'ticks', p_ticks),                                       -- 0046
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  -- 0059 {
  -- a won reel's timing: flips faster than a finger, or a metronome (soft); the 5th within 24 h voids the catch (hard)
  if v_why is null then
    v_t := public._reel_timing(p_inputs);
    if public._reel_timing_suspect(v_t) then
      perform public._ac_flag(v_account, 'reel_timing', 'finish_cast',
                jsonb_build_object('cast_id', c.id, 'timing', v_t, 'ticks', p_ticks, 'inputs', to_jsonb(p_inputs[1:200])),
                c.room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'reel_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_why := 'reel_invalid';
        v_ac := public._ac_flag(v_account, 'reel_timing_repeat', 'finish_cast',
                  jsonb_build_object('cast_id', c.id, 'timing', v_t, 'pattern', '5 in 24 h'), c.room_id);
      end if;
    end if;
  end if;
  -- 0059 }
  -- 0065 {
  -- a hooked reel is a round: won when caught, exact when never out of the zone (the replay's fewest ticks)
  if v_hooked and c.bites then
    perform public._ac_stat(v_account, 'reel', 1, case when v_why is null then 1 else 0 end,
                            case when v_why is null and p_ticks <= ceil(c.min_reel_ms * 0.06) + 2 then 1 else 0 end);
  end if;
  -- 0065 }
  v_rod := coalesce(c.rod, 'rod_wood');                                                   -- v18.2 (was in the branch below)
  if v_why = 'overboard' then                                                             -- v18.1: the fall's cost
    v_out := public._overboard_outcome(v_rod, random());
    perform public._rod_wear(v_account, v_rod, (v_out->>'wear')::int);
    perform public._vitals_apply(v_account);
    update public.vitals set hunger = greatest(0, hunger - (v_out->>'hunger')::numeric)
     where account_id = v_account returning * into v_vit;
    v_broke := not public._rod_usable(v_account, v_rod);                                  -- v18.2
    if (v_out->>'rod_lost')::boolean then
      delete from public.inventory where account_id = v_account and item_id = v_rod;
      update public.fishing_profiles set rod = 'rod_wood' where account_id = v_account and rod = v_rod;
      v_broke := false;                                                                   -- v18.2: lost, not broken
    end if;
    perform public._heat_row(v_account);                                                  -- v18.2: the swim's immunity
    update public.heat_state set immune_until = now() + interval '10 minutes', outdoor_since = null, shocked = false
     where account_id = v_account;
    return jsonb_build_object('result', 'lost', 'why', 'overboard',
      'overboard', jsonb_build_object('rod', v_rod, 'rod_lost', (v_out->>'rod_lost')::boolean,
                                      'hunger', (v_out->>'hunger')::int),
      'rod_broke', v_broke,                                                               -- v18.2
      'vitals', public._vitals_json(v_vit),
      'state', public._fishing_state(v_account));
  end if;
  if v_why is distinct from 'no_bite' then                                                -- v18.2: a hook attempt
    perform public._rod_wear(v_account, v_rod, 1);
    v_broke := not public._rod_usable(v_account, v_rod);
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'rod_broke', v_broke,        -- v18.2: rod_broke
                              'state', public._fishing_state(v_account))
           || case when v_why = 'outdated' then jsonb_build_object('message', 'Cập nhật trang để câu tiếp')   -- 0046
                   else '{}'::jsonb end
           || coalesce(v_ac, '{}'::jsonb);
  end if;
  select * into sp from public.fish_species where id = c.species_id;
  -- the room's fish price index at the catch (economy spec §5.7); a cast whose room is gone keeps the base price
  if c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    r := public._fish_index(c.room_id, now());
    v_mult := r.mult;
    v_factor := public._fish_factor(c.room_id, sp.id, r.period);
  end if;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0 * v_mult * v_factor)::int);
  perform set_config('mt.catch', '1', true);                                        -- 0078: a verified catch
  perform set_config('mt.catch_room', coalesce(c.room_id::text, ''), true);   -- econ v2 (H: a battle counts its room's catches)
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  perform set_config('mt.catch', '', true);                                         -- 0078
  perform set_config('mt.catch_room', '', true);   -- econ v2
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  if v_ratio < 1.05 then
    perform public._ac_hug(v_account, round(v_ratio, 3), c.room_id);
  end if;
  -- rare+ catches are announced in the room's chat (v14 spec §8.5), as a system line about the catcher
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]),
            true, v_account);
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'rod_broke', v_broke,                                                                 -- v18.2
    'state', public._fishing_state(v_account));
end; $$;

-- _fx_on_fish (0078_v21_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public._fx_on_fish() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_boat boolean;
begin
  -- a fish taken back from the fridge or the aquarium keeps its old caught_at: not a catch
  if new.caught_at < now() - interval '5 seconds' then return new; end if;
  if not public._fish_is_catch() then return new; end if;                           -- 0078: only finish_cast / finish_net
  update public.fishing_battle_players p
     set score = p.score + new.price, catches = p.catches + 1,
         best_species = case when p.best_species is null
                                  or (select rarity from public.fish_species where id = new.species_id)
                                     > (select rarity from public.fish_species where id = p.best_species)
                             then new.species_id else p.best_species end
    from public.fishing_battles b
   where b.id = p.battle_id and p.account_id = new.account_id and b.status = 'live'
     and now() >= b.starts_at and now() < b.ends_at   -- econ v2 was: and now() >= b.starts_at and now() < b.ends_at;
     and b.room_id::text = coalesce(current_setting('mt.catch_room', true), '');   -- econ v2 (H: only its room's catches)
  v_boat := exists (select 1 from public.fish_species where id = new.species_id and water = 'deep');
  perform public._treasure_drop(new.account_id, case when v_boat then 'boat' else 'fishing' end,
                                case when v_boat then 0.02 else 0.01 end);   -- econ v2 was: case when v_boat then 0.05 else 0.02 end);
  return new;
end $$;

-- _fx_on_dig (0076_fishing_extras.sql's, verbatim but for the lines marked econ v2)
create or replace function public._fx_on_dig() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.last_dig_at is distinct from old.last_dig_at and new.last_dig_at is not null then
    perform public._treasure_drop(new.account_id, 'dig', 0.005);   -- econ v2 was: perform public._treasure_drop(new.account_id, 'dig', 0.03);
  end if;
  return new;
end $$;

-- _treasure_drop (0076_fishing_extras.sql's, verbatim but for the lines marked econ v2)
create or replace function public._treasure_drop(p_account uuid, p_source text, p_chance double precision) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if random() >= p_chance then return; end if;
  if (select count(*) from public.treasure_maps where account_id = p_account and found_at is null) >= 3 then return; end if;
  -- econ v2 (F4): after 3 finds in a Vietnam day, no more maps until the next
  if (select count(*) from public.treasure_maps where account_id = p_account and found_at >= public._vn_day_start()) >= 3 then   -- econ v2
    return;   -- econ v2
  end if;   -- econ v2
  insert into public.treasure_maps (account_id, spot, source)
  values (p_account, (select id from public.treasure_spots order by random() limit 1), p_source);
end $$;

-- treasure_dig_start (0087_v22_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public.treasure_dig_start(p_room_id uuid, p_session_token text, p_map_id uuid, p_map text,
                                                     p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); t public.treasure_maps; s public.treasure_spots;
        v_ac jsonb; v_d numeric; v_loot integer; v_seed bigint := floor(random() * 4294967296)::bigint;
        v_rd bigint[];                                                                                     -- 0087
begin
  perform public._vitals_guard(v_account);
  perform public._wallet_lock(v_account);
  select * into t from public.treasure_maps where id = p_map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if t.last_dig_at is not null and t.last_dig_at > now() - interval '4 seconds' then
    raise exception 'dig cooldown' using errcode = '22023', detail = '4';
  end if;
  -- econ v2 (F4): at most 3 chests found a Vietnam day; the map waits for tomorrow
  if (select count(*) from public.treasure_maps where account_id = v_account and found_at >= public._vn_day_start()) >= 3 then   -- econ v2
    raise exception 'treasure day cap' using errcode = '53400';   -- econ v2
  end if;   -- econ v2
  v_ac := public._pos_claim(v_account, p_map, p_x, p_y, 'treasure_dig_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  update public.treasure_maps set last_dig_at = now(), digs = digs + 1 where id = t.id;
  select * into s from public.treasure_spots where id = t.spot;
  if s.map <> p_map then
    return jsonb_build_object('result', 'miss', 'heat', 'wrong_map', 'map', public._treasure_json(t));
  end if;
  v_d := sqrt((s.x - p_x) ^ 2 + (s.y - p_y) ^ 2);
  if v_d > 16 then
    return jsonb_build_object('result', 'miss', 'heat', case when v_d <= 48 then 'hot' when v_d <= 120 then 'warm' else 'cold' end,
                              'band', public._treasure_band(v_d), 'map', public._treasure_json(t));
  end if;
  perform public._stamina_spend(v_account, 3, 'mine');
  perform public._fishing_effort(v_account, 0.6, 0.8);
  -- econ v2 (F4) loot: 150–800 xu, one chest in fifty a jackpot of 3 000   -- econ v2 was: -- 0076's loot: 400–2 500 xu, one chest in twenty a jackpot of 8 000
  -- 0087 { rolled ONCE per map: a give-up or a restart digs up the same chest
  v_loot := coalesce(t.dig_loot, case when random() < 0.02 then 3000 else 150 + floor(random() * 651)::int end);   -- econ v2 was: v_loot := coalesce(t.dig_loot, case when random() < 0.05 then 8000 else 400 + floor(random() * 2101)::int end);
  if t.dig_loot is null then update public.treasure_maps set dig_loot = v_loot where id = t.id; end if;
  v_rd := public._mg_roll('dig', null, 3);
  -- 0087 }
  insert into public.treasure_digs (account_id, room_id, map_id, map, x, y, seed, need, win, loot, started_at)
  values (v_account, p_room_id, t.id, p_map, p_x, p_y, v_seed, 3, 120, v_loot, now())
  on conflict (account_id) do update set room_id = excluded.room_id, map_id = excluded.map_id, map = excluded.map,
    x = excluded.x, y = excluded.y, seed = excluded.seed, need = excluded.need, win = excluded.win, loot = excluded.loot,
    started_at = excluded.started_at;
  -- 0087 { the veins stay on the server: the first at a secret tick, each next one when the strike that found the last
  -- one is stamped (mg_sync('dig'))
  perform public._mg_open(v_account, 'dig', 'dig', v_rd, 20 + floor(random() * 21)::int, jsonb_build_object('win', 120));
  return jsonb_build_object('result', 'dig', 'dig', jsonb_build_object('need', 3, 'win', 120, 'period', v_rd[1], 'live', 'dig',
                                                                       'started_at', now()));
  -- 0087 }
end $$;

-- treasure_dig_finish (0087_v22_fixes.sql's, verbatim but for the lines marked econ v2)
create or replace function public.treasure_dig_finish(p_room_id uuid, p_session_token text, p_strikes integer[],
                                                      p_ticks integer, p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); d public.treasure_digs; t public.treasure_maps;
        s public.treasure_spots; v_ac jsonb; v_bad text; v_rep jsonb; v_code text; v_ev jsonb; v_tm jsonb;
        v_n integer := coalesce(cardinality(p_strikes), 0); v_loot integer; v_clean boolean; v_exact boolean;
        l public.mg_live;                                                                                  -- 0087
begin
  perform public._wallet_lock(v_account);                                                                  -- 0087: the start's order
  perform 1 from public.player_pos where account_id = v_account for update;
  delete from public.treasure_digs where account_id = v_account and room_id = p_room_id returning * into d;
  if not found then raise exception 'dig not found' using errcode = '22023'; end if;
  l := public._mg_close(v_account, 'dig', 'dig', p_strikes, null);                                         -- 0087
  v_ac := public._pos_claim(v_account, d.map, d.x, d.y, 'treasure_dig_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into t from public.treasure_maps where id = d.map_id and account_id = v_account and found_at is null for update;
  if not found then raise exception 'no map' using errcode = '22023'; end if;
  if now() > d.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  if l.account_id is null then return jsonb_build_object('result', 'lost', 'why', 'outdated'); end if;   -- 0087
  v_ev := jsonb_build_object('map', d.map_id, 'pass', p_pass, 'ticks', p_ticks, 'n', v_n, 'strikes', to_jsonb(p_strikes[1:12]));
  v_bad := coalesce(public._mine_input_error(p_strikes, p_ticks), case when p_pass is null then 'pass' end,
                    l.meta->>'err', case when public._mg_dig_early(l, d.win) then 'early' end);            -- 0087
  if v_bad is not null then
    v_code := 'treasure_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  -- 0087 { every finish is replayed, a give-up too (it may not claim a pass it did not dig, nor end sooner than its ticks)
  else
    v_rep := public._mine_replay_p(l.params::integer[], d.need, d.win, p_strikes);
    if (p_pass and (v_rep->>'outcome' <> 'pass' or (v_rep->>'ticks')::int <> p_ticks or (v_rep->>'used')::int <> v_n))
       or (not p_pass and v_rep->>'outcome' = 'pass') then
      v_code := 'treasure_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'need', d.need, 'win', d.win, 'replay', v_rep);
    elsif now() < d.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'treasure_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', d.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'treasure_late', 'treasure_dig_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              p_room_id, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late');
    end if;
  end if;
  if v_code is null and p_pass then
  -- 0087 }
    v_tm := public._mine_timing_p(l.params::integer[], d.need, d.win, p_strikes);                          -- 0087
    v_exact := (v_tm->>'used')::int = d.need and (v_tm->>'exact')::int = d.need;
    perform public._ac_stat(v_account, 'treasure', 1, 1, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'treasure_timing', 'treasure_dig_finish', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'treasure_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'treasure_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  elsif v_code is null and p_pass is false then
    perform public._ac_stat(v_account, 'treasure', 1, 0, 0);
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'treasure_dig_finish', v_ev, p_room_id, 'invalid dig');
    return jsonb_build_object('result', 'lost', 'why', 'refused') || v_ac;
  end if;
  if not p_pass then
    return jsonb_build_object('result', 'lost', 'why', 'gave_up');
  end if;
  v_clean := (v_rep->>'used')::int = d.need;
  -- econ v2 (F4): the jackpot is 3 000; a clean dig ×1.1 up to 800 (a chest rolled before 0101 too: 8 000 → 3 000)
  v_loot := case when d.loot in (3000, 8000) then 3000 when v_clean then least(800, round(d.loot * 1.1)::int) else least(800, d.loot) end;   -- econ v2 was: v_loot := case when d.loot = 8000 then 8000 when v_clean then least(2500, round(d.loot * 1.1)::int) else d.loot end;
  select * into s from public.treasure_spots where id = t.spot;
  update public.treasure_maps set found_at = now(), loot = v_loot where id = t.id;
  perform public._pay(v_account, v_loot, 'treasure', 'map ' || t.id);
  perform public._game_event(v_account, 'treasure_found', v_loot, jsonb_build_object('map', s.map, 'spot', s.id));
  perform public._game_event(v_account, 'xp_grant', 50, '{"source":"fishing"}'::jsonb);
  return jsonb_build_object('result', 'found', 'loot', v_loot, 'jackpot', v_loot = 3000, 'clean', v_clean,   -- econ v2 was: return jsonb_build_object('result', 'found', 'loot', v_loot, 'jackpot', v_loot = 8000, 'clean', v_clean,
                            'coins', (select coins from public.wallets where account_id = v_account));
end $$;

-- A chest rolled before 0101 (0087's dig_loot, 400–2 500 or 8 000) re-rolls at the next dig; a jackpot stays one.
update public.treasure_maps set dig_loot = case when dig_loot = 8000 then 3000 end
 where found_at is null and dig_loot is not null and dig_loot > 800 and dig_loot <> 3000;

-- ---------- C. The boat (F3) ----------
-- _boat_geo (0076_fishing_extras.sql's, verbatim but for the price: econ v2, was 4000; lib/game/fishing/extras.ts BOAT mirrors it)
create or replace function public._boat_geo() returns jsonb
language sql immutable parallel safe
as $$ select '{"pier_x": 378, "pier_y": 206, "deck_x": 356, "deck_y": 116, "price": 25000}'::jsonb $$;

-- ---------- G. Thương lái (F7) ----------
-- sell_fish (0015_anticheat.sql's, verbatim but for the lines marked econ v2)
create or replace function public.sell_fish(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer;
        v_pay integer;   -- econ v2
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  with sold as (
    delete from public.fish where account_id = v_account and id = any(coalesce(p_fish_ids, '{}'::uuid[])) returning price
  ) select count(*), coalesce(sum(price), 0) into v_count, v_sum from sold;
  if v_count = 0 then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  -- econ v2 (F7): the thương lái pays (spec §3.2)
  v_pay := public._npc_sale(v_account, v_sum);   -- econ v2
  if v_pay > 0 then perform public._pay(v_account, v_pay, 'sell', v_count || ' con'); end if;   -- econ v2 was: perform public._pay(v_account, v_sum, 'sell', v_count || ' con');
  return jsonb_build_object('sold', v_count, 'earned', v_pay, 'npc_cut', v_sum - v_pay, 'npc', public._npc_quota(v_account),   -- econ v2 was: return jsonb_build_object('sold', v_count, 'earned', v_sum, 'state', public._fishing_state(v_account));
                            'state', public._fishing_state(v_account));   -- econ v2
end; $$;

-- sell_fish_market (0057_server_position.sql's, verbatim but for the lines marked econ v2)
create or replace function public.sell_fish_market(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer; v_pay integer;
        v_ac jsonb;                                                                      -- 0057
        v_gross integer;   -- econ v2
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
  -- econ v2 (F7): Chợ Lớn's price is the gross, then the thương lái pays (spec §3.2)
  v_gross := public._market_depot_pay(v_sum);   -- econ v2 was: v_pay := public._market_depot_pay(v_sum);
  v_pay := public._npc_sale(v_account, v_gross);   -- econ v2
  if v_pay > 0 then perform public._pay(v_account, v_pay, 'sell', v_count || ' con (Chợ Lớn)'); end if;   -- econ v2 was: perform public._pay(v_account, v_pay, 'sell', v_count || ' con (Chợ Lớn)');
  return jsonb_build_object('sold', v_count, 'earned', v_pay, 'npc_cut', v_gross - v_pay, 'npc', public._npc_quota(v_account),   -- econ v2 was: return jsonb_build_object('sold', v_count, 'earned', v_pay, 'state', public._fishing_state(v_account));
                            'state', public._fishing_state(v_account));   -- econ v2
end; $$;

-- fishing_board (0015_anticheat.sql's, verbatim but for the lines marked econ v2)
create or replace function public.fishing_board(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins integer; v_rank integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  v_coins := coalesce((select coins from public.wallets where account_id = v_account), 0);
  select 1 + count(*) into v_rank
    from public.members m join public.wallets w on w.account_id = m.account_id
    join public.accounts a on a.id = m.account_id
   where m.room_id = p_room_id and w.coins > v_coins and not a.is_banned;
  return jsonb_build_object(
    'records', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', r.species_id, 'username', r.username, 'weight_g', r.weight_g)
                       order by r.species_id)
        from (select distinct on (pb.species_id) pb.species_id, a.username, pb.weight_g
                from public.personal_bests pb
                join public.members m on m.account_id = pb.account_id and m.room_id = p_room_id
                join public.accounts a on a.id = pb.account_id and not a.is_banned
               order by pb.species_id, pb.weight_g desc, pb.caught_at asc) r), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', species_id, 'weight_g', weight_g) order by species_id)
        from public.personal_bests where account_id = v_account), '[]'::jsonb),
    'richest', coalesce((
      select jsonb_agg(jsonb_build_object('username', t.username, 'coins', t.coins) order by t.coins desc, t.username)
        from (select a.username, w.coins
                from public.members m
                join public.wallets w on w.account_id = m.account_id
                join public.accounts a on a.id = m.account_id
               where m.room_id = p_room_id and w.coins > 0 and not a.is_banned
               order by w.coins desc, a.username
               limit 10) t), '[]'::jsonb),
    'my_rank', v_rank,
    'my_coins', v_coins,
    'prices', public._fish_prices(p_room_id, now()),   -- econ v2 was: 'prices', public._fish_prices(p_room_id, now()));
    'npc', public._npc_quota(v_account));   -- econ v2 (F7: the thương lái's day)
end; $$;

-- ---------- I. The shop: the bait and the nets at the new fish prices ----------
-- At 0101's fish prices the old ones cost more than they bring (most pond fish are worth 4–40 xu; a net haul brings 1–5
-- commons of ≈ 8 xu). With these, any rod from the bamboo up with any bait nets more per hour than the starter's wooden
-- rod and worms (the audit's simulator, skilled and average players); a better bait on the wooden rod still does not pay.
update public.shop_items s set price = v.price
  from (values
    ('bait_shrimp',       1),   -- Mồi tép       was   5 a bait
    ('bait_bloodworm',    3),   -- Mồi trùn chỉ  was  12
    ('bait_gold',         6),   -- Mồi vàng      was  25
    ('net_small',        50),   -- Lưới nhỏ      was 250 (20 hauls)
    ('net_big',         120)    -- Lưới lớn      was 600 (30 hauls)
  ) v(id, price)
 where s.id = v.id and s.price is distinct from v.price;

-- ---------- J. The treasure panel's day ----------
-- _fx_extras_state (0076_fishing_extras.sql's, verbatim but for the line marked econ v2): found_today, the chests found
-- this Vietnam day (TreasurePanel shows "Hôm nay: n/3"; lib/game/fishing/extras.ts TREASURE_PER_DAY).
create or replace function public._fx_extras_state(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return jsonb_build_object(
    'server_now', now(),
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'boat', jsonb_build_object('owned', exists (select 1 from public.boats where account_id = p_account),
                               'aboard', public._boat_aboard(p_account), 'price', (public._boat_geo()->>'price')::int),
    'maps', coalesce((select jsonb_agg(public._treasure_json(t) order by t.created_at)
                        from public.treasure_maps t where t.account_id = p_account and t.found_at is null), '[]'::jsonb),
    'found', (select count(*) from public.treasure_maps where account_id = p_account and found_at is not null),
    'found_today', (select count(*) from public.treasure_maps where account_id = p_account and found_at >= public._vn_day_start()),   -- econ v2 (J: the chests found today, of 3)
    'machines', coalesce((select jsonb_agg(machine order by machine) from public.farm_machines where account_id = p_account),
                         '[]'::jsonb),
    'job', (select jsonb_build_object('recipe', recipe, 'batches', batches, 'started_at', started_at, 'ready_at', ready_at)
              from public.processor_jobs where account_id = p_account),
    'goods', coalesce((select jsonb_object_agg(recipe, qty) from public.processed_goods where account_id = p_account and qty > 0),
                      '{}'::jsonb),
    'recipes', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'input_kind', input_kind, 'input_id', input_id,
                                                    'input_kg', input_kg, 'value', value, 'minutes', minutes) order by sort_order)
                  from public.processor_recipes));
end $$;
