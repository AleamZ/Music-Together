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
  -- a config act is one tend_crop takes (its bad_work check), until a migration widens both (anti-cheat §11.3 rule 5)
  assert pg_temp.err(format('update public.upland_crops set cares = cares || %L::jsonb where id = %L',
                            '[{"id": "tia_la", "kind": "act", "name": "Tỉa lá"}]', 'khoai')) like '%upland_crops_acts_check%',
    'an act tend_crop refuses';
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
-- The gift's sickle for those who took the gift before 0016 (R4): g1 took it, g2 too and waits for its wipe, g3 took it
-- and was wiped, g4 never took it, g5 took it, was wiped and then pardoned (a pardon restores nothing), g6 was wiped,
-- pardoned, and only then took the gift.
insert into smoke select 'g1', public._auth_account(token)::text from public.register('smoke152_g1_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'g2', public._auth_account(token)::text from public.register('smoke152_g2_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'g3', public._auth_account(token)::text from public.register('smoke152_g3_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'g4', public._auth_account(token)::text from public.register('smoke152_g4_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'g5', public._auth_account(token)::text from public.register('smoke152_g5_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'g6', public._auth_account(token)::text from public.register('smoke152_g6_' || floor(random() * 1e9)::text, 'pw123456');
insert into public.farm_profiles (account_id, gift_at)
select v::uuid, case k when 'g4' then null when 'g5' then now() - interval '2 days' else now() - interval '1 day' end
  from smoke where k in ('g1', 'g2', 'g3', 'g4', 'g5', 'g6');
insert into public.anticheat_status (account_id, strikes, ban_state, banned_at, wiped_at)
select v::uuid, 2, case when k = 'g2' then 'pending_wipe' else 'wiped' end, now(), case when k = 'g3' then now() end
  from smoke where k in ('g2', 'g3');
-- a pardon lifts the ban and keeps the wipe's time (anti-cheat R11)
insert into public.anticheat_status (account_id, strikes, ban_state, banned_at, wiped_at, pardoned_at)
select v::uuid, 0, null, now() - interval '3 days',
       case when k = 'g5' then now() - interval '1 day' else now() - interval '2 days' end,
       case when k = 'g5' then now() - interval '12 hours' else now() - interval '36 hours' end
  from smoke where k in ('g5', 'g6');
create function pg_temp.sickles() returns jsonb language sql
as $$ select jsonb_object_agg(s.k, coalesce((select i.qty from public.inventory i where i.account_id = s.v::uuid and i.item_id = 'tool_sickle'), 0))
        from smoke s where s.k in ('g1', 'g2', 'g3', 'g4', 'g5', 'g6') $$;
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
reset client_min_messages;
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := public._auth_account((select v from smoke where k = 't2'));
begin
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a1), '(item, 0) → (null, 0)';
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a2), '(null, 2) → (null, 0)';
  assert exists (select 1 from pg_constraint where conname = 'farm_profiles_tank_check'), 'the check is back';
  -- one sickle for each account that took the gift, none for one wiped after it took the gift (pardoned or not) or one
  -- that never took it
  assert pg_temp.sickles() = '{"g1": 1, "g2": 1, "g3": 0, "g4": 0, "g5": 0, "g6": 1}', format('the backfill %s', pg_temp.sickles());
end $$;
-- a second run gives none more
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
reset client_min_messages;
do $$
begin
  assert pg_temp.sickles() = '{"g1": 1, "g2": 1, "g3": 0, "g4": 0, "g5": 0, "g6": 1}', format('the backfill run again %s', pg_temp.sickles());
end $$;

select 'v15.2 model smoke ok' as result;

-- ---------- the field (§6.4, §6.5, §11.6): the crop row, the checks, the views, the sweep ----------
insert into smoke select 't3', token from public.register('smoke152_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't4', token from public.register('smoke152_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'a4', public._auth_account((select v from smoke where k = 't4'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Nông cụ', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
  from smoke where k in ('t2', 't3', 't4');
insert into smoke select 'now', date_trunc('minute', now())::text;
create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.plot(s jsonb, n integer) returns jsonb language sql as $$ select s->'plots'->(n - 1) $$;
create function pg_temp.crop(r uuid, n integer) returns public.crops language sql
as $$ select * from public.crops where room_id = r and plot_no = n $$;
-- The work check of plot n's crop as it is now.
create function pg_temp.wc(r uuid, n integer, w text, t timestamptz) returns void language plpgsql as $$
declare c public.crops := pg_temp.crop(r, n);
begin
  perform public._work_check(c, public._variety(c.variety), w, t);
end $$;
-- A ripe nếp crop on plot n (transplanted 50 h before t, drained 5 h before t): ripe until t + 10 h.
create function pg_temp.ripe_nep(r uuid, n integer, a uuid, t timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
      values (r, n, a, 'nep', t - interval '64 hours', t - interval '63 hours', t - interval '60 hours', t - interval '50 hours',
              jsonb_build_array(jsonb_build_object('t', t - interval '64 hours', 'l', 3),
                                jsonb_build_object('t', t - interval '5 hours', 'l', 1))) $$;
-- The wet rice of an account.
create function pg_temp.wet(a uuid) returns integer language sql
as $$ select coalesce((select sum(wet_kg)::int from public.rice_stock where account_id = a), 0) $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; c jsonb;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform public._farm_do_rent(room, a1, 5, t);
  perform public._farm_do_rent(room, a1, 6, t);
  -- a rice round (§6.2): ripe, drained, and a sickle in the bag
  perform pg_temp.ripe_nep(room, 5, a1, t);
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t - interval '3 hours')) = 'wrong phase', 'not ripe';
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t)) = 'no sickle', 'a sickle';
  insert into public.inventory (account_id, item_id, qty) values (a1, 'tool_sickle', 1);
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t)) is null, 'a round may start';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t, 'l', 2))
   where room_id = room and plot_no = 5;
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t)) = 'need water', 'drained first';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t, 'l', 1))
   where room_id = room and plot_no = 5;
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'dig', t)) = 'invalid work', 'two works';
  -- the row is locked for the call; a partly cut plot takes a round but no care (R8); a running harvester takes nothing
  assert (select provolatile = 'v' from pg_proc where proname = '_farm_crop' and pronamespace = 'public'::regnamespace),
    '_farm_crop locks, so it is volatile';
  update public.crops set harvested_parts = 2, harvested_kg = 25 where room_id = room and plot_no = 5;
  assert (public._farm_crop(room, 5, a1, t)).harvested_parts = 2, 'a partly cut plot';
  assert pg_temp.err(format('select public._care_crop(%L, 5, %L, %L)', room, a1, t)) = 'harvesting', 'no care while cutting';
  update public.crops set harvester_at = t, harvester_until = t + interval '30 seconds' where room_id = room and plot_no = 5;
  assert pg_temp.err(format('select public._farm_crop(%L, 5, %L, %L)', room, a1, t)) = 'harvester busy', 'a running harvester';
  -- the view (§11.6): the kind, the parts and the harvester; the logs for the farmer only
  s := public._field_view(room, a1, t);
  c := pg_temp.plot(s, 5)->'crop';
  assert c->>'kind' = 'rice' and c->>'variety' = 'nep' and c->'upland' = 'null' and c->>'phase' = 'ripe' and c->'parts' = '2'
     and c->'picking' = 'null' and c->'pickings' = '1' and c->'plant_at' = 'null'
     and c->'harvester' = jsonb_build_object('started_at', t, 'ends_at', t + interval '30 seconds'), format('rice %s', c);
  assert c->'log'->'harvested_kg' = '25' and c->'log'->'work' = '[]' and c->'log'->'harvests' = '[]', format('the log %s', c->'log');
  assert pg_temp.plot(public._field_view(room, a3, t), 5)->'crop'->'log' is null, 'no log for a neighbour';

  -- beds on plot 6: nothing planted, then an ớt nursery
  insert into public.crops (room_id, plot_no, farmer_id, kind, prepared_at, water_log)
  values (room, 6, a1, 'upland', t, jsonb_build_array(jsonb_build_object('t', t, 'l', 1)));
  c := pg_temp.plot(public._field_view(room, a1, t), 6)->'crop';
  assert c->>'kind' = 'upland' and c->'upland' = 'null' and c->>'phase' = 'prepared' and c->'picking' = 'null'
     and c->'pickings' = '0' and c->'parts' = '0' and c->'harvester' = 'null' and c->'pests' = '[]' and c->'water' = '1',
    format('bare beds %s', c);
  update public.crops set upland = 'ot', sow_at = t,
         pest_rolls = '[{"slot": 1, "u_time": 0, "u_hit": 0.1}, {"slot": 2, "u_time": 0, "u_hit": 0.99}]'
   where room_id = room and plot_no = 6;
  c := pg_temp.plot(public._field_view(room, a1, t + interval '1 hour'), 6)->'crop';
  assert c->>'upland' = 'ot' and c->>'phase' = 'nursery' and c->'picking' = '1' and c->'pickings' = '3'
     and (c->>'sow_at')::timestamptz = t and c->'plant_at' = 'null', format('the nursery %s', c);
  assert pg_temp.plot(public._field_view(room, a1, t), 6)::text not like '%u_hit%', 'the rolls stay secret';
  -- the ớt transplant (§8.9): ≥ nursery_ready_h old, on an Ẩm bed
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '9 hours 59 minutes 59 seconds'))
         = 'wrong phase', 'the seedlings are too young';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '10 hours')) is null, 'ready';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '12 hours')) = 'need water',
    'the bed dried to Khô at 12 h';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '10 hours')) = 'wrong phase',
    'nothing to pick in the nursery';
  -- transplanted at 11 h: the pests fire from P, the view counts the pickings from P
  update public.crops set plant_at = t + interval '11 hours',
         water_log = water_log || jsonb_build_array(jsonb_build_object('t', t + interval '11 hours', 'l', 1))
   where room_id = room and plot_no = 6;
  c := pg_temp.plot(public._field_view(room, a1, t + interval '18 hours'), 6)->'crop';
  assert c->>'phase' = 'root' and c->'picking' = '1' and c->'pests' = jsonb_build_array(jsonb_build_object(
           'kind', 'thrips', 'since', t + interval '17 hours', 'treated_at', null)), format('ớt at 18 h %s', c);
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '18 hours')) = 'wrong phase',
    'transplanted once';
  -- a picking (§8.9): the next picking ready, the bed at most Ẩm
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t + interval '57 hours', 'l', 2))
   where room_id = room and plot_no = 6;
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '56 hours 59 minutes 59 seconds'))
         = 'wrong phase', 'R_1 − 1 s';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '57 hours')) = 'need water', 'Đẫm';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t + interval '57 hours', 'l', 1))
   where room_id = room and plot_no = 6;
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '57 hours')) is null, 'R_1';
  update public.crops set harvests = jsonb_build_array(jsonb_build_object('t', t + interval '57 hours', 'k', 1, 'kg', 24))
   where room_id = room and plot_no = 6;
  c := pg_temp.plot(public._field_view(room, a1, t + interval '58 hours'), 6)->'crop';
  assert c->>'phase' = 'waiting' and c->'picking' = '2' and c->'log'->'harvests'->0->'kg' = '24', format('after picking 1 %s', c);
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '58 hours')) = 'wrong phase', 'R_2';
end $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        m jsonb;
begin
  -- mine (§11.6): the tools, the hoa màu in stock and the tank (null without a sprayer)
  insert into public.produce_stock (account_id, upland, kg) values (a1, 'khoai', 180), (a1, 'bap', 0);
  m := public._farm_mine(a1);
  assert m->'items'->'tool_sickle' = '1' and m->'produce' = '{"khoai": 180}' and m->'tank' = 'null', format('mine %s', m);
  insert into public.inventory (account_id, item_id, qty) values (a1, 'tool_sprayer', 1);
  delete from public.farm_profiles where account_id = a1;
  assert public._farm_mine(a1)->'tank' = '{"item": null, "charges": 0}', 'a sprayer, no profile yet';
  insert into public.farm_profiles (account_id, tank_item, tank_charges) values (a1, 'spray_insect', 2);
  assert public._farm_mine(a1)->'tank' = '{"item": "spray_insect", "charges": 2}', 'a loaded tank';
