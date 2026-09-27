-- =========================================================
-- 0043_real_estate.sql — v19.4 Sàn bất động sản (docs/superpowers/plans/2026-09-27-v19-4-real-estate.md,
-- spec docs/superpowers/specs/2026-09-27-v19-housing-design.md §19.4).
-- ADDITIVE and re-runnable. Run after 0042.
--   A. Rules: _estate_rule (lib/game/housing/estate.ts mirrors them; tests/unit/estate-sql.test.ts pins them).
--   B. estate_listings (one per seller, one per property), estate_sales (the history), estate_cooldowns.
--   C. Helpers: the appraisal, my listable property, the lazy sweep (expired, stale and out-of-band listings), the JSON,
--      the wipe's part.
--   D. RPCs: estate_state, estate_list, estate_cancel, estate_buy; admin_estate_flags (root).
--   E. _ac_wipe (0042 + the v19.4 line).
--   F. The ledger: 0042's 41 reasons + 'estate_sale', 'estate_buy': 43.
-- =========================================================

-- ---------- A. Rules ----------
-- fee: the % burned (the seller gets the rest); min / max: the price band in % of the appraisal; build: the % of a
-- house's build cost that the appraisal counts; big: a sale this big makes the Báo Làng.
create or replace function public._estate_rule(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what when 'fee' then 5 when 'min' then 50 when 'max' then 300 when 'build' then 80 when 'big' then 50000 end $$;
revoke all on function public._estate_rule(text) from public, anon, authenticated;

-- ---------- B. Tables ----------
create table if not exists public.estate_listings (
  id bigserial primary key,
  kind text not null check (kind in ('apt','lot')),
  prop_no smallint not null,
  seller_id uuid not null unique references public.accounts(id) on delete cascade,   -- one listing per seller
  price integer not null check (price > 0),
  with_furniture boolean not null default false,                                     -- "kèm nội thất"
  appraisal integer not null check (appraisal > 0),                                  -- when listed
  listed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (kind, prop_no)
);
alter table public.estate_listings enable row level security;
revoke all on public.estate_listings from anon, authenticated;

create table if not exists public.estate_sales (
  id bigserial primary key,
  kind text not null check (kind in ('apt','lot')),
  prop_no smallint not null,
  seller_id uuid references public.accounts(id) on delete set null,
  buyer_id uuid references public.accounts(id) on delete set null,
  seller_name text,                                     -- the names at the time
  buyer_name text,
  price integer not null check (price > 0),
  fee integer not null check (fee >= 0),
  appraisal integer not null,
  with_furniture boolean not null default false,
  flagged boolean not null default false,               -- the same two accounts traded within 30 days before
  sold_at timestamptz not null default now()
);
create index if not exists idx_estate_sales_at on public.estate_sales (sold_at desc, id desc);
create index if not exists idx_estate_sales_seller on public.estate_sales (seller_id, sold_at);
create index if not exists idx_estate_sales_buyer on public.estate_sales (buyer_id, sold_at);
alter table public.estate_sales enable row level security;
revoke all on public.estate_sales from anon, authenticated;

-- No listing before `until` (after a cancel or an expiry, and for a buyer after a purchase).
create table if not exists public.estate_cooldowns (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  until timestamptz not null
);
alter table public.estate_cooldowns enable row level security;
revoke all on public.estate_cooldowns from anon, authenticated;

-- ---------- C. Helpers ----------
-- The appraisal: a flat's list price, or the land + 80 % of the build cost; plus, with the furniture, the catalogue price
-- of the seller's own items placed in it (a tenant's never count).
create or replace function public._estate_appraise(p_kind text, p_no smallint, p_seller uuid, p_with boolean) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select ((case p_kind when 'apt' then public._apt_price('buy')
                       else public._house_price('land')
                            + coalesce((select build_cost from public.house_lots where no = p_no), 0) * public._estate_rule('build') / 100 end)
        + case when p_with then coalesce((select sum(c.price) from public.furniture_items f join public.furniture_catalog c on c.id = f.item_id
                                           where f.account_id = p_seller
                                             and (p_kind = 'apt' and f.apt_no = p_no or p_kind = 'lot' and f.lot_no = p_no)), 0)
               else 0 end)::int
$$;
revoke all on function public._estate_appraise(text, smallint, uuid, boolean) from public, anon, authenticated;

