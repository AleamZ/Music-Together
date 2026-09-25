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

-- ---------- Tiến lên (§7, §17): four players, fixed decks, the public RPCs; the clock through _card_tick ----------
-- A hand from its codes ("3S 10H"), the same sorted as card_hand shows it, a deck that deals these hands in seat order
-- (the other cards follow in card order), the money of the six accounts plus the room's tables, the Tiến lên row, the
-- balances by seat, the lines so far (half-stakes) and the last result (xu).
create function pg_temp.hand(p text) returns integer[] language sql immutable as $$
  select array_agg(pg_temp.c(x) order by n) from unnest(string_to_array(p, ' ')) with ordinality u(x, n)
$$;
create function pg_temp.sorted(p text) returns jsonb language sql immutable as $$
  select to_jsonb(array(select x from unnest(pg_temp.hand(p)) x order by x))
$$;
create function pg_temp.deck(variadic p text[]) returns integer[] language sql immutable as $$
  select d || array(select c from generate_series(0, 51) c where not (c = any(d)) order by c)
    from (select array_agg(x order by i, j) d
            from unnest(p) with ordinality h(s, i), unnest(pg_temp.hand(s)) with ordinality u(x, j)) z
$$;
create function pg_temp.total() returns bigint language sql as $$
  select pg_temp.money((select v from smoke where k = 'room')::uuid, array(select v::uuid from smoke where k ~ '^a[1-6]$'))
$$;
create function pg_temp.tt() returns public.card_tables language sql as $$
  select * from public.card_tables where room_id = (select v from smoke where k = 'room')::uuid and game = 'tienlen'
$$;
create function pg_temp.esc() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(seat::text, escrow), '{}') from public.card_seats
   where room_id = (select v from smoke where k = 'room')::uuid and game = 'tienlen'
$$;
create function pg_temp.plines() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'h', l->'paid', l->'why') order by n), '[]')
    from jsonb_array_elements((pg_temp.tt()).pub->'lines') with ordinality e(l, n)
$$;
create function pg_temp.result() returns jsonb language sql as $$
  select jsonb_build_object('places', t.last->'places', 'out', t.last->'out', 'net', t.last->'net',
    'lines', (select coalesce(jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'xu', l->'paid', l->'why') order by n), '[]')
                from jsonb_array_elements(t.last->'lines') with ordinality e(l, n)))
    from pg_temp.tt() t
