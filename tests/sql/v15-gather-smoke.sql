-- tests/sql/v15-gather-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0018 (see the plan),
-- from the repo root: it re-runs 0018 with \i, reads tests/fixtures/gather-cases.json with \copy, and ends with
-- tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
\set ON_ERROR_STOP on

-- The v15 smoke re-runs 0013, the anti-cheat smoke 0015, the v15.2 smoke 0016 and the v16 smoke 0017: they put back
-- their own versions of functions 0018 re-creates, so 0018 runs again first.
set client_min_messages = warning;
\i supabase/migrations/0018_v15_3_gather.sql
reset client_min_messages;

-- The tampered calls below are only recorded: log mode locks nobody.
update public.anticheat_config set mode = 'log';

create temp table smoke (k text primary key, v text);

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The error of a statement with its SQLSTATE and details, or null.
create function pg_temp.errd(p_sql text) returns jsonb language plpgsql as $$
declare v_msg text; v_detail text; v_state text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_state = returned_sqlstate;
  return jsonb_build_object('message', v_msg, 'detail', v_detail, 'state', v_state);
end $$;

create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.give(a uuid, it text, n integer) returns void language sql
as $$ insert into public.inventory (account_id, item_id, qty) values (a, it, n)
      on conflict (account_id, item_id) do update set qty = excluded.qty $$;
-- The critters an account holds, kinds in the order caught.
create function pg_temp.held(a uuid) returns text[] language sql
as $$ select coalesce(array_agg(kind order by id), '{}') from public.critters where account_id = a $$;
-- The room's fish price index row, set by hand for this period.
create function pg_temp.set_mult(r uuid, m numeric, t timestamptz) returns void language sql
as $$ insert into public.fish_price_index (room_id, period, wealth, mult, computed_at) values (r, public._fish_period(t), 0, m, t)
      on conflict (room_id) do update set period = excluded.period, mult = excluded.mult, computed_at = excluded.computed_at $$;

create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/gather-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;

-- ---------- the config, the prices, the tables and the ledger (§7.1, §9, §11.2) ----------
set role anon;
create temp table anon_read as select count(*)::int as n from public.critter_kinds;
reset role;