create or replace function public._estate_items(p_kind text, p_no smallint, p_seller uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select count(*)::int from public.furniture_items f
   where f.account_id = p_seller and (p_kind = 'apt' and f.apt_no = p_no or p_kind = 'lot' and f.lot_no = p_no)
$$;
revoke all on function public._estate_items(text, smallint, uuid) from public, anon, authenticated;

-- Is p_price inside the band of appraisal p_app?
create or replace function public._estate_in_band(p_price integer, p_app integer) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select p_price is not null
     and p_price >= (p_app * public._estate_rule('min') + 99) / 100
     and p_price <= p_app * public._estate_rule('max') / 100
$$;
revoke all on function public._estate_in_band(integer, integer) from public, anon, authenticated;

-- What I could list: my bought flat, else my lot; null for neither.
create or replace function public._estate_own_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(
    (select jsonb_build_object('kind', 'apt', 'no', a.no,
                               'bare', public._estate_appraise('apt', a.no, p_account, false),
                               'full', public._estate_appraise('apt', a.no, p_account, true),
                               'items', public._estate_items('apt', a.no, p_account),
                               'listed', exists (select 1 from public.estate_listings e where e.seller_id = p_account))
       from public.apartments a where a.owner_id = p_account and a.tenure = 'own'),
    (select jsonb_build_object('kind', 'lot', 'no', l.no,
                               'bare', public._estate_appraise('lot', l.no, p_account, false),
                               'full', public._estate_appraise('lot', l.no, p_account, true),
                               'items', public._estate_items('lot', l.no, p_account),
                               'listed', exists (select 1 from public.estate_listings e where e.seller_id = p_account))
       from public.house_lots l where l.owner_id = p_account))
$$;
revoke all on function public._estate_own_json(uuid) from public, anon, authenticated;

-- The lazy sweep: an expired listing goes (its seller waits 24 h to list again); a listing whose seller no longer owns
-- the property (moved out, gave it back, repossessed), or whose price left the band of the current appraisal (the
-- furniture was taken out, the house rebuilt), goes too.
create or replace function public._estate_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare x public.estate_listings;
begin
  for x in select * from public.estate_listings where expires_at <= now() for update skip locked loop
    insert into public.estate_cooldowns (account_id, until) values (x.seller_id, x.expires_at + interval '24 hours')
    on conflict (account_id) do update set until = greatest(public.estate_cooldowns.until, excluded.until);
    delete from public.estate_listings where id = x.id;
  end loop;
  delete from public.estate_listings e
   where e.kind = 'apt' and not exists (select 1 from public.apartments a
                                         where a.no = e.prop_no and a.owner_id = e.seller_id and a.tenure = 'own')
      or e.kind = 'lot' and not exists (select 1 from public.house_lots l where l.no = e.prop_no and l.owner_id = e.seller_id)
      or not public._estate_in_band(e.price, public._estate_appraise(e.kind, e.prop_no, e.seller_id, e.with_furniture));
end $$;
revoke all on function public._estate_sweep() from public, anon, authenticated;

create or replace function public._estate_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'listings', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', e.id, 'kind', e.kind, 'no', e.prop_no, 'price', e.price, 'with_furniture', e.with_furniture,
                  'appraisal', public._estate_appraise(e.kind, e.prop_no, e.seller_id, e.with_furniture),
                  'items', case when e.with_furniture then public._estate_items(e.kind, e.prop_no, e.seller_id) else 0 end,
                  'tenants', (select count(*) from public.house_tenancies t where e.kind = 'lot' and t.lot_no = e.prop_no and t.paid_until > now()),
                  'seller_name', acc.username, 'mine', e.seller_id = p_account,
                  'listed_ms', public._apt_ms(e.listed_at), 'expires_ms', public._apt_ms(e.expires_at),
                  'grid', l.grid, 'roof', l.roof) order by e.listed_at desc, e.id desc)
                  from public.estate_listings e left join public.accounts acc on acc.id = e.seller_id
                  left join public.house_lots l on e.kind = 'lot' and l.no = e.prop_no), '[]'::jsonb),
    'own', public._estate_own_json(p_account),
    'cooldown_ms', (select public._apt_ms(c.until) from public.estate_cooldowns c where c.account_id = p_account and c.until > now()),
    'sales', coalesce((select jsonb_agg(jsonb_build_object(
               'id', s.id, 'kind', s.kind, 'no', s.prop_no, 'price', s.price, 'with_furniture', s.with_furniture,
               'seller_name', s.seller_name, 'buyer_name', s.buyer_name, 'sold_ms', public._apt_ms(s.sold_at))
               order by s.sold_at desc, s.id desc)
               from (select * from public.estate_sales order by sold_at desc, id desc limit 30) s), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._estate_json(uuid) from public, anon, authenticated;

-- The wipe's part: the account's listing and cooldown go (its sales stay in the history).
create or replace function public._estate_wipe(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.estate_listings where seller_id = p_account;
  delete from public.estate_cooldowns where account_id = p_account;
end $$;
revoke all on function public._estate_wipe(uuid) from public, anon, authenticated;

-- ---------- F. The ledger ----------
-- The 41 reasons in force after 0042 plus the two estate reasons: 43.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt','meal','vehicle','skip','salon','repair',
                    'pet_buy','pet_find',
                    'umbrella',
                    'motel',
                    'apartment','apartment_sell','furniture',
                    'house_land','house_upkeep','house_build','house_refund','house_rent_pay','house_rent_income',
                    'estate_sale','estate_buy'));