$$;
-- The deal that is due, at the table's deadline, with this deck.
create function pg_temp.deal(p_deck integer[]) returns public.card_tables language plpgsql as $$
declare r jsonb;
begin
  r := public._card_tick((select v from smoke where k = 'room')::uuid, (select v from smoke where k = 'a1')::uuid, 'tienlen',
                         (pg_temp.tt()).deadline, p_deck);
  assert (r->>'changed')::boolean, format('the deal: %s', r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the deal';
  return pg_temp.tt();
end $$;
-- A play (codes) or a pass (null) with the table's seq: an action answer, the seq moved on, and the money in place.
create function pg_temp.tl(p_token text, p_cards text) returns jsonb language plpgsql as $$
declare room uuid := (select v from smoke where k = 'room')::uuid; q integer := (pg_temp.tt()).seq; r jsonb;
begin
  if p_cards is null then
    r := public.tl_pass(room, p_token, q);
  else
    r := public.tl_play(room, p_token, q, pg_temp.hand(p_cards));
  end if;
  assert r ? 'state' and (r->'state'->>'seq')::int > q, format('%s: %s', coalesce(p_cards, 'pass'), r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, format('zero-sum after %s', coalesce(p_cards, 'pass'));
  return r;
end $$;
-- A move the state refuses: a soft bad_move with this error (R30), and nothing changes.
create function pg_temp.tl_bad(p_token text, p_cards text, p_error text) returns void language plpgsql as $$
declare room uuid := (select v from smoke where k = 'room')::uuid; q integer := (pg_temp.tt()).seq; r jsonb;
begin
  if p_cards is null then
    r := public.tl_pass(room, p_token, q);
  else
    r := public.tl_play(room, p_token, q, pg_temp.hand(p_cards));
  end if;
  assert pg_temp.env(r, 'bad_move', p_error), format('%s: %s, want %s', coalesce(p_cards, 'pass'), r, p_error);
  assert (pg_temp.tt()).seq = q, format('%s changed the table', coalesce(p_cards, 'pass'));
end $$;

-- Game 1 (Example 1): the first game and its `must`, the hard signals, stale, the refused moves, a cut chain across three
-- players, the settlement.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c6 text := (select v from smoke where k = 'c6');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a6 uuid := (select v from smoke where k = 'a6')::uuid; t public.card_tables; r jsonb; s jsonb; q integer;
begin
  perform pg_temp.set_coins(a, 100000) from unnest(array[a1, a2, a3, a4, a6]) a;
  insert into smoke values ('m', pg_temp.total()::text) on conflict (k) do update set v = excluded.v;
  perform public.card_sit(room, c1, 'tienlen', 1, 1000, null);
  perform public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  perform public.card_sit(room, c3, 'tienlen', 3, 1000, null);
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  t := pg_temp.deal(pg_temp.deck('3S 4H 5H 6H 7H 8H 9H 10H JH QH KH 2C 2D', '4S 5C 5D 6C 6D 7C 7D 8S 9S 10S JS QS KS',
                                 '5S AS AC AD AH 3C 3D 8C 9C 10C JC QC KC', '2H 2S 3H 4C 4D 6S 7S 8D 9D 10D JD QD KD'));
  -- the first game (R15): the holder of 3♠ leads, and the lead must include it
  assert t.phase = 'playing' and t.hand_no = 1 and t.turn = 1 and (t.pub->>'first')::boolean and (t.pub->>'must')::int = 0
         and t.pub->'order' = '[1, 2, 3, 4]' and (select bool_and(p.value->'n' = '13') from jsonb_each(t.pub->'players') p),
    format('the first game: %s', t.pub);
  assert pg_temp.esc() = '{"1": 10000, "2": 10000, "3": 10000, "4": 10000}' and pg_temp.coins(a1) = 90000
         and (select count(*) from public.coin_ledger where reason = 'card_hold' and ref = 'tl#1' and delta = -10000) = 4,
    'each player holds 10 S';
  -- the hands are private (§6.4, R25): card_hand shows the owner's cards only, and the state holds none
  r := public.card_hand(room, c1, 'tienlen');
  assert r->'cards' = pg_temp.sorted('3S 4H 5H 6H 7H 8H 9H 10H JH QH KH 2C 2D') and (r->>'seat')::int = 1, format('c1: %s', r);
  r := public.card_hand(room, c6, 'tienlen');
  assert r->'cards' = '[]' and r->'seat' = 'null', format('a spectator: %s', r);
  s := public.card_state(room, c1, 'tienlen');
  assert s = public.card_state(room, c6, 'tienlen'), 'every viewer reads the same state';
  assert (select array_agg(k order by k collate "C") from jsonb_object_keys(s->'pub') k)
         = array['chain', 'first', 'lines', 'must', 'order', 'passed', 'pile', 'players', 'top'], format('the public keys: %s', s->'pub');
  assert (select bool_and((select array_agg(k order by k collate "C") from jsonb_object_keys(p.value) k)
                          = array['id', 'n', 'out', 'paid', 'place', 'played', 'settled'])
            from jsonb_each(s->'pub'->'players') p), format('the players show counts, never cards: %s', s->'pub'->'players');
  -- the hard signal of tl_play (§11.5): an envelope in log mode, before any lock
  q := (pg_temp.tt()).seq;
  assert pg_temp.env(public.tl_play(room, c1, q, null), 'bad_cards', 'invalid cards'), 'null cards';
  assert pg_temp.env(public.tl_play(room, c1, q, '{}'), 'bad_cards', 'invalid cards'), 'no cards';
  assert pg_temp.env(public.tl_play(room, c1, q, array(select generate_series(0, 13))), 'bad_cards', 'invalid cards'), '14 cards';
  assert pg_temp.env(public.tl_play(room, c1, q, array[52]), 'bad_cards', 'invalid cards'), 'card 52';
  assert pg_temp.env(public.tl_play(room, c1, q, array[-1]), 'bad_cards', 'invalid cards'), 'card -1';
  assert pg_temp.env(public.tl_play(room, c1, q, array[0, 0]), 'bad_cards', 'invalid cards'), 'a card twice';
  assert pg_temp.env(public.tl_play(room, c1, q, array[0, null]), 'bad_cards', 'invalid cards'), 'a null card';
  assert pg_temp.env(public.tl_play(room, c1, q, '{{0, 1}, {2, 3}}'), 'bad_cards', 'invalid cards'), 'a 2-D array';
  assert (select count(*) from public.anticheat_events where account_id = a1 and code = 'bad_cards' and outcome = 'log_only'
            and rpc = 'tl_play') = 8, 'eight hard signals logged';
  -- stale (R24) and not seated are raised and never logged
  assert pg_temp.err(format('select public.tl_play(%L, %L, %s, array[0])', room, c1, q - 1)) = 'stale', 'an old seq';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, null)', room, c1)) = 'stale', 'no seq';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, %s)', room, c6, q)) = 'not seated', 'a spectator acts';
  -- well-formed moves the state refuses are soft (R30)
  perform pg_temp.tl_bad(c1, '4H', 'must include');
  perform pg_temp.tl_bad(c1, null, 'must play');
  perform pg_temp.tl_bad(c1, '3S 4H', 'invalid play');
  perform pg_temp.tl_bad(c1, '3C', 'invalid play');
  perform pg_temp.tl_bad(c2, '4S', 'not your turn');
  perform pg_temp.tl_bad(c2, null, 'not your turn');
  assert (select count(*) from public.anticheat_events where account_id in (a1, a2) and code = 'bad_move' and outcome = 'soft'
            and rpc in ('tl_play', 'tl_pass')) = 6, 'six soft signals';
  -- round 1: D's 2♥ is cut by B's 3 đôi thông, B by C's tứ quý; B pays C the chain when the round closes (R7)
  perform pg_temp.tl(c1, '3S');
  perform pg_temp.tl(c2, '4S');
  perform pg_temp.tl_bad(c3, '3C', 'cannot beat');
  perform pg_temp.tl(c3, '5S');
  perform pg_temp.tl(c4, '2H');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '5C 5D 6C 6D 7C 7D');
  assert (pg_temp.tt()).pub->'chain' = '{"h": 2, "victim": 4, "cutter": 2, "void": false}', format('the first cut: %s', (pg_temp.tt()).pub->'chain');
  perform pg_temp.tl(c3, 'AS AC AD AH');
  t := pg_temp.tt();
  assert t.pub->'chain' = '{"h": 5, "victim": 2, "cutter": 3, "void": false}' and t.turn = 4, format('the second cut: %s', t.pub);
  perform pg_temp.tl(c4, null);
  t := pg_temp.tt();
  assert t.turn = 2 and t.pub->'passed' = '[1, 4]', format('the passed seats are skipped: %s', t.pub->'passed');
  perform pg_temp.tl(c2, null);
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'chain' = 'null' and t.pub->'top' = 'null' and t.pub->'passed' = '[]' and t.pub->'pile' = '[]'
         and pg_temp.plines() = '[[2, 3, 5, 5, "chat"]]', format('the round closed: %s', t.pub);
  assert pg_temp.esc() = '{"1": 10000, "2": 7500, "3": 12500, "4": 10000}', format('the chain moved at once: %s', pg_temp.esc());
  -- round 2: a pair of 2s takes the round
  perform pg_temp.tl(c3, '3C 3D');
  perform pg_temp.tl(c4, null);
  perform pg_temp.tl(c1, '2C 2D');
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  assert (pg_temp.tt()).turn = 1, 'the pair of 2s leads';
  -- round 3: A goes out; everyone has played, so nobody is cóng; the next seat leads (hưởng sái)
  perform pg_temp.tl(c1, '4H 5H 6H 7H 8H 9H 10H JH QH KH');
  t := pg_temp.tt();
  assert t.pub->'players'->'1' @> '{"out": "done", "place": 1, "n": 0}' and t.turn = 2
         and not exists (select 1 from jsonb_each(t.pub->'players') p where p.value->>'out' = 'cong'), format('nhất: %s', t.pub);
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, null);
  assert (pg_temp.tt()).turn = 2, 'hưởng sái';
  -- round 4: B and C go out; D, still holding 2♠, is bét
  perform pg_temp.tl(c2, '8S 9S 10S JS QS KS');
  r := pg_temp.tl(c3, '8C 9C 10C JC QC KC');
  t := pg_temp.tt();
  assert t.phase = 'result' and t.turn is null and t.deadline = now() + interval '8 seconds' and t.lead_id = a1 and not t.first_game,
    format('the result: %s', to_jsonb(t));
  assert pg_temp.result() = '{"places": [1, 2, 3, 4], "out": {"1": "done", "2": "done", "3": "done"},
                              "net": {"1": 1000, "2": -2000, "3": 2500, "4": -1500},
                              "lines": [[2, 3, 2500, 2500, "chat"], [4, 1, 1000, 1000, "bet"], [3, 2, 500, 500, "ba"],
                                        [4, 3, 500, 500, "thoi"]]}', format('Example 1: %s', pg_temp.result());
  assert t.last->'hands' = jsonb_build_object('4', pg_temp.sorted('2S 3H 4C 4D 6S 7S 8D 9D 10D JD QD KD')),
    format('the cards still held: %s', t.last->'hands');
  assert pg_temp.coins(a1) = 101000 and pg_temp.coins(a2) = 98000 and pg_temp.coins(a3) = 102500 and pg_temp.coins(a4) = 98500
         and (r->>'coins')::int = 102500 and pg_temp.esc() = '{"1": 0, "2": 0, "3": 0, "4": 0}'
         and (select count(*) from public.coin_ledger where reason = 'card_settle' and ref = 'tl#1') = 4, 'everyone is paid out';
