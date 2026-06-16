# Music Together v2 Implementation Plan — Accounts, Lobby & Animated Turntable

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace v1's per-device token identity with real **user accounts** (username + password, role-by-account so any device keeps Admin/DJ), add a **lobby** of currently-active rooms (Realtime Presence), and polish the UI (animated tonearm + copy/share icons).

**Architecture:** Custom accounts on Postgres extending v1's SECURITY-DEFINER-RPC + bcrypt pattern: `accounts`/`account_secrets`/`sessions` tables; a per-account **session token** (sha256 in DB, raw in `localStorage`) replaces the per-member device token. Every write RPC now authenticates via `(room_id, session_token)` → resolves account → member → role. The lobby is a single shared Realtime Presence channel every client joins (tracking its current `room_id`), aggregated client-side into distinct-account counts; room details come from public SELECT. UI is unchanged Next.js 16 client-rendered + Tailwind v4.

**Tech Stack:** Next.js 16.2.9, React 19.2, TypeScript 5, Tailwind v4, `@supabase/supabase-js` (Postgres + Realtime Presence + RPC), Vitest.

**Builds on:** v1 (branch `feat/implementation`) and its spec/plan. v2 spec: [docs/superpowers/specs/2026-06-16-music-together-v2-accounts-design.md](../specs/2026-06-16-music-together-v2-accounts-design.md).

---

## Conventions & prerequisites
- Same as v1: Next 16 facts hold (params is a Promise; `'use client'` first line; `next/navigation`; Tailwind v4 `@theme`; `@/*` → `./*`; browser APIs only in effects/handlers). Do not reintroduce older patterns.
- **DB reset required:** v2 ships `supabase/migrations/0004_v2_rebuild.sql` which **drops v1 tables/functions and rebuilds account-native**. The user will paste it into the Supabase **SQL Editor** once (room data is wiped — acceptable in dev). v1 migrations `0001–0003` stay as history; a local `supabase db reset` runs `0001→0004` ending at v2.
- **The v2 client rewrite breaks the v1 client** until all of Phase B lands — implement Phase A then B fully before expecting `npm run build` to pass end-to-end. Each task still keeps `tsc`/tests green for the files it touches where stated.
- Tokens: session token (raw) stored in `localStorage` key **`music-together:auth`**. The old per-room `music-together:<code>` identity is removed.
- Commits: one per task (or red/green pair). Branch: continue on `feat/implementation`.

---

## File map (v2)

```
supabase/migrations/
  0004_v2_rebuild.sql            # CREATE: teardown v1 + rebuild account-native schema + RPCs + realtime
lib/
  session.ts                     # CREATE: localStorage session token (save/load/clear)
  auth.ts                        # CREATE: register/login/me/logout RPC wrappers + Account/Session types
  supabase.ts                    # MODIFY: types (Member.account_id/username, QueueItem.added_by_account_id); room RPC wrappers → (roomId, token, …); drop device-token Identity
  realtime.ts                    # MODIFY: members SELECT embeds accounts(username); Member type gains username
  lobby.ts                       # CREATE: joinLobby + aggregateActiveRooms + subscribeActiveRooms + fetchRoomCards
  identity.ts                    # MODIFY: keep computeElapsedMs; remove StoredIdentity/per-room token helpers
  roles.ts / queue.ts / format.ts / youtube/*   # UNCHANGED
hooks/
  useAuth.tsx                    # CREATE: session context (account, login/register/logout, restore via me(), owns joinLobby handle)
  useActiveRooms.ts              # CREATE: lobby presence + room-card details
  useRoom.ts                     # MODIFY: identity from useAuth/session; membership by account; push room_id to lobby
  useDjController.ts             # MODIFY: RPC calls use (roomId, token)
  useYouTubePlayer.ts            # UNCHANGED
components/
  auth/AuthScreen.tsx            # CREATE: login/register (username + password)
  lobby/Lobby.tsx, RoomCard.tsx  # CREATE: active-rooms list + create/join-by-code
  room/ShareButtons.tsx          # CREATE: copy code + Web Share (fallback) + toast
  room/Turntable.tsx             # MODIFY: animated tonearm (off=vertical, playing=onto mid-ring)
  room/Header.tsx                # MODIFY: use <ShareButtons>; mode toggle + settings (session)
  room/JoinGate.tsx              # MODIFY: room password only (account already logged in)
  room/RoomShell.tsx             # MODIFY: pass session; member display via username
  room/MemberList.tsx, Queue.tsx, AddSong.tsx, SettingsDialog.tsx, NowPlaying.tsx  # MODIFY: username display + session RPC calls
app/
  page.tsx                       # MODIFY: auth gate → Lobby (logged in) | AuthScreen
  room/[code]/page.tsx           # UNCHANGED (server awaits params)
  room/[code]/RoomClient.tsx     # MODIFY: require auth; identity from session; JoinGate = password only
  api/oembed/route.ts            # UNCHANGED
tests/
  lib/lobby.test.ts              # CREATE: aggregateActiveRooms (TDD)
  lib/session.test.ts            # CREATE: session storage (TDD)
  integration/rpc.test.ts        # MODIFY: v2 — register/login/me/logout/session role-by-account
```

---

# Phase A — Backend rebuild (accounts + sessions + RPCs)

## Task A1: Migration `0004_v2_rebuild.sql` (teardown + rebuild)

**Files:** Create `supabase/migrations/0004_v2_rebuild.sql`

> No isolated test; exercised by Task A2. The file is large — assemble the parts below in order. Parts 1–6 + 7b + 8 are given in full. Part 7 lists the **mechanically-ported** RPCs: for each, copy the **body** of the same function from the committed `supabase/migrations/0002_rpc.sql` **verbatim**, changing only (a) the signature to the one shown and (b) the auth line from `perform public._auth_member(p_room_id, p_member_id, p_token, '<role>')` to `perform public._auth(p_room_id, p_session_token, '<role>')`. Nothing else in those bodies changes.

- [ ] **Step 1: Create the file with Part 1 — drop v1 objects**

```sql
-- =========================================================
-- 0004_v2_rebuild.sql — v2 teardown + rebuild (account-based auth)
-- Re-runnable: drops v1 objects first. pgcrypto already installed in
-- `extensions` by 0001; every function relies on `set search_path = public, extensions`.
-- =========================================================
drop function if exists public._auth_member(uuid,uuid,text,text)                       cascade;
drop function if exists public.create_room(text,text,text)                             cascade;
drop function if exists public.join_room(text,text,text)                               cascade;
drop function if exists public.add_queue_item(uuid,uuid,text,text,text,text,integer)   cascade;
drop function if exists public.advance_queue(uuid,uuid,text)                           cascade;
drop function if exists public.set_playback(uuid,uuid,text,boolean,timestamptz,integer) cascade;
drop function if exists public.seek_playback(uuid,uuid,text,integer)                   cascade;
drop function if exists public.reorder_item(uuid,uuid,text,uuid,double precision)      cascade;
drop function if exists public.bump_to_top(uuid,uuid,text,uuid)                        cascade;
drop function if exists public.delete_item(uuid,uuid,text,uuid)                        cascade;
drop function if exists public.set_play_mode(uuid,uuid,text,text)                      cascade;
drop function if exists public.assign_dj(uuid,uuid,text,uuid)                          cascade;
drop function if exists public.transfer_admin(uuid,uuid,text,uuid)                     cascade;
drop function if exists public.kick_member(uuid,uuid,text,uuid)                        cascade;
drop function if exists public.rename_room(uuid,uuid,text,text)                        cascade;

drop table if exists
  public.play_history, public.queue_items, public.member_secrets,
  public.members, public.room_secrets, public.rooms
cascade;
-- DROP TABLE auto-removes tables from publication supabase_realtime; re-added in Part 8.
```

- [ ] **Step 2: Append Part 2 — tables + indexes + RLS + SELECT policies**