do $$
declare j jsonb := (select j from fx); r jsonb;
begin
  assert (select n from anon_read) = 4, 'anon reads critter_kinds';
  assert (select jsonb_agg(jsonb_build_array(id, name, grp, base_price, sort_order) order by sort_order) from public.critter_kinds)
         = '[["cua_dong", "Cua đồng", "crab", 12, 10], ["cua_gach", "Cua gạch", "crab", 45, 20],
             ["oc_dong", "Ốc đồng", "snail", 8, 30], ["oc_buou_vang", "Ốc bươu vàng", "snail", 2, 40]]', 'the four critters (§7.1)';
  assert not has_table_privilege('anon', 'public.critter_kinds', 'insert, update, delete, truncate')
     and not has_table_privilege('authenticated', 'public.critter_kinds', 'insert, update, delete, truncate'), 'read-only config';
  assert not has_table_privilege('anon', 'public.critters', 'select') and not has_table_privilege('authenticated', 'public.critters', 'select')
     and not has_table_privilege('anon', 'public.gather_cooldowns', 'select')
     and not has_table_privilege('authenticated', 'public.gather_cooldowns', 'select'), 'private tables';
  -- the containers (§9) and the fixture's rules
  assert (select jsonb_agg(jsonb_build_array(id, kind, name, price, capacity, sort_order) order by sort_order)
            from public.shop_items where kind = 'critter_box')
         = '[["box_bucket", "critter_box", "Xô nhựa", 1500, 15, 10], ["box_basket", "critter_box", "Giỏ tre", 6000, 30, 20]]',
    'the two containers';
  assert (select jsonb_agg(capacity order by capacity) from public.shop_items where kind = 'critter_box') = j->'rules'->'boxes',
    'the fixture''s boxes';
  -- the price law (R4): floor(base × M), against the shared fixture
  for r in select x from jsonb_array_elements(j->'prices') x loop
    assert public._critter_price((r->>0)::int, (r->>1)::numeric) = (r->>2)::int, format('price %s', r);
  end loop;
  assert public._critter_price(2, 0.3) = 1, 'at least 1';
  -- the ledger: exactly the 21 reasons in force after 0017, plus none
  assert (select array_agg(m[1] order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
           where c.conname = 'coin_ledger_reason_check')
         = (select array_agg(x order by x) from unnest(array['daily','song','sell','buy','rent','land_buy','land_sell','land_refund',
              'lease_pay','lease_income','farm_buy','rice_sell','wipe','harvester','produce_sell','card_hold','card_settle',
              'card_buyin','card_cashout','card_refund','critter_sell']) x), 'the 21 ledger reasons';
  assert pg_temp.err(format('insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (%L, 0, 0, %L, %L)',
                            gen_random_uuid(), 'foo', 'x')) like '%coin_ledger_reason_check%', 'foo is refused';
  -- the tables' checks
  assert pg_temp.err(format('insert into public.gather_cooldowns (account_id, spot, ready_at) values (%L, %L, now())',
                            gen_random_uuid(), 'crab7')) like '%gather_cooldowns_spot_check%', 'crab1–crab6 and bed1–bed4 only';
  assert (select pg_get_constraintdef(oid) like '%gather_count >= 0%' from pg_constraint
           where conname = 'farm_profiles_gather_count_check'), 'gather_count ≥ 0';
  -- the helpers are private
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('_critter_price', '_critter_prices', '_critter_cap', '_critter_add', '_gather_check',
                                        '_gather_count')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
end $$;

-- ---------- capacity, the catch, the prices shown and the account's part (R4, R5, R12, §11.7) ----------
insert into smoke select 't1', token from public.register('gather_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('gather_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Bờ mương', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
  from smoke where k = 't2';
insert into smoke select 'now', date_trunc('minute', now())::text;

do $$
declare j jsonb := (select j from fx); a1 uuid := (select v from smoke where k = 'a1')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        r jsonb; m jsonb;
begin
  -- 3 by hand, then the largest container (R5)
  assert public._critter_cap(a1) = (j->'rules'->>'hand')::int, 'hands: 3';
  perform pg_temp.give(a1, 'box_bucket', 1);
  assert public._critter_cap(a1) = 18, 'a bucket: 18';
  perform pg_temp.give(a1, 'box_basket', 1);
  assert public._critter_cap(a1) = 33, 'both: 33';
  delete from public.inventory where account_id = a1 and item_id = 'box_bucket';
  assert public._critter_cap(a1) = 33, 'a basket: 33';
  delete from public.inventory where account_id = a1 and item_id = 'box_basket';
  -- a catch takes the room's M at the moment and keeps it (R4): 12 × 2.24 → 26, 45 × 2.24 → 100
  perform pg_temp.set_mult(room, 2.24, t);
  r := public._critter_add(a1, room, array['cua_dong', 'cua_gach'], t);
  assert r = '{"caught": [{"kind": "cua_dong", "price": 26}, {"kind": "cua_gach", "price": 100}], "escaped": 0}', format('caught %s', r);
  assert (select array_agg(price order by id) from public.critters where account_id = a1) = '{26,100}'
     and (select bool_and(caught_at = t) from public.critters where account_id = a1), 'stored with the catch';
  -- only what fits is kept, in order; the rest escape
  r := public._critter_add(a1, room, array['oc_dong', 'oc_buou_vang', 'oc_dong'], t);
  assert r = '{"caught": [{"kind": "oc_dong", "price": 17}], "escaped": 2}', format('one place left %s', r);
  r := public._critter_add(a1, room, array['oc_dong'], t);
  assert r = '{"caught": [], "escaped": 1}' and pg_temp.held(a1) = '{cua_dong,cua_gach,oc_dong}', 'full: nothing kept';
  -- the account's part (§11.7): the critters held, the capacity and the gathering
  m := public._farm_mine(a1);
  assert m->'critters' = '{"cua_dong": {"n": 1, "xu": 26}, "cua_gach": {"n": 1, "xu": 100}, "oc_dong": {"n": 1, "xu": 17}}'
     and m->'critter_cap' = '3', format('mine %s', m);
  assert m->'gather' = '{"ready_at": {}, "left_today": 200, "day_resets_at": null}', format('gather %s', m->'gather');
  insert into public.gather_cooldowns (account_id, spot, ready_at) values
    (a1, 'crab3', now() + interval '12 minutes'), (a1, 'bed1', now() + interval '7 minutes'), (a1, 'crab1', now() - interval '1 minute');
  update public.farm_profiles set gather_on = public._vn_today(), gather_count = 13 where account_id = a1;
  if not found then
    insert into public.farm_profiles (account_id, gather_on, gather_count) values (a1, public._vn_today(), 13);
  end if;
  m := public._farm_mine(a1)->'gather';
  assert m->'ready_at' = jsonb_build_object('bed1', now() + interval '7 minutes', 'crab3', now() + interval '12 minutes')
     and m->'left_today' = '187' and m->'day_resets_at' = 'null', format('cooling spots, 187 left: %s', m);
  update public.farm_profiles set gather_count = 200 where account_id = a1;
  m := public._farm_mine(a1)->'gather';
  assert m->'left_today' = '0'
     and (m->>'day_resets_at')::timestamptz = (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh', format('none left %s', m);
  update public.farm_profiles set gather_on = public._vn_today() - 1 where account_id = a1;
  assert public._farm_mine(a1)->'gather'->'left_today' = '200', 'a new day';
end $$;

-- The prices the field shows (R12): the snapshot while its period is current, else a preview; a read never writes.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        p jsonb; w bigint;
begin
  p := public._critter_prices(room, t);
  assert p = jsonb_build_object('mult', 2.24, 'ends_at', to_timestamp((public._fish_period(t) + 1) * 10800 - 25200)),
    format('the snapshot %s', p);
  assert public._field_view(room, a1, t)->'critter_prices' = p, 'field_state carries it';
  -- an older period: the preview of the room's wealth now, and no write
  update public.fish_price_index set period = period - 1 where room_id = room;
  perform pg_temp.set_coins(a1, 400000);
  perform pg_temp.set_coins(a2, 600000);
  w := public._room_wealth(room, t);
  p := public._critter_prices(room, t);
  assert (p->>'mult')::numeric = public._fish_mult(w) and public._fish_mult(w) = 5.00, format('the preview %s (W = %s)', p, w);
  assert (select period from public.fish_price_index where room_id = room) = public._fish_period(t) - 1, 'nothing written';
  -- a room with no row yet previews ×1 (one member)
  assert (public._critter_prices(gen_random_uuid(), t)->>'mult')::numeric = 1, 'no row';
  delete from public.fish_price_index where room_id = room;
  assert public._field_view(room, a1, t)->'critter_prices'->>'mult' = '5.00'
     and not exists (select 1 from public.fish_price_index where room_id = room), 'the view never writes the index';
end $$;

-- The daily limit's helpers (§7.5): the check first, the count after it; the 200th visit logs one soft signal.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; v_day date := (t at time zone 'Asia/Ho_Chi_Minh')::date;
        e jsonb;
begin
  perform public._gather_check(a2, t);
  assert exists (select 1 from public.farm_profiles where account_id = a2 and gather_count = 0), 'a profile is made';
  update public.farm_profiles set gather_on = v_day, gather_count = 198 where account_id = a2;
  perform public._gather_count(a2, room, 'pick_snail_bed', t);
  assert (select gather_count from public.farm_profiles where account_id = a2) = 199
     and not exists (select 1 from public.anticheat_events where account_id = a2), '199: nothing logged';
  perform public._gather_check(a2, t);
  perform public._gather_count(a2, room, 'crab_start', t);
  assert (select outcome = 'soft' and code = 'gather_daily_cap' and rpc = 'crab_start' and room_id = room
                 and detail = jsonb_build_object('day', v_day, 'visits', 200)
            from public.anticheat_events where account_id = a2), 'the 200th visit is logged, soft';
  e := pg_temp.errd(format('select public._gather_check(%L, %L)', a2, t));
  assert e->>'message' = 'gather daily limit' and e->>'state' = '53400'
     and (e->>'detail')::int = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - t)))::int,
    format('the limit %s', e);
  -- a new Vietnam day starts the count again
  update public.farm_profiles set gather_on = v_day - 1 where account_id = a2;
  perform public._gather_check(a2, t);
  perform public._gather_count(a2, room, 'crab_start', t);
  assert (select gather_on = v_day and gather_count = 1 from public.farm_profiles where account_id = a2), 'day 2: 1';
  assert (select count(*) from public.anticheat_events where account_id = a2) = 1, 'the refusal is not logged';
