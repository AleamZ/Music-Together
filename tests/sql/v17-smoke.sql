-- tests/sql/v17-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0019 (see the plan), from
-- the repo root: it re-runs 0019 with \i, reads tests/fixtures/crop-cases.json and upland-cases.json with \copy, and ends
-- with tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
\set ON_ERROR_STOP on
-- Timestamps inside JSON print in the session's zone: UTC, as on Supabase.
set time zone 'UTC';

-- The v15 smoke re-runs 0013, the anti-cheat smoke 0015, the v15.2 smoke 0016 and 0018, the v16 smoke 0017 and the gather
-- smoke 0018: they put back their own versions of functions 0019 re-creates, so 0019 runs again first.
set client_min_messages = warning;
\i supabase/migrations/0019_v17_rats.sql
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
create function pg_temp.qty(a uuid, it text) returns integer language sql
as $$ select coalesce((select qty from public.inventory where account_id = a and item_id = it), 0) $$;
-- The room's fish price index row, set by hand for this period.
create function pg_temp.set_mult(r uuid, m numeric, t timestamptz) returns void language sql
as $$ insert into public.fish_price_index (room_id, period, wealth, mult, computed_at) values (r, public._fish_period(t), 0, m, t)
      on conflict (room_id) do update set period = excluded.period, mult = excluded.mult, computed_at = excluded.computed_at $$;

-- ---------- the shared fixtures (§15) ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/crop-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;
create temp table fxu_raw (n serial, line text);
\copy fxu_raw (line) from 'tests/fixtures/upland-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fxu as select string_agg(line, e'\n' order by n)::jsonb as j from fxu_raw;

