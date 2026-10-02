-- =========================================================
-- 0112_email_auth.sql — email accounts (docs/superpowers/specs/2026-09-30-email-auth-design.md). ADDITIVE and
-- re-runnable. Needs Supabase's `auth` schema (auth.users, auth.uid()); it never creates it.
-- Supabase Auth owns the email + password (confirmation, reset, change); the game keeps its own session tokens, so no
-- game RPC changes: an email user trades a confirmed Supabase JWT for a game session (game_session_from_auth).
--   A. account_auth: the link account ↔ auth user + its email. A table of its own, NOT columns of accounts: accounts is
--      readable by anon (0004's accounts_select), an email there would be public. RLS on, no policy, no grant.
--      auth_rate: attempts of the auth RPCs (rate limits).
--   B. _username_clean — register()'s name rules (0015), shared; _issue_session — login()'s token and sessions row;
--      _auth_email_user — the caller's auth user, refused unless its email is confirmed.
--   C. game_session_from_auth()          authenticated only: the linked account's game session (login()'s shape).
--      account_create_for_auth(name)     authenticated only: one account per confirmed auth user.
--      account_link_auth(game token)     authenticated only: links the legacy account the token proves to the auth
--                                         user the JWT proves; the legacy password is then removed (email login only).
--      change_password(token, old, new)  legacy accounts (bcrypt in account_secrets), rate-limited; ends other sessions.
--      account_auth_state(token)         the account's own link state (the banner, the settings).
--   D. register() refuses while app_flags.legacy_register_open is off (on after this migration: the owner turns it
--      off once email works); login() tells a linked account to use its email.
-- =========================================================

-- ---------- A. Tables ----------
create table if not exists public.account_auth (
  account_id   uuid primary key references public.accounts(id) on delete cascade,
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,   -- the auth user gone: the link goes
  email        text,                                                                -- lower case, auth.users' copy
  linked_at    timestamptz not null default now(),
  synced_at    timestamptz not null default now()
);
create unique index if not exists account_auth_email_uniq on public.account_auth (email) where email is not null;
alter table public.account_auth enable row level security;
revoke all on public.account_auth from public, anon, authenticated;

create table if not exists public.auth_rate (
  kind text not null,
  key  uuid not null,
  at   timestamptz not null default now()
);
create index if not exists auth_rate_kind_key_at on public.auth_rate (kind, key, at);
alter table public.auth_rate enable row level security;
revoke all on public.auth_rate from public, anon, authenticated;

insert into public.app_flags (key, enabled) values ('legacy_register_open', true) on conflict (key) do nothing;

-- ---------- B. Helpers ----------
-- Counts one attempt of p_kind by p_key; raises 'too many attempts' past p_max in p_window. The row persists only when
-- the calling RPC does not raise afterwards, so the RPCs below answer their ordinary refusals as data.
create or replace function public._auth_rate_hit(p_kind text, p_key uuid, p_max integer, p_window interval)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer;
begin
  delete from public.auth_rate where kind = p_kind and key = p_key and at < now() - greatest(p_window, interval '1 day');
  select count(*) into v_n from public.auth_rate where kind = p_kind and key = p_key and at > now() - p_window;
  if v_n >= p_max then raise exception 'too many attempts' using errcode = '53400'; end if;
  insert into public.auth_rate (kind, key) values (p_kind, p_key);
end; $$;
revoke all on function public._auth_rate_hit(text, uuid, integer, interval) from public, anon, authenticated;

-- register()'s rules (0015): 2–24 characters, no control / odd-space / invisible / combining character, no reserved
-- name, unique on the normalized form. Returns the stored form (NFC, single spaces).
create or replace function public._username_clean(p_username text) returns text
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_name text := regexp_replace(btrim(normalize(coalesce(p_username, ''), NFC)), ' {2,}', ' ', 'g');
begin
  if char_length(v_name) not between 2 and 24
     or v_name ~ '[\u0001-\u001f\u007f-\u009f   -     　­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ￰-￿\U000e0000-\U000e0fff̀-ͯ᪰-᫿᷀-᷿⃐-⃿︠-︯]'
     or public._name_key(v_name) in ('aoca', 'hoptacxa', 'hethong', 'quantri', 'quantrivien', 'admin', 'root', 'system') then
    raise exception 'invalid username' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts a where public._name_norm(a.username) = public._name_norm(v_name)) then
    raise exception 'username already taken' using errcode = '23505';
  end if;
  return v_name;
end; $$;
revoke all on function public._username_clean(text) from public, anon, authenticated;

-- login()'s session: 32 random bytes, hex; the sessions row keeps its sha256.
create or replace function public._issue_session(p_account uuid) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare v_token text := encode(gen_random_bytes(32), 'hex');
begin
  insert into public.sessions (token_hash, account_id) values (encode(digest(v_token, 'sha256'), 'hex'), p_account);
  return v_token;
end; $$;
revoke all on function public._issue_session(uuid) from public, anon, authenticated;

