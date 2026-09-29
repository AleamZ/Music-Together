-- =========================================================
-- 0082_tester1_max.sql — DATA ONLY (owner 2026-09-29: "tạo cho tester1 với full level tất cả để đi test game").
-- The owner's test account (accounts.username 'tester1', matched as the app does: lower(username), 0004's unique index)
-- is maxed out in every progression system so every gate can be tested. Re-runnable (every write is an upsert or an
-- "only if missing"), and a no-op when the account does not exist. No schema, function or global config changes.
--
-- Coins: the wallet is NOT touched and nothing here writes coin_ledger or game_events — rows are written directly, so
-- no reward is paid: achievements / collections / levels are inserted as already reached (their pay-once functions
-- see the rows and never pay them later), the ladder floors as already cleared (a later clear pays the 10 % repeat
-- prize, never the first-clear one). The only trigger side effect — 0032's "new car" village news line on the
-- owned_vehicles insert — is deleted again below.
--
--   Progression (0070): level 99 (the max; XP = _pg_xp_at(99)), every achievement, the "Huyền thoại" title worn,
--     stats at least every achievement goal, the whole Fishdex (best = the species' max weight), every collection,
--     every waypoint discovered; every map_levels gate is ≤ 99.
--   Professions (0077): every nghề at level 20 (21 000 xp, the cap of _prof_level), every skill node learned (each
--     tree costs ≤ 11 of its 20 points), Ngư dân as the main nghề (chosen > 24 h ago, so a switch is open), stamina full.
--   Dojo (0050–0052): all 7 styles at rank 4 (the top belt; the specials follow the rank), their uniforms, no exam
--     cooldown; fight_profiles ≥ 50 wins and no PvP lock; the underground unlocked, rating 1600 (Thủy quái), every
--     ladder floor of the CURRENT season cleared (ug_ladder is per season).
--   Fishing (0012/0034/0072/0076): every rod and net owned at +5 (durability at the +5 max), both bobbers, the bait box,
--     both buckets, 60 bait (the box's cap), the loadout rod_master / bobber_lamp / bait_gold, the casting windows reset;
--     the boat; the three farm machines.
--   Mining / crafting (0072): all four pickaxes at +5 (durability at the +5 max), 30 of every ore and herb, 5 of every
--     potion.
--   Vehicles (0027): bike, moto, car.   Pets (0036/0074): a Mythic cat, level 50, form 2, affection 100, training at the
--     cap (30), every pet skill, followed; a level-50 cá hổ battle fish (training cap, every fish skill).
--   House (0041/0074): an aquarium_big tank (with decor) and nine furniture samples in storage.   Rain (0038): a full
--     ô gấp.   Vitals: hunger/thirst 100, no faint, no cold / heat shock / cramp.
--   Anti-cheat (0015/0055/0065): strikes, lock and ban state cleared, off the blacklist, stat flags dropped (only the
--     account's rows; anticheat_config untouched).
-- =========================================================

do $$
declare
  v_acc uuid;
  v_season integer;
  v_tank bigint;
  v_pet bigint;
begin
  select id into v_acc from public.accounts where lower(username) = 'tester1';
  if v_acc is null then
    raise notice '0082: no tester1 account, nothing to do';
    return;
  end if;

  -- ---------- Progression (0070) ----------
  insert into public.player_progress (account_id, xp, level, title, updated_at)
  values (v_acc, public._pg_xp_at(99), 99, 'level_30', now())
  on conflict (account_id) do update
    set xp = greatest(public.player_progress.xp, excluded.xp), level = 99,
        title = coalesce(public.player_progress.title, excluded.title), updated_at = now();

  insert into public.player_fishdex (account_id, species, caught, best_g)
  select v_acc, f.id, 1, f.max_g from public.fish_species f
  on conflict (account_id, species) do update
    set caught = greatest(public.player_fishdex.caught, 1),
        best_g = greatest(public.player_fishdex.best_g, excluded.best_g);

  insert into public.player_stats (account_id, fish_total, biggest_g, biggest_species, earned_total, farm_earned, fight_wins)
  select v_acc, 1000, f.max_g, f.id, 1000000, 50000, 500
    from public.fish_species f order by f.max_g desc, f.id limit 1
  on conflict (account_id) do update
    set fish_total = greatest(public.player_stats.fish_total, excluded.fish_total),
        biggest_species = case when excluded.biggest_g > public.player_stats.biggest_g then excluded.biggest_species
                               else public.player_stats.biggest_species end,
        biggest_g = greatest(public.player_stats.biggest_g, excluded.biggest_g),
        earned_total = greatest(public.player_stats.earned_total, excluded.earned_total),
        farm_earned = greatest(public.player_stats.farm_earned, excluded.farm_earned),
        fight_wins = greatest(public.player_stats.fight_wins, excluded.fight_wins);

  insert into public.player_achievements (account_id, achievement)
  select v_acc, c.id from public.achievement_catalog c
  on conflict do nothing;

  insert into public.player_collections (account_id, collection)
  select v_acc, k.id from public.collection_catalog k
  on conflict do nothing;

  insert into public.player_waypoints (account_id, waypoint)
  select v_acc, w.id from public.waypoints w
  on conflict do nothing;

  update public.characters c
     set pg_level = 99,
         pg_title = (select a.title from public.player_progress p join public.achievement_catalog a on a.id = p.title
                      where p.account_id = v_acc)
   where c.account_id = v_acc;

  -- ---------- Professions (0077) ----------
  insert into public.player_professions (account_id, prof, xp)
  select v_acc, c.id, 21000 from public.profession_catalog c
  on conflict (account_id, prof) do update set xp = greatest(public.player_professions.xp, excluded.xp);

  insert into public.player_profession_main (account_id, prof, chosen_at)
  values (v_acc, 'ngu_dan', now() - interval '25 hours')
  on conflict (account_id) do nothing;

  insert into public.player_skills (account_id, node)
  select v_acc, n.id from public.skill_nodes n
  on conflict do nothing;

  insert into public.player_stamina (account_id, value, at, rest_until)
  values (v_acc, public._stamina_max(v_acc), now(), null)
  on conflict (account_id) do update set value = excluded.value, at = excluded.at, rest_until = null;

  -- ---------- Dojo, fights, underground (0049–0052) ----------
  insert into public.martial_enrollments (account_id, style, rank, rank_at, enrolled_at, exam_cooldown_until)
  select v_acc, s.id, 4, now(), now(), null from public.martial_styles s
  on conflict (account_id, style) do update set rank = 4, exam_cooldown_until = null;

  insert into public.account_items (account_id, item_id)
  select v_acc, s.uniform from public.martial_styles s
  on conflict do nothing;

  insert into public.fight_profiles (account_id, wins)
  values (v_acc, 50)
  on conflict (account_id) do update
    set wins = greatest(public.fight_profiles.wins, excluded.wins), pvp_locked_until = null;

  v_season := public._ug_season();
  insert into public.ug_profiles (account_id, unlocked_at, hint_at, rating, rated, season, peak, best_tier)
  values (v_acc, now(), now(), 1600, 30, v_season, 1600, 'thuy_quai')
  on conflict (account_id) do update
    set unlocked_at = coalesce(public.ug_profiles.unlocked_at, now()),
        rating = greatest(public.ug_profiles.rating, 1600),
        rated = greatest(public.ug_profiles.rated, 30),
        season = greatest(public.ug_profiles.season, excluded.season),
        peak = greatest(public.ug_profiles.peak, 1600),
        best_tier = 'thuy_quai';

  insert into public.ug_ladder (account_id, season, floor, cleared_at, clears, attempts)
  select v_acc, v_season, b.floor, now(), 1, 1 from public.ug_bosses b
  on conflict (account_id, season, floor) do update
    set cleared_at = coalesce(public.ug_ladder.cleared_at, now()),
        clears = greatest(public.ug_ladder.clears, 1),
        attempts = greatest(public.ug_ladder.attempts, 1);

  -- ---------- Fishing gear (0012/0034) at +5 (0072) ----------
  insert into public.inventory (account_id, item_id, qty, durability)
  select v_acc, s.id, 1, public._upgrade_max(s.durability, 5)
    from public.shop_items s
   where s.kind in ('rod', 'net', 'bobber', 'bait_box', 'bucket') and not s.starter and s.price is not null
  on conflict (account_id, item_id) do update
    set qty = greatest(public.inventory.qty, 1), durability = excluded.durability;

  insert into public.inventory (account_id, item_id, qty)
  values (v_acc, 'bait_gold', 30), (v_acc, 'bait_bloodworm', 15), (v_acc, 'bait_shrimp', 10), (v_acc, 'bait_worm', 5)
  on conflict (account_id, item_id) do update set qty = excluded.qty;

  insert into public.item_upgrades (account_id, item_id, level)
  select v_acc, s.id, 5 from public.shop_items s where s.kind in ('rod', 'net')
  union all
  select v_acc, k.id, 5 from public.pickaxe_kinds k
  on conflict (account_id, item_id) do update set level = 5;

  insert into public.fishing_profiles (account_id, rod, bobber, bait)
  values (v_acc, 'rod_master', 'bobber_lamp', 'bait_gold')
  on conflict (account_id) do update
    set rod = excluded.rod, bobber = excluded.bobber, bait = excluded.bait,
        window_start = null, window_casts = 0, day_on = null, day_casts = 0;

  insert into public.boats (account_id) values (v_acc) on conflict do nothing;

  insert into public.farm_machines (account_id, machine)
  values (v_acc, 'sprinkler'), (v_acc, 'harvester'), (v_acc, 'processor')
  on conflict do nothing;

  -- ---------- Mining & crafting (0072) ----------
  insert into public.mine_tools (account_id, tool_id, durability)
  select v_acc, k.id, public._upgrade_max(k.durability, 5) from public.pickaxe_kinds k
  on conflict (account_id, tool_id) do update set durability = excluded.durability;

  insert into public.craft_bag (account_id, item_id, qty)
  select v_acc, c.id, case when c.kind = 'potion' then 5 else 30 end from public.craft_items c
  on conflict (account_id, item_id) do update set qty = greatest(public.craft_bag.qty, excluded.qty);

  -- ---------- Vehicles (0027) ----------
  insert into public.owned_vehicles (account_id, vehicle_id)
  select v_acc, v.id from public.vehicle_catalog v
  on conflict do nothing;
  -- 0032's news_on_vehicle posted "tester1 bought a car" just now (only on a first insert): not a real purchase.
  delete from public.news_events
   where kind = 'car' and meta->>'account_id' = v_acc::text and created_at >= now();

  -- ---------- Pets (0036/0074) ----------
  select id into v_pet from public.pets where account_id = v_acc and name = 'Mèo Max' order by id limit 1;
  if v_pet is null then
    insert into public.pets (account_id, species, variant, name, fullness, happy, rarity, level, xp, affection, form,
                             trn_hp, trn_atk, trn_def, trn_spd, skills, origin)
    values (v_acc, 'meo', 'cam', 'Mèo Max', 100, 100, 5, 50, 0, 100, 2, 30, 30, 30, 30,
            array['tackle', 'guard', 'bite', 'heal', 'fury', 'ultimate'], 'gacha')
    returning id into v_pet;
  else
    update public.pets
       set fullness = 100, happy = 100, stats_at = now(), rarity = 5, level = 50, affection = 100, form = 2,
           trn_hp = 30, trn_atk = 30, trn_def = 30, trn_spd = 30,
           skills = array['tackle', 'guard', 'bite', 'heal', 'fury', 'ultimate']
     where id = v_pet;
  end if;
  insert into public.pet_owner (account_id, active_pet) values (v_acc, v_pet)
  on conflict (account_id) do update set active_pet = excluded.active_pet;

  if not exists (select 1 from public.fish_fighters where account_id = v_acc and name = 'Cá hổ Max') then
    insert into public.fish_fighters (account_id, fish_id, species_id, weight_g, name, level, xp,
                                      trn_hp, trn_atk, trn_def, trn_spd, skills)
    values (v_acc, gen_random_uuid(), 'ca_ho', 40000, 'Cá hổ Max', 50, 0, 30, 30, 30, 30,
            array['tackle', 'splash', 'guard', 'bite', 'fury']);
  end if;

  -- ---------- House items (0041/0074): in storage ----------
  insert into public.furniture_items (account_id, item_id)
  select v_acc, f.id from public.furniture_catalog f
   where f.id in ('aquarium_big', 'bed_go', 'sofa_hiendai', 'tv', 'fridge', 'lamp_hoian', 'plant_mai', 'rug_batu',
                  'painting_sen', 'cabinet_go')
     and not exists (select 1 from public.furniture_items i where i.account_id = v_acc and i.item_id = f.id);
  select id into v_tank from public.furniture_items where account_id = v_acc and item_id = 'aquarium_big' order by id limit 1;
  if v_tank is not null then
    insert into public.aquarium_tanks (tank, decor) values (v_tank, array['rong', 'san_ho', 'ruong', 'lau_dai'])
    on conflict (tank) do nothing;
  end if;

  -- ---------- Umbrella (0038) ----------
  if not exists (select 1 from public.umbrellas where account_id = v_acc and kind = 'o_gap' and left_s > 0) then
    insert into public.umbrellas (account_id, kind, left_s) values (v_acc, 'o_gap', public._umbrella_life_s('o_gap'));
  end if;

  -- ---------- Vitals and ailments (0025/0033/0038/0045) ----------
  insert into public.vitals (account_id, hunger, thirst, starve_s, fainted_until, last_tick, faint_day, faint_count)
  values (v_acc, 100, 100, 0, null, now(), null, 0)
  on conflict (account_id) do update
    set hunger = 100, thirst = 100, starve_s = 0, fainted_until = null, last_tick = now(), faint_day = null, faint_count = 0;
  update public.heat_state set shocked = false, cramp_until = null, cramp_room = null where account_id = v_acc;
  update public.rain_state set wet_s = 0, cold_until = null, cold_wet_s = 0 where account_id = v_acc;

  -- ---------- Anti-cheat (only this account's rows) ----------
  update public.anticheat_status
     set strikes = 0, last_strike_at = null, last_strike_code = null, locked_until = null, ban_state = null, banned_at = null
   where account_id = v_acc
     and (strikes > 0 or locked_until is not null or ban_state is not null);
  delete from public.blacklisted_accounts where account_id = v_acc;
  delete from public.ac_stat_flags where account_id = v_acc;
  update public.accounts set is_banned = false where id = v_acc and is_banned;
end $$;
