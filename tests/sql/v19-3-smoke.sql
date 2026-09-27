-- tests/sql/v19-3-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0042 (see the plan),
-- from the repo root: it re-runs 0042 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0042_houses.sql
\i supabase/migrations/0042_houses.sql
reset client_min_messages;
-- a clean street (the smoke may run twice on the same cluster)
select public._house_free(no, false) from public.house_lots;
update public.apartments set owner_id = null;
select public._apt_sweep();

create temp table hs (k text primary key, v text);
insert into hs select 'a', token from public.register('hs_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into hs select 'b', token from public.register('hs_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into hs select 'c', token from public.register('hs_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into hs select 'd', token from public.register('hs_d_' || floor(random() * 1e9)::text, 'pw123456');
create temp view hsv as select (select v from hs where k = 'a') t, (select v from hs where k = 'b') t2,
  (select v from hs where k = 'c') t3, (select v from hs where k = 'd') t4,
  public._auth_account((select v from hs where k = 'a')) a, public._auth_account((select v from hs where k = 'b')) a2,
  public._auth_account((select v from hs where k = 'c')) a3, public._auth_account((select v from hs where k = 'd')) a4;
insert into public.rooms (code, name) values ('HSSMK' || floor(random() * 1e6)::text, 'smoke') returning id \gset room_
insert into hs values ('room', :'room_id');

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;

-- a design from its rows (short and missing rows are yard)
create or replace function pg_temp.design(variadic p_rows text[]) returns text language sql as $$
  select string_agg(rpad(coalesce(p_rows[r], ''), 20, '.'), '' order by r) from generate_series(1, 14) r
$$;
create temp table designs (k text primary key, g text);
insert into designs values
  ('two', pg_temp.design('', '..wwwwwwwww', '..wfffwfffw', '..nfffdfffn', '..wfffwfffw', '..wfffwfffw', '..wwdwwwwww')),
  ('one', pg_temp.design('', '..wwwww', '..wfffw', '..nfffw', '..wwdww')),
  ('open', pg_temp.design('', '..wwwww', '..wfffw', '..wfff.', '..wwdww')),
  ('baddoor', pg_temp.design('', '..wwwww', '..wfffw', '..wfffw', '..wwwww', '...d')),
  ('badwin', pg_temp.design('', '..wwwwwww', '..wfffnfw', '..wfffffw', '..wwdwwww')),
  ('seven', pg_temp.design('', 'wwwwwwwwwwwwwww', 'wfwfwfwfwfwfwfw', 'wfwfwfwfwfwfwfw', 'wfwfwfwfwfwfwfw', 'wfwfwfwfwfwfwfw', 'wdwdwdwdwdwdwdw')),
  ('small', pg_temp.design('', '..wwww', '..wffw', '..wwdw')),
  ('nodoor', pg_temp.design('', '..wwwww', '..wfffw', '..wfffw', '..wwwww')),
  ('unreach', pg_temp.design('', '..wwwwwwwww', '..wfffwfffw', '..wfffwfffw', '..wwdwwwwww')),
  -- lib/game/housing/house.ts's HOUSE_TEMPLATES
  ('t_nho', pg_temp.design('', '', '......wwwwwww', '......wfffffw', '......nfffffn', '......wfffffw', '......wwwdwww')),
  ('t_hai', pg_temp.design('', '..wwwwwwwwwwwww', '..wffffwffffffw', '..nffffdffffffn', '..wffffwffffffw', '..wffffwffffffw', '..wwwwwwwwdwwww')),
  ('t_tro', pg_temp.design('', '..wwwwwwwwwwwwwww', '..wffffwfffwffffw', '..nffffwfffwffffn', '..wffffdfffdffffw', '..wffffwfffwffffw', '..wwwwwwfffwwwwww',
                           '..wffffwfffwffffw', '..nffffdfffdffffn', '..wffffwfffwffffw', '..wffffwfffwffffw', '..wwwwwwwdwwwwwww'));

-- 1) rules and the design checks (the same cases as tests/unit/house.test.ts)
do $$ declare g text; begin
  assert public._house_price('land') = 40000 and public._house_price('upkeep') = 500 and public._house_price('refund') = 20000, 'prices';
  assert (select count(*) from public.house_lots) = 8, 'eight lots';
  assert not has_function_privilege('anon', 'public._house_sweep()', 'execute'), 'helper not callable';
  assert has_function_privilege('anon', 'public.house_list(text)', 'execute'), 'rpc callable';
  select d.g into g from designs d where k = 'two';
  assert public._house_check(g) is not null and public._house_room_count(public._house_check(g)) = 2, 'two rooms';
  assert (public._house_check(g))[2 * 20 + 3 + 1] = 1 and (public._house_check(g))[2 * 20 + 7 + 1] = 2, 'room numbers';
  assert public._house_cost(null, g) = 26 * 20 + 24 * 10 + 2 * 150 + 2 * 100, format('cost %s', public._house_cost(null, g));
  assert public._house_cost(g, g) = 0 and public._house_cost(g, repeat('.', 280)) = 0, 'no cost';
  assert public._house_check(repeat('.', 280)) is null, 'bare land';
  assert pg_temp.fails(format('select public._house_check(%L)', repeat('x', 280)), 'bad grid'), 'bad grid';
  assert pg_temp.fails(format('select public._house_check(%L)', (select d.g from designs d where k = 'open')), 'open floor'), 'open floor';
  assert pg_temp.fails(format('select public._house_check(%L)', (select d.g from designs d where k = 'baddoor')), 'bad door'), 'bad door';
  assert pg_temp.fails(format('select public._house_check(%L)', (select d.g from designs d where k = 'badwin')), 'bad window'), 'bad window';
  assert pg_temp.fails(format('select public._house_check(%L)', pg_temp.design('', '..www')), 'no room'), 'no room';
  assert pg_temp.fails(format('select public._house_check(%L)', (select d.g from designs d where k = 'seven')), 'too many rooms'), 'seven';
  assert pg_temp.fails(format('select public._house_check(%L)', (select d.g from designs d where k = 'small')), 'small room'), 'small';
  assert pg_temp.fails(format('select public._house_check(%L)', (select d.g from designs d where k = 'nodoor')), 'no front door'), 'no door';
  assert pg_temp.fails(format('select public._house_check(%L)', (select d.g from designs d where k = 'unreach')), 'unreachable'), 'unreach';
  assert public._house_room_count(public._house_check((select d.g from designs d where k = 't_nho'))) = 1, 'template nho';
  assert public._house_room_count(public._house_check((select d.g from designs d where k = 't_hai'))) = 2, 'template hai';
  assert public._house_room_count(public._house_check((select d.g from designs d where k = 't_tro'))) = 5, 'template tro';
  -- where items fit
  assert public._house_fit(g, public._house_check(g), 8, 2, 1, 1) = 2, 'fits room 2';
  assert public._house_fit(g, public._house_check(g), 2, 2, 1, 1) = -2, 'wall';
  assert public._house_fit(g, public._house_check(g), 5, 3, 1, 1) = -4, 'door front';
  assert public._house_fit(g, public._house_check(g), 19, 2, 2, 1) = -1, 'bounds';
end $$;

-- 2) land: buy, one home, upkeep
do $$ declare x hsv; j jsonb; begin
  select * into x from hsv;
  j := public.house_list(x.t);
  assert jsonb_array_length(j->'lots') = 8 and j->'mine' = 'null'::jsonb and j->'tenancy' = 'null'::jsonb, format('empty %s', j);
  assert pg_temp.fails(format('select public.lot_buy(%L, 1)', x.t), 'insufficient funds'), 'no money';
  perform public._wallet_lock(x.a);  perform public._pay(x.a, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.a2); perform public._pay(x.a2, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.a3); perform public._pay(x.a3, 200000, 'daily', 'smoke');
  perform public._wallet_lock(x.a4); perform public._pay(x.a4, 200000, 'daily', 'smoke');
  j := public.lot_buy(x.t, 1);
  assert (j->>'coins')::int = 160000 and (j->'mine'->>'no')::int = 1 and (j->'lots'->0->>'mine')::boolean, format('bought %s', j);
  assert (select paid_until between now() + interval '29 days' and now() + interval '31 days' from public.house_lots where no = 1), '30 days';
  assert pg_temp.fails(format('select public.lot_buy(%L, 2)', x.t), 'already have a home'), 'one lot';
  assert pg_temp.fails(format('select public.lot_buy(%L, 1)', x.t2), 'taken'), 'taken';
  assert pg_temp.fails(format('select public.apt_rent(%L, 6)', x.t), 'already have a home'), 'no flat with a lot';
  assert pg_temp.fails(format('select public.apt_buy(%L, 6)', x.t), 'already have a home'), 'no flat bought with a lot';
  perform public.apt_rent(x.t2, 5);
  assert pg_temp.fails(format('select public.lot_buy(%L, 2)', x.t2), 'already have a home'), 'no lot with a flat';
  j := public.lot_upkeep(x.t);
  assert (j->>'coins')::int = 159500, 'upkeep paid';
  assert pg_temp.fails(format('select public.lot_upkeep(%L)', x.t), 'too far ahead'), 'upkeep cap';
  assert pg_temp.fails(format('select public.lot_upkeep(%L)', x.t3), 'no lot'), 'no lot';
  assert (select count(*) from public.coin_ledger where account_id = x.a and reason in ('house_land', 'house_upkeep')) = 2, 'ledger';
