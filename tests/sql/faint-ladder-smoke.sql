-- tests/sql/faint-ladder-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0045, from the
-- repo root: it re-runs 0045 with \i (re-runnable). Every check is an ASSERT; the first failure stops psql.
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0045_faint_ladder.sql
\i supabase/migrations/0045_faint_ladder.sql
reset client_min_messages;

create temp table fl (k text primary key, v text);
insert into fl select 'tok', token from public.register('fl_a_' || floor(random() * 1e9)::text, 'pw123456');
create temp view flv as select (select v from fl where k = 'tok') t, public._auth_account((select v from fl where k = 'tok')) a;

-- the length of the running faint, in seconds
create or replace function pg_temp.faint_len(p uuid) returns numeric language sql as
$$ select extract(epoch from fainted_until - now()) from public.vitals where account_id = p $$;
-- ready for the next faint: awake, starving for 599 s, last tick 10 s ago
create or replace function pg_temp.starve(p uuid) returns void language sql as
$$ update public.vitals set fainted_until = null, hunger = 0, thirst = 0, starve_s = 599, last_tick = now() - interval '10 seconds'
    where account_id = p $$;

-- 0) pure rules
do $$ begin
  assert public._faint_len(1) = interval '10 seconds' and public._faint_len(2) = interval '5 minutes'
     and public._faint_len(3) = interval '15 minutes' and public._faint_len(4) = interval '1 hour', 'ladder';
  assert public._faint_len(5) = public._vn_midnight() - now() or public._faint_len(5) = interval '10 seconds', 'the 5th: till midnight';
  assert public._vn_midnight() > now() and public._vn_midnight() <= now() + interval '24 hours', 'midnight';
end $$;

-- 1) the 1st faint: starvation, 1-argument _vitals_apply → 10 s
do $$ declare x flv; j jsonb; begin
  select * into x from flv;
  perform public._vitals_apply(x.a);
  j := public._vitals_json((select v from public.vitals v where account_id = x.a));
  assert (j->>'faint_count')::int = 0 and (j->>'next_faint_s')::int = 10 and j->'locked_until_ms' = 'null'::jsonb, format('fresh %s', j);
  perform pg_temp.starve(x.a);
  perform public._vitals_apply(x.a);
  assert pg_temp.faint_len(x.a) = 10, format('1st %s', pg_temp.faint_len(x.a));
  assert (select faint_count = 1 and faint_day = public._vn_today() from public.vitals where account_id = x.a), 'count 1';
  j := public._vitals_json((select v from public.vitals v where account_id = x.a));
  assert (j->>'faint_count')::int = 1 and (j->>'next_faint_s')::int = 300, format('json 1 %s', j);
  -- still fainted: no second count on the next apply
  perform public._vitals_apply(x.a);
  assert (select faint_count from public.vitals where account_id = x.a) = 1, 'no double count';
end $$;

-- 2) the 2nd: starvation, 3-argument _vitals_apply → 5 min
do $$ declare x flv; begin
  select * into x from flv;
  perform pg_temp.starve(x.a);
  perform public._vitals_apply(x.a, 1, 1);
  assert pg_temp.faint_len(x.a) = 300, format('2nd %s', pg_temp.faint_len(x.a));
end $$;

-- 3) the 3rd: drowning (_heat_resolve) → 15 min
do $$ declare x flv; begin
  select * into x from flv;
  update public.vitals set fainted_until = null, hunger = 80, thirst = 80, starve_s = 0, last_tick = now() where account_id = x.a;
  perform public._heat_row(x.a);
  update public.heat_state set cramp_until = now() - interval '1 second', swimming = true where account_id = x.a;
  perform public._heat_resolve(x.a);
  assert pg_temp.faint_len(x.a) = 900, format('3rd %s', pg_temp.faint_len(x.a));
  assert (select faint_count from public.vitals where account_id = x.a) = 3, 'count 3';
  -- a cramp while already fainted counts nothing and keeps the faint
  update public.heat_state set cramp_until = now() - interval '1 second', swimming = true where account_id = x.a;
  perform public._heat_resolve(x.a);
  assert pg_temp.faint_len(x.a) = 900 and (select faint_count from public.vitals where account_id = x.a) = 3, 'no double drown';
