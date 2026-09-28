-- =========================================================
-- 0072_mining_crafting.sql — v21 "crafting" group: #19 Mỏ đá (mining), #26 potions, #89 item upgrades, #88 rarity
-- (the tiers are client-side: lib/game/rarity.ts; every catalog row here carries a rarity 1–6 = Common … Mythic, fish
-- keep their 1–5 which map onto the first five). ADDITIVE and re-runnable. Run after 0069.
--
-- Events emitted (public._game_event):
--   'ore_mined'      qty = ores gained, meta {item, rarity, node, perfect}
--   'herb_gathered'  qty = herbs gained, meta {item, rarity, node}
--   'potion_brewed'  qty = potions brewed, meta {potion, rarity}
--   'potion_drunk'   qty 1, meta {potion, effect}
--   'item_upgraded'  qty = the level after the try, meta {item, ok, from}
--   'xp_grant'       qty = xp, meta {source: 'mining' | 'herbs' | 'alchemy' | 'upgrade'}
-- Ledger reasons used (all already in 0069's check): 'ore_sell', 'mine_tool', 'potion', 'upgrade'.
--
-- Re-created functions I did not create (copied verbatim from their NEWEST body, 0057, with only the rows marked 0072
-- added): public._pos_maps() and public._pos_portals() — the new map 'mo_da' and its gate on Bãi đất trống.
--
--   A. Geometry: the map in the position checks; the use spots of lib/game/maps/mo-da.ts (tests pin them).
--   B. Catalogs: craft_items (ores, herbs, potions), pickaxe_kinds, potion_recipes; the node pools.
--   C. Per-account and per-room state: mine_nodes, mine_digs, mine_tools, craft_bag, item_upgrades, player_buffs,
--      mining_profiles. Wiped with the account (a trigger on anticheat_wipes).
--   D. The dig minigame (lib/game/mining/game.ts, statement for statement): _mine_round, _mine_pos, _mine_replay,
--      _mine_input_error. tests/fixtures/mine-cases.json pins them (Vitest + tests/sql/v21-crafting-smoke.sql).
--   E. RPCs: mine_state, mine_start, mine_finish (server seed, replayed strikes, hard mine_bad_input / mine_mismatch /
--      mine_too_fast), gather_herb, sell_ore, buy_pickaxe, brew_potion, drink_potion, upgrade_item.
--   F. Effects applied server-side: the luck buff and an upgraded rod may lift a cast's fish one rarity (a BEFORE INSERT
--      trigger on casts: the reel's params — the client's minigame — are untouched); an upgraded rod/net keeps its
--      larger max durability through repairs (a BEFORE UPDATE trigger on inventory); the miner buff (+1 ore) and the
--      pickaxe level (a wider hit window) in mine_start / mine_finish.
-- =========================================================

