# Music Together v6 — Queue Action Loading & Chat Notifications (Design)

**Date:** 2026-06-17
**Builds on:** v5 (merged to `main`). Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase Realtime, custom account/session auth.

## 1. Goal

Two UX-polish features:

1. **Queue action loading** — show a per-row loading state while a queue mutation (delete, bump-to-top, drag-reorder) is in flight, so the user gets feedback instead of a silent delay until realtime refreshes.
2. **Chat notifications (Zalo-style)** — when a new message arrives from someone else while you're "away" (not at the bottom of the chat, or the tab is hidden): an unread badge + "jump to new" pill, a short "ting" sound, and a desktop browser notification when the tab is backgrounded (with permission). Notifications default **ON**.

## 2. Constraints

- **Client-only, no new deps, no asset files.** Sound is synthesized with the Web Audio API; the desktop popup uses the standard `Notification` API. No mp3, no library.
- **SSR-safe.** All `window`/`document`/`Audio`/`Notification` access is guarded (these run only in `"use client"` components / event handlers, never during render or on the server).
- **Fail-soft.** If audio is blocked (no prior gesture) or notifications are unsupported/denied, the feature degrades silently to the in-app badge — never throws.
- **HTTPS.** `Notification` requires a secure context; Vercel is HTTPS. Locally on `http://localhost` it also works (localhost is a secure context); on a LAN IP over HTTP it won't (acceptable — badge still works).
- **Realtime stays as-is.** Chat messages still arrive via the existing `useChat` `subscribeChat` (postgres_changes on `chat_messages`). No DB or migration changes in v6.
- **Only other people's messages notify** — never your own.

## 3. Feature A — Queue action loading

**File:** `components/room/Queue.tsx`. Today `bumpToTop`/`deleteItem` are fire-and-forget `onClick`s; `dropOn` awaits `reorderItem` and ignores errors. There's no in-flight feedback; the row only changes when the debounced realtime refresh lands (~150ms+).

**Change:** add a `busyId: string | null` state (the queue item currently mutating).
- Make the bump/delete handlers `async`: on click, `setBusyId(q.id)`, `await` the RPC, `finally setBusyId(null)`. On error, set a small inline error (reuse a transient `errId`/message) and clear busy.
- `dropOn` (drag-reorder): set `busyId = dragId` for the duration of the `await reorderItem`.
- While `busyId === q.id`: disable that row's buttons and the drag handle, and replace the acting button's glyph with a small spinner (a CSS `animate-spin` ring, or the existing `⏳`), at reduced opacity. The drag handle shows a subtle "đang lưu" affordance (e.g. `cursor-progress`).
- When the realtime refresh removes (delete) or moves (bump) the item, the row re-renders from fresh state; `finally` clears `busyId`. A `busyId` referencing a now-gone item is harmless.

Self-contained; no props/signature changes, no other component touched.

## 4. Feature B — Chat notifications

### 4.1 New-message detection (pure, testable)
A pure helper decides what's newly notifiable. Given the previous list of message ids already "seen" and the current `messages`, plus the viewer's `accountId`, compute the messages that are **new** (id not seen) **and from others** (`account_id !== accountId`). Exported as a small pure function in `lib/chat-notify.ts`, e.g.:
```ts
export function newFromOthers(messages: ChatMessage[], seen: Set<string>, selfAccountId: string): ChatMessage[]
```
Returns the new, other-authored messages in order. Unit-tested.

### 4.2 "Away" detection
The viewer is **away** when **either**: the chat scroll box is not at the bottom (tracked via an `onScroll` handler computing `scrollTop + clientHeight >= scrollHeight - threshold`), **or** `document.hidden` is true. When NOT away (at bottom + tab visible), incoming messages are considered immediately "read".

### 4.3 Unread badge, pill & auto-scroll fix (`components/room/ChatPanel.tsx`)
- Track `unread` count and a `seen` set (or last-seen id) of message ids.
- On `messages` change: compute `newFromOthers`. If any AND viewer is away → add to `unread`, fire the **sound** (4.4) and **desktop notification** (4.5). Update `seen` to include all current ids regardless.
- **Auto-scroll fix:** only auto-scroll to bottom when the viewer is already at the bottom, or when the newest message is the viewer's own. If scrolled up, do NOT yank down (fixes the v4 always-scroll behavior).
- **Header:** the "Trò chuyện" title shows `(N)` when `unread > 0`.
- **Pill:** when `unread > 0`, show a small "↓ N tin mới" button just above the input; clicking it scrolls to the bottom and clears `unread`.
- Reaching the bottom (scroll) while the tab is visible also clears `unread`.

