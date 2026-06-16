# Music Together v3 Implementation Plan — Feedback Inbox, Root Role, Hardening & Logo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a feedback inbox (all logged-in users submit; root reads/manages), a system-wide `root` role with an `/admin` dashboard (feedback, rooms, accounts, stats), abuse hardening (account ban + per-account rate limits), and brand the app with `public/logo.png` (header + animated loader + turntable label).

**Architecture:** Additive Supabase migration `0005_v3_admin.sql` (no data drop) adds `is_root`/`is_banned` columns, a `created_by_account_id` column, a `feedback` table (RLS, no client read), and SECURITY-DEFINER RPCs following the v2 session-auth pattern; `_auth_account` gains a ban check, plus a new `_auth_root` helper. Client: thin RPC wrappers + an `/admin` route gated on `is_root`, a feedback modal reachable everywhere, and a shared `Logo`/`BrandSpinner` via `next/image`.

**Tech Stack:** Next.js 16.2.9, React 19, TS 5, Tailwind v4, `@supabase/supabase-js`, `next/image`, Vitest.

**Builds on:** v2 (account/session model). v3 spec: [docs/superpowers/specs/2026-06-16-music-together-v3-admin-feedback-design.md](../specs/2026-06-16-music-together-v3-admin-feedback-design.md).

---

## Conventions & prerequisites
- v2 facts hold: session token in `localStorage` (`music-together:auth`); write RPCs take `(…, p_session_token)`; `_auth_account` resolves the session→account; SECURITY DEFINER + `set search_path = public, extensions`; secrets isolated; `using(true)` SELECT kept (per spec §2 — no read re-architecture).
- **Migration is additive** (`0005`): `add column if not exists`, `create table if not exists`, `create or replace` (or drop+create where an OUT-param signature changes). It must NOT drop data tables. Apply by pasting into the Supabase SQL Editor (or `supabase db reset` runs 0001→0005).
- **Root account is created OUT-OF-BAND** (private SQL in the Supabase SQL Editor, not committed). The plan never contains a root password.
- **Branch:** implement on a feature branch `feat/v3-admin` (so Vercel's `main` auto-deploy isn't triggered mid-work); merge to `main` when done.
- Commits: one per task (or red/green pair).

---

## File map (v3)
```
supabase/migrations/0005_v3_admin.sql     # CREATE: columns + feedback + RPCs + rate-limits (additive)
lib/auth.ts                               # MODIFY: Account gains isRoot; fetchMe returns it
lib/feedback.ts                           # CREATE: submitFeedback wrapper
lib/admin.ts                              # CREATE: root RPC wrappers + row types
hooks/useAuth.tsx                         # MODIFY: account.isRoot via fetchMe on login/register/restore
components/brand/Logo.tsx                 # CREATE: next/image static logo + wordmark
components/brand/BrandSpinner.tsx         # CREATE: animated logo loader
components/feedback/FeedbackButton.tsx    # CREATE: button + modal trigger
components/feedback/FeedbackModal.tsx     # CREATE: category + message form
components/admin/FeedbackTab.tsx          # CREATE
components/admin/RoomsTab.tsx             # CREATE
components/admin/AccountsTab.tsx          # CREATE
components/admin/StatsTab.tsx             # CREATE
app/admin/page.tsx                        # CREATE: root-gated dashboard shell + tabs
components/lobby/Lobby.tsx                # MODIFY: Logo + "Góp ý" + "Quản trị" link
components/room/Header.tsx                # MODIFY: Logo + "Góp ý"
components/auth/AuthScreen.tsx            # MODIFY: Logo in title
components/room/Turntable.tsx             # MODIFY: logo as center-label fallback
app/room/[code]/RoomClient.tsx            # MODIFY: loading screens → BrandSpinner
app/page.tsx                              # MODIFY: loading screen → BrandSpinner
app/globals.css                           # MODIFY: add logo spin/pulse keyframes
tests/integration/admin.test.ts           # CREATE: feedback + non-root rejection + rate-limit
```

> CSS animation for the loader: the v1 `@keyframes vinyl-spin` + `.animate-vinyl` already exist (Turntable). Add a gentle `@keyframes brand-pulse` for `BrandSpinner` (or reuse `animate-vinyl` for a spin). Keep additions in `globals.css`.

---

# Phase A — Backend (`0005` migration + tests)

## Task A1: Migration `0005_v3_admin.sql`

**Files:** Create `supabase/migrations/0005_v3_admin.sql`

> Additive & idempotent. No isolated test; exercised by Task A2 + manual. Note `me` changes its OUT params (adds `is_root`), so it must be DROPped then CREATEd (and re-granted); the others are `create or replace` (signature unchanged) or new.

- [ ] **Step 1: Create the file**