end $$;

-- The sweep (§6.4): step J pays a finished harvester job; step 6 spares a running one and takes hoa màu whose last picking
-- is lost, leaving the lease.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a4 uuid := (select v from smoke where k = 'a4')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; y integer; w0 integer;
begin
  -- plot 5 (a1): 2 of 6 parts cut by hand at a constant Y, then the harvester, from t to t + 30 s
  y := (public._crop_yield(pg_temp.crop(room, 5), public._variety('nep'), 1.0, 1.0, t + interval '30 seconds')->>'kg')::int;
  delete from public.rice_stock where account_id = a1;
  perform public._rice_add(a1, 'nep', public._part_kg(1, y) + public._part_kg(2, y), 0);
  w0 := pg_temp.wet(a1);
  perform public._field_open(room, t + interval '29 seconds');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 5) and pg_temp.wet(a1) = w0, 'still cutting';
  perform public._field_open(room, t + interval '30 seconds');
  assert pg_temp.wet(a1) = w0 + y - (2 * y) / 6, format('the machine pays the 4 parts left: %s + %s', w0, y - (2 * y) / 6);
  assert pg_temp.wet(a1) = y, 'hand plus machine is exactly Y';
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 5)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 5), 'the harvest ends the lease';
  perform public._field_open(room, t + interval '31 seconds');
  assert pg_temp.wet(a1) = y, 'paid once';

  -- plot 7 (a4, wiped during the job): the job is not paid (R10), the crop goes
  perform pg_temp.set_coins(a4, 20000);
  perform public._farm_do_rent(room, a4, 7, t);
  perform pg_temp.ripe_nep(room, 7, a4, t);
  update public.crops set harvester_at = t, harvester_until = t + interval '30 seconds' where room_id = room and plot_no = 7;
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a4, 2, 'pending_wipe', now());
  perform public._ac_wipe(a4, null);
  perform public._field_open(room, t + interval '30 seconds');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 7) and pg_temp.wet(a4) = 0, 'a wiped farmer is not paid';

  -- plot 8 (a2): rice past its fall time is spared while a harvester runs, and paid at its end
  perform pg_temp.set_coins(a2, 20000);
  perform public._farm_do_rent(room, a2, 8, t);
  perform pg_temp.ripe_nep(room, 8, a2, t - interval '60 hours');
  update public.crops set harvester_at = t - interval '10 seconds', harvester_until = t + interval '20 seconds'
   where room_id = room and plot_no = 8;
  perform public._field_open(room, t);
  assert exists (select 1 from public.crops where room_id = room and plot_no = 8), 'a running harvester keeps fallen rice';
  perform public._field_open(room, t + interval '20 seconds');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 8) and pg_temp.wet(a2) > 0, 'paid at its end';

  -- plot 9 (a2): khoai whose only picking is lost at L_1 = P + 108 h; the lease stays (R26)
  perform public._farm_do_rent(room, a2, 9, t);
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
  values (room, 9, a2, 'upland', 'khoai', t - interval '109 hours', t - interval '108 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '109 hours', 'l', 1)));
  perform public._field_open(room, t - interval '1 second');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 9), 'L_1 − 1 s';
  perform public._field_open(room, t);
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 9)
     and exists (select 1 from public.plot_leases where room_id = room and plot_no = 9), 'lost at L_1; the lease stays';

  -- step 0 stays 0015's: an owner banned by hand leaves the land market
  update public.field_plots set owner_id = a2, owned_at = t - interval '1 day', sale_price = 9000, sublease_price = 300
   where room_id = room and plot_no = 2;
  update public.accounts set is_banned = true where id = a2;
  perform public._field_open(room, t);
  assert (select owner_id = a2 and sale_price is null and sublease_price is null from public.field_plots
           where room_id = room and plot_no = 2), 'a ban set by hand withdraws the listing and the sublease';
  update public.accounts set is_banned = false where id = a2;
