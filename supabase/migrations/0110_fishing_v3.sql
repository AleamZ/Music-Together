-- =========================================================
-- 0110_fishing_v3.sql — Câu cá v3: modular gear (spec docs/superpowers/specs/2026-09-30-fishing-v3-design.md).
-- ADDITIVE and re-runnable. Run after 0109 (0111 is another change's).
--   A. The parts are sold one by one (shop_items kinds 'hook', 'line', 'reel', 'groundbait', 'fishbook'; more 'bucket' and
--      'net' kinds). New stat columns: line_g (a line holds a fish up to it), hook_class / hook_count (the hook: which
--      species it can take, and 1–3 points), reel_speed / reel_ease (the reel: min_reel_ms × speed, difficulty + ease).
--      Cần gỗ is a complete kit (its own small single hook, a 3 kg line, no reel, its phao): hook_class / line_g set on
--      the rod itself. Every other rod is a bare rod: it needs a hook and a line mounted (a reel and a phao are
--      optional). The rods' rating_g is now what breaks them: tre 6 kg, sợi thủy tinh 12 kg, carbon 30 kg, cần thủ 60 kg.
--   B. fish_habits (not readable by the client — the notebook reads it): per species the hook class it needs (null any),
--      the baits and the groundbaits it likes, the Vietnam clock hours it bites (null always) and the notebook's line.
--      Four new species: lươn đồng (lưỡi câu lươn, night), cá tai tượng (morning), ba ba gai (lưỡi lớn, night), cá chình
--      (river, lưỡi câu lươn, night) — priced on 0101's scale.
--   C. fishing_profiles gets the hook / line / reel slots; bobber may be null (none: a 0.7 s hook window on a bare rod).
--      fishing_equip(token, slot, item | null) mounts and unmounts (the item must be owned; slot and kind must match).
--   D. The roll (start_cast, start_river_cast, start_river_cast_w): the rarity as before (rod, bait, weather, the river's
--      bump); the species is then weighted within its rarity and water among those the mounted hook takes and that bite
--      at this hour: ×2 for a liked bait, ×3 for a liked groundbait thrown on this spot (none left at a rarity → the
--      rarity below). The reel's params take the reel (difficulty + ease, min_reel_ms × speed); the bobber the window.
--      A bare rod without its parts is refused: 'rod needs parts'. The cast keeps its line, the limits and the extra
--      hooks' fish (casts.line / line_g / rod_g / extra). _cast_lift lifts to a species the hook takes and that bites now.
--   E. finish_cast: a won reel whose fish is heavier than the rig's weakest part breaks it — the line ('line_snap', one of
--      its 3 snaps worn; the last one leaves it in pieces) or the rod ('rod_snap': its durability to 0, repairable as
--      before). A 2-point hook adds one fish with 12 %, a 3-point hook one with 15 % and another with 6 %: rolled at the
--      cast by the same rules (no lift), landed when the rig holds them and the bucket has room ('extra').
--   F. Thính: throw_groundbait(room, token, item, map, x, y) spends one bag on the spot I stand at (the pond cell as
--      start_cast's col / row, or Sông Cái / the wild river in world px as the river casts): one per account, 10 minutes,
--      48 px around it. Only the thrower's own casts and nets there feel it.
--   G. The nets: start_net keeps the spot (net_throws.x / y); net_haul picks each fish by the net's rare_mult (×1.5: 5 %
--      Hiếm; ×2: 10 % Hiếm, 2 % Quý), never a hook-gated species, only those biting now, weighted by the groundbait.
--   H. fishing_notebook(token): the habits, for an account that bought Sổ tay câu cá ('no notebook' otherwise).
--   I. _fishing_state: the loadout's hook / line / reel (bobber may be null), the parts owned, the lines' wear, the
--      groundbait bags and the active one, the notebook, and the rig (what the gear adds up to).
-- Re-created from their newest bodies, only the lines marked 0110 changed: _fishing_state (0034), buy_item (0098),
-- _cast_lift (0101), start_cast (0101), start_river_cast (0101), start_river_cast_w (0101), finish_cast (0101, the
-- 6-argument one; 0108's 7-argument form calls it), start_net (0059), net_haul (0101, the overload the client calls).
-- New: _vn_hour, _fishing_rig, _fish_ok, _species_pick, _net_pick, _cast_extras, _groundbait_at, _line_wear (private);
-- fishing_equip, throw_groundbait, fishing_notebook (guarded). Unchanged: hook_cast, finish_net, _roll_rarity,
-- _rod_wear, _rod_usable, repair_rod (rods only, as before), set_loadout (rod / bobber / bait, kept for old pages).
-- =========================================================

-- ---------- A. The parts ----------
alter table public.shop_items add column if not exists line_g integer;         -- line: holds a fish up to this (rod: its own line)
alter table public.shop_items add column if not exists hook_class text;        -- hook: the class it is (rod: its own hook)
alter table public.shop_items add column if not exists hook_count smallint;    -- hook: points, 1 … 3
alter table public.shop_items add column if not exists reel_speed real;        -- reel: min_reel_ms ×
alter table public.shop_items add column if not exists reel_ease smallint;     -- reel: difficulty +
alter table public.shop_items drop constraint if exists shop_items_hook_count_check;
alter table public.shop_items add constraint shop_items_hook_count_check check (hook_count between 1 and 3);

alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food',
                  'net','fishing_kit',
                  'hook','line','reel','groundbait','fishbook'));

