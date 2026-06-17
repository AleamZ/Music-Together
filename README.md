This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
# Music-Together

## Deploy (free tier)

1. **Supabase:** create a free project. **For the current (v2) schema, just run `supabase/migrations/0004_v2_rebuild.sql`** in the SQL editor — it builds the full account-native schema in one shot (see the "v2: Accounts & Lobby" section). *(The original v1 files `0001_init.sql`→`0003_realtime.sql` are kept only as history; `0004` drops and supersedes them.)*
2. **Vercel/Cloudflare Pages:** import the repo. Set env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Build command `next build`.
3. The app is client-rendered; the only server code is the `/api/oembed` proxy (a lightweight, cached function).

### Notes
- Free Supabase projects pause after ~1 week of inactivity; the first request after that is slow.
- Realtime is read-only; all writes are authorized server-side via SECURITY DEFINER RPCs.
- Phase 2 (deferred): chat, emoji reactions, song likes (UI placeholders already present); optional in-app YouTube search (needs a `YOUTUBE_API_KEY`).

## v2: Accounts & Lobby

**One-time DB migration:** open the Supabase SQL Editor and run `supabase/migrations/0004_v2_rebuild.sql`. This drops all v1 tables and functions and rebuilds the account-native schema — room data is wiped, which is acceptable in dev/staging.

**Env vars:** unchanged — `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are the only required variables.

**What's new in v2:**
- Username + password accounts (custom `accounts`/`sessions` tables + bcrypt + a per-account session token — **not** Supabase Auth); role (Admin / DJ) follows the account across devices.
- Lobby page showing all currently-active rooms (via global Realtime Presence) with live participant counts.
- Animated turntable on the room page.
- Copy-code and share buttons for easy room invites.

## v3: Admin & Feedback

### DB migration

`supabase/migrations/0005_v3_admin.sql` is **fully additive** — it uses `add column if not exists`, `create table if not exists`, and `create or replace function`, so **no data is lost**. Two options:

- **Preferred (live DB):** open the Supabase SQL Editor and run `supabase/migrations/0005_v3_admin.sql`. Existing rooms, accounts, and sessions are preserved.
- **Reset (dev/staging):** run `supabase db reset` to replay migrations `0001` → `0005` from scratch (wipes all data).

### Bootstrap the root account

After the migration runs, create the root account by executing the snippet below **once** in the Supabase SQL Editor. Replace `<STRONG_PASSWORD>` with a real, randomly-generated password before running.

> ⚠️ **Do NOT commit this snippet with a real password. Do NOT reuse any password that has ever been shared or leaked.** The GitHub repo is public.

```sql
-- Run ONCE in the Supabase SQL Editor to bootstrap the root account.
-- Replace <STRONG_PASSWORD> with a real strong password before running.
-- ⚠️  Do NOT commit this with a real password. Do NOT reuse a leaked/shared password.
do $$
declare v_id uuid;
begin
  insert into public.accounts (username, is_root)
    values ('root', true)
    on conflict (lower(username)) do update set is_root = true
    returning id into v_id;
  insert into public.account_secrets (account_id, password_hash)
    values (v_id, extensions.crypt('<STRONG_PASSWORD>', extensions.gen_salt('bf')))
    on conflict (account_id) do update set password_hash = excluded.password_hash;
end $$;
```

**Schema notes (verified against migrations):**
- `accounts.id` has `default gen_random_uuid()` — no need to supply the id explicitly.
- The unique constraint on `username` is a **functional unique index** on `lower(username)` (`accounts_username_lower_uniq`), so the conflict target is `(lower(username))`, not `(username)`.
- `account_secrets` PK is `account_id` — the second `on conflict` target is `(account_id)`.
- pgcrypto lives in the `extensions` schema (per `create extension if not exists pgcrypto with schema extensions`). A bare `do $$` block does not inherit `set search_path`, so `crypt` and `gen_salt` must be schema-qualified as `extensions.crypt(...)` / `extensions.gen_salt('bf')`.
- The snippet is idempotent: re-running it sets `is_root = true` and updates the password hash, which is safe.

### What's new in v3

- **Feedback inbox (hòm thư góp ý):** any logged-in user can submit feedback (bug / suggestion / other) via the feedback button in the lobby and room pages. Rate-limited to 10 submissions per hour per account.
- **`/admin` dashboard** (root account only): view and triage the feedback inbox; view all rooms with member counts and delete any room; view all accounts, ban/unban accounts, and delete accounts; live system stats (total rooms, accounts, new/total feedback).
- **Account ban:** banned accounts are rejected at the session-auth layer (`_auth_account`) and all their active sessions are invalidated immediately on ban.
- **Per-account rate limits:** 10 rooms/hour and 10 feedback submissions/hour enforced server-side in SECURITY DEFINER RPCs.
- **Logo branding:** app logo displayed in the header and as an animated spinner on the loading screen.

## v4: Chat, Reactions & Inline Roles

### DB migration

`supabase/migrations/0006_v4_chat_roles.sql` is **fully additive** — it uses `create table if not exists`, `create or replace function`, and `alter table … add column if not exists`, so **no data is lost**. Two options:

- **Preferred (live DB):** open the Supabase SQL Editor and run `supabase/migrations/0006_v4_chat_roles.sql`. Existing rooms, accounts, sessions, and feedback are preserved.
- **Reset (dev/staging):** run `supabase db reset` to replay migrations `0001` → `0006` from scratch (wipes all data).

> Emoji reactions use Supabase Broadcast (no DB writes) — they need **no migration**. Only the file above is required for v4.

### What's new in v4

- **Persisted room chat:** history loads on entry; updates in real-time via Supabase Realtime. Any member can send a message; the author or any room admin can delete a message. Messages are capped at 500 characters, rate-limited to 10 messages per 15 seconds per person, and only the newest 200 messages per room are retained.
- **Floating emoji reactions:** ephemeral animations powered by Supabase Broadcast (no DB storage). Palette: ❤️ 😂 🔥 👏 🎉.
- **Inline admin role menu:** a ⋯ menu on each member row (visible to admins only) provides quick access to Giao/Thu DJ, Trao Admin, and Kick — no need to open the Settings dialog (which still works too).
- **DJ revoke returns to admin:** revoking the DJ role now hands it back to the room admin instead of clearing it entirely.