end $$;

select 'v15.3 model smoke ok' as result;

-- ---------- gathering (§7.2–§7.6, §11.4, §11.5): the holes, the beds, the daily limit and cô Út ----------
insert into smoke select 't3', token from public.register('gather_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't4', token from public.register('gather_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'a4', public._auth_account((select v from smoke where k = 't4'))::text;
insert into smoke select 'room2', room_id::text from public.create_room('Hang cua', 'pw', (select v from smoke where k = 't3'));
insert into smoke select 'room3', room_id::text from public.create_room('Bãi ốc', 'pw', (select v from smoke where k = 't3'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room2')::uuid), 'pw', v)
  from smoke where k = 't4';
-- 01:00 in Vietnam today: every visit below falls in one Vietnam day and one 3-hour price period.
insert into smoke select 'tg', ((public._vn_today()::timestamp + interval '1 hour') at time zone 'Asia/Ho_Chi_Minh')::text;

-- Each hole and bed writes the fixture's key with the fixture's cooldown, and each visit counts (§6, §7.5).
do $$
declare j jsonb := (select j from fx); a4 uuid := (select v from smoke where k = 'a4')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        p jsonb; n integer;
begin
  perform pg_temp.set_mult(room, 2.24, tg);
  perform pg_temp.give(a4, 'box_basket', 1);
  for p in select x from jsonb_array_elements(j->'spots') x loop
    n := split_part(p->>0, '_', 2)::int;
    if p->>0 like 'crab%' then
      perform public._gather_do_crab_start(room, a4, n, tg);
    else
      perform public._gather_do_bed(room, a4, n, tg, '{0, 0}');
    end if;
    assert exists (select 1 from public.gather_cooldowns where account_id = a4 and spot = p->>1
                     and ready_at = tg + make_interval(secs => (j->'rules'->>'cooldown_s')::int)), format('the key of %s', p);
  end loop;
  assert (select count(*) from public.gather_cooldowns where account_id = a4) = 10
     and (select count(*) from public.gather_cooldowns where account_id = a4 and visit_id is not null) = 6, 'ten spots, six visits';
  assert (select gather_on = (tg at time zone 'Asia/Ho_Chi_Minh')::date and gather_count = 10
            from public.farm_profiles where account_id = a4), 'ten visits';
  assert pg_temp.held(a4) = '{oc_dong,oc_dong,oc_dong,oc_dong}', 'u = 0: one ốc đồng a bed';
end $$;

-- crab_start (§7.2, R1, R6): the cooldown and the visit on the hole's row; hole empty with the seconds left, in any room.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        room3 uuid := (select v from smoke where k = 'room3')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        r jsonb; g public.gather_cooldowns; e jsonb;
begin
  r := public._gather_do_crab_start(room, a3, 3, tg);
  select * into g from public.gather_cooldowns where account_id = a3 and spot = 'crab3';
  assert g.ready_at = tg + interval '20 minutes' and g.visit_at = tg and g.visit_room = room and g.visit_id is not null,
    format('the cooldown and the visit %s', to_jsonb(g));
  assert r->'visit' = jsonb_build_object('id', g.visit_id, 'hole', 3, 'started_at', tg) and (r->>'server_now')::timestamptz = tg
     and r->'mine'->'critter_cap' = '3' and r->'mine'->'critters' = '{}', format('the answer %s', r);
  insert into smoke values ('visit1', g.visit_id::text);
  e := pg_temp.errd(format('select public._gather_do_crab_start(%L, %L, 3, %L)', room, a3, tg + interval '19 minutes 59 seconds'));
  assert e->>'message' = 'hole empty' and e->>'state' = '22023' and e->>'detail' = '1', format('at 19:59 %s', e);
  e := pg_temp.errd(format('select public._gather_do_crab_start(%L, %L, 3, %L)', room3, a3, tg + interval '1 minute'));
  assert e->>'message' = 'hole empty' and e->>'detail' = '1140', format('the same hole in another room %s', e);
  assert (select visit_id = g.visit_id and ready_at = g.ready_at from public.gather_cooldowns where account_id = a3 and spot = 'crab3')
     and (select gather_count from public.farm_profiles where account_id = a3) = 1, 'a refusal changes and counts nothing';
end $$;

-- crab_finish (§11.5, R7): too fast under 3 s, the visit kept; at 3 s the hits roll at the room's M; single use.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        tg timestamptz := (select v from smoke where k = 'tg')::timestamptz; v1 uuid := (select v from smoke where k = 'visit1')::uuid;
        r jsonb;
begin
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 3, %L, %L)', room, a3, v1,
                            tg + interval '2.9 seconds', '{0.05, 0.5, 0.95}')) = 'too fast', 'hits 3 at 2.9 s';
  assert exists (select 1 from public.gather_cooldowns where account_id = a3 and visit_id = v1), 'the visit stays open';
  r := public._gather_do_crab_finish(room, a3, v1, 3, tg + interval '3 seconds', '{0.05, 0.5, 0.95}');
  assert r->'crab' = '{"hits": 3, "caught": [{"kind": "cua_gach", "price": 100}, {"kind": "cua_dong", "price": 26},
                                              {"kind": "cua_dong", "price": 26}], "escaped": 0}', format('at 3 s %s', r->'crab');
  assert r->'mine'->'critters' = '{"cua_dong": {"n": 2, "xu": 52}, "cua_gach": {"n": 1, "xu": 100}}'
     and (r->>'server_now')::timestamptz = tg + interval '3 seconds', format('mine %s', r->'mine'->'critters');
  assert (select visit_id is null and visit_at is null and visit_room is null and ready_at = tg + interval '20 minutes'
            from public.gather_cooldowns where account_id = a3 and spot = 'crab3'), 'consumed, still cooling';
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 0, %L)', room, a3, v1, tg + interval '4 seconds'))
         = 'visit not found', 'single use';
  assert (select gather_count from public.farm_profiles where account_id = a3) = 1, 'a finish counts no visit';
