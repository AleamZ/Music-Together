-- tests/sql/mailbox-smoke.sql — 0111 (Hòm thư and gift codes). Run as the superuser on the throwaway cluster after the
-- full chain (… 0106, 0111), from the repo root. It re-runs 0111 twice with \i. Every check is an ASSERT. It registers
-- its own accounts (one of them root), restores the flags and the mode it changes, and deletes its accounts, room,
-- codes and gift batches at the end.
--   0. Privileges: the tables and helpers are private, the RPCs callable; the ledger takes admin_gift / gift_code.
--   1. A trade delivers into both mailboxes: the payer pays at once, the receiver's xu (less the burn) and items wait;
--      an escrowed fish is not a fish (not sellable, not listable); the claim pays with 'trade', once — a second claim
--      and another account's claim are refused; trade_daily_in counts the mail, not the claim.
--   2. Room: a fish mail to a full bucket is refused ('bucket full') and stays; 'bag full' for a stack over 99;
--      mail_claim_all claims the rest and lists the refusal.
--   3. The board, a stall-less purchase and an auction deliver by mail (the buyer's goods, the seller's share).
--   4. Admin gifts: root only; {usernames} (missing names listed), {all}; the claim pays 'admin_gift'.
--   5. Gift codes: case-insensitive, once per account, max_uses, expiry, not started, disabled, a code mail (not a
--      grant); the brute-force lock after 10 failures (soft code_bruteforce), even for a good code.
--   6. Expiry: an unclaimed trade mail returns to its giver; a market mail is dropped with its escrowed fish.
--   7. Delete only claimed or empty mail; the wipe drops the unclaimed mail.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0111_mailbox.sql
\i supabase/migrations/0111_mailbox.sql
-- 0113 re-creates functions of this migration: re-run it after, as the chain does
\i supabase/migrations/0113_review_fixes.sql
\i supabase/migrations/0113_review_fixes.sql
reset client_min_messages;

create temp table mx_was (k text primary key, v text);
insert into mx_was values ('mode', (select mode from public.anticheat_config where id)),
                          ('rooms', (select enabled::text from public.app_flags where key = 'room_creation_open'));
update public.anticheat_config set mode = 'log';
update public.app_flags set enabled = true where key = 'room_creation_open';

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;
create or replace function pg_temp.coins(p uuid) returns int language sql as $$ select coins from public.wallets where account_id = p $$;
create or replace function pg_temp.fund(p uuid, n int) returns void language plpgsql as $$
begin
  perform public._wallet_lock(p);
  update public.wallets set coins = n where account_id = p;
end $$;
create or replace function pg_temp.pos(p uuid, m text, x int, y int) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (p, m, x, y, now())
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at $$;
create temp table px (k text primary key, t text, a uuid, n text);
create temp table rx (k text primary key, id uuid);
create or replace function pg_temp.acc(p_k text, p_days int, p_level int) returns uuid language plpgsql as $$
declare v_t text; v_a uuid; v_n text := 'mbx_' || p_k || '_' || floor(random() * 1e9)::text;
begin
  select token into v_t from public.register(v_n, 'pw123456');
  v_a := public._auth_account(v_t);
  update public.accounts set created_at = now() - make_interval(days => p_days) where id = v_a;
  insert into public.player_progress (account_id, xp, level) values (v_a, public._pg_xp_at(p_level), p_level)
  on conflict (account_id) do update set xp = excluded.xp, level = excluded.level;
  insert into px values (p_k, v_t, v_a, v_n);
  return v_a;
end $$;
create or replace function pg_temp.a(p_k text) returns uuid language sql as $$ select a from px where k = p_k $$;
create or replace function pg_temp.t(p_k text) returns text language sql as $$ select t from px where k = p_k $$;
create or replace function pg_temp.n(p_k text) returns text language sql as $$ select n from px where k = p_k $$;
create or replace function pg_temp.room() returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from rx where k = 'r';
  if v is null then
    insert into public.rooms (code, name) values ('MBX' || floor(random() * 1e6)::text, 'mailbox smoke') returning id into v;
    insert into rx values ('r', v);
  end if;
  return v;