-- The stock (spec §3). Lines wear by snaps (durability 3); hooks, reels and the notebook do not wear.
insert into public.shop_items (id, kind, name, price, starter, sort_order, rare_mult, capacity, durability, radius_px,
                               line_g, hook_class, hook_count, reel_speed, reel_ease) values
  ('hook_small',    'hook',       'Lưỡi đơn nhỏ',     20,  false, 10, 1,   null, null, null, null,  'small',  1,    null, null),
  ('hook_large',    'hook',       'Lưỡi đơn lớn',    100,  false, 20, 1,   null, null, null, null,  'large',  1,    null, null),
  ('hook_shrimp',   'hook',       'Lưỡi tôm',         60,  false, 30, 1,   null, null, null, null,  'shrimp', 1,    null, null),
  ('hook_eel',      'hook',       'Lưỡi câu lươn',    80,  false, 40, 1,   null, null, null, null,  'eel',    1,    null, null),
  ('hook_double',   'hook',       'Lưỡi đôi',        400,  false, 50, 1,   null, null, null, null,  'small',  2,    null, null),
  ('hook_triple',   'hook',       'Lưỡi ba',        1500,  false, 60, 1,   null, null, null, null,  'large',  3,    null, null),
  ('line_02',       'line',       'Dây cước 0.2',     40,  false, 10, 1,   null, 3,    null, 4000,  null,     null, null, null),
  ('line_03',       'line',       'Dây cước 0.3',    150,  false, 20, 1,   null, 3,    null, 12000, null,     null, null, null),
  ('line_braid',    'line',       'Dây dù bện',      400,  false, 30, 1,   null, 3,    null, 30000, null,     null, null, null),
  ('line_pe',       'line',       'Dây PE siêu bền', 1200, false, 40, 1,   null, 3,    null, 60000, null,     null, null, null),
  ('reel_1000',     'reel',       'Máy xoay 1000',   150,  false, 10, 1,   null, null, null, null,  null,     null, 1.0,  0),
  ('reel_3000',     'reel',       'Máy xoay 3000',   400,  false, 20, 1,   null, null, null, null,  null,     null, 0.9,  -5),
  ('reel_5000',     'reel',       'Máy xoay 5000',  1200,  false, 30, 1,   null, null, null, null,  null,     null, 0.8,  -10),
  ('gb_cam',        'groundbait', 'Thính cám gạo',    10,  false, 10, 1,   null, null, null, null,  null,     null, null, null),
  ('gb_tom',        'groundbait', 'Thính tôm khô',    15,  false, 20, 1,   null, null, null, null,  null,     null, null, null),
  ('gb_thom',       'groundbait', 'Thính thơm',       20,  false, 30, 1,   null, null, null, null,  null,     null, null, null),
  ('gb_tanh',       'groundbait', 'Thính tanh',       30,  false, 40, 1,   null, null, null, null,  null,     null, null, null),
  ('fishbook',      'fishbook',   'Sổ tay câu cá',   500,  false, 10, 1,   null, null, null, null,  null,     null, null, null),
  ('bucket_medium', 'bucket',     'Xô vừa',          450,  false, 15, 1,   10,   null, null, null,  null,     null, null, null),
  ('bucket_foam',   'bucket',     'Thùng xốp',      2000,  false, 25, 1,   30,   null, null, null,  null,     null, null, null),
  ('bucket_ice',    'bucket',     'Thùng đá',       5000,  false, 27, 1,   50,   null, null, null,  null,     null, null, null),
  ('net_gill',      'net',        'Lưới rê',         300,  false, 30, 1.5, null, 30,   30,   null,  null,     null, null, null),
  ('net_cast',      'net',        'Lưới chài cước',  800,  false, 40, 2,   null, 40,   36,   null,  null,     null, null, null)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter, sort_order = excluded.sort_order,
  rare_mult = excluded.rare_mult, capacity = excluded.capacity, durability = excluded.durability, radius_px = excluded.radius_px,
  line_g = excluded.line_g, hook_class = excluded.hook_class, hook_count = excluded.hook_count,
  reel_speed = excluded.reel_speed, reel_ease = excluded.reel_ease;

-- The rods: the wooden one is the kit (its own hook and line; unbreakable, so its rating stays the "lớn" mark of 0031);
-- the others are bare, and their rating_g is the weight that breaks them.
update public.shop_items set hook_class = 'small', hook_count = 1, line_g = 3000 where id = 'rod_wood';
update public.shop_items s set rating_g = v.g, hook_class = null, hook_count = null, line_g = null
  from (values ('rod_bamboo', 6000), ('rod_fiber', 12000), ('rod_carbon', 30000), ('rod_master', 60000)) v(id, g)
 where s.id = v.id;

-- ---------- B. The species' habits ----------
insert into public.fish_species (id, name, rarity, min_g, max_g, price_per_kg, difficulty, sort_order, water) values
  ('luon_dong',    'Lươn đồng',    2,  100,   600, 35, 36, 65,  'pond'),
  ('ca_tai_tuong', 'Cá tai tượng', 4,  800,  4000, 18, 72, 115, 'pond'),
  ('ba_ba',        'Ba ba gai',    5, 3000, 15000, 60, 92, 125, 'pond'),
  ('ca_chinh',     'Cá chình',     4, 1000,  8000, 16, 80, 235, 'deep')
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, min_g = excluded.min_g, max_g = excluded.max_g,
  price_per_kg = excluded.price_per_kg, difficulty = excluded.difficulty, sort_order = excluded.sort_order, water = excluded.water;

create table if not exists public.fish_habits (
  species_id text primary key references public.fish_species(id) on delete cascade,
  hook text,                                   -- the hook class it needs (null: any hook)
  baits text[] not null default '{}',          -- the baits it likes (×2)
  groundbaits text[] not null default '{}',    -- the groundbaits it likes (×3)
  hours smallint[],                            -- the Vietnam clock hours it bites (null: always)
  note text not null default ''                -- the notebook's line
);
alter table public.fish_habits enable row level security;
revoke all on public.fish_habits from anon, authenticated;

insert into public.fish_habits (species_id, hook, baits, groundbaits, hours, note) values
  ('ca_ro',         null,     '{bait_worm}',                '{gb_cam}',          null,
   'Rô đồng háu ăn, rỉa mồi quanh bờ cỏ cả ngày.'),
  ('ca_sac',        null,     '{bait_worm,bait_bloodworm}', '{gb_cam}',          null,
   'Sặc rằn lượn dưới bèo, mê trùn.'),
  ('ca_me_vinh',    null,     '{bait_worm}',                '{gb_cam,gb_thom}',  null,
   'Mè vinh ăn tạp, theo mùi cám mà tới.'),
  ('ca_loc',        null,     '{bait_shrimp,bait_gold}',    '{gb_tom}',          null,
   'Lóc rình mồi sống, đớp tép rất mạnh.'),
  ('ca_tre',        null,     '{bait_worm,bait_bloodworm}', '{gb_tanh}',         null,
   'Trê nằm đáy bùn, đánh hơi mồi tanh.'),
  ('ca_chep',       null,     '{bait_worm,bait_gold}',      '{gb_cam,gb_thom}',  null,
   'Chép khôn, ăn chậm, ưa thính cám và mùi thơm.'),
  ('luon_dong',     'eel',    '{bait_worm}',                '{gb_tanh}',         '{18,19,20,21,22,23,0,1,2,3,4,5}',
   'Lươn chui hang ban ngày, tối mới ra kiếm ăn — phải dùng lưỡi câu lươn.'),
  ('ca_tra',        null,     '{bait_shrimp}',              '{gb_tanh,gb_thom}', null,
   'Cá tra to xác, mê mồi tanh.'),
  ('ca_that_lat',   null,     '{bait_shrimp}',              '{gb_tom}',          null,
   'Thát lát săn tép nhỏ ven bờ.'),
  ('tom_cang',      'shrimp', '{bait_bloodworm}',           '{gb_tom}',          null,
   'Tôm càng chỉ mắc lưỡi tôm, mê trùn chỉ.'),
  ('ca_bong_lau',   null,     '{bait_shrimp,bait_gold}',    '{gb_tanh}',         null,
   'Bông lau khỏe, ăn mồi tanh ở chỗ nước sâu.'),
  ('ca_he_vang',    null,     '{bait_gold}',                '{gb_thom}',         '{6,7,8,9,10,11,12,13,14,15,16,17}',
   'He vàng chỉ ăn ban ngày, thích mồi vàng và thính thơm.'),
  ('ca_tai_tuong',  null,     '{bait_shrimp}',              '{gb_thom}',         '{5,6,7,8,9}',
   'Tai tượng chỉ lên ăn lúc sáng sớm (5–9 giờ).'),
  ('ca_ho',         'large',  '{bait_gold}',                '{gb_thom}',         null,
   'Cá hô khổng lồ — cần lưỡi lớn, dây và cần thật chắc.'),
  ('ba_ba',         'large',  '{bait_gold}',                '{gb_tom}',          '{20,21,22,23,0,1,2,3}',
   'Ba ba gai bò lên ăn đêm khuya — cần lưỡi lớn.'),
  ('ca_leo',        'large',  '{bait_shrimp}',              '{gb_tanh}',         null,
   'Cá leo miệng rộng, chỉ mắc lưỡi lớn.'),
  ('ca_bong_tuong', null,     '{bait_bloodworm}',           '{gb_tom}',          null,
   'Bống tượng nằm im, đớp trùn chỉ.'),
  ('ca_lang',       null,     '{bait_worm,bait_bloodworm}', '{gb_tanh}',         null,
   'Cá lăng ăn đáy, mê trùn và mồi tanh.'),
  ('ca_ngat',       null,     '{bait_worm}',                '{gb_tanh}',         '{18,19,20,21,22,23,0,1,2,3,4,5,6}',
   'Cá ngát đi ăn đêm.'),
  ('ca_chien',      'large',  '{bait_shrimp}',              '{gb_tanh}',         null,
   'Cá chiên dữ, cần lưỡi lớn và dây chắc.'),
  ('ca_duoi_song',  'large',  '{bait_bloodworm}',           '{gb_tanh}',         null,
   'Đuối sông nằm đáy cát — cần lưỡi lớn.'),
  ('ca_dua',        null,     '{bait_shrimp}',              '{gb_tom}',          null,
   'Cá dứa bơi theo đàn, mê tép.'),
  ('ca_anh_vu',     null,     '{bait_gold}',                '{gb_thom}',         null,
   'Anh vũ kén ăn, chỉ thích mồi vàng và thính thơm.'),
  ('ca_chinh',      'eel',    '{bait_bloodworm}',           '{gb_tanh}',         '{19,20,21,22,23,0,1,2,3,4}',
   'Cá chình trườn ra ăn đêm — cần lưỡi câu lươn.'),
  ('ca_tra_dau',    'large',  '{bait_gold}',                '{gb_thom}',         null,
   'Tra dầu khổng lồ — lưỡi lớn, dây PE, cần thủ.'),
  ('rua_mai_vang',  'large',  '{bait_gold}',                '{gb_thom}',         null,
   'Rùa mai vàng hiếm gặp, chỉ mắc lưỡi lớn.'),
  ('ca_vo_dem',     'large',  '{bait_bloodworm}',           '{gb_tanh}',         null,
   'Vồ đém nặng ký — lưỡi lớn và dây thật chắc.')
