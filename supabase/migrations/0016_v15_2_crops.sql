-- =========================================================
-- 0016_v15_2_crops.sql — v15.2 "Nông cụ & hoa màu" (docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md):
-- the sickle and the 6-part rice harvest, the harvester rental, the sprayer, and three hoa-màu crops (khoai lang, bắp,
-- ớt) on one data-driven model.
-- ADDITIVE (no data drop) and re-runnable. Requires 0013 and 0015 (it re-creates guarded RPCs and anti-cheat helpers and
-- keeps their parts, anti-cheat spec §11.3); does not depend on 0014. Every function relies on
-- `set search_path = public, extensions`. Time rules live in private functions that take p_now; the public RPCs pass
-- now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Config and catalog ----------
-- One row per hoa-màu crop (§8.2): hours count from P (planting, or transplanting for a nursery crop).
create table if not exists public.upland_crops (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  method text not null check (method in ('cutting', 'direct', 'nursery')),
  plant_label text not null,
  transplant_label text,
  harvest_label text not null,
  harvest_anim text not null check (harvest_anim in ('dig', 'pick')),
  base_kg integer not null check (base_kg > 0),
  price_per_kg integer not null check (price_per_kg > 0),
  nursery_ready_h double precision,
  nursery_old_h double precision,
  stages jsonb not null,                       -- [{id, name, until_h, water: [levels]}]; the last until_h is ripe_h
  ripe_water jsonb not null,                   -- the levels accepted from ripe_h on
  ripe_window_h double precision not null,
  over_rate double precision not null,
  lost_after_h double precision not null,
  pickings jsonb not null,                     -- the percent of each picking, e.g. [40, 35, 25]
  pick_gap_h double precision,
  rot_from_h double precision,                 -- null: no rot
  rot_rate double precision,
  rot_cap double precision,
  cares jsonb not null default '[]'::jsonb,    -- [{id, kind, name, items, half_items, from_h, to_h, half_from_h, half_to_h,
                                               --   pen_half, pen_missing}]
  pests jsonb not null default '[]'::jsonb     -- [{slot, kind, name, from_h, to_h, chance, dry_mult, wet_mult, remedy}]
);
alter table public.upland_crops enable row level security;
drop policy if exists upland_crops_select on public.upland_crops;
create policy upland_crops_select on public.upland_crops for select to anon using (true);
grant select on public.upland_crops to anon, authenticated;