end $$;

-- Full hands refuse a visit before its cooldown (R5); hits 0 needs no wait; another room's finish finds no visit; a
-- finish after 120 s is expired and leaves the visit; what does not fit escapes.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        room3 uuid := (select v from smoke where k = 'room3')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        r jsonb; v uuid;
begin
  assert pg_temp.err(format('select public._gather_do_crab_start(%L, %L, 1, %L)', room, a3, tg + interval '1 minute'))
         = 'critters full', 'hands full';
  assert pg_temp.err(format('select public._gather_do_bed(%L, %L, 1, %L)', room, a3, tg + interval '1 minute')) = 'critters full',
    'a bed too';
  assert not exists (select 1 from public.gather_cooldowns where account_id = a3 and spot in ('crab1', 'bed1')), 'no cooldown spent';
  perform pg_temp.give(a3, 'box_bucket', 1);
  v := (public._gather_do_crab_start(room, a3, 1, tg + interval '1 minute')->'visit'->>'id')::uuid;
  r := public._gather_do_crab_finish(room, a3, v, 0, tg + interval '1 minute 0.5 seconds');
  assert r->'crab' = '{"hits": 0, "caught": [], "escaped": 0}' and pg_temp.held(a3) = '{cua_gach,cua_dong,cua_dong}',
    format('hits 0 at 0.5 s %s', r->'crab');
  assert (select visit_id is null from public.gather_cooldowns where account_id = a3 and spot = 'crab1'), 'consumed';
  v := (public._gather_do_crab_start(room, a3, 2, tg + interval '2 minutes')->'visit'->>'id')::uuid;
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 1, %L)', room3, a3, v,
                            tg + interval '2 minutes 5 seconds')) = 'visit not found', 'another room';
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 1, %L, %L)', room, a3, v,
                            tg + interval '4 minutes 1 second', '{0.5}')) = 'visit expired', 'at 121 s';
  r := public._gather_do_crab_finish(room, a3, v, 1, tg + interval '4 minutes', '{0.5}');
  assert r->'crab' = '{"hits": 1, "caught": [{"kind": "cua_dong", "price": 26}], "escaped": 0}', format('at 120 s %s', r->'crab');
  insert into public.critters (account_id, kind, price, caught_at) select a3, 'oc_dong', 17, tg from generate_series(1, 13);
  assert (select count(*) from public.critters where account_id = a3) = 17, '17 of 18';
  v := (public._gather_do_crab_start(room, a3, 4, tg + interval '5 minutes')->'visit'->>'id')::uuid;
  r := public._gather_do_crab_finish(room, a3, v, 3, tg + interval '5 minutes 4 seconds', '{0.5, 0.05, 0.05}');
  assert r->'crab' = '{"hits": 3, "caught": [{"kind": "cua_dong", "price": 26}], "escaped": 2}', format('one place %s', r->'crab');
  assert (select gather_count from public.farm_profiles where account_id = a3) = 4, 'four visits';
