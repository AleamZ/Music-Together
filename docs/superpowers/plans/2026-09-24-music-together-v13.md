# Music Together v13 — Game Mode ("Sảnh phát nhạc") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-user 2D pixel "game mode" view of a music room — a riverside hammock café where every online member is a layered pixel character that can walk around — while the room's music, queue, chat and roles keep working exactly as today.

**Architecture:** A new `RoomSession` owns the room's playback hooks and switches between the existing `RoomShell` and a lazy-loaded `GameShell`. The game is a custom Canvas 2D engine (`lib/game/engine.ts`) fed by pure, unit-tested modules (art grids, movement, A* pathfinding, actor simulation, protocol). Movement is synced with an event-driven Supabase Realtime **Broadcast** protocol (`game:{roomId}`); Presence carries each member's view mode. Characters are stored in Postgres (`characters`, `item_catalog`, RPC `save_character`).

**Tech Stack:** Next.js 16.2.9 (App Router, client components, `next/dynamic`), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom, pnpm 11.

**Spec:** `docs/superpowers/specs/2026-09-24-music-together-v13-game-mode-design.md` (read it before starting any task).

## Global Constraints

- Work on branch `feat/v13-game-mode` (already created, in place — no worktree). Commit after every task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Package manager: **pnpm** (`pnpm test`, `pnpm lint`). Typecheck: `npx tsc --noEmit`.
- Baseline before v13: `pnpm test` → 24 files passed / 7 skipped; `npx tsc --noEmit` clean; `pnpm lint` has **21 pre-existing errors** in 14 files — 4 of them in `lib/reactions.ts`, which Task 16 rewrites, so 17 remain after v13. Every file you create or modify must lint clean: run `npx eslint <your files>`.
- Before using any Next.js API read the matching guide in `node_modules/next/dist/docs/` (`AGENTS.md`). `next/dynamic` with `{ ssr: false }` is only allowed inside Client Components (`node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md`).
- React hook lint rules (eslint-plugin-react-hooks 7): no `ref.current` reads/writes during render, no synchronous `setState` directly in an effect body (callbacks/async continuations are fine), no `Date.now()` / `Math.random()` during render.
- Pure logic lives in `lib/` with Vitest tests in `tests/unit/`. Browser-only code (canvas, `document`, `window`) must never be imported by a pure module.
- Supabase Realtime free plan: 100 msgs/s per project (sent + delivered), 2 M msgs/month, **5 presence calls per client per 30 s**. Game traffic per client ≤ 3 msgs/s (send gate), zero while idle.
- All art is original and drawn in code (string grids). Never copy images from *Miệt Thương Mến* or any other game. The approved visual reference is `.superpowers/brainstorm/1961-1790232701/content/style-mientay-v2.html`.
- Sprite size 24 × 48 px, anchored at the feet (drawn at `x-12, y-46`). Map `hall` = 640 × 400 px, collision cell 8 px, walk speed 70 px/s, feet collision box 6 × 4 px (`x-3…x+3`, `y-3…y+1`).
- UI copy is Vietnamese (strings are given in the tasks — use them verbatim).
- New SQL is additive and re-runnable (`create … if not exists`, `create or replace`, `on conflict … do update`).

## File map

| File | Responsibility |
|---|---|
| `lib/view-mode.ts` | `ViewMode`, `parseViewMode`, storage key |
| `hooks/useViewMode.ts` | per-browser classic/game preference |
| `lib/room-derived.ts` | queue/rules/DJ derivation shared by both shells |
| `lib/presence-modes.ts` | Presence state → `{accountId, name, mode}[]` |
| `lib/realtime.ts` (mod) | `trackPresence` returns a handle with `setMode` |
| `hooks/useRoom.ts` (mod) | exposes `presence` + `setPresenceMode` |
| `components/room/RoomSession.tsx` | owns playback + sponsorblock + view mode; picks the shell |
| `components/room/RoomShell.tsx` (mod) | receives derived state + playback as props |
| `components/room/Header.tsx` (mod) | 🎮 Chế độ game button |
| `app/room/[code]/RoomClient.tsx` (mod) | renders `RoomSession` |
| `supabase/migrations/0011_v13_game_mode.sql` | `item_catalog`, `characters`, `save_character` |
| `lib/game/types.ts` | `Facing`, `Vec`, `Look`, option lists |
| `lib/game/character.ts` | look defaults/validation + DB calls |
| `lib/game/art/{layers,palettes,items,body,hair,hats}.ts` | sprite grids and colour data |
| `lib/game/art/compose.ts` | pure look → colour matrix |
| `lib/game/art/raster.ts` | browser: matrix → canvas, frame cache, portrait |
| `lib/game/maps/types.ts` | `GameMap`, `Rect`, `Spot`, `Interactable`, `PropPlacement` |
| `lib/game/movement.ts` | collision + keyboard movement |
| `lib/game/pathfinding.ts` | A* + path smoothing |
| `lib/game/scene.ts` | view scale, camera, hit tests, overlay stacking (pure) |
| `lib/game/maps/hall.ts` | hall layout + collision grid |
| `lib/game/maps/hall-art.ts` | browser: procedural scene painters |
| `lib/game/actor.ts` | local/remote actor simulation |
| `lib/game/net/protocol.ts` | message types, validation, send gate |
| `lib/game/net/channel.ts` | browser: Broadcast channel wrapper |
| `lib/channel-lifecycle.ts` | re-join a Realtime topic only after its previous leave finished |
| `lib/game/seating.ts` | classic members → seats |
| `lib/game/text.ts` | chat bubble wrapping |
| `lib/game/social.ts` | presence → roster (seats, badges, looks), fresh chat bubbles |
| `lib/game/engine.ts` | browser: loop, input, camera, render, overlays |
| `hooks/useLooks.ts`, `hooks/useMyCharacter.ts` | character data for the shell |
| `components/game/*` | `GameShell`, `GameCanvas`, `Parchment`, `SpritePreview`, `CharacterEditor`, `HudNowPlaying`, `HudChatBar`, `QueuePanel` |
| `lib/reactions.ts`, `hooks/useReactions.ts` (mod) | optional `accountId` + `onEvent` for game overlays; safe re-join |
| `app/layout.tsx`, `app/globals.css` (mod) | VT323 font, `.game-ui` tokens, parchment classes |
| `README.md` (mod) | v13 section + realtime budget |

---

### Task 1: View mode + shared room derivation

**Files:**
- Create: `lib/view-mode.ts`, `hooks/useViewMode.ts`, `lib/room-derived.ts`
- Test: `tests/unit/view-mode.test.ts`, `tests/unit/room-derived.test.ts`

**Interfaces:**
- Produces: `type ViewMode = "classic" | "game"`, `VIEW_MODE_KEY`, `parseViewMode(raw)`, `useViewMode(): { mode; setMode }`, `interface RoomDerived`, `deriveRoom(s, accountId, role, onlineIds): RoomDerived`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/view-mode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseViewMode, VIEW_MODE_KEY } from "@/lib/view-mode";

describe("parseViewMode", () => {
  it("returns game only for the exact stored value", () => {
    expect(parseViewMode("game")).toBe("game");
  });
  it("falls back to classic for anything else", () => {
    for (const v of [null, undefined, "", "GAME", "classic", "x"]) expect(parseViewMode(v)).toBe("classic");
  });
  it("uses a namespaced storage key", () => {
    expect(VIEW_MODE_KEY).toBe("music-together:view-mode");
  });
});
```

`tests/unit/room-derived.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { deriveRoom } from "@/lib/room-derived";
import type { Member, QueueItem, Room } from "@/lib/supabase";

const room: Room = {
  id: "r1", code: "ABC", name: "R", play_mode: "order",
  admin_member_id: "m-admin", dj_member_id: "m-dj", current_item_id: "q1",
  is_playing: true, started_at: null, paused_elapsed_ms: 0, created_at: "",
  max_duration_seconds: 600, require_approval: true, banned_keywords: ["x"], max_orders_per_member: 5,
  auto_replay_history: false,
};
const q = (id: string, status: "approved" | "pending", by: string | null): QueueItem => ({
  id, room_id: "r1", youtube_video_id: id, title: id, thumbnail_url: null, duration_seconds: 100,
  added_by_account_id: by, added_by_name: "n", position: 1, created_at: "", status,
});
const members: Member[] = [
  { id: "m-admin", room_id: "r1", account_id: "a-admin", joined_at: "" },
  { id: "m-dj", room_id: "r1", account_id: "a-dj", joined_at: "" },
  { id: "m-me", room_id: "r1", account_id: "a-me", joined_at: "" },
];
const queue = [q("q1", "approved", "a-me"), q("q2", "approved", "a-me"), q("q3", "pending", "a-me"), q("q4", "pending", "a-dj")];
const listener = { isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false };

describe("deriveRoom", () => {
  it("splits the queue and finds the current item", () => {
    const d = deriveRoom({ room, members, queue }, "a-me", listener, ["a-dj"]);
    expect(d.current?.id).toBe("q1");
    expect(d.approved.map((i) => i.id)).toEqual(["q1", "q2"]);
    expect(d.pending.map((i) => i.id)).toEqual(["q3", "q4"]);
    expect(d.myPending.map((i) => i.id)).toEqual(["q3"]);
  });
  it("copies the rules and computes approval + order limit for a listener", () => {
    const d = deriveRoom({ room, members, queue }, "a-me", listener, []);
    expect(d.rules).toEqual({ max_duration_seconds: 600, banned_keywords: ["x"], max_orders_per_member: 5 });
    expect(d.willPend).toBe(true);
    expect(d.orderLimit).toEqual({ mine: 2, exempt: false }); // q2 + q3 (q1 is playing)
  });
  it("exempts queue managers", () => {
    const d = deriveRoom({ room, members, queue }, "a-me", { ...listener, canManageQueue: true }, []);
    expect(d.willPend).toBe(false);
    expect(d.orderLimit.exempt).toBe(true);
  });
  it("maps the DJ member to an account and checks presence", () => {
    expect(deriveRoom({ room, members, queue }, "a-me", listener, ["a-dj"]).djAccountId).toBe("a-dj");
    expect(deriveRoom({ room, members, queue }, "a-me", listener, ["a-dj"]).djOnline).toBe(true);
    expect(deriveRoom({ room, members, queue }, "a-me", listener, []).djOnline).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/view-mode.test.ts tests/unit/room-derived.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/view-mode"` / `"@/lib/room-derived"`.

- [ ] **Step 3: Implement**

`lib/view-mode.ts`:

```ts
export type ViewMode = "classic" | "game";

/** Per-browser preference for how a room is shown (v13). */
export const VIEW_MODE_KEY = "music-together:view-mode";

/** Stored value → mode; anything unknown (or missing) falls back to the classic UI. */
export function parseViewMode(raw: string | null | undefined): ViewMode {
  return raw === "game" ? "game" : "classic";
}
```

`hooks/useViewMode.ts` (RoomSession only renders on the client after auth + room load, so reading storage in the lazy initializer causes no hydration mismatch):

```ts
"use client";

import { useCallback, useState } from "react";
import { parseViewMode, VIEW_MODE_KEY, type ViewMode } from "@/lib/view-mode";

function readStoredMode(): ViewMode {
  if (typeof window === "undefined") return "classic";
  try {
    return parseViewMode(window.localStorage.getItem(VIEW_MODE_KEY));
  } catch {
    return "classic";
  }
}

export function useViewMode(): { mode: ViewMode; setMode: (m: ViewMode) => void } {
  const [mode, setModeState] = useState<ViewMode>(readStoredMode);
  const setMode = useCallback((m: ViewMode) => {
    setModeState(m);
    try { window.localStorage.setItem(VIEW_MODE_KEY, m); } catch { /* storage blocked: keep in memory */ }
  }, []);
  return { mode, setMode };
}
```

`lib/room-derived.ts` (logic moved verbatim from `components/room/RoomShell.tsx` lines 29–53):

```ts
import type { Member, QueueItem, Room } from "@/lib/supabase";
import type { RoleFlags } from "@/lib/roles";
import { countMyOrders, type RoomRules } from "@/lib/queue-rules";

export interface RoomDerived {
  current: QueueItem | null;
  /** Approved rows = the play queue. */
  approved: QueueItem[];
  /** Rows awaiting Admin/DJ approval. */
  pending: QueueItem[];
  myPending: QueueItem[];
  rules: RoomRules;
  willPend: boolean;
  /** Per-member order limit (v11): my waiting rows, excluding the one playing. Admin/DJ exempt. */
  orderLimit: { mine: number; exempt: boolean };
  djAccountId: string | null;
  djOnline: boolean;
}

/** Everything both room shells derive from the realtime state, so classic and game mode stay identical. */
export function deriveRoom(
  s: { room: Room; members: Member[]; queue: QueueItem[] },
  accountId: string,
  role: RoleFlags,
  onlineIds: string[],
): RoomDerived {
  const { room, members, queue } = s;
  const current = queue.find((q) => q.id === room.current_item_id) ?? null;
  const approved = queue.filter((q) => q.status === "approved");
  const pending = queue.filter((q) => q.status === "pending");
  const myPending = pending.filter((q) => q.added_by_account_id === accountId);
  const rules: RoomRules = {
    max_duration_seconds: room.max_duration_seconds,
    banned_keywords: room.banned_keywords,
    max_orders_per_member: room.max_orders_per_member,
  };
  const willPend = room.require_approval && !role.canManageQueue;
  const orderLimit = { mine: countMyOrders(queue, accountId, room.current_item_id), exempt: role.canManageQueue };
  // onlineIds are ACCOUNT ids; dj_member_id is a MEMBER id → map it first.
  const djAccountId = members.find((m) => m.id === room.dj_member_id)?.account_id ?? null;
  const djOnline = !!djAccountId && onlineIds.includes(djAccountId);
  return { current, approved, pending, myPending, rules, willPend, orderLimit, djAccountId, djOnline };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/view-mode.test.ts tests/unit/room-derived.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/view-mode.ts hooks/useViewMode.ts lib/room-derived.ts tests/unit/view-mode.test.ts tests/unit/room-derived.test.ts
git add lib/view-mode.ts hooks/useViewMode.ts lib/room-derived.ts tests/unit/view-mode.test.ts tests/unit/room-derived.test.ts
git commit -m "feat(v13): view-mode preference + shared room derivation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Presence carries the view mode

**Files:**
- Create: `lib/presence-modes.ts`
- Modify: `lib/realtime.ts` (replace `trackPresence`, lines 43–61), `hooks/useRoom.ts`
- Test: `tests/unit/presence-mode.test.ts`

**Interfaces:**
- Produces: `type PresenceMode = "classic" | "game"`, `interface PresenceEntry { accountId; name; mode }`, `aggregatePresenceModes(state)`, `interface PresenceHandle { unsubscribe(); setMode(mode) }`, `trackPresence(roomId, me: { memberId; name; mode }, onChange: (entries) => void): PresenceHandle`; `RoomView` gains `presence: PresenceEntry[]` and `setPresenceMode: (m: PresenceMode) => void` (stable identity). `onlineIds` keeps its meaning (account ids).

- [ ] **Step 1: Write the failing test**

`tests/unit/presence-mode.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { aggregatePresenceModes } from "@/lib/presence-modes";

describe("aggregatePresenceModes", () => {
  it("returns one entry per account, sorted by account id", () => {
    const out = aggregatePresenceModes({
      b: [{ name: "Bee", mode: "classic" }],
      a: [{ name: "Ann", mode: "game" }],
    });
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game" },
      { accountId: "b", name: "Bee", mode: "classic" },
    ]);
  });
  it("treats an account as game when ANY tab is in game mode", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann", mode: "classic" }, { name: "Ann", mode: "game" }] });
    expect(out[0].mode).toBe("game");
  });
  it("defaults to classic for old clients without a mode, and skips empty keys", () => {
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic" }]);
  });
  it("uses an empty name when no tab reports one", () => {
    expect(aggregatePresenceModes({ a: [{ mode: "game" }] })[0].name).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/presence-mode.test.ts`
Expected: FAIL — cannot resolve `@/lib/presence-modes`.

- [ ] **Step 3: Implement**

`lib/presence-modes.ts`:

```ts
export type PresenceMode = "classic" | "game";
export interface PresenceMeta { name?: unknown; online_at?: unknown; mode?: unknown }
export interface PresenceEntry { accountId: string; name: string; mode: PresenceMode }

/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode. Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
  const out: PresenceEntry[] = [];
  for (const [accountId, metas] of Object.entries(state)) {
    if (!metas || metas.length === 0) continue;
    const name = metas.map((m) => m.name).find((n): n is string => typeof n === "string" && n.length > 0) ?? "";
    const mode: PresenceMode = metas.some((m) => m.mode === "game") ? "game" : "classic";
    out.push({ accountId, name, mode });
  }
  return out.sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}
```

In `lib/realtime.ts` add the import and replace the whole `trackPresence` function:

```ts
import { aggregatePresenceModes, type PresenceEntry, type PresenceMeta, type PresenceMode } from "@/lib/presence-modes";

export interface PresenceHandle { unsubscribe: () => void; setMode: (mode: PresenceMode) => void }

/** Realtime Presence keyed by account id. The payload also carries the member's view mode (v13). */
export function trackPresence(
  roomId: string,
  me: { memberId: string; name: string; mode: PresenceMode },
  onChange: (entries: PresenceEntry[]) => void,
): PresenceHandle {
  const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { key: me.memberId } } });
  let mode = me.mode;
  let subscribed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const emit = () => onChange(aggregatePresenceModes(channel.presenceState() as unknown as Record<string, PresenceMeta[]>));
  const track = () => channel.track({ name: me.name, online_at: new Date().toISOString(), mode });
  channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") { subscribed = true; await track(); }
      else subscribed = false;
    });
  return {
    unsubscribe: () => { if (timer) clearTimeout(timer); void supabase.removeChannel(channel); },
    setMode: (next) => {
      if (next === mode) return;
      mode = next;
      if (timer) clearTimeout(timer);
      // Presence allows 5 calls per client per 30 s → debounce rapid toggles into one track().
      timer = setTimeout(() => { timer = null; if (subscribed) void track(); }, 1000);
    },
  };
}
```

In `hooks/useRoom.ts`:

1. Imports: `import { useCallback, useEffect, useRef, useState } from "react";`, `import { subscribeRoom, trackPresence, type PresenceHandle, type RoomState } from "@/lib/realtime";`, `import type { PresenceEntry, PresenceMode } from "@/lib/presence-modes";`.
2. `RoomView` gains two fields:

```ts
export interface RoomView {
  loading: boolean; state: RoomState; onlineIds: string[];
  presence: PresenceEntry[]; setPresenceMode: (m: PresenceMode) => void;
  token: string; accountId: string; username: string; myMemberId: string | null;
  role: RoleFlags; kicked: boolean;
}
```

3. Replace `const [onlineIds, setOnlineIds] = useState<string[]>([]);` with:

```ts
  const [presence, setPresence] = useState<PresenceEntry[]>([]);
  const presenceRef = useRef<PresenceHandle | null>(null);
  const modeRef = useRef<PresenceMode>("classic");
  const setPresenceMode = useCallback((m: PresenceMode) => {
    modeRef.current = m;
    presenceRef.current?.setMode(m);
  }, []);
```

4. Inside the effect replace `let unsubPresence: (() => void) | undefined;` with `let presenceHandle: PresenceHandle | undefined;`, the `trackPresence(...)` line with:

```ts
      if (account) {
        presenceHandle = trackPresence(roomId, { memberId: account.accountId, name: account.username, mode: modeRef.current }, setPresence);
        presenceRef.current = presenceHandle;
      }
```

and `unsubPresence?.();` in the cleanup with:

```ts
      presenceHandle?.unsubscribe();
      if (presenceRef.current === presenceHandle) presenceRef.current = null;
```

5. Before the `return`, derive `const onlineIds = presence.map((p) => p.accountId);` and return `{ loading, state, onlineIds, presence, setPresenceMode, token: token ?? "", accountId, username: account?.username ?? "", myMemberId, role, kicked }`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm vitest run tests/unit/presence-mode.test.ts && npx tsc --noEmit`
Expected: PASS; tsc exits 0 (`MemberList`/`RoomShell` still receive `onlineIds: string[]`).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/presence-modes.ts lib/realtime.ts hooks/useRoom.ts tests/unit/presence-mode.test.ts
git add lib/presence-modes.ts lib/realtime.ts hooks/useRoom.ts tests/unit/presence-mode.test.ts
git commit -m "feat(v13): presence publishes each member's view mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: RoomSession — one player across view switches

**Files:**
- Create: `components/room/RoomSession.tsx`, `components/game/GameShell.tsx` (temporary stub, replaced in Task 16)
- Modify: `components/room/RoomShell.tsx`, `components/room/Header.tsx`, `app/room/[code]/RoomClient.tsx`

**Interfaces:**
- Consumes: `useViewMode` (Task 1), `deriveRoom`/`RoomDerived` (Task 1), `RoomView.setPresenceMode` (Task 2), `usePlayback` → `PlaybackController` (`hooks/usePlayback.ts`), `useSponsorBlock` → `UseSponsorBlockResult` (`hooks/useSponsorBlock.ts`).
- Produces: `interface GameShellProps { view: RoomView; derived: RoomDerived; playback: PlaybackController; sponsorBlock: UseSponsorBlockResult; onExitGame: () => void }` (exported from `components/game/GameShell.tsx`, kept stable for Task 16). `RoomShell` props become `{ view, derived, playback, sponsorBlock, onEnterGame }`. `Header` gains optional `onEnterGame?: () => void`.

- [ ] **Step 1: Create the GameShell stub**

`components/game/GameShell.tsx`:

```tsx
"use client";

import type { RoomView } from "@/hooks/useRoom";
import type { PlaybackController } from "@/hooks/usePlayback";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import type { RoomDerived } from "@/lib/room-derived";

export interface GameShellProps {
  view: RoomView;
  derived: RoomDerived;
  playback: PlaybackController;
  sponsorBlock: UseSponsorBlockResult;
  onExitGame: () => void;
}

/** Temporary stub (Task 3) — replaced by the real game shell in Task 16. */
export default function GameShell({ derived, playback, onExitGame }: GameShellProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-playfair text-2xl text-burgundy">🎮 Chế độ game đang được xây dựng…</p>
      <p className="text-sm text-ink/70">Đang phát: {derived.current?.title ?? "—"}</p>
      {!playback.unlocked && (
        <button type="button" onClick={playback.unlock} className="rounded-full bg-burgundy px-4 py-1.5 text-sm text-cream">
          🔈 Bật âm thanh
        </button>
      )}
      <button type="button" onClick={onExitGame} className="rounded-lg border border-gold bg-cream px-4 py-2 text-burgundy">
        🖥️ Giao diện cũ
      </button>
    </main>
  );
}
```

- [ ] **Step 2: Create RoomSession**

`components/room/RoomSession.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import type { RoomView } from "@/hooks/useRoom";
import { useViewMode } from "@/hooks/useViewMode";
import { usePlayback } from "@/hooks/usePlayback";
import { useSponsorBlock } from "@/hooks/useSponsorBlock";
import { deriveRoom } from "@/lib/room-derived";
import BrandSpinner from "@/components/brand/BrandSpinner";
import RoomShell from "./RoomShell";

// Game code is only downloaded by members who switch to game mode.
const GameShell = dynamic(() => import("@/components/game/GameShell"), {
  ssr: false,
  loading: () => <BrandSpinner label="Đang vào thế giới…" />,
});

/** Owns everything that must survive a classic ↔ game switch — above all the hidden YouTube player. */
export default function RoomSession({ view }: { view: RoomView }) {
  const { mode, setMode } = useViewMode();
  const room = view.state.room!;
  const derived = deriveRoom({ room, members: view.state.members, queue: view.state.queue }, view.accountId, view.role, view.onlineIds);
  const sponsorBlock = useSponsorBlock(derived.current?.youtube_video_id);
  const playback = usePlayback({
    room,
    current: derived.current,
    isDj: view.role.isDj,
    queueLen: derived.approved.length,
    roomId: room.id,
    token: view.token,
    sponsorSegments: sponsorBlock.segments,
    sponsorBlockEnabled: sponsorBlock.enabled,
    onSponsorSkipped: sponsorBlock.triggerSkipToast,
  });

  const { setPresenceMode } = view;
  useEffect(() => { setPresenceMode(mode); }, [mode, setPresenceMode]);

  if (mode === "game") {
    return <GameShell view={view} derived={derived} playback={playback} sponsorBlock={sponsorBlock} onExitGame={() => setMode("classic")} />;
  }
  return <RoomShell view={view} derived={derived} playback={playback} sponsorBlock={sponsorBlock} onEnterGame={() => setMode("game")} />;
}
```

- [ ] **Step 3: Make RoomShell take the lifted state as props**

In `components/room/RoomShell.tsx`:

1. Remove the imports of `usePlayback`, `useSponsorBlock` and `countMyOrders`; add:

```ts
import type { PlaybackController } from "@/hooks/usePlayback";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import type { RoomDerived } from "@/lib/room-derived";
```

2. Replace the signature and everything from `const { state, role, … } = view;` down to (and including) the `const dj = usePlayback({ … });` call with:

```tsx
export default function RoomShell({ view, derived, playback: dj, sponsorBlock, onEnterGame }: {
  view: RoomView;
  derived: RoomDerived;
  playback: PlaybackController;
  sponsorBlock: UseSponsorBlockResult;
  onEnterGame: () => void;
}) {
  const { state, role, onlineIds, token, myMemberId, accountId, username } = view;
  const room = state.room!;
  const { current, approved, pending, myPending, rules, willPend, orderLimit, djOnline } = derived;
```

   The rest of the component keeps using `current`, `approved`, `pending`, `myPending`, `rules`, `willPend`, `orderLimit`, `djOnline`, `dj.*`, `sponsorBlock.*` unchanged.
3. Pass the new prop to the header: `<Header … current={current} onEnterGame={onEnterGame} />`.

- [ ] **Step 4: Header button**

In `components/room/Header.tsx` add `onEnterGame?: () => void;` to the props type and destructuring, and insert right before `<ThemeToggle />`:

```tsx
        {onEnterGame && (
          <button
            type="button"
            onClick={onEnterGame}
            className="flex items-center gap-1.5 rounded-lg border border-gold bg-cream px-3 py-1 text-sm font-medium text-burgundy shadow-xs transition hover:bg-gold-200/30 active:scale-95"
            title="Chuyển sang chế độ game 2D"
          >
            <span>🎮</span>
            <span>Chế độ game</span>
          </button>
        )}
```

- [ ] **Step 5: Render RoomSession**

In `app/room/[code]/RoomClient.tsx` replace `import RoomShell from "@/components/room/RoomShell";` with `import RoomSession from "@/components/room/RoomSession";` and `return <RoomShell view={view} />;` with `return <RoomSession view={view} />;`.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && pnpm test && npx eslint components/room/RoomSession.tsx components/room/RoomShell.tsx components/room/Header.tsx components/game/GameShell.tsx "app/room/[code]/RoomClient.tsx"`
Expected: tsc 0 errors, all suites pass, eslint clean.
Manual (preview server `dev`, the owner logs in): open a room, press **🎮 Chế độ game** → stub screen, music keeps playing without a new "Bật âm thanh"; **🖥️ Giao diện cũ** → classic UI, still playing; reload keeps the last mode.

- [ ] **Step 7: Commit**

```bash
git add components/room/RoomSession.tsx components/game/GameShell.tsx components/room/RoomShell.tsx components/room/Header.tsx "app/room/[code]/RoomClient.tsx"
git commit -m "feat(v13): RoomSession keeps one player across classic/game switch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Database — characters + starter catalog

**Files:**
- Create: `supabase/migrations/0011_v13_game_mode.sql`
- Test: `tests/integration/v13.test.ts` (runs only with `SUPABASE_TEST_URL` + `SUPABASE_TEST_ANON_KEY`)

**Interfaces:**
- Produces: table `public.item_catalog(id, slot, name, price, starter, sort_order)`, table `public.characters(account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, hand, pet, updated_at)`, RPC `save_character(p_session_token, p_skin, p_hair, p_hair_color, p_hat, p_top, p_bottom, p_shoes, p_neck) returns characters`. Error messages: `invalid session`, `invalid character option`, `item not available`.

- [ ] **Step 1: Write the integration test**

`tests/integration/v13.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v13 characters", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("ch"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const base = {
    p_skin: "warm", p_hair: "short", p_hair_color: "black", p_hat: "hat_nonla" as string | null,
    p_top: "top_baba_yellow" as string | null, p_bottom: "bottom_shorts_red", p_shoes: "shoes_dep_blue",
    p_neck: "neck_khanran" as string | null,
  };
  const save = (token: string, over: Partial<typeof base> = {}) =>
    db.rpc("save_character", { p_session_token: token, ...base, ...over });

  it("creates then updates the caller's character", async () => {
    const me = await reg();
    const first = await save(me.token);
    expect(first.error).toBeNull();
    const second = await save(me.token, { p_hat: null, p_top: "top_tee_blue", p_neck: null });
    expect(second.error).toBeNull();
    const { data } = await db.from("characters").select("*").eq("account_id", me.account_id).single();
    expect(data).toMatchObject({ skin: "warm", hat: null, top: "top_tee_blue", neck: null });
  });

  it("rejects unknown body options", async () => {
    const me = await reg();
    const { error } = await save(me.token, { p_hair: "mohawk" });
    expect(error?.message).toMatch(/invalid character option/);
  });

  it("rejects an item in the wrong slot and unknown items", async () => {
    const me = await reg();
    expect((await save(me.token, { p_hat: "top_baba_yellow" })).error?.message).toMatch(/item not available/);
    expect((await save(me.token, { p_top: "top_does_not_exist" })).error?.message).toMatch(/item not available/);
  });

  it("requires a top", async () => {
    const me = await reg();
    expect((await save(me.token, { p_top: null })).error?.message).toMatch(/item not available/);
  });

  it("rejects a bad session", async () => {
    expect((await save("not-a-token")).error?.message).toMatch(/invalid session/);
  });

  it("lets anyone read the catalog and characters", async () => {
    const { data: items } = await db.from("item_catalog").select("id").eq("starter", true);
    expect((items ?? []).length).toBeGreaterThanOrEqual(15);
  });
});
```

- [ ] **Step 2: Run it (skips without a test DB)**

Run: `pnpm vitest run tests/integration/v13.test.ts`
Expected: `6 skipped` (no `SUPABASE_TEST_URL`). If a test DB is configured, it FAILS before the migration exists.

- [ ] **Step 3: Write the migration**

`supabase/migrations/0011_v13_game_mode.sql`:

```sql
-- =========================================================
-- 0011_v13_game_mode.sql — v13: game-mode characters + starter item catalog.
-- ADDITIVE (no data drop) and re-runnable. Every function relies on `set search_path = public, extensions`.
-- =========================================================

-- ---------- A. Item catalog (public read) ----------
create table if not exists public.item_catalog (
  id text primary key,
  slot text not null check (slot in ('hat','top','bottom','shoes','neck','hand','pet')),
  name text not null,
  price integer not null default 0 check (price >= 0),
  starter boolean not null default false,
  sort_order integer not null default 0
);
alter table public.item_catalog enable row level security;
drop policy if exists item_catalog_select on public.item_catalog;
create policy item_catalog_select on public.item_catalog for select to anon using (true);

insert into public.item_catalog (id, slot, name, price, starter, sort_order) values
  ('hat_nonla',          'hat',    'Nón lá',             0, true, 10),
  ('hat_taibeo_green',   'hat',    'Mũ tai bèo xanh',    0, true, 20),
  ('top_baba_yellow',    'top',    'Áo bà ba vàng',      0, true, 10),
  ('top_baba_white',     'top',    'Áo bà ba trắng',     0, true, 20),
  ('top_baba_pink',      'top',    'Áo bà ba hồng',      0, true, 30),
  ('top_tee_blue',       'top',    'Áo thun xanh dương', 0, true, 40),
  ('top_tee_green',      'top',    'Áo thun xanh lá',    0, true, 50),
  ('bottom_shorts_red',  'bottom', 'Quần đùi đỏ',        0, true, 10),
  ('bottom_pants_black', 'bottom', 'Quần dài đen',       0, true, 20),
  ('bottom_jeans',       'bottom', 'Quần jean',          0, true, 30),
  ('shoes_dep_blue',     'shoes',  'Dép xanh',           0, true, 10),
  ('shoes_dep_brown',    'shoes',  'Dép nâu',            0, true, 20),
  ('shoes_dep_red',      'shoes',  'Dép đỏ',             0, true, 30),
  ('neck_khanran',       'neck',   'Khăn rằn',           0, true, 10),
  ('neck_khanran_red',   'neck',   'Khăn rằn đỏ',        0, true, 20)
on conflict (id) do update set
  slot = excluded.slot, name = excluded.name, price = excluded.price,
  starter = excluded.starter, sort_order = excluded.sort_order;

-- ---------- B. Characters: one per account (public read, like accounts.username) ----------
create table if not exists public.characters (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  skin text not null,
  hair text not null,
  hair_color text not null,
  hat text references public.item_catalog(id),
  top text not null references public.item_catalog(id),
  bottom text not null references public.item_catalog(id),
  shoes text not null references public.item_catalog(id),
  neck text references public.item_catalog(id),
  hand text references public.item_catalog(id),
  pet text references public.item_catalog(id),
  updated_at timestamptz not null default now()
);
alter table public.characters enable row level security;
drop policy if exists characters_select on public.characters;
create policy characters_select on public.characters for select to anon using (true);

-- ---------- C. Helper: may this item be worn in this slot? (v13: starter items only; v14 adds "or owned") ----------
create or replace function public._item_ok(p_item text, p_slot text, p_required boolean)
returns boolean language plpgsql stable security definer set search_path = public, extensions
as $$
begin
  if p_item is null then return not p_required; end if;
  return exists (select 1 from public.item_catalog c where c.id = p_item and c.slot = p_slot and c.starter);
end; $$;
revoke all on function public._item_ok(text, text, boolean) from public, anon, authenticated;

-- ---------- D. RPC: save_character (create or replace my look) ----------
create or replace function public.save_character(
  p_session_token text, p_skin text, p_hair text, p_hair_color text,
  p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text
) returns public.characters
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_row public.characters;
begin
  v_account := public._auth_account(p_session_token);
  if p_skin is null or p_skin not in ('light','warm','tan','deep')
     or p_hair is null or p_hair not in ('short','bob','long')
     or p_hair_color is null or p_hair_color not in ('black','darkbrown','brown','pink') then
    raise exception 'invalid character option' using errcode = '22023';
  end if;
  if not public._item_ok(p_hat, 'hat', false)
     or not public._item_ok(p_top, 'top', true)
     or not public._item_ok(p_bottom, 'bottom', true)
     or not public._item_ok(p_shoes, 'shoes', true)
     or not public._item_ok(p_neck, 'neck', false) then
    raise exception 'item not available' using errcode = '22023';
  end if;
  insert into public.characters as c (account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck, updated_at)
  values (v_account, p_skin, p_hair, p_hair_color, p_hat, p_top, p_bottom, p_shoes, p_neck, now())
  on conflict (account_id) do update set
    skin = excluded.skin, hair = excluded.hair, hair_color = excluded.hair_color,
    hat = excluded.hat, top = excluded.top, bottom = excluded.bottom, shoes = excluded.shoes,
    neck = excluded.neck, updated_at = now()
  returning c.* into v_row;
  return v_row;
end; $$;
```

- [ ] **Step 4: Validate on a throwaway local PostgreSQL 18 cluster**

PostgreSQL 18 is installed at `C:\Program Files\PostgreSQL\18` (its service password is unknown — do not touch it). Use Git Bash; `$SCRATCH` = the session scratchpad directory.

```bash
PG="/c/Program Files/PostgreSQL/18/bin"; D="$SCRATCH/pg-v13"
"$PG/initdb" -D "$D" -U postgres --auth=trust -E UTF8 >/dev/null
"$PG/pg_ctl" -D "$D" -o "-p 5499" -l "$D/log.txt" start
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -c "create schema extensions; create role anon nologin; create role authenticated nologin; create publication supabase_realtime;"
for f in supabase/migrations/00{04,05,06,07,08,09,10,11}_*.sql; do "$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f "$f" || break; done
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/migrations/0011_v13_game_mode.sql   # re-run: must be idempotent
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 <<'SQL'
select token from public.register('smoke_v13', 'pw123456') \gset
select skin, top from public.save_character(:'token', 'warm', 'short', 'black', 'hat_nonla', 'top_baba_yellow', 'bottom_shorts_red', 'shoes_dep_blue', null);
select skin, top from public.save_character(:'token', 'deep', 'long', 'pink', null, 'top_tee_blue', 'bottom_jeans', 'shoes_dep_red', 'neck_khanran_red');
do $$ begin perform public.save_character((select 'x'), 'warm','short','black',null,'top_tee_blue','bottom_jeans','shoes_dep_red',null); raise exception 'expected invalid session'; exception when others then if sqlerrm <> 'invalid session' then raise; end if; end $$;
select count(*) as starters from public.item_catalog where starter;
SQL
"$PG/pg_ctl" -D "$D" stop
```

Expected: every migration applies; the second run of 0011 succeeds; the two `save_character` calls return `warm | top_baba_yellow` then `deep | top_tee_blue`; `starters = 15`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0011_v13_game_mode.sql tests/integration/v13.test.ts
git commit -m "feat(v13): characters + starter item catalog + save_character RPC

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Game types + character data layer

**Files:**
- Create: `lib/game/types.ts`, `lib/game/character.ts`
- Test: `tests/unit/game-look.test.ts`

**Interfaces:**
- Consumes: `supabase` (`lib/supabase.ts`); DB objects from Task 4.
- Produces:
  - `types.ts`: `Facing`, `Vec`, `ItemSlot`, `SkinTone`, `HairStyle`, `HairColor`, `Look`, `SKIN_TONES`, `HAIR_STYLES`, `HAIR_COLORS`.
  - `character.ts`: `CatalogItem`, `CharacterRow`, `DEFAULT_LOOK`, `lookFromRow(row)`, `type LookProblem = "option" | "slot" | "missing"`, `validateLook(look, catalog): LookProblem | null`, `fetchCatalog()`, `fetchCharacters(ids): Promise<Map<string, Look>>`, `saveCharacter(token, look): Promise<Look>`, `characterErrorMessage(err): string`.

- [ ] **Step 1: Write the failing test**

`tests/unit/game-look.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_LOOK, lookFromRow, validateLook, characterErrorMessage, type CatalogItem } from "@/lib/game/character";

const item = (id: string, slot: CatalogItem["slot"], starter = true): CatalogItem => ({ id, slot, name: id, price: 0, starter, sort_order: 0 });
const catalog: CatalogItem[] = [
  item("hat_nonla", "hat"), item("top_baba_yellow", "top"), item("top_tee_blue", "top"),
  item("bottom_shorts_red", "bottom"), item("shoes_dep_blue", "shoes"), item("neck_khanran", "neck"),
  item("top_gold", "top", false),
];

describe("validateLook", () => {
  it("accepts the default look", () => {
    expect(validateLook(DEFAULT_LOOK, catalog)).toBeNull();
  });
  it("allows no hat and no scarf", () => {
    expect(validateLook({ ...DEFAULT_LOOK, hat: null, neck: null }, catalog)).toBeNull();
  });
  it("rejects unknown body options", () => {
    expect(validateLook({ ...DEFAULT_LOOK, hair: "mohawk" as never }, catalog)).toBe("option");
    expect(validateLook({ ...DEFAULT_LOOK, skin: "green" as never }, catalog)).toBe("option");
  });
  it("rejects wrong-slot, unknown and non-starter items", () => {
    expect(validateLook({ ...DEFAULT_LOOK, hat: "top_tee_blue" }, catalog)).toBe("slot");
    expect(validateLook({ ...DEFAULT_LOOK, top: "nope" }, catalog)).toBe("slot");
    expect(validateLook({ ...DEFAULT_LOOK, top: "top_gold" }, catalog)).toBe("slot");
  });
  it("requires top, bottom and shoes", () => {
    expect(validateLook({ ...DEFAULT_LOOK, top: null as never }, catalog)).toBe("missing");
  });
});

describe("lookFromRow", () => {
  it("maps snake_case columns", () => {
    expect(lookFromRow({ account_id: "a", skin: "tan", hair: "bob", hair_color: "pink", hat: null, top: "t", bottom: "b", shoes: "s", neck: null }))
      .toEqual({ skin: "tan", hair: "bob", hairColor: "pink", hat: null, top: "t", bottom: "b", shoes: "s", neck: null });
  });
  it("falls back to defaults for unknown body options", () => {
    const look = lookFromRow({ account_id: "a", skin: "x", hair: "y", hair_color: "z", hat: null, top: "t", bottom: "b", shoes: "s", neck: null });
    expect([look.skin, look.hair, look.hairColor]).toEqual([DEFAULT_LOOK.skin, DEFAULT_LOOK.hair, DEFAULT_LOOK.hairColor]);
  });
});

describe("characterErrorMessage", () => {
  it("maps RPC errors to Vietnamese copy", () => {
    expect(characterErrorMessage({ message: "invalid session" })).toBe("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
    expect(characterErrorMessage({ message: "item not available" })).toBe("Món đồ này chưa dùng được.");
    expect(characterErrorMessage({ message: "invalid character option" })).toBe("Lựa chọn ngoại hình không hợp lệ.");
    expect(characterErrorMessage(new Error("boom"))).toBe("Không lưu được nhân vật — thử lại nhé.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-look.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/character`.

- [ ] **Step 3: Implement**

`lib/game/types.ts`:

```ts
export type Facing = "down" | "up" | "left" | "right";
export interface Vec { x: number; y: number }

export type ItemSlot = "hat" | "top" | "bottom" | "shoes" | "neck" | "hand" | "pet";
export type SkinTone = "light" | "warm" | "tan" | "deep";
export type HairStyle = "short" | "bob" | "long";
export type HairColor = "black" | "darkbrown" | "brown" | "pink";

export const SKIN_TONES: readonly SkinTone[] = ["light", "warm", "tan", "deep"];
export const HAIR_STYLES: readonly HairStyle[] = ["short", "bob", "long"];
export const HAIR_COLORS: readonly HairColor[] = ["black", "darkbrown", "brown", "pink"];

/** A character's appearance (camelCase mirror of public.characters). `hand`/`pet` arrive in v14/v15. */
export interface Look {
  skin: SkinTone;
  hair: HairStyle;
  hairColor: HairColor;
  hat: string | null;
  top: string;
  bottom: string;
  shoes: string;
  neck: string | null;
}
```

`lib/game/character.ts`:

```ts
import { supabase } from "@/lib/supabase";
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type ItemSlot, type Look } from "@/lib/game/types";

export interface CatalogItem { id: string; slot: ItemSlot; name: string; price: number; starter: boolean; sort_order: number }
export interface CharacterRow {
  account_id: string; skin: string; hair: string; hair_color: string;
  hat: string | null; top: string; bottom: string; shoes: string; neck: string | null;
}

export const DEFAULT_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};

function pick<T extends string>(list: readonly T[], v: string, fallback: T): T {
  return (list as readonly string[]).includes(v) ? (v as T) : fallback;
}

export function lookFromRow(row: CharacterRow): Look {
  return {
    skin: pick(SKIN_TONES, row.skin, DEFAULT_LOOK.skin),
    hair: pick(HAIR_STYLES, row.hair, DEFAULT_LOOK.hair),
    hairColor: pick(HAIR_COLORS, row.hair_color, DEFAULT_LOOK.hairColor),
    hat: row.hat ?? null,
    top: row.top,
    bottom: row.bottom,
    shoes: row.shoes,
    neck: row.neck ?? null,
  };
}

export type LookProblem = "option" | "slot" | "missing";

/** Mirrors save_character: body options from the fixed lists; items must be starter catalog items in the
 *  matching slot; top/bottom/shoes are required. null = valid. */
export function validateLook(look: Look, catalog: CatalogItem[]): LookProblem | null {
  if (!SKIN_TONES.includes(look.skin) || !HAIR_STYLES.includes(look.hair) || !HAIR_COLORS.includes(look.hairColor)) return "option";
  const byId = new Map(catalog.map((c) => [c.id, c] as const));
  const check = (id: string | null, slot: ItemSlot, required: boolean): LookProblem | null => {
    if (id === null || id === undefined) return required ? "missing" : null;
    const it = byId.get(id);
    return it && it.slot === slot && it.starter ? null : "slot";
  };
  return check(look.hat, "hat", false) ?? check(look.top, "top", true) ?? check(look.bottom, "bottom", true)
    ?? check(look.shoes, "shoes", true) ?? check(look.neck, "neck", false);
}

let catalogPromise: Promise<CatalogItem[]> | null = null;
/** Starter catalog (cached per page load; a failed fetch is retried next call). */
export function fetchCatalog(): Promise<CatalogItem[]> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const { data, error } = await supabase
        .from("item_catalog").select("id, slot, name, price, starter, sort_order")
        .order("slot").order("sort_order");
      if (error) { catalogPromise = null; throw error; }
      return (data ?? []) as CatalogItem[];
    })();
  }
  return catalogPromise;
}

const LOOK_COLUMNS = "account_id, skin, hair, hair_color, hat, top, bottom, shoes, neck";

/** Looks of the given accounts; accounts without a character are simply absent from the map. */
export async function fetchCharacters(accountIds: string[]): Promise<Map<string, Look>> {
  const out = new Map<string, Look>();
  if (accountIds.length === 0) return out;
  const { data, error } = await supabase.from("characters").select(LOOK_COLUMNS).in("account_id", accountIds);
  if (error) throw error;
  for (const row of (data ?? []) as CharacterRow[]) out.set(row.account_id, lookFromRow(row));
  return out;
}

export async function saveCharacter(token: string, look: Look): Promise<Look> {
  const { data, error } = await supabase.rpc("save_character", {
    p_session_token: token, p_skin: look.skin, p_hair: look.hair, p_hair_color: look.hairColor,
    p_hat: look.hat, p_top: look.top, p_bottom: look.bottom, p_shoes: look.shoes, p_neck: look.neck,
  });
  if (error) throw error;
  return lookFromRow((Array.isArray(data) ? data[0] : data) as CharacterRow);
}

export function characterErrorMessage(err: unknown): string {
  const msg = (err as { message?: string } | null)?.message ?? "";
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("item not available")) return "Món đồ này chưa dùng được.";
  if (msg.includes("invalid character option")) return "Lựa chọn ngoại hình không hợp lệ.";
  return "Không lưu được nhân vật — thử lại nhé.";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/game-look.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/game/types.ts lib/game/character.ts tests/unit/game-look.test.ts
git add lib/game/types.ts lib/game/character.ts tests/unit/game-look.test.ts
git commit -m "feat(v13): game types + character data layer

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Sprite data — body, hair, hats, palettes, item art

**Files:**
- Create: `lib/game/art/layers.ts`, `lib/game/art/palettes.ts`, `lib/game/art/items.ts`, `lib/game/art/body.ts`, `lib/game/art/hair.ts`, `lib/game/art/hats.ts`
- Test: `tests/unit/game-art.test.ts`

**Interfaces:**
- Consumes: `HairStyle`, `HairColor`, `SkinTone` (Task 5); the SQL seed of Task 4 (read by the test).
- Produces:
  - `layers.ts`: `SPRITE_W = 24`, `SPRITE_H = 48`, `type Dir3 = "down" | "up" | "left"`, `type Frame = 0 | 1 | 2 | 3`, `interface Layer { top: number; rows: string[] }`.
  - `body.ts`: `buildBody(dir: Dir3, frame: Frame): string[]`, `HEADS: Record<Dir3, readonly string[]>`, `BODY_CODES`.
  - `hair.ts`: `HAIR: Record<HairStyle, Record<Dir3, Layer>>`, `HAIR_CODES`.
  - `hats.ts`: `type HatShape = "nonla" | "taibeo"`, `HATS: Record<HatShape, Layer>`, `HAT_CODES`.
  - `palettes.ts`: `OUTLINE`, `EYE`, `SKIN`, `HAIR_COLOR`, `SKIN_LABEL`, `HAIR_STYLE_LABEL`, `HAIR_COLOR_LABEL`.
  - `items.ts`: `type ItemArt`, `ITEM_ART: Record<string, ItemArt>`, `swatchOf(id): string`.

The grids below were generated and visually checked during brainstorming (3 hair styles × 4 facings, walk frames, 5 outfits). Copy them exactly.

- [ ] **Step 1: Write the failing test**

`tests/unit/game-art.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BODY_CODES, HEADS, buildBody } from "@/lib/game/art/body";
import { HAIR, HAIR_CODES } from "@/lib/game/art/hair";
import { HATS, HAT_CODES } from "@/lib/game/art/hats";
import { ITEM_ART, swatchOf } from "@/lib/game/art/items";
import { SPRITE_H, SPRITE_W, type Dir3, type Frame } from "@/lib/game/art/layers";

const DIRS: Dir3[] = ["down", "up", "left"];
const FRAMES: Frame[] = [0, 1, 2, 3];
const onlyCodes = (rows: readonly string[], codes: string) => rows.every((r) => [...r].every((ch) => codes.includes(ch)));

describe("body grids", () => {
  it("are 24×48 for every direction and frame, using only known codes", () => {
    for (const d of DIRS) for (const f of FRAMES) {
      const rows = buildBody(d, f);
      expect(rows).toHaveLength(SPRITE_H);
      for (const r of rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(rows, BODY_CODES)).toBe(true);
    }
  });
  it("walk frames only change the legs (rows 36+)", () => {
    for (const d of DIRS) {
      const idle = buildBody(d, 0), step = buildBody(d, 1);
      expect(step.slice(0, 36)).toEqual(idle.slice(0, 36));
      expect(step.slice(36)).not.toEqual(idle.slice(36));
    }
  });
});

describe("hair layers", () => {
  it("fit the sprite and use only hair codes", () => {
    for (const style of Object.values(HAIR)) for (const d of DIRS) {
      const l = style[d];
      expect(l.top + l.rows.length).toBeLessThanOrEqual(SPRITE_H);
      for (const r of l.rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(l.rows, HAIR_CODES)).toBe(true);
    }
  });
  it("cover the bald scalp in every direction", () => {
    for (const [name, style] of Object.entries(HAIR)) for (const d of DIRS) {
      const l = style[d], head = HEADS[d];
      const at = (r: number, c: number) => (r >= l.top && r < l.top + l.rows.length ? l.rows[r - l.top][c] : ".");
      for (let r = 3; r <= 16; r++) for (let c = 0; c < SPRITE_W; c++) {
        const skin = head[r][c] === "s" || head[r][c] === "S";
        const must = r <= 8 || (d === "up" && r <= 14) || (d === "left" && r <= 14 && c >= 12);
        if (skin && must) expect(at(r, c), `${name}.${d} r${r} c${c}`).not.toBe(".");
      }
    }
  });
});

describe("hats", () => {
  it("are 24 wide with known codes", () => {
    for (const h of Object.values(HATS)) {
      for (const r of h.rows) expect(r).toHaveLength(SPRITE_W);
      expect(onlyCodes(h.rows, HAT_CODES)).toBe(true);
    }
  });
});

describe("item art", () => {
  it("covers exactly the starter ids and slots seeded by migration 0011", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0011_v13_game_mode.sql"), "utf8");
    const seeded = [...sql.matchAll(/\('([a-z]+_[a-z_]+)',\s*'(hat|top|bottom|shoes|neck|hand|pet)'/g)]
      .map((m) => `${m[1]}:${m[2]}`).sort();
    const art = Object.entries(ITEM_ART).map(([id, a]) => `${id}:${a.slot}`).sort();
    expect(seeded).toHaveLength(15);
    expect(art).toEqual(seeded);
  });
  it("gives every item a swatch colour", () => {
    for (const id of Object.keys(ITEM_ART)) expect(swatchOf(id)).toMatch(/^#[0-9a-f]{6}$/);
    expect(swatchOf("unknown")).toBe("#9aa0a8");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-art.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/art/body`.

- [ ] **Step 3: Create `lib/game/art/layers.ts`**

```ts
export const SPRITE_W = 24;
export const SPRITE_H = 48;

/** Stored facings; "right" is "left" mirrored. */
export type Dir3 = "down" | "up" | "left";
/** Walk cycle: 0 idle, 1 step A, 2 idle, 3 step B. */
export type Frame = 0 | 1 | 2 | 3;

/** A partial sprite layer: `rows[i]` is drawn at sprite row `top + i`; "." = transparent. */
export interface Layer { top: number; rows: string[] }
```

- [ ] **Step 4: Create `lib/game/art/palettes.ts`**

```ts
import type { HairColor, HairStyle, SkinTone } from "@/lib/game/types";

export const OUTLINE = "#3a2418";
export const EYE = "#2a1a14";

export const SKIN: Record<SkinTone, { s: string; S: string; b: string; m: string }> = {
  light: { s: "#f7d9bf", S: "#e2b392", b: "#f2a898", m: "#b8674f" },
  warm: { s: "#f2c7a0", S: "#d9a07a", b: "#f0a08a", m: "#b35f4a" },
  tan: { s: "#d9a577", S: "#b98152", b: "#d98a6e", m: "#9a4e3a" },
  deep: { s: "#a86f4c", S: "#8a5536", b: "#b8664e", m: "#6e3526" },
};

export const HAIR_COLOR: Record<HairColor, { h: string; H: string }> = {
  black: { h: "#221b25", H: "#3a3345" },
  darkbrown: { h: "#3b2519", H: "#5a3a26" },
  brown: { h: "#6b4226", H: "#8a5a36" },
  pink: { h: "#e889b5", H: "#f4b3d0" },
};

export const SKIN_LABEL: Record<SkinTone, string> = { light: "Sáng", warm: "Hồng hào", tan: "Bánh mật", deep: "Nâu" };
export const HAIR_STYLE_LABEL: Record<HairStyle, string> = { short: "Tóc ngắn", bob: "Ngang vai", long: "Tóc dài" };
export const HAIR_COLOR_LABEL: Record<HairColor, string> = { black: "Đen", darkbrown: "Nâu đen", brown: "Nâu", pink: "Hồng" };
```

- [ ] **Step 5: Create `lib/game/art/hats.ts`**

```ts
import type { Layer } from "./layers";

export type HatShape = "nonla" | "taibeo";

// Hats are symmetric, so one layer serves every facing. Codes: . o y/Y/Z (nón lá straw) x/X (fabric).
export const HATS: Record<HatShape, Layer> = {
  nonla: { top: 0, rows: [
    "...........oo...........",
    "..........oyyo..........",
    "........ooyyyYoo........",
    ".......oyyyyyYYZo.......",
    ".....ooyyyyyyYYYZoo.....",
    "....oyyyyyyyyYYYYZZo....",
    "..ooyyyyyyyyyYYYYZZZoo..",
    ".oyyyyyyyyyyyYYYYYZZZZo.",
    "ooZZZZZZZZZZZZZZZZZZZZoo",
  ] },
  taibeo: { top: 2, rows: [
    "........oooooooo........",
    "......ooxxxxxxxxoo......",
    ".....oxxxxxxxxxxxxo.....",
    ".....oxxxxxxxxxxxxo.....",
    ".....oXXXXXXXXXXXXo.....",
    "...ooxxxxxxxxxxxxxxoo...",
    "..oxxxxxxxxxxxxxxxxxxo..",
    "..oooXXXXXXXXXXXXXXooo..",
  ] },
};

export const HAT_CODES = ".oyYZxX";
```

- [ ] **Step 6: Create `lib/game/art/items.ts`**

```ts
import type { HatShape } from "./hats";

export type ItemArt =
  | { slot: "hat"; shape: HatShape; colors: Record<string, string> }
  | { slot: "top"; kind: "baba" | "tee"; colors: readonly [main: string, shade: string, highlight: string, detail: string] }
  | { slot: "bottom"; kind: "shorts" | "long"; colors: readonly [main: string, shade: string, stripe: string] }
  | { slot: "shoes"; colors: readonly [strap: string, sole: string] }
  | { slot: "neck"; colors: readonly [light: string, dark: string] };

/** Render data per catalog id. Must match the seed in supabase/migrations/0011_v13_game_mode.sql (tested). */
export const ITEM_ART: Record<string, ItemArt> = {
  hat_nonla: { slot: "hat", shape: "nonla", colors: { y: "#f3e3b0", Y: "#dcc587", Z: "#b89758" } },
  hat_taibeo_green: { slot: "hat", shape: "taibeo", colors: { x: "#5a9a44", X: "#3f7a30" } },
  top_baba_yellow: { slot: "top", kind: "baba", colors: ["#f2c23c", "#d19a24", "#fbe08a", "#b27d16"] },
  top_baba_white: { slot: "top", kind: "baba", colors: ["#f4f1ea", "#d6cfc0", "#ffffff", "#b9ae98"] },
  top_baba_pink: { slot: "top", kind: "baba", colors: ["#f19bb5", "#d4758f", "#f9c3d3", "#b5566f"] },
  top_tee_blue: { slot: "top", kind: "tee", colors: ["#3f7fc4", "#2f63a0", "#6fa3dc", "#3f7fc4"] },
  top_tee_green: { slot: "top", kind: "tee", colors: ["#5fae6e", "#468a53", "#8fd09b", "#5fae6e"] },
  bottom_shorts_red: { slot: "bottom", kind: "shorts", colors: ["#d8433a", "#a82c26", "#f1ece0"] },
  bottom_pants_black: { slot: "bottom", kind: "long", colors: ["#2f2b33", "#1f1c22", "#2f2b33"] },
  bottom_jeans: { slot: "bottom", kind: "long", colors: ["#46618f", "#34496e", "#46618f"] },
  shoes_dep_blue: { slot: "shoes", colors: ["#3d6fd1", "#2a4f9c"] },
  shoes_dep_brown: { slot: "shoes", colors: ["#8b5a33", "#6e4424"] },
  shoes_dep_red: { slot: "shoes", colors: ["#d9534f", "#a83c39"] },
  neck_khanran: { slot: "neck", colors: ["#f1ece0", "#2b2524"] },
  neck_khanran_red: { slot: "neck", colors: ["#f1ece0", "#c0392b"] },
};

/** One representative colour per item (editor swatches). */
export function swatchOf(id: string): string {
  const a = ITEM_ART[id];
  if (!a) return "#9aa0a8";
  if (a.slot === "hat") return a.shape === "nonla" ? a.colors.y : a.colors.x;
  if (a.slot === "neck") return a.colors[1];
  return a.colors[0];
}
```

- [ ] **Step 7: Create `lib/game/art/body.ts`**

```ts
import type { Dir3, Frame } from "./layers";

// Body templates, 24 px wide. Region codes (colours come from the look, see compose.ts):
//   . transparent · o outline · s/S skin/shade · e eyes+brows · b blush · m mouth
//   t/T/u/K top main/shade/highlight/detail · q/Q scarf band · r/R scarf tails (front, inside the torso)
//   v/V scarf tails (side view, outside the torso) · n scarf-tail outline
//   p/P/l bottom main/shade/stripe · j hem · g/G lower leg · f/F sandal strap/sole

/** Rows 0–16: bald head + face (hair and hats are separate layers). */
export const HEAD_FRONT: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "........oooooooo........",
  "......oossssssssoo......",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osseesssseeSSo.....",
  ".....osssessssesSSo.....",
  ".....osssessssesSSo.....",
  ".....ossbsssSssbSSo.....",
  ".....osssssmmsssSSo.....",
  ".......osssssssSo.......",
  "........oSSSSSSo........",
];
export const HEAD_BACK: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "........oooooooo........",
  "......oossssssssoo......",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".......osssssssso.......",
  "........oSSSSSSo........",
];
/** Facing left; "right" is drawn mirrored. */
export const HEAD_SIDE: readonly string[] = [
  "........................",
  "........................",
  "........................",
  "........oooooooo........",
  "......oossssssssoo......",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  ".....osssssssssssso.....",
  "......ossssssssssso.....",
  "......oseesssssssso.....",
  "......osessSsssssso.....",
  "......osessSsssssso.....",
  ".....osbsssSsssssso.....",
  "......omsssSsssssso.....",
  ".......osssSsssso.......",
  "........oSSSSo..........",
];

/** Rows 17–29. */
export const TORSO_FRONT: readonly string[] = [
  "......oQqQqQqQqQqo......",
  "......oqQqQqQqQqQo......",
  "...ouuttttRrRrtttTTTo...",
  "...ouuttttrRrRtttTTTo...",
  "...ouuttttRrRrtttTTTo...",
  "...ouutKKKrRrRKKKTTTo...",
  "...osstKtKRrrRKtKTSSo...",
  "...osstKKKtRRtKKKTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttKtttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttKtttttTSSo...",
  "...ossTTTTTTTTTTTTsso...",
];
export const TORSO_BACK: readonly string[] = [
  "......oQqQqQqQqQqo......",
  "......oqQqQqQqQqQo......",
  "...ouutttttttttttTTTo...",
  "...ouutttttttttttTTTo...",
  "...ouutttttttttttTTTo...",
  "...ouutttttttttttTTTo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...osstttttttttttTSSo...",
  "...ossTTTTTTTTTTTTsso...",
];
export const TORSO_SIDE: readonly string[] = [
  ".......oQqQqQqo.........",
  ".......oqQqQqQo.........",
  "....nVvottuuutTTo.......",
  "....nvVottuuutTTo.......",
  "....nVvottuuutTTo.......",
  ".....nVottuuutTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottssstTTo.......",
  ".......ottSSStTTo.......",
  ".......oTTTTTTTTo.......",
];

/** Rows 30–35. */
export const BOTTOM_FRONT: readonly string[] = [
  "....oopppppppppppPoo....",
  ".....oplpppppppplPo.....",
  ".....oplpppppppplPo.....",
  ".....oplpppooppplPo.....",
  ".....oplpppooppplPo.....",
  ".....jjjjjj..jjjjjj.....",
];
export const BOTTOM_SIDE: readonly string[] = [
  ".......oppppppPPo.......",
  ".......opppplpPPo.......",
  ".......opppplpPPo.......",
  ".......opppplpPPo.......",
  ".......opppplpPPo.......",
  ".......ojjjjjjjjo.......",
];

/** Rows 36–45: one leg, 6 columns wide (left leg = columns 5–10, right leg = columns 13–18). */
export const LEG_L: readonly string[] = [
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".oggGo",
  ".offfo",
  "osssso",
  "oFFFFo",
  "oooooo",
];
export const LEG_R: readonly string[] = [
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "oggGo.",
  "offfo.",
  "osssso",
  "oFFFFo",
  "oooooo",
];
export const LEGS_SIDE_IDLE: readonly string[] = [
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........oggGo...........",
  "........offfo...........",
  ".......osssso...........",
  ".......oFFFFo...........",
  ".......oooooo...........",
];
export const LEGS_SIDE_STRIDE: readonly string[] = [
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......oggo.oGGo........",
  ".......offo.oFFo........",
  "......osssso.oSSo.......",
  "......oFFFFo.oFFo.......",
  "......oooooo.oooo.......",
];

export const HEADS: Record<Dir3, readonly string[]> = { down: HEAD_FRONT, up: HEAD_BACK, left: HEAD_SIDE };
export const BODY_CODES = ".osSebmtTuKqQrRvVnpPljgGfF";

const EMPTY_ROW = "........................";

/** A lifted leg is the same template one row shorter (the foot moves up one pixel). */
function lift(leg: readonly string[]): string[] {
  return [...leg.slice(1), "......"];
}

function legsFront(liftLeft: boolean, liftRight: boolean): string[] {
  const l = liftLeft ? lift(LEG_L) : LEG_L;
  const r = liftRight ? lift(LEG_R) : LEG_R;
  return l.map((row, i) => "....." + row + ".." + r[i] + ".....");
}

/** Full 24×48 body for a direction and walk frame (0 idle, 1 step A, 2 idle, 3 step B). */
export function buildBody(dir: Dir3, frame: Frame): string[] {
  if (dir === "down") return [...HEAD_FRONT, ...TORSO_FRONT, ...BOTTOM_FRONT, ...legsFront(frame === 1, frame === 3), EMPTY_ROW, EMPTY_ROW];
  if (dir === "up") return [...HEAD_BACK, ...TORSO_BACK, ...BOTTOM_FRONT, ...legsFront(frame === 3, frame === 1), EMPTY_ROW, EMPTY_ROW];
  const legs = frame === 1 || frame === 3 ? LEGS_SIDE_STRIDE : LEGS_SIDE_IDLE;
  return [...HEAD_SIDE, ...TORSO_SIDE, ...BOTTOM_SIDE, ...legs, EMPTY_ROW, EMPTY_ROW];
}
```

- [ ] **Step 8: Create `lib/game/art/hair.ts`**

```ts
import type { HairStyle } from "@/lib/game/types";
import type { Dir3, Layer } from "./layers";

// Hair layers (codes: . transparent · o outline · h hair · H highlight). Drawn over the bald head;
// every style covers the scalp (checked by tests/unit/game-art.test.ts).
export const HAIR: Record<HairStyle, Record<Dir3, Layer>> = {
  short: {
    down: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhHHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhh.hhhh.hhho.....",
      "......h..........h......",
      "......h..........h......",
      "......h..........h......",
      "......h..........h......",
      "......h..........h......",
    ] },
    left: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhhHHhhhhho.....",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      "......ohh...hhhhhho.....",
      "............hhhhhh......",
      "............hhhhhh......",
      "............hhhhhh......",
      "............hhhhhh......",
      "............hhhhhh......",
      "............hhhh........",
    ] },
    up: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhHHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhHhhhhhho.....",
      ".....ohhhhHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".......ohhhhhhhho.......",
    ] },
  },
  bob: {
    down: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhHHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....oooo........oooo....",
    ] },
    left: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhhHHhhhhho.....",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      "......ohhhhhhhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "...........hhhhhhhho....",
      "...........oooooooo.....",
    ] },
    up: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhHHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhHhhhhhho.....",
      ".....ohhhhHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      "....ohhhhhhhhhhhhhho....",
      "....ohhhhhhhhhhhhhho....",
      "....oooooooooooooooo....",
    ] },
  },
  long: {
    down: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhHHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "....ohh..........hho....",
      "...ohhh..........hhho...",
      "...ohhh..........hhho...",
      "...ohhh..........hhho...",
      "...ohhh..........hhho...",
      "...ohhh..........hhho...",
      "...oooo..........oooo...",
    ] },
    left: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhhHHhhhhho.....",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      "......ohhhhhhhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "............hhhhhhho....",
      "...........hhhhhhhho....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............hhhhho.....",
      ".............oooooo.....",
    ] },
    up: { top: 3, rows: [
      "........oooooooo........",
      "......oohhhhhhhhoo......",
      ".....ohhhhHHhhhhhho.....",
      ".....ohhhHHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhHhhhhhho.....",
      ".....ohhhhHhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....ohhhhhhhhhhhho.....",
      ".....oooooooooooooo.....",
    ] },
  },
};