insert into public.upland_crops (id, name, sort_order, method, plant_label, transplant_label, harvest_label, harvest_anim,
                                 base_kg, price_per_kg, nursery_ready_h, nursery_old_h, stages, ripe_water, ripe_window_h,
                                 over_rate, lost_after_h, pickings, pick_gap_h, rot_from_h, rot_rate, rot_cap, cares, pests) values
  ('khoai', 'Khoai lang', 10, 'cutting', 'Trồng dây khoai', null, 'Đào khoai', 'dig', 200, 265, null, null,
   '[{"id": "root", "name": "Bén rễ", "until_h": 6, "water": [1]}, {"id": "vine", "name": "Bò dây", "until_h": 22, "water": [0, 1]},
     {"id": "tuber", "name": "Tượng củ", "until_h": 36, "water": [0, 1]}, {"id": "bulk", "name": "Củ lớn", "until_h": 48, "water": [0, 1]}]',
   '[0, 1]', 12, 0.02, 48, '[100]', null, 22, 0.03, 0.5,
   '[{"id": "td", "kind": "fert", "name": "Bón thúc nuôi củ", "items": ["fert_potash", "fert_npk"], "half_items": ["fert_urea"],
      "from_h": 16, "to_h": 26, "half_from_h": 6, "half_to_h": 36, "pen_half": 0.10, "pen_missing": 0.20},
     {"id": "lat_day", "kind": "act", "name": "Lật dây", "items": [], "half_items": [],
      "from_h": 24, "to_h": 32, "half_from_h": 32, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.10}]',
   '[{"slot": 1, "kind": "weevil", "name": "Sùng khoai", "from_h": 24, "to_h": 40, "chance": 0.40, "dry_mult": 2, "wet_mult": 1,
      "remedy": "spray_insect"}]'),
  ('bap', 'Bắp', 20, 'direct', 'Gieo hạt bắp', null, 'Bẻ bắp', 'pick', 150, 460, null, null,
   '[{"id": "sprout", "name": "Nảy mầm", "until_h": 6, "water": [1]}, {"id": "leaf", "name": "Ra lá", "until_h": 24, "water": [1, 2]},
     {"id": "knee", "name": "Xoáy nõn", "until_h": 40, "water": [1, 2]},
     {"id": "tassel", "name": "Trổ cờ, phun râu", "until_h": 50, "water": [1, 2]},
     {"id": "fill", "name": "Chắc hạt", "until_h": 60, "water": [0, 1]}]',
   '[0, 1]', 12, 0.02, 48, '[100]', null, null, null, null,
   '[{"id": "td1", "kind": "fert", "name": "Bón thúc lần 1 (3–5 lá)", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"],
      "from_h": 8, "to_h": 16, "half_from_h": 6, "half_to_h": 24, "pen_half": 0.10, "pen_missing": 0.20},
     {"id": "vun_goc", "kind": "act", "name": "Vun gốc", "items": [], "half_items": [],
      "from_h": 16, "to_h": 28, "half_from_h": 28, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.10},
     {"id": "td2", "kind": "fert", "name": "Bón thúc lần 2 (trổ cờ)", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 38, "to_h": 46, "half_from_h": 30, "half_to_h": 50, "pen_half": 0.10, "pen_missing": 0.20}]',
   '[{"slot": 1, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 8, "to_h": 24, "chance": 0.35, "dry_mult": 1, "wet_mult": 1,
      "remedy": "spray_insect"},
     {"slot": 2, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 26, "to_h": 44, "chance": 0.35, "dry_mult": 1, "wet_mult": 1,
      "remedy": "spray_insect"}]'),
  ('ot', 'Ớt', 30, 'nursery', 'Ươm hạt ớt', 'Trồng cây ớt con', 'Hái ớt', 'pick', 60, 1590, 10, 18,
   '[{"id": "root", "name": "Bén rễ", "until_h": 8, "water": [1]}, {"id": "grow", "name": "Phát triển thân lá", "until_h": 22, "water": [1, 2]},
     {"id": "flower", "name": "Ra hoa", "until_h": 34, "water": [1, 2]}, {"id": "fruit", "name": "Đậu trái", "until_h": 46, "water": [1, 2]}]',
   '[0, 1]', 8, 0.03, 24, '[40, 35, 25]', 12, null, null, null,
   '[{"id": "td1", "kind": "fert", "name": "Bón thúc bén rễ", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"],
      "from_h": 4, "to_h": 12, "half_from_h": 0, "half_to_h": 20, "pen_half": 0.08, "pen_missing": 0.15},
     {"id": "td2", "kind": "fert", "name": "Bón thúc ra hoa", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 22, "to_h": 30, "half_from_h": 20, "half_to_h": 40, "pen_half": 0.08, "pen_missing": 0.15},
     {"id": "td3", "kind": "fert", "name": "Bón nuôi trái", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 46, "to_h": 56, "half_from_h": 40, "half_to_h": 64, "pen_half": 0.08, "pen_missing": 0.15}]',
   '[{"slot": 1, "kind": "thrips", "name": "Bọ trĩ", "from_h": 6, "to_h": 24, "chance": 0.40, "dry_mult": 1.5, "wet_mult": 1,
      "remedy": "spray_insect"},
     {"slot": 2, "kind": "anthracnose", "name": "Thán thư", "from_h": 40, "to_h": 64, "chance": 0.40, "dry_mult": 1, "wet_mult": 2,
      "remedy": "spray_fungus"}]')
