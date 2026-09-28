-- tests/sql/v21-economy-smoke.sql — 0073 (player trading, the market, the auction house, the stalls, the collusion
-- guard). Run as the superuser on the throwaway cluster after the full chain (0004 … 0069, then 0073), from the repo
-- root. It re-applies 0073 twice (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0073_player_economy.sql
\i supabase/migrations/0073_player_economy.sql
reset client_min_messages;

create temp table ec (k text primary key, v text);
insert into ec select 'a', token from public.register('ec_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into ec select 'b', token from public.register('ec_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into ec select 'c', token from public.register('ec_c_' || floor(random() * 1e9)::text, 'pw123456');
create temp view ecv as select (select v from ec where k = 'a') ta, (select v from ec where k = 'b') tb,
  (select v from ec where k = 'c') tc,
  public._auth_account((select v from ec where k = 'a')) a, public._auth_account((select v from ec where k = 'b')) b,
  public._auth_account((select v from ec where k = 'c')) c;
insert into public.rooms (code, name) values ('ECSMK' || floor(random() * 1e6)::text, 'smoke') returning id \gset room_
insert into ec values ('room', :'room_id');
insert into public.members (room_id, account_id) select :'room_id'::uuid, a from ecv;
insert into public.members (room_id, account_id) select :'room_id'::uuid, b from ecv;
insert into public.members (room_id, account_id) select :'room_id'::uuid, c from ecv;

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;
create or replace function pg_temp.coins(p uuid) returns int language sql as $$ select coins from public.wallets where account_id = p $$;
create or replace function pg_temp.pos(p uuid, m text, x int, y int) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (p, m, x, y, now())
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at $$;

-- 1) rules, privileges, holdings (the fixed fish ids of an earlier run go first)
delete from public.fish where id::text like '00000000-0000-4000-8000-00000000ec0_';
update public.econ_stalls set renter = null, paid_until = null;
do $$ declare x ecv; begin
  select * into x from ecv;
  assert public._econ_rule('fee') = 5 and public._econ_rule('min') = 50 and public._econ_rule('max') = 300, 'rules';
  assert public._econ_in_band(50, 100) and not public._econ_in_band(49, 100), 'floor';
  assert public._econ_in_band(300, 100) and not public._econ_in_band(301, 100), 'ceiling';
  assert public._econ_list_fee(100) = 5 and public._econ_list_fee(1000) = 20, 'listing fee';
  assert public._econ_min_bid(400, null) = 400 and public._econ_min_bid(400, 400) = 420 and public._econ_min_bid(100, 100) = 110, 'min bid';
  assert not has_function_privilege('anon', 'public._econ_move(uuid, uuid, text, text, integer)', 'execute'), 'helper private';
  assert not has_function_privilege('anon', 'public._econ_sweep()', 'execute'), 'sweep private';
  assert has_function_privilege('anon', 'public.market_buy(text, bigint, integer)', 'execute'), 'rpc callable';
  assert has_function_privilege('anon', 'public.trade_open(uuid, text, uuid)', 'execute'), 'trade callable';
  perform public._wallet_lock(x.a); perform public._pay(x.a, 100000, 'daily', 'smoke');
  perform public._wallet_lock(x.b); perform public._pay(x.b, 100000, 'daily', 'smoke');
  perform public._wallet_lock(x.c); perform public._pay(x.c, 100000, 'daily', 'smoke');
  -- a: two fish (400 and 50 xu), a priced fashion item, 20 kg of khoai
  insert into public.fish (id, account_id, species_id, weight_g, price) values
    ('00000000-0000-4000-8000-00000000ec01', x.a, 'ca_ro', 800, 400), ('00000000-0000-4000-8000-00000000ec02', x.a, 'ca_ro', 200, 50);
  insert into public.inventory (account_id, item_id, qty)
    select x.b, s.id, 1 from public.shop_items s where s.kind = 'bucket' order by s.capacity desc limit 1;
  insert into public.account_items (account_id, item_id) values (x.a, 'shoes_dep_green');
  insert into public.produce_stock (account_id, upland, kg) values (x.a, 'khoai', 20);
end $$;

-- 2) the board: list, band, fee, reservation, buy, 5 % burned, event, expiry refund
do $$ declare x ecv; j jsonb; v_id bigint; v_a int; v_b int; begin
  select * into x from ecv;
  j := public.econ_state(x.ta);
  assert jsonb_array_length(j->'assets') = 4, 'a sees 4 assets: ' || (j->'assets')::text;
  assert pg_temp.fails(format('select public.market_list(%L, ''fish'', ''00000000-0000-4000-8000-00000000ec01'', 1, 1201)', x.ta), 'bad price'), 'ceiling';
  assert pg_temp.fails(format('select public.market_list(%L, ''fish'', ''00000000-0000-4000-8000-00000000ec01'', 1, 199)', x.ta), 'bad price'), 'floor';
  assert pg_temp.fails(format('select public.market_list(%L, ''fish'', ''00000000-0000-4000-8000-00000000ec09'', 1, 400)', x.ta), 'not owned'), 'not mine';
  assert pg_temp.fails(format('select public.market_list(%L, ''fashion'', ''shoes_dep_blue'', 1, 400)', x.tb), 'not owned'), 'starter not tradeable';
  v_a := pg_temp.coins(x.a);
  j := public.market_list(x.ta, 'fish', '00000000-0000-4000-8000-00000000ec01', 1, 600);
  assert pg_temp.coins(x.a) = v_a - 12, 'listing fee 2 %';
  v_id := (select id from public.econ_listings where seller = x.a and status = 'open' and asset_kind = 'fish');
  assert pg_temp.fails(format('select public.market_list(%L, ''fish'', ''00000000-0000-4000-8000-00000000ec01'', 1, 600)', x.ta), 'not owned'), 'no double listing';
  assert pg_temp.fails(format('select public.market_buy(%L, %s, 600)', x.ta, v_id), 'own listing'), 'own';
  assert pg_temp.fails(format('select public.market_buy(%L, %s, 500)', x.tb, v_id), 'price changed'), 'price seen';
  v_a := pg_temp.coins(x.a); v_b := pg_temp.coins(x.b);
  j := public.market_buy(x.tb, v_id, 600);
  assert pg_temp.coins(x.b) = v_b - 600 and pg_temp.coins(x.a) = v_a + 570, 'paid 95 %';
  assert (select account_id from public.fish where id = '00000000-0000-4000-8000-00000000ec01') = x.b, 'fish moved';
  assert (select status from public.econ_listings where id = v_id) = 'sold', 'sold';
  assert exists (select 1 from public.game_events where account_id = x.a and kind = 'market_sold' and qty = 600), 'market_sold event';
  assert exists (select 1 from public.coin_ledger where account_id = x.b and reason = 'market_buy' and delta = -600), 'ledger buy';
  assert pg_temp.fails(format('select public.market_buy(%L, %s, 600)', x.tc, v_id), 'no listing'), 'sold once';
  -- produce: reserve 15 of 20 kg; the 6 kg more is refused; expiry refunds half the fee
  j := public.market_list(x.ta, 'produce', 'khoai', 15, 265 * 15);
  assert pg_temp.fails(format('select public.market_list(%L, ''produce'', ''khoai'', 6, 265 * 6)', x.ta), 'not owned'), 'reserved kg';
  v_id := (select id from public.econ_listings where seller = x.a and status = 'open' and asset_kind = 'produce');
  update public.econ_listings set expires_at = now() - interval '1 second' where id = v_id;
  v_a := pg_temp.coins(x.a);
  perform public.econ_state(x.ta);
  assert (select status from public.econ_listings where id = v_id) = 'expired', 'expired';
  assert pg_temp.coins(x.a) = v_a + public._econ_list_fee(265 * 15) / 2, 'half the fee back';
  -- stale: a listing whose asset left is voided by the sweep
  j := public.market_list(x.ta, 'fish', '00000000-0000-4000-8000-00000000ec02', 1, 50);
  v_id := (select id from public.econ_listings where seller = x.a and status = 'open' and asset_kind = 'fish');
  delete from public.fish where id = '00000000-0000-4000-8000-00000000ec02';
  perform public.econ_state(x.tc);
  assert (select status from public.econ_listings where id = v_id) = 'void', 'void';
