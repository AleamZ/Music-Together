-- tests/sql/farm-one-day-smoke.sql — 0120 (Trồng trọt: one crop cycle in one real day). Run as the superuser on the
-- throwaway cluster after the full chain (… 0119, 0120), from the repo root:
--   psql -v catalog=<abs>/tests/fixtures/farm-catalog-0120.json -f tests/sql/farm-one-day-smoke.sql
-- Inside one transaction that it rolls back: it puts the pre-0120 catalog back (every growth hour ÷ the factor, the old
-- scale and base_kg), plants crops at known points of their old cycle, re-runs 0120 twice with \i (now() is the
-- transaction's start, so the squeeze is exact) and checks the catalog against the client's fixture, every crop's
-- cycle (≤ 24 h), the squeezed crops (same phase, same care marks, less time left) and that the re-run changes nothing.
\set ON_ERROR_STOP on
set time zone 'UTC';
begin;
set local client_min_messages = notice;

create temp table fx (j jsonb);
insert into fx select pg_read_file(:'catalog')::jsonb;

-- ---------- the pre-0120 catalog (0013 / 0016) ----------
update public.rice_varieties v set scale = x.scale, base_kg = x.kg
  from (values ('short', 0.9::double precision, 90), ('nep', 1.0::double precision, 75), ('thom', 1.15::double precision, 60)) x(id, scale, kg)
 where v.id = x.id;
create temp table old_f (id text primary key, f double precision, kg integer, old_h double precision);
insert into old_f values ('khoai', 6, 200, null), ('bap', 4, 150, null), ('ot', 10.0 / 3, 60, 18);
create or replace function pg_temp.mul(p jsonb, keys text[], f double precision) returns jsonb language sql immutable as $$
  select coalesce(jsonb_agg((select coalesce(jsonb_object_agg(k, case when k = any(keys) and jsonb_typeof(v) = 'number'
                                                                     then to_jsonb(round(((v::text)::numeric * f::numeric), 2)) else v end), '{}'::jsonb)
                              from jsonb_each(e.x) kv(k, v)) order by e.n), '[]'::jsonb)
    from jsonb_array_elements(p) with ordinality e(x, n)
$$;
update public.upland_crops u
   set base_kg = o.kg,
       stages = pg_temp.mul(u.stages, array['until_h'], o.f),
       cares = pg_temp.mul(u.cares, array['from_h', 'to_h', 'half_from_h', 'half_to_h'], o.f),
       pests = pg_temp.mul(u.pests, array['from_h', 'to_h'], o.f),
       nursery_ready_h = u.nursery_ready_h * o.f, nursery_old_h = o.old_h,
       pick_gap_h = u.pick_gap_h * o.f, rot_from_h = round((u.rot_from_h * o.f)::numeric, 0)
  from old_f o where u.id = o.id;
do $$
begin
  assert (select (stages -> -1 ->> 'until_h')::numeric from public.upland_crops where id = 'khoai') = 48, 'old khoai 48 h';
  assert (select (stages -> -1 ->> 'until_h')::numeric from public.upland_crops where id = 'bap') = 60, 'old bắp 60 h';
  assert (select (stages -> -1 ->> 'until_h')::numeric from public.upland_crops where id = 'ot') = 46, 'old ớt 46 h';
  assert (select scale from public.rice_varieties where id = 'nep') = 1, 'old nếp scale 1';
end $$;

-- ---------- crops in the ground before 0120 ----------
create temp table fo (k text primary key, v text);
insert into fo select 't', token from public.register('f1d_' || floor(random() * 1e9)::text, 'pw123456');
insert into fo select 'a', public._auth_account(v)::text from fo where k = 't';
update public.app_flags set enabled = true where key = 'room_creation_open';
insert into fo select 'r', room_id::text from public.create_room('Farm one day', 'pw', (select v from fo where k = 't'));
select public._field_init((select v::uuid from fo where k = 'r'));
create or replace function pg_temp.r() returns uuid language sql stable as $$ select v::uuid from fo where k = 'r' $$;
create or replace function pg_temp.a() returns uuid language sql stable as $$ select v::uuid from fo where k = 'a' $$;
create or replace function pg_temp.h(t timestamptz) returns double precision language sql stable as $$
  select extract(epoch from (now() - t)) / 3600
$$;
create or replace function pg_temp.near(a double precision, b double precision) returns boolean language sql immutable as $$
  select abs(a - b) < 1e-6
$$;
-- plot 1: nếp transplanted 30 h ago (panicle at s = 1: 18–30 → heading at 30), top-dressed at T+6 (on time: 2–10)
insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log, fert_log)
values (pg_temp.r(), 1, pg_temp.a(), 'nep', now() - interval '48 hours', now() - interval '46 hours', now() - interval '43 hours',
        now() - interval '29 hours',
        jsonb_build_array(jsonb_build_object('t', now() - interval '48 hours', 'l', 3), jsonb_build_object('t', now() - interval '29 hours', 'l', 2)),
        jsonb_build_array(jsonb_build_object('t', now() - interval '23 hours', 'item', 'fert_urea')));
