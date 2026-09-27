-- tests/sql/v18-5-depots-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0027 (see the
-- plan), from the repo root: it re-runs 0028 with \i. Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0028_market_depots.sql
reset client_min_messages;

create temp table dp_acct (acct_id uuid, tok text);
insert into dp_acct (acct_id, tok)
  select public._auth_account(token), token from public.register('dep_' || floor(random() * 1e9)::text, 'pw123456');
do $$ declare a uuid := (select acct_id from dp_acct); begin
  perform public._wallet_lock(a);
  perform public._pay(a, 100, 'daily', 'seed');
end $$;

-- 1) one fish at the market pays floor(price * 1.2); the old sell_fish still pays the price
do $$ declare a uuid := (select acct_id from dp_acct); t text := (select tok from dp_acct); f1 uuid; f2 uuid; c0 int; j jsonb;
  sp text := (select id from public.fish_species order by sort_order limit 1); begin
  insert into public.fish (account_id, species_id, weight_g, price) values (a, sp, 500, 37) returning id into f1;
  insert into public.fish (account_id, species_id, weight_g, price) values (a, sp, 500, 37) returning id into f2;
  select coins into c0 from public.wallets where account_id = a;
  j := public.sell_fish_market(t, array[f1]);
  assert (j->>'sold')::int = 1 and (j->>'earned')::int = 44, 'market fish earned 44: ' || j::text;
  assert (select coins from public.wallets where account_id = a) = c0 + 44, 'market fish paid floor(37*1.2)';
  assert not exists (select 1 from public.fish where id = f1), 'market fish sold';
  j := public.sell_fish(t, array[f2]);
  assert (j->>'earned')::int = 37, 'old sell_fish unchanged';
  assert (select coins from public.wallets where account_id = a) = c0 + 44 + 37, 'old sell_fish paid 37';
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'sell') = 2, 'both under reason sell';
end $$;
-- 2) an unknown fish at the market is refused, nothing paid
do $$ declare a uuid := (select acct_id from dp_acct); t text := (select tok from dp_acct); ok boolean := false; c0 int; begin
  select coins into c0 from public.wallets where account_id = a;
  begin perform public.sell_fish_market(t, array[gen_random_uuid()]); exception when others then ok := sqlerrm = 'fish not found'; end;
  assert ok, 'fish not found';
  assert (select coins from public.wallets where account_id = a) = c0, 'nothing paid';
end $$;
-- 3) rice: wet and dry at the market pay floor(old * 1.2); the old sell_rice is unchanged
do $$ declare a uuid := (select acct_id from dp_acct); t text := (select tok from dp_acct); c0 int; c1 int; v public.rice_varieties;
  old_wet int; old_dry int; begin
  select * into v from public.rice_varieties order by sort_order limit 1;
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (a, v.id, 6, 6);
  old_wet := (3 * v.price_per_kg * 7) / 10; old_dry := 3 * v.price_per_kg;
  select coins into c0 from public.wallets where account_id = a;
  perform public.sell_rice_market(t, v.id, false, 3);
  select coins into c1 from public.wallets where account_id = a;
  assert c1 - c0 = (old_wet * 120) / 100, 'market wet rice +20%';
  perform public.sell_rice_market(t, v.id, true, 3);
  assert (select coins from public.wallets where account_id = a) - c1 = (old_dry * 120) / 100, 'market dry rice +20%';
  select coins into c0 from public.wallets where account_id = a;
  perform public.sell_rice(t, v.id, true, 3);
  assert (select coins from public.wallets where account_id = a) - c0 = old_dry, 'old sell_rice unchanged';
  assert (select wet_kg from public.rice_stock where account_id = a and variety = v.id) = 3, 'wet stock taken';
  assert (select dry_kg from public.rice_stock where account_id = a and variety = v.id) = 0, 'dry stock taken';
end $$;
-- 4) produce: the market pays floor(kg * price * 1.2); the old sell_produce is unchanged
do $$ declare a uuid := (select acct_id from dp_acct); t text := (select tok from dp_acct); c0 int; c1 int; u public.upland_crops; begin
  select * into u from public.upland_crops order by sort_order limit 1;
  insert into public.produce_stock (account_id, upland, kg) values (a, u.id, 14);
  select coins into c0 from public.wallets where account_id = a;
  perform public.sell_produce_market(t, u.id, 7);
  select coins into c1 from public.wallets where account_id = a;
  assert c1 - c0 = (7 * u.price_per_kg * 120) / 100, 'market produce +20%';
  perform public.sell_produce(t, u.id, 7);
  assert (select coins from public.wallets where account_id = a) - c1 = 7 * u.price_per_kg, 'old sell_produce unchanged';
  assert (select kg from public.produce_stock where account_id = a and upland = u.id) = 0, 'produce stock taken';
end $$;
-- 5) not enough: refused
do $$ declare t text := (select tok from dp_acct); ok boolean := false; u text := (select id from public.upland_crops order by sort_order limit 1); begin
  begin perform public.sell_produce_market(t, u, 1); exception when others then ok := sqlerrm = 'not enough crop'; end;
  assert ok, 'not enough crop';
end $$;
-- 6) sell_vehicle: half the price back, the row gone; not owned / unknown refused with nothing paid
do $$ declare a uuid := (select acct_id from dp_acct); t text := (select tok from dp_acct); c0 int; j jsonb; ok boolean; begin
  perform public._pay(a, 200000, 'daily', 'seed');
  perform public.buy_vehicle(t, 'moto');
  perform public.buy_vehicle(t, 'bike');
  select coins into c0 from public.wallets where account_id = a;
  j := public.sell_vehicle(t, 'moto');
  assert j->'owned' = '["bike"]'::jsonb, 'moto gone: ' || j::text;
  assert (j->>'coins')::int = c0 + 15000, 'moto back at 15000';
  assert (select coins from public.wallets where account_id = a) = c0 + 15000, 'wallet +15000';
  assert (select count(*) from public.coin_ledger where account_id = a and reason = 'sell' and ref = 'vehicle: moto') = 1, 'ledger row';
  j := public.sell_vehicle(t, 'bike');
  assert j->'owned' = '[]'::jsonb and (j->>'coins')::int = c0 + 17500, 'bike back at 2500';
  ok := false;
  begin perform public.sell_vehicle(t, 'bike'); exception when others then ok := sqlerrm = 'not owned'; end;
  assert ok, 'not owned';
  ok := false;
  begin perform public.sell_vehicle(t, 'plane'); exception when others then ok := sqlerrm = 'unknown vehicle'; end;
  assert ok, 'unknown vehicle';
  assert (select coins from public.wallets where account_id = a) = c0 + 17500, 'refusals pay nothing';
  -- bought again after the sale
  j := public.buy_vehicle(t, 'bike');
  assert j->'owned' = '["bike"]'::jsonb, 'rebuy bike';
end $$;
-- 7) the RPCs are callable by anon; the helper is not
do $$ begin
  assert has_function_privilege('anon', 'public.sell_vehicle(text, text)', 'execute'), 'anon sell_vehicle';
  assert has_function_privilege('anon', 'public.sell_fish_market(text, uuid[])', 'execute'), 'anon sell_fish_market';
  assert has_function_privilege('anon', 'public.sell_rice_market(text, text, boolean, integer)', 'execute'), 'anon sell_rice_market';
  assert has_function_privilege('anon', 'public.sell_produce_market(text, text, integer)', 'execute'), 'anon sell_produce_market';
  assert not has_function_privilege('anon', 'public._market_depot_pay(integer)', 'execute'), 'helper private';
end $$;

select 'v18.5 depots smoke ok';