on conflict (species_id) do update set
  hook = excluded.hook, baits = excluded.baits, groundbaits = excluded.groundbaits, hours = excluded.hours, note = excluded.note;

-- ---------- C. The slots ----------
alter table public.fishing_profiles add column if not exists hook text references public.shop_items(id);
alter table public.fishing_profiles add column if not exists line text references public.shop_items(id);
alter table public.fishing_profiles add column if not exists reel text references public.shop_items(id);
alter table public.fishing_profiles alter column bobber drop not null;

-- The cast keeps what it was cast with (a part unmounted mid-cast changes nothing), and the extra hooks' fish.
alter table public.casts add column if not exists line text;         -- the mounted line (null: the rod's own)
alter table public.casts add column if not exists line_g integer;    -- the line's limit (null: none — a cast before 0110)
alter table public.casts add column if not exists rod_g integer;     -- the rod's limit (null: unbreakable)
alter table public.casts add column if not exists extra jsonb;       -- [{species_id, weight_g}] of the extra hooks
alter table public.net_throws add column if not exists x integer;    -- the throw's spot, pond px (the groundbait)
alter table public.net_throws add column if not exists y integer;

-- ---------- F. Thính ----------
create table if not exists public.fishing_groundbait (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  item text not null references public.shop_items(id),
  map text not null,                                    -- 'pond' | 'song_cai' | 'wild'
  x integer not null,                                   -- world / map px (the pond: the cell's centre)
  y integer not null,
  thrown_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.fishing_groundbait enable row level security;
revoke all on public.fishing_groundbait from anon, authenticated;

-- ---------- The helpers ----------
-- The Vietnam clock's hour, 0 … 23.
create or replace function public._vn_hour() returns integer
language sql stable set search_path = public, extensions
as $$ select extract(hour from now() at time zone 'Asia/Ho_Chi_Minh')::int $$;
revoke all on function public._vn_hour() from public, anon, authenticated;

-- What the account's gear adds up to (spec §2): the rod, and on a bare rod the mounted parts it owns. ready = the rod may
-- cast (a kit rod always; a bare rod with a hook and a line). hook_class / hooks: the hook; line_g: what the line holds;
-- rod_g: what breaks the rod (null: unbreakable); reel_speed / reel_ease: the reel (none on a bare rod: ×1.15, +5);
-- window_ms / bite_*: the phao (none: the kit's own 1.5 s, a bare rod's 0.7 s).
create or replace function public._fishing_rig(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare p public.fishing_profiles; rod public.shop_items; h public.shop_items; l public.shop_items; r public.shop_items;
        b public.shop_items; v_kit boolean; v_missing text[] := '{}';
begin
  select * into p from public.fishing_profiles where account_id = p_account;
  select * into rod from public.shop_items where id = coalesce(p.rod, 'rod_wood');
  v_kit := rod.hook_class is not null;
  if p.account_id is null then
    select * into b from public.shop_items where id = 'bobber_feather';
  elsif p.bobber is not null and public._owns(p_account, p.bobber) then
    select * into b from public.shop_items where id = p.bobber and kind = 'bobber';
  end if;
  if not v_kit then
    if p.hook is not null and public._owns(p_account, p.hook) then
      select * into h from public.shop_items where id = p.hook and kind = 'hook';
    end if;
    if p.line is not null and exists (select 1 from public.inventory i where i.account_id = p_account and i.item_id = p.line
                                        and i.qty >= 1 and coalesce(i.durability, 1) > 0) then
      select * into l from public.shop_items where id = p.line and kind = 'line';
    end if;
    if p.reel is not null and public._owns(p_account, p.reel) then
      select * into r from public.shop_items where id = p.reel and kind = 'reel';
    end if;
    if h.id is null then v_missing := v_missing || 'hook'::text; end if;
    if l.id is null then v_missing := v_missing || 'line'::text; end if;
  end if;
  return jsonb_build_object(
    'rod', rod.id, 'kit', v_kit, 'ready', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing),
    'hook', h.id, 'hook_class', case when v_kit then rod.hook_class else h.hook_class end,
    'hooks', case when v_kit then coalesce(rod.hook_count, 1) else coalesce(h.hook_count, 1) end,
    'line', l.id, 'line_g', case when v_kit then rod.line_g else l.line_g end,
    'rod_g', case when rod.durability is null then null else rod.rating_g end,
    'reel', r.id,
    'reel_speed', case when v_kit then 1 else round(coalesce(r.reel_speed, 1.15)::numeric, 2) end,
    'reel_ease', case when v_kit then 0 else coalesce(r.reel_ease, 5) end,
    'bobber', b.id, 'window_ms', coalesce(b.window_ms, case when v_kit then 1500 else 700 end),
    'bite_min_ms', coalesce(b.bite_min_ms, 3000), 'bite_max_ms', coalesce(b.bite_max_ms, 10000),
    'shows_rarity', coalesce(b.shows_rarity, false));
end $$;
revoke all on function public._fishing_rig(uuid) from public, anon, authenticated;

-- May this species take this hook now? (its hook class, if it needs one; its hours, if it has them)
create or replace function public._fish_ok(p_species text, p_hook text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select not exists (select 1 from public.fish_habits h
                      where h.species_id = p_species
                        and ((h.hook is not null and h.hook is distinct from p_hook)
                             or (h.hours is not null and not (public._vn_hour() = any(h.hours)))))
$$;
revoke all on function public._fish_ok(text, text) from public, anon, authenticated;

-- The species of a rolled rarity (spec §4): of the cast's water (the river's deep water from Hiếm up), one the hook takes
-- (a net: none that needs a hook) and that bites at this hour, weighted ×2 by a liked bait and ×3 by a liked groundbait
-- (Efraimidis–Spirakis: the least −ln(u) / w). None at that rarity → the rarity below. Rarity 1 always has one.
create or replace function public._species_pick(p_rarity integer, p_boat boolean, p_hook text, p_bait text, p_gb text,
                                                p_net boolean default false) returns public.fish_species
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare sp public.fish_species; v_hour integer := public._vn_hour();
begin
  for r in reverse greatest(1, least(5, coalesce(p_rarity, 1))) .. 1 loop
    select s.* into sp from public.fish_species s left join public.fish_habits h on h.species_id = s.id
     where s.rarity = r and s.water = case when p_boat and r >= 3 then 'deep' else 'pond' end
       and (h.hook is null or (not p_net and h.hook = p_hook))
       and (h.hours is null or v_hour = any(h.hours))
     order by -ln(1.0 - random()) / ((case when p_bait = any(h.baits) then 2 else 1 end)
                                     * (case when p_gb = any(h.groundbaits) then 3 else 1 end))
     limit 1;
    if found then return sp; end if;
  end loop;
  return null;
end $$;
revoke all on function public._species_pick(integer, boolean, text, text, text, boolean) from public, anon, authenticated;

-- A net's fish (spec §6): rare_mult r lifts it to Quý with 2 %·(r − 1), to Hiếm with 10 %·(r − 1); otherwise a Thường or
-- Khá as before (0034: any of them alike). Never a species that needs a hook; only those biting now; the groundbait ×3.
create or replace function public._net_pick(p_net text, p_gb text) returns public.fish_species
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare sp public.fish_species; v_rm numeric := coalesce((select rare_mult from public.shop_items where id = p_net), 1);
        u double precision := random(); v_hour integer := public._vn_hour();
begin
  if v_rm > 1 and u < 0.12 * (v_rm - 1) then
    sp := public._species_pick(case when u < 0.02 * (v_rm - 1) then 4 else 3 end, false, null, null, p_gb, true);
    if sp.rarity >= 3 then return sp; end if;
  end if;
  select s.* into sp from public.fish_species s left join public.fish_habits h on h.species_id = s.id
   where s.rarity in (1, 2) and s.water = 'pond' and h.hook is null and (h.hours is null or v_hour = any(h.hours))
   order by -ln(1.0 - random()) / (case when p_gb = any(h.groundbaits) then 3 else 1 end)
   limit 1;
  return sp;
end $$;
revoke all on function public._net_pick(text, text) from public, anon, authenticated;

-- The extra hooks' fish of a cast (spec §5): a 2-point hook one with 12 %, a 3-point hook one with 15 % and another with
-- 6 %; each rolled like the cast's own fish (the rarity with the rod, bait and weather, the river's bump, the species by
-- the hook, the hour, the bait and the groundbait, the weight by the rod) — no lift. [{species_id, weight_g}].
create or replace function public._cast_extras(p_rig jsonb, p_rod text, p_bait text, p_big double precision, p_night boolean,
                                               p_boat boolean, p_bump numeric, p_gb text, p_weight_k real) returns jsonb
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_n integer := coalesce((p_rig->>'hooks')::int, 1); v_out jsonb := '[]'::jsonb; v_r integer; sp public.fish_species;
        v_p double precision;
begin
  for i in 1 .. least(2, v_n - 1) loop
    v_p := case when i = 2 then 0.06 when v_n >= 3 then 0.15 else 0.12 end;
    continue when random() >= v_p;
    v_r := public._roll_rarity(p_rod, p_bait, p_big, p_night);
    if p_boat and v_r < 3 and random() < coalesce(p_bump, 0) then v_r := 3; end if;
    sp := public._species_pick(v_r, p_boat, p_rig->>'hook_class', p_bait, p_gb);
    continue when sp.id is null;
    v_out := v_out || jsonb_build_array(jsonb_build_object('species_id', sp.id, 'weight_g',
               least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(p_weight_k, 2.0)))::int)));
  end loop;
  return v_out;
