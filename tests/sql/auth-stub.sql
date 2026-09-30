-- tests/sql/auth-stub.sql — a minimal stand-in for Supabase's `auth` schema, for the throwaway test cluster ONLY (a
-- plain PostgreSQL has no auth.users / auth.uid()). It never replaces a real one: every object is created only when
-- missing. Load it before 0112 (a fresh chain: before scripts/db/migrate-all.sh). Never run it on hosted Supabase.
-- A call as a signed-in user: set local role authenticated; set local request.jwt.claim.sub = '<uuid>';
\set ON_ERROR_STOP on
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb
);
do $$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $f$create function auth.uid() returns uuid language sql stable
      as $b$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $b$ $f$;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
