-- tests/sql/v20-rerun.sql — the v20 migrations are re-runnable, in order, on the full chain: run as the superuser on the
-- throwaway PostgreSQL cluster right after 0004 … 0055 (0014 before 0013) and BEFORE any smoke writes rows (0050's and
-- 0051's ledger checks list fewer reasons than later rows use). Re-applies 0048 → 0052 twice, then checks the newest
-- bodies are back (0052's) and the ledger has its 51 reasons. From the repo root: psql -f tests/sql/v20-rerun.sql
\set ON_ERROR_STOP on
set client_min_messages = warning;
\i supabase/migrations/0048_fight_engine.sql
\i supabase/migrations/0049_fight_matches.sql
\i supabase/migrations/0050_dojo.sql
\i supabase/migrations/0051_bai_dat.sql
\i supabase/migrations/0052_underground.sql
\i supabase/migrations/0048_fight_engine.sql
\i supabase/migrations/0049_fight_matches.sql
\i supabase/migrations/0050_dojo.sql
\i supabase/migrations/0051_bai_dat.sql
\i supabase/migrations/0052_underground.sql
reset client_min_messages;

do $$
declare def text;
begin
  assert pg_get_functiondef('public._fx_settle(uuid, smallint, text)'::regprocedure) like '%_ug_settle%', '0052''s _fx_settle';
  assert pg_get_functiondef('public._fx_reset(integer[], integer)'::regprocedure) like '%styleByRound%', '0052''s _fx_reset';
  assert pg_get_functiondef('public.dojo_state(text)'::regprocedure) like '%_ug_hint%', '0052''s dojo_state';
  assert pg_get_functiondef('public.admin_anticheat_resolve(text, uuid, text)'::regprocedure) like '%_fx_lock_live%_wallet_lock%', '0052''s resolve';
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check');
  assert (select count(*) from regexp_matches(def, '''[a-z_]+''', 'g')) = 51, format('51 reasons: %s', def);
  assert not exists (select 1 from pg_trigger where tgname = 'fight_accounts_bd'), 'old trigger gone';
  assert exists (select 1 from pg_trigger where tgname = 'accounts_bd_fight'), 'new trigger';
  raise notice 'rerun ok: 0048 → 0052 twice, the newest bodies back';
end $$;