```sql
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  created_at timestamptz not null default now()
);
create unique index accounts_username_lower_uniq on public.accounts (lower(username));

create table public.account_secrets (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  password_hash text not null
);

create table public.sessions (
  token_hash text primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index idx_sessions_account on public.sessions (account_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  play_mode text not null default 'order' check (play_mode in ('order','shuffle')),
  admin_member_id uuid, dj_member_id uuid, current_item_id uuid,
  is_playing boolean not null default false,
  started_at timestamptz, paused_elapsed_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create table public.room_secrets (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);
create table public.members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  joined_at timestamptz not null default now(),
  unique (room_id, account_id)
);
create table public.queue_items (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id text not null, title text not null, thumbnail_url text,
  duration_seconds integer,
  added_by_account_id uuid references public.accounts(id) on delete set null,
  added_by_name text not null,
  position double precision not null,
  created_at timestamptz not null default now()
);
create table public.play_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id text not null, title text not null,
  added_by_name text, played_at timestamptz not null default now()
);

alter table public.rooms
  add constraint rooms_admin_member_fk foreign key (admin_member_id) references public.members(id) on delete set null,
  add constraint rooms_dj_member_fk    foreign key (dj_member_id)    references public.members(id) on delete set null,
  add constraint rooms_current_item_fk foreign key (current_item_id) references public.queue_items(id) on delete set null;

create index idx_queue_items_room_position on public.queue_items (room_id, position);
create index idx_members_room              on public.members (room_id);
create index idx_members_account           on public.members (account_id);
create index idx_play_history_room_played  on public.play_history (room_id, played_at desc);

alter table public.accounts        enable row level security;
alter table public.account_secrets enable row level security;
alter table public.sessions        enable row level security;
alter table public.rooms           enable row level security;
alter table public.room_secrets    enable row level security;
alter table public.members         enable row level security;
alter table public.queue_items     enable row level security;
alter table public.play_history    enable row level security;

create policy accounts_select     on public.accounts     for select to anon using (true);
create policy rooms_select        on public.rooms        for select to anon using (true);
create policy members_select      on public.members      for select to anon using (true);
create policy queue_items_select  on public.queue_items  for select to anon using (true);
create policy play_history_select on public.play_history for select to anon using (true);
-- account_secrets, room_secrets, sessions: RLS on, NO policies -> never client-readable.
```

- [ ] **Step 3: Append Part 3 — auth helpers `_auth_account`, `_auth`**

```sql
create or replace function public._auth_account(p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text := encode(digest(p_session_token, 'sha256'), 'hex'); v_account uuid;
begin
  update public.sessions set last_seen = now() where token_hash = v_hash returning account_id into v_account;
  if v_account is null then raise exception 'invalid session' using errcode = '42501'; end if;
  return v_account;
end; $$;
revoke all on function public._auth_account(text) from public, anon, authenticated;

create or replace function public._auth(p_room_id uuid, p_session_token text, p_required_role text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_member_id uuid; v_admin uuid; v_dj uuid;
begin
  v_account := public._auth_account(p_session_token);
  select id into v_member_id from public.members where room_id = p_room_id and account_id = v_account;
  if not found then raise exception 'account is not a member of this room' using errcode = '42501'; end if;
  select admin_member_id, dj_member_id into v_admin, v_dj from public.rooms where id = p_room_id;
  if p_required_role = 'admin' and v_admin is distinct from v_member_id then
    raise exception 'admin role required' using errcode = '42501';
  elsif p_required_role = 'dj' and v_dj is distinct from v_member_id then
    raise exception 'dj role required' using errcode = '42501';
  elsif p_required_role = 'admin_or_dj' and v_admin is distinct from v_member_id and v_dj is distinct from v_member_id then
    raise exception 'admin or dj role required' using errcode = '42501';
  end if;
  return v_member_id;
end; $$;
revoke all on function public._auth(uuid,text,text) from public, anon, authenticated;
```

- [ ] **Step 4: Append Part 4 — account RPCs (register / login / me / logout)**

```sql
create or replace function public.register(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
begin
  if exists (select 1 from public.accounts a where lower(a.username) = lower(p_username)) then
    raise exception 'username already taken' using errcode = '23505';
  end if;
  account_id := gen_random_uuid(); username := p_username; token := encode(gen_random_bytes(32), 'hex');
  insert into public.accounts (id, username) values (account_id, p_username);
  insert into public.account_secrets (account_id, password_hash) values (account_id, crypt(p_password, gen_salt('bf')));
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

create or replace function public.login(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text;
begin
  select a.id, a.username, s.password_hash into account_id, username, v_hash
  from public.accounts a join public.account_secrets s on s.account_id = a.id
  where lower(a.username) = lower(p_username);
  if account_id is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid username or password' using errcode = '28P01';
  end if;
  token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

create or replace function public.me(p_token text, out account_id uuid, out username text)
language plpgsql security definer set search_path = public, extensions
as $$
begin
  account_id := public._auth_account(p_token);
  select a.username into username from public.accounts a where a.id = account_id;
end; $$;

create or replace function public.logout(p_token text)
returns void language plpgsql security definer set search_path = public, extensions
as $$
begin
  delete from public.sessions where token_hash = encode(digest(p_token, 'sha256'), 'hex');
end; $$;
```

- [ ] **Step 5: Append Part 5 — `create_room` + `join_room` (session-based; join_room uses a local `v_room` to avoid the OUT-param/column name ambiguity)**

```sql
create or replace function public.create_room(
  p_room_name text, p_password text, p_session_token text,
  out code text, out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_code text;
begin
  v_account := public._auth_account(p_session_token);
  loop
    v_code := 'salon-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 6);
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;
  room_id := gen_random_uuid(); code := v_code;
  insert into public.rooms (id, code, name, play_mode) values (room_id, v_code, p_room_name, 'order');
  insert into public.room_secrets (room_id, password_hash) values (room_id, crypt(p_password, gen_salt('bf')));
  insert into public.members (room_id, account_id) values (room_id, v_account) returning id into member_id;
  update public.rooms set admin_member_id = member_id, dj_member_id = member_id where id = room_id;
end; $$;

create or replace function public.join_room(
  p_code text, p_password text, p_session_token text,
  out room_id uuid, out member_id uuid
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_room uuid; v_hash text;
begin
  v_account := public._auth_account(p_session_token);
  select r.id, s.password_hash into v_room, v_hash
  from public.rooms r join public.room_secrets s on s.room_id = r.id
  where r.code = p_code;
  if v_room is null then raise exception 'room not found' using errcode = 'P0002'; end if;
  room_id := v_room;

  select m.id into member_id from public.members m where m.room_id = v_room and m.account_id = v_account;
  if found then return; end if;  -- already a member: skip password

  if crypt(p_password, v_hash) <> v_hash then raise exception 'invalid password' using errcode = '28P01'; end if;
  insert into public.members (room_id, account_id) values (v_room, v_account)
  on conflict (room_id, account_id) do nothing returning id into member_id;
  if member_id is null then
    select m.id into member_id from public.members m where m.room_id = v_room and m.account_id = v_account;
  end if;
end; $$;
```

- [ ] **Step 6: Append Part 6 — `add_queue_item` + `advance_queue` (full)**

```sql
create or replace function public.add_queue_item(
  p_room_id uuid, p_session_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_name text; v_pos double precision; v_id uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id;
  insert into public.queue_items
    (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position)
  values (p_room_id, p_video_id, p_title, p_thumb, p_duration, v_account, v_name, v_pos)
  returning id into v_id;
  return v_id;
end; $$;

create or replace function public.advance_queue(p_room_id uuid, p_session_token text)
returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_cur public.queue_items%rowtype; v_mode text; v_next uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'dj');
  select play_mode into v_mode from public.rooms where id = p_room_id;
  select qi.* into v_cur from public.queue_items qi
  join public.rooms r on r.current_item_id = qi.id where r.id = p_room_id;
  if found then
    insert into public.play_history (room_id, youtube_video_id, title, added_by_name)
    values (p_room_id, v_cur.youtube_video_id, v_cur.title, v_cur.added_by_name);
    update public.rooms set current_item_id = null where id = p_room_id;
    delete from public.queue_items where id = v_cur.id;
  end if;
  if v_mode = 'shuffle' then
    select id into v_next from public.queue_items where room_id = p_room_id order by random() limit 1;
  else
    select id into v_next from public.queue_items where room_id = p_room_id order by position asc limit 1;
  end if;
  update public.rooms set
    current_item_id = v_next,
    started_at = case when v_next is not null then now() else null end,
    is_playing = v_next is not null, paused_elapsed_ms = 0
  where id = p_room_id;
  return v_next;
end; $$;
```

- [ ] **Step 7: Append Part 7 — mechanically-ported RPCs**

For each function below, write a `create or replace function` with the **exact signature shown**, `language plpgsql security definer set search_path = public, extensions`, whose body is **copied verbatim from the same-named function in `supabase/migrations/0002_rpc.sql`**, changing ONLY the auth line to `perform public._auth(p_room_id, p_session_token, '<role>');`. (Open `0002_rpc.sql` to copy each body exactly — bump_to_top's min-position logic, delete_item's "refuse current item" guard, seek_playback's started_at math, set_play_mode's validation, assign_dj/transfer_admin's membership checks, rename_room's update are all unchanged.)