on conflict (id) do update set
  name = excluded.name, sort_order = excluded.sort_order, method = excluded.method, plant_label = excluded.plant_label,
  transplant_label = excluded.transplant_label, harvest_label = excluded.harvest_label, harvest_anim = excluded.harvest_anim,
  base_kg = excluded.base_kg, price_per_kg = excluded.price_per_kg, nursery_ready_h = excluded.nursery_ready_h,
  nursery_old_h = excluded.nursery_old_h, stages = excluded.stages, ripe_water = excluded.ripe_water,
  ripe_window_h = excluded.ripe_window_h, over_rate = excluded.over_rate, lost_after_h = excluded.lost_after_h,
  pickings = excluded.pickings, pick_gap_h = excluded.pick_gap_h, rot_from_h = excluded.rot_from_h, rot_rate = excluded.rot_rate,
  rot_cap = excluded.rot_cap, cares = excluded.cares, pests = excluded.pests;

-- Hoa-màu seeds are seeds with an upland crop; the sickle and the sprayer are the new kind 'tool' (R20).
alter table public.shop_items add column if not exists upland text references public.upland_crops(id);
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool'));

insert into public.shop_items (id, kind, name, price, starter, sort_order, variety, fert, pest_target, upland) values
  ('seed_khoai',   'seed', 'Dây khoai giống',  800, false, 40, null, null, null, 'khoai'),
  ('seed_bap',     'seed', 'Hạt bắp giống',   1000, false, 50, null, null, null, 'bap'),
  ('seed_ot',      'seed', 'Hạt ớt giống',    1500, false, 60, null, null, null, 'ot'),
  ('tool_sickle',  'tool', 'Liềm',            1500, false, 10, null, null, null, null),
  ('tool_sprayer', 'tool', 'Bình phun',       5000, false, 20, null, null, null, null)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, variety = excluded.variety, fert = excluded.fert, pest_target = excluded.pest_target,
  upland = excluded.upland;

-- The config tables are read-only for the API roles (Supabase's default privileges give them every right on a new table).
revoke insert, update, delete, truncate on public.upland_crops from anon, authenticated;

-- The 0015 reasons plus the harvester rental and the hoa-màu sale (anti-cheat §11.3 rule 4 keeps 'wipe').
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell'));

-- ---------- B. Tables ----------
-- Both kinds share the one crop row per plot (R2).
alter table public.crops add column if not exists kind text not null default 'rice';
alter table public.crops drop constraint if exists crops_kind_check;
alter table public.crops add constraint crops_kind_check check (kind in ('rice', 'upland'));
alter table public.crops add column if not exists upland text references public.upland_crops(id);   -- null until planted
alter table public.crops add column if not exists plant_at timestamptz;                               -- P
alter table public.crops add column if not exists work_log jsonb not null default '[]'::jsonb;        -- [{t, act}]
alter table public.crops add column if not exists harvests jsonb not null default '[]'::jsonb;        -- [{t, k, kg}] pickings
alter table public.crops add column if not exists harvested_parts smallint not null default 0;
alter table public.crops drop constraint if exists crops_parts_check;
alter table public.crops add constraint crops_parts_check check (harvested_parts between 0 and 6);
alter table public.crops add column if not exists harvested_kg integer not null default 0;
alter table public.crops add column if not exists harvester_at timestamptz;
alter table public.crops add column if not exists harvester_until timestamptz;

create table if not exists public.produce_stock (
  account_id uuid not null references public.accounts(id) on delete cascade,
  upland text not null references public.upland_crops(id),
  kg integer not null default 0 check (kg >= 0),
  primary key (account_id, upland)
);
alter table public.produce_stock enable row level security;
revoke all on public.produce_stock from anon, authenticated;

-- The sprayer's tank (R21): empty is (null, 0), loaded is (a pesticide, 1–3).
alter table public.farm_profiles add column if not exists tank_item text references public.shop_items(id);
alter table public.farm_profiles add column if not exists tank_charges smallint not null default 0;
update public.farm_profiles set tank_item = null, tank_charges = 0
 where not ((tank_item is null and tank_charges = 0) or (tank_item is not null and tank_charges between 1 and 3));
alter table public.farm_profiles drop constraint if exists farm_profiles_tank_check;
alter table public.farm_profiles add constraint farm_profiles_tank_check
  check ((tank_item is null and tank_charges = 0) or (tank_item is not null and tank_charges between 1 and 3));

-- ---------- C. The hoa-màu model (private, pure given the time; lib/game/farm/upland.ts mirrors it — spec §8) ----------
-- All arithmetic is double precision, in the same order as the TypeScript mirror (§8.7, R33), so both give the same
-- numbers: tests/fixtures/upland-cases.json pins them.

-- An upland crop's config by id.
create or replace function public._upland(p_id text) returns public.upland_crops
language sql stable security definer set search_path = public, extensions
as $$ select * from public.upland_crops where id = p_id $$;

-- Hours from P to picking k's ripe time: ripe_h (the last stage's until_h) + pick_gap_h·(k − 1).
create or replace function public._up_hours(u public.upland_crops, p_k integer) returns double precision
language sql immutable set search_path = public, extensions
as $$
  select (u.stages -> -1 ->> 'until_h')::double precision
         + coalesce(u.pick_gap_h, 0::double precision) * (p_k - 1)::double precision
