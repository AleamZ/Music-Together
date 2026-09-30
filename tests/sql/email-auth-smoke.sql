-- tests/sql/email-auth-smoke.sql — 0112, email accounts (docs/superpowers/specs/2026-09-30-email-auth-design.md).
-- Chain-level: run after the full chain on the throwaway cluster. A plain PostgreSQL has no Supabase `auth` schema,
-- so it loads tests/sql/auth-stub.sql first (created only when missing), re-runs 0112 twice with \i, then checks
-- everything inside one transaction that it rolls back (it leaves no rows). Run from the repo root.
\set ON_ERROR_STOP on
\i tests/sql/auth-stub.sql
\i supabase/migrations/0112_email_auth.sql
\i supabase/migrations/0112_email_auth.sql
\i supabase/migrations/0113_review_fixes.sql
\i supabase/migrations/0113_review_fixes.sql

\o /dev/null
begin;
-- The users: U0 unconfirmed, U1 / U2 / U3 confirmed; an anonymous one when the column exists (real Supabase).
insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-0000000000a0', 'u0@example.test', null,  '{"username":"EaZero"}'),
  ('00000000-0000-4000-8000-0000000000a1', 'U1@Example.test', now(), '{"username":"EaHero"}'),
  ('00000000-0000-4000-8000-0000000000a2', 'u2@example.test', now(), '{}'),
  ('00000000-0000-4000-8000-0000000000a3', 'u3@example.test', now(), '{}'),
  ('00000000-0000-4000-8000-0000000000a4', 'u4@example.test', now(), '{}');
update public.app_flags set enabled = true where key = 'legacy_register_open';

create temp table t (k text primary key, v text);
grant all on t to anon, authenticated;
-- two legacy accounts, L (to be linked) and M (stays legacy), and a third, B, to ban
insert into t select 'L', token from public.register('EaLegacy', 'mat-khau-L');
insert into t select 'M', token from public.register('EaMuoi', 'mat-khau-M');
insert into t select 'B', token from public.register('EaBanned', 'mat-khau-B');

-- 1. Privileges: the auth-only RPCs are not anon's; the tables are nobody's but the definer's.
do $$
begin
  assert not has_function_privilege('anon', 'public.game_session_from_auth()', 'execute'), 'anon: game_session_from_auth';
  assert not has_function_privilege('anon', 'public.account_create_for_auth(text)', 'execute'), 'anon: create';
  assert not has_function_privilege('anon', 'public.account_link_auth(text,text)', 'execute'), 'anon: link';
  assert has_function_privilege('authenticated', 'public.game_session_from_auth()', 'execute'), 'authenticated: session';
  assert has_function_privilege('authenticated', 'public.account_create_for_auth(text)', 'execute'), 'authenticated: create';
  assert has_function_privilege('authenticated', 'public.account_link_auth(text,text)', 'execute'), 'authenticated: link';
  assert has_function_privilege('anon', 'public.change_password(text,text,text)', 'execute'), 'anon: change_password';
  assert has_function_privilege('anon', 'public.account_auth_state(text)', 'execute'), 'anon: auth_state';
  assert not has_function_privilege('anon', 'public._auth_email_user()', 'execute'), 'helper';
  assert not has_function_privilege('authenticated', 'public._issue_session(uuid)', 'execute'), 'helper';
  assert not has_function_privilege('authenticated', 'public._auth_rate_hit(text,uuid,integer,interval)', 'execute'), 'helper';
  assert not has_function_privilege('authenticated', 'public._username_clean(text)', 'execute'), 'helper';
  assert not has_table_privilege('anon', 'public.account_auth', 'select'), 'anon reads account_auth';
  assert not has_table_privilege('authenticated', 'public.account_auth', 'select'), 'authenticated reads account_auth';
  assert not has_table_privilege('authenticated', 'public.auth_rate', 'select'), 'authenticated reads auth_rate';
  assert not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'accounts' and column_name in ('email', 'auth_user_id')),
    'no email on the public accounts table';
end $$;