-- ---------- D. RPCs ----------
create or replace function public.estate_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._apt_sweep();
  perform public._house_sweep();
  perform public._estate_sweep();
  return public._estate_json(v_account);
end $$;

-- List my bought flat or my lot ('apt' / 'lot') at p_price, with or without the furniture, for 14 days.
create or replace function public.estate_list(p_session_token text, p_kind text, p_price integer, p_with_furniture boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); v_no smallint; v_paid timestamptz; v_app int;
        v_with boolean := coalesce(p_with_furniture, false);
begin
  perform public._apt_sweep();
  perform public._house_sweep();
  perform public._estate_sweep();
  if p_kind is null or p_kind not in ('apt','lot') then raise exception 'bad kind' using errcode = '22023'; end if;
  if exists (select 1 from public.estate_listings where seller_id = v_account) then
    raise exception 'already listed' using errcode = '53400';
  end if;
  if exists (select 1 from public.estate_cooldowns where account_id = v_account and until > now()) then
    raise exception 'cooldown' using errcode = '53400';
  end if;
  if p_kind = 'apt' then
    select no into v_no from public.apartments where owner_id = v_account and tenure = 'own' for update;
    if v_no is null then raise exception 'not owned' using errcode = '53400'; end if;
  else
    select no, paid_until into v_no, v_paid from public.house_lots where owner_id = v_account for update;
    if v_no is null then raise exception 'not owned' using errcode = '53400'; end if;
    if v_paid <= now() then raise exception 'upkeep due' using errcode = '53400'; end if;
  end if;
  v_app := public._estate_appraise(p_kind, v_no, v_account, v_with);
  if not public._estate_in_band(p_price, v_app) then raise exception 'bad price' using errcode = '22023'; end if;
  insert into public.estate_listings (kind, prop_no, seller_id, price, with_furniture, appraisal, expires_at)
  values (p_kind, v_no, v_account, p_price, v_with, v_app, now() + interval '14 days');
  return public._estate_json(v_account);
end $$;