end $$;

-- Prices (R4): stored at the catch; the room's M moves to 5.00 and cô Út still pays what was stored (§7.6, R15).
do $$
declare t3 text := (select v from smoke where k = 't3'); a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        r jsonb;
begin
  perform pg_temp.set_mult(room, 5.00, tg);
  perform pg_temp.set_coins(a3, 1000);
  assert pg_temp.err(format('select public.sell_critters(%L, %L)', t3, 'tom')) = 'invalid kind', 'an unknown kind';
  assert pg_temp.err(format('select public.sell_critters(%L, %L)', t3, 'oc_buou_vang')) = 'no critters', 'none of that kind';
  r := public.sell_critters(t3, 'cua_gach');
  assert r->'sold' = '{"n": 1, "xu": 100}' and r->'mine'->'coins' = '1100' and r->'mine'->'critters'->'cua_gach' is null
     and r->>'server_now' is not null, format('one cua gạch %s', r);
  assert exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'critter_sell' and delta = 100 and balance = 1100
                   and ref = 'cua_gach x1'), 'the ledger row';
  -- 4 cua đồng at 26 and 13 ốc đồng at 17, whatever M is now
  r := public.sell_critters(t3, null);
  assert r->'sold' = '{"n": 17, "xu": 325}' and r->'mine'->'critters' = '{}' and r->'mine'->'coins' = '1425', format('all %s', r->'sold');
  assert exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'critter_sell' and delta = 325
                   and ref = 'all x17'), 'the ledger row for all';
  assert pg_temp.err(format('select public.sell_critters(%L, null)', t3)) = 'no critters', 'nothing left';
