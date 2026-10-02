# Email accounts — design (0112)

Date: 2026-09-30. Migration: `supabase/migrations/0112_email_auth.sql`. Smoke: `tests/sql/email-auth-smoke.sql`.
Owner setup (Vietnamese): `deploy/HUONG-DAN-EMAIL.md`.

## Goal

The game goes public: players register and log in with an email, can recover a forgotten password and change their
password and email. Existing username accounts keep working and can link an email.

## Shape: Supabase Auth bridged to the game's own sessions

Supabase Auth (`auth.users`) owns the email, its password, the confirmation mail, the reset mail and the email change.
The game keeps its own sessions (`public.sessions`, sha256 of a 32-byte random token) and every game RPC keeps taking
`p_session_token`. A signed-in, **confirmed** Supabase user trades its JWT for a game session with
`game_session_from_auth()`, which issues it the way `login()` does (same token, same `sessions` row, banned accounts
refused) and returns login's shape `(account_id, username, token)`. No game RPC changes.

### Two Supabase clients

`lib/supabase.ts` (the game client) is unchanged: anon key, `persistSession: false`. Every table read and realtime
policy in the chain is `to anon` (0004 …), so a signed-in JWT on that client would switch PostgREST to the
`authenticated` role and hide the game's rows. `lib/supabase-auth.ts` is a second client (`authClient`): it persists
the Supabase Auth session under its own storage key (`music-together:sb-auth`), uses PKCE, does not read the URL on
its own (the `/auth` pages do), and is used only for `supabase.auth.*` and the three auth-only RPCs. The game never
sends the user's JWT.

## Data