-- Take my listing down (24 h before I can list again).
create or replace function public.estate_cancel(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  delete from public.estate_listings where seller_id = v_account;
  if not found then raise exception 'no listing' using errcode = '53400'; end if;
  insert into public.estate_cooldowns (account_id, until) values (v_account, now() + interval '24 hours')
  on conflict (account_id) do update set until = greatest(public.estate_cooldowns.until, excluded.until);
  return public._estate_json(v_account);
end $$;

-- Buy listing p_listing at p_price (the price I saw). The seller gets 95 %, 5 % is burned; the title moves at once. A
-- house keeps its tenants (their paid time is honoured); the seller's furniture goes with it when listed with it, else
-- back to the seller's storage.
create or replace function public.estate_buy(p_session_token text, p_listing bigint, p_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token); e public.estate_listings; a public.apartments;
        l public.house_lots; v_app int; v_coins int; v_bal int; v_share int; v_flag boolean; v_what text;
begin
  perform public._apt_sweep();
  perform public._house_sweep();
  perform public._estate_sweep();
  select * into e from public.estate_listings where id = p_listing for update;
  if not found then raise exception 'no listing' using errcode = '53400'; end if;
  if e.seller_id = v_account then raise exception 'own listing' using errcode = '53400'; end if;
  if p_price is distinct from e.price then raise exception 'price changed' using errcode = '53400'; end if;
  if public._house_home(v_account) or exists (select 1 from public.apartments where owner_id = v_account) then
    raise exception 'already have a home' using errcode = '53400';
  end if;
  -- round trips between the same two accounts
  if exists (select 1 from public.estate_sales s
              where s.sold_at > now() - interval '7 days'
                and (s.seller_id = e.seller_id and s.buyer_id = v_account or s.seller_id = v_account and s.buyer_id = e.seller_id)) then
    raise exception 'suspicious trade' using errcode = '53400';
  end if;
  v_flag := exists (select 1 from public.estate_sales s
                     where s.sold_at > now() - interval '30 days'
                       and (s.seller_id = e.seller_id and s.buyer_id = v_account or s.seller_id = v_account and s.buyer_id = e.seller_id));
  -- the property, then both wallets in account order
  if e.kind = 'apt' then
    select * into a from public.apartments where no = e.prop_no for update;
    if a.owner_id is distinct from e.seller_id or a.tenure is distinct from 'own' then
      raise exception 'listing stale' using errcode = '53400';
    end if;
  else
    select * into l from public.house_lots where no = e.prop_no for update;
    if l.owner_id is distinct from e.seller_id then raise exception 'listing stale' using errcode = '53400'; end if;
    if l.paid_until <= now() then raise exception 'upkeep due' using errcode = '53400'; end if;
  end if;
  v_app := public._estate_appraise(e.kind, e.prop_no, e.seller_id, e.with_furniture);
  if not public._estate_in_band(e.price, v_app) then raise exception 'listing stale' using errcode = '53400'; end if;
  if v_account < e.seller_id then perform public._wallet_lock(v_account); perform public._wallet_lock(e.seller_id);
  else perform public._wallet_lock(e.seller_id); perform public._wallet_lock(v_account); end if;
  select coins into v_coins from public.wallets where account_id = v_account;
  if coalesce(v_coins, 0) < e.price then raise exception 'insufficient funds' using errcode = '22023'; end if;
  v_what := case e.kind when 'apt' then 'apartment #' else 'house #' end || e.prop_no;
  v_share := (e.price * (100 - public._estate_rule('fee'))) / 100;
  v_bal := public._pay(v_account, -e.price, 'estate_buy', v_what || ': bought');
  perform public._pay(e.seller_id, v_share, 'estate_sale', v_what || ': sold');
  -- the title and the furniture
  if e.with_furniture then
    update public.furniture_items set account_id = v_account
     where account_id = e.seller_id and (e.kind = 'apt' and apt_no = e.prop_no or e.kind = 'lot' and lot_no = e.prop_no);
  else
    update public.furniture_items set apt_no = null, lot_no = null, x = null, y = null, rot = 0
     where account_id = e.seller_id and (e.kind = 'apt' and apt_no = e.prop_no or e.kind = 'lot' and lot_no = e.prop_no);
  end if;
  if e.kind = 'apt' then
    delete from public.apt_guests where apt_no = e.prop_no;
    delete from public.apt_knocks where apt_no = e.prop_no;
    delete from public.apt_tv where apt_no = e.prop_no;
    update public.apartments set owner_id = v_account, since = now(), visibility = 'private',
           wall = case when e.with_furniture then wall end, floor = case when e.with_furniture then floor end
     where no = e.prop_no;
  else
    update public.house_lots set owner_id = v_account, bought_at = now(), visibility = 'private',
           wall = case when e.with_furniture then wall end, floor = case when e.with_furniture then floor end
     where no = e.prop_no;
  end if;
  delete from public.estate_listings where id = e.id;
  insert into public.estate_sales (kind, prop_no, seller_id, buyer_id, seller_name, buyer_name, price, fee, appraisal,
                                   with_furniture, flagged)
  values (e.kind, e.prop_no, e.seller_id, v_account, public._news_name(e.seller_id), public._news_name(v_account), e.price,
          e.price - v_share, v_app, e.with_furniture, v_flag);
  insert into public.estate_cooldowns (account_id, until) values (v_account, now() + interval '24 hours')
  on conflict (account_id) do update set until = greatest(public.estate_cooldowns.until, excluded.until);
  if e.price >= public._estate_rule('big') then
    perform public._news_event(public._news_home_room(v_account), 'house',
      format('🏘️ SÀN BẤT ĐỘNG SẢN: %s vừa tậu %s của %s với giá %s xu. Cả xóm trầm trồ!',
             public._news_name(v_account),
             case e.kind when 'apt' then 'căn hộ số ' || e.prop_no || ' chung cư Phú Mỹ'
                         else case when l.grid is null then 'lô đất số ' || e.prop_no else 'căn nhà trên lô số ' || e.prop_no end end,
             public._news_name(e.seller_id), e.price),
      jsonb_build_object('account_id', v_account, 'kind', e.kind, 'no', e.prop_no, 'price', e.price));
  end if;
  return public._estate_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Root: the flagged sales of the last 90 days.
create or replace function public.admin_estate_flags(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return jsonb_build_object('sales', coalesce((select jsonb_agg(jsonb_build_object(
           'id', s.id, 'kind', s.kind, 'no', s.prop_no, 'price', s.price, 'appraisal', s.appraisal,
           'seller_name', s.seller_name, 'buyer_name', s.buyer_name, 'sold_at', s.sold_at) order by s.sold_at desc, s.id desc)
           from (select * from public.estate_sales where flagged and sold_at > now() - interval '90 days'
                  order by sold_at desc, id desc limit 200) s), '[]'::jsonb));
end $$;

-- ---------- E. The wipe ----------
-- 0042's _ac_wipe plus the v19.4 line: the listing and the cooldown go, before the homes.
create or replace function public._ac_wipe(p_account uuid, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_snap jsonb; v_id bigint; v_coins integer;
begin
  perform public._card_forfeit_all(p_account);
  v_snap := public._ac_holdings(p_account);
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot)
  values (p_account, (select username from public.accounts where id = p_account), p_by, v_snap)
  returning id into v_id;
  select coins into v_coins from public.wallets where account_id = p_account;
  if found then
    insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, -v_coins, 0, 'wipe', 'wipe #' || v_id);
    delete from public.wallets where account_id = p_account;
  end if;
  delete from public.inventory where account_id = p_account;
  delete from public.casts where account_id = p_account;
  delete from public.fish where account_id = p_account;
  delete from public.fishing_profiles where account_id = p_account;
  delete from public.personal_bests where account_id = p_account;
  delete from public.rice_stock where account_id = p_account;
  delete from public.produce_stock where account_id = p_account;
  update public.farm_profiles set tank_item = null, tank_charges = 0 where account_id = p_account;
  delete from public.critters where account_id = p_account;                          -- v15.3
  delete from public.gather_cooldowns where account_id = p_account;                  -- v15.3
  delete from public.dogs where account_id = p_account;                              -- v17
  delete from public.rat_bag where account_id = p_account;                           -- v17
  delete from public.sling_aims where account_id = p_account;                        -- v17
  delete from public.fridge_fish where account_id = p_account;                       -- v19.2
  perform public._estate_wipe(p_account);                                            -- v19.4
  update public.apartments set owner_id = null where owner_id = p_account;           -- v19.2 (the sweep frees it)
  perform public._apt_sweep();                                                       -- v19.2
  perform public._house_wipe(p_account);                                             -- v19.3
  delete from public.furniture_items where account_id = p_account;                   -- v19.2
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;

-- ---------- grants ----------
revoke all on function public.estate_state(text) from public;
revoke all on function public.estate_list(text, text, integer, boolean) from public;
revoke all on function public.estate_cancel(text) from public;
revoke all on function public.estate_buy(text, bigint, integer) from public;
revoke all on function public.admin_estate_flags(text) from public;
grant execute on function public.estate_state(text) to anon, authenticated;
grant execute on function public.estate_list(text, text, integer, boolean) to anon, authenticated;
grant execute on function public.estate_cancel(text) to anon, authenticated;
grant execute on function public.estate_buy(text, bigint, integer) to anon, authenticated;
grant execute on function public.admin_estate_flags(text) to anon, authenticated;