-- The caller's auth user (auth.uid() from the JWT), read from auth.users — the authority on the email and its
-- confirmation, not the JWT's claims. Refused: no JWT, an unknown / deleted / banned / anonymous user, no email or an
-- unconfirmed one. Optional columns are read through to_jsonb, so the check survives auth schema versions.
create or replace function public._auth_email_user(out auth_user_id uuid, out email text)
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_uid uuid := auth.uid(); v_u jsonb;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select to_jsonb(u) into v_u from auth.users u where u.id = v_uid;
  if v_u is null
     or coalesce((v_u ->> 'is_anonymous')::boolean, false)
     or (v_u ->> 'deleted_at') is not null
     or coalesce((v_u ->> 'banned_until')::timestamptz > now(), false) then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if nullif(btrim(v_u ->> 'email'), '') is null or (v_u ->> 'email_confirmed_at') is null then
    raise exception 'email not confirmed' using errcode = '42501';
  end if;
  auth_user_id := v_uid;
  email := lower(btrim(v_u ->> 'email'));
end; $$;
revoke all on function public._auth_email_user() from public, anon, authenticated;

-- ---------- C. The RPCs ----------
-- The linked account's game session, the way login() issues one (a banned account is refused, as login refuses it
-- after the right password). Keeps account_auth.email in step with auth.users (a confirmed email change).
drop function if exists public.game_session_from_auth();
create function public.game_session_from_auth(out account_id uuid, out username text, out token text)
language plpgsql security definer set search_path = public, extensions
as $$
declare v_uid uuid; v_email text; v_banned boolean;
begin
  select e.auth_user_id, e.email into v_uid, v_email from public._auth_email_user() e;
  select a.id, a.username, a.is_banned into account_id, username, v_banned
    from public.account_auth l join public.accounts a on a.id = l.account_id
   where l.auth_user_id = v_uid;
  if account_id is null then raise exception 'no game account' using errcode = 'P0002'; end if;
  if v_banned then raise exception 'account banned' using errcode = '42501'; end if;
  perform public._auth_rate_hit('session', v_uid, 60, interval '1 hour');
  update public.account_auth l set email = v_email, synced_at = now()
   where l.auth_user_id = v_uid and l.email is distinct from v_email
     and not exists (select 1 from public.account_auth o where o.email = v_email and o.auth_user_id <> v_uid);
  token := public._issue_session(account_id);
end; $$;
revoke all on function public.game_session_from_auth() from public, anon;
grant execute on function public.game_session_from_auth() to authenticated;

-- One game account per confirmed auth user. Already linked: that account (created false). Otherwise the name follows
-- register()'s rules. Answers {ok, error?, account_id?, username?, created?}; 10 calls an hour per auth user.
drop function if exists public.account_create_for_auth(text);
create function public.account_create_for_auth(p_username text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_uid uuid; v_email text; v_acc uuid; v_name text;
begin
  select e.auth_user_id, e.email into v_uid, v_email from public._auth_email_user() e;
  perform public._auth_rate_hit('create', v_uid, 10, interval '1 hour');
  select a.id, a.username into v_acc, v_name
    from public.account_auth l join public.accounts a on a.id = l.account_id where l.auth_user_id = v_uid;
  if v_acc is not null then
    return jsonb_build_object('ok', true, 'account_id', v_acc, 'username', v_name, 'created', false);
  end if;
  if exists (select 1 from public.account_auth o where o.email = v_email) then
    return jsonb_build_object('ok', false, 'error', 'email already linked');
  end if;
  begin
    v_name := public._username_clean(p_username);
    v_acc := gen_random_uuid();
    insert into public.accounts (id, username) values (v_acc, v_name);
    insert into public.account_auth (account_id, auth_user_id, email) values (v_acc, v_uid, v_email);
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'username already taken');
    when sqlstate '22023' then
      return jsonb_build_object('ok', false, 'error', 'invalid username');
  end;
  return jsonb_build_object('ok', true, 'account_id', v_acc, 'username', v_name, 'created', true);
end; $$;
revoke all on function public.account_create_for_auth(text) from public, anon;
grant execute on function public.account_create_for_auth(text) to authenticated;