end $$;
revoke all on function public._cast_extras(jsonb, text, text, double precision, boolean, boolean, numeric, text, real)
  from public, anon, authenticated;

-- The groundbait working at this spot for this account (its item), or null: thrown on the same map within 48 px, less
-- than 10 minutes ago.
create or replace function public._groundbait_at(p_account uuid, p_map text, p_x integer, p_y integer) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select g.item from public.fishing_groundbait g
   where g.account_id = p_account and g.map = p_map and g.expires_at > now()
     and p_x is not null and p_y is not null and (g.x - p_x)::bigint * (g.x - p_x) + (g.y - p_y)::bigint * (g.y - p_y) <= 48 * 48
$$;
revoke all on function public._groundbait_at(uuid, text, integer, integer) from public, anon, authenticated;

-- A line snapped: one of its snaps is spent; at 0 it is in pieces (gone from the bag, unmounted). True when it is gone.
create or replace function public._line_wear(p_account uuid, p_line text) returns boolean
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare v_d integer;
begin
  if p_line is null then return false; end if;
  update public.inventory set durability = greatest(0, coalesce(durability, 1) - 1)
   where account_id = p_account and item_id = p_line and qty >= 1
  returning durability into v_d;
  if v_d is null or v_d > 0 then return false; end if;
  delete from public.inventory where account_id = p_account and item_id = p_line;
  update public.fishing_profiles set line = null where account_id = p_account and line = p_line;
  return true;
end $$;
revoke all on function public._line_wear(uuid, text) from public, anon, authenticated;

-- ---------- C. fishing_equip ----------
-- Mount (p_item) or unmount (null) one slot: rod, hook, line, reel, bobber, bait. The item must be of the slot's kind and
-- owned (a bait need only exist: it may be at 0, as set_loadout allowed); the rod is never empty (null = Cần gỗ), nor the
-- bait; a broken rod is refused. A cast already in the water keeps what it was cast with.
create or replace function public.fishing_equip(p_session_token text, p_slot text, p_item text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); it public.shop_items;
begin
  perform public._wallet_lock(v_account);
  perform public._fishing_profile(v_account);
  if p_slot is null or p_slot not in ('rod', 'hook', 'line', 'reel', 'bobber', 'bait') then
    raise exception 'bad slot' using errcode = '22023';
  end if;
  if p_item is null then
    if p_slot = 'bait' then raise exception 'item not available' using errcode = '22023'; end if;
    if p_slot = 'rod' then p_item := 'rod_wood'; end if;
  end if;
  if p_item is not null then
    select * into it from public.shop_items where id = p_item;
    if not found or it.kind <> p_slot or (p_slot <> 'bait' and not public._owns(v_account, p_item)) then
      raise exception 'item not available' using errcode = '22023';
    end if;
    if p_slot = 'rod' and not public._rod_usable(v_account, p_item) then
      raise exception 'rod broken' using errcode = '22023';
    end if;
    if p_slot = 'line' and exists (select 1 from public.inventory where account_id = v_account and item_id = p_item
                                     and coalesce(durability, 1) <= 0) then
      raise exception 'item not available' using errcode = '22023';
    end if;
  end if;
  update public.fishing_profiles set
    rod = case when p_slot = 'rod' then p_item else rod end,
    hook = case when p_slot = 'hook' then p_item else hook end,
    line = case when p_slot = 'line' then p_item else line end,
    reel = case when p_slot = 'reel' then p_item else reel end,
    bobber = case when p_slot = 'bobber' then p_item else bobber end,
    bait = case when p_slot = 'bait' then p_item else bait end
   where account_id = v_account;
  return jsonb_build_object('state', public._fishing_state(v_account));
