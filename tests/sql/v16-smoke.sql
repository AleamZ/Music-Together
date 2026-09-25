-- tests/sql/v16-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0017 (see the plan),
-- from the repo root: it re-runs the migration with \i, reads tests/fixtures/card-cases.json with \copy and ends with
-- tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP). The engines run
-- through their private functions with fixed decks and times; the public RPCs are called as the client calls them.
\set ON_ERROR_STOP on

-- The v15, anti-cheat and v15.2 smokes re-run 0013, 0015 and 0016, which put back their own ledger reasons and wipe:
-- run 0017 again first.
set client_min_messages = warning;
\i supabase/migrations/0017_v16_cards.sql
reset client_min_messages;

create temp table smoke (k text primary key, v text);

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- A card from its code (rank + S/C/D/H: "10H", "AS", "2D"), and a JSON array of codes as cards.
create function pg_temp.c(p text) returns integer language sql immutable as $$
  select (array_position(array['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'], left(p, -1)) - 1) * 4
         + position(right(p, 1) in 'SCDH') - 1
$$;
create function pg_temp.cs(p jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(pg_temp.c(x) order by n), '{}') from jsonb_array_elements_text(p) with ordinality e(x, n)
$$;

-- ---------- the rules against the shared fixtures (§17): Tiến lên ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/card-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;

-- A settle case: _tl_money folded over its events from the start of a game (every seat dealt 13, none settled).
create function pg_temp.tl_fold(k jsonb) returns jsonb language plpgsql as $$
declare pub jsonb; ev jsonb; hands jsonb := '{}'; s text; x jsonb;
begin
  pub := jsonb_build_object('order', k->'order', 'chain', null, 'lines', '[]'::jsonb,
    'players', (select jsonb_object_agg(q, jsonb_build_object('id', null, 'n', 13, 'played', (k->'played') @> q::jsonb,
                                                              'out', null, 'place', null, 'paid', 0, 'settled', false))
                  from jsonb_array_elements_text(k->'order') q));
  for s, x in select key, value from jsonb_each(k->'hands') loop
    hands := hands || jsonb_build_object(s, to_jsonb(pg_temp.cs(x)));
  end loop;
  for ev in select value from jsonb_array_elements(k->'events') loop
    if ev->>'k' = 'cut' then
      ev := ev || jsonb_build_object('top', public._tl_combo(pg_temp.cs(ev->'top'->'cards'))
                                            || jsonb_build_object('seat', ev->'top'->'seat', 'done', ev->'top'->'done'));
    end if;
    pub := public._tl_money(pub, ev, hands);
  end loop;
  return pub;
end $$;

do $$
declare j jsonb := (select j from fx)->'tienlen'; k jsonb; got jsonb; pub jsonb; v jsonb;
begin
  for k in select x from jsonb_array_elements(j->'combo') x loop
    got := public._tl_combo(pg_temp.cs(k->'cards'));
    if k->'expect' = 'null'::jsonb then
      assert got is null, format('combo %s: %s, want none', k->'cards', got);
    else
      assert got->>'type' = k->'expect'->>'type' and (got->>'len')::int = (k->'expect'->>'len')::int
             and (got->>'key')::int = pg_temp.c(k->'expect'->>'key'), format('combo %s: %s, want %s', k->'cards', got, k->'expect');
      assert public._tl_value(got) = (k->>'value')::int, format('value %s: %s', k->'cards', public._tl_value(got));
    end if;
  end loop;
  for k in select x from jsonb_array_elements(j->'beats') x loop
    assert public._tl_beats(public._tl_combo(pg_temp.cs(k->'top')), public._tl_combo(pg_temp.cs(k->'x'))) = (k->>'expect')::boolean,
      format('beats %s over %s: want %s', k->'x', k->'top', k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'trang') x loop
    assert public._tl_trang(pg_temp.cs(k->'cards')) is not distinct from k->>'expect',
      format('trang %s: %s, want %s', k->'cards', public._tl_trang(pg_temp.cs(k->'cards')), k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'thoi') x loop
    assert public._tl_thoi(pg_temp.cs(k->'cards')) = (k->>'expect')::int,
      format('thoi %s: %s, want %s', k->'cards', public._tl_thoi(pg_temp.cs(k->'cards')), k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'settle') x loop
    pub := pg_temp.tl_fold(k);
    got := (select coalesce(jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'h', l->'paid', l->'why') order by n), '[]')
              from jsonb_array_elements(pub->'lines') with ordinality e(l, n));
    assert got = k->'expect'->'lines', format('%s: lines %s, want %s', k->>'name', got, k->'expect'->'lines');
    got := (select coalesce(jsonb_object_agg(key, value->'place'), '{}') from jsonb_each(pub->'players') where value->>'place' is not null);
    assert got = k->'expect'->'places', format('%s: places %s, want %s', k->>'name', got, k->'expect'->'places');
    got := (select coalesce(jsonb_object_agg(key, value->'out'), '{}') from jsonb_each(pub->'players') where value->>'out' is not null);
    assert got = k->'expect'->'out', format('%s: out %s, want %s', k->>'name', got, k->'expect'->'out');
    got := (select jsonb_object_agg(q, coalesce((select sum(case when l->>'to' = q then (l->>'paid')::int else -(l->>'paid')::int end)
                                                   from jsonb_array_elements(pub->'lines') l where q in (l->>'from', l->>'to')), 0))
              from jsonb_array_elements_text(k->'order') q);
    assert got = k->'expect'->'net', format('%s: net %s, want %s', k->>'name', got, k->'expect'->'net');
    v := (select to_jsonb(sum(value::int)) from jsonb_each_text(got));
    assert v = '0'::jsonb, format('%s: the net sums to %s', k->>'name', v);
  end loop;