export const HAIR_CODES = ".ohH";
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `pnpm vitest run tests/unit/game-art.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 10: Lint + commit**

```bash
npx eslint lib/game/art tests/unit/game-art.test.ts
git add lib/game/art tests/unit/game-art.test.ts
git commit -m "feat(v13): pixel character grids (body, 3 hair styles, hats) + item art

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Character composition (pure) + rasterizing (browser)

**Files:**
- Create: `lib/game/art/compose.ts`, `lib/game/art/raster.ts`
- Test: `tests/unit/game-compose.test.ts`

**Interfaces:**
- Consumes: Task 6 modules, `Look`/`Facing` (Task 5), `DEFAULT_LOOK` (Task 5, tests only).
- Produces: `type Palette = Record<string, string | null>`, `lookKey(look): string`, `bodyPalette(look): Palette`, `hatLayerFor(look): { layer: Layer; palette: Palette } | null`, `composeMatrix(look, facing, frame): string[][]` (48 × 24, `""` = transparent); browser: `type CharacterFrames = Record<Facing, HTMLCanvasElement[]>`, `matrixToCanvas(m)`, `getCharacterFrames(look)`, `getPortrait(look)`.

- [ ] **Step 1: Write the failing test**

`tests/unit/game-compose.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bodyPalette, composeMatrix, lookKey } from "@/lib/game/art/compose";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { OUTLINE, SKIN } from "@/lib/game/art/palettes";

describe("composeMatrix", () => {
  it("returns a 48×24 colour matrix", () => {
    const m = composeMatrix(DEFAULT_LOOK, "down", 0);
    expect(m).toHaveLength(48);
    for (const row of m) expect(row).toHaveLength(24);
  });
  it("mirrors left into right", () => {
    const l = composeMatrix(DEFAULT_LOOK, "left", 2);
    const r = composeMatrix(DEFAULT_LOOK, "right", 2);
    expect(r.map((row) => [...row].reverse())).toEqual(l);
  });
  it("draws the nón lá tip on row 0, and nothing there without a hat", () => {
    expect(composeMatrix(DEFAULT_LOOK, "down", 0)[0][11]).toBe(OUTLINE);
    expect(composeMatrix({ ...DEFAULT_LOOK, hat: null }, "down", 0)[0][11]).toBe("");
  });
  it("draws hair over the bald head", () => {
    const m = composeMatrix({ ...DEFAULT_LOOK, hat: null, hairColor: "pink" }, "down", 0);
    expect(m[6][11]).toBe("#e889b5");
  });
  it("renders unknown items with placeholders instead of throwing", () => {
    expect(() => composeMatrix({ ...DEFAULT_LOOK, hat: "nope", top: "nope", bottom: "nope", shoes: "nope" }, "up", 1)).not.toThrow();
  });
});

describe("bodyPalette", () => {
  it("hides pocket details on tees and shows them on áo bà ba", () => {
    const tee = bodyPalette({ ...DEFAULT_LOOK, top: "top_tee_blue" });
    expect(tee.K).toBe(tee.t);
    const baba = bodyPalette(DEFAULT_LOOK);
    expect(baba.K).not.toBe(baba.t);
  });
  it("shows skin below shorts and fabric below long pants", () => {
    const shorts = bodyPalette(DEFAULT_LOOK);
    expect(shorts.g).toBe(SKIN.warm.s);
    expect(shorts.j).toBe(OUTLINE);
    const jeans = bodyPalette({ ...DEFAULT_LOOK, bottom: "bottom_jeans" });
    expect(jeans.g).toBe(jeans.p);
    expect(jeans.j).toBe(jeans.P);
  });
  it("without a scarf: side tails vanish, band and front tails read as the shirt", () => {
    const p = bodyPalette({ ...DEFAULT_LOOK, neck: null });
    expect([p.v, p.V, p.n]).toEqual([null, null, null]);
    expect([p.q, p.Q, p.r, p.R]).toEqual([p.t, p.t, p.t, p.t]);
  });
});

describe("lookKey", () => {
  it("is stable and changes with any part", () => {
    expect(lookKey({ ...DEFAULT_LOOK })).toBe(lookKey(DEFAULT_LOOK));
    expect(lookKey({ ...DEFAULT_LOOK, neck: null })).not.toBe(lookKey(DEFAULT_LOOK));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-compose.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/art/compose`.

- [ ] **Step 3: Implement `lib/game/art/compose.ts`**

```ts
import type { Facing, Look } from "@/lib/game/types";
import { buildBody } from "./body";
import { HAIR } from "./hair";
import { HATS } from "./hats";
import { ITEM_ART, type ItemArt } from "./items";
import { EYE, HAIR_COLOR, OUTLINE, SKIN } from "./palettes";
import { SPRITE_H, SPRITE_W, type Dir3, type Frame, type Layer } from "./layers";

/** Region code → CSS colour; null = not drawn. */
export type Palette = Record<string, string | null>;

const PLACEHOLDER_TOP = ["#9aa0a8", "#7d838c", "#c3c7cc", "#7d838c"] as const;
const PLACEHOLDER_BOTTOM = ["#6b6f76", "#50545a", "#6b6f76"] as const;
const PLACEHOLDER_SHOES = ["#6b6f76", "#50545a"] as const;

function artFor<S extends ItemArt["slot"]>(id: string | null, slot: S): Extract<ItemArt, { slot: S }> | null {
  if (!id) return null;
  const a = ITEM_ART[id];
  return a && a.slot === slot ? (a as Extract<ItemArt, { slot: S }>) : null;
}

/** Stable cache key for a look. */
export function lookKey(look: Look): string {
  return [look.skin, look.hair, look.hairColor, look.hat ?? "-", look.top, look.bottom, look.shoes, look.neck ?? "-"].join("|");
}

/** Colours for the body template and the hair layer. */
export function bodyPalette(look: Look): Palette {
  const skin = SKIN[look.skin] ?? SKIN.warm;
  const hair = HAIR_COLOR[look.hairColor] ?? HAIR_COLOR.black;
  const top = artFor(look.top, "top");
  const bottom = artFor(look.bottom, "bottom");
  const shoes = artFor(look.shoes, "shoes");
  const neck = artFor(look.neck, "neck");
  const [tMain, tShade, tHi, tDetail] = top?.colors ?? PLACEHOLDER_TOP;
  const [bMain, bShade, bStripe] = bottom?.colors ?? PLACEHOLDER_BOTTOM;
  const [fStrap, fSole] = shoes?.colors ?? PLACEHOLDER_SHOES;
  const long = bottom?.kind === "long";
  const plain = top?.kind === "tee";
  return {
    o: OUTLINE, s: skin.s, S: skin.S, e: EYE, b: skin.b, m: skin.m,
    t: tMain, T: tShade, u: tHi, K: plain ? tMain : tDetail,
    // Scarf colours; without a scarf the band and front tails read as the shirt, side tails disappear.
    q: neck ? neck.colors[0] : tMain, Q: neck ? neck.colors[1] : tMain,
    r: neck ? neck.colors[0] : tMain, R: neck ? neck.colors[1] : tMain,
    v: neck ? neck.colors[0] : null, V: neck ? neck.colors[1] : null, n: neck ? OUTLINE : null,
    p: bMain, P: bShade, l: bStripe,
    j: long ? bShade : OUTLINE, g: long ? bMain : skin.s, G: long ? bShade : skin.S,
    f: fStrap, F: fSole,
    h: hair.h, H: hair.H,
  };
}

export function hatLayerFor(look: Look): { layer: Layer; palette: Palette } | null {
  const hat = artFor(look.hat, "hat");
  if (!hat) return null;
  return { layer: HATS[hat.shape], palette: { o: OUTLINE, ...hat.colors } };
}

/** 48 rows × 24 columns of CSS colours ("" = transparent). Layers: body → hair → hat; "right" mirrors "left". */
export function composeMatrix(look: Look, facing: Facing, frame: Frame): string[][] {
  const dir: Dir3 = facing === "right" ? "left" : facing;
  const m: string[][] = Array.from({ length: SPRITE_H }, () => new Array<string>(SPRITE_W).fill(""));
  const paint = (rows: readonly string[], top: number, pal: Palette) => {
    rows.forEach((row, i) => {
      const y = top + i;
      if (y < 0 || y >= SPRITE_H) return;
      for (let x = 0; x < SPRITE_W; x++) {
        const ch = row[x];
        if (ch === undefined || ch === ".") continue;
        const col = pal[ch];
        if (col) m[y][x] = col;
      }
    });
  };
  const pal = bodyPalette(look);
  paint(buildBody(dir, frame), 0, pal);
  const hair = (HAIR[look.hair] ?? HAIR.short)[dir];
  paint(hair.rows, hair.top, pal);
  const hat = hatLayerFor(look);
  if (hat) paint(hat.layer.rows, hat.layer.top, hat.palette);
  if (facing === "right") for (const row of m) row.reverse();
  return m;
}
```

- [ ] **Step 4: Implement `lib/game/art/raster.ts`** (browser only — never import from pure modules)

```ts
import type { Facing, Look } from "@/lib/game/types";
import { composeMatrix, lookKey } from "./compose";
import { SPRITE_H, SPRITE_W, type Frame } from "./layers";

export type CharacterFrames = Record<Facing, HTMLCanvasElement[]>;

const FACINGS: Facing[] = ["down", "up", "left", "right"];
const FRAMES: Frame[] = [0, 1, 2, 3];
const MAX_CACHED = 64;
const cache = new Map<string, CharacterFrames>();

export function matrixToCanvas(m: string[][]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = SPRITE_W;
  cv.height = SPRITE_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  m.forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }));
  return cv;
}

/** Pre-rendered 24×48 canvases for every facing × walk frame, LRU-cached per look. */
export function getCharacterFrames(look: Look): CharacterFrames {
  const key = lookKey(look);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const frames = {} as CharacterFrames;
  for (const f of FACINGS) frames[f] = FRAMES.map((fr) => matrixToCanvas(composeMatrix(look, f, fr)));
  cache.set(key, frames);
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return frames;
}

/** 24×24 head-and-shoulders crop (front, idle) for the HUD and the editor. */
export function getPortrait(look: Look): HTMLCanvasElement {
  const src = getCharacterFrames(look).down[0];
  const cv = document.createElement("canvas");
  cv.width = 24;
  cv.height = 24;
  cv.getContext("2d")?.drawImage(src, 0, 0, 24, 24, 0, 0, 24, 24);
  return cv;
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm vitest run tests/unit/game-compose.test.ts && npx tsc --noEmit`
Expected: PASS (9 tests); tsc 0 errors.

- [ ] **Step 6: Lint + commit**

```bash
npx eslint lib/game/art/compose.ts lib/game/art/raster.ts tests/unit/game-compose.test.ts
git add lib/game/art/compose.ts lib/game/art/raster.ts tests/unit/game-compose.test.ts
git commit -m "feat(v13): compose layered characters + cached sprite frames

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Map types, movement and A* pathfinding

**Files:**
- Create: `lib/game/maps/types.ts`, `lib/game/movement.ts`, `lib/game/pathfinding.ts`, `tests/unit/helpers/ascii-map.ts`
- Test: `tests/unit/game-movement.test.ts`, `tests/unit/game-pathfinding.test.ts`

**Interfaces:**
- Consumes: `Facing`, `Vec` (Task 5).
- Produces:
  - `maps/types.ts`: `Rect`, `Spot { x; y; dir: Facing }`, `InteractId = "dj_booth" | "notice_board" | "dock_sign"`, `Interactable { id; label; rect; use: Vec }`, `PropPlacement` (union by `kind`: palm, hammock, post, table, mixer, board, sign, banana, lightpole), `GameMap { id; width; height; cell; cols; rows; blocked: Uint8Array; spawn; djSpot; seats; standSpots; interactables; props }`.
  - `movement.ts`: `WALK_SPEED = 70`, `FOOT_HALF_W = 3`, `FOOT_UP = 3`, `FOOT_DOWN = 1`, `KeyState`, `cellBlocked(map, c, r)`, `isBlockedAt(map, x, y)`, `stepMove(map, pos, dir, dtSec, speed?)`, `inputDir(keys)`, `facingFor(dir, prev)` (horizontal wins — keyboard), `facingForVector(v, prev)` (dominant axis — paths).
  - `pathfinding.ts`: `MAX_PATH_POINTS = 32`, `cellCenter`, `nearestWalkableCell`, `findPath(map, from, to, maxNodes?) : Vec[] | null`, `lineClear(map, a, b)`, `smoothPath(map, from, points)`.
  - `tests/unit/helpers/ascii-map.ts`: `mapFromAscii(rows, cell = 8): GameMap` (`#` = blocked) — reused by later tests.

- [ ] **Step 1: Test helper**

`tests/unit/helpers/ascii-map.ts`:

```ts
import type { GameMap } from "@/lib/game/maps/types";

/** Tiny test maps: one character per 8-px cell, "#" = blocked. */
export function mapFromAscii(rows: string[], cell = 8): GameMap {
  const cols = rows[0].length;
  const blocked = new Uint8Array(cols * rows.length);
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "#") blocked[r * cols + c] = 1; }));
  return {
    id: "test", width: cols * cell, height: rows.length * cell, cell, cols, rows: rows.length, blocked,
    spawn: { x: 4, y: 4 }, djSpot: { x: 4, y: 4, dir: "down" }, seats: [], standSpots: [], interactables: [], props: [],
  };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/game-movement.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { facingFor, facingForVector, inputDir, isBlockedAt, stepMove } from "@/lib/game/movement";
import { mapFromAscii } from "./helpers/ascii-map";

const open = mapFromAscii(Array(10).fill(".........."));   // 80 × 80 px
const wall = mapFromAscii(Array(10).fill(".....#...."));   // wall at x 40–48

describe("stepMove", () => {
  it("moves speed × dt in open space", () => {
    const p = stepMove(open, { x: 20, y: 20 }, { x: 1, y: 0 }, 0.1);
    expect(p.x).toBeCloseTo(27);
    expect(p.y).toBe(20);
  });
  it("normalizes diagonal input", () => {
    const p = stepMove(open, { x: 20, y: 20 }, { x: 1, y: 1 }, 0.1);
    expect(Math.hypot(p.x - 20, p.y - 20)).toBeCloseTo(7);
  });
  it("stops in front of a wall", () => {
    const p = stepMove(wall, { x: 30, y: 40 }, { x: 1, y: 0 }, 0.5);
    expect(p.x).toBeGreaterThan(32);
    expect(p.x).toBeLessThan(37);
    expect(isBlockedAt(wall, p.x, p.y)).toBe(false);
  });
  it("slides along a wall", () => {
    const p = stepMove(wall, { x: 30, y: 20 }, { x: 1, y: 1 }, 0.5);
    expect(p.x).toBeLessThan(37);
    expect(p.y).toBeGreaterThan(40);
  });
  it("does not move with zero input", () => {
    expect(stepMove(open, { x: 20, y: 20 }, { x: 0, y: 0 }, 0.1)).toEqual({ x: 20, y: 20 });
  });
});

describe("isBlockedAt", () => {
  it("treats the map edge as a wall (6×4 feet box)", () => {
    expect(isBlockedAt(open, 1, 40)).toBe(true);
    expect(isBlockedAt(open, 40, 80)).toBe(true);
    expect(isBlockedAt(open, 40, 79)).toBe(false);
  });
});

describe("input + facing", () => {
  it("maps keys to a direction", () => {
    expect(inputDir({ up: true, down: false, left: true, right: false })).toEqual({ x: -1, y: -1 });
  });
  it("keyboard facing prefers the horizontal component", () => {
    expect(facingFor({ x: -1, y: -1 }, "down")).toBe("left");
    expect(facingFor({ x: 0, y: 1 }, "left")).toBe("down");
    expect(facingFor({ x: 0, y: 0 }, "up")).toBe("up");
  });
  it("path facing follows the dominant axis", () => {
    expect(facingForVector({ x: 0.3, y: 40 }, "left")).toBe("down");
    expect(facingForVector({ x: -40, y: 5 }, "down")).toBe("left");
  });
});
```

`tests/unit/game-pathfinding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findPath, lineClear, MAX_PATH_POINTS, smoothPath } from "@/lib/game/pathfinding";
import { isBlockedAt } from "@/lib/game/movement";
import { mapFromAscii } from "./helpers/ascii-map";

const wallMap = mapFromAscii([
  "....................",
  "....................",
  "........#...........",
  "........#...........",
  "........#...........",
  "........#...........",
  "........#...........",
  "....................",
  "....................",
  "....................",
]);

describe("findPath", () => {
  it("routes around a wall and ends exactly on a free target", () => {
    const path = findPath(wallMap, { x: 28, y: 36 }, { x: 108, y: 36 })!;
    expect(path).not.toBeNull();
    expect(path[path.length - 1]).toEqual({ x: 108, y: 36 });
    for (const p of path) expect(isBlockedAt(wallMap, p.x, p.y)).toBe(false);
  });
  it("returns null when the target is enclosed", () => {
    const boxed = mapFromAscii(["..........", "..#####...", "..#...#...", "..#...#...", "..#####...", ".........."]);
    expect(findPath(boxed, { x: 4, y: 4 }, { x: 36, y: 28 })).toBeNull();
  });
  it("never cuts a corner between two blocked cells", () => {
    const diag = mapFromAscii(["....", ".#..", "..#.", "...."]);
    const path = findPath(diag, { x: 20, y: 12 }, { x: 12, y: 20 });
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(1);
  });
  it("snaps a blocked target to the nearest walkable cell", () => {
    const path = findPath(wallMap, { x: 28, y: 36 }, { x: 68, y: 36 })!;
    const last = path[path.length - 1];
    expect(isBlockedAt(wallMap, last.x, last.y)).toBe(false);
  });
});

describe("smoothPath", () => {
  it("keeps line of sight, shortens the route and keeps the end point", () => {
    const from = { x: 28, y: 36 };
    const cells = findPath(wallMap, from, { x: 108, y: 36 })!;
    const pts = smoothPath(wallMap, from, cells);
    expect(pts.length).toBeLessThan(cells.length);
    expect(pts.length).toBeLessThanOrEqual(MAX_PATH_POINTS);
    let prev = from;
    for (const p of pts) { expect(lineClear(wallMap, prev, p)).toBe(true); prev = p; }
    expect(pts[pts.length - 1]).toEqual({ x: 108, y: 36 });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm vitest run tests/unit/game-movement.test.ts tests/unit/game-pathfinding.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/movement` / `@/lib/game/pathfinding`.

- [ ] **Step 4: Implement `lib/game/maps/types.ts`**

```ts
import type { Facing, Vec } from "@/lib/game/types";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Spot { x: number; y: number; dir: Facing }

export type InteractId = "dj_booth" | "notice_board" | "dock_sign";
export interface Interactable { id: InteractId; label: string; rect: Rect; use: Vec }

/** Things that are drawn as depth-sorted sprites (anchor = base point, sort by y). */
export type PropPlacement =
  | { kind: "palm"; x: number; y: number; h: number; lean: number; seed: number }
  | { kind: "hammock"; x: number; y: number; x2: number }
  | { kind: "post"; x: number; y: number }
  | { kind: "table"; x: number; y: number }
  | { kind: "mixer"; x: number; y: number }
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number }
  | { kind: "banana"; x: number; y: number }
  | { kind: "lightpole"; x: number; y: number };

export interface GameMap {
  id: string;
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  /** cols × rows, 1 = blocked. */
  blocked: Uint8Array;
  spawn: Vec;
  /** Where a classic-mode DJ is shown (behind the mixer). */
  djSpot: Spot;
  /** Where other classic-mode members are shown (behind café tables). */
  seats: Spot[];
  /** Overflow spots when every seat is taken. */
  standSpots: Spot[];
  interactables: Interactable[];
  props: PropPlacement[];
}
```

- [ ] **Step 5: Implement `lib/game/movement.ts`**

```ts
import type { GameMap } from "@/lib/game/maps/types";
import type { Facing, Vec } from "@/lib/game/types";

export const WALK_SPEED = 70; // px/s
/** Feet collision box: x-3…x+3, y-3…y+1 (fits inside one 8-px cell when centred). */
export const FOOT_HALF_W = 3;
export const FOOT_UP = 3;
export const FOOT_DOWN = 1;
const MAX_SUBSTEP = 4; // px — never tunnel through a thin wall on a slow frame

export interface KeyState { up: boolean; down: boolean; left: boolean; right: boolean }

export function cellBlocked(map: GameMap, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= map.cols || r >= map.rows) return true;
  return map.blocked[r * map.cols + c] === 1;
}

/** True if the feet box at (x, y) leaves the map or touches a blocked cell. */
export function isBlockedAt(map: GameMap, x: number, y: number): boolean {
  const x0 = x - FOOT_HALF_W, x1 = x + FOOT_HALF_W, y0 = y - FOOT_UP, y1 = y + FOOT_DOWN;
  if (x0 < 0 || y0 < 0 || x1 > map.width || y1 > map.height) return true;
  const c0 = Math.floor(x0 / map.cell), c1 = Math.floor((x1 - 1e-6) / map.cell);
  const r0 = Math.floor(y0 / map.cell), r1 = Math.floor((y1 - 1e-6) / map.cell);
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (cellBlocked(map, c, r)) return true;
  return false;
}

/** Move along `dir` (any length, normalized) for `dtSec`; x then y per sub-step so walls make you slide. */
export function stepMove(map: GameMap, pos: Vec, dir: Vec, dtSec: number, speed = WALK_SPEED): Vec {
  const len = Math.hypot(dir.x, dir.y);
  if (len === 0 || dtSec <= 0) return { x: pos.x, y: pos.y };
  const total = speed * dtSec;
  const steps = Math.max(1, Math.ceil(total / MAX_SUBSTEP));
  const sx = (dir.x / len) * (total / steps);
  const sy = (dir.y / len) * (total / steps);
  let x = pos.x, y = pos.y;
  for (let i = 0; i < steps; i++) {
    if (sx !== 0 && !isBlockedAt(map, x + sx, y)) x += sx;
    if (sy !== 0 && !isBlockedAt(map, x, y + sy)) y += sy;
  }
  return { x, y };
}

export function inputDir(k: KeyState): Vec {
  return { x: (k.right ? 1 : 0) - (k.left ? 1 : 0), y: (k.down ? 1 : 0) - (k.up ? 1 : 0) };
}

/** Keyboard facing: with diagonal input the horizontal component wins. */
export function facingFor(dir: Vec, prev: Facing): Facing {
  if (dir.x < 0) return "left";
  if (dir.x > 0) return "right";
  if (dir.y < 0) return "up";
  if (dir.y > 0) return "down";
  return prev;
}

/** Path facing: the dominant axis of the segment. */
export function facingForVector(v: Vec, prev: Facing): Facing {
  if (v.x === 0 && v.y === 0) return prev;
  if (Math.abs(v.x) >= Math.abs(v.y)) return v.x < 0 ? "left" : "right";
  return v.y < 0 ? "up" : "down";
}
```

- [ ] **Step 6: Implement `lib/game/pathfinding.ts`**

```ts
import type { GameMap } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { cellBlocked, isBlockedAt } from "@/lib/game/movement";

export const MAX_PATH_POINTS = 32;

export function cellCenter(map: GameMap, c: number, r: number): Vec {
  return { x: c * map.cell + map.cell / 2, y: r * map.cell + map.cell / 2 };
}

export function nearestWalkableCell(map: GameMap, c: number, r: number, radius = 3): { c: number; r: number } | null {
  let best: { c: number; r: number } | null = null;
  let bestD = Infinity;
  for (let dr = -radius; dr <= radius; dr++) for (let dc = -radius; dc <= radius; dc++) {
    const cc = c + dc, rr = r + dr;
    if (cellBlocked(map, cc, rr)) continue;
    const d = dc * dc + dr * dr;
    if (d < bestD) { bestD = d; best = { c: cc, r: rr }; }
  }
  return best;
}

class MinHeap {
  private ids: number[] = [];
  private pri: number[] = [];
  get size(): number { return this.ids.length; }
  push(id: number, p: number): void {
    this.ids.push(id);
    this.pri.push(p);
    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.pri[parent] <= this.pri[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!, lastP = this.pri.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.pri[0] = lastP;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.ids.length && this.pri[l] < this.pri[m]) m = l;
        if (r < this.ids.length && this.pri[r] < this.pri[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.pri[a], this.pri[b]] = [this.pri[b], this.pri[a]];
  }
}

/** A* over the 8-px grid (8 neighbours, no corner cutting, octile heuristic).
 *  Returns cell-centre waypoints (start cell excluded) ending exactly at `to` when it is free;
 *  a blocked target snaps to the nearest walkable cell within 3 cells; unreachable → null. */
export function findPath(map: GameMap, from: Vec, to: Vec, maxNodes = 5000): Vec[] | null {
  const cols = map.cols;
  const sc = Math.floor(from.x / map.cell), sr = Math.floor(from.y / map.cell);
  let gc = Math.floor(to.x / map.cell), gr = Math.floor(to.y / map.cell);
  let exactEnd: Vec | null = isBlockedAt(map, to.x, to.y) ? null : { x: to.x, y: to.y };
  if (cellBlocked(map, gc, gr)) {
    const alt = nearestWalkableCell(map, gc, gr, 3);
    if (!alt) return null;
    gc = alt.c;
    gr = alt.r;
    exactEnd = null;
  }
  const goalPoint = exactEnd ?? cellCenter(map, gc, gr);
  if (sc === gc && sr === gr) return [goalPoint];
  const n = cols * map.rows;
  const g = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const start = sr * cols + sc, goal = gr * cols + gc;
  const h = (c: number, r: number) => {
    const dx = Math.abs(c - gc), dy = Math.abs(r - gr);
    return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
  };
  g[start] = 0;
  heap.push(start, h(sc, sr));
  let expanded = 0;
  while (heap.size > 0) {
    const cur = heap.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) return null;
    const cc = cur % cols, cr = (cur - cc) / cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (dc === 0 && dr === 0) continue;
      const nc = cc + dc, nr = cr + dr;
      if (cellBlocked(map, nc, nr)) continue;
      if (dc !== 0 && dr !== 0 && (cellBlocked(map, cc + dc, cr) || cellBlocked(map, cc, cr + dr))) continue;
      const ni = nr * cols + nc;
      if (closed[ni]) continue;
      const ng = g[cur] + (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1);
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        heap.push(ni, ng + h(nc, nr));
      }
    }
  }
  if (came[goal] === -1) return null;
  const pts: Vec[] = [];
  for (let i = goal; i !== start; i = came[i]) {
    const c = i % cols;
    pts.push(cellCenter(map, c, (i - c) / cols));
  }
  pts.reverse();
  pts[pts.length - 1] = goalPoint;
  return pts;
}

/** Can the feet box travel in a straight line from a to b? (sampled every 2 px) */
export function lineClear(map: GameMap, a: Vec, b: Vec): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    if (isBlockedAt(map, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}

/** Greedy string-pulling: keep only the waypoints needed to stay in line of sight (≤ 32 points). */
export function smoothPath(map: GameMap, from: Vec, points: Vec[]): Vec[] {
  const out: Vec[] = [];
  let anchor = from;
  let i = 0;
  while (i < points.length) {
    let j = points.length - 1;
    while (j > i && !lineClear(map, anchor, points[j])) j--;
    out.push(points[j]);
    anchor = points[j];
    i = j + 1;
  }
  return out.length > MAX_PATH_POINTS ? out.slice(0, MAX_PATH_POINTS) : out;
}
```

