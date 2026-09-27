-- tests/sql/v19-4-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0043 (see the plan),
-- from the repo root: it re-runs 0043 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0043_real_estate.sql
\i supabase/migrations/0043_real_estate.sql
reset client_min_messages;
-- a clean street and market (the smoke may run twice on the same cluster)
delete from public.estate_listings;
select public._house_free(no, false) from public.house_lots;
update public.apartments set owner_id = null;
select public._apt_sweep();

create temp table es (k text primary key, v text);
insert into es select 'a', token from public.register('es_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into es select 'b', token from public.register('es_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into es select 'c', token from public.register('es_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into es select 'd', token from public.register('es_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into es select 'e', token from public.register('es_e_' || floor(random() * 1e9)::text, 'pw123456');
create temp view esv as select (select v from es where k = 'a') ta, (select v from es where k = 'b') tb,
  (select v from es where k = 'c') tc, (select v from es where k = 'd') td, (select v from es where k = 'e') te,
  public._auth_account((select v from es where k = 'a')) a, public._auth_account((select v from es where k = 'b')) b,
  public._auth_account((select v from es where k = 'c')) c, public._auth_account((select v from es where k = 'd')) d,
  public._auth_account((select v from es where k = 'e')) e;
insert into public.rooms (code, name) values ('ESSMK' || floor(random() * 1e6)::text, 'smoke') returning id \gset room_
insert into es values ('room', :'room_id');
insert into public.members (room_id, account_id) select :'room_id'::uuid, e from esv;

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;
create or replace function pg_temp.coins(p uuid) returns int language sql as $$ select coins from public.wallets where account_id = p $$;
create or replace function pg_temp.nocool(p uuid) returns void language sql as $$ delete from public.estate_cooldowns where account_id = p $$;

-- 1) rules, privileges, money
do $$ declare x esv; begin
  select * into x from esv;
  assert public._estate_rule('fee') = 5 and public._estate_rule('min') = 50 and public._estate_rule('max') = 300, 'rules';
  assert public._estate_in_band(12500, 25000) and not public._estate_in_band(12499, 25000), 'floor';
  assert public._estate_in_band(75000, 25000) and not public._estate_in_band(75001, 25000), 'ceiling';
  assert public._estate_in_band(20401, 40801) and not public._estate_in_band(20400, 40801), 'floor rounds up';
  assert not has_function_privilege('anon', 'public._estate_sweep()', 'execute'), 'helper not callable';
  assert has_function_privilege('anon', 'public.estate_buy(text, bigint, integer)', 'execute'), 'rpc callable';
  perform public._wallet_lock(x.a); perform public._pay(x.a, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.b); perform public._pay(x.b, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.c); perform public._pay(x.c, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.d); perform public._pay(x.d, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.e); perform public._pay(x.e, 200000, 'daily', 'smoke');
end $$;

-- 2) listing a flat
do $$ declare x esv; j jsonb; v_bed bigint; begin
  select * into x from esv;
  j := public.estate_state(x.ta);
  assert j->'own' = 'null'::jsonb and jsonb_array_length(j->'listings') = 0, format('empty %s', j);
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 30000, false)', x.ta, 'apt'), 'not owned'), 'no flat';
  perform public.apt_rent(x.tb, 2);
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 30000, false)', x.tb, 'apt'), 'not owned'), 'a rented flat';
  perform public.apt_move_out(x.tb);
  perform public.apt_buy(x.ta, 1);
  perform public.furniture_buy(x.ta, 'bed_go'); v_bed := (select max(id) from public.furniture_items where account_id = x.a);
  perform public.furniture_place(x.ta, v_bed, 1, 2, 0);
  j := public.estate_state(x.ta);
  assert j->'own' = jsonb_build_object('kind', 'apt', 'no', 1, 'bare', 25000, 'full', 26200, 'items', 1, 'listed', false), format('own %s', j->'own');
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 30000, false)', x.ta, 'villa'), 'bad kind'), 'kind';
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 12499, false)', x.ta, 'apt'), 'bad price'), 'floor';
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 75001, false)', x.ta, 'apt'), 'bad price'), 'ceiling';
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 30000, false)', x.ta, 'lot'), 'not owned'), 'no lot';
  j := public.estate_list(x.ta, 'apt', 78600, true);                                    -- 3 × 26 200
  assert jsonb_array_length(j->'listings') = 1 and (j->'listings'->0->>'mine')::boolean and (j->'own'->>'listed')::boolean, format('listed %s', j);
  assert (j->'listings'->0->>'items')::int = 1 and (j->'listings'->0->>'appraisal')::int = 26200, 'furniture counted';
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 30000, false)', x.ta, 'apt'), 'already listed'), 'one listing';
  -- others see it
  j := public.estate_state(x.tb);
  assert jsonb_array_length(j->'listings') = 1 and not (j->'listings'->0->>'mine')::boolean, 'public';
  -- cancel: 24 h before listing again
  j := public.estate_cancel(x.ta);
  assert jsonb_array_length(j->'listings') = 0 and (j->>'cooldown_ms')::bigint > public._apt_ms(now() + interval '23 hours'), format('cooldown %s', j);
  assert pg_temp.fails(format('select public.estate_cancel(%L)', x.ta), 'no listing'), 'nothing to cancel';
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 30000, false)', x.ta, 'apt'), 'cooldown'), 'cooldown';
  perform pg_temp.nocool(x.a);
  perform public.estate_list(x.ta, 'apt', 30000, true);
