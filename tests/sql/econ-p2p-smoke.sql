-- tests/sql/econ-p2p-smoke.sql — 0106 (Kinh tế v2 between players, spec §9). Run as the superuser on the throwaway
-- cluster after the full chain (… 0100, 0101–0105 when present, 0106), from the repo root, with
-- -v cap=<absolute path>/tests/fixtures/xidach-cap-cases.json. It re-runs 0106 twice with \i. Every check is an ASSERT.
--   0. The rules (stall 500 a day, fee_min 2, recv 3 days / level 5, 5 gifts), the trade_daily_in knob, the private
--      helpers, and no function left that turns the debt switch on.
--   1. P1 Xì dách: _xd_cap = the fixture (49 cases, with Python's and TypeScript's copies). A real 8-seat hand
--      (dealt, hit, stood, shown down) where three alts bust past 28 creates no xu: the hand's ledger sums to 0, no
--      wallet < 0, and the alts lose exactly their escrow. At 4 seats the floors burn 2 xu. The wallet trigger refuses
--      every debit below 0 (with the old switch on too), and a wallet in debt from before still takes credits.
--   2. P2 Trade: the receiver gets 95 % (the knob moves it); new or low-level accounts cannot receive xu but may give
--      and may swap items; the daily cap (trade_daily_in) counts what was received; the window shows the fee and who can
--      still receive how much.
--   3. P3 The thương nhân perk market_sell_pct lowers the sale fee to 2 % on the board and at auction; no perk row.
--   4. P4 Fashion gifts: a roommate only, 5 a day, gifts_left.
--   5. P5 A stall costs 500 a day.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0106_econ_p2p.sql
\i supabase/migrations/0106_econ_p2p.sql
reset client_min_messages;
update public.anticheat_config set mode = 'log';
-- rooms made below are private: from 0093 on they are open only with room creation open (tests/sql/README.md)
create temp table flag_was as select enabled from public.app_flags where key = 'room_creation_open';
update public.app_flags set enabled = true where key = 'room_creation_open';

create temp table cx as select pg_read_file(:'cap')::jsonb j;

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;
create or replace function pg_temp.coins(p uuid) returns int language sql as $$ select coins from public.wallets where account_id = p $$;
-- set a wallet without a ledger row (a 'daily' credit would count as work: XP, level and achievement rewards)
create or replace function pg_temp.fund(p uuid, n int) returns void language plpgsql as $$
begin
  perform public._wallet_lock(p);
  update public.wallets set coins = n where account_id = p;
end $$;
create or replace function pg_temp.pos(p uuid, m text, x int, y int) returns void language sql as $$
  insert into public.player_pos (account_id, map, x, y, at) values (p, m, x, y, now())
  on conflict (account_id) do update set map = excluded.map, x = excluded.x, y = excluded.y, at = excluded.at $$;
-- an account: its token and id, old (days) and at a progression level
create temp table px (k text primary key, t text, a uuid);
create temp table rx (k text primary key, id uuid);
create or replace function pg_temp.room(p_k text) returns uuid language plpgsql as $$
declare v uuid;
begin
  select id into v from rx where k = p_k;
  if v is null then
    insert into public.rooms (code, name) values ('P2P' || upper(p_k) || floor(random() * 1e6)::text, 'p2p smoke ' || p_k)
    returning id into v;
    insert into rx values (p_k, v);
  end if;
  return v;
end $$;
create or replace function pg_temp.acc(p_k text, p_days int, p_level int) returns uuid language plpgsql as $$
declare v_t text; v_a uuid;
begin
  select token into v_t from public.register('p2p_' || p_k || '_' || floor(random() * 1e9)::text, 'pw123456');
  v_a := public._auth_account(v_t);
  update public.accounts set created_at = now() - make_interval(days => p_days) where id = v_a;
  insert into public.player_progress (account_id, xp, level) values (v_a, public._pg_xp_at(p_level), p_level)
  on conflict (account_id) do update set xp = excluded.xp, level = excluded.level;
  insert into px values (p_k, v_t, v_a);
  return v_a;
end $$;
create or replace function pg_temp.a(p_k text) returns uuid language sql as $$ select a from px where k = p_k $$;
create or replace function pg_temp.t(p_k text) returns text language sql as $$ select t from px where k = p_k $$;