```
set_playback(p_room_id uuid, p_session_token text, p_is_playing boolean, p_started_at timestamptz, p_paused_elapsed_ms integer) returns void  -- role 'dj'
seek_playback(p_room_id uuid, p_session_token text, p_position_ms integer) returns void                                              -- role 'dj'
reorder_item(p_room_id uuid, p_session_token text, p_item_id uuid, p_new_position double precision) returns void                       -- role 'admin_or_dj'
bump_to_top(p_room_id uuid, p_session_token text, p_item_id uuid) returns void                                                        -- role 'admin_or_dj'
delete_item(p_room_id uuid, p_session_token text, p_item_id uuid) returns void                                                        -- role 'admin_or_dj'
set_play_mode(p_room_id uuid, p_session_token text, p_play_mode text) returns void                                                     -- role 'admin'
assign_dj(p_room_id uuid, p_session_token text, p_target_member uuid) returns void                                                     -- role 'admin'
transfer_admin(p_room_id uuid, p_session_token text, p_target_member uuid) returns void                                               -- role 'admin'
rename_room(p_room_id uuid, p_session_token text, p_new_name text) returns void                                                        -- role 'admin'
```

Then append **Part 7b — `kick_member` full** (its self-kick guard must read the caller's member id from `_auth`, since `p_member_id` no longer exists):

```sql
create or replace function public.kick_member(p_room_id uuid, p_session_token text, p_target_member uuid)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth(p_room_id, p_session_token, 'admin');
  if p_target_member = v_self then raise exception 'admin cannot kick themselves' using errcode = '42501'; end if;
  update public.rooms set
    dj_member_id    = case when dj_member_id    = p_target_member then null else dj_member_id    end,
    admin_member_id = case when admin_member_id = p_target_member then null else admin_member_id end
  where id = p_room_id;
  delete from public.members where id = p_target_member and room_id = p_room_id;
end; $$;
```

- [ ] **Step 8: Append Part 8 — grants + realtime publication**

```sql
grant execute on function public.register(text,text)                                  to anon, authenticated;
grant execute on function public.login(text,text)                                     to anon, authenticated;
grant execute on function public.me(text)                                             to anon, authenticated;
grant execute on function public.logout(text)                                         to anon, authenticated;
grant execute on function public.create_room(text,text,text)                          to anon, authenticated;
grant execute on function public.join_room(text,text,text)                            to anon, authenticated;
grant execute on function public.add_queue_item(uuid,text,text,text,text,integer)     to anon, authenticated;
grant execute on function public.advance_queue(uuid,text)                             to anon, authenticated;
grant execute on function public.set_playback(uuid,text,boolean,timestamptz,integer)  to anon, authenticated;
grant execute on function public.seek_playback(uuid,text,integer)                     to anon, authenticated;
grant execute on function public.reorder_item(uuid,text,uuid,double precision)        to anon, authenticated;
grant execute on function public.bump_to_top(uuid,text,uuid)                          to anon, authenticated;
grant execute on function public.delete_item(uuid,text,uuid)                          to anon, authenticated;
grant execute on function public.set_play_mode(uuid,text,text)                        to anon, authenticated;
grant execute on function public.assign_dj(uuid,text,uuid)                            to anon, authenticated;
grant execute on function public.transfer_admin(uuid,text,uuid)                       to anon, authenticated;
grant execute on function public.kick_member(uuid,text,uuid)                          to anon, authenticated;
grant execute on function public.rename_room(uuid,text,text)                          to anon, authenticated;

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.queue_items;
-- Do NOT add accounts/account_secrets/room_secrets/sessions.
```

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/0004_v2_rebuild.sql
git commit -m "feat(db): v2 teardown+rebuild — accounts, sessions, session-auth RPCs"
```

---

## Task A2: v2 RPC integration tests

**Files:** Modify `tests/integration/rpc.test.ts` (replace v1 bodies with v2; keep the env-skip guard)

> Runs only with `SUPABASE_TEST_URL` + `SUPABASE_TEST_ANON_KEY` set against a DB where `0004_v2_rebuild.sql` is applied; otherwise the suite skips.

- [ ] **Step 1: Replace the test file body** (keep the top `const run = url && key ? describe : describe.skip;`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v2 RPC accounts + session auth", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string, password = "pw123456") => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: password });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const create = async (token: string, name = "Salon", pass = "secret") => {
    const { data, error } = await db.rpc("create_room", { p_room_name: name, p_password: pass, p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
  };

  it("register then login; duplicate username rejected; bad password rejected", async () => {
    const u = uniq("alice");
    const a = await reg(u);
    expect(a.token).toHaveLength(64);
    await expect(reg(u)).rejects.toMatchObject({ message: expect.stringContaining("already taken") });
    const { data: li } = await db.rpc("login", { p_username: u.toUpperCase(), p_password: "pw123456" }); // case-insensitive
    expect((Array.isArray(li) ? li[0] : li).account_id).toBe(a.account_id);
    const bad = await db.rpc("login", { p_username: u, p_password: "wrong" });
    expect(bad.error?.message).toContain("invalid username or password");
  });

  it("me() resolves the session; logout() invalidates it", async () => {
    const a = await reg(uniq("bob"));
    const { data: me } = await db.rpc("me", { p_token: a.token });
    expect((Array.isArray(me) ? me[0] : me).account_id).toBe(a.account_id);
    await db.rpc("logout", { p_token: a.token });
    const after = await db.rpc("me", { p_token: a.token });
    expect(after.error?.message).toContain("invalid session");
  });

  it("create_room makes creator admin+dj; join_room first needs password, re-join skips it", async () => {
    const admin = await reg(uniq("owner"));
    const r = await create(admin.token);
    const { data: room } = await db.from("rooms").select("admin_member_id,dj_member_id").eq("id", r.room_id).single();
    expect(room!.admin_member_id).toBe(r.member_id);
    expect(room!.dj_member_id).toBe(r.member_id);

    const guest = await reg(uniq("guest"));
    const wrong = await db.rpc("join_room", { p_code: r.code, p_password: "nope", p_session_token: guest.token });
    expect(wrong.error?.message).toContain("invalid password");
    const ok = await db.rpc("join_room", { p_code: r.code, p_password: "secret", p_session_token: guest.token });
    expect(ok.error).toBeNull();
    // re-join with WRONG password now succeeds because already a member
    const rejoin = await db.rpc("join_room", { p_code: r.code, p_password: "nope", p_session_token: guest.token });
    expect(rejoin.error).toBeNull();
  });

  it("role is enforced by account/session: guest cannot advance, admin can", async () => {
    const admin = await reg(uniq("dj"));
    const r = await create(admin.token);
    const guest = await reg(uniq("listener"));
    await db.rpc("join_room", { p_code: r.code, p_password: "secret", p_session_token: guest.token });
    await db.rpc("add_queue_item", { p_room_id: r.room_id, p_session_token: guest.token, p_video_id: "abc", p_title: "A", p_thumb: null, p_duration: 10 });
    const denied = await db.rpc("advance_queue", { p_room_id: r.room_id, p_session_token: guest.token });
    expect(denied.error?.message).toContain("dj role required");
    const adv = await db.rpc("advance_queue", { p_room_id: r.room_id, p_session_token: admin.token });
    expect(adv.error).toBeNull();
  });

  it("role follows the account across a NEW session (simulated second device)", async () => {
    const owner = await reg(uniq("multi"));
    const r = await create(owner.token);
    const { data: l } = await db.rpc("login", { p_username: owner.username, p_password: "pw123456" });
    const token2 = (Array.isArray(l) ? l[0] : l).token as string; // different device/session, same account
    const ok = await db.rpc("rename_room", { p_room_id: r.room_id, p_session_token: token2, p_new_name: "Renamed" });
    expect(ok.error).toBeNull(); // still admin via the account, not the session
  });

  it("secret tables are not client-readable", async () => {
    for (const t of ["account_secrets", "sessions", "room_secrets"]) {
      const { data, error } = await db.from(t).select("*");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(0);
    }
  });
});
```

- [ ] **Step 2: Run (skips without DB env)**

Run: `npm test -- tests/integration/rpc.test.ts`
Expected: SKIPPED without `SUPABASE_TEST_*`; with a v2-migrated DB → all PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/rpc.test.ts
git commit -m "test(db): v2 account + session-auth integration tests"
```

---

# Phase B — Client auth rework

## Task B1: Session storage (`lib/session.ts`, TDD)

**Files:** Create `lib/session.ts`; Test `lib/session.test.ts`

- [ ] **Step 1: Write the failing test `lib/session.test.ts`**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { saveSession, loadSession, clearSession } from "@/lib/session";

describe("session storage", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips the session", () => {
    saveSession({ accountId: "a1", username: "Alice", token: "t1" });
    expect(loadSession()).toEqual({ accountId: "a1", username: "Alice", token: "t1" });
  });
  it("returns null when absent or malformed", () => {
    expect(loadSession()).toBeNull();
    localStorage.setItem("music-together:auth", "{not json");
    expect(loadSession()).toBeNull();
  });
  it("clears", () => {
    saveSession({ accountId: "a1", username: "Alice", token: "t1" });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npm test -- lib/session.test.ts`

- [ ] **Step 3: Implement `lib/session.ts`**

```ts
export interface StoredSession {
  accountId: string;
  username: string;
  token: string;
}

const KEY = "music-together:auth";

export function saveSession(s: StoredSession): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
export function loadSession(): StoredSession | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}
export function clearSession(): void {
  localStorage.removeItem(KEY);
}
```

- [ ] **Step 4: Run → PASS.** `npm test -- lib/session.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/session.ts lib/session.test.ts
git commit -m "feat: session token localStorage helpers"
```

---

## Task B2: Auth RPC wrappers + reworked supabase/realtime types

**Files:** Create `lib/auth.ts`; Modify `lib/supabase.ts`, `lib/realtime.ts`, `lib/identity.ts`

- [ ] **Step 1: Create `lib/auth.ts`**

```ts
import { supabase } from "@/lib/supabase";

export interface Account { accountId: string; username: string; }
export interface AuthResult extends Account { token: string; }

function row<T>(data: unknown): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}

export async function registerAccount(username: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.rpc("register", { p_username: username, p_password: password });
  if (error) throw error;
  const r = row<{ account_id: string; username: string; token: string }>(data);
  return { accountId: r.account_id, username: r.username, token: r.token };
}
export async function loginAccount(username: string, password: string): Promise<AuthResult> {
  const { data, error } = await supabase.rpc("login", { p_username: username, p_password: password });
  if (error) throw error;
  const r = row<{ account_id: string; username: string; token: string }>(data);
  return { accountId: r.account_id, username: r.username, token: r.token };
}
export async function fetchMe(token: string): Promise<Account | null> {
  const { data, error } = await supabase.rpc("me", { p_token: token });
  if (error) return null;
  const r = row<{ account_id: string; username: string }>(data);
  return r?.account_id ? { accountId: r.account_id, username: r.username } : null;
}
export async function logoutAccount(token: string): Promise<void> {
  await supabase.rpc("logout", { p_token: token });
}
```

- [ ] **Step 2: Rewrite the room RPC wrappers + types in `lib/supabase.ts`**

Keep the `supabase` client + `PlayMode`/`Room`/`QueueItem` types, but: change `Member` to `{ id; room_id; account_id; joined_at; username?: string }`; change `QueueItem.added_by_member_id` → `added_by_account_id`; remove the `Identity` import/usage; and replace every room RPC wrapper to take `(roomId: string, token: string, …)`. Full replacement of the wrapper section:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

export const supabase: SupabaseClient = createClient(url, publishableKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 5 } },
});

