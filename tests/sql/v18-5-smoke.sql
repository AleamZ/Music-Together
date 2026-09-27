-- tests/sql/v18-5-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0026 (see the plan),
-- from the repo root: it re-runs 0027 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0027_vehicles.sql
reset client_min_messages;

create temp table vh_acct (acct_id uuid, tok text);
insert into vh_acct (acct_id, tok)
  select public._auth_account(token), token from public.register('veh_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare a uuid := (select acct_id from vh_acct); begin
  perform public._wallet_lock(a);
  perform public._pay(a, 200000, 'daily', 'seed');
end $$;

-- 1) nothing owned yet
do $$ declare t text := (select tok from vh_acct); begin
  assert public.vehicles_state(t)->'owned' = '[]'::jsonb, 'owned empty';
end $$;
-- 2) buy a bike: owned, -5000
do $$ declare a uuid := (select acct_id from vh_acct); t text := (select tok from vh_acct); c0 int; j jsonb; begin
  select coins into c0 from public.wallets where account_id = a;
  j := public.buy_vehicle(t, 'bike');
  assert j->'owned' = '["bike"]'::jsonb, 'owned bike';
  assert (j->>'coins')::int = c0 - 5000, 'bike cost 5000';
  assert (j->>'coins')::int = (select coins from public.wallets where account_id = a), 'coins is the new balance';
  assert public.vehicles_state(t)->'owned' = '["bike"]'::jsonb, 'state shows bike';
end $$;
-- 3) the bike again
do $$ declare t text := (select tok from vh_acct); ok boolean := false; begin
  begin perform public.buy_vehicle(t, 'bike'); exception when others then ok := sqlerrm = 'already owned'; end;
  assert ok, 'already owned';
end $$;
-- 4) an unknown vehicle
do $$ declare t text := (select tok from vh_acct); ok boolean := false; begin
  begin perform public.buy_vehicle(t, 'plane'); exception when others then ok := sqlerrm = 'unknown vehicle'; end;
  assert ok, 'unknown vehicle';
end $$;
-- 5) skip: -20
do $$ declare a uuid := (select acct_id from vh_acct); t text := (select tok from vh_acct); c0 int; j jsonb; begin
  select coins into c0 from public.wallets where account_id = a;
  j := public.skip_trip(t);
  assert (j->>'coins')::int = c0 - 20, 'skip cost 20';
end $$;
-- 6) drained to 10: skip and car both refused
do $$ declare a uuid := (select acct_id from vh_acct); t text := (select tok from vh_acct); c int; ok boolean := false; begin
  select coins into c from public.wallets where account_id = a;
  perform public._pay(a, 10 - c, 'buy', 'drain');
  begin perform public.skip_trip(t); exception when others then ok := sqlerrm = 'insufficient funds'; end;
  assert ok, 'skip insufficient funds';
  ok := false;
  begin perform public.buy_vehicle(t, 'car'); exception when others then ok := sqlerrm = 'insufficient funds'; end;
  assert ok, 'car insufficient funds';
  assert (select coins from public.wallets where account_id = a) = 10, 'nothing charged';
end $$;
-- 7) grants
do $$ begin
  assert has_function_privilege('anon', 'public.vehicles_state(text)', 'execute'), 'vehicles_state granted';
  assert has_function_privilege('anon', 'public.buy_vehicle(text,text)', 'execute'), 'buy_vehicle granted';
  assert has_function_privilege('anon', 'public.skip_trip(text)', 'execute'), 'skip_trip granted';
  assert not has_function_privilege('anon', 'public._owned_vehicles(uuid)', 'execute'), '_owned_vehicles private';
end $$;
\echo v18.5 smoke ok
