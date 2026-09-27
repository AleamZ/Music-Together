-- tests/sql/v18-4-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0025 (see the plan),
-- from the repo root: it re-runs 0026 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0026_market.sql
reset client_min_messages;

create temp table mk_acct (acct_id uuid, tok text, fish_id uuid);
insert into mk_acct (acct_id, tok)
  select public._auth_account(token), token from public.register('mkt_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare a uuid := (select acct_id from mk_acct); begin
  perform public._wallet_lock(a);
  perform public._pay(a, 5000, 'daily', 'seed');
end $$;
with f as (
  insert into public.fish (account_id, species_id, weight_g, price)
  values ((select acct_id from mk_acct), (select id from public.fish_species where rarity = 2 limit 1), 500, 10)
  returning id)
update mk_acct set fish_id = (select id from f);

-- 1) a drink: full price, thirst +25
do $$ declare a uuid := (select acct_id from mk_acct); t text := (select tok from mk_acct); j jsonb; begin
  perform public._vitals_apply(a);
  update public.vitals set thirst = 50, hunger = 80, starve_s = 0, fainted_until = null, last_tick = now() where account_id = a;
  j := public.eat_meal(t, 'tra_da');
  assert (j->>'paid')::int = 50, 'tra_da paid 50';
  assert (j->>'discount_pct')::int = 0, 'no discount';
  assert abs((j->'vitals'->>'thirst')::numeric - 75) < 0.01, 'thirst +25';
  assert (j->>'coins')::int = (select coins from public.wallets where account_id = a), 'coins is the new balance';
end $$;
-- 2) a fish dish with the fish: 34% off, the fish is consumed
do $$ declare a uuid := (select acct_id from mk_acct); t text := (select tok from mk_acct); fid uuid := (select fish_id from mk_acct); j jsonb; begin
  j := public.eat_meal(t, 'ca_kho_to', fid);
  assert (j->>'paid')::int = 396, 'ca_kho_to paid 396';
  assert (j->>'discount_pct')::int = 34, 'discount 34';
  assert not exists (select 1 from public.fish where id = fid), 'fish consumed';
end $$;
-- 3) a fish with a non-fish dish
do $$ declare a uuid := (select acct_id from mk_acct); t text := (select tok from mk_acct); fid uuid; ok boolean := false; begin
  insert into public.fish (account_id, species_id, weight_g, price)
    values (a, (select id from public.fish_species limit 1), 300, 10) returning id into fid;
  begin perform public.eat_meal(t, 'pho_bo', fid); exception when others then ok := sqlerrm = 'not a fish dish'; end;
  assert ok, 'not a fish dish';
end $$;
-- 4) an unknown fish
do $$ declare t text := (select tok from mk_acct); ok boolean := false; begin
  begin perform public.eat_meal(t, 'ca_chien', gen_random_uuid()); exception when others then ok := sqlerrm = 'fish not found'; end;
  assert ok, 'fish not found';
end $$;
-- 5) an unknown meal
do $$ declare t text := (select tok from mk_acct); ok boolean := false; begin
  begin perform public.eat_meal(t, 'nope'); exception when others then ok := sqlerrm = 'unknown meal'; end;
  assert ok, 'unknown meal';
end $$;
-- 6) no coins
do $$ declare a uuid := (select acct_id from mk_acct); t text := (select tok from mk_acct); c int; ok boolean := false; begin
  select coins into c from public.wallets where account_id = a;
  perform public._pay(a, -c, 'buy', 'drain');
  begin perform public.eat_meal(t, 'banh_mi'); exception when others then ok := sqlerrm = 'insufficient funds'; end;
  assert ok, 'insufficient funds';
end $$;
-- 7) grants
do $$ begin
  assert has_function_privilege('anon', 'public.eat_meal(text,text,uuid)', 'execute'), 'eat_meal granted';
  assert not has_function_privilege('anon', 'public._fish_discount_pct(int,int)', 'execute'), 'discount private';
end $$;
\echo v18.4 smoke ok