-- Links a legacy account to the caller's auth user. Two proofs: the game session token proves the account, the JWT
-- (auth.uid(), confirmed email) proves the email. Afterwards the account logs in by email only: its legacy password is
-- removed (the spec's "legacy-account decision"); its game sessions stay valid. 10 calls an hour per auth user.
drop function if exists public.account_link_auth(text);
create function public.account_link_auth(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_uid uuid; v_email text; v_acc uuid; v_other uuid;
begin
  select e.auth_user_id, e.email into v_uid, v_email from public._auth_email_user() e;
  perform public._auth_rate_hit('link', v_uid, 10, interval '1 hour');
  begin
    v_acc := public._auth_account(p_session_token);
  exception when sqlstate '42501' then
    return jsonb_build_object('ok', false, 'error', case when sqlerrm = 'account banned' then 'account banned' else 'invalid session' end);
  end;
  select l.auth_user_id into v_other from public.account_auth l where l.account_id = v_acc;
  if v_other = v_uid then
    return jsonb_build_object('ok', true, 'account_id', v_acc, 'linked', false);
  elsif v_other is not null then
    return jsonb_build_object('ok', false, 'error', 'account already linked');
  end if;
  if exists (select 1 from public.account_auth l where l.auth_user_id = v_uid or l.email = v_email) then
    return jsonb_build_object('ok', false, 'error', 'email already linked');
  end if;
  begin
    insert into public.account_auth (account_id, auth_user_id, email) values (v_acc, v_uid, v_email);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'email already linked');
  end;
  delete from public.account_secrets where account_id = v_acc;
  return jsonb_build_object('ok', true, 'account_id', v_acc, 'linked', true);
end; $$;
revoke all on function public.account_link_auth(text) from public, anon;
grant execute on function public.account_link_auth(text) to authenticated;

-- A legacy account's password (bcrypt, as register()). 5 calls per 15 minutes per account, wrong ones included (they
-- answer as data, so the count persists). The new password: 8–72 characters (bcrypt reads 72 bytes). Other sessions
-- of the account end; this one stays. An email account changes its password through Supabase Auth instead.
drop function if exists public.change_password(text, text, text);
create function public.change_password(p_session_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid := public._auth_account(p_session_token); v_hash text;
begin
  perform public._auth_rate_hit('password', v_acc, 5, interval '15 minutes');
  select s.password_hash into v_hash from public.account_secrets s where s.account_id = v_acc;
  if v_hash is null then return jsonb_build_object('ok', false, 'error', 'no legacy password'); end if;
  if crypt(coalesce(p_old, ''), v_hash) <> v_hash then return jsonb_build_object('ok', false, 'error', 'wrong password'); end if;
  if char_length(coalesce(p_new, '')) < 8 or octet_length(p_new) > 72 then
    return jsonb_build_object('ok', false, 'error', 'weak password');
  end if;
  update public.account_secrets set password_hash = crypt(p_new, gen_salt('bf')) where account_id = v_acc;
  delete from public.sessions
   where account_id = v_acc and token_hash <> encode(digest(p_session_token, 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end; $$;
revoke all on function public.change_password(text, text, text) from public;
grant execute on function public.change_password(text, text, text) to anon, authenticated;

-- The account's own link state: {linked, email, legacy_password}. Only the session's owner reads it.
drop function if exists public.account_auth_state(text);
create function public.account_auth_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_acc uuid := public._auth_account(p_session_token); v_email text; v_linked boolean;
begin
  select true, l.email into v_linked, v_email from public.account_auth l where l.account_id = v_acc;
  return jsonb_build_object('linked', coalesce(v_linked, false), 'email', v_email,
    'legacy_password', exists (select 1 from public.account_secrets s where s.account_id = v_acc));
end; $$;
revoke all on function public.account_auth_state(text) from public;
grant execute on function public.account_auth_state(text) to anon, authenticated;

-- ---------- D. register() and login() ----------
-- 0015's register, verbatim but for the flag (and the rules now in _username_clean): new username-only accounts can
-- be closed once email sign-up works (update public.app_flags set enabled = false where key = 'legacy_register_open').
create or replace function public.register(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_name text;
begin
  if not public._app_flag('legacy_register_open') then
    raise exception 'legacy register closed' using errcode = '42501';
  end if;
  v_name := public._username_clean(p_username);
  account_id := gen_random_uuid(); username := v_name;
  insert into public.accounts (id, username) values (account_id, v_name);
  insert into public.account_secrets (account_id, password_hash) values (account_id, crypt(p_password, gen_salt('bf')));
  token := public._issue_session(account_id);
end; $$;

-- 0015's login, verbatim but for the hint: a name that exists but has no legacy password because it was linked to an
-- email is told to log in by email (the name is public anyway, accounts_select; the email is never said).
create or replace function public.login(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text; v_banned boolean;
begin
  select a.id, a.username, s.password_hash, a.is_banned into account_id, username, v_hash, v_banned
  from public.accounts a join public.account_secrets s on s.account_id = a.id
  where public._name_norm(a.username) = public._name_norm(p_username)
  order by (lower(a.username) = lower(btrim(p_username))) desc, a.created_at
  limit 1;
  if account_id is null and exists (
       select 1 from public.accounts a join public.account_auth l on l.account_id = a.id
        where public._name_norm(a.username) = public._name_norm(p_username)) then
    raise exception 'email login required' using errcode = '28P01';
  end if;
  if account_id is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid username or password' using errcode = '28P01';
  end if;
  if v_banned then
    raise exception 'account banned' using errcode = '42501';
  end if;
  token := public._issue_session(account_id);
end; $$;

grant execute on function public.register(text, text) to anon, authenticated;
grant execute on function public.login(text, text) to anon, authenticated;
