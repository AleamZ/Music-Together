-- =========================================================
-- 0012_v14_fishing.sql — v14: fishing pond economy — xu wallet + ledger, gear shop, bait, casts, caught fish,
-- personal bests, the room fishing board and the song bonus.
-- ADDITIVE (no data drop) and re-runnable. Every function relies on `set search_path = public, extensions`.
-- =========================================================

-- ---------- A. Config tables (public read) ----------
create table if not exists public.fish_species (
  id text primary key,
  name text not null,
  rarity smallint not null check (rarity between 1 and 5),
  min_g integer not null check (min_g > 0),
  max_g integer not null check (max_g >= min_g),
  price_per_kg integer not null check (price_per_kg > 0),
  difficulty smallint not null check (difficulty between 1 and 100),
  sort_order integer not null default 0
);
alter table public.fish_species enable row level security;
drop policy if exists fish_species_select on public.fish_species;
create policy fish_species_select on public.fish_species for select to anon using (true);

insert into public.fish_species (id, name, rarity, min_g, max_g, price_per_kg, difficulty, sort_order) values
  ('ca_ro',       'Cá rô đồng',    1,    50,   300,  45, 15,  10),
  ('ca_sac',      'Cá sặc rằn',    1,    50,   250,  40, 12,  20),
  ('ca_me_vinh',  'Cá mè vinh',    1,   100,   500,  35, 20,  30),
  ('ca_loc',      'Cá lóc',        2,   300,  2500,  60, 38,  40),
  ('ca_tre',      'Cá trê vàng',   2,   200,  1200,  50, 32,  50),
  ('ca_chep',     'Cá chép',       2,   500,  3000,  55, 42,  60),
  ('ca_tra',      'Cá tra',        3,  1000,  6000,  70, 52,  70),
  ('ca_that_lat', 'Cá thát lát',   3,   300,  1500, 120, 58,  80),
  ('tom_cang',    'Tôm càng xanh', 3,    50,   300, 400, 62,  90),
  ('ca_bong_lau', 'Cá bông lau',   4,  1000,  5000, 120, 70, 100),
  ('ca_he_vang',  'Cá he vàng',    4,   300,  1500, 150, 75, 110),
  ('ca_ho',       'Cá hô',         5, 10000, 40000, 200, 90, 120)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, min_g = excluded.min_g, max_g = excluded.max_g,
  price_per_kg = excluded.price_per_kg, difficulty = excluded.difficulty, sort_order = excluded.sort_order;

create table if not exists public.shop_items (
  id text primary key,
  kind text not null check (kind in ('rod','bobber','bait','bait_box','bucket')),
  name text not null,
  price integer check (price > 0),                  -- null = not sold (starter gear, dug worms)
  starter boolean not null default false,           -- everyone owns it
  sort_order integer not null default 0,
  zone_pct smallint, weight_k real, rare_mult real not null default 1,                                        -- rod
  window_ms integer, bite_min_ms integer, bite_max_ms integer, shows_rarity boolean not null default false,  -- bobber
  mult_hiem real not null default 1, mult_quy real not null default 1, mult_legend real not null default 1,  -- bait
  capacity integer                                                                                             -- bait_box, bucket
);
alter table public.shop_items enable row level security;
drop policy if exists shop_items_select on public.shop_items;
create policy shop_items_select on public.shop_items for select to anon using (true);

