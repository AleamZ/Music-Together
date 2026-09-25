-- tests/sql/v15-2-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0016 (see the plan),
-- from the repo root: it re-runs 0016 with \i, reads tests/fixtures/upland-cases.json and crop-cases.json with \copy,
-- and ends with tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
\set ON_ERROR_STOP on

-- The v15 smoke re-runs 0013 and the anti-cheat smoke re-runs 0015: both put back their own versions of functions 0016
-- re-creates, so 0016 runs again first.
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
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

-- ---------- the config and the model against the shared fixtures (§8, §16) ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/upland-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;
create temp table fxr_raw (n serial, line text);
\copy fxr_raw (line) from 'tests/fixtures/crop-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fxr as select string_agg(line, e'\n' order by n)::jsonb as j from fxr_raw;

-- A fixture time: hours, or [hours, seconds].
create function pg_temp.fx_at(t0 timestamptz, h jsonb) returns timestamptz language sql
as $$
  select t0 + make_interval(secs => case when jsonb_typeof(h) = 'array'
                                         then (h->>0)::double precision * 3600 + (h->>1)::double precision
                                         else (h #>> '{}')::double precision * 3600 end)
$$;

create function pg_temp.fx_log(t0 timestamptz, a jsonb, k text) returns jsonb language sql
as $$ select coalesce(jsonb_agg(jsonb_build_object('t', pg_temp.fx_at(t0, e->0), k, e->1) order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

-- A hoa-màu crop row from a fixture case.
create function pg_temp.fx_upcrop(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'upland', 'upland', k->>'upland',
  'prepared_at', t0, 'q_transplant', 1, 'picks', '[]'::jsonb, 'harvested_parts', 0, 'harvested_kg', 0,
  'sow_at', case when k->'sow' = 'null' then null else pg_temp.fx_at(t0, k->'sow') end,
  'plant_at', case when k->'plant' = 'null' then null else pg_temp.fx_at(t0, k->'plant') end,
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'work_log', pg_temp.fx_log(t0, k->'work', 'act'), 'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'),
  'harvests', (select coalesce(jsonb_agg(jsonb_build_object('t', pg_temp.fx_at(t0, e->0), 'k', e->1, 'kg', e->2) order by n),
                               '[]'::jsonb)
                 from jsonb_array_elements(k->'harvests') with ordinality w(e, n)),
  'pest_rolls', k->'pest_rolls')) $$;

-- A rice crop row from a crop-cases.json case (as the v15 smoke builds it).
create function pg_temp.fx_rice(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'variety', k->>'variety', 'prepared_at', t0,
  'soak_at', pg_temp.fx_at(t0, k->'soak'), 'sow_at', pg_temp.fx_at(t0, k->'sow'),
  'transplant_at', pg_temp.fx_at(t0, k->'transplant'), 'q_transplant', k->'q_transplant',
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'), 'picks', '[]'::jsonb, 'pest_rolls', k->'pest_rolls')) $$;

do $$
declare j jsonb := (select j from fx); u public.upland_crops; cr jsonb; cr2 jsonb; prev double precision; v_ids text[];
begin
  -- the seeded rows are the fixtures' config rows, verbatim
  assert (select jsonb_agg(to_jsonb(x) order by x.sort_order) from public.upland_crops x) = j->'crops',
    'upland_crops = the fixtures'' crops';
  -- the §8.2 seed checks
  for u in select * from public.upland_crops loop
    prev := -1;
    for cr in select x from jsonb_array_elements(u.stages) x loop
      assert (cr->>'until_h')::double precision > prev, format('%s: stages in order', u.id);
      assert cr->>'id' not in ('prepared', 'nursery', 'waiting', 'ripe', 'overripe', 'done'), format('%s: stage id %s', u.id, cr->>'id');
      prev := (cr->>'until_h')::double precision;
    end loop;
    assert (select sum(x::int) from jsonb_array_elements_text(u.pickings) x) = 100, format('%s: pickings sum to 100', u.id);
    assert (u.method = 'nursery') = (u.nursery_ready_h is not null and u.nursery_old_h is not null and u.transplant_label is not null),
      format('%s: nursery fields', u.id);
    assert (jsonb_array_length(u.pickings) > 1) = (u.pick_gap_h is not null), format('%s: the gap between pickings', u.id);
    for cr in select x from jsonb_array_elements(u.cares) x loop
      if cr->>'kind' = 'fert' then
        assert (cr->>'half_from_h')::double precision <= (cr->>'from_h')::double precision
           and (cr->>'to_h')::double precision < (cr->>'half_to_h')::double precision, format('%s: %s on time inside half', u.id, cr->>'id');
        assert not exists (select 1 from jsonb_array_elements((cr->'items') || (cr->'half_items')) i
                            where not exists (select 1 from public.shop_items s where s.id = i #>> '{}' and s.kind = 'fertilizer')),
          format('%s: %s items are fertilizers', u.id, cr->>'id');
        for cr2 in select x from jsonb_array_elements(u.cares) x where x->>'kind' = 'fert' and x->>'id' > cr->>'id' loop
          assert (cr->>'half_to_h')::double precision <= (cr2->>'half_from_h')::double precision
              or (cr2->>'half_to_h')::double precision <= (cr->>'half_from_h')::double precision,
            format('%s: %s and %s half regions overlap', u.id, cr->>'id', cr2->>'id');
        end loop;
      else
        assert cr->>'kind' = 'act' and cr->>'id' in ('lat_day', 'vun_goc'), format('%s: act %s', u.id, cr->>'id');
        assert (cr->>'half_from_h')::double precision = (cr->>'to_h')::double precision, format('%s: %s half starts at to_h', u.id, cr->>'id');
      end if;
    end loop;
    select array_agg(x->>'id') into v_ids from jsonb_array_elements(u.cares) x;
    assert cardinality(v_ids) = (select count(distinct x) from unnest(v_ids) x), format('%s: care ids unique', u.id);
    assert not exists (select 1 from jsonb_array_elements(u.pests) p
                        where not exists (select 1 from public.shop_items s where s.id = p->>'remedy' and s.kind = 'pesticide')),
      format('%s: remedies are pesticides', u.id);
    assert (select count(*) from public.shop_items s where s.kind = 'seed' and s.upland = u.id) = 1, format('%s: one seed', u.id);
  end loop;
  assert (select count(*) from public.upland_crops) = 3, 'three crops';
end $$;

do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops; u public.upland_crops;
        t timestamptz; want jsonb; got jsonb; care jsonb; f text; i int; n int := 0;
begin
  for k in select x from jsonb_array_elements((j->'cases') || (j->'edges')) x loop
    n := n + 1;
    c := pg_temp.fx_upcrop(t0, k);
    u := public._upland(k->>'upland');
    t := pg_temp.fx_at(t0, k->'pick');
    want := k->'expect';
    got := '{}'::jsonb;
    if want ? 'phase' then got := got || jsonb_build_object('phase', public._up_phase(c, u, t)); end if;
    if want ? 'next' then got := got || jsonb_build_object('next', public._up_next(c, u, t)); end if;
    if want ? 'water' then got := got || jsonb_build_object('water', public._water_at(c.water_log, t)); end if;
    if want ? 'off_hours' then got := got || jsonb_build_object('off_hours', public._up_off_hours(c, u, t)); end if;
    if want ? 'rot_hours' then got := got || jsonb_build_object('rot_hours', public._up_rot_hours(c, u, t)); end if;
    if want ?| array['scores', 'manure', 'phosphate', 'excess'] then
      care := public._up_care(c, u);
      got := got || jsonb_build_object('scores', care->'scores', 'manure', care->'manure', 'phosphate', care->'phosphate',
                                       'excess', care->'excess');
    end if;
    if want ? 'pests' then
      got := got || jsonb_build_object('pests', (
        select coalesce(jsonb_agg(jsonb_build_object('kind', p->>'kind',
                                                     'since_s', extract(epoch from (p->>'since')::timestamptz - t0)::int,
                                                     'treated_s', extract(epoch from (p->>'treated_at')::timestamptz - t0)::int)
                                  order by (p->>'slot')::int), '[]'::jsonb)
          from jsonb_array_elements(public._up_pests(c, u, t)) p));
    end if;
    if want ? 'transplant' then
      got := got || jsonb_build_object('transplant', public._up_phase(c, u, t) = 'nursery'
                                                     and t >= public._plus_h(c.sow_at, u.nursery_ready_h));
    end if;
    if want ? 'kg' then
      got := got || public._up_yield(c, u, (k->>'land')::double precision, (k->>'k')::int, t);
    end if;
    for f in select jsonb_object_keys(want) loop
      if f in ('mcare', 'mplant', 'mwater', 'mrot', 'mpest', 'mlate', 'off_hours', 'rot_hours') then
        assert abs((got->>f)::double precision - (want->>f)::double precision) < 1e-12,
          format('%s: %s %s, want %s', k->>'name', f, got->f, want->f);
      elsif f = 'scores' then
        assert jsonb_array_length(got->f) = jsonb_array_length(want->f), format('%s: scores %s, want %s', k->>'name', got->f, want->f);
        for i in 0 .. jsonb_array_length(want->f) - 1 loop
          assert abs((got->f->>i)::double precision - (want->f->>i)::double precision) < 1e-12,
            format('%s: scores %s, want %s', k->>'name', got->f, want->f);
        end loop;
      else
        assert got->f = want->f, format('%s: %s %s, want %s', k->>'name', f, got->f, want->f);
      end if;
    end loop;
  end loop;
  assert n = jsonb_array_length(j->'cases') + jsonb_array_length(j->'edges') and jsonb_array_length(j->'cases') = 11,
    format('%s fixtures', n);
end $$;

-- The rice parts (R5): part i pays _part_kg(i, Y) with Y the whole plot's yield at its cut.
do $$
declare j jsonb := (select j from fxr); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        v public.rice_varieties; p jsonb; i int; y int; n int := 0; s int; total int;
begin
  for k in select x from jsonb_array_elements(j->'cases') x where x ? 'parts' loop
    n := n + 1;
    c := pg_temp.fx_rice(t0, k);
    v := public._variety(k->>'variety');
    i := 0;
    for p in select x from jsonb_array_elements(k->'parts') x loop
      i := i + 1;
      y := (public._crop_yield(c, v, (k->>'land')::double precision, 1.0, pg_temp.fx_at(t0, p->0))->>'kg')::int;
      assert public._part_kg(i, y) = (p->>1)::int, format('%s: part %s at %s h, Y %s: %s kg, want %s', k->>'name', i, p->0, y,
                                                           public._part_kg(i, y), p->1);
    end loop;
    assert i = 6, format('%s: six parts', k->>'name');
  end loop;
  assert n = 2, 'two rice cases with parts';
  -- the six parts at a constant Y sum to Y, and after n parts the harvester pays exactly the rest
  assert (select array_agg(public._part_kg(g, 75) order by g) from generate_series(1, 6) g) = array[12, 13, 12, 13, 12, 13], 'Y = 75';
  assert (select array_agg(public._part_kg(g, 99) order by g) from generate_series(1, 6) g) = array[16, 17, 16, 17, 16, 17], 'Y = 99';
  assert (select array_agg(public._part_kg(g, 7) order by g) from generate_series(1, 6) g) = array[1, 1, 1, 1, 1, 2], 'Y = 7';
  for y in 6 .. 200 loop
    assert (select sum(public._part_kg(g, y)) from generate_series(1, 6) g) = y, format('six parts of %s', y);
    for s in 0 .. 5 loop
      select sum(public._part_kg(g, y)) into total from generate_series(s + 1, 6) g;
      assert y - (s * y) / 6 = total, format('the harvester after %s parts of %s', s, y);
    end loop;
  end loop;
end $$;

-- Tables, checks and privileges (§11.2).
do $$
declare a uuid;
begin
  insert into smoke select 't1', token from public.register('smoke152_a_' || floor(random() * 1e9)::text, 'pw123456');
  a := public._auth_account((select v from smoke where k = 't1'));
  insert into smoke values ('a1', a::text);
  -- the tank (R21): empty is (null, 0), loaded is (a pesticide, 1–3)
  insert into public.farm_profiles (account_id) values (a);
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a), 'an empty tank';
  update public.farm_profiles set tank_item = 'spray_insect', tank_charges = 3 where account_id = a;
  assert pg_temp.err(format('update public.farm_profiles set tank_charges = 0 where account_id = %L', a))
         like '%farm_profiles_tank_check%', '(item, 0) is refused';
  assert pg_temp.err(format('update public.farm_profiles set tank_item = null, tank_charges = 2 where account_id = %L', a))
         like '%farm_profiles_tank_check%', '(null, 2) is refused';
  assert pg_temp.err(format('update public.farm_profiles set tank_charges = 4 where account_id = %L', a))
         like '%farm_profiles_tank_check%', 'at most 3';
  -- a crop's kind and its cut parts
  assert pg_temp.err(format('insert into public.crops (room_id, plot_no, farmer_id, kind) values (%L, 1, %L, %L)',
                            gen_random_uuid(), a, 'field')) like '%crops_kind_check%', 'rice or upland';
  assert (select pg_get_constraintdef(oid) like '%harvested_parts >= 0%' and pg_get_constraintdef(oid) like '%harvested_parts <= 6%'
            from pg_constraint where conname = 'crops_parts_check'), 'parts 0–6';
  -- the ledger reasons keep 'wipe' (anti-cheat §11.3 rule 4) and add the harvester and the hoa-màu sale
  assert (select pg_get_constraintdef(oid) like '%''wipe''%' and pg_get_constraintdef(oid) like '%''harvester''%'
                 and pg_get_constraintdef(oid) like '%''produce_sell''%'
            from pg_constraint where conname = 'coin_ledger_reason_check'), 'ledger reasons';
  -- the items (§9)
  assert (select jsonb_agg(jsonb_build_array(id, kind, price, upland, sort_order) order by id) from public.shop_items
           where id in ('seed_khoai', 'seed_bap', 'seed_ot', 'tool_sickle', 'tool_sprayer'))
         = '[["seed_bap", "seed", 1000, "bap", 50], ["seed_khoai", "seed", 800, "khoai", 40], ["seed_ot", "seed", 1500, "ot", 60],
             ["tool_sickle", "tool", 1500, null, 10], ["tool_sprayer", "tool", 5000, null, 20]]', 'the five items';
  -- privileges: the config is public and read-only, the stock is private, the model is private
  assert has_table_privilege('anon', 'public.upland_crops', 'select') and has_table_privilege('authenticated', 'public.upland_crops', 'select')
     and not has_table_privilege('anon', 'public.upland_crops', 'insert, update, delete, truncate')
     and not has_table_privilege('authenticated', 'public.upland_crops', 'insert, update, delete, truncate'), 'upland_crops is read-only';
  assert not has_table_privilege('anon', 'public.produce_stock', 'select')
     and not has_table_privilege('authenticated', 'public.produce_stock', 'select'), 'produce_stock is private';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like '\_up\_%' or p.proname in ('_upland', '_part_kg', '_produce_add'))
                      and has_function_privilege('anon', p.oid, 'execute')), 'the model is private';
end $$;

-- A tank written with the check dropped reads (null, 0) once 0016 runs again, and the check is back.
alter table public.farm_profiles drop constraint farm_profiles_tank_check;
update public.farm_profiles set tank_item = 'spray_insect', tank_charges = 0 where account_id = (select v from smoke where k = 'a1')::uuid;
insert into smoke select 't2', token from public.register('smoke152_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into public.farm_profiles (account_id, tank_item, tank_charges)
select public._auth_account((select v from smoke where k = 't2')), null, 2;
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
reset client_min_messages;
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := public._auth_account((select v from smoke where k = 't2'));
begin
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a1), '(item, 0) → (null, 0)';
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a2), '(null, 2) → (null, 0)';
  assert exists (select 1 from pg_constraint where conname = 'farm_profiles_tank_check'), 'the check is back';
end $$;

select 'v15.2 model smoke ok' as result;

\i tests/sql/anticheat-guards.sql