### 4.4 Sound (`lib/sound.ts`)
`playTing()` — lazily create/resume a shared `AudioContext` and play a short two-note "ting" (a brief oscillator + gain envelope, ~150ms). Guarded: if `AudioContext` is unavailable or `resume()` is blocked (no prior gesture), it silently no-ops. Only called when notifications are enabled and the viewer is away.

### 4.5 Desktop notification (`lib/notify.ts`)
SSR-safe wrappers:
- `notifySupported(): boolean` — `typeof window !== "undefined" && "Notification" in window`.
- `ensureNotifyPermission(): Promise<NotificationPermission>` — if supported and permission is `"default"`, call `Notification.requestPermission()` (must be invoked from a user gesture); return the resulting permission. No-op returning current state otherwise.
- `notifyDesktop(title, body)` — if supported, permission `"granted"`, and `document.hidden`, construct `new Notification(title, { body, icon: "/logo.png" })`; clicking it focuses the window (`window.focus()`). Wrapped in try/catch (some browsers throw on `new Notification` and require the SW path — fail soft).

Fired from ChatPanel on a new away message: `notifyDesktop(username, body)` (only meaningful when the tab is hidden, which `notifyDesktop` itself checks).

### 4.6 Enable/permission flow (default ON)
- A `notifyOn` boolean persisted in `localStorage` (key e.g. `music-together:notify`), **default `true`**.
- A **🔔 / 🔕 bell toggle** in the chat header reflects/flips `notifyOn`. Turning it **on** (and on the first user gesture when already on) calls `ensureNotifyPermission()` (gesture-driven, so the browser actually shows the prompt). Turning it off mutes sound + desktop.
- Because permission needs a gesture, with default-ON we request permission on the **first user gesture in the chat** (sending a message, or clicking the bell) when `notifyOn` and `Notification.permission === "default"` — never automatically on load.
- When `notifyOn` is off: no sound, no desktop popup. The unread badge + pill still work (they're free and non-intrusive).

## 5. Files
```
components/room/Queue.tsx        # MODIFY: busyId loading state for delete/bump/reorder (A)
lib/sound.ts                     # CREATE: playTing() via Web Audio (B)
lib/notify.ts                    # CREATE: notifySupported/ensureNotifyPermission/notifyDesktop (B)
lib/chat-notify.ts               # CREATE: newFromOthers() pure helper (B)
components/room/ChatPanel.tsx     # MODIFY: scroll tracking, unread badge + pill, bell toggle, auto-scroll fix, fire sound/desktop (B)
tests/unit/chat-notify.test.ts    # CREATE: newFromOthers() unit tests
```
No DB/migration, no realtime changes, no new dependencies.

## 6. Error handling
- Queue: RPC errors set a transient inline message and clear the busy state; the button re-enables.
- Sound: any Web Audio failure is swallowed (no-op).
- Desktop: unsupported/denied/`new Notification` throw → caught, falls back to badge.
- All `window`/`document`/`localStorage` reads are guarded for SSR.

## 7. Testing
- **Unit** (`tests/unit/chat-notify.test.ts`): `newFromOthers` — returns only unseen messages authored by others, in order; excludes self; excludes already-seen; empty when nothing new.
- Sound, Notification, scroll/visibility, and the bell/permission flow are verified by **manual testing** (browser-only APIs; not unit-tested).

## 8. Phasing (for the plan)
1. **Phase 1 — Queue loading:** `Queue.tsx` busy state (self-contained, quick).
2. **Phase 2 — Chat notifications:** `lib/chat-notify.ts` + unit test; `lib/sound.ts`; `lib/notify.ts`; `ChatPanel.tsx` wiring (unread/pill/auto-scroll/bell/permission/sound/desktop).

## 9. Out of scope (YAGNI / future)
- Per-user mute, notification preferences beyond the single on/off bell.
- Service-worker push notifications (only foreground/`Notification` API here).
- Notifications for reactions, joins/leaves, or queue changes.
- Unread persistence across reloads (unread is session-only).
- A custom sound file / volume control (synthesized ting only).