end $$;
create or replace function pg_temp.trade(a text, b text, a_off jsonb, b_off jsonb) returns text language plpgsql as $$
declare j jsonb; v_t bigint;
begin
  j := public.trade_open(pg_temp.room(), pg_temp.t(a), pg_temp.a(b));
  v_t := (j->'trade'->>'id')::bigint;
  j := public.trade_offer(pg_temp.t(a), v_t, a_off);
  j := public.trade_offer(pg_temp.t(b), v_t, b_off);
  j := public.trade_confirm(pg_temp.t(a), v_t, (j->'trade'->>'rev')::int);
  begin
    j := public.trade_confirm(pg_temp.t(b), v_t, (j->'trade'->>'rev')::int);
  exception when others then
    perform public.trade_cancel(pg_temp.t(b), v_t);
    return sqlerrm;
  end;
  return 'done';
end $$;
-- the newest unclaimed mail of an account (of a kind)
create or replace function pg_temp.mail(p_k text, p_kind text) returns bigint language sql as $$
  select id from public.mail where account_id = pg_temp.a(p_k) and kind = p_kind and claimed_at is null and deleted_at is null
   order by id desc limit 1 $$;
create or replace function pg_temp.fish(p_id text, p_owner uuid, p_price int) returns void language sql as $$
  insert into public.fish (id, account_id, species_id, weight_g, price) values (p_id::uuid, p_owner, 'ca_ro', 800, p_price) $$;