-- ---------- 0. Rules, the knob, privileges ----------
do $$
begin
  assert public._econ_rule('stall_day') = 500 and public._econ_rule('fee') = 5 and public._econ_rule('fee_min') = 2, 'fees';
  assert public._econ_rule('recv_days') = 3 and public._econ_rule('recv_level') = 5 and public._econ_rule('gift_day') = 5, 'gates';
  assert public._econ_param('trade_daily_in') = 50000 and public._econ_param('p2p_fee_pct') = 5, 'knobs';
  assert (select note from public.econ_params where key = 'trade_daily_in') like 'Giao dịch:%', 'the knob has a note';
  assert not has_function_privilege('anon', 'public._xd_cap(jsonb, jsonb)', 'execute'), '_xd_cap private';
  assert not has_function_privilege('anon', 'public._econ_fee_pct(uuid)', 'execute'), '_econ_fee_pct private';
  assert not has_function_privilege('anon', 'public._econ_trade_got(bigint)', 'execute'), '_econ_trade_got private';
  assert not has_function_privilege('anon', 'public._econ_recv_ok(uuid)', 'execute'), '_econ_recv_ok private';
  assert not has_function_privilege('anon', 'public._econ_trade_left(uuid)', 'execute'), '_econ_trade_left private';
  assert not has_function_privilege('anon', 'public._econ_recv_json(uuid)', 'execute'), '_econ_recv_json private';
  assert not has_function_privilege('anon', 'public._econ_trade_fee()', 'execute'), '_econ_trade_fee private';
  assert not has_function_privilege('anon', 'public._xidach_showdown(uuid, timestamptz)', 'execute'), 'showdown private';
  assert has_function_privilege('anon', 'public.trade_confirm(text, bigint, integer)', 'execute'), 'trade_confirm callable';
  assert has_function_privilege('anon', 'public.transfer_fashion_item(text, uuid, text)', 'execute'), 'gift callable';
  assert not has_table_privilege('anon', 'public.fashion_gifts', 'select'), 'gift log private';
  assert not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                       and (prosrc like '%set_config(''mt.allow_debt''%' or prosrc like '%current_setting(''mt.allow_debt''%')),
    'the debt switch is gone';
  raise notice '0 ok';
end $$;

-- ---------- 1. P1 Xì dách ----------
-- 1a. the fixture (tests/fixtures/xidach-cap-cases.json: the Python reference = lib/game/cards/xidach.ts xidachCap)
do $$
declare c jsonb; r jsonb; n int := 0; s text; v_sum bigint;
begin
  for c in select jsonb_array_elements(j) from cx loop
    r := public._xd_cap(c->'lines', c->'escrow');
    assert r->'net' = c->'expect'->'net', format('%s: net %s, want %s', c->>'name', r->'net', c->'expect'->'net');
    assert r->'capped' = c->'expect'->'capped', format('%s: capped %s', c->>'name', r->'capped');
    assert (r->>'burned')::int = (c->'expect'->>'burned')::int, format('%s: burned %s', c->>'name', r->>'burned');
    v_sum := 0;
    for s in select jsonb_object_keys(r->'net') loop
      assert coalesce((c->'escrow'->>s)::int, 0) + (r->'net'->>s)::int >= 0, format('%s: seat %s below 0', c->>'name', s);
      v_sum := v_sum + (r->'net'->>s)::int;
    end loop;
    assert v_sum = -(r->>'burned')::int, format('%s: the nets sum to -burned', c->>'name');
    n := n + 1;
  end loop;
  assert n = 49, 'cases: ' || n;
  raise notice '1a ok (% cases)', n;
end $$;

-- 1b. a real hand: 8 seats at 10 000, seat 1 deals on 18, seats 5–8 stand on 18, seats 2–4 (the "alts", 20 000 each —
--     exactly their hold) draw a jack on king–queen and stand on 30: past 28, they each owe every other seat a stake.
--     Before 0106 that was 70 000 owed on a 20 000 hold: −30 000 in each alt's wallet, 90 000 xu minted.
do $$
declare v_room uuid := pg_temp.room('xd'); i int; v_acc uuid;
begin
  perform pg_temp.acc('d', 10, 10);
  for i in 2..8 loop perform pg_temp.acc('s' || i, 10, 10); end loop;
  for v_acc in select a from px where k = 'd' or k like 's_' loop
    insert into public.members (room_id, account_id) values (v_room, v_acc);
  end loop;
  perform pg_temp.fund(pg_temp.a('d'), 200000);
  for i in 2..8 loop perform pg_temp.fund(pg_temp.a('s' || i), 20000); end loop;
  perform public._card_sit(v_room, pg_temp.a('d'), 'xidach', 1, 10000, null, now());
  for i in 2..8 loop perform public._card_sit(v_room, pg_temp.a('s' || i), 'xidach', i, 10000, null, now()); end loop;