end $$;

-- 4) the 4th: the cold faint in vitals_tick → 1 h; the heartbeat carries the fresh count
do $$ declare x flv; j jsonb; begin
  select * into x from flv;
  update public.vitals set fainted_until = null, hunger = 80, thirst = 80, starve_s = 0, last_tick = now() where account_id = x.a;
  perform public._rain_row(x.a);
  update public.rain_state set cold_until = now() + interval '10 minutes', cold_wet_s = 300 where account_id = x.a;
  j := public.vitals_tick(x.t, null);
  assert pg_temp.faint_len(x.a) = 3600, format('4th %s', pg_temp.faint_len(x.a));
  assert (j->>'faint_count')::int = 4 and j->'next_faint_s' = 'null'::jsonb and j->'locked_until_ms' = 'null'::jsonb
     and (j->>'fainted_until_ms')::bigint = (extract(epoch from now() + interval '1 hour') * 1000)::bigint, format('tick 4 %s', j);
end $$;

-- 5) the 5th: until VN midnight, and the lock
do $$ declare x flv; j jsonb; ok boolean := false; begin
  select * into x from flv;
  perform pg_temp.starve(x.a);
  j := public.vitals_tick(x.t, null);
  assert (select fainted_until = public._vn_midnight() from public.vitals where account_id = x.a), 'till midnight';
  assert (j->>'faint_count')::int = 5
     and (j->>'locked_until_ms')::bigint = (extract(epoch from public._vn_midnight()) * 1000)::bigint, format('tick 5 %s', j);
  assert public._exhausted(x.a), 'exhausted';
  -- the lock holds even after the faint itself is cleared
  update public.vitals set fainted_until = null, hunger = 80, thirst = 80, starve_s = 0, last_tick = now() where account_id = x.a;
  begin perform public._vitals_guard(x.a); exception when others then ok := sqlerrm = 'exhausted'; end;
  assert ok, 'guard refuses';
  ok := false;
  begin perform public._not_exhausted(x.a); exception when others then ok := sqlerrm = 'exhausted'; end;
  assert ok, '_not_exhausted refuses';
end $$;

-- 6) a new VN day: the count starts over at 10 s
do $$ declare x flv; j jsonb; begin
  select * into x from flv;
  update public.vitals set faint_day = public._vn_today() - 1 where account_id = x.a;
  assert not public._exhausted(x.a), 'unlocked';
  perform public._vitals_guard(x.a);
  j := public.vitals_tick(x.t, null);
  assert (j->>'faint_count')::int = 0 and j->'locked_until_ms' = 'null'::jsonb and (j->>'next_faint_s')::int = 10, format('new day %s', j);
  perform pg_temp.starve(x.a);
  perform public._vitals_apply(x.a, 1);
  assert pg_temp.faint_len(x.a) = 10 and (select faint_count = 1 and faint_day = public._vn_today() from public.vitals where account_id = x.a),
    'rollover: 1st again';
end $$;

-- 7) the revive is unchanged: past the faint → 30 / 30
do $$ declare x flv; v public.vitals; begin
  select * into x from flv;
  update public.vitals set fainted_until = now() - interval '1 second' where account_id = x.a;
  v := public._vitals_apply(x.a);
  assert v.fainted_until is null and v.hunger = 30 and v.thirst = 30, 'revive';
end $$;

-- 8) grants: the helpers are private
do $$ begin
  assert not has_function_privilege('anon', 'public._faint(uuid)', 'execute'), '_faint private';
  assert not has_function_privilege('anon', 'public._not_exhausted(uuid)', 'execute'), '_not_exhausted private';
  assert has_function_privilege('anon', 'public.vitals_tick(text, uuid, text, integer, integer)', 'execute'), 'tick public';
end $$;

select 'faint ladder smoke ok';
