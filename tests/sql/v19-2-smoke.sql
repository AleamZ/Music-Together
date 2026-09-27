-- tests/sql/v19-2-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0041 (see the plan),
-- from the repo root: it re-runs 0041 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0041_apartments.sql
\i supabase/migrations/0041_apartments.sql
reset client_min_messages;
-- a clean block (the smoke may run twice on the same cluster)
update public.apartments set owner_id = null;
select public._apt_sweep();

create temp table ap (k text primary key, v text);
insert into ap select 'a', token from public.register('ap_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into ap select 'b', token from public.register('ap_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into ap select 'c', token from public.register('ap_c_' || floor(random() * 1e9)::text, 'pw123456');
create temp view apv as select (select v from ap where k = 'a') t, (select v from ap where k = 'b') t2, (select v from ap where k = 'c') t3,
  public._auth_account((select v from ap where k = 'a')) a, public._auth_account((select v from ap where k = 'b')) a2,
  public._auth_account((select v from ap where k = 'c')) a3;
-- a music room with a and b as members (c is not)
insert into public.rooms (code, name) values ('APSMK' || floor(random() * 1e6)::text, 'smoke') returning id \gset room_
insert into public.members (room_id, account_id) select :'room_id'::uuid, a from apv union all select :'room_id'::uuid, a2 from apv;
insert into ap values ('room', :'room_id');

create or replace function pg_temp.fails(p_sql text, p_msg text) returns boolean language plpgsql as $$
begin
  execute p_sql;
  return false;
exception when others then
  if sqlerrm <> p_msg then raise notice 'expected %, got %', p_msg, sqlerrm; end if;
  return sqlerrm = p_msg;
end $$;

-- 1) rules and data
do $$ begin
  assert public._apt_price('rent') = 1500 and public._apt_price('buy') = 25000 and public._apt_price('sell') = 17500, 'prices';
  assert (select count(*) from public.apartments) = 12, 'twelve units';
  assert (select count(*) from public.furniture_catalog) = 32, 'catalogue';
  assert public._in_shade('khu_nha', 100, 100) = false and public._in_shade('interior:apt:1', 5, 5) = true
     and public._in_shade('market', 110, 140) = true, 'shade';
  assert not has_function_privilege('anon', 'public._apt_sweep()', 'execute'), 'helper not callable';
  assert has_function_privilege('anon', 'public.apt_list(text)', 'execute'), 'rpc callable';
end $$;

-- 2) renting, buying, the one-home rule, the cap
do $$ declare x apv; j jsonb; begin
  select * into x from apv;
  j := public.apt_list(x.t);
  assert jsonb_array_length(j->'units') = 12 and j->'mine' = 'null'::jsonb, format('empty list %s', j);
  assert pg_temp.fails(format('select public.apt_rent(%L, 1)', x.t), 'insufficient funds'), 'no money';
  perform public._wallet_lock(x.a);  perform public._pay(x.a, 100000, 'daily', 'smoke');
  perform public._wallet_lock(x.a2); perform public._pay(x.a2, 100000, 'daily', 'smoke');
  perform public._wallet_lock(x.a3); perform public._pay(x.a3, 100000, 'daily', 'smoke');
  j := public.apt_rent(x.t, 1);
  assert (j->>'coins')::int = 98500 and j->'mine'->>'tenure' = 'rent' and (j->'mine'->>'no')::int = 1, format('rented %s', j);
  j := public.apt_rent(x.t, 1);                                           -- 60 days
  assert (j->>'coins')::int = 97000, 'extended';
  assert pg_temp.fails(format('select public.apt_rent(%L, 1)', x.t), 'too far ahead'), 'cap';
  assert pg_temp.fails(format('select public.apt_rent(%L, 2)', x.t), 'already have a home'), 'one home';
  assert pg_temp.fails(format('select public.apt_rent(%L, 1)', x.t2), 'taken'), 'taken';
  assert pg_temp.fails(format('select public.apt_buy(%L, 1)', x.t2), 'taken'), 'taken (buy)';
  j := public.apt_buy(x.t2, 2);
  assert (j->>'coins')::int = 75000 and j->'mine'->>'tenure' = 'own', format('bought %s', j);
  j := public.apt_buy(x.t, 1);                                            -- a renter buys their own unit
  assert (j->>'coins')::int = 72000 and j->'mine'->>'tenure' = 'own', 'renter buys';
  assert pg_temp.fails(format('select public.apt_rent(%L, 1)', x.t), 'already have a home'), 'no rent when owned';
  assert (select count(*) from public.coin_ledger where account_id = x.a and reason = 'apartment') = 3, 'ledger';