```sql
-- =========================================================
-- 0005_v3_admin.sql — v3: feedback, root role, ban, rate-limits. ADDITIVE (no data drop).
-- =========================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- columns ----------
alter table public.accounts add column if not exists is_root   boolean not null default false;
alter table public.accounts add column if not exists is_banned boolean not null default false;
alter table public.rooms    add column if not exists created_by_account_id uuid references public.accounts(id) on delete set null;

-- ---------- feedback table ----------
create table if not exists public.feedback (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete set null,
  username   text not null,
  category   text not null check (category in ('bug','suggestion','other')),
  message    text not null,
  status     text not null default 'new' check (status in ('new','handled')),
  created_at timestamptz not null default now()
);
create index if not exists idx_feedback_status_created  on public.feedback (status, created_at desc);
create index if not exists idx_feedback_account_created on public.feedback (account_id, created_at desc);
alter table public.feedback enable row level security;
-- No policies on feedback -> never client-readable/writable; only SECURITY DEFINER RPCs touch it.

-- ---------- _auth_account: add ban check (signature unchanged -> replace) ----------
create or replace function public._auth_account(p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text := encode(digest(p_session_token, 'sha256'), 'hex'); v_account uuid; v_banned boolean;
begin
  update public.sessions set last_seen = now() where token_hash = v_hash returning account_id into v_account;
  if v_account is null then raise exception 'invalid session' using errcode = '42501'; end if;
  select is_banned into v_banned from public.accounts where id = v_account;
  if v_banned then raise exception 'account banned' using errcode = '42501'; end if;
  return v_account;
end; $$;

-- ---------- _auth_root ----------
create or replace function public._auth_root(p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_root boolean;
begin
  v_account := public._auth_account(p_session_token);
  select is_root into v_root from public.accounts where id = v_account;
  if not coalesce(v_root, false) then raise exception 'root role required' using errcode = '42501'; end if;
  return v_account;
end; $$;
revoke all on function public._auth_root(text) from public, anon, authenticated;

-- ---------- me: add is_root (OUT params change -> drop + create + re-grant) ----------
drop function if exists public.me(text);
create function public.me(p_token text, out account_id uuid, out username text, out is_root boolean)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  account_id := public._auth_account(p_token);
  select a.username, a.is_root into username, is_root from public.accounts a where a.id = account_id;
end; $$;
grant execute on function public.me(text) to anon, authenticated;

-- ---------- create_room: set created_by + rate-limit (signature unchanged -> replace; grant persists) ----------
create or replace function public.create_room(
  p_room_name text, p_password text, p_session_token text,
  out code text, out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_code text; v_recent int;
begin
  v_account := public._auth_account(p_session_token);
  select count(*) into v_recent from public.rooms
    where created_by_account_id = v_account and created_at > now() - interval '1 hour';
  if v_recent >= 10 then raise exception 'too many rooms, try later' using errcode = '53400'; end if;
  loop
    v_code := 'salon-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 6);
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;
  room_id := gen_random_uuid(); code := v_code;
  insert into public.rooms (id, code, name, play_mode, created_by_account_id)
    values (room_id, v_code, p_room_name, 'order', v_account);
  insert into public.room_secrets (room_id, password_hash) values (room_id, crypt(p_password, gen_salt('bf')));
  insert into public.members (room_id, account_id) values (room_id, v_account) returning id into member_id;
  update public.rooms set admin_member_id = member_id, dj_member_id = member_id where id = room_id;
end; $$;

-- ---------- feedback RPCs ----------
create or replace function public.submit_feedback(p_session_token text, p_category text, p_message text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_name text; v_recent int; v_id uuid;
begin
  v_account := public._auth_account(p_session_token);
  if p_category not in ('bug','suggestion','other') then raise exception 'invalid category' using errcode='22023'; end if;
  if p_message is null or length(btrim(p_message)) = 0 then raise exception 'empty message' using errcode='22023'; end if;
  select count(*) into v_recent from public.feedback
    where account_id = v_account and created_at > now() - interval '1 hour';
  if v_recent >= 10 then raise exception 'too many feedback, try later' using errcode='53400'; end if;
  select username into v_name from public.accounts where id = v_account;
  insert into public.feedback (account_id, username, category, message)
    values (v_account, v_name, p_category, btrim(p_message)) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.list_feedback(p_session_token text)
returns setof public.feedback language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query select * from public.feedback order by created_at desc;
end; $$;

create or replace function public.set_feedback_status(p_session_token text, p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  if p_status not in ('new','handled') then raise exception 'invalid status' using errcode='22023'; end if;
  update public.feedback set status = p_status where id = p_id;
end; $$;

create or replace function public.delete_feedback(p_session_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  delete from public.feedback where id = p_id;
end; $$;

-- ---------- admin RPCs (root only) ----------
create or replace function public.admin_list_rooms(p_session_token text)
returns table(id uuid, code text, name text, is_playing boolean, created_at timestamptz, creator text, member_count bigint)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query
    select r.id, r.code, r.name, r.is_playing, r.created_at,
           a.username,
           (select count(*) from public.members m where m.room_id = r.id)
    from public.rooms r
    left join public.accounts a on a.id = r.created_by_account_id
    order by r.created_at desc;
end; $$;

create or replace function public.admin_delete_room(p_session_token text, p_room_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  delete from public.rooms where id = p_room_id;
end; $$;

create or replace function public.admin_list_accounts(p_session_token text)
returns table(id uuid, username text, is_root boolean, is_banned boolean, created_at timestamptz)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query select a.id, a.username, a.is_root, a.is_banned, a.created_at
               from public.accounts a order by a.created_at desc;
end; $$;

create or replace function public.admin_set_ban(p_session_token text, p_account_id uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth_root(p_session_token);
  if p_account_id = v_self then raise exception 'cannot ban yourself' using errcode='42501'; end if;
  update public.accounts set is_banned = p_banned where id = p_account_id;
  if p_banned then delete from public.sessions where account_id = p_account_id; end if;
end; $$;

create or replace function public.admin_delete_account(p_session_token text, p_account_id uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth_root(p_session_token);
  if p_account_id = v_self then raise exception 'cannot delete yourself' using errcode='42501'; end if;
  delete from public.accounts where id = p_account_id;
end; $$;

create or replace function public.admin_stats(p_session_token text)
returns table(total_rooms bigint, total_accounts bigint, feedback_new bigint, feedback_total bigint)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return query select
    (select count(*) from public.rooms),
    (select count(*) from public.accounts),
    (select count(*) from public.feedback where status = 'new'),
    (select count(*) from public.feedback);
end; $$;

-- ---------- grants (public-facing RPCs; _auth_root NOT granted) ----------
grant execute on function public.submit_feedback(text,text,text)      to anon, authenticated;
grant execute on function public.list_feedback(text)                  to anon, authenticated;
grant execute on function public.set_feedback_status(text,uuid,text)  to anon, authenticated;
grant execute on function public.delete_feedback(text,uuid)           to anon, authenticated;
grant execute on function public.admin_list_rooms(text)               to anon, authenticated;
grant execute on function public.admin_delete_room(text,uuid)         to anon, authenticated;
grant execute on function public.admin_list_accounts(text)            to anon, authenticated;
grant execute on function public.admin_set_ban(text,uuid,boolean)     to anon, authenticated;
grant execute on function public.admin_delete_account(text,uuid)      to anon, authenticated;
grant execute on function public.admin_stats(text)                    to anon, authenticated;
```

