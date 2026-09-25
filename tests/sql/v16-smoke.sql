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
