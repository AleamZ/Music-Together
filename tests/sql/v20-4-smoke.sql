-- tests/sql/v20-4-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after the full chain (0004 … 0055,
-- 0014 before 0013), from the repo root, with the fixtures' absolute paths:
--   psql -v cases=<repo>/tests/fixtures/fight-cases.json -v bosses=<repo>/tests/fixtures/ug-boss-cases.json -f <this file>
-- Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';

create temp table fx as select pg_read_file(:'cases')::jsonb j;
create temp table bx as select pg_read_file(:'bosses')::jsonb j;
create or replace function pg_temp.ints(a jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(x::int order by o), '{}') from jsonb_array_elements_text(a) with ordinality t(x, o)
$$;
create or replace function pg_temp.enc(p_runs integer[], p_from integer, p_n integer) returns integer[] language sql as $$
  select public._fx_runs_encode(public._fx_runs_slice(p_runs, p_from, p_n))
$$;

-- ---------- 0. Seven players: p1–p6 in one room, p7 in another; each enrolled and in uniform ----------
create temp table tk (k text primary key, v text);
insert into tk select 'p' || n, token from generate_series(1, 7) n,
  lateral public.register('ug' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
create or replace function pg_temp.t(k text) returns text language sql as $$ select v from tk where k = $1 $$;
create or replace function pg_temp.a(k text) returns uuid language sql as $$ select public._auth_account(pg_temp.t(k)) $$;
insert into tk select 'room', room_id::text from public.create_room('Hầm', 'pw', pg_temp.t('p1'));
insert into tk select 'room2', room_id::text from public.create_room('Hầm khác', 'pw', pg_temp.t('p7'));
create or replace function pg_temp.r(k text default 'room') returns uuid language sql as $$ select v::uuid from tk where k = $1 $$;
do $$ declare n integer; begin
  for n in 2..6 loop perform public.join_room((select code from public.rooms where id = pg_temp.r()), 'pw', pg_temp.t('p' || n)); end loop;
end $$;
insert into public.characters (account_id, skin, hair, hair_color, shoes)
  select pg_temp.a('p' || n), 'warm', 'short', 'black', 'shoes_dep_blue' from generate_series(1, 7) n;
insert into public.vitals (account_id) select pg_temp.a('p' || n) from generate_series(1, 7) n on conflict do nothing;

create or replace function pg_temp.fighter(p text, p_style text, p_rank integer) returns void language plpgsql as $$
declare acc uuid := pg_temp.a(p);
begin
  insert into public.martial_enrollments (account_id, style, rank) values (acc, p_style, p_rank)
  on conflict (account_id, style) do update set rank = excluded.rank;
  insert into public.account_items (account_id, item_id)
  select acc, uniform from public.martial_styles where id = p_style on conflict do nothing;
  perform public.fight_wear_uniform(pg_temp.t(p), p_style);
  perform public._wallet_lock(acc);
  update public.wallets set coins = 50000 where account_id = acc;
  update public.vitals set hunger = 100, thirst = 100 where account_id = acc;
end $$;
create or replace function pg_temp.coins(p text) returns integer language sql as $$
  select coins from public.wallets where account_id = pg_temp.a(p)
$$;
create or replace function pg_temp.refused(j jsonb) returns text language sql as $$ select j->>'refused' $$;
-- a raise's message, or null when the call went through
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$ begin
  perform pg_temp.fighter('p1', 'karate', 2);
  perform pg_temp.fighter('p2', 'taekwondo', 2);
  perform pg_temp.fighter('p3', 'muaythai', 3);
  perform pg_temp.fighter('p4', 'judo', 4);
  perform pg_temp.fighter('p5', 'boxing', 2);
  perform pg_temp.fighter('p6', 'vinhxuan', 1);
  perform pg_temp.fighter('p7', 'vovinam', 2);
end $$;

-- ---------- 1. The unlock (U6) and the gate on every ug_* RPC ----------
do $$ declare j jsonb; e text; k integer; begin
  -- rank 2 but no wins: locked, and every ug_* action refuses
  j := public.ug_status(pg_temp.r(), pg_temp.t('p1'));
  assert j = jsonb_build_object('unlocked', false, 'server_now_ms', j->'server_now_ms'), format('locked status: %s', j);
  foreach e in array array[
    format('select public.ug_enter(%L, %L)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_queue_join(%L, %L, 500)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_queue_leave(%L, %L)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_ready(%L, %L, gen_random_uuid(), 3)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_ladder_start(%L, %L, 1)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_cup_join(%L, %L, 1000)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_cup_leave(%L, %L)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_cup_state(%L, %L)', pg_temp.r(), pg_temp.t('p1')),
    format('select public.ug_board(%L, %L)', pg_temp.r(), pg_temp.t('p1'))] loop
    assert pg_temp.err(e) = 'underground locked', format('gate: %s → %s', e, pg_temp.err(e));
  end loop;
  -- rank 1 with ten wins: still locked
  update public.fight_profiles set wins = 10 where account_id = pg_temp.a('p6');
  insert into public.fight_profiles (account_id, wins) values (pg_temp.a('p6'), 10) on conflict (account_id) do update set wins = 10;
  assert not (public.ug_status(pg_temp.r(), pg_temp.t('p6'))->>'unlocked')::boolean, 'rank 1 is not enough';
  -- rank 2 and five wins as passed exams (no ring wins): unlocked
  for k in 1..5 loop
    insert into public.martial_exams (account_id, style, target_rank, fee, kata_seed, status, expires_at)
    values (pg_temp.a('p2'), 'taekwondo', 1, 0, k, 'passed', now());
  end loop;
  assert (public.ug_status(pg_temp.r(), pg_temp.t('p2'))->>'unlocked')::boolean, 'exams count as wins';
  -- ring wins count too
  insert into public.fight_profiles (account_id, wins) select pg_temp.a('p' || n), 5 from generate_series(1, 5) n
  on conflict (account_id) do update set wins = 5;
  insert into public.fight_profiles (account_id, wins) values (pg_temp.a('p7'), 5) on conflict (account_id) do update set wins = 5;
  -- thầy Lâm's line once (U7), on the first dojo visit after the unlock
  j := public.dojo_state(pg_temp.t('p1'));
  assert (j->>'ug_unlocked')::boolean and (j->>'ug_hint')::boolean, format('hint: %s', j->'ug_hint');
  j := public.dojo_state(pg_temp.t('p1'));
  assert (j->>'ug_unlocked')::boolean and not (j->>'ug_hint')::boolean, 'the hint only once';
  assert not (public.dojo_state(pg_temp.t('p6'))->>'ug_unlocked')::boolean, 'p6 locked in the dojo too';
  j := public.ug_enter(pg_temp.r(), pg_temp.t('p1'));
  assert (j->>'ok')::boolean and (j->>'unlocked')::boolean and (j->'me'->>'rating')::int = 1000 and j->'me'->>'tier' = 'tep_riu', format('enter: %s', j->'me');
  assert jsonb_array_length(j->'bosses') = 10 and (j->'bosses'->9->>'prize')::int = 7500, 'bosses in the panel';
  for k in 3..5 loop perform public.ug_status(pg_temp.r(), pg_temp.t('p' || k)); end loop;
  perform public.ug_status(pg_temp.r('room2'), pg_temp.t('p7'));
  -- a member of another room cannot look here
  assert pg_temp.err(format('select public.ug_status(%L, %L)', pg_temp.r(), pg_temp.t('p7'))) is not null, 'not a member';
  raise notice 'unlock and gate ok';
end $$;

-- ---------- 2. The boss fixtures: 0052's _fx_new / _fx_reset (styleByRound) = the TS engine ----------
do $$
declare c jsonb; m integer[] := public._fx_moves(); s integer[]; a integer[]; z integer[]; n integer; off integer; len integer;
        checks integer; hs jsonb; cases integer := 0;
begin
  for c in select jsonb_array_elements(j) from bx loop
    n := (c->>'frames')::int;
    a := public._fx_runs_decode(pg_temp.ints(c->'runs'), 30900);
    s := public._fx_new(c->'params');
    hs := c->'expected'->'hashes';
    checks := 0;
    off := 0;
    while off < n loop
      len := least(300, n - off);
      z := array_fill(0, array[len]);
      s := public._fx_run_bots(s, a[off + 1 : off + len], z, m);
      off := off + len;
      if off % 600 = 0 then
        assert public._fx_hash(s) = (hs->checks->>1)::bigint, format('%s: frame %s', c->>'name', off);
        checks := checks + 1;
      end if;
    end loop;
    assert public._fx_hash(s) = (c->'expected'->>'hash')::bigint, format('%s: final hash sql %s ts %s', c->>'name', public._fx_hash(s), c->'expected'->>'hash');
    assert public._fx_rounds_json(s) = c->'expected'->'rounds', format('%s: rounds', c->>'name');
    cases := cases + 1;
  end loop;
  assert cases = 4, format('boss cases: %s', cases);
  -- the slots: style + 1 per round, 0 without the list (the old fixtures keep their hashes)
  s := public._fx_new((select e->'params' from bx, jsonb_array_elements(bx.j) e where e->>'name' = 'floor10-strong'));
  assert s[32 + 5 + 1 : 32 + 5 + 5] = '{3,7,8,3,7}', format('slots %s', s[33:42]);
  assert s[113 + 48] = 2 and s[113 + 52] = 110, 'round 1 as Muay Thai with its stats';
  s := public._fx_new((select e->'params' from bx, jsonb_array_elements(bx.j) e where e->>'name' = 'floor1-strong'));
  assert s[33:42] = array_fill(0, array[10]), 'no list, no slots';
  raise notice 'boss fixtures ok: % cases (floor 10 changes style)', cases;
end $$;

-- a bot match's pushes from a fixture's player log (300 frames each), its clock moved back so the pacing holds
create or replace function pg_temp.play_bot(p_match uuid, p_case text, p_tok text) returns jsonb language plpgsql as $$
declare c jsonb; r integer[]; n integer; off integer := 0; len integer; j jsonb;
begin
  select e into c from bx, jsonb_array_elements(bx.j) e where e->>'name' = p_case;
  r := pg_temp.ints(c->'runs');
  n := (c->>'frames')::int;
  update public.fight_matches set params = c->'params', sim = public._fx_new(c->'params'), sim_frame = 0,
    sim_hash = public._fx_hash(public._fx_new(c->'params')), started_at = now() - interval '10 minutes' where id = p_match;
  update public.fight_logs set last_push_at = now() where match_id = p_match;          -- not abandoned (60 s)
  while off < n loop
    len := least(300, n - off);
    j := public.fight_push(p_tok, p_match, off, pg_temp.enc(r, off, len));
    assert j->>'status' in ('live', 'done') and not j ? 'anticheat', format('push at %s: %s', off, j);
    off := off + len;
  end loop;
  return j;
end $$;

-- ---------- 3. Tầng hầm: order, the first clear against a repeat at 10 %, the season reset, the limit ----------
do $$ declare j jsonb; m uuid; b0 integer; mt public.fight_matches; begin
  j := public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 2);
  assert pg_temp.refused(j) = 'floor locked', format('floor 2 first: %s', pg_temp.refused(j));
  b0 := pg_temp.coins('p1');
  j := public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 1);
  assert (j->>'ok')::boolean, format('start: %s', j);
  m := (j->'match'->>'id')::uuid;
  select * into mt from public.fight_matches where id = m;
  assert mt.kind = 'ug_ladder' and mt.p2 is null and mt.entry = 100 and mt.ref = '1' and mt.ready = 3, 'the ladder row';
  assert mt.params->'p2' @> '{"style": 5, "rank": 4, "movesMask": 31, "hpPct": 100, "bot": 1}'::jsonb, format('boss params %s', mt.params->'p2');
  assert mt.params->'p1' @> '{"style": 3, "rank": 2, "movesMask": 7, "bot": 0}'::jsonb, format('my params %s', mt.params->'p1');
  assert mt.started_at between now() + interval '7 seconds' and now() + interval '9 seconds', 'frame 0 in 8 s';
  assert pg_temp.coins('p1') = b0 - 100, 'entry paid';
  assert (select count(*) from public.coin_ledger where account_id = pg_temp.a('p1') and reason = 'ug_entry' and delta = -100) = 1, 'entry ledger';
  -- busy while it runs
  assert pg_temp.refused(public.ug_queue_join(pg_temp.r(), pg_temp.t('p1'), 500)) = 'in a match', 'busy in the ladder';
  j := pg_temp.play_bot(m, 'floor1-strong', pg_temp.t('p1'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'done' and mt.winner = 1, format('cleared %s %s', mt.status, mt.winner);
  assert (mt.result->'ug'->>'won')::int = 200 and (mt.result->'ug'->>'first')::boolean, format('first clear %s', mt.result->'ug');
  assert pg_temp.coins('p1') = b0 - 100 + 200, 'prize paid';
  assert (select cleared_at is not null and clears = 1 and attempts = 1 from public.ug_ladder
           where account_id = pg_temp.a('p1') and season = public._ug_season() and floor = 1), 'the ladder row';
  -- a repeat pays 10 %
  j := public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 1);
  m := (j->'match'->>'id')::uuid;
  j := pg_temp.play_bot(m, 'floor1-strong', pg_temp.t('p1'));
  select * into mt from public.fight_matches where id = m;
  assert (mt.result->'ug'->>'won')::int = 20 and not (mt.result->'ug'->>'first')::boolean, format('repeat %s', mt.result->'ug');
  assert pg_temp.coins('p1') = b0 - 200 + 220, 'repeat paid 10 %';
  -- floor 2 is open now; a loss (a surrender) pays nothing and the entry is gone
  j := public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 2);
  m := (j->'match'->>'id')::uuid;
  j := public.fight_forfeit(pg_temp.t('p1'), m);
  select * into mt from public.fight_matches where id = m;
  assert mt.winner = 2 and (mt.result->'ug'->>'won')::int = 0, 'a loss';
  assert pg_temp.coins('p1') = b0 - 400 + 220, 'no refund on a loss';
  -- floor 10's params carry the style list (engine ids)
  update public.ug_ladder set cleared_at = now() where account_id = pg_temp.a('p1') and season = public._ug_season() and floor = 1;
  insert into public.ug_ladder (account_id, season, floor, cleared_at) select pg_temp.a('p1'), public._ug_season(), f, now()
    from generate_series(2, 9) f on conflict (account_id, season, floor) do update set cleared_at = now();
  j := public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 10);
  m := (j->'match'->>'id')::uuid;
  select * into mt from public.fight_matches where id = m;
  assert mt.params->'p2'->'styleByRound' = '[2, 6, 7, 2, 6]'::jsonb and (mt.params->'p2'->>'hpPct')::int = 130
     and (mt.params->'p2'->>'bot')::int = 8, format('floor 10 %s', mt.params->'p2');
  assert mt.sim[33 + 5 : 37 + 5] = '{3,7,8,3,7}', 'floor 10 slots';
  perform public.fight_forfeit(pg_temp.t('p1'), m);
  -- the daily limit (6 attempts: 4 so far; a refusal does not count)
  assert (select ladder_today from public.ug_profiles where account_id = pg_temp.a('p1')) = 4, 'four attempts';
  update public.ug_profiles set ladder_today = 6 where account_id = pg_temp.a('p1');
  assert pg_temp.refused(public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 1)) = 'daily ug limit', 'ladder limit';
  update public.ug_profiles set ladder_today = 0 where account_id = pg_temp.a('p1');
  -- the season reset: last season's clears do not open this season's floors
  update public.ug_ladder set season = season - 1 where account_id = pg_temp.a('p1');
  assert pg_temp.refused(public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 2)) = 'floor locked', 'a new season starts at floor 1';
  -- not enough xu
  update public.wallets set coins = 50 where account_id = pg_temp.a('p1');
  assert pg_temp.refused(public.ug_ladder_start(pg_temp.r(), pg_temp.t('p1'), 1)) = 'not enough xu', 'no xu';
  update public.wallets set coins = 50000 where account_id = pg_temp.a('p1');
  -- no uniform
  perform public.fight_unwear_uniform(pg_temp.t('p1'));
  assert pg_temp.err(format('select public.ug_ladder_start(%L, %L, 1)', pg_temp.r(), pg_temp.t('p1'))) = 'no uniform', 'uniform needed';
  perform public.fight_wear_uniform(pg_temp.t('p1'), 'karate');
  update public.ug_profiles set ladder_today = 0 where account_id = pg_temp.a('p1');
  raise notice 'ladder ok';