end $$;

-- 3) the auction house: rare only, escrow, outbid refund, anti-snipe, lazy settlement
do $$ declare x ecv; j jsonb; v_id bigint; v_b int; v_c int; v_a int; begin
  select * into x from ecv;
  insert into public.fish (id, account_id, species_id, weight_g, price) values ('00000000-0000-4000-8000-00000000ec03', x.a, 'ca_ro', 900, 1000);
  assert pg_temp.fails(format('select public.auction_create(%L, ''fashion'', ''shoes_dep_green'', 1, 60, 1)', x.ta), 'not rare'), 'rare only';
  assert pg_temp.fails(format('select public.auction_create(%L, ''fish'', ''00000000-0000-4000-8000-00000000ec03'', 1, 1000, 2)', x.ta), 'bad hours'), 'hours';
  j := public.auction_create(x.ta, 'fish', '00000000-0000-4000-8000-00000000ec03', 1, 1000, 1);
  v_id := (select id from public.econ_auctions where seller = x.a and status = 'open');
  assert pg_temp.fails(format('select public.auction_bid(%L, %s, 999)', x.tb, v_id), 'bid too low'), 'start';
  assert pg_temp.fails(format('select public.auction_bid(%L, %s, 5001)', x.tb, v_id), 'bid too high'), 'cap 500 %';
  v_b := pg_temp.coins(x.b); v_c := pg_temp.coins(x.c);
  j := public.auction_bid(x.tb, v_id, 1000);
  assert pg_temp.coins(x.b) = v_b - 1000, 'escrowed';
  assert pg_temp.fails(format('select public.auction_bid(%L, %s, 1049)', x.tc, v_id), 'bid too low'), 'min raise 5 %';
  j := public.auction_bid(x.tc, v_id, 1050);
  assert pg_temp.coins(x.b) = v_b and pg_temp.coins(x.c) = v_c - 1050, 'outbid refunded';
  assert (select ends_at from public.econ_auctions where id = v_id) > now() + interval '59 minutes', 'no extension early';
  assert pg_temp.fails(format('select public.auction_cancel(%L, %s)', x.ta, v_id), 'cannot cancel'), 'no cancel with bids';
  update public.econ_auctions set ends_at = now() + interval '30 seconds' where id = v_id;
  j := public.auction_bid(x.tb, v_id, 1200);
  assert (select ends_at from public.econ_auctions where id = v_id) >= now() + interval '119 seconds', 'anti-snipe';
  assert pg_temp.coins(x.c) = v_c, 'c refunded';
  update public.econ_auctions set ends_at = now() - interval '1 second' where id = v_id;
  v_a := pg_temp.coins(x.a);
  perform public.econ_state(x.tc);
  assert (select status from public.econ_auctions where id = v_id) = 'sold', 'settled lazily';
  assert pg_temp.coins(x.a) = v_a + 1140, 'seller 95 %';
  assert (select account_id from public.fish where id = '00000000-0000-4000-8000-00000000ec03') = x.b, 'fish to winner';
  assert exists (select 1 from public.game_events where account_id = x.b and kind = 'auction_won' and qty = 1200), 'auction_won';
  -- a voided auction refunds the top bid
  insert into public.fish (id, account_id, species_id, weight_g, price) values ('00000000-0000-4000-8000-00000000ec04', x.a, 'ca_ro', 900, 1000);
  j := public.auction_create(x.ta, 'fish', '00000000-0000-4000-8000-00000000ec04', 1, 1000, 1);
  v_id := (select id from public.econ_auctions where seller = x.a and status = 'open');
  v_c := pg_temp.coins(x.c);
  j := public.auction_bid(x.tc, v_id, 1000);
  delete from public.fish where id = '00000000-0000-4000-8000-00000000ec04';
  update public.econ_auctions set ends_at = now() - interval '1 second' where id = v_id;
  perform public.econ_state(x.tc);
  assert (select status from public.econ_auctions where id = v_id) = 'void' and pg_temp.coins(x.c) = v_c, 'void refunds';
