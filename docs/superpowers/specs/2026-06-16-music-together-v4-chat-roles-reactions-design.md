# Music Together v4 — Chat, Reactions & Inline Role Controls (Design)

**Date:** 2026-06-16
**Builds on:** v3 (`feat/v3-admin`, merged to `main`). Custom account/session auth, Supabase Postgres + Realtime, SECURITY DEFINER RPCs, vintage "vinyl salon" UI.

## 1. Goal

Three room-experience improvements:

1. **DJ revoke returns to Admin** — revoking the DJ role currently sets `dj_member_id = NULL` (the room loses its DJ until someone is re-assigned). Change it so revoking returns DJ to the room's **admin**.
2. **Inline role controls** — let the admin grant/revoke roles directly from the left-hand member column via a per-member icon menu, *in addition to* the existing Settings dialog (both keep working).
3. **Chat + Reactions** — a **persisted** room chat (with history) and **ephemeral floating emoji reactions**.

## 2. Constraints (carried from v1–v3)

- **Public DB:** clients hold the anon key; every data table is `select using(true)` (public read), and ALL writes go through SECURITY DEFINER RPCs (no insert/update/delete policies). Secrets stay in policy-less tables. New chat writes MUST be RPC-only, rate-limited, and length-capped.
- **Client-heavy / "server just relays":** prefer Realtime over server compute. Reactions are pure ephemeral broadcast (no DB). Chat persists but is delta-subscribed (append/remove on change), not full-state refetch.
- **Additive migrations:** new migration `0006_v4_chat_roles.sql` uses `create or replace` / `create table if not exists` / idempotent guards. No data drop.
- **Repo is public:** no secrets in code or committed SQL.
- **Auth model:** room write RPCs take `(p_room_id, p_session_token, …)` and authorize via the existing `_auth(room, session, role)` helper (resolves the caller's member row, raises on failure). Admin-only actions use the `'admin'` level.

## 3. Feature A — DJ revoke → Admin

**Current** (`0004_v2_rebuild.sql` `assign_dj(p_room_id, p_session_token, p_target_member)`): admin-only; if `p_target_member` is non-null, validates it is a member then `update rooms set dj_member_id = p_target_member`; if null, sets `dj_member_id = NULL`.

**Change** (in `0006`, `create or replace function public.assign_dj`): keep the admin auth, the non-null validation, and the assign path **unchanged**. Only the **null/revoke** branch changes:

> When `p_target_member IS NULL`, set `dj_member_id = admin_member_id` (the room's current admin) instead of `NULL`.

Implementation note: `update public.rooms set dj_member_id = coalesce(p_target_member, admin_member_id) where id = p_room_id;` after the existing validation. Edge cases: if the admin is already the DJ, revoke is a no-op; if `admin_member_id` is somehow NULL (room left without admin via a prior kick), DJ falls back to NULL (acceptable — there is no admin to receive it).

**Client:** **no change.** The "Thu DJ" button already calls `assignDj(roomId, token, null)`; after the migration it returns DJ to the admin everywhere. This is the single source of truth, so both the Settings dialog and the new inline menu inherit the behavior.

## 4. Feature B — Inline role menu in the member column

**File:** `components/room/MemberList.tsx` (left column). Today each row is: online dot · username · role badges (👑 Admin / 🎧 DJ); no actions.

**Add:** a per-row **⋯** icon, shown **only when the viewer is admin** and the row is **not the viewer's own** member row (mirrors the Settings dialog's self-exclusion). Clicking it opens a small popover menu anchored to the row:

- **Giao DJ** when the target is not DJ / **Thu DJ** when the target is the DJ → `assignDj(roomId, token, m.id)` / `assignDj(roomId, token, null)`.
- **Trao Admin** (with `confirm`) → `transferAdmin(roomId, token, m.id)`.
- **Kick** (with `confirm`) → `kickMember(roomId, token, m.id)`.

Reuses the existing wrappers in `lib/supabase.ts` (`assignDj` / `transferAdmin` / `kickMember`) — no new RPC. `SettingsDialog.tsx` and its Header button stay as-is (per user choice: keep both).

**Interaction details:** exactly one menu open at a time (track open member id in `MemberList` state); click-outside / Escape closes; the menu is a positioned element within the row, styled with salon tokens (`border-gold`, `bg-cream`, `text-burgundy`). Actions close the menu and let the existing realtime `rooms` subscription refresh role badges.

## 5. Feature C — Chat (persisted, with history)

### 5.1 Data model (`0006`)

```
public.chat_messages
  id          uuid primary key default gen_random_uuid()
  room_id     uuid not null references public.rooms(id)    on delete cascade
  account_id  uuid          references public.accounts(id) on delete set null
  username    text not null            -- snapshot at send time
  body        text not null
  created_at  timestamptz not null default now()
index  idx_chat_room_created on (room_id, created_at desc)
RLS    enabled; policy select using(true)   -- public read, like members/rooms
       (no insert/update/delete policy → writes RPC-only)
realtime publication: add table public.chat_messages   (idempotent guard)
```

Idempotency: guard the `create policy` (drop-if-exists then create) and the `alter publication … add table` (skip if already a member via `pg_publication_tables`).

### 5.2 RPCs (`0006`, SECURITY DEFINER, `set search_path = public, extensions`)

- **`send_chat_message(p_session_token text, p_room_id uuid, p_body text) returns uuid`**
  1. Authenticate caller is a **member** of the room via the existing `_auth(p_room_id, p_session_token, …)` helper at member level (raises if not a member); obtain the caller's `account_id` and `username`.
  2. Validate: `btrim(p_body)` non-empty and `length(btrim(p_body)) <= 500`, else raise `'invalid message'` (errcode `22023`).
  3. **Rate-limit:** if the account has sent `>= 10` messages in this room in the last `15 seconds`, raise `'too many messages, slow down'` (errcode `53400`).
  4. Insert `(room_id, account_id, username, btrim(body))`; capture `id`.
  5. **Trim storage:** delete messages in this room beyond the newest 200 (`delete … where room_id = p_room_id and id not in (select id … where room_id = p_room_id order by created_at desc limit 200)`).
  6. Return the new id.

- **`delete_chat_message(p_session_token text, p_room_id uuid, p_message_id uuid) returns void`**
  1. Authenticate membership (as above), get caller account_id and whether caller is the room admin.
  2. Load the target message (must belong to `p_room_id`).
  3. Allow if `message.account_id = caller_account_id` **OR** caller is the room admin; else raise `'not allowed'` (errcode `42501`).
  4. Delete it.

Grants: `execute` on both to `anon, authenticated` (consistent with other room RPCs).

### 5.3 Client

- **`lib/chat.ts`**
  - `interface ChatMessage { id: string; room_id: string; account_id: string | null; username: string; body: string; created_at: string; }`
  - `sendChatMessage(token, roomId, body): Promise<void>` → rpc `send_chat_message`.
  - `fetchRecentMessages(roomId, limit = 50): Promise<ChatMessage[]>` → select last `limit` by `created_at desc`, return **oldest→newest** for display.
  - `deleteChatMessage(token, roomId, id): Promise<void>` → rpc `delete_chat_message`.
  - `subscribeChat(roomId, { onInsert, onDelete }): () => void` → a dedicated `postgres_changes` channel (`chat:${roomId}`) listening to INSERT and DELETE on `chat_messages` filtered by `room_id`; delivers the new/removed row. Does **not** refetch full state.
- **`hooks/useChat.ts`** — on mount: `fetchRecentMessages` → state; `subscribeChat` to append on insert / remove on delete (dedupe by id, since the sender also receives its own insert). Exposes `{ messages, send, remove, canDelete(msg) }`.
- **`components/room/ChatPanel.tsx`** (replaces the "Sắp ra mắt" placeholder) — scrollable message list (auto-scroll to bottom on new message when already near bottom), each row `username · time · body` with an ✕ delete affordance shown only when `canDelete`; an input + send button at the bottom; disabled/empty-guarded; rate-limit error mapped to a friendly Vietnamese message ("Bạn nhắn quá nhanh, chờ chút nhé").

## 6. Feature D — Reactions (ephemeral floating emotes)

**No DB, no RPC.** Pure Supabase **Broadcast**.

- **Channel:** `reactions:${roomId}`, self-contained (handler registered **before** `.subscribe()`, single channel object — following the v2 lobby lesson about not double-subscribing a topic / not adding handlers post-subscribe).
- **Palette (fixed):** ❤️ 😂 🔥 👏 🎉.
- **`lib/reactions.ts`**: `type ReactionEmoji` (the 5 above); `joinReactions(roomId, onReact: (emoji: ReactionEmoji) => void): { send: (emoji: ReactionEmoji) => void; unsubscribe: () => void }`. `send` does `channel.send({ type: 'broadcast', event: 'react', payload: { emoji } })`; incoming `react` events call `onReact`. The channel uses the default `self: false`, so the sender does **not** receive its own broadcast — instead `useReactions` renders the sender's own emote **optimistically on tap** (immediate, no echo, no duplicate).
- **`hooks/useReactions.ts`**: joins the channel; maintains a list of active floating emotes `{ id, emoji, xOffset }`, each auto-removed after the animation (~2s); applies a client-side **throttle (~250ms)** on `send` to prevent spam. (Extract the throttle + floating-queue reducer as pure functions for unit testing.)
- **`components/room/Reactions.tsx`** (replaces placeholder, center column near NowPlaying/Turntable): a button bar of the 5 emojis + a floating layer (absolutely-positioned emotes rising and fading).
- **`app/globals.css`**: `@keyframes float-up` (translateY upward + fade) and `.animate-float-up` (≈2s ease-out forwards).

Best-effort: broadcast failures are ignored (no error UI). No persistence → no abuse surface.

## 7. Migration & file map

```
supabase/migrations/0006_v4_chat_roles.sql   # CREATE: assign_dj revoke→admin; chat_messages + RLS + publication; send/delete chat RPCs + grants (additive)
lib/chat.ts                                   # CREATE: chat RPC wrappers + subscribeChat
lib/reactions.ts                              # CREATE: broadcast join/send
hooks/useChat.ts                              # CREATE
hooks/useReactions.ts                         # CREATE
components/room/MemberList.tsx                # MODIFY: per-row admin ⋯ menu (Giao/Thu DJ, Trao Admin, Kick)
components/room/ChatPanel.tsx                 # MODIFY: real chat (replace placeholder)
components/room/Reactions.tsx                 # MODIFY: emoji bar + floating layer (replace placeholder)
app/globals.css                              # MODIFY: @keyframes float-up
tests/integration/v4.test.ts                  # CREATE: assign_dj revoke→admin; chat validate/rate-limit/non-member/delete-perms
```

No changes needed to `lib/supabase.ts` role wrappers (Feature A is DB-side; Feature B reuses them).

## 8. Error handling

- RPC wrappers throw on error; UI catches and shows friendly Vietnamese text. Specific mappings: chat rate-limit → "Bạn nhắn quá nhanh, chờ chút nhé"; chat too long → trimmed/blocked client-side before send (also enforced server-side).
- Reactions are best-effort; failures are swallowed.
- Realtime drops: chat falls back to the last fetched list and re-subscribes; reactions simply stop until reconnect (ephemeral, acceptable).

## 9. Testing

Integration (`tests/integration/v4.test.ts`, skips without `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`; anon key reaches all paths because `create_room` makes the caller admin):

- **assign_dj revoke→admin:** register → create_room (caller is admin+DJ) → register a 2nd account, join, `assign_dj(room, owner, member2)` → `assign_dj(room, owner, null)` → assert `rooms.dj_member_id == admin_member_id`.
- **send_chat_message:** empty/whitespace and >500-char bodies rejected ("invalid message"); a valid send succeeds; **rate-limit** — 10 quick sends ok, 11th within 15s → "too many messages"; a **non-member** account is rejected.
- **delete_chat_message:** author can delete own; a different non-admin member cannot ("not allowed"); the room admin can delete another member's message.

Unit: the `useReactions` throttle + floating-queue reducer (pure functions) — add/expire behavior and throttle window.

Reactions broadcast has no DB assertion (ephemeral); covered by manual testing.

## 10. Phasing (for the implementation plan)

1. **Phase 1 — Roles:** `0006` `assign_dj` change + `MemberList` inline menu (+ its slice of the integration test).
2. **Phase 2 — Chat:** `0006` `chat_messages` + RPCs + publication; `lib/chat.ts`, `useChat`, `ChatPanel`; chat integration tests.
3. **Phase 3 — Reactions:** `lib/reactions.ts`, `useReactions`, `Reactions`, `globals.css` keyframes; reducer unit test.

(One migration file `0006` covers Phases 1–2's DB; Phase 3 is DB-free.)

## 11. Out of scope (YAGNI / future)

- Root-level chat moderation in `/admin` (room-admin delete is sufficient for now).
- Join/leave system messages in chat.
- Reaction identity/attribution (who reacted) and reaction counts.
- Typing indicators, message edits, threads, attachments.
- Per-room chat retention config (fixed at newest 200).
