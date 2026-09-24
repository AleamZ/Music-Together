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