$$;

-- R_k: picking k is ready (§8.3). O_k and L_k add ripe_window_h, then lost_after_h.
create or replace function public._up_ready(c public.crops, u public.upland_crops, p_k integer) returns timestamptz
language sql stable set search_path = public, extensions
as $$ select public._plus_h(c.plant_at, public._up_hours(u, p_k)) $$;

-- The next picking at t: the lowest one not yet picked and not lost yet (t < L_k); 0 when none is left (or before P).
create or replace function public._up_next(c public.crops, u public.upland_crops, t timestamptz) returns integer
language sql stable set search_path = public, extensions
as $$
  select coalesce((
    select k from generate_series(1, jsonb_array_length(u.pickings)) k
     where not exists (select 1 from jsonb_array_elements(c.harvests) x where (x->>'k')::int = k)
       and t < public._plus_h(c.plant_at, public._up_hours(u, k) + u.ripe_window_h + u.lost_after_h)
     order by k limit 1), 0)
$$;

-- The phase at t (§8.3): prepared, nursery, a stage id, then waiting / ripe / overripe per picking, and done.
create or replace function public._up_phase(c public.crops, u public.upland_crops, t timestamptz) returns text
language plpgsql stable set search_path = public, extensions
as $$
declare v_start timestamptz := coalesce(c.sow_at, c.plant_at); h double precision; st jsonb; k integer;
begin
  if v_start is null or t < v_start then return 'prepared'; end if;
  if c.plant_at is null or t < c.plant_at then return 'nursery'; end if;
  h := public._hrs(c.plant_at, t);
  for st in select x from jsonb_array_elements(u.stages) x loop
    if h < (st->>'until_h')::double precision then return st->>'id'; end if;
  end loop;
  k := public._up_next(c, u, t);
  if k = 0 then return 'done'; end if;
  if t < public._up_ready(c, u, k) then return 'waiting'; end if;
  if t < public._plus_h(c.plant_at, public._up_hours(u, k) + u.ripe_window_h) then return 'ripe'; end if;
  return 'overripe';
end; $$;