end $$;
do $$
declare v_room uuid := pg_temp.room('xd'); v_deck int[]; t public.card_tables; i int; v_ref text; v_err text; v_sum bigint;
begin
  -- seat 1 10♠ 8♦; 2 K♠ Q♠; 3 K♣ Q♣; 4 K♦ Q♦; 5 10♣ 8♠; 6 10♦ 8♣; 7 10♥ 8♥; 8 9♠ 9♣; then J♠ J♣ J♦ for the hits
  v_deck := array[28, 22, 40, 36, 41, 37, 42, 38, 29, 20, 30, 21, 31, 23, 24, 25, 32, 33, 34];
  v_deck := v_deck || array(select g from generate_series(0, 51) g where not (g = any(v_deck)) order by g);
  perform public._xidach_start(v_room, now(), v_deck);
  select * into t from public.card_tables where room_id = v_room and game = 'xidach';
  assert t.phase = 'playing' and (t.pub->>'dealer')::int = 1 and t.turn = 2, 'dealt: ' || t.phase || ' ' || coalesce(t.turn::text, '-');
  assert (select escrow from public.card_seats where room_id = v_room and game = 'xidach' and seat = 1) = 140000, 'the dealer holds 14 stakes';
  assert pg_temp.coins(pg_temp.a('s2')) = 0, 'an alt holds its whole wallet';
  for i in 2..4 loop
    v_err := public._xidach_do_hit(v_room, i, now());
    assert v_err is null, 'hit ' || i || ': ' || coalesce(v_err, '');
    assert public._xd_over((select cards from public.card_hands where room_id = v_room and game = 'xidach' and seat = i)), 'past 28: ' || i;
    v_err := public._xidach_do_stand(v_room, i, now());
    assert v_err is null, 'stand ' || i || ': ' || coalesce(v_err, '');
  end loop;
  for i in 5..8 loop
    v_err := public._xidach_do_stand(v_room, i, now());
    assert v_err is null, 'stand ' || i || ': ' || coalesce(v_err, '');
  end loop;
  v_err := public._xidach_do_stand(v_room, 1, now());                        -- the dealer stands: the showdown
  assert v_err is null, 'dealer: ' || coalesce(v_err, '');
  select * into t from public.card_tables where room_id = v_room and game = 'xidach';
  assert t.phase = 'result', 'shown down';
  assert jsonb_array_length(t.last->'lines') = 21, 'three alts × 7 đền làng lines';
  assert t.last->'capped' = '[2, 3, 4]'::jsonb and (t.last->>'burned')::int = 0, 'capped: ' || (t.last->'capped')::text;
  assert (t.last->'net'->>'2')::int = -20000 and (t.last->'net'->>'1')::int = 12000 and (t.last->'net'->>'5')::int = 12000,
    'nets: ' || (t.last->'net')::text;
  -- no xu created, nobody in debt
  v_ref := public._card_ref('xidach', t.hand_no);
  select sum(delta) into v_sum from public.coin_ledger where ref = v_ref and account_id in (select a from px where k = 'd' or k like 's_');
  assert v_sum = 0, 'the hand sums to ' || v_sum;
  assert not exists (select 1 from public.wallets w join px on px.a = w.account_id where w.coins < 0), 'no wallet below 0';
  for i in 2..4 loop assert pg_temp.coins(pg_temp.a('s' || i)) = 0, 'alt ' || i || ' lost exactly its hold'; end loop;
  for i in 5..8 loop assert pg_temp.coins(pg_temp.a('s' || i)) = 32000, 'player ' || i || ': 3 × 4 000 from the alts'; end loop;
  assert pg_temp.coins(pg_temp.a('d')) = 212000, 'dealer +12 000';
  assert (select detail->'capped' from public.card_log where room_id = v_room and game = 'xidach' and action = 'showdown'
           order by id desc limit 1) = '[2, 3, 4]'::jsonb, 'the log keeps the cap';
  raise notice '1b ok';
