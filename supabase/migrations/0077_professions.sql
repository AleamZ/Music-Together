-- =========================================================
-- 0077_professions.sql — v21 "professions" group (#46/#47 nghề nghiệp, #49 cây kỹ năng, #24 thể lực, #25 nghỉ ngơi hồi
-- thể lực, #23 buff đồ ăn). ADDITIVE and re-runnable. Run after 0069 (game_events, the v21 ledger reasons).
--
--   A. Catalog (lib/game/professions/catalog.ts mirrors it; tests/unit/professions.test.ts pins the rows equal):
--      profession_catalog (8 nghề: ngu_dan, nong_dan, tho_mo, dau_bep, thuong_nhan, tho_ren, tho_moc, vo_si),
--      profession_xp_rules (game_events kind [+ meta.reason] → nghề, xp), skill_nodes (6 nodes a nghề: perk key, value,
--      cost in points, prerequisite), meal_buffs (meal → timed buff).
--      Kiếm sĩ / Pháp sư / Cung thủ are NOT built: the game has no swords, magic or bows (the fights are unarmed martial
--      styles, which Võ sĩ covers).
--   B. Player tables: player_professions (xp per nghề, the day's xp), player_profession_main (the main nghề), player_skills,
--      player_stamina, perk_payouts (the day's perk coins), and the SHARED player_buffs — 0072 (crafting, potions)
--      created it first as (account_id, kind, power integer, until; pk account_id + kind): the same `create table if not
--      exists` here, then 0072's kind check is widened (dropped and re-added) with the food kinds speed, rare_fish,
--      strength, stamina_regen (percentages). 0072's 'luck' / 'miner' keep 0072's meaning (its casts_luck trigger).
--   C. Helpers other migrations may call (all internal, revoked from clients):
--        public._perk(account uuid, key text) returns numeric   — the sum of the key over the skills learned in the
--            account's MAIN nghề (0 without one). Keys: see skill_nodes.perk.
--        public._buff(account uuid, key text) returns numeric   — the active buff's power (player_buffs.kind = key),
--            capped per key (speed 10, rare_fish 30, strength 50, stamina_regen 100; others 100).
--        public._buff_grant(account uuid, key text, value numeric, minutes integer) — merge a timed buff (the larger power,
--            the later end; the same upsert as 0072's drink_potion).
--        public._stamina_spend(account uuid, amount numeric, kind text default null) returns numeric — spend stamina
--            (after regen), raising 'too tired' (53400) when short; kind ∈ fish|mine|chop|fight|run applies the
--            '<kind>_stamina_pct' perk (and the 'strength' buff for mine/chop/fight). Returns what is left.
--        public._stamina_drain(account, amount, kind default null) — the same, but never raises (clamps at 0).
--        public._stamina_settle(account) — the regenerated row, locked.
--      Stamina: max 100 + perk stamina_max (≤ 60); regen 100 per 10 min × (1 + perk/buff stamina_regen %) × 1.5 while
--      "Ngủ ngon" (0039) × 3 while resting (the hammock, stamina_tick). motel_sleep refills it (trigger on rest_state).
--   D. Where perks and stamina are applied SERVER-SIDE (triggers — no gameplay RPC re-created but one):
--        * casts BEFORE INSERT (every start_cast): costs 3 stamina ('fish'); with perk rare_fish_pct + buff rare_fish
--          (≤ 40 %; after 0072's casts_luck, which fires first by name) the rolled fish becomes a random species one rarity higher (weight at the same place in its range;
--          the reel's params are untouched).
--        * net_throws BEFORE INSERT (start_net): 5 stamina ('fish').
--        * mine_digs BEFORE INSERT (0072's mine_start, when that table exists): 4 stamina ('mine').
--          (0072's mine_finish also calls _fishing_effort, so fish_effort_pct lowers a dig's hunger too.)
--          No chopping action exists yet: 'chop' and the 'wood_chopped' event are ready for one.
--        * fight_matches AFTER INSERT: 8 stamina ('fight') from each human side, soft (never blocks a match).
--        * coin_ledger AFTER INSERT (every _pay): perk bonuses on sales (fish 'sell' with a "… con" ref, rice/produce,
--          ore/gem, market/shop/auction) and rebates on purchases (farm_buy, mine_tool, meal, potion, buy, shop_rent,
--          market_list, upgrade, repair, furniture, house_build, dojo_tuition, dojo_exam) — paid with _pay under the same
--          reason and a 'perk: <key>' ref, capped 3 000 xu per account per Vietnam day; and food buffs for 'meal' /
--          'buff_food' purchases (ref 'meal: <id>' / 'buff_food: <id>').
--        * game_events AFTER INSERT: nghề xp (main nghề ×1.5, ≤ 2 000 xp per nghề per day); a level-up emits
--          'profession_level' (qty = the new level, meta.prof).
--        * anticheat_wipes AFTER INSERT: a wipe clears this migration's player rows.
--        * public._fishing_effort (0047's, the newest) re-created verbatim but for the lines marked 0077: the hunger and
--          thirst cost of a cast / net is lowered by perk fish_effort_pct (≤ 50 %).
--   E. RPCs: profession_state, profession_choose (first free; then 500 xu 'profession', 24 h cooldown), skill_learn,
--      skill_reset (300 xu 'skill_reset'), stamina_tick (the HUD's heartbeat: sprint seconds, hammock rest).
-- Events consumed: fish_catch, crop_harvest, ore_mined, gem_found, meal_cooked, food_cooked, potion_brewed, market_sold,
-- item_forged, tool_upgraded, item_upgraded, herb_gathered, crop_processed, treasure_found, wood_chopped,
-- furniture_crafted, fight_win, fight_done, earn/spend (by reason).
-- Events emitted: profession_level.
-- =========================================================

-- ---------- A. Catalog ----------
create table if not exists public.profession_catalog (
  id text primary key,
  name text not null,
  icon text not null,
  sort_order int not null
);
alter table public.profession_catalog enable row level security;
revoke all on public.profession_catalog from anon, authenticated;
insert into public.profession_catalog (id, name, icon, sort_order) values
  ('ngu_dan', 'Ngư dân', '🎣', 1),
  ('nong_dan', 'Nông dân', '🌾', 2),
  ('tho_mo', 'Thợ mỏ', '⛏️', 3),
  ('dau_bep', 'Đầu bếp', '🍳', 4),
  ('thuong_nhan', 'Thương nhân', '💰', 5),
  ('tho_ren', 'Thợ rèn', '⚒️', 6),
  ('tho_moc', 'Thợ mộc', '🪚', 7),
  ('vo_si', 'Võ sĩ', '🥋', 8)
on conflict (id) do update set name = excluded.name, icon = excluded.icon, sort_order = excluded.sort_order;

create table if not exists public.profession_xp_rules (
  kind text not null,
  reason text not null default '',     -- '' = any; for 'earn' / 'spend' the ledger reason (meta.reason)
  prof text not null references public.profession_catalog(id),
  xp int not null check (xp > 0),
  primary key (kind, reason, prof)
);
alter table public.profession_xp_rules enable row level security;
revoke all on public.profession_xp_rules from anon, authenticated;
insert into public.profession_xp_rules (kind, reason, prof, xp) values
  ('fish_catch', '', 'ngu_dan', 10),
  ('treasure_found', '', 'ngu_dan', 20),
  ('herb_gathered', '', 'nong_dan', 6),
  ('crop_processed', '', 'dau_bep', 8),
  ('item_upgraded', '', 'tho_ren', 12),
  ('crop_harvest', '', 'nong_dan', 10),
  ('earn', 'rice_sell', 'nong_dan', 8),
  ('earn', 'produce_sell', 'nong_dan', 8),
  ('earn', 'critter_sell', 'nong_dan', 4),
  ('ore_mined', '', 'tho_mo', 10),
  ('gem_found', '', 'tho_mo', 20),
  ('earn', 'ore_sell', 'tho_mo', 5),
  ('earn', 'gem_sell', 'tho_mo', 5),
  ('meal_cooked', '', 'dau_bep', 12),
  ('food_cooked', '', 'dau_bep', 12),
  ('potion_brewed', '', 'dau_bep', 10),
  ('spend', 'meal', 'dau_bep', 3),
  ('market_sold', '', 'thuong_nhan', 10),
  ('earn', 'market_sell', 'thuong_nhan', 6),
  ('earn', 'shop_sell', 'thuong_nhan', 6),
  ('earn', 'auction_sell', 'thuong_nhan', 8),
  ('earn', 'sell', 'thuong_nhan', 2),
  ('item_forged', '', 'tho_ren', 12),
  ('tool_upgraded', '', 'tho_ren', 15),
  ('spend', 'upgrade', 'tho_ren', 5),
  ('spend', 'repair', 'tho_ren', 5),
  ('spend', 'mine_tool', 'tho_ren', 4),
  ('wood_chopped', '', 'tho_moc', 8),
  ('furniture_crafted', '', 'tho_moc', 15),
  ('spend', 'furniture', 'tho_moc', 5),
  ('spend', 'house_build', 'tho_moc', 10),
  ('fight_win', '', 'vo_si', 15),
  ('fight_done', '', 'vo_si', 5),
  ('spend', 'dojo_tuition', 'vo_si', 10),
  ('spend', 'dojo_exam', 'vo_si', 10)
on conflict (kind, reason, prof) do update set xp = excluded.xp;

create table if not exists public.skill_nodes (
  id text primary key,
  prof text not null references public.profession_catalog(id),
  name text not null,
  perk text not null,
  value numeric not null,
  cost int not null check (cost between 1 and 5),
  req text references public.skill_nodes(id),
  sort_order int not null
);
alter table public.skill_nodes enable row level security;
revoke all on public.skill_nodes from anon, authenticated;
-- roots first (req references an earlier row)
insert into public.skill_nodes (id, prof, name, perk, value, cost, req, sort_order) values
  ('f_hand',  'ngu_dan', 'Tay quen',     'fish_effort_pct',   15, 1, null, 1),
  ('f_sell',  'ngu_dan', 'Mối quen',     'fish_sell_pct',      5, 1, null, 2),
  ('f_stam',  'ngu_dan', 'Dẻo dai',      'fish_stamina_pct',  25, 2, 'f_hand', 3),
  ('f_sell2', 'ngu_dan', 'Chợ cá',       'fish_sell_pct',      5, 2, 'f_sell', 4),
  ('f_eye',   'ngu_dan', 'Mắt tinh',     'rare_fish_pct',      4, 2, 'f_hand', 5),
  ('f_old',   'ngu_dan', 'Lão ngư',      'rare_fish_pct',      6, 3, 'f_eye', 6),
  ('a_sell',  'nong_dan', 'Hàng ngon',   'farm_sell_pct',      5, 1, null, 1),
  ('a_breath','nong_dan', 'Hít thở',     'stamina_regen_pct', 15, 1, null, 2),
  ('a_sell2', 'nong_dan', 'Được mùa',    'farm_sell_pct',      5, 2, 'a_sell', 3),
  ('a_seed',  'nong_dan', 'Giống rẻ',    'farm_buy_pct',      10, 2, 'a_sell', 4),
  ('a_body',  'nong_dan', 'Khỏe như trâu','stamina_max',      15, 2, 'a_breath', 5),
  ('a_sell3', 'nong_dan', 'Bội thu',     'farm_sell_pct',      5, 3, 'a_sell2', 6),
  ('m_arm',   'tho_mo', 'Tay búa',       'mine_stamina_pct',  20, 1, null, 1),
  ('m_sell',  'tho_mo', 'Biết quặng',    'ore_sell_pct',       5, 1, null, 2),
  ('m_sell2', 'tho_mo', 'Mối lái đá',    'ore_sell_pct',       5, 2, 'm_sell', 3),
  ('m_body',  'tho_mo', 'Lưng sắt',      'stamina_max',       20, 2, 'm_arm', 4),
  ('m_tool',  'tho_mo', 'Giữ đồ nghề',   'mine_tool_pct',     10, 2, 'm_arm', 5),
  ('m_gem',   'tho_mo', 'Mắt ngọc',      'ore_sell_pct',       5, 3, 'm_sell2', 6),
  ('c_long',  'dau_bep', 'Nấu kỹ',       'buff_time_pct',     25, 1, null, 1),
  ('c_cheap', 'dau_bep', 'Đi chợ khéo',  'meal_pct',          10, 1, null, 2),
  ('c_long2', 'dau_bep', 'Hầm lâu',      'buff_time_pct',     25, 2, 'c_long', 3),
  ('c_spice', 'dau_bep', 'Gia vị bí truyền','buff_power_pct', 20, 2, 'c_long', 4),
  ('c_cheap2','dau_bep', 'Khách quen',   'meal_pct',          10, 2, 'c_cheap', 5),
  ('c_brew',  'dau_bep', 'Pha chế',      'potion_pct',        10, 2, 'c_cheap', 6),
  ('t_sell',  'thuong_nhan', 'Mồm mép',  'market_sell_pct',    3, 1, null, 1),
  ('t_buy',   'thuong_nhan', 'Trả giá',  'buy_pct',            5, 1, null, 2),
  ('t_sell2', 'thuong_nhan', 'Buôn có bạn','market_sell_pct',  3, 2, 't_sell', 3),
  ('t_buy2',  'thuong_nhan', 'Mua sỉ',   'buy_pct',            5, 2, 't_buy', 4),
  ('t_fish',  'thuong_nhan', 'Buôn cá',  'fish_sell_pct',      3, 2, 't_sell', 5),
  ('t_rent',  'thuong_nhan', 'Chỗ quen', 'shop_rent_pct',     15, 3, 't_sell2', 6),
  ('s_up',    'tho_ren', 'Tay nghề',     'upgrade_pct',       10, 1, null, 1),
  ('s_fix',   'tho_ren', 'Sửa khéo',     'repair_pct',        20, 1, null, 2),
  ('s_up2',   'tho_ren', 'Lò rèn riêng', 'upgrade_pct',       10, 2, 's_up', 3),
  ('s_tool',  'tho_ren', 'Tự rèn cuốc',  'mine_tool_pct',     10, 2, 's_up', 4),
  ('s_fix2',  'tho_ren', 'Như mới',      'repair_pct',        20, 2, 's_fix', 5),
  ('s_body',  'tho_ren', 'Vai rộng',     'stamina_max',       15, 2, 's_up', 6),
  ('w_arm',   'tho_moc', 'Tay chai',     'stamina_regen_pct', 10, 1, null, 1),
  ('w_furn',  'tho_moc', 'Đồ gỗ',        'furniture_pct',     10, 1, null, 2),
  ('w_house', 'tho_moc', 'Dựng nhà',     'house_pct',          5, 2, 'w_furn', 3),
  ('w_furn2', 'tho_moc', 'Chạm trổ',     'furniture_pct',     10, 2, 'w_furn', 4),
  ('w_body',  'tho_moc', 'Gân guốc',     'stamina_max',       15, 2, 'w_arm', 5),
  ('w_rest',  'tho_moc', 'Nghỉ tay',     'stamina_regen_pct', 20, 2, 'w_arm', 6),
  ('v_wind',  'vo_si', 'Hơi dài',        'fight_stamina_pct', 25, 1, null, 1),
  ('v_dojo',  'vo_si', 'Môn sinh',       'dojo_pct',          10, 1, null, 2),
  ('v_body',  'vo_si', 'Thân thép',      'stamina_max',       20, 2, 'v_wind', 3),
  ('v_rest',  'vo_si', 'Điều tức',       'stamina_regen_pct', 25, 2, 'v_wind', 4),
  ('v_dojo2', 'vo_si', 'Đệ tử ruột',     'dojo_pct',          10, 2, 'v_dojo', 5),
  ('v_iron',  'vo_si', 'Mình đồng',      'fight_stamina_pct', 25, 3, 'v_wind', 6)
on conflict (id) do update set prof = excluded.prof, name = excluded.name, perk = excluded.perk, value = excluded.value,
  cost = excluded.cost, req = excluded.req, sort_order = excluded.sort_order;

create table if not exists public.meal_buffs (
  meal_id text not null,
  key text not null,
  value numeric not null check (value > 0),
  minutes int not null check (minutes between 1 and 240),
  primary key (meal_id, key)
);
alter table public.meal_buffs drop constraint if exists meal_buffs_key_check;
alter table public.meal_buffs add constraint meal_buffs_key_check check (key in ('speed','rare_fish','strength','stamina_regen')) not valid;
alter table public.meal_buffs enable row level security;
revoke all on public.meal_buffs from anon, authenticated;
insert into public.meal_buffs (meal_id, key, value, minutes) values
  ('com_tam', 'strength', 15, 30),
  ('pho_bo', 'stamina_regen', 50, 30),
  ('banh_mi', 'speed', 5, 15),
  ('bun_bo', 'strength', 20, 30),
  ('ca_kho_to', 'rare_fish', 10, 30),
  ('canh_chua', 'rare_fish', 15, 30),
  ('ca_chien', 'rare_fish', 12, 20),
  ('tra_da', 'stamina_regen', 20, 15),
  ('nuoc_mia', 'speed', 8, 15),
  ('cafe_sua', 'speed', 10, 20),
  ('cafe_sua', 'stamina_regen', 30, 20),
  ('nuoc_dua', 'stamina_regen', 40, 20),
  ('sinh_to', 'rare_fish', 5, 20)
on conflict (meal_id, key) do update set value = excluded.value, minutes = excluded.minutes;
delete from public.meal_buffs where key not in ('speed','rare_fish','strength','stamina_regen');

-- ---------- B. Player tables ----------
create table if not exists public.player_professions (
  account_id uuid not null references public.accounts(id) on delete cascade,
  prof text not null references public.profession_catalog(id),
  xp int not null default 0,
  day date,
  day_xp int not null default 0,
  primary key (account_id, prof)
);
create table if not exists public.player_profession_main (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  prof text not null references public.profession_catalog(id),
  chosen_at timestamptz not null default now()
);
create table if not exists public.player_skills (
  account_id uuid not null references public.accounts(id) on delete cascade,
  node text not null references public.skill_nodes(id),
  learned_at timestamptz not null default now(),
  primary key (account_id, node)
);
create table if not exists public.player_stamina (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  value numeric not null,
  at timestamptz not null default now(),
  rest_until timestamptz,
  tick_at timestamptz
);
create table if not exists public.perk_payouts (
  account_id uuid not null references public.accounts(id) on delete cascade,
  day date not null,
  paid int not null default 0,
  primary key (account_id, day)
);
-- SHARED with 0072 (crafting: potions), which created it first with this shape: the same statement here (a no-op after
-- 0072), then its kind check widened with this migration's food buffs. 0072's 'luck' (power 1 = +20 % rarity lift, its
-- casts_luck trigger) and 'miner' keep their meaning; the food keys are percentages.
create table if not exists public.player_buffs (
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null,
  power integer not null default 1,
  until timestamptz not null,
  primary key (account_id, kind)
);
alter table public.player_buffs drop constraint if exists player_buffs_kind_check;
alter table public.player_buffs add constraint player_buffs_kind_check
  check (kind in ('luck', 'miner', 'speed', 'rare_fish', 'strength', 'stamina_regen'));
alter table public.player_professions enable row level security;
alter table public.player_profession_main enable row level security;
alter table public.player_skills enable row level security;
alter table public.player_stamina enable row level security;
alter table public.perk_payouts enable row level security;
alter table public.player_buffs enable row level security;
revoke all on public.player_professions, public.player_profession_main, public.player_skills, public.player_stamina,
              public.perk_payouts, public.player_buffs from anon, authenticated;

-- ---------- C. Rules and helpers ----------
-- Level from xp: the level L needs 50·L·(L+1) xp in total (L1 100, L5 1 500, L10 5 500, L20 21 000); at most 20.
create or replace function public._prof_level(p_xp integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select least(20, floor((sqrt(1 + 4 * greatest(0, coalesce(p_xp, 0)) / 50.0) - 1) / 2)::int) $$;

create or replace function public._perk(p_account uuid, p_key text) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(sum(n.value), 0)
    from public.player_skills s
    join public.skill_nodes n on n.id = s.node
    join public.player_profession_main m on m.account_id = s.account_id and m.prof = n.prof
   where s.account_id = p_account and n.perk = p_key
$$;

create or replace function public._buff_cap(p_key text) returns numeric
language sql immutable set search_path = public, extensions
as $$ select case p_key when 'speed' then 10 when 'rare_fish' then 30 when 'strength' then 50
                        when 'stamina_regen' then 100 else 100 end $$;

create or replace function public._buff(p_account uuid, p_key text) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select least(public._buff_cap(p_key), coalesce(sum(power), 0))
    from public.player_buffs where account_id = p_account and kind = p_key and until > now()
$$;

create or replace function public._buff_grant(p_account uuid, p_key text, p_value numeric, p_minutes integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_until timestamptz := now() + make_interval(mins => greatest(1, least(480, p_minutes)));
begin
  if p_value is null or round(p_value) <= 0 then return; end if;
  insert into public.player_buffs (account_id, kind, power, until) values (p_account, p_key, round(p_value)::int, v_until)
  on conflict (account_id, kind) do update
    set power = case when public.player_buffs.until > now() then greatest(public.player_buffs.power, excluded.power)
                     else excluded.power end,
        until = greatest(public.player_buffs.until, excluded.until);
end $$;

-- The food buffs of a meal (or a 'buff_food' item): the chef's perks lengthen and strengthen them.
create or replace function public._food_buffs(p_account uuid, p_meal text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare b public.meal_buffs; v_time numeric := least(100, public._perk(p_account, 'buff_time_pct'));
        v_pow numeric := least(50, public._perk(p_account, 'buff_power_pct'));
begin
  for b in select * from public.meal_buffs where meal_id = p_meal loop
    perform public._buff_grant(p_account, b.key, round(b.value * (1 + v_pow / 100), 1),
                               round(b.minutes * (1 + v_time / 100))::int);
  end loop;
end $$;

-- Stamina
create or replace function public._stamina_max(p_account uuid) returns numeric
language sql stable security definer set search_path = public, extensions
as $$ select 100 + least(60, public._perk(p_account, 'stamina_max')) $$;

-- Per second: 100 per 10 min, × (1 + regen %), × 1.5 in "Ngủ ngon", × 3 while resting.
create or replace function public._stamina_rate(p_account uuid, p_resting boolean) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select (100.0 / 600)
       * (1 + least(150, public._perk(p_account, 'stamina_regen_pct') + public._buff(p_account, 'stamina_regen')) / 100)
       * (case when public._rest_factor(p_account) < 1 then 1.5 else 1 end)
       * (case when p_resting then 3 else 1 end)
$$;

create or replace function public._stamina_settle(p_account uuid) returns public.player_stamina
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.player_stamina; v_max numeric := public._stamina_max(p_account); v_dt numeric;
begin
  insert into public.player_stamina (account_id, value, at) values (p_account, v_max, now()) on conflict do nothing;
  select * into s from public.player_stamina where account_id = p_account for update;
  v_dt := greatest(0, least(86400, extract(epoch from (now() - s.at))));
  s.value := least(v_max, greatest(0, s.value) + v_dt * public._stamina_rate(p_account, coalesce(s.rest_until > now(), false)));
  s.at := now();
  update public.player_stamina set value = s.value, at = s.at where account_id = p_account;
  return s;
end $$;

create or replace function public._stamina_cost(p_account uuid, p_amount numeric, p_kind text) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select greatest(0, p_amount) * (1 - least(75,
           case when p_kind is null then 0 else public._perk(p_account, p_kind || '_stamina_pct') end
         + case when p_kind in ('mine', 'chop', 'fight') then public._buff(p_account, 'strength') else 0 end) / 100)
$$;

create or replace function public._stamina_spend(p_account uuid, p_amount numeric, p_kind text default null) returns numeric
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.player_stamina := public._stamina_settle(p_account);
        v_cost numeric := public._stamina_cost(p_account, p_amount, p_kind);
begin
  if s.value < v_cost then raise exception 'too tired' using errcode = '53400'; end if;
  update public.player_stamina set value = s.value - v_cost, rest_until = null where account_id = p_account;
  return s.value - v_cost;
end $$;

create or replace function public._stamina_drain(p_account uuid, p_amount numeric, p_kind text default null) returns numeric
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.player_stamina := public._stamina_settle(p_account);
        v_left numeric := greatest(0, s.value - public._stamina_cost(p_account, p_amount, p_kind));
begin
  update public.player_stamina set value = v_left where account_id = p_account;
  return v_left;
end $$;

create or replace function public._stamina_json(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.player_stamina := public._stamina_settle(p_account); v_rest boolean := coalesce(s.rest_until > now(), false);
begin
  return jsonb_build_object('value', round(s.value, 2), 'max', public._stamina_max(p_account),
    'rate_per_s', round(public._stamina_rate(p_account, v_rest), 4), 'resting', v_rest,
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint);
end $$;

-- The state the "Nghề nghiệp" panel shows.
create or replace function public._prof_json(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare m public.player_profession_main;
begin
  select * into m from public.player_profession_main where account_id = p_account;
  return jsonb_build_object(
    'main', m.prof,
    'switch_at_ms', case when m.prof is not null then (extract(epoch from m.chosen_at + interval '24 hours') * 1000)::bigint end,
    'switch_fee', 500, 'reset_fee', 300,
    'profs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'xp', coalesce(p.xp, 0), 'level', public._prof_level(p.xp),
        'spent', coalesce((select sum(n.cost) from public.player_skills s join public.skill_nodes n on n.id = s.node
                            where s.account_id = p_account and n.prof = c.id), 0)) order by c.sort_order)
        from public.profession_catalog c
        left join public.player_professions p on p.account_id = p_account and p.prof = c.id), '[]'::jsonb),
    'skills', coalesce((select jsonb_agg(node order by node) from public.player_skills where account_id = p_account), '[]'::jsonb),
    'buffs', coalesce((select jsonb_agg(jsonb_build_object('key', b.kind, 'value', b.power,
                                                           'until_ms', (extract(epoch from b.until) * 1000)::bigint) order by b.kind)
        from public.player_buffs b where b.account_id = p_account and b.until > now()), '[]'::jsonb),
    'stamina', public._stamina_json(p_account),
    'server_now_ms', (extract(epoch from now()) * 1000)::bigint);
end $$;

-- ---------- D. Triggers ----------
-- xp from the event feed
create or replace function public._prof_on_event() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare r record; v_main text; v_gain int; v_today date := public._vn_today(); p public.player_professions; v_old int;
begin
  if coalesce(current_setting('mt.perk_pay', true), '') = '1' then return new; end if;   -- a perk payment is no deed
  select prof into v_main from public.player_profession_main where account_id = new.account_id;
  for r in select x.prof, x.xp from public.profession_xp_rules x
            where x.kind = new.kind and (x.reason = '' or x.reason = coalesce(new.meta->>'reason', '')) loop
    v_gain := case when r.prof = v_main then (r.xp * 3) / 2 else r.xp end;
    insert into public.player_professions (account_id, prof, day, day_xp) values (new.account_id, r.prof, v_today, 0)
    on conflict do nothing;
    select * into p from public.player_professions where account_id = new.account_id and prof = r.prof for update;
    if p.day is distinct from v_today then p.day_xp := 0; end if;
    v_gain := least(v_gain, 2000 - p.day_xp);
    if v_gain <= 0 then continue; end if;
    v_old := public._prof_level(p.xp);
    update public.player_professions set xp = xp + v_gain, day = v_today, day_xp = p.day_xp + v_gain
     where account_id = new.account_id and prof = r.prof;
    if public._prof_level(p.xp + v_gain) > v_old then
      perform public._game_event(new.account_id, 'profession_level', public._prof_level(p.xp + v_gain),
                                 jsonb_build_object('prof', r.prof));
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists game_events_prof on public.game_events;
create trigger game_events_prof after insert on public.game_events for each row execute function public._prof_on_event();

-- perk coins and food buffs from the ledger
create or replace function public._perk_ledger() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_key text; v_pct numeric; v_amt int; v_day date := public._vn_today(); v_paid int;
begin
  if coalesce(new.ref, '') like 'perk:%' then return new; end if;
  if new.delta < 0 and new.reason in ('meal', 'buff_food') and new.ref like '%: %' then
    perform public._food_buffs(new.account_id, split_part(new.ref, ': ', 2));
  end if;
  if new.delta > 0 then
    v_key := case
      when new.reason = 'sell' and new.ref like '% con%' then 'fish_sell_pct'
      when new.reason in ('rice_sell', 'produce_sell') then 'farm_sell_pct'
      when new.reason in ('ore_sell', 'gem_sell') then 'ore_sell_pct'
      when new.reason in ('market_sell', 'shop_sell', 'auction_sell') then 'market_sell_pct' end;
  elsif new.delta < 0 then
    v_key := case new.reason
      when 'farm_buy' then 'farm_buy_pct' when 'mine_tool' then 'mine_tool_pct' when 'meal' then 'meal_pct'
      when 'potion' then 'potion_pct' when 'buy' then 'buy_pct' when 'shop_rent' then 'shop_rent_pct'
      when 'market_list' then 'shop_rent_pct' when 'upgrade' then 'upgrade_pct' when 'repair' then 'repair_pct'
      when 'furniture' then 'furniture_pct' when 'house_build' then 'house_pct'
      when 'dojo_tuition' then 'dojo_pct' when 'dojo_exam' then 'dojo_pct' end;
  end if;
  if v_key is null then return new; end if;
  v_pct := least(30, public._perk(new.account_id, v_key));
  if v_pct <= 0 then return new; end if;
  v_amt := floor(abs(new.delta) * v_pct / 100);
  if v_amt <= 0 then return new; end if;
  insert into public.perk_payouts (account_id, day, paid) values (new.account_id, v_day, 0) on conflict do nothing;
  select paid into v_paid from public.perk_payouts where account_id = new.account_id and day = v_day for update;
  v_amt := least(v_amt, 3000 - v_paid);
  if v_amt <= 0 then return new; end if;
  update public.perk_payouts set paid = paid + v_amt where account_id = new.account_id and day = v_day;
  perform set_config('mt.perk_pay', '1', true);
  perform public._pay(new.account_id, v_amt, new.reason, 'perk: ' || v_key);
  perform set_config('mt.perk_pay', '', true);
  return new;
end $$;
drop trigger if exists coin_ledger_perk on public.coin_ledger;
create trigger coin_ledger_perk after insert on public.coin_ledger for each row execute function public._perk_ledger();

-- a cast: stamina, then the luck
create or replace function public._prof_on_cast() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_p numeric; v_r smallint; v_min int; v_max int; sp public.fish_species; v_frac numeric;
begin
  perform public._stamina_spend(new.account_id, 3, 'fish');
  v_p := least(40, public._perk(new.account_id, 'rare_fish_pct') + public._buff(new.account_id, 'rare_fish'));   -- 0072's luck: casts_luck
  if v_p > 0 and random() * 100 < v_p then
    select rarity, min_g, max_g into v_r, v_min, v_max from public.fish_species where id = new.species_id;
    if v_r < 5 then
      select * into sp from public.fish_species where rarity = v_r + 1 order by random() limit 1;
      if found then
        v_frac := greatest(0, least(1, (new.weight_g - v_min)::numeric / greatest(1, v_max - v_min)));
        new.species_id := sp.id;
        new.weight_g := sp.min_g + round(v_frac * (sp.max_g - sp.min_g))::int;
        new.big := new.big or sp.rarity >= 3;
      end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists casts_prof on public.casts;
create trigger casts_prof before insert on public.casts for each row execute function public._prof_on_cast();

create or replace function public._prof_on_net() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._stamina_spend(new.account_id, 5, 'fish'); return new; end $$;
drop trigger if exists net_throws_prof on public.net_throws;
create trigger net_throws_prof before insert on public.net_throws for each row execute function public._prof_on_net();

create or replace function public._prof_on_dig() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$ begin perform public._stamina_spend(new.account_id, 4, 'mine'); return new; end $$;
do $$
begin
  if to_regclass('public.mine_digs') is not null then
    execute 'drop trigger if exists mine_digs_prof on public.mine_digs';
    execute 'create trigger mine_digs_prof before insert on public.mine_digs for each row execute function public._prof_on_dig()';
  end if;
end $$;

create or replace function public._prof_on_fight() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._stamina_drain(new.p1, 8, 'fight');
  if new.p2 is not null then perform public._stamina_drain(new.p2, 8, 'fight'); end if;
  return new;
end $$;
drop trigger if exists fight_matches_prof on public.fight_matches;
create trigger fight_matches_prof after insert on public.fight_matches for each row execute function public._prof_on_fight();

-- a night in the motel refills stamina
create or replace function public._prof_on_sleep() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.slept_at is distinct from old.slept_at then
    insert into public.player_stamina (account_id, value, at) values (new.account_id, public._stamina_max(new.account_id), now())
    on conflict (account_id) do update set value = excluded.value, at = now();
  end if;
  return new;
end $$;
drop trigger if exists rest_state_prof on public.rest_state;
create trigger rest_state_prof after update on public.rest_state for each row execute function public._prof_on_sleep();

create or replace function public._prof_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.player_professions where account_id = new.account_id;
  delete from public.player_profession_main where account_id = new.account_id;
  delete from public.player_skills where account_id = new.account_id;
  delete from public.player_stamina where account_id = new.account_id;
  delete from public.player_buffs where account_id = new.account_id;   -- 0072's wipe trigger clears it too
  return new;
end $$;
drop trigger if exists anticheat_wipes_prof on public.anticheat_wipes;
create trigger anticheat_wipes_prof after insert on public.anticheat_wipes for each row execute function public._prof_on_wipe();

-- 0047's _fishing_effort, verbatim but for the lines marked 0077 (perk fish_effort_pct lowers the cost, ≤ 50 %).
create or replace function public._fishing_effort(p_account uuid, p_hunger numeric, p_thirst numeric) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.vitals;
        v_k numeric := 1 - least(50, public._perk(p_account, 'fish_effort_pct')) / 100.0;   -- 0077
begin
  update public.vitals
     set hunger = greatest(0, hunger - p_hunger * v_k), thirst = greatest(0, thirst - p_thirst * v_k)   -- 0077 was: p_hunger / p_thirst
   where account_id = p_account and fainted_until is null
  returning * into v;
  if not found then
    select * into v from public.vitals where account_id = p_account;
  end if;
  return public._vitals_json(v);
end; $$;

-- ---------- E. RPCs ----------
create or replace function public.profession_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._prof_json(public._auth_account(p_session_token));
end $$;

-- Choose my main nghề: the first time free; a switch costs 500 xu and waits 24 h after the last choice.
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
    if coalesce(v_coins, 0) < 500 then raise exception 'insufficient funds' using errcode = '22023'; end if;
    perform public._pay(v_account, -500, 'profession', 'profession: ' || m.prof || ' -> ' || p_prof);
    update public.player_profession_main set prof = p_prof, chosen_at = now() where account_id = v_account;
  else
    insert into public.player_profession_main (account_id, prof) values (v_account, p_prof);
  end if;
  return public._prof_json(v_account);
end $$;

-- Learn a node: its prerequisite learned, enough unspent points in its nghề (points = the nghề's level).
create or replace function public.skill_learn(p_session_token text, p_node text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); n public.skill_nodes; v_level int; v_spent int;
begin
  select * into n from public.skill_nodes where id = p_node;
  if not found then raise exception 'unknown skill' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  if exists (select 1 from public.player_skills where account_id = v_account and node = p_node) then
    raise exception 'already learned' using errcode = '22023';
  end if;
  if n.req is not null and not exists (select 1 from public.player_skills where account_id = v_account and node = n.req) then
    raise exception 'skill locked' using errcode = '53400';
  end if;
  v_level := public._prof_level((select xp from public.player_professions where account_id = v_account and prof = n.prof));
  select coalesce(sum(k.cost), 0) into v_spent from public.player_skills s join public.skill_nodes k on k.id = s.node
   where s.account_id = v_account and k.prof = n.prof;
  if v_level - v_spent < n.cost then raise exception 'not enough points' using errcode = '53400'; end if;
  insert into public.player_skills (account_id, node) values (v_account, p_node);
  return public._prof_json(v_account);
end $$;

-- Forget every node of a nghề for 300 xu.
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
  if coalesce(v_coins, 0) < 300 then raise exception 'insufficient funds' using errcode = '22023'; end if;
  perform public._pay(v_account, -300, 'skill_reset', 'skill_reset: ' || p_prof);
  delete from public.player_skills s using public.skill_nodes n
   where n.id = s.node and s.account_id = v_account and n.prof = p_prof;
  return public._prof_json(v_account);
end $$;

-- The HUD's stamina heartbeat: p_run_ms of sprinting since the last tick (≤ the real time since it, ≤ 60 s; 1 stamina a
-- second — sprinting is movement, which is the client's everywhere; the server position's speed cap still holds), and
-- whether I lie in the hammock (only honoured on the hall, where it hangs: resting for the next 40 s).
create or replace function public.stamina_tick(p_session_token text, p_run_ms integer default 0,
                                               p_resting boolean default false) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); s public.player_stamina; v_run numeric;
begin
  s := public._stamina_settle(v_account);
  v_run := least(greatest(0, coalesce(p_run_ms, 0)) / 1000.0, 60,
                 coalesce(extract(epoch from (now() - s.tick_at)), 30));
  update public.player_stamina set tick_at = now() where account_id = v_account;
  if v_run > 0 then perform public._stamina_drain(v_account, v_run, 'run'); end if;
  if p_resting and coalesce((select map = 'hall' from public.player_pos where account_id = v_account), false) then
    update public.player_stamina set rest_until = now() + interval '40 seconds' where account_id = v_account;
  elsif not p_resting then
    update public.player_stamina set rest_until = null where account_id = v_account;
  end if;
  return public._stamina_json(v_account);
end $$;

-- ---------- privileges ----------
revoke all on function public._prof_level(integer) from public, anon, authenticated;
revoke all on function public._perk(uuid, text) from public, anon, authenticated;
revoke all on function public._buff_cap(text) from public, anon, authenticated;
revoke all on function public._buff(uuid, text) from public, anon, authenticated;
revoke all on function public._buff_grant(uuid, text, numeric, integer) from public, anon, authenticated;
revoke all on function public._food_buffs(uuid, text) from public, anon, authenticated;
revoke all on function public._stamina_max(uuid) from public, anon, authenticated;
revoke all on function public._stamina_rate(uuid, boolean) from public, anon, authenticated;
revoke all on function public._stamina_settle(uuid) from public, anon, authenticated;
revoke all on function public._stamina_cost(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public._stamina_spend(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public._stamina_drain(uuid, numeric, text) from public, anon, authenticated;
revoke all on function public._stamina_json(uuid) from public, anon, authenticated;
revoke all on function public._prof_json(uuid) from public, anon, authenticated;
revoke all on function public._prof_on_event() from public, anon, authenticated;
revoke all on function public._perk_ledger() from public, anon, authenticated;
revoke all on function public._prof_on_cast() from public, anon, authenticated;
revoke all on function public._prof_on_net() from public, anon, authenticated;
revoke all on function public._prof_on_fight() from public, anon, authenticated;
revoke all on function public._prof_on_dig() from public, anon, authenticated;
revoke all on function public._prof_on_sleep() from public, anon, authenticated;
revoke all on function public._prof_on_wipe() from public, anon, authenticated;
revoke all on function public._fishing_effort(uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.profession_state(text) from public;
revoke all on function public.profession_choose(text, text) from public;
revoke all on function public.skill_learn(text, text) from public;
revoke all on function public.skill_reset(text, text) from public;
revoke all on function public.stamina_tick(text, integer, boolean) from public;
grant execute on function public.profession_state(text) to anon, authenticated;
grant execute on function public.profession_choose(text, text) to anon, authenticated;
grant execute on function public.skill_learn(text, text) to anon, authenticated;
grant execute on function public.skill_reset(text, text) to anon, authenticated;
grant execute on function public.stamina_tick(text, integer, boolean) to anon, authenticated;
