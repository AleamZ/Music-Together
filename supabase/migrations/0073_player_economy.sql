-- =========================================================
-- 0073_player_economy.sql — v21 "economy": player trading (#40), the Chợ người chơi market (#41), the auction house
-- (#42), rented stalls at Chợ Lớn (#45) and the collusion guard. ADDITIVE and re-runnable. Run after 0069.
--   A. Rules: _econ_rule (lib/game/economy/model.ts mirrors them; tests/unit/economy-sql.test.ts pins them).
--   B. Tables: econ_listings (the market board AND the stalls' stock: stall_no null = the board), econ_auctions,
--      econ_bids, econ_stalls (6, seeded), econ_trades, econ_deals (every player-to-player deal: the collusion guard).
--   C. Assets. Three kinds can change hands: 'fish' (one row of public.fish, ref = its id), 'fashion' (a non-starter
--      public.account_items row with a catalogue price, ref = item id) and 'produce' (kg of public.produce_stock, ref =
--      the crop id, qty = kg). Pets, gear, vehicles and homes do not (pets are bound to their owner; homes have the Sàn
--      bất động sản). A listing, an auction or a stall item is a RESERVATION: the asset stays with its owner and is
--      re-verified, under its row lock, at the moment it moves (_econ_move). Something sold or eaten elsewhere voids
--      the listing (no dupe is possible: the move is a single owner-checked UPDATE/DELETE). The value used for the price
--      bands is the NPC value: a fish's price, the catalogue price, kg × the crop's price per kg.
--   D. The sweep (lazy, at the start of every RPC here): expiries (the board refunds half its listing fee), stale
--      listings voided, ended auctions settled, lapsed stall rents, idle trades.
--   E. RPCs (all guarded by _ac_account / _ac_play; the reads too): econ_state, market_list, market_cancel, market_buy,
--      auction_create, auction_bid, auction_cancel, shop_rent, shop_stock, shop_buy, trade_open, trade_offer,
--      trade_confirm, trade_cancel, trade_state.
--   F. The wipe: an AFTER UPDATE trigger on anticheat_status (ban_state → 'wiped') drops the account's listings,
--      auctions (bidders refunded), stall, trades and forfeits its escrowed top bids — _ac_wipe is not re-created.
-- Ledger reasons (all already in 0069's check): trade, market_list, market_sell, market_buy, market_refund, auction_bid,
-- auction_refund, auction_sell, shop_rent, shop_sell, shop_buy.
-- Events emitted (public._game_event): 'trade_done' (both sides; qty 1; meta trade, partner), 'market_sold' (the
-- seller; qty = price; meta listing, kind, via 'market'|'shop'), 'auction_won' (the winner; qty = price; meta auction,
-- kind). Soft anti-cheat code: 'econ_collusion' (_ac_flag, p_hard false) when the same pair of accounts makes its 3rd
-- skewed deal (price ≥ 200 % or ≤ 60 % of the value, or a trade where one side gives ≥ 3× the other) within 7 days.
-- Lock order: listing/auction/trade row → wallets (account order) → asset rows → anticheat_status.
-- =========================================================

-- ---------- A. Rules ----------
create or replace function public._econ_rule(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what
  when 'fee' then 5              -- % of a sale burned (market, stall, auction)
  when 'min' then 50             -- the price band, % of the NPC value
  when 'max' then 300
  when 'list_fee' then 2         -- % of the asking price paid to list on the board
  when 'list_fee_min' then 5
  when 'list_hours' then 72      -- a board listing lives 3 days
  when 'max_open' then 20        -- open listings + auctions per account
  when 'max_hour' then 30        -- new listings + auctions per account per hour
  when 'auc_value' then 300      -- an auction needs an asset worth at least this ("hàng hiếm")
  when 'auc_inc' then 5          -- the minimum raise, % of the top bid …
  when 'auc_inc_min' then 10     -- … and at least this
  when 'auc_cap' then 500        -- no bid above 500 % of the value
  when 'snipe_s' then 120        -- a bid in the last 2 minutes pushes the end to 2 minutes from now
  when 'stall_day' then 200      -- a stall's rent per day
  when 'stall_days' then 7       -- rent at most 7 days ahead
  when 'stall_slots' then 8      -- items on one stall
  when 'stalls' then 6
  when 'trade_px' then 320       -- trading partners stand within 320 px on the same map …
  when 'trade_pos_min' then 15   -- … by positions at most 15 minutes old
  when 'trade_idle_min' then 10  -- an untouched trade window closes after 10 minutes
  when 'trade_items' then 8      -- assets per side
  when 'skew_hi' then 200
  when 'skew_lo' then 60
  when 'skew_trade' then 3
  when 'skew_floor' then 200     -- deals smaller than this are never skewed
  when 'collude_n' then 3
  when 'collude_days' then 7
end $$;
revoke all on function public._econ_rule(text) from public, anon, authenticated;

-- ---------- B. Tables ----------
create table if not exists public.econ_stalls (
  no smallint primary key check (no between 1 and 6),
  renter uuid unique references public.accounts(id) on delete set null,
  paid_until timestamptz
);
insert into public.econ_stalls (no) select g from generate_series(1, 6) g on conflict (no) do nothing;
alter table public.econ_stalls enable row level security;
revoke all on public.econ_stalls from anon, authenticated;

create table if not exists public.econ_listings (
  id bigserial primary key,
  seller uuid not null references public.accounts(id) on delete cascade,
  stall_no smallint references public.econ_stalls(no),             -- null: the Chợ người chơi board
  asset_kind text not null check (asset_kind in ('fish','fashion','produce')),
  asset_ref text not null,
  qty integer not null check (qty between 1 and 100000),
  name text not null,
  value integer not null check (value > 0),                        -- the NPC value when listed
  price integer not null check (price > 0),
  fee integer not null default 0 check (fee >= 0),                 -- the board's listing fee
  status text not null default 'open' check (status in ('open','sold','expired','cancelled','void')),
  buyer uuid references public.accounts(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz
);
create index if not exists econ_listings_open on public.econ_listings (status, created_at desc);
create index if not exists econ_listings_seller on public.econ_listings (seller, status);
alter table public.econ_listings enable row level security;
revoke all on public.econ_listings from anon, authenticated;

create table if not exists public.econ_auctions (
  id bigserial primary key,
  seller uuid not null references public.accounts(id) on delete cascade,
  asset_kind text not null check (asset_kind in ('fish','fashion','produce')),
  asset_ref text not null,
  qty integer not null check (qty between 1 and 100000),
  name text not null,
  value integer not null check (value > 0),
  start_price integer not null check (start_price > 0),
  top_bid integer,                                                  -- escrowed: taken from the bidder when bid
  top_bidder uuid references public.accounts(id) on delete set null,
  bids integer not null default 0,
  status text not null default 'open' check (status in ('open','sold','expired','cancelled','void')),
  created_at timestamptz not null default now(),
  ends_at timestamptz not null,
  closed_at timestamptz
);
create index if not exists econ_auctions_open on public.econ_auctions (status, ends_at);
create index if not exists econ_auctions_seller on public.econ_auctions (seller, status);
alter table public.econ_auctions enable row level security;
revoke all on public.econ_auctions from anon, authenticated;

create table if not exists public.econ_bids (
  id bigserial primary key,
  auction_id bigint not null references public.econ_auctions(id) on delete cascade,
  bidder uuid references public.accounts(id) on delete set null,
  amount integer not null check (amount > 0),
  at timestamptz not null default now()
);
create index if not exists econ_bids_auction on public.econ_bids (auction_id, at desc);
alter table public.econ_bids enable row level security;
revoke all on public.econ_bids from anon, authenticated;

create table if not exists public.econ_trades (
  id bigserial primary key,
  a uuid not null references public.accounts(id) on delete cascade,      -- who opened it
  b uuid not null references public.accounts(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  a_offer jsonb not null default '{"coins": 0, "items": []}'::jsonb,
  b_offer jsonb not null default '{"coins": 0, "items": []}'::jsonb,
  a_ok boolean not null default false,
  b_ok boolean not null default false,
  rev integer not null default 0,                                         -- bumps on every offer change
  status text not null default 'open' check (status in ('open','done','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (a <> b)
);
create unique index if not exists econ_trades_open_a on public.econ_trades (a) where status = 'open';
create unique index if not exists econ_trades_open_b on public.econ_trades (b) where status = 'open';
alter table public.econ_trades enable row level security;
revoke all on public.econ_trades from anon, authenticated;

create table if not exists public.econ_deals (
  id bigserial primary key,
  seller uuid,                                   -- no FK: evidence outlives the accounts
  buyer uuid,
  via text not null,                             -- 'market', 'shop', 'auction', 'trade'
  ref bigint,
  value integer not null,
  price integer not null,
  skewed boolean not null,
  at timestamptz not null default now()
);
create index if not exists econ_deals_pair on public.econ_deals (seller, buyer, at);
alter table public.econ_deals enable row level security;
revoke all on public.econ_deals from anon, authenticated;

-- ---------- C. Assets ----------
create or replace function public._econ_uuid(p text) returns uuid
language sql immutable set search_path = public, extensions
as $$ select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end $$;
revoke all on function public._econ_uuid(text) from public, anon, authenticated;

-- What is reserved of an asset by the owner's open listings and auctions (produce kg; 1 for a listed fish or item).
create or replace function public._econ_reserved(p_owner uuid, p_kind text, p_ref text) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select (coalesce((select sum(qty) from public.econ_listings where seller = p_owner and status = 'open'
                     and asset_kind = p_kind and asset_ref = p_ref), 0)
        + coalesce((select sum(qty) from public.econ_auctions where seller = p_owner and status = 'open'
                     and asset_kind = p_kind and asset_ref = p_ref), 0))::int
$$;
revoke all on function public._econ_reserved(uuid, text, text) from public, anon, authenticated;

-- The NPC value of p_qty of an asset p_owner holds — at least p_qty + p_extra of it (p_extra: what is reserved besides);
-- null when not held, not enough, or not tradeable.
create or replace function public._econ_value(p_owner uuid, p_kind text, p_ref text, p_qty integer, p_extra integer default 0)
returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select case
    when p_qty is null or p_qty < 1 then null
    when p_kind = 'fish' then
      (select f.price from public.fish f where f.id = public._econ_uuid(p_ref) and f.account_id = p_owner
          and p_qty = 1 and coalesce(p_extra, 0) = 0)
    when p_kind = 'fashion' then
      (select c.price from public.account_items a join public.item_catalog c on c.id = a.item_id
        where a.account_id = p_owner and a.item_id = p_ref and not c.starter and c.price > 0
          and p_qty = 1 and coalesce(p_extra, 0) = 0)
    when p_kind = 'produce' then
      (select (u.price_per_kg::bigint * p_qty)::int from public.produce_stock s join public.upland_crops u on u.id = s.upland
        where s.account_id = p_owner and s.upland = p_ref and s.kg >= p_qty + coalesce(p_extra, 0) and p_qty <= 100000)
  end
$$;
revoke all on function public._econ_value(uuid, text, text, integer, integer) from public, anon, authenticated;

-- The display name of an asset.
create or replace function public._econ_name(p_kind text, p_ref text, p_qty integer) returns text
language sql stable security definer set search_path = public, extensions
as $$
  select case p_kind
    when 'fish' then (select s.name || ' ' || round(f.weight_g / 1000.0, 2)::text || ' kg'
                        from public.fish f join public.fish_species s on s.id = f.species_id where f.id = public._econ_uuid(p_ref))
    when 'fashion' then (select name from public.item_catalog where id = p_ref)
    when 'produce' then (select name || ' ' || p_qty || ' kg' from public.upland_crops where id = p_ref)
  end
$$;
revoke all on function public._econ_name(text, text, integer) from public, anon, authenticated;

-- Move an asset from one owner to another, checked under its row lock: 'asset gone' when p_from no longer holds it,
-- 'bucket full' when the receiver's fish bucket is full, 'already owned' for a fashion item the receiver has.
create or replace function public._econ_move(p_from uuid, p_to uuid, p_kind text, p_ref text, p_qty integer) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_fish uuid;
begin
  if p_kind = 'fish' then
    v_fish := public._econ_uuid(p_ref);
    perform 1 from public.fish where id = v_fish and account_id = p_from for update;
    if not found or p_qty <> 1 then raise exception 'asset gone' using errcode = '53400'; end if;
    if (select count(*) from public.fish where account_id = p_to) >= 1 + public._bucket_cap(p_to) then
      raise exception 'bucket full' using errcode = '53400';
    end if;
    update public.fish set account_id = p_to where id = v_fish;                 -- an update: no 'fish_catch' event
  elsif p_kind = 'fashion' then
    if exists (select 1 from public.account_items where account_id = p_to and item_id = p_ref) then
      raise exception 'already owned' using errcode = '53400';
    end if;
    delete from public.account_items where account_id = p_from and item_id = p_ref;
    if not found then raise exception 'asset gone' using errcode = '53400'; end if;
    -- off the giver's back (the required slots fall back to a starter)
    update public.characters
       set hat = nullif(hat, p_ref), neck = nullif(neck, p_ref), hand = nullif(hand, p_ref), pet = nullif(pet, p_ref),
           outfit = nullif(outfit, p_ref), wrist = nullif(wrist, p_ref), hairpin = nullif(hairpin, p_ref),
           top = case when top = p_ref then 'top_baba_yellow' else top end,
           bottom = case when bottom = p_ref then 'bottom_shorts_red' else bottom end,
           shoes = case when shoes = p_ref then 'shoes_dep_blue' else shoes end,
           updated_at = now()
     where account_id = p_from and p_ref in (hat, neck, hand, pet, outfit, wrist, hairpin, top, bottom, shoes);
    insert into public.account_items (account_id, item_id, acquired_at) values (p_to, p_ref, now());
  elsif p_kind = 'produce' then
    update public.produce_stock set kg = kg - p_qty where account_id = p_from and upland = p_ref and kg >= p_qty;
    if not found or p_qty < 1 then raise exception 'asset gone' using errcode = '53400'; end if;
    insert into public.produce_stock (account_id, upland, kg) values (p_to, p_ref, p_qty)
    on conflict (account_id, upland) do update set kg = public.produce_stock.kg + excluded.kg;
  else
    raise exception 'bad kind' using errcode = '22023';
  end if;
end $$;
revoke all on function public._econ_move(uuid, uuid, text, text, integer) from public, anon, authenticated;

-- Both wallets, in account order.
create or replace function public._econ_lock2(p_a uuid, p_b uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_a < p_b then perform public._wallet_lock(p_a); perform public._wallet_lock(p_b);
  else perform public._wallet_lock(p_b); perform public._wallet_lock(p_a); end if;
end $$;
revoke all on function public._econ_lock2(uuid, uuid) from public, anon, authenticated;

create or replace function public._econ_in_band(p_price integer, p_value integer) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select p_price is not null and p_value is not null and p_value > 0
     and p_price::bigint * 100 >= p_value::bigint * public._econ_rule('min')
     and p_price::bigint * 100 <= p_value::bigint * public._econ_rule('max')
$$;
revoke all on function public._econ_in_band(integer, integer) from public, anon, authenticated;

create or replace function public._econ_list_fee(p_price integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select greatest(public._econ_rule('list_fee_min'), (p_price::bigint * public._econ_rule('list_fee') / 100)::int) $$;
revoke all on function public._econ_list_fee(integer) from public, anon, authenticated;

-- The minimum next bid of an auction.
create or replace function public._econ_min_bid(p_start integer, p_top integer) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case when p_top is null then p_start
              else p_top + greatest(public._econ_rule('auc_inc_min'), (p_top::bigint * public._econ_rule('auc_inc') + 99) / 100)::int end
$$;
revoke all on function public._econ_min_bid(integer, integer) from public, anon, authenticated;

-- The collusion guard: record a deal; the 3rd skewed deal of the same pair (either way) within 7 days flags both, soft.
create or replace function public._econ_deal(p_seller uuid, p_buyer uuid, p_via text, p_ref bigint, p_value integer,
                                             p_price integer, p_skewed boolean) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer; v_detail jsonb;
begin
  insert into public.econ_deals (seller, buyer, via, ref, value, price, skewed)
  values (p_seller, p_buyer, p_via, p_ref, p_value, p_price, coalesce(p_skewed, false));
  if not coalesce(p_skewed, false) then return; end if;
  select count(*) into v_n from public.econ_deals d
   where d.skewed and d.at > now() - make_interval(days => public._econ_rule('collude_days'))
     and (d.seller = p_seller and d.buyer = p_buyer or d.seller = p_buyer and d.buyer = p_seller);
  if v_n >= public._econ_rule('collude_n') then
    v_detail := jsonb_build_object('via', p_via, 'ref', p_ref, 'value', p_value, 'price', p_price, 'skewed_deals', v_n,
                                   'seller', p_seller, 'buyer', p_buyer);
    perform public._ac_flag(p_buyer, 'econ_collusion', p_via, v_detail, null, null, false);
    perform public._ac_flag(p_seller, 'econ_collusion', p_via, v_detail, null, null, false);
  end if;
end $$;
revoke all on function public._econ_deal(uuid, uuid, text, bigint, integer, integer, boolean) from public, anon, authenticated;

create or replace function public._econ_skewed(p_value integer, p_price integer) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select greatest(p_value, p_price) >= public._econ_rule('skew_floor')
     and (p_price::bigint * 100 >= p_value::bigint * public._econ_rule('skew_hi')
          or p_price::bigint * 100 <= p_value::bigint * public._econ_rule('skew_lo'))
$$;
revoke all on function public._econ_skewed(integer, integer) from public, anon, authenticated;

-- ---------- D. The sweep ----------
create or replace function public._econ_settle(p_id bigint) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare x public.econ_auctions; v_share integer; v_ok boolean := true;
begin
  select * into x from public.econ_auctions where id = p_id and status = 'open' and ends_at <= now() for update skip locked;
  if not found then return; end if;
  if x.top_bidder is null then
    update public.econ_auctions set status = 'expired', closed_at = now() where id = x.id;
    return;
  end if;
  perform public._econ_lock2(x.seller, x.top_bidder);
  begin
    perform public._econ_move(x.seller, x.top_bidder, x.asset_kind, x.asset_ref, x.qty);
  exception when others then
    v_ok := false;
  end;
  if not v_ok then                                   -- the asset is gone or cannot be received: the bid goes back
    perform public._pay(x.top_bidder, x.top_bid, 'auction_refund', 'auction #' || x.id || ': void');
    update public.econ_auctions set status = 'void', closed_at = now() where id = x.id;
    return;
  end if;
  v_share := (x.top_bid::bigint * (100 - public._econ_rule('fee')) / 100)::int;
  perform public._pay(x.seller, v_share, 'auction_sell', 'auction #' || x.id);
  update public.econ_auctions set status = 'sold', closed_at = now() where id = x.id;
  perform public._game_event(x.top_bidder, 'auction_won', x.top_bid,
    jsonb_build_object('auction', x.id, 'kind', x.asset_kind, 'ref', x.asset_ref));
  perform public._econ_deal(x.seller, x.top_bidder, 'auction', x.id, x.value, x.top_bid,
                            public._econ_skewed(x.value, x.top_bid));
end $$;
revoke all on function public._econ_settle(bigint) from public, anon, authenticated;

create or replace function public._econ_sweep() returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare x public.econ_listings; v_id bigint; s public.econ_stalls;
begin
  -- lapsed stall rents: the stall frees, its stock expires
  for s in select * from public.econ_stalls where renter is not null and paid_until <= now() for update skip locked loop
    update public.econ_listings set status = 'expired', closed_at = now() where stall_no = s.no and status = 'open';
    update public.econ_stalls set renter = null, paid_until = null where no = s.no;
  end loop;
  -- expired board listings: half the listing fee back
  for x in select * from public.econ_listings where status = 'open' and expires_at <= now() for update skip locked loop
    update public.econ_listings set status = 'expired', closed_at = now() where id = x.id;
    if x.stall_no is null and x.fee / 2 > 0 then
      perform public._wallet_lock(x.seller);
      perform public._pay(x.seller, x.fee / 2, 'market_refund', 'market #' || x.id || ': expired');
    end if;
  end loop;
  -- stale: the seller no longer holds what is listed
  update public.econ_listings l set status = 'void', closed_at = now()
   where l.status = 'open' and public._econ_value(l.seller, l.asset_kind, l.asset_ref, l.qty) is null;
  -- ended auctions
  for v_id in select id from public.econ_auctions where status = 'open' and ends_at <= now() order by ends_at limit 50 loop
    perform public._econ_settle(v_id);
  end loop;
  -- idle trade windows
  update public.econ_trades set status = 'cancelled', updated_at = now()
   where status = 'open' and updated_at < now() - make_interval(mins => public._econ_rule('trade_idle_min'));
end $$;
revoke all on function public._econ_sweep() from public, anon, authenticated;

-- ---------- The state ----------
create or replace function public._econ_asset_json(p_kind text, p_ref text, p_qty integer, p_value integer, p_name text)
returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('kind', p_kind, 'ref', p_ref, 'qty', p_qty, 'value', p_value, 'name', p_name,
    'species', case when p_kind = 'fish' then (select species_id from public.fish where id = public._econ_uuid(p_ref)) end,
    'rarity', case when p_kind = 'fish' then (select s.rarity from public.fish f join public.fish_species s on s.id = f.species_id
                                                where f.id = public._econ_uuid(p_ref)) end)
$$;
revoke all on function public._econ_asset_json(text, text, integer, integer, text) from public, anon, authenticated;

create or replace function public._econ_listing_json(l public.econ_listings, p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select public._econ_asset_json(l.asset_kind, l.asset_ref, l.qty, l.value, l.name) || jsonb_build_object(
    'id', l.id, 'price', l.price, 'fee', l.fee, 'status', l.status, 'stall', l.stall_no,
    'seller_name', public._news_name(l.seller), 'mine', l.seller = p_account,
    'created_ms', public._apt_ms(l.created_at), 'expires_ms', public._apt_ms(l.expires_at))
$$;
revoke all on function public._econ_listing_json(public.econ_listings, uuid) from public, anon, authenticated;

create or replace function public._econ_auction_json(x public.econ_auctions, p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select public._econ_asset_json(x.asset_kind, x.asset_ref, x.qty, x.value, x.name) || jsonb_build_object(
    'id', x.id, 'start', x.start_price, 'top', x.top_bid, 'bids', x.bids, 'status', x.status,
    'min_bid', public._econ_min_bid(x.start_price, x.top_bid),
    'max_bid', (x.value::bigint * public._econ_rule('auc_cap') / 100)::int,
    'seller_name', public._news_name(x.seller), 'mine', x.seller = p_account,
    'leading', x.top_bidder = p_account, 'top_name', case when x.top_bidder is not null then public._news_name(x.top_bidder) end,
    'ends_ms', public._apt_ms(x.ends_at))
$$;
revoke all on function public._econ_auction_json(public.econ_auctions, uuid) from public, anon, authenticated;

create or replace function public._econ_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'assets', coalesce((
      select jsonb_agg(a.j order by a.k, a.n) from (
        select 'fish' k, f.caught_at::text n,
               public._econ_asset_json('fish', f.id::text, 1, f.price, public._econ_name('fish', f.id::text, 1))
               || jsonb_build_object('reserved', public._econ_reserved(p_account, 'fish', f.id::text)) j
          from public.fish f where f.account_id = p_account
        union all
        select 'fashion', c.name,
               public._econ_asset_json('fashion', c.id, 1, c.price, c.name)
               || jsonb_build_object('reserved', public._econ_reserved(p_account, 'fashion', c.id))
          from public.account_items i join public.item_catalog c on c.id = i.item_id
         where i.account_id = p_account and not c.starter and c.price > 0
        union all
        select 'produce', u.name,
               public._econ_asset_json('produce', u.id, s.kg, u.price_per_kg, u.name)
               || jsonb_build_object('reserved', public._econ_reserved(p_account, 'produce', u.id))
          from public.produce_stock s join public.upland_crops u on u.id = s.upland
         where s.account_id = p_account and s.kg > 0) a), '[]'::jsonb),
    'listings', coalesce((select jsonb_agg(public._econ_listing_json(l, p_account) order by l.created_at desc, l.id desc)
                            from public.econ_listings l where l.id in (select id from public.econ_listings where status = 'open' and stall_no is null
                                   order by created_at desc, id desc limit 200)), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(public._econ_listing_json(l, p_account) order by l.created_at desc, l.id desc)
                        from public.econ_listings l where l.id in (select id from public.econ_listings where seller = p_account
                               order by created_at desc, id desc limit 30)), '[]'::jsonb),
    'auctions', coalesce((select jsonb_agg(public._econ_auction_json(x, p_account) order by x.status <> 'open', x.ends_at)
                            from public.econ_auctions x where x.id in (select id from public.econ_auctions
                                   where status = 'open'
                                      or (seller = p_account or top_bidder = p_account) and closed_at > now() - interval '3 days'
                                   order by ends_at limit 100)), '[]'::jsonb),
    'stalls', coalesce((select jsonb_agg(jsonb_build_object(
                 'no', s.no, 'mine', s.renter = p_account,
                 'renter_name', case when s.renter is not null then public._news_name(s.renter) end,
                 'paid_ms', case when s.renter is not null then public._apt_ms(s.paid_until) end,
                 'items', coalesce((select jsonb_agg(public._econ_listing_json(l, p_account) order by l.id)
                                      from public.econ_listings l where l.stall_no = s.no and l.status = 'open'), '[]'::jsonb))
                 order by s.no) from public.econ_stalls s), '[]'::jsonb),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._econ_json(uuid) from public, anon, authenticated;

-- Can p_account open one more listing or auction?
create or replace function public._econ_can_list(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if (select count(*) from public.econ_listings where seller = p_account and status = 'open')
     + (select count(*) from public.econ_auctions where seller = p_account and status = 'open') >= public._econ_rule('max_open') then
    raise exception 'too many listings' using errcode = '53400';
  end if;
  if (select count(*) from public.econ_listings where seller = p_account and created_at > now() - interval '1 hour')
     + (select count(*) from public.econ_auctions where seller = p_account and created_at > now() - interval '1 hour')
     >= public._econ_rule('max_hour') then
    raise exception 'slow down' using errcode = '53400';
  end if;
end $$;
revoke all on function public._econ_can_list(uuid) from public, anon, authenticated;

-- ---------- E. RPCs: the market ----------
create or replace function public.econ_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  perform public._econ_sweep();
  return public._econ_json(v_account);
end $$;

-- List p_qty of an asset on the board at p_price (within 50–300 % of its NPC value) for 3 days; the listing fee is 2 %
-- (at least 5 xu), half of it back if nobody buys.
create or replace function public.market_list(p_session_token text, p_kind text, p_ref text, p_qty integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_value integer; v_fee integer; v_id bigint;
begin
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce') then raise exception 'bad kind' using errcode = '22023'; end if;
  perform public._econ_can_list(v_account);
  v_value := public._econ_value(v_account, p_kind, p_ref, p_qty, public._econ_reserved(v_account, p_kind, p_ref));
  if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
  if not public._econ_in_band(p_price, v_value) then raise exception 'bad price' using errcode = '22023'; end if;
  v_fee := public._econ_list_fee(p_price);
  perform public._wallet_lock(v_account);
  if coalesce((select coins from public.wallets where account_id = v_account), 0) < v_fee then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  insert into public.econ_listings (seller, asset_kind, asset_ref, qty, name, value, price, fee, expires_at)
  values (v_account, p_kind, p_ref, p_qty, public._econ_name(p_kind, p_ref, p_qty), v_value, p_price, v_fee,
          now() + make_interval(hours => public._econ_rule('list_hours')))
  returning id into v_id;
  perform public._pay(v_account, -v_fee, 'market_list', 'market #' || v_id);
  return public._econ_json(v_account);
end $$;

-- Take my listing (board or stall) down; the listing fee is not refunded.
create or replace function public.market_cancel(p_session_token text, p_listing bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  update public.econ_listings set status = 'cancelled', closed_at = now()
   where id = p_listing and seller = v_account and status = 'open';
  if not found then raise exception 'no listing' using errcode = '53400'; end if;
  return public._econ_json(v_account);
end $$;

-- The purchase shared by the board and the stalls.
create or replace function public._econ_buy(p_account uuid, p_listing bigint, p_price integer, p_shop boolean) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare l public.econ_listings; v_share integer; v_bal integer;
begin
  select * into l from public.econ_listings where id = p_listing for update;
  if not found or l.status <> 'open' or l.expires_at <= now() then raise exception 'no listing' using errcode = '53400'; end if;
  if (l.stall_no is not null) <> p_shop then raise exception 'no listing' using errcode = '53400'; end if;
  if l.seller = p_account then raise exception 'own listing' using errcode = '53400'; end if;
  if p_price is distinct from l.price then raise exception 'price changed' using errcode = '53400'; end if;
  perform public._econ_lock2(p_account, l.seller);
  if coalesce((select coins from public.wallets where account_id = p_account), 0) < l.price then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  perform public._econ_move(l.seller, p_account, l.asset_kind, l.asset_ref, l.qty);
  v_share := (l.price::bigint * (100 - public._econ_rule('fee')) / 100)::int;
  v_bal := public._pay(p_account, -l.price, case when p_shop then 'shop_buy' else 'market_buy' end,
                       case when p_shop then 'stall #' || l.stall_no else 'market' end || ' #' || l.id);
  perform public._pay(l.seller, v_share, case when p_shop then 'shop_sell' else 'market_sell' end,
                      case when p_shop then 'stall #' || l.stall_no else 'market' end || ' #' || l.id);
  update public.econ_listings set status = 'sold', buyer = p_account, closed_at = now() where id = l.id;
  perform public._game_event(l.seller, 'market_sold', l.price,
    jsonb_build_object('listing', l.id, 'kind', l.asset_kind, 'ref', l.asset_ref, 'via', case when p_shop then 'shop' else 'market' end));
  perform public._econ_deal(l.seller, p_account, case when p_shop then 'shop' else 'market' end, l.id, l.value, l.price,
                            public._econ_skewed(l.value, l.price));
  return v_bal;
end $$;
revoke all on function public._econ_buy(uuid, bigint, integer, boolean) from public, anon, authenticated;

-- Buy board listing p_listing at p_price (the price I saw): 95 % to the seller, 5 % burned.
create or replace function public.market_buy(p_session_token text, p_listing bigint, p_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_bal integer;
begin
  perform public._econ_sweep();
  v_bal := public._econ_buy(v_account, p_listing, p_price, false);
  return public._econ_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- ---------- E. RPCs: the auction house ----------
-- Auction an asset worth at least 300 xu from p_start (within the band) for 1, 6, 12 or 24 hours. No listing fee:
-- 5 % of the winning bid is burned.
create or replace function public.auction_create(p_session_token text, p_kind text, p_ref text, p_qty integer,
                                                 p_start integer, p_hours integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_value integer;
begin
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce') then raise exception 'bad kind' using errcode = '22023'; end if;
  if p_hours is null or p_hours not in (1, 6, 12, 24) then raise exception 'bad hours' using errcode = '22023'; end if;
  perform public._econ_can_list(v_account);
  v_value := public._econ_value(v_account, p_kind, p_ref, p_qty, public._econ_reserved(v_account, p_kind, p_ref));
  if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
  if v_value < public._econ_rule('auc_value') then raise exception 'not rare' using errcode = '53400'; end if;
  if not public._econ_in_band(p_start, v_value) then raise exception 'bad price' using errcode = '22023'; end if;
  insert into public.econ_auctions (seller, asset_kind, asset_ref, qty, name, value, start_price, ends_at)
  values (v_account, p_kind, p_ref, p_qty, public._econ_name(p_kind, p_ref, p_qty), v_value, p_start,
          now() + make_interval(hours => p_hours));
  return public._econ_json(v_account);
end $$;

-- Bid p_amount on auction p_auction: at least the minimum raise, at most 500 % of the value. The amount is escrowed at
-- once; the bid it beats is refunded. A bid in the last 2 minutes pushes the end to 2 minutes from now.
create or replace function public.auction_bid(p_session_token text, p_auction bigint, p_amount integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); x public.econ_auctions; v_bal integer; v_have bigint;
begin
  perform public._econ_sweep();
  select * into x from public.econ_auctions where id = p_auction for update;
  if not found or x.status <> 'open' or x.ends_at <= now() then raise exception 'auction closed' using errcode = '53400'; end if;
  if x.seller = v_account then raise exception 'own listing' using errcode = '53400'; end if;
  if p_amount is null or p_amount < public._econ_min_bid(x.start_price, x.top_bid) then
    raise exception 'bid too low' using errcode = '22023';
  end if;
  if p_amount::bigint * 100 > x.value::bigint * public._econ_rule('auc_cap') then
    raise exception 'bid too high' using errcode = '22023';
  end if;
  if x.top_bidder is not null and x.top_bidder <> v_account then perform public._econ_lock2(v_account, x.top_bidder);
  else perform public._wallet_lock(v_account); end if;
  -- my own earlier top bid counts toward the new one
  v_have := coalesce((select coins from public.wallets where account_id = v_account), 0);
  if x.top_bidder = v_account then v_have := v_have + x.top_bid; end if;
  if v_have < p_amount then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  if x.top_bidder is not null then
    perform public._pay(x.top_bidder, x.top_bid, 'auction_refund', 'auction #' || x.id || ': outbid');
  end if;
  v_bal := public._pay(v_account, -p_amount, 'auction_bid', 'auction #' || x.id);
  insert into public.econ_bids (auction_id, bidder, amount) values (x.id, v_account, p_amount);
  update public.econ_auctions
     set top_bid = p_amount, top_bidder = v_account, bids = bids + 1,
         ends_at = greatest(ends_at, now() + make_interval(secs => public._econ_rule('snipe_s')))
   where id = x.id;
  return public._econ_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Withdraw my auction while nobody has bid.
create or replace function public.auction_cancel(p_session_token text, p_auction bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  update public.econ_auctions set status = 'cancelled', closed_at = now()
   where id = p_auction and seller = v_account and status = 'open' and top_bidder is null;
  if not found then raise exception 'cannot cancel' using errcode = '53400'; end if;
  return public._econ_json(v_account);
end $$;

-- ---------- E. RPCs: the stalls at Chợ Lớn (chú Bảy's row) ----------
-- Every stall call claims the stall row's counter on Chợ Lớn (server position, 0057).
create or replace function public.shop_rent(p_session_token text, p_stall integer, p_days integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; s public.econ_stalls; v_cost integer;
        v_until timestamptz; v_bal integer;
begin
  v_ac := public._pos_claim(v_account, 'market', 560, 360, 'shop_rent', null, 'not at market');
  if v_ac is not null then return v_ac; end if;
  perform public._econ_sweep();
  if p_days is null or p_days < 1 or p_days > public._econ_rule('stall_days') then raise exception 'bad days' using errcode = '22023'; end if;
  select * into s from public.econ_stalls where no = p_stall for update;
  if not found then raise exception 'no stall' using errcode = '22023'; end if;
  if s.renter is not null and s.renter <> v_account then raise exception 'stall taken' using errcode = '53400'; end if;
  if s.renter is null and exists (select 1 from public.econ_stalls where renter = v_account) then
    raise exception 'already renting' using errcode = '53400';
  end if;
  v_until := greatest(coalesce(s.paid_until, now()), now()) + make_interval(days => p_days);
  if v_until > now() + make_interval(days => public._econ_rule('stall_days')) + interval '1 minute' then
    raise exception 'bad days' using errcode = '22023';
  end if;
  v_cost := public._econ_rule('stall_day') * p_days;
  perform public._wallet_lock(v_account);
  if coalesce((select coins from public.wallets where account_id = v_account), 0) < v_cost then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  v_bal := public._pay(v_account, -v_cost, 'shop_rent', 'stall #' || p_stall || ': ' || p_days || ' d');
  update public.econ_stalls set renter = v_account, paid_until = v_until where no = p_stall;
  update public.econ_listings set expires_at = v_until where stall_no = p_stall and status = 'open';
  return public._econ_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- Put an asset on my stall at p_price (within the band); it sells while I am away, until the rent runs out.
create or replace function public.shop_stock(p_session_token text, p_kind text, p_ref text, p_qty integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; s public.econ_stalls; v_value integer;
begin
  v_ac := public._pos_claim(v_account, 'market', 560, 360, 'shop_stock', null, 'not at market');
  if v_ac is not null then return v_ac; end if;
  perform public._econ_sweep();
  if p_kind is null or p_kind not in ('fish','fashion','produce') then raise exception 'bad kind' using errcode = '22023'; end if;
  select * into s from public.econ_stalls where renter = v_account and paid_until > now() for update;
  if not found then raise exception 'no stall' using errcode = '53400'; end if;
  if (select count(*) from public.econ_listings where stall_no = s.no and status = 'open') >= public._econ_rule('stall_slots') then
    raise exception 'stall full' using errcode = '53400';
  end if;
  perform public._econ_can_list(v_account);
  v_value := public._econ_value(v_account, p_kind, p_ref, p_qty, public._econ_reserved(v_account, p_kind, p_ref));
  if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
  if not public._econ_in_band(p_price, v_value) then raise exception 'bad price' using errcode = '22023'; end if;
  insert into public.econ_listings (seller, stall_no, asset_kind, asset_ref, qty, name, value, price, fee, expires_at)
  values (v_account, s.no, p_kind, p_ref, p_qty, public._econ_name(p_kind, p_ref, p_qty), v_value, p_price, 0, s.paid_until);
  return public._econ_json(v_account);
end $$;

-- Buy from a stall (standing at the stall row): 95 % to the stall's owner, 5 % burned.
create or replace function public.shop_buy(p_session_token text, p_listing bigint, p_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); v_ac jsonb; v_bal integer;
begin
  v_ac := public._pos_claim(v_account, 'market', 560, 360, 'shop_buy', null, 'not at market');
  if v_ac is not null then return v_ac; end if;
  perform public._econ_sweep();
  v_bal := public._econ_buy(v_account, p_listing, p_price, true);
  return public._econ_json(v_account) || jsonb_build_object('coins', v_bal);
end $$;

-- ---------- E. RPCs: trading ----------
-- Are two accounts standing near each other, by the server's positions?
create or replace function public._econ_near(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.player_pos pa join public.player_pos pb on pb.account_id = p_b and pb.map = pa.map
     where pa.account_id = p_a
       and pa.at > now() - make_interval(mins => public._econ_rule('trade_pos_min'))
       and pb.at > now() - make_interval(mins => public._econ_rule('trade_pos_min'))
       and (pa.x - pb.x)::bigint * (pa.x - pb.x) + (pa.y - pb.y)::bigint * (pa.y - pb.y)
           <= public._econ_rule('trade_px')::bigint * public._econ_rule('trade_px'))
$$;
revoke all on function public._econ_near(uuid, uuid) from public, anon, authenticated;

-- Normalise and check an offer {coins, items: [{kind, ref, qty}]} of p_owner; returns it with names and values.
create or replace function public._econ_offer(p_owner uuid, p_offer jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_coins bigint; v_items jsonb := '[]'::jsonb; e jsonb; v_kind text; v_ref text; v_qty integer; v_value integer;
        v_seen text[] := '{}'; v_key text;
begin
  if p_offer is null or jsonb_typeof(p_offer) <> 'object' then raise exception 'bad offer' using errcode = '22023'; end if;
  v_coins := coalesce((p_offer->>'coins')::bigint, 0);
  if v_coins < 0 or v_coins > 100000000 then raise exception 'bad offer' using errcode = '22023'; end if;
  if v_coins > coalesce((select coins from public.wallets where account_id = p_owner), 0) then
    raise exception 'insufficient funds' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_offer->'items', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_offer->'items', '[]'::jsonb)) > public._econ_rule('trade_items') then
    raise exception 'bad offer' using errcode = '22023';
  end if;
  for e in select * from jsonb_array_elements(coalesce(p_offer->'items', '[]'::jsonb)) loop
    v_kind := e->>'kind'; v_ref := e->>'ref';
    v_qty := case when v_kind = 'produce' then (e->>'qty')::integer else 1 end;
    v_key := v_kind || ':' || coalesce(v_ref, '');
    if v_kind is null or v_kind not in ('fish','fashion','produce') or v_ref is null or v_key = any(v_seen) then
      raise exception 'bad offer' using errcode = '22023';
    end if;
    v_seen := v_seen || v_key;
    v_value := public._econ_value(p_owner, v_kind, v_ref, v_qty, public._econ_reserved(p_owner, v_kind, v_ref));
    if v_value is null then raise exception 'not owned' using errcode = '53400'; end if;
    v_items := v_items || jsonb_build_array(public._econ_asset_json(v_kind, v_ref, v_qty, v_value, public._econ_name(v_kind, v_ref, v_qty)));
  end loop;
  return jsonb_build_object('coins', v_coins, 'items', v_items);
end $$;
revoke all on function public._econ_offer(uuid, jsonb) from public, anon, authenticated;

create or replace function public._econ_offer_value(p_offer jsonb) returns bigint
language sql immutable set search_path = public, extensions
as $$
  select coalesce((p_offer->>'coins')::bigint, 0)
       + coalesce((select sum((e->>'value')::bigint) from jsonb_array_elements(coalesce(p_offer->'items', '[]'::jsonb)) e), 0)
$$;
revoke all on function public._econ_offer_value(jsonb) from public, anon, authenticated;

create or replace function public._econ_trade_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'trade', (select jsonb_build_object(
                'id', t.id, 'rev', t.rev, 'status', t.status, 'opener', t.a = p_account,
                'partner_id', case when t.a = p_account then t.b else t.a end,
                'partner_name', public._news_name(case when t.a = p_account then t.b else t.a end),
                'mine', case when t.a = p_account then t.a_offer else t.b_offer end,
                'theirs', case when t.a = p_account then t.b_offer else t.a_offer end,
                'my_ok', case when t.a = p_account then t.a_ok else t.b_ok end,
                'their_ok', case when t.a = p_account then t.b_ok else t.a_ok end,
                'updated_ms', public._apt_ms(t.updated_at))
                from public.econ_trades t where t.status = 'open' and p_account in (t.a, t.b) limit 1),
    'last_done', (select jsonb_build_object('id', t.id, 'partner_name', public._news_name(case when t.a = p_account then t.b else t.a end),
                                            'status', t.status, 'at_ms', public._apt_ms(t.updated_at))
                    from public.econ_trades t where t.status <> 'open' and p_account in (t.a, t.b)
                     and t.updated_at > now() - interval '30 seconds' order by t.updated_at desc limit 1),
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._econ_trade_json(uuid) from public, anon, authenticated;

create or replace function public.trade_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  update public.econ_trades set status = 'cancelled', updated_at = now()
   where status = 'open' and v_account in (a, b)
     and updated_at < now() - make_interval(mins => public._econ_rule('trade_idle_min'));
  return public._econ_trade_json(v_account);
end $$;

-- Open a trade window with p_partner, a member of room p_room standing near me (server positions).
create or replace function public.trade_open(p_room_id uuid, p_session_token text, p_partner uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_partner is null or p_partner = v_account then raise exception 'bad partner' using errcode = '22023'; end if;
  if not exists (select 1 from public.members where room_id = p_room_id and account_id = p_partner) then
    raise exception 'bad partner' using errcode = '22023';
  end if;
  -- both accounts, one at a time
  perform pg_advisory_xact_lock(hashtext('econ_trade'), hashtext(least(v_account, p_partner)::text));
  perform pg_advisory_xact_lock(hashtext('econ_trade'), hashtext(greatest(v_account, p_partner)::text));
  update public.econ_trades set status = 'cancelled', updated_at = now()
   where status = 'open' and (v_account in (a, b) or p_partner in (a, b))
     and updated_at < now() - make_interval(mins => public._econ_rule('trade_idle_min'));
  if exists (select 1 from public.econ_trades where status = 'open' and v_account in (a, b)) then
    raise exception 'already trading' using errcode = '53400';
  end if;
  if exists (select 1 from public.econ_trades where status = 'open' and p_partner in (a, b)) then
    raise exception 'partner busy' using errcode = '53400';
  end if;
  if not public._econ_near(v_account, p_partner) then raise exception 'too far' using errcode = '53400'; end if;
  insert into public.econ_trades (a, b, room_id) values (v_account, p_partner, p_room_id);
  return public._econ_trade_json(v_account);
end $$;

-- Replace my side of the offer. Both confirmations reset.
create or replace function public.trade_offer(p_session_token text, p_trade bigint, p_offer jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); t public.econ_trades; v_offer jsonb;
begin
  select * into t from public.econ_trades where id = p_trade for update;
  if not found or t.status <> 'open' or v_account not in (t.a, t.b) then raise exception 'no trade' using errcode = '53400'; end if;
  v_offer := public._econ_offer(v_account, p_offer);
  update public.econ_trades
     set a_offer = case when t.a = v_account then v_offer else a_offer end,
         b_offer = case when t.b = v_account then v_offer else b_offer end,
         a_ok = false, b_ok = false, rev = rev + 1, updated_at = now()
   where id = t.id;
  return public._econ_trade_json(v_account);
end $$;

-- Confirm the trade as it stands at revision p_rev; when both have confirmed, the swap happens at once, atomically:
-- positions, coins and every asset are checked again under their locks.
create or replace function public.trade_confirm(p_session_token text, p_trade bigint, p_rev integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); t public.econ_trades; e jsonb; a_off jsonb; b_off jsonb;
        v_a bigint; v_b bigint; v_net bigint;
begin
  select * into t from public.econ_trades where id = p_trade for update;
  if not found or t.status <> 'open' or v_account not in (t.a, t.b) then raise exception 'no trade' using errcode = '53400'; end if;
  if p_rev is distinct from t.rev then raise exception 'offer changed' using errcode = '53400'; end if;
  if t.a = v_account then t.a_ok := true; else t.b_ok := true; end if;
  update public.econ_trades set a_ok = t.a_ok, b_ok = t.b_ok, updated_at = now() where id = t.id;
  if not (t.a_ok and t.b_ok) then return public._econ_trade_json(v_account); end if;
  -- the swap
  if not public._econ_near(t.a, t.b) then raise exception 'too far' using errcode = '53400'; end if;
  if coalesce((t.a_offer->>'coins')::bigint, 0) = 0 and jsonb_array_length(t.a_offer->'items') = 0
     and coalesce((t.b_offer->>'coins')::bigint, 0) = 0 and jsonb_array_length(t.b_offer->'items') = 0 then
    raise exception 'empty trade' using errcode = '53400';
  end if;
  perform public._econ_lock2(t.a, t.b);
  -- the offers again, as they are now (a changed holding raises; nothing moves)
  a_off := public._econ_offer(t.a, t.a_offer);
  b_off := public._econ_offer(t.b, t.b_offer);
  for e in select * from jsonb_array_elements(a_off->'items') loop
    perform public._econ_move(t.a, t.b, e->>'kind', e->>'ref', (e->>'qty')::integer);
  end loop;
  for e in select * from jsonb_array_elements(b_off->'items') loop
    perform public._econ_move(t.b, t.a, e->>'kind', e->>'ref', (e->>'qty')::integer);
  end loop;
  v_net := (b_off->>'coins')::bigint - (a_off->>'coins')::bigint;          -- what a gains
  if v_net <> 0 then
    perform public._pay(t.a, v_net::integer, 'trade', 'trade #' || t.id);
    perform public._pay(t.b, (-v_net)::integer, 'trade', 'trade #' || t.id);
  end if;
  update public.econ_trades set status = 'done', a_offer = a_off, b_offer = b_off, updated_at = now() where id = t.id;
  perform public._game_event(t.a, 'trade_done', 1, jsonb_build_object('trade', t.id, 'partner', t.b));
  perform public._game_event(t.b, 'trade_done', 1, jsonb_build_object('trade', t.id, 'partner', t.a));
  v_a := public._econ_offer_value(a_off);
  v_b := public._econ_offer_value(b_off);
  -- the collusion guard: "seller" = the side giving more
  perform public._econ_deal(case when v_a >= v_b then t.a else t.b end, case when v_a >= v_b then t.b else t.a end,
    'trade', t.id, least(greatest(v_a, v_b), 2000000000)::integer, least(least(v_a, v_b), 2000000000)::integer,
    greatest(v_a, v_b) >= public._econ_rule('skew_floor')
      and greatest(v_a, v_b) >= least(v_a, v_b) * public._econ_rule('skew_trade'));
  return public._econ_trade_json(v_account);
end $$;

create or replace function public.trade_cancel(p_session_token text, p_trade bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  update public.econ_trades set status = 'cancelled', updated_at = now()
   where id = p_trade and status = 'open' and v_account in (a, b);
  return public._econ_trade_json(v_account);
end $$;

-- ---------- F. The wipe ----------
create or replace function public._econ_on_wipe() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare x public.econ_auctions;
begin
  if new.ban_state = 'wiped' and old.ban_state is distinct from 'wiped' then
    update public.econ_listings set status = 'cancelled', closed_at = now() where seller = new.account_id and status = 'open';
    for x in select * from public.econ_auctions where seller = new.account_id and status = 'open' for update loop
      if x.top_bidder is not null then
        perform public._wallet_lock(x.top_bidder);
        perform public._pay(x.top_bidder, x.top_bid, 'auction_refund', 'auction #' || x.id || ': seller wiped');
      end if;
      update public.econ_auctions set status = 'cancelled', closed_at = now() where id = x.id;
    end loop;
    -- the wiped account's escrowed top bids are forfeited (burned); the auction goes on without a bid
    update public.econ_auctions set top_bid = null, top_bidder = null where top_bidder = new.account_id and status = 'open';
    update public.econ_stalls set renter = null, paid_until = null where renter = new.account_id;
    update public.econ_trades set status = 'cancelled', updated_at = now()
     where status = 'open' and new.account_id in (a, b);
  end if;
  return new;
end $$;
revoke all on function public._econ_on_wipe() from public, anon, authenticated;
drop trigger if exists anticheat_status_econ_wipe on public.anticheat_status;
create trigger anticheat_status_econ_wipe after update of ban_state on public.anticheat_status
  for each row execute function public._econ_on_wipe();

-- ---------- grants ----------
do $$
declare s text;
begin
  foreach s in array array[
    'econ_state(text)', 'market_list(text, text, text, integer, integer)', 'market_cancel(text, bigint)',
    'market_buy(text, bigint, integer)', 'auction_create(text, text, text, integer, integer, integer)',
    'auction_bid(text, bigint, integer)', 'auction_cancel(text, bigint)', 'shop_rent(text, integer, integer)',
    'shop_stock(text, text, text, integer, integer)', 'shop_buy(text, bigint, integer)',
    'trade_state(text)', 'trade_open(uuid, text, uuid)', 'trade_offer(text, bigint, jsonb)',
    'trade_confirm(text, bigint, integer)', 'trade_cancel(text, bigint)'] loop
    execute format('revoke all on function public.%s from public', s);
    execute format('grant execute on function public.%s to anon, authenticated', s);
  end loop;
end $$;
