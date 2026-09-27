-- tests/sql/v18-3-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0024 (see the plan),
-- from the repo root: it re-runs 0025 with \i. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
set time zone 'UTC';
set client_min_messages = warning;
\i supabase/migrations/0025_vitals.sql
reset client_min_messages;

create temp table vs_acct (acct_id uuid);
insert into vs_acct select public._auth_account(token) from public.register('vit_' || floor(random() * 1e9)::text, 'pw123456');

-- 1) first call creates a full row
do $$ declare a uuid := (select acct_id from vs_acct); v public.vitals; begin
  delete from public.vitals where account_id = a;
  v := public._vitals_apply(a);
  assert v.hunger = 100 and v.thirst = 100 and v.starve_s = 0, 'fresh row full';
end $$;
-- 2) an offline gap drains at most 120 s
do $$ declare a uuid := (select acct_id from vs_acct); v public.vitals; begin
  update public.vitals set last_tick = now() - interval '5 hours' where account_id = a;
  v := public._vitals_apply(a);
  assert abs(v.hunger - (100 - 120 * 100.0/86400)) < 1e-6, 'hunger capped drain';
  assert abs(v.thirst - (100 - 120 * 100.0/57600)) < 1e-6, 'thirst capped drain';
end $$;
-- 3) at 0 → guard refuses, starve accumulates, faint at 600 s → fainted_until ~ now+10s
do $$ declare a uuid := (select acct_id from vs_acct); v public.vitals; ok boolean := false; begin
  update public.vitals set hunger = 0, thirst = 50, starve_s = 590, last_tick = now() - interval '20 seconds' where account_id = a;
  begin perform public._vitals_guard(a); exception when others then ok := sqlerrm in ('too hungry', 'fainted'); end;
  assert ok, 'guard refuses when starving';
  v := public._vitals_apply(a);
  assert v.fainted_until is not null and v.fainted_until > now() and v.fainted_until <= now() + interval '10 seconds', 'fainted';
  assert v.starve_s = 0, 'starve reset on faint';
end $$;
-- 4) revive after fainted_until: 30/30
do $$ declare a uuid := (select acct_id from vs_acct); v public.vitals; begin
  update public.vitals set fainted_until = now() - interval '1 second' where account_id = a;
  v := public._vitals_apply(a);
  assert v.fainted_until is null and v.hunger = 30 and v.thirst = 30, 'revived 30/30';
end $$;
-- 5) restore caps at 100
do $$ declare a uuid := (select acct_id from vs_acct); j jsonb; begin
  j := public._vitals_restore(a, 500, 10);
  assert (j->>'hunger')::numeric = 100 and (j->>'thirst')::numeric = 40, 'restore capped';
end $$;
-- 6) the public RPC is callable by anon, the internals are not
do $$ begin
  -- 0030 replaces vitals_tick(text) with vitals_tick(text, uuid); either form must be callable by anon
  assert (to_regprocedure('public.vitals_tick(text)') is not null and has_function_privilege('anon', 'public.vitals_tick(text)', 'execute'))
      or (to_regprocedure('public.vitals_tick(text,uuid)') is not null and has_function_privilege('anon', 'public.vitals_tick(text,uuid)', 'execute')), 'tick granted';
  assert not has_function_privilege('anon', 'public._vitals_apply(uuid)', 'execute'), 'apply private';
end $$;

-- 7) restoring hunger only while thirst is 0 keeps starve_s
do $$ declare a uuid := (select acct_id from vs_acct); j jsonb; s numeric; begin
  update public.vitals set hunger = 0, thirst = 0, starve_s = 200, fainted_until = null, last_tick = now() where account_id = a;
  j := public._vitals_restore(a, 50, 0);
  select starve_s into s from public.vitals where account_id = a;
  assert (j->>'thirst')::numeric = 0 and s >= 200, 'starve kept while thirst is 0';
end $$;
\echo v18.3 smoke ok