end $$;

-- a fixture's two logs pushed by both players in interleaved 60-frame chunks (with what each saw of the other)
create or replace function pg_temp.feed(p_match uuid, p_case text, p_t1 text, p_t2 text) returns jsonb language plpgsql as $$
declare c jsonb; r1 integer[]; r2 integer[]; n integer; off integer := 0; len integer; j jsonb; s1 integer := 0; s2 integer := 0;
begin
  select e into c from fx, jsonb_array_elements(fx.j) e where e->>'name' = p_case;
  r1 := pg_temp.ints(c->'p1');
  r2 := pg_temp.ints(c->'p2');
  n := (c->>'frames')::int;
  update public.fight_matches set params = c->'params' || jsonb_build_object('delay', 3), sim = public._fx_new(c->'params'), sim_frame = 0,
    sim_hash = public._fx_hash(public._fx_new(c->'params')), started_at = now() - interval '11 minutes' where id = p_match;
  update public.fight_logs set last_push_at = now() where match_id = p_match;
  while off < n loop
    len := least(60, n - off);
    j := public.fight_push(p_t1, p_match, off, pg_temp.enc(r1, off, len), p_seen_from => s1, p_seen_runs => pg_temp.enc(r2, s1, off - s1));
    assert j->>'status' in ('live', 'done') and not j ? 'anticheat', format('push 1 at %s: %s', off, j);
    s1 := off;
    j := public.fight_push(p_t2, p_match, off, pg_temp.enc(r2, off, len), p_seen_from => s2, p_seen_runs => pg_temp.enc(r1, s2, off + len - s2));
    assert j->>'status' in ('live', 'done') and not j ? 'anticheat', format('push 2 at %s: %s', off, j);
    s2 := off + len;
    off := off + len;
  end loop;
  j := public.fight_push(p_t1, p_match, n, '{}', p_seen_from => s1, p_seen_runs => pg_temp.enc(r2, s1, n - s1));
  return c;