-- ---------- A. Geometry ----------
-- _pos_maps (0057's, verbatim but for the row marked 0072)
create or replace function public._pos_maps() returns table (map text, w integer, h integer)
language sql immutable parallel safe
as $$
  values ('hall', 640, 400), ('pond', 640, 400), ('field', 800, 480), ('market', 1280, 400), ('khu_nha', 800, 400),
         ('bai_dat', 800, 400), ('ham_ngam', 480, 320),
         ('mo_da', 640, 400)                                                                             -- 0072
$$;

-- _pos_portals (0057's, verbatim but for the rows marked 0072)
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
         ('ham_ngam', 'market', 48, 52, 640, 350, false),
         ('bai_dat', 'mo_da', 748, 268, 44, 200, false), ('mo_da', 'bai_dat', 28, 200, 736, 268, false)   -- 0072
$$;
revoke all on function public._pos_maps() from public, anon, authenticated;
revoke all on function public._pos_portals() from public, anon, authenticated;

-- Where one stands to use node n (mo-da.ts MINE_NODES): ore rocks 1–10, herb patches 11–14.
create or replace function public._mine_node_use(p_node integer) returns integer[]
language sql immutable parallel safe
as $$
  select case when p_node between 1 and 14 then
    array[(array[100, 200, 300, 400, 500, 580, 180, 330, 560, 470, 90, 240, 600, 400])[p_node],
          (array[124, 110, 124, 110, 134, 174, 214, 224, 314, 364, 342, 362, 92, 312])[p_node]] end
$$;
-- The node's zone: 1 shallow, 2 middle, 3 deep (ores); 4, 5 herb patches.
create or replace function public._mine_zone(p_node integer) returns integer
language sql immutable parallel safe
as $$ select case when p_node between 1 and 4 then 1 when p_node between 5 and 8 then 2 when p_node between 9 and 10 then 3
                  when p_node between 11 and 13 then 4 when p_node = 14 then 5 end $$;
-- chú Tám's counter (ores, pickaxes), the anvil (upgrades), bà Sáu's cauldron (potions).
create or replace function public._mine_spot(p_what text) returns integer[]
language sql immutable parallel safe
as $$ select case p_what when 'shop' then array[120, 282] when 'anvil' then array[200, 306]
                         when 'cauldron' then array[320, 346] end $$;
revoke all on function public._mine_node_use(integer) from public, anon, authenticated;
revoke all on function public._mine_zone(integer) from public, anon, authenticated;
revoke all on function public._mine_spot(text) from public, anon, authenticated;

-- 0070's level gate: the mine opens at character level 5 (lib/game/progression/model.ts MAP_MIN_LEVEL).
insert into public.map_levels (map, min_level) values ('mo_da', 5) on conflict (map) do nothing;
create or replace function public._mine_gate(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if not public._map_unlocked(p_account, 'mo_da') then raise exception 'map locked' using errcode = '22023'; end if;
end $$;
revoke all on function public._mine_gate(uuid) from public, anon, authenticated;

-- ---------- B. Catalogs (lib/game/mining/catalog.ts; tests pin them) ----------
create table if not exists public.craft_items (
  id text primary key,
  kind text not null check (kind in ('ore', 'herb', 'potion')),
  name text not null,
  rarity smallint not null check (rarity between 1 and 6),    -- 1 Common … 6 Mythic (lib/game/rarity.ts)
  price integer,                                              -- what chú Tám pays (ores, herbs); null: not sold
  hardness integer,                                           -- ores: good strikes needed
  min_tier integer,                                           -- ores: the least pickaxe tier
  respawn_s integer,                                          -- ores, herbs: the node's wait after it is taken
  xp integer not null default 0,
  sort_order integer not null default 0
);
alter table public.craft_items enable row level security;
revoke all on public.craft_items from anon, authenticated;
insert into public.craft_items (id, kind, name, rarity, price, hardness, min_tier, respawn_s, xp, sort_order) values
  ('ore_da',       'ore',  'Đá',              1,    4, 2, 1,  30,  2, 10),
  ('ore_than',     'ore',  'Than',            1,   10, 2, 1,  45,  3, 20),
  ('ore_dong',     'ore',  'Quặng đồng',      2,   25, 3, 1,  90,  5, 30),
  ('ore_sat',      'ore',  'Quặng sắt',       2,   40, 3, 2, 120,  6, 40),
  ('ore_bac',      'ore',  'Quặng bạc',       3,   80, 4, 2, 180, 10, 50),
  ('ore_vang',     'ore',  'Quặng vàng',      3,  160, 4, 3, 300, 15, 60),
  ('ore_ngoc',     'ore',  'Ngọc lục bảo',    4,  320, 4, 3, 420, 22, 70),
  ('ore_kimcuong', 'ore',  'Kim cương',       5,  700, 5, 4, 600, 35, 80),
  ('ore_tinhthe',  'ore',  'Tinh thể lửa',    6, 2000, 5, 4, 900, 70, 90),
  ('herb_nam',     'herb', 'Nấm hang',        1,    3, null, null,  60, 1, 110),
  ('herb_reu',     'herb', 'Rêu phát sáng',   2,    8, null, null,  90, 2, 120),
  ('herb_linhchi', 'herb', 'Nấm linh chi',    3,   30, null, null, 180, 4, 130),
  ('pot_hunger',   'potion', 'Cháo nấm bồi bổ',    1, null, null, null, null, 0, 210),
  ('pot_thirst',   'potion', 'Nước rêu mát lành',  1, null, null, null, null, 0, 220),
  ('pot_canh',     'potion', 'Canh cá hồi sức',    2, null, null, null, null, 0, 230),
  ('pot_cure',     'potion', 'Thuốc giải cảm',     2, null, null, null, null, 0, 240),
  ('pot_miner',    'potion', 'Thuốc thợ mỏ',       3, null, null, null, null, 0, 250),
  ('pot_luck',     'potion', 'Thuốc may mắn',      3, null, null, null, null, 0, 260),
  ('pot_luck2',    'potion', 'Tiên dược vận may',  5, null, null, null, null, 0, 270)
on conflict (id) do update set kind = excluded.kind, name = excluded.name, rarity = excluded.rarity, price = excluded.price,
  hardness = excluded.hardness, min_tier = excluded.min_tier, respawn_s = excluded.respawn_s, xp = excluded.xp,
  sort_order = excluded.sort_order;

create table if not exists public.pickaxe_kinds (
  id text primary key,
  name text not null,
  tier integer not null check (tier between 1 and 4),
  price integer not null,
  durability integer not null,
  rarity smallint not null check (rarity between 1 and 6),
  sort_order integer not null default 0
);
alter table public.pickaxe_kinds enable row level security;
revoke all on public.pickaxe_kinds from anon, authenticated;
insert into public.pickaxe_kinds (id, name, tier, price, durability, rarity, sort_order) values
  ('pick_da',   'Cuốc chim đá',        1,   150,  60, 1, 10),
  ('pick_sat',  'Cuốc chim sắt',       2,   900, 150, 2, 20),
  ('pick_thep', 'Cuốc chim thép',      3,  3500, 300, 3, 30),
  ('pick_kc',   'Cuốc chim kim cương', 4, 12000, 600, 4, 40)
on conflict (id) do update set name = excluded.name, tier = excluded.tier, price = excluded.price,
  durability = excluded.durability, rarity = excluded.rarity, sort_order = excluded.sort_order;

-- effect: 'hunger' | 'thirst' | 'vitals' (both) — amount = points; 'cure' — cảm lạnh and the heat shock gone;
-- 'luck' | 'miner' — a buff of power `amount` for duration_s. ingredients: {item: qty}; 'fish' = any fish in the bag.
create table if not exists public.potion_recipes (
  id text primary key references public.craft_items(id),
  effect text not null check (effect in ('hunger', 'thirst', 'vitals', 'cure', 'luck', 'miner')),
  amount integer not null default 0,
  duration_s integer not null default 0,
  fee integer not null default 0,
  ingredients jsonb not null
);
alter table public.potion_recipes enable row level security;
revoke all on public.potion_recipes from anon, authenticated;
insert into public.potion_recipes (id, effect, amount, duration_s, fee, ingredients) values
  ('pot_hunger', 'hunger', 40,    0,  10, '{"herb_nam": 2}'),
  ('pot_thirst', 'thirst', 40,    0,  10, '{"herb_reu": 2}'),
  ('pot_canh',   'vitals', 60,    0,  20, '{"fish": 1, "herb_nam": 1}'),
  ('pot_cure',   'cure',    0,    0,  30, '{"herb_linhchi": 1, "herb_reu": 1, "ore_than": 1}'),
  ('pot_miner',  'miner',   1,  600,  60, '{"herb_linhchi": 1, "ore_sat": 2, "ore_bac": 1}'),
  ('pot_luck',   'luck',    1,  600,  80, '{"herb_linhchi": 2, "ore_vang": 1}'),
  ('pot_luck2',  'luck',    2, 1800, 300, '{"herb_linhchi": 3, "ore_ngoc": 1, "ore_kimcuong": 1}')
on conflict (id) do update set effect = excluded.effect, amount = excluded.amount, duration_s = excluded.duration_s,
  fee = excluded.fee, ingredients = excluded.ingredients;

-- What a node grows back as: weights per zone (catalog.ts NODE_POOLS).
create or replace function public._mine_pool() returns table (zone integer, ord integer, item text, weight integer)
language sql immutable parallel safe
as $$
  values (1, 1, 'ore_da', 45), (1, 2, 'ore_than', 30), (1, 3, 'ore_dong', 15), (1, 4, 'ore_sat', 8), (1, 5, 'ore_bac', 2),
         (2, 1, 'ore_da', 15), (2, 2, 'ore_than', 20), (2, 3, 'ore_dong', 25), (2, 4, 'ore_sat', 22), (2, 5, 'ore_bac', 10),
         (2, 6, 'ore_vang', 6), (2, 7, 'ore_ngoc', 2),
         (3, 1, 'ore_than', 10), (3, 2, 'ore_sat', 25), (3, 3, 'ore_bac', 25), (3, 4, 'ore_vang', 20), (3, 5, 'ore_ngoc', 12),
         (3, 6, 'ore_kimcuong', 7), (3, 7, 'ore_tinhthe', 1),
         (4, 1, 'herb_nam', 60), (4, 2, 'herb_reu', 35), (4, 3, 'herb_linhchi', 5),
         (5, 1, 'herb_nam', 30), (5, 2, 'herb_reu', 50), (5, 3, 'herb_linhchi', 20)
$$;
-- The pick for a uniform p_r in [0, 1).
create or replace function public._mine_roll(p_node integer, p_r double precision) returns text
language plpgsql immutable parallel safe
as $$
declare z integer := public._mine_zone(p_node); tot integer; acc integer := 0; w record; v_last text;
begin
  select sum(weight) into tot from public._mine_pool() p where p.zone = z;
  for w in select p.item, p.weight from public._mine_pool() p where p.zone = z order by p.ord loop
    acc := acc + w.weight;
    v_last := w.item;
    if p_r * tot < acc then return w.item; end if;
  end loop;
  return v_last;
end $$;
revoke all on function public._mine_pool() from public, anon, authenticated;
revoke all on function public._mine_roll(integer, double precision) from public, anon, authenticated;

-- The upgrade rules (catalog.ts UPGRADE): materials per step, success ‰, coins, and the max durability of a level.
create or replace function public._upgrade_mats(p_level integer) returns jsonb
language sql immutable parallel safe
as $$ select (array['{"ore_dong": 3}', '{"ore_sat": 3}', '{"ore_bac": 3}', '{"ore_vang": 3, "ore_ngoc": 1}',
                    '{"ore_kimcuong": 1, "ore_ngoc": 2}']::jsonb[])[p_level + 1] $$;
create or replace function public._upgrade_chance(p_level integer) returns integer
language sql immutable parallel safe
as $$ select (array[900, 750, 600, 450, 300])[p_level + 1] $$;
create or replace function public._upgrade_coins(p_price integer, p_level integer) returns integer
language sql immutable parallel safe
as $$ select greatest(50, (coalesce(p_price, 0) * (p_level + 1)) / 4) $$;
create or replace function public._upgrade_max(p_base integer, p_level integer) returns integer
language sql immutable parallel safe
as $$ select case when p_base is null then null else (p_base * (100 + 20 * coalesce(p_level, 0))) / 100 end $$;
-- The dig's hit half-window in ‰ of the bar.
create or replace function public._mine_win(p_tier integer, p_level integer) returns integer
language sql immutable parallel safe
as $$ select least(220, 70 + 20 * p_tier + 12 * coalesce(p_level, 0)) $$;
revoke all on function public._upgrade_mats(integer) from public, anon, authenticated;
revoke all on function public._upgrade_chance(integer) from public, anon, authenticated;
revoke all on function public._upgrade_coins(integer, integer) from public, anon, authenticated;
revoke all on function public._upgrade_max(integer, integer) from public, anon, authenticated;
revoke all on function public._mine_win(integer, integer) from public, anon, authenticated;

-- ---------- C. State ----------
create table if not exists public.mine_nodes (
  room_id uuid not null references public.rooms(id) on delete cascade,
  node_no integer not null check (node_no between 1 and 14),
  item_id text not null references public.craft_items(id),
  ready_at timestamptz not null default now(),
  primary key (room_id, node_no)
);
create table if not exists public.mine_digs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid not null,
  node_no integer not null,
  item_id text not null,
  tool_id text not null,
  seed bigint not null,
  need integer not null,
  win integer not null,
  started_at timestamptz not null default now()
);
create table if not exists public.mine_tools (
  account_id uuid not null references public.accounts(id) on delete cascade,
  tool_id text not null references public.pickaxe_kinds(id),
  durability integer not null default 0,
  primary key (account_id, tool_id)
);
create table if not exists public.craft_bag (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.craft_items(id),
  qty integer not null default 0 check (qty >= 0),
  primary key (account_id, item_id)
);
-- The +level of any tool: a rod or net (shop_items id) or a pickaxe (pickaxe_kinds id).
create table if not exists public.item_upgrades (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null,
  level integer not null default 0 check (level between 0 and 5),
  primary key (account_id, item_id)
);
create table if not exists public.player_buffs (
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null check (kind in ('luck', 'miner')),
  power integer not null default 1,
  until timestamptz not null,
  primary key (account_id, kind)
);
create table if not exists public.mining_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  day_on date,
  day_digs integer not null default 0,
  last_act_at timestamptz
);
alter table public.mine_nodes enable row level security;
alter table public.mine_digs enable row level security;
alter table public.mine_tools enable row level security;
alter table public.craft_bag enable row level security;
alter table public.item_upgrades enable row level security;
alter table public.player_buffs enable row level security;
alter table public.mining_profiles enable row level security;
revoke all on public.mine_nodes, public.mine_digs, public.mine_tools, public.craft_bag, public.item_upgrades,
              public.player_buffs, public.mining_profiles from anon, authenticated;

create or replace function public._mining_profile(p_account uuid) returns public.mining_profiles
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.mining_profiles;
begin
  insert into public.mining_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into v from public.mining_profiles where account_id = p_account for update;
  return v;
end $$;

-- The node row (created on first sight, ready), locked.
create or replace function public._mine_node(p_room uuid, p_node integer) returns public.mine_nodes
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.mine_nodes;
begin
  insert into public.mine_nodes (room_id, node_no, item_id) values (p_room, p_node, public._mine_roll(p_node, random()))
  on conflict (room_id, node_no) do nothing;
  select * into v from public.mine_nodes where room_id = p_room and node_no = p_node for update;
  return v;
end $$;

create or replace function public._upgrade_level(p_account uuid, p_item text) returns integer
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select level from public.item_upgrades where account_id = p_account and item_id = p_item), 0) $$;