end $$;
revoke all on function public.fishing_equip(text, text, text) from public;
grant execute on function public.fishing_equip(text, text, text) to anon, authenticated;

-- ---------- F. throw_groundbait ----------
-- One bag of p_item on the spot I stand at: p_map 'pond' with p_x / p_y the cell (col, row) as start_cast takes it, or
-- 'song_cai' / 'wild' with the world px of the boat as the river casts take them (the boat, the level). The spot is
-- claimed like a cast's. It replaces my earlier one and works for 10 minutes within 48 px.
create or replace function public.throw_groundbait(p_room_id uuid, p_session_token text, p_item text, p_map text,
                                                   p_x integer, p_y integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_ac jsonb; v_x integer; v_y integer; v_until timestamptz := now() + interval '10 minutes';
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if not exists (select 1 from public.shop_items where id = p_item and kind = 'groundbait') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if p_x is null or p_y is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if p_map = 'pond' then
    if public._pond_spot(p_x, p_y) is null then raise exception 'bad spot' using errcode = '22023'; end if;
    v_x := p_x * 8 + 4;
    v_y := p_y * 8 + 4;
  elsif p_map = 'song_cai' then
    if not public._river_water(p_x, p_y) then raise exception 'bad spot' using errcode = '22023'; end if;
    v_x := p_x;
    v_y := p_y;
  elsif p_map = 'wild' then
    if not public._river_world_water(p_x, p_y)
       or not exists (select 1 from public._world_to_zone(p_x, p_y) z where z.zone = 'wild') then
      raise exception 'bad spot' using errcode = '22023';
    end if;
    v_x := p_x;
    v_y := p_y;
  else
    raise exception 'bad spot' using errcode = '22023';
  end if;
  if p_map <> 'pond' then
    if not exists (select 1 from public.boats where account_id = v_account) then
      raise exception 'no boat' using errcode = '22023';
    end if;
    if not public._map_unlocked(v_account, 'song_cai') then raise exception 'map locked' using errcode = '22023'; end if;
  end if;
  v_ac := public._pos_claim(v_account, p_map, v_x, v_y, 'throw_groundbait', p_room_id, 'too far');
  if v_ac is not null then return v_ac; end if;
  perform public._wallet_lock(v_account);
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p_item and qty >= 1;
  if not found then raise exception 'no groundbait' using errcode = '22023'; end if;
  insert into public.fishing_groundbait (account_id, item, map, x, y, thrown_at, expires_at)
  values (v_account, p_item, p_map, v_x, v_y, now(), v_until)
  on conflict (account_id) do update set item = excluded.item, map = excluded.map, x = excluded.x, y = excluded.y,
                                         thrown_at = excluded.thrown_at, expires_at = excluded.expires_at;
  return jsonb_build_object('groundbait', jsonb_build_object('item', p_item, 'map', p_map, 'x', v_x, 'y', v_y, 'until', v_until),
                            'state', public._fishing_state(v_account));
end $$;
revoke all on function public.throw_groundbait(uuid, text, text, text, integer, integer) from public;
grant execute on function public.throw_groundbait(uuid, text, text, text, integer, integer) to anon, authenticated;

-- ---------- H. fishing_notebook ----------
-- Sổ tay câu cá: every species' habits, for an account that owns the notebook.
create or replace function public.fishing_notebook(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  if not public._owns(v_account, 'fishbook') then raise exception 'no notebook' using errcode = '22023'; end if;
  return jsonb_build_object('hour', public._vn_hour(), 'species', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'hook', h.hook, 'baits', to_jsonb(coalesce(h.baits, '{}')),
                                        'groundbaits', to_jsonb(coalesce(h.groundbaits, '{}')), 'hours', to_jsonb(h.hours),
                                        'note', coalesce(h.note, '')) order by s.sort_order)
      from public.fish_species s left join public.fish_habits h on h.species_id = s.id), '[]'::jsonb));
end $$;
revoke all on function public.fishing_notebook(text) from public;
grant execute on function public.fishing_notebook(text) to anon, authenticated;


-- ---------- I. The state (0034_rods_nets.sql's _fishing_state, verbatim but for the lines marked 0110) ----------
create or replace function public._fishing_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare w public.wallets; p public.fishing_profiles; v_resets timestamptz; v_left integer; v_dig timestamptz;
        v_today date := public._vn_today(); v_day_left integer;
begin
  select * into w from public.wallets where account_id = p_account;
  select * into p from public.fishing_profiles where account_id = p_account;
  if p.window_start is not null and now() < p.window_start + interval '1 hour' then
    v_resets := p.window_start + interval '1 hour';
    v_left := greatest(0, 40 - p.window_casts);
  else
    v_resets := null;
    v_left := 40;
  end if;
  if p.last_dig_at is not null and now() < p.last_dig_at + interval '45 seconds' then
    v_dig := p.last_dig_at + interval '45 seconds';
  else
    v_dig := null;
  end if;
  v_day_left := case when p.day_on = v_today then greatest(0, 300 - p.day_casts) else 300 end;
  return jsonb_build_object(
    'coins', coalesce(w.coins, 0),
    'daily_claimed', coalesce(w.daily_on = v_today, false),
    'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', case when p.account_id is null then 'bobber_feather' else p.bobber end,   -- 0110 was: 'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', coalesce(p.bobber, 'bobber_feather'),
                                  'bait', coalesce(p.bait, 'bait_worm'), 'hook', p.hook, 'line', p.line, 'reel', p.reel),   -- 0110 was: 'bait', coalesce(p.bait, 'bait_worm')),
    'owned', coalesce((select jsonb_agg(i.item_id order by s.kind, s.sort_order)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('rod','bobber','bait_box','bucket','net','hook','line','reel','fishbook')),   -- 0110 was: and s.kind in ('rod','bobber','bait_box','bucket','net')),              -- v18.2: nets
                      '[]'::jsonb),
    'wear', coalesce((select jsonb_object_agg(i.item_id, jsonb_build_array(i.durability, s.durability))   -- v18.2
                        from public.inventory i join public.shop_items s on s.id = i.item_id
                       where i.account_id = p_account and i.qty >= 1 and i.durability is not null
                         and s.kind in ('rod', 'net', 'line')), '{}'::jsonb),   -- 0110 was: and s.kind in ('rod', 'net')), '{}'::jsonb),
    'bait', (select jsonb_object_agg(s.id, coalesce(i.qty, 0))
               from public.shop_items s
               left join public.inventory i on i.item_id = s.id and i.account_id = p_account
              where s.kind = 'bait'),
    'bait_cap', public._bait_cap(p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'species_id', f.species_id, 'weight_g', f.weight_g,
                                                          'price', f.price, 'caught_at', f.caught_at) order by f.caught_at, f.id)
                        from public.fish f where f.account_id = p_account), '[]'::jsonb),
    'fish_cap', 1 + public._bucket_cap(p_account),
    'casts_left', v_left,
    'window_resets_at', v_resets,
    'dig_ready_at', v_dig,
    'server_now', now(),
    'casts_today_left', v_day_left,
    'day_resets_at', case when v_day_left = 0 then (v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end,
    'groundbait', (select jsonb_object_agg(s.id, coalesce(i.qty, 0)) from public.shop_items s   -- 0110
                     left join public.inventory i on i.item_id = s.id and i.account_id = p_account where s.kind = 'groundbait'),   -- 0110
    'groundbait_on', (select jsonb_build_object('item', g.item, 'map', g.map, 'x', g.x, 'y', g.y, 'until', g.expires_at)   -- 0110
                        from public.fishing_groundbait g where g.account_id = p_account and g.expires_at > now()),   -- 0110
    'notebook', public._owns(p_account, 'fishbook'),   -- 0110
    'rig', public._fishing_rig(p_account),   -- 0110
    'lock', public._ac_lock_state(p_account)
  );