end $$;

select 'v15.2 field smoke ok' as result;

-- ---------- the rice harvest (§6.1–§6.5) and the hoa-màu pickings (§8.9), in room 'Gặt lúa' ----------
insert into smoke select 'room3', room_id::text from public.create_room('Gặt lúa', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room3')::uuid), 'pw', v)
  from smoke where k in ('t2', 't3');
-- The hoa màu of an account.
create function pg_temp.produce(a uuid, u text) returns integer language sql
as $$ select coalesce((select kg from public.produce_stock where account_id = a and upland = u), 0) $$;

-- A hand harvest (§6.2, R5–R8): the 8 s gate, the 120 s window, a replaced or forgotten round, failures, six parts.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room3')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; y integer; w0 integer;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform pg_temp.set_coins(a2, 100000);
  perform public._farm_do_rent(room, a1, 5, t);
  perform pg_temp.ripe_nep(room, 5, a1, t);
  perform public._farm_do_rent(room, a2, 7, t);
  perform pg_temp.ripe_nep(room, 7, a2, t);
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a2, 'harvest', t)) = 'no sickle',
    'a round needs a sickle';
  y := (public._crop_yield(pg_temp.crop(room, 5), public._variety('nep'), 1.0, 1.0, t)->>'kg')::int;
  w0 := pg_temp.wet(a1);
  -- part 1, at least 8 s after its begin_work
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t)) = 'too fast', 'no round';
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t);
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '7.9 seconds'))
         = 'too fast', '7.9 s';
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '8 seconds');
  assert s->'harvest_part' = jsonb_build_object('variety', 'nep', 'kg', y / 6, 'parts', 1, 'total', y / 6, 'done', false)
     and pg_temp.wet(a1) = w0 + y / 6, format('part 1 pays Y / 6 of %s: %s', y, s->'harvest_part');
  assert pg_temp.plot(s, 5)->'crop'->'parts' = '1' and (pg_temp.crop(room, 5)).work is null, 'a part clears the round';
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '9 seconds'))
         = 'too fast', 'every part needs its own round';
  -- no care while partly cut (R8)
  assert pg_temp.err(format('select public._farm_do_fertilize(%L, %L, 5, %L, %L)', room, a1, 'fert_urea', t + interval '10 seconds'))
         = 'harvesting', 'no fertilizer';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 5, -1, %L)', room, a1, t + interval '10 seconds'))
         = 'harvesting', 'no water';
  assert pg_temp.err(format('select public._farm_do_pick_snails(%L, %L, 5, %L)', room, a2, t + interval '10 seconds'))
         = 'harvesting', 'no snail picking';
  -- the 120 s window (R6)
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '1 minute');
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '3 minutes');
  assert s->'harvest_part'->'parts' = '2', 'a claim at 120 s';
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '4 minutes');
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '6 minutes 1 second'))
         = 'work expired', 'a claim at 121 s';
  -- a second begin_work restarts the gate
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '7 minutes');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '7 minutes 5 seconds');
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '7 minutes 9 seconds'))
         = 'too fast', '9 s after the first, 4 s after the second';
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '7 minutes 13 seconds');
  assert s->'harvest_part'->'parts' = '3', '8 s after the second';
  -- an Esc or a disconnect leaves a record that blocks nothing
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '10 minutes');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '13 minutes 20 seconds');
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '13 minutes 28 seconds');
  assert s->'harvest_part'->'parts' = '4', 'a new round 200 s later';
  -- a failed round (false, or null) cuts nothing, clears the record and has no gate (R7)
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '20 minutes');
  s := public._farm_do_harvest_part(room, a1, 5, false, t + interval '20 minutes 1 second');
  assert s->'harvest_part' is null and pg_temp.plot(s, 5)->'crop'->'parts' = '4' and (pg_temp.crop(room, 5)).work is null,
    'a failure';
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '21 minutes');
  s := public._farm_do_harvest_part(room, a1, 5, null, t + interval '21 minutes 1 second');
  assert s->'harvest_part' is null and (pg_temp.crop(room, 5)).work is null and (pg_temp.crop(room, 5)).harvested_parts = 4,
    'null is a failure';
  assert pg_temp.wet(a1) = w0 + (4 * y) / 6 and (pg_temp.crop(room, 5)).harvested_kg = (4 * y) / 6, 'four parts so far';
  -- parts 5 and 6: the sixth completes the harvest and ends the lease
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '22 minutes');
  perform public._farm_do_harvest_part(room, a1, 5, true, t + interval '22 minutes 8 seconds');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '23 minutes');
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '23 minutes 8 seconds');
  assert s->'harvest_part' = jsonb_build_object('variety', 'nep', 'kg', public._part_kg(6, y), 'parts', 6, 'total', y, 'done', true),
    format('part 6 %s', s->'harvest_part');
  assert pg_temp.wet(a1) = w0 + y, 'six parts at a constant Y sum to Y';
  assert pg_temp.plot(s, 5)->'crop' = 'null' and pg_temp.plot(s, 5)->'lease' = 'null', 'bare, and the lease ended';
end $$;

-- Work must fit in the lease (R11): 25 s for a round, 30 s for the harvester. A round the lease cuts short pays nothing.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; l timestamptz := t + interval '1 hour';
        y integer; w0 integer;
begin
  perform public._farm_do_rent(room, a1, 6, t);
  perform pg_temp.ripe_nep(room, 6, a1, t);
  update public.plot_leases set until = l where room_id = room and plot_no = 6;
  w0 := pg_temp.wet(a1);
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 6, %L, %L)', room, a1, 'harvest', l - interval '24 seconds'))
         = 'lease ending', '24 s left';
  perform public._farm_do_begin_work(room, a1, 6, 'harvest', l - interval '25 seconds');
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 6, %L)', room, a1, l - interval '29 seconds'))
         = 'lease ends', 'the harvester needs 30 s';
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 6, true, %L)', room, a1, l + interval '1 second'))
         = 'not your plot', 'the lease ran out mid-round';
  perform public._field_open(room, l + interval '1 second');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 6)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 6) and pg_temp.wet(a1) = w0,
    'the crop went with the lease; no rice';
  -- a harvester rented with 30 s left ends with the lease: step J pays before step 1 ends the lease
  perform public._farm_do_rent(room, a1, 6, l + interval '1 minute');
  perform pg_temp.ripe_nep(room, 6, a1, l);
  l := l + interval '10 minutes';
  update public.plot_leases set until = l where room_id = room and plot_no = 6;
  y := (public._crop_yield(pg_temp.crop(room, 6), public._variety('nep'), 1.0, 1.0, l)->>'kg')::int;
  perform public._farm_do_rent_harvester(room, a1, 6, l - interval '30 seconds');
  perform public._field_open(room, l);
  assert pg_temp.wet(a1) = w0 + y and not exists (select 1 from public.crops where room_id = room and plot_no = 6)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 6), 'paid in the lease''s last second';
end $$;