- [ ] **Step 7: Run to verify they pass**

Run: `pnpm vitest run tests/unit/game-movement.test.ts tests/unit/game-pathfinding.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 8: Lint + commit**

```bash
npx eslint lib/game/maps/types.ts lib/game/movement.ts lib/game/pathfinding.ts tests/unit/helpers/ascii-map.ts tests/unit/game-movement.test.ts tests/unit/game-pathfinding.test.ts
git add lib/game/maps/types.ts lib/game/movement.ts lib/game/pathfinding.ts tests/unit/helpers/ascii-map.ts tests/unit/game-movement.test.ts tests/unit/game-pathfinding.test.ts
git commit -m "feat(v13): grid collision, keyboard movement, A* pathfinding

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The hall map (layout + collision)

**Files:**
- Create: `lib/game/maps/hall.ts`
- Test: `tests/unit/game-hall-map.test.ts`

**Interfaces:**
- Consumes: Task 8 types/functions.
- Produces: `HALL_W = 640`, `HALL_H = 400`, `HALL_CELL = 8`, `hallShoreY(x)`, `HALL_SOLIDS`, `HALL_WALKABLE`, `HALL_INTERACTABLES`, `HALL_SEATS`, `HALL_STAND_SPOTS`, `HALL_DJ_SPOT`, `HALL_PROPS`, `LIGHT_STRINGS`, `overlaps(a, b)`, `buildHallMap(): GameMap`. The art task (12) paints exactly these coordinates.

Layout (north = top): bamboo grove west, stage + banner + speakers north-centre (DJ booth = mixer on the stage front), café counter "Quầy nước" north-east, hammock tied between palm A and a post west, three café tables east, notice board beside the east entrance path, river along the south with a wooden dock (walkable) and the dock sign.

- [ ] **Step 1: Write the failing test**

`tests/unit/game-hall-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildHallMap, HALL_CELL, HALL_H, HALL_W } from "@/lib/game/maps/hall";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";

const hall = buildHallMap();

describe("hall map", () => {
  it("has the documented size and grid", () => {
    expect([hall.width, hall.height, hall.cell]).toEqual([HALL_W, HALL_H, HALL_CELL]);
    expect(hall.blocked).toHaveLength((640 / 8) * (400 / 8));
  });
  it("has walkable spawn, seats, stand spots and interactable use spots, all reachable from the spawn", () => {
    const spots = [hall.spawn, ...hall.seats, ...hall.standSpots, ...hall.interactables.map((i) => i.use)];
    for (const s of spots) {
      expect(isBlockedAt(hall, s.x, s.y), JSON.stringify(s)).toBe(false);
      expect(findPath(hall, hall.spawn, s), JSON.stringify(s)).not.toBeNull();
    }
  });
  it("blocks the water but not the dock, and blocks the stage", () => {
    expect(isBlockedAt(hall, 300, 390)).toBe(true);
    expect(isBlockedAt(hall, 516, 380)).toBe(false);
    expect(isBlockedAt(hall, 320, 80)).toBe(true);
  });
  it("has unique interactables with the three v13 ids", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual(["dj_booth", "dock_sign", "notice_board"]);
  });
  it("has six café seats", () => {
    expect(hall.seats).toHaveLength(6);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-hall-map.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/maps/hall`.

- [ ] **Step 3: Implement `lib/game/maps/hall.ts`**

```ts
import type { GameMap, Interactable, PropPlacement, Rect, Spot } from "./types";

export const HALL_W = 640;
export const HALL_H = 400;
export const HALL_CELL = 8;

/** Y of the river bank at x (water below it). Shared with the art so collision and pixels agree. */
export function hallShoreY(x: number): number {
  return 338 + 5 * Math.sin(x / 40) + 2 * Math.sin(x / 13);
}

export const HALL_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: 72, h: 150 },      // bamboo grove
  { x: 232, y: 0, w: 176, h: 140 },   // stage + backstage
  { x: 466, y: 0, w: 138, h: 106 },   // café counter "Quầy nước" + behind it
  { x: 84, y: 192, w: 12, h: 8 },     // palm A trunk (hammock anchor)
  { x: 24, y: 322, w: 12, h: 8 },     // palm B trunk
  { x: 620, y: 120, w: 12, h: 8 },    // palm C trunk
  { x: 100, y: 188, w: 62, h: 14 },   // hammock
  { x: 166, y: 196, w: 8, h: 8 },     // hammock post
  { x: 456, y: 192, w: 28, h: 12 },   // table 1
  { x: 546, y: 192, w: 28, h: 12 },   // table 2
  { x: 501, y: 250, w: 28, h: 12 },   // table 3
  { x: 584, y: 250, w: 24, h: 12 },   // notice board
  { x: 484, y: 314, w: 14, h: 10 },   // dock sign
  { x: 204, y: 138, w: 12, h: 8 },    // banana plant west of the stage
  { x: 434, y: 132, w: 12, h: 8 },    // banana plant east of the stage
  { x: 158, y: 184, w: 4, h: 4 },     // light pole west
  { x: 444, y: 166, w: 4, h: 4 },     // light pole east
];

/** Walkable even over water. */
export const HALL_WALKABLE: Rect[] = [{ x: 500, y: 316, w: 32, h: 84 }]; // wooden dock

export const HALL_INTERACTABLES: Interactable[] = [
  { id: "dj_booth", label: "Quầy DJ", rect: { x: 296, y: 106, w: 48, h: 34 }, use: { x: 320, y: 152 } },
  { id: "notice_board", label: "Bảng tin", rect: { x: 582, y: 228, w: 28, h: 34 }, use: { x: 596, y: 270 } },
  { id: "dock_sign", label: "Bến câu cá", rect: { x: 482, y: 300, w: 18, h: 24 }, use: { x: 516, y: 334 } },
];

/** Classic-mode members stand behind the café tables (the table sprite hides their legs). */
export const HALL_SEATS: Spot[] = [
  { x: 462, y: 190, dir: "down" }, { x: 478, y: 190, dir: "down" },
  { x: 552, y: 190, dir: "down" }, { x: 568, y: 190, dir: "down" },
  { x: 507, y: 246, dir: "down" }, { x: 523, y: 246, dir: "down" },
];
export const HALL_STAND_SPOTS: Spot[] = [
  { x: 180, y: 172, dir: "down" }, { x: 452, y: 158, dir: "down" }, { x: 150, y: 280, dir: "right" },
  { x: 430, y: 300, dir: "left" }, { x: 260, y: 306, dir: "up" }, { x: 380, y: 168, dir: "down" },
];
/** A classic-mode DJ is drawn on the stage behind the mixer. */
export const HALL_DJ_SPOT: Spot = { x: 320, y: 124, dir: "down" };

export const HALL_PROPS: PropPlacement[] = [
  { kind: "palm", x: 90, y: 198, h: 72, lean: 0.35, seed: 3 },
  { kind: "palm", x: 30, y: 328, h: 64, lean: 0.45, seed: 7 },
  { kind: "palm", x: 626, y: 126, h: 70, lean: -0.5, seed: 11 },
  { kind: "hammock", x: 96, y: 202, x2: 170 },
  { kind: "post", x: 170, y: 204 },
  { kind: "mixer", x: 320, y: 130 },
  { kind: "table", x: 470, y: 204 },
  { kind: "table", x: 560, y: 204 },
  { kind: "table", x: 515, y: 262 },
  { kind: "board", x: 596, y: 262 },
  { kind: "sign", x: 491, y: 324 },
  { kind: "banana", x: 210, y: 146 },
  { kind: "banana", x: 440, y: 140 },
  { kind: "lightpole", x: 160, y: 188 },
  { kind: "lightpole", x: 446, y: 170 },
];

/** Overhead string lights: [x1, y1, x2, y2, sag] in world px (drawn above everything). */
export const LIGHT_STRINGS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [246, 24, 100, 128, 10],   // stage west pole → palm A crown
  [394, 24, 612, 58, 12],    // stage east pole → palm C crown
  [160, 152, 446, 134, 14],  // across the yard between the light poles
];

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function buildHallMap(): GameMap {
  const cols = HALL_W / HALL_CELL, rows = HALL_H / HALL_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * HALL_CELL, y: r * HALL_CELL, w: HALL_CELL, h: HALL_CELL };
    const cx = cell.x + HALL_CELL / 2, cy = cell.y + HALL_CELL / 2;
    let b = cy >= hallShoreY(cx) - 6 || HALL_SOLIDS.some((s) => overlaps(s, cell));
    if (HALL_WALKABLE.some((s) => overlaps(s, cell))) b = false;
    blocked[r * cols + c] = b ? 1 : 0;
  }
  return {
    id: "hall", width: HALL_W, height: HALL_H, cell: HALL_CELL, cols, rows, blocked,
    spawn: { x: 612, y: 300 }, djSpot: HALL_DJ_SPOT, seats: HALL_SEATS, standSpots: HALL_STAND_SPOTS,
    interactables: HALL_INTERACTABLES, props: HALL_PROPS,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/game-hall-map.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/game/maps/hall.ts tests/unit/game-hall-map.test.ts
git add lib/game/maps/hall.ts tests/unit/game-hall-map.test.ts
git commit -m "feat(v13): riverside café hall map + collision grid

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Actor simulation (local + remote players)

**Files:**
- Create: `lib/game/actor.ts`
- Test: `tests/unit/game-actor.test.ts`

**Interfaces:**
- Consumes: `stepMove`, `facingFor`, `facingForVector`, `WALK_SPEED` (Task 8), `GameMap`.
- Produces: `interface Actor { id; pos; display; facing; dir; moving; path: Vec[] | null; lastMsgAt; walkT }`, `SNAP_DIST = 48`, `STALE_MS = 4000`, `BLEND_PER_SEC = 12`, `createActor(id, at, facing?, now?)`, `setKeyboard(a, dir)`, `setPath(a, pts)`, `applyStateMsg(a, { x, y, facing, moving, vx, vy }, now)`, `applyPathMsg(a, { x, y, pts }, now)`, `tickActor(map, a, dtSec, now, remote): boolean` (true when a path just finished), `walkFrame(a): 0|1|2|3`.

All functions mutate the actor in place (the engine keeps one object per player).

- [ ] **Step 1: Write the failing test**

`tests/unit/game-actor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { applyPathMsg, applyStateMsg, createActor, setKeyboard, setPath, tickActor, walkFrame } from "@/lib/game/actor";
import { mapFromAscii } from "./helpers/ascii-map";

const open = mapFromAscii(Array(10).fill(".........."));
const wall = mapFromAscii(Array(10).fill(".....#...."));

describe("paths", () => {
  it("walks the waypoints and reports arrival once", () => {
    const a = createActor("a", { x: 40, y: 40 });
    setPath(a, [{ x: 60, y: 40 }, { x: 60, y: 60 }]);
    let arrived = false, now = 0;
    for (let i = 0; i < 100 && !arrived; i++) arrived = tickActor(open, a, 0.05, (now += 50), false);
    expect(arrived).toBe(true);
    expect(a.pos).toEqual({ x: 60, y: 60 });
    expect(a.moving).toBe(false);
    expect(a.facing).toBe("down");
    expect(tickActor(open, a, 0.05, now + 50, false)).toBe(false);
  });
  it("keyboard input cancels a path", () => {
    const a = createActor("a", { x: 40, y: 40 });
    setPath(a, [{ x: 70, y: 40 }]);
    setKeyboard(a, { x: -1, y: 0 });
    expect(a.path).toBeNull();
    expect(a.facing).toBe("left");
  });
});

describe("remote players", () => {
  it("extrapolate keyboard movement through the same collision", () => {
    const r = createActor("r", { x: 20, y: 40 });
    applyStateMsg(r, { x: 20, y: 40, facing: "right", moving: true, vx: 1, vy: 0 }, 0);
    tickActor(wall, r, 0.5, 100, true);
    expect(r.pos.x).toBeLessThan(37);
  });
  it("stop after 4 s without messages", () => {
    const r = createActor("r", { x: 20, y: 20 });
    applyStateMsg(r, { x: 20, y: 20, facing: "right", moving: true, vx: 1, vy: 0 }, 0);
    tickActor(open, r, 0.05, 4100, true);
    expect(r.moving).toBe(false);
  });
  it("snap when far, blend when near", () => {
    const far = createActor("f", { x: 20, y: 20 });
    applyStateMsg(far, { x: 75, y: 20, facing: "right", moving: false, vx: 0, vy: 0 }, 0);
    expect(far.display.x).toBe(75);
    const near = createActor("n", { x: 20, y: 20 });
    applyStateMsg(near, { x: 30, y: 20, facing: "right", moving: false, vx: 0, vy: 0 }, 0);
    expect(near.display.x).toBe(20);
    tickActor(open, near, 0.05, 50, true);
    expect(near.display.x).toBeGreaterThan(20);
    expect(near.display.x).toBeLessThan(30);
  });
  it("start walking on a path message", () => {
    const r = createActor("r", { x: 20, y: 20 });
    applyPathMsg(r, { x: 30, y: 20, pts: [{ x: 50, y: 20 }] }, 0);
    expect(r.moving).toBe(true);
    expect(r.path).toEqual([{ x: 50, y: 20 }]);
  });
});

describe("walkFrame", () => {
  it("is 0 when idle and cycles 0-3 at 8 fps while walking", () => {
    const a = createActor("a", { x: 40, y: 40 });
    expect(walkFrame(a)).toBe(0);
    setKeyboard(a, { x: 1, y: 0 });
    tickActor(open, a, 0.13, 130, false);
    expect(walkFrame(a)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-actor.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/actor`.

- [ ] **Step 3: Implement `lib/game/actor.ts`**

```ts
import type { GameMap } from "@/lib/game/maps/types";
import type { Facing, Vec } from "@/lib/game/types";
import { facingFor, facingForVector, stepMove, WALK_SPEED } from "@/lib/game/movement";

/** One walking character. The local player and every remote player use the same simulation. */
export interface Actor {
  id: string;
  /** Simulated position (feet). */
  pos: Vec;
  /** Drawn position — remote players ease toward `pos`; the local player equals `pos`. */
  display: Vec;
  facing: Facing;
  /** Keyboard direction, each axis -1/0/1. */
  dir: Vec;
  moving: boolean;
  path: Vec[] | null;
  lastMsgAt: number;
  /** Seconds spent walking (animation clock). */
  walkT: number;
}

export const SNAP_DIST = 48;
export const STALE_MS = 4000;
export const BLEND_PER_SEC = 12;

export function createActor(id: string, at: Vec, facing: Facing = "down", now = 0): Actor {
  return { id, pos: { ...at }, display: { ...at }, facing, dir: { x: 0, y: 0 }, moving: false, path: null, lastMsgAt: now, walkT: 0 };
}

export function setKeyboard(a: Actor, dir: Vec): void {
  a.path = null;
  a.dir = { x: dir.x, y: dir.y };
  a.moving = dir.x !== 0 || dir.y !== 0;
  a.facing = facingFor(dir, a.facing);
}

export function setPath(a: Actor, pts: Vec[]): void {
  a.path = pts.map((p) => ({ x: p.x, y: p.y }));
  a.dir = { x: 0, y: 0 };
  a.moving = a.path.length > 0;
  if (!a.moving) a.path = null;
}

function snapIfFar(a: Actor): void {
  if (Math.hypot(a.display.x - a.pos.x, a.display.y - a.pos.y) > SNAP_DIST) a.display = { ...a.pos };
}

export function applyStateMsg(
  a: Actor,
  m: { x: number; y: number; facing: Facing; moving: boolean; vx: number; vy: number },
  now: number,
): void {
  a.pos = { x: m.x, y: m.y };
  a.facing = m.facing;
  a.moving = m.moving;
  a.dir = m.moving ? { x: m.vx, y: m.vy } : { x: 0, y: 0 };
  a.path = null;
  a.lastMsgAt = now;
  snapIfFar(a);
}

export function applyPathMsg(a: Actor, m: { x: number; y: number; pts: Vec[] }, now: number): void {
  a.pos = { x: m.x, y: m.y };
  setPath(a, m.pts);
  a.lastMsgAt = now;
  snapIfFar(a);
}

/** Advance one frame. Returns true exactly when a path has just been completed. */
export function tickActor(map: GameMap, a: Actor, dtSec: number, now: number, remote: boolean): boolean {
  let arrived = false;
  if (a.path) {
    let budget = WALK_SPEED * dtSec;
    while (budget > 0 && a.path.length > 0) {
      const t = a.path[0];
      const dx = t.x - a.pos.x, dy = t.y - a.pos.y, d = Math.hypot(dx, dy);
      if (d > 0.01) a.facing = facingForVector({ x: dx, y: dy }, a.facing);
      if (d <= budget) {
        a.pos = { x: t.x, y: t.y };
        budget -= d;
        a.path.shift();
      } else {
        a.pos = { x: a.pos.x + (dx / d) * budget, y: a.pos.y + (dy / d) * budget };
        budget = 0;
      }
    }
    if (a.path.length === 0) {
      a.path = null;
      a.moving = false;
      arrived = true;
    }
  } else if (a.moving) {
    if (remote && now - a.lastMsgAt > STALE_MS) {
      a.moving = false; // lost "stop" guard
      a.dir = { x: 0, y: 0 };
    } else {
      a.pos = stepMove(map, a.pos, a.dir, dtSec);
    }
  }
  a.walkT = a.moving ? a.walkT + dtSec : 0;
  if (remote) {
    const k = Math.min(1, BLEND_PER_SEC * dtSec);
    a.display = { x: a.display.x + (a.pos.x - a.display.x) * k, y: a.display.y + (a.pos.y - a.display.y) * k };
  } else {
    a.display = { x: a.pos.x, y: a.pos.y };
  }
  return arrived;
}

export function walkFrame(a: Actor): 0 | 1 | 2 | 3 {
  return a.moving ? ((Math.floor(a.walkT * 8) % 4) as 0 | 1 | 2 | 3) : 0;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/game-actor.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/game/actor.ts tests/unit/game-actor.test.ts
git add lib/game/actor.ts tests/unit/game-actor.test.ts
git commit -m "feat(v13): actor simulation for local and remote players

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Network protocol + send gate, seating, bubble text

**Files:**
- Create: `lib/game/net/protocol.ts`, `lib/game/seating.ts`, `lib/game/text.ts`
- Test: `tests/unit/game-protocol.test.ts`, `tests/unit/game-seating-text.test.ts`

**Interfaces:**
- Consumes: `Facing` (Task 5), `Spot` (Task 8), `MAX_PATH_POINTS` (Task 8 `pathfinding.ts`, re-exported).
- Produces:
  - `protocol.ts`: `FacingCode`, `Unit`, `GameMessage` (`hello | st | mv | pa | lk | bye`, see spec §8.2), `GameEvent`, `GAME_EVENTS`, `MAX_PATH_POINTS`, `facingToCode`, `codeToFacing`, `parseGameMessage(event, payload, bounds)`, `toPayload(msg)`, `SendGate { push; dispose }`, `SendGateOptions`, `createSendGate(send, opts?)` — 3 msgs/s, burst 3, movement (`mv`/`pa`/`st`) coalesced to the latest, control (`hello`/`lk`/`bye`) FIFO first.
  - `seating.ts`: `assignSpots(classicIds, seats, standSpots): Map<string, Spot>`.
  - `text.ts`: `wrapBubble(text, maxChars = 28, maxLines = 2): string[]`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/game-protocol.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { codeToFacing, createSendGate, facingToCode, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";

const B = { width: 640, height: 400 };
const mv = (x: number): GameMessage => ({ t: "mv", id: "me", x, y: 0, d: "r", mv: true, vx: 1, vy: 0 });

describe("parseGameMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parseGameMessage("hello", { id: "a" }, B)).toEqual({ t: "hello", id: "a" });
    expect(parseGameMessage("mv", { id: "a", x: 1, y: 2, d: "l", mv: true, vx: -1, vy: 0 }, B)?.t).toBe("mv");
    expect(parseGameMessage("pa", { id: "a", x: 1, y: 2, pts: [[3, 4]] }, B)).toEqual({ t: "pa", id: "a", x: 1, y: 2, pts: [[3, 4]] });
  });
  it("rejects malformed or out-of-range messages", () => {
    const bad: Array<[string, unknown]> = [
      ["hello", { id: "" }], ["hello", null], ["nope", { id: "a" }],
      ["mv", { id: "a", x: 1.5, y: 2, d: "l", mv: true, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 700, y: 2, d: "l", mv: true, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 1, y: 2, d: "x", mv: true, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 1, y: 2, d: "l", mv: 1, vx: -1, vy: 0 }],
      ["mv", { id: "a", x: 1, y: 2, d: "l", mv: true, vx: 2, vy: 0 }],
      ["pa", { id: "a", x: 1, y: 2, pts: [] }],
      ["pa", { id: "a", x: 1, y: 2, pts: Array.from({ length: 33 }, () => [1, 1]) }],
      ["pa", { id: "a", x: 1, y: 2, pts: [[3]] }],
    ];
    for (const [event, payload] of bad) expect(parseGameMessage(event, payload, B), `${event} ${JSON.stringify(payload)}`).toBeNull();
  });
  it("round-trips facings and strips the type into the event name", () => {
    expect(codeToFacing(facingToCode("left"))).toBe("left");
    expect(toPayload({ t: "lk", id: "a" })).toEqual({ event: "lk", payload: { id: "a" } });
  });
});

describe("createSendGate", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("sends a burst of 3, then coalesces movement to the latest state", () => {
    vi.useFakeTimers();
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m));
    for (let i = 1; i <= 5; i++) gate.push(mv(i));
    expect(sent.map((m) => (m as { x: number }).x)).toEqual([1, 2, 3]);
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(3);
    vi.advanceTimersByTime(200);
    expect(sent.map((m) => (m as { x: number }).x)).toEqual([1, 2, 3, 5]);
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(4);
    gate.dispose();
  });

  it("queues control messages FIFO and goes silent after dispose", () => {
    vi.useFakeTimers();
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m));
    gate.push({ t: "hello", id: "me" });
    gate.push({ t: "lk", id: "me" });
    gate.push({ t: "bye", id: "me" });
    gate.push({ t: "lk", id: "me" });
    expect(sent.map((m) => m.t)).toEqual(["hello", "lk", "bye"]);
    vi.advanceTimersByTime(400);
    expect(sent.map((m) => m.t)).toEqual(["hello", "lk", "bye", "lk"]);
    gate.dispose();
    gate.push({ t: "hello", id: "me" });
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(4);
  });
});
```

`tests/unit/game-seating-text.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assignSpots } from "@/lib/game/seating";
import { wrapBubble } from "@/lib/game/text";
import type { Spot } from "@/lib/game/maps/types";

const seats: Spot[] = [{ x: 1, y: 1, dir: "down" }, { x: 2, y: 2, dir: "down" }];
const stand: Spot[] = [{ x: 9, y: 9, dir: "left" }];

describe("assignSpots", () => {
  it("seats classic members by sorted id, then overflows to stand spots", () => {
    const spots = assignSpots(["c", "a", "b", "a"], seats, stand);
    expect(spots.get("a")).toEqual(seats[0]);
    expect(spots.get("b")).toEqual(seats[1]);
    expect(spots.get("c")).toEqual(stand[0]);
  });
  it("returns nothing when there are no spots", () => {
    expect(assignSpots(["a"], [], []).size).toBe(0);
  });
});