create function pg_temp.fx_at(t0 timestamptz, h jsonb) returns timestamptz language sql
as $$ select t0 + make_interval(secs => (h #>> '{}')::double precision * 3600) $$;

create function pg_temp.fx_log(t0 timestamptz, a jsonb, k text) returns jsonb language sql
as $$ select coalesce(jsonb_agg(jsonb_build_object('t', pg_temp.fx_at(t0, e->0), k, e->1) order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

-- A rat log from the fixtures' [rat, from, to | null] entries (hours after t0).
create function pg_temp.fx_rats(t0 timestamptz, a jsonb) returns jsonb language sql
as $$ select coalesce(jsonb_agg(jsonb_build_object('r', e->0, 'from', pg_temp.fx_at(t0, e->1),
                                                   'to', case when e->2 = 'null' then null else pg_temp.fx_at(t0, e->2) end)
                                order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

-- A rice crop row from a crop-cases.json rat case (as the v15 smoke builds one), with its rat log.
create function pg_temp.fx_rice(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'rice', 'variety', k->>'variety',
  'prepared_at', t0, 'soak_at', pg_temp.fx_at(t0, k->'soak'), 'sow_at', pg_temp.fx_at(t0, k->'sow'),
  'transplant_at', pg_temp.fx_at(t0, k->'transplant'), 'q_transplant', k->'q_transplant',
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'), 'picks', '[]'::jsonb, 'pest_rolls', k->'pest_rolls',
  'rat_log', pg_temp.fx_rats(t0, k->'rats'))) $$;

-- A hoa-màu crop row from an upland-cases.json rat case (as the v15.2 smoke builds one), with its rat log.
create function pg_temp.fx_upcrop(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'upland', 'upland', k->>'upland',
  'prepared_at', t0, 'q_transplant', 1, 'picks', '[]'::jsonb, 'harvested_parts', 0, 'harvested_kg', 0,
  'sow_at', case when k->'sow' = 'null' then null else pg_temp.fx_at(t0, k->'sow') end,
  'plant_at', case when k->'plant' = 'null' then null else pg_temp.fx_at(t0, k->'plant') end,
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'work_log', pg_temp.fx_log(t0, k->'work', 'act'), 'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'),
  'harvests', '[]'::jsonb, 'pest_rolls', k->'pest_rolls', 'rat_log', pg_temp.fx_rats(t0, k->'rats'))) $$;

-- ---------- the catalog, the tables and the ledger (§8, §10.1, §10.2, C1) ----------
do $$
begin
  assert (select jsonb_agg(jsonb_build_array(id, kind, name, price, starter, sort_order) order by id)
            from public.shop_items where id in ('tool_sling', 'ammo_pellet', 'food_dog'))
         = '[["ammo_pellet", "ammo", "Đạn đất", 10, false, 10], ["food_dog", "pet_food", "Thức ăn chó", 150, false, 20],
             ["tool_sling", "tool", "Ná", 3000, false, 30]]', 'anh Hai''s three items (§8)';
  assert (select array_agg(m[1] order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
           where c.conname = 'shop_items_kind_check')
         = (select array_agg(x order by x) from unnest(array['rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide',
              'critter_box','tool','ammo','pet_food']) x), 'the kinds after 0019 (§16)';
  assert (select jsonb_object_agg(id, rat_food order by id) from public.upland_crops)
         = '{"bap": true, "khoai": true, "ot": false}', 'rat food: khoai and bắp, not ớt (D4)';
  -- the ledger: the 21 reasons in force after 0018 plus rat_sell and dog_adopt
  assert (select array_agg(m[1] order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
           where c.conname = 'coin_ledger_reason_check')
         = (select array_agg(x order by x) from unnest(array['daily','song','sell','buy','rent','land_buy','land_sell','land_refund',
              'lease_pay','lease_income','farm_buy','rice_sell','wipe','harvester','produce_sell','card_hold','card_settle',
              'card_buyin','card_cashout','card_refund','critter_sell','rat_sell','dog_adopt']) x), 'the 23 ledger reasons';
  assert pg_temp.err(format('insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (%L, 0, 0, %L, %L)',
                            gen_random_uuid(), 'foo', 'x')) like '%coin_ledger_reason_check%', 'foo is refused';
  -- the tables' checks
  assert pg_temp.err(format('insert into public.dogs (account_id, name, coat, adopted_at) values (%L, %L, %L, now())',
                            gen_random_uuid(), 'Ki', 'xam')) like '%dogs_coat_check%', 'four coats';
  assert pg_temp.err(format('insert into public.field_rats (room_id, plot_no, k, seed, spawned_at) values (%L, 11, 1, 1, now())',
                            gen_random_uuid())) like '%field_rats_plot_no_check%', 'plots 1–10';
  assert (select column_default = '''[]''::jsonb' and is_nullable = 'NO' from information_schema.columns
           where table_schema = 'public' and table_name = 'crops' and column_name = 'rat_log'), 'crops.rat_log';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'farm_profiles'
           and column_name in ('rat_win_start', 'rat_win_count', 'rat_day_on', 'rat_day_count')) = 4, 'the caps'' columns';
  -- private: RLS on, and the API roles cannot read the five tables
  assert (select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.field_rats'::regclass, 'public.rat_clocks'::regclass, 'public.rat_bag'::regclass,
                           'public.dogs'::regclass, 'public.sling_aims'::regclass)), 'RLS on';
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r,
                            unnest(array['public.field_rats', 'public.rat_clocks', 'public.rat_bag', 'public.dogs',
                                         'public.sling_aims']) tb
                      where has_table_privilege(r, tb, 'select') or has_table_privilege(r, tb, 'insert')), 'private tables';
  -- the helpers are private
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('_rat_u', '_rat_t', '_rat_k', '_rat_hours', '_rat_factor', '_rat_close', '_rat_food',
                                        '_pet_name', '_crop_yield', '_up_yield')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
end $$;

-- ---------- the spawn clock (§5.3, D1) ----------
do $$
declare room uuid := gen_random_uuid(); k0 bigint := floor(extract(epoch from now()) / 900)::bigint; k bigint;
        t timestamptz; prev timestamptz := null; gap double precision; lo double precision := 1e9; hi double precision := 0;
begin
  for k in k0 .. k0 + 999 loop
    t := public._rat_t(room, k);
    assert t = date_trunc('second', t), format('t(%s) is whole seconds: %s', k, t);
    assert t >= to_timestamp(k * 900) and t < to_timestamp(k * 900 + 300), format('t(%s) in its slot', k);
    assert public._rat_k(room, t) = k, format('k(t(%s))', k);
    assert public._rat_k(room, t - interval '1 second') = k - 1, format('k(t(%s) − 1 s)', k);
    if prev is not null then
      gap := extract(epoch from t - prev);
      lo := least(lo, gap);
      hi := greatest(hi, gap);
    end if;
    prev := t;
  end loop;
  assert lo >= 601 and hi <= 1199 and lo < 700 and hi > 1100, format('two candidates are 601–1 199 s apart: %s–%s', lo, hi);
  assert public._rat_u(room, k0, 't') >= 0 and public._rat_u(room, k0, 't') < 1
     and public._rat_u(room, k0, 't') <> public._rat_u(room, k0, 'p'), 'u in [0, 1), one draw per purpose';
end $$;

-- ---------- the damage against the shared fixtures (§5.5, §15) ----------
do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        v public.rice_varieties; y jsonb; f text; p jsonb; i int; n int := 0; np int := 0;
begin
  for k in select x from jsonb_array_elements(j->'rats') x loop
    n := n + 1;
    c := pg_temp.fx_rice(t0, k);
    v := public._variety(k->>'variety');
    y := public._crop_yield(c, v, (k->>'land')::double precision, (k->>'q_harvest')::double precision, pg_temp.fx_at(t0, k->'harvest'));
    assert (y->>'kg')::int = (k->'expect'->>'kg')::int, format('%s: kg %s, want %s', k->>'name', y->>'kg', k->'expect'->>'kg');
    foreach f in array array['mcare', 'mseed', 'mwater', 'mpest', 'mlate', 'mrat'] loop
      assert abs((y->>f)::double precision - (k->'expect'->>f)::double precision) < 1e-12,
        format('%s: %s %s, want %s', k->>'name', f, y->>f, k->'expect'->>f);
    end loop;
    assert public._crop_pests(c, v, pg_temp.fx_at(t0, k->'harvest')) = '[]', format('%s: no pests', k->>'name');
    -- a part cut while a rat eats pays part i of Y at its cut, Mrat included (v15.2 §6.1 as §16 amends it)
    i := 0;
    for p in select x from jsonb_array_elements(coalesce(k->'parts', '[]')) x loop
      i := i + 1;
      y := public._crop_yield(c, v, (k->>'land')::double precision, 1.0, pg_temp.fx_at(t0, p->0));
      assert public._part_kg(i, (y->>'kg')::int) = (p->>1)::int,
        format('%s: part %s at %s h, Y %s: %s kg, want %s', k->>'name', i, p->0, y->>'kg', public._part_kg(i, (y->>'kg')::int), p->1);
      np := np + 1;
    end loop;
  end loop;
  assert n = 4 and np = 6, format('%s rice rat cases, %s parts', n, np);
  -- by hand: R1 is 90 × 0.96 = 86.4 → 86 kg, R2 is 75 × 0.90 = 67.5 → 68 kg
  assert (select (e->'expect'->>'kg')::int from jsonb_array_elements(j->'rats') e where e->>'name' like 'R1,%') = 86
     and (select (e->'expect'->>'kg')::int from jsonb_array_elements(j->'rats') e where e->>'name' like 'R2,%') = 68, 'by hand';
end $$;

do $$
declare j jsonb := (select j from fxu); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        u public.upland_crops; y jsonb; f text; n int := 0;
begin
  for k in select x from jsonb_array_elements(j->'rats') x loop
    n := n + 1;
    c := pg_temp.fx_upcrop(t0, k);
    u := public._upland(k->>'upland');
    y := public._up_yield(c, u, (k->>'land')::double precision, (k->>'k')::int, pg_temp.fx_at(t0, k->'pick'));
    assert (y->>'kg')::int = (k->'expect'->>'kg')::int, format('%s: kg %s, want %s', k->>'name', y->>'kg', k->'expect'->>'kg');
    foreach f in array array['mcare', 'mplant', 'mwater', 'mrot', 'mpest', 'mlate', 'mrat'] loop
      assert abs((y->>f)::double precision - (k->'expect'->>f)::double precision) < 1e-12,
        format('%s: %s %s, want %s', k->>'name', f, y->>f, k->'expect'->>f);
    end loop;
  end loop;
  assert n = 2, format('%s hoa-màu rat cases', n);
end $$;

do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; e jsonb; h double precision; n int := 0;
begin
  for e in select x from jsonb_array_elements(j->'rat_edges') x loop
    n := n + 1;
    h := public._rat_hours(pg_temp.fx_rats(t0, e->'log'), pg_temp.fx_at(t0, e->'t'));
    assert h = (e->>'hours')::double precision, format('%s: %s h, want %s', e->>'name', h, e->>'hours');
    assert abs(public._rat_factor(h) - (e->>'mrat')::double precision) < 1e-12,
      format('%s: Mrat %s, want %s', e->>'name', public._rat_factor(h), e->>'mrat');
  end loop;
  assert n = 10, format('%s edges', n);
  assert public._rat_hours(null, now()) = 0, 'a crop row without a log';
  -- closing: the rat's open entry only, never before it opened
  assert public._rat_close('[{"r": 1, "from": "2026-03-01T00:00:00+00:00", "to": "2026-03-01T01:00:00+00:00"},
                             {"r": 2, "from": "2026-03-01T00:00:00+00:00", "to": null},
                             {"r": 3, "from": "2026-03-01T00:00:00+00:00", "to": null}]', 2, '2026-03-01 02:00+00')
         = '[{"r": 1, "from": "2026-03-01T00:00:00+00:00", "to": "2026-03-01T01:00:00+00:00"},
             {"r": 2, "from": "2026-03-01T00:00:00+00:00", "to": "2026-03-01T02:00:00+00:00"},
             {"r": 3, "from": "2026-03-01T00:00:00+00:00", "to": null}]', 'closes one entry';
  assert public._rat_close('[{"r": 4, "from": "2026-03-01T03:00:00+00:00", "to": null}]', 4, '2026-03-01 02:00+00')
         = '[{"r": 4, "from": "2026-03-01T03:00:00+00:00", "to": "2026-03-01T03:00:00+00:00"}]', 'never before it opened';
end $$;

-- ---------- rat food and the dog's name (§5.2, §7.1, D4, D20) ----------
do $$
declare t timestamptz := '2026-03-10 00:00:00+00'; c public.crops;
begin
  -- rice (short, s = 0.9): ripe from T + 43.2 h, overripe from T + 55.2 h
  c := jsonb_populate_record(null::public.crops, jsonb_build_object(
    'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'rice', 'variety', 'short',
    'prepared_at', t - interval '60 hours', 'soak_at', t - interval '60 hours', 'sow_at', t - interval '57 hours',
    'transplant_at', t - interval '48 hours', 'q_transplant', 1, 'harvested_parts', 2));
  assert public._rat_food(c, t - interval '5 hours') = false, 'ripening';
  assert public._rat_food(c, t), 'ripe, partly cut';
  assert public._rat_food(c, t + interval '8 hours'), 'overripe';
  c.harvester_at := t + interval '1 hour';
  assert public._rat_food(c, t) and not public._rat_food(c, t + interval '1 hour'), 'not once a harvester job has started';
  -- hoa màu: khoai and bắp ripe or overripe; ớt never; bare beds never
  c := jsonb_populate_record(null::public.crops, jsonb_build_object(
    'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'upland', 'upland', 'khoai',
    'prepared_at', t - interval '60 hours', 'plant_at', t - interval '50 hours', 'harvests', '[]'::jsonb));
  assert public._rat_food(c, t) and not public._rat_food(c, t - interval '3 hours'), 'khoai ripe at P + 48 h';
  c.upland := 'bap';
  assert public._rat_food(c, t + interval '11 hours') and not public._rat_food(c, t), 'bắp ripe at P + 60 h';
  c.upland := 'ot';
  c.sow_at := t - interval '70 hours';
  assert not exists (select 1 from generate_series(0, 120) h where public._rat_food(c, t + make_interval(hours => h))), 'ớt never';
  c.upland := null;
  c.plant_at := null;
  c.sow_at := null;
  assert not public._rat_food(c, t), 'bare beds';
  -- a dog's name: register's rules with 2–16 characters (lib/game/dog.ts dogNameRefusal refuses the same names)
  assert public._pet_name('Mực') = 'Mực' and public._pet_name('  Ki   Ki  ') = 'Ki Ki' and public._pet_name('Vàng Vện Đốm 16c') = 'Vàng Vện Đốm 16c'
     and public._pet_name('Ki') = 'Ki' and public._pet_name(U&'Mu\0301c') = 'Múc', 'accepted (NFC, trimmed, single spaces)';
  assert pg_temp.err('select public._pet_name(''M'')') = 'invalid name', '1 character';
  assert pg_temp.err('select public._pet_name(''Mười bảy ký tự nè'')') = 'invalid name', '17 characters';
  assert pg_temp.err('select public._pet_name(''Ao cá'')') = 'invalid name', 'a reserved name';
  assert pg_temp.err('select public._pet_name(''Hợp  tác  xã'')') = 'invalid name', 'a reserved name, spaced';
  assert pg_temp.err('select public._pet_name(''admin'')') = 'invalid name', 'admin';
  assert pg_temp.err(format('select public._pet_name(%L)', U&'\200B\200B')) = 'invalid name', 'zero-width';
  assert pg_temp.err(format('select public._pet_name(%L)', U&'Ki\200Bki')) = 'invalid name', 'a zero-width space inside';
  assert pg_temp.err(format('select public._pet_name(%L)', U&'Ki\00A0ki')) = 'invalid name', 'an odd space';
  assert pg_temp.err('select public._pet_name(null)') = 'invalid name', 'none';
end $$;

select 'v17 model smoke ok' as result;

-- ---------- the field: spawning, the rats' life, the damage, the catch and the view (§5.3–§5.6, §10.5) ----------
insert into smoke select 't1', token from public.register('rat_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('rat_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('rat_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a' || right(k, 1), public._auth_account(v)::text from smoke where k in ('t1', 't2', 't3');
insert into smoke select 'room', room_id::text from public.create_room('Mùa chuột', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'room2', room_id::text from public.create_room('Ruộng khó ăn', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'room3', room_id::text from public.create_room('Chuột chạy', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = r.v::uuid), 'pw', a.v)
  from smoke r, smoke a where r.k in ('room', 'room2', 'room3') and a.k in ('t2', 't3');
insert into smoke select 'now', date_trunc('minute', now())::text;

create function pg_temp.crop(r uuid, n integer) returns public.crops language sql
as $$ select * from public.crops where room_id = r and plot_no = n $$;
create function pg_temp.wet(a uuid) returns integer language sql
as $$ select coalesce((select sum(wet_kg)::int from public.rice_stock where account_id = a), 0) $$;
-- A rice crop on plot n, farmed by a, transplanted at tp and drained from tp + 40 h (short: ripe from tp + 43.2 h,
-- overripe from tp + 55.2 h, fallen at tp + 103.2 h).
create function pg_temp.rice(r uuid, n integer, a uuid, variety text, tp timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
      values (r, n, a, variety, tp - interval '12 hours', tp - interval '12 hours', tp - interval '9 hours', tp,
              jsonb_build_array(jsonb_build_object('t', tp - interval '12 hours', 'l', 3),
                                jsonb_build_object('t', tp + interval '40 hours', 'l', 1))) $$;
-- A hoa-màu crop on plot n, planted at p (khoai: ripe from p + 48 h; bắp: from p + 60 h; ớt: picking 1 from p + 46 h).
create function pg_temp.upland(r uuid, n integer, a uuid, u text, p timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, plant_at, water_log)
      values (r, n, a, 'upland', u, p - interval '12 hours', case when u = 'ot' then p - interval '11 hours' end, p,
              jsonb_build_array(jsonb_build_object('t', p - interval '12 hours', 'l', 1))) $$;
-- A live rat on plot n since t, with its entry in the crop's log (for rooms whose clock is off; its k is made up).
create temp sequence rat_k;
create function pg_temp.rat(r uuid, n integer, t timestamptz) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.field_rats (room_id, plot_no, k, seed, spawned_at) values (r, n, -nextval('rat_k'), 4242, t)
  returning id into v_id;
  update public.crops set rat_log = rat_log || jsonb_build_array(jsonb_build_object('r', v_id, 'from', t, 'to', null))
   where room_id = r and plot_no = n;
  return v_id;
end $$;
create function pg_temp.live(s jsonb) returns bigint[] language sql
as $$ select coalesce(array_agg((x->>'id')::bigint order by (x->>'id')::bigint), '{}') from jsonb_array_elements(s->'rats'->'live') x $$;
create function pg_temp.recent(s jsonb, id bigint) returns jsonb language sql
as $$ select x from jsonb_array_elements(s->'rats'->'recent') x where (x->>'id')::bigint = id $$;

-- Spawning (§5.3): at t(k) once a sweep runs after it; a late sweep looks back 30 minutes and its rats eat from that sweep;
-- last_k; one rat per (room, k); at most 3 alive.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; v_k bigint; tk timestamptz; t3 timestamptz;
        r public.field_rats; n integer;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform public._farm_do_rent(room, a1, 5, t);
  assert (select last_k from public.rat_clocks where room_id = room) = public._rat_k(room, t), 'the first sweep sets the clock';
  assert not exists (select 1 from public.field_rats where room_id = room), 'no crop, no rat';
  perform pg_temp.rice(room, 5, a1, 'short', t - interval '44 hours');
  v_k := public._rat_k(room, t) + 1;
  tk := public._rat_t(room, v_k);
  perform public._field_open(room, tk - interval '1 second');
  assert not exists (select 1 from public.field_rats where room_id = room), 'nothing before t(k)';
  perform public._field_open(room, tk);
  select * into r from public.field_rats where room_id = room;
  assert r.k = v_k and r.spawned_at = tk and r.plot_no = 5 and r.ended_at is null and r.how is null and r.caught_by is null
     and r.seed = floor(public._rat_u(room, v_k, 's') * 2147483647)::int, format('a rat at t(k): %s', to_jsonb(r));
  assert (pg_temp.crop(room, 5)).rat_log = jsonb_build_array(jsonb_build_object('r', r.id, 'from', tk, 'to', null)),
    'its entry opens at the sweep';
  -- 3 h later: only the candidates of the last 30 minutes, spawned at t(k) but eating from this sweep (D3)
  t3 := tk + interval '3 hours';
  perform public._field_open(room, t3);
  n := least(2, public._rat_k(room, t3) - public._rat_k(room, t3 - interval '1800 seconds'));
  assert (select count(*) from public.field_rats where room_id = room and id <> r.id) = n and n >= 1
     and not exists (select 1 from public.field_rats where room_id = room and id <> r.id
                      and (spawned_at <= t3 - interval '1800 seconds' or spawned_at > t3
                           or spawned_at <> public._rat_t(room, k))), format('the lookback: %s new', n);
  assert (select count(*) from jsonb_array_elements((pg_temp.crop(room, 5)).rat_log) e
           where (e->>'r')::bigint <> r.id and (e->>'from')::timestamptz = t3 and e->'to' = 'null') = n, 'found late: from this sweep';
  assert (select last_k from public.rat_clocks where room_id = room) = public._rat_k(room, t3), 'last_k = k(p_now)';
  -- last_k stops a second evaluation, and a re-evaluation keeps one rat per (room, k)
  perform public._field_open(room, t3);
  update public.rat_clocks set last_k = last_k - 10 where room_id = room;
  perform public._field_open(room, t3);
  assert (select count(*) from public.field_rats where room_id = room) = n + 1
     and jsonb_array_length((pg_temp.crop(room, 5)).rat_log) = n + 1, 'one rat per candidate';
  assert (select last_k from public.rat_clocks where room_id = room) = public._rat_k(room, t3), 'last_k is back';
  -- at most 3 alive
  perform public._field_open(room, t3 + interval '1 hour');
  assert (select count(*) from public.field_rats where room_id = room and ended_at is null) = 3, 'three alive';
  perform public._field_open(room, t3 + interval '2 hours');
  assert (select count(*) from public.field_rats where room_id = room) = 3, 'no fourth while three are alive';
  insert into smoke values ('t_room', (t3 + interval '2 hours')::text);
end $$;

-- Where no rat comes (§5.2, D4, D7): a crop with 20 rats in its life, a crop not yet ripe, a started harvester, ớt; a
-- far-future last_k spawns nothing and stays. Khoai and bắp do get rats.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        r public.field_rats;
begin
  perform pg_temp.set_coins(a3, 100000);
  perform public._field_open(room, t);
  update public.field_plots set owner_id = a2, owned_at = t where room_id = room and plot_no between 1 and 4;
  perform pg_temp.rice(room, 1, a2, 'short', t - interval '44 hours');
  update public.crops set rat_log = (select jsonb_agg(jsonb_build_object('r', -g, 'from', t - interval '3 hours', 'to', t - interval '2 hours'))
                                       from generate_series(1, 20) g)
   where room_id = room and plot_no = 1;
  perform pg_temp.rice(room, 2, a2, 'short', t - interval '30 hours');
  perform pg_temp.rice(room, 3, a2, 'short', t - interval '44 hours');
  update public.crops set harvester_at = t, harvester_until = t + interval '10 hours' where room_id = room and plot_no = 3;
  perform pg_temp.upland(room, 4, a2, 'ot', t - interval '47 hours');
  perform public._field_open(room, t + interval '1 hour');
  perform public._field_open(room, t + interval '2 hours');
  assert not exists (select 1 from public.field_rats where room_id = room), 'no rats for these crops';
  -- khoai: none while the clock is far in the future, which the sweep keeps
  perform public._farm_do_rent(room, a3, 5, t + interval '2 hours');
  perform pg_temp.upland(room, 5, a3, 'khoai', t - interval '47 hours');
  update public.rat_clocks set last_k = 9000000000000000000 where room_id = room;
  perform public._field_open(room, t + interval '3 hours');
  assert not exists (select 1 from public.field_rats where room_id = room)
     and (select last_k from public.rat_clocks where room_id = room) = 9000000000000000000, 'far-future last_k';
  update public.rat_clocks set last_k = public._rat_k(room, t + interval '3 hours') where room_id = room;
  perform public._field_open(room, t + interval '4 hours');
  assert exists (select 1 from public.field_rats where room_id = room)
     and not exists (select 1 from public.field_rats where room_id = room and plot_no <> 5), 'khoai gets rats';
  -- bắp, once the khoai is gone
  perform public._farm_do_abandon(room, a3, 5, t + interval '5 hours');
  perform public._farm_do_rent(room, a3, 6, t + interval '5 hours');
  perform pg_temp.upland(room, 6, a3, 'bap', t - interval '56 hours');
  perform public._field_open(room, t + interval '6 hours');
  assert exists (select 1 from public.field_rats where room_id = room and plot_no = 6 and ended_at is null)
     and not exists (select 1 from public.field_rats where room_id = room and plot_no = 5 and ended_at is null), 'bắp gets rats';
end $$;

-- The rats' life (§5.4, D5): the acting call's answer lists a rat whose crop is gone or no longer food as fled, the next
-- sweep ends it; a lease end, fallen rice, the harvester; the purge. Room 3's clock is off: its rats are placed by hand.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; s jsonb; x jsonb; y jsonb; v_kg integer; w0 integer;
        r6 bigint; r7 bigint; r5 bigint; r2 bigint; r5b bigint; r1 bigint;
begin
  perform public._field_open(room, t - interval '2 hours');
  update public.rat_clocks set last_k = 9000000000000000000 where room_id = room;
  perform pg_temp.set_coins(a1, 100000);
  perform pg_temp.set_coins(a2, 100000);
  perform pg_temp.set_coins(a3, 100000);
  perform pg_temp.give(a2, 'tool_sickle', 1);
  -- the sixth rice part: the answer lists the rat as fled; part 6 pays partKg(6, Y) with Mrat in Y
  perform public._farm_do_rent(room, a2, 6, t - interval '1 hour');
  perform pg_temp.rice(room, 6, a2, 'short', t - interval '44 hours');
  update public.crops set harvested_parts = 5, harvested_kg = 70 where room_id = room and plot_no = 6;
  r6 := pg_temp.rat(room, 6, t - interval '30 minutes');
  perform public._farm_do_begin_work(room, a2, 6, 'harvest', t);
  y := public._crop_yield(pg_temp.crop(room, 6), public._variety('short'), 1.0, 1.0, t + interval '8 seconds');
  assert (y->>'mrat')::double precision = public._rat_factor(public._hrs(t - interval '30 minutes', t + interval '8 seconds'))
     and (y->>'mrat')::double precision < 1, format('the rat counts in Y: %s', y);
  s := public._farm_do_harvest_part(room, a2, 6, true, t + interval '8 seconds');
  assert (s->'harvest_part'->>'kg')::int = public._part_kg(6, (y->>'kg')::int) and s->'harvest_part'->'done' = 'true',
    format('part 6 of Y %s: %s', y->>'kg', s->'harvest_part');
  x := pg_temp.recent(s, r6);
  assert x->>'how' = 'fled' and (x->>'ended_at')::timestamptz = t + interval '8 seconds' and x->'by' = 'null' and x->'dog' = 'null'
     and not (r6 = any(pg_temp.live(s))), format('fled in the answer: %s', x);
  assert (select ended_at is null from public.field_rats where id = r6), 'the row ends at the next sweep';
  perform public._field_open(room, t + interval '9 seconds');
  assert (select ended_at = t + interval '9 seconds' and how = 'fled' and caught_by is null from public.field_rats where id = r6), 'fled';
  -- a khoai picking
  perform public._farm_do_rent(room, a3, 7, t - interval '1 hour');
  perform pg_temp.upland(room, 7, a3, 'khoai', t - interval '49 hours');
  r7 := pg_temp.rat(room, 7, t - interval '1 hour');
  perform public._farm_do_begin_work(room, a3, 7, 'harvest', t);
  v_kg := (public._up_yield(pg_temp.crop(room, 7), public._upland('khoai'), 1.0, 1, t + interval '2 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a3, 7, 1, t + interval '2 seconds');
  assert (s->'harvest'->>'kg')::int = v_kg and v_kg < (public._up_yield(pg_temp.crop(room, 7), public._upland('khoai'), 1.0, 1, t - interval '1 hour')->>'kg')::int
     and pg_temp.recent(s, r7)->>'how' = 'fled' and not (r7 = any(pg_temp.live(s))), format('a picking: %s kg', v_kg);
  -- abandon
  perform public._farm_do_rent(room, a1, 5, t - interval '1 hour');
  perform pg_temp.rice(room, 5, a1, 'short', t - interval '44 hours');
  r5 := pg_temp.rat(room, 5, t - interval '10 minutes');
  s := public._farm_do_abandon(room, a1, 5, t + interval '10 seconds');
  assert pg_temp.recent(s, r5)->>'how' = 'fled' and not (r5 = any(pg_temp.live(s))), 'abandoned';
  perform public._field_open(room, t + interval '20 seconds');
  assert (select ended_at = t + interval '20 seconds' and how = 'fled' from public.field_rats where id = r5), 'fled at the next sweep';
  -- the answer lists a rat that ended in the last 10 s, then no more
  assert pg_temp.recent(public._field_view(room, a1, t + interval '29.999 seconds'), r5) is not null
     and pg_temp.recent(public._field_view(room, a1, t + interval '30 seconds'), r5) is null, 'recent: 10 s';
  -- the harvester: the answer lists the rat as fled; a sweep 10 s later ends it and closes its entry while the crop stays;
  -- step J at harvester_until counts the rat only up to that close
  update public.field_plots set owner_id = a2, owned_at = t where room_id = room and plot_no = 2;
  perform pg_temp.rice(room, 2, a2, 'short', t - interval '44 hours');
  r2 := pg_temp.rat(room, 2, t - interval '1 hour');
  s := public._farm_do_rent_harvester(room, a2, 2, t + interval '1 minute');
  assert pg_temp.recent(s, r2)->>'how' = 'fled' and not (r2 = any(pg_temp.live(s))), 'the harvester: fled in the answer';
  perform public._field_open(room, t + interval '70 seconds');
  assert (select ended_at = t + interval '70 seconds' from public.field_rats where id = r2)
     and (pg_temp.crop(room, 2)).rat_log->0->>'to' is not null
     and ((pg_temp.crop(room, 2)).rat_log->0->>'to')::timestamptz = t + interval '70 seconds', 'closed at that sweep; the crop stays';
  y := public._crop_yield(pg_temp.crop(room, 2), public._variety('short'), 1.1, 1.0, t + interval '90 seconds');
  assert (y->>'mrat')::double precision = public._rat_factor(public._hrs(t - interval '1 hour', t + interval '70 seconds')),
    format('Y counts the rat up to its close: %s', y);
  w0 := pg_temp.wet(a2);
  perform public._field_open(room, t + interval '91 seconds');
  assert pg_temp.wet(a2) = w0 + (y->>'kg')::int and pg_temp.crop(room, 2) is null, 'step J pays that Y';
  -- the purge: an hour after it ended
  perform public._field_open(room, t + interval '1 hour 20 seconds');
  assert exists (select 1 from public.field_rats where id = r5), 'kept for an hour';
  perform public._field_open(room, t + interval '1 hour 21 seconds');
  assert not exists (select 1 from public.field_rats where id = r5), 'purged after an hour';
  -- a lease end (step 1, then step 4) makes R1 flee the rat in the same sweep
  perform pg_temp.rice(room, 5, a1, 'short', t + interval '50 hours');
  r5b := pg_temp.rat(room, 5, t + interval '94 hours');
  perform public._field_open(room, t + interval '94 hours 1 minute');
  assert (select ended_at is null from public.field_rats where id = r5b), 'eating while the lease runs';
  perform public._field_open(room, t + interval '95 hours');
  assert (select ended_at = t + interval '95 hours' and how = 'fled' from public.field_rats where id = r5b)
     and pg_temp.crop(room, 5) is null, 'the lease ended: the crop is lost and the rat flees';
  -- fallen rice (step 6) too
  update public.field_plots set owner_id = a1, owned_at = t where room_id = room and plot_no = 1;
  perform pg_temp.rice(room, 1, a1, 'short', t);
  r1 := pg_temp.rat(room, 1, t + interval '100 hours');
  perform public._field_open(room, t + interval '104 hours');
  assert (select ended_at = t + interval '104 hours' and how = 'fled' from public.field_rats where id = r1)
     and pg_temp.crop(room, 1) is null, 'fallen rice: the rat flees';
end $$;

-- The catch (§5.6): room-bound, first valid catch wins, priced at floor(150 × M) with M from the room's index at the
-- catch, the entry closes and the bag gets it. The field shows the price a catch would fetch, and never writes the index.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; room2 uuid := (select v from smoke where k = 'room2')::uuid;
        t timestamptz := (select v from smoke where k = 't_room')::timestamptz; ids bigint[]; s jsonb; x jsonb; b0 integer;
begin
  select array_agg(id order by id) into ids from public.field_rats where room_id = room and ended_at is null;
  assert cardinality(ids) = 3, 'three live rats';
  -- a new period: the field shows the preview and writes no index row
  delete from public.fish_price_index where room_id = room;
  s := public._field_view(room, a2, t);
  assert (s->'rats'->>'price')::int = public._critter_price(150, public._fish_mult(public._room_wealth(room, t)))
     and not exists (select 1 from public.fish_price_index where room_id = room), 'the preview, no write';
  assert s->'rats'->'next_at' = to_jsonb(public._rat_t(room, public._rat_k(room, t) + 1))
     and (s->'rats'->>'next_at')::timestamptz > t, 'next_at: the next candidate';
  assert pg_temp.live(s) = ids and s->'rats'->'recent' = '[]'
     and s->'rats'->'live'->0 = (select jsonb_build_object('id', id, 'plot', plot_no, 'since', spawned_at, 'seed', seed)
                                   from public.field_rats where id = ids[1]), format('live %s', s->'rats'->'live');
  assert s->'rats'->'plots'->'5' = (pg_temp.crop(room, 5)).rat_log and s->'rats'->'plots'->'6' is null, 'the logs by plot';
  -- the catch writes the period's row: M 2.24 → 336
  perform pg_temp.set_mult(room, 2.24, t);
  perform public._wallet_lock(a2);
  assert public._rat_catch(room, a2, ids[1], 'sling', t) = 336, 'floor(150 × 2.24)';
  assert (select how = 'sling' and caught_by = a2 and price = 336 and ended_at = t from public.field_rats where id = ids[1])
     and exists (select 1 from jsonb_array_elements((pg_temp.crop(room, 5)).rat_log) e
                  where (e->>'r')::bigint = ids[1] and (e->>'to')::timestamptz = t)
     and exists (select 1 from public.rat_bag where account_id = a2 and price = 336 and caught_at = t and how = 'sling'),
    'ended, closed, bagged';
  -- first valid catch wins; bound to its room
  assert pg_temp.err(format('select public._rat_catch(%L, %L, %s, %L, %L)', room, a3, ids[1], 'dog', t)) = 'rat gone', 'caught already';
  assert pg_temp.err(format('select public._rat_catch(%L, %L, %s, %L, %L)', room2, a3, ids[2], 'sling', t)) = 'rat gone', 'another room';
  assert pg_temp.err(format('select public._rat_catch(%L, %L, null, %L, %L)', room, a3, 'sling', t)) = 'rat gone', 'no rat';
  -- M 1.13 → 169 (a rounding would give 170)
  update public.fish_price_index set mult = 1.13 where room_id = room;
  assert public._rat_catch(room, a2, ids[2], 'sling', t + interval '1 second') = 169, 'floor(150 × 1.13)';
  -- the answer's recent list, and what the bag holds
  s := public._field_view(room, a2, t + interval '2 seconds');
  x := pg_temp.recent(s, ids[1]);
  assert x->>'how' = 'sling' and x->'by' = public._who(a2) and x->'dog' = 'null' and (x->>'ended_at')::timestamptz = t
     and pg_temp.live(s) = array[ids[3]], format('recent %s', s->'rats'->'recent');
  assert public._farm_mine(a2)->'rats' = '{"count": 2, "value": 505}', format('the bag %s', public._farm_mine(a2)->'rats');
  assert public._farm_mine(a3)->'rats' = '{"count": 0, "value": 0}' and public._farm_mine(a3)->'dog' = 'null', 'an empty bag';
end $$;

-- The caps (§5.6, D13): 6 catches in an hourly window, 24 a Vietnam day; rat_daily_cap, soft, once.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t1 timestamptz := (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') + interval '1 hour') at time zone 'Asia/Ho_Chi_Minh';
        ids bigint[]; h integer; i integer; n integer := 0; e jsonb; c jsonb;
begin
  select array_agg(pg_temp.rat(room, 9, t1)) into ids from generate_series(1, 26);
  perform public._wallet_lock(a3);
  c := public._rat_caps_view(a3, t1);
  assert c = '{"day_left": 24, "hour_left": 6, "hour_resets_at": null}', format('full caps %s', c);
  for h in 0 .. 3 loop
    for i in 1 .. 6 loop
      n := n + 1;
      perform public._rat_catch(room, a3, ids[n], 'sling', t1 + make_interval(hours => h, secs => i));
    end loop;
    if h = 0 then
      e := pg_temp.errd(format('select public._rat_catch(%L, %L, %s, %L, %L)', room, a3, ids[25], 'sling', t1 + interval '7 seconds'));
      assert e->>'message' = 'rat limit' and e->>'state' = '53400' and e->>'detail' = '3594', format('the 7th in a window: %s', e);
      c := public._rat_caps_view(a3, t1 + interval '7 seconds');
      assert c = jsonb_build_object('day_left', 18, 'hour_left', 0, 'hour_resets_at', t1 + interval '1 hour 1 second'),
        format('caps after 6: %s', c);
      assert pg_temp.err(format('select public._rat_caps(%L, %L, false)', a3, t1 + interval '8 seconds')) = 'rat limit', 'a check';
    end if;
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = a3 and code = 'rat_daily_cap') = 1
     and (select outcome = 'soft' and rpc = 'sling_shoot' and room_id = room
                 and detail = jsonb_build_object('day', (t1 at time zone 'Asia/Ho_Chi_Minh')::date, 'count', 24)
            from public.anticheat_events where account_id = a3 and code = 'rat_daily_cap'), 'rat_daily_cap, soft, once';
  e := pg_temp.errd(format('select public._rat_catch(%L, %L, %s, %L, %L)', room, a3, ids[25], 'dog', t1 + interval '4 hours 1 second'));
  assert e->>'message' = 'rat daily limit' and e->>'state' = '53400' and e->>'detail' = '68399', format('the 25th of a day: %s', e);
  assert public._rat_caps_view(a3, t1 + interval '4 hours 1 second') = '{"day_left": 0, "hour_left": 6, "hour_resets_at": null}',
    'the day is used up';
  assert (select count(*) from public.rat_bag where account_id = a3) = 24
     and (select count(*) from public.anticheat_events where account_id = a3 and code = 'rat_daily_cap') = 1, 'nothing more';
  -- the next Vietnam day
  assert public._rat_catch(room, a3, ids[25], 'dog', t1 + interval '23 hours') > 0, 'a new day';
end $$;

select 'v17 field smoke ok' as result;

-- ---------- the RPCs: the slingshot, the dog, the sale and anh Hai's items (§6.1, §7.1, §7.2, §8, §10.4, §10.7) ----------
insert into smoke select 'room4', room_id::text from public.create_room('Bắn ná', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room4')::uuid), 'pw', v)
  from smoke where k in ('t2', 't3');
insert into smoke select 't4', token from public.register('rat_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a4', public._auth_account(v)::text from smoke where k = 't4';

-- The slingshot (§6.1, D14–D16): the refusals in their order, the 2 s and 60 s bounds, misses, hits and their prices,
-- and two hunters on one rat. Room 4's clock is off: its rats are placed by hand on a1's ripe plot.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room4')::uuid;
        room2 uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        ra bigint; rb bigint; rc bigint; rd bigint; s jsonb; m numeric;
begin
  perform public._field_open(room, t - interval '1 hour');
  update public.rat_clocks set last_k = 9000000000000000000 where room_id = room;
  perform pg_temp.set_coins(a1, 100000);
  perform public._farm_do_rent(room, a1, 5, t - interval '1 hour');
  perform pg_temp.rice(room, 5, a1, 'short', t - interval '44 hours');
  ra := pg_temp.rat(room, 5, t - interval '5 minutes');
  rb := pg_temp.rat(room, 5, t - interval '5 minutes');
  rc := pg_temp.rat(room, 5, t - interval '5 minutes');
  -- the aim: no sling, no pellets, rat gone, in that order
  delete from public.inventory where account_id = a2 and item_id in ('tool_sling', 'ammo_pellet');
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, 0, %L)', room, a2, t)) = 'no sling', 'no sling';
  perform pg_temp.give(a2, 'tool_sling', 1);
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, 0, %L)', room, a2, t)) = 'no pellets', 'no pellets';
  perform pg_temp.give(a2, 'ammo_pellet', 5);
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, 0, %L)', room, a2, t)) = 'rat gone', 'no such rat';
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, null, %L)', room, a2, t)) = 'rat gone', 'a null rat';
  s := public._rat_do_sling_start(room, a2, ra, t);
  assert s->'aim' = jsonb_build_object('rat', ra, 'started_at', t) and s->'rats'->'live' is not null
     and (select room_id = room and rat_id = ra and started_at = t and last_shot_at is null and shots = 0
            from public.sling_aims where account_id = a2), format('the aim %s', s->'aim');
  -- 2 s after the aim, then after each shot; a miss (or a null hit) uses a pellet
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room, a2, ra, t + interval '1.9 seconds'))
         = 'too fast', '1.9 s';
  s := public._rat_do_sling_shoot(room, a2, ra, false, t + interval '2 seconds');
  assert s->'shot' = '{"hit": false, "price": null, "pellets": 4}' and pg_temp.qty(a2, 'ammo_pellet') = 4
     and (select last_shot_at = t + interval '2 seconds' and shots = 1 from public.sling_aims where account_id = a2),
    format('a miss at 2.0 s: %s', s->'shot');
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, true, %L)', room, a2, ra, t + interval '3.9 seconds'))
         = 'too fast', 'from the previous shot';
  s := public._rat_do_sling_shoot(room, a2, ra, null, t + interval '4 seconds');
  assert s->'shot' = '{"hit": false, "price": null, "pellets": 3}'
     and not exists (select 1 from public.anticheat_events where account_id = a2 and rpc = 'sling_shoot'), 'null is a miss, unflagged';
  -- 60 s is the bound; another rat or another room has no aim
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room, a2, ra, t + interval '65 seconds'))
         = 'aim expired', '61 s idle';
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room, a2, rb, t + interval '6 seconds'))
         = 'no aim', 'another rat';
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room2, a2, ra, t + interval '6 seconds'))
         = 'no aim', 'another room';
  assert pg_temp.qty(a2, 'ammo_pellet') = 3, 'refusals use no pellet';
  -- a hit in a new period: the price of the preview, and the catch writes the row
  delete from public.fish_price_index where room_id = room;
  m := public._fish_mult(public._room_wealth(room, t + interval '6 seconds'));
  s := public._rat_do_sling_shoot(room, a2, ra, true, t + interval '6 seconds');
  assert s->'shot' = jsonb_build_object('hit', true, 'price', public._critter_price(150, m), 'pellets', 2)
     and (select mult = m from public.fish_price_index where room_id = room), format('a hit at M %s: %s', m, s->'shot');
  assert (select how = 'sling' and caught_by = a2 and ended_at = t + interval '6 seconds' from public.field_rats where id = ra)
     and not exists (select 1 from public.sling_aims where account_id = a2)
     and exists (select 1 from public.rat_bag where account_id = a2 and caught_at = t + interval '6 seconds')
     and s->'rats'->'recent'->0->>'how' = 'sling' and s->'rats'->'recent'->0->'by' = public._who(a2), 'caught, aim gone, bagged';
  -- M 2.24 → 336; and two hunters on one rat: the first valid hit wins
  perform pg_temp.set_mult(room, 2.24, t);
  -- a3 used up a day's catches above, on another Vietnam day: a clean slate
  update public.farm_profiles set rat_win_start = null, rat_win_count = 0, rat_day_on = null, rat_day_count = 0
   where account_id = a3;
  perform pg_temp.give(a3, 'tool_sling', 1);
  perform pg_temp.give(a3, 'ammo_pellet', 10);
  perform public._rat_do_sling_start(room, a2, rb, t + interval '7 seconds');
  perform public._rat_do_sling_start(room, a3, rb, t + interval '7 seconds');
  s := public._rat_do_sling_shoot(room, a3, rb, true, t + interval '10 seconds');
  assert (s->'shot'->>'price')::int = 336, 'floor(150 × 2.24)';
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, true, %L)', room, a2, rb, t + interval '10 seconds'))
         = 'rat gone', 'the second hunter';
  assert pg_temp.qty(a2, 'ammo_pellet') = 2 and exists (select 1 from public.sling_aims where account_id = a2 and rat_id = rb),
    'a refused hit uses no pellet';
  -- M 1.13 → 169 (a rounding would give 170)
  update public.fish_price_index set mult = 1.13 where room_id = room;
  perform public._rat_do_sling_start(room, a2, rc, t + interval '11 seconds');
  s := public._rat_do_sling_shoot(room, a2, rc, true, t + interval '14 seconds');
  assert s->'shot' = '{"hit": true, "price": 169, "pellets": 1}', format('floor(150 × 1.13): %s', s->'shot');
  -- the last pellet
  rd := pg_temp.rat(room, 5, t + interval '15 seconds');
  perform public._rat_do_sling_start(room, a2, rd, t + interval '15 seconds');
  perform public._rat_do_sling_shoot(room, a2, rd, false, t + interval '17 seconds');
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, true, %L)', room, a2, rd, t + interval '19 seconds'))
         = 'no pellets', 'out of pellets';
  insert into smoke values ('rd', rd::text);
end $$;

-- The dog (§7.1, §7.2): adoption and its refusals, food, the pounce, its rest, and a new name.
do $$
declare t3 text := (select v from smoke where k = 't3'); a3 uuid := (select v from smoke where k = 'a3')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room4')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; rd bigint := (select v from smoke where k = 'rd')::bigint;
        s jsonb; re bigint; x jsonb;
begin
  delete from public.dogs where account_id = a3;
  perform pg_temp.set_coins(a3, 19999);
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'M', 'x')) = 'invalid name', '1 character, before the coat';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Mười bảy ký tự nè', 'muc')) = 'invalid name', '17 characters';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Ao cá', 'muc')) = 'invalid name', 'Ao cá';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, U&'\200B\200B', 'muc')) = 'invalid name', 'zero-width';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Mực', 'x')) = 'invalid coat', 'coat x';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, null)', t3, 'Mực')) = 'invalid coat', 'no coat';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Mực', 'muc')) = 'not enough coins', '19 999 xu';
  perform pg_temp.set_coins(a3, 20000);
  s := public.adopt_dog(t3, '  Mực ', 'muc');
  assert s->'dog' = jsonb_build_object('name', 'Mực', 'coat', 'muc', 'adopted_at', s->'server_now',
                                       'fed_until', (s->>'server_now')::timestamptz + interval '24 hours', 'next_hunt_at', null,
                                       'catches', 0)
     and s->'food' = '0' and s->'coins' = '0', format('adopted, fed for 24 h: %s', s);
  assert exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'dog_adopt' and delta = -20000
                  and balance = 0 and ref = 'dog muc'), 'the dog_adopt row';
  perform pg_temp.set_coins(a3, 50000);
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Ki', 'vang')) = 'already own dog', 'one a person';
  assert public.dog_state(t3)->'dog'->>'name' = 'Mực' and public.dog_state(t3)->'coins' = '50000', 'dog_state';
  -- food: refused above 12 h; 24 h from max(now, fed_until); no food
  update public.dogs set fed_until = t + interval '12 hours 1 second' where account_id = a3;
  perform pg_temp.give(a3, 'food_dog', 2);
  assert pg_temp.err(format('select public._dog_do_feed(%L, %L)', a3, t)) = 'dog full', 'more than 12 h left';
  update public.dogs set fed_until = t + interval '11 hours' where account_id = a3;
  s := public._dog_do_feed(a3, t);
  assert (s->'dog'->>'fed_until')::timestamptz = t + interval '35 hours' and s->'food' = '1', 'from fed_until';
  update public.dogs set fed_until = t - interval '5 hours' where account_id = a3;
  s := public._dog_do_feed(a3, t);
  assert (s->'dog'->>'fed_until')::timestamptz = t + interval '24 hours' and s->'food' = '0', 'from now';
  update public.dogs set fed_until = t - interval '1 hour' where account_id = a3;
  assert pg_temp.err(format('select public._dog_do_feed(%L, %L)', a3, t)) = 'no item', 'no food';
  assert pg_temp.err(format('select public._dog_do_feed(%L, %L)', a1, t)) = 'no dog', 'no dog to feed';
  -- the pounce: hungry, then fed; a catch rests it 5 minutes (details = seconds)
  assert pg_temp.err(format('select public._dog_do_hunt(%L, %L, %s, %L)', room, a3, rd, t + interval '20 seconds')) = 'dog hungry', 'hungry';
  assert pg_temp.err(format('select public._dog_do_hunt(%L, %L, %s, %L)', room, a1, rd, t + interval '20 seconds')) = 'no dog', 'no dog';
  update public.dogs set fed_until = t + interval '20 hours' where account_id = a3;
  s := public._dog_do_hunt(room, a3, rd, t + interval '20 seconds');
  assert (s->'dog_hunt'->>'price')::int = 169 and (select how = 'dog' and caught_by = a3 from public.field_rats where id = rd)
     and (select next_hunt_at = t + interval '5 minutes 20 seconds' and catches = 1 from public.dogs where account_id = a3),
    format('the pounce %s', s->'dog_hunt');
  x := pg_temp.recent(s, rd);
  assert x->>'how' = 'dog' and x->>'dog' = 'Mực' and x->'by' = public._who(a3), format('recent %s', x);
  assert s->'mine'->'dog'->'catches' = '1' and s->'mine'->'rats'->'count' is not null, 'mine.dog';
  re := pg_temp.rat(room, 5, t + interval '30 seconds');
  assert pg_temp.errd(format('select public._dog_do_hunt(%L, %L, %s, %L)', room, a3, re, t + interval '1 minute'))
         = '{"message": "dog resting", "detail": "260", "state": "22023"}', 'resting, with the seconds';
  s := public._dog_do_hunt(room, a3, re, t + interval '5 minutes 20 seconds');
  assert (select catches = 2 from public.dogs where account_id = a3), 'rested';
  -- a new name: refused names, no dog, then free
  assert pg_temp.err(format('select public.rename_dog(%L, %L)', t3, 'X')) = 'invalid name', 'rename: 1 character';
  assert pg_temp.err(format('select public.rename_dog(%L, %L)', (select v from smoke where k = 't4'), 'Vện')) = 'no dog',
    'rename: no dog';
  s := public.rename_dog(t3, 'Ki Ki');
  assert s->'dog'->>'name' = 'Ki Ki' and (select coins from public.wallets where account_id = a3) = 50000, 'renamed, free';
  assert public.dog_state((select v from smoke where k = 't4')) = jsonb_build_object('server_now', now(), 'dog', null, 'food', 0,
                                                                                    'coins', 0), 'a fresh account';
end $$;

-- Room binding (§5.6): a live rat of another room, called through this one, is 'rat gone'; nothing changes.
do $$
declare t2 text := (select v from smoke where k = 't2'); t3 text := (select v from smoke where k = 't3');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; room4 uuid := (select v from smoke where k = 'room4')::uuid;
        rb bigint; p0 integer; b0 integer;
begin
  select id into rb from public.field_rats where room_id = room4 and ended_at is null order by id limit 1;
  if rb is null then
    rb := pg_temp.rat(room4, 5, now());
  end if;
  perform pg_temp.give(a2, 'ammo_pellet', 5);
  update public.dogs set fed_until = now() + interval '1 day', next_hunt_at = null where account_id = a3;
  delete from public.sling_aims where account_id = a2;
  p0 := pg_temp.qty(a2, 'ammo_pellet');
  b0 := (select count(*) from public.rat_bag where account_id in (a2, a3));
  assert pg_temp.err(format('select public.sling_start(%L, %L, %s)', room, t2, rb)) = 'rat gone', 'sling_start';
  insert into public.sling_aims (account_id, room_id, rat_id, started_at) values (a2, room, rb, now() - interval '5 seconds');
  assert pg_temp.err(format('select public.sling_shoot(%L, %L, %s, true)', room, t2, rb)) = 'rat gone', 'sling_shoot';
  assert pg_temp.err(format('select public.dog_hunt(%L, %L, %s)', room, t3, rb)) = 'rat gone', 'dog_hunt';
  assert (select ended_at is null from public.field_rats where id = rb) and pg_temp.qty(a2, 'ammo_pellet') = p0
     and (select shots = 0 and last_shot_at is null from public.sling_aims where account_id = a2)
     and (select next_hunt_at is null and catches = 2 from public.dogs where account_id = a3)
     and (select count(*) from public.rat_bag where account_id in (a2, a3)) = b0, 'nothing changed';
  delete from public.sling_aims where account_id = a2;
end $$;

-- cô Út buys the bag at its stored prices (§5.6, D12); anh Hai sells the three items (§8).
do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        n integer; xu integer; c0 integer; r jsonb;
begin
  select count(*)::int, sum(price)::int into n, xu from public.rat_bag where account_id = a2;
  assert n >= 3, format('a2 caught %s', n);
  c0 := (select coins from public.wallets where account_id = a2);
  r := public.sell_rats(t2);
  assert r->'sold' = jsonb_build_object('count', n, 'xu', xu) and r->'mine'->'coins' = to_jsonb(c0 + xu)
     and r->'mine'->'rats' = '{"count": 0, "value": 0}'
     and exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'rat_sell' and delta = xu and ref = n || ' con'),
    format('sold %s for %s: %s', n, xu, r->'sold');
  assert pg_temp.err(format('select public.sell_rats(%L)', t2)) = 'nothing to sell', 'an empty bag';
  -- the three items; the ná once, the stacks up to 99
  delete from public.inventory where account_id = a1 and item_id in ('tool_sling', 'ammo_pellet', 'food_dog');
  perform pg_temp.set_coins(a1, 10000);
  r := public.buy_farm_item(t1, 'tool_sling', 1);
  assert r->'mine'->'items'->'tool_sling' = '1' and r->'mine'->'coins' = '7000'
     and exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'farm_buy' and delta = -3000
                  and ref = 'tool_sling x1'), 'the ná for 3 000 xu';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t1, 'tool_sling')) = 'already owned', 'bought once';
  r := public.buy_farm_item(t1, 'ammo_pellet', 10);
  assert r->'mine'->'items'->'ammo_pellet' = '10' and r->'mine'->'coins' = '6900', '10 pellets for 100 xu';
  r := public.buy_farm_item(t1, 'food_dog', 2);
  assert r->'mine'->'items'->'food_dog' = '2' and r->'mine'->'coins' = '6600', 'two bags of food';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 90)', t1, 'ammo_pellet')) = 'invalid quantity', '99 at most';
  r := public.buy_farm_item(t1, 'ammo_pellet', 0);
  assert r->'anticheat'->>'code' = 'bad_qty', 'a quantity outside 1–99 stays hard';
  r := public.buy_farm_item(t1, 'rod_bamboo', 1);
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0', 'no fishing gear here';
  -- public and guarded; the twins private
  assert has_function_privilege('anon', 'public.sling_start(uuid,text,bigint)', 'execute')
     and has_function_privilege('anon', 'public.sling_shoot(uuid,text,bigint,boolean)', 'execute')
     and has_function_privilege('anon', 'public.dog_hunt(uuid,text,bigint)', 'execute')
     and has_function_privilege('anon', 'public.adopt_dog(text,text,text)', 'execute')
     and has_function_privilege('anon', 'public.rename_dog(text,text)', 'execute')
     and has_function_privilege('anon', 'public.feed_dog(text)', 'execute')
     and has_function_privilege('anon', 'public.sell_rats(text)', 'execute')
     and has_function_privilege('anon', 'public.dog_state(text)', 'execute'), 'public RPCs';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like '\_rat\_%' or p.proname like '\_dog\_%')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the twins and helpers are private';
end $$;

select 'v17 rpc smoke ok' as result;

\i tests/sql/anticheat-guards.sql