end $$;

-- 3) furniture: buy, place, collisions, pick up, surfaces
do $$ declare x apv; j jsonb; v_bed bigint; v_chair bigint; v_rug bigint; v_tv bigint; v_fr bigint; v_wall bigint; begin
  select * into x from apv;
  j := public.furniture_buy(x.t, 'bed_go');   v_bed := (j->'storage'->-1->>'id')::bigint;
  assert (j->>'coins')::int = 70800, 'bed paid';
  j := public.furniture_buy(x.t, 'chair_go'); v_chair := (j->'storage'->-1->>'id')::bigint;
  j := public.furniture_buy(x.t, 'rug_do');   v_rug := (j->'storage'->-1->>'id')::bigint;
  j := public.furniture_buy(x.t, 'tv');       v_tv := (j->'storage'->-1->>'id')::bigint;
  j := public.furniture_buy(x.t, 'fridge');   v_fr := (j->'storage'->-1->>'id')::bigint;
  j := public.furniture_buy(x.t, 'wall_go');  v_wall := (j->'storage'->-1->>'id')::bigint;
  assert jsonb_array_length(j->'storage') = 6, 'storage';
  assert pg_temp.fails(format('select public.furniture_buy(%L, %L)', x.t, 'nope'), 'unknown item'), 'unknown item';
  j := public.furniture_place(x.t, v_bed, 0, 2, 0);
  assert jsonb_array_length(j->'items') = 1 and (j->>'can_edit')::boolean, format('placed %s', j);
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 1, 3, 0)', x.t, v_chair), 'overlap'), 'overlap';
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 0, 1, 0)', x.t, v_chair), 'bounds'), 'wall rows';
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 13, 9, 1)', x.t, v_chair), 'bounds') = false, 'edge ok';
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 6, 8, 0)', x.t, v_rug), 'door'), 'door';
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 3, 3, 4)', x.t, v_chair), 'bounds'), 'rot';
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 3, 3, 0)', x.t, v_wall), 'not placeable'), 'surface';
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 3, 3, 0)', x.t2, v_chair), 'not owned'), 'not mine';
  j := public.furniture_place(x.t, v_rug, 0, 3, 0);                       -- under the bed: rugs lie under furniture
  j := public.furniture_place(x.t, v_bed, 0, 3, 1);                       -- move + turn itself (3x2)
  assert (select fi.x || ',' || fi.y || ',' || fi.rot from public.furniture_items fi where fi.id = v_bed) = '0,3,1', 'moved';
  j := public.furniture_place(x.t, v_tv, 10, 2, 0);
  j := public.furniture_place(x.t, v_fr, 13, 5, 0);
  j := public.furniture_pickup(x.t, v_chair);
  assert (select apt_no from public.furniture_items where id = v_chair) is null, 'picked up';
  j := public.apt_set_surface(x.t, 'wall', 'wall_go');
  assert j->>'wall' = 'wall_go', 'wall';
  assert pg_temp.fails(format('select public.apt_set_surface(%L, %L, %L)', x.t, 'floor', 'floor_go'), 'not owned'), 'floor not owned';
  assert pg_temp.fails(format('select public.apt_set_surface(%L, %L, %L)', x.t, 'floor', 'wall_go'), 'not owned'), 'wrong kind';
  assert pg_temp.fails(format('select public.furniture_place(%L, %s, 3, 3, 0)', x.t3, v_chair), 'no home'), 'no home';
end $$;

