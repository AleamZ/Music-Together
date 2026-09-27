-- tests/sql/v19-1-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0040 (see the plan),
-- from the repo root: it re-runs 0039 and 0040 with \i. Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0039_motel.sql
\i supabase/migrations/0040_rest_vitals.sql
\i supabase/migrations/0039_motel.sql
\i supabase/migrations/0040_rest_vitals.sql
reset client_min_messages;

create temp table mo (k text primary key, v text);
insert into mo select 'tok', token from public.register('mo_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into mo select 'tok2', token from public.register('mo_b_' || floor(random() * 1e9)::text, 'pw123456');
create temp view mov as select (select v from mo where k = 'tok') t, (select v from mo where k = 'tok2') t2,
  public._auth_account((select v from mo where k = 'tok')) a, public._auth_account((select v from mo where k = 'tok2')) a2;

-- 1) pure rules
do $$ begin
  assert public._motel_price('night') = 100 and public._motel_price('month') = 2000 and public._motel_price('x') is null, 'prices';
  assert public._motel_len('night') = interval '24 hours' and public._motel_len('month') = interval '30 days', 'lengths';
end $$;

-- 2) renting
do $$ declare x mov; j jsonb; ok boolean := false; begin
  select * into x from mov;
  j := public.motel_state(x.t);
  assert j->'stay' = 'null'::jsonb and (j->'rest'->>'slept_today')::boolean = false, format('empty: %s', j);
  begin perform public.motel_rent(x.t, 'night'); exception when others then ok := sqlerrm = 'insufficient funds'; end;
  assert ok, 'no money';
  perform public._wallet_lock(x.a);
  perform public._pay(x.a, 10000, 'daily', 'smoke');
  ok := false;
  begin perform public.motel_rent(x.t, 'week'); exception when others then ok := sqlerrm = 'unknown plan'; end;
  assert ok, 'unknown plan';
  -- sleeping without a room
  ok := false;
  begin perform public.motel_sleep(x.t); exception when others then ok := sqlerrm = 'no room'; end;
  assert ok, 'no room';
  j := public.motel_rent(x.t, 'night');
  assert (j->>'coins')::int = 9900 and j->'stay'->>'plan' = 'night'
     and abs((j->'stay'->>'until_ms')::bigint - (extract(epoch from now() + interval '24 hours') * 1000)::bigint) < 2000,
     format('night: %s', j);
  -- extending stacks after the current end
  j := public.motel_rent(x.t, 'month');
  assert (j->>'coins')::int = 7900 and j->'stay'->>'plan' = 'month'
     and abs((j->'stay'->>'until_ms')::bigint - (extract(epoch from now() + interval '31 days') * 1000)::bigint) < 2000,
     format('month stacks: %s', j);
  -- 31 days + 30 > 60 days ahead
  ok := false;
  begin perform public.motel_rent(x.t, 'month'); exception when others then ok := sqlerrm = 'too far ahead'; end;
  assert ok, 'cap';
  assert (select coins from public.wallets where account_id = x.a) = 7900, 'the refusal charged nothing';
  assert (select count(*) from public.coin_ledger where account_id = x.a and reason = 'motel') = 2, 'ledger';
  -- an expired stay starts again from now
  update public.motel_stays set until = now() - interval '1 hour' where account_id = x.a;
  assert public.motel_state(x.t)->'stay' = 'null'::jsonb, 'expired stay hidden';
  j := public.motel_rent(x.t, 'night');
  assert abs((j->'stay'->>'until_ms')::bigint - (extract(epoch from now() + interval '24 hours') * 1000)::bigint) < 2000,
     format('from now: %s', j);
end $$;

-- 3) sleeping and the buff
do $$ declare x mov; j jsonb; ok boolean := false; begin
  select * into x from mov;
  assert public._rest_factor(x.a) = 1, 'no buff yet';
  j := public.motel_sleep(x.t);
  assert (j->'rest'->>'slept_today')::boolean
     and abs((j->'rest'->>'buff_until_ms')::bigint - (extract(epoch from now() + interval '24 hours') * 1000)::bigint) < 2000,
     format('slept: %s', j);
  assert public._rest_factor(x.a) = 0.7, 'buff on';
  begin perform public.motel_sleep(x.t); exception when others then ok := sqlerrm = 'already slept'; end;
  assert ok, 'once a day';
  -- yesterday's sleep: may sleep again
  update public.rest_state set slept_day = slept_day - 1 where account_id = x.a;
  perform public.motel_sleep(x.t);
  -- the buff runs out
  update public.rest_state set buff_until = now() - interval '1 second' where account_id = x.a;
  assert public._rest_factor(x.a) = 1, 'buff off';
  assert (public.motel_state(x.t)->'rest'->>'buff_until_ms') is null, 'expired buff hidden';
  -- fainted: no sleep
  update public.rest_state set slept_day = null where account_id = x.a;
  insert into public.vitals(account_id) values (x.a) on conflict do nothing;
  update public.vitals set fainted_until = now() + interval '10 seconds' where account_id = x.a;
  ok := false;
  begin perform public.motel_sleep(x.t); exception when others then ok := sqlerrm = 'fainted'; end;
  assert ok, 'fainted';
  update public.vitals set fainted_until = null where account_id = x.a;
end $$;

-- 4) vitals_tick drains 30 % less with the buff (same 100 s for both players, no room)
do $$ declare x mov; ha numeric; hb numeric; ta numeric; tb numeric; begin
  select * into x from mov;
  update public.rest_state set buff_until = now() + interval '1 hour' where account_id = x.a;
  perform public.vitals_tick(x.t, null); perform public.vitals_tick(x.t2, null);
  update public.vitals set hunger = 80, thirst = 80, starve_s = 0, fainted_until = null,
    last_tick = now() - interval '100 seconds' where account_id in (x.a, x.a2);
  perform public.vitals_tick(x.t, null); perform public.vitals_tick(x.t2, null);
  select 80 - hunger, 80 - thirst into ha, ta from public.vitals where account_id = x.a;
  select 80 - hunger, 80 - thirst into hb, tb from public.vitals where account_id = x.a2;
  assert hb > 0 and tb > 0, 'the other drains';
  assert abs(ha - hb * 0.7) < 1e-6 and abs(ta - tb * 0.7) < 1e-6, format('×0.7: %s %s %s %s', ha, hb, ta, tb);
end $$;

-- 5) grants
do $$ begin
  assert has_function_privilege('anon', 'public.motel_state(text)', 'execute')
     and has_function_privilege('anon', 'public.motel_rent(text, text)', 'execute')
     and has_function_privilege('anon', 'public.motel_sleep(text)', 'execute'), 'rpcs granted';
  assert not has_function_privilege('anon', 'public._rest_factor(uuid)', 'execute')
     and not has_function_privilege('anon', 'public._motel_json(uuid)', 'execute')
     and not has_function_privilege('anon', 'public._motel_price(text)', 'execute'), 'helpers private';
  assert not has_table_privilege('anon', 'public.motel_stays', 'select')
     and not has_table_privilege('anon', 'public.rest_state', 'select'), 'tables private';
end $$;

select 'v19.1 smoke ok';