end $$;
create or replace function pg_temp.mine(p text) returns jsonb language sql as $$
  select public.ug_status(pg_temp.r(), pg_temp.t(p))->'mine'
$$;

-- ---------- 4. Kèo ngầm: the window, pairing, ready, settlement, the rating, the fee ----------
do $$ declare j jsonb; m uuid; mt public.fight_matches; b1 integer; b2 integer; e1 integer; e2 integer; begin
  update public.ug_profiles set rating = 1300 where account_id = pg_temp.a('p2');
  b1 := pg_temp.coins('p1');
  b2 := pg_temp.coins('p2');
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p1'), 500);
  assert (j->>'ok')::boolean and (j->'queue'->>'tier')::int = 500, format('join %s', j);
  assert pg_temp.coins('p1') = b1 - 500, 'entry held';
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p2'), 500);
  assert j->'mine' = 'null'::jsonb and (j->'queued'->>'500')::int = 2, format('300 apart: not paired (±150) %s', j->'queued');
  assert pg_temp.refused(public.ug_queue_join(pg_temp.r(), pg_temp.t('p1'), 500)) = 'already queued', 'twice';
  -- 60 s later the window is ±350
  update public.ug_queue set joined_at = now() - interval '61 seconds' where account_id = pg_temp.a('p1');
  j := public.ug_status(pg_temp.r(), pg_temp.t('p1'));
  assert j->'mine'->>'kind' = 'ug_rated' and (j->'mine'->>'ready')::int = 0 and (j->'mine'->>'side')::int = 1, format('paired %s', j->'mine');
  m := (j->'mine'->>'id')::uuid;
  select * into mt from public.fight_matches where id = m;
  assert mt.p1 = pg_temp.a('p1') and mt.p2 = pg_temp.a('p2') and mt.entry = 500 and mt.call_until > now() + interval '25 seconds', 'the called row';
  assert (select rated_today from public.ug_profiles where account_id = pg_temp.a('p2')) = 1, 'counted at pairing';
  assert not exists (select 1 from public.ug_queue where account_id in (pg_temp.a('p1'), pg_temp.a('p2'))), 'out of the queue';
  -- a push before frame 0 is set is answered, never flagged
  j := public.fight_push(pg_temp.t('p1'), m, 0, '{0,60}');
  assert (j->>'waiting')::boolean and not j ? 'anticheat', format('waiting %s', j);
  -- a spectator without the unlock sees nothing; with it, side 0
  assert pg_temp.err(format('select public.fight_state(%L, %L)', pg_temp.t('p6'), m)) = 'not your match', 'locked spectator';
  j := public.ug_ready(pg_temp.r(), pg_temp.t('p1'), m, 3);
  assert (j->'match'->>'ready')::int = 1, 'p1 ready';
  j := public.ug_ready(pg_temp.r(), pg_temp.t('p2'), m, 5);
  assert (j->'match'->>'ready')::int = 3 and (j->'match'->'params'->>'delay')::int = 5, format('both ready %s', j->'match');
  select * into mt from public.fight_matches where id = m;
  assert mt.started_at between now() + interval '2 seconds' and now() + interval '4 seconds', 'frame 0 in 3 s';
  j := public.fight_state(pg_temp.t('p5'), m);
  assert (j->>'side')::int = 0 and (j->>'spectator')::boolean and j ? 'sim' and j ? 'runs' and j ? 'opp_runs', format('spectator %s', j - 'sim');
  assert (public.ug_status(pg_temp.r(), pg_temp.t('p5'))->'live'->0->>'id') = m::text, 'the cage lists it';
  -- the fixture decides it: p1 wins
  perform pg_temp.feed(m, 'bots-karate-5-vs-taekwondo-5', pg_temp.t('p1'), pg_temp.t('p2'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'done' and mt.winner = 1, format('settled %s %s', mt.status, mt.winner);
  assert pg_temp.coins('p1') = b1 - 500 + 950 and pg_temp.coins('p2') = b2 - 500, format('pay %s %s', pg_temp.coins('p1') - b1, pg_temp.coins('p2') - b2);
  assert (mt.result->'ug'->>'fee')::int = 50 and (mt.result->'ug'->>'won')::int = 950, format('ug result %s', mt.result->'ug');
  e1 := public._ug_elo(1000, 1300, 1, 40, 1);
  e2 := public._ug_elo(1300, 1000, 0, 40, 1);
  assert e1 = 34 and e2 = -34, format('elo %s %s', e1, e2);
  assert (select rating from public.ug_profiles where account_id = pg_temp.a('p1')) = 1034
     and (select rating from public.ug_profiles where account_id = pg_temp.a('p2')) = 1266, 'ratings moved';
  assert (mt.result->'ug'->'rating'->'1'->>'delta')::int = 34, format('delta %s', mt.result->'ug'->'rating');
  assert (select rated from public.ug_profiles where account_id = pg_temp.a('p1')) = 1, 'rated count';
  assert (select count(*) from public.coin_ledger where account_id = pg_temp.a('p1') and reason = 'ug_prize' and delta = 950) = 1, 'prize ledger';
  raise notice 'rated ok';
end $$;

-- ---------- 5. Rating maths, the pair ×0.5, ug_pair_farm, the pair and daily limits ----------
do $$ declare j jsonb; m uuid; mt public.fight_matches; k integer; r1 integer; r2 integer; begin
  assert public._ug_elo(1000, 1000, 1, 40, 1) = 20 and public._ug_elo(1000, 1000, 0.5, 24, 1) = 0, 'elo basics';
  assert public._ug_elo(1000, 1400, 1, 24, 1) = 22 and public._ug_elo(1400, 1000, 1, 24, 1) = 2, 'upsets pay more';
  assert public._ug_elo(1400, 1000, 0.5, 24, 1) = -10 and public._ug_elo(1000, 1000, 1, 24, 0.5) = 6, 'draws and the pair rule';
  -- five earlier one-sided meetings this week (p1 won them all)
  for k in 1..5 loop
    insert into public.fight_matches (room_id, kind, p1, p2, params, started_at, sim, status, winner, end_reason, created_at, ended_at, entry)
    values (pg_temp.r(), 'ug_rated', pg_temp.a('p1'), pg_temp.a('p2'), '{}'::jsonb, now() - interval '2 days', '{}', 'done', 1, 'ko',
            now() - interval '2 days', now() - interval '2 days', 500);
  end loop;
  update public.ug_profiles set rating = 1100 where account_id in (pg_temp.a('p1'), pg_temp.a('p2'));
  perform public.ug_queue_join(pg_temp.r(), pg_temp.t('p1'), 500);
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p2'), 500);
  m := (j->'mine'->>'id')::uuid;
  assert m is not null, 'paired again';
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p1'), m, 3);
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p2'), m, 3);
  j := public.fight_forfeit(pg_temp.t('p2'), m);
  select * into mt from public.fight_matches where id = m;
  -- (both joined in one transaction: the same now(), so the red corner is the lower account id)
  assert (case mt.winner when 1 then mt.p1 else mt.p2 end) = pg_temp.a('p1') and mt.end_reason = 'forfeit', 'surrender';
  assert (mt.result->'ug'->'rating'->>'factor')::numeric = 0.5, format('×0.5 %s', mt.result->'ug'->'rating');
  r1 := (select rating from public.ug_profiles where account_id = pg_temp.a('p1'));
  r2 := (select rating from public.ug_profiles where account_id = pg_temp.a('p2'));
  assert r1 = 1100 + public._ug_elo(1100, 1100, 1, 40, 0.5) and r2 = 1100 + public._ug_elo(1100, 1100, 0, 40, 0.5), format('halved %s %s', r1, r2);
  assert (select count(*) from public.anticheat_events where code = 'ug_pair_farm' and account_id in (pg_temp.a('p1'), pg_temp.a('p2'))) = 2, 'pair farm flagged (soft)';
  -- two rated meetings today: the pair is not paired a third time
  perform public.ug_queue_join(pg_temp.r(), pg_temp.t('p1'), 500);
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p2'), 500);
  assert j->'mine' = 'null'::jsonb and (j->'queued'->>'500')::int = 2, 'the pair limit';
  perform public.ug_queue_leave(pg_temp.r(), pg_temp.t('p1'));
  perform public.ug_queue_leave(pg_temp.r(), pg_temp.t('p2'));
  assert (select count(*) from public.coin_ledger where account_id = pg_temp.a('p1') and reason = 'ug_refund' and ref = 'ug kèo: rời hàng') = 1, 'leave refunds';
  -- the account's daily limit
  update public.ug_profiles set rated_today = 10 where account_id = pg_temp.a('p3');
  assert pg_temp.refused(public.ug_queue_join(pg_temp.r(), pg_temp.t('p3'), 500)) = 'daily ug limit', 'rated limit';
  update public.ug_profiles set rated_today = 0 where account_id = pg_temp.a('p3');
  raise notice 'rating, pair and limits ok';
end $$;

-- ---------- 6. The timeout refund, the no-show, both absent ----------
do $$ declare j jsonb; m uuid; mt public.fight_matches; b3 integer; b4 integer; h3 numeric; begin
  b3 := pg_temp.coins('p3');
  perform public.ug_queue_join(pg_temp.r(), pg_temp.t('p3'), 2000);
  update public.ug_queue set joined_at = now() - interval '301 seconds' where account_id = pg_temp.a('p3');
  j := public.ug_status(pg_temp.r(), pg_temp.t('p3'));
  assert j->'queue' = 'null'::jsonb and pg_temp.coins('p3') = b3, 'timeout refunded';
  assert (select count(*) from public.coin_ledger where account_id = pg_temp.a('p3') and reason = 'ug_refund' and delta = 2000) = 1, 'refund ledger';
  -- p3 shows, p4 does not: p4's entry goes to p3 less 5 %, p3 back at the queue's head with its entry still held
  b4 := pg_temp.coins('p4');
  perform public.ug_queue_join(pg_temp.r(), pg_temp.t('p3'), 2000);
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p4'), 2000);
  m := (j->'mine'->>'id')::uuid;
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p3'), m, 3);
  select hunger into h3 from public.vitals where account_id = pg_temp.a('p3');
  update public.fight_matches set call_until = now() - interval '1 second' where id = m;
  j := public.ug_status(pg_temp.r(), pg_temp.t('p4'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'done' and (case mt.winner when 1 then mt.p1 else mt.p2 end) = pg_temp.a('p3') and mt.end_reason = 'forfeit'
     and (mt.result->>'noshow')::boolean, format('no-show %s', mt.result);
  assert pg_temp.coins('p3') = b3 - 2000 + 1900 and pg_temp.coins('p4') = b4 - 2000, format('no-show pay %s %s', pg_temp.coins('p3') - b3, pg_temp.coins('p4') - b4);
  assert (select head from public.ug_queue where account_id = pg_temp.a('p3')), 'back at the head';
  assert (select hunger from public.vitals where account_id = pg_temp.a('p3')) = h3, 'no vitals cost';
  -- nobody ready: void, both refunded
  b4 := pg_temp.coins('p4');
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p4'), 2000);
  m := (j->'mine'->>'id')::uuid;
  assert m is not null, 'the head pairs first';
  update public.fight_matches set call_until = now() - interval '1 second' where id = m;
  perform public.ug_status(pg_temp.r(), pg_temp.t('p4'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'void' and mt.end_reason = 'abandon', format('both absent %s %s', mt.status, mt.end_reason);
  -- p3: paid 2 000 once, took 1 900 from p4's no-show, and its held entry came back: +1 900 in all
  assert pg_temp.coins('p4') = b4 and pg_temp.coins('p3') = b3 + 1900, format('void refunds %s %s', pg_temp.coins('p4') - b4, pg_temp.coins('p3') - b3);
  raise notice 'timeout and no-show ok';
end $$;

-- ---------- 7. Giải đêm: fill, the bracket, a no-show, the final, the 70/30 pool less the fee; the refund when not filled ----------
do $$ declare j jsonb; c public.ug_cups; m uuid; mt public.fight_matches; b jsonb; s1 uuid; s2 uuid; s3 uuid; s4 uuid;
        bal jsonb; begin
  update public.ug_profiles set rating = 1000 + 50 * n
    from (values ('p1', 4), ('p2', 3), ('p3', 2), ('p4', 1)) x(p, n) where account_id = pg_temp.a(x.p);
  select jsonb_object_agg(p, pg_temp.coins(p)) into bal from unnest(array['p1', 'p2', 'p3', 'p4']) p;
  j := public.ug_cup_join(pg_temp.r(), pg_temp.t('p4'), 1000);
  assert (j->>'ok')::boolean and j->'cups'->0->>'status' = 'open', format('open %s', j->'cups');
  assert pg_temp.refused(public.ug_queue_join(pg_temp.r(), pg_temp.t('p4'), 500)) = 'already in a cup', 'busy in a cup';
  -- leaving an open cup refunds
  perform public.ug_cup_leave(pg_temp.r(), pg_temp.t('p4'));
  assert pg_temp.coins('p4') = (bal->>'p4')::int, 'cup leave refunds';
  perform public.ug_cup_join(pg_temp.r(), pg_temp.t('p4'), 1000);
  perform public.ug_cup_join(pg_temp.r(), pg_temp.t('p3'), 1000);
  perform public.ug_cup_join(pg_temp.r(), pg_temp.t('p2'), 1000);
  perform public.ug_cup_join(pg_temp.r(), pg_temp.t('p1'), 1000);
  select * into c from public.ug_cups where room_id = pg_temp.r() and tier = 1000 order by created_at desc limit 1;
  assert c.status = 'running', format('four: running %s', c.status);
  b := c.bracket;
  s1 := (b->'seeds'->>0)::uuid; s2 := (b->'seeds'->>1)::uuid; s3 := (b->'seeds'->>2)::uuid; s4 := (b->'seeds'->>3)::uuid;
  assert s1 = pg_temp.a('p1') and s4 = pg_temp.a('p4'), 'seeded by rating';
  assert (b->'semis'->0->>'a')::uuid = s1 and (b->'semis'->0->>'b')::uuid = s4 and (b->'semis'->1->>'a')::uuid = s2
     and (b->'semis'->1->>'b')::uuid = s3, format('1 v 4, 2 v 3: %s', b);
  assert (select count(*) from public.ug_profiles where account_id in (s1, s2, s3, s4) and cups_today = 1) = 4, 'counted at the start';
  -- semifinal 1 is called: s1 and s4 ready, then s4 surrenders
  m := c.current_match;
  select * into mt from public.fight_matches where id = m;
  assert mt.kind = 'ug_cup' and mt.stake = 0 and mt.entry = 0 and mt.ref = c.id::text and mt.ready = 0
     and mt.call_until > now() + interval '55 seconds', 'semifinal 1 called (60 s)';
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p1'), m, 3);
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p4'), m, 3);
  perform public.fight_forfeit(pg_temp.t('p4'), m);
  select * into c from public.ug_cups where id = c.id;
  assert (c.bracket->'semis'->0->>'winner')::uuid = s1 and (c.bracket->'final'->>'a')::uuid = s1, 'semi 1 advances';
  assert (select placed from public.ug_cup_entries where cup_id = c.id and account_id = s4) = 3, 'placed 3';
  -- semifinal 2: s3 does not show
  m := c.current_match;
  select * into mt from public.fight_matches where id = m;
  assert mt.p1 = s2 and mt.p2 = s3, 'semifinal 2 called';
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p2'), m, 3);
  update public.fight_matches set call_until = now() - interval '1 second' where id = m;
  perform public.ug_cup_state(pg_temp.r(), pg_temp.t('p1'));
  select * into c from public.ug_cups where id = c.id;
  assert (c.bracket->'semis'->1->>'winner')::uuid = s2 and (c.bracket->'final'->>'b')::uuid = s2, format('no-show advances %s', c.bracket);
  -- the final: fought out from a fixture (p1 red wins)
  m := c.current_match;
  select * into mt from public.fight_matches where id = m;
  assert mt.p1 = s1 and mt.p2 = s2, 'the final';
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p1'), m, 3);
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p2'), m, 3);
  perform pg_temp.feed(m, 'bots-karate-5-vs-taekwondo-5', pg_temp.t('p1'), pg_temp.t('p2'));
  select * into c from public.ug_cups where id = c.id;
  assert c.status = 'done' and c.current_match is null, 'the cup is over';
  assert (select placed from public.ug_cup_entries where cup_id = c.id and account_id = s1) = 1
     and (select placed from public.ug_cup_entries where cup_id = c.id and account_id = s2) = 2, 'placings';
  -- the pool: 4 000 less 5 % = 3 800; 2 660 to the champion, 1 140 to the runner-up
  assert pg_temp.coins('p1') = (bal->>'p1')::int - 1000 + 2660, format('champion %s', pg_temp.coins('p1') - (bal->>'p1')::int);
  assert pg_temp.coins('p2') = (bal->>'p2')::int - 1000 + 1140, format('runner-up %s', pg_temp.coins('p2') - (bal->>'p2')::int);
  assert pg_temp.coins('p3') = (bal->>'p3')::int - 1000 and pg_temp.coins('p4') = (bal->>'p4')::int - 1000, 'the others paid their entry';
  select result into j from public.fight_matches where id = m;
  assert (j->'ug'->>'pool')::int = 3800 and (j->'ug'->>'fee')::int = 200 and j->'ug'->>'round' = 'final', format('final result %s', j->'ug');
  assert exists (select 1 from public.news_events where room_id = pg_temp.r() and text like '%một giải đấu kín%'), 'Tin làng';
  -- the ratings moved for the fought matches (not for the no-show)
  assert (select rated from public.ug_profiles where account_id = s3) = 0, 'no rating for a no-show';
  -- a cup that does not fill in 15 minutes refunds everyone
  select jsonb_object_agg(p, pg_temp.coins(p)) into bal from unnest(array['p3', 'p4']) p;
  perform public.ug_cup_join(pg_temp.r(), pg_temp.t('p3'), 5000);
  perform public.ug_cup_join(pg_temp.r(), pg_temp.t('p4'), 5000);
  select * into c from public.ug_cups where room_id = pg_temp.r() and tier = 5000 and status = 'open';
  update public.ug_cups set created_at = now() - interval '16 minutes' where id = c.id;
  perform public.ug_status(pg_temp.r(), pg_temp.t('p3'));
  assert (select status from public.ug_cups where id = c.id) = 'void', 'not filled: void';
  assert pg_temp.coins('p3') = (bal->>'p3')::int and pg_temp.coins('p4') = (bal->>'p4')::int, 'not filled: refunded';
  -- the daily cup limit
  update public.ug_profiles set cups_today = 3 where account_id = pg_temp.a('p3');
  assert pg_temp.refused(public.ug_cup_join(pg_temp.r(), pg_temp.t('p3'), 1000)) = 'daily ug limit', 'cup limit';
  update public.ug_profiles set cups_today = 0 where account_id = pg_temp.a('p3');
  raise notice 'cup ok';
end $$;

-- ---------- 8. The realtime caps (U10), the board, the season: soft reset and titles (U8) ----------
do $$ declare j jsonb; m uuid; r integer; begin
  update public.fight_config set max_live_room = 0 where id;
  perform public.ug_queue_join(pg_temp.r(), pg_temp.t('p4'), 5000);
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p5'), 5000);
  assert j->'mine' = 'null'::jsonb, 'caps full: no pairing';
  update public.fight_config set max_live_room = 2 where id;
  j := public.ug_status(pg_temp.r(), pg_temp.t('p5'));
  m := (j->'mine'->>'id')::uuid;
  assert m is not null, 'paired once there is room';
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p4'), m, 3);
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p5'), m, 3);
  perform public.fight_forfeit(pg_temp.t('p5'), m);
  -- the board: the room's fighters this season
  j := public.ug_board(pg_temp.r(), pg_temp.t('p1'));
  assert jsonb_array_length(j->'room') >= 4 and (j->'room'->0->>'rating')::int >= (j->'room'->1->>'rating')::int, format('board %s', j->'room');
  assert jsonb_array_length(j->'global') >= 4, 'global board';
  -- a new season: the rating halfway back to 1 000
  perform public._ug_profile(pg_temp.a('p6'));
  update public.ug_profiles set season = season - 1, rating = 1600, peak = 1600 where account_id = pg_temp.a('p6');
  perform public._ug_profile(pg_temp.a('p6'));
  select rating into r from public.ug_profiles where account_id = pg_temp.a('p6');
  assert r = 1300, format('soft reset %s', r);
  update public.ug_profiles set season = season - 1, rating = 850 where account_id = pg_temp.a('p6');
  perform public._ug_profile(pg_temp.a('p6'));
  assert (select rating from public.ug_profiles where account_id = pg_temp.a('p6')) = 925, 'up from below too';
  -- closing season 0: Thủy quái to a peak ≥ 1 550, Trùm hầm to the room's no. 1; once
  update public.ug_profiles set peak = 1560, best_tier = 'thuy_quai' where account_id = pg_temp.a('p2');
  perform public._ug_close_season(0);
  assert exists (select 1 from public.ug_profiles where account_id = pg_temp.a('p2') and 'Thủy quái mùa 1' = any (titles)), 'Thủy quái';
  assert (select count(*) from public.ug_profiles where 'Trùm hầm mùa 1' = any (titles)) = 1, 'one Trùm hầm for the room';
  assert (select ug_title from public.characters where account_id = pg_temp.a('p2')) like '%mùa 1', 'the name tag';
  perform public._ug_close_season(0);
  assert (select cardinality(titles) from public.ug_profiles where account_id = pg_temp.a('p2')) <= 2, 'closed once';
  raise notice 'caps, board and season ok';
end $$;

-- ---------- 9. The lock order (the v20.3 follow-up), the wipe, the deletion, the shade, privileges, the ledger ----------
do $$ declare j jsonb; m uuid; mt public.fight_matches; b3 integer; def text; a5 uuid := pg_temp.a('p5'); begin
  assert pg_get_functiondef('public.admin_anticheat_resolve(text, uuid, text)'::regprocedure) like '%_fx_lock_live(p_account_id)%_wallet_lock(p_account_id)%', 'resolve: matches first';
  assert pg_get_functiondef('public._fight_accounts_bd()'::regprocedure) like '%_fx_lock_live(old.id)%_wallet_lock(old.id)%', 'deletion: matches first';
  assert pg_get_functiondef('public._ac_wipe(uuid, uuid)'::regprocedure) like '%_fx_lock_live(p_account)%_card_forfeit_all%', 'wipe: matches first';
  -- the fight trigger fires before the card seats' (which locks the wallet): triggers fire in name order
  assert (select array_agg(tgname::text order by tgname) from pg_trigger
           where tgrelid = 'public.accounts'::regclass and tgname in ('accounts_bd_fight', 'card_accounts_bd'))
         = array['accounts_bd_fight', 'card_accounts_bd'], 'trigger order';
  assert pg_get_functiondef('public._ug_settle(uuid, smallint, text)'::regprocedure) like '%from public.ug_cups where id = mt.ref::uuid for update%_ug_rate(p_match, p_winner, 1)%', 'cup before profiles';
  -- p6 is wiped mid-match (a called rated match, both ready): p3 is paid first, p6's underground rows go
  perform public.ug_queue_leave(pg_temp.r(), pg_temp.t('p3'));
  update public.ug_profiles set rating = 1000 where account_id in (pg_temp.a('p3'), pg_temp.a('p6'));
  update public.martial_enrollments set rank = 2 where account_id = pg_temp.a('p6');
  perform public.ug_queue_join(pg_temp.r(), pg_temp.t('p3'), 500);
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p6'), 500);
  m := (j->'mine'->>'id')::uuid;
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p3'), m, 3);
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p6'), m, 3);
  b3 := pg_temp.coins('p3');
  perform public._wallet_lock(pg_temp.a('p6'));
  perform public._ac_wipe(pg_temp.a('p6'), pg_temp.a('p1'));
  select * into mt from public.fight_matches where id = m;
  assert mt.status = 'done' and (case mt.winner when 1 then mt.p1 else mt.p2 end) = pg_temp.a('p3') and mt.end_reason = 'forfeit', 'the wipe forfeits';
  assert pg_temp.coins('p3') = b3 + 950, 'the opponent is paid first';
  assert not exists (select 1 from public.ug_profiles where account_id = pg_temp.a('p6')), 'ug rows gone';
  -- a deletion mid-match: the opponent is paid, then the account goes
  perform public.ug_queue_join(pg_temp.r(), pg_temp.t('p3'), 500);
  j := public.ug_queue_join(pg_temp.r(), pg_temp.t('p5'), 500);
  m := (j->'mine'->>'id')::uuid;
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p3'), m, 3);
  perform public.ug_ready(pg_temp.r(), pg_temp.t('p5'), m, 3);
  b3 := pg_temp.coins('p3');
  delete from public.accounts where id = a5;
  assert pg_temp.coins('p3') = b3 + 950, format('deletion pays the opponent %s', pg_temp.coins('p3') - b3);
  -- the hầm is indoors (R7: an unlisted map)
  assert public._in_shade('ham_ngam', 10, 10) and public._in_shade('ham_ngam', 470, 310), 'ham_ngam is shade';
  -- privileges
  assert has_function_privilege('anon', 'public.ug_status(uuid, text)', 'execute'), 'anon: ug_status';
  assert has_function_privilege('anon', 'public.ug_queue_join(uuid, text, integer)', 'execute'), 'anon: ug_queue_join';
  assert not has_function_privilege('anon', 'public._ug_settle(uuid, smallint, text)', 'execute'), 'private: _ug_settle';
  assert not has_function_privilege('anon', 'public._ug_pair(uuid)', 'execute'), 'private: _ug_pair';
  assert not has_function_privilege('authenticated', 'public._fx_lock_live(uuid)', 'execute'), 'private: _fx_lock_live';
  -- the ledger: 51 reasons, the three new ones used
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check');
  assert (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g')) = 51, format('51 reasons: %s', def);
  assert (select count(distinct reason) from public.coin_ledger where reason in ('ug_entry', 'ug_prize', 'ug_refund')) = 3, 'ledger rows';
  raise notice 'lock order, wipe, deletion, shade, privileges, ledger ok';
end $$;