end $$;

-- 3) the builder
do $$ declare x hsv; j jsonb; g text := (select d.g from designs d where k = 'two'); begin
  select * into x from hsv;
  assert pg_temp.fails(format('select public.house_build(%L, %L, %L)', x.t, (select d.g from designs d where k = 'open'), 'ngoi'), 'open floor'), 'checked';
  assert pg_temp.fails(format('select public.house_build(%L, %L, %L)', x.t, g, 'gold'), 'bad roof'), 'roof';
  assert pg_temp.fails(format('select public.house_build(%L, %L, %L)', x.t2, g, 'ngoi'), 'no lot'), 'not mine';
  j := public.house_build(x.t, g, 'tole');
  assert (j->>'coins')::int = 159500 - 1260 and (j->'mine'->>'build_cost')::int = 1260, format('built %s', j);
  assert j->'lots'->0->>'grid' = g and j->'lots'->0->>'roof' = 'tole' and jsonb_array_length(j->'lots'->0->'rooms') = 2, 'on the street';
  j := public.house_build(x.t, g, 'la');                                         -- the roof alone is free
  assert j->'coins' is null and j->'lots'->0->>'roof' = 'la', 'roof only';
  assert (select count(*) from public.coin_ledger where account_id = x.a and reason = 'house_build') = 1, 'one build row';
