# Music Together v6 Implementation Plan — Queue Action Loading & Chat Notifications

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-row loading feedback to queue actions (delete/bump/reorder) and Zalo-style chat notifications (unread badge + "jump to new" pill + "ting" sound + desktop popup when backgrounded), defaulting ON.

**Architecture:** Client-only. `Queue.tsx` gains a `busyId` state that shows a spinner + disables the acting row during an in-flight RPC. Chat: a pure `newFromOthers` helper, a Web-Audio `playTing()`, SSR-safe `Notification` wrappers, and `ChatPanel.tsx` wiring that tracks scroll/visibility to drive unread count, pill, sound and desktop popups. No DB/migration, no new dependencies.

**Tech Stack:** Next.js 16.2.9, React 19, TS 5, Tailwind v4, Web Audio API, Notification API, Vitest.

## Global Constraints
- **Client-only, no new dependencies, no asset files.** Sound = Web Audio synth; popup = `Notification` API. No mp3/library.
- **SSR-safe:** guard every `window`/`document`/`localStorage`/`Notification`/`AudioContext` access; they run only in `"use client"` components / event handlers / effects, never during server render.
- **Fail-soft:** blocked audio, unsupported/denied notifications never throw — degrade to the in-app badge.
- **Notifications default ON;** only **other people's** messages notify (never your own).
- **No DB/migration/realtime changes.** Next.js 16.2.9 (heed deprecations); Tailwind v4 canonical classes.
- **Branch:** `feat/v6-notify` (merge to `main` when done; auto-deploys — no Supabase step needed for v6).
- Salon tokens (in `app/globals.css`): `burgundy`, `burgundy-accent`, `gold`, `gold-200`, `cream`, `ink`.

**Spec:** [docs/superpowers/specs/2026-06-17-music-together-v6-queue-loading-chat-notifications-design.md](../specs/2026-06-17-music-together-v6-queue-loading-chat-notifications-design.md).

---

## File map (v6)
```
components/room/Queue.tsx        # MODIFY: busyId loading state for delete/bump/reorder (Task 1)
lib/chat-notify.ts               # CREATE: newFromOthers() pure helper (Task 2)
tests/unit/chat-notify.test.ts    # CREATE: newFromOthers unit tests (Task 2)
lib/sound.ts                     # CREATE: playTing() Web Audio (Task 3)
lib/notify.ts                    # CREATE: notifySupported/ensureNotifyPermission/notifyDesktop (Task 3)
components/room/ChatPanel.tsx     # MODIFY: scroll/visibility tracking, unread badge+pill, bell toggle, auto-scroll fix, fire sound/desktop (Task 4)
README.md                        # MODIFY: v6 notes (Task 5)
```

---

# Phase 1 — Queue loading

## Task 1: Per-row loading state in `Queue.tsx`

**Files:** Modify `components/room/Queue.tsx`

**Interfaces:**
- Consumes: `bumpToTop`, `deleteItem`, `reorderItem` (lib/supabase), `positionBetween` (lib/queue), `QueueItem`.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Replace `components/room/Queue.tsx`** entirely with:

```tsx
"use client";

import { useState } from "react";
import { bumpToTop, deleteItem, reorderItem, type QueueItem } from "@/lib/supabase";
import { positionBetween } from "@/lib/queue";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

export default function Queue({ queue, currentId, canManage, roomId, token }: {
  queue: QueueItem[]; currentId: string | null; canManage: boolean; roomId: string; token: string;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const upcoming = queue.filter((q) => q.id !== currentId);

  async function run(id: string, fn: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try { await fn(); }
    catch { setError("Thao tác không thành công, thử lại nhé."); }
    finally { setBusyId(null); }
  }

  async function dropOn(target: QueueItem) {
    if (!dragId || dragId === target.id) return;
    const idx = upcoming.findIndex((q) => q.id === target.id);
    const before = upcoming[idx - 1]?.position ?? null;
    const newPos = positionBetween(before, target.position);
    const id = dragId;
    setDragId(null);
    await run(id, () => reorderItem(roomId, token, id, newPos));
  }

  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        Hàng đợi <span className="text-xs text-ink/60">{upcoming.length} bài</span>
      </h3>
      {upcoming.length === 0 && <p className="text-sm text-ink/60">Chưa có bài nào trong hàng đợi.</p>}
      {error && <p className="mb-1 text-xs text-burgundy-accent">{error}</p>}
      <ul className="max-h-[65vh] overflow-y-auto pr-1">
        {upcoming.map((q) => {
          const busy = busyId === q.id;
          return (
            <li key={q.id}
              draggable={canManage && !busy}
              onDragStart={() => setDragId(q.id)}
              onDragOver={(e) => canManage && e.preventDefault()}
              onDrop={() => dropOn(q)}
              className={`flex items-center gap-2 border-b border-dotted border-gold-200 py-2 ${busy ? "opacity-60" : ""}`}>
              {canManage && <span className={`text-gold ${busy ? "cursor-progress" : "cursor-grab"}`}>⠿</span>}
              {q.thumbnail_url
                ? <img src={q.thumbnail_url} alt="" className="h-9 w-12 rounded object-cover" />
                : <span className="flex h-9 w-12 items-center justify-center rounded bg-burgundy text-cream">▶</span>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{q.title || q.youtube_video_id}</div>
                <div className="text-[11px] text-gold">do {q.added_by_name}
                  <span className="ml-2 rounded-full border border-gold-200 bg-cream px-1.5 text-[9px] uppercase text-[#8a6d2f]">like · sắp ra mắt</span>
                </div>
              </div>
              {canManage && (
                <div className="flex w-14 items-center justify-end gap-1">
                  {busy ? <Spinner /> : (
                    <>
                      <button title="Kéo lên đầu" onClick={() => run(q.id, () => bumpToTop(roomId, token, q.id))}
                        className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">⬆</button>
                      <button title="Xóa" onClick={() => run(q.id, () => deleteItem(roomId, token, q.id))}
                        className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✕</button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```
