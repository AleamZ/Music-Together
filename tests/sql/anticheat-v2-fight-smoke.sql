-- tests/sql/anticheat-v2-fight-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0060, from
-- the repo root, with the fixtures' absolute paths:
--   psql -v secret=<repo>/tests/fixtures/fight-secret-cases.json -v kata=<repo>/tests/fixtures/kata-noise-cases.json -f …
-- It re-runs 0060 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0060_fight_secrets.sql
\i supabase/migrations/0060_fight_secrets.sql
reset client_min_messages;

create temp table sx as select pg_read_file(:'secret')::jsonb j;
create temp table kx as select pg_read_file(:'kata')::jsonb j;
create or replace function pg_temp.ints(v jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(v) with ordinality t(x, o)
$$;
-- the fixtures' stand-in for _fx_bot_seed (scripts/gen-anticheat-v2-fixtures.ts fixtureSeed)
create or replace function pg_temp.fseed(c integer, r integer) returns integer language sql immutable as $$
  select case when v >= 2147483648 then v - 4294967296 else v end::integer
    from (select (r::bigint * 2654435761 + c::bigint * 40503) % 4294967296 v) x
$$;

-- ---------- 1. The secret-bot fixtures: _fx_step_secret, re-seeded every round = stepWithSecretBots ----------
do $$
declare c jsonb; m integer[] := public._fx_moves(); s integer[]; a integer[]; n integer; k integer; r integer[];
        rng integer; rnd integer; checks integer; hs jsonb; cases integer := 0;
begin
  for c in select jsonb_array_elements(j) from sx loop
    n := (c->>'frames')::int;
    a := public._fx_runs_decode(pg_temp.ints(c->'runs'), 30900);
    s := public._fx_new(c->'params');
    assert s[5 + 1] = 0 and s[10 + 1] = 0, 'a secret match keeps no seed in its state';
    hs := c->'expected'->'hashes';
    checks := 0;
    rnd := null;
    for k in 1 .. n loop
      if s[3 + 1] is distinct from rnd then rnd := s[3 + 1]; rng := pg_temp.fseed((c->>'no')::int, rnd); end if;
      r := public._fx_step_secret(s, a[k], 0, m, rng);
      s := r[1:176];
      rng := r[177];
      assert s[5 + 1] = 0, 'G_RNG stays 0';
      if k % 600 = 0 then
        assert public._fx_hash(s) = (hs->checks->>1)::bigint, format('%s: frame %s', c->>'name', k);
        checks := checks + 1;
      end if;
    end loop;
    assert public._fx_hash(s) = (c->'expected'->>'hash')::bigint, format('%s: final hash', c->>'name');
    assert public._fx_rounds_json(s) = c->'expected'->'rounds', format('%s: rounds %s', c->>'name', public._fx_rounds_json(s));
    assert s[7 + 1] = (c->'expected'->>'result')::int, format('%s: result', c->>'name');
    cases := cases + 1;
  end loop;
  assert cases >= 5, format('only %s cases', cases);
  raise notice 'secret fixtures ok: % cases', cases;
end $$;

-- the secret: one row, no grants; the seed: an int32, per match and round
do $$
declare m1 uuid := gen_random_uuid(); m2 uuid := gen_random_uuid();
begin
  assert (select count(*) from public.ac_secrets) = 1 and length((select secret from public.ac_secrets)) >= 64, 'one secret';
  assert not has_table_privilege('anon', 'public.ac_secrets', 'select')
     and not has_table_privilege('authenticated', 'public.ac_secrets', 'select'), 'nobody reads it';
  assert not has_function_privilege('anon', 'public._fx_bot_seed(uuid, integer)', 'execute'), 'nor the seed';
  assert public._fx_bot_seed(m1, 1) = public._fx_bot_seed(m1, 1), 'stable';
  assert public._fx_bot_seed(m1, 1) <> public._fx_bot_seed(m1, 2) and public._fx_bot_seed(m1, 1) <> public._fx_bot_seed(m2, 1), 'varies';
  raise notice 'secret ok';
end $$;

-- ---------- 2. The kata fixtures: _kata_reveal / _kata_offsets / _kata_robotic = kata.ts ----------
do $$
declare c jsonb; ch integer[]; b public.martial_belts; n integer := 0; rob integer := 0;
begin
  for c in select jsonb_array_elements(j) from kx loop
    select * into b from public.martial_belts where style = 'vovinam' and rank = (c->>'rank')::int;
    ch := public._kata_chart((c->>'seed')::bigint, b.kata_notes, b.kata_tpb, (c->>'rank')::int >= 3);
    assert public._kata_reveal(ch, (c->>'upto')::int) = pg_temp.ints(c->'expected'->'reveal'), format('%s: reveal', c->>'name');
    assert public._kata_offsets(ch, pg_temp.ints(c->'presses')) = pg_temp.ints(c->'expected'->'offsets'), format('%s: offsets', c->>'name');
    assert public._kata_robotic(pg_temp.ints(c->'expected'->'offsets')) = (c->'expected'->>'robotic')::boolean, format('%s: robotic', c->>'name');
    n := n + 1;
    if (c->'expected'->>'robotic')::boolean then rob := rob + 1; end if;
  end loop;
  assert n >= 40 and rob >= 3, format('%s cases, %s robotic', n, rob);
  raise notice 'kata fixtures ok: % cases, % robotic', n, rob;
end $$;

-- ---------- 3. The flow ----------
create temp table fk (k text primary key, v text);
insert into fk select 't', token from public.register('fs_' || floor(random() * 1e9)::text, 'pw123456');
insert into fk select 'a', public._auth_account(v)::text from fk where k = 't';
update public.anticheat_config set mode = 'log';
do $$
declare t text := (select v from fk where k = 't'); a uuid := (select v from fk where k = 'a')::uuid;
begin
  insert into public.characters (account_id, skin, hair, hair_color, shoes) values (a, 'warm', 'short', 'black', 'shoes_dep_blue');
  insert into public.vitals (account_id) values (a) on conflict do nothing;
  perform public._wallet_lock(a);
  perform public._pay(a, 500000, 'daily', 'smoke');
  perform public.dojo_enroll(t, 'vovinam');
  perform public.fight_wear_uniform(t, 'vovinam');
end $$;
-- a fresh exam at target rank p_target (the gates cleared)
create or replace function pg_temp.exam(p_target integer) returns jsonb language plpgsql as $$
declare t text := (select v from fk where k = 't'); a uuid := (select v from fk where k = 'a')::uuid;
begin
  update public.martial_exams set status = 'failed' where account_id = a and status in ('kata', 'spar');
  update public.martial_enrollments set rank = p_target - 1, exam_cooldown_until = null, rank_at = now() - interval '200 hours'
   where account_id = a and style = 'vovinam';
  update public.vitals set hunger = 90, thirst = 90, last_tick = now(), fainted_until = null where account_id = a;
  return public.dojo_exam_start(t, 'vovinam');
end $$;
create or replace function pg_temp.chart(p_exam uuid) returns integer[] language plpgsql as $$
declare ex public.martial_exams; b public.martial_belts;
begin
  select * into ex from public.martial_exams where id = p_exam;
  select * into b from public.martial_belts where style = ex.style and rank = ex.target_rank;
  return public._kata_chart(ex.kata_seed, b.kata_notes, b.kata_tpb, ex.target_rank >= 3);
end $$;

-- the chart is revealed as it plays
do $$
declare t text := (select v from fk where k = 't'); j jsonb; ex uuid; ch integer[]; n jsonb;
begin
  j := pg_temp.exam(1);
  ex := (j->>'exam_id')::uuid;
  ch := pg_temp.chart(ex);
  assert not (j ? 'kata_seed') and (j->>'kata_length')::int = ch[cardinality(ch) - 1] + 30, format('start %s', j - 'state');
  assert pg_temp.ints(j->'chart') = public._kata_reveal(ch, 240) and cardinality(pg_temp.ints(j->'chart')) < cardinality(ch),
    'only the first notes';
  assert not (j->'state'->'exam' ? 'kata_seed') and (j->'state'->'exam'->>'kata_length')::int = ch[cardinality(ch) - 1] + 30,
    format('state %s', j->'state'->'exam');
  n := public.dojo_kata_notes(t, ex);
  assert (n->>'upto')::int = 240 and pg_temp.ints(n->'chart') = public._kata_reveal(ch, 240) and (n->>'total')::int = 18, format('notes now %s', n);
  update public.martial_exams set started_at = now() - interval '10 seconds' where id = ex;
  n := public.dojo_kata_notes(t, ex);
  assert (n->>'upto')::int = 840 and pg_temp.ints(n->'chart') = public._kata_reveal(ch, 840), format('10 s in %s', n);
  update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
  n := public.dojo_kata_notes(t, ex);
  assert pg_temp.ints(n->'chart') = ch, 'all of it at the end';
  update public.martial_exams set status = 'failed' where id = ex;
  n := public.dojo_kata_notes(t, ex);
  assert n->>'status' = 'failed' and not (n ? 'chart'), 'a settled exam reveals nothing';
  raise notice 'reveal ok';
end $$;

-- robotic timing: soft twice, the 3rd fails the attempt (hard)
do $$
declare t text := (select v from fk where k = 't'); a uuid := (select v from fk where k = 'a')::uuid; j jsonb; ex uuid; k integer;
begin
  delete from public.anticheat_events where account_id = a and code like 'kata_robotic%';
  for k in 1 .. 3 loop
    j := pg_temp.exam(3);
    ex := (j->>'exam_id')::uuid;
    update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
    j := public.dojo_kata_submit(t, ex, pg_temp.chart(ex));
    if k < 3 then
      assert (j->>'passed')::boolean and j->'anticheat' is null, format('soft %s: %s', k, j - 'state');
    else
      assert not (j->>'passed')::boolean and j->'anticheat'->>'code' = 'kata_robotic_repeat', format('the 3rd %s', j - 'state');
    end if;
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = a and code = 'kata_robotic' and outcome = 'soft') = 3, 'three soft';
  raise notice 'robotic ok';