end $$;

-- ---------- the shuffle and privacy (§6.4, §11.1) ----------
do $$
declare d integer[]; n integer; def text;
begin
  for n in 1..20 loop
    d := public._card_shuffle();
    assert (select array_agg(x order by x) from unnest(d) x) = array(select generate_series(0, 51)), 'a shuffle is a permutation';
  end loop;
  assert (select bool_and(public._card_rand(7) between 0 and 6) from generate_series(1, 300)), 'draws stay in range';
  assert (select count(distinct public._card_rand(3)) from generate_series(1, 300)) = 3, 'every value comes up';
  assert not exists (select 1 from unnest(array['card_tables', 'card_seats', 'card_hands', 'card_secrets', 'card_log']) t,
                                   unnest(array['anon', 'authenticated']) r
                      where has_table_privilege(r, 'public.' || t, 'select, insert, update, delete')), 'the card tables are private';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like '\_card\_%' or p.proname like '\_tl\_%')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check');
  assert (select bool_and(position(quote_literal(r) in def) > 0)
            from unnest(array['wipe', 'harvester', 'produce_sell', 'card_hold', 'card_settle', 'card_buyin', 'card_cashout',
                              'card_refund', 'land_refund', 'rice_sell']) r), format('ledger reasons: %s', def);
end $$;

select 'v16 rules smoke ok' as result;

-- ---------- the rules against the shared fixtures (§17): Cào and poker ----------
do $$
declare j jsonb := (select j from fx); k jsonb; got jsonb; want jsonb; ek integer[]; c integer;
begin
  for k in select x from jsonb_array_elements(j->'cao'->'eval') x loop
    got := public._cao_eval(pg_temp.cs(k->'cards'));
    want := k->'expect';
    assert got->>'kind' = want->>'kind' and (got->>'points')::int = (want->>'points')::int
           and (got->>'rank')::int is not distinct from (want->>'rank')::int
           and (got->>'top')::int = public._cao_key(pg_temp.c(want->>'top')), format('cao %s: %s, want %s', k->'cards', got, want);
  end loop;
  for k in select x from jsonb_array_elements(j->'cao'->'cmp') x loop
    c := public._cao_cmp(public._cao_eval(pg_temp.cs(k->'a')), public._cao_eval(pg_temp.cs(k->'b')));
    assert c = (k->>'expect')::int and -c = public._cao_cmp(public._cao_eval(pg_temp.cs(k->'b')), public._cao_eval(pg_temp.cs(k->'a'))),
      format('cao %s vs %s: %s, want %s', k->'a', k->'b', c, k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'cao'->'settle') x loop
    got := public._cao_settle(jsonb_build_object('dealer', k->'dealer', 'order', k->'order', 'left', k->'left',
             'hands', (select jsonb_object_agg(key, to_jsonb(pg_temp.cs(value))) from jsonb_each(k->'hands'))));
    assert (select jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'why') order by n)
              from jsonb_array_elements(got->'lines') with ordinality e(l, n)) = k->'expect'->'lines'
           and got->'net' = k->'expect'->'net', format('%s: %s', k->>'name', got);
  end loop;
  for k in select x from jsonb_array_elements(j->'poker'->'eval') x loop
    ek := public._pk_eval(pg_temp.cs(k->'cards'));
    assert to_jsonb(ek) = k->'expect', format('poker %s: %s, want %s', k->'cards', ek, k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'poker'->'cmp') x loop
    ek := public._pk_eval(pg_temp.cs(k->'a'));
    c := case when ek > public._pk_eval(pg_temp.cs(k->'b')) then 1 when ek < public._pk_eval(pg_temp.cs(k->'b')) then -1 else 0 end;
    assert c = (k->>'expect')::int, format('poker %s vs %s: %s, want %s', k->'a', k->'b', c, k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'poker'->'pots') x loop
    got := public._pk_pots(jsonb_build_object('players', k->'players', 'keys', k->'keys', 'button', k->'button'));
    assert got = k->'expect', format('%s: %s, want %s', k->>'name', got, k->'expect');
  end loop;