(Keeps the v5 scroll box and the existing `<img>` exactly as before — only adds the `busyId`/`error` state, the `run()` wrapper, the spinner, and disables drag/buttons while busy. The fixed-width `w-14` action cell keeps row layout stable when the buttons swap to a spinner.)

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors; the pre-existing `<img>` warning remains — do not add/remove it), `npm run build` (succeeds).

- [ ] **Step 3: Commit**

```bash
git add components/room/Queue.tsx
git commit -m "feat: per-row loading state for queue delete/bump/reorder"
```

---

# Phase 2 — Chat notifications

## Task 2: `newFromOthers` pure helper + unit test

**Files:** Create `lib/chat-notify.ts`, `tests/unit/chat-notify.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` (lib/chat).
- Produces: `newFromOthers(messages: ChatMessage[], seen: Set<string>, selfAccountId: string): ChatMessage[]`.

- [ ] **Step 1: Write the failing test** `tests/unit/chat-notify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { newFromOthers } from "@/lib/chat-notify";
import type { ChatMessage } from "@/lib/chat";

const msg = (id: string, account_id: string | null): ChatMessage =>
  ({ id, room_id: "r", account_id, username: "u" + id, body: "b" + id, created_at: id });

describe("newFromOthers", () => {
  it("returns unseen messages from others, in order", () => {
    const msgs = [msg("1", "me"), msg("2", "other"), msg("3", "other2")];
    expect(newFromOthers(msgs, new Set(["1"]), "me").map((m) => m.id)).toEqual(["2", "3"]);
  });
  it("excludes your own messages", () => {
    expect(newFromOthers([msg("1", "me")], new Set(), "me")).toEqual([]);
  });
  it("excludes already-seen messages", () => {
    expect(newFromOthers([msg("1", "other")], new Set(["1"]), "me")).toEqual([]);
  });
  it("treats null-author messages as from others", () => {
    expect(newFromOthers([msg("1", null)], new Set(), "me").map((m) => m.id)).toEqual(["1"]);
  });
  it("returns [] when there is nothing new", () => {
    expect(newFromOthers([], new Set(), "me")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/chat-notify.test.ts` → FAIL (cannot resolve `@/lib/chat-notify`).

- [ ] **Step 3: Create `lib/chat-notify.ts`**:

```ts
import type { ChatMessage } from "@/lib/chat";

/** Pure: messages that are unseen AND authored by someone other than the viewer
 *  (a null author — e.g. a deleted account — counts as "other"). In order. */
export function newFromOthers(
  messages: ChatMessage[], seen: Set<string>, selfAccountId: string,
): ChatMessage[] {
  return messages.filter((m) => !seen.has(m.id) && m.account_id !== selfAccountId);
}
```

- [ ] **Step 4: Run to verify it passes** — `npm test -- tests/unit/chat-notify.test.ts` → PASS (5 tests). Confirm `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add lib/chat-notify.ts tests/unit/chat-notify.test.ts
git commit -m "feat: newFromOthers chat-notify helper (pure, tested)"
```

---

## Task 3: notification primitives — `lib/sound.ts` + `lib/notify.ts`