describe("wrapBubble", () => {
  it("keeps short text on one line and collapses whitespace", () => {
    expect(wrapBubble("xin chào")).toEqual(["xin chào"]);
    expect(wrapBubble("  hello   world  ")).toEqual(["hello world"]);
    expect(wrapBubble("")).toEqual([]);
  });
  it("wraps at 28 chars into at most 2 lines with an ellipsis", () => {
    const lines = wrapBubble("bài này hay quá trời luôn á mọi người ơi nghe đi nghe lại hoài không chán");
    expect(lines).toHaveLength(2);
    expect(lines[1].endsWith("…")).toBe(true);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(28);
  });
  it("hard-breaks a very long word", () => {
    const lines = wrapBubble("a".repeat(70));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toHaveLength(28);
    expect(lines[1]).toHaveLength(28);
    expect(lines[1].endsWith("…")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/game-protocol.test.ts tests/unit/game-seating-text.test.ts`
Expected: FAIL — cannot resolve the new modules.

- [ ] **Step 3: Implement `lib/game/net/protocol.ts`**

```ts
import { MAX_PATH_POINTS } from "@/lib/game/pathfinding";
import type { Facing } from "@/lib/game/types";

/** Same cap as the path smoother: a `pa` message never carries more points. */
export { MAX_PATH_POINTS };

export type FacingCode = "u" | "d" | "l" | "r";
export type Unit = -1 | 0 | 1;

/** Broadcast messages on channel `game:{roomId}` (spec §8.2). `id` = sender account id. */
export type GameMessage =
  | { t: "hello"; id: string }
  | { t: "st" | "mv"; id: string; x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit }
  | { t: "pa"; id: string; x: number; y: number; pts: Array<[number, number]> }
  | { t: "lk"; id: string }
  | { t: "bye"; id: string };
export type GameEvent = GameMessage["t"];

export const GAME_EVENTS: readonly GameEvent[] = ["hello", "st", "mv", "pa", "lk", "bye"];

const TO_CODE: Record<Facing, FacingCode> = { up: "u", down: "d", left: "l", right: "r" };
const FROM_CODE: Record<FacingCode, Facing> = { u: "up", d: "down", l: "left", r: "right" };
export function facingToCode(f: Facing): FacingCode { return TO_CODE[f]; }
export function codeToFacing(c: FacingCode): Facing { return FROM_CODE[c]; }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isUnit = (v: unknown): v is Unit => v === -1 || v === 0 || v === 1;
const isCode = (v: unknown): v is FacingCode => v === "u" || v === "d" || v === "l" || v === "r";

/** Validate an incoming broadcast; anything malformed or outside the map → null. */
export function parseGameMessage(event: string, payload: unknown, bounds: { width: number; height: number }): GameMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!isId(p.id)) return null;
  const inMap = (x: unknown, y: unknown): boolean =>
    isInt(x) && isInt(y) && x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
  switch (event) {
    case "hello":
    case "lk":
    case "bye":
      return { t: event, id: p.id };
    case "st":
    case "mv":
      if (!inMap(p.x, p.y) || !isCode(p.d) || typeof p.mv !== "boolean" || !isUnit(p.vx) || !isUnit(p.vy)) return null;
      return { t: event, id: p.id, x: p.x as number, y: p.y as number, d: p.d, mv: p.mv, vx: p.vx, vy: p.vy };
    case "pa": {
      if (!inMap(p.x, p.y) || !Array.isArray(p.pts) || p.pts.length === 0 || p.pts.length > MAX_PATH_POINTS) return null;
      const pts: Array<[number, number]> = [];
      for (const q of p.pts as unknown[]) {
        if (!Array.isArray(q) || q.length !== 2 || !inMap(q[0], q[1])) return null;
        pts.push([q[0] as number, q[1] as number]);
      }
      return { t: "pa", id: p.id, x: p.x as number, y: p.y as number, pts };
    }
    default:
      return null;
  }
}

export function toPayload(msg: GameMessage): { event: GameEvent; payload: Record<string, unknown> } {
  const { t, ...rest } = msg;
  return { event: t, payload: rest };
}

export interface SendGate { push(msg: GameMessage): void; dispose(): void }
export interface SendGateOptions {
  ratePerSec?: number;
  burst?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Token bucket (default 3 msgs/s, burst 3). Movement messages (mv/pa/st) are coalesced to the latest one;
 *  control messages (hello/lk/bye) are queued FIFO and go first. */
export function createSendGate(send: (msg: GameMessage) => void, opts: SendGateOptions = {}): SendGate {
  const rate = opts.ratePerSec ?? 3;
  const burst = opts.burst ?? 3;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let tokens = burst;
  let last = now();
  let timer: unknown = null;
  let disposed = false;
  let pendingMove: GameMessage | null = null;
  const queue: GameMessage[] = [];

  const refill = () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate);
    last = t;
  };
  const flush = () => {
    timer = null;
    if (disposed) return;
    refill();
    while (tokens >= 1) {
      const next = queue.length > 0 ? queue.shift()! : pendingMove;
      if (!next) break;
      if (next === pendingMove) pendingMove = null;
      tokens -= 1;
      send(next);
    }
    if (queue.length > 0 || pendingMove) {
      const wait = Math.max(10, Math.ceil(((1 - tokens) / rate) * 1000));
      timer = setTimer(flush, wait);
    }
  };
  return {
    push(msg) {
      if (disposed) return;
      if (msg.t === "mv" || msg.t === "pa" || msg.t === "st") pendingMove = msg;
      else queue.push(msg);
      if (timer === null) flush();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      queue.length = 0;
      pendingMove = null;
    },
  };
}
```

- [ ] **Step 4: Implement `lib/game/seating.ts` and `lib/game/text.ts`**

`lib/game/seating.ts`:

```ts
import type { Spot } from "@/lib/game/maps/types";

/** Deterministic placement of classic-mode members (every client computes the same result):
 *  ids sorted ascending take the seats in order, the rest cycle through the stand spots. */
export function assignSpots(classicIds: string[], seats: Spot[], standSpots: Spot[]): Map<string, Spot> {
  const out = new Map<string, Spot>();
  const ids = [...new Set(classicIds)].sort();
  ids.forEach((id, i) => {
    if (i < seats.length) out.set(id, seats[i]);
    else if (standSpots.length > 0) out.set(id, standSpots[(i - seats.length) % standSpots.length]);
  });
  return out;
}
```

`lib/game/text.ts`:

```ts
/** Word-wrap a chat message for a bubble: ≤ maxLines lines of ≤ maxChars, "…" when cut. */
export function wrapBubble(text: string, maxChars = 28, maxLines = 2): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    let w = word;
    while (w.length > maxChars) {
      if (cur) { lines.push(cur); cur = ""; }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!w) continue;
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const lastLine = kept[maxLines - 1];
  kept[maxLines - 1] = (lastLine.length >= maxChars ? lastLine.slice(0, maxChars - 1) : lastLine) + "…";
  return kept;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run tests/unit/game-protocol.test.ts tests/unit/game-seating-text.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Lint + commit**

```bash
npx eslint lib/game/net/protocol.ts lib/game/seating.ts lib/game/text.ts tests/unit/game-protocol.test.ts tests/unit/game-seating-text.test.ts
git add lib/game/net/protocol.ts lib/game/seating.ts lib/game/text.ts tests/unit/game-protocol.test.ts tests/unit/game-seating-text.test.ts
git commit -m "feat(v13): broadcast protocol + send gate, seating, bubble wrapping

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Hall art — procedural scene painters

**Files:**
- Create: `lib/game/maps/hall-art.ts`
- Test: `tests/unit/game-hall-art.test.ts`

**Interfaces:**
- Consumes: `HALL_W`, `HALL_H`, `LIGHT_STRINGS`, `hallShoreY`, `HALL_PROPS`, `buildHallMap` (Task 9); `GameMap`, `PropPlacement`, `Rect` (Task 8).
- Produces: `interface PropSprite { canvas; x; y; sortY }`, `interface HallArt { background; props; drawAnimated(ctx, t, camX, camY, reducedMotion); drawOverhead(ctx, t, camX, camY, reducedMotion) }`, `interface PropFrame { w; h; ox; oy }`, `rng(seed): () => number`, `propFrame(p): PropFrame` (pure), `paintHall(map): HallArt` (browser only; throws `"canvas-2d-unavailable"` without a 2D context).

The painters are the approved mockup scene (`.superpowers/brainstorm/1961-1790232701/content/hall-check.html`) ported 1 : 1 — every coordinate matches the collision/interactable data of Task 9. jsdom has no canvas, so only the pure parts (`rng`, `propFrame`) are unit-tested; the pixels are checked in the browser in Task 17.

- [ ] **Step 1: Write the failing test**

`tests/unit/game-hall-art.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildHallMap, HALL_PROPS } from "@/lib/game/maps/hall";
import { propFrame, rng } from "@/lib/game/maps/hall-art";
import type { PropPlacement, Rect } from "@/lib/game/maps/types";

const hall = buildHallMap();
const box = (p: PropPlacement): Rect => {
  const f = propFrame(p);
  return { x: p.x - f.ox, y: p.y - f.oy, w: f.w, h: f.h };
};
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const prop = (kind: PropPlacement["kind"]) => HALL_PROPS.find((p) => p.kind === kind)!;
const target = (id: string) => hall.interactables.find((i) => i.id === id)!.rect;

describe("hall art (pure parts)", () => {
  it("rng is deterministic and stays in [0, 1)", () => {
    const a = rng(42), b = rng(42);
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(1)()).not.toBe(rng(2)());
  });

  it("anchors every prop at the bottom of its sprite frame", () => {
    for (const p of HALL_PROPS) {
      const f = propFrame(p);
      expect(f.ox).toBeGreaterThanOrEqual(0);
      expect(f.ox).toBeLessThanOrEqual(f.w);
      expect(f.oy).toBeGreaterThan(f.h - 4);
      expect(f.oy).toBeLessThanOrEqual(f.h);
    }
  });

  it("draws the clickable things where their interaction rects are", () => {
    expect(contains(target("dj_booth"), box(prop("mixer")))).toBe(true);
    expect(box(prop("board"))).toEqual(target("notice_board"));
    expect(contains(box(prop("sign")), target("dock_sign"))).toBe(true);
  });

  it("sizes the hammock from its two anchors", () => {
    expect(propFrame({ kind: "hammock", x: 96, y: 202, x2: 170 })).toEqual({ w: 82, h: 34, ox: 4, oy: 32 });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-hall-art.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/maps/hall-art`.

- [ ] **Step 3: Implement `lib/game/maps/hall-art.ts`**

```ts
import { HALL_H, HALL_W, LIGHT_STRINGS, hallShoreY } from "./hall";
import type { GameMap, PropPlacement } from "./types";

// Procedural painters for the hall ("quán cà phê võng ven sông"). Browser only (canvas).
// Everything is drawn at 1 world px = 1 canvas px with a seeded RNG, so every client sees the same scene.
// Original art in the approved Miền Tây style — no copied images.

export interface PropSprite { canvas: HTMLCanvasElement; x: number; y: number; sortY: number }

export interface HallArt {
  /** Static 640×400 ground, river, bamboo, stage and counter. */
  background: HTMLCanvasElement;
  /** Depth-sorted sprites (palms, tables, hammock…): world top-left + sort y (= the prop's base). */
  props: PropSprite[];
  /** Per-frame ground animation (speaker pulse, water sparkles), drawn in world coordinates minus the camera. */
  drawAnimated(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
  /** String lights, drawn above the characters. */
  drawOverhead(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
}

/** Sprite canvas size and the anchor (the prop's base point) inside it. Pure. */
export interface PropFrame { w: number; h: number; ox: number; oy: number }

type Ctx = CanvasRenderingContext2D;

const C = {
  outline: "#3a2418",
  grass: "#6aa23c", grassLight: "#7fb548", grassDark: "#5a8f32", grassDeep: "#3f6e23", grassTip: "#8cc452",
  dirt: "#c89a5e", dirtDark: "#b58a52", dirtLight: "#d8b078",
  sand: "#dcc08a", bank: "#b89560", mud: "#8a6a3f",
  water: "#3d86a8", waterDeep: "#2f6e8f", waterLight: "#4a93b4", sparkle: "#a6d6e8", sparkle2: "#6fb2cf",
  wood: "#8b5a33", woodDark: "#6e4424", woodLight: "#a8743f", woodDeep: "#5a381e", woodPale: "#c8905c",
  leaf: "#3d8a3a", leafLight: "#5caa4a", leafHi: "#86c95c", leafDark: "#2f6e2f", leafDeep: "#24592a",
  trunk: "#8a6d4a", trunkLight: "#b08d62", trunkDark: "#6e5438", trunkRing: "#5e4630",
  bamboo: "#8bb84e", bambooDark: "#6a9a38", bambooNode: "#4f7a2a",
  red: "#c0392b", redDark: "#8e2a1f", gold: "#e0b33c", goldLight: "#ffe08a",
  speaker: "#1e1616", speakerFace: "#2b2020", cone: "#4a4040", coneCenter: "#1a1414",
  paper: "#f4efe0", white: "#f4f1ea",
};

/** Deterministic LCG in [0, 1) — the same seed paints the same scene on every client. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function propFrame(p: PropPlacement): PropFrame {
  switch (p.kind) {
    case "palm": return { w: 100, h: p.h + 40, ox: 50, oy: p.h + 38 };
    case "hammock": return { w: p.x2 - p.x + 8, h: 34, ox: 4, oy: 32 };
    case "post": return { w: 6, h: 32, ox: 3, oy: 32 };
    case "mixer": return { w: 44, h: 22, ox: 22, oy: 22 };
    case "table": return { w: 32, h: 30, ox: 16, oy: 30 };
    case "board": return { w: 28, h: 34, ox: 14, oy: 34 };
    case "sign": return { w: 18, h: 26, ox: 9, oy: 26 };
    case "banana": return { w: 40, h: 36, ox: 20, oy: 35 };
    case "lightpole": return { w: 6, h: 42, ox: 3, oy: 42 };
  }
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

function ctx2d(cv: HTMLCanvasElement): Ctx {
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas-2d-unavailable");
  return c;
}

function rect(c: Ctx, col: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------- ground

function inYard(x: number, y: number): boolean {
  const dx = (x - 330) / 245, dy = (y - 238) / 98;
  const n = Math.sin(x * 0.11) * 0.05 + Math.sin(y * 0.17 + x * 0.05) * 0.05;
  return dx * dx + dy * dy < 1 + n;
}

function onPath(x: number, y: number): boolean {
  if (x < 470) return false;
  const mid = 300 + Math.sin(x * 0.05) * 4;
  return Math.abs(y - mid) < 15 + Math.sin(x * 0.3) * 1.5;
}

function paintGround(c: Ctx): void {
  const R = rng(11);
  const img = c.createImageData(HALL_W, HALL_H);
  const d = img.data;
  const pal = {
    grass: hexToRgb(C.grass), grassLight: hexToRgb(C.grassLight), grassDark: hexToRgb(C.grassDark),
    dirt: hexToRgb(C.dirt), dirtDark: hexToRgb(C.dirtDark), dirtLight: hexToRgb(C.dirtLight),
    water: hexToRgb(C.water), waterDeep: hexToRgb(C.waterDeep), waterLight: hexToRgb(C.waterLight),
    sand: hexToRgb(C.sand), bank: hexToRgb(C.bank), mud: hexToRgb(C.mud),
  };
  for (let y = 0; y < HALL_H; y++) {
    for (let x = 0; x < HALL_W; x++) {
      const r = R();
      const sy = Math.round(hallShoreY(x));
      let col: [number, number, number];
      if (y >= sy) col = r < 0.04 ? pal.waterLight : y > sy + 24 ? pal.waterDeep : pal.water;
      else if (y === sy - 1) col = pal.mud;
      else if (y === sy - 2) col = pal.bank;
      else if (y === sy - 3) col = pal.sand;
      else if (inYard(x, y) || onPath(x, y)) col = r < 0.12 ? pal.dirtDark : r < 0.2 ? pal.dirtLight : pal.dirt;
      else col = r < 0.1 ? pal.grassLight : r < 0.17 ? pal.grassDark : pal.grass;
      const i = (y * HALL_W + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // grass tufts + flowers
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(R() * HALL_W), y = Math.floor(R() * HALL_H);
    if (inYard(x, y) || onPath(x, y) || y > hallShoreY(x) - 6) continue;
    px(c, C.grassDeep, x, y); px(c, C.grassDeep, x - 1, y - 1); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x, y - 1);
    if (R() < 0.16) px(c, R() < 0.5 ? "#f6c945" : "#f29bb5", x + 2, y - 2);
  }
  // pebbles in the yard
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(R() * HALL_W), y = Math.floor(R() * HALL_H);
    if (!inYard(x, y)) continue;
    px(c, "#a07a4a", x, y); px(c, "#e2c290", x, y - 1);
  }
}

function paintRiverDetails(c: Ctx): void {
  const R = rng(23);
  // water hyacinth (lục bình) clumps
  const clumps: Array<[number, number]> = [[40, 372], [150, 385], [262, 360], [330, 390], [420, 370], [585, 382], [622, 358]];
  for (const [cx, cy] of clumps) {
    for (let k = 0; k < 22; k++) {
      const a = R() * Math.PI * 2, dist = R() * 6;
      px(c, R() < 0.5 ? C.leaf : C.leafLight, cx + Math.cos(a) * dist * 1.5, cy + Math.sin(a) * dist * 0.7);
    }
    px(c, "#b58ad8", cx, cy - 3); px(c, "#d6b3ef", cx + 1, cy - 3); px(c, "#b58ad8", cx + 1, cy - 4); px(c, "#d6b3ef", cx - 2, cy - 2);
  }
  // dock (walkable, x 500–532)
  rect(c, C.outline, 499, 318, 34, 82);
  for (let y = 319; y < 400; y += 3) { rect(c, C.woodLight, 500, y, 32, 2); rect(c, C.wood, 500, y + 2, 32, 1); }
  rect(c, C.woodDeep, 500, 318, 2, 82); rect(c, C.woodDeep, 530, 318, 2, 82);
  // moored boat (xuồng ba lá)
  for (let by = 0; by < 8; by++) {
    const inset = Math.abs(3.5 - by) * 3;
    rect(c, by === 0 || by === 7 ? C.outline : C.woodDark, 540 + inset, 352 + by, 40 - inset * 2, 1);
  }
  rect(c, C.woodLight, 550, 355, 20, 2);
  rect(c, C.outline, 560, 342, 1, 11); rect(c, C.wood, 561, 342, 4, 2);
}

// ---------------------------------------------------------------- scenery painted into the background

function paintBamboo(c: Ctx): void {
  const R = rng(5);
  rect(c, "#4f8a30", 0, 0, 72, 150);
  // ragged leafy edge instead of a hard rectangle
  for (let y = 0; y < 158; y++) {
    const edge = 72 + Math.round(3 * Math.sin(y * 0.35) + 2 * Math.sin(y * 0.9));
    for (let x = 66; x < edge; x++) px(c, x > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let x = 0; x < 78; x++) {
    const edge = 150 + Math.round(3 * Math.sin(x * 0.4) + 2 * Math.sin(x * 1.1));
    for (let y = 146; y < edge; y++) px(c, y > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let y = 0; y < 150; y++) for (let x = 0; x < 72; x++) if (R() < 0.08) px(c, "#44792a", x, y);
  for (let i = 0; i < 18; i++) {
    const x = 2 + i * 4 + Math.floor(R() * 2), top = Math.floor(R() * 20), bot = 142 + Math.floor(R() * 10);
    for (let y = top; y < bot; y++) {
      px(c, C.bamboo, x, y); px(c, C.bambooDark, x + 1, y);
      if ((y - top) % 9 === 0) { px(c, C.bambooNode, x, y); px(c, C.bambooNode, x + 1, y); }
    }
    for (let l = 0; l < 10; l++) {
      const ly = top + Math.floor(R() * (bot - top - 10)), dir = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < 6; k++) px(c, k < 2 ? C.leafLight : C.leaf, x + dir * (k + 1), ly + Math.floor(k / 2));
    }
  }
}

function drawNote(c: Ctx, x: number, y: number, col: string): void {
  ["..##.", "..#.#", "..#..", "..#..", ".##..", "###..", ".#..."].forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, col, x + i, y + j);
  });
}

function paintStage(c: Ctx): void {
  // poles + banner
  rect(c, C.woodDeep, 243, 4, 3, 92); rect(c, C.woodDeep, 393, 4, 3, 92);
  rect(c, C.redDark, 246, 8, 148, 48); rect(c, C.red, 248, 10, 144, 44);
  rect(c, C.gold, 248, 50, 144, 2);
  for (let x = 250; x < 392; x += 8) { rect(c, C.redDark, x, 56, 4, 2); px(c, C.redDark, x + 1, 58); }
  drawNote(c, 262, 18, C.goldLight); drawNote(c, 272, 26, C.gold); drawNote(c, 364, 26, C.gold); drawNote(c, 374, 18, C.goldLight);
  // platform
  rect(c, C.outline, 231, 95, 178, 46);
  for (let x = 232; x < 408; x += 6) { rect(c, C.woodLight, x, 96, 5, 34); rect(c, C.wood, x + 5, 96, 1, 34); }
  rect(c, C.woodDark, 232, 130, 176, 10);
  for (let x = 236; x < 408; x += 12) rect(c, C.woodDeep, x, 131, 1, 9);
  rect(c, C.outline, 231, 140, 178, 1);
  // speaker cabinets (the cones are animated in drawAnimated)
  for (const sx of [250, 374]) {
    rect(c, C.speaker, sx, 58, 16, 38);
    rect(c, C.speakerFace, sx + 1, 59, 14, 36);
    rect(c, C.gold, sx + 1, 92, 14, 1);
  }
}

function paintCounter(c: Ctx): void {
  // striped awning
  rect(c, C.outline, 464, 34, 142, 16);
  for (let x = 465; x < 605; x += 6) rect(c, ((x - 465) / 6) % 2 === 0 ? C.red : C.white, x, 35, 6, 13);
  for (let x = 466; x < 604; x += 6) rect(c, ((x - 466) / 6) % 2 === 0 ? C.red : C.white, x, 48, 4, 2);
  // back wall + shelves with jars
  rect(c, C.woodDark, 466, 50, 138, 28);
  rect(c, C.woodDeep, 466, 60, 138, 1); rect(c, C.woodDeep, 466, 70, 138, 1);
  const R = rng(31);
  const jar = ["#e0b33c", "#d9534f", "#5fae6e", "#f4f1ea", "#3d86a8", "#f29bb5"];
  for (let x = 470; x < 600; x += 7) {
    rect(c, jar[Math.floor(R() * jar.length)], x, 55, 4, 5); px(c, C.outline, x + 1, 54);
    rect(c, jar[Math.floor(R() * jar.length)], x + 2, 65, 3, 5);
  }
  // counter top + front
  rect(c, C.outline, 464, 77, 142, 30);
  rect(c, C.woodPale, 465, 78, 140, 7);
  rect(c, "#e0b27a", 465, 78, 140, 1);
  for (let x = 465; x < 605; x += 8) { rect(c, C.woodLight, x, 85, 7, 20); rect(c, C.wood, x + 7, 85, 1, 20); }
  rect(c, C.woodDark, 465, 104, 140, 2);
  // glasses of cà phê sữa đá on the counter
  for (const gx of [482, 520, 566]) { rect(c, "#f4f1ea", gx, 74, 4, 5); rect(c, "#7a4a2a", gx + 1, 76, 2, 3); }
}

// ---------------------------------------------------------------- props (drawn into their own canvas, anchor = frame ox/oy)

function drawPalm(c: Ctx, h: number, lean: number, seed: number): void {
  const R = rng(seed), bx = 50, by = h + 38;
  let tx = bx, ty = by;
  for (let t = 0; t <= h; t++) {
    const f = t / h, x = Math.round(bx + lean * 16 * f * f), y = by - t;
    px(c, C.outline, x - 2, y); px(c, C.trunkLight, x - 1, y); px(c, C.trunk, x, y); px(c, C.trunkDark, x + 1, y); px(c, C.outline, x + 2, y);
    if (t % 3 === 0) { px(c, C.trunkRing, x - 1, y); px(c, C.trunkRing, x, y); px(c, C.trunkRing, x + 1, y); }
    tx = x; ty = y;
  }
  const frond = (deg: number, len: number, back: boolean) => {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sx = ca >= 0 ? 1 : -1;
    const rib = back ? C.leafDeep : C.leafDark, l1 = back ? C.leafDark : C.leafLight, l2 = back ? C.leafDeep : C.leaf;
    for (let s = 1; s < len; s++) {
      const x = tx + ca * s, y = ty + Math.sin(a) * s * 0.45 + s * s * 0.032;
      const leaf = Math.max(1, Math.round(Math.sin((Math.PI * s) / len) * 7));
      for (let k = 1; k <= leaf; k++) { px(c, l1, x + k * 0.45 * sx, y + k * 0.95); px(c, l2, x - k * 0.25 * sx, y + k * 0.75); }
      px(c, rib, x, y);
      if (!back && s % 3 === 1) px(c, C.leafHi, x, y - 1);
    }
  };
  const back: Array<[number, number]> = [], front: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) {
    const deg = i * 30 + (R() - 0.5) * 14, len = 23 + Math.floor(R() * 9);
    (Math.sin((deg * Math.PI) / 180) < 0 ? back : front).push([deg, len]);
  }
  back.forEach(([deg, len]) => frond(deg, len, true));
  // coconuts
  for (const [ox, oy] of [[-3, 1], [0, 2], [2, 0]] as const) {
    rect(c, C.outline, tx + ox - 1, ty + oy - 1, 5, 5); rect(c, "#6b4a2b", tx + ox, ty + oy, 3, 3); px(c, "#9a7048", tx + ox, ty + oy);
  }
  front.forEach(([deg, len]) => frond(deg, len, false));
  for (let q = 0; q < 10; q++) px(c, R() < 0.5 ? C.leafLight : C.leafHi, tx + (R() - 0.5) * 6, ty - 1 + (R() - 0.5) * 3);
}

function drawHammock(c: Ctx, x: number, y: number, x2: number): void {
  // world → local: lx = wx - (x - 4), ly = wy - (y - 32)
  const L = (wx: number) => wx - (x - 4), T = (wy: number) => wy - (y - 32);
  const cols = ["#e05a47", "#f2c23c", "#3d86a8", "#f4f1ea"];
  const a = x + 10, b = x2 - 8, len = b - a;
  // ropes: from the palm trunk (x+1, y-26) and the post top (x2, y-28) to the fabric ends
  for (let i = 0; i <= 8; i++) {
    px(c, "#d8c7a0", L(x + 1 + i), T(y - 26 + i * 0.5));
    px(c, "#d8c7a0", L(x2 - i), T(y - 28 + i * 0.75));
  }
  for (let wx = a; wx <= b; wx++) {
    const f = (wx - a) / len, sag = Math.round(9 * Math.sin(Math.PI * f)), thick = 2 + Math.round(4 * Math.sin(Math.PI * f));
    const wyTop = y - 22 + sag - thick;
    px(c, C.outline, L(wx), T(wyTop - 1));
    for (let k = 0; k < thick; k++) px(c, cols[Math.floor((wx - a) / 3) % 4], L(wx), T(wyTop + k));
    px(c, C.outline, L(wx), T(wyTop + thick));
  }
}

function drawPost(c: Ctx): void {
  rect(c, C.outline, 0, 0, 6, 32); rect(c, C.wood, 1, 1, 4, 30); rect(c, C.woodLight, 1, 1, 1, 30);
}

function drawMixer(c: Ctx): void {
  rect(c, C.outline, 0, 4, 44, 18); rect(c, C.woodDark, 1, 5, 42, 16); rect(c, "#ff6f91", 1, 14, 42, 1);
  rect(c, C.speaker, 4, 1, 12, 5); rect(c, C.speaker, 28, 1, 12, 5);
  rect(c, "#c9ccd6", 9, 2, 2, 1); rect(c, "#c9ccd6", 33, 2, 2, 1);
  rect(c, "#9aa0a8", 18, 0, 8, 4); rect(c, "#3d86a8", 19, 1, 6, 2);
}

function drawTable(c: Ctx): void {
  rect(c, C.outline, 2, 0, 28, 12); rect(c, C.outline, 0, 2, 32, 8);
  rect(c, C.woodLight, 3, 1, 26, 10); rect(c, C.woodLight, 1, 3, 30, 6);
  rect(c, "#c8905c", 5, 2, 18, 2);
  rect(c, C.wood, 3, 9, 26, 2);
  rect(c, C.outline, 14, 12, 4, 16); rect(c, C.woodDeep, 15, 12, 2, 16);
  rect(c, C.outline, 9, 27, 14, 3); rect(c, C.woodDark, 10, 28, 12, 1);
  rect(c, "#f4f1ea", 8, 3, 3, 3); rect(c, "#7a4a2a", 9, 4, 1, 1);
  rect(c, "#f4f1ea", 20, 4, 3, 3); rect(c, "#7a4a2a", 21, 5, 1, 1);
}

function drawBoard(c: Ctx): void {
  rect(c, C.outline, 3, 18, 3, 16); rect(c, C.outline, 22, 18, 3, 16);
  rect(c, C.woodDark, 4, 18, 1, 16); rect(c, C.woodDark, 23, 18, 1, 16);
  rect(c, C.outline, 0, 0, 28, 22); rect(c, C.wood, 1, 1, 26, 20); rect(c, C.woodLight, 2, 2, 24, 18);
  rect(c, C.paper, 4, 4, 8, 7); rect(c, C.paper, 15, 3, 9, 6); rect(c, "#f6c945", 5, 13, 7, 5); rect(c, C.paper, 15, 11, 8, 7);
  rect(c, "#b5566f", 7, 6, 3, 1); rect(c, "#3d86a8", 17, 5, 5, 1); rect(c, "#3d86a8", 17, 13, 4, 1);
}

function drawSign(c: Ctx): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
  rect(c, C.outline, 0, 0, 18, 12); rect(c, C.woodLight, 1, 1, 16, 10);
  // tiny pixel fish
  ["..####...", ".######.#", "########.", ".######.#", "..####..."].forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, "#3d86a8", 4 + i, 3 + j);
  });
  px(c, C.white, 6, 5);
}

function drawBanana(c: Ctx): void {
  rect(c, "#6e8f3a", 19, 18, 3, 18);
  const leaves: Array<[number, number, boolean]> = [[-1, -0.9, true], [1, -0.8, true], [-1, -0.2, true], [1, -0.1, true], [0.2, -1, false]];
  for (const [dx, dy, droop] of leaves) {
    for (let s = 0; s < 16; s++) {
      const x = 20 + dx * s, y = 20 + dy * s + (droop ? s * s * 0.04 : 0);
      px(c, "#3f7f2e", x, y);
      for (let k = 1; k < 4; k++) { px(c, "#6fbf4a", x, y - k); px(c, "#4f9a38", x, y + k * 0.6); }
    }
  }
}

function drawLightPole(c: Ctx): void {
  rect(c, C.outline, 1, 2, 4, 40); rect(c, C.woodDark, 2, 2, 2, 40);
  rect(c, C.outline, 0, 0, 6, 3); rect(c, C.goldLight, 1, 1, 4, 1);
}

function drawProp(c: Ctx, p: PropPlacement): void {
  switch (p.kind) {
    case "palm": return drawPalm(c, p.h, p.lean, p.seed);
    case "hammock": return drawHammock(c, p.x, p.y, p.x2);
    case "post": return drawPost(c);
    case "mixer": return drawMixer(c);
    case "table": return drawTable(c);
    case "board": return drawBoard(c);
    case "sign": return drawSign(c);
    case "banana": return drawBanana(c);
    case "lightpole": return drawLightPole(c);
  }
}

function propSprite(p: PropPlacement): PropSprite {
  const f = propFrame(p);
  const canvas = makeCanvas(f.w, f.h);
  drawProp(ctx2d(canvas), p);
  return { canvas, x: p.x - f.ox, y: p.y - f.oy, sortY: p.y };
}

// ---------------------------------------------------------------- public

/** Paint the hall once. Throws "canvas-2d-unavailable" when the browser has no 2D canvas. */
export function paintHall(map: GameMap): HallArt {
  const background = makeCanvas(HALL_W, HALL_H);
  const g = ctx2d(background);
  paintGround(g);
  paintRiverDetails(g);
  paintBamboo(g);
  paintStage(g);
  paintCounter(g);
  const props = map.props.map(propSprite);

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    const pulse = reducedMotion ? 0 : Math.sin(t / 110) > 0.2 ? 1 : 0;
    for (const sx of [250, 374]) {
      const x = sx - camX, y = 58 - camY;
      rect(c, C.cone, x + 5, y + 4, 6, 5); rect(c, C.coneCenter, x + 7, y + 6, 2, 2);
      rect(c, C.speakerFace, x + 2, y + 13, 12, 12);
      rect(c, C.cone, x + 3 - pulse, y + 14 - pulse, 10 + pulse * 2, 10 + pulse * 2);
      rect(c, C.coneCenter, x + 6, y + 17, 4, 4);
    }
    if (reducedMotion) return;
    for (let i = 0; i < 70; i++) {
      const sx = (i * 37 + Math.floor(t / 45)) % HALL_W;
      const sy = Math.round(hallShoreY(sx)) + 4 + ((i * 7) % 56);
      if (sy >= HALL_H) continue;
      px(c, C.sparkle, sx - camX, sy - camY);
      px(c, C.sparkle2, sx + 1 - camX, sy - camY);
    }
  };

  const drawOverhead = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    const bulbs = ["#ff6f91", "#ffd166", "#06d6a0", "#4cc9f0"];
    LIGHT_STRINGS.forEach(([x1, y1, x2, y2, sag], si) => {
      const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f + sag * Math.sin(Math.PI * f);
        px(c, C.outline, x - camX, y - camY);
        if (i % 7 === 3) {
          const k = Math.floor(i / 7);
          const on = reducedMotion || (k + Math.floor(t / 380) + si) % 3 !== 0;
          const col = on ? bulbs[k % 4] : "#8a7a6a";
          px(c, col, x - camX, y + 1 - camY);
          px(c, col, x - camX, y + 2 - camY);
        }
      }
    });
  };

  return { background, props, drawAnimated, drawOverhead };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/game-hall-art.test.ts && npx tsc --noEmit`
Expected: PASS (4 tests); tsc exits 0.

- [ ] **Step 5: Lint + commit**

```bash
npx eslint lib/game/maps/hall-art.ts tests/unit/game-hall-art.test.ts
git add lib/game/maps/hall-art.ts tests/unit/game-hall-art.test.ts
git commit -m "feat(v13): procedural hall scene painters (riverside café)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Scene helpers + the game engine

**Files:**
- Create: `lib/game/scene.ts`, `lib/game/engine.ts`
- Test: `tests/unit/game-scene.test.ts`

**Interfaces:**
- Consumes: `Actor` + `createActor`, `setKeyboard`, `setPath`, `applyStateMsg`, `applyPathMsg`, `tickActor`, `walkFrame` (Task 10); `getCharacterFrames` (Task 7); `HallArt` (Task 12); `GameMap`, `InteractId`, `Interactable`, `Spot` (Task 8); `inputDir`, `KeyState` (Task 8); `codeToFacing`, `facingToCode`, `MAX_PATH_POINTS`, `FacingCode`, `GameMessage`, `Unit` (Task 11); `findPath`, `smoothPath` (Task 8); `wrapBubble` (Task 11); `Facing`, `Look`, `Vec` (Task 5).
- Produces:
  - `scene.ts` (pure): `TARGET_W = 300`, `TARGET_H = 180`, `PROMPT_RANGE = 26`, `ViewSize { scale; vw; vh }`, `computeView(devW, devH, mapW, mapH)`, `cameraFor(feet, vw, vh, mapW, mapH)`, `interactableAt(map, p)`, `nearestInteractable(map, feet, range?)`, `hitsCharacter(p, feet)`, `Box`, `stackBoxes(boxes, dir, gap, minY?, tries?)`.
  - `engine.ts` (browser): `LocalMoveMsg`, `EngineCallbacks { onLocalMove; onLocalPath; onInteract; onPromptChange; onActorClick }`, `RosterEntry { id; name; badges; look; spot: Spot | null }`, `EngineOptions { localId; name; badges; look; fontFamily; reducedMotion }`, `class GameEngine { constructor(canvas, map, art, cb, opts); start(); destroy(); setLocal(info); setRoster(entries); applyMessage(msg); removeActor(id); showBubble(id, text); showReaction(id | null, emoji); setInputEnabled(enabled); interact(); snapshot(): GameMessage }`.

Engine behaviour (spec §6, §8, §10.5, §11): keyboard (WASD/arrows) with change-only `mv` messages + 3 s keep-alive; click/tap → A* path (`pa`), click on an interactable → walk to its use spot and trigger it on arrival (interactables win over people — the DJ stands right behind the booth); E/Enter triggers the prompt; typing in inputs never moves the character; remote walkers are hidden until their first state arrives (max 2 s — answers to `hello` are spread over 1.5 s); depth sort by feet y; name tags, chat bubbles (kept on screen, stacked when people sit side by side) and floating reactions drawn at device resolution. It was verified in the browser against the mockup (movement, collisions, booth click → walk → interact, stacked tags/bubbles, portrait phone view without empty bands).

- [ ] **Step 1: Write the failing test**

`tests/unit/game-scene.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildHallMap } from "@/lib/game/maps/hall";
import { cameraFor, computeView, hitsCharacter, interactableAt, nearestInteractable, stackBoxes } from "@/lib/game/scene";

const hall = buildHallMap();

describe("computeView", () => {
  it("picks the largest whole scale that keeps ~300×180 world px visible", () => {
    expect(computeView(960, 560, 640, 400)).toEqual({ scale: 3, vw: 320, vh: 187 });
    expect(computeView(1920, 1080, 640, 400)).toEqual({ scale: 6, vw: 320, vh: 180 });
  });
  it("zooms in on tall phone screens instead of showing past the map", () => {
    expect(computeView(750, 1624, 640, 400)).toEqual({ scale: 5, vw: 150, vh: 325 });
  });
  it("never goes below scale 1", () => {
    expect(computeView(100, 60, 640, 400).scale).toBe(1);
  });
});

describe("cameraFor", () => {
  it("centres on the head and clamps to the map", () => {
    expect(cameraFor({ x: 320, y: 200 }, 320, 180, 640, 400)).toEqual({ x: 160, y: 86 });
    expect(cameraFor({ x: 10, y: 10 }, 320, 180, 640, 400)).toEqual({ x: 0, y: 0 });
    expect(cameraFor({ x: 630, y: 395 }, 320, 180, 640, 400)).toEqual({ x: 320, y: 220 });
  });
  it("centres the map when the view is bigger than it", () => {
    expect(cameraFor({ x: 0, y: 0 }, 800, 500, 640, 400)).toEqual({ x: -80, y: -50 });
  });
});

describe("hit tests", () => {
  it("finds interactables by their click rect", () => {
    expect(interactableAt(hall, { x: 320, y: 118 })?.id).toBe("dj_booth");
    expect(interactableAt(hall, { x: 596, y: 240 })?.id).toBe("notice_board");
    expect(interactableAt(hall, { x: 300, y: 250 })).toBeNull();
  });
  it("prompts only near an interactable's use spot", () => {
    expect(nearestInteractable(hall, { x: 320, y: 152 })).toBe("dj_booth");
    expect(nearestInteractable(hall, { x: 320, y: 190 })).toBeNull();
  });
  it("hits a character's body box", () => {
    expect(hitsCharacter({ x: 100, y: 80 }, { x: 100, y: 100 })).toBe(true);
    expect(hitsCharacter({ x: 112, y: 80 }, { x: 100, y: 100 })).toBe(false);
    expect(hitsCharacter({ x: 100, y: 50 }, { x: 100, y: 100 })).toBe(false);
  });
});

describe("stackBoxes", () => {
  it("keeps boxes that do not overlap", () => {
    const boxes = [{ x: 0, y: 0, w: 10, h: 5 }, { x: 20, y: 0, w: 10, h: 5 }];
    expect(stackBoxes(boxes, 1, 1)).toEqual(boxes);
  });
  it("pushes an overlapping name tag down by its height + gap", () => {
    const out = stackBoxes([{ x: 0, y: 10, w: 30, h: 5 }, { x: 16, y: 10, w: 30, h: 5 }], 1, 1);
    expect(out[1]).toEqual({ x: 16, y: 16, w: 30, h: 5 });
  });
  it("stacks bubbles upwards but never above minY", () => {
    const b = { x: 0, y: 20, w: 30, h: 10 };
    const out = stackBoxes([b, { ...b, x: 5 }, { ...b, x: 5 }], -1, 2, 0);
    expect(out.map((o) => o.y)).toEqual([20, 8, 0]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-scene.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/scene`.

- [ ] **Step 3: Implement `lib/game/scene.ts`**

```ts
import type { GameMap, Interactable, InteractId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";

// Pure helpers for the engine: view sizing, camera, hit tests and overlay layout.

/** Aim for a ~300×180 world-pixel view, scaled by a whole number so pixels stay square. */
export const TARGET_W = 300;
export const TARGET_H = 180;
/** How close (world px) the feet must be to an interactable's use spot to show its prompt. */
export const PROMPT_RANGE = 26;

export interface ViewSize { scale: number; vw: number; vh: number }

/** Integer scale for a devW×devH (device px) canvas, plus the visible world size. Never shows past the map. */
export function computeView(devW: number, devH: number, mapW: number, mapH: number): ViewSize {
  let scale = Math.max(1, Math.floor(Math.min(devW / TARGET_W, devH / TARGET_H)));
  // tall phone screens would otherwise see empty bands above and below the map
  while (Math.ceil(devW / scale) > mapW || Math.ceil(devH / scale) > mapH) scale++;
  return { scale, vw: Math.ceil(devW / scale), vh: Math.ceil(devH / scale) };
}

/** Camera top-left: centred on the character's head (feet y − 24), clamped to the map (centred if the view is bigger). */
export function cameraFor(feet: Vec, vw: number, vh: number, mapW: number, mapH: number): Vec {
  const axis = (target: number, span: number, size: number) =>
    size <= span ? (size - span) / 2 : Math.max(0, Math.min(size - span, target));
  return { x: axis(feet.x - vw / 2, vw, mapW), y: axis(feet.y - 24 - vh / 2, vh, mapH) };
}

/** The interactable whose click rect contains world point p. */
export function interactableAt(map: GameMap, p: Vec): Interactable | null {
  return map.interactables.find((i) => p.x >= i.rect.x && p.x < i.rect.x + i.rect.w && p.y >= i.rect.y && p.y < i.rect.y + i.rect.h) ?? null;
}

/** The closest interactable whose use spot is within `range` of the feet. */
export function nearestInteractable(map: GameMap, feet: Vec, range = PROMPT_RANGE): InteractId | null {
  let best: InteractId | null = null;
  let bestD = Infinity;
  for (const i of map.interactables) {
    const d = Math.hypot(feet.x - i.use.x, feet.y - i.use.y);
    if (d <= range && d < bestD) {
      best = i.id;
      bestD = d;
    }
  }
  return best;
}

/** Click box of a 24×48 character whose feet are at `feet`. */
export function hitsCharacter(p: Vec, feet: Vec): boolean {
  return p.x >= feet.x - 10 && p.x <= feet.x + 10 && p.y >= feet.y - 44 && p.y <= feet.y + 2;
}

export interface Box { x: number; y: number; w: number; h: number }

/**
 * Lay out overlay boxes in order. A box that overlaps an already placed one moves by its own
 * height + gap (dir 1 = down, -1 = up), at most `tries` times and never above `minY`.
 */
export function stackBoxes(boxes: Box[], dir: 1 | -1, gap: number, minY = Number.NEGATIVE_INFINITY, tries = 4): Box[] {
  const placed: Box[] = [];
  const hit = (b: Box) => placed.some((p) => b.x < p.x + p.w && p.x < b.x + b.w && b.y < p.y + p.h && p.y < b.y + b.h);
  for (const box of boxes) {
    const b = { ...box };
    for (let i = 0; i < tries && hit(b); i++) b.y = Math.max(minY, b.y + dir * (b.h + gap));
    placed.push(b);
  }
  return placed;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/game-scene.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Implement `lib/game/engine.ts`**

```ts
import { applyPathMsg, applyStateMsg, createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { getCharacterFrames } from "@/lib/game/art/raster";
import type { HallArt } from "@/lib/game/maps/hall-art";
import type { GameMap, InteractId, Spot } from "@/lib/game/maps/types";
import { inputDir, type KeyState } from "@/lib/game/movement";
import { codeToFacing, facingToCode, MAX_PATH_POINTS, type FacingCode, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView, hitsCharacter, interactableAt, nearestInteractable, PROMPT_RANGE, stackBoxes, type Box } from "@/lib/game/scene";
import { wrapBubble } from "@/lib/game/text";
import type { Facing, Look, Vec } from "@/lib/game/types";

export interface LocalMoveMsg { x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit }

export interface EngineCallbacks {
  /** Keyboard movement started, stopped or turned (plus a keep-alive every 3 s while walking). */
  onLocalMove: (m: LocalMoveMsg) => void;
  /** A click/tap path started. */
  onLocalPath: (m: { x: number; y: number; pts: Array<[number, number]> }) => void;
  onInteract: (id: InteractId) => void;
  onPromptChange: (id: InteractId | null) => void;
  onActorClick: (accountId: string) => void;
}

/** One other online member. `spot` = fixed place for classic-mode members; null = walking (game mode). */
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null }

export interface EngineOptions {
  localId: string;
  name: string;
  badges: string;
  look: Look;
  /** CSS font-family for canvas text (the VT323 family from next/font). */
  fontFamily: string;
  reducedMotion: boolean;
}

const KEYMAP: Record<string, keyof KeyState> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};
const KEEPALIVE_MS = 3000;
const BUBBLE_MS = 6000;
const REACTION_MS = 1600;
/** A walking member is hidden until their first state arrives (answers to `hello` take up to 1.5 s). */
const UNSEEN_GRACE_MS = 2000;
const NO_KEYS: KeyState = { up: false, down: false, left: false, right: false };

/** Canvas 2D game loop: input, local + remote actors, camera, depth-sorted rendering, overlays. Browser only. */
export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly map: GameMap;
  private readonly art: HallArt;
  private readonly cb: EngineCallbacks;
  private readonly opts: EngineOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly ro: ResizeObserver;
  private readonly local: Actor;
  private readonly remotes = new Map<string, Actor>();
  /** Last st/mv/pa per member, so members added to the roster later start at the right place. */
  private readonly lastState = new Map<string, GameMessage>();
  /** Walking members we have no state for yet → first seen at (ms). */
  private readonly unseen = new Map<string, number>();
  private readonly bubbles = new Map<string, { lines: string[]; until: number }>();
  private roster = new Map<string, RosterEntry>();
  private reactions: Array<{ id: string | null; emoji: string; born: number; dx: number }> = [];
  private localInfo: { name: string; badges: string; look: Look };
  private keys: KeyState = { ...NO_KEYS };
  private scale = 3;
  private vw = 320;
  private vh = 180;
  private dpr = 1;
  private cam: Vec = { x: 0, y: 0 };
  private inputEnabled = true;
  private pendingInteract: InteractId | null = null;
  private prompt: InteractId | null = null;
  private lastSent = { mv: false, vx: 0, vy: 0, at: 0 };
  private raf = 0;
  private lastT = 0;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, map: GameMap, art: HallArt, cb: EngineCallbacks, opts: EngineOptions) {
    const ctx = canvas.getContext("2d");
    const buf = document.createElement("canvas");
    const bctx = buf.getContext("2d");
    if (!ctx || !bctx) throw new Error("canvas-2d-unavailable");
    this.canvas = canvas;
    this.map = map;
    this.art = art;
    this.cb = cb;
    this.opts = opts;
    this.ctx = ctx;
    this.buf = buf;
    this.bctx = bctx;
    this.local = createActor(opts.localId, { ...map.spawn }, "left", performance.now());
    this.localInfo = { name: opts.name, badges: opts.badges, look: opts.look };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    this.resize();
  }

  start(): void {
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy(): void {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }

  // ------------------------------------------------------------ data in

  setLocal(info: { name: string; badges: string; look: Look }): void {
    this.localInfo = info;
  }

  /** Everyone online except me. Walking members get an actor (placed with their last known state). */
  setRoster(entries: RosterEntry[]): void {
    const now = performance.now();
    const next = new Map<string, RosterEntry>();
    for (const e of entries) if (e.id !== this.opts.localId) next.set(e.id, e);
    for (const id of [...this.remotes.keys()]) {
      const e = next.get(id);
      if (!e || e.spot) {
        this.remotes.delete(id);
        this.unseen.delete(id);
      }
    }
    for (const e of next.values()) {
      if (e.spot || this.remotes.has(e.id)) continue;
      const a = createActor(e.id, { ...this.map.spawn }, "left", now);
      this.remotes.set(e.id, a);
      const last = this.lastState.get(e.id);
      if (last) this.applyTo(a, last, now);
      else this.unseen.set(e.id, now);
    }
    this.roster = next;
  }

  /** st / mv / pa from the network (other message types are handled by the caller). */
  applyMessage(msg: GameMessage): void {
    if (msg.id === this.opts.localId) return;
    if (msg.t !== "st" && msg.t !== "mv" && msg.t !== "pa") return;
    this.lastState.set(msg.id, msg);
    this.unseen.delete(msg.id);
    const a = this.remotes.get(msg.id);
    if (a) this.applyTo(a, msg, performance.now());
  }

  removeActor(id: string): void {
    this.remotes.delete(id);
    this.lastState.delete(id);
    this.unseen.delete(id);
  }

  showBubble(id: string, text: string): void {
    const lines = wrapBubble(text);
    if (lines.length > 0) this.bubbles.set(id, { lines, until: performance.now() + BUBBLE_MS });
  }

  showReaction(id: string | null, emoji: string): void {
    this.reactions.push({ id, emoji, born: performance.now(), dx: Math.round((Math.random() - 0.5) * 12) });
    if (this.reactions.length > 40) this.reactions.shift();
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled;
    if (!enabled) this.keys = { ...NO_KEYS };
  }

  /** Trigger the interactable in range (E key / HUD button). */
  interact(): void {
    if (this.prompt) this.cb.onInteract(this.prompt);
  }

  /** My current state as a message — the answer to someone's `hello`. */
  snapshot(): GameMessage {
    const id = this.opts.localId;
    if (this.local.path && this.local.path.length > 0) {
      return {
        t: "pa", id, x: Math.round(this.local.pos.x), y: Math.round(this.local.pos.y),
        pts: this.local.path.slice(0, MAX_PATH_POINTS).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
      };
    }
    return { t: "st", id, ...this.localMove() };
  }

  // ------------------------------------------------------------ internals

  private applyTo(a: Actor, msg: GameMessage, now: number): void {
    if (msg.t === "st" || msg.t === "mv") {
      applyStateMsg(a, { x: msg.x, y: msg.y, facing: codeToFacing(msg.d), moving: msg.mv, vx: msg.vx, vy: msg.vy }, now);
    } else if (msg.t === "pa") {
      applyPathMsg(a, { x: msg.x, y: msg.y, pts: msg.pts.map(([x, y]) => ({ x, y })) }, now);
    }
  }

  private localMove(): LocalMoveMsg {
    return {
      x: Math.round(this.local.pos.x),
      y: Math.round(this.local.pos.y),
      d: facingToCode(this.local.facing),
      mv: this.local.moving && !this.local.path,
      vx: (Math.sign(this.local.dir.x) || 0) as Unit,
      vy: (Math.sign(this.local.dir.y) || 0) as Unit,
    };
  }

  /** A walking member is drawn once we know where they are (or after the grace period). */
  private visible(id: string, now: number): boolean {
    const since = this.unseen.get(id);
    return since === undefined || now - since >= UNSEEN_GRACE_MS;
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const devW = Math.max(1, Math.round(r.width * this.dpr));
    const devH = Math.max(1, Math.round(r.height * this.dpr));
    if (this.canvas.width !== devW) this.canvas.width = devW;
    if (this.canvas.height !== devH) this.canvas.height = devH;
    const v = computeView(devW, devH, this.map.width, this.map.height);
    this.scale = v.scale;
    this.vw = v.vw;
    this.vh = v.vh;
    this.buf.width = this.vw;
    this.buf.height = this.vh;
  }

  private isTyping(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.inputEnabled || e.ctrlKey || e.metaKey || e.altKey || this.isTyping(e.target)) return;
    const k = KEYMAP[e.code];
    if (k) {
      this.keys[k] = true;
      e.preventDefault();
      return;
    }
    if ((e.code === "KeyE" || e.code === "Enter") && this.prompt) {
      e.preventDefault();
      this.cb.onInteract(this.prompt);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = KEYMAP[e.code];
    if (k) this.keys[k] = false;
  };

  private readonly onBlur = (): void => {
    this.keys = { ...NO_KEYS };
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.inputEnabled || e.button !== 0) return;
    const r = this.canvas.getBoundingClientRect();
    const w: Vec = {
      x: ((e.clientX - r.left) * this.dpr) / this.scale + this.cam.x,
      y: ((e.clientY - r.top) * this.dpr) / this.scale + this.cam.y,
    };
    // Interactables win over people: the DJ stands right behind the booth.
    const it = interactableAt(this.map, w);
    if (it) {
      if (Math.hypot(this.local.pos.x - it.use.x, this.local.pos.y - it.use.y) <= PROMPT_RANGE) {
        this.cb.onInteract(it.id);
        return;
      }
      this.pendingInteract = it.id;
      this.walkTo(it.use);
      return;
    }
    const hit = this.actorAt(w);
    if (hit) {
      this.cb.onActorClick(hit);
      return;
    }
    this.pendingInteract = null;
    this.walkTo(w);
  };

  /** Front-most other member under world point p. */
  private actorAt(p: Vec): string | null {
    const now = performance.now();
    let bestId: string | null = null;
    let bestY = -Infinity;
    for (const e of this.roster.values()) {
      const feet = e.spot ?? (this.visible(e.id, now) ? this.remotes.get(e.id)?.display : undefined);
      if (feet && hitsCharacter(p, feet) && feet.y > bestY) {
        bestId = e.id;
        bestY = feet.y;
      }
    }
    return bestId;
  }

  private walkTo(target: Vec): void {
    const cells = findPath(this.map, this.local.pos, target);
    if (!cells) {
      this.pendingInteract = null;
      return;
    }
    const pts = smoothPath(this.map, this.local.pos, cells);
    setPath(this.local, pts);
    this.lastSent = { mv: false, vx: 0, vy: 0, at: performance.now() };
    this.cb.onLocalPath({
      x: Math.round(this.local.pos.x),
      y: Math.round(this.local.pos.y),
      pts: pts.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
    });
  }

  private positionOf(id: string, now: number): Vec | null {
    if (id === this.opts.localId) return this.local.display;
    const e = this.roster.get(id);
    if (!e) return null;
    if (e.spot) return e.spot;
    return this.visible(id, now) ? this.remotes.get(id)?.display ?? null : null;
  }

  private readonly frame = (t: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    this.update(dt, t);
    this.render(t);
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number, now: number): void {
    const dir = this.inputEnabled ? inputDir(this.keys) : { x: 0, y: 0 };
    if (dir.x !== 0 || dir.y !== 0) {
      this.pendingInteract = null;
      setKeyboard(this.local, dir);
    } else if (!this.local.path && this.local.moving) {
      setKeyboard(this.local, dir);
    }
    const arrived = tickActor(this.map, this.local, dt, now, false);
    if (arrived && this.pendingInteract) {
      const id = this.pendingInteract;
      this.pendingInteract = null;
      this.cb.onInteract(id);
    }
    if (!this.local.path) {
      const m = this.localMove();
      const changed = m.mv !== this.lastSent.mv || m.vx !== this.lastSent.vx || m.vy !== this.lastSent.vy;
      if (changed || (m.mv && now - this.lastSent.at > KEEPALIVE_MS)) {
        this.cb.onLocalMove(m);
        this.lastSent = { mv: m.mv, vx: m.vx, vy: m.vy, at: now };
      }
    }
    const near = nearestInteractable(this.map, this.local.pos);
    if (near !== this.prompt) {
      this.prompt = near;
      this.cb.onPromptChange(near);
    }
    for (const a of this.remotes.values()) tickActor(this.map, a, dt, now, true);
    this.cam = cameraFor(this.local.display, this.vw, this.vh, this.map.width, this.map.height);
    for (const [id, b] of this.bubbles) if (b.until < now) this.bubbles.delete(id);
    this.reactions = this.reactions.filter((r) => now - r.born < REACTION_MS);
  }

  private render(t: number): void {
    const b = this.bctx;
    const camX = Math.round(this.cam.x), camY = Math.round(this.cam.y);
    b.imageSmoothingEnabled = false;
    b.fillStyle = "#2f6e8f";
    b.fillRect(0, 0, this.vw, this.vh);
    b.drawImage(this.art.background, -camX, -camY);
    this.art.drawAnimated(b, t, camX, camY, this.opts.reducedMotion);

    const items: Array<{ y: number; draw: () => void }> = [];
    for (const p of this.art.props) {
      const x = p.x - camX, y = p.y - camY;
      if (x > this.vw || y > this.vh || x + p.canvas.width < 0 || y + p.canvas.height < 0) continue;
      items.push({ y: p.sortY, draw: () => b.drawImage(p.canvas, x, y) });
    }
    const drawActor = (look: Look, pos: Vec, facing: Facing, frame: 0 | 1 | 2 | 3) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      if (x < -16 || x > this.vw + 16 || y < -4 || y > this.vh + 50) return;
      b.fillStyle = "rgba(40, 25, 10, 0.28)";
      b.fillRect(x - 7, y - 1, 14, 2);
      b.fillRect(x - 5, y + 1, 10, 1);
      b.drawImage(getCharacterFrames(look)[facing][frame], x - 12, y - 46);
    };
    for (const e of this.roster.values()) {
      const spot = e.spot;
      if (spot) {
        items.push({ y: spot.y, draw: () => drawActor(e.look, spot, spot.dir, 0) });
        continue;
      }
      const a = this.remotes.get(e.id);
      if (a && this.visible(e.id, t)) items.push({ y: a.display.y, draw: () => drawActor(e.look, a.display, a.facing, walkFrame(a)) });
    }
    const me = this.local;
    items.push({ y: me.display.y, draw: () => drawActor(this.localInfo.look, me.display, me.facing, walkFrame(me)) });
    items.sort((p, q) => p.y - q.y);
    for (const it of items) it.draw();
    this.art.drawOverhead(b, t, camX, camY, this.opts.reducedMotion);

    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.buf, 0, 0, this.vw * this.scale, this.vh * this.scale);
    this.drawOverlays(t, camX, camY);
  }

  private drawOverlays(now: number, camX: number, camY: number): void {
    const c = this.ctx, s = this.scale, font = this.opts.fontFamily;
    const dev = (x: number, y: number): [number, number] => [(x - camX) * s, (y - camY) * s];
    c.textAlign = "center";
    c.textBaseline = "middle";

    // name tags under the feet — neighbours at a table would overlap, so later tags move down
    const tags: Array<{ mine: boolean; label: string; pos: Vec }> = [
      { mine: true, label: this.label(this.localInfo.badges, this.localInfo.name), pos: this.local.display },
    ];
    for (const e of this.roster.values()) {
      const pos = this.positionOf(e.id, now);
      if (pos) tags.push({ mine: false, label: this.label(e.badges, e.name), pos });
    }
    tags.sort((p, q) => p.pos.y - q.pos.y);
    c.font = `${Math.round(4.4 * s)}px ${font}`;
    const tagBoxes = stackBoxes(tags.map((tg): Box => {
      const [x, y] = dev(tg.pos.x, tg.pos.y + 3);
      const w = Math.round(c.measureText(tg.label).width + 3 * s);
      return { x: Math.round(x - w / 2), y: Math.round(y), w, h: Math.round(5.2 * s) };
    }), 1, 1);
    tags.forEach((tg, i) => {
      const bx = tagBoxes[i];
      c.fillStyle = tg.mine ? "rgba(139, 90, 43, 0.92)" : "rgba(58, 36, 24, 0.78)";
      c.fillRect(bx.x, bx.y, bx.w, bx.h);
      c.fillStyle = "#fbf3dc";
      c.fillText(tg.label, bx.x + bx.w / 2, bx.y + bx.h / 2 + s * 0.3);
    });

    // chat bubbles above heads — kept on screen; people side by side get stacked bubbles
    c.font = `${Math.round(4.8 * s)}px ${font}`;
    const lineH = 5.4 * s, pad = 2 * s;
    const speakers: Array<{ x: number; lines: string[] }> = [];
    const bubbleBoxes: Box[] = [];
    const sorted = [...this.bubbles].map(([id, bub]) => ({ pos: this.positionOf(id, now), lines: bub.lines }))
      .filter((q): q is { pos: Vec; lines: string[] } => q.pos !== null)
      .sort((p, q) => q.pos.y - p.pos.y);
    for (const { pos, lines } of sorted) {
      const [x, yTop] = dev(pos.x, pos.y - 50);
      const w = Math.round(Math.max(...lines.map((l) => c.measureText(l).width)) + pad * 2);
      const h = Math.round(lines.length * lineH + pad * 1.4);
      const bx = Math.round(Math.min(Math.max(2, x - w / 2), this.canvas.width - w - 2));
      speakers.push({ x, lines });
      bubbleBoxes.push({ x: bx, y: Math.round(Math.max(2, yTop - h)), w, h });
    }
    stackBoxes(bubbleBoxes, -1, 2, 2).forEach((bx, i) => {
      const { x, lines } = speakers[i];
      const tailX = Math.round(Math.min(Math.max(bx.x + s, x - s), bx.x + bx.w - 3 * s));
      c.fillStyle = "#fbf3dc";
      c.strokeStyle = "#8b5a2b";
      c.lineWidth = Math.max(1, Math.round(s * 0.7));
      c.fillRect(bx.x, bx.y, bx.w, bx.h);
      c.strokeRect(bx.x, bx.y, bx.w, bx.h);
      c.fillRect(tailX, bx.y + bx.h - 1, Math.round(2 * s), Math.round(2 * s));
      c.fillStyle = "#4a2e17";
      lines.forEach((l, j) => c.fillText(l, bx.x + bx.w / 2, bx.y + pad * 0.7 + lineH * (j + 0.5)));
    });

    // floating reactions (id null = the whole room: rise from the top middle)
    c.font = `${Math.round(9 * s)}px ${font}`;
    for (const r of this.reactions) {
      const age = (now - r.born) / REACTION_MS;
      const pos = r.id ? this.positionOf(r.id, now) : null;
      const wx = pos ? pos.x + r.dx : this.cam.x + this.vw / 2 + r.dx;
      const wy = (pos ? pos.y - 56 : this.cam.y + 40) - age * 22;
      const [x, y] = dev(wx, wy);
      c.globalAlpha = Math.max(0, 1 - age);
      c.fillText(r.emoji, x, y);
      c.globalAlpha = 1;
    }
  }

  private label(badges: string, name: string): string {
    return badges ? `${badges} ${name}` : name;
  }
}
```

- [ ] **Step 6: Typecheck + lint + commit**

Run: `npx tsc --noEmit && npx eslint lib/game/scene.ts lib/game/engine.ts tests/unit/game-scene.test.ts`
Expected: tsc 0 errors, eslint clean.

```bash
git add lib/game/scene.ts lib/game/engine.ts tests/unit/game-scene.test.ts
git commit -m "feat(v13): canvas game engine (input, pathing, camera, depth-sorted render, overlays)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Broadcast channel + GameCanvas