end $$;

-- 4) furniture in the house, renting a room
do $$ declare x hsv; j jsonb; v_bed bigint; v_chair bigint; v_cbed bigint; v_cchair bigint; v_fr bigint;
        v_room uuid := (select v::uuid from hs where k = 'room'); begin
  select * into x from hsv;
  perform public.furniture_buy(x.t, 'bed_go');   v_bed := (select max(id) from public.furniture_items where account_id = x.a);
  perform public.furniture_buy(x.t, 'chair_go'); v_chair := (select max(id) from public.furniture_items where account_id = x.a);
  j := public.house_place(x.t, 1, v_bed, 3, 2, 0);
  assert jsonb_array_length(j->'items') = 1 and (j->'items'->0->>'mine')::boolean, format('bed placed %s', j);
  assert pg_temp.fails(format('select public.house_place(%L, 1, %s, 5, 3, 0)', x.t, v_chair), 'door'), 'door front';
  assert pg_temp.fails(format('select public.house_place(%L, 1, %s, 6, 2, 0)', x.t, v_chair), 'not floor'), 'wall';
  assert pg_temp.fails(format('select public.house_place(%L, 1, %s, 4, 3, 0)', x.t, v_chair), 'overlap'), 'overlap';
  assert pg_temp.fails(format('select public.house_place(%L, 1, %s, 19, 13, 1)', x.t, v_chair), 'not floor'), 'yard';
  j := public.house_place(x.t, 1, v_chair, 8, 2, 0);
  assert pg_temp.fails(format('select public.house_place(%L, 1, %s, 8, 2, 0)', x.t2, v_chair), 'no access'), 'stranger';
  assert public.apt_list(x.t) -> 'storage' = '[]'::jsonb, 'placed items are not in storage';
  -- listing and renting room 2
  assert pg_temp.fails(format('select public.house_room_price(%L, 2, 100)', x.t), 'bad price'), 'price floor';
  assert pg_temp.fails(format('select public.house_room_price(%L, 9, 1000)', x.t), 'unknown room'), 'room no';
  j := public.house_room_price(x.t, 2, 1000);
  assert (j->'mine'->'rooms'->1->>'price')::int = 1000, 'listed';
  assert pg_temp.fails(format('select public.house_room_rent(%L, 1, 1)', x.t3), 'not for rent'), 'unlisted room';
  assert pg_temp.fails(format('select public.house_room_rent(%L, 1, 2)', x.t), 'own house'), 'own house';
  assert pg_temp.fails(format('select public.house_room_rent(%L, 1, 2)', x.t2), 'already have a home'), 'flat renter';
  j := public.house_room_rent(x.t3, 1, 2);
  assert (j->>'coins')::int = 199000 and (j->'tenancy'->>'room')::int = 2 and (j->'tenancy'->>'lot')::int = 1, format('rented %s', j);
  assert (select coins from public.wallets where account_id = x.a) = 159500 - 1260 - 1350 + 950, 'owner got 95 %';
  assert (select delta from public.coin_ledger where account_id = x.a and reason = 'house_rent_income') = 950, 'income row';
  assert (select delta from public.coin_ledger where account_id = x.a3 and reason = 'house_rent_pay') = -1000, 'pay row';
  assert pg_temp.fails(format('select public.house_room_rent(%L, 1, 2)', x.t4), 'taken'), 'one tenant per room';
  j := public.house_room_rent(x.t3, 1, 2);                                        -- 60 days
  assert pg_temp.fails(format('select public.house_room_rent(%L, 1, 2)', x.t3), 'too far ahead'), 'rent cap';
  assert pg_temp.fails(format('select public.lot_buy(%L, 3)', x.t3), 'already have a home'), 'tenant has a home';
  assert pg_temp.fails(format('select public.apt_rent(%L, 7)', x.t3), 'already have a home'), 'tenant: no flat';
  j := public.house_list(x.t);
  assert j->'mine'->'rooms'->1->>'tenant_name' is not null and (j->'lots'->0->'rooms'->1->>'taken')::boolean, 'owner sees the tenant';
  -- decorating: the tenant their room only; the owner's chair in the rented room stays
  perform public.furniture_buy(x.t3, 'chair_go'); v_cchair := (select max(id) from public.furniture_items where account_id = x.a3);
  perform public.furniture_buy(x.t3, 'bed_go');   v_cbed := (select max(id) from public.furniture_items where account_id = x.a3);
  assert pg_temp.fails(format('select public.house_place(%L, 1, %s, 3, 5, 0)', x.t3, v_cchair), 'not your room'), 'tenant: room 1';
  j := public.house_place(x.t3, 1, v_cchair, 7, 5, 0);
  assert pg_temp.fails(format('select public.house_pickup(%L, 1, %s)', x.t, v_chair), 'not your room'), 'owner: rented room';
  assert pg_temp.fails(format('select public.house_place(%L, 1, %s, 3, 5, 0)', x.t, v_chair), 'not your room'), 'owner: move out of rented room';
  assert pg_temp.fails(format('select public.house_pickup(%L, 1, %s)', x.t3, v_chair), 'not owned'), 'tenant: owner''s chair';
  -- the design and the lot stay while a room is rented; the roof may change
  assert pg_temp.fails(format('select public.house_build(%L, %L, %L)', x.t, (select d.g from designs d where k = 'one'), 'la'), 'has tenants'), 'no rebuild';
  perform public.house_build(x.t, (select d.g from designs d where k = 'two'), 'bang');
  assert pg_temp.fails(format('select public.lot_sell(%L)', x.t), 'has tenants'), 'no selling';
  -- entering
  assert pg_temp.fails(format('select public.house_enter(%L, %L, 1)', x.t4, v_room), 'no access'), 'private';
  j := public.house_enter(x.t3, v_room, 1);
  assert (j->>'my_room')::int = 2 and not (j->>'can_edit')::boolean and jsonb_array_length(j->'items') = 3, format('tenant in %s', j);
  j := public.house_enter(x.t, v_room, 1);
  assert (j->>'can_edit')::boolean and j->'my_room' = 'null'::jsonb, 'owner in';
  perform public.house_set_visibility(x.t, 'open');
  j := public.house_enter(x.t4, v_room, 1);
  assert j->>'lot' = '1', 'open house';
  assert pg_temp.fails(format('select public.house_enter(%L, %L, 2)', x.t4, v_room), 'vacant'), 'empty lot';
  -- sleeping: the tenant needs a bed in their room; the owner one outside the rented rooms
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 1)', x.t3, 'house'), 'no bed'), 'tenant: no bed';
  perform public.house_place(x.t3, 1, v_cbed, 8, 3, 0);
  j := public.home_sleep(x.t3, 'house', 1);
  assert (j->'rest'->>'slept_today')::boolean, 'tenant slept';
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 1)', x.t3, 'house'), 'already slept'), 'once a day';
  j := public.home_sleep(x.t, 'house', 1);
  assert (j->'rest'->>'slept_today')::boolean, 'owner slept';
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 1)', x.t4, 'house'), 'no home'), 'visitor';
  -- the fridge in a house
  perform public.furniture_buy(x.t, 'fridge'); v_fr := (select max(id) from public.furniture_items where account_id = x.a);
  perform public.house_place(x.t, 1, v_fr, 5, 4, 0);
  insert into public.fish (id, account_id, species_id, weight_g, price, caught_at)
  values (gen_random_uuid(), x.a, (select id from public.fish_species limit 1), 500, 30, now());
  j := public.fish_move_to_fridge(x.t, (select id from public.fish where account_id = x.a limit 1));
  assert (j->>'cap')::int = 20 and jsonb_array_length(j->'fish') = 1, format('fridge %s', j);
  j := public.fish_move_to_bag(x.t, (j->'fish'->0->>'id')::uuid);
  assert jsonb_array_length(j->'fish') = 0, 'back to the bag';
  -- surfaces
  perform public.furniture_buy(x.t, 'floor_go');
  j := public.house_set_surface(x.t, 'floor', 'floor_go');
  assert j->>'floor' = 'floor_go', 'surface';
  assert pg_temp.fails(format('select public.house_set_surface(%L, %L, %L)', x.t, 'wall', 'wall_go'), 'not owned'), 'surface owned';