-- plot 2: khoai planted 30 h ago (tuber stage 22–36 h), its lật dây at 26 h (on time 24–32), a pest roll
insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log, work_log, pest_rolls)
values (pg_temp.r(), 2, pg_temp.a(), 'upland', 'khoai', now() - interval '31 hours', now() - interval '30 hours',
        jsonb_build_array(jsonb_build_object('t', now() - interval '31 hours', 'l', 1)),
        jsonb_build_array(jsonb_build_object('t', now() - interval '4 hours', 'act', 'lat_day')),
        '[{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}]');
-- plot 3: ớt sown 8 h ago, still in the nursery (ready at 10 h)
insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, water_log)
values (pg_temp.r(), 3, pg_temp.a(), 'upland', 'ot', now() - interval '9 hours', now() - interval '8 hours',
        jsonb_build_array(jsonb_build_object('t', now() - interval '9 hours', 'l', 1)));
-- plot 4: lúa thơm ripe for 5 h already (transplanted 48·1.15 + 5 h ago)
insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
values (pg_temp.r(), 4, pg_temp.a(), 'thom', now() - interval '80 hours', now() - interval '79 hours', now() - interval '76 hours',
        now() - interval '60.2 hours',
        jsonb_build_array(jsonb_build_object('t', now() - interval '80 hours', 'l', 3), jsonb_build_object('t', now() - interval '10 hours', 'l', 0)));

create temp table before0120 as
  select cr.plot_no, cr.kind,
         case when cr.kind = 'rice' then public._crop_phase(cr, v, now()) else public._up_phase(cr, u, now()) end as phase,
         case when cr.kind = 'rice' then public._crop_care(cr, v) end as care, cr.water_log
    from public.crops cr left join public.rice_varieties v on v.id = cr.variety left join public.upland_crops u on u.id = cr.upland
   where cr.room_id = pg_temp.r();

\i supabase/migrations/0120_farm_one_day.sql

-- ---------- the catalog = the client's fixture ----------
do $$
declare j jsonb := (select j from fx); r record; v_n integer := 0;
begin
  for r in select * from jsonb_to_recordset(j->'varieties') x(id text, scale double precision, base_kg integer) loop
    assert (select scale = r.scale and base_kg = r.base_kg from public.rice_varieties where id = r.id),
      format('variety %s = the fixture', r.id);
    v_n := v_n + 1;
  end loop;
  for r in select * from jsonb_to_recordset(j->'uplands') x(id text, base_kg integer, nursery_ready_h double precision,
                                                            nursery_old_h double precision, stages jsonb, pick_gap_h double precision,
                                                            rot_from_h double precision, cares jsonb, pests jsonb,
                                                            ripe_window_h double precision, lost_after_h double precision) loop
    assert (select u.base_kg = r.base_kg and u.nursery_ready_h is not distinct from r.nursery_ready_h
                   and u.nursery_old_h is not distinct from r.nursery_old_h and u.stages = r.stages
                   and u.pick_gap_h is not distinct from r.pick_gap_h and u.rot_from_h is not distinct from r.rot_from_h
                   and u.cares = r.cares and u.pests = r.pests and u.ripe_window_h = r.ripe_window_h
                   and u.lost_after_h = r.lost_after_h
              from public.upland_crops u where u.id = r.id), format('upland %s = the fixture', r.id);
    v_n := v_n + 1;
  end loop;
  assert v_n = 6 and (select count(*) from public.rice_varieties) + (select count(*) from public.upland_crops) = 6, 'six crops';
  -- every crop is ready within a day of its first action: rice 2 + 62·s (soak, then the latest transplant without a
  -- penalty), hoa màu the nursery plus the last picking
  assert (select max(2 + 62 * scale) from public.rice_varieties) <= 24, 'rice ≤ 24 h';
  assert (select max(coalesce(nursery_ready_h, 0) + public._up_hours(u, jsonb_array_length(pickings))) from public.upland_crops u) <= 24,
    'hoa màu ≤ 24 h';
  assert (select min(coalesce(nursery_ready_h, 0) + public._up_hours(u, 1)) from public.upland_crops u) <= 8, 'khoai in 8 h';
  -- the real-time windows stay
  assert (select bool_and(ripe_window_h >= 8 and lost_after_h >= 24) from public.upland_crops), 'ripe windows kept';
  -- the order of the crops by length is kept
  assert (select array_agg(id order by 2 + 56 * scale) from public.rice_varieties) = array['short', 'nep', 'thom'], 'rice order';
  raise notice 'catalog ok';