end $$;

-- Game 2: nhất leads; a chain of three cuts, the last a 4 đôi thông out of turn after passing (R9); D leaves while the
-- chain is open on it — the forfeit at once, capped at 10 S (R13, R14); `still leaving`; the others finish as three.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c6 text := (select v from smoke where k = 'c6');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        t public.card_tables; r jsonb;
begin
  t := pg_temp.deal(pg_temp.deck('2D 2H 6D 7D 8D 9D 10D JD QD KC KD AC AD', '6S 6C 7S 7C 8S 8C 9S 9C 10S JS QS KS AS',
                                 '3S 3C 3D 3H 6H 7H 8H 9H 10H JH QH KH AH', '4S 4C 4D 4H 5S 5C 5D 5H 2S 2C 10C JC QC'));
  assert t.hand_no = 2 and t.turn = 1 and not (t.pub->>'first')::boolean and t.pub->'must' = 'null', format('nhất leads: %s', t.pub);
  perform pg_temp.tl(c1, '2D 2H');
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, '3S 3C 3D 3H');
  perform pg_temp.tl(c4, '4S 4C 4D 4H');
  t := pg_temp.tt();
  assert t.turn = 1 and t.pub->'chain' = '{"h": 8, "victim": 3, "cutter": 4, "void": false}', format('two cuts: %s', t.pub);
  perform pg_temp.tl_bad(c3, '6H', 'not your turn');
  perform pg_temp.tl_bad(c2, '6S 6C 7S 7C 8S 8C', 'not your turn');
  perform pg_temp.tl(c2, '6S 6C 7S 7C 8S 8C 9S 9C');
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'passed' = '[]' and t.pub->'chain' = '{"h": 12, "victim": 4, "cutter": 2, "void": false}',
    format('4 đôi thông after passing: %s', t.pub);
  r := public.card_leave(room, c4, 'tienlen');
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the forfeit';
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'chain' = 'null' and t.pub->'players'->'4' @> '{"out": "forfeit", "settled": true, "paid": 20}'
         and pg_temp.plines() = '[[4, 2, 12, 12, "chat"], [4, 1, 2, 2, "forfeit"], [4, 2, 2, 2, "forfeit"],
                                  [4, 3, 2, 2, "forfeit"], [4, 1, 6, 2, "thoi"]]', format('the forfeit: %s', t.pub);
  assert pg_temp.esc() = '{"1": 12000, "2": 17000, "3": 11000, "4": 0}' and (r->>'coins')::int = 88500 and pg_temp.coins(a4) = 88500
         and (select leaving from public.card_seats where room_id = room and game = 'tienlen' and seat = 4)
         and not exists (select 1 from public.coin_ledger where account_id = a4 and ref = 'tl#2' and reason = 'card_settle'),
    format('D pays 10 S and leaves with nothing: %s', pg_temp.esc());
  -- the leaving row keeps the seat and the account's one seat in the room until the game ends (R2)
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, null)', room, c4, 'cao')) = 'still leaving', 'cao';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, 5000)', room, c4, 'poker')) = 'still leaving', 'poker';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 4, 1000, null)', room, c4, 'tienlen')) = 'still leaving', 'tienlen';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 4, 1000, null)', room, c6, 'tienlen')) = 'table full', 'the seat is held';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, %s)', room, c4, (pg_temp.tt()).seq)) = 'not seated', 'D never acts again';
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, null);
  assert (pg_temp.tt()).turn = 2, 'the last cutter leads';
  perform pg_temp.tl(c2, '10S JS QS KS AS');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, null);
  assert (pg_temp.tt()).turn = 3, 'hưởng sái';
  perform pg_temp.tl(c3, '6H 7H 8H 9H 10H JH QH KH AH');
  t := pg_temp.tt();
  assert pg_temp.result() = '{"places": [2, 3, 1], "out": {"2": "done", "3": "done", "4": "forfeit"},
                              "net": {"1": 1000, "2": 8000, "3": 1000, "4": -10000},
                              "lines": [[4, 2, 6000, 6000, "chat"], [4, 1, 1000, 1000, "forfeit"], [4, 2, 1000, 1000, "forfeit"],
                                        [4, 3, 1000, 1000, "forfeit"], [4, 1, 3000, 1000, "thoi"], [1, 2, 1000, 1000, "bet"]]}',
    format('a smaller game: %s', pg_temp.result());
  assert t.last->'hands' = jsonb_build_object('1', pg_temp.sorted('6D 7D 8D 9D 10D JD QD KC KD AC AD'),
                                              '4', pg_temp.sorted('5S 5C 5D 5H 2S 2C 10C JC QC')), format('hands: %s', t.last->'hands');
  assert t.lead_id = a2 and not exists (select 1 from public.card_seats where room_id = room and account_id = a4),
    'the leaving row goes when the game ends';
  assert pg_temp.coins(a1) = 102000 and pg_temp.coins(a2) = 106000 and pg_temp.coins(a3) = 103500, 'paid out';
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
end $$;

