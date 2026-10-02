-- =========================================================
-- 0106_econ_p2p.sql — Kinh tế v2, between players (spec docs/superpowers/specs/2026-09-30-economy-v2-design.md §9).
-- ADDITIVE and re-runnable. Run after 0105 (it re-creates none of 0101–0105's functions, so it also applies right after
-- 0100).
--   A. Rules and the knob: _econ_rule gains fee_min 2, recv_days 3, recv_level 5, gift_day 5, and a stall's rent goes
--      200 → 500 a day (P5); econ_params gains trade_daily_in (50 000).
--   B. P1 Xì dách: nobody loses more than their escrow. _xd_cap(lines, escrow) settles a hand's lines:
--      - the lines between each pair of seats are netted into one edge;
--      - a short seat pays what it has on the table (its escrow plus what it receives), shared pro rata to what it owes
--        each seat (floor); the remainder is burned, never paid out;
--      - lib/game/cards/xidach.ts xidachCap mirrors it (tests/fixtures/xidach-cap-cases.json pins both).
--      _xidach_showdown pays escrow + that net (never below 0) and no longer sets mt.allow_debt. _wallet_no_overdraft
--      refuses every debit below 0 again; a wallet already in debt from before still takes credits.
--   C. P2 Trade:
--      - the xu leg burns p2p_fee_pct % (0100's knob, 5): the receiver gets the rest, floor;
--      - xu go only to an account ≥ 3 days old at progression level ≥ 5 ('cannot receive xu');
--      - an account receives at most trade_daily_in through trades a Vietnam day ('receive limit');
--      - items stay free;
--      - _econ_trade_json tells both sides the burn and who can still receive how much.
--   D. P3 The thương nhân perk market_sell_pct now lowers the 5 % sale fee (to at least 2 %) in _econ_buy (board and
--      stalls) and _econ_settle (auctions). 0100's _perk_ledger stopped paying it on top of the share.
--   E. P4 transfer_fashion_item:
--      - only to a member of a room the giver is in ('recipient not in your rooms');
--      - at most 5 gifts per giver per Vietnam day ('gift limit'; fashion_gifts keeps them);
--      - the answer carries gifts_left.
-- No coin_ledger reason is added: a burn is simply not paid.
-- Lock order unchanged (0073: listing/auction/trade row → wallets in account order → asset rows; 0021: table → wallets).
-- =========================================================

-- ---------- A. Rules and the knob ----------
-- 0073's _econ_rule plus the lines marked econ v2
create or replace function public._econ_rule(p_what text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_what
  when 'fee' then 5              -- % of a sale burned (market, stall, auction)
  when 'fee_min' then 2          -- econ v2: … the thương nhân perk market_sell_pct lowers it to at least this
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
  when 'stall_day' then 500      -- a stall's rent per day                                  -- econ v2 was: 200
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
  when 'recv_days' then 3        -- econ v2: a trade's xu go only to an account at least this many days old …
  when 'recv_level' then 5       -- econ v2: … at progression level ≥ this
  when 'gift_day' then 5         -- econ v2: fashion gifts per giver per Vietnam day
end $$;
revoke all on function public._econ_rule(text) from public, anon, authenticated;

insert into public.econ_params (key, value, min_value, max_value, note) values
  ('trade_daily_in', 50000, 0, 10000000,
   'Giao dịch: mỗi người nhận tối đa bấy nhiêu xu qua giao dịch trong một ngày (tính số xu thực nhận, sau phí đốt).')
on conflict (key) do nothing;

-- ---------- B. P1 Xì dách: nobody loses more than their escrow ----------
-- A hand's settlement from its lines [{from, to, xu, …}] and each seat's escrow {"seat": xu}:
-- {net: {"seat": xu}, capped: [short seats], burned: xu}.
-- - The lines between two seats both ways are netted into one edge.
-- - A seat that owes more than it has on the table (its escrow plus what it receives) is short. Its edges are scaled
--   pro rata (floor) to what it has, and that scaling is repeated until nothing changes: the payments only fall, so
--   this ends at the largest payments every seat can cover. After 64 rounds without a fixed point (a cycle of short
--   seats; a Xì dách hand has none), the safe rule decides: a short seat pays at most its escrow.
-- - A short seat loses everything it had on the table. The floors' remainder is burned.
-- So escrow + net ≥ 0 for every seat and the nets sum to −burned: nothing is ever minted.
-- lib/game/cards/xidach.ts xidachCap mirrors it (tests/fixtures/xidach-cap-cases.json).
create or replace function public._xd_cap(p_lines jsonb, p_escrow jsonb) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare
  v_lines jsonb := coalesce(p_lines, '[]'::jsonb);
  v_seats integer[];
  v_from integer[] := '{}'; v_to integer[] := '{}'; v_amt bigint[] := '{}'; v_pay bigint[]; v_new bigint[];
  a integer; b integer; s integer; i integer; k integer; d bigint;
  v_esc bigint; v_in bigint; v_owed bigint; v_paid bigint; v_charge bigint; v_changed boolean := true;
  v_net jsonb := '{}'::jsonb; v_capped integer[] := '{}'; v_burned bigint := 0;
begin
  v_seats := array(select distinct x from (
                     select e.key::int x from jsonb_each(coalesce(p_escrow, '{}'::jsonb)) e
                     union select (l->>'from')::int from jsonb_array_elements(v_lines) l
                     union select (l->>'to')::int from jsonb_array_elements(v_lines) l) u
                    where x is not null order by x);
  -- one netted edge per pair of seats
  foreach a in array v_seats loop
    foreach b in array v_seats loop
      continue when b <= a;
      d := coalesce((select sum((l->>'xu')::bigint) from jsonb_array_elements(v_lines) l
                      where (l->>'from')::int = a and (l->>'to')::int = b), 0)
         - coalesce((select sum((l->>'xu')::bigint) from jsonb_array_elements(v_lines) l
                      where (l->>'from')::int = b and (l->>'to')::int = a), 0);
      if d > 0 then
        v_from := v_from || a; v_to := v_to || b; v_amt := v_amt || d;
      elsif d < 0 then
        v_from := v_from || b; v_to := v_to || a; v_amt := v_amt || (-d);
      end if;
    end loop;
  end loop;
  -- the largest payments every seat can cover: its short edges scaled to its escrow + what it receives, until stable
  v_pay := v_amt;
  for k in 1..64 loop
    v_new := v_pay;
    v_changed := false;
    foreach s in array v_seats loop
      v_esc := coalesce((p_escrow->>(s::text))::bigint, 0);
      v_in := 0; v_owed := 0;
      for i in 1..cardinality(v_from) loop
        if v_to[i] = s then v_in := v_in + v_pay[i]; end if;
        if v_from[i] = s then v_owed := v_owed + v_amt[i]; end if;
      end loop;
      if v_owed > v_esc + v_in then
        for i in 1..cardinality(v_from) loop
          if v_from[i] = s then
            v_new[i] := (v_amt[i] * (v_esc + v_in)) / v_owed;
            if v_new[i] <> v_pay[i] then v_changed := true; end if;
          end if;
        end loop;
      end if;
    end loop;
    v_pay := v_new;
    exit when not v_changed;
  end loop;
  if v_changed then
    -- no fixed point in 64 rounds: a short seat pays at most its escrow (what it receives cannot be counted on)
    v_pay := v_amt;
    foreach s in array v_seats loop
      v_esc := coalesce((p_escrow->>(s::text))::bigint, 0);
      v_owed := 0;
      for i in 1..cardinality(v_from) loop
        if v_from[i] = s then v_owed := v_owed + v_amt[i]; end if;
      end loop;
      if v_owed > v_esc then
        for i in 1..cardinality(v_from) loop
          if v_from[i] = s then v_pay[i] := (v_amt[i] * v_esc) / v_owed; end if;
        end loop;
      end if;
    end loop;
  end if;
  -- the nets: a short seat loses all it had on the table (the floors' remainder burns), the others pay their edges
  foreach s in array v_seats loop
    v_esc := coalesce((p_escrow->>(s::text))::bigint, 0);
    v_in := 0; v_owed := 0; v_paid := 0;
    for i in 1..cardinality(v_from) loop
      if v_to[i] = s then v_in := v_in + v_pay[i]; end if;
      if v_from[i] = s then v_owed := v_owed + v_amt[i]; v_paid := v_paid + v_pay[i]; end if;
    end loop;
    if v_owed > v_paid then
      v_charge := v_esc + v_in;
      v_capped := v_capped || s;
      v_burned := v_burned + (v_esc + v_in - v_paid);
    else
      v_charge := v_paid;
    end if;
    v_net := v_net || jsonb_build_object(s::text, v_in - v_charge);
  end loop;
  return jsonb_build_object('net', v_net, 'capped', to_jsonb(v_capped), 'burned', v_burned);
end $$;
revoke all on function public._xd_cap(jsonb, jsonb) from public, anon, authenticated;

-- 0021's _xidach_showdown plus the lines marked econ v2 (the capped settlement; no mt.allow_debt)
create or replace function public._xidach_showdown(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare
  t public.card_tables;
  v_dealer integer;
  v_order integer[];
  v_left integer[];
  v_in integer[];
  v_lines jsonb;
  v_line jsonb;
  v_cancel boolean;
  v_cards jsonb := '{}'::jsonb;
  v_net jsonb;
  s integer;
  r record;
  v_amt integer;
  v_cap jsonb;                                                                                  -- econ v2
begin
  select * into t from public.card_tables where room_id = p_room and game = 'xidach';
  v_dealer := (t.pub->>'dealer')::int;
  v_order := public._card_ints(t.pub->'order');
  v_left := public._card_ints(coalesce(t.pub->'left', '[]'::jsonb));
  v_in := array(select x from unnest(v_order) x where not (x = any(v_left)));
  v_lines := coalesce(t.pub->'lines', '[]'::jsonb);
  v_cancel := v_dealer = any(v_left);
  for r in select seat, cards from public.card_hands where room_id = p_room and game = 'xidach' and hand_no = t.hand_no loop
    v_cards := v_cards || jsonb_build_object(r.seat::text, to_jsonb(r.cards));
  end loop;

  if v_cancel then
    v_lines := '[]'::jsonb;
  else
    foreach s in array v_order loop
      continue when s <> v_dealer and coalesce((t.pub->'players'->(s::text)->>'inspected')::boolean, false);
      if s = any(v_left) then
        if s <> v_dealer then
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('from', s, 'to', v_dealer, 'xu', t.stake, 'why', 'left'));
        end if;
      elsif public._xd_over(public._card_ints(v_cards->(s::text))) then
        v_lines := v_lines || public._xd_den_lang(s, v_in, t.stake);
      elsif s <> v_dealer and not public._xd_over(public._card_ints(v_cards->(v_dealer::text))) then
        v_line := public._xd_line(s, v_dealer, t.stake, public._card_ints(v_cards->(s::text)),
                                  public._card_ints(v_cards->(v_dealer::text)));
        if v_line is not null then
          v_lines := v_lines || jsonb_build_array(v_line);
        end if;
      end if;
    end loop;
  end if;

  -- econ v2 {: every seat pays at most what it has on the table (its escrow, and what it receives); a short seat's
  -- debts are scaled pro rata (_xd_cap). Nets over the dealt seats, as before.
  v_cap := public._xd_cap(v_lines, (select coalesce(jsonb_object_agg(cs.seat::text, cs.escrow), '{}'::jsonb)
                                      from public.card_seats cs where cs.room_id = p_room and cs.game = 'xidach'));
  v_net := (select coalesce(jsonb_object_agg(x::text, coalesce((v_cap->'net'->>(x::text))::int, 0)), '{}'::jsonb)
              from unnest(v_order) x);
  -- econ v2 }

  update public.card_tables
     set phase = 'result', turn = null, deadline = p_now + interval '10 seconds',
         last = jsonb_build_object(
           'hand_no', t.hand_no,
           'dealer', v_dealer,
           'cancelled', v_cancel,
           'hands', (select jsonb_object_agg(h.seat::text, jsonb_build_object(
                             'cards', to_jsonb(h.cards), 'kind', public._xd_kind(h.cards), 'points', public._xd_points(h.cards)))
                       from public.card_hands h where h.room_id = p_room and h.game = 'xidach' and h.hand_no = t.hand_no),
           'lines', v_lines,
           'net', v_net,
           'capped', coalesce(v_cap->'capped', '[]'::jsonb),                                   -- econ v2
           'burned', coalesce((v_cap->>'burned')::int, 0))                                      -- econ v2
   where room_id = p_room and game = 'xidach';

  -- the payout: escrow + net for every seat, the wallets in account-id order; econ v2: escrow + net ≥ 0, so the
  -- showdown only ever credits (no mt.allow_debt, no wallet below 0)
  for r in select account_id from public.card_seats where room_id = p_room and game = 'xidach' order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  for r in select seat, account_id, escrow from public.card_seats where room_id = p_room and game = 'xidach' order by seat loop
    v_amt := r.escrow + coalesce((v_net->>(r.seat::text))::int, 0);
    update public.card_seats set escrow = 0 where room_id = p_room and game = 'xidach' and seat = r.seat;
    if v_amt <> 0 then
      perform public._pay(r.account_id, v_amt, 'card_settle', public._card_ref('xidach', t.hand_no));
    end if;
  end loop;
  perform public._card_log(p_room, 'xidach', t.hand_no, null, v_dealer, 'showdown',
                           jsonb_build_object('lines', v_lines, 'net', v_net, 'capped', coalesce(v_cap->'capped', '[]'::jsonb),   -- econ v2
                                              'burned', coalesce((v_cap->>'burned')::int, 0)), p_now);                       -- econ v2
end $$;
revoke all on function public._xidach_showdown(uuid, timestamptz) from public, anon, authenticated;

-- 0021's _wallet_no_overdraft without the mt.allow_debt escape: no debit may leave a wallet below 0. A wallet in debt
-- from before 0106 still takes credits (they pay the debt off) and cannot spend until it is back at 0 or more.
create or replace function public._wallet_no_overdraft() returns trigger
language plpgsql set search_path = public, extensions
as $$
begin
  if new.coins < 0 and (tg_op = 'INSERT' or new.coins < old.coins) then                       -- econ v2: no mt.allow_debt
    raise exception 'new row for relation "wallets" violates check constraint "wallets_coins_check"' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public._wallet_no_overdraft() from public, anon, authenticated;

-- ---------- C. P2 Trade: the burn and who may receive xu ----------
-- The burn on xu between players, in % (0100's knob p2p_fee_pct, 0–50).
create or replace function public._econ_trade_fee() returns integer
language sql stable security definer set search_path = public, extensions
as $$ select least(50, greatest(0, coalesce(public._econ_param('p2p_fee_pct'), 5)))::int $$;

-- What the receiver of p_gross xu gets (floor).
create or replace function public._econ_trade_got(p_gross bigint) returns bigint
language sql stable security definer set search_path = public, extensions
as $$ select (greatest(0, p_gross) * (100 - public._econ_trade_fee())) / 100 $$;

-- May p_account receive xu in a trade: its account is ≥ recv_days old and its progression level ≥ recv_level.
create or replace function public._econ_recv_ok(p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce((select a.created_at <= now() - make_interval(days => public._econ_rule('recv_days'))
                     from public.accounts a where a.id = p_account), false)
     and public._pg_level(p_account) >= public._econ_rule('recv_level')
$$;

-- The xu p_account may still receive through trades this Vietnam day (trade_daily_in less what it got today).
create or replace function public._econ_trade_left(p_account uuid) returns bigint
language sql stable security definer set search_path = public, extensions
as $$
  select greatest(0, greatest(0, coalesce(public._econ_param('trade_daily_in'), 50000))::bigint
                     - coalesce((select sum(l.delta) from public.coin_ledger l
                                  where l.account_id = p_account and l.reason = 'trade' and l.delta > 0
                                    and l.created_at >= public._vn_day_start()), 0))
$$;

-- {ok, left} of p_account for the trade window.
create or replace function public._econ_recv_json(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$ select jsonb_build_object('ok', public._econ_recv_ok(p_account), 'left', public._econ_trade_left(p_account)) $$;

revoke all on function public._econ_trade_fee() from public, anon, authenticated;
revoke all on function public._econ_trade_got(bigint) from public, anon, authenticated;
revoke all on function public._econ_recv_ok(uuid) from public, anon, authenticated;
revoke all on function public._econ_trade_left(uuid) from public, anon, authenticated;
revoke all on function public._econ_recv_json(uuid) from public, anon, authenticated;

-- 0073's _econ_trade_json plus the lines marked econ v2
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
                'updated_ms', public._apt_ms(t.updated_at),                                   -- econ v2 was: 'updated_ms', public._apt_ms(t.updated_at))
                'fee_pct', public._econ_trade_fee(),                                         -- econ v2: the xu leg's burn
                'my_recv', public._econ_recv_json(p_account),                                -- econ v2: may I receive, how much
                'their_recv', public._econ_recv_json(case when t.a = p_account then t.b else t.a end))   -- econ v2
                from public.econ_trades t where t.status = 'open' and p_account in (t.a, t.b) limit 1),
    'last_done', (select jsonb_build_object('id', t.id, 'partner_name', public._news_name(case when t.a = p_account then t.b else t.a end),
                                            'status', t.status, 'at_ms', public._apt_ms(t.updated_at))
                    from public.econ_trades t where t.status <> 'open' and p_account in (t.a, t.b)
                     and t.updated_at > now() - interval '30 seconds' order by t.updated_at desc limit 1),
    'coins', coalesce((select coins from public.wallets where account_id = p_account), 0),
    'server_now_ms', public._apt_ms(now()))
$$;
revoke all on function public._econ_trade_json(uuid) from public, anon, authenticated;

-- 0073's trade_confirm plus the lines marked econ v2
create or replace function public.trade_confirm(p_session_token text, p_trade bigint, p_rev integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token); t public.econ_trades; e jsonb; a_off jsonb; b_off jsonb;
        v_a bigint; v_b bigint; v_net bigint;
        v_to uuid; v_got bigint;                                                                 -- econ v2
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
  -- econ v2 {: the xu leg: its receiver must be ≥ recv_days old at level ≥ recv_level and under trade_daily_in today;
  -- it gets the net less the p2p_fee_pct burn (floor). A refusal raises, so nothing above moves either.
  if v_net <> 0 then
    v_to := case when v_net > 0 then t.a else t.b end;
    v_got := public._econ_trade_got(abs(v_net));
    if not public._econ_recv_ok(v_to) then raise exception 'cannot receive xu' using errcode = '53400'; end if;
    if v_got > public._econ_trade_left(v_to) then raise exception 'receive limit' using errcode = '53400'; end if;
  end if;
  -- econ v2 }
  if v_net <> 0 then
    perform public._pay(t.a, (case when v_net > 0 then v_got else v_net end)::integer, 'trade', 'trade #' || t.id);   -- econ v2 was: perform public._pay(t.a, v_net::integer, 'trade', 'trade #' || t.id);
    perform public._pay(t.b, (case when v_net > 0 then -v_net else v_got end)::integer, 'trade', 'trade #' || t.id);  -- econ v2 was: perform public._pay(t.b, (-v_net)::integer, 'trade', 'trade #' || t.id);
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
revoke all on function public.trade_confirm(text, bigint, integer) from public;
grant execute on function public.trade_confirm(text, bigint, integer) to anon, authenticated;

-- ---------- D. P3 The thương nhân perk lowers the sale fee ----------
-- The % of p_seller's sale burned: 5, less the market_sell_pct perk (0077's t_sell / t_sell2 of a thương nhân main),
-- at least fee_min.
create or replace function public._econ_fee_pct(p_seller uuid) returns numeric
language sql stable security definer set search_path = public, extensions
as $$
  select greatest(public._econ_rule('fee_min')::numeric,
                  public._econ_rule('fee') - least(30, greatest(0, public._perk(p_seller, 'market_sell_pct'))))
$$;
revoke all on function public._econ_fee_pct(uuid) from public, anon, authenticated;

-- 0073's _econ_buy plus the line marked econ v2
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
  v_share := floor(l.price::numeric * (100 - public._econ_fee_pct(l.seller)) / 100)::int;   -- econ v2 was: v_share := (l.price::bigint * (100 - public._econ_rule('fee')) / 100)::int;
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

-- 0073's _econ_settle plus the line marked econ v2
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
  v_share := floor(x.top_bid::numeric * (100 - public._econ_fee_pct(x.seller)) / 100)::int;   -- econ v2 was: v_share := (x.top_bid::bigint * (100 - public._econ_rule('fee')) / 100)::int;
  perform public._pay(x.seller, v_share, 'auction_sell', 'auction #' || x.id);
  update public.econ_auctions set status = 'sold', closed_at = now() where id = x.id;
  perform public._game_event(x.top_bidder, 'auction_won', x.top_bid,
    jsonb_build_object('auction', x.id, 'kind', x.asset_kind, 'ref', x.asset_ref));
  perform public._econ_deal(x.seller, x.top_bidder, 'auction', x.id, x.value, x.top_bid,
                            public._econ_skewed(x.value, x.top_bid));
end $$;
revoke all on function public._econ_settle(bigint) from public, anon, authenticated;

-- ---------- E. P4 Fashion gifts: a roommate, 5 a day ----------
create table if not exists public.fashion_gifts (
  id bigserial primary key,
  giver uuid not null references public.accounts(id) on delete cascade,
  receiver uuid references public.accounts(id) on delete set null,
  item_id text not null,
  at timestamptz not null default now()
);
create index if not exists fashion_gifts_giver on public.fashion_gifts (giver, at);
alter table public.fashion_gifts enable row level security;
revoke all on public.fashion_gifts from anon, authenticated;

-- 0050's transfer_fashion_item plus the lines marked econ v2
create or replace function public.transfer_fashion_item(
  p_session_token text, p_target_account_id uuid, p_item_id text
) returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_sender uuid;
  v_item public.item_catalog;
  v_gifts integer;                                                                                -- econ v2
begin
  v_sender := public._auth_account(p_session_token);
  if p_item_id like 'vp\_%' then raise exception 'uniform' using errcode = '22023'; end if;          -- v20.2
  if p_target_account_id is null or p_target_account_id = v_sender then
    raise exception 'invalid target account' using errcode = '22023';
  end if;

  if not exists (select 1 from public.accounts where id = p_target_account_id) then
    raise exception 'target account not found' using errcode = '22023';
  end if;

  -- econ v2 {: only to someone in a room I am in, at most gift_day gifts a Vietnam day (a giver's gifts one at a time)
  if not exists (select 1 from public.members m1 join public.members m2 on m2.room_id = m1.room_id
                  where m1.account_id = v_sender and m2.account_id = p_target_account_id) then
    raise exception 'recipient not in your rooms' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('fashion_gift'), hashtext(v_sender::text));
  select count(*) into v_gifts from public.fashion_gifts where giver = v_sender and at >= public._vn_day_start();
  if v_gifts >= public._econ_rule('gift_day') then
    raise exception 'gift limit' using errcode = '53400';
  end if;
  -- econ v2 }

  if not exists (select 1 from public.account_items where account_id = v_sender and item_id = p_item_id) then
    raise exception 'not owned' using errcode = '22023';
  end if;

  select * into v_item from public.item_catalog where id = p_item_id;
  if not found or v_item.starter then
    raise exception 'cannot transfer item' using errcode = '22023';
  end if;

  if exists (select 1 from public.account_items where account_id = p_target_account_id and item_id = p_item_id) then
    raise exception 'recipient already owns item' using errcode = '22023';
  end if;

  -- Revert sender's character look if wearing this item
  update public.characters
  set hat = case when hat = p_item_id then null else hat end,
      neck = case when neck = p_item_id then null else neck end,
      outfit = case when outfit = p_item_id then null else outfit end,
      wrist = case when wrist = p_item_id then null else wrist end,
      hairpin = case when hairpin = p_item_id then null else hairpin end,
      top = case when top = p_item_id then null else top end,
      bottom = case when bottom = p_item_id then null else bottom end,
      shoes = case when shoes = p_item_id then 'shoes_dep_blue' else shoes end,
      updated_at = now()
  where account_id = v_sender;

  -- Atomic transfer
  delete from public.account_items where account_id = v_sender and item_id = p_item_id;
  insert into public.account_items (account_id, item_id, acquired_at)
  values (p_target_account_id, p_item_id, now());
  insert into public.fashion_gifts (giver, receiver, item_id) values (v_sender, p_target_account_id, p_item_id);   -- econ v2

  return jsonb_build_object(
    'ok', true,
    'item_id', p_item_id,
    'sender_id', v_sender,
    'recipient_id', p_target_account_id,                                                         -- econ v2: + the comma
    'gifts_left', greatest(0, public._econ_rule('gift_day') - v_gifts - 1)                        -- econ v2: gifts left today
  );
end; $$;
revoke all on function public.transfer_fashion_item(text, uuid, text) from public;
grant execute on function public.transfer_fashion_item(text, uuid, text) to anon, authenticated;