end $$;

-- 1c. 4 seats, one bust: 3 stakes owed on a 2-stake hold → 6 666 to each, 2 xu burned
do $$
declare v_room uuid := pg_temp.room('x4'); v_deck int[]; t public.card_tables; i int; v_sum bigint; v_err text;
begin
  perform pg_temp.acc('e1', 10, 10); perform pg_temp.acc('e2', 10, 10); perform pg_temp.acc('e3', 10, 10); perform pg_temp.acc('e4', 10, 10);
  for i in 1..4 loop
    insert into public.members (room_id, account_id) values (v_room, pg_temp.a('e' || i));
    perform pg_temp.fund(pg_temp.a('e' || i), case when i = 1 then 100000 else 20000 end);
    perform public._card_sit(v_room, pg_temp.a('e' || i), 'xidach', i, 10000, null, now());
  end loop;
  v_deck := array[28, 22, 40, 36, 29, 20, 30, 21, 32];
  v_deck := v_deck || array(select g from generate_series(0, 51) g where not (g = any(v_deck)) order by g);
  perform public._xidach_start(v_room, now(), v_deck);
  assert public._xidach_do_hit(v_room, 2, now()) is null, 'hit';
  assert public._xidach_do_stand(v_room, 2, now()) is null and public._xidach_do_stand(v_room, 3, now()) is null
     and public._xidach_do_stand(v_room, 4, now()) is null, 'stands';
  v_err := public._xidach_do_stand(v_room, 1, now());
  assert v_err is null, coalesce(v_err, '');
  select * into t from public.card_tables where room_id = v_room and game = 'xidach';
  assert (t.last->>'burned')::int = 2 and t.last->'capped' = '[2]'::jsonb, 'burned 2: ' || (t.last)::text;
  select sum(delta) into v_sum from public.coin_ledger where ref = public._card_ref('xidach', t.hand_no)
     and account_id in (select a from px where k like 'e_');
  assert v_sum = -2, 'the hand sums to -2 (burned), not more: ' || v_sum;
  assert pg_temp.coins(pg_temp.a('e2')) = 0 and pg_temp.coins(pg_temp.a('e3')) = 26666 and pg_temp.coins(pg_temp.a('e1')) = 106666, 'pro rata';
  raise notice '1c ok';
end $$;

-- 1d. the wallet trigger: no debit below 0, even with the old switch on; an old debt still takes credits
do $$
declare v uuid := pg_temp.a('e2');
begin
  perform set_config('mt.allow_debt', 'on', true);
  assert pg_temp.fails(format('select public._pay(%L, -1, ''daily'', ''smoke'')', v),
    'new row for relation "wallets" violates check constraint "wallets_coins_check"'), 'no overdraft with the switch on';
  perform set_config('mt.allow_debt', '', true);
end $$;
alter table public.wallets disable trigger wallets_no_overdraft;
update public.wallets set coins = -500 where account_id = (select a from px where k = 'e2');   -- a debt from before 0106
alter table public.wallets enable trigger wallets_no_overdraft;
do $$
declare v uuid := pg_temp.a('e2');
begin
  perform public._pay(v, 200, 'card_refund', 'smoke');
  assert pg_temp.coins(v) = -300, 'a credit pays the old debt off';
  assert pg_temp.fails(format('select public._pay(%L, -1, ''daily'', ''smoke'')', v),
    'new row for relation "wallets" violates check constraint "wallets_coins_check"'), 'no spending while in debt';
  perform public._pay(v, 300, 'card_refund', 'smoke');
  assert pg_temp.coins(v) = 0, 'back to 0';
  raise notice '1d ok';
end $$;