-- Game 3 (Example 3): C is dealt 6 đôi — tới trắng; the next deal is a first game (R10, R15).
do $$
declare t public.card_tables; d timestamptz := (pg_temp.tt()).deadline;
begin
  t := pg_temp.deal(pg_temp.deck('3D 4S 5D 6S 7D 8S 9D 10S JD QS KD 2C 2D', '3H 4C 4D 5H 6C 6D 7H 8C 8D AS AC AD AH',
                                 '3S 3C 5S 5C 7S 7C 9S 9C JS JC KS KC 2S', '4H 6H 8H 9H 10C 10D 10H JH QC QD QH KH 2H'));
  assert t.hand_no = 3 and t.phase = 'result' and t.turn is null and t.deadline = d + interval '8 seconds'
         and t.first_game and t.lead_id is null, format('tới trắng: %s', to_jsonb(t));
  assert t.last->'trang' = jsonb_build_object('seat', 3, 'pattern', 'sau_doi',
                                              'cards', pg_temp.sorted('3S 3C 5S 5C 7S 7C 9S 9C JS JC KS KC 2S'))
         and t.last->'hands' = jsonb_build_object('3', pg_temp.sorted('3S 3C 5S 5C 7S 7C 9S 9C JS JC KS KC 2S')),
    format('the winner''s cards: %s', t.last);
  assert pg_temp.result() = '{"places": [], "out": {}, "net": {"1": -2000, "2": -2000, "3": 6000, "4": -2000},
                              "lines": [[4, 3, 2000, 2000, "trang"], [1, 3, 2000, 2000, "trang"], [2, 3, 2000, 2000, "trang"]]}',
    format('Example 3: %s', pg_temp.result());
  assert pg_temp.esc() = '{"1": 0, "2": 0, "3": 0, "4": 0}', 'everyone is paid out';