export type PlayMode = "order" | "shuffle";
export interface Room {
  id: string; code: string; name: string; play_mode: PlayMode;
  admin_member_id: string | null; dj_member_id: string | null;
  current_item_id: string | null; is_playing: boolean;
  started_at: string | null; paused_elapsed_ms: number; created_at: string;
}
export interface Member { id: string; room_id: string; account_id: string; joined_at: string; username?: string; }
export interface QueueItem {
  id: string; room_id: string; youtube_video_id: string; title: string;
  thumbnail_url: string | null; duration_seconds: number | null;
  added_by_account_id: string | null; added_by_name: string;
  position: number; created_at: string;
}

export async function createRoom(roomName: string, password: string, token: string) {
  const { data, error } = await supabase.rpc("create_room", { p_room_name: roomName, p_password: password, p_session_token: token });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
}
export async function joinRoom(code: string, password: string, token: string) {
  const { data, error } = await supabase.rpc("join_room", { p_code: code, p_password: password, p_session_token: token });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { room_id: string; member_id: string };
}
export async function addQueueItem(roomId: string, token: string, v: { videoId: string; title: string; thumb: string | null; duration: number | null }) {
  const { error } = await supabase.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: v.videoId, p_title: v.title, p_thumb: v.thumb, p_duration: v.duration });
  if (error) throw error;
}
export async function advanceQueue(roomId: string, token: string) {
  const { error } = await supabase.rpc("advance_queue", { p_room_id: roomId, p_session_token: token });
  if (error) throw error;
}
export async function setPlayback(roomId: string, token: string, p: { isPlaying: boolean; startedAt: string | null; pausedElapsedMs: number }) {
  const { error } = await supabase.rpc("set_playback", { p_room_id: roomId, p_session_token: token, p_is_playing: p.isPlaying, p_started_at: p.startedAt, p_paused_elapsed_ms: p.pausedElapsedMs });
  if (error) throw error;
}
export async function seekPlayback(roomId: string, token: string, positionMs: number) {
  const { error } = await supabase.rpc("seek_playback", { p_room_id: roomId, p_session_token: token, p_position_ms: positionMs });
  if (error) throw error;
}
export async function bumpToTop(roomId: string, token: string, itemId: string) {
  const { error } = await supabase.rpc("bump_to_top", { p_room_id: roomId, p_session_token: token, p_item_id: itemId });
  if (error) throw error;
}
export async function reorderItem(roomId: string, token: string, itemId: string, newPosition: number) {
  const { error } = await supabase.rpc("reorder_item", { p_room_id: roomId, p_session_token: token, p_item_id: itemId, p_new_position: newPosition });
  if (error) throw error;
}
export async function deleteItem(roomId: string, token: string, itemId: string) {
  const { error } = await supabase.rpc("delete_item", { p_room_id: roomId, p_session_token: token, p_item_id: itemId });
  if (error) throw error;
}
export async function setPlayMode(roomId: string, token: string, mode: PlayMode) {
  const { error } = await supabase.rpc("set_play_mode", { p_room_id: roomId, p_session_token: token, p_play_mode: mode });
  if (error) throw error;
}
export async function assignDj(roomId: string, token: string, targetMemberId: string | null) {
  const { error } = await supabase.rpc("assign_dj", { p_room_id: roomId, p_session_token: token, p_target_member: targetMemberId });
  if (error) throw error;
}
export async function transferAdmin(roomId: string, token: string, targetMemberId: string) {
  const { error } = await supabase.rpc("transfer_admin", { p_room_id: roomId, p_session_token: token, p_target_member: targetMemberId });
  if (error) throw error;
}
export async function kickMember(roomId: string, token: string, targetMemberId: string) {
  const { error } = await supabase.rpc("kick_member", { p_room_id: roomId, p_session_token: token, p_target_member: targetMemberId });
  if (error) throw error;
}
export async function renameRoom(roomId: string, token: string, newName: string) {
  const { error } = await supabase.rpc("rename_room", { p_room_id: roomId, p_session_token: token, p_new_name: newName });
  if (error) throw error;
}
```

- [ ] **Step 3: Update `lib/realtime.ts`** — members SELECT embeds the username; map it onto `Member.username`. Replace the `members` fetch line in `fetchRoomState`:

```ts
    supabase.from("members").select("id, room_id, account_id, joined_at, accounts(username)").eq("room_id", roomId).order("joined_at"),
```
and map results so each member carries `username`:
```ts
  type MemberWithAccount = { id: string; room_id: string; account_id: string; joined_at: string; accounts: { username: string } | null };
  const members = ((membersRes.data ?? []) as unknown as MemberWithAccount[])
    .map((m) => ({ id: m.id, room_id: m.room_id, account_id: m.account_id, joined_at: m.joined_at, username: m.accounts?.username }));
```
(Keep the `rooms` and `queue_items` selects as-is. `RoomState` and `trackPresence` are unchanged.)
> Note: Supabase types a to-one embed (`accounts(username)`) as an array in its generated types, so cast via `as unknown as` (the runtime value is a single object/`null`). Same quirk handled in `lib/lobby.ts`'s `fetchRoomCards`.

- [ ] **Step 4: Trim `lib/identity.ts`** — remove `Identity`, `StoredIdentity`, `saveIdentity`, `loadIdentity`, `clearIdentity` (now in `lib/session.ts`); KEEP `computeElapsedMs` exactly. Delete `lib/identity.test.ts`'s storage tests, keeping only the `computeElapsedMs` describe block.

- [ ] **Step 5: Typecheck the libs** `npx tsc --noEmit` — expect errors ONLY in not-yet-updated consumers (useRoom, components) which later tasks fix. Confirm `lib/auth.ts`, `lib/supabase.ts`, `lib/realtime.ts`, `lib/identity.ts` themselves are internally consistent (no errors originating in these four files).

- [ ] **Step 6: Run the surviving unit tests** `npm test -- lib/identity.test.ts` (computeElapsedMs still green).

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts lib/supabase.ts lib/realtime.ts lib/identity.ts lib/identity.test.ts
git commit -m "feat: session-based RPC wrappers + auth wrappers; member username; trim identity"
```