-- ---------- 2. P2 Trade ----------
create or replace function pg_temp.trade(p_room uuid, a text, b text, a_off jsonb, b_off jsonb) returns text language plpgsql as $$
declare j jsonb; v_t bigint;
begin
  j := public.trade_open(p_room, pg_temp.t(a), pg_temp.a(b));
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
do $$
declare v_room uuid := pg_temp.room('tr'); k text; x int := 400;
begin
  perform pg_temp.acc('ta', 4, 5);     -- old enough, level 5: may receive
  perform pg_temp.acc('tb', 0, 20);    -- new account (level 20 does not help)
  perform pg_temp.acc('tc', 4, 5);
  perform pg_temp.acc('td', 30, 4);    -- old, level 4
  foreach k in array array['ta', 'tb', 'tc', 'td'] loop
    insert into public.members (room_id, account_id) values (v_room, pg_temp.a(k));
    perform pg_temp.fund(pg_temp.a(k), 200000);
    perform pg_temp.pos(pg_temp.a(k), 'hall', x, 300);
    x := x + 20;
  end loop;
  assert public._econ_recv_ok(pg_temp.a('ta')) and not public._econ_recv_ok(pg_temp.a('tb'))
     and not public._econ_recv_ok(pg_temp.a('td')), 'gates';
  insert into public.produce_stock (account_id, upland, kg) values (pg_temp.a('ta'), 'khoai', 20)
  on conflict (account_id, upland) do update set kg = 20;
end $$;
do $$
declare v_room uuid := pg_temp.room('tr'); r text; v_a int; v_b int; v_c int; j jsonb; v_t bigint;
begin
  -- a new account and a level-4 one cannot receive xu …
  r := pg_temp.trade(v_room, 'ta', 'tb', '{"coins": 10000, "items": []}', '{"coins": 0, "items": []}');
  assert r = 'cannot receive xu', 'new: ' || r;
  r := pg_temp.trade(v_room, 'ta', 'td', '{"coins": 10000, "items": []}', '{"coins": 0, "items": []}');
  assert r = 'cannot receive xu', 'level 4: ' || r;
  assert pg_temp.coins(pg_temp.a('ta')) = 200000 and pg_temp.coins(pg_temp.a('tb')) = 200000, 'nothing moved';
  -- … but may give xu, and swap items for nothing
  v_a := pg_temp.coins(pg_temp.a('ta')); v_b := pg_temp.coins(pg_temp.a('tb'));
  r := pg_temp.trade(v_room, 'tb', 'ta', '{"coins": 10000, "items": []}', '{"coins": 0, "items": [{"kind": "produce", "ref": "khoai", "qty": 5}]}');
  assert r = 'done', 'b gives: ' || r;
  assert pg_temp.coins(pg_temp.a('tb')) = v_b - 10000 and pg_temp.coins(pg_temp.a('ta')) = v_a + 9500, 'the receiver gets 95 %';
  assert (select kg from public.produce_stock where account_id = pg_temp.a('tb') and upland = 'khoai') = 5, 'items to the new account';
  -- both sides give xu: only the net moves, and burns
  v_a := pg_temp.coins(pg_temp.a('ta')); v_c := pg_temp.coins(pg_temp.a('tc'));
  r := pg_temp.trade(v_room, 'ta', 'tc', '{"coins": 1000, "items": []}', '{"coins": 400, "items": []}');
  assert r = 'done' and pg_temp.coins(pg_temp.a('ta')) = v_a - 600 and pg_temp.coins(pg_temp.a('tc')) = v_c + 570, 'net 600 → 570';
  -- the knob moves the burn
  update public.econ_params set value = 10 where key = 'p2p_fee_pct';
  v_c := pg_temp.coins(pg_temp.a('tc'));
  r := pg_temp.trade(v_room, 'ta', 'tc', '{"coins": 1000, "items": []}', '{"coins": 0, "items": []}');
  assert r = 'done' and pg_temp.coins(pg_temp.a('tc')) = v_c + 900, 'fee 10 %';
  update public.econ_params set value = 5 where key = 'p2p_fee_pct';
  -- the daily cap counts what was received: c has 570 + 900 = 1 470 today, so 48 530 more
  assert public._econ_trade_left(pg_temp.a('tc')) = 48530, 'left: ' || public._econ_trade_left(pg_temp.a('tc'));
  r := pg_temp.trade(v_room, 'ta', 'tc', '{"coins": 51085, "items": []}', '{"coins": 0, "items": []}');   -- would get 48 530
  assert r = 'done', 'up to the cap: ' || r;
  assert public._econ_trade_left(pg_temp.a('tc')) = 0, 'cap reached';
  r := pg_temp.trade(v_room, 'ta', 'tc', '{"coins": 2, "items": []}', '{"coins": 0, "items": []}');       -- would get 1
  assert r = 'receive limit', 'over the cap: ' || r;
  r := pg_temp.trade(v_room, 'ta', 'tc', '{"coins": 1, "items": []}', '{"coins": 0, "items": []}');       -- gets 0: allowed
  assert r = 'done', '1 xu burns whole: ' || r;
  -- the window: the fee and who can still receive how much
  j := public.trade_open(v_room, pg_temp.t('ta'), pg_temp.a('tb'));
  v_t := (j->'trade'->>'id')::bigint;
  assert (j->'trade'->>'fee_pct')::int = 5, 'fee shown';
  assert (j->'trade'->'my_recv'->>'ok')::boolean and not (j->'trade'->'their_recv'->>'ok')::boolean, 'recv shown';
  assert (j->'trade'->'my_recv'->>'left')::int = 50000 - 9500, 'a got 9 500 today: ' || (j->'trade'->'my_recv')::text;
  j := public.trade_state(pg_temp.t('tb'));
  assert not (j->'trade'->'my_recv'->>'ok')::boolean and (j->'trade'->'their_recv'->>'ok')::boolean, 'the other side sees it too';
  perform public.trade_cancel(pg_temp.t('tb'), v_t);
  -- trade_daily_in = 0: nobody receives xu, items still move
  update public.econ_params set value = 0 where key = 'trade_daily_in';
  r := pg_temp.trade(v_room, 'tc', 'ta', '{"coins": 100, "items": []}', '{"coins": 0, "items": []}');
  assert r = 'receive limit', 'cap 0: ' || r;
  update public.econ_params set value = 50000 where key = 'trade_daily_in';
  raise notice '2 ok';