-- 4) access: private → knock → admit; room; open; the TV
do $$ declare x apv; j jsonb; v_room uuid := (select v::uuid from ap where k = 'room'); v_id text; begin
  select * into x from apv;
  assert (public.apt_enter(x.t, v_room, 1)->>'can_edit')::boolean, 'owner enters';
  assert pg_temp.fails(format('select public.apt_enter(%L, %L, 1)', x.t2, v_room), 'no access'), 'private';
  assert pg_temp.fails(format('select public.apt_enter(%L, %L, 5)', x.t2, v_room), 'vacant'), 'vacant';
  assert public.apt_knock(x.t2, v_room, 1), 'knock';
  j := public.apt_list(x.t);
  assert jsonb_array_length(j->'knocks') = 1 and j->'knocks'->0->>'account_id' = x.a2::text, format('knocks %s', j->'knocks');
  j := public.apt_admit(x.t, x.a2, true);
  assert jsonb_array_length(j->'knocks') = 0, 'knock answered';
  j := public.apt_enter(x.t2, v_room, 1);
  assert not (j->>'can_edit')::boolean and jsonb_array_length(j->'items') = 4, format('guest sees the layout %s', j);
  j := public.apt_admit(x.t, x.a2, false);                                -- revoked
  assert pg_temp.fails(format('select public.apt_enter(%L, %L, 1)', x.t2, v_room), 'no access'), 'revoked';
  perform public.apt_set_visibility(x.t, 'room');
  perform public.apt_enter(x.t2, v_room, 1);
  assert pg_temp.fails(format('select public.apt_enter(%L, %L, 1)', x.t3, v_room), 'no access'), 'not a member';
  perform public.apt_set_visibility(x.t, 'open');
  perform public.apt_enter(x.t3, v_room, 1);
  assert pg_temp.fails(format('select public.apt_set_visibility(%L, %L)', x.t, 'x'), 'bad visibility'), 'bad visibility';
  -- the TV (unit 2 has none)
  assert pg_temp.fails(format('select public.tv_state(%L, %L, 2)', x.t2, v_room), 'no tv'), 'no tv';
  j := public.tv_add(x.t3, v_room, 1, 'dQw4w9WgXcQ', 'Bài một', 200);
  assert j->'current'->>'v' = 'dQw4w9WgXcQ' and jsonb_array_length(j->'queue') = 0 and j->>'started_at_ms' is not null, format('tv %s', j);
  j := public.tv_add(x.t2, v_room, 1, 'abcdefghijk', '', null);
  assert jsonb_array_length(j->'queue') = 1 and j->'queue'->0->>'t' = 'abcdefghijk', 'queued';
  assert pg_temp.fails(format('select public.tv_add(%L, %L, 1, %L, null, null)', x.t2, v_room, 'bad'), 'bad video'), 'bad video';
  v_id := j->'current'->>'id';
  j := public.tv_next(x.t2, v_room, 1, v_id);                             -- too early: ignored
  assert j->'current'->>'id' = v_id, 'early end ignored';
  assert pg_temp.fails(format('select public.tv_skip(%L, %L, 1)', x.t2, v_room), 'not yours'), 'skip not mine';
  j := public.tv_skip(x.t3, v_room, 1);                                   -- the adder skips
  assert j->'current'->>'v' = 'abcdefghijk' and jsonb_array_length(j->'queue') = 0, 'skipped';
  j := public.tv_next(x.t, v_room, 1, j->'current'->>'id');               -- unknown length: ends when told
  assert j->'current' = 'null'::jsonb, 'stopped';
  perform public.apt_set_visibility(x.t, 'private');
  assert pg_temp.fails(format('select public.tv_state(%L, %L, 1)', x.t3, v_room), 'no access'), 'tv needs access';
end $$;

