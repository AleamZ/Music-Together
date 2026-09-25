# Music Together v14 — "Ao câu cá" (fishing, xu, shops) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second game map — a Miền Tây fishing pond reached from the hall's dock — with worm digging, a Stardew-style reel minigame, fish carried in hand or bucket, a fish depot, a gear shop and a server-authoritative xu economy (daily check-in, song bonus, records board), while the music room keeps working exactly as before.

**Architecture:** Postgres owns every roll, price, balance and inventory change (migration `0012`, SECURITY DEFINER RPCs that all return the account's full fishing state as JSON). The client adds pure, unit-tested modules under `lib/game/fishing/` (catalog/format, state, reel physics, cast timeline, geometry, announcements) and `lib/game/maps/` (map registry, pond map), a pond scene painter, and a `useFishingController` hook that drives `FishingHud` / `FishingOverlays` inside the existing `GameShell`. Each map has its own Broadcast channel (`game:{roomId}:{mapId}`); Presence carries the member's map; a new `fs` message shows other players' casting, bites, reels, catches and carried fish.

**Tech Stack:** Next.js 16.2.9 (App Router, client components), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom + RTL, pnpm 11, PostgreSQL 18 (local throwaway cluster for migration checks).

**Spec:** `docs/superpowers/specs/2026-09-24-music-together-v14-fishing-design.md` — read it before starting any task. The v13 spec (`docs/superpowers/specs/2026-09-24-music-together-v13-game-mode-design.md`) describes the game engine this plan extends.

## Global Constraints

- Work on branch `feat/v14-fishing` (already created, in place — no worktree). Commit after every task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Package manager **pnpm** (`pnpm test`, `pnpm lint`, `pnpm build`). Typecheck: `npx tsc --noEmit`. Single test file: `pnpm vitest run tests/unit/<file>.test.ts`.
- Baseline before v14 (branch head `fb7b213`): `pnpm test` → 47 files passed / 8 skipped (293 tests passed); `npx tsc --noEmit` clean; `pnpm lint` has **17 pre-existing errors** (none in game files). Every file you create or modify must lint clean: `npx eslint <your files>`.
- Before using any Next.js API read the matching guide in `node_modules/next/dist/docs/` (`AGENTS.md`).
- React hook lint rules (eslint-plugin-react-hooks 7): no `ref.current` reads/writes during render, no synchronous `setState` directly in an effect body (callbacks, timers and async continuations are fine), no `Date.now()` / `Math.random()` / `performance.now()` during render.
- Pure logic lives in `lib/` with Vitest tests in `tests/unit/`. Browser-only code (canvas, `document`, `window`) is never imported by a pure module. Modules under `lib/game/` that tests import must not import `@/lib/supabase` unless the test mocks it (`lib/game/look.ts` exists for exactly this).
- Realtime: every game message goes through the send gate (≤ 3 msgs/s, movement coalesced). `fs` is a **control** message (FIFO, never dropped). Presence `track()` stays within the v13 budget (≤ 4 calls / 30 s + reconnect reserve).
- All art is original and drawn in code (string grids / procedural painters). Never copy images from *Miệt Thương Mến* or any other game.
- Maps: 640 × 400 world px, collision cell 8 px, character 24 × 48 anchored at the feet (drawn at `x-12, y-46`), walk speed 70 px/s, `PROMPT_RANGE` 26 px.
- UI copy is Vietnamese; use the strings given in the tasks verbatim. Numbers: `vi-VN` (`1.230 xu`), weights with a decimal comma (`3,2 kg`).
- SQL is additive and re-runnable (`create … if not exists`, `create or replace`, `drop policy/trigger if exists`, seeds with `on conflict (id) do update`) with explicit grants. The owner runs migrations in the Supabase SQL editor — never against a hosted database from here.
- Local PostgreSQL: **never touch the installed PostgreSQL 18 service** (its password is unknown). Use a throwaway cluster with `initdb --auth=trust` on port **5499** in the session scratchpad, and **always `export PGCLIENTENCODING=UTF8`** before running `psql` (the Windows console default WIN1252 corrupts or rejects the Vietnamese seed text).
- The repo is public: never commit passwords, tokens or copyrighted assets.
- Vitest runs without globals, so Testing Library does not clean up by itself: every component or hook test file calls `afterEach(cleanup)` (or `cleanup()` inside its existing `afterEach`).
- The React Compiler lint (`react-hooks/preserve-manual-memoization`) rejects `someRef.current` inside `useCallback` when the ref comes from outside the hook: hooks that drive the canvas take a getter `canvas: () => GameCanvasHandle | null`, never a ref object.
- Never type a password (account or room) in the browser. Manual checks need the owner to log in.

## File map

| File | Responsibility |
|---|---|
| `lib/game/look.ts` | pure `DEFAULT_LOOK` + NPC looks (no Supabase) |
| `lib/game/text.ts` (mod) | grapheme-safe bubble wrapping |
| `supabase/migrations/0012_v14_fishing.sql` | config tables + seeds, wallet/ledger/inventory/profile/fish/bests/casts, RPCs, song-bonus triggers |
| `tests/sql/v14-smoke.sql` | RPC smoke test for the throwaway PG cluster |
| `lib/game/fishing/catalog.ts` | pure: species/shop types, rarity names/colours, `formatWeight`, `formatXu`, `describeItem` |
| `lib/game/fishing/state.ts` | pure: `FishingState` parse + helpers (`castBlocker`, capacities, ownership) |
| `lib/game/fishing/announce.ts` | pure: parse chat catch announcements |
| `lib/game/fishing/messages.ts` | pure: the fishing HUD's Vietnamese texts, `castRefusal`, `lostText`, `promptText` |
| `lib/game/fishing/rpc.ts` | Supabase wrappers for the fishing RPCs + `fishingErrorMessage` |
| `lib/game/fishing/reel.ts` | pure: reel minigame physics |
| `lib/game/fishing/cast.ts` | pure: cast timeline (waiting → bite → missed) |
| `lib/game/fishing/geometry.ts` | pure: hand, rod tip and bobber points per facing |
| `lib/game/art/icons.ts` (mod), `fish.ts`, `gear.ts` | 16×16 icons for clothes, fish and gear; `iconMatrixFor(id)` |
| `lib/game/art/fishing.ts` | browser: rod, line, bobber, ripples, held fish |
| `lib/game/maps/types.ts` (mod) | `MapId`, `InteractKind`, `Interactable` with `kind/prompt/face/to`, `Npc`, `seating` |
| `lib/game/maps/rect.ts`, `arrivals.ts` | shared `overlaps`, portal arrival spots |
| `lib/game/maps/scene-art.ts` | shared painter helpers + `SceneArt` type |
| `lib/game/maps/props.ts` | every depth-sorted prop: frames + painters |
| `lib/game/maps/hall.ts`, `hall-art.ts` (mod) | hall with the dock portal; hall painter on the shared helpers |
| `lib/game/maps/pond.ts`, `pond-art.ts` | pond layout + collision; pond painter |
| `lib/game/maps/registry.ts` | `getMap(id)`, `paintMap(map)` |
| `lib/presence-modes.ts`, `lib/realtime.ts`, `hooks/useRoom.ts` (mod) | presence `map`, `mapCounts`, `setMap` |
| `lib/game/social.ts` (mod) | roster per map |
| `lib/game/net/protocol.ts`, `channel.ts` (mod) | `fs` message, optional `h`/`f`; per-map topic; sends wait for SUBSCRIBED |
| `lib/game/world.ts` (mod) | remote fishing phase + hand fish |
| `lib/game/scene.ts`, `engine.ts` (mod) | camera inset, NPCs, fishing visuals, input lock, frame guard |
| `components/game/GameCanvas.tsx`, `GameShell.tsx` (mod) | map switching, fade, presence map, fishing handle, HUD wiring |
| `components/game/HudNowPlaying.tsx` (mod) | collapsible on phones |
| `components/game/MapCounts.tsx` | 🎵 Sảnh · 🎣 Ao cá chip |
| `hooks/useFishing.ts` | fishing state + RPC actions |
| `hooks/useCastSession.ts` | cast flow (start, bite, hook, reel, finish) |
| `hooks/useFishingController.ts` | everything fishing for the shell: dig, daily, song bonus, cast, panels |
| `components/game/fishing/*` | `FishingHud`, `FishingOverlays`, `ReelOverlay`, `CatchCard`, `BagPanel`, `DepotPanel`, `ShopPanel`, `RecordsPanel`, `FishLine` |
| `components/room/ChatMessageItem.tsx` (mod) | system line for catch announcements |
| `README.md` (mod) | v14 section |

## Plan conflict scan (pre-flight, done by the plan author)

- The spec's §6.2 starting values (`fish h/2`) and motion constants were tuned in a simulation (bots at several skill levels, 200 seeds per difficulty and rod): the plan uses `fishStart 0.45`, a fish floor of `zone height + 0.05`, lift 3.0, gravity 2.2, max speed 1.4, fish speed `0.18 + 0.62·d`, retarget `(0.3 + 1.2·d)/s`, jump `0.25 + 0.6·d`, drain `0.075 + 0.07·d`. The fill rule and the start progress 0.3 are unchanged (spec §6.2 allows tuning; the spec table is amended alongside this plan).
- Spec §4 lists "fishing HUD, panels, useFishing" under `GameShell`. The plan keeps that ownership but moves the logic into `useFishingController` (called by `GameShell`) and two presentational components, so the shell file does not grow by hundreds of lines.
- Spec §8.6 places `fishingErrorMessage` in `rpc.ts` — kept; its test mocks `@/lib/supabase`.
- The SQL in Tasks 2–3 and `tests/sql/v14-smoke.sql` were run by the plan author on a throwaway PostgreSQL 18 cluster (0004–0012, 0012 twice, both the Task 2 and the Task 3 state): every assertion passed.
- **Validated end to end.** The plan author implemented every task in a scratch copy of this branch (tsc clean, `pnpm test` 64 files / 423 tests green, `pnpm lint` at the 17 baseline errors, `pnpm build` OK) and generated the code blocks of Tasks 7–18 from that copy; a mechanical replay of this document on a clean checkout of `fb7b213` reproduced the same files. If an edit's "old" text is not found, re-read the file — do not improvise a different change.
- Spec §5.3 / §9.3 place the bobber 36 px in front of the feet. Facing up that point lies on the character's own 48-px sprite, so the plan uses a reach per facing — up 56, down 30, left/right 36 (`BOBBER_REACH`, Task 5); the pond's spots and tests use it and the spec is amended alongside this plan.
- Spec §4 lists `MapCounts` under `components/game/fishing/`; it is not fishing-specific, so it lives in `components/game/MapCounts.tsx`.
- The spec gives no text for some toasts; the plan's wording: "🪱 Đào được N trùn đất!", "🛒 Đã mua {tên} × N.", "Đã thu cần.", "Hết mồi đang chọn — dùng trùn đất.", "Đang tải giỏ đồ…", "Chưa tải được giỏ đồ — bấm “Tải lại giỏ đồ” nhé.", "Sắp mở — chờ chút nhé!" (the pond's interactables between Task 13 and Tasks 14–16).
- The daily check-in and the song-bonus check are run by `useFishingController`, which `GameShell` calls (same ownership argument as above).

---

### Task 1: Pure looks + grapheme-safe chat bubbles (v13 carry-overs M9 + wrapBubble)

**Files:**
- Create: `lib/game/look.ts`
- Modify: `lib/game/character.ts:4-11` (DEFAULT_LOOK moves out, re-exported)
- Modify: `lib/game/social.ts:2` (import from `@/lib/game/look`)
- Modify: `lib/game/text.ts` (full replacement)
- Modify: `tests/unit/game-world.test.ts:2`, `tests/unit/game-social.test.ts:3` (import `DEFAULT_LOOK` from `@/lib/game/look`)
- Test: `tests/unit/game-look-module.test.ts` (new), `tests/unit/game-seating-text.test.ts` (extend)

**Interfaces:**
- Produces: `DEFAULT_LOOK: Look`, `CO_BA_LOOK: Look`, `CHU_TU_LOOK: Look` from `@/lib/game/look`; `graphemes(text: string): string[]` and the unchanged `wrapBubble(text, maxChars = 28, maxLines = 2): string[]` from `@/lib/game/text`. `@/lib/game/character` still exports `DEFAULT_LOOK` (same object).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-look-module.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ITEM_ART } from "@/lib/game/art/items";
import { DEFAULT_LOOK as FROM_CHARACTER } from "@/lib/game/character";
import { CHU_TU_LOOK, CO_BA_LOOK, DEFAULT_LOOK } from "@/lib/game/look";

describe("pure look module", () => {
  it("does not depend on Supabase", () => {
    expect(readFileSync("lib/game/look.ts", "utf8")).not.toMatch(/supabase/);
  });
  it("is the DEFAULT_LOOK the character module exports", () => {
    expect(FROM_CHARACTER).toBe(DEFAULT_LOOK);
  });
  it("dresses the default look and both NPCs in items that have art", () => {
    for (const look of [DEFAULT_LOOK, CO_BA_LOOK, CHU_TU_LOOK]) {
      for (const id of [look.hat, look.top, look.bottom, look.shoes, look.neck]) {
        if (id) expect(ITEM_ART[id], id).toBeDefined();
      }
    }
  });
});
```

Append to `tests/unit/game-seating-text.test.ts` (inside the file, after the existing `describe("wrapBubble", …)` block; also change the import line to `import { graphemes, wrapBubble } from "@/lib/game/text";`):

```ts
describe("wrapBubble — graphemes", () => {
  const noLoneSurrogate = (s: string) => [...s].every((ch) => {
    const cp = ch.codePointAt(0)!;
    return cp < 0xd800 || cp > 0xdfff;
  });
  it("never cuts an emoji in half", () => {
    const lines = wrapBubble("🎣".repeat(70));
    expect(lines).toHaveLength(2);
    expect(lines.every(noLoneSurrogate)).toBe(true);
    expect(graphemes(lines[0])).toHaveLength(28);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(graphemes(lines[1])).toHaveLength(28);
  });
  it("keeps decomposed Vietnamese letters whole (NFC)", () => {
    const decomposed = "Cá lóc bông".normalize("NFD");
    expect(wrapBubble(decomposed)).toEqual(["Cá lóc bông"]);
  });
  it("counts a letter with its accents as one character", () => {
    expect(graphemes("ệ".normalize("NFD"))).toEqual(["ệ"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/game-look-module.test.ts tests/unit/game-seating-text.test.ts`
Expected: FAIL — `Cannot find module '@/lib/game/look'` and `graphemes` is not exported.

- [ ] **Step 3: Create `lib/game/look.ts`**

```ts
import type { Look } from "@/lib/game/types";

// Pure look constants — no Supabase import, so the game world, the pond NPCs and the tests can use them freely.

export const DEFAULT_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};

/** cô Ba — keeps the fish depot (Vựa cá). */
export const CO_BA_LOOK: Look = {
  skin: "warm", hair: "long", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_pink", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: null,
};

/** chú Tư — keeps the tackle shop (Tiệm đồ câu). */
export const CHU_TU_LOOK: Look = {
  skin: "tan", hair: "short", hairColor: "black",
  hat: "hat_taibeo_green", top: "top_baba_white", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};
```

- [ ] **Step 4: Point `character.ts` and `social.ts` at it**

In `lib/game/character.ts` replace

```ts
export const DEFAULT_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_shorts_red", shoes: "shoes_dep_blue", neck: "neck_khanran",
};
```

with

```ts
import { DEFAULT_LOOK } from "@/lib/game/look";

export { DEFAULT_LOOK };
```

(keep the other imports at the top of the file; move this import up with them so eslint's `import/first` stays happy).

In `lib/game/social.ts` change `import { DEFAULT_LOOK } from "@/lib/game/character";` to `import { DEFAULT_LOOK } from "@/lib/game/look";`.

In `tests/unit/game-world.test.ts` and `tests/unit/game-social.test.ts` change `import { DEFAULT_LOOK } from "@/lib/game/character";` to `import { DEFAULT_LOOK } from "@/lib/game/look";`.

- [ ] **Step 5: Replace `lib/game/text.ts`**

```ts
const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl
  ? new Intl.Segmenter("vi", { granularity: "grapheme" })
  : null;

/** User-perceived characters of NFC text: an emoji, or a letter with its accents, counts as one. */
export function graphemes(text: string): string[] {
  const s = text.normalize("NFC");
  return segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s);
}

/** Word-wrap a chat message for a bubble: ≤ maxLines lines of ≤ maxChars characters (graphemes), "…" when cut. */
export function wrapBubble(text: string, maxChars = 28, maxLines = 2): string[] {
  const words = text.normalize("NFC").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[][] = [];
  let cur: string[] = [];
  for (const word of words) {
    let w = graphemes(word);
    while (w.length > maxChars) {
      if (cur.length > 0) {
        lines.push(cur);
        cur = [];
      }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (w.length === 0) continue;
    if (cur.length === 0) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur = [...cur, " ", ...w];
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length > 0) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = [...(last.length >= maxChars ? last.slice(0, maxChars - 1) : last), "…"];
  }
  return lines.map((l) => l.join(""));
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/unit/game-look-module.test.ts tests/unit/game-seating-text.test.ts tests/unit/game-world.test.ts tests/unit/game-social.test.ts tests/unit/game-look.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/look.ts lib/game/character.ts lib/game/social.ts lib/game/text.ts tests/unit/game-look-module.test.ts tests/unit/game-seating-text.test.ts tests/unit/game-world.test.ts tests/unit/game-social.test.ts` (clean).

```bash
git add lib/game/look.ts lib/game/character.ts lib/game/social.ts lib/game/text.ts tests/unit/game-look-module.test.ts tests/unit/game-seating-text.test.ts tests/unit/game-world.test.ts tests/unit/game-social.test.ts
git commit -m "refactor(v14): pure look module and grapheme-safe chat bubbles

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database — config, wallet, inventory and the account RPCs

**Files:**
- Create: `supabase/migrations/0012_v14_fishing.sql` (sections A–D; Task 3 appends E–F)
- Create: `tests/sql/v14-smoke.sql` (setup + account checks; Task 3 appends the rest)
- Create: `tests/integration/v14.test.ts` (account RPCs; Task 3 appends casts)

**Interfaces:**
- Produces (Postgres): tables `fish_species`, `shop_items` (public read), `wallets`, `coin_ledger`, `inventory`, `fishing_profiles`, `fish`, `personal_bests` (private); helpers `_vn_today()`, `_wallet_lock(uuid)`, `_fishing_profile(uuid)`, `_owns(uuid,text)`, `_bait_cap(uuid)`, `_bucket_cap(uuid)`, `_bait_total(uuid)`, `_pay(uuid,int,text,text)`, `_fishing_state(uuid)`; RPCs `fishing_state(text)`, `claim_daily(text)`, `dig_worms(text)`, `buy_item(text,text,int)`, `set_loadout(text,text,text,text)`, `sell_fish(text,uuid[])`, `release_fish(text,uuid)`. Every RPC returns `jsonb`; the account state has the shape of spec §8.2 (snake_case keys). Errors: `raise exception '<message>' using errcode = …` with the messages of spec §8.6; `dig cooldown` / `cast limit` put the seconds left in `detail`.

- [ ] **Step 1: Write the migration (sections A–D)**

Create `supabase/migrations/0012_v14_fishing.sql` with exactly:

```sql
-- =========================================================
-- 0012_v14_fishing.sql — v14: fishing pond economy — xu wallet + ledger, gear shop, bait, casts, caught fish,
-- personal bests, the room fishing board and the song bonus.
-- ADDITIVE (no data drop) and re-runnable. Every function relies on `set search_path = public, extensions`.
-- =========================================================

-- ---------- A. Config tables (public read) ----------
create table if not exists public.fish_species (
  id text primary key,
  name text not null,
  rarity smallint not null check (rarity between 1 and 5),
  min_g integer not null check (min_g > 0),
  max_g integer not null check (max_g >= min_g),
  price_per_kg integer not null check (price_per_kg > 0),
  difficulty smallint not null check (difficulty between 1 and 100),
  sort_order integer not null default 0
);
alter table public.fish_species enable row level security;
drop policy if exists fish_species_select on public.fish_species;
create policy fish_species_select on public.fish_species for select to anon using (true);

insert into public.fish_species (id, name, rarity, min_g, max_g, price_per_kg, difficulty, sort_order) values
  ('ca_ro',       'Cá rô đồng',    1,    50,   300,  45, 15,  10),
  ('ca_sac',      'Cá sặc rằn',    1,    50,   250,  40, 12,  20),
  ('ca_me_vinh',  'Cá mè vinh',    1,   100,   500,  35, 20,  30),
  ('ca_loc',      'Cá lóc',        2,   300,  2500,  60, 38,  40),
  ('ca_tre',      'Cá trê vàng',   2,   200,  1200,  50, 32,  50),
  ('ca_chep',     'Cá chép',       2,   500,  3000,  55, 42,  60),
  ('ca_tra',      'Cá tra',        3,  1000,  6000,  70, 52,  70),
  ('ca_that_lat', 'Cá thát lát',   3,   300,  1500, 120, 58,  80),
  ('tom_cang',    'Tôm càng xanh', 3,    50,   300, 400, 62,  90),
  ('ca_bong_lau', 'Cá bông lau',   4,  1000,  5000, 120, 70, 100),
  ('ca_he_vang',  'Cá he vàng',    4,   300,  1500, 150, 75, 110),
  ('ca_ho',       'Cá hô',         5, 10000, 40000, 200, 90, 120)
on conflict (id) do update set
  name = excluded.name, rarity = excluded.rarity, min_g = excluded.min_g, max_g = excluded.max_g,
  price_per_kg = excluded.price_per_kg, difficulty = excluded.difficulty, sort_order = excluded.sort_order;

create table if not exists public.shop_items (
  id text primary key,
  kind text not null check (kind in ('rod','bobber','bait','bait_box','bucket')),
  name text not null,
  price integer check (price > 0),                  -- null = not sold (starter gear, dug worms)
  starter boolean not null default false,           -- everyone owns it
  sort_order integer not null default 0,
  zone_pct smallint, weight_k real, rare_mult real not null default 1,                                        -- rod
  window_ms integer, bite_min_ms integer, bite_max_ms integer, shows_rarity boolean not null default false,  -- bobber
  mult_hiem real not null default 1, mult_quy real not null default 1, mult_legend real not null default 1,  -- bait
  capacity integer                                                                                             -- bait_box, bucket
);
alter table public.shop_items enable row level security;
drop policy if exists shop_items_select on public.shop_items;
create policy shop_items_select on public.shop_items for select to anon using (true);

insert into public.shop_items (id, kind, name, price, starter, sort_order, zone_pct, weight_k, rare_mult,
                               window_ms, bite_min_ms, bite_max_ms, shows_rarity, mult_hiem, mult_quy, mult_legend, capacity) values
  ('rod_wood',       'rod',      'Cần gỗ',       null, true,  10,   25,  2.0, 1,   null, null,  null,  false, 1,   1,   1,   null),
  ('rod_bamboo',     'rod',      'Cần tre',       300, false, 20,   30,  1.5, 1,   null, null,  null,  false, 1,   1,   1,   null),
  ('rod_carbon',     'rod',      'Cần carbon',   1500, false, 30,   36,  1.5, 1.2, null, null,  null,  false, 1,   1,   1,   null),
  ('bobber_feather', 'bobber',   'Phao lông gà', null, true,  10, null, null, 1,   1500, 3000, 10000, false, 1,   1,   1,   null),
  ('bobber_foam',    'bobber',   'Phao xốp',      150, false, 20, null, null, 1,   2000, 3000, 10000, true,  1,   1,   1,   null),
  ('bobber_lamp',    'bobber',   'Phao đèn',      800, false, 30, null, null, 1,   2500, 2000,  7000, true,  1,   1,   1,   null),
  ('bait_worm',      'bait',     'Trùn đất',     null, false, 10, null, null, 1,   null, null,  null,  false, 1,   1,   1,   null),
  ('bait_shrimp',    'bait',     'Mồi tép',         5, false, 20, null, null, 1,   null, null,  null,  false, 1.5, 1.5, 1.5, null),
  ('bait_bloodworm', 'bait',     'Mồi trùn chỉ',   12, false, 30, null, null, 1,   null, null,  null,  false, 2,   2,   3,   null),
  ('bait_box',       'bait_box', 'Hộp mồi',       250, false, 10, null, null, 1,   null, null,  null,  false, 1,   1,   1,   60),
  ('bucket_small',   'bucket',   'Xô nhỏ',        200, false, 10, null, null, 1,   null, null,  null,  false, 1,   1,   1,   5),
  ('bucket_large',   'bucket',   'Xô lớn',        800, false, 20, null, null, 1,   null, null,  null,  false, 1,   1,   1,   15)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter, sort_order = excluded.sort_order,
  zone_pct = excluded.zone_pct, weight_k = excluded.weight_k, rare_mult = excluded.rare_mult,
  window_ms = excluded.window_ms, bite_min_ms = excluded.bite_min_ms, bite_max_ms = excluded.bite_max_ms,
  shows_rarity = excluded.shows_rarity, mult_hiem = excluded.mult_hiem, mult_quy = excluded.mult_quy,
  mult_legend = excluded.mult_legend, capacity = excluded.capacity;

-- ---------- B. Per-account tables (private: RLS on, no policies — only the RPCs below touch them) ----------
create table if not exists public.wallets (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  coins integer not null default 0 check (coins >= 0),
  daily_on date,                                            -- VN day of the last check-in
  bonus_on date,                                            -- VN day that bonus_count counts
  bonus_count smallint not null default 0
);
create table if not exists public.coin_ledger (             -- append-only
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  delta integer not null,
  balance integer not null,
  reason text not null check (reason in ('daily','song','sell','buy')),
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists idx_coin_ledger_account on public.coin_ledger (account_id, created_at);
create table if not exists public.inventory (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  qty integer not null check (qty >= 0),
  primary key (account_id, item_id)
);
create table if not exists public.fishing_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  rod text not null default 'rod_wood' references public.shop_items(id),
  bobber text not null default 'bobber_feather' references public.shop_items(id),
  bait text not null default 'bait_worm' references public.shop_items(id),
  window_start timestamptz,                                 -- hourly cast cap window
  window_casts smallint not null default 0,
  last_dig_at timestamptz
);
create table if not exists public.fish (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null check (weight_g > 0),
  price integer not null check (price > 0),
  caught_at timestamptz not null default now()
);
create index if not exists idx_fish_account on public.fish (account_id, caught_at);
create table if not exists public.personal_bests (
  account_id uuid not null references public.accounts(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null,
  caught_at timestamptz not null default now(),
  primary key (account_id, species_id)
);
alter table public.wallets enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.inventory enable row level security;
alter table public.fishing_profiles enable row level security;
alter table public.fish enable row level security;
alter table public.personal_bests enable row level security;
revoke all on public.wallets, public.coin_ledger, public.inventory, public.fishing_profiles, public.fish, public.personal_bests
  from anon, authenticated;

-- ---------- C. Private helpers ----------
create or replace function public._vn_today() returns date
language sql stable set search_path = public, extensions
as $$ select (now() at time zone 'Asia/Ho_Chi_Minh')::date $$;

-- The account's wallet row, created if missing and locked until the transaction ends: every economy call takes it
-- first, so one account's calls (several tabs) run one after another.
create or replace function public._wallet_lock(p_account uuid) returns public.wallets
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.wallets;
begin
  insert into public.wallets (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into v from public.wallets where account_id = p_account for update;
  return v;
end; $$;

create or replace function public._fishing_profile(p_account uuid) returns public.fishing_profiles
language plpgsql security definer set search_path = public, extensions
as $$
declare v public.fishing_profiles;
begin
  insert into public.fishing_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into v from public.fishing_profiles where account_id = p_account for update;
  return v;
end; $$;

-- Owned = a starter item, or an inventory row with qty ≥ 1.
create or replace function public._owns(p_account uuid, p_item text) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (select 1 from public.shop_items s where s.id = p_item and s.starter)
      or exists (select 1 from public.inventory i where i.account_id = p_account and i.item_id = p_item and i.qty >= 1)
$$;

create or replace function public._bait_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(max(s.capacity), 20) from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and i.qty >= 1 and s.kind = 'bait_box'
$$;

create or replace function public._bucket_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(max(s.capacity), 0) from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and i.qty >= 1 and s.kind = 'bucket'
$$;

create or replace function public._bait_total(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(sum(i.qty), 0)::int from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and s.kind = 'bait'
$$;

-- Add p_delta xu (negative = pay) and append the ledger row. The coins >= 0 check stops overdrafts.
create or replace function public._pay(p_account uuid, p_delta integer, p_reason text, p_ref text) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare v_balance integer;
begin
  update public.wallets set coins = coins + p_delta where account_id = p_account returning coins into v_balance;
  insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, p_delta, v_balance, p_reason, p_ref);
  return v_balance;
end; $$;

-- Everything the client shows about the account's fishing (spec §8.2).
create or replace function public._fishing_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare w public.wallets; p public.fishing_profiles; v_resets timestamptz; v_left integer; v_dig timestamptz;
begin
  select * into w from public.wallets where account_id = p_account;
  select * into p from public.fishing_profiles where account_id = p_account;
  if p.window_start is not null and now() < p.window_start + interval '1 hour' then
    v_resets := p.window_start + interval '1 hour';
    v_left := greatest(0, 40 - p.window_casts);
  else
    v_resets := null;
    v_left := 40;
  end if;
  if p.last_dig_at is not null and now() < p.last_dig_at + interval '45 seconds' then
    v_dig := p.last_dig_at + interval '45 seconds';
  else
    v_dig := null;
  end if;
  return jsonb_build_object(
    'coins', coalesce(w.coins, 0),
    'daily_claimed', coalesce(w.daily_on = public._vn_today(), false),
    'loadout', jsonb_build_object('rod', coalesce(p.rod, 'rod_wood'), 'bobber', coalesce(p.bobber, 'bobber_feather'),
                                  'bait', coalesce(p.bait, 'bait_worm')),
    'owned', coalesce((select jsonb_agg(i.item_id order by s.kind, s.sort_order)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1 and s.kind <> 'bait'), '[]'::jsonb),
    'bait', (select jsonb_object_agg(s.id, coalesce(i.qty, 0))
               from public.shop_items s
               left join public.inventory i on i.item_id = s.id and i.account_id = p_account
              where s.kind = 'bait'),
    'bait_cap', public._bait_cap(p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'species_id', f.species_id, 'weight_g', f.weight_g,
                                                          'price', f.price, 'caught_at', f.caught_at) order by f.caught_at, f.id)
                        from public.fish f where f.account_id = p_account), '[]'::jsonb),
    'fish_cap', 1 + public._bucket_cap(p_account),
    'casts_left', v_left,
    'window_resets_at', v_resets,
    'dig_ready_at', v_dig
  );
end; $$;

revoke all on function public._vn_today() from public, anon, authenticated;
revoke all on function public._wallet_lock(uuid) from public, anon, authenticated;
revoke all on function public._fishing_profile(uuid) from public, anon, authenticated;
revoke all on function public._owns(uuid, text) from public, anon, authenticated;
revoke all on function public._bait_cap(uuid) from public, anon, authenticated;
revoke all on function public._bucket_cap(uuid) from public, anon, authenticated;
revoke all on function public._bait_total(uuid) from public, anon, authenticated;
revoke all on function public._pay(uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- ---------- D. Account RPCs ----------
create or replace function public.fishing_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  return public._fishing_state(public._auth_account(p_session_token));
end; $$;

-- +20 xu once per VN calendar day.
create or replace function public.claim_daily(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; v_today date := public._vn_today();
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  if w.daily_on is not distinct from v_today then
    return jsonb_build_object('claimed', false, 'amount', 0, 'state', public._fishing_state(v_account));
  end if;
  update public.wallets set daily_on = v_today where account_id = v_account;
  perform public._pay(v_account, 20, 'daily', v_today::text);
  return jsonb_build_object('claimed', true, 'amount', 20, 'state', public._fishing_state(v_account));
end; $$;

-- 1–3 worms, clamped to the bait capacity; 45 s cooldown per account.
create or replace function public.dig_worms(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_total integer; v_cap integer; v_gain integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  if p.last_dig_at is not null and now() < p.last_dig_at + interval '45 seconds' then
    raise exception 'dig cooldown' using errcode = '53400',
      detail = ceil(extract(epoch from (p.last_dig_at + interval '45 seconds' - now())))::int::text;
  end if;
  v_total := public._bait_total(v_account);
  v_cap := public._bait_cap(v_account);
  if v_total >= v_cap then
    raise exception 'bait full' using errcode = '22023';
  end if;
  v_gain := least(1 + floor(random() * 3)::int, v_cap - v_total);
  insert into public.inventory (account_id, item_id, qty) values (v_account, 'bait_worm', v_gain)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  update public.fishing_profiles set last_dig_at = now() where account_id = v_account;
  return jsonb_build_object('gained', v_gain, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind = 'bait' then
    if p_qty is null or p_qty < 1 or p_qty > 99 then
      raise exception 'invalid quantity' using errcode = '22023';
    end if;
    if public._bait_total(v_account) + p_qty > public._bait_cap(v_account) then
      raise exception 'bait full' using errcode = '22023';
    end if;
    v_cost := it.price * p_qty;
    if w.coins < v_cost then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -v_cost, 'buy', it.id || ' x' || p_qty);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
    on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
    -- the selected bait ran out → the bought bait becomes the selection
    if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) = 0 then
      update public.fishing_profiles set bait = it.id where account_id = v_account;
    end if;
  else
    if p_qty is distinct from 1 then
      raise exception 'invalid quantity' using errcode = '22023';
    end if;
    if public._owns(v_account, it.id)
       or (it.kind = 'bait_box' and public._bait_cap(v_account) >= it.capacity)
       or (it.kind = 'bucket' and public._bucket_cap(v_account) >= it.capacity) then
      raise exception 'already owned' using errcode = '22023';
    end if;
    if w.coins < it.price then
      raise exception 'not enough coins' using errcode = '22023';
    end if;
    perform public._pay(v_account, -it.price, 'buy', it.id);
    insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, 1)
    on conflict (account_id, item_id) do update set qty = 1;
    -- a better rod / bobber (by price; starter = 0) is equipped right away
    if it.kind in ('rod', 'bobber') then
      select coalesce(price, 0) into v_equipped from public.shop_items where id = case when it.kind = 'rod' then p.rod else p.bobber end;
      if it.price > coalesce(v_equipped, 0) then
        if it.kind = 'rod' then
          update public.fishing_profiles set rod = it.id where account_id = v_account;
        else
          update public.fishing_profiles set bobber = it.id where account_id = v_account;
        end if;
      end if;
    end if;
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

create or replace function public.set_loadout(p_session_token text, p_rod text, p_bobber text, p_bait text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  perform public._fishing_profile(v_account);
  if not exists (select 1 from public.shop_items where id = p_rod and kind = 'rod') or not public._owns(v_account, p_rod)
     or not exists (select 1 from public.shop_items where id = p_bobber and kind = 'bobber') or not public._owns(v_account, p_bobber)
     or not exists (select 1 from public.shop_items where id = p_bait and kind = 'bait') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  update public.fishing_profiles set rod = p_rod, bobber = p_bobber, bait = p_bait where account_id = v_account;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

create or replace function public.sell_fish(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  with sold as (
    delete from public.fish where account_id = v_account and id = any(coalesce(p_fish_ids, '{}'::uuid[])) returning price
  ) select count(*), coalesce(sum(price), 0) into v_count, v_sum from sold;
  if v_count = 0 then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  perform public._pay(v_account, v_sum, 'sell', v_count || ' con');
  return jsonb_build_object('sold', v_count, 'earned', v_sum, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.release_fish(p_session_token text, p_fish_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  delete from public.fish where account_id = v_account and id = p_fish_id;
  if not found then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

grant execute on function public.fishing_state(text) to anon, authenticated;
grant execute on function public.claim_daily(text) to anon, authenticated;
grant execute on function public.dig_worms(text) to anon, authenticated;
grant execute on function public.buy_item(text, text, integer) to anon, authenticated;
grant execute on function public.set_loadout(text, text, text, text) to anon, authenticated;
grant execute on function public.sell_fish(text, uuid[]) to anon, authenticated;
grant execute on function public.release_fish(text, uuid) to anon, authenticated;
-- Config reads go through the SELECT policies above; grant the privilege explicitly instead of relying on default grants.
grant select on public.fish_species, public.shop_items to anon, authenticated;
```

- [ ] **Step 2: Write the smoke test (setup + account checks)**

Create `tests/sql/v14-smoke.sql` with exactly:

```sql
-- tests/sql/v14-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0012 (see the plan).
-- Every check is an ASSERT inside a DO block; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on

create temp table smoke (k text primary key, v text);
insert into smoke select 't1', token from public.register('smoke14_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('smoke14_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('smoke14_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Ao test', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'code', code from public.rooms where id = (select v from smoke where k = 'room')::uuid;
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't2'));

-- ---------- account RPCs ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); a1 uuid := (select v from smoke where k = 'a1')::uuid;
        s jsonb; r jsonb;
begin
  s := public.fishing_state(t1);
  assert (s->>'coins')::int = 0, 'coins start at 0';
  assert s->'loadout' = '{"rod":"rod_wood","bobber":"bobber_feather","bait":"bait_worm"}'::jsonb, 'starter loadout';
  assert (s->'bait'->>'bait_worm')::int = 0 and (s->>'bait_cap')::int = 20 and (s->>'fish_cap')::int = 1, 'empty bag';
  assert (s->>'casts_left')::int = 40 and s->'window_resets_at' = 'null'::jsonb and s->'dig_ready_at' = 'null'::jsonb, 'fresh timers';

  r := public.claim_daily(t1);
  assert (r->>'claimed')::boolean and (r->'state'->>'coins')::int = 20, 'daily +20';
  r := public.claim_daily(t1);
  assert not (r->>'claimed')::boolean and (r->'state'->>'coins')::int = 20, 'daily only once';

  r := public.dig_worms(t1);
  assert (r->>'gained')::int between 1 and 3, 'dig gains 1-3';
  assert (r->'state'->'bait'->>'bait_worm')::int = (r->>'gained')::int, 'worms stored';
  assert r->'state'->>'dig_ready_at' is not null, 'cooldown shown';
  begin
    perform public.dig_worms(t1);
    raise exception 'expected dig cooldown';
  exception when others then
    assert sqlerrm = 'dig cooldown', sqlerrm;
  end;
  -- bait full: 20 worms, cooldown over
  update public.inventory set qty = 20 where account_id = a1 and item_id = 'bait_worm';
  update public.fishing_profiles set last_dig_at = now() - interval '1 minute' where account_id = a1;
  begin
    perform public.dig_worms(t1);
    raise exception 'expected bait full';
  exception when others then
    assert sqlerrm = 'bait full', sqlerrm;
  end;
  update public.inventory set qty = 5 where account_id = a1 and item_id = 'bait_worm';

  -- buying
  begin
    perform public.buy_item(t1, 'rod_bamboo', 1);
    raise exception 'expected not enough coins';
  exception when others then
    assert sqlerrm = 'not enough coins', sqlerrm;
  end;
  begin
    perform public.buy_item(t1, 'rod_wood', 1);
    raise exception 'expected item not available';
  exception when others then
    assert sqlerrm = 'item not available', sqlerrm;
  end;
  begin
    perform public.buy_item(t1, 'bait_shrimp', 0);
    raise exception 'expected invalid quantity';
  exception when others then
    assert sqlerrm = 'invalid quantity', sqlerrm;
  end;
  r := public.buy_item(t1, 'bait_shrimp', 2);
  assert (r->'state'->>'coins')::int = 10 and (r->'state'->'bait'->>'bait_shrimp')::int = 2, 'bought 2 shrimp for 10';
  assert r->'state'->'loadout'->>'bait' = 'bait_worm', 'selection kept while worms remain';
  begin
    perform public.buy_item(t1, 'bait_shrimp', 20);
    raise exception 'expected bait full';
  exception when others then
    assert sqlerrm = 'bait full', sqlerrm;
  end;

  update public.wallets set coins = 2000 where account_id = a1;
  r := public.buy_item(t1, 'rod_bamboo', 1);
  assert r->'state'->'loadout'->>'rod' = 'rod_bamboo', 'a better rod is equipped';
  assert r->'state'->'owned' ? 'rod_bamboo', 'rod owned';
  begin
    perform public.buy_item(t1, 'rod_bamboo', 1);
    raise exception 'expected already owned';
  exception when others then
    assert sqlerrm = 'already owned', sqlerrm;
  end;
  r := public.buy_item(t1, 'bucket_large', 1);
  assert (r->'state'->>'fish_cap')::int = 16, 'large bucket: 1 + 15';
  begin
    perform public.buy_item(t1, 'bucket_small', 1);
    raise exception 'expected already owned (smaller bucket)';
  exception when others then
    assert sqlerrm = 'already owned', sqlerrm;
  end;
  r := public.buy_item(t1, 'bait_box', 1);
  assert (r->'state'->>'bait_cap')::int = 60, 'bait box: 60';
  assert (r->'state'->>'coins')::int = 2000 - 300 - 800 - 250, 'paid 1350';
  assert (select count(*) from public.coin_ledger where account_id = a1) = 5, 'ledger: daily + 4 buys';
  assert (select balance from public.coin_ledger where account_id = a1 order by id desc limit 1) = 650, 'ledger balance';

  -- loadout
  r := public.set_loadout(t1, 'rod_wood', 'bobber_feather', 'bait_shrimp');
  assert r->'state'->'loadout' = '{"rod":"rod_wood","bobber":"bobber_feather","bait":"bait_shrimp"}'::jsonb, 'loadout set';
  begin
    perform public.set_loadout(t1, 'rod_carbon', 'bobber_feather', 'bait_worm');
    raise exception 'expected item not available (not owned)';
  exception when others then
    assert sqlerrm = 'item not available', sqlerrm;
  end;
  begin
    perform public.set_loadout(t1, 'bobber_foam', 'bobber_feather', 'bait_worm');
    raise exception 'expected item not available (wrong kind)';
  exception when others then
    assert sqlerrm = 'item not available', sqlerrm;
  end;
end $$;

select 'v14 account smoke ok' as result;
```

- [ ] **Step 3: Replay the migrations twice on a throwaway PostgreSQL 18 cluster and run the smoke test**

PostgreSQL 18 is installed at `C:\Program Files\PostgreSQL\18` — do not touch its service. Use Git Bash from the repo root; `$SCRATCH` = the session scratchpad directory.

```bash
export PGCLIENTENCODING=UTF8
PG="/c/Program Files/PostgreSQL/18/bin"; D="$SCRATCH/pg-v14"
rm -rf "$D"; "$PG/initdb" -D "$D" -U postgres --auth=trust -E UTF8 >/dev/null
"$PG/pg_ctl" -D "$D" -o "-p 5499" -l "$D/log.txt" start
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -c "create schema extensions; create role anon nologin; create role authenticated nologin; create publication supabase_realtime;"
for f in supabase/migrations/00{04,05,06,07,08,09,10,11,12}_*.sql; do "$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "FAILED $f"; break; }; done
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/migrations/0012_v14_fishing.sql >/dev/null && echo "0012 re-run ok"
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f tests/sql/v14-smoke.sql
"$PG/pg_ctl" -D "$D" stop; rm -rf "$D"
```

Expected: no `FAILED` line (a `WARNING: "wal_level" is insufficient` line from `create publication` is fine), `0012 re-run ok`, and the smoke test ends with a row `v14 account smoke ok`. Any failed `ASSERT` stops psql with its message.

- [ ] **Step 4: Write the integration test (runs only with `SUPABASE_TEST_URL`)**

Create `tests/integration/v14.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v14 fishing economy", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("fi"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };

  it("starts empty and claims the daily bonus once", async () => {
    const me = await reg();
    const s = await db.rpc("fishing_state", { p_session_token: me.token });
    expect(s.error).toBeNull();
    expect(s.data).toMatchObject({ coins: 0, bait_cap: 20, fish_cap: 1, casts_left: 40, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" } });
    const a = await db.rpc("claim_daily", { p_session_token: me.token });
    expect(a.data).toMatchObject({ claimed: true, amount: 20, state: { coins: 20 } });
    const b = await db.rpc("claim_daily", { p_session_token: me.token });
    expect(b.data).toMatchObject({ claimed: false, state: { coins: 20 } });
  });

  it("digs 1–3 worms, then has to wait", async () => {
    const me = await reg();
    const a = await db.rpc("dig_worms", { p_session_token: me.token });
    expect(a.error).toBeNull();
    expect((a.data as { gained: number }).gained).toBeGreaterThanOrEqual(1);
    const b = await db.rpc("dig_worms", { p_session_token: me.token });
    expect(b.error?.message).toBe("dig cooldown");
    expect(Number(b.error?.details)).toBeGreaterThan(0);
  });

  it("refuses what it cannot afford or does not sell, and sells bait", async () => {
    const me = await reg();
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "rod_bamboo", p_qty: 1 })).error?.message).toBe("not enough coins");
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "rod_wood", p_qty: 1 })).error?.message).toBe("item not available");
    await db.rpc("claim_daily", { p_session_token: me.token });
    const ok = await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "bait_shrimp", p_qty: 4 });
    expect(ok.data).toMatchObject({ state: { coins: 0, bait: { bait_shrimp: 4 } } });
  });

  it("only equips gear the account owns", async () => {
    const me = await reg();
    const r = await db.rpc("set_loadout", { p_session_token: me.token, p_rod: "rod_carbon", p_bobber: "bobber_feather", p_bait: "bait_worm" });
    expect(r.error?.message).toBe("item not available");
  });

  it("cannot sell or release fish it does not have", async () => {
    const me = await reg();
    const id = crypto.randomUUID();
    expect((await db.rpc("sell_fish", { p_session_token: me.token, p_fish_ids: [id] })).error?.message).toBe("fish not found");
    expect((await db.rpc("release_fish", { p_session_token: me.token, p_fish_id: id })).error?.message).toBe("fish not found");
  });

  it("lets anyone read the catalog but nobody read wallets directly", async () => {
    const { data: species } = await db.from("fish_species").select("id");
    const { data: items } = await db.from("shop_items").select("id");
    expect(species ?? []).toHaveLength(12);
    expect(items ?? []).toHaveLength(12);
    const wallets = await db.from("wallets").select("*");
    expect(wallets.error !== null || (wallets.data ?? []).length === 0).toBe(true);
  });
});
```

- [ ] **Step 5: Run the unit suite (integration tests skip without the env)**

Run: `pnpm vitest run tests/integration/v14.test.ts`
Expected: the file is collected and its tests are **skipped** (no `SUPABASE_TEST_URL`), no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0012_v14_fishing.sql tests/sql/v14-smoke.sql tests/integration/v14.test.ts
git commit -m "feat(v14): fishing economy tables, seeds and account RPCs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Database — casts, catches, the fishing board and the song bonus

**Files:**
- Modify: `supabase/migrations/0012_v14_fishing.sql` (append sections E–F at the end)
- Modify: `tests/sql/v14-smoke.sql` (replace its last line, `select 'v14 account smoke ok' as result;`, with the block below)
- Modify: `tests/integration/v14.test.ts` (append cases inside the `run(...)` block)

**Interfaces:**
- Consumes: everything from Task 2.
- Produces (Postgres): table `casts` (one open cast per account), column `rooms.item_began_at`; helpers `_roll_rarity(text,text) → smallint`, `_weight_text(int) → text`; RPCs `start_cast(uuid,text)`, `finish_cast(text,uuid,boolean)`, `fishing_board(uuid,text)`; triggers `rooms_item_clock` (before update of `current_item_id`) and `rooms_song_bonus` (after update). Answers:
  - `start_cast` → `{ cast_id, bite_ms, window_ms, difficulty, min_reel_ms, zone_pct, rarity (null unless the bobber shows it), bait_switched, state }`
  - `finish_cast` → `{ result: "caught", fish: { id, species_id, weight_g, price, rarity }, record, state }` or `{ result: "lost", why: "expired" | "gave_up" | "too_early" | "full", state }`
  - `fishing_board` → `{ records: [{ species_id, username, weight_g }], mine: [{ species_id, weight_g }], richest: [{ username, coins }], my_rank, my_coins }`
  - rare+ catches insert a chat message `username 'Ao cá'`, `account_id null`, body `[catch:<account>|<species>|<grams>] 🎣 <name> vừa câu được <Species> <weight> (<Rarity>)!`

- [ ] **Step 1: Append sections E–F to the migration**

Append to the end of `supabase/migrations/0012_v14_fishing.sql` exactly:

```sql
-- ---------- E. Casts (at most one open cast per account; private) ----------
create table if not exists public.casts (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  species_id text not null references public.fish_species(id),
  weight_g integer not null,
  min_reel_ms integer not null,
  bite_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.casts enable row level security;
revoke all on public.casts from anon, authenticated;

-- Rarity 1–5 for a rod + bait (spec §7.2): Khá fixed at 28 %, Thường takes the rest.
create or replace function public._roll_rarity(p_rod text, p_bait text) returns smallint
language plpgsql volatile security definer set search_path = public, extensions
as $$
declare r public.shop_items; b public.shop_items; w3 double precision; w4 double precision; w5 double precision; v_roll double precision;
begin
  select * into r from public.shop_items where id = p_rod;
  select * into b from public.shop_items where id = p_bait;
  w5 := 0.3 * coalesce(b.mult_legend, 1) * coalesce(r.rare_mult, 1);
  w4 := 2.7 * coalesce(b.mult_quy, 1) * coalesce(r.rare_mult, 1);
  w3 := 9 * coalesce(b.mult_hiem, 1) * coalesce(r.rare_mult, 1);
  v_roll := random() * 100;
  if v_roll < w5 then return 5; end if;
  if v_roll < w5 + w4 then return 4; end if;
  if v_roll < w5 + w4 + w3 then return 3; end if;
  if v_roll < w5 + w4 + w3 + 28 then return 2; end if;
  return 1;
end; $$;

-- "350 g" under 1 kg, else tenths rounded half up with a Vietnamese decimal comma: 1150 → "1,2 kg" (same rule as formatWeight).
create or replace function public._weight_text(p_g integer) returns text
language sql immutable set search_path = public, extensions
as $$
  select case when p_g < 1000 then p_g || ' g'
              else (round(p_g / 100.0)::int / 10) || ',' || (round(p_g / 100.0)::int % 10) || ' kg' end
$$;

revoke all on function public._roll_rarity(text, text) from public, anon, authenticated;
revoke all on function public._weight_text(integer) from public, anon, authenticated;

create or replace function public.start_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  -- 1. hourly cap: a new window starts at the first cast after the previous one ended
  if p.window_start is null or now() >= p.window_start + interval '1 hour' then
    update public.fishing_profiles set window_start = now(), window_casts = 0 where account_id = v_account;
    p.window_start := now();
    p.window_casts := 0;
  end if;
  if p.window_casts >= 40 then
    raise exception 'cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from (p.window_start + interval '1 hour' - now())))::int::text;
  end if;
  -- 2. a new cast abandons the previous one (its bait is already spent)
  delete from public.casts where account_id = v_account;
  -- 3. room for the catch
  v_bucket := public._bucket_cap(v_account);
  if (select count(*) from public.fish where account_id = v_account) >= 1 + v_bucket then
    if v_bucket = 0 then
      raise exception 'hands full' using errcode = '22023';
    end if;
    raise exception 'bucket full' using errcode = '22023';
  end if;
  -- 4. one bait: the selected kind, else worms
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = p.bait), 0) < 1 then
    if p.bait <> 'bait_worm'
       and coalesce((select qty from public.inventory where account_id = v_account and item_id = 'bait_worm'), 0) >= 1 then
      update public.fishing_profiles set bait = 'bait_worm' where account_id = v_account;
      p.bait := 'bait_worm';
      v_switched := true;
    else
      raise exception 'no bait' using errcode = '22023';
    end if;
  end if;
  update public.inventory set qty = qty - 1 where account_id = v_account and item_id = p.bait;
  -- 5. roll the fish (spec §7.2)
  select * into rod from public.shop_items where id = p.rod;
  select * into bob from public.shop_items where id = p.bobber;
  v_rarity := public._roll_rarity(p.rod, p.bait);
  select * into sp from public.fish_species where rarity = v_rarity order by random() limit 1;
  v_weight := least(sp.max_g, sp.min_g + floor((sp.max_g - sp.min_g + 1) * power(random(), coalesce(rod.weight_k, 2.0)))::int);
  v_bite := coalesce(bob.bite_min_ms, 3000)
            + floor(random() * (coalesce(bob.bite_max_ms, 10000) - coalesce(bob.bite_min_ms, 3000) + 1))::int;
  v_window := coalesce(bob.window_ms, 1500);
  v_min_reel := 2000 + 40 * sp.difficulty;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (v_account, p_room_id, sp.id, v_weight, v_min_reel,
          now() + make_interval(secs => v_bite / 1000.0),
          now() + make_interval(secs => (v_bite + v_window) / 1000.0 + 90))
  returning id into v_id;
  update public.fishing_profiles set window_casts = window_casts + 1 where account_id = v_account;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'state', public._fishing_state(v_account));
end; $$;

create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
  elsif now() < c.bite_at + make_interval(secs => 0.9 * c.min_reel_ms / 1000.0) then
    v_why := 'too_early';
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'state', public._fishing_state(v_account));
  end if;
  select * into sp from public.fish_species where id = c.species_id;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0)::int);
  insert into public.fish (account_id, species_id, weight_g, price) values (v_account, sp.id, c.weight_g, v_price)
  returning id into v_fish;
  select weight_g into v_prev from public.personal_bests where account_id = v_account and species_id = sp.id;
  if v_prev is null or c.weight_g > v_prev then
    v_record := true;
    insert into public.personal_bests (account_id, species_id, weight_g, caught_at)
    values (v_account, sp.id, c.weight_g, now())
    on conflict (account_id, species_id) do update set weight_g = excluded.weight_g, caught_at = excluded.caught_at;
  end if;
  -- rare+ catches are announced in the room's chat (spec §8.5)
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]));
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'state', public._fishing_state(v_account));
end; $$;

-- Records per species and the richest members — among the members of the room only.
create or replace function public.fishing_board(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_coins integer; v_rank integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  v_coins := coalesce((select coins from public.wallets where account_id = v_account), 0);
  select 1 + count(*) into v_rank
    from public.members m join public.wallets w on w.account_id = m.account_id
   where m.room_id = p_room_id and w.coins > v_coins;
  return jsonb_build_object(
    'records', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', r.species_id, 'username', r.username, 'weight_g', r.weight_g)
                       order by r.species_id)
        from (select distinct on (pb.species_id) pb.species_id, a.username, pb.weight_g
                from public.personal_bests pb
                join public.members m on m.account_id = pb.account_id and m.room_id = p_room_id
                join public.accounts a on a.id = pb.account_id
               order by pb.species_id, pb.weight_g desc, pb.caught_at asc) r), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', species_id, 'weight_g', weight_g) order by species_id)
        from public.personal_bests where account_id = v_account), '[]'::jsonb),
    'richest', coalesce((
      select jsonb_agg(jsonb_build_object('username', t.username, 'coins', t.coins) order by t.coins desc, t.username)
        from (select a.username, w.coins
                from public.members m
                join public.wallets w on w.account_id = m.account_id
                join public.accounts a on a.id = m.account_id
               where m.room_id = p_room_id and w.coins > 0
               order by w.coins desc, a.username
               limit 10) t), '[]'::jsonb),
    'my_rank', v_rank,
    'my_coins', v_coins);
end; $$;

grant execute on function public.start_cast(uuid, text) to anon, authenticated;
grant execute on function public.finish_cast(text, uuid, boolean) to anon, authenticated;
grant execute on function public.fishing_board(uuid, text) to anon, authenticated;

-- ---------- F. Song bonus: +10 xu to whoever queued a song that stayed on for ≥ 75 % of its length (spec §8.4) ----------
alter table public.rooms add column if not exists item_began_at timestamptz;

create or replace function public._item_clock() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if new.current_item_id is distinct from old.current_item_id then
    new.item_began_at := case when new.current_item_id is null then null else now() end;
  end if;
  return new;
end; $$;
drop trigger if exists rooms_item_clock on public.rooms;
create trigger rooms_item_clock before update of current_item_id on public.rooms
  for each row execute function public._item_clock();

-- advance_queue clears current_item_id before it deletes the old queue row, so the row is still readable here.
-- Never raises: advance_queue must not fail because of a bonus.
create or replace function public._song_bonus() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare q public.queue_items; w public.wallets; v_today date;
begin
  begin
    select * into q from public.queue_items where id = old.current_item_id;
    if not found or q.added_by_account_id is null or coalesce(q.duration_seconds, 0) < 60
       or old.item_began_at is null
       or extract(epoch from (now() - old.item_began_at)) < 0.75 * q.duration_seconds then
      return null;
    end if;
    v_today := public._vn_today();
    w := public._wallet_lock(q.added_by_account_id);
    if w.bonus_on is distinct from v_today then
      update public.wallets set bonus_on = v_today, bonus_count = 0 where account_id = q.added_by_account_id;
      w.bonus_count := 0;
    end if;
    if w.bonus_count >= 10 then
      return null;
    end if;
    update public.wallets set bonus_count = bonus_count + 1 where account_id = q.added_by_account_id;
    perform public._pay(q.added_by_account_id, 10, 'song', left(q.title, 80));
  exception when others then
    raise warning 'song bonus skipped: %', sqlerrm;
  end;
  return null;
end; $$;
drop trigger if exists rooms_song_bonus on public.rooms;
create trigger rooms_song_bonus after update of current_item_id on public.rooms
  for each row when (old.current_item_id is not null and old.current_item_id is distinct from new.current_item_id)
  execute function public._song_bonus();

revoke all on function public._item_clock() from public, anon, authenticated;
revoke all on function public._song_bonus() from public, anon, authenticated;
```

- [ ] **Step 2: Extend the smoke test**

In `tests/sql/v14-smoke.sql` delete the final line `select 'v14 account smoke ok' as result;` and append exactly:

```sql
-- ---------- casts ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        t3 text := (select v from smoke where k = 't3');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        c jsonb; f jsonb; before_casts int; fish_id uuid; v_msgs int;
begin
  begin
    perform public.start_cast(room, t3);
    raise exception 'expected not a member';
  exception when others then
    assert sqlerrm <> 'expected not a member', 'non-members cannot cast';
  end;

  -- shrimp selected (2 left): cast, give up
  c := public.start_cast(room, t1);
  assert (c->>'bite_ms')::int between 3000 and 10000 and (c->>'window_ms')::int = 1500, 'feather bobber timings';
  assert (c->>'zone_pct')::int = 25 and c->'rarity' = 'null'::jsonb, 'wooden rod, rarity hidden';
  assert (c->>'min_reel_ms')::int = 2000 + 40 * (c->>'difficulty')::int, 'min reel from difficulty';
  assert (c->'state'->'bait'->>'bait_shrimp')::int = 1 and not (c->>'bait_switched')::boolean, 'one shrimp used';
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, false);
  assert f->>'result' = 'lost' and f->>'why' = 'gave_up', 'gave up';
  begin
    perform public.finish_cast(t1, (c->>'cast_id')::uuid, true);
    raise exception 'expected cast not found';
  exception when others then
    assert sqlerrm = 'cast not found', sqlerrm;
  end;

  -- a success reported before the reel could have finished is lost
  c := public.start_cast(room, t1);
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, true);
  assert f->>'why' = 'too_early', 'time gate';

  -- shrimp gone → falls back to worms
  c := public.start_cast(room, t1);
  assert (c->>'bait_switched')::boolean and c->'state'->'loadout'->>'bait' = 'bait_worm', 'worm fallback';
  -- a new cast abandons the open one
  perform public.start_cast(room, t1);
  assert (select count(*) from public.casts where account_id = a1) = 1, 'one open cast';
  begin
    perform public.finish_cast(t1, (c->>'cast_id')::uuid, true);
    raise exception 'expected cast not found (abandoned)';
  exception when others then
    assert sqlerrm = 'cast not found', sqlerrm;
  end;

  -- a caught fish (the reel time has passed)
  c := public.start_cast(room, t1);
  update public.casts set species_id = 'ca_tra', weight_g = 3150, bite_at = now() - interval '20 seconds',
                          expires_at = now() + interval '60 seconds' where account_id = a1;
  select count(*) into v_msgs from public.chat_messages where room_id = room;
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, true);
  assert f->>'result' = 'caught' and f->'fish'->>'species_id' = 'ca_tra', 'caught';
  assert (f->'fish'->>'price')::int = 221 and (f->'fish'->>'rarity')::int = 3, 'price 70 xu/kg × 3.15 kg';
  assert (f->>'record')::boolean, 'first catch is a personal best';
  assert jsonb_array_length(f->'state'->'fish') = 1, 'fish held';
  assert (select count(*) from public.chat_messages where room_id = room) = v_msgs + 1, 'announced';
  assert (select body from public.chat_messages where room_id = room order by created_at desc limit 1)
         like '[catch:' || a1::text || '|ca_tra|3150] 🎣 % vừa câu được Cá tra 3,2 kg (Hiếm)!', 'announcement text';
  assert (select account_id is null and username = 'Ao cá' from public.chat_messages where room_id = room order by created_at desc limit 1),
         'announcement author';

  -- expired
  c := public.start_cast(room, t1);
  update public.casts set expires_at = now() - interval '1 second' where account_id = a1;
  f := public.finish_cast(t1, (c->>'cast_id')::uuid, true);
  assert f->>'why' = 'expired', 'expired';

  -- hands full (bucket removed), then the hourly cap
  delete from public.inventory where account_id = a1 and item_id = 'bucket_large';
  begin
    perform public.start_cast(room, t1);
    raise exception 'expected hands full';
  exception when others then
    assert sqlerrm = 'hands full', sqlerrm;
  end;
  fish_id := (select id from public.fish where account_id = a1 limit 1);
  update public.fishing_profiles set window_casts = 40 where account_id = a1;
  begin
    perform public.start_cast(room, t1);
    raise exception 'expected cast limit';
  exception when others then
    assert sqlerrm = 'cast limit', sqlerrm;
  end;
  update public.fishing_profiles set window_start = now() - interval '61 minutes' where account_id = a1;
  f := public.release_fish(t1, fish_id);
  assert jsonb_array_length(f->'state'->'fish') = 0, 'released';
  c := public.start_cast(room, t1);
  assert (c->'state'->>'casts_left')::int = 39, 'a new hourly window';
  perform public.finish_cast(t1, (c->>'cast_id')::uuid, false);

  -- selling
  insert into public.fish (account_id, species_id, weight_g, price) values (a1, 'ca_ro', 200, 9), (a1, 'ca_loc', 1000, 60);
  before_casts := (select coins from public.wallets where account_id = a1);
  begin
    perform public.sell_fish(t2, array(select id from public.fish where account_id = a1));
    raise exception 'expected fish not found';
  exception when others then
    assert sqlerrm = 'fish not found', sqlerrm;
  end;
  f := public.sell_fish(t1, array(select id from public.fish where account_id = a1));
  assert (f->>'sold')::int = 2 and (f->>'earned')::int = 69, 'sold 2 for 69';
  assert (f->'state'->>'coins')::int = before_casts + 69, 'coins added';
  begin
    perform public.release_fish(t1, gen_random_uuid());
    raise exception 'expected fish not found';
  exception when others then
    assert sqlerrm = 'fish not found', sqlerrm;
  end;
end $$;

-- ---------- board ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); room uuid := (select v from smoke where k = 'room')::uuid;
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        b jsonb;
begin
  insert into public.personal_bests (account_id, species_id, weight_g) values (a2, 'ca_tra', 5000), (a3, 'ca_tra', 5900);
  insert into public.wallets (account_id, coins) values (a2, 99999), (a3, 500000)
  on conflict (account_id) do update set coins = excluded.coins;
  b := public.fishing_board(room, t1);
  assert (select r->>'username' from jsonb_array_elements(b->'records') r where r->>'species_id' = 'ca_tra')
         = (select username from public.accounts where id = a2), 'room record holder (a non-member is ignored)';
  assert jsonb_array_length(b->'richest') = 2 and (b->'richest'->0->>'coins')::int = 99999, 'richest = members only';
  assert (b->>'my_rank')::int = 2, 'my rank';
  assert jsonb_array_length(b->'mine') = 1, 'my bests';
end $$;

-- ---------- song bonus ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        coins0 int;
begin
  update public.wallets set coins = 0, bonus_on = null, bonus_count = 0 where account_id = a2;
  perform public.add_queue_item(room, t2, 'vid1', 'Song one', null, 240);
  perform public.add_queue_item(room, t2, 'vid2', 'Song two', null, 240);
  perform public.add_queue_item(room, t2, 'vid3', 'Song three', null, 240);
  perform public.add_queue_item(room, t2, 'vid4', 'Short', null, 30);
  perform public.add_queue_item(room, t2, 'vid5', 'Song five', null, 240);
  perform public.advance_queue(room, t1);                                           -- Song one starts
  assert (select item_began_at is not null from public.rooms where id = room), 'item clock set';
  update public.rooms set item_began_at = now() - interval '1 minute' where id = room;
  perform public.advance_queue(room, t1);                                           -- skipped at 25 % → nothing
  assert (select coins from public.wallets where account_id = a2) = 0, 'no bonus for a skip';
  update public.rooms set item_began_at = now() - interval '3 minutes 30 seconds' where id = room;
  perform public.advance_queue(room, t1);                                           -- Song two played → +10
  assert (select coins from public.wallets where account_id = a2) = 10, 'song bonus +10';
  assert (select reason = 'song' and ref = 'Song two' from public.coin_ledger where account_id = a2 order by id desc limit 1), 'ledger';
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  update public.wallets set bonus_count = 10 where account_id = a2;
  perform public.advance_queue(room, t1);                                           -- Song three: daily cap reached
  assert (select coins from public.wallets where account_id = a2) = 10, 'cap of 10 bonuses per day';
  update public.wallets set bonus_count = 0 where account_id = a2;
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  perform public.advance_queue(room, t1);                                           -- Short (30 s) → nothing
  assert (select coins from public.wallets where account_id = a2) = 10, 'short songs never pay';
  assert (select current_item_id is not null from public.rooms where id = room), 'advance_queue still works';
end $$;

-- ---------- odds (worms + wooden rod): Thường 60 · Khá 28 · Hiếm 9 · Quý 2.7 · Huyền thoại 0.3 ----------
do $$
declare n int := 20000; c1 int; c2 int; c5 int;
begin
  create temp table rolls as select public._roll_rarity('rod_wood', 'bait_worm') as r from generate_series(1, n);
  select count(*) filter (where r = 1), count(*) filter (where r = 2), count(*) filter (where r = 5) into c1, c2, c5 from rolls;
  assert abs(c1 * 100.0 / n - 60) < 1.5, format('Thường %s%%', c1 * 100.0 / n);
  assert abs(c2 * 100.0 / n - 28) < 1.5, format('Khá %s%%', c2 * 100.0 / n);
  assert c5 * 100.0 / n < 1, format('Huyền thoại %s%%', c5 * 100.0 / n);
  drop table rolls;
end $$;

select 'v14 smoke ok' as result;
```

- [ ] **Step 3: Replay twice and run the smoke test**

Run the same commands as Task 2 Step 3 (fresh cluster, `export PGCLIENTENCODING=UTF8`).
Expected: no `FAILED`, `0012 re-run ok`, and the smoke test ends with `v14 smoke ok`.

- [ ] **Step 4: Extend the integration test**

Append inside the `run("v14 fishing economy", () => { … })` block of `tests/integration/v14.test.ts`:

```ts
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("ao"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };
  const withWorms = async (token: string) => {
    const d = await db.rpc("dig_worms", { p_session_token: token });
    if (d.error) throw d.error;
  };

  it("casts, gives up, and never lets a cast be finished twice", async () => {
    const me = await reg();
    const r = await room(me.token);
    await withWorms(me.token);
    const c = await db.rpc("start_cast", { p_room_id: r.room_id, p_session_token: me.token });
    expect(c.error).toBeNull();
    const cast = c.data as { cast_id: string; bite_ms: number; window_ms: number; zone_pct: number; rarity: number | null };
    expect(cast.bite_ms).toBeGreaterThanOrEqual(3000);
    expect(cast).toMatchObject({ window_ms: 1500, zone_pct: 25, rarity: null });
    const f = await db.rpc("finish_cast", { p_session_token: me.token, p_cast_id: cast.cast_id, p_success: false });
    expect(f.data).toMatchObject({ result: "lost", why: "gave_up" });
    const again = await db.rpc("finish_cast", { p_session_token: me.token, p_cast_id: cast.cast_id, p_success: true });
    expect(again.error?.message).toBe("cast not found");
  });

  it("does not accept a catch before the reel could have finished", async () => {
    const me = await reg();
    const r = await room(me.token);
    await withWorms(me.token);
    const c = await db.rpc("start_cast", { p_room_id: r.room_id, p_session_token: me.token });
    const f = await db.rpc("finish_cast", { p_session_token: me.token, p_cast_id: (c.data as { cast_id: string }).cast_id, p_success: true });
    expect(f.data).toMatchObject({ result: "lost", why: "too_early" });
  });

  it("needs bait and room membership to cast", async () => {
    const me = await reg();
    const other = await reg();
    const r = await room(me.token);
    expect((await db.rpc("start_cast", { p_room_id: r.room_id, p_session_token: me.token })).error?.message).toBe("no bait");
    expect((await db.rpc("start_cast", { p_room_id: r.room_id, p_session_token: other.token })).error?.message).toMatch(/not a member/);
  });

  it("returns the room board", async () => {
    const me = await reg();
    const r = await room(me.token);
    const b = await db.rpc("fishing_board", { p_room_id: r.room_id, p_session_token: me.token });
    expect(b.error).toBeNull();
    expect(b.data).toMatchObject({ records: [], mine: [], richest: [], my_rank: 1, my_coins: 0 });
  });
```

- [ ] **Step 5: Run and commit**

Run: `pnpm vitest run tests/integration/v14.test.ts` → collected and skipped, no errors.

```bash
git add supabase/migrations/0012_v14_fishing.sql tests/sql/v14-smoke.sql tests/integration/v14.test.ts
git commit -m "feat(v14): casts, catches, room fishing board and the song bonus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fishing client data layer — catalog, state, announcements, RPC wrappers

**Files:**
- Create: `lib/game/fishing/catalog.ts`, `lib/game/fishing/state.ts`, `lib/game/fishing/announce.ts`, `lib/game/fishing/rpc.ts`
- Test: `tests/unit/fishing-catalog.test.ts`, `tests/unit/fishing-state.test.ts`, `tests/unit/fishing-announce.test.ts`, `tests/unit/fishing-rpc.test.ts`

**Interfaces:**
- Consumes: the RPC answers of Tasks 2–3 (snake_case JSON).
- Produces:
  - `catalog.ts` (pure): `type Rarity = 1|2|3|4|5`, `isRarity(v)`, `RARITY_NAME`, `RARITY_COLOR`, `FishSpecies`, `ShopKind`, `ShopItem`, `FishingCatalog { species; items }`, `SpeciesRow`, `ShopItemRow`, `speciesFromRow`, `shopItemFromRow`, `formatWeight(g)`, `formatXu(n)`, `describeItem(item)`.
  - `state.ts` (pure): `FishRow`, `Loadout`, `FishingState`, `CastBlocker`, `parseFishingState(json)`, `handFish(s)`, `baitTotal(s)`, `baitCount(s, id)`, `ownsItem(s, item)`, `castBlocker(s, now)`, `maxBuyQty(s, item)`, `digWaitSec(s, now)`, `castWaitMin(s, now)`.
  - `announce.ts` (pure): `ANNOUNCER_NAME = "Ao cá"`, `CatchAnnouncement`, `parseCatchAnnouncement(msg)`, `freshAnnouncements(messages, shown, now, maxAgeMs?)`.
  - `rpc.ts` (Supabase): `fetchFishingCatalog()`, `fetchFishingState(token)`, `claimDaily(token)`, `digWorms(token)`, `buyItem(token, itemId, qty)`, `setLoadout(token, loadout)`, `startCast(roomId, token): Promise<StartCast>`, `finishCast(token, castId, success): Promise<FinishCast>`, `sellFish(token, ids)`, `releaseFish(token, id)`, `fetchFishingBoard(roomId, token): Promise<FishingBoard>`, `fishingErrorMessage(err)`; types `StartCast`, `CaughtFish`, `LostWhy`, `FinishCast`, `FishingBoard`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/fishing-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  describeItem, formatWeight, formatXu, RARITY_COLOR, RARITY_NAME, shopItemFromRow, speciesFromRow, type ShopItem,
} from "@/lib/game/fishing/catalog";

const item = (over: Partial<ShopItem>): ShopItem => ({
  id: "x", kind: "rod", name: "x", price: 1, starter: false, sortOrder: 0, zonePct: null, weightK: null, rareMult: 1,
  windowMs: null, biteMinMs: null, biteMaxMs: null, showsRarity: false, multHiem: 1, multQuy: 1, multLegend: 1, capacity: null,
  ...over,
});

describe("formatWeight", () => {
  it("shows grams under 1 kg and tenths of a kg above, rounded half up (same rule as SQL _weight_text)", () => {
    expect(formatWeight(350)).toBe("350 g");
    expect(formatWeight(999)).toBe("999 g");
    expect(formatWeight(1000)).toBe("1,0 kg");
    expect(formatWeight(1150)).toBe("1,2 kg");
    expect(formatWeight(3150)).toBe("3,2 kg");
    expect(formatWeight(12_000)).toBe("12,0 kg");
    expect(formatWeight(39_960)).toBe("40,0 kg");
  });
});

describe("formatXu", () => {
  it("groups thousands the Vietnamese way", () => {
    expect(formatXu(0)).toBe("0 xu");
    expect(formatXu(1230)).toBe("1.230 xu");
    expect(formatXu(1_500_000)).toBe("1.500.000 xu");
  });
});

describe("rarity names and colours", () => {
  it("covers the five rarities", () => {
    expect(Object.values(RARITY_NAME)).toEqual(["Thường", "Khá", "Hiếm", "Quý", "Huyền thoại"]);
    expect(Object.keys(RARITY_COLOR)).toEqual(["1", "2", "3", "4", "5"]);
  });
});

describe("describeItem", () => {
  it("describes rods", () => {
    expect(describeItem(item({ kind: "rod", zonePct: 25, weightK: 2 }))).toBe("Vùng giữ cá 25%");
    expect(describeItem(item({ kind: "rod", zonePct: 30, weightK: 1.5 }))).toBe("Vùng giữ cá 30% · cá nặng hơn");
    // real (float4) columns arrive with noise: 1.2 → 1.2000000476837158
    expect(describeItem(item({ kind: "rod", zonePct: 36, weightK: 1.5, rareMult: 1.2000000476837158 })))
      .toBe("Vùng giữ cá 36% · cá nặng hơn · cá hiếm +20%");
  });
  it("describes bobbers", () => {
    expect(describeItem(item({ kind: "bobber", windowMs: 1500, biteMaxMs: 10000 }))).toBe("Giật cần trong 1,5 giây");
    expect(describeItem(item({ kind: "bobber", windowMs: 2000, biteMaxMs: 10000, showsRarity: true })))
      .toBe("Giật cần trong 2 giây · báo độ hiếm");
    expect(describeItem(item({ kind: "bobber", windowMs: 2500, biteMaxMs: 7000, showsRarity: true })))
      .toBe("Giật cần trong 2,5 giây · cá cắn nhanh hơn · báo độ hiếm");
  });
  it("describes bait, the bait box and buckets", () => {
    expect(describeItem(item({ kind: "bait" }))).toBe("Mồi thường — đào ở bãi trùn");
    expect(describeItem(item({ kind: "bait", multHiem: 1.5, multQuy: 1.5, multLegend: 1.5 }))).toBe("Cá hiếm trở lên ×1,5");
    expect(describeItem(item({ kind: "bait", multHiem: 2, multQuy: 2, multLegend: 3 }))).toBe("Cá hiếm ×2, huyền thoại ×3");
    expect(describeItem(item({ kind: "bait_box", capacity: 60 }))).toBe("Chứa 60 mồi");
    expect(describeItem(item({ kind: "bucket", capacity: 5 }))).toBe("Đựng 5 con cá");
  });
});

describe("row mapping", () => {
  it("camelCases species rows and keeps an unknown rarity safe", () => {
    expect(speciesFromRow({ id: "ca_ro", name: "Cá rô đồng", rarity: 1, min_g: 50, max_g: 300, price_per_kg: 45, difficulty: 15, sort_order: 10 }))
      .toEqual({ id: "ca_ro", name: "Cá rô đồng", rarity: 1, minG: 50, maxG: 300, pricePerKg: 45, difficulty: 15, sortOrder: 10 });
    expect(speciesFromRow({ id: "x", name: "x", rarity: 9, min_g: 1, max_g: 1, price_per_kg: 1, difficulty: 1, sort_order: 0 }).rarity).toBe(1);
  });
  it("camelCases shop rows", () => {
    expect(shopItemFromRow({
      id: "bobber_lamp", kind: "bobber", name: "Phao đèn", price: 800, starter: false, sort_order: 30, zone_pct: null,
      weight_k: null, rare_mult: 1, window_ms: 2500, bite_min_ms: 2000, bite_max_ms: 7000, shows_rarity: true,
      mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
    })).toMatchObject({ id: "bobber_lamp", kind: "bobber", price: 800, windowMs: 2500, biteMinMs: 2000, biteMaxMs: 7000, showsRarity: true });
  });
});
```

`tests/unit/fishing-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ShopItem } from "@/lib/game/fishing/catalog";
import {
  baitTotal, castBlocker, castWaitMin, digWaitSec, handFish, maxBuyQty, ownsItem, parseFishingState, type FishingState,
} from "@/lib/game/fishing/state";

const RAW = {
  coins: 120, daily_claimed: true,
  loadout: { rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_shrimp" },
  owned: ["rod_bamboo", "bucket_small"],
  bait: { bait_worm: 3, bait_shrimp: 1, bait_bloodworm: 0 },
  bait_cap: 20,
  fish: [
    { id: "f1", species_id: "ca_loc", weight_g: 1200, price: 72, caught_at: "2026-09-24T10:00:00Z" },
    { id: "f2", species_id: "ca_ro", weight_g: 150, price: 7, caught_at: "2026-09-24T10:05:00Z" },
  ],
  fish_cap: 6, casts_left: 37, window_resets_at: "2026-09-24T11:00:00Z", dig_ready_at: null,
};
const S = parseFishingState(RAW)!;
const withS = (over: Partial<FishingState>): FishingState => ({ ...S, ...over });
const item = (over: Partial<ShopItem>): ShopItem => ({
  id: "x", kind: "rod", name: "x", price: 1, starter: false, sortOrder: 0, zonePct: null, weightK: null, rareMult: 1,
  windowMs: null, biteMinMs: null, biteMaxMs: null, showsRarity: false, multHiem: 1, multQuy: 1, multLegend: 1, capacity: null,
  ...over,
});
const NOW = Date.parse("2026-09-24T10:30:00Z");

describe("parseFishingState", () => {
  it("camelCases the RPC state", () => {
    expect(S).toMatchObject({
      coins: 120, dailyClaimed: true, loadout: { rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_shrimp" },
      owned: ["rod_bamboo", "bucket_small"], baitCap: 20, fishCap: 6, castsLeft: 37,
      windowResetsAt: "2026-09-24T11:00:00Z", digReadyAt: null,
    });
    expect(S.fish[0]).toEqual({ id: "f1", speciesId: "ca_loc", weightG: 1200, price: 72, caughtAt: "2026-09-24T10:00:00Z" });
  });
  it("rejects non-objects and fills defaults", () => {
    expect(parseFishingState(null)).toBeNull();
    expect(parseFishingState("x")).toBeNull();
    expect(parseFishingState({})).toMatchObject({
      coins: 0, dailyClaimed: false, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" },
      owned: [], bait: {}, baitCap: 20, fish: [], fishCap: 1, castsLeft: 40, windowResetsAt: null, digReadyAt: null,
    });
  });
});

describe("hand, bait and ownership", () => {
  it("puts the oldest fish in hand and counts all bait", () => {
    expect(handFish(S)?.id).toBe("f1");
    expect(handFish(withS({ fish: [] }))).toBeNull();
    expect(baitTotal(S)).toBe(4);
  });
  it("treats starter, bought, and not-bigger buckets / bait boxes as owned", () => {
    expect(ownsItem(S, item({ id: "rod_wood", starter: true, price: null }))).toBe(true);
    expect(ownsItem(S, item({ id: "rod_bamboo" }))).toBe(true);
    expect(ownsItem(S, item({ id: "rod_carbon" }))).toBe(false);
    expect(ownsItem(S, item({ id: "bucket_small", kind: "bucket", capacity: 5 }))).toBe(true);
    expect(ownsItem(S, item({ id: "bucket_large", kind: "bucket", capacity: 15 }))).toBe(false);
    expect(ownsItem(S, item({ id: "bait_box", kind: "bait_box", capacity: 60 }))).toBe(false);
    expect(ownsItem(withS({ baitCap: 60 }), item({ id: "bait_box", kind: "bait_box", capacity: 60 }))).toBe(true);
  });
});

describe("castBlocker", () => {
  it("allows a cast when nothing is in the way", () => {
    expect(castBlocker(S, NOW)).toBeNull();
  });
  it("checks in start_cast's order: hourly cap, capacity, bait (with the worm fallback)", () => {
    expect(castBlocker(withS({ castsLeft: 0 }), NOW)).toBe("cast_limit");
    expect(castBlocker(withS({ castsLeft: 0 }), Date.parse("2026-09-24T11:00:01Z"))).toBeNull();
    expect(castBlocker(withS({ fishCap: 2 }), NOW)).toBe("bucket_full");
    expect(castBlocker(withS({ fishCap: 1, fish: [S.fish[0]] }), NOW)).toBe("hands_full");
    expect(castBlocker(withS({ bait: { bait_worm: 0, bait_shrimp: 0, bait_bloodworm: 0 } }), NOW)).toBe("no_bait");
    expect(castBlocker(withS({ bait: { bait_worm: 2, bait_shrimp: 0, bait_bloodworm: 0 } }), NOW)).toBeNull();
  });
});

describe("maxBuyQty", () => {
  it("limits bait by the free capacity, the coins and 99", () => {
    expect(maxBuyQty(S, item({ kind: "bait", price: 5 }))).toBe(16);
    expect(maxBuyQty(withS({ coins: 30 }), item({ kind: "bait", price: 12 }))).toBe(2);
    expect(maxBuyQty(withS({ coins: 100_000, baitCap: 200, bait: {} }), item({ kind: "bait", price: 5 }))).toBe(99);
  });
  it("sells gear once, and only when affordable", () => {
    expect(maxBuyQty(S, item({ id: "bobber_foam", kind: "bobber", price: 150 }))).toBe(0);
    expect(maxBuyQty(S, item({ id: "bobber_foam", kind: "bobber", price: 100 }))).toBe(1);
    expect(maxBuyQty(S, item({ id: "rod_bamboo", price: 1 }))).toBe(0);
    expect(maxBuyQty(S, item({ id: "rod_wood", starter: true, price: null }))).toBe(0);
  });
});

describe("timers", () => {
  it("counts down the dig cooldown and the hourly cap", () => {
    expect(digWaitSec(S, NOW)).toBe(0);
    expect(digWaitSec(withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), NOW)).toBe(13);
    expect(castWaitMin(S, NOW)).toBe(0);
    expect(castWaitMin(withS({ castsLeft: 0 }), NOW)).toBe(30);
  });
});
```

`tests/unit/fishing-announce.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@/lib/chat";
import { ANNOUNCER_NAME, freshAnnouncements, parseCatchAnnouncement } from "@/lib/game/fishing/announce";

const ACC = "0b6a4c3e-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
// the exact text finish_cast builds: format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', ...)
const BODY = `[catch:${ACC}|ca_tra|3150] 🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!`;
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: ANNOUNCER_NAME, body: BODY, created_at: "2026-09-24T10:00:00Z", ...over,
});

describe("parseCatchAnnouncement", () => {
  it("reads the server's catch message", () => {
    expect(parseCatchAnnouncement(msg({}))).toEqual({
      accountId: ACC, speciesId: "ca_tra", weightG: 3150, text: "🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!",
    });
  });
  it("ignores members typing the prefix and malformed bodies", () => {
    expect(parseCatchAnnouncement(msg({ account_id: ACC }))).toBeNull();
    expect(parseCatchAnnouncement(msg({ username: "Dat" }))).toBeNull();
    expect(parseCatchAnnouncement(msg({ body: "hello" }))).toBeNull();
    expect(parseCatchAnnouncement(msg({ body: `[catch:${ACC}|CA TRA|3150] x` }))).toBeNull();
  });
});

describe("freshAnnouncements", () => {
  it("returns only unseen, recent announcements", () => {
    const now = Date.parse("2026-09-24T10:00:10Z");
    const out = freshAnnouncements([
      msg({ id: "a" }), msg({ id: "b" }), msg({ id: "c", created_at: "2026-09-24T09:00:00Z" }), msg({ id: "d", username: "x" }),
    ], new Set(["b"]), now);
    expect(out.map((o) => o.id)).toEqual(["a"]);
    expect(out[0].announcement.speciesId).toBe("ca_tra");
  });
});
```

`tests/unit/fishing-rpc.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { fetchFishingBoard, fetchFishingCatalog, finishCast, fishingErrorMessage, sellFish, startCast } from "@/lib/game/fishing/rpc";

const STATE = {
  coins: 5, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" }, owned: [],
  bait: { bait_worm: 1 }, bait_cap: 20, fish: [], fish_cap: 1, casts_left: 39, window_resets_at: null, dig_ready_at: null,
};
/** A thenable query chain: .select/.order return itself; awaiting it resolves to { data: rows, error: null }. */
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
};

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
});

describe("fetchFishingCatalog", () => {
  it("loads both config tables once per page", async () => {
    h.from.mockImplementation((table: string) => chain(table === "fish_species"
      ? [{ id: "ca_ro", name: "Cá rô đồng", rarity: 1, min_g: 50, max_g: 300, price_per_kg: 45, difficulty: 15, sort_order: 10 }]
      : [{ id: "rod_wood", kind: "rod", name: "Cần gỗ", price: null, starter: true, sort_order: 10, zone_pct: 25, weight_k: 2, rare_mult: 1,
          window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null }]));
    const a = await fetchFishingCatalog();
    const b = await fetchFishingCatalog();
    expect(b).toBe(a);
    expect(h.from).toHaveBeenCalledTimes(2);
    expect(a.species[0]).toMatchObject({ id: "ca_ro", pricePerKg: 45 });
    expect(a.items[0]).toMatchObject({ id: "rod_wood", starter: true, zonePct: 25 });
  });
});

describe("RPC wrappers", () => {
  it("maps start_cast", async () => {
    h.rpc.mockResolvedValue({ data: { cast_id: "c1", bite_ms: 4200, window_ms: 2000, difficulty: 38, min_reel_ms: 3520, zone_pct: 30, rarity: 2, bait_switched: true, state: STATE }, error: null });
    const c = await startCast("room", "tok");
    expect(h.rpc).toHaveBeenCalledWith("start_cast", { p_room_id: "room", p_session_token: "tok" });
    expect(c).toMatchObject({ castId: "c1", biteMs: 4200, windowMs: 2000, difficulty: 38, minReelMs: 3520, zonePct: 30, rarity: 2, baitSwitched: true });
    expect(c.state.castsLeft).toBe(39);
  });
  it("hides an unknown rarity", async () => {
    h.rpc.mockResolvedValue({ data: { cast_id: "c1", bite_ms: 1, window_ms: 1, difficulty: 1, min_reel_ms: 1, zone_pct: 25, rarity: null, bait_switched: false, state: STATE }, error: null });
    expect((await startCast("room", "tok")).rarity).toBeNull();
  });
  it("maps finish_cast both ways", async () => {
    h.rpc.mockResolvedValueOnce({ data: { result: "caught", record: true, fish: { id: "f", species_id: "ca_loc", weight_g: 1200, price: 72, rarity: 2 }, state: STATE }, error: null });
    expect(await finishCast("tok", "c1", true)).toMatchObject({ result: "caught", record: true, fish: { id: "f", speciesId: "ca_loc", weightG: 1200, price: 72, rarity: 2 } });
    h.rpc.mockResolvedValueOnce({ data: { result: "lost", why: "too_early", state: STATE }, error: null });
    expect(await finishCast("tok", "c1", true)).toMatchObject({ result: "lost", why: "too_early" });
  });
  it("maps the board", async () => {
    h.rpc.mockResolvedValue({ data: {
      records: [{ species_id: "ca_tra", username: "Dat", weight_g: 5000 }], mine: [{ species_id: "ca_ro", weight_g: 200 }],
      richest: [{ username: "Dat", coins: 900 }], my_rank: 2, my_coins: 30,
    }, error: null });
    expect(await fetchFishingBoard("room", "tok")).toEqual({
      records: [{ speciesId: "ca_tra", username: "Dat", weightG: 5000 }], mine: [{ speciesId: "ca_ro", weightG: 200 }],
      richest: [{ username: "Dat", coins: 900 }], myRank: 2, myCoins: 30,
    });
  });
  it("throws the Postgres error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "fish not found" } });
    await expect(sellFish("tok", ["x"])).rejects.toMatchObject({ message: "fish not found" });
  });
});

describe("fishingErrorMessage", () => {
  it("translates every server message", () => {
    const t = (message: string, details?: string) => fishingErrorMessage({ message, details });
    expect(t("not enough coins")).toBe("Không đủ xu.");
    expect(t("already owned")).toBe("Bạn có món này rồi.");
    expect(t("item not available")).toBe("Món này không mua được.");
    expect(t("invalid quantity")).toBe("Món này không mua được.");
    expect(t("bait full")).toBe("Hộp mồi đầy rồi.");
    expect(t("no bait")).toBe("Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.");
    expect(t("hands full")).toBe("Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!");
    expect(t("bucket full")).toBe("Xô đầy rồi — ra vựa bán bớt nhé!");
    expect(t("cast limit", "1500")).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 25 phút).");
    expect(t("dig cooldown", "32")).toBe("Đất còn cứng, chờ 32 giây nữa nhé.");
    expect(t("cast not found")).toBe("Cá đã thoát mất rồi.");
    expect(t("fish not found")).toBe("Con cá này không còn nữa.");
    expect(t("invalid session")).toBe("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
    expect(t("account banned")).toBe("Tài khoản đã bị khoá.");
    expect(t("account is not a member of this room")).toBe("Bạn không còn ở trong phòng này.");
    expect(fishingErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fishing-catalog.test.ts tests/unit/fishing-state.test.ts tests/unit/fishing-announce.test.ts tests/unit/fishing-rpc.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `lib/game/fishing/catalog.ts`**

```ts
// Client side of the fishing config tables (spec §7): types, rarity names and colours, number formats. Pure.

export type Rarity = 1 | 2 | 3 | 4 | 5;
export const RARITY_NAME: Record<Rarity, string> = { 1: "Thường", 2: "Khá", 3: "Hiếm", 4: "Quý", 5: "Huyền thoại" };
export const RARITY_COLOR: Record<Rarity, string> = { 1: "#9aa0a6", 2: "#4caf50", 3: "#2f80ed", 4: "#9b51e0", 5: "#f2994a" };

export function isRarity(v: unknown): v is Rarity {
  return v === 1 || v === 2 || v === 3 || v === 4 || v === 5;
}

export interface FishSpecies {
  id: string; name: string; rarity: Rarity; minG: number; maxG: number; pricePerKg: number; difficulty: number; sortOrder: number;
}

export type ShopKind = "rod" | "bobber" | "bait" | "bait_box" | "bucket";
const SHOP_KINDS: readonly string[] = ["rod", "bobber", "bait", "bait_box", "bucket"];

export interface ShopItem {
  id: string;
  kind: ShopKind;
  name: string;
  /** null = not sold (starter gear, dug worms). */
  price: number | null;
  /** Everyone owns it. */
  starter: boolean;
  sortOrder: number;
  zonePct: number | null; weightK: number | null; rareMult: number;
  windowMs: number | null; biteMinMs: number | null; biteMaxMs: number | null; showsRarity: boolean;
  multHiem: number; multQuy: number; multLegend: number;
  capacity: number | null;
}

export interface FishingCatalog { species: FishSpecies[]; items: ShopItem[] }

/** Rows as PostgREST returns them. */
export interface SpeciesRow {
  id: string; name: string; rarity: number; min_g: number; max_g: number; price_per_kg: number; difficulty: number; sort_order: number;
}
export interface ShopItemRow {
  id: string; kind: string; name: string; price: number | null; starter: boolean; sort_order: number;
  zone_pct: number | null; weight_k: number | null; rare_mult: number;
  window_ms: number | null; bite_min_ms: number | null; bite_max_ms: number | null; shows_rarity: boolean;
  mult_hiem: number; mult_quy: number; mult_legend: number; capacity: number | null;
}

export function speciesFromRow(r: SpeciesRow): FishSpecies {
  return {
    id: r.id, name: r.name, rarity: isRarity(r.rarity) ? r.rarity : 1, minG: r.min_g, maxG: r.max_g,
    pricePerKg: r.price_per_kg, difficulty: r.difficulty, sortOrder: r.sort_order,
  };
}

export function shopItemFromRow(r: ShopItemRow): ShopItem {
  return {
    id: r.id, kind: SHOP_KINDS.includes(r.kind) ? (r.kind as ShopKind) : "bait", name: r.name, price: r.price,
    starter: r.starter, sortOrder: r.sort_order,
    zonePct: r.zone_pct, weightK: r.weight_k, rareMult: r.rare_mult ?? 1,
    windowMs: r.window_ms, biteMinMs: r.bite_min_ms, biteMaxMs: r.bite_max_ms, showsRarity: r.shows_rarity,
    multHiem: r.mult_hiem ?? 1, multQuy: r.mult_quy ?? 1, multLegend: r.mult_legend ?? 1, capacity: r.capacity,
  };
}

/** "350 g" under 1 kg; otherwise tenths rounded half up with a decimal comma: 1150 → "1,2 kg" (same rule as SQL `_weight_text`). */
export function formatWeight(g: number): string {
  if (g < 1000) return `${g} g`;
  const tenths = Math.round(g / 100);
  return `${Math.floor(tenths / 10)},${tenths % 10} kg`;
}

/** 1230 → "1.230 xu". */
export function formatXu(n: number): string {
  return `${n.toLocaleString("vi-VN")} xu`;
}

/** 1.5 → "1,5"; float4 noise (1.2000000476837158) is rounded away. */
const decimal = (n: number): string => String(Math.round(n * 100) / 100).replace(".", ",");

/** The effect line shown in the shop and the bag. */
export function describeItem(it: ShopItem): string {
  switch (it.kind) {
    case "rod": {
      const parts = [`Vùng giữ cá ${it.zonePct ?? 25}%`];
      if ((it.weightK ?? 2) < 2) parts.push("cá nặng hơn");
      if (it.rareMult > 1) parts.push(`cá hiếm +${Math.round((it.rareMult - 1) * 100)}%`);
      return parts.join(" · ");
    }
    case "bobber": {
      const parts = [`Giật cần trong ${decimal((it.windowMs ?? 1500) / 1000)} giây`];
      if ((it.biteMaxMs ?? 10_000) < 10_000) parts.push("cá cắn nhanh hơn");
      if (it.showsRarity) parts.push("báo độ hiếm");
      return parts.join(" · ");
    }
    case "bait":
      if (it.multLegend > it.multHiem) return `Cá hiếm ×${decimal(it.multHiem)}, huyền thoại ×${decimal(it.multLegend)}`;
      if (it.multHiem > 1) return `Cá hiếm trở lên ×${decimal(it.multHiem)}`;
      return "Mồi thường — đào ở bãi trùn";
    case "bait_box":
      return `Chứa ${it.capacity ?? 0} mồi`;
    case "bucket":
      return `Đựng ${it.capacity ?? 0} con cá`;
  }
}
```

- [ ] **Step 4: Create `lib/game/fishing/state.ts`**

```ts
import type { ShopItem } from "./catalog";

// The account's fishing state as every fishing RPC returns it (spec §8.2), camelCased, plus the rules the HUD needs. Pure.

export interface FishRow { id: string; speciesId: string; weightG: number; price: number; caughtAt: string }
export interface Loadout { rod: string; bobber: string; bait: string }
export interface FishingState {
  coins: number;
  dailyClaimed: boolean;
  loadout: Loadout;
  /** Non-starter gear the account owns. */
  owned: string[];
  /** Bait counts by item id. */
  bait: Record<string, number>;
  baitCap: number;
  /** Oldest first — fish[0] is the one in hand. */
  fish: FishRow[];
  fishCap: number;
  castsLeft: number;
  windowResetsAt: string | null;
  digReadyAt: string | null;
}
export type CastBlocker = "no_bait" | "hands_full" | "bucket_full" | "cast_limit";

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** The `state` JSON of any fishing RPC; null when it is not an object. */
export function parseFishingState(json: unknown): FishingState | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const lo = obj(j.loadout);
  const bait: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(j.bait))) bait[k] = num(v);
  const fish = (Array.isArray(j.fish) ? j.fish : []).map(obj).map((f) => ({
    id: str(f.id), speciesId: str(f.species_id), weightG: num(f.weight_g), price: num(f.price), caughtAt: str(f.caught_at),
  }));
  return {
    coins: num(j.coins),
    dailyClaimed: j.daily_claimed === true,
    loadout: { rod: str(lo.rod, "rod_wood"), bobber: str(lo.bobber, "bobber_feather"), bait: str(lo.bait, "bait_worm") },
    owned: (Array.isArray(j.owned) ? j.owned : []).filter((x): x is string => typeof x === "string"),
    bait,
    baitCap: num(j.bait_cap, 20),
    fish,
    fishCap: num(j.fish_cap, 1),
    castsLeft: num(j.casts_left, 40),
    windowResetsAt: strOrNull(j.window_resets_at),
    digReadyAt: strOrNull(j.dig_ready_at),
  };
}

export function handFish(s: FishingState): FishRow | null {
  return s.fish[0] ?? null;
}

export function baitCount(s: FishingState, id: string): number {
  return s.bait[id] ?? 0;
}

export function baitTotal(s: FishingState): number {
  return Object.values(s.bait).reduce((a, b) => a + b, 0);
}

/** Owned: a starter item, a bought one, or a bucket / bait box no bigger than what the account already has. */
export function ownsItem(s: FishingState, item: ShopItem): boolean {
  if (item.starter || s.owned.includes(item.id)) return true;
  if (item.kind === "bucket") return (item.capacity ?? 0) <= s.fishCap - 1;
  if (item.kind === "bait_box") return (item.capacity ?? 0) <= s.baitCap;
  return false;
}

/** Why start_cast would refuse right now (same order as the server), or null. `now` = Date.now(). */
export function castBlocker(s: FishingState, now: number): CastBlocker | null {
  const windowOver = s.windowResetsAt !== null && Date.parse(s.windowResetsAt) <= now;
  if (s.castsLeft <= 0 && !windowOver) return "cast_limit";
  if (s.fish.length >= s.fishCap) return s.fishCap <= 1 ? "hands_full" : "bucket_full";
  if (baitCount(s, s.loadout.bait) < 1 && baitCount(s, "bait_worm") < 1) return "no_bait";
  return null;
}

/** How many the account can buy now: bait up to the free capacity and the coins (max 99); gear 0 or 1. */
export function maxBuyQty(s: FishingState, item: ShopItem): number {
  if (item.price === null) return 0;
  const affordable = Math.floor(s.coins / item.price);
  if (item.kind === "bait") return Math.max(0, Math.min(99, s.baitCap - baitTotal(s), affordable));
  return ownsItem(s, item) || affordable < 1 ? 0 : 1;
}

/** Seconds until the dig cooldown ends (0 = ready). */
export function digWaitSec(s: FishingState, now: number): number {
  return s.digReadyAt ? Math.max(0, Math.ceil((Date.parse(s.digReadyAt) - now) / 1000)) : 0;
}

/** Minutes until the hourly cast window resets (0 = casts available). */
export function castWaitMin(s: FishingState, now: number): number {
  if (s.castsLeft > 0 || !s.windowResetsAt) return 0;
  return Math.max(0, Math.ceil((Date.parse(s.windowResetsAt) - now) / 60_000));
}
```

- [ ] **Step 5: Create `lib/game/fishing/announce.ts`**

```ts
import type { ChatMessage } from "@/lib/chat";

// The chat message finish_cast posts for a rare+ catch (spec §8.5). Pure.

export const ANNOUNCER_NAME = "Ao cá";

export interface CatchAnnouncement { accountId: string; speciesId: string; weightG: number; text: string }

const PATTERN = /^\[catch:([0-9a-f-]{36})\|([a-z_]{1,32})\|(\d{1,6})\] ([\s\S]+)$/;

/** Only server messages count: no author account and the announcer's name, so a member cannot fake one. */
export function parseCatchAnnouncement(m: Pick<ChatMessage, "account_id" | "username" | "body">): CatchAnnouncement | null {
  if (m.account_id !== null || m.username !== ANNOUNCER_NAME) return null;
  const x = PATTERN.exec(m.body);
  if (!x) return null;
  return { accountId: x[1], speciesId: x[2], weightG: Number(x[3]), text: x[4] };
}

/** Announcements not shown yet and at most maxAgeMs old (the game HUD toasts them). */
export function freshAnnouncements(
  messages: ChatMessage[], shown: ReadonlySet<string>, now: number, maxAgeMs = 30_000,
): Array<{ id: string; announcement: CatchAnnouncement }> {
  const out: Array<{ id: string; announcement: CatchAnnouncement }> = [];
  for (const m of messages) {
    if (shown.has(m.id) || now - Date.parse(m.created_at) > maxAgeMs) continue;
    const a = parseCatchAnnouncement(m);
    if (a) out.push({ id: m.id, announcement: a });
  }
  return out;
}
```

- [ ] **Step 6: Create `lib/game/fishing/rpc.ts`**

```ts
import { supabase } from "@/lib/supabase";
import { isRarity, shopItemFromRow, speciesFromRow, type FishingCatalog, type Rarity, type ShopItemRow, type SpeciesRow } from "./catalog";
import { parseFishingState, type FishingState, type Loadout } from "./state";

// Supabase calls for the fishing RPCs (spec §8.3). Every answer carries the account's full state.

let catalogPromise: Promise<FishingCatalog> | null = null;

/** Species + shop items, cached per page load (a failed fetch is retried on the next call). */
export function fetchFishingCatalog(): Promise<FishingCatalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [sp, it] = await Promise.all([
        supabase.from("fish_species").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").order("kind").order("sort_order"),
      ]);
      if (sp.error || it.error) {
        catalogPromise = null;
        throw sp.error ?? it.error;
      }
      return {
        species: ((sp.data ?? []) as SpeciesRow[]).map(speciesFromRow),
        items: ((it.data ?? []) as ShopItemRow[]).map(shopItemFromRow),
      };
    })();
  }
  return catalogPromise;
}

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

function stateOf(raw: unknown): FishingState {
  const s = parseFishingState(raw);
  if (!s) throw new Error("bad fishing state");
  return s;
}

export async function fetchFishingState(token: string): Promise<FishingState> {
  return stateOf(await call("fishing_state", { p_session_token: token }));
}

export async function claimDaily(token: string): Promise<{ claimed: boolean; amount: number; state: FishingState }> {
  const r = await call("claim_daily", { p_session_token: token });
  return { claimed: r.claimed === true, amount: Number(r.amount ?? 0), state: stateOf(r.state) };
}

export async function digWorms(token: string): Promise<{ gained: number; state: FishingState }> {
  const r = await call("dig_worms", { p_session_token: token });
  return { gained: Number(r.gained ?? 0), state: stateOf(r.state) };
}

export async function buyItem(token: string, itemId: string, qty: number): Promise<FishingState> {
  return stateOf((await call("buy_item", { p_session_token: token, p_item_id: itemId, p_qty: qty })).state);
}

export async function setLoadout(token: string, l: Loadout): Promise<FishingState> {
  return stateOf((await call("set_loadout", { p_session_token: token, p_rod: l.rod, p_bobber: l.bobber, p_bait: l.bait })).state);
}

export interface StartCast {
  castId: string; biteMs: number; windowMs: number; difficulty: number; minReelMs: number; zonePct: number;
  /** Only when the bobber shows it. */
  rarity: Rarity | null;
  baitSwitched: boolean;
  state: FishingState;
}

export async function startCast(roomId: string, token: string): Promise<StartCast> {
  const r = await call("start_cast", { p_room_id: roomId, p_session_token: token });
  return {
    castId: String(r.cast_id), biteMs: Number(r.bite_ms), windowMs: Number(r.window_ms), difficulty: Number(r.difficulty),
    minReelMs: Number(r.min_reel_ms), zonePct: Number(r.zone_pct), rarity: isRarity(r.rarity) ? r.rarity : null,
    baitSwitched: r.bait_switched === true, state: stateOf(r.state),
  };
}

export interface CaughtFish { id: string; speciesId: string; weightG: number; price: number; rarity: Rarity }
export type LostWhy = "expired" | "gave_up" | "too_early" | "full";
export type FinishCast =
  | { result: "caught"; fish: CaughtFish; record: boolean; state: FishingState }
  | { result: "lost"; why: LostWhy; state: FishingState };

export async function finishCast(token: string, castId: string, success: boolean): Promise<FinishCast> {
  const r = await call("finish_cast", { p_session_token: token, p_cast_id: castId, p_success: success });
  const state = stateOf(r.state);
  if (r.result === "caught" && r.fish && typeof r.fish === "object") {
    const f = r.fish as Record<string, unknown>;
    return {
      result: "caught", record: r.record === true, state,
      fish: {
        id: String(f.id), speciesId: String(f.species_id), weightG: Number(f.weight_g), price: Number(f.price),
        rarity: isRarity(f.rarity) ? f.rarity : 1,
      },
    };
  }
  const why: LostWhy = r.why === "expired" || r.why === "too_early" || r.why === "full" ? r.why : "gave_up";
  return { result: "lost", why, state };
}

export async function sellFish(token: string, ids: string[]): Promise<{ sold: number; earned: number; state: FishingState }> {
  const r = await call("sell_fish", { p_session_token: token, p_fish_ids: ids });
  return { sold: Number(r.sold ?? 0), earned: Number(r.earned ?? 0), state: stateOf(r.state) };
}

export async function releaseFish(token: string, id: string): Promise<FishingState> {
  return stateOf((await call("release_fish", { p_session_token: token, p_fish_id: id })).state);
}

export interface FishingBoard {
  records: Array<{ speciesId: string; username: string; weightG: number }>;
  mine: Array<{ speciesId: string; weightG: number }>;
  richest: Array<{ username: string; coins: number }>;
  myRank: number;
  myCoins: number;
}

export async function fetchFishingBoard(roomId: string, token: string): Promise<FishingBoard> {
  const r = await call("fishing_board", { p_room_id: roomId, p_session_token: token });
  const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  return {
    records: list(r.records).map((x) => ({ speciesId: String(x.species_id), username: String(x.username), weightG: Number(x.weight_g) })),
    mine: list(r.mine).map((x) => ({ speciesId: String(x.species_id), weightG: Number(x.weight_g) })),
    richest: list(r.richest).map((x) => ({ username: String(x.username), coins: Number(x.coins) })),
    myRank: Number(r.my_rank ?? 1),
    myCoins: Number(r.my_coins ?? 0),
  };
}

/** Vietnamese toast text for a fishing RPC error (spec §8.6). */
export function fishingErrorMessage(err: unknown): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; details?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const secs = Number(e.details);
  switch (msg) {
    case "not enough coins": return "Không đủ xu.";
    case "already owned": return "Bạn có món này rồi.";
    case "item not available":
    case "invalid quantity": return "Món này không mua được.";
    case "bait full": return "Hộp mồi đầy rồi.";
    case "no bait": return "Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.";
    case "hands full": return "Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!";
    case "bucket full": return "Xô đầy rồi — ra vựa bán bớt nhé!";
    case "cast limit":
      return `Câu nhiều quá rồi, nghỉ tay chút nhé (còn ${Number.isFinite(secs) ? Math.max(1, Math.ceil(secs / 60)) : 60} phút).`;
    case "dig cooldown": return `Đất còn cứng, chờ ${Number.isFinite(secs) ? Math.max(1, secs) : 45} giây nữa nhé.`;
    case "cast not found": return "Cá đã thoát mất rồi.";
    case "fish not found": return "Con cá này không còn nữa.";
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/unit/fishing-catalog.test.ts tests/unit/fishing-state.test.ts tests/unit/fishing-announce.test.ts tests/unit/fishing-rpc.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/fishing tests/unit/fishing-*.test.ts` — both clean.

```bash
git add lib/game/fishing/catalog.ts lib/game/fishing/state.ts lib/game/fishing/announce.ts lib/game/fishing/rpc.ts tests/unit/fishing-catalog.test.ts tests/unit/fishing-state.test.ts tests/unit/fishing-announce.test.ts tests/unit/fishing-rpc.test.ts
git commit -m "feat(v14): fishing client data layer — catalog, state, announcements, RPC wrappers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Reel minigame, cast timeline and rod geometry (pure)

**Files:**
- Create: `lib/game/fishing/reel.ts`, `lib/game/fishing/cast.ts`, `lib/game/fishing/geometry.ts`
- Test: `tests/unit/game-reel.test.ts`, `tests/unit/game-cast.test.ts`

**Interfaces:**
- Consumes: `Rarity` from `@/lib/game/fishing/catalog`; `Facing`, `Vec` from `@/lib/game/types`.
- Produces:
  - `reel.ts`: `ReelParams { zonePct; difficulty; minReelMs; seed }`, `ReelState`, `REEL` constants, `nextRandom(state): [number, number]`, `zoneHeight(p)`, `fishFloor(p)`, `createReel(p)`, `inZone(s, p)`, `stepReel(s, p, dtSec, holding)`.
  - `cast.ts`: `CastInfo { castId; biteMs; windowMs; difficulty; minReelMs; zonePct; rarity: Rarity | null }`, `CastPhase = "waiting" | "bite" | "missed"`, `castPhase(info, sinceAnswerMs)`, `canHook(info, sinceAnswerMs)`, `msToNextPhase(info, sinceAnswerMs): number | null`, `reelParamsFor(info, seed): ReelParams`.
  - `geometry.ts`: `FACE_V`, `BOBBER_REACH` (`up 56, down 30, left 36, right 36`), `SWING_MS = 600`, `bobberPoint(feet, facing)`, `handPoint(feet, facing)`, `rodTip(feet, facing, swing, bend)`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/game-reel.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  createReel, fishFloor, nextRandom, REEL, stepReel, zoneHeight, type ReelParams, type ReelState,
} from "@/lib/game/fishing/reel";

const P = (over: Partial<ReelParams> = {}): ReelParams => ({ zonePct: 25, difficulty: 15, minReelMs: 2600, seed: 7, ...over });
const play = (p: ReelParams, policy: (s: ReelState) => boolean): ReelState => {
  let s = createReel(p);
  for (let i = 0; i < 60 * 70 && !s.outcome; i++) s = stepReel(s, p, 1 / 60, policy(s));
  return s;
};
/** Holds while the zone's middle (plus a little look-ahead) is below the fish. */
const tracker = (p: ReelParams) => (s: ReelState) => s.zone + zoneHeight(p) / 2 + s.zoneV * 0.12 < s.fish;

describe("nextRandom", () => {
  it("is deterministic and stays in [0, 1)", () => {
    let a = 42, b = 42;
    for (let i = 0; i < 100; i++) {
      const [x, na] = nextRandom(a);
      const [y, nb] = nextRandom(b);
      expect(x).toBe(y);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      a = na;
      b = nb;
    }
  });
});

describe("createReel", () => {
  it("starts at 30 % with the zone at the bottom and the fish above it", () => {
    const p = P();
    const s = createReel(p);
    expect(s).toMatchObject({ progress: REEL.start, zone: 0, zoneV: 0, fish: REEL.fishStart, elapsedMs: 0, outcome: null });
    expect(s.target).toBeGreaterThanOrEqual(fishFloor(p));
    expect(createReel(p)).toEqual(s);
  });
  it("keeps the fish above a big zone", () => {
    expect(createReel(P({ zonePct: 60 })).fish).toBe(fishFloor(P({ zonePct: 60 })));
  });
});

describe("stepReel", () => {
  it("lifts the zone while holding and lets it fall back with a bounce", () => {
    const p = P();
    let s = createReel(p);
    for (let i = 0; i < 20; i++) s = stepReel(s, p, 1 / 60, true);
    expect(s.zone).toBeGreaterThan(0);
    expect(s.zoneV).toBeGreaterThan(0);
    for (let i = 0; i < 180; i++) s = stepReel(s, p, 1 / 60, false);
    expect(s.zone).toBe(0);
    expect(s.zoneV).toBeGreaterThanOrEqual(0);
  });
  it("keeps the zone inside the bar and the fish between its floor and the top", () => {
    const p = P({ difficulty: 90, seed: 3 });
    let s = createReel(p);
    for (let i = 0; i < 900 && !s.outcome; i++) {
      s = stepReel(s, p, 1 / 60, i % 50 < 30);
      expect(s.zone).toBeGreaterThanOrEqual(0);
      expect(s.zone).toBeLessThanOrEqual(1 - zoneHeight(p) + 1e-9);
      expect(s.fish).toBeGreaterThanOrEqual(fishFloor(p) - 1e-9);
      expect(s.fish).toBeLessThanOrEqual(1);
    }
  });
  it("fills progress while the fish is in the zone and drains it outside", () => {
    const p = P();
    const inside: ReelState = { ...createReel(p), zone: 0.3, fish: 0.4, target: 0.4 };
    expect(stepReel(inside, p, 0.05, false).progress).toBeCloseTo(0.3 + (0.7 / 2.6) * 0.05, 6);
    const outside: ReelState = { ...createReel(p), zone: 0, fish: 0.9, target: 0.9 };
    expect(stepReel(outside, p, 0.05, false).progress).toBeCloseTo(0.3 - (0.075 + 0.07 * 0.15) * 0.05, 6);
  });
  it("lets a tracking player land easy fish, never faster than minReelMs", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = P({ seed });
      const s = play(p, tracker(p));
      expect(s.outcome, `seed ${seed}`).toBe("caught");
      expect(s.elapsedMs).toBeGreaterThanOrEqual(p.minReelMs - 1);
    }
  });
  it("never lands a fish for a player who does nothing", () => {
    for (let seed = 1; seed <= 20; seed++) expect(play(P({ seed, zonePct: 36 }), () => false).outcome).toBe("escaped");
  });
  it("gives up after 60 s and then keeps its outcome", () => {
    const p = P();
    const late: ReelState = { ...createReel(p), elapsedMs: REEL.maxMs - 10, progress: 0.5, zone: 0, fish: 0.9, target: 0.9 };
    const s = stepReel(late, p, 0.05, false);
    expect(s.outcome).toBe("escaped");
    expect(stepReel(s, p, 0.05, true)).toBe(s);
  });
  it("clamps a long frame to 50 ms", () => {
    const p = P();
    expect(stepReel(createReel(p), p, 1, false).elapsedMs).toBeCloseTo(50);
  });
  it("is deterministic for a seed", () => {
    const p = P({ seed: 99, difficulty: 58 });
    expect(play(p, tracker(p))).toEqual(play(p, tracker(p)));
  });
});
```

`tests/unit/game-cast.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { canHook, castPhase, msToNextPhase, reelParamsFor, type CastInfo } from "@/lib/game/fishing/cast";
import { BOBBER_REACH, bobberPoint, handPoint, rodTip } from "@/lib/game/fishing/geometry";

const INFO: CastInfo = { castId: "c", biteMs: 4000, windowMs: 1500, difficulty: 38, minReelMs: 3520, zonePct: 30, rarity: null };

describe("cast timeline", () => {
  it("waits, bites, then misses", () => {
    expect(castPhase(INFO, 0)).toBe("waiting");
    expect(castPhase(INFO, 3999)).toBe("waiting");
    expect(castPhase(INFO, 4000)).toBe("bite");
    expect(castPhase(INFO, 5499)).toBe("bite");
    expect(castPhase(INFO, 5500)).toBe("missed");
  });
  it("only hooks during the bite", () => {
    expect(canHook(INFO, 3000)).toBe(false);
    expect(canHook(INFO, 4500)).toBe(true);
    expect(canHook(INFO, 6000)).toBe(false);
  });
  it("tells how long until the next phase", () => {
    expect(msToNextPhase(INFO, 1000)).toBe(3000);
    expect(msToNextPhase(INFO, 4200)).toBe(1300);
    expect(msToNextPhase(INFO, 9000)).toBeNull();
  });
  it("builds the reel parameters from the cast", () => {
    expect(reelParamsFor(INFO, 5)).toEqual({ zonePct: 30, difficulty: 38, minReelMs: 3520, seed: 5 });
  });
});

describe("rod geometry", () => {
  const feet = { x: 300, y: 204 };
  it("puts the bobber in front of the feet, clear of the head when facing up", () => {
    expect(bobberPoint(feet, "up")).toEqual({ x: 300, y: 204 - BOBBER_REACH.up });
    expect(bobberPoint(feet, "up").y).toBeLessThan(feet.y - 46);
    expect(bobberPoint(feet, "left")).toEqual({ x: 264, y: 204 });
    expect(bobberPoint(feet, "right")).toEqual({ x: 336, y: 204 });
    expect(bobberPoint(feet, "down")).toEqual({ x: 300, y: 234 });
  });
  it("swings the rod tip from over the shoulder to out front", () => {
    const h = handPoint(feet, "left");
    expect(rodTip(feet, "left", 1, 0)).toEqual({ x: h.x - 12, y: h.y - 10 });
    expect(rodTip(feet, "left", 1, 4)).toEqual({ x: h.x - 12, y: h.y - 6 });
    expect(rodTip(feet, "left", 0, 0)).toEqual({ x: h.x + 6, y: h.y - 13 });
    expect(rodTip(feet, "left", 5, 0)).toEqual(rodTip(feet, "left", 1, 0));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/game-reel.test.ts tests/unit/game-cast.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Create `lib/game/fishing/reel.ts`**

```ts
// Stardew-style reel minigame (spec §6.2): hold to lift the catch zone, keep the fish inside it. Pure and deterministic
// for a seed. The constants were tuned in a simulation with bots of several skill levels.

export interface ReelParams { zonePct: number; difficulty: number; minReelMs: number; seed: number }
export interface ReelState {
  /** Bottom of the catch zone (0 … 1 − zone height) and its speed, in bar heights per second. */
  zone: number;
  zoneV: number;
  /** Fish position and where it is heading (0 = bottom, 1 = top). */
  fish: number;
  target: number;
  progress: number;
  elapsedMs: number;
  rng: number;
  outcome: "caught" | "escaped" | null;
}

export const REEL = {
  /** Progress at the hook — fixed: the server's time gate assumes a perfect reel fills 0.3 → 1 in minReelMs. */
  start: 0.3,
  lift: 3.0,
  gravity: 2.2,
  maxSpeed: 1.4,
  bounce: 0.35,
  fishStart: 0.45,
  /** The fish stays at least this far above the resting zone, so doing nothing never lands a fish. */
  floorGap: 0.05,
  maxMs: 60_000,
  maxDt: 0.05,
} as const;

/** mulberry32: [value in [0, 1), next state]. */
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), s | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}

export function zoneHeight(p: ReelParams): number {
  return Math.min(0.9, Math.max(0.05, p.zonePct / 100));
}

/** Lowest point the fish swims to. */
export function fishFloor(p: ReelParams): number {
  return Math.min(0.5, zoneHeight(p) + REEL.floorGap);
}

const level = (p: ReelParams): number => Math.min(1, Math.max(0, p.difficulty / 100));

export function createReel(p: ReelParams): ReelState {
  const floor = fishFloor(p);
  const [u, rng] = nextRandom(p.seed | 0);
  return {
    zone: 0, zoneV: 0, fish: Math.max(REEL.fishStart, floor), target: floor + u * (1 - floor),
    progress: REEL.start, elapsedMs: 0, rng, outcome: null,
  };
}

export function inZone(s: Pick<ReelState, "zone" | "fish">, p: ReelParams): boolean {
  return s.fish >= s.zone && s.fish <= s.zone + zoneHeight(p);
}

/** One frame. `dtSec` is clamped to 50 ms; once there is an outcome the same state is returned. */
export function stepReel(s: ReelState, p: ReelParams, dtSec: number, holding: boolean): ReelState {
  if (s.outcome) return s;
  const dt = Math.min(REEL.maxDt, Math.max(0, dtSec));
  const h = zoneHeight(p), d = level(p), floor = fishFloor(p);

  let zoneV = Math.max(-REEL.maxSpeed, Math.min(REEL.maxSpeed, s.zoneV + (holding ? REEL.lift : -REEL.gravity) * dt));
  let zone = s.zone + zoneV * dt;
  if (zone < 0) {
    zone = 0;
    if (zoneV < 0) zoneV = -zoneV * REEL.bounce;
  }
  if (zone > 1 - h) {
    zone = 1 - h;
    zoneV = 0;
  }

  let [u, rng] = nextRandom(s.rng);
  let target = s.target;
  if (Math.abs(target - s.fish) < 0.02 || u < (0.3 + 1.2 * d) * dt) {
    [u, rng] = nextRandom(rng);
    target = Math.min(1, Math.max(floor, s.fish + (u - 0.5) * (0.25 + 0.6 * d)));
  }
  const step = (0.18 + 0.62 * d) * dt;
  const gap = target - s.fish;
  const fish = Math.abs(gap) <= step ? target : s.fish + Math.sign(gap) * step;

  const elapsedMs = s.elapsedMs + dt * 1000;
  let progress = s.progress + (inZone({ zone, fish }, p) ? (0.7 / (p.minReelMs / 1000)) * dt : -(0.075 + 0.07 * d) * dt);
  let outcome: ReelState["outcome"] = null;
  if (progress >= 1) {
    progress = 1;
    outcome = "caught";
  } else if (progress <= 0) {
    progress = 0;
    outcome = "escaped";
  } else if (elapsedMs >= REEL.maxMs) {
    outcome = "escaped";
  }
  return { zone, zoneV, fish, target, progress, elapsedMs, rng, outcome };
}
```

- [ ] **Step 4: Create `lib/game/fishing/cast.ts`**

```ts
import type { Rarity } from "./catalog";
import type { ReelParams } from "./reel";

// The cast timeline after start_cast answers (spec §6.1): wait for the bite, then a short window to hook. Pure.

export interface CastInfo {
  castId: string; biteMs: number; windowMs: number; difficulty: number; minReelMs: number; zonePct: number;
  /** Shown by Phao xốp / Phao đèn only. */
  rarity: Rarity | null;
}

export type CastPhase = "waiting" | "bite" | "missed";

/** Phase `sinceAnswerMs` after the start_cast answer arrived. */
export function castPhase(info: CastInfo, sinceAnswerMs: number): CastPhase {
  if (sinceAnswerMs < info.biteMs) return "waiting";
  if (sinceAnswerMs < info.biteMs + info.windowMs) return "bite";
  return "missed";
}

export function canHook(info: CastInfo, sinceAnswerMs: number): boolean {
  return castPhase(info, sinceAnswerMs) === "bite";
}

/** ms until the phase changes, or null once the bite was missed. */
export function msToNextPhase(info: CastInfo, sinceAnswerMs: number): number | null {
  if (sinceAnswerMs < info.biteMs) return info.biteMs - sinceAnswerMs;
  if (sinceAnswerMs < info.biteMs + info.windowMs) return info.biteMs + info.windowMs - sinceAnswerMs;
  return null;
}

export function reelParamsFor(info: CastInfo, seed: number): ReelParams {
  return { zonePct: info.zonePct, difficulty: info.difficulty, minReelMs: info.minReelMs, seed };
}
```

- [ ] **Step 5: Create `lib/game/fishing/geometry.ts`**

```ts
import type { Facing, Vec } from "@/lib/game/types";

// Where the hands, the rod tip and the bobber are for a character whose feet are at `feet`. Pure (world px).

export const FACE_V: Record<Facing, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** Distance from the feet to the bobber; facing up it must clear the character's own 48-px-tall sprite. */
export const BOBBER_REACH: Record<Facing, number> = { up: 56, down: 30, left: 36, right: 36 };

/** The cast swing before the line lands. */
export const SWING_MS = 600;

export function bobberPoint(feet: Vec, facing: Facing): Vec {
  const v = FACE_V[facing], r = BOBBER_REACH[facing];
  return { x: feet.x + v.x * r, y: feet.y + v.y * r };
}

export function handPoint(feet: Vec, facing: Facing): Vec {
  switch (facing) {
    case "down": return { x: feet.x + 6, y: feet.y - 19 };
    case "up": return { x: feet.x + 6, y: feet.y - 21 };
    case "left": return { x: feet.x - 4, y: feet.y - 19 };
    case "right": return { x: feet.x + 4, y: feet.y - 19 };
  }
}

/** Rod tip: swing 0 = held back over the shoulder, 1 = out over the water; `bend` pulls the tip down (px). */
export function rodTip(feet: Vec, facing: Facing, swing: number, bend: number): Vec {
  const h = handPoint(feet, facing), v = FACE_V[facing];
  const s = Math.min(1, Math.max(0, swing));
  const out = { x: h.x + v.x * 12, y: h.y + v.y * 12 - 10 + bend };
  const back = { x: h.x - v.x * 6, y: h.y - v.y * 6 - 13 };
  return { x: Math.round(back.x + (out.x - back.x) * s), y: Math.round(back.y + (out.y - back.y) * s) };
}
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/unit/game-reel.test.ts tests/unit/game-cast.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/fishing tests/unit/game-reel.test.ts tests/unit/game-cast.test.ts` — clean.

```bash
git add lib/game/fishing/reel.ts lib/game/fishing/cast.ts lib/game/fishing/geometry.ts tests/unit/game-reel.test.ts tests/unit/game-cast.test.ts
git commit -m "feat(v14): reel minigame physics, cast timeline and rod geometry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Fish and gear icons

**Files:**
- Create: `lib/game/art/fish.ts`, `lib/game/art/gear.ts`
- Modify: `lib/game/art/icons.ts` (append `PixelIcon`, `pixelIconMatrix`, `iconMatrixFor`)
- Modify: `components/game/ItemIcon.tsx` (draw any icon id)
- Test: `tests/unit/game-fish-art.test.ts`

**Interfaces:**
- Consumes: `OUTLINE` from `@/lib/game/art/palettes`; `itemIconMatrix` (existing, clothing).
- Produces: `interface PixelIcon { rows: readonly string[]; pal: Readonly<Record<string, string>> }`; `FISH_ICONS: Record<string, PixelIcon>` (keys = the 12 species ids); `GEAR_ICONS: Record<string, PixelIcon>` (keys = the 12 shop item ids); `pixelIconMatrix(icon): string[][]` (16×16 CSS colours, `""` = transparent, `o` = `OUTLINE`); `iconMatrixFor(id): string[][] | null` (clothing → fish → gear). `ItemIcon` keeps its props (`id`, `scale`, `className`) and now draws fish and gear too.

- [ ] **Step 1: Write the failing test**

`tests/unit/game-fish-art.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FISH_ICONS } from "@/lib/game/art/fish";
import { GEAR_ICONS } from "@/lib/game/art/gear";
import { ICON_SIZE, iconMatrixFor, pixelIconMatrix, type PixelIcon } from "@/lib/game/art/icons";
import { OUTLINE } from "@/lib/game/art/palettes";

const sql = readFileSync("supabase/migrations/0012_v14_fishing.sql", "utf8");
/** Ids seeded by `insert into public.<table> … on conflict`. */
const seededIds = (table: string): string[] => {
  const start = sql.indexOf(`insert into public.${table}`);
  const block = sql.slice(start, sql.indexOf("on conflict", start));
  return [...block.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]);
};

describe("fish and gear icons", () => {
  const all: Array<[string, PixelIcon]> = [...Object.entries(FISH_ICONS), ...Object.entries(GEAR_ICONS)];
  it("are 16×16 and only use '.', 'o' and their own palette", () => {
    for (const [id, icon] of all) {
      expect(icon.rows, id).toHaveLength(ICON_SIZE);
      for (const row of icon.rows) {
        expect(row, id).toHaveLength(ICON_SIZE);
        for (const ch of row) expect(ch === "." || ch === "o" || ch in icon.pal, `${id}: ${ch}`).toBe(true);
      }
    }
  });
  it("cover every seeded species and shop item", () => {
    expect(seededIds("fish_species").sort()).toEqual(Object.keys(FISH_ICONS).sort());
    expect(seededIds("shop_items").sort()).toEqual(Object.keys(GEAR_ICONS).sort());
  });
  it("map codes to colours", () => {
    const m = pixelIconMatrix({ rows: Array(16).fill(".o" + "b".repeat(14)), pal: { b: "#123456" } });
    expect(m[0].slice(0, 3)).toEqual(["", OUTLINE, "#123456"]);
  });
  it("resolve any item id — clothes, fish, gear — and nothing else", () => {
    expect(iconMatrixFor("hat_nonla")).toHaveLength(16);
    expect(iconMatrixFor("ca_ho")).toHaveLength(16);
    expect(iconMatrixFor("rod_carbon")?.[0]).toHaveLength(16);
    expect(iconMatrixFor("nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/game-fish-art.test.ts`
Expected: FAIL — `@/lib/game/art/fish` not found.

- [ ] **Step 3: Append the generic icon helpers to `lib/game/art/icons.ts`**

Add at the top, next to the existing imports:

```ts
import { FISH_ICONS } from "./fish";
import { GEAR_ICONS } from "./gear";
```

Append at the end of the file:

```ts
/** A 16×16 icon with its own palette ("." transparent, "o" outline) — fish and gear (v14). */
export interface PixelIcon { rows: readonly string[]; pal: Readonly<Record<string, string>> }

/** 16×16 CSS colours ("" = transparent). */
export function pixelIconMatrix(icon: PixelIcon): string[][] {
  return icon.rows.map((row) => [...row].map((ch) => (ch === "." ? "" : ch === "o" ? OUTLINE : icon.pal[ch] ?? "")));
}

/** Any item's icon: clothing (catalog), fish species or fishing gear; null for an unknown id. */
export function iconMatrixFor(id: string): string[][] | null {
  const clothing = itemIconMatrix(id);
  if (clothing) return clothing;
  const icon = FISH_ICONS[id] ?? GEAR_ICONS[id];
  return icon ? pixelIconMatrix(icon) : null;
}
```

(`fish.ts` and `gear.ts` import only the `PixelIcon` *type* from `icons.ts`, so there is no runtime import cycle.)

- [ ] **Step 4: Create `lib/game/art/fish.ts`**

```ts
import type { PixelIcon } from "./icons";

// 16×16 icons for the twelve species (spec §11): "." transparent, "o" outline, other letters from the
// icon's own palette. Original art — distinct silhouettes per species.

export const FISH_ICONS: Record<string, PixelIcon> = {
  ca_ro: {
    rows: [
      "................",
      "................",
      "....o.o.o.o.....",
      "...ofofofofo....",
      "..obbbbbbbbbo.oo",
      ".obbbbbbbbbbbofo",
      "obkbbbbbbbbbbfFo",
      "obbbbbbbbbbsbfFo",
      "owbbbbbbbbbbbfFo",
      "owwbbbbbbbbbbfFo",
      ".owwwwwbbbbbbofo",
      "..oowwwwwwboo.oo",
      "....oooooooo....",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#7d8a3c", w: "#c9c27a", f: "#5f6b2a", F: "#4a5520", k: "#1a1410", s: "#2f3316" },
  },
  ca_sac: {
    rows: [
      "................",
      "................",
      "................",
      "....ooooooo.....",
      "..oobbbbbbboo.oo",
      ".obbsbbbsbbbbofo",
      "obkbbsbbbsbbbfFo",
      "obbbsbbbsbbbbfFo",
      "owbbbsbbbsbbbfFo",
      "owwbbbsbbbsbbfFo",
      ".owwwwwsbbbsbofo",
      "..oowwwwwbboo.oo",
      "....ooooooo.....",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#8f9d5c", w: "#dcd6a4", f: "#6a7a3e", F: "#56642f", k: "#1a1410", s: "#3e4a26" },
  },
  ca_me_vinh: {
    rows: [
      "................",
      "................",
      ".......oo.......",
      "......offo......",
      "....oobffboo..oo",
      "...obbbbbbbo.ofo",
      "..obbbbbbbbbbofo",
      ".obkbbbbbbbbbfFo",
      "obbbbbbbbbbbbfFo",
      "owbbbbbbbbbbbfFo",
      "owwbbbbbbbbbbfFo",
      ".owwwwbbbbbbbofo",
      "..owwwwwwbbbo.oo",
      "...oooffoooo....",
      ".....oo.........",
      "................",
    ],
    pal: { b: "#c3c8d4", w: "#eef0f5", f: "#e8a13a", F: "#c47a22", k: "#1a1410" },
  },
  ca_loc: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "..oooooooooooo..",
      ".obbbbbbbbbbbboo",
      "obebbsbbbsbbbbfo",
      "obbbsssbbsssbbFo",
      "owwbbbbbbbbbbbFo",
      ".owwwwwwwwwwwbfo",
      "..ooooooooooooo.",
      "................",
      "................",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#5e5140", w: "#b9ad8c", f: "#4a4032", F: "#393126", e: "#f2e6c8", s: "#2b241b" },
  },
  ca_tre: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      ".....oooooooooo.",
      "o...obbbbbbbbbbo",
      ".o.obkbbbbbbbbfo",
      "..obbbbbbbbbbbFo",
      ".o.owwbbbbbbbbFo",
      "o...owwwwwwwwbfo",
      ".....oooooooooo.",
      "................",
      "................",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#b8913a", w: "#ead9a2", f: "#8a6a28", F: "#6e5420", k: "#1a1410" },
  },
  ca_chep: {
    rows: [
      "................",
      "................",
      ".....oooo.......",
      "....offffoo.....",
      "...obbbbbbbbo.oo",
      "..obbsbbsbbbbofo",
      ".obkbbbsbbsbbfFo",
      "obbbbsbbsbbsbbfo",
      "owbbbbbsbbsbbfFo",
      "owwwbsbbsbbbbofo",
      ".owwwwwbbbbboo.o",
      "..oowwwwwwoo....",
      "....oofooo......",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#e0a431", w: "#f6dc8c", f: "#e0662f", F: "#b84a1f", k: "#1a1410", s: "#b87a1c" },
  },
  ca_tra: {
    rows: [
      "................",
      "................",
      "................",
      ".......o........",
      "......ofo.......",
      "...ooobbbooo..oo",
      "..obbbbbbbbo.ofo",
      ".obkbbbbbbbbbofo",
      "obbbbbbbbbbbbbfo",
      "owwwbbbbbbbbbbfo",
      ".owwwwwwwwbbbofo",
      "o.oooooooooo.ofo",
      "..............oo",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#6f7a84", w: "#c9d0d6", f: "#4a535c", F: "#3a4148", k: "#101418" },
  },
  ca_that_lat: {
    rows: [
      "................",
      "................",
      "................",
      ".....ooooo......",
      "...oobbbbboo....",
      "..obbbbbbbbbo...",
      ".obkbbbbbbbbboo.",
      "obbbbbbbbbbbbbbo",
      "owwwwbbbbbbbbbbo",
      ".owwwwwwwbbbbbfo",
      "..offfffffffffo.",
      "...ooooooooooo..",
      "................",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#a89a78", w: "#e4dcc4", f: "#8a7a58", F: "#6e6044", k: "#1a1410" },
  },
  tom_cang: {
    rows: [
      "................",
      "o..............o",
      ".o..ooooo.....o.",
      "..oobbbbbooo.o..",
      "...obkbbbbbboo..",
      "..obbbbsbbsbbbo.",
      ".occobbbsbbsbbbo",
      "occco.obbbbbbbbo",
      ".oo....obbbbbbo.",
      "..........obbbo.",
      "..........offfo.",
      ".........offfo..",
      "..........ooo...",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#d98a5a", w: "#f2c49a", f: "#c96a3a", F: "#a8522a", k: "#1a1410", s: "#b86a3e", c: "#3d6fd1" },
  },
  ca_bong_lau: {
    rows: [
      "................",
      "................",
      "................",
      ".......o........",
      "......ofo.......",
      "...ooobbbooo..oo",
      "..obbbbbbbbo.ofo",
      ".obkbbbbbbbbbofo",
      "obbbbbbbbbbbbbfo",
      "owwwbbbbbbbbbbfo",
      ".owwwwwwwwbbbofo",
      "o.oooooooooo.ofo",
      "..............oo",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#b9c3c9", w: "#f0f3f4", f: "#e3c65a", F: "#b89a34", k: "#101418" },
  },
  ca_he_vang: {
    rows: [
      "................",
      "................",
      ".......oo.......",
      "......okfo......",
      "....oobffboo..oo",
      "...obbbbbbbo.ofo",
      "..obbbbbbbbbbofo",
      ".obkbbbbbbbbbfFo",
      "obbbbbbbbbbbbfFo",
      "owbbbbbbbbbbbfFo",
      "owwbbbbbbbbbbfFo",
      ".owwwwbbbbbbbofo",
      "..owwwwwwbbbo.oo",
      "...oooffoooo....",
      ".....oo.........",
      "................",
    ],
    pal: { b: "#e8c24a", w: "#f7e7a8", f: "#d8432f", F: "#a82f22", k: "#1a1410" },
  },
  ca_ho: {
    rows: [
      "................",
      "......oooo......",
      "....oobbbboo....",
      "...obbsbbsbbo..o",
      "..obbbbsbbsbo.oo",
      ".obbsbbbsbbsbofo",
      "obkbbbsbbbsbbfFo",
      "obbbbbbbsbbbsfFo",
      "owwbbsbbbsbbbfFo",
      "owwwwbbsbbbsbofo",
      ".owwwwwwbbbbo.oo",
      "..oowwwwwwwoo..o",
      "....ooooooo.....",
      "................",
      "................",
      "................",
    ],
    pal: { b: "#8d949c", w: "#d9dde1", f: "#6a7078", F: "#50555c", k: "#101418", s: "#6e757c" },
  },
};
```

- [ ] **Step 5: Create `lib/game/art/gear.ts`**

```ts
import type { PixelIcon } from "./icons";

// 16×16 icons for the fishing gear (spec §11): 3 rods, 3 bobbers, 3 baits, the bait box and 2 buckets.
// "." transparent, "o" outline, other letters from the icon's own palette. Original art.

export const GEAR_ICONS: Record<string, PixelIcon> = {
  rod_wood: {
    rows: [
      "..............oo",
      ".............o.l",
      "............o..l",
      "...........rr..l",
      "..........rr...l",
      ".........rr....l",
      "........rr.....l",
      ".......rr......k",
      "......rr........",
      ".....rr.........",
      "..oorr..........",
      ".oyyoo..........",
      ".oyyo...........",
      "..oor...........",
      "...hh...........",
      "..hh............",
    ],
    pal: { r: "#8b5a33", h: "#5a381e", y: "#c9ccd6", l: "#e8e4d8", k: "#9aa0a8" },
  },
  rod_bamboo: {
    rows: [
      "..............oo",
      ".............o.l",
      "............o..l",
      "...........rg..l",
      "..........rr...l",
      ".........gr....l",
      "........rr.....l",
      ".......rg......k",
      "......rr........",
      ".....gr.........",
      "..oorr..........",
      ".oyyoo..........",
      ".oyyo...........",
      "..oor...........",
      "...hh...........",
      "..hh............",
    ],
    pal: { r: "#b7c65a", g: "#6f8a2a", h: "#8a6a28", y: "#c9ccd6", l: "#e8e4d8", k: "#9aa0a8" },
  },
  rod_carbon: {
    rows: [
      "..............oo",
      ".............o.l",
      "............o..l",
      "...........rr..l",
      "..........rr...l",
      ".........rb....l",
      "........rr.....l",
      ".......br......k",
      "......rr........",
      ".....rr.........",
      "..oorr..........",
      ".oyyoo..........",
      ".oyyo...........",
      "..oor...........",
      "...hh...........",
      "..hh............",
    ],
    pal: { r: "#2a2f3a", b: "#3d6fd1", h: "#c0392b", y: "#e8e8ee", l: "#e8e4d8", k: "#9aa0a8" },
  },
  bobber_feather: {
    rows: [
      "................",
      "........o.......",
      ".......owo......",
      "......owwwo.....",
      "......owgwo.....",
      ".....owwgwwo....",
      ".....owwgwwo....",
      ".....owwgwwo....",
      "......owgwo.....",
      "......owgwo.....",
      ".......oro......",
      ".......oro......",
      ".......oro......",
      "........o.......",
      "........o.......",
      "................",
    ],
    pal: { w: "#f4f1ea", g: "#b9ae98", r: "#c0392b" },
  },
  bobber_foam: {
    rows: [
      "................",
      "........o.......",
      ".......oko......",
      ".......oko......",
      "......orrro.....",
      ".....orrrrro....",
      ".....orRrrro....",
      ".....owwwwwo....",
      ".....owwwwwo....",
      "......owwwo.....",
      ".......oko......",
      ".......oko......",
      "........o.......",
      "................",
      "................",
      "................",
    ],
    pal: { r: "#d8433a", R: "#f08a80", w: "#f4f1ea", k: "#5a381e" },
  },
  bobber_lamp: {
    rows: [
      "....l.....l.....",
      ".....l.o.l......",
      ".......y........",
      "...l..oyo..l....",
      ".......y........",
      "......ogo.......",
      ".....orrro......",
      ".....orRro......",
      ".....orrro......",
      ".....owwwo......",
      ".....owwwo......",
      "......owo.......",
      ".......k........",
      ".......k........",
      "................",
      "................",
    ],
    pal: { y: "#ffe08a", l: "#ffd166", g: "#9aa0a8", r: "#d8433a", R: "#f08a80", w: "#f4f1ea", k: "#5a381e" },
  },
  bait_worm: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "..........oo....",
      ".........oppo...",
      "..oo....oppPo...",
      ".oppo..oppPo....",
      "oppPpooppPo.....",
      "opPPppppPo......",
      ".oPPPppPo.......",
      "..ooPPoo........",
      "....oo..........",
      "................",
      "................",
      "................",
    ],
    pal: { p: "#e98a9a", P: "#c9687a" },
  },
  bait_shrimp: {
    rows: [
      "................",
      "................",
      "................",
      "o...............",
      ".o..ooooo.......",
      "..oopppppoo.....",
      "...opkppppppo...",
      "...opppPpppPpo..",
      "....ooppPpppPpo.",
      "......oopppPppo.",
      "........ooppppo.",
      "..........oooffo",
      ".............ooo",
      "................",
      "................",
      "................",
    ],
    pal: { p: "#f29a6a", P: "#d9774a", k: "#1a1410", f: "#e0662f" },
  },
  bait_bloodworm: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      "....r.....r.....",
      "...r.r...r.r..r.",
      "..r...r.r...rr..",
      "..r....r.....r..",
      ".r..r...r...r...",
      "..rr.r...rrr....",
      "......r.........",
      "...oooooooooo...",
      "...oddddddddo...",
      "....oddddddo....",
      ".....oooooo.....",
      "................",
    ],
    pal: { r: "#c0392b", d: "#8b5a33" },
  },
  bait_box: {
    rows: [
      "................",
      "................",
      "................",
      "..oooooooooooo..",
      "..oLLLLLLLLLLo..",
      ".oLLLLLLLLLLLLo.",
      ".oooooooooooooo.",
      ".obbbbbbbbbbbbo.",
      ".obbbbbkkbbbbbo.",
      ".obbbbbkkbbbbbo.",
      ".obBBBBBBBBBBbo.",
      ".obbbbbbbbbbbbo.",
      ".oooooooooooooo.",
      "................",
      "................",
      "................",
    ],
    pal: { L: "#6fa3dc", b: "#3f7fc4", B: "#2f63a0", k: "#e0b33c" },
  },
  bucket_small: {
    rows: [
      "................",
      "................",
      "................",
      "................",
      ".....oooooo.....",
      "....o......o....",
      "...o........o...",
      "...oooooooooo...",
      "...owwwwwwwwo...",
      "...obbbbbbbbo...",
      "....obbBbbbo....",
      "....obbBbbbo....",
      "....obbbbbbo....",
      ".....oooooo.....",
      "................",
      "................",
    ],
    pal: { w: "#6fb2cf", b: "#d8433a", B: "#a82c26" },
  },
  bucket_large: {
    rows: [
      "................",
      "....oooooooo....",
      "...o........o...",
      "..o..........o..",
      "..o...oo.....o..",
      ".ooooofoooooooo.",
      ".owwwwffwwwwwwo.",
      ".obbbbbbbbbbbbo.",
      "..obbBbbbbbBbo..",
      "..obbBbbbbbBbo..",
      "..obbBbbbbbBbo..",
      "..obbbbbbbbbbo..",
      "...obbbbbbbbo...",
      "...oooooooooo...",
      "................",
      "................",
    ],
    pal: { w: "#6fb2cf", b: "#8d949c", B: "#6a7078", f: "#e0a431" },
  },
};
```

- [ ] **Step 6: Let `ItemIcon` draw any icon**

In `components/game/ItemIcon.tsx` change the import to `import { ICON_SIZE, iconMatrixFor } from "@/lib/game/art/icons";`, the doc comment to `/** Any item's 16×16 pixel icon (clothes, fish, gear), drawn crisp at \`scale\`. */`, and `itemIconMatrix(id)?.forEach(` to `iconMatrixFor(id)?.forEach(`.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/unit/game-fish-art.test.ts tests/unit/game-icons.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/art components/game/ItemIcon.tsx tests/unit/game-fish-art.test.ts` — clean.

```bash
git add lib/game/art/fish.ts lib/game/art/gear.ts lib/game/art/icons.ts components/game/ItemIcon.tsx tests/unit/game-fish-art.test.ts
git commit -m "feat(v14): pixel icons for the twelve fish and the fishing gear

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: A map model for several maps (hall refactor, the dock sign becomes a portal)

Pure refactor of the v13 map code so a second map can plug in, with one visible change: the hall's dock sign prompt becomes **"Xuống ao câu cá"** and it is a portal (the pond itself arrives in Tasks 8–9; until Task 13 the shell still answers the portal with the old teaser toast).

**Files:**
- Modify (full replacement): `lib/game/maps/types.ts`, `lib/game/maps/hall.ts`, `lib/game/maps/hall-art.ts`
- Create: `lib/game/maps/rect.ts`, `lib/game/maps/arrivals.ts`, `lib/game/maps/scene-art.ts`, `lib/game/maps/props.ts`
- Modify (edits): `lib/game/scene.ts`, `lib/game/engine.ts`, `lib/game/world.ts`, `lib/game/social.ts`, `components/game/GameCanvas.tsx`, `components/game/GameShell.tsx`
- Test (edits): `tests/unit/helpers/ascii-map.ts`, `tests/unit/game-hall-map.test.ts`, `tests/unit/game-scene.test.ts`, `tests/unit/game-hall-art.test.ts`, `tests/unit/game-world.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `Rect`, `Spot`, `MapId = "hall" | "pond"`, `MAP_IDS`, `InteractKind`, `Interactable { id; kind; label; prompt; rect; use; face?; to?: { map: MapId; arrive: Spot } }`, `Npc { id; name; look; spot }`, `PropPlacement` (the `sign` variant gains `icon?: "fish" | "note"`), `Seating { djSpot; seats; standSpots }`, `GameMap { id: MapId; width; height; cell; cols; rows; blocked; spawn: Spot; seating: Seating | null; interactables; props; npcs }`. `InteractId` is gone.
  - `rect.ts`: `overlaps(a: Rect, b: Rect): boolean` (also re-exported from `hall.ts`).
  - `arrivals.ts`: `HALL_DOCK_ARRIVE: Spot` = `{ x: 516, y: 334, dir: "up" }`, `POND_ARRIVE: Spot` = `{ x: 300, y: 356, dir: "up" }`.
  - `scene-art.ts` (browser helpers + pure types): `SceneArt { background; props: PropSprite[]; edge: string; drawAnimated(ctx, t, camX, camY, reducedMotion); drawOverhead(ctx, t, camX, camY, reducedMotion) }`, `PropSprite`, `PropFrame`, `Ctx`, the palette `C`, `rng(seed)`, `makeCanvas`, `ctx2d`, `rect`, `px`, `hexToRgb`.
  - `props.ts`: `propFrame(p): PropFrame` (pure), `drawProp(c, p)`, `propSprite(p): PropSprite`.
  - `hall.ts`: `HALL_SEATING: Seating`, `HALL_SPAWN: Spot` = `{ x: 612, y: 300, dir: "left" }`, `buildHallMap(): GameMap` (id `"hall"`, `npcs: []`); `hall-art.ts`: `paintHall(map): SceneArt` with `edge = C.waterDeep`.
  - `scene.ts`: `nearestInteractable(map, feet, range?)` now returns `Interactable | null`.
  - `engine.ts`: `GameEngine(canvas, map, art: SceneArt, cb, opts)`; `EngineCallbacks.onInteract(it: Interactable)`, `onPromptChange(it: Interactable | null)`; the local player starts at `map.spawn` facing `map.spawn.dir`.
  - `social.ts`: `RosterInput.map: Seating`.
  - `GameShell`: the prompt button shows `E · {it.prompt}`.

- [ ] **Step 1: Update the tests to the new map model**

**tests/unit/helpers/ascii-map.ts.** Replace:

```ts
    id: "test", width: cols * cell, height: rows.length * cell, cell, cols, rows: rows.length, blocked,
    spawn: { x: 4, y: 4 }, djSpot: { x: 4, y: 4, dir: "down" }, seats: [], standSpots: [], interactables: [], props: [],
```

with:

```ts
    id: "hall", width: cols * cell, height: rows.length * cell, cell, cols, rows: rows.length, blocked,
    spawn: { x: 4, y: 4, dir: "down" }, seating: null, interactables: [], props: [], npcs: [],
```

**tests/unit/game-hall-map.test.ts — edit 1 of 3.** Replace:

```ts
    const spots = [hall.spawn, ...hall.seats, ...hall.standSpots, ...hall.interactables.map((i) => i.use)];
```

with:

```ts
    const seating = hall.seating!;
    const spots = [hall.spawn, ...seating.seats, ...seating.standSpots, ...hall.interactables.map((i) => i.use)];
```

**tests/unit/game-hall-map.test.ts — edit 2 of 3.** Replace:

```ts
  it("has unique interactables with the three v13 ids", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual(["dj_booth", "dock_sign", "notice_board"]);
  });
  it("has six café seats", () => {
    expect(hall.seats).toHaveLength(6);
  });
```

with:

```ts
  it("has unique interactables with the three v13 ids", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual(["dj_booth", "dock_sign", "notice_board"]);
  });
  it("makes the dock sign a portal to the pond, with a prompt for every interactable", () => {
    const dock = hall.interactables.find((i) => i.id === "dock_sign")!;
    expect(dock).toMatchObject({ kind: "portal", prompt: "Xuống ao câu cá", to: { map: "pond", arrive: POND_ARRIVE } });
    for (const i of hall.interactables) expect(i.prompt.length, i.id).toBeGreaterThan(0);
  });
  it("has six café seats and no shopkeepers", () => {
    expect(hall.seating!.seats).toHaveLength(6);
    expect(hall.npcs).toEqual([]);
  });
```

**tests/unit/game-hall-map.test.ts — edit 3 of 3.** Replace:

```ts
import { buildHallMap, HALL_CELL, HALL_H, HALL_W } from "@/lib/game/maps/hall";
```

with:

```ts
import { POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildHallMap, HALL_CELL, HALL_H, HALL_W } from "@/lib/game/maps/hall";
```

**tests/unit/game-scene.test.ts.** Replace:

```ts
    expect(nearestInteractable(hall, { x: 320, y: 152 })).toBe("dj_booth");
```

with:

```ts
    expect(nearestInteractable(hall, { x: 320, y: 152 })?.id).toBe("dj_booth");
```

**tests/unit/game-hall-art.test.ts.** Replace:

```ts
import { propFrame, rng } from "@/lib/game/maps/hall-art";
```

with:

```ts
import { propFrame } from "@/lib/game/maps/props";
import { rng } from "@/lib/game/maps/scene-art";
```

**tests/unit/game-world.test.ts.** Replace every occurrence (3) of:

```ts
    expect(w.actors.get("ann")?.pos).toEqual(map.spawn);
```

with:

```ts
    expect(w.actors.get("ann")?.pos).toEqual({ x: map.spawn.x, y: map.spawn.y });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/game-hall-map.test.ts tests/unit/game-scene.test.ts tests/unit/game-hall-art.test.ts tests/unit/game-world.test.ts`
Expected: FAIL — `@/lib/game/maps/arrivals`, `@/lib/game/maps/props` and `@/lib/game/maps/scene-art` do not exist and `hall.seating` is undefined.

- [ ] **Step 3: Replace `lib/game/maps/types.ts`**

```ts
import type { Facing, Look, Vec } from "@/lib/game/types";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Spot { x: number; y: number; dir: Facing }

export type MapId = "hall" | "pond";
export const MAP_IDS: readonly MapId[] = ["hall", "pond"];

export type InteractKind = "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records";

export interface Interactable {
  /** Unique per map: "dock_sign", "fish_3", … */
  id: string;
  kind: InteractKind;
  /** What it is ("Bến câu cá"). */
  label: string;
  /** The action, shown as "E · {prompt}". */
  prompt: string;
  /** Click target. */
  rect: Rect;
  /** Where the character stands to use it. */
  use: Vec;
  /** fish_spot: the direction of the water. */
  face?: Facing;
  /** portal: where it leads. */
  to?: { map: MapId; arrive: Spot };
}

/** A shopkeeper: a static character with a name tag. */
export interface Npc { id: string; name: string; look: Look; spot: Spot }

/** Things that are drawn as depth-sorted sprites (anchor = base point, sort by y). */
export type PropPlacement =
  | { kind: "palm"; x: number; y: number; h: number; lean: number; seed: number }
  | { kind: "hammock"; x: number; y: number; x2: number }
  | { kind: "post"; x: number; y: number }
  | { kind: "table"; x: number; y: number }
  | { kind: "mixer"; x: number; y: number }
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number; icon?: "fish" | "note" }
  | { kind: "banana"; x: number; y: number }
  | { kind: "lightpole"; x: number; y: number };

/** Where classic-mode members are shown (the hall only). */
export interface Seating {
  /** A classic-mode DJ stands behind the mixer. */
  djSpot: Spot;
  /** Other classic-mode members, behind the café tables. */
  seats: Spot[];
  /** Overflow when every seat is taken. */
  standSpots: Spot[];
}

export interface GameMap {
  id: MapId;
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  /** cols × rows, 1 = blocked. */
  blocked: Uint8Array;
  /** Where you appear when nothing else says so (entering game mode, a lost arrival). */
  spawn: Spot;
  seating: Seating | null;
  interactables: Interactable[];
  props: PropPlacement[];
  npcs: Npc[];
}
```

- [ ] **Step 4: Create `lib/game/maps/rect.ts` and `lib/game/maps/arrivals.ts`**

`lib/game/maps/rect.ts`:

```ts
import type { Rect } from "./types";

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}
```

`lib/game/maps/arrivals.ts`:

```ts
import type { Spot } from "./types";

// Where the portals drop you. Kept apart from the maps so hall.ts and pond.ts never import each other.

/** On the hall's dock, in front of the "Bến câu cá" sign. */
export const HALL_DOCK_ARRIVE: Spot = { x: 516, y: 334, dir: "up" };

/** At the pond's entrance, beside the "Bến vào" sign. */
export const POND_ARRIVE: Spot = { x: 300, y: 356, dir: "up" };
```

- [ ] **Step 5: Split the hall painter — create `lib/game/maps/scene-art.ts` and `lib/game/maps/props.ts`, replace `lib/game/maps/hall-art.ts`**

The shared palette, RNG and pixel helpers move to `scene-art.ts`; every depth-sorted prop (frames + painters) moves to `props.ts`; the sign painter learns a music-note icon for the pond's "Bến vào" sign. The hall painter keeps its ground, river, bamboo, stage and counter code unchanged.

`lib/game/maps/scene-art.ts`:

```ts
// Shared helpers for the procedural scene painters (browser only: canvas). 1 world px = 1 canvas px, and a seeded RNG
// paints the same scene on every client. Original art in the approved Miền Tây style — no copied images.

export interface PropSprite { canvas: HTMLCanvasElement; x: number; y: number; sortY: number }

/** A painted map: what the engine draws every frame. */
export interface SceneArt {
  /** Static ground, 1 world px per canvas px. */
  background: HTMLCanvasElement;
  /** Depth-sorted sprites: world top-left + sort y (= the prop's base). */
  props: PropSprite[];
  /** Colour shown past the map's bottom edge (the camera may scroll there so the bottom HUD hides nothing). */
  edge: string;
  /** Per-frame ground animation, drawn in world coordinates minus the camera. */
  drawAnimated(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
  /** Drawn above the characters (string lights, awnings, roofs). */
  drawOverhead(ctx: CanvasRenderingContext2D, t: number, camX: number, camY: number, reducedMotion: boolean): void;
}

/** Sprite canvas size and the anchor (the prop's base point) inside it. Pure. */
export interface PropFrame { w: number; h: number; ox: number; oy: number }

export type Ctx = CanvasRenderingContext2D;

export const C = {
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

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  return cv;
}

export function ctx2d(cv: HTMLCanvasElement): Ctx {
  const c = cv.getContext("2d");
  if (!c) throw new Error("canvas-2d-unavailable");
  return c;
}

export function rect(c: Ctx, col: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

export function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
```

`lib/game/maps/props.ts`:

```ts
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type PropFrame, type PropSprite } from "./scene-art";
import type { PropPlacement } from "./types";

// Every depth-sorted prop of every map: its sprite frame (pure) and its painter (browser only).

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

const SIGN_ICONS: Record<"fish" | "note", { rows: string[]; color: string; x: number; y: number }> = {
  fish: { rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 },
  note: { rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 },
};

/** A signpost with a pixel icon: a fish (the hall's "Bến câu cá") or a music note (the pond's "Bến vào"). */
function drawSign(c: Ctx, icon: "fish" | "note"): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
  rect(c, C.outline, 0, 0, 18, 12); rect(c, C.woodLight, 1, 1, 16, 10);
  const ic = SIGN_ICONS[icon];
  ic.rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, ic.color, ic.x + i, ic.y + j);
  });
  if (icon === "fish") px(c, C.white, 6, 5);
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

export function drawProp(c: Ctx, p: PropPlacement): void {
  switch (p.kind) {
    case "palm": return drawPalm(c, p.h, p.lean, p.seed);
    case "hammock": return drawHammock(c, p.x, p.y, p.x2);
    case "post": return drawPost(c);
    case "mixer": return drawMixer(c);
    case "table": return drawTable(c);
    case "board": return drawBoard(c);
    case "sign": return drawSign(c, p.icon ?? "fish");
    case "banana": return drawBanana(c);
    case "lightpole": return drawLightPole(c);
  }
}

export function propSprite(p: PropPlacement): PropSprite {
  const f = propFrame(p);
  const canvas = makeCanvas(f.w, f.h);
  drawProp(ctx2d(canvas), p);
  return { canvas, x: p.x - f.ox, y: p.y - f.oy, sortY: p.y };
}
```

`lib/game/maps/hall-art.ts` (full replacement):

```ts
import { HALL_H, HALL_W, LIGHT_STRINGS, hallShoreY } from "./hall";
import { propSprite } from "./props";
import { C, ctx2d, hexToRgb, makeCanvas, px, rect, rng, type Ctx, type SceneArt } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painters for the hall ("quán cà phê võng ven sông"). Browser only (canvas). Props live in props.ts,
// shared helpers in scene-art.ts. Original art in the approved Miền Tây style — no copied images.

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

// ---------------------------------------------------------------- public

/** Paint the hall once. Throws "canvas-2d-unavailable" when the browser has no 2D canvas. */
export function paintHall(map: GameMap): SceneArt {
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

  return { background, props, edge: C.waterDeep, drawAnimated, drawOverhead };
}
```

- [ ] **Step 6: Replace `lib/game/maps/hall.ts`**

```ts
import { POND_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
import type { GameMap, Interactable, PropPlacement, Rect, Seating, Spot } from "./types";

export { overlaps };

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
  { id: "dj_booth", kind: "dj_booth", label: "Quầy DJ", prompt: "Mở hàng đợi", rect: { x: 296, y: 106, w: 48, h: 34 }, use: { x: 320, y: 152 } },
  { id: "notice_board", kind: "notice_board", label: "Bảng tin", prompt: "Xem bảng tin", rect: { x: 582, y: 228, w: 28, h: 34 }, use: { x: 596, y: 270 } },
  {
    id: "dock_sign", kind: "portal", label: "Bến câu cá", prompt: "Xuống ao câu cá", rect: { x: 482, y: 300, w: 18, h: 24 },
    use: { x: 516, y: 334 }, to: { map: "pond", arrive: POND_ARRIVE },
  },
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
export const HALL_SEATING: Seating = { djSpot: HALL_DJ_SPOT, seats: HALL_SEATS, standSpots: HALL_STAND_SPOTS };
/** Entering game mode: the dirt path at the east edge, facing into the café. */
export const HALL_SPAWN: Spot = { x: 612, y: 300, dir: "left" };

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
    spawn: HALL_SPAWN, seating: HALL_SEATING, interactables: HALL_INTERACTABLES, props: HALL_PROPS, npcs: [],
  };
}
```

- [ ] **Step 7: Move the engine, world, roster and shell to the new types**

**lib/game/scene.ts — edit 1 of 3.** Replace:

```ts
import type { GameMap, Interactable, InteractId } from "@/lib/game/maps/types";
```

with:

```ts
import type { GameMap, Interactable } from "@/lib/game/maps/types";
```

**lib/game/scene.ts — edit 2 of 3.** Replace:

```ts
export function nearestInteractable(map: GameMap, feet: Vec, range = PROMPT_RANGE): InteractId | null {
  let best: InteractId | null = null;
```

with:

```ts
export function nearestInteractable(map: GameMap, feet: Vec, range = PROMPT_RANGE): Interactable | null {
  let best: Interactable | null = null;
```

**lib/game/scene.ts — edit 3 of 3.** Replace:

```ts
      best = i.id;
```

with:

```ts
      best = i;
```

**lib/game/engine.ts — edit 1 of 10.** Replace:

```ts
import type { HallArt } from "@/lib/game/maps/hall-art";
import type { GameMap, InteractId } from "@/lib/game/maps/types";
```

with:

```ts
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { GameMap, Interactable } from "@/lib/game/maps/types";
```

**lib/game/engine.ts — edit 2 of 10.** Replace:

```ts
  onInteract: (id: InteractId) => void;
  onPromptChange: (id: InteractId | null) => void;
```

with:

```ts
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
```

**lib/game/engine.ts — edit 3 of 10.** Replace:

```ts
  private readonly art: HallArt;
```

with:

```ts
  private readonly art: SceneArt;
```

**lib/game/engine.ts — edit 4 of 10.** Replace:

```ts
  private pendingInteract: InteractId | null = null;
  private prompt: InteractId | null = null;
```

with:

```ts
  private pendingInteract: Interactable | null = null;
  private prompt: Interactable | null = null;
```

**lib/game/engine.ts — edit 5 of 10.** Replace:

```ts
  constructor(canvas: HTMLCanvasElement, map: GameMap, art: HallArt, cb: EngineCallbacks, opts: EngineOptions) {
```

with:

```ts
  constructor(canvas: HTMLCanvasElement, map: GameMap, art: SceneArt, cb: EngineCallbacks, opts: EngineOptions) {
```

**lib/game/engine.ts — edit 6 of 10.** Replace:

```ts
    this.local = createActor(opts.localId, { ...map.spawn }, "left", performance.now());
```

with:

```ts
    this.local = createActor(opts.localId, { x: map.spawn.x, y: map.spawn.y }, map.spawn.dir, performance.now());
```

**lib/game/engine.ts — edit 7 of 10.** Replace:

```ts
  private trigger(id: InteractId): void {
    this.pendingInteract = null;
    this.cb.onInteract(id);
  }
```

with:

```ts
  private trigger(it: Interactable): void {
    this.pendingInteract = null;
    this.cb.onInteract(it);
  }
```

**lib/game/engine.ts — edit 8 of 10.** Replace:

```ts
    if (it) {
      if (inUseRange(it, this.local.pos)) {
        this.trigger(it.id);
        return;
      }
      this.pendingInteract = it.id;
```

with:

```ts
    if (it) {
      if (inUseRange(it, this.local.pos)) {
        this.trigger(it);
        return;
      }
      this.pendingInteract = it;
```

**lib/game/engine.ts — edit 9 of 10.** Replace:

```ts
    if (arrived && this.pendingInteract) {
      const id = this.pendingInteract;
      this.pendingInteract = null;
      // a long walk can end early (smoothPath caps the waypoints) — only trigger when we really got there
      const it = this.map.interactables.find((i) => i.id === id);
      if (it && inUseRange(it, this.local.pos)) this.cb.onInteract(id);
    }
```

with:

```ts
    if (arrived && this.pendingInteract) {
      const it = this.pendingInteract;
      this.pendingInteract = null;
      // a long walk can end early (smoothPath caps the waypoints) — only trigger when we really got there
      if (inUseRange(it, this.local.pos)) this.cb.onInteract(it);
    }
```

**lib/game/engine.ts — edit 10 of 10.** Replace:

```ts
    b.fillStyle = "#2f6e8f";
    b.fillRect(0, 0, this.vw, this.vh);
```

with:

```ts
    b.fillStyle = this.art.edge;
    b.fillRect(0, 0, this.vw, this.vh);
```

**lib/game/world.ts.** Replace:

```ts
    const a = createActor(id, { ...this.map.spawn }, "left", now);
```

with:

```ts
    const a = createActor(id, { x: this.map.spawn.x, y: this.map.spawn.y }, "left", now);
```

**lib/game/social.ts — edit 1 of 2.** Replace:

```ts
import type { GameMap } from "@/lib/game/maps/types";
```

with:

```ts
import type { Seating } from "@/lib/game/maps/types";
```

**lib/game/social.ts — edit 2 of 2.** Replace:

```ts
  map: Pick<GameMap, "djSpot" | "seats" | "standSpots">;
```

with:

```ts
  map: Seating;
```

**components/game/GameCanvas.tsx — edit 1 of 2.** Replace:

```tsx
import type { InteractId } from "@/lib/game/maps/types";
```

with:

```tsx
import type { Interactable } from "@/lib/game/maps/types";
```

**components/game/GameCanvas.tsx — edit 2 of 2.** Replace:

```tsx
  onInteract: (id: InteractId) => void;
  onPromptChange: (id: InteractId | null) => void;
```

with:

```tsx
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
```

**components/game/GameShell.tsx — edit 1 of 6.** Replace:

```tsx
import { HALL_DJ_SPOT, HALL_SEATS, HALL_STAND_SPOTS } from "@/lib/game/maps/hall";
import type { InteractId } from "@/lib/game/maps/types";
```

with:

```tsx
import { HALL_SEATING } from "@/lib/game/maps/hall";
import type { Interactable } from "@/lib/game/maps/types";
```

**components/game/GameShell.tsx — edit 2 of 6.** Replace:

```tsx
const HALL_SPOTS = { djSpot: HALL_DJ_SPOT, seats: HALL_SEATS, standSpots: HALL_STAND_SPOTS };
const PROMPT_TEXT: Record<InteractId, string> = {
  dj_booth: "Mở hàng đợi",
  notice_board: "Xem bảng tin",
  dock_sign: "Bến câu cá",
};
```

with nothing (delete these lines, including the blank line after them).

**components/game/GameShell.tsx — edit 3 of 6.** Replace:

```tsx
  const [prompt, setPrompt] = useState<InteractId | null>(null);
```

with:

```tsx
  const [prompt, setPrompt] = useState<Interactable | null>(null);
```

**components/game/GameShell.tsx — edit 4 of 6.** Replace:

```tsx
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks, map: HALL_SPOTS,
```

with:

```tsx
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks, map: HALL_SEATING,
```

**components/game/GameShell.tsx — edit 5 of 6.** Replace:

```tsx
  const onInteract = useCallback((id: InteractId) => {
    if (id === "dj_booth") setPanel("queue");
    else if (id === "notice_board") setPanel("board");
    else showToast("Ao câu cá sắp mở — hẹn bản sau!");
  }, [showToast]);
```

with:

```tsx
  const onInteract = useCallback((it: Interactable) => {
    if (it.kind === "dj_booth") setPanel("queue");
    else if (it.kind === "notice_board") setPanel("board");
    else showToast("Ao câu cá sắp mở — hẹn bản sau!");
  }, [showToast]);
```

**components/game/GameShell.tsx — edit 6 of 6.** Replace:

```tsx
          {PROMPT_TEXT[prompt]}
```

with:

```tsx
          {prompt.prompt}
```

- [ ] **Step 8: Run the tests, typecheck and lint**

Run: `pnpm vitest run` — all green; the new test "makes the dock sign a portal to the pond…" passes, so the count is the Task 6 count + 1.
Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game components/game tests/unit/helpers tests/unit/game-*.test.ts` (clean).

- [ ] **Step 9: Commit**

```bash
git add lib/game/maps lib/game/scene.ts lib/game/engine.ts lib/game/world.ts lib/game/social.ts components/game/GameCanvas.tsx components/game/GameShell.tsx tests/unit/helpers/ascii-map.ts tests/unit/game-hall-map.test.ts tests/unit/game-scene.test.ts tests/unit/game-hall-art.test.ts tests/unit/game-world.test.ts
git commit -m "refactor(v14): map model for several maps; the dock sign becomes a portal

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The pond map — layout, collision, spots and NPCs

**Files:**
- Create: `lib/game/maps/pond.ts`
- Modify: `lib/game/maps/types.ts` (three new prop kinds), `lib/game/maps/props.ts` (their sprite frames)
- Test: `tests/unit/game-pond-map.test.ts`

**Interfaces:**
- Consumes: `CO_BA_LOOK`, `CHU_TU_LOOK` (Task 1); `bobberPoint` (Task 5, tests only); `HALL_DOCK_ARRIVE`, `POND_ARRIVE`, `overlaps`, the map types (Task 7).
- Produces: `POND_W`/`POND_H` (640 × 400), `POND_CELL` (8), `POND_CX/CY/RX/RY` (300, 180, 180, 105), `pondEdge(angle)`, `inPond(x, y, grow?)`, `inDirtPatch(x, y)`, `POND_PLATFORM: Rect[]`, `onPlatform(x, y)`, `POND_SOLIDS`, `POND_FISH_SPOTS: Spot[]`, `DIG_MOUNDS: Vec[]`, `POND_INTERACTABLES`, `POND_NPCS`, `POND_PROPS`, `buildPondMap(): GameMap` (id `"pond"`, `spawn = POND_ARRIVE`, `seating: null`). Interactable ids: `pond_exit`, `fish_1`…`fish_6` (kind `fish_spot`, with `face`), `dig_1`…`dig_4`, `depot`, `shop`, `records`. `PropPlacement` gains `stall_front`, `hut_front`, `records` (frames 108×30, 108×26, 28×34; their painters come in Task 9).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/game-pond-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { bobberPoint } from "@/lib/game/fishing/geometry";
import { HALL_DOCK_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildPondMap, DIG_MOUNDS, inDirtPatch, inPond, onPlatform, pondEdge } from "@/lib/game/maps/pond";
import { propFrame } from "@/lib/game/maps/props";
import type { InteractKind } from "@/lib/game/maps/types";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";

const pond = buildPondMap();
const ofKind = (k: InteractKind) => pond.interactables.filter((i) => i.kind === k);
const within = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
  p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

describe("pond map", () => {
  it("has the documented size, grid and interactables", () => {
    expect(pond.id).toBe("pond");
    expect([pond.width, pond.height, pond.cell, pond.cols, pond.rows]).toEqual([640, 400, 8, 80, 50]);
    expect(pond.blocked).toHaveLength(80 * 50);
    expect(pond.seating).toBeNull();
    expect(pond.spawn).toEqual(POND_ARRIVE);
    expect(pond.interactables.map((i) => i.id).sort()).toEqual([
      "depot", "dig_1", "dig_2", "dig_3", "dig_4", "fish_1", "fish_2", "fish_3", "fish_4", "fish_5", "fish_6",
      "pond_exit", "records", "shop",
    ]);
  });
  it("uses the spec's prompts", () => {
    const prompt = (id: string) => pond.interactables.find((i) => i.id === id)?.prompt;
    expect(prompt("pond_exit")).toBe("Về sảnh nhạc");
    expect(prompt("fish_1")).toBe("Quăng cần");
    expect(prompt("dig_1")).toBe("Đào trùn");
    expect(prompt("depot")).toBe("Bán cá · cô Ba");
    expect(prompt("shop")).toBe("Tiệm đồ câu · chú Tư");
    expect(prompt("records")).toBe("Xem bảng kỷ lục");
  });
  it("keeps the arrival spot and every use spot walkable and reachable from the arrival", () => {
    for (const s of [POND_ARRIVE, ...pond.interactables.map((i) => i.use)]) {
      expect(isBlockedAt(pond, s.x, s.y), JSON.stringify(s)).toBe(false);
      expect(findPath(pond, POND_ARRIVE, s), JSON.stringify(s)).not.toBeNull();
    }
  });
  it("leads back to the hall's dock", () => {
    expect(ofKind("portal")).toEqual([expect.objectContaining({ id: "pond_exit", to: { map: "hall", arrive: HALL_DOCK_ARRIVE } })]);
  });
  it("puts six fishing spots on the platform, ≥ 40 px apart, each casting into open water it can be clicked on", () => {
    const spots = ofKind("fish_spot");
    expect(spots).toHaveLength(6);
    for (const s of spots) {
      expect(s.face, s.id).toBeDefined();
      expect(onPlatform(s.use.x, s.use.y), s.id).toBe(true);
      const b = bobberPoint(s.use, s.face!);
      expect(inPond(b.x, b.y), s.id).toBe(true);
      expect(onPlatform(b.x, b.y), s.id).toBe(false);
      expect(isBlockedAt(pond, b.x, b.y), s.id).toBe(true);
      expect(within(b, s.rect), s.id).toBe(true);
      for (const o of spots) {
        if (o !== s) expect(Math.hypot(o.use.x - s.use.x, o.use.y - s.use.y), `${s.id}/${o.id}`).toBeGreaterThanOrEqual(40);
      }
    }
  });
  it("keeps the four dig spots on the dirt patch, ≥ 32 px apart", () => {
    const digs = ofKind("dig_spot");
    expect(digs).toHaveLength(4);
    for (const m of DIG_MOUNDS) {
      expect(inDirtPatch(m.x, m.y)).toBe(true);
      for (const o of DIG_MOUNDS) if (o !== m) expect(Math.hypot(o.x - m.x, o.y - m.y)).toBeGreaterThanOrEqual(32);
    }
    for (const d of digs) expect(inDirtPatch(d.use.x, d.use.y - 12), d.id).toBe(true);
  });
  it("blocks the water but not the platform, and blocks the stall, the hut and the records board", () => {
    expect(isBlockedAt(pond, 300, 120)).toBe(true);
    expect(isBlockedAt(pond, 300, 212)).toBe(false);
    expect(isBlockedAt(pond, 300, 280)).toBe(false);
    expect(isBlockedAt(pond, 560, 80)).toBe(true);
    expect(isBlockedAt(pond, 570, 250)).toBe(true);
    expect(isBlockedAt(pond, 508, 162)).toBe(true);
  });
  it("puts cô Ba and chú Tư behind their counters, facing down", () => {
    expect(pond.npcs.map((n) => n.name)).toEqual(["cô Ba", "chú Tư"]);
    for (const n of pond.npcs) {
      expect(n.spot.dir).toBe("down");
      expect(isBlockedAt(pond, n.spot.x, n.spot.y), n.name).toBe(true);
    }
  });
  it("keeps the shore within 7 % of the oval and gives every prop a sprite frame", () => {
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      expect(pondEdge(a)).toBeGreaterThan(0.93);
      expect(pondEdge(a)).toBeLessThan(1.07);
    }
    for (const p of pond.props) expect(propFrame(p).w, p.kind).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/game-pond-map.test.ts`
Expected: FAIL — `Cannot find module '@/lib/game/maps/pond'`.

- [ ] **Step 3: Add the pond's prop kinds and their frames**

**lib/game/maps/types.ts.** Replace:

```ts
  | { kind: "banana"; x: number; y: number }
  | { kind: "lightpole"; x: number; y: number };
```

with:

```ts
  | { kind: "banana"; x: number; y: number }
  | { kind: "lightpole"; x: number; y: number }
  | { kind: "stall_front"; x: number; y: number }
  | { kind: "hut_front"; x: number; y: number }
  | { kind: "records"; x: number; y: number };
```

**lib/game/maps/props.ts.** Replace:

```ts
    case "lightpole": return { w: 6, h: 42, ox: 3, oy: 42 };
  }
```

with:

```ts
    case "lightpole": return { w: 6, h: 42, ox: 3, oy: 42 };
    case "stall_front": return { w: 108, h: 30, ox: 54, oy: 30 };
    case "hut_front": return { w: 108, h: 26, ox: 54, oy: 26 };
    case "records": return { w: 28, h: 34, ox: 14, oy: 34 };
  }
```

(`drawProp` has no painter for them yet; it draws nothing for these kinds until Task 9.)

- [ ] **Step 4: Create `lib/game/maps/pond.ts`**

The coordinates come from the approved browser prototype (reachability, bobbers in open water and NPCs inside blocked cells were checked there and are pinned by the test).

`lib/game/maps/pond.ts`:

```ts
import { CHU_TU_LOOK, CO_BA_LOOK } from "@/lib/game/look";
import type { Vec } from "@/lib/game/types";
import { HALL_DOCK_ARRIVE, POND_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PropPlacement, Rect, Spot } from "./types";

// "Ao cá": the Miền Tây fishing pond (spec §5.3). Pure layout + collision; the painter is pond-art.ts.

export const POND_W = 640;
export const POND_H = 400;
export const POND_CELL = 8;

/** The pond is an irregular oval around (POND_CX, POND_CY). */
export const POND_CX = 300;
export const POND_CY = 180;
export const POND_RX = 180;
export const POND_RY = 105;

/** Radius factor of the shore at `angle` (radians). Shared with the art so collision and pixels agree. */
export function pondEdge(angle: number): number {
  return 1 + 0.04 * Math.sin(3 * angle + 0.6) + 0.025 * Math.sin(5 * angle + 2.1);
}

/** Is (x, y) inside the pond grown by `grow` px (a negative `grow` shrinks it)? */
export function inPond(x: number, y: number, grow = 0): boolean {
  const dx = (x - POND_CX) / (POND_RX + grow), dy = (y - POND_CY) / (POND_RY + grow);
  const e = pondEdge(Math.atan2(dy, dx));
  return dx * dx + dy * dy < e * e;
}

/** Bãi trùn: the dark dirt patch in the west where the worms are dug. Shared with the art. */
export function inDirtPatch(x: number, y: number): boolean {
  const dx = (x - 66) / 42, dy = (y - 228) / 76;
  const n = Math.sin(x * 0.2) * 0.06 + Math.sin(y * 0.13) * 0.06;
  return dx * dx + dy * dy < 1 + n;
}

/** Cầu ao: a T of planks from the south bank into the water. Walkable although it is over the pond. */
export const POND_PLATFORM: Rect[] = [
  { x: 200, y: 200, w: 200, h: 24 },  // the bar
  { x: 288, y: 224, w: 24, h: 72 },   // the stem down to the bank
];

export function onPlatform(x: number, y: number): boolean {
  return POND_PLATFORM.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);
}

export const POND_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: 640, h: 44 },      // bamboo along the north edge
  { x: 516, y: 40, w: 116, h: 86 },   // Vựa cá stall (cô Ba stands inside)
  { x: 516, y: 196, w: 116, h: 98 },  // Tiệm đồ câu hut (chú Tư stands inside)
  { x: 496, y: 158, w: 24, h: 10 },   // Bảng kỷ lục posts
  { x: 345, y: 350, w: 14, h: 10 },   // "Bến vào" sign post
  { x: 34, y: 94, w: 12, h: 8 },      // palm trunk NW
  { x: 620, y: 174, w: 12, h: 8 },    // palm trunk E
  { x: 18, y: 354, w: 12, h: 8 },     // palm trunk SW
  { x: 114, y: 316, w: 12, h: 8 },    // banana plant W
  { x: 464, y: 336, w: 12, h: 8 },    // banana plant SE
];

/** Fishing spots on the platform's edges, each facing open water. */
export const POND_FISH_SPOTS: Spot[] = [
  { x: 252, y: 204, dir: "up" }, { x: 300, y: 204, dir: "up" }, { x: 348, y: 204, dir: "up" },
  { x: 206, y: 212, dir: "left" }, { x: 394, y: 212, dir: "right" }, { x: 292, y: 262, dir: "left" },
];

/** Worm mounds on the dirt patch (walkable; you dig standing just below one). */
export const DIG_MOUNDS: Vec[] = [{ x: 56, y: 172 }, { x: 84, y: 208 }, { x: 50, y: 246 }, { x: 82, y: 282 }];

/** A fishing spot's click rect: the water in front of it, so tapping near the spot walks there and casts. */
function waterRect(s: Spot): Rect {
  switch (s.dir) {
    case "up": return { x: s.x - 16, y: s.y - 84, w: 32, h: 36 };
    case "down": return { x: s.x - 16, y: s.y + 8, w: 32, h: 36 };
    case "left": return { x: s.x - 56, y: s.y - 18, w: 40, h: 26 };
    case "right": return { x: s.x + 16, y: s.y - 18, w: 40, h: 26 };
  }
}

export const POND_INTERACTABLES: Interactable[] = [
  {
    id: "pond_exit", kind: "portal", label: "Bến vào", prompt: "Về sảnh nhạc", rect: { x: 343, y: 334, w: 18, h: 26 },
    use: { x: 352, y: 374 }, to: { map: "hall", arrive: HALL_DOCK_ARRIVE },
  },
  ...POND_FISH_SPOTS.map((s, i): Interactable => ({
    id: `fish_${i + 1}`, kind: "fish_spot", label: "Chỗ câu", prompt: "Quăng cần", rect: waterRect(s), use: { x: s.x, y: s.y }, face: s.dir,
  })),
  ...DIG_MOUNDS.map((m, i): Interactable => ({
    id: `dig_${i + 1}`, kind: "dig_spot", label: "Bãi trùn", prompt: "Đào trùn", rect: { x: m.x - 10, y: m.y - 6, w: 20, h: 12 },
    use: { x: m.x, y: m.y + 12 },
  })),
  { id: "depot", kind: "depot", label: "Vựa cá", prompt: "Bán cá · cô Ba", rect: { x: 522, y: 64, w: 104, h: 62 }, use: { x: 570, y: 140 } },
  { id: "shop", kind: "shop", label: "Tiệm đồ câu", prompt: "Tiệm đồ câu · chú Tư", rect: { x: 522, y: 228, w: 104, h: 66 }, use: { x: 576, y: 308 } },
  { id: "records", kind: "records", label: "Bảng kỷ lục", prompt: "Xem bảng kỷ lục", rect: { x: 494, y: 134, w: 28, h: 34 }, use: { x: 508, y: 182 } },
];

/** The shopkeepers stand behind their counters (inside blocked cells), facing the customers. */
export const POND_NPCS: Npc[] = [
  { id: "co_ba", name: "cô Ba", look: CO_BA_LOOK, spot: { x: 560, y: 110, dir: "down" } },
  { id: "chu_tu", name: "chú Tư", look: CHU_TU_LOOK, spot: { x: 576, y: 278, dir: "down" } },
];

export const POND_PROPS: PropPlacement[] = [
  { kind: "palm", x: 40, y: 100, h: 70, lean: 0.35, seed: 5 },
  { kind: "palm", x: 626, y: 180, h: 66, lean: 0.25, seed: 9 },
  { kind: "palm", x: 24, y: 360, h: 62, lean: 0.4, seed: 13 },
  { kind: "banana", x: 120, y: 324 },
  { kind: "banana", x: 470, y: 344 },
  { kind: "stall_front", x: 574, y: 126 },
  { kind: "hut_front", x: 576, y: 294 },
  { kind: "records", x: 508, y: 168 },
  { kind: "sign", x: 352, y: 360, icon: "note" },
];

export function buildPondMap(): GameMap {
  const cols = POND_W / POND_CELL, rows = POND_H / POND_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * POND_CELL, y: r * POND_CELL, w: POND_CELL, h: POND_CELL };
    const cx = cell.x + POND_CELL / 2, cy = cell.y + POND_CELL / 2;
    let b = inPond(cx, cy, 6) || POND_SOLIDS.some((s) => overlaps(s, cell));
    if (POND_PLATFORM.some((s) => overlaps(s, cell))) b = false;
    blocked[r * cols + c] = b ? 1 : 0;
  }
  return {
    id: "pond", width: POND_W, height: POND_H, cell: POND_CELL, cols, rows, blocked,
    spawn: POND_ARRIVE, seating: null, interactables: POND_INTERACTABLES, props: POND_PROPS, npcs: POND_NPCS,
  };
}
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm vitest run tests/unit/game-pond-map.test.ts tests/unit/game-hall-map.test.ts tests/unit/game-hall-art.test.ts` → PASS.
Run: `npx tsc --noEmit` and `npx eslint lib/game/maps tests/unit/game-pond-map.test.ts` → clean.

- [ ] **Step 6: Commit**

```bash
git add lib/game/maps/pond.ts lib/game/maps/types.ts lib/game/maps/props.ts tests/unit/game-pond-map.test.ts
git commit -m "feat(v14): pond map layout, collision, fishing and dig spots, shopkeepers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Pond art and the map registry

**Files:**
- Create: `lib/game/maps/pond-art.ts`, `lib/game/maps/registry.ts`
- Modify: `lib/game/maps/scene-art.ts` (two shared colours), `lib/game/maps/props.ts` (the stall, hut and records-board painters)
- Test: `tests/unit/game-maps-registry.test.ts`

**Interfaces:**
- Consumes: everything from Task 8; `paintHall` (Task 7).
- Produces: `paintPond(map): SceneArt` (edge colour `C.grassDark`; lily flowers bob in `drawAnimated`, sparkles skip under reduced motion; the depot awning and the hut roof are overhead); `getMap(id: MapId): GameMap` (built once, cached); `paintMap(map): SceneArt` (browser; painted once per map, cached). `C.silver`, `C.blue`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/game-maps-registry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { POND_PROPS } from "@/lib/game/maps/pond";
import { propFrame } from "@/lib/game/maps/props";
import { getMap } from "@/lib/game/maps/registry";
import { MAP_IDS, type PropPlacement, type Rect } from "@/lib/game/maps/types";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { PROMPT_RANGE } from "@/lib/game/scene";

const box = (p: PropPlacement): Rect => {
  const f = propFrame(p);
  return { x: p.x - f.ox, y: p.y - f.oy, w: f.w, h: f.h };
};
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

describe("map registry", () => {
  it("builds each map once, under its own id", () => {
    for (const id of MAP_IDS) {
      expect(getMap(id).id).toBe(id);
      expect(getMap(id)).toBe(getMap(id));
    }
  });
  it("lands every portal on a walkable spot that is reachable from the target map's spawn", () => {
    for (const id of MAP_IDS) {
      for (const it of getMap(id).interactables.filter((i) => i.kind === "portal")) {
        const target = getMap(it.to!.map);
        const a = it.to!.arrive;
        expect(isBlockedAt(target, a.x, a.y), it.id).toBe(false);
        expect(findPath(target, target.spawn, a), it.id).not.toBeNull();
      }
    }
  });
  it("links the hall's dock sign and the pond's exit both ways, arriving next to the way back", () => {
    const dock = getMap("hall").interactables.find((i) => i.id === "dock_sign")!;
    const exit = getMap("pond").interactables.find((i) => i.id === "pond_exit")!;
    expect(dock).toMatchObject({ kind: "portal", to: { map: "pond" } });
    expect(exit).toMatchObject({ kind: "portal", to: { map: "hall" } });
    expect(Math.hypot(exit.to!.arrive.x - dock.use.x, exit.to!.arrive.y - dock.use.y)).toBeLessThanOrEqual(PROMPT_RANGE);
    // arriving at the pond does not show the exit prompt at once
    expect(Math.hypot(dock.to!.arrive.x - exit.use.x, dock.to!.arrive.y - exit.use.y)).toBeGreaterThan(PROMPT_RANGE);
  });
});

describe("pond art (pure parts)", () => {
  const pond = getMap("pond");
  const prop = (kind: PropPlacement["kind"]) => POND_PROPS.find((p) => p.kind === kind)!;
  const target = (id: string) => pond.interactables.find((i) => i.id === id)!.rect;
  it("anchors every pond prop at the bottom of its sprite frame", () => {
    for (const p of POND_PROPS) {
      const f = propFrame(p);
      expect(f.ox).toBeGreaterThanOrEqual(0);
      expect(f.ox).toBeLessThanOrEqual(f.w);
      expect(f.oy).toBeGreaterThan(f.h - 4);
      expect(f.oy).toBeLessThanOrEqual(f.h);
    }
  });
  it("draws the clickable things where their interaction rects are", () => {
    expect(box(prop("records"))).toEqual(target("records"));
    expect(contains(box(prop("sign")), target("pond_exit"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/game-maps-registry.test.ts`
Expected: FAIL — `Cannot find module '@/lib/game/maps/registry'`.

- [ ] **Step 3: Add the shared colours and the pond props' painters**

**lib/game/maps/scene-art.ts.** Replace:

```ts
  speaker: "#1e1616", speakerFace: "#2b2020", cone: "#4a4040", coneCenter: "#1a1414",
  paper: "#f4efe0", white: "#f4f1ea",
};
```

with:

```ts
  speaker: "#1e1616", speakerFace: "#2b2020", cone: "#4a4040", coneCenter: "#1a1414",
  paper: "#f4efe0", white: "#f4f1ea", silver: "#c3c8d4", blue: "#3d6fd1",
};
```

**lib/game/maps/props.ts — edit 1 of 2.** Replace:

```ts

export function drawProp(c: Ctx, p: PropPlacement): void {
```

with:

```ts

/** Vựa cá counter: woven baskets of fish, a scale and an ice box. */
function drawStallFront(c: Ctx): void {
  rect(c, C.outline, 0, 12, 108, 18);
  rect(c, C.woodPale, 1, 13, 106, 4); rect(c, "#e0b27a", 1, 13, 106, 1);
  for (let x = 1; x < 107; x += 7) { rect(c, C.woodLight, x, 17, 6, 12); rect(c, C.wood, x + 6, 17, 1, 12); }
  for (const bx of [10, 38]) {
    rect(c, C.outline, bx, 4, 22, 10); rect(c, "#c9a55a", bx + 1, 5, 20, 8);
    for (let x = bx + 2; x < bx + 21; x += 3) rect(c, "#a8843f", x, 5, 1, 8);
    for (let i = 0; i < 4; i++) { rect(c, C.silver, bx + 3 + i * 4, 2 + (i % 2), 4, 3); px(c, C.outline, bx + 3 + i * 4, 3 + (i % 2)); }
  }
  // the scale (cân đòn)
  rect(c, C.outline, 74, 0, 2, 13); rect(c, C.outline, 66, 2, 18, 1);
  rect(c, C.silver, 64, 8, 8, 2); rect(c, C.outline, 64, 10, 8, 1);
  rect(c, C.silver, 78, 6, 8, 2); rect(c, C.outline, 78, 8, 8, 1);
  px(c, C.outline, 67, 3); px(c, C.outline, 68, 4); px(c, C.outline, 81, 3); px(c, C.outline, 82, 4);
  rect(c, C.outline, 90, 3, 14, 10); rect(c, "#e8f4f8", 91, 4, 12, 8); rect(c, "#a6d6e8", 91, 4, 12, 2);
}

/** Tiệm đồ câu counter: bamboo slats, a tackle box and bait jars. */
function drawHutFront(c: Ctx): void {
  rect(c, C.outline, 0, 6, 108, 20);
  rect(c, C.woodPale, 1, 7, 106, 4); rect(c, "#e0b27a", 1, 7, 106, 1);
  for (let x = 1; x < 107; x += 4) { rect(c, "#b7c65a", x, 11, 3, 14); rect(c, "#8a9a3a", x + 3, 11, 1, 14); }
  rect(c, C.outline, 12, 0, 18, 7); rect(c, C.red, 13, 1, 16, 5); rect(c, C.gold, 20, 2, 2, 2);
  for (const [jx, col] of [[40, "#e98a9a"], [50, "#f29a6a"], [60, C.red]] as const) {
    rect(c, C.outline, jx, 0, 7, 7); rect(c, "#e8f4f8", jx + 1, 1, 5, 5); rect(c, col, jx + 1, 3, 5, 3);
  }
  rect(c, C.outline, 80, 2, 16, 5); rect(c, C.blue, 81, 3, 14, 3);
}

/** Bảng kỷ lục: a board on two posts with a trophy. */
function drawRecords(c: Ctx): void {
  rect(c, C.outline, 3, 18, 3, 16); rect(c, C.outline, 22, 18, 3, 16);
  rect(c, C.woodDark, 4, 18, 1, 16); rect(c, C.woodDark, 23, 18, 1, 16);
  rect(c, C.outline, 0, 0, 28, 22); rect(c, C.wood, 1, 1, 26, 20); rect(c, C.woodLight, 2, 2, 24, 18);
  rect(c, C.red, 2, 2, 24, 4);
  for (let x = 4; x < 24; x += 3) px(c, C.goldLight, x, 3);
  rect(c, C.gold, 9, 8, 10, 5); rect(c, C.goldLight, 10, 8, 3, 2);
  px(c, C.gold, 8, 9); px(c, C.gold, 19, 9);
  rect(c, C.gold, 13, 13, 2, 2); rect(c, C.gold, 11, 15, 6, 2); rect(c, C.outline, 11, 17, 6, 1);
}

export function drawProp(c: Ctx, p: PropPlacement): void {
```

**lib/game/maps/props.ts — edit 2 of 2.** Replace:

```ts
    case "lightpole": return drawLightPole(c);
  }
```

with:

```ts
    case "lightpole": return drawLightPole(c);
    case "stall_front": return drawStallFront(c);
    case "hut_front": return drawHutFront(c);
    case "records": return drawRecords(c);
  }
```

- [ ] **Step 4: Create `lib/game/maps/pond-art.ts`**

```ts
import { DIG_MOUNDS, inDirtPatch, inPond, onPlatform, POND_CX, POND_CY, POND_H, POND_PLATFORM, POND_RX, POND_RY, POND_W, pondEdge } from "./pond";
import { propSprite } from "./props";
import { C, ctx2d, hexToRgb, makeCanvas, px, rect, rng, type Ctx, type SceneArt } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painters for the pond ("Ao cá"). Browser only (canvas). Props live in props.ts, shared helpers in
// scene-art.ts, the layout in pond.ts. Original art in the approved Miền Tây style — no copied images.

/** Pond-only colours (the shared ones are in scene-art.ts). */
const P = {
  soil: "#6e4a2a", soilDark: "#5a3a1e", soilLight: "#8a6038", mound: "#7a5230", worm: "#f29bb5", wormDark: "#c9687a",
  lily: "#4f9a3a", lilyDark: "#3a7a2c", lilyLight: "#6fbf4a", pink: "#f29bb5", pinkDark: "#d4758f", yellow: "#f6c945",
  reed: "#6a9a38", reedLight: "#8fb84e", reedTip: "#7a4a2a",
  thatch: "#c9a55a", thatchDark: "#a8843f", thatchLight: "#e0c27a",
  bambooBack: "#4f8a30", bambooDots: "#44792a",
};

/** Dirt paths: [x1, y1, x2, y2, half width]. */
const PATHS: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [300, 286, 300, 400, 11],  // the entrance up to the platform
  [300, 322, 600, 322, 9],   // east to the shop
  [498, 322, 498, 150, 8],   // north past the records board
  [498, 150, 600, 150, 8],   // to the depot
  [300, 306, 96, 306, 9],    // west to the worm patch
];

function segDist(x: number, y: number, x1: number, y1: number, x2: number, y2: number): number {
  const vx = x2 - x1, vy = y2 - y1, l2 = vx * vx + vy * vy;
  const t = Math.max(0, Math.min(1, ((x - x1) * vx + (y - y1) * vy) / l2));
  return Math.hypot(x - (x1 + t * vx), y - (y1 + t * vy));
}

function onPath(x: number, y: number): boolean {
  const n = Math.sin(x * 0.21) * 1.2 + Math.sin(y * 0.17) * 1.2;
  return PATHS.some(([x1, y1, x2, y2, w]) => segDist(x, y, x1, y1, x2, y2) < w + n);
}

/** Lily pads (bông súng): x, y, has a flower. */
const LILIES: ReadonlyArray<readonly [number, number, boolean]> = [
  [170, 150, true], [196, 116, false], [238, 98, true], [382, 100, false], [432, 148, true], [456, 196, false],
  [168, 240, false], [222, 262, true], [376, 256, true], [424, 238, false], [330, 124, false], [262, 146, false],
];

// ---------------------------------------------------------------- ground

function paintGround(c: Ctx): void {
  const R = rng(17);
  const img = c.createImageData(POND_W, POND_H);
  const d = img.data;
  const pal = {
    water: hexToRgb(C.water), waterDeep: hexToRgb(C.waterDeep), waterLight: hexToRgb(C.waterLight),
    mud: hexToRgb(C.mud), bank: hexToRgb(C.bank), sand: hexToRgb(C.sand),
    soil: hexToRgb(P.soil), soilDark: hexToRgb(P.soilDark), soilLight: hexToRgb(P.soilLight),
    dirt: hexToRgb(C.dirt), dirtDark: hexToRgb(C.dirtDark), dirtLight: hexToRgb(C.dirtLight),
    grass: hexToRgb(C.grass), grassLight: hexToRgb(C.grassLight), grassDark: hexToRgb(C.grassDark),
  };
  for (let y = 0; y < POND_H; y++) for (let x = 0; x < POND_W; x++) {
    const r = R();
    let col: [number, number, number];
    if (inPond(x, y)) {
      const wob = 3 * Math.sin(x * 0.19 + y * 0.07) + 2 * Math.sin(y * 0.31);
      if (r < 0.035 || !inPond(x, y, -9 + wob * 0.5)) col = pal.waterLight;
      else col = inPond(x, y, -46 + wob) ? pal.waterDeep : pal.water;
    } else if (inPond(x, y, 1)) col = pal.mud;
    else if (inPond(x, y, 2)) col = pal.bank;
    else if (inPond(x, y, 3)) col = pal.sand;
    else if (inDirtPatch(x, y)) col = r < 0.14 ? pal.soilDark : r < 0.24 ? pal.soilLight : pal.soil;
    else if (onPath(x, y)) col = r < 0.12 ? pal.dirtDark : r < 0.2 ? pal.dirtLight : pal.dirt;
    else col = r < 0.1 ? pal.grassLight : r < 0.17 ? pal.grassDark : pal.grass;
    const i = (y * POND_W + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // grass tufts and a few flowers
  for (let i = 0; i < 560; i++) {
    const x = Math.floor(R() * POND_W), y = Math.floor(R() * POND_H);
    if (inPond(x, y, 8) || onPath(x, y) || inDirtPatch(x, y) || y < 46) continue;
    px(c, C.grassDeep, x, y); px(c, C.grassDeep, x - 1, y - 1); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x, y - 1);
    if (R() < 0.16) px(c, R() < 0.5 ? P.yellow : P.pink, x + 2, y - 2);
  }
}

function paintBamboo(c: Ctx): void {
  const R = rng(29);
  // a ragged leafy band along the north edge
  for (let x = 0; x < POND_W; x++) {
    const edge = 44 + Math.round(3 * Math.sin(x * 0.31) + 2 * Math.sin(x * 0.9));
    for (let y = 0; y < edge; y++) px(c, y > edge - 2 ? C.leafDark : P.bambooBack, x, y);
  }
  for (let y = 0; y < 44; y++) for (let x = 0; x < POND_W; x++) if (R() < 0.08) px(c, P.bambooDots, x, y);
  for (let i = 0; i < 150; i++) {
    const x = 2 + i * 4 + Math.floor(R() * 2), top = Math.floor(R() * 8), bot = 36 + Math.floor(R() * 8);
    if (x > 512 && x < 636) continue; // the depot's awning covers this stretch
    for (let y = top; y < bot; y++) {
      px(c, C.bamboo, x, y); px(c, C.bambooDark, x + 1, y);
      if ((y - top) % 9 === 0) { px(c, C.bambooNode, x, y); px(c, C.bambooNode, x + 1, y); }
    }
    for (let l = 0; l < 3; l++) {
      const ly = top + Math.floor(R() * (bot - top - 6)), dir = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < 5; k++) px(c, k < 2 ? C.leafLight : C.leaf, x + dir * (k + 1), ly + Math.floor(k / 2));
    }
  }
}

function paintPondDetails(c: Ctx): void {
  const R = rng(41);
  // reeds along the shore
  for (const a of [2.6, 3.0, 3.6, 5.6, 6.0, 0.5, 1.2, 2.1]) {
    const e = pondEdge(a);
    const bx = POND_CX + Math.cos(a) * (POND_RX + 2) * e, by = POND_CY + Math.sin(a) * (POND_RY + 2) * e;
    for (let k = 0; k < 7; k++) {
      const x = Math.round(bx + (k - 3) * 2 + (R() - 0.5) * 2), h = 6 + Math.floor(R() * 6);
      for (let j = 0; j < h; j++) px(c, j < h - 2 ? P.reed : P.reedLight, x, by - j);
      if (R() < 0.6) { px(c, P.reedTip, x, by - h - 1); px(c, P.reedTip, x, by - h - 2); }
    }
  }
  // lily pads (their flowers bob in drawAnimated)
  for (const [x, y] of LILIES) {
    for (let j = -2; j <= 2; j++) for (let i = -4; i <= 4; i++) {
      if ((i * i) / 18 + (j * j) / 5 > 1) continue;
      if (i > 0 && j === 0) continue; // the notch
      px(c, j === 2 || (j === 1 && Math.abs(i) >= 3) ? P.lilyDark : i < -1 && j < 0 ? P.lilyLight : P.lily, x + i, y + j);
    }
  }
  // xuồng ba lá moored in the north-east
  for (let by = 0; by < 8; by++) {
    const inset = Math.abs(3.5 - by) * 3;
    rect(c, by === 0 || by === 7 ? C.outline : C.woodDark, 404 + inset, 110 + by, 40 - inset * 2, 1);
  }
  rect(c, C.woodLight, 414, 113, 20, 2);
  rect(c, C.outline, 424, 100, 1, 11); rect(c, C.wood, 425, 100, 4, 2);
}

function paintPlatform(c: Ctx): void {
  const [bar, stem] = POND_PLATFORM;
  // posts into the water
  const posts: Array<[number, number]> = [
    [bar.x, bar.y + bar.h], [bar.x + bar.w - 3, bar.y + bar.h], [bar.x + 60, bar.y + bar.h], [bar.x + bar.w - 63, bar.y + bar.h],
    [stem.x - 1, stem.y + 30], [stem.x + stem.w - 2, stem.y + 30],
  ];
  for (const [x, y] of posts) rect(c, C.woodDeep, x, y, 3, 4);
  rect(c, C.outline, bar.x - 1, bar.y - 1, bar.w + 2, bar.h + 2);
  rect(c, C.outline, stem.x - 1, stem.y - 1, stem.w + 2, stem.h + 1);
  for (let y = bar.y; y < bar.y + bar.h; y += 4) { rect(c, C.woodLight, bar.x, y, bar.w, 3); rect(c, C.wood, bar.x, y + 3, bar.w, 1); }
  for (let x = bar.x + 23; x < bar.x + bar.w; x += 36) rect(c, C.woodDark, x, bar.y, 1, bar.h);
  for (let x = stem.x; x < stem.x + stem.w; x += 4) { rect(c, C.woodLight, x, stem.y, 3, stem.h); rect(c, C.wood, x + 3, stem.y, 1, stem.h); }
  rect(c, C.woodDark, stem.x, stem.y, stem.w, 1);
}

function paintDigPatch(c: Ctx): void {
  for (const m of DIG_MOUNDS) {
    for (let j = -4; j <= 3; j++) for (let i = -9; i <= 9; i++) {
      const e = (i * i) / 81 + (j * j) / 16;
      if (e > 1) continue;
      const col = e > 0.8 && j > 0 ? C.outline : j <= -2 ? P.soilLight : j >= 1 ? P.soilDark : P.mound;
      px(c, col, m.x + i, m.y + j);
    }
    px(c, "#a8784a", m.x - 3, m.y - 3); px(c, "#a8784a", m.x + 2, m.y - 3);
    // a worm peeking out
    px(c, P.worm, m.x - 4, m.y - 1); px(c, P.worm, m.x - 3, m.y - 1); px(c, P.wormDark, m.x - 2, m.y);
    px(c, P.worm, m.x + 4, m.y + 1); px(c, P.worm, m.x + 5, m.y);
  }
  // a shovel stuck in the soil
  rect(c, C.woodDark, 98, 184, 1, 11); rect(c, C.silver, 96, 195, 5, 4); rect(c, C.outline, 96, 199, 5, 1);
}

function paintStallBack(c: Ctx): void {
  rect(c, C.outline, 519, 58, 110, 50);
  rect(c, C.woodDark, 520, 59, 108, 48);
  rect(c, C.woodDeep, 520, 76, 108, 1); rect(c, C.woodDeep, 520, 92, 108, 1);
  // dried fish (khô) hanging on the back wall
  for (let x = 530; x < 622; x += 14) {
    rect(c, C.outline, x + 3, 61, 1, 3);
    rect(c, "#c9a06a", x, 64, 7, 3); px(c, "#8a6a3f", x + 7, 65); px(c, "#8a6a3f", x + 8, 64); px(c, "#8a6a3f", x + 8, 66);
  }
  // price board
  rect(c, C.outline, 596, 78, 26, 12); rect(c, C.paper, 597, 79, 24, 10);
  rect(c, C.red, 599, 81, 10, 1); rect(c, C.outline, 599, 84, 18, 1); rect(c, C.outline, 599, 86, 14, 1);
}

function paintHutBack(c: Ctx): void {
  rect(c, C.outline, 519, 226, 110, 48);
  rect(c, "#b88a52", 520, 227, 108, 46);
  for (let x = 520; x < 628; x += 5) rect(c, "#a8784a", x, 227, 1, 46);
  // rod rack
  rect(c, C.woodDeep, 528, 236, 36, 2);
  for (let i = 0; i < 5; i++) {
    const x = 531 + i * 7;
    for (let y = 230; y < 270; y++) px(c, i % 2 ? "#b7c65a" : C.wood, x + Math.floor((y - 230) / 14), y);
  }
  // a net and a bait jar
  for (let y = 234; y < 262; y += 3) for (let x = 590; x < 620; x += 3) px(c, "#e8e4d8", x + ((y / 3) % 2), y);
  rect(c, C.outline, 574, 250, 8, 10); rect(c, "#e98a9a", 575, 252, 6, 7);
}

// ---------------------------------------------------------------- public

export function paintPond(map: GameMap): SceneArt {
  const background = makeCanvas(POND_W, POND_H);
  const g = ctx2d(background);
  paintGround(g);
  paintPondDetails(g);
  paintPlatform(g);
  paintDigPatch(g);
  paintBamboo(g);
  paintStallBack(g);
  paintHutBack(g);
  const props = map.props.map(propSprite);

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    // lily flowers bob a pixel (still under reduced motion)
    LILIES.forEach(([x, y, flower], i) => {
      if (!flower) return;
      const b = reducedMotion ? 0 : Math.sin(t / 700 + i * 1.7) > 0.3 ? -1 : 0;
      const fx = x - camX, fy = y + b - camY;
      px(c, P.pinkDark, fx - 1, fy - 2); px(c, P.pink, fx, fy - 3); px(c, P.pink, fx - 2, fy - 3); px(c, P.pink, fx - 1, fy - 4);
      px(c, P.yellow, fx - 1, fy - 3);
    });
    if (reducedMotion) return;
    for (let i = 0; i < 90; i++) {
      const sx = POND_CX - POND_RX + ((i * 53 + Math.floor(t / 60)) % (POND_RX * 2));
      const sy = POND_CY - POND_RY + ((i * 29) % (POND_RY * 2));
      if (!inPond(sx, sy, -4) || onPlatform(sx, sy)) continue;
      px(c, C.sparkle, sx - camX, sy - camY);
      px(c, C.sparkle2, sx + 1 - camX, sy - camY);
    }
  };

  const drawOverhead = (c: Ctx, _t: number, camX: number, camY: number) => {
    // the depot's awning: blue and white stripes with a scalloped edge
    const ax = 512 - camX, ay = 36 - camY;
    rect(c, C.outline, ax, ay, 124, 20);
    for (let x = 0; x < 122; x += 6) rect(c, (x / 6) % 2 === 0 ? C.blue : C.white, ax + 1 + x, ay + 1, 6, 17);
    for (let x = 0; x < 122; x += 6) rect(c, (x / 6) % 2 === 0 ? C.blue : C.white, ax + 2 + x, ay + 18, 4, 2);
    rect(c, C.outline, ax, ay + 20, 1, 3); rect(c, C.outline, ax + 123, ay + 20, 1, 3);
    // the hut's thatched roof (lá dừa nước)
    const rx = 508 - camX, ry = 190 - camY;
    for (let j = 0; j < 40; j++) {
      const inset = Math.max(0, 20 - j);
      rect(c, j === 39 ? C.outline : j % 4 === 3 ? P.thatchDark : j % 4 === 0 ? P.thatchLight : P.thatch, rx + inset, ry + j, 132 - inset * 2, 1);
    }
    for (let x = 0; x < 132; x += 3) px(c, P.thatchDark, rx + x, ry + 38 + (x % 2));
    rect(c, C.outline, rx + 20, ry, 92, 1);
  };

  return { background, props, edge: C.grassDark, drawAnimated, drawOverhead };
}
```

- [ ] **Step 5: Create `lib/game/maps/registry.ts`**

```ts
import { buildHallMap } from "./hall";
import { paintHall } from "./hall-art";
import { buildPondMap } from "./pond";
import { paintPond } from "./pond-art";
import type { SceneArt } from "./scene-art";
import type { GameMap, MapId } from "./types";

// Every map of the room world (spec §5.1): built once, painted once per page.

const maps = new Map<MapId, GameMap>();
const arts = new Map<MapId, SceneArt>();

/** The map with this id (pure; cached). */
export function getMap(id: MapId): GameMap {
  let m = maps.get(id);
  if (!m) {
    m = id === "pond" ? buildPondMap() : buildHallMap();
    maps.set(id, m);
  }
  return m;
}

/** The map's painted scene (browser only: canvas). Cached, so walking back and forth does not repaint. */
export function paintMap(map: GameMap): SceneArt {
  let a = arts.get(map.id);
  if (!a) {
    a = map.id === "pond" ? paintPond(map) : paintHall(map);
    arts.set(map.id, a);
  }
  return a;
}
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm vitest run tests/unit/game-maps-registry.test.ts tests/unit/game-pond-map.test.ts tests/unit/game-hall-art.test.ts` → PASS.
Run: `npx tsc --noEmit` and `npx eslint lib/game/maps tests/unit/game-maps-registry.test.ts` → clean.

The painters are browser-only and have no unit test (as in v13); Task 13's manual check looks at the pond.

- [ ] **Step 7: Commit**

```bash
git add lib/game/maps/pond-art.ts lib/game/maps/registry.ts lib/game/maps/scene-art.ts lib/game/maps/props.ts tests/unit/game-maps-registry.test.ts
git commit -m "feat(v14): pond painter and the map registry

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Presence carries the map; the roster is per map

**Files:**
- Modify: `lib/presence-modes.ts` (full replacement), `lib/realtime.ts`, `hooks/useRoom.ts`, `lib/game/social.ts`, `components/game/GameShell.tsx`
- Test: `tests/unit/presence-mode.test.ts`, `tests/unit/presence-scheduler.test.ts`, `tests/unit/game-social.test.ts` (extend)

**Interfaces:**
- Consumes: `MapId` (Task 7).
- Produces:
  - `PresenceEntry { accountId; name; mode; map: MapId | null }` — `map` comes from the game-mode tab that tracked last; an old game client without `map` counts as `"hall"`; classic → `null`.
  - `MapMember { accountId; name; classic }`, `mapCounts(presence): Record<MapId, MapMember[]>` (classic members count in the hall).
  - `trackPresence(roomId, me: { memberId; name; mode; map?: MapId }, onChange)` → `PresenceHandle { unsubscribe; setMode; setMap(map: MapId) }`. The payload is `{ name, online_at, mode, map }` with `map = null` whenever `mode` is `"classic"`; mode and map are one wanted state for the scheduler (1 s merge, ≤ 4 tracks / 30 s, an acknowledged state is never re-sent).
  - `RoomView.setPresenceMap(m: MapId)`.
  - `buildRoster({ presence, members, room, localId, looks, mapId: MapId, seating: Seating | null })`: classic members only where `seating` is given (the hall), game members only on their own map.

- [ ] **Step 1: Write the failing tests**

**tests/unit/presence-mode.test.ts — edit 1 of 4.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { aggregatePresenceModes, presenceDelay } from "@/lib/presence-modes";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { aggregatePresenceModes, mapCounts, presenceDelay, type PresenceEntry } from "@/lib/presence-modes";
```

**tests/unit/presence-mode.test.ts — edit 2 of 4.** Replace:

```ts
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game" },
      { accountId: "b", name: "Bee", mode: "classic" },
    ]);
```

with:

```ts
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game", map: "hall" },
      { accountId: "b", name: "Bee", mode: "classic", map: null },
    ]);
```

**tests/unit/presence-mode.test.ts — edit 3 of 4.** Replace:

```ts
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic" }]);
  });
```

with:

```ts
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic", map: null }]);
  });
  it("takes the map from the game tab that tracked last; an old game client is in the hall", () => {
    const tab = (map: string | undefined, at: string, mode = "game") => ({ name: "Ann", mode, map, online_at: at });
    expect(aggregatePresenceModes({ a: [tab("hall", "2026-09-24T10:00:00Z"), tab("pond", "2026-09-24T10:05:00Z")] })[0].map).toBe("pond");
    expect(aggregatePresenceModes({ a: [tab("pond", "2026-09-24T10:05:00Z"), tab("hall", "2026-09-24T10:00:00Z")] })[0].map).toBe("pond");
    expect(aggregatePresenceModes({ a: [tab(undefined, "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
    expect(aggregatePresenceModes({ a: [tab("pond", "2026-09-24T11:00:00Z", "classic"), tab("hall", "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
  });
```

**tests/unit/presence-mode.test.ts — edit 4 of 4.** Append at the end of the file, after a blank line:

```ts
describe("mapCounts", () => {
  it("lists who is on each map, me included, with classic members in the hall", () => {
    const presence: PresenceEntry[] = [
      { accountId: "a", name: "Ann", mode: "game", map: "pond" },
      { accountId: "b", name: "Bee", mode: "classic", map: null },
      { accountId: "c", name: "Cee", mode: "game", map: "hall" },
    ];
    expect(mapCounts(presence)).toEqual({
      hall: [{ accountId: "b", name: "Bee", classic: true }, { accountId: "c", name: "Cee", classic: false }],
      pond: [{ accountId: "a", name: "Ann", classic: false }],
    });
    expect(mapCounts([])).toEqual({ hall: [], pond: [] });
  });
});
```

**tests/unit/presence-scheduler.test.ts — edit 1 of 3.** Replace:

```ts
    subscribeCb: null as ((s: string) => void) | null,
    calls: [] as { at: number; mode: unknown }[],
    replies: [] as Array<string | Promise<string> | Error>,
```

with:

```ts
    subscribeCb: null as ((s: string) => void) | null,
    calls: [] as { at: number; mode: unknown; map: unknown }[],
    replies: [] as Array<string | Promise<string> | Error>,
```

**tests/unit/presence-scheduler.test.ts — edit 2 of 3.** Replace:

```ts
    presenceState() { return {}; },
    track(payload: { mode: unknown }) {
      state.calls.push({ at: Date.now(), mode: payload.mode });
      const reply = state.replies.shift() ?? "ok";
```

with:

```ts
    presenceState() { return {}; },
    track(payload: { mode: unknown; map?: unknown }) {
      state.calls.push({ at: Date.now(), mode: payload.mode, map: payload.map });
      const reply = state.replies.shift() ?? "ok";
```

**tests/unit/presence-scheduler.test.ts — edit 3 of 3.** Replace:

```ts
  });
});
```

with:

```ts
  });

  it("publishes the map with the mode in one merged track, and never re-sends an acknowledged state", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "hall" }, () => {});
    sub(); await adv(0);
    expect(h.state.calls.map((c) => c.map)).toEqual(["hall"]);
    hd.setMap("pond"); await adv(400); hd.setMode("game"); await adv(1000);
    expect(h.state.calls.map((c) => [c.mode, c.map])).toEqual([["game", "hall"], ["game", "pond"]]);
    hd.setMap("pond"); await adv(60_000); expect(h.state.calls).toHaveLength(2);
    hd.setMap("hall"); await adv(300); hd.setMap("pond"); await adv(10_000); expect(h.state.calls).toHaveLength(2);
    hd.unsubscribe();
  });

  it("publishes map null in the classic view, whatever the last map was", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "pond" }, () => {});
    sub(); await adv(0);
    hd.setMode("classic"); await adv(1000);
    expect(h.state.calls.map((c) => [c.mode, c.map])).toEqual([["game", "pond"], ["classic", null]]);
    hd.setMap("hall"); await adv(10_000); expect(h.state.calls).toHaveLength(2); // nothing visible changed
    hd.setMode("game"); await adv(1000);
    expect(h.state.calls.at(-1)).toMatchObject({ mode: "game", map: "hall" });
    hd.unsubscribe();
  });

  it("shares the 4-per-30 s budget between map and mode changes", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "hall" }, () => {});
    sub(); await adv(0);
    for (let i = 0; i < 12; i++) {
      if (i % 2) hd.setMap(i % 4 === 1 ? "pond" : "hall");
      else hd.setMode(i % 4 === 0 ? "classic" : "game");
      await adv(1500);
    }
    await adv(120_000);
    const ts = times();
    for (const t of ts) expect(ts.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(4);
    hd.unsubscribe();
  });
});
```

**tests/unit/game-social.test.ts — edit 1 of 5.** Replace:

```ts
import { DEFAULT_LOOK } from "@/lib/game/look";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { Member } from "@/lib/supabase";
```

with:

```ts
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { MapId } from "@/lib/game/maps/types";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { PresenceEntry } from "@/lib/presence-modes";
import type { Member } from "@/lib/supabase";
```

**tests/unit/game-social.test.ts — edit 2 of 5.** Replace:

```ts
const room = { admin_member_id: "m1", dj_member_id: "m2" };
const map = {
  djSpot: { x: 320, y: 124, dir: "down" as const },
```

with:

```ts
const room = { admin_member_id: "m1", dj_member_id: "m2" };
const seating = {
  djSpot: { x: 320, y: 124, dir: "down" as const },
```

**tests/unit/game-social.test.ts — edit 3 of 5.** Replace:

```ts
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
```

with:

```ts
describe("buildRoster", () => {
  const presence: PresenceEntry[] = [
    { accountId: "admin", name: "An", mode: "classic", map: null },
    { accountId: "dj", name: "Dũng", mode: "classic", map: null },
    { accountId: "c2", name: "Chi", mode: "classic", map: null },
    { accountId: "g1", name: "Giang", mode: "game", map: "hall" },
    { accountId: "me", name: "Tôi", mode: "game", map: "hall" },
    { accountId: "stranger", name: "Lạ", mode: "game", map: "hall" },
  ];
  const TAN = { ...DEFAULT_LOOK, skin: "tan" as const };
  const roster = buildRoster({ presence, members, room, localId: "me", looks: new Map([["g1", TAN]]), mapId: "hall", seating });
  const byId = new Map(roster.map((r) => [r.id, r]));
```

**tests/unit/game-social.test.ts — edit 4 of 5.** Replace:

```ts
  it("puts a classic DJ behind the mixer and seats the other classic members in id order", () => {
    expect(byId.get("dj")?.spot).toEqual(map.djSpot);
    expect(byId.get("admin")?.spot).toEqual(map.seats[0]);
    expect(byId.get("c2")?.spot).toEqual(map.seats[1]);
    expect(byId.get("g1")?.spot).toBeNull();
```

with:

```ts
  it("puts a classic DJ behind the mixer and seats the other classic members in id order", () => {
    expect(byId.get("dj")?.spot).toEqual(seating.djSpot);
    expect(byId.get("admin")?.spot).toEqual(seating.seats[0]);
    expect(byId.get("c2")?.spot).toEqual(seating.seats[1]);
    expect(byId.get("g1")?.spot).toBeNull();
```

**tests/unit/game-social.test.ts — edit 5 of 5.** Replace:

```ts
  it("seats classic members by account id whatever the presence order", () => {
    const shuffled = [
      { accountId: "c2", name: "Chi", mode: "classic" as const },
      { accountId: "admin", name: "An", mode: "classic" as const },
    ];
    const r = new Map(buildRoster({ presence: shuffled, members, room, localId: "me", looks: new Map(), map }).map((e) => [e.id, e]));
    expect(r.get("admin")?.spot).toEqual(map.seats[0]);
    expect(r.get("c2")?.spot).toEqual(map.seats[1]);
  });
```

with:

```ts
  it("seats classic members by account id whatever the presence order", () => {
    const shuffled: PresenceEntry[] = [
      { accountId: "c2", name: "Chi", mode: "classic", map: null },
      { accountId: "admin", name: "An", mode: "classic", map: null },
    ];
    const r = new Map(buildRoster({ presence: shuffled, members, room, localId: "me", looks: new Map(), mapId: "hall", seating }).map((e) => [e.id, e]));
    expect(r.get("admin")?.spot).toEqual(seating.seats[0]);
    expect(r.get("c2")?.spot).toEqual(seating.seats[1]);
  });
});

describe("buildRoster per map", () => {
  const presence: PresenceEntry[] = [
    { accountId: "c1", name: "Cúc", mode: "classic", map: null },
    { accountId: "g1", name: "Giang", mode: "game", map: "hall" },
    { accountId: "c2", name: "Chi", mode: "game", map: "pond" },
    { accountId: "me", name: "Tôi", mode: "game", map: "pond" },
  ];
  const ids = (mapId: MapId) =>
    buildRoster({ presence, members, room, localId: "me", looks: new Map(), mapId, seating: mapId === "hall" ? seating : null })
      .map((e) => e.id).sort();
  it("draws classic members (seated) and the hall's walkers in the hall", () => {
    expect(ids("hall")).toEqual(["c1", "g1"]);
  });
  it("draws only the pond's walkers at the pond", () => {
    expect(ids("pond")).toEqual(["c2"]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/presence-mode.test.ts tests/unit/presence-scheduler.test.ts tests/unit/game-social.test.ts`
Expected: FAIL — `mapCounts` is not exported, entries have no `map`, `setMap` is not a function, `buildRoster` ignores `mapId`.

- [ ] **Step 3: Replace `lib/presence-modes.ts`**

```ts
import type { MapId } from "@/lib/game/maps/types";
import type { ViewMode } from "@/lib/view-mode";

export type PresenceMode = ViewMode;
export interface PresenceMeta { name?: unknown; online_at?: unknown; mode?: unknown; map?: unknown }
/** `map`: the game map the member walks on (v14); null in the classic view. */
export interface PresenceEntry { accountId: string; name: string; mode: PresenceMode; map: MapId | null }

const onlineAt = (m: PresenceMeta): number => (typeof m.online_at === "string" ? Date.parse(m.online_at) || 0 : 0);

/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode; its map comes from the game tab that tracked
 *  last (an old client without a map is in the hall). Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
  const out: PresenceEntry[] = [];
  for (const [accountId, metas] of Object.entries(state)) {
    if (!metas || metas.length === 0) continue;
    const name = metas.map((m) => m.name).find((n): n is string => typeof n === "string" && n.length > 0) ?? "";
    const games = metas.filter((m) => m.mode === "game");
    if (games.length === 0) {
      out.push({ accountId, name, mode: "classic", map: null });
      continue;
    }
    const latest = games.reduce((a, b) => (onlineAt(b) > onlineAt(a) ? b : a));
    out.push({ accountId, name, mode: "game", map: latest.map === "pond" ? "pond" : "hall" });
  }
  return out.sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));
}

export interface MapMember { accountId: string; name: string; classic: boolean }

/** Who is on which map (me included): classic-view members count in the hall. */
export function mapCounts(presence: readonly PresenceEntry[]): Record<MapId, MapMember[]> {
  const out: Record<MapId, MapMember[]> = { hall: [], pond: [] };
  for (const p of presence) {
    const classic = p.mode === "classic";
    out[classic ? "hall" : p.map ?? "hall"].push({ accountId: p.accountId, name: p.name, classic });
  }
  return out;
}

/** Supabase allows 5 presence calls per client per 30 s; one is kept in reserve for re-tracks after a reconnect. */
export const PRESENCE_BUDGET = { max: 4, windowMs: 30_000 } as const;

/** ms to wait before the next presence track() so that at most `max` calls fall inside any `windowMs` window (0 = now). */
export function presenceDelay(sentAt: readonly number[], now: number, budget: { max: number; windowMs: number } = PRESENCE_BUDGET): number {
  const recent = sentAt.filter((t) => now - t < budget.windowMs).sort((a, b) => a - b);
  if (recent.length < budget.max) return 0;
  return recent[recent.length - budget.max] + budget.windowMs - now;
}
```

- [ ] **Step 4: Publish the map with the mode**

**lib/realtime.ts — edit 1 of 9.** Replace:

```ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, type Room, type Member, type QueueItem } from "@/lib/supabase";
```

with:

```ts
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { MapId } from "@/lib/game/maps/types";
import { supabase, type Room, type Member, type QueueItem } from "@/lib/supabase";
```

**lib/realtime.ts — edit 2 of 9.** Replace:

```ts

export interface PresenceHandle { unsubscribe: () => void; setMode: (mode: PresenceMode) => void }

/** Realtime Presence keyed by account id. The payload also carries the member's view mode (v13).
 *  track() calls are budgeted (Supabase allows 5 per 30 s): ≤ 4 calls per 30 s for mode changes; a re-track
 *  after a reconnect may use the 5th. Mode changes within 1 s are merged, a mode the server already
 *  acknowledged is never re-sent, and failed tracks are retried. */
```

with:

```ts

export interface PresenceHandle {
  unsubscribe: () => void;
  setMode: (mode: PresenceMode) => void;
  /** The game map I walk on (v14). Published only while the mode is "game" (classic → map null). */
  setMap: (map: MapId) => void;
}

interface Published { mode: PresenceMode; map: MapId | null }

/** Realtime Presence keyed by account id. The payload also carries the member's view mode (v13) and game map (v14).
 *  track() calls are budgeted (Supabase allows 5 per 30 s): ≤ 4 calls per 30 s for mode and map changes together;
 *  a re-track after a reconnect may use the 5th. Changes within 1 s are merged, a state the server already
 *  acknowledged is never re-sent, and failed tracks are retried. */
```

**lib/realtime.ts — edit 3 of 9.** Replace:

```ts
  roomId: string,
  me: { memberId: string; name: string; mode: PresenceMode },
  onChange: (entries: PresenceEntry[]) => void,
```

with:

```ts
  roomId: string,
  me: { memberId: string; name: string; mode: PresenceMode; map?: MapId },
  onChange: (entries: PresenceEntry[]) => void,
```

**lib/realtime.ts — edit 4 of 9.** Replace:

```ts
  const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { key: me.memberId } } });
  let wanted: PresenceMode = me.mode;        // the mode other members should see
  let published: PresenceMode | null = null; // last mode the server acknowledged with 'ok'
  let subscribed = false;
```

with:

```ts
  const channel = supabase.channel(`presence:${roomId}`, { config: { presence: { key: me.memberId } } });
  let mode: PresenceMode = me.mode;          // what other members should see…
  let map: MapId = me.map ?? "hall";
  let published: Published | null = null;    // …and the last state the server acknowledged with 'ok'
  const wanted = (): Published => ({ mode, map: mode === "game" ? map : null });
  const isPublished = () => published !== null && published.mode === wanted().mode && published.map === wanted().map;
  let subscribed = false;
```

**lib/realtime.ts — edit 5 of 9.** Replace:

```ts
    timer = null;
    if (closed || !subscribed || sending || wanted === published) return;
    sending = true;
    const mode = wanted;
    const now = Date.now();
```

with:

```ts
    timer = null;
    if (closed || !subscribed || sending || isPublished()) return;
    sending = true;
    const next = wanted();
    const now = Date.now();
```

**lib/realtime.ts — edit 6 of 9.** Replace:

```ts
    // A rejected call counts as failed (retried below) instead of leaving `sending` stuck.
    const status = await channel.track({ name: me.name, online_at: new Date(now).toISOString(), mode })
      .catch(() => "error" as const);
```

with:

```ts
    // A rejected call counts as failed (retried below) instead of leaving `sending` stuck.
    const status = await channel.track({ name: me.name, online_at: new Date(now).toISOString(), mode: next.mode, map: next.map })
      .catch(() => "error" as const);
```

**lib/realtime.ts — edit 7 of 9.** Replace:

```ts
    if (closed) return;
    if (status === "ok") published = mode;
    // The mode changed while the call was in flight, or the call failed/timed out → send again (budgeted).
    if (wanted !== published) schedule(status === "ok" ? 0 : 1000);
  };
```

with:

```ts
    if (closed) return;
    if (status === "ok") published = next;
    // The state changed while the call was in flight, or the call failed/timed out → send again (budgeted).
    if (!isPublished()) schedule(status === "ok" ? 0 : 1000);
  };
```

**lib/realtime.ts — edit 8 of 9.** Replace:

```ts
    .subscribe((status) => {
      // A (re)join starts with none of our presence on the server → publish the wanted mode again;
      // this re-track may use the call kept in reserve (5th per 30 s) and never waits behind a pending
```

with:

```ts
    .subscribe((status) => {
      // A (re)join starts with none of our presence on the server → publish the wanted state again;
      // this re-track may use the call kept in reserve (5th per 30 s) and never waits behind a pending
```

**lib/realtime.ts — edit 9 of 9.** Replace:

```ts
    setMode: (next) => {
      if (closed || next === wanted) return;
      wanted = next;
      // The 1 s delay merges rapid toggles; A→B→A inside it sends nothing because wanted === published.
      schedule(1000);
```

with:

```ts
    setMode: (next) => {
      if (closed || next === mode) return;
      mode = next;
      // The 1 s delay merges rapid toggles; A→B→A inside it sends nothing because the wanted state is published.
      schedule(1000);
    },
    setMap: (next) => {
      if (closed || next === map) return;
      map = next;
      schedule(1000);
```

**hooks/useRoom.ts — edit 1 of 5.** Replace:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeRoom, trackPresence, type PresenceHandle, type RoomState } from "@/lib/realtime";
```

with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { MapId } from "@/lib/game/maps/types";
import { subscribeRoom, trackPresence, type PresenceHandle, type RoomState } from "@/lib/realtime";
```

**hooks/useRoom.ts — edit 2 of 5.** Replace:

```ts
  presence: PresenceEntry[]; setPresenceMode: (m: PresenceMode) => void;
  token: string; accountId: string; username: string; myMemberId: string | null;
```

with:

```ts
  presence: PresenceEntry[]; setPresenceMode: (m: PresenceMode) => void;
  /** The game map I am on (published with the mode; shared presence budget). */
  setPresenceMap: (m: MapId) => void;
  token: string; accountId: string; username: string; myMemberId: string | null;
```

**hooks/useRoom.ts — edit 3 of 5.** Replace:

```ts
    presenceRef.current?.setMode(m);
  }, []);
```

with:

```ts
    presenceRef.current?.setMode(m);
  }, []);
  const mapRef = useRef<MapId>("hall");
  const setPresenceMap = useCallback((m: MapId) => {
    mapRef.current = m;
    presenceRef.current?.setMap(m);
  }, []);
```

**hooks/useRoom.ts — edit 4 of 5.** Replace:

```ts
      if (account) {
        presenceHandle = trackPresence(roomId, { memberId: account.accountId, name: account.username, mode: modeRef.current ?? readStoredMode() }, setPresence);
        presenceRef.current = presenceHandle;
```

with:

```ts
      if (account) {
        presenceHandle = trackPresence(roomId, {
          memberId: account.accountId, name: account.username, mode: modeRef.current ?? readStoredMode(), map: mapRef.current,
        }, setPresence);
        presenceRef.current = presenceHandle;
```

**hooks/useRoom.ts — edit 5 of 5.** Replace:

```ts
  const onlineIds = presence.map((p) => p.accountId);
  return { loading, state, onlineIds, presence, setPresenceMode, token: token ?? "", accountId, username: account?.username ?? "", myMemberId, role, kicked };
}
```

with:

```ts
  const onlineIds = presence.map((p) => p.accountId);
  return {
    loading, state, onlineIds, presence, setPresenceMode, setPresenceMap, token: token ?? "", accountId, username: account?.username ?? "",
    myMemberId, role, kicked,
  };
}
```

- [ ] **Step 5: Build the roster per map**

**lib/game/social.ts — edit 1 of 3.** Replace:

```ts
import type { RosterEntry } from "@/lib/game/engine";
import type { Seating } from "@/lib/game/maps/types";
import { assignSpots } from "@/lib/game/seating";
```

with:

```ts
import type { RosterEntry } from "@/lib/game/engine";
import type { MapId, Seating } from "@/lib/game/maps/types";
import { assignSpots } from "@/lib/game/seating";
```

**lib/game/social.ts — edit 2 of 3.** Replace:

```ts
  looks: Map<string, Look>;
  map: Seating;
}
```

with:

```ts
  looks: Map<string, Look>;
  /** The map this client is on. */
  mapId: MapId;
  /** Where classic-view members are shown: the hall's seating; null on a map without it (they are not drawn there). */
  seating: Seating | null;
}
```

**lib/game/social.ts — edit 3 of 3.** Replace:

```ts
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
```

with:

```ts
/**
 * Everyone online in the room and on my map, except me (non-members are ignored). Classic-view members are in
 * the hall with a fixed spot — the DJ behind the mixer, the others on café seats in account-id order — so every
 * client shows the same arrangement. Game-view members on this map walk (spot null).
 */
export function buildRoster({ presence, members, room, localId, looks, mapId, seating }: RosterInput): RosterEntry[] {
  const byAccount = new Map(members.map((m) => [m.account_id, m] as const));
  const roles = roleAccounts(room, members);
  const here = (p: PresenceEntry) => (p.mode === "classic" ? seating !== null : (p.map ?? "hall") === mapId);
  const online = presence.filter((p) => p.accountId !== localId && byAccount.has(p.accountId) && here(p));
  const seated = online.filter((p) => p.mode === "classic" && p.accountId !== roles.djAccountId).map((p) => p.accountId);
  const spots = assignSpots(seated, seating?.seats ?? [], seating?.standSpots ?? []);
  return online.map((p) => {
    const classic = p.mode === "classic";
    const spot = !classic || !seating ? null : p.accountId === roles.djAccountId ? seating.djSpot : spots.get(p.accountId) ?? null;
    return {
```

**components/game/GameShell.tsx.** Replace:

```tsx
    canvasRef.current?.setRoster(buildRoster({
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks, map: HALL_SEATING,
    }));
```

with:

```tsx
    canvasRef.current?.setRoster(buildRoster({
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks, mapId: "hall", seating: HALL_SEATING,
    }));
```

(The shell stays in the hall until Task 13 adds travel.)

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm vitest run tests/unit/presence-mode.test.ts tests/unit/presence-scheduler.test.ts tests/unit/game-social.test.ts` → PASS.
Run: `npx tsc --noEmit` and `npx eslint lib/presence-modes.ts lib/realtime.ts hooks/useRoom.ts lib/game/social.ts components/game/GameShell.tsx tests/unit/presence-mode.test.ts tests/unit/presence-scheduler.test.ts tests/unit/game-social.test.ts` → clean.

- [ ] **Step 7: Commit**

```bash
git add lib/presence-modes.ts lib/realtime.ts hooks/useRoom.ts lib/game/social.ts components/game/GameShell.tsx tests/unit/presence-mode.test.ts tests/unit/presence-scheduler.test.ts tests/unit/game-social.test.ts
git commit -m "feat(v14): presence carries the game map; roster and counts per map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The `fs` message, one channel per map (sends wait for SUBSCRIBED), remote fishing state

**Files:**
- Modify: `lib/game/net/protocol.ts` (full replacement), `lib/game/net/channel.ts` (full replacement), `lib/game/world.ts`
- Test: `tests/unit/game-channel.test.ts` (new, v13 carry-over M8), `tests/unit/game-protocol.test.ts`, `tests/unit/game-world.test.ts` (extend)

**Interfaces:**
- Consumes: `GameMap` (Task 7).
- Produces:
  - `protocol.ts`: `FishPhase = 0 | 1 | 2 | 3`; `GameMessage` gains `{ t: "fs"; id; f: FishPhase; h: string | null; c?: [string, number] }`; `st`/`mv` gain optional `h?: string | null` and (`st` only) `f?: FishPhase`; `pa` gains optional `h`. `GAME_EVENTS` includes `"fs"`. `parseGameMessage` validates `f ∈ {0,1,2,3}`, `h` = null or `/^[a-z_]{1,32}$/`, `c` = [that id, integer 1…100 000] and keeps `c` only with `f = 0`. `SendGate` gains `kick()` and the option `ready?: () => boolean` (messages wait while not ready: control FIFO, movement coalesced); `fs` is a control message.
  - `channel.ts`: `joinGameChannel(roomId, map: Pick<GameMap, "id" | "width" | "height">, handlers)` on topic `game:{roomId}:{mapId}`; nothing is sent before `SUBSCRIBED`; `leave(last)` sends `last` directly only while subscribed.
  - `world.ts`: `RemoteFishing { phase: FishPhase; hand: string | null; landed: { speciesId; weightG } | null }`, `FISHING_STALE_MS = 90_000`, `CATCH_LABEL_MS = 3000`, `RemoteWorld.fishing(id, now): RemoteFishing`; `applyMessage` takes `fs` and reads `h`/`f` from movement messages; `remove(id)` forgets the fishing state.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-channel.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// A fake Realtime channel: records the topic, the broadcast handlers, every send() and the removal.
const h = vi.hoisted(() => {
  const state = {
    topics: [] as string[],
    handlers: new Map<string, (m: { payload?: unknown }) => void>(),
    subscribeCb: null as ((s: string) => void) | null,
    sent: [] as Array<{ event: string; payload: Record<string, unknown> }>,
    removed: 0,
  };
  const channel = {
    on(_type: string, filter: { event: string }, cb: (m: { payload?: unknown }) => void) {
      state.handlers.set(filter.event, cb);
      return channel;
    },
    subscribe(cb: (s: string) => void) { state.subscribeCb = cb; return channel; },
    send(msg: { event: string; payload: Record<string, unknown> }) { state.sent.push({ event: msg.event, payload: msg.payload }); return Promise.resolve("ok"); },
  };
  return { state, channel };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    channel: (topic: string) => { h.state.topics.push(topic); return h.channel; },
    removeChannel: async () => { h.state.removed++; return "ok"; },
  },
}));

import { joinGameChannel } from "@/lib/game/net/channel";
import type { GameMessage } from "@/lib/game/net/protocol";

const MAP = { id: "pond" as const, width: 640, height: 400 };
const flush = () => new Promise((r) => setTimeout(r, 0));
const mv = (x: number): GameMessage => ({ t: "mv", id: "me", x, y: 10, d: "r", mv: true, vx: 1, vy: 0 });

beforeEach(() => {
  h.state.topics = []; h.state.handlers.clear(); h.state.subscribeCb = null; h.state.sent = []; h.state.removed = 0;
});

describe("joinGameChannel", () => {
  it("joins one topic per room and map", async () => {
    const ch = joinGameChannel("room1", MAP, { onMessage: () => {}, onStatus: () => {} });
    await flush();
    expect(h.state.topics).toEqual(["game:room1:pond"]);
    ch.leave();
    await flush();
  });

  it("holds sends until SUBSCRIBED: control messages in order, movement coalesced to the latest", async () => {
    const status: boolean[] = [];
    const ch = joinGameChannel("room2", MAP, { onMessage: () => {}, onStatus: (c) => status.push(c) });
    ch.send({ t: "hello", id: "me" });
    ch.send(mv(1));
    ch.send({ t: "fs", id: "me", f: 1, h: null });
    ch.send(mv(2));
    await flush();
    expect(h.state.sent).toEqual([]);
    h.state.subscribeCb!("SUBSCRIBED");
    expect(status).toEqual([true]);
    expect(h.state.sent.map((m) => m.event)).toEqual(["hello", "fs", "mv"]);
    expect(h.state.sent[2].payload.x).toBe(2);
    h.state.subscribeCb!("CHANNEL_ERROR");
    ch.send({ t: "lk", id: "me" });
    expect(h.state.sent).toHaveLength(3);
    expect(status).toEqual([true, false]);
    ch.leave();
    await flush();
  });

  it("passes valid broadcasts on and drops malformed ones", async () => {
    const got: GameMessage[] = [];
    const ch = joinGameChannel("room3", MAP, { onMessage: (m) => got.push(m), onStatus: () => {} });
    await flush();
    h.state.handlers.get("fs")!({ payload: { id: "ann", f: 2, h: "ca_ro" } });
    h.state.handlers.get("fs")!({ payload: { id: "ann", f: 7, h: null } });
    h.state.handlers.get("mv")!({ payload: { id: "ann", x: 900, y: 1, d: "l", mv: true, vx: -1, vy: 0 } });
    expect(got).toEqual([{ t: "fs", id: "ann", f: 2, h: "ca_ro" }]);
    ch.leave();
    await flush();
  });

  it("says bye directly on leave, then removes the channel", async () => {
    const ch = joinGameChannel("room4", MAP, { onMessage: () => {}, onStatus: () => {} });
    await flush();
    h.state.subscribeCb!("SUBSCRIBED");
    ch.leave({ t: "bye", id: "me" });
    await flush();
    expect(h.state.sent.map((m) => m.event)).toEqual(["bye"]);
    expect(h.state.removed).toBe(1);
    ch.send({ t: "hello", id: "me" });
    expect(h.state.sent).toHaveLength(1);
  });

  it("never creates the channel when left before the join resolved", async () => {
    const ch = joinGameChannel("room5", MAP, { onMessage: () => {}, onStatus: () => {} });
    ch.leave({ t: "bye", id: "me" });
    await flush();
    expect(h.state.topics).toEqual([]);
    expect(h.state.removed).toBe(0);
  });
});
```

Extend the protocol and world tests:

**tests/unit/game-protocol.test.ts — edit 1 of 2.** Replace:

```ts
      ["pa", { id: "a", x: 1, y: 2, pts: [[3]] }],
    ];
```

with:

```ts
      ["pa", { id: "a", x: 1, y: 2, pts: [[3]] }],
    ];
    for (const [event, payload] of bad) expect(parseGameMessage(event, payload, B), `${event} ${JSON.stringify(payload)}`).toBeNull();
  });
  it("accepts fishing state (fs) and the optional hand fish / phase on movement", () => {
    expect(parseGameMessage("fs", { id: "a", f: 1, h: null }, B)).toEqual({ t: "fs", id: "a", f: 1, h: null });
    expect(parseGameMessage("fs", { id: "a", f: 0, h: "ca_loc", c: ["ca_loc", 1200] }, B))
      .toEqual({ t: "fs", id: "a", f: 0, h: "ca_loc", c: ["ca_loc", 1200] });
    // a catch label only comes with f = 0
    expect(parseGameMessage("fs", { id: "a", f: 3, h: null, c: ["ca_loc", 1200] }, B)).toEqual({ t: "fs", id: "a", f: 3, h: null });
    expect(parseGameMessage("st", { id: "a", x: 1, y: 2, d: "u", mv: false, vx: 0, vy: 0, h: "ca_ro", f: 2 }, B))
      .toMatchObject({ t: "st", h: "ca_ro", f: 2 });
    expect(parseGameMessage("mv", { id: "a", x: 1, y: 2, d: "u", mv: true, vx: 0, vy: -1, h: null }, B)).toMatchObject({ t: "mv", h: null });
    expect(parseGameMessage("mv", { id: "a", x: 1, y: 2, d: "u", mv: true, vx: 0, vy: -1 }, B)).not.toHaveProperty("h");
    expect(parseGameMessage("pa", { id: "a", x: 1, y: 2, pts: [[3, 4]], h: "tom_cang" }, B)).toMatchObject({ t: "pa", h: "tom_cang" });
  });
  it("rejects malformed fishing fields", () => {
    const bad: Array<[string, unknown]> = [
      ["fs", { id: "a", f: 4, h: null }], ["fs", { id: "a", f: 1 }], ["fs", { id: "a", f: 1, h: "Cá Lóc" }],
      ["fs", { id: "a", f: 0, h: null, c: ["ca_loc", 0] }], ["fs", { id: "a", f: 0, h: null, c: ["ca_loc", 100_001] }],
      ["fs", { id: "a", f: 0, h: null, c: ["ca_loc", 1.5] }], ["fs", { id: "a", f: 0, h: null, c: ["x-y", 10] }],
      ["st", { id: "a", x: 1, y: 2, d: "u", mv: false, vx: 0, vy: 0, f: 9 }],
      ["mv", { id: "a", x: 1, y: 2, d: "u", mv: false, vx: 0, vy: 0, h: 42 }],
      ["pa", { id: "a", x: 1, y: 2, pts: [[3, 4]], h: "a".repeat(33) }],
    ];
```

**tests/unit/game-protocol.test.ts — edit 2 of 2.** Replace:

```ts

  it("keeps its normal pace after the clock steps back", () => {
```

with:

```ts

  it("treats fs as a control message: FIFO, never coalesced", () => {
    vi.useFakeTimers();
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m));
    for (const f of [1, 2, 3, 0] as const) gate.push({ t: "fs", id: "me", f, h: null });
    gate.push(mv(1));
    gate.push(mv(2));
    vi.advanceTimersByTime(3000);
    expect(sent.map((m) => (m.t === "fs" ? `fs${m.f}` : m.t))).toEqual(["fs1", "fs2", "fs3", "fs0", "mv"]);
    gate.dispose();
  });

  it("holds everything while not ready and sends it on kick()", () => {
    vi.useFakeTimers();
    let ready = false;
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m), { ready: () => ready });
    gate.push({ t: "hello", id: "me" });
    gate.push(mv(1));
    gate.push(mv(2));
    vi.advanceTimersByTime(5000);
    expect(sent).toEqual([]);
    ready = true;
    gate.kick();
    expect(sent.map((m) => m.t)).toEqual(["hello", "mv"]);
    expect((sent[1] as { x: number }).x).toBe(2);
    gate.dispose();
  });

  it("keeps its normal pace after the clock steps back", () => {
```

**tests/unit/game-world.test.ts — edit 1 of 2.** Replace:

```ts
import type { GameMessage } from "@/lib/game/net/protocol";
import { RemoteWorld, type RosterEntry } from "@/lib/game/world";
import { mapFromAscii } from "./helpers/ascii-map";
```

with:

```ts
import type { GameMessage } from "@/lib/game/net/protocol";
import { CATCH_LABEL_MS, FISHING_STALE_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";
import { mapFromAscii } from "./helpers/ascii-map";
```

**tests/unit/game-world.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("RemoteWorld: fishing", () => {
  const fs = (id: string, f: 0 | 1 | 2 | 3, h: string | null, c?: [string, number]): GameMessage =>
    (c ? { t: "fs", id, f, h, c } : { t: "fs", id, f, h });

  it("is idle with empty hands until something says otherwise", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    expect(w.fishing("ann", 0)).toEqual({ phase: 0, hand: null, landed: null });
  });

  it("follows the phase and the hand fish from fs, and shows a landed fish for 3 s", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    w.applyMessage(fs("ann", 1, null), 1000);
    expect(w.fishing("ann", 1000).phase).toBe(1);
    w.applyMessage(fs("ann", 3, null), 5000);
    w.applyMessage(fs("ann", 0, "ca_loc", ["ca_loc", 1200]), 9000);
    expect(w.fishing("ann", 9000)).toEqual({ phase: 0, hand: "ca_loc", landed: { speciesId: "ca_loc", weightG: 1200 } });
    expect(w.fishing("ann", 9000 + CATCH_LABEL_MS - 1).landed).not.toBeNull();
    expect(w.fishing("ann", 9000 + CATCH_LABEL_MS).landed).toBeNull();
    expect(w.fishing("ann", 9000 + CATCH_LABEL_MS).hand).toBe("ca_loc");
  });

  it("reads h (and f on st) from movement messages, e.g. the snapshot answering my hello", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    w.applyMessage({ ...st("ann", 100, 60), h: "ca_ro", f: 2 } as GameMessage, 0);
    expect(w.fishing("ann", 0)).toMatchObject({ phase: 2, hand: "ca_ro" });
    w.applyMessage({ ...mv("ann", 100, 60), h: null } as GameMessage, 100);
    expect(w.fishing("ann", 100)).toMatchObject({ phase: 2, hand: null });
    w.applyMessage(mv("ann", 110, 60), 200); // no h: the hand is unchanged
    expect(w.fishing("ann", 200).hand).toBeNull();
  });

  it("draws a silent angler idle again after 90 s", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    w.applyMessage(fs("ann", 1, "ca_ro"), 0);
    expect(w.fishing("ann", FISHING_STALE_MS).phase).toBe(1);
    expect(w.fishing("ann", FISHING_STALE_MS + 1)).toMatchObject({ phase: 0, hand: "ca_ro" });
  });

  it("forgets it on bye and ignores my own fs", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    w.applyMessage(fs("ann", 1, "ca_ro"), 0);
    w.remove("ann");
    expect(w.fishing("ann", 10)).toEqual({ phase: 0, hand: null, landed: null });
    w.applyMessage(fs("me", 1, null), 20);
    expect(w.fishing("me", 20).phase).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-channel.test.ts tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts`
Expected: FAIL — the topic is `game:room1`, sends go out before `SUBSCRIBED`, `fs` is rejected, `kick` / `fishing` / `CATCH_LABEL_MS` do not exist.

- [ ] **Step 3: Replace `lib/game/net/protocol.ts`**

```ts
import { MAX_PATH_POINTS } from "@/lib/game/pathfinding";
import type { Facing } from "@/lib/game/types";

/** Same cap as the path smoother: a `pa` message never carries more points. */
export { MAX_PATH_POINTS };

export type FacingCode = "u" | "d" | "l" | "r";
export type Unit = -1 | 0 | 1;
/** Fishing phase (v14): 0 idle, 1 line out, 2 bite, 3 reeling. */
export type FishPhase = 0 | 1 | 2 | 3;

/** Broadcast messages on channel `game:{roomId}:{mapId}` (v13 spec §8.2, v14 spec §9.3). `id` = sender account id.
 *  `h` = the species id of the fish in the sender's hand (null = none; absent = unchanged); `st` may carry `f`. */
export type GameMessage =
  | { t: "hello"; id: string }
  | { t: "st" | "mv"; id: string; x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit; h?: string | null; f?: FishPhase }
  | { t: "pa"; id: string; x: number; y: number; pts: Array<[number, number]>; h?: string | null }
  | { t: "fs"; id: string; f: FishPhase; h: string | null; c?: [string, number] }
  | { t: "lk"; id: string }
  | { t: "bye"; id: string };
export type GameEvent = GameMessage["t"];

export const GAME_EVENTS: readonly GameEvent[] = ["hello", "st", "mv", "pa", "fs", "lk", "bye"];

const TO_CODE: Record<Facing, FacingCode> = { up: "u", down: "d", left: "l", right: "r" };
const FROM_CODE: Record<FacingCode, Facing> = { u: "up", d: "down", l: "left", r: "right" };
export function facingToCode(f: Facing): FacingCode { return TO_CODE[f]; }
export function codeToFacing(c: FacingCode): Facing { return FROM_CODE[c]; }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isUnit = (v: unknown): v is Unit => v === -1 || v === 0 || v === 1;
const isCode = (v: unknown): v is FacingCode => v === "u" || v === "d" || v === "l" || v === "r";
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
/** Optional hand fish: absent → undefined (unchanged), else null or a species id; anything else is malformed. */
const handOf = (v: unknown): string | null | undefined | false => (v === undefined || v === null || isSpecies(v) ? v : false);

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
    case "mv": {
      if (!inMap(p.x, p.y) || !isCode(p.d) || typeof p.mv !== "boolean" || !isUnit(p.vx) || !isUnit(p.vy)) return null;
      const h = handOf(p.h);
      if (h === false || (event === "st" && p.f !== undefined && !isPhase(p.f))) return null;
      const msg: Extract<GameMessage, { t: "st" | "mv" }> = { t: event, id: p.id, x: p.x as number, y: p.y as number, d: p.d, mv: p.mv, vx: p.vx, vy: p.vy };
      if (h !== undefined) msg.h = h;
      if (event === "st" && isPhase(p.f)) msg.f = p.f;
      return msg;
    }
    case "pa": {
      if (!inMap(p.x, p.y) || !Array.isArray(p.pts) || p.pts.length === 0 || p.pts.length > MAX_PATH_POINTS) return null;
      const h = handOf(p.h);
      if (h === false) return null;
      const pts: Array<[number, number]> = [];
      for (const q of p.pts as unknown[]) {
        if (!Array.isArray(q) || q.length !== 2 || !inMap(q[0], q[1])) return null;
        pts.push([q[0] as number, q[1] as number]);
      }
      return h === undefined ? { t: "pa", id: p.id, x: p.x as number, y: p.y as number, pts } : { t: "pa", id: p.id, x: p.x as number, y: p.y as number, pts, h };
    }
    case "fs": {
      const h = handOf(p.h);
      if (!isPhase(p.f) || h === false || h === undefined) return null;
      if (p.c === undefined) return { t: "fs", id: p.id, f: p.f, h };
      const c = p.c;
      if (!Array.isArray(c) || c.length !== 2 || !isSpecies(c[0]) || !isInt(c[1]) || c[1] < 1 || c[1] > 100_000) return null;
      // a catch label only comes with the end of a cast
      return p.f === 0 ? { t: "fs", id: p.id, f: 0, h, c: [c[0], c[1]] } : { t: "fs", id: p.id, f: p.f, h };
    }
    default:
      return null;
  }
}

export function toPayload(msg: GameMessage): { event: GameEvent; payload: Record<string, unknown> } {
  const { t, ...rest } = msg;
  return { event: t, payload: rest };
}

export interface SendGate {
  push(msg: GameMessage): void;
  /** Send what is waiting now that `ready()` may have turned true (e.g. the channel subscribed). */
  kick(): void;
  dispose(): void;
}
export interface SendGateOptions {
  ratePerSec?: number;
  burst?: number;
  /** While false, messages wait in the gate (control FIFO, movement coalesced); call kick() when it turns true. */
  ready?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Token bucket (default 3 msgs/s, burst 3). Movement messages (mv/pa/st) are coalesced to the latest one;
 *  control messages (hello/fs/lk/bye) are queued FIFO, never dropped, and go first. */
export function createSendGate(send: (msg: GameMessage) => void, opts: SendGateOptions = {}): SendGate {
  const rate = opts.ratePerSec ?? 3;
  const burst = opts.burst ?? 3;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const ready = opts.ready ?? (() => true);
  let tokens = burst;
  let last = now();
  let timer: unknown = null;
  let disposed = false;
  let pendingMove: GameMessage | null = null;
  const queue: GameMessage[] = [];

  const refill = () => {
    const t = now();
    // a backwards clock step must not drive the bucket negative (that would stall hello/movement for as long)
    tokens = Math.min(burst, tokens + (Math.max(0, t - last) / 1000) * rate);
    last = t;
  };
  const flush = () => {
    timer = null;
    if (disposed || !ready()) return;
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
    kick() {
      if (!disposed && timer === null) flush();
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

- [ ] **Step 4: Replace `lib/game/net/channel.ts`**

```ts
import { supabase, type RealtimeChannel } from "@/lib/supabase";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import type { GameMap } from "@/lib/game/maps/types";
import { createSendGate, GAME_EVENTS, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";

export interface GameChannelHandlers {
  onMessage: (msg: GameMessage) => void;
  /** true once subscribed (again, after a reconnect); false on error/close. */
  onStatus: (connected: boolean) => void;
}

export interface GameChannelHandle {
  /** Rate-limited send (3 msgs/s, movement coalesced). Waits in the gate until the channel is subscribed. */
  send(msg: GameMessage): void;
  /** Leave the channel. `last` (usually `bye`) is sent directly, bypassing the gate, if the channel is subscribed. */
  leave(last?: GameMessage): void;
}

/** Broadcast channel `game:{roomId}:{mapId}` — one per map (v14 spec §9.1). Browser only. */
export function joinGameChannel(
  roomId: string,
  map: Pick<GameMap, "id" | "width" | "height">,
  handlers: GameChannelHandlers,
): GameChannelHandle {
  const topic = `game:${roomId}:${map.id}`;
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let left = false;
  // Only a subscribed channel sends over the socket; before that realtime-js would fall back to REST (with a warning).
  const post = (msg: GameMessage) => {
    if (!channel || !subscribed) return;
    const { event, payload } = toPayload(msg);
    channel.send({ type: "broadcast", event, payload }).catch(() => {});
  };
  const gate = createSendGate(post, { ready: () => subscribed });

  const joined = whenTopicFree(topic).then(() => {
    if (left) return;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    for (const ev of GAME_EVENTS) {
      ch.on("broadcast", { event: ev }, (m: { payload?: unknown }) => {
        const msg = parseGameMessage(ev, m.payload, map);
        if (msg) handlers.onMessage(msg);
      });
    }
    channel = ch;
    ch.subscribe((status) => {
      subscribed = status === "SUBSCRIBED";
      handlers.onStatus(subscribed);
      if (subscribed) gate.kick();
    });
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
        subscribed = false;
        return supabase.removeChannel(channel);
      }));
    },
  };
}
```

- [ ] **Step 5: Remember each member's fishing in `RemoteWorld`**

**lib/game/world.ts — edit 1 of 6.** Replace:

```ts
import type { GameMap, Spot } from "@/lib/game/maps/types";
import { codeToFacing, type GameMessage } from "@/lib/game/net/protocol";
import type { Look } from "@/lib/game/types";
```

with:

```ts
import type { GameMap, Spot } from "@/lib/game/maps/types";
import { codeToFacing, type FishPhase, type GameMessage } from "@/lib/game/net/protocol";
import type { Look } from "@/lib/game/types";
```

**lib/game/world.ts — edit 2 of 6.** Replace:

```ts
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null }
```

with:

```ts
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null }

/** What the others see of a member's fishing (v14 spec §9.3). */
export interface RemoteFishing {
  phase: FishPhase;
  /** Species id of the fish in their hand. */
  hand: string | null;
  /** A fish they just landed (shown as a label for CATCH_LABEL_MS). */
  landed: { speciesId: string; weightG: number } | null;
}

/** An angler silent for this long is drawn idle again (covers a lost `fs`). */
export const FISHING_STALE_MS = 90_000;
/** How long a catch label stays over a member's head. */
export const CATCH_LABEL_MS = 3000;

interface FishingNote { phase: FishPhase; hand: string | null; at: number; landed: { speciesId: string; weightG: number; at: number } | null }
const IDLE: RemoteFishing = { phase: 0, hand: null, landed: null };
```

**lib/game/world.ts — edit 3 of 6.** Replace:

```ts
  private readonly unseen = new Map<string, number>();
  private walking = 0;
```

with:

```ts
  private readonly unseen = new Map<string, number>();
  /** Fishing phase, hand fish and last catch per member, with the time of their last message. */
  private readonly fishingById = new Map<string, FishingNote>();
  private walking = 0;
```

**lib/game/world.ts — edit 4 of 6.** Replace:

```ts

  /** st / mv / pa from the network; other message types are ignored. */
  applyMessage(msg: GameMessage, now: number): void {
    if (msg.id === this.localId || !isMove(msg)) return;
    const last = { msg, at: now };
```

with:

```ts

  /** st / mv / pa / fs from the network; other message types are ignored. */
  applyMessage(msg: GameMessage, now: number): void {
    if (msg.id === this.localId) return;
    if (msg.t === "fs") {
      this.fishingById.set(msg.id, {
        phase: msg.f, hand: msg.h, at: now,
        landed: msg.c ? { speciesId: msg.c[0], weightG: msg.c[1], at: now } : this.fishingById.get(msg.id)?.landed ?? null,
      });
      return;
    }
    if (!isMove(msg)) return;
    this.noteMove(msg, now);
    const last = { msg, at: now };
```

**lib/game/world.ts — edit 5 of 6.** Replace:

```ts
    this.unseen.delete(id);
  }
```

with:

```ts
    this.unseen.delete(id);
    this.fishingById.delete(id);
  }

  /** A member's fishing as of `now`: a phase older than FISHING_STALE_MS reads as idle, a catch label lasts CATCH_LABEL_MS. */
  fishing(id: string, now: number): RemoteFishing {
    const n = this.fishingById.get(id);
    if (!n) return IDLE;
    return {
      phase: now - n.at > FISHING_STALE_MS ? 0 : n.phase,
      hand: n.hand,
      landed: n.landed && now - n.landed.at < CATCH_LABEL_MS ? { speciesId: n.landed.speciesId, weightG: n.landed.weightG } : null,
    };
  }
```

**lib/game/world.ts — edit 6 of 6.** Replace:

```ts
    for (const a of this.actorById.values()) tickActor(this.map, a, dtSec, now, true);
  }
```

with:

```ts
    for (const a of this.actorById.values()) tickActor(this.map, a, dtSec, now, true);
  }

  /** A movement message refreshes the fishing clock and may carry the hand fish (`h`) and, on `st`, the phase (`f`). */
  private noteMove(msg: MoveMsg, now: number): void {
    const prev = this.fishingById.get(msg.id);
    if (!prev && msg.h === undefined && (msg.t !== "st" || msg.f === undefined)) return;
    this.fishingById.set(msg.id, {
      phase: msg.t === "st" && msg.f !== undefined ? msg.f : prev?.phase ?? 0,
      hand: msg.h !== undefined ? msg.h : prev?.hand ?? null,
      at: now,
      landed: prev?.landed ?? null,
    });
  }
```

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm vitest run tests/unit/game-channel.test.ts tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts tests/unit/channel-lifecycle.test.ts` → PASS.
Run: `npx tsc --noEmit` and `npx eslint lib/game/net lib/game/world.ts tests/unit/game-channel.test.ts tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts` → clean. (`GameCanvas` already passes the `GameMap`, which has an `id`, so the new topic needs no change there.)

- [ ] **Step 7: Commit**

```bash
git add lib/game/net/protocol.ts lib/game/net/channel.ts lib/game/world.ts tests/unit/game-channel.test.ts tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts
git commit -m "feat(v14): fs message, one game channel per map, sends wait for SUBSCRIBED

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The engine draws fishing, NPCs and the HUD inset; input locks while the rod is out; frame guard

**Files:**
- Create: `lib/game/art/fishing.ts`
- Modify: `lib/game/engine.ts` (full replacement), `lib/game/scene.ts` (`cameraFor` inset), `lib/game/fishing/cast.ts` (`LocalPhase`, `phaseCode`)
- Test: `tests/unit/game-scene.test.ts`, `tests/unit/game-cast.test.ts` (extend)

**Interfaces:**
- Consumes: geometry (`bobberPoint`, `handPoint`, `rodTip`, `SWING_MS`) and `phaseCode` (Task 5 / this task); `FISH_ICONS`, `pixelIconMatrix` (Task 6); `RARITY_COLOR`, `formatWeight`, `Rarity` (Task 4); `RemoteWorld.fishing`, `CATCH_LABEL_MS`, `FishPhase` (Task 11); `map.npcs`, `SceneArt.edge` (Tasks 7–9).
- Produces:
  - `cast.ts`: `LocalPhase = "idle" | "casting" | "waiting" | "bite" | "reeling"`, `phaseCode(p): FishPhase` (idle/casting → 0, waiting 1, bite 2, reeling 3).
  - `scene.ts`: `cameraFor(feet, vw, vh, mapW, mapH, bottomInset = 0)`.
  - `art/fishing.ts` (browser): `RodLook { phase; swing; tint; glow; t; reducedMotion }`, `drawRod(c, feet, facing, look)`, `drawHeldFish(c, feet, facing, speciesId)`.
  - `engine.ts`: `LocalMoveMsg` gains `h`; `onLocalPath` messages carry `h`; `EngineCallbacks` gains optional `onFishingInput(kind: "tap" | "cancel")`, `onFirstFrame()`, `onFatal(err)`; `EngineOptions` gains optional `start: Spot`; `LocalFishing { phase: LocalPhase; tint?; glow? }`; `SpeciesInfo`; new methods `setBottomInset(cssPx)`, `setSpecies(list)`, `plant(at, facing)`, `setLocalFishing(f)`, `setLocalHand(speciesId | null)`, `showLocalCatch(speciesId, weightG)`, `anglerNear(p, radius = 12)`; `snapshot()` carries `h` (and `f` on `st`). While the local phase is not `"idle"`: WASD/arrows, click-to-move, E and the prompt are off, a canvas click/tap or Space calls `onFishingInput("tap")` and Esc `onFishingInput("cancel")`. NPCs are drawn (static, blue name tag). A throwing frame is skipped; three in a row stop the loop and call `onFatal`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-scene.test.ts.** Replace:

```ts
    expect(cameraFor({ x: 630, y: 395 }, 320, 180, 640, 400)).toEqual({ x: 320, y: 220 });
  });
```

with:

```ts
    expect(cameraFor({ x: 630, y: 395 }, 320, 180, 640, 400)).toEqual({ x: 320, y: 220 });
  });
  it("may scroll past the map's bottom by the HUD inset", () => {
    expect(cameraFor({ x: 630, y: 395 }, 320, 180, 640, 400, 30)).toEqual({ x: 320, y: 250 });
    expect(cameraFor({ x: 320, y: 200 }, 320, 180, 640, 400, 30)).toEqual({ x: 160, y: 86 });
  });
```

**tests/unit/game-cast.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { canHook, castPhase, msToNextPhase, reelParamsFor, type CastInfo } from "@/lib/game/fishing/cast";
import { BOBBER_REACH, bobberPoint, handPoint, rodTip } from "@/lib/game/fishing/geometry";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { canHook, castPhase, msToNextPhase, phaseCode, reelParamsFor, type CastInfo, type LocalPhase } from "@/lib/game/fishing/cast";
import { BOBBER_REACH, bobberPoint, handPoint, rodTip } from "@/lib/game/fishing/geometry";
```

**tests/unit/game-cast.test.ts — edit 2 of 2.** Replace:

```ts
    expect(msToNextPhase(INFO, 9000)).toBeNull();
  });
```

with:

```ts
    expect(msToNextPhase(INFO, 9000)).toBeNull();
  });
  it("shows others nothing during the swing, then line out, bite and reeling", () => {
    const phases: LocalPhase[] = ["idle", "casting", "waiting", "bite", "reeling"];
    expect(phases.map(phaseCode)).toEqual([0, 0, 1, 2, 3]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-scene.test.ts tests/unit/game-cast.test.ts`
Expected: FAIL — the camera ignores the inset (y 220, not 250) and `phaseCode` is not exported.

- [ ] **Step 3: Implement the inset and the phase code**

**lib/game/scene.ts.** Replace:

```ts

/** Camera top-left: centred on the character's head (feet y − 24), clamped to the map (centred if the view is bigger). */
export function cameraFor(feet: Vec, vw: number, vh: number, mapW: number, mapH: number): Vec {
  const axis = (target: number, span: number, size: number) =>
    size <= span ? (size - span) / 2 : Math.max(0, Math.min(size - span, target));
  return { x: axis(feet.x - vw / 2, vw, mapW), y: axis(feet.y - 24 - vh / 2, vh, mapH) };
}
```

with:

```ts

/** Camera top-left: centred on the character's head (feet y − 24), clamped to the map (centred if the view is bigger).
 *  `bottomInset` (world px) lets the camera scroll that far past the map's bottom edge, so the bottom HUD never hides
 *  the character (the band is painted in the scene's edge colour). */
export function cameraFor(feet: Vec, vw: number, vh: number, mapW: number, mapH: number, bottomInset = 0): Vec {
  const axis = (target: number, span: number, size: number) =>
    size <= span ? (size - span) / 2 : Math.max(0, Math.min(size - span, target));
  return { x: axis(feet.x - vw / 2, vw, mapW), y: axis(feet.y - 24 - vh / 2, vh, mapH + bottomInset) };
}
```

**lib/game/fishing/cast.ts — edit 1 of 2.** Replace:

```ts
import type { Rarity } from "./catalog";
```

with:

```ts
import type { FishPhase } from "@/lib/game/net/protocol";
import type { Rarity } from "./catalog";
```

**lib/game/fishing/cast.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
/** What the local player is doing with the rod, as the engine draws it (spec §6.1). */
export type LocalPhase = "idle" | "casting" | "waiting" | "bite" | "reeling";

/** The `f` code the others see (spec §9.3): the cast swing shows nothing yet. */
export function phaseCode(p: LocalPhase): FishPhase {
  return p === "waiting" ? 1 : p === "bite" ? 2 : p === "reeling" ? 3 : 0;
}
```

- [ ] **Step 4: Create `lib/game/art/fishing.ts`**

```ts
import { bobberPoint, handPoint, rodTip } from "@/lib/game/fishing/geometry";
import type { FishPhase } from "@/lib/game/net/protocol";
import type { Facing, Vec } from "@/lib/game/types";
import { FISH_ICONS } from "./fish";
import { pixelIconMatrix } from "./icons";
import { OUTLINE } from "./palettes";

// Fishing, drawn in world pixels (spec §11): the rod, the line, the bobber with its ripples / dip / splashes, and a
// fish held in the hands. Browser only (canvas). Original art.

type Ctx = CanvasRenderingContext2D;

const ROD = "#5a381e";
const ROD_TIP = "#c8905c";
const LINE = "rgba(240, 240, 232, 0.85)";
const RIPPLE = "#a6d6e8";
const SPLASH = "#e8f4f8";
const BOBBER_TOP = "#d8433a";
const BOBBER_BOTTOM = "#f4f1ea";
const LAMP_GLOW = "rgba(255, 224, 138, 0.4)";

export interface RodLook {
  /** 0 = the rod alone (the cast swing), 1 line out, 2 bite, 3 reeling. */
  phase: FishPhase;
  /** The rod's swing: 0 held back over the shoulder … 1 out over the water. */
  swing: number;
  /** Bobber top at the bite: the rarity colour when the bobber reveals it; null = red. */
  tint: string | null;
  /** Phao đèn glows. */
  glow: boolean;
  t: number;
  reducedMotion: boolean;
}

function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** A 1-px line from a to b that sags `sag` px in the middle. */
function line(c: Ctx, col: string, a: Vec, b: Vec, sag: number): void {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    px(c, col, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t + sag * 4 * t * (1 - t));
  }
}

/** Rod — and, once it is out, line and bobber — for a character whose feet are at `feet` (world px minus the camera). */
export function drawRod(c: Ctx, feet: Vec, facing: Facing, r: RodLook): void {
  const motion = !r.reducedMotion;
  const bend = r.phase === 3 ? 4 + (motion ? Math.floor(r.t / 90) % 2 : 0) : r.phase === 2 ? 2 : 0;
  const hand = handPoint(feet, facing);
  const tip = rodTip(feet, facing, r.phase === 0 ? r.swing : 1, bend);
  line(c, ROD, hand, tip, 0);
  px(c, ROD_TIP, tip.x, tip.y);
  if (r.phase === 0) return;
  const b = bobberPoint(feet, facing);
  line(c, LINE, tip, b, r.phase === 3 ? 0 : 3);
  // the bobber dips at the bite (a steady dip under reduced motion — it is the signal to hook)
  const dip = r.phase === 2 ? (motion ? Math.floor(r.t / 160) % 2 : 1) : 0;
  if (r.phase === 1 && motion && Math.floor(r.t / 1200) % 2 === 0) {
    const rad = 3 + ((r.t / 150) % 4);
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      px(c, RIPPLE, b.x + Math.cos(ang) * rad, b.y + 1 + Math.sin(ang) * rad * 0.45);
    }
  }
  if (r.phase === 3 && motion) {
    for (let k = 0; k < 5; k++) px(c, SPLASH, b.x - 3 + ((k * 7 + Math.floor(r.t / 70)) % 7), b.y - 1 - ((k * 3 + Math.floor(r.t / 110)) % 3));
  }
  if (r.glow) {
    c.fillStyle = LAMP_GLOW;
    c.fillRect(Math.round(b.x) - 4, Math.round(b.y) - 5 + dip, 9, 9);
  }
  const x = Math.round(b.x), y = Math.round(b.y);
  c.fillStyle = OUTLINE;
  c.fillRect(x - 2, y - 3 + dip, 5, 5);
  c.fillStyle = r.tint && r.phase >= 2 ? r.tint : BOBBER_TOP;
  c.fillRect(x - 1, y - 2 + dip, 3, 2);
  if (dip === 0) {
    c.fillStyle = BOBBER_BOTTOM;
    c.fillRect(x - 1, y, 3, 1);
  }
}

const fishCache = new Map<string, HTMLCanvasElement | null>();

/** A species icon as a 16×16 canvas, mirrored for characters facing right; null for an unknown id. */
function fishCanvas(speciesId: string, mirror: boolean): HTMLCanvasElement | null {
  const key = `${speciesId}|${mirror ? 1 : 0}`;
  const hit = fishCache.get(key);
  if (hit !== undefined) return hit;
  const icon = FISH_ICONS[speciesId];
  const cv = icon ? document.createElement("canvas") : null;
  const c = cv?.getContext("2d") ?? null;
  if (!cv || !c || !icon) {
    fishCache.set(key, null);
    return null;
  }
  cv.width = 16;
  cv.height = 16;
  pixelIconMatrix(icon).forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    c.fillStyle = col;
    c.fillRect(mirror ? 15 - x : x, y, 1, 1);
  }));
  fishCache.set(key, cv);
  return cv;
}

/** The fish in a character's hands at 1:1: in front of the belly facing down, at the side facing left/right, hidden
 *  (behind the body) facing up. */
export function drawHeldFish(c: Ctx, feet: Vec, facing: Facing, speciesId: string): void {
  if (facing === "up") return;
  const cv = fishCanvas(speciesId, facing === "right");
  if (!cv) return;
  const x = Math.round(feet.x), y = Math.round(feet.y);
  if (facing === "down") c.drawImage(cv, x - 8, y - 27);
  else if (facing === "left") c.drawImage(cv, x - 15, y - 28);
  else c.drawImage(cv, x - 1, y - 28);
}
```

- [ ] **Step 5: Replace `lib/game/engine.ts`**

```ts
import { createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
import { getCharacterFrames } from "@/lib/game/art/raster";
import { phaseCode, type LocalPhase } from "@/lib/game/fishing/cast";
import { formatWeight, RARITY_COLOR, type Rarity } from "@/lib/game/fishing/catalog";
import { SWING_MS } from "@/lib/game/fishing/geometry";
import type { SceneArt } from "@/lib/game/maps/scene-art";
import type { GameMap, Interactable, Spot } from "@/lib/game/maps/types";
import { inputDir, type KeyState } from "@/lib/game/movement";
import { facingToCode, MAX_PATH_POINTS, type FacingCode, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { unseenGraceMs } from "@/lib/game/net/replies";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView, hitsCharacter, interactableAt, inUseRange, nearestInteractable, stackBoxes, type Box } from "@/lib/game/scene";
import { wrapBubble } from "@/lib/game/text";
import type { Facing, Look, Vec } from "@/lib/game/types";
import { CATCH_LABEL_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";

export type { RosterEntry } from "@/lib/game/world";

export interface LocalMoveMsg { x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit; h: string | null }

export interface EngineCallbacks {
  /** Keyboard movement started, stopped or turned (plus a keep-alive every 3 s while walking). */
  onLocalMove: (m: LocalMoveMsg) => void;
  /** A click/tap path started. */
  onLocalPath: (m: { x: number; y: number; pts: Array<[number, number]>; h: string | null }) => void;
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
  onActorClick: (accountId: string) => void;
  /** While the rod is out: a click/tap on the canvas or Space ("tap"), or Esc ("cancel"). */
  onFishingInput?: (kind: "tap" | "cancel") => void;
  /** The first frame has been drawn (the shell fades in). */
  onFirstFrame?: () => void;
  /** Three frames in a row threw: the loop has stopped. */
  onFatal?: (err: unknown) => void;
}

export interface EngineOptions {
  localId: string;
  name: string;
  badges: string;
  look: Look;
  /** Where I appear (a portal's arrival spot); the map's spawn by default. */
  start?: Spot;
  /** CSS font-family for canvas text (the VT323 family from next/font). */
  fontFamily: string;
  reducedMotion: boolean;
}

/** How the local rod looks (spec §6.1, §11). */
export interface LocalFishing {
  phase: LocalPhase;
  /** Bobber colour at the bite when the bobber reveals the rarity. */
  tint?: string | null;
  /** Phao đèn glows. */
  glow?: boolean;
}

export interface SpeciesInfo { name: string; rarity: Rarity }

const KEYMAP: Record<string, keyof KeyState> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};
const KEEPALIVE_MS = 3000;
const BUBBLE_MS = 6000;
const REACTION_MS = 1600;
const MAX_FAILED_FRAMES = 3;
const NO_KEYS: KeyState = { up: false, down: false, left: false, right: false };

/** Canvas 2D game loop: input, local + remote actors, NPCs, fishing, camera, depth-sorted rendering, overlays.
 *  Browser only. */
export class GameEngine {
  private readonly canvas: HTMLCanvasElement;
  private readonly map: GameMap;
  private readonly art: SceneArt;
  private readonly cb: EngineCallbacks;
  private readonly opts: EngineOptions;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly buf: HTMLCanvasElement;
  private readonly bctx: CanvasRenderingContext2D;
  private readonly ro: ResizeObserver;
  private readonly local: Actor;
  /** Everyone else: roster, remote walkers, their last known state and their fishing. */
  private readonly world: RemoteWorld;
  private readonly bubbles = new Map<string, { lines: string[]; until: number }>();
  private reactions: Array<{ id: string | null; emoji: string; born: number; dx: number }> = [];
  private localInfo: { name: string; badges: string; look: Look };
  private keys: KeyState = { ...NO_KEYS };
  private scale = 3;
  private vw = 320;
  private vh = 180;
  private dpr = 1;
  private cam: Vec = { x: 0, y: 0 };
  /** Height of the bottom HUD in CSS px (the camera may scroll that far past the map's bottom). */
  private insetCss = 0;
  private inputEnabled = true;
  private pendingInteract: Interactable | null = null;
  private prompt: Interactable | null = null;
  private lastSent = { mv: false, vx: 0, vy: 0, at: 0 };
  private fishing: Required<LocalFishing> = { phase: "idle", tint: null, glow: false };
  private castAt = 0;
  private hand: string | null = null;
  private landed: { speciesId: string; weightG: number; until: number } | null = null;
  private species = new Map<string, SpeciesInfo>();
  private raf = 0;
  private lastT = 0;
  private failures = 0;
  private drewFirst = false;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, map: GameMap, art: SceneArt, cb: EngineCallbacks, opts: EngineOptions) {
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
    const start = opts.start ?? map.spawn;
    this.local = createActor(opts.localId, { x: start.x, y: start.y }, start.dir, performance.now());
    this.world = new RemoteWorld(map, opts.localId);
    this.localInfo = { name: opts.name, badges: opts.badges, look: opts.look };
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
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
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
  }

  // ------------------------------------------------------------ data in

  setLocal(info: { name: string; badges: string; look: Look }): void {
    this.localInfo = info;
  }

  /** Everyone online on this map except me. Walking members get an actor (placed with their last known state). */
  setRoster(entries: RosterEntry[]): void {
    this.world.setRoster(entries, performance.now());
  }

  /** Someone's `hello`: a walking member we had dropped (their `bye`) gets an actor again. */
  noteHello(id: string): void {
    this.world.hello(id, performance.now());
  }

  /** st / mv / pa / fs from the network (other message types are handled by the caller). */
  applyMessage(msg: GameMessage): void {
    this.world.applyMessage(msg, performance.now());
  }

  /** Someone's `bye`. */
  removeActor(id: string): void {
    this.world.remove(id);
  }

  /** How many other members walk on this map (sizes the answer window for `hello`s). */
  walkers(): number {
    return this.world.walkers();
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
    if (!enabled) {
      this.keys = { ...NO_KEYS };
      // drop the pending interaction but let the walk finish: others follow the same `pa` to its end
      this.pendingInteract = null;
    }
  }

  /** Height of the bottom HUD in CSS px: the camera may scroll that far past the map's bottom edge. */
  setBottomInset(cssPx: number): void {
    this.insetCss = Math.max(0, cssPx);
  }

  /** Names and rarities for the catch labels. */
  setSpecies(list: ReadonlyArray<{ id: string; name: string; rarity: Rarity }>): void {
    this.species = new Map(list.map((s) => [s.id, { name: s.name, rarity: s.rarity }]));
  }

  /** Trigger the interactable in range (E key / HUD button). Nothing happens while the rod is out. */
  interact(): void {
    if (this.prompt && this.fishing.phase === "idle") this.trigger(this.prompt);
  }

  /** Stand exactly on `at`, facing `facing` (a fishing spot), and tell the others at once. */
  plant(at: Vec, facing: Facing): void {
    this.keys = { ...NO_KEYS };
    this.pendingInteract = null;
    setKeyboard(this.local, { x: 0, y: 0 });
    this.local.pos = { x: at.x, y: at.y };
    this.local.display = { x: at.x, y: at.y };
    this.local.facing = facing;
    const m = this.localMove();
    this.cb.onLocalMove(m);
    this.lastSent = { mv: m.mv, vx: m.vx, vy: m.vy, at: performance.now() };
  }

  /** What my rod shows. While it is out, movement, click-to-move and interactables are off. */
  setLocalFishing(f: LocalFishing): void {
    if (f.phase === "casting" && this.fishing.phase !== "casting") this.castAt = performance.now();
    this.fishing = { phase: f.phase, tint: f.tint ?? null, glow: f.glow ?? false };
    if (f.phase !== "idle") {
      this.keys = { ...NO_KEYS };
      this.pendingInteract = null;
    }
  }

  /** The fish in my hands (species id), or null. */
  setLocalHand(speciesId: string | null): void {
    this.hand = speciesId;
  }

  /** "🐟 Cá lóc 1,2 kg" over my head for a moment. */
  showLocalCatch(speciesId: string, weightG: number): void {
    this.landed = { speciesId, weightG, until: performance.now() + CATCH_LABEL_MS };
  }

  /** Is another visible member fishing within `radius` px of `p` (the spot is taken)? */
  anglerNear(p: Vec, radius = 12): boolean {
    const now = performance.now();
    for (const [id, a] of this.world.actors) {
      if (!this.visible(id, now) || this.world.fishing(id, now).phase === 0) continue;
      if (Math.hypot(a.pos.x - p.x, a.pos.y - p.y) <= radius) return true;
    }
    return false;
  }

  /** My current state as a message — the answer to someone's `hello`. */
  snapshot(): GameMessage {
    const id = this.opts.localId;
    if (this.local.path && this.local.path.length > 0) {
      return {
        t: "pa", id, x: Math.round(this.local.pos.x), y: Math.round(this.local.pos.y),
        pts: this.local.path.slice(0, MAX_PATH_POINTS).map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]),
        h: this.hand,
      };
    }
    return { t: "st", id, ...this.localMove(), f: phaseCode(this.fishing.phase) };
  }

  // ------------------------------------------------------------ internals

  private get rodOut(): boolean {
    return this.fishing.phase !== "idle";
  }

  /** An explicit interaction (in-range click, E/Enter, HUD button) cancels any earlier walk-to-interact. */
  private trigger(it: Interactable): void {
    this.pendingInteract = null;
    this.cb.onInteract(it);
  }

  private localMove(): LocalMoveMsg {
    return {
      x: Math.round(this.local.pos.x),
      y: Math.round(this.local.pos.y),
      d: facingToCode(this.local.facing),
      mv: this.local.moving && !this.local.path,
      vx: (Math.sign(this.local.dir.x) || 0) as Unit,
      vy: (Math.sign(this.local.dir.y) || 0) as Unit,
      h: this.hand,
    };
  }

  /** A walking member is drawn once we know where they are, or once the answers to their `hello` are overdue
   *  (the answer window grows with the world: everyone else walking + me). */
  private visible(id: string, now: number): boolean {
    return this.world.visible(id, now, unseenGraceMs(this.world.walkers() + 1));
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
    if (this.rodOut) {
      // while fishing: Space hooks (and holds while reeling — the reel overlay listens too), Esc reels in
      if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) this.cb.onFishingInput?.("tap");
      } else if (e.code === "Escape") {
        this.cb.onFishingInput?.("cancel");
      }
      return;
    }
    const k = KEYMAP[e.code];
    if (k) {
      this.keys[k] = true;
      e.preventDefault();
      return;
    }
    if ((e.code === "KeyE" || e.code === "Enter") && this.prompt) {
      // Enter keeps its normal meaning on a focused button or link (HUD controls)
      if (e.code === "Enter" && e.target instanceof HTMLElement && e.target.closest("button, a[href], [role='button']")) return;
      e.preventDefault();
      this.trigger(this.prompt);
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const k = KEYMAP[e.code];
    if (k) this.keys[k] = false;
  };

  private readonly onBlur = (): void => {
    this.halt();
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.halt();
  };

  /** Focus left the page or the tab was hidden: stop keyboard walking and send the stop now — a hidden tab may not
   *  run another frame, and everyone else would see me walk on. A click/tap path goes on (others follow the same `pa`). */
  private halt(): void {
    this.keys = { ...NO_KEYS };
    if (!this.local.path) setKeyboard(this.local, { x: 0, y: 0 });
    this.announceMove(performance.now());
  }

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.inputEnabled || e.button !== 0) return;
    if (this.rodOut) {
      this.cb.onFishingInput?.("tap");
      return;
    }
    const r = this.canvas.getBoundingClientRect();
    const w: Vec = {
      x: ((e.clientX - r.left) * this.dpr) / this.scale + this.cam.x,
      y: ((e.clientY - r.top) * this.dpr) / this.scale + this.cam.y,
    };
    // Interactables win over people: the DJ stands right behind the booth.
    const it = interactableAt(this.map, w);
    if (it) {
      if (inUseRange(it, this.local.pos)) {
        this.trigger(it);
        return;
      }
      this.pendingInteract = it;
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
    for (const e of this.world.roster.values()) {
      const feet = e.spot ?? (this.visible(e.id, now) ? this.world.actors.get(e.id)?.display : undefined);
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
      h: this.hand,
    });
  }

  private positionOf(id: string, now: number): Vec | null {
    if (id === this.opts.localId) return this.local.display;
    const e = this.world.roster.get(id);
    if (!e) return null;
    if (e.spot) return e.spot;
    return this.visible(id, now) ? this.world.actors.get(id)?.display ?? null : null;
  }

  /** One frame. A throwing frame is skipped; MAX_FAILED_FRAMES in a row stop the loop and report (M3 guard). */
  private readonly frame = (t: number): void => {
    if (this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000));
    this.lastT = t;
    try {
      this.update(dt, t);
      this.render(t);
      this.failures = 0;
    } catch (err) {
      this.failures++;
      if (this.failures >= MAX_FAILED_FRAMES) {
        this.destroyed = true;
        this.cb.onFatal?.(err);
        return;
      }
    }
    if (!this.drewFirst && this.failures === 0) {
      this.drewFirst = true;
      this.cb.onFirstFrame?.();
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private update(dt: number, now: number): void {
    const dir = this.inputEnabled && !this.rodOut ? inputDir(this.keys) : { x: 0, y: 0 };
    if (dir.x !== 0 || dir.y !== 0) {
      this.pendingInteract = null;
      setKeyboard(this.local, dir);
    } else if (!this.local.path && this.local.moving) {
      setKeyboard(this.local, dir);
    }
    const arrived = tickActor(this.map, this.local, dt, now, false);
    if (arrived && this.pendingInteract) {
      const it = this.pendingInteract;
      this.pendingInteract = null;
      // a long walk can end early (smoothPath caps the waypoints) — only trigger when we really got there
      if (inUseRange(it, this.local.pos)) this.cb.onInteract(it);
    }
    this.announceMove(now);
    const near = this.rodOut ? null : nearestInteractable(this.map, this.local.pos);
    if (near !== this.prompt) {
      this.prompt = near;
      this.cb.onPromptChange(near);
    }
    this.world.tick(dt, now);
    const inset = Math.ceil((this.insetCss * this.dpr) / this.scale);
    this.cam = cameraFor(this.local.display, this.vw, this.vh, this.map.width, this.map.height, inset);
    for (const [id, b] of this.bubbles) if (b.until < now) this.bubbles.delete(id);
    this.reactions = this.reactions.filter((r) => now - r.born < REACTION_MS);
    if (this.landed && this.landed.until < now) this.landed = null;
  }

  /** Keyboard walking started, stopped or turned → `mv` (plus a keep-alive every 3 s while walking). A path is
   *  announced once, when it starts. */
  private announceMove(now: number): void {
    if (this.local.path) return;
    const m = this.localMove();
    const changed = m.mv !== this.lastSent.mv || m.vx !== this.lastSent.vx || m.vy !== this.lastSent.vy;
    if (changed || (m.mv && now - this.lastSent.at > KEEPALIVE_MS)) {
      this.cb.onLocalMove(m);
      this.lastSent = { mv: m.mv, vx: m.vx, vy: m.vy, at: now };
    }
  }

  private render(t: number): void {
    const b = this.bctx;
    const camX = Math.round(this.cam.x), camY = Math.round(this.cam.y);
    const reduced = this.opts.reducedMotion;
    b.imageSmoothingEnabled = false;
    b.fillStyle = this.art.edge;
    b.fillRect(0, 0, this.vw, this.vh);
    b.drawImage(this.art.background, -camX, -camY);
    this.art.drawAnimated(b, t, camX, camY, reduced);

    const items: Array<{ y: number; draw: () => void }> = [];
    for (const p of this.art.props) {
      const x = p.x - camX, y = p.y - camY;
      if (x > this.vw || y > this.vh || x + p.canvas.width < 0 || y + p.canvas.height < 0) continue;
      items.push({ y: p.sortY, draw: () => b.drawImage(p.canvas, x, y) });
    }
    const onScreen = (pos: Vec) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      return x >= -16 && x <= this.vw + 16 && y >= -4 && y <= this.vh + 60;
    };
    const drawActor = (look: Look, pos: Vec, facing: Facing, frame: 0 | 1 | 2 | 3) => {
      const x = Math.round(pos.x) - camX, y = Math.round(pos.y) - camY;
      b.fillStyle = "rgba(40, 25, 10, 0.28)";
      b.fillRect(x - 7, y - 1, 14, 2);
      b.fillRect(x - 5, y + 1, 10, 1);
      b.drawImage(getCharacterFrames(look)[facing][frame], x - 12, y - 46);
    };
    /** The rod (while fishing) or the fish in hand, drawn over the character. */
    const drawGear = (pos: Vec, facing: Facing, phase: 0 | 1 | 2 | 3, hand: string | null, rod: { swing: number; tint: string | null; glow: boolean } | null) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      if (rod) drawRod(b, feet, facing, { phase, swing: rod.swing, tint: rod.tint, glow: rod.glow, t, reducedMotion: reduced });
      else if (hand) drawHeldFish(b, feet, facing, hand);
    };
    for (const e of this.world.roster.values()) {
      const spot = e.spot;
      if (spot) {
        if (onScreen(spot)) items.push({ y: spot.y, draw: () => drawActor(e.look, spot, spot.dir, 0) });
        continue;
      }
      const a = this.world.actors.get(e.id);
      if (!a || !this.visible(e.id, t) || !onScreen(a.display)) continue;
      const f = this.world.fishing(e.id, t);
      items.push({
        y: a.display.y,
        draw: () => {
          drawActor(e.look, a.display, a.facing, walkFrame(a));
          drawGear(a.display, a.facing, f.phase, f.hand, f.phase === 0 ? null : { swing: 1, tint: null, glow: false });
        },
      });
    }
    for (const n of this.map.npcs) {
      if (onScreen(n.spot)) items.push({ y: n.spot.y, draw: () => drawActor(n.look, n.spot, n.spot.dir, 0) });
    }
    const me = this.local;
    const fishing = this.fishing;
    items.push({
      y: me.display.y,
      draw: () => {
        drawActor(this.localInfo.look, me.display, me.facing, walkFrame(me));
        const swing = Math.min(1, (t - this.castAt) / SWING_MS);
        drawGear(me.display, me.facing, phaseCode(fishing.phase), this.hand,
          fishing.phase === "idle" ? null : { swing, tint: fishing.tint, glow: fishing.glow });
      },
    });
    items.sort((p, q) => p.y - q.y);
    for (const it of items) it.draw();
    this.art.drawOverhead(b, t, camX, camY, reduced);

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
    const tags: Array<{ kind: "me" | "other" | "npc"; label: string; pos: Vec }> = [
      { kind: "me", label: this.label(this.localInfo.badges, this.localInfo.name), pos: this.local.display },
    ];
    for (const e of this.world.roster.values()) {
      const pos = this.positionOf(e.id, now);
      if (pos) tags.push({ kind: "other", label: this.label(e.badges, e.name), pos });
    }
    for (const n of this.map.npcs) tags.push({ kind: "npc", label: n.name, pos: n.spot });
    tags.sort((p, q) => p.pos.y - q.pos.y);
    c.font = `${Math.round(4.4 * s)}px ${font}`;
    const tagBoxes = stackBoxes(tags.map((tg): Box => {
      const [x, y] = dev(tg.pos.x, tg.pos.y + 3);
      const w = Math.round(c.measureText(tg.label).width + 3 * s);
      return { x: Math.round(x - w / 2), y: Math.round(y), w, h: Math.round(5.2 * s) };
    }), 1, 1);
    tags.forEach((tg, i) => {
      const bx = tagBoxes[i];
      c.fillStyle = tg.kind === "me" ? "rgba(139, 90, 43, 0.92)" : tg.kind === "npc" ? "rgba(47, 110, 143, 0.88)" : "rgba(58, 36, 24, 0.78)";
      c.fillRect(bx.x, bx.y, bx.w, bx.h);
      c.fillStyle = "#fbf3dc";
      c.fillText(tg.label, bx.x + bx.w / 2, bx.y + bx.h / 2 + s * 0.3);
    });

    // fishing: ❗ over an angler at the bite, a catch label over whoever just landed a fish
    const marks: Array<{ pos: Vec; bite: boolean; landed: { speciesId: string; weightG: number } | null }> = [];
    if (this.fishing.phase === "bite" || this.landed) {
      marks.push({ pos: this.local.display, bite: this.fishing.phase === "bite", landed: this.landed });
    }
    for (const id of this.world.actors.keys()) {
      const f = this.world.fishing(id, now);
      if (f.phase !== 2 && !f.landed) continue;
      const pos = this.positionOf(id, now);
      if (pos) marks.push({ pos, bite: f.phase === 2, landed: f.landed });
    }
    for (const m of marks) {
      if (m.bite) {
        c.font = `${Math.round(10 * s)}px ${font}`;
        c.fillStyle = "#fbf3dc";
        const [x, y] = dev(m.pos.x, m.pos.y - 56);
        c.fillText("❗", x, y);
      }
      if (m.landed) {
        const info = this.species.get(m.landed.speciesId);
        const text = `🐟 ${info ? `${info.name} ` : ""}${formatWeight(m.landed.weightG)}`;
        c.font = `${Math.round(5 * s)}px ${font}`;
        const w = Math.round(c.measureText(text).width + 4 * s), h = Math.round(6.4 * s);
        const [x, y] = dev(m.pos.x, m.pos.y - 62);
        c.fillStyle = "rgba(58, 36, 24, 0.85)";
        c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
        c.fillStyle = info ? RARITY_COLOR[info.rarity] : "#fbf3dc";
        c.fillText(text, x, y + s * 0.3);
      }
    }

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

    // floating reactions (id null or not on this map = the whole room: rise from the top middle)
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

- [ ] **Step 6: Run the tests, typecheck and lint**

Run: `pnpm vitest run` → all green.
Run: `npx tsc --noEmit` and `npx eslint lib/game tests/unit/game-scene.test.ts tests/unit/game-cast.test.ts` → clean. (`GameCanvas` does not pass the new optional callbacks yet; Task 13 wires them.)

- [ ] **Step 7: Commit**

```bash
git add lib/game/art/fishing.ts lib/game/engine.ts lib/game/scene.ts lib/game/fishing/cast.ts tests/unit/game-scene.test.ts tests/unit/game-cast.test.ts
git commit -m "feat(v14): engine draws rods, bobbers, held fish and NPCs; input lock, HUD inset, frame guard

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Travel between maps — GameCanvas per map, fade, presence map, map counts, phone HUD

**Files:**
- Modify (full replacement): `components/game/GameCanvas.tsx`, `components/game/GameShell.tsx`, `components/game/HudNowPlaying.tsx`
- Create: `components/game/MapCounts.tsx`
- Test: `tests/unit/game-hud-travel.test.tsx`

**Interfaces:**
- Consumes: `getMap`, `paintMap` (Task 9); `mapCounts`, `setPresenceMap` (Task 10); `joinGameChannel` per map (Task 11); the engine API (Task 12).
- Produces:
  - `GameCanvas` props: `mapId: MapId`, `arrive: Spot | null`, `onFishingInput(kind)`, `onFirstFrame()`, `onFatal()` (plus the v13 props). A change of `mapId`/`arrive` tears down the engine and channel (`bye` on the old map) and starts new ones at `arrive`. `GameCanvasHandle` gains `setBottomInset(px)`, `setSpecies(list)`, `plant(at, facing)`, `setFishing(f: LocalFishing)` (sends `fs` when the phase others see changes), `setHand(speciesId | null)` (sends `fs` when it changes), `landCatch(speciesId, weightG, hand)` (one `fs` with `f = 0`, the new hand and `c`), `anglerNear(p)`. The hand fish, species list and inset are re-applied to every new engine.
  - `GameShell`: `travel` state `{ mapId, arrive }` (always starts in the hall), a 250 ms fade that clears on the new map's first frame, `setPresenceMap(travel.mapId)`, the roster built for the current map, `MapCounts` at the top, the bottom HUD height passed as the camera inset, portal interactables travel, the pond's other interactables toast "Sắp mở — chờ chút nhé!" until Tasks 14–16, `onFatal` falls back to the classic view with "Thế giới game gặp lỗi — quay về giao diện cũ.", the member card says where the member is.
  - `MapCounts({ counts })`: "🎵 Sảnh N · 🎣 Ao cá N"; a tap lists the names per map (🖥️ for classic members).
  - `HudNowPlaying`: under 640 px a chip (title, ▶/⏸ for the DJ, 🔈 when audio is locked) that expands to the full card and folds back with ▴.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/game-hud-travel.test.tsx`:

```tsx
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import HudNowPlaying from "@/components/game/HudNowPlaying";
import MapCounts from "@/components/game/MapCounts";
import type { PlaybackController } from "@/hooks/usePlayback";
import type { QueueItem, Room } from "@/lib/supabase";

afterEach(cleanup);

const room: Room = {
  id: "r", code: "ABC", name: "Phòng", play_mode: "order", admin_member_id: null, dj_member_id: null,
  current_item_id: "q1", is_playing: true, started_at: null, paused_elapsed_ms: 0, created_at: "",
  max_duration_seconds: 600, require_approval: false, banned_keywords: [], max_orders_per_member: 3, auto_replay_history: false,
};
const current: QueueItem = {
  id: "q1", room_id: "r", youtube_video_id: "v", title: "Lý cây bông", thumbnail_url: null, duration_seconds: 200,
  added_by_account_id: null, added_by_name: "An", position: 0, created_at: "", status: "approved",
};
const playback: PlaybackController = {
  durationMs: 200_000, volume: 50, unlocked: true, unlock: vi.fn(), playError: null,
  togglePlay: vi.fn(), skip: vi.fn(), seekMs: vi.fn(), setVolume: vi.fn(),
};
const noop = () => {};

describe("HudNowPlaying on a phone", () => {
  it("starts as a one-line chip that expands into the card and collapses again", () => {
    render(
      <HudNowPlaying room={room} current={current} djName="An" canControl playback={playback} canOpenSettings={false}
        onOpenQueue={noop} onOpenBoard={noop} onOpenSettings={noop} />,
    );
    const chip = screen.getByRole("button", { name: "Mở thẻ đang phát" }).parentElement!;
    const card = screen.getByRole("button", { name: "Thu gọn" }).closest(".w-72")!;
    expect(chip.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(card.className).toMatch(/hidden sm:flex/);
    fireEvent.click(screen.getByRole("button", { name: "Mở thẻ đang phát" }));
    expect(chip.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(card.className).not.toMatch(/hidden/);
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn" }));
    expect(card.className).toMatch(/hidden sm:flex/);
  });
  it("keeps the DJ's play/pause in the chip", () => {
    render(
      <HudNowPlaying room={room} current={current} djName="An" canControl playback={playback} canOpenSettings={false}
        onOpenQueue={noop} onOpenBoard={noop} onOpenSettings={noop} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Tạm dừng" })[0]);
    expect(playback.togglePlay).toHaveBeenCalledTimes(1);
  });
});

describe("MapCounts", () => {
  it("counts each map and lists the names on tap, classic members marked", () => {
    render(<MapCounts counts={{
      hall: [{ accountId: "a", name: "An", classic: true }, { accountId: "b", name: "Bình", classic: false }],
      pond: [{ accountId: "c", name: "Chi", classic: false }],
    }} />);
    const chip = screen.getByRole("button", { name: "🎵 Sảnh 2 · 🎣 Ao cá 1" });
    expect(screen.queryByText("🖥️ An")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText("🖥️ An")).toBeInTheDocument();
    expect(screen.getByText("Bình")).toBeInTheDocument();
    expect(screen.getByText("Chi")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/game-hud-travel.test.tsx`
Expected: FAIL — `Cannot find module '@/components/game/MapCounts'`.

- [ ] **Step 3: Create `components/game/MapCounts.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { MapMember } from "@/lib/presence-modes";
import type { MapId } from "@/lib/game/maps/types";

const MAPS: Array<{ id: MapId; icon: string; name: string }> = [
  { id: "hall", icon: "🎵", name: "Sảnh" },
  { id: "pond", icon: "🎣", name: "Ao cá" },
];

/** Top-centre chip: how many members are on each map; tap for the names (classic-view members marked 🖥️). */
export default function MapCounts({ counts }: { counts: Record<MapId, MapMember[]> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1 font-vt text-lg leading-none">
      <button type="button" className="pch-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {MAPS.map((m) => `${m.icon} ${m.name} ${counts[m.id].length}`).join(" · ")}
      </button>
      {open && (
        <div className="pch flex max-w-[calc(100vw-1rem)] flex-col gap-1.5 p-2 text-base">
          {MAPS.map((m) => (
            <div key={m.id}>
              <p className="text-lg">{m.icon} {m.name}</p>
              {counts[m.id].length === 0 ? (
                <p className="opacity-70">Chưa có ai</p>
              ) : (
                <ul>
                  {counts[m.id].map((p) => (
                    <li key={p.accountId} className="truncate">{p.classic ? "🖥️ " : ""}{p.name || "Khách"}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Replace `components/game/HudNowPlaying.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import type { PlaybackController } from "@/hooks/usePlayback";
import { formatClock } from "@/lib/format";
import { computeElapsedMs } from "@/lib/identity";
import type { QueueItem, Room } from "@/lib/supabase";

/** Top-right parchment card: what is playing, DJ transport (DJ only), volume, audio unlock, panel buttons.
 *  Under 640 px it collapses to a one-line chip (title, ▶/⏸ for the DJ, audio unlock) that expands on tap. */
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
  const [open, setOpen] = useState(false);
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

  const title = current?.title ?? "Chưa có bài nào";
  return (
    <>
      <div className={`${open ? "hidden" : "flex"} pch pointer-events-auto max-w-[calc(100vw-1rem)] items-center gap-1.5 p-1 font-vt text-lg leading-none sm:hidden`}>
        <button type="button" className="pch-btn min-w-0 max-w-52" onClick={() => setOpen(true)} aria-expanded={false} aria-label="Mở thẻ đang phát">
          <span className="block truncate">🎵 {title}</span>
        </button>
        {canControl && (
          <button type="button" className="pch-btn" onClick={playback.togglePlay} disabled={!current} aria-label={room.is_playing ? "Tạm dừng" : "Phát"}>
            {room.is_playing ? "⏸" : "▶"}
          </button>
        )}
        {!playback.unlocked && (
          <button type="button" className="pch-btn pch-btn-primary" onClick={playback.unlock} aria-label="Bật âm thanh">🔈</button>
        )}
      </div>
      <div className={`${open ? "flex" : "hidden sm:flex"} pch pointer-events-auto w-72 max-w-[calc(100vw-1rem)] flex-col gap-1.5 p-2 font-vt text-lg leading-none`}>
        <div className="flex items-start gap-1.5">
          <p className="min-w-0 flex-1 truncate text-xl" title={current?.title ?? undefined}>🎵 {title}</p>
          <button type="button" className="pch-btn sm:hidden" onClick={() => setOpen(false)} aria-expanded={true} aria-label="Thu gọn">▴</button>
        </div>
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
    </>
  );
}
```

- [ ] **Step 5: Replace `components/game/GameCanvas.tsx`**

```tsx
"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { GameEngine, type LocalFishing, type RosterEntry } from "@/lib/game/engine";
import { phaseCode } from "@/lib/game/fishing/cast";
import type { Rarity } from "@/lib/game/fishing/catalog";
import { getMap, paintMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { joinGameChannel } from "@/lib/game/net/channel";
import type { FishPhase, GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs } from "@/lib/game/net/replies";
import type { Facing, Look, Vec } from "@/lib/game/types";

export interface GameCanvasHandle {
  setRoster: (entries: RosterEntry[]) => void;
  setLocal: (info: { name: string; badges: string; look: Look }) => void;
  showBubble: (accountId: string, text: string) => void;
  showReaction: (accountId: string | null, emoji: string) => void;
  setInputEnabled: (enabled: boolean) => void;
  interact: () => void;
  /** Tell everyone my character changed (they re-fetch it). */
  announceLook: () => void;
  /** Height of the bottom HUD (CSS px): the camera may scroll that far past the map's bottom. */
  setBottomInset: (px: number) => void;
  /** Names and rarities for the catch labels. */
  setSpecies: (list: ReadonlyArray<{ id: string; name: string; rarity: Rarity }>) => void;
  /** Stand on a fishing spot, facing the water. */
  plant: (at: Vec, facing: Facing) => void;
  /** My rod's look; the others get an `fs` when the phase they see changes. */
  setFishing: (f: LocalFishing) => void;
  /** The fish in my hand; the others get an `fs` when it changes. */
  setHand: (speciesId: string | null) => void;
  /** I landed a fish: the label over my head, the new hand fish, rod in, and one `fs` with the catch. */
  landCatch: (speciesId: string, weightG: number, hand: string | null) => void;
  /** Is someone else fishing right at this spot? */
  anglerNear: (p: Vec) => boolean;
}

export interface GameCanvasProps {
  ref?: Ref<GameCanvasHandle | null>;
  roomId: string;
  localId: string;
  /** The map to show; a change (a portal) starts a new engine and channel there. */
  mapId: MapId;
  /** Where I appear on that map (null = its spawn). */
  arrive: Spot | null;
  /** Used when a world starts; later changes go through the handle's setLocal. */
  initial: { name: string; badges: string; look: Look };
  /** Is this account a current room member? Game messages from anyone else are dropped (spec §8.3). */
  isMember: (accountId: string) => boolean;
  onInteract: (it: Interactable) => void;
  onPromptChange: (it: Interactable | null) => void;
  onActorClick: (accountId: string) => void;
  onConnectionChange: (connected: boolean) => void;
  onLookChanged: (accountId: string) => void;
  /** While my rod is out: a tap/click/Space ("tap") or Esc ("cancel"). */
  onFishingInput: (kind: "tap" | "cancel") => void;
  /** A new world drew its first frame. */
  onFirstFrame: () => void;
  /** The browser has no usable 2D canvas. */
  onUnsupported: () => void;
  /** The game loop kept failing and stopped. */
  onFatal: () => void;
}

/** The game world: one engine + one broadcast channel per map visit. */
export default function GameCanvas({ ref, roomId, localId, mapId, arrive, ...rest }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const sendRef = useRef<((msg: GameMessage) => void) | null>(null);
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names and the HUD inset.
  const handRef = useRef<string | null>(null);
  const phaseRef = useRef<FishPhase>(0);
  const speciesRef = useRef<ReadonlyArray<{ id: string; name: string; rarity: Rarity }>>([]);
  const insetRef = useRef(0);
  useEffect(() => {
    propsRef.current = rest;
  });

  useImperativeHandle(ref, () => {
    const sendFs = (c?: [string, number]) => {
      const msg: GameMessage = c
        ? { t: "fs", id: localId, f: 0, h: handRef.current, c }
        : { t: "fs", id: localId, f: phaseRef.current, h: handRef.current };
      sendRef.current?.(msg);
    };
    return {
      setRoster: (entries) => engineRef.current?.setRoster(entries),
      setLocal: (info) => engineRef.current?.setLocal(info),
      showBubble: (id, text) => engineRef.current?.showBubble(id, text),
      showReaction: (id, emoji) => engineRef.current?.showReaction(id, emoji),
      setInputEnabled: (enabled) => engineRef.current?.setInputEnabled(enabled),
      interact: () => engineRef.current?.interact(),
      announceLook: () => sendRef.current?.({ t: "lk", id: localId }),
      setBottomInset: (px) => {
        insetRef.current = px;
        engineRef.current?.setBottomInset(px);
      },
      setSpecies: (list) => {
        speciesRef.current = list;
        engineRef.current?.setSpecies(list);
      },
      plant: (at, facing) => engineRef.current?.plant(at, facing),
      setFishing: (f) => {
        engineRef.current?.setLocalFishing(f);
        const code = phaseCode(f.phase);
        if (code === phaseRef.current) return;
        phaseRef.current = code;
        sendFs();
      },
      setHand: (speciesId) => {
        engineRef.current?.setLocalHand(speciesId);
        if (speciesId === handRef.current) return;
        handRef.current = speciesId;
        sendFs();
      },
      landCatch: (speciesId, weightG, hand) => {
        const e = engineRef.current;
        e?.setLocalFishing({ phase: "idle" });
        e?.setLocalHand(hand);
        e?.showLocalCatch(speciesId, weightG);
        phaseRef.current = 0;
        handRef.current = hand;
        sendFs([speciesId, weightG]);
      },
      anglerNear: (p) => engineRef.current?.anglerNear(p) ?? false,
    };
  }, [localId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const map = getMap(mapId);
    const init = propsRef.current.initial;
    // a new map starts with the rod in (the shell cancels any cast before travelling)
    phaseRef.current = 0;
    let engine: GameEngine;
    try {
      const art = paintMap(map);
      const fontVar = getComputedStyle(document.documentElement).getPropertyValue("--font-vt323").trim();
      engine = new GameEngine(canvas, map, art, {
        onLocalMove: (m) => channel.send({ t: "mv", id: localId, ...m }),
        onLocalPath: (m) => channel.send({ t: "pa", id: localId, ...m }),
        onInteract: (it) => propsRef.current.onInteract(it),
        onPromptChange: (it) => propsRef.current.onPromptChange(it),
        onActorClick: (id) => propsRef.current.onActorClick(id),
        onFishingInput: (kind) => propsRef.current.onFishingInput(kind),
        onFirstFrame: () => propsRef.current.onFirstFrame(),
        onFatal: () => propsRef.current.onFatal(),
      }, {
        localId,
        name: init.name,
        badges: init.badges,
        look: init.look,
        start: arrive ?? map.spawn,
        fontFamily: fontVar ? `${fontVar}, monospace` : "monospace",
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    } catch {
      propsRef.current.onUnsupported();
      return;
    }
    engine.setLocalHand(handRef.current);
    engine.setSpecies(speciesRef.current);
    engine.setBottomInset(insetRef.current);

    // One answer (my state) serves every `hello` that arrives before it goes out; answers are spread over a window
    // that grows with the world, because each one reaches every player.
    const replies = createReplyScheduler({
      send: () => channel.send(engine.snapshot()),
      windowMs: () => replyWindowMs(engine.walkers() + 1),
    });
    const channel = joinGameChannel(roomId, map, {
      onMessage: (msg) => {
        if (msg.id === localId) {
          // Another tab of my account left the world and everyone just dropped my character: tell them where I am.
          if (msg.t === "bye") channel.send(engine.snapshot());
          return;
        }
        if (!propsRef.current.isMember(msg.id)) return;
        switch (msg.t) {
          case "hello":
            engine.noteHello(msg.id);
            replies.onHello();
            break;
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
        if (!connected) return;
        // (Re)entering: ask for everyone's state and announce mine — after a reconnect I may have moved.
        channel.send({ t: "hello", id: localId });
        channel.send(engine.snapshot());
      },
    });

    engineRef.current = engine;
    sendRef.current = (msg) => channel.send(msg);
    engine.start();
    return () => {
      replies.dispose();
      sendRef.current = null;
      engineRef.current = null;
      channel.leave({ t: "bye", id: localId });
      engine.destroy();
    };
  }, [roomId, localId, mapId, arrive]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" aria-label="Thế giới game" />;
}
```

- [ ] **Step 6: Replace `components/game/GameShell.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { formatClock } from "@/lib/format";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { Look } from "@/lib/game/types";
import { mapCounts } from "@/lib/presence-modes";
import type { RoomDerived } from "@/lib/room-derived";
import { getCategoryLabel } from "@/lib/sponsorblock";
import CharacterEditor from "./CharacterEditor";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
import HudChatBar from "./HudChatBar";
import HudNowPlaying from "./HudNowPlaying";
import MapCounts from "./MapCounts";
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

/** A portal fades to dark in FADE_MS, the new map starts, and it fades back in after the map's first frame. */
const FADE_MS = 250;

/** Game mode: the room world (hall + pond) and the parchment HUD. Music, queue, chat and roles are the same as the
 *  classic view. */
export default function GameShell({ view, derived, playback, sponsorBlock, onExitGame }: GameShellProps) {
  const { state, role, presence, onlineIds, token, accountId, username, myMemberId, setPresenceMap } = view;
  const room = state.room!;
  const { members } = state;
  const { admin_member_id, dj_member_id } = room;
  const canvasRef = useRef<GameCanvasHandle | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<Interactable | null>(null);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => setPanel(null), []);

  // The game has its own parchment look: portals (RoomChartModal renders into <body>) get the palette too, and the app
  // theme is switched off while the shell is mounted — some theme rules use !important and would restyle the game UI.
  // A layout effect runs before the first paint, so no frame is drawn in the app theme.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const theme = html.getAttribute("data-theme");
    html.removeAttribute("data-theme");
    document.body.classList.add("game-ui");
    return () => {
      document.body.classList.remove("game-ui");
      if (theme !== null && !html.hasAttribute("data-theme")) html.setAttribute("data-theme", theme);
    };
  }, []);

  // --- where I am: game mode always starts in the hall; a portal fades out, switches the map, fades back in
  const [travel, setTravel] = useState<{ mapId: MapId; arrive: Spot | null }>({ mapId: "hall", arrive: null });
  const [fading, setFading] = useState(false);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const map = getMap(travel.mapId);
  useEffect(() => {
    setPresenceMap(travel.mapId);
  }, [travel.mapId, setPresenceMap]);
  useEffect(() => () => {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
  }, []);
  const travelTo = useCallback((to: { map: MapId; arrive: Spot }) => {
    if (fadeTimer.current) return;
    setFading(true);
    fadeTimer.current = setTimeout(() => {
      fadeTimer.current = null;
      setTravel({ mapId: to.map, arrive: to.arrive });
    }, FADE_MS);
  }, []);
  const onFirstFrame = useCallback(() => setFading(false), []);

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

  // --- everyone else on this map (room members only: presence keys and game messages from anyone else are ignored)
  const memberIds = useMemo(() => new Set(members.map((m) => m.account_id)), [members]);
  const { looks, refresh } = useLooks(presence.map((p) => p.accountId).filter((id) => id !== accountId && memberIds.has(id)));
  useEffect(() => {
    canvasRef.current?.setRoster(buildRoster({
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks,
      mapId: travel.mapId, seating: getMap(travel.mapId).seating,
    }));
  }, [presence, members, admin_member_id, dj_member_id, accountId, looks, travel]);
  const counts = useMemo(() => mapCounts(presence.filter((p) => memberIds.has(p.accountId))), [presence, memberIds]);

  // --- chat bubbles (this shell owns one useChat; the drawer has its own)
  const { messages, send } = useChat(room.id, token, { accountId, isAdmin: role.isAdmin });
  const shownRef = useRef(new Set<string>());
  useEffect(() => {
    for (const m of freshChatBubbles(messages, shownRef.current, Date.now())) {
      shownRef.current.add(m.id);
      if (m.account_id) canvasRef.current?.showBubble(m.account_id, parseChatMessageBody(m.body).text);
    }
  }, [messages]);

  // --- reactions float from the sender's character (from the top of the screen when they are on the other map)
  const { react } = useReactions(room.id, myName, {
    onEvent: (data) => canvasRef.current?.showReaction(data.accountId ?? null, data.emoji),
  });

  // --- input is off while any panel or the create editor is open
  const blocking = panel !== null || creating;
  useEffect(() => {
    canvasRef.current?.setInputEnabled(!blocking);
  }, [blocking]);

  // --- the camera may lift the character above the bottom HUD
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const apply = () => canvasRef.current?.setBottomInset(Math.ceil(el.getBoundingClientRect().height) + 8);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onInteract = useCallback((it: Interactable) => {
    switch (it.kind) {
      case "dj_booth":
        setPanel("queue");
        break;
      case "notice_board":
        setPanel("board");
        break;
      case "portal":
        if (it.to) travelTo(it.to);
        break;
      default:
        showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast]);

  const leaveBroken = useCallback((message: string) => {
    window.alert(message);
    onExitGame();
  }, [onExitGame]);
  const onUnsupported = useCallback(() => leaveBroken("Trình duyệt này không vẽ được thế giới game — quay về giao diện cũ."), [leaveBroken]);
  const onFatal = useCallback(() => leaveBroken("Thế giới game gặp lỗi — quay về giao diện cũ."), [leaveBroken]);
  const onFishingInput = useCallback(() => {}, []);

  const onSaved = useCallback((look: Look) => {
    setSaved(look);
    setPanel(null);
    canvasRef.current?.announceLook();
  }, [setSaved]);

  const djName = members.find((m) => m.account_id === derived.djAccountId)?.username ?? null;
  const skipped = sponsorBlock.lastSkippedToast;
  const cardMember = card ? members.find((m) => m.account_id === card) : undefined;
  const cardPresence = card ? presence.find((p) => p.accountId === card) : undefined;
  const cardWhere = cardPresence?.mode === "classic" ? "🖥️ Đang ở giao diện cũ"
    : cardPresence?.map === "pond" ? "🎣 Đang ở ao câu cá" : "🎮 Đang dạo quanh sảnh";

  return (
    <div className={`game-ui fixed inset-0 overflow-hidden text-ink ${map.id === "pond" ? "bg-[#5a8f32]" : "bg-[#2f6e8f]"}`}>
      <GameCanvas
        ref={canvasRef}
        roomId={room.id}
        localId={accountId}
        mapId={travel.mapId}
        arrive={travel.arrive}
        initial={{ name: myName, badges: myBadges, look: myLook }}
        isMember={(id) => memberIds.has(id)}
        onInteract={onInteract}
        onPromptChange={setPrompt}
        onActorClick={setCard}
        onConnectionChange={setConnected}
        onLookChanged={refresh}
        onFishingInput={onFishingInput}
        onFirstFrame={onFirstFrame}
        onUnsupported={onUnsupported}
        onFatal={onFatal}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 z-40 bg-black transition-opacity duration-200 motion-reduce:transition-none ${fading ? "opacity-100" : "opacity-0"}`}
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
        <MapCounts counts={counts} />
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

      <div className="pointer-events-none absolute left-1/2 top-1/3 z-20 flex -translate-x-1/2 flex-col items-center gap-2" role="status">
        {toast && <p className="pch px-3 py-1.5 font-vt text-xl">{toast}</p>}
        {skipped && (
          <p className="pch px-3 py-1 font-vt text-lg">
            ⚡ Đã bỏ qua: {getCategoryLabel(skipped.category)} ({formatClock(skipped.start * 1000)} - {formatClock(skipped.end * 1000)})
          </p>
        )}
      </div>

      {card && (
        <div className="pch absolute left-1/2 top-1/4 z-20 flex -translate-x-1/2 items-center gap-2 p-2 font-vt text-lg leading-tight">
          <SpritePreview look={looks.get(card) ?? DEFAULT_LOOK} scale={2} className="rounded-sm bg-parchment" />
          <div className="flex flex-col">
            <span className="text-xl">{cardMember?.username ?? cardPresence?.name ?? "Khách"}</span>
            {card === roles.adminAccountId && <span>👑 Chủ phòng</span>}
            {card === roles.djAccountId && <span>🎧 DJ</span>}
            <span className="opacity-80">{cardWhere}</span>
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
          {prompt.prompt}
        </button>
      )}

      <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
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

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm vitest run` → all green.
Run: `npx tsc --noEmit` and `npx eslint components/game tests/unit/game-hud-travel.test.tsx` → clean.

- [ ] **Step 8: Check travel in the browser (the owner logs in)**

Start the dev server with `preview_start` (`name: "dev"`). The owner signs in and opens a room in game mode — never type a password yourself. Walk to the hall's dock sign and press E: the screen fades out and in, you stand at the pond's entrance facing up, the chip reads "🎵 Sảnh 0 · 🎣 Ao cá 1", cô Ba and chú Tư stand behind their counters with blue name tags, the lilies bob, and the south edge scrolls above the chat bar. Walk to "Bến vào" and press E: you are back on the hall's dock facing up. Resize to a phone width (`resize_window` preset `mobile`, then back to `desktop`): the now-playing card is a chip that expands and folds. Pond interactables answer "Sắp mở — chờ chút nhé!" for now. If nobody can log in right now, note it in the report and move on — Task 18 repeats the full manual pass.

- [ ] **Step 9: Commit**

```bash
git add components/game/GameCanvas.tsx components/game/GameShell.tsx components/game/HudNowPlaying.tsx components/game/MapCounts.tsx tests/unit/game-hud-travel.test.tsx
git commit -m "feat(v14): travel between the hall and the pond with a fade; map counts; phone now-playing chip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Fishing state in the game — coins, bait, daily check-in, song bonus, digging worms

**Files:**
- Create: `lib/game/fishing/messages.ts`, `hooks/useFishing.ts`, `hooks/useFishingController.ts`, `components/game/fishing/FishingHud.tsx`
- Modify: `lib/game/engine.ts` (dust puff), `components/game/GameCanvas.tsx` (`puff` on the handle), `components/game/GameShell.tsx`
- Test: `tests/unit/fishing-messages.test.ts`, `tests/unit/use-fishing.test.tsx`

**Interfaces:**
- Consumes: the RPC wrappers and `fishingErrorMessage` (Task 4); state helpers (`castWaitMin`, `digWaitSec`, `baitTotal`, `handFish`); `GameCanvasHandle` (Task 13).
- Produces:
  - `messages.ts` (pure): `SPOT_TAKEN`, `NOT_LOADED`, `LOADING`, `BAIT_FULL`, `SONG_BONUS`, `dailyText(amount)`, `digText(gained)`, `digWaitText(sec)`, `saleText(sold, earned)`, `blockerText(blocker, waitMin)`, `promptText(it, state, now)` ("Đào trùn (còn N giây)", "Nghỉ tay — còn N phút").
  - `useFishing(token, onError): FishingData { state; failed; catalog; reload(); claimDaily(); dig(); buy(itemId, qty); equip(loadout); sell(ids); release(id); startCast(roomId); finishCast(castId, success) }` — each answer's state replaces ours (an answer overtaken by a newer call is dropped); on error: `onError(text)` + refetch; a network failure in `finishCast` reads "Mất kết nối — cá đã thoát.".
  - `useFishingController({ token, roomId, accountId, canvas: () => GameCanvasHandle | null, current, toast }): FishingController { data; panel; openPanel; closePanel; interact(it): boolean; promptText(it) }` with type `FishingPanel = "bag" | "depot" | "shop" | "records"`. It claims the daily bonus on mount (toast only when paid), gives the canvas the species names and my hand fish, toasts the song bonus (1.5 s after my song stops being current, if the coins rose by ≥ 10), and digs (`dig_spot`: cooldown/full checks, a 1 s dust puff, then `dig_worms`).
  - `FishingHud({ state, failed, onReload })`: "🪙 1.230 xu", "🪱 12/20 · 🐟 2/6", "🔄 Tải lại giỏ đồ" when the state failed.
  - `GameEngine.puff(at)`, `GameCanvasHandle.puff(at)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/fishing-messages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { blockerText, dailyText, digText, digWaitText, promptText, saleText } from "@/lib/game/fishing/messages";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";

const S = parseFishingState({ coins: 10, casts_left: 5, window_resets_at: "2026-09-24T11:00:00Z", dig_ready_at: null })!;
const withS = (over: Partial<FishingState>): FishingState => ({ ...S, ...over });
const it_ = (kind: Interactable["kind"], prompt: string): Interactable =>
  ({ id: "x", kind, label: "x", prompt, rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 0, y: 0 } });
const NOW = Date.parse("2026-09-24T10:30:00Z");

describe("fishing texts", () => {
  it("words the toasts", () => {
    expect(dailyText(20)).toBe("🪙 Điểm danh hôm nay: +20 xu");
    expect(digText(3)).toBe("🪱 Đào được 3 trùn đất!");
    expect(digWaitText(32)).toBe("Đất còn cứng, chờ 32 giây nữa nhé.");
    expect(saleText(3, 1245)).toBe("Bán 3 con · +1.245 xu");
  });
  it("says why a cast cannot start, like the server does", () => {
    expect(blockerText("no_bait", 0)).toBe("Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.");
    expect(blockerText("hands_full", 0)).toBe("Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!");
    expect(blockerText("bucket_full", 0)).toBe("Xô đầy rồi — ra vựa bán bớt nhé!");
    expect(blockerText("cast_limit", 25)).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 25 phút).");
    expect(blockerText("cast_limit", 0)).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 1 phút).");
  });
});

describe("promptText", () => {
  it("counts down the dig cooldown on dig spots", () => {
    const dig = it_("dig_spot", "Đào trùn");
    expect(promptText(dig, S, NOW)).toBe("Đào trùn");
    expect(promptText(dig, withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), NOW)).toBe("Đào trùn (còn 13 giây)");
    expect(promptText(dig, withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), null)).toBe("Đào trùn");
  });
  it("tells a capped angler how long to rest", () => {
    const spot = it_("fish_spot", "Quăng cần");
    expect(promptText(spot, S, NOW)).toBe("Quăng cần");
    expect(promptText(spot, withS({ castsLeft: 0 }), NOW)).toBe("Nghỉ tay — còn 30 phút");
  });
  it("leaves other prompts and an unknown state alone", () => {
    expect(promptText(it_("depot", "Bán cá · cô Ba"), S, NOW)).toBe("Bán cá · cô Ba");
    expect(promptText(it_("dig_spot", "Đào trùn"), null, NOW)).toBe("Đào trùn");
  });
});
```

Create `tests/unit/use-fishing.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
import type { QueueItem } from "@/lib/supabase";

const rpc = vi.hoisted(() => ({
  fetchFishingState: vi.fn(), fetchFishingCatalog: vi.fn(), claimDaily: vi.fn(), digWorms: vi.fn(), buyItem: vi.fn(),
  setLoadout: vi.fn(), sellFish: vi.fn(), releaseFish: vi.fn(), startCast: vi.fn(), finishCast: vi.fn(),
}));
vi.mock("@/lib/game/fishing/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/fishing/rpc")>()),
  ...rpc,
}));

import { useFishing } from "@/hooks/useFishing";
import { useFishingController } from "@/hooks/useFishingController";

const state = (over: Record<string, unknown> = {}): FishingState => parseFishingState({ coins: 50, bait: { bait_worm: 3 }, ...over })!;
const CATALOG = { species: [{ id: "ca_ro", name: "Cá rô đồng", rarity: 1, minG: 50, maxG: 300, pricePerKg: 45, difficulty: 15, sortOrder: 10 }], items: [] };
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const song = (id: string, by: string | null): QueueItem => ({
  id, room_id: "r", youtube_video_id: "v", title: "t", thumbnail_url: null, duration_seconds: 120,
  added_by_account_id: by, added_by_name: "x", position: 0, created_at: "", status: "approved",
});

beforeEach(() => {
  vi.useFakeTimers();
  for (const f of Object.values(rpc)) f.mockReset();
  rpc.fetchFishingState.mockResolvedValue(state());
  rpc.fetchFishingCatalog.mockResolvedValue(CATALOG);
  rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: state() });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFishing", () => {
  it("loads the state and the catalog", async () => {
    const { result } = renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state?.coins).toBe(50);
    expect(result.current.catalog?.species[0].id).toBe("ca_ro");
    expect(result.current.failed).toBe(false);
  });

  it("marks a failed load so the HUD can offer a reload", async () => {
    rpc.fetchFishingState.mockRejectedValue(new Error("down"));
    const { result } = renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.state).toBeNull();
    expect(result.current.failed).toBe(true);
    rpc.fetchFishingState.mockResolvedValue(state({ coins: 7 }));
    await act(async () => { await result.current.reload(); });
    expect(result.current).toMatchObject({ failed: false, state: { coins: 7 } });
  });

  it("replaces the state with each answer, and on an error toasts and fetches again", async () => {
    const errors: string[] = [];
    const { result } = renderHook(() => useFishing("tok", (t) => errors.push(t)));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rpc.buyItem.mockResolvedValue(state({ coins: 45, bait: { bait_worm: 3, bait_shrimp: 1 } }));
    await act(async () => { expect(await result.current.buy("bait_shrimp", 1)).toBe(true); });
    expect(result.current.state?.coins).toBe(45);
    rpc.buyItem.mockRejectedValue({ message: "not enough coins" });
    rpc.fetchFishingState.mockResolvedValue(state({ coins: 44 }));
    await act(async () => { expect(await result.current.buy("rod_carbon", 1)).toBe(false); });
    await flush();
    expect(errors).toEqual(["Không đủ xu."]);
    expect(result.current.state?.coins).toBe(44);
  });

  it("says the fish got away when finish_cast fails on the network", async () => {
    const errors: string[] = [];
    const { result } = renderHook(() => useFishing("tok", (t) => errors.push(t)));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rpc.finishCast.mockRejectedValue(new TypeError("Failed to fetch"));
    await act(async () => { expect(await result.current.finishCast("c1", true)).toBeNull(); });
    expect(errors).toEqual(["Mất kết nối — cá đã thoát."]);
  });

  it("ignores an answer that was overtaken by a newer one", async () => {
    const { result } = renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    let slow!: (s: FishingState) => void;
    rpc.fetchFishingState.mockReturnValue(new Promise<FishingState>((r) => { slow = r; }));
    rpc.releaseFish.mockResolvedValue(state({ coins: 99 }));
    let reloading!: Promise<unknown>;
    act(() => { reloading = result.current.reload(); });
    await act(async () => { await result.current.release("f1"); });
    await act(async () => { slow(state({ coins: 1 })); await reloading; });
    expect(result.current.state?.coins).toBe(99);
  });
});

describe("useFishingController", () => {
  const canvas = { setSpecies: vi.fn(), setHand: vi.fn(), puff: vi.fn() } as unknown as GameCanvasHandle;
  const setup = (current: QueueItem | null = null) => {
    const toasts: string[] = [];
    const hook = renderHook((p: { current: QueueItem | null }) => useFishingController({
      token: "tok", roomId: "r", accountId: "me", canvas: () => canvas, current: p.current, toast: (t) => toasts.push(t),
    }), { initialProps: { current } });
    return { ...hook, toasts };
  };

  it("claims the daily bonus once and toasts only when it paid", async () => {
    rpc.claimDaily.mockResolvedValue({ claimed: true, amount: 20, state: state({ coins: 70 }) });
    const { toasts } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.claimDaily).toHaveBeenCalledTimes(1);
    expect(toasts).toEqual(["🪙 Điểm danh hôm nay: +20 xu"]);
  });

  it("hands the species names and my hand fish to the canvas", async () => {
    rpc.fetchFishingState.mockResolvedValue(state({ fish: [{ id: "f1", species_id: "ca_ro", weight_g: 120, price: 5, caught_at: "x" }] }));
    rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: state({ fish: [{ id: "f1", species_id: "ca_ro", weight_g: 120, price: 5, caught_at: "x" }] }) });
    setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(canvas.setSpecies).toHaveBeenCalledWith([{ id: "ca_ro", name: "Cá rô đồng", rarity: 1 }]);
    expect(canvas.setHand).toHaveBeenLastCalledWith("ca_ro");
  });

  it("toasts the song bonus when my song stopped playing and the coins went up by 10", async () => {
    const { rerender, toasts } = setup(song("s1", "me"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    rpc.fetchFishingState.mockResolvedValue(state({ coins: 60 }));
    rerender({ current: song("s2", "other") });
    await act(async () => { await vi.advanceTimersByTimeAsync(1499); });
    expect(toasts).toEqual([]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(toasts).toEqual(["🎵 Bài bạn gọi đã phát xong: +10 xu"]);
    // someone else's song ending checks nothing
    rpc.fetchFishingState.mockClear();
    rerender({ current: song("s3", "other") });
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(rpc.fetchFishingState).not.toHaveBeenCalled();
  });

  it("digs after a second of dust, and refuses during the cooldown or with a full bait box", async () => {
    rpc.digWorms.mockResolvedValue({ gained: 2, state: state({ bait: { bait_worm: 5 }, dig_ready_at: "2099-01-01T00:00:00Z" }) });
    const { result, toasts } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const mound = { id: "dig_1", kind: "dig_spot" as const, label: "x", prompt: "Đào trùn", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 56, y: 184 } };
    act(() => { expect(result.current.interact(mound)).toBe(true); });
    expect(canvas.puff).toHaveBeenCalledWith({ x: 56, y: 172 });
    expect(rpc.digWorms).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(toasts).toEqual(["🪱 Đào được 2 trùn đất!"]);
    act(() => { result.current.interact(mound); });
    expect(toasts.at(-1)).toMatch(/^Đất còn cứng, chờ \d+ giây nữa nhé\.$/);
    expect(result.current.interact({ ...mound, kind: "portal" })).toBe(false);
  });

  it("does not dig into a full bait box", async () => {
    rpc.fetchFishingState.mockResolvedValue(state({ bait: { bait_worm: 20 } }));
    rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: state({ bait: { bait_worm: 20 } }) });
    const { result, toasts } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    act(() => { result.current.interact({ id: "dig_1", kind: "dig_spot", label: "x", prompt: "Đào trùn", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 56, y: 184 } }); });
    expect(toasts).toEqual(["Hộp mồi đầy rồi."]);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(rpc.digWorms).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/fishing-messages.test.ts tests/unit/use-fishing.test.tsx`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Create `lib/game/fishing/messages.ts`**

```ts
import type { Interactable } from "@/lib/game/maps/types";
import { formatXu } from "./catalog";
import { castWaitMin, digWaitSec, type CastBlocker, type FishingState } from "./state";

// The fishing HUD's Vietnamese texts (spec §6, §10.1, §13). Pure.

export const SPOT_TAKEN = "Chỗ này có người câu rồi.";
export const NOT_LOADED = "Chưa tải được giỏ đồ — bấm “Tải lại giỏ đồ” nhé.";
export const LOADING = "Đang tải giỏ đồ…";
export const BAIT_FULL = "Hộp mồi đầy rồi.";
export const SONG_BONUS = "🎵 Bài bạn gọi đã phát xong: +10 xu";

export function dailyText(amount: number): string {
  return `🪙 Điểm danh hôm nay: +${amount} xu`;
}

export function digText(gained: number): string {
  return `🪱 Đào được ${gained} trùn đất!`;
}

export function digWaitText(sec: number): string {
  return `Đất còn cứng, chờ ${sec} giây nữa nhé.`;
}

export function saleText(sold: number, earned: number): string {
  return `Bán ${sold} con · +${formatXu(earned)}`;
}

/** Why a cast cannot start (same wording as the server errors, spec §8.6). */
export function blockerText(b: CastBlocker, waitMin: number): string {
  switch (b) {
    case "no_bait": return "Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.";
    case "hands_full": return "Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!";
    case "bucket_full": return "Xô đầy rồi — ra vựa bán bớt nhé!";
    case "cast_limit": return `Câu nhiều quá rồi, nghỉ tay chút nhé (còn ${Math.max(1, waitMin)} phút).`;
  }
}

/** The HUD prompt for an interactable: a dig spot counts down its cooldown, a fishing spot the hourly cap. */
export function promptText(it: Interactable, s: FishingState | null, now: number | null): string {
  if (!s || now === null) return it.prompt;
  if (it.kind === "dig_spot") {
    const sec = digWaitSec(s, now);
    return sec > 0 ? `${it.prompt} (còn ${sec} giây)` : it.prompt;
  }
  if (it.kind === "fish_spot") {
    const min = castWaitMin(s, now);
    return min > 0 ? `Nghỉ tay — còn ${min} phút` : it.prompt;
  }
  return it.prompt;
}
```

- [ ] **Step 4: Create `hooks/useFishing.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
import {
  buyItem, claimDaily, digWorms, fetchFishingCatalog, fetchFishingState, finishCast, fishingErrorMessage, releaseFish,
  sellFish, setLoadout, startCast, type FinishCast, type StartCast,
} from "@/lib/game/fishing/rpc";
import type { FishingState, Loadout } from "@/lib/game/fishing/state";

export interface FishingData {
  /** null until the first fishing_state answer. */
  state: FishingState | null;
  /** fishing_state failed: the HUD shows "—" and offers "Tải lại giỏ đồ". */
  failed: boolean;
  catalog: FishingCatalog | null;
  reload: () => Promise<FishingState | null>;
  claimDaily: () => Promise<{ claimed: boolean; amount: number } | null>;
  dig: () => Promise<{ gained: number } | null>;
  buy: (itemId: string, qty: number) => Promise<boolean>;
  equip: (loadout: Loadout) => Promise<boolean>;
  sell: (ids: string[]) => Promise<{ sold: number; earned: number } | null>;
  release: (id: string) => Promise<boolean>;
  startCast: (roomId: string) => Promise<StartCast | null>;
  finishCast: (castId: string, success: boolean) => Promise<FinishCast | null>;
}

/** A network failure while a cast ends: the fish is gone either way. */
const lostConnection = (err: unknown) => {
  const text = fishingErrorMessage(err);
  return text === "Có lỗi, thử lại nhé." ? "Mất kết nối — cá đã thoát." : text;
};

/** The account's fishing state (spec §8.2) and the RPCs that change it. Every answer carries the full state, which
 *  replaces ours; after an error the toast shows the Vietnamese text and the state is fetched again (§8.6). */
export function useFishing(token: string, onError: (text: string) => void): FishingData {
  const [state, setState] = useState<FishingState | null>(null);
  const [failed, setFailed] = useState(false);
  const [catalog, setCatalog] = useState<FishingCatalog | null>(null);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  // Answers can overtake each other: only an answer to a call started after the last applied one may replace the state.
  const seq = useRef(0);
  const applied = useRef(0);
  const apply = useCallback((n: number, s: FishingState) => {
    if (n < applied.current) return;
    applied.current = n;
    setState(s);
    setFailed(false);
  }, []);

  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const s = await fetchFishingState(token);
      apply(n, s);
      return s;
    } catch {
      if (n >= applied.current) setFailed(true);
      return null;
    }
  }, [token, apply]);

  useEffect(() => {
    let active = true;
    const first = setTimeout(() => void reload(), 0);
    fetchFishingCatalog().then((c) => {
      if (active) setCatalog(c);
    }).catch(() => {});
    return () => {
      active = false;
      clearTimeout(first);
    };
  }, [reload]);

  /** Run an RPC; its state replaces ours. On error: toast, refetch, null. */
  const act = useCallback(async <T,>(call: () => Promise<T>, stateOf: (r: T) => FishingState, errorText = fishingErrorMessage): Promise<T | null> => {
    const n = ++seq.current;
    try {
      const r = await call();
      apply(n, stateOf(r));
      return r;
    } catch (err) {
      onErrorRef.current(errorText(err));
      void reload();
      return null;
    }
  }, [apply, reload]);

  return {
    state, failed, catalog, reload,
    claimDaily: useCallback(async () => {
      const r = await act(() => claimDaily(token), (x) => x.state);
      return r && { claimed: r.claimed, amount: r.amount };
    }, [act, token]),
    dig: useCallback(async () => {
      const r = await act(() => digWorms(token), (x) => x.state);
      return r && { gained: r.gained };
    }, [act, token]),
    buy: useCallback(async (itemId: string, qty: number) => (await act(() => buyItem(token, itemId, qty), (s) => s)) !== null, [act, token]),
    equip: useCallback(async (l: Loadout) => (await act(() => setLoadout(token, l), (s) => s)) !== null, [act, token]),
    sell: useCallback(async (ids: string[]) => {
      const r = await act(() => sellFish(token, ids), (x) => x.state);
      return r && { sold: r.sold, earned: r.earned };
    }, [act, token]),
    release: useCallback(async (id: string) => (await act(() => releaseFish(token, id), (s) => s)) !== null, [act, token]),
    startCast: useCallback((roomId: string) => act(() => startCast(roomId, token), (x) => x.state), [act, token]),
    finishCast: useCallback((castId: string, success: boolean) => act(() => finishCast(token, castId, success), (x) => x.state, lostConnection), [act, token]),
  };
}
```

- [ ] **Step 5: The dust puff in the engine and on the canvas handle**

**lib/game/engine.ts — edit 1 of 5.** Replace:

```ts
const MAX_FAILED_FRAMES = 3;
const NO_KEYS: KeyState = { up: false, down: false, left: false, right: false };
```

with:

```ts
const MAX_FAILED_FRAMES = 3;
const PUFF_MS = 1000;
const NO_KEYS: KeyState = { up: false, down: false, left: false, right: false };
```

**lib/game/engine.ts — edit 2 of 5.** Replace:

```ts
  private landed: { speciesId: string; weightG: number; until: number } | null = null;
  private species = new Map<string, SpeciesInfo>();
```

with:

```ts
  private landed: { speciesId: string; weightG: number; until: number } | null = null;
  private puffs: Array<{ x: number; y: number; born: number }> = [];
  private species = new Map<string, SpeciesInfo>();
```

**lib/game/engine.ts — edit 3 of 5.** Replace:

```ts
    this.landed = { speciesId, weightG, until: performance.now() + CATCH_LABEL_MS };
  }
```

with:

```ts
    this.landed = { speciesId, weightG, until: performance.now() + CATCH_LABEL_MS };
  }

  /** A dust puff at `at` for a second (digging worms — only I see it). */
  puff(at: Vec): void {
    this.puffs.push({ x: at.x, y: at.y, born: performance.now() });
  }
```

**lib/game/engine.ts — edit 4 of 5.** Replace:

```ts
    if (this.landed && this.landed.until < now) this.landed = null;
  }
```

with:

```ts
    if (this.landed && this.landed.until < now) this.landed = null;
    if (this.puffs.length > 0) this.puffs = this.puffs.filter((p) => now - p.born < PUFF_MS);
  }
```

**lib/game/engine.ts — edit 5 of 5.** Replace:

```ts
    for (const it of items) it.draw();
    this.art.drawOverhead(b, t, camX, camY, reduced);
```

with:

```ts
    for (const it of items) it.draw();
    for (const p of this.puffs) {
      const age = Math.min(1, (t - p.born) / PUFF_MS);
      const r = reduced ? 4 : 2 + age * 6;
      b.globalAlpha = 1 - age;
      b.fillStyle = "#b58a52";
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        b.fillRect(Math.round(p.x + Math.cos(a) * r) - camX, Math.round(p.y - 2 + Math.sin(a) * r * 0.5) - camY, 2, 2);
      }
      b.globalAlpha = 1;
    }
    this.art.drawOverhead(b, t, camX, camY, reduced);
```

**components/game/GameCanvas.tsx — edit 1 of 2.** Replace:

```tsx
  anglerNear: (p: Vec) => boolean;
}
```

with:

```tsx
  anglerNear: (p: Vec) => boolean;
  /** A dust puff (digging worms). */
  puff: (at: Vec) => void;
}
```

**components/game/GameCanvas.tsx — edit 2 of 2.** Replace:

```tsx
      anglerNear: (p) => engineRef.current?.anglerNear(p) ?? false,
    };
```

with:

```tsx
      anglerNear: (p) => engineRef.current?.anglerNear(p) ?? false,
      puff: (at) => engineRef.current?.puff(at),
    };
```

- [ ] **Step 6: Create `hooks/useFishingController.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useFishing, type FishingData } from "@/hooks/useFishing";
import {
  BAIT_FULL, dailyText, digText, digWaitText, LOADING, NOT_LOADED, promptText as promptFor, SONG_BONUS,
} from "@/lib/game/fishing/messages";
import { baitTotal, castWaitMin, digWaitSec, handFish } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";
import type { QueueItem } from "@/lib/supabase";

export type FishingPanel = "bag" | "depot" | "shop" | "records";

export interface FishingController {
  data: FishingData;
  panel: FishingPanel | null;
  openPanel: (p: FishingPanel) => void;
  closePanel: () => void;
  /** Handles the pond's interactables; false for anything else. */
  interact: (it: Interactable) => boolean;
  /** The HUD prompt: dig spots and fishing spots show their wait. */
  promptText: (it: Interactable) => string;
}

export interface FishingControllerOptions {
  token: string;
  roomId: string;
  accountId: string;
  /** The game canvas (null while there is none). */
  canvas: () => GameCanvasHandle | null;
  /** The room's current queue item (the song bonus is checked when it changes). */
  current: QueueItem | null;
  toast: (text: string) => void;
}

/** The worm dig's dust puff, before dig_worms is called. */
const DIG_MS = 1000;
/** After a song I queued stops being current, the bonus trigger has run: look at the coins after this. */
const SONG_BONUS_DELAY_MS = 1500;

/** Everything fishing for the game shell (spec §6, §10): the state, the daily check-in, the song bonus, digging,
 *  the HUD prompts and which fishing panel is open. */
export function useFishingController({ token, accountId, canvas, current, toast }: FishingControllerOptions): FishingController {
  const data = useFishing(token, toast);
  const { state, failed, catalog, reload, claimDaily, dig } = data;
  const [panel, setPanel] = useState<FishingPanel | null>(null);
  const stateRef = useRef(state);
  const failedRef = useRef(failed);
  const toastRef = useRef(toast);
  useEffect(() => {
    stateRef.current = state;
    failedRef.current = failed;
    toastRef.current = toast;
  });
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const live = timers.current;
    return () => {
      for (const t of live) clearTimeout(t);
      live.clear();
    };
  }, []);
  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      fn();
    }, ms);
    timers.current.add(t);
  }, []);

  // --- the daily check-in: once per visit; the toast only when it paid
  useEffect(() => {
    void claimDaily().then((r) => {
      if (r?.claimed) toastRef.current(dailyText(r.amount));
    });
  }, [claimDaily]);

  // --- names for the catch labels, and the fish in my hand for everyone to see
  useEffect(() => {
    if (catalog) canvas()?.setSpecies(catalog.species.map((s) => ({ id: s.id, name: s.name, rarity: s.rarity })));
  }, [catalog, canvas]);
  const hand = state ? handFish(state)?.speciesId ?? null : null;
  useEffect(() => {
    canvas()?.setHand(hand);
  }, [hand, canvas]);

  // --- the song bonus (spec §10.1): the song I queued stopped being current → did the coins go up by 10?
  const prevItem = useRef<{ id: string; mine: boolean } | null>(null);
  const currentId = current?.id ?? null;
  const currentMine = !!current && current.added_by_account_id === accountId;
  useEffect(() => {
    const prev = prevItem.current;
    prevItem.current = currentId ? { id: currentId, mine: currentMine } : null;
    if (!prev || prev.id === currentId || !prev.mine) return;
    const before = stateRef.current?.coins ?? null;
    later(() => {
      void reload().then((s) => {
        if (s && before !== null && s.coins - before >= 10) toastRef.current(SONG_BONUS);
      });
    }, SONG_BONUS_DELAY_MS);
  }, [currentId, currentMine, reload, later]);

  // --- a clock for the prompts while a cooldown or the hourly cap runs
  const [now, setNow] = useState<number | null>(null);
  const digRunning = !!state?.digReadyAt && (now === null || Date.parse(state.digReadyAt) > now);
  const capRunning = !!state && castWaitMin(state, now ?? 0) > 0;
  const ticking = digRunning || capRunning;
  useEffect(() => {
    if (!ticking) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ticking]);
  const promptText = useCallback((it: Interactable) => promptFor(it, state, now), [state, now]);

  // --- digging worms: a second of dust, then dig_worms
  const digging = useRef(false);
  const digAt = useCallback((it: Interactable) => {
    const s = stateRef.current;
    if (!s) {
      toastRef.current(failedRef.current ? NOT_LOADED : LOADING);
      return;
    }
    const wait = digWaitSec(s, Date.now());
    if (wait > 0) {
      toastRef.current(digWaitText(wait));
      return;
    }
    if (baitTotal(s) >= s.baitCap) {
      toastRef.current(BAIT_FULL);
      return;
    }
    if (digging.current) return;
    digging.current = true;
    canvas()?.puff({ x: it.use.x, y: it.use.y - 12 });
    later(() => {
      void dig().then((r) => {
        digging.current = false;
        if (r) toastRef.current(digText(r.gained));
      });
    }, DIG_MS);
  }, [canvas, dig, later]);

  const interact = useCallback((it: Interactable): boolean => {
    switch (it.kind) {
      case "dig_spot":
        digAt(it);
        return true;
      default:
        return false;
    }
  }, [digAt]);

  return {
    data,
    panel,
    openPanel: setPanel,
    closePanel: useCallback(() => setPanel(null), []),
    interact,
    promptText,
  };
}
```

- [ ] **Step 7: Create `components/game/fishing/FishingHud.tsx`**

```tsx
"use client";

import { formatXu } from "@/lib/game/fishing/catalog";
import { baitTotal, type FishingState } from "@/lib/game/fishing/state";

/** The player card's fishing line: coins, bait and fish (spec §10.1); a reload button when the state failed (§13). */
export default function FishingHud({ state, failed, onReload }: {
  state: FishingState | null;
  failed: boolean;
  onReload: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 text-base leading-none">
      <span className="text-lg">🪙 {state ? formatXu(state.coins) : "—"}</span>
      {state && (
        <span title="Mồi · Cá">🪱 {baitTotal(state)}/{state.baitCap} · 🐟 {state.fish.length}/{state.fishCap}</span>
      )}
      {failed && (
        <button type="button" className="pch-btn self-start" onClick={onReload}>🔄 Tải lại giỏ đồ</button>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Use the controller in `GameShell`**

**components/game/GameShell.tsx — edit 1 of 8.** Replace:

```tsx
import { useChat } from "@/hooks/useChat";
import { useLooks } from "@/hooks/useLooks";
```

with:

```tsx
import { useChat } from "@/hooks/useChat";
import { useFishingController } from "@/hooks/useFishingController";
import { useLooks } from "@/hooks/useLooks";
```

**components/game/GameShell.tsx — edit 2 of 8.** Replace:

```tsx
import CharacterEditor from "./CharacterEditor";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
```

with:

```tsx
import CharacterEditor from "./CharacterEditor";
import FishingHud from "./fishing/FishingHud";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
```

**components/game/GameShell.tsx — edit 3 of 8.** Replace:

```tsx
  const close = useCallback(() => setPanel(null), []);
```

with:

```tsx
  const close = useCallback(() => setPanel(null), []);
  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
```

**components/game/GameShell.tsx — edit 4 of 8.** Replace:

```tsx

  // --- the camera may lift the character above the bottom HUD
```

with:

```tsx

  // --- fishing: coins, bait, the daily check-in, the song bonus, digging (and, later, casting and the shops)
  const getCanvas = useCallback(() => canvasRef.current, []);
  const fishing = useFishingController({ token, roomId: room.id, accountId, canvas: getCanvas, current: derived.current, toast: showToast });
  const { interact: fishingInteract, promptText } = fishing;

  // --- the camera may lift the character above the bottom HUD
```

**components/game/GameShell.tsx — edit 5 of 8.** Replace:

```tsx
    return () => ro.disconnect();
  }, []);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);
```

with:

```tsx
    return () => ro.disconnect();
  }, []);
```

**components/game/GameShell.tsx — edit 6 of 8.** Replace:

```tsx
      default:
        showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast]);
```

with:

```tsx
      default:
        if (!fishingInteract(it)) showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast, fishingInteract]);
```

**components/game/GameShell.tsx — edit 7 of 8.** Replace:

```tsx
            </button>
          </div>
```

with:

```tsx
            </button>
            <FishingHud state={fishing.data.state} failed={fishing.data.failed} onReload={() => void fishing.data.reload()} />
          </div>
```

**components/game/GameShell.tsx — edit 8 of 8.** Replace:

```tsx
          <span className="pointer-coarse:hidden">E · </span>
          {prompt.prompt}
        </button>
```

with:

```tsx
          <span className="pointer-coarse:hidden">E · </span>
          {promptText(prompt)}
        </button>
```

- [ ] **Step 9: Run the tests, typecheck and lint**

Run: `pnpm vitest run` → all green.
Run: `npx tsc --noEmit` and `npx eslint hooks/useFishing.ts hooks/useFishingController.ts lib/game/fishing lib/game/engine.ts components/game tests/unit/fishing-messages.test.ts tests/unit/use-fishing.test.tsx` → clean.

- [ ] **Step 10: Commit**

```bash
git add lib/game/fishing/messages.ts hooks/useFishing.ts hooks/useFishingController.ts components/game/fishing/FishingHud.tsx lib/game/engine.ts components/game/GameCanvas.tsx components/game/GameShell.tsx tests/unit/fishing-messages.test.ts tests/unit/use-fishing.test.tsx
git commit -m "feat(v14): fishing state in the game — coins, bait, daily check-in, song bonus, digging

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Casting, the bite, the reel minigame and the catch card

**Files:**
- Create: `hooks/useCastSession.ts`, `components/game/fishing/ReelOverlay.tsx`, `components/game/fishing/CatchCard.tsx`, `components/game/fishing/FishingOverlays.tsx`
- Modify: `lib/game/fishing/messages.ts` (cast texts), `hooks/useFishingController.ts`, `components/game/GameShell.tsx`
- Test: `tests/unit/use-cast-session.test.tsx` (new), `tests/unit/fishing-messages.test.ts` (extend)

**Interfaces:**
- Consumes: `castPhase`/`canHook`/`reelParamsFor`/`CastInfo` (Task 5), `createReel`/`stepReel`/`zoneHeight`/`fishFloor` (Task 5), `SWING_MS`, `RARITY_COLOR`/`RARITY_NAME`, `formatWeight`/`formatXu`, `handFish`, `castBlocker`; `FishingData.startCast`/`finishCast` (Task 14); `GameCanvasHandle.plant`/`setFishing`/`landCatch`/`anglerNear` (Task 13); `ItemIcon` (Task 6).
- Produces:
  - `messages.ts`: `MISSED` "Cá ăn mồi rồi chạy mất!", `REELED_IN` "Đã thu cần.", `ESCAPED` "Cá đã thoát!", `BAIT_SWITCHED`, `castRefusal(state, failed, now, spotTaken): string | null`, `lostText(cause: "missed" | "reeled_in" | "reel", why: LostWhy | null, fishCap)`.
  - `useCastSession({ roomId, data, canvas, toast }): CastSession { view: CastView; caught; dismissCatch; cast(spot); hook(); reelIn(); reelDone(won); abandon() }` with `CastView = idle | casting | waiting{info} | bite{info} | reeling{info, params} | finishing`. The swing lasts `SWING_MS`; the bite comes `biteMs` after `start_cast` answered and lasts `windowMs`; a missed bite, "Thu cần" and a lost reel call `finish_cast(false)`; a won reel calls `finish_cast(true)` and, when caught, `landCatch` + the catch card; abandoning (a portal, leaving game mode, unmount) gives the cast up quietly — also when `start_cast` answers only afterwards. The bobber shows the rarity colour at the bite when `start_cast` returned a rarity, and `bobber_lamp` glows.
  - `FishingController` gains `cast: CastView`, `caught`, `dismissCatch`, `hook`, `reelIn`, `reelDone`, `cancelCast`, `onFishingInput(kind)`; `interact` handles `fish_spot` (checks with `castRefusal`, incl. "Chỗ này có người câu rồi." when another angler stands within 12 px).
  - `ReelOverlay({ params, rarity, onDone })`, `CatchCard({ fish, name, record, onClose })` (auto-closes after 5 s), `FishingOverlays({ fishing })` ("🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the catch card).

- [ ] **Step 1: Write the failing tests**

**tests/unit/fishing-messages.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { blockerText, dailyText, digText, digWaitText, promptText, saleText } from "@/lib/game/fishing/messages";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { blockerText, castRefusal, dailyText, digText, digWaitText, lostText, promptText, saleText } from "@/lib/game/fishing/messages";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

**tests/unit/fishing-messages.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("cast texts", () => {
  it("refuses a cast in the order of the checks: state, server rules, the spot", () => {
    expect(castRefusal(null, false, NOW, false)).toBe("Đang tải giỏ đồ…");
    expect(castRefusal(null, true, NOW, false)).toBe("Chưa tải được giỏ đồ — bấm “Tải lại giỏ đồ” nhé.");
    expect(castRefusal(withS({ bait: { bait_worm: 1 } }), false, NOW, false)).toBeNull();
    expect(castRefusal(withS({ bait: {} }), false, NOW, true)).toBe("Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.");
    expect(castRefusal(withS({ bait: { bait_worm: 1 }, castsLeft: 0 }), false, NOW, false)).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 30 phút).");
    expect(castRefusal(withS({ bait: { bait_worm: 1 } }), false, NOW, true)).toBe("Chỗ này có người câu rồi.");
  });
  it("says why a cast ended empty", () => {
    expect(lostText("missed", "gave_up", 1)).toBe("Cá ăn mồi rồi chạy mất!");
    expect(lostText("reeled_in", "gave_up", 1)).toBe("Đã thu cần.");
    expect(lostText("reel", null, 1)).toBe("Cá đã thoát!");
    expect(lostText("reel", "too_early", 1)).toBe("Cá đã thoát!");
    expect(lostText("reel", "full", 1)).toBe("Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!");
    expect(lostText("reel", "full", 6)).toBe("Xô đầy rồi — ra vựa bán bớt nhé!");
  });
});
```

Create `tests/unit/use-cast-session.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import CatchCard from "@/components/game/fishing/CatchCard";
import ReelOverlay from "@/components/game/fishing/ReelOverlay";
import { useCastSession } from "@/hooks/useCastSession";
import type { FinishCast, StartCast } from "@/lib/game/fishing/rpc";
import { parseFishingState } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";

const SPOT: Interactable = {
  id: "fish_1", kind: "fish_spot", label: "Chỗ câu", prompt: "Quăng cần", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 252, y: 204 }, face: "up",
};
const STATE = parseFishingState({ loadout: { rod: "rod_wood", bobber: "bobber_lamp", bait: "bait_worm" } })!;
const answer = (over: Partial<StartCast> = {}): StartCast => ({
  castId: "c1", biteMs: 4000, windowMs: 2500, difficulty: 38, minReelMs: 3520, zonePct: 25, rarity: 3, baitSwitched: false,
  state: STATE, ...over,
});
const FISH = { id: "f1", speciesId: "ca_loc", weightG: 1200, price: 72, rarity: 2 as const };
const withHand = parseFishingState({ fish: [{ id: "f0", species_id: "ca_ro", weight_g: 100, price: 5, caught_at: "x" }] })!;

function setup(start: () => Promise<StartCast | null>, finish: (id: string, ok: boolean) => Promise<FinishCast | null>) {
  const canvas = {
    plant: vi.fn(), setFishing: vi.fn(), landCatch: vi.fn(),
  } as unknown as GameCanvasHandle & { plant: ReturnType<typeof vi.fn>; setFishing: ReturnType<typeof vi.fn>; landCatch: ReturnType<typeof vi.fn> };
  const toasts: string[] = [];
  const startCast = vi.fn(start);
  const finishCast = vi.fn(finish);
  const hook = renderHook(() => useCastSession({ roomId: "r", data: { startCast, finishCast }, canvas: () => canvas, toast: (t) => toasts.push(t) }));
  return { ...hook, canvas, toasts, startCast, finishCast };
}
const phases = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => (c[0] as { phase: string }).phase);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCastSession", () => {
  it("plants, swings, waits, bites (lamp: glowing, rarity tint), hooks and lands the fish", async () => {
    const s = setup(async () => answer(), async () => ({ result: "caught", fish: FISH, record: true, state: withHand }));
    act(() => s.result.current.cast(SPOT));
    expect(s.canvas.plant).toHaveBeenCalledWith({ x: 252, y: 204 }, "up");
    expect(s.result.current.view.phase).toBe("casting");
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(s.result.current.view.phase).toBe("waiting");
    act(() => s.result.current.hook()); // too early: nothing
    expect(s.result.current.view.phase).toBe("waiting");
    await act(async () => { await vi.advanceTimersByTimeAsync(3400); });
    expect(s.result.current.view.phase).toBe("bite");
    expect(s.canvas.setFishing).toHaveBeenLastCalledWith({ phase: "bite", tint: "#2f80ed", glow: true });
    act(() => s.result.current.hook());
    expect(s.result.current.view).toMatchObject({ phase: "reeling", params: { zonePct: 25, difficulty: 38, minReelMs: 3520 } });
    await act(async () => { s.result.current.reelDone(true); await vi.advanceTimersByTimeAsync(0); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", true);
    expect(s.canvas.landCatch).toHaveBeenCalledWith("ca_loc", 1200, "ca_ro");
    expect(s.result.current.caught).toEqual({ fish: FISH, record: true });
    expect(s.result.current.view.phase).toBe("idle");
    expect(phases(s.canvas.setFishing)).toEqual(["casting", "waiting", "bite", "reeling"]);
  });

  it("gives a missed bite up and says so", async () => {
    const s = setup(async () => answer({ rarity: null }), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4000 + 2500); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
    expect(s.toasts).toEqual(["Cá ăn mồi rồi chạy mất!"]);
    expect(s.canvas.setFishing).toHaveBeenLastCalledWith({ phase: "idle" });
  });

  it("reels in while waiting (the bait is lost)", async () => {
    const s = setup(async () => answer(), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    await act(async () => { s.result.current.reelIn(); await vi.advanceTimersByTimeAsync(0); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
    expect(s.toasts).toEqual(["Đã thu cần."]);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(s.finishCast).toHaveBeenCalledTimes(1);
  });

  it("brings the rod back when start_cast is refused, and toasts a bait switch", async () => {
    const r = setup(async () => null, async () => null);
    act(() => r.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(r.result.current.view.phase).toBe("idle");
    expect(r.canvas.setFishing).toHaveBeenLastCalledWith({ phase: "idle" });
    const b = setup(async () => answer({ baitSwitched: true }), async () => null);
    act(() => b.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(b.toasts).toEqual(["Hết mồi đang chọn — dùng trùn đất."]);
  });

  it("explains a won reel the server still refused", async () => {
    const full = setup(async () => answer(), async () => ({ result: "lost", why: "full", state: STATE }));
    act(() => full.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    act(() => full.result.current.hook());
    await act(async () => { full.result.current.reelDone(true); await vi.advanceTimersByTimeAsync(0); });
    expect(full.toasts).toEqual(["Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!"]);
    const lost = setup(async () => answer(), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => lost.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    act(() => lost.result.current.hook());
    await act(async () => { lost.result.current.reelDone(false); await vi.advanceTimersByTimeAsync(0); });
    expect(lost.finishCast).toHaveBeenCalledWith("c1", false);
    expect(lost.toasts).toEqual(["Cá đã thoát!"]);
  });

  it("gives the cast up quietly when abandoned, even before start_cast answered", async () => {
    let answerNow!: (a: StartCast) => void;
    const s = setup(() => new Promise<StartCast>((r) => { answerNow = r; }), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    act(() => s.result.current.abandon());
    expect(s.result.current.view.phase).toBe("idle");
    expect(s.finishCast).not.toHaveBeenCalled();
    await act(async () => { answerNow(answer()); await vi.advanceTimersByTimeAsync(0); });
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(s.toasts).toEqual([]);
    expect(s.finishCast).toHaveBeenCalledTimes(1);
  });

  it("gives the cast up when the shell unmounts", async () => {
    const s = setup(async () => answer(), async () => ({ result: "lost", why: "gave_up", state: STATE }));
    act(() => s.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    s.unmount();
    expect(s.finishCast).toHaveBeenCalledWith("c1", false);
  });
});

describe("ReelOverlay", () => {
  it("lets an idle player lose the fish", () => {
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.spyOn(performance, "now").mockReturnValue(0);
    const onDone = vi.fn();
    render(<ReelOverlay params={{ zonePct: 25, difficulty: 15, minReelMs: 2600, seed: 7 }} rarity={null} onDone={onDone} />);
    expect(screen.getByRole("progressbar", { name: "Tiến độ kéo cá" })).toHaveAttribute("aria-valuenow", "30");
    for (let t = 16; t < 60_000 && onDone.mock.calls.length === 0; t += 16) {
      const run = frames;
      frames = [];
      act(() => run.forEach((cb) => cb(t)));
    }
    expect(onDone).toHaveBeenCalledWith(false);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("CatchCard", () => {
  it("shows the fish and a new record, and closes by itself after 5 s", () => {
    const onClose = vi.fn();
    render(<CatchCard fish={FISH} name="Cá lóc" record onClose={onClose} />);
    expect(screen.getByText("Cá lóc")).toBeInTheDocument();
    expect(screen.getByText("≈ 72 xu")).toBeInTheDocument();
    expect(screen.getByText("🏆 Kỷ lục mới!")).toBeInTheDocument();
    expect(screen.getByText("Khá")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(4999); });
    expect(onClose).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/fishing-messages.test.ts tests/unit/use-cast-session.test.tsx`
Expected: FAIL — `castRefusal`/`lostText` are not exported and the session hook and overlays do not exist.

- [ ] **Step 3: Add the cast texts**

**lib/game/fishing/messages.ts — edit 1 of 2.** Replace:

```ts
import { formatXu } from "./catalog";
import { castWaitMin, digWaitSec, type CastBlocker, type FishingState } from "./state";
```

with:

```ts
import { formatXu } from "./catalog";
import type { LostWhy } from "./rpc";
import { castBlocker, castWaitMin, digWaitSec, type CastBlocker, type FishingState } from "./state";
```

**lib/game/fishing/messages.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
export const MISSED = "Cá ăn mồi rồi chạy mất!";
export const REELED_IN = "Đã thu cần.";
export const ESCAPED = "Cá đã thoát!";
export const BAIT_SWITCHED = "Hết mồi đang chọn — dùng trùn đất.";

/** Why a cast may not start here and now (null = go): the state, the server's checks, then the spot (spec §6.1). */
export function castRefusal(s: FishingState | null, failed: boolean, now: number, spotTaken: boolean): string | null {
  if (!s) return failed ? NOT_LOADED : LOADING;
  const b = castBlocker(s, now);
  if (b) return blockerText(b, castWaitMin(s, now));
  return spotTaken ? SPOT_TAKEN : null;
}

/** A cast ended without a fish: a missed bite, "Thu cần", or a reel the fish won — or, after a won reel, the server
 *  still said no (a full hand or bucket, or the time gate). */
export function lostText(cause: "missed" | "reeled_in" | "reel", why: LostWhy | null, fishCap: number): string {
  if (cause === "missed") return MISSED;
  if (cause === "reeled_in") return REELED_IN;
  if (why === "full") return blockerText(fishCap <= 1 ? "hands_full" : "bucket_full", 0);
  return ESCAPED;
}
```

- [ ] **Step 4: Create `hooks/useCastSession.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import type { FishingData } from "@/hooks/useFishing";
import { canHook, reelParamsFor, type CastInfo } from "@/lib/game/fishing/cast";
import { RARITY_COLOR } from "@/lib/game/fishing/catalog";
import { SWING_MS } from "@/lib/game/fishing/geometry";
import { BAIT_SWITCHED, lostText } from "@/lib/game/fishing/messages";
import type { ReelParams } from "@/lib/game/fishing/reel";
import type { CaughtFish } from "@/lib/game/fishing/rpc";
import { handFish } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";

/** What the HUD shows of the cast (spec §6.1). */
export type CastView =
  | { phase: "idle" }
  | { phase: "casting" }
  | { phase: "waiting"; info: CastInfo }
  | { phase: "bite"; info: CastInfo }
  | { phase: "reeling"; info: CastInfo; params: ReelParams }
  | { phase: "finishing" };

export interface CastSession {
  view: CastView;
  /** A fish just landed (the catch card), until dismissed. */
  caught: { fish: CaughtFish; record: boolean } | null;
  dismissCatch: () => void;
  /** Cast at a fishing spot (the caller has checked castRefusal). */
  cast: (spot: Interactable) => void;
  /** Hook the fish (only during the bite). */
  hook: () => void;
  /** "Thu cần" while waiting: the bait is lost. */
  reelIn: () => void;
  /** The reel minigame ended. */
  reelDone: (caught: boolean) => void;
  /** Leaving the map or the game: give the cast up quietly (fire-and-forget). */
  abandon: () => void;
}

interface Live {
  info: CastInfo | null;
  /** performance.now() when start_cast answered. */
  answeredAt: number;
  /** The player left before start_cast answered: give it up as soon as it does. */
  abandoned: boolean;
  timers: Array<ReturnType<typeof setTimeout>>;
}

/** One cast at a time: start_cast → swing → wait → bite → hook → reel → finish_cast (spec §6.1). */
export function useCastSession({ roomId, data, canvas, toast }: {
  roomId: string;
  data: Pick<FishingData, "startCast" | "finishCast">;
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
}): CastSession {
  const [view, setView] = useState<CastView>({ phase: "idle" });
  const [caught, setCaught] = useState<{ fish: CaughtFish; record: boolean } | null>(null);
  const live = useRef<Live | null>(null);
  const { startCast, finishCast } = data;
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });

  const clearTimers = (l: Live) => {
    for (const t of l.timers) clearTimeout(t);
    l.timers = [];
  };

  const end = useCallback(async (success: boolean, cause: "missed" | "reeled_in" | "reel") => {
    const l = live.current;
    if (!l?.info) return;
    live.current = null;
    clearTimers(l);
    setView({ phase: "finishing" });
    const r = await finishCast(l.info.castId, success);
    setView({ phase: "idle" });
    if (!r) {
      canvas()?.setFishing({ phase: "idle" });
      return;
    }
    if (r.result === "caught") {
      canvas()?.landCatch(r.fish.speciesId, r.fish.weightG, handFish(r.state)?.speciesId ?? null);
      setCaught({ fish: r.fish, record: r.record });
    } else {
      canvas()?.setFishing({ phase: "idle" });
      toastRef.current(lostText(cause, success ? r.why : null, r.state.fishCap));
    }
  }, [canvas, finishCast]);

  const cast = useCallback((spot: Interactable) => {
    if (live.current) return;
    const l: Live = { info: null, answeredAt: 0, abandoned: false, timers: [] };
    live.current = l;
    const startedAt = performance.now();
    canvas()?.plant(spot.use, spot.face ?? "up");
    canvas()?.setFishing({ phase: "casting" });
    setView({ phase: "casting" });
    void startCast(roomId).then((r) => {
      if (live.current !== l) return;
      if (!r) {
        // start_cast refused (the toast is shown): the rod comes back in
        live.current = null;
        canvas()?.setFishing({ phase: "idle" });
        setView({ phase: "idle" });
        return;
      }
      const info: CastInfo = {
        castId: r.castId, biteMs: r.biteMs, windowMs: r.windowMs, difficulty: r.difficulty, minReelMs: r.minReelMs,
        zonePct: r.zonePct, rarity: r.rarity,
      };
      l.info = info;
      l.answeredAt = performance.now();
      if (l.abandoned) {
        live.current = null;
        void finishCast(info.castId, false);
        return;
      }
      if (r.baitSwitched) toastRef.current(BAIT_SWITCHED);
      const bobber = r.state.loadout.bobber;
      const swingLeft = Math.max(0, SWING_MS - (l.answeredAt - startedAt));
      l.timers.push(setTimeout(() => {
        canvas()?.setFishing({ phase: "waiting" });
        setView({ phase: "waiting", info });
      }, swingLeft));
      l.timers.push(setTimeout(() => {
        canvas()?.setFishing({ phase: "bite", tint: info.rarity ? RARITY_COLOR[info.rarity] : null, glow: bobber === "bobber_lamp" });
        setView({ phase: "bite", info });
      }, Math.max(swingLeft, info.biteMs)));
      l.timers.push(setTimeout(() => void end(false, "missed"), info.biteMs + info.windowMs));
    });
  }, [canvas, roomId, startCast, finishCast, end]);

  const hook = useCallback(() => {
    const l = live.current;
    if (!l?.info || !canHook(l.info, performance.now() - l.answeredAt)) return;
    clearTimers(l);
    const params = reelParamsFor(l.info, crypto.getRandomValues(new Uint32Array(1))[0]);
    canvas()?.setFishing({ phase: "reeling" });
    setView({ phase: "reeling", info: l.info, params });
  }, [canvas]);

  const reelIn = useCallback(() => {
    const l = live.current;
    if (!l?.info || view.phase !== "waiting") return;
    void end(false, "reeled_in");
  }, [end, view.phase]);

  const reelDone = useCallback((won: boolean) => {
    void end(won, "reel");
  }, [end]);

  const abandon = useCallback(() => {
    const l = live.current;
    if (!l) return;
    clearTimers(l);
    if (l.info) {
      live.current = null;
      void finishCast(l.info.castId, false);
    } else {
      l.abandoned = true;
    }
    canvas()?.setFishing({ phase: "idle" });
    setView({ phase: "idle" });
  }, [canvas, finishCast]);

  // unmounting mid-cast gives the cast up
  const abandonRef = useRef(abandon);
  useEffect(() => {
    abandonRef.current = abandon;
  });
  useEffect(() => () => abandonRef.current(), []);

  return { view, caught, dismissCatch: useCallback(() => setCaught(null), []), cast, hook, reelIn, reelDone, abandon };
}
```

- [ ] **Step 5: Create the reel overlay, the catch card and the overlays**

`components/game/fishing/ReelOverlay.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { FISH_ICONS } from "@/lib/game/art/fish";
import { RARITY_COLOR, type Rarity } from "@/lib/game/fishing/catalog";
import { createReel, fishFloor, stepReel, zoneHeight, type ReelParams } from "@/lib/game/fishing/reel";

/** An unknown rarity (the bobber does not reveal it) shows a grey fish. */
const UNKNOWN = "#6b6f74";
const SILHOUETTE = FISH_ICONS.ca_ro.rows;

/** A fish shape in one colour (16 × 16). */
function FishSilhouette({ color }: { color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, 16, 16);
    c.fillStyle = color;
    SILHOUETTE.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ".") c.fillRect(x, y, 1, 1);
    }));
  }, [color]);
  return <canvas ref={ref} width={16} height={16} aria-hidden="true" style={{ width: 32, height: 32, imageRendering: "pixelated" }} />;
}

/** The reel minigame (spec §6.2, §10.3): hold (mouse, touch or Space) to lift the green zone and keep the fish in it. */
export default function ReelOverlay({ params, rarity, onDone }: {
  params: ReelParams;
  /** Known only when the bobber reveals it. */
  rarity: Rarity | null;
  onDone: (caught: boolean) => void;
}) {
  const [s, setS] = useState(() => createReel(params));
  const holding = useRef(false);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(() => {
    let cur = createReel(params);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepReel(cur, params, Math.max(0, t - last) / 1000, holding.current);
      last = t;
      setS(cur);
      if (cur.outcome) {
        onDoneRef.current(cur.outcome === "caught");
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [params]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      e.preventDefault();
      holding.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") holding.current = false;
    };
    const blur = () => { holding.current = false; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const zh = zoneHeight(params);
  const inside = s.fish >= s.zone && s.fish <= s.zone + zh;
  const hold = (on: boolean) => () => { holding.current = on; };
  return (
    <div
      className="fixed inset-0 z-30 touch-none select-none"
      onPointerDown={hold(true)}
      onPointerUp={hold(false)}
      onPointerCancel={hold(false)}
      onPointerLeave={hold(false)}
      role="dialog"
      aria-label="Kéo cá"
    >
      <div className="pch absolute left-1/2 top-1/2 flex -translate-y-1/2 translate-x-8 items-stretch gap-2 p-2 font-vt text-lg leading-none">
        <div className="relative h-56 w-10 overflow-hidden rounded-sm border-2 border-ink bg-[#2f6e8f]" aria-hidden="true">
          <div
            className={`absolute inset-x-0 ${inside ? "bg-[#6fd06f]/80" : "bg-[#4caf50]/60"}`}
            style={{ bottom: `${s.zone * 100}%`, height: `${zh * 100}%` }}
          />
          <div className="absolute inset-x-0 border-t border-dashed border-white/30" style={{ bottom: `${fishFloor(params) * 100}%` }} />
          <div className="absolute left-1/2 -translate-x-1/2 translate-y-1/2" style={{ bottom: `${s.fish * 100}%` }}>
            <FishSilhouette color={rarity ? RARITY_COLOR[rarity] : UNKNOWN} />
          </div>
        </div>
        <div className="relative w-3 overflow-hidden rounded-sm border-2 border-ink bg-parchment-300" role="progressbar"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)} aria-label="Tiến độ kéo cá">
          <div className="absolute inset-x-0 bottom-0 bg-burgundy" style={{ height: `${s.progress * 100}%` }} />
        </div>
        <p className="w-24 self-center text-base">Giữ chuột, chạm hoặc Space để nâng vùng xanh.</p>
      </div>
    </div>
  );
}
```

`components/game/fishing/CatchCard.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { formatWeight, formatXu, RARITY_COLOR, RARITY_NAME } from "@/lib/game/fishing/catalog";
import type { CaughtFish } from "@/lib/game/fishing/rpc";

/** The catch card (spec §10.3): the fish, its weight, rarity and price; "🏆 Kỷ lục mới!" for a personal best.
 *  OK closes it, and it closes by itself after 5 s. */
export default function CatchCard({ fish, name, record, onClose }: {
  fish: CaughtFish;
  name: string;
  record: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="pch fixed left-1/2 top-1/4 z-40 flex -translate-x-1/2 flex-col items-center gap-1 p-3 font-vt text-xl leading-tight" role="dialog" aria-label="Câu được cá">
      <ItemIcon id={fish.speciesId} scale={5} />
      <p className="text-2xl">{name}</p>
      <p>
        {formatWeight(fish.weightG)} · <span style={{ color: RARITY_COLOR[fish.rarity] }}>{RARITY_NAME[fish.rarity]}</span>
      </p>
      <p className="opacity-80">≈ {formatXu(fish.price)}</p>
      {record && <p className="text-burgundy">🏆 Kỷ lục mới!</p>}
      <button type="button" className="pch-btn pch-btn-primary mt-1" onClick={onClose} autoFocus>OK</button>
    </div>
  );
}
```

`components/game/fishing/FishingOverlays.tsx`:

```tsx
"use client";

import type { FishingController } from "@/hooks/useFishingController";
import CatchCard from "./CatchCard";
import ReelOverlay from "./ReelOverlay";

/** The cast's HUD (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the catch card. */
export default function FishingOverlays({ fishing }: { fishing: FishingController }) {
  const { cast, caught } = fishing;
  const catalog = fishing.data.catalog;
  const name = caught ? catalog?.species.find((s) => s.id === caught.fish.speciesId)?.name ?? caught.fish.speciesId : "";
  return (
    <>
      {cast.phase === "waiting" && (
        <button type="button" onClick={fishing.reelIn} className="pch-btn absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-xl">
          🎣 Thu cần <span className="pointer-coarse:hidden">(Esc)</span>
        </button>
      )}
      {cast.phase === "bite" && (
        <button
          type="button"
          onClick={fishing.hook}
          className="pch-btn pch-btn-primary absolute bottom-24 left-1/2 z-10 -translate-x-1/2 animate-pulse px-6 py-3 text-3xl motion-reduce:animate-none"
        >
          ❗ Giật cần! <span className="pointer-coarse:hidden text-xl">(Space)</span>
        </button>
      )}
      {cast.phase === "reeling" && <ReelOverlay params={cast.params} rarity={cast.info.rarity} onDone={fishing.reelDone} />}
      {caught && <CatchCard fish={caught.fish} name={name} record={caught.record} onClose={fishing.dismissCatch} />}
    </>
  );
}
```

- [ ] **Step 6: Wire the session into the controller and the shell**

**hooks/useFishingController.ts — edit 1 of 7.** Replace:

```ts
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useFishing, type FishingData } from "@/hooks/useFishing";
import {
  BAIT_FULL, dailyText, digText, digWaitText, LOADING, NOT_LOADED, promptText as promptFor, SONG_BONUS,
} from "@/lib/game/fishing/messages";
```

with:

```ts
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useCastSession, type CastSession, type CastView } from "@/hooks/useCastSession";
import { useFishing, type FishingData } from "@/hooks/useFishing";
import {
  BAIT_FULL, castRefusal, dailyText, digText, digWaitText, LOADING, NOT_LOADED, promptText as promptFor, SONG_BONUS,
} from "@/lib/game/fishing/messages";
```

**hooks/useFishingController.ts — edit 2 of 7.** Replace:

```ts
  data: FishingData;
  panel: FishingPanel | null;
```

with:

```ts
  data: FishingData;
  /** The cast in progress (spec §6.1). */
  cast: CastView;
  caught: CastSession["caught"];
  dismissCatch: () => void;
  hook: () => void;
  reelIn: () => void;
  reelDone: (caught: boolean) => void;
  /** Give up the cast quietly (a portal). */
  cancelCast: () => void;
  /** Canvas input while the rod is out: a tap hooks at the bite, Esc reels in while waiting. */
  onFishingInput: (kind: "tap" | "cancel") => void;
  panel: FishingPanel | null;
```

**hooks/useFishingController.ts — edit 3 of 7.** Replace:

```ts
 *  the HUD prompts and which fishing panel is open. */
export function useFishingController({ token, accountId, canvas, current, toast }: FishingControllerOptions): FishingController {
  const data = useFishing(token, toast);
  const { state, failed, catalog, reload, claimDaily, dig } = data;
```

with:

```ts
 *  the HUD prompts and which fishing panel is open. */
export function useFishingController({ token, roomId, accountId, canvas, current, toast }: FishingControllerOptions): FishingController {
  const data = useFishing(token, toast);
  const session = useCastSession({ roomId, data, canvas, toast });
  const { state, failed, catalog, reload, claimDaily, dig } = data;
```

**hooks/useFishingController.ts — edit 4 of 7.** Replace:

```ts

  const interact = useCallback((it: Interactable): boolean => {
```

with:

```ts

  // --- casting: the checks of spec §6.1, then the session takes over
  const { cast: castAt, hook, reelIn } = session;
  const fishAt = useCallback((it: Interactable) => {
    const refusal = castRefusal(stateRef.current, failedRef.current, Date.now(), canvas()?.anglerNear(it.use) ?? false);
    if (refusal) toastRef.current(refusal);
    else castAt(it);
  }, [canvas, castAt]);
  const castPhase = session.view.phase;
  const onFishingInput = useCallback((kind: "tap" | "cancel") => {
    if (kind === "tap" && castPhase === "bite") hook();
    else if (kind === "cancel" && castPhase === "waiting") reelIn();
  }, [castPhase, hook, reelIn]);

  const interact = useCallback((it: Interactable): boolean => {
```

**hooks/useFishingController.ts — edit 5 of 7.** Replace:

```ts
        return true;
      default:
```

with:

```ts
        return true;
      case "fish_spot":
        fishAt(it);
        return true;
      default:
```

**hooks/useFishingController.ts — edit 6 of 7.** Replace:

```ts
    }
  }, [digAt]);
```

with:

```ts
    }
  }, [digAt, fishAt]);
```

**hooks/useFishingController.ts — edit 7 of 7.** Replace:

```ts
    data,
    panel,
```

with:

```ts
    data,
    cast: session.view,
    caught: session.caught,
    dismissCatch: session.dismissCatch,
    hook,
    reelIn,
    reelDone: session.reelDone,
    cancelCast: session.abandon,
    onFishingInput,
    panel,
```

**components/game/GameShell.tsx — edit 1 of 6.** Replace:

```tsx
import FishingHud from "./fishing/FishingHud";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
```

with:

```tsx
import FishingHud from "./fishing/FishingHud";
import FishingOverlays from "./fishing/FishingOverlays";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
```

**components/game/GameShell.tsx — edit 2 of 6.** Replace:

```tsx
  const fishing = useFishingController({ token, roomId: room.id, accountId, canvas: getCanvas, current: derived.current, toast: showToast });
  const { interact: fishingInteract, promptText } = fishing;
```

with:

```tsx
  const fishing = useFishingController({ token, roomId: room.id, accountId, canvas: getCanvas, current: derived.current, toast: showToast });
  const { interact: fishingInteract, promptText, cancelCast, onFishingInput } = fishing;
```

**components/game/GameShell.tsx — edit 3 of 6.** Replace:

```tsx
      case "portal":
        if (it.to) travelTo(it.to);
        break;
```

with:

```tsx
      case "portal":
        if (!it.to) break;
        cancelCast();
        travelTo(it.to);
        break;
```

**components/game/GameShell.tsx — edit 4 of 6.** Replace:

```tsx
    }
  }, [travelTo, showToast, fishingInteract]);
```

with:

```tsx
    }
  }, [travelTo, showToast, fishingInteract, cancelCast]);
```

**components/game/GameShell.tsx — edit 5 of 6.** Replace:

```tsx
  const onFatal = useCallback(() => leaveBroken("Thế giới game gặp lỗi — quay về giao diện cũ."), [leaveBroken]);
  const onFishingInput = useCallback(() => {}, []);
```

with:

```tsx
  const onFatal = useCallback(() => leaveBroken("Thế giới game gặp lỗi — quay về giao diện cũ."), [leaveBroken]);
```

**components/game/GameShell.tsx — edit 6 of 6.** Replace:

```tsx

      <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
```

with:

```tsx

      <FishingOverlays fishing={fishing} />

      <div ref={bottomRef} className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
```

- [ ] **Step 7: Run the tests, typecheck and lint**

Run: `pnpm vitest run` → all green.
Run: `npx tsc --noEmit` and `npx eslint hooks lib/game/fishing components/game tests/unit/use-cast-session.test.tsx tests/unit/fishing-messages.test.ts` → no errors in these files (the two pre-existing `react-hooks/set-state-in-effect` errors in `hooks/useSponsorBlock.ts` are among the 17 baseline errors).

- [ ] **Step 8: Commit**

```bash
git add hooks/useCastSession.ts hooks/useFishingController.ts components/game/fishing/ReelOverlay.tsx components/game/fishing/CatchCard.tsx components/game/fishing/FishingOverlays.tsx lib/game/fishing/messages.ts components/game/GameShell.tsx tests/unit/use-cast-session.test.tsx tests/unit/fishing-messages.test.ts
git commit -m "feat(v14): cast, bite, reel minigame and catch card

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The bag, the fish depot, the tackle shop and the records board

**Files:**
- Create: `components/game/fishing/FishLine.tsx`, `BagPanel.tsx`, `DepotPanel.tsx`, `ShopPanel.tsx`, `RecordsPanel.tsx` (all in `components/game/fishing/`)
- Modify: `hooks/useFishingController.ts`, `components/game/fishing/FishingOverlays.tsx`, `components/game/GameShell.tsx`
- Test: `tests/unit/fishing-panels.test.tsx`

**Interfaces:**
- Consumes: `describeItem`, `formatWeight`, `formatXu`, `RARITY_*`, `FishingCatalog` (Task 4); `ownsItem`, `maxBuyQty`, `baitCount`, `baitTotal`, `Loadout` (Task 4); `fetchFishingBoard`, `FishingBoard` (Task 4); `ParchmentModal`, `ItemIcon`; `FishingData.sell/release/buy/equip` (Task 14); `saleText` (Task 14).
- Produces:
  - `FishLine({ fish, species, children })`.
  - `BagPanel({ state, catalog, busy, onEquip, onRelease, onClose })`: **Cá** (Trên tay / Trong xô, **Thả**), **Cần câu** and **Phao** (owned, **Dùng** / "✓ Đang dùng"), **Mồi** (all three with counts), **Đồ nghề** (bait box and bucket).
  - `DepotPanel({ state, catalog, busy, onSell, onClose })`: **Bán** per fish and **Bán hết (N con · X xu)**.
  - `ShopPanel({ state, catalog, busy, onBuy, onClose })`: tiles for every item with a price — **Mua**, **Đã có**, **Không đủ xu** or **Hộp mồi đầy**; bait with quantity buttons 1 / 5 / 10 / "Tối đa N".
  - `RecordsPanel({ catalog, load, onClose })`: tabs **Kỷ lục câu cá** (the room record and my best per species) and **Đại gia** (top 10 and "Bạn: hạng N · X xu"), with **Thử lại** when loading fails.
  - `FishingController` gains `busy`, `sell(ids)` (toast "Bán N con · +X xu"), `release(id)`, `buy(itemId, qty)` (toast "🛒 Đã mua …"), `equip(loadout)`, `loadBoard()`; `interact` opens `depot` / `shop` / `records`; `FishingOverlays` renders the open panel; the player card gets **🎒 Giỏ đồ**; a fishing panel turns game input off like the v13 panels.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/fishing-panels.test.tsx`:

```tsx
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import BagPanel from "@/components/game/fishing/BagPanel";
import DepotPanel from "@/components/game/fishing/DepotPanel";
import RecordsPanel from "@/components/game/fishing/RecordsPanel";
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { shopItemFromRow, speciesFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
import type { FishingBoard } from "@/lib/game/fishing/rpc";
import { parseFishingState } from "@/lib/game/fishing/state";

afterEach(cleanup);

const row = (id: string, kind: string, name: string, price: number | null, over: Partial<ShopItemRow> = {}): ShopItemRow => ({
  id, kind, name, price, starter: price === null && kind !== "bait", sort_order: 0, zone_pct: null, weight_k: null, rare_mult: 1,
  window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
  ...over,
});
const CATALOG: FishingCatalog = {
  species: [
    speciesFromRow({ id: "ca_ro", name: "Cá rô đồng", rarity: 1, min_g: 50, max_g: 300, price_per_kg: 45, difficulty: 15, sort_order: 10 }),
    speciesFromRow({ id: "ca_loc", name: "Cá lóc", rarity: 2, min_g: 300, max_g: 2500, price_per_kg: 60, difficulty: 38, sort_order: 40 }),
  ],
  items: [
    row("rod_wood", "rod", "Cần gỗ", null, { zone_pct: 25, weight_k: 2, sort_order: 10 }),
    row("rod_bamboo", "rod", "Cần tre", 300, { zone_pct: 30, weight_k: 1.5, sort_order: 20 }),
    row("bobber_feather", "bobber", "Phao lông gà", null, { window_ms: 1500, bite_max_ms: 10000, sort_order: 10 }),
    row("bobber_foam", "bobber", "Phao xốp", 150, { window_ms: 2000, bite_max_ms: 10000, shows_rarity: true, sort_order: 20 }),
    row("bait_worm", "bait", "Trùn đất", null, { sort_order: 10 }),
    row("bait_shrimp", "bait", "Mồi tép", 5, { mult_hiem: 1.5, mult_quy: 1.5, mult_legend: 1.5, sort_order: 20 }),
    row("bait_box", "bait_box", "Hộp mồi", 250, { capacity: 60 }),
    row("bucket_small", "bucket", "Xô nhỏ", 200, { capacity: 5, sort_order: 10 }),
    row("bucket_large", "bucket", "Xô lớn", 800, { capacity: 15, sort_order: 20 }),
  ].map(shopItemFromRow),
};
const STATE = parseFishingState({
  coins: 120,
  loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" },
  owned: ["rod_bamboo", "bucket_small"],
  bait: { bait_worm: 3, bait_shrimp: 2 },
  bait_cap: 20,
  fish: [
    { id: "f1", species_id: "ca_loc", weight_g: 1200, price: 72, caught_at: "2026-09-24T10:00:00Z" },
    { id: "f2", species_id: "ca_ro", weight_g: 110, price: 5, caught_at: "2026-09-24T10:05:00Z" },
  ],
  fish_cap: 6,
})!;

describe("BagPanel", () => {
  it("lists the hand fish, the bucket, the gear and the baits, and changes the loadout", () => {
    const onEquip = vi.fn(), onRelease = vi.fn();
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={onEquip} onRelease={onRelease} onClose={() => {}} />);
    expect(screen.getByText("Cá (2/6)")).toBeInTheDocument();
    const hand = screen.getByText("Trên tay").nextElementSibling as HTMLElement;
    expect(within(hand).getByText("Cá lóc")).toBeInTheDocument();
    const bucket = screen.getByText("Trong xô").nextElementSibling as HTMLElement;
    fireEvent.click(within(bucket).getByRole("button", { name: "Thả" }));
    expect(onRelease).toHaveBeenCalledWith("f2");
    fireEvent.click(within(screen.getByText("Cần tre").closest("li")!).getByRole("button", { name: "Dùng" }));
    expect(onEquip).toHaveBeenCalledWith({ rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_worm" });
    expect(screen.queryByText("Phao xốp")).toBeNull(); // not owned
    expect(screen.getByText("Mồi tép × 2")).toBeInTheDocument();
    expect(screen.getByText("Xô nhỏ · đựng 5 con")).toBeInTheDocument();
    expect(screen.getAllByText("✓ Đang dùng")).toHaveLength(3);
  });
});

describe("DepotPanel", () => {
  it("sells one fish or all of them", () => {
    const onSell = vi.fn();
    render(<DepotPanel state={STATE} catalog={CATALOG} busy={false} onSell={onSell} onClose={() => {}} />);
    fireEvent.click(within(screen.getByText("Cá rô đồng").closest("li")!).getByRole("button", { name: "Bán" }));
    expect(onSell).toHaveBeenLastCalledWith(["f2"]);
    fireEvent.click(screen.getByRole("button", { name: "Bán hết (2 con · 77 xu)" }));
    expect(onSell).toHaveBeenLastCalledWith(["f1", "f2"]);
  });
  it("has nothing to buy from an empty bucket", () => {
    render(<DepotPanel state={{ ...STATE, fish: [] }} catalog={CATALOG} busy={false} onSell={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /Bán hết/ })).toBeNull();
  });
});

describe("ShopPanel", () => {
  it("sells what is for sale: owned gear is marked, costly gear waits, bait comes by the handful", () => {
    const onBuy = vi.fn();
    render(<ShopPanel state={{ ...STATE, coins: 160 }} catalog={CATALOG} busy={false} onBuy={onBuy} onClose={() => {}} />);
    expect(screen.queryByText("Cần gỗ")).toBeNull(); // starter, not sold
    const tile = (name: string) => screen.getByText(name).closest("li")!;
    expect(within(tile("Cần tre")).getByRole("button", { name: "Đã có" })).toBeDisabled();
    expect(within(tile("Xô nhỏ")).getByRole("button", { name: "Đã có" })).toBeDisabled();
    expect(within(tile("Hộp mồi")).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
    fireEvent.click(within(tile("Phao xốp")).getByRole("button", { name: "Mua" }));
    expect(onBuy).toHaveBeenLastCalledWith("bobber_foam", 1);
    const shrimp = tile("Mồi tép");
    fireEvent.click(within(shrimp).getByRole("button", { name: "10" }));
    fireEvent.click(within(shrimp).getByRole("button", { name: "Mua 10 · 50 xu" }));
    expect(onBuy).toHaveBeenLastCalledWith("bait_shrimp", 10);
    expect(within(shrimp).getByRole("button", { name: "Tối đa 15" })).toBeInTheDocument();
  });
});

describe("RecordsPanel", () => {
  const BOARD: FishingBoard = {
    records: [{ speciesId: "ca_loc", username: "Dat", weightG: 2400 }], mine: [{ speciesId: "ca_ro", weightG: 210 }],
    richest: [{ username: "Dat", coins: 900 }, { username: "An", coins: 120 }], myRank: 2, myCoins: 120,
  };
  it("shows the room records next to mine, and the richest members", async () => {
    render(<RecordsPanel catalog={CATALOG} load={async () => BOARD} onClose={() => {}} />);
    expect(await screen.findByText("Dat · 2,4 kg")).toBeInTheDocument();
    expect(screen.getByText("210 g")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Đại gia" }));
    expect(screen.getByText("Dat — 900 xu")).toBeInTheDocument();
    expect(screen.getByText("Bạn: hạng 2 · 120 xu")).toBeInTheDocument();
  });
  it("offers a retry when the board does not load", async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(BOARD);
    render(<RecordsPanel catalog={CATALOG} load={load} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Thử lại" }));
    expect(await screen.findByText("Dat · 2,4 kg")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/fishing-panels.test.tsx`
Expected: FAIL — the panel modules do not exist.

- [ ] **Step 3: Create the panels**

`components/game/fishing/FishLine.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { formatWeight, formatXu, RARITY_COLOR, RARITY_NAME, type FishSpecies } from "@/lib/game/fishing/catalog";
import type { FishRow } from "@/lib/game/fishing/state";

/** One fish in a list: icon, name, weight, rarity (in its colour), price, then the row's buttons. */
export default function FishLine({ fish, species, children }: { fish: FishRow; species: FishSpecies | undefined; children?: ReactNode }) {
  const rarity = species?.rarity ?? 1;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5">
      <ItemIcon id={fish.speciesId} scale={2} />
      <span className="min-w-0 flex-1 truncate">{species?.name ?? fish.speciesId}</span>
      <span className="tabular-nums">{formatWeight(fish.weightG)}</span>
      <span style={{ color: RARITY_COLOR[rarity] }}>{RARITY_NAME[rarity]}</span>
      <span className="tabular-nums opacity-80">{formatXu(fish.price)}</span>
      {children}
    </li>
  );
}
```

`components/game/fishing/BagPanel.tsx`:

```tsx
"use client";

import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { describeItem, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { baitCount, ownsItem, type FishingState, type Loadout } from "@/lib/game/fishing/state";
import FishLine from "./FishLine";

/** 🎒 Giỏ đồ (spec §10.2): the fish (hand, then bucket), the owned rods and bobbers, the baits, the bait box and bucket. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  /** An RPC is in flight: the buttons wait. */
  busy: boolean;
  onEquip: (loadout: Loadout) => void;
  onRelease: (fishId: string) => void;
  onClose: () => void;
}) {
  if (!state || !catalog) {
    return (
      <ParchmentModal title="🎒 Giỏ đồ" onClose={onClose}>
        <p className="font-vt text-lg">Đang tải giỏ đồ…</p>
      </ParchmentModal>
    );
  }
  const speciesOf = (id: string) => catalog.species.find((s) => s.id === id);
  const [inHand, ...inBucket] = state.fish;
  const kind = (k: ShopItem["kind"]) => catalog.items.filter((i) => i.kind === k);
  const owned = (k: "rod" | "bobber") => kind(k).filter((i) => ownsItem(state, i));
  const bucket = kind("bucket").filter((i) => ownsItem(state, i)).sort((a, b) => (b.capacity ?? 0) - (a.capacity ?? 0))[0];
  const box = kind("bait_box").find((i) => ownsItem(state, i));

  const gearRow = (item: ShopItem, slot: keyof Loadout, count?: number) => {
    const using = state.loadout[slot] === item.id;
    return (
      <li key={item.id} className="flex items-center gap-2 py-0.5">
        <ItemIcon id={item.id} scale={2} />
        <span className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate">{item.name}{count !== undefined ? ` × ${count}` : ""}</span>
          <span className="truncate text-base opacity-75">{describeItem(item)}</span>
        </span>
        {using ? (
          <span className="text-base text-burgundy">✓ Đang dùng</span>
        ) : (
          <button type="button" className="pch-btn" disabled={busy} onClick={() => onEquip({ ...state.loadout, [slot]: item.id })}>Dùng</button>
        )}
      </li>
    );
  };

  return (
    <ParchmentModal title="🎒 Giỏ đồ" onClose={onClose}>
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight">
        <section>
          <h3 className="text-xl text-burgundy">Cá ({state.fish.length}/{state.fishCap})</h3>
          {state.fish.length === 0 && <p className="opacity-70">Chưa có con nào — ra cầu ao quăng cần nhé!</p>}
          {inHand && (
            <>
              <p className="text-base opacity-80">Trên tay</p>
              <ul>
                <FishLine fish={inHand} species={speciesOf(inHand.speciesId)}>
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => onRelease(inHand.id)}>Thả</button>
                </FishLine>
              </ul>
            </>
          )}
          {inBucket.length > 0 && (
            <>
              <p className="text-base opacity-80">Trong xô</p>
              <ul>
                {inBucket.map((f) => (
                  <FishLine key={f.id} fish={f} species={speciesOf(f.speciesId)}>
                    <button type="button" className="pch-btn" disabled={busy} onClick={() => onRelease(f.id)}>Thả</button>
                  </FishLine>
                ))}
              </ul>
            </>
          )}
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Cần câu</h3>
          <ul>{owned("rod").map((i) => gearRow(i, "rod"))}</ul>
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Phao</h3>
          <ul>{owned("bobber").map((i) => gearRow(i, "bobber"))}</ul>
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Mồi</h3>
          <ul>{kind("bait").map((i) => gearRow(i, "bait", baitCount(state, i.id)))}</ul>
        </section>
        <section>
          <h3 className="text-xl text-burgundy">Đồ nghề</h3>
          <ul>
            <li className="flex items-center gap-2 py-0.5">
              {box ? <ItemIcon id={box.id} scale={2} /> : <span className="w-8" />}
              <span>{box ? box.name : "Hộp mồi thường"} · chứa {state.baitCap} mồi</span>
            </li>
            <li className="flex items-center gap-2 py-0.5">
              {bucket ? <ItemIcon id={bucket.id} scale={2} /> : <span className="w-8" />}
              <span>{bucket ? `${bucket.name} · đựng ${bucket.capacity ?? 0} con` : "Chưa có xô — chỉ cầm được 1 con trên tay"}</span>
            </li>
          </ul>
        </section>
      </div>
    </ParchmentModal>
  );
}
```

`components/game/fishing/DepotPanel.tsx`:

```tsx
"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { formatXu, type FishingCatalog } from "@/lib/game/fishing/catalog";
import type { FishingState } from "@/lib/game/fishing/state";
import FishLine from "./FishLine";

/** 🐟 Vựa cá · cô Ba (spec §10.2): sell one fish or all of them. */
export default function DepotPanel({ state, catalog, busy, onSell, onClose }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  busy: boolean;
  onSell: (fishIds: string[]) => void;
  onClose: () => void;
}) {
  const fish = state?.fish ?? [];
  const total = fish.reduce((a, f) => a + f.price, 0);
  return (
    <ParchmentModal title="🐟 Vựa cá · cô Ba" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!state ? (
          <p>Đang tải giỏ đồ…</p>
        ) : fish.length === 0 ? (
          <p>“Chưa có cá hả con? Ra cầu ao câu đi, cô mua hết!”</p>
        ) : (
          <>
            <ul>
              {fish.map((f) => (
                <FishLine key={f.id} fish={f} species={catalog?.species.find((s) => s.id === f.speciesId)}>
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell([f.id])}>Bán</button>
                </FishLine>
              ))}
            </ul>
            <button type="button" className="pch-btn pch-btn-primary self-center" disabled={busy} onClick={() => onSell(fish.map((f) => f.id))}>
              Bán hết ({fish.length} con · {formatXu(total)})
            </button>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
```

`components/game/fishing/ShopPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { describeItem, formatXu, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { baitTotal, maxBuyQty, ownsItem, type FishingState } from "@/lib/game/fishing/state";

const KIND_ORDER: ReadonlyArray<ShopItem["kind"]> = ["rod", "bobber", "bait", "bait_box", "bucket"];

/** One shop tile: icon, name, price, effect and the buy button (bait: with a quantity). */
function Tile({ item, state, busy, onBuy }: { item: ShopItem; state: FishingState; busy: boolean; onBuy: (itemId: string, qty: number) => void }) {
  const price = item.price ?? 0;
  const max = maxBuyQty(state, item);
  const choices = [...new Set([1, 5, 10, max])].filter((q) => q >= 1 && q <= max).sort((a, b) => a - b);
  const [qty, setQty] = useState(1);
  const n = Math.min(qty, Math.max(1, max));
  let button;
  if (item.kind !== "bait" && ownsItem(state, item)) {
    button = <button type="button" className="pch-btn" disabled>Đã có</button>;
  } else if (max < 1) {
    const full = item.kind === "bait" && baitTotal(state) >= state.baitCap;
    button = <button type="button" className="pch-btn" disabled>{full ? "Hộp mồi đầy" : "Không đủ xu"}</button>;
  } else {
    button = (
      <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, item.kind === "bait" ? n : 1)}>
        Mua{item.kind === "bait" ? ` ${n} · ${formatXu(price * n)}` : ""}
      </button>
    );
  }
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{formatXu(price)}{item.kind === "bait" ? " / con" : ""}</span>
        </div>
      </div>
      <p className="text-base leading-tight opacity-80">{describeItem(item)}</p>
      {item.kind === "bait" && choices.length > 1 && (
        <div className="flex flex-wrap gap-1" role="group" aria-label={`Số lượng ${item.name}`}>
          {choices.map((q) => (
            <button key={q} type="button" className="pch-btn text-base" aria-pressed={n === q} onClick={() => setQty(q)}>
              {q === max && q > 10 ? `Tối đa ${q}` : q}
            </button>
          ))}
        </div>
      )}
      {button}
    </li>
  );
}

/** 🎣 Tiệm đồ câu · chú Tư (spec §10.2): rods, bobbers, bait, the bait box and buckets. */
export default function ShopPanel({ state, catalog, busy, onBuy, onClose }: {
  state: FishingState | null;
  catalog: FishingCatalog | null;
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
  onClose: () => void;
}) {
  const items = (catalog?.items ?? [])
    .filter((i) => i.price !== null)
    .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.sortOrder - b.sortOrder);
  return (
    <ParchmentModal title="🎣 Tiệm đồ câu · chú Tư" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!state || !catalog ? (
          <p>Đang tải tiệm…</p>
        ) : (
          <>
            <p>Bạn có <b>{formatXu(state.coins)}</b>.</p>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {items.map((i) => <Tile key={i.id} item={i} state={state} busy={busy} onBuy={onBuy} />)}
            </ul>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
```

`components/game/fishing/RecordsPanel.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { formatWeight, formatXu, RARITY_COLOR, type FishingCatalog } from "@/lib/game/fishing/catalog";
import type { FishingBoard } from "@/lib/game/fishing/rpc";

type Tab = "records" | "richest";

/** 🏆 Bảng kỷ lục (spec §10.2): the room's record per species next to my best, and the room's richest members. */
export default function RecordsPanel({ catalog, load, onClose }: {
  catalog: FishingCatalog | null;
  /** fishing_board for this room. */
  load: () => Promise<FishingBoard>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("records");
  const [board, setBoard] = useState<FishingBoard | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    load()
      .then((b) => {
        if (!active) return;
        setBoard(b);
        setError(false);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [load, attempt]);

  const tabButton = (t: Tab, label: string) => (
    <button type="button" role="tab" aria-selected={tab === t} className={`pch-btn ${tab === t ? "pch-btn-primary" : ""}`} onClick={() => setTab(t)}>
      {label}
    </button>
  );

  return (
    <ParchmentModal title="🏆 Bảng kỷ lục" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div className="flex gap-1.5" role="tablist">
          {tabButton("records", "Kỷ lục câu cá")}
          {tabButton("richest", "Đại gia")}
        </div>
        {error && (
          <p>
            Không tải được bảng.{" "}
            <button type="button" className="pch-btn" onClick={() => setAttempt((a) => a + 1)}>Thử lại</button>
          </p>
        )}
        {!board && !error && <p>Đang tải…</p>}
        {board && tab === "records" && (
          <table className="w-full text-left">
            <thead className="text-base opacity-80">
              <tr><th>Loài</th><th>Kỷ lục phòng</th><th>Của bạn</th></tr>
            </thead>
            <tbody>
              {(catalog?.species ?? []).map((s) => {
                const top = board.records.find((r) => r.speciesId === s.id);
                const mine = board.mine.find((r) => r.speciesId === s.id);
                return (
                  <tr key={s.id}>
                    <td className="flex items-center gap-1.5 py-0.5">
                      <ItemIcon id={s.id} scale={2} />
                      <span style={{ color: RARITY_COLOR[s.rarity] }}>{s.name}</span>
                    </td>
                    <td>{top ? `${top.username} · ${formatWeight(top.weightG)}` : "—"}</td>
                    <td>{mine ? formatWeight(mine.weightG) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {board && tab === "richest" && (
          <>
            {board.richest.length === 0 ? (
              <p className="opacity-70">Chưa ai có xu.</p>
            ) : (
              <ol className="list-decimal pl-8">
                {board.richest.map((r, i) => <li key={`${r.username}-${i}`}>{r.username} — {formatXu(r.coins)}</li>)}
              </ol>
            )}
            <p className="text-burgundy">Bạn: hạng {board.myRank} · {formatXu(board.myCoins)}</p>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
```

- [ ] **Step 4: Wire them in**

**hooks/useFishingController.ts — edit 1 of 6.** Replace:

```ts
import {
  BAIT_FULL, castRefusal, dailyText, digText, digWaitText, LOADING, NOT_LOADED, promptText as promptFor, SONG_BONUS,
} from "@/lib/game/fishing/messages";
import { baitTotal, castWaitMin, digWaitSec, handFish } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";
```

with:

```ts
import {
  BAIT_FULL, castRefusal, dailyText, digText, digWaitText, LOADING, NOT_LOADED, promptText as promptFor, saleText, SONG_BONUS,
} from "@/lib/game/fishing/messages";
import { fetchFishingBoard, type FishingBoard } from "@/lib/game/fishing/rpc";
import { baitTotal, castWaitMin, digWaitSec, handFish, type Loadout } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";
```

**hooks/useFishingController.ts — edit 2 of 6.** Replace:

```ts
  closePanel: () => void;
  /** Handles the pond's interactables; false for anything else. */
```

with:

```ts
  closePanel: () => void;
  /** A panel action (buy, sell, equip, release) is in flight. */
  busy: boolean;
  sell: (fishIds: string[]) => void;
  release: (fishId: string) => void;
  buy: (itemId: string, qty: number) => void;
  equip: (loadout: Loadout) => void;
  /** fishing_board for this room (the records panel). */
  loadBoard: () => Promise<FishingBoard>;
  /** Handles the pond's interactables; false for anything else. */
```

**hooks/useFishingController.ts — edit 3 of 6.** Replace:

```ts
  const session = useCastSession({ roomId, data, canvas, toast });
  const { state, failed, catalog, reload, claimDaily, dig } = data;
  const [panel, setPanel] = useState<FishingPanel | null>(null);
```

with:

```ts
  const session = useCastSession({ roomId, data, canvas, toast });
  const { state, failed, catalog, reload, claimDaily, dig, sell: sellFish, release: releaseFish, buy: buyItem, equip: setLoadout } = data;
  const [panel, setPanel] = useState<FishingPanel | null>(null);
```

**hooks/useFishingController.ts — edit 4 of 6.** Replace:

```ts

  const interact = useCallback((it: Interactable): boolean => {
```

with:

```ts

  // --- the depot, the shop, the records board and the bag
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (job: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await job();
    } finally {
      setBusy(false);
    }
  }, []);
  const sell = useCallback((ids: string[]) => void run(async () => {
    const r = await sellFish(ids);
    if (r) toastRef.current(saleText(r.sold, r.earned));
  }), [run, sellFish]);
  const release = useCallback((id: string) => void run(() => releaseFish(id)), [run, releaseFish]);
  const buy = useCallback((itemId: string, qty: number) => void run(async () => {
    const name = catalog?.items.find((i) => i.id === itemId)?.name ?? itemId;
    if (await buyItem(itemId, qty)) toastRef.current(`🛒 Đã mua ${name}${qty > 1 ? ` × ${qty}` : ""}.`);
  }), [run, buyItem, catalog]);
  const equip = useCallback((l: Loadout) => void run(() => setLoadout(l)), [run, setLoadout]);
  const loadBoard = useCallback(() => fetchFishingBoard(roomId, token), [roomId, token]);

  const interact = useCallback((it: Interactable): boolean => {
```

**hooks/useFishingController.ts — edit 5 of 6.** Replace:

```ts
        fishAt(it);
        return true;
```

with:

```ts
        fishAt(it);
        return true;
      case "depot":
      case "shop":
      case "records":
        setPanel(it.kind);
        return true;
```

**hooks/useFishingController.ts — edit 6 of 6.** Replace:

```ts
    closePanel: useCallback(() => setPanel(null), []),
    interact,
```

with:

```ts
    closePanel: useCallback(() => setPanel(null), []),
    busy,
    sell,
    release,
    buy,
    equip,
    loadBoard,
    interact,
```

**components/game/fishing/FishingOverlays.tsx — edit 1 of 2.** Replace:

```tsx
import type { FishingController } from "@/hooks/useFishingController";
import CatchCard from "./CatchCard";
import ReelOverlay from "./ReelOverlay";

/** The cast's HUD (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the catch card. */
export default function FishingOverlays({ fishing }: { fishing: FishingController }) {
  const { cast, caught } = fishing;
  const catalog = fishing.data.catalog;
  const name = caught ? catalog?.species.find((s) => s.id === caught.fish.speciesId)?.name ?? caught.fish.speciesId : "";
```

with:

```tsx
import type { FishingController } from "@/hooks/useFishingController";
import BagPanel from "./BagPanel";
import CatchCard from "./CatchCard";
import DepotPanel from "./DepotPanel";
import RecordsPanel from "./RecordsPanel";
import ReelOverlay from "./ReelOverlay";
import ShopPanel from "./ShopPanel";

/** Fishing on top of the world (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the
 *  catch card and the four fishing panels. */
export default function FishingOverlays({ fishing }: { fishing: FishingController }) {
  const { cast, caught, panel, busy, closePanel } = fishing;
  const { state, catalog } = fishing.data;
  const name = caught ? catalog?.species.find((s) => s.id === caught.fish.speciesId)?.name ?? caught.fish.speciesId : "";
```

**components/game/fishing/FishingOverlays.tsx — edit 2 of 2.** Replace:

```tsx
      {caught && <CatchCard fish={caught.fish} name={name} record={caught.record} onClose={fishing.dismissCatch} />}
    </>
```

with:

```tsx
      {caught && <CatchCard fish={caught.fish} name={name} record={caught.record} onClose={fishing.dismissCatch} />}
      {panel === "bag" && (
        <BagPanel state={state} catalog={catalog} busy={busy} onEquip={fishing.equip} onRelease={fishing.release} onClose={closePanel} />
      )}
      {panel === "depot" && <DepotPanel state={state} catalog={catalog} busy={busy} onSell={fishing.sell} onClose={closePanel} />}
      {panel === "shop" && <ShopPanel state={state} catalog={catalog} busy={busy} onBuy={fishing.buy} onClose={closePanel} />}
      {panel === "records" && <RecordsPanel catalog={catalog} load={fishing.loadBoard} onClose={closePanel} />}
    </>
```

**components/game/GameShell.tsx — edit 1 of 3.** Replace:

```tsx

  // --- input is off while any panel or the create editor is open
  const blocking = panel !== null || creating;
  useEffect(() => {
    canvasRef.current?.setInputEnabled(!blocking);
  }, [blocking]);

  // --- fishing: coins, bait, the daily check-in, the song bonus, digging (and, later, casting and the shops)
```

with:

```tsx

  // --- fishing: coins, bait, the daily check-in, the song bonus, digging (and, later, casting and the shops)
```

**components/game/GameShell.tsx — edit 2 of 3.** Replace:

```tsx
  const { interact: fishingInteract, promptText, cancelCast, onFishingInput } = fishing;
```

with:

```tsx
  const { interact: fishingInteract, promptText, cancelCast, onFishingInput } = fishing;

  // --- input is off while any panel or the create editor is open
  const blocking = panel !== null || fishing.panel !== null || creating;
  useEffect(() => {
    canvasRef.current?.setInputEnabled(!blocking);
  }, [blocking]);
```

**components/game/GameShell.tsx — edit 3 of 3.** Replace:

```tsx
            {!connected && <span className="text-base opacity-80">Đang kết nối thế giới…</span>}
            <button type="button" className="pch-btn self-start" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
              👕 Tủ đồ
            </button>
            <FishingHud state={fishing.data.state} failed={fishing.data.failed} onReload={() => void fishing.data.reload()} />
```

with:

```tsx
            {!connected && <span className="text-base opacity-80">Đang kết nối thế giới…</span>}
            <div className="flex gap-1">
              <button type="button" className="pch-btn" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
                👕 Tủ đồ
              </button>
              <button type="button" className="pch-btn" onClick={() => fishing.openPanel("bag")}>🎒 Giỏ đồ</button>
            </div>
            <FishingHud state={fishing.data.state} failed={fishing.data.failed} onReload={() => void fishing.data.reload()} />
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm vitest run` → all green.
Run: `npx tsc --noEmit` and `npx eslint hooks/useFishingController.ts components/game tests/unit/fishing-panels.test.tsx` → clean.

- [ ] **Step 6: Commit**

```bash
git add components/game/fishing hooks/useFishingController.ts components/game/GameShell.tsx tests/unit/fishing-panels.test.tsx
git commit -m "feat(v14): bag, fish depot, tackle shop and records board

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Catch announcements — a system line in the classic chat, toasts in the game

**Files:**
- Modify: `components/room/ChatMessageItem.tsx`, `components/game/GameShell.tsx`
- Test: `tests/unit/chat-catch-line.test.tsx`

**Interfaces:**
- Consumes: `parseCatchAnnouncement`, `freshAnnouncements` (Task 4).
- Produces: `ChatMessageItem` renders a server catch message as a centred italic line (no avatar, no reply; ✕ only when `canDelete`, i.e. for the room admin). The early return comes **after** every hook of the component (rules of hooks). `GameShell` toasts other members' rare catches from the chat (`freshAnnouncements`, at most 30 s old, each once); my own catch shows the catch card instead.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chat-catch-line.test.tsx`:

```tsx
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ChatMessageItem from "@/components/room/ChatMessageItem";
import type { ChatMessage } from "@/lib/chat";

afterEach(cleanup);

const ACC = "0b6a4c3e-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
const BODY = `[catch:${ACC}|ca_tra|3150] 🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!`;
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: "Ao cá", body: BODY, created_at: "2026-09-24T10:00:00Z", ...over,
});
const renderItem = (message: ChatMessage, canDelete: boolean, onDelete = vi.fn()) => {
  render(
    <ChatMessageItem message={message} allMessages={[message]} currentAccountId="me" members={[]} canDelete={canDelete}
      onReply={() => {}} onDelete={onDelete} onJumpToReply={() => {}} />,
  );
  return onDelete;
};

describe("ChatMessageItem — catch announcements", () => {
  it("shows a server catch as a system line without reply, and lets the admin delete it", () => {
    const onDelete = renderItem(msg({}), true);
    expect(screen.getByText("🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!")).toBeInTheDocument();
    expect(screen.queryByTitle("Trả lời tin nhắn")).toBeNull();
    expect(screen.queryByTitle("Ao cá")).toBeNull(); // no avatar
    fireEvent.click(screen.getByTitle("Xóa tin nhắn"));
    expect(onDelete).toHaveBeenCalledWith("m1");
  });
  it("hides the delete button from members", () => {
    renderItem(msg({}), false);
    expect(screen.queryByTitle("Xóa tin nhắn")).toBeNull();
  });
  it("renders a member typing the prefix as a normal message", () => {
    renderItem(msg({ account_id: ACC, username: "Dat" }), false);
    expect(screen.getByTitle("Trả lời tin nhắn")).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/chat-catch-line.test.tsx`
Expected: FAIL — the announcement renders as a normal message with a reply button.

- [ ] **Step 3: Render the system line**

**components/room/ChatMessageItem.tsx — edit 1 of 3.** Replace:

```tsx
import { parseChatMessageBody, MENTION_REGEX } from "@/lib/chat-helpers";
import type { Member, Room } from "@/lib/supabase";
```

with:

```tsx
import { parseChatMessageBody, MENTION_REGEX } from "@/lib/chat-helpers";
import { parseCatchAnnouncement } from "@/lib/game/fishing/announce";
import type { Member, Room } from "@/lib/supabase";
```

**components/room/ChatMessageItem.tsx — edit 2 of 3.** Replace:

```tsx
  const isMe = !!message.account_id && message.account_id === currentAccountId;
```

with:

```tsx
  const isMe = !!message.account_id && message.account_id === currentAccountId;
  // A rare catch posted by the server (v14): a system line — no avatar, no reply; the room admin may still delete it.
  const announcement = useMemo(() => parseCatchAnnouncement(message), [message]);
```

**components/room/ChatMessageItem.tsx — edit 3 of 3.** Replace:

```tsx
  }, [text, currentUsername, onMentionUser]);
```

with:

```tsx
  }, [text, currentUsername, onMentionUser]);

  if (announcement) {
    return (
      <div
        id={`chat-msg-${message.id}`}
        className={`group relative flex items-center justify-center gap-2 rounded-xl px-2.5 py-1.5 text-center ${
          isHighlighted ? "bg-gold-200/50 ring-2 ring-gold" : ""
        }`}
      >
        <p className="text-xs italic leading-relaxed text-burgundy font-serif">{announcement.text}</p>
        {timeFormatted && <span className="text-[10px] text-ink/40 font-mono">{timeFormatted}</span>}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            className="rounded p-1 text-xs text-burgundy-accent opacity-0 transition-opacity hover:bg-burgundy/10 group-hover:opacity-100"
            title="Xóa tin nhắn"
          >
            ✕
          </button>
        )}
      </div>
    );
  }
```

- [ ] **Step 4: Toast rare catches in the game**

**components/game/GameShell.tsx — edit 1 of 2.** Replace:

```tsx
import { formatClock } from "@/lib/format";
import { DEFAULT_LOOK } from "@/lib/game/look";
```

with:

```tsx
import { formatClock } from "@/lib/format";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
import { DEFAULT_LOOK } from "@/lib/game/look";
```

**components/game/GameShell.tsx — edit 2 of 2.** Replace:

```tsx
  }, [messages]);
```

with:

```tsx
  }, [messages]);

  // --- rare catches the server announced in the chat (my own catch shows the catch card instead)
  const announcedRef = useRef(new Set<string>());
  useEffect(() => {
    for (const { id, announcement } of freshAnnouncements(messages, announcedRef.current, Date.now())) {
      announcedRef.current.add(id);
      if (announcement.accountId !== accountId) showToast(announcement.text);
    }
  }, [messages, accountId, showToast]);
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `pnpm vitest run` → all green.
Run: `npx tsc --noEmit` and `npx eslint components/room/ChatMessageItem.tsx components/game/GameShell.tsx tests/unit/chat-catch-line.test.tsx` → clean.

- [ ] **Step 6: Commit**

```bash
git add components/room/ChatMessageItem.tsx components/game/GameShell.tsx tests/unit/chat-catch-line.test.tsx
git commit -m "feat(v14): rare-catch announcements in the chat and as game toasts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: README, full verification and the manual pass

**Files:**
- Modify: `README.md` (append the v14 section)

**Interfaces:**
- Consumes: everything above.
- Produces: documentation only.

- [ ] **Step 1: Append the v14 section to `README.md`**

**README.md.** Append at the end of the file, after a blank line:

```markdown
## v14: Ao câu cá — câu cá, xu và cửa hàng

### DB migration

`supabase/migrations/0012_v14_fishing.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop policy/trigger if exists`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor after `0011`. It adds the catalog tables `fish_species` (12 species) and `shop_items` (12 items), which everyone may read; the private per-account tables `wallets`, `coin_ledger` (append-only), `inventory`, `fishing_profiles`, `casts`, `fish` and `personal_bests`, which only the RPCs touch; the RPCs `fishing_state`, `claim_daily`, `dig_worms`, `buy_item`, `set_loadout`, `start_cast`, `finish_cast`, `sell_fish`, `release_fish` and `fishing_board`; and the column `rooms.item_began_at` with two triggers for the song bonus. `tests/sql/v14-smoke.sql` checks all of it on a throwaway PostgreSQL cluster.

### What's new in v14

- **🎣 Ao cá:** walk down the hall's dock to **Bến câu cá** and press **E** — the screen fades to a Miền Tây fishing pond with a plank platform, a worm patch, **Vựa cá** (cô Ba) and **Tiệm đồ câu** (chú Tư). **Bến vào** takes you back to the hall. The chip at the top shows **🎵 Sảnh N · 🎣 Ao cá N**; tap it for the names. Music, chat and reactions stay room-wide on both maps.
- **Worms:** press **E** at a mound in **Bãi trùn** for 1–3 **Trùn đất**, once every 45 s. The bait box holds 20 baits (60 with **Hộp mồi**).
- **Fishing:** stand on one of the six spots on the platform and press **E** (or tap the water in front of it). When **❗** shows, hook with **Space**, a click/tap or **❗ Giật cần!** before the bobber's window closes (1.5–2.5 s). Then hold the mouse, a touch or **Space** to keep the fish inside the green zone until the bar fills. **🎣 Thu cần** / **Esc** gives the cast up (the bait is lost). You can cast 40 times per hour.
- **Fish:** 12 species in 5 rarities (Thường, Khá, Hiếm, Quý, Huyền thoại); the price is set by the weight. You hold one fish in your hand — everyone sees it — and a bucket holds 5 (**Xô nhỏ**) or 15 more (**Xô lớn**). Rare+ catches are announced in the room chat.
- **Shops:** cô Ba buys fish (**Bán** / **Bán hết**). Chú Tư sells rods (a bigger zone, heavier fish, more rare fish), bobbers (a longer bite window, faster bites, the rarity shown at the bite), bait (more rare fish), the bait box and buckets. **🎒 Giỏ đồ** lists your fish and gear and switches rod, bobber and bait. **Bảng kỷ lục** shows the room's record per species next to your best, and the room's richest members.
- **Xu:** +20 for the daily check-in (your first game visit of the Vietnam day), +10 when a song of 60 s or more that you queued stays current for at least 75 % of its length (up to 10 a day), and fish sales. With worms and the wooden rod an average cast is worth about 46 xu, so a skilled angler earns about 1 000–1 800 xu an hour: **Cần tre** (300 xu) takes about 20 minutes, **Cần carbon** (1 500 xu) 1–2 hours.
- Also: the camera scrolls the character above the bottom HUD, the now-playing card folds into a one-line chip on phones, the game falls back to the classic view if its frame loop keeps failing, and chat bubbles never cut an emoji in half.

### Trust model

The server decides the species, weight, rarity and bite delay of every cast; all prices, capacities and balances; the hourly cast cap, the dig cooldown, the reel time gate and single-use casts. Three things are **not** verified: whether the minigame was really won (a modified client can report a win, but no faster than the time gate and no more than 40 fish an hour); where the player stands (selling, buying and digging work from anywhere); and the visuals — the fishing state and catch labels over heads come from the clients. Only the chat announcement comes from the server.

### Realtime budget (v14)

Each map has its own Broadcast channel `game:{roomId}:{mapId}`, so a room split across the hall and the pond costs N_hall² + N_pond² deliveries instead of N². A cast sends at most four `fs` messages (cast, bite, reel, end); casts are at least 6 s apart and capped at 40 an hour, so an angler sends at most 0.7 messages/s and typically about 0.1. Selling or releasing a fish adds one. A map switch costs one presence track, taken from the same budget as view-mode changes (at most 4 per 30 s), and a rare+ catch costs one chat insert.
```

- [ ] **Step 2: Run the whole verification**

```bash
pnpm test
npx tsc --noEmit
pnpm lint
pnpm build
```

Expected: `pnpm test` → 64 files passed / 9 skipped, 423 tests passed (293 at the baseline + 130 new; the integration tests skip without `SUPABASE_TEST_URL`); `tsc` clean; `pnpm lint` → exactly the **17 pre-existing errors** (none in a file this plan touched); `pnpm build` succeeds. Then replay the SQL once more (Task 2 Step 3, fresh cluster, `export PGCLIENTENCODING=UTF8`): `0012 re-run ok` and `v14 smoke ok`.

- [ ] **Step 3: Manual pass (in-app browser; the owner runs `0012` in the Supabase SQL editor first and logs in both accounts — never type passwords)**

Use two browser tabs or the owner's second device, accounts A and B, in the same room, and tick each item:

1. Hall ↔ pond both ways for A; B sees A leave the hall and arrive at the pond; the map-count chip updates on both clients.
2. A's first game visit of the day shows "🪙 Điểm danh hôm nay: +20 xu" once (reload: no second toast).
3. Dig: 1–3 worms and "🪱 Đào được N trùn đất!", the prompt counts down "Đào trùn (còn N giây)", a full bait box says "Hộp mồi đầy rồi."
4. Cast → bite → reel → catch card; B sees A's line and bobber, the ❗, the bent rod, the catch label and then the fish in A's hand.
5. A missed bite ("Cá ăn mồi rồi chạy mất!"), **Thu cần** ("Đã thu cần."), and "Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!" when casting with a fish in hand and no bucket.
6. Shop: buy 5 Mồi tép, a Phao xốp (its bobber turns the rarity colour at the bite), a Xô nhỏ; an expensive item shows "Không đủ xu".
7. Depot: sell one, then **Bán hết**; the fish disappears from A's hand on B's screen.
8. A rare+ catch shows the system line in B's classic chat and a toast in B's game view.
9. **Bảng kỷ lục**: both tabs load.
10. A ≥ 60 s song queued by B plays through → B gets "🎵 Bài bạn gọi đã phát xong: +10 xu" and +10 xu.
11. Phone viewport (`resize_window` preset `mobile`, then `desktop`): tap to cast, **❗ Giật cần!**, hold-to-reel, the panels, the folded now-playing chip.
12. A member in the classic view is seated in the hall and absent from the pond.

Record anything that fails as a finding for the final review; do not skip items silently.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(v14): README — fishing pond, economy, trust model, realtime budget

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
