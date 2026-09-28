-- tests/sql/fight-engine-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain (0004 …
-- 0055, 0014 before 0013), from the repo root, with the fixture's absolute path:
--   psql -v fixtures=<repo>/tests/fixtures/fight-cases.json -f <this file>
-- It no longer re-applies 0048 (that would put back 0048's _fx_new / _fx_reset over 0052's): the chain's re-runnability is
-- tests/sql/v20-rerun.sql. Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on

-- ---------- 1. The shared fixtures: _fx_run = runFrames (tests/unit/fight-fixtures.test.ts) ----------
-- Each case is replayed in 300-frame chunks, as fight_push's streamed replay does (ruling R3), checking the hash at
-- every 600th frame, then the final hash, the per-round results and the match result.
create temp table fx as select pg_read_file(:'fixtures')::jsonb j;

create or replace function pg_temp.ints(a jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(a) with ordinality t(x, o)
$$;
create or replace function pg_temp.rounds(s integer[]) returns jsonb language plpgsql immutable as $$
declare out_ jsonb := '[]'; r integer; code integer;
begin
  for r in 0..4 loop
    code := s[12 + r * 4 + 1];
    exit when code = 0;
    out_ := out_ || jsonb_build_array(jsonb_build_object('reason', code >> 2, 'winner', code & 3,
      'hp1', s[12 + r * 4 + 2], 'hp2', s[12 + r * 4 + 3], 'frame', s[12 + r * 4 + 4]));
  end loop;
  return out_;
end $$;

do $$
declare
  c jsonb; m integer[] := public._fx_moves(); s integer[]; a integer[]; b integer[]; n integer; off integer;
  len integer; checks integer; cases integer := 0; frames bigint := 0; t0 timestamptz; ms numeric; worst numeric := 0;
  worst_case text; hs jsonb;
begin
  for c in select jsonb_array_elements(j) from fx loop
    n := (c->>'frames')::int;
    a := public._fx_runs_decode(pg_temp.ints(c->'p1'), 30900);
    b := public._fx_runs_decode(pg_temp.ints(c->'p2'), 30900);
    assert a is not null and b is not null, format('%s: the logs do not decode', c->>'name');
    assert public._fx_runs_error(pg_temp.ints(c->'p1'), 30900) is null and public._fx_runs_error(pg_temp.ints(c->'p2'), 30900) is null,
      format('%s: an honest log is refused', c->>'name');
    if cardinality(a) < n then a := a || array_fill(0, array[n - cardinality(a)]); end if;
    if cardinality(b) < n then b := b || array_fill(0, array[n - cardinality(b)]); end if;
    s := public._fx_new(c->'params');
    hs := c->'expected'->'hashes';
    checks := 0;
    off := 0;
    while off < n loop
      len := least(300, n - off);
      t0 := clock_timestamp();
      s := public._fx_run(s, a[off + 1 : off + len], b[off + 1 : off + len], m);
      ms := extract(epoch from clock_timestamp() - t0) * 1000;
      if len = 300 and ms > worst then worst := ms; worst_case := format('%s @%s', c->>'name', off); end if;
      off := off + len;
      if off % 600 = 0 then
        assert public._fx_hash(s) = (hs->checks->>1)::bigint and (hs->checks->>0)::int = off,
          format('%s: frame %s hash sql %s, ts %s', c->>'name', off, public._fx_hash(s), hs->checks);
        checks := checks + 1;
      end if;
    end loop;
    assert checks = jsonb_array_length(hs), format('%s: %s checkpoints of %s', c->>'name', checks, jsonb_array_length(hs));
    assert public._fx_hash(s) = (c->'expected'->>'hash')::bigint,
      format('%s: final hash sql %s, ts %s', c->>'name', public._fx_hash(s), c->'expected'->>'hash');
    assert pg_temp.rounds(s) = c->'expected'->'rounds',
      format('%s: rounds sql %s, ts %s', c->>'name', pg_temp.rounds(s), c->'expected'->'rounds');
    assert s[7 + 1] = (c->'expected'->>'result')::int, format('%s: result %s', c->>'name', s[7 + 1]);
    cases := cases + 1;
    frames := frames + n;
  end loop;
  assert cases >= 40, format('only %s cases', cases);
  raise notice 'fixtures ok: % cases, % frames; slowest 300-frame chunk % ms (%)', cases, frames, round(worst, 1), worst_case;
end $$;

-- one 300-frame chunk of a busy bot fight runs well inside the anon role's statement timeout (ruling R3: < 150 ms)
do $$
declare
  c jsonb; m integer[] := public._fx_moves(); s integer[]; a integer[]; b integer[]; t0 timestamptz; ms numeric;
  best numeric := 1e9; k integer;
begin
  select e into c from fx, jsonb_array_elements(j) e where e->>'name' = 'bots-vinhxuan-8-vs-karate-8';
  a := public._fx_runs_decode(pg_temp.ints(c->'p1'), 30900);
  b := public._fx_runs_decode(pg_temp.ints(c->'p2'), 30900);
  s := public._fx_run(public._fx_new(c->'params'), a[1:600], b[1:600], m);
  for k in 1..3 loop
    t0 := clock_timestamp();
    perform public._fx_run(s, a[601:900], b[601:900], public._fx_moves());
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    best := least(best, ms);
  end loop;
  raise notice 'a 300-frame chunk (with _fx_moves()): % ms', round(best, 1);
  assert best < 150, format('a 300-frame chunk took %s ms', best);
end $$;

-- ---------- 2. The table, the PRNG it will use, the hash of a fresh state ----------
do $$
declare s integer[];
begin
  assert cardinality(public._fx_moves()) = 4736, 'the move table';
  s := public._fx_new('{"seed": 4294967295, "rounds": 1, "maxRounds": 9, "p1": {"style": 3, "hpPct": 150}, "p2": {}}');
  assert cardinality(s) = 176 and s[5 + 1] = -1 and s[10 + 1] = -1, format('seed as int32: %s', s[6]);
  assert s[8 + 1] = 1 and s[9 + 1] = 5, 'rounds and maxRounds';
  assert s[49 + 5] = 1500 and s[49 + 51] = 1500 and s[113 + 5] = 1000, 'hp';
  assert s[49 + 48] = 3 and s[49 + 50] = 1, 'style and the default moves mask';
  assert (public._fx_step(s, 0, 0, public._fx_moves()))[1] = 1, 'a frame';
  assert public._fx_hash('{}') = 2166136261, 'FNV offset basis';
  assert public._fx_hash('{0}') = 1268118805, format('hash {0} = %s', public._fx_hash('{0}'));
  assert public._fx_hash('{-1}') = 3809873841, format('hash {-1} = %s', public._fx_hash('{-1}'));
end $$;

-- ---------- 3. Logs: decode limits and the error codes (log.ts runsError) ----------
do $$
declare fast integer[]; burst integer[]; steady integer[];
begin
  fast := array(select case when g % 2 = 0 then (case when (g / 2) % 2 = 1 then 16 else 0 end) else 2 end from generate_series(0, 41) g);
  burst := array(select case when g % 2 = 0 then (case when (g / 2) % 2 = 1 then 16 else 0 end) else 2 end from generate_series(0, 43) g);
  steady := array(select case when g % 2 = 0 then (case when (g / 2) % 2 = 1 then 16 else 0 end) else 3 end from generate_series(0, 119) g);
  assert public._fx_runs_decode('{0,3,16,2}', 10) = '{0,0,0,16,16}', 'decode';
  assert cardinality(public._fx_runs_decode('{0,300}', 300)) = 300, 'at the limit';
  assert public._fx_runs_decode('{0,300,1,1}', 300) is null, 'over the limit';
  assert public._fx_runs_decode('{0}', 10) is null, 'odd';
  assert public._fx_runs_decode('{2048,1}', 10) is null, 'mask';
  assert public._fx_runs_decode('{1,0}', 10) is null, 'count';
  assert public._fx_runs_decode('{}', 10) = '{}', 'empty';
  assert public._fx_runs_error('{0,10,16,1,0,5}', 300) is null, 'fine';
  assert public._fx_runs_error('{0,10,16}', 300) = 'odd', 'odd';
  assert public._fx_runs_error('{1024,1}', 300) = 'mask', 'mask';
  assert public._fx_runs_error('{-1,1}', 300) = 'mask', 'negative mask';
  assert public._fx_runs_error('{1,NULL}', 300) = 'count', 'a null count';
  assert public._fx_runs_error('{1,0}', 300) = 'count', 'count';
  assert public._fx_runs_error('{1,301}', 300) = 'too_long', 'too long';
  assert public._fx_runs_error('{{0,1},{2,3}}', 300) = 'shape', '2-d';
  assert public._fx_runs_error('[2:3]={0,1}', 300) = 'shape', 'lower bound';
  assert public._fx_runs_error(fast, 300) is null, format('20 changes in 42 frames: %s', public._fx_runs_error(fast, 300));
  assert public._fx_runs_error(burst, 300) = 'rate', '21 changes in 44 frames';
  assert public._fx_runs_error(steady, 300) is null, 'one change per 3 frames';
  assert public._fx_runs_error(array(select case when g % 2 = 0 then 16 else 1 end from generate_series(0, 79) g), 300) is null,
    'equal adjacent runs are not changes';
end $$;

-- ---------- 4. Private ----------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p where p.proname like '\_fx\_%' and p.pronamespace = 'public'::regnamespace loop
    assert not has_function_privilege('anon', f, 'execute'), format('anon can call %s', f);
    assert not has_function_privilege('authenticated', f, 'execute'), format('authenticated can call %s', f);
  end loop;
end $$;

select 'fight engine smoke ok' as result;