-- 2. No JWT, or an unconfirmed email: refused, and nothing is created.
set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  begin perform public.game_session_from_auth(); assert false, 'no jwt';
  exception when others then assert sqlerrm = 'not authenticated', sqlerrm; end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a0', true);
  begin perform public.account_create_for_auth('EaZero'); assert false, 'unconfirmed create';
  exception when others then assert sqlerrm = 'email not confirmed', sqlerrm; end;
  begin perform public.game_session_from_auth(); assert false, 'unconfirmed session';
  exception when others then assert sqlerrm = 'email not confirmed', sqlerrm; end;
  begin perform public.account_link_auth((select v from t where k = 'M'), 'mat-khau-M'); assert false, 'unconfirmed link';
  exception when others then assert sqlerrm = 'email not confirmed', sqlerrm; end;
  -- an unknown auth user
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000ff', true);
  begin perform public.game_session_from_auth(); assert false, 'unknown user';
  exception when others then assert sqlerrm = 'not authenticated', sqlerrm; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.accounts where username = 'EaZero'), 'no account before the confirmation';
end $$;

-- 3. Confirmed U1: no account yet; the username rules; one account per auth user; its session works.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare r jsonb; s record;
begin
  begin perform public.game_session_from_auth(); assert false, 'no account yet';
  exception when others then assert sqlerrm = 'no game account', sqlerrm; end;
  r := public.account_create_for_auth('Ao cá');   assert r = '{"ok":false,"error":"invalid username"}', r::text;
  r := public.account_create_for_auth('x');       assert r ->> 'error' = 'invalid username', r::text;
  r := public.account_create_for_auth(E'Ea​Hero'); assert r ->> 'error' = 'invalid username', r::text;
  r := public.account_create_for_auth('ealegacy'); assert r ->> 'error' = 'username already taken', r::text;
  r := public.account_create_for_auth('  Ea   Hero ');
  assert (r ->> 'ok')::boolean and (r ->> 'created')::boolean and r ->> 'username' = 'Ea Hero', r::text;
  insert into t values ('A1', r ->> 'account_id');
  r := public.account_create_for_auth('EaAnother');
  assert (r ->> 'ok')::boolean and not (r ->> 'created')::boolean and r ->> 'account_id' = (select v from t where k = 'A1'),
    'one account per auth user: ' || r::text;
  select * into s from public.game_session_from_auth();
  assert s.account_id::text = (select v from t where k = 'A1') and s.username = 'Ea Hero' and length(s.token) = 64, 'session';
  insert into t values ('T1', s.token);
end $$;
reset role;
do $$ begin
  assert public._auth_account((select v from t where k = 'T1'))::text = (select v from t where k = 'A1'), '_auth_account';
  assert (select email from public.account_auth where auth_user_id = '00000000-0000-4000-8000-0000000000a1') = 'u1@example.test',
    'lower-cased email';
  assert not exists (select 1 from public.accounts where username = 'EaAnother'), 'no second account';
  assert not exists (select 1 from public.account_secrets where account_id = (select v from t where k = 'A1')::uuid),
    'an email account has no legacy password';
  assert (public.account_auth_state((select v from t where k = 'T1')))
    = jsonb_build_object('linked', true, 'email', 'u1@example.test', 'legacy_password', false), 'auth_state (email)';
end $$;
-- a confirmed email change is picked up at the next session
update auth.users set email = 'U1.new@example.test' where id = '00000000-0000-4000-8000-0000000000a1';
set local role authenticated;
select count(*) from public.game_session_from_auth();
reset role;
do $$ begin
  assert (select email from public.account_auth where auth_user_id = '00000000-0000-4000-8000-0000000000a1') = 'u1.new@example.test',
    'email synced';
end $$;