end $$;

-- 5) lapses: a tenancy ends; arrears; repossession
do $$ declare x hsv; j jsonb; v_before int; begin
  select * into x from hsv;
  update public.house_tenancies set paid_until = now() - interval '1 second' where tenant_id = x.a3;
  j := public.house_list(x.t3);
  assert j->'tenancy' = 'null'::jsonb, 'tenancy ended';
  assert jsonb_array_length((public.apt_list(x.t3))->'storage') = 2, 'the tenant''s items are stored';
  assert not exists (select 1 from public.furniture_items where account_id = x.a3 and lot_no is not null), 'none left in the house';
  -- arrears
  update public.house_lots set paid_until = now() - interval '1 day' where no = 1;
  assert pg_temp.fails(format('select public.house_room_price(%L, 1, 800)', x.t), 'upkeep due'), 'no listing in arrears';
  assert pg_temp.fails(format('select public.house_build(%L, %L, %L)', x.t, (select d.g from designs d where k = 'one'), 'la'), 'upkeep due'), 'no build';
  assert pg_temp.fails(format('select public.house_room_rent(%L, 1, 2)', x.t4), 'upkeep due'), 'no renting in arrears';
  -- repossession after 60 days
  v_before := (select coins from public.wallets where account_id = x.a);
  update public.house_lots set paid_until = now() - interval '61 days' where no = 1;
  j := public.house_list(x.t);
  assert j->'mine' = 'null'::jsonb and not (j->'lots'->0->>'owned')::boolean and j->'lots'->0->'grid' = 'null'::jsonb, format('repossessed %s', j);
  assert (select coins from public.wallets where account_id = x.a) = v_before + 20000, 'half the land back';
  assert not exists (select 1 from public.furniture_items where lot_no = 1), 'items stored';
  assert not exists (select 1 from public.house_room_rents where lot_no = 1), 'listings gone';