end $$;

-- A snail bed (§7.3): u = (0.99, 0.1, 0.8, 0.5) gives 3 snails at M = 5.00; bed empty with the seconds left; what does
-- not fit is let go; full.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        tg timestamptz := (select v from smoke where k = 'tg')::timestamptz; r jsonb; e jsonb;
begin
  r := public._gather_do_bed(room, a3, 2, tg + interval '10 minutes', '{0.99, 0.1, 0.8, 0.5}');
  assert r->'snails' = '{"caught": [{"kind": "oc_dong", "price": 40}, {"kind": "oc_buou_vang", "price": 10},
                                     {"kind": "oc_dong", "price": 40}], "escaped": 0}', format('three snails %s', r->'snails');
  assert (select ready_at = tg + interval '30 minutes' and visit_id is null from public.gather_cooldowns
           where account_id = a3 and spot = 'bed2'), 'the bed cools, with no visit';
  e := pg_temp.errd(format('select public._gather_do_bed(%L, %L, 2, %L)', room, a3, tg + interval '22 minutes'));
  assert e->>'message' = 'bed empty' and e->>'state' = '22023' and e->>'detail' = '480', format('bed empty %s', e);
  r := public._gather_do_bed(room, a3, 3, tg + interval '10 minutes', '{0, 0.95}');
  assert r->'snails' = '{"caught": [{"kind": "oc_buou_vang", "price": 10}], "escaped": 0}', format('u₁ = 0: one %s', r->'snails');
  insert into public.critters (account_id, kind, price, caught_at) select a3, 'oc_dong', 40, tg from generate_series(1, 13);
  r := public._gather_do_bed(room, a3, 4, tg + interval '11 minutes', '{0.99, 0.1, 0.1, 0.1}');
  assert r->'snails' = '{"caught": [{"kind": "oc_dong", "price": 40}], "escaped": 2}', format('one place %s', r->'snails');
  assert pg_temp.err(format('select public._gather_do_bed(%L, %L, 1, %L)', room, a3, tg + interval '11 minutes')) = 'critters full',
    'a full bucket';
  assert (select gather_count from public.farm_profiles where account_id = a3) = 7, 'seven visits';
  delete from public.critters where account_id = a3;
