-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0013, from the repo
-- root (the crop fixtures are read with \copy). Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on

create temp table smoke (k text primary key, v text);
insert into smoke select 't1', token from public.register('smoke15_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('smoke15_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('smoke15_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Đồng test', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'code', code from public.rooms where id = (select v from smoke where k = 'room')::uuid;
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't2'));
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't3'));

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---------- the crop model against the shared fixtures ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/crop-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;

create function pg_temp.fx_at(t0 timestamptz, h jsonb) returns timestamptz language sql
as $$ select t0 + make_interval(secs => (h #>> '{}')::double precision * 3600) $$;

create function pg_temp.fx_log(t0 timestamptz, a jsonb, k text) returns jsonb language sql
as $$ select coalesce(jsonb_agg(case when k = 't' then jsonb_build_object('t', pg_temp.fx_at(t0, e))
                                     else jsonb_build_object('t', pg_temp.fx_at(t0, e->0), k, e->1) end order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

create function pg_temp.fx_crop(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'variety', k->>'variety', 'prepared_at', t0,
  'soak_at', pg_temp.fx_at(t0, k->'soak'), 'sow_at', pg_temp.fx_at(t0, k->'sow'),
  'transplant_at', pg_temp.fx_at(t0, k->'transplant'), 'q_transplant', k->'q_transplant',
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'), 'picks', pg_temp.fx_log(t0, k->'picks', 't'),
  'pest_rolls', k->'pest_rolls')) $$;

do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        v public.rice_varieties; h timestamptz; y jsonb; got jsonb; want jsonb; f text;
begin
  for k in select x from jsonb_array_elements(j->'cases') x loop
    c := pg_temp.fx_crop(t0, k);
    v := public._variety(k->>'variety');
    h := pg_temp.fx_at(t0, k->'harvest');
    y := public._crop_yield(c, v, (k->>'land')::double precision, (k->>'q_harvest')::double precision, h);
    assert (y->>'kg')::int = (k->'expect'->>'kg')::int, format('%s: kg %s, want %s', k->>'name', y->>'kg', k->'expect'->>'kg');
    foreach f in array array['mcare', 'mseed', 'mwater', 'mpest', 'mlate'] loop
      assert abs((y->>f)::double precision - (k->'expect'->>f)::double precision) < 1e-12,
        format('%s: %s %s, want %s', k->>'name', f, y->>f, k->'expect'->>f);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('kind', p->>'kind',
                                                 'since_s', extract(epoch from (p->>'since')::timestamptz - t0)::int,
                                                 'treated_s', extract(epoch from (p->>'treated_at')::timestamptz - t0)::int)
                              order by (p->>'slot')::int), '[]'::jsonb)
      into got from jsonb_array_elements(public._crop_pests(c, v, h)) p;
    want := k->'expect'->'pests';
    assert got = want, format('%s: pests %s, want %s', k->>'name', got, want);
  end loop;
end $$;

do $$
declare t timestamptz := '2026-03-01 00:00:00+00'; nep public.rice_varieties := public._variety('nep');
        short public.rice_varieties := public._variety('short'); c public.crops;
begin
  -- water: the last level set, one level lower per full 12 h, never below 0; the later of two same-time entries wins
  assert public._water_at('[]'::jsonb, t) = 0, 'no log = dry';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '11 hours 59 minutes') = 3, 'no drop before 12 h';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '12 hours') = 2, 'drop at 12 h';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '100 hours') = 0, 'never below 0';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 1), jsonb_build_object('t', t, 'l', 2)), t) = 2,
    'same-time entries: the last one';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 2)), t - interval '1 second') = 0, 'before the log';

  -- phases (§8.2)
  c := jsonb_populate_record(null::public.crops, jsonb_build_object('prepared_at', t));
  assert public._crop_phase(c, null, t) = 'prepared', 'prepared';
  c.soak_at := t;
  assert public._crop_phase(c, nep, t + interval '1 hour 59 minutes') = 'soaking', 'soaking';
  assert public._crop_phase(c, nep, t + interval '2 hours') = 'sprouted', 'sprouted';
  c.sow_at := t + interval '3 hours';
  assert public._crop_phase(c, nep, t + interval '3 hours') = 'seedling', 'seedling';
  c.transplant_at := t + interval '12 hours';
  assert public._crop_phase(c, nep, t + interval '12 hours') = 'tillering', 'tillering';
  assert public._crop_phase(c, nep, t + interval '29 hours 59 minutes') = 'tillering', 'tillering until 18·s';
  assert public._crop_phase(c, nep, t + interval '30 hours') = 'panicle', 'panicle at 18·s';
  assert public._crop_phase(c, nep, t + interval '42 hours') = 'heading', 'heading at 30·s';
  assert public._crop_phase(c, nep, t + interval '52 hours') = 'ripening', 'ripening at 40·s';
  assert public._crop_phase(c, nep, t + interval '60 hours') = 'ripe', 'ripe at 48·s';
  assert public._crop_phase(c, nep, t + interval '72 hours') = 'overripe', 'overripe after 12 h ripe';
  assert public._crop_phase(c, short, t + interval '55 hours 12 minutes') = 'ripe', 'short: ripe at 43.2 h';
  assert public._crop_phase(c, short, t + interval '55 hours 11 minutes') = 'ripening', 'short: ripening before';
end $$;

-- ---------- v14 changes: the fishing shop sells fishing gear only; the fishing state lists fishing gear only ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); a1 uuid := (select v from smoke where k = 'a1')::uuid; s jsonb;
begin
  insert into public.wallets (account_id, coins) values (a1, 1000) on conflict (account_id) do update set coins = 1000;
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', t1, 'seed_short')) = 'item not available', 'seeds are not fishing gear';
  assert pg_temp.err(format('select public.buy_item(%L, %L)', t1, 'fert_urea')) = 'item not available', 'nor fertilizer';
  insert into public.inventory (account_id, item_id, qty) values (a1, 'seed_nep', 2), (a1, 'rod_bamboo', 1)
  on conflict (account_id, item_id) do update set qty = excluded.qty;
  s := public.fishing_state(t1);
  assert s->'owned' = '["rod_bamboo"]'::jsonb, format('owned lists fishing gear only: %s', s->'owned');
  assert (s->>'server_now')::timestamptz between now() - interval '1 minute' and now() + interval '1 minute', 'server_now';
  delete from public.inventory where account_id = a1;
  update public.wallets set coins = 0 where account_id = a1;
end $$;

select 'v15 crop smoke ok' as result;