end $$;

-- 4) the stalls: position, rent, stock, offline sale
do $$ declare x ecv; j jsonb; v_id bigint; v_a int; begin
  select * into x from ecv;
  perform pg_temp.pos(x.a, 'market', 560, 360);
  perform pg_temp.pos(x.c, 'pond', 100, 100);
  j := public.shop_rent(x.tc, 1, 1);
  assert j ? 'anticheat', 'not at market: the envelope';
  assert (select renter from public.econ_stalls where no = 1) is null, 'not rented';
  assert pg_temp.fails(format('select public.shop_rent(%L, 2, 8)', x.ta), 'bad days'), 'days';
  v_a := pg_temp.coins(x.a);
  j := public.shop_rent(x.ta, 2, 2);
  assert pg_temp.coins(x.a) = v_a - 400 and (select renter from public.econ_stalls where no = 2) = x.a, 'rented';
  assert pg_temp.fails(format('select public.shop_rent(%L, 3, 1)', x.ta), 'already renting'), 'one stall';
  j := public.shop_stock(x.ta, 'fashion', 'shoes_dep_green', 1, 100);
  v_id := (select id from public.econ_listings where seller = x.a and stall_no = 2 and status = 'open');
  assert pg_temp.fails(format('select public.market_buy(%L, %s, 100)', x.tb, v_id), 'no listing'), 'stall items are not on the board';
  perform pg_temp.pos(x.b, 'market', 560, 360);
  perform pg_temp.pos(x.a, 'hall', 612, 300);                                   -- the owner is away
  v_a := pg_temp.coins(x.a);
  j := public.shop_buy(x.tb, v_id, 100);
  assert pg_temp.coins(x.a) = v_a + 95, 'shop_sell 95 %';
  assert exists (select 1 from public.account_items where account_id = x.b and item_id = 'shoes_dep_green'), 'item moved';
  assert not exists (select 1 from public.account_items where account_id = x.a and item_id = 'shoes_dep_green'), 'item gone';
  assert exists (select 1 from public.coin_ledger where account_id = x.b and reason = 'shop_buy'), 'shop_buy';
  -- the rent lapses: the stall frees
  update public.econ_stalls set paid_until = now() - interval '1 second' where no = 2;
  perform public.econ_state(x.tb);
  assert (select renter from public.econ_stalls where no = 2) is null, 'lapsed';
