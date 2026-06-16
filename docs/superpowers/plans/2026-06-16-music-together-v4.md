# Music Together v4 Implementation Plan — Chat, Reactions, Inline Role Controls, DJ-revoke→Admin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted room chat, ephemeral floating emoji reactions, inline (member-column) role controls, and make revoking the DJ return the role to the room admin.

**Architecture:** One additive migration `0006_v4_chat_roles.sql` changes `assign_dj` (revoke → admin), adds a `chat_messages` table (RLS public-read, RPC-only writes, realtime) and two chat RPCs (`send_chat_message`, `delete_chat_message`). Client: thin wrappers (`lib/chat.ts`), a delta-subscribing `useChat` hook + `ChatPanel`; an ephemeral Broadcast layer (`lib/reactions.ts` + `useReactions` + `Reactions`); and an admin ⋯ menu in `MemberList` reusing existing role wrappers. Reactions never touch the DB.

**Tech Stack:** Next.js 16.2.9, React 19, TS 5, Tailwind v4, `@supabase/supabase-js` (Postgres + Realtime postgres_changes/Broadcast), Vitest.

**Builds on:** v3 (merged to `main`). Spec: [docs/superpowers/specs/2026-06-16-music-together-v4-chat-roles-reactions-design.md](../specs/2026-06-16-music-together-v4-chat-roles-reactions-design.md).

---