**Files:**
- Create: `lib/channel-lifecycle.ts`, `lib/game/net/channel.ts`, `components/game/GameCanvas.tsx`
- Test: `tests/unit/channel-lifecycle.test.ts`

**Interfaces:**
- Consumes: `supabase`, `RealtimeChannel` (`lib/supabase.ts`); `createSendGate`, `GAME_EVENTS`, `parseGameMessage`, `toPayload`, `GameMessage` (Task 11); `GameEngine`, `RosterEntry` (Task 13); `buildHallMap` (Task 9); `paintHall` (Task 12); `InteractId` (Task 8); `Look` (Task 5).
- Produces:
  - `channel-lifecycle.ts` (pure): `whenTopicFree(topic): Promise<void>`, `markLeaving(topic, done: Promise<unknown>)`. **Why:** realtime-js 2.116 `supabase.channel(topic)` returns the *existing* channel while it is still leaving, and a leaving channel never joins again — so when one component unmounts and another joins the same topic in the same commit (classic ↔ game switch), the newcomer silently gets a dead channel. Task 16 uses the same helper for the reactions channel.
  - `net/channel.ts` (browser): `GameChannelHandlers { onMessage; onStatus }`, `GameChannelHandle { send(msg); leave(last?) }`, `joinGameChannel(roomId, bounds, handlers)`.
  - `GameCanvas.tsx`: default export `GameCanvas(props: GameCanvasProps)`; `GameCanvasHandle { setRoster; setLocal; showBubble; showReaction; setInputEnabled; interact; announceLook }`; `GameCanvasProps { ref?; roomId; localId; initial: { name; badges; look }; onInteract; onPromptChange; onActorClick; onConnectionChange; onLookChanged; onUnsupported }`.

Protocol handling in `GameCanvas`: on `SUBSCRIBED` send `hello`; answer someone's `hello` with `engine.snapshot()` after a random 0–1500 ms; `lk` → `onLookChanged(id)`; `bye` → remove the walker; everything else → `engine.applyMessage`. On unmount: clear pending answers, send `bye` directly (not through the gate), leave the channel, destroy the engine. The canvas reads the VT323 family from the `--font-vt323` CSS variable (added in Task 15; until then it falls back to `monospace`).

- [ ] **Step 1: Write the failing test**

`tests/unit/channel-lifecycle.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";

function deferred() {
  let resolve!: () => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("channel lifecycle", () => {
  it("a free topic resolves immediately", async () => {
    await expect(whenTopicFree("t:free")).resolves.toBeUndefined();
  });

  it("a join waits for the previous leave of the same topic only", async () => {
    const leave = deferred();
    markLeaving("t:a", leave.promise);
    let joinedA = false;
    let joinedB = false;
    void whenTopicFree("t:a").then(() => { joinedA = true; });
    void whenTopicFree("t:b").then(() => { joinedB = true; });
    await flush();
    expect(joinedA).toBe(false);
    expect(joinedB).toBe(true);
    leave.resolve();
    await flush();
    expect(joinedA).toBe(true);
  });

  it("a failed leave still frees the topic", async () => {
    const leave = deferred();
    markLeaving("t:c", leave.promise);
    leave.reject(new Error("timeout"));
    await expect(whenTopicFree("t:c")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/channel-lifecycle.test.ts`
Expected: FAIL — cannot resolve `@/lib/channel-lifecycle`.

- [ ] **Step 3: Implement `lib/channel-lifecycle.ts`**