end $$;

select 'v16 cao and poker rules smoke ok' as result;

-- ---------- tables and seats (§6.1, §6.3, §11.3): the reads, sitting and its refusals, leaving, the sweep, the reset ----------
-- The tampered calls below are only recorded: log mode locks nobody.
update public.anticheat_config set mode = 'log';
insert into smoke select 'c' || n, token from generate_series(1, 6) n,
  lateral public.register('v16c' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('c1', 'c2', 'c3', 'c4', 'c5', 'c6');
insert into smoke select 'room', room_id::text from public.create_room('Góc bài', 'pw', (select v from smoke where k = 'c1'));
do $$
begin
  perform public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
     from smoke where k in ('c2', 'c3', 'c4', 'c6');
end $$;
insert into smoke select 'other', room_id::text from public.create_room('Phòng khác', 'pw', (select v from smoke where k = 'c5'));

create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.coins(a uuid) returns integer language sql
as $$ select coalesce((select coins from public.wallets where account_id = a), 0) $$;
-- The xu of these accounts plus everything on the room's tables: escrows, stacks and a live pot (§6.2). Card calls never
-- change it.
create function pg_temp.money(p_room uuid, p_accounts uuid[]) returns bigint language sql as $$
  select coalesce((select sum(w.coins) from public.wallets w where w.account_id = any(p_accounts)), 0)
       + coalesce((select sum(s.chips + s.escrow) from public.card_seats s where s.room_id = p_room), 0)
       + coalesce((select sum((p.value->>'put')::bigint) from public.card_tables t, jsonb_each(t.pub->'players') p
                    where t.room_id = p_room and t.game = 'poker' and t.phase = 'playing'), 0)
$$;
-- A strike-0 envelope with this code and error, and nothing else in the answer.
create function pg_temp.env(r jsonb, code text, error text) returns boolean language sql
as $$ select r->'anticheat'->>'code' = code and (r->'anticheat'->>'strike')::int = 0 and r->'anticheat'->>'error' = error
             and r - 'anticheat' = '{}'::jsonb $$;

do $$
declare c1 text := (select v from smoke where k = 'c1'); c5 text := (select v from smoke where k = 'c5');
        room uuid := (select v from smoke where k = 'room')::uuid; a1 uuid := (select v from smoke where k = 'a1')::uuid;
        r jsonb; s jsonb; call text;
begin
  -- a room with no card rows reads as three idle, empty tables, and reading creates nothing (R37)
  r := public.card_lobby(room, c1);
  assert (select jsonb_agg(jsonb_build_array(x->'game', x->'max', x->'phase', x->'stake', x->'seats')) from jsonb_array_elements(r->'tables') x)
         = '[["tienlen", 4, "idle", null, []], ["cao", 6, "idle", null, []], ["poker", 6, "idle", null, []]]'::jsonb,
    format('the empty lobby: %s', r);
  s := public.card_state(room, c1, 'poker');
  assert s->>'game' = 'poker' and s->>'phase' = 'idle' and s->'seats' = '[]' and (s->>'v')::int = 0 and (s->>'max')::int = 6
         and s->'stake' = 'null' and s->'pub' = '{}' and s->'last' = 'null' and s->>'server_now' is not null, format('idle state: %s', s);
  s := public.card_hand(room, c1, 'tienlen');
  assert s->'cards' = '[]' and s->'seat' = 'null' and (s->>'hand_no')::int = 0, format('no hand: %s', s);
  assert not exists (select 1 from public.card_tables where room_id = room), 'reads create no table rows';
  -- membership comes first (R38)
  foreach call in array array[
    format('select public.card_lobby(%L, %L)', room, c5),
    format('select public.card_state(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_hand(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_tick(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_leave(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c5, 'tienlen')] loop
    assert pg_temp.err(call) = 'account is not a member of this room', format('%s: %s', call, pg_temp.err(call));
    assert pg_temp.err(replace(call, c5, 'nope')) = 'invalid session', format('%s with a bad token', call);
  end loop;
  -- a bad game from a read, a tick or a leave is refused, never flagged (§11.5)
  foreach call in array array[
    format('select public.card_state(%L, %L, %L)', room, c1, 'bai'),
    format('select public.card_hand(%L, %L, null)', room, c1),
    format('select public.card_tick(%L, %L, %L)', room, c1, 'Poker'),
    format('select public.card_leave(%L, %L, %L)', room, c1, '')] loop
    assert pg_temp.err(call) = 'invalid game', format('%s: %s', call, pg_temp.err(call));
  end loop;
  -- the hard signals of card_sit (§11.5): an envelope in log mode, and nothing sits
  assert pg_temp.env(public.card_sit(room, c1, 'bai', 1, 1000, null), 'bad_game', 'invalid game'), 'bad_game';
  assert pg_temp.env(public.card_sit(room, c1, null, 1, 1000, null), 'bad_game', 'invalid game'), 'bad_game null';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 5, 1000, null), 'bad_seat', 'invalid seat'), 'bad_seat 5';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 0, 1000, null), 'bad_seat', 'invalid seat'), 'bad_seat 0';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 7, 1000, 100000), 'bad_seat', 'invalid seat'), 'bad_seat 7';
  assert pg_temp.env(public.card_sit(room, c1, 'cao', null, 1000, null), 'bad_seat', 'invalid seat'), 'bad_seat null';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 1, 500, null), 'bad_stake', 'invalid stake'), 'bad_stake';
  assert pg_temp.env(public.card_sit(room, c1, 'cao', 1, null, null), 'bad_stake', 'invalid stake'), 'bad_stake null';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 1, 1000, 49999), 'bad_qty', 'invalid quantity'), 'buy-in below 50 BB';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 1, 1000, 200001), 'bad_qty', 'invalid quantity'), 'buy-in above 200 BB';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 1, 100, null), 'bad_qty', 'invalid quantity'), 'no buy-in';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 1, 1000, 10000), 'bad_qty', 'invalid quantity'), 'a buy-in at Tiến lên';
  assert (select count(*) from public.anticheat_events where account_id = a1 and outcome = 'log_only'
            and code in ('bad_game', 'bad_seat', 'bad_stake', 'bad_qty') and rpc = 'card_sit') = 12, 'twelve hard signals logged';
  assert not exists (select 1 from public.card_seats where room_id = room), 'nobody sat';
