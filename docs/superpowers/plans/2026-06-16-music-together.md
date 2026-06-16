# Music Together Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a collaborative "listen together" web app where people join a password-protected room, contribute YouTube songs to a shared queue, and one DJ's device plays the audio while everyone's queue stays in sync in real time — styled as a vintage British "vinyl salon".

**Architecture:** Next.js 16 (App Router, client-rendered) on Vercel/Cloudflare serves a static SPA shell. Supabase (Postgres + Realtime + SECURITY DEFINER RPCs) is the only backend: it stores rooms/members/queue/history, broadcasts changes, and authorizes every write via a per-member secret token. Only the DJ's browser loads the YouTube IFrame player and produces sound; everyone else derives the progress bar locally from a single `started_at` timestamp (no audio streaming, no heartbeat). All writes go through RPCs; clients only read (RLS SELECT) and subscribe.

**Tech Stack:** Next.js 16.2.9, React 19.2, TypeScript 5, Tailwind CSS v4, `@supabase/supabase-js`, YouTube IFrame Player API + oEmbed (keyless), Vitest + Testing Library for tests.

---

## Conventions & prerequisites

- **AGENTS.md is binding:** this is a breaking-changes build of Next.js. The version-correct conventions are already baked into this plan (verified against `node_modules/next/dist/docs/`): `params` is a **Promise** (unwrap with `use()` in client components / `await` in server components); fonts via **`next/font/google`**; Tailwind v4 via **`@theme`** in `globals.css` (no `tailwind.config.js`); `'use client'` must be the **first line** before imports; browser-only code (window/localStorage/WebSocket/YT) lives in `useEffect`. Do **not** reintroduce older patterns.
- **Path alias:** `@/*` → `./*` (tsconfig). Import as `@/lib/...`, `@/hooks/...`, `@/components/...`.
- **No `/src` folder.** App Router is at `/app`; `.env*` at repo root.
- **TDD:** pure logic gets red→green→commit cycles. SQL RPCs are verified by an integration test against a local Supabase. Live realtime/YouTube behavior is verified manually (documented steps) because it cannot be unit-tested meaningfully.
- **Commits:** one per task (or per red/green pair). Keep them small.
- **Branch:** work happens on `feature/music-together` (already the current branch).

### Environment variables (repo root `.env.local`, create when you reach Task 10)
```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx   # new-style publishable key (legacy anon JWT also works)
```
For integration tests (Task 9), a **local** Supabase is preferred:
```
SUPABASE_TEST_URL=http://127.0.0.1:54321
SUPABASE_TEST_ANON_KEY=<local anon key from `supabase start`>
```

---

## File map (what each file is responsible for)

```
app/
  layout.tsx                     # MODIFY: register serif fonts (next/font), keep Server Component + metadata
  globals.css                    # MODIFY: Tailwind v4 @theme — Vintage Library palette + font tokens
  page.tsx                       # MODIFY: home — create room / join room forms
  room/[code]/page.tsx           # CREATE: server page, awaits params, renders RoomClient
  room/[code]/RoomClient.tsx     # CREATE: client root — join gate vs room shell, kicked detection
  api/oembed/route.ts            # CREATE: same-origin oEmbed proxy (keyless YouTube title/thumbnail)
lib/
  supabase.ts                    # CREATE: client singleton + row types + typed RPC wrappers
  realtime.ts                    # CREATE: subscribeRoom (postgres_changes→refetch) + trackPresence
  identity.ts                    # CREATE: localStorage identity + computeElapsedMs (progress)
  roles.ts                       # CREATE: deriveRole(room, memberId) pure helper
  queue.ts                       # CREATE: positionBetween() for drag reorder
  format.ts                      # CREATE: formatClock(ms) "m:ss"
  youtube/parse.ts               # CREATE: parseYouTubeId / parseYouTubeStart
  youtube/meta.ts                # CREATE: fetchVideoMeta (proxy→noembed→thumbnail) + youTubeThumbnail
hooks/
  useYouTubePlayer.ts            # CREATE: singleton IFrame API loader, audio-only hidden player
  useRoom.ts                     # CREATE: subscribe+presence+identity → RoomView state for a code
  useDjController.ts             # CREATE: DJ-only effect wiring player <-> playback RPCs
components/room/
  Header.tsx                     # CREATE: room name, share code, mode toggle (admin), settings (admin)
  Turntable.tsx                  # CREATE: spinning vinyl + tonearm
  NowPlaying.tsx                 # CREATE: current song, derived progress bar, DJ transport+volume
  AddSong.tsx                    # CREATE: paste-link input (+ optional search placeholder)
  Queue.tsx                      # CREATE: queue list, bump/delete/reorder (admin/dj), like placeholder
  MemberList.tsx                 # CREATE: members + online dots + role badges
  ChatPanel.tsx                  # CREATE: UI-only chat ("Sắp ra mắt")
  Reactions.tsx                  # CREATE: UI-only emoji reactions ("Sắp ra mắt")
  SettingsDialog.tsx             # CREATE: admin — assign DJ / transfer admin / kick / rename
  JoinGate.tsx                   # CREATE: name + password form to enter a room
supabase/migrations/
  0001_init.sql                  # CREATE: extensions, tables, indexes, RLS, SELECT policies
  0002_rpc.sql                   # CREATE: _auth_member helper + all write RPCs + grants
  0003_realtime.sql              # CREATE: add tables to supabase_realtime publication
tests/
  setup.ts                       # CREATE: Testing Library jest-dom matchers
  integration/rpc.test.ts        # CREATE: RPC/security tests vs local Supabase (skipped without env)
vitest.config.ts                 # CREATE: jsdom env, react plugin, @ alias, setup file
```

> **Security refinement vs naive design:** `token_hash` lives in its **own** table `member_secrets` (RLS on, zero policies, NOT in the realtime publication) — exactly like `room_secrets`. If it lived on `members`, the `members` SELECT policy + realtime payloads would leak every member's token hash. `members` therefore exposes only `id, room_id, name, joined_at`.

---

## Task 1: Test tooling setup

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `lib/format.ts` (a trivial function to prove the harness works)
- Test: `lib/format.test.ts`

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm i @supabase/supabase-js
npm i -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```
Expected: installs succeed, `package.json` updated.

- [ ] **Step 2: Add test scripts to `package.json`**

In the `"scripts"` block, add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    include: ["**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 4: Create `tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Write the failing test `lib/format.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { formatClock } from "@/lib/format";

describe("formatClock", () => {
  it("formats milliseconds as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(5_000)).toBe("0:05");
    expect(formatClock(74_000)).toBe("1:14");
    expect(formatClock(3_661_000)).toBe("61:01");
  });
  it("clamps negatives to 0:00", () => {
    expect(formatClock(-500)).toBe("0:00");
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test -- lib/format.test.ts`
Expected: FAIL — `formatClock` is not defined / module not found.

- [ ] **Step 7: Implement `lib/format.ts`**

```ts
/** Format a millisecond duration as "m:ss" (minutes uncapped). */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 8: Run it to confirm it passes**

Run: `npm test -- lib/format.test.ts`
Expected: PASS (both tests green).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.ts tests/setup.ts lib/format.ts lib/format.test.ts
git commit -m "chore: set up vitest + testing-library; add formatClock helper"
```

---

## Task 2: YouTube URL parsing (pure, TDD)

**Files:**
- Create: `lib/youtube/parse.ts`
- Test: `lib/youtube/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseYouTubeId, parseYouTubeStart } from "@/lib/youtube/parse";

describe("parseYouTubeId", () => {
  it("parses standard watch URLs", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be short links", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
  });
  it("parses music.youtube.com and extra params", () => {
    expect(parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc")).toBe("dQw4w9WgXcQ");
  });
  it("parses /shorts/ and /embed/", () => {
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("accepts a bare 11-char id", () => {
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("accepts scheme-less host", () => {
    expect(parseYouTubeId("youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("rejects non-YouTube and garbage", () => {
    expect(parseYouTubeId("https://vimeo.com/12345")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
  });
});

describe("parseYouTubeStart", () => {
  it("reads ?t= seconds and 1h2m3s", () => {
    expect(parseYouTubeStart("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe(90);
    expect(parseYouTubeStart("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")).toBe(90);
  });
  it("defaults to 0", () => {
    expect(parseYouTubeStart("https://youtu.be/dQw4w9WgXcQ")).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- lib/youtube/parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/youtube/parse.ts`**

```ts
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/** Extract the 11-char YouTube video id from any common URL form, or null. */
export function parseYouTubeId(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (YT_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && YT_ID_RE.test(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && YT_ID_RE.test(v)) return v;

  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.length >= 2 && ["shorts", "embed", "live", "v"].includes(segs[0])) {
    return YT_ID_RE.test(segs[1]) ? segs[1] : null;
  }
  return null;
}

/** Start time (seconds) from ?t=90 / ?t=1m30s / ?start=90. Defaults to 0. */
export function parseYouTubeStart(input: string): number {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const t = url.searchParams.get("t") ?? url.searchParams.get("start") ?? "";
    if (!t) return 0;
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i);
    if (!m) return 0;
    const [, h, mi, s] = m;
    return (+(h || 0)) * 3600 + (+(mi || 0)) * 60 + (+(s || 0));
  } catch {
    return 0;
  }
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- lib/youtube/parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/youtube/parse.ts lib/youtube/parse.test.ts
git commit -m "feat: YouTube URL id/start parsing"
```

---

## Task 3: Identity storage + progress derivation (pure, TDD)

**Files:**
- Create: `lib/identity.ts`
- Test: `lib/identity.test.ts`

> `Identity` is imported from `@/lib/supabase` in the real wrapper, but to avoid a dependency cycle and let this task stand alone, `identity.ts` defines its own `Identity`/`StoredIdentity` shapes. `lib/supabase.ts` (Task 10) will `import type { Identity } from "@/lib/identity"`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  saveIdentity, loadIdentity, clearIdentity, computeElapsedMs,
} from "@/lib/identity";

describe("identity storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips identity per room code", () => {
    saveIdentity({ code: "salon-abc", roomId: "r1", memberId: "m1", token: "t1" });
    expect(loadIdentity("salon-abc")).toEqual({ code: "salon-abc", roomId: "r1", memberId: "m1", token: "t1" });
    expect(loadIdentity("other")).toBeNull();
  });

  it("clears identity", () => {
    saveIdentity({ code: "salon-abc", roomId: "r1", memberId: "m1", token: "t1" });
    clearIdentity("salon-abc");
    expect(loadIdentity("salon-abc")).toBeNull();
  });
});