-- The harvester (§6.3, §6.4, R9, R32): its checks in order, a pro-rated price, busy while it runs, paid once at its end.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room3')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        t2 timestamptz := t + interval '2 hours'; s jsonb; y integer; w0 integer; c0 integer;
begin
  -- plot 7 (a2, no sickle): a whole plot for 3 000 xu
  perform public._farm_do_rent(room, a2, 8, t2);
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 11, %L)', room, a2, t2)) = 'invalid plot', 'plot 11';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a1, t2)) = 'not your plot', 'a2''s plot';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 8, %L)', room, a2, t2)) = 'not prepared', 'no crop';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t - interval '3 hours'))
         = 'wrong phase', 'still ripening';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t2, 'l', 2))
   where room_id = room and plot_no = 7;
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2)) = 'need water', 'drain first';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t2, 'l', 1))
   where room_id = room and plot_no = 7;
  update public.crops set harvested_parts = 6 where room_id = room and plot_no = 7;
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2)) = 'wrong phase',
    'nothing left to cut';
  update public.crops set harvested_parts = 0 where room_id = room and plot_no = 7;
  perform pg_temp.set_coins(a2, 2999);
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2)) = 'not enough coins',
    '500 xu a part';
  perform pg_temp.set_coins(a2, 3000);
  y := (public._crop_yield(pg_temp.crop(room, 7), public._variety('nep'), 1.0, 1.0, t2 + interval '30 seconds')->>'kg')::int;
  w0 := pg_temp.wet(a2);
  s := public._farm_do_rent_harvester(room, a2, 7, t2);
  assert pg_temp.plot(s, 7)->'crop'->'harvester' = jsonb_build_object('started_at', t2, 'ends_at', t2 + interval '30 seconds')
     and s->'mine'->'coins' = '0', format('rented %s', pg_temp.plot(s, 7)->'crop'->'harvester');
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'harvester' and delta = -3000 and ref = 'plot 7'),
    'the ledger row';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2 + interval '1 second'))
         = 'harvester busy', 'one job at a time';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a2, 'harvest', t2 + interval '1 second'))
         = 'harvester busy', 'no round';
  assert pg_temp.err(format('select public._farm_do_fertilize(%L, %L, 7, %L, %L)', room, a2, 'fert_urea', t2 + interval '1 second'))
         = 'harvester busy', 'no care';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 7, -1, %L)', room, a2, t2 + interval '1 second'))
         = 'harvester busy', 'no water';
  assert pg_temp.err(format('select public._farm_do_pick_snails(%L, %L, 7, %L)', room, a1, t2 + interval '1 second'))
         = 'harvester busy', 'no snail picking';
  assert pg_temp.err(format('select public._farm_do_abandon(%L, %L, 7, %L)', room, a2, t2 + interval '1 second'))
         = 'harvester busy', 'no abandon';
  perform public._field_open(room, t2 + interval '29 seconds');
  assert pg_temp.wet(a2) = w0 and exists (select 1 from public.crops where room_id = room and plot_no = 7), 'still cutting';
  perform public._field_open(room, t2 + interval '30 seconds');
  assert pg_temp.wet(a2) = w0 + y and not exists (select 1 from public.crops where room_id = room and plot_no = 7)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 7), format('the machine cut %s kg', y);

  -- plot 5 (a1): two parts by hand, then the machine for the four left (2 000 xu); a round begun before the rent pays nothing
  perform public._farm_do_rent(room, a1, 5, t2);
  perform pg_temp.ripe_nep(room, 5, a1, t2);
  y := (public._crop_yield(pg_temp.crop(room, 5), public._variety('nep'), 1.0, 1.0, t2 + interval '1 minute')->>'kg')::int;
  w0 := pg_temp.wet(a1);
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t2);
  perform public._farm_do_harvest_part(room, a1, 5, true, t2 + interval '8 seconds');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t2 + interval '10 seconds');
  perform public._farm_do_harvest_part(room, a1, 5, true, t2 + interval '18 seconds');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t2 + interval '20 seconds');
  c0 := (select coins from public.wallets where account_id = a1);
  s := public._farm_do_rent_harvester(room, a1, 5, t2 + interval '22 seconds');
  assert s->'mine'->'coins' = to_jsonb(c0 - 2000) and (pg_temp.crop(room, 5)).work is null
     and exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'harvester' and delta = -2000 and ref = 'plot 5'),
    'four parts left: 2 000 xu, and the round is cleared';
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t2 + interval '29 seconds'))
         = 'harvester busy' and pg_temp.wet(a1) = w0 + (2 * y) / 6, 'no hand part during the job';
  perform public._field_open(room, t2 + interval '52 seconds');
  assert pg_temp.wet(a1) = w0 + y and not exists (select 1 from public.crops where room_id = room and plot_no = 5)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 5), 'hand plus machine is exactly Y';
  perform public._field_open(room, t2 + interval '1 minute');
  assert pg_temp.wet(a1) = w0 + y, 'paid once';
end $$;

-- Pickings (§8.9, R16, R26): no rounds and no harvester on beds; a picking or a transplant needs 5 s on the lease; a
-- lease that runs out takes the pickings left, and the stock keeps the ones taken.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room3')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        t6 timestamptz := t + interval '6 hours'; s jsonb; kg integer;
begin
  -- plot 8 (a2): khoai planted 42 h before t, ripe at t6 (R_1 = P + 48 h), on dry beds
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
  values (room, 8, a2, 'upland', 'khoai', t - interval '43 hours', t - interval '42 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '43 hours', 'l', 1)));
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 8, true, %L)', room, a2, t6)) = 'wrong crop',
    'no rounds on beds';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 8, %L)', room, a2, t6)) = 'wrong crop',
    'no harvester for hoa màu';
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 8, 1, %L)', room, a2, t6)) = 'too fast', 'the action first';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', t6 - interval '1 second'))
         = 'wrong phase', 'R_1 − 1 s';
  update public.plot_leases set until = t6 + interval '1 minute' where room_id = room and plot_no = 8;
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', t6 + interval '56 seconds'))
         = 'lease ending', '4 s left';
  perform public._farm_do_begin_work(room, a2, 8, 'harvest', t6 + interval '55 seconds');
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 8, 1, %L)', room, a2, t6 + interval '56 seconds'))
         = 'too fast', 'the 2 s gate';
  kg := (public._up_yield(pg_temp.crop(room, 8), public._upland('khoai'), 1.0, 1, t6 + interval '57 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a2, 8, 5.0, t6 + interval '57 seconds');
  assert s->'harvest' = jsonb_build_object('upland', 'khoai', 'kg', kg, 'k', 1, 'pickings', 1, 'done', true)
     and s->'mine'->'produce' = jsonb_build_object('khoai', kg) and pg_temp.produce(a2, 'khoai') = kg,
    format('dug %s kg, quality ignored: %s', kg, s->'harvest');
  assert pg_temp.plot(s, 8)->'crop' = 'null' and pg_temp.plot(s, 8)->'lease' = 'null', 'the last picking ends the lease';

  -- plot 10 (a3): an ớt nursery, ready since t6 − 1 h; its transplant needs 5 s on the lease
  perform pg_temp.set_coins(a3, 100000);
  perform public._farm_do_rent(room, a3, 10, t6);
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, water_log)
  values (room, 10, a3, 'upland', 'ot', t6 - interval '12 hours', t6 - interval '11 hours',
          jsonb_build_array(jsonb_build_object('t', t6 - interval '12 hours', 'l', 1), jsonb_build_object('t', t6, 'l', 1)));
  update public.plot_leases set until = t6 + interval '1 minute' where room_id = room and plot_no = 10;
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 10, %L, %L)', room, a3, 'transplant',
                            t6 + interval '56 seconds')) = 'lease ending', 'a transplant with 4 s left';
  perform public._farm_do_begin_work(room, a3, 10, 'transplant', t6 + interval '55 seconds');
  perform public._field_open(room, t6 + interval '1 minute');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 10), 'the nursery went with the lease';

  -- plot 10 again: ớt planted 46 h before t6, so picking 1 is ripe at t6 and picking 2 at t6 + 12 h
  perform public._farm_do_rent(room, a3, 10, t6 + interval '2 minutes');
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, plant_at, water_log)
  values (room, 10, a3, 'upland', 'ot', t6 - interval '60 hours', t6 - interval '58 hours', t6 - interval '46 hours',
          jsonb_build_array(jsonb_build_object('t', t6 - interval '60 hours', 'l', 1), jsonb_build_object('t', t6 - interval '1 hour', 'l', 1)));
  perform public._farm_do_begin_work(room, a3, 10, 'harvest', t6 + interval '3 minutes');
  kg := (public._up_yield(pg_temp.crop(room, 10), public._upland('ot'), 1.0, 1, t6 + interval '3 minutes 2 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a3, 10, 1, t6 + interval '3 minutes 2 seconds');
  assert s->'harvest' = jsonb_build_object('upland', 'ot', 'kg', kg, 'k', 1, 'pickings', 3, 'done', false)
     and pg_temp.plot(s, 10)->'crop'->'picking' = '2' and pg_temp.produce(a3, 'ot') = kg
     and (pg_temp.crop(room, 10)).harvests
         = jsonb_build_array(jsonb_build_object('t', t6 + interval '3 minutes 2 seconds', 'k', 1, 'kg', kg))
     and (pg_temp.crop(room, 10)).work is null, format('picking 1: %s', s->'harvest');
  update public.plot_leases set until = t6 + interval '12 hours 10 seconds' where room_id = room and plot_no = 10;
  perform public._farm_do_begin_work(room, a3, 10, 'harvest', t6 + interval '12 hours');
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 10, 1, %L)', room, a3, t6 + interval '12 hours 11 seconds'))
         = 'not your plot', 'picking 2 after the lease';
  perform public._field_open(room, t6 + interval '12 hours 11 seconds');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 10)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 10) and pg_temp.produce(a3, 'ot') = kg,
    'pickings 2 and 3 went with the lease; picking 1 stays';