end $$;

-- 3) buying a flat: 95 / 5, the title, the furniture, one home, round trips
do $$ declare x esv; j jsonb; v_id bigint; v_a int; v_b int; begin
  select * into x from esv;
  v_id := (select id from public.estate_listings where seller_id = x.a);
  assert pg_temp.fails(format('select public.estate_buy(%L, %s, 30000)', x.ta, v_id), 'own listing'), 'own';
  assert pg_temp.fails(format('select public.estate_buy(%L, %s, 29000)', x.tb, v_id), 'price changed'), 'price seen';
  assert pg_temp.fails(format('select public.estate_buy(%L, 999999, 30000)', x.tb), 'no listing'), 'gone';
  perform public.apt_rent(x.tc, 3);
  assert pg_temp.fails(format('select public.estate_buy(%L, %s, 30000)', x.tc, v_id), 'already have a home'), 'one home (renter)';
  perform public.apt_move_out(x.tc);
  update public.wallets set coins = 100 where account_id = x.d;
  assert pg_temp.fails(format('select public.estate_buy(%L, %s, 30000)', x.td, v_id), 'insufficient funds'), 'funds';
  update public.wallets set coins = 200000 where account_id = x.d;
  v_a := pg_temp.coins(x.a); v_b := pg_temp.coins(x.b);
  j := public.estate_buy(x.tb, v_id, 30000);
  assert (j->>'coins')::int = v_b - 30000 and pg_temp.coins(x.a) = v_a + 28500, 'seller got 95 %';
  assert (select owner_id from public.apartments where no = 1) = x.b and (select tenure from public.apartments where no = 1) = 'own', 'title';
  assert (select account_id from public.furniture_items where apt_no = 1) = x.b, 'the bed came with it';
  assert (select count(*) from public.coin_ledger where account_id = x.b and reason = 'estate_buy') = 1
     and (select count(*) from public.coin_ledger where account_id = x.a and reason = 'estate_sale') = 1, 'ledger';
  assert jsonb_array_length(j->'listings') = 0 and (j->'sales'->0->>'price')::int = 30000 and (j->'own'->>'no')::int = 1, format('state %s', j);
  assert not (select flagged from public.estate_sales where buyer_id = x.b), 'not flagged';
  -- no instant flip
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 30000, false)', x.tb, 'apt'), 'cooldown'), 'buyer cooldown';
  perform pg_temp.nocool(x.b);
  j := public.estate_list(x.tb, 'apt', 30000, false);
  v_id := (select id from public.estate_listings where seller_id = x.b);
  assert pg_temp.fails(format('select public.estate_buy(%L, %s, 30000)', x.ta, v_id), 'suspicious trade'), 'round trip';
  update public.estate_sales set sold_at = now() - interval '10 days' where buyer_id = x.b;
  j := public.estate_buy(x.ta, v_id, 30000);
  assert (select flagged from public.estate_sales where buyer_id = x.a), 'flagged within 30 days';
  assert (select account_id from public.furniture_items where item_id = 'bed_go' and account_id in (x.a, x.b)) = x.b
     and (select apt_no from public.furniture_items where item_id = 'bed_go' and account_id = x.b) is null, 'the bed went to storage';
  assert (select owner_id from public.apartments where no = 1) = x.a, 'back to a';
end $$;