-- 4. Linking needs both proofs: the game token proves the account, the JWT the email.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
do $$
declare r jsonb; s record;
begin
  r := public.account_link_auth('not-a-token', 'x');
  assert r = '{"ok":false,"error":"invalid session"}', r::text;
  -- 0113: the token alone is not enough, the legacy password proves the account too
  r := public.account_link_auth((select v from t where k = 'L'), 'sai');
  assert r = '{"ok":false,"error":"wrong password"}', r::text;
  r := public.account_link_auth((select v from t where k = 'L'), null);
  assert r = '{"ok":false,"error":"wrong password"}', r::text;
  assert public.account_auth_state((select v from t where k = 'L'))
    = '{"linked": false, "email": null, "legacy_password": true}'::jsonb, 'no link without the password';
  assert to_regprocedure('public.account_link_auth(text)') is null, 'the token-only form is gone';
  r := public.account_link_auth((select v from t where k = 'L'), 'mat-khau-L');
  assert (r ->> 'ok')::boolean and (r ->> 'linked')::boolean, r::text;
  r := public.account_link_auth((select v from t where k = 'L'), 'mat-khau-L');
  assert (r ->> 'ok')::boolean and not (r ->> 'linked')::boolean, 'idempotent: ' || r::text;
  -- this auth user already has an account: M cannot be linked to it too
  r := public.account_link_auth((select v from t where k = 'M'), 'mat-khau-M');
  assert r ->> 'error' = 'email already linked', r::text;
  r := public.account_create_for_auth('EaTwo');
  assert (r ->> 'ok')::boolean and not (r ->> 'created')::boolean, 'U2 reuses L: ' || r::text;
  select * into s from public.game_session_from_auth();
  assert s.username = 'EaLegacy', 'email login reaches the linked legacy account';
end $$;
-- another auth user cannot take L over, even with L's token
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a4', true);
do $$
declare r jsonb;
begin
  r := public.account_link_auth((select v from t where k = 'L'), 'mat-khau-L');
  assert r = '{"ok":false,"error":"account already linked"}', r::text;
end $$;
reset role;
-- anon (no JWT) cannot link at all
set local role anon;
do $$
begin
  begin perform public.account_link_auth((select v from t where k = 'M'), 'mat-khau-M'); assert false, 'anon link';
  exception when insufficient_privilege then null; end;
  begin perform public.game_session_from_auth(); assert false, 'anon session';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.account_secrets s join public.accounts a on a.id = s.account_id where a.username = 'EaLegacy'),
    'the legacy password is gone after linking';
  begin perform public.login('EaLegacy', 'mat-khau-L'); assert false, 'legacy login after link';
  exception when others then assert sqlerrm = 'email login required', sqlerrm; end;
  begin perform public.login('EaMuoi', 'sai'); assert false, 'wrong password';
  exception when others then assert sqlerrm = 'invalid username or password', sqlerrm; end;
  assert (select count(*) from public.login('EaMuoi', 'mat-khau-M')) = 1, 'legacy login of an unlinked account';
  assert public._auth_account((select v from t where k = 'L')) is not null, 'L''s game session survives the link';
  assert (public.account_auth_state((select v from t where k = 'M')))
    = '{"linked": false, "email": null, "legacy_password": true}'::jsonb, 'auth_state (legacy)';
end $$;

-- 5. Banned accounts are refused, like login refuses them.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a3', true);
do $$
declare r jsonb;
begin
  r := public.account_create_for_auth('EaBanMe'); assert (r ->> 'created')::boolean, r::text;
end $$;
reset role;
update public.accounts set is_banned = true where username in ('EaBanMe', 'EaBanned');
set local role authenticated;
do $$
declare r jsonb;
begin
  begin perform public.game_session_from_auth(); assert false, 'banned session';
  exception when others then assert sqlerrm = 'account banned', sqlerrm; end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a4', true);
  r := public.account_link_auth((select v from t where k = 'B'), 'mat-khau-B');
  assert r = '{"ok":false,"error":"account banned"}', r::text;
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.account_auth where auth_user_id = '00000000-0000-4000-8000-0000000000a4'), 'U4 unlinked';
  begin perform public.login('EaBanned', 'mat-khau-B'); assert false, 'banned legacy login';
  exception when others then assert sqlerrm = 'account banned', sqlerrm; end;
end $$;