end $$;

do $$
declare c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c6 text := (select v from smoke where k = 'c6'); room uuid := (select v from smoke where k = 'room')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a6 uuid := (select v from smoke where k = 'a6')::uuid; accs uuid[]; m bigint; r jsonb; v0 bigint;
begin
  accs := array[a1, a2, a3, a4, a6];
  perform pg_temp.set_coins(a1, 50000);
  perform pg_temp.set_coins(a2, 9999);
  perform pg_temp.set_coins(a3, 20000);
  perform pg_temp.set_coins(a4, 20000);
  perform pg_temp.set_coins(a6, 20000);
  m := pg_temp.money(room, accs);
  -- the first player picks the stake; Tiến lên holds nothing until the deal
  r := public.card_sit(room, c1, 'tienlen', 1, 1000, null);
  assert (r->>'changed')::boolean and (r->'state'->>'stake')::int = 1000 and r->'state'->>'phase' = 'idle'
         and r->'state'->'seats' = jsonb_build_array(jsonb_build_object('seat', 1, 'id', a1, 'name', (select username from public.accounts where id = a1),
                                                                        'chips', 0, 'escrow', 0, 'leaving', false))
         and (r->>'coins')::int = 50000 and r->'hand'->'cards' = '[]' and (r->'hand'->>'seat')::int = 1, format('c1 sits: %s', r);
  -- 10 S in the wallet to sit at Tiến lên (§6.1)
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 2, 1000, null)', room, c2, 'tienlen')) = 'not enough coins', 'c2 is short';
  perform pg_temp.set_coins(a2, 10000);
  m := pg_temp.money(room, accs);
  r := public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  assert r->'state'->>'phase' = 'countdown'
         and (r->'state'->>'deadline')::timestamptz between now() + interval '7 seconds' and now() + interval '9 seconds',
    format('the second seat starts the 8 s countdown: %s', r->'state');
  -- the refusals, in their order (§11.3)
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, null)', room, c1, 'cao')) = 'already seated', 'one seat per room';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c3, 'tienlen')) = 'seat taken', 'seat taken';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 3, 100, null)', room, c3, 'tienlen')) = 'stake changed', 'the stake is 1000';
  perform public.card_sit(room, c3, 'tienlen', 3, 1000, null);
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c6, 'tienlen')) = 'table full', 'full before taken';
  -- standing up outside a hand: the seat goes at once
  r := public.card_leave(room, c4, 'tienlen');
  assert jsonb_array_length(r->'state'->'seats') = 3 and r->'hand'->'seat' = 'null', 'c4 stood up';
  assert pg_temp.err(format('select public.card_leave(%L, %L, %L)', room, c4, 'tienlen')) = 'not seated', 'not seated';
  -- poker: the buy-in moves to the table, standing up cashes it out, and the empty table resets
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 3, 1000, 50000)', room, c6, 'poker')) = 'not enough coins', 'buy-in > wallet';
  r := public.card_sit(room, c4, 'poker', 2, 100, 5000);
  assert pg_temp.coins(a4) = 15000 and (r->>'coins')::int = 15000 and (r->'state'->'seats'->0->>'chips')::int = 5000
         and (r->'state'->>'stake')::int = 100, format('the buy-in: %s', r->'state');
  assert (select reason = 'card_buyin' and delta = -5000 and ref = 'pk#0' from public.coin_ledger where account_id = a4 order by id desc limit 1),
    'card_buyin in the ledger';
  assert pg_temp.money(room, accs) = m, 'zero-sum after the buy-in';
  v0 := (select v from public.card_tables where room_id = room and game = 'poker');
  r := public.card_leave(room, c4, 'poker');
  assert pg_temp.coins(a4) = 20000 and r->'state'->'seats' = '[]' and r->'state'->'stake' = 'null', format('cashed out: %s', r->'state');
  assert (select reason = 'card_cashout' and delta = 5000 from public.coin_ledger where account_id = a4 order by id desc limit 1),
    'card_cashout in the ledger';
  assert (select v > v0 from public.card_tables where room_id = room and game = 'poker'), 'the reset shows';
  assert pg_temp.money(room, accs) = m, 'zero-sum after the cash-out';
  -- a read touches seen_at, at most once per 10 s (R28)
  update public.card_seats set seen_at = now() - interval '5 minutes' where room_id = room and account_id = a1;
  perform public.card_state(room, c1, 'cao');
  assert (select seen_at > now() - interval '1 minute' from public.card_seats where room_id = room and account_id = a1), 'touched';
  -- the sweep stands up a kicked member and a banned account together (§6.3)
  perform public.kick_member(room, c1, (select id from public.members where room_id = room and account_id = a3));
  update public.accounts set is_banned = true where id = a2;
  r := public.card_tick(room, c1, 'tienlen');
  assert (r->>'changed')::boolean and jsonb_array_length(r->'state'->'seats') = 1 and r->'state'->>'phase' = 'idle',
    format('the sweep left one seat and went idle: %s', r->'state');
  assert pg_temp.money(room, accs) = m, 'zero-sum after the sweep';
  update public.accounts set is_banned = false where id = a2;
  perform public.join_room((select code from public.rooms where id = room), 'pw', c3);
  r := public.card_tick(room, c1, 'tienlen');
  assert not (r->>'changed')::boolean, 'nothing more is due';
  -- the last seat to go resets the table (R36)
  update public.card_tables set lead_id = a1, pos = 3, first_game = false, last = '{"hand_no": 1}'
   where room_id = room and game = 'tienlen';
  perform public.card_leave(room, c1, 'tienlen');
  assert (select stake is null and phase = 'idle' and first_game and pub = '{}' and last is null and lead_id is null and pos is null
                 and turn is null and deadline is null
            from public.card_tables where room_id = room and game = 'tienlen'), 'the empty table reset';
  -- a locked account cannot sit, but reads, ticks and leaves (R31)
  insert into public.anticheat_status (account_id, locked_until) values (a6, now() + interval '5 minutes')
  on conflict (account_id) do update set locked_until = excluded.locked_until;
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, null)', room, c6, 'cao')) = 'account locked', 'locked';
  perform public.card_lobby(room, c6);
  perform public.card_state(room, c6, 'cao');
  perform public.card_hand(room, c6, 'cao');
  perform public.card_tick(room, c6, 'cao');
  assert pg_temp.err(format('select public.card_leave(%L, %L, %L)', room, c6, 'cao')) = 'not seated', 'a locked account may leave';
  update public.anticheat_status set locked_until = null where account_id = a6;
  assert pg_temp.money(room, accs) = m, 'zero-sum at the end';
end $$;

select 'v16 tables smoke ok' as result;