end; $$;

-- ---------- A. The shop (0098_fishing_kit.sql's buy_item, verbatim but for the lines marked 0110) ----------
create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind not in ('rod','bobber','bait','bait_box','bucket','net','fishing_kit','hook','line','reel','groundbait','fishbook') then   -- 0110 was: if it.kind not in ('rod','bobber','bait','bait_box','bucket','net','fishing_kit') then      -- v18.2: nets; kit
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if (it.kind in ('bait', 'groundbait') and (p_qty is null or p_qty < 1 or p_qty > 99)) or (it.kind not in ('bait', 'groundbait') and p_qty is distinct from 1) then   -- 0110 was: if (it.kind = 'bait' and (p_qty is null or p_qty < 1 or p_qty > 99)) or (it.kind <> 'bait' and p_qty is distinct from 1) then
    return public._ac_flag(v_account, 'bad_qty', 'buy_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  -- 0110 {
  -- a groundbait: bags, at most 99 of a kind (the bait box does not hold them)
  if it.kind = 'groundbait' then
    if coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + p_qty > 99 then
      raise exception 'groundbait full' using errcode = '22023';
    end if;
    v_cost := it.price * p_qty;
    if w.coins < v_cost then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -v_cost, 'buy', it.id || ' x' || p_qty);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  -- 0110 }
  elsif it.kind = 'bait' then   -- 0110 was: if it.kind = 'bait' then
    if public._bait_total(v_account) + p_qty > public._bait_cap(v_account) then
      raise exception 'bait full' using errcode = '22023';
    end if;
    v_cost := it.price * p_qty;
    if w.coins < v_cost then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -v_cost, 'buy', it.id || ' x' || p_qty);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
    -- the selected bait ran out → the bought bait becomes the selection
    if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) = 0 then
      update public.fishing_profiles set bait = it.id where account_id = v_account;
    end if;
  else
    if public._owns(v_account, it.id)
       or (it.kind = 'bait_box' and public._bait_cap(v_account) >= it.capacity)
       or (it.kind = 'bucket' and public._bucket_cap(v_account) >= it.capacity)
       or (it.kind = 'fishing_kit' and public._bait_cap(v_account) >= it.capacity                     -- kit
           and public._bucket_cap(v_account) >= it.capacity) then                                     -- kit
      raise exception 'already owned' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    if it.kind = 'fishing_kit' then                                                              -- kit: grants its contents
      insert into public.inventory (account_id, item_id, qty) values (v_account, 'bait_box_100', 1), (v_account, 'bucket_100', 1)  -- kit
      on conflict (account_id, item_id) do update set qty = 1;                                   -- kit
    else                                                                                         -- kit
    insert into public.inventory (account_id, item_id, qty, durability) values (v_account, it.id, 1, it.durability)   -- v18.2
    on conflict (account_id, item_id) do update set qty = 1, durability = excluded.durability;                      -- v18.2
    end if;                                                                                      -- kit
    -- a better rod / bobber (by price; starter = 0) is equipped right away
    if it.kind in ('rod', 'bobber') then
      select coalesce(price, 0) into v_equipped from public.shop_items where id = case when it.kind = 'rod' then p.rod else p.bobber end;
      if it.price > coalesce(v_equipped, 0) and (it.kind <> 'rod' or it.hook_class is not null or (p.hook is not null and p.line is not null)) then   -- 0110 was: if it.price > coalesce(v_equipped, 0) then
        if it.kind = 'rod' then
          update public.fishing_profiles set rod = it.id where account_id = v_account;
        else
          update public.fishing_profiles set bobber = it.id where account_id = v_account;
        end if;
      end if;
    end if;
    -- 0110 {
    -- a part fills its empty slot right away (a bare rod above waits for its hook and line)
    if it.kind = 'hook' and p.hook is null then
      update public.fishing_profiles set hook = it.id where account_id = v_account;
    elsif it.kind = 'line' and p.line is null then
      update public.fishing_profiles set line = it.id where account_id = v_account;
    elsif it.kind = 'reel' and p.reel is null then
      update public.fishing_profiles set reel = it.id where account_id = v_account;
    end if;
    -- 0110 }
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

-- ---------- D. The lift (0101_econ_fishing.sql's _cast_lift, verbatim but for the lines marked 0110) ----------
create or replace function public._cast_lift(p_account uuid, p_rod text, p_species text, p_weight integer, p_boat boolean,
                                             out o_species text, out o_weight integer)
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare cur public.fish_species; sp public.fish_species; v_chance numeric;
        v_hook text := public._fishing_rig(p_account)->>'hook_class';   -- 0110
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
     and public._fish_ok(id, v_hook)   -- 0110
   order by random() limit 1;
  if not found then return; end if;
  o_species := sp.id;
  o_weight := sp.min_g + round(greatest(0, least(1, (p_weight - cur.min_g)::numeric / greatest(1, cur.max_g - cur.min_g)))
                               * (sp.max_g - sp.min_g))::int;
end $$;

-- ---------- D. The casts (0101_econ_fishing.sql's, verbatim but for the lines marked 0110) ----------
-- start_cast (0101_econ_fishing.sql's, verbatim but for the lines marked 0110)
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
        v_rig jsonb; v_gb text; v_diff integer; v_extra jsonb;                          -- 0110
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
  -- 0110 {
  -- a bare rod casts only with a hook and a line mounted (Cần gỗ is a kit); the groundbait on this spot
  v_rig := public._fishing_rig(v_account);
  if not (v_rig->>'ready')::boolean then
    raise exception 'rod needs parts' using errcode = '22023', detail = (v_rig->'missing')::text;
  end if;
  v_gb := public._groundbait_at(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4);
  -- 0110 }
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
  sp := public._species_pick(v_rarity, false, v_rig->>'hook_class', p.bait, v_gb);   -- 0110 was: select * into sp from public.fish_species where rarity = v_rarity and water = 'pond' order by random() limit 1;   -- econ v2 was: select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
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
  v_window := (v_rig->>'window_ms')::int;   -- 0110 was: v_window := coalesce(bob.window_ms, 1500);
  v_diff := greatest(1, least(100, sp.difficulty + (v_rig->>'reel_ease')::int));   -- the reel   -- 0110
  v_min_reel := round((2000 + 40 * v_diff) * (v_rig->>'reel_speed')::numeric)::int;   -- 0110 was: v_min_reel := 2000 + 40 * sp.difficulty;
  v_extra := public._cast_extras(v_rig, p.rod, p.bait, (v_fx->>'bigRare')::double precision,   -- 0110
                                 not (public._room_weather(p_room_id)).is_day, false, 0, v_gb, rod.weight_k);   -- 0110
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod,                                         -- v18.1
                            reel_seed, reel_params, line, line_g, rod_g, extra)   -- 0110 was: reel_seed, reel_params)                                        -- 0046
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          v_spot, v_bites, sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,   -- v18.1
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),                        -- 0046
                                     'difficulty', v_diff, 'min_reel_ms', v_min_reel),   -- 0110 was: 'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
          v_rig->>'line', (v_rig->>'line_g')::int, (v_rig->>'rod_g')::int, v_extra)   -- 0110
  returning id into v_id;
  -- 6. 0047: the effort — hunger 1.8, thirst 2.2 (no cap counters, no cast_daily_cap flag)
  -- econ v2 (F6): hunger 0.35, thirst 0.45
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', v_diff,   -- 0110 was: 'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'groundbait', v_gb,   -- 0110
    'spot', v_spot, 'bites', v_bites,                                                     -- v18.1
    'abandoned', v_abandoned,                                                             -- 0059 was: 'reel_seed', v_seed,                                                                  -- 0046
    'vitals', v_vitals,                                                                   -- 0047
    'state', public._fishing_state(v_account));