- [ ] **Step 2: Sanity-check** — re-read the file: balanced `$$`; every function `set search_path = public, extensions`; `me` is drop+create+re-grant; `create_room` keeps its 3 OUT params (so `create or replace` is valid); `feedback` has RLS + no policy; `_auth_root` is revoked, not granted. No `drop table`/`drop column` anywhere.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0005_v3_admin.sql
git commit -m "feat(db): v3 additive migration — feedback, root role, ban, rate-limits"
```

---

## Task A2: v3 integration tests (anon-testable paths)

**Files:** Create `tests/integration/admin.test.ts`

> Runs only with `SUPABASE_TEST_URL` + `SUPABASE_TEST_ANON_KEY` against a DB where `0005` is applied; otherwise skips. With only the anon key we can test: feedback validation + rate-limit, and that a NON-root account is rejected by every admin/feedback-read RPC. Root happy-paths + ban require a root session (set via private SQL) → covered in manual testing (documented in Task E1).

- [ ] **Step 1: Write the test file**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v3 feedback + admin gating", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };

  it("submit_feedback validates category and message", async () => {
    const a = await reg(uniq("fb"));
    const bad = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "spam", p_message: "x" });
    expect(bad.error?.message).toContain("invalid category");
    const empty = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "bug", p_message: "   " });
    expect(empty.error?.message).toContain("empty message");
    const ok = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "suggestion", p_message: "Great app" });
    expect(ok.error).toBeNull();
  });

  it("submit_feedback is rate-limited to 10/hour", async () => {
    const a = await reg(uniq("rl"));
    for (let i = 0; i < 10; i++) {
      const r = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "other", p_message: `m${i}` });
      expect(r.error).toBeNull();
    }
    const over = await db.rpc("submit_feedback", { p_session_token: a.token, p_category: "other", p_message: "11th" });
    expect(over.error?.message).toContain("too many feedback");
  });

  it("non-root accounts are rejected by every admin/feedback-read RPC", async () => {
    const a = await reg(uniq("nonroot"));
    const t = a.token;
    const calls: Array<readonly [string, Record<string, unknown>]> = [
      ["list_feedback", { p_session_token: t }],
      ["set_feedback_status", { p_session_token: t, p_id: "00000000-0000-0000-0000-000000000000", p_status: "handled" }],
      ["delete_feedback", { p_session_token: t, p_id: "00000000-0000-0000-0000-000000000000" }],
      ["admin_list_rooms", { p_session_token: t }],
      ["admin_delete_room", { p_session_token: t, p_room_id: "00000000-0000-0000-0000-000000000000" }],
      ["admin_list_accounts", { p_session_token: t }],
      ["admin_set_ban", { p_session_token: t, p_account_id: "00000000-0000-0000-0000-000000000000", p_banned: true }],
      ["admin_delete_account", { p_session_token: t, p_account_id: "00000000-0000-0000-0000-000000000000" }],
      ["admin_stats", { p_session_token: t }],
    ];
    for (const [fn, args] of calls) {
      const r = await db.rpc(fn, args);
      expect(r.error?.message, fn).toContain("root role required");
    }
  });

  it("create_room is rate-limited to 10/hour", async () => {
    const a = await reg(uniq("rooms"));
    for (let i = 0; i < 10; i++) {
      const r = await db.rpc("create_room", { p_room_name: `R${i}`, p_password: "secret", p_session_token: a.token });
      expect(r.error).toBeNull();
    }
    const over = await db.rpc("create_room", { p_room_name: "R11", p_password: "secret", p_session_token: a.token });
    expect(over.error?.message).toContain("too many rooms");
  });

  it("me() returns is_root=false for a normal account", async () => {
    const a = await reg(uniq("me"));
    const { data } = await db.rpc("me", { p_token: a.token });
    expect((Array.isArray(data) ? data[0] : data).is_root).toBe(false);
  });
});
```