-- ---------- 0. Privileges ----------
do $$
declare s text;
begin
  foreach s in array array['mail', 'mail_items', 'mail_fish', 'mail_batches', 'gift_codes', 'gift_code_redemptions', 'gift_code_attempts'] loop
    assert not has_table_privilege('anon', 'public.' || s, 'select'), s || ' private';
  end loop;
  foreach s in array array['_mail_new(uuid,text,uuid,text,text,text,text,uuid)', '_mail_xu(bigint,bigint,text)',
                           '_mail_take(bigint,uuid,text,text,integer)', '_mail_claim_one(uuid,bigint)', '_mail_sweep()',
                           '_mail_json(uuid)', '_mail_gift_items(jsonb)', '_mail_has_fashion(uuid,text)', '_code_rule(text)',
                           '_mail_gift_kinds()', '_mail_items_json(bigint)', '_econ_trade_left(uuid)'] loop
    assert not has_function_privilege('anon', 'public.' || s, 'execute'), s || ' private';
  end loop;
  foreach s in array array['mail_list(text)', 'mail_read(text,bigint)', 'mail_claim(text,bigint)', 'mail_claim_all(text)',
                           'mail_delete(text,bigint)', 'redeem_code(text,text)', 'admin_mail_send(text,jsonb,text,text,integer,jsonb)',
                           'admin_code_list(text)', 'admin_code_create(text,text,text,integer,jsonb,integer,timestamptz,timestamptz)',
                           'admin_code_disable(text,bigint)', 'trade_confirm(text,bigint,integer)'] loop
    assert has_function_privilege('anon', 'public.' || s, 'execute'), s || ' callable';
  end loop;
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check') like '%admin_gift%gift_code%', 'reasons';
  assert (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check') like '%''dish_sell''%', 'the old list kept';
  raise notice '0 ok';
end $$;

-- ---------- 1. A trade delivers into both mailboxes ----------
do $$
declare k text; x int := 400;
begin
  perform pg_temp.acc('ta', 4, 5); perform pg_temp.acc('tb', 4, 5); perform pg_temp.acc('tc', 4, 5); perform pg_temp.acc('td', 4, 5);
  perform pg_temp.acc('root', 30, 10);
  update public.accounts set is_root = true where id = pg_temp.a('root');
  foreach k in array array['ta', 'tb', 'tc', 'td'] loop
    insert into public.members (room_id, account_id) values (pg_temp.room(), pg_temp.a(k));
    perform pg_temp.fund(pg_temp.a(k), 100000);
    perform pg_temp.pos(pg_temp.a(k), 'hall', x, 300);
    x := x + 20;
  end loop;
  insert into public.produce_stock (account_id, upland, kg) values (pg_temp.a('tb'), 'khoai', 20)
  on conflict (account_id, upland) do update set kg = 20;
  perform pg_temp.fish('00000000-0000-4000-8000-00000000a111', pg_temp.a('ta'), 400);
end $$;
do $$
declare r text; j jsonb; v_ma bigint; v_mb bigint; v_led int;
begin
  -- ta gives 10 000 xu and a fish, tb gives 5 kg of khoai
  r := pg_temp.trade('ta', 'tb', '{"coins": 10000, "items": [{"kind": "fish", "ref": "00000000-0000-4000-8000-00000000a111"}]}',
                     '{"coins": 0, "items": [{"kind": "produce", "ref": "khoai", "qty": 5}]}');
  assert r = 'done', 'trade: ' || r;
  assert pg_temp.coins(pg_temp.a('ta')) = 90000, 'the payer pays at once';
  assert pg_temp.coins(pg_temp.a('tb')) = 100000, 'the receiver''s xu wait in the mailbox';
  v_mb := pg_temp.mail('tb', 'trade'); v_ma := pg_temp.mail('ta', 'trade');
  assert v_mb is not null and v_ma is not null, 'a mail to each side';
  assert (select xu from public.mail where id = v_mb) = 9500 and (select xu_reason from public.mail where id = v_mb) = 'trade', '95 % in the mail';
  assert (select return_to from public.mail where id = v_mb) = pg_temp.a('ta'), 'returns to the giver';
  assert (select xu from public.mail where id = v_ma) = 0, 'no xu to a';
  assert (select kg from public.produce_stock where account_id = pg_temp.a('tb') and upland = 'khoai') = 15, 'produce left b';
  assert not exists (select 1 from public.produce_stock where account_id = pg_temp.a('ta') and upland = 'khoai' and kg > 0), 'not yet at a';
  -- the escrow: the fish is no public.fish row
  assert not exists (select 1 from public.fish where id = '00000000-0000-4000-8000-00000000a111'), 'escrowed';
  assert exists (select 1 from public.mail_fish where id = '00000000-0000-4000-8000-00000000a111' and mail_id = v_mb), 'in mail_fish';
  assert pg_temp.fails(format('select public.sell_fish(%L, %L)', pg_temp.t('tb'), '{00000000-0000-4000-8000-00000000a111}'), 'fish not found'), 'b cannot sell it';
  assert pg_temp.fails(format('select public.sell_fish(%L, %L)', pg_temp.t('ta'), '{00000000-0000-4000-8000-00000000a111}'), 'fish not found'), 'a cannot sell it';
  assert pg_temp.fails(format('select public.market_list(%L, ''fish'', %L, 1, 400)', pg_temp.t('ta'), '00000000-0000-4000-8000-00000000a111'), 'not owned'), 'nor list it';
  -- the cap counts the mail, before the claim
  assert public._econ_trade_left(pg_temp.a('tb')) = 50000 - 9500, 'cap: ' || public._econ_trade_left(pg_temp.a('tb'));
  -- the list
  j := public.mail_list(pg_temp.t('tb'));
  assert (j->>'unread')::int >= 1 and (j->>'claimable')::int >= 1, 'unread: ' || j::text;
  assert (select m->'items'->0->>'kind' from jsonb_array_elements(j->'mails') m where (m->>'id')::bigint = v_mb) = 'fish', 'items shown';
  assert (select m->>'sender_name' from jsonb_array_elements(j->'mails') m where (m->>'id')::bigint = v_mb) = pg_temp.n('ta'), 'sender shown';
  j := public.mail_read(pg_temp.t('tb'), v_mb);
  assert (select read_at from public.mail where id = v_mb) is not null, 'read';
  -- another account cannot claim it
  assert pg_temp.fails(format('select public.mail_claim(%L, %s)', pg_temp.t('tc'), v_mb), 'no mail'), 'not yours';
  -- the claim, once
  j := public.mail_claim(pg_temp.t('tb'), v_mb);
  assert (j->'claimed'->>'xu')::int = 9500 and (j->>'coins')::int = 109500, 'claimed: ' || (j->'claimed')::text;
  assert pg_temp.coins(pg_temp.a('tb')) = 109500, 'paid';
  assert exists (select 1 from public.fish where id = '00000000-0000-4000-8000-00000000a111' and account_id = pg_temp.a('tb')), 'the fish is b''s';
  assert not exists (select 1 from public.mail_fish where id = '00000000-0000-4000-8000-00000000a111'), 'escrow empty';
  assert (select caught_at from public.fish where id = '00000000-0000-4000-8000-00000000a111') < now() + interval '1 second', 'same row';
  select count(*) into v_led from public.coin_ledger where account_id = pg_temp.a('tb') and ref = 'mail #' || v_mb and reason = 'trade' and delta = 9500;
  assert v_led = 1, 'one ledger row';
  assert pg_temp.fails(format('select public.mail_claim(%L, %s)', pg_temp.t('tb'), v_mb), 'already claimed'), 'a second claim';
  assert pg_temp.coins(pg_temp.a('tb')) = 109500, 'still once';
  assert public._econ_trade_left(pg_temp.a('tb')) = 50000 - 9500, 'the claim is not counted twice';
  assert not exists (select 1 from public.game_events where account_id = pg_temp.a('tb') and kind = 'fish_catch'), 'no catch event';
  j := public.mail_claim(pg_temp.t('ta'), v_ma);
  assert (select kg from public.produce_stock where account_id = pg_temp.a('ta') and upland = 'khoai') = 5, 'produce at a';
  -- the claim locks its row
  assert (select prosrc from pg_proc where proname = '_mail_claim_one') like '%deleted_at is null for update%', 'FOR UPDATE';
  -- a fashion item b owns (or has waiting) is still refused at the deal
  raise notice '1 ok';
end $$;

-- 1b. the cap: 50 000 a day counted at sending
do $$
declare r text;
begin
  r := pg_temp.trade('tc', 'tb', '{"coins": 42632, "items": []}', '{"coins": 0, "items": []}');   -- 40 500 to b
  assert r = 'done', 'to the cap: ' || r;
  assert public._econ_trade_left(pg_temp.a('tb')) = 0, 'cap reached unclaimed';
  r := pg_temp.trade('tc', 'tb', '{"coins": 100, "items": []}', '{"coins": 0, "items": []}');
  assert r = 'receive limit', 'over the cap: ' || r;
  raise notice '1b ok';
end $$;

-- ---------- 2. Room ----------
do $$
declare r text; v_m bigint; j jsonb; v_fert text := 'fert_urea';
begin
  -- b holds its fish (bucket 0: one fish in hand); a second fish by trade must wait
  perform pg_temp.fish('00000000-0000-4000-8000-00000000a222', pg_temp.a('tc'), 300);
  r := pg_temp.trade('tc', 'tb', '{"coins": 0, "items": [{"kind": "fish", "ref": "00000000-0000-4000-8000-00000000a222"}]}', '{"coins": 0, "items": []}');
  assert r = 'done', 'fish trade: ' || r;
  v_m := pg_temp.mail('tb', 'trade');
  assert exists (select 1 from public.mail_items where mail_id = v_m and kind = 'fish'), 'the fish mail';
  assert public._bucket_cap(pg_temp.a('tb')) = 0 and (select count(*) from public.fish where account_id = pg_temp.a('tb')) = 1, 'full';
  assert pg_temp.fails(format('select public.mail_claim(%L, %s)', pg_temp.t('tb'), v_m), 'bucket full'), 'no room';
  assert (select claimed_at from public.mail where id = v_m) is null, 'the mail stays';
  assert exists (select 1 from public.mail_fish where mail_id = v_m), 'the fish stays in escrow';
  -- claim all: the others go, this one is listed
  insert into public.inventory (account_id, item_id, qty) values (pg_temp.a('tb'), v_fert, 95)
  on conflict (account_id, item_id) do update set qty = 95;
  j := public.admin_mail_send(pg_temp.t('root'), jsonb_build_object('usernames', jsonb_build_array(pg_temp.n('tb'))), 'Phân bón', 'quà',
                              0, jsonb_build_array(jsonb_build_object('kind', 'item', 'ref', v_fert, 'qty', 10)));
  assert pg_temp.fails(format('select public.mail_claim(%L, %s)', pg_temp.t('tb'), pg_temp.mail('tb', 'admin')), 'bag full'), 'over 99';
  update public.inventory set qty = 50 where account_id = pg_temp.a('tb') and item_id = v_fert;
  j := public.mail_claim_all(pg_temp.t('tb'));
  assert jsonb_array_length(j->'claimed_all'->'failed') = 1 and (j->'claimed_all'->'failed'->0->>'error') = 'bucket full',
    'claim all: ' || (j->'claimed_all')::text;
  assert (j->'claimed_all'->>'n')::int >= 2, 'the rest claimed: ' || (j->'claimed_all')::text;   -- the capped trade and the fertilizer
  assert (select qty from public.inventory where account_id = pg_temp.a('tb') and item_id = v_fert) = 60, 'fertilizer';
  -- room made: now it goes
  delete from public.fish where id = '00000000-0000-4000-8000-00000000a111';
  j := public.mail_claim(pg_temp.t('tb'), v_m);
  assert exists (select 1 from public.fish where id = '00000000-0000-4000-8000-00000000a222' and account_id = pg_temp.a('tb')), 'claimed';
  raise notice '2 ok';
end $$;

-- ---------- 3. The market and the auction ----------
do $$
declare j jsonb; v_id bigint; v_m bigint; v_s bigint; v_c int; v_d int;
begin
  insert into public.inventory (account_id, item_id, qty)
    select pg_temp.a('td'), (select id from public.shop_items where kind = 'bucket' order by capacity desc limit 1), 1
  on conflict do nothing;
  perform pg_temp.fish('00000000-0000-4000-8000-00000000a333', pg_temp.a('tc'), 400);
  j := public.market_list(pg_temp.t('tc'), 'fish', '00000000-0000-4000-8000-00000000a333', 1, 1000);
  v_id := (select id from public.econ_listings where seller = pg_temp.a('tc') and status = 'open' and asset_ref = '00000000-0000-4000-8000-00000000a333');
  v_c := pg_temp.coins(pg_temp.a('tc')); v_d := pg_temp.coins(pg_temp.a('td'));
  j := public.market_buy(pg_temp.t('td'), v_id, 1000);
  assert pg_temp.coins(pg_temp.a('td')) = v_d - 1000, 'the buyer pays at once';
  assert pg_temp.coins(pg_temp.a('tc')) = v_c, 'the seller''s share waits';
  assert (select status from public.econ_listings where id = v_id) = 'sold', 'sold';
  v_m := pg_temp.mail('td', 'market');
  assert exists (select 1 from public.mail_fish where id = '00000000-0000-4000-8000-00000000a333' and mail_id = v_m), 'the goods in the buyer''s mail';
  v_s := pg_temp.mail('tc', 'market');
  assert (select xu from public.mail where id = v_s) = 950 and (select xu_reason from public.mail where id = v_s) = 'market_sell', 'share mail';
  j := public.mail_claim(pg_temp.t('tc'), v_s);
  assert pg_temp.coins(pg_temp.a('tc')) = v_c + 950, 'share paid';
  assert exists (select 1 from public.coin_ledger where account_id = pg_temp.a('tc') and reason = 'market_sell' and ref = 'mail #' || v_s), 'market_sell';
  j := public.mail_claim(pg_temp.t('td'), v_m);
  assert exists (select 1 from public.fish where id = '00000000-0000-4000-8000-00000000a333' and account_id = pg_temp.a('td')), 'the buyer''s fish';
  -- an auction
  perform pg_temp.fish('00000000-0000-4000-8000-00000000a444', pg_temp.a('tc'), 1000);
  j := public.auction_create(pg_temp.t('tc'), 'fish', '00000000-0000-4000-8000-00000000a444', 1, 1000, 1);
  v_id := (select id from public.econ_auctions where seller = pg_temp.a('tc') and status = 'open');
  j := public.auction_bid(pg_temp.t('td'), v_id, 1200);
  update public.econ_auctions set ends_at = now() - interval '1 second' where id = v_id;
  perform public.econ_state(pg_temp.t('td'));
  assert (select status from public.econ_auctions where id = v_id) = 'sold', 'settled';
  assert exists (select 1 from public.mail_fish f join public.mail m on m.id = f.mail_id
                  where f.id = '00000000-0000-4000-8000-00000000a444' and m.account_id = pg_temp.a('td') and m.kind = 'market'), 'won by mail';
  assert (select xu from public.mail where id = pg_temp.mail('tc', 'market')) = 1140
     and (select xu_reason from public.mail where id = pg_temp.mail('tc', 'market')) = 'auction_sell', 'auction share by mail';
  raise notice '3 ok';
end $$;

-- ---------- 4. Admin gifts ----------
do $$
declare j jsonb; v_b bigint; v_n int; v_m bigint; v_c int;
begin
  begin
    perform public.admin_mail_send(pg_temp.t('ta'), '{"all": true}', 'x', '', 1, '[]');
    assert false, 'non-root sent';
  exception when sqlstate '42501' then null;
  end;
  assert pg_temp.fails(format('select public.admin_mail_send(%L, %L, ''x'', '''', 2000000, ''[]'')', pg_temp.t('root'), '{"all": true}'), 'bad xu'), 'xu cap';
  assert pg_temp.fails(format('select public.admin_mail_send(%L, %L, ''x'', '''', 1, %L)', pg_temp.t('root'), '{"all": true}',
                              '[{"kind": "item", "ref": "rod_bamboo", "qty": 1}]'), 'bad items'), 'no rods';
  assert pg_temp.fails(format('select public.admin_mail_send(%L, %L, ''x'', '''', 1, ''[]'')', pg_temp.t('root'), '{"usernames": []}'), 'bad target'), 'no one';
  j := public.admin_mail_send(pg_temp.t('root'), jsonb_build_object('usernames', jsonb_build_array(upper(pg_temp.n('ta')), 'nobody_mbx_zz')),
                              'Quà khai trương', 'Chúc mừng!', 777, '[{"kind": "item", "ref": "bait_shrimp", "qty": 5}]');
  assert (j->>'sent')::int = 1 and j->'missing' = '["nobody_mbx_zz"]'::jsonb, 'usernames: ' || j::text;
  v_m := pg_temp.mail('ta', 'admin');
  assert (select sender_kind from public.mail where id = v_m) = 'admin' and (select xu from public.mail where id = v_m) = 777, 'the gift';
  v_c := pg_temp.coins(pg_temp.a('ta'));
  j := public.mail_claim(pg_temp.t('ta'), v_m);
  assert pg_temp.coins(pg_temp.a('ta')) = v_c + 777, 'paid';
  assert exists (select 1 from public.coin_ledger where account_id = pg_temp.a('ta') and reason = 'admin_gift' and delta = 777), 'admin_gift';
  assert (select qty from public.inventory where account_id = pg_temp.a('ta') and item_id = 'bait_shrimp') >= 5, 'bait';
  -- everyone not banned
  j := public.admin_mail_send(pg_temp.t('root'), '{"all": true}', 'Quà cho cả làng', '', 100, '[]');
  v_b := (j->>'batch')::bigint;
  select count(*) into v_n from public.accounts where not is_banned;
  assert (j->>'sent')::int = v_n and (select count(*) from public.mail where batch_id = v_b) = v_n, 'all: ' || j::text;
  assert exists (select 1 from public.mail where batch_id = v_b and account_id = pg_temp.a('td')), 'td got one';
  assert (select recipients from public.mail_batches where id = v_b) = v_n, 'recorded';
  j := public.admin_code_list(pg_temp.t('root'));
  assert exists (select 1 from jsonb_array_elements(j->'gifts') g where (g->>'id')::bigint = v_b), 'listed';
  raise notice '4 ok';
end $$;

-- ---------- 5. Gift codes ----------
do $$
declare j jsonb; v_c bigint; i int; v_ca int;
begin
  perform pg_temp.acc('ca', 0, 1); perform pg_temp.acc('cb', 0, 1); perform pg_temp.acc('cc', 0, 1); perform pg_temp.acc('ce', 0, 1);
  begin
    perform public.admin_code_create(pg_temp.t('ta'), 'MBXTEST1', 't', 1, '[]', 2, null, now() + interval '1 day');
    assert false, 'non-root code';
  exception when sqlstate '42501' then null;
  end;
  j := public.admin_code_create(pg_temp.t('root'), 'mbxtest1', 'Quà thử', 300,
                                '[{"kind": "item", "ref": "fert_urea", "qty": 2}]', 2, null, now() + interval '1 day');
  v_c := (select id from public.gift_codes where code = 'MBXTEST1');
  assert v_c is not null, 'stored upper';
  assert pg_temp.fails(format('select public.admin_code_create(%L, ''MbxTest1'', ''x'', 1, ''[]'', 1, null, now() + interval ''1 day'')', pg_temp.t('root')),
    'code exists'), 'unique, any case';
  assert pg_temp.fails(format('select public.admin_code_create(%L, ''MBXEMPTY'', ''x'', 0, ''[]'', 1, null, now() + interval ''1 day'')', pg_temp.t('root')),
    'empty gift'), 'empty';
  j := public.redeem_code(pg_temp.t('ca'), ' mbxTest1 ');
  assert (j->>'ok')::boolean, 'redeemed: ' || j::text;
  assert (select kind from public.mail where id = (j->>'mail_id')::bigint) = 'code', 'a code mail';
  v_ca := coalesce(pg_temp.coins(pg_temp.a('ca')), 0);
  assert not exists (select 1 from public.coin_ledger where account_id = pg_temp.a('ca') and reason = 'gift_code'), 'not a direct grant';
  j := public.redeem_code(pg_temp.t('ca'), 'MBXTEST1');
  assert not (j->>'ok')::boolean and j->>'error' = 'already redeemed', 'once: ' || j::text;
  j := public.redeem_code(pg_temp.t('cb'), 'MBXTEST1');
  assert (j->>'ok')::boolean, 'second account';
  j := public.redeem_code(pg_temp.t('cc'), 'MBXTEST1');
  assert j->>'error' = 'code used up', 'max_uses: ' || j::text;
  assert (select uses from public.gift_codes where id = v_c) = 2, 'uses';
  j := public.mail_claim(pg_temp.t('ca'), pg_temp.mail('ca', 'code'));
  assert pg_temp.coins(pg_temp.a('ca')) = v_ca + 300 and exists (select 1 from public.coin_ledger where account_id = pg_temp.a('ca') and reason = 'gift_code'), 'gift_code';
  -- expiry, not started, disabled
  insert into public.gift_codes (code, title, xu, max_uses, starts_at, expires_at) values
    ('MBXOLD', 'cũ', 10, 10, now() - interval '2 days', now() - interval '1 day'),
    ('MBXSOON', 'sắp', 10, 10, now() + interval '1 day', now() + interval '2 days'),
    ('MBXOFF', 'tắt', 10, 10, now() - interval '1 day', now() + interval '2 days');
  j := public.admin_code_disable(pg_temp.t('root'), (select id from public.gift_codes where code = 'MBXOFF'));
  assert j->>'error' is null and exists (select 1 from jsonb_array_elements(j->'codes') c where c->>'code' = 'MBXOFF' and not (c->>'enabled')::boolean), 'disabled';
  assert public.redeem_code(pg_temp.t('cc'), 'MBXOLD')->>'error' = 'code expired', 'expired';
  assert public.redeem_code(pg_temp.t('cc'), 'MBXSOON')->>'error' = 'code not started', 'not started';
  assert public.redeem_code(pg_temp.t('cc'), 'MBXOFF')->>'error' = 'invalid code', 'disabled';
  assert not exists (select 1 from public.mail where account_id = pg_temp.a('cc')), 'no mail for cc';
  -- brute force: 10 failures an hour, then refused even for a good code; the 10th logs a soft flag
  insert into public.gift_codes (code, title, xu, max_uses, expires_at) values ('MBXGOOD', 'tốt', 10, 10, now() + interval '1 day');
  for i in 1..9 loop
    j := public.redeem_code(pg_temp.t('ce'), 'WRONG' || i);
    assert j->>'error' = 'invalid code' and (j->>'left')::int = 10 - i, format('try %s: %s', i, j);
  end loop;
  assert not exists (select 1 from public.anticheat_events where account_id = pg_temp.a('ce') and code = 'code_bruteforce'), 'not yet';
  j := public.redeem_code(pg_temp.t('ce'), '??');
  assert j->>'error' = 'invalid code' and (j->>'left')::int = 0, 'the 10th: ' || j::text;
  assert exists (select 1 from public.anticheat_events where account_id = pg_temp.a('ce') and code = 'code_bruteforce' and outcome = 'soft'), 'flagged';
  j := public.redeem_code(pg_temp.t('ce'), 'MBXGOOD');
  assert j->>'error' = 'too many attempts' and (j->>'retry_s')::int between 1 and 3600, 'locked: ' || j::text;
  assert not exists (select 1 from public.gift_code_redemptions r join public.gift_codes c on c.id = r.code_id
                      where c.code = 'MBXGOOD'), 'nothing redeemed';
  -- an hour later it answers again
  update public.gift_code_attempts set at = at - interval '61 minutes' where account_id = pg_temp.a('ce');
  j := public.redeem_code(pg_temp.t('ce'), 'mbxgood');
  assert (j->>'ok')::boolean, 'after the hour: ' || j::text;
  assert (select count(*) from public.anticheat_events where account_id = pg_temp.a('ce') and code = 'code_bruteforce') = 1, 'one flag';
  raise notice '5 ok';
end $$;

-- ---------- 6. Expiry ----------
do $$
declare r text; v_m bigint; v_n bigint; v_c int; j jsonb;
begin
  -- an unclaimed trade mail goes back to the giver
  perform pg_temp.fish('00000000-0000-4000-8000-00000000a555', pg_temp.a('ta'), 300);
  r := pg_temp.trade('ta', 'td', '{"coins": 1000, "items": [{"kind": "fish", "ref": "00000000-0000-4000-8000-00000000a555"}]}', '{"coins": 0, "items": []}');
  assert r = 'done', 'trade: ' || r;
  v_m := pg_temp.mail('td', 'trade');
  update public.mail set expires_at = now() - interval '1 second' where id = v_m;
  assert pg_temp.fails(format('select public.mail_claim(%L, %s)', pg_temp.t('td'), v_m), 'mail expired'), 'too late';
  -- 0113: the sweep runs at most once a minute server-wide
  update public.mail_sweep_state set swept_at = now() - interval '30 seconds';
  j := public.mail_list(pg_temp.t('td'));
  assert exists (select 1 from public.mail where id = v_m), 'swept 30 s ago: not yet (0113)';
  update public.mail_sweep_state set swept_at = now() - interval '61 seconds';
  j := public.mail_list(pg_temp.t('td'));
  assert (select swept_at = now() from public.mail_sweep_state), 'the sweep is stamped (0113)';
  assert not exists (select 1 from public.mail where id = v_m), 'gone from td';
  v_n := pg_temp.mail('ta', 'return');
  assert v_n is not null and (select xu from public.mail where id = v_n) = 950, 'returned to ta';
  assert exists (select 1 from public.mail_fish where id = '00000000-0000-4000-8000-00000000a555' and mail_id = v_n), 'with the fish';
  v_c := pg_temp.coins(pg_temp.a('ta'));
  delete from public.fish where account_id = pg_temp.a('ta');
  j := public.mail_claim(pg_temp.t('ta'), v_n);
  assert pg_temp.coins(pg_temp.a('ta')) = v_c + 950, 'the xu back (the burn stays burned)';
  -- a return that expires is dropped, as a market mail: its escrow goes with it
  v_m := pg_temp.mail('td', 'market');                                            -- the auction's fish
  assert exists (select 1 from public.mail_fish where mail_id = v_m), 'escrow';
  update public.mail set expires_at = now() - interval '1 second' where id = v_m;
  update public.mail_sweep_state set swept_at = null;   -- 0113: the throttle's minute is over
  j := public.mail_list(pg_temp.t('td'));
  assert not exists (select 1 from public.mail where id = v_m), 'dropped';
  assert not exists (select 1 from public.mail_fish where id = '00000000-0000-4000-8000-00000000a444'), 'escrow dropped';
  assert not exists (select 1 from public.fish where id = '00000000-0000-4000-8000-00000000a444'), 'not minted back';
  raise notice '6 ok';
end $$;

-- ---------- 7. Delete, and the wipe ----------
do $$
declare v_m bigint; j jsonb;
begin
  j := public.admin_mail_send(pg_temp.t('root'), jsonb_build_object('usernames', jsonb_build_array(pg_temp.n('cc'))), 'Có quà', '', 5, '[]');
  v_m := pg_temp.mail('cc', 'admin');
  assert pg_temp.fails(format('select public.mail_delete(%L, %s)', pg_temp.t('cc'), v_m), 'not claimed'), 'unclaimed kept';
  j := public.mail_claim(pg_temp.t('cc'), v_m);
  j := public.mail_delete(pg_temp.t('cc'), v_m);
  assert not exists (select 1 from jsonb_array_elements(j->'mails') m where (m->>'id')::bigint = v_m), 'hidden';
  assert pg_temp.fails(format('select public.mail_delete(%L, %s)', pg_temp.t('cc'), v_m), 'no mail'), 'once';
  -- a message without anything may go unclaimed
  j := public.admin_mail_send(pg_temp.t('root'), jsonb_build_object('usernames', jsonb_build_array(pg_temp.n('cc'))), 'Thông báo', 'Chỉ là tin', 0, '[]');
  v_m := (select id from public.mail where account_id = pg_temp.a('cc') and title = 'Thông báo');
  j := public.mail_delete(pg_temp.t('cc'), v_m);
  -- the wipe drops the unclaimed mail
  j := public.admin_mail_send(pg_temp.t('root'), jsonb_build_object('usernames', jsonb_build_array(pg_temp.n('cc'))), 'Có quà 2', '', 5, '[]');
  insert into public.anticheat_status (account_id) values (pg_temp.a('cc')) on conflict do nothing;
  update public.anticheat_status set ban_state = 'wiped' where account_id = pg_temp.a('cc');
  assert not exists (select 1 from public.mail where account_id = pg_temp.a('cc') and claimed_at is null), 'wiped';
  raise notice '7 ok';
end $$;

-- ---------- Clean up ----------
delete from public.mail where batch_id in (select id from public.mail_batches where sent_by = (select a from px where k = 'root'));
delete from public.mail_batches where sent_by = (select a from px where k = 'root');
delete from public.gift_codes where code like 'MBX%';
delete from public.econ_trades where a in (select a from px) or b in (select a from px);
delete from public.rooms where id = (select id from rx where k = 'r');
delete from public.accounts where id in (select a from px);
update public.anticheat_config set mode = (select v from mx_was where k = 'mode');
update public.app_flags set enabled = (select v::boolean from mx_was where k = 'rooms') where key = 'room_creation_open';
select 'mailbox smoke: ok' as result;