end; $$;

-- start_river_cast (0101_econ_fishing.sql's, verbatim but for the lines marked 0110)
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
        v_rig jsonb; v_gb text; v_diff integer; v_extra jsonb;                          -- 0110
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
  -- 0110 {
  -- a bare rod casts only with a hook and a line mounted (Cần gỗ is a kit); the groundbait on this spot
  v_rig := public._fishing_rig(v_account);
  if not (v_rig->>'ready')::boolean then
    raise exception 'rod needs parts' using errcode = '22023', detail = (v_rig->'missing')::text;
  end if;
  v_gb := public._groundbait_at(v_account, 'song_cai', p_x, p_y);
  -- 0110 }
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
  sp := public._species_pick(v_rarity, true, v_rig->>'hook_class', p.bait, v_gb);   -- 0110 was: select * into sp from public.fish_species
   -- 0110 was: where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   -- 0110 was: order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, true) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);
  v_bite := greatest(1000, round(v_bite * v_boost)::int);
  v_window := (v_rig->>'window_ms')::int;   -- 0110 was: v_window := coalesce(bob.window_ms, 1500);
  v_diff := greatest(1, least(100, sp.difficulty + (v_rig->>'reel_ease')::int));   -- the reel   -- 0110
  v_min_reel := round((2000 + 40 * v_diff) * (v_rig->>'reel_speed')::numeric)::int;   -- 0110 was: v_min_reel := 2000 + 40 * sp.difficulty;
  v_extra := public._cast_extras(v_rig, p.rod, p.bait, (v_fx->>'bigRare')::double precision,   -- 0110
                                 not (public._room_weather(p_room_id)).is_day, true, (case when v_shoal then 0.10 else 0.05 end), v_gb, rod.weight_k);   -- 0110
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod, reel_seed, reel_params, line, line_g, rod_g, extra)   -- 0110 was: spot, bites, big, rod, reel_seed, reel_params)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          'boat', not (public._rain_cold(v_account) and random() < 0.3),
          sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),
                                     'difficulty', v_diff, 'min_reel_ms', v_min_reel),   -- 0110 was: 'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
          v_rig->>'line', (v_rig->>'line_g')::int, (v_rig->>'rod_g')::int, v_extra)   -- 0110
  returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', v_diff,   -- 0110 was: 'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'groundbait', v_gb,   -- 0110
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

-- start_river_cast_w (0101_econ_fishing.sql's, verbatim but for the lines marked 0110)
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
        v_rig jsonb; v_gb text; v_diff integer; v_extra jsonb;                          -- 0110
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
  -- 0110 {
  -- a bare rod casts only with a hook and a line mounted (Cần gỗ is a kit); the groundbait on this spot
  v_rig := public._fishing_rig(v_account);
  if not (v_rig->>'ready')::boolean then
    raise exception 'rod needs parts' using errcode = '22023', detail = (v_rig->'missing')::text;
  end if;
  v_gb := public._groundbait_at(v_account, 'wild', p_x, p_y);
  -- 0110 }
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
  sp := public._species_pick(v_rarity, true, v_rig->>'hook_class', p.bait, v_gb);   -- 0110 was: select * into sp from public.fish_species
   -- 0110 was: where rarity = v_rarity and water = case when v_rarity >= 3 then 'deep' else 'pond' end
   -- 0110 was: order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  -- econ v2 (F5): at most one rarity lift (luck, rod level, perk, meal; ≤ 20 %), rolled BEFORE the reel is set
  select l.o_species, l.o_weight into v_lift, v_weight from public._cast_lift(v_account, p.rod, sp.id, v_weight, true) l;   -- econ v2
  if v_lift is distinct from sp.id then select * into sp from public.fish_species where id = v_lift; end if;   -- econ v2
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_bite := least(60000, round(v_bite / greatest((v_fx->>'bite')::numeric, 0.1))::int);
  v_bite := greatest(1000, round(v_bite * v_boost)::int);
  v_window := (v_rig->>'window_ms')::int;   -- 0110 was: v_window := coalesce(bob.window_ms, 1500);
  v_diff := greatest(1, least(100, sp.difficulty + (v_rig->>'reel_ease')::int));   -- the reel   -- 0110
  v_min_reel := round((2000 + 40 * v_diff) * (v_rig->>'reel_speed')::numeric)::int;   -- 0110 was: v_min_reel := 2000 + 40 * sp.difficulty;
  v_extra := public._cast_extras(v_rig, p.rod, p.bait, (v_fx->>'bigRare')::double precision,   -- 0110
                                 not (public._room_weather(p_room_id)).is_day, true, (case when v_shoal then 0.10 else 0.05 end), v_gb, rod.weight_k);   -- 0110
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at,
                            spot, bites, big, rod, reel_seed, reel_params, line, line_g, rod_g, extra)   -- 0110 was: spot, bites, big, rod, reel_seed, reel_params)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90),
          'boat', not (public._rain_cold(v_account) and random() < 0.3),
          sp.rarity >= 3 or v_weight > coalesce(rod.rating_g, 2147483647), p.rod,
          v_seed, jsonb_build_object('zone_pct', coalesce(rod.zone_pct, 25),
                                     'difficulty', v_diff, 'min_reel_ms', v_min_reel),   -- 0110 was: 'difficulty', sp.difficulty, 'min_reel_ms', v_min_reel))
          v_rig->>'line', (v_rig->>'line_g')::int, (v_rig->>'rod_g')::int, v_extra)   -- 0110
  returning id into v_id;
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 1.8, 2.2);
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', v_diff,   -- 0110 was: 'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then sp.rarity end,   -- econ v2 was: 'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'groundbait', v_gb,   -- 0110
    'spot', 'boat', 'shoal', v_shoal, 'bites', (select bites from public.casts where id = v_id),
    'abandoned', v_abandoned,
    'vitals', v_vitals,
    'state', public._fishing_state(v_account));