-- Does the water at t suit the crop (§8.4)? {1} in the nursery, the stage's levels, ripe_water from ripe_h on, and
-- anything before the first planting action.
create or replace function public._up_water_ok(c public.crops, u public.upland_crops, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare v_start timestamptz := coalesce(c.sow_at, c.plant_at); h double precision; st jsonb;
        l integer := public._water_at(c.water_log, t);
begin
  if v_start is null or t < v_start then return true; end if;
  if c.plant_at is null or t < c.plant_at then return l = 1; end if;
  h := public._hrs(c.plant_at, t);
  for st in select x from jsonb_array_elements(u.stages) x loop
    if h < (st->>'until_h')::double precision then return (st->'water') @> to_jsonb(l); end if;
  end loop;
  return u.ripe_water @> to_jsonb(l);
end; $$;

-- Off-target water hours from the first planting action until p_until: one sample every 15 minutes, 0.25 h per wrong one.
create or replace function public._up_off_hours(c public.crops, u public.upland_crops, p_until timestamptz)
returns double precision
language sql stable set search_path = public, extensions
as $$
  select case when coalesce(c.sow_at, c.plant_at) is null or p_until <= coalesce(c.sow_at, c.plant_at) then 0::double precision
         else (select count(*) filter (where not public._up_water_ok(c, u, t))
                 from generate_series(coalesce(c.sow_at, c.plant_at), p_until - interval '1 microsecond', interval '15 minutes') t
              )::double precision * 0.25::double precision end
$$;

-- Rot hours (§8.4): 15-minute samples from P + rot_from_h until p_until with the bed at Đẫm or Ngập (level ≥ 2).
create or replace function public._up_rot_hours(c public.crops, u public.upland_crops, p_until timestamptz)
returns double precision
language sql stable set search_path = public, extensions
as $$
  select case when u.rot_from_h is null or c.plant_at is null or p_until <= public._plus_h(c.plant_at, u.rot_from_h)
              then 0::double precision
         else (select count(*) filter (where public._water_at(c.water_log, t) >= 2)
                 from generate_series(public._plus_h(c.plant_at, u.rot_from_h), p_until - interval '1 microsecond',
                                      interval '15 minutes') t)::double precision * 0.25::double precision end
$$;

-- Excess nitrogen by t (§8.5, R23): walking the fert log from P in time order, an N bag (urê, NPK) where no fert care's
-- half region [half_from_h, half_to_h) lists it, or a second N inside one care's half region.
create or replace function public._up_excess_n(c public.crops, u public.upland_crops, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; h double precision; cr jsonb; v_hit text; v_seen text[] := '{}';
begin
  if c.plant_at is null then return false; end if;
  for e in select x from jsonb_array_elements(c.fert_log) with ordinality w(x, n)
            where (x->>'t')::timestamptz >= c.plant_at and (x->>'t')::timestamptz <= t
            order by (x->>'t')::timestamptz, n loop
    if e->>'item' not in ('fert_urea', 'fert_npk') then continue; end if;
    h := public._hrs(c.plant_at, (e->>'t')::timestamptz);
    v_hit := null;
    for cr in select x from jsonb_array_elements(u.cares) x where x->>'kind' = 'fert' loop
      if h >= (cr->>'half_from_h')::double precision and h < (cr->>'half_to_h')::double precision
         and ((cr->'items') ? (e->>'item') or (cr->'half_items') ? (e->>'item')) then
        v_hit := cr->>'id';
        exit;
      end if;
    end loop;
    if v_hit is null or v_hit = any(v_seen) then return true; end if;
    v_seen := v_seen || v_hit;
  end loop;
  return false;
end; $$;

-- Care (§8.5): the base fertilizers before P, then each care row in config order — 0 on time (an items bag, or the act,
-- at T ∈ [from_h, to_h]), pen_half in its half region (an items or half_items bag, or the act, at T ∈ [half_from_h,
-- half_to_h)), else pen_missing; only the best entry counts. {manure, phosphate, scores[], excess}.
create or replace function public._up_care(c public.crops, u public.upland_crops) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; cr jsonb; h double precision; s double precision; v_best double precision; v_fert boolean;
        v_manure boolean := false; v_phos boolean := false; v_scores jsonb := '[]'::jsonb;
begin
  for e in select x from jsonb_array_elements(c.fert_log) x loop
    if c.plant_at is null or (e->>'t')::timestamptz < c.plant_at then
      if e->>'item' = 'fert_manure' then v_manure := true; end if;
      if e->>'item' = 'fert_phosphate' then v_phos := true; end if;
    end if;
  end loop;
  for cr in select x from jsonb_array_elements(u.cares) x loop
    v_best := (cr->>'pen_missing')::double precision;
    v_fert := cr->>'kind' = 'fert';
    if c.plant_at is not null then
      for e in select x from jsonb_array_elements(case when v_fert then c.fert_log else c.work_log end) x loop
        h := public._hrs(c.plant_at, (e->>'t')::timestamptz);
        if v_fert then
          if (cr->'items') ? (e->>'item')
             and h >= (cr->>'from_h')::double precision and h <= (cr->>'to_h')::double precision then
            s := 0;
          elsif ((cr->'items') ? (e->>'item') or (cr->'half_items') ? (e->>'item'))
                and h >= (cr->>'half_from_h')::double precision and h < (cr->>'half_to_h')::double precision then
            s := (cr->>'pen_half')::double precision;
          else
            continue;
          end if;
        else
          if e->>'act' is distinct from cr->>'id' then continue; end if;
          if h >= (cr->>'from_h')::double precision and h <= (cr->>'to_h')::double precision then
            s := 0;
          elsif h >= (cr->>'half_from_h')::double precision and h < (cr->>'half_to_h')::double precision then
            s := (cr->>'pen_half')::double precision;
          else
            continue;
          end if;
        end if;
        v_best := least(v_best, s);
      end loop;
    end if;
    v_scores := v_scores || to_jsonb(v_best);
  end loop;
  return jsonb_build_object('manure', v_manure, 'phosphate', v_phos, 'scores', v_scores,
                            'excess', public._up_excess_n(c, u, 'infinity'::timestamptz));
end; $$;

-- The pests revealed by p_now (§8.6): a slot is due at P + from_h + u_time·(to_h − from_h); its chance at due is ×1.5
-- with excess N by due, × dry_mult on a Khô bed, × wet_mult at Đẫm or more, capped at 0.9; the first spray of its remedy
-- at or after due treats it. [{slot, kind, since, treated_at}]; the rolls never leave the server.
create or replace function public._up_pests(c public.crops, u public.upland_crops, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare r jsonb; pe jsonb; due timestamptz; p double precision; lvl integer; tr timestamptz; v_out jsonb := '[]'::jsonb;
begin
  if c.plant_at is null or c.pest_rolls is null then return v_out; end if;
  for r in select x from jsonb_array_elements(c.pest_rolls) x order by (x->>'slot')::int loop
    select x into pe from jsonb_array_elements(u.pests) x where (x->>'slot')::int = (r->>'slot')::int;
    if pe is null then continue; end if;
    due := public._plus_h(c.plant_at, (pe->>'from_h')::double precision
                          + (r->>'u_time')::double precision
                            * ((pe->>'to_h')::double precision - (pe->>'from_h')::double precision));
    if due > p_now then continue; end if;
    p := (pe->>'chance')::double precision;
    if public._up_excess_n(c, u, due) then p := p * 1.5::double precision; end if;
    lvl := public._water_at(c.water_log, due);
    if lvl = 0 then p := p * (pe->>'dry_mult')::double precision; end if;
    if lvl >= 2 then p := p * (pe->>'wet_mult')::double precision; end if;
    p := least(0.9::double precision, p);
    if (r->>'u_hit')::double precision >= p then continue; end if;
    select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.spray_log) x
     where x->>'item' = pe->>'remedy' and (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', (r->>'slot')::int, 'kind', pe->>'kind', 'since', due,
                                                           'treated_at', tr));
  end loop;
  return v_out;
end; $$;

-- Picking k at p_now in kg (§8.7), with its factors: every factor at the picking time, the products left to right.
create or replace function public._up_yield(c public.crops, u public.upland_crops, p_land double precision, p_k integer,
                                            p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare care jsonb := public._up_care(c, u); s jsonb; pe jsonb; v_pen double precision := 0; v_end timestamptz;
        v_mcare double precision; v_mplant double precision := 1; v_mwater double precision; v_mrot double precision := 1;
        v_mpest double precision := 1; v_mlate double precision; v_x double precision; v_pct integer; v_kg integer;
begin
  if not (care->>'manure')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if not (care->>'phosphate')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  for s in select x from jsonb_array_elements(care->'scores') x loop
    v_pen := v_pen + (s #>> '{}')::double precision;
  end loop;
  if (care->>'excess')::boolean then v_pen := v_pen + 0.10::double precision; end if;
  v_mcare := 1 - v_pen;
  if u.method = 'nursery' then
    v_mplant := 1 - least(0.3::double precision,
                          0.03::double precision * greatest(0::double precision, public._hrs(c.sow_at, c.plant_at) - u.nursery_old_h));
  end if;
  v_mwater := 1 - least(0.2::double precision, 0.01::double precision * public._up_off_hours(c, u, p_now));
  if u.rot_from_h is not null then
    v_mrot := 1 - least(u.rot_cap, u.rot_rate * public._up_rot_hours(c, u, p_now));
  end if;
  for pe in select x from jsonb_array_elements(public._up_pests(c, u, p_now)) x loop
    v_end := coalesce((pe->>'treated_at')::timestamptz, p_now);
    v_mpest := v_mpest * (1 - least(0.3::double precision, 0.015::double precision
               * case when v_end <= (pe->>'since')::timestamptz then 0::double precision
                      else public._hrs((pe->>'since')::timestamptz, v_end) end));
  end loop;
  v_mlate := 1 - least(0.6::double precision, u.over_rate * greatest(0::double precision,
               public._hrs(public._plus_h(c.plant_at, public._up_hours(u, p_k) + u.ripe_window_h), p_now)));
  v_pct := (u.pickings->>(p_k - 1))::int;
  v_x := ((((((((u.base_kg * p_land) * v_mcare) * v_mplant) * v_mwater) * v_mrot) * v_mpest) * v_mlate) * v_pct) / 100;
  v_kg := greatest((u.base_kg * v_pct + 999) / 1000, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mplant', v_mplant, 'mwater', v_mwater, 'mrot', v_mrot,
                            'mpest', v_mpest, 'mlate', v_mlate);
end; $$;

-- Rice part i (1..6) of a plot yielding y kg: floor(i·y/6) − floor((i − 1)·y/6), so six parts sum to y (R5).
create or replace function public._part_kg(p_i integer, p_y integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select (p_i * p_y) / 6 - ((p_i - 1) * p_y) / 6 $$;

-- Hoa-màu kilograms into the account's produce stock.
create or replace function public._produce_add(p_account uuid, p_upland text, p_kg integer) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.produce_stock (account_id, upland, kg) values (p_account, p_upland, p_kg)
  on conflict (account_id, upland) do update set kg = public.produce_stock.kg + excluded.kg
$$;

revoke all on function public._upland(text) from public, anon, authenticated;
revoke all on function public._up_hours(public.upland_crops, integer) from public, anon, authenticated;
revoke all on function public._up_ready(public.crops, public.upland_crops, integer) from public, anon, authenticated;
revoke all on function public._up_next(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_phase(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_water_ok(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_off_hours(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_rot_hours(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_excess_n(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_care(public.crops, public.upland_crops) from public, anon, authenticated;
revoke all on function public._up_pests(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_yield(public.crops, public.upland_crops, double precision, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public._part_kg(integer, integer) from public, anon, authenticated;
revoke all on function public._produce_add(uuid, text, integer) from public, anon, authenticated;