create or replace function public._buff_power(p_account uuid, p_kind text) returns integer
language sql stable security definer set search_path = public, extensions
as $$ select coalesce((select power from public.player_buffs where account_id = p_account and kind = p_kind and until > now()), 0) $$;

create or replace function public._bag_add(p_account uuid, p_item text, p_qty integer) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.craft_bag (account_id, item_id, qty) values (p_account, p_item, p_qty)
  on conflict (account_id, item_id) do update set qty = public.craft_bag.qty + excluded.qty
$$;

-- Take p_qty of an item (false, nothing taken, when short).
create or replace function public._bag_take(p_account uuid, p_item text, p_qty integer) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.craft_bag set qty = qty - p_qty where account_id = p_account and item_id = p_item and qty >= p_qty;
  return found;
end $$;

-- Everything the mine's panels show. p_room null: no nodes.
create or replace function public._mine_state(p_room uuid, p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', now(),
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'nodes', case when p_room is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('no', n.node_no, 'item', n.item_id, 'ready_at', n.ready_at) order by n.node_no)
        from public.mine_nodes n where n.room_id = p_room), '[]'::jsonb) end,
    'bag', coalesce((select jsonb_object_agg(b.item_id, b.qty) from public.craft_bag b
                      where b.account_id = p_account and b.qty > 0), '{}'::jsonb),
    'fish', (select count(*) from public.fish f where f.account_id = p_account),
    'tools', coalesce((select jsonb_agg(jsonb_build_object('id', t.tool_id, 'durability', t.durability,
                                                           'max', public._upgrade_max(k.durability, public._upgrade_level(p_account, t.tool_id)),
                                                           'level', public._upgrade_level(p_account, t.tool_id)) order by k.tier)
                         from public.mine_tools t join public.pickaxe_kinds k on k.id = t.tool_id
                        where t.account_id = p_account), '[]'::jsonb),
    'gear', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'kind', s.kind, 'name', s.name, 'price', s.price,
                                                          'durability', i.durability,
                                                          'max', public._upgrade_max(s.durability, public._upgrade_level(p_account, s.id)),
                                                          'level', public._upgrade_level(p_account, s.id)) order by s.kind, s.sort_order)
                        from public.shop_items s
                        left join public.inventory i on i.item_id = s.id and i.account_id = p_account and i.qty >= 1
                       where s.kind in ('rod', 'net') and (i.account_id is not null or s.starter)), '[]'::jsonb),
    'buffs', coalesce((select jsonb_agg(jsonb_build_object('kind', b.kind, 'power', b.power, 'until', b.until))
                         from public.player_buffs b where b.account_id = p_account and b.until > now()), '[]'::jsonb),
    'dig', (select jsonb_build_object('node', d.node_no, 'item', d.item_id, 'tool', d.tool_id, 'seed', d.seed, 'need', d.need,
                                      'win', d.win, 'started_at', d.started_at)
              from public.mine_digs d where d.account_id = p_account and (p_room is null or d.room_id = p_room)))