-- 4) a house with a tenant; the Báo Làng
do $$ declare x esv; j jsonb; v_id bigint; v_until timestamptz; v_paid timestamptz; v_app int;
        g text := (select string_agg(rpad(r, 20, '.'), '' order by n) from unnest(array['', '..wwwww', '..wfffw', '..nfffw', '..wwdww',
                   '', '', '', '', '', '', '', '', '']) with ordinality u(r, n)); begin
  select * into x from esv;
  perform public.lot_buy(x.tc, 3);
  perform public.house_build(x.tc, g, 'ngoi');
  perform public.house_room_price(x.tc, 1, 600);
  perform public.house_room_rent(x.td, 3, 1);
  v_until := (select paid_until from public.house_tenancies where tenant_id = x.d);
  v_paid := (select paid_until from public.house_lots where no = 3);
  v_app := 40000 + (select build_cost from public.house_lots where no = 3) * 80 / 100;
  j := public.estate_state(x.tc);
  assert (j->'own'->>'bare')::int = v_app, format('house appraised %s vs %s', j->'own', v_app);
  assert pg_temp.fails(format('select public.estate_list(%L, %L, %s, false)', x.tc, 'lot', v_app * 3 + 1), 'bad price'), 'lot ceiling';
  j := public.estate_list(x.tc, 'lot', 100000, false);
  assert (j->'listings'->0->>'tenants')::int = 1, 'tenant shown';
  v_id := (select id from public.estate_listings where seller_id = x.c);
  assert pg_temp.fails(format('select public.estate_buy(%L, %s, 100000)', x.td, v_id), 'already have a home'), 'tenant is housed';
  j := public.estate_buy(x.te, v_id, 100000);
  assert (select owner_id from public.house_lots where no = 3) = x.e, 'lot title';
  assert (select paid_until from public.house_lots where no = 3) = v_paid and (select grid from public.house_lots where no = 3) = g, 'house and upkeep kept';
  assert (select paid_until from public.house_tenancies where tenant_id = x.d and lot_no = 3) = v_until, 'tenancy honoured';
  assert exists (select 1 from public.news_events where room_id = (select v::uuid from es where k = 'room') and kind = 'house'
                  and meta->>'price' = '100000'), 'Báo Làng';
  -- later rent goes to the new owner
  v_until := now();
  perform public.house_room_rent(x.td, 3, 1);
  assert (select count(*) from public.coin_ledger where account_id = x.e and reason = 'house_rent_income') = 1, 'rent to e';
  -- arrears: no listing
  perform pg_temp.nocool(x.e);
  update public.house_lots set paid_until = now() - interval '1 day' where no = 3;
  assert pg_temp.fails(format('select public.estate_list(%L, %L, 50000, false)', x.te, 'lot'), 'upkeep due'), 'arrears';
  update public.house_lots set paid_until = now() + interval '20 days' where no = 3;
end $$;

-- 5) the sweep: out of band, stale, expired
do $$ declare x esv; j jsonb; v_tv bigint; begin
  select * into x from esv;
  perform pg_temp.nocool(x.a);
  perform public.furniture_buy(x.ta, 'tv'); v_tv := (select max(id) from public.furniture_items where account_id = x.a);
  perform public.furniture_place(x.ta, v_tv, 5, 2, 0);
  perform public.estate_list(x.ta, 'apt', 84000, true);                                   -- 3 × 28 000
  perform public.furniture_pickup(x.ta, v_tv);                                            -- now 25 000: out of band
  j := public.estate_state(x.tb);
  assert not exists (select 1 from public.estate_listings where seller_id = x.a), 'out of band dropped';
  perform public.estate_list(x.ta, 'apt', 25000, false);
  update public.estate_listings set expires_at = now() - interval '1 hour' where seller_id = x.a;
  j := public.estate_state(x.tb);
  assert not exists (select 1 from public.estate_listings where seller_id = x.a), 'expired';
  assert (select until from public.estate_cooldowns where account_id = x.a) > now() + interval '22 hours', 'expiry cooldown';
  perform pg_temp.nocool(x.a);
  perform public.estate_list(x.ta, 'apt', 25000, false);
  perform public.apt_move_out(x.ta);                                                     -- sold back to the city
  j := public.estate_state(x.tb);
  assert not exists (select 1 from public.estate_listings where seller_id = x.a), 'stale dropped';
end $$;

-- 6) the wipe; the admin
do $$ declare x esv; j jsonb; begin
  select * into x from esv;
  perform pg_temp.nocool(x.e);
  perform public.estate_list(x.te, 'lot', 60000, false);
  perform public._ac_wipe(x.e, null);
  assert not exists (select 1 from public.estate_listings where seller_id = x.e), 'wipe cancels the listing';
  assert exists (select 1 from public.estate_sales where buyer_id = x.e), 'history kept';
  assert pg_temp.fails(format('select public.admin_estate_flags(%L)', x.tb), 'root role required'), 'root only';
  update public.accounts set is_root = true where id = x.b;
  j := public.admin_estate_flags(x.tb);
  assert jsonb_array_length(j->'sales') >= 1 and exists (select 1 from jsonb_array_elements(j->'sales') s where s->>'buyer_name' = (select username from public.accounts where id = x.a)), format('flags %s', j);
  update public.accounts set is_root = false where id = x.b;
end $$;

select 'v19.4 smoke ok';