---

## Task B3: Auth context + screen (`useAuth`, `AuthScreen`)

**Files:** Create `hooks/useAuth.tsx`, `components/auth/AuthScreen.tsx`

> `useAuth` restores the session via `me()` on mount, exposes login/register/logout, and owns the single `joinLobby` handle (created on login/restore, torn down on logout). The lobby handle is exposed so `useRoom` can flip `room_id`.

- [ ] **Step 1: Create `hooks/useAuth.tsx`**

```tsx
"use client";

import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { registerAccount, loginAccount, fetchMe, logoutAccount, type Account } from "@/lib/auth";
import { saveSession, loadSession, clearSession } from "@/lib/session";
import { joinLobby, type LobbyHandle } from "@/lib/lobby";

interface AuthState {
  account: Account | null;
  token: string | null;
  loading: boolean;
  lobby: LobbyHandle | null;
  login: (u: string, p: string) => Promise<void>;
  register: (u: string, p: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // `lobby` is exposed reactively via state; lobbyRef holds the same handle for imperative cleanup.
  const lobbyRef = useRef<LobbyHandle | null>(null);
  const [lobby, setLobby] = useState<LobbyHandle | null>(null);

  const startLobby = useCallback((a: Account) => {
    lobbyRef.current?.unsubscribe();
    lobbyRef.current = joinLobby({ accountId: a.accountId, username: a.username });
    setLobby(lobbyRef.current);
  }, []);

  useEffect(() => {
    const s = loadSession();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!s) { setLoading(false); return; }
    let active = true;
    fetchMe(s.token).then((me) => {
      if (!active) return;
      if (me) { setAccount(me); setToken(s.token); startLobby(me); }
      else clearSession();
      setLoading(false);
    });
    return () => { active = false; lobbyRef.current?.unsubscribe(); lobbyRef.current = null; };
  }, [startLobby]);

  const login = useCallback(async (u: string, p: string) => {
    const r = await loginAccount(u, p);
    const a = { accountId: r.accountId, username: r.username };
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    setAccount(a); setToken(r.token); startLobby(a);
  }, [startLobby]);

  const register = useCallback(async (u: string, p: string) => {
    const r = await registerAccount(u, p);
    const a = { accountId: r.accountId, username: r.username };
    saveSession({ accountId: r.accountId, username: r.username, token: r.token });
    setAccount(a); setToken(r.token); startLobby(a);
  }, [startLobby]);

  const logout = useCallback(async () => {
    if (token) await logoutAccount(token);
    lobbyRef.current?.unsubscribe(); lobbyRef.current = null; setLobby(null);
    clearSession(); setAccount(null); setToken(null);
  }, [token]);

  return (
    <Ctx.Provider value={{ account, token, loading, lobby, login, register, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used within AuthProvider");
  return v;
}
```

- [ ] **Step 2: Wrap the app in `AuthProvider`** — in `app/layout.tsx`, render `<AuthProvider>{children}</AuthProvider>` inside `<body>`. Since `layout.tsx` is a Server Component, create a tiny client wrapper:

Create `app/Providers.tsx`:
```tsx
"use client";
import { AuthProvider } from "@/hooks/useAuth";
export default function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
```
Then in `app/layout.tsx` import it and wrap: `<body className="min-h-full"><Providers>{children}</Providers></body>`.

- [ ] **Step 3: Create `components/auth/AuthScreen.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("already taken") ? "Tên đăng nhập đã tồn tại."
        : msg.includes("invalid username or password") ? "Sai tên đăng nhập hoặc mật khẩu." : msg);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-6">
      <header className="text-center">
        <div className="text-5xl">🎩🎶</div>
        <h1 className="font-playfair text-3xl font-bold text-burgundy">Music Together</h1>
      </header>
      <div className="flex rounded-full border border-gold text-sm">
        <button type="button" onClick={() => setMode("login")} className={`flex-1 rounded-full px-4 py-2 ${mode === "login" ? "bg-burgundy text-cream" : "text-burgundy"}`}>Đăng nhập</button>
        <button type="button" onClick={() => setMode("register")} className={`flex-1 rounded-full px-4 py-2 ${mode === "register" ? "bg-burgundy text-cream" : "text-burgundy"}`}>Đăng ký</button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập (username)" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p className="text-sm text-burgundy-accent">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">
          {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Đăng ký"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Typecheck** `npx tsc --noEmit` (will still error in lobby-dependent + room files until Tasks C/B4; confirm `useAuth.ts`/`AuthScreen.tsx`/`Providers.tsx` have no errors that originate in them, other than the `@/lib/lobby` import which Task C1 creates — so do Task C1 before this typechecks fully, OR create a minimal `lib/lobby.ts` stub first; the recommended order is **C1 before B3** — see Execution order note).

- [ ] **Step 5: Commit**

```bash
git add hooks/useAuth.tsx components/auth/AuthScreen.tsx app/Providers.tsx app/layout.tsx
git commit -m "feat: auth context (session restore + lobby handle) and auth screen"
```

---

# Phase C — Lobby

## Task C1: Lobby presence + details (`lib/lobby.ts`, `useActiveRooms`) + TDD for the aggregator

**Files:** Create `lib/lobby.ts`, `hooks/useActiveRooms.ts`; Test `lib/lobby.test.ts`

> **Execution order:** do **C1 before B3** so `@/lib/lobby` exists for `useAuth`'s import.

- [ ] **Step 1: Write the failing test `lib/lobby.test.ts`** (pure aggregator)

```ts
import { describe, it, expect } from "vitest";
import { aggregateActiveRooms, type LobbyPresence } from "@/lib/lobby";

type Entry = LobbyPresence & { presence_ref: string };
const e = (account_id: string, room_id: string | null, username = account_id): Entry =>
  ({ account_id, username, room_id, online_at: "t", presence_ref: Math.random().toString() });