end $$;

-- the sparring match: seed 0 and the secret stream; the answers carry the public sim, never a seed; no hash compared
do $$
declare t text := (select v from fk where k = 't'); a uuid := (select v from fk where k = 'a')::uuid; j jsonb; ex uuid;
        mid uuid; m integer[] := public._fx_moves(); s integer[]; r integer[]; rng integer; rnd integer; k integer;
begin
  delete from public.anticheat_events where account_id = a and code like 'kata_robotic%';
  j := pg_temp.exam(1);
  ex := (j->>'exam_id')::uuid;
  update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
  j := public.dojo_kata_submit(t, ex, (select array_agg(case when i % 2 = 1 then v + (i % 7)::int - 3 else v end order by i)
                                         from unnest(pg_temp.chart(ex)) with ordinality u(v, i)));
  assert (j->>'passed')::boolean and (j->'match'->'params'->>'seed')::int = 0 and (j->'match'->'params'->>'secretBot')::boolean,
    format('secret params %s', j->'match');
  mid := (j->'match'->>'id')::uuid;
  update public.fight_matches set started_at = now() - interval '50 seconds' where id = mid;
  -- 600 idle frames, with a hash that cannot match: no resync, no flag
  for k in 0 .. 9 loop
    j := public.fight_push(t, mid, k * 60, '{0,60}', null, null, (k + 1) * 60, 12345, 0);
    assert j->'anticheat' is null and not (j->>'resync')::boolean, format('push %s: %s', k, j);
    assert jsonb_array_length(j->'sim') = 176 and (j->'sim'->>5)::int = 0 and (j->'sim'->>10)::int = 0, 'the public sim';
  end loop;
  assert (select bad_hashes from public.fight_logs where match_id = mid and side = 1) = 0, 'no hash compared';
  assert (select bot_rng is not null and bot_round = 1 from public.fight_matches where id = mid), 'the stream is kept';
  -- the server's sim is the secret stream's
  s := public._fx_new((select params from public.fight_matches where id = mid));
  rnd := null;
  for k in 1 .. 600 loop
    if s[3 + 1] is distinct from rnd then rnd := s[3 + 1]; rng := public._fx_bot_seed(mid, rnd); end if;
    r := public._fx_step_secret(s, 0, 0, m, rng);
    s := r[1:176];
    rng := r[177];
  end loop;
  assert s = (select sim from public.fight_matches where id = mid), 'replayed with _fx_bot_seed';
  assert rng = (select bot_rng from public.fight_matches where id = mid), 'the stream carried';
  j := public.fight_state(t, mid);
  assert (j->'params'->>'seed')::int = 0 and (j->'sim'->>5)::int = 0, 'fight_state has no seed either';
  perform public.fight_forfeit(t, mid);
  raise notice 'secret match ok';