end $$;

-- 5) trading: nearness, offers, revisions, the atomic swap, the collusion guard
do $$ declare x ecv; j jsonb; v_t bigint; v_rev int; v_a int; v_b int; v_room uuid := (select v::uuid from ec where k = 'room'); begin
  select * into x from ecv;
  perform pg_temp.pos(x.a, 'hall', 400, 300);
  perform pg_temp.pos(x.b, 'pond', 400, 300);
  assert pg_temp.fails(format('select public.trade_open(%L, %L, %L)', v_room, x.ta, x.b), 'too far'), 'other map';
  perform pg_temp.pos(x.b, 'hall', 500, 350);
  j := public.trade_open(v_room, x.ta, x.b);
  v_t := (j->'trade'->>'id')::bigint;
  assert pg_temp.fails(format('select public.trade_open(%L, %L, %L)', v_room, x.tc, x.a), 'partner busy'), 'one at a time';
  j := public.trade_state(x.tb);
  assert (j->'trade'->>'id')::bigint = v_t and j->'trade'->>'partner_name' is not null, 'b sees it';
  assert pg_temp.fails(format('select public.trade_offer(%L, %s, %L)', x.ta, v_t, '{"coins": 0, "items": [{"kind": "produce", "ref": "khoai", "qty": 21}]}'), 'not owned'), 'too much';
  j := public.trade_offer(x.ta, v_t, '{"coins": 10, "items": [{"kind": "produce", "ref": "khoai", "qty": 5}]}');
  j := public.trade_offer(x.tb, v_t, '{"coins": 1000, "items": []}');
  v_rev := (j->'trade'->>'rev')::int;
  assert pg_temp.fails(format('select public.trade_confirm(%L, %s, %s)', x.ta, v_t, v_rev - 1), 'offer changed'), 'rev';
  j := public.trade_confirm(x.ta, v_t, v_rev);
  assert (j->'trade'->>'my_ok')::boolean and not (j->'trade'->>'their_ok')::boolean, 'a ok';
  v_a := pg_temp.coins(x.a); v_b := pg_temp.coins(x.b);
  j := public.trade_confirm(x.tb, v_t, v_rev);
  assert j->'trade' = 'null'::jsonb or j->'trade' is null, 'closed';
  assert (select status from public.econ_trades where id = v_t) = 'done', 'done';
  assert pg_temp.coins(x.a) = v_a + 990 and pg_temp.coins(x.b) = v_b - 990, 'net coins';
  assert (select kg from public.produce_stock where account_id = x.b and upland = 'khoai') = 5, 'produce moved';
  assert (select kg from public.produce_stock where account_id = x.a and upland = 'khoai') = 15, 'produce left';
  assert (select count(*) from public.game_events where kind = 'trade_done' and (meta->>'trade')::bigint = v_t) = 2, 'trade_done x2';
  -- a changed offer resets both confirmations
  j := public.trade_open(v_room, x.tb, x.a);
  v_t := (j->'trade'->>'id')::bigint;
  j := public.trade_offer(x.tb, v_t, '{"coins": 1000, "items": []}');
  j := public.trade_confirm(x.ta, v_t, (j->'trade'->>'rev')::int);
  j := public.trade_offer(x.tb, v_t, '{"coins": 900, "items": []}');
  assert not (j->'trade'->>'my_ok')::boolean and not (j->'trade'->>'their_ok')::boolean, 'reset';
  -- three one-sided gifts in a week: soft econ_collusion on both
  j := public.trade_confirm(x.ta, v_t, (j->'trade'->>'rev')::int);
  j := public.trade_confirm(x.tb, v_t, (j->'trade'->>'rev')::int);
  j := public.trade_open(v_room, x.tb, x.a); v_t := (j->'trade'->>'id')::bigint;
  j := public.trade_offer(x.tb, v_t, '{"coins": 900, "items": []}');
  j := public.trade_confirm(x.ta, v_t, (j->'trade'->>'rev')::int);
  j := public.trade_confirm(x.tb, v_t, (j->'trade'->>'rev')::int);
  assert not exists (select 1 from public.anticheat_events where account_id = x.b and code = 'econ_collusion'), 'not yet';
  j := public.trade_open(v_room, x.tb, x.a); v_t := (j->'trade'->>'id')::bigint;
  j := public.trade_offer(x.tb, v_t, '{"coins": 900, "items": []}');
  j := public.trade_confirm(x.ta, v_t, (j->'trade'->>'rev')::int);
  j := public.trade_confirm(x.tb, v_t, (j->'trade'->>'rev')::int);
  assert exists (select 1 from public.anticheat_events where account_id = x.b and code = 'econ_collusion' and outcome = 'soft'), 'flagged b';
  assert exists (select 1 from public.anticheat_events where account_id = x.a and code = 'econ_collusion' and outcome = 'soft'), 'flagged a';
  -- moving away before the second confirmation stops the swap
  j := public.trade_open(v_room, x.tb, x.a); v_t := (j->'trade'->>'id')::bigint;
  j := public.trade_offer(x.tb, v_t, '{"coins": 5, "items": []}');
  j := public.trade_confirm(x.ta, v_t, (j->'trade'->>'rev')::int);
  perform pg_temp.pos(x.b, 'field', 10, 10);
  assert pg_temp.fails(format('select public.trade_confirm(%L, %s, %s)', x.tb, v_t, (j->'trade'->>'rev')::int), 'too far'), 'swap needs nearness';
  j := public.trade_cancel(x.tb, v_t);
  assert (select status from public.econ_trades where id = v_t) = 'cancelled', 'cancelled';
end $$;

-- 6) the wipe trigger
do $$ declare x ecv; j jsonb; begin
  select * into x from ecv;
  j := public.market_list(x.ta, 'produce', 'khoai', 5, 265 * 5);
  insert into public.anticheat_status (account_id) values (x.a) on conflict (account_id) do nothing;
  update public.anticheat_status set ban_state = 'wiped' where account_id = x.a;
  assert not exists (select 1 from public.econ_listings where seller = x.a and status = 'open'), 'wiped listings';
  update public.anticheat_status set ban_state = null where account_id = x.a;
end $$;

select 'v21 economy smoke: ok' as result;