-- 5) the fridge
do $$ declare x apv; j jsonb; v_sp text := (select id from public.fish_species order by id limit 1); v_f1 uuid := gen_random_uuid(); v_f2 uuid := gen_random_uuid(); begin
  select * into x from apv;
  insert into public.fish (id, account_id, species_id, weight_g, price) values (v_f1, x.a, v_sp, 500, 40);
  j := public.fridge_state(x.t);
  assert (j->>'cap')::int = 20 and (j->>'bag')::int = 1 and (j->>'bag_cap')::int >= 1, format('fridge %s', j);
  j := public.fish_move_to_fridge(x.t, v_f1);
  assert (j->>'bag')::int = 0 and jsonb_array_length(j->'fish') = 1 and j->'fish'->0->>'id' = v_f1::text, 'into the fridge';
  assert pg_temp.fails(format('select public.fish_move_to_fridge(%L, %L)', x.t, v_f1), 'not owned'), 'not in the bag';
  insert into public.fish (id, account_id, species_id, weight_g, price) values (v_f2, x.a, v_sp, 300, 20);
  if public._bucket_cap(x.a) = 0 then
    assert pg_temp.fails(format('select public.fish_move_to_bag(%L, %L)', x.t, v_f1), 'bag full'), 'bag full';
  end if;
  delete from public.fish where id = v_f2;
  j := public.fish_move_to_bag(x.t, v_f1);
  assert (j->>'bag')::int = 1 and jsonb_array_length(j->'fish') = 0, 'back in the bag';
  assert (select weight_g from public.fish where id = v_f1) = 500, 'same fish';
  assert pg_temp.fails(format('select public.fish_move_to_fridge(%L, %L)', x.t2, v_f1), 'no fridge'), 'no fridge at b';
  assert pg_temp.fails(format('select public.fish_move_to_fridge(%L, %L)', x.t3, v_f1), 'no home'), 'no home at c';
end $$;

-- 6) sleeping at home (shared with the motel's one-per-day)
do $$ declare x apv; j jsonb; begin
  select * into x from apv;
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 2)', x.t2, 'apt'), 'no bed'), 'no bed';
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 2)', x.t, 'apt'), 'no home'), 'not my unit';
  j := public.home_sleep(x.t, 'apt', 1);
  assert (j->'rest'->>'slept_today')::boolean and j->'rest'->>'buff_until_ms' is not null, format('slept %s', j);
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 1)', x.t, 'apt'), 'already slept'), 'once a day';
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 0)', x.t, 'motel'), 'no room'), 'motel delegates';
end $$;

-- 7) lapsing rents, moving out
do $$ declare x apv; j jsonb; v_room uuid := (select v::uuid from ap where k = 'room'); begin
  select * into x from apv;
  j := public.apt_rent(x.t3, 3);
  perform public.furniture_buy(x.t3, 'chair_go');
  perform public.furniture_place(x.t3, (select max(id) from public.furniture_items where account_id = x.a3), 2, 2, 0);
  update public.apartments set paid_until = now() - interval '1 day' where no = 3;          -- in the grace
  assert pg_temp.fails(format('select public.apt_enter(%L, %L, 3)', x.t3, v_room), 'rent due'), 'grace: no entering';
  assert pg_temp.fails(format('select public.home_sleep(%L, %L, 3)', x.t3, 'apt'), 'rent due'), 'grace: no sleeping';
  j := public.apt_list(x.t3);
  assert j->'mine'->>'no' = '3', 'still mine in the grace';
  update public.apartments set paid_until = now() - interval '8 days' where no = 3;          -- past the grace
  j := public.apt_list(x.t3);
  assert j->'mine' = 'null'::jsonb and jsonb_array_length(j->'storage') = 1, format('freed, furniture stored %s', j);
  assert (select owner_id from public.apartments where no = 3) is null, 'unit free';
  -- b sells back for 70 %
  j := public.apt_move_out(x.t2);
  assert (j->>'coins')::int = 75000 + 17500 and j->'mine' = 'null'::jsonb, format('sold back %s', j);
  assert (select count(*) from public.coin_ledger where account_id = x.a2 and reason = 'apartment_sell') = 1, 'ledger sell';
  assert pg_temp.fails(format('select public.apt_move_out(%L)', x.t2), 'no home'), 'nothing to leave';
end $$;

-- 8) the wipe takes the fridge, the furniture and the home
do $$ declare x apv; begin
  select * into x from apv;
  perform public.fish_move_to_fridge(x.t, (select id from public.fish where account_id = x.a limit 1));
  perform public._ac_wipe(x.a, null);
  assert not exists (select 1 from public.fridge_fish where account_id = x.a), 'fridge wiped';
  assert not exists (select 1 from public.furniture_items where account_id = x.a), 'furniture wiped';
  assert (select owner_id from public.apartments where no = 1) is null, 'home freed';
end $$;

select 'v19.2 smoke ok';