`public.account_auth (account_id pk → accounts on delete cascade, auth_user_id unique → auth.users on delete cascade,
email, linked_at, synced_at)`, unique index on `email`. **Refinement of the brief:** the brief put `auth_user_id` and
`email` on `accounts`, but `accounts` is readable by anon (0004's `accounts_select using (true)` plus Supabase's default
grants), so an email column there would publish every player's email. A separate table with RLS on, no policy and all
privileges revoked is only reachable through the SECURITY DEFINER RPCs. Deleting the auth user removes the link (the
account stays; the brief's "on delete set null" in table form). `accounts` gains nothing.

`public.auth_rate (kind, key, at)` counts attempts for the rate limits (rows older than a day are pruned on use).

## RPCs

| RPC | who | what |
| --- | --- | --- |
| `game_session_from_auth()` | `authenticated` only | confirmed email required (`auth.users.email_confirmed_at`, read from auth.users, not the JWT claim; anonymous / banned-by-Supabase / deleted users refused); `'no game account'` (P0002) if not linked; `'account banned'`; syncs `account_auth.email` from `auth.users.email` (a confirmed email change); 60 per hour per auth user |
| `account_create_for_auth(p_username)` | `authenticated` only | confirmed email; one account per auth user (an existing link is returned, `created:false`); register()'s name rules (`_username_clean`, shared with register); answers `{ok, error?, account_id, username, created}`; 10 per hour per auth user |
| `account_link_auth(p_session_token)` | `authenticated` only | two proofs: the game token (the account, via `_auth_account`, banned refused) and the JWT (the confirmed email); refuses an account linked to another email and an email linked to another account; idempotent; removes the legacy password; 10 per hour per auth user |
| `change_password(p_session_token, p_old, p_new)` | anon + authenticated | legacy accounts: bcrypt as register; new password 8–72 chars; ends the account's other sessions; `{ok, error?}`; 5 per 15 minutes per account (wrong passwords count) |
| `account_auth_state(p_session_token)` | anon + authenticated | `{linked, email, legacy_password}` of the token's own account (the banner, the settings) |

The rate-limited RPCs answer ordinary refusals as data (`{ok:false, error}`) rather than raising, so the attempt row
survives (a raise would roll it back); they raise only for auth failures and `'too many attempts'` (53400).
`change_password` and `account_auth_state` are anon-callable, not game actions, and on the allowlist of
`tests/sql/anticheat-guards.sql`; the three auth-only RPCs are revoked from `public` and `anon`.

`register()` / `login()` are re-created (0015's bodies): register refuses while `app_flags.legacy_register_open` is off
(inserted **on**, so nothing breaks; the owner switches it off once email sign-up works — bots could otherwise keep
creating email-less accounts through the RPC); login answers `'email login required'` for a name whose legacy password
was removed by a link (the name is public already; the email is never said).

## The legacy-account decision

After a successful link the account's **legacy password is deleted**, so username + password login stops for that
account and it logs in by email only. Reasons: the legacy login has no rate limit and no recovery, and many old
passwords are short (register never had a length rule); keeping it alive would leave the weakest door open on exactly
the accounts whose owners asked for the stronger one. Existing game sessions stay valid. Unlinked legacy accounts keep
username login, and `change_password` for them. The UI says it at the link form ("không dùng tên đăng nhập cũ nữa").

## Flows

- **Sign-up** (Email tab → Đăng ký): `signUp({email, password, options: {emailRedirectTo: origin/auth/callback,
  data: {username}}})`. Nothing is created in the game. The page says "Nếu email hợp lệ, bạn sẽ nhận được thư…" whether
  or not the email was registered (Supabase's "already registered" answer is swallowed).
- **/auth/callback**: signs in from the link — `token_hash` + `type` via `verifyOtp` (the templates in
  HUONG-DAN-EMAIL.md; works on any device) or a PKCE `code` via `exchangeCodeForSession` (Supabase's default link; the
  same browser only). Then: a pending link of this browser (see below) → `account_link_auth`; then
  `game_session_from_auth`; no account → the player chooses: create (name prefilled from the sign-up metadata; a taken
  name asks again) or link an old account by logging into it with its username + password. `type=recovery` goes on to
  `/auth/reset`.
- **Email login**: `signInWithPassword` → `game_session_from_auth` (no account yet → `/auth/callback` asks for the
  name). A page load without a valid game session but with a Supabase session gets a fresh game session.
- **Liên kết email** (Tài khoản modal, and a dismissable banner in the lobby for unlinked accounts): `signUp` with
  `data: {link_intent: true}` and a **pending marker** in localStorage `{accountId, email, at}` (2 days). The callback
  links on its own only when the marker's account is the game session of this browser and its email is the confirmed
  one. Without it (another device, or a confirmation link someone else sent — a login-CSRF that would otherwise tie the
  victim's account to the attacker's email) it never links by itself: the player must type the old username and
  password.
- **Quên mật khẩu**: `resetPasswordForEmail(email, {redirectTo: origin/auth/reset})`, the same answer for any email
  ("Nếu email tồn tại…"); the form says legacy accounts without an email cannot be recovered. `/auth/reset` accepts a
  mail link (token_hash / code) or a recovery the callback just handled (a one-shot sessionStorage mark) — a merely
  signed-in session is not enough to set a password without the current one — then `updateUser({password})`.
- **Đổi mật khẩu**: email accounts `signInWithPassword(email, current)` then `updateUser({password})`; legacy accounts
  `change_password`.
- **Đổi email**: only when the signed-in Supabase user is this account's email; `updateUser({email},
  {emailRedirectTo: callback})`; Supabase mails the confirmation(s); the game copy
  follows at the next `game_session_from_auth`.
- **Đăng xuất**: `logout(token)` and `authClient.auth.signOut({scope: 'local'})`.

## Not done / follow-ups

- Legacy `login()` still has no per-name throttle (unchanged behaviour; a lockout would let anyone lock a player out).
- Supabase's own limits (sign-up / reset mails, sign-in attempts) come from the project settings, see the guide.
- The admin accounts tab does not show emails (on purpose, for now).
- A confirmation link opened by someone else signs that browser into the sender's email user (classic login CSRF):
  it can at most log the victim into the sender's account or let them create a character under it — it never links
  the victim's own account (that needs this browser's pending marker or the old password).
- A mail link that fell back to the Site URL (redirect not on the list) lands on `/`, which forwards `token_hash` /
  `code` to `/auth/callback`.