insert into public.shop_items (id, kind, name, price, starter, sort_order, zone_pct, weight_k, rare_mult,
                               window_ms, bite_min_ms, bite_max_ms, shows_rarity, mult_hiem, mult_quy, mult_legend, capacity) values
  ('rod_wood',       'rod',      'Cần gỗ',       null, true,  10,   25,  2.0, 1,   null, null,  null,  false, 1,   1,   1,   null),
  ('rod_bamboo',     'rod',      'Cần tre',       300, false, 20,   30,  1.5, 1,   null, null,  null,  false, 1,   1,   1,   null),
  ('rod_carbon',     'rod',      'Cần carbon',   1500, false, 30,   36,  1.5, 1.2, null, null,  null,  false, 1,   1,   1,   null),
  ('bobber_feather', 'bobber',   'Phao lông gà', null, true,  10, null, null, 1,   1500, 3000, 10000, false, 1,   1,   1,   null),
  ('bobber_foam',    'bobber',   'Phao xốp',      150, false, 20, null, null, 1,   2000, 3000, 10000, true,  1,   1,   1,   null),
  ('bobber_lamp',    'bobber',   'Phao đèn',      800, false, 30, null, null, 1,   2500, 2000,  7000, true,  1,   1,   1,   null),
  ('bait_worm',      'bait',     'Trùn đất',     null, false, 10, null, null, 1,   null, null,  null,  false, 1,   1,   1,   null),
  ('bait_shrimp',    'bait',     'Mồi tép',         5, false, 20, null, null, 1,   null, null,  null,  false, 1.5, 1.5, 1.5, null),
  ('bait_bloodworm', 'bait',     'Mồi trùn chỉ',   12, false, 30, null, null, 1,   null, null,  null,  false, 2,   2,   3,   null),
  ('bait_box',       'bait_box', 'Hộp mồi',       250, false, 10, null, null, 1,   null, null,  null,  false, 1,   1,   1,   60),
  ('bucket_small',   'bucket',   'Xô nhỏ',        200, false, 10, null, null, 1,   null, null,  null,  false, 1,   1,   1,   5),
  ('bucket_large',   'bucket',   'Xô lớn',        800, false, 20, null, null, 1,   null, null,  null,  false, 1,   1,   1,   15)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter, sort_order = excluded.sort_order,
  zone_pct = excluded.zone_pct, weight_k = excluded.weight_k, rare_mult = excluded.rare_mult,
  window_ms = excluded.window_ms, bite_min_ms = excluded.bite_min_ms, bite_max_ms = excluded.bite_max_ms,
  shows_rarity = excluded.shows_rarity, mult_hiem = excluded.mult_hiem, mult_quy = excluded.mult_quy,
  mult_legend = excluded.mult_legend, capacity = excluded.capacity;

-- ---------- B. Per-account tables (private: RLS on, no policies — only the RPCs below touch them) ----------
create table if not exists public.wallets (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  coins integer not null default 0 check (coins >= 0),
  daily_on date,                                            -- VN day of the last check-in
  bonus_on date,                                            -- VN day that bonus_count counts
  bonus_count smallint not null default 0
);
create table if not exists public.coin_ledger (             -- append-only
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  delta integer not null,
  balance integer not null,
  reason text not null check (reason in ('daily','song','sell','buy')),
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists idx_coin_ledger_account on public.coin_ledger (account_id, created_at);
create table if not exists public.inventory (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  qty integer not null check (qty >= 0),
  primary key (account_id, item_id)
);
create table if not exists public.fishing_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  rod text not null default 'rod_wood' references public.shop_items(id),
  bobber text not null default 'bobber_feather' references public.shop_items(id),
  bait text not null default 'bait_worm' references public.shop_items(id),
  window_start timestamptz,                                 -- hourly cast cap window
  window_casts smallint not null default 0,
  last_dig_at timestamptz
);
create table if not exists public.fish (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null check (weight_g > 0),
  price integer not null check (price > 0),
  caught_at timestamptz not null default now()
);
create index if not exists idx_fish_account on public.fish (account_id, caught_at);
create table if not exists public.personal_bests (
  account_id uuid not null references public.accounts(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null,
  caught_at timestamptz not null default now(),
  primary key (account_id, species_id)
);
alter table public.wallets enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.inventory enable row level security;
alter table public.fishing_profiles enable row level security;
alter table public.fish enable row level security;
alter table public.personal_bests enable row level security;
revoke all on public.wallets, public.coin_ledger, public.inventory, public.fishing_profiles, public.fish, public.personal_bests
  from anon, authenticated;

-- ---------- C. Private helpers ----------
create or replace function public._vn_today() returns date
language sql stable set search_path = public, extensions
as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- The account's wallet row, created if missing and locked until the transaction ends: every economy call takes it
-- first, so one account's calls (several tabs) run one after another.
create or replace function public._wallet_lock(p_account uuid) returns public.wallets
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.wallets;
begin
  insert into public.wallets (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into v from public.wallets where account_id = p_account for update;
  return v;
end; $$;

create or replace function public._fishing_profile(p_account uuid) returns public.fishing_profiles
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.fishing_profiles;
begin
  insert into public.fishing_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into v from public.fishing_profiles where account_id = p_account for update;
  return v;
end; $$;

-- Owned = a starter item, or an inventory row with qty ≥ 1.
create or replace function public._owns(p_account uuid, p_item text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (select 1 from public.shop_items s where s.id = p_item and s.starter)
      or exists (select 1 from public.inventory i where i.account_id = p_account and i.item_id = p_item and i.qty >= 1)
$$;

create or replace function public._bait_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(max(s.capacity), 20) from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and i.qty >= 1 and s.kind = 'bait_box'
$$;

create or replace function public._bucket_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(max(s.capacity), 0) from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and i.qty >= 1 and s.kind = 'bucket'
$$;

create or replace function public._bait_total(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(sum(i.qty), 0)::int from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and s.kind = 'bait'
$$;

-- Add p_delta xu (negative = pay) and append the ledger row. The coins >= 0 check stops overdrafts.
create or replace function public._pay(p_account uuid, p_delta integer, p_reason text, p_ref text) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_balance integer;
begin
  update public.wallets set coins = coins + p_delta where account_id = p_account returning coins into v_balance;
  insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, p_delta, v_balance, p_reason, p_ref);
  return v_balance;
end; $$;

-- Everything the client shows about the account's fishing (spec §8.2).
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
                        where i.account_id = p_account and i.qty >= 1 and s.kind <> 'bait'), '[]'::jsonb),
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
    'dig_ready_at', v_dig
  );