end $$;

-- ---------- 3. P3 The thương nhân perk lowers the sale fee ----------
do $$
declare j jsonb; v_id bigint; v_s int; v_room uuid := pg_temp.room('tr');
begin
  -- ta: thương nhân main with Mồm mép (3) → fee 5 − 3 = 2 %; with Buôn có bạn too (6) → still 2 %
  insert into public.player_profession_main (account_id, prof) values (pg_temp.a('ta'), 'thuong_nhan')
  on conflict (account_id) do update set prof = excluded.prof;
  insert into public.player_skills (account_id, node) values (pg_temp.a('ta'), 't_sell') on conflict do nothing;
  assert public._econ_fee_pct(pg_temp.a('ta')) = 2 and public._econ_fee_pct(pg_temp.a('tc')) = 5, 'fee pct';
  insert into public.player_skills (account_id, node) values (pg_temp.a('ta'), 't_sell2') on conflict do nothing;
  assert public._econ_fee_pct(pg_temp.a('ta')) = 2, 'at least 2 %';
  -- the board: 1 000 → 980 for the trader, 950 for anyone else
  delete from public.fish where id in ('00000000-0000-4000-8000-0000000b2b01', '00000000-0000-4000-8000-0000000b2b02',
                                      '00000000-0000-4000-8000-0000000b2b03');
  insert into public.fish (id, account_id, species_id, weight_g, price) values
    ('00000000-0000-4000-8000-0000000b2b01', pg_temp.a('ta'), 'ca_ro', 800, 400),
    ('00000000-0000-4000-8000-0000000b2b02', pg_temp.a('tc'), 'ca_ro', 800, 400),
    ('00000000-0000-4000-8000-0000000b2b03', pg_temp.a('ta'), 'ca_ro', 900, 1000);
  insert into public.inventory (account_id, item_id, qty)
    select pg_temp.a(k), s.id, 1 from unnest(array['ta', 'tc']) k,
      (select id from public.shop_items where kind = 'bucket' order by capacity desc limit 1) s
  on conflict do nothing;
  j := public.market_list(pg_temp.t('ta'), 'fish', '00000000-0000-4000-8000-0000000b2b01', 1, 1000);
  v_id := (select id from public.econ_listings where seller = pg_temp.a('ta') and status = 'open' and asset_ref = '00000000-0000-4000-8000-0000000b2b01');
  v_s := pg_temp.coins(pg_temp.a('ta'));
  j := public.market_buy(pg_temp.t('tc'), v_id, 1000);
  assert pg_temp.coins(pg_temp.a('ta')) = v_s + 980, 'the trader keeps 98 %';
  assert not exists (select 1 from public.coin_ledger where account_id = pg_temp.a('ta') and reason = 'market_sell' and ref like 'perk:%'),
    'no perk paid on top';
  j := public.market_list(pg_temp.t('tc'), 'fish', '00000000-0000-4000-8000-0000000b2b02', 1, 1000);
  v_id := (select id from public.econ_listings where seller = pg_temp.a('tc') and status = 'open' and asset_ref = '00000000-0000-4000-8000-0000000b2b02');
  v_s := pg_temp.coins(pg_temp.a('tc'));
  j := public.market_buy(pg_temp.t('ta'), v_id, 1000);
  assert pg_temp.coins(pg_temp.a('tc')) = v_s + 950, 'anyone else keeps 95 %';
  -- an auction: 1 200 → 1 176 for the trader
  j := public.auction_create(pg_temp.t('ta'), 'fish', '00000000-0000-4000-8000-0000000b2b03', 1, 1000, 1);
  v_id := (select id from public.econ_auctions where seller = pg_temp.a('ta') and status = 'open');
  j := public.auction_bid(pg_temp.t('tc'), v_id, 1200);
  update public.econ_auctions set ends_at = now() - interval '1 second' where id = v_id;
  v_s := pg_temp.coins(pg_temp.a('ta'));
  perform public.econ_state(pg_temp.t('tc'));
  assert (select status from public.econ_auctions where id = v_id) = 'sold', 'settled';
  assert pg_temp.coins(pg_temp.a('ta')) = v_s + 1176, 'auction 98 %: ' || (pg_temp.coins(pg_temp.a('ta')) - v_s);
  raise notice '3 ok';