## Conventions & prerequisites
- Custom account/session auth: write RPCs take `(p_room_id, p_session_token, …)` and authorize via `public._auth(room, session, role)` → returns the caller's **member id**, raises on failure. Role argument values in use: `'admin'`, `'dj'`, `'admin_or_dj'`, and **`'any'`** (membership only — used by `add_queue_item`). `public._auth_account(token)` → account id. Both are SECURITY DEFINER with `set search_path = public, extensions` and are revoked from anon/authenticated (reachable only inside other SECURITY DEFINER RPCs).
- All data tables are `select using(true)` to `anon`; writes are RPC-only. New `chat_messages` follows the same pattern.
- **Migration is additive** (`0006`): `create or replace`, `create table if not exists`, idempotent guards. No `drop table`/`drop column`.
- **Branch:** implement on `feat/v4-chat` (so Vercel `main` isn't auto-deployed mid-work); merge when done. After merge, run `0006_v4_chat_roles.sql` in the Supabase SQL Editor.
- `@/*` path alias → project root. Vitest: alias `@`→root, glob `**/*.test.{ts,tsx}`, jsdom, env stubs `NEXT_PUBLIC_SUPABASE_URL/_PUBLISHABLE_KEY` already set in `vitest.config.ts`.
- Salon tokens (confirmed in `app/globals.css`): `burgundy`, `burgundy-accent`, `gold`, `gold-200`, `cream`, `parchment`, `ink`, `green-vintage`, `font-playfair`, `font-cormorant`.

## File map (v4)
```
supabase/migrations/0006_v4_chat_roles.sql   # CREATE: assign_dj revoke→admin; chat_messages + RLS + replica-identity + publication; send/delete chat RPCs + grants (additive)
lib/chat.ts                                   # CREATE: chat RPC wrappers + fetchRecentMessages + subscribeChat
lib/reactions.ts                              # CREATE: broadcast join/send + throttled() pure helper
hooks/useChat.ts                              # CREATE
hooks/useReactions.ts                         # CREATE
components/room/MemberList.tsx                # MODIFY: per-row admin ⋯ menu (Giao/Thu DJ, Trao Admin, Kick)
components/room/ChatPanel.tsx                 # MODIFY: real chat (replace placeholder)
components/room/Reactions.tsx                 # MODIFY: emoji bar + floating layer (replace placeholder)
components/room/RoomShell.tsx                 # MODIFY: pass props to MemberList/ChatPanel/Reactions
app/globals.css                              # MODIFY: @keyframes float-up
tests/integration/v4.test.ts                  # CREATE: assign_dj revoke→admin; chat validate/rate-limit/non-member/delete perms
tests/unit/reactions.test.ts                  # CREATE: throttled() unit test
```

---

# Phase 1 — DB (migration) + role menu + DB tests

## Task 1: Migration `0006_v4_chat_roles.sql`

**Files:** Create `supabase/migrations/0006_v4_chat_roles.sql`

> Additive & idempotent. `assign_dj` keeps its signature (so its existing grant from 0004 persists). `chat_messages` uses `replica identity full` so realtime DELETE events carry `room_id` (lets the client filter DELETE by room; default replica identity exposes only the PK on DELETE).

- [ ] **Step 1: Create the file** with exactly:

```sql
-- =========================================================
-- 0006_v4_chat_roles.sql — v4: DJ-revoke→admin + persisted chat. ADDITIVE (no data drop).
-- Reactions are DB-free (Realtime Broadcast only).
-- =========================================================

-- ---------- A. assign_dj: revoke (null target) returns DJ to the room admin ----------
create or replace function public.assign_dj(
  p_room_id uuid, p_session_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'admin');
  if p_target_member is not null and not exists (
       select 1 from public.members where id = p_target_member and room_id = p_room_id) then
    raise exception 'target member not in room' using errcode = '42501';
  end if;
  -- v4: revoking (null) returns DJ to the current admin instead of clearing it.
  update public.rooms
     set dj_member_id = coalesce(p_target_member, admin_member_id)
   where id = p_room_id;
end;
$$;

-- ---------- B. chat_messages table (public read, RPC-only writes, realtime) ----------
create table if not exists public.chat_messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms(id)    on delete cascade,
  account_id uuid          references public.accounts(id) on delete set null,
  username   text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_chat_room_created on public.chat_messages (room_id, created_at desc);

-- realtime DELETE payload must carry room_id so the client can filter by room
alter table public.chat_messages replica identity full;

alter table public.chat_messages enable row level security;
drop policy if exists chat_messages_select on public.chat_messages;
create policy chat_messages_select on public.chat_messages for select to anon using (true);
-- No insert/update/delete policy -> writes only via SECURITY DEFINER RPCs below.

-- add to realtime publication (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;
end $$;

-- ---------- C. send_chat_message (any member; validated + rate-limited + trimmed to 200) ----------
create or replace function public.send_chat_message(
  p_session_token text, p_room_id uuid, p_body text
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_name text; v_recent int; v_body text; v_id uuid;
begin
  perform public._auth(p_room_id, p_session_token, 'any');   -- must be a member of the room
  v_account := public._auth_account(p_session_token);
  v_body := btrim(p_body);
  if v_body = '' or length(v_body) > 500 then
    raise exception 'invalid message' using errcode = '22023';
  end if;
  select count(*) into v_recent from public.chat_messages
   where room_id = p_room_id and account_id = v_account
     and created_at > now() - interval '15 seconds';
  if v_recent >= 10 then
    raise exception 'too many messages, slow down' using errcode = '53400';
  end if;
  select username into v_name from public.accounts where id = v_account;
  insert into public.chat_messages (room_id, account_id, username, body)
    values (p_room_id, v_account, v_name, v_body)
    returning id into v_id;
  -- keep only the newest 200 messages per room (bounded storage on free hosting)
  delete from public.chat_messages
   where room_id = p_room_id
     and id not in (
       select id from public.chat_messages
        where room_id = p_room_id
        order by created_at desc
        limit 200
     );
  return v_id;
end;
$$;

-- ---------- D. delete_chat_message (author or room admin) ----------
create or replace function public.delete_chat_message(
  p_session_token text, p_room_id uuid, p_message_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_msg_account uuid; v_is_admin boolean;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select account_id into v_msg_account from public.chat_messages
    where id = p_message_id and room_id = p_room_id;
  if not found then
    raise exception 'message not found' using errcode = '42704';
  end if;
  select (admin_member_id = v_member) into v_is_admin from public.rooms where id = p_room_id;
  if not (coalesce(v_is_admin, false) or v_msg_account is not distinct from v_account) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.chat_messages where id = p_message_id and room_id = p_room_id;
end;
$$;

-- ---------- grants (assign_dj grant persists from 0004; signature unchanged) ----------
grant execute on function public.send_chat_message(text,uuid,text)   to anon, authenticated;
grant execute on function public.delete_chat_message(text,uuid,uuid) to anon, authenticated;
```

- [ ] **Step 2: Sanity-check** — re-read: balanced `$$`; every function `set search_path = public, extensions`; `assign_dj` keeps its 3 params + `void` return (so `create or replace` is valid and the 0004 grant persists); `chat_messages` has RLS + exactly one SELECT policy + `replica identity full` + idempotent publication guard; `send_chat_message` rejects empty/>500 then rate-limits then inserts then trims; `delete_chat_message` allows author-or-admin; no `drop table`/`drop column`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_v4_chat_roles.sql
git commit -m "feat(db): v4 migration — assign_dj revoke→admin, chat_messages + chat RPCs"
```

---

## Task 2: Integration tests `tests/integration/v4.test.ts`

**Files:** Create `tests/integration/v4.test.ts`

> Skips unless `SUPABASE_TEST_URL` + `SUPABASE_TEST_ANON_KEY` are set against a DB with `0006` applied. The anon key reaches all paths because `create_room` makes the caller admin+DJ. Mirrors the skip pattern in `tests/integration/rpc.test.ts`/`admin.test.ts`.

- [ ] **Step 1: Write the test file** with exactly:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v4 roles + chat", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const createRoom = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: "R", p_password: "secret", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
  };
  const join = async (code: string, token: string) => {
    const { data, error } = await db.rpc("join_room", { p_code: code, p_password: "secret", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; member_id: string };
  };
  const idOf = (r: { data: unknown }) => (Array.isArray(r.data) ? r.data[0] : r.data) as string;

  it("assign_dj revoke returns DJ to the admin", async () => {
    const owner = await reg(uniq("own"));
    const room = await createRoom(owner.token);
    const m2 = await reg(uniq("dj"));
    const j = await join(room.code, m2.token);
    expect((await db.rpc("assign_dj", { p_room_id: room.room_id, p_session_token: owner.token, p_target_member: j.member_id })).error).toBeNull();
    expect((await db.rpc("assign_dj", { p_room_id: room.room_id, p_session_token: owner.token, p_target_member: null })).error).toBeNull();
    const { data } = await db.from("rooms").select("dj_member_id, admin_member_id").eq("id", room.room_id).single();
    const r = data as { dj_member_id: string; admin_member_id: string };
    expect(r.dj_member_id).toBe(r.admin_member_id);
    expect(r.dj_member_id).toBe(room.member_id);
  });

  it("send_chat_message validates body", async () => {
    const owner = await reg(uniq("chat"));
    const room = await createRoom(owner.token);
    const empty = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "   " });
    expect(empty.error?.message).toContain("invalid message");
    const long = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "x".repeat(501) });
    expect(long.error?.message).toContain("invalid message");
    const ok = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "Xin chào" });
    expect(ok.error).toBeNull();
  });

  it("send_chat_message is rate-limited (10 / 15s)", async () => {
    const owner = await reg(uniq("rl"));
    const room = await createRoom(owner.token);
    for (let i = 0; i < 10; i++) {
      const r = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: `m${i}` });
      expect(r.error).toBeNull();
    }
    const over = await db.rpc("send_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_body: "11" });
    expect(over.error?.message).toContain("too many messages");
  });

  it("non-members cannot send", async () => {
    const owner = await reg(uniq("o2"));
    const room = await createRoom(owner.token);
    const outsider = await reg(uniq("out"));
    const r = await db.rpc("send_chat_message", { p_session_token: outsider.token, p_room_id: room.room_id, p_body: "hi" });
    expect(r.error?.message).toContain("not a member");
  });

  it("delete_chat_message: author yes, other member no, admin yes", async () => {
    const owner = await reg(uniq("o3"));
    const room = await createRoom(owner.token);
    const a = await reg(uniq("a")); await join(room.code, a.token);
    const b = await reg(uniq("b")); await join(room.code, b.token);
    const id1 = idOf(await db.rpc("send_chat_message", { p_session_token: a.token, p_room_id: room.room_id, p_body: "from a #1" }));
    const id2 = idOf(await db.rpc("send_chat_message", { p_session_token: a.token, p_room_id: room.room_id, p_body: "from a #2" }));
    const bDel = await db.rpc("delete_chat_message", { p_session_token: b.token, p_room_id: room.room_id, p_message_id: id1 });
    expect(bDel.error?.message).toContain("not allowed");
    const aDel = await db.rpc("delete_chat_message", { p_session_token: a.token, p_room_id: room.room_id, p_message_id: id1 });
    expect(aDel.error).toBeNull();
    const oDel = await db.rpc("delete_chat_message", { p_session_token: owner.token, p_room_id: room.room_id, p_message_id: id2 });
    expect(oDel.error).toBeNull();
  });
});
```

- [ ] **Step 2: Run (skips without env)** `npm test -- tests/integration/v4.test.ts` → SKIPPED without env; with a v4-migrated DB → PASS. Confirm `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/v4.test.ts
git commit -m "test(db): v4 assign_dj revoke→admin + chat validation/rate-limit/perms"
```

---

## Task 3: Inline role menu in `MemberList`

**Files:** Modify `components/room/MemberList.tsx`, `components/room/RoomShell.tsx`

> Adds an admin-only ⋯ menu per member row (not on the viewer's own row), reusing `assignDj`/`transferAdmin`/`kickMember`. `SettingsDialog` is unchanged (both work).

- [ ] **Step 1: Replace `components/room/MemberList.tsx`** entirely with:

```tsx
"use client";

import { useState } from "react";
import { assignDj, transferAdmin, kickMember, type Member, type Room } from "@/lib/supabase";

export default function MemberList({ members, room, onlineIds, isAdmin, token, myMemberId }: {
  members: Member[]; room: Room; onlineIds: string[];
  isAdmin: boolean; token: string; myMemberId: string | null;
}) {
  const online = new Set(onlineIds);
  const [openId, setOpenId] = useState<string | null>(null);
  const roomId = room.id;

  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        Thành viên <span className="text-xs text-ink/60">{online.size} online</span>
      </h3>
      <ul>
        {members.map((m) => {
          const isDj = room.dj_member_id === m.id;
          const canManage = isAdmin && m.id !== myMemberId;
          return (
            <li key={m.id} className="flex items-center gap-2 border-b border-dotted border-gold-200 py-1.5 text-sm">
              <span className={`h-2 w-2 rounded-full ${online.has(m.account_id) ? "bg-green-vintage" : "bg-gold-200"}`} />
              <span className="text-ink">{m.username ?? "?"}</span>
              {room.admin_member_id === m.id && <span className="rounded-full bg-burgundy px-2 text-[10px] text-cream">👑 Admin</span>}
              {isDj && <span className="rounded-full bg-green-vintage px-2 text-[10px] text-cream">🎧 DJ</span>}
              {canManage && (
                <span className="relative ml-auto">
                  <button type="button" aria-label="Quản lý thành viên"
                    onClick={() => setOpenId((id) => (id === m.id ? null : m.id))}
                    className="rounded px-1 leading-none text-burgundy hover:bg-gold-200/40">⋯</button>
                  {openId === m.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setOpenId(null)} />
                      <div className="absolute right-0 z-20 mt-1 w-32 overflow-hidden rounded-lg border border-gold bg-cream text-xs shadow-lg">
                        <button type="button"
                          onClick={() => { assignDj(roomId, token, isDj ? null : m.id).catch(() => {}); setOpenId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-burgundy hover:bg-gold-200/40">{isDj ? "Thu DJ" : "Giao DJ"}</button>
                        <button type="button"
                          onClick={() => { if (window.confirm(`Trao Admin cho ${m.username ?? "?"}?`)) transferAdmin(roomId, token, m.id).catch(() => {}); setOpenId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-burgundy hover:bg-gold-200/40">Trao Admin</button>
                        <button type="button"
                          onClick={() => { if (window.confirm(`Kick ${m.username ?? "?"}?`)) kickMember(roomId, token, m.id).catch(() => {}); setOpenId(null); }}
                          className="block w-full px-3 py-1.5 text-left text-burgundy-accent hover:bg-gold-200/40">Kick</button>
                      </div>
                    </>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Update `components/room/RoomShell.tsx`** — pass the new props to `MemberList`. Replace the line:

```tsx
          <MemberList members={state.members} room={room} onlineIds={onlineIds} />
```
with:
```tsx
          <MemberList members={state.members} room={room} onlineIds={onlineIds} isAdmin={role.isAdmin} token={token} myMemberId={myMemberId} />
```

- [ ] **Step 3: Verify** `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds).

- [ ] **Step 4: Commit**

```bash
git add components/room/MemberList.tsx components/room/RoomShell.tsx
git commit -m "feat: inline admin role menu (Giao/Thu DJ, Trao Admin, Kick) in member column"
```

---

# Phase 2 — Chat (client)

## Task 4: `lib/chat.ts` — chat wrappers + realtime

**Files:** Create `lib/chat.ts`

- [ ] **Step 1: Create `lib/chat.ts`** with exactly:

```ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export interface ChatMessage {
  id: string; room_id: string; account_id: string | null;
  username: string; body: string; created_at: string;
}

export async function sendChatMessage(token: string, roomId: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("send_chat_message", { p_session_token: token, p_room_id: roomId, p_body: body });
  if (error) throw error;
}

export async function deleteChatMessage(token: string, roomId: string, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_chat_message", { p_session_token: token, p_room_id: roomId, p_message_id: id });
  if (error) throw error;
}

/** Last `limit` messages for a room, returned oldest→newest for display. */
export async function fetchRecentMessages(roomId: string, limit = 50): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, room_id, account_id, username, body, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return ((data ?? []) as ChatMessage[]).reverse();
}

/** Dedicated postgres_changes channel for this room's chat (append on INSERT, remove on DELETE). */
export function subscribeChat(
  roomId: string,
  handlers: { onInsert: (m: ChatMessage) => void; onDelete: (id: string) => void },
): () => void {
  const channel: RealtimeChannel = supabase
    .channel(`chat:${roomId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
      (payload) => handlers.onInsert(payload.new as ChatMessage))
    .on("postgres_changes",
      { event: "DELETE", schema: "public", table: "chat_messages", filter: `room_id=eq.${roomId}` },
      (payload) => { const id = (payload.old as { id?: string }).id; if (id) handlers.onDelete(id); })
    .subscribe();
  return () => { void supabase.removeChannel(channel); };
}
```

- [ ] **Step 2: Verify** `npx tsc --noEmit` (clean). Cross-check RPC names/params against `0006_v4_chat_roles.sql` (`send_chat_message(p_session_token,p_room_id,p_body)`, `delete_chat_message(p_session_token,p_room_id,p_message_id)`).

- [ ] **Step 3: Commit**

```bash
git add lib/chat.ts
git commit -m "feat: chat RPC wrappers + realtime subscribe"
```

---

## Task 5: `useChat` hook + `ChatPanel` UI

**Files:** Create `hooks/useChat.ts`; Modify `components/room/ChatPanel.tsx`, `components/room/RoomShell.tsx`

- [ ] **Step 1: Create `hooks/useChat.ts`** with exactly:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchRecentMessages, subscribeChat, sendChatMessage, deleteChatMessage, type ChatMessage,
} from "@/lib/chat";

export function useChat(roomId: string, token: string, viewer: { accountId: string; isAdmin: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    let active = true;
    fetchRecentMessages(roomId).then((m) => { if (active) setMessages(m); }).catch(() => {});
    const unsub = subscribeChat(roomId, {
      onInsert: (msg) => setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg])),
      onDelete: (id) => setMessages((prev) => prev.filter((p) => p.id !== id)),
    });
    return () => { active = false; unsub(); };
  }, [roomId]);

  const send = useCallback((body: string) => sendChatMessage(token, roomId, body), [token, roomId]);
  const remove = useCallback((id: string) => deleteChatMessage(token, roomId, id), [token, roomId]);
  const canDelete = useCallback(
    (m: ChatMessage) => viewer.isAdmin || (!!viewer.accountId && m.account_id === viewer.accountId),
    [viewer.isAdmin, viewer.accountId],
  );
  return { messages, send, remove, canDelete };
}
```

