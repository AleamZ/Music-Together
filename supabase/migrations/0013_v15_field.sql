-- =========================================================
-- 0013_v15_field.sql — v15.1 "Ruộng lúa": the field map's land (village rent, private plots, player sales,
-- subleases, reclaim), the rice cycle (soak → seedbed → transplant → top-dress → water → pests → harvest),
-- drying, selling and the farm shop. Also: the v14 buy_item kind guard and server_now in _fishing_state (M-3).
-- ADDITIVE (no data drop) and re-runnable. Every function relies on `set search_path = public, extensions`.
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
  ('short', 'Lúa ngắn ngày', 0.9,  90, 12, 1.0, 10),
  ('nep',   'Nếp',           1.0,  75, 18, 1.0, 20),
  ('thom',  'Lúa thơm',      1.15, 60, 26, 1.3, 30)
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

insert into public.shop_items (id, kind, name, price, starter, sort_order, variety, fert, pest_target) values
  ('seed_short',     'seed',       'Giống lúa ngắn ngày',  60, false, 10, 'short', null,        null),
  ('seed_nep',       'seed',       'Giống nếp',            90, false, 20, 'nep',   null,        null),
  ('seed_thom',      'seed',       'Giống lúa thơm',      150, false, 30, 'thom',  null,        null),
  ('fert_manure',    'fertilizer', 'Phân chuồng hoai',     40, false, 10, null,    'manure',    null),
  ('fert_phosphate', 'fertilizer', 'Phân lân',             50, false, 20, null,    'phosphate', null),
  ('fert_urea',      'fertilizer', 'Phân urê',             60, false, 30, null,    'urea',      null),
  ('fert_potash',    'fertilizer', 'Phân kali',            60, false, 40, null,    'potash',    null),
  ('fert_npk',       'fertilizer', 'Phân NPK',             90, false, 50, null,    'npk',       null),
  ('spray_insect',   'pesticide',  'Thuốc trừ sâu',        70, false, 10, null,    null,        'insect'),
  ('spray_hopper',   'pesticide',  'Thuốc trừ rầy',        80, false, 20, null,    null,        'hopper'),
  ('spray_fungus',   'pesticide',  'Thuốc trừ bệnh',       90, false, 30, null,    null,        'fungus')
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, variety = excluded.variety, fert = excluded.fert, pest_target = excluded.pest_target;

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
  sale_price integer check (sale_price between 1 and 1000000),
  sublease_price integer check (sublease_price between 1 and 5000),
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
  price integer not null check (price between 1 and 1000000),
  created_at timestamptz not null,
  unique (room_id, plot_no, buyer_id),
  foreign key (room_id, plot_no) references public.field_plots(room_id, plot_no) on delete cascade
);
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