end $$;

-- A later part is smaller (§6.1); rice is not picked (R16); fallen rice takes its uncut parts (sweep step 6).
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; s jsonb; y1 integer; y2 integer; w0 integer;
begin
  insert into public.inventory (account_id, item_id, qty) values (a3, 'tool_sickle', 1);
  perform public._farm_do_rent(room, a3, 9, t + interval '7 hours');
  perform pg_temp.ripe_nep(room, 9, a3, t - interval '12 hours');
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 9, 1, %L)', room, a3, t + interval '7 hours'))
         = 'wrong crop', 'rice is cut in parts';
  w0 := pg_temp.wet(a3);
  y1 := (public._crop_yield(pg_temp.crop(room, 9), public._variety('nep'), 1.0, 1.0, t + interval '7 hours 8 seconds')->>'kg')::int;
  perform public._farm_do_begin_work(room, a3, 9, 'harvest', t + interval '7 hours');
  s := public._farm_do_harvest_part(room, a3, 9, true, t + interval '7 hours 8 seconds');
  assert s->'harvest_part'->'kg' = to_jsonb(public._part_kg(1, y1)), format('part 1 of %s', y1);
  y2 := (public._crop_yield(pg_temp.crop(room, 9), public._variety('nep'), 1.0, 1.0, t + interval '9 hours 8 seconds')->>'kg')::int;
  perform public._farm_do_begin_work(room, a3, 9, 'harvest', t + interval '9 hours');
  s := public._farm_do_harvest_part(room, a3, 9, true, t + interval '9 hours 8 seconds');
  assert y2 < y1 and s->'harvest_part' = jsonb_build_object('variety', 'nep', 'kg', public._part_kg(2, y2), 'parts', 2,
                                                            'total', public._part_kg(1, y1) + public._part_kg(2, y2), 'done', false),
    format('Y fell from %s to %s: %s', y1, y2, s->'harvest_part');
  assert pg_temp.wet(a3) = w0 + public._part_kg(1, y1) + public._part_kg(2, y2), 'two parts paid';
  -- the crop falls 48 h after its ripe window (transplant + 108 h = t + 46 h)
  perform public._field_open(room, t + interval '45 hours 59 minutes 59 seconds');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 9), 'standing';
  perform public._field_open(room, t + interval '46 hours');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 9)
     and exists (select 1 from public.plot_leases where room_id = room and plot_no = 9)
     and pg_temp.wet(a3) = w0 + public._part_kg(1, y1) + public._part_kg(2, y2), 'fallen: the uncut parts are lost, the lease stays';
end $$;

-- The RPCs (§11.4, §11.5): guarded, flagged on a bad plot, public; the gift's sickle (R4).
do $$
declare t1 text := (select v from smoke where k = 't1'); t3 text := (select v from smoke where k = 't3');
        room uuid := (select v from smoke where k = 'room3')::uuid; r jsonb;
begin
  r := public.harvest_part(room, t1, 0, true);
  assert r->'anticheat'->>'code' = 'bad_plot' and r->'anticheat'->>'error' = 'invalid plot', format('harvest_part %s', r);
  r := public.rent_harvester(room, t1, null);
  assert r->'anticheat'->>'code' = 'bad_plot' and r->'anticheat'->>'error' = 'invalid plot', format('rent_harvester %s', r);
  assert pg_temp.err(format('select public.rent_harvester(%L, %L, 5)', room, t1)) = 'not your plot', 'the core answers';
  assert pg_temp.err(format('select public.harvest_part(%L, %L, 5, false)', room, t1)) = 'not your plot', 'a failure too';
  assert has_function_privilege('anon', 'public.harvest_part(uuid,text,integer,boolean)', 'execute')
     and has_function_privilege('anon', 'public.rent_harvester(uuid,text,integer)', 'execute')
     and not has_function_privilege('anon', 'public._farm_do_harvest_part(uuid,uuid,integer,boolean,timestamptz)', 'execute')
     and not has_function_privilege('anon', 'public._farm_do_rent_harvester(uuid,uuid,integer,timestamptz)', 'execute'),
    'public RPCs, private cores';
  -- the gift adds a sickle, and one already held stays one
  r := public.claim_farm_gift(t3);
  assert r->'gifted' = 'true' and r->'mine'->'items'->'tool_sickle' = '1' and r->'mine'->'items'->'seed_short' = '1'
     and r->'mine'->'items'->'fert_urea' = '1', format('the gift %s', r->'mine'->'items');
end $$;

select 'v15.2 harvest smoke ok' as result;