end $$;

-- Game 4: a first game again (3♠ leads with `must`, although B was the last nhất); three cóng, placed in turn order from
-- nhất, the farthest bét (R11). Then nhất leaves.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        a4 uuid := (select v from smoke where k = 'a4')::uuid; t public.card_tables; r jsonb;
begin
  t := pg_temp.deal(pg_temp.deck('4S 5S 6S 7S 8S 9S 10S JS QS KS AS AC 2H', '4C 5C 6C 7C 8C 9C 10C JC QC KC AD AH 2S',
                                 '3H 4D 5D 6D 7D 8D 9D 10D JD QD KD 2C 2D', '3S 3C 3D 4H 5H 6H 7H 8H 9H 10H JH QH KH'));
  assert t.hand_no = 4 and t.turn = 4 and (t.pub->>'first')::boolean and (t.pub->>'must')::int = 0, format('3♠ leads: %s', t.pub);
  perform pg_temp.tl_bad(c4, '4H', 'must include');
  perform pg_temp.tl(c4, '3S 3C 3D');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, '4H 5H 6H 7H 8H 9H 10H JH QH KH');
  assert pg_temp.result() = '{"places": [4, 1, 2, 3], "out": {"1": "cong", "2": "cong", "3": "cong", "4": "done"},
                              "net": {"1": -3000, "2": -2500, "3": -3500, "4": 9000},
                              "lines": [[1, 4, 3000, 3000, "cong"], [2, 4, 2500, 2500, "cong"], [3, 4, 3500, 3500, "cong"]]}',
    format('three cóng: %s', pg_temp.result());
  r := public.card_leave(room, c4, 'tienlen');
  assert jsonb_array_length(r->'state'->'seats') = 3 and (pg_temp.tt()).lead_id = a4, 'nhất stood up between games';