end $$;

-- superhuman: a new button 2 frames after every bot move start — hard, and the match is lost
do $$
declare t text := (select v from fk where k = 't'); a uuid := (select v from fk where k = 'a')::uuid; j jsonb; ex uuid;
        mid uuid; m integer[] := public._fx_moves(); s integer[]; r integer[]; rng integer; rnd integer; k integer;
        masks integer[] := '{}'; press_at integer := -1; starts integer := 0; off integer; hard boolean := false;
begin
  j := pg_temp.exam(1);
  ex := (j->>'exam_id')::uuid;
  update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
  j := public.dojo_kata_submit(t, ex, (select array_agg(case when i % 2 = 1 then v + (i % 7)::int - 3 else v end order by i)
                                         from unnest(pg_temp.chart(ex)) with ordinality u(v, i)));
  mid := (j->'match'->>'id')::uuid;
  update public.fight_matches set started_at = now() - interval '50 seconds' where id = mid;
  -- the cheat: it sees the bot's move start and answers 2 frames later
  s := public._fx_new((select params from public.fight_matches where id = mid));
  rnd := null;
  for k in 0 .. 2999 loop
    masks := masks || case when k = press_at then 16 else 0 end;
    if s[3 + 1] is distinct from rnd then rnd := s[3 + 1]; rng := public._fx_bot_seed(mid, rnd); end if;
    r := public._fx_step_secret(s, masks[k + 1], 0, m, rng);
    s := r[1:176];
    rng := r[177];
    if (s[113 + 7] = 9 or s[113 + 7] = 10) and s[113 + 8] = 1 then press_at := k + 2; starts := starts + 1; end if;
    exit when s[1 + 1] = 3;
  end loop;
  assert starts > 30, format('bot move starts %s', starts);
  off := 0;
  while off < cardinality(masks) loop
    j := public.fight_push(t, mid, off, public._fx_runs_encode(masks[off + 1 : least(off + 60, cardinality(masks))]), null, null, null, null, 0);
    if j->'anticheat'->>'code' = 'fight_superhuman' then hard := true; exit; end if;
    exit when j->>'status' <> 'live';
    off := off + 60;
  end loop;
  assert hard and j->>'status' = 'done' and (j->'result'->>'winner')::int = 2 and j->'result'->>'end_reason' = 'forfeit',
    format('superhuman %s', j);
  assert exists (select 1 from public.anticheat_events where account_id = a and code = 'fight_superhuman' and outcome <> 'soft'), 'hard';
  assert (select ac[2] > 24 and ac[2] > 3 * coalesce(ac[5], 0) + 8 and ac[6] = 1 from public.fight_logs where match_id = mid and side = 1),
    format('counts %s', (select ac from public.fight_logs where match_id = mid and side = 1));
  raise notice 'superhuman ok';
