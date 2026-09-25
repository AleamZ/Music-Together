-- =========================================================
-- 0013_v15_field.sql — v15.1 "Ruộng lúa": the field map's land (village rent, private plots, player sales,
-- subleases, reclaim), the rice cycle (soak → seedbed → transplant → top-dress → water → pests → harvest),
-- drying, selling and the farm shop. Also: the v14 buy_item kind guard and server_now in _fishing_state (M-3).
-- ADDITIVE (no data drop, except section A's one-time reset of an earlier build's v15 state) and re-runnable. Every
-- function relies on `set search_path = public, extensions`.
-- Time rules live in private functions that take p_now; the public RPCs pass now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Config, catalog and account tables ----------
create table if not exists public.rice_varieties (
  id text primary key,
  name text not null,
  scale double precision not null check (scale > 0),
  base_kg integer not null check (base_kg > 0),
  price_per_kg integer not null check (price_per_kg > 0),
  blast_mult double precision not null default 1,
  sort_order integer not null default 0
);
alter table public.rice_varieties enable row level security;
drop policy if exists rice_varieties_select on public.rice_varieties;
create policy rice_varieties_select on public.rice_varieties for select to anon using (true);
grant select on public.rice_varieties to anon, authenticated;

insert into public.rice_varieties (id, name, scale, base_kg, price_per_kg, blast_mult, sort_order) values
  ('short', 'Lúa ngắn ngày', 0.9,  90,  710, 1.0, 10),
  ('nep',   'Nếp',           1.0,  75,  950, 1.0, 20),
  ('thom',  'Lúa thơm',      1.15, 60, 1350, 1.3, 30)
on conflict (id) do update set
  name = excluded.name, scale = excluded.scale, base_kg = excluded.base_kg, price_per_kg = excluded.price_per_kg,
  blast_mult = excluded.blast_mult, sort_order = excluded.sort_order;

-- Farm items share the v14 catalog (and the inventory) with three new columns.
alter table public.shop_items add column if not exists variety text references public.rice_varieties(id);
alter table public.shop_items add column if not exists fert text check (fert in ('manure','phosphate','urea','potash','npk'));
alter table public.shop_items add column if not exists pest_target text check (pest_target in ('insect','hopper','fungus'));
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box'));

-- A database that ran an earlier build of this file (a demo) sells seed_short at 60 xu. Its v15 state was bought and
-- grown at the old prices (economy spec §3), so it starts over before the new prices go in: land, leases, offers, crops,
-- drying batches, rice, gifts and farm items. The plots come back on the next field open, and the gift can be claimed
-- again. Xu and everything else stay.
do $$
begin
  if to_regclass('public.field_plots') is not null
     and exists (select 1 from public.shop_items where id = 'seed_short' and price = 60) then
    truncate public.field_plots, public.plot_leases, public.land_offers, public.crops, public.drying_slots,
             public.rice_stock, public.farm_profiles cascade;
    delete from public.inventory i using public.shop_items s
     where s.id = i.item_id and s.kind in ('seed', 'fertilizer', 'pesticide', 'critter_box');
  end if;
end $$;

insert into public.shop_items (id, kind, name, price, starter, sort_order, variety, fert, pest_target) values
  ('seed_short',     'seed',       'Giống lúa ngắn ngày', 600, false, 10, 'short', null,        null),
  ('seed_nep',       'seed',       'Giống nếp',           900, false, 20, 'nep',   null,        null),
  ('seed_thom',      'seed',       'Giống lúa thơm',     1500, false, 30, 'thom',  null,        null),
  ('fert_manure',    'fertilizer', 'Phân chuồng hoai',    400, false, 10, null,    'manure',    null),
  ('fert_phosphate', 'fertilizer', 'Phân lân',            500, false, 20, null,    'phosphate', null),
  ('fert_urea',      'fertilizer', 'Phân urê',            600, false, 30, null,    'urea',      null),
  ('fert_potash',    'fertilizer', 'Phân kali',           600, false, 40, null,    'potash',    null),
  ('fert_npk',       'fertilizer', 'Phân NPK',            900, false, 50, null,    'npk',       null),
  ('spray_insect',   'pesticide',  'Thuốc trừ sâu',       700, false, 10, null,    null,        'insect'),
  ('spray_hopper',   'pesticide',  'Thuốc trừ rầy',       800, false, 20, null,    null,        'hopper'),
  ('spray_fungus',   'pesticide',  'Thuốc trừ bệnh',      900, false, 30, null,    null,        'fungus')
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, variety = excluded.variety, fert = excluded.fert, pest_target = excluded.pest_target;

-- The config tables are read-only for the API roles. Supabase's default privileges give them every right on a new table,
-- and TRUNCATE ignores RLS. Select stays.
revoke insert, update, delete, truncate on public.rice_varieties, public.shop_items from anon, authenticated;

alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell'));

-- "Visiting the room" for the 14-day reclaim (set by touch_room and every field call; null = joined_at).
alter table public.members add column if not exists last_seen_at timestamptz;

-- ---------- B. Field tables (private: RLS on, no policies — only the RPCs touch them) ----------
create table if not exists public.field_plots (
  room_id uuid not null references public.rooms(id) on delete cascade,
  plot_no smallint not null check (plot_no between 1 and 10),
  kind text not null check (kind in ('private','village')),
  owner_id uuid references public.accounts(id) on delete set null,
  owned_at timestamptz,
  sale_price integer check (sale_price between 1 and 5000000),
  sublease_price integer check (sublease_price between 1 and 100000),
  primary key (room_id, plot_no)
);
create table if not exists public.plot_leases (                  -- at most one active lease per plot
  room_id uuid not null,
  plot_no smallint not null,
  farmer_id uuid not null references public.accounts(id) on delete cascade,
  source text not null check (source in ('village','owner')),
  price integer not null check (price >= 0),
  starts_at timestamptz not null,
  until timestamptz not null,
  primary key (room_id, plot_no),
  foreign key (room_id, plot_no) references public.field_plots(room_id, plot_no) on delete cascade
);
create table if not exists public.land_offers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  plot_no smallint not null,
  buyer_id uuid not null references public.accounts(id) on delete cascade,
  price integer not null check (price between 1 and 5000000),
  created_at timestamptz not null,
  unique (room_id, plot_no, buyer_id),
  foreign key (room_id, plot_no) references public.field_plots(room_id, plot_no) on delete cascade
);
-- The price caps (economy spec §3.1), re-created by name so that running this file again moves an existing database too.
alter table public.field_plots drop constraint if exists field_plots_sale_price_check;
alter table public.field_plots add constraint field_plots_sale_price_check check (sale_price between 1 and 5000000);
alter table public.field_plots drop constraint if exists field_plots_sublease_price_check;
alter table public.field_plots add constraint field_plots_sublease_price_check check (sublease_price between 1 and 100000);
alter table public.land_offers drop constraint if exists land_offers_price_check;
alter table public.land_offers add constraint land_offers_price_check check (price between 1 and 5000000);
create table if not exists public.crops (                        -- one crop per plot, from "làm đất" or soaking to harvest
  room_id uuid not null,
  plot_no smallint not null,
  farmer_id uuid not null references public.accounts(id) on delete cascade,
  variety text references public.rice_varieties(id),
  prepared_at timestamptz,                                      -- null while the seed soaks before "làm đất"
  soak_at timestamptz,
  sow_at timestamptz,
  transplant_at timestamptz,
  q_transplant double precision not null default 1,
  water_log jsonb not null default '[]'::jsonb,                 -- [{t, l}] level set at t (0 khô … 3 sâu)
  fert_log jsonb not null default '[]'::jsonb,                  -- [{t, item}]
  spray_log jsonb not null default '[]'::jsonb,                 -- [{t, item}]
  picks jsonb not null default '[]'::jsonb,                     -- [{t}] golden apple snails picked
  pest_rolls jsonb,                                             -- secret: [{slot, u_time, u_kind, u_hit}] rolled at sowing
  rotted_at timestamptz,                                        -- the last soaked seed rotted unsown
  work text check (work in ('transplant','harvest')),
  work_started_at timestamptz,
  primary key (room_id, plot_no),
  foreign key (room_id, plot_no) references public.field_plots(room_id, plot_no) on delete cascade
);
create table if not exists public.drying_slots (
  room_id uuid not null references public.rooms(id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  account_id uuid not null references public.accounts(id) on delete cascade,
  variety text not null references public.rice_varieties(id),
  kg integer not null check (kg > 0),
  ready_at timestamptz not null,
  primary key (room_id, slot)
);
create table if not exists public.rice_stock (
  account_id uuid not null references public.accounts(id) on delete cascade,
  variety text not null references public.rice_varieties(id),
  wet_kg integer not null default 0 check (wet_kg >= 0),
  dry_kg integer not null default 0 check (dry_kg >= 0),
  primary key (account_id, variety)
);
create table if not exists public.farm_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  gift_at timestamptz
);
alter table public.field_plots enable row level security;
alter table public.plot_leases enable row level security;
alter table public.land_offers enable row level security;
alter table public.crops enable row level security;
alter table public.drying_slots enable row level security;
alter table public.rice_stock enable row level security;
alter table public.farm_profiles enable row level security;
revoke all on public.field_plots, public.plot_leases, public.land_offers, public.crops, public.drying_slots,
              public.rice_stock, public.farm_profiles
  from anon, authenticated;