end $$;

-- 6) giving a lot back; the wipe
do $$ declare x hsv; j jsonb; g text := (select d.g from designs d where k = 'one'); v_before int; begin
  select * into x from hsv;
  j := public.lot_buy(x.t4, 3);
  perform public.house_build(x.t4, g, 'ngoi');
  v_before := (select coins from public.wallets where account_id = x.a4);
  j := public.lot_sell(x.t4);
  assert (j->>'coins')::int = v_before + 20000 and j->'mine' = 'null'::jsonb, format('given back %s', j);
  assert (select owner_id from public.house_lots where no = 3) is null, 'lot 3 free';
  -- d owns lot 4 with c renting its room; wiping d frees the lot and refunds c pro rata
  perform public.lot_buy(x.t4, 4);
  perform public.house_build(x.t4, g, 'ngoi');
  perform public.house_room_price(x.t4, 1, 600);
  perform public.house_room_rent(x.t3, 4, 1);
  v_before := (select coins from public.wallets where account_id = x.a3);
  perform public._ac_wipe(x.a4, null);
  assert (select owner_id from public.house_lots where no = 4) is null, 'wiped owner''s lot freed';
  assert not exists (select 1 from public.house_tenancies where lot_no = 4), 'tenancy ended';
  assert (select coins from public.wallets where account_id = x.a3) between v_before + 590 and v_before + 600, 'tenant refunded';
  -- wiping a tenant ends the tenancy, the lot stays
  perform public.lot_buy(x.t, 5);
  perform public.house_build(x.t, g, 'ngoi');
  perform public.house_room_price(x.t, 1, 600);
  perform public.house_room_rent(x.t3, 5, 1);
  perform public._ac_wipe(x.a3, null);
  assert not exists (select 1 from public.house_tenancies where lot_no = 5), 'tenant wiped';
  assert (select owner_id from public.house_lots where no = 5) = x.a, 'lot kept';
end $$;

select 'v19.3 smoke ok';