- [ ] **Step 2: Run (skips without DB env)** `npm test -- tests/integration/admin.test.ts` → SKIPPED without env; with a v3-migrated DB → PASS. Confirm `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/admin.test.ts
git commit -m "test(db): v3 feedback validation/rate-limit + non-root rejection"
```

---

# Phase B — Client wiring

## Task B1: `me` → isRoot through `lib/auth.ts` + `useAuth`

**Files:** Modify `lib/auth.ts`, `hooks/useAuth.tsx`

- [ ] **Step 1: `lib/auth.ts`** — `Account` gains `isRoot`; `fetchMe` maps it. Replace the `Account` interface and `fetchMe`:

```ts
export interface Account { accountId: string; username: string; isRoot: boolean; }
export interface AuthResult { accountId: string; username: string; token: string; }
```
```ts
export async function fetchMe(token: string): Promise<Account | null> {
  const { data, error } = await supabase.rpc("me", { p_token: token });
  if (error) return null;
  const r = row<{ account_id: string; username: string; is_root: boolean }>(data);
  return r?.account_id ? { accountId: r.account_id, username: r.username, isRoot: !!r.is_root } : null;
}
```
(Keep `registerAccount`/`loginAccount` returning `{accountId, username, token}` — `AuthResult` no longer extends `Account` since it has no `isRoot`; update their return type annotations to `AuthResult`.)

- [ ] **Step 2: `hooks/useAuth.tsx`** — after login/register, derive the full account (incl. `isRoot`) via `fetchMe` (single source of truth). Replace `login`/`register`:

```ts
  const login = useCallback(async (u: string, p: string) => {
    const r = await loginAccount(u, p);
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    const acct = (await fetchMe(r.token)) ?? { accountId: r.accountId, username: r.username, isRoot: false };
    setAccount(acct); setToken(r.token); startLobby(acct);
  }, [startLobby]);

  const register = useCallback(async (u: string, p: string) => {
    const r = await registerAccount(u, p);
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    const acct = (await fetchMe(r.token)) ?? { accountId: r.accountId, username: r.username, isRoot: false };
    setAccount(acct); setToken(r.token); startLobby(acct);
  }, [startLobby]);
```
(The restore effect already uses `fetchMe`; `startLobby(a: Account)` only reads `accountId`/`username`, so the extra `isRoot` field is harmless.)

- [ ] **Step 3: Verify** `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm test` (unit green).

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts hooks/useAuth.tsx
git commit -m "feat: expose account.isRoot from me() through useAuth"
```

---

## Task B2: feedback + admin RPC wrappers

**Files:** Create `lib/feedback.ts`, `lib/admin.ts`

- [ ] **Step 1: Create `lib/feedback.ts`**

```ts
import { supabase } from "@/lib/supabase";

export type FeedbackCategory = "bug" | "suggestion" | "other";

export async function submitFeedback(token: string, category: FeedbackCategory, message: string): Promise<void> {
  const { error } = await supabase.rpc("submit_feedback", { p_session_token: token, p_category: category, p_message: message });
  if (error) throw error;
}
```

- [ ] **Step 2: Create `lib/admin.ts`**

```ts
import { supabase } from "@/lib/supabase";

export interface FeedbackRow { id: string; account_id: string | null; username: string; category: string; message: string; status: "new" | "handled"; created_at: string; }
export interface AdminRoom { id: string; code: string; name: string; is_playing: boolean; created_at: string; creator: string | null; member_count: number; }
export interface AdminAccount { id: string; username: string; is_root: boolean; is_banned: boolean; created_at: string; }
export interface AdminStats { total_rooms: number; total_accounts: number; feedback_new: number; feedback_total: number; }

const rows = <T>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);
const one = <T>(d: unknown): T => (Array.isArray(d) ? (d as T[])[0] : (d as T));

