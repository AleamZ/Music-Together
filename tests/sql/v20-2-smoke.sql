-- tests/sql/v20-2-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain (0004 … 0055,
-- 0014 before 0013), from the repo root, with the fixtures' absolute paths:
--   psql -v kata=<repo>/tests/fixtures/kata-cases.json -v bots=<repo>/tests/fixtures/fight-bot-cases.json -f <this file>
-- It no longer re-applies 0049 / 0050 (their older bodies and ledger would replace 0051's and 0052's): the chain's
-- re-runnability is tests/sql/v20-rerun.sql. Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';

create temp table kx as select pg_read_file(:'kata')::jsonb j;
create temp table bx as select pg_read_file(:'bots')::jsonb j;
create or replace function pg_temp.ints(a jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(a) with ordinality t(x, o)
$$;

-- ---------- 1. The kata fixtures: _kata_chart / _kata_input_error / _kata_score = kata.ts ----------
do $$
declare c jsonb; chart integer[]; err text; sc integer[]; b public.martial_belts; n integer := 0;
begin
  for c in select jsonb_array_elements(j) from kx loop
    select * into b from public.martial_belts where style = 'vovinam' and rank = (c->>'rank')::int;
    chart := public._kata_chart((c->>'seed')::bigint, b.kata_notes, b.kata_tpb, (c->>'rank')::int >= 3);
    assert chart = pg_temp.ints(c->'chart'), format('%s: chart', c->>'name');
    assert chart[cardinality(chart) - 1] + 30 = (c->>'length')::int, format('%s: length', c->>'name');
    err := public._kata_input_error(chart, pg_temp.ints(c->'presses'));
    assert err is not distinct from (c->'expected'->>'error'), format('%s: error sql %s ts %s', c->>'name', err, c->'expected'->>'error');
    if err is null then
      sc := public._kata_score(chart, pg_temp.ints(c->'presses'));
      assert sc = pg_temp.ints(c->'expected'->'score'), format('%s: score sql %s ts %s', c->>'name', sc, c->'expected'->'score');
    end if;
    n := n + 1;
  end loop;
  assert n >= 100, format('only %s kata cases', n);
  raise notice 'kata fixtures ok: % cases', n;
end $$;

-- ---------- 2. The bot fixtures: _fx_run_bots in 300-frame chunks = stepWithBots ----------
do $$
declare c jsonb; m integer[] := public._fx_moves(); s integer[]; a integer[]; z integer[]; n integer; off integer; len integer;
        checks integer; hs jsonb; t0 timestamptz; ms numeric; worst numeric := 0; cases integer := 0;
begin
  for c in select jsonb_array_elements(j) from bx loop
    n := (c->>'frames')::int;
    a := public._fx_runs_decode(pg_temp.ints(c->'runs'), 30900);
    assert cardinality(a) = n and public._fx_runs_error(pg_temp.ints(c->'runs'), 30900) is null, format('%s: log', c->>'name');
    s := public._fx_new(c->'params');
    hs := c->'expected'->'hashes';
    checks := 0;
    off := 0;
    while off < n loop
      len := least(300, n - off);
      z := array_fill(0, array[len]);
      t0 := clock_timestamp();
      if c->>'player' = 'p1' then s := public._fx_run_bots(s, a[off + 1 : off + len], z, m);
      else s := public._fx_run_bots(s, z, a[off + 1 : off + len], m); end if;
      ms := extract(epoch from clock_timestamp() - t0) * 1000;
      if len = 300 and ms > worst then worst := ms; end if;
      off := off + len;
      if off % 600 = 0 then
        assert public._fx_hash(s) = (hs->checks->>1)::bigint, format('%s: frame %s hash sql %s, ts %s', c->>'name', off, public._fx_hash(s), hs->checks);
        checks := checks + 1;
      end if;
    end loop;
    assert checks = jsonb_array_length(hs), format('%s: checkpoints', c->>'name');
    assert public._fx_hash(s) = (c->'expected'->>'hash')::bigint, format('%s: final hash sql %s ts %s', c->>'name', public._fx_hash(s), c->'expected'->>'hash');
    assert public._fx_rounds_json(s) = c->'expected'->'rounds', format('%s: rounds %s', c->>'name', public._fx_rounds_json(s));
    assert s[7 + 1] = (c->'expected'->>'result')::int, format('%s: result', c->>'name');
    cases := cases + 1;
  end loop;
  assert cases >= 18, format('only %s bot cases', cases);
  assert worst < 150, format('a 300-frame bot chunk took %s ms', worst);
  raise notice 'bot fixtures ok: % cases; slowest 300-frame chunk % ms', cases, round(worst, 1);
end $$;

-- runs helpers
do $$ begin
  assert public._fx_runs_slice('{0,3,16,2,64,5}', 2, 4) = '{0,16,16,64}', 'slice';
  assert public._fx_runs_slice('{0,3}', 2, 4) = '{0,0,0,0}', 'slice past the end';
  assert public._fx_runs_slice('{}', 0, 2) = '{0,0}', 'slice of nothing';
  assert public._fx_runs_encode('{1,1,2,2,2,1}') = '{1,2,2,3,1,1}', 'encode';
  assert public._fx_runs_encode('{}') = '{}', 'encode nothing';
  assert public._fx_bot_script(1) = '{80}' and cardinality(public._fx_bot_script(8)) = 34, 'scripts';
  assert public._fx_bot_script(100 + 1 * 8 + 1) = '{8,10,18}', 'QCF+P';
end $$;

-- ---------- 3. Two players ----------
create temp table tk (k text primary key, v text);
insert into tk select 'a', token from public.register('dojo_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into tk select 'b', token from public.register('dojo_b_' || floor(random() * 1e9)::text, 'pw123456');
create temp view who as select (select v from tk where k = 'a') t, (select v from tk where k = 'b') t2,
  public._auth_account((select v from tk where k = 'a')) a, public._auth_account((select v from tk where k = 'b')) a2;
insert into public.characters (account_id, skin, hair, hair_color, shoes) select a, 'warm', 'short', 'black', 'shoes_dep_blue' from who;
insert into public.characters (account_id, skin, hair, hair_color, shoes) select a2, 'warm', 'short', 'black', 'shoes_dep_blue' from who;
insert into public.vitals (account_id) select a from who on conflict do nothing;
insert into public.vitals (account_id) select a2 from who on conflict do nothing;

-- a helper: the perfect presses of an exam's chart
create or replace function pg_temp.perfect(p_exam uuid) returns integer[] language plpgsql as $$
declare ex public.martial_exams; b public.martial_belts;
begin
  select * into ex from public.martial_exams where id = p_exam;
  select * into b from public.martial_belts where style = ex.style and rank = ex.target_rank;
  return public._kata_chart(ex.kata_seed, b.kata_notes, b.kata_tpb, ex.target_rank >= 3);
end $$;
-- start an exam and pass its kata (the exam's clock moved back so the pacing holds); returns the match id
create or replace function pg_temp.to_spar(p_tok text, p_style text) returns uuid language plpgsql as $$
declare j jsonb; ex uuid; acc uuid := public._auth_account(p_tok);
begin
  update public.martial_enrollments set exam_cooldown_until = null, rank_at = now() - interval '200 hours' where account_id = acc and style = p_style;
  j := public.dojo_exam_start(p_tok, p_style);
  ex := (j->>'exam_id')::uuid;
  update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
  j := public.dojo_kata_submit(p_tok, ex, pg_temp.perfect(ex));
  assert (j->>'passed')::boolean, format('kata pass: %s', j);
  return (j->'match'->>'id')::uuid;
end $$;
-- put a fixture's params on a live match and move its clock back 50 s (3 060 frames may be pushed; the 60 s abandon rule
-- has not run out)
create or replace function pg_temp.use_fixture(p_match uuid, p_name text) returns jsonb language plpgsql as $$
declare c jsonb;
begin
  select e into c from bx, jsonb_array_elements(j) e where e->>'name' = p_name;
  update public.fight_matches set params = c->'params', sim = public._fx_new(c->'params'), sim_frame = 0,
    sim_hash = public._fx_hash(public._fx_new(c->'params')), started_at = now() - interval '50 seconds' where id = p_match;
  return c;
end $$;

-- ---------- 4. Enrolling ----------
do $$ declare x who; j jsonb; ok boolean := false; begin
  select * into x from who;
  j := public.dojo_state(x.t);
  assert jsonb_array_length(j->'styles') = 7 and jsonb_array_length(j->'styles'->0->'belts') = 5, format('styles: %s', j->'styles'->0);
  assert j->'enrollments' = '[]'::jsonb and j->'exam' = 'null'::jsonb and (j->>'tuition')::int = 2000, 'empty';
  begin perform public.dojo_enroll(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'insufficient funds'; end;
  assert ok, 'no money';
  perform public._wallet_lock(x.a);
  perform public._pay(x.a, 100000, 'daily', 'smoke');
  ok := false;
  begin perform public.dojo_enroll(x.t, 'kungfu'); exception when others then ok := sqlerrm = 'unknown style'; end;
  assert ok, 'unknown style';
  j := public.dojo_enroll(x.t, 'vovinam');
  assert (j->>'coins')::int = 98000 and j->'enrollments'->0->>'style' = 'vovinam' and (j->'enrollments'->0->>'rank')::int = 0, format('enrolled: %s', j);
  assert j->'uniforms' = '["vp_vovinam"]'::jsonb, 'the uniform';
  ok := false;
  begin perform public.dojo_enroll(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'already enrolled'; end;
  assert ok, 'double enroll';
  assert (select count(*) from public.coin_ledger where account_id = x.a and reason = 'dojo_tuition' and delta = -2000) = 1, 'tuition ledger';
end $$;

-- ---------- 5. Wear and unwear; the uniform can't be bought, sold or given ----------
do $$ declare x who; j jsonb; ok boolean; begin
  select * into x from who;
  insert into public.account_items (account_id, item_id) values (x.a, 'fm_kimono');
  update public.characters set outfit = 'fm_kimono' where account_id = x.a;
  ok := false;
  begin perform public.fight_wear_uniform(x.t, 'karate'); exception when others then ok := sqlerrm = 'not enrolled'; end;
  assert ok, 'not enrolled';
  j := public.fight_wear_uniform(x.t, 'vovinam');
  assert j->>'outfit' = 'vp_vovinam' and j->>'prev_outfit' = 'fm_kimono', format('wear: %s', j);
  j := public.fight_wear_uniform(x.t, 'vovinam');                                       -- again: the kimono is still remembered
  assert j->>'prev_outfit' = 'fm_kimono', 'wear twice';
  j := public.fight_unwear_uniform(x.t);
  assert j->>'outfit' = 'fm_kimono' and (select outfit from public.characters where account_id = x.a) = 'fm_kimono', format('unwear: %s', j);
  perform public.fight_wear_uniform(x.t, 'vovinam');
  ok := false; begin perform public.buy_fashion_item(x.t, 'vp_karate'); exception when others then ok := sqlerrm = 'uniform'; end;
  assert ok, 'buy';
  ok := false; begin perform public.sell_fashion_item(x.t, 'vp_vovinam'); exception when others then ok := sqlerrm = 'uniform'; end;
  assert ok, 'sell';
  ok := false; begin perform public.transfer_fashion_item(x.t, x.a2, 'vp_vovinam'); exception when others then ok := sqlerrm = 'uniform'; end;
  assert ok, 'give';
  assert public._fx_style_of(x.a)->>'style' = 'vovinam' and (public._fx_style_of(x.a)->>'idx')::int = 1, 'style of the uniform';
  ok := false; begin perform public._fx_style_of(x.a2); exception when others then ok := sqlerrm = 'no uniform'; end;
  assert ok, 'no uniform';
end $$;

-- ---------- 6. The exam gates ----------
do $$ declare x who; j jsonb; ok boolean; begin
  select * into x from who;
  ok := false;
  begin perform public.dojo_exam_start(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'too soon'; end;
  assert ok, 'the 2 hours after enrolling';
  update public.martial_enrollments set rank_at = now() - interval '3 hours' where account_id = x.a;
  perform public.fight_unwear_uniform(x.t);
  ok := false;
  begin perform public.dojo_exam_start(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'no uniform'; end;
  assert ok, 'the uniform must be worn';
  perform public.fight_wear_uniform(x.t, 'vovinam');
  perform public._vitals_apply(x.a);
  update public.vitals set hunger = 5 where account_id = x.a;
  ok := false;
  begin perform public.dojo_exam_start(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'too hungry to fight'; end;
  assert ok, 'hungry';
  update public.vitals set hunger = 90, thirst = 90, last_tick = now() where account_id = x.a;
  ok := false;
  begin perform public.dojo_exam_start(x.t, 'judo'); exception when others then ok := sqlerrm = 'not enrolled'; end;
  assert ok, 'not enrolled';
  assert (select coins from public.wallets where account_id = x.a) = 98000, 'refusals charge nothing';
end $$;

-- ---------- 7. Kata: too fast, a fail, malformed, a pass ----------
do $$ declare x who; j jsonb; ex uuid; ok boolean; n0 integer; begin
  select * into x from who;
  j := public.dojo_exam_start(x.t, 'vovinam');
  ex := (j->>'exam_id')::uuid;
  assert (j->>'notes')::int = 18 and (j->>'ticks_per_beat')::int = 40 and (j->>'pass_pct')::int = 60 and (j->>'coins')::int = 97000,
    format('exam start: %s', j);
  assert j->'state'->'exam'->>'status' = 'kata', 'live exam';
  ok := false;
  begin perform public.dojo_exam_start(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'exam in progress'; end;
  assert ok, 'one live exam';
  -- too fast: a perfect kata right away
  n0 := (select count(*) from public.anticheat_events where account_id = x.a);
  j := public.dojo_kata_submit(x.t, ex, pg_temp.perfect(ex));
  assert not (j->>'passed')::boolean and j->'anticheat'->>'code' = 'kata_too_fast', format('too fast: %s', j);
  assert (select status from public.martial_exams where id = ex) = 'failed', 'failed';
  assert (select count(*) from public.anticheat_events where account_id = x.a and code = 'kata_too_fast') = 1, 'evidence';
  -- the cooldown
  ok := false;
  begin perform public.dojo_exam_start(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'exam cooldown'; end;
  assert ok, 'cooldown';
  assert (public.dojo_state(x.t)->'enrollments'->0->>'cooldown_until_ms') is not null, 'cooldown shown';
  -- a fail: nothing pressed
  update public.martial_enrollments set exam_cooldown_until = null where account_id = x.a;
  j := public.dojo_exam_start(x.t, 'vovinam');
  ex := (j->>'exam_id')::uuid;
  update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
  j := public.dojo_kata_submit(x.t, ex, '{}');
  assert not (j->>'passed')::boolean and j->'anticheat' is null and (j->'score'->>0)::int = 0, format('fail: %s', j);
  assert abs((j->>'cooldown_until_ms')::bigint - (extract(epoch from now() + interval '30 minutes') * 1000)::bigint) < 3000, 'a 30-minute cooldown';
  -- malformed
  update public.martial_enrollments set exam_cooldown_until = null where account_id = x.a;
  j := public.dojo_exam_start(x.t, 'vovinam');
  ex := (j->>'exam_id')::uuid;
  update public.martial_exams set started_at = now() - interval '5 minutes' where id = ex;
  j := public.dojo_kata_submit(x.t, ex, '{200,9}');
  assert j->'anticheat'->>'code' = 'kata_bad_input' and (select status from public.martial_exams where id = ex) = 'failed', format('bad: %s', j);
  -- a stale submit answers the status
  j := public.dojo_kata_submit(x.t, ex, '{}');
  assert j->>'status' = 'failed' and j->'anticheat' is null, 'stale';
  -- expiry
  update public.martial_enrollments set exam_cooldown_until = null where account_id = x.a;
  j := public.dojo_exam_start(x.t, 'vovinam');
  ex := (j->>'exam_id')::uuid;
  update public.martial_exams set expires_at = now() - interval '1 second' where id = ex;
  j := public.dojo_state(x.t);
  assert (select status from public.martial_exams where id = ex) = 'expired', format('expired: %s', (select status from public.martial_exams where id = ex));
  assert j->'exam' = 'null'::jsonb, format('no live exam: %s', j->'exam');
  assert (select exam_cooldown_until from public.martial_enrollments where account_id = x.a) > now(), 'expiry sets the cooldown';
  assert (select count(*) from public.coin_ledger where account_id = x.a and reason = 'dojo_exam' and delta = -1000) = 4, 'four fees';
end $$;

-- ---------- 8. A sparring match streamed in 60-frame pushes: a win ties the belt ----------
do $$
declare x who; mid uuid; c jsonb; a integer[]; n integer; off integer; len integer; j jsonb; hs jsonb; hf integer; hv bigint;
        h0 numeric; t0 numeric; ev0 integer; k integer;
begin
  select * into x from who;
  mid := pg_temp.to_spar(x.t, 'vovinam');
  j := public.dojo_state(x.t);
  assert j->'exam'->>'status' = 'spar' and j->'exam'->'match'->>'id' = mid::text, format('spar: %s', j->'exam');
  assert (select kind from public.fight_matches where id = mid) = 'exam' and (select p2 from public.fight_matches where id = mid) is null, 'match row';
  assert abs((j->'exam'->'match'->>'started_at_ms')::bigint - (extract(epoch from now() + interval '8 seconds') * 1000)::bigint) < 3000, 'frame 0 in 8 s';
  assert (select params->'p2'->>'bot' from public.fight_matches where id = mid) = '1'
     and (select params->'p2'->>'rank' from public.fight_matches where id = mid) = '1'
     and (select params->'p1'->>'movesMask' from public.fight_matches where id = mid) = '1', 'exam params';
  c := pg_temp.use_fixture(mid, 'exam-strong-style1-r0-l1');
  a := public._fx_runs_decode(pg_temp.ints(c->'runs'), 30900);
  n := cardinality(a);
  hs := c->'expected'->'hashes';
  select hunger, thirst into h0, t0 from public.vitals where account_id = x.a;
  update public.vitals set last_tick = now() where account_id = x.a;
  ev0 := (select count(*) from public.anticheat_events where account_id = x.a and outcome <> 'soft');
  off := 0;
  k := 0;
  while off < n loop
    len := least(60, n - off);
    hf := null; hv := null;
    if (off + len) % 600 = 0 then hf := off + len; hv := (hs->((off + len) / 600 - 1)->>1)::bigint; end if;
    j := public.fight_push(x.t, mid, off, public._fx_runs_encode(a[off + 1 : off + len]), null, null, hf, hv, 0);
    assert j->'anticheat' is null and not (j->>'resync')::boolean, format('push @%s: %s', off, j);
    if off = 120 then
      -- an idempotent retry of the same frames
      j := public.fight_push(x.t, mid, off, public._fx_runs_encode(a[off + 1 : off + len]), null, null, null, null, 0);
      assert j->'anticheat' is null and (j->>'sim_frame')::int = off + len, format('retry: %s', j);
      -- an empty keepalive
      j := public.fight_push(x.t, mid, off + len, '{}', null, null, null, null, 0);
      assert j->'anticheat' is null, 'keepalive';
    end if;
    off := off + len;
    k := k + 1;
    if off < n then assert j->>'status' = 'live' and (j->>'sim_frame')::int = off, format('sim @%s: %s', off, j); end if;
  end loop;
  assert j->>'status' = 'done' and (j->'result'->>'winner')::int = 1 and j->'result'->>'end_reason' = 'ko', format('won: %s', j);
  assert (j->'result'->'exam'->>'passed')::boolean and (j->'result'->'exam'->>'rank')::int = 1
     and j->'result'->'exam'->>'belt' = 'Lam đai', format('the belt: %s', j->'result');
  assert (select rank from public.martial_enrollments where account_id = x.a and style = 'vovinam') = 1, 'promoted';
  assert (select status from public.martial_exams where match_id = mid) = 'passed', 'passed';
  assert (select sim_hash from public.fight_matches where id = mid) = (c->'expected'->>'hash')::bigint, 'the server replay = the fixture';
  assert (select rounds from public.fight_matches where id = mid) = c->'expected'->'rounds', 'rounds';
  -- the vitals cost: 2 rounds → 4 hunger, 6 thirst (plus a moment of drain)
  assert (select h0 - hunger from public.vitals where account_id = x.a) between 4 and 4.2
     and (select t0 - thirst from public.vitals where account_id = x.a) between 6 and 6.2,
     format('vitals: %s %s', (select h0 - hunger from public.vitals where account_id = x.a), (select t0 - thirst from public.vitals where account_id = x.a));
  assert (j->'result'->'vitals'->>'hunger')::int = 4 and (j->'result'->'vitals'->>'thirst')::int = 6, 'vitals in the answer';
  assert (select count(*) from public.anticheat_events where account_id = x.a and outcome <> 'soft') = ev0, 'no hard flag';
  -- a push after the end is an answer
  j := public.fight_push(x.t, mid, n, '{0,10}', null, null, null, null, 0);
  assert j->>'status' = 'done' and j->'anticheat' is null, 'push after the end';
  -- fight_state
  j := public.fight_state(x.t, mid);
  assert j->>'status' = 'done' and j->'params' = c->'params' and (j->>'sim_frame')::int = n
     and public._fx_runs_decode(pg_temp.ints(j->'runs'), 30900) = a, 'state';
  raise notice 'sparring won in % pushes', k;
end $$;

-- ---------- 9. A loss sets the cooldown; a hash mismatch asks for a resync ----------
do $$
declare x who; mid uuid; c jsonb; a integer[]; n integer; off integer; len integer; j jsonb; saw boolean := false;
begin
  select * into x from who;
  mid := pg_temp.to_spar(x.t, 'vovinam');
  assert (select params->'p2'->>'bot' from public.fight_matches where id = mid) = '2', 'rank 2 exam: bot level 2';
  c := pg_temp.use_fixture(mid, 'exam-idle-style1-r0-l1');
  a := public._fx_runs_decode(pg_temp.ints(c->'runs'), 30900);
  n := cardinality(a);
  off := 0;
  while off < n loop
    len := least(60, n - off);
    j := public.fight_push(x.t, mid, off, public._fx_runs_encode(a[off + 1 : off + len]), null, null,
                           case when off = 600 then off + len end, case when off = 600 then 12345 end, 0);
    if off = 600 then saw := (j->>'resync')::boolean; end if;
    off := off + len;
  end loop;
  assert saw, 'a wrong hash asks for a resync';
  assert (select bad_hashes from public.fight_logs where match_id = mid and side = 1) = 1
     and (select resyncs from public.fight_matches where id = mid) = 1, 'counted';
  assert exists (select 1 from public.anticheat_events where account_id = x.a and code = 'fight_hash_mismatch' and outcome = 'soft'), 'soft flag';
  assert j->>'status' = 'done' and (j->'result'->>'winner')::int = 2 and not (j->'result'->'exam'->>'passed')::boolean, format('lost: %s', j);
  assert (select rank from public.martial_enrollments where account_id = x.a and style = 'vovinam') = 1, 'no promotion';
  assert (select exam_cooldown_until from public.martial_enrollments where account_id = x.a and style = 'vovinam')
         between now() + interval '119 minutes' and now() + interval '121 minutes', 'the rank-2 cooldown: 2 h';
  assert (select status from public.martial_exams where match_id = mid) = 'failed', 'failed';
end $$;

-- ---------- 10. Too fast, a differing overlap, forfeit, abandon, a stranger ----------
do $$
declare x who; mid uuid; j jsonb; ok boolean;
begin
  select * into x from who;
  -- 120 frames pushed before frame 0 is due
  mid := pg_temp.to_spar(x.t, 'vovinam');
  j := public.fight_push(x.t, mid, 0, '{0,120}', null, null, null, null, 0);
  assert j->'anticheat'->>'code' = 'fight_too_fast' and j->>'status' = 'done' and (j->'result'->>'winner')::int = 2
     and j->'result'->>'end_reason' = 'forfeit', format('too fast: %s', j);
  assert (select status from public.martial_exams where match_id = mid) = 'failed', 'too fast fails the exam';
  -- an overlap that differs from what was stored
  mid := pg_temp.to_spar(x.t, 'vovinam');
  update public.fight_matches set started_at = now() - interval '50 seconds' where id = mid;
  j := public.fight_push(x.t, mid, 0, '{0,60}', null, null, null, null, 0);
  assert j->'anticheat' is null and (j->>'sim_frame')::int = 60, 'first push';
  j := public.fight_push(x.t, mid, 30, '{16,60}', null, null, null, null, 0);
  assert j->'anticheat'->>'code' = 'fight_bad_input' and j->>'status' = 'done', format('overlap: %s', j);
  -- a gap
  mid := pg_temp.to_spar(x.t, 'vovinam');
  update public.fight_matches set started_at = now() - interval '50 seconds' where id = mid;
  j := public.fight_push(x.t, mid, 5, '{0,60}', null, null, null, null, 0);
  assert j->'anticheat'->>'code' = 'fight_bad_input', format('gap: %s', j);
  -- malformed runs
  mid := pg_temp.to_spar(x.t, 'vovinam');
  update public.fight_matches set started_at = now() - interval '50 seconds' where id = mid;
  j := public.fight_push(x.t, mid, 0, '{2048,1}', null, null, null, null, 0);
  assert j->'anticheat'->>'code' = 'fight_bad_input', 'mask';
  -- a stranger
  mid := pg_temp.to_spar(x.t, 'vovinam');
  ok := false;
  begin perform public.fight_push(x.t2, mid, 0, '{0,60}'); exception when others then ok := sqlerrm = 'not your match'; end;
  assert ok, 'a stranger';
  ok := false;
  begin perform public.fight_state(x.t2, mid); exception when others then ok := sqlerrm = 'not your match'; end;
  assert ok, 'a stranger reads nothing';
  -- surrender
  j := public.fight_forfeit(x.t, mid);
  assert j->>'status' = 'done' and (j->'result'->>'winner')::int = 2 and j->'result'->>'end_reason' = 'forfeit', format('forfeit: %s', j);
  j := public.fight_forfeit(x.t, mid);
  assert j->>'status' = 'done', 'forfeit twice';
  -- 60 s without a push: the player's loss, settled by the next read
  mid := pg_temp.to_spar(x.t, 'vovinam');
  update public.fight_matches set started_at = now() - interval '2 minutes' where id = mid;
  j := public.fight_state(x.t, mid);
  assert j->>'status' = 'done' and j->'result'->>'end_reason' = 'abandon', format('abandon: %s', j);
  assert (select count(*) from public.fight_matches where p1 = x.a and status = 'live') = 0, 'nothing live';
end $$;

-- ---------- 11. The last belt, the ledger, the shade, privacy ----------
do $$ declare x who; ok boolean; def text; begin
  select * into x from who;
  update public.martial_enrollments set rank = 4 where account_id = x.a and style = 'vovinam';
  ok := false;
  begin perform public.dojo_exam_start(x.t, 'vovinam'); exception when others then ok := sqlerrm = 'max rank'; end;
  assert ok, 'max rank';
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check');
  assert def like '%dojo_tuition%' and def like '%dojo_exam%' and def like '%estate_buy%', 'ledger reasons';
  assert (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g')) >= 45, format('at least 45 reasons: %s', def);
  assert public._in_shade('market', 920, 262) and not public._in_shade('market', 920, 300), 'the awning';
  assert not public._in_shade('market', 1000, 262), 'east of the awning';
  assert has_function_privilege('anon', 'public.dojo_state(text)', 'execute')
     and has_function_privilege('anon', 'public.dojo_enroll(text, text)', 'execute')
     and has_function_privilege('anon', 'public.dojo_exam_start(text, text)', 'execute')
     and has_function_privilege('anon', 'public.dojo_kata_submit(text, uuid, integer[])', 'execute')
     and has_function_privilege('anon', 'public.fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer)', 'execute')
     and has_function_privilege('anon', 'public.fight_state(text, uuid)', 'execute')
     and has_function_privilege('anon', 'public.fight_forfeit(text, uuid)', 'execute')
     and has_function_privilege('anon', 'public.fight_wear_uniform(text, text)', 'execute')
     and has_function_privilege('anon', 'public.fight_unwear_uniform(text)', 'execute'), 'rpcs granted';
  for def in select p.oid::regprocedure::text from pg_proc p
              where p.pronamespace = 'public'::regnamespace and (p.proname like '\_fx\_%' or p.proname like '\_kata\_%' or p.proname like '\_dojo\_%') loop
    assert not has_function_privilege('anon', def, 'execute') and not has_function_privilege('authenticated', def, 'execute'), format('%s is callable', def);
  end loop;
  foreach def in array array['fight_matches', 'fight_logs', 'fight_profiles', 'martial_styles', 'martial_belts', 'martial_enrollments', 'martial_exams'] loop
    assert not has_table_privilege('anon', 'public.' || def, 'select') and not has_table_privilege('authenticated', 'public.' || def, 'select'), format('%s readable', def);
  end loop;
end $$;

-- ---------- 12. A whole push of 300 frames (the streamed replay's largest call) stays far inside the timeout ----------
do $$
declare x who; mid uuid; c jsonb; a integer[]; n integer; off integer := 0; len integer; j jsonb; t0 timestamptz; ms numeric;
        worst numeric := 0;
begin
  select * into x from who;
  update public.martial_enrollments set rank = 0 where account_id = x.a and style = 'vovinam';
  mid := pg_temp.to_spar(x.t, 'vovinam');
  c := pg_temp.use_fixture(mid, 'level8-style1');
  a := public._fx_runs_decode(pg_temp.ints(c->'runs'), 30900);
  n := cardinality(a);
  while off < n loop
    len := least(300, n - off);
    t0 := clock_timestamp();
    j := public.fight_push(x.t, mid, off, public._fx_runs_encode(a[off + 1 : off + len]), null, null, off + len, null, 0);
    ms := extract(epoch from clock_timestamp() - t0) * 1000;
    if len = 300 and ms > worst then worst := ms; end if;
    off := off + len;
  end loop;
  assert j->>'status' = 'done' and (select sim_hash from public.fight_matches where id = mid) = (c->'expected'->>'hash')::bigint, 'replayed';
  raise notice 'slowest 300-frame fight_push: % ms', round(worst, 1);
  assert worst < 250, format('a 300-frame push took %s ms', worst);
end $$;

select 'v20.2 smoke ok' as result;