end $$;

-- a masher (a jab every 7 frames, whatever the bot does) hits the fast window and the control alike: never hard
do $$
declare t text := (select v from fk where k = 't'); a uuid := (select v from fk where k = 'a')::uuid; j jsonb; ex uuid;
        mid uuid; masks integer[]; off integer; n0 bigint;
begin
  n0 := (select count(*) from public.anticheat_events where account_id = a and code = 'fight_superhuman' and outcome <> 'soft');
  j := pg_temp.exam(1);
  ex := (j->>'exam_id')::uuid;
  update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
  j := public.dojo_kata_submit(t, ex, (select array_agg(case when i % 2 = 1 then v + (i % 7)::int - 3 else v end order by i)
                                         from unnest(pg_temp.chart(ex)) with ordinality u(v, i)));
  mid := (j->'match'->>'id')::uuid;
  update public.fight_matches set started_at = now() - interval '50 seconds' where id = mid;
  masks := array(select case when k % 7 = 0 then 16 else 0 end from generate_series(0, 2999) k);
  off := 0;
  while off < 3000 loop
    j := public.fight_push(t, mid, off, public._fx_runs_encode(masks[off + 1 : off + 60]), null, null, null, null, 0);
    exit when j->>'status' <> 'live';
    off := off + 60;
  end loop;
  assert j->'anticheat' is null or j->'anticheat'->>'code' <> 'fight_superhuman', format('masher %s', j);
  assert (select count(*) from public.anticheat_events where account_id = a and code = 'fight_superhuman' and outcome <> 'soft') = n0,
    format('never hard: %s', (select ac from public.fight_logs where match_id = mid and side = 1));
  raise notice 'masher ok: %', (select ac from public.fight_logs where match_id = mid and side = 1);
end $$;

select 'anticheat-v2 fight smoke ok';