describe("computeElapsedMs", () => {
  afterEach(() => vi.useRealTimers());

  it("returns paused elapsed when not playing", () => {
    expect(computeElapsedMs({ is_playing: false, started_at: null, paused_elapsed_ms: 4200 })).toBe(4200);
  });

  it("derives elapsed from started_at when playing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T00:00:10.000Z"));
    const startedAt = "2026-06-16T00:00:00.000Z";
    expect(computeElapsedMs({ is_playing: true, started_at: startedAt, paused_elapsed_ms: 0 })).toBe(10_000);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- lib/identity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/identity.ts`**

```ts
export interface Identity {
  roomId: string;
  memberId: string;
  token: string;
}
export interface StoredIdentity extends Identity {
  code: string;
}

const KEY = (code: string) => `music-together:${code}`;

export function saveIdentity(v: StoredIdentity): void {
  localStorage.setItem(KEY(v.code), JSON.stringify(v));
}
export function loadIdentity(code: string): StoredIdentity | null {
  const raw = localStorage.getItem(KEY(code));
  return raw ? (JSON.parse(raw) as StoredIdentity) : null;
}
export function clearIdentity(code: string): void {
  localStorage.removeItem(KEY(code));
}

/** Progress in ms derived from room playback fields (no streaming/heartbeat). */
export function computeElapsedMs(p: {
  is_playing: boolean;
  started_at: string | null;
  paused_elapsed_ms: number;
}): number {
  if (!p.is_playing || !p.started_at) return p.paused_elapsed_ms;
  return Date.now() - new Date(p.started_at).getTime();
}
```

- [ ] **Step 4: Run to confirm pass**

Run: `npm test -- lib/identity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/identity.ts lib/identity.test.ts
git commit -m "feat: localStorage identity + timestamp-derived progress"
```

---

## Task 4: Role derivation + queue position math (pure, TDD)

**Files:**
- Create: `lib/roles.ts`
- Create: `lib/queue.ts`
- Test: `lib/roles.test.ts`
- Test: `lib/queue.test.ts`

- [ ] **Step 1: Write the failing tests**

`lib/roles.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { deriveRole } from "@/lib/roles";

const room = (admin: string | null, dj: string | null) =>
  ({ admin_member_id: admin, dj_member_id: dj }) as const;

describe("deriveRole", () => {
  it("flags admin and dj from room pointers", () => {
    expect(deriveRole(room("m1", "m2"), "m1")).toEqual({
      isAdmin: true, isDj: false, canManageQueue: true, canControlPlayback: false,
    });
    expect(deriveRole(room("m1", "m2"), "m2")).toEqual({
      isAdmin: false, isDj: true, canManageQueue: true, canControlPlayback: true,
    });
  });
  it("guest has no privileges", () => {
    expect(deriveRole(room("m1", "m2"), "m9")).toEqual({
      isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false,
    });
  });
  it("creator who is both admin and dj", () => {
    expect(deriveRole(room("m1", "m1"), "m1")).toEqual({
      isAdmin: true, isDj: true, canManageQueue: true, canControlPlayback: true,
    });
  });
  it("null member id is a guest", () => {
    expect(deriveRole(room("m1", "m2"), null).isAdmin).toBe(false);
  });
});
```

`lib/queue.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { positionBetween } from "@/lib/queue";

describe("positionBetween", () => {
  it("averages two neighbors", () => {
    expect(positionBetween(2, 4)).toBe(3);
  });
  it("drops below the first when no upper neighbor", () => {
    expect(positionBetween(null, 4)).toBe(3); // 4 - 1
  });
  it("rises above the last when no lower neighbor", () => {
    expect(positionBetween(2, null)).toBe(3); // 2 + 1
  });
  it("returns 0 for an empty list", () => {
    expect(positionBetween(null, null)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- lib/roles.test.ts lib/queue.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `lib/roles.ts`**

```ts
export interface RoleFlags {
  isAdmin: boolean;
  isDj: boolean;
  canManageQueue: boolean;   // delete / reorder / bump
  canControlPlayback: boolean; // play / pause / skip / seek / volume
}

export function deriveRole(
  room: { admin_member_id: string | null; dj_member_id: string | null },
  memberId: string | null,
): RoleFlags {
  const isAdmin = !!memberId && room.admin_member_id === memberId;
  const isDj = !!memberId && room.dj_member_id === memberId;
  return {
    isAdmin,
    isDj,
    canManageQueue: isAdmin || isDj,
    canControlPlayback: isDj,
  };
}
```

- [ ] **Step 4: Implement `lib/queue.ts`**

```ts
/**
 * Compute a fractional position to drop an item between two neighbors.
 * `before` = position of the item that should end up ABOVE the moved item.
 * `after`  = position of the item that should end up BELOW the moved item.
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before == null && after == null) return 0;
  if (before == null) return (after as number) - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}
```

- [ ] **Step 5: Run to confirm pass**

Run: `npm test -- lib/roles.test.ts lib/queue.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/roles.ts lib/roles.test.ts lib/queue.ts lib/queue.test.ts
git commit -m "feat: role derivation + queue position math"
```

---

## Task 5: Theme & fonts (Vintage Library)

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

> Visual styling can't be meaningfully unit-tested; verification is a successful build + a visual check. The fonts are **variable** fonts — do **not** pass a `weight` option (build error). Keep `layout.tsx` a Server Component (metadata stays valid).

- [ ] **Step 1: Replace `app/layout.tsx`**

```tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Cormorant_Garamond, EB_Garamond, Playfair_Display } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

// All three are VARIABLE fonts -> no `weight` option.
const cormorant = Cormorant_Garamond({ variable: "--font-cormorant", subsets: ["latin"], display: "swap" });
const ebGaramond = EB_Garamond({ variable: "--font-eb-garamond", subsets: ["latin"], display: "swap" });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Music Together — Phòng nghe nhạc",
  description: "Cùng nhau chọn và nghe nhạc YouTube trong một phòng nghe cổ điển.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="vi"
      className={`${geistSans.variable} ${geistMono.variable} ${cormorant.variable} ${ebGaramond.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Replace `app/globals.css`**

```css
@import "tailwindcss";

/* ===== Vintage Library theme (literal tokens -> reusable CSS vars + utilities) ===== */
@theme {
  --color-parchment: #ece3d0;
  --color-parchment-200: #e2d6bd;
  --color-parchment-300: #d8c9aa;
  --color-cream: #fff7e6;

  --color-ink: #3a2f23;

  --color-burgundy: #6e2233;
  --color-burgundy-accent: #9a3149;

  --color-gold: #b08d57;
  --color-gold-200: #cdb98a;

  --color-green-vintage: #1f6f4f;

  --font-cormorant: var(--font-cormorant);
  --font-eb-garamond: var(--font-eb-garamond);
  --font-playfair: var(--font-playfair);
  --font-serif: var(--font-eb-garamond), ui-serif, Georgia, serif;
}

:root {
  --background: var(--color-parchment);
  --foreground: var(--color-ink);
}

body {
  background:
    radial-gradient(1200px 500px at 50% -10%, #f3ead0, transparent),
    linear-gradient(160deg, #ece3d0, #e2d6bd 70%, #d8c9aa);
  color: var(--foreground);
  font-family: var(--font-eb-garamond), ui-serif, Georgia, serif;
}
```

- [ ] **Step 3: Verify the build compiles fonts + theme**

Run: `npm run build`
Expected: build succeeds (fonts fetched at build, no "weight" error, Tailwind compiles). If offline and `next/font/google` cannot fetch, that's an environment issue — note it and retry when online.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/globals.css
git commit -m "feat: Vintage Library theme + serif fonts (next/font, Tailwind v4 @theme)"
```

---

## Task 6: Supabase schema, RLS & policies (migration 0001)

**Files:**
- Create: `supabase/migrations/0001_init.sql`

> No automated test in this task; it is exercised by Task 9's integration tests. Apply it in Task 8/9 via `supabase db reset`.

- [ ] **Step 1: Create `supabase/migrations/0001_init.sql`**

```sql
-- =========================================================
-- 0001_init.sql — extensions, schema, indexes, RLS
-- =========================================================
create extension if not exists pgcrypto with schema extensions;

-- ---------- TABLES ----------
create table public.rooms (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique,
  name              text not null,
  play_mode         text not null default 'order' check (play_mode in ('order','shuffle')),
  admin_member_id   uuid,
  dj_member_id      uuid,
  current_item_id   uuid,
  is_playing        boolean not null default false,
  started_at        timestamptz,
  paused_elapsed_ms integer not null default 0,
  created_at        timestamptz not null default now()
);

create table public.room_secrets (
  room_id       uuid primary key references public.rooms(id) on delete cascade,
  password_hash text not null
);

create table public.members (
  id        uuid primary key default gen_random_uuid(),
  room_id   uuid not null references public.rooms(id) on delete cascade,
  name      text not null,
  joined_at timestamptz not null default now()
);

-- Token hashes are isolated like room_secrets: never selectable, never in realtime.
create table public.member_secrets (
  member_id  uuid primary key references public.members(id) on delete cascade,
  token_hash text not null
);

create table public.queue_items (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id   text not null,
  title              text not null,
  thumbnail_url      text,
  duration_seconds   integer,
  added_by_member_id uuid references public.members(id) on delete set null,
  added_by_name      text not null,
  position           double precision not null,
  created_at         timestamptz not null default now()
);

create table public.play_history (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references public.rooms(id) on delete cascade,
  youtube_video_id text not null,
  title            text not null,
  added_by_name    text,
  played_at        timestamptz not null default now()
);

-- Pointer FKs on rooms (now that members/queue_items exist).
alter table public.rooms
  add constraint rooms_admin_member_fk foreign key (admin_member_id) references public.members(id) on delete set null,
  add constraint rooms_dj_member_fk    foreign key (dj_member_id)    references public.members(id) on delete set null,
  add constraint rooms_current_item_fk foreign key (current_item_id) references public.queue_items(id) on delete set null;

-- ---------- INDEXES ----------
create index idx_queue_items_room_position on public.queue_items (room_id, position);
create index idx_members_room              on public.members (room_id);
create index idx_play_history_room_played  on public.play_history (room_id, played_at desc);

-- ---------- ROW LEVEL SECURITY ----------
alter table public.rooms          enable row level security;
alter table public.room_secrets   enable row level security;
alter table public.members        enable row level security;
alter table public.member_secrets enable row level security;
alter table public.queue_items    enable row level security;
alter table public.play_history   enable row level security;

-- Public, per-room, non-sensitive data: anon may SELECT (needed for Realtime).
create policy rooms_select        on public.rooms        for select to anon using (true);
create policy members_select      on public.members      for select to anon using (true);
create policy queue_items_select  on public.queue_items  for select to anon using (true);
create policy play_history_select on public.play_history for select to anon using (true);

-- room_secrets & member_secrets: RLS enabled, NO policies -> never readable by clients.
-- No INSERT/UPDATE/DELETE policies anywhere -> all direct writes denied; writes go via RPCs.
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): schema, indexes, RLS + select policies"
```

---

## Task 7: Supabase RPCs (migration 0002)

**Files:**
- Create: `supabase/migrations/0002_rpc.sql`

- [ ] **Step 1: Create `supabase/migrations/0002_rpc.sql`**

```sql
-- =========================================================
-- 0002_rpc.sql — SECURITY DEFINER write RPCs
-- =========================================================

-- ---------- PRIVATE AUTH HELPER ----------
-- Resolves + authorizes a member by (id, token) and required role.
-- p_required_role in: 'any' | 'admin' | 'dj' | 'admin_or_dj'. RAISES on failure.
create or replace function public._auth_member(
  p_room_id uuid, p_member_id uuid, p_token text, p_required_role text
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_exists boolean;
  v_hash   text;
  v_admin  uuid;
  v_dj     uuid;
begin
  select true into v_exists from public.members
  where id = p_member_id and room_id = p_room_id;
  if not found then
    raise exception 'member not found in room' using errcode = '42501';
  end if;

  select token_hash into v_hash from public.member_secrets where member_id = p_member_id;
  if v_hash is distinct from encode(digest(p_token, 'sha256'), 'hex') then
    raise exception 'invalid token' using errcode = '42501';
  end if;

  select admin_member_id, dj_member_id into v_admin, v_dj
  from public.rooms where id = p_room_id;

  if p_required_role = 'admin' and v_admin is distinct from p_member_id then
    raise exception 'admin role required' using errcode = '42501';
  elsif p_required_role = 'dj' and v_dj is distinct from p_member_id then
    raise exception 'dj role required' using errcode = '42501';
  elsif p_required_role = 'admin_or_dj'
        and v_admin is distinct from p_member_id
        and v_dj    is distinct from p_member_id then
    raise exception 'admin or dj role required' using errcode = '42501';
  end if;

  return p_member_id;
end;
$$;
revoke all on function public._auth_member(uuid,uuid,text,text) from public, anon, authenticated;

-- ---------- create_room ----------
create or replace function public.create_room(
  p_room_name text, p_password text, p_user_name text,
  out code text, out room_id uuid, out member_id uuid, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_code text;
begin
  loop
    v_code := 'salon-' || substr(encode(gen_random_bytes(6), 'hex'), 1, 6);
    exit when not exists (select 1 from public.rooms r where r.code = v_code);
  end loop;

  token   := encode(gen_random_bytes(32), 'hex');
  room_id := gen_random_uuid();
  code    := v_code;

  insert into public.rooms (id, code, name, play_mode) values (room_id, v_code, p_room_name, 'order');
  insert into public.room_secrets (room_id, password_hash) values (room_id, crypt(p_password, gen_salt('bf')));
  insert into public.members (room_id, name) values (room_id, p_user_name) returning id into member_id;
  insert into public.member_secrets (member_id, token_hash) values (member_id, encode(digest(token, 'sha256'), 'hex'));

  update public.rooms set admin_member_id = member_id, dj_member_id = member_id where id = room_id;
end;
$$;

-- ---------- join_room ----------
create or replace function public.join_room(
  p_code text, p_user_name text, p_password text,
  out room_id uuid, out member_id uuid, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text;
begin
  select r.id, s.password_hash into room_id, v_hash
  from public.rooms r join public.room_secrets s on s.room_id = r.id
  where r.code = p_code;

  if room_id is null then
    raise exception 'room not found' using errcode = 'P0002';
  end if;
  if crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid password' using errcode = '28P01';
  end if;

  token := encode(gen_random_bytes(32), 'hex');
  insert into public.members (room_id, name) values (room_id, p_user_name) returning id into member_id;
  insert into public.member_secrets (member_id, token_hash) values (member_id, encode(digest(token, 'sha256'), 'hex'));
end;
$$;

-- ---------- add_queue_item (any member) ----------
create or replace function public.add_queue_item(
  p_room_id uuid, p_member_id uuid, p_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pos double precision; v_name text; v_id uuid;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'any');
  select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id;
  select name into v_name from public.members where id = p_member_id;
  insert into public.queue_items
    (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_member_id, added_by_name, position)
  values (p_room_id, p_video_id, p_title, p_thumb, p_duration, p_member_id, v_name, v_pos)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- advance_queue (DJ only) ----------
create or replace function public.advance_queue(
  p_room_id uuid, p_member_id uuid, p_token text
) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_cur public.queue_items%rowtype; v_mode text; v_next uuid;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'dj');
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
    current_item_id   = v_next,
    started_at        = case when v_next is not null then now() else null end,
    is_playing        = v_next is not null,
    paused_elapsed_ms = 0
  where id = p_room_id;
  return v_next;
end;
$$;

-- ---------- set_playback (DJ only) ----------
create or replace function public.set_playback(
  p_room_id uuid, p_member_id uuid, p_token text,
  p_is_playing boolean, p_started_at timestamptz, p_paused_elapsed_ms integer
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'dj');
  update public.rooms set
    is_playing = p_is_playing, started_at = p_started_at,
    paused_elapsed_ms = coalesce(p_paused_elapsed_ms, 0)
  where id = p_room_id;
end;
$$;

-- ---------- seek_playback (DJ only) ----------
create or replace function public.seek_playback(
  p_room_id uuid, p_member_id uuid, p_token text, p_position_ms integer
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_playing boolean;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'dj');
  select is_playing into v_playing from public.rooms where id = p_room_id;
  update public.rooms set
    started_at = case when v_playing then now() - make_interval(secs => p_position_ms / 1000.0) else null end,
    paused_elapsed_ms = p_position_ms
  where id = p_room_id;
end;
$$;

-- ---------- reorder_item / bump_to_top / delete_item (admin or dj) ----------
create or replace function public.reorder_item(
  p_room_id uuid, p_member_id uuid, p_token text, p_item_id uuid, p_new_position double precision
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin_or_dj');
  update public.queue_items set position = p_new_position where id = p_item_id and room_id = p_room_id;
end;
$$;

create or replace function public.bump_to_top(
  p_room_id uuid, p_member_id uuid, p_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_min double precision;
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin_or_dj');
  select coalesce(min(position), 0) into v_min from public.queue_items where room_id = p_room_id;
  update public.queue_items set position = v_min - 1 where id = p_item_id and room_id = p_room_id;
end;
$$;

create or replace function public.delete_item(
  p_room_id uuid, p_member_id uuid, p_token text, p_item_id uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin_or_dj');
  if exists (select 1 from public.rooms where id = p_room_id and current_item_id = p_item_id) then
    raise exception 'cannot delete the currently playing item' using errcode = '42501';
  end if;
  delete from public.queue_items where id = p_item_id and room_id = p_room_id;
end;
$$;

-- ---------- admin RPCs ----------
create or replace function public.set_play_mode(
  p_room_id uuid, p_member_id uuid, p_token text, p_play_mode text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if p_play_mode not in ('order','shuffle') then
    raise exception 'invalid play_mode' using errcode = '22023';
  end if;
  update public.rooms set play_mode = p_play_mode where id = p_room_id;
end;
$$;

create or replace function public.assign_dj(
  p_room_id uuid, p_member_id uuid, p_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if p_target_member is not null and not exists (
       select 1 from public.members where id = p_target_member and room_id = p_room_id) then
    raise exception 'target member not in room' using errcode = '42501';
  end if;
  update public.rooms set dj_member_id = p_target_member where id = p_room_id;
end;
$$;

create or replace function public.transfer_admin(
  p_room_id uuid, p_member_id uuid, p_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if not exists (select 1 from public.members where id = p_target_member and room_id = p_room_id) then
    raise exception 'target member not in room' using errcode = '42501';
  end if;
  update public.rooms set admin_member_id = p_target_member where id = p_room_id;
end;
$$;

create or replace function public.kick_member(
  p_room_id uuid, p_member_id uuid, p_token text, p_target_member uuid
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  if p_target_member = p_member_id then
    raise exception 'admin cannot kick themselves' using errcode = '42501';
  end if;
  update public.rooms set
    dj_member_id    = case when dj_member_id    = p_target_member then null else dj_member_id    end,
    admin_member_id = case when admin_member_id = p_target_member then null else admin_member_id end
  where id = p_room_id;
  delete from public.members where id = p_target_member and room_id = p_room_id;
end;
$$;

create or replace function public.rename_room(
  p_room_id uuid, p_member_id uuid, p_token text, p_new_name text
) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_member(p_room_id, p_member_id, p_token, 'admin');
  update public.rooms set name = p_new_name where id = p_room_id;
end;
$$;

-- ---------- GRANTS (public-facing RPCs only; _auth_member intentionally omitted) ----------
grant execute on function public.create_room(text,text,text)                          to anon, authenticated;
grant execute on function public.join_room(text,text,text)                            to anon, authenticated;
grant execute on function public.add_queue_item(uuid,uuid,text,text,text,text,integer) to anon, authenticated;
grant execute on function public.advance_queue(uuid,uuid,text)                        to anon, authenticated;
grant execute on function public.set_playback(uuid,uuid,text,boolean,timestamptz,integer) to anon, authenticated;
grant execute on function public.seek_playback(uuid,uuid,text,integer)                to anon, authenticated;
grant execute on function public.reorder_item(uuid,uuid,text,uuid,double precision)   to anon, authenticated;
grant execute on function public.bump_to_top(uuid,uuid,text,uuid)                     to anon, authenticated;
grant execute on function public.delete_item(uuid,uuid,text,uuid)                     to anon, authenticated;
grant execute on function public.set_play_mode(uuid,uuid,text,text)                   to anon, authenticated;
grant execute on function public.assign_dj(uuid,uuid,text,uuid)                       to anon, authenticated;
grant execute on function public.transfer_admin(uuid,uuid,text,uuid)                  to anon, authenticated;
grant execute on function public.kick_member(uuid,uuid,text,uuid)                     to anon, authenticated;
grant execute on function public.rename_room(uuid,uuid,text,text)                     to anon, authenticated;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0002_rpc.sql
git commit -m "feat(db): SECURITY DEFINER RPCs with token+role auth"
```

---

## Task 8: Realtime publication (migration 0003)

**Files:**
- Create: `supabase/migrations/0003_realtime.sql`

> Without this, `postgres_changes` never fires and the queue won't sync. Never add the `*_secrets` tables.

- [ ] **Step 1: Create `supabase/migrations/0003_realtime.sql`**

```sql
-- Enable Realtime change feeds for the public, per-room tables only.
alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.queue_items;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0003_realtime.sql
git commit -m "feat(db): add room tables to realtime publication"
```

---

## Task 9: RPC + security integration tests (against local Supabase)

**Files:**
- Create: `tests/integration/rpc.test.ts`

> **Setup (one-time):** install the Supabase CLI (`npm i -D supabase` or use the standalone binary), then from repo root: `npx supabase init` (accept defaults), `npx supabase start` (needs Docker). Copy the printed **API URL** and **anon key** into `.env.local` as `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY`. Apply migrations with `npx supabase db reset` (runs `supabase/migrations/*.sql` in order). Re-run `db reset` whenever you change a migration.
> If you cannot run Docker, point `SUPABASE_TEST_*` at a throwaway **hosted** Supabase project where you ran the three migrations in the SQL editor. The tests are `skip`ped automatically if the env vars are absent, so the unit suite still runs everywhere.

- [ ] **Step 1: Write the test file (it doubles as the SQL spec)**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("RPC security & behavior", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  const create = async (room = "Salon", pass = "secret", user = "Admin") => {
    const { data, error } = await db.rpc("create_room", {
      p_room_name: room, p_password: pass, p_user_name: user,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as
      { code: string; room_id: string; member_id: string; token: string };
  };
  const join = async (code: string, user: string, pass: string) => {
    const { data, error } = await db.rpc("join_room", {
      p_code: code, p_user_name: user, p_password: pass,
    });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as
      { room_id: string; member_id: string; token: string };
  };

  it("create_room makes creator admin+dj and returns a token", async () => {
    const r = await create();
    expect(r.code).toMatch(/^salon-/);
    expect(r.token).toHaveLength(64); // 32 bytes hex
    const { data: room } = await db.from("rooms").select("*").eq("id", r.room_id).single();
    expect(room!.admin_member_id).toBe(r.member_id);
    expect(room!.dj_member_id).toBe(r.member_id);
  });

  it("join_room rejects a wrong password", async () => {
    const r = await create("R", "right-pass", "A");
    await expect(join(r.code, "Bob", "wrong-pass")).rejects.toMatchObject({
      message: expect.stringContaining("invalid password"),
    });
  });

  it("member_secrets is not readable by clients", async () => {
    const { data, error } = await db.from("member_secrets").select("*");
    // RLS with no policy -> no rows (and no error) for anon.
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("add_queue_item requires a valid token", async () => {
    const a = await create();
    const guest = await join(a.code, "Guest", "secret");
    // good token works
    const ok = await db.rpc("add_queue_item", {
      p_room_id: a.room_id, p_member_id: guest.member_id, p_token: guest.token,
      p_video_id: "dQw4w9WgXcQ", p_title: "Song A", p_thumb: null, p_duration: 200,
    });
    expect(ok.error).toBeNull();
    // bad token rejected
    const bad = await db.rpc("add_queue_item", {
      p_room_id: a.room_id, p_member_id: guest.member_id, p_token: "deadbeef",
      p_video_id: "x", p_title: "Nope", p_thumb: null, p_duration: null,
    });
    expect(bad.error?.message).toContain("invalid token");
  });

  it("guests cannot advance the queue; DJ can", async () => {
    const a = await create();
    const guest = await join(a.code, "Guest", "secret");
    for (const t of ["S1", "S2"]) {
      await db.rpc("add_queue_item", {
        p_room_id: a.room_id, p_member_id: guest.member_id, p_token: guest.token,
        p_video_id: t, p_title: t, p_thumb: null, p_duration: 10,
      });
    }
    const denied = await db.rpc("advance_queue", {
      p_room_id: a.room_id, p_member_id: guest.member_id, p_token: guest.token,
    });
    expect(denied.error?.message).toContain("dj role required");

    const adv = await db.rpc("advance_queue", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token,
    });
    expect(adv.error).toBeNull();
    const { data: room } = await db.from("rooms").select("*").eq("id", a.room_id).single();
    expect(room!.current_item_id).not.toBeNull();
    expect(room!.is_playing).toBe(true);
  });

  it("delete_item refuses the currently playing item", async () => {
    const a = await create();
    await db.rpc("add_queue_item", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token,
      p_video_id: "C", p_title: "C", p_thumb: null, p_duration: 10,
    });
    await db.rpc("advance_queue", { p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token });
    const { data: room } = await db.from("rooms").select("current_item_id").eq("id", a.room_id).single();
    const del = await db.rpc("delete_item", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token, p_item_id: room!.current_item_id,
    });
    expect(del.error?.message).toContain("currently playing");
  });

  it("transfer_admin demotes the old admin", async () => {
    const a = await create();
    const bob = await join(a.code, "Bob", "secret");
    await db.rpc("transfer_admin", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token, p_target_member: bob.member_id,
    });
    // old admin can no longer rename
    const denied = await db.rpc("rename_room", {
      p_room_id: a.room_id, p_member_id: a.member_id, p_token: a.token, p_new_name: "X",
    });
    expect(denied.error?.message).toContain("admin role required");
  });
});
```

- [ ] **Step 2: Run with local Supabase up**

Run: `npm test -- tests/integration/rpc.test.ts`
Expected: with `SUPABASE_TEST_*` set and migrations applied → all PASS. Without env → the suite is **skipped** (reported as skipped, not failed).

- [ ] **Step 3: Commit**

```bash
git add tests/integration/rpc.test.ts
git commit -m "test(db): RPC security + behavior integration tests"
```

---

## Task 10: Supabase client + typed RPC wrappers

**Files:**
- Create: `lib/supabase.ts`
- Create: `.env.local` (not committed; `.gitignore` already excludes `.env*`)

- [ ] **Step 1: Create `.env.local`** with your project's URL + publishable key (see "Environment variables" above). Do not commit it. Never put the `service_role`/`sb_secret_*` key in client code or env vars prefixed `NEXT_PUBLIC_`.

- [ ] **Step 2: Create `lib/supabase.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Identity } from "@/lib/identity";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

/** Single shared client => one Realtime socket for the whole app.
 *  Uses @supabase/supabase-js (NOT @supabase/ssr): anon access + Realtime, no auth cookies. */
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
export interface Member { id: string; room_id: string; name: string; joined_at: string; }
export interface QueueItem {
  id: string; room_id: string; youtube_video_id: string; title: string;
  thumbnail_url: string | null; duration_seconds: number | null;
  added_by_member_id: string | null; added_by_name: string;
  position: number; created_at: string;
}

export async function createRoom(roomName: string, password: string, userName: string) {
  const { data, error } = await supabase.rpc("create_room", {
    p_room_name: roomName, p_password: password, p_user_name: userName,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as
    { code: string; room_id: string; member_id: string; token: string };
}

export async function joinRoom(code: string, userName: string, password: string) {
  const { data, error } = await supabase.rpc("join_room", {
    p_code: code, p_user_name: userName, p_password: password,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as
    { room_id: string; member_id: string; token: string };
}

export async function addQueueItem(
  id: Identity,
  v: { videoId: string; title: string; thumb: string | null; duration: number | null },
) {
  const { error } = await supabase.rpc("add_queue_item", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
    p_video_id: v.videoId, p_title: v.title, p_thumb: v.thumb, p_duration: v.duration,
  });
  if (error) throw error;
}

export async function advanceQueue(id: Identity) {
  const { error } = await supabase.rpc("advance_queue", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
  });
  if (error) throw error;
}

export async function setPlayback(
  id: Identity, p: { isPlaying: boolean; startedAt: string | null; pausedElapsedMs: number },
) {
  const { error } = await supabase.rpc("set_playback", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
    p_is_playing: p.isPlaying, p_started_at: p.startedAt, p_paused_elapsed_ms: p.pausedElapsedMs,
  });
  if (error) throw error;
}

export async function seekPlayback(id: Identity, positionMs: number) {
  const { error } = await supabase.rpc("seek_playback", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_position_ms: positionMs,
  });
  if (error) throw error;
}

export async function bumpToTop(id: Identity, itemId: string) {
  const { error } = await supabase.rpc("bump_to_top", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_item_id: itemId,
  });
  if (error) throw error;
}

export async function reorderItem(id: Identity, itemId: string, newPosition: number) {
  const { error } = await supabase.rpc("reorder_item", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token,
    p_item_id: itemId, p_new_position: newPosition,
  });
  if (error) throw error;
}

export async function deleteItem(id: Identity, itemId: string) {
  const { error } = await supabase.rpc("delete_item", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_item_id: itemId,
  });
  if (error) throw error;
}

export async function setPlayMode(id: Identity, mode: PlayMode) {
  const { error } = await supabase.rpc("set_play_mode", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_play_mode: mode,
  });
  if (error) throw error;
}

export async function assignDj(id: Identity, targetMemberId: string | null) {
  const { error } = await supabase.rpc("assign_dj", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_target_member: targetMemberId,
  });
  if (error) throw error;
}

export async function transferAdmin(id: Identity, targetMemberId: string) {
  const { error } = await supabase.rpc("transfer_admin", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_target_member: targetMemberId,
  });
  if (error) throw error;
}

export async function kickMember(id: Identity, targetMemberId: string) {
  const { error } = await supabase.rpc("kick_member", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_target_member: targetMemberId,
  });
  if (error) throw error;
}

export async function renameRoom(id: Identity, newName: string) {
  const { error } = await supabase.rpc("rename_room", {
    p_room_id: id.roomId, p_member_id: id.memberId, p_token: id.token, p_new_name: newName,
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no type errors in `lib/supabase.ts` (other not-yet-created files may still be absent; this file should be clean).

- [ ] **Step 4: Commit**

```bash
git add lib/supabase.ts
git commit -m "feat: supabase client + typed RPC wrappers"
```

---

## Task 11: Realtime subscription + presence

**Files:**
- Create: `lib/realtime.ts`

- [ ] **Step 1: Create `lib/realtime.ts`**

```ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, type Room, type Member, type QueueItem } from "@/lib/supabase";

export interface RoomState { room: Room | null; members: Member[]; queue: QueueItem[]; }

async function fetchRoomState(roomId: string): Promise<RoomState> {
  const [roomRes, membersRes, queueRes] = await Promise.all([
    supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
    supabase.from("members").select("*").eq("room_id", roomId).order("joined_at"),
    supabase.from("queue_items").select("*").eq("room_id", roomId).order("position"),
  ]);
  return {
    room: (roomRes.data as Room) ?? null,
    members: (membersRes.data as Member[]) ?? [],
    queue: (queueRes.data as QueueItem[]) ?? [],
  };
}

/** Subscribe to room-scoped changes; re-fetch + push fresh state on any change. */
export function subscribeRoom(roomId: string, onState: (s: RoomState) => void): () => void {
  let cancelled = false;
  const refresh = async () => {
    const state = await fetchRoomState(roomId);
    if (!cancelled) onState(state);
  };
  const channel: RealtimeChannel = supabase
    .channel(`room:${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `room_id=eq.${roomId}` }, refresh)
    .subscribe((status) => { if (status === "SUBSCRIBED") void refresh(); });
  return () => { cancelled = true; void supabase.removeChannel(channel); };
}

/** Realtime Presence: online member ids, keyed by member id. */
export function trackPresence(
  roomId: string, me: { memberId: string; name: string }, onOnline: (ids: string[]) => void,
): () => void {
  const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { key: me.memberId } } });
  const emit = () => onOnline(Object.keys(channel.presenceState()));
  channel
    .on("presence", { event: "sync" }, emit)
    .on("presence", { event: "join" }, emit)
    .on("presence", { event: "leave" }, emit)
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({ name: me.name, online_at: new Date().toISOString() });
      }
    });
  return () => { void supabase.removeChannel(channel); };
}
```

- [ ] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit` (expect this file clean)
```bash
git add lib/realtime.ts
git commit -m "feat: realtime room subscription + presence"
```

---

## Task 12: oEmbed proxy route + video metadata fetch

**Files:**
- Create: `app/api/oembed/route.ts`
- Create: `lib/youtube/meta.ts`

> YouTube's oEmbed has no CORS header → never fetch it directly from the browser. Use the same-origin proxy first, `noembed.com` as fallback, thumbnail CDN as last resort.

- [ ] **Step 1: Create `app/api/oembed/route.ts`**

```ts
import { parseYouTubeId } from "@/lib/youtube/parse";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = parseYouTubeId(searchParams.get("id") ?? searchParams.get("url") ?? "");
  if (!id) return Response.json({ error: "Invalid YouTube id/url" }, { status: 400 });

  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${id}`,
  )}&format=json`;

  try {
    const res = await fetch(oembed, { headers: { Accept: "application/json" }, next: { revalidate: 86400 } });
    if (!res.ok) return Response.json({ error: "oEmbed lookup failed" }, { status: 502 });
    const data = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return Response.json({
      id,
      title: data.title ?? "",
      author: data.author_name ?? "",
      thumbnail: data.thumbnail_url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    });
  } catch {
    return Response.json({ error: "oEmbed request error" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Create `lib/youtube/meta.ts`**

```ts
import { parseYouTubeId } from "@/lib/youtube/parse";

export interface VideoMeta { id: string; title: string; author: string; thumbnail: string; }

export function youTubeThumbnail(id: string): string {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

/** Keyless title + thumbnail. Order: same-origin proxy -> noembed -> thumbnail-only. */
export async function fetchVideoMeta(videoIdOrUrl: string, signal?: AbortSignal): Promise<VideoMeta | null> {
  const id = parseYouTubeId(videoIdOrUrl);
  if (!id) return null;

  try {
    const res = await fetch(`/api/oembed?id=${id}`, { signal });
    if (res.ok) {
      const d = (await res.json()) as Partial<VideoMeta>;
      if (d.title) return { id, title: d.title, author: d.author ?? "", thumbnail: d.thumbnail ?? youTubeThumbnail(id) };
    }
  } catch { /* fall through */ }

  try {
    const url = `https://noembed.com/embed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
    const res = await fetch(url, { signal });
    if (res.ok) {
      const d = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string; error?: string };
      if (d.title && !d.error) return { id, title: d.title, author: d.author_name ?? "", thumbnail: d.thumbnail_url ?? youTubeThumbnail(id) };
    }
  } catch { /* fall through */ }

  return { id, title: "", author: "", thumbnail: youTubeThumbnail(id) };
}
```

- [ ] **Step 3: Typecheck & commit**

Run: `npx tsc --noEmit`
```bash
git add app/api/oembed/route.ts lib/youtube/meta.ts
git commit -m "feat: keyless YouTube metadata via same-origin oEmbed proxy"
```

---

## Task 13: YouTube IFrame player hook (audio-only)

**Files:**
- Create: `hooks/useYouTubePlayer.ts`

- [ ] **Step 1: Create `hooks/useYouTubePlayer.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    YT?: typeof YT;
    onYouTubeIframeAPIReady?: () => void;
  }
}

// eslint-disable-next-line @typescript-eslint/no-namespace -- ambient types for the global YT IFrame API (no @types/youtube dependency)
declare namespace YT {
  export enum PlayerState { UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5 }
  export interface PlayerEvent { target: Player; }
  export interface OnStateChangeEvent extends PlayerEvent { data: PlayerState; }
  export interface PlayerOptions {
    height?: string | number; width?: string | number; videoId?: string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (e: PlayerEvent) => void;
      onStateChange?: (e: OnStateChangeEvent) => void;
      onError?: (e: { data: number }) => void;
    };
  }
  export class Player {
    constructor(el: HTMLElement | string, opts: PlayerOptions);
    loadVideoById(id: string, startSeconds?: number): void;
    cueVideoById(id: string, startSeconds?: number): void;
    playVideo(): void;
    pauseVideo(): void;
    seekTo(seconds: number, allowSeekAhead?: boolean): void;
    setVolume(volume: number): void;
    getVolume(): number;
    getDuration(): number;
    getCurrentTime(): number;
    getPlayerState(): PlayerState;
    destroy(): void;
  }
}

let apiPromise: Promise<typeof YT> | null = null;

function loadYouTubeApi(): Promise<typeof YT> {
  if (typeof window === "undefined") return Promise.reject(new Error("YT API requires a browser"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<typeof YT>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT as typeof YT); };
    if (!document.querySelector("script[data-yt-iframe-api]")) {
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.dataset.ytIframeApi = "true";
      document.head.appendChild(s);
    }
  });
  return apiPromise;
}

export interface UseYouTubePlayer {
  ready: boolean;
  load: (videoId: string, startSeconds?: number) => void;
  play: () => void;
  pause: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  getDuration: () => number;
  getCurrentTime: () => number;
  onError?: (handler: (code: number) => void) => void;
}

export function useYouTubePlayer(onEnded?: () => void, onError?: (code: number) => void): UseYouTubePlayer {
  const playerRef = useRef<YT.Player | null>(null);
  const [ready, setReady] = useState(false);
  const queueRef = useRef<Array<(p: YT.Player) => void>>([]);
  const onEndedRef = useRef(onEnded);
  const onErrorRef = useRef(onError);
  // Keep the latest callbacks without re-creating the player (synced after render).
  useEffect(() => {
    onEndedRef.current = onEnded;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    let cancelled = false;
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;width:1px;height:1px;left:-9999px;top:0;opacity:0;pointer-events:none;";
    document.body.appendChild(host);

    loadYouTubeApi().then((YTApi) => {
      if (cancelled) return;
      playerRef.current = new YTApi.Player(host, {
        width: 1, height: 1,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            if (cancelled) { e.target.destroy(); return; }
            setReady(true);
            const q = queueRef.current; queueRef.current = [];
            q.forEach((fn) => fn(e.target));
          },
          onStateChange: (e) => { if (e.data === YTApi.PlayerState.ENDED) onEndedRef.current?.(); },
          onError: (e) => onErrorRef.current?.(e.data),
        },
      });
    }).catch(() => { /* API failed: player stays null */ });

    return () => {
      cancelled = true;
      try { playerRef.current?.destroy(); } catch { /* ignore */ }
      playerRef.current = null;
      host.remove();
    };
  }, []);

  const run = useCallback((fn: (p: YT.Player) => void) => {
    const p = playerRef.current;
    if (p && ready) fn(p); else queueRef.current.push(fn);
  }, [ready]);

  const load = useCallback((videoId: string, startSeconds = 0) => run((p) => p.loadVideoById(videoId, startSeconds)), [run]);
  const play = useCallback(() => run((p) => p.playVideo()), [run]);
  const pause = useCallback(() => run((p) => p.pauseVideo()), [run]);
  const seekTo = useCallback((sec: number) => run((p) => p.seekTo(sec, true)), [run]);
  const setVolume = useCallback((v: number) => run((p) => p.setVolume(Math.max(0, Math.min(100, v)))), [run]);
  const getDuration = useCallback(() => (playerRef.current && ready ? playerRef.current.getDuration() : 0), [ready]);
  const getCurrentTime = useCallback(() => (playerRef.current && ready ? playerRef.current.getCurrentTime() : 0), [ready]);

  return { ready, load, play, pause, seekTo, setVolume, getDuration, getCurrentTime };
}
```

- [ ] **Step 2: Typecheck & commit**

Run: `npx tsc --noEmit`
```bash
git add hooks/useYouTubePlayer.ts
git commit -m "feat: audio-only YouTube IFrame player hook"
```

---

## Task 14: Home page — create / join room

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Replace `app/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoom } from "@/lib/supabase";
import { saveIdentity } from "@/lib/identity";

type Mode = "create" | "join";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (mode === "create") {
        const r = await createRoom(roomName.trim() || "Phòng nghe nhạc", password, name.trim());
        saveIdentity({ code: r.code, roomId: r.room_id, memberId: r.member_id, token: r.token });
        router.push(`/room/${r.code}`);
      } else {
        const c = code.trim();
        const r = await joinRoom(c, name.trim(), password);
        saveIdentity({ code: c, roomId: r.room_id, memberId: r.member_id, token: r.token });
        router.push(`/room/${c}`);
      }
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("invalid password") ? "Sai mật khẩu phòng." :
               msg.includes("room not found") ? "Không tìm thấy phòng." : msg);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <header className="text-center">
        <div className="text-5xl">🎩🎶</div>
        <h1 className="font-playfair text-3xl font-bold text-burgundy">Music Together</h1>
        <p className="font-cormorant text-lg text-ink/80">Phòng nghe nhạc cổ điển</p>
      </header>

      <div className="flex rounded-full border border-gold text-sm">
        <button type="button" onClick={() => setMode("create")}
          className={`flex-1 rounded-full px-4 py-2 ${mode === "create" ? "bg-burgundy text-cream" : "text-burgundy"}`}>
          Tạo phòng
        </button>
        <button type="button" onClick={() => setMode("join")}
          className={`flex-1 rounded-full px-4 py-2 ${mode === "join" ? "bg-burgundy text-cream" : "text-burgundy"}`}>
          Vào phòng
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên của bạn"
          className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {mode === "create" ? (
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Tên phòng (tùy chọn)"
            className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        ) : (
          <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="Mã phòng (vd salon-xxxxxx)"
            className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        )}
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Mật khẩu phòng"
          className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p className="text-sm text-burgundy-accent">{error}</p>}
        <button disabled={busy} type="submit"
          className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">
          {busy ? "Đang xử lý…" : mode === "create" ? "Tạo phòng" : "Vào phòng"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`, open `http://localhost:3000`. With valid Supabase env, create a room → you should be routed to `/room/salon-xxxxxx` (the room page is built in Task 15; until then a 404/empty page is expected). Confirm a wrong-password join shows "Sai mật khẩu phòng."

- [ ] **Step 3: Commit**

```bash
git add app/page.tsx
git commit -m "feat: home page create/join room"
```

---

## Task 15: Room page + client root (join gate, kicked detection)

**Files:**
- Create: `app/room/[code]/page.tsx`
- Create: `app/room/[code]/RoomClient.tsx`
- Create: `components/room/JoinGate.tsx`
- Create: `hooks/useRoom.ts`

> `params` is a **Promise**: the server page `await`s it and passes the plain `code` string to the client root.

- [ ] **Step 1: Create `app/room/[code]/page.tsx`**

```tsx
import RoomClient from "./RoomClient";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <RoomClient code={code} />;
}
```

- [ ] **Step 2: Create `hooks/useRoom.ts`**

```ts
"use client";

import { useEffect, useState } from "react";
import { subscribeRoom, trackPresence, type RoomState } from "@/lib/realtime";
import { supabase } from "@/lib/supabase";
import { deriveRole, type RoleFlags } from "@/lib/roles";
import { loadIdentity, type StoredIdentity } from "@/lib/identity";

export interface RoomView {
  loading: boolean;
  state: RoomState;
  onlineIds: string[];
  identity: StoredIdentity | null;
  role: RoleFlags;
  /** true once we know the room exists and we have a stored identity whose member is gone (kicked). */
  kicked: boolean;
}

const EMPTY: RoomState = { room: null, members: [], queue: [] };

export function useRoom(code: string, joinNonce = 0): RoomView {
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [state, setState] = useState<RoomState>(EMPTY);
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Resolve identity from localStorage on mount and whenever joinNonce bumps
  // (so a fresh join in JoinGate advances the UI past the gate). Client only.
  useEffect(() => { setIdentity(loadIdentity(code)); }, [code, joinNonce]);

  // Look up the room id by code (needed for subscriptions) then subscribe.
  useEffect(() => {
    let unsubRoom: (() => void) | undefined;
    let unsubPresence: (() => void) | undefined;
    let active = true;

    (async () => {
      const { data } = await supabase.from("rooms").select("id").eq("code", code).maybeSingle();
      if (!active) return;
      if (!data) { setLoading(false); return; }
      const roomId = data.id as string;
      unsubRoom = subscribeRoom(roomId, (s) => { setState(s); setLoading(false); });
      const id = loadIdentity(code);
      if (id) unsubPresence = trackPresence(roomId, { memberId: id.memberId, name: "" }, setOnlineIds);
    })();

    return () => { active = false; unsubRoom?.(); unsubPresence?.(); };
  }, [code, identity?.memberId]);

  const role = state.room
    ? deriveRole(state.room, identity?.memberId ?? null)
    : { isAdmin: false, isDj: false, canManageQueue: false, canControlPlayback: false };

  const kicked =
    !!identity && !!state.room && state.members.length > 0 &&
    !state.members.some((m) => m.id === identity.memberId);

  return { loading, state, onlineIds, identity, role, kicked };
}
```

- [ ] **Step 3: Create `components/room/JoinGate.tsx`**

```tsx
"use client";

import { useState } from "react";
import { joinRoom } from "@/lib/supabase";
import { saveIdentity } from "@/lib/identity";

export default function JoinGate({ code, onJoined }: { code: string; onJoined: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await joinRoom(code, name.trim(), password);
      saveIdentity({ code, roomId: r.room_id, memberId: r.member_id, token: r.token });
      onJoined();
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("invalid password") ? "Sai mật khẩu phòng." :
               msg.includes("room not found") ? "Không tìm thấy phòng." : msg);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-center font-playfair text-2xl font-bold text-burgundy">Vào phòng {code}</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên của bạn"
          className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Mật khẩu phòng" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p className="text-sm text-burgundy-accent">{error}</p>}
        <button disabled={busy} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">
          {busy ? "Đang vào…" : "Vào phòng"}
        </button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Create `app/room/[code]/RoomClient.tsx`** (shell wired to placeholders; child components arrive in Tasks 16–18)

```tsx
"use client";

import { useState } from "react";
import { useRoom } from "@/hooks/useRoom";
import { clearIdentity } from "@/lib/identity";
import JoinGate from "@/components/room/JoinGate";
import RoomShell from "@/components/room/RoomShell";

export default function RoomClient({ code }: { code: string }) {
  const [joinNonce, setJoinNonce] = useState(0);
  const view = useRoom(code, joinNonce);

  if (view.loading) {
    return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải phòng…</main>;
  }
  if (!view.state.room) {
    return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Không tìm thấy phòng “{code}”.</main>;
  }
  if (view.kicked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-playfair text-2xl text-burgundy">Bạn đã bị mời khỏi phòng.</p>
        <a href="/" onClick={() => clearIdentity(code)} className="text-burgundy-accent underline">Về trang chủ</a>
      </main>
    );
  }
  if (!view.identity) {
    return <JoinGate code={code} onJoined={() => setJoinNonce((n) => n + 1)} key={joinNonce} />;
  }
  return <RoomShell code={code} view={view} />;
}
```

> `RoomShell` is created in Task 17. To keep the build green between tasks, create a temporary stub now and replace it in Task 17:

Create `components/room/RoomShell.tsx` (temporary stub):
```tsx
"use client";
import type { RoomView } from "@/hooks/useRoom";
export default function RoomShell({ code }: { code: string; view: RoomView }) {
  return <main className="p-6 font-cormorant text-burgundy">Phòng {code} — giao diện đang được lắp ráp…</main>;
}
```

- [ ] **Step 5: Manual verification**

Run `npm run dev`. From the home page create a room → lands on the room shell stub. Open the same `/room/<code>` URL in an incognito window (no identity) → JoinGate appears; join with the correct password → shell stub. Wrong password → error.

- [ ] **Step 6: Commit**

```bash
git add app/room lib hooks/useRoom.ts components/room/JoinGate.tsx components/room/RoomShell.tsx
git commit -m "feat: room page, identity-aware client root, join gate, kicked screen"
```

---

## Task 16: Turntable + NowPlaying (derived progress, DJ transport)

**Files:**
- Create: `components/room/Turntable.tsx`
- Create: `components/room/NowPlaying.tsx`
- Add keyframes to: `app/globals.css`

- [ ] **Step 1: Append the vinyl spin keyframes to `app/globals.css`**

```css
/* ===== Turntable animation ===== */
@keyframes vinyl-spin { to { transform: rotate(360deg); } }
.animate-vinyl { animation: vinyl-spin 6s linear infinite; }
.animate-vinyl-paused { animation-play-state: paused; }
```

- [ ] **Step 2: Create `components/room/Turntable.tsx`**

```tsx
"use client";

export default function Turntable({ spinning, thumbnail }: { spinning: boolean; thumbnail?: string | null }) {
  return (
    <div className="relative mx-auto h-56 w-56">
      <div
        className={`h-56 w-56 rounded-full shadow-2xl ${spinning ? "animate-vinyl" : "animate-vinyl animate-vinyl-paused"}`}
        style={{ background: "repeating-radial-gradient(circle at center,#15110b 0 2px,#241a10 2px 4px)" }}
      >
        <div className="absolute inset-[33%] flex items-center justify-center rounded-full"
          style={{ background: "radial-gradient(circle,#7a1f33,#6e2233 60%,#4d1722)", boxShadow: "0 0 0 2px #b08d57" }}>
          {thumbnail
            ? <img src={thumbnail} alt="" className="h-full w-full rounded-full object-cover opacity-90" />
            : <span className="text-2xl">🎼</span>}
        </div>
        <div className="absolute inset-[48.5%] rounded-full bg-[#1a140d]" />
      </div>
      {/* tonearm */}
      <div className="absolute -right-1 -top-1 h-3 w-28 origin-right rotate-28">
        <div className="mt-1 h-1.5 rounded bg-linear-to-r from-gold to-[#8a6d2f] shadow" />
        <div className="absolute -right-1.5 -top-0.5 h-4 w-4 rounded-full bg-[#8a6d2f] shadow" />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/room/NowPlaying.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Turntable from "./Turntable";
import { computeElapsedMs } from "@/lib/identity";
import { formatClock } from "@/lib/format";
import type { Room, QueueItem } from "@/lib/supabase";

export interface NowPlayingProps {
  room: Room;
  current: QueueItem | null;
  canControl: boolean;          // DJ
  durationMs: number;           // from the player when DJ, else from current.duration_seconds*1000, else 0
  volume: number;               // 0..100 (DJ local)
  onPlayPause: () => void;
  onSkip: () => void;
  onSeekMs: (ms: number) => void;
  onVolume: (v: number) => void;
  djOnline: boolean;
}

export default function NowPlaying(p: NowPlayingProps) {
  const { room, current } = p;
  const [elapsed, setElapsed] = useState(0);

  // Tick the local clock every 500ms; value derived purely from room fields.
  useEffect(() => {
    const tick = () => setElapsed(computeElapsedMs(room));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [room.is_playing, room.started_at, room.paused_elapsed_ms]);

  const dur = p.durationMs || (current?.duration_seconds ? current.duration_seconds * 1000 : 0);

  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-gold-200 bg-cream/60 p-4 text-center">
      <Turntable spinning={room.is_playing && !!current} thumbnail={current?.thumbnail_url} />
      {current ? (
        <>
          <h2 className="font-cormorant text-2xl font-bold text-burgundy">{current.title || current.youtube_video_id}</h2>
          <p className="text-sm italic text-ink/80">do <b>{current.added_by_name}</b> đóng góp</p>
        </>
      ) : (
        <h2 className="font-cormorant text-xl text-burgundy">{!p.djOnline ? "DJ đang offline — chờ DJ" : "Hàng đợi trống"}</h2>
      )}

      <div className="flex w-[86%] items-center gap-2 text-xs text-ink/80">
        <span>{formatClock(elapsed)}</span>
        <input type="range" min={0} max={dur || 0} value={Math.min(elapsed, dur || 0)} disabled={!p.canControl || dur === 0}
          onChange={(e) => p.onSeekMs(Number(e.target.value))}
          className="h-2 flex-1 accent-burgundy" aria-label="seek" />
        <span>{formatClock(dur)}</span>
      </div>

      {p.canControl && (
        <>
          <div className="flex items-center gap-3">
            <button onClick={p.onPlayPause} className="h-13 w-13 rounded-full bg-burgundy px-4 py-2 text-cream">
              {room.is_playing ? "⏸" : "▶"}
            </button>
            <button onClick={p.onSkip} className="rounded-full border border-gold bg-cream px-4 py-2 text-burgundy">⏭</button>
            <label className="ml-2 flex items-center gap-1 text-xs text-ink/80">🔊
              <input type="range" min={0} max={100} value={p.volume}
                onChange={(e) => p.onVolume(Number(e.target.value))} className="w-20 accent-burgundy" />
            </label>
          </div>
          <p className="text-[11px] text-green-vintage">Điều khiển phát / tua / âm lượng — chỉ DJ</p>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Typecheck & commit**

Run: `npx tsc --noEmit`
```bash
git add components/room/Turntable.tsx components/room/NowPlaying.tsx app/globals.css
git commit -m "feat: turntable + now-playing with derived progress and DJ transport"
```

---

## Task 17: Members, Queue, AddSong, Header, placeholders, Settings, RoomShell

**Files:**
- Create: `components/room/MemberList.tsx`
- Create: `components/room/AddSong.tsx`
- Create: `components/room/Queue.tsx`
- Create: `components/room/Header.tsx`
- Create: `components/room/ChatPanel.tsx`
- Create: `components/room/Reactions.tsx`
- Create: `components/room/SettingsDialog.tsx`
- Replace: `components/room/RoomShell.tsx` (the Task 15 stub)

- [ ] **Step 1: Create `components/room/MemberList.tsx`**

```tsx
"use client";

import type { Member, Room } from "@/lib/supabase";

export default function MemberList({ members, room, onlineIds }: {
  members: Member[]; room: Room; onlineIds: string[];
}) {
  const online = new Set(onlineIds);
  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        Thành viên <span className="text-xs text-ink/60">{online.size} online</span>
      </h3>
      <ul>
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2 border-b border-dotted border-gold-200 py-1.5 text-sm">
            <span className={`h-2 w-2 rounded-full ${online.has(m.id) ? "bg-green-vintage" : "bg-gold-200"}`} />
            <span className="text-ink">{m.name}</span>
            {room.admin_member_id === m.id && <span className="rounded-full bg-burgundy px-2 text-[10px] text-cream">👑 Admin</span>}
            {room.dj_member_id === m.id && <span className="rounded-full bg-green-vintage px-2 text-[10px] text-cream">🎧 DJ</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/room/AddSong.tsx`**

```tsx
"use client";

import { useState } from "react";
import { addQueueItem } from "@/lib/supabase";
import { parseYouTubeId } from "@/lib/youtube/parse";
import { fetchVideoMeta } from "@/lib/youtube/meta";
import type { Identity } from "@/lib/identity";

export default function AddSong({ identity }: { identity: Identity }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const id = parseYouTubeId(url);
    if (!id) { setError("Link YouTube không hợp lệ."); return; }
    setBusy(true);
    try {
      const meta = await fetchVideoMeta(id);
      await addQueueItem(identity, {
        videoId: id,
        title: meta?.title || id,
        thumb: meta?.thumbnail ?? null,
        duration: null,
      });
      setUrl("");
    } catch (err) {
      setError((err as { message?: string }).message ?? "Không thêm được bài.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="mb-1 flex gap-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán link YouTube để thêm bài…"
        className="flex-1 rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
      <button disabled={busy} className="rounded-lg bg-burgundy px-3 py-2 font-cormorant font-bold text-cream disabled:opacity-60">
        {busy ? "…" : "+ Thêm"}
      </button>
      {error && <p className="w-full text-xs text-burgundy-accent">{error}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Create `components/room/Queue.tsx`**

```tsx
"use client";

import { useState } from "react";
import { bumpToTop, deleteItem, reorderItem, type QueueItem } from "@/lib/supabase";
import { positionBetween } from "@/lib/queue";
import type { Identity } from "@/lib/identity";

export default function Queue({ queue, currentId, canManage, identity }: {
  queue: QueueItem[]; currentId: string | null; canManage: boolean; identity: Identity;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const upcoming = queue.filter((q) => q.id !== currentId);

  async function dropOn(target: QueueItem) {
    if (!dragId || dragId === target.id) return;
    const idx = upcoming.findIndex((q) => q.id === target.id);
    const before = upcoming[idx - 1]?.position ?? null;
    const newPos = positionBetween(before, target.position);
    setDragId(null);
    try { await reorderItem(identity, dragId, newPos); } catch { /* ignore */ }
  }

  return (
    <div>
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        Hàng đợi <span className="text-xs text-ink/60">{upcoming.length} bài</span>
      </h3>
      {upcoming.length === 0 && <p className="text-sm text-ink/60">Chưa có bài nào trong hàng đợi.</p>}
      <ul>
        {upcoming.map((q) => (
          <li key={q.id}
            draggable={canManage}
            onDragStart={() => setDragId(q.id)}
            onDragOver={(e) => canManage && e.preventDefault()}
            onDrop={() => dropOn(q)}
            className="flex items-center gap-2 border-b border-dotted border-gold-200 py-2">
            {canManage && <span className="cursor-grab text-gold">⠿</span>}
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
              <div className="flex gap-1">
                <button title="Kéo lên đầu" onClick={() => bumpToTop(identity, q.id)}
                  className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">⬆</button>
                <button title="Xóa" onClick={() => deleteItem(identity, q.id)}
                  className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✕</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Create `components/room/ChatPanel.tsx` and `components/room/Reactions.tsx` (UI-only placeholders)**

`ChatPanel.tsx`:
```tsx
"use client";
export default function ChatPanel() {
  return (
    <div className="mt-4">
      <h3 className="mb-2 flex items-center gap-2 font-cormorant text-lg text-burgundy">
        Trò chuyện <span className="rounded-full border border-gold-200 bg-cream px-2 text-[9px] uppercase text-[#8a6d2f]">Sắp ra mắt</span>
      </h3>
      <div className="flex h-28 items-center justify-center rounded-lg border border-dashed border-gold-200 text-center text-xs text-ink/50">
        Khu vực chat — giao diện đã sẵn, logic Phase 2
      </div>
      <div className="mt-2 flex gap-2">
        <input disabled placeholder="Nhắn gì đó… (chưa hoạt động)"
          className="flex-1 rounded-lg border border-gold-200 bg-cream/60 px-2 py-1.5 text-sm text-ink/50" />
        <button disabled className="rounded-lg border border-gold-200 bg-cream/60 px-3 text-burgundy/50">Gửi</button>
      </div>
    </div>
  );
}
```

`Reactions.tsx`:
```tsx
"use client";
export default function Reactions() {
  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      {["😍", "🔥", "👏", "🕺", "❤️"].map((e) => (
        <span key={e} className="cursor-default rounded-full border border-gold-200 bg-cream px-2 py-1 text-lg opacity-60">{e}</span>
      ))}
      <span className="rounded-full border border-gold-200 bg-cream px-2 text-[9px] uppercase text-[#8a6d2f]">Thả cảm xúc · Sắp ra mắt</span>
    </div>
  );
}
```

- [ ] **Step 5: Create `components/room/SettingsDialog.tsx` (admin)**

```tsx
"use client";

import { useState } from "react";
import { assignDj, kickMember, renameRoom, transferAdmin, type Member, type Room } from "@/lib/supabase";
import type { Identity } from "@/lib/identity";

export default function SettingsDialog({ room, members, identity, onClose }: {
  room: Room; members: Member[]; identity: Identity; onClose: () => void;
}) {
  const [name, setName] = useState(room.name);
  const others = members.filter((m) => m.id !== identity.memberId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl border border-gold bg-parchment p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-playfair text-xl text-burgundy">Cài đặt phòng</h3>

        <label className="mb-1 block text-sm text-ink">Tên phòng</label>
        <div className="mb-4 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-gold bg-cream px-3 py-1.5 text-ink" />
          <button onClick={() => renameRoom(identity, name.trim())}
            className="rounded-lg bg-burgundy px-3 text-cream">Lưu</button>
        </div>

        <h4 className="mb-2 font-cormorant text-burgundy">Thành viên</h4>
        <ul className="max-h-60 overflow-auto">
          {others.map((m) => (
            <li key={m.id} className="flex items-center justify-between border-b border-dotted border-gold-200 py-1.5 text-sm">
              <span className="text-ink">{m.name}{room.dj_member_id === m.id ? " · 🎧" : ""}</span>
              <span className="flex gap-1">
                {room.dj_member_id === m.id
                  ? <button onClick={() => assignDj(identity, null)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Thu DJ</button>
                  : <button onClick={() => assignDj(identity, m.id)} className="rounded border border-gold-200 px-2 text-xs text-burgundy">Giao DJ</button>}
                <button onClick={() => { if (confirm(`Chuyển quyền Admin cho ${m.name}?`)) transferAdmin(identity, m.id); }}
                  className="rounded border border-gold-200 px-2 text-xs text-burgundy">Trao Admin</button>
                <button onClick={() => { if (confirm(`Kick ${m.name}?`)) kickMember(identity, m.id); }}
                  className="rounded border border-gold-200 px-2 text-xs text-burgundy-accent">Kick</button>
              </span>
            </li>
          ))}
        </ul>

        <button onClick={onClose} className="mt-4 w-full rounded-lg border border-gold py-2 text-burgundy">Đóng</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `components/room/Header.tsx`**

```tsx
"use client";

import { useState } from "react";
import { setPlayMode, type Member, type Room } from "@/lib/supabase";
import type { Identity } from "@/lib/identity";
import SettingsDialog from "./SettingsDialog";

export default function Header({ room, members, identity, isAdmin }: {
  room: Room; members: Member[]; identity: Identity | null; isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const shareCode = () => {
    const url = `${window.location.origin}/room/${room.code}`;
    navigator.clipboard?.writeText(url);
  };

  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b-2 border-gold pb-3">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🎩</span>
        <span className="font-playfair text-2xl font-bold text-burgundy">{room.name}</span>
        <button onClick={shareCode} className="rounded-lg border border-dashed border-gold bg-cream px-2 py-1 text-xs text-ink">
          🔗 {room.code} · sao chép
        </button>
      </div>
      <div className="flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-full border border-gold text-xs">
          {(["order", "shuffle"] as const).map((mode) => (
            <button key={mode} disabled={!isAdmin || room.play_mode === mode}
              onClick={() => identity && setPlayMode(identity, mode)}
              className={`px-3 py-1 ${room.play_mode === mode ? "bg-burgundy text-cream" : "text-burgundy"} ${!isAdmin ? "opacity-60" : ""}`}>
              {mode === "order" ? "Thứ tự" : "Trộn"}
            </button>
          ))}
        </div>
        {isAdmin && identity && (
          <button onClick={() => setOpen(true)} className="rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy">⚙️ Setting</button>
        )}
      </div>
      {open && identity && <SettingsDialog room={room} members={members} identity={identity} onClose={() => setOpen(false)} />}
    </header>
  );
}
```

- [ ] **Step 7: Replace `components/room/RoomShell.tsx`** (real layout; the DJ controller hook from Task 18 is imported here)

```tsx
"use client";

import type { RoomView } from "@/hooks/useRoom";
import Header from "./Header";
import MemberList from "./MemberList";
import ChatPanel from "./ChatPanel";
import NowPlaying from "./NowPlaying";
import Reactions from "./Reactions";
import AddSong from "./AddSong";
import Queue from "./Queue";
import { useDjController } from "@/hooks/useDjController";

export default function RoomShell({ code, view }: { code: string; view: RoomView }) {
  const { state, identity, role, onlineIds } = view;
  const room = state.room!;
  const current = state.queue.find((q) => q.id === room.current_item_id) ?? null;
  const djOnline = !!room.dj_member_id && onlineIds.includes(room.dj_member_id);

  // DJ-only playback engine (no-op for non-DJ). Returns transport handlers + duration/volume.
  const dj = useDjController({ room, current, identity: identity!, isDj: role.isDj });

  return (
    <main className="mx-auto max-w-6xl p-3">
      <Header room={room} members={state.members} identity={identity} isAdmin={role.isAdmin} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[22%_1fr_33%]">
        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <MemberList members={state.members} room={room} onlineIds={onlineIds} />
          <ChatPanel />
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <NowPlaying
            room={room} current={current} canControl={role.canControlPlayback}
            durationMs={dj.durationMs} volume={dj.volume} djOnline={djOnline}
            onPlayPause={dj.togglePlay} onSkip={dj.skip} onSeekMs={dj.seekMs} onVolume={dj.setVolume}
          />
          <Reactions />
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <AddSong identity={identity!} />
          <p className="mb-2 text-[11px] text-ink/60">🔎 Ô tìm kiếm trong app: bật khi cấu hình API key (Phase 2)</p>
          <Queue queue={state.queue} currentId={room.current_item_id} canManage={role.canManageQueue} identity={identity!} />
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 8: Commit** (build will fail to typecheck until Task 18 creates `useDjController`; that's expected — do Task 18 before building)

```bash
git add components/room
git commit -m "feat: room UI — header, members, queue, add-song, settings, placeholders, shell"
```

---

## Task 18: DJ playback controller (wires player ↔ playback RPCs)

**Files:**
- Create: `hooks/useDjController.ts`

> This hook is the only place the YouTube player runs. For non-DJ members it still mounts (to keep hook order stable) but never plays and writes nothing. For the DJ it: loads the current track at the correct offset, mirrors play/pause/seek to RPCs, persists volume locally, and auto-advances on song end / when idle with a non-empty queue.

- [ ] **Step 1: Create `hooks/useDjController.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { computeElapsedMs, type Identity } from "@/lib/identity";
import { advanceQueue, seekPlayback, setPlayback, type QueueItem, type Room } from "@/lib/supabase";

const VOL_KEY = "music-together:volume";

export interface DjController {
  durationMs: number;
  volume: number;
  togglePlay: () => void;
  skip: () => void;
  seekMs: (ms: number) => void;
  setVolume: (v: number) => void;
}

export function useDjController({ room, current, identity, isDj }: {
  room: Room; current: QueueItem | null; identity: Identity; isDj: boolean;
}): DjController {
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVol] = useState(100);
  const loadedRef = useRef<string | null>(null); // currently loaded video id

  // onEnded -> advance (DJ only). useYouTubePlayer keeps the latest callback.
  const yt = useYouTubePlayer(
    () => { if (isDj) void advanceQueue(identity).catch(() => {}); },
  );

  // Restore saved volume once.
  useEffect(() => {
    const v = Number(localStorage.getItem(VOL_KEY));
    if (!Number.isNaN(v) && v > 0) setVol(v);
  }, []);
  // Apply volume to the player whenever it changes / becomes ready.
  useEffect(() => { if (isDj && yt.ready) yt.setVolume(volume); }, [isDj, yt.ready, volume, yt]);

  // Load + sync the current track for the DJ whenever it changes.
  useEffect(() => {
    if (!isDj || !yt.ready) return;
    if (!current) { loadedRef.current = null; return; }

    if (loadedRef.current !== current.id) {
      loadedRef.current = current.id;
      const startSec = Math.max(0, Math.floor(computeElapsedMs(room) / 1000));
      yt.load(current.youtube_video_id, startSec);
      if (room.is_playing) yt.play(); else yt.pause();
      // capture duration shortly after load
      const t = setTimeout(() => setDurationMs(yt.getDuration() * 1000), 1200);
      return () => clearTimeout(t);
    }
  }, [isDj, yt.ready, current?.id, current?.youtube_video_id, room.is_playing, room, yt]);

  // Reflect play/pause state changes (e.g. another admin reassigned, or remote toggle).
  useEffect(() => {
    if (!isDj || !yt.ready || !current) return;
    if (room.is_playing) yt.play(); else yt.pause();
  }, [isDj, yt.ready, room.is_playing, current, yt]);

  // Auto-advance: DJ online, nothing playing, queue has items -> start next.
  useEffect(() => {
    if (!isDj || !yt.ready) return;
    if (!room.current_item_id && room.is_playing === false) {
      // only kick off if there is something to play
      void advanceQueue(identity).catch(() => {});
    }
  }, [isDj, yt.ready, room.current_item_id, room.is_playing, identity]);

  const togglePlay = useCallback(() => {
    if (!isDj) return;
    const nowPlaying = !room.is_playing;
    if (nowPlaying) {
      // resume: started_at = now - paused_elapsed
      const startedAt = new Date(Date.now() - room.paused_elapsed_ms).toISOString();
      void setPlayback(identity, { isPlaying: true, startedAt, pausedElapsedMs: room.paused_elapsed_ms });
    } else {
      const elapsed = computeElapsedMs(room);
      void setPlayback(identity, { isPlaying: false, startedAt: null, pausedElapsedMs: elapsed });
    }
  }, [isDj, room, identity]);

  const skip = useCallback(() => { if (isDj) void advanceQueue(identity); }, [isDj, identity]);

  const seekMs = useCallback((ms: number) => {
    if (!isDj) return;
    yt.seekTo(ms / 1000);
    void seekPlayback(identity, Math.floor(ms));
  }, [isDj, identity, yt]);

  const setVolume = useCallback((v: number) => {
    setVol(v);
    localStorage.setItem(VOL_KEY, String(v));
    if (isDj) yt.setVolume(v);
  }, [isDj, yt]);

  return { durationMs, volume, togglePlay, skip, seekMs, setVolume };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean (RoomShell from Task 17 now resolves `useDjController`).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: production build succeeds.

- [ ] **Step 4: Manual end-to-end verification** (the only way to validate realtime + audio)

1. `npm run dev`. Window A: create a room (you are Admin+DJ). Window B (incognito): open the shared `/room/<code>`, join with the password as "Guest".
2. In B, paste a YouTube link → it appears in **both** queues within ~1s (realtime). Audio starts in **A only** (DJ); the turntable spins; B's progress bar advances in lockstep (derived from `started_at`).
3. In A: Pause → both turntables stop, B's bar freezes. Play → resumes. Drag the seek bar in A → B's bar jumps to match. Volume slider changes A's volume only.
4. In A: when a song ends it is removed from both queues and the next plays (test both **Thứ tự** and **Trộn** via the header toggle).
5. In B (Guest): confirm no transport controls, but bump/delete are hidden too. In A open ⚙️ Setting → Giao DJ to Guest → audio source moves to B (B must press Play once due to browser autoplay policy). 
6. In A: Kick the Guest → B shows "Bạn đã bị mời khỏi phòng."
7. Reload B after rejoining → identity persists, role intact, no password re-prompt.

- [ ] **Step 5: Commit**

```bash
git add hooks/useDjController.ts
git commit -m "feat: DJ playback controller wiring player to playback RPCs"
```

---

## Task 19: Deployment notes & final pass

**Files:**
- Create: `README.md` section (append)

- [ ] **Step 1: Append deploy instructions to `README.md`**

```markdown
## Deploy (free tier)

1. **Supabase:** create a free project. In the SQL editor run `supabase/migrations/0001_init.sql`, `0002_rpc.sql`, `0003_realtime.sql` in order (or `supabase db push` with the CLI linked to the project).
2. **Vercel/Cloudflare Pages:** import the repo. Set env vars `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Build command `next build`.
3. The app is client-rendered; the only server code is the `/api/oembed` proxy (a lightweight, cached function).

### Notes
- Free Supabase projects pause after ~1 week of inactivity; the first request after that is slow.
- Realtime is read-only; all writes are authorized server-side via SECURITY DEFINER RPCs.
- Phase 2 (deferred): chat, emoji reactions, song likes (UI placeholders already present); optional in-app YouTube search (needs a `YOUTUBE_API_KEY`).
```

- [ ] **Step 2: Full test + build gate**

Run: `npm test` then `npm run build`
Expected: unit tests PASS (integration tests skipped unless local Supabase env present), build succeeds.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: deployment + phase 2 notes"
```

---

## Self-review (completed during planning)

- **Spec coverage:** create/join with password (Tasks 7,14,15) ✓; persistent rooms + history (Tasks 6,7) ✓; queue add via link + oEmbed (Tasks 12,17) ✓; DJ-only audio + transport + seek + volume (Tasks 13,16,18) ✓; timestamp-derived progress (Tasks 3,16) ✓; order/shuffle (Task 7 advance_queue + Task 17 toggle) ✓; delete/reorder/bump by admin|dj (Tasks 7,17) ✓; role mgmt assign DJ/transfer admin/kick/rename (Tasks 7,17) ✓; 1-admin/1-DJ invariant (Task 7 pointers + Task 4 derive) ✓; presence online (Task 11) ✓; reconnect keeps role (Tasks 3,15) ✓; kicked screen (Task 15) ✓; Vintage Library style + Salon layout (Tasks 5,16,17) ✓; chat/reactions/likes UI-only placeholders (Task 17) ✓; RLS + secrets isolation + token auth (Tasks 6,7) ✓; realtime publication (Task 8) ✓.
- **Security refinement:** `token_hash` moved to `member_secrets` (RLS, no policy, not published) so the `members` SELECT policy and realtime payloads never leak hashes. `members` row type excludes it everywhere.
- **Type consistency:** `Identity` defined in `lib/identity.ts`, imported by `lib/supabase.ts` and consumers; RPC wrapper names match Task 18/17 call sites (`advanceQueue`, `setPlayback`, `seekPlayback`, `bumpToTop`, `reorderItem`, `deleteItem`, `setPlayMode`, `assignDj`, `transferAdmin`, `kickMember`, `renameRoom`); `RoomView`/`RoomState` shapes match across `useRoom`/`RoomShell`; `deriveRole` flags (`isAdmin/isDj/canManageQueue/canControlPlayback`) used consistently.
- **Known intentional gaps (Phase 2 / accepted):** display names are spoofable (auth is token-only, by design); duration backfill into `queue_items` is skipped in Phase 1 (NowPlaying uses player duration for the current track); "claim admin when admin offline" deferred. Auto-skip on un-embeddable video is a recommended follow-up (the player `onError` hook is already exposed) but left out of MVP scope.
```