-- ---------- tools and trade (§7, §9, R18, R21): anh Hai's tools, the tank, cô Út buys hoa màu ----------
insert into smoke select 'room4', room_id::text from public.create_room('Bình phun', 'pw', (select v from smoke where k = 't2'));

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid; r jsonb;
begin
  perform pg_temp.set_coins(a2, 20000);
  delete from public.inventory where account_id = a2 and item_id like 'tool\_%';
  -- a tool is bought once, one at a time (R18)
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 2)', t2, 'tool_sickle')) = 'invalid quantity', 'one at a time';
  r := public.buy_farm_item(t2, 'tool_sickle', 0);
  assert r->'anticheat'->>'code' = 'bad_qty' and r->'anticheat'->>'error' = 'invalid quantity', 'a quantity outside 1–99 stays hard';
  r := public.buy_farm_item(t2, 'tool_sickle', 1);
  assert r->'mine'->'items'->'tool_sickle' = '1' and r->'mine'->'coins' = '18500'
     and exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'farm_buy' and delta = -1500
                  and ref = 'tool_sickle x1'), 'a sickle for 1 500 xu';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t2, 'tool_sickle')) = 'already owned', 'bought once';
  r := public.buy_farm_item(t2, 'rod_bamboo', 1);
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0', 'no fishing gear here';
  -- the sprayer: nothing to load before it is bought; then an empty tank
  assert pg_temp.err(format('select public.load_sprayer(%L, %L)', t2, 'spray_insect')) = 'no sprayer', 'no sprayer';
  r := public.buy_farm_item(t2, 'tool_sprayer', 1);
  assert r->'mine'->'tank' = '{"item": null, "charges": 0}' and r->'mine'->'coins' = '13500', 'an empty tank';
  r := public.load_sprayer(t2, 'fert_urea');
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid item',
    'a fertilizer is a soft kind_mismatch';
  assert pg_temp.err(format('select public.load_sprayer(%L, %L)', t2, 'spray_x')) = 'invalid item', 'an unknown item';
  assert pg_temp.err(format('select public.load_sprayer(%L, %L)', t2, 'spray_insect')) = 'no item', 'no bottle';
  perform public.buy_farm_item(t2, 'spray_insect', 3);
  perform public.buy_farm_item(t2, 'spray_fungus', 2);
  r := public.load_sprayer(t2, 'spray_insect');
  assert r->'mine'->'tank' = '{"item": "spray_insect", "charges": 3}' and r->'mine'->'items'->'spray_insect' = '2',
    'one bottle, three charges';
end $$;

-- Spraying from the tank (§7, R21), and spraying as care (R8, R32).
do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room4')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; r jsonb;
begin
  perform pg_temp.set_coins(a2, 100000);
  perform public._farm_do_rent(room, a2, 5, t);
  perform public._farm_do_rent(room, a2, 6, t);
  insert into public.crops (room_id, plot_no, farmer_id, kind, prepared_at, water_log)
  values (room, 5, a2, 'upland', t, jsonb_build_array(jsonb_build_object('t', t, 'l', 1)));
  s := public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '1 minute');
  assert s->'mine'->'tank' = '{"item": "spray_insect", "charges": 2}' and s->'mine'->'items'->'spray_insect' = '2',
    'a matching spray uses a charge, not a bottle';
  s := public._farm_do_spray(room, a2, 5, 'spray_fungus', t + interval '2 minutes');
  assert s->'mine'->'tank' = '{"item": "spray_insect", "charges": 2}' and s->'mine'->'items'->'spray_fungus' = '1',
    'another pesticide uses a bottle';
  perform public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '3 minutes');
  s := public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '4 minutes');
  assert s->'mine'->'tank' = '{"item": null, "charges": 0}' and s->'mine'->'items'->'spray_insect' = '2'
     and (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a2),
    'the third charge empties the tank';
  s := public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '5 minutes');
  assert s->'mine'->'tank' = '{"item": null, "charges": 0}' and s->'mine'->'items'->'spray_insect' = '1', 'then a bottle';
  assert jsonb_array_length((pg_temp.crop(room, 5)).spray_log) = 5, 'five sprays logged';
  -- a reload pours out what is left
  r := public.load_sprayer(t2, 'spray_fungus');
  perform public._farm_do_spray(room, a2, 5, 'spray_fungus', t + interval '6 minutes');
  r := public.load_sprayer(t2, 'spray_insect');
  assert r->'mine'->'tank' = '{"item": "spray_insect", "charges": 3}' and r->'mine'->'items'->'spray_insect' is null
     and r->'mine'->'items'->'spray_fungus' is null, 'the fungicide left in the tank is gone';
  -- no charge without the sprayer
  delete from public.inventory where account_id = a2 and item_id = 'tool_sprayer';
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 5, %L, %L)', room, a2, 'spray_insect', t + interval '7 minutes'))
         = 'no item', 'the tank needs its sprayer';
  assert (select tank_item = 'spray_insect' and tank_charges = 3 from public.farm_profiles where account_id = a2)
     and public._farm_mine(a2)->'tank' = 'null', 'the tank is kept, and hidden';
  insert into public.inventory (account_id, item_id, qty) values (a2, 'tool_sprayer', 1);
  -- spraying is care: not on a partly cut plot, nor under a running harvester
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, harvested_parts,
                            harvested_kg)
  values (room, 6, a2, 'nep', t - interval '64 hours', t - interval '63 hours', t - interval '60 hours', t - interval '50 hours', 2, 25);
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 6, %L, %L)', room, a2, 'spray_insect', t + interval '8 minutes'))
         = 'harvesting', 'partly cut';
  update public.crops set harvester_at = t + interval '8 minutes', harvester_until = t + interval '8 minutes 30 seconds'
   where room_id = room and plot_no = 6;
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 6, %L, %L)', room, a2, 'spray_insect', t + interval '8 minutes'))
         = 'harvester busy', 'a running harvester';
  assert (select tank_charges from public.farm_profiles where account_id = a2) = 3, 'nothing used';
end $$;

-- cô Út buys hoa màu (§9, §11.4): kg · price_per_kg, ledger reason produce_sell.
do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid; r jsonb; c0 integer;
begin
  insert into public.produce_stock (account_id, upland, kg) values (a2, 'bap', 30)
  on conflict (account_id, upland) do update set kg = excluded.kg;
  r := public.sell_produce(t2, 'bap', 0);
  assert r->'anticheat'->>'code' = 'bad_qty' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid quantity'
     and r - 'anticheat' = '{}', format('kg 0 %s', r);
  assert public.sell_produce(t2, 'bap', null)->'anticheat'->>'code' = 'bad_qty', 'kg null';
  assert pg_temp.err(format('select public.sell_produce(%L, %L, 1)', t2, 'lua')) = 'invalid crop', 'an unknown crop';
  assert pg_temp.err(format('select public.sell_produce(%L, null, 1)', t2)) = 'invalid crop', 'no crop';
  assert pg_temp.err(format('select public.sell_produce(%L, %L, 31)', t2, 'bap')) = 'not enough crop', 'more than held';
  assert pg_temp.err(format('select public.sell_produce(%L, %L, 1)', t2, 'ot')) = 'not enough crop', 'none held';
  c0 := (select coins from public.wallets where account_id = a2);
  r := public.sell_produce(t2, 'bap', 30);
  assert r->'mine'->'coins' = to_jsonb(c0 + 30 * 460) and r->'mine'->'produce'->'bap' is null and r->>'server_now' is not null
     and exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'produce_sell' and delta = 13800
                  and ref = 'bap 30 kg'), 'sold 30 kg of bắp for 13 800 xu';
  assert has_function_privilege('anon', 'public.load_sprayer(text,text)', 'execute')
     and has_function_privilege('anon', 'public.sell_produce(text,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.buy_farm_item(text,text,integer)', 'execute'), 'public RPCs';
end $$;

select 'v15.2 tools smoke ok' as result;