- [ ] **Step 2: Replace `components/room/ChatPanel.tsx`** entirely with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage } from "@/lib/chat";

export default function ChatPanel({ roomId, token, accountId, isAdmin }: {
  roomId: string; token: string; accountId: string; isAdmin: boolean;
}) {
  const { messages, send, remove, canDelete } = useChat(roomId, token, { accountId, isAdmin });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError(null);
    try { await send(body); setText(""); }
    catch (err) {
      const m = (err as { message?: string }).message ?? "Không gửi được";
      setError(
        m.includes("too many messages") ? "Bạn nhắn quá nhanh, chờ chút nhé."
        : m.includes("invalid message") ? "Tin nhắn không hợp lệ (tối đa 500 ký tự)."
        : m.includes("not a member") ? "Bạn cần ở trong phòng để nhắn."
        : m,
      );
    }
  }

  return (
    <div className="mt-4">
      <h3 className="mb-2 font-cormorant text-lg text-burgundy">Trò chuyện</h3>
      <div ref={listRef} className="flex h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-gold-200 bg-cream/60 p-2 text-sm">
        {messages.length === 0 && <p className="m-auto text-xs text-ink/50">Chưa có tin nhắn nào.</p>}
        {messages.map((m: ChatMessage) => (
          <div key={m.id} className="group flex items-start gap-1">
            <span className="min-w-0 text-ink">
              <b className="text-burgundy">{m.username}</b>{" "}
              <span className="whitespace-pre-wrap wrap-break-word">{m.body}</span>
            </span>
            {canDelete(m) && (
              <button type="button" onClick={() => remove(m.id).catch(() => {})}
                className="ml-auto shrink-0 px-1 text-xs text-burgundy-accent opacity-0 group-hover:opacity-100">✕</button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-burgundy-accent">{error}</p>}
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Nhắn gì đó…"
          className="flex-1 rounded-lg border border-gold-200 bg-cream px-2 py-1.5 text-sm text-ink" />
        <button type="submit" className="rounded-lg bg-burgundy px-3 text-cream">Gửi</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Update `components/room/RoomShell.tsx`** — (a) add `accountId` to the `view` destructure; (b) pass props to `ChatPanel`.

Change:
```tsx
  const { state, role, onlineIds, token, myMemberId } = view;
```
to:
```tsx
  const { state, role, onlineIds, token, myMemberId, accountId } = view;
```
And change:
```tsx
          <ChatPanel />
```
to:
```tsx
          <ChatPanel roomId={room.id} token={token} accountId={accountId} isAdmin={role.isAdmin} />
```

- [ ] **Step 4: Verify** `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds).

- [ ] **Step 5: Commit**

```bash
git add hooks/useChat.ts components/room/ChatPanel.tsx components/room/RoomShell.tsx
git commit -m "feat: live room chat (history + realtime, author/admin delete)"
```

---

# Phase 3 — Reactions (ephemeral broadcast)

## Task 6: `lib/reactions.ts` + throttle unit test

**Files:** Create `lib/reactions.ts`, `tests/unit/reactions.test.ts`

- [ ] **Step 1: Write the failing test** `tests/unit/reactions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { throttled, REACTION_EMOJIS } from "@/lib/reactions";

describe("throttled", () => {
  it("allows the first call (lastAt null)", () => {
    expect(throttled(null, 1000)).toBe(false);
  });
  it("blocks a call within the gap", () => {
    expect(throttled(1000, 1100, 250)).toBe(true);
  });
  it("allows a call at/after the gap", () => {
    expect(throttled(1000, 1250, 250)).toBe(false);
    expect(throttled(1000, 1600, 250)).toBe(false);
  });
});

describe("REACTION_EMOJIS", () => {
  it("is the fixed 5-emoji palette", () => {
    expect(REACTION_EMOJIS).toEqual(["❤️", "😂", "🔥", "👏", "🎉"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** `npm test -- tests/unit/reactions.test.ts` → FAIL (cannot resolve `@/lib/reactions`).

- [ ] **Step 3: Create `lib/reactions.ts`** with exactly:

```ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export const REACTION_EMOJIS = ["❤️", "😂", "🔥", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionsHandle { send: (emoji: ReactionEmoji) => void; unsubscribe: () => void; }

/** Ephemeral floating reactions over a dedicated Broadcast channel (no DB). self:false → no echo. */
export function joinReactions(roomId: string, onReact: (emoji: ReactionEmoji) => void): ReactionsHandle {
  const channel: RealtimeChannel = supabase
    .channel(`reactions:${roomId}`)
    .on("broadcast", { event: "react" }, (payload) => {
      const emoji = (payload.payload as { emoji?: ReactionEmoji })?.emoji;
      if (emoji) onReact(emoji);
    })
    .subscribe();
  return {
    send: (emoji) => { void channel.send({ type: "broadcast", event: "react", payload: { emoji } }); },
    unsubscribe: () => { void supabase.removeChannel(channel); },
  };
}

/** Pure: true if a new send should be dropped (within minGapMs of the last). */
export function throttled(lastAt: number | null, now: number, minGapMs = 250): boolean {
  return lastAt !== null && now - lastAt < minGapMs;
}
```

- [ ] **Step 4: Run to verify it passes** `npm test -- tests/unit/reactions.test.ts` → PASS. Confirm `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/reactions.ts tests/unit/reactions.test.ts
git commit -m "feat: reactions broadcast lib + throttle helper (tested)"
```

---

## Task 7: `useReactions` hook + `Reactions` UI + float-up keyframes

**Files:** Create `hooks/useReactions.ts`; Modify `components/room/Reactions.tsx`, `components/room/RoomShell.tsx`, `app/globals.css`

- [ ] **Step 1: Append float-up keyframes to `app/globals.css`** (near the other `@keyframes`):

```css
/* ===== Floating reactions ===== */
@keyframes float-up {
  0%   { transform: translateY(0) scale(1);     opacity: 1; }
  100% { transform: translateY(-150px) scale(1.4); opacity: 0; }
}
.animate-float-up { animation: float-up 2s ease-out forwards; }
```

- [ ] **Step 2: Create `hooks/useReactions.ts`** with exactly:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { joinReactions, throttled, type ReactionEmoji, type ReactionsHandle } from "@/lib/reactions";

export interface FloatingEmote { id: string; emoji: ReactionEmoji; x: number; }

export function useReactions(roomId: string) {
  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const handleRef = useRef<ReactionsHandle | null>(null);
  const lastSentRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const spawn = useCallback((emoji: ReactionEmoji) => {
    const id = `${Date.now()}_${seqRef.current++}`;
    const x = Math.round(Math.random() * 80) - 40; // -40..40 px horizontal jitter
    setEmotes((prev) => [...prev, { id, emoji, x }].slice(-30));
    setTimeout(() => setEmotes((prev) => prev.filter((e) => e.id !== id)), 2000);
  }, []);

  useEffect(() => {
    const handle = joinReactions(roomId, (emoji) => spawn(emoji));
    handleRef.current = handle;
    return () => { handle.unsubscribe(); handleRef.current = null; };
  }, [roomId, spawn]);

  const react = useCallback((emoji: ReactionEmoji) => {
    const now = Date.now();
    if (throttled(lastSentRef.current, now)) return;
    lastSentRef.current = now;
    spawn(emoji);                    // optimistic local render (self:false → no echo)
    handleRef.current?.send(emoji);  // broadcast to others
  }, [spawn]);

  return { emotes, react };
}
```

- [ ] **Step 3: Replace `components/room/Reactions.tsx`** entirely with:

```tsx
"use client";

import { useReactions } from "@/hooks/useReactions";
import { REACTION_EMOJIS } from "@/lib/reactions";

export default function Reactions({ roomId }: { roomId: string }) {
  const { emotes, react } = useReactions(roomId);
  return (
    <div className="relative mt-3">
      <div className="pointer-events-none absolute inset-x-0 bottom-12 h-40 overflow-hidden">
        {emotes.map((e) => (
          <span key={e.id} className="animate-float-up absolute bottom-0 left-1/2 text-2xl" style={{ marginLeft: e.x }}>
            {e.emoji}
          </span>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2">
        {REACTION_EMOJIS.map((e) => (
          <button key={e} type="button" onClick={() => react(e)}
            className="rounded-full border border-gold-200 bg-cream px-2 py-1 text-lg transition hover:scale-110">
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Update `components/room/RoomShell.tsx`** — replace:

```tsx
          <Reactions />
```
with:
```tsx
          <Reactions roomId={room.id} />
```

- [ ] **Step 5: Verify** `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds).

- [ ] **Step 6: Commit**

```bash
git add hooks/useReactions.ts components/room/Reactions.tsx components/room/RoomShell.tsx app/globals.css
git commit -m "feat: floating emoji reactions over Broadcast (ephemeral)"
```

---

# Phase 4 — Docs & gate

## Task 8: README + full build gate

**Files:** Modify `README.md`

- [ ] **Step 1: Append a `## v4: Chat, Reactions & Inline Roles` section to `README.md`** noting: run the additive migration `supabase/migrations/0006_v4_chat_roles.sql` in the Supabase SQL Editor (no data loss); new features — persisted room chat (history; author/admin can delete; ≤500 chars; rate-limited 10/15s; newest 200 kept), floating emoji reactions (ephemeral, no DB), inline admin role menu (⋯) in the member column, and DJ-revoke now returns the role to the room admin. Match the existing README heading style.

- [ ] **Step 2: Full gate** `npm test` (unit pass incl. `reactions`; integration skipped without env) + `npm run build` (succeeds; routes unchanged). Capture summaries. Confirm `npm run lint` 0 errors.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v4 notes — chat, reactions, inline roles, DJ-revoke→admin"
```

---

## Self-review (completed during planning)
- **Spec coverage:** Feature A (assign_dj revoke→admin) — Task 1 + tested Task 2 ✓; Feature B (inline ⋯ menu, keep Settings) — Task 3 ✓; Feature C (chat: table+RLS+realtime+RPCs+rate-limit+trim+delete-perms) — Tasks 1,2,4,5 ✓; Feature D (floating reactions, broadcast, palette, throttle) — Tasks 6,7 ✓; migration additive/no-drop — Task 1 ✓; docs/gate — Task 8 ✓.
- **Placeholder scan:** all code is complete; no TBD/TODO; commands have expected outcomes.
- **Type consistency:** `ChatMessage` shape identical in `lib/chat.ts` ↔ `useChat` ↔ `ChatPanel`; RPC names/params match `0006` (`send_chat_message(p_session_token,p_room_id,p_body)`, `delete_chat_message(p_session_token,p_room_id,p_message_id)`, `assign_dj` unchanged); `ReactionEmoji`/`REACTION_EMOJIS`/`throttled`/`ReactionsHandle` defined in `lib/reactions.ts` and consumed in `useReactions`/`Reactions`/the unit test; `RoomShell` now destructures `accountId` from `RoomView` (defined in `hooks/useRoom.ts`) before passing it to `ChatPanel`.
- **Realtime correctness:** `chat_messages` gets `replica identity full` so the DELETE filter `room_id=eq` works (default replica identity would expose only the PK on DELETE); chat uses a dedicated `chat:${roomId}` channel (not the shared `room:${roomId}`), avoiding the v2 "can't add handlers after subscribe / one channel per topic" pitfall; reactions use a separate `reactions:${roomId}` Broadcast channel with `self:false` + optimistic local render (no double-render).
- **Known/accepted:** reactions have no DB assertion (ephemeral; manual test); chat auto-scroll always scrolls to bottom on new message (acceptable for a small panel); no root-level chat moderation in `/admin` (room-admin delete suffices; spec §11 out-of-scope).