-- ---------- C. v14 changes: the fishing shop sells fishing gear only; the fishing state carries server_now ----------
create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null or it.kind not in ('rod','bobber','bait','bait_box','bucket') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind = 'bait' then
    if p_qty is null or p_qty < 1 or p_qty > 99 then
      raise exception 'invalid quantity' using errcode = '22023';
    end if;
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
    if p_qty is distinct from 1 then
      raise exception 'invalid quantity' using errcode = '22023';
    end if;
    if public._owns(v_account, it.id)
       or (it.kind = 'bait_box' and public._bait_cap(v_account) >= it.capacity)
       or (it.kind = 'bucket' and public._bucket_cap(v_account) >= it.capacity) then
      raise exception 'already owned' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, 1)
    on conflict (account_id, item_id) do update set qty = 1;
    -- a better rod / bobber (by price; starter = 0) is equipped right away
    if it.kind in ('rod', 'bobber') then
      select coalesce(price, 0) into v_equipped from public.shop_items where id = case when it.kind = 'rod' then p.rod else p.bobber end;
      if it.price > coalesce(v_equipped, 0) then
        if it.kind = 'rod' then
          update public.fishing_profiles set rod = it.id where account_id = v_account;
        else
          update public.fishing_profiles set bobber = it.id where account_id = v_account;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

-- Everything the client shows about the account's fishing (v14 spec §8.2), plus server_now (v15 §11.6). Farm items
-- live in the same inventory, so "owned" lists fishing gear only.
create or replace function public._fishing_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare w public.wallets; p public.fishing_profiles; v_resets timestamptz; v_left integer; v_dig timestamptz;
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
  return jsonb_build_object(
    'coins', coalesce(w.coins, 0),
    'daily_claimed', coalesce(w.daily_on = public._vn_today(), false),
    'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', coalesce(p.bobber, 'bobber_feather'),
                                  'bait', coalesce(p.bait, 'bait_worm')),
    'owned', coalesce((select jsonb_agg(i.item_id order by s.kind, s.sort_order)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1 and s.kind in ('rod','bobber','bait_box','bucket')),
                      '[]'::jsonb),
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
    'server_now', now()
  );
end; $$;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- ---------- D. The crop model (private, pure given the time; lib/game/farm/crop.ts mirrors it — spec §8) ----------
-- All arithmetic is double precision, in the same order as the TypeScript mirror, so both give the same numbers
-- (tests/fixtures/crop-cases.json pins them).

-- A variety by id.
create or replace function public._variety(p_id text) returns public.rice_varieties
language sql stable security definer set search_path = public, extensions
as $$ select * from public.rice_varieties where id = p_id $$;

-- Hours from a to b.
create or replace function public._hrs(a timestamptz, b timestamptz) returns double precision
language sql immutable set search_path = public, extensions
as $$ select extract(epoch from (b - a))::double precision / 3600 $$;

-- t plus h hours, cut to whole seconds.
create or replace function public._plus_h(t timestamptz, h double precision) returns timestamptz
language sql stable set search_path = public, extensions
as $$ select t + make_interval(secs => floor(h * 3600)) $$;

-- The water level at t (§8.3): the last level set at or before t, one level lower per full 12 h since, never below 0.
create or replace function public._water_at(p_log jsonb, p_t timestamptz) returns integer
language sql stable set search_path = public, extensions
as $$
  select coalesce((
    select greatest(0, (e.x->>'l')::int - floor(public._hrs((e.x->>'t')::timestamptz, p_t) / 12)::int)
      from jsonb_array_elements(p_log) with ordinality as e(x, n)
     where (e.x->>'t')::timestamptz <= p_t
     order by (e.x->>'t')::timestamptz desc, e.n desc
     limit 1), 0)
$$;

-- The crop's phase at t (§8.2). Before transplanting the phase needs no variety.
create or replace function public._crop_phase(c public.crops, v public.rice_varieties, t timestamptz) returns text
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; h double precision;
begin
  if c.transplant_at is null or t < c.transplant_at then
    if c.sow_at is not null and t >= c.sow_at then return 'seedling'; end if;
    if c.soak_at is not null and t >= c.soak_at then
      return case when public._hrs(c.soak_at, t) < 2 then 'soaking' else 'sprouted' end;
    end if;
    return 'prepared';
  end if;
  h := public._hrs(c.transplant_at, t);
  if h < 18 * s then return 'tillering'; end if;
  if h < 30 * s then return 'panicle'; end if;
  if h < 40 * s then return 'heading'; end if;
  if h < 48 * s then return 'ripening'; end if;
  if h < 48 * s + 12 then return 'ripe'; end if;
  return 'overripe';
end; $$;