-- 6. change_password (legacy): the old password, 8–72 characters, other sessions end, 5 calls per 15 minutes.
set local role anon;
do $$
declare r jsonb; v_other text;
begin
  select token into v_other from public.login('EaMuoi', 'mat-khau-M');
  r := public.change_password((select v from t where k = 'M'), 'sai', 'mat-khau-moi-M');
  assert r = '{"ok":false,"error":"wrong password"}', r::text;
  r := public.change_password((select v from t where k = 'M'), 'mat-khau-M', 'ngan');
  assert r ->> 'error' = 'weak password', r::text;
  r := public.change_password((select v from t where k = 'M'), 'mat-khau-M', repeat('x', 73));
  assert r ->> 'error' = 'weak password', r::text;
  r := public.change_password((select v from t where k = 'M'), 'mat-khau-M', 'mat-khau-moi-M');
  assert r = '{"ok":true}', r::text;
  begin perform public.me(v_other); assert false, 'other session ended';
  exception when others then assert sqlerrm = 'invalid session', sqlerrm; end;
  assert (select account_id from public.me((select v from t where k = 'M'))) is not null, 'this session stays';
  begin perform public.login('EaMuoi', 'mat-khau-M'); assert false, 'old password';
  exception when others then assert sqlerrm = 'invalid username or password', sqlerrm; end;
  assert (select count(*) from public.login('EaMuoi', 'mat-khau-moi-M')) = 1, 'new password';
  -- the fifth call of the window is answered; the sixth is refused
  r := public.change_password((select v from t where k = 'M'), 'sai', 'mat-khau-khac');
  assert r ->> 'error' = 'wrong password', r::text;
  begin perform public.change_password((select v from t where k = 'M'), 'mat-khau-moi-M', 'mat-khau-khac'); assert false, 'rate';
  exception when others then assert sqlerrm = 'too many attempts', sqlerrm; end;
  -- an email account has no legacy password to change
  r := public.change_password((select v from t where k = 'T1'), 'x', 'mat-khau-moi-1');
  assert r ->> 'error' = 'no legacy password', r::text;
end $$;
reset role;

-- 7. Rate limits of the auth RPCs: create 10 an hour, link 10 an hour, sessions 60 an hour, per auth user.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a4', true);
do $$
declare i integer; r jsonb;
begin
  -- U4 has used two link calls (L, taken; the banned B); eight more are answered, the eleventh is refused
  for i in 1 .. 8 loop r := public.account_link_auth('bad', 'x'); assert r ->> 'error' = 'invalid session', r::text; end loop;
  begin perform public.account_link_auth('bad', 'x'); assert false, 'link rate';
  exception when others then assert sqlerrm = 'too many attempts', sqlerrm; end;
  for i in 1 .. 10 loop r := public.account_create_for_auth('Ao cá'); assert r ->> 'error' = 'invalid username', r::text; end loop;
  begin perform public.account_create_for_auth('EaFour'); assert false, 'create rate';
  exception when others then assert sqlerrm = 'too many attempts', sqlerrm; end;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
  for i in 1 .. 59 loop perform public.game_session_from_auth(); end loop;   -- one earlier: 60
  begin perform public.game_session_from_auth(); assert false, 'session rate';
  exception when others then assert sqlerrm = 'too many attempts', sqlerrm; end;
end $$;
reset role;

-- 7b. 0113: the legacy password of a link, 5 tries per 15 minutes per account (M had one in section 4)
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
do $$
declare i integer; r jsonb;
begin
  for i in 1 .. 4 loop
    r := public.account_link_auth((select v from t where k = 'M'), 'sai'); assert r ->> 'error' = 'wrong password', r::text;
  end loop;
  begin perform public.account_link_auth((select v from t where k = 'M'), 'mat-khau-moi-M'); assert false, 'link password rate';
  exception when others then assert sqlerrm = 'too many attempts', sqlerrm; end;
end $$;
reset role;

-- 8. The legacy register switch, and a deleted auth user.
update public.app_flags set enabled = false where key = 'legacy_register_open';
do $$ begin
  begin perform public.register('EaClosed', 'mat-khau-C'); assert false, 'closed register';
  exception when others then assert sqlerrm = 'legacy register closed', sqlerrm; end;
end $$;
update public.app_flags set enabled = true where key = 'legacy_register_open';
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a3';
do $$ begin
  assert not exists (select 1 from public.account_auth where auth_user_id = '00000000-0000-4000-8000-0000000000a3'), 'link gone';
  assert exists (select 1 from public.accounts where username = 'EaBanMe'), 'the account stays';
end $$;

rollback;
\o
\echo 'email-auth smoke: ok'