end $$;

-- Game 5: three players, a first game because the last nhất left (R15); reads never apply a deadline (R37); two
-- timeouts in a row forfeit B before anyone has gone out: C, who has played nothing, is paid and not made cóng — until A
-- goes out (R11, R13, R28).
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        t public.card_tables; r jsonb; s jsonb; v0 bigint;
begin
  t := pg_temp.deal(pg_temp.deck('3S 4S 3C 4C 5H 6H 7H 8H 9H 10H JH QH KH', '2D 3D 5S 6S 7S 8S 9S 10S JS QS KS AS AC',
                                 '2C 3H 4D 4H 5C 6C 7C 8C 9C 10C JC QC KC'));
  assert t.hand_no = 5 and t.pub->'order' = '[1, 2, 3]' and t.turn = 1 and (t.pub->>'first')::boolean
         and (t.pub->>'must')::int = 0 and (select count(*) from public.card_hands where room_id = room and game = 'tienlen') = 3,
    format('three players: %s', t.pub);
  perform pg_temp.tl(c1, '3S');
  update public.card_tables set deadline = now() - interval '1 second' where room_id = room and game = 'tienlen';
  v0 := (pg_temp.tt()).v;
  s := public.card_state(room, c1, 'tienlen');
  perform public.card_hand(room, c2, 'tienlen');
  perform public.card_lobby(room, c3);
  assert s->>'phase' = 'playing' and (s->>'turn')::int = 2 and (s->>'v')::bigint = v0 and (pg_temp.tt()).v = v0
         and (pg_temp.tt()).turn = 2, 'a read past the deadline changes nothing';
  r := public.card_tick(room, c1, 'tienlen');
  assert (r->>'changed')::boolean and (r->'state'->>'turn')::int = 3 and r->'state'->'pub'->'passed' = '[2]'
         and (select missed from public.card_seats where room_id = room and game = 'tienlen' and seat = 2) = 1,
    format('the tick passes for B: %s', r->'state');
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the timeout';
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, '4S');
  update public.card_tables set deadline = now() - interval '1 second' where room_id = room and game = 'tienlen';
  r := public.card_tick(room, c1, 'tienlen');
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the forfeit';
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'players'->'2' @> '{"out": "forfeit", "settled": true}'
         and t.pub->'players'->'3' @> '{"out": null, "played": false}'
         and pg_temp.plines() = '[[2, 3, 2, 2, "forfeit"], [2, 1, 2, 2, "forfeit"], [2, 3, 2, 2, "thoi"]]',
    format('B forfeits, the turn moves on: %s', t.pub);
  assert (select leaving and escrow = 0 and missed = 2 from public.card_seats where room_id = room and game = 'tienlen' and seat = 2)
         and pg_temp.coins(a2) = 98500, 'B is paid out at once';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, %s)', room, c2, t.seq)) = 'not seated', 'B never plays or passes again';
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, '3C 4C 5H 6H 7H 8H 9H 10H JH QH KH');
  assert pg_temp.result() = '{"places": [1, 3], "out": {"1": "done", "2": "forfeit", "3": "cong"},
                              "net": {"1": 3500, "2": -3000, "3": -500},
                              "lines": [[2, 3, 1000, 1000, "forfeit"], [2, 1, 1000, 1000, "forfeit"], [2, 3, 1000, 1000, "thoi"],
                                        [3, 1, 2500, 2500, "cong"]]}', format('cóng at the first go-out: %s', pg_temp.result());
  assert (select count(*) from public.card_log where room_id = room and game = 'tienlen' and hand_no = 5 and action = 'timeout') = 2,
    'the timeouts are logged';