end $$;

-- The daily limit through the visits (§7.5, R3): the 200th works and logs one soft gather_daily_cap; the 201st is refused
-- first, before full and the cooldown; a new Vietnam day starts again.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        tg timestamptz := (select v from smoke where k = 'tg')::timestamptz; v_day date := (tg at time zone 'Asia/Ho_Chi_Minh')::date;
        e jsonb;
begin
  update public.farm_profiles set gather_on = v_day, gather_count = 199 where account_id = a3;
  perform public._gather_do_crab_start(room, a3, 5, tg + interval '12 minutes');
  assert (select gather_count from public.farm_profiles where account_id = a3) = 200
     and (select count(*) from public.anticheat_events where account_id = a3 and code = 'gather_daily_cap' and outcome = 'soft'
            and rpc = 'crab_start' and room_id = room and detail = jsonb_build_object('day', v_day, 'visits', 200)) = 1,
    'the 200th visit';
  insert into public.critters (account_id, kind, price, caught_at) select a3, 'oc_dong', 40, tg from generate_series(1, 18);
  e := pg_temp.errd(format('select public._gather_do_bed(%L, %L, 1, %L)', room, a3, tg + interval '13 minutes'));
  assert e->>'message' = 'gather daily limit' and e->>'state' = '53400'
     and (e->>'detail')::int = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'
                                                        - (tg + interval '13 minutes'))))::int, format('the 201st %s', e);
  e := pg_temp.errd(format('select public._gather_do_crab_start(%L, %L, 5, %L)', room, a3, tg + interval '13 minutes'));
  assert e->>'message' = 'gather daily limit', format('before the cooldown %s', e);
  delete from public.critters where account_id = a3;
  update public.farm_profiles set gather_on = v_day - 1 where account_id = a3;
  perform public._gather_do_bed(room, a3, 1, tg + interval '13 minutes', '{0, 0}');
  assert (select gather_on = v_day and gather_count = 1 from public.farm_profiles where account_id = a3), 'a new day';
  assert (select count(*) from public.anticheat_events where account_id = a3 and code = 'gather_daily_cap') = 1, 'logged once';
end $$;