end $$;

-- ---------- the crops in the ground ----------
do $$
declare c public.crops; v public.rice_varieties; u public.upland_crops;
begin
  -- nếp: squeezed by 0.25 — transplanted 7.25 h ago, its phase and its on-time top-dress kept, 0.25 h of growth left
  select * into c from public.crops where room_id = pg_temp.r() and plot_no = 1;
  v := public._variety('nep');
  assert pg_temp.near(pg_temp.h(c.transplant_at), 29 * 0.25), format('nếp transplant %s h ago', pg_temp.h(c.transplant_at));
  assert pg_temp.near(pg_temp.h(c.soak_at), 46 * 0.25) and pg_temp.near(pg_temp.h(c.prepared_at), 48), 'soak squeezed, prepared kept';
  assert pg_temp.near(pg_temp.h((c.fert_log->0->>'t')::timestamptz), 23 * 0.25), 'the fertilizer squeezed';
  assert exists (select 1 from jsonb_array_elements(c.water_log) x
                  where x->>'l' = '2' and pg_temp.near(pg_temp.h((x->>'t')::timestamptz), 29 * 0.25)), 'the water squeezed';
  -- the water at every quarter hour of its past is what it was at the matching old time (the drops written in)
  assert (select bool_and(public._water_at(c.water_log, now() - (now() - g) * 0.25)
                          = public._water_at((select water_log from before0120 where plot_no = 1), g))
            from generate_series(now() - interval '48 hours', now() - interval '1 second', interval '15 minutes') g),
    'the water history kept';
  assert public._crop_phase(c, v, now()) = (select phase from before0120 where plot_no = 1), 'same phase';
  assert public._crop_care(c, v) = (select care from before0120 where plot_no = 1), 'same care marks';
  assert (public._crop_care(c, v)->>'td1')::double precision = 0, 'the top-dress still on time';
  assert pg_temp.near(48 * v.scale - pg_temp.h(c.transplant_at), (48 - 29) * 0.25), 'the growth left shrinks by the factor';
  -- khoai: squeezed by 1/6
  select * into c from public.crops where room_id = pg_temp.r() and plot_no = 2;
  select * into u from public.upland_crops where id = 'khoai';
  assert pg_temp.near(pg_temp.h(c.plant_at), 5), format('khoai planted %s h ago', pg_temp.h(c.plant_at));
  assert pg_temp.near(pg_temp.h((c.work_log->0->>'t')::timestamptz), 4.0 / 6), 'the hand job squeezed';
  assert public._up_phase(c, u, now()) = (select phase from before0120 where plot_no = 2), 'same khoai phase';
  -- ớt in the nursery: 2.4 h old of its 3, not old
  select * into c from public.crops where room_id = pg_temp.r() and plot_no = 3;
  select * into u from public.upland_crops where id = 'ot';
  assert pg_temp.near(pg_temp.h(c.sow_at), 8 * 0.3) and c.plant_at is null, 'ớt sown 2.4 h ago';
  assert public._up_phase(c, u, now()) = 'nursery' and pg_temp.h(c.sow_at) < u.nursery_ready_h, 'still in the nursery';
  -- lúa thơm, ripe for 5 h: still ripe (5 × 0.278 h into its 12 h window)
  select * into c from public.crops where room_id = pg_temp.r() and plot_no = 4;
  v := public._variety('thom');
  assert public._crop_phase(c, v, now()) = 'ripe', 'thơm still ripe';
  assert pg_temp.h(c.transplant_at) - 48 * v.scale < 2, 'ripe for less than 2 h now';
  raise notice 'crops ok';
end $$;

-- ---------- a re-run changes nothing ----------
create temp table after1 as select * from public.crops where room_id = pg_temp.r();
create temp table cat1 as select id, scale, base_kg from public.rice_varieties union all select id, 0, base_kg from public.upland_crops;
\i supabase/migrations/0120_farm_one_day.sql
do $$
begin
  assert not exists (select * from public.crops where room_id = pg_temp.r() except select * from after1), 'crops unchanged';
  assert not exists (select id, scale, base_kg from public.rice_varieties union all select id, 0, base_kg from public.upland_crops
                     except select * from cat1), 'catalog unchanged';
  assert not exists (select 1 from pg_proc where proname like '\_farm\_squeeze%' and has_function_privilege('anon', oid, 'execute')),
    'the helpers are not anon''s';
  raise notice 'farm-one-day smoke ok';
end $$;
rollback;
