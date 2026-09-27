-- v18.5: vehicles for the hall <-> Chợ Lớn trip, and the paid skip. Mirrors lib/game/travel/vehicles.ts.

create table if not exists public.vehicle_catalog (
  id text primary key, name text not null, price int not null check (price > 0),
  trip_ms int not null check (trip_ms > 0), sort_order int not null
);
alter table public.vehicle_catalog enable row level security;
insert into public.vehicle_catalog (id, name, price, trip_ms, sort_order) values
  ('bike', 'Xe đạp', 5000, 10000, 1),
  ('moto', 'Xe máy', 30000, 5000, 2),
  ('car', 'Xe hơi', 150000, 2000, 3)
on conflict (id) do update set name = excluded.name, price = excluded.price, trip_ms = excluded.trip_ms, sort_order = excluded.sort_order;

create table if not exists public.owned_vehicles (
  account_id uuid not null references public.accounts(id) on delete cascade,
  vehicle_id text not null references public.vehicle_catalog(id),
  bought_at timestamptz not null default now(),
  primary key (account_id, vehicle_id)
);
alter table public.owned_vehicles enable row level security;

-- The 24 reasons in force after 0026 plus 'vehicle' and 'skip': 26.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip'));

create or replace function public._owned_vehicles(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(o.vehicle_id order by c.sort_order), '[]'::jsonb)
  from public.owned_vehicles o join public.vehicle_catalog c on c.id = o.vehicle_id where o.account_id = p_account;
$$;

create or replace function public.vehicles_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return jsonb_build_object('owned', public._owned_vehicles(public._auth_account(p_session_token)));
end; $$;

create or replace function public.buy_vehicle(p_session_token text, p_vehicle text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.vehicle_catalog; v_coins int; v_bal int;
begin
  v_account := public._auth_account(p_session_token);
  select * into c from public.vehicle_catalog where id = p_vehicle;
  if not found then raise exception 'unknown vehicle' using errcode = '22023'; end if;
  perform public._wallet_lock(v_account);
  if exists (select 1 from public.owned_vehicles where account_id = v_account and vehicle_id = p_vehicle) then
    raise exception 'already owned' using errcode = '22023';
  end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < c.price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -c.price, 'vehicle', 'vehicle: ' || p_vehicle);
  insert into public.owned_vehicles (account_id, vehicle_id) values (v_account, p_vehicle);
  return jsonb_build_object('owned', public._owned_vehicles(v_account), 'coins', v_bal);
end; $$;

create or replace function public.skip_trip(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins int; v_bal int;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < 20 then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_bal := public._pay(v_account, -20, 'skip', 'xe om');
  return jsonb_build_object('coins', v_bal);
end; $$;

revoke all on function public._owned_vehicles(uuid) from public, anon, authenticated;
revoke all on function public.vehicles_state(text) from public;
revoke all on function public.buy_vehicle(text, text) from public;
revoke all on function public.skip_trip(text) from public;
grant execute on function public.vehicles_state(text) to anon, authenticated;
grant execute on function public.buy_vehicle(text, text) to anon, authenticated;
grant execute on function public.skip_trip(text) to anon, authenticated;