end; $$;

revoke all on function public._vn_today() from public, anon, authenticated;
revoke all on function public._wallet_lock(uuid) from public, anon, authenticated;
revoke all on function public._fishing_profile(uuid) from public, anon, authenticated;
revoke all on function public._owns(uuid, text) from public, anon, authenticated;
revoke all on function public._bait_cap(uuid) from public, anon, authenticated;
revoke all on function public._bucket_cap(uuid) from public, anon, authenticated;
revoke all on function public._bait_total(uuid) from public, anon, authenticated;
revoke all on function public._pay(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- ---------- D. Account RPCs ----------
create or replace function public.fishing_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._fishing_state(public._auth_account(p_session_token));
end; $$;

-- +20 xu once per VN calendar day.
create or replace function public.claim_daily(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; v_today date := public._vn_today();
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  if w.daily_on is not distinct from v_today then
    return jsonb_build_object('claimed', false, 'amount', 0, 'state', public._fishing_state(v_account));
  end if;
  update public.wallets set daily_on = v_today where account_id = v_account;
  perform public._pay(v_account, 20, 'daily', v_today::text);
  return jsonb_build_object('claimed', true, 'amount', 20, 'state', public._fishing_state(v_account));
end; $$;

-- 1–3 worms, clamped to the bait capacity; 45 s cooldown per account.
create or replace function public.dig_worms(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_total integer; v_cap integer; v_gain integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if p.last_dig_at is not null and now() < p.last_dig_at + interval '45 seconds' then
    raise exception 'dig cooldown' using errcode = '53400',
      detail = ceil(extract(epoch from (p.last_dig_at + interval '45 seconds' - now())))::int::text;
  end if;
  v_total := public._bait_total(v_account);
  v_cap := public._bait_cap(v_account);
  if v_total >= v_cap then
    raise exception 'bait full' using errcode = '22023';
  end if;
  v_gain := least(1 + floor(random() * 3)::int, v_cap - v_total);
  insert into public.inventory (account_id, item_id, qty) values (v_account, 'bait_worm', v_gain)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  update public.fishing_profiles set last_dig_at = now() where account_id = v_account;
  return jsonb_build_object('gained', v_gain, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
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

create or replace function public.set_loadout(p_session_token text, p_rod text, p_bobber text, p_bait text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  perform public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_rod and kind = 'rod') or not public._owns(v_account, p_rod)
     or not exists (select 1 from public.shop_items where id = p_bobber and kind = 'bobber') or not public._owns(v_account, p_bobber)
     or not exists (select 1 from public.shop_items where id = p_bait and kind = 'bait') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  update public.fishing_profiles set rod = p_rod, bobber = p_bobber, bait = p_bait where account_id = v_account;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

create or replace function public.sell_fish(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  with sold as (
    delete from public.fish where account_id = v_account and id = any(coalesce(p_fish_ids, '{}'::uuid[])) returning price
  ) select count(*), coalesce(sum(price), 0) into v_count, v_sum from sold;
  if v_count = 0 then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  perform public._pay(v_account, v_sum, 'sell', v_count || ' con');
  return jsonb_build_object('sold', v_count, 'earned', v_sum, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.release_fish(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  delete from public.fish where account_id = v_account and id = p_fish_id;
  if not found then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

grant execute on function public.fishing_state(text) to anon, authenticated;
grant execute on function public.claim_daily(text) to anon, authenticated;
grant execute on function public.dig_worms(text) to anon, authenticated;
grant execute on function public.buy_item(text, text, integer) to anon, authenticated;
grant execute on function public.set_loadout(text, text, text, text) to anon, authenticated;
grant execute on function public.sell_fish(text, uuid[]) to anon, authenticated;
grant execute on function public.release_fish(text, uuid) to anon, authenticated;
-- Config reads go through the SELECT policies above; grant the privilege explicitly instead of relying on default grants.
grant select on public.fish_species, public.shop_items to anon, authenticated;

-- ---------- E. Casts (at most one open cast per account; private) ----------
create table if not exists public.casts (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  species_id text not null references public.fish_species(id),
  weight_g integer not null,
  min_reel_ms integer not null,
  bite_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.casts enable row level security;
revoke all on public.casts from anon, authenticated;

-- Rarity 1–5 for a rod + bait (spec §7.2): Khá fixed at 28 %, Thường takes the rest.
create or replace function public._roll_rarity(p_rod text, p_bait text) returns smallint
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare r public.shop_items; b public.shop_items; w3 double precision; w4 double precision; w5 double precision; v_roll double precision;
begin
  select * into r from public.shop_items where id = p_rod;
  select * into b from public.shop_items where id = p_bait;
  w5 := 0.3 * coalesce(b.mult_legend, 1) * coalesce(r.rare_mult, 1);
  w4 := 2.7 * coalesce(b.mult_quy, 1) * coalesce(r.rare_mult, 1);
  w3 := 9 * coalesce(b.mult_hiem, 1) * coalesce(r.rare_mult, 1);
  v_roll := random() * 100;
  if v_roll < w5 then return 5; end if;
  if v_roll < w5 + w4 then return 4; end if;
  if v_roll < w5 + w4 + w3 then return 3; end if;
  if v_roll < w5 + w4 + w3 + 28 then return 2; end if;
  return 1;
end; $$;

-- "350 g" under 1 kg, else tenths rounded half up with a Vietnamese decimal comma: 1150 → "1,2 kg" (same rule as formatWeight).
create or replace function public._weight_text(p_g integer) returns text
language sql immutable set search_path = public, extensions
as $$
  select case when p_g < 1000 then p_g || ' g'
              else (round(p_g / 100.0)::int / 10) || ',' || (round(p_g / 100.0)::int % 10) || ' kg' end
$$;

revoke all on function public._roll_rarity(text, text) from public, anon, authenticated;
revoke all on function public._weight_text(integer) from public, anon, authenticated;

create or replace function public.start_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  -- 1. hourly cap: a new window starts at the first cast after the previous one ended
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
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
  -- 5. roll the fish (spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90))
  returning id into v_id;
  update public.fishing_profiles set window_casts = window_casts + 1 where account_id = v_account;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'state', public._fishing_state(v_account));
end; $$;

create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text;
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
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0)::int);
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

-- Records per species and the richest members — among the members of the room only.
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
    'my_coins', v_coins);
end; $$;

grant execute on function public.start_cast(uuid, text) to anon, authenticated;
grant execute on function public.finish_cast(text, uuid, boolean) to anon, authenticated;
grant execute on function public.fishing_board(uuid, text) to anon, authenticated;

-- ---------- F. Song bonus: +10 xu to whoever queued a song that stayed on for ≥ 75 % of its length (spec §8.4) ----------
alter table public.rooms add column if not exists item_began_at timestamptz;

create or replace function public._item_clock() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.current_item_id is distinct from old.current_item_id then
    new.item_began_at := case when new.current_item_id is null then null else now() end;
  end if;
  return new;
end; $$;
drop trigger if exists rooms_item_clock on public.rooms;
create trigger rooms_item_clock before update of current_item_id on public.rooms
  for each row execute function public._item_clock();

-- advance_queue clears current_item_id before it deletes the old queue row, so the row is still readable here.
-- Never raises: advance_queue must not fail because of a bonus.
create or replace function public._song_bonus() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare q public.queue_items; w public.wallets; v_today date;
begin
  begin
    select * into q from public.queue_items where id = old.current_item_id;
    if not found or q.added_by_account_id is null or coalesce(q.duration_seconds, 0) < 60
       or old.item_began_at is null
       or extract(epoch from (now() - old.item_began_at)) < 0.75 * q.duration_seconds then
      return null;
    end if;
    v_today := public._vn_today();
    w := public._wallet_lock(q.added_by_account_id);
    if w.bonus_on is distinct from v_today then
      update public.wallets set bonus_on = v_today, bonus_count = 0 where account_id = q.added_by_account_id;
      w.bonus_count := 0;
    end if;
    if w.bonus_count >= 10 then
      return null;
    end if;
    update public.wallets set bonus_count = bonus_count + 1 where account_id = q.added_by_account_id;
    perform public._pay(q.added_by_account_id, 10, 'song', left(q.title, 80));
  exception when others then
    raise warning 'song bonus skipped: %', sqlerrm;
  end;
  return null;
end; $$;
drop trigger if exists rooms_song_bonus on public.rooms;
create trigger rooms_song_bonus after update of current_item_id on public.rooms
  for each row when (old.current_item_id is not null and old.current_item_id is distinct from new.current_item_id)
  execute function public._song_bonus();

revoke all on function public._item_clock() from public, anon, authenticated;
revoke all on function public._song_bonus() from public, anon, authenticated;