describe("aggregateActiveRooms", () => {
  it("dedupes by account across tabs and excludes lobby browsers (room_id null)", () => {
    const state = {
      k1: [e("a1", "r1", "Alice")],
      k2: [e("a1", "r1", "Alice")], // same account, 2nd tab, same room -> counts once
      k3: [e("a2", "r1", "Bob")],
      k4: [e("a3", null)],          // browsing lobby -> excluded
      k5: [e("a4", "r2", "Dan")],
    };
    const m = aggregateActiveRooms(state);
    expect(m.get("r1")!.count).toBe(2);
    expect(new Set(m.get("r1")!.usernames)).toEqual(new Set(["Alice", "Bob"]));
    expect(m.get("r2")!.count).toBe(1);
    expect(m.has("__none__")).toBe(false);
  });
  it("empty state -> empty map", () => {
    expect(aggregateActiveRooms({}).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npm test -- lib/lobby.test.ts`

- [ ] **Step 3: Create `lib/lobby.ts`** (verbatim — research-verified; exact trackPresence pattern)

```ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, type Room } from "@/lib/supabase";

export interface LobbyPresence { account_id: string; username: string; room_id: string | null; online_at: string; }
export interface RoomPresence { count: number; usernames: string[]; }
export interface LobbyMe { accountId: string; username: string; }
export interface LobbyHandle { unsubscribe: () => void; setRoomId: (roomId: string | null) => void; }

const LOBBY_CHANNEL = "lobby";

export function joinLobby(me: LobbyMe, getInitialRoomId: () => string | null = () => null): LobbyHandle {
  const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  let currentRoomId: string | null = getInitialRoomId();
  const channel: RealtimeChannel = supabase.channel(LOBBY_CHANNEL, { config: { presence: { key } } });
  const buildPayload = (): LobbyPresence => ({ account_id: me.accountId, username: me.username, room_id: currentRoomId, online_at: new Date().toISOString() });
  channel.subscribe(async (status) => {
    if (status === "SUBSCRIBED") { currentRoomId = getInitialRoomId(); await channel.track(buildPayload()); }
  });
  return {
    unsubscribe: () => { void supabase.removeChannel(channel); },
    setRoomId: (roomId: string | null) => { currentRoomId = roomId; void channel.track(buildPayload()); },
  };
}

export function aggregateActiveRooms(state: Record<string, Array<LobbyPresence & { presence_ref: string }>>): Map<string, RoomPresence> {
  const byRoom = new Map<string, Map<string, string>>();
  for (const entries of Object.values(state)) {
    for (const en of entries) {
      if (!en.room_id) continue;
      let accounts = byRoom.get(en.room_id);
      if (!accounts) { accounts = new Map(); byRoom.set(en.room_id, accounts); }
      accounts.set(en.account_id, en.username);
    }
  }
  const out = new Map<string, RoomPresence>();
  for (const [roomId, accounts] of byRoom) out.set(roomId, { count: accounts.size, usernames: [...accounts.values()] });
  return out;
}

export function subscribeActiveRooms(onChange: (rooms: Map<string, RoomPresence>) => void): () => void {
  const channel: RealtimeChannel = supabase.channel(LOBBY_CHANNEL);
  const emit = () => {
    const state = channel.presenceState<LobbyPresence>() as Record<string, Array<LobbyPresence & { presence_ref: string }>>;
    onChange(aggregateActiveRooms(state));
  };
  channel.on("presence", { event: "sync" }, emit).on("presence", { event: "join" }, emit).on("presence", { event: "leave" }, emit)
    .subscribe((status) => { if (status === "SUBSCRIBED") emit(); });
  return () => { void supabase.removeChannel(channel); };
}

export interface RoomCard { id: string; code: string; name: string; is_playing: boolean; current_title: string | null; dj_username: string | null; }

export async function fetchRoomCards(roomIds: string[]): Promise<Map<string, RoomCard>> {
  const out = new Map<string, RoomCard>();
  if (roomIds.length === 0) return out;
  const { data: rooms } = await supabase.from("rooms").select("id, code, name, is_playing, current_item_id, dj_member_id").in("id", roomIds);
  const roomRows = (rooms ?? []) as Pick<Room, "id" | "code" | "name" | "is_playing" | "current_item_id" | "dj_member_id">[];
  const itemIds = roomRows.map((r) => r.current_item_id).filter((v): v is string => !!v);
  const titleById = new Map<string, string>();
  if (itemIds.length) {
    const { data: items } = await supabase.from("queue_items").select("id, title").in("id", itemIds);
    for (const it of (items ?? []) as { id: string; title: string }[]) titleById.set(it.id, it.title);
  }
  const djMemberIds = roomRows.map((r) => r.dj_member_id).filter((v): v is string => !!v);
  const djByMemberId = new Map<string, string>();
  if (djMemberIds.length) {
    const { data: members } = await supabase.from("members").select("id, accounts ( username )").in("id", djMemberIds);
    type MemberRow = { id: string; accounts: { username: string } | null };
    for (const m of (members ?? []) as unknown as MemberRow[]) if (m.accounts?.username) djByMemberId.set(m.id, m.accounts.username);
  }
  for (const r of roomRows) {
    out.set(r.id, {
      id: r.id, code: r.code, name: r.name, is_playing: r.is_playing,
      current_title: r.current_item_id ? titleById.get(r.current_item_id) ?? null : null,
      dj_username: r.dj_member_id ? djByMemberId.get(r.dj_member_id) ?? null : null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run → PASS.** `npm test -- lib/lobby.test.ts`

- [ ] **Step 5: Create `hooks/useActiveRooms.ts`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeActiveRooms, fetchRoomCards, type RoomPresence, type RoomCard } from "@/lib/lobby";

export interface ActiveRoom extends RoomCard { online: number; usernames: string[]; }

export function useActiveRooms(): { rooms: ActiveRoom[]; loading: boolean } {
  const [presence, setPresence] = useState<Map<string, RoomPresence>>(new Map());
  const [cards, setCards] = useState<Map<string, RoomCard>>(new Map());
  const [loading, setLoading] = useState(true);
  const lastKeyRef = useRef("");

  useEffect(() => subscribeActiveRooms((rooms) => { setPresence(rooms); setLoading(false); }), []);

  useEffect(() => {
    const ids = [...presence.keys()].sort();
    const key = ids.join(",");
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    let active = true;
    (async () => { const next = await fetchRoomCards(ids); if (active) setCards(next); })();
    return () => { active = false; };
  }, [presence]);

  const rooms: ActiveRoom[] = [];
  for (const [roomId, p] of presence) {
    const card = cards.get(roomId);
    if (!card) continue;
    rooms.push({ ...card, online: p.count, usernames: p.usernames });
  }
  rooms.sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
  return { rooms, loading };
}
```

- [ ] **Step 6: Typecheck** `npx tsc --noEmit` (lobby files clean; room files may still error pending B4).

- [ ] **Step 7: Commit**

```bash
git add lib/lobby.ts lib/lobby.test.ts hooks/useActiveRooms.ts
git commit -m "feat: lobby presence aggregation + active-rooms hook"
```

---

## Task C2: Lobby UI + home gate

**Files:** Create `components/lobby/Lobby.tsx`, `components/lobby/RoomCard.tsx`; Modify `app/page.tsx`

- [ ] **Step 1: Create `components/lobby/RoomCard.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import type { ActiveRoom } from "@/hooks/useActiveRooms";

export default function RoomCard({ room }: { room: ActiveRoom }) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-gold-200 bg-cream p-3 shadow">
      <div className="font-cormorant text-lg font-bold text-burgundy">{room.name} 🔒</div>
      <div className="text-sm text-ink">{room.is_playing && room.current_title ? `🎵 ${room.current_title}` : "⏸ Tạm dừng"}</div>
      <div className="mt-1 flex items-center justify-between">
        <span className="text-xs text-gold">👥 {room.online} online{room.dj_username ? ` · 🎧 ${room.dj_username}` : ""}</span>
        <button onClick={() => router.push(`/room/${room.code}`)} className="rounded-lg bg-burgundy px-3 py-1 font-cormorant font-bold text-cream">Vào ▸</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/lobby/Lobby.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRooms } from "@/hooks/useActiveRooms";
import { createRoom } from "@/lib/supabase";
import RoomCard from "./RoomCard";

export default function Lobby() {
  const { account, token, logout } = useAuth();
  const { rooms, loading } = useActiveRooms();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function doCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const r = await createRoom(roomName.trim() || "Phòng nghe nhạc", password, token!);
      router.push(`/room/${r.code}`);
    } catch (err) { setError((err as { message?: string }).message ?? "Không tạo được phòng"); }
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between border-b-2 border-gold pb-3">
        <span className="font-playfair text-2xl font-bold text-burgundy">🎩 Music Together</span>
        <span className="flex items-center gap-2 rounded-full border border-gold bg-cream px-3 py-1 text-sm">
          👤 <b>{account?.username}</b> · <button onClick={() => logout()} className="text-burgundy-accent">Đăng xuất</button>
        </span>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button onClick={() => setCreating((v) => !v)} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream">＋ Tạo phòng</button>
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) router.push(`/room/${code.trim()}`); }} className="ml-auto flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Nhập mã phòng…" className="rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
          <button className="rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-burgundy">Vào bằng mã</button>
        </form>
      </div>

      {creating && (
        <form onSubmit={doCreate} className="mb-5 flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream/60 p-3">
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Tên phòng (tùy chọn)" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu phòng" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
          {error && <p className="text-sm text-burgundy-accent">{error}</p>}
          <button className="rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream">Tạo & vào phòng</button>
        </form>
      )}

      <h2 className="mb-2 font-cormorant text-xl text-burgundy">Phòng đang mở · {rooms.length}</h2>
      {loading ? <p className="text-ink/60">Đang tải…</p>
        : rooms.length === 0 ? <p className="text-ink/60">Chưa có phòng nào đang mở. Hãy tạo một phòng!</p>
        : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{rooms.map((r) => <RoomCard key={r.id} room={r} />)}</div>}
    </main>
  );
}
```

- [ ] **Step 3: Rewrite `app/page.tsx` as the auth gate**

```tsx
"use client";

import { useAuth } from "@/hooks/useAuth";
import AuthScreen from "@/components/auth/AuthScreen";
import Lobby from "@/components/lobby/Lobby";

export default function Home() {
  const { account, loading } = useAuth();
  if (loading) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải…</main>;
  return account ? <Lobby /> : <AuthScreen />;
}
```

- [ ] **Step 4: Typecheck** `npx tsc --noEmit` (room files still pending B4).

- [ ] **Step 5: Commit**

```bash
git add components/lobby app/page.tsx
git commit -m "feat: lobby UI + home auth gate"
```

---

# Phase B4 — Rewire the room to accounts/session

## Task B4: Room client, useRoom, JoinGate, useDjController, room components → session/username

**Files:** Modify `app/room/[code]/RoomClient.tsx`, `hooks/useRoom.ts`, `hooks/useDjController.ts`, `components/room/{JoinGate,RoomShell,Header,MemberList,Queue,AddSong,SettingsDialog}.tsx`

> This is the rewire that makes the app compile + run end-to-end. After it, `npm run build` must pass.

- [ ] **Step 1: `hooks/useRoom.ts`** — replace device-identity with the account session + push `room_id` to the lobby. Key changes:
  - Import `useAuth`; derive `identity` from `{ account, token }` (the member id is resolved from `state.members` by `account_id`).
  - `RoomView` exposes `token: string`, `accountId: string`, `myMemberId: string | null` (found via `state.members.find(m => m.account_id === accountId)?.id ?? null`), plus the existing `state/onlineIds/role/kicked/loading`.
  - `role` = `deriveRole(state.room, myMemberId)`.
  - `kicked` = `wasMember && !!state.room && !myMemberId` — a `wasMember` latch (set true in the subscription callback once your account appears in `members`) so a **never-joined** visitor falls through to the JoinGate instead of the kicked screen.
  - On entering the room (after room id known), call `lobby.setRoomId(roomId)`; in cleanup call `lobby.setRoomId(null)`.
  - Presence: keep `trackPresence(roomId, { memberId: myMemberId ?? accountId, name: account.username }, setOnlineIds)`.

```tsx
"use client";

import { useEffect, useState } from "react";
import { subscribeRoom, trackPresence, type RoomState } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { deriveRole, type RoleFlags } from "@/lib/roles";
import { useAuth } from "@/hooks/useAuth";

export interface RoomView {
  loading: boolean; state: RoomState; onlineIds: string[];
  token: string; accountId: string; myMemberId: string | null;
  role: RoleFlags; kicked: boolean;
}
const EMPTY: RoomState = { room: null, members: [], queue: [] };

export function useRoom(code: string): RoomView {
  const { account, token, lobby } = useAuth();
  const [state, setState] = useState<RoomState>(EMPTY);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [wasMember, setWasMember] = useState(false); // latches once we've ever been a member of THIS room
  const accountId = account?.accountId ?? "";

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setWasMember(false); }, [code]); // reset latch when switching rooms

  useEffect(() => {
    let unsubRoom: (() => void) | undefined;
    let unsubPresence: (() => void) | undefined;
    let active = true;
    (async () => {
      const { data } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
      if (!active) return;
      if (!data) { setLoading(false); return; }
      const roomId = data.id as string;
      lobby?.setRoomId(roomId);
      unsubRoom = subscribeRoom(roomId, (s) => { setState(s); setLoading(false); if (accountId && s.members.some((m) => m.account_id === accountId)) setWasMember(true); });
      if (account) unsubPresence = trackPresence(roomId, { memberId: account.accountId, name: account.username }, setOnlineIds);
    })();
    return () => { active = false; unsubRoom?.(); unsubPresence?.(); lobby?.setRoomId(null); };
  }, [code, accountId, account, lobby]);

  const myMemberId = state.members.find((m) => m.account_id === accountId)?.id ?? null;
  const role = state.room ? deriveRole(state.room, myMemberId)
    : { isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false };
  const kicked = wasMember && !!state.room && !myMemberId; // never-joined users fall through to JoinGate

  return { loading, state, onlineIds, token: token ?? "", accountId, myMemberId, role, kicked };
}
```
> Note: presence online ids are now `account_id`s (keyed by account in trackPresence's `memberId` param = account.accountId). `MemberList` must check membership against `m.account_id` ∈ onlineIds (Step 5).

- [ ] **Step 2: `app/room/[code]/RoomClient.tsx`** — gate on auth; if not logged in show `AuthScreen`; else loading/not-found/kicked/JoinGate(password-only)/RoomShell. Membership is now: if `myMemberId` is null and room loaded → show JoinGate (needs to join with password). Use a `joined` nonce to re-fetch after joining.

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useRoom } from "@/hooks/useRoom";
import AuthScreen from "@/components/auth/AuthScreen";
import JoinGate from "@/components/room/JoinGate";
import RoomShell from "@/components/room/RoomShell";

export default function RoomClient({ code }: { code: string }) {
  const { account, loading: authLoading } = useAuth();
  const view = useRoom(code);
  const [, force] = useState(0);

  if (authLoading) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải…</main>;
  if (!account) return <AuthScreen />;
  if (view.loading) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải phòng…</main>;
  if (!view.state.room) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Không tìm thấy phòng “{code}”.</main>;
  if (view.kicked) return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-playfair text-2xl text-burgundy">Bạn đã bị mời khỏi phòng.</p>
      <Link href="/" className="text-burgundy-accent underline">Về trang chủ</Link>
    </main>
  );
  if (!view.myMemberId) return <JoinGate code={code} token={view.token} onJoined={() => force((n) => n + 1)} />;
  return <RoomShell view={view} />;
}
```
> `myMemberId` becomes non-null automatically once the realtime `members` update (from join_room) arrives — `onJoined` just nudges a re-render while we wait; the realtime subscription delivers the new member row.