-- The RPCs (§11.4, §11.6): hard bad_qty and bad_spot envelopes that change nothing; the guard's path at now(); public
-- RPCs, private cores.
do $$
declare t3 text := (select v from smoke where k = 't3'); a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; r jsonb; v uuid; n0 integer; c0 bigint;
begin
  delete from public.gather_cooldowns where account_id = a3;
  delete from public.critters where account_id = a3;
  n0 := (select gather_count from public.farm_profiles where account_id = a3);
  r := public.crab_finish(room, t3, gen_random_uuid(), 4);
  assert r->'anticheat'->>'code' = 'bad_qty' and r->'anticheat'->>'error' = 'invalid quantity' and r->'anticheat'->>'strike' = '0'
     and r - 'anticheat' = '{}', format('hits 4 %s', r);
  assert public.crab_finish(room, t3, gen_random_uuid(), -1)->'anticheat'->>'code' = 'bad_qty', 'hits -1';
  assert public.crab_finish(room, t3, gen_random_uuid(), null)->'anticheat'->>'code' = 'bad_qty', 'hits null';
  r := public.crab_start(room, t3, 7);
  assert r->'anticheat'->>'code' = 'bad_spot' and r->'anticheat'->>'error' = 'invalid spot' and r - 'anticheat' = '{}',
    format('hole 7 %s', r);
  assert public.crab_start(room, t3, 0)->'anticheat'->>'code' = 'bad_spot'
     and public.crab_start(room, t3, null)->'anticheat'->>'code' = 'bad_spot', 'hole 0 and null';
  r := public.pick_snail_bed(room, t3, 0);
  assert r->'anticheat'->>'code' = 'bad_spot' and r->'anticheat'->>'error' = 'invalid spot', format('bed 0 %s', r);
  assert public.pick_snail_bed(room, t3, 5)->'anticheat'->>'code' = 'bad_spot', 'bed 5';
  assert (select count(*) from public.anticheat_events where account_id = a3 and code = 'bad_qty' and rpc = 'crab_finish') = 3
     and exists (select 1 from public.anticheat_events where account_id = a3 and code = 'bad_qty' and detail->'hits' = '4'
                   and detail ? 'visit')
     and (select count(*) from public.anticheat_events where account_id = a3 and code = 'bad_spot') = 5
     and exists (select 1 from public.anticheat_events where account_id = a3 and code = 'bad_spot' and rpc = 'pick_snail_bed'
                   and detail = '{"spot": 0}' and room_id = room), 'the evidence';
  assert (select gather_count from public.farm_profiles where account_id = a3) = n0
     and not exists (select 1 from public.gather_cooldowns where account_id = a3), 'the state is unchanged';
  -- through the guard, at now()
  r := public.pick_snail_bed(room, t3, 4);
  assert jsonb_array_length(r->'snails'->'caught') between 1 and 3 and r->'snails'->'escaped' = '0' and r ? 'server_now'
     and r->'mine'->'gather'->'ready_at' ? 'bed4', format('pick_snail_bed %s', r);
  r := public.crab_start(room, t3, 6);
  v := (r->'visit'->>'id')::uuid;
  assert r->'visit'->'hole' = '6' and r->'mine'->'gather'->'ready_at' ? 'crab6', format('crab_start %s', r);
  r := public.crab_finish(room, t3, v, 0);
  assert r->'crab' = '{"hits": 0, "caught": [], "escaped": 0}', format('crab_finish %s', r);
  assert pg_temp.err(format('select public.crab_finish(%L, %L, %L, 1)', room, t3, v)) = 'visit not found', 'single use';
  assert (select gather_count from public.farm_profiles where account_id = a3) = n0 + 2, 'two visits';
  assert has_function_privilege('anon', 'public.crab_start(uuid,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.crab_finish(uuid,text,uuid,integer)', 'execute')
     and has_function_privilege('anon', 'public.pick_snail_bed(uuid,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.sell_critters(text,text)', 'execute')
     and not has_function_privilege('anon', 'public._gather_do_crab_start(uuid,uuid,integer,timestamptz)', 'execute')
     and not has_function_privilege('anon', 'public._gather_do_crab_finish(uuid,uuid,uuid,integer,timestamptz,double precision[])',
                                    'execute')
     and not has_function_privilege('anon', 'public._gather_do_bed(uuid,uuid,integer,timestamptz,double precision[])', 'execute'),
    'public RPCs, private cores';
end $$;

select 'v15.3 gathering smoke ok' as result;

\i tests/sql/anticheat-guards.sql