$$;
revoke all on function public._mining_profile(uuid) from public, anon, authenticated;
revoke all on function public._mine_node(uuid, integer) from public, anon, authenticated;
revoke all on function public._upgrade_level(uuid, text) from public, anon, authenticated;
revoke all on function public._buff_power(uuid, text) from public, anon, authenticated;
revoke all on function public._bag_add(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._bag_take(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._mine_state(uuid, uuid) from public, anon, authenticated;

-- A wipe (anti-cheat §9.6) takes the mine's holdings too.
create or replace function public._mine_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.craft_bag where account_id = new.account_id;
  delete from public.mine_tools where account_id = new.account_id;
  delete from public.item_upgrades where account_id = new.account_id;
  delete from public.player_buffs where account_id = new.account_id;
  delete from public.mine_digs where account_id = new.account_id;
  return new;
end $$;
revoke all on function public._mine_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_wipes_mine on public.anticheat_wipes;
create trigger anticheat_wipes_mine after insert on public.anticheat_wipes for each row execute function public._mine_on_wipe();

-- ---------- D. The dig (lib/game/mining/game.ts, statement for statement) ----------
-- [period, centre 1 … centre need]: the period 80 + u mod 61 ticks, each centre 150 + u mod 701 ‰.
create or replace function public._mine_round(p_seed bigint, p_need integer) returns integer[]
language plpgsql immutable parallel safe
as $$
declare st bigint := p_seed & 4294967295; r bigint[]; o integer[];
begin
  r := public._reel_rand(st);
  st := r[2];
  o := array[(80 + r[1] % 61)::integer];
  for i in 1 .. p_need loop
    r := public._reel_rand(st);
    st := r[2];
    o := o || (150 + r[1] % 701)::integer;
  end loop;
  return o;
end $$;

-- The marker at tick t: a triangle 0 → 1000 → 0 ‰ over the period.
create or replace function public._mine_pos(p_period integer, p_t integer) returns integer
language sql immutable parallel safe
as $$ select case when ((p_t % p_period) * 2000) / p_period <= 1000 then ((p_t % p_period) * 2000) / p_period
                  else 2000 - ((p_t % p_period) * 2000) / p_period end $$;

-- The dig from its strike ticks: {outcome pass|fail|open, ticks (the tick after the deciding strike; null while open),
-- hits, used (the strikes played)}. A strike hits when the marker is within p_win of the current centre; `need` hits
-- pass; need + 3 strikes without them fail.
create or replace function public._mine_replay(p_seed bigint, p_need integer, p_win integer, p_strikes integer[]) returns jsonb
language plpgsql immutable parallel safe
as $$
declare rd integer[] := public._mine_round(p_seed, p_need); hits integer := 0; used integer := 0; s integer;
        outcome text; ticks integer;
begin
  foreach s in array coalesce(p_strikes, '{}'::integer[]) loop
    used := used + 1;
    if abs(public._mine_pos(rd[1], s) - rd[hits + 2]) <= p_win then hits := hits + 1; end if;
    if hits >= p_need then outcome := 'pass'; ticks := s + 1; exit; end if;
    if used >= p_need + 3 then outcome := 'fail'; ticks := s + 1; exit; end if;
  end loop;
  return jsonb_build_object('outcome', coalesce(outcome, 'open'), 'ticks', ticks, 'hits', hits, 'used', used);
end $$;

-- mineInputError: at most 12 strikes, 4 in any 60 ticks, within 3 600 ticks.
create or replace function public._mine_input_error(p_strikes integer[], p_ticks integer) returns text
language sql immutable parallel safe
as $$ select public._toggles_error(p_strikes, p_ticks, 3600, 12, 4) $$;
revoke all on function public._mine_round(bigint, integer) from public, anon, authenticated;
revoke all on function public._mine_pos(integer, integer) from public, anon, authenticated;
revoke all on function public._mine_replay(bigint, integer, integer, integer[]) from public, anon, authenticated;
revoke all on function public._mine_input_error(integer[], integer) from public, anon, authenticated;

-- ---------- E. RPCs ----------
create or replace function public.mine_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  for i in 1 .. 14 loop
    insert into public.mine_nodes (room_id, node_no, item_id) values (p_room_id, i, public._mine_roll(i, random()))
    on conflict (room_id, node_no) do nothing;
  end loop;
  return jsonb_build_object('state', public._mine_state(p_room_id, v_account));
end $$;

-- Start a dig at ore node 1–10: at its use spot, fed and watered, the node ready, a pickaxe strong enough (the best
-- usable one is taken). The server's seed, need and window come back; the dig replaces any earlier one.
create or replace function public.mine_start(p_room_id uuid, p_session_token text, p_node integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_use integer[]; v_ac jsonb; mp public.mining_profiles;
        n public.mine_nodes; it public.craft_items; v_tool text; v_tier integer; v_level integer; v_win integer;
        v_seed bigint := floor(random() * 4294967296)::bigint; v_today date := public._vn_today();
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
  if mp.day_on = v_today and mp.day_digs >= 400 then
    raise exception 'daily dig limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
  end if;
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
  delete from public.mine_digs where account_id = v_account;
  insert into public.mine_digs (account_id, room_id, node_no, item_id, tool_id, seed, need, win)
  values (v_account, p_room_id, p_node, it.id, v_tool, v_seed, it.hardness, v_win);
  update public.mining_profiles
     set day_digs = case when day_on = v_today then day_digs + 1 else 1 end, day_on = v_today
   where account_id = v_account;
  return jsonb_build_object('dig', jsonb_build_object('node', p_node, 'item', it.id, 'tool', v_tool, 'seed', v_seed,
                                                      'need', it.hardness, 'win', v_win, 'started_at', now()),
                            'state', public._mine_state(p_room_id, v_account));
end $$;

-- The end of a dig (single use). The strikes are replayed from the dig's seed: malformed → hard mine_bad_input, a pass
-- the replay does not give (or a different end tick, or strikes after the end) → hard mine_mismatch, sooner than
-- 0.9 × the replayed ticks → hard mine_too_fast; each is a lost dig. A claimed fail is taken as is (it only costs the
-- claimant). A pass: 1 ore, +1 for a perfect dig (no miss), +1 with the miner buff; the node grows back later as a
-- fresh roll. Every finished dig wears the pickaxe by 1.
create or replace function public.mine_finish(p_room_id uuid, p_session_token text, p_strikes integer[], p_ticks integer,
                                              p_pass boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); d public.mine_digs; v_use integer[]; v_ac jsonb;
        v_bad text; v_rep jsonb; v_code text; v_ev jsonb; n public.mine_nodes; it public.craft_items; v_qty integer;
        v_perfect boolean; v_buff integer; v_dur integer; v_vit jsonb; v_n integer := coalesce(cardinality(p_strikes), 0);
begin
  delete from public.mine_digs where account_id = v_account and room_id = p_room_id returning * into d;
  if not found then raise exception 'dig not found' using errcode = '22023'; end if;
  v_use := public._mine_node_use(d.node_no);
  v_ac := public._pos_claim(v_account, 'mo_da', v_use[1], v_use[2], 'mine_finish', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  -- the wear of any finished dig
  update public.mine_tools set durability = greatest(0, durability - 1)
   where account_id = v_account and tool_id = d.tool_id returning durability into v_dur;
  if now() > d.started_at + interval '120 seconds' then
    return jsonb_build_object('result', 'lost', 'why', 'expired', 'tool_broke', coalesce(v_dur, 0) = 0,
                              'state', public._mine_state(p_room_id, v_account));
  end if;
  v_ev := jsonb_build_object('node', d.node_no, 'pass', p_pass, 'ticks', p_ticks, 'n', v_n, 'strikes', to_jsonb(p_strikes[1:12]));
  v_bad := coalesce(public._mine_input_error(p_strikes, p_ticks), case when p_pass is null then 'pass' end);
  if v_bad is not null then
    v_code := 'mine_bad_input';
    v_ev := v_ev || jsonb_build_object('error', v_bad);
  elsif p_pass then
    v_rep := public._mine_replay(d.seed, d.need, d.win, p_strikes);
    if v_rep->>'outcome' <> 'pass' or (v_rep->>'ticks')::int <> p_ticks or (v_rep->>'used')::int <> v_n then
      v_code := 'mine_mismatch';
      v_ev := v_ev || jsonb_build_object('seed', d.seed, 'need', d.need, 'win', d.win, 'replay', v_rep);
    elsif now() < d.started_at + make_interval(secs => 0.9 * p_ticks / 60.0) then
      v_code := 'mine_too_fast';
      v_ev := v_ev || jsonb_build_object('started_at', d.started_at, 'claimed_at', now(), 'need_s', round(0.9 * p_ticks / 60.0, 3));
    end if;
  end if;
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
  v_vit := public._fishing_effort(v_account, 1.5, 2.0);
  perform public._game_event(v_account, 'ore_mined', v_qty,
    jsonb_build_object('item', it.id, 'rarity', it.rarity, 'node', d.node_no, 'perfect', v_perfect));
  perform public._game_event(v_account, 'xp_grant', it.xp * v_qty, '{"source":"mining"}'::jsonb);
  return jsonb_build_object('result', 'mined', 'item', it.id, 'qty', v_qty, 'perfect', v_perfect, 'buff', v_buff > 0,
                            'xp', it.xp * v_qty, 'tool_broke', coalesce(v_dur, 0) = 0, 'vitals', v_vit,
                            'state', public._mine_state(p_room_id, v_account));
end $$;

-- Pick a herb patch (nodes 11–14): at its use spot, fed, the patch grown; 1 herb (30 %: 2). One action a second.
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
  select * into it from public.craft_items where id = n.item_id;
  v_qty := case when random() < 0.3 then 2 else 1 end;
  update public.mine_nodes set item_id = public._mine_roll(p_node, random()), ready_at = now() + make_interval(secs => it.respawn_s)
   where room_id = p_room_id and node_no = p_node;
  perform public._bag_add(v_account, it.id, v_qty);
  perform public._game_event(v_account, 'herb_gathered', v_qty, jsonb_build_object('item', it.id, 'rarity', it.rarity, 'node', p_node));
  perform public._game_event(v_account, 'xp_grant', it.xp * v_qty, '{"source":"herbs"}'::jsonb);
  return jsonb_build_object('item', it.id, 'qty', v_qty, 'state', public._mine_state(p_room_id, v_account));
end $$;

-- chú Tám buys ores and herbs at the catalog's price.
create or replace function public.sell_ore(p_session_token text, p_item text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('shop');
        it public.craft_items; v_pay integer;
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
  v_pay := it.price * p_qty;
  perform public._pay(v_account, v_pay, 'ore_sell', it.id || ' x' || p_qty);
  return jsonb_build_object('sold', jsonb_build_object('item', it.id, 'qty', p_qty, 'xu', v_pay),
                            'state', public._mine_state(null, v_account));
end $$;

-- A pickaxe from chú Tám (again when the old one broke: back to its max, its level kept).
create or replace function public.buy_pickaxe(p_session_token text, p_tool text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('shop');
        k public.pickaxe_kinds; w public.wallets; v_d integer;
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'buy_pickaxe', null, 'not at the shop');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  select * into k from public.pickaxe_kinds where id = p_tool;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  w := public._wallet_lock(v_account);
  select durability into v_d from public.mine_tools where account_id = v_account and tool_id = k.id;
  if coalesce(v_d, 0) > 0 then raise exception 'already owned' using errcode = '22023'; end if;
  if w.coins < k.price then raise exception 'not enough coins' using errcode = '22023'; end if;
  perform public._pay(v_account, -k.price, 'mine_tool', k.id);
  insert into public.mine_tools (account_id, tool_id, durability)
  values (v_account, k.id, public._upgrade_max(k.durability, public._upgrade_level(v_account, k.id)))
  on conflict (account_id, tool_id) do update set durability = excluded.durability;
  return jsonb_build_object('state', public._mine_state(null, v_account));
end $$;

-- bà Sáu's cauldron: p_qty (1–5) of a recipe from the bag's ingredients (a 'fish' is the cheapest fish in the bag) and
-- her fee. One brew a second.
create or replace function public.brew_potion(p_session_token text, p_recipe text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('cauldron');
        r public.potion_recipes; it public.craft_items; w public.wallets; mp public.mining_profiles; e record;
        v_need integer; v_fee integer;
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'brew_potion', null, 'not at the cauldron');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  select * into r from public.potion_recipes where id = p_recipe;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  select * into it from public.craft_items where id = r.id;
  if p_qty is null or p_qty < 1 or p_qty > 5 then
    return public._ac_flag(v_account, 'bad_qty', 'brew_potion', jsonb_build_object('recipe', p_recipe, 'qty', p_qty), null,
                           'invalid quantity', false);
  end if;
  w := public._wallet_lock(v_account);
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  v_fee := r.fee * p_qty;
  if w.coins < v_fee then raise exception 'not enough coins' using errcode = '22023'; end if;
  -- check everything first, then take
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * p_qty;
    if e.key = 'fish' then
      if (select count(*) from public.fish where account_id = v_account) < v_need then
        raise exception 'not enough items' using errcode = '22023';
      end if;
    elsif coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < v_need then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  for e in select key, value::int as q from jsonb_each_text(r.ingredients) loop
    v_need := e.q * p_qty;
    if e.key = 'fish' then
      delete from public.fish where id in (select id from public.fish where account_id = v_account
                                            order by price, caught_at limit v_need);
    else
      perform public._bag_take(v_account, e.key, v_need);
    end if;
  end loop;
  if v_fee > 0 then perform public._pay(v_account, -v_fee, 'potion', r.id || ' x' || p_qty); end if;
  perform public._bag_add(v_account, r.id, p_qty);
  perform public._game_event(v_account, 'potion_brewed', p_qty, jsonb_build_object('potion', r.id, 'rarity', it.rarity));
  perform public._game_event(v_account, 'xp_grant', 3 * it.rarity * p_qty, '{"source":"alchemy"}'::jsonb);
  return jsonb_build_object('brewed', jsonb_build_object('potion', r.id, 'qty', p_qty), 'state', public._mine_state(null, v_account));
end $$;

-- Drink a potion from the bag, anywhere (not while fainted). One a second.
create or replace function public.drink_potion(p_session_token text, p_potion text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); r public.potion_recipes; mp public.mining_profiles;
        v public.vitals; v_vit jsonb;
begin
  select * into r from public.potion_recipes where id = p_potion;
  if not found then raise exception 'item not available' using errcode = '22023'; end if;
  v := public._vitals_apply(v_account);
  if v.fainted_until is not null then raise exception 'fainted' using errcode = '53400'; end if;
  mp := public._mining_profile(v_account);
  if mp.last_act_at > now() - interval '1 second' then raise exception 'too fast' using errcode = '53400'; end if;
  update public.mining_profiles set last_act_at = now() where account_id = v_account;
  if not public._bag_take(v_account, r.id, 1) then raise exception 'not enough items' using errcode = '22023'; end if;
  if r.effect in ('hunger', 'thirst', 'vitals') then
    update public.vitals
       set hunger = case when r.effect in ('hunger', 'vitals') then least(100, hunger + r.amount) else hunger end,
           thirst = case when r.effect in ('thirst', 'vitals') then least(100, thirst + r.amount) else thirst end
     where account_id = v_account returning * into v;
  elsif r.effect = 'cure' then
    update public.rain_state set cold_until = null, cold_wet_s = 0 where account_id = v_account;
    update public.heat_state set shocked = false, outdoor_since = null where account_id = v_account;
  else
    insert into public.player_buffs (account_id, kind, power, until)
    values (v_account, r.effect, r.amount, now() + make_interval(secs => r.duration_s))
    on conflict (account_id, kind) do update
      set power = case when public.player_buffs.until > now() then greatest(public.player_buffs.power, excluded.power)
                       else excluded.power end,
          until = greatest(public.player_buffs.until, excluded.until);
  end if;
  v_vit := public._vitals_json(v);
  perform public._game_event(v_account, 'potion_drunk', 1, jsonb_build_object('potion', r.id, 'effect', r.effect));
  return jsonb_build_object('effect', r.effect, 'vitals', v_vit, 'state', public._mine_state(null, v_account));
end $$;

-- The anvil: +1 on an owned rod, net or pickaxe (0 → 5) for coins and ores; the server rolls the success. A failed try
-- keeps the level and spends the cost. A success refills the tool to its new max durability.
create or replace function public.upgrade_item(p_session_token text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_s integer[] := public._mine_spot('anvil');
        w public.wallets; v_kind text; v_price integer; v_base integer; v_level integer; v_cost integer; v_mats jsonb;
        e record; v_ok boolean;
begin
  v_ac := public._pos_claim(v_account, 'mo_da', v_s[1], v_s[2], 'upgrade_item', null, 'not at the anvil');
  if v_ac is not null then return v_ac; end if;
  perform public._mine_gate(v_account);
  w := public._wallet_lock(v_account);
  if exists (select 1 from public.mine_tools where account_id = v_account and tool_id = p_item) then
    select 'pickaxe', price, durability into v_kind, v_price, v_base from public.pickaxe_kinds where id = p_item;
  elsif exists (select 1 from public.shop_items where id = p_item and kind in ('rod', 'net')) and public._owns(v_account, p_item) then
    select kind, price, durability into v_kind, v_price, v_base from public.shop_items where id = p_item;
  else
    raise exception 'item not available' using errcode = '22023';
  end if;
  v_level := public._upgrade_level(v_account, p_item);
  if v_level >= 5 then raise exception 'max level' using errcode = '22023'; end if;
  v_cost := public._upgrade_coins(v_price, v_level);
  v_mats := public._upgrade_mats(v_level);
  if w.coins < v_cost then raise exception 'not enough coins' using errcode = '22023'; end if;
  for e in select key, value::int as q from jsonb_each_text(v_mats) loop
    if coalesce((select qty from public.craft_bag where account_id = v_account and item_id = e.key), 0) < e.q then
      raise exception 'not enough items' using errcode = '22023';
    end if;
  end loop;
  for e in select key, value::int as q from jsonb_each_text(v_mats) loop
    perform public._bag_take(v_account, e.key, e.q);
  end loop;
  perform public._pay(v_account, -v_cost, 'upgrade', p_item || ' +' || (v_level + 1));
  v_ok := floor(random() * 1000) < public._upgrade_chance(v_level);
  if v_ok then
    insert into public.item_upgrades (account_id, item_id, level) values (v_account, p_item, v_level + 1)
    on conflict (account_id, item_id) do update set level = excluded.level;
    if v_kind = 'pickaxe' then
      update public.mine_tools set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and tool_id = p_item;
    elsif v_base is not null then
      update public.inventory set durability = public._upgrade_max(v_base, v_level + 1)
       where account_id = v_account and item_id = p_item and durability is not null;
    end if;
    perform public._game_event(v_account, 'xp_grant', 5 * (v_level + 1), '{"source":"upgrade"}'::jsonb);
  end if;
  perform public._game_event(v_account, 'item_upgraded', case when v_ok then v_level + 1 else v_level end,
                             jsonb_build_object('item', p_item, 'ok', v_ok, 'from', v_level));
  return jsonb_build_object('upgrade', jsonb_build_object('item', p_item, 'ok', v_ok,
                                                          'level', case when v_ok then v_level + 1 else v_level end,
                                                          'cost', v_cost, 'chance', public._upgrade_chance(v_level)),
                            'state', public._mine_state(null, v_account));
end $$;

revoke all on function public.mine_state(uuid, text) from public;
revoke all on function public.mine_start(uuid, text, integer) from public;
revoke all on function public.mine_finish(uuid, text, integer[], integer, boolean) from public;
revoke all on function public.gather_herb(uuid, text, integer) from public;
revoke all on function public.sell_ore(text, text, integer) from public;
revoke all on function public.buy_pickaxe(text, text) from public;
revoke all on function public.brew_potion(text, text, integer) from public;
revoke all on function public.drink_potion(text, text) from public;
revoke all on function public.upgrade_item(text, text) from public;
grant execute on function public.mine_state(uuid, text) to anon, authenticated;
grant execute on function public.mine_start(uuid, text, integer) to anon, authenticated;
grant execute on function public.mine_finish(uuid, text, integer[], integer, boolean) to anon, authenticated;
grant execute on function public.gather_herb(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_ore(text, text, integer) to anon, authenticated;
grant execute on function public.buy_pickaxe(text, text) to anon, authenticated;
grant execute on function public.brew_potion(text, text, integer) to anon, authenticated;
grant execute on function public.drink_potion(text, text) to anon, authenticated;
grant execute on function public.upgrade_item(text, text) to anon, authenticated;

-- ---------- F. Effects on existing systems ----------
-- A cast's fish may be lifted one rarity (at most Huyền thoại, 5): 20 % per luck-buff power plus 3 % per rod level. Only
-- the species and its weight change; the reel's seed and params (what the client plays and the server replays) stay.
create or replace function public._cast_luck() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_chance double precision; v_r smallint; sp public.fish_species;
begin
  v_chance := 0.20 * public._buff_power(new.account_id, 'luck') + 0.03 * public._upgrade_level(new.account_id, coalesce(new.rod, 'rod_wood'));
  if v_chance <= 0 or random() >= v_chance then return new; end if;
  select rarity into v_r from public.fish_species where id = new.species_id;
  if v_r is null or v_r >= 5 then return new; end if;
  select * into sp from public.fish_species where rarity = v_r + 1 order by random() limit 1;
  if not found then return new; end if;
  new.species_id := sp.id;
  new.weight_g := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), 2.0))::int);
  return new;
end $$;
revoke all on function public._cast_luck() from public, anon, authenticated;
drop trigger if exists casts_luck on public.casts;
create trigger casts_luck before insert on public.casts for each row execute function public._cast_luck();

-- A repair or a re-buy puts an upgraded rod or net back to its upgraded max (the shop max × 1 + 20 % a level).
create or replace function public._upgrade_repair() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare v_base integer; v_level integer;
begin
  if new.durability is null or old.durability is null or new.durability <= old.durability then return new; end if;
  select durability into v_base from public.shop_items where id = new.item_id and kind in ('rod', 'net');
  if v_base is null or new.durability <> v_base then return new; end if;
  v_level := public._upgrade_level(new.account_id, new.item_id);
  if v_level > 0 then new.durability := public._upgrade_max(v_base, v_level); end if;
  return new;
end $$;
revoke all on function public._upgrade_repair() from public, anon, authenticated;
drop trigger if exists inventory_upgrade_repair on public.inventory;
create trigger inventory_upgrade_repair before update of durability on public.inventory
  for each row execute function public._upgrade_repair();