- [ ] **Step 3: `components/room/JoinGate.tsx`** — password only (account already known); calls `joinRoom(code, password, token)`.

```tsx
"use client";

import { useState } from "react";
import { joinRoom } from "@/lib/supabase";

export default function JoinGate({ code, token, onJoined }: { code: string; token: string; onJoined: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try { await joinRoom(code, password, token); onJoined(); }
    catch (err) {
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("invalid password") ? "Sai mật khẩu phòng." : msg.includes("room not found") ? "Không tìm thấy phòng." : msg);
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-center font-playfair text-2xl font-bold text-burgundy">Vào phòng {code}</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu phòng" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p className="text-sm text-burgundy-accent">{error}</p>}
        <button disabled={busy} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">{busy ? "Đang vào…" : "Vào phòng"}</button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: `hooks/useDjController.ts`** — change the prop type from `{ …, identity: Identity }` to `{ …, roomId: string, token: string }` and every RPC call from `advanceQueue(identity)` → `advanceQueue(roomId, token)`, `setPlayback(identity, …)` → `setPlayback(roomId, token, …)`, `seekPlayback(identity, …)` → `seekPlayback(roomId, token, …)`. The effect/guard logic (queueLen auto-advance, advancingRef, load/seek/volume) is otherwise unchanged. Update the destructure to `{ room, current, isDj, queueLen, roomId, token }`.

- [ ] **Step 5: `components/room/RoomShell.tsx`, `MemberList.tsx`, `Queue.tsx`, `AddSong.tsx`, `SettingsDialog.tsx`, `Header.tsx`** — swap `identity` props for `(roomId, token)` and display names from `member.username`:
  - `RoomShell`: `const { state, role, onlineIds, token, myMemberId } = view; const room = state.room!;` pass `roomId={room.id} token={token}` to children that mutate; `useDjController({ room, current, isDj: role.isDj, queueLen: state.queue.length, roomId: room.id, token })`. **`djOnline` must map the DJ's member id to an account id first** (presence/`onlineIds` are keyed by ACCOUNT id, but `dj_member_id` is a MEMBER id): `const djAccountId = state.members.find(m => m.id === room.dj_member_id)?.account_id ?? null; const djOnline = !!djAccountId && onlineIds.includes(djAccountId);`
  - `MemberList`: online check uses `onlineIds.includes(m.account_id)`; display `m.username ?? "?"`; badges from `room.admin_member_id/dj_member_id === m.id`.
  - `Queue`: `bumpToTop(roomId, token, id)`, `reorderItem(roomId, token, id, pos)`, `deleteItem(roomId, token, id)`.
  - `AddSong`: `addQueueItem(roomId, token, {…})`.
  - `SettingsDialog`: `assignDj(roomId, token, m.id)`, `transferAdmin(roomId, token, m.id)`, `kickMember(roomId, token, m.id)`, `renameRoom(roomId, token, name)`; member rows display `m.username`; `others = members.filter(m => m.id !== myMemberId)` (pass `myMemberId`).
  - `Header`: `setPlayMode(roomId, token, mode)`; replace the inline share button with `<ShareButtons code={room.code} title={room.name} />` (Task D2); pass `roomId/token/myMemberId` to `SettingsDialog`.

- [ ] **Step 6: Typecheck + build** `npx tsc --noEmit` then `npm run build` → expect clean (no `Identity` references remain; all RPC calls use `(roomId, token)`).

- [ ] **Step 7: Commit**

```bash
git add app/room hooks/useRoom.ts hooks/useDjController.ts components/room
git commit -m "feat: rewire room to account session (membership, username, session RPCs)"
```

---

# Phase D — UI polish

## Task D1: Animated tonearm (`Turntable.tsx`)

**Files:** Modify `components/room/Turntable.tsx`

- [ ] **Step 1: Replace `Turntable.tsx`** with the pivot+tonearm version. OFF (`!spinning`): arm at `rotate(0deg)` — vertical, parked just outside the right rim. PLAYING (`spinning`): `rotate(36deg)` — needle on the middle of the black grooves; disc spins. Transition `.9s`.

```tsx
"use client";