**Files:** Create `lib/sound.ts`, `lib/notify.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `playTing(): void` (lib/sound.ts)
  - `notifySupported(): boolean`, `ensureNotifyPermission(): Promise<NotificationPermission>`, `notifyDesktop(title: string, body: string): void` (lib/notify.ts)

- [ ] **Step 1: Create `lib/sound.ts`**:

```ts
let ctx: AudioContext | null = null;

/** Play a short two-note "ting" via Web Audio. SSR-safe; silent no-op if audio is unavailable/blocked. */
export function playTing(): void {
  if (typeof window === "undefined") return;
  try {
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    for (const [i, freq] of [880, 1320].entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch { /* audio blocked — silent */ }
}
```

- [ ] **Step 2: Create `lib/notify.ts`**:

```ts
/** True if the browser supports the Notification API (and we're client-side). */
export function notifySupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/** Request notification permission (must be called from a user gesture when status is "default").
 *  Returns the resulting permission; "denied" if unsupported. */
export async function ensureNotifyPermission(): Promise<NotificationPermission> {
  if (!notifySupported()) return "denied";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return Notification.permission;
}

/** Show a desktop notification, but only when granted AND the tab is backgrounded. Fail-soft. */
export function notifyDesktop(title: string, body: string): void {
  if (!notifySupported() || Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && !document.hidden) return; // only when tab is hidden
  try {
    const n = new Notification(title, { body, icon: "/logo.png" });
    n.onclick = () => { try { window.focus(); } catch { /* ignore */ } n.close(); };
  } catch { /* some browsers require the SW path — silent */ }
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors). (No unit tests — browser-only APIs; covered by manual testing + Task 4 wiring.)

- [ ] **Step 4: Commit**

```bash
git add lib/sound.ts lib/notify.ts
git commit -m "feat: sound (Web Audio ting) + desktop Notification primitives"
```

---

## Task 4: Wire notifications into `ChatPanel.tsx`

**Files:** Modify `components/room/ChatPanel.tsx`

**Interfaces:**
- Consumes: `useChat` (hooks/useChat), `ChatMessage` (lib/chat), `newFromOthers` (lib/chat-notify), `playTing` (lib/sound), `ensureNotifyPermission`/`notifyDesktop` (lib/notify).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Replace `components/room/ChatPanel.tsx`** entirely with:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage } from "@/lib/chat";
import { newFromOthers } from "@/lib/chat-notify";
import { playTing } from "@/lib/sound";
import { ensureNotifyPermission, notifyDesktop } from "@/lib/notify";

const NOTIFY_KEY = "music-together:notify";

export default function ChatPanel({ roomId, token, accountId, isAdmin }: {
  roomId: string; token: string; accountId: string; isAdmin: boolean;
}) {
  const { messages, send, remove, canDelete } = useChat(roomId, token, { accountId, isAdmin });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [notifyOn, setNotifyOn] = useState(true);

  const listRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const atBottomRef = useRef(true);
  const initializedRef = useRef(false);
  const notifyOnRef = useRef(notifyOn);
  const permAskedRef = useRef(false);

  // Hydrate the notify preference from localStorage (default ON). Effect-only → no SSR mismatch.
  useEffect(() => {
    try { const v = localStorage.getItem(NOTIFY_KEY); if (v !== null) setNotifyOn(v === "1"); } catch { /* ignore */ }
  }, []);
  useEffect(() => { notifyOnRef.current = notifyOn; }, [notifyOn]);

  // Clear unread when the tab becomes visible while already scrolled to the bottom.
  useEffect(() => {
    function onVis() { if (!document.hidden && atBottomRef.current) setUnread(0); }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // React to new messages: notify when "away", auto-scroll only when at bottom / own message.
  useEffect(() => {
    const list = listRef.current;
    if (!initializedRef.current) {
      messages.forEach((m) => seenRef.current.add(m.id));
      initializedRef.current = true;
      list?.scrollTo({ top: list.scrollHeight });
      return;
    }
    const fresh = newFromOthers(messages, seenRef.current, accountId);
    messages.forEach((m) => seenRef.current.add(m.id));
    const lastMsg = messages[messages.length - 1];
    const ownLast = !!lastMsg && lastMsg.account_id === accountId;
    const away = !atBottomRef.current || (typeof document !== "undefined" && document.hidden);
    if (fresh.length > 0 && away) {
      setUnread((u) => u + fresh.length);
      if (notifyOnRef.current) {
        playTing();
        const latest = fresh[fresh.length - 1];
        notifyDesktop(latest.username, latest.body);
      }
    }
    if (atBottomRef.current || ownLast) list?.scrollTo({ top: list.scrollHeight });
  }, [messages, accountId]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    atBottomRef.current = atBottom;
    if (atBottom && !document.hidden) setUnread(0);
  }

  function jumpToBottom() {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight });
    atBottomRef.current = true;
    setUnread(0);
  }

  function toggleNotify() {
    const next = !notifyOn;
    setNotifyOn(next);
    try { localStorage.setItem(NOTIFY_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (next) void ensureNotifyPermission();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError(null);
    // First send is a user gesture: request desktop permission once if notifications are on.
    if (notifyOnRef.current && !permAskedRef.current) { permAskedRef.current = true; void ensureNotifyPermission(); }
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
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        <span>Trò chuyện{unread > 0 ? ` (${unread})` : ""}</span>
        <button type="button" onClick={toggleNotify} title={notifyOn ? "Tắt thông báo" : "Bật thông báo"}
          className="text-base leading-none">{notifyOn ? "🔔" : "🔕"}</button>
      </h3>
      <div ref={listRef} onScroll={onScroll}
        className="flex h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-gold-200 bg-cream/60 p-2 text-sm">
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
      {unread > 0 && (
        <button type="button" onClick={jumpToBottom}
          className="mt-1 w-full rounded-lg bg-burgundy/90 py-1 text-xs text-cream">↓ {unread} tin mới</button>
      )}
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
(Replaces the v5 always-scroll effect. Key behaviors: initial history is seeded as "seen" with no notification; new other-authored messages while away → unread++ + ting + desktop popup (when tab hidden + permission); auto-scroll only when at bottom or you sent it; bell toggles sound+desktop and persists, requesting permission on a gesture; the pill jumps to bottom and clears unread.)

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds).

- [ ] **Step 3: Manual smoke (document, do not block on it):** two browsers/accounts in one room — sending from B while A is scrolled up shows "(N)" + pill + plays a ting; backgrounding A's tab and sending from B shows a desktop popup once permission is granted (bell on → prompt). A's own messages never notify and always scroll A to the bottom.

- [ ] **Step 4: Commit**

```bash
git add components/room/ChatPanel.tsx
git commit -m "feat: Zalo-style chat notifications — unread badge, pill, ting, desktop popup"
```

---

# Phase 3 — Docs & gate

## Task 5: README v6 notes + full gate

**Files:** Modify `README.md`

**Interfaces:** none.

- [ ] **Step 1: Append a `## v6: Queue Loading & Chat Notifications` section to `README.md`** (match the v3–v5 heading style) noting: **no migration / no config** — purely client UX. New: queue actions (delete / bump / reorder) show a per-row spinner while saving; chat shows an unread badge + "↓ N tin mới" pill, plays a "ting", and (when you grant permission) a desktop popup while the tab is backgrounded — toggle with the 🔔 bell (default on); only other people's messages notify. Desktop popups need a secure context (HTTPS / localhost).

- [ ] **Step 2: Full gate** — `npm test` (unit pass incl. `tests/unit/chat-notify.test.ts`; integration suites skip without DB env) + `npm run build` (succeeds; routes unchanged). Confirm `npx tsc --noEmit` clean and `npm run lint` 0 errors. Capture summaries.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v6 notes — queue loading + chat notifications"
```

---

## Self-review (completed during planning)
- **Spec coverage:** A queue loading (busyId spinner/disable for delete+bump+reorder, inline error) → Task 1 ✓; B newFromOthers pure helper + test → Task 2 ✓; sound + desktop primitives (SSR-safe, fail-soft) → Task 3 ✓; ChatPanel unread badge + pill + auto-scroll fix + away detection + bell toggle (default ON, gesture permission) + sound + desktop → Task 4 ✓; docs/gate → Task 5 ✓. No DB/migration (none needed) ✓.
- **Placeholder scan:** all code complete; commands have expected outcomes; the fixture/test bodies are concrete.
- **Type consistency:** `ChatMessage` shape (`id, room_id, account_id: string|null, username, body, created_at`) matches `lib/chat.ts` and is used by `newFromOthers` + the test factory; `newFromOthers(messages, seen, selfAccountId)` signature matches Task 2 definition and Task 4 call; `playTing()` / `notifySupported()` / `ensureNotifyPermission()` / `notifyDesktop(title, body)` signatures match Task 3 defs and Task 4 calls; `useChat` consumption + `canDelete`/`remove`/`send` unchanged from v5; `Queue` props/signature unchanged.
- **Known/accepted:** sound, `Notification`, scroll/visibility and the permission flow are manual-tested (browser-only APIs); unread is session-only (resets on reload); desktop popups only fire when the tab is hidden + permission granted + secure context; default-ON requests permission on the first chat gesture (send or bell), never on load.