export async function listFeedback(token: string): Promise<FeedbackRow[]> {
  const { data, error } = await supabase.rpc("list_feedback", { p_session_token: token });
  if (error) throw error;
  return rows<FeedbackRow>(data);
}
export async function setFeedbackStatus(token: string, id: string, status: "new" | "handled"): Promise<void> {
  const { error } = await supabase.rpc("set_feedback_status", { p_session_token: token, p_id: id, p_status: status });
  if (error) throw error;
}
export async function deleteFeedback(token: string, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_feedback", { p_session_token: token, p_id: id });
  if (error) throw error;
}
export async function adminListRooms(token: string): Promise<AdminRoom[]> {
  const { data, error } = await supabase.rpc("admin_list_rooms", { p_session_token: token });
  if (error) throw error;
  return rows<AdminRoom>(data);
}
export async function adminDeleteRoom(token: string, roomId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_room", { p_session_token: token, p_room_id: roomId });
  if (error) throw error;
}
export async function adminListAccounts(token: string): Promise<AdminAccount[]> {
  const { data, error } = await supabase.rpc("admin_list_accounts", { p_session_token: token });
  if (error) throw error;
  return rows<AdminAccount>(data);
}
export async function adminSetBan(token: string, accountId: string, banned: boolean): Promise<void> {
  const { error } = await supabase.rpc("admin_set_ban", { p_session_token: token, p_account_id: accountId, p_banned: banned });
  if (error) throw error;
}
export async function adminDeleteAccount(token: string, accountId: string): Promise<void> {
  const { error } = await supabase.rpc("admin_delete_account", { p_session_token: token, p_account_id: accountId });
  if (error) throw error;
}
export async function adminStats(token: string): Promise<AdminStats> {
  const { data, error } = await supabase.rpc("admin_stats", { p_session_token: token });
  if (error) throw error;
  return one<AdminStats>(data);
}
```

- [ ] **Step 3: Verify** `npx tsc --noEmit` (clean). **Cross-check** every `.rpc(name, {…})` against `0005_v3_admin.sql` param names (`p_session_token`, `p_category`, `p_message`, `p_id`, `p_status`, `p_room_id`, `p_account_id`, `p_banned`, `p_token`).

- [ ] **Step 4: Commit**

```bash
git add lib/feedback.ts lib/admin.ts
git commit -m "feat: feedback + admin RPC wrappers"
```

---

# Phase C — UI

## Task C1: Feedback button + modal, wired into Lobby & Header

**Files:** Create `components/feedback/FeedbackModal.tsx`, `components/feedback/FeedbackButton.tsx`; Modify `components/lobby/Lobby.tsx`, `components/room/Header.tsx`

- [ ] **Step 1: Create `components/feedback/FeedbackModal.tsx`**

```tsx
"use client";

import { useState } from "react";
import { submitFeedback, type FeedbackCategory } from "@/lib/feedback";
import { useAuth } from "@/hooks/useAuth";

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: "bug", label: "Lỗi" }, { value: "suggestion", label: "Góp ý" }, { value: "other", label: "Khác" },
];