export default function Turntable({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-64 w-80">
      {/* disc */}
      <div
        className={`absolute left-3 top-3.5 h-[230px] w-[230px] rounded-full shadow-2xl ${spinning ? "animate-vinyl" : "animate-vinyl animate-vinyl-paused"}`}
        style={{ background: "repeating-radial-gradient(circle at center,#15110b 0 2px,#241a10 2px 4px)" }}
      >
        <div className="absolute inset-[34%] flex items-center justify-center rounded-full"
          style={{ background: "radial-gradient(circle,#7a1f33,#6e2233 60%,#4d1722)", boxShadow: "0 0 0 2px #b08d57" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {thumbnail ? <img src={thumbnail} alt="" className="h-full w-full rounded-full object-cover opacity-90" /> : <span className="text-2xl">🎼</span>}
        </div>
        <div className="absolute inset-[48.5%] rounded-full bg-[#1a140d]" />
      </div>
      {/* parked rest puck */}
      <div className="absolute bottom-[92px] right-[22px] h-3 w-6 rounded-full bg-[#8a6d2f] opacity-40" />
      {/* tonearm: pivot top-right; 0deg = vertical/parked, 36deg = needle on mid-groove */}
      <div
        className="absolute right-[26px] top-2 h-[150px] w-[18px] origin-[9px_9px] transition-transform duration-[900ms] ease-in-out"
        style={{ transform: spinning ? "rotate(36deg)" : "rotate(0deg)" }}
      >
        <div className="absolute left-0 top-0 h-5 w-5 rounded-full bg-[#8a6d2f] shadow" />
        <div className="absolute left-2 top-[9px] h-[130px] w-1 rounded bg-gradient-to-b from-[#c8a86a] to-[#8a6d2f]" />
        <div className="absolute bottom-0 left-px h-4 w-[18px] rounded bg-burgundy" />
      </div>
    </div>
  );
}
```
> The `bg-gradient-to-b` utility: if lint flags it (Tailwind v4 prefers `bg-linear-to-b`), use `bg-linear-to-b`. Keep `.animate-vinyl`/`.animate-vinyl-paused` from v1 globals.css (already present).

- [ ] **Step 2: Verify** `npx tsc --noEmit` and `npm run lint` (only accepted `<img>` warning). Then `npm run build`.

- [ ] **Step 3: Commit**

```bash
git add components/room/Turntable.tsx
git commit -m "feat: animated tonearm — vertical when paused, on the groove when playing"
```

---

## Task D2: Share buttons (`ShareButtons.tsx`) + Header integration

**Files:** Create `components/room/ShareButtons.tsx`; Modify `components/room/Header.tsx`

- [ ] **Step 1: Create `components/room/ShareButtons.tsx`** (verbatim — research-verified, SSR-safe, graceful fallback)

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ShareButtonsProps = { code: string; title?: string };
type ToastTone = "ok" | "warn";
type Toast = { msg: string; tone: ToastTone };

function roomUrl(code: string): string {
  return `${window.location.origin}/room/${code}`;
}

async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  if (typeof document === "undefined") return false;
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", "");
    ta.style.position = "fixed"; ta.style.top = "-9999px"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

export default function ShareButtons({ code, title }: ShareButtonsProps) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((msg: string, tone: ToastTone = "ok") => {
    setToast({ msg, tone });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2000);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const handleCopyCode = useCallback(async () => {
    const ok = await copyText(code);
    flash(ok ? `Đã sao chép mã ${code}!` : `Sao chép thủ công: ${code}`, ok ? "ok" : "warn");
  }, [code, flash]);

  const handleShare = useCallback(async () => {
    const url = roomUrl(code);
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try { await navigator.share({ title: title ?? "Music Together", text: `Tham gia phòng nhạc ${code}`, url }); return; }
      catch (err) { if (err instanceof DOMException && err.name === "AbortError") return; }
    }
    const ok = await copyText(url);
    flash(ok ? "Đã sao chép liên kết!" : `Sao chép thủ công: ${url}`, ok ? "ok" : "warn");
  }, [code, title, flash]);

  return (
    <div className="relative inline-flex items-center gap-2">
      <button type="button" onClick={handleCopyCode} className="rounded-lg border border-dashed border-gold bg-cream px-2 py-1 text-xs text-ink transition hover:bg-parchment-200">🔗 {code} · 📋</button>
      <button type="button" onClick={handleShare} className="rounded-lg border border-gold bg-cream px-3 py-1 text-xs text-burgundy transition hover:bg-parchment-200">📤 Chia sẻ</button>
      {toast && (
        <span role="status" aria-live="polite"
          className={`pointer-events-none absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border px-2 py-1 text-[11px] shadow ${toast.tone === "ok" ? "border-gold-200 bg-cream text-burgundy" : "border-burgundy-accent bg-cream text-burgundy-accent"}`}>
          {toast.msg}
        </span>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Use it in `Header.tsx`** — `import ShareButtons from "./ShareButtons";` and replace the old code-copy button/`shareCode` with `<ShareButtons code={room.code} title={room.name} />`. Remove the now-dead `shareCode` function.

- [ ] **Step 3: Verify** `npx tsc --noEmit`, `npm run lint`, `npm run build`.

- [ ] **Step 4: Commit**

```bash
git add components/room/ShareButtons.tsx components/room/Header.tsx
git commit -m "feat: copy-code + Web Share buttons with toast and fallback"
```

---

## Task E1: Final gate + docs

**Files:** Modify `README.md`

- [ ] **Step 1: Update the README deploy section** — note that v2 requires running `supabase/migrations/0004_v2_rebuild.sql` (it drops v1 and rebuilds account-native); env vars unchanged (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`). Append a short "v2: accounts & lobby" subsection.

- [ ] **Step 2: Full gate** `npm test` (unit pass, integration skipped) then `npm run build` (succeeds, routes `/`, `/room/[code]`, `/api/oembed`). Capture summaries.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v2 deploy notes (run 0004 rebuild migration)"
```

---

## Execution order (dependencies)
A1 → A2 → **C1** (lobby lib, needed by useAuth) → B1 → B2 → B3 → C2 → **B4** (rewire room; makes build pass) → D1 → D2 → E1.

## Self-review (completed during planning)
- **Spec coverage:** accounts username+pass (A1 register/login + B2/B3) ✓; session token sha256 + localStorage (A1 sessions, B1) ✓; role-by-account across devices (A1 `_auth`, A2 test, B4 useRoom) ✓; room password first-join-only (A1 join_room skip-if-member) ✓; lobby active rooms via global presence, distinct-account count (C1 aggregateActiveRooms + C2) ✓; create/join + by-code (C2 Lobby) ✓; animated tonearm off=vertical/playing=mid-groove (D1) ✓; copy code + share (D2) ✓; teardown+rebuild migration (A1) ✓; RLS + secret isolation (A1) ✓; chat/reactions/likes still placeholders (unchanged) ✓.
- **Placeholder scan:** Part 7 ports are specified with exact signatures + the precise one-line transformation against the committed `0002_rpc.sql` (a deterministic, complete instruction, not a vague TODO). All other code is full.
- **Type consistency:** RPC wrapper names/params `(roomId, token, …)` match the A1 SQL signatures and the B4 call sites; `Member.account_id/username`, `QueueItem.added_by_account_id`, `RoomView.{token,accountId,myMemberId}`, `LobbyHandle.{unsubscribe,setRoomId}`, `Account.{accountId,username}` are used consistently across tasks.
- **Known carry-overs / accepted:** lobby card now-playing/`is_playing` refreshes when the active-room set changes (not on every in-room play toggle) — acceptable per spec; optional interval refetch noted as future. `add_queue_item` calls `_auth` then `_auth_account` (two session lookups) — correct, minor; could be merged later. Username rename not exposed (snapshots in `added_by_name` keep history). Google login / private rooms / password reset remain future (spec §13).
```