-- ---------- hoa màu (§8.9): beds, planting, care, a season of each method, and the wipe (§11.5) ----------
insert into smoke select 'room5', room_id::text from public.create_room('Hoa màu', 'pw', (select v from smoke where k = 't3'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room5')::uuid), 'pw', v)
  from smoke where k = 't1';
create function pg_temp.give(a uuid, it text, n integer) returns void language sql
as $$ insert into public.inventory (account_id, item_id, qty) values (a, it, n)
      on conflict (account_id, item_id) do update set qty = excluded.qty $$;

-- Lên luống, planting and tending: the refusals in their order (§11.4).
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room5')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; c jsonb; i integer;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform pg_temp.set_coins(a3, 100000);
  perform public._farm_do_rent(room, a3, 5, t);
  perform public._farm_do_rent(room, a3, 6, t);
  perform public._farm_do_rent(room, a1, 7, t);
  perform pg_temp.give(a3, 'seed_khoai', 2);
  perform pg_temp.give(a3, 'seed_bap', 1);
  perform pg_temp.give(a3, 'seed_short', 1);
  perform pg_temp.give(a1, 'seed_ot', 1);
  perform pg_temp.give(a1, 'seed_short', 1);
  -- lên luống: a bare plot of mine, at Ẩm
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 11, %L)', room, a3, t)) = 'invalid plot', 'plot 11';
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 5, %L)', room, a1, t)) = 'not your plot', 'a3''s plot';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_khoai', t)) = 'not prepared',
    'a bare plot';
  s := public._farm_do_prepare_beds(room, a3, 5, t);
  c := pg_temp.plot(s, 5)->'crop';
  assert c->>'kind' = 'upland' and c->>'phase' = 'prepared' and c->'water' = '1' and c->'upland' = 'null', format('beds %s', c);
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 5, %L)', room, a3, t)) = 'crop exists', 'once';
  assert pg_temp.err(format('select public._farm_do_prepare(%L, %L, 5, %L)', room, a3, t)) = 'crop exists', 'no paddy on beds';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 5, %L, %L)', room, a3, 'seed_short', t)) = 'wrong crop',
    'no rice seed on beds';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 5, %L)', room, a3, t)) = 'wrong crop', 'no sowing on beds';
  -- a paddy takes no hoa màu, and a soaked rice seed is not làm đất
  perform public._farm_do_prepare(room, a3, 6, t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 6, %L, %L)', room, a3, 'seed_bap', t)) = 'wrong crop', 'a paddy';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 6, %L, %L)', room, a3, 'vun_goc', t)) = 'wrong crop', 'no tending';
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 6, %L)', room, a3, t)) = 'crop exists', 'a paddy first';
  perform public._farm_do_abandon(room, a3, 6, t);
  perform public._farm_do_prepare_beds(room, a3, 6, t);
  perform public._farm_do_soak(room, a1, 7, 'seed_short', t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 7, %L, %L)', room, a1, 'seed_ot', t)) = 'not prepared',
    'a soaked seed';
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 7, %L)', room, a1, t)) = 'crop exists', 'soaking';
  perform public._farm_do_abandon(room, a1, 7, t);
  perform public._farm_do_prepare_beds(room, a1, 7, t);
  -- planting: a hoa-màu seed, on beds with nothing planted, at Ẩm, from the bag
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_short', t)) = 'invalid item',
    'a rice seed';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'fert_urea', t)) = 'invalid item',
    'not a seed';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 8, %L, %L)', room, a3, 'seed_khoai', t)) = 'not your plot',
    'plot 8';
  perform public._farm_do_water(room, a3, 5, 1, t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_khoai', t)) = 'need water', 'Đẫm';
  perform public._farm_do_water(room, a3, 5, -1, t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_ot', t)) = 'no item', 'no ớt seed';
  -- bón lót before P, then khoai (a cutting: P now), bắp (direct: P now) and ớt (a nursery: sow_at now, P later)
  perform pg_temp.give(a3, 'fert_manure', 1);
  perform pg_temp.give(a3, 'fert_phosphate', 1);
  perform public._farm_do_fertilize(room, a3, 5, 'fert_manure', t);
  perform public._farm_do_fertilize(room, a3, 5, 'fert_phosphate', t);
  s := public._farm_do_plant(room, a3, 5, 'seed_khoai', t + interval '1 minute');
  c := pg_temp.plot(s, 5)->'crop';
  assert c->>'upland' = 'khoai' and c->>'phase' = 'root' and (c->>'plant_at')::timestamptz = t + interval '1 minute'
     and c->'sow_at' = 'null' and c->'picking' = '1' and c->'pickings' = '1' and s->'mine'->'items'->'seed_khoai' = '1',
    format('khoai %s', c);
  assert (select jsonb_array_length(pest_rolls) = 1 and pest_rolls->0->>'slot' = '1' and (pest_rolls->0->>'u_hit')::float8 < 1
            from public.crops where room_id = room and plot_no = 5), 'one secret roll per pest slot';
  assert pg_temp.plot(s, 5)::text not like '%u_hit%', 'the rolls stay secret';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_khoai', t + interval '1 minute'))
         = 'crop exists', 'planted already';
  s := public._farm_do_plant(room, a3, 6, 'seed_bap', t + interval '1 minute');
  assert pg_temp.plot(s, 6)->'crop'->>'phase' = 'sprout'
     and (select jsonb_array_length(pest_rolls) from public.crops where room_id = room and plot_no = 6) = 2, 'bắp, two slots';
  s := public._farm_do_plant(room, a1, 7, 'seed_ot', t + interval '1 minute');
  c := pg_temp.plot(s, 7)->'crop';
  assert c->>'phase' = 'nursery' and (c->>'sow_at')::timestamptz = t + interval '1 minute' and c->'plant_at' = 'null'
     and c->'pickings' = '3', format('the ớt nursery %s', c);
  -- tending: one of the crop's acts, after P, recorded whenever it is done; at most 20 a crop
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 5, %L, %L)', room, a3, 'vun_goc', t + interval '24 hours'))
         = 'wrong crop', 'khoai has no vun gốc';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 7, %L, %L)', room, a1, 'lat_day', t + interval '2 hours'))
         = 'wrong crop', 'ớt has no act';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 5, %L, %L)', room, a3, 'lat_day', t)) = 'wrong phase', 'before P';
  for i in 1 .. 20 loop
    s := public._farm_do_tend(room, a3, 6, 'vun_goc', t + interval '20 hours');
  end loop;
  assert pg_temp.plot(s, 6)->'crop'->'log'->'work'->0 = jsonb_build_object('t', t + interval '20 hours', 'act', 'vun_goc')
     and jsonb_array_length(pg_temp.plot(s, 6)->'crop'->'log'->'work') = 20, 'recorded';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 6, %L, %L)', room, a3, 'vun_goc', t + interval '21 hours'))
         = 'too fast', 'twenty at most';
end $$;

-- A khoai season by the book (§8.8): 200 kg, less one hour of a treated weevil = 197 kg.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room5')::uuid;
        p timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '1 minute'; s jsonb; c jsonb;
begin
  -- the weevil (slot 1, 24–40 h) is due at P + 32 h, on a Khô bed (×2)
  update public.crops set pest_rolls = '[{"slot": 1, "u_time": 0.5, "u_hit": 0.1}]' where room_id = room and plot_no = 5;
  perform pg_temp.give(a3, 'fert_potash', 1);
  perform public._farm_do_fertilize(room, a3, 5, 'fert_potash', p + interval '20 hours');
  s := public._farm_do_tend(room, a3, 5, 'lat_day', p + interval '28 hours');
  assert pg_temp.plot(s, 5)->'crop'->>'phase' = 'tuber', 'tuber at 28 h';
  c := pg_temp.plot(public._field_view(room, a3, p + interval '32 hours'), 5)->'crop';
  assert c->'pests' = jsonb_build_array(jsonb_build_object('kind', 'weevil', 'since', p + interval '32 hours', 'treated_at', null)),
    format('the weevil %s', c->'pests');
  perform pg_temp.give(a3, 'spray_insect', 1);
  s := public._farm_do_spray(room, a3, 5, 'spray_insect', p + interval '33 hours');
  assert pg_temp.plot(s, 5)->'crop'->'pests'->0->>'treated_at' is not null, 'treated an hour later';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 5, %L, %L)', room, a3, 'harvest',
                            p + interval '47 hours 59 minutes 59 seconds')) = 'wrong phase', 'R_1 − 1 s';
  perform public._farm_do_begin_work(room, a3, 5, 'harvest', p + interval '48 hours');
  s := public._farm_do_harvest(room, a3, 5, 1, p + interval '48 hours 2 seconds');
  assert s->'harvest' = '{"upland": "khoai", "kg": 197, "k": 1, "pickings": 1, "done": true}'
     and pg_temp.produce(a3, 'khoai') = 197, format('khoai %s', s->'harvest');
  assert pg_temp.plot(s, 5)->'crop' = 'null' and pg_temp.plot(s, 5)->'lease' = 'null', 'dug; the lease ended';
