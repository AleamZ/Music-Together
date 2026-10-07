-- tests/sql/anticheat-v2-farm-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0063, from
-- the repo root, with the fixtures' absolute paths:
--   psql -v harvest=<repo>/tests/fixtures/harvest-cases.json -v crab=<repo>/tests/fixtures/crab-cases.json
--        -v sling=<repo>/tests/fixtures/sling-cases.json -f tests/sql/anticheat-v2-farm-smoke.sql
-- It re-runs 0061–0063 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0061_harvest_replay.sql
\i supabase/migrations/0062_crab_replay.sql
\i supabase/migrations/0063_sling_replay.sql
\i supabase/migrations/0061_harvest_replay.sql
\i supabase/migrations/0062_crab_replay.sql
\i supabase/migrations/0063_sling_replay.sql
reset client_min_messages;

create temp table hx as select pg_read_file(:'harvest')::jsonb j;
create temp table cx as select pg_read_file(:'crab')::jsonb j;
create temp table lx as select pg_read_file(:'sling')::jsonb j;
create or replace function pg_temp.ints(v jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;

-- ---------- 1. The fixtures: the SQL sims = minigames.ts / sling.ts ----------
do $$
declare c jsonb; n integer := 0; r jsonb; t0 timestamptz; worst numeric := 0; ms numeric;
begin
  for c in select jsonb_array_elements(j) from hx loop
    assert public._harvest_centres((c->>'seed')::bigint) = pg_temp.ints(c->'expected'->'centres'), format('%s: centres', c->>'name');
    t0 := clock_timestamp();
    r := public._harvest_replay((c->>'seed')::bigint, pg_temp.ints(c->'toggles'));
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    if ms > worst then worst := ms; end if;
    assert r = (c->'expected') - 'centres', format('%s: sql %s ts %s', c->>'name', r, c->'expected');
    assert public._harvest_input_error(pg_temp.ints(c->'toggles'), (r->>'ticks')::int) is null, format('%s: honest refused', c->>'name');
    n := n + 1;
  end loop;
  assert n >= 20, format('%s harvest cases', n);
  assert worst < 1500, format('a harvest replay took %s ms', worst);
  raise notice 'harvest fixtures ok: % cases, slowest % ms', n, round(worst);
  n := 0;
  for c in select jsonb_array_elements(j) from cx loop
    assert public._crab_phases((c->>'seed')::bigint) = pg_temp.ints(c->'expected'->'phases'), format('%s: phases', c->>'name');
    r := public._crab_replay((c->>'seed')::bigint, pg_temp.ints(c->'grabs'), (c->>'ticks')::int);
    assert r = (c->'expected') - 'phases', format('%s: sql %s ts %s', c->>'name', r, c->'expected');
    assert public._crab_input_error(pg_temp.ints(c->'grabs'), (c->>'ticks')::int) is null, format('%s: honest refused', c->>'name');
    n := n + 1;
  end loop;
  assert n >= 20, format('%s crab cases', n);
  raise notice 'crab fixtures ok: % cases', n;
  n := 0;
  for c in select jsonb_array_elements(j) from lx loop
    declare p jsonb; s jsonb; rat bigint[]; last integer := 0;
    begin
      for p in select jsonb_array_elements(c->'path') loop
        assert (public._sling_rat_advance(public._sling_rat_start((c->>'seed')::bigint), (p->>0)::int))[1] = (p->>1)::bigint,
          format('%s: the rat at %s', c->>'name', p->>0);
      end loop;
      rat := public._sling_rat_start((c->>'seed')::bigint);
      for s in select jsonb_array_elements(c->'shots') loop
        assert public._sling_input_error((s->'shot'->>'press')::int, (s->'shot'->>'release')::int, (s->'shot'->>'aim')::int, last) is null,
          format('%s: an honest shot refused', c->>'name');
        rat := public._sling_rat_advance(rat, (s->'shot'->>'release')::int + 18 - last);
        last := (s->'shot'->>'release')::int + 18;
        assert public._sling_mark(rat, (s->'shot'->>'press')::int, (s->'shot'->>'release')::int, (s->'shot'->>'aim')::int) = s->>'mark',
          format('%s: shot %s', c->>'name', s->'shot');
        n := n + 1;
      end loop;
    end;
  end loop;
  assert n >= 40, format('%s sling shots', n);
  raise notice 'sling fixtures ok: % shots', n;
end $$;

-- the shapes the sims refuse
do $$
begin
  assert public._toggles_error('{}', 0, 7200, 400, 45) = 'ticks' and public._toggles_error('{}', 7201, 7200, 400, 45) = 'ticks', 'ticks';
  assert public._toggles_error('{5,5}', 100, 7200, 400, 45) = 'order' and public._toggles_error('{100}', 100, 7200, 400, 45) = 'range', 'order, range';
  assert public._toggles_error(array(select g from generate_series(0, 45) g), 300, 7200, 400, 45) = 'rate', 'rate';
  assert public._toggles_error('[2:3]={1,2}', 100, 7200, 400, 45) = 'shape', 'shape';
  assert public._sling_input_error(10, 70, 16000, 0) is null and public._sling_input_error(10, 71, 16000, 0) = 'draw', 'a full draw at most';
  assert public._sling_input_error(10, 10, 16000, 0) = 'draw' and public._sling_input_error(10, 20, 15999, 0) = 'aim', 'draw, aim';
  assert public._sling_input_error(100, 120, 16000, 100) = 'order' and public._sling_input_error(1, 4500, 16000, 0) = 'draw', 'order';
  assert public._sling_input_error(4480, 4490, 16000, 0) = 'late', 'late';
  assert public._field_plot_use(1) = '{136,164}' and public._field_plot_use(5) = '{136,218}' and public._field_plot_use(10) = '{440,318}', 'plot uses';
  assert public._field_hole_use(1) = '{96,164}' and public._field_hole_use(2) = '{250,220}', 'hole uses';
  raise notice 'shapes ok';
end $$;

-- ---------- 2. The RPCs ----------
create temp table fm (k text primary key, v text);
insert into fm select 't', token from public.register('fm_' || floor(random() * 1e9)::text, 'pw123456');
insert into fm select 'a', public._auth_account(v)::text from fm where k = 't';
insert into fm select 'room', room_id::text from public.create_room('Đồng thật', 'pw', (select v from fm where k = 't'));
update public.anticheat_config set mode = 'log';
do $$
declare a uuid := (select v from fm where k = 'a')::uuid; room uuid := (select v from fm where k = 'room')::uuid;
begin
  perform public._field_open(room, now());
  update public.rat_clocks set last_k = 9000000000000000000 where room_id = room;
  insert into public.wallets (account_id, coins) values (a, 100000) on conflict (account_id) do update set coins = 100000;
  perform public._farm_do_rent(room, a, 5, now() - interval '1 hour');
  -- a nếp crop ripe for 2 h, in the variety's hours (0120: scale 1 → 0.25; transplanted 48·s + 2 h ago, sown 10·s h before)
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
  select room, 5, a, 'nep', y.sow - interval '4 hours', y.sow - interval '3 hours', y.sow, y.tp,
         jsonb_build_array(jsonb_build_object('t', y.sow - interval '4 hours', 'l', 3),
                           jsonb_build_object('t', now() - interval '5 hours', 'l', 1))
    from (select now() - make_interval(secs => (48 * v.scale + 2) * 3600) as tp,
                 now() - make_interval(secs => (58 * v.scale + 2) * 3600) as sow
            from public.rice_varieties v where v.id = 'nep') y;
  insert into public.inventory (account_id, item_id, qty) values (a, 'tool_sickle', 1), (a, 'tool_sling', 1), (a, 'ammo_pellet', 10)
  on conflict (account_id, item_id) do update set qty = excluded.qty;
  insert into public.vitals (account_id) values (a) on conflict do nothing;
  update public.vitals set hunger = 90, thirst = 90, last_tick = now() where account_id = a;
  delete from public.player_pos where account_id = a;
end $$;
-- a fixture of the given outcome, and a round begun `ago` seconds back on its seed
create or replace function pg_temp.hcase(p_outcome text) returns jsonb language sql as $$
  select x from hx, jsonb_array_elements(hx.j) x where x->'expected'->>'outcome' = p_outcome and x->>'name' like 'clean%' limit 1
$$;
create or replace function pg_temp.round(c jsonb, ago numeric) returns jsonb language plpgsql as $$
declare t text := (select v from fm where k = 't'); room uuid := (select v from fm where k = 'room')::uuid; j jsonb;
begin
  update public.player_pos set at = now() - interval '5 minutes' where account_id = (select v from fm where k = 'a')::uuid;
  j := public.begin_work(room, t, 5, 'harvest');
  assert (j->>'work_seed')::bigint = (select work_seed from public.crops where room_id = room and plot_no = 5), format('seed %s', (j - 'plots'));
  update public.crops set work_seed = (c->>'seed')::bigint, work_started_at = now() - make_interval(secs => ago)
   where room_id = room and plot_no = 5;
  return j;
end $$;

-- the harvest
do $$
declare t text := (select v from fm where k = 't'); a uuid := (select v from fm where k = 'a')::uuid;
        room uuid := (select v from fm where k = 'room')::uuid; pass jsonb := pg_temp.hcase('pass'); fl jsonb; j jsonb; w0 integer;
begin
  -- a replayed pass cuts part 1
  w0 := coalesce((select sum(wet_kg)::int from public.rice_stock where account_id = a), 0);
  perform pg_temp.round(pass, 30);
  j := public.harvest_part(room, t, 5, pg_temp.ints(pass->'toggles'), (pass->'expected'->>'ticks')::int, true);
  assert (j->'harvest_part'->>'parts')::int = 1 and j->'anticheat' is null, format('pass %s', j->'harvest_part');
  assert coalesce((select sum(wet_kg)::int from public.rice_stock where account_id = a), 0) > w0, 'rice';
  -- a failed round claimed as a pass: mismatch, nothing cut, the record cleared
  fl := (select x from hx, jsonb_array_elements(hx.j) x where x->'expected'->>'outcome' = 'fail' limit 1);
  perform pg_temp.round(fl, 30);
  j := public.harvest_part(room, t, 5, pg_temp.ints(fl->'toggles'), (fl->'expected'->>'ticks')::int, true);
  assert j->'anticheat'->>'code' = 'harvest_mismatch' and j->'harvest_part' is null, format('mismatch %s', j->'anticheat');
  assert (select work is null and harvested_parts = 1 from public.crops where room_id = room and plot_no = 5), 'cleared, nothing cut';
  -- sooner than the ticks
  perform pg_temp.round(pass, 3);
  j := public.harvest_part(room, t, 5, pg_temp.ints(pass->'toggles'), (pass->'expected'->>'ticks')::int, true);
  assert j->'anticheat'->>'code' = 'harvest_too_fast', format('too fast %s', j->'anticheat');
  -- malformed
  perform pg_temp.round(pass, 30);
  j := public.harvest_part(room, t, 5, '{9,3}', 100, true);
  assert j->'anticheat'->>'code' = 'harvest_bad_input', format('bad %s', j->'anticheat');
  -- an honest fail clears the record, unflagged
  perform pg_temp.round(pg_temp.hcase('pass'), 30);
  update public.crops set work_seed = 5 where room_id = room and plot_no = 5;                  -- the idle fixture's seed
  j := public.harvest_part(room, t, 5, '{}', 7200, false);
  assert j->'anticheat' is null and (select work is null from public.crops where room_id = room and plot_no = 5), format('fail %s', j->'anticheat');
  -- the old signature: a failure yes, a pass no
  perform pg_temp.round(pass, 30);
  begin
    perform public.harvest_part(room, t, 5, true);
    assert false, 'an old pass';
  exception when others then assert sqlerrm = 'outdated', sqlerrm;
  end;
  j := public.harvest_part(room, t, 5, false);
  assert j->'anticheat' is null, 'an old failure';
  -- far from the plot: the claim is refused
  update public.player_pos set map = 'field', x = 700, y = 400, at = now(), tabs = '{}' where account_id = a;
  j := public.harvest_part(room, t, 5, pg_temp.ints(pass->'toggles'), (pass->'expected'->>'ticks')::int, true);
  assert j->'anticheat'->>'code' = 'pos_teleport' and j->'anticheat'->>'error' = 'too far', format('far %s', j->'anticheat');
  raise notice 'harvest rpc ok';
end $$;

-- the crab
do $$
declare t text := (select v from fm where k = 't'); a uuid := (select v from fm where k = 'a')::uuid;
        room uuid := (select v from fm where k = 'room')::uuid; c jsonb; j jsonb; vid uuid; k integer := 0;
begin
  c := (select x from cx, jsonb_array_elements(cx.j) x where (x->'expected'->>'hits')::int = 3 limit 1);
  update public.player_pos set map = 'field', x = 136, y = 218, at = now() - interval '5 minutes' where account_id = a;
  delete from public.critters where account_id = a;
  j := public.crab_start(room, t, 1);
  vid := (j->'visit'->>'id')::uuid;
  assert (j->'visit'->>'seed')::bigint = (select visit_seed from public.gather_cooldowns where account_id = a and visit_id = vid),
    format('seed %s', j->'visit');
  update public.gather_cooldowns set visit_seed = (c->>'seed')::bigint, visit_at = now() - interval '30 seconds' where visit_id = vid;
  j := public.crab_finish(room, t, vid, pg_temp.ints(c->'grabs'), (c->>'ticks')::int, 3);
  assert (j->'crab'->>'hits')::int = 3 and j->'anticheat' is null, format('three %s', j);
  -- a mismatch: claimed 3 for a game that caught none
  c := (select x from cx, jsonb_array_elements(cx.j) x where (x->'expected'->>'hits')::int = 0 limit 1);
  delete from public.critters where account_id = a;
  update public.player_pos set at = now() - interval '5 minutes' where account_id = a;
  j := public.crab_start(room, t, 3);
  vid := (j->'visit'->>'id')::uuid;
  update public.gather_cooldowns set visit_seed = (c->>'seed')::bigint, visit_at = now() - interval '30 seconds' where visit_id = vid;
  j := public.crab_finish(room, t, vid, pg_temp.ints(c->'grabs'), (c->>'ticks')::int, 3);
  assert j->'anticheat'->>'code' = 'crab_mismatch' and (j->'crab'->>'hits')::int = 0, format('mismatch %s', j);
  assert not exists (select 1 from public.gather_cooldowns where visit_id = vid), 'the visit is spent';
  -- the old signature: 0 yes, a catch no
  update public.gather_cooldowns set ready_at = now() where account_id = a;
  delete from public.critters where account_id = a;
  update public.player_pos set at = now() - interval '5 minutes' where account_id = a;
  j := public.crab_start(room, t, 5);
  vid := (j->'visit'->>'id')::uuid;
  begin
    perform public.crab_finish(room, t, vid, 2);
    assert false, 'an old catch';
  exception when others then assert sqlerrm = 'outdated', sqlerrm;
  end;
  j := public.crab_finish(room, t, vid, 0);
  assert (j->'crab'->>'hits')::int = 0, 'an old empty visit';
  -- far from the hole
  update public.gather_cooldowns set ready_at = now() where account_id = a;
  update public.player_pos set map = 'field', x = 700, y = 400, at = now(), tabs = '{}' where account_id = a;
  delete from public.critters where account_id = a;
  j := public.crab_start(room, t, 2);
  assert j->'anticheat'->>'error' = 'too far', format('far %s', j);
  raise notice 'crab rpc ok';
end $$;

-- the sling
do $$
declare t text := (select v from fm where k = 't'); a uuid := (select v from fm where k = 'a')::uuid;
        room uuid := (select v from fm where k = 'room')::uuid; rid bigint; j jsonb; seed bigint; rat bigint[]; land integer;
        p0 integer := 0; n0 integer;
begin
  insert into public.field_rats (room_id, plot_no, k, seed, spawned_at) values (room, 5, -1, 4242, now() - interval '5 minutes')
  returning id into rid;
  update public.crops set rat_log = rat_log || jsonb_build_array(jsonb_build_object('r', rid, 'from', now() - interval '5 minutes', 'to', null))
   where room_id = room and plot_no = 5;
  -- too far from the rat's plot
  update public.player_pos set map = 'field', x = 700, y = 400, at = now() - interval '5 minutes' where account_id = a;
  begin
    perform public.sling_start(room, t, rid, 700, 400);
    assert false, 'far';
  exception when others then assert sqlerrm = 'too far', sqlerrm;
  end;
  j := public.sling_start(room, t, rid, 136, 210);
  seed := (j->'aim'->>'seed')::bigint;
  assert seed = (select a2.seed from public.sling_aims a2 where account_id = a) and (j->'aim'->>'rat')::bigint = rid, format('aim %s', j->'aim');
  update public.sling_aims set started_at = now() - interval '40 seconds' where account_id = a;
  -- a miss (wide), honest: the pellet goes, the rat's state moves on
  land := 400;
  rat := public._sling_rat_advance(public._sling_rat_start(seed), land);
  j := public.sling_shoot(room, t, rid, land - 18 - 45, land - 18, case when rat[1] > 160000 then 16000 else 304000 end, false);
  assert j->'anticheat' is null and (j->'shot'->>'hit')::boolean = false, format('miss %s', j->'shot');
  assert (select last_tick = land and rat_state = rat from public.sling_aims where account_id = a), 'state kept';
  -- a claimed hit that misses: mismatch, the pellet stays
  n0 := (select qty from public.inventory where account_id = a and item_id = 'ammo_pellet');
  update public.sling_aims set last_shot_at = now() - interval '5 seconds' where account_id = a;
  j := public.sling_shoot(room, t, rid, 500, 545, 16000, true);
  assert j->'anticheat'->>'code' = 'sling_mismatch' and (select qty from public.inventory where account_id = a and item_id = 'ammo_pellet') = n0,
    format('mismatch %s', j->'anticheat');
  -- a shot landing after the clock: too fast
  j := public.sling_shoot(room, t, rid, 3000, 3045, 160000, false);
  assert j->'anticheat'->>'code' = 'sling_too_fast', format('too fast %s', j->'anticheat');
  -- an overlong draw: bad input
  j := public.sling_shoot(room, t, rid, 500, 600, 160000, false);
  assert j->'anticheat'->>'code' = 'sling_bad_input', format('bad %s', j->'anticheat');
  -- the old signature: a miss yes, a hit no
  begin
    perform public.sling_shoot(room, t, rid, true);
    assert false, 'an old hit';
  exception when others then assert sqlerrm = 'outdated', sqlerrm;
  end;
  -- the hit: at the rat when the pellet lands
  land := 1200;
  rat := public._sling_rat_advance(public._sling_rat_start(seed), land);
  j := public.sling_shoot(room, t, rid, land - 18 - 45, land - 18, rat[1]::int, true);
  assert (j->'shot'->>'hit')::boolean and (j->'shot'->>'price')::int > 0 and j->'anticheat' is null, format('hit %s', j);
  assert (select ended_at is not null and how = 'sling' from public.field_rats where id = rid), 'caught';
  raise notice 'sling rpc ok';
end $$;

select 'anticheat-v2 farm smoke ok';
