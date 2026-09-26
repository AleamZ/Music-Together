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

\i tests/sql/anticheat-guards.sql