```ts
// realtime-js hands back the existing channel for a topic even while that channel is still leaving,
// and a leaving channel never joins again. When a component unmounts and another one joins the same
// topic in the same commit (classic ↔ game switch), the new subscriber would silently get a dead
// channel. Joins therefore wait until the previous leave of the same topic has finished.

const leaving = new Map<string, Promise<void>>();

/** Resolves once the last leave of `topic` (if any) has settled. */
export function whenTopicFree(topic: string): Promise<void> {
  return leaving.get(topic) ?? Promise.resolve();
}

/** Record that `topic` is being left until `done` settles (success or failure). */
export function markLeaving(topic: string, done: Promise<unknown>): void {
  const settled = done.then(() => undefined, () => undefined);
  leaving.set(topic, settled);
  void settled.then(() => {
    if (leaving.get(topic) === settled) leaving.delete(topic);
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/channel-lifecycle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement `lib/game/net/channel.ts`**

```ts
import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import { createSendGate, GAME_EVENTS, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";

export interface GameChannelHandlers {
  onMessage: (msg: GameMessage) => void;
  /** true once subscribed (again, after a reconnect); false on error/close. */
  onStatus: (connected: boolean) => void;
}

export interface GameChannelHandle {
  /** Rate-limited send (3 msgs/s, movement coalesced). Dropped until the channel exists. */
  send(msg: GameMessage): void;
  /** Leave the channel. `last` (usually `bye`) is sent directly, bypassing the gate. */
  leave(last?: GameMessage): void;
}

/** Broadcast channel `game:{roomId}` (spec §8). Browser only. */
export function joinGameChannel(
  roomId: string,
  bounds: { width: number; height: number },
  handlers: GameChannelHandlers,
): GameChannelHandle {
  const topic = `game:${roomId}`;
  let channel: RealtimeChannel | null = null;
  let left = false;
  const post = (msg: GameMessage) => {
    if (!channel) return;
    const { event, payload } = toPayload(msg);
    channel.send({ type: "broadcast", event, payload }).catch(() => {});
  };
  const gate = createSendGate(post);

  const joined = whenTopicFree(topic).then(() => {
    if (left) return;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    for (const ev of GAME_EVENTS) {
      ch.on("broadcast", { event: ev }, (m: { payload?: unknown }) => {
        const msg = parseGameMessage(ev, m.payload, bounds);
        if (msg) handlers.onMessage(msg);
      });
    }
    ch.subscribe((status) => handlers.onStatus(status === "SUBSCRIBED"));
    channel = ch;
  });

  return {
    send: (msg) => gate.push(msg),
    leave: (last) => {
      if (left) return;
      left = true;
      gate.dispose();
      markLeaving(topic, joined.then(() => {
        if (!channel) return;
        if (last) post(last);
        return supabase.removeChannel(channel);
      }));
    },
  };
}
```

- [ ] **Step 6: Implement `components/game/GameCanvas.tsx`**

```tsx
"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { GameEngine, type RosterEntry } from "@/lib/game/engine";
import { buildHallMap } from "@/lib/game/maps/hall";
import { paintHall } from "@/lib/game/maps/hall-art";
import type { InteractId } from "@/lib/game/maps/types";
import { joinGameChannel } from "@/lib/game/net/channel";
import type { Look } from "@/lib/game/types";

export interface GameCanvasHandle {
  setRoster: (entries: RosterEntry[]) => void;
  setLocal: (info: { name: string; badges: string; look: Look }) => void;
  showBubble: (accountId: string, text: string) => void;
  showReaction: (accountId: string | null, emoji: string) => void;
  setInputEnabled: (enabled: boolean) => void;
  interact: () => void;
  /** Tell everyone my character changed (they re-fetch it). */
  announceLook: () => void;
}

export interface GameCanvasProps {
  ref?: Ref<GameCanvasHandle | null>;
  roomId: string;
  localId: string;
  /** Used once when the world starts; later changes go through the handle's setLocal. */
  initial: { name: string; badges: string; look: Look };
  onInteract: (id: InteractId) => void;
  onPromptChange: (id: InteractId | null) => void;
  onActorClick: (accountId: string) => void;
  onConnectionChange: (connected: boolean) => void;
  onLookChanged: (accountId: string) => void;
  /** The browser has no usable 2D canvas. */
  onUnsupported: () => void;
}

/** The game world: one engine + one broadcast channel per room visit. */
export default function GameCanvas({ ref, roomId, localId, ...rest }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const announceRef = useRef<(() => void) | null>(null);
  const propsRef = useRef(rest);
  useEffect(() => {
    propsRef.current = rest;
  });

  useImperativeHandle(ref, () => ({
    setRoster: (entries) => engineRef.current?.setRoster(entries),
    setLocal: (info) => engineRef.current?.setLocal(info),
    showBubble: (id, text) => engineRef.current?.showBubble(id, text),
    showReaction: (id, emoji) => engineRef.current?.showReaction(id, emoji),
    setInputEnabled: (enabled) => engineRef.current?.setInputEnabled(enabled),
    interact: () => engineRef.current?.interact(),
    announceLook: () => announceRef.current?.(),
  }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const map = buildHallMap();
    const init = propsRef.current.initial;
    let engine: GameEngine;
    try {
      const art = paintHall(map);
      const fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-vt323").trim();
      engine = new GameEngine(canvas, map, art, {
        onLocalMove: (m) => channel.send({ t: "mv", id: localId, ...m }),
        onLocalPath: (m) => channel.send({ t: "pa", id: localId, ...m }),
        onInteract: (id) => propsRef.current.onInteract(id),
        onPromptChange: (id) => propsRef.current.onPromptChange(id),
        onActorClick: (id) => propsRef.current.onActorClick(id),
      }, {
        localId,
        name: init.name,
        badges: init.badges,
        look: init.look,
        fontFamily: fontVar ? `${fontVar}, monospace` : "monospace",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    } catch {
      propsRef.current.onUnsupported();
      return;
    }

    // Answers to someone's `hello` are spread over 1.5 s so a crowd doesn't reply in the same instant.
    const replyTimers = new Set<ReturnType<typeof setTimeout>>();
    const channel = joinGameChannel(roomId, map, {
      onMessage: (msg) => {
        switch (msg.t) {
          case "hello": {
            const timer = setTimeout(() => {
              replyTimers.delete(timer);
              channel.send(engine.snapshot());
            }, Math.random() * 1500);
            replyTimers.add(timer);
            break;
          }
          case "lk":
            propsRef.current.onLookChanged(msg.id);
            break;
          case "bye":
            engine.removeActor(msg.id);
            break;
          default:
            engine.applyMessage(msg);
        }
      },
      onStatus: (connected) => {
        propsRef.current.onConnectionChange(connected);
        if (connected) channel.send({ t: "hello", id: localId });
      },
    });

    engineRef.current = engine;
    announceRef.current = () => channel.send({ t: "lk", id: localId });
    engine.start();
    return () => {
      for (const timer of replyTimers) clearTimeout(timer);
      announceRef.current = null;
      engineRef.current = null;
      channel.leave({ t: "bye", id: localId });
      engine.destroy();
    };
  }, [roomId, localId]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" aria-label="Thế giới game" />;
}
```

- [ ] **Step 7: Typecheck + lint + commit**

Run: `npx tsc --noEmit && pnpm test && npx eslint lib/channel-lifecycle.ts lib/game/net/channel.ts components/game/GameCanvas.tsx tests/unit/channel-lifecycle.test.ts`
Expected: tsc 0 errors; all suites pass; eslint clean.

```bash
git add lib/channel-lifecycle.ts lib/game/net/channel.ts components/game/GameCanvas.tsx tests/unit/channel-lifecycle.test.ts
git commit -m "feat(v13): game broadcast channel + GameCanvas component

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Game UI kit — pixel font, parchment tokens, character editor

**Files:**
- Modify: `app/layout.tsx`, `app/globals.css` (append)
- Create: `components/game/Parchment.tsx`, `components/game/SpritePreview.tsx`, `components/game/CharacterEditor.tsx`, `hooks/useMyCharacter.ts`, `hooks/useLooks.ts`
- Test: `tests/unit/game-character-hooks.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_LOOK`, `fetchCharacters`, `fetchCatalog`, `saveCharacter`, `validateLook`, `characterErrorMessage`, `CatalogItem`, `LookProblem` (Task 5); `SKIN_TONES`, `HAIR_STYLES`, `HAIR_COLORS`, `ItemSlot`, `Look`, `Facing` (Task 5); `SKIN`, `HAIR_COLOR`, `SKIN_LABEL`, `HAIR_STYLE_LABEL`, `HAIR_COLOR_LABEL` (Task 6 `palettes.ts`); `swatchOf` (Task 6 `items.ts`); `getCharacterFrames`, `getPortrait` (Task 7).
- Produces:
  - CSS: `--font-vt323` variable on `<html>`; classes `.font-vt`, `.game-ui` (parchment colour tokens for everything inside), `.game-ui .pch` (panel), `.game-ui .pch-btn`, `.game-ui .pch-btn-primary` (also `[aria-pressed="true"]`).
  - `Parchment.tsx`: named export `ParchmentModal({ title, onClose?, children, className? })` — Esc/backdrop close only when `onClose` is given.
  - `SpritePreview.tsx`: default export `SpritePreview({ look, mode?: "portrait" | "walk", scale?, className? })`.
  - `CharacterEditor.tsx`: default export `CharacterEditor({ mode: "create" | "edit", initial, token, onSaved(look), onClose, onBackToClassic })`.
  - `useMyCharacter(accountId): { look: Look | null; exists: boolean; setSaved(look) }` — `look` null while loading; `exists` false when the account has no row (→ create mode); a failed fetch → `DEFAULT_LOOK` with `exists: true`.
  - `useLooks(accountIds): { looks: Map<string, Look>; refresh(accountId) }` — each account fetched once (retried after a failure), `refresh` re-fetches one account (someone's `lk`).

- [ ] **Step 1: Write the failing test**

`tests/unit/game-character-hooks.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { useLooks } from "@/hooks/useLooks";
import { useMyCharacter } from "@/hooks/useMyCharacter";

const { fetchCharacters } = vi.hoisted(() => ({ fetchCharacters: vi.fn() }));
vi.mock("@/lib/game/character", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/character")>()),
  fetchCharacters: (ids: string[]) => fetchCharacters(ids),
}));

const TAN = { ...DEFAULT_LOOK, skin: "tan" as const };

// braces matter: a function returned from beforeEach is run as a teardown
beforeEach(() => {
  fetchCharacters.mockReset();
});

describe("useMyCharacter", () => {
  it("loads my saved look", async () => {
    fetchCharacters.mockResolvedValue(new Map([["me", TAN]]));
    const { result } = renderHook(() => useMyCharacter("me"));
    expect(result.current.look).toBeNull();
    await waitFor(() => expect(result.current.look).toEqual(TAN));
    expect(result.current.exists).toBe(true);
  });
  it("reports a missing character (editor opens) with the default look", async () => {
    fetchCharacters.mockResolvedValue(new Map());
    const { result } = renderHook(() => useMyCharacter("me"));
    await waitFor(() => expect(result.current.look).toEqual(DEFAULT_LOOK));
    expect(result.current.exists).toBe(false);
  });
  it("falls back to the default look when loading fails", async () => {
    fetchCharacters.mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useMyCharacter("me"));
    await waitFor(() => expect(result.current.look).toEqual(DEFAULT_LOOK));
    expect(result.current.exists).toBe(true);
  });
  it("setSaved replaces the look", async () => {
    fetchCharacters.mockResolvedValue(new Map());
    const { result } = renderHook(() => useMyCharacter("me"));
    await waitFor(() => expect(result.current.look).not.toBeNull());
    act(() => result.current.setSaved(TAN));
    expect(result.current.look).toEqual(TAN);
    expect(result.current.exists).toBe(true);
  });
});

describe("useLooks", () => {
  it("fetches each account once and merges what exists", async () => {
    fetchCharacters.mockImplementation(async (ids: string[]) =>
      new Map(ids.filter((id) => id !== "b").map((id) => [id, TAN] as const)));
    const { result, rerender } = renderHook(({ ids }) => useLooks(ids), { initialProps: { ids: ["a", "b"] } });
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(TAN));
    rerender({ ids: ["b", "a", "c"] });
    await waitFor(() => expect(result.current.looks.has("c")).toBe(true));
    expect(fetchCharacters.mock.calls).toEqual([[["a", "b"]], [["c"]]]);
    expect(result.current.looks.has("b")).toBe(false);
  });
  it("refresh re-fetches one account", async () => {
    fetchCharacters.mockResolvedValue(new Map([["a", TAN]]));
    const { result } = renderHook(() => useLooks(["a"]));
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(TAN));
    const PINK = { ...TAN, hairColor: "pink" as const };
    fetchCharacters.mockResolvedValue(new Map([["a", PINK]]));
    act(() => result.current.refresh("a"));
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(PINK));
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest run tests/unit/game-character-hooks.test.ts`
Expected: FAIL — cannot resolve `@/hooks/useLooks` / `@/hooks/useMyCharacter`.

- [ ] **Step 3: Implement the hooks**

`hooks/useMyCharacter.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { DEFAULT_LOOK, fetchCharacters } from "@/lib/game/character";
import type { Look } from "@/lib/game/types";

export interface MyCharacter {
  /** null while loading. */
  look: Look | null;
  /** false = no saved character yet → the editor opens in create mode. */
  exists: boolean;
  /** Call after a successful save. */
  setSaved: (look: Look) => void;
}

export function useMyCharacter(accountId: string): MyCharacter {
  const [state, setState] = useState<{ id: string; look: Look | null; exists: boolean }>({ id: accountId, look: null, exists: true });

  useEffect(() => {
    let active = true;
    fetchCharacters([accountId])
      .then((found) => {
        if (active) setState({ id: accountId, look: found.get(accountId) ?? DEFAULT_LOOK, exists: found.has(accountId) });
      })
      // We can't tell whether a row exists → play with the default look rather than forcing the editor.
      .catch(() => {
        if (active) setState({ id: accountId, look: DEFAULT_LOOK, exists: true });
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const setSaved = useCallback((look: Look) => setState({ id: accountId, look, exists: true }), [accountId]);
  const mine = state.id === accountId;
  return { look: mine ? state.look : null, exists: mine ? state.exists : true, setSaved };
}
```

`hooks/useLooks.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchCharacters } from "@/lib/game/character";
import type { Look } from "@/lib/game/types";

/** Looks of other members: each account is fetched once, and again on refresh (their `lk`). Missing → DEFAULT_LOOK at the caller. */
export function useLooks(accountIds: string[]): { looks: Map<string, Look>; refresh: (accountId: string) => void } {
  const [looks, setLooks] = useState<Map<string, Look>>(() => new Map());
  const requested = useRef(new Set<string>());
  const key = [...new Set(accountIds)].sort().join(",");

  const load = useCallback((ids: string[]) => {
    fetchCharacters(ids)
      .then((found) => {
        if (found.size === 0) return;
        setLooks((prev) => {
          const next = new Map(prev);
          for (const [id, look] of found) next.set(id, look);
          return next;
        });
      })
      .catch(() => {
        for (const id of ids) requested.current.delete(id); // retried on the next roster change
      });
  }, []);

  useEffect(() => {
    const missing = (key ? key.split(",") : []).filter((id) => !requested.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);
    load(missing);
  }, [key, load]);

  const refresh = useCallback((accountId: string) => {
    requested.current.add(accountId);
    load([accountId]);
  }, [load]);

  return { looks, refresh };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest run tests/unit/game-character-hooks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: VT323 font + parchment tokens**

Read `node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md` first (static Google fonts need `weight`). In `app/layout.tsx`:

1. Change the second `next/font/google` import to:

```ts
import { Cormorant_Garamond, EB_Garamond, Playfair_Display, Pixelify_Sans, VT323 } from "next/font/google";
```

2. Right after the `const pixel = Pixelify_Sans(…);` line add:

```ts
// Game mode (v13) HUD + canvas text. Static font → needs `weight`; has a Vietnamese subset.
const vt323 = VT323({ weight: "400", variable: "--font-vt323", subsets: ["latin", "vietnamese"], display: "swap" });
```

3. In the `<html className={…}>` template add `${vt323.variable}` right after `${pixel.variable}`.

Append to the end of `app/globals.css`:

```css
/* ---------------------------------------------------------------- v13 game mode */
/* Parchment palette for everything inside the game (incl. reused room panels), whatever the app theme. */
.game-ui {
  --color-parchment: #f3e6c4;
  --color-parchment-200: #ead9b0;
  --color-parchment-300: #dfc99a;
  --color-cream: #fbf3dc;
  --color-ink: #4a2e17;
  --color-burgundy: #8b5a2b;
  --color-burgundy-accent: #a8743f;
  --color-gold: #b08d57;
  --color-gold-200: #e3cc9c;
  --color-green-vintage: #4f8a3a;
}
/* `.game-ui .font-vt` beats theme rules such as html[data-theme="cozy"] button */
.font-vt,
.game-ui .font-vt { font-family: var(--font-vt323), ui-monospace, monospace; }
.game-ui .pch {
  background: var(--color-cream);
  color: var(--color-ink);
  border: 3px solid var(--color-burgundy);
  border-radius: 4px;
  box-shadow: 0 0 0 2px var(--color-parchment-300), 4px 4px 0 rgb(58 36 24 / 0.35);
}
.game-ui .pch-btn {
  font-family: var(--font-vt323), ui-monospace, monospace;
  font-size: 1.125rem;
  line-height: 1;
  padding: 0.3rem 0.6rem;
  color: var(--color-ink);
  background: var(--color-parchment);
  border: 2px solid var(--color-burgundy);
  border-radius: 3px;
  box-shadow: 2px 2px 0 rgb(58 36 24 / 0.35);
}
.game-ui .pch-btn:hover { background: var(--color-parchment-200); }
.game-ui .pch-btn:active { transform: translate(1px, 1px); box-shadow: 1px 1px 0 rgb(58 36 24 / 0.35); }
.game-ui .pch-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.game-ui .pch-btn[aria-pressed="true"],
.game-ui .pch-btn-primary { background: var(--color-burgundy); color: var(--color-cream); }
.game-ui .pch-btn[aria-pressed="true"]:hover,
.game-ui .pch-btn-primary:hover { background: var(--color-burgundy-accent); }
```

- [ ] **Step 6: Parchment modal, sprite preview, character editor**

`components/game/Parchment.tsx`:

```tsx
"use client";

import { useEffect, type ReactNode } from "react";

/** Parchment dialog for the game HUD. Esc and the backdrop close it when `onClose` is given. */
export function ParchmentModal({ title, onClose, children, className = "" }: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <section className={`pch relative flex max-h-[90vh] w-full max-w-lg flex-col p-3 ${className}`}>
        <header className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-vt text-2xl leading-none text-burgundy">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="pch-btn" aria-label="Đóng">
              ✕
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
```

`components/game/SpritePreview.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { getCharacterFrames, getPortrait } from "@/lib/game/art/raster";
import type { Facing, Look } from "@/lib/game/types";

const TURN: Facing[] = ["down", "left", "up", "right"];

/** A look on a small pixel canvas: a static head portrait, or a walking preview that turns every 1.2 s. */
export default function SpritePreview({ look, mode = "portrait", scale = 2, className = "" }: {
  look: Look;
  mode?: "portrait" | "walk";
  scale?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = 24 * scale;
  const h = (mode === "portrait" ? 24 : 48) * scale;

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    ctx.imageSmoothingEnabled = false;
    if (mode === "portrait") {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(getPortrait(look), 0, 0, cv.width, cv.height);
      return;
    }
    const frames = getCharacterFrames(look);
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    let raf = 0;
    const draw = (t: number) => {
      const sec = (t - start) / 1000;
      const facing = TURN[Math.floor(sec / 1.2) % TURN.length];
      const frame = still ? 0 : ((Math.floor(sec * 8) % 4) as 0 | 1 | 2 | 3);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(frames[facing][frame], 0, 0, cv.width, cv.height);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [look, mode]);

  return (
    <canvas
      ref={ref}
      width={w}
      height={h}
      className={className}
      style={{ width: w, height: h, imageRendering: "pixelated" }}
      aria-hidden="true"
    />
  );
}
```

`components/game/CharacterEditor.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { swatchOf } from "@/lib/game/art/items";
import { HAIR_COLOR, HAIR_COLOR_LABEL, HAIR_STYLE_LABEL, SKIN, SKIN_LABEL } from "@/lib/game/art/palettes";
import {
  characterErrorMessage, fetchCatalog, saveCharacter, validateLook, type CatalogItem, type LookProblem,
} from "@/lib/game/character";
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type ItemSlot, type Look } from "@/lib/game/types";
import { ParchmentModal } from "./Parchment";
import SpritePreview from "./SpritePreview";

type ItemField = "hat" | "top" | "bottom" | "shoes" | "neck";
const ITEM_ROWS: Array<{ field: ItemField; slot: ItemSlot; label: string; optional: boolean }> = [
  { field: "hat", slot: "hat", label: "Mũ", optional: true },
  { field: "top", slot: "top", label: "Áo", optional: false },
  { field: "bottom", slot: "bottom", label: "Quần", optional: false },
  { field: "shoes", slot: "shoes", label: "Dép", optional: false },
  { field: "neck", slot: "neck", label: "Khăn", optional: true },
];

const PROBLEM_TEXT: Record<LookProblem, string> = {
  option: "Lựa chọn ngoại hình không hợp lệ.",
  slot: "Món đồ này chưa dùng được.",
  missing: "Hãy chọn áo, quần và dép.",
};

function Swatch({ color, label, selected, onClick }: { color: string | null; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={`flex h-9 min-w-9 items-center justify-center rounded-sm border-2 px-1 font-vt text-base leading-none ${selected ? "border-burgundy ring-2 ring-gold" : "border-gold-200"}`}
      style={color ? { background: color } : undefined}
    >
      {color ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}

/** Create (first entry) or edit ("👕 Tủ đồ") my character. */
export default function CharacterEditor({ mode, initial, token, onSaved, onClose, onBackToClassic }: {
  mode: "create" | "edit";
  initial: Look;
  token: string;
  onSaved: (look: Look) => void;
  onClose: () => void;
  onBackToClassic: () => void;
}) {
  const [draft, setDraft] = useState<Look>(initial);
  const [catalog, setCatalog] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchCatalog()
      .then((items) => {
        if (active) setCatalog(items);
      })
      .catch(() => {
        if (active) setError("Không tải được danh sách đồ — thử lại sau.");
      });
    return () => {
      active = false;
    };
  }, []);

  const set = <K extends keyof Look>(key: K, value: Look[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    if (!catalog || saving) return;
    const problem = validateLook(draft, catalog);
    if (problem) {
      setError(PROBLEM_TEXT[problem]);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onSaved(await saveCharacter(token, draft));
    } catch (e) {
      setError(characterErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const itemsFor = (slot: ItemSlot) => (catalog ?? []).filter((c) => c.slot === slot && c.starter);

  return (
    <ParchmentModal title={mode === "create" ? "Tạo nhân vật" : "Tủ đồ"} onClose={mode === "edit" ? onClose : undefined} className="max-w-2xl">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex shrink-0 flex-col items-center gap-2 self-center sm:self-start">
          <div className="rounded-sm border-2 border-gold-200 bg-parchment p-2">
            <SpritePreview look={draft} mode="walk" scale={3} />
          </div>
          {mode === "create" && <p className="max-w-40 text-center font-vt text-lg leading-tight">Chọn dáng cho nhân vật của bạn nhé!</p>}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 font-vt text-lg">
          <div>
            <p className="leading-none">Da</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {SKIN_TONES.map((s) => (
                <Swatch key={s} color={SKIN[s].s} label={SKIN_LABEL[s]} selected={draft.skin === s} onClick={() => set("skin", s)} />
              ))}
            </div>
          </div>
          <div>
            <p className="leading-none">Kiểu tóc</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {HAIR_STYLES.map((h) => (
                <Swatch key={h} color={null} label={HAIR_STYLE_LABEL[h]} selected={draft.hair === h} onClick={() => set("hair", h)} />
              ))}
            </div>
          </div>
          <div>
            <p className="leading-none">Màu tóc</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {HAIR_COLORS.map((c) => (
                <Swatch key={c} color={HAIR_COLOR[c].h} label={HAIR_COLOR_LABEL[c]} selected={draft.hairColor === c} onClick={() => set("hairColor", c)} />
              ))}
            </div>
          </div>
          {ITEM_ROWS.map((row) => (
            <div key={row.field}>
              <p className="leading-none">{row.label}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {row.optional && (
                  <Swatch color={null} label="Không" selected={draft[row.field] === null} onClick={() => set(row.field, null)} />
                )}
                {itemsFor(row.slot).map((it) => (
                  <Swatch key={it.id} color={swatchOf(it.id)} label={it.name} selected={draft[row.field] === it.id} onClick={() => set(row.field, it.id)} />
                ))}
                {!catalog && !error && <span className="text-base opacity-70">Đang tải…</span>}
              </div>
            </div>
          ))}
          {error && <p className="text-base text-burgundy-accent" role="alert">{error}</p>}
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            {mode === "create" ? (
              <button type="button" className="pch-btn" onClick={onBackToClassic}>
                🖥️ Về giao diện cũ
              </button>
            ) : (
              <button type="button" className="pch-btn" onClick={onClose}>
                Huỷ
              </button>
            )}
            <button type="button" className="pch-btn pch-btn-primary" disabled={!catalog || saving} onClick={() => void save()}>
              {saving ? "Đang lưu…" : "Lưu"}
            </button>
          </div>
        </div>
      </div>
    </ParchmentModal>
  );
}
```

- [ ] **Step 7: Verify + commit**

Run: `npx tsc --noEmit && pnpm test && npx eslint app/layout.tsx components/game/Parchment.tsx components/game/SpritePreview.tsx components/game/CharacterEditor.tsx hooks/useMyCharacter.ts hooks/useLooks.ts tests/unit/game-character-hooks.test.ts`
Expected: tsc 0 errors; all suites pass; eslint clean. (The editor is exercised in the browser in Task 17 — it is only mounted by the GameShell of Task 16.)

```bash
git add app/layout.tsx app/globals.css components/game/Parchment.tsx components/game/SpritePreview.tsx components/game/CharacterEditor.tsx hooks/useMyCharacter.ts hooks/useLooks.ts tests/unit/game-character-hooks.test.ts
git commit -m "feat(v13): pixel font, parchment UI kit and character editor

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: GameShell — roster, bubbles, reactions, HUD and panels

**Files:**
- Create: `lib/game/social.ts`, `components/game/HudNowPlaying.tsx`, `components/game/HudChatBar.tsx`, `components/game/QueuePanel.tsx`
- Modify: `lib/reactions.ts` (full replacement), `hooks/useReactions.ts`, `components/game/GameShell.tsx` (replace the Task 3 stub entirely)
- Test: `tests/unit/game-social.test.ts`, `tests/unit/reactions.test.ts` (add cases)

**Interfaces:**
- Consumes: `RosterEntry`, `GameCanvasHandle`, `GameCanvas` (Tasks 13–14); `whenTopicFree`, `markLeaving` (Task 14); `assignSpots` (Task 11); `HALL_DJ_SPOT`, `HALL_SEATS`, `HALL_STAND_SPOTS` (Task 9); `InteractId`, `GameMap` (Task 8); `DEFAULT_LOOK`, `Look` (Task 5); `PresenceEntry` + `RoomView.presence` (Task 2); `RoomDerived` (Task 1); `GameShellProps` (Task 3 — unchanged); Task 15 components/hooks; existing `useChat`, `ChatDrawer`, `MemberList`, `RoomChartModal`, `SettingsDialog`, `AddSong`, `MyPending`, `PendingQueue`, `Queue`, `formatChatMessageBody`, `parseChatMessageBody`, `computeElapsedMs`, `formatClock`, `PlaybackController`.
- Produces:
  - `social.ts` (pure): `RoleAccounts`, `badgesFor(accountId, roles, classic)`, `roleAccounts(room, members)`, `RosterInput`, `buildRoster(input): RosterEntry[]`, `freshChatBubbles(messages, shown, now, maxAgeMs = 30_000)`.
  - `lib/reactions.ts`: `ReactionData.accountId?` (optional → old clients keep working), pure `parseReaction(message)`, `joinReactions` now waits for the previous leave of its topic (the classic `Reactions` and the game shell alternate on a view switch).
  - `useReactions(roomId, username?, options?: { onEvent?(data) })` — `onEvent` fires for every reaction (mine and others'); sent reactions carry `accountId`.
  - The real `GameShell` (same `GameShellProps` as the Task 3 stub).

GameShell rules (spec §10–§12): classic-view members are drawn seated (DJ behind the mixer) with 🖥️, game-view members walk; badges 👑/🎧; chat messages (≤ 30 s old, not shown before) pop up as bubbles over their author; reactions float from the sender (from the top of the screen for old clients); the canvas ignores the keyboard while any panel or the create-editor is open; the booth opens **📜 Quầy DJ — Hàng đợi**, the notice board opens `RoomChartModal`, the dock sign shows the toast *"Ao câu cá sắp mở — hẹn bản sau!"*; clicking a character shows a small card; no saved character → the editor opens in create mode (its only way out is **🖥️ Về giao diện cũ**); no 2D canvas → alert + back to classic. `document.body` gets `game-ui` while the shell is mounted so portal modals (`RoomChartModal`) use the parchment palette too.

- [ ] **Step 1: Write the failing tests**

`tests/unit/game-social.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@/lib/chat";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { Member } from "@/lib/supabase";

const member = (id: string, account: string, username: string): Member =>
  ({ id, room_id: "r", account_id: account, joined_at: "", username });
const members = [
  member("m1", "admin", "An"), member("m2", "dj", "Dũng"), member("m3", "c1", "Cúc"),
  member("m4", "c2", "Chi"), member("m5", "g1", "Giang"), member("m6", "me", "Tôi"),
];
const room = { admin_member_id: "m1", dj_member_id: "m2" };
const map = {
  djSpot: { x: 320, y: 124, dir: "down" as const },
  seats: [{ x: 1, y: 1, dir: "down" as const }, { x: 2, y: 2, dir: "down" as const }],
  standSpots: [{ x: 9, y: 9, dir: "left" as const }],
};

describe("roles and badges", () => {
  it("maps role member ids to account ids", () => {
    expect(roleAccounts(room, members)).toEqual({ adminAccountId: "admin", djAccountId: "dj" });
    expect(roleAccounts({ admin_member_id: null, dj_member_id: "gone" }, members)).toEqual({ adminAccountId: null, djAccountId: null });
  });
  it("combines admin, DJ and classic badges", () => {
    const roles = { adminAccountId: "a", djAccountId: "d" };
    expect(badgesFor("a", roles, false)).toBe("👑");
    expect(badgesFor("d", roles, true)).toBe("🎧🖥️");
    expect(badgesFor("x", roles, false)).toBe("");
  });
});

describe("buildRoster", () => {
  const presence = [
    { accountId: "admin", name: "An", mode: "classic" as const },
    { accountId: "dj", name: "Dũng", mode: "classic" as const },
    { accountId: "c2", name: "Chi", mode: "classic" as const },
    { accountId: "g1", name: "Giang", mode: "game" as const },
    { accountId: "me", name: "Tôi", mode: "game" as const },
    { accountId: "stranger", name: "Lạ", mode: "game" as const },
  ];
  const TAN = { ...DEFAULT_LOOK, skin: "tan" as const };
  const roster = buildRoster({ presence, members, room, localId: "me", looks: new Map([["g1", TAN]]), map });
  const byId = new Map(roster.map((r) => [r.id, r]));

  it("lists online members except me and non-members", () => {
    expect([...byId.keys()].sort()).toEqual(["admin", "c2", "dj", "g1"]);
  });
  it("puts a classic DJ behind the mixer and seats the other classic members in id order", () => {
    expect(byId.get("dj")?.spot).toEqual(map.djSpot);
    expect(byId.get("admin")?.spot).toEqual(map.seats[0]);
    expect(byId.get("c2")?.spot).toEqual(map.seats[1]);
    expect(byId.get("g1")?.spot).toBeNull();
  });
  it("uses member names, role badges and looks (default when unknown)", () => {
    expect(byId.get("admin")).toMatchObject({ name: "An", badges: "👑🖥️" });
    expect(byId.get("dj")?.badges).toBe("🎧🖥️");
    expect(byId.get("g1")).toMatchObject({ name: "Giang", badges: "", look: TAN });
    expect(byId.get("c2")?.look).toEqual(DEFAULT_LOOK);
  });
});

describe("freshChatBubbles", () => {
  const now = Date.parse("2026-09-24T10:00:00Z");
  const msg = (id: string, account: string | null, ageMs: number): ChatMessage =>
    ({ id, room_id: "r", account_id: account, username: "u", body: "hi", created_at: new Date(now - ageMs).toISOString() });
  it("keeps unseen, recent messages written by people", () => {
    const out = freshChatBubbles([msg("1", "a", 5_000), msg("2", "a", 60_000), msg("3", null, 0), msg("4", "b", 0)], new Set(["4"]), now);
    expect(out.map((m) => m.id)).toEqual(["1"]);
  });
});
```

In `tests/unit/reactions.test.ts` replace the line `import { throttled, REACTION_EMOJIS, type ReactionData } from "@/lib/reactions";` with the block below (it imports `parseReaction` and adds three cases):

```ts
import { parseReaction, throttled, REACTION_EMOJIS, type ReactionData } from "@/lib/reactions";

describe("parseReaction", () => {
  it("reads the broadcast envelope and keeps username + accountId", () => {
    expect(parseReaction({ type: "broadcast", event: "react", payload: { emoji: "🔥", username: " hunglt ", accountId: "acc-1" } }))
      .toEqual({ emoji: "🔥", username: "hunglt", accountId: "acc-1" });
  });
  it("accepts old clients: bare emoji strings and payloads without accountId", () => {
    expect(parseReaction({ payload: "🎉" })).toEqual({ emoji: "🎉" });
    expect(parseReaction({ payload: { emoji: "👏", username: "" } })).toEqual({ emoji: "👏" });
  });
  it("drops unknown emojis and junk", () => {
    expect(parseReaction({ payload: { emoji: "💩" } })).toBeNull();
    expect(parseReaction({ payload: 42 })).toBeNull();
    expect(parseReaction(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run tests/unit/game-social.test.ts tests/unit/reactions.test.ts`
Expected: FAIL — cannot resolve `@/lib/game/social`; `parseReaction` is not exported.

- [ ] **Step 3: Implement `lib/game/social.ts`**

```ts
import type { ChatMessage } from "@/lib/chat";
import { DEFAULT_LOOK } from "@/lib/game/character";
import type { RosterEntry } from "@/lib/game/engine";
import type { GameMap } from "@/lib/game/maps/types";
import { assignSpots } from "@/lib/game/seating";
import type { Look } from "@/lib/game/types";
import type { PresenceEntry } from "@/lib/presence-modes";
import type { Member, Room } from "@/lib/supabase";

export interface RoleAccounts { adminAccountId: string | null; djAccountId: string | null }

/** 👑 admin, 🎧 DJ, 🖥️ still in the classic view. */
export function badgesFor(accountId: string, roles: RoleAccounts, classic: boolean): string {
  return `${accountId === roles.adminAccountId ? "👑" : ""}${accountId === roles.djAccountId ? "🎧" : ""}${classic ? "🖥️" : ""}`;
}

/** Room roles are stored as member ids; the game works with account ids. */
export function roleAccounts(room: Pick<Room, "admin_member_id" | "dj_member_id">, members: Member[]): RoleAccounts {
  const accountOf = (memberId: string | null) => members.find((m) => m.id === memberId)?.account_id ?? null;
  return { adminAccountId: accountOf(room.admin_member_id), djAccountId: accountOf(room.dj_member_id) };
}

export interface RosterInput {
  presence: PresenceEntry[];
  members: Member[];
  room: Pick<Room, "admin_member_id" | "dj_member_id">;
  localId: string;
  looks: Map<string, Look>;
  map: Pick<GameMap, "djSpot" | "seats" | "standSpots">;
}

/**
 * Everyone online in the room except me (non-members are ignored). Classic-view members get a fixed
 * spot — the DJ behind the mixer, the others on café seats in account-id order — so every client
 * shows the same arrangement. Game-view members walk (spot null).
 */
export function buildRoster({ presence, members, room, localId, looks, map }: RosterInput): RosterEntry[] {
  const byAccount = new Map(members.map((m) => [m.account_id, m] as const));
  const roles = roleAccounts(room, members);
  const online = presence.filter((p) => p.accountId !== localId && byAccount.has(p.accountId));
  const seated = online.filter((p) => p.mode === "classic" && p.accountId !== roles.djAccountId).map((p) => p.accountId);
  const spots = assignSpots(seated, map.seats, map.standSpots);
  return online.map((p) => {
    const classic = p.mode === "classic";
    const spot = !classic ? null : p.accountId === roles.djAccountId ? map.djSpot : spots.get(p.accountId) ?? null;
    return {
      id: p.accountId,
      name: byAccount.get(p.accountId)?.username || p.name || "Khách",
      badges: badgesFor(p.accountId, roles, classic),
      look: looks.get(p.accountId) ?? DEFAULT_LOOK,
      spot,
    };
  });
}

/** Chat messages that should pop up as bubbles: not shown yet, written by a person, at most maxAgeMs old. */
export function freshChatBubbles(messages: ChatMessage[], shown: ReadonlySet<string>, now: number, maxAgeMs = 30_000): ChatMessage[] {
  return messages.filter((m) => !shown.has(m.id) && m.account_id !== null && now - Date.parse(m.created_at) <= maxAgeMs);
}
```

- [ ] **Step 4: Replace `lib/reactions.ts`**

`lib/reactions.ts` (whole file — this also removes its four pre-existing `no-explicit-any` lint errors):

```ts
import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";

export const REACTION_EMOJIS = ["❤️", "😂", "🔥", "👏", "🎉"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionData {
  emoji: ReactionEmoji;
  username?: string;
  /** v13: lets game mode float the emoji from the sender's character. Absent from older clients. */
  accountId?: string;
}

export interface ReactionsHandle {
  send: (data: ReactionEmoji | ReactionData) => void;
  unsubscribe: () => void;
}

const isEmoji = (v: unknown): v is ReactionEmoji =>
  typeof v === "string" && (REACTION_EMOJIS as readonly string[]).includes(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** A broadcast message (or its payload, or a bare emoji string from old clients) → ReactionData; null if unusable. */
export function parseReaction(message: unknown): ReactionData | null {
  const outer = message !== null && typeof message === "object" ? (message as Record<string, unknown>) : null;
  const raw = outer && "payload" in outer ? outer.payload : message;
  if (isEmoji(raw)) return { emoji: raw };
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const emoji = r.emoji ?? outer?.emoji;
  if (!isEmoji(emoji)) return null;
  const data: ReactionData = { emoji };
  const username = text(r.username ?? outer?.username);
  const accountId = text(r.accountId);
  if (username) data.username = username;
  if (accountId) data.accountId = accountId;
  return data;
}

/** Ephemeral floating reactions over a dedicated Broadcast channel (no DB). self:false → no echo. */
export function joinReactions(
  roomId: string,
  onReact: (data: ReactionData) => void,
): ReactionsHandle {
  const topic = `reactions:${roomId}`;
  let channel: RealtimeChannel | null = null;
  let closed = false;
  // classic ↔ game switches unmount one subscriber and mount another in the same commit
  const ready = whenTopicFree(topic).then(() => {
    if (closed) return;
    channel = supabase
      .channel(topic, { config: { broadcast: { ack: true, self: false } } })
      .on("broadcast", { event: "react" }, (message) => {
        const data = parseReaction(message);
        if (data) onReact(data);
      })
      .subscribe();
  });

  return {
    send: (data) => {
      const payload: ReactionData = typeof data === "string" ? { emoji: data } : data;
      channel?.send({ type: "broadcast", event: "react", payload }).catch(() => {});
    },
    unsubscribe: () => {
      closed = true;
      markLeaving(topic, ready.then(() => (channel ? supabase.removeChannel(channel) : undefined)));
    },
  };
}

/** Pure: true if a new send should be dropped (within minGapMs of the last). */
export function throttled(lastAt: number | null, now: number, minGapMs = 250): boolean {
  return lastAt !== null && now - lastAt < minGapMs;
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm vitest run tests/unit/game-social.test.ts tests/unit/reactions.test.ts`
Expected: PASS (6 + 8 tests).

- [ ] **Step 6: `useReactions` — `onEvent` + `accountId`**

In `hooks/useReactions.ts`:

1. Replace the line `export function useReactions(roomId: string, currentUsername?: string) {` and the `const { account } = useAuth();` line after it with:

```ts
export interface UseReactionsOptions {
  /** Called for every reaction, mine (optimistic) and others' — game mode floats them over characters. */
  onEvent?: (data: ReactionData) => void;
}

export function useReactions(roomId: string, currentUsername?: string, options: UseReactionsOptions = {}) {
  const { account } = useAuth();
  const onEventRef = useRef(options.onEvent);
  useEffect(() => {
    onEventRef.current = options.onEvent;
  });
```

2. Make `onEventRef.current?.(data);` the first statement inside `const spawn = useCallback((data: ReactionData) => {`.
3. In `react`, build the payload with the account id and extend the dependency list:

```ts
      const data: ReactionData = { emoji, username: uname?.trim() || undefined, accountId: account?.accountId || undefined };
```

```ts
    [spawn, effectiveUsername, account?.username, account?.accountId],
```

- [ ] **Step 7: HUD pieces**

`components/game/HudNowPlaying.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { PlaybackController } from "@/hooks/usePlayback";
import { formatClock } from "@/lib/format";
import { computeElapsedMs } from "@/lib/identity";
import type { QueueItem, Room } from "@/lib/supabase";

/** Top-right parchment card: what is playing, DJ transport (DJ only), volume, audio unlock, panel buttons. */
export default function HudNowPlaying({ room, current, djName, canControl, playback, canOpenSettings, onOpenQueue, onOpenBoard, onOpenSettings }: {
  room: Room;
  current: QueueItem | null;
  djName: string | null;
  canControl: boolean;
  playback: PlaybackController;
  canOpenSettings: boolean;
  onOpenQueue: () => void;
  onOpenBoard: () => void;
  onOpenSettings: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);
  const { is_playing, started_at, paused_elapsed_ms } = room;
  useEffect(() => {
    const tick = () => setElapsed(computeElapsedMs({ is_playing, started_at, paused_elapsed_ms }));
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 500);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [is_playing, started_at, paused_elapsed_ms]);

  const dur = playback.durationMs || (current?.duration_seconds ? current.duration_seconds * 1000 : 0);
  const shown = dur ? Math.min(elapsed, dur) : elapsed;

  return (
    <div className="pch pointer-events-auto flex w-72 max-w-[calc(100vw-1rem)] flex-col gap-1.5 p-2 font-vt text-lg leading-none">
      <p className="truncate text-xl" title={current?.title ?? undefined}>🎵 {current?.title ?? "Chưa có bài nào"}</p>
      <p className="truncate text-base opacity-80">🎧 {djName ? `DJ: ${djName}` : "Chưa có DJ"}</p>
      <div className="flex items-center gap-2 text-base">
        <span className="w-10 text-right tabular-nums">{formatClock(shown)}</span>
        {canControl ? (
          <input
            type="range"
            min={0}
            max={dur || 0}
            value={shown}
            disabled={!current || !dur}
            onChange={(e) => playback.seekMs(Number(e.target.value))}
            className="flex-1 accent-burgundy"
            aria-label="Tua bài"
          />
        ) : (
          <div className="h-1.5 flex-1 overflow-hidden rounded-sm bg-parchment-300">
            <div className="h-full bg-burgundy" style={{ width: `${dur ? (shown / dur) * 100 : 0}%` }} />
          </div>
        )}
        <span className="w-10 tabular-nums">{dur ? formatClock(dur) : "--:--"}</span>
      </div>
      <div className="flex items-center gap-1.5">
        {canControl && (
          <>
            <button type="button" className="pch-btn" onClick={playback.togglePlay} disabled={!current} aria-label={room.is_playing ? "Tạm dừng" : "Phát"}>
              {room.is_playing ? "⏸" : "▶"}
            </button>
            <button type="button" className="pch-btn" onClick={playback.skip} disabled={!current} aria-label="Bài tiếp">
              ⏭
            </button>
          </>
        )}
        <span aria-hidden="true">🔊</span>
        <input
          type="range"
          min={0}
          max={100}
          value={playback.volume}
          onChange={(e) => playback.setVolume(Number(e.target.value))}
          className="min-w-0 flex-1 accent-burgundy"
          aria-label="Âm lượng"
        />
      </div>
      {!playback.unlocked && (
        <button type="button" className="pch-btn pch-btn-primary" onClick={playback.unlock}>
          🔈 Bật âm thanh
        </button>
      )}
      {playback.playError && <p className="text-base text-burgundy-accent">{playback.playError}</p>}
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className="pch-btn" onClick={onOpenQueue}>📜 Hàng đợi</button>
        <button type="button" className="pch-btn" onClick={onOpenBoard}>🏆 Bảng tin</button>
        {canOpenSettings && (
          <button type="button" className="pch-btn" onClick={onOpenSettings} aria-label="Cài đặt phòng">⚙️</button>
        )}
      </div>
    </div>
  );
}
```

`components/game/HudChatBar.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { REACTION_EMOJIS, type ReactionEmoji } from "@/lib/reactions";

/** Bottom bar: quick chat (hidden under 640 px — use 💬), reactions, chat drawer, members, back to classic. */
export default function HudChatBar({ onSend, onReact, onOpenChat, onOpenMembers, onlineCount, onExitGame }: {
  onSend: (text: string) => Promise<void>;
  onReact: (emoji: ReactionEmoji) => void;
  onOpenChat: () => void;
  onOpenMembers: () => void;
  onlineCount: number;
  onExitGame: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body);
      setText("");
    } catch {
      setError("Không gửi được — thử lại nhé.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1 font-vt text-lg">
      {picker && (
        <div className="pch flex gap-1 p-1" role="group" aria-label="Thả cảm xúc">
          {REACTION_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" className="pch-btn text-2xl" onClick={() => onReact(emoji)} title={`Thả ${emoji}`}>
              {emoji}
            </button>
          ))}
        </div>
      )}
      {error && <p className="pch px-2 py-0.5 text-base text-burgundy-accent" role="alert">{error}</p>}
      <div className="pch flex w-[min(40rem,calc(100vw-1rem))] items-center gap-1.5 p-1.5">
        <form onSubmit={(e) => void submit(e)} className="hidden min-w-0 flex-1 gap-1.5 sm:flex">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="Nhắn gì đó… (Enter để gửi)"
            className="min-w-0 flex-1 rounded-sm border-2 border-gold-200 bg-parchment px-2 py-1 text-lg leading-none outline-none focus:border-burgundy"
            aria-label="Tin nhắn"
          />
          <button type="submit" className="pch-btn" disabled={sending || !text.trim()}>Gửi</button>
        </form>
        <div className="ml-auto flex shrink-0 gap-1.5 sm:ml-0">
          <button type="button" className="pch-btn" aria-pressed={picker} onClick={() => setPicker((p) => !p)} aria-label="Thả cảm xúc">😊</button>
          <button type="button" className="pch-btn" onClick={onOpenChat} aria-label="Mở phòng chat">💬</button>
          <button type="button" className="pch-btn" onClick={onOpenMembers} aria-label="Thành viên">👥 {onlineCount}</button>
          <button type="button" className="pch-btn" onClick={onExitGame} title="Quay về giao diện cũ">🖥️ <span className="hidden sm:inline">Giao diện cũ</span></button>
        </div>
      </div>
    </div>
  );
}
```

`components/game/QueuePanel.tsx`:

```tsx
"use client";

import AddSong from "@/components/room/AddSong";
import MyPending from "@/components/room/MyPending";
import PendingQueue from "@/components/room/PendingQueue";
import Queue from "@/components/room/Queue";
import type { RoleFlags } from "@/lib/roles";
import type { RoomDerived } from "@/lib/room-derived";
import type { Room } from "@/lib/supabase";
import { ParchmentModal } from "./Parchment";

/** The DJ booth: the same order/queue components as the classic right column, in a parchment modal. */
export default function QueuePanel({ room, derived, role, token, onClose }: {
  room: Room;
  derived: RoomDerived;
  role: RoleFlags;
  token: string;
  onClose: () => void;
}) {
  const { approved, pending, myPending, rules, willPend, orderLimit } = derived;
  return (
    <ParchmentModal title="📜 Quầy DJ — Hàng đợi" onClose={onClose}>
      <div className="flex flex-col gap-2">
        <AddSong roomId={room.id} token={token} rules={rules} willPend={willPend} orderLimit={orderLimit} />
        <MyPending items={myPending} roomId={room.id} token={token} />
        {role.canManageQueue && (room.require_approval || pending.length > 0) && (
          <PendingQueue pending={pending} roomId={room.id} token={token} />
        )}
        <Queue queue={approved} currentId={room.current_item_id} canManage={role.canManageQueue} roomId={room.id} token={token} />
      </div>
    </ParchmentModal>
  );
}
```

- [ ] **Step 8: Replace `components/game/GameShell.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ChatDrawer from "@/components/room/ChatDrawer";
import MemberList from "@/components/room/MemberList";
import RoomChartModal from "@/components/room/RoomChartModal";
import SettingsDialog from "@/components/room/SettingsDialog";
import { useChat } from "@/hooks/useChat";
import { useLooks } from "@/hooks/useLooks";
import { useMyCharacter } from "@/hooks/useMyCharacter";
import type { PlaybackController } from "@/hooks/usePlayback";
import { useReactions } from "@/hooks/useReactions";
import type { RoomView } from "@/hooks/useRoom";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import { formatChatMessageBody, parseChatMessageBody } from "@/lib/chat-helpers";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { HALL_DJ_SPOT, HALL_SEATS, HALL_STAND_SPOTS } from "@/lib/game/maps/hall";
import type { InteractId } from "@/lib/game/maps/types";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { Look } from "@/lib/game/types";
import type { RoomDerived } from "@/lib/room-derived";
import CharacterEditor from "./CharacterEditor";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
import HudChatBar from "./HudChatBar";
import HudNowPlaying from "./HudNowPlaying";
import { ParchmentModal } from "./Parchment";
import QueuePanel from "./QueuePanel";
import SpritePreview from "./SpritePreview";

export interface GameShellProps {
  view: RoomView;
  derived: RoomDerived;
  playback: PlaybackController;
  sponsorBlock: UseSponsorBlockResult;
  onExitGame: () => void;
}

type Panel = "queue" | "board" | "settings" | "members" | "chat" | "wardrobe" | null;

const HALL_SPOTS = { djSpot: HALL_DJ_SPOT, seats: HALL_SEATS, standSpots: HALL_STAND_SPOTS };
const PROMPT_TEXT: Record<InteractId, string> = {
  dj_booth: "Mở hàng đợi",
  notice_board: "Xem bảng tin",
  dock_sign: "Bến câu cá",
};

/** Game mode: the hall canvas + parchment HUD. Music, queue, chat and roles are the same as the classic view. */
export default function GameShell({ view, derived, playback, onExitGame }: GameShellProps) {
  const { state, role, presence, onlineIds, token, accountId, username, myMemberId } = view;
  const room = state.room!;
  const { members } = state;
  const { admin_member_id, dj_member_id } = room;
  const canvasRef = useRef<GameCanvasHandle | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<InteractId | null>(null);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => setPanel(null), []);

  // Parchment palette for portals too (RoomChartModal renders into <body>).
  useEffect(() => {
    document.body.classList.add("game-ui");
    return () => document.body.classList.remove("game-ui");
  }, []);

  // --- me
  const { look: savedLook, exists, setSaved } = useMyCharacter(accountId);
  const myLook = savedLook ?? DEFAULT_LOOK;
  const roles = roleAccounts({ admin_member_id, dj_member_id }, members);
  const myBadges = badgesFor(accountId, roles, false);
  const myName = username || members.find((m) => m.account_id === accountId)?.username || "Bạn";
  const creating = savedLook !== null && !exists;
  useEffect(() => {
    canvasRef.current?.setLocal({ name: myName, badges: myBadges, look: myLook });
  }, [myName, myBadges, myLook]);

  // --- everyone else
  const { looks, refresh } = useLooks(presence.map((p) => p.accountId).filter((id) => id !== accountId));
  useEffect(() => {
    canvasRef.current?.setRoster(buildRoster({
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks, map: HALL_SPOTS,
    }));
  }, [presence, members, admin_member_id, dj_member_id, accountId, looks]);

  // --- chat bubbles (this shell owns one useChat; the drawer has its own)
  const { messages, send } = useChat(room.id, token, { accountId, isAdmin: role.isAdmin });
  const shownRef = useRef(new Set<string>());
  useEffect(() => {
    for (const m of freshChatBubbles(messages, shownRef.current, Date.now())) {
      shownRef.current.add(m.id);
      if (m.account_id) canvasRef.current?.showBubble(m.account_id, parseChatMessageBody(m.body).text);
    }
  }, [messages]);

  // --- reactions float from the sender's character
  const { react } = useReactions(room.id, myName, {
    onEvent: (data) => canvasRef.current?.showReaction(data.accountId ?? null, data.emoji),
  });

  // --- input is off while any panel or the create editor is open
  const blocking = panel !== null || creating;
  useEffect(() => {
    canvasRef.current?.setInputEnabled(!blocking);
  }, [blocking]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onInteract = useCallback((id: InteractId) => {
    if (id === "dj_booth") setPanel("queue");
    else if (id === "notice_board") setPanel("board");
    else showToast("Ao câu cá sắp mở — hẹn bản sau!");
  }, [showToast]);

  const onUnsupported = useCallback(() => {
    window.alert("Trình duyệt này không vẽ được thế giới game — quay về giao diện cũ.");
    onExitGame();
  }, [onExitGame]);

  const onSaved = useCallback((look: Look) => {
    setSaved(look);
    setPanel(null);
    canvasRef.current?.announceLook();
  }, [setSaved]);

  const djName = members.find((m) => m.account_id === derived.djAccountId)?.username ?? null;
  const cardMember = card ? members.find((m) => m.account_id === card) : undefined;
  const cardPresence = card ? presence.find((p) => p.accountId === card) : undefined;

  return (
    <div className="game-ui fixed inset-0 overflow-hidden bg-[#2f6e8f] text-ink">
      <GameCanvas
        ref={canvasRef}
        roomId={room.id}
        localId={accountId}
        initial={{ name: myName, badges: myBadges, look: myLook }}
        onInteract={onInteract}
        onPromptChange={setPrompt}
        onActorClick={setCard}
        onConnectionChange={setConnected}
        onLookChanged={refresh}
        onUnsupported={onUnsupported}
      />

      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-wrap items-start justify-between gap-2">
        <div className="pch pointer-events-auto flex items-center gap-2 p-1.5 font-vt text-lg leading-none">
          <SpritePreview look={myLook} scale={2} className="rounded-sm bg-parchment" />
          <div className="flex flex-col gap-1">
            <span className="max-w-44 truncate text-xl">{myBadges ? `${myBadges} ` : ""}{myName}</span>
            {!connected && <span className="text-base opacity-80">Đang kết nối thế giới…</span>}
            <button type="button" className="pch-btn self-start" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
              👕 Tủ đồ
            </button>
          </div>
        </div>
        <HudNowPlaying
          room={room}
          current={derived.current}
          djName={djName}
          canControl={role.canControlPlayback}
          playback={playback}
          canOpenSettings={role.isAdmin || role.isDj}
          onOpenQueue={() => setPanel("queue")}
          onOpenBoard={() => setPanel("board")}
          onOpenSettings={() => setPanel("settings")}
        />
      </div>

      {toast && (
        <p className="pch pointer-events-none absolute left-1/2 top-1/3 z-20 -translate-x-1/2 px-3 py-1.5 font-vt text-xl" role="status">
          {toast}
        </p>
      )}

      {card && (
        <div className="pch absolute left-1/2 top-1/4 z-20 flex -translate-x-1/2 items-center gap-2 p-2 font-vt text-lg leading-tight">
          <SpritePreview look={looks.get(card) ?? DEFAULT_LOOK} scale={2} className="rounded-sm bg-parchment" />
          <div className="flex flex-col">
            <span className="text-xl">{cardMember?.username ?? cardPresence?.name ?? "Khách"}</span>
            {card === roles.adminAccountId && <span>👑 Chủ phòng</span>}
            {card === roles.djAccountId && <span>🎧 DJ</span>}
            <span className="opacity-80">{cardPresence?.mode === "classic" ? "🖥️ Đang ở giao diện cũ" : "🎮 Đang dạo quanh sảnh"}</span>
          </div>
          <button type="button" className="pch-btn self-start" onClick={() => setCard(null)} aria-label="Đóng">✕</button>
        </div>
      )}

      {prompt && !blocking && (
        <button
          type="button"
          onClick={() => canvasRef.current?.interact()}
          className="pch-btn pch-btn-primary absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-xl"
        >
          <span className="pointer-coarse:hidden">E · </span>
          {PROMPT_TEXT[prompt]}
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
        <HudChatBar
          onSend={(text) => send(formatChatMessageBody(text))}
          onReact={react}
          onOpenChat={() => setPanel("chat")}
          onOpenMembers={() => setPanel("members")}
          onlineCount={onlineIds.length}
          onExitGame={onExitGame}
        />
      </div>

      {panel === "queue" && <QueuePanel room={room} derived={derived} role={role} token={token} onClose={close} />}
      {panel === "board" && (
        <RoomChartModal room={room} queue={state.queue} current={derived.current} roomId={room.id} token={token} onClose={close} />
      )}
      {panel === "settings" && (
        <SettingsDialog room={room} members={members} roomId={room.id} token={token} myMemberId={myMemberId} isAdmin={role.isAdmin} onClose={close} />
      )}
      {panel === "members" && (
        <ParchmentModal title={`👥 Thành viên (${onlineIds.length})`} onClose={close}>
          <MemberList members={members} room={room} onlineIds={onlineIds} isAdmin={role.isAdmin} token={token} myMemberId={myMemberId} />
        </ParchmentModal>
      )}
      <ChatDrawer
        isOpen={panel === "chat"}
        onClose={close}
        roomId={room.id}
        token={token}
        accountId={accountId}
        isAdmin={role.isAdmin}
        members={members}
        room={room}
      />
      {panel === "wardrobe" && savedLook && (
        <CharacterEditor mode="edit" initial={savedLook} token={token} onSaved={onSaved} onClose={close} onBackToClassic={onExitGame} />
      )}
      {creating && (
        <CharacterEditor mode="create" initial={DEFAULT_LOOK} token={token} onSaved={onSaved} onClose={onExitGame} onBackToClassic={onExitGame} />
      )}
    </div>
  );
}
```

- [ ] **Step 9: Verify + commit**

Run: `npx tsc --noEmit && pnpm test && npx eslint lib/game/social.ts lib/reactions.ts hooks/useReactions.ts components/game tests/unit/game-social.test.ts tests/unit/reactions.test.ts`
Expected: tsc 0 errors; all suites pass; eslint clean.

```bash
git add lib/game/social.ts lib/reactions.ts hooks/useReactions.ts components/game/HudNowPlaying.tsx components/game/HudChatBar.tsx components/game/QueuePanel.tsx components/game/GameShell.tsx tests/unit/game-social.test.ts tests/unit/reactions.test.ts
git commit -m "feat(v13): game shell — roster, chat bubbles, reactions, HUD and panels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: README, full verification, manual checklist

**Files:**
- Modify: `README.md` (append a v13 section)

**Interfaces:**
- Consumes: everything above. Produces: documentation only.

- [ ] **Step 1: Append to `README.md`**

````markdown
## v13: Chế độ game — Sảnh phát nhạc

### DB migration

`supabase/migrations/0011_v13_game_mode.sql` is **additive and re-runnable** (`create table if not exists`, `create or replace function`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor (or `supabase db reset` on dev/staging). It adds `item_catalog` (15 starter items), `characters` (one appearance per account, public read like usernames) and the RPC `save_character`.

### What's new in v13

- **🎮 Chế độ game** (room header) shows the room as a 2D pixel riverside café in the Miền Tây style — stage with a DJ booth, hammock, palms, café tables, river and dock. It is a per-browser choice; **🖥️ Giao diện cũ** switches back. Music never stops on a switch (both views share one player).
- **Your character:** the first visit opens **Tạo nhân vật** — skin, hair style and colour, nón lá / mũ tai bèo, áo bà ba / áo thun, quần, dép, khăn rằn. **👕 Tủ đồ** edits it later; it is saved per account.
- **Moving:** WASD / arrow keys, or click/tap the ground (the character path-finds around tables and the river). Walk to the stage's **Quầy DJ** and press **E** (or tap the prompt) for the queue panel — order, approve, reorder with exactly the same rules as the classic view. **Bảng tin** opens the rankings; **Bến câu cá** is the entrance to the fishing pond coming in v14.
- **Together:** everyone in game view walks around live; members still in the classic view sit at the café tables with 🖥️ (the DJ stands behind the mixer). Chat messages pop up as speech bubbles over their author and reactions float up from the sender.
- **HUD:** now playing with the DJ's ▶/⏸, ⏭ and seek (DJ only), local volume, **🔈 Bật âm thanh**, 📜 Hàng đợi, 🏆 Bảng tin, ⚙️ (Admin/DJ), a chat bar, 💬 full chat and 👥 members.
- All art is original and drawn in code — there are no image assets.

### Realtime budget (Supabase free plan)

Movement uses a Broadcast channel `game:{roomId}` with tiny event messages: an idle player sends nothing, a walking player about 1–2 messages/s (a client never sends more than 3/s), and every message is delivered to each other player in the world. Example: 10 players walking a quarter of the time ≈ 30 events/s (limit 100/s) ≈ 110 k/hour, so the free 2 M messages/month cover roughly 18 hours of a 10-person session (about 100 hours with 4 people). Entering the world costs one `hello` plus one answer per player (answers spread over 1.5 s). Presence carries each member's view mode; switching views re-announces it at most once per second (Presence allows 5 calls per client per 30 s).
````

- [ ] **Step 2: Full automated verification**

Run each and compare with the expectation:

- `npx tsc --noEmit` → 0 errors.
- `pnpm test` → **41 files passed, 8 skipped** (24 + 17 new; the skipped ones need `SUPABASE_TEST_URL`).
- `pnpm lint` → only the **17** pre-existing errors in untouched files (21 at the baseline minus the 4 fixed in `lib/reactions.ts`); no error in any v13 file.
- `pnpm build` → succeeds (catches `next/dynamic` / `ssr: false` misuse and font config errors).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(v13): game mode README + realtime budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Manual verification (controller, with the owner logged in)**

Before this step the owner runs `supabase/migrations/0011_v13_game_mode.sql` in the Supabase SQL Editor. Start the preview server (`dev`), let the owner log in (never type credentials), then — without the owner touching the pane — check:

1. Classic room → **🎮 Chế độ game** → *Tạo nhân vật* opens (first time); change skin/hair/items, the preview walks and turns; **Lưu** → the world shows the character. Reload → still game mode, no editor.
2. Music keeps playing across **🖥️ Giao diện cũ** ↔ **🎮 Chế độ game** (no new "Bật âm thanh").
3. WASD/arrows walk, collisions stop at the stage, tables, water; the dock is walkable; click/tap walks around obstacles.
4. Walk to the booth → prompt **E · Mở hàng đợi** → queue panel: add a song, (Admin/DJ) approve/remove; notice board → rankings; dock sign → toast.
5. Second account (second browser profile or a private window, owner logs in) in game mode: both see each other walk; in classic mode the second account sits at a table with 🖥️ (DJ behind the mixer).
6. Chat from either view → bubble over the author; reactions float from the sender.
7. DJ HUD: ▶/⏸, ⏭, seek; listener HUD: volume only.
8. Mobile viewport (375 × 812): no empty bands, tap-to-move, chat bar collapses to 💬.
9. **👕 Tủ đồ** edit → the other account sees the new look (after `lk`).