-- Does the water level at t suit the phase (§8.3)? Phases before sowing accept anything.
create or replace function public._water_ok(c public.crops, v public.rice_varieties, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare ph text := public._crop_phase(c, v, t); l integer := public._water_at(c.water_log, t);
begin
  if ph = 'seedling' then return l = 1; end if;
  if ph = 'tillering' then
    if public._hrs(c.transplant_at, t) < 14 * v.scale then return l = 2; end if;
    return l <= 2;
  end if;
  if ph in ('panicle', 'heading') then return l >= 2; end if;
  if ph in ('ripening', 'ripe', 'overripe') then return l <= 1; end if;
  return true;
end; $$;

-- Off-target water hours from sowing until p_until: one sample every 15 minutes, 0.25 h per wrong sample.
create or replace function public._water_off_hours(c public.crops, v public.rice_varieties, p_until timestamptz)
returns double precision
language sql stable set search_path = public, extensions
as $$
  select case when c.sow_at is null or p_until <= c.sow_at then 0::double precision
         else (select count(*) filter (where not public._water_ok(c, v, t))
                 from generate_series(c.sow_at, p_until - interval '1 microsecond', interval '15 minutes') t)::double precision
              * 0.25::double precision end
$$;

-- Excess nitrogen by t (§8.4): urea in panicle, a second N inside tillering or inside panicle, or any N from heading on.
create or replace function public._excess_n(c public.crops, v public.rice_varieties, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; ph text; v_till integer := 0; v_pan integer := 0;
begin
  for e in select x from jsonb_array_elements(c.fert_log) x where (x->>'t')::timestamptz <= t loop
    if e->>'item' not in ('fert_urea', 'fert_npk') then continue; end if;
    ph := public._crop_phase(c, v, (e->>'t')::timestamptz);
    if ph = 'tillering' then
      v_till := v_till + 1;
    elsif ph = 'panicle' then
      if e->>'item' = 'fert_urea' then return true; end if;
      v_pan := v_pan + 1;
    elsif ph in ('heading', 'ripening', 'ripe', 'overripe') then
      return true;
    end if;
  end loop;
  return v_till >= 2 or v_pan >= 2;
end; $$;

-- Fertilizer and drainage scores (§8.4, §8.6): the base fertilizers, both top-dresses (0 on time / 0.10 half /
-- 0.20 missing; only the best application counts), phơi ruộng (water ≤ 1 at T = 18·s) and excess N.
create or replace function public._crop_care(c public.crops, v public.rice_varieties) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; e jsonb; t timestamptz; it text; ph text; h double precision;
        v_manure boolean := false; v_phos boolean := false; v_td1 double precision := 0.20; v_td2 double precision := 0.20;
        v_phoi boolean := false;
begin
  for e in select x from jsonb_array_elements(c.fert_log) x loop
    t := (e->>'t')::timestamptz;
    it := e->>'item';
    if c.transplant_at is null or t < c.transplant_at then
      if it = 'fert_manure' then v_manure := true; end if;
      if it = 'fert_phosphate' then v_phos := true; end if;
      continue;
    end if;
    ph := public._crop_phase(c, v, t);
    h := public._hrs(c.transplant_at, t);
    if ph = 'tillering' then
      if it in ('fert_urea', 'fert_npk') and h >= 2 * s and h <= 10 * s then
        v_td1 := 0;
      elsif it in ('fert_urea', 'fert_npk', 'fert_potash') then
        v_td1 := least(v_td1, 0.10::double precision);
      end if;
    elsif ph = 'panicle' then
      if it in ('fert_potash', 'fert_npk') and h >= 18 * s and h <= 24 * s then
        v_td2 := 0;
      elsif it in ('fert_potash', 'fert_npk', 'fert_urea') then
        v_td2 := least(v_td2, 0.10::double precision);
      end if;
    end if;
  end loop;
  if c.transplant_at is not null then
    v_phoi := public._water_at(c.water_log, public._plus_h(c.transplant_at, 18 * s)) <= 1;
  end if;
  return jsonb_build_object('manure', v_manure, 'phosphate', v_phos, 'td1', v_td1, 'td2', v_td2, 'phoi', v_phoi,
                            'excess', public._excess_n(c, v, 'infinity'::timestamptz));
end; $$;

-- The pests revealed by p_now (§8.5): the hits whose due time has passed, [{slot, kind, since, treated_at}].
create or replace function public._crop_pests(c public.crops, v public.rice_varieties, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; r jsonb; v_slot integer; u double precision; due timestamptz; p double precision;
        lvl integer; v_kind text; v_remedy text; tr timestamptz; v_out jsonb := '[]'::jsonb;
begin
  if c.transplant_at is null or c.pest_rolls is null then return v_out; end if;
  for r in select x from jsonb_array_elements(c.pest_rolls) x order by (x->>'slot')::int loop
    v_slot := (r->>'slot')::int;
    u := (r->>'u_time')::double precision;
    if v_slot = 1 then
      due := public._plus_h(c.transplant_at, u * 8 * s);
    elsif v_slot = 2 then
      due := public._plus_h(c.transplant_at, 6 * s + u * 20 * s);
    else
      due := public._plus_h(c.transplant_at, 20 * s + u * 18 * s);
    end if;
    if due > p_now then continue; end if;
    if v_slot = 1 then
      lvl := public._water_at(c.water_log, due);
      p := least(0.7::double precision,
                 0.35::double precision * (case when lvl = 3 then 2 when lvl <= 1 then 0 else 1 end));
      v_kind := 'snail';
    else
      p := case when v_slot = 2 then 0.45::double precision else 0.40::double precision end;
      if public._excess_n(c, v, due) then p := p * 1.5::double precision; end if;
      p := least(0.9::double precision, p);
      if (r->>'u_kind')::double precision < 0.4 * v.blast_mult then
        v_kind := case when v_slot = 2 then 'leaf_blast' else 'neck_blast' end;
      else
        v_kind := case when v_slot = 2 then 'leaf_folder' else 'hopper' end;
      end if;
    end if;
    if (r->>'u_hit')::double precision >= p then continue; end if;
    if v_kind = 'snail' then
      select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.picks) x
       where (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    else
      v_remedy := case v_kind when 'leaf_folder' then 'spray_insect' when 'hopper' then 'spray_hopper' else 'spray_fungus' end;
      select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.spray_log) x
       where x->>'item' = v_remedy and (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', v_slot, 'kind', v_kind, 'since', due, 'treated_at', tr));
  end loop;
  return v_out;
end; $$;

-- A pest's damaging hours until it was treated or p_until (§8.5). Snails only count 15-minute samples with water ≥ 2.
create or replace function public._pest_hours(c public.crops, p_pest jsonb, p_until timestamptz) returns double precision
language plpgsql stable set search_path = public, extensions
as $$
declare v_since timestamptz := (p_pest->>'since')::timestamptz;
        v_end timestamptz := coalesce((p_pest->>'treated_at')::timestamptz, p_until);
begin
  if v_end <= v_since then return 0; end if;
  if p_pest->>'kind' = 'snail' then
    return (select count(*) from generate_series(v_since, v_end - interval '1 microsecond', interval '15 minutes') t
             where public._water_at(c.water_log, t) >= 2)::double precision * 0.25::double precision;
  end if;
  return public._hrs(v_since, v_end);
end; $$;

-- The harvest in kg (§8.6), with its factors for tests and the plot panel.
create or replace function public._crop_yield(c public.crops, v public.rice_varieties, p_land double precision,
                                              p_qh double precision, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; care jsonb := public._crop_care(c, v); pe jsonb; v_pen double precision := 0;
        v_mcare double precision; v_mseed double precision; v_mwater double precision; v_mpest double precision := 1;
        v_mlate double precision; v_x double precision; v_kg integer;
begin
  if not (care->>'manure')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if not (care->>'phosphate')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  v_pen := v_pen + (care->>'td1')::double precision;
  v_pen := v_pen + (care->>'td2')::double precision;
  if not (care->>'phoi')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if (care->>'excess')::boolean then v_pen := v_pen + 0.10::double precision; end if;
  v_mcare := 1 - v_pen;
  v_mseed := 1 - least(0.3::double precision, 0.03 * greatest(0::double precision, public._hrs(c.soak_at, c.sow_at) - 8))
               - least(0.3::double precision, 0.03 * greatest(0::double precision, public._hrs(c.sow_at, c.transplant_at) - 14 * s));
  v_mwater := 1 - least(0.2::double precision, 0.01 * public._water_off_hours(c, v, p_now));
  for pe in select x from jsonb_array_elements(public._crop_pests(c, v, p_now)) x loop
    v_mpest := v_mpest * (1 - least(0.3::double precision, 0.015 * public._pest_hours(c, pe, p_now)));
  end loop;
  v_mlate := 1 - least(0.6::double precision,
                       0.02 * greatest(0::double precision, public._hrs(c.transplant_at, p_now) - (48 * s + 12)));
  v_x := v.base_kg * p_land * v_mcare * v_mseed * v_mwater * v_mpest * v_mlate * c.q_transplant * p_qh;
  v_kg := greatest((v.base_kg + 9) / 10, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mseed', v_mseed, 'mwater', v_mwater, 'mpest', v_mpest,
                            'mlate', v_mlate);
end; $$;

revoke all on function public._variety(text) from public, anon, authenticated;
revoke all on function public._hrs(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._plus_h(timestamptz, double precision) from public, anon, authenticated;
revoke all on function public._water_at(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._crop_phase(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._water_ok(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._water_off_hours(public.crops, public.rice_varieties, timestamptz)
  from public, anon, authenticated;
revoke all on function public._excess_n(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._crop_care(public.crops, public.rice_varieties) from public, anon, authenticated;
revoke all on function public._crop_pests(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._pest_hours(public.crops, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._crop_yield(public.crops, public.rice_varieties, double precision, double precision, timestamptz)
  from public, anon, authenticated;

-- ---------- E. The field: plots, farmers, the sweep and the views (spec §7, §11.5) ----------
-- The caller's account for a field call. It also records the visit for the 14-day reclaim (§7.5) — at most once an
-- hour, because members is in the realtime publication and every update there makes the room's clients refetch.
create or replace function public._farm_auth(p_room_id uuid, p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  select account_id into v_account from public.members where id = v_member;
  update public.members set last_seen_at = now()
   where id = v_member and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  return v_account;
end; $$;

-- The room's 10 plots, created the first time its field opens: 1–4 private, 5–10 village.
create or replace function public._field_init(p_room uuid) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.field_plots (room_id, plot_no, kind)
  select p_room, n, case when n <= 4 then 'private' else 'village' end from generate_series(1, 10) n
  on conflict (room_id, plot_no) do nothing
$$;

-- The farmer of a plot (§7.1): the holder of an active lease, else the owner of a private plot, else nobody.
create or replace function public._farmer(p_room uuid, p_plot integer, p_now timestamptz) returns uuid
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(
    (select pl.farmer_id from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = p_plot and pl.until > p_now),
    (select fp.owner_id from public.field_plots fp where fp.room_id = p_room and fp.plot_no = p_plot and fp.kind = 'private'))
$$;

-- How many plots of the room the account farms (the limit is 2).
create or replace function public._farm_count(p_room uuid, p_account uuid, p_now timestamptz) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select count(*)::int from public.field_plots fp
   where fp.room_id = p_room and public._farmer(p_room, fp.plot_no, p_now) = p_account
$$;

create or replace function public._plot_row(p_room uuid, p_plot integer) returns public.field_plots
language plpgsql stable security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  select * into f from public.field_plots where room_id = p_room and plot_no = p_plot;
  if not found then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  return f;
end; $$;

create or replace function public._leased(p_room uuid, p_plot integer, p_now timestamptz) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = p_plot and pl.until > p_now) $$;

create or replace function public._has_crop(p_room uuid, p_plot integer) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.crops cr where cr.room_id = p_room and cr.plot_no = p_plot) $$;

create or replace function public._owns_land(p_room uuid, p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.field_plots fp where fp.room_id = p_room and fp.owner_id = p_account) $$;

-- Wet and dry kilograms into the account's rice stock.
create or replace function public._rice_add(p_account uuid, p_variety text, p_wet integer, p_dry integer) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (p_account, p_variety, p_wet, p_dry)
  on conflict (account_id, variety) do update
    set wet_kg = public.rice_stock.wet_kg + excluded.wet_kg, dry_kg = public.rice_stock.dry_kg + excluded.dry_kg
$$;

-- The lazy clock of a room's field (§7.7). Idempotent; runs under the plot locks taken by _field_open.
create or replace function public._field_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots; d public.drying_slots;
begin
  -- 1. leases end (the leaseholder's crop goes in step 4)
  delete from public.plot_leases where room_id = p_room and until <= p_now;
  -- 2. offers expire after 24 h
  delete from public.land_offers where room_id = p_room and created_at <= p_now - interval '24 hours';
  -- 3. reclaim: the owner left the room or has not visited it for 14 days, and the plot is not leased out (§7.6)
  for f in select fp.* from public.field_plots fp
            where fp.room_id = p_room and fp.owner_id is not null
              and not exists (select 1 from public.members m
                               where m.room_id = p_room and m.account_id = fp.owner_id
                                 and coalesce(m.last_seen_at, m.joined_at) > p_now - interval '14 days')
              and not exists (select 1 from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = fp.plot_no)
            order by fp.plot_no loop
    update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
     where room_id = p_room and plot_no = f.plot_no;
    delete from public.land_offers where room_id = p_room and plot_no = f.plot_no;
    perform public._wallet_lock(f.owner_id);
    perform public._pay(f.owner_id, 400000, 'land_refund', 'plot ' || f.plot_no);
  end loop;
  -- 4. a crop belongs to the plot's farmer: a crop left by an ended lease or a reclaim is lost
  delete from public.crops cr
   where cr.room_id = p_room and cr.farmer_id is distinct from public._farmer(p_room, cr.plot_no, p_now);
  -- 5. sprouted seed not sown 24 h after sprouting (soak + 26 h) rots: the plot goes back to prepared, or to bare
  delete from public.crops
   where room_id = p_room and sow_at is null and prepared_at is null and p_now >= soak_at + interval '26 hours';
  update public.crops set rotted_at = soak_at + interval '26 hours', soak_at = null, variety = null
   where room_id = p_room and sow_at is null and p_now >= soak_at + interval '26 hours';
  -- 6. rice left 48 h after its ripe window has all fallen
  delete from public.crops cr using public.rice_varieties rv
   where cr.room_id = p_room and rv.id = cr.variety and cr.transplant_at is not null
     and p_now >= public._plus_h(cr.transplant_at, 48 * rv.scale + 60);
  -- 7. a drying batch left 24 h after it is ready is collected for its owner
  for d in delete from public.drying_slots where room_id = p_room and ready_at <= p_now - interval '24 hours' returning * loop
    perform public._rice_add(d.account_id, d.variety, 0, d.kg);
  end loop;
end; $$;

-- Every field call starts here: create the plots if needed, lock them (one field call per room at a time — before
-- any wallet lock, so a sale that pays the other party cannot deadlock with that party's own field call), sweep.
create or replace function public._field_open(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_init(p_room);
  perform 1 from public.field_plots where room_id = p_room order by plot_no for update;
  perform public._field_sweep(p_room, p_now);
end; $$;

-- {id, name} of an account, or null.
create or replace function public._who(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$ select jsonb_build_object('id', a.id, 'name', a.username) from public.accounts a where a.id = p_account $$;

-- The account's farm belongings (the room-free part of field_state.mine).
create or replace function public._farm_mine(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty order by i.item_id)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('seed','fertilizer','pesticide','critter_box')), '{}'::jsonb),
    'rice', coalesce((select jsonb_object_agg(rs.variety, jsonb_build_object('wet', rs.wet_kg, 'dry', rs.dry_kg) order by rs.variety)
                        from public.rice_stock rs where rs.account_id = p_account and (rs.wet_kg > 0 or rs.dry_kg > 0)),
                     '{}'::jsonb),
    'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0),
    'gift_claimed', exists (select 1 from public.farm_profiles pr where pr.account_id = p_account and pr.gift_at is not null))
$$;

-- One plot as everyone sees it; its farmer also gets the crop's logs (§11.5). The pest rolls never leave the server.
create or replace function public._plot_view(p_room uuid, p_plot integer, p_viewer uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare f public.field_plots; l public.plot_leases; c public.crops; v public.rice_varieties; v_phase text;
        v_crop jsonb := null;
begin
  select * into f from public.field_plots where room_id = p_room and plot_no = p_plot;
  select * into l from public.plot_leases where room_id = p_room and plot_no = p_plot and until > p_now;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if found then
    select * into v from public.rice_varieties where id = c.variety;
    v_phase := public._crop_phase(c, v, p_now);
    v_crop := jsonb_build_object(
      'variety', c.variety, 'phase', v_phase,
      'prepared_at', c.prepared_at, 'soak_at', c.soak_at, 'sow_at', c.sow_at, 'transplant_at', c.transplant_at,
      'water', public._water_at(c.water_log, p_now),
      'water_set_at', (select max((x->>'t')::timestamptz) from jsonb_array_elements(c.water_log) x
                        where (x->>'t')::timestamptz <= p_now),
      'pests', (select coalesce(jsonb_agg(jsonb_build_object('kind', x->'kind', 'since', x->'since', 'treated_at', x->'treated_at')
                                          order by (x->>'slot')::int), '[]'::jsonb)
                  from jsonb_array_elements(public._crop_pests(c, v, p_now)) x),
      'excess_n', public._excess_n(c, v, p_now),
      'ripe', v_phase in ('ripe', 'overripe'),
      'rotted_at', c.rotted_at);
    if p_viewer = c.farmer_id then
      v_crop := v_crop || jsonb_build_object('log', jsonb_build_object(
        'water', c.water_log, 'fert', c.fert_log, 'spray', c.spray_log, 'picks', c.picks, 'q_transplant', c.q_transplant));
    end if;
  end if;
  return jsonb_build_object(
    'no', f.plot_no, 'kind', f.kind, 'owner', public._who(f.owner_id),
    'sale_price', f.sale_price, 'sublease_price', f.sublease_price,
    'farmer', public._who(public._farmer(p_room, p_plot, p_now)),
    'lease', case when l.room_id is null then null
                  else jsonb_build_object('source', l.source, 'until', l.until, 'price', l.price) end,
    'offers', (select count(*) from public.land_offers lo where lo.room_id = p_room and lo.plot_no = p_plot),
    'crop', v_crop);
end; $$;

-- The whole field_state answer (§11.5).
create or replace function public._field_view(p_room uuid, p_viewer uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now,
    'plots', (select jsonb_agg(public._plot_view(p_room, fp.plot_no, p_viewer, p_now) order by fp.plot_no)
                from public.field_plots fp where fp.room_id = p_room),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('slot', ds.slot, 'owner', public._who(ds.account_id),
                                                            'variety', ds.variety, 'kg', ds.kg, 'ready_at', ds.ready_at)
                                         order by ds.slot)
                          from public.drying_slots ds where ds.room_id = p_room), '[]'::jsonb),
    'mine', public._farm_mine(p_viewer) || jsonb_build_object(
      'owned_plot', (select fp.plot_no from public.field_plots fp where fp.room_id = p_room and fp.owner_id = p_viewer
                      order by fp.plot_no limit 1),
      'farming', coalesce((select jsonb_agg(fp.plot_no order by fp.plot_no) from public.field_plots fp
                            where fp.room_id = p_room and public._farmer(p_room, fp.plot_no, p_now) = p_viewer), '[]'::jsonb),
      'my_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no, 'price', lo.price,
                                                               'expires_at', lo.created_at + interval '24 hours')
                                              order by lo.created_at, lo.id)
                              from public.land_offers lo where lo.room_id = p_room and lo.buyer_id = p_viewer), '[]'::jsonb),
      'incoming_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no,
                                                                     'buyer', public._who(lo.buyer_id), 'price', lo.price,
                                                                     'expires_at', lo.created_at + interval '24 hours')
                                                    order by lo.plot_no, lo.price desc, lo.id)
                                    from public.land_offers lo
                                    join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
                                   where lo.room_id = p_room and fp.owner_id = p_viewer), '[]'::jsonb)))
$$;

revoke all on function public._farm_auth(uuid, text) from public, anon, authenticated;
revoke all on function public._field_init(uuid) from public, anon, authenticated;
revoke all on function public._farmer(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_count(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._plot_row(uuid, integer) from public, anon, authenticated;
revoke all on function public._leased(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._has_crop(uuid, integer) from public, anon, authenticated;
revoke all on function public._owns_land(uuid, uuid) from public, anon, authenticated;
revoke all on function public._rice_add(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public._field_sweep(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._field_open(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._who(uuid) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
revoke all on function public._plot_view(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._field_view(uuid, uuid, timestamptz) from public, anon, authenticated;

-- The room page calls this once when it opens (§7.5).
create or replace function public.touch_room(p_room_id uuid, p_session_token text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._farm_auth(p_room_id, p_session_token);
end; $$;

create or replace function public.field_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  perform public._field_open(p_room_id, now());
  return public._field_view(p_room_id, v_account, now());
end; $$;

grant execute on function public.touch_room(uuid, text) to anon, authenticated;
grant execute on function public.field_state(uuid, text) to anon, authenticated;

-- ---------- F. Land (spec §7). Each _farm_do_* takes p_now; its public RPC below passes now(). ----------
-- A player-to-player sale (§7.3): pay, hand over, clear the listing and the offers, announce it in the room's chat.
create or replace function public._land_sale(p_room uuid, p_plot integer, p_buyer uuid, p_price integer, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seller uuid;
begin
  select owner_id into v_seller from public.field_plots where room_id = p_room and plot_no = p_plot;
  perform public._wallet_lock(p_buyer);
  perform public._wallet_lock(v_seller);
  perform public._pay(p_buyer, -p_price, 'land_buy', 'plot ' || p_plot);
  perform public._pay(v_seller, p_price, 'land_sell', 'plot ' || p_plot);
  update public.field_plots set owner_id = p_buyer, owned_at = p_now, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  insert into public.chat_messages (room_id, account_id, username, body)
  values (p_room, null, 'Hợp tác xã',
          format('[land:%s] 🏡 %s đã mua thửa %s của %s với giá %s xu.', p_plot,
                 (select username from public.accounts where id = p_buyer), p_plot,
                 (select username from public.accounts where id = v_seller),
                 replace(to_char(p_price, 'FM9,999,999'), ',', '.')));
  delete from public.chat_messages
   where room_id = p_room
     and id not in (select id from public.chat_messages where room_id = p_room order by created_at desc limit 200);
end; $$;

-- Rent a free village plot for one season: 10 000 xu to the village, 96 h (§7.2).
create or replace function public._farm_do_rent(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.kind <> 'village' then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'plot taken' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < 10000 then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(p_account, -10000, 'rent', 'plot ' || p_plot);
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (p_room, p_plot, p_account, 'village', 10000, p_now, p_now + interval '96 hours');
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Buy an ownerless private plot from the village for 800 000 xu; one private plot per room (§7.3).
create or replace function public._farm_do_buy_plot(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.kind <> 'private' or f.owner_id is not null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'leased' using errcode = '22023';
  end if;
  if public._owns_land(p_room, p_account) then
    raise exception 'already own land' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < 800000 then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(p_account, -800000, 'land_buy', 'plot ' || p_plot);
  update public.field_plots set owner_id = p_account, owned_at = p_now, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Sell your plot back to the village for 400 000 xu. A plot on lease goes to the village when the lease ends (§7.3).
create or replace function public._farm_do_sell_to_village(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if exists (select 1 from public.crops cr where cr.room_id = p_room and cr.plot_no = p_plot and cr.farmer_id = p_account) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  perform public._pay(p_account, 400000, 'land_sell', 'plot ' || p_plot || ' to the village');
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- List your bare, unleased plot for sale at 1–5 000 000 xu; null withdraws the listing (§7.3).
create or replace function public._farm_do_list(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if p_price is not null then
    if p_price < 1 or p_price > 5000000 then
      raise exception 'invalid price' using errcode = '22023';
    end if;
    if public._has_crop(p_room, p_plot) then
      raise exception 'crop exists' using errcode = '22023';
    end if;
    if public._leased(p_room, p_plot, p_now) then
      raise exception 'leased' using errcode = '22023';
    end if;
  end if;
  update public.field_plots set sale_price = p_price where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Buy a listed plot at exactly its listed price (§7.3).
create or replace function public._farm_do_buy_listed(p_room uuid, p_account uuid, p_plot integer, p_expected integer,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null or f.sale_price is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_expected is distinct from f.sale_price then
    raise exception 'price changed' using errcode = '22023';
  end if;
  if public._has_crop(p_room, p_plot) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'leased' using errcode = '22023';
  end if;
  if public._owns_land(p_room, p_account) then
    raise exception 'already own land' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < f.sale_price then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._land_sale(p_room, p_plot, p_account, f.sale_price, p_now);
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Offer to buy someone's plot. One offer per buyer and plot: a new one replaces the old one (with a new id, so the
-- owner never accepts a price they did not see). Offers expire after 24 h and reserve no xu (§7.3).
create or replace function public._farm_do_offer(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                 p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_price is null or p_price < 1 or p_price > 5000000 then
    raise exception 'invalid price' using errcode = '22023';
  end if;
  if public._owns_land(p_room, p_account) then
    raise exception 'already own land' using errcode = '22023';
  end if;
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (p_room, p_plot, p_account, p_price, p_now)
  on conflict (room_id, plot_no, buyer_id) do update
    set id = gen_random_uuid(), price = excluded.price, created_at = excluded.created_at;
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_withdraw_offer(p_room uuid, p_account uuid, p_offer uuid, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  delete from public.land_offers where id = p_offer and room_id = p_room and buyer_id = p_account;
  if not found then
    raise exception 'offer not found' using errcode = '22023';
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_decline_offer(p_room uuid, p_account uuid, p_offer uuid, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  delete from public.land_offers lo using public.field_plots fp
   where lo.id = p_offer and lo.room_id = p_room
     and fp.room_id = lo.room_id and fp.plot_no = lo.plot_no and fp.owner_id = p_account;
  if not found then
    raise exception 'offer not found' using errcode = '22023';
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- The owner accepts an offer. The buyer's membership, land, farming limit and xu are checked now (§7.3).
create or replace function public._farm_do_accept_offer(p_room uuid, p_account uuid, p_offer uuid, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare o public.land_offers; f public.field_plots; bw public.wallets;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into o from public.land_offers where id = p_offer and room_id = p_room;
  if not found then
    raise exception 'offer expired' using errcode = '22023';
  end if;
  f := public._plot_row(p_room, o.plot_no);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if public._has_crop(p_room, o.plot_no) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._leased(p_room, o.plot_no, p_now) then
    raise exception 'leased' using errcode = '22023';
  end if;
  bw := public._wallet_lock(o.buyer_id);
  if not exists (select 1 from public.members m where m.room_id = p_room and m.account_id = o.buyer_id)
     or public._owns_land(p_room, o.buyer_id)
     or public._farm_count(p_room, o.buyer_id, p_now) >= 2
     or bw.coins < o.price then
    raise exception 'buyer cannot buy' using errcode = '22023';
  end if;
  perform public._land_sale(p_room, o.plot_no, o.buyer_id, o.price, p_now);
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Offer your bare, unleased plot for one season at 1–100 000 xu; null withdraws it (§7.3).
create or replace function public._farm_do_set_sublease(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                        p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if p_price is not null then
    if p_price < 1 or p_price > 100000 then
      raise exception 'invalid price' using errcode = '22023';
    end if;
    if public._has_crop(p_room, p_plot) then
      raise exception 'crop exists' using errcode = '22023';
    end if;
    if public._leased(p_room, p_plot, p_now) then
      raise exception 'leased' using errcode = '22023';
    end if;
  end if;
  update public.field_plots set sublease_price = p_price where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Rent a subleased plot at exactly its price: the owner is paid, the lease runs 96 h, the offers are withdrawn.
create or replace function public._farm_do_rent_sublease(p_room uuid, p_account uuid, p_plot integer, p_expected integer,
                                                         p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null or f.sublease_price is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_expected is distinct from f.sublease_price then
    raise exception 'price changed' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'plot taken' using errcode = '22023';
  end if;
  if public._has_crop(p_room, p_plot) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < f.sublease_price then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._wallet_lock(f.owner_id);
  perform public._pay(p_account, -f.sublease_price, 'lease_pay', 'plot ' || p_plot);
  perform public._pay(f.owner_id, f.sublease_price, 'lease_income', 'plot ' || p_plot);
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (p_room, p_plot, p_account, 'owner', f.sublease_price, p_now, p_now + interval '96 hours');
  update public.field_plots set sublease_price = null, sale_price = null where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- The farmer gives up the crop; the plot is bare again and the lease (if any) goes on (§7.4).
create or replace function public._farm_do_abandon(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  delete from public.crops where room_id = p_room and plot_no = p_plot;
  if not found then
    raise exception 'no crop' using errcode = '22023';
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

revoke all on function public._land_sale(uuid, integer, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_rent(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_buy_plot(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_sell_to_village(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_list(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_buy_listed(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_offer(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_withdraw_offer(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_decline_offer(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_accept_offer(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_set_sublease(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_rent_sublease(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_abandon(uuid, uuid, integer, timestamptz) from public, anon, authenticated;

create or replace function public.rent_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_rent(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.buy_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_buy_plot(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.sell_plot_to_village(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_sell_to_village(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.list_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_list(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_price, now()) $$;

create or replace function public.buy_listed_plot(p_room_id uuid, p_session_token text, p_plot integer,
                                                  p_expected_price integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$
  select public._farm_do_buy_listed(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_expected_price, now())
$$;

create or replace function public.offer_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_price, now()) $$;

create or replace function public.withdraw_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_withdraw_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_offer_id, now()) $$;

create or replace function public.decline_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_decline_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_offer_id, now()) $$;

create or replace function public.accept_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_accept_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_offer_id, now()) $$;

create or replace function public.set_sublease(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_set_sublease(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_price, now()) $$;

create or replace function public.rent_sublease(p_room_id uuid, p_session_token text, p_plot integer,
                                                p_expected_price integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$
  select public._farm_do_rent_sublease(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_expected_price,
                                       now())
$$;

create or replace function public.abandon_crop(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_abandon(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

grant execute on function public.rent_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.buy_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_plot_to_village(uuid, text, integer) to anon, authenticated;
grant execute on function public.list_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.buy_listed_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.offer_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.withdraw_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.decline_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.accept_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.set_sublease(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.rent_sublease(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.abandon_crop(uuid, text, integer) to anon, authenticated;

-- ---------- G. Farming, drying and trade (spec §8, §9). Each _farm_do_* takes p_now; its RPC passes now(). ----------
-- The crop of a plot the account farms.
create or replace function public._farm_crop(p_room uuid, p_plot integer, p_account uuid, p_now timestamptz)
returns public.crops
language plpgsql stable security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if not found then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  return c;
end; $$;

-- One farm consumable out of the inventory.
create or replace function public._use_item(p_account uuid, p_item text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.inventory set qty = qty - 1 where account_id = p_account and item_id = p_item and qty >= 1;
  if not found then
    raise exception 'no item' using errcode = '22023';
  end if;
end; $$;

-- Transplanting needs seedlings ≥ 8·s h old in shallow water (Nông); harvesting needs ripe rice in a drained plot (≤ Ẩm).
create or replace function public._work_check(c public.crops, v public.rice_varieties, p_work text, p_now timestamptz)
returns void
language plpgsql stable set search_path = public, extensions
as $$
begin
  if p_work = 'transplant' then
    if public._crop_phase(c, v, p_now) <> 'seedling' or public._hrs(c.sow_at, p_now) < 8 * v.scale then
      raise exception 'wrong phase' using errcode = '22023';
    end if;
    if public._water_at(c.water_log, p_now) <> 2 then
      raise exception 'need water' using errcode = '22023';
    end if;
  elsif p_work = 'harvest' then
    if public._crop_phase(c, v, p_now) not in ('ripe', 'overripe') then
      raise exception 'wrong phase' using errcode = '22023';
    end if;
    if public._water_at(c.water_log, p_now) > 1 then
      raise exception 'need water' using errcode = '22023';
    end if;
  else
    raise exception 'invalid work' using errcode = '22023';
  end if;
end; $$;

-- The work gate (§11.4): the matching begin_work at least 2 s earlier.
create or replace function public._work_gate(c public.crops, p_work text, p_now timestamptz) returns void
language plpgsql stable set search_path = public, extensions
as $$
begin
  if c.work is distinct from p_work or c.work_started_at is null or p_now - c.work_started_at < interval '2 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
end; $$;

-- Làm đất: floods the plot (water 3). Farming withdraws the owner's listing and sublease offer (§7.3).
create or replace function public._farm_do_prepare(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if found and c.prepared_at is not null then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if found then
    update public.crops
       set prepared_at = p_now, water_log = water_log || jsonb_build_array(jsonb_build_object('t', p_now, 'l', 3))
     where room_id = p_room and plot_no = p_plot;
  else
    insert into public.crops (room_id, plot_no, farmer_id, prepared_at, water_log)
    values (p_room, p_plot, p_account, p_now, jsonb_build_array(jsonb_build_object('t', p_now, 'l', 3)));
  end if;
  update public.field_plots set sale_price = null, sublease_price = null where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Any fertilizer, any time after làm đất; the plot panel warns before a wasted one (§8.4).
create or replace function public._farm_do_fertilize(p_room uuid, p_account uuid, p_plot integer, p_item text,
                                                     p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if not exists (select 1 from public.shop_items where id = p_item and kind = 'fertilizer') then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  update public.crops set fert_log = fert_log || jsonb_build_array(jsonb_build_object('t', p_now, 'item', p_item))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Ngâm ủ: one bag of seed, before or after làm đất. Sprouted after 2 h, rots 24 h later if not sown (§8.2).
create or replace function public._farm_do_soak(p_room uuid, p_account uuid, p_plot integer, p_item text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v_variety text; v_has boolean;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select variety into v_variety from public.shop_items where id = p_item and kind = 'seed';
  if v_variety is null then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  v_has := found;
  if v_has and (c.soak_at is not null or c.sow_at is not null) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  if v_has then
    update public.crops set variety = v_variety, soak_at = p_now, rotted_at = null where room_id = p_room and plot_no = p_plot;
  else
    insert into public.crops (room_id, plot_no, farmer_id, variety, soak_at) values (p_room, p_plot, p_account, v_variety, p_now);
    update public.field_plots set sale_price = null, sublease_price = null where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Gieo mạ: sprouted seed on a prepared, moist (Ẩm) seedbed. The three pest chances are rolled now and stay secret (§8.5).
create or replace function public._farm_do_sow(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if public._crop_phase(c, public._variety(c.variety), p_now) <> 'sprouted' then
    raise exception 'wrong phase' using errcode = '22023';
  end if;
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  if public._water_at(c.water_log, p_now) <> 1 then
    raise exception 'need water' using errcode = '22023';
  end if;
  update public.crops
     set sow_at = p_now,
         pest_rolls = jsonb_build_array(
           jsonb_build_object('slot', 1, 'u_time', random(), 'u_kind', random(), 'u_hit', random()),
           jsonb_build_object('slot', 2, 'u_time', random(), 'u_kind', random(), 'u_hit', random()),
           jsonb_build_object('slot', 3, 'u_time', random(), 'u_kind', random(), 'u_hit', random()))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Starts the 2-second transplant or harvest action (§11.4).
create or replace function public._farm_do_begin_work(p_room uuid, p_account uuid, p_plot integer, p_work text,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  perform public._work_check(c, public._variety(c.variety), p_work, p_now);
  update public.crops set work = p_work, work_started_at = p_now where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Cấy: v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1); v15.2 decides how it comes back.
create or replace function public._farm_do_transplant(p_room uuid, p_account uuid, p_plot integer, p_quality double precision,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  perform public._work_gate(c, 'transplant', p_now);
  perform public._work_check(c, public._variety(c.variety), 'transplant', p_now);
  update public.crops
     set transplant_at = p_now, q_transplant = 1.0,
         work = null, work_started_at = null
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Bơm (+1) or tháo (−1) one level from the current one (§8.3). The yield samples the log every 15 minutes, so the
-- harvest's cost grows with it: at most 60 entries per crop, and 6 in any hour (làm đất's entry counts too).
create or replace function public._farm_do_water(p_room uuid, p_account uuid, p_plot integer, p_delta integer,
                                                 p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v_level integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if p_delta is null or p_delta not in (1, -1) then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  if jsonb_array_length(c.water_log) >= 60
     or (select count(*) from jsonb_array_elements(c.water_log) x where (x->>'t')::timestamptz > p_now - interval '1 hour') >= 6 then
    raise exception 'too fast' using errcode = '22023';
  end if;
  v_level := greatest(0, least(3, public._water_at(c.water_log, p_now) + p_delta));
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', p_now, 'l', v_level))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Xịt thuốc: treats an active pest of its kind at this moment; otherwise it is wasted (§8.5).
create or replace function public._farm_do_spray(p_room uuid, p_account uuid, p_plot integer, p_item text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if not exists (select 1 from public.shop_items where id = p_item and kind = 'pesticide') then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  update public.crops set spray_log = spray_log || jsonb_build_array(jsonb_build_object('t', p_now, 'item', p_item))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Bắt ốc: anyone may pick the golden apple snails off any plot that has them (§8.5).
create or replace function public._farm_do_pick_snails(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if not found or not exists (select 1 from jsonb_array_elements(public._crop_pests(c, public._variety(c.variety), p_now)) x
                               where x->>'kind' = 'snail' and x->>'treated_at' is null) then
    raise exception 'no snails' using errcode = '22023';
  end if;
  update public.crops set picks = picks || jsonb_build_array(jsonb_build_object('t', p_now))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Gặt: the yield goes to the farmer's wet rice; the plot is bare and a lease ends with the season (§8.7).
create or replace function public._farm_do_harvest(p_room uuid, p_account uuid, p_plot integer, p_quality double precision,
                                                   p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v public.rice_varieties; f public.field_plots; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  v := public._variety(c.variety);
  perform public._work_gate(c, 'harvest', p_now);
  perform public._work_check(c, v, 'harvest', p_now);
  f := public._plot_row(p_room, p_plot);
  v_kg := (public._crop_yield(c, v, case when f.kind = 'private' then 1.1 else 1.0 end,
                              1.0, p_now)->>'kg')::int;
  perform public._rice_add(p_account, c.variety, v_kg, 0);
  delete from public.crops where room_id = p_room and plot_no = p_plot;
  delete from public.plot_leases where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest', jsonb_build_object('variety', c.variety, 'kg', v_kg));
end; $$;

-- Phơi lúa: wet rice into a free drying slot; dry after 3 h (§8.7). An account dries at most 2 batches at a time in a
-- room, so one player cannot hold the whole yard.
create or replace function public._farm_do_dry_start(p_room uuid, p_account uuid, p_variety text, p_kg integer,
                                                     p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_wet integer; v_slot integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if p_kg is null or p_kg < 1 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  select wet_kg into v_wet from public.rice_stock where account_id = p_account and variety = p_variety;
  if coalesce(v_wet, 0) < p_kg then
    raise exception 'not enough rice' using errcode = '22023';
  end if;
  select min(n) into v_slot from generate_series(1, 4) n
   where not exists (select 1 from public.drying_slots ds where ds.room_id = p_room and ds.slot = n);
  if v_slot is null then
    raise exception 'drying full' using errcode = '22023';
  end if;
  if (select count(*) from public.drying_slots ds where ds.room_id = p_room and ds.account_id = p_account) >= 2 then
    raise exception 'drying limit' using errcode = '22023';
  end if;
  update public.rice_stock set wet_kg = wet_kg - p_kg where account_id = p_account and variety = p_variety;
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at)
  values (p_room, v_slot, p_account, p_variety, p_kg, p_now + interval '3 hours');
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_dry_collect(p_room uuid, p_account uuid, p_slot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare d public.drying_slots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into d from public.drying_slots where room_id = p_room and slot = p_slot and account_id = p_account;
  if not found then
    raise exception 'invalid slot' using errcode = '22023';
  end if;
  if d.ready_at > p_now then
    raise exception 'not ready' using errcode = '22023';
  end if;
  delete from public.drying_slots where room_id = p_room and slot = p_slot;
  perform public._rice_add(p_account, d.variety, 0, d.kg);
  return public._field_view(p_room, p_account, p_now);
end; $$;

revoke all on function public._farm_crop(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._use_item(uuid, text) from public, anon, authenticated;
revoke all on function public._work_check(public.crops, public.rice_varieties, text, timestamptz) from public, anon, authenticated;
revoke all on function public._work_gate(public.crops, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_prepare(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_fertilize(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_soak(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_sow(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_begin_work(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_transplant(uuid, uuid, integer, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._farm_do_water(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_spray(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_pick_snails(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_harvest(uuid, uuid, integer, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._farm_do_dry_start(uuid, uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_dry_collect(uuid, uuid, integer, timestamptz) from public, anon, authenticated;

create or replace function public.prepare_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_prepare(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.apply_fertilizer(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_fertilize(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_item_id, now()) $$;

create or replace function public.soak_seed(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_soak(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_item_id, now()) $$;

create or replace function public.sow_seed(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_sow(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.begin_work(p_room_id uuid, p_session_token text, p_plot integer, p_work text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_begin_work(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_work, now()) $$;

create or replace function public.transplant(p_room_id uuid, p_session_token text, p_plot integer,
                                             p_quality double precision) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_transplant(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_quality, now()) $$;

create or replace function public.water(p_room_id uuid, p_session_token text, p_plot integer, p_delta integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_water(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_delta, now()) $$;

create or replace function public.spray(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_spray(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_item_id, now()) $$;

create or replace function public.pick_snails(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_pick_snails(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.harvest(p_room_id uuid, p_session_token text, p_plot integer,
                                          p_quality double precision) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_harvest(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_quality, now()) $$;

create or replace function public.dry_start(p_room_id uuid, p_session_token text, p_variety text, p_kg integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_dry_start(p_room_id, public._farm_auth(p_room_id, p_session_token), p_variety, p_kg, now()) $$;

create or replace function public.dry_collect(p_room_id uuid, p_session_token text, p_slot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_dry_collect(p_room_id, public._farm_auth(p_room_id, p_session_token), p_slot, now()) $$;

-- Bán lúa at cô Út: dry rice at the full price per kg, wet rice at 70 % (§8.7). No room: answers { server_now, mine }.
create or replace function public.sell_rice(p_session_token text, p_variety text, p_dry boolean, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v public.rice_varieties; rs public.rice_stock; v_pay integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  v := public._variety(p_variety);
  if v.id is null then
    raise exception 'invalid variety' using errcode = '22023';
  end if;
  if p_kg is null or p_kg < 1 or p_dry is null then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  select * into rs from public.rice_stock where account_id = v_account and variety = p_variety for update;
  if not found or (case when p_dry then rs.dry_kg else rs.wet_kg end) < p_kg then
    raise exception 'not enough rice' using errcode = '22023';
  end if;
  v_pay := case when p_dry then p_kg * v.price_per_kg else (p_kg * v.price_per_kg * 7) / 10 end;
  update public.rice_stock
     set dry_kg = dry_kg - case when p_dry then p_kg else 0 end, wet_kg = wet_kg - case when p_dry then 0 else p_kg end
   where account_id = v_account and variety = p_variety;
  perform public._pay(v_account, v_pay, 'rice_sell',
                      p_variety || case when p_dry then ' dry ' else ' wet ' end || p_kg || ' kg');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- The farm shop at anh Hai: seeds, fertilizers and pesticides, 1–99 at a time and at most 99 held (§9).
create or replace function public.buy_farm_item(p_session_token text, p_item_id text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; it public.shop_items; v_cost integer;
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null or it.kind not in ('seed', 'fertilizer', 'pesticide') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99
     or coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + p_qty > 99 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  v_cost := it.price * p_qty;
  if w.coins < v_cost then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(v_account, -v_cost, 'farm_buy', it.id || ' x' || p_qty);
  insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- Chú Tám's gift on the first field visit: 1 seed_short and 1 fert_urea, once per account (§8.8).
create or replace function public.claim_farm_gift(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_gifted boolean;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  insert into public.farm_profiles (account_id) values (v_account) on conflict (account_id) do nothing;
  update public.farm_profiles set gift_at = now() where account_id = v_account and gift_at is null;
  v_gifted := found;
  if v_gifted then
    insert into public.inventory (account_id, item_id, qty) values (v_account, 'seed_short', 1), (v_account, 'fert_urea', 1)
    on conflict (account_id, item_id) do update set qty = least(99, public.inventory.qty + 1);
  end if;
  return jsonb_build_object('gifted', v_gifted, 'server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

grant execute on function public.prepare_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.apply_fertilizer(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.soak_seed(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.sow_seed(uuid, text, integer) to anon, authenticated;
grant execute on function public.begin_work(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.transplant(uuid, text, integer, double precision) to anon, authenticated;
grant execute on function public.water(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.spray(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.pick_snails(uuid, text, integer) to anon, authenticated;
grant execute on function public.harvest(uuid, text, integer, double precision) to anon, authenticated;
grant execute on function public.dry_start(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.dry_collect(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_rice(text, text, boolean, integer) to anon, authenticated;
grant execute on function public.buy_farm_item(text, text, integer) to anon, authenticated;
grant execute on function public.claim_farm_gift(text) to anon, authenticated;

-- ---------- H. The fish price index (economy spec §5): the room's wealth sets a 3-hourly multiplier ----------
create table if not exists public.fish_price_index (                -- one snapshot per room, replaced each 3-hour period
  room_id uuid primary key references public.rooms(id) on delete cascade,
  period bigint not null,
  wealth bigint not null check (wealth >= 0),
  mult numeric(5,2) not null check (mult between 1 and 10),
  computed_at timestamptz not null
);
alter table public.fish_price_index enable row level security;
revoke all on public.fish_price_index from public, anon, authenticated;

-- 3-hour periods aligned to Vietnam time: boundaries at 00:00, 03:00, …, 21:00 (UTC+7) (§5.4).
create or replace function public._fish_period(p_now timestamptz) returns bigint
language sql immutable set search_path = public, extensions
as $$ select floor((extract(epoch from p_now) + 25200) / 10800)::bigint $$;

-- The floor of the average assets (xu plus 800 000 per private plot owned, in any room) of the room's members seen
-- in the last 14 days (§5.2); 0 when there are none.
create or replace function public._room_wealth(p_room uuid, p_now timestamptz) returns bigint
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(floor(avg(coalesce(w.coins, 0)
                            + 800000 * (select count(*) from public.field_plots fp where fp.owner_id = m.account_id))), 0)::bigint
    from public.members m
    left join public.wallets w on w.account_id = m.account_id
   where m.room_id = p_room and coalesce(m.last_seen_at, m.joined_at) > p_now - interval '14 days'
$$;

-- M = round(least(10, greatest(1, sqrt(W / 20 000))), 2) (§5.3).
create or replace function public._fish_mult(p_wealth bigint) returns numeric
language sql immutable set search_path = public, extensions
as $$ select round(least(10, greatest(1, sqrt(greatest(p_wealth, 0) / 20000.0))), 2) $$;

-- The room's snapshot for the period of p_now (§5.5): stored the first time the period is asked for; concurrent
-- first callers all end up with the first snapshot written.
create or replace function public._fish_index(p_room uuid, p_now timestamptz) returns public.fish_price_index
language plpgsql security definer set search_path = public, extensions
as $$
declare v_period bigint := public._fish_period(p_now); v_wealth bigint; r public.fish_price_index;
begin
  select * into r from public.fish_price_index where room_id = p_room;
  if found and r.period >= v_period then
    return r;
  end if;
  v_wealth := public._room_wealth(p_room, p_now);
  insert into public.fish_price_index (room_id, period, wealth, mult, computed_at)
  values (p_room, v_period, v_wealth, public._fish_mult(v_wealth), p_now)
  on conflict (room_id) do update
    set period = excluded.period, wealth = excluded.wealth, mult = excluded.mult, computed_at = excluded.computed_at
    where public.fish_price_index.period < excluded.period;
  select * into r from public.fish_price_index where room_id = p_room;
  return r;
end; $$;

-- S = trunc(0.80 + 0.60 × h, 2), h from the first 32 bits of md5(room:species:period) (§5.6): in [0.80, 1.39].
create or replace function public._fish_factor(p_room uuid, p_species text, p_period bigint) returns numeric
language sql immutable set search_path = public, extensions
as $$
  select trunc(0.80 + 0.60 * (('x' || left(md5(p_room::text || ':' || p_species || ':' || p_period::text), 8))::bit(32)::bigint
                              / 4294967296.0), 2)
$$;

-- What the board shows (§5.7): the multiplier, the wealth behind it, when the period ends and every species' factor.
create or replace function public._fish_prices(p_room uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.fish_price_index := public._fish_index(p_room, p_now);
begin
  return jsonb_build_object(
    'mult', r.mult, 'wealth', r.wealth, 'ends_at', to_timestamp((r.period + 1) * 10800 - 25200),
    'factors', coalesce((select jsonb_object_agg(s.id, public._fish_factor(p_room, s.id, r.period)) from public.fish_species s),
                        '{}'::jsonb));
end; $$;

-- v14's finish_cast (0012) with one change: the catch is priced with the room's fish price index (§5.7).
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
  elsif now() < c.bite_at + make_interval(secs => 0.9 * c.min_reel_ms / 1000.0) then
    v_why := 'too_early';
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'state', public._fishing_state(v_account));
  end if;
  select * into sp from public.fish_species where id = c.species_id;
  -- the room's fish price index at the catch (economy spec §5.7); a cast whose room is gone keeps the base price
  if c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    r := public._fish_index(c.room_id, now());
    v_mult := r.mult;
    v_factor := public._fish_factor(c.room_id, sp.id, r.period);
  end if;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0 * v_mult * v_factor)::int);
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  -- rare+ catches are announced in the room's chat (spec §8.5)
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]));
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'state', public._fishing_state(v_account));
end; $$;

-- v14's fishing_board (0012) plus the room's fish prices (§5.7).
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
   where m.room_id = p_room_id and w.coins > v_coins;
  return jsonb_build_object(
    'records', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', r.species_id, 'username', r.username, 'weight_g', r.weight_g)
                       order by r.species_id)
        from (select distinct on (pb.species_id) pb.species_id, a.username, pb.weight_g
                from public.personal_bests pb
                join public.members m on m.account_id = pb.account_id and m.room_id = p_room_id
                join public.accounts a on a.id = pb.account_id
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
               where m.room_id = p_room_id and w.coins > 0
               order by w.coins desc, a.username
               limit 10) t), '[]'::jsonb),
    'my_rank', v_rank,
    'my_coins', v_coins,
    'prices', public._fish_prices(p_room_id, now()));
end; $$;

revoke all on function public._fish_period(timestamptz) from public, anon, authenticated;
revoke all on function public._room_wealth(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._fish_mult(bigint) from public, anon, authenticated;
revoke all on function public._fish_index(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._fish_factor(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public._fish_prices(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_cast(text, uuid, boolean) to anon, authenticated;
grant execute on function public.fishing_board(uuid, text) to anon, authenticated;