end $$;

-- Game 6 (Example 4): A goes out, D leaves holding 2♥ — 1 S to B and C, the thối of 2♥ to B — and B, C finish.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        t public.card_tables; r jsonb;
begin
  perform public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  t := pg_temp.deal(pg_temp.deck('3D 2S 3C 4C 5C 6C 7C 8C 9C 10C JC QC KC', '5D 6S 7S 8S 9S 10S JS QS KS AS AC 2C 2D',
                                 '3S 3H 4S 4D 5S 6D 7D 8D 9D 10D JD QD KD', '2H 4H 5H 6H 7H 8H 9H 10H JH QH KH AD AH'));
  assert t.hand_no = 6 and t.turn = 1 and not (t.pub->>'first')::boolean, format('A leads: %s', t.pub);
  perform pg_temp.tl(c1, '3D');
  perform pg_temp.tl(c2, '5D');
  perform pg_temp.tl(c3, '6D');
  perform pg_temp.tl(c4, '7H');
  perform pg_temp.tl(c1, '2S');
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, null);
  perform pg_temp.tl(c1, '3C 4C 5C 6C 7C 8C 9C 10C JC QC KC');
  r := public.card_leave(room, c4, 'tienlen');
  assert pg_temp.plines() = '[[4, 2, 2, 2, "forfeit"], [4, 3, 2, 2, "forfeit"], [4, 2, 2, 2, "thoi"]]'
         and (r->>'coins')::int = 92500 and (pg_temp.tt()).turn = 2, format('Example 4''s forfeit: %s', pg_temp.plines());
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c2, 'AS AC');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c2, '2C 2D');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c2, '6S 7S 8S 9S 10S JS QS KS');
  assert pg_temp.result() = '{"places": [1, 2, 3], "out": {"1": "done", "2": "done", "4": "forfeit"},
                              "net": {"1": 1000, "2": 2000, "3": 0, "4": -3000},
                              "lines": [[4, 2, 1000, 1000, "forfeit"], [4, 3, 1000, 1000, "forfeit"], [4, 2, 1000, 1000, "thoi"],
                                        [3, 1, 1000, 1000, "bet"]]}', format('Example 4: %s', pg_temp.result());
end $$;