end $$;

-- An ớt season (§8.8): ươm, trồng cây con after the 2 s action, three pickings 12 h apart; the last ends the lease.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; t1 text := (select v from smoke where k = 't1');
        room uuid := (select v from smoke where k = 'room5')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        p timestamptz := t + interval '12 hours 1 minute'; s jsonb; k integer; kg integer[] := '{}'; r jsonb; c0 integer;
begin
  update public.crops set pest_rolls = '[{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}]'
   where room_id = room and plot_no = 7;
  -- sown at t + 1 min, ready 10 h later; the bed dried to Khô at t + 12 h, so it is watered back to Ẩm first
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a1, 'transplant', p - interval '2 seconds'))
         = 'need water', 'Khô';
  perform public._farm_do_water(room, a1, 7, 1, t + interval '12 hours');
  perform public._farm_do_begin_work(room, a1, 7, 'transplant', p - interval '2 seconds');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 7, 1, %L)', room, a1, p - interval '1 second')) = 'too fast',
    'the 2 s gate';
  s := public._farm_do_transplant(room, a1, 7, 5.0, p);
  assert pg_temp.plot(s, 7)->'crop'->>'phase' = 'root' and (pg_temp.plot(s, 7)->'crop'->>'plant_at')::timestamptz = p
     and (pg_temp.crop(room, 7)).transplant_at is null and (pg_temp.crop(room, 7)).work is null, 'P is set; quality ignored';
  -- pickings at R_1 = P + 46 h, R_2 = R_1 + 12 h, R_3 = R_1 + 24 h
  for k in 1 .. 3 loop
    if k > 1 then
      assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a1, 'harvest',
                                p + make_interval(hours => 46 + 12 * (k - 1)) - interval '1 second')) = 'wrong phase',
        format('R_%s − 1 s', k);
    end if;
    perform public._farm_do_begin_work(room, a1, 7, 'harvest', p + make_interval(hours => 46 + 12 * (k - 1)));
    kg := kg || (public._up_yield(pg_temp.crop(room, 7), public._upland('ot'), 1.0, k,
                                  p + make_interval(hours => 46 + 12 * (k - 1), secs => 2))->>'kg')::int;
    s := public._farm_do_harvest(room, a1, 7, 1, p + make_interval(hours => 46 + 12 * (k - 1), secs => 2));
    assert s->'harvest' = jsonb_build_object('upland', 'ot', 'kg', kg[k], 'k', k, 'pickings', 3, 'done', k = 3),
      format('picking %s: %s', k, s->'harvest');
  end loop;
  assert kg[1] > kg[2] and kg[2] > kg[3] and pg_temp.produce(a1, 'ot') = kg[1] + kg[2] + kg[3], format('40/35/25 %s', kg);
  assert pg_temp.plot(s, 7)->'crop' = 'null' and pg_temp.plot(s, 7)->'lease' = 'null', 'the last picking ends the lease';
  -- cô Út buys it all
  c0 := (select coins from public.wallets where account_id = a1);
  r := public.sell_produce(t1, 'ot', kg[1] + kg[2] + kg[3]);
  assert r->'mine'->'coins' = to_jsonb(c0 + (kg[1] + kg[2] + kg[3]) * 1590) and r->'mine'->'produce'->'ot' is null, 'sold';
end $$;

-- The RPCs (§11.4, §11.5): guarded, flagged as the spec lists, public.
do $$
declare t3 text := (select v from smoke where k = 't3'); room uuid := (select v from smoke where k = 'room5')::uuid; r jsonb;
begin
  r := public.prepare_beds(room, t3, 0);
  assert r->'anticheat'->>'code' = 'bad_plot' and r->'anticheat'->>'error' = 'invalid plot', format('prepare_beds %s', r);
  r := public.plant_crop(room, t3, null, 'seed_bap');
  assert r->'anticheat'->>'code' = 'bad_plot', format('plant_crop %s', r);
  r := public.plant_crop(room, t3, 6, 'fert_urea');
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid item',
    format('a fertilizer is a soft kind_mismatch %s', r);
  assert pg_temp.err(format('select public.plant_crop(%L, %L, 6, %L)', room, t3, 'seed_short')) = 'invalid item',
    'a rice seed is the core''s refusal';
  r := public.tend_crop(room, t3, 6, 'x');
  assert r->'anticheat'->>'code' = 'bad_work' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid act'
     and r - 'anticheat' = '{}', format('tend_crop x %s', r);
  assert public.tend_crop(room, t3, 6, null)->'anticheat'->>'code' = 'bad_work', 'no act';
  assert public.tend_crop(room, t3, 11, 'vun_goc')->'anticheat'->>'code' = 'bad_plot', 'plot 11';
  assert has_function_privilege('anon', 'public.prepare_beds(uuid,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.plant_crop(uuid,text,integer,text)', 'execute')
     and has_function_privilege('anon', 'public.tend_crop(uuid,text,integer,text)', 'execute'), 'public RPCs';
end $$;

-- The wipe (§11.5): the snapshot lists the hoa màu, the tank and the crops' new fields; the stock goes, the tank empties.
insert into smoke select 't5', token from public.register('smoke152_e_' || floor(random() * 1e9)::text, 'pw123456');
do $$
declare a5 uuid := public._auth_account((select v from smoke where k = 't5')); room uuid := (select v from smoke where k = 'room5')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; h jsonb;
begin
  perform pg_temp.set_coins(a5, 50000);
  perform public._farm_do_rent(room, a5, 9, t);
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
  values (room, 9, a5, 'upland', 'bap', t, t, jsonb_build_array(jsonb_build_object('t', t, 'l', 1)));
  insert into public.produce_stock (account_id, upland, kg) values (a5, 'khoai', 50), (a5, 'ot', 0);
  perform pg_temp.give(a5, 'tool_sprayer', 1);
  insert into public.farm_profiles (account_id, tank_item, tank_charges) values (a5, 'spray_fungus', 2);
  h := public._ac_holdings(a5);
  assert h->'produce' = '[{"kg": 50, "upland": "khoai"}, {"kg": 0, "upland": "ot"}]'
     and h->'tank' = '{"item": "spray_fungus", "charges": 2}', format('holdings %s %s', h->'produce', h->'tank');
  assert h->'crops'->0 @> jsonb_build_object('plot_no', 9, 'kind', 'upland', 'variety', null, 'upland', 'bap', 'plant_at', t,
                                             'parts', 0, 'harvester_until', null), format('crops %s', h->'crops');
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a5, 2, 'pending_wipe', now());
  h := public._ac_wipe(a5, null);
  assert h->'produce'->0->'kg' = '50', 'the snapshot keeps them';
  assert not exists (select 1 from public.produce_stock where account_id = a5)
     and (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a5)
     and public._farm_mine(a5)->'tank' = 'null', 'the hoa màu is gone and the tank is empty';
end $$;

select 'v15.2 beds smoke ok' as result;

\i tests/sql/anticheat-guards.sql