end $$;

-- ---------- 4. P4 Fashion gifts ----------
do $$
declare v_room uuid := pg_temp.room('gf'); j jsonb; v_items text[]; i int;
begin
  perform pg_temp.acc('g', 10, 10); perform pg_temp.acc('gr', 0, 1); perform pg_temp.acc('go', 0, 1);
  insert into public.members (room_id, account_id) values (v_room, pg_temp.a('g')), (v_room, pg_temp.a('gr'));   -- go: elsewhere
  v_items := array(select id from public.item_catalog where not starter and price > 0 and id not like 'vp\_%' order by price, id limit 7);
  insert into public.account_items (account_id, item_id) select pg_temp.a('g'), unnest(v_items) on conflict do nothing;
  assert pg_temp.fails(format('select public.transfer_fashion_item(%L, %L, %L)', pg_temp.t('g'), pg_temp.a('go'), v_items[1]),
    'recipient not in your rooms'), 'not a roommate';
  for i in 1..5 loop
    j := public.transfer_fashion_item(pg_temp.t('g'), pg_temp.a('gr'), v_items[i]);
    assert (j->>'gifts_left')::int = 5 - i, format('gift %s: %s', i, j);
    assert exists (select 1 from public.account_items where account_id = pg_temp.a('gr') and item_id = v_items[i]), 'given';
  end loop;
  assert pg_temp.fails(format('select public.transfer_fashion_item(%L, %L, %L)', pg_temp.t('g'), pg_temp.a('gr'), v_items[6]),
    'gift limit'), 'the 6th gift';
  assert exists (select 1 from public.account_items where account_id = pg_temp.a('g') and item_id = v_items[6]), 'kept';
  assert (select count(*) from public.fashion_gifts where giver = pg_temp.a('g')) = 5, 'logged';
  -- a new Vietnam day: the count starts again
  update public.fashion_gifts set at = at - interval '1 day' where giver = pg_temp.a('g');
  j := public.transfer_fashion_item(pg_temp.t('g'), pg_temp.a('gr'), v_items[6]);
  assert (j->>'gifts_left')::int = 4, 'next day';
  raise notice '4 ok';
end $$;

-- ---------- 5. P5 A stall costs 500 a day ----------
do $$
declare j jsonb; v int;
begin
  update public.econ_stalls set renter = null, paid_until = null;
  delete from public.econ_listings where stall_no is not null and status = 'open';
  perform pg_temp.pos(pg_temp.a('tc'), 'market', 560, 360);
  v := pg_temp.coins(pg_temp.a('tc'));
  j := public.shop_rent(pg_temp.t('tc'), 3, 2);
  assert not (j ? 'anticheat'), 'at the stall row: ' || j::text;
  assert pg_temp.coins(pg_temp.a('tc')) = v - 1000, '2 days: 1 000';
  update public.econ_stalls set renter = null, paid_until = null where no = 3;
  raise notice '5 ok';
end $$;

update public.app_flags set enabled = (select enabled from flag_was) where key = 'room_creation_open';
select 'econ p2p smoke: ok' as result;