-- Game 7: C and D are banned mid-game; one sweep forfeits them together and they pay each other nothing (R13, anti-cheat
-- R10); A and B finish as two.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        t public.card_tables; r jsonb;
begin
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  t := pg_temp.deal(pg_temp.deck('3S 3H 4S 5S 5C 6C 7C 8C 9C 10C JC QC KC', '4D 6S 7S 8S 9S 10S JS QS KS AS AC AD AH',
                                 '3D 4C 5D 6D 7D 8D 9D 10D JD QD KD 2C 2D', '3C 4H 5H 6H 7H 8H 9H 10H JH QH KH 2S 2H'));
  assert t.hand_no = 7 and t.turn = 1, 'A leads';
  perform pg_temp.tl(c1, '3S');
  perform pg_temp.tl(c2, '4D');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, null);
  perform pg_temp.tl(c1, null);
  update public.accounts set is_banned = true where id in (a3, a4);
  r := public.card_tick(room, c1, 'tienlen');
  update public.accounts set is_banned = false where id in (a3, a4);
  assert (r->>'changed')::boolean and pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'the sweep';
  t := pg_temp.tt();
  assert t.turn = 2 and pg_temp.plines() = '[[3, 1, 2, 2, "forfeit"], [3, 2, 2, 2, "forfeit"], [3, 1, 3, 3, "thoi"],
                                             [4, 1, 2, 2, "forfeit"], [4, 2, 2, 2, "forfeit"], [4, 1, 3, 3, "thoi"]]',
    format('swept together: %s', t.pub);
  assert (select count(*) from public.card_log where room_id = room and game = 'tienlen' and hand_no = 7 and action = 'leave'
            and detail->>'how' = 'sweep') = 2, 'both leave by the sweep';
  perform pg_temp.tl(c2, 'AS AC AD AH');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '6S 7S 8S 9S 10S JS QS KS');
  assert pg_temp.result() = '{"places": [2, 1], "out": {"2": "done", "3": "forfeit", "4": "forfeit"},
                              "net": {"1": 4000, "2": 3000, "3": -3500, "4": -3500},
                              "lines": [[3, 1, 1000, 1000, "forfeit"], [3, 2, 1000, 1000, "forfeit"], [3, 1, 1500, 1500, "thoi"],
                                        [4, 1, 1000, 1000, "forfeit"], [4, 2, 1000, 1000, "forfeit"], [4, 1, 1500, 1500, "thoi"],
                                        [1, 2, 1000, 1000, "bet"]]}', format('two players finish: %s', pg_temp.result());
end $$;

-- Game 8: the table empties and resets (R36); a third seat unseen for 60 s is stood up at the deal (R28); two players,
-- 3♠ undealt, so 3♣ leads (R15).
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c6 text := (select v from smoke where k = 'c6');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a6 uuid := (select v from smoke where k = 'a6')::uuid; t public.card_tables;
begin
  perform public.card_leave(room, c1, 'tienlen');
  perform public.card_leave(room, c2, 'tienlen');
  t := pg_temp.tt();
  assert t.stake is null and t.first_game and t.lead_id is null and t.phase = 'idle', 'the empty table reset';
  perform public.card_sit(room, c1, 'tienlen', 1, 1000, null);
  perform public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  perform public.card_sit(room, c6, 'tienlen', 3, 1000, null);
  update public.card_seats set seen_at = now() - interval '2 minutes' where room_id = room and account_id = a6;
  t := pg_temp.deal(pg_temp.deck('3C 5S 6S 7S 8S 9S 10S JS QS KS AS AC AH', '2H 2D 3D 4D 5D 6D 7D 8D 9D 10D JD QD KD'));
  assert t.hand_no = 8 and t.pub->'order' = '[1, 2]' and t.turn = 1 and (t.pub->>'must')::int = 1
         and not exists (select 1 from public.card_seats where room_id = room and account_id = a6)
         and (select count(*) from public.card_log where room_id = room and account_id = a6 and action = 'leave'
                and detail->>'how' = 'idle') = 1, format('two players, 3♣ leads: %s', t.pub);
  perform pg_temp.tl_bad(c1, '5S', 'must include');
  perform pg_temp.tl(c1, '3C');
  perform pg_temp.tl(c2, '2H');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '3D 4D 5D 6D 7D 8D 9D 10D JD QD KD');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '2D');
  assert pg_temp.result() = '{"places": [2, 1], "out": {"2": "done"}, "net": {"1": -1000, "2": 1000},
                              "lines": [[1, 2, 1000, 1000, "bet"]]}', format('a 2-player game: %s', pg_temp.result());
  perform public.card_leave(room, c1, 'tienlen');
  perform public.card_leave(room, c2, 'tienlen');
  assert not exists (select 1 from public.card_seats where room_id = room)
         and pg_temp.total() = (select v from smoke where k = 'm')::bigint
         and pg_temp.coins(a1) = 104500 and pg_temp.coins(a2) = 104500 and pg_temp.coins(a3) = 102000
         and pg_temp.coins(a4) = 89000 and pg_temp.coins(a6) = 100000, 'eight games, zero-sum';
end $$;

select 'v16 tienlen smoke ok' as result;
