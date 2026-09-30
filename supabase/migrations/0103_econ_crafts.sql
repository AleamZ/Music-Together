-- =========================================================
-- 0103_econ_crafts.sql — Kinh tế v2, mining / forest / cooking / crafting (spec docs/superpowers/specs/
-- 2026-09-30-economy-v2-design.md §6, §8 S3). ADDITIVE and re-runnable. Run after 0102 (it re-creates none of 0101's /
-- 0102's functions, so it also applies right after 0100). Target: a mid-tier tool ≈ 2 000–3 000 xu an active hour, the
-- best ≈ 4 500; crafting adds value, it no longer prints it.
--   A. Cooking (K1): _cook_recipes — the fee-only dishes (bông súng, gỏi bông điên điển, cơm tấm sườn) sell for 0.8 × their
--      fee (they are for buffs and stamina, not a profit loop); an ingredient dish's price is its fee + 1.3 × the
--      ingredients' NPC value at M = 1 (a meat's _wild_items price; a fish's expected catch at the wooden rod, M = S = 1,
--      on 0101's prices: cá lóc 10.33 (10 xu/kg), cá rô 5.33 (40), cá sặc 4.43 (38) — if 0101 prices them otherwise,
--      re-derive the four fish dishes; on 0098's 60 / 45 / 40 xu/kg they would be 111 / 111 / 46 / 58) + 20.
--      _cook_pct 20 / 100 / 125 / 150 → 20 / 100 / 110 / 125 % (price, stamina, buff minutes).
--      cook_start costs 2 stamina ('cook'); cook_eat restores half the stamina it did; cook_sell pays through the thương
--      lái (_npc_sale, 0100); cook_finish emits 'item_crafted' (K7).
--   B. Mining (K2, K5, K9): ore prices ÷ 4 (đá 1 … tinh thể 500; herbs keep theirs); 200 digs a VN day (was 400);
--      sell_ore (ores and herbs) pays through the thương lái; a herb gather costs 1 stamina; a dig's hunger / thirst
--      1.5 / 2.0 → 0.5 / 0.67.
--   C. Woodcutting (K3): log prices ÷ 3; 30 full-price logs a day (was 40), then half price as before, and at most 150
--      logs a day (chop_start refuses 'daily log limit', chop_finish never grants past it); wood_sell pays through the
--      thương lái after its own half-price rule, its wood_sell_pct perk ≤ 10 % (was 20). Chopping never cost hunger or
--      thirst (K9 has nothing to divide there).
--   D. Hunting and trapping (K4): 40 kills a VN day (was 60, wild_start / wild_finish); the night market +10 % (was
--      +30 %); wild_sell pays through the thương lái.
--   E. Crafting (K6, K7, S3): the upgrade coin floor 50 → 200 × (level + 1) (_upgrade_coins); brew_finish,
--      upgrade_finish (a success) and cook_finish emit 'item_crafted' (qty 1) — the NPC quest n_nghe_3 "Thử chế tạo"
--      can be done at last; potion fees pot_hunger 10 → 60, pot_thirst 10 → 25, pot_canh 20 → 120 (self-brewed food at
--      ≈ 25–50 % of the restaurant's price a point, not a way round it), pot_luck 80 → 150, pot_luck2 300 → 600, and
--      pot_miner 60 → 300 (a buff priced by what it earns: +1 ore a dig for 10 min is worth ≈ 420 xu at the best spot now,
--      spec §3 principle 6).
--   F. Professions (K8): a switch of main nghề 500 → 2 000 xu, a skill reset 300 → 1 000 (profession_choose, skill_reset,
--      and _prof_json, which shows both fees).
-- Re-created (each the NEWEST, verbatim but for the lines marked "-- econ v2"): _cook_recipes (0097), _cook_pct (0096),
--   cook_start (0097), cook_finish (0096), cook_sell (0096), cook_eat (0097), mine_start / mine_finish (0087), sell_ore
--   (0072), gather_herb (0072), _upgrade_coins (0072), upgrade_finish / brew_finish (0087), _forest_trees (0096),
--   chop_start (0097), chop_finish / wood_sell (0096), wild_start / wild_finish (0097), wild_sell (0075),
--   profession_choose / _prof_json (0096), skill_reset (0077). Data: craft_items prices, potion_recipes fees.
-- Answers: sell_ore, wood_sell, cook_sell and wild_sell add 'npc_cut' (the xu the thương lái kept) and 'npc' (the day's
--   totals, _npc_quota); 'earned' (sold.xu for sell_ore) is what was paid. Errors: 'daily log limit' (53400, detail =
--   seconds to the VN midnight), 'too tired' from cook_start and gather_herb. Events: 'item_crafted' (meta source
--   brew | upgrade | cook, item). Ledger reasons: unchanged.
-- =========================================================

-- ---------- A. Cooking ----------
-- _cook_recipes (0097_forest_complete.sql, verbatim but for the prices marked econ v2)
create or replace function public._cook_recipes() returns table (id text, name text, meat text, meat_qty integer, fish text,
                                                                 fish_qty integer, fee integer, steps text[], price integer,
                                                                 stamina integer, buff text, buff_value integer, buff_min integer)
language sql immutable parallel safe
as $$
  values ('ca_loc_nuong_trui', 'Cá lóc nướng trui', null, 0, 'ca_loc', 1, 10, array['fire', 'slice', 'stir'], 43, 12, null, 0, 0),   -- econ v2: 155 → 43 = 10 + 1.3 × 10.33 + 20
         ('canh_chua_ca_loc', 'Canh chua cá lóc', null, 0, 'ca_loc', 1, 10, array['slice', 'fire', 'stir'], 43, 16, 'stamina_regen', 20, 10),   -- econ v2: 175 → 43 = 10 + 1.3 × 10.33 + 20
         ('ca_ro_kho_tieu', 'Cá rô kho tiêu', null, 0, 'ca_ro', 2, 10, array['stir', 'fire'], 44, 11, 'rare_fish', 5, 12),   -- econ v2: 145 → 44 = 10 + 1.3 × 2 × 5.33 + 20
         ('bong_sung_xao_toi', 'Bông súng xào tỏi', null, 0, null, 0, 80, array['slice', 'fire', 'stir'], 64, 9, 'speed', 5, 10),   -- econ v2: 115 → 64 = 0.8 × 80
         ('goi_bong_dien_dien', 'Gỏi bông điên điển', null, 0, null, 0, 120, array['slice', 'fire', 'stir'], 96, 13, 'strength', 10, 12),   -- econ v2: 175 → 96 = 0.8 × 120
         ('chuot_dong_nuong_sa', 'Chuột đồng nướng sả', 'thit_chuot_dong', 2, null, 0, 10, array['slice', 'stir', 'fire'], 121, 15, 'hunt_chance', 3, 12),   -- econ v2: 180 → 121 = 10 + 1.3 × 2 × 35 + 20
         ('com_tam_suon', 'Cơm tấm sườn', null, 0, null, 0, 120, array['slice', 'fire', 'stir'], 96, 18, null, 0, 0),   -- econ v2: 170 → 96 = 0.8 × 120
         ('lau_mam_ca_linh', 'Lẩu mắm cá linh', null, 0, 'ca_sac', 2, 26, array['slice', 'fire', 'stir'], 58, 22, 'rare_fish', 10, 15),   -- econ v2: 265 → 58 = 26 + 1.3 × 2 × 4.43 + 20
         ('chao_ga_rung', 'Cháo gà rừng', 'thit_ga_rung', 1, null, 0, 13, array['slice', 'fire', 'stir'], 144, 20, 'stamina_regen', 30, 12),   -- econ v2: 220 → 144 = 13 + 1.3 × 85 + 20
         ('chao_ran_dau_xanh', 'Cháo rắn đậu xanh', 'thit_ran_ri_ca', 1, null, 0, 16, array['slice', 'fire', 'stir'], 166, 21, 'hunt_chance', 5, 15)   -- econ v2: 245 → 166 = 16 + 1.3 × 100 + 20
$$;

-- _cook_pct (0096_forest_professions.sql, verbatim but for the line marked econ v2)
create or replace function public._cook_pct(p_quality integer) returns integer
language sql immutable parallel safe
as $$ select case p_quality when 3 then 125 when 2 then 110 when 1 then 100 else 20 end $$;   -- econ v2: was 150 / 125

-- cook_start (0097_forest_complete.sql, verbatim but for the line marked econ v2)
create or replace function public.cook_start(p_session_token text, p_recipe text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; cp public.cook_profile; v_have integer; v_coins integer; v_u bigint[] := '{}'; v_t integer := 60;
        v_step text; b1 integer; b2 integer; v_hold integer; v_per integer;
        v_pan record; v_fish uuid[];                                                                        -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  if public._prof_main_level(v_acc, 'dau_bep') < 0 then
    raise exception 'not a chef' using errcode = '42501';
  end if;
  select * into r from public._cook_recipes() c where c.id = p_recipe;
  if not found then raise exception 'invalid recipe' using errcode = '22023'; end if;
  perform public._vitals_guard(v_acc);
  perform public._wallet_lock(v_acc);
  insert into public.cook_profile (account_id) values (v_acc) on conflict do nothing;
  select * into cp from public.cook_profile where account_id = v_acc for update;
  if cp.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  perform public._stamina_spend(v_acc, 2, 'cook');                                                              -- econ v2: a dish costs 2 stamina (was 0)
  -- 0097 { the pan (1 durability a dish) and the recipe's fish from the catch
  select t.item into v_pan from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'pan'
   where t.account_id = v_acc and t.durability > 0 order by t.durability desc limit 1;
  if not found then raise exception 'no pan' using errcode = '22023'; end if;
  if r.fish is not null then
    v_fish := array(select f.id from public.fish f
                     where f.account_id = v_acc and f.species_id = r.fish
                       and not exists (select 1 from public.fish_fighters ff where ff.fish_id = f.id)
                     order by f.caught_at limit r.fish_qty for update of f);
    if cardinality(v_fish) < r.fish_qty then raise exception 'no ingredients' using errcode = '22023'; end if;
  end if;
  -- 0097 }
  select coins into v_coins from public.wallets where account_id = v_acc;
  if coalesce(v_coins, 0) < r.fee then raise exception 'insufficient funds' using errcode = '22023'; end if;
  if r.meat is not null then
    select qty into v_have from public.wild_bag where account_id = v_acc and item = r.meat for update;
    if coalesce(v_have, 0) < r.meat_qty then raise exception 'no ingredients' using errcode = '22023'; end if;
    update public.wild_bag set qty = qty - r.meat_qty where account_id = v_acc and item = r.meat;
  end if;
  if r.fish is not null then delete from public.fish where id = any(v_fish); end if;                  -- 0097
  update public.prof_tools set durability = durability - 1 where account_id = v_acc and item = v_pan.item;   -- 0097
  if r.fee > 0 then perform public._pay(v_acc, -r.fee, 'cook_fee', 'cook: ' || r.id); end if;
  update public.cook_profile set last_at = now() where account_id = v_acc;
  -- the round, step by step (lib/game/forest/cook.ts reads it back from the events)
  foreach v_step in array r.steps loop
    if v_step = 'slice' then
      b1 := v_t + 40 + floor(random() * 31)::int;
      b2 := b1 + 35 + floor(random() * 31)::int;
      v_u := v_u || array[1, v_t, b2 + 30, b1, b2, 0]::bigint[];
      v_t := b2 + 60;
    elsif v_step = 'stir' then
      v_hold := 60 + floor(random() * 61)::int;
      v_u := v_u || array[2, v_t, v_t + v_hold + 120, v_hold, 0, 0]::bigint[];
      v_t := v_t + v_hold + 150;
    else
      v_per := 80 + floor(random() * 61)::int;
      v_u := v_u || array[3, v_t, v_t + 240, v_per, floor(random() * v_per)::int, 25 + floor(random() * 51)::int]::bigint[];
      v_t := v_t + 270;
    end if;
  end loop;
  perform public._mg_open(v_acc, 'cook', 'cook', v_u, 0, jsonb_build_object('recipe', r.id));
  return jsonb_build_object('round', jsonb_build_object('game', 'cook', 'live', 'cook', 'recipe', r.id,
                                                        'steps', to_jsonb(r.steps), 'started_at', now()),
                            'coins', (select coins from public.wallets where account_id = v_acc));
end $$;

-- cook_finish (0096_forest_professions.sql, verbatim but for the line marked econ v2)
create or replace function public.cook_finish(p_session_token text, p_a integer[], p_b integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; l public.mg_live; u bigint[]; n integer; v_end integer; v_bad text; v_ev jsonb; v_rep jsonb; v_score integer;
        v_q integer; v_code text; r record; t integer; st integer; en integer;
begin
  v_acc := public._ac_account(p_session_token);
  l := public._mg_close(v_acc, 'cook', 'cook', p_a, p_b);
  if l.account_id is null then raise exception 'round not found' using errcode = '22023'; end if;
  if l.opened_at < now() - interval '90 seconds' then return jsonb_build_object('result', 'lost', 'why', 'expired'); end if;
  if l.started_at is null then return jsonb_build_object('result', 'lost', 'why', 'not played'); end if;
  u := l.params;
  n := cardinality(u) / 6;
  v_end := u[6 * n - 3]::int;
  select * into r from public._cook_recipes() c where c.id = l.meta->>'recipe';
  v_ev := jsonb_build_object('recipe', r.id, 'a', to_jsonb(l.a[1:12]), 'b', to_jsonb(l.b[1:12]));
  v_bad := l.meta->>'err';
  if v_bad is null and (coalesce(cardinality(l.a), 0) > 12 or coalesce(cardinality(l.b), 0) > 6) then v_bad := 'too_many'; end if;
  -- an input in a step claimed less than 0.1 s after the step's reveal
  if v_bad is null then
    for i in 1 .. n loop
      st := u[6 * i - 4]; en := u[6 * i - 3];
      foreach t in array (l.a || l.b) loop
        if t >= st and t <= en and (l.seen[i] is null
            or l.started_at + make_interval(secs => t / 60.0) < l.seen[i] + interval '100 milliseconds') then
          v_bad := 'early';
        end if;
      end loop;
    end loop;
  end if;
  if v_bad is not null then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'cook_bad_input', 'cook_finish', v_ev || jsonb_build_object('error', v_bad), null, 'invalid round');
  end if;
  if now() < l.started_at + make_interval(secs => 0.9 * v_end / 60.0) then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'cook_too_fast', 'cook_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, 'invalid round');
  end if;
  if public._mg_late(l) then
    perform public._ac_flag(v_acc, 'cook_late', 'cook_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    return jsonb_build_object('result', 'lost', 'why', 'late');
  end if;
  v_rep := public._cook_score(u, l.a, l.b);
  v_score := (v_rep->>'score')::int;
  if v_score >= 100 then
    v_code := public._craft_timing(v_acc, 'cook_timing', 'cook_finish', v_ev || jsonb_build_object('replay', v_rep));
    if v_code is not null then
      return jsonb_build_object('result', 'lost', 'why', 'refused')
             || public._ac_flag(v_acc, v_code, 'cook_finish', v_ev, null, 'invalid round');
    end if;
  end if;
  v_q := public._cook_quality(v_score);
  insert into public.cooked_dishes (account_id, dish, quality, qty) values (v_acc, r.id, v_q, 1)
  on conflict (account_id, dish, quality) do update set qty = public.cooked_dishes.qty + 1;
  perform public._game_event(v_acc, 'food_cooked', 1, jsonb_build_object('recipe', r.id, 'quality', v_q, 'score', v_score));
  perform public._game_event(v_acc, 'item_crafted', 1, jsonb_build_object('source', 'cook', 'item', r.id));     -- econ v2
  perform public._game_event(v_acc, 'xp_grant', 2 + v_q * 2, jsonb_build_object('source', 'cook'));
  return jsonb_build_object('result', 'ok', 'dish', r.id, 'score', v_score, 'steps', v_rep->'steps', 'quality', v_q,
                            'forest', public._forest_json(v_acc));
end $$;

-- cook_sell (0096_forest_professions.sql, verbatim but for the lines marked econ v2)
create or replace function public.cook_sell(p_session_token text, p_dish text, p_quality integer, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; r record; v_have integer; v_pay integer; v_bal integer;
        v_gross integer;                                                                                        -- econ v2
begin
  v_acc := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'cook_sell', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  select * into r from public._cook_recipes() c where c.id = p_dish;
  if not found or p_quality is null or p_quality not between 0 and 3 then raise exception 'invalid item' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return public._ac_flag(v_acc, 'bad_qty', 'cook_sell', jsonb_build_object('dish', left(p_dish, 16), 'qty', p_qty), null, 'invalid quantity');
  end if;
  perform public._wallet_lock(v_acc);
  select qty into v_have from public.cooked_dishes where account_id = v_acc and dish = p_dish and quality = p_quality for update;
  if coalesce(v_have, 0) < p_qty then raise exception 'not enough' using errcode = '22023'; end if;
  update public.cooked_dishes set qty = qty - p_qty where account_id = v_acc and dish = p_dish and quality = p_quality;
  v_gross := (r.price * public._cook_pct(p_quality) / 100) * p_qty;                                             -- econ v2: the dishes' value
  v_pay := public._npc_sale(v_acc, v_gross);                                                                    -- econ v2: the thương lái (0100)
  if v_pay > 0 then                                                                                             -- econ v2
    v_bal := public._pay(v_acc, v_pay, 'dish_sell', p_dish || ' q' || p_quality || ' x' || p_qty);              -- econ v2: what was paid
  else v_bal := (select coins from public.wallets where account_id = v_acc); end if;                            -- econ v2
  return jsonb_build_object('earned', v_pay, 'coins', v_bal, 'forest', public._forest_json(v_acc),              -- econ v2
                            'npc_cut', v_gross - v_pay, 'npc', public._npc_quota(v_acc));                       -- econ v2
end $$;

-- cook_eat (0097_forest_complete.sql, verbatim but for the line marked econ v2)
create or replace function public.cook_eat(p_session_token text, p_dish text, p_quality integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; r record; v_have integer; s public.player_stamina; v_gain numeric;
begin
  v_acc := public._ac_account(p_session_token);
  select * into r from public._cook_recipes() c where c.id = p_dish;
  if not found or p_quality is null or p_quality not between 0 and 3 then raise exception 'invalid item' using errcode = '22023'; end if;
  select qty into v_have from public.cooked_dishes where account_id = v_acc and dish = p_dish and quality = p_quality for update;
  if coalesce(v_have, 0) < 1 then raise exception 'not enough' using errcode = '22023'; end if;
  update public.cooked_dishes set qty = qty - 1 where account_id = v_acc and dish = p_dish and quality = p_quality;
  v_gain := case when p_quality = 0 then 0 else floor(r.stamina * public._cook_pct(p_quality) / 200.0) end;     -- econ v2: half (was / 100)
  s := public._stamina_settle(v_acc);
  update public.player_stamina set value = least(public._stamina_max(v_acc), s.value + v_gain) where account_id = v_acc;
  -- 0097 { a buff dish: its buff for the recipe's minutes × the quality's % (Hỏng: nothing); the same buff is replaced
  if r.buff is not null and p_quality > 0 then
    delete from public.player_buffs where account_id = v_acc and kind = r.buff;
    perform public._buff_grant(v_acc, r.buff, r.buff_value, floor(r.buff_min * public._cook_pct(p_quality) / 100.0)::int);
  end if;
  -- 0097 }
  return jsonb_build_object('gained', v_gain, 'buff', case when r.buff is not null and p_quality > 0 then r.buff end,   -- 0097
                            'stamina', public._stamina_json(v_acc), 'forest', public._forest_json(v_acc));
end $$;

-- ---------- B. Mining ----------
-- Ore prices ÷ 4 (lib/game/mining/catalog.ts CRAFT_ITEMS mirrors them). Herbs keep 3 / 8 / 30.
update public.craft_items c set price = v.price                                                               -- econ v2
  from (values ('ore_da', 1), ('ore_than', 3), ('ore_dong', 6), ('ore_sat', 10), ('ore_bac', 20), ('ore_vang', 40),
               ('ore_ngoc', 80), ('ore_kimcuong', 175), ('ore_tinhthe', 500)) v(id, price)
 where c.id = v.id and c.price is distinct from v.price;

-- mine_start (0087_v22_fixes.sql, verbatim but for the line marked econ v2)
create or replace function public.mine_start(p_room_id uuid, p_session_token text, p_node integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_use integer[]; v_ac jsonb; mp public.mining_profiles;
        n public.mine_nodes; it public.craft_items; v_tool text; v_tier integer; v_level integer; v_win integer;
        v_seed bigint := floor(random() * 4294967296)::bigint; v_today date := public._vn_today();
        v_rd bigint[];                                                                                     -- 0087
begin
  if p_node is null or p_node not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_spot', 'mine_start', jsonb_build_object('node', p_node), p_room_id, 'invalid spot');
  end if;
  v_use := public._mine_node_use(p_node);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'mine_start', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  perform public._vitals_guard(v_account);
  mp := public._mining_profile(v_account);
  if mp.day_on = v_today and mp.day_digs >= 200 then                                                            -- econ v2: 200 digs a day (was 400)
    raise exception 'daily dig limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  delete from public.mine_digs where account_id = v_account;   -- 0078: the dig before the node, as mine_finish
  n := public._mine_node(p_room_id, p_node);
  if n.ready_at > now() then raise exception 'node empty' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = n.item_id;
  select t.tool_id, k.tier into v_tool, v_tier
    from public.mine_tools t join public.pickaxe_kinds k on k.id = t.tool_id
   where t.account_id = v_account and t.durability > 0 and k.tier >= it.min_tier
   order by k.tier desc limit 1;
  if v_tool is null then
    if exists (select 1 from public.mine_tools where account_id = v_account and durability > 0) then
      raise exception 'pickaxe too weak' using errcode = '22023';
    end if;
    raise exception 'no pickaxe' using errcode = '22023';
  end if;
  v_level := public._upgrade_level(v_account, v_tool);
  v_win := public._mine_win(v_tier, v_level);
  insert into public.mine_digs (account_id, room_id, node_no, item_id, tool_id, seed, need, win)
  values (v_account, p_room_id, p_node, it.id, v_tool, v_seed, it.hardness, v_win);
  update public.mining_profiles
     set day_digs = case when day_on = v_today then day_digs + 1 else 1 end, day_on = v_today
   where account_id = v_account;
  -- 0087 { the veins stay on the server (as the treasure dig's)
  v_rd := public._mg_roll('mine', null, it.hardness);
  perform public._mg_open(v_account, 'mine', 'mine', v_rd, 20 + floor(random() * 21)::int, jsonb_build_object('win', v_win));
  return jsonb_build_object('dig', jsonb_build_object('node', p_node, 'item', it.id, 'tool', v_tool, 'period', v_rd[1],
                                                      'need', it.hardness, 'win', v_win, 'live', 'mine', 'started_at', now()),
                            'state', public._mine_state(p_room_id, v_account));
  -- 0087 }
end $$;

-- mine_finish (0087_v22_fixes.sql, verbatim but for the line marked econ v2)
create or replace function public.mine_finish(p_room_id uuid, p_session_token text, p_strikes integer[], p_ticks integer,
                                              p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); d public.mine_digs; v_use integer[]; v_ac jsonb;
        v_bad text; v_rep jsonb; v_code text; v_ev jsonb; n public.mine_nodes; it public.craft_items; v_qty integer;
        v_perfect boolean; v_buff integer; v_dur integer; v_vit jsonb; v_n integer := coalesce(cardinality(p_strikes), 0);
        v_tm jsonb; v_exact boolean;                                                           -- 0078
        l public.mg_live;                                                                                  -- 0087
begin
  perform 1 from public.player_pos where account_id = v_account for update;   -- 0078: pos → dig → node, as mine_start
  delete from public.mine_digs where account_id = v_account and room_id = p_room_id returning * into d;
  if not found then raise exception 'dig not found' using errcode = '22023'; end if;
  l := public._mg_close(v_account, 'mine', 'mine', p_strikes, null);                                       -- 0087
  v_use := public._mine_node_use(d.node_no);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'mine_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  -- the wear of any finished dig
  update public.mine_tools set durability = greatest(0, durability - 1)
   where account_id = v_account and tool_id = d.tool_id
     and durability > 0                                                               -- 0078
  returning durability into v_dur;
  -- 0078 {
  -- the pickaxe the dig started with must still be there, with durability left
  if not found then
    return jsonb_build_object('result', 'lost', 'why', 'no_pickaxe', 'tool_broke', true,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  -- 0078 }
  if now() > d.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  if l.account_id is null then                                                                             -- 0087
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  v_ev := jsonb_build_object('node', d.node_no, 'pass', p_pass, 'ticks', p_ticks, 'n', v_n, 'strikes', to_jsonb(p_strikes[1:12]));
  v_bad := coalesce(public._mine_input_error(p_strikes, p_ticks), case when p_pass is null then 'pass' end,
                    l.meta->>'err', case when public._mg_dig_early(l, d.win) then 'early' end);            -- 0087
  if v_bad is not null then
    v_code := 'mine_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif p_pass then
    v_rep := public._mine_replay_p(l.params::integer[], d.need, d.win, p_strikes);                         -- 0087
    if v_rep->>'outcome' <> 'pass' or (v_rep->>'ticks')::int <> p_ticks or (v_rep->>'used')::int <> v_n then
      v_code := 'mine_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'need', d.need, 'win', d.win, 'replay', v_rep);  -- 0087
    elsif now() < d.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'mine_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', d.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'mine_late', 'mine_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              p_room_id, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late', 'tool_broke', coalesce(v_dur, 0) = 0,
                                'state', public._mine_state(p_room_id, v_account));
    -- 0087 }
    end if;
  end if;
  -- 0078 {
  -- the dig's timing (0065's harvest_timing): every strike a hit on the marker's best tick, over ≥ 3 hits, is soft; the
  -- 5th such dig in 24 h is hard and mines nothing
  if v_code is null and v_rep is not null then
    v_tm := public._mine_timing_p(l.params::integer[], d.need, d.win, p_strikes);                          -- 0087
    v_exact := d.need >= 3 and (v_tm->>'used')::int = d.need and (v_tm->>'exact')::int = d.need;
    perform public._ac_stat(v_account, 'mine', 1, 1, case when v_exact then 1 else 0 end);
    if v_exact then
      perform public._ac_flag(v_account, 'mine_timing', 'mine_finish', v_ev || jsonb_build_object('timing', v_tm),
                              p_room_id, null, false);
      if (select count(*) from public.anticheat_events e
           where e.account_id = v_account and e.code = 'mine_timing' and e.created_at > now() - interval '24 hours') >= 5 then
        v_code := 'mine_timing_repeat';
        v_ev := v_ev || jsonb_build_object('timing', v_tm, 'pattern', '5 in 24 h');
      end if;
    end if;
  elsif v_code is null and p_pass is false then
    perform public._ac_stat(v_account, 'mine', 1, 0, 0);
  end if;
  -- 0078 }
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'mine_finish', v_ev, p_room_id, 'invalid dig');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account)) || v_ac;
  end if;
  if not p_pass then
    return jsonb_build_object('result', 'lost', 'why', 'gave_up', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  n := public._mine_node(p_room_id, d.node_no);
  if n.ready_at > now() or n.item_id <> d.item_id then
    return jsonb_build_object('result', 'lost', 'why', 'taken', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  select * into it from public.craft_items where id = d.item_id;
  v_perfect := (v_rep->>'used')::int = d.need;
  v_buff := public._buff_power(v_account, 'miner');
  v_qty := 1 + case when v_perfect then 1 else 0 end + case when v_buff > 0 then 1 else 0 end;
  update public.mine_nodes set item_id = public._mine_roll(d.node_no, random()),
                               ready_at = now() + make_interval(secs => it.respawn_s)
   where room_id = p_room_id and node_no = d.node_no;
  perform public._bag_add(v_account, it.id, v_qty);
  v_vit := public._fishing_effort(v_account, 0.5, 0.67);                                                        -- econ v2: ÷ 3 (was 1.5, 2.0)
  perform public._game_event(v_account, 'ore_mined', v_qty,
    jsonb_build_object('item', it.id, 'rarity', it.rarity, 'node', d.node_no, 'perfect', v_perfect));
  perform public._game_event(v_account, 'xp_grant', it.xp * v_qty, '{"source":"mining"}'::jsonb);
  return jsonb_build_object('result', 'mined', 'item', it.id, 'qty', v_qty, 'perfect', v_perfect, 'buff', v_buff > 0,
                            'xp', it.xp * v_qty, 'tool_broke', coalesce(v_dur, 0) = 0, 'vitals', v_vit,
                            'state', public._mine_state(p_room_id, v_account));
end $$;

-- sell_ore (0072_mining_crafting.sql, verbatim but for the lines marked econ v2)
create or replace function public.sell_ore(p_session_token text, p_item text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('shop');
        it public.craft_items; v_pay integer;
        v_gross integer;                                                                                        -- econ v2
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'sell_ore', null, 'not at the shop');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  select * into it from public.craft_items where id = p_item and kind in ('ore', 'herb') and price is not null;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 9999 then
    return public._ac_flag(v_account, 'bad_qty', 'sell_ore', jsonb_build_object('item', p_item, 'qty', p_qty), null,
                           'invalid quantity', false);
  end if;
  perform public._wallet_lock(v_account);
  if not public._bag_take(v_account, it.id, p_qty) then raise exception 'not enough items' using errcode = '22023'; end if;
  v_gross := it.price * p_qty;                                                                                  -- econ v2
  v_pay := public._npc_sale(v_account, v_gross);                                                                -- econ v2: the thương lái (0100)
  if v_pay > 0 then perform public._pay(v_account, v_pay, 'ore_sell', it.id || ' x' || p_qty); end if;          -- econ v2
  return jsonb_build_object('sold', jsonb_build_object('item', it.id, 'qty', p_qty, 'xu', v_pay),
                            'npc_cut', v_gross - v_pay, 'npc', public._npc_quota(v_account),                    -- econ v2
                            'state', public._mine_state(null, v_account));
end $$;

-- gather_herb (0072_mining_crafting.sql, verbatim but for the line marked econ v2)
create or replace function public.gather_herb(p_room_id uuid, p_session_token text, p_node integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_use integer[]; v_ac jsonb; mp public.mining_profiles;
        n public.mine_nodes; it public.craft_items; v_qty integer;
begin
  if p_node is null or p_node not between 11 and 14 then
    return public._ac_flag(v_account, 'bad_spot', 'gather_herb', jsonb_build_object('node', p_node), p_room_id, 'invalid spot');
  end if;
  v_use := public._mine_node_use(p_node);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'gather_herb', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  perform public._vitals_guard(v_account);
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  n := public._mine_node(p_room_id, p_node);
  if n.ready_at > now() then raise exception 'node empty' using errcode = '22023'; end if;
  perform public._stamina_spend(v_account, 1);                                                                  -- econ v2: 1 stamina a gather (was 0)
  select * into it from public.craft_items where id = n.item_id;
  v_qty := case when random() < 0.3 then 2 else 1 end;
  update public.mine_nodes set item_id = public._mine_roll(p_node, random()), ready_at = now() + make_interval(secs => it.respawn_s)
   where room_id = p_room_id and node_no = p_node;
  perform public._bag_add(v_account, it.id, v_qty);
  perform public._game_event(v_account, 'herb_gathered', v_qty, jsonb_build_object('item', it.id, 'rarity', it.rarity, 'node', p_node));
  perform public._game_event(v_account, 'xp_grant', it.xp * v_qty, '{"source":"herbs"}'::jsonb);
  return jsonb_build_object('item', it.id, 'qty', v_qty, 'state', public._mine_state(p_room_id, v_account));
end $$;

-- ---------- C. Woodcutting ----------
-- _forest_trees (0096_forest_professions.sql, verbatim but for the prices marked econ v2: ÷ 3)
create or replace function public._forest_trees() returns table (id text, name text, need integer, respawn_min integer, log text,
                                                                 logs integer, price integer, rare boolean, upto integer)
language sql immutable parallel safe
as $$
  values ('cay_tre', 'Tre', 3, 2, 'go_tre', 2, 4, false, 350),   -- econ v2: 12 → 4
         ('cay_keo', 'Keo', 4, 3, 'go_keo', 2, 6, false, 650),   -- econ v2: 18 → 6
         ('cay_thong', 'Thông', 5, 5, 'go_thong', 2, 9, false, 820),   -- econ v2: 28 → 9
         ('cay_soi', 'Sồi', 7, 8, 'go_soi', 2, 15, true, 920),   -- econ v2: 45 → 15
         ('cay_go_do', 'Gõ đỏ', 9, 15, 'go_do', 2, 25, true, 970),   -- econ v2: 75 → 25
         ('cay_tram_huong', 'Trầm hương', 12, 45, 'go_tram_huong', 1, 73, true, 993),   -- econ v2: 220 → 73
         ('cay_than_moc', 'Thần mộc', 16, 120, 'go_than_moc', 1, 160, true, 1000)   -- econ v2: 480 → 160
$$;

-- chop_start (0097_forest_complete.sql, verbatim but for the lines marked econ v2)
create or replace function public.chop_start(p_session_token text, p_cx integer, p_cy integer, p_k integer, p_map text,
                                             p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; v_key text; tr record; ax record; pr public.chop_profile;
        v_have integer; b1 integer; b2 integer; b3 integer; v_win integer;
        v_w record;                                                                                        -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  if p_k is null or p_k not between 0 and 7 or p_cx is null or p_cy is null then
    raise exception 'bad tree' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'chop_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  select * into v_w from public._forest_xy(pp.map, pp.x, pp.y);                                        -- 0097: either game
  if v_w.wx is null or not public._near_forest(v_w.wx, v_w.wy) then                                     -- 0097
    raise exception 'not in forest' using errcode = '22023';
  end if;
  if not exists (select 1 from public.world_forest f where f.cx = p_cx and f.cy = p_cy) then
    raise exception 'bad tree' using errcode = '22023';
  end if;
  if abs(floor(v_w.wx / 64) - p_cx) > 1 or abs(floor(v_w.wy / 64) - p_cy) > 1 then                    -- 0097
    raise exception 'too far' using errcode = '22023';
  end if;
  v_key := p_cx || ':' || p_cy || ':' || p_k;
  if exists (select 1 from public.forest_felled f where f.tree_key = v_key and f.respawn_at > now()) then
    raise exception 'felled' using errcode = '22023';
  end if;
  select * into tr from public._forest_trees() t where t.id = public._tree_of(p_cx, p_cy, p_k);
  -- the best axe that still cuts
  select c.id, c.power, t.durability into ax
    from public.prof_tools t join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'axe'
   where t.account_id = v_acc and t.durability > 0
   order by c.power desc, t.durability desc limit 1;
  if not found then raise exception 'no axe' using errcode = '22023'; end if;
  insert into public.chop_profile (account_id) values (v_acc) on conflict do nothing;
  select * into pr from public.chop_profile where account_id = v_acc for update;
  if pr.last_at > now() - interval '1.5 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
  -- econ v2 { at most 150 logs a VN day: no round once they are in
  if pr.day = public._vn_today() and pr.logs >= 150 then
    raise exception 'daily log limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
  -- econ v2 }
  perform public._stamina_spend(v_acc, 4, 'chop');
  update public.chop_profile set last_at = now() where account_id = v_acc;
  select coalesce((select c.hits from public.chop_progress c where c.account_id = v_acc and c.tree_key = v_key
                      and c.at > now() - interval '30 minutes'), 0) into v_have;
  b1 := 80 + floor(random() * 50)::int;
  b2 := b1 + 50 + floor(random() * 50)::int;
  b3 := b2 + 50 + floor(random() * 50)::int;
  v_win := case when public._perk(v_acc, 'chop_window_ms') > 0 then 13 else 11 end;
  perform public._mg_open(v_acc, 'chop', 'chop', array[b1, b2, b3]::bigint[], 0,
                          jsonb_build_object('tree', v_key, 'kind', tr.id, 'axe', ax.id, 'power', ax.power, 'win', v_win));
  return jsonb_build_object('round', jsonb_build_object('game', 'chop', 'live', 'chop', 'tree', v_key, 'kind', tr.id,
                                                        'need', tr.need, 'have', v_have, 'axe', ax.id, 'power', ax.power,
                                                        'durability', ax.durability, 'win', v_win, 'started_at', now()));
end $$;

-- chop_finish (0096_forest_professions.sql, verbatim but for the lines marked econ v2)
create or replace function public.chop_finish(p_session_token text, p_presses integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; l public.mg_live; u bigint[]; v_win integer; v_bad text; v_code text; v_ev jsonb; v_rep jsonb; x jsonb;
        v_hits integer; v_blows integer; v_end integer; tr record; v_key text; v_have integer; v_felled boolean := false;
        v_qty integer := 0; v_full integer := 0; pr public.chop_profile; v_dur integer; v_axe text; v_power integer;
        v_regular boolean := true; v_xp integer := 0;
begin
  v_acc := public._ac_account(p_session_token);
  l := public._mg_close(v_acc, 'chop', 'chop', p_presses, null);
  if l.account_id is null then raise exception 'round not found' using errcode = '22023'; end if;
  if l.opened_at < now() - interval '60 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired');
  end if;
  u := l.params;
  v_win := (l.meta->>'win')::int;
  v_key := l.meta->>'tree';
  v_axe := l.meta->>'axe';
  v_power := (l.meta->>'power')::int;
  v_end := u[3]::int + 45;
  v_ev := jsonb_build_object('tree', v_key, 'presses', to_jsonb(l.a[1:8]));
  v_bad := l.meta->>'err';
  if v_bad is null and coalesce(cardinality(l.a), 0) > 6 then v_bad := 'too_many'; end if;
  if v_bad is null and l.started_at is null then
    return jsonb_build_object('result', 'lost', 'why', 'not played');
  end if;
  v_rep := public._chop_hits(u, v_win, l.a);
  -- a hit claimed less than 0.1 s after its beat's reveal: nobody reacts that fast
  if v_bad is null then
    for x in select * from jsonb_array_elements(v_rep->'pairs') loop
      if l.seen[(x->>'beat')::int] is null
         or l.started_at + make_interval(secs => l.a[(x->>'press')::int] / 60.0) < l.seen[(x->>'beat')::int] + interval '100 milliseconds' then
        v_bad := 'early';
      end if;
      if abs((x->>'off')::int) > 1 then v_regular := false; end if;
    end loop;
  end if;
  if v_bad is not null then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'chop_bad_input', 'chop_finish', v_ev || jsonb_build_object('error', v_bad), null, 'invalid round');
  end if;
  if now() < l.started_at + make_interval(secs => 0.9 * v_end / 60.0) then
    return jsonb_build_object('result', 'lost', 'why', 'refused')
           || public._ac_flag(v_acc, 'chop_too_fast', 'chop_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, 'invalid round');
  end if;
  if public._mg_late(l) then
    perform public._ac_flag(v_acc, 'chop_late', 'chop_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    return jsonb_build_object('result', 'lost', 'why', 'late');
  end if;
  v_hits := (v_rep->>'hits')::int;
  if v_hits = 3 and v_regular then
    v_code := public._craft_timing(v_acc, 'chop_timing', 'chop_finish', v_ev || jsonb_build_object('replay', v_rep));
    if v_code is not null then
      return jsonb_build_object('result', 'lost', 'why', 'refused')
             || public._ac_flag(v_acc, v_code, 'chop_finish', v_ev, null, 'invalid round');
    end if;
  end if;

  v_blows := v_hits * v_power + (3 - v_hits)
           + case when v_hits < 3 and public._perk(v_acc, 'chop_miss_bonus') > 0 then 1 else 0 end;
  -- the axe wears (Giữ lưỡi rìu may keep the edge)
  if not (random() * 100 < least(50, public._perk(v_acc, 'axe_save_pct'))) then
    update public.prof_tools set durability = greatest(0, durability - 1) where account_id = v_acc and item = v_axe
    returning durability into v_dur;
  else
    select durability into v_dur from public.prof_tools where account_id = v_acc and item = v_axe;
  end if;

  select * into tr from public._forest_trees() t where t.id = l.meta->>'kind';
  perform pg_advisory_xact_lock(hashtext('tree:' || v_key));
  if exists (select 1 from public.forest_felled f where f.tree_key = v_key and f.respawn_at > now()) then
    return jsonb_build_object('result', 'lost', 'why', 'felled', 'hits', v_hits, 'durability', v_dur);
  end if;
  insert into public.chop_progress (account_id, tree_key, hits, at) values (v_acc, v_key, v_blows, now())
  on conflict (account_id, tree_key) do update
    set hits = case when public.chop_progress.at > now() - interval '30 minutes' then public.chop_progress.hits else 0 end
               + excluded.hits,
        at = now()
  returning hits into v_have;
  if v_have >= tr.need then
    v_felled := true;
    delete from public.chop_progress where tree_key = v_key;
    insert into public.forest_felled (tree_key, account_id, felled_at, respawn_at)
    values (v_key, v_acc, now(), now() + make_interval(mins => tr.respawn_min))
    on conflict (tree_key) do update set account_id = excluded.account_id, felled_at = excluded.felled_at, respawn_at = excluded.respawn_at;
    v_qty := tr.logs + case when random() * 100 < least(50, public._perk(v_acc, 'wood_extra_pct')) then 1 else 0 end;
    insert into public.chop_profile (account_id) values (v_acc) on conflict do nothing;
    select * into pr from public.chop_profile where account_id = v_acc for update;
    if pr.day is distinct from public._vn_today() then pr.day := public._vn_today(); pr.logs := 0; end if;
    v_qty := least(v_qty, greatest(0, 150 - pr.logs));                                                          -- econ v2: ≤ 150 logs a day
    v_full := greatest(0, least(v_qty, 30 - pr.logs));                                                          -- econ v2: 30 at full price (was 40)
    update public.chop_profile set day = pr.day, logs = pr.logs + v_qty where account_id = v_acc;
    insert into public.wood_bag (account_id, item, qty, half) values (v_acc, tr.log, v_full, v_qty - v_full)
    on conflict (account_id, item) do update set qty = public.wood_bag.qty + excluded.qty, half = public.wood_bag.half + excluded.half;
    v_xp := greatest(1, (2 * v_full + (v_qty - v_full)) * case when tr.rare then 2 else 1 end);
    perform public._game_event(v_acc, 'wood_chopped', v_qty, jsonb_build_object('tree', tr.id, 'log', tr.log, 'hits', v_hits));
    perform public._game_event(v_acc, 'xp_grant', v_xp, jsonb_build_object('source', 'wood'));
  end if;
  -- the day-old progress of anyone, in a bounded batch
  delete from public.chop_progress where (account_id, tree_key) in
    (select c.account_id, c.tree_key from public.chop_progress c where c.at < now() - interval '1 day' limit 100);
  return jsonb_build_object('result', case when v_felled then 'felled' else 'ok' end, 'hits', v_hits, 'blows', v_blows,
                            'have', case when v_felled then tr.need else v_have end, 'need', tr.need, 'kind', tr.id,
                            'log', case when v_felled then tr.log end, 'qty', v_qty, 'full', v_full, 'xp', v_xp,
                            'durability', v_dur, 'forest', public._forest_json(v_acc));
end $$;

-- wood_sell (0096_forest_professions.sql, verbatim but for the lines marked econ v2)
create or replace function public.wood_sell(p_session_token text, p_item text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; v_price integer; w public.wood_bag; v_full integer; v_half integer; v_pay integer; v_bal integer;
        v_gross integer;                                                                                        -- econ v2
begin
  v_acc := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'wood_sell', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  select t.price into v_price from public._forest_trees() t where t.log = p_item;
  if v_price is null then raise exception 'invalid item' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 999 then
    return public._ac_flag(v_acc, 'bad_qty', 'wood_sell', jsonb_build_object('item', left(p_item, 16), 'qty', p_qty), null, 'invalid quantity');
  end if;
  perform public._wallet_lock(v_acc);
  select * into w from public.wood_bag where account_id = v_acc and item = p_item for update;
  if not found or w.qty + w.half < p_qty then raise exception 'not enough' using errcode = '22023'; end if;
  v_full := least(w.qty, p_qty);
  v_half := p_qty - v_full;
  update public.wood_bag set qty = qty - v_full, half = half - v_half where account_id = v_acc and item = p_item;
  v_gross := (v_price * v_full + (v_price * v_half) / 2) * (100 + least(10, floor(public._perk(v_acc, 'wood_sell_pct'))::int)) / 100;   -- econ v2: the perk ≤ 10 % (was 20)
  v_pay := public._npc_sale(v_acc, v_gross);                                                                    -- econ v2: the thương lái (0100), after the half-price rule
  if v_pay > 0 then                                                                                             -- econ v2
    v_bal := public._pay(v_acc, v_pay, 'wood_sell', p_item || ' x' || p_qty || case when v_half > 0 then ' (' || v_half || ' nửa giá)' else '' end); -- econ v2
  else v_bal := (select coins from public.wallets where account_id = v_acc); end if;                            -- econ v2
  return jsonb_build_object('earned', v_pay, 'coins', v_bal, 'forest', public._forest_json(v_acc),              -- econ v2
                            'npc_cut', v_gross - v_pay, 'npc', public._npc_quota(v_acc));                       -- econ v2
end $$;

-- ---------- D. Hunting and trapping ----------
-- wild_start (0097_forest_complete.sql, verbatim but for the line marked econ v2)
create or replace function public.wild_start(p_session_token text, p_spawn bigint, p_action text, p_map text, p_x integer, p_y integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; pp public.player_pos; sp public.wild_spawns; s record; p public.wild_profile; g public.world_mg;
        v_ax double precision; v_ay double precision; v_seed bigint := floor(random() * 4294967296)::bigint; v_danger boolean;
        v_u bigint[];                                                                                      -- 0087
        v_w record; bw record;                                                                             -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  if p_action is null or p_action not in ('hunt', 'trap', 'photo') then
    raise exception 'bad action' using errcode = '22023';
  end if;
  perform public._vitals_guard(v_acc);
  v_ac := public._pos_claim(v_acc, p_map, p_x, p_y, 'wild_start', null, 'too far');
  if v_ac is not null then return v_ac; end if;
  select * into pp from public.player_pos where account_id = v_acc;
  -- 0097 { the forest in either game: the wild (3D, world px) or Rừng tràm (2D, a window of the world)
  select * into v_w from public._forest_xy(pp.map, pp.x, pp.y);
  if v_w.wx is null or not public._near_forest(v_w.wx, v_w.wy) then
    raise exception 'not in forest' using errcode = '22023';
  end if;
  -- 0097 }
  g := public._wg_row(v_acc);
  if g.stun_until > now() then raise exception 'stunned' using errcode = '53400'; end if;
  select * into sp from public.wild_spawns where id = p_spawn for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    raise exception 'gone' using errcode = '22023';
  end if;
  select * into s from public._wild_species() ws where ws.id = sp.species;
  select q.x, q.y into v_ax, v_ay from public._wild_xy(sp.hx, sp.hy, sp.seed, s.radius, extract(epoch from now() - sp.born_at)) q;
  if sp.map is distinct from 'wild'                                                                   -- 0097: world px
     or sqrt((v_w.wx - v_ax) ^ 2 + (v_w.wy - v_ay) ^ 2) > (case when p_action = 'photo' then 140 else 64 end) then   -- 0097
    raise exception 'too far' using errcode = '22023';
  end if;
  insert into public.wild_profile (account_id) values (v_acc) on conflict do nothing;
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;
  if p_action = 'photo' then
    if p.last_at > now() - interval '2 seconds' then raise exception 'cooldown' using errcode = '53400'; end if;
    if exists (select 1 from public.wild_photos where account_id = v_acc and spawn_id = sp.id) then
      raise exception 'already photographed' using errcode = '22023';
    end if;
  else
    if (p_action = 'hunt' and s.hunt = 0) or (p_action = 'trap' and s.trap = 0) then
      raise exception 'cannot' using errcode = '22023';
    end if;
    if (p_action = 'hunt' and p.last_at > now() - interval '4 seconds')
       or (p_action = 'trap' and p.trap_at > now() - interval '20 seconds') then
      raise exception 'cooldown' using errcode = '53400';
    end if;
    if p.kills >= 40 then raise exception 'daily cap' using errcode = '53400'; end if;                          -- econ v2: 40 a day (was 60)
  end if;
  -- 0097 { a hunt needs a bow that still shoots (1 durability a hunt)
  if p_action = 'hunt' then
    select t.item, t.durability into bw from public.prof_tools t
      join public._prof_tools_catalog() c on c.id = t.item and c.kind = 'bow'
     where t.account_id = v_acc and t.durability > 0 order by t.durability desc limit 1;
    if not found then raise exception 'no bow' using errcode = '22023'; end if;
    update public.prof_tools set durability = durability - 1 where account_id = v_acc and item = bw.item;
  end if;
  -- 0097 }
  perform public._stamina_spend(v_acc, case when p_action = 'photo' then 0.5 else 1 end,
                                case when p_action = 'photo' then null else 'hunt' end);   -- 0096: the hunt_stamina_pct perk
  update public.wild_profile
     set last_at = case when p_action in ('hunt', 'photo') then now() else last_at end,
         trap_at = case when p_action = 'trap' then now() else trap_at end,
         day = p.day, kills = p.kills
   where account_id = v_acc;
  v_danger := p_action = 'hunt' and s.danger > 0 and public._world_night();
  insert into public.world_mg as w (account_id, kind, ref, target, species, danger, seed, started_at, open, last_start)
  values (v_acc, p_action, sp.id, 0, sp.species, v_danger, v_seed, now(), true, now())
  on conflict (account_id) do update
    set kind = excluded.kind, ref = excluded.ref, target = 0, species = excluded.species, danger = excluded.danger,
        seed = excluded.seed, started_at = excluded.started_at, open = true, last_start = excluded.last_start;
  -- 0087 { the round stays on the server: the hunt's aim sweep is all the client sees before the animal shows
  v_u := public._mg_u(case p_action when 'hunt' then 5 when 'trap' then 16 else 4 end);
  perform public._mg_open(v_acc, 'world', p_action, v_u, case when p_action = 'trap' then 0 else 30 + floor(random() * 31)::int end,
                          jsonb_build_object('species', sp.species, 'danger', v_danger));
  return jsonb_build_object('round', jsonb_build_object('game', p_action, 'spawn', sp.id, 'species', sp.species,
                                                        'danger', v_danger, 'live', 'world',
                                                        'reticle', case when p_action = 'hunt' then 100 + v_u[4] % 41 end,
                                                        'started_at', now()));
  -- 0087 }
end $$;

-- wild_finish (0097_forest_complete.sql, verbatim but for the line marked econ v2)
create or replace function public.wild_finish(p_session_token text, p_a integer[], p_b integer[], p_ticks integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; g public.world_mg; sp public.wild_spawns; s record; p public.wild_profile; v_bad text; v_rep jsonb;
        v_code text; v_ev jsonb; v_ac jsonb; v_out text; v_rt integer; v_score integer := 0; v_chance integer := 0;
        v_ok boolean := false; v_qty integer := 0; v_knock boolean := false; v_faint boolean := false; v_saved boolean := false;
        v_xp integer := 0; v_gave_up boolean := false; v_n integer := coalesce(cardinality(p_a), 0);
        l public.mg_live;                                                                                  -- 0087
        pp public.player_pos; v_lv integer; v_extra integer := 0;                                          -- 0096
        v_w record; v_jm text := 'wild';                                                                   -- 0097
begin
  v_acc := public._ac_account(p_session_token);
  select * into g from public.world_mg where account_id = v_acc for update;
  if not found or not g.open or g.kind not in ('hunt', 'trap', 'photo') then
    raise exception 'round not found' using errcode = '22023';
  end if;
  update public.world_mg set open = false where account_id = v_acc;
  l := public._mg_close(v_acc, 'world', g.kind, p_a, p_b);                                                -- 0087
  if now() > g.started_at + interval '60 seconds' then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 { a round opened before 0087 has no live row: nothing is replayed, nothing flagged
  if l.account_id is null then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 }
  v_ev := jsonb_build_object('game', g.kind, 'species', g.species, 'ticks', p_ticks, 'a', to_jsonb(p_a[1:6]), 'b', to_jsonb(p_b[1:6]));
  v_bad := public._wg_input_error(g.kind, p_a, p_b, p_ticks);
  -- 0087 { the live list, and no shot / snap before the animal showed
  v_bad := coalesce(v_bad, l.meta->>'err',
                    case when g.kind in ('hunt', 'photo') and public._mg_early(l.started_at, p_a, l.seen[1]) then 'early' end);
  -- 0087 }
  if v_bad is not null then
    v_code := 'wild_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := case g.kind when 'hunt' then public._wg_hunt_u(l.params, g.species, g.danger, p_a, p_b)          -- 0087
                         when 'trap' then public._wg_trap_u(l.params, g.species, p_a)                        -- 0087
                         else public._wg_photo_u(l.params, g.species, p_a, p_b) end;                         -- 0087
    v_out := v_rep->>'outcome';
    v_rt := (v_rep->>'ticks')::int;
    if v_out = 'open' or p_ticks < v_rt then
      v_gave_up := g.kind <> 'photo';
      if g.kind = 'photo' then v_score := coalesce((v_rep->>'score')::int, 0); end if;
    elsif p_ticks <> v_rt or (v_rep->>'used')::int <> v_n then
      v_code := 'wild_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    else
      v_score := (v_rep->>'score')::int;
    end if;
    if v_code is null and now() < g.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'wild_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', g.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
  -- 0087 { inputs not played live: the round is void (soft)
  if v_code is null and public._mg_late(l) then
    perform public._ac_flag(v_acc, 'wild_late', 'wild_finish', v_ev || jsonb_build_object('started_at', l.started_at), null, null, false);
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    return jsonb_build_object('result', 'lost', 'why', 'late', 'knocked', v_knock, 'fainted', v_faint);
  end if;
  -- 0087 }
  if v_code is not null then
    if g.danger then v_faint := public._wg_charge(v_acc, g.species); v_knock := true; end if;
    v_ac := public._ac_flag(v_acc, v_code, 'wild_finish', v_ev, null, 'invalid round');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'knocked', v_knock, 'fainted', v_faint) || v_ac;
  end if;
  if g.kind = 'hunt' and v_out = 'hit' and v_score >= 992 and not v_gave_up then
    perform public._ac_flag(v_acc, 'wild_timing', 'wild_finish', v_ev || jsonb_build_object('replay', v_rep), null, null, false);
  end if;

  select * into s from public._wild_species() ws where ws.id = g.species;
  -- the charge of a wolf / bear: taken unless the hunt hit first or the dodge was on time
  if g.danger and not (not v_gave_up and v_out = 'hit') and not (not v_gave_up and coalesce((v_rep->>'dodged')::boolean, false)) then
    v_knock := true;
    v_faint := public._wg_charge(v_acc, g.species);
  end if;

  select * into sp from public.wild_spawns where id = g.ref for update;
  if not found or sp.taken_at is not null or sp.expires_at <= now() then
    return jsonb_build_object('result', 'lost', 'why', 'gone', 'outcome', v_out, 'score', v_score, 'knocked', v_knock,
                              'fainted', v_faint, 'wild', public._wild_json(v_acc, coalesce(sp.map, 'field')));
  end if;
  -- 0096 { still at the forest (a round lasts ≤ 60 s from a start that checked it)
  select * into pp from public.player_pos where account_id = v_acc;
  select * into v_w from public._forest_xy(pp.map, pp.x, pp.y);                                        -- 0097 {
  if pp.map = 'rung_tram' then v_jm := 'rung_tram'; end if;
  if v_w.wx is null or not public._near_forest(v_w.wx, v_w.wy) then                                     -- 0097 }
    return jsonb_build_object('result', 'lost', 'why', 'not in forest', 'outcome', v_out, 'score', v_score, 'knocked', v_knock,
                              'fainted', v_faint, 'wild', public._wild_json(v_acc, v_jm));                  -- 0097: v_jm
  end if;
  -- 0096 }
  select * into p from public.wild_profile where account_id = v_acc for update;
  if p.day is distinct from public._vn_today() then p.day := public._vn_today(); p.kills := 0; end if;

  if g.kind = 'photo' then
    if v_score >= 250 then
      insert into public.wild_photos (account_id, spawn_id, species) values (v_acc, sp.id, sp.species) on conflict do nothing;
      v_saved := found;
    end if;
    if v_saved then
      v_xp := greatest(1, case when v_score >= 700 then s.xp / 2 else s.xp / 4 end);
      perform public._game_event(v_acc, 'wild_photo', 1, jsonb_build_object('species', sp.species, 'score', v_score));
      perform public._game_event(v_acc, 'xp_grant', v_xp, jsonb_build_object('source', 'wild'));
    end if;
    return jsonb_build_object('result', case when v_saved then 'ok' else 'fail' end, 'action', 'photo', 'species', sp.species,
                              'score', v_score, 'saved', v_saved, 'xp', v_xp, 'outcome', v_out,
                              'wild', public._wild_json(v_acc, v_jm));                             -- 0097: v_jm
  end if;

  v_chance := public._wg_chance(case when g.kind = 'hunt' then s.hunt else s.trap end, v_score,
                                not v_gave_up and v_out in ('hit', 'caught'));
  -- 0096 { Thợ săn (main nghề): + (5 + level) points; the skills' points (+ the night skill after dark); ≤ 95. A miss stays 0.
  v_lv := public._prof_main_level(v_acc, 'tho_san');
  if v_chance > 0 then
    v_chance := least(95, v_chance + case when v_lv >= 0 then 5 + v_lv else 0 end
                                   + floor(public._perk(v_acc, 'hunt_chance_pct'))::int
                                   + case when public._world_night() then floor(public._perk(v_acc, 'hunt_night_pct'))::int else 0 end
                                   + floor(public._buff(v_acc, 'hunt_chance'))::int);                -- 0097: a dish's buff
  end if;
  -- 0096 }
  v_ok := p.kills < 40 and random() * 100 < v_chance;                                                           -- econ v2: 40 a day (was 60)
  if v_ok then
    update public.wild_spawns set taken_by = v_acc, taken_at = now() where id = sp.id;
    v_qty := s.drop_min + floor(random() * (s.drop_max - s.drop_min + 1))::int;
    -- 0096 { Thợ săn: one more drop (10 / 15 / 20 / 25 % by level, + the skill); one more from a wolf or a bear (skill)
    if v_lv >= 0 and random() * 100 < (case when v_lv <= 5 then 10 when v_lv <= 10 then 15 when v_lv <= 15 then 20 else 25 end)
                                        + public._perk(v_acc, 'hunt_drop_pct') then
      v_extra := v_extra + 1;
    end if;
    if sp.species in ('wolf', 'bear') and public._perk(v_acc, 'hunt_big') > 0 then v_extra := v_extra + 1; end if;
    v_qty := v_qty + v_extra;
    -- 0096 }
    insert into public.wild_bag (account_id, item, qty) values (v_acc, s.drop_item, v_qty)
    on conflict (account_id, item) do update set qty = public.wild_bag.qty + excluded.qty;
    p.kills := p.kills + 1;
    v_xp := s.xp;
    perform public._game_event(v_acc, case when g.kind = 'hunt' then 'wild_hunt' else 'wild_trap' end, v_qty,
                               jsonb_build_object('species', sp.species, 'item', s.drop_item, 'score', v_score));
    perform public._game_event(v_acc, 'xp_grant', s.xp, jsonb_build_object('source', 'wild'));
  elsif g.kind = 'hunt' and random() < 0.5 then
    update public.wild_spawns set expires_at = now() where id = sp.id;     -- it bolts
  end if;
  update public.wild_profile set day = p.day, kills = p.kills where account_id = v_acc;
  return jsonb_build_object('result', case when v_ok then 'ok' else 'fail' end, 'action', g.kind, 'species', sp.species,
                            'outcome', case when v_gave_up then 'gave_up' else v_out end, 'score', v_score, 'chance', v_chance,
                            'item', case when v_ok then s.drop_item end, 'qty', v_qty, 'extra', v_extra, 'xp', v_xp,   -- 0096: extra
                            'knocked', v_knock, 'fainted', v_faint, 'wild', public._wild_json(v_acc, v_jm));   -- 0097: v_jm
end $$;

-- wild_sell (0075_world_bosses.sql, verbatim but for the lines marked econ v2)
create or replace function public.wild_sell(p_session_token text, p_item text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid; v_ac jsonb; v_price integer; v_have integer; v_pay integer; v_bal integer;
        v_gross integer;                                                                                        -- econ v2
begin
  v_acc := public._ac_account(p_session_token);
  v_ac := public._pos_claim(v_acc, 'bai_dat', 460, 56, 'wild_sell', null, 'not at stall');
  if v_ac is not null then return v_ac; end if;
  select price into v_price from public._wild_items() where id = p_item;
  if v_price is null then raise exception 'invalid item' using errcode = '22023'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 999 then
    return public._ac_flag(v_acc, 'bad_qty', 'wild_sell', jsonb_build_object('item', left(p_item, 16), 'qty', p_qty), null, 'invalid quantity');
  end if;
  select qty into v_have from public.wild_bag where account_id = v_acc and item = p_item for update;
  if coalesce(v_have, 0) < p_qty then raise exception 'not enough' using errcode = '22023'; end if;
  perform public._wallet_lock(v_acc);
  update public.wild_bag set qty = qty - p_qty where account_id = v_acc and item = p_item;
  v_gross := case when public._world_night() then (v_price * p_qty * 11) / 10 else v_price * p_qty end;         -- econ v2: the night market +10 % (was 13 / 10)
  v_pay := public._npc_sale(v_acc, v_gross);                                                                    -- econ v2: the thương lái (0100)
  if v_pay > 0 then                                                                                             -- econ v2
    v_bal := public._pay(v_acc, v_pay, 'wild_sell', p_item || ' x' || p_qty || case when public._world_night() then ' (chợ đêm)' else '' end); -- econ v2
  else v_bal := (select coins from public.wallets where account_id = v_acc); end if;                            -- econ v2
  return jsonb_build_object('earned', v_pay, 'coins', v_bal, 'wild', public._wild_json(v_acc, 'bai_dat'),       -- econ v2
                            'npc_cut', v_gross - v_pay, 'npc', public._npc_quota(v_acc));                       -- econ v2
end $$;

-- ---------- E. Crafting: upgrades, item_crafted, potion fees ----------
-- Potion fees (lib/game/mining/catalog.ts RECIPES mirrors them): spec §8 S3, and pot_miner by what its buff earns.
update public.potion_recipes p set fee = v.fee                                                                -- econ v2
  from (values ('pot_hunger', 60), ('pot_thirst', 25), ('pot_canh', 120), ('pot_miner', 300), ('pot_luck', 150),
               ('pot_luck2', 600)) v(id, fee)
 where p.id = v.id and p.fee is distinct from v.fee;

-- _upgrade_coins (0072_mining_crafting.sql, verbatim but for the line marked econ v2)
create or replace function public._upgrade_coins(p_price integer, p_level integer) returns integer
language sql immutable parallel safe
as $$ select greatest(200 * (p_level + 1), (coalesce(p_price, 0) * (p_level + 1)) / 4) $$;   -- econ v2: the floor (was 50)

-- upgrade_finish (0087_v22_fixes.sql, verbatim but for the line marked econ v2)
create or replace function public.upgrade_finish(p_session_token text, p_strikes integer[], p_ticks integer, p_score integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('anvil');
        c public.craft_rounds; v_plan jsonb; v_item text; v_kind text; v_base integer; v_level integer; v_cost integer;
        e record; v_ok boolean; v_rep jsonb; v_code text; v_ev jsonb; v_bad text; v_nudge integer; v_chance integer;
        v_n integer := coalesce(cardinality(p_strikes), 0);
        l public.mg_live; v_machine boolean;                                                               -- 0087
begin
  -- 0087 { the start's lock order: the position, the wallet, then the round
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'upgrade_finish', null, 'not at the anvil');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_account);
  c := public._craft_take(v_account, 'anvil');
  l := public._mg_close(v_account, 'anvil', 'anvil', p_strikes, null);
  -- 0087 }
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._mine_state(null, v_account));
  end if;
  if l.account_id is null then                                                                             -- 0087
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'state', public._mine_state(null, v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'ticks', p_ticks, 'strikes', to_jsonb(p_strikes[1:5]));
  v_bad := coalesce(public._toggles_error(p_strikes, p_ticks, 1800, 5, 2), case when p_score is null then 'score' end,
                    l.meta->>'err',                                                                        -- 0087
                    case when public._mg_early(l.started_at, p_strikes, l.seen[1]) then 'early' end);      -- 0087
  if v_bad is not null then
    v_code := 'anvil_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._anvil_replay_p(l.params::integer[], p_strikes);                                       -- 0087
    if (v_rep->>'score')::int <> p_score or (v_rep->>'ticks')::int <> p_ticks then
      v_code := 'anvil_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    elsif now() < c.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'anvil_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'anvil_late', 'upgrade_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              null, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late', 'state', public._mine_state(null, v_account));
    -- 0087 }
    else
      -- 0087: five strikes on the peak, or on one steady offset from it (±1 tick), are a metronome
      v_machine := v_n = 5 and ((v_rep->>'exact')::int = 5 or (v_rep->>'spread')::int <= 2);
      perform public._ac_stat(v_account, 'anvil', 1, case when p_score = 10 then 1 else 0 end,
                              case when v_machine then 1 else 0 end);                                     -- 0087
      if v_machine then                                                                                    -- 0087
        v_code := public._craft_timing(v_account, 'anvil_timing', 'upgrade_finish', v_ev || jsonb_build_object('replay', v_rep));
      end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'upgrade_finish', v_ev, null, 'invalid upgrade');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'state', public._mine_state(null, v_account)) || v_ac;
  end if;
  -- 0078's upgrade_item from here
  v_item := c.meta->>'item';
  perform public._wallet_lock(v_account);
  v_plan := public._upgrade_plan(v_account, v_item);
  v_kind := v_plan->>'kind';
  v_base := (v_plan->>'base')::int;
  v_level := (v_plan->>'level')::int;
  v_cost := (v_plan->>'cost')::int;
  perform public._stamina_spend(v_account, 3);
  for e in select key, value::int as q from jsonb_each_text(v_plan->'mats') loop
    if not public._bag_take(v_account, e.key, e.q) then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  perform public._pay(v_account, -v_cost, 'upgrade', v_item || ' +' || (v_level + 1));
  v_nudge := public._anvil_nudge(p_score);
  v_chance := least(1000, greatest(0, public._upgrade_chance(v_level) + v_nudge));
  v_ok := floor(random() * 1000) < v_chance;
  if v_ok then
    insert into public.item_upgrades (account_id, item_id, level) values (v_account, v_item, v_level + 1)
    on conflict (account_id, item_id) do update set level = excluded.level;
    if v_kind = 'pickaxe' then
      update public.mine_tools set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and tool_id = v_item;
    elsif v_base is not null then
      update public.inventory set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and item_id = v_item and durability is not null;
    end if;
    perform public._game_event(v_account, 'xp_grant', 5 * (v_level + 1), '{"source":"upgrade"}'::jsonb);
    perform public._game_event(v_account, 'item_crafted', 1, jsonb_build_object('source', 'upgrade', 'item', v_item)); -- econ v2
  end if;
  perform public._game_event(v_account, 'item_upgraded', case when v_ok then v_level + 1 else v_level end,
                             jsonb_build_object('item', v_item, 'ok', v_ok, 'from', v_level, 'score', p_score, 'nudge', v_nudge));
  return jsonb_build_object('result', 'done',
                            'upgrade', jsonb_build_object('item', v_item, 'ok', v_ok,
                                                          'level', case when v_ok then v_level + 1 else v_level end,
                                                          'cost', v_cost, 'chance', public._upgrade_chance(v_level),
                                                          'nudge', v_nudge, 'final', v_chance, 'score', p_score),
                            'state', public._mine_state(null, v_account));
end $$;

-- brew_finish (0087_v22_fixes.sql, verbatim but for the line marked econ v2)
create or replace function public.brew_finish(p_session_token text, p_toggles integer[], p_score integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('cauldron');
        c public.craft_rounds; r public.potion_recipes; it public.craft_items; w public.wallets; e record; v_need integer;
        v_fee integer; v_rows integer; v_qty integer; v_rep integer; v_code text; v_ev jsonb; v_bad text; v_q integer;
        v_regular boolean;
        l public.mg_live;                                                                                  -- 0087
begin
  -- 0087 { the start's lock order: the position, the wallet, then the round
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'brew_finish', null, 'not at the cauldron');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_account);
  c := public._craft_take(v_account, 'brew');
  l := public._mg_close(v_account, 'brew', 'brew', p_toggles, null);
  -- 0087 }
  if now() > c.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'state', public._mine_state(null, v_account));
  end if;
  if l.account_id is null then                                                                             -- 0087
    return jsonb_build_object('result', 'lost', 'why', 'outdated', 'state', public._mine_state(null, v_account));
  end if;
  v_ev := jsonb_build_object('score', p_score, 'n', coalesce(cardinality(p_toggles), 0), 'toggles', to_jsonb(p_toggles[1:40]));
  v_bad := coalesce(public._toggles_error(p_toggles, 600, 600, 120, 10), case when p_score is null then 'score' end,
                    l.meta->>'err');                                                                       -- 0087
  if v_bad is not null then
    v_code := 'brew_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  else
    v_rep := public._brew_replay_p(l.params::integer[], p_toggles);                                        -- 0087
    if v_rep <> p_score then
      v_code := 'brew_mismatch';
      v_ev := v_ev || jsonb_build_object('params', to_jsonb(l.params), 'replay', v_rep);                   -- 0087
    elsif now() < c.started_at + interval '9 seconds' then
      v_code := 'brew_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', c.started_at, 'claimed_at', now());
    -- 0087 { not played live: void (soft)
    elsif public._mg_late(l) then
      perform public._ac_flag(v_account, 'brew_late', 'brew_finish', v_ev || jsonb_build_object('started_at', l.started_at),
                              null, null, false);
      return jsonb_build_object('result', 'lost', 'why', 'late', 'state', public._mine_state(null, v_account));
    -- 0087 }
    else
      v_regular := public._craft_regular(p_toggles, 10);
      perform public._ac_stat(v_account, 'brew', 1, case when public._brew_quality(v_rep) = 3 then 1 else 0 end,
                              case when v_regular then 1 else 0 end);
      if v_regular then v_code := public._craft_timing(v_account, 'brew_timing', 'brew_finish', v_ev); end if;
    end if;
  end if;
  if v_code is not null then
    v_ac := public._ac_flag(v_account, v_code, 'brew_finish', v_ev, null, 'invalid brew');
    return jsonb_build_object('result', 'lost', 'why', 'refused', 'state', public._mine_state(null, v_account)) || v_ac;
  end if;
  -- 0078's brew_potion from here (the recipe and quantity of the start)
  select * into r from public.potion_recipes where id = c.meta->>'recipe';
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = r.id;
  v_qty := (c.meta->>'qty')::int;
  w := public._wallet_lock(v_account);
  v_fee := r.fee * v_qty;
  if w.coins < v_fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * v_qty;
    if e.key = 'fish' then
      if (select count(*) from public.fish where account_id = v_account) < v_need then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    elsif coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < v_need then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  perform public._stamina_spend(v_account, 2);
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * v_qty;
    if e.key = 'fish' then
      delete from public.fish where id in (select id from public.fish where account_id = v_account
                                            order by price, caught_at limit v_need);
      get diagnostics v_rows = row_count;
      if v_rows < v_need then raise exception 'not enough items' using errcode = '22023'; end if;
    else
      if not public._bag_take(v_account, e.key, v_need) then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    end if;
  end loop;
  if v_fee > 0 then perform public._pay(v_account, -v_fee, 'potion', r.id || ' x' || v_qty); end if;
  perform public._bag_add(v_account, r.id, v_qty);
  v_q := public._brew_quality(v_rep);
  if v_q >= 2 then
    insert into public.potion_quality (account_id, item_id, tier, qty) values (v_account, r.id, v_q, v_qty)
    on conflict (account_id, item_id, tier) do update set qty = public.potion_quality.qty + excluded.qty;
  end if;
  perform public._game_event(v_account, 'potion_brewed', v_qty,
                             jsonb_build_object('potion', r.id, 'rarity', it.rarity, 'quality', v_q, 'score', v_rep));
  perform public._game_event(v_account, 'xp_grant', 3 * it.rarity * v_qty, '{"source":"alchemy"}'::jsonb);
  perform public._game_event(v_account, 'item_crafted', 1, jsonb_build_object('source', 'brew', 'item', r.id)); -- econ v2
  return jsonb_build_object('result', 'brewed',
                            'brewed', jsonb_build_object('potion', r.id, 'qty', v_qty, 'quality', v_q, 'score', v_rep,
                                                         'bonus', public._brew_bonus(v_q)),
                            'state', public._mine_state(null, v_account));
end $$;

-- ---------- F. Professions: switch 2 000, reset 1 000 ----------
-- profession_choose (0096_forest_professions.sql, verbatim but for the lines marked econ v2)
create or replace function public.profession_choose(p_session_token text, p_prof text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); m public.player_profession_main; v_coins int;
begin
  if not exists (select 1 from public.profession_catalog where id = p_prof) then
    raise exception 'unknown profession' using errcode = '22023';
  end if;
  perform public._wallet_lock(v_account);
  select * into m from public.player_profession_main where account_id = v_account for update;
  if found then
    if m.prof = p_prof then raise exception 'same profession' using errcode = '22023'; end if;
    if m.chosen_at > now() - interval '24 hours' then raise exception 'switch cooldown' using errcode = '53400'; end if;
    select coins into v_coins from public.wallets where account_id = v_account;
    if coalesce(v_coins, 0) < 2000 then raise exception 'insufficient funds' using errcode = '22023'; end if;   -- econ v2: was 500
    perform public._pay(v_account, -2000, 'profession', 'profession: ' || m.prof || ' -> ' || p_prof);          -- econ v2
    update public.player_profession_main set prof = p_prof, chosen_at = now() where account_id = v_account;
  else
    insert into public.player_profession_main (account_id, prof) values (v_account, p_prof);
  end if;
  perform public._prof_grant_starter(v_account, p_prof);                              -- 0096: the starter tool, once
  return public._prof_json(v_account);
end $$;

-- skill_reset (0077_professions.sql, verbatim but for the lines marked econ v2)
create or replace function public.skill_reset(p_session_token text, p_prof text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_coins int;
begin
  perform public._wallet_lock(v_account);
  if not exists (select 1 from public.player_skills s join public.skill_nodes n on n.id = s.node
                  where s.account_id = v_account and n.prof = p_prof) then
    raise exception 'nothing to reset' using errcode = '22023';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < 1000 then raise exception 'insufficient funds' using errcode = '22023'; end if;     -- econ v2: was 300
  perform public._pay(v_account, -1000, 'skill_reset', 'skill_reset: ' || p_prof);                              -- econ v2
  delete from public.player_skills s using public.skill_nodes n
   where n.id = s.node and s.account_id = v_account and n.prof = p_prof;
  return public._prof_json(v_account);
end $$;

-- _prof_json (0096_forest_professions.sql, verbatim but for the line marked econ v2)
create or replace function public._prof_json(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.player_profession_main;
begin
  select * into m from public.player_profession_main where account_id = p_account;
  return jsonb_build_object(
    'main', m.prof,
    'switch_at_ms', case when m.prof is not null then (extract(epoch from m.chosen_at + interval '24 hours') * 1000)::bigint end,
    'switch_fee', 2000, 'reset_fee', 1000,                                                                      -- econ v2: the panel's fees (was 500 / 300)
    'profs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'xp', coalesce(p.xp, 0), 'level', public._prof_level(p.xp),
        'spent', coalesce((select sum(n.cost) from public.player_skills s join public.skill_nodes n on n.id = s.node
                            where s.account_id = p_account and n.prof = c.id), 0)) order by c.sort_order)
        from public.profession_catalog c
        left join public.player_professions p on p.account_id = p_account and p.prof = c.id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(node order by node) from public.player_skills where account_id = p_account), '[]'::jsonb),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('item', t.item, 'durability', t.durability, 'max', t.max_durability)  -- 0096
                                        order by t.item) from public.prof_tools t where t.account_id = p_account), '[]'::jsonb),  -- 0096
    'buffs', coalesce((select jsonb_agg(jsonb_build_object('key', b.kind, 'value', b.power,
                                                           'until_ms', (extract(epoch from b.until) * 1000)::bigint) order by b.kind)
        from public.player_buffs b where b.account_id = p_account and b.until > now()), '[]'::jsonb),
    'stamina', public._stamina_json(p_account),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint);
end $$;