export default function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const [category, setCategory] = useState<FeedbackCategory>("suggestion");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (!token || !message.trim()) return;
    setBusy(true);
    try { await submitFeedback(token, category, message.trim()); setDone(true); }
    catch (err) {
      const m = (err as { message?: string }).message ?? "Không gửi được";
      setError(m.includes("too many feedback") ? "Bạn gửi quá nhiều góp ý, thử lại sau nhé." : m);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-gold bg-parchment p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-playfair text-xl text-burgundy">💬 Góp ý</h3>
        {done ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink">Đã gửi góp ý, cảm ơn bạn! 🎩</p>
            <button onClick={onClose} className="rounded-lg bg-burgundy px-4 py-2 text-cream">Đóng</button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <select value={category} onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
              className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink">
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <textarea required value={message} onChange={(e) => setMessage(e.target.value)} rows={4}
              placeholder="Nội dung góp ý…" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
            {error && <p className="text-sm text-burgundy-accent">{error}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gold py-2 text-burgundy">Hủy</button>
              <button type="submit" disabled={busy} className="flex-1 rounded-lg bg-burgundy py-2 font-cormorant font-bold text-cream disabled:opacity-60">
                {busy ? "Đang gửi…" : "Gửi"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/feedback/FeedbackButton.tsx`**

```tsx
"use client";

import { useState } from "react";
import FeedbackModal from "./FeedbackModal";

export default function FeedbackButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className={className ?? "rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy"}>
        💬 Góp ý
      </button>
      {open && <FeedbackModal onClose={() => setOpen(false)} />}
    </>
  );
}
```

- [ ] **Step 3: Wire into `components/lobby/Lobby.tsx`** — in the top-bar `<span>` cluster (next to username/logout), add `<FeedbackButton />` and (when `account?.isRoot`) a link to `/admin`:

```tsx
import Link from "next/link";
import FeedbackButton from "@/components/feedback/FeedbackButton";
// in the header cluster, before/after the logout button:
<FeedbackButton />
{account?.isRoot && <Link href="/admin" className="rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy">⚙️ Quản trị</Link>}
```

- [ ] **Step 4: Wire into `components/room/Header.tsx`** — add `<FeedbackButton />` to the right-hand controls cluster (next to the mode toggle / settings): `import FeedbackButton from "@/components/feedback/FeedbackButton";` then render `<FeedbackButton />`.

- [ ] **Step 5: Verify** `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build`.

- [ ] **Step 6: Commit**

```bash
git add components/feedback components/lobby/Lobby.tsx components/room/Header.tsx
git commit -m "feat: feedback button + modal in lobby and room; admin link for root"
```

---

## Task C2: `/admin` dashboard + tabs

**Files:** Create `components/admin/{FeedbackTab,RoomsTab,AccountsTab,StatsTab}.tsx`, `app/admin/page.tsx`

- [ ] **Step 1: Create `components/admin/StatsTab.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { adminStats, type AdminStats } from "@/lib/admin";

export default function StatsTab({ token }: { token: string }) {
  const [s, setS] = useState<AdminStats | null>(null);
  useEffect(() => { adminStats(token).then(setS).catch(() => {}); }, [token]);
  if (!s) return <p className="text-ink/60">Đang tải…</p>;
  const items = [
    ["Tổng phòng", s.total_rooms], ["Tổng tài khoản", s.total_accounts],
    ["Feedback chưa xử lý", s.feedback_new], ["Tổng feedback", s.feedback_total],
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-xl border border-gold-200 bg-cream p-4 text-center">
          <div className="font-playfair text-3xl text-burgundy">{n}</div>
          <div className="text-xs text-ink/70">{label}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create `components/admin/FeedbackTab.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { listFeedback, setFeedbackStatus, deleteFeedback, type FeedbackRow } from "@/lib/admin";

const LABEL: Record<string, string> = { bug: "Lỗi", suggestion: "Góp ý", other: "Khác" };

export default function FeedbackTab({ token }: { token: string }) {
  const [items, setItems] = useState<FeedbackRow[]>([]);
  const refresh = useCallback(() => { listFeedback(token).then(setItems).catch(() => {}); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="flex flex-col gap-2">
      {items.length === 0 && <p className="text-ink/60">Chưa có góp ý nào.</p>}
      {items.map((f) => (
        <div key={f.id} className={`rounded-xl border p-3 ${f.status === "new" ? "border-burgundy bg-cream" : "border-gold-200 bg-cream/50"}`}>
          <div className="flex items-center justify-between text-xs text-ink/70">
            <span>{LABEL[f.category] ?? f.category} · <b>{f.username}</b> · {new Date(f.created_at).toLocaleString("vi-VN")}</span>
            <span className="flex gap-1">
              <button onClick={async () => { await setFeedbackStatus(token, f.id, f.status === "new" ? "handled" : "new"); refresh(); }}
                className="rounded border border-gold-200 px-2 text-burgundy">{f.status === "new" ? "Đã xử lý" : "Mở lại"}</button>
              <button onClick={async () => { if (confirm("Xóa góp ý?")) { await deleteFeedback(token, f.id); refresh(); } }}
                className="rounded border border-gold-200 px-2 text-burgundy-accent">Xóa</button>
            </span>
          </div>
          <p className="mt-1 whitespace-pre-wrap text-ink">{f.message}</p>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `components/admin/RoomsTab.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { adminListRooms, adminDeleteRoom, type AdminRoom } from "@/lib/admin";

export default function RoomsTab({ token }: { token: string }) {
  const [rooms, setRooms] = useState<AdminRoom[]>([]);
  const refresh = useCallback(() => { adminListRooms(token).then(setRooms).catch(() => {}); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="flex flex-col gap-2">
      {rooms.length === 0 && <p className="text-ink/60">Chưa có phòng nào.</p>}
      {rooms.map((r) => (
        <div key={r.id} className="flex items-center justify-between rounded-xl border border-gold-200 bg-cream p-3 text-sm">
          <span className="text-ink">
            <b className="text-burgundy">{r.name}</b> · {r.code} · 👥 {r.member_count} · tạo bởi {r.creator ?? "?"} · {new Date(r.created_at).toLocaleDateString("vi-VN")}
          </span>
          <button onClick={async () => { if (confirm(`Xóa phòng ${r.name}?`)) { await adminDeleteRoom(token, r.id); refresh(); } }}
            className="rounded border border-gold-200 px-2 text-burgundy-accent">Xóa</button>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Create `components/admin/AccountsTab.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { adminListAccounts, adminSetBan, adminDeleteAccount, type AdminAccount } from "@/lib/admin";
import { useAuth } from "@/hooks/useAuth";

export default function AccountsTab({ token }: { token: string }) {
  const { account } = useAuth();
  const [accs, setAccs] = useState<AdminAccount[]>([]);
  const refresh = useCallback(() => { adminListAccounts(token).then(setAccs).catch(() => {}); }, [token]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <div className="flex flex-col gap-2">
      {accs.map((a) => {
        const self = a.id === account?.accountId;
        return (
          <div key={a.id} className="flex items-center justify-between rounded-xl border border-gold-200 bg-cream p-3 text-sm">
            <span className="text-ink">
              <b className="text-burgundy">{a.username}</b>{a.is_root ? " 👑" : ""}{a.is_banned ? " 🚫" : ""} · {new Date(a.created_at).toLocaleDateString("vi-VN")}
            </span>
            {!self && (
              <span className="flex gap-1">
                <button onClick={async () => { await adminSetBan(token, a.id, !a.is_banned); refresh(); }}
                  className="rounded border border-gold-200 px-2 text-burgundy">{a.is_banned ? "Mở khóa" : "Khóa"}</button>
                <button onClick={async () => { if (confirm(`Xóa tài khoản ${a.username}?`)) { await adminDeleteAccount(token, a.id); refresh(); } }}
                  className="rounded border border-gold-200 px-2 text-burgundy-accent">Xóa</button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 5: Create `app/admin/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import AuthScreen from "@/components/auth/AuthScreen";
import FeedbackTab from "@/components/admin/FeedbackTab";
import RoomsTab from "@/components/admin/RoomsTab";
import AccountsTab from "@/components/admin/AccountsTab";
import StatsTab from "@/components/admin/StatsTab";

type Tab = "feedback" | "rooms" | "accounts" | "stats";
const TABS: { id: Tab; label: string }[] = [
  { id: "feedback", label: "Hòm thư" }, { id: "rooms", label: "Phòng" },
  { id: "accounts", label: "Tài khoản" }, { id: "stats", label: "Thống kê" },
];

export default function AdminPage() {
  const { account, token, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("feedback");

  if (loading) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải…</main>;
  if (!account) return <AuthScreen />;
  if (!account.isRoot) return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="font-playfair text-2xl text-burgundy">Bạn không có quyền truy cập.</p>
      <Link href="/" className="text-burgundy-accent underline">Về trang chủ</Link>
    </main>
  );

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between border-b-2 border-gold pb-3">
        <span className="font-playfair text-2xl font-bold text-burgundy">⚙️ Quản trị hệ thống</span>
        <Link href="/" className="text-sm text-burgundy-accent underline">Về trang chủ</Link>
      </header>
      <div className="mb-4 flex gap-1 rounded-full border border-gold p-1 text-sm">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 rounded-full px-3 py-1 ${tab === t.id ? "bg-burgundy text-cream" : "text-burgundy"}`}>{t.label}</button>
        ))}
      </div>
      {token && tab === "feedback" && <FeedbackTab token={token} />}
      {token && tab === "rooms" && <RoomsTab token={token} />}
      {token && tab === "accounts" && <AccountsTab token={token} />}
      {token && tab === "stats" && <StatsTab token={token} />}
    </main>
  );
}
```

- [ ] **Step 6: Verify** `npx tsc --noEmit`, `npm run lint` (0 errors), `npm run build` (route `/admin` appears).

- [ ] **Step 7: Commit**

```bash
git add app/admin components/admin
git commit -m "feat: /admin dashboard (feedback, rooms, accounts, stats) gated on isRoot"
```

---

# Phase D — Branding (logo)

## Task D1: Logo + BrandSpinner; replace 🎩; loaders; turntable label

**Files:** Create `components/brand/Logo.tsx`, `components/brand/BrandSpinner.tsx`; Modify `app/globals.css`, `components/lobby/Lobby.tsx`, `components/room/Header.tsx`, `components/auth/AuthScreen.tsx`, `components/room/Turntable.tsx`, `app/room/[code]/RoomClient.tsx`, `app/page.tsx`, `app/admin/page.tsx`

- [ ] **Step 1: Append loader keyframes to `app/globals.css`**

```css
/* ===== Brand loader ===== */
@keyframes brand-pulse { 0%,100% { transform: scale(1); opacity: .85; } 50% { transform: scale(1.08); opacity: 1; } }
.animate-brand-pulse { animation: brand-pulse 1.4s ease-in-out infinite; }
```

- [ ] **Step 2: Create `components/brand/Logo.tsx`** (static import → Next optimizes the 2.5MB source)

```tsx
import Image from "next/image";
import logo from "@/public/logo.png";

export default function Logo({ size = 32, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Image src={logo} alt="Music Together" height={size} width={Math.round((size * 3) / 2)}
        style={{ height: size, width: "auto" }} priority />
      {withWordmark && <span className="font-playfair text-2xl font-bold text-burgundy">Music Together</span>}
    </span>
  );
}
```
(Logo aspect is 3:2 — `width:auto` + fixed height keeps it undistorted. This is a Server Component; it has no `'use client'` and can be imported by both server and client components.)

- [ ] **Step 3: Create `components/brand/BrandSpinner.tsx`**

```tsx
import Image from "next/image";
import logo from "@/public/logo.png";

export default function BrandSpinner({ label = "Đang tải…" }: { label?: string }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3">
      <Image src={logo} alt="" height={72} width={108} style={{ height: 72, width: "auto" }}
        className="animate-brand-pulse" priority />
      <p className="font-cormorant text-burgundy">{label}</p>
    </main>
  );
}
```

- [ ] **Step 4: Replace 🎩 with `<Logo />`** in headers/titles:
  - `components/lobby/Lobby.tsx`: replace `<span className="font-playfair …">🎩 Music Together</span>` with `<Logo />`.
  - `components/room/Header.tsx`: replace the `🎩` + room-name span — keep the room name, but swap the leading `🎩` for a small logo: render `<Logo size={28} withWordmark={false} />` before the room name.
  - `components/auth/AuthScreen.tsx`: replace the `<div className="text-5xl">🎩🎶</div>` + h1 with `<Logo size={56} />` (centered).
  - `app/admin/page.tsx`: replace the `⚙️ Quản trị hệ thống` span's leading emoji with `<Logo size={28} withWordmark={false} />` + the text "Quản trị hệ thống" (keep ⚙️ text optional).
  - Add `import Logo from "@/components/brand/Logo";` to each.

- [ ] **Step 5: Replace loading screens with `<BrandSpinner />`:**
  - `app/page.tsx`: the `if (loading) return <main …>Đang tải…</main>` → `return <BrandSpinner />`.
  - `app/room/[code]/RoomClient.tsx`: the `authLoading` and `view.loading` returns → `<BrandSpinner />` (use `<BrandSpinner label="Đang tải phòng…" />` for the room-loading one).
  - `app/admin/page.tsx`: the `loading` return → `<BrandSpinner />`.
  - Add `import BrandSpinner from "@/components/brand/BrandSpinner";` to each.

- [ ] **Step 6: Turntable logo label** — `components/room/Turntable.tsx`: the center label currently shows `thumbnail` or `🎼`. Change the fallback (no thumbnail) to the logo, spinning with the disc:

```tsx
import Image from "next/image";
import logo from "@/public/logo.png";
// inside the center-label div, replace the `🎼` fallback branch:
{thumbnail
  ? <img src={thumbnail} alt="" className="h-full w-full rounded-full object-cover opacity-90" /> /* eslint-disable-line @next/next/no-img-element */
  : <Image src={logo} alt="" width={80} height={80} className="h-full w-full rounded-full object-cover opacity-90" />}
```
(The center label sits inside the disc which already spins via `.animate-vinyl`, so the logo spins with it.)

- [ ] **Step 7: Verify** `npx tsc --noEmit`, `npm run lint` (0 errors; `<img>` for remote thumbnail keeps its eslint-disable), `npm run build` (build optimizes the local logo; confirm success).

- [ ] **Step 8: Commit**

```bash
git add components/brand app/globals.css components/lobby/Lobby.tsx components/room/Header.tsx components/auth/AuthScreen.tsx components/room/Turntable.tsx "app/room/[code]/RoomClient.tsx" app/page.tsx app/admin/page.tsx
git commit -m "feat: brand with logo — header, animated loader, turntable label"
```

---

## Task E1: Build gate + README + DB apply notes

**Files:** Modify `README.md`

- [ ] **Step 1: Append a "## v3: Admin & Feedback" section to `README.md`** noting: run `supabase/migrations/0005_v3_admin.sql` (additive — no data loss) in the SQL Editor; then create the root account by running the private snippet (below) with a STRONG password (never commit it); new features (feedback inbox, `/admin` for root, account ban, rate limits, logo branding). Include the root-creation snippet from the spec §3 with `<STRONG_PASSWORD>` placeholder and a "do NOT commit; do NOT reuse a leaked password" warning.

- [ ] **Step 2: Full gate** `npm test` (unit pass, integration skipped) + `npm run build` (succeeds; routes include `/admin`). Capture summaries.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v3 deploy + root-account creation notes"
```

---

## Self-review (completed during planning)
- **Spec coverage:** feedback table + submit/list/manage RPCs (A1) ✓; all-users submit + category/message (C1) ✓; root role via `is_root` + `_auth_root` (A1) ✓; root bootstrapped out-of-band (E1 note, not committed) ✓; root powers — feedback mgmt (FeedbackTab), rooms view/delete (RoomsTab+admin_list/delete_rooms), accounts view/ban/delete (AccountsTab+admin_set_ban/delete_account), stats (StatsTab+admin_stats) ✓; ban lockout via `_auth_account` (A1) ✓; rate-limits feedback+create_room (A1) ✓; self-protection (no self ban/delete) (A1) ✓; secrets not committed (E1) ✓; additive migration, no wipe (A1) ✓; logo header + animated loader + turntable label (D1) ✓; isRoot through me()/useAuth + Quản trị link (B1, C1) ✓.
- **Placeholder scan:** `<STRONG_PASSWORD>` is a deliberate user-supplied secret placeholder (root creation is out-of-band, never committed) — not a plan gap. All code is complete.
- **Type consistency:** RPC names/params in `lib/feedback.ts`/`lib/admin.ts` match `0005` signatures; `Account.isRoot` defined in B1 used in C1/C2/D1; admin row types (`FeedbackRow`/`AdminRoom`/`AdminAccount`/`AdminStats`) match the RPC `returns table(...)` columns.
- **Known/accepted:** root happy-paths + ban tested manually (integration tests cover anon-reachable paths only — register/feedback/non-root-rejection/rate-limits); `register` not DB-rate-limited (edge-level future, spec §11); `me` is drop+create (OUT param added) with re-grant.