end $$;

-- ---------- E. The catch (0101_econ_fishing.sql's 6-argument finish_cast, verbatim but for the lines marked 0110) ----------
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
        v_limit integer; v_line_gone boolean; e jsonb; xs public.fish_species; v_xid uuid; v_xp integer;   -- 0110
        v_extra jsonb := '[]'::jsonb;   -- 0110
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
  -- 0110 {
  -- a landed fish heavier than the rig holds breaks its weakest part: the line (line_snap) or the rod (rod_snap)
  v_limit := least(coalesce(c.line_g, 2147483647), coalesce(c.rod_g, 2147483647));
  if v_why is null and c.weight_g > v_limit then
    v_why := case when coalesce(c.line_g, 2147483647) <= coalesce(c.rod_g, 2147483647) then 'line_snap' else 'rod_snap' end;
  end if;
  -- 0110 }
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
  -- 0110 {
  -- the snap's cost: the rod to 0 (unequipped, repairable), or one of the line's snaps (the last one: gone)
  if v_why = 'rod_snap' then
    perform public._rod_wear(v_account, v_rod, 1000000);
    v_broke := not public._rod_usable(v_account, v_rod);
  elsif v_why = 'line_snap' then
    v_line_gone := public._line_wear(v_account, c.line);
  end if;
  -- 0110 }
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'rod_broke', v_broke,        -- v18.2: rod_broke
                              'state', public._fishing_state(v_account))
           || case when v_why = 'outdated' then jsonb_build_object('message', 'Cập nhật trang để câu tiếp')   -- 0046
                   else '{}'::jsonb end
           || case when v_why in ('line_snap', 'rod_snap') then jsonb_build_object('snap', jsonb_build_object(   -- 0110
                'species_id', c.species_id, 'weight_g', c.weight_g, 'limit_g', v_limit,   -- 0110
                'line_gone', coalesce(v_line_gone, false))) else '{}'::jsonb end   -- 0110
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
  -- 0110 {
  -- the extra hooks' fish, rolled at the cast: each one the rig holds, while the bucket has room, priced like the first
  for e in select value from jsonb_array_elements(coalesce(c.extra, '[]'::jsonb)) loop
    exit when (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account);
    select * into xs from public.fish_species where id = e->>'species_id';
    continue when not found or (e->>'weight_g')::int > v_limit;
    v_xp := greatest(1, round(xs.price_per_kg * (e->>'weight_g')::int / 1000.0 * v_mult
                              * case when r.period is not null then public._fish_factor(c.room_id, xs.id, r.period) else 1 end)::int);
    perform set_config('mt.catch', '1', true);
    perform set_config('mt.catch_room', coalesce(c.room_id::text, ''), true);
    insert into public.fish (account_id, species_id, weight_g, price) values (v_account, xs.id, (e->>'weight_g')::int, v_xp)
    returning id into v_xid;
    perform set_config('mt.catch', '', true);
    perform set_config('mt.catch_room', '', true);
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, xs.id, (e->>'weight_g')::int, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at
      where public.personal_bests.weight_g < excluded.weight_g;
    v_extra := v_extra || jsonb_build_array(jsonb_build_object('id', v_xid, 'species_id', xs.id,
                 'weight_g', (e->>'weight_g')::int, 'price', v_xp, 'rarity', xs.rarity));
  end loop;
  -- 0110 }
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
    'extra', v_extra,   -- 0110
    'rod_broke', v_broke,                                                                 -- v18.2
    'state', public._fishing_state(v_account));
end; $$;

-- ---------- G. The nets ----------
-- start_net (0059_reel_hook.sql's, verbatim but for the lines marked 0110)
create or replace function public.start_net(p_room_id uuid, p_session_token text, p_col integer, p_row integer,
                                            p_net text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_d integer; v_seed integer;
        v_id uuid; v_beat integer; v_bucket integer;
        v_vitals jsonb;                                                                  -- 0047
        v_arrow bigint := floor(random() * 2147483648)::bigint;                          -- 0056: kéo lưới's seed, kept until the haul
        v_ac jsonb;                                                                      -- 0057
        v_abandoned jsonb;                                                               -- 0059
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
  if public._pond_spot(p_col, p_row) is null then raise exception 'bad spot' using errcode = '22023'; end if;
  if not (public._room_effects(p_room_id)->>'dockOpen')::boolean then raise exception 'storm' using errcode = '53400'; end if;
  perform public._vitals_guard(v_account);
  v_ac := public._pos_claim(v_account, 'pond', p_col * 8 + 4, p_row * 8 + 4, 'start_net', p_room_id, 'too far');   -- 0057
  if v_ac is not null then return v_ac; end if;                                                                    -- 0057
  perform public._wallet_lock(v_account);
  v_abandoned := public._cast_settle_hooked(v_account);                                  -- 0059: a hooked cast replaced is given up
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
  insert into public.net_throws (account_id, room_id, net, seed, beat_ms, arrow_seed, x, y)   -- 0110 was: insert into public.net_throws (account_id, room_id, net, seed, beat_ms, arrow_seed)   -- 0056 was: insert into public.net_throws (account_id, room_id, net, seed, beat_ms)
  values (v_account, p_room_id, p_net, v_seed, v_beat, v_arrow, p_col * 8 + 4, p_row * 8 + 4) returning id into v_id;   -- 0110 was: values (v_account, p_room_id, p_net, v_seed, v_beat, v_arrow) returning id into v_id;   -- 0056 was: values (v_account, p_room_id, p_net, v_seed, v_beat) returning id into v_id;
  -- 0056 was: v_vitals := public._fishing_effort(v_account, 3, 3.5);                                 -- 0047: a throw's effort
  return jsonb_build_object('throw_id', v_id, 'seed', v_seed, 'beat_ms', v_beat,
    'radius_px', (select radius_px from public.shop_items where id = p_net),
    'vitals', v_vitals,                                                                   -- 0047
    'abandoned', v_abandoned,                                                             -- 0059
    'state', public._fishing_state(v_account));
end; $$;

-- net_haul (0101_econ_fishing.sql's overload the client calls (press, release, aim, hits), verbatim but for the lines marked 0110)
create or replace function public.net_haul(p_session_token text, p_throw_id uuid, p_press integer, p_release integer,
                                           p_aim_x integer, p_aim_y integer, p_hits integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; t public.net_throws; v_n integer; v_free integer; sp public.fish_species;
        v_w integer; v_price integer; r public.fish_price_index; v_mult numeric := 1; v_room boolean;
        v_haul jsonb := '[]'::jsonb; v_d integer; v_vitals jsonb; v_bad text; v_rep jsonb; v_ac jsonb;
        v_radius integer; v_in jsonb;
        v_gb text;   -- 0110
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
  v_vitals := public._fishing_effort(v_account, 0.35, 0.45);   -- econ v2 was: v_vitals := public._fishing_effort(v_account, 3, 3.5);
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
  v_gb := public._groundbait_at(v_account, 'pond', t.x, t.y);   -- the thrower's groundbait   -- 0110
  for i in 1 .. v_n loop
    sp := public._net_pick(t.net, v_gb);   -- 0110 was: select * into sp from public.fish_species where rarity in (1, 2) order by random() limit 1;
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
