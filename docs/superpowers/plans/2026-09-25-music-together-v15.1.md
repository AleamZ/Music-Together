# Music Together v15.1 — "Ruộng lúa" (field, land, rice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a third game map — one shared rice field per room, reached from the hall and the pond — where members rent village plots or buy private ones, trade land with each other, and grow wet rice through a realistic, server-timed season (prepare, soak, sow, transplant, fertilize, keep the water right, fight pests, harvest, dry, sell), with a co-op office, a farm shop, a rice depot, a drying yard, a handbook and a due-task list.

**Architecture:** Postgres owns time and truth (migration `0013`): every rule is a private `_farm_do_*` function that takes `p_now`, and each public SECURITY DEFINER RPC passes `now()` and answers with the room's whole `field_state` (or just the account part, `mine`). A crop is evaluated lazily from its logs (water, fertilizer, sprays, snail picks) and three hidden pest rolls; `lib/game/farm/crop.ts` mirrors the SQL crop model bit for bit (shared fixtures pin both) for the plot panel's estimate and the due tasks. The client adds pure modules under `lib/game/farm/`, the field map and painter under `lib/game/maps/`, crop art, farm icons and farm animations under `lib/game/art/`, the `useField` and `useFarmController` hooks, and parchment panels under `components/game/farm/`. The field has its own Broadcast channel with two new control messages: `fp` (a plot changed — fetch again) and `fa` (a farm animation).

**Tech Stack:** Next.js 16.2.9 (App Router, client components), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom + RTL, pnpm 11, PostgreSQL 18 (local throwaway cluster for migration checks).

**Spec:** `docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md` — this plan implements phase **v15.1** only (§4); v15.2 (minigames, crabs and snails) gets its own plan. Read the spec before starting any task. The v14 plan (`docs/superpowers/plans/2026-09-24-music-together-v14.md`) describes the fishing code this plan extends.

## Global Constraints

- Work on branch `feat/v15-field` (already created, in place — no worktree). Commit after every task. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Package manager **pnpm** (`pnpm test`, `pnpm lint`, `pnpm build`). Typecheck: `npx tsc --noEmit`. Single test file: `pnpm vitest run tests/unit/<file>.test.ts`.
- Baseline before v15 (branch head `4851d0c`): `pnpm test` → 70 files passed / 9 skipped (502 tests passed / 54 skipped); `npx tsc --noEmit` clean; `pnpm lint` has **54 pre-existing problems (36 errors, 18 warnings)**, none in a file this plan creates or modifies. Every file you create or modify must lint clean: `npx eslint <your files>`.
- Before using any Next.js API read the matching guide in `node_modules/next/dist/docs/` (`AGENTS.md`).
- React hook lint rules (eslint-plugin-react-hooks 7): no `ref.current` reads/writes during render, no synchronous `setState` directly in an effect body (callbacks, timers, `requestAnimationFrame` and async continuations are fine), no `Date.now()` / `Math.random()` / `performance.now()` during render. A callback parameter must not be named `use` (the linter takes it for React's `use`).
- Pure logic lives in `lib/` with Vitest tests in `tests/unit/`. Browser-only code (canvas, `document`, `window`) is never imported by a pure module. Pure modules that tests import must not import `@/lib/supabase` unless the test mocks it.
- **Server time rules:** every time rule lives in a private SQL function that takes `p_now`; the public RPCs pass `now()`. Tests move time by calling the private functions. The client never sends a time. Countdowns on the client use `serverNow()` from `lib/game/farm/clock.ts` (`Date.now()` + the offset every answer's `server_now` sets).
- **The crop model has two implementations** (SQL section D, `lib/game/farm/crop.ts`) that must agree to the last bit on `tests/fixtures/crop-cases.json`: the same double-precision operations in the same order, times cut to whole seconds (`_plus_h` / `plusH`), water sampled every 15 min, the minimum yield in integer math (`(base + 9) / 10` in SQL, `Math.ceil(base / 10)` in TS).
- Realtime: every game message goes through the send gate (≤ 3 msgs/s, movement coalesced). `fp` and `fa` are **control** messages (FIFO, never dropped). A land or farm action sends at most one `fa` and one `fp`.
- All art is original and drawn in code (string grids / procedural painters). Never copy images from any game.
- The field map is 800 × 480 world px, collision cell 8 px; characters are 24 × 48 anchored at the feet (drawn at `x-12, y-46`); `PROMPT_RANGE` 26 px.
- UI copy is Vietnamese; use the strings given in the tasks verbatim. Numbers: `vi-VN` (`1.230 xu`); weights in whole kg.
- SQL is additive and re-runnable (`create … if not exists`, `create or replace`, `drop … if exists`, seeds with `on conflict (id) do update`) with explicit grants and revokes. The owner runs migrations in the Supabase SQL editor — never against a hosted database from here.
- Local PostgreSQL: **never touch the installed PostgreSQL 18 service** (its password is unknown). Use a throwaway cluster with `initdb --auth=trust` on port **5499** in the session scratchpad, and **always `export PGCLIENTENCODING=UTF8`** before running `psql`. Run the smoke test from the **repo root** (it reads `tests/fixtures/crop-cases.json` with `\copy`).
- The repo is public: never commit passwords, tokens or copyrighted assets.
- Vitest runs without globals, so Testing Library does not clean up by itself: every component or hook test file calls `afterEach(cleanup)` (or `cleanup()` inside its existing `afterEach`).
- Hooks that drive the canvas take a getter `canvas: () => GameCanvasHandle | null`, never a ref object (React Compiler lint).
- Never type a password (account or room) in the browser. Manual checks need the owner to log in, and the field needs `0013` on the owner's database.

## Rulings (decisions where the spec is silent, ambiguous or self-contradictory)

- **Lock order:** field RPCs lock the room's 10 plot rows `for update` (via `_field_open`) *before* any wallet row. The spec says "wallet lock first"; plots first avoids deadlocks when a sale or a sublease pays another account.
- **Soaking** may start before the plot is prepared (spec §8.2); sowing still needs a prepared plot.
- **Water gates:** sowing needs Ẩm (1), transplanting needs Nông (2), harvesting needs ≤ Ẩm; otherwise `need water`.
- **Harvest ends any lease** (village or owner source).
- **A re-offer** by the same buyer on the same plot replaces the old offer with a new id.
- **Accepting an offer** re-checks the buyer (still a member, owns no land here, under the farming limit, enough xu) → `buyer cannot buy`.
- **Picking snails** needs an active snail on the plot → `no snails`. A water log is capped at 200 entries → `too fast`.
- **`rent_sublease`** also clears a sale listing; **preparing or soaking** on one's own plot withdraws its listing and sublease price (spec §7.3).
- **Ripe after:** `ripeAfterHours = round(2 + 56·s)` (52 / 58 / 66 h). The spec's §8.1 table (≈ 54 / 60 / 69 h) contradicts its own formula; the formula wins.
- **NPC looks** (chú Tám, anh Hai, cô Út) use existing catalog items; no new clothing rows.
- **The farm catalog** (varieties and farm items) is read from the database, not duplicated as constants; land numbers (250, 4 000, 2 000, 96 h, …) are constants in `lib/game/farm/catalog.ts` that mirror 0013.
- **The yield estimate is optimistic** for windows that are still open (base fertilizer before transplanting, each top-dress until its window closes, phơi ruộng until T = 18·s) and cannot count hidden pests.
- **Signs:** the field's east portal sign stands at (784, 240) (the spec's (776, 250) is on the road); the hall's "Ra đồng" sign at (40, 232) (the spec's (40, 250) sits under a palm crown).
- **Extra error codes** beyond spec §11.7: `buyer cannot buy`, `no snails`, `no crop`, `invalid plot|item|work|slot|variety`; each has a Vietnamese text in `farmErrorMessage`.
- **v14 regression fix:** `fetchFishingCatalog` reads only fishing kinds from `shop_items` (farm items share the table, and `shopItemFromRow` maps unknown kinds to bait). The v14 integration test counts fishing kinds only.
- **Presence stays exhaustive:** `KNOWN_MAPS: Record<MapId, true>`; an unknown map from an old client counts as the hall. The registry's `build` / `paint` are exhaustive switches.
- **Handbook text** lives in `lib/game/farm/handbook.ts` (spec §8.9 says `messages.ts`): it is a page of structured text with per-variety timings, and keeps `messages.ts` to toasts and errors.
- **Progress actions:** only transplanting and harvesting run the 3-second progress (`begin_work`, 3 s, then the action with quality 1.0; spec §4); input is locked meanwhile and "Huỷ" / Esc cancels before anything is sent. Every other farm action is instant and plays a 2.5 s animation.
- **`fp` numbers:** a plot action sends its plot; drying and offer actions send `p = 0`.
- **The HUD wallet** stays the fishing state's coins; the farm controller asks it to refetch whenever the field's `mine.coins` changes.
- **The fishing clock fix** (spec §11.6): `FishingState.serverNow` is parsed; `useFishing` sets the shared clock (the parser stays pure); the fishing controller passes `serverNow()` to `castRefusal`, `digWaitSec` and its prompt clock.
- **Name posts** read `N · <name>`: the owner of a private plot, the farmer of a village plot, else `đất bán` / `đất trống`.
- **The newcomer gift** is claimed once per session, on the first field visit whose state shows `gift_claimed: false`.
- **Land announcements** are parsed in `lib/game/fishing/announce.ts` next to the catch line (`parseAnnouncement` covers both prefixes, each with its own author name).

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0013_v15_field.sql` | varieties, farm items, field tables, the crop model, the field views and sweep, land RPCs, farming / drying / trade RPCs |
| `tests/sql/v15-smoke.sql`, `tests/fixtures/crop-cases.json` | smoke test for the throwaway cluster; crop timelines with expected yields (shared with the TS tests) |
| `lib/game/farm/catalog.ts` | pure: varieties, farm items, land constants, `ricePrice`, `ripeAfterHours`, `describeFarmItem` |
| `lib/game/farm/clock.ts` | the server clock offset: `syncClock`, `serverNow`, `clockOffset` |
| `lib/game/farm/state.ts` | pure: `field_state` / `mine` parsers and types |
| `lib/game/farm/crop.ts` | pure: the crop model mirror (phases, water, care, pests, yield, estimate, timetable) |
| `lib/game/farm/messages.ts` | pure: Vietnamese names, texts and `farmErrorMessage`, `isMissingRpc` |
| `lib/game/farm/rpc.ts` | Supabase wrappers: catalog, `field_state`, `fieldAction`, rice / shop / gift |
| `lib/game/farm/land.ts` | pure: land rules — who farms, why a land action is refused |
| `lib/game/farm/actions.ts` | pure: the plot panel's actions, fertilizer advice, due tasks, plot prompts |
| `lib/game/farm/handbook.ts` | pure: Sổ tay nhà nông pages |
| `lib/game/fishing/catalog.ts`, `rpc.ts`, `state.ts`, `announce.ts` (mod) | fishing kinds only; `server_now`; land announcements |
| `lib/game/maps/types.ts`, `arrivals.ts`, `props.ts`, `registry.ts`, `hall.ts`, `pond.ts` (mod) | `field` map id, plots, new interactables and props, portals |
| `lib/game/maps/field.ts`, `field-art.ts` | the field layout + collision; its painter |
| `lib/game/look.ts` (mod) | NPC looks for chú Tám, anh Hai, cô Út |
| `lib/presence-modes.ts`, `components/game/MapCounts.tsx` (mod) | presence map `field`, 🌾 Đồng chip |
| `lib/game/art/crops.ts` | plot looks, labels and the crop painters |
| `lib/game/art/farm-icons.ts`, `icons.ts` (mod) | 16×16 farm icons through `iconMatrixFor` |
| `lib/game/art/farm-anim.ts` | farm animations over a character |
| `lib/game/net/protocol.ts`, `lib/game/world.ts` (mod) | `fp` / `fa` messages; remote farm animations |
| `lib/game/engine.ts`, `components/game/GameCanvas.tsx` (mod) | plots, labels, urgent rings, farm animations; handle `setPlots` / `farmAnim` / `plotChanged` |
| `hooks/useField.ts` | field state + catalog, actions, `fp` refetch, the missing-migration flag |
| `hooks/useFarmController.ts` | everything farming for the shell: prompts, panels, due tasks, plots, gift, animations, work progress |
| `components/game/farm/*` | `CoopPanel`, `FarmShopPanel`, `RiceDepotPanel`, `DryingPanel`, `PlotPanel`, `Handbook`, `FarmTasks`, `FarmOverlays`, `FieldStatus`, `Stepper`, `ConfirmButton` |
| `components/game/GameShell.tsx`, `fishing/FishingHud.tsx` (mod) | farm wiring; the rice line on the field |
| `hooks/useFishing.ts`, `hooks/useFishingController.ts` (mod) | the server clock for fishing |
| `lib/supabase.ts`, `components/room/RoomSession.tsx` (mod) | `touchRoom`, called once per room visit |
| `components/room/ChatMessageItem.tsx`, `lib/chat-notify.ts` (mod) | land sales as system lines and notifications |
| `README.md` (mod) | v15 section |
| `tests/integration/v15.test.ts`, `v14.test.ts` (mod) | end-to-end RPC checks (skipped without `SUPABASE_TEST_URL`) |

## Plan conflict scan (pre-flight, done by the plan author)

- **Validated end to end.** The plan author implemented every task in the working tree of this branch (tsc clean, `pnpm test` 87 files / 643 tests passed, lint at the 54 baseline problems) and generated the code blocks of Tasks 4–18 from per-task snapshots of that implementation; a mechanical replay of this document on a clean checkout of `4851d0c` reproduced the same files, with tsc and each task's tests green after every task. If an edit's "old" text is not found, re-read the file — do not improvise a different change.
- **The SQL of Tasks 1–3** was run on a throwaway PostgreSQL 18 cluster in all three states (after Task 1: sections A–D; after Task 2: A–F; after Task 3: all), each state twice, followed by its part of the smoke test: every assertion passed.
- **Crop mirror:** `tests/fixtures/crop-cases.json` holds 14 timelines whose expected kilograms and factors were computed by the SQL model; Task 5's TS model reproduces all of them exactly.
- Tasks that touch the same file do so in order: `hall.ts` / `pond.ts` (Task 8 adds `plots: []`, Task 9 the portals), `engine.ts` / `GameCanvas.tsx` (Task 10 plots, Task 12 farm messages), `actions.ts` / `messages.ts` (Tasks 6–7 create, 14 and 17 extend), `GameShell.tsx` (Task 9 the field card and background, Task 17 the farm wiring, Task 18 the land toasts), `CoopPanel.tsx` (Task 15 exports `LandButton` and `MyPlot`, which Task 16's `PlotPanel` reuses). Each task's edit blocks are generated against the file as the previous task left it.
- Spec §8.9's six handbook tabs, §13.1's HUD, §13.2's prompts and §13.3's four panels are all covered (Tasks 14–17); §14's crab and snail icons and the container icons are v15.2.

---

### Task 1: Database — catalog, field tables, the v14 changes and the crop model

**Files:**
- Create: `supabase/migrations/0013_v15_field.sql` (sections A–D; Tasks 2–3 append E–G)
- Create: `tests/fixtures/crop-cases.json`
- Create: `tests/sql/v15-smoke.sql` (setup + the crop model; Tasks 2–3 append)

**Interfaces:**
- Produces (Postgres): public-read table `rice_varieties` (`short`, `nep`, `thom`); `shop_items` columns `variety`, `fert`, `pest_target` and 11 farm rows (`seed_short`, `seed_nep`, `seed_thom`, `fert_manure`, `fert_phosphate`, `fert_urea`, `fert_potash`, `fert_npk`, `spray_insect`, `spray_hopper`, `spray_fungus`); `coin_ledger` reasons `land_buy`, `land_sell`, `land_refund`, `lease_pay`, `lease_income`, `farm_buy`, `rice_sell`; `members.last_seen_at`; private tables `field_plots`, `plot_leases`, `land_offers`, `crops`, `drying_slots`, `rice_stock`, `farm_profiles`; `buy_item` refuses non-fishing kinds (`item not available`); `_fishing_state` lists only fishing gear and carries `server_now`; private crop-model functions `_variety(text)`, `_hrs`, `_plus_h`, `_water_at(jsonb, timestamptz)`, `_crop_phase(crops, rice_varieties, timestamptz) → text`, `_water_ok`, `_water_off_hours`, `_excess_n`, `_crop_care(crops, rice_varieties) → {manure, phosphate, td1, td2, phoi, excess}`, `_crop_pests(crops, rice_varieties, timestamptz) → [{slot, kind, since, treated_at}]`, `_pest_hours`, `_crop_yield(crops, rice_varieties, land, q_harvest, timestamptz) → {kg, mcare, mseed, mwater, mpest, mlate}`.
- Produces (fixture): `tests/fixtures/crop-cases.json` — `{ t0, cases: [{ name, variety, land, q_transplant, q_harvest, soak, sow, transplant, harvest, water: [[h, level]], fert: [[h, item]], spray: [[h, item]], picks: [h], pest_rolls, expect: { kg, mcare, mseed, mwater, mpest, mlate, pests: [{ kind, since_s, treated_s }] } }] }` (hours after `t0`). Task 5's TS tests import it.

- [ ] **Step 1: Write the migration (sections A–D)**

Create `supabase/migrations/0013_v15_field.sql` with exactly:

```sql
-- =========================================================
-- 0013_v15_field.sql — v15.1 "Ruộng lúa": the field map's land (village rent, private plots, player sales,
-- subleases, reclaim), the rice cycle (soak → seedbed → transplant → top-dress → water → pests → harvest),
-- drying, selling and the farm shop. Also: the v14 buy_item kind guard and server_now in _fishing_state (M-3).
-- ADDITIVE (no data drop) and re-runnable. Every function relies on `set search_path = public, extensions`.
-- Time rules live in private functions that take p_now; the public RPCs pass now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Config, catalog and account tables ----------
create table if not exists public.rice_varieties (
  id text primary key,
  name text not null,
  scale double precision not null check (scale > 0),
  base_kg integer not null check (base_kg > 0),
  price_per_kg integer not null check (price_per_kg > 0),
  blast_mult double precision not null default 1,
  sort_order integer not null default 0
);
alter table public.rice_varieties enable row level security;
drop policy if exists rice_varieties_select on public.rice_varieties;
create policy rice_varieties_select on public.rice_varieties for select to anon using (true);
grant select on public.rice_varieties to anon, authenticated;

insert into public.rice_varieties (id, name, scale, base_kg, price_per_kg, blast_mult, sort_order) values
  ('short', 'Lúa ngắn ngày', 0.9,  90, 12, 1.0, 10),
  ('nep',   'Nếp',           1.0,  75, 18, 1.0, 20),
  ('thom',  'Lúa thơm',      1.15, 60, 26, 1.3, 30)
on conflict (id) do update set
  name = excluded.name, scale = excluded.scale, base_kg = excluded.base_kg, price_per_kg = excluded.price_per_kg,
  blast_mult = excluded.blast_mult, sort_order = excluded.sort_order;

-- Farm items share the v14 catalog (and the inventory) with three new columns.
alter table public.shop_items add column if not exists variety text references public.rice_varieties(id);
alter table public.shop_items add column if not exists fert text check (fert in ('manure','phosphate','urea','potash','npk'));
alter table public.shop_items add column if not exists pest_target text check (pest_target in ('insect','hopper','fungus'));
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box'));

insert into public.shop_items (id, kind, name, price, starter, sort_order, variety, fert, pest_target) values
  ('seed_short',     'seed',       'Giống lúa ngắn ngày',  60, false, 10, 'short', null,        null),
  ('seed_nep',       'seed',       'Giống nếp',            90, false, 20, 'nep',   null,        null),
  ('seed_thom',      'seed',       'Giống lúa thơm',      150, false, 30, 'thom',  null,        null),
  ('fert_manure',    'fertilizer', 'Phân chuồng hoai',     40, false, 10, null,    'manure',    null),
  ('fert_phosphate', 'fertilizer', 'Phân lân',             50, false, 20, null,    'phosphate', null),
  ('fert_urea',      'fertilizer', 'Phân urê',             60, false, 30, null,    'urea',      null),
  ('fert_potash',    'fertilizer', 'Phân kali',            60, false, 40, null,    'potash',    null),
  ('fert_npk',       'fertilizer', 'Phân NPK',             90, false, 50, null,    'npk',       null),
  ('spray_insect',   'pesticide',  'Thuốc trừ sâu',        70, false, 10, null,    null,        'insect'),
  ('spray_hopper',   'pesticide',  'Thuốc trừ rầy',        80, false, 20, null,    null,        'hopper'),
  ('spray_fungus',   'pesticide',  'Thuốc trừ bệnh',       90, false, 30, null,    null,        'fungus')
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, variety = excluded.variety, fert = excluded.fert, pest_target = excluded.pest_target;

alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell'));

-- "Visiting the room" for the 14-day reclaim (set by touch_room and every field call; null = joined_at).
alter table public.members add column if not exists last_seen_at timestamptz;

-- ---------- B. Field tables (private: RLS on, no policies — only the RPCs touch them) ----------
create table if not exists public.field_plots (
  room_id uuid not null references public.rooms(id) on delete cascade,
  plot_no smallint not null check (plot_no between 1 and 10),
  kind text not null check (kind in ('private','village')),
  owner_id uuid references public.accounts(id) on delete set null,
  owned_at timestamptz,
  sale_price integer check (sale_price between 1 and 1000000),
  sublease_price integer check (sublease_price between 1 and 5000),
  primary key (room_id, plot_no)
);
create table if not exists public.plot_leases (                  -- at most one active lease per plot
  room_id uuid not null,
  plot_no smallint not null,
  farmer_id uuid not null references public.accounts(id) on delete cascade,
  source text not null check (source in ('village','owner')),
  price integer not null check (price >= 0),
  starts_at timestamptz not null,
  until timestamptz not null,
  primary key (room_id, plot_no),
  foreign key (room_id, plot_no) references public.field_plots(room_id, plot_no) on delete cascade
);
create table if not exists public.land_offers (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null,
  plot_no smallint not null,
  buyer_id uuid not null references public.accounts(id) on delete cascade,
  price integer not null check (price between 1 and 1000000),
  created_at timestamptz not null,
  unique (room_id, plot_no, buyer_id),
  foreign key (room_id, plot_no) references public.field_plots(room_id, plot_no) on delete cascade
);
create table if not exists public.crops (                        -- one crop per plot, from "làm đất" or soaking to harvest
  room_id uuid not null,
  plot_no smallint not null,
  farmer_id uuid not null references public.accounts(id) on delete cascade,
  variety text references public.rice_varieties(id),
  prepared_at timestamptz,                                      -- null while the seed soaks before "làm đất"
  soak_at timestamptz,
  sow_at timestamptz,
  transplant_at timestamptz,
  q_transplant double precision not null default 1,
  water_log jsonb not null default '[]'::jsonb,                 -- [{t, l}] level set at t (0 khô … 3 sâu)
  fert_log jsonb not null default '[]'::jsonb,                  -- [{t, item}]
  spray_log jsonb not null default '[]'::jsonb,                 -- [{t, item}]
  picks jsonb not null default '[]'::jsonb,                     -- [{t}] golden apple snails picked
  pest_rolls jsonb,                                             -- secret: [{slot, u_time, u_kind, u_hit}] rolled at sowing
  rotted_at timestamptz,                                        -- the last soaked seed rotted unsown
  work text check (work in ('transplant','harvest')),
  work_started_at timestamptz,
  primary key (room_id, plot_no),
  foreign key (room_id, plot_no) references public.field_plots(room_id, plot_no) on delete cascade
);
create table if not exists public.drying_slots (
  room_id uuid not null references public.rooms(id) on delete cascade,
  slot smallint not null check (slot between 1 and 4),
  account_id uuid not null references public.accounts(id) on delete cascade,
  variety text not null references public.rice_varieties(id),
  kg integer not null check (kg > 0),
  ready_at timestamptz not null,
  primary key (room_id, slot)
);
create table if not exists public.rice_stock (
  account_id uuid not null references public.accounts(id) on delete cascade,
  variety text not null references public.rice_varieties(id),
  wet_kg integer not null default 0 check (wet_kg >= 0),
  dry_kg integer not null default 0 check (dry_kg >= 0),
  primary key (account_id, variety)
);
create table if not exists public.farm_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  gift_at timestamptz
);
alter table public.field_plots enable row level security;
alter table public.plot_leases enable row level security;
alter table public.land_offers enable row level security;
alter table public.crops enable row level security;
alter table public.drying_slots enable row level security;
alter table public.rice_stock enable row level security;
alter table public.farm_profiles enable row level security;
revoke all on public.field_plots, public.plot_leases, public.land_offers, public.crops, public.drying_slots,
              public.rice_stock, public.farm_profiles
  from anon, authenticated;

-- ---------- C. v14 changes: the fishing shop sells fishing gear only; the fishing state carries server_now ----------
create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null or it.kind not in ('rod','bobber','bait','bait_box','bucket') then
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

-- Everything the client shows about the account's fishing (v14 spec §8.2), plus server_now (v15 §11.6). Farm items
-- live in the same inventory, so "owned" lists fishing gear only.
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
                        where i.account_id = p_account and i.qty >= 1 and s.kind in ('rod','bobber','bait_box','bucket')),
                      '[]'::jsonb),
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
    'dig_ready_at', v_dig,
    'server_now', now()
  );
end; $$;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- ---------- D. The crop model (private, pure given the time; lib/game/farm/crop.ts mirrors it — spec §8) ----------
-- All arithmetic is double precision, in the same order as the TypeScript mirror, so both give the same numbers
-- (tests/fixtures/crop-cases.json pins them).

-- A variety by id.
create or replace function public._variety(p_id text) returns public.rice_varieties
language sql stable security definer set search_path = public, extensions
as $$ select * from public.rice_varieties where id = p_id $$;

-- Hours from a to b.
create or replace function public._hrs(a timestamptz, b timestamptz) returns double precision
language sql immutable set search_path = public, extensions
as $$ select extract(epoch from (b - a))::double precision / 3600 $$;

-- t plus h hours, cut to whole seconds.
create or replace function public._plus_h(t timestamptz, h double precision) returns timestamptz
language sql stable set search_path = public, extensions
as $$ select t + make_interval(secs => floor(h * 3600)) $$;

-- The water level at t (§8.3): the last level set at or before t, one level lower per full 12 h since, never below 0.
create or replace function public._water_at(p_log jsonb, p_t timestamptz) returns integer
language sql stable set search_path = public, extensions
as $$
  select coalesce((
    select greatest(0, (e.x->>'l')::int - floor(public._hrs((e.x->>'t')::timestamptz, p_t) / 12)::int)
      from jsonb_array_elements(p_log) with ordinality as e(x, n)
     where (e.x->>'t')::timestamptz <= p_t
     order by (e.x->>'t')::timestamptz desc, e.n desc
     limit 1), 0)
$$;

-- The crop's phase at t (§8.2). Before transplanting the phase needs no variety.
create or replace function public._crop_phase(c public.crops, v public.rice_varieties, t timestamptz) returns text
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; h double precision;
begin
  if c.transplant_at is null or t < c.transplant_at then
    if c.sow_at is not null and t >= c.sow_at then return 'seedling'; end if;
    if c.soak_at is not null and t >= c.soak_at then
      return case when public._hrs(c.soak_at, t) < 2 then 'soaking' else 'sprouted' end;
    end if;
    return 'prepared';
  end if;
  h := public._hrs(c.transplant_at, t);
  if h < 18 * s then return 'tillering'; end if;
  if h < 30 * s then return 'panicle'; end if;
  if h < 40 * s then return 'heading'; end if;
  if h < 48 * s then return 'ripening'; end if;
  if h < 48 * s + 12 then return 'ripe'; end if;
  return 'overripe';
end; $$;

-- Does the water level at t suit the phase (§8.3)? Phases before sowing accept anything.
create or replace function public._water_ok(c public.crops, v public.rice_varieties, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare ph text := public._crop_phase(c, v, t); l integer := public._water_at(c.water_log, t);
begin
  if ph = 'seedling' then return l = 1; end if;
  if ph = 'tillering' then
    if public._hrs(c.transplant_at, t) < 14 * v.scale then return l = 2; end if;
    return l <= 2;
  end if;
  if ph in ('panicle', 'heading') then return l >= 2; end if;
  if ph in ('ripening', 'ripe', 'overripe') then return l <= 1; end if;
  return true;
end; $$;

-- Off-target water hours from sowing until p_until: one sample every 15 minutes, 0.25 h per wrong sample.
create or replace function public._water_off_hours(c public.crops, v public.rice_varieties, p_until timestamptz)
returns double precision
language sql stable set search_path = public, extensions
as $$
  select case when c.sow_at is null or p_until <= c.sow_at then 0::double precision
         else (select count(*) filter (where not public._water_ok(c, v, t))
                 from generate_series(c.sow_at, p_until - interval '1 microsecond', interval '15 minutes') t)::double precision
              * 0.25::double precision end
$$;

-- Excess nitrogen by t (§8.4): urea in panicle, a second N inside tillering or inside panicle, or any N from heading on.
create or replace function public._excess_n(c public.crops, v public.rice_varieties, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; ph text; v_till integer := 0; v_pan integer := 0;
begin
  for e in select x from jsonb_array_elements(c.fert_log) x where (x->>'t')::timestamptz <= t loop
    if e->>'item' not in ('fert_urea', 'fert_npk') then continue; end if;
    ph := public._crop_phase(c, v, (e->>'t')::timestamptz);
    if ph = 'tillering' then
      v_till := v_till + 1;
    elsif ph = 'panicle' then
      if e->>'item' = 'fert_urea' then return true; end if;
      v_pan := v_pan + 1;
    elsif ph in ('heading', 'ripening', 'ripe', 'overripe') then
      return true;
    end if;
  end loop;
  return v_till >= 2 or v_pan >= 2;
end; $$;

-- Fertilizer and drainage scores (§8.4, §8.6): the base fertilizers, both top-dresses (0 on time / 0.10 half /
-- 0.20 missing; only the best application counts), phơi ruộng (water ≤ 1 at T = 18·s) and excess N.
create or replace function public._crop_care(c public.crops, v public.rice_varieties) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; e jsonb; t timestamptz; it text; ph text; h double precision;
        v_manure boolean := false; v_phos boolean := false; v_td1 double precision := 0.20; v_td2 double precision := 0.20;
        v_phoi boolean := false;
begin
  for e in select x from jsonb_array_elements(c.fert_log) x loop
    t := (e->>'t')::timestamptz;
    it := e->>'item';
    if c.transplant_at is null or t < c.transplant_at then
      if it = 'fert_manure' then v_manure := true; end if;
      if it = 'fert_phosphate' then v_phos := true; end if;
      continue;
    end if;
    ph := public._crop_phase(c, v, t);
    h := public._hrs(c.transplant_at, t);
    if ph = 'tillering' then
      if it in ('fert_urea', 'fert_npk') and h >= 2 * s and h <= 10 * s then
        v_td1 := 0;
      elsif it in ('fert_urea', 'fert_npk', 'fert_potash') then
        v_td1 := least(v_td1, 0.10::double precision);
      end if;
    elsif ph = 'panicle' then
      if it in ('fert_potash', 'fert_npk') and h >= 18 * s and h <= 24 * s then
        v_td2 := 0;
      elsif it in ('fert_potash', 'fert_npk', 'fert_urea') then
        v_td2 := least(v_td2, 0.10::double precision);
      end if;
    end if;
  end loop;
  if c.transplant_at is not null then
    v_phoi := public._water_at(c.water_log, public._plus_h(c.transplant_at, 18 * s)) <= 1;
  end if;
  return jsonb_build_object('manure', v_manure, 'phosphate', v_phos, 'td1', v_td1, 'td2', v_td2, 'phoi', v_phoi,
                            'excess', public._excess_n(c, v, 'infinity'::timestamptz));
end; $$;

-- The pests revealed by p_now (§8.5): the hits whose due time has passed, [{slot, kind, since, treated_at}].
create or replace function public._crop_pests(c public.crops, v public.rice_varieties, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; r jsonb; v_slot integer; u double precision; due timestamptz; p double precision;
        lvl integer; v_kind text; v_remedy text; tr timestamptz; v_out jsonb := '[]'::jsonb;
begin
  if c.transplant_at is null or c.pest_rolls is null then return v_out; end if;
  for r in select x from jsonb_array_elements(c.pest_rolls) x order by (x->>'slot')::int loop
    v_slot := (r->>'slot')::int;
    u := (r->>'u_time')::double precision;
    if v_slot = 1 then
      due := public._plus_h(c.transplant_at, u * 8 * s);
    elsif v_slot = 2 then
      due := public._plus_h(c.transplant_at, 6 * s + u * 20 * s);
    else
      due := public._plus_h(c.transplant_at, 20 * s + u * 18 * s);
    end if;
    if due > p_now then continue; end if;
    if v_slot = 1 then
      lvl := public._water_at(c.water_log, due);
      p := least(0.7::double precision,
                 0.35::double precision * (case when lvl = 3 then 2 when lvl <= 1 then 0 else 1 end));
      v_kind := 'snail';
    else
      p := case when v_slot = 2 then 0.45::double precision else 0.40::double precision end;
      if public._excess_n(c, v, due) then p := p * 1.5::double precision; end if;
      p := least(0.9::double precision, p);
      if (r->>'u_kind')::double precision < 0.4 * v.blast_mult then
        v_kind := case when v_slot = 2 then 'leaf_blast' else 'neck_blast' end;
      else
        v_kind := case when v_slot = 2 then 'leaf_folder' else 'hopper' end;
      end if;
    end if;
    if (r->>'u_hit')::double precision >= p then continue; end if;
    if v_kind = 'snail' then
      select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.picks) x
       where (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    else
      v_remedy := case v_kind when 'leaf_folder' then 'spray_insect' when 'hopper' then 'spray_hopper' else 'spray_fungus' end;
      select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.spray_log) x
       where x->>'item' = v_remedy and (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', v_slot, 'kind', v_kind, 'since', due, 'treated_at', tr));
  end loop;
  return v_out;
end; $$;

-- A pest's damaging hours until it was treated or p_until (§8.5). Snails only count 15-minute samples with water ≥ 2.
create or replace function public._pest_hours(c public.crops, p_pest jsonb, p_until timestamptz) returns double precision
language plpgsql stable set search_path = public, extensions
as $$
declare v_since timestamptz := (p_pest->>'since')::timestamptz;
        v_end timestamptz := coalesce((p_pest->>'treated_at')::timestamptz, p_until);
begin
  if v_end <= v_since then return 0; end if;
  if p_pest->>'kind' = 'snail' then
    return (select count(*) from generate_series(v_since, v_end - interval '1 microsecond', interval '15 minutes') t
             where public._water_at(c.water_log, t) >= 2)::double precision * 0.25::double precision;
  end if;
  return public._hrs(v_since, v_end);
end; $$;

-- The harvest in kg (§8.6), with its factors for tests and the plot panel.
create or replace function public._crop_yield(c public.crops, v public.rice_varieties, p_land double precision,
                                              p_qh double precision, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; care jsonb := public._crop_care(c, v); pe jsonb; v_pen double precision := 0;
        v_mcare double precision; v_mseed double precision; v_mwater double precision; v_mpest double precision := 1;
        v_mlate double precision; v_x double precision; v_kg integer;
begin
  if not (care->>'manure')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if not (care->>'phosphate')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  v_pen := v_pen + (care->>'td1')::double precision;
  v_pen := v_pen + (care->>'td2')::double precision;
  if not (care->>'phoi')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if (care->>'excess')::boolean then v_pen := v_pen + 0.10::double precision; end if;
  v_mcare := 1 - v_pen;
  v_mseed := 1 - least(0.3::double precision, 0.03 * greatest(0::double precision, public._hrs(c.soak_at, c.sow_at) - 8))
               - least(0.3::double precision, 0.03 * greatest(0::double precision, public._hrs(c.sow_at, c.transplant_at) - 14 * s));
  v_mwater := 1 - least(0.2::double precision, 0.01 * public._water_off_hours(c, v, p_now));
  for pe in select x from jsonb_array_elements(public._crop_pests(c, v, p_now)) x loop
    v_mpest := v_mpest * (1 - least(0.3::double precision, 0.015 * public._pest_hours(c, pe, p_now)));
  end loop;
  v_mlate := 1 - least(0.6::double precision,
                       0.02 * greatest(0::double precision, public._hrs(c.transplant_at, p_now) - (48 * s + 12)));
  v_x := v.base_kg * p_land * v_mcare * v_mseed * v_mwater * v_mpest * v_mlate * c.q_transplant * p_qh;
  v_kg := greatest((v.base_kg + 9) / 10, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mseed', v_mseed, 'mwater', v_mwater, 'mpest', v_mpest,
                            'mlate', v_mlate);
end; $$;

revoke all on function public._variety(text) from public, anon, authenticated;
revoke all on function public._hrs(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public._plus_h(timestamptz, double precision) from public, anon, authenticated;
revoke all on function public._water_at(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._crop_phase(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._water_ok(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._water_off_hours(public.crops, public.rice_varieties, timestamptz)
  from public, anon, authenticated;
revoke all on function public._excess_n(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._crop_care(public.crops, public.rice_varieties) from public, anon, authenticated;
revoke all on function public._crop_pests(public.crops, public.rice_varieties, timestamptz) from public, anon, authenticated;
revoke all on function public._pest_hours(public.crops, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._crop_yield(public.crops, public.rice_varieties, double precision, double precision, timestamptz)
  from public, anon, authenticated;
```

- [ ] **Step 2: Write the crop fixtures**

Create `tests/fixtures/crop-cases.json`:

```json
{
  "t0": "2026-03-01T00:00:00Z",
  "cases": [
    {
      "name": "nep, village, textbook care",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 75, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 1, "mlate": 1, "pests": []}
    },
    {
      "name": "nep, private plot (+10 %)",
      "variety": "nep", "land": 1.1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 82, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 1, "mlate": 1, "pests": []}
    },
    {
      "name": "short, sown 5 h late, old seedlings, dry seedbed",
      "variety": "short", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 13, "transplant": 28, "harvest": 72,
      "water": [[0, 3], [12.5, 1], [28, 1], [28, 2], [44.25, 2], [44.5, 3], [64, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [33, "fert_npk"], [46, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 67, "mcare": 1, "mseed": 0.778, "mwater": 0.9575, "mpest": 1, "mlate": 1, "pests": []}
    },
    {
      "name": "thom, leaf blast sprayed about 6 h late",
      "variety": "thom", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 13, "harvest": 70,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [13, 2], [25, 2], [32, 1], [34, 2], [34.25, 3]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [19, "fert_urea"], [35, "fert_potash"]],
      "spray": [[33, "spray_fungus"]], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.3, "u_kind": 0.3, "u_hit": 0.2},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 54, "mcare": 1, "mseed": 1, "mwater": 0.99, "mpest": 0.9069958333333333, "mlate": 1, "pests": [{"kind": "leaf_blast", "since_s": 96479, "treated_s": 118800}]}
    },
    {
      "name": "nep, urea at panicle: excess N, lodging and a planthopper it invited",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_urea"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.9, "u_hit": 0.5}],
      "expect": {"kg": 42, "mcare": 0.8, "mseed": 1, "mwater": 0.9975, "mpest": 0.7, "mlate": 1, "pests": [{"kind": "hopper", "since_s": 147600, "treated_s": null}]}
    },
    {
      "name": "nep, golden snails in deep water, picked after 5 h",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [12.25, 3], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [21],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.5},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 61, "mcare": 1, "mseed": 1, "mwater": 0.8775, "mpest": 0.925, "mlate": 1, "pests": [{"kind": "snail", "since_s": 57600, "treated_s": 75600}]}
    },
    {
      "name": "nep, snails idle in a drained plot until it floods",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [16.25, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [31],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.2},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 66, "mcare": 1, "mseed": 1, "mwater": 0.9, "mpest": 0.985, "mlate": 1, "pests": [{"kind": "snail", "since_s": 57600, "treated_s": 111600}]}
    },
    {
      "name": "nep, half top-dresses: potash while tillering, NPK late in panicle",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_potash"], [38, "fert_npk"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 60, "mcare": 0.8, "mseed": 1, "mwater": 0.9975, "mpest": 1, "mlate": 1, "pests": []}
    },
    {
      "name": "nep, no fertilizer and no phơi ruộng",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [30.5, 3], [52, 1]],
      "fert": [],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 34, "mcare": 0.44999999999999996, "mseed": 1, "mwater": 1, "mpest": 1, "mlate": 1, "pests": []}
    },
    {
      "name": "short, harvested 20 h after the ripe window",
      "variety": "short", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 87.25,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [27, 1], [28.25, 2], [28.5, 3], [48, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [16, "fert_urea"], [30, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 54, "mcare": 1, "mseed": 1, "mwater": 1, "mpest": 1, "mlate": 0.599, "pests": []}
    },
    {
      "name": "nep, water left alone after transplanting (the 20 % cap)",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 60, "mcare": 1, "mseed": 1, "mwater": 0.8, "mpest": 1, "mlate": 1, "pests": []}
    },
    {
      "name": "thom, everything wrong: the minimum harvest",
      "variety": "thom", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 20, "transplant": 50, "harvest": 157.25,
      "water": [[0, 3], [19.75, 1], [50, 1], [50, 2], [50.25, 3]],
      "fert": [],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.1},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.2, "u_hit": 0.1},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.9, "u_hit": 0.1}],
      "expect": {"kg": 6, "mcare": 0.44999999999999996, "mseed": 0.39999999999999997, "mwater": 0.8, "mpest": 0.34483749999999996, "mlate": 0.4, "pests": [{"kind": "snail", "since_s": 196560, "treated_s": null}, {"kind": "leaf_blast", "since_s": 246240, "treated_s": null}, {"kind": "hopper", "since_s": 300060, "treated_s": null}]}
    },
    {
      "name": "nep, best minigame scores (qT = qH = 1.1)",
      "variety": "nep", "land": 1, "q_transplant": 1.1, "q_harvest": 1.1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 91, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 1, "mlate": 1, "pests": []}
    },
    {
      "name": "nep, the wrong spray first, then the right one",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [[24, "spray_hopper"], [26, "spray_insect"]], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.25, "u_kind": 0.9, "u_hit": 0.2},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 71, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 0.955, "mlate": 1, "pests": [{"kind": "leaf_folder", "since_s": 82800, "treated_s": 93600}]}
    }
  ]
}
```

- [ ] **Step 3: Write the smoke test (setup + the crop model)**

Create `tests/sql/v15-smoke.sql` with exactly:

```sql
-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0013, from the repo
-- root (the crop fixtures are read with \copy). Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on

create temp table smoke (k text primary key, v text);
insert into smoke select 't1', token from public.register('smoke15_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('smoke15_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('smoke15_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Đồng test', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'code', code from public.rooms where id = (select v from smoke where k = 'room')::uuid;
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't2'));
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't3'));

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---------- the crop model against the shared fixtures ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/crop-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;

create function pg_temp.fx_at(t0 timestamptz, h jsonb) returns timestamptz language sql
as $$ select t0 + make_interval(secs => (h #>> '{}')::double precision * 3600) $$;

create function pg_temp.fx_log(t0 timestamptz, a jsonb, k text) returns jsonb language sql
as $$ select coalesce(jsonb_agg(case when k = 't' then jsonb_build_object('t', pg_temp.fx_at(t0, e))
                                     else jsonb_build_object('t', pg_temp.fx_at(t0, e->0), k, e->1) end order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

create function pg_temp.fx_crop(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'variety', k->>'variety', 'prepared_at', t0,
  'soak_at', pg_temp.fx_at(t0, k->'soak'), 'sow_at', pg_temp.fx_at(t0, k->'sow'),
  'transplant_at', pg_temp.fx_at(t0, k->'transplant'), 'q_transplant', k->'q_transplant',
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'), 'picks', pg_temp.fx_log(t0, k->'picks', 't'),
  'pest_rolls', k->'pest_rolls')) $$;

do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        v public.rice_varieties; h timestamptz; y jsonb; got jsonb; want jsonb; f text;
begin
  for k in select x from jsonb_array_elements(j->'cases') x loop
    c := pg_temp.fx_crop(t0, k);
    v := public._variety(k->>'variety');
    h := pg_temp.fx_at(t0, k->'harvest');
    y := public._crop_yield(c, v, (k->>'land')::double precision, (k->>'q_harvest')::double precision, h);
    assert (y->>'kg')::int = (k->'expect'->>'kg')::int, format('%s: kg %s, want %s', k->>'name', y->>'kg', k->'expect'->>'kg');
    foreach f in array array['mcare', 'mseed', 'mwater', 'mpest', 'mlate'] loop
      assert abs((y->>f)::double precision - (k->'expect'->>f)::double precision) < 1e-12,
        format('%s: %s %s, want %s', k->>'name', f, y->>f, k->'expect'->>f);
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('kind', p->>'kind',
                                                 'since_s', extract(epoch from (p->>'since')::timestamptz - t0)::int,
                                                 'treated_s', extract(epoch from (p->>'treated_at')::timestamptz - t0)::int)
                              order by (p->>'slot')::int), '[]'::jsonb)
      into got from jsonb_array_elements(public._crop_pests(c, v, h)) p;
    want := k->'expect'->'pests';
    assert got = want, format('%s: pests %s, want %s', k->>'name', got, want);
  end loop;
end $$;

do $$
declare t timestamptz := '2026-03-01 00:00:00+00'; nep public.rice_varieties := public._variety('nep');
        short public.rice_varieties := public._variety('short'); c public.crops;
begin
  -- water: the last level set, one level lower per full 12 h, never below 0; the later of two same-time entries wins
  assert public._water_at('[]'::jsonb, t) = 0, 'no log = dry';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '11 hours 59 minutes') = 3, 'no drop before 12 h';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '12 hours') = 2, 'drop at 12 h';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 3)), t + interval '100 hours') = 0, 'never below 0';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 1), jsonb_build_object('t', t, 'l', 2)), t) = 2,
    'same-time entries: the last one';
  assert public._water_at(jsonb_build_array(jsonb_build_object('t', t, 'l', 2)), t - interval '1 second') = 0, 'before the log';

  -- phases (§8.2)
  c := jsonb_populate_record(null::public.crops, jsonb_build_object('prepared_at', t));
  assert public._crop_phase(c, null, t) = 'prepared', 'prepared';
  c.soak_at := t;
  assert public._crop_phase(c, nep, t + interval '1 hour 59 minutes') = 'soaking', 'soaking';
  assert public._crop_phase(c, nep, t + interval '2 hours') = 'sprouted', 'sprouted';
  c.sow_at := t + interval '3 hours';
  assert public._crop_phase(c, nep, t + interval '3 hours') = 'seedling', 'seedling';
  c.transplant_at := t + interval '12 hours';
  assert public._crop_phase(c, nep, t + interval '12 hours') = 'tillering', 'tillering';
  assert public._crop_phase(c, nep, t + interval '29 hours 59 minutes') = 'tillering', 'tillering until 18·s';
  assert public._crop_phase(c, nep, t + interval '30 hours') = 'panicle', 'panicle at 18·s';
  assert public._crop_phase(c, nep, t + interval '42 hours') = 'heading', 'heading at 30·s';
  assert public._crop_phase(c, nep, t + interval '52 hours') = 'ripening', 'ripening at 40·s';
  assert public._crop_phase(c, nep, t + interval '60 hours') = 'ripe', 'ripe at 48·s';
  assert public._crop_phase(c, nep, t + interval '72 hours') = 'overripe', 'overripe after 12 h ripe';
  assert public._crop_phase(c, short, t + interval '55 hours 12 minutes') = 'ripe', 'short: ripe at 43.2 h';
  assert public._crop_phase(c, short, t + interval '55 hours 11 minutes') = 'ripening', 'short: ripening before';
end $$;

-- ---------- v14 changes: the fishing shop sells fishing gear only; the fishing state lists fishing gear only ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); a1 uuid := (select v from smoke where k = 'a1')::uuid; s jsonb;
begin
  insert into public.wallets (account_id, coins) values (a1, 1000) on conflict (account_id) do update set coins = 1000;
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', t1, 'seed_short')) = 'item not available', 'seeds are not fishing gear';
  assert pg_temp.err(format('select public.buy_item(%L, %L)', t1, 'fert_urea')) = 'item not available', 'nor fertilizer';
  insert into public.inventory (account_id, item_id, qty) values (a1, 'seed_nep', 2), (a1, 'rod_bamboo', 1)
  on conflict (account_id, item_id) do update set qty = excluded.qty;
  s := public.fishing_state(t1);
  assert s->'owned' = '["rod_bamboo"]'::jsonb, format('owned lists fishing gear only: %s', s->'owned');
  assert (s->>'server_now')::timestamptz between now() - interval '1 minute' and now() + interval '1 minute', 'server_now';
  delete from public.inventory where account_id = a1;
  update public.wallets set coins = 0 where account_id = a1;
end $$;

select 'v15 crop smoke ok' as result;
```

- [ ] **Step 4: Replay the migrations twice on a throwaway PostgreSQL 18 cluster and run the smoke test**

PostgreSQL 18 is installed at `C:\Program Files\PostgreSQL\18` — do not touch its service. Use Git Bash from the repo root; `$SCRATCH` = the session scratchpad directory.

```bash
export PGCLIENTENCODING=UTF8
PG="/c/Program Files/PostgreSQL/18/bin"; D="$SCRATCH/pg15"
"$PG/pg_ctl" -D "$D" stop 2>/dev/null; rm -rf "$D"; "$PG/initdb" -D "$D" -U postgres --auth=trust -E UTF8 >/dev/null
"$PG/pg_ctl" -D "$D" -o "-p 5499" -l "$D/log.txt" start
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -c "create schema extensions; create role anon nologin; create role authenticated nologin; create publication supabase_realtime;"
for f in supabase/migrations/00{04,05,06,07,08,09,10,11,12}_*.sql; do "$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "FAILED $f"; break; }; done
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/migrations/0013_v15_field.sql >/dev/null && echo "0013 ok"
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/migrations/0013_v15_field.sql >/dev/null && echo "0013 re-run ok"
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -t -f tests/sql/v15-smoke.sql
"$PG/pg_ctl" -D "$D" stop; rm -rf "$D"
```

Expected: no `FAILED` line (a `WARNING: "wal_level" is insufficient` from `create publication` and `NOTICE … does not exist, skipping` lines are fine), `0013 ok`, `0013 re-run ok`, and the smoke test ends with a row `v15 crop smoke ok`. Any failed `ASSERT` stops psql with its message.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0013_v15_field.sql tests/fixtures/crop-cases.json tests/sql/v15-smoke.sql
git commit -m "feat(v15): varieties, farm items, field tables and the crop model

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Database — the field, the sweep and land

**Files:**
- Modify: `supabase/migrations/0013_v15_field.sql` (append sections E–F)
- Modify: `tests/sql/v15-smoke.sql` (append the land checks)

**Interfaces:**
- Consumes: everything from Task 1.
- Produces (Postgres): private `_farm_auth(room, token) → account uuid` (also records `last_seen_at`, at most hourly), `_field_init`, `_farmer(room, plot, now)`, `_farm_count`, `_plot_row`, `_leased`, `_has_crop`, `_owns_land`, `_rice_add`, `_field_sweep(room, now)` (ends leases, expires offers, reclaims, clears foreign crops, rots unsown seed, clears lost crops, auto-collects drying), `_field_open(room, now)` (init, lock the 10 plots, sweep), `_who`, `_farm_mine`, `_plot_view`, `_field_view(room, account, now)`; `_land_sale` (pays, hands over, posts `[land:<plot>] 🏡 …` as `Hợp tác xã`); cores `_farm_do_rent|buy_plot|sell_to_village|list|buy_listed|offer|withdraw_offer|decline_offer|accept_offer|set_sublease|rent_sublease|abandon(…, p_now)`; public RPCs `touch_room(uuid, text)` and `field_state(uuid, text)`, and `rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot(p_price)`, `buy_listed_plot(p_expected_price)`, `offer_plot(p_price)`, `withdraw_offer(p_offer_id)`, `decline_offer`, `accept_offer`, `set_sublease(p_price)`, `rent_sublease(p_expected_price)`, `abandon_crop` — each `(p_room_id uuid, p_session_token text, …)` returning the `field_state` JSON of spec §11.5.

- [ ] **Step 1: Append sections E–F to the migration**

**supabase/migrations/0013_v15_field.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- E. The field: plots, farmers, the sweep and the views (spec §7, §11.5) ----------
-- The caller's account for a field call. It also records the visit for the 14-day reclaim (§7.5) — at most once an
-- hour, because members is in the realtime publication and every update there makes the room's clients refetch.
create or replace function public._farm_auth(p_room_id uuid, p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  select account_id into v_account from public.members where id = v_member;
  update public.members set last_seen_at = now()
   where id = v_member and (last_seen_at is null or last_seen_at < now() - interval '1 hour');
  return v_account;
end; $$;

-- The room's 10 plots, created the first time its field opens: 1–4 private, 5–10 village.
create or replace function public._field_init(p_room uuid) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.field_plots (room_id, plot_no, kind)
  select p_room, n, case when n <= 4 then 'private' else 'village' end from generate_series(1, 10) n
  on conflict (room_id, plot_no) do nothing
$$;

-- The farmer of a plot (§7.1): the holder of an active lease, else the owner of a private plot, else nobody.
create or replace function public._farmer(p_room uuid, p_plot integer, p_now timestamptz) returns uuid
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(
    (select pl.farmer_id from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = p_plot and pl.until > p_now),
    (select fp.owner_id from public.field_plots fp where fp.room_id = p_room and fp.plot_no = p_plot and fp.kind = 'private'))
$$;

-- How many plots of the room the account farms (the limit is 2).
create or replace function public._farm_count(p_room uuid, p_account uuid, p_now timestamptz) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select count(*)::int from public.field_plots fp
   where fp.room_id = p_room and public._farmer(p_room, fp.plot_no, p_now) = p_account
$$;

create or replace function public._plot_row(p_room uuid, p_plot integer) returns public.field_plots
language plpgsql stable security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  select * into f from public.field_plots where room_id = p_room and plot_no = p_plot;
  if not found then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  return f;
end; $$;

create or replace function public._leased(p_room uuid, p_plot integer, p_now timestamptz) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = p_plot and pl.until > p_now) $$;

create or replace function public._has_crop(p_room uuid, p_plot integer) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.crops cr where cr.room_id = p_room and cr.plot_no = p_plot) $$;

create or replace function public._owns_land(p_room uuid, p_account uuid) returns boolean
language sql stable security definer set search_path = public, extensions
as $$ select exists (select 1 from public.field_plots fp where fp.room_id = p_room and fp.owner_id = p_account) $$;

-- Wet and dry kilograms into the account's rice stock.
create or replace function public._rice_add(p_account uuid, p_variety text, p_wet integer, p_dry integer) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (p_account, p_variety, p_wet, p_dry)
  on conflict (account_id, variety) do update
    set wet_kg = public.rice_stock.wet_kg + excluded.wet_kg, dry_kg = public.rice_stock.dry_kg + excluded.dry_kg
$$;

-- The lazy clock of a room's field (§7.7). Idempotent; runs under the plot locks taken by _field_open.
create or replace function public._field_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots; d public.drying_slots;
begin
  -- 1. leases end (the leaseholder's crop goes in step 4)
  delete from public.plot_leases where room_id = p_room and until <= p_now;
  -- 2. offers expire after 24 h
  delete from public.land_offers where room_id = p_room and created_at <= p_now - interval '24 hours';
  -- 3. reclaim: the owner left the room or has not visited it for 14 days, and the plot is not leased out (§7.6)
  for f in select fp.* from public.field_plots fp
            where fp.room_id = p_room and fp.owner_id is not null
              and not exists (select 1 from public.members m
                               where m.room_id = p_room and m.account_id = fp.owner_id
                                 and coalesce(m.last_seen_at, m.joined_at) > p_now - interval '14 days')
              and not exists (select 1 from public.plot_leases pl where pl.room_id = p_room and pl.plot_no = fp.plot_no)
            order by fp.plot_no loop
    update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
     where room_id = p_room and plot_no = f.plot_no;
    delete from public.land_offers where room_id = p_room and plot_no = f.plot_no;
    perform public._wallet_lock(f.owner_id);
    perform public._pay(f.owner_id, 2000, 'land_refund', 'plot ' || f.plot_no);
  end loop;
  -- 4. a crop belongs to the plot's farmer: a crop left by an ended lease or a reclaim is lost
  delete from public.crops cr
   where cr.room_id = p_room and cr.farmer_id is distinct from public._farmer(p_room, cr.plot_no, p_now);
  -- 5. sprouted seed not sown 24 h after sprouting (soak + 26 h) rots: the plot goes back to prepared, or to bare
  delete from public.crops
   where room_id = p_room and sow_at is null and prepared_at is null and p_now >= soak_at + interval '26 hours';
  update public.crops set rotted_at = soak_at + interval '26 hours', soak_at = null, variety = null
   where room_id = p_room and sow_at is null and p_now >= soak_at + interval '26 hours';
  -- 6. rice left 48 h after its ripe window has all fallen
  delete from public.crops cr using public.rice_varieties rv
   where cr.room_id = p_room and rv.id = cr.variety and cr.transplant_at is not null
     and p_now >= public._plus_h(cr.transplant_at, 48 * rv.scale + 60);
  -- 7. a drying batch left 24 h after it is ready is collected for its owner
  for d in delete from public.drying_slots where room_id = p_room and ready_at <= p_now - interval '24 hours' returning * loop
    perform public._rice_add(d.account_id, d.variety, 0, d.kg);
  end loop;
end; $$;

-- Every field call starts here: create the plots if needed, lock them (one field call per room at a time — before
-- any wallet lock, so a sale that pays the other party cannot deadlock with that party's own field call), sweep.
create or replace function public._field_open(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_init(p_room);
  perform 1 from public.field_plots where room_id = p_room order by plot_no for update;
  perform public._field_sweep(p_room, p_now);
end; $$;

-- {id, name} of an account, or null.
create or replace function public._who(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$ select jsonb_build_object('id', a.id, 'name', a.username) from public.accounts a where a.id = p_account $$;

-- The account's farm belongings (the room-free part of field_state.mine).
create or replace function public._farm_mine(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty order by i.item_id)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('seed','fertilizer','pesticide','critter_box')), '{}'::jsonb),
    'rice', coalesce((select jsonb_object_agg(rs.variety, jsonb_build_object('wet', rs.wet_kg, 'dry', rs.dry_kg) order by rs.variety)
                        from public.rice_stock rs where rs.account_id = p_account and (rs.wet_kg > 0 or rs.dry_kg > 0)),
                     '{}'::jsonb),
    'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0),
    'gift_claimed', exists (select 1 from public.farm_profiles pr where pr.account_id = p_account and pr.gift_at is not null))
$$;

-- One plot as everyone sees it; its farmer also gets the crop's logs (§11.5). The pest rolls never leave the server.
create or replace function public._plot_view(p_room uuid, p_plot integer, p_viewer uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare f public.field_plots; l public.plot_leases; c public.crops; v public.rice_varieties; v_phase text;
        v_crop jsonb := null;
begin
  select * into f from public.field_plots where room_id = p_room and plot_no = p_plot;
  select * into l from public.plot_leases where room_id = p_room and plot_no = p_plot and until > p_now;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if found then
    select * into v from public.rice_varieties where id = c.variety;
    v_phase := public._crop_phase(c, v, p_now);
    v_crop := jsonb_build_object(
      'variety', c.variety, 'phase', v_phase,
      'prepared_at', c.prepared_at, 'soak_at', c.soak_at, 'sow_at', c.sow_at, 'transplant_at', c.transplant_at,
      'water', public._water_at(c.water_log, p_now),
      'water_set_at', (select max((x->>'t')::timestamptz) from jsonb_array_elements(c.water_log) x
                        where (x->>'t')::timestamptz <= p_now),
      'pests', (select coalesce(jsonb_agg(jsonb_build_object('kind', x->'kind', 'since', x->'since', 'treated_at', x->'treated_at')
                                          order by (x->>'slot')::int), '[]'::jsonb)
                  from jsonb_array_elements(public._crop_pests(c, v, p_now)) x),
      'excess_n', public._excess_n(c, v, p_now),
      'ripe', v_phase in ('ripe', 'overripe'),
      'rotted_at', c.rotted_at);
    if p_viewer = c.farmer_id then
      v_crop := v_crop || jsonb_build_object('log', jsonb_build_object(
        'water', c.water_log, 'fert', c.fert_log, 'spray', c.spray_log, 'picks', c.picks, 'q_transplant', c.q_transplant));
    end if;
  end if;
  return jsonb_build_object(
    'no', f.plot_no, 'kind', f.kind, 'owner', public._who(f.owner_id),
    'sale_price', f.sale_price, 'sublease_price', f.sublease_price,
    'farmer', public._who(public._farmer(p_room, p_plot, p_now)),
    'lease', case when l.room_id is null then null
                  else jsonb_build_object('source', l.source, 'until', l.until, 'price', l.price) end,
    'offers', (select count(*) from public.land_offers lo where lo.room_id = p_room and lo.plot_no = p_plot),
    'crop', v_crop);
end; $$;

-- The whole field_state answer (§11.5).
create or replace function public._field_view(p_room uuid, p_viewer uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now,
    'plots', (select jsonb_agg(public._plot_view(p_room, fp.plot_no, p_viewer, p_now) order by fp.plot_no)
                from public.field_plots fp where fp.room_id = p_room),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('slot', ds.slot, 'owner', public._who(ds.account_id),
                                                            'variety', ds.variety, 'kg', ds.kg, 'ready_at', ds.ready_at)
                                         order by ds.slot)
                          from public.drying_slots ds where ds.room_id = p_room), '[]'::jsonb),
    'mine', public._farm_mine(p_viewer) || jsonb_build_object(
      'owned_plot', (select fp.plot_no from public.field_plots fp where fp.room_id = p_room and fp.owner_id = p_viewer
                      order by fp.plot_no limit 1),
      'farming', coalesce((select jsonb_agg(fp.plot_no order by fp.plot_no) from public.field_plots fp
                            where fp.room_id = p_room and public._farmer(p_room, fp.plot_no, p_now) = p_viewer), '[]'::jsonb),
      'my_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no, 'price', lo.price,
                                                               'expires_at', lo.created_at + interval '24 hours')
                                              order by lo.created_at, lo.id)
                              from public.land_offers lo where lo.room_id = p_room and lo.buyer_id = p_viewer), '[]'::jsonb),
      'incoming_offers', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'plot', lo.plot_no,
                                                                     'buyer', public._who(lo.buyer_id), 'price', lo.price,
                                                                     'expires_at', lo.created_at + interval '24 hours')
                                                    order by lo.plot_no, lo.price desc, lo.id)
                                    from public.land_offers lo
                                    join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
                                   where lo.room_id = p_room and fp.owner_id = p_viewer), '[]'::jsonb)))
$$;

revoke all on function public._farm_auth(uuid, text) from public, anon, authenticated;
revoke all on function public._field_init(uuid) from public, anon, authenticated;
revoke all on function public._farmer(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_count(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._plot_row(uuid, integer) from public, anon, authenticated;
revoke all on function public._leased(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._has_crop(uuid, integer) from public, anon, authenticated;
revoke all on function public._owns_land(uuid, uuid) from public, anon, authenticated;
revoke all on function public._rice_add(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public._field_sweep(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._field_open(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._who(uuid) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
revoke all on function public._plot_view(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._field_view(uuid, uuid, timestamptz) from public, anon, authenticated;

-- The room page calls this once when it opens (§7.5).
create or replace function public.touch_room(p_room_id uuid, p_session_token text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._farm_auth(p_room_id, p_session_token);
end; $$;

create or replace function public.field_state(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  perform public._field_open(p_room_id, now());
  return public._field_view(p_room_id, v_account, now());
end; $$;

grant execute on function public.touch_room(uuid, text) to anon, authenticated;
grant execute on function public.field_state(uuid, text) to anon, authenticated;

-- ---------- F. Land (spec §7). Each _farm_do_* takes p_now; its public RPC below passes now(). ----------
-- A player-to-player sale (§7.3): pay, hand over, clear the listing and the offers, announce it in the room's chat.
create or replace function public._land_sale(p_room uuid, p_plot integer, p_buyer uuid, p_price integer, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seller uuid;
begin
  select owner_id into v_seller from public.field_plots where room_id = p_room and plot_no = p_plot;
  perform public._wallet_lock(p_buyer);
  perform public._wallet_lock(v_seller);
  perform public._pay(p_buyer, -p_price, 'land_buy', 'plot ' || p_plot);
  perform public._pay(v_seller, p_price, 'land_sell', 'plot ' || p_plot);
  update public.field_plots set owner_id = p_buyer, owned_at = p_now, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  insert into public.chat_messages (room_id, account_id, username, body)
  values (p_room, null, 'Hợp tác xã',
          format('[land:%s] 🏡 %s đã mua thửa %s của %s với giá %s xu.', p_plot,
                 (select username from public.accounts where id = p_buyer), p_plot,
                 (select username from public.accounts where id = v_seller),
                 replace(to_char(p_price, 'FM9,999,999'), ',', '.')));
  delete from public.chat_messages
   where room_id = p_room
     and id not in (select id from public.chat_messages where room_id = p_room order by created_at desc limit 200);
end; $$;

-- Rent a free village plot for one season: 250 xu to the village, 96 h (§7.2).
create or replace function public._farm_do_rent(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.kind <> 'village' then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'plot taken' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < 250 then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(p_account, -250, 'rent', 'plot ' || p_plot);
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (p_room, p_plot, p_account, 'village', 250, p_now, p_now + interval '96 hours');
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Buy an ownerless private plot from the village for 4 000 xu; one private plot per room (§7.3).
create or replace function public._farm_do_buy_plot(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.kind <> 'private' or f.owner_id is not null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'leased' using errcode = '22023';
  end if;
  if public._owns_land(p_room, p_account) then
    raise exception 'already own land' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < 4000 then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(p_account, -4000, 'land_buy', 'plot ' || p_plot);
  update public.field_plots set owner_id = p_account, owned_at = p_now, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Sell your plot back to the village for 2 000 xu. A plot on lease goes to the village when the lease ends (§7.3).
create or replace function public._farm_do_sell_to_village(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if exists (select 1 from public.crops cr where cr.room_id = p_room and cr.plot_no = p_plot and cr.farmer_id = p_account) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  update public.field_plots set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
   where room_id = p_room and plot_no = p_plot;
  delete from public.land_offers where room_id = p_room and plot_no = p_plot;
  perform public._pay(p_account, 2000, 'land_sell', 'plot ' || p_plot || ' to the village');
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- List your bare, unleased plot for sale at 1–1 000 000 xu; null withdraws the listing (§7.3).
create or replace function public._farm_do_list(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if p_price is not null then
    if p_price < 1 or p_price > 1000000 then
      raise exception 'invalid price' using errcode = '22023';
    end if;
    if public._has_crop(p_room, p_plot) then
      raise exception 'crop exists' using errcode = '22023';
    end if;
    if public._leased(p_room, p_plot, p_now) then
      raise exception 'leased' using errcode = '22023';
    end if;
  end if;
  update public.field_plots set sale_price = p_price where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Buy a listed plot at exactly its listed price (§7.3).
create or replace function public._farm_do_buy_listed(p_room uuid, p_account uuid, p_plot integer, p_expected integer,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null or f.sale_price is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_expected is distinct from f.sale_price then
    raise exception 'price changed' using errcode = '22023';
  end if;
  if public._has_crop(p_room, p_plot) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'leased' using errcode = '22023';
  end if;
  if public._owns_land(p_room, p_account) then
    raise exception 'already own land' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < f.sale_price then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._land_sale(p_room, p_plot, p_account, f.sale_price, p_now);
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Offer to buy someone's plot. One offer per buyer and plot: a new one replaces the old one (with a new id, so the
-- owner never accepts a price they did not see). Offers expire after 24 h and reserve no xu (§7.3).
create or replace function public._farm_do_offer(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                 p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_price is null or p_price < 1 or p_price > 1000000 then
    raise exception 'invalid price' using errcode = '22023';
  end if;
  if public._owns_land(p_room, p_account) then
    raise exception 'already own land' using errcode = '22023';
  end if;
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (p_room, p_plot, p_account, p_price, p_now)
  on conflict (room_id, plot_no, buyer_id) do update
    set id = gen_random_uuid(), price = excluded.price, created_at = excluded.created_at;
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_withdraw_offer(p_room uuid, p_account uuid, p_offer uuid, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  delete from public.land_offers where id = p_offer and room_id = p_room and buyer_id = p_account;
  if not found then
    raise exception 'offer not found' using errcode = '22023';
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_decline_offer(p_room uuid, p_account uuid, p_offer uuid, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  delete from public.land_offers lo using public.field_plots fp
   where lo.id = p_offer and lo.room_id = p_room
     and fp.room_id = lo.room_id and fp.plot_no = lo.plot_no and fp.owner_id = p_account;
  if not found then
    raise exception 'offer not found' using errcode = '22023';
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- The owner accepts an offer. The buyer's membership, land, farming limit and xu are checked now (§7.3).
create or replace function public._farm_do_accept_offer(p_room uuid, p_account uuid, p_offer uuid, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare o public.land_offers; f public.field_plots; bw public.wallets;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into o from public.land_offers where id = p_offer and room_id = p_room;
  if not found then
    raise exception 'offer expired' using errcode = '22023';
  end if;
  f := public._plot_row(p_room, o.plot_no);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if public._has_crop(p_room, o.plot_no) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._leased(p_room, o.plot_no, p_now) then
    raise exception 'leased' using errcode = '22023';
  end if;
  bw := public._wallet_lock(o.buyer_id);
  if not exists (select 1 from public.members m where m.room_id = p_room and m.account_id = o.buyer_id)
     or public._owns_land(p_room, o.buyer_id)
     or public._farm_count(p_room, o.buyer_id, p_now) >= 2
     or bw.coins < o.price then
    raise exception 'buyer cannot buy' using errcode = '22023';
  end if;
  perform public._land_sale(p_room, o.plot_no, o.buyer_id, o.price, p_now);
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Offer your bare, unleased plot for one season at 1–5 000 xu; null withdraws it (§7.3).
create or replace function public._farm_do_set_sublease(p_room uuid, p_account uuid, p_plot integer, p_price integer,
                                                        p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  if p_price is not null then
    if p_price < 1 or p_price > 5000 then
      raise exception 'invalid price' using errcode = '22023';
    end if;
    if public._has_crop(p_room, p_plot) then
      raise exception 'crop exists' using errcode = '22023';
    end if;
    if public._leased(p_room, p_plot, p_now) then
      raise exception 'leased' using errcode = '22023';
    end if;
  end if;
  update public.field_plots set sublease_price = p_price where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Rent a subleased plot at exactly its price: the owner is paid, the lease runs 96 h, the offers are withdrawn.
create or replace function public._farm_do_rent_sublease(p_room uuid, p_account uuid, p_plot integer, p_expected integer,
                                                         p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; f public.field_plots;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  f := public._plot_row(p_room, p_plot);
  if f.owner_id is null or f.sublease_price is null then
    raise exception 'not for sale' using errcode = '22023';
  end if;
  if f.owner_id = p_account then
    raise exception 'invalid plot' using errcode = '22023';
  end if;
  if p_expected is distinct from f.sublease_price then
    raise exception 'price changed' using errcode = '22023';
  end if;
  if public._leased(p_room, p_plot, p_now) then
    raise exception 'plot taken' using errcode = '22023';
  end if;
  if public._has_crop(p_room, p_plot) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._farm_count(p_room, p_account, p_now) >= 2 then
    raise exception 'farm limit' using errcode = '22023';
  end if;
  if w.coins < f.sublease_price then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._wallet_lock(f.owner_id);
  perform public._pay(p_account, -f.sublease_price, 'lease_pay', 'plot ' || p_plot);
  perform public._pay(f.owner_id, f.sublease_price, 'lease_income', 'plot ' || p_plot);
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (p_room, p_plot, p_account, 'owner', f.sublease_price, p_now, p_now + interval '96 hours');
  update public.field_plots set sublease_price = null, sale_price = null where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- The farmer gives up the crop; the plot is bare again and the lease (if any) goes on (§7.4).
create or replace function public._farm_do_abandon(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  delete from public.crops where room_id = p_room and plot_no = p_plot;
  if not found then
    raise exception 'no crop' using errcode = '22023';
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

revoke all on function public._land_sale(uuid, integer, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_rent(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_buy_plot(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_sell_to_village(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_list(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_buy_listed(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_offer(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_withdraw_offer(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_decline_offer(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_accept_offer(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_set_sublease(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_rent_sublease(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_abandon(uuid, uuid, integer, timestamptz) from public, anon, authenticated;

create or replace function public.rent_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_rent(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.buy_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_buy_plot(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.sell_plot_to_village(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_sell_to_village(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.list_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_list(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_price, now()) $$;

create or replace function public.buy_listed_plot(p_room_id uuid, p_session_token text, p_plot integer,
                                                  p_expected_price integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$
  select public._farm_do_buy_listed(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_expected_price, now())
$$;

create or replace function public.offer_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_price, now()) $$;

create or replace function public.withdraw_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_withdraw_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_offer_id, now()) $$;

create or replace function public.decline_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_decline_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_offer_id, now()) $$;

create or replace function public.accept_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_accept_offer(p_room_id, public._farm_auth(p_room_id, p_session_token), p_offer_id, now()) $$;

create or replace function public.set_sublease(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_set_sublease(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_price, now()) $$;

create or replace function public.rent_sublease(p_room_id uuid, p_session_token text, p_plot integer,
                                                p_expected_price integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$
  select public._farm_do_rent_sublease(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_expected_price,
                                       now())
$$;

create or replace function public.abandon_crop(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_abandon(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

grant execute on function public.rent_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.buy_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_plot_to_village(uuid, text, integer) to anon, authenticated;
grant execute on function public.list_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.buy_listed_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.offer_plot(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.withdraw_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.decline_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.accept_offer(uuid, text, uuid) to anon, authenticated;
grant execute on function public.set_sublease(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.rent_sublease(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.abandon_crop(uuid, text, integer) to anon, authenticated;
```

- [ ] **Step 2: Extend the smoke test**

**tests/sql/v15-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- land (§7): the private cores, with the clock moved by hand ----------
insert into smoke select 'now', date_trunc('minute', now())::text;
create function pg_temp.coins(a uuid) returns integer language sql as $$ select coins from public.wallets where account_id = a $$;
create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.plot(s jsonb, n integer) returns jsonb language sql as $$ select s->'plots'->(n - 1) $$;

do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; s jsonb;
begin
  -- the first field_state creates the plots
  s := public.field_state(room, t1);
  assert jsonb_array_length(s->'plots') = 10, 'ten plots';
  assert pg_temp.plot(s, 1)->>'kind' = 'private' and pg_temp.plot(s, 4)->>'kind' = 'private'
     and pg_temp.plot(s, 5)->>'kind' = 'village' and pg_temp.plot(s, 10)->>'kind' = 'village', 'plots 1-4 private, 5-10 village';
  assert s->'mine'->'owned_plot' = 'null' and s->'mine'->'farming' = '[]' and s->'drying' = '[]', 'nothing yet';
  assert s->'mine'->'gift_claimed' = 'false' and (s->>'server_now')::timestamptz = now(), 'gift flag and server_now';

  -- visits: touch_room and every field call record them, at most once an hour
  update public.members set last_seen_at = null where room_id = room and account_id = a2;
  perform public.touch_room(room, t2);
  assert (select last_seen_at from public.members where room_id = room and account_id = a2) = now(), 'touch records the visit';
  update public.members set last_seen_at = now() - interval '30 minutes' where room_id = room and account_id = a2;
  perform public.touch_room(room, t2);
  assert (select last_seen_at from public.members where room_id = room and account_id = a2) = now() - interval '30 minutes',
    'at most once an hour';
  update public.members set last_seen_at = now() - interval '2 hours' where room_id = room and account_id = a2;
  perform public.field_state(room, t2);
  assert (select last_seen_at from public.members where room_id = room and account_id = a2) = now(), 'field calls too';
  assert pg_temp.err(format('select public.touch_room(%L, %L)', gen_random_uuid(), t2)) = 'account is not a member of this room',
    'members only';

  -- rent a village plot (§7.2)
  perform pg_temp.set_coins(a1, 20000);
  perform pg_temp.set_coins(a2, 1000);
  perform pg_temp.set_coins(a3, 20000);
  s := public._farm_do_rent(room, a2, 5, t);
  assert pg_temp.coins(a2) = 750, 'rent is 250';
  assert pg_temp.plot(s, 5)->'lease'->>'source' = 'village' and pg_temp.plot(s, 5)->'farmer'->>'id' = a2::text
     and (pg_temp.plot(s, 5)->'lease'->>'until')::timestamptz = t + interval '96 hours', 'a village lease for 96 h';
  assert s->'mine'->'farming' = '[5]', 'farming plot 5';
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'rent' and delta = -250), 'rent ledger';
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 5, %L)', room, a3, t)) = 'plot taken', 'taken';
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 1, %L)', room, a3, t)) = 'invalid plot', 'private plots are not rented';
  perform public._farm_do_rent(room, a2, 6, t);
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 7, %L)', room, a2, t)) = 'farm limit', 'two plots at most';
  perform pg_temp.set_coins(a3, 100);
  assert pg_temp.err(format('select public._farm_do_rent(%L, %L, 7, %L)', room, a3, t)) = 'not enough coins', 'coins';
  perform pg_temp.set_coins(a3, 20000);
  -- the lease ends after 96 h and takes the leaseholder's crop with it
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 5, a2, t);
  perform public._field_open(room, t + interval '96 hours');
  assert not exists (select 1 from public.plot_leases where room_id = room), 'leases ended';
  assert not exists (select 1 from public.crops where room_id = room), 'the crop went with the lease';
end $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '100 hours'; s jsonb; o uuid; o2 uuid;
begin
  -- buy from the village (§7.3)
  s := public._farm_do_buy_plot(room, a1, 1, t);
  assert pg_temp.coins(a1) = 16000 and pg_temp.plot(s, 1)->'owner'->>'id' = a1::text
     and s->'mine'->'owned_plot' = '1', 'bought plot 1';
  assert s->'mine'->'farming' = '[1]', 'an unleased own plot is farmed';
  assert exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'land_buy' and delta = -4000), 'ledger';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 2, %L)', room, a1, t)) = 'already own land', 'one per room';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', room, a3, t)) = 'not for sale', 'owned';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 5, %L)', room, a3, t)) = 'not for sale', 'village land';
  perform public._farm_do_rent(room, a2, 5, t);
  perform public._farm_do_rent(room, a2, 6, t);
  perform pg_temp.set_coins(a2, 10000);
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 2, %L)', room, a2, t)) = 'farm limit', 'land counts too';

  -- the owner's own crop blocks selling, listing and subleasing
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 1, a1, t);
  assert pg_temp.err(format('select public._farm_do_sell_to_village(%L, %L, 1, %L)', room, a1, t)) = 'crop exists', 'sell';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 9000, %L)', room, a1, t)) = 'crop exists', 'list';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'crop exists', 'sublease';
  delete from public.crops where room_id = room;

  -- list, and buy a listed plot at exactly its price
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 9000, %L)', room, a2, t)) = 'not your plot', 'owner lists';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 0, %L)', room, a1, t)) = 'invalid price', 'price range';
  s := public._farm_do_list(room, a1, 1, 9000, t);
  assert pg_temp.plot(s, 1)->'sale_price' = '9000', 'listed';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 8000, %L)', room, a3, t)) = 'price changed', 'exact price';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 9000, %L)', room, a1, t)) = 'invalid plot', 'not your own';
  s := public._farm_do_buy_listed(room, a3, 1, 9000, t);
  assert pg_temp.plot(s, 1)->'owner'->>'id' = a3::text and pg_temp.plot(s, 1)->'sale_price' = 'null', 'sold to a3';
  assert pg_temp.coins(a3) = 11000 and pg_temp.coins(a1) = 25000, 'paid 9 000';
  assert exists (select 1 from public.chat_messages where room_id = room and account_id is null and username = 'Hợp tác xã'
                   and body like '[land:1] 🏡 % đã mua thửa 1 của % với giá 9.000 xu.'), 'announced in chat';
  assert pg_temp.err(format('select public._farm_do_buy_listed(%L, %L, 1, 9000, %L)', room, a2, t)) = 'not for sale', 'sold once';

  -- offers: the owner sees them best first, checks the buyer on acceptance, and a re-offer gets a new id
  perform public._farm_do_offer(room, a1, 1, 5000, t);
  s := public._farm_do_offer(room, a2, 1, 6000, t);
  assert pg_temp.plot(s, 1)->'offers' = '2' and jsonb_array_length(s->'mine'->'my_offers') = 1, 'two offers';
  s := public._field_view(room, a3, t);
  assert jsonb_array_length(s->'mine'->'incoming_offers') = 2 and s->'mine'->'incoming_offers'->0->'price' = '6000'
     and (s->'mine'->'incoming_offers'->0->>'expires_at')::timestamptz = t + interval '24 hours', 'the owner sees them';
  select id into o from public.land_offers where room_id = room and buyer_id = a2;
  assert pg_temp.err(format('select public._farm_do_accept_offer(%L, %L, %L, %L)', room, a3, o, t)) = 'buyer cannot buy',
    'a2 farms two plots already';
  assert pg_temp.err(format('select public._farm_do_accept_offer(%L, %L, %L, %L)', room, a1, o, t)) = 'not your plot', 'owner';
  assert pg_temp.err(format('select public._farm_do_decline_offer(%L, %L, %L, %L)', room, a1, o, t)) = 'offer not found', 'owner';
  perform public._farm_do_decline_offer(room, a3, o, t);
  select id into o from public.land_offers where room_id = room and buyer_id = a1;
  perform public._farm_do_offer(room, a1, 1, 5500, t);
  select id into o2 from public.land_offers where room_id = room and buyer_id = a1;
  assert o2 <> o and (select count(*) from public.land_offers where room_id = room) = 1, 'the new offer replaced the old one';
  assert pg_temp.err(format('select public._farm_do_accept_offer(%L, %L, %L, %L)', room, a3, o, t)) = 'offer expired', 'old id';
  s := public._farm_do_accept_offer(room, a3, o2, t);
  assert pg_temp.plot(s, 1)->'owner'->>'id' = a1::text and pg_temp.coins(a1) = 19500 and pg_temp.coins(a3) = 16500, 'sold for 5 500';
  assert not exists (select 1 from public.land_offers where room_id = room), 'offers cleared';
  -- withdraw, refusals, expiry
  perform public._farm_do_offer(room, a3, 1, 7000, t);
  select id into o from public.land_offers where room_id = room and buyer_id = a3;
  perform public._farm_do_withdraw_offer(room, a3, o, t);
  assert pg_temp.err(format('select public._farm_do_withdraw_offer(%L, %L, %L, %L)', room, a3, o, t)) = 'offer not found', 'gone';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 2, 100, %L)', room, a3, t)) = 'not for sale', 'no owner';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 1, 100, %L)', room, a1, t)) = 'invalid plot', 'your own';
  assert pg_temp.err(format('select public._farm_do_offer(%L, %L, 1, 0, %L)', room, a3, t)) = 'invalid price', 'price range';
  perform public._farm_do_offer(room, a3, 1, 4000, t);
  perform public._field_open(room, t + interval '24 hours');
  assert not exists (select 1 from public.land_offers where room_id = room), 'offers expire after 24 h';

  -- sublease: the renter pays the owner; the owner's land offers are frozen while it is leased
  t := t + interval '25 hours';
  s := public._farm_do_set_sublease(room, a1, 1, 300, t);
  assert pg_temp.plot(s, 1)->'sublease_price' = '300', 'sublease offered';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 6000, %L)', room, a1, t)) = 'invalid price', 'range';
  assert pg_temp.err(format('select public._farm_do_rent_sublease(%L, %L, 1, 250, %L)', room, a3, t)) = 'price changed', 'exact';
  assert pg_temp.err(format('select public._farm_do_rent_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'invalid plot', 'own';
  s := public._farm_do_rent_sublease(room, a3, 1, 300, t);
  assert pg_temp.plot(s, 1)->'lease'->>'source' = 'owner' and pg_temp.plot(s, 1)->'farmer'->>'id' = a3::text
     and pg_temp.plot(s, 1)->'sublease_price' = 'null', 'a3 farms plot 1';
  assert pg_temp.coins(a1) = 19800 and pg_temp.coins(a3) = 16200, 'paid the owner';
  assert exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'lease_income' and delta = 300)
     and exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'lease_pay' and delta = -300), 'ledger';
  assert pg_temp.err(format('select public._farm_do_set_sublease(%L, %L, 1, 300, %L)', room, a1, t)) = 'leased', 'leased';
  assert pg_temp.err(format('select public._farm_do_list(%L, %L, 1, 5000, %L)', room, a1, t)) = 'leased', 'leased';
  -- sell back to the village while leased: paid now, the village takes the plot when the lease ends
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 1, a3, t);
  s := public._farm_do_sell_to_village(room, a1, 1, t);
  assert pg_temp.plot(s, 1)->'owner' = 'null' and pg_temp.plot(s, 1)->'farmer'->>'id' = a3::text, 'the lease goes on';
  assert pg_temp.coins(a1) = 21800, 'paid 2 000';
  assert pg_temp.err(format('select public._farm_do_buy_plot(%L, %L, 1, %L)', room, a2, t)) = 'leased', 'not until the lease ends';
  perform public._field_open(room, t + interval '96 hours');
  assert not exists (select 1 from public.plot_leases where room_id = room and plot_no = 1)
     and not exists (select 1 from public.crops where room_id = room and plot_no = 1), 'the lease and its crop ended';
end $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '250 hours';
begin
  -- reclaim after 14 days away: the owner is refunded 2 000 (§7.6)
  perform public._farm_do_buy_plot(room, a3, 2, t);
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 2, a3, t);
  update public.members set joined_at = t - interval '20 days', last_seen_at = t - interval '15 days'
   where room_id = room and account_id = a3;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 2) is null
     and not exists (select 1 from public.crops where room_id = room and plot_no = 2), 'reclaimed with its crop';
  assert pg_temp.coins(a3) = 14200 and exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'land_refund'),
    'refunded';
  update public.members set last_seen_at = t where room_id = room and account_id = a3;
  -- reclaim when the owner leaves the room
  perform public._farm_do_buy_plot(room, a2, 3, t);
  delete from public.members where room_id = room and account_id = a2;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 3) is null and pg_temp.coins(a2) = 8000,
    'reclaimed from a leaver';
  -- a plot leased out is reclaimed only when the lease ends
  perform public._farm_do_buy_plot(room, a3, 4, t);
  perform public._farm_do_set_sublease(room, a3, 4, 100, t);
  perform public._farm_do_rent_sublease(room, a1, 4, 100, t);
  update public.members set last_seen_at = t - interval '15 days' where room_id = room and account_id = a3;
  perform public._field_open(room, t);
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 4) = a3, 'waits for the lease';
  perform public._field_open(room, t + interval '97 hours');
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 4) is null
     and pg_temp.coins(a3) = 10200 + 100 + 2000, 'reclaimed after the lease';
  update public.members set last_seen_at = null where room_id = room and account_id = a3;
  -- abandon: the farmer clears the crop, the lease goes on
  t := t + interval '98 hours';
  perform public._farm_do_rent(room, a1, 7, t);
  insert into public.crops (room_id, plot_no, farmer_id, prepared_at) values (room, 7, a1, t);
  assert pg_temp.err(format('select public._farm_do_abandon(%L, %L, 7, %L)', room, a3, t)) = 'not your plot', 'farmer only';
  perform public._farm_do_abandon(room, a1, 7, t);
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 7)
     and exists (select 1 from public.plot_leases where room_id = room and plot_no = 7), 'bare, still leased';
  assert pg_temp.err(format('select public._farm_do_abandon(%L, %L, 7, %L)', room, a1, t)) = 'no crop', 'nothing to abandon';
end $$;
select public.join_room((select v from smoke where k = 'code'), 'pw', (select v from smoke where k = 't2'));

select 'v15 land smoke ok' as result;
```

- [ ] **Step 3: Replay twice and run the smoke test**

Run the same commands as Task 1 Step 4 (fresh cluster, `export PGCLIENTENCODING=UTF8`, from the repo root).
Expected: no `FAILED`, `0013 ok`, `0013 re-run ok`, and the smoke test prints `v15 crop smoke ok` then `v15 land smoke ok`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_v15_field.sql tests/sql/v15-smoke.sql
git commit -m "feat(v15): the field state, the sweep and land RPCs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Database — farming, drying and trade

**Files:**
- Modify: `supabase/migrations/0013_v15_field.sql` (append section G)
- Modify: `tests/sql/v15-smoke.sql` (append the season, drying and selling checks)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces (Postgres): helpers `_farm_crop`, `_use_item`, `_work_check`, `_work_gate` (2 s); cores `_farm_do_prepare|fertilize|soak|sow|begin_work|transplant|water|spray|pick_snails|harvest|dry_start|dry_collect(…, p_now)` (`_farm_do_sow` stores the three hidden pest rolls; transplant and harvest clamp the quality to [0.9, 1.1]; harvest answers the view plus `harvest: {variety, kg}`; drying takes 3 h); public RPCs `prepare_plot(p_plot)`, `apply_fertilizer(p_plot, p_item_id)`, `soak_seed(p_plot, p_item_id)`, `sow_seed(p_plot)`, `begin_work(p_plot, p_work)`, `transplant(p_plot, p_quality double precision)`, `water(p_plot, p_delta)`, `spray(p_plot, p_item_id)`, `pick_snails(p_plot)`, `harvest(p_plot, p_quality)`, `dry_start(p_variety, p_kg)`, `dry_collect(p_slot)` (all with `p_room_id, p_session_token` first, answering `field_state`); account RPCs `sell_rice(p_session_token, p_variety, p_dry boolean, p_kg)`, `buy_farm_item(p_session_token, p_item_id, p_qty)` (qty 1–99, at most 99 held) and `claim_farm_gift(p_session_token)`, answering `{server_now, mine}` (the gift adds `gifted`).

- [ ] **Step 1: Append section G to the migration**

**supabase/migrations/0013_v15_field.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- G. Farming, drying and trade (spec §8, §9). Each _farm_do_* takes p_now; its RPC passes now(). ----------
-- The crop of a plot the account farms.
create or replace function public._farm_crop(p_room uuid, p_plot integer, p_account uuid, p_now timestamptz)
returns public.crops
language plpgsql stable security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if not found then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  return c;
end; $$;

-- One farm consumable out of the inventory.
create or replace function public._use_item(p_account uuid, p_item text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  update public.inventory set qty = qty - 1 where account_id = p_account and item_id = p_item and qty >= 1;
  if not found then
    raise exception 'no item' using errcode = '22023';
  end if;
end; $$;

-- Transplanting needs seedlings ≥ 8·s h old in shallow water (Nông); harvesting needs ripe rice in a drained plot (≤ Ẩm).
create or replace function public._work_check(c public.crops, v public.rice_varieties, p_work text, p_now timestamptz)
returns void
language plpgsql stable set search_path = public, extensions
as $$
begin
  if p_work = 'transplant' then
    if public._crop_phase(c, v, p_now) <> 'seedling' or public._hrs(c.sow_at, p_now) < 8 * v.scale then
      raise exception 'wrong phase' using errcode = '22023';
    end if;
    if public._water_at(c.water_log, p_now) <> 2 then
      raise exception 'need water' using errcode = '22023';
    end if;
  elsif p_work = 'harvest' then
    if public._crop_phase(c, v, p_now) not in ('ripe', 'overripe') then
      raise exception 'wrong phase' using errcode = '22023';
    end if;
    if public._water_at(c.water_log, p_now) > 1 then
      raise exception 'need water' using errcode = '22023';
    end if;
  else
    raise exception 'invalid work' using errcode = '22023';
  end if;
end; $$;

-- The work gate (§11.4): the matching begin_work at least 2 s earlier.
create or replace function public._work_gate(c public.crops, p_work text, p_now timestamptz) returns void
language plpgsql stable set search_path = public, extensions
as $$
begin
  if c.work is distinct from p_work or c.work_started_at is null or p_now - c.work_started_at < interval '2 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
end; $$;

-- Làm đất: floods the plot (water 3). Farming withdraws the owner's listing and sublease offer (§7.3).
create or replace function public._farm_do_prepare(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if found and c.prepared_at is not null then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if found then
    update public.crops
       set prepared_at = p_now, water_log = water_log || jsonb_build_array(jsonb_build_object('t', p_now, 'l', 3))
     where room_id = p_room and plot_no = p_plot;
  else
    insert into public.crops (room_id, plot_no, farmer_id, prepared_at, water_log)
    values (p_room, p_plot, p_account, p_now, jsonb_build_array(jsonb_build_object('t', p_now, 'l', 3)));
  end if;
  update public.field_plots set sale_price = null, sublease_price = null where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Any fertilizer, any time after làm đất; the plot panel warns before a wasted one (§8.4).
create or replace function public._farm_do_fertilize(p_room uuid, p_account uuid, p_plot integer, p_item text,
                                                     p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if not exists (select 1 from public.shop_items where id = p_item and kind = 'fertilizer') then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  update public.crops set fert_log = fert_log || jsonb_build_array(jsonb_build_object('t', p_now, 'item', p_item))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Ngâm ủ: one bag of seed, before or after làm đất. Sprouted after 2 h, rots 24 h later if not sown (§8.2).
create or replace function public._farm_do_soak(p_room uuid, p_account uuid, p_plot integer, p_item text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v_variety text; v_has boolean;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select variety into v_variety from public.shop_items where id = p_item and kind = 'seed';
  if v_variety is null then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  v_has := found;
  if v_has and (c.soak_at is not null or c.sow_at is not null) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  if v_has then
    update public.crops set variety = v_variety, soak_at = p_now, rotted_at = null where room_id = p_room and plot_no = p_plot;
  else
    insert into public.crops (room_id, plot_no, farmer_id, variety, soak_at) values (p_room, p_plot, p_account, v_variety, p_now);
    update public.field_plots set sale_price = null, sublease_price = null where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Gieo mạ: sprouted seed on a prepared, moist (Ẩm) seedbed. The three pest chances are rolled now and stay secret (§8.5).
create or replace function public._farm_do_sow(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if public._crop_phase(c, public._variety(c.variety), p_now) <> 'sprouted' then
    raise exception 'wrong phase' using errcode = '22023';
  end if;
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  if public._water_at(c.water_log, p_now) <> 1 then
    raise exception 'need water' using errcode = '22023';
  end if;
  update public.crops
     set sow_at = p_now,
         pest_rolls = jsonb_build_array(
           jsonb_build_object('slot', 1, 'u_time', random(), 'u_kind', random(), 'u_hit', random()),
           jsonb_build_object('slot', 2, 'u_time', random(), 'u_kind', random(), 'u_hit', random()),
           jsonb_build_object('slot', 3, 'u_time', random(), 'u_kind', random(), 'u_hit', random()))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Starts the 2-second transplant or harvest action (§11.4).
create or replace function public._farm_do_begin_work(p_room uuid, p_account uuid, p_plot integer, p_work text,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  perform public._work_check(c, public._variety(c.variety), p_work, p_now);
  update public.crops set work = p_work, work_started_at = p_now where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Cấy: the quality (v15.2 minigame; 1.0 in v15.1) is clamped to [0.9, 1.1].
create or replace function public._farm_do_transplant(p_room uuid, p_account uuid, p_plot integer, p_quality double precision,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  perform public._work_gate(c, 'transplant', p_now);
  perform public._work_check(c, public._variety(c.variety), 'transplant', p_now);
  update public.crops
     set transplant_at = p_now, q_transplant = least(1.1, greatest(0.9, coalesce(p_quality, 1))),
         work = null, work_started_at = null
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Bơm (+1) or tháo (−1) one level from the current one (§8.3). The log is capped against spamming.
create or replace function public._farm_do_water(p_room uuid, p_account uuid, p_plot integer, p_delta integer,
                                                 p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v_level integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if p_delta is null or p_delta not in (1, -1) then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  if jsonb_array_length(c.water_log) >= 200 then
    raise exception 'too fast' using errcode = '22023';
  end if;
  v_level := greatest(0, least(3, public._water_at(c.water_log, p_now) + p_delta));
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', p_now, 'l', v_level))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Xịt thuốc: treats an active pest of its kind at this moment; otherwise it is wasted (§8.5).
create or replace function public._farm_do_spray(p_room uuid, p_account uuid, p_plot integer, p_item text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if not exists (select 1 from public.shop_items where id = p_item and kind = 'pesticide') then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  update public.crops set spray_log = spray_log || jsonb_build_array(jsonb_build_object('t', p_now, 'item', p_item))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Bắt ốc: anyone may pick the golden apple snails off any plot that has them (§8.5).
create or replace function public._farm_do_pick_snails(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if not found or not exists (select 1 from jsonb_array_elements(public._crop_pests(c, public._variety(c.variety), p_now)) x
                               where x->>'kind' = 'snail' and x->>'treated_at' is null) then
    raise exception 'no snails' using errcode = '22023';
  end if;
  update public.crops set picks = picks || jsonb_build_array(jsonb_build_object('t', p_now))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Gặt: the yield goes to the farmer's wet rice; the plot is bare and a lease ends with the season (§8.7).
create or replace function public._farm_do_harvest(p_room uuid, p_account uuid, p_plot integer, p_quality double precision,
                                                   p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v public.rice_varieties; f public.field_plots; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  v := public._variety(c.variety);
  perform public._work_gate(c, 'harvest', p_now);
  perform public._work_check(c, v, 'harvest', p_now);
  f := public._plot_row(p_room, p_plot);
  v_kg := (public._crop_yield(c, v, case when f.kind = 'private' then 1.1 else 1.0 end,
                              least(1.1, greatest(0.9, coalesce(p_quality, 1))), p_now)->>'kg')::int;
  perform public._rice_add(p_account, c.variety, v_kg, 0);
  delete from public.crops where room_id = p_room and plot_no = p_plot;
  delete from public.plot_leases where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest', jsonb_build_object('variety', c.variety, 'kg', v_kg));
end; $$;

-- Phơi lúa: wet rice into a free drying slot; dry after 3 h (§8.7).
create or replace function public._farm_do_dry_start(p_room uuid, p_account uuid, p_variety text, p_kg integer,
                                                     p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_wet integer; v_slot integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if p_kg is null or p_kg < 1 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  select wet_kg into v_wet from public.rice_stock where account_id = p_account and variety = p_variety;
  if coalesce(v_wet, 0) < p_kg then
    raise exception 'not enough rice' using errcode = '22023';
  end if;
  select min(n) into v_slot from generate_series(1, 4) n
   where not exists (select 1 from public.drying_slots ds where ds.room_id = p_room and ds.slot = n);
  if v_slot is null then
    raise exception 'drying full' using errcode = '22023';
  end if;
  update public.rice_stock set wet_kg = wet_kg - p_kg where account_id = p_account and variety = p_variety;
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at)
  values (p_room, v_slot, p_account, p_variety, p_kg, p_now + interval '3 hours');
  return public._field_view(p_room, p_account, p_now);
end; $$;

create or replace function public._farm_do_dry_collect(p_room uuid, p_account uuid, p_slot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare d public.drying_slots;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into d from public.drying_slots where room_id = p_room and slot = p_slot and account_id = p_account;
  if not found then
    raise exception 'invalid slot' using errcode = '22023';
  end if;
  if d.ready_at > p_now then
    raise exception 'not ready' using errcode = '22023';
  end if;
  delete from public.drying_slots where room_id = p_room and slot = p_slot;
  perform public._rice_add(p_account, d.variety, 0, d.kg);
  return public._field_view(p_room, p_account, p_now);
end; $$;

revoke all on function public._farm_crop(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._use_item(uuid, text) from public, anon, authenticated;
revoke all on function public._work_check(public.crops, public.rice_varieties, text, timestamptz) from public, anon, authenticated;
revoke all on function public._work_gate(public.crops, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_prepare(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_fertilize(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_soak(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_sow(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_begin_work(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_transplant(uuid, uuid, integer, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._farm_do_water(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_spray(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_pick_snails(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_harvest(uuid, uuid, integer, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._farm_do_dry_start(uuid, uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_dry_collect(uuid, uuid, integer, timestamptz) from public, anon, authenticated;

create or replace function public.prepare_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_prepare(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.apply_fertilizer(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_fertilize(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_item_id, now()) $$;

create or replace function public.soak_seed(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_soak(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_item_id, now()) $$;

create or replace function public.sow_seed(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_sow(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.begin_work(p_room_id uuid, p_session_token text, p_plot integer, p_work text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_begin_work(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_work, now()) $$;

create or replace function public.transplant(p_room_id uuid, p_session_token text, p_plot integer,
                                             p_quality double precision) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_transplant(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_quality, now()) $$;

create or replace function public.water(p_room_id uuid, p_session_token text, p_plot integer, p_delta integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_water(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_delta, now()) $$;

create or replace function public.spray(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_spray(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_item_id, now()) $$;

create or replace function public.pick_snails(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_pick_snails(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, now()) $$;

create or replace function public.harvest(p_room_id uuid, p_session_token text, p_plot integer,
                                          p_quality double precision) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_harvest(p_room_id, public._farm_auth(p_room_id, p_session_token), p_plot, p_quality, now()) $$;

create or replace function public.dry_start(p_room_id uuid, p_session_token text, p_variety text, p_kg integer)
returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_dry_start(p_room_id, public._farm_auth(p_room_id, p_session_token), p_variety, p_kg, now()) $$;

create or replace function public.dry_collect(p_room_id uuid, p_session_token text, p_slot integer) returns jsonb
language sql security definer set search_path = public, extensions
as $$ select public._farm_do_dry_collect(p_room_id, public._farm_auth(p_room_id, p_session_token), p_slot, now()) $$;

-- Bán lúa at cô Út: dry rice at the full price per kg, wet rice at 70 % (§8.7). No room: answers { server_now, mine }.
create or replace function public.sell_rice(p_session_token text, p_variety text, p_dry boolean, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v public.rice_varieties; rs public.rice_stock; v_pay integer;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  v := public._variety(p_variety);
  if v.id is null then
    raise exception 'invalid variety' using errcode = '22023';
  end if;
  if p_kg is null or p_kg < 1 or p_dry is null then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  select * into rs from public.rice_stock where account_id = v_account and variety = p_variety for update;
  if not found or (case when p_dry then rs.dry_kg else rs.wet_kg end) < p_kg then
    raise exception 'not enough rice' using errcode = '22023';
  end if;
  v_pay := case when p_dry then p_kg * v.price_per_kg else (p_kg * v.price_per_kg * 7) / 10 end;
  update public.rice_stock
     set dry_kg = dry_kg - case when p_dry then p_kg else 0 end, wet_kg = wet_kg - case when p_dry then 0 else p_kg end
   where account_id = v_account and variety = p_variety;
  perform public._pay(v_account, v_pay, 'rice_sell',
                      p_variety || case when p_dry then ' dry ' else ' wet ' end || p_kg || ' kg');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- The farm shop at anh Hai: seeds, fertilizers and pesticides, 1–99 at a time and at most 99 held (§9).
create or replace function public.buy_farm_item(p_session_token text, p_item_id text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; it public.shop_items; v_cost integer;
begin
  v_account := public._auth_account(p_session_token);
  w := public._wallet_lock(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null or it.kind not in ('seed', 'fertilizer', 'pesticide') then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99
     or coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + p_qty > 99 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  v_cost := it.price * p_qty;
  if w.coins < v_cost then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(v_account, -v_cost, 'farm_buy', it.id || ' x' || p_qty);
  insert into public.inventory (account_id, item_id, qty) values (v_account, it.id, p_qty)
  on conflict (account_id, item_id) do update set qty = public.inventory.qty + excluded.qty;
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- Chú Tám's gift on the first field visit: 1 seed_short and 1 fert_urea, once per account (§8.8).
create or replace function public.claim_farm_gift(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_gifted boolean;
begin
  v_account := public._auth_account(p_session_token);
  perform public._wallet_lock(v_account);
  insert into public.farm_profiles (account_id) values (v_account) on conflict (account_id) do nothing;
  update public.farm_profiles set gift_at = now() where account_id = v_account and gift_at is null;
  v_gifted := found;
  if v_gifted then
    insert into public.inventory (account_id, item_id, qty) values (v_account, 'seed_short', 1), (v_account, 'fert_urea', 1)
    on conflict (account_id, item_id) do update set qty = least(99, public.inventory.qty + 1);
  end if;
  return jsonb_build_object('gifted', v_gifted, 'server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

grant execute on function public.prepare_plot(uuid, text, integer) to anon, authenticated;
grant execute on function public.apply_fertilizer(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.soak_seed(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.sow_seed(uuid, text, integer) to anon, authenticated;
grant execute on function public.begin_work(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.transplant(uuid, text, integer, double precision) to anon, authenticated;
grant execute on function public.water(uuid, text, integer, integer) to anon, authenticated;
grant execute on function public.spray(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.pick_snails(uuid, text, integer) to anon, authenticated;
grant execute on function public.harvest(uuid, text, integer, double precision) to anon, authenticated;
grant execute on function public.dry_start(uuid, text, text, integer) to anon, authenticated;
grant execute on function public.dry_collect(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_rice(text, text, boolean, integer) to anon, authenticated;
grant execute on function public.buy_farm_item(text, text, integer) to anon, authenticated;
grant execute on function public.claim_farm_gift(text) to anon, authenticated;
```

- [ ] **Step 2: Extend the smoke test**

**tests/sql/v15-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- farming (§8, §9): a whole season with the clock moved by hand, drying, selling, the gift ----------
insert into smoke select 'room2', room_id::text from public.create_room('Ruộng test', 'pw', (select v from smoke where k = 't2'));
insert into smoke select 'code2', code from public.rooms where id = (select v from smoke where k = 'room2')::uuid;
select public.join_room((select v from smoke where k = 'code2'), 'pw', (select v from smoke where k = 't3'));

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid; r jsonb;
begin
  -- chú Tám's gift, once per account
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'true' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1}' and r->>'server_now' is not null, 'gift';
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'false' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1}' and r->'mine'->'gift_claimed' = 'true',
    'only once';
  -- the farm shop at anh Hai
  perform pg_temp.set_coins(a2, 5000);
  r := public.buy_farm_item(t2, 'fert_manure', 2);
  assert r->'mine'->'coins' = '4920' and r->'mine'->'items'->'fert_manure' = '2', 'bought 2 manure';
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'farm_buy' and delta = -80), 'ledger';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 98)', t2, 'fert_manure')) = 'invalid quantity', '99 at most held';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 0)', t2, 'fert_manure')) = 'invalid quantity', 'qty 1-99';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t2, 'rod_bamboo')) = 'item not available', 'no fishing gear';
  perform pg_temp.set_coins(a2, 10);
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t2, 'seed_thom')) = 'not enough coins', 'coins';
  perform pg_temp.set_coins(a2, 5000);
  perform public.buy_farm_item(t2, 'fert_phosphate', 1);
  perform public.buy_farm_item(t2, 'fert_potash', 1);
  perform public.buy_farm_item(t2, 'spray_insect', 1);
  perform public.buy_farm_item(t2, 'spray_hopper', 1);
end $$;

do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        tp timestamptz; s jsonb; c public.crops; v_kg integer;
begin
  perform public._farm_do_rent(room, a2, 8, t);
  assert pg_temp.err(format('select public._farm_do_prepare(%L, %L, 8, %L)', room, a3, t)) = 'not your plot', 'farmer only';
  s := public._farm_do_prepare(room, a2, 8, t);
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'prepared' and pg_temp.plot(s, 8)->'crop'->'water' = '3', 'prepared, flooded';
  assert pg_temp.err(format('select public._farm_do_prepare(%L, %L, 8, %L)', room, a2, t)) = 'crop exists', 'once';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 8, %L)', room, a2, t)) = 'wrong phase', 'soak first';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 8, %L, %L)', room, a2, 'fert_urea', t)) = 'invalid item', 'seed';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 8, %L, %L)', room, a2, 'seed_nep', t)) = 'no item', 'no nep';
  s := public._farm_do_soak(room, a2, 8, 'seed_short', t);
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'soaking' and pg_temp.plot(s, 8)->'crop'->>'variety' = 'short'
     and s->'mine'->'items'->'seed_short' is null, 'soaking; the seed is used';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 8, %L, %L)', room, a2, 'seed_short', t)) = 'crop exists', 'once';
  perform public._farm_do_fertilize(room, a2, 8, 'fert_manure', t + interval '15 minutes');
  perform public._farm_do_fertilize(room, a2, 8, 'fert_phosphate', t + interval '15 minutes');
  assert pg_temp.err(format('select public._farm_do_fertilize(%L, %L, 8, %L, %L)', room, a2, 'seed_nep', t)) = 'invalid item', 'fert';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 8, %L)', room, a2, t + interval '1 hour')) = 'wrong phase',
    'still soaking';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 8, %L)', room, a2, t + interval '2 hours')) = 'need water',
    'sow on a moist bed';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 8, 2, %L)', room, a2, t)) = 'invalid quantity', '+1 or -1';
  perform public._farm_do_water(room, a2, 8, -1, t + interval '2 hours');
  s := public._farm_do_water(room, a2, 8, -1, t + interval '2 hours');
  assert pg_temp.plot(s, 8)->'crop'->'water' = '1'
     and (pg_temp.plot(s, 8)->'crop'->>'water_set_at')::timestamptz = t + interval '2 hours', 'drained to Ẩm';
  s := public._farm_do_sow(room, a2, 8, t + interval '2 hours 30 minutes');
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'seedling', 'sown';
  assert (select jsonb_array_length(pest_rolls) from public.crops where room_id = room and plot_no = 8) = 3, 'three secret rolls';
  assert pg_temp.plot(s, 8)->'crop'->'log' is not null and pg_temp.plot(s, 8)::text not like '%u_hit%', 'rolls stay secret';
  assert pg_temp.plot(public._field_view(room, a3, t + interval '3 hours'), 8)->'crop'->'log' is null, 'logs for the farmer only';

  -- transplant: seedlings ≥ 7.2 h (short) in shallow water, after a 2 s action
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'transplant', t + interval '9 hours'))
    = 'wrong phase', 'too young';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'transplant', t + interval '10 hours'))
    = 'need water', 'needs Nông';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'dig', t)) = 'invalid work', 'work';
  perform public._farm_do_water(room, a2, 8, 1, t + interval '10 hours');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 8, 1, %L)', room, a2, t + interval '10 hours'))
    = 'too fast', 'begin first';
  perform public._farm_do_begin_work(room, a2, 8, 'transplant', t + interval '10 hours');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 8, 1, %L)', room, a2, t + interval '10 hours 1 second'))
    = 'too fast', 'the 2 s gate';
  tp := t + interval '10 hours 3 seconds';
  s := public._farm_do_transplant(room, a2, 8, 5.0, tp);
  assert pg_temp.plot(s, 8)->'crop'->>'phase' = 'tillering'
     and (select q_transplant from public.crops where room_id = room and plot_no = 8) = 1.1, 'transplanted, quality clamped';

  -- pests: a snail at T = 3.6 h (water 2 → hit) and a leaf folder at T = 5.4 h
  update public.crops set pest_rolls = '[{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.1},
                                         {"slot": 2, "u_time": 0, "u_kind": 0.9, "u_hit": 0.1},
                                         {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}]'
   where room_id = room and plot_no = 8;
  s := public._field_view(room, a2, tp + interval '3 hours 30 minutes');
  assert pg_temp.plot(s, 8)->'crop'->'pests' = '[]', 'not yet due';
  s := public._field_view(room, a2, tp + interval '4 hours');
  assert pg_temp.plot(s, 8)->'crop'->'pests'->0->>'kind' = 'snail'
     and pg_temp.plot(s, 8)->'crop'->'pests'->0->'treated_at' = 'null', 'golden snails';
  s := public._farm_do_pick_snails(room, a3, 8, tp + interval '4 hours');
  assert pg_temp.plot(s, 8)->'crop'->'pests'->0->'treated_at' <> 'null', 'anyone may pick them';
  assert pg_temp.err(format('select public._farm_do_pick_snails(%L, %L, 8, %L)', room, a3, tp + interval '4 hours'))
    = 'no snails', 'picked already';
  perform public._farm_do_fertilize(room, a2, 8, 'fert_urea', tp + interval '4 hours');
  perform public._farm_do_spray(room, a2, 8, 'spray_hopper', tp + interval '5 hours 30 minutes');
  s := public._field_view(room, a2, tp + interval '5 hours 30 minutes');
  assert pg_temp.plot(s, 8)->'crop'->'pests'->1->>'kind' = 'leaf_folder'
     and pg_temp.plot(s, 8)->'crop'->'pests'->1->'treated_at' = 'null', 'the wrong spray does nothing';
  s := public._farm_do_spray(room, a2, 8, 'spray_insect', tp + interval '5 hours 45 minutes');
  assert (pg_temp.plot(s, 8)->'crop'->'pests'->1->>'treated_at')::timestamptz = tp + interval '5 hours 45 minutes', 'treated';
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 8, %L, %L)', room, a2, 'fert_urea', tp)) = 'invalid item', 'spray';
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 8, %L, %L)', room, a2, 'spray_fungus', tp)) = 'no item', 'none';
  perform public._farm_do_fertilize(room, a2, 8, 'fert_potash', tp + interval '18 hours');

  -- harvest: ripe at T = 43.2 h (short), in a drained plot, after a 2 s action; the lease ends with it
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '40 hours'))
    = 'wrong phase', 'not ripe';
  perform public._farm_do_water(room, a2, 8, 1, tp + interval '44 hours');
  perform public._farm_do_water(room, a2, 8, 1, tp + interval '44 hours');
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '44 hours'))
    = 'need water', 'drain first';
  perform public._farm_do_water(room, a2, 8, -1, tp + interval '44 hours');
  perform public._farm_do_begin_work(room, a2, 8, 'harvest', tp + interval '44 hours');
  select * into c from public.crops where room_id = room and plot_no = 8;
  v_kg := (public._crop_yield(c, public._variety('short'), 1.0, 1.0, tp + interval '44 hours 2 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a2, 8, 1, tp + interval '44 hours 2 seconds');
  assert s->'harvest' = jsonb_build_object('variety', 'short', 'kg', v_kg) and s->'mine'->'rice'->'short'->'wet' = to_jsonb(v_kg),
    format('harvested %s kg wet', v_kg);
  assert pg_temp.plot(s, 8)->'crop' = 'null' and pg_temp.plot(s, 8)->'lease' = 'null' and s->'mine'->'farming' = '[]',
    'bare, and the lease ended';
  insert into smoke values ('kg', v_kg::text);
end $$;

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '60 hours';
        v_kg integer := (select v from smoke where k = 'kg')::int; s jsonb; r jsonb; v_coins integer;
begin
  -- drying: 3 h per batch, 4 slots, collected automatically 24 h after it is ready
  assert pg_temp.err(format('select public._farm_do_dry_start(%L, %L, %L, 0, %L)', room, a2, 'short', t)) = 'invalid quantity', 'kg';
  assert pg_temp.err(format('select public._farm_do_dry_start(%L, %L, %L, 999, %L)', room, a2, 'short', t)) = 'not enough rice', 'kg';
  s := public._farm_do_dry_start(room, a2, 'short', 10, t);
  assert s->'drying'->0->'slot' = '1' and s->'drying'->0->'owner'->>'id' = a2::text and s->'drying'->0->'kg' = '10'
     and (s->'drying'->0->>'ready_at')::timestamptz = t + interval '3 hours' and s->'mine'->'rice'->'short'->'wet' = to_jsonb(v_kg - 10),
    'drying';
  assert pg_temp.err(format('select public._farm_do_dry_collect(%L, %L, 1, %L)', room, a2, t + interval '2 hours')) = 'not ready', 'ready';
  assert pg_temp.err(format('select public._farm_do_dry_collect(%L, %L, 1, %L)', room, a3, t + interval '3 hours')) = 'invalid slot',
    'yours only';
  s := public._farm_do_dry_collect(room, a2, 1, t + interval '3 hours');
  assert s->'drying' = '[]' and s->'mine'->'rice'->'short'->'dry' = '10', 'dry rice';
  perform public._farm_do_dry_start(room, a2, 'short', 1, t);
  perform public._farm_do_dry_start(room, a2, 'short', 1, t);
  perform public._farm_do_dry_start(room, a2, 'short', 1, t);
  perform public._farm_do_dry_start(room, a2, 'short', 1, t);
  assert pg_temp.err(format('select public._farm_do_dry_start(%L, %L, %L, 1, %L)', room, a2, 'short', t)) = 'drying full', 'full';
  perform public._field_open(room, t + interval '27 hours');
  assert not exists (select 1 from public.drying_slots where room_id = room)
     and (select dry_kg from public.rice_stock where account_id = a2 and variety = 'short') = 14, 'collected automatically';

  -- selling at cô Út: dry at 12 xu/kg, wet at 70 %
  v_coins := pg_temp.coins(a2);
  r := public.sell_rice(t2, 'short', true, 10);
  assert r->'mine'->'coins' = to_jsonb(v_coins + 120) and r->'mine'->'rice'->'short'->'dry' = '4', 'dry: 10 × 12';
  r := public.sell_rice(t2, 'short', false, 5);
  assert r->'mine'->'coins' = to_jsonb(v_coins + 120 + 42), 'wet: floor(5 × 12 × 0.7)';
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'rice_sell' and delta = 42), 'ledger';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 999)', t2, 'short')) = 'not enough rice', 'stock';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 1)', t2, 'bogus')) = 'invalid variety', 'variety';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, null, 1)', t2, 'short')) = 'invalid quantity', 'dry or wet';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 0)', t2, 'short')) = 'invalid quantity', 'kg';
end $$;

do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '100 hours'; s jsonb;
begin
  insert into public.inventory (account_id, item_id, qty) values (a3, 'seed_nep', 2)
  on conflict (account_id, item_id) do update set qty = 2;
  perform pg_temp.set_coins(a3, 1000);
  -- sprouted seed rots 24 h after sprouting: back to a prepared plot
  perform public._farm_do_rent(room, a3, 9, t);
  perform public._farm_do_prepare(room, a3, 9, t);
  perform public._farm_do_soak(room, a3, 9, 'seed_nep', t);
  s := public._field_view(room, a3, t + interval '25 hours 59 minutes');
  assert pg_temp.plot(s, 9)->'crop'->>'phase' = 'sprouted', 'still sprouted';
  perform public._field_open(room, t + interval '26 hours');
  s := public._field_view(room, a3, t + interval '26 hours');
  assert pg_temp.plot(s, 9)->'crop'->>'phase' = 'prepared' and pg_temp.plot(s, 9)->'crop'->'variety' = 'null'
     and (pg_temp.plot(s, 9)->'crop'->>'rotted_at')::timestamptz = t + interval '26 hours', 'rotted';
  -- soaking before làm đất: sowing and water need a prepared plot; unprepared rotten seed leaves the plot bare
  perform public._farm_do_rent(room, a3, 10, t);
  perform public._farm_do_soak(room, a3, 10, 'seed_nep', t);
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 10, %L)', room, a3, t + interval '3 hours')) = 'not prepared', 'sow';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 10, -1, %L)', room, a3, t)) = 'not prepared', 'water';
  perform public._field_open(room, t + interval '26 hours');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 10), 'bare again';
  -- rice left 48 h past its ripe window is lost
  update public.crops set variety = 'nep', soak_at = t - interval '200 hours', sow_at = t - interval '190 hours',
                          transplant_at = t - interval '108 hours', rotted_at = null
   where room_id = room and plot_no = 9;
  perform public._field_open(room, t - interval '1 second');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 9), 'not yet';
  perform public._field_open(room, t);
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 9), 'the grain has fallen';
end $$;

do $$
declare f text;
begin
  assert not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname like '\_%' and has_function_privilege('anon', p.oid, 'execute')),
    'private helpers are not callable';
  foreach f in array array['touch_room(uuid,text)', 'field_state(uuid,text)', 'rent_plot(uuid,text,integer)',
    'buy_plot(uuid,text,integer)', 'sell_plot_to_village(uuid,text,integer)', 'list_plot(uuid,text,integer,integer)',
    'buy_listed_plot(uuid,text,integer,integer)', 'offer_plot(uuid,text,integer,integer)', 'withdraw_offer(uuid,text,uuid)',
    'decline_offer(uuid,text,uuid)', 'accept_offer(uuid,text,uuid)', 'set_sublease(uuid,text,integer,integer)',
    'rent_sublease(uuid,text,integer,integer)', 'abandon_crop(uuid,text,integer)', 'prepare_plot(uuid,text,integer)',
    'apply_fertilizer(uuid,text,integer,text)', 'soak_seed(uuid,text,integer,text)', 'sow_seed(uuid,text,integer)',
    'begin_work(uuid,text,integer,text)', 'transplant(uuid,text,integer,double precision)', 'water(uuid,text,integer,integer)',
    'spray(uuid,text,integer,text)', 'pick_snails(uuid,text,integer)', 'harvest(uuid,text,integer,double precision)',
    'dry_start(uuid,text,text,integer)', 'dry_collect(uuid,text,integer)', 'sell_rice(text,text,boolean,integer)',
    'buy_farm_item(text,text,integer)', 'claim_farm_gift(text)'] loop
    assert has_function_privilege('anon', 'public.' || f, 'execute'), f;
  end loop;
  foreach f in array array['field_plots', 'plot_leases', 'land_offers', 'crops', 'drying_slots', 'rice_stock', 'farm_profiles'] loop
    assert not has_table_privilege('anon', 'public.' || f, 'select'), f;
  end loop;
  assert has_table_privilege('anon', 'public.rice_varieties', 'select'), 'varieties are public config';
end $$;

select 'v15 farm smoke ok' as result;
```

- [ ] **Step 3: Replay twice and run the smoke test**

Run the same commands as Task 1 Step 4.
Expected: no `FAILED`, `0013 ok`, `0013 re-run ok`, and the smoke test prints `v15 crop smoke ok`, `v15 land smoke ok` and `v15 farm smoke ok`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_v15_field.sql tests/sql/v15-smoke.sql
git commit -m "feat(v15): farming, drying, rice sales, the farm shop and the gift

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Farm catalog, server clock, `field_state` parser (and the fishing catalog filter)

**Files:**
- Create: `lib/game/farm/catalog.ts`, `lib/game/farm/clock.ts`, `lib/game/farm/state.ts`
- Modify: `lib/game/fishing/catalog.ts` (export `FISHING_KINDS`), `lib/game/fishing/rpc.ts` (read only fishing kinds)
- Test: `tests/unit/farm-catalog.test.ts`, `tests/unit/farm-clock.test.ts`, `tests/unit/farm-state.test.ts` (new); `tests/unit/fishing-rpc.test.ts` (extend)

**Interfaces:**
- Consumes: the `field_state` JSON shape of Tasks 2–3 (spec §11.5).
- Produces (`@/lib/game/farm/catalog`): types `FarmItemKind`, `FertKind`, `PestTarget`, `Variety { id, name, scale, baseKg, pricePerKg, blastMult, sortOrder }`, `FarmItem { id, kind, name, price: number | null, sortOrder, variety, fert, pestTarget, capacity }`, `FarmCatalog { varieties, items }`, `VarietyRow`, `FarmItemRow`; `FARM_KINDS`; `varietyFromRow`, `farmItemFromRow`; constants `RENT_PRICE` 250, `PLOT_PRICE` 4000, `SELL_BACK_PRICE` 2000, `LEASE_HOURS` 96, `SUBLEASE_MAX` 5000, `SALE_MAX` 1 000 000, `FARM_LIMIT` 2, `OFFER_HOURS` 24, `DRY_HOURS` 3, `DRYING_SLOTS` 4, `ITEM_CAP` 99; `ricePrice(kg, pricePerKg, dry)`, `ripeAfterHours(v)`, `describeFarmItem(item, varieties)`.
- Produces (`@/lib/game/farm/clock`): `syncClock(serverNow: string | number | null | undefined, receivedAt = Date.now())`, `serverNow(): number`, `clockOffset(): number`.
- Produces (`@/lib/game/farm/state`): types `Phase`, `PestKind`, `Who`, `WaterEntry {t, l}`, `ItemEntry {t, item}`, `CropLog`, `PestView {kind, since, treatedAt}`, `CropView`, `LeaseView`, `PlotView`, `DryingView`, `OfferView`, `FarmMine {items, rice, coins, giftClaimed}`, `FieldMine` (+ `ownedPlot`, `farming`, `myOffers`, `incomingOffers`), `FieldState {serverNow, plots, drying, mine}` — all times in ms since the epoch; `parseFarmMine(json)`, `parseFieldState(json)`, `withMine(state, mine)`, `itemCount(mine, id)`.
- Produces (`@/lib/game/fishing/catalog`): `FISHING_KINDS: readonly ShopKind[]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  describeFarmItem, farmItemFromRow, ricePrice, ripeAfterHours, varietyFromRow, type FarmItemRow, type VarietyRow,
} from "@/lib/game/farm/catalog";

const VARIETY_ROWS: VarietyRow[] = [
  { id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 },
  { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 },
  { id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 26, blast_mult: 1.3, sort_order: 30 },
];
const VARIETIES = VARIETY_ROWS.map(varietyFromRow);
const item = (over: Partial<FarmItemRow>): FarmItemRow => ({
  id: "x", kind: "seed", name: "x", price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});

describe("farm catalog rows", () => {
  it("maps varieties and items", () => {
    expect(VARIETIES[2]).toEqual({ id: "thom", name: "Lúa thơm", scale: 1.15, baseKg: 60, pricePerKg: 26, blastMult: 1.3, sortOrder: 30 });
    expect(farmItemFromRow(item({ id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, fert: "npk" }))).toEqual({
      id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, sortOrder: 0, variety: null, fert: "npk", pestTarget: null,
      capacity: null,
    });
  });
  it("drops values it does not know", () => {
    const it = farmItemFromRow(item({ kind: "rod", fert: "sand", pest_target: "mice" }));
    expect([it.kind, it.fert, it.pestTarget]).toEqual(["seed", null, null]);
  });
});

describe("ricePrice", () => {
  it("pays dry rice in full and wet rice at 70 %, rounded down with the server's integer arithmetic", () => {
    expect(ricePrice(10, 12, true)).toBe(120);
    expect(ricePrice(5, 12, false)).toBe(42);
    // 70 × 18 × 0.7 is 881.99… in floating point; the server computes (70 × 18 × 7) / 10 = 882
    expect(ricePrice(70, 18, false)).toBe(882);
  });
});

describe("ripeAfterHours", () => {
  it("is 2 h of soaking plus 56 h × the variety's scale (§8.1)", () => {
    expect(VARIETIES.map(ripeAfterHours)).toEqual([52, 58, 66]);
  });
});

describe("describeFarmItem", () => {
  it("says what each item is for", () => {
    const d = (over: Partial<FarmItemRow>) => describeFarmItem(farmItemFromRow(item(over)), VARIETIES);
    expect(d({ kind: "seed", variety: "nep" })).toBe("Chín sau ~58 giờ · 75 kg/thửa · 18 xu/kg lúa khô");
    expect(d({ kind: "fertilizer", fert: "manure" })).toBe("Bón lót — trước khi cấy");
    expect(d({ kind: "fertilizer", fert: "urea" })).toBe("Bón thúc đẻ nhánh");
    expect(d({ kind: "fertilizer", fert: "potash" })).toBe("Bón đón đòng");
    expect(d({ kind: "fertilizer", fert: "npk" })).toBe("Bón thúc đẻ nhánh hoặc đón đòng");
    expect(d({ kind: "pesticide", pest_target: "hopper" })).toBe("Trị rầy nâu");
    expect(d({ kind: "pesticide", pest_target: "fungus" })).toBe("Trị đạo ôn lá và đạo ôn cổ bông");
    expect(d({ kind: "critter_box", capacity: 15 })).toBe("Đựng 15 con cua, ốc");
  });
});
```

Create `tests/unit/farm-clock.test.ts`:

```ts
import { afterEach, describe, it, expect, vi } from "vitest";
import { clockOffset, serverNow, syncClock } from "@/lib/game/farm/clock";

afterEach(() => {
  syncClock(0, 0);
  vi.useRealTimers();
});

describe("server clock", () => {
  it("keeps the offset between the server's clock and ours", () => {
    syncClock("2026-09-25T10:00:05Z", Date.parse("2026-09-25T10:00:00Z"));
    expect(clockOffset()).toBe(5000);
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-09-25T11:00:00Z"));
    expect(serverNow()).toBe(Date.parse("2026-09-25T11:00:05Z"));
  });
  it("takes ms too, and ignores what it cannot read", () => {
    syncClock(1_000, 4_000);
    expect(clockOffset()).toBe(-3000);
    syncClock("not a time", 0);
    syncClock(null, 0);
    syncClock(undefined, 0);
    expect(clockOffset()).toBe(-3000);
  });
});
```

Create `tests/unit/farm-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { itemCount, parseFarmMine, parseFieldState, withMine } from "@/lib/game/farm/state";

const T = "2026-09-25T10:00:00+00:00";
const ms = (iso: string) => Date.parse(iso);
const DAT = { id: "a1", name: "Dat" };
const LAN = { id: "a2", name: "Lan" };

/** The shape _field_view builds (0013). */
const ANSWER = {
  server_now: T,
  plots: [
    {
      no: 3, kind: "private", owner: DAT, sale_price: null, sublease_price: 300, farmer: LAN,
      lease: { source: "owner", until: "2026-09-29T10:00:00+00:00", price: 300 }, offers: 2,
      crop: {
        variety: "nep", phase: "tillering", prepared_at: "2026-09-24T00:00:00+00:00", soak_at: "2026-09-24T00:00:00+00:00",
        sow_at: "2026-09-24T03:00:00+00:00", transplant_at: "2026-09-24T12:00:00+00:00", water: 2,
        water_set_at: "2026-09-24T12:00:00+00:00",
        pests: [
          { kind: "hopper", since: "2026-09-25T09:00:00+00:00", treated_at: null },
          { kind: "locust", since: "2026-09-25T09:00:00+00:00", treated_at: null },
        ],
        excess_n: false, ripe: false, rotted_at: null,
        log: {
          water: [{ t: "2026-09-24T00:00:00+00:00", l: 3 }, { t: "2026-09-24T12:00:00+00:00", l: 2 }],
          fert: [{ t: "2026-09-24T17:00:00+00:00", item: "fert_urea" }], spray: [], picks: [{ t: "2026-09-25T09:30:00+00:00" }],
          q_transplant: 1.05,
        },
      },
    },
    { no: 1, kind: "private", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null },
    { no: 42, kind: "village" },
  ],
  drying: [{ slot: 2, owner: LAN, variety: "nep", kg: 70, ready_at: "2026-09-25T11:00:00+00:00" }],
  mine: {
    items: { seed_nep: 2, fert_urea: 0 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, gift_claimed: true,
    owned_plot: 3, farming: [7],
    my_offers: [{ id: "o1", plot: 2, price: 8000, expires_at: "2026-09-26T10:00:00+00:00" }],
    incoming_offers: [{ id: "o2", plot: 3, buyer: LAN, price: 8500, expires_at: "2026-09-26T09:00:00+00:00" }],
  },
};

describe("parseFieldState", () => {
  const s = parseFieldState(ANSWER)!;
  it("reads the plots in order, skipping bad ones", () => {
    expect(s.serverNow).toBe(ms(T));
    expect(s.plots.map((p) => p.no)).toEqual([1, 3]);
    expect(s.plots[0]).toEqual({
      no: 1, kind: "private", owner: null, salePrice: null, subleasePrice: null, farmer: null, lease: null, offers: 0, crop: null,
    });
    expect(s.plots[1]).toMatchObject({
      owner: DAT, farmer: LAN, subleasePrice: 300, offers: 2,
      lease: { source: "owner", until: ms("2026-09-29T10:00:00Z"), price: 300 },
    });
  });
  it("reads the crop, its known pests and the farmer's logs", () => {
    const c = s.plots[1].crop!;
    expect(c).toMatchObject({
      variety: "nep", phase: "tillering", water: 2, transplantAt: ms("2026-09-24T12:00:00Z"), excessN: false, ripe: false,
      rottedAt: null,
    });
    expect(c.pests).toEqual([{ kind: "hopper", since: ms("2026-09-25T09:00:00Z"), treatedAt: null }]);
    expect(c.log).toEqual({
      water: [{ t: ms("2026-09-24T00:00:00Z"), l: 3 }, { t: ms("2026-09-24T12:00:00Z"), l: 2 }],
      fert: [{ t: ms("2026-09-24T17:00:00Z"), item: "fert_urea" }], spray: [], picks: [ms("2026-09-25T09:30:00Z")],
      qTransplant: 1.05,
    });
  });
  it("reads the drying yard and mine", () => {
    expect(s.drying).toEqual([{ slot: 2, owner: LAN, variety: "nep", kg: 70, readyAt: ms("2026-09-25T11:00:00Z") }]);
    expect(s.mine).toEqual({
      items: { seed_nep: 2 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, giftClaimed: true, ownedPlot: 3, farming: [7],
      myOffers: [{ id: "o1", plot: 2, price: 8000, expiresAt: ms("2026-09-26T10:00:00Z"), buyer: null }],
      incomingOffers: [{ id: "o2", plot: 3, price: 8500, expiresAt: ms("2026-09-26T09:00:00Z"), buyer: LAN }],
    });
  });
  it("refuses what is not a field state", () => {
    expect(parseFieldState(null)).toBeNull();
    expect(parseFieldState({ plots: [] })).toBeNull();
    expect(parseFieldState({ server_now: T, plots: [] })).toBeNull();
  });
});

describe("the account part", () => {
  it("merges a newer mine into the field state", () => {
    const s = parseFieldState(ANSWER)!;
    const m = parseFarmMine({ items: { fert_npk: 3 }, rice: {}, coins: 99, gift_claimed: true })!;
    const next = withMine(s, m);
    expect(next.mine).toMatchObject({ items: { fert_npk: 3 }, rice: {}, coins: 99, ownedPlot: 3, farming: [7] });
    expect(itemCount(next.mine, "fert_npk")).toBe(3);
    expect(itemCount(next.mine, "seed_nep")).toBe(0);
    expect(parseFarmMine("x")).toBeNull();
  });
});
```

Extend the fishing RPC test (its Supabase mock learns `.in`, and the catalog must ask for fishing kinds only):

**tests/unit/fishing-rpc.test.ts — edit 1 of 3.** Replace:

```ts
};
/** A thenable query chain: .select/.order return itself; awaiting it resolves to { data: rows, error: null }. */
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
```

with:

```ts
};
/** A thenable query chain: .select/.in/.order return itself; awaiting it resolves to { data: rows, error: null }. */
const filters: unknown[][] = [];
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.in = (...args: unknown[]) => {
    filters.push(args);
    return c;
  };
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
```

**tests/unit/fishing-rpc.test.ts — edit 2 of 3.** Replace:

```ts
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.reject(err).then(resolve, reject);
```

with:

```ts
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.in = () => c;
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.reject(err).then(resolve, reject);
```

**tests/unit/fishing-rpc.test.ts — edit 3 of 3.** Replace:

```ts
    expect(a.items[0]).toMatchObject({ id: "rod_wood", starter: true, zonePct: 25 });
  });
```

with:

```ts
    expect(a.items[0]).toMatchObject({ id: "rod_wood", starter: true, zonePct: 25 });
    // farm items share shop_items since v15: the fishing shop asks for its own kinds only
    expect(filters).toEqual([["kind", ["rod", "bobber", "bait", "bait_box", "bucket"]]]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/farm-catalog.test.ts tests/unit/farm-clock.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-rpc.test.ts`
Expected: FAIL — the farm modules do not exist, and the fishing catalog query has no `in` filter.

- [ ] **Step 3: Write the farm catalog, the clock and the parser**

Create `lib/game/farm/catalog.ts`:

```ts
// Client side of the farm config (spec §7, §8.1, §9): varieties, farm items, the land prices and number formats. Pure.

export type FarmItemKind = "seed" | "fertilizer" | "pesticide" | "critter_box";
export type FertKind = "manure" | "phosphate" | "urea" | "potash" | "npk";
export type PestTarget = "insect" | "hopper" | "fungus";

/** The shop_items kinds the farm shop sells (the fishing shop sells the others). */
export const FARM_KINDS: readonly FarmItemKind[] = ["seed", "fertilizer", "pesticide", "critter_box"];
const FERTS: readonly string[] = ["manure", "phosphate", "urea", "potash", "npk"];
const TARGETS: readonly string[] = ["insect", "hopper", "fungus"];

export interface Variety { id: string; name: string; scale: number; baseKg: number; pricePerKg: number; blastMult: number; sortOrder: number }

export interface FarmItem {
  id: string;
  kind: FarmItemKind;
  name: string;
  price: number | null;
  sortOrder: number;
  /** seed: the variety it grows. */
  variety: string | null;
  fert: FertKind | null;
  pestTarget: PestTarget | null;
  /** critter_box (v15.2). */
  capacity: number | null;
}

export interface FarmCatalog { varieties: Variety[]; items: FarmItem[] }

/** Rows as PostgREST returns them. */
export interface VarietyRow { id: string; name: string; scale: number; base_kg: number; price_per_kg: number; blast_mult: number; sort_order: number }
export interface FarmItemRow {
  id: string; kind: string; name: string; price: number | null; sort_order: number;
  variety: string | null; fert: string | null; pest_target: string | null; capacity: number | null;
}

export function varietyFromRow(r: VarietyRow): Variety {
  return {
    id: r.id, name: r.name, scale: Number(r.scale), baseKg: r.base_kg, pricePerKg: r.price_per_kg,
    blastMult: Number(r.blast_mult ?? 1), sortOrder: r.sort_order,
  };
}

export function farmItemFromRow(r: FarmItemRow): FarmItem {
  return {
    id: r.id, kind: (FARM_KINDS as readonly string[]).includes(r.kind) ? (r.kind as FarmItemKind) : "seed", name: r.name,
    price: r.price, sortOrder: r.sort_order, variety: r.variety ?? null,
    fert: r.fert !== null && FERTS.includes(r.fert) ? (r.fert as FertKind) : null,
    pestTarget: r.pest_target !== null && TARGETS.includes(r.pest_target) ? (r.pest_target as PestTarget) : null,
    capacity: r.capacity ?? null,
  };
}

// The land rules' numbers — the server's constants in 0013 (spec §7).
export const RENT_PRICE = 250;
export const PLOT_PRICE = 4000;
export const SELL_BACK_PRICE = 2000;
export const LEASE_HOURS = 96;
export const SUBLEASE_MAX = 5000;
export const SALE_MAX = 1_000_000;
export const FARM_LIMIT = 2;
export const OFFER_HOURS = 24;
export const DRY_HOURS = 3;
export const DRYING_SLOTS = 4;
/** A farm consumable stacks up to this many. */
export const ITEM_CAP = 99;

/** What cô Út pays: dry rice at the full price per kg, wet rice at 70 % (the same integer arithmetic as sell_rice). */
export function ricePrice(kg: number, pricePerKg: number, dry: boolean): number {
  return dry ? kg * pricePerKg : Math.floor((kg * pricePerKg * 7) / 10);
}

/** Hours from soaking to ripe with prompt actions: 2 + 56·s (spec §8.1). */
export function ripeAfterHours(v: Variety): number {
  return Math.round(2 + 56 * v.scale);
}

/** The one-line use of a farm item, shown in the shop. */
export function describeFarmItem(it: FarmItem, varieties: readonly Variety[]): string {
  switch (it.kind) {
    case "seed": {
      const v = varieties.find((x) => x.id === it.variety);
      return v ? `Chín sau ~${ripeAfterHours(v)} giờ · ${v.baseKg} kg/thửa · ${v.pricePerKg} xu/kg lúa khô` : "Hạt giống lúa";
    }
    case "fertilizer":
      switch (it.fert) {
        case "manure":
        case "phosphate": return "Bón lót — trước khi cấy";
        case "urea": return "Bón thúc đẻ nhánh";
        case "potash": return "Bón đón đòng";
        case "npk": return "Bón thúc đẻ nhánh hoặc đón đòng";
        default: return "Phân bón";
      }
    case "pesticide":
      switch (it.pestTarget) {
        case "insect": return "Trị sâu cuốn lá";
        case "hopper": return "Trị rầy nâu";
        case "fungus": return "Trị đạo ôn lá và đạo ôn cổ bông";
        default: return "Thuốc bảo vệ thực vật";
      }
    case "critter_box":
      return `Đựng ${it.capacity ?? 0} con cua, ốc`;
  }
}
```

Create `lib/game/farm/clock.ts`:

```ts
// The server's clock as this client knows it (spec §11.6). Every farm answer and the fishing state carry server_now;
// countdowns and window checks use Date.now() + offset, so a client clock that is minutes off still shows the right
// times. Shared by the farm and the fishing HUD.

let offset = 0;

/** Note a server timestamp that arrived at `receivedAt` (client ms). Anything unreadable is ignored. */
export function syncClock(serverNow: string | number | null | undefined, receivedAt = Date.now()): void {
  const t = typeof serverNow === "number" ? serverNow : typeof serverNow === "string" ? Date.parse(serverNow) : NaN;
  if (Number.isFinite(t)) offset = t - receivedAt;
}

/** Now on the server's clock (ms since the epoch). */
export function serverNow(): number {
  return Date.now() + offset;
}

/** server − client, in ms. */
export function clockOffset(): number {
  return offset;
}
```

Create `lib/game/farm/state.ts`:

```ts
// The field_state JSON (spec §11.5), camelCased, with times as ms since the epoch. Pure.

export type Phase = "prepared" | "soaking" | "sprouted" | "seedling" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe";
export type PestKind = "snail" | "leaf_folder" | "hopper" | "leaf_blast" | "neck_blast";

const PHASES: readonly string[] = ["prepared", "soaking", "sprouted", "seedling", "tillering", "panicle", "heading", "ripening", "ripe", "overripe"];
const PESTS: readonly string[] = ["snail", "leaf_folder", "hopper", "leaf_blast", "neck_blast"];

export interface Who { id: string; name: string }
export interface WaterEntry { t: number; l: number }
export interface ItemEntry { t: number; item: string }

/** The crop's logs — only its farmer gets them. */
export interface CropLog { water: WaterEntry[]; fert: ItemEntry[]; spray: ItemEntry[]; picks: number[]; qTransplant: number }

/** A pest whose hidden roll has fired (spec §8.5). */
export interface PestView { kind: PestKind; since: number; treatedAt: number | null }

export interface CropView {
  variety: string | null;
  phase: Phase;
  preparedAt: number | null;
  soakAt: number | null;
  sowAt: number | null;
  transplantAt: number | null;
  /** The level now, and when it was last set (it drops one level per 12 h after that). */
  water: number;
  waterSetAt: number | null;
  pests: PestView[];
  excessN: boolean;
  /** Ripe or overripe (the v16 rat hook). */
  ripe: boolean;
  /** The last soaked seed rotted unsown. */
  rottedAt: number | null;
  log: CropLog | null;
}

export interface LeaseView { source: "village" | "owner"; until: number; price: number }

export interface PlotView {
  no: number;
  kind: "private" | "village";
  owner: Who | null;
  salePrice: number | null;
  subleasePrice: number | null;
  farmer: Who | null;
  lease: LeaseView | null;
  /** Pending purchase offers (details only for the owner, in mine.incomingOffers). */
  offers: number;
  crop: CropView | null;
}

export interface DryingView { slot: number; owner: Who | null; variety: string; kg: number; readyAt: number }

export interface OfferView { id: string; plot: number; price: number; expiresAt: number; buyer: Who | null }

/** The account part of the answer — sell_rice, buy_farm_item and claim_farm_gift return only this. */
export interface FarmMine {
  items: Record<string, number>;
  rice: Record<string, { wet: number; dry: number }>;
  coins: number;
  giftClaimed: boolean;
}

export interface FieldMine extends FarmMine {
  ownedPlot: number | null;
  farming: number[];
  myOffers: OfferView[];
  incomingOffers: OfferView[];
}

export interface FieldState { serverNow: number; plots: PlotView[]; drying: DryingView[]; mine: FieldMine }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
/** An ISO timestamp → ms; anything else → null. */
const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const who = (v: unknown): Who | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o.id === "string" ? { id: o.id, name: str(o.name) } : null;
};

function parseLog(v: unknown): CropLog | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const items = (a: unknown): ItemEntry[] => arr(a).map(obj)
    .map((e) => ({ t: time(e.t), item: str(e.item) }))
    .filter((e): e is ItemEntry => e.t !== null && e.item !== "");
  return {
    water: arr(o.water).map(obj).map((e) => ({ t: time(e.t), l: num(e.l) })).filter((e): e is WaterEntry => e.t !== null),
    fert: items(o.fert),
    spray: items(o.spray),
    picks: arr(o.picks).map(obj).map((e) => time(e.t)).filter((t): t is number => t !== null),
    qTransplant: num(o.q_transplant, 1),
  };
}

function parseCrop(v: unknown): CropView | null {
  if (!v || typeof v !== "object") return null;
  const c = v as Record<string, unknown>;
  const phase = PHASES.includes(str(c.phase)) ? (c.phase as Phase) : "prepared";
  return {
    variety: typeof c.variety === "string" ? c.variety : null,
    phase,
    preparedAt: time(c.prepared_at),
    soakAt: time(c.soak_at),
    sowAt: time(c.sow_at),
    transplantAt: time(c.transplant_at),
    water: num(c.water),
    waterSetAt: time(c.water_set_at),
    pests: arr(c.pests).map(obj).flatMap((p): PestView[] => {
      const since = time(p.since);
      return PESTS.includes(str(p.kind)) && since !== null ? [{ kind: p.kind as PestKind, since, treatedAt: time(p.treated_at) }] : [];
    }),
    excessN: c.excess_n === true,
    ripe: c.ripe === true,
    rottedAt: time(c.rotted_at),
    log: parseLog(c.log),
  };
}

function parsePlot(v: unknown): PlotView | null {
  const p = obj(v);
  const no = num(p.no);
  if (no < 1 || no > 10) return null;
  const l = obj(p.lease);
  const until = time(l.until);
  return {
    no,
    kind: p.kind === "private" ? "private" : "village",
    owner: who(p.owner),
    salePrice: numOrNull(p.sale_price),
    subleasePrice: numOrNull(p.sublease_price),
    farmer: who(p.farmer),
    lease: until === null ? null : { source: l.source === "owner" ? "owner" : "village", until, price: num(l.price) },
    offers: num(p.offers),
    crop: parseCrop(p.crop),
  };
}

function parseOffer(v: unknown): OfferView | null {
  const o = obj(v);
  const expiresAt = time(o.expires_at);
  if (typeof o.id !== "string" || expiresAt === null) return null;
  return { id: o.id, plot: num(o.plot), price: num(o.price), expiresAt, buyer: who(o.buyer) };
}

/** The account part of any farm answer; null when it is not an object. */
export function parseFarmMine(json: unknown): FarmMine | null {
  if (!json || typeof json !== "object") return null;
  const m = json as Record<string, unknown>;
  const items: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(m.items))) if (num(v) > 0) items[k] = num(v);
  const rice: Record<string, { wet: number; dry: number }> = {};
  for (const [k, v] of Object.entries(obj(m.rice))) rice[k] = { wet: num(obj(v).wet), dry: num(obj(v).dry) };
  return { items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true };
}

/** A field_state answer; null when it is not one. */
export function parseFieldState(json: unknown): FieldState | null {
  if (!json || typeof json !== "object") return null;
  const j = json as Record<string, unknown>;
  const serverNow = time(j.server_now);
  const base = parseFarmMine(j.mine);
  if (serverNow === null || !base || !Array.isArray(j.plots)) return null;
  const m = obj(j.mine);
  const offers = (v: unknown) => arr(v).map(parseOffer).filter((o): o is OfferView => o !== null);
  return {
    serverNow,
    plots: j.plots.map(parsePlot).filter((p): p is PlotView => p !== null).sort((a, b) => a.no - b.no),
    drying: arr(j.drying).map(obj).flatMap((d): DryingView[] => {
      const readyAt = time(d.ready_at);
      return readyAt === null ? [] : [{ slot: num(d.slot), owner: who(d.owner), variety: str(d.variety), kg: num(d.kg), readyAt }];
    }),
    mine: {
      ...base,
      ownedPlot: numOrNull(m.owned_plot),
      farming: arr(m.farming).filter((x): x is number => typeof x === "number"),
      myOffers: offers(m.my_offers),
      incomingOffers: offers(m.incoming_offers),
    },
  };
}

/** A field state with a newer account part (the answer of sell_rice, buy_farm_item or claim_farm_gift). */
export function withMine(s: FieldState, mine: FarmMine): FieldState {
  return { ...s, mine: { ...s.mine, ...mine } };
}

/** How many of a farm item the account holds. */
export function itemCount(m: FarmMine, id: string): number {
  return m.items[id] ?? 0;
}
```

- [ ] **Step 4: Keep farm items out of the fishing shop**

**lib/game/fishing/catalog.ts.** Replace:

```ts
export type ShopKind = "rod" | "bobber" | "bait" | "bait_box" | "bucket";
const SHOP_KINDS: readonly string[] = ["rod", "bobber", "bait", "bait_box", "bucket"];
```

with:

```ts
export type ShopKind = "rod" | "bobber" | "bait" | "bait_box" | "bucket";
/** The shop_items kinds the fishing shop sells (the farm items share the table since v15). */
export const FISHING_KINDS: readonly ShopKind[] = ["rod", "bobber", "bait", "bait_box", "bucket"];
const SHOP_KINDS: readonly string[] = FISHING_KINDS;
```

**lib/game/fishing/rpc.ts — edit 1 of 2.** Replace:

```ts
import { supabase } from "@/lib/supabase";
import { isRarity, shopItemFromRow, speciesFromRow, type FishingCatalog, type Rarity, type ShopItemRow, type SpeciesRow } from "./catalog";
import { parseFishingState, type FishingState, type Loadout } from "./state";
```

with:

```ts
import { supabase } from "@/lib/supabase";
import {
  FISHING_KINDS, isRarity, shopItemFromRow, speciesFromRow, type FishingCatalog, type Rarity, type ShopItemRow, type SpeciesRow,
} from "./catalog";
import { parseFishingState, type FishingState, type Loadout } from "./state";
```

**lib/game/fishing/rpc.ts — edit 2 of 2.** Replace:

```ts
        supabase.from("fish_species").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").order("kind").order("sort_order"),
      ]);
```

with:

```ts
        supabase.from("fish_species").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").in("kind", FISHING_KINDS).order("kind").order("sort_order"),
      ]);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/unit/farm-catalog.test.ts tests/unit/farm-clock.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-rpc.test.ts tests/unit/fishing-catalog.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm lib/game/fishing/catalog.ts lib/game/fishing/rpc.ts tests/unit/farm-catalog.test.ts tests/unit/farm-clock.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-rpc.test.ts` (clean).

```bash
git add lib/game/farm/catalog.ts lib/game/farm/clock.ts lib/game/farm/state.ts lib/game/fishing/catalog.ts lib/game/fishing/rpc.ts tests/unit/farm-catalog.test.ts tests/unit/farm-clock.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-rpc.test.ts
git commit -m "feat(v15): farm catalog, server clock and field_state parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The crop model mirror

**Files:**
- Create: `lib/game/farm/crop.ts`
- Test: `tests/unit/farm-crop.test.ts` (new; replays every case of `tests/fixtures/crop-cases.json`)

**Interfaces:**
- Consumes: `Variety` (Task 4), `CropView`, `PestView`, `WaterEntry`, `ItemEntry`, `Phase` (Task 4), the fixture (Task 1).
- Produces (`@/lib/game/farm/crop`): `HOUR_MS`, `SAMPLE_MS` (15 min), `WATER_NAMES`; `CropModel { soakAt, sowAt, transplantAt, qTransplant, water: WaterEntry[], fert: ItemEntry[] }` and `cropModel(view: CropView)`; `hrs(a, b)`, `plusH(t, h)` (cut to whole seconds); `waterAt(log, t)`, `nextWaterDrop(log, t)`; `cropPhase(c, v | null, t): Phase`; `wantedWater(c, v, t) → { levels, label, short } | null`; `waterOk`, `waterOffHours(c, v, until)`, `excessN(c, v, t)`; `Care` and `cropCare(c, v)`, `mcareOf(care)`; `pestHours(c, pest, until)`; `YieldFactors { kg, mcare, mseed, mwater, mpest, mlate }`, `cropYield(c, v, land, qH, pests, now)`, `yieldEstimate(c, v, land, pests, now)` (optimistic for open windows); the timetable `sproutAt`, `sowLateAt`, `rotAt`, `transplantReadyAt`, `seedlingsOldAt`, `ripeAt`, `overripeAt`, `lostAt`, `nextPhaseAt(c, v, now)`. Every function mirrors SQL section D operation by operation.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/farm-crop.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { varietyFromRow, type Variety } from "@/lib/game/farm/catalog";
import {
  cropCare, cropPhase, cropYield, excessN, HOUR_MS, nextPhaseAt, nextWaterDrop, pestHours, waterAt, waterOffHours, wantedWater,
  yieldEstimate, type CropModel,
} from "@/lib/game/farm/crop";
import type { PestKind, PestView } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/crop-cases.json";

const V: Record<string, Variety> = Object.fromEntries([
  { id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 },
  { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 },
  { id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 26, blast_mult: 1.3, sort_order: 30 },
].map((r) => [r.id, varietyFromRow(r)]));

interface Case {
  name: string; variety: string; land: number; q_transplant: number; q_harvest: number;
  soak: number; sow: number; transplant: number; harvest: number;
  water: Array<[number, number]>; fert: Array<[number, string]>;
  expect: {
    kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number;
    pests: Array<{ kind: PestKind; since_s: number; treated_s: number | null }>;
  };
}
const FX = fixtures as unknown as { t0: string; cases: Case[] };
const t0 = Date.parse(FX.t0);
const at = (h: number) => t0 + h * HOUR_MS;

const cropOf = (k: Case): CropModel => ({
  soakAt: at(k.soak), sowAt: at(k.sow), transplantAt: at(k.transplant), qTransplant: k.q_transplant,
  water: k.water.map(([h, l]) => ({ t: at(h), l })), fert: k.fert.map(([h, item]) => ({ t: at(h), item })),
});

describe("the shared crop fixtures (the SQL smoke replays the same cases)", () => {
  for (const k of FX.cases) {
    it(k.name, () => {
      const pests: PestView[] = k.expect.pests.map((p) => ({
        kind: p.kind, since: t0 + p.since_s * 1000, treatedAt: p.treated_s === null ? null : t0 + p.treated_s * 1000,
      }));
      const y = cropYield(cropOf(k), V[k.variety], k.land, k.q_harvest, pests, at(k.harvest));
      expect(y.kg).toBe(k.expect.kg);
      for (const f of ["mcare", "mseed", "mwater", "mpest", "mlate"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
    });
  }
});

const nep = V.nep, short = V.short;
const bare = (over: Partial<CropModel> = {}): CropModel => ({
  soakAt: null, sowAt: null, transplantAt: null, qTransplant: 1, water: [{ t: at(0), l: 3 }], fert: [], ...over,
});
const grown = (over: Partial<CropModel> = {}) => bare({ soakAt: at(0), sowAt: at(3), transplantAt: at(12), ...over });

describe("water", () => {
  it("drops a level every 12 h, never below dry; the later of two same-time entries wins", () => {
    const log = [{ t: at(0), l: 3 }];
    expect([waterAt(log, at(11.99)), waterAt(log, at(12)), waterAt(log, at(100)), waterAt(log, at(-1))]).toEqual([3, 2, 0, 0]);
    expect(waterAt([{ t: at(0), l: 1 }, { t: at(0), l: 2 }], at(0))).toBe(2);
    expect(nextWaterDrop(log, at(13))).toBe(at(24));
    expect(nextWaterDrop(log, at(40))).toBeNull();
  });
  it("wants Ẩm for seedlings, Nông then phơi while tillering, Nông–Sâu at panicle and drained from ripening", () => {
    const c = grown();
    const want = (h: number) => wantedWater(c, nep, at(h))?.levels;
    expect([want(1), want(5), want(20), want(27), want(33), want(55), want(80)]).toEqual([
      undefined, [1], [2], [0, 1, 2], [2, 3], [0, 1], [0, 1],
    ]);
  });
  it("counts off-target 15-minute samples from sowing", () => {
    // seedlings want Ẩm but the plot stays flooded (3) from sowing at 3 h until the transplant at 12 h: 36 samples
    expect(waterOffHours(grown(), nep, at(12))).toBe(9);
    expect(waterOffHours(grown(), nep, at(3))).toBe(0);
  });
});

describe("phases", () => {
  it("follow §8.2", () => {
    const c = grown();
    const ph = (h: number) => cropPhase(c, nep, at(h));
    expect(cropPhase(bare(), null, at(1))).toBe("prepared");
    expect(cropPhase(bare({ soakAt: at(0) }), null, at(1.9))).toBe("soaking");
    expect(cropPhase(bare({ soakAt: at(0) }), null, at(2))).toBe("sprouted");
    expect([ph(3), ph(12), ph(29.9), ph(30), ph(42), ph(52), ph(60), ph(72)]).toEqual([
      "seedling", "tillering", "tillering", "panicle", "heading", "ripening", "ripe", "overripe",
    ]);
    expect(cropPhase(c, short, at(12 + 43.2))).toBe("ripe");
  });
  it("tells when the next phase starts", () => {
    const c = grown();
    expect(nextPhaseAt(bare({ soakAt: at(0) }), null, at(1))).toBe(at(2));
    expect(nextPhaseAt(c, nep, at(13))).toBe(at(30));
    expect(nextPhaseAt(c, nep, at(61))).toBe(at(72));
    expect(nextPhaseAt(c, nep, at(73))).toBe(at(120));
    expect(nextPhaseAt(bare({ soakAt: at(0), sowAt: at(3) }), nep, at(5))).toBeNull();
  });
});

describe("care", () => {
  it("scores the base fertilizers, the top-dresses, phơi ruộng and excess nitrogen", () => {
    const fert = (list: Array<[number, string]>) => grown({ fert: list.map(([h, item]) => ({ t: at(h), item })) });
    // the plot flooded at 0 h has drained to Ẩm on its own by T = 18 h (30 h): phơi ruộng is earned
    expect(cropCare(fert([[1, "fert_manure"], [1, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]]), nep)).toEqual({
      manure: true, phosphate: true, td1: 0, td2: 0, phoi: true, excess: false,
    });
    expect(cropCare(grown({ water: [{ t: at(0), l: 3 }, { t: at(24), l: 2 }] }), nep).phoi).toBe(false);
    // potash while tillering and NPK late in panicle are half credit; manure after transplanting is wasted
    expect(cropCare(fert([[13, "fert_manure"], [17, "fert_potash"], [38, "fert_npk"]]), nep)).toMatchObject({
      manure: false, td1: 0.1, td2: 0.1, excess: false,
    });
    expect(excessN(fert([[17, "fert_urea"], [20, "fert_npk"]]), nep, Infinity)).toBe(true);   // twice in tillering
    expect(excessN(fert([[32, "fert_urea"]]), nep, Infinity)).toBe(true);                     // urea at panicle
    expect(excessN(fert([[45, "fert_npk"]]), nep, Infinity)).toBe(true);                      // N at heading
    expect(excessN(fert([[32, "fert_urea"]]), nep, at(31))).toBe(false);                      // not yet
  });
});

describe("pests", () => {
  it("count hours until treated; snails only while the water is at least Nông", () => {
    const c = grown({ water: [{ t: at(0), l: 3 }, { t: at(16), l: 1 }] });
    const pest = (kind: PestKind, since: number, treated: number | null): PestView => ({ kind, since: at(since), treatedAt: treated === null ? null : at(treated) });
    expect(pestHours(c, pest("hopper", 20, 23), at(60))).toBe(3);
    expect(pestHours(c, pest("hopper", 20, null), at(26))).toBe(6);
    expect(pestHours(c, pest("snail", 14, null), at(20))).toBe(2);
  });
});

describe("yieldEstimate", () => {
  it("counts open windows as done on time, and what already happened as it is", () => {
    // seedlings in a well-drained bed, nothing applied yet: a full harvest is still possible
    const seedbed = bare({ soakAt: at(0), sowAt: at(3), water: [{ t: at(0), l: 3 }, { t: at(2.75), l: 1 }] });
    expect(yieldEstimate(seedbed, nep, 1, [], at(4))).toMatchObject({ kg: 75, mcare: 1, mwater: 1 });
    // at T = 25 h the base fertilizers and both top-dresses were missed, and the water was wrong for 18 h: a flooded
    // seedbed (9 h), then too low late in tillering (2 h) and at panicle (7 h)
    const late = yieldEstimate(grown(), nep, 1, [], at(37));
    expect(late.mcare).toBeCloseTo(0.5, 12);
    expect(late.mwater).toBeCloseTo(0.82, 12);
    expect(late.kg).toBe(31);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/farm-crop.test.ts`
Expected: FAIL — `@/lib/game/farm/crop` does not exist.

- [ ] **Step 3: Write the crop model**

Create `lib/game/farm/crop.ts`:

```ts
import type { Variety } from "./catalog";
import type { CropView, ItemEntry, PestView, Phase, WaterEntry } from "./state";

// The crop model (spec §8) on the client: the same arithmetic, in the same order, as 0013 section D, so the plot
// panel's estimate agrees with the harvest (tests/fixtures/crop-cases.json pins both sides). Times are ms since the
// epoch. Pure.

export const HOUR_MS = 3_600_000;
/** Water is sampled every 15 minutes of crop time (§8.3). */
export const SAMPLE_MS = 15 * 60_000;
export const WATER_NAMES: readonly string[] = ["Khô", "Ẩm", "Nông", "Sâu"];

/** What the model reads of a crop. */
export interface CropModel {
  soakAt: number | null;
  sowAt: number | null;
  transplantAt: number | null;
  qTransplant: number;
  water: readonly WaterEntry[];
  fert: readonly ItemEntry[];
}

/** The model of a crop as field_state shows it (the logs are there for its farmer only). */
export function cropModel(c: CropView): CropModel {
  return {
    soakAt: c.soakAt, sowAt: c.sowAt, transplantAt: c.transplantAt, qTransplant: c.log?.qTransplant ?? 1,
    water: c.log?.water ?? [], fert: c.log?.fert ?? [],
  };
}

export function hrs(a: number, b: number): number {
  return (b - a) / HOUR_MS;
}

/** t plus h hours, cut to whole seconds (SQL _plus_h). */
export function plusH(t: number, h: number): number {
  return t + Math.floor(h * 3600) * 1000;
}

/** The last water entry at or before t (the later one wins a tie). */
function lastEntry(log: readonly WaterEntry[], t: number): WaterEntry | null {
  let best: WaterEntry | null = null;
  for (const e of log) if (e.t <= t && (best === null || e.t >= best.t)) best = e;
  return best;
}

/** The water level at t: the last level set, one level lower per full 12 h since, never below 0 (§8.3). */
export function waterAt(log: readonly WaterEntry[], t: number): number {
  const e = lastEntry(log, t);
  return e ? Math.max(0, e.l - Math.floor(hrs(e.t, t) / 12)) : 0;
}

/** When the water next drops a level on its own (null when it is dry). */
export function nextWaterDrop(log: readonly WaterEntry[], t: number): number | null {
  const e = lastEntry(log, t);
  if (!e || waterAt(log, t) === 0) return null;
  return e.t + (Math.floor(hrs(e.t, t) / 12) + 1) * 12 * HOUR_MS;
}

/** The phase at t (§8.2). */
export function cropPhase(c: CropModel, v: Variety | null, t: number): Phase {
  if (c.transplantAt === null || t < c.transplantAt) {
    if (c.sowAt !== null && t >= c.sowAt) return "seedling";
    if (c.soakAt !== null && t >= c.soakAt) return hrs(c.soakAt, t) < 2 ? "soaking" : "sprouted";
    return "prepared";
  }
  const s = v?.scale ?? 1;
  const h = hrs(c.transplantAt, t);
  if (h < 18 * s) return "tillering";
  if (h < 30 * s) return "panicle";
  if (h < 40 * s) return "heading";
  if (h < 48 * s) return "ripening";
  if (h < 48 * s + 12) return "ripe";
  return "overripe";
}

/** The levels the phase wants at t (§8.3): the panel's label and a short name for the task list; null before sowing. */
export function wantedWater(c: CropModel, v: Variety | null, t: number): { levels: readonly number[]; label: string; short: string } | null {
  switch (cropPhase(c, v, t)) {
    case "seedling": return { levels: [1], label: "Ẩm", short: "Ẩm" };
    case "tillering":
      return c.transplantAt !== null && hrs(c.transplantAt, t) < 14 * (v?.scale ?? 1)
        ? { levels: [2], label: "Nông", short: "Nông" }
        : { levels: [0, 1, 2], label: "Phơi ruộng (rút cạn tốt hơn)", short: "Khô–Nông" };
    case "panicle":
    case "heading": return { levels: [2, 3], label: "Nông–Sâu (tốt nhất Sâu)", short: "Nông–Sâu" };
    case "ripening":
    case "ripe":
    case "overripe": return { levels: [0, 1], label: "Rút nước", short: "Khô–Ẩm" };
    default: return null;
  }
}

/** Does the water at t suit the phase? Phases before sowing accept anything. */
export function waterOk(c: CropModel, v: Variety | null, t: number): boolean {
  const w = wantedWater(c, v, t);
  return w === null || w.levels.includes(waterAt(c.water, t));
}

/** Off-target water hours from sowing until `until`: one sample every 15 minutes, 0.25 h per wrong sample. */
export function waterOffHours(c: CropModel, v: Variety | null, until: number): number {
  if (c.sowAt === null || until <= c.sowAt) return 0;
  let wrong = 0;
  for (let t = c.sowAt; t < until; t += SAMPLE_MS) if (!waterOk(c, v, t)) wrong++;
  return wrong * 0.25;
}

const isN = (item: string) => item === "fert_urea" || item === "fert_npk";

/** Excess nitrogen by t (§8.4): urea in panicle, a second N inside tillering or inside panicle, or any N from heading on. */
export function excessN(c: CropModel, v: Variety | null, t: number): boolean {
  let till = 0, pan = 0;
  for (const e of c.fert) {
    if (e.t > t || !isN(e.item)) continue;
    const ph = cropPhase(c, v, e.t);
    if (ph === "tillering") till++;
    else if (ph === "panicle") {
      if (e.item === "fert_urea") return true;
      pan++;
    } else if (ph === "heading" || ph === "ripening" || ph === "ripe" || ph === "overripe") return true;
  }
  return till >= 2 || pan >= 2;
}

/** Fertilizer and drainage scores (§8.4, §8.6). td1/td2: 0 on time, 0.1 half, 0.2 missing. */
export interface Care { manure: boolean; phosphate: boolean; td1: number; td2: number; phoi: boolean; excess: boolean }

export function cropCare(c: CropModel, v: Variety | null): Care {
  const s = v?.scale ?? 1;
  let manure = false, phosphate = false, td1 = 0.2, td2 = 0.2;
  for (const e of c.fert) {
    if (c.transplantAt === null || e.t < c.transplantAt) {
      if (e.item === "fert_manure") manure = true;
      if (e.item === "fert_phosphate") phosphate = true;
      continue;
    }
    const ph = cropPhase(c, v, e.t);
    const h = hrs(c.transplantAt, e.t);
    if (ph === "tillering") {
      if (isN(e.item) && h >= 2 * s && h <= 10 * s) td1 = 0;
      else if (isN(e.item) || e.item === "fert_potash") td1 = Math.min(td1, 0.1);
    } else if (ph === "panicle") {
      if ((e.item === "fert_potash" || e.item === "fert_npk") && h >= 18 * s && h <= 24 * s) td2 = 0;
      else if (e.item === "fert_potash" || isN(e.item)) td2 = Math.min(td2, 0.1);
    }
  }
  const phoi = c.transplantAt !== null && waterAt(c.water, plusH(c.transplantAt, 18 * s)) <= 1;
  return { manure, phosphate, td1, td2, phoi, excess: excessN(c, v, Infinity) };
}

/** 1 − the care penalties, summed in the SQL's order. */
export function mcareOf(care: Care): number {
  let pen = 0;
  if (!care.manure) pen += 0.05;
  if (!care.phosphate) pen += 0.05;
  pen += care.td1;
  pen += care.td2;
  if (!care.phoi) pen += 0.05;
  if (care.excess) pen += 0.1;
  return 1 - pen;
}

/** A pest's damaging hours until it was treated or `until` (§8.5). Snails only count samples with water ≥ 2. */
export function pestHours(c: CropModel, p: PestView, until: number): number {
  const end = p.treatedAt ?? until;
  if (end <= p.since) return 0;
  if (p.kind !== "snail") return hrs(p.since, end);
  let wet = 0;
  for (let t = p.since; t < end; t += SAMPLE_MS) if (waterAt(c.water, t) >= 2) wet++;
  return wet * 0.25;
}

export interface YieldFactors { kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number }

function factors(
  v: Variety, land: number, qT: number, qH: number, care: Care, lateSow: number, oldSeedlings: number, offHours: number,
  pestH: readonly number[], lateHarvest: number,
): YieldFactors {
  const mcare = mcareOf(care);
  const mseed = 1 - Math.min(0.3, 0.03 * Math.max(0, lateSow)) - Math.min(0.3, 0.03 * Math.max(0, oldSeedlings));
  const mwater = 1 - Math.min(0.2, 0.01 * offHours);
  let mpest = 1;
  for (const h of pestH) mpest = mpest * (1 - Math.min(0.3, 0.015 * h));
  const mlate = 1 - Math.min(0.6, 0.02 * Math.max(0, lateHarvest));
  const x = v.baseKg * land * mcare * mseed * mwater * mpest * mlate * qT * qH;
  return { kg: Math.max(Math.ceil(v.baseKg / 10), Math.floor(x + 0.5)), mcare, mseed, mwater, mpest, mlate };
}

/** The harvest at `now` (§8.6) — what the server pays out. `pests` are the revealed ones, in slot order. */
export function cropYield(c: CropModel, v: Variety, land: number, qH: number, pests: readonly PestView[], now: number): YieldFactors {
  const s = v.scale;
  const sow = c.sowAt ?? now, transplant = c.transplantAt ?? now;
  return factors(
    v, land, c.qTransplant, qH, cropCare(c, v), hrs(c.soakAt ?? sow, sow) - 8, hrs(sow, transplant) - 14 * s,
    waterOffHours(c, v, now), pests.map((p) => pestHours(c, p, now)), hrs(transplant, now) - (48 * s + 12),
  );
}

/** The plot panel's estimate ("ước tính"): the harvest if everything still open is done on time — the base
 *  fertilizers before transplanting, the top-dresses until their windows close, phơi ruộng until T = 18·s — with
 *  the care, water, pests and delays so far. Hidden pests cannot be counted. */
export function yieldEstimate(c: CropModel, v: Variety, land: number, pests: readonly PestView[], now: number): YieldFactors {
  const s = v.scale;
  const care = cropCare(c, v);
  const T = c.transplantAt === null ? null : hrs(c.transplantAt, now);
  const hopeful: Care = {
    manure: care.manure || T === null,
    phosphate: care.phosphate || T === null,
    td1: T === null || T <= 10 * s ? 0 : care.td1,
    td2: T === null || T <= 24 * s ? 0 : care.td2,
    phoi: T === null || T < 18 * s ? true : care.phoi,
    excess: care.excess,
  };
  const lateSow = c.soakAt === null ? 0 : hrs(c.soakAt, c.sowAt ?? now) - 8;
  const old = c.sowAt === null ? 0 : hrs(c.sowAt, c.transplantAt ?? now) - 14 * s;
  const lateHarvest = c.transplantAt === null ? 0 : hrs(c.transplantAt, now) - (48 * s + 12);
  return factors(v, land, c.qTransplant, 1, hopeful, lateSow, old, waterOffHours(c, v, now),
    pests.map((p) => pestHours(c, p, now)), lateHarvest);
}

// The crop's timetable (§8.2).
/** Sprouted: soak + 2 h. */
export const sproutAt = (c: CropModel): number | null => (c.soakAt === null ? null : c.soakAt + 2 * HOUR_MS);
/** Sowing is late (−3 %/h) after soak + 8 h. */
export const sowLateAt = (c: CropModel): number | null => (c.soakAt === null ? null : c.soakAt + 8 * HOUR_MS);
/** Unsown seed rots at soak + 26 h. */
export const rotAt = (c: CropModel): number | null => (c.soakAt === null ? null : c.soakAt + 26 * HOUR_MS);
/** Seedlings may be transplanted from sow + 8·s h … */
export const transplantReadyAt = (c: CropModel, v: Variety): number | null => (c.sowAt === null ? null : c.sowAt + 8 * v.scale * HOUR_MS);
/** … and are old (−3 %/h) after sow + 14·s h. */
export const seedlingsOldAt = (c: CropModel, v: Variety): number | null => (c.sowAt === null ? null : c.sowAt + 14 * v.scale * HOUR_MS);
/** Ripe at transplant + 48·s h. */
export const ripeAt = (c: CropModel, v: Variety): number | null => (c.transplantAt === null ? null : c.transplantAt + 48 * v.scale * HOUR_MS);
/** Overripe (−2 %/h) 12 h after ripe. */
export const overripeAt = (c: CropModel, v: Variety): number | null =>
  c.transplantAt === null ? null : c.transplantAt + (48 * v.scale + 12) * HOUR_MS;
/** Lost 48 h after the ripe window (the sweep's rule). */
export const lostAt = (c: CropModel, v: Variety): number | null => (c.transplantAt === null ? null : plusH(c.transplantAt, 48 * v.scale + 60));

/** When the crop enters its next phase, or null when it waits for the farmer (sowing, transplanting) or nothing is next. */
export function nextPhaseAt(c: CropModel, v: Variety | null, now: number): number | null {
  const ph = cropPhase(c, v, now);
  if (ph === "soaking") return sproutAt(c);
  if (c.transplantAt === null || !v) return null;
  const s = v.scale, at = (h: number) => c.transplantAt! + h * HOUR_MS;
  switch (ph) {
    case "tillering": return at(18 * s);
    case "panicle": return at(30 * s);
    case "heading": return at(40 * s);
    case "ripening": return at(48 * s);
    case "ripe": return at(48 * s + 12);
    case "overripe": return lostAt(c, v);
    default: return null;
  }
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/farm-crop.test.ts`
Expected: PASS — every fixture case gives the SQL model's kilograms exactly and its five factors to 12 decimal places. If a case is off by a hair, compare the order of operations with `_crop_yield` / `_crop_care` / `_pest_hours` in 0013 section D — the two must do the same float operations in the same order.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/farm/crop.ts tests/unit/farm-crop.test.ts` (clean).

```bash
git add lib/game/farm/crop.ts tests/unit/farm-crop.test.ts
git commit -m "feat(v15): the crop model mirror, pinned to the SQL fixtures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Farm texts and the farm RPC wrappers

**Files:**
- Create: `lib/game/farm/messages.ts`, `lib/game/farm/rpc.ts`
- Test: `tests/unit/farm-messages.test.ts`, `tests/unit/farm-rpc.test.ts` (new; the RPC test mocks `@/lib/supabase`)

**Interfaces:**
- Consumes: Task 4's catalog and state modules.
- Produces (`@/lib/game/farm/messages`): `PHASE_NAME: Record<Phase, string>`, `PEST_NAME: Record<PestKind, string>`, `PEST_REMEDY: Record<PestKind, string | null>` (snail → null, leaf folder → `spray_insect`, hopper → `spray_hopper`, both blasts → `spray_fungus`), `WATER_NAME` (`Khô`, `Ẩm`, `Nông`, `Sâu`), `GIFT_TEXT`, `NOT_OPEN`, `FIELD_LOADING`, `FIELD_FAILED`, `FARM_LIMIT_TEXT`, `NO_SEED`; `durationText(ms)` ("45 phút", "3 giờ", "2 ngày 5 giờ"), `harvestText(kg, varietyName)`, `farmErrorMessage(err, itemName?)` (spec §11.7 plus the extra codes), `isMissingRpc(err)` (`PGRST202`, `42883` or "schema cache").
- Produces (`@/lib/game/farm/rpc`): `fetchFarmCatalog(): Promise<FarmCatalog>` (cached per page load; a failure is retried next call), `fetchFieldState(roomId, token)`, `FieldAction` (a union of 24 `{ kind, … }` actions: `rent`, `buy_plot`, `sell_back`, `list`, `buy_listed`, `offer`, `withdraw_offer`, `decline_offer`, `accept_offer`, `set_sublease`, `rent_sublease`, `abandon`, `prepare`, `fertilize`, `soak`, `sow`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`, `dry_start`, `dry_collect`), `actionCall(a) → [rpcName, args]`, `FieldAnswer { state, harvest: {variety, kg} | null }`, `fieldAction(roomId, token, a)`, `MineAnswer { serverNow, mine }`, `sellRice(token, variety, dry, kg)`, `buyFarmItem(token, itemId, qty)`, `claimFarmGift(token) → MineAnswer & { gifted }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-messages.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { durationText, farmErrorMessage, harvestText, isMissingRpc, PEST_NAME, PEST_REMEDY, PHASE_NAME } from "@/lib/game/farm/messages";

describe("farmErrorMessage", () => {
  it("maps the server's errors to the spec's Vietnamese (§11.7)", () => {
    const m = (message: string, item?: string) => farmErrorMessage({ message }, item);
    expect(m("not your plot")).toBe("Thửa này không phải của bạn.");
    expect(m("plot taken")).toBe("Thửa này đã có người canh tác.");
    expect(m("farm limit")).toBe("Bạn đang canh tác 2 thửa rồi.");
    expect(m("already own land")).toBe("Bạn đã có đất tư trong phòng này.");
    expect(m("not for sale")).toBe("Thửa này không rao bán.");
    expect(m("price changed")).toBe("Giá vừa đổi — xem lại nhé.");
    expect([m("offer expired"), m("offer not found")]).toEqual(["Đề nghị không còn nữa.", "Đề nghị không còn nữa."]);
    expect(m("crop exists")).toBe("Đang có lúa trên thửa — gặt hoặc bỏ vụ trước.");
    expect(m("leased")).toBe("Thửa đang cho thuê.");
    expect(m("wrong phase")).toBe("Chưa tới lúc làm việc này.");
    expect(m("not prepared")).toBe("Làm đất trước đã.");
    expect(m("need water")).toBe("Mực nước chưa đúng — xem Sổ tay.");
    expect(m("no item", "Phân kali")).toBe("Chưa có Phân kali — ghé tiệm anh Hai.");
    expect(m("drying full")).toBe("Sân phơi đã đầy.");
    expect(m("not ready")).toBe("Chưa xong.");
    expect(m("not enough rice")).toBe("Không đủ lúa.");
    expect(m("not enough coins")).toBe("Không đủ xu.");
    expect([m("invalid quantity"), m("invalid price")]).toEqual(["Số không hợp lệ.", "Số không hợp lệ."]);
    expect(m("too fast")).toBe("Từ từ thôi…");
    expect(m("account is not a member of this room")).toBe("Bạn không còn ở trong phòng này.");
    expect(m("invalid session")).toBe("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
    expect(m("boom")).toBe("Có lỗi, thử lại nhé.");
    expect(farmErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
  it("recognises a database without the v15 functions", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "Could not find the function public.field_state in the schema cache" })).toBe(true);
    expect(isMissingRpc({ code: "42883", message: "function public.field_state(uuid, text) does not exist" })).toBe(true);
    expect(isMissingRpc({ code: "22023", message: "farm limit" })).toBe(false);
  });
});

describe("names and texts", () => {
  it("names every phase and pest, and knows each pest's remedy", () => {
    expect(Object.keys(PHASE_NAME)).toHaveLength(10);
    expect(PEST_NAME.hopper).toBe("Rầy nâu");
    expect(PEST_REMEDY).toEqual({
      snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
    });
  });
  it("counts down in minutes, hours or days, rounding up", () => {
    expect(durationText(10_000)).toBe("1 phút");
    expect(durationText(45 * 60_000)).toBe("45 phút");
    expect(durationText(3 * 3_600_000)).toBe("3 giờ");
    expect(durationText(3.2 * 3_600_000)).toBe("4 giờ");
    expect(durationText(53 * 3_600_000)).toBe("2 ngày 5 giờ");
    expect(durationText(48 * 3_600_000)).toBe("2 ngày");
  });
  it("tells the harvest", () => {
    expect(harvestText(70, "Nếp")).toBe("🌾 Gặt được 70 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
  });
});
```

Create `tests/unit/farm-rpc.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice } from "@/lib/game/farm/rpc";

const FIELD = {
  server_now: "2026-09-25T10:00:00+00:00",
  plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
  drying: [],
  mine: { items: {}, rice: {}, coins: 100, gift_claimed: false, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
};
const MINE = { items: { seed_nep: 2 }, rice: {}, coins: 10, gift_claimed: true };

const filters: unknown[][] = [];
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.in = (...args: unknown[]) => {
    filters.push(args);
    return c;
  };
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
};

beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
});

describe("fetchFarmCatalog", () => {
  it("loads the varieties and the farm items once per page", async () => {
    h.from.mockImplementation((table: string) => chain(table === "rice_varieties"
      ? [{ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 }]
      : [{ id: "seed_nep", kind: "seed", name: "Giống nếp", price: 90, sort_order: 20, variety: "nep", fert: null, pest_target: null,
          capacity: null }]));
    const a = await fetchFarmCatalog();
    expect(await fetchFarmCatalog()).toBe(a);
    expect(h.from).toHaveBeenCalledTimes(2);
    expect(a.varieties[0]).toMatchObject({ id: "nep", baseKg: 75 });
    expect(a.items[0]).toMatchObject({ id: "seed_nep", kind: "seed", variety: "nep" });
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box"]]]);
  });
});

describe("field RPCs", () => {
  it("reads field_state", async () => {
    h.rpc.mockResolvedValue({ data: FIELD, error: null });
    const s = await fetchFieldState("r", "tok");
    expect(h.rpc).toHaveBeenCalledWith("field_state", { p_room_id: "r", p_session_token: "tok" });
    expect(s.plots[0].no).toBe(5);
  });
  it("names each action's RPC and arguments", () => {
    expect(actionCall({ kind: "rent", plot: 5 })).toEqual(["rent_plot", { p_plot: 5 }]);
    expect(actionCall({ kind: "sell_back", plot: 1 })).toEqual(["sell_plot_to_village", { p_plot: 1 }]);
    expect(actionCall({ kind: "list", plot: 1, price: null })).toEqual(["list_plot", { p_plot: 1, p_price: null }]);
    expect(actionCall({ kind: "buy_listed", plot: 1, expected: 900 })).toEqual(["buy_listed_plot", { p_plot: 1, p_expected_price: 900 }]);
    expect(actionCall({ kind: "accept_offer", offer: "o" })).toEqual(["accept_offer", { p_offer_id: "o" }]);
    expect(actionCall({ kind: "rent_sublease", plot: 2, expected: 300 })).toEqual(["rent_sublease", { p_plot: 2, p_expected_price: 300 }]);
    expect(actionCall({ kind: "abandon", plot: 7 })).toEqual(["abandon_crop", { p_plot: 7 }]);
    expect(actionCall({ kind: "fertilize", plot: 7, item: "fert_npk" })).toEqual(["apply_fertilizer", { p_plot: 7, p_item_id: "fert_npk" }]);
    expect(actionCall({ kind: "begin_work", plot: 7, work: "harvest" })).toEqual(["begin_work", { p_plot: 7, p_work: "harvest" }]);
    expect(actionCall({ kind: "water", plot: 7, delta: -1 })).toEqual(["water", { p_plot: 7, p_delta: -1 }]);
    expect(actionCall({ kind: "dry_start", variety: "nep", kg: 70 })).toEqual(["dry_start", { p_variety: "nep", p_kg: 70 }]);
    expect(actionCall({ kind: "dry_collect", slot: 2 })).toEqual(["dry_collect", { p_slot: 2 }]);
  });
  it("sends an action with the room and the token, and reads a harvest", async () => {
    h.rpc.mockResolvedValue({ data: { ...FIELD, harvest: { variety: "nep", kg: 70 } }, error: null });
    const r = await fieldAction("r", "tok", { kind: "harvest", plot: 7, quality: 1 });
    expect(h.rpc).toHaveBeenCalledWith("harvest", { p_room_id: "r", p_session_token: "tok", p_plot: 7, p_quality: 1 });
    expect(r.harvest).toEqual({ variety: "nep", kg: 70 });
    expect(r.state.mine.coins).toBe(100);
  });
  it("throws the server's error", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "farm limit" } });
    await expect(fieldAction("r", "tok", { kind: "rent", plot: 5 })).rejects.toMatchObject({ message: "farm limit" });
  });
});

describe("account RPCs", () => {
  it("sell, buy and claim the gift", async () => {
    h.rpc.mockResolvedValue({ data: { server_now: "2026-09-25T10:00:00+00:00", mine: MINE }, error: null });
    expect(await sellRice("tok", "nep", true, 10)).toEqual({
      serverNow: "2026-09-25T10:00:00+00:00", mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true },
    });
    expect(h.rpc).toHaveBeenLastCalledWith("sell_rice", { p_session_token: "tok", p_variety: "nep", p_dry: true, p_kg: 10 });
    await buyFarmItem("tok", "fert_npk", 3);
    expect(h.rpc).toHaveBeenLastCalledWith("buy_farm_item", { p_session_token: "tok", p_item_id: "fert_npk", p_qty: 3 });
    h.rpc.mockResolvedValue({ data: { gifted: true, server_now: "2026-09-25T10:00:00+00:00", mine: MINE }, error: null });
    expect((await claimFarmGift("tok")).gifted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/farm-messages.test.ts tests/unit/farm-rpc.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the texts and the wrappers**

Create `lib/game/farm/messages.ts`:

```ts
import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13): names, durations, toasts and the RPC errors. Pure.

export const PHASE_NAME: Record<Phase, string> = {
  prepared: "Đã làm đất", soaking: "Đang ngâm ủ", sprouted: "Hạt nứt nanh", seedling: "Mạ non", tillering: "Đẻ nhánh",
  panicle: "Làm đòng", heading: "Trổ bông", ripening: "Vào chắc", ripe: "Chín", overripe: "Chín quá",
};

export const PEST_NAME: Record<PestKind, string> = {
  snail: "Ốc bươu vàng", leaf_folder: "Sâu cuốn lá", hopper: "Rầy nâu", leaf_blast: "Đạo ôn lá", neck_blast: "Đạo ôn cổ bông",
};

/** The spray that treats each pest; snails are picked by hand (§8.5). */
export const PEST_REMEDY: Record<PestKind, string | null> = {
  snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
};

export const WATER_NAME: readonly string[] = ["Khô", "Ẩm", "Nông", "Sâu"];

export const GIFT_TEXT = "🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày và 1 bao urê — xem Sổ tay nhà nông nhé!";
export const NOT_OPEN = "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
export const FIELD_FAILED = "Chưa tải được đồng ruộng — thử lại nhé.";
export const FARM_LIMIT_TEXT = "Bạn đang canh tác 2 thửa rồi.";
export const NO_SEED = "Chưa có giống — ghé tiệm anh Hai.";

/** "45 phút", "3 giờ", "2 ngày 5 giờ" — rounded up, as a countdown reads. */
export function durationText(ms: number): string {
  if (ms <= 60_000) return "1 phút";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `${min} phút`;
  const h = Math.ceil(ms / 3_600_000);
  if (h < 48) return `${h} giờ`;
  return `${Math.floor(h / 24)} ngày${h % 24 ? ` ${h % 24} giờ` : ""}`;
}

export function harvestText(kg: number, varietyName: string): string {
  return `🌾 Gặt được ${kg} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}

/** Vietnamese toast text for a farm RPC error (spec §11.7). `itemName` names the item a "no item" error is about. */
export function farmErrorMessage(err: unknown, itemName?: string): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  switch (msg) {
    case "not your plot": return "Thửa này không phải của bạn.";
    case "plot taken": return "Thửa này đã có người canh tác.";
    case "farm limit": return FARM_LIMIT_TEXT;
    case "already own land": return "Bạn đã có đất tư trong phòng này.";
    case "not for sale": return "Thửa này không rao bán.";
    case "price changed": return "Giá vừa đổi — xem lại nhé.";
    case "offer expired":
    case "offer not found": return "Đề nghị không còn nữa.";
    case "buyer cannot buy": return "Người mua không còn đủ điều kiện (xu hoặc đất).";
    case "crop exists": return "Đang có lúa trên thửa — gặt hoặc bỏ vụ trước.";
    case "leased": return "Thửa đang cho thuê.";
    case "wrong phase": return "Chưa tới lúc làm việc này.";
    case "not prepared": return "Làm đất trước đã.";
    case "need water": return "Mực nước chưa đúng — xem Sổ tay.";
    case "no item": return `Chưa có ${itemName ?? "món này"} — ghé tiệm anh Hai.`;
    case "no snails": return "Không có ốc để bắt.";
    case "no crop": return "Thửa đang trống.";
    case "drying full": return "Sân phơi đã đầy.";
    case "not ready": return "Chưa xong.";
    case "not enough rice": return "Không đủ lúa.";
    case "not enough coins": return "Không đủ xu.";
    case "item not available": return "Món này không mua được.";
    case "invalid quantity":
    case "invalid price": return "Số không hợp lệ.";
    case "too fast": return "Từ từ thôi…";
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}

/** The database has no v15 functions yet (0013 not run): PostgREST cannot find the RPC. */
export function isMissingRpc(err: unknown): boolean {
  const e = (err && typeof err === "object" ? err : {}) as { code?: unknown; message?: unknown };
  return e.code === "PGRST202" || e.code === "42883" || (typeof e.message === "string" && e.message.includes("schema cache"));
}
```

Create `lib/game/farm/rpc.ts`:

```ts
import { supabase } from "@/lib/supabase";
import { FARM_KINDS, farmItemFromRow, varietyFromRow, type FarmCatalog, type FarmItemRow, type VarietyRow } from "./catalog";
import { parseFarmMine, parseFieldState, type FarmMine, type FieldState } from "./state";

// Supabase calls for the field (spec §11.3). Every room answer is the whole field_state; the account-only ones
// (sell_rice, buy_farm_item, claim_farm_gift) answer with the account part.

let catalogPromise: Promise<FarmCatalog> | null = null;

/** Varieties + farm items, cached per page load (a failed fetch is retried on the next call). */
export function fetchFarmCatalog(): Promise<FarmCatalog> {
  if (!catalogPromise) {
    catalogPromise = (async () => {
      const [va, it] = await Promise.all([
        supabase.from("rice_varieties").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").in("kind", FARM_KINDS).order("kind").order("sort_order"),
      ]);
      if (va.error || it.error) throw va.error ?? it.error;
      return {
        varieties: ((va.data ?? []) as VarietyRow[]).map(varietyFromRow),
        items: ((it.data ?? []) as FarmItemRow[]).map(farmItemFromRow),
      };
    })().catch((e) => {
      catalogPromise = null;
      throw e;
    });
  }
  return catalogPromise;
}

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
}

function fieldOf(raw: unknown): FieldState {
  const s = parseFieldState(raw);
  if (!s) throw new Error("bad field state");
  return s;
}

function mineOf(raw: unknown): FarmMine {
  const m = parseFarmMine(raw);
  if (!m) throw new Error("bad farm state");
  return m;
}

export async function fetchFieldState(roomId: string, token: string): Promise<FieldState> {
  return fieldOf(await call("field_state", { p_room_id: roomId, p_session_token: token }));
}

/** Every room-scoped land and farm action (§11.3). */
export type FieldAction =
  | { kind: "rent"; plot: number }
  | { kind: "buy_plot"; plot: number }
  | { kind: "sell_back"; plot: number }
  | { kind: "list"; plot: number; price: number | null }
  | { kind: "buy_listed"; plot: number; expected: number }
  | { kind: "offer"; plot: number; price: number }
  | { kind: "withdraw_offer"; offer: string }
  | { kind: "decline_offer"; offer: string }
  | { kind: "accept_offer"; offer: string }
  | { kind: "set_sublease"; plot: number; price: number | null }
  | { kind: "rent_sublease"; plot: number; expected: number }
  | { kind: "abandon"; plot: number }
  | { kind: "prepare"; plot: number }
  | { kind: "fertilize"; plot: number; item: string }
  | { kind: "soak"; plot: number; item: string }
  | { kind: "sow"; plot: number }
  | { kind: "begin_work"; plot: number; work: "transplant" | "harvest" }
  | { kind: "transplant"; plot: number; quality: number }
  | { kind: "water"; plot: number; delta: 1 | -1 }
  | { kind: "spray"; plot: number; item: string }
  | { kind: "pick_snails"; plot: number }
  | { kind: "harvest"; plot: number; quality: number }
  | { kind: "dry_start"; variety: string; kg: number }
  | { kind: "dry_collect"; slot: number };

/** The RPC name and its own arguments for an action. */
export function actionCall(a: FieldAction): [string, Record<string, unknown>] {
  switch (a.kind) {
    case "rent": return ["rent_plot", { p_plot: a.plot }];
    case "buy_plot": return ["buy_plot", { p_plot: a.plot }];
    case "sell_back": return ["sell_plot_to_village", { p_plot: a.plot }];
    case "list": return ["list_plot", { p_plot: a.plot, p_price: a.price }];
    case "buy_listed": return ["buy_listed_plot", { p_plot: a.plot, p_expected_price: a.expected }];
    case "offer": return ["offer_plot", { p_plot: a.plot, p_price: a.price }];
    case "withdraw_offer": return ["withdraw_offer", { p_offer_id: a.offer }];
    case "decline_offer": return ["decline_offer", { p_offer_id: a.offer }];
    case "accept_offer": return ["accept_offer", { p_offer_id: a.offer }];
    case "set_sublease": return ["set_sublease", { p_plot: a.plot, p_price: a.price }];
    case "rent_sublease": return ["rent_sublease", { p_plot: a.plot, p_expected_price: a.expected }];
    case "abandon": return ["abandon_crop", { p_plot: a.plot }];
    case "prepare": return ["prepare_plot", { p_plot: a.plot }];
    case "fertilize": return ["apply_fertilizer", { p_plot: a.plot, p_item_id: a.item }];
    case "soak": return ["soak_seed", { p_plot: a.plot, p_item_id: a.item }];
    case "sow": return ["sow_seed", { p_plot: a.plot }];
    case "begin_work": return ["begin_work", { p_plot: a.plot, p_work: a.work }];
    case "transplant": return ["transplant", { p_plot: a.plot, p_quality: a.quality }];
    case "water": return ["water", { p_plot: a.plot, p_delta: a.delta }];
    case "spray": return ["spray", { p_plot: a.plot, p_item_id: a.item }];
    case "pick_snails": return ["pick_snails", { p_plot: a.plot }];
    case "harvest": return ["harvest", { p_plot: a.plot, p_quality: a.quality }];
    case "dry_start": return ["dry_start", { p_variety: a.variety, p_kg: a.kg }];
    case "dry_collect": return ["dry_collect", { p_slot: a.slot }];
  }
}

export interface FieldAnswer { state: FieldState; harvest: { variety: string; kg: number } | null }

export async function fieldAction(roomId: string, token: string, a: FieldAction): Promise<FieldAnswer> {
  const [fn, args] = actionCall(a);
  const r = await call(fn, { p_room_id: roomId, p_session_token: token, ...args });
  const h = r.harvest && typeof r.harvest === "object" ? (r.harvest as Record<string, unknown>) : null;
  return {
    state: fieldOf(r),
    harvest: h && typeof h.variety === "string" && typeof h.kg === "number" ? { variety: h.variety, kg: h.kg } : null,
  };
}

export interface MineAnswer { serverNow: string | null; mine: FarmMine }

function mineAnswer(r: Record<string, unknown>): MineAnswer {
  return { serverNow: typeof r.server_now === "string" ? r.server_now : null, mine: mineOf(r.mine) };
}

export async function sellRice(token: string, variety: string, dry: boolean, kg: number): Promise<MineAnswer> {
  return mineAnswer(await call("sell_rice", { p_session_token: token, p_variety: variety, p_dry: dry, p_kg: kg }));
}

export async function buyFarmItem(token: string, itemId: string, qty: number): Promise<MineAnswer> {
  return mineAnswer(await call("buy_farm_item", { p_session_token: token, p_item_id: itemId, p_qty: qty }));
}

export async function claimFarmGift(token: string): Promise<MineAnswer & { gifted: boolean }> {
  const r = await call("claim_farm_gift", { p_session_token: token });
  return { ...mineAnswer(r), gifted: r.gifted === true };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/unit/farm-messages.test.ts tests/unit/farm-rpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/farm/messages.ts lib/game/farm/rpc.ts tests/unit/farm-messages.test.ts tests/unit/farm-rpc.test.ts` (clean).

```bash
git add lib/game/farm/messages.ts lib/game/farm/rpc.ts tests/unit/farm-messages.test.ts tests/unit/farm-rpc.test.ts
git commit -m "feat(v15): farm texts, error messages and RPC wrappers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Land rules, plot actions and due tasks

**Files:**
- Create: `lib/game/farm/land.ts`, `lib/game/farm/actions.ts`
- Test: `tests/unit/farm-land.test.ts`, `tests/unit/farm-actions.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 4–6 (`FarmCatalog`, `Variety`, the crop model, `FieldAction`, the texts).
- Produces (`@/lib/game/farm/land`): `LandCtx { me, plots, mine: FieldMine }`, `isFarmer(p, me)`, `isOwner(p, me)`, `farmingCount(ctx)`, `reasonText(code)`; refusal checks that return the server's error code or `null`, in the server's order: `rentRefusal(p, ctx)`, `buyPlotRefusal(p, ctx)`, `buyListedRefusal(p, ctx)`, `rentSubleaseRefusal(p, ctx)`, `offerRefusal(p, ctx, price)`, `listRefusal(p, ctx, price | null)`, `subleaseRefusal(p, ctx, price | null)`, `sellBackRefusal(p, ctx)`, `acceptRefusal(offer, ctx)`.
- Produces (`@/lib/game/farm/actions`): `PlotRun = FieldAction | { kind: "work"; plot; work: "transplant" | "harvest" }`, `PlotAction { key, label, run, enabled, why?, warn?, hint? }`, `FarmTask { plot, text, urgent }`; `fertAdvice(c, v, item, now) → { ok, text }`; `plotActions(p, me, v, catalog, mine, now)` (anyone: `pick` when a snail is active; the farmer: `prepare`, `soak:<item>`, `sow`, `transplant` / `harvest` as work actions, `water_up`, `water_down`, `fert:<item>`, `spray:<item>`, `abandon`); `dueTasks(plots, me, varieties, now)` (urgent first, then by plot; texts like "Thửa 5 · Bón thúc đẻ nhánh — còn 5 giờ").

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-land.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, listRefusal, offerRefusal, reasonText, rentRefusal,
  rentSubleaseRefusal, sellBackRefusal, subleaseRefusal, type LandCtx,
} from "@/lib/game/farm/land";
import type { CropView, FieldMine, PlotView } from "@/lib/game/farm/state";

const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const plot = (no: number, over: Partial<PlotView> = {}): PlotView => ({
  no, kind: no <= 4 ? "private" : "village", owner: null, salePrice: null, subleasePrice: null, farmer: null, lease: null,
  offers: 0, crop: null, ...over,
});
const CROP = { phase: "prepared" } as CropView;
const LEASE = { source: "village" as const, until: 1e15, price: 250 };
const mine = (coins: number): FieldMine => ({
  items: {}, rice: {}, coins, giftClaimed: true, ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
});
const ctx = (plots: PlotView[], coins = 10_000): LandCtx => ({ me: "me", plots, mine: mine(coins) });

describe("farming and renting", () => {
  it("counts the plots I farm", () => {
    expect(farmingCount(ctx([plot(1, { owner: ME, farmer: ME }), plot(5, { farmer: ME, lease: LEASE }), plot(2, { owner: ME, farmer: LAN })]))).toBe(2);
  });
  it("rents free village plots within the limit and the coins", () => {
    const free = plot(5);
    expect(rentRefusal(free, ctx([free]))).toBeNull();
    expect(rentRefusal(plot(6, { lease: LEASE, farmer: LAN }), ctx([]))).toBe("plot taken");
    const two = [plot(7, { farmer: ME, lease: LEASE }), plot(8, { farmer: ME, lease: LEASE })];
    expect(rentRefusal(free, ctx([free, ...two]))).toBe("farm limit");
    expect(rentRefusal(free, ctx([free], 249))).toBe("not enough coins");
    expect(reasonText("farm limit")).toBe("Bạn đang canh tác 2 thửa rồi.");
  });
});

describe("buying land", () => {
  it("from the village: one private plot, within the limit", () => {
    const p2 = plot(2);
    expect(buyPlotRefusal(p2, ctx([p2]))).toBeNull();
    expect(buyPlotRefusal(plot(3, { owner: LAN, farmer: LAN }), ctx([]))).toBe("not for sale");
    expect(buyPlotRefusal(plot(2, { lease: LEASE }), ctx([]))).toBe("leased");
    expect(buyPlotRefusal(p2, ctx([p2, plot(1, { owner: ME, farmer: LAN, lease: LEASE })]))).toBe("already own land");
    expect(buyPlotRefusal(p2, ctx([p2], 3999))).toBe("not enough coins");
  });
  it("a listing, at its price", () => {
    const listed = plot(3, { owner: LAN, farmer: LAN, salePrice: 9000 });
    expect(buyListedRefusal(listed, ctx([listed]))).toBeNull();
    expect(buyListedRefusal(listed, ctx([listed], 8999))).toBe("not enough coins");
    expect(buyListedRefusal(plot(3, { owner: ME, salePrice: 9000 }), ctx([]))).toBe("invalid plot");
    expect(buyListedRefusal(plot(3, { owner: LAN }), ctx([]))).toBe("not for sale");
    expect(buyListedRefusal({ ...listed, crop: CROP }, ctx([]))).toBe("crop exists");
  });
  it("offers: to an owner, at a sane price, if I own no land here", () => {
    const theirs = plot(3, { owner: LAN, farmer: LAN });
    expect(offerRefusal(theirs, ctx([theirs]), 5000)).toBeNull();
    expect(offerRefusal(theirs, ctx([theirs]), 0)).toBe("invalid price");
    expect(offerRefusal(theirs, ctx([theirs]), 1_000_001)).toBe("invalid price");
    expect(offerRefusal(plot(2), ctx([]), 5000)).toBe("not for sale");
    expect(offerRefusal(theirs, ctx([theirs, plot(1, { owner: ME, farmer: ME })]), 5000)).toBe("already own land");
  });
  it("a sublease, at its price", () => {
    const sub = plot(1, { owner: LAN, farmer: LAN, subleasePrice: 300 });
    expect(rentSubleaseRefusal(sub, ctx([sub]))).toBeNull();
    expect(rentSubleaseRefusal({ ...sub, lease: LEASE }, ctx([]))).toBe("plot taken");
  });
});

describe("the owner's land actions", () => {
  const mineBare = plot(1, { owner: ME, farmer: ME });
  it("lists and subleases a bare, unleased plot", () => {
    expect(listRefusal(mineBare, ctx([mineBare]), 5000)).toBeNull();
    expect(listRefusal({ ...mineBare, crop: CROP }, ctx([]), 5000)).toBe("crop exists");
    expect(listRefusal({ ...mineBare, crop: CROP }, ctx([]), null)).toBeNull();
    expect(subleaseRefusal(mineBare, ctx([]), 5001)).toBe("invalid price");
    expect(subleaseRefusal({ ...mineBare, lease: LEASE, farmer: LAN }, ctx([]), 300)).toBe("leased");
    expect(listRefusal(plot(2, { owner: LAN }), ctx([]), 5000)).toBe("not your plot");
  });
  it("sells back unless farming a crop on it; a renter's crop does not matter", () => {
    expect(sellBackRefusal(mineBare, ctx([]))).toBeNull();
    expect(sellBackRefusal({ ...mineBare, crop: CROP }, ctx([]))).toBe("crop exists");
    expect(sellBackRefusal({ ...mineBare, crop: CROP, farmer: LAN, lease: LEASE }, ctx([]))).toBeNull();
  });
  it("accepts an offer on a bare, unleased plot", () => {
    const offer = { id: "o", plot: 1, price: 5000, expiresAt: 0, buyer: LAN };
    expect(acceptRefusal(offer, ctx([mineBare]))).toBeNull();
    expect(acceptRefusal(offer, ctx([{ ...mineBare, crop: CROP }]))).toBe("crop exists");
    expect(acceptRefusal({ ...offer, plot: 2 }, ctx([mineBare]))).toBe("not your plot");
  });
});
```

Create `tests/unit/farm-actions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dueTasks, fertAdvice, plotActions, type PlotAction } from "@/lib/game/farm/actions";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { HOUR_MS, type CropModel } from "@/lib/game/farm/crop";
import type { CropView, FarmMine, PestView, PlotView } from "@/lib/game/farm/state";

const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const item = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price: 50, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const CATALOG: FarmCatalog = {
  varieties: [nep],
  items: [
    item("seed_nep", "seed", "Giống nếp", { variety: "nep" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", { fert: "manure" }),
    item("fert_urea", "fertilizer", "Phân urê", { fert: "urea" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", { pest_target: "hopper" }),
  ],
};
const ME = { id: "me", name: "Me" };
const mine = (items: Record<string, number>): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true });
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });

/** A crop on plot 5 farmed by me: soaked at 0 h, flooded (3) at 0 h, plus whatever `over` sets. */
const crop = (over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 3]], fert: Array<[number, string]> = []): CropView => ({
  variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null, water: 0, waterSetAt: null,
  pests: [], excessN: false, ripe: false, rottedAt: null,
  log: { water: water.map(([h, l]) => ({ t: at(h), l })), fert: fert.map(([h, i]) => ({ t: at(h), item: i })), spray: [], picks: [], qTransplant: 1 },
  ...over,
});
const plot = (c: CropView | null, over: Partial<PlotView> = {}): PlotView => ({
  no: 5, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: ME,
  lease: { source: "village", until: at(96), price: 250 }, offers: 0, crop: c, ...over,
});
const find = (list: PlotAction[], key: string) => list.find((a) => a.key === key);
const keys = (list: PlotAction[]) => list.map((a) => a.key);

describe("plotActions", () => {
  it("offers làm đất and soaking on a bare plot", () => {
    expect(keys(plotActions(plot(null), "me", null, CATALOG, ALL, at(0)))).toEqual(["prepare", "soak:seed_nep"]);
    const noSeed = plotActions(plot(null), "me", null, CATALOG, mine({}), at(0));
    expect(find(noSeed, "soak")).toMatchObject({ enabled: false, why: "Chưa có giống — ghé tiệm anh Hai." });
  });
  it("lets a neighbour only pick the snails", () => {
    const snail: PestView = { kind: "snail", since: at(16), treatedAt: null };
    const p = plot(crop({ transplantAt: at(12), sowAt: at(3), pests: [snail], log: null }), { farmer: { id: "lan", name: "Lan" } });
    expect(plotActions(p, "me", nep, CATALOG, ALL, at(20))).toEqual([
      { key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot: 5 }, enabled: true },
    ]);
  });
  it("sows sprouted seed on a moist bed only", () => {
    const flooded = plotActions(plot(crop()), "me", nep, CATALOG, ALL, at(3));
    expect(find(flooded, "sow")).toMatchObject({ enabled: false, why: "Cần mực nước Ẩm (đang Sâu)." });
    const moist = plotActions(plot(crop({}, [[0, 3], [2.75, 1]])), "me", nep, CATALOG, ALL, at(3));
    expect(find(moist, "sow")).toMatchObject({ enabled: true, run: { kind: "sow", plot: 5 } });
    expect(find(plotActions(plot(crop()), "me", nep, CATALOG, ALL, at(1)), "sow")?.why).toBe("Hạt đang ngâm — nứt nanh sau 1 giờ.");
  });
  it("transplants seedlings old enough in shallow water, as a work action", () => {
    const seedlings = (water: Array<[number, number]>) => plot(crop({ sowAt: at(3) }, water));
    expect(find(plotActions(seedlings([[0, 1]]), "me", nep, CATALOG, ALL, at(6)), "transplant")?.why)
      .toBe("Mạ chưa đủ tuổi — cấy được sau 5 giờ.");
    expect(find(plotActions(seedlings([[0, 1]]), "me", nep, CATALOG, ALL, at(11)), "transplant")?.why)
      .toBe("Cần mực nước Nông (đang Ẩm).");
    expect(find(plotActions(seedlings([[0, 1], [11, 2]]), "me", nep, CATALOG, ALL, at(11)), "transplant"))
      .toMatchObject({ enabled: true, run: { kind: "work", plot: 5, work: "transplant" } });
  });
  it("harvests ripe rice in a drained plot", () => {
    const ripe = (water: Array<[number, number]>) => plot(crop({ sowAt: at(3), transplantAt: at(12) }, water));
    expect(find(plotActions(ripe([[0, 3], [50, 1]]), "me", nep, CATALOG, ALL, at(55)), "harvest")?.why).toBe("Lúa chưa chín — gặt được sau 5 giờ.");
    expect(find(plotActions(ripe([[0, 3], [55, 3]]), "me", nep, CATALOG, ALL, at(61)), "harvest")?.why).toBe("Rút nước trước khi gặt (đang Sâu).");
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, ALL, at(61)), "harvest")?.enabled).toBe(true);
  });
  it("says which fertilizer and spray help, and warns about the rest", () => {
    const list = plotActions(plot(crop({ sowAt: at(3), transplantAt: at(12) })), "me", nep, CATALOG, ALL, at(17));
    expect(find(list, "fert:fert_urea")).toMatchObject({ enabled: true, hint: "Đúng lúc bón thúc đẻ nhánh." });
    expect(find(list, "fert:fert_manure")?.warn).toBe("Đã cấy — bón lót bây giờ là phí.");
    expect(find(list, "spray:spray_hopper")?.warn).toBe("Không có sâu bệnh nào trị bằng thuốc này — xịt là phí.");
    const hopper: PestView = { kind: "hopper", since: at(16), treatedAt: null };
    const sick = plotActions(plot(crop({ sowAt: at(3), transplantAt: at(12), pests: [hopper] })), "me", nep, CATALOG, ALL, at(17));
    expect(find(sick, "spray:spray_hopper")?.hint).toBe("Trị rầy nâu.");
    expect(keys(sick)).toEqual(["water_up", "water_down", "fert:fert_manure", "fert:fert_urea", "spray:spray_hopper", "abandon"]);
  });
});

describe("fertAdvice", () => {
  const c = (fert: Array<[number, string]>): CropModel => ({
    soakAt: at(0), sowAt: at(3), transplantAt: at(12), qTransplant: 1, water: [{ t: at(0), l: 3 }],
    fert: fert.map(([h, i]) => ({ t: at(h), item: i })),
  });
  it("follows the top-dress windows and warns about excess nitrogen", () => {
    expect(fertAdvice(c([]), nep, "fert_urea", at(13)).text).toBe("Hơi sớm — chỉ được nửa công (đúng lúc sau 1 giờ).");
    expect(fertAdvice(c([[17, "fert_urea"]]), nep, "fert_urea", at(18))).toEqual({ ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" });
    expect(fertAdvice(c([[17, "fert_urea"]]), nep, "fert_potash", at(18)).text).toBe("Đã bón thúc đẻ nhánh đủ — bón thêm là phí.");
    expect(fertAdvice(c([]), nep, "fert_potash", at(32))).toEqual({ ok: true, text: "Đúng lúc bón đón đòng." });
    expect(fertAdvice(c([]), nep, "fert_urea", at(32)).text).toBe("Urê lúc làm đòng gây dư đạm!");
    expect(fertAdvice(c([]), nep, "fert_npk", at(45)).text).toBe("Bón đạm lúc này gây dư đạm!");
    expect(fertAdvice({ ...c([]), transplantAt: null }, nep, "fert_manure", at(2))).toEqual({ ok: true, text: "Bón lót trước khi cấy." });
  });
});

describe("dueTasks", () => {
  it("lists what is due on my plots, urgent first", () => {
    const hopper: PestView = { kind: "hopper", since: at(16), treatedAt: null };
    const plots = [
      plot(null, { no: 6 }),
      plot(crop({ sowAt: at(3), transplantAt: at(12), pests: [hopper] }, [[0, 3], [12, 2]], [[1, "fert_manure"], [1, "fert_phosphate"]])),
      plot(null, { no: 7, farmer: { id: "lan", name: "Lan" } }),
    ];
    expect(dueTasks(plots, "me", [nep], at(17))).toEqual([
      { plot: 5, text: "Thửa 5 · Bón thúc đẻ nhánh — còn 5 giờ", urgent: true },
      { plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true },
      { plot: 6, text: "Thửa 6 · Làm đất, ngâm giống", urgent: false },
    ]);
  });
  it("warns about the water, the lease and the harvest", () => {
    const p = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [12, 2]]), { lease: { source: "village", until: at(26), price: 250 } });
    expect(dueTasks([p], "me", [nep], at(24)).map((t) => t.text)).toEqual([
      "Thửa 5 · Hết hạn thuê sau 2 giờ",
      "Thửa 5 · Bơm nước (đang Ẩm, cần Nông)",
    ]);
    const ripe = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [52, 1]]));
    expect(dueTasks([ripe], "me", [nep], at(70))).toEqual([{ plot: 5, text: "Thửa 5 · Gặt — còn 2 giờ", urgent: true }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/farm-land.test.ts tests/unit/farm-actions.test.ts`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the land rules and the plot actions**

Create `lib/game/farm/land.ts`:

```ts
import { FARM_LIMIT, PLOT_PRICE, RENT_PRICE, SALE_MAX, SUBLEASE_MAX } from "./catalog";
import { farmErrorMessage } from "./messages";
import type { FieldMine, OfferView, PlotView } from "./state";

// Land rules on the client (spec §7): who farms what, and why a land action would be refused right now. Each check
// returns the error code the server would raise (the same order of checks), or null — farmErrorMessage turns a code
// into the Vietnamese reason a disabled button shows. Pure.

export interface LandCtx { me: string; plots: readonly PlotView[]; mine: FieldMine }

export const isFarmer = (p: PlotView, me: string): boolean => p.farmer?.id === me;
export const isOwner = (p: PlotView, me: string): boolean => p.owner?.id === me;

/** The plots I farm here (the limit is 2): leased ones and my own unleased plot. */
export function farmingCount(ctx: LandCtx): number {
  return ctx.plots.filter((p) => isFarmer(p, ctx.me)).length;
}

const atLimit = (ctx: LandCtx) => farmingCount(ctx) >= FARM_LIMIT;
const ownsLand = (ctx: LandCtx) => ctx.plots.some((p) => isOwner(p, ctx.me));
const plotOf = (ctx: LandCtx, no: number) => ctx.plots.find((p) => p.no === no) ?? null;

/** The reason text for a refusal code. */
export function reasonText(code: string): string {
  return farmErrorMessage({ message: code });
}

export function rentRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (p.kind !== "village") return "invalid plot";
  if (p.lease) return "plot taken";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < RENT_PRICE) return "not enough coins";
  return null;
}

/** Buying an ownerless private plot from the village. */
export function buyPlotRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (p.kind !== "private" || p.owner) return "not for sale";
  if (p.lease) return "leased";
  if (ownsLand(ctx)) return "already own land";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < PLOT_PRICE) return "not enough coins";
  return null;
}

export function buyListedRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (!p.owner || p.salePrice === null) return "not for sale";
  if (p.owner.id === ctx.me) return "invalid plot";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  if (ownsLand(ctx)) return "already own land";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < p.salePrice) return "not enough coins";
  return null;
}

export function rentSubleaseRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (!p.owner || p.subleasePrice === null) return "not for sale";
  if (p.owner.id === ctx.me) return "invalid plot";
  if (p.lease) return "plot taken";
  if (p.crop) return "crop exists";
  if (atLimit(ctx)) return "farm limit";
  if (ctx.mine.coins < p.subleasePrice) return "not enough coins";
  return null;
}

const priceOk = (price: number, max: number) => Number.isInteger(price) && price >= 1 && price <= max;

export function offerRefusal(p: PlotView, ctx: LandCtx, price: number): string | null {
  if (!p.owner) return "not for sale";
  if (p.owner.id === ctx.me) return "invalid plot";
  if (!priceOk(price, SALE_MAX)) return "invalid price";
  if (ownsLand(ctx)) return "already own land";
  return null;
}

/** Listing at `price`, or withdrawing the listing (null). */
export function listRefusal(p: PlotView, ctx: LandCtx, price: number | null): string | null {
  if (!isOwner(p, ctx.me)) return "not your plot";
  if (price === null) return null;
  if (!priceOk(price, SALE_MAX)) return "invalid price";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  return null;
}

/** Offering the plot for one season at `price`, or withdrawing that (null). */
export function subleaseRefusal(p: PlotView, ctx: LandCtx, price: number | null): string | null {
  if (!isOwner(p, ctx.me)) return "not your plot";
  if (price === null) return null;
  if (!priceOk(price, SUBLEASE_MAX)) return "invalid price";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  return null;
}

/** Selling back to the village: refused while I farm a crop on it (a renter's crop does not matter). */
export function sellBackRefusal(p: PlotView, ctx: LandCtx): string | null {
  if (!isOwner(p, ctx.me)) return "not your plot";
  if (p.crop && isFarmer(p, ctx.me)) return "crop exists";
  return null;
}

/** Accepting an offer: the buyer is checked by the server. */
export function acceptRefusal(o: OfferView, ctx: LandCtx): string | null {
  const p = plotOf(ctx, o.plot);
  if (!p || !isOwner(p, ctx.me)) return "not your plot";
  if (p.crop) return "crop exists";
  if (p.lease) return "leased";
  return null;
}
```

Create `lib/game/farm/actions.ts`:

```ts
import type { FarmCatalog, FarmItemKind, Variety } from "./catalog";
import {
  cropCare, cropModel, cropPhase, HOUR_MS, overripeAt, ripeAt, rotAt, seedlingsOldAt, sowLateAt, sproutAt,
  transplantReadyAt, waterAt, wantedWater, type CropModel,
} from "./crop";
import { durationText, NO_SEED, PEST_NAME, PEST_REMEDY, WATER_NAME } from "./messages";
import type { FieldAction } from "./rpc";
import type { FarmMine, PlotView } from "./state";

// What can be done on a plot right now (the plot panel's buttons) and what is due on my plots (the HUD task list,
// spec §13.1–13.2). Pure.

/** A button's job: an RPC, or a 2-second work action (begin_work, then transplant / harvest). */
export type PlotRun = FieldAction | { kind: "work"; plot: number; work: "transplant" | "harvest" };

export interface PlotAction {
  key: string;
  label: string;
  run: PlotRun;
  enabled: boolean;
  /** Why it is disabled. */
  why?: string;
  /** Asked before doing it: the item would be wasted, or worse. */
  warn?: string;
  /** A good use, said on the button's line. */
  hint?: string;
}

export interface FarmTask { plot: number; text: string; urgent: boolean }

const REMEDY_LABEL: Record<string, string> = { spray_insect: "thuốc trừ sâu", spray_hopper: "thuốc trừ rầy", spray_fungus: "thuốc trừ bệnh" };
const isN = (item: string) => item === "fert_urea" || item === "fert_npk";
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Would this fertilizer help now? ok = a good use (the hint), otherwise the warning shown before confirming. */
export function fertAdvice(c: CropModel, v: Variety | null, item: string, now: number): { ok: boolean; text: string } {
  const base = item === "fert_manure" || item === "fert_phosphate";
  if (c.transplantAt === null || now < c.transplantAt) {
    if (!base) return { ok: false, text: "Chưa cấy — phân bón thúc bây giờ là phí." };
    return c.fert.some((e) => e.item === item)
      ? { ok: false, text: "Đã bón lót loại này — bón thêm là phí." }
      : { ok: true, text: "Bón lót trước khi cấy." };
  }
  if (base) return { ok: false, text: "Đã cấy — bón lót bây giờ là phí." };
  const s = v?.scale ?? 1;
  const T = (now - c.transplantAt) / HOUR_MS;
  const ph = cropPhase(c, v, now);
  const nIn = (phase: string) => c.fert.filter((e) => isN(e.item) && cropPhase(c, v, e.t) === phase).length;
  if (ph === "tillering") {
    if (isN(item) && nIn("tillering") >= 1) return { ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" };
    if (cropCare(c, v).td1 === 0) return { ok: false, text: "Đã bón thúc đẻ nhánh đủ — bón thêm là phí." };
    if (!isN(item)) return { ok: false, text: "Kali để đón đòng — bây giờ chỉ được nửa công." };
    if (T < 2 * s) return { ok: false, text: `Hơi sớm — chỉ được nửa công (đúng lúc sau ${durationText((2 * s - T) * HOUR_MS)}).` };
    if (T <= 10 * s) return { ok: true, text: "Đúng lúc bón thúc đẻ nhánh." };
    return { ok: false, text: "Trễ rồi — chỉ được nửa công." };
  }
  if (ph === "panicle") {
    if (item === "fert_urea") return { ok: false, text: "Urê lúc làm đòng gây dư đạm!" };
    if (item === "fert_npk" && nIn("panicle") >= 1) return { ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" };
    if (cropCare(c, v).td2 === 0) return { ok: false, text: "Đã bón đón đòng đủ — bón thêm là phí." };
    if (T <= 24 * s) return { ok: true, text: "Đúng lúc bón đón đòng." };
    return { ok: false, text: "Trễ rồi — chỉ được nửa công." };
  }
  if (isN(item)) return { ok: false, text: "Bón đạm lúc này gây dư đạm!" };
  return { ok: false, text: "Quá muộn — phân này sẽ phí." };
}

/** The buttons of the plot panel for `me` (spec §13.2). Anyone may pick snails; the rest is for the plot's farmer. */
export function plotActions(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): PlotAction[] {
  const out: PlotAction[] = [];
  const crop = p.crop;
  const plot = p.no;
  if (crop?.pests.some((x) => x.kind === "snail" && x.treatedAt === null)) {
    out.push({ key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot }, enabled: true });
  }
  if (p.farmer?.id !== me) return out;
  const owned = (kind: FarmItemKind) => catalog.items.filter((i) => i.kind === kind && (mine.items[i.id] ?? 0) > 0);
  const soaks = (): PlotAction[] => {
    const seeds = owned("seed");
    if (seeds.length === 0) return [{ key: "soak", label: "Ngâm giống", run: { kind: "soak", plot, item: "" }, enabled: false, why: NO_SEED }];
    return seeds.map((i) => ({ key: `soak:${i.id}`, label: `Ngâm ${lower(i.name)}`, run: { kind: "soak", plot, item: i.id }, enabled: true }));
  };
  const prepare: PlotAction = { key: "prepare", label: "Làm đất", run: { kind: "prepare", plot }, enabled: true, hint: "Cày bừa, cho nước vào ngập ruộng." };
  if (!crop) return [...out, prepare, ...soaks()];

  const c = cropModel(crop);
  const ph = cropPhase(c, v, now);
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  if (crop.preparedAt === null) out.push(prepare);
  if (c.soakAt === null && c.sowAt === null) out.push(...soaks());
  if (ph === "soaking") {
    out.push({ key: "sow", label: "Gieo mạ", run: { kind: "sow", plot }, enabled: false, why: `Hạt đang ngâm — nứt nanh sau ${durationText(sproutAt(c)! - now)}.` });
  } else if (ph === "sprouted") {
    const why = crop.preparedAt === null ? "Làm đất trước đã." : w !== 1 ? `Cần mực nước Ẩm (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "sow", label: "Gieo mạ", run: { kind: "sow", plot }, enabled: !why, why });
  } else if (ph === "seedling" && v) {
    const ready = transplantReadyAt(c, v)!;
    const why = now < ready ? `Mạ chưa đủ tuổi — cấy được sau ${durationText(ready - now)}.` : w !== 2 ? `Cần mực nước Nông (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "transplant", label: "Cấy lúa", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else if (ph === "ripening" && v) {
    out.push({ key: "harvest", label: "Gặt lúa", run: { kind: "work", plot, work: "harvest" }, enabled: false, why: `Lúa chưa chín — gặt được sau ${durationText(ripeAt(c, v)! - now)}.` });
  } else if (ph === "ripe" || ph === "overripe") {
    const why = w > 1 ? `Rút nước trước khi gặt (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "harvest", label: "Gặt lúa", run: { kind: "work", plot, work: "harvest" }, enabled: !why, why });
  }
  if (crop.preparedAt !== null) {
    out.push({ key: "water_up", label: w >= 3 ? "Bơm thêm nước (giữ Sâu)" : `Bơm nước (lên ${WATER_NAME[w + 1]})`, run: { kind: "water", plot, delta: 1 }, enabled: true });
    out.push({
      key: "water_down", label: w === 0 ? "Tháo nước" : `Tháo nước (xuống ${WATER_NAME[w - 1]})`, run: { kind: "water", plot, delta: -1 },
      enabled: w > 0, why: w === 0 ? "Ruộng đã khô." : undefined,
    });
    for (const f of owned("fertilizer")) {
      const a = fertAdvice(c, v, f.id, now);
      out.push({ key: `fert:${f.id}`, label: `Bón ${lower(f.name)}`, run: { kind: "fertilize", plot, item: f.id }, enabled: true, ...(a.ok ? { hint: a.text } : { warn: a.text }) });
    }
    for (const s of owned("pesticide")) {
      const target = crop.pests.find((x) => x.treatedAt === null && PEST_REMEDY[x.kind] === s.id);
      out.push({
        key: `spray:${s.id}`, label: `Xịt ${lower(s.name)}`, run: { kind: "spray", plot, item: s.id }, enabled: true,
        ...(target ? { hint: `Trị ${lower(PEST_NAME[target.kind])}.` } : { warn: "Không có sâu bệnh nào trị bằng thuốc này — xịt là phí." }),
      });
    }
  }
  out.push({ key: "abandon", label: "Bỏ vụ", run: { kind: "abandon", plot }, enabled: true, warn: "Bỏ vụ là mất hết lúa trên thửa này." });
  return out;
}

/** What is due on the plots I farm (spec §13.1): urgent tasks first, then by plot. */
export function dueTasks(plots: readonly PlotView[], me: string, varieties: readonly Variety[], now: number): FarmTask[] {
  const out: FarmTask[] = [];
  for (const p of plots) {
    if (p.farmer?.id !== me) continue;
    const add = (text: string, urgent: boolean) => out.push({ plot: p.no, text: `Thửa ${p.no} · ${text}`, urgent });
    if (p.lease && p.lease.until - now <= 12 * HOUR_MS) add(`Hết hạn thuê sau ${durationText(p.lease.until - now)}`, p.lease.until - now <= 3 * HOUR_MS);
    const crop = p.crop;
    if (!crop) {
      add("Làm đất, ngâm giống", false);
      continue;
    }
    const v = varieties.find((x) => x.id === crop.variety) ?? null;
    const c = cropModel(crop);
    const ph = cropPhase(c, v, now);
    const w = crop.log ? waterAt(c.water, now) : crop.water;
    if (crop.preparedAt === null) add("Làm đất", false);
    if (c.transplantAt === null && crop.preparedAt !== null) {
      const care = cropCare(c, v);
      if (!care.manure || !care.phosphate) add("Bón lót (phân chuồng, phân lân)", false);
    }
    const T = c.transplantAt === null ? 0 : (now - c.transplantAt) / HOUR_MS;
    const s = v?.scale ?? 1;
    switch (ph) {
      case "prepared":
        if (c.soakAt === null) add("Ngâm giống", false);
        break;
      case "soaking":
        add(`Chờ hạt nứt nanh — còn ${durationText(sproutAt(c)! - now)}`, false);
        break;
      case "sprouted":
        add(`Gieo mạ — còn ${durationText(rotAt(c)! - now)}`, now >= sowLateAt(c)!);
        break;
      case "seedling":
        if (!v) break;
        if (now < transplantReadyAt(c, v)!) add(`Mạ đang lớn — cấy được sau ${durationText(transplantReadyAt(c, v)! - now)}`, false);
        else add("Cấy lúa", now >= seedlingsOldAt(c, v)!);
        break;
      case "tillering":
        if (cropCare(c, v).td1 !== 0 && T >= 2 * s && T <= 10 * s) add(`Bón thúc đẻ nhánh — còn ${durationText((10 * s - T) * HOUR_MS)}`, true);
        if (T >= 14 * s && w > 1) add("Phơi ruộng: tháo cạn nước", false);
        break;
      case "panicle":
        if (cropCare(c, v).td2 !== 0 && T <= 24 * s) add(`Bón đón đòng — còn ${durationText((24 * s - T) * HOUR_MS)}`, true);
        break;
      case "ripe":
        if (v) add(`Gặt — còn ${durationText(overripeAt(c, v)! - now)}`, overripeAt(c, v)! - now <= 3 * HOUR_MS);
        break;
      case "overripe":
        add("Gặt ngay — lúa đang rụng!", true);
        break;
    }
    const want = crop.log ? wantedWater(c, v, now) : null;
    if (want && !want.levels.includes(w)) {
      add(`${w < want.levels[0] ? "Bơm nước" : "Tháo nước"} (đang ${WATER_NAME[w]}, cần ${want.short})`, true);
    }
    for (const x of crop.pests) {
      if (x.treatedAt !== null) continue;
      const remedy = PEST_REMEDY[x.kind];
      add(`${PEST_NAME[x.kind]}! ${remedy ? `Xịt ${REMEDY_LABEL[remedy]}` : "Bắt ốc hoặc tháo cạn nước"}`, true);
    }
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.plot - b.plot);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/unit/farm-land.test.ts tests/unit/farm-actions.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/farm/land.ts lib/game/farm/actions.ts tests/unit/farm-land.test.ts tests/unit/farm-actions.test.ts` (clean).

```bash
git add lib/game/farm/land.ts lib/game/farm/actions.ts tests/unit/farm-land.test.ts tests/unit/farm-actions.test.ts
git commit -m "feat(v15): land rules, plot actions and due tasks

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The field map — types, layout, painter, props, registry and presence

**Files:**
- Modify: `lib/game/maps/types.ts` (`field` map id, farm interact kinds, `Interactable.plot`, `PlotGeom`, new props and the rice sign icon, `GameMap.plots`)
- Modify: `lib/game/maps/arrivals.ts` (the four field arrival spots), `lib/game/look.ts` (three NPC looks)
- Create: `lib/game/maps/field.ts` (layout, collision, plots, interactables, NPCs, props), `lib/game/maps/field-art.ts` (painter)
- Modify: `lib/game/maps/props.ts` (frames + painters for the name post, the three building fronts, pump, haystack, scarecrow; the rice sign icon)
- Modify: `lib/game/maps/registry.ts` (exhaustive `build` / `paint`), `lib/game/maps/hall.ts` and `lib/game/maps/pond.ts` (`plots: []`)
- Modify: `lib/presence-modes.ts` (`KNOWN_MAPS`, `presenceMap`, `mapCounts` with `field`), `components/game/MapCounts.tsx` (🌾 Đồng)
- Test: `tests/unit/game-field-map.test.ts` (new); `tests/unit/presence-mode.test.ts`, `tests/unit/game-hud-travel.test.tsx`, `tests/unit/helpers/ascii-map.ts` (update)

**Interfaces:**
- Consumes: the v14 map system (`GameMap`, `SceneArt`, `propFrame` / `propSprite`, `computeView`, `findPath`, `isBlockedAt`).
- Produces (`@/lib/game/maps/types`): `MapId = "hall" | "pond" | "field"`, `MAP_IDS` with `field`; `InteractKind` + `"plot" | "coop" | "farm_shop" | "rice_depot" | "drying"`; `Interactable.plot?: number`; `PlotGeom { no, kind: "private" | "village", rect, post: Vec }`; props `namepost`, `coop_front`, `farmshop_front`, `ricedepot_front`, `pump`, `haystack`, `scarecrow`; sign icon `"rice"`; `GameMap.plots: PlotGeom[]`.
- Produces (`@/lib/game/maps/arrivals`): `FIELD_WEST_ARRIVE {60, 106, right}`, `FIELD_EAST_ARRIVE {760, 244, left}`, `HALL_FIELD_ARRIVE {62, 236, left}`, `POND_FIELD_ARRIVE {190, 348, down}` (Task 9 puts the portals there).
- Produces (`@/lib/game/maps/field`): `FIELD_W` 800, `FIELD_H` 480, `FIELD_CELL` 8, `CANAL`, `BRIDGES`, `FIELD_PLOTS` (plots 1–4 private north of the canal at x 72 / 224 / 376 / 528, y 52, 128 × 96; village 5–7 at y 228 and 8–10 at y 328, 128 × 76), `COOP`, `FARM_SHOP`, `RICE_DEPOT`, `PUMP_HOUSE`, `DRYING_YARD`, `DRYING_SQUARES`, `FIELD_SOLIDS`, `FIELD_INTERACTABLES` (`field_to_hall`, `field_to_pond`, `coop`, `farm_shop`, `rice_depot`, `drying`, `plot_1` … `plot_10`), `FIELD_NPCS` (chú Tám, anh Hai, cô Út), `FIELD_PROPS`, `buildFieldMap()`.
- Produces: `paintField(map): SceneArt` (`@/lib/game/maps/field-art`); `CHU_TAM_LOOK`, `ANH_HAI_LOOK`, `CO_UT_LOOK` (`@/lib/game/look`); `presenceMap(v): MapId`, `mapCounts(presence) → Record<MapId, MapMember[]>` (`@/lib/presence-modes`); the MapCounts chip reads "🎵 Sảnh N · 🎣 Ao cá N · 🌾 Đồng N".

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-field-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "@/lib/game/maps/arrivals";
import { BRIDGES, buildFieldMap, CANAL, DRYING_SQUARES, DRYING_YARD, FIELD_PLOTS, FIELD_SOLIDS } from "@/lib/game/maps/field";
import { propFrame } from "@/lib/game/maps/props";
import { overlaps } from "@/lib/game/maps/rect";
import type { InteractKind, Rect } from "@/lib/game/maps/types";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView } from "@/lib/game/scene";

const field = buildFieldMap();
const ofKind = (k: InteractKind) => field.interactables.filter((i) => i.kind === k);
const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
/** Distance from a point to a rect's edge (0 inside). */
const gap = (p: { x: number; y: number }, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));

describe("field map", () => {
  it("has the documented size, grid and interactables", () => {
    expect(field.id).toBe("field");
    expect([field.width, field.height, field.cell, field.cols, field.rows]).toEqual([800, 480, 8, 100, 60]);
    expect(field.blocked).toHaveLength(100 * 60);
    expect(field.seating).toBeNull();
    expect(field.spawn).toEqual(FIELD_WEST_ARRIVE);
    expect(field.interactables.map((i) => i.id).sort()).toEqual([
      "coop", "drying", "farm_shop", "field_to_hall", "field_to_pond",
      "plot_1", "plot_10", "plot_2", "plot_3", "plot_4", "plot_5", "plot_6", "plot_7", "plot_8", "plot_9", "rice_depot",
    ]);
  });
  it("uses the spec's prompts", () => {
    const prompt = (id: string) => field.interactables.find((i) => i.id === id)?.prompt;
    expect(prompt("field_to_hall")).toBe("Về sảnh nhạc");
    expect(prompt("field_to_pond")).toBe("Qua cầu khỉ về ao cá");
    expect(prompt("coop")).toBe("Hợp tác xã · chú Tám");
    expect(prompt("farm_shop")).toBe("Tiệm vật tư · anh Hai");
    expect(prompt("rice_depot")).toBe("Vựa lúa · cô Út");
    expect(prompt("drying")).toBe("Sân phơi lúa");
    expect(prompt("plot_3")).toBe("Xem thửa 3");
  });
  it("keeps every use spot walkable and reachable from both entrances", () => {
    for (const from of [FIELD_WEST_ARRIVE, FIELD_EAST_ARRIVE]) {
      for (const s of [FIELD_WEST_ARRIVE, FIELD_EAST_ARRIVE, ...field.interactables.map((i) => i.use)]) {
        expect(isBlockedAt(field, s.x, s.y), JSON.stringify(s)).toBe(false);
        expect(findPath(field, from, s), `${JSON.stringify(from)} → ${JSON.stringify(s)}`).not.toBeNull();
      }
    }
  });
  it("leads to the hall and the pond, each exit at its entrance", () => {
    expect(ofKind("portal")).toEqual([
      expect.objectContaining({ id: "field_to_hall", use: { x: FIELD_WEST_ARRIVE.x, y: FIELD_WEST_ARRIVE.y }, to: { map: "hall", arrive: HALL_FIELD_ARRIVE } }),
      expect.objectContaining({ id: "field_to_pond", use: { x: FIELD_EAST_ARRIVE.x, y: FIELD_EAST_ARRIVE.y }, to: { map: "pond", arrive: POND_FIELD_ARRIVE } }),
    ]);
  });
  it("lays out ten plots: 1–4 private north of the canal, 5–10 village south of it, walkable and apart", () => {
    expect(field.plots).toBe(FIELD_PLOTS);
    expect(FIELD_PLOTS.map((p) => [p.no, p.kind])).toEqual([
      [1, "private"], [2, "private"], [3, "private"], [4, "private"],
      [5, "village"], [6, "village"], [7, "village"], [8, "village"], [9, "village"], [10, "village"],
    ]);
    for (const p of FIELD_PLOTS) {
      if (p.kind === "private") expect(p.rect.y + p.rect.h, `plot ${p.no}`).toBeLessThanOrEqual(CANAL.y);
      else expect(p.rect.y, `plot ${p.no}`).toBeGreaterThanOrEqual(CANAL.y + CANAL.h);
      for (const s of [...FIELD_SOLIDS, CANAL, DRYING_YARD]) expect(overlaps(p.rect, s), `plot ${p.no}`).toBe(false);
      for (const q of FIELD_PLOTS) if (q !== p) expect(overlaps(p.rect, q.rect), `${p.no}/${q.no}`).toBe(false);
      expect(isBlockedAt(field, p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2), `plot ${p.no}`).toBe(false);
    }
  });
  it("puts each plot's use spot on its dike, facing it, and its click rect on the plot", () => {
    for (const it of ofKind("plot")) {
      const p = FIELD_PLOTS.find((q) => q.no === it.plot)!;
      expect(it.rect).toEqual(p.rect);
      expect(inside(it.use, p.rect), it.id).toBe(false);
      expect(gap(it.use, p.rect), it.id).toBeLessThanOrEqual(18);
      expect(it.face, it.id).toBe(it.use.y > p.rect.y ? "up" : "down");
      for (const o of ofKind("plot")) if (o !== it) expect(Math.hypot(o.use.x - it.use.x, o.use.y - it.use.y)).toBeGreaterThan(52);
    }
  });
  it("blocks the canal but not its bridges, the buildings, and not the drying yard", () => {
    expect(isBlockedAt(field, 300, 192)).toBe(true);
    for (const b of BRIDGES) expect(isBlockedAt(field, b.x + b.w / 2, CANAL.y + CANAL.h / 2)).toBe(false);
    expect(isBlockedAt(field, 736, 80)).toBe(true);
    expect(isBlockedAt(field, 630, 290)).toBe(true);
    expect(isBlockedAt(field, 744, 290)).toBe(true);
    for (const s of DRYING_SQUARES) expect(isBlockedAt(field, s.x + s.w / 2, s.y + s.h / 2)).toBe(false);
  });
  it("puts chú Tám, anh Hai and cô Út behind their counters, facing down", () => {
    expect(field.npcs.map((n) => n.name)).toEqual(["chú Tám", "anh Hai", "cô Út"]);
    for (const n of field.npcs) {
      expect(n.spot.dir).toBe("down");
      expect(isBlockedAt(field, n.spot.x, n.spot.y), n.name).toBe(true);
    }
  });
  it("gives every prop a sprite frame and every plot a name post", () => {
    for (const p of field.props) expect(propFrame(p).w, p.kind).toBeGreaterThan(0);
    expect(field.props.filter((p) => p.kind === "namepost")).toHaveLength(10);
  });
  it("scrolls at 800 × 480 on a desktop and a phone view", () => {
    for (const [w, h] of [[1920, 1080], [1280, 720], [780, 1688], [1170, 2532]]) {
      const v = computeView(w, h, 800, 480);
      expect(v.vw, `${w}×${h}`).toBeLessThanOrEqual(800);
      expect(v.vh, `${w}×${h}`).toBeLessThanOrEqual(480);
      for (const feet of [FIELD_WEST_ARRIVE, FIELD_EAST_ARRIVE, { x: 400, y: 470 }]) {
        const cam = cameraFor(feet, v.vw, v.vh, 800, 480);
        expect(cam.x).toBeGreaterThanOrEqual(0);
        expect(cam.x + v.vw).toBeLessThanOrEqual(800);
        expect(cam.y).toBeGreaterThanOrEqual(0);
        expect(cam.y + v.vh).toBeLessThanOrEqual(480);
      }
    }
  });
});
```

**tests/unit/presence-mode.test.ts — edit 1 of 3.** Replace:

```ts
    expect(aggregatePresenceModes({ a: [tab(undefined, "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
    expect(aggregatePresenceModes({ a: [tab("pond", "2026-09-24T11:00:00Z", "classic"), tab("hall", "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
```

with:

```ts
    expect(aggregatePresenceModes({ a: [tab(undefined, "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
    expect(aggregatePresenceModes({ a: [tab("field", "2026-09-24T10:00:00Z")] })[0].map).toBe("field");
    expect(aggregatePresenceModes({ a: [tab("moon", "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
    expect(aggregatePresenceModes({ a: [tab("pond", "2026-09-24T11:00:00Z", "classic"), tab("hall", "2026-09-24T10:00:00Z")] })[0].map).toBe("hall");
```

**tests/unit/presence-mode.test.ts — edit 2 of 3.** Replace:

```ts
      { accountId: "c", name: "Cee", mode: "game", map: "hall" },
    ];
```

with:

```ts
      { accountId: "c", name: "Cee", mode: "game", map: "hall" },
      { accountId: "d", name: "Dee", mode: "game", map: "field" },
    ];
```

**tests/unit/presence-mode.test.ts — edit 3 of 3.** Replace:

```ts
      pond: [{ accountId: "a", name: "Ann", classic: false }],
    });
    expect(mapCounts([])).toEqual({ hall: [], pond: [] });
  });
```

with:

```ts
      pond: [{ accountId: "a", name: "Ann", classic: false }],
      field: [{ accountId: "d", name: "Dee", classic: false }],
    });
    expect(mapCounts([])).toEqual({ hall: [], pond: [], field: [] });
  });
```

**tests/unit/game-hud-travel.test.tsx — edit 1 of 2.** Replace:

```tsx
      pond: [{ accountId: "c", name: "Chi", classic: false }],
    }} />);
    const chip = screen.getByRole("button", { name: "🎵 Sảnh 2 · 🎣 Ao cá 1" });
    expect(screen.queryByText("🖥️ An")).toBeNull();
```

with:

```tsx
      pond: [{ accountId: "c", name: "Chi", classic: false }],
      field: [{ accountId: "d", name: "Dũng", classic: false }],
    }} />);
    const chip = screen.getByRole("button", { name: "🎵 Sảnh 2 · 🎣 Ao cá 1 · 🌾 Đồng 1" });
    expect(screen.queryByText("🖥️ An")).toBeNull();
```

**tests/unit/game-hud-travel.test.tsx — edit 2 of 2.** Replace:

```tsx
    expect(screen.getByText("Chi")).toBeInTheDocument();
  });
```

with:

```tsx
    expect(screen.getByText("Chi")).toBeInTheDocument();
    expect(screen.getByText("Dũng")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/game-field-map.test.ts tests/unit/presence-mode.test.ts tests/unit/game-hud-travel.test.tsx`
Expected: FAIL — no field map, no `field` presence map, no 🌾 Đồng count.

- [ ] **Step 3: Extend the map types, the arrivals and the looks**

**lib/game/maps/types.ts — edit 1 of 5.** Replace:

```ts

export type MapId = "hall" | "pond";
export const MAP_IDS: readonly MapId[] = ["hall", "pond"];

export type InteractKind = "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records";
```

with:

```ts

export type MapId = "hall" | "pond" | "field";
export const MAP_IDS: readonly MapId[] = ["hall", "pond", "field"];

export type InteractKind =
  | "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records"
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying";
```

**lib/game/maps/types.ts — edit 2 of 5.** Replace:

```ts
  to?: { map: MapId; arrive: Spot };
}
```

with:

```ts
  to?: { map: MapId; arrive: Spot };
  /** plot: its number (1–10). */
  plot?: number;
}

/** A rice plot on the field (v15): its number, its land and where its name post stands. */
export interface PlotGeom { no: number; kind: "private" | "village"; rect: Rect; post: Vec }
```

**lib/game/maps/types.ts — edit 3 of 5.** Replace:

```ts
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number; icon?: "fish" | "note" }
  | { kind: "banana"; x: number; y: number }
```

with:

```ts
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number; icon?: "fish" | "note" | "rice" }
  | { kind: "banana"; x: number; y: number }
```

**lib/game/maps/types.ts — edit 4 of 5.** Replace:

```ts
  | { kind: "hut_front"; x: number; y: number }
  | { kind: "records"; x: number; y: number };
```

with:

```ts
  | { kind: "hut_front"; x: number; y: number }
  | { kind: "records"; x: number; y: number }
  | { kind: "namepost"; x: number; y: number }
  | { kind: "coop_front"; x: number; y: number }
  | { kind: "farmshop_front"; x: number; y: number }
  | { kind: "ricedepot_front"; x: number; y: number }
  | { kind: "pump"; x: number; y: number }
  | { kind: "haystack"; x: number; y: number }
  | { kind: "scarecrow"; x: number; y: number };
```

**lib/game/maps/types.ts — edit 5 of 5.** Replace:

```ts
  npcs: Npc[];
}
```

with:

```ts
  npcs: Npc[];
  /** Rice plots (the field only). */
  plots: PlotGeom[];
}
```

**lib/game/maps/arrivals.ts.** Append at the end of the file, after a blank line:

```ts
/** At the field's west entrance ("Đường làng"), beside the "Về sảnh" sign, facing into the field. */
export const FIELD_WEST_ARRIVE: Spot = { x: 60, y: 106, dir: "right" };

/** At the field's east entrance ("Cầu khỉ"), beside the "Về ao cá" sign. */
export const FIELD_EAST_ARRIVE: Spot = { x: 760, y: 244, dir: "left" };

/** In the hall, at the "Ra đồng" sign on the west edge. */
export const HALL_FIELD_ARRIVE: Spot = { x: 62, y: 236, dir: "left" };

/** At the pond, at the "Cầu khỉ ra đồng" sign in the south-west. */
export const POND_FIELD_ARRIVE: Spot = { x: 190, y: 348, dir: "down" };
```

**lib/game/look.ts.** Append at the end of the file, after a blank line:

```ts
/** chú Tám — the Hợp tác xã, where land is rented, bought and sold (v15). */
export const CHU_TAM_LOOK: Look = {
  skin: "tan", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_white", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: "neck_khanran",
};

/** anh Hai — the farm shop (Tiệm vật tư nông nghiệp). */
export const ANH_HAI_LOOK: Look = {
  skin: "warm", hair: "short", hairColor: "darkbrown",
  hat: "hat_taibeo_green", top: "top_tee_blue", bottom: "bottom_jeans", shoes: "shoes_dep_blue", neck: null,
};

/** cô Út — the rice depot (Vựa lúa). */
export const CO_UT_LOOK: Look = {
  skin: "light", hair: "long", hairColor: "black",
  hat: null, top: "top_baba_yellow", bottom: "bottom_pants_black", shoes: "shoes_dep_red", neck: "neck_khanran_red",
};
```

Every `GameMap` now needs `plots`:

**lib/game/maps/hall.ts.** Replace:

```ts
    id: "hall", width: HALL_W, height: HALL_H, cell: HALL_CELL, cols, rows, blocked,
    spawn: HALL_SPAWN, seating: HALL_SEATING, interactables: HALL_INTERACTABLES, props: HALL_PROPS, npcs: [],
  };
```

with:

```ts
    id: "hall", width: HALL_W, height: HALL_H, cell: HALL_CELL, cols, rows, blocked,
    spawn: HALL_SPAWN, seating: HALL_SEATING, interactables: HALL_INTERACTABLES, props: HALL_PROPS, npcs: [], plots: [],
  };
```

**lib/game/maps/pond.ts.** Replace:

```ts
    id: "pond", width: POND_W, height: POND_H, cell: POND_CELL, cols, rows, blocked,
    spawn: POND_ARRIVE, seating: null, interactables: POND_INTERACTABLES, props: POND_PROPS, npcs: POND_NPCS,
  };
```

with:

```ts
    id: "pond", width: POND_W, height: POND_H, cell: POND_CELL, cols, rows, blocked,
    spawn: POND_ARRIVE, seating: null, interactables: POND_INTERACTABLES, props: POND_PROPS, npcs: POND_NPCS, plots: [],
  };
```

**tests/unit/helpers/ascii-map.ts.** Replace:

```ts
    id: "hall", width: cols * cell, height: rows.length * cell, cell, cols, rows: rows.length, blocked,
    spawn: { x: 4, y: 4, dir: "down" }, seating: null, interactables: [], props: [], npcs: [],
  };
```

with:

```ts
    id: "hall", width: cols * cell, height: rows.length * cell, cell, cols, rows: rows.length, blocked,
    spawn: { x: 4, y: 4, dir: "down" }, seating: null, interactables: [], props: [], npcs: [], plots: [],
  };
```

- [ ] **Step 4: Add the field's props**

**lib/game/maps/props.ts — edit 1 of 4.** Replace:

```ts
    case "records": return { w: 28, h: 34, ox: 14, oy: 34 };
  }
```

with:

```ts
    case "records": return { w: 28, h: 34, ox: 14, oy: 34 };
    case "namepost": return { w: 10, h: 18, ox: 5, oy: 18 };
    case "coop_front": return { w: 112, h: 30, ox: 56, oy: 30 };
    case "farmshop_front": return { w: 92, h: 26, ox: 46, oy: 26 };
    case "ricedepot_front": return { w: 96, h: 26, ox: 48, oy: 26 };
    case "pump": return { w: 36, h: 48, ox: 18, oy: 48 };
    case "haystack": return { w: 30, h: 26, ox: 15, oy: 25 };
    case "scarecrow": return { w: 20, h: 34, ox: 10, oy: 34 };
  }
```

**lib/game/maps/props.ts — edit 2 of 4.** Replace:

```ts

const SIGN_ICONS: Record<"fish" | "note", { rows: string[]; color: string; x: number; y: number }> = {
  fish: { rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 },
  note: { rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 },
};

/** A signpost with a pixel icon: a fish (the hall's "Bến câu cá") or a music note (the pond's "Bến vào"). */
function drawSign(c: Ctx, icon: "fish" | "note"): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
```

with:

```ts

const SIGN_ICONS: Record<"fish" | "note" | "rice", { rows: string[]; color: string; x: number; y: number }> = {
  fish: { rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 },
  note: { rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 },
  rice: { rows: ["..#.#..", ".#.#.#.", "..#.#..", ".#.#.#.", "...#...", "...#..."], color: C.gold, x: 5, y: 2 },
};

/** A signpost with a pixel icon: a fish (to the pond), a music note (to the hall) or a rice panicle (to the field). */
function drawSign(c: Ctx, icon: "fish" | "note" | "rice"): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
```

**lib/game/maps/props.ts — edit 3 of 4.** Replace:

```ts

export function drawProp(c: Ctx, p: PropPlacement): void {
```

with:

```ts

/** A plot's name post: a stake with a small board (the owner's name is drawn over it as a label). */
function drawNamePost(c: Ctx): void {
  rect(c, C.outline, 4, 6, 3, 12); rect(c, C.wood, 5, 6, 1, 12);
  rect(c, C.outline, 0, 0, 10, 8); rect(c, C.woodPale, 1, 1, 8, 6); rect(c, C.woodDark, 2, 3, 6, 1);
}

const HTX: ReadonlyArray<readonly [number, readonly string[]]> = [
  [7, ["#..#", "#..#", "####", "#..#", "#..#"]],
  [13, ["####", ".##.", ".##.", ".##.", ".##."]],
  [19, ["#..#", ".##.", ".##.", ".##.", "#..#"]],
];

/** Hợp tác xã: the office's front wall, a window with chú Tám's desk and the red "HTX" board. */
function drawCoopFront(c: Ctx): void {
  rect(c, C.outline, 0, 4, 112, 26);
  rect(c, "#e8dcc0", 1, 5, 110, 24);
  for (let y = 8; y < 29; y += 4) rect(c, "#d6c8a6", 1, y, 110, 1);
  // the window and the desk behind it
  rect(c, C.outline, 36, 8, 40, 14); rect(c, "#a6d6e8", 37, 9, 38, 12); rect(c, C.woodDark, 37, 17, 38, 4);
  rect(c, C.paper, 42, 15, 8, 2); rect(c, C.blue, 58, 14, 3, 3);
  // the HTX board
  rect(c, C.outline, 4, 0, 24, 12); rect(c, C.red, 5, 1, 22, 10);
  for (const [x, rows] of HTX) {
    rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, C.goldLight, x + i, 4 + j);
    });
  }
  // a door and a bench
  rect(c, C.outline, 86, 10, 18, 20); rect(c, C.wood, 87, 11, 16, 19); px(c, C.gold, 100, 20);
  rect(c, C.outline, 8, 24, 22, 3); rect(c, C.woodLight, 9, 24, 20, 1);
}

/** Tiệm vật tư nông nghiệp: a counter with fertilizer sacks and pesticide bottles. */
function drawFarmShopFront(c: Ctx): void {
  rect(c, C.outline, 0, 10, 92, 16);
  rect(c, C.woodPale, 1, 11, 90, 3); rect(c, "#e0b27a", 1, 11, 90, 1);
  for (let x = 1; x < 91; x += 6) { rect(c, C.woodLight, x, 14, 5, 11); rect(c, C.wood, x + 5, 14, 1, 11); }
  for (const [x, bag, band] of [[6, C.paper, C.water], [20, C.paper, C.red], [34, "#e8dcc0", C.leafLight]] as const) {
    rect(c, C.outline, x, 1, 12, 11); rect(c, bag, x + 1, 2, 10, 9); rect(c, band, x + 1, 5, 10, 3);
  }
  for (const [x, col] of [[56, C.blue], [63, "#d9534f"], [70, "#6fbf4a"]] as const) {
    rect(c, C.outline, x, 3, 6, 8); rect(c, col, x + 1, 5, 4, 5); rect(c, C.white, x + 2, 3, 2, 2);
  }
  rect(c, C.outline, 80, 4, 9, 7); rect(c, C.paper, 81, 5, 7, 5); rect(c, C.outline, 82, 7, 5, 1);
}

/** Vựa lúa: rice sacks stacked by the counter, a platform scale (cân bàn) and a basket of paddy. */
function drawRiceDepotFront(c: Ctx): void {
  rect(c, C.outline, 0, 10, 96, 16);
  rect(c, C.woodPale, 1, 11, 94, 3); rect(c, "#e0b27a", 1, 11, 94, 1);
  for (let x = 1; x < 95; x += 6) { rect(c, "#b88a52", x, 14, 5, 11); rect(c, "#a8784a", x + 5, 14, 1, 11); }
  for (const [x, y] of [[4, 2], [17, 2], [10, -1]] as const) {
    rect(c, C.outline, x, y + 1, 14, 11); rect(c, "#e8d8a8", x + 1, y + 2, 12, 9); rect(c, "#c9a55a", x + 1, y + 8, 12, 1);
    px(c, C.gold, x + 6, y + 4); px(c, C.gold, x + 7, y + 5);
  }
  rect(c, C.outline, 62, 0, 3, 12); rect(c, C.outline, 54, 8, 22, 4); rect(c, C.silver, 55, 9, 20, 2);
  rect(c, C.outline, 58, 0, 11, 5); rect(c, C.paper, 59, 1, 9, 3); px(c, C.red, 63, 2);
  rect(c, C.outline, 78, 3, 14, 9); rect(c, "#c9a55a", 79, 4, 12, 7);
  for (let x = 80; x < 90; x += 2) px(c, C.goldLight, x, 4);
}

/** The pump house (cống) at the canal's west end: a brick hut, its roof and a valve on the pipe. */
function drawPump(c: Ctx): void {
  rect(c, C.outline, 2, 16, 30, 30);
  for (let y = 17; y < 45; y += 4) {
    for (let x = 3; x < 31; x += 7) {
      const o = (y - 17) % 8 === 0 ? 0 : 3;
      rect(c, "#b5566f", x + o, y, 6, 3); rect(c, "#8e3a4a", x + o, y + 3, 6, 1);
    }
  }
  for (let j = 0; j < 12; j++) rect(c, j === 11 ? C.outline : j % 3 === 0 ? "#6e8f3a" : "#8fb84e", 12 - j, 4 + j, 10 + j * 2, 1);
  rect(c, C.outline, 12, 3, 10, 1);
  rect(c, C.outline, 12, 30, 10, 16); rect(c, C.woodDark, 13, 31, 8, 15);
  rect(c, C.outline, 28, 38, 8, 5); rect(c, C.silver, 29, 39, 7, 3);
  rect(c, C.outline, 30, 30, 5, 5); rect(c, C.red, 31, 31, 3, 3);
}

/** A haystack (đống rơm) by the drying yard. */
function drawHaystack(c: Ctx): void {
  for (let j = 0; j < 22; j++) {
    const half = Math.round(Math.sin(((j + 2) / 24) * Math.PI) * 13);
    rect(c, C.outline, 15 - half - 1, 2 + j, half * 2 + 2, 1);
    rect(c, j % 4 === 1 ? "#c9a55a" : j % 4 === 3 ? "#a8843f" : "#e0c27a", 15 - half, 2 + j, half * 2, 1);
  }
  rect(c, C.outline, 2, 24, 26, 1);
  rect(c, C.woodDark, 14, 0, 2, 4);
}

/** Bù nhìn: a straw scarecrow in a nón lá with outstretched sleeves. */
function drawScarecrow(c: Ctx): void {
  rect(c, C.outline, 9, 10, 2, 24); rect(c, C.woodDark, 9, 10, 1, 24);
  rect(c, C.outline, 1, 14, 18, 3); rect(c, C.woodLight, 2, 15, 16, 1);
  rect(c, C.outline, 5, 15, 10, 11); rect(c, C.blue, 6, 16, 8, 9); rect(c, "#2f63a0", 6, 22, 8, 1);
  rect(c, "#e0c27a", 1, 16, 3, 3); rect(c, "#e0c27a", 16, 16, 3, 3);
  rect(c, C.outline, 7, 6, 6, 6); rect(c, "#e8d8a8", 8, 7, 4, 4);
  for (let j = 0; j < 5; j++) rect(c, j === 4 ? "#b89758" : "#f3e3b0", 10 - j * 2, 2 + j, j * 4 + 1, 1);
}

export function drawProp(c: Ctx, p: PropPlacement): void {
```

**lib/game/maps/props.ts — edit 4 of 4.** Replace:

```ts
    case "records": return drawRecords(c);
  }
```

with:

```ts
    case "records": return drawRecords(c);
    case "namepost": return drawNamePost(c);
    case "coop_front": return drawCoopFront(c);
    case "farmshop_front": return drawFarmShopFront(c);
    case "ricedepot_front": return drawRiceDepotFront(c);
    case "pump": return drawPump(c);
    case "haystack": return drawHaystack(c);
    case "scarecrow": return drawScarecrow(c);
  }
```

- [ ] **Step 5: Write the field layout and its painter**

Create `lib/game/maps/field.ts`:

```ts
import { ANH_HAI_LOOK, CHU_TAM_LOOK, CO_UT_LOOK } from "@/lib/game/look";
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
import type { GameMap, Interactable, Npc, PlotGeom, PropPlacement, Rect } from "./types";

// "Đồng ruộng": the room's rice field (spec §6.2). Pure layout + collision; the painter is field-art.ts.

export const FIELD_W = 800;
export const FIELD_H = 480;
export const FIELD_CELL = 8;

/** Mương: the canal across the map (water, blocked) and its two plank bridges (walkable over it). */
export const CANAL: Rect = { x: 56, y: 176, w: 708, h: 32 };
export const BRIDGES: Rect[] = [{ x: 196, y: 170, w: 32, h: 44 }, { x: 548, y: 170, w: 32, h: 44 }];

const PLOT_W = 128;
const PLOT_XS = [72, 224, 376, 528];
const PRIVATE_Y = 52;
const PRIVATE_H = 96;
const VILLAGE_YS = [228, 328];
const VILLAGE_H = 76;

/** Plots 1–4 (đất tư) in a row north of the canal; 5–10 (đất làng) in two rows of three south of it. Their
 *  interiors are walkable. The name post stands on the dike at a corner. */
export const FIELD_PLOTS: PlotGeom[] = [
  ...PLOT_XS.map((x, i): PlotGeom => ({
    no: i + 1, kind: "private", rect: { x, y: PRIVATE_Y, w: PLOT_W, h: PRIVATE_H }, post: { x: x + 10, y: PRIVATE_Y + PRIVATE_H + 10 },
  })),
  ...VILLAGE_YS.flatMap((y, row) => PLOT_XS.slice(0, 3).map((x, i): PlotGeom => ({
    no: 5 + row * 3 + i, kind: "village", rect: { x, y, w: PLOT_W, h: VILLAGE_H }, post: { x: x + 10, y: y - 4 },
  }))),
];

/** Hợp tác xã (chú Tám), Tiệm vật tư nông nghiệp (anh Hai), Vựa lúa (cô Út) and the pump house (decoration). */
export const COOP: Rect = { x: 680, y: 44, w: 112, h: 92 };
export const FARM_SHOP: Rect = { x: 584, y: 268, w: 92, h: 60 };
export const RICE_DEPOT: Rect = { x: 696, y: 268, w: 96, h: 60 };
export const PUMP_HOUSE: Rect = { x: 36, y: 164, w: 32, h: 48 };

/** Sân phơi: four concrete drying squares (walkable). */
export const DRYING_YARD: Rect = { x: 564, y: 384, w: 224, h: 72 };
export const DRYING_SQUARES: Rect[] = [0, 1, 2, 3].map((i) => ({ x: 572 + i * 54, y: 392, w: 46, h: 56 }));

export const FIELD_SOLIDS: Rect[] = [
  { x: 0, y: 0, w: 800, h: 40 },      // bamboo and coconut palms along the north edge
  COOP, FARM_SHOP, RICE_DEPOT, PUMP_HOUSE,
  { x: 34, y: 94, w: 14, h: 10 },     // "Về sảnh" sign post
  { x: 778, y: 230, w: 12, h: 10 },   // "Về ao cá" sign post
  { x: 12, y: 296, w: 12, h: 8 },     // palm trunk W
  { x: 514, y: 466, w: 12, h: 8 },    // palm trunk S
  { x: 542, y: 346, w: 12, h: 8 },    // banana plant
  { x: 528, y: 424, w: 24, h: 10 },   // haystack
];

function plotUse(g: PlotGeom): Interactable {
  const north = g.kind === "private";
  return {
    id: `plot_${g.no}`, kind: "plot", label: `Thửa ${g.no}`, prompt: `Xem thửa ${g.no}`, rect: g.rect, plot: g.no,
    use: { x: g.rect.x + PLOT_W / 2, y: north ? g.rect.y + g.rect.h + 16 : g.rect.y - 10 },
    face: north ? "up" : "down",
  };
}

export const FIELD_INTERACTABLES: Interactable[] = [
  {
    id: "field_to_hall", kind: "portal", label: "Về sảnh", prompt: "Về sảnh nhạc", rect: { x: 31, y: 78, w: 18, h: 26 },
    use: { x: FIELD_WEST_ARRIVE.x, y: FIELD_WEST_ARRIVE.y }, to: { map: "hall", arrive: HALL_FIELD_ARRIVE },
  },
  {
    id: "field_to_pond", kind: "portal", label: "Về ao cá", prompt: "Qua cầu khỉ về ao cá", rect: { x: 775, y: 214, w: 18, h: 26 },
    use: { x: FIELD_EAST_ARRIVE.x, y: FIELD_EAST_ARRIVE.y }, to: { map: "pond", arrive: POND_FIELD_ARRIVE },
  },
  { id: "coop", kind: "coop", label: "Hợp tác xã", prompt: "Hợp tác xã · chú Tám", rect: { x: 688, y: 96, w: 96, h: 40 }, use: { x: 736, y: 152 } },
  { id: "farm_shop", kind: "farm_shop", label: "Tiệm vật tư nông nghiệp", prompt: "Tiệm vật tư · anh Hai", rect: { x: 588, y: 288, w: 84, h: 40 }, use: { x: 630, y: 344 } },
  { id: "rice_depot", kind: "rice_depot", label: "Vựa lúa", prompt: "Vựa lúa · cô Út", rect: { x: 700, y: 288, w: 88, h: 40 }, use: { x: 744, y: 344 } },
  { id: "drying", kind: "drying", label: "Sân phơi", prompt: "Sân phơi lúa", rect: DRYING_YARD, use: { x: 676, y: 372 } },
  ...FIELD_PLOTS.map(plotUse),
];

/** The three keepers stand behind their counters (inside blocked cells), facing the customers. */
export const FIELD_NPCS: Npc[] = [
  { id: "chu_tam", name: "chú Tám", look: CHU_TAM_LOOK, spot: { x: 736, y: 128, dir: "down" } },
  { id: "anh_hai", name: "anh Hai", look: ANH_HAI_LOOK, spot: { x: 630, y: 320, dir: "down" } },
  { id: "co_ut", name: "cô Út", look: CO_UT_LOOK, spot: { x: 744, y: 320, dir: "down" } },
];

export const FIELD_PROPS: PropPlacement[] = [
  { kind: "sign", x: 41, y: 104, icon: "note" },
  { kind: "sign", x: 784, y: 240, icon: "fish" },
  { kind: "coop_front", x: 736, y: 136 },
  { kind: "farmshop_front", x: 630, y: 328 },
  { kind: "ricedepot_front", x: 744, y: 328 },
  { kind: "pump", x: 52, y: 212 },
  { kind: "palm", x: 18, y: 302, h: 66, lean: 0.3, seed: 21 },
  { kind: "palm", x: 520, y: 472, h: 60, lean: -0.35, seed: 23 },
  { kind: "banana", x: 548, y: 354 },
  { kind: "haystack", x: 540, y: 434 },
  { kind: "scarecrow", x: 212, y: 318 },
  ...FIELD_PLOTS.map((g): PropPlacement => ({ kind: "namepost", x: g.post.x, y: g.post.y })),
];

export function buildFieldMap(): GameMap {
  const cols = FIELD_W / FIELD_CELL, rows = FIELD_H / FIELD_CELL;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cell = { x: c * FIELD_CELL, y: r * FIELD_CELL, w: FIELD_CELL, h: FIELD_CELL };
    const water = overlaps(CANAL, cell) && !BRIDGES.some((b) => overlaps(b, cell));
    blocked[r * cols + c] = water || FIELD_SOLIDS.some((s) => overlaps(s, cell)) ? 1 : 0;
  }
  return {
    id: "field", width: FIELD_W, height: FIELD_H, cell: FIELD_CELL, cols, rows, blocked,
    spawn: FIELD_WEST_ARRIVE, seating: null, interactables: FIELD_INTERACTABLES, props: FIELD_PROPS, npcs: FIELD_NPCS,
    plots: FIELD_PLOTS,
  };
}
```

Create `lib/game/maps/field-art.ts`:

```ts
import { BRIDGES, CANAL, COOP, DRYING_SQUARES, DRYING_YARD, FARM_SHOP, FIELD_H, FIELD_PLOTS, FIELD_W, RICE_DEPOT } from "./field";
import { propSprite } from "./props";
import { C, ctx2d, hexToRgb, makeCanvas, px, rect, rng, type Ctx, type SceneArt } from "./scene-art";
import type { GameMap, Rect } from "./types";

// Procedural painters for the field ("Đồng ruộng"). Browser only (canvas). Props live in props.ts, the layout in
// field.ts; the rice on each plot is drawn by the engine from field_state (art/crops.ts) — here the plots are bare
// stubble. Original art in the approved Miền Tây style — no copied images.

/** Field-only colours (the shared ones are in scene-art.ts). */
const F = {
  soil: "#8a6a3f", soilDark: "#735632", stubble: "#d8c07a", stubbleDark: "#b89a58",
  dike: "#86b04e", dikeDark: "#6f9a3c", dikeEdge: "#5a7f30",
  concrete: "#c9c5b8", concreteDark: "#aaa698", concreteLight: "#dedacd",
  plaster: "#efe4c8", plasterDark: "#d8c9a4", tile: "#b5463a", tileDark: "#8e3a30", tileLight: "#cf6a52",
  tin: "#8fa3ad", tinDark: "#71858f", tinLight: "#b3c4cc", awningA: "#3f7f2e", awningB: "#f4f1ea",
  plank: "#b88a52", plankDark: "#8b5a33",
};

const inRect = (x: number, y: number, r: Rect) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
const inPlot = (x: number, y: number) => FIELD_PLOTS.some((p) => inRect(x, y, p.rect));
/** The farmed area: plots and the dikes between them (west of the buildings, north of the south road). */
const inFarm = (x: number, y: number) => x >= 64 && x < 516 ? y >= 40 && y < 412 : x >= 516 && x < 664 && y >= 40 && y < 176;

function onRoad(x: number, y: number): boolean {
  const wob = Math.sin(y * 0.13) * 1.5 + Math.sin(x * 0.21);
  if (x < 60 + wob) return true;                                  // Đường làng along the west edge
  if (y > 416 + wob && x < 560) return true;                      // the south road
  if (x >= 512 + wob && x < 586 && y >= 208) return true;         // the lane south from the east bridge
  if (y >= 212 + wob && y < 262 && x >= 586) return true;         // east to Cầu khỉ
  if (y >= 330 && y < 388 && x >= 586) return true;               // in front of the shop and the depot
  return x >= 660 && y >= 136 + wob && y < 176;                   // in front of the Hợp tác xã
}

// ---------------------------------------------------------------- ground

function paintGround(c: Ctx): void {
  const R = rng(31);
  const img = c.createImageData(FIELD_W, FIELD_H);
  const d = img.data;
  const pal = {
    water: hexToRgb(C.water), waterDeep: hexToRgb(C.waterDeep), waterLight: hexToRgb(C.waterLight),
    mud: hexToRgb(C.mud), bank: hexToRgb(C.bank),
    soil: hexToRgb(F.soil), soilDark: hexToRgb(F.soilDark), stubble: hexToRgb(F.stubble), stubbleDark: hexToRgb(F.stubbleDark),
    dike: hexToRgb(F.dike), dikeDark: hexToRgb(F.dikeDark), dikeEdge: hexToRgb(F.dikeEdge),
    dirt: hexToRgb(C.dirt), dirtDark: hexToRgb(C.dirtDark), dirtLight: hexToRgb(C.dirtLight),
    concrete: hexToRgb(F.concrete), concreteDark: hexToRgb(F.concreteDark),
    grass: hexToRgb(C.grass), grassLight: hexToRgb(C.grassLight), grassDark: hexToRgb(C.grassDark),
  };
  for (let y = 0; y < FIELD_H; y++) for (let x = 0; x < FIELD_W; x++) {
    const r = R();
    let col: [number, number, number];
    if (inRect(x, y, CANAL) && !BRIDGES.some((b) => inRect(x, y, b))) {
      const edge = Math.min(y - CANAL.y, CANAL.y + CANAL.h - 1 - y);
      col = edge === 0 ? pal.mud : edge === 1 ? pal.bank : r < 0.04 ? pal.waterLight : edge > 8 ? pal.waterDeep : pal.water;
    } else if (inPlot(x, y)) {
      const p = FIELD_PLOTS.find((q) => inRect(x, y, q.rect))!.rect;
      const border = x === p.x || y === p.y || x === p.x + p.w - 1 || y === p.y + p.h - 1;
      const row = (y - p.y) % 6;
      col = border ? pal.dikeEdge : row === 3 && (x - p.x) % 3 !== 0 ? (r < 0.5 ? pal.stubble : pal.stubbleDark) : r < 0.15 ? pal.soilDark : pal.soil;
    } else if (inRect(x, y, DRYING_YARD)) col = r < 0.12 ? pal.concreteDark : pal.concrete;
    else if (onRoad(x, y)) col = r < 0.12 ? pal.dirtDark : r < 0.2 ? pal.dirtLight : pal.dirt;
    else if (inFarm(x, y)) col = r < 0.12 ? pal.dikeDark : pal.dike;
    else col = r < 0.1 ? pal.grassLight : r < 0.17 ? pal.grassDark : pal.grass;
    const i = (y * FIELD_W + x) * 4;
    d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  // grass tufts and flowers off the plots, roads and water
  for (let i = 0; i < 700; i++) {
    const x = Math.floor(R() * FIELD_W), y = 42 + Math.floor(R() * (FIELD_H - 42));
    if (inPlot(x, y) || onRoad(x, y) || inRect(x, y, CANAL) || inRect(x, y, DRYING_YARD)) continue;
    px(c, C.grassDeep, x, y); px(c, C.grassDeep, x - 1, y - 1); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x, y - 1);
    if (R() < 0.12) px(c, R() < 0.5 ? "#f6c945" : "#f4f1ea", x + 2, y - 2);
  }
}

function paintBamboo(c: Ctx): void {
  const R = rng(37);
  for (let x = 0; x < FIELD_W; x++) {
    const edge = 40 + Math.round(3 * Math.sin(x * 0.29) + 2 * Math.sin(x * 0.83));
    for (let y = 0; y < edge; y++) px(c, y > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let y = 0; y < 40; y++) for (let x = 0; x < FIELD_W; x++) if (R() < 0.08) px(c, "#44792a", x, y);
  for (let i = 0; i < 190; i++) {
    const x = 2 + i * 4 + Math.floor(R() * 2), top = Math.floor(R() * 8), bot = 32 + Math.floor(R() * 8);
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

function paintBridges(c: Ctx): void {
  for (const b of BRIDGES) {
    rect(c, C.outline, b.x - 1, b.y + 4, b.w + 2, b.h - 8);
    for (let y = b.y + 5; y < b.y + b.h - 5; y += 4) { rect(c, F.plank, b.x, y, b.w, 3); rect(c, F.plankDark, b.x, y + 3, b.w, 1); }
    rect(c, C.woodDeep, b.x + 1, b.y + 4, 2, b.h - 8); rect(c, C.woodDeep, b.x + b.w - 3, b.y + 4, 2, b.h - 8);
  }
  // Cầu khỉ: a bamboo pole with a handrail leading off the east edge
  for (let x = 788; x < FIELD_W; x++) {
    px(c, C.bamboo, x, 250); px(c, C.bambooDark, x, 251); px(c, C.bambooNode, x, 242);
    if (x % 4 === 0) rect(c, C.bambooDark, x, 242, 1, 9);
  }
}

function paintDryingYard(c: Ctx): void {
  const DIGITS: Record<number, readonly string[]> = {
    1: [".#.", "##.", ".#.", ".#.", "###"], 2: ["##.", "..#", ".#.", "#..", "###"],
    3: ["##.", "..#", ".#.", "..#", "##."], 4: ["#.#", "#.#", "###", "..#", "..#"],
  };
  rect(c, F.concreteDark, DRYING_YARD.x, DRYING_YARD.y, DRYING_YARD.w, 1);
  DRYING_SQUARES.forEach((s, i) => {
    rect(c, F.concreteDark, s.x, s.y, s.w, s.h);
    rect(c, F.concreteLight, s.x + 1, s.y + 1, s.w - 2, s.h - 2);
    DIGITS[i + 1].forEach((row, j) => {
      for (let k = 0; k < 3; k++) if (row.charAt(k) === "#") px(c, F.concreteDark, s.x + 3 + k, s.y + 3 + j);
    });
  });
}

function paintBuildings(c: Ctx): void {
  // Hợp tác xã: plastered walls with two shuttered windows (the front wall is the coop_front prop)
  rect(c, C.outline, COOP.x, COOP.y + 16, COOP.w, COOP.h - 16);
  rect(c, F.plaster, COOP.x + 1, COOP.y + 17, COOP.w - 2, COOP.h - 18);
  rect(c, F.plasterDark, COOP.x + 1, COOP.y + 17, COOP.w - 2, 2);
  for (const wx of [COOP.x + 14, COOP.x + 76]) {
    rect(c, C.outline, wx, COOP.y + 30, 20, 16); rect(c, "#3f7f7a", wx + 1, COOP.y + 31, 18, 14);
    rect(c, "#2f5f5a", wx + 10, COOP.y + 31, 1, 14);
  }
  // Tiệm vật tư: a green-painted back wall with shelves of sacks
  rect(c, C.outline, FARM_SHOP.x, FARM_SHOP.y, FARM_SHOP.w, 36);
  rect(c, "#9ab86a", FARM_SHOP.x + 1, FARM_SHOP.y + 1, FARM_SHOP.w - 2, 34);
  for (let y = FARM_SHOP.y + 10; y < FARM_SHOP.y + 34; y += 12) {
    rect(c, C.woodDark, FARM_SHOP.x + 6, y, FARM_SHOP.w - 12, 2);
    for (let x = FARM_SHOP.x + 8; x < FARM_SHOP.x + FARM_SHOP.w - 12; x += 9) rect(c, x % 2 ? C.paper : "#e8dcc0", x, y - 7, 7, 7);
  }
  // Vựa lúa: plank walls and a big door
  rect(c, C.outline, RICE_DEPOT.x, RICE_DEPOT.y, RICE_DEPOT.w, 36);
  for (let x = RICE_DEPOT.x + 1; x < RICE_DEPOT.x + RICE_DEPOT.w - 1; x += 4) {
    rect(c, F.plank, x, RICE_DEPOT.y + 1, 3, 34); rect(c, F.plankDark, x + 3, RICE_DEPOT.y + 1, 1, 34);
  }
  rect(c, C.outline, RICE_DEPOT.x + 58, RICE_DEPOT.y + 6, 28, 30); rect(c, C.woodDark, RICE_DEPOT.x + 59, RICE_DEPOT.y + 7, 26, 29);
  rect(c, C.woodDeep, RICE_DEPOT.x + 71, RICE_DEPOT.y + 7, 1, 29);
}

// ---------------------------------------------------------------- public

export function paintField(map: GameMap): SceneArt {
  const background = makeCanvas(FIELD_W, FIELD_H);
  const g = ctx2d(background);
  paintGround(g);
  paintBridges(g);
  paintDryingYard(g);
  paintBuildings(g);
  paintBamboo(g);
  const props = map.props.map(propSprite);

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    if (reducedMotion) return;
    for (let i = 0; i < 70; i++) {
      const sx = CANAL.x + 4 + ((i * 67 + Math.floor(t / 70)) % (CANAL.w - 8));
      const sy = CANAL.y + 5 + ((i * 13) % (CANAL.h - 10));
      if (BRIDGES.some((b) => inRect(sx, sy, b))) continue;
      px(c, C.sparkle, sx - camX, sy - camY);
      px(c, C.sparkle2, sx + 1 - camX, sy - camY);
    }
  };

  const drawOverhead = (c: Ctx, _t: number, camX: number, camY: number) => {
    // the Hợp tác xã's tiled roof
    const rx = COOP.x - 6 - camX, ry = COOP.y - 12 - camY;
    for (let j = 0; j < 30; j++) {
      const inset = Math.max(0, 14 - j);
      rect(c, j === 29 ? C.outline : j % 4 === 3 ? F.tileDark : j % 4 === 0 ? F.tileLight : F.tile, rx + inset, ry + j, COOP.w + 12 - inset * 2, 1);
    }
    rect(c, C.outline, rx + 14, ry, COOP.w - 16, 1);
    // the farm shop's awning: green and white stripes with a scalloped edge
    const ax = FARM_SHOP.x - 6 - camX, ay = FARM_SHOP.y - 14 - camY;
    rect(c, C.outline, ax, ay, FARM_SHOP.w + 12, 18);
    for (let x = 0; x < FARM_SHOP.w + 10; x += 6) rect(c, (x / 6) % 2 === 0 ? F.awningA : F.awningB, ax + 1 + x, ay + 1, 6, 15);
    for (let x = 0; x < FARM_SHOP.w + 10; x += 6) rect(c, (x / 6) % 2 === 0 ? F.awningA : F.awningB, ax + 2 + x, ay + 16, 4, 2);
    // the rice depot's tin roof
    const tx = RICE_DEPOT.x - 6 - camX, ty = RICE_DEPOT.y - 18 - camY;
    for (let j = 0; j < 20; j++) {
      rect(c, j === 19 ? C.outline : j % 2 ? F.tinDark : F.tin, tx, ty + j, RICE_DEPOT.w + 12, 1);
    }
    for (let x = 0; x < RICE_DEPOT.w + 12; x += 5) rect(c, F.tinLight, tx + x, ty, 1, 19);
  };

  return { background, props, edge: C.grassDark, drawAnimated, drawOverhead };
}
```

- [ ] **Step 6: Register the field; presence and the map chip know it**

**lib/game/maps/registry.ts — edit 1 of 4.** Replace:

```ts
import { buildHallMap } from "./hall";
```

with:

```ts
import { buildFieldMap } from "./field";
import { paintField } from "./field-art";
import { buildHallMap } from "./hall";
```

**lib/game/maps/registry.ts — edit 2 of 4.** Replace:

```ts

/** The map with this id (pure; cached). */
```

with:

```ts

function build(id: MapId): GameMap {
  switch (id) {
    case "hall": return buildHallMap();
    case "pond": return buildPondMap();
    case "field": return buildFieldMap();
  }
}

function paint(map: GameMap): SceneArt {
  switch (map.id) {
    case "hall": return paintHall(map);
    case "pond": return paintPond(map);
    case "field": return paintField(map);
  }
}

/** The map with this id (pure; cached). */
```

**lib/game/maps/registry.ts — edit 3 of 4.** Replace:

```ts
  if (!m) {
    m = id === "pond" ? buildPondMap() : buildHallMap();
    maps.set(id, m);
```

with:

```ts
  if (!m) {
    m = build(id);
    maps.set(id, m);
```

**lib/game/maps/registry.ts — edit 4 of 4.** Replace:

```ts
  if (!a) {
    a = map.id === "pond" ? paintPond(map) : paintHall(map);
    arts.set(map.id, a);
```

with:

```ts
  if (!a) {
    a = paint(map);
    arts.set(map.id, a);
```

**lib/presence-modes.ts — edit 1 of 3.** Replace:

```ts

/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode; its map comes from the game tab that tracked
 *  last (an old client without a map is in the hall). Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
```

with:

```ts

/** Every map id (a new one is a type error until it is listed). */
const KNOWN_MAPS: Record<MapId, true> = { hall: true, pond: true, field: true };

/** A presence `map` value; anything unknown (an old client) is the hall. */
export function presenceMap(v: unknown): MapId {
  return typeof v === "string" && Object.hasOwn(KNOWN_MAPS, v) ? (v as MapId) : "hall";
}

/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode; its map comes from the game tab that tracked
 *  last (an old client without a map, or with one it does not know, is in the hall). Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
```

**lib/presence-modes.ts — edit 2 of 3.** Replace:

```ts
    const latest = games.reduce((a, b) => (onlineAt(b) > onlineAt(a) ? b : a));
    out.push({ accountId, name, mode: "game", map: latest.map === "pond" ? "pond" : "hall" });
  }
```

with:

```ts
    const latest = games.reduce((a, b) => (onlineAt(b) > onlineAt(a) ? b : a));
    out.push({ accountId, name, mode: "game", map: presenceMap(latest.map) });
  }
```

**lib/presence-modes.ts — edit 3 of 3.** Replace:

```ts
export function mapCounts(presence: readonly PresenceEntry[]): Record<MapId, MapMember[]> {
  const out: Record<MapId, MapMember[]> = { hall: [], pond: [] };
  for (const p of presence) {
```

with:

```ts
export function mapCounts(presence: readonly PresenceEntry[]): Record<MapId, MapMember[]> {
  const out: Record<MapId, MapMember[]> = { hall: [], pond: [], field: [] };
  for (const p of presence) {
```

**components/game/MapCounts.tsx.** Replace:

```tsx
import type { MapMember } from "@/lib/presence-modes";
import type { MapId } from "@/lib/game/maps/types";

const MAPS: Array<{ id: MapId; icon: string; name: string }> = [
  { id: "hall", icon: "🎵", name: "Sảnh" },
  { id: "pond", icon: "🎣", name: "Ao cá" },
];
```

with:

```tsx
import type { MapMember } from "@/lib/presence-modes";
import { MAP_IDS, type MapId } from "@/lib/game/maps/types";

const LABEL: Record<MapId, { icon: string; name: string }> = {
  hall: { icon: "🎵", name: "Sảnh" },
  pond: { icon: "🎣", name: "Ao cá" },
  field: { icon: "🌾", name: "Đồng" },
};
const MAPS = MAP_IDS.map((id) => ({ id, ...LABEL[id] }));
```

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/unit/game-field-map.test.ts tests/unit/presence-mode.test.ts tests/unit/game-hud-travel.test.tsx tests/unit/game-maps-registry.test.ts tests/unit/game-hall-map.test.ts tests/unit/game-pond-map.test.ts tests/unit/game-art.test.ts`
Expected: PASS — the field's use spots are walkable and reachable from both entrances, plots stay off every solid, the camera scrolls 800 × 480 on desktop and phone views.

- [ ] **Step 8: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/maps lib/game/look.ts lib/presence-modes.ts components/game/MapCounts.tsx tests/unit/game-field-map.test.ts tests/unit/presence-mode.test.ts tests/unit/game-hud-travel.test.tsx tests/unit/helpers/ascii-map.ts` (clean).

```bash
git add lib/game/maps lib/game/look.ts lib/presence-modes.ts components/game/MapCounts.tsx tests/unit/game-field-map.test.ts tests/unit/presence-mode.test.ts tests/unit/game-hud-travel.test.tsx tests/unit/helpers/ascii-map.ts
git commit -m "feat(v15): the field map, its painter and props, presence field

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Portals to the field — "Ra đồng" in the hall, "Cầu khỉ ra đồng" at the pond

**Files:**
- Modify: `lib/game/maps/hall.ts` (sign, solid, `field_sign` portal), `lib/game/maps/pond.ts` (sign, solid, `field_bridge` portal)
- Modify: `components/game/GameShell.tsx` (member card "🌾 Đang ở đồng ruộng"; green background off the hall)
- Test: `tests/unit/game-hall-map.test.ts`, `tests/unit/game-pond-map.test.ts`, `tests/unit/game-maps-registry.test.ts` (extend)

**Interfaces:**
- Consumes: Task 8's arrivals and field interactables.
- Produces: hall interactable `field_sign` (portal, prompt "Ra đồng ruộng", use `HALL_FIELD_ARRIVE`, to the field at `FIELD_WEST_ARRIVE`); pond interactable `field_bridge` (portal, prompt "Qua cầu khỉ ra đồng", use `POND_FIELD_ARRIVE`, to the field at `FIELD_EAST_ARRIVE`). Every portal pair arrives at the way back.

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-hall-map.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildHallMap, HALL_CELL, HALL_H, HALL_W } from "@/lib/game/maps/hall";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { FIELD_WEST_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildHallMap, HALL_CELL, HALL_H, HALL_W } from "@/lib/game/maps/hall";
```

**tests/unit/game-hall-map.test.ts — edit 2 of 2.** Replace:

```ts
  });
  it("has unique interactables with the three v13 ids", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual(["dj_booth", "dock_sign", "notice_board"]);
  });
```

with:

```ts
  });
  it("has unique interactables: the three v13 ones and the v15 field sign", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual(["dj_booth", "dock_sign", "field_sign", "notice_board"]);
  });
  it("makes the field sign a portal to the field's west entrance", () => {
    const sign = hall.interactables.find((i) => i.id === "field_sign")!;
    expect(sign).toMatchObject({ kind: "portal", prompt: "Ra đồng ruộng", to: { map: "field", arrive: FIELD_WEST_ARRIVE } });
  });
```

**tests/unit/game-pond-map.test.ts — edit 1 of 4.** Replace:

```ts
import { bobberPoint } from "@/lib/game/fishing/geometry";
import { HALL_DOCK_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildPondMap, DIG_MOUNDS, inDirtPatch, inPond, onPlatform, pondEdge } from "@/lib/game/maps/pond";
```

with:

```ts
import { bobberPoint } from "@/lib/game/fishing/geometry";
import { FIELD_EAST_ARRIVE, HALL_DOCK_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildPondMap, DIG_MOUNDS, inDirtPatch, inPond, onPlatform, pondEdge } from "@/lib/game/maps/pond";
```

**tests/unit/game-pond-map.test.ts — edit 2 of 4.** Replace:

```ts
    expect(pond.interactables.map((i) => i.id).sort()).toEqual([
      "depot", "dig_1", "dig_2", "dig_3", "dig_4", "fish_1", "fish_2", "fish_3", "fish_4", "fish_5", "fish_6",
      "pond_exit", "records", "shop",
```

with:

```ts
    expect(pond.interactables.map((i) => i.id).sort()).toEqual([
      "depot", "dig_1", "dig_2", "dig_3", "dig_4", "field_bridge", "fish_1", "fish_2", "fish_3", "fish_4", "fish_5", "fish_6",
      "pond_exit", "records", "shop",
```

**tests/unit/game-pond-map.test.ts — edit 3 of 4.** Replace:

```ts
    expect(prompt("records")).toBe("Xem bảng kỷ lục");
  });
```

with:

```ts
    expect(prompt("records")).toBe("Xem bảng kỷ lục");
    expect(prompt("field_bridge")).toBe("Qua cầu khỉ ra đồng");
  });
```

**tests/unit/game-pond-map.test.ts — edit 4 of 4.** Replace:

```ts
  });
  it("leads back to the hall's dock", () => {
    expect(ofKind("portal")).toEqual([expect.objectContaining({ id: "pond_exit", to: { map: "hall", arrive: HALL_DOCK_ARRIVE } })]);
  });
```

with:

```ts
  });
  it("leads back to the hall's dock and over the monkey bridge to the field", () => {
    expect(ofKind("portal")).toEqual([
      expect.objectContaining({ id: "pond_exit", to: { map: "hall", arrive: HALL_DOCK_ARRIVE } }),
      expect.objectContaining({ id: "field_bridge", to: { map: "field", arrive: FIELD_EAST_ARRIVE } }),
    ]);
  });
```

**tests/unit/game-maps-registry.test.ts.** Replace:

```ts
    expect(Math.hypot(dock.to!.arrive.x - exit.use.x, dock.to!.arrive.y - exit.use.y)).toBeGreaterThan(PROMPT_RANGE);
  });
});
```

with:

```ts
    expect(Math.hypot(dock.to!.arrive.x - exit.use.x, dock.to!.arrive.y - exit.use.y)).toBeGreaterThan(PROMPT_RANGE);
  });
  it("links the field both ways with the hall and the pond, arriving at the way back", () => {
    const find = (map: "hall" | "pond" | "field", id: string) => getMap(map).interactables.find((i) => i.id === id)!;
    const pairs: Array<[ReturnType<typeof find>, ReturnType<typeof find>]> = [
      [find("hall", "field_sign"), find("field", "field_to_hall")],
      [find("pond", "field_bridge"), find("field", "field_to_pond")],
    ];
    for (const [there, back] of pairs) {
      expect(there.to!.map).toBe("field");
      expect(back.to!.arrive).toMatchObject(there.use);
      expect(there.to!.arrive).toMatchObject(back.use);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/game-hall-map.test.ts tests/unit/game-pond-map.test.ts tests/unit/game-maps-registry.test.ts`
Expected: FAIL — no `field_sign` / `field_bridge`.

- [ ] **Step 3: Add the signs and portals**

**lib/game/maps/hall.ts — edit 1 of 4.** Replace:

```ts
import { POND_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
```

with:

```ts
import { FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
```

**lib/game/maps/hall.ts — edit 2 of 4.** Replace:

```ts
  { x: 484, y: 314, w: 14, h: 10 },   // dock sign
  { x: 204, y: 138, w: 12, h: 8 },    // banana plant west of the stage
```

with:

```ts
  { x: 484, y: 314, w: 14, h: 10 },   // dock sign
  { x: 34, y: 222, w: 14, h: 10 },    // "Ra đồng" sign
  { x: 204, y: 138, w: 12, h: 8 },    // banana plant west of the stage
```

**lib/game/maps/hall.ts — edit 3 of 4.** Replace:

```ts
    use: { x: 516, y: 334 }, to: { map: "pond", arrive: POND_ARRIVE },
  },
```

with:

```ts
    use: { x: 516, y: 334 }, to: { map: "pond", arrive: POND_ARRIVE },
  },
  {
    id: "field_sign", kind: "portal", label: "Ra đồng", prompt: "Ra đồng ruộng", rect: { x: 31, y: 206, w: 18, h: 26 },
    use: { x: HALL_FIELD_ARRIVE.x, y: HALL_FIELD_ARRIVE.y }, to: { map: "field", arrive: FIELD_WEST_ARRIVE },
  },
```

**lib/game/maps/hall.ts — edit 4 of 4.** Replace:

```ts
  { kind: "sign", x: 491, y: 324 },
  { kind: "banana", x: 210, y: 146 },
```

with:

```ts
  { kind: "sign", x: 491, y: 324 },
  { kind: "sign", x: 40, y: 232, icon: "rice" },
  { kind: "banana", x: 210, y: 146 },
```

**lib/game/maps/pond.ts — edit 1 of 4.** Replace:

```ts
import type { Vec } from "@/lib/game/types";
import { HALL_DOCK_ARRIVE, POND_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
```

with:

```ts
import type { Vec } from "@/lib/game/types";
import { FIELD_EAST_ARRIVE, HALL_DOCK_ARRIVE, POND_ARRIVE, POND_FIELD_ARRIVE } from "./arrivals";
import { overlaps } from "./rect";
```

**lib/game/maps/pond.ts — edit 2 of 4.** Replace:

```ts
  { x: 345, y: 350, w: 14, h: 10 },   // "Bến vào" sign post
  { x: 34, y: 94, w: 12, h: 8 },      // palm trunk NW
```

with:

```ts
  { x: 345, y: 350, w: 14, h: 10 },   // "Bến vào" sign post
  { x: 184, y: 370, w: 14, h: 10 },   // "Cầu khỉ ra đồng" sign post
  { x: 34, y: 94, w: 12, h: 8 },      // palm trunk NW
```

**lib/game/maps/pond.ts — edit 3 of 4.** Replace:

```ts
  },
  ...POND_FISH_SPOTS.map((s, i): Interactable => ({
```

with:

```ts
  },
  {
    id: "field_bridge", kind: "portal", label: "Cầu khỉ ra đồng", prompt: "Qua cầu khỉ ra đồng", rect: { x: 181, y: 354, w: 18, h: 26 },
    use: { x: POND_FIELD_ARRIVE.x, y: POND_FIELD_ARRIVE.y }, to: { map: "field", arrive: FIELD_EAST_ARRIVE },
  },
  ...POND_FISH_SPOTS.map((s, i): Interactable => ({
```

**lib/game/maps/pond.ts — edit 4 of 4.** Replace:

```ts
  { kind: "sign", x: 352, y: 360, icon: "note" },
];
```

with:

```ts
  { kind: "sign", x: 352, y: 360, icon: "note" },
  { kind: "sign", x: 190, y: 380, icon: "rice" },
];
```

- [ ] **Step 4: The shell names the field**

**components/game/GameShell.tsx.** Replace:

```tsx
  const cardWhere = cardPresence?.mode === "classic" ? "🖥️ Đang ở giao diện cũ"
    : cardPresence?.map === "pond" ? "🎣 Đang ở ao câu cá" : "🎮 Đang dạo quanh sảnh";

  return (
    <div className={`game-ui fixed inset-0 overflow-hidden text-ink ${map.id === "pond" ? "bg-[#5a8f32]" : "bg-[#2f6e8f]"}`}>
      <GameCanvas
```

with:

```tsx
  const cardWhere = cardPresence?.mode === "classic" ? "🖥️ Đang ở giao diện cũ"
    : cardPresence?.map === "pond" ? "🎣 Đang ở ao câu cá"
    : cardPresence?.map === "field" ? "🌾 Đang ở đồng ruộng" : "🎮 Đang dạo quanh sảnh";

  return (
    <div className={`game-ui fixed inset-0 overflow-hidden text-ink ${map.id === "hall" ? "bg-[#2f6e8f]" : "bg-[#5a8f32]"}`}>
      <GameCanvas
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/unit/game-hall-map.test.ts tests/unit/game-pond-map.test.ts tests/unit/game-maps-registry.test.ts tests/unit/game-field-map.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/maps components/game/GameShell.tsx tests/unit/game-hall-map.test.ts tests/unit/game-pond-map.test.ts tests/unit/game-maps-registry.test.ts` (clean).

```bash
git add lib/game/maps/hall.ts lib/game/maps/pond.ts components/game/GameShell.tsx tests/unit/game-hall-map.test.ts tests/unit/game-pond-map.test.ts tests/unit/game-maps-registry.test.ts
git commit -m "feat(v15): portals to the field from the hall and the pond

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Crop art and the plots on the canvas

**Files:**
- Create: `lib/game/art/crops.ts` (pure plot looks and labels; the browser painters)
- Modify: `lib/game/engine.ts` (`setPlots`; plots drawn between the background and the props; name-post labels in the overlays; urgent rings)
- Modify: `components/game/GameCanvas.tsx` (handle `setPlots`, replayed into every new engine)
- Test: `tests/unit/game-crop-art.test.ts` (new); `tests/unit/game-canvas-input.test.tsx` (extend)

**Interfaces:**
- Consumes: `CropView`, `PlotView`, `PestKind` (Task 4), the crop model (Task 5), `GameMap.plots` (Task 8), `scene-art` helpers.
- Produces (`@/lib/game/art/crops`): `CropStage` (`prepared`, `seedbed`, `transplanted`, `tillering`, `panicle`, `heading`, `ripening`, `ripe`, `overripe`), `PlotLook { stage, progress (0–1), water (0–3), pests (untreated), wobble, seed }`, `PlotDraw { no, look: PlotLook | null, label, urgent }`; pure `plotLook(no, crop, v, now)` (null while unprepared), `lookKey(look)`, `plotLabel(p)` ("3 · An", "5 · đất trống", "1 · đất bán"), `plotDraws(plots, varieties, urgent: ReadonlySet<number>, now)`; browser `paintPlot(look, w, h)`, `drawPlotShimmer(…)`, `drawUrgentRing(…)` (steady under reduced motion).
- Produces: `GameEngine.setPlots(plots: ReadonlyArray<PlotDraw>)`; `GameCanvasHandle.setPlots(plots)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-crop-art.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lookKey, plotDraws, plotLabel, plotLook } from "@/lib/game/art/crops";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import type { CropView, PlotView } from "@/lib/game/farm/state";

const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const short = varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 });

/** Nếp on plot 5: prepared and soaked at 0 h, sown at 3 h, transplanted at 12 h unless `over` says otherwise. */
const crop = (over: Partial<CropView> = {}): CropView => ({
  variety: "nep", phase: "tillering", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12), water: 2, waterSetAt: at(12),
  pests: [], excessN: false, ripe: false, rottedAt: null, log: null, ...over,
});
const plot = (over: Partial<PlotView> = {}): PlotView => ({
  no: 5, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});

describe("plotLook", () => {
  it("leaves unprepared plots to the background's stubble", () => {
    expect(plotLook(5, null, null, at(0))).toBeNull();
    // seed soaking at home before the plot is prepared
    expect(plotLook(5, crop({ preparedAt: null, sowAt: null, transplantAt: null }), nep, at(1))).toBeNull();
  });
  it("shows prepared mud until sowing, then a seedbed that grows until the seedlings are old", () => {
    const bed = crop({ transplantAt: null });
    expect(plotLook(5, crop({ sowAt: null, transplantAt: null }), nep, at(2))).toMatchObject({ stage: "prepared", progress: 0 });
    expect(plotLook(5, bed, nep, at(3))).toMatchObject({ stage: "seedbed", progress: 0 });
    expect(plotLook(5, bed, nep, at(10))).toMatchObject({ stage: "seedbed", progress: 0.5 });
    expect(plotLook(5, bed, nep, at(40))).toMatchObject({ stage: "seedbed", progress: 1 });
  });
  it("grows through the stages after transplanting, scaled by the variety", () => {
    const stage = (h: number, v = nep) => plotLook(5, crop(), v, at(12 + h))?.stage;
    expect([1, 4, 20, 33, 44, 50, 70].map((h) => stage(h))).toEqual(
      ["transplanted", "tillering", "panicle", "heading", "ripening", "ripe", "overripe"]);
    // short rice (s = 0.9) is ripe at 43.2 h, nếp only at 48 h
    expect(stage(44, short)).toBe("ripe");
    expect(plotLook(5, crop(), nep, at(12 + 44))).toMatchObject({ stage: "ripening", progress: 0.5 });
    expect(plotLook(5, crop(), nep, at(12 + 200))).toMatchObject({ stage: "overripe", progress: 1 });
  });
  it("draws the untreated pests only, and crooked rows after a poor transplant", () => {
    const pests = [
      { kind: "hopper" as const, since: at(20), treatedAt: null },
      { kind: "leaf_folder" as const, since: at(18), treatedAt: at(19) },
    ];
    expect(plotLook(5, crop({ pests }), nep, at(22))).toMatchObject({ pests: ["hopper"], wobble: false });
    const log = { water: [], fert: [], spray: [], picks: [], qTransplant: 0.95 };
    expect(plotLook(5, crop({ log }), nep, at(22))?.wobble).toBe(true);
  });
  it("reads the water from the farmer's log at any time, else the level fetched", () => {
    expect(plotLook(5, crop({ water: 3 }), nep, at(40))?.water).toBe(3);
    const log = { water: [{ t: at(12), l: 3 }], fert: [], spray: [], picks: [], qTransplant: 1 };
    // one level lost per 12 h: 3 at 12 h → 1 at 36 h
    expect(plotLook(5, crop({ water: 3, log }), nep, at(36))?.water).toBe(1);
  });
  it("keys the painted plot by stage, progress in fifths, water, pests and rows", () => {
    const key = (h: number) => lookKey(plotLook(5, crop(), nep, at(12 + h))!);
    expect(key(4)).toBe(key(5));
    expect(key(4)).not.toBe(key(10));
    expect(key(4)).toBe("tillering|0|2||0");
  });
});

describe("plot labels", () => {
  it("names the owner of a private plot and the farmer of a village plot", () => {
    expect(plotLabel(plot({ no: 2, kind: "private", owner: { id: "a", name: "An" }, farmer: { id: "b", name: "Bình" } }))).toBe("2 · An");
    expect(plotLabel(plot({ no: 3, kind: "private" }))).toBe("3 · đất bán");
    expect(plotLabel(plot({ farmer: { id: "b", name: "Bình" } }))).toBe("5 · Bình");
    expect(plotLabel(plot())).toBe("5 · đất trống");
  });
  it("gives the engine every plot with its look, label and my urgent ring", () => {
    const plots = [plot({ no: 5, crop: crop() }), plot({ no: 6 })];
    const draws = plotDraws(plots, [nep], new Set([5]), at(16));
    expect(draws.map((d) => [d.no, d.look?.stage ?? null, d.label, d.urgent])).toEqual([
      [5, "tillering", "5 · đất trống", true],
      [6, null, "6 · đất trống", false],
    ]);
  });
});
```

**tests/unit/game-canvas-input.test.tsx — edit 1 of 4.** Replace:

```tsx

// One fake engine per world: it records what the canvas tells it about the input lock.
const { engines } = vi.hoisted(() => ({
  engines: [] as Array<{ mapId: string; input: boolean[]; destroyed: boolean }>,
}));
```

with:

```tsx

// One fake engine per world: it records what the canvas tells it about the input lock and the plots.
const { engines } = vi.hoisted(() => ({
  engines: [] as Array<{ mapId: string; input: boolean[]; plots: unknown[]; destroyed: boolean }>,
}));
```

**tests/unit/game-canvas-input.test.tsx — edit 2 of 4.** Replace:

```tsx
  GameEngine: class {
    rec: { mapId: string; input: boolean[]; destroyed: boolean };
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], destroyed: false };
      engines.push(this.rec);
```

with:

```tsx
  GameEngine: class {
    rec: { mapId: string; input: boolean[]; plots: unknown[]; destroyed: boolean };
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], destroyed: false };
      engines.push(this.rec);
```

**tests/unit/game-canvas-input.test.tsx — edit 3 of 4.** Replace:

```tsx
      this.rec.input.push(enabled);
    }
```

with:

```tsx
      this.rec.input.push(enabled);
    }
    setPlots(plots: unknown) {
      this.rec.plots.push(plots);
    }
```

**tests/unit/game-canvas-input.test.tsx — edit 4 of 4.** Append at the end of the file, after a blank line:

```tsx
describe("GameCanvas plots across travel", () => {
  it("passes the plots on at once and gives them to the next map's engine", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="field" {...props} />);
    const plots = [{ no: 1, look: null, label: "1 · An", urgent: false }];
    ref.current!.setPlots(plots);
    expect(engines[0].plots.at(-1)).toBe(plots);
    rerender(<GameCanvas ref={ref} mapId="hall" {...props} />);
    rerender(<GameCanvas ref={ref} mapId="field" {...props} />);
    expect(engines[2].plots.at(-1)).toBe(plots);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/game-crop-art.test.ts tests/unit/game-canvas-input.test.tsx`
Expected: FAIL — `@/lib/game/art/crops` does not exist and the handle has no `setPlots`.

- [ ] **Step 3: Write the crop art**

Create `lib/game/art/crops.ts`:

```ts
import type { Variety } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, hrs, waterAt } from "@/lib/game/farm/crop";
import type { CropView, PestKind, PlotView } from "@/lib/game/farm/state";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx } from "@/lib/game/maps/scene-art";

// The rice on a plot (spec §13.4, §14): what to draw (pure) and its procedural painter (browser only: canvas) —
// the crop stage, the water by level and the pest overlays. Original art.

export type CropStage = "prepared" | "seedbed" | "transplanted" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe";

export interface PlotLook {
  stage: CropStage;
  /** How far through the stage, 0–1. */
  progress: number;
  /** 0 khô … 3 sâu. */
  water: number;
  /** The untreated pests. */
  pests: PestKind[];
  /** Crooked rows (a poor transplant, qT < 1). */
  wobble: boolean;
  seed: number;
}

/** What the engine draws on a plot: its look (null = the background's bare stubble), the name post's label and the
 *  farmer's urgent ring. */
export interface PlotDraw { no: number; look: PlotLook | null; label: string; urgent: boolean }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The look of a plot's crop at `now`; null while the plot is unprepared (no crop, or seed soaking before preparing). */
export function plotLook(no: number, crop: CropView | null, v: Variety | null, now: number): PlotLook | null {
  if (!crop || crop.preparedAt === null) return null;
  const c = cropModel(crop);
  const s = v?.scale ?? 1;
  const T = c.transplantAt === null ? 0 : hrs(c.transplantAt, now);
  let stage: CropStage;
  let progress = 0;
  switch (cropPhase(c, v, now)) {
    case "seedling": stage = "seedbed"; progress = c.sowAt === null ? 0 : hrs(c.sowAt, now) / (14 * s); break;
    case "tillering":
      if (T < 3 * s) { stage = "transplanted"; progress = T / (3 * s); } else { stage = "tillering"; progress = (T - 3 * s) / (15 * s); }
      break;
    case "panicle": stage = "panicle"; progress = (T - 18 * s) / (12 * s); break;
    case "heading": stage = "heading"; progress = (T - 30 * s) / (10 * s); break;
    case "ripening": stage = "ripening"; progress = (T - 40 * s) / (8 * s); break;
    case "ripe": stage = "ripe"; progress = (T - 48 * s) / 12; break;
    case "overripe": stage = "overripe"; progress = (T - 48 * s - 12) / 48; break;
    default: stage = "prepared";
  }
  return {
    stage, progress: clamp01(progress),
    // the farmer has the log (exact at any time); the others get the level at the last fetch
    water: crop.log ? waterAt(crop.log.water, now) : crop.water,
    pests: crop.pests.filter((p) => p.treatedAt === null).map((p) => p.kind),
    wobble: (crop.log?.qTransplant ?? 1) < 1, seed: no * 7919,
  };
}

/** The cache key of a look: progress in fifths is enough to see the rice grow. */
export function lookKey(l: PlotLook): string {
  return `${l.stage}|${Math.floor(l.progress * 5)}|${l.water}|${l.pests.join(",")}|${l.wobble ? 1 : 0}`;
}

/** The name post: the plot number and its owner (private) or farmer (village), else what it is. */
export function plotLabel(p: PlotView): string {
  const who = p.kind === "private" ? p.owner : p.farmer;
  return `${p.no} · ${who ? who.name : p.kind === "private" ? "đất bán" : "đất trống"}`;
}

/** Everything the engine draws on the plots at `now`; `urgent` = the plots with an urgent task of mine. */
export function plotDraws(plots: readonly PlotView[], varieties: readonly Variety[], urgent: ReadonlySet<number>, now: number): PlotDraw[] {
  return plots.map((p) => ({
    no: p.no,
    look: plotLook(p.no, p.crop, varieties.find((v) => v.id === p.crop?.variety) ?? null, now),
    label: plotLabel(p),
    urgent: urgent.has(p.no),
  }));
}

const K = {
  mudWet: "#6e5230", mud: "#8a6a3f", mudDry: "#a8875a", crack: "#7a5c38", sheen: "#9fc3cf", deep: "#5d93ad",
  seed1: "#8fdc62", seed2: "#6fbf4a", young: "#6fbf4a", youngDark: "#4f9a38", leaf: "#5caa4a", leafDark: "#3f7f2e",
  deepLeaf: "#3d8a3a", panicle: "#c9d88a", gold: "#e0b33c", goldLight: "#f6c945", goldDark: "#b8902a",
  egg: "#f29bb5", shell: "#8a5a2b", roll: "#f4f1ea", hopper: "#7a4a2a", blast: "#8e5a2a", dike: "#5a7f30",
};

const mix = (a: string, b: string, t: number): string => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
};

function paintSoil(c: Ctx, w: number, h: number, water: number, R: () => number): void {
  rect(c, water === 0 ? K.mudDry : water === 1 ? K.mud : K.mudWet, 0, 0, w, h);
  if (water === 1) {
    for (let i = 0; i < w * h * 0.04; i++) px(c, R() < 0.5 ? K.mudWet : K.crack, Math.floor(R() * w), Math.floor(R() * h));
  } else if (water === 0) {
    for (let i = 0; i < w * h * 0.02; i++) {
      const x = Math.floor(R() * w), y = Math.floor(R() * h);
      for (let k = 0; k < 4; k++) px(c, K.crack, x + k, y + (k % 2));
    }
  } else if (water >= 2) {
    // shallow: sheen lines; deep: the plot is water
    if (water === 3) rect(c, K.deep, 1, 1, w - 2, h - 2);
    for (let y = 3; y < h - 2; y += water === 3 ? 4 : 7) {
      for (let x = 2 + ((y * 5) % 9); x < w - 6; x += 11) rect(c, K.sheen, x, y, 4, 1);
    }
  }
}

/** A hill of rice standing at (x, y): 2·spread + 1 leaves fanning out, the middle one `hgt` px tall, all leaning by
 *  `lean` px at the top. */
function tuft(c: Ctx, x: number, y: number, hgt: number, spread: number, col: string, dark: string, lean: number): void {
  for (let s = -spread; s <= spread; s++) {
    const top = hgt - Math.abs(s);
    for (let k = 0; k < top; k++) {
      const dx = Math.round(s * 0.5 + ((lean + s * 0.9) * k) / Math.max(1, hgt));
      px(c, k < 2 || (s + k) % 4 === 0 ? dark : col, x + dx, y - k);
    }
  }
}

/** The transplanted hills in rows 8 px apart; returns where the panicles go ([x, y, kind]). */
function paintHills(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): Array<[number, number, number]> {
  const heads: Array<[number, number, number]> = [];
  const { stage, progress } = look;
  for (let y = 7; y < h - 1; y += 8) {
    for (let x = 4; x < w - 3; x += 8) {
      const bx = x + (look.wobble ? Math.round((R() - 0.5) * 4) : 0);
      const by = y + (look.wobble ? Math.round((R() - 0.5) * 3) : 0);
      const lean = (R() - 0.5) * 2;
      switch (stage) {
        case "transplanted": tuft(c, bx, by, 3 + Math.round(progress), 1, K.young, K.youngDark, 0); break;
        case "tillering": tuft(c, bx, by, 4 + Math.round(progress * 2), 1 + Math.round(progress), K.leaf, K.youngDark, lean); break;
        case "panicle": tuft(c, bx, by, 6 + Math.round(progress), 2, K.deepLeaf, K.leafDark, lean); break;
        case "heading":
          tuft(c, bx, by, 7, 2, K.deepLeaf, K.leafDark, lean);
          if (R() < 0.3 + progress * 0.6) heads.push([bx, by - 7, 0]);
          break;
        case "ripening":
          tuft(c, bx, by, 7, 2, mix(K.leaf, K.gold, progress), mix(K.leafDark, K.goldDark, progress), lean);
          heads.push([bx, by - 7, 1]);
          break;
        case "ripe":
          tuft(c, bx, by, 7, 2, K.gold, K.goldDark, 1);
          heads.push([bx + 1, by - 7, 2]);
          break;
        case "overripe":
          // lodged: the stems lie over
          tuft(c, bx, by, 5, 2, K.goldDark, K.crack, 4 + Math.round(progress * 2));
          heads.push([bx + 4, by - 4, 3]);
          break;
        default:
          break;
      }
    }
  }
  return heads;
}

/** The seedbed: a bright green corner patch that grows with age. */
function paintSeedbed(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
  const bw = Math.round(w * (0.25 + 0.2 * look.progress)), bh = Math.round(h * (0.3 + 0.2 * look.progress));
  rect(c, K.mudWet, 3, 3, bw, bh);
  for (let i = 0; i < bw * bh * (0.35 + 0.4 * look.progress); i++) {
    const x = 3 + Math.floor(R() * bw), y = 3 + Math.floor(R() * bh);
    px(c, R() < 0.5 ? K.seed1 : K.seed2, x, y);
    if (look.progress > 0.5 && R() < 0.4) px(c, K.seed2, x, y - 1);
  }
  rect(c, K.leafDark, 3, 3 + bh, bw, 1);
}

function paintPests(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
  for (const pest of look.pests) {
    for (let i = 0; i < 9; i++) {
      const x = 4 + Math.floor(R() * (w - 10)), y = 6 + Math.floor(R() * (h - 12));
      switch (pest) {
        case "snail":
          // pink egg clusters on the stems, and now and then the snail
          rect(c, K.egg, x, y - 4, 2, 2); px(c, K.egg, x + 1, y - 5);
          if (i % 3 === 0) { rect(c, C.outline, x + 3, y, 4, 3); rect(c, K.shell, x + 4, y, 2, 2); px(c, "#e0b27a", x + 3, y + 2); }
          break;
        case "leaf_folder": px(c, K.roll, x, y - 3); px(c, K.roll, x, y - 4); px(c, "#d6cfc0", x + 1, y - 4); break;
        case "hopper": px(c, K.hopper, x, y); px(c, K.hopper, x + 2, y); px(c, K.hopper, x + 1, y - 1); break;
        case "leaf_blast": px(c, K.blast, x, y - 3); px(c, K.blast, x - 1, y - 2); px(c, K.blast, x + 1, y - 2); px(c, K.blast, x, y - 1); break;
        case "neck_blast": px(c, C.white, x, y - 6); px(c, C.white, x, y - 7); px(c, "#d6cfc0", x + 1, y - 7); break;
      }
    }
  }
}

/** A plot of w × h px as it looks (browser only). */
export function paintPlot(look: PlotLook, w: number, h: number): HTMLCanvasElement {
  const cv = makeCanvas(w, h);
  const c = ctx2d(cv);
  const R = rng(look.seed);
  paintSoil(c, w, h, look.water, R);
  if (look.stage === "seedbed") paintSeedbed(c, look, w, h, R);
  const heads = paintHills(c, look, w, h, R);
  for (const [x, y, kind] of heads) {
    const col = kind === 0 ? K.panicle : kind === 1 ? mix(K.panicle, K.goldLight, look.progress) : kind === 2 ? K.goldLight : K.gold;
    px(c, col, x, y); px(c, col, x + 1, y + 1); px(c, col, x - 1, y + 1);
  }
  paintPests(c, look, w, h, R);
  // the dike's inner edge
  rect(c, K.dike, 0, 0, w, 1); rect(c, K.dike, 0, h - 1, w, 1); rect(c, K.dike, 0, 0, 1, h); rect(c, K.dike, w - 1, 0, 1, h);
  return cv;
}

/** Glints on a flooded plot (level ≥ 2), blinking unless motion is reduced. Drawn every frame in view coordinates. */
export function drawPlotShimmer(b: Ctx, x: number, y: number, w: number, h: number, look: PlotLook, t: number, reduced: boolean): void {
  if (look.water < 2 || reduced) return;
  const R = rng(look.seed + 1);
  b.fillStyle = C.sparkle;
  for (let i = 0; i < 6 + look.water * 2; i++) {
    const sx = Math.floor(R() * (w - 4)) + 2, sy = Math.floor(R() * (h - 4)) + 2, phase = R() * Math.PI * 2;
    if (Math.sin(t / 420 + phase) > 0.7) b.fillRect(x + sx, y + sy, 2, 1);
  }
}

/** The farmer's urgent ring: a gold frame 2 px outside the plot, pulsing (steady when motion is reduced). */
export function drawUrgentRing(b: Ctx, x: number, y: number, w: number, h: number, t: number, reduced: boolean): void {
  b.globalAlpha = reduced ? 0.85 : 0.5 + 0.4 * Math.sin(t / 260);
  b.fillStyle = C.goldLight;
  b.fillRect(x - 3, y - 3, w + 6, 2);
  b.fillRect(x - 3, y + h + 1, w + 6, 2);
  b.fillRect(x - 3, y - 1, 2, h + 2);
  b.fillRect(x + w + 1, y - 1, 2, h + 2);
  b.globalAlpha = 1;
}
```

- [ ] **Step 4: Draw the plots in the engine and pass them through the canvas**

**lib/game/engine.ts — edit 1 of 6.** Replace:

```ts
import { createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
```

with:

```ts
import { createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { drawPlotShimmer, drawUrgentRing, lookKey, paintPlot, type PlotDraw } from "@/lib/game/art/crops";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
```

**lib/game/engine.ts — edit 2 of 6.** Replace:

```ts
  private species = new Map<string, SpeciesInfo>();
  private raf = 0;
```

with:

```ts
  private species = new Map<string, SpeciesInfo>();
  private plots = new Map<number, PlotDraw>();
  /** Each plot's painted crop, repainted when its look's key changes. */
  private plotArt = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  private raf = 0;
```

**lib/game/engine.ts — edit 3 of 6.** Replace:

```ts
    this.species = new Map(list.map((s) => [s.id, { name: s.name, rarity: s.rarity }]));
  }
```

with:

```ts
    this.species = new Map(list.map((s) => [s.id, { name: s.name, rarity: s.rarity }]));
  }

  /** The field's plots: the crops, the name posts' labels and my urgent rings (spec §13.4). */
  setPlots(plots: ReadonlyArray<PlotDraw>): void {
    this.plots = new Map(plots.map((p) => [p.no, p]));
  }
```

**lib/game/engine.ts — edit 4 of 6.** Replace:

```ts
    this.art.drawAnimated(b, t, camX, camY, reduced);
```

with:

```ts
    this.art.drawAnimated(b, t, camX, camY, reduced);
    this.drawPlots(b, t, camX, camY, reduced);
```

**lib/game/engine.ts — edit 5 of 6.** Replace:

```ts

  private drawOverlays(now: number, camX: number, camY: number): void {
```

with:

```ts

  /** The crops on the plots (between the background and the props), their glints and my urgent rings. */
  private drawPlots(b: CanvasRenderingContext2D, t: number, camX: number, camY: number, reduced: boolean): void {
    for (const g of this.map.plots) {
      const d = this.plots.get(g.no);
      if (!d) continue;
      const { w, h } = g.rect;
      const x = g.rect.x - camX, y = g.rect.y - camY;
      if (x > this.vw || y > this.vh || x + w < 0 || y + h < 0) continue;
      if (d.look) {
        const key = lookKey(d.look);
        let art = this.plotArt.get(g.no);
        if (!art || art.key !== key) {
          art = { key, canvas: paintPlot(d.look, w, h) };
          this.plotArt.set(g.no, art);
        }
        b.drawImage(art.canvas, x, y);
        drawPlotShimmer(b, x, y, w, h, d.look, t, reduced);
      }
      if (d.urgent) drawUrgentRing(b, x, y, w, h, t, reduced);
    }
  }

  private drawOverlays(now: number, camX: number, camY: number): void {
```

**lib/game/engine.ts — edit 6 of 6.** Replace:

```ts
    c.textBaseline = "middle";
```

with:

```ts
    c.textBaseline = "middle";

    // the plots' name posts: a label over each post, under the people's tags
    c.font = `${Math.round(4 * s)}px ${font}`;
    for (const g of this.map.plots) {
      const d = this.plots.get(g.no);
      if (!d) continue;
      const [x, y] = dev(g.post.x, g.post.y - 22);
      const w = Math.round(c.measureText(d.label).width + 3 * s), h = Math.round(4.8 * s);
      if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) continue;
      c.fillStyle = "rgba(110, 68, 36, 0.88)";
      c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
      c.fillStyle = "#fbf3dc";
      c.fillText(d.label, x, y + s * 0.3);
    }
```

**components/game/GameCanvas.tsx — edit 1 of 6.** Replace:

```tsx
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { GameEngine, type LocalFishing, type RosterEntry } from "@/lib/game/engine";
```

with:

```tsx
import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { PlotDraw } from "@/lib/game/art/crops";
import { GameEngine, type LocalFishing, type RosterEntry } from "@/lib/game/engine";
```

**components/game/GameCanvas.tsx — edit 2 of 6.** Replace:

```tsx
  puff: (at: Vec) => void;
}
```

with:

```tsx
  puff: (at: Vec) => void;
  /** What the field's plots show (crops, name posts, my urgent rings). */
  setPlots: (plots: ReadonlyArray<PlotDraw>) => void;
}
```

**components/game/GameCanvas.tsx — edit 3 of 6.** Replace:

```tsx
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset and the input lock.
  const handRef = useRef<string | null>(null);
```

with:

```tsx
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset, the input lock and the plots.
  const handRef = useRef<string | null>(null);
```

**components/game/GameCanvas.tsx — edit 4 of 6.** Replace:

```tsx
  const inputRef = useRef(true);
  useEffect(() => {
```

with:

```tsx
  const inputRef = useRef(true);
  const plotsRef = useRef<ReadonlyArray<PlotDraw>>([]);
  useEffect(() => {
```

**components/game/GameCanvas.tsx — edit 5 of 6.** Replace:

```tsx
      puff: (at) => engineRef.current?.puff(at),
    };
```

with:

```tsx
      puff: (at) => engineRef.current?.puff(at),
      setPlots: (plots) => {
        plotsRef.current = plots;
        engineRef.current?.setPlots(plots);
      },
    };
```

**components/game/GameCanvas.tsx — edit 6 of 6.** Replace:

```tsx
    engine.setInputEnabled(inputRef.current);
```

with:

```tsx
    engine.setInputEnabled(inputRef.current);
    engine.setPlots(plotsRef.current);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/unit/game-crop-art.test.ts tests/unit/game-canvas-input.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/art/crops.ts lib/game/engine.ts components/game/GameCanvas.tsx tests/unit/game-crop-art.test.ts tests/unit/game-canvas-input.test.tsx` (clean).

```bash
git add lib/game/art/crops.ts lib/game/engine.ts components/game/GameCanvas.tsx tests/unit/game-crop-art.test.ts tests/unit/game-canvas-input.test.tsx
git commit -m "feat(v15): crop art, name posts and urgent rings on the field

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Farm icons

**Files:**
- Create: `lib/game/art/farm-icons.ts`
- Modify: `lib/game/art/icons.ts` (`iconMatrixFor` knows the farm icons)
- Test: `tests/unit/game-farm-icons.test.ts` (new; reads the seeded item ids from 0013)

**Interfaces:**
- Consumes: `PixelIcon` / `pixelIconMatrix` (`@/lib/game/art/icons`).
- Produces (`@/lib/game/art/farm-icons`): `FARM_ICONS: Record<string, PixelIcon>` — the 11 seeded farm items plus `rice_wet` and `rice_dry`; `iconMatrixFor(id)` resolves them (so `ItemIcon` draws them).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/game-farm-icons.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FARM_ICONS } from "@/lib/game/art/farm-icons";
import { ICON_SIZE, iconMatrixFor } from "@/lib/game/art/icons";

const sql = readFileSync("supabase/migrations/0013_v15_field.sql", "utf8");
/** The farm items seeded by `insert into public.shop_items … on conflict`. */
const seededItems = (): string[] => {
  const start = sql.indexOf("insert into public.shop_items");
  const block = sql.slice(start, sql.indexOf("on conflict", start));
  return [...block.matchAll(/^\s*\('([a-z_]+)',/gm)].map((m) => m[1]);
};

describe("farm icons", () => {
  it("are 16×16 and only use '.', 'o' and their own palette", () => {
    for (const [id, icon] of Object.entries(FARM_ICONS)) {
      expect(icon.rows, id).toHaveLength(ICON_SIZE);
      for (const row of icon.rows) {
        expect(row, id).toHaveLength(ICON_SIZE);
        for (const ch of row) expect(ch === "." || ch === "o" || ch in icon.pal, `${id}: ${ch}`).toBe(true);
      }
    }
  });
  it("cover every seeded farm item and the two rice sacks", () => {
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet"].sort());
  });
  it("resolve through iconMatrixFor", () => {
    expect(iconMatrixFor("seed_thom")).toHaveLength(16);
    expect(iconMatrixFor("fert_npk")?.[5]).toHaveLength(16);
    expect(iconMatrixFor("rice_dry")).not.toBeNull();
  });
  it("tell every item apart", () => {
    const looks = Object.keys(FARM_ICONS).map((id) => JSON.stringify(iconMatrixFor(id)));
    expect(new Set(looks).size).toBe(looks.length);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/game-farm-icons.test.ts`
Expected: FAIL — `@/lib/game/art/farm-icons` does not exist.

- [ ] **Step 3: Write the icons and hook them in**

Create `lib/game/art/farm-icons.ts`:

```ts
import type { PixelIcon } from "./icons";

// 16×16 icons for the farm (spec §14): seed sacks in the variety's colour, fertilizer bags with their nutrient on
// the label, pesticide bottles with their pest, and rice sacks (wet/dry). "." transparent, "o" outline, other letters
// from the icon's own palette. Original art.

const SEED_SACK = [
  "................",
  "......oooo......",
  ".....oTttTo.....",
  "......oTTo......",
  ".....orrrro.....",
  "....osssssSo....",
  "...osssssssSo...",
  "..osssssgssSSo..",
  "..ossssgYgsSSo..",
  "..osssgYgssSSo..",
  "..ossgYgsssSSo..",
  "..osssgssssSSo..",
  "..ossssssssSSo..",
  "...osssssssSo...",
  "....oooooooo....",
  "................",
];

const seedSack = (s: string, S: string): PixelIcon => ({
  rows: SEED_SACK,
  pal: { s, S, t: s, T: S, r: "#8b5a33", g: "#b8902a", Y: "#f6c945" },
});

/** "____" marks where a glyph row goes. */
const FERT_BAG = [
  "................",
  "...oooooooooo...",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "..owwwwwwwwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..oww____wwwWo..",
  "..owwwwwwwwwWo..",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "..obbbbbbbbbBo..",
  "...oooooooooo...",
  "................",
];

const PESTICIDE_BOTTLE = [
  "................",
  "......oooo......",
  "......occo......",
  "......oooo......",
  ".......oo.......",
  "......oBBo......",
  ".....oBBbBo.....",
  "....oBBBBbBo....",
  "....owwwwwWo....",
  "....ow____Wo....",
  "....ow____Wo....",
  "....ow____Wo....",
  "....owwwwwWo....",
  "....oBBBBbBo....",
  ".....oooooo.....",
  "................",
];

/** Put a 4-wide glyph ("." = the label) into a template's "____" rows. */
function withGlyph(template: readonly string[], glyph: readonly string[]): string[] {
  let i = 0;
  return template.map((row) => (row.includes("____") ? row.replace("____", glyph[i++].replace(/\./g, "w")) : row));
}

const LABEL = { w: "#f4efe0", W: "#d8cfb8" };

const fertBag = (b: string, B: string, glyph: readonly string[], ink: Record<string, string>): PixelIcon => ({
  rows: withGlyph(FERT_BAG, glyph), pal: { b, B, ...LABEL, ...ink },
});

const bottle = (B: string, b: string, cap: string, glyph: readonly string[], ink: string): PixelIcon => ({
  rows: withGlyph(PESTICIDE_BOTTLE, glyph), pal: { B, b, c: cap, L: ink, ...LABEL },
});

const RICE_SACK = [
  "................",
  "................",
  ".....oooooo.....",
  "....oYyYYyYo....",
  "...osYYyYYYso...",
  "...ossYYYYsso...",
  "..osssssssssSo..",
  "..ossssssssSSo..",
  ".osssssssssSSSo.",
  ".ossssMMssssSSo.",
  ".osssMMMMsssSSo.",
  ".ossssMMssssSSo.",
  ".osssssssssSSSo.",
  "..osssssssssSo..",
  "...oooooooooo...",
  "................",
];

const riceSack = (Y: string, y: string, M: string): PixelIcon => ({
  rows: RICE_SACK, pal: { Y, y, M, s: "#c8a46a", S: "#a8844f" },
});

export const FARM_ICONS: Record<string, PixelIcon> = {
  seed_short: seedSack("#7fb548", "#5a8f32"),
  seed_nep: seedSack("#efe6cf", "#cfc3a3"),
  seed_thom: seedSack("#d9776a", "#b25a4f"),
  // hữu cơ: a sprout
  fert_manure: fertBag("#8a6a3f", "#6e5230", ["..LL", ".LLL", "LLL.", ".L..", "L..."], { L: "#3f7f2e" }),
  fert_phosphate: fertBag("#9aa0a8", "#747a84", ["LLL.", "L..L", "LLL.", "L...", "L..."], { L: "#2a2f3a" }),
  fert_urea: fertBag("#e8e4d8", "#c3c8d4", ["L..L", "LL.L", "L.LL", "L..L", "L..L"], { L: "#3d6fd1" }),
  fert_potash: fertBag("#c0392b", "#8e2a1f", ["L..L", "L.L.", "LL..", "L.L.", "L..L"], { L: "#8e2a1f" }),
  // N, P and K in their colours
  fert_npk: fertBag("#3d6fd1", "#2f56a6", ["a..b", "a..b", "....", ".cc.", ".cc."], { a: "#3f7f2e", b: "#c0392b", c: "#2a2f3a" }),
  // a caterpillar, a hopper, a blast spot
  spray_insect: bottle("#5caa4a", "#86c95c", "#2f6e2f", [".LL.", "LLLL", "L..L"], "#3f7f2e"),
  spray_hopper: bottle("#e0873c", "#f2b27a", "#8e4a1f", ["L..L", ".LL.", "L..L"], "#7a4a2a"),
  spray_fungus: bottle("#7a5cc0", "#a58be0", "#4a3480", [".LL.", "L..L", ".LL."], "#8e5a2a"),
  rice_wet: riceSack("#c9c46a", "#a8a24a", "#6fb2cf"),
  rice_dry: riceSack("#f6c945", "#e0b33c", "#e0662f"),
};
```

**lib/game/art/icons.ts — edit 1 of 4.** Replace:

```ts
import { FISH_ICONS } from "./fish";
```

with:

```ts
import { FARM_ICONS } from "./farm-icons";
import { FISH_ICONS } from "./fish";
```

**lib/game/art/icons.ts — edit 2 of 4.** Replace:

```ts

/** A 16×16 icon with its own palette ("." transparent, "o" outline) — fish and gear (v14). */
export interface PixelIcon { rows: readonly string[]; pal: Readonly<Record<string, string>> }
```

with:

```ts

/** A 16×16 icon with its own palette ("." transparent, "o" outline) — fish and gear (v14), farm items (v15). */
export interface PixelIcon { rows: readonly string[]; pal: Readonly<Record<string, string>> }
```

**lib/game/art/icons.ts — edit 3 of 4.** Replace:

```ts

/** Any item's icon: clothing (catalog), fish species or fishing gear; null for an unknown id. */
export function iconMatrixFor(id: string): string[][] | null {
```

with:

```ts

/** Any item's icon: clothing (catalog), fish species, fishing gear or farm items (and rice_wet / rice_dry);
 *  null for an unknown id. */
export function iconMatrixFor(id: string): string[][] | null {
```

**lib/game/art/icons.ts — edit 4 of 4.** Replace:

```ts
  if (clothing) return clothing;
  const icon = FISH_ICONS[id] ?? GEAR_ICONS[id];
  return icon ? pixelIconMatrix(icon) : null;
```

with:

```ts
  if (clothing) return clothing;
  const icon = FISH_ICONS[id] ?? GEAR_ICONS[id] ?? FARM_ICONS[id];
  return icon ? pixelIconMatrix(icon) : null;
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/unit/game-farm-icons.test.ts tests/unit/game-fish-art.test.ts tests/unit/game-icons.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/art/farm-icons.ts lib/game/art/icons.ts tests/unit/game-farm-icons.test.ts` (clean).

```bash
git add lib/game/art/farm-icons.ts lib/game/art/icons.ts tests/unit/game-farm-icons.test.ts
git commit -m "feat(v15): farm icons for seeds, fertilizers, pesticides and rice

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: `fp` / `fa` messages and farm animations

**Files:**
- Modify: `lib/game/net/protocol.ts` (`FarmAnim`, `FARM_ANIM`, `MAX_PLOT`, the `fp` and `fa` messages, parsing, `GAME_EVENTS`)
- Modify: `lib/game/world.ts` (remote farm animations, `FARM_ANIM_MS`)
- Create: `lib/game/art/farm-anim.ts` (browser: the eight animations)
- Modify: `lib/game/engine.ts` (`showFarmAnim`; draws mine and the others'), `components/game/GameCanvas.tsx` (handle `farmAnim` / `plotChanged`; prop `onPlotChanged`)
- Test: `tests/unit/game-protocol.test.ts`, `tests/unit/game-world.test.ts`, `tests/unit/game-canvas-input.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 10's engine and canvas.
- Produces (`@/lib/game/net/protocol`): `FarmAnim = 0 … 8`, `FARM_ANIM = { stop: 0, transplant: 1, harvest: 2, pump: 3, spray: 4, fertilize: 5, crab: 6, snails: 7, prepare: 8 }`, `MAX_PLOT = 10`; messages `{ t: "fp"; id; p: number }` (0 = drying yard or offers) and `{ t: "fa"; id; a: FarmAnim }`, both control messages (FIFO in the send gate).
- Produces (`@/lib/game/world`): `FARM_ANIM_MS = 2500`, `RemoteWorld.farmAnim(id, now): FarmAnim` (an `fa` plays 2.5 s; `a = 0` stops it; forgotten on `bye`).
- Produces: `drawFarmAnim(ctx, feet, facing, a, t, reduced)` (`@/lib/game/art/farm-anim`); `GameEngine.showFarmAnim(a)`; `GameCanvasHandle.farmAnim(a)` (plays it and sends `fa`), `GameCanvasHandle.plotChanged(p)` (sends `fp`); `GameCanvasProps.onPlotChanged?: (p: number) => void` (an `fp` from another member or from my other tab).

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-protocol.test.ts — edit 1 of 3.** Replace:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { codeToFacing, createSendGate, facingToCode, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";
```

with:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { codeToFacing, createSendGate, facingToCode, FARM_ANIM, GAME_EVENTS, parseGameMessage, toPayload, type GameMessage } from "@/lib/game/net/protocol";
```

**tests/unit/game-protocol.test.ts — edit 2 of 3.** Replace:

```ts
    expect(toPayload({ t: "lk", id: "a" })).toEqual({ event: "lk", payload: { id: "a" } });
  });
});
```

with:

```ts
    expect(toPayload({ t: "lk", id: "a" })).toEqual({ event: "lk", payload: { id: "a" } });
  });
  it("accepts the field's fp (plot 0–10) and fa (animation 0–8)", () => {
    expect(GAME_EVENTS).toEqual(expect.arrayContaining(["fp", "fa"]));
    expect(parseGameMessage("fp", { id: "a", p: 0 }, B)).toEqual({ t: "fp", id: "a", p: 0 });
    expect(parseGameMessage("fp", { id: "a", p: 10 }, B)).toEqual({ t: "fp", id: "a", p: 10 });
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.prepare }, B)).toEqual({ t: "fa", id: "a", a: 8 });
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.stop }, B)).toEqual({ t: "fa", id: "a", a: 0 });
    const bad: Array<[string, unknown]> = [
      ["fp", { id: "a", p: 11 }], ["fp", { id: "a", p: -1 }], ["fp", { id: "a", p: 1.5 }], ["fp", { id: "a", p: "3" }], ["fp", { id: "a" }],
      ["fa", { id: "a", a: 9 }], ["fa", { id: "a", a: -1 }], ["fa", { id: "a", a: "1" }], ["fa", { id: "" , a: 1 }],
    ];
    for (const [event, payload] of bad) expect(parseGameMessage(event, payload, B), `${event} ${JSON.stringify(payload)}`).toBeNull();
  });
});
```

**tests/unit/game-protocol.test.ts — edit 3 of 3.** Replace:

```ts

  it("holds everything while not ready and sends it on kick()", () => {
```

with:

```ts

  it("treats fp and fa as control messages too", () => {
    vi.useFakeTimers();
    const sent: GameMessage[] = [];
    const gate = createSendGate((m) => sent.push(m));
    gate.push(mv(1));
    gate.push({ t: "fa", id: "me", a: 5 });
    gate.push({ t: "fp", id: "me", p: 3 });
    gate.push(mv(2));
    gate.push({ t: "fa", id: "me", a: 0 });
    vi.advanceTimersByTime(3000);
    expect(sent.map((m) => m.t)).toEqual(["mv", "fa", "fp", "fa", "mv"]);
    gate.dispose();
  });

  it("holds everything while not ready and sends it on kick()", () => {
```

**tests/unit/game-world.test.ts — edit 1 of 2.** Replace:

```ts
import type { GameMessage } from "@/lib/game/net/protocol";
import { CATCH_LABEL_MS, FISHING_STALE_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";
import { mapFromAscii } from "./helpers/ascii-map";
```

with:

```ts
import type { GameMessage } from "@/lib/game/net/protocol";
import { CATCH_LABEL_MS, FARM_ANIM_MS, FISHING_STALE_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";
import { mapFromAscii } from "./helpers/ascii-map";
```

**tests/unit/game-world.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("RemoteWorld: farm animations", () => {
  const fa = (id: string, a: 0 | 1 | 3): GameMessage => ({ t: "fa", id, a });

  it("plays an fa for 2.5 s; a = 0 stops it at once", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    expect(w.farmAnim("ann", 0)).toBe(0);
    w.applyMessage(fa("ann", 3), 1000);
    expect(w.farmAnim("ann", 1000 + FARM_ANIM_MS - 1)).toBe(3);
    expect(w.farmAnim("ann", 1000 + FARM_ANIM_MS)).toBe(0);
    w.applyMessage(fa("ann", 1), 5000);
    w.applyMessage(fa("ann", 0), 5100);
    expect(w.farmAnim("ann", 5100)).toBe(0);
  });

  it("forgets it on bye and ignores my own fa", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    w.applyMessage(fa("ann", 1), 0);
    w.remove("ann");
    expect(w.farmAnim("ann", 10)).toBe(0);
    w.applyMessage(fa("me", 1), 20);
    expect(w.farmAnim("me", 20)).toBe(0);
  });
});
```

**tests/unit/game-canvas-input.test.tsx — edit 1 of 6.** Replace:

```tsx

// One fake engine per world: it records what the canvas tells it about the input lock and the plots.
const { engines } = vi.hoisted(() => ({
  engines: [] as Array<{ mapId: string; input: boolean[]; plots: unknown[]; destroyed: boolean }>,
}));
```

with:

```tsx

// One fake engine and channel per world: they record what the canvas tells them (input lock, plots, farm
// animations, messages) and let a test deliver messages.
type EngineRec = { mapId: string; input: boolean[]; plots: unknown[]; anims: number[]; applied: unknown[]; destroyed: boolean };
const { engines, channels } = vi.hoisted(() => ({
  engines: [] as EngineRec[],
  channels: [] as Array<{ onMessage: (msg: unknown) => void; sent: unknown[] }>,
}));
```

**tests/unit/game-canvas-input.test.tsx — edit 2 of 6.** Replace:

```tsx
  GameEngine: class {
    rec: { mapId: string; input: boolean[]; plots: unknown[]; destroyed: boolean };
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], destroyed: false };
      engines.push(this.rec);
```

with:

```tsx
  GameEngine: class {
    rec: EngineRec;
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], anims: [], applied: [], destroyed: false };
      engines.push(this.rec);
```

**tests/unit/game-canvas-input.test.tsx — edit 3 of 6.** Replace:

```tsx
      this.rec.plots.push(plots);
    }
```

with:

```tsx
      this.rec.plots.push(plots);
    }
    showFarmAnim(a: number) {
      this.rec.anims.push(a);
    }
    applyMessage(msg: unknown) {
      this.rec.applied.push(msg);
    }
```

**tests/unit/game-canvas-input.test.tsx — edit 4 of 6.** Replace:

```tsx
vi.mock("@/lib/game/net/channel", () => ({
  joinGameChannel: () => ({ send: () => {}, leave: () => {} }),
}));
```

with:

```tsx
vi.mock("@/lib/game/net/channel", () => ({
  joinGameChannel: (_room: string, _map: unknown, h: { onMessage: (msg: unknown) => void }) => {
    const ch = { onMessage: h.onMessage, sent: [] as unknown[] };
    channels.push(ch);
    return { send: (msg: unknown) => ch.sent.push(msg), leave: () => {} };
  },
}));
```

**tests/unit/game-canvas-input.test.tsx — edit 5 of 6.** Replace:

```tsx
  engines.length = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
```

with:

```tsx
  engines.length = 0;
  channels.length = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
```

**tests/unit/game-canvas-input.test.tsx — edit 6 of 6.** Append at the end of the file, after a blank line:

```tsx
describe("GameCanvas farm messages", () => {
  it("plays my farm animation and sends fa and fp", () => {
    const ref = createRef<GameCanvasHandle>();
    render(<GameCanvas ref={ref} mapId="field" {...props} />);
    ref.current!.farmAnim(3);
    ref.current!.plotChanged(7);
    expect(engines[0].anims).toEqual([3]);
    expect(channels[0].sent).toEqual([{ t: "fa", id: "me", a: 3 }, { t: "fp", id: "me", p: 7 }]);
  });
  it("passes on fp from the others and from my other tab, and gives fa to the engine", () => {
    const onPlotChanged = vi.fn();
    render(<GameCanvas mapId="field" {...props} onPlotChanged={onPlotChanged} />);
    channels[0].onMessage({ t: "fp", id: "ann", p: 7 });
    channels[0].onMessage({ t: "fp", id: "me", p: 0 });
    expect(onPlotChanged.mock.calls).toEqual([[7], [0]]);
    channels[0].onMessage({ t: "fa", id: "ann", a: 1 });
    expect(engines[0].applied).toEqual([{ t: "fa", id: "ann", a: 1 }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts tests/unit/game-canvas-input.test.tsx`
Expected: FAIL — no `fp` / `fa`, no `farmAnim`.

- [ ] **Step 3: The messages and the remote animations**

**lib/game/net/protocol.ts — edit 1 of 6.** Replace:

```ts
export type FishPhase = 0 | 1 | 2 | 3;

/** Broadcast messages on channel `game:{roomId}:{mapId}` (v13 spec §8.2, v14 spec §9.3). `id` = sender account id.
 *  `h` = the species id of the fish in the sender's hand (null = none; absent = unchanged); `st` may carry `f`. */
export type GameMessage =
```

with:

```ts
export type FishPhase = 0 | 1 | 2 | 3;
/** Farm animation (v15 spec §12), played for 2.5 s; 0 stops it. */
export type FarmAnim = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const FARM_ANIM = {
  stop: 0, transplant: 1, harvest: 2, pump: 3, spray: 4, fertilize: 5, crab: 6, snails: 7, prepare: 8,
} as const satisfies Record<string, FarmAnim>;
/** The highest plot number on the field; `fp` with p = 0 means the drying yard or the offers. */
export const MAX_PLOT = 10;

/** Broadcast messages on channel `game:{roomId}:{mapId}` (v13 spec §8.2, v14 spec §9.3, v15 spec §12). `id` = sender
 *  account id. `h` = the species id of the fish in the sender's hand (null = none; absent = unchanged); `st` may carry
 *  `f`. `fp` = "plot p changed, fetch the field again"; `fa` = the sender's farm animation. */
export type GameMessage =
```

**lib/game/net/protocol.ts — edit 2 of 6.** Replace:

```ts
  | { t: "fs"; id: string; f: FishPhase; h: string | null; c?: [string, number] }
  | { t: "lk"; id: string }
```

with:

```ts
  | { t: "fs"; id: string; f: FishPhase; h: string | null; c?: [string, number] }
  | { t: "fp"; id: string; p: number }
  | { t: "fa"; id: string; a: FarmAnim }
  | { t: "lk"; id: string }
```

**lib/game/net/protocol.ts — edit 3 of 6.** Replace:

```ts

export const GAME_EVENTS: readonly GameEvent[] = ["hello", "st", "mv", "pa", "fs", "lk", "bye"];
```

with:

```ts

export const GAME_EVENTS: readonly GameEvent[] = ["hello", "st", "mv", "pa", "fs", "fp", "fa", "lk", "bye"];
```

**lib/game/net/protocol.ts — edit 4 of 6.** Replace:

```ts
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
```

with:

```ts
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isFarmAnim = (v: unknown): v is FarmAnim => isInt(v) && v >= 0 && v <= 8;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
```

**lib/game/net/protocol.ts — edit 5 of 6.** Replace:

```ts
    }
    default:
```

with:

```ts
    }
    case "fp":
      return isInt(p.p) && p.p >= 0 && p.p <= MAX_PLOT ? { t: "fp", id: p.id, p: p.p } : null;
    case "fa":
      return isFarmAnim(p.a) ? { t: "fa", id: p.id, a: p.a } : null;
    default:
```

**lib/game/net/protocol.ts — edit 6 of 6.** Replace:

```ts
/** Token bucket (default 3 msgs/s, burst 3). Movement messages (mv/pa/st) are coalesced to the latest one;
 *  control messages (hello/fs/lk/bye) are queued FIFO, never dropped, and go first. */
export function createSendGate(send: (msg: GameMessage) => void, opts: SendGateOptions = {}): SendGate {
```

with:

```ts
/** Token bucket (default 3 msgs/s, burst 3). Movement messages (mv/pa/st) are coalesced to the latest one;
 *  control messages (hello/fs/fp/fa/lk/bye) are queued FIFO, never dropped, and go first. */
export function createSendGate(send: (msg: GameMessage) => void, opts: SendGateOptions = {}): SendGate {
```

**lib/game/world.ts — edit 1 of 5.** Replace:

```ts
import type { GameMap, Spot } from "@/lib/game/maps/types";
import { codeToFacing, type FishPhase, type GameMessage } from "@/lib/game/net/protocol";
import type { Look } from "@/lib/game/types";
```

with:

```ts
import type { GameMap, Spot } from "@/lib/game/maps/types";
import { codeToFacing, type FarmAnim, type FishPhase, type GameMessage } from "@/lib/game/net/protocol";
import type { Look } from "@/lib/game/types";
```

**lib/game/world.ts — edit 2 of 5.** Replace:

```ts
export const CATCH_LABEL_MS = 3000;
```

with:

```ts
export const CATCH_LABEL_MS = 3000;
/** How long a farm animation (`fa`) plays (v15 spec §12). */
export const FARM_ANIM_MS = 2500;
```

**lib/game/world.ts — edit 3 of 5.** Replace:

```ts
  private readonly fishingById = new Map<string, FishingNote>();
  private walking = 0;
```

with:

```ts
  private readonly fishingById = new Map<string, FishingNote>();
  /** The last farm animation per member and when it started. */
  private readonly farmById = new Map<string, { a: FarmAnim; at: number }>();
  private walking = 0;
```

**lib/game/world.ts — edit 4 of 5.** Replace:

```ts

  /** st / mv / pa / fs from the network; other message types are ignored. */
  applyMessage(msg: GameMessage, now: number): void {
    if (msg.id === this.localId) return;
    if (msg.t === "fs") {
```

with:

```ts

  /** st / mv / pa / fs / fa from the network; other message types are ignored. */
  applyMessage(msg: GameMessage, now: number): void {
    if (msg.id === this.localId) return;
    if (msg.t === "fa") {
      if (msg.a === 0) this.farmById.delete(msg.id);
      else this.farmById.set(msg.id, { a: msg.a, at: now });
      return;
    }
    if (msg.t === "fs") {
```

**lib/game/world.ts — edit 5 of 5.** Replace:

```ts
    this.fishingById.delete(id);
  }
```

with:

```ts
    this.fishingById.delete(id);
    this.farmById.delete(id);
  }

  /** A member's farm animation as of `now` (0 = none): each `fa` plays for FARM_ANIM_MS. */
  farmAnim(id: string, now: number): FarmAnim {
    const n = this.farmById.get(id);
    return n && now - n.at < FARM_ANIM_MS ? n.a : 0;
  }
```

- [ ] **Step 4: Draw the animations; the canvas sends and receives them**

Create `lib/game/art/farm-anim.ts`:

```ts
import { handPoint } from "@/lib/game/fishing/geometry";
import { FARM_ANIM, type FarmAnim } from "@/lib/game/net/protocol";
import type { Facing, Vec } from "@/lib/game/types";

// The farm animations (v15 spec §12), drawn in world pixels over a character while they play: seedlings, the sickle,
// pumped water, spray mist, fertilizer, a crab, a snail, the hoe. Browser only (canvas). Original art.

type Ctx = CanvasRenderingContext2D;

const FACE: Record<Facing, Vec> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const COL = {
  seedling: "#6fbf4a", seedlingDark: "#4f9a38", tie: "#8b5a33", straw: "#e0b33c", strawDark: "#b8902a",
  blade: "#5a5f68", edge: "#e8e8ee", handle: "#6e4424", water: "#6fb2cf", waterLight: "#a6d6e8", mist: "rgba(244, 241, 234, 0.75)",
  granule: "#f4efe0", crab: "#b8432f", crabLight: "#d9776a", shell: "#8a5a2b", shellLight: "#c9955a", egg: "#f29bb5",
  soil: "#6e5230",
};

function px(c: Ctx, col: string, x: number, y: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** A tied bunch (seedlings or cut rice) held at p. */
function bunch(c: Ctx, p: Vec, col: string, dark: string): void {
  for (let k = 1; k <= 5; k++) {
    px(c, col, p.x - 1, p.y - k);
    px(c, dark, p.x, p.y - k - 1);
    px(c, col, p.x + 1, p.y - k);
  }
  for (let d = -1; d <= 1; d++) px(c, COL.tie, p.x + d, p.y);
}

/** Points along an arc from a to b, `n` of them, shifted along it by `shift` (0–1) so they flow. */
function arc(a: Vec, b: Vec, n: number, shift: number, rise: number): Vec[] {
  const pts: Vec[] = [];
  for (let k = 0; k < n; k++) {
    const s = ((k + shift) / n) % 1;
    pts.push({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s - rise * 4 * s * (1 - s) });
  }
  return pts;
}

// the sickle's blade around the hand, raised → cutting → down → back (x mirrored when facing left)
const SICKLE: ReadonlyArray<ReadonlyArray<[number, number]>> = [
  [[1, -3], [2, -4], [3, -4], [4, -3], [4, -2]],
  [[2, -2], [3, -2], [4, -1], [4, 0], [3, 1]],
  [[2, 0], [3, 1], [3, 2], [2, 3], [1, 3]],
  [[1, -1], [2, -2], [3, -2], [4, -1], [4, 0]],
];

/**
 * Farm animation `a` for a character whose feet are at `feet` (world px minus the camera), at frame time `t`.
 * Under reduced motion it holds one pose.
 */
export function drawFarmAnim(c: Ctx, feet: Vec, facing: Facing, a: FarmAnim, t: number, reduced: boolean): void {
  if (a === FARM_ANIM.stop) return;
  const hand = handPoint(feet, facing), f = FACE[facing];
  const flip = facing === "left" ? -1 : 1;
  // the ground just in front of the feet
  const g = { x: feet.x + f.x * 12, y: feet.y + (f.y > 0 ? 8 : f.y < 0 ? -6 : 2) };
  const beat = reduced ? 1 : Math.floor(t / 180) % 4;
  const flow = reduced ? 0.5 : (t % 720) / 720;
  switch (a) {
    case FARM_ANIM.transplant:
      bunch(c, hand, COL.seedling, COL.seedlingDark);
      // the hills set so far in front
      for (let k = 0; k <= beat; k++) {
        const x = g.x - 6 + k * 4;
        px(c, COL.seedlingDark, x, g.y); px(c, COL.seedling, x, g.y - 1); px(c, COL.seedling, x - 1, g.y - 2); px(c, COL.seedling, x + 1, g.y - 2);
      }
      break;
    case FARM_ANIM.harvest:
      px(c, COL.handle, hand.x, hand.y + 1); px(c, COL.handle, hand.x, hand.y + 2);
      SICKLE[beat].forEach(([dx, dy], k) => px(c, k === 4 ? COL.edge : COL.blade, hand.x + dx * flip, hand.y + dy));
      // cut straw flying off
      for (let k = 0; k < 3; k++) px(c, k % 2 ? COL.strawDark : COL.straw, g.x - 2 + k * 2, g.y - 2 - ((beat + k) % 3));
      break;
    case FARM_ANIM.pump:
      for (const p of arc(hand, g, 7, flow * 7, 6)) { px(c, COL.water, p.x, p.y); px(c, COL.waterLight, p.x, p.y - 1); }
      for (let k = -2; k <= 2; k++) px(c, COL.waterLight, g.x + k * 2, g.y - (Math.abs(k) + beat) % 2);
      break;
    case FARM_ANIM.spray: {
      // the wand, then a mist cloud that breathes
      const tip = { x: hand.x + f.x * 5 + (f.x === 0 ? 2 : 0), y: hand.y + f.y * 3 - 1 };
      for (let k = 0; k <= 4; k++) px(c, COL.handle, hand.x + ((tip.x - hand.x) * k) / 4, hand.y + ((tip.y - hand.y) * k) / 4);
      const r = 3 + beat;
      for (let k = 0; k < 10; k++) {
        const ang = (k / 10) * Math.PI * 2 + beat * 0.4;
        px(c, COL.mist, g.x + Math.cos(ang) * r, g.y - 3 + Math.sin(ang) * r * 0.5);
      }
      break;
    }
    case FARM_ANIM.fertilize:
      for (const p of arc(hand, g, 5, flow * 5, 4)) px(c, COL.granule, p.x, p.y);
      for (let k = 0; k < 4; k++) px(c, COL.granule, g.x - 4 + k * 3, g.y + ((k + beat) % 2));
      break;
    case FARM_ANIM.crab:
      c.fillStyle = COL.crab;
      c.fillRect(Math.round(hand.x) - 2, Math.round(hand.y) - 2, 5, 3);
      px(c, COL.crabLight, hand.x - 1, hand.y - 2);
      // claws open and close
      px(c, COL.crab, hand.x - 3, hand.y - 3 - (beat % 2)); px(c, COL.crab, hand.x + 3, hand.y - 3 - (beat % 2));
      px(c, COL.crab, hand.x - 3, hand.y + 1); px(c, COL.crab, hand.x + 3, hand.y + 1);
      break;
    case FARM_ANIM.snails:
      c.fillStyle = COL.shell;
      c.fillRect(Math.round(hand.x) - 1, Math.round(hand.y) - 3, 4, 3);
      px(c, COL.shellLight, hand.x, hand.y - 2);
      // pink eggs scraped off the stems in front
      for (let k = 0; k < 3; k++) px(c, COL.egg, g.x - 3 + k * 3, g.y - 3 - ((k + beat) % 2));
      break;
    case FARM_ANIM.prepare: {
      // the hoe: up on the first beats, down in the mud on the last
      const down = beat >= 2;
      const head = { x: hand.x + 5 * flip, y: hand.y + (down ? 6 : -6) };
      for (let k = 0; k <= 6; k++) px(c, COL.handle, hand.x + ((head.x - hand.x) * k) / 6, hand.y + ((head.y - hand.y) * k) / 6);
      c.fillStyle = COL.blade;
      c.fillRect(Math.round(head.x) - 2, Math.round(head.y), 4, 2);
      px(c, COL.edge, head.x - 2 * flip, head.y + 1);
      if (down) for (let k = 0; k < 4; k++) px(c, COL.soil, head.x - 3 + k * 2, head.y - 1 - (k % 2) * 2);
      break;
    }
  }
}
```

**lib/game/engine.ts — edit 1 of 11.** Replace:

```ts
import { drawPlotShimmer, drawUrgentRing, lookKey, paintPlot, type PlotDraw } from "@/lib/game/art/crops";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
```

with:

```ts
import { drawPlotShimmer, drawUrgentRing, lookKey, paintPlot, type PlotDraw } from "@/lib/game/art/crops";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
```

**lib/game/engine.ts — edit 2 of 11.** Replace:

```ts
import { inputDir, type KeyState } from "@/lib/game/movement";
import { facingToCode, MAX_PATH_POINTS, type FacingCode, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { unseenGraceMs } from "@/lib/game/net/replies";
```

with:

```ts
import { inputDir, type KeyState } from "@/lib/game/movement";
import { facingToCode, MAX_PATH_POINTS, type FacingCode, type FarmAnim, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { unseenGraceMs } from "@/lib/game/net/replies";
```

**lib/game/engine.ts — edit 3 of 11.** Replace:

```ts
import type { Facing, Look, Vec } from "@/lib/game/types";
import { CATCH_LABEL_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";
```

with:

```ts
import type { Facing, Look, Vec } from "@/lib/game/types";
import { CATCH_LABEL_MS, FARM_ANIM_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";
```

**lib/game/engine.ts — edit 4 of 11.** Replace:

```ts
  private species = new Map<string, SpeciesInfo>();
  private plots = new Map<number, PlotDraw>();
```

with:

```ts
  private species = new Map<string, SpeciesInfo>();
  /** My farm animation and when it started. */
  private farm: { a: FarmAnim; at: number } | null = null;
  private plots = new Map<number, PlotDraw>();
```

**lib/game/engine.ts — edit 5 of 11.** Replace:

```ts

  /** st / mv / pa / fs from the network (other message types are handled by the caller). */
  applyMessage(msg: GameMessage): void {
```

with:

```ts

  /** st / mv / pa / fs / fa from the network (other message types are handled by the caller). */
  applyMessage(msg: GameMessage): void {
```

**lib/game/engine.ts — edit 6 of 11.** Replace:

```ts
    this.plots = new Map(plots.map((p) => [p.no, p]));
  }
```

with:

```ts
    this.plots = new Map(plots.map((p) => [p.no, p]));
  }

  /** Play farm animation `a` on my character for FARM_ANIM_MS (0 stops it). */
  showFarmAnim(a: FarmAnim): void {
    this.farm = a === 0 ? null : { a, at: performance.now() };
  }
```

**lib/game/engine.ts — edit 7 of 11.** Replace:

```ts
    };
    /** The rod (while fishing) or the fish in hand, drawn over the character. */
    const drawGear = (pos: Vec, facing: Facing, phase: 0 | 1 | 2 | 3, hand: string | null, rod: { swing: number; tint: string | null; glow: boolean } | null) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      if (rod) drawRod(b, feet, facing, { phase, swing: rod.swing, tint: rod.tint, glow: rod.glow, t, reducedMotion: reduced });
      else if (hand) drawHeldFish(b, feet, facing, hand);
```

with:

```ts
    };
    /** The rod (while fishing), the fish in hand or a farm animation, drawn over the character. */
    const drawGear = (pos: Vec, facing: Facing, phase: 0 | 1 | 2 | 3, hand: string | null, rod: { swing: number; tint: string | null; glow: boolean } | null, farm: FarmAnim) => {
      const feet = { x: Math.round(pos.x) - camX, y: Math.round(pos.y) - camY };
      if (rod) drawRod(b, feet, facing, { phase, swing: rod.swing, tint: rod.tint, glow: rod.glow, t, reducedMotion: reduced });
      else if (farm !== 0) drawFarmAnim(b, feet, facing, farm, t, reduced);
      else if (hand) drawHeldFish(b, feet, facing, hand);
```

**lib/game/engine.ts — edit 8 of 11.** Replace:

```ts
      const f = this.world.fishing(e.id, t);
      items.push({
```

with:

```ts
      const f = this.world.fishing(e.id, t);
      const farm = this.world.farmAnim(e.id, t);
      items.push({
```

**lib/game/engine.ts — edit 9 of 11.** Replace:

```ts
          drawActor(e.look, a.display, a.facing, walkFrame(a));
          drawGear(a.display, a.facing, f.phase, f.hand, f.phase === 0 ? null : { swing: 1, tint: null, glow: false });
        },
```

with:

```ts
          drawActor(e.look, a.display, a.facing, walkFrame(a));
          drawGear(a.display, a.facing, f.phase, f.hand, f.phase === 0 ? null : { swing: 1, tint: null, glow: false }, farm);
        },
```

**lib/game/engine.ts — edit 10 of 11.** Replace:

```ts
    const fishing = this.fishing;
    items.push({
```

with:

```ts
    const fishing = this.fishing;
    const myFarm = this.farm && t - this.farm.at < FARM_ANIM_MS ? this.farm.a : 0;
    items.push({
```

**lib/game/engine.ts — edit 11 of 11.** Replace:

```ts
        drawGear(me.display, me.facing, phaseCode(fishing.phase), this.hand,
          fishing.phase === "idle" ? null : { swing, tint: fishing.tint, glow: fishing.glow });
      },
```

with:

```ts
        drawGear(me.display, me.facing, phaseCode(fishing.phase), this.hand,
          fishing.phase === "idle" ? null : { swing, tint: fishing.tint, glow: fishing.glow }, myFarm);
      },
```

**components/game/GameCanvas.tsx — edit 1 of 6.** Replace:

```tsx
import { joinGameChannel } from "@/lib/game/net/channel";
import type { FishPhase, GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs } from "@/lib/game/net/replies";
```

with:

```tsx
import { joinGameChannel } from "@/lib/game/net/channel";
import type { FarmAnim, FishPhase, GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs } from "@/lib/game/net/replies";
```

**components/game/GameCanvas.tsx — edit 2 of 6.** Replace:

```tsx
  setPlots: (plots: ReadonlyArray<PlotDraw>) => void;
}
```

with:

```tsx
  setPlots: (plots: ReadonlyArray<PlotDraw>) => void;
  /** Play a farm animation on my character and show it to the others (`fa`; 0 stops it). */
  farmAnim: (a: FarmAnim) => void;
  /** Tell the others that plot `p` (0 = the drying yard or the offers) changed: they fetch the field again (`fp`). */
  plotChanged: (p: number) => void;
}
```

**components/game/GameCanvas.tsx — edit 3 of 6.** Replace:

```tsx
  onFishingInput: (kind: "tap" | "cancel") => void;
  /** A new world drew its first frame. */
```

with:

```tsx
  onFishingInput: (kind: "tap" | "cancel") => void;
  /** Someone (or my other tab) changed plot `p` on this map (`fp`). */
  onPlotChanged?: (p: number) => void;
  /** A new world drew its first frame. */
```

**components/game/GameCanvas.tsx — edit 4 of 6.** Replace:

```tsx
      },
    };
```

with:

```tsx
      },
      farmAnim: (a) => {
        engineRef.current?.showFarmAnim(a);
        sendRef.current?.({ t: "fa", id: localId, a });
      },
      plotChanged: (p) => sendRef.current?.({ t: "fp", id: localId, p }),
    };
```

**components/game/GameCanvas.tsx — edit 5 of 6.** Replace:

```tsx
          if (msg.t === "bye") channel.send(engine.snapshot());
          return;
```

with:

```tsx
          if (msg.t === "bye") channel.send(engine.snapshot());
          // …or it changed a plot: this tab fetches the field again too
          else if (msg.t === "fp") propsRef.current.onPlotChanged?.(msg.p);
          return;
```

**components/game/GameCanvas.tsx — edit 6 of 6.** Replace:

```tsx
            propsRef.current.onLookChanged(msg.id);
            break;
```

with:

```tsx
            propsRef.current.onLookChanged(msg.id);
            break;
          case "fp":
            propsRef.current.onPlotChanged?.(msg.p);
            break;
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-channel.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/net/protocol.ts lib/game/world.ts lib/game/art/farm-anim.ts lib/game/engine.ts components/game/GameCanvas.tsx tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts tests/unit/game-canvas-input.test.tsx` (clean).

```bash
git add lib/game/net/protocol.ts lib/game/world.ts lib/game/art/farm-anim.ts lib/game/engine.ts components/game/GameCanvas.tsx tests/unit/game-protocol.test.ts tests/unit/game-world.test.ts tests/unit/game-canvas-input.test.tsx
git commit -m "feat(v15): fp/fa messages and farm animations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: `useField` — the room's field, its actions and the `fp` refetch

**Files:**
- Create: `hooks/useField.ts`
- Test: `tests/unit/use-field.test.tsx` (new; mocks `@/lib/game/farm/rpc`)

**Interfaces:**
- Consumes: `fetchFarmCatalog`, `fetchFieldState`, `fieldAction`, `sellRice`, `buyFarmItem`, `claimFarmGift` (Task 6), `syncClock` (Task 4), `farmErrorMessage`, `isMissingRpc` (Task 6), `withMine` (Task 4).
- Produces (`@/hooks/useField`): `FP_GATHER_MS = 400`; `useField(roomId, token, active: boolean, onError: (text) => void): FieldData` with `FieldData { state: FieldState | null; catalog: FarmCatalog | null; failed; notOpen; reload(): Promise<FieldState | null>; run(a: FieldAction, itemName?): Promise<FieldAnswer | null>; sellRice(variety, dry, kg): Promise<MineAnswer | null>; buyItem(itemId, qty, itemName?): Promise<MineAnswer | null>; claimGift(): Promise<(MineAnswer & { gifted }) | null>; plotChanged(): void }`. Nothing is fetched while `active` is false; every answer sets the shared clock; an older answer never replaces a newer one; errors toast `farmErrorMessage` and refetch; a missing RPC (migration not run) sets `notOpen`; a burst of `fp`s causes one refetch 400 ms after the first.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-field.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { clockOffset } from "@/lib/game/farm/clock";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { FP_GATHER_MS, useField } from "@/hooks/useField";

const NOW = "2026-09-25T10:00:00+00:00";
const field = (coins: number, serverNow = NOW): FieldState => parseFieldState({
  server_now: serverNow,
  plots: [{ no: 1, kind: "private", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
  drying: [],
  mine: { items: {}, rice: {}, coins, gift_claimed: false, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
})!;
const CATALOG = { varieties: [], items: [] };
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(NOW) - 60_000); // this client runs a minute behind the server
  for (const f of Object.values(rpc)) f.mockReset();
  rpc.fetchFieldState.mockResolvedValue(field(100));
  rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useField", () => {
  it("fetches the field and the catalog only while I am on the field, and sets the clock", async () => {
    const { result, rerender } = renderHook(({ active }) => useField("r", "tok", active, () => {}), { initialProps: { active: false } });
    await flush();
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    rerender({ active: true });
    await flush();
    expect(rpc.fetchFieldState).toHaveBeenCalledWith("r", "tok");
    expect(result.current.state?.mine.coins).toBe(100);
    expect(result.current.catalog).toEqual(CATALOG);
    expect(clockOffset()).toBe(60_000);
  });

  it("marks a failed load, and a missing migration as not open", async () => {
    rpc.fetchFieldState.mockRejectedValueOnce(new Error("down"));
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    expect(result.current).toMatchObject({ state: null, failed: true, notOpen: false });
    rpc.fetchFieldState.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.field_state" });
    await act(async () => { await result.current.reload(); });
    expect(result.current.notOpen).toBe(true);
    await act(async () => { await result.current.reload(); });
    expect(result.current).toMatchObject({ failed: false, notOpen: false, state: { mine: { coins: 100 } } });
  });

  it("applies an action's answer; on error it toasts the Vietnamese text and fetches again", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fieldAction.mockResolvedValueOnce({ state: field(50), harvest: null });
    await act(async () => { await result.current.run({ kind: "rent", plot: 5 }); });
    expect(rpc.fieldAction).toHaveBeenCalledWith("r", "tok", { kind: "rent", plot: 5 });
    expect(result.current.state?.mine.coins).toBe(50);
    rpc.fieldAction.mockRejectedValueOnce({ message: "not enough coins" });
    rpc.fetchFieldState.mockResolvedValueOnce(field(7));
    let answer: unknown = "unset";
    await act(async () => { answer = await result.current.run({ kind: "buy_plot", plot: 1 }); });
    expect(answer).toBeNull();
    expect(onError).toHaveBeenCalledWith("Không đủ xu.");
    await flush();
    expect(result.current.state?.mine.coins).toBe(7);
  });

  it("keeps the newest answer when answers overtake each other", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    let slow!: (s: FieldState) => void;
    rpc.fetchFieldState.mockReturnValueOnce(new Promise((resolve) => { slow = resolve; }));
    let reloading!: Promise<unknown>;
    act(() => { reloading = result.current.reload(); });
    rpc.fieldAction.mockResolvedValueOnce({ state: field(300), harvest: null });
    await act(async () => { await result.current.run({ kind: "prepare", plot: 1 }); });
    await act(async () => { slow(field(1)); await reloading; });
    expect(result.current.state?.mine.coins).toBe(300);
  });

  it("puts the account part of sell_rice, buy_farm_item and claim_farm_gift into the field", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    const mine = parseFarmMine({ items: { seed_nep: 3 }, rice: { nep: { wet: 0, dry: 10 } }, coins: 420, gift_claimed: true })!;
    rpc.sellRice.mockResolvedValueOnce({ serverNow: NOW, mine });
    await act(async () => { await result.current.sellRice("nep", true, 50); });
    expect(rpc.sellRice).toHaveBeenCalledWith("tok", "nep", true, 50);
    expect(result.current.state?.mine).toMatchObject({ coins: 420, items: { seed_nep: 3 }, giftClaimed: true, farming: [] });
    rpc.claimFarmGift.mockResolvedValueOnce({ serverNow: NOW, mine, gifted: false });
    let gift: unknown;
    await act(async () => { gift = await result.current.claimGift(); });
    expect(gift).toMatchObject({ gifted: false });
  });

  it("answers a burst of fp with one refetch", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.fetchFieldState.mockClear();
    act(() => {
      result.current.plotChanged();
      result.current.plotChanged();
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(FP_GATHER_MS - 1); });
    act(() => result.current.plotChanged());
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/use-field.test.tsx`
Expected: FAIL — `@/hooks/useField` does not exist.

- [ ] **Step 3: Write the hook**

Create `hooks/useField.ts`:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FarmCatalog } from "@/lib/game/farm/catalog";
import { syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc } from "@/lib/game/farm/messages";
import {
  buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice,
  type FieldAction, type FieldAnswer, type MineAnswer,
} from "@/lib/game/farm/rpc";
import { withMine, type FieldState } from "@/lib/game/farm/state";

export interface FieldData {
  /** null until the first field_state answer. */
  state: FieldState | null;
  catalog: FarmCatalog | null;
  /** field_state failed: the panels show FIELD_FAILED with a reload button. */
  failed: boolean;
  /** Migration 0013 is not run: the field shows the NOT_OPEN banner. */
  notOpen: boolean;
  /** Fetches the field again, and the catalog too while it has not loaded. */
  reload: () => Promise<FieldState | null>;
  /** A land, farming or drying action; its answer replaces the state. On error: toast, refetch, null. */
  run: (a: FieldAction, itemName?: string) => Promise<FieldAnswer | null>;
  sellRice: (variety: string, dry: boolean, kg: number) => Promise<MineAnswer | null>;
  buyItem: (itemId: string, qty: number, itemName?: string) => Promise<MineAnswer | null>;
  claimGift: () => Promise<(MineAnswer & { gifted: boolean }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst. */
  plotChanged: () => void;
}

/** `fp`s arriving this close together are answered by one refetch (spec §12). */
export const FP_GATHER_MS = 400;

/** Is answer `n` newer than the last one applied? Then it becomes the last one applied. */
function newest(applied: { current: number }, n: number): boolean {
  if (n < applied.current) return false;
  applied.current = n;
  return true;
}

/** The field of this room as the server sees it (spec §11.5) and the RPCs that change it. Answers carry server_now,
 *  which sets the shared clock; after an error the toast shows the Vietnamese text and the field is fetched again. Nothing
 *  is fetched while `active` is false (I am not on the field). */
export function useField(roomId: string, token: string, active: boolean, onError: (text: string) => void): FieldData {
  const [state, setState] = useState<FieldState | null>(null);
  const [catalog, setCatalog] = useState<FarmCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  const [notOpen, setNotOpen] = useState(false);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });
  // Answers can overtake each other: only an answer to a call started after the last applied one is kept.
  const seq = useRef(0);
  const applied = useRef(0);
  const apply = useCallback((n: number, s: FieldState) => {
    syncClock(s.serverNow);
    if (!newest(applied, n)) return;
    setState(s);
    setFailed(false);
    setNotOpen(false);
  }, []);
  const applyMine = useCallback((n: number, r: MineAnswer) => {
    syncClock(r.serverNow);
    if (newest(applied, n)) setState((s) => s && withMine(s, r.mine));
  }, []);

  const mounted = useRef(false);
  const catalogLoaded = useRef(false);
  const loadCatalog = useCallback(() => {
    fetchFarmCatalog().then((c) => {
      if (!mounted.current) return;
      catalogLoaded.current = true;
      setCatalog(c);
    }).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    if (!catalogLoaded.current) loadCatalog();
    const n = ++seq.current;
    try {
      const s = await fetchFieldState(roomId, token);
      apply(n, s);
      return s;
    } catch (err) {
      if (n >= applied.current) {
        if (isMissingRpc(err)) setNotOpen(true);
        else setFailed(true);
      }
      return null;
    }
  }, [roomId, token, apply, loadCatalog]);

  const gather = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (gather.current) clearTimeout(gather.current);
      gather.current = null;
    };
  }, []);
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void reload(), 0);
    return () => clearTimeout(first);
  }, [active, reload]);

  const plotChanged = useCallback(() => {
    if (gather.current) return;
    gather.current = setTimeout(() => {
      gather.current = null;
      void reload();
    }, FP_GATHER_MS);
  }, [reload]);

  /** Run an RPC and apply its answer. On error: toast, refetch, null. */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void, itemName?: string): Promise<T | null> => {
    const n = ++seq.current;
    try {
      const r = await job();
      keep(n, r);
      return r;
    } catch (err) {
      if (isMissingRpc(err)) setNotOpen(true);
      onErrorRef.current(farmErrorMessage(err, itemName));
      void reload();
      return null;
    }
  }, [reload]);

  return {
    state, catalog, failed, notOpen, reload, plotChanged,
    run: useCallback((a: FieldAction, itemName?: string) =>
      call(() => fieldAction(roomId, token, a), (n, r) => apply(n, r.state), itemName), [call, apply, roomId, token]),
    sellRice: useCallback((variety: string, dry: boolean, kg: number) =>
      call(() => sellRice(token, variety, dry, kg), applyMine), [call, applyMine, token]),
    buyItem: useCallback((itemId: string, qty: number, itemName?: string) =>
      call(() => buyFarmItem(token, itemId, qty), applyMine, itemName), [call, applyMine, token]),
    claimGift: useCallback(() => call(() => claimFarmGift(token), applyMine), [call, applyMine, token]),
  };
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm vitest run tests/unit/use-field.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint hooks/useField.ts tests/unit/use-field.test.tsx` (clean).

```bash
git add hooks/useField.ts tests/unit/use-field.test.tsx
git commit -m "feat(v15): useField — field state, actions and fp refetch

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: `useFarmController` — prompts, panels, due tasks, plots, gift, animations and work progress

**Files:**
- Create: `hooks/useFarmController.ts`
- Modify: `lib/game/farm/actions.ts` (`plotPrompt`), `lib/game/farm/messages.ts` (`boughtText`, `riceSaleText`)
- Test: `tests/unit/use-farm-controller.test.tsx` (new); `tests/unit/farm-actions.test.ts`, `tests/unit/farm-messages.test.ts` (extend)

**Interfaces:**
- Consumes: `useField` (Task 13), `plotDraws` (Task 10), `dueTasks` / `plotActions` (Task 7), `serverNow` (Task 4), `GameCanvasHandle.setPlots` / `farmAnim` / `plotChanged` / `plant` (Tasks 10, 12), `getMap("field")` (Task 8).
- Produces (`@/lib/game/farm/actions`): `plotPrompt(p, me, v, catalog, mine, now)` — "Gieo mạ thửa 3" (my next enabled job: pick / prepare / soak / sow / transplant / harvest), else "Xem thửa 3", "Xem thửa 5 (của Lan)", "Xem thửa 5 (đất trống)", "Xem thửa 2 (đất bán)".
- Produces (`@/lib/game/farm/messages`): `boughtText(itemName, qty)` ("🛒 Đã mua Giống nếp × 3."), `riceSaleText(kg, varietyName, dry, earned)` ("💰 Bán 120 kg lúa thơm khô được 3.120 xu.").
- Produces (`@/hooks/useFarmController`): `WORK_MS = 3000`; `FarmPanel = { kind: "plot"; plot } | { kind: "coop" } | { kind: "shop" } | { kind: "depot" } | { kind: "drying" } | { kind: "handbook"; tab: string | null } | { kind: "tasks" }`; `FarmWork { plot, work: "transplant" | "harvest", startedAt }`; `useFarmController({ token, roomId, accountId, mapId, canvas: () => GameCanvasHandle | null, toast, onCoinsChanged }): FarmController` with `{ data: FieldData; now; tasks: FarmTask[]; urgent: number; panel; openPanel(p); closePanel(); busy; work: FarmWork | null; cancelWork(); act(a: PlotRun, done?): Promise<boolean>; buy(itemId, qty): Promise<boolean>; sell(variety, dry, kg): Promise<boolean>; interact(it): boolean; promptText(it): string | null }`. On the field it pushes `plotDraws` (with my urgent plots) to the canvas every 30 s and with every answer, claims the gift once, sends `fa` for instant actions and `fp` after every success, runs `begin_work` → 3 s progress (plants the character at the plot's use spot, locks input via `work`) → transplant / harvest with quality 1.0, and calls `onCoinsChanged` when `mine.coins` moves.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/use-farm-controller.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable } from "@/lib/game/maps/types";

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { useFarmController, WORK_MS } from "@/hooks/useFarmController";

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG = {
  varieties: [nep],
  items: [farmItemFromRow({ id: "spray_hopper", kind: "pesticide", name: "Thuốc trừ rầy", price: 80, sort_order: 20, variety: null, fert: null, pest_target: "hopper", capacity: null })],
};

/** Plot 5: my ripe nếp, drained, with brown planthoppers; plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean } = {}): FieldState => parseFieldState({
  server_now: iso(0),
  plots: [
    { no: 1, kind: "private", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null },
    {
      no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: ME,
      lease: { source: "village", until: iso(40), price: 250 }, offers: 0,
      crop: {
        variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50),
        water: 1, water_set_at: iso(-3), pests: [{ kind: "hopper", since: iso(-1), treated_at: null }], excess_n: false, ripe: true,
        rotted_at: null,
        log: { water: [{ t: iso(-64), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
    },
    { no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: LAN, lease: { source: "village", until: iso(40), price: 250 }, offers: 0, crop: null },
  ],
  drying: [],
  mine: {
    items: { spray_hopper: 1 }, rice: { nep: { wet: 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [],
  },
})!;

const handle = () => ({
  setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(),
}) as unknown as GameCanvasHandle & Record<"setPlots" | "farmAnim" | "plotChanged" | "plant", ReturnType<typeof vi.fn>>;
const spot = (id: string): Interactable => getMap("field").interactables.find((i) => i.id === id)!;
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

function setup(opts: { toast?: (t: string) => void; onCoinsChanged?: () => void } = {}) {
  const canvas = handle();
  const toast = opts.toast ?? vi.fn();
  const view = renderHook(() => useFarmController({
    token: "tok", roomId: "r", accountId: "me", mapId: "field", canvas: () => canvas, toast,
    onCoinsChanged: opts.onCoinsChanged ?? (() => {}),
  }));
  return { canvas, toast, ...view };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const f of Object.values(rpc)) f.mockReset();
  rpc.fetchFieldState.mockResolvedValue(field());
  rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useFarmController", () => {
  it("lists my due tasks and draws the plots with my urgent ring", async () => {
    const { result, canvas } = setup();
    await flush();
    expect(result.current.tasks).toEqual([
      { plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true },
      { plot: 5, text: "Thửa 5 · Gặt — còn 10 giờ", urgent: false },
    ]);
    expect(result.current.urgent).toBe(1);
    const draws = canvas.setPlots.mock.calls.at(-1)![0] as Array<{ no: number; look: { stage: string } | null; label: string; urgent: boolean }>;
    expect(draws.map((d) => [d.no, d.look?.stage ?? null, d.label, d.urgent])).toEqual([
      [1, null, "1 · đất bán", false], [5, "ripe", "5 · Me", true], [6, null, "6 · Lan", false],
    ]);
  });

  it("names my next job in a plot's prompt and leaves other maps' prompts alone", async () => {
    const { result } = setup();
    await flush();
    expect(result.current.promptText(spot("plot_5"))).toBe("Gặt lúa thửa 5");
    expect(result.current.promptText(spot("plot_6"))).toBe("Xem thửa 6 (của Lan)");
    expect(result.current.promptText(spot("coop"))).toBe("Hợp tác xã · chú Tám");
    expect(result.current.promptText(getMap("pond").interactables.find((i) => i.kind === "depot")!)).toBeNull();
  });

  it("opens the field's panels, or says the field is not open before the migration", async () => {
    const { result } = setup();
    await flush();
    act(() => { expect(result.current.interact(spot("plot_6"))).toBe(true); });
    expect(result.current.panel).toEqual({ kind: "plot", plot: 6 });
    act(() => { result.current.interact(spot("rice_depot")); });
    expect(result.current.panel).toEqual({ kind: "depot" });
    expect(result.current.interact(getMap("pond").interactables.find((i) => i.kind === "shop")!)).toBe(false);

    rpc.fetchFieldState.mockRejectedValue({ code: "PGRST202", message: "Could not find the function" });
    const closed = setup();
    await flush();
    act(() => { closed.result.current.interact(spot("coop")); });
    expect(closed.toast).toHaveBeenCalledWith(NOT_OPEN);
    expect(closed.result.current.panel).toBeNull();
  });

  it("claims the newcomer gift once, with chú Tám's greeting", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ giftClaimed: false }));
    rpc.claimFarmGift.mockResolvedValue({ serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 1000, gift_claimed: true }), gifted: true });
    const { result, toast } = setup();
    await flush();
    await flush();
    expect(rpc.claimFarmGift).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(GIFT_TEXT);
    expect(result.current.data.state?.mine.giftClaimed).toBe(true);
  });

  it("animates an instant action and tells the others", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "spray", plot: 5, item: "spray_hopper" }, "Đã xịt."); });
    expect(rpc.fieldAction).toHaveBeenCalledWith("r", "tok", { kind: "spray", plot: 5, item: "spray_hopper" });
    expect(canvas.farmAnim).toHaveBeenCalledWith(4);
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(toast).toHaveBeenCalledWith("Đã xịt.");
  });

  it("harvests: begin_work, the progress with movement locked, then harvest with q 1.0", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "harvest" }); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    const use = spot("plot_5");
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(canvas.farmAnim).toHaveBeenCalledWith(2);
    expect(result.current.work).toMatchObject({ plot: 5, work: "harvest" });
    rpc.fieldAction.mockResolvedValueOnce({ state: field(), harvest: { variety: "nep", kg: 70 } });
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest", plot: 5, quality: 1 });
    expect(toast).toHaveBeenCalledWith("🌾 Gặt được 70 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(result.current.work).toBeNull();
  });

  it("cancels the work before it is sent", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "transplant" }); });
    act(() => result.current.cancelWork());
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    expect(result.current.work).toBeNull();
  });

  it("toasts a rice sale with what it earned and has the wallet fetched again", async () => {
    const onCoinsChanged = vi.fn();
    const { result, toast } = setup({ onCoinsChanged });
    await flush();
    rpc.sellRice.mockResolvedValue({ serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 1900, gift_claimed: true }) });
    await act(async () => { await result.current.sell("nep", true, 50); });
    expect(toast).toHaveBeenCalledWith("💰 Bán 50 kg nếp khô được 900 xu.");
    expect(onCoinsChanged).toHaveBeenCalledTimes(1);
  });
});
```

**tests/unit/farm-actions.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { dueTasks, fertAdvice, plotActions, type PlotAction } from "@/lib/game/farm/actions";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { dueTasks, fertAdvice, plotActions, plotPrompt, type PlotAction } from "@/lib/game/farm/actions";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
```

**tests/unit/farm-actions.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("plotPrompt", () => {
  const prompt = (p: PlotView, h: number) => plotPrompt(p, "me", nep, CATALOG, ALL, at(h));
  it("names my next job on a plot I farm", () => {
    expect(prompt(plot(null), 0)).toBe("Làm đất thửa 5");
    expect(prompt(plot(crop({ soakAt: null, variety: null })), 0)).toBe("Ngâm giống thửa 5");
    expect(prompt(plot(crop({}, [[0, 3], [2.75, 1]])), 3)).toBe("Gieo mạ thửa 5");
    expect(prompt(plot(crop({ sowAt: at(3), transplantAt: at(12) })), 20)).toBe("Xem thửa 5");
  });
  it("says whose plot it is otherwise", () => {
    const lan = { id: "lan", name: "Lan" };
    expect(prompt(plot(null, { farmer: lan }), 0)).toBe("Xem thửa 5 (của Lan)");
    expect(prompt(plot(null, { farmer: null, lease: null }), 0)).toBe("Xem thửa 5 (đất trống)");
    expect(prompt(plot(null, { no: 2, kind: "private", farmer: null, lease: null }), 0)).toBe("Xem thửa 2 (đất bán)");
    expect(prompt(plot(null, { no: 2, kind: "private", owner: lan, farmer: null, lease: null }), 0)).toBe("Xem thửa 2 (của Lan)");
  });
});
```

**tests/unit/farm-messages.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { durationText, farmErrorMessage, harvestText, isMissingRpc, PEST_NAME, PEST_REMEDY, PHASE_NAME } from "@/lib/game/farm/messages";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
  boughtText, durationText, farmErrorMessage, harvestText, isMissingRpc, PEST_NAME, PEST_REMEDY, PHASE_NAME, riceSaleText,
} from "@/lib/game/farm/messages";
```

**tests/unit/farm-messages.test.ts — edit 2 of 2.** Replace:

```ts
    expect(harvestText(70, "Nếp")).toBe("🌾 Gặt được 70 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
  });
});
```

with:

```ts
    expect(harvestText(70, "Nếp")).toBe("🌾 Gặt được 70 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
  });
  it("tells a purchase and a rice sale", () => {
    expect(boughtText("Phân urê", 1)).toBe("🛒 Đã mua Phân urê.");
    expect(boughtText("Giống nếp", 3)).toBe("🛒 Đã mua Giống nếp × 3.");
    expect(riceSaleText(120, "Lúa thơm", true, 3120)).toBe("💰 Bán 120 kg lúa thơm khô được 3.120 xu.");
    expect(riceSaleText(10, "Nếp", false, 126)).toBe("💰 Bán 10 kg nếp ướt được 126 xu.");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/use-farm-controller.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-messages.test.ts`
Expected: FAIL — no controller, no `plotPrompt`, no sale / purchase texts.

- [ ] **Step 3: Prompts and toast texts**

**lib/game/farm/actions.ts.** Replace:

```ts

/** What is due on the plots I farm (spec §13.1): urgent tasks first, then by plot. */
```

with:

```ts

/** The jobs a plot's prompt can name, by action key (before the ":"). */
const PROMPT_JOB: Record<string, string> = {
  pick: "Bắt ốc", prepare: "Làm đất", soak: "Ngâm giống", sow: "Gieo mạ", transplant: "Cấy lúa", harvest: "Gặt lúa",
};

/** A plot's HUD prompt (spec §13.2): my next job there ("Gieo mạ thửa 3"), else whose plot it is ("Xem thửa 5 (của Lan)"). */
export function plotPrompt(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): string {
  if (p.farmer?.id === me) {
    const job = plotActions(p, me, v, catalog, mine, now).map((a) => (a.enabled ? PROMPT_JOB[a.key.split(":")[0]] : undefined)).find(Boolean);
    return job ? `${job} thửa ${p.no}` : `Xem thửa ${p.no}`;
  }
  const who = p.farmer ?? p.owner;
  return `Xem thửa ${p.no} (${who ? `của ${who.name}` : p.kind === "private" ? "đất bán" : "đất trống"})`;
}

/** What is due on the plots I farm (spec §13.1): urgent tasks first, then by plot. */
```

**lib/game/farm/messages.ts.** Replace:

```ts
  return `🌾 Gặt được ${kg} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}
```

with:

```ts
  return `🌾 Gặt được ${kg} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}

export function boughtText(itemName: string, qty: number): string {
  return `🛒 Đã mua ${itemName}${qty > 1 ? ` × ${qty}` : ""}.`;
}

export function riceSaleText(kg: number, varietyName: string, dry: boolean, earned: number): string {
  return `💰 Bán ${kg} kg ${varietyName.toLowerCase()} ${dry ? "khô" : "ướt"} được ${earned.toLocaleString("vi-VN")} xu.`;
}
```

- [ ] **Step 4: Write the controller**

Create `hooks/useFarmController.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useField, type FieldData } from "@/hooks/useField";
import { plotDraws } from "@/lib/game/art/crops";
import { dueTasks, plotPrompt, type FarmTask, type PlotRun } from "@/lib/game/farm/actions";
import { serverNow } from "@/lib/game/farm/clock";
import { boughtText, GIFT_TEXT, harvestText, NOT_OPEN, riceSaleText } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId } from "@/lib/game/maps/types";
import { FARM_ANIM, type FarmAnim } from "@/lib/game/net/protocol";

/** The field's panels; the plot panel is for one plot, the handbook may open at a tab. */
export type FarmPanel =
  | { kind: "plot"; plot: number }
  | { kind: "coop" }
  | { kind: "shop" }
  | { kind: "depot" }
  | { kind: "drying" }
  | { kind: "handbook"; tab: string | null }
  | { kind: "tasks" };

/** Transplanting or harvesting in progress: movement is locked until it is sent or cancelled (spec §16). */
export interface FarmWork { plot: number; work: "transplant" | "harvest"; startedAt: number }

export interface FarmController {
  data: FieldData;
  /** Now on the server's clock (refreshed every 30 s and by every answer); 0 before the first tick. */
  now: number;
  /** What is due on my plots, urgent first, and how many are urgent (the HUD dot). */
  tasks: FarmTask[];
  urgent: number;
  panel: FarmPanel | null;
  openPanel: (p: FarmPanel) => void;
  closePanel: () => void;
  /** An action is in flight: the panels' buttons wait. */
  busy: boolean;
  work: FarmWork | null;
  cancelWork: () => void;
  /** A land, farming or drying action (a work action starts the progress); `done` is toasted when it succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
  buy: (itemId: string, qty: number) => Promise<boolean>;
  sell: (variety: string, dry: boolean, kg: number) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
  interact: (it: Interactable) => boolean;
  /** A plot's prompt names my next job there; the field's other interactables keep theirs; null = not the field's. */
  promptText: (it: Interactable) => string | null;
}

export interface FarmControllerOptions {
  token: string;
  roomId: string;
  accountId: string;
  /** The map I am on: the field is fetched and drawn only while it is "field". */
  mapId: MapId;
  /** The game canvas (null while there is none). */
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  /** My coins changed on the field (the HUD's wallet reads the fishing state: fetch it again). */
  onCoinsChanged: () => void;
}

/** Transplanting and harvesting take this long on screen (the server's gate is 2 s; spec §4, §11.4). */
export const WORK_MS = 3000;
/** How often the clock ticks while on the field. */
const TICK_MS = 30_000;
/** The animation each instant action plays (the work actions play theirs while they run). */
const ANIM: Partial<Record<FieldAction["kind"], FarmAnim>> = {
  prepare: FARM_ANIM.prepare, water: FARM_ANIM.pump, spray: FARM_ANIM.spray, fertilize: FARM_ANIM.fertilize,
  pick_snails: FARM_ANIM.snails,
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying"]);

/** Everything farming for the game shell (spec §7–§8, §12–§13): the field, the clock, the prompts, the panels, the
 *  due tasks and the plots on the canvas, the newcomer gift, the actions with their animations (`fa`) and the others'
 *  refetch (`fp`), and the transplant / harvest progress. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
  const active = mapId === "field";
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
  const [busy, setBusy] = useState(false);
  const [work, setWork] = useState<FarmWork | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen };
  });

  // --- the clock: an answer carries the server's time, and a tick moves it on while I am on the field
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const beat = () => setTick(serverNow());
    const first = setTimeout(beat, 0);
    const timer = setInterval(beat, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active]);
  const now = Math.max(tick, state?.serverNow ?? 0);

  // --- due tasks, and the plots on the canvas with my urgent rings
  const tasks = useMemo(() => (state && catalog ? dueTasks(state.plots, accountId, catalog.varieties, now) : []), [state, catalog, accountId, now]);
  useEffect(() => {
    if (!active || !state) return;
    const urgentPlots = new Set(tasks.filter((t) => t.urgent).map((t) => t.plot));
    canvas()?.setPlots(plotDraws(state.plots, catalog?.varieties ?? [], urgentPlots, now));
  }, [active, state, catalog, tasks, now, canvas]);

  // --- the newcomer gift: asked once, on the first visit that shows it unclaimed
  const giftAsked = useRef(false);
  const giftDue = active && state !== null && !state.mine.giftClaimed;
  useEffect(() => {
    if (!giftDue || giftAsked.current) return;
    giftAsked.current = true;
    void claimGift().then((r) => {
      if (r?.gifted) live.current.toast(GIFT_TEXT);
    });
  }, [giftDue, claimGift]);

  // --- my coins moved (rent, buy, sell, a land sale to me): the HUD's wallet fetches again
  const coins = state?.mine.coins ?? null;
  const lastCoins = useRef<number | null>(null);
  useEffect(() => {
    if (coins === null) return;
    if (lastCoins.current !== null && lastCoins.current !== coins) live.current.onCoinsChanged();
    lastCoins.current = coins;
  }, [coins]);

  // --- transplanting and harvesting: begin_work, the progress (movement locked), then the action with q = 1.0
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (workTimer.current) clearTimeout(workTimer.current);
  }, []);
  const finishWork = useCallback(async (plot: number, w: FarmWork["work"]) => {
    const r = await run({ kind: w, plot, quality: 1 });
    setWork(null);
    if (!r) return;
    canvas()?.plotChanged(plot);
    if (r.harvest) {
      const name = live.current.catalog?.varieties.find((v) => v.id === r.harvest!.variety)?.name ?? r.harvest.variety;
      live.current.toast(harvestText(r.harvest.kg, name));
    }
  }, [run, canvas]);
  const startWork = useCallback(async (plot: number, w: FarmWork["work"]): Promise<boolean> => {
    if (workTimer.current) return false;
    setBusy(true);
    const begun = await run({ kind: "begin_work", plot, work: w });
    setBusy(false);
    if (!begun) return false;
    const c = canvas();
    const spot = getMap("field").interactables.find((i) => i.plot === plot);
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    c?.farmAnim(w === "transplant" ? FARM_ANIM.transplant : FARM_ANIM.harvest);
    setPanel(null);
    setWork({ plot, work: w, startedAt: Date.now() });
    workTimer.current = setTimeout(() => {
      workTimer.current = null;
      void finishWork(plot, w);
    }, WORK_MS);
    return true;
  }, [run, canvas, finishWork]);
  const cancelWork = useCallback(() => {
    if (!workTimer.current) return;
    clearTimeout(workTimer.current);
    workTimer.current = null;
    setWork(null);
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);
  useEffect(() => {
    if (!active) cancelWork();
  }, [active, cancelWork]);

  // --- the actions
  const act = useCallback(async (a: PlotRun, done?: string): Promise<boolean> => {
    if (a.kind === "work") return startWork(a.plot, a.work);
    setBusy(true);
    try {
      const itemName = "item" in a ? live.current.catalog?.items.find((i) => i.id === a.item)?.name : undefined;
      const r = await run(a, itemName);
      if (!r) return false;
      const c = canvas();
      const anim = ANIM[a.kind];
      if (anim) c?.farmAnim(anim);
      c?.plotChanged("plot" in a ? a.plot : 0);
      if (done) live.current.toast(done);
      return true;
    } finally {
      setBusy(false);
    }
  }, [run, canvas, startWork]);
  const buy = useCallback(async (itemId: string, qty: number): Promise<boolean> => {
    setBusy(true);
    try {
      const name = live.current.catalog?.items.find((i) => i.id === itemId)?.name ?? itemId;
      const r = await buyItem(itemId, qty, name);
      if (r) live.current.toast(boughtText(name, qty));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [buyItem]);
  const sell = useCallback(async (variety: string, dry: boolean, kg: number): Promise<boolean> => {
    setBusy(true);
    try {
      const before = live.current.state?.mine.coins ?? 0;
      const r = await sellRice(variety, dry, kg);
      const name = live.current.catalog?.varieties.find((v) => v.id === variety)?.name ?? variety;
      if (r) live.current.toast(riceSaleText(kg, name, dry, r.mine.coins - before));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [sellRice]);

  // --- the field's interactables and prompts
  const interact = useCallback((it: Interactable): boolean => {
    if (!FIELD_KINDS.has(it.kind)) return false;
    if (live.current.notOpen) {
      live.current.toast(NOT_OPEN);
      return true;
    }
    switch (it.kind) {
      case "plot":
        if (it.plot) setPanel({ kind: "plot", plot: it.plot });
        break;
      case "coop":
        setPanel({ kind: "coop" });
        break;
      case "farm_shop":
        setPanel({ kind: "shop" });
        break;
      case "rice_depot":
        setPanel({ kind: "depot" });
        break;
      case "drying":
        setPanel({ kind: "drying" });
        break;
    }
    return true;
  }, []);
  const promptText = useCallback((it: Interactable): string | null => {
    if (!FIELD_KINDS.has(it.kind)) return null;
    const p = it.kind === "plot" ? state?.plots.find((x) => x.no === it.plot) : undefined;
    if (!p || !state || !catalog) return it.prompt;
    return plotPrompt(p, accountId, catalog.varieties.find((v) => v.id === p.crop?.variety) ?? null, catalog, state.mine, now);
  }, [state, catalog, accountId, now]);

  return {
    data,
    now,
    tasks,
    urgent: tasks.filter((t) => t.urgent).length,
    panel,
    openPanel: setPanel,
    closePanel: useCallback(() => setPanel(null), []),
    busy,
    work,
    cancelWork,
    act,
    buy,
    sell,
    interact,
    promptText,
  };
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/unit/use-farm-controller.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-messages.test.ts tests/unit/use-field.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint hooks/useFarmController.ts lib/game/farm/actions.ts lib/game/farm/messages.ts tests/unit/use-farm-controller.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-messages.test.ts` (clean).

```bash
git add hooks/useFarmController.ts lib/game/farm/actions.ts lib/game/farm/messages.ts tests/unit/use-farm-controller.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-messages.test.ts
git commit -m "feat(v15): useFarmController — prompts, due tasks, gift, work progress

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: The co-op, the farm shop, the rice depot and the drying yard

**Files:**
- Create: `components/game/farm/FieldStatus.tsx` (loading / failed + reload), `components/game/farm/Stepper.tsx` (− n + Tối đa), `components/game/farm/ConfirmButton.tsx` (asks first when warned)
- Create: `components/game/farm/CoopPanel.tsx` (tabs Đất làng, Đất tư, Chợ đất, Của tôi; exports `LandButton` and `MyPlot` for Task 16)
- Create: `components/game/farm/FarmShopPanel.tsx`, `components/game/farm/RiceDepotPanel.tsx`, `components/game/farm/DryingPanel.tsx`
- Test: `tests/unit/farm-panels.test.tsx` (new)

**Interfaces:**
- Consumes: land rules (Task 7), catalog helpers (Task 4), `FieldAction` (Task 6), `durationText` (Task 6), `formatXu` (`@/lib/game/fishing/catalog`), `ItemIcon`, `ParchmentModal`.
- Produces:
  - `CoopPanel({ state, failed, me, busy, now, onAct: (a: FieldAction, done?: string) => void, onReload, onClose })`; named exports `LandButton({ refusal, busy, warn?, primary?, onClick, children })` (disabled with `reasonText(refusal)`; `""` = disabled quietly) and `MyPlot({ p, ctx, busy, onAct })` (list / unlist, sublease / stop, sell back).
  - `FarmShopPanel({ mine, catalog, failed, busy, onBuy: (itemId, qty) => void, onReload, onClose })`.
  - `RiceDepotPanel({ mine, catalog, failed, busy, onSell: (variety, dry, kg) => void, onReload, onClose })`.
  - `DryingPanel({ state, catalog, failed, me, busy, now, onAct, onReload, onClose })`.
  - `FieldStatus({ failed, onReload })`, `Stepper({ value, min?, max, label, unit?, onChange })`, `ConfirmButton({ warn?, disabled?, primary?, onConfirm, children })`.
  - Success toasts (passed as `done`): "Đã thuê thửa 7 trong 4 ngày.", "🏡 Đã mua thửa 3.", "Đã thuê thửa 3 của An một vụ.", "Đã gửi đề nghị mua thửa 4 giá 6.000 xu.", "Đã rao bán thửa 2 giá 12.000 xu.", "Đã thôi rao bán.", "Đã cho thuê thửa 2 giá 300 xu một vụ.", "Đã thôi cho thuê.", "Đã bán lại thửa 2 cho làng — nhận 2.000 xu.", "Đã bán thửa 2 — nhận 9.000 xu.", "Đã từ chối đề nghị.", "Đã rút đề nghị.", "Đã lấy 40 kg nếp khô.", "Đang phơi 29 kg nếp — 3 giờ nữa là khô.".

- [ ] **Step 1: Write the failing test**

Create `tests/unit/farm-panels.test.tsx`:

```tsx
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CoopPanel from "@/components/game/farm/CoopPanel";
import DryingPanel from "@/components/game/farm/DryingPanel";
import FarmShopPanel from "@/components/game/farm/FarmShopPanel";
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const AN = { id: "an", name: "An" };
const item = (id: string, kind: string, name: string, price: number, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const CATALOG: FarmCatalog = {
  varieties: [
    varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 12, blast_mult: 1, sort_order: 10 }),
    varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 }),
  ],
  items: [
    item("seed_nep", "seed", "Giống nếp", 90, { variety: "nep" }),
    item("fert_urea", "fertilizer", "Phân urê", 60, { fert: "urea" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", 80, { pest_target: "hopper" }),
  ],
};
const bare = (no: number, kind: "private" | "village", over: Record<string, unknown> = {}) => ({
  no, kind, owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});
const lease = (h: number) => ({ source: "village", until: iso(h), price: 250 });

/** Plot 1 for sale by the village; 2 mine (bare); 3 An's, listed and subleased; 4 Lan's; 5 Lan rents; 6 I rent; 7–10 free. */
const STATE: FieldState = parseFieldState({
  server_now: iso(0),
  plots: [
    bare(1, "private"),
    bare(2, "private", { owner: ME, farmer: ME }),
    bare(3, "private", { owner: AN, farmer: AN, sale_price: 8000, sublease_price: 300 }),
    bare(4, "private", { owner: LAN, farmer: LAN }),
    bare(5, "village", { farmer: LAN, lease: lease(30) }),
    bare(6, "village", { farmer: ME, lease: lease(5) }),
    bare(7, "village"), bare(8, "village"), bare(9, "village"), bare(10, "village"),
  ],
  drying: [
    { slot: 1, owner: ME, variety: "nep", kg: 40, ready_at: iso(-1) },
    { slot: 3, owner: LAN, variety: "short", kg: 60, ready_at: iso(2) },
  ],
  mine: {
    items: { fert_urea: 98 }, rice: { nep: { wet: 30, dry: 50 } }, coins: 1000, gift_claimed: true, owned_plot: 2, farming: [2, 6],
    my_offers: [{ id: "o1", plot: 4, price: 5000, expires_at: iso(20) }],
    incoming_offers: [{ id: "o2", plot: 2, buyer: LAN, price: 9000, expires_at: iso(10) }],
  },
})!;
const noop = () => {};

describe("FarmShopPanel", () => {
  it("sells by the quantity, within my coins and the 99 cap", () => {
    const onBuy = vi.fn();
    render(<FarmShopPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onBuy={onBuy} onReload={noop} onClose={noop} />);
    expect(screen.getByText("🌱 Giống lúa")).toBeInTheDocument();
    const seed = screen.getByText("Giống nếp").closest("li")!;
    expect(within(seed).getByText("Chín sau ~58 giờ · 75 kg/thửa · 18 xu/kg lúa khô")).toBeInTheDocument();
    fireEvent.click(within(seed).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(seed).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(seed).getByRole("button", { name: "Mua 3 · 270 xu" }));
    expect(onBuy).toHaveBeenCalledWith("seed_nep", 3);
    // 1000 xu buys 11 sacks of seed
    fireEvent.click(within(seed).getByRole("button", { name: "Tối đa" }));
    expect(within(seed).getByRole("button", { name: "Mua 11 · 990 xu" })).toBeInTheDocument();
    // 98 held: one more fits
    const urea = screen.getByText("Phân urê").closest("li")!;
    expect(within(urea).getByRole("button", { name: "Thêm" })).toBeDisabled();
  });
  it("says why nothing can be bought", () => {
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 50, items: { fert_urea: 99 } }} catalog={CATALOG} failed={false} busy={false} onBuy={noop} onReload={noop} onClose={noop} />);
    expect(within(screen.getByText("Phân urê").closest("li")!).getByRole("button", { name: "Đã đủ 99" })).toBeDisabled();
    expect(within(screen.getByText("Giống nếp").closest("li")!).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
  });
  it("offers a reload when the field failed", () => {
    const onReload = vi.fn();
    render(<FarmShopPanel mine={null} catalog={null} failed busy={false} onBuy={noop} onReload={onReload} onClose={noop} />);
    fireEvent.click(screen.getByRole("button", { name: "🔄 Tải lại" }));
    expect(onReload).toHaveBeenCalled();
  });
});

describe("RiceDepotPanel", () => {
  it("sells dry rice at the full price and wet rice at 70 %, some or all", () => {
    const onSell = vi.fn();
    render(<RiceDepotPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onSell={onSell} onReload={noop} onClose={noop} />);
    const dry = screen.getByText("Nếp khô · 50 kg").closest("li")!;
    fireEvent.click(within(dry).getByRole("button", { name: "Bán · 180 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("nep", true, 10);
    fireEvent.click(within(dry).getByRole("button", { name: "Bán hết · 900 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("nep", true, 50);
    const wet = screen.getByText("Nếp ướt · 30 kg").closest("li")!;
    fireEvent.click(within(wet).getByRole("button", { name: "Bán hết · 378 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("nep", false, 30);
    expect(screen.queryByText(/Lúa ngắn ngày/)).toBeNull();
  });
  it("has nothing to buy without rice", () => {
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={CATALOG} failed={false} busy={false} onSell={noop} onReload={noop} onClose={noop} />);
    expect(screen.queryByRole("button", { name: /Bán/ })).toBeNull();
  });
});

describe("DryingPanel", () => {
  it("shows every slot, collects my dry batch and starts a new one", () => {
    const onAct = vi.fn();
    render(<DryingPanel state={STATE} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    expect(screen.getByText("Lúa của Lan: 60 kg lúa ngắn ngày — còn 2 giờ")).toBeInTheDocument();
    expect(screen.getAllByText("Trống")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Lấy lúa" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "dry_collect", slot: 1 }, "Đã lấy 40 kg nếp khô.");
    fireEvent.click(screen.getByRole("button", { name: "Bớt" }));
    fireEvent.click(screen.getByRole("button", { name: "Phơi lúa" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "dry_start", variety: "nep", kg: 29 }, "Đang phơi 29 kg nếp — 3 giờ nữa là khô.");
  });
  it("says when the yard is full", () => {
    const full = { ...STATE, drying: [1, 2, 3, 4].map((slot) => ({ slot, owner: LAN, variety: "nep", kg: 10, readyAt: NOW + 3_600_000 })) };
    render(<DryingPanel state={full} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={noop} onReload={noop} onClose={noop} />);
    expect(screen.getByRole("button", { name: "Sân phơi đã đầy" })).toBeDisabled();
  });
});

describe("CoopPanel", () => {
  const renderCoop = (state = STATE) => {
    const onAct = vi.fn();
    render(<CoopPanel state={state} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    return onAct;
  };
  const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
  const line = (text: string | RegExp) => screen.getByText(text).closest("li")!;

  it("rents village plots, and says why not at the farming limit", () => {
    const onAct = renderCoop();
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Bạn có 1.000 xu · đang canh tác 2/2 thửa.")).toBeInTheDocument();
    expect(line("Thửa 5 · Lan đang thuê — còn 30 giờ")).toBeInTheDocument();
    expect(line("Thửa 6 · Bạn đang thuê — còn 5 giờ")).toBeInTheDocument();
    const free = line("Thửa 7 · Trống");
    expect(within(free).getByRole("button", { name: "Thuê · 250 xu" })).toBeDisabled();
    expect(within(free).getByText("Bạn đang canh tác 2 thửa rồi.")).toBeInTheDocument();
    cleanup();
    const relaxed = { ...STATE, plots: STATE.plots.map((p) => (p.no === 6 ? { ...p, farmer: null, lease: null } : p)) };
    const act2 = renderCoop(relaxed);
    fireEvent.click(within(line("Thửa 7 · Trống")).getByRole("button", { name: "Thuê · 250 xu" }));
    expect(act2).toHaveBeenCalledWith({ kind: "rent", plot: 7 }, "Đã thuê thửa 7 trong 4 ngày.");
    expect(onAct).not.toHaveBeenCalled();
  });

  it("lists the private plots and who owns them", () => {
    renderCoop();
    tab("Đất tư");
    expect(within(line("Thửa 1 · làng bán")).getByRole("button", { name: "Mua · 4.000 xu" })).toBeDisabled();
    expect(within(line("Thửa 1 · làng bán")).getByText("Bạn đã có đất tư trong phòng này.")).toBeInTheDocument();
    expect(screen.getByText(/Thửa 3 · của An · rao bán 8\.000 xu · cho thuê 300 xu\/vụ/)).toBeInTheDocument();
  });

  it("buys a listing after asking, rents a sublease and sends an offer", () => {
    const relaxed = { ...STATE, plots: STATE.plots.map((p) => (p.no === 2 ? { ...p, owner: null, farmer: null } : p.no === 6 ? { ...p, farmer: null, lease: null } : p)) };
    const onAct = renderCoop({ ...relaxed, mine: { ...relaxed.mine, coins: 9000 } });
    tab("Chợ đất");
    fireEvent.click(within(line("Thửa 3 của An — bán 8.000 xu")).getByRole("button", { name: "Mua" }));
    expect(onAct).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "buy_listed", plot: 3, expected: 8000 }, "🏡 Đã mua thửa 3.");
    fireEvent.click(within(line("Thửa 3 của An — cho thuê một vụ 300 xu")).getByRole("button", { name: "Thuê" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "rent_sublease", plot: 3, expected: 300 }, "Đã thuê thửa 3 của An một vụ.");
    fireEvent.click(screen.getByRole("button", { name: "Thửa 4 (Lan)" }));
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "6000" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi đề nghị" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "offer", plot: 4, price: 6000 }, "Đã gửi đề nghị mua thửa 4 giá 6.000 xu.");
  });

  it("manages my plot and the offers", () => {
    const onAct = renderCoop();
    tab("Của tôi");
    // nothing typed yet: the buttons wait without complaining
    expect(screen.getByRole("button", { name: "Rao bán" })).toBeDisabled();
    expect(screen.queryByText("Số không hợp lệ.")).toBeNull();
    fireEvent.change(screen.getByLabelText("Rao bán"), { target: { value: "12000" } });
    fireEvent.click(screen.getByRole("button", { name: "Rao bán" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "list", plot: 2, price: 12000 }, "Đã rao bán thửa 2 giá 12.000 xu.");
    fireEvent.change(screen.getByLabelText("Cho thuê một vụ"), { target: { value: "6000" } });
    expect(screen.getByRole("button", { name: "Cho thuê" })).toBeDisabled();
    expect(screen.getByText("Số không hợp lệ.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bán lại cho làng · 2.000 xu" }));
    expect(screen.getByText("⚠️ Làng chỉ trả 2.000 xu (một nửa giá) — bán lại thửa 2?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "sell_back", plot: 2 }, "Đã bán lại thửa 2 cho làng — nhận 2.000 xu.");
    const offer = line("Lan trả 9.000 xu cho thửa 2 — còn 10 giờ");
    fireEvent.click(within(offer).getByRole("button", { name: "Từ chối" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "decline_offer", offer: "o2" }, "Đã từ chối đề nghị.");
    fireEvent.click(within(offer).getByRole("button", { name: "Đồng ý" }));
    fireEvent.click(within(offer).getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "accept_offer", offer: "o2" }, "Đã bán thửa 2 — nhận 9.000 xu.");
    fireEvent.click(within(line("Thửa 4 giá 5.000 xu — còn 20 giờ")).getByRole("button", { name: "Rút" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "withdraw_offer", offer: "o1" }, "Đã rút đề nghị.");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/unit/farm-panels.test.tsx`
Expected: FAIL — the components do not exist.

- [ ] **Step 3: Write the small building blocks**

Create `components/game/farm/FieldStatus.tsx`:

```tsx
"use client";

import { FIELD_FAILED, FIELD_LOADING } from "@/lib/game/farm/messages";

/** What a field panel shows before the field has loaded: the loading line, or the failure with a reload button. */
export default function FieldStatus({ failed, onReload }: { failed: boolean; onReload: () => void }) {
  if (!failed) return <p>{FIELD_LOADING}</p>;
  return (
    <div className="flex flex-col items-start gap-1">
      <p>{FIELD_FAILED}</p>
      <button type="button" className="pch-btn" onClick={onReload}>🔄 Tải lại</button>
    </div>
  );
}
```

Create `components/game/farm/Stepper.tsx`:

```tsx
"use client";

/** − n + and "Tối đa" for a quantity in [min, max]. */
export default function Stepper({ value, min = 1, max, label, unit = "", onChange }: {
  value: number;
  min?: number;
  max: number;
  /** What is counted, for screen readers ("Số lượng Phân urê"). */
  label: string;
  unit?: string;
  onChange: (n: number) => void;
}) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="pch-btn px-2" onClick={() => step(-1)} disabled={value <= min} aria-label="Bớt">−</button>
      <span className="min-w-12 text-center" aria-live="polite">{value}{unit}</span>
      <button type="button" className="pch-btn px-2" onClick={() => step(1)} disabled={value >= max} aria-label="Thêm">+</button>
      <button type="button" className="pch-btn text-base" onClick={() => onChange(max)} disabled={value >= max}>Tối đa</button>
    </div>
  );
}
```

Create `components/game/farm/ConfirmButton.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";

/** A button that asks first when `warn` is set: the warning, then "Vẫn làm" / "Thôi". */
export default function ConfirmButton({ warn, disabled, primary, onConfirm, children }: {
  warn?: string;
  disabled?: boolean;
  primary?: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span className="text-base text-burgundy">⚠️ {warn}</span>
        <div className="flex gap-1">
          <button type="button" className="pch-btn pch-btn-primary" disabled={disabled} onClick={() => { setAsking(false); onConfirm(); }}>
            Vẫn làm
          </button>
          <button type="button" className="pch-btn" onClick={() => setAsking(false)}>Thôi</button>
        </div>
      </div>
    );
  }
  return (
    <button type="button" className={`pch-btn ${primary ? "pch-btn-primary" : ""}`} disabled={disabled} onClick={() => (warn ? setAsking(true) : onConfirm())}>
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Write the four panels**

Create `components/game/farm/CoopPanel.tsx`:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { FARM_LIMIT, LEASE_HOURS, PLOT_PRICE, RENT_PRICE, SALE_MAX, SELL_BACK_PRICE, SUBLEASE_MAX } from "@/lib/game/farm/catalog";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, listRefusal, offerRefusal, reasonText, rentRefusal,
  rentSubleaseRefusal, sellBackRefusal, subleaseRefusal, type LandCtx,
} from "@/lib/game/farm/land";
import { durationText } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import ConfirmButton from "./ConfirmButton";
import FieldStatus from "./FieldStatus";

type Tab = "village" | "private" | "market" | "mine";
const TABS: ReadonlyArray<[Tab, string]> = [["village", "Đất làng"], ["private", "Đất tư"], ["market", "Chợ đất"], ["mine", "Của tôi"]];

type Act = (a: FieldAction, done?: string) => void;

/** A land button: disabled with the reason when the rules refuse it ("" = disabled, nothing to say yet); `warn` asks
 *  first. */
export function LandButton({ refusal, busy, warn, primary, onClick, children }: {
  refusal: string | null;
  busy: boolean;
  warn?: string;
  primary?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <ConfirmButton warn={warn} primary={primary} disabled={busy || refusal !== null} onConfirm={onClick}>{children}</ConfirmButton>
      {refusal && <span className="text-sm opacity-80">{reasonText(refusal)}</span>}
    </div>
  );
}

function Line({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/20 py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </li>
  );
}

/** A whole-xu price field. */
function PriceInput({ label, max, value, onChange }: { label: string; max: number; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span>{label}</span>
      <input
        type="number" inputMode="numeric" min={1} max={max} step={1} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded-sm border border-ink/40 bg-parchment px-1 text-right"
      />
      <span>xu</span>
    </label>
  );
}
const toPrice = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
/** A price field's refusal: nothing typed yet → "" (quietly disabled), not a whole number → invalid price. */
const priceRefusal = (s: string, check: (price: number) => string | null): string | null =>
  s.trim() === "" ? "" : Number.isNaN(toPrice(s)) ? "invalid price" : check(toPrice(s));

const who = (p: PlotView, me: string) => (p.farmer?.id === me ? "Bạn" : p.farmer?.name ?? "Có người");

function VillageTab({ ctx, busy, now, onAct }: { ctx: LandCtx; busy: boolean; now: number; onAct: Act }) {
  return (
    <>
      <p className="opacity-80">Thuê {formatXu(RENT_PRICE)} một vụ {LEASE_HOURS / 24} ngày — gặt xong là trả ruộng.</p>
      <ul>
        {ctx.plots.filter((p) => p.kind === "village").map((p) => (
          <Line key={p.no} action={!p.lease && (
            <LandButton refusal={rentRefusal(p, ctx)} busy={busy} primary
              onClick={() => onAct({ kind: "rent", plot: p.no }, `Đã thuê thửa ${p.no} trong ${LEASE_HOURS / 24} ngày.`)}>
              Thuê · {formatXu(RENT_PRICE)}
            </LandButton>
          )}>
            Thửa {p.no} · {p.lease ? `${who(p, ctx.me)} đang thuê — còn ${durationText(p.lease.until - now)}` : "Trống"}
          </Line>
        ))}
      </ul>
    </>
  );
}

function PrivateTab({ ctx, busy, onAct }: { ctx: LandCtx; busy: boolean; onAct: Act }) {
  return (
    <>
      <p className="opacity-80">Đất tư được thêm 10% lúa, không tốn tiền thuê; mỗi người một thửa trong phòng.</p>
      <ul>
        {ctx.plots.filter((p) => p.kind === "private").map((p) => (
          <Line key={p.no} action={!p.owner && (
            <LandButton refusal={buyPlotRefusal(p, ctx)} busy={busy} primary
              warn={`Mua thửa ${p.no} với giá ${formatXu(PLOT_PRICE)}?`}
              onClick={() => onAct({ kind: "buy_plot", plot: p.no }, `🏡 Đã mua thửa ${p.no}.`)}>
              Mua · {formatXu(PLOT_PRICE)}
            </LandButton>
          )}>
            Thửa {p.no} · {p.owner ? (
              <>
                của {p.owner.id === ctx.me ? "bạn" : p.owner.name}
                {p.salePrice !== null && ` · rao bán ${formatXu(p.salePrice)}`}
                {p.subleasePrice !== null && ` · cho thuê ${formatXu(p.subleasePrice)}/vụ`}
                {p.lease && ` · ${who(p, ctx.me)} đang thuê`}
              </>
            ) : "làng bán"}
          </Line>
        ))}
      </ul>
    </>
  );
}

function MarketTab({ ctx, busy, onAct }: { ctx: LandCtx; busy: boolean; onAct: Act }) {
  const others = ctx.plots.filter((p) => p.owner && p.owner.id !== ctx.me);
  const listed = others.filter((p) => p.salePrice !== null);
  const subleased = others.filter((p) => p.subleasePrice !== null);
  const [target, setTarget] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const offerPlot = others.find((p) => p.no === target) ?? others[0] ?? null;
  const offer = toPrice(price);
  return (
    <>
      {listed.length + subleased.length === 0 && <p className="opacity-80">Chưa ai rao bán hay cho thuê đất.</p>}
      <ul>
        {listed.map((p) => (
          <Line key={`sale:${p.no}`} action={
            <LandButton refusal={buyListedRefusal(p, ctx)} busy={busy} primary
              warn={`Mua thửa ${p.no} của ${p.owner!.name} với giá ${formatXu(p.salePrice!)}?`}
              onClick={() => onAct({ kind: "buy_listed", plot: p.no, expected: p.salePrice! }, `🏡 Đã mua thửa ${p.no}.`)}>
              Mua
            </LandButton>
          }>
            Thửa {p.no} của {p.owner!.name} — bán {formatXu(p.salePrice!)}
          </Line>
        ))}
        {subleased.map((p) => (
          <Line key={`lease:${p.no}`} action={
            <LandButton refusal={rentSubleaseRefusal(p, ctx)} busy={busy} primary
              onClick={() => onAct({ kind: "rent_sublease", plot: p.no, expected: p.subleasePrice! }, `Đã thuê thửa ${p.no} của ${p.owner!.name} một vụ.`)}>
              Thuê
            </LandButton>
          }>
            Thửa {p.no} của {p.owner!.name} — cho thuê một vụ {formatXu(p.subleasePrice!)}
          </Line>
        ))}
      </ul>
      {offerPlot && (
        <section className="pch flex flex-col gap-1 p-2">
          <h3 className="text-xl text-burgundy">Đề nghị mua</h3>
          <p className="text-base opacity-80">Trả giá đất tư của người khác; chủ đất đồng ý thì mới thành. Đề nghị có hạn 24 giờ.</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Thửa muốn mua">
            {others.map((p) => (
              <button key={p.no} type="button" className="pch-btn text-base" aria-pressed={offerPlot.no === p.no} onClick={() => setTarget(p.no)}>
                Thửa {p.no} ({p.owner!.name})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <PriceInput label="Giá" max={SALE_MAX} value={price} onChange={setPrice} />
            <LandButton refusal={priceRefusal(price, (x) => offerRefusal(offerPlot, ctx, x))} busy={busy} primary
              onClick={() => onAct({ kind: "offer", plot: offerPlot.no, price: offer }, `Đã gửi đề nghị mua thửa ${offerPlot.no} giá ${formatXu(offer)}.`)}>
              Gửi đề nghị
            </LandButton>
          </div>
        </section>
      )}
    </>
  );
}

/** The owner's land actions on their plot: list it for sale, sublease it, sell it back (also on the plot panel). */
export function MyPlot({ p, ctx, busy, onAct }: { p: PlotView; ctx: LandCtx; busy: boolean; onAct: Act }) {
  const [sale, setSale] = useState("");
  const [lease, setLease] = useState("");
  const salePrice = toPrice(sale), leasePrice = toPrice(lease);
  return (
    <section className="pch flex flex-col gap-2 p-2">
      <h3 className="text-xl text-burgundy">Thửa {p.no} — đất tư của bạn</h3>
      {p.salePrice !== null ? (
        <Line action={
          <LandButton refusal={listRefusal(p, ctx, null)} busy={busy} onClick={() => onAct({ kind: "list", plot: p.no, price: null }, "Đã thôi rao bán.")}>
            Thôi rao bán
          </LandButton>
        }>Đang rao bán {formatXu(p.salePrice)}</Line>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <PriceInput label="Rao bán" max={SALE_MAX} value={sale} onChange={setSale} />
          <LandButton refusal={priceRefusal(sale, (x) => listRefusal(p, ctx, x))} busy={busy}
            onClick={() => onAct({ kind: "list", plot: p.no, price: salePrice }, `Đã rao bán thửa ${p.no} giá ${formatXu(salePrice)}.`)}>
            Rao bán
          </LandButton>
        </div>
      )}
      {p.subleasePrice !== null ? (
        <Line action={
          <LandButton refusal={subleaseRefusal(p, ctx, null)} busy={busy} onClick={() => onAct({ kind: "set_sublease", plot: p.no, price: null }, "Đã thôi cho thuê.")}>
            Thôi cho thuê
          </LandButton>
        }>Đang cho thuê một vụ {formatXu(p.subleasePrice)}</Line>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <PriceInput label="Cho thuê một vụ" max={SUBLEASE_MAX} value={lease} onChange={setLease} />
          <LandButton refusal={priceRefusal(lease, (x) => subleaseRefusal(p, ctx, x))} busy={busy}
            onClick={() => onAct({ kind: "set_sublease", plot: p.no, price: leasePrice }, `Đã cho thuê thửa ${p.no} giá ${formatXu(leasePrice)} một vụ.`)}>
            Cho thuê
          </LandButton>
        </div>
      )}
      {p.lease && p.farmer && p.farmer.id !== ctx.me && <p>{p.farmer.name} đang thuê thửa này.</p>}
      <LandButton refusal={sellBackRefusal(p, ctx)} busy={busy}
        warn={`Làng chỉ trả ${formatXu(SELL_BACK_PRICE)} (một nửa giá) — bán lại thửa ${p.no}?`}
        onClick={() => onAct({ kind: "sell_back", plot: p.no }, `Đã bán lại thửa ${p.no} cho làng — nhận ${formatXu(SELL_BACK_PRICE)}.`)}>
        Bán lại cho làng · {formatXu(SELL_BACK_PRICE)}
      </LandButton>
    </section>
  );
}

function MineTab({ ctx, state, busy, now, onAct }: { ctx: LandCtx; state: FieldState; busy: boolean; now: number; onAct: Act }) {
  const owned = ctx.plots.find((p) => p.owner?.id === ctx.me) ?? null;
  const leases = ctx.plots.filter((p) => p.lease && p.farmer?.id === ctx.me);
  const { incomingOffers, myOffers } = state.mine;
  return (
    <>
      {owned ? <MyPlot p={owned} ctx={ctx} busy={busy} onAct={onAct} /> : <p className="opacity-80">Bạn chưa có đất tư — mua ở thẻ Đất tư hoặc Chợ đất.</p>}
      {leases.length > 0 && (
        <ul>
          {leases.map((p) => <Line key={p.no}>Thửa {p.no} · bạn thuê — còn {durationText(p.lease!.until - now)}</Line>)}
        </ul>
      )}
      {incomingOffers.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xl text-burgundy">Người muốn mua đất của bạn</h3>
          <ul>
            {incomingOffers.map((o) => (
              <Line key={o.id} action={
                <div className="flex flex-wrap items-start gap-1">
                  <LandButton refusal={acceptRefusal(o, ctx)} busy={busy} primary
                    warn={`Bán thửa ${o.plot} cho ${o.buyer?.name ?? "người này"} lấy ${formatXu(o.price)}?`}
                    onClick={() => onAct({ kind: "accept_offer", offer: o.id }, `Đã bán thửa ${o.plot} — nhận ${formatXu(o.price)}.`)}>
                    Đồng ý
                  </LandButton>
                  <LandButton refusal={null} busy={busy} onClick={() => onAct({ kind: "decline_offer", offer: o.id }, "Đã từ chối đề nghị.")}>
                    Từ chối
                  </LandButton>
                </div>
              }>
                {o.buyer?.name ?? "Ai đó"} trả {formatXu(o.price)} cho thửa {o.plot} — còn {durationText(o.expiresAt - now)}
              </Line>
            ))}
          </ul>
        </section>
      )}
      {myOffers.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xl text-burgundy">Đề nghị của bạn</h3>
          <ul>
            {myOffers.map((o) => (
              <Line key={o.id} action={
                <LandButton refusal={null} busy={busy} onClick={() => onAct({ kind: "withdraw_offer", offer: o.id }, "Đã rút đề nghị.")}>Rút</LandButton>
              }>
                Thửa {o.plot} giá {formatXu(o.price)} — còn {durationText(o.expiresAt - now)}
              </Line>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** 🏛️ Hợp tác xã · chú Tám (spec §7, §13.3): rent village plots, buy private ones, the land market and my land. */
export default function CoopPanel({ state, failed, me, busy, now, onAct, onReload, onClose }: {
  state: FieldState | null;
  failed: boolean;
  me: string;
  busy: boolean;
  now: number;
  onAct: Act;
  onReload: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("village");
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
  return (
    <ParchmentModal title="🏛️ Hợp tác xã · chú Tám" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Hợp tác xã" className="flex flex-wrap gap-1">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {!state || !ctx ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <div role="tabpanel" className="flex flex-col gap-2">
            <p>Bạn có <b>{formatXu(state.mine.coins)}</b> · đang canh tác {farmingCount(ctx)}/{FARM_LIMIT} thửa.</p>
            {tab === "village" && <VillageTab ctx={ctx} busy={busy} now={now} onAct={onAct} />}
            {tab === "private" && <PrivateTab ctx={ctx} busy={busy} onAct={onAct} />}
            {tab === "market" && <MarketTab ctx={ctx} busy={busy} onAct={onAct} />}
            {tab === "mine" && <MineTab ctx={ctx} state={state} busy={busy} now={now} onAct={onAct} />}
          </div>
        )}
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/farm/FarmShopPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { describeFarmItem, ITEM_CAP, type FarmCatalog, type FarmItem, type FarmItemKind } from "@/lib/game/farm/catalog";
import { itemCount, type FarmMine } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import FieldStatus from "./FieldStatus";
import Stepper from "./Stepper";

const SECTIONS: ReadonlyArray<[FarmItemKind, string]> = [["seed", "🌱 Giống lúa"], ["fertilizer", "🧺 Phân bón"], ["pesticide", "🧴 Thuốc"]];

/** One row: icon, name, price, its use in one line, what I hold, the quantity and the buy button. */
function Row({ item, mine, catalog, busy, onBuy }: {
  item: FarmItem;
  mine: FarmMine;
  catalog: FarmCatalog;
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
}) {
  const price = item.price ?? 0;
  const held = itemCount(mine, item.id);
  const max = Math.min(ITEM_CAP - held, Math.floor(mine.coins / Math.max(1, price)));
  const [qty, setQty] = useState(1);
  const n = Math.min(qty, Math.max(1, max));
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{formatXu(price)} · có {held}</span>
        </div>
      </div>
      <p className="text-base leading-tight opacity-80">{describeFarmItem(item, catalog.varieties)}</p>
      {max < 1 ? (
        <button type="button" className="pch-btn" disabled>{held >= ITEM_CAP ? `Đã đủ ${ITEM_CAP}` : "Không đủ xu"}</button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <Stepper value={n} max={max} label={`Số lượng ${item.name}`} onChange={setQty} />
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, n)}>
            Mua {n} · {formatXu(price * n)}
          </button>
        </div>
      )}
    </li>
  );
}

/** 🧺 Tiệm vật tư · anh Hai (spec §9, §13.3): seeds, fertilizers and pesticides, bought by the quantity. */
export default function FarmShopPanel({ mine, catalog, failed, busy, onBuy, onReload, onClose }: {
  mine: FarmMine | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  return (
    <ParchmentModal title="🧺 Tiệm vật tư · anh Hai" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!mine || !catalog ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            <p>Bạn có <b>{formatXu(mine.coins)}</b>. “Cần gì cứ lấy, anh chỉ cách dùng luôn!”</p>
            {SECTIONS.map(([kind, title]) => {
              const items = catalog.items.filter((i) => i.kind === kind && i.price !== null).sort((a, b) => a.sortOrder - b.sortOrder);
              if (items.length === 0) return null;
              return (
                <section key={kind} className="flex flex-col gap-1">
                  <h3 className="text-xl text-burgundy">{title}</h3>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map((i) => <Row key={i.id} item={i} mine={mine} catalog={catalog} busy={busy} onBuy={onBuy} />)}
                  </ul>
                </section>
              );
            })}
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/farm/RiceDepotPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { ricePrice, type FarmCatalog, type Variety } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import FieldStatus from "./FieldStatus";
import Stepper from "./Stepper";

/** One stock line: a variety, wet or dry, with "Bán" for the chosen kg and "Bán hết". */
function StockRow({ v, dry, kg, busy, onSell }: { v: Variety; dry: boolean; kg: number; busy: boolean; onSell: (variety: string, dry: boolean, kg: number) => void }) {
  const [amount, setAmount] = useState(Math.min(10, kg));
  const n = Math.min(Math.max(1, amount), kg);
  const perKg = dry ? v.pricePerKg : ricePrice(10, v.pricePerKg, false) / 10;
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={dry ? "rice_dry" : "rice_wet"} scale={3} />
        <div className="flex flex-col leading-none">
          <span className="text-xl">{v.name} {dry ? "khô" : "ướt"} · {kg} kg</span>
          <span className="text-base">{perKg.toLocaleString("vi-VN")} xu/kg{dry ? "" : " (lúa ướt 70%)"}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Stepper value={n} max={kg} label={`Số kg ${v.name} ${dry ? "khô" : "ướt"}`} unit=" kg" onChange={setAmount} />
        <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell(v.id, dry, n)}>
          Bán · {formatXu(ricePrice(n, v.pricePerKg, dry))}
        </button>
      </div>
      <button type="button" className="pch-btn pch-btn-primary self-end" disabled={busy} onClick={() => onSell(v.id, dry, kg)}>
        Bán hết · {formatXu(ricePrice(kg, v.pricePerKg, dry))}
      </button>
    </li>
  );
}

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3): sell wet or dry rice per variety; dry rice pays the full price. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onReload, onClose }: {
  mine: FarmMine | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  busy: boolean;
  onSell: (variety: string, dry: boolean, kg: number) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const lines = (catalog?.varieties ?? []).flatMap((v) => {
    const stock = mine?.rice[v.id];
    return [
      ...(stock && stock.dry > 0 ? [{ v, dry: true, kg: stock.dry }] : []),
      ...(stock && stock.wet > 0 ? [{ v, dry: false, kg: stock.wet }] : []),
    ];
  });
  return (
    <ParchmentModal title="🌾 Vựa lúa · cô Út" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!mine || !catalog ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : lines.length === 0 ? (
          <p>“Chưa có lúa hả con? Gặt xong đem phơi cho khô rồi mang qua, cô trả giá cao!”</p>
        ) : (
          <>
            <p>“Lúa phơi khô cô trả đủ giá, lúa ướt chỉ được bảy phần.”</p>
            <ul className="flex flex-col gap-2">
              {lines.map((l) => <StockRow key={`${l.v.id}:${l.dry}`} {...l} busy={busy} onSell={onSell} />)}
            </ul>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/farm/DryingPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { DRY_HOURS, DRYING_SLOTS, type FarmCatalog } from "@/lib/game/farm/catalog";
import { durationText } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import type { FieldState } from "@/lib/game/farm/state";
import FieldStatus from "./FieldStatus";
import Stepper from "./Stepper";

/** ☀️ Sân phơi lúa (spec §8.7): the 4 slots for everyone to see, "Phơi lúa" (variety + kg) and "Lấy lúa". */
export default function DryingPanel({ state, catalog, failed, me, busy, now, onAct, onReload, onClose }: {
  state: FieldState | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  me: string;
  busy: boolean;
  now: number;
  onAct: (a: FieldAction, done?: string) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const wet = (catalog?.varieties ?? []).filter((v) => (state?.mine.rice[v.id]?.wet ?? 0) > 0);
  const [variety, setVariety] = useState<string | null>(null);
  const chosen = wet.find((v) => v.id === variety) ?? wet[0] ?? null;
  const stock = chosen ? state?.mine.rice[chosen.id]?.wet ?? 0 : 0;
  const [kg, setKg] = useState<number | null>(null);
  const n = Math.min(Math.max(1, kg ?? stock), stock);
  const name = (id: string) => catalog?.varieties.find((v) => v.id === id)?.name ?? id;
  const full = (state?.drying.length ?? 0) >= DRYING_SLOTS;
  return (
    <ParchmentModal title="☀️ Sân phơi lúa" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!state ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-2">
              {Array.from({ length: DRYING_SLOTS }, (_, i) => i + 1).map((slot) => {
                const d = state.drying.find((x) => x.slot === slot);
                const mineReady = d && d.owner?.id === me && d.readyAt <= now;
                return (
                  <li key={slot} className="pch flex flex-col gap-1 p-2">
                    <span className="text-xl">Ô {slot}</span>
                    {!d ? (
                      <span className="opacity-80">Trống</span>
                    ) : (
                      <span>
                        {d.owner?.id === me ? "Lúa của bạn" : `Lúa của ${d.owner?.name ?? "ai đó"}`}: {d.kg} kg {name(d.variety).toLowerCase()}
                        {" — "}{d.readyAt <= now ? "đã khô" : `còn ${durationText(d.readyAt - now)}`}
                      </span>
                    )}
                    {mineReady && (
                      <button type="button" className="pch-btn pch-btn-primary" disabled={busy}
                        onClick={() => onAct({ kind: "dry_collect", slot }, `Đã lấy ${d.kg} kg ${name(d.variety).toLowerCase()} khô.`)}>
                        Lấy lúa
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {wet.length === 0 ? (
              <p>Bạn chưa có lúa ướt để phơi — gặt lúa trước đã.</p>
            ) : (
              <section className="pch flex flex-col gap-1 p-2">
                <h3 className="text-xl text-burgundy">Phơi lúa ({DRY_HOURS} giờ là khô)</h3>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Giống lúa">
                  {wet.map((v) => (
                    <button key={v.id} type="button" className="pch-btn text-base" aria-pressed={chosen?.id === v.id} onClick={() => { setVariety(v.id); setKg(null); }}>
                      {v.name} ({state.mine.rice[v.id].wet} kg)
                    </button>
                  ))}
                </div>
                {chosen && (
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <Stepper value={n} max={stock} label={`Số kg ${chosen.name}`} unit=" kg" onChange={setKg} />
                    <button type="button" className="pch-btn pch-btn-primary" disabled={busy || full}
                      onClick={() => onAct({ kind: "dry_start", variety: chosen.id, kg: n }, `Đang phơi ${n} kg ${chosen.name.toLowerCase()} — ${DRY_HOURS} giờ nữa là khô.`)}>
                      {full ? "Sân phơi đã đầy" : "Phơi lúa"}
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
```

- [ ] **Step 5: Run the test**

Run: `pnpm vitest run tests/unit/farm-panels.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint components/game/farm tests/unit/farm-panels.test.tsx` (clean).

```bash
git add components/game/farm tests/unit/farm-panels.test.tsx
git commit -m "feat(v15): co-op, farm shop, rice depot and drying yard panels

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: The plot panel, the handbook and the task list

**Files:**
- Create: `lib/game/farm/handbook.ts` (Sổ tay nhà nông)
- Create: `components/game/farm/PlotPanel.tsx`, `components/game/farm/Handbook.tsx`, `components/game/farm/FarmTasks.tsx`
- Test: `tests/unit/farm-handbook.test.ts`, `tests/unit/farm-plot-panel.test.tsx` (new)

**Interfaces:**
- Consumes: `plotActions`, `PlotRun` (Task 7), the crop model (Task 5), land rules (Task 7), `LandButton` / `MyPlot` / `ConfirmButton` / `FieldStatus` (Task 15), the texts (Task 6).
- Produces (`@/lib/game/farm/handbook`): `HandbookTab = "process" | "fertilizer" | "pests" | "water" | "varieties" | "tips"`, `HANDBOOK_TABS` (Quy trình, Phân bón, Sâu bệnh, Nước, Giống lúa, Mẹo), `HandbookSection { title, lines }`, `handbookPage(tab, varieties)` (the 11 steps, and hour marks per variety), `handbookTabFor(crop, v, now)` (pests → `pests`; tillering / panicle → `fertilizer`; else `process`).
- Produces: `PlotPanel({ no, state, catalog, failed, me, busy, now, onAct: (a: PlotRun, done?) => void, onOpenHandbook: (tab: HandbookTab) => void, onReload, onClose })` (status: variety, phase and time to the next, water now vs wanted, pests with their remedy, excess N, a rotted seed, the farmer's estimate; the actions with why / hint / warn; the land for this plot; "📖 Sổ tay: …"); `Handbook({ varieties, initial: string | null, onClose })`; `FarmTasksButton({ urgent, onClick })` (a dot counts urgent tasks) and default `FarmTasksPanel({ tasks, farming, onOpenHandbook, onClose })`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-handbook.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookPage, handbookTabFor } from "@/lib/game/farm/handbook";
import type { CropView } from "@/lib/game/farm/state";

const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const thom = varietyFromRow({ id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 26, blast_mult: 1.3, sort_order: 30 });
const t0 = Date.parse("2026-09-25T00:00:00Z");
const at = (h: number) => t0 + h * HOUR_MS;

describe("handbook", () => {
  it("has the six tabs of spec §8.9, each with something to read", () => {
    expect(HANDBOOK_TABS.map(([, label]) => label)).toEqual(["Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo"]);
    for (const [tab] of HANDBOOK_TABS) {
      const page = handbookPage(tab, [nep, thom]);
      expect(page.length, tab).toBeGreaterThan(0);
      for (const sec of page) expect(sec.lines.length, `${tab}: ${sec.title}`).toBeGreaterThan(0);
    }
  });
  it("gives the 11 steps and the hour marks per variety", () => {
    const [steps, marks] = handbookPage("process", [nep, thom]);
    expect(steps.lines).toHaveLength(11);
    expect(marks.lines).toEqual([
      "Nếp: cấy khi mạ 8–14 giờ tuổi · bón thúc 2–10 giờ sau cấy · phơi ruộng 14–18 · đón đòng 18–24 · rút nước từ 40 · chín 48 giờ sau cấy (~58 giờ từ lúc ngâm).",
      "Lúa thơm: cấy khi mạ 9–16 giờ tuổi · bón thúc 2–12 giờ sau cấy · phơi ruộng 16–21 · đón đòng 21–28 · rút nước từ 46 · chín 55 giờ sau cấy (~66 giờ từ lúc ngâm).",
    ]);
    expect(handbookPage("varieties", [thom])[0].lines).toEqual(["Lúa thơm: chín ~66 giờ · 60 kg mỗi thửa · 26 xu/kg lúa khô · dễ bị đạo ôn"]);
  });
  it("links the plot panel to what matters now", () => {
    const crop = (over: Partial<CropView>): CropView => ({
      variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12), water: 2, waterSetAt: at(12),
      pests: [], excessN: false, ripe: false, rottedAt: null, log: null, ...over,
    });
    expect(handbookTabFor(null, null, at(0))).toBe("process");
    expect(handbookTabFor(crop({ transplantAt: null }), nep, at(5))).toBe("process");
    expect(handbookTabFor(crop({}), nep, at(16))).toBe("fertilizer");
    expect(handbookTabFor(crop({ pests: [{ kind: "hopper", since: at(15), treatedAt: null }] }), nep, at(16))).toBe("pests");
    expect(handbookTabFor(crop({}), nep, at(12 + 45))).toBe("process");
  });
});
```

Create `tests/unit/farm-plot-panel.test.tsx`:

```tsx
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FarmTasksPanel, { FarmTasksButton } from "@/components/game/farm/FarmTasks";
import Handbook from "@/components/game/farm/Handbook";
import PlotPanel from "@/components/game/farm/PlotPanel";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const item = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price: 50, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG: FarmCatalog = {
  varieties: [nep],
  items: [
    item("seed_nep", "seed", "Giống nếp", { variety: "nep" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", { fert: "manure" }),
    item("fert_urea", "fertilizer", "Phân urê", { fert: "urea" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", { pest_target: "hopper" }),
  ],
};
const bare = (no: number, kind: "private" | "village", over: Record<string, unknown> = {}) => ({
  no, kind, owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});
/** Plot 5: my nếp, transplanted 8 h ago, shallow water, planthoppers; 6: Lan's with snails; 7: free; 2: mine, bare. */
const STATE: FieldState = parseFieldState({
  server_now: iso(0),
  plots: [
    bare(1, "private"),
    bare(2, "private", { owner: ME, farmer: ME }),
    bare(5, "village", {
      farmer: ME, lease: { source: "village", until: iso(80), price: 250 },
      crop: {
        variety: "nep", phase: "tillering", prepared_at: iso(-20), soak_at: iso(-20), sow_at: iso(-17), transplant_at: iso(-8),
        water: 2, water_set_at: iso(-8), pests: [{ kind: "hopper", since: iso(-1), treated_at: null }], excess_n: false, ripe: false,
        rotted_at: null,
        log: { water: [{ t: iso(-20), l: 3 }, { t: iso(-8), l: 2 }], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
    }),
    bare(6, "village", {
      farmer: LAN, lease: { source: "village", until: iso(50), price: 250 },
      crop: {
        variety: "nep", phase: "tillering", prepared_at: iso(-20), soak_at: iso(-20), sow_at: iso(-17), transplant_at: iso(-8),
        water: 3, water_set_at: iso(-8), pests: [{ kind: "snail", since: iso(-2), treated_at: null }], excess_n: false, ripe: false, rotted_at: null,
      },
    }),
    bare(7, "village"),
  ],
  drying: [],
  mine: {
    items: { spray_hopper: 1, fert_urea: 1, fert_manure: 1, seed_nep: 1 }, rice: {}, coins: 1000, gift_claimed: true, owned_plot: 2,
    farming: [2, 5], my_offers: [], incoming_offers: [],
  },
})!;

function renderPlot(no: number) {
  const onAct = vi.fn(), onOpenHandbook = vi.fn();
  render(<PlotPanel no={no} state={STATE} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
    onOpenHandbook={onOpenHandbook} onReload={() => {}} onClose={() => {}} />);
  return { onAct, onOpenHandbook };
}

describe("PlotPanel", () => {
  it("shows my crop's status and estimate, and the jobs with their hints", () => {
    const { onAct, onOpenHandbook } = renderPlot(5);
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "🌱 Nếp · Đẻ nhánh — giai đoạn sau: còn 10 giờ")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "💧 Nước: Nông · cần Nông")).toBeInTheDocument();
    expect(screen.getByText("❗ Rầy nâu — Thuốc trừ rầy")).toBeInTheDocument();
    expect(screen.getByText(/^⚖️ Ước tính: ~\d+ kg/)).toBeInTheDocument();
    expect(screen.getByText("Trị rầy nâu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xịt thuốc trừ rầy" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "spray", plot: 5, item: "spray_hopper" }, "Đã xịt thuốc trừ rầy.");
    expect(screen.getByText("Đúng lúc bón thúc đẻ nhánh.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bơm nước (lên Sâu)" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "water", plot: 5, delta: 1 }, undefined);
    // manure after transplanting is wasted: asked first
    fireEvent.click(screen.getByRole("button", { name: "Bón phân chuồng hoai" }));
    expect(screen.getByText("⚠️ Đã cấy — bón lót bây giờ là phí.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "fertilize", plot: 5, item: "fert_manure" }, "Đã bón phân chuồng hoai.");
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Sâu bệnh" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("pests");
  });

  it("lets a neighbour only pick the snails, with no estimate", () => {
    const { onAct } = renderPlot(6);
    expect(screen.getByText("Đất làng · người làm: Lan (thuê — còn 2 ngày 2 giờ)")).toBeInTheDocument();
    expect(screen.queryByText(/Ước tính/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bắt ốc bươu vàng" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng.");
    expect(screen.queryByRole("button", { name: /Bơm nước/ })).toBeNull();
  });

  it("offers a free plot's land and my own plot's land actions", () => {
    const { onAct } = renderPlot(7);
    expect(screen.getByText("Ruộng còn gốc rạ — chưa làm đất.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thuê · 250 xu" })).toBeDisabled();
    expect(screen.getByText("Bạn đang canh tác 2 thửa rồi.")).toBeInTheDocument();
    cleanup();
    renderPlot(2);
    expect(screen.getByRole("button", { name: "Làm đất" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rao bán" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bán lại cho làng · 2.000 xu" })).toBeEnabled();
    expect(onAct).not.toHaveBeenCalled();
  });
});

describe("Handbook", () => {
  it("opens at the tab asked for and switches tabs", () => {
    render(<Handbook varieties={[nep]} initial="pests" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Sâu bệnh" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sâu cuốn lá: lá cuộn trắng. Xịt thuốc trừ sâu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Quy trình" }));
    expect(screen.getByText(/^Nếp: cấy khi mạ 8–14 giờ tuổi/)).toBeInTheDocument();
    cleanup();
    render(<Handbook varieties={[nep]} initial="nope" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Quy trình" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("FarmTasks", () => {
  it("counts the urgent tasks on the HUD button", () => {
    const onClick = vi.fn();
    render(<FarmTasksButton urgent={2} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "🌾 Việc đồng áng (2 việc gấp)" }));
    expect(onClick).toHaveBeenCalled();
    cleanup();
    render(<FarmTasksButton urgent={0} onClick={onClick} />);
    expect(screen.getByRole("button", { name: "🌾 Việc đồng áng" })).toBeInTheDocument();
  });
  it("lists the tasks, urgent first as given, or says there is nothing to do", () => {
    const onOpenHandbook = vi.fn();
    render(<FarmTasksPanel farming tasks={[{ plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true }, { plot: 5, text: "Thửa 5 · Gặt — còn 3 giờ", urgent: false }]}
      onOpenHandbook={onOpenHandbook} onClose={() => {}} />);
    expect(screen.getByText("❗ Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy")).toBeInTheDocument();
    expect(screen.getByText("• Thửa 5 · Gặt — còn 3 giờ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay nhà nông" }));
    expect(onOpenHandbook).toHaveBeenCalled();
    cleanup();
    render(<FarmTasksPanel farming={false} tasks={[]} onOpenHandbook={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Bạn chưa có ruộng — ghé chú Tám ở Hợp tác xã thuê một thửa nhé.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/farm-handbook.test.ts tests/unit/farm-plot-panel.test.tsx`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the handbook pages**

Create `lib/game/farm/handbook.ts`:

```ts
import { ripeAfterHours, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import type { CropView } from "./state";

// Sổ tay nhà nông (spec §8.9): six tabs of static Vietnamese; the timings are worked out per variety from the catalog.
// Pure.

export type HandbookTab = "process" | "fertilizer" | "pests" | "water" | "varieties" | "tips";

export const HANDBOOK_TABS: ReadonlyArray<[HandbookTab, string]> = [
  ["process", "Quy trình"], ["fertilizer", "Phân bón"], ["pests", "Sâu bệnh"], ["water", "Nước"], ["varieties", "Giống lúa"], ["tips", "Mẹo"],
];

export interface HandbookSection { title: string; lines: string[] }

const h = (x: number) => `${Math.round(x)}`;

/** The hour marks of a season for one variety (hours after transplanting unless said). */
function timings(v: Variety): string {
  const s = v.scale;
  return `${v.name}: cấy khi mạ ${h(8 * s)}–${h(14 * s)} giờ tuổi · bón thúc ${h(2 * s)}–${h(10 * s)} giờ sau cấy · `
    + `phơi ruộng ${h(14 * s)}–${h(18 * s)} · đón đòng ${h(18 * s)}–${h(24 * s)} · rút nước từ ${h(40 * s)} · `
    + `chín ${h(48 * s)} giờ sau cấy (~${ripeAfterHours(v)} giờ từ lúc ngâm).`;
}

export function handbookPage(tab: HandbookTab, varieties: readonly Variety[]): HandbookSection[] {
  switch (tab) {
    case "process":
      return [
        {
          title: "11 bước một vụ lúa",
          lines: [
            "1. Làm đất: cày bừa, cho nước vào ngập ruộng (mực Sâu).",
            "2. Bón lót: phân chuồng hoai và phân lân, trước khi cấy. Thiếu mỗi loại mất 5%.",
            "3. Ngâm ủ giống: 2 giờ là hạt nứt nanh.",
            "4. Gieo mạ: trong 6 giờ sau khi nứt nanh, ruộng phải Ẩm. Trễ mất 3% mỗi giờ; để quá 24 giờ hạt thối.",
            "5. Chăm mạ: giữ nước Ẩm cho tới khi mạ đủ tuổi.",
            "6. Cấy lúa: mạ đủ tuổi, nước Nông. Mạ già quá mất 3% mỗi giờ.",
            "7. Bón thúc đẻ nhánh: urê hoặc NPK, đúng lúc thì được trọn công.",
            "8. Phơi ruộng: tháo cạn nước mấy giờ cuối đẻ nhánh cho rễ ăn sâu.",
            "9. Bón đón đòng: kali hoặc NPK khi lúa làm đòng; giữ nước Nông–Sâu tới khi trổ bông.",
            "10. Rút nước: khi lúa vào chắc.",
            "11. Gặt: khi lúa chín; trễ mất 2% mỗi giờ, để 2 ngày thì lúa rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út.",
          ],
        },
        { title: "Mốc giờ theo giống", lines: varieties.map(timings) },
      ];
    case "fertilizer":
      return [
        {
          title: "Loại phân và lúc bón",
          lines: [
            "Phân chuồng hoai, phân lân: bón lót, trước khi cấy. Sau khi cấy mới bón là phí.",
            "Phân urê (đạm): bón thúc đẻ nhánh.",
            "Phân kali: bón đón đòng.",
            "Phân NPK: dùng được cho cả hai lần bón thúc — chắc ăn nhất.",
          ],
        },
        {
          title: "Chấm điểm",
          lines: [
            "Mỗi lần bón thúc: đúng lúc được trọn công; sai lúc hoặc sai loại được nửa công (mất 10%); bỏ trống mất 20%.",
            "Bón nhiều lần một đợt chỉ tính lần tốt nhất.",
          ],
        },
        {
          title: "Dư đạm",
          lines: [
            "Bón urê lúc làm đòng, bón đạm hai lần trong một đợt, hoặc bón đạm từ lúc trổ bông trở đi là dư đạm.",
            "Dư đạm: sâu bệnh dễ tới hơn (gấp rưỡi) và lúa đổ ngã, mất 10% lúc gặt.",
          ],
        },
      ];
    case "pests":
      return [
        {
          title: "Nhận biết và chữa",
          lines: [
            "Ốc bươu vàng: trứng hồng bám thân lúa, ốc bò trong ruộng. Bắt ốc bằng tay (ai cũng bắt giúp được); nước Ẩm hay Khô thì ốc không phá.",
            "Sâu cuốn lá: lá cuộn trắng. Xịt thuốc trừ sâu.",
            "Rầy nâu: chấm nâu dưới gốc lúa. Xịt thuốc trừ rầy.",
            "Đạo ôn lá: đốm nâu hình thoi trên lá. Xịt thuốc trừ bệnh.",
            "Đạo ôn cổ bông: cổ bông trắng bạc. Xịt thuốc trừ bệnh.",
          ],
        },
        {
          title: "Thiệt hại",
          lines: [
            "Mỗi loại sâu bệnh chưa trị làm mất 1,5% mỗi giờ, tối đa 30%.",
            "Xịt sai thuốc hoặc xịt lúc không có sâu bệnh là phí thuốc.",
            "Dư đạm làm sâu bệnh dễ tới hơn; lúa thơm dễ bị đạo ôn hơn.",
          ],
        },
      ];
    case "water":
      return [
        {
          title: "Mực nước",
          lines: [
            "Bốn mức: Khô, Ẩm, Nông, Sâu. Cứ 12 giờ nước tự rút một mức.",
            "Bơm nước thêm một mức hoặc tháo bớt một mức ngay ở bảng thửa ruộng.",
          ],
        },
        {
          title: "Cần mức nào",
          lines: [
            "Mạ non: Ẩm.",
            "Đẻ nhánh: Nông; mấy giờ cuối tháo cạn để phơi ruộng.",
            "Làm đòng, trổ bông: Nông–Sâu (Sâu là tốt nhất).",
            "Vào chắc, chín: rút nước (Khô–Ẩm) — gặt phải rút nước trước.",
            "Mỗi giờ sai mức mất 1%, tối đa 20%.",
          ],
        },
      ];
    case "varieties":
      return [{
        title: "Giống lúa",
        lines: varieties.map((v) => `${v.name}: chín ~${ripeAfterHours(v)} giờ · ${v.baseKg} kg mỗi thửa · ${v.pricePerKg} xu/kg lúa khô`
          + (v.blastMult > 1 ? " · dễ bị đạo ôn" : "")),
      }];
    case "tips":
      return [{
        title: "Mẹo nhà nông",
        lines: [
          "Tháo nước xuống Ẩm là ốc bươu vàng hết phá.",
          "Không chắc bón gì thì bón NPK.",
          "Đừng bón đạm quá tay — dư đạm vừa hút sâu bệnh vừa làm lúa đổ.",
          "Phơi lúa cho khô rồi mới bán: lúa ướt cô Út chỉ trả bảy phần.",
          "Đất tư được thêm 10% lúa và không tốn tiền thuê.",
          "Gặt xong là trả ruộng thuê; muốn làm vụ nữa thì thuê lại.",
        ],
      }];
  }
}

/** The tab the plot panel links to: what matters on this crop now. */
export function handbookTabFor(crop: CropView | null, v: Variety | null, now: number): HandbookTab {
  if (!crop) return "process";
  if (crop.pests.some((p) => p.treatedAt === null)) return "pests";
  const ph = cropPhase(cropModel(crop), v, now);
  return ph === "tillering" || ph === "panicle" ? "fertilizer" : "process";
}
```

- [ ] **Step 4: Write the components**

Create `components/game/farm/Handbook.tsx`:

```tsx
"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import type { Variety } from "@/lib/game/farm/catalog";
import { HANDBOOK_TABS, handbookPage, type HandbookTab } from "@/lib/game/farm/handbook";

const isTab = (t: string | null): t is HandbookTab => HANDBOOK_TABS.some(([id]) => id === t);

/** 📖 Sổ tay nhà nông (spec §8.9): six tabs; `initial` opens one (e.g. the plot panel's link). */
export default function Handbook({ varieties, initial, onClose }: { varieties: readonly Variety[]; initial: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<HandbookTab>(isTab(initial) ? initial : "process");
  return (
    <ParchmentModal title="📖 Sổ tay nhà nông" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Sổ tay nhà nông" className="flex flex-wrap gap-1">
          {HANDBOOK_TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-2">
          {handbookPage(tab, varieties).map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
              <h3 className="text-xl text-burgundy">{sec.title}</h3>
              <ul className="flex flex-col gap-1">
                {sec.lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/farm/PlotPanel.tsx`:

```tsx
"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { plotActions, type PlotAction, type PlotRun } from "@/lib/game/farm/actions";
import { PLOT_PRICE, RENT_PRICE, type FarmCatalog } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, nextPhaseAt, waterAt, wantedWater, yieldEstimate } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookTabFor, type HandbookTab } from "@/lib/game/farm/handbook";
import { buyListedRefusal, buyPlotRefusal, rentRefusal, rentSubleaseRefusal, type LandCtx } from "@/lib/game/farm/land";
import { durationText, PEST_NAME, PEST_REMEDY, PHASE_NAME, WATER_NAME } from "@/lib/game/farm/messages";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import ConfirmButton from "./ConfirmButton";
import { LandButton, MyPlot } from "./CoopPanel";
import FieldStatus from "./FieldStatus";

/** Toasts for the plot actions that do not show at once on the panel. */
const DONE: Record<string, string> = {
  prepare: "Đã làm đất — ruộng ngập nước.", soak: "Đang ngâm giống — 2 giờ nữa là nứt nanh.", sow: "Đã gieo mạ.",
  pick: "Đã bắt ốc bươu vàng.", abandon: "Đã bỏ vụ.",
};
const doneText = (a: PlotAction): string | undefined =>
  DONE[a.key.split(":")[0]] ?? (a.key.startsWith("fert:") || a.key.startsWith("spray:") ? `Đã ${a.label.toLowerCase()}.` : undefined);

function Status({ p, me, catalog, now }: { p: PlotView; me: string; catalog: FarmCatalog; now: number }) {
  const crop = p.crop;
  if (!crop) return <p>Ruộng còn gốc rạ — chưa làm đất.</p>;
  const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
  const c = cropModel(crop);
  const phase = cropPhase(c, v, now);
  const next = nextPhaseAt(c, v, now);
  const water = crop.log ? waterAt(c.water, now) : crop.water;
  const want = wantedWater(c, v, now);
  const farmer = p.farmer?.id === me;
  const estimate = farmer && v && crop.soakAt !== null ? yieldEstimate(c, v, p.kind === "private" ? 1.1 : 1, crop.pests, now).kg : null;
  const remedy = (id: string | null) => (id ? catalog.items.find((i) => i.id === id)?.name ?? id : "Bắt ốc bằng tay");
  return (
    <ul className="flex flex-col gap-0.5">
      <li>🌱 {v ? v.name : "Chưa ngâm giống"} · <b>{PHASE_NAME[phase]}</b>{next !== null && next > now ? ` — giai đoạn sau: còn ${durationText(next - now)}` : ""}</li>
      <li>💧 Nước: <b>{WATER_NAME[water]}</b>{want ? ` · cần ${want.label}` : ""}</li>
      {crop.pests.map((x) => (
        <li key={`${x.kind}:${x.since}`} className={x.treatedAt === null ? "text-burgundy" : "opacity-80"}>
          {x.treatedAt === null ? `❗ ${PEST_NAME[x.kind]} — ${remedy(PEST_REMEDY[x.kind])}` : `✓ Đã trị ${PEST_NAME[x.kind].toLowerCase()}`}
        </li>
      ))}
      {crop.excessN && <li className="text-burgundy">⚠️ Dư đạm — sâu bệnh dễ tới, lúa dễ đổ.</li>}
      {crop.rottedAt !== null && <li className="opacity-80">Lần trước hạt giống thối vì để quá lâu không gieo.</li>}
      {estimate !== null && <li>⚖️ Ước tính: ~{estimate} kg (chưa tính sâu bệnh chưa tới)</li>}
    </ul>
  );
}

/** Land on a plot that is not mine: rent it, buy it, or take a listing or a sublease. */
function Land({ p, ctx, busy, onAct }: { p: PlotView; ctx: LandCtx; busy: boolean; onAct: (a: PlotRun, done?: string) => void }) {
  if (p.owner?.id === ctx.me) return <MyPlot p={p} ctx={ctx} busy={busy} onAct={onAct} />;
  const buttons = [
    p.kind === "village" && !p.lease && (
      <LandButton key="rent" refusal={rentRefusal(p, ctx)} busy={busy} primary onClick={() => onAct({ kind: "rent", plot: p.no }, `Đã thuê thửa ${p.no} trong 4 ngày.`)}>
        Thuê · {formatXu(RENT_PRICE)}
      </LandButton>
    ),
    p.kind === "private" && !p.owner && (
      <LandButton key="buy" refusal={buyPlotRefusal(p, ctx)} busy={busy} primary warn={`Mua thửa ${p.no} với giá ${formatXu(PLOT_PRICE)}?`}
        onClick={() => onAct({ kind: "buy_plot", plot: p.no }, `🏡 Đã mua thửa ${p.no}.`)}>
        Mua · {formatXu(PLOT_PRICE)}
      </LandButton>
    ),
    p.owner && p.salePrice !== null && (
      <LandButton key="listed" refusal={buyListedRefusal(p, ctx)} busy={busy} primary warn={`Mua thửa ${p.no} của ${p.owner.name} với giá ${formatXu(p.salePrice)}?`}
        onClick={() => onAct({ kind: "buy_listed", plot: p.no, expected: p.salePrice! }, `🏡 Đã mua thửa ${p.no}.`)}>
        Mua · {formatXu(p.salePrice)}
      </LandButton>
    ),
    p.owner && p.subleasePrice !== null && (
      <LandButton key="sublease" refusal={rentSubleaseRefusal(p, ctx)} busy={busy} primary
        onClick={() => onAct({ kind: "rent_sublease", plot: p.no, expected: p.subleasePrice! }, `Đã thuê thửa ${p.no} của ${p.owner!.name} một vụ.`)}>
        Thuê một vụ · {formatXu(p.subleasePrice)}
      </LandButton>
    ),
  ].filter(Boolean);
  return buttons.length > 0 ? <div className="flex flex-wrap justify-end gap-2">{buttons}</div> : null;
}

/** 🌾 Thửa N (spec §13.2): the crop's status, what I can do on it now (disabled buttons say why), the land actions,
 *  and a link to the handbook tab that matters. */
export default function PlotPanel({ no, state, catalog, failed, me, busy, now, onAct, onOpenHandbook, onReload, onClose }: {
  no: number;
  state: FieldState | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  me: string;
  busy: boolean;
  now: number;
  onAct: (a: PlotRun, done?: string) => void;
  onOpenHandbook: (tab: HandbookTab) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const p = state?.plots.find((x) => x.no === no) ?? null;
  const v = p?.crop ? catalog?.varieties.find((x) => x.id === p.crop!.variety) ?? null : null;
  const tab = handbookTabFor(p?.crop ?? null, v, now);
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
  return (
    <ParchmentModal title={`🌾 Thửa ${no} · ${no <= 4 ? "đất tư" : "đất làng"}`} onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!p || !state || !catalog || !ctx ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            <p className="opacity-80">
              {p.owner ? `Chủ đất: ${p.owner.id === me ? "bạn" : p.owner.name}` : p.kind === "private" ? "Làng đang bán thửa này" : "Đất làng"}
              {p.farmer ? ` · người làm: ${p.farmer.id === me ? "bạn" : p.farmer.name}` : " · chưa ai làm"}
              {p.lease ? ` (thuê — còn ${durationText(p.lease.until - now)})` : ""}
            </p>
            <Status p={p} me={me} catalog={catalog} now={now} />
            <ul className="flex flex-col gap-1">
              {plotActions(p, me, v, catalog, state.mine, now).map((a) => (
                <li key={a.key} className="flex flex-wrap items-center gap-2">
                  <ConfirmButton warn={a.warn} disabled={busy || !a.enabled} primary={a.enabled && !a.warn} onConfirm={() => onAct(a.run, doneText(a))}>
                    {a.label}
                  </ConfirmButton>
                  {(a.why ?? a.hint) && <span className="min-w-0 flex-1 text-base opacity-80">{a.why ?? a.hint}</span>}
                </li>
              ))}
            </ul>
            <Land p={p} ctx={ctx} busy={busy} onAct={onAct} />
            <button type="button" className="pch-btn self-start" onClick={() => onOpenHandbook(tab)}>
              📖 Sổ tay: {HANDBOOK_TABS.find(([id]) => id === tab)?.[1]}
            </button>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/farm/FarmTasks.tsx`:

```tsx
"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import type { FarmTask } from "@/lib/game/farm/actions";

/** The HUD button "🌾 Việc đồng áng"; a dot counts the urgent tasks (spec §13.1). */
export function FarmTasksButton({ urgent, onClick }: { urgent: number; onClick: () => void }) {
  return (
    <button type="button" className="pch-btn relative" onClick={onClick} aria-label={urgent > 0 ? `🌾 Việc đồng áng (${urgent} việc gấp)` : undefined}>
      🌾 Việc đồng áng
      {urgent > 0 && (
        <span aria-hidden="true" className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-burgundy px-1 text-center text-sm leading-5 text-parchment">
          {urgent}
        </span>
      )}
    </button>
  );
}

/** What is due on the plots I farm, urgent first, and the way to the handbook. */
export default function FarmTasksPanel({ tasks, farming, onOpenHandbook, onClose }: {
  tasks: readonly FarmTask[];
  /** I farm at least one plot here. */
  farming: boolean;
  onOpenHandbook: () => void;
  onClose: () => void;
}) {
  return (
    <ParchmentModal title="🌾 Việc đồng áng" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {tasks.length === 0 ? (
          <p>{farming ? "Ruộng đang ổn, chưa cần làm gì." : "Bạn chưa có ruộng — ghé chú Tám ở Hợp tác xã thuê một thửa nhé."}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {tasks.map((t) => (
              <li key={t.text} className={t.urgent ? "text-burgundy" : ""}>{t.urgent ? "❗ " : "• "}{t.text}</li>
            ))}
          </ul>
        )}
        <button type="button" className="pch-btn self-start" onClick={onOpenHandbook}>📖 Sổ tay nhà nông</button>
      </div>
    </ParchmentModal>
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/unit/farm-handbook.test.ts tests/unit/farm-plot-panel.test.tsx tests/unit/farm-panels.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint lib/game/farm/handbook.ts components/game/farm tests/unit/farm-handbook.test.ts tests/unit/farm-plot-panel.test.tsx` (clean).

```bash
git add lib/game/farm/handbook.ts components/game/farm/PlotPanel.tsx components/game/farm/Handbook.tsx components/game/farm/FarmTasks.tsx tests/unit/farm-handbook.test.ts tests/unit/farm-plot-panel.test.tsx
git commit -m "feat(v15): plot panel, Sổ tay nhà nông and the task list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Wire the field into the game shell; last-seen; the fishing clock

**Files:**
- Create: `components/game/farm/FarmOverlays.tsx` (the not-open banner, the work progress, the field's panels)
- Modify: `components/game/GameShell.tsx` (runs `useFarmController`; interactions, prompts, input lock, `onPlotChanged`, the 🌾 Việc đồng áng button, the rice line, the overlays)
- Modify: `components/game/fishing/FishingHud.tsx` (`riceLine` replaces bait and fish on the field), `lib/game/farm/messages.ts` (`riceSummary`)
- Modify: `lib/supabase.ts` (`touchRoom`), `components/room/RoomSession.tsx` (calls it once per room visit)
- Modify: `lib/game/fishing/state.ts` (`serverNow`), `hooks/useFishing.ts` (sets the shared clock), `hooks/useFishingController.ts` (counts down on `serverNow()`)
- Test: `tests/unit/farm-overlays.test.tsx` (new); `tests/unit/farm-messages.test.ts`, `tests/unit/fishing-state.test.ts`, `tests/unit/use-fishing.test.tsx` (extend)

**Interfaces:**
- Consumes: `useFarmController`, `FarmController`, `FarmWork`, `WORK_MS` (Task 14); the panels (Tasks 15–16); `serverNow`, `syncClock` (Task 4).
- Produces: `FarmOverlays({ farm: FarmController, me, onField })`; `riceSummary(rice)` ("🌾 62 kg khô · 30 kg ướt", "🌾 Chưa có lúa"); `FishingHud` prop `riceLine?: string | null`; `touchRoom(roomId, token)` (`@/lib/supabase`); `FishingState.serverNow: string | null`.
- The shell: `blocking` also covers `farm.panel` and `farm.work`; the default interaction tries `farm.interact` before `fishing.interact`; the prompt shows `farm.promptText(prompt) ?? promptText(prompt)`; `GameCanvas` gets `onPlotChanged={farm.data.plotChanged}`; `onCoinsChanged` refetches the fishing state (the HUD wallet).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-overlays.test.tsx`:

```tsx
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import FarmOverlays from "@/components/game/farm/FarmOverlays";
import type { FarmController } from "@/hooks/useFarmController";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { NOT_OPEN } from "@/lib/game/farm/messages";
import { parseFieldState } from "@/lib/game/farm/state";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const CATALOG = {
  varieties: [varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 })],
  items: [farmItemFromRow({ id: "fert_urea", kind: "fertilizer", name: "Phân urê", price: 60, sort_order: 30, variety: null, fert: "urea", pest_target: null, capacity: null })],
};
const STATE = parseFieldState({
  server_now: new Date(NOW).toISOString(),
  plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
  drying: [],
  mine: { items: {}, rice: {}, coins: 500, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
})!;

const controller = (over: Partial<FarmController> = {}): FarmController => ({
  data: {
    state: STATE, catalog: CATALOG, failed: false, notOpen: false, reload: vi.fn(), run: vi.fn(), sellRice: vi.fn(), buyItem: vi.fn(),
    claimGift: vi.fn(), plotChanged: vi.fn(),
  },
  now: NOW, tasks: [], urgent: 0, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), busy: false, work: null, cancelWork: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true), interact: vi.fn(),
  promptText: vi.fn(),
  ...over,
});

describe("FarmOverlays", () => {
  it("shows the not-open banner on the field only", () => {
    const farm = controller({ data: { ...controller().data, notOpen: true } });
    const { rerender } = render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText(NOT_OPEN)).toBeInTheDocument();
    rerender(<FarmOverlays farm={farm} me="me" onField={false} />);
    expect(screen.queryByText(NOT_OPEN)).toBeNull();
  });

  it("shows the work progress, cancelled by its button or Esc", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1 } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText("🌾 Đang gặt thửa 5…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(farm.cancelWork).toHaveBeenCalledTimes(2);
  });

  it("opens the panel the controller names and wires its actions", () => {
    const coop = controller({ panel: { kind: "coop" } });
    const { rerender } = render(<FarmOverlays farm={coop} me="me" onField />);
    fireEvent.click(within(screen.getByRole("dialog", { name: "🏛️ Hợp tác xã · chú Tám" })).getByRole("button", { name: "Thuê · 250 xu" }));
    expect(coop.act).toHaveBeenCalledWith({ kind: "rent", plot: 5 }, "Đã thuê thửa 5 trong 4 ngày.");

    const plot = controller({ panel: { kind: "plot", plot: 5 } });
    rerender(<FarmOverlays farm={plot} me="me" onField />);
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Quy trình" }));
    expect(plot.openPanel).toHaveBeenCalledWith({ kind: "handbook", tab: "process" });

    const shop = controller({ panel: { kind: "shop" } });
    rerender(<FarmOverlays farm={shop} me="me" onField />);
    fireEvent.click(screen.getByRole("button", { name: "Mua 1 · 60 xu" }));
    expect(shop.buy).toHaveBeenCalledWith("fert_urea", 1);

    const tasks = controller({ panel: { kind: "tasks" } });
    rerender(<FarmOverlays farm={tasks} me="me" onField />);
    expect(screen.getByText("Bạn chưa có ruộng — ghé chú Tám ở Hợp tác xã thuê một thửa nhé.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay nhà nông" }));
    expect(tasks.openPanel).toHaveBeenCalledWith({ kind: "handbook", tab: null });

    rerender(<FarmOverlays farm={controller({ panel: { kind: "handbook", tab: "water" } })} me="me" onField />);
    expect(screen.getByRole("tab", { name: "Nước" })).toHaveAttribute("aria-selected", "true");
  });
});
```

**tests/unit/farm-messages.test.ts — edit 1 of 2.** Replace:

```ts
import {
  boughtText, durationText, farmErrorMessage, harvestText, isMissingRpc, PEST_NAME, PEST_REMEDY, PHASE_NAME, riceSaleText,
} from "@/lib/game/farm/messages";
```

with:

```ts
import {
  boughtText, durationText, farmErrorMessage, harvestText, isMissingRpc, PEST_NAME, PEST_REMEDY, PHASE_NAME, riceSaleText, riceSummary,
} from "@/lib/game/farm/messages";
```

**tests/unit/farm-messages.test.ts — edit 2 of 2.** Replace:

```ts
    expect(riceSaleText(10, "Nếp", false, 126)).toBe("💰 Bán 10 kg nếp ướt được 126 xu.");
  });
});
```

with:

```ts
    expect(riceSaleText(10, "Nếp", false, 126)).toBe("💰 Bán 10 kg nếp ướt được 126 xu.");
  });
  it("sums the rice for the HUD", () => {
    expect(riceSummary({})).toBe("🌾 Chưa có lúa");
    expect(riceSummary({ nep: { wet: 30, dry: 50 }, thom: { wet: 0, dry: 12 } })).toBe("🌾 62 kg khô · 30 kg ướt");
  });
});
```

**tests/unit/fishing-state.test.ts.** Replace:

```ts
      owned: ["rod_bamboo", "bucket_small"], baitCap: 20, fishCap: 6, castsLeft: 37,
      windowResetsAt: "2026-09-24T11:00:00Z", digReadyAt: null,
    });
    expect(S.fish[0]).toEqual({ id: "f1", speciesId: "ca_loc", weightG: 1200, price: 72, caughtAt: "2026-09-24T10:00:00Z" });
```

with:

```ts
      owned: ["rod_bamboo", "bucket_small"], baitCap: 20, fishCap: 6, castsLeft: 37,
      windowResetsAt: "2026-09-24T11:00:00Z", digReadyAt: null, serverNow: null,
    });
    expect(parseFishingState({ ...RAW, server_now: "2026-09-24T10:30:00Z" })?.serverNow).toBe("2026-09-24T10:30:00Z");
    expect(S.fish[0]).toEqual({ id: "f1", speciesId: "ca_loc", weightG: 1200, price: 72, caughtAt: "2026-09-24T10:00:00Z" });
```

**tests/unit/use-fishing.test.tsx — edit 1 of 2.** Replace:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

with:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { clockOffset } from "@/lib/game/farm/clock";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

**tests/unit/use-fishing.test.tsx — edit 2 of 2.** Replace:

```tsx
    expect(result.current.failed).toBe(false);
  });
```

with:

```tsx
    expect(result.current.failed).toBe(false);
  });

  it("sets the shared server clock from the state's server_now (v15 §11.6)", async () => {
    rpc.fetchFishingState.mockResolvedValue(state({ server_now: new Date(Date.now() + 90_000).toISOString() }));
    renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(Math.abs(clockOffset() - 90_000)).toBeLessThan(1000);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/farm-overlays.test.tsx tests/unit/farm-messages.test.ts tests/unit/fishing-state.test.ts tests/unit/use-fishing.test.tsx`
Expected: FAIL — no overlays, no `riceSummary`, no `serverNow` in the fishing state, the clock is not set by fishing answers.

- [ ] **Step 3: The fishing HUD and the fishing clock**

**lib/game/fishing/state.ts — edit 1 of 3.** Replace:

```ts
  digReadyAt: string | null;
}
```

with:

```ts
  digReadyAt: string | null;
  /** The server's clock at the answer (v15 §11.6; null before migration 0013). */
  serverNow: string | null;
}
```

**lib/game/fishing/state.ts — edit 2 of 3.** Replace:

```ts
    digReadyAt: strOrNull(j.dig_ready_at),
  };
```

with:

```ts
    digReadyAt: strOrNull(j.dig_ready_at),
    serverNow: strOrNull(j.server_now),
  };
```

**lib/game/fishing/state.ts — edit 3 of 3.** Replace:

```ts

/** Why start_cast would refuse right now (same order as the server), or null. `now` = Date.now(). */
export function castBlocker(s: FishingState, now: number): CastBlocker | null {
```

with:

```ts

/** Why start_cast would refuse right now (same order as the server), or null. `now` = serverNow(). */
export function castBlocker(s: FishingState, now: number): CastBlocker | null {
```

**hooks/useFishing.ts — edit 1 of 2.** Replace:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
```

with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { syncClock } from "@/lib/game/farm/clock";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
```

**hooks/useFishing.ts — edit 2 of 2.** Replace:

```ts
  const apply = useCallback((n: number, s: FishingState) => {
    if (n < applied.current) return;
```

with:

```ts
  const apply = useCallback((n: number, s: FishingState) => {
    syncClock(s.serverNow);
    if (n < applied.current) return;
```

**hooks/useFishingController.ts — edit 1 of 4.** Replace:

```ts
import { useFishing, type FishingData } from "@/hooks/useFishing";
import {
```

with:

```ts
import { useFishing, type FishingData } from "@/hooks/useFishing";
import { serverNow } from "@/lib/game/farm/clock";
import {
```

**hooks/useFishingController.ts — edit 2 of 4.** Replace:

```ts
    if (!ticking) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
```

with:

```ts
    if (!ticking) return;
    const tick = () => setNow(serverNow());
    const first = setTimeout(tick, 0);
```

**hooks/useFishingController.ts — edit 3 of 4.** Replace:

```ts
    }
    const wait = digWaitSec(s, Date.now());
    if (wait > 0) {
```

with:

```ts
    }
    const wait = digWaitSec(s, serverNow());
    if (wait > 0) {
```

**hooks/useFishingController.ts — edit 4 of 4.** Replace:

```ts
  const fishAt = useCallback((it: Interactable) => {
    const refusal = castRefusal(stateRef.current, failedRef.current, Date.now(), canvas()?.anglerNear(it.use) ?? false);
    if (refusal) toastRef.current(refusal);
```

with:

```ts
  const fishAt = useCallback((it: Interactable) => {
    const refusal = castRefusal(stateRef.current, failedRef.current, serverNow(), canvas()?.anglerNear(it.use) ?? false);
    if (refusal) toastRef.current(refusal);
```

**lib/game/farm/messages.ts.** Replace:

```ts
  return `🌾 Gặt được ${kg} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}
```

with:

```ts
  return `🌾 Gặt được ${kg} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}

/** The HUD's rice line on the field: every variety together. */
export function riceSummary(rice: Record<string, { wet: number; dry: number }>): string {
  const all = Object.values(rice);
  const dry = all.reduce((a, r) => a + r.dry, 0), wet = all.reduce((a, r) => a + r.wet, 0);
  return dry + wet === 0 ? "🌾 Chưa có lúa" : `🌾 ${dry} kg khô · ${wet} kg ướt`;
}
```

**components/game/fishing/FishingHud.tsx — edit 1 of 3.** Replace:

```tsx

/** The player card's fishing line: coins, bait and fish (spec §10.1); a reload button when the state failed (§13). */
export default function FishingHud({ state, failed, onReload }: {
  state: FishingState | null;
```

with:

```tsx

/** The player card's fishing line: coins, bait and fish (spec §10.1); a reload button when the state failed (§13).
 *  On the field the rice summary replaces bait and fish (v15 §13.1). */
export default function FishingHud({ state, failed, onReload, riceLine = null }: {
  state: FishingState | null;
```

**components/game/fishing/FishingHud.tsx — edit 2 of 3.** Replace:

```tsx
  onReload: () => void;
}) {
```

with:

```tsx
  onReload: () => void;
  riceLine?: string | null;
}) {
```

**components/game/fishing/FishingHud.tsx — edit 3 of 3.** Replace:

```tsx
      <span className="text-lg">🪙 {state ? formatXu(state.coins) : "—"}</span>
      {state && (
        <span title="Mồi · Cá">🪱 {baitTotal(state)}/{state.baitCap} · 🐟 {state.fish.length}/{state.fishCap}</span>
```

with:

```tsx
      <span className="text-lg">🪙 {state ? formatXu(state.coins) : "—"}</span>
      {riceLine ? <span>{riceLine}</span> : state && (
        <span title="Mồi · Cá">🪱 {baitTotal(state)}/{state.baitCap} · 🐟 {state.fish.length}/{state.fishCap}</span>
```

- [ ] **Step 4: Last seen, once per room visit**

**lib/supabase.ts.** Replace:

```ts
}
export async function renameRoom(roomId: string, token: string, newName: string) {
```

with:

```ts
}
/** Marks me as seen in the room (v15: a private plot is reclaimed after 14 days away). */
export async function touchRoom(roomId: string, token: string) {
  const { error } = await supabase.rpc("touch_room", { p_room_id: roomId, p_session_token: token });
  if (error) throw error;
}
export async function renameRoom(roomId: string, token: string, newName: string) {
```

**components/room/RoomSession.tsx — edit 1 of 2.** Replace:

```tsx
import { deriveRoom } from "@/lib/room-derived";
import BrandSpinner from "@/components/brand/BrandSpinner";
```

with:

```tsx
import { deriveRoom } from "@/lib/room-derived";
import { touchRoom } from "@/lib/supabase";
import BrandSpinner from "@/components/brand/BrandSpinner";
```

**components/room/RoomSession.tsx — edit 2 of 2.** Replace:

```tsx
  useEffect(() => { setPresenceMode(mode); }, [mode, setPresenceMode]);
```

with:

```tsx
  useEffect(() => { setPresenceMode(mode); }, [mode, setPresenceMode]);
  // "last seen" for the land rules, once per room visit (before migration 0013 the RPC is missing: ignored)
  useEffect(() => { touchRoom(room.id, view.token).catch(() => {}); }, [room.id, view.token]);
```

- [ ] **Step 5: The field's overlays and the shell wiring**

Create `components/game/farm/FarmOverlays.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { WORK_MS, type FarmController, type FarmWork } from "@/hooks/useFarmController";
import { NOT_OPEN } from "@/lib/game/farm/messages";
import CoopPanel from "./CoopPanel";
import DryingPanel from "./DryingPanel";
import FarmShopPanel from "./FarmShopPanel";
import FarmTasksPanel from "./FarmTasks";
import Handbook from "./Handbook";
import PlotPanel from "./PlotPanel";
import RiceDepotPanel from "./RiceDepotPanel";

/** Transplanting or harvesting: a bar that fills in WORK_MS, and "Huỷ" (or Esc) before it is sent. */
function WorkProgress({ work, onCancel }: { work: FarmWork; onCancel: () => void }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFull(true));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
    };
  }, [onCancel]);
  return (
    <div className="pch absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 p-2 font-vt text-xl" role="status">
      <span>{work.work === "transplant" ? `🌱 Đang cấy thửa ${work.plot}…` : `🌾 Đang gặt thửa ${work.plot}…`}</span>
      <div className="h-3 w-48 overflow-hidden rounded-sm bg-ink/20">
        <div
          className="h-full bg-burgundy motion-reduce:transition-none"
          style={{ width: full ? "100%" : "0%", transition: `width ${WORK_MS}ms linear` }}
        />
      </div>
      <button type="button" className="pch-btn" onClick={onCancel}>Huỷ <span className="pointer-coarse:hidden">(Esc)</span></button>
    </div>
  );
}

/** The field on top of the world (spec §13): the banner before the migration, the work progress and the field's
 *  panels. */
export default function FarmOverlays({ farm, me, onField }: { farm: FarmController; me: string; onField: boolean }) {
  const { panel, closePanel, openPanel, busy, now } = farm;
  const { state, catalog, failed, notOpen, reload } = farm.data;
  const onReload = () => void reload();
  const act = (a: Parameters<FarmController["act"]>[0], done?: string) => void farm.act(a, done);
  return (
    <>
      {onField && notOpen && (
        <p className="pch pointer-events-none absolute left-1/2 top-28 z-10 -translate-x-1/2 px-3 py-1.5 text-center font-vt text-xl">{NOT_OPEN}</p>
      )}
      {farm.work && <WorkProgress key={farm.work.startedAt} work={farm.work} onCancel={farm.cancelWork} />}
      {panel?.kind === "plot" && (
        <PlotPanel no={panel.plot} state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act}
          onOpenHandbook={(tab) => openPanel({ kind: "handbook", tab })} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "coop" && (
        <CoopPanel state={state} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "shop" && (
        <FarmShopPanel mine={state?.mine ?? null} catalog={catalog} failed={failed} busy={busy}
          onBuy={(id, qty) => void farm.buy(id, qty)} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "depot" && (
        <RiceDepotPanel mine={state?.mine ?? null} catalog={catalog} failed={failed} busy={busy}
          onSell={(v, dry, kg) => void farm.sell(v, dry, kg)} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "drying" && (
        <DryingPanel state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "handbook" && <Handbook varieties={catalog?.varieties ?? []} initial={panel.tab} onClose={closePanel} />}
      {panel?.kind === "tasks" && (
        <FarmTasksPanel tasks={farm.tasks} farming={(state?.mine.farming.length ?? 0) > 0}
          onOpenHandbook={() => openPanel({ kind: "handbook", tab: null })} onClose={closePanel} />
      )}
    </>
  );
}
```

**components/game/GameShell.tsx — edit 1 of 11.** Replace:

```tsx
import { useChat } from "@/hooks/useChat";
import { useFishingController } from "@/hooks/useFishingController";
```

with:

```tsx
import { useChat } from "@/hooks/useChat";
import { useFarmController } from "@/hooks/useFarmController";
import { useFishingController } from "@/hooks/useFishingController";
```

**components/game/GameShell.tsx — edit 2 of 11.** Replace:

```tsx
import { formatClock } from "@/lib/format";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
```

with:

```tsx
import { formatClock } from "@/lib/format";
import { riceSummary } from "@/lib/game/farm/messages";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
```

**components/game/GameShell.tsx — edit 3 of 11.** Replace:

```tsx
import CharacterEditor from "./CharacterEditor";
import FishingHud from "./fishing/FishingHud";
```

with:

```tsx
import CharacterEditor from "./CharacterEditor";
import FarmOverlays from "./farm/FarmOverlays";
import { FarmTasksButton } from "./farm/FarmTasks";
import FishingHud from "./fishing/FishingHud";
```

**components/game/GameShell.tsx — edit 4 of 11.** Replace:

```tsx

/** Game mode: the room world (hall + pond) and the parchment HUD. Music, queue, chat and roles are the same as the
 *  classic view. */
```

with:

```tsx

/** Game mode: the room world (hall, pond and field) and the parchment HUD. Music, queue, chat and roles are the same as the
 *  classic view. */
```

**components/game/GameShell.tsx — edit 5 of 11.** Replace:

```tsx

  // --- input is off while any panel or the create editor is open
  const blocking = panel !== null || fishing.panel !== null || creating;
  useEffect(() => {
```

with:

```tsx

  // --- farming: the field of this room, its panels, the due tasks, the plots on the canvas and the work progress
  const farm = useFarmController({
    token, roomId: room.id, accountId, mapId: travel.mapId, canvas: getCanvas, toast: showToast,
    // the HUD's wallet is the fishing state's: fetch it again when the field moved my coins
    onCoinsChanged: () => void fishing.data.reload(),
  });
  const { interact: farmInteract, promptText: farmPrompt } = farm;

  // --- input is off while any panel, the farm work or the create editor is open
  const blocking = panel !== null || fishing.panel !== null || farm.panel !== null || farm.work !== null || creating;
  useEffect(() => {
```

**components/game/GameShell.tsx — edit 6 of 11.** Replace:

```tsx
      default:
        if (!fishingInteract(it)) showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast, fishingInteract, cancelCast]);
```

with:

```tsx
      default:
        if (!farmInteract(it) && !fishingInteract(it)) showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast, fishingInteract, farmInteract, cancelCast]);
```

**components/game/GameShell.tsx — edit 7 of 11.** Replace:

```tsx
        onFishingInput={onFishingInput}
        onFirstFrame={onFirstFrame}
```

with:

```tsx
        onFishingInput={onFishingInput}
        onPlotChanged={farm.data.plotChanged}
        onFirstFrame={onFirstFrame}
```

**components/game/GameShell.tsx — edit 8 of 11.** Replace:

```tsx
            {!connected && <span className="text-base opacity-80">Đang kết nối thế giới…</span>}
            <div className="flex gap-1">
              <button type="button" className="pch-btn" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
```

with:

```tsx
            {!connected && <span className="text-base opacity-80">Đang kết nối thế giới…</span>}
            <div className="flex flex-wrap gap-1">
              <button type="button" className="pch-btn" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
```

**components/game/GameShell.tsx — edit 9 of 11.** Replace:

```tsx
              <button type="button" className="pch-btn" onClick={() => fishing.openPanel("bag")}>🎒 Giỏ đồ</button>
            </div>
            <FishingHud state={fishing.data.state} failed={fishing.data.failed} onReload={() => void fishing.data.reload()} />
          </div>
```

with:

```tsx
              <button type="button" className="pch-btn" onClick={() => fishing.openPanel("bag")}>🎒 Giỏ đồ</button>
              {map.id === "field" && <FarmTasksButton urgent={farm.urgent} onClick={() => farm.openPanel({ kind: "tasks" })} />}
            </div>
            <FishingHud
              state={fishing.data.state}
              failed={fishing.data.failed}
              onReload={() => void fishing.data.reload()}
              riceLine={map.id === "field" && farm.data.state ? riceSummary(farm.data.state.mine.rice) : null}
            />
          </div>
```

**components/game/GameShell.tsx — edit 10 of 11.** Replace:

```tsx
          <span className="pointer-coarse:hidden">E · </span>
          {promptText(prompt)}
        </button>
```

with:

```tsx
          <span className="pointer-coarse:hidden">E · </span>
          {farmPrompt(prompt) ?? promptText(prompt)}
        </button>
```

**components/game/GameShell.tsx — edit 11 of 11.** Replace:

```tsx
      <FishingOverlays fishing={fishing} />
```

with:

```tsx
      <FishingOverlays fishing={fishing} />
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} />
```

- [ ] **Step 6: Run the tests**

Run: `pnpm vitest run tests/unit/farm-overlays.test.tsx tests/unit/farm-messages.test.ts tests/unit/fishing-state.test.ts tests/unit/use-fishing.test.tsx tests/unit/use-farm-controller.test.tsx tests/unit/fishing-panels.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit` and `npx eslint components/game/GameShell.tsx components/game/farm components/game/fishing/FishingHud.tsx components/room/RoomSession.tsx hooks/useFishing.ts hooks/useFishingController.ts lib/supabase.ts lib/game/fishing/state.ts lib/game/farm/messages.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-messages.test.ts tests/unit/fishing-state.test.ts tests/unit/use-fishing.test.tsx` (clean).

```bash
git add components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/fishing/FishingHud.tsx components/room/RoomSession.tsx hooks/useFishing.ts hooks/useFishingController.ts lib/supabase.ts lib/game/fishing/state.ts lib/game/farm/messages.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-messages.test.ts tests/unit/fishing-state.test.ts tests/unit/use-fishing.test.tsx
git commit -m "feat(v15): the field in the game shell, last seen, fishing server clock

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Land-sale announcements, README, integration tests and the final checks

**Files:**
- Modify: `lib/game/fishing/announce.ts` (`LAND_ANNOUNCER_NAME`, `parseLandAnnouncement`, `parseAnnouncement`, `Announcement`; `freshAnnouncements` returns both kinds)
- Modify: `components/room/ChatMessageItem.tsx` (a land sale is a system line), `lib/chat-notify.ts` (its readable text), `components/game/GameShell.tsx` (toasts land sales too)
- Modify: `README.md` (v15 section: migration, deploy order, what's new, trust model, realtime budget)
- Create: `tests/integration/v15.test.ts`; Modify: `tests/integration/v14.test.ts` (counts fishing kinds only)
- Test: `tests/unit/fishing-announce.test.ts`, `tests/unit/chat-catch-line.test.tsx`, `tests/unit/chat-notify.test.ts` (extend)

**Interfaces:**
- Consumes: the `[land:<plot>] 🏡 …` chat line `_land_sale` posts as `Hợp tác xã` (Task 2).
- Produces (`@/lib/game/fishing/announce`): `LAND_ANNOUNCER_NAME = "Hợp tác xã"`, `LandAnnouncement { plot, text }`, `Announcement = ({ kind: "catch" } & CatchAnnouncement) | ({ kind: "land" } & LandAnnouncement)`, `parseLandAnnouncement(m)`, `parseAnnouncement(m)`; `freshAnnouncements(…)` now yields `Announcement`s. Spoof-safe: a null author, the reserved name and the prefix.

- [ ] **Step 1: Write the failing tests**

**tests/unit/fishing-announce.test.ts — edit 1 of 2.** Replace:

```ts
import type { ChatMessage } from "@/lib/chat";
import { ANNOUNCER_NAME, freshAnnouncements, parseCatchAnnouncement } from "@/lib/game/fishing/announce";
```

with:

```ts
import type { ChatMessage } from "@/lib/chat";
import {
  ANNOUNCER_NAME, freshAnnouncements, LAND_ANNOUNCER_NAME, parseAnnouncement, parseCatchAnnouncement, parseLandAnnouncement,
} from "@/lib/game/fishing/announce";
```

**tests/unit/fishing-announce.test.ts — edit 2 of 2.** Replace:

```ts
    expect(out.map((o) => o.id)).toEqual(["a"]);
    expect(out[0].announcement.speciesId).toBe("ca_tra");
  });
});
```

with:

```ts
    expect(out.map((o) => o.id)).toEqual(["a"]);
    expect(out[0].announcement).toMatchObject({ kind: "catch", speciesId: "ca_tra" });
  });
  it("includes land sales", () => {
    const now = Date.parse("2026-09-24T10:00:10Z");
    const out = freshAnnouncements([msg({ id: "l", username: LAND_ANNOUNCER_NAME, body: LAND })], new Set(), now);
    expect(out).toEqual([{ id: "l", announcement: { kind: "land", plot: 3, text: LAND_TEXT } }]);
  });
});

// the exact text _land_sale builds: format('[land:%s] 🏡 %s đã mua thửa %s của %s với giá %s xu.', …)
const LAND_TEXT = "🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.";
const LAND = `[land:3] ${LAND_TEXT}`;

describe("parseLandAnnouncement", () => {
  it("reads the co-op's sale message, and only the co-op's", () => {
    expect(parseLandAnnouncement(msg({ username: LAND_ANNOUNCER_NAME, body: LAND }))).toEqual({ plot: 3, text: LAND_TEXT });
    expect(parseLandAnnouncement(msg({ username: LAND_ANNOUNCER_NAME, body: LAND, account_id: ACC }))).toBeNull();
    expect(parseLandAnnouncement(msg({ username: ANNOUNCER_NAME, body: LAND }))).toBeNull();
    expect(parseLandAnnouncement(msg({ username: LAND_ANNOUNCER_NAME, body: "[land:x] hi" }))).toBeNull();
  });
  it("is one of the announcements, each prefix with its own author", () => {
    expect(parseAnnouncement(msg({ username: LAND_ANNOUNCER_NAME, body: LAND }))).toEqual({ kind: "land", plot: 3, text: LAND_TEXT });
    expect(parseAnnouncement(msg({}))).toMatchObject({ kind: "catch", accountId: ACC });
    expect(parseAnnouncement(msg({ username: LAND_ANNOUNCER_NAME }))).toBeNull();
  });
});
```

**tests/unit/chat-catch-line.test.tsx.** Replace:

```tsx
  });
  it("renders a member typing the prefix as a normal message", () => {
```

with:

```tsx
  });
  it("shows a land sale by the co-op as a system line too", () => {
    renderItem(msg({ username: "Hợp tác xã", body: "[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu." }), false);
    expect(screen.getByText("🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.")).toBeInTheDocument();
    expect(screen.queryByTitle("Trả lời tin nhắn")).toBeNull();
  });
  it("renders a member typing the prefix as a normal message", () => {
```

**tests/unit/chat-notify.test.ts.** Replace:

```ts
describe("notificationText", () => {
  it("shows the readable part of a catch announcement", () => {
```

with:

```ts
describe("notificationText", () => {
  it("shows the readable part of a land sale", () => {
    const sale: ChatMessage = { id: "l", room_id: "r", account_id: null, username: "Hợp tác xã", body: "[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.", created_at: "l" };
    expect(notificationText(sale)).toBe("🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.");
    expect(newFromOthers([sale], new Set(), ME).map((m) => m.id)).toEqual(["l"]);
  });
  it("shows the readable part of a catch announcement", () => {
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fishing-announce.test.ts tests/unit/chat-catch-line.test.tsx tests/unit/chat-notify.test.ts`
Expected: FAIL — land sales are not parsed.

- [ ] **Step 3: Parse land sales next to the catch line, and use them**

`lib/game/fishing/announce.ts` (full replacement):

```ts
import type { ChatMessage } from "@/lib/chat";

// The chat messages the server posts: a rare+ catch from finish_cast (v14 spec §8.5) and a land sale between players
// (v15 spec §7.8). Pure.

export const ANNOUNCER_NAME = "Ao cá";
export const LAND_ANNOUNCER_NAME = "Hợp tác xã";

export interface CatchAnnouncement { accountId: string; speciesId: string; weightG: number; text: string }
export interface LandAnnouncement { plot: number; text: string }
export type Announcement = ({ kind: "catch" } & CatchAnnouncement) | ({ kind: "land" } & LandAnnouncement);

const CATCH = /^\[catch:([0-9a-f-]{36})\|([a-z_]{1,32})\|(\d{1,6})\] ([\s\S]+)$/;
const LAND = /^\[land:(\d{1,2})\] ([\s\S]+)$/;

type Posted = Pick<ChatMessage, "account_id" | "username" | "body">;

/** Only server messages count: no author account and the announcer's name, so a member cannot fake one. */
export function parseCatchAnnouncement(m: Posted): CatchAnnouncement | null {
  if (m.account_id !== null || m.username !== ANNOUNCER_NAME) return null;
  const x = CATCH.exec(m.body);
  if (!x) return null;
  return { accountId: x[1], speciesId: x[2], weightG: Number(x[3]), text: x[4] };
}

/** A land sale: no author account, the co-op's name and the `[land:<plot>]` prefix. */
export function parseLandAnnouncement(m: Posted): LandAnnouncement | null {
  if (m.account_id !== null || m.username !== LAND_ANNOUNCER_NAME) return null;
  const x = LAND.exec(m.body);
  return x ? { plot: Number(x[1]), text: x[2] } : null;
}

/** Any server announcement, or null for a member's message. */
export function parseAnnouncement(m: Posted): Announcement | null {
  const c = parseCatchAnnouncement(m);
  if (c) return { kind: "catch", ...c };
  const l = parseLandAnnouncement(m);
  return l ? { kind: "land", ...l } : null;
}

/** Announcements not shown yet and at most maxAgeMs old (the game HUD toasts them). */
export function freshAnnouncements(
  messages: ChatMessage[], shown: ReadonlySet<string>, now: number, maxAgeMs = 30_000,
): Array<{ id: string; announcement: Announcement }> {
  const out: Array<{ id: string; announcement: Announcement }> = [];
  for (const m of messages) {
    if (shown.has(m.id) || now - Date.parse(m.created_at) > maxAgeMs) continue;
    const a = parseAnnouncement(m);
    if (a) out.push({ id: m.id, announcement: a });
  }
  return out;
}
```

**components/room/ChatMessageItem.tsx — edit 1 of 2.** Replace:

```tsx
import { parseChatMessageBody, MENTION_REGEX } from "@/lib/chat-helpers";
import { parseCatchAnnouncement } from "@/lib/game/fishing/announce";
import type { Member, Room } from "@/lib/supabase";
```

with:

```tsx
import { parseChatMessageBody, MENTION_REGEX } from "@/lib/chat-helpers";
import { parseAnnouncement } from "@/lib/game/fishing/announce";
import type { Member, Room } from "@/lib/supabase";
```

**components/room/ChatMessageItem.tsx — edit 2 of 2.** Replace:

```tsx
  const isMe = !!message.account_id && message.account_id === currentAccountId;
  // A rare catch posted by the server (v14): a system line — no avatar, no reply; the room admin may still delete it.
  const announcement = useMemo(() => parseCatchAnnouncement(message), [message]);
```

with:

```tsx
  const isMe = !!message.account_id && message.account_id === currentAccountId;
  // A rare catch (v14) or a land sale (v15) posted by the server: a system line — no avatar, no reply; the room admin
  // may still delete it.
  const announcement = useMemo(() => parseAnnouncement(message), [message]);
```

**lib/chat-notify.ts — edit 1 of 2.** Replace:

```ts
import { cleanNotificationText } from "@/lib/chat-helpers";
import { parseCatchAnnouncement } from "@/lib/game/fishing/announce";
```

with:

```ts
import { cleanNotificationText } from "@/lib/chat-helpers";
import { parseAnnouncement, parseCatchAnnouncement } from "@/lib/game/fishing/announce";
```

**lib/chat-notify.ts — edit 2 of 2.** Replace:

```ts

/** Pure: a message's desktop-notification text — the readable part of a catch announcement, else the cleaned body. */
export function notificationText(m: ChatMessage): string {
  return parseCatchAnnouncement(m)?.text ?? cleanNotificationText(m.body);
}
```

with:

```ts

/** Pure: a message's desktop-notification text — the readable part of a server announcement (a catch, a land sale),
 *  else the cleaned body. */
export function notificationText(m: ChatMessage): string {
  return parseAnnouncement(m)?.text ?? cleanNotificationText(m.body);
}
```

**components/game/GameShell.tsx — edit 1 of 2.** Replace:

```tsx

  // --- rare catches the server announced in the chat (my own catch shows the catch card instead)
  const announcedRef = useRef(new Set<string>());
```

with:

```tsx

  // --- rare catches and land sales the server announced in the chat (my own catch shows the catch card instead)
  const announcedRef = useRef(new Set<string>());
```

**components/game/GameShell.tsx — edit 2 of 2.** Replace:

```tsx
      announcedRef.current.add(id);
      if (announcement.accountId !== accountId) showToast(announcement.text);
    }
```

with:

```tsx
      announcedRef.current.add(id);
      if (announcement.kind !== "catch" || announcement.accountId !== accountId) showToast(announcement.text);
    }
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/unit/fishing-announce.test.ts tests/unit/chat-catch-line.test.tsx tests/unit/chat-notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Integration tests (run only with `SUPABASE_TEST_URL`)**

Create `tests/integration/v15.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// The land and farm RPCs end to end, as far as a fresh account can go without xu; the time-dependent season is
// covered by tests/sql/v15-smoke.sql.
run("v15 field and land", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("fa"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("dong"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };
  type Field = { server_now: string; plots: Array<{ no: number; kind: string; owner: unknown; farmer: unknown }>; mine: Record<string, unknown> };

  it("opens the field lazily: 10 plots, nothing of mine yet, the server's clock", async () => {
    const me = await reg();
    const r = await room(me.token);
    const s = await db.rpc("field_state", { p_room_id: r.room_id, p_session_token: me.token });
    expect(s.error).toBeNull();
    const f = s.data as Field;
    expect(f.plots.map((p) => [p.no, p.kind]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [1, "private"], [2, "private"], [3, "private"], [4, "private"],
      [5, "village"], [6, "village"], [7, "village"], [8, "village"], [9, "village"], [10, "village"],
    ]);
    expect(f.plots.every((p) => p.owner === null && p.farmer === null)).toBe(true);
    expect(f.mine).toMatchObject({ coins: 0, farming: [], owned_plot: null, gift_claimed: false });
    expect(Math.abs(Date.parse(f.server_now) - Date.now())).toBeLessThan(5 * 60_000);
    expect((await db.rpc("touch_room", { p_room_id: r.room_id, p_session_token: me.token })).error).toBeNull();
  });

  it("gives the newcomer gift once per account", async () => {
    const me = await reg();
    const a = await db.rpc("claim_farm_gift", { p_session_token: me.token });
    expect(a.error).toBeNull();
    expect(a.data).toMatchObject({ gifted: true, mine: { items: { seed_short: 1, fert_urea: 1 }, gift_claimed: true } });
    const b = await db.rpc("claim_farm_gift", { p_session_token: me.token });
    expect(b.data).toMatchObject({ gifted: false, mine: { items: { seed_short: 1, fert_urea: 1 } } });
  });

  it("refuses land it cannot pay for and plots it does not farm", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    expect((await call("rent_plot", { p_plot: 5 })).error?.message).toBe("not enough coins");
    expect((await call("buy_plot", { p_plot: 1 })).error?.message).toBe("not enough coins");
    expect((await call("rent_plot", { p_plot: 1 })).error?.message).toBe("invalid plot");
    expect((await call("offer_plot", { p_plot: 2, p_price: 100 })).error?.message).toBe("not for sale");
    expect((await call("prepare_plot", { p_plot: 5 })).error?.message).toBe("not your plot");
    expect((await call("water", { p_plot: 7, p_delta: 1 })).error?.message).toBe("not your plot");
    expect((await call("pick_snails", { p_plot: 7 })).error?.message).toBe("no snails");
    expect((await call("dry_start", { p_variety: "nep", p_kg: 5 })).error?.message).toBe("not enough rice");
  });

  it("keeps outsiders off the field", async () => {
    const owner = await reg();
    const stranger = await reg();
    const r = await room(owner.token);
    const s = await db.rpc("field_state", { p_room_id: r.room_id, p_session_token: stranger.token });
    expect(s.error?.message).toBe("account is not a member of this room");
    const t = await db.rpc("touch_room", { p_room_id: r.room_id, p_session_token: stranger.token });
    expect(t.error?.message).toBe("account is not a member of this room");
  });

  it("sells rice only when there is some, and farm items only at anh Hai", async () => {
    const me = await reg();
    expect((await db.rpc("sell_rice", { p_session_token: me.token, p_variety: "nep", p_dry: true, p_kg: 1 })).error?.message).toBe("not enough rice");
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).error?.message).toBe("not enough coins");
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "rod_bamboo", p_qty: 1 })).error?.message).toBe("item not available");
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).error?.message).toBe("item not available");
    const fishing = await db.rpc("fishing_state", { p_session_token: me.token });
    expect(typeof (fishing.data as { server_now?: unknown }).server_now).toBe("string");
  });

  it("lets anyone read the varieties and farm items but nobody read the fields directly", async () => {
    const { data: varieties } = await db.from("rice_varieties").select("id");
    expect((varieties ?? []).map((v) => v.id).sort()).toEqual(["nep", "short", "thom"]);
    const { data: items } = await db.from("shop_items").select("id").in("kind", ["seed", "fertilizer", "pesticide", "critter_box"]);
    expect(items ?? []).toHaveLength(11);
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
  });
});
```

**tests/integration/v14.test.ts.** Replace:

```ts
    const { data: species } = await db.from("fish_species").select("id");
    const { data: items } = await db.from("shop_items").select("id");
    expect(species ?? []).toHaveLength(12);
```

with:

```ts
    const { data: species } = await db.from("fish_species").select("id");
    // v15 adds farm items to shop_items: count the fishing kinds
    const { data: items } = await db.from("shop_items").select("id").in("kind", ["rod", "bobber", "bait", "bait_box", "bucket"]);
    expect(species ?? []).toHaveLength(12);
```

Run: `pnpm vitest run tests/integration/v15.test.ts tests/integration/v14.test.ts`
Expected: both files are collected and their tests are **skipped** (no `SUPABASE_TEST_URL`), no errors.

- [ ] **Step 6: README**

**README.md.** Append at the end of the file, after a blank line:

```markdown
## v15: Đồng ruộng — ruộng lúa và đất đai

### DB migration

`supabase/migrations/0013_v15_field.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop … if exists`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor after `0012`. It adds `rice_varieties` (3 varieties, public read) and 11 farm items in `shop_items` (the `kind` check gains `seed`, `fertilizer`, `pesticide` and `critter_box`); `members.last_seen_at`; the private tables `field_plots` (10 plots per room, made the first time anyone opens the field), `plot_leases`, `land_offers`, `crops`, `drying_slots`, `rice_stock` and `farm_profiles`, which only the RPCs touch; and the RPCs `field_state`, `touch_room`, the land RPCs (`rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot`, `buy_listed_plot`, `offer_plot`, `withdraw_offer`, `decline_offer`, `accept_offer`, `set_sublease`, `rent_sublease`, `abandon_crop`), the farming RPCs (`prepare_plot`, `apply_fertilizer`, `soak_seed`, `sow_seed`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`), `dry_start`, `dry_collect`, `sell_rice`, `buy_farm_item` and `claim_farm_gift`. It also limits `buy_item` to fishing gear and adds `server_now` to the fishing state. `tests/sql/v15-smoke.sql` checks all of it on a throwaway PostgreSQL cluster (run `psql` from the repo root: it reads `tests/fixtures/crop-cases.json`).

> **Deploy order:** apply `0013` to the hosted database **before** the v15 client goes live. A v15 client against a database without it shows the field with the banner "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013."; the hall, the pond and fishing keep working. Older clients never see the field (their presence says hall or pond) and ignore its `fp` / `fa` messages.

### What's new in v15 (15.1 "Ruộng lúa")

- **🌾 Đồng ruộng:** the hall's **Ra đồng** sign and the pond's **Cầu khỉ ra đồng** lead to one shared field per room: 4 private plots north of the canal, 6 village plots south of it, the **Hợp tác xã** (chú Tám), the **Tiệm vật tư** (anh Hai), the **Vựa lúa** (cô Út) and the drying yard. The chip at the top shows **🌾 Đồng N**.
- **Land:** rent a village plot for 250 xu a 4-day season (harvesting ends the lease), or buy one private plot per room for 4 000 xu (+10 % yield, no rent); nobody farms more than 2 plots. Owners list a plot for sale, sublet it for a season, accept or decline purchase offers, or sell it back to the village for 2 000 xu. A plot whose owner leaves the room or stays away 14 days is reclaimed with a 2 000 xu refund. Sales between players are announced in the chat by **Hợp tác xã**.
- **Rice:** a real wet-rice season in 2–3 days, in 3 varieties: prepare the plot, base-fertilize, soak, sow the seedbed, transplant, top-dress twice, dry the field, keep the water right (it drops a level every 12 h), treat golden apple snails, leaf folders, planthoppers and blast, drain, harvest, dry the grain on the yard (3 h) and sell it to cô Út (wet rice pays 70 %). The server rolls the pests secretly and computes the yield; the plot panel shows the next job, why a button is disabled and a yield estimate. **🌾 Việc đồng áng** lists what is due on your plots (a dot counts the urgent tasks) and **📖 Sổ tay nhà nông** explains every step.
- **Newcomers** get a bag of Giống lúa ngắn ngày and a bag of urea from chú Tám on their first visit.
- The fishing prompts now count down on the server's clock.

### Trust model (v15)

The server decides every time and phase, the water levels, the pests (rolled at sowing and hidden until they fire), the yield, all prices, and land ownership, leases and reclaims. A client reports only the transplant and harvest quality, clamped to [0.9, 1.1] behind a 2 s work gate (always 1.0 in 15.1), so a modified client gains at most 10 %. As in v14, where a player stands is not verified, and the plots' look and the farm animations come from each client's own copy of the field state.

### Realtime budget (v15)

The field has its own channel `game:{roomId}:field`. After a land or farm action the client sends at most two messages, `fa` (a 2.5 s animation) and `fp` (a plot changed); everyone on the field then fetches `field_state` once, 400 ms after the first `fp` of a burst. Farm actions are minutes apart, so that stays well under one RPC a minute per person. `touch_room` is one call per room visit.
```

- [ ] **Step 7: Final checks**

Run, from the repo root:
- `pnpm test` → all files pass except the skipped integration files (the plan author's run: 87 files passed / 10 skipped, 643 tests passed / 60 skipped).
- `npx tsc --noEmit` → clean.
- `pnpm lint` → the 54 baseline problems, none in a v15 file (`npx eslint` on every file this plan touched is clean).
- `pnpm build` → succeeds.
- The SQL of Task 1 Step 4 once more on a fresh cluster (0013 twice, the whole smoke test) → `v15 crop smoke ok`, `v15 land smoke ok`, `v15 farm smoke ok`.

- [ ] **Step 8: Commit**

```bash
git add lib/game/fishing/announce.ts components/room/ChatMessageItem.tsx lib/chat-notify.ts components/game/GameShell.tsx README.md tests/integration/v15.test.ts tests/integration/v14.test.ts tests/unit/fishing-announce.test.ts tests/unit/chat-catch-line.test.tsx tests/unit/chat-notify.test.ts
git commit -m "feat(v15): land-sale announcements, README, integration tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 9: Hand over to the owner (manual pass, two accounts, after running `0013` in the Supabase SQL editor)**

1. Travel hall → field (Ra đồng) → pond (Cầu khỉ) → field → hall; the chip counts 🌾 Đồng; a member card on the field reads "🌾 Đang ở đồng ruộng".
2. First field visit: chú Tám's gift toast; anh Hai's shop shows "có 1" for Giống lúa ngắn ngày and Phân urê, and the fishing bag (🎒) does not list them.
3. Rent a village plot at chú Tám (250 xu); the coins in the HUD drop.
4. A whole season on it: làm đất, bón lót, ngâm, gieo mạ (Ẩm), cấy (Nông; 3 s progress, Esc cancels), bón thúc, phơi ruộng, đón đòng, water up / down, spray a pest, pick snails (also from account B), rút nước, gặt. The task list and the urgent rings follow along; the other account sees the rice grow and the animations.
5. Dry the harvest (3 h) and sell dry and wet rice to cô Út.
6. Account A buys a private plot, subleases it; account B rents the sublease and farms it; A lists it, B offers, A accepts: the chat shows the 🏡 line as a system line, both see the toast.
7. Phone layout: the HUD button row wraps, panels scroll, the progress bar and "Huỷ" fit.

---

### Task 19: Ignore the farm quality in v15.1 (anti-cheat decision D1)

Added on 2026-09-25, after the anti-cheat audit (H3). The owner decided that v15.1 ignores the quality a client reports and always uses 1.0. The v15.2 minigames decide how a quality comes back. Until this task lands, a modified client could claim 1.1 and gain ×1.21 yield, while the honest v15.1 client always sends 1. The anti-cheat plan (`0015_anticheat.sql`) re-creates these functions and keeps this behaviour. See `docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md` §2 D1 and §6.4.

**Files:**
- Modify: `supabase/migrations/0013_v15_field.sql` (`_farm_do_transplant`, `_farm_do_harvest`)
- Modify: `tests/sql/v15-smoke.sql` (the transplant check)
- Modify: `README.md` (the v15 trust model, as Task 18 wrote it)
- Modify: `docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md` (the five lines that describe the clamp)

**Interfaces:**
- Consumes: Tasks 1–3 (0013 and the smoke test); Task 18 (the README's v15 section).
- Produces: `transplant(p_room_id, p_session_token, p_plot, p_quality)` and `harvest(p_room_id, p_session_token, p_plot, p_quality)` keep their signatures. The server ignores `p_quality`: it stores `crops.q_transplant = 1.0` and passes a harvest quality of 1.0 to `_crop_yield`. The client already sends 1 (Task 14), so nothing on the client changes.

- [ ] **Step 1: Expect the ignored quality in the smoke test**

**tests/sql/v15-smoke.sql.** Replace:

```sql
     and (select q_transplant from public.crops where room_id = room and plot_no = 8) = 1.1, 'transplanted, quality clamped';
```

with:

```sql
     and (select q_transplant from public.crops where room_id = room and plot_no = 8) = 1.0, 'transplanted, quality ignored (D1)';
```

- [ ] **Step 2: Run the smoke test to verify it fails**

Run the same commands as Task 1 Step 4: a fresh throwaway cluster on port 5499, `export PGCLIENTENCODING=UTF8`, run from the repo root.
Expected: `0013 ok`, `0013 re-run ok`, then psql stops with `ERROR:  transplanted, quality ignored (D1)`. The call passes 5.0, and today's code clamps it to 1.1.

- [ ] **Step 3: Ignore the quality in 0013**

**supabase/migrations/0013_v15_field.sql — edit 1 of 3.** Replace:

```sql
-- Cấy: the quality (v15.2 minigame; 1.0 in v15.1) is clamped to [0.9, 1.1].
```

with:

```sql
-- Cấy: v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1); v15.2 decides how it comes back.
```

**supabase/migrations/0013_v15_field.sql — edit 2 of 3.** Replace:

```sql
     set transplant_at = p_now, q_transplant = least(1.1, greatest(0.9, coalesce(p_quality, 1))),
```

with:

```sql
     set transplant_at = p_now, q_transplant = 1.0,
```

**supabase/migrations/0013_v15_field.sql — edit 3 of 3.** Replace:

```sql
                              least(1.1, greatest(0.9, coalesce(p_quality, 1))), p_now)->>'kg')::int;
```

with:

```sql
                              1.0, p_now)->>'kg')::int;
```

`p_quality` stays in both signatures and is unused, so the public RPCs and the client stay as they are.

- [ ] **Step 4: Run the smoke test**

Run the same commands as Task 1 Step 4.
Expected: no `FAILED`, then `0013 ok` and `0013 re-run ok`, then the smoke test prints `v15 crop smoke ok`, `v15 land smoke ok` and `v15 farm smoke ok`. The harvest check still passes: it recomputes the expected kilograms from the stored crop row, which now holds `q_transplant = 1.0`.

- [ ] **Step 5: README — the v15 trust model**

**README.md.** Replace:

```markdown
A client reports only the transplant and harvest quality, clamped to [0.9, 1.1] behind a 2 s work gate (always 1.0 in 15.1), so a modified client gains at most 10 %.
```

with:

```markdown
A client still sends a transplant and harvest quality, but v15.1 ignores it and uses 1.0 (anti-cheat decision D1) until the v15.2 minigames; transplanting and harvesting stay behind the 2 s work gate.
```

- [ ] **Step 6: The v15 spec — the five clamp lines**

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 1 of 5.** Replace:

```markdown
- **f) Minigame trust.** The quality bounds (0.9–1.1) and the 2-second work gate exist from `0013` on. The phase-2 minigames only change the client and need no SQL change.
```

with:

```markdown
- **f) Minigame trust.** The 2-second work gate exists from `0013` on. v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1); v15.2 decides how a minigame quality comes back, which needs an SQL change.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 2 of 5.** Replace:

```markdown
| `qT`, `qH` | transplant and harvest quality, clamped to [0.9, 1.1]; always 1.0 in v15.1 |
```

with:

```markdown
| `qT`, `qH` | transplant and harvest quality; always 1.0 in v15.1 (the server ignores the reported value, D1) |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 3 of 5.** Replace:

```markdown
3. They clamp `q` to [0.9, 1.1] and clear `work`.
```

with:

```markdown
3. They use `q` = 1.0 whatever the client sends (v15.1, D1) and clear `work`.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 4 of 5.** Replace:

```markdown
**Clients only report two things:** the transplant and harvest quality, clamped to [0.9, 1.1] behind a 2 s gate, and (v15.2) crab hits, bounded to 3 per hole visit.
```

with:

```markdown
**Clients only report two things:** the transplant and harvest quality, which v15.1 ignores (always 1.0, D1) behind a 2 s gate, and (v15.2) crab hits, bounded to 3 per hole visit.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 5 of 5.** Replace:

```markdown
Each returns a quality `q` in [0.9, 1.1].
```

with:

```markdown
Each returns a quality `q` in [0.9, 1.1]; how the server accepts it after D1 is decided in the v15.2 plan.
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0013_v15_field.sql tests/sql/v15-smoke.sql README.md docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md
git commit -m "fix(v15): v15.1 ignores the farm quality (anti-cheat D1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: The new farm prices (economy spec §3)

Added on 2026-09-25.
- **The owner set:** rent 10 000, land 800 000, and a profit of at least 50 000 for a well-cared season.
- **Everything else follows the controller's recommendations:** `docs/superpowers/specs/2026-09-25-music-together-economy-design.md` §2 (E1–E6), §3 and §4.
- **Scope:** only numbers change. No rule, flow or message changes, except that the three price checks are re-created by name, so running 0013 again on an existing database moves those checks too.

**The values (economy spec §3):**

| What | Old | New |
|---|---|---|
| Village rent (96 h, unchanged) | 250 | 10 000 |
| Private plot | 4 000 | 800 000 |
| Sell-back to the village, and the reclaim refund | 2 000 | 400 000 (still half) |
| Sublease price range | 1–5 000 | 1–100 000 |
| Sale listing and offer price range | 1–1 000 000 | 1–5 000 000 |
| seed_short / seed_nep / seed_thom | 60 / 90 / 150 | 600 / 900 / 1 500 |
| fert_manure / fert_phosphate / fert_urea / fert_potash / fert_npk | 40 / 50 / 60 / 60 / 90 | 400 / 500 / 600 / 600 / 900 |
| spray_insect / spray_hopper / spray_fungus | 70 / 80 / 90 | 700 / 800 / 900 |
| Dry rice xu/kg, short / nep / thom (wet stays 70 %) | 12 / 18 / 26 | 710 / 950 / 1 350 |

**Files:**
- Modify: `supabase/migrations/0013_v15_field.sql`:
  - the seed rows (`rice_varieties` :24–27, `shop_items` :40–51);
  - the inline price checks (:71, :72, :91), plus the named re-create block below;
  - the land literals and their comments: rent :786/:804/:807/:809, buy :813/:835/:838, sell-back :845/:864, reclaim refund :601, list :868/:882, offer :951, sublease :1027/:1041.
- Modify: `lib/game/farm/catalog.ts`: `RENT_PRICE`, `PLOT_PRICE`, `SELL_BACK_PRICE`, `SUBLEASE_MAX`, `SALE_MAX` (:55–60).
- Modify: `tests/sql/v15-smoke.sql`: the balances and the land and rice amounts; new checks for the caps and the re-created constraints.
- Modify: these unit tests, only where they assert the real constants or catalog-independent amounts:
  - `tests/unit/farm-land.test.ts` (:19, :31, :43, :57, :74);
  - `tests/unit/farm-panels.test.tsx`: the Coop part at :53, :152, :157, :165, :195–201;
  - `tests/unit/farm-plot-panel.test.tsx` (:104, :110);
  - `tests/unit/farm-overlays.test.tsx` (:20, :75).
  
  Mock catalogs with made-up prices (farm-catalog, farm-handbook, farm-crop, farm-rpc, farm-actions, use-farm-controller, game-crop-art, and the shop/depot parts of farm-panels) stay as they are.
- Modify: `README.md`: the **Land** bullet (:271).
- Modify: `docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md`:
  - the §7 land numbers (:168, :174–175, :179, :185, :195, :225) and :688–689;
  - the §8.1 table: xu/kg, and "Ripe after ≈", which is corrected to 52 / 58 / 66 h to match `2 + 56·s` and the code;
  - the §9 price table (:429–439);
  - the farming part of §10 (:448–466), replaced by a pointer to the economy spec §4 (the crab and snail part stays);
  - the D1 sentence at :567, which still says "a modified client gains at most +10 %". v15.1 ignores the reported quality, so a modified client gains nothing from it.
- Modify: `docs/superpowers/specs/2026-09-25-music-together-economy-design.md`: the hours in the §4 table become ≈52 / ≈58 / ≈66 h.

**Interfaces:**
- Consumes: Tasks 1–19. The land functions and the seeds are in 0013. `catalog.ts` holds the TS mirror. `formatXu` prints `10.000 xu`, `800.000 xu` and `400.000 xu`.
- Produces:
  - the constants above, same names and types;
  - the checks `field_plots_sale_price_check`, `field_plots_sublease_price_check` and `land_offers_price_check`, with the new bounds, on fresh and on upgraded databases.
  
  The anti-cheat plan's `bad_price` bounds must use the new caps. The controller refreshes that plan after v15.1.

- [ ] **Step 1: Move the tests to the new prices**

**Unit tests.** Change only what the new constants break:
- `farm-land.test.ts`:
  - the refusal just below a price becomes `ctx([free], 9_999)` for rent and `ctx([p2], 799_999)` for the plot;
  - the out-of-range offer becomes `5_000_001` and the out-of-range sublease `100_001`;
  - the default balance (:19) becomes `1_000_000`, so the null refusals at :27 and :39 still pay rent and the plot.
- `farm-panels.test.tsx`, Coop part:
  - Give the renter enough for 10 000 xu. The rent click at :157 must still rent.
  - The Coop part expects:
    - `"Thuê · 10.000 xu"` for rent;
    - `"Mua · 800.000 xu"` for the plot;
    - for sell-back: `"Bán lại cho làng · 400.000 xu"`, `"Làng chỉ trả 400.000 xu (một nửa giá) — bán lại thửa 2?"` and `"… nhận 400.000 xu."`.
  - The invalid sublease is `"100001"` (the button is disabled and shows `"Số không hợp lệ."`).
  - If the balance at :53 is shared with the shop part, keep the shop assertions exactly as they are ("1000 xu buys 11 sacks of seed" against the mock seed price 90). Give the rent case its own balance instead.
- `farm-plot-panel.test.tsx`: expects `"Thuê · 10.000 xu"` and `"Bán lại cho làng · 400.000 xu"`.
- `farm-overlays.test.tsx`: expects a balance that pays 10 000 (:20) and `"Thuê · 10.000 xu"` (:75).

**`tests/sql/v15-smoke.sql`.** Keep every scenario and every check's meaning: the same actor, the same action, the same ledger reason and the same refusal. Change only the amounts:
- **Starting balances (:159–161).** Scale them so every flow stays affordable at the new prices. For example: a1 = 2 000 000, a2 = 50 000, a3 = 2 000 000. a2 rents four times, and each `set_coins(…, 100)` must still be refused.
- **Land.** Rent is 10 000 (`delta = -10000`). The plot is 800 000 (`delta = -800000`). Sell-back and the reclaim refund are 400 000, including the comment at :286. Recompute every `pg_temp.coins(…) = …` that follows from these.
- **Sublease range (:259).** `_farm_do_set_sublease(…, 100001, …)` is `'invalid price'`, and a sublease of 100 000 is accepted.
- **Add the new caps next to the existing range checks:**
  - `_farm_do_list(…, 5000001, …)` and `_farm_do_offer(…, 5000001, …)` are `'invalid price'`.
  - A listing at 5 000 000 is accepted.
  - The constraints reject what the RPCs would: `pg_temp.err('update public.field_plots set sale_price = 5000001 …')` and `… sublease_price = 100001 …` return a check violation. So does an insert into `land_offers` with price 5 000 001.
- **Shop (:345–346).** Two manure cost 800 (`delta = -800`). The `set_coins(a2, 10)` refusal for seed_thom holds.
- **Rice (:482–488).** Short sells dry at 710 xu/kg: 10 kg pays `+ 7100`. Wet pays 70 %: 5 kg pays floor(5 × 710 × 0.7) = `2485`. Update the comment at :482.
- **Report.** List every number you changed, as `line: old → new`.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-land.test.ts tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-overlays.test.tsx`
Expected: failures on the new amounts, for example `"Thuê · 10.000 xu"` not found, and the land pre-checks at the new bounds.
Then run the SQL as in Task 1 Step 4. Expected: `0013 ok`, `0013 re-run ok`, `v15 crop smoke ok`, then psql stops at the first land check that uses a new amount.

- [ ] **Step 3: The new prices in 0013 and catalog.ts**

**0013, the seeds.** Put the new values in:
- the `price_per_kg` column of the three `rice_varieties` rows;
- the `price` column of the eleven farm rows of `shop_items`.

Change no other column.

**0013, the land functions.** Use the new literals everywhere the old ones appear, comments included:
- `_farm_do_rent`: 10000 in the balance check, `_pay`, and the lease `price`.
- `_farm_do_buy`: 800000.
- `_farm_do_sell_to_village`: 400000.
- The reclaim refund in `_field_open`: 400000.
- `_farm_do_list` and `_farm_do_offer`: `> 5000000`.
- `_farm_do_set_sublease`: `> 100000`.

Keep the comments' number style: `10 000 xu`, `800 000 xu`, `400 000 xu`, `1–5 000 000 xu`, `1–100 000 xu`.

**0013, the checks.**
1. In the `create table` statements, write the new bounds inline: `sale_price … between 1 and 5000000`, `sublease_price … between 1 and 100000`, `land_offers.price … between 1 and 5000000`.
2. Right after the `create table if not exists public.land_offers (…);` statement, add exactly:

```sql
-- The price caps (economy spec §3.1), re-created by name so that running this file again moves an existing database too.
alter table public.field_plots drop constraint if exists field_plots_sale_price_check;
alter table public.field_plots add constraint field_plots_sale_price_check check (sale_price between 1 and 5000000);
alter table public.field_plots drop constraint if exists field_plots_sublease_price_check;
alter table public.field_plots add constraint field_plots_sublease_price_check check (sublease_price between 1 and 100000);
alter table public.land_offers drop constraint if exists land_offers_price_check;
alter table public.land_offers add constraint land_offers_price_check check (price between 1 and 5000000);
```

**lib/game/farm/catalog.ts.** Replace:

```ts
// The land rules' numbers — the server's constants in 0013 (spec §7).
export const RENT_PRICE = 250;
export const PLOT_PRICE = 4000;
export const SELL_BACK_PRICE = 2000;
export const LEASE_HOURS = 96;
export const SUBLEASE_MAX = 5000;
export const SALE_MAX = 1_000_000;
```

with:

```ts
// The land rules' numbers — the server's constants in 0013 (spec §7; the prices are economy spec §3.1).
export const RENT_PRICE = 10_000;
export const PLOT_PRICE = 800_000;
export const SELL_BACK_PRICE = 400_000;
export const LEASE_HOURS = 96;
export const SUBLEASE_MAX = 100_000;
export const SALE_MAX = 5_000_000;
```

- [ ] **Step 4: Run the tests and the smoke test**

Run: `pnpm vitest run tests/unit/farm-land.test.ts tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-overlays.test.tsx && pnpm tsc --noEmit`
Expected: all pass, and tsc prints nothing.

Then run the SQL as in Task 1 Step 4, with one addition. Before the smoke test, run 0013 a third time on a database where the old checks exist:

```bash
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -c "alter table public.field_plots drop constraint field_plots_sale_price_check; alter table public.field_plots add constraint field_plots_sale_price_check check (sale_price between 1 and 1000000);"
"$PG/psql" -p 5499 -U postgres -v ON_ERROR_STOP=1 -q -f supabase/migrations/0013_v15_field.sql >/dev/null && echo "0013 upgrade ok"
```

This proves the re-create block replaces an old check.
Expected:
- no `FAILED`;
- `0013 ok`, `0013 re-run ok` and `0013 upgrade ok`;
- the smoke test prints `v15 crop smoke ok`, `v15 land smoke ok` and `v15 farm smoke ok`.

- [ ] **Step 5: README and the specs**

**README.md**, the **Land** bullet (:271):
- "rent a village plot for 10 000 xu a 4-day season";
- "buy one private plot per room for 800 000 xu";
- "sell it back to the village for 400 000 xu";
- "reclaimed with a 400 000 xu refund".

Nothing else in the bullet changes.

**The v15 spec:** make the edits listed under **Files**. Numbers use the spec's style (`10 000 xu`). The §10 farming part becomes one paragraph: "The farm numbers changed on 2026-09-25 (rent 10 000, plot 800 000, inputs ×10, rice 710 / 950 / 1 350 xu/kg). The per-variety profits, the poor-care and lost-crop cases and the time to buy land are in `2026-09-25-music-together-economy-design.md` §4." Keep the §10 heading, its v14 angler reference line, and the crab and snail part.

**The economy spec, §4:** ≈54 h → ≈52 h, ≈60 h → ≈58 h, ≈69 h → ≈66 h.

- [ ] **Step 6: Final checks**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm eslint lib/game/farm/catalog.ts tests/unit/farm-land.test.ts tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-overlays.test.tsx`
Expected:
- the full suite passes, with the integration files skipped;
- tsc prints nothing;
- eslint exits 0.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0013_v15_field.sql lib/game/farm/catalog.ts tests/sql/v15-smoke.sql tests/unit/farm-land.test.ts tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-overlays.test.tsx README.md docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md docs/superpowers/specs/2026-09-25-music-together-economy-design.md
git commit -m "feat(v15): the new farm prices (rent 10 000, land 800 000, rice pays)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: The fish price index (economy spec §5)

Added on 2026-09-25. The owner asked that fish prices follow the room: they start at today's prices in a poor room and rise with the room's average wealth, and they change every 3 hours with a random season factor. Spec: `docs/superpowers/specs/2026-09-25-music-together-economy-design.md` §5 (F1–F5). The anti-cheat plan re-creates `finish_cast` after this task, so it must keep the index pricing.

**Files:**
- Modify: `supabase/migrations/0013_v15_field.sql` (append section H: `fish_price_index`, 6 private helpers, and new versions of `finish_cast` and `fishing_board`)
- Modify: `tests/sql/v15-smoke.sql` (append the fish price checks)
- Create: `lib/game/fishing/prices.ts`
- Create: `tests/unit/fishing-prices.test.ts`
- Modify: `lib/game/fishing/rpc.ts` (`FishingBoard.prices`)
- Modify: `components/game/fishing/RecordsPanel.tsx` (the **Giá cá** tab)
- Modify: `tests/unit/fishing-rpc.test.ts`, `tests/unit/fishing-panels.test.tsx`
- Modify: `tests/integration/v15.test.ts`
- Modify: `README.md` (the v15 migration paragraph and the "What's new" list)

**Interfaces:**
- Consumes:
  - 0012's `finish_cast(text, uuid, boolean)` and `fishing_board(uuid, text)`; this task re-creates both with the same signatures and grants.
  - `members.last_seen_at` (0013 section A); `field_plots.owner_id`; `wallets.coins`; `fish_species.price_per_kg`.
- Produces:
  - **SQL (private):**
    - `_fish_period(timestamptz) → bigint`
    - `_room_wealth(uuid, timestamptz) → bigint`
    - `_fish_mult(bigint) → numeric`
    - `_fish_index(uuid, timestamptz) → fish_price_index`
    - `_fish_factor(uuid, text, bigint) → numeric`
    - `_fish_prices(uuid, timestamptz) → jsonb`
  - **SQL (public):** `fishing_board(...)` returns an extra key, `prices`: `{mult, wealth, ends_at, factors: {species_id: factor}}`.
  - **TS:**
    - `FishPrices`, `parseFishPrices`, `nowPricePerKg`, `trend`, `formatMult` and `endsAtText` in `lib/game/fishing/prices.ts`;
    - `FishingBoard.prices: FishPrices | null`.

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/fishing-prices.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import { endsAtText, formatMult, nowPricePerKg, parseFishPrices, trend, type FishPrices } from "@/lib/game/fishing/prices";

const P: FishPrices = { mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12, ca_loc: 0.93 } };

describe("fish prices (economy spec §5)", () => {
  it("prices a species per kg now: base × the room's multiplier × its season factor", () => {
    expect(nowPricePerKg({ id: "ca_ro", pricePerKg: 45 }, P)).toBe(113); // 45 × 2.24 × 1.12 = 112.896
    expect(nowPricePerKg({ id: "ca_loc", pricePerKg: 60 }, P)).toBe(125); // 60 × 2.24 × 0.93 = 124.992
    expect(nowPricePerKg({ id: "ca_ho", pricePerKg: 200 }, P)).toBe(448); // no factor: 1
  });
  it("marks the trend and formats the multiplier and the end of the period", () => {
    expect([trend(1.12), trend(0.93), trend(1)]).toEqual(["▲", "▼", ""]);
    expect(formatMult(2.24)).toBe("×2,24");
    expect(formatMult(1)).toBe("×1,00");
    expect(endsAtText("2026-09-25T08:00:00+00:00")).toBe("15:00");
    expect(endsAtText("nope")).toBe("—");
  });
  it("reads the board's prices defensively", () => {
    expect(parseFishPrices({ mult: 2.24, wealth: 100000, ends_at: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12, bad: "x" } }))
      .toEqual({ mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12 } });
    expect(parseFishPrices(undefined)).toBeNull();
    expect(parseFishPrices({ mult: 0.5, ends_at: "2026-09-25T08:00:00+00:00" })).toBeNull();
    expect(parseFishPrices({ mult: 2, ends_at: 5 })).toBeNull();
    expect(parseFishPrices({ mult: 2, wealth: "?", ends_at: "2026-09-25T08:00:00+00:00" }))
      .toEqual({ mult: 2, wealth: 0, endsAt: "2026-09-25T08:00:00+00:00", factors: {} });
  });
});
```

**tests/unit/fishing-rpc.test.ts — edit 1 of 1.** Replace:

```ts
      richest: [{ username: "Dat", coins: 900 }], myRank: 2, myCoins: 30,
    });
  });
```

with:

```ts
      richest: [{ username: "Dat", coins: 900 }], myRank: 2, myCoins: 30, prices: null,
    });
  });
  it("maps the board's fish prices", async () => {
    h.rpc.mockResolvedValue({ data: {
      records: [], mine: [], richest: [], my_rank: 1, my_coins: 0,
      prices: { mult: 2.24, wealth: 100000, ends_at: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12 } },
    }, error: null });
    expect((await fetchFishingBoard("room", "tok")).prices).toEqual(
      { mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12 } });
  });
```

**tests/unit/fishing-panels.test.tsx — edit 1 of 2.** Replace:

```tsx
    richest: [{ username: "Dat", coins: 900 }, { username: "An", coins: 120 }], myRank: 2, myCoins: 120,
  };
```

with:

```tsx
    richest: [{ username: "Dat", coins: 900 }, { username: "An", coins: 120 }], myRank: 2, myCoins: 120,
    prices: { mult: 2.24, wealth: 100000, endsAt: "2026-09-25T08:00:00+00:00", factors: { ca_ro: 1.12, ca_loc: 0.93 } },
  };
```

**tests/unit/fishing-panels.test.tsx — edit 2 of 2.** Replace:

```tsx
    expect(load).toHaveBeenCalledTimes(2);
  });
```

with:

```tsx
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("shows the room's fish prices: the multiplier, when they change, and each species now", async () => {
    render(<RecordsPanel catalog={CATALOG} load={async () => BOARD} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Giá cá" }));
    expect(await screen.findByText("Hệ số phòng ×2,24 · tài sản trung bình 100.000 xu · giá đổi lúc 15:00")).toBeInTheDocument();
    const [, ro, loc] = screen.getAllByRole("row");
    expect(within(ro).getByText("45 xu/kg")).toBeInTheDocument();
    expect(within(ro).getByText("113 xu/kg ▲")).toBeInTheDocument();
    expect(within(loc).getByText("60 xu/kg")).toBeInTheDocument();
    expect(within(loc).getByText("125 xu/kg ▼")).toBeInTheDocument();
    expect(screen.getByText("Giá chốt lúc câu được cá; bán sau vẫn giữ giá đó.")).toBeInTheDocument();
  });
  it("says so when the server sends no fish prices", async () => {
    render(<RecordsPanel catalog={CATALOG} load={async () => ({ ...BOARD, prices: null })} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("tab", { name: "Giá cá" }));
    expect(await screen.findByText("Chưa có bảng giá.")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/unit/fishing-prices.test.ts tests/unit/fishing-rpc.test.ts tests/unit/fishing-panels.test.tsx`
Expected:
- `fishing-prices.test.ts` fails to import `@/lib/game/fishing/prices`.
- In `fishing-rpc.test.ts`, "maps the board" fails, because `prices` is missing from the result, and "maps the board's fish prices" fails.
- In `fishing-panels.test.tsx`, both new tests fail: there is no "Giá cá" tab.

- [ ] **Step 3: The prices module, the board and the tab**

Create `lib/game/fishing/prices.ts` with exactly:

```ts
import type { FishSpecies } from "./catalog";

/** The room's fish price index from fishing_board (economy spec §5): the multiplier, the average wealth behind it,
 *  when the 3-hour period ends, and each species' season factor. */
export interface FishPrices {
  mult: number;
  wealth: number;
  endsAt: string;
  factors: Record<string, number>;
}

/** A species' price per kg now: base × the room's multiplier × its season factor (a missing factor counts as 1). */
export function nowPricePerKg(species: Pick<FishSpecies, "id" | "pricePerKg">, prices: FishPrices): number {
  return Math.round(species.pricePerKg * prices.mult * (prices.factors[species.id] ?? 1));
}

/** ▲ when the season factor is above 1, ▼ below 1, nothing at exactly 1. */
export function trend(factor: number): "▲" | "▼" | "" {
  return factor > 1 ? "▲" : factor < 1 ? "▼" : "";
}

/** "×2,24": two decimals with the Vietnamese comma. */
export function formatMult(m: number): string {
  return `×${m.toFixed(2).replace(".", ",")}`;
}

/** "15:00": when the period ends, in Vietnam time; "—" for an unreadable time. */
export function endsAtText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(d);
}

/** fishing_board's `prices`, read defensively: anything malformed gives null (a server without the index). */
export function parseFishPrices(v: unknown): FishPrices | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const mult = Number(o.mult);
  if (!Number.isFinite(mult) || mult < 1 || typeof o.ends_at !== "string") return null;
  const wealth = Number(o.wealth);
  const factors: Record<string, number> = {};
  if (o.factors && typeof o.factors === "object") {
    for (const [id, f] of Object.entries(o.factors as Record<string, unknown>)) {
      const n = Number(f);
      if (Number.isFinite(n) && n > 0) factors[id] = n;
    }
  }
  return { mult, wealth: Number.isFinite(wealth) ? wealth : 0, endsAt: o.ends_at, factors };
}
```

**lib/game/fishing/rpc.ts — edit 1 of 3.** Replace:

```ts
import { parseFishingState, type FishingState, type Loadout } from "./state";
```

with:

```ts
import { parseFishPrices, type FishPrices } from "./prices";
import { parseFishingState, type FishingState, type Loadout } from "./state";
```

**lib/game/fishing/rpc.ts — edit 2 of 3.** Replace:

```ts
  myRank: number;
  myCoins: number;
}
```

with:

```ts
  myRank: number;
  myCoins: number;
  /** The room's fish price index (economy spec §5); null from a server without it. */
  prices: FishPrices | null;
}
```

**lib/game/fishing/rpc.ts — edit 3 of 3.** Replace:

```ts
    myCoins: Number(r.my_coins ?? 0),
  };
```

with:

```ts
    myCoins: Number(r.my_coins ?? 0),
    prices: parseFishPrices(r.prices),
  };
```

**components/game/fishing/RecordsPanel.tsx — edit 1 of 4.** Replace:

```tsx
import type { FishingBoard } from "@/lib/game/fishing/rpc";

type Tab = "records" | "richest";

/** 🏆 Bảng kỷ lục (spec §10.2): the room's record per species next to my best, and the room's richest members. */
```

with:

```tsx
import { endsAtText, formatMult, nowPricePerKg, trend } from "@/lib/game/fishing/prices";
import type { FishingBoard } from "@/lib/game/fishing/rpc";

type Tab = "records" | "richest" | "prices";

/** 🏆 Bảng kỷ lục (spec §10.2): the room's record per species next to my best, the room's richest members, and the
 *  room's fish prices now (economy spec §5.8). */
```

**components/game/fishing/RecordsPanel.tsx — edit 2 of 4.** Replace:

```tsx
  const tabButton = (t: Tab, label: string) => (
```

with:

```tsx
  const prices = board?.prices ?? null;
  const tabButton = (t: Tab, label: string) => (
```

**components/game/fishing/RecordsPanel.tsx — edit 3 of 4.** Replace:

```tsx
          {tabButton("richest", "Đại gia")}
        </div>
```

with:

```tsx
          {tabButton("richest", "Đại gia")}
          {tabButton("prices", "Giá cá")}
        </div>
```

**components/game/fishing/RecordsPanel.tsx — edit 4 of 4.** Replace:

```tsx
            <p className="text-burgundy">Bạn: hạng {board.myRank} · {formatXu(board.myCoins)}</p>
          </>
        )}
```

with:

```tsx
            <p className="text-burgundy">Bạn: hạng {board.myRank} · {formatXu(board.myCoins)}</p>
          </>
        )}
        {board && tab === "prices" && (
          prices ? (
            <>
              <p>
                Hệ số phòng {formatMult(prices.mult)} · tài sản trung bình {formatXu(prices.wealth)} · giá đổi lúc{" "}
                {endsAtText(prices.endsAt)}
              </p>
              <table className="w-full text-left">
                <thead className="text-base opacity-80">
                  <tr><th>Loài</th><th>Gốc</th><th>Bây giờ</th></tr>
                </thead>
                <tbody>
                  {(catalog?.species ?? []).map((s) => (
                    <tr key={s.id}>
                      <td className="flex items-center gap-1.5 py-0.5">
                        <ItemIcon id={s.id} scale={2} />
                        <span style={{ color: RARITY_COLOR[s.rarity] }}>{s.name}</span>
                      </td>
                      <td>{formatXu(s.pricePerKg)}/kg</td>
                      <td>{formatXu(nowPricePerKg(s, prices))}/kg {trend(prices.factors[s.id] ?? 1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-base opacity-80">Giá chốt lúc câu được cá; bán sau vẫn giữ giá đó.</p>
            </>
          ) : (
            <p className="opacity-70">Chưa có bảng giá.</p>
          )
        )}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/fishing-prices.test.ts tests/unit/fishing-rpc.test.ts tests/unit/fishing-panels.test.tsx && pnpm tsc --noEmit`
Expected: all three files pass, and tsc prints nothing.

- [ ] **Step 5: Expect the index in the smoke test**

**tests/sql/v15-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- the fish price index (economy spec §5) ----------
insert into smoke select 'froom', room_id::text from public.create_room('Ao giá', 'pw', (select v from smoke where k = 't2'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'froom')::uuid), 'pw',
                        (select v from smoke where k = 't1'));

do $$
declare room uuid := (select v from smoke where k = 'froom')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        p1 bigint; p2 bigint; w bigint; r public.fish_price_index; cid uuid; res jsonb; b jsonb;
begin
  -- the law (§5.3) and the 3-hour Vietnam periods (§5.4)
  assert public._fish_mult(0) = 1 and public._fish_mult(20000) = 1 and public._fish_mult(100000) = 2.24
     and public._fish_mult(500000) = 5 and public._fish_mult(1000000) = 7.07 and public._fish_mult(2000000) = 10
     and public._fish_mult(90000000) = 10, 'the multiplier law';
  assert public._fish_period('2026-01-01 03:00:00+07') = public._fish_period('2026-01-01 00:00:00+07') + 1
     and public._fish_period('2026-01-01 02:59:59+07') = public._fish_period('2026-01-01 00:00:00+07'), '3-hour periods, VN time';
  -- the wealth (§5.2): the average of xu + 800 000 per private plot owned, over the members seen in the last 14 days
  insert into public.wallets (account_id, coins) values (a1, 150000), (a2, 50000)
  on conflict (account_id) do update set coins = excluded.coins;
  p1 := (select count(*) from public.field_plots where owner_id = a1);
  p2 := (select count(*) from public.field_plots where owner_id = a2);
  w := ((150000 + 800000 * p1) + (50000 + 800000 * p2)) / 2;
  assert public._room_wealth(room, now()) = w, 'the average assets of the active members';
  update public.members set last_seen_at = now() - interval '15 days', joined_at = now() - interval '20 days'
   where room_id = room and account_id = a1;
  assert public._room_wealth(room, now()) = 50000 + 800000 * p2, 'a member away 14 days does not count';
  update public.members set last_seen_at = now() where room_id = room and account_id = a1;
  -- the snapshot (§5.5)
  r := public._fish_index(room, now());
  assert r.period = public._fish_period(now()) and r.wealth = w and r.mult = public._fish_mult(w), 'the snapshot';
  -- the season factors (§5.6): deterministic, in [0.80, 1.39]
  assert (select min(public._fish_factor(room, s.id, g)) >= 0.80 and max(public._fish_factor(room, s.id, g)) <= 1.39
            from public.fish_species s, generate_series(0, 200) g), 'factors in range';
  assert public._fish_factor(room, 'ca_ro', 7) = public._fish_factor(room, 'ca_ro', 7), 'factors are deterministic';
  -- a catch (§5.7): base × kg × M × S of the room's snapshot, stored with the fish
  delete from public.fish where account_id = a1;
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (a1, room, 'ca_ro', 200, 2000, now() - interval '10 seconds', now() + interval '60 seconds')
  on conflict (account_id) do update set id = gen_random_uuid(), room_id = excluded.room_id, species_id = excluded.species_id,
    weight_g = excluded.weight_g, min_reel_ms = excluded.min_reel_ms, bite_at = excluded.bite_at, expires_at = excluded.expires_at
  returning id into cid;
  res := public.finish_cast((select v from smoke where k = 't1'), cid, true);
  assert res->>'result' = 'caught'
     and (res->'fish'->>'price')::int
         = greatest(1, round(45 * 200 / 1000.0 * r.mult * public._fish_factor(room, 'ca_ro', r.period))::int)
     and (select price from public.fish where id = (res->'fish'->>'id')::uuid) = (res->'fish'->>'price')::int,
    'the catch is priced by the index';
  -- the board (§5.7)
  b := public.fishing_board(room, (select v from smoke where k = 't1'))->'prices';
  assert (b->>'mult')::numeric = r.mult and (b->>'wealth')::bigint = w
     and (b->>'ends_at')::timestamptz = to_timestamp((r.period + 1) * 10800 - 25200)
     and (select count(*) from jsonb_object_keys(b->'factors')) = (select count(*) from public.fish_species)
     and (b->'factors'->>'ca_ro')::numeric = public._fish_factor(room, 'ca_ro', r.period), 'the board shows the index';
  -- inside its period the snapshot holds; the next period recomputes it
  update public.wallets set coins = coins + 100000000 where account_id = a1;
  assert (public._fish_index(room, now())).mult = r.mult, 'stable inside its period';
  assert (public._fish_index(room, now() + interval '3 hours')).mult = 10, 'recomputed in the next period';
  assert not has_table_privilege('anon', 'public.fish_price_index', 'select'), 'the index is private';
end $$;

select 'v15 fish price smoke ok' as result;
```

- [ ] **Step 6: Run the smoke test to verify it fails**

Run the same commands as Task 1 Step 4: a fresh throwaway cluster on port 5499, `export PGCLIENTENCODING=UTF8`, run from the repo root.
Expected:
- `0013 ok` and `0013 re-run ok`;
- the smoke test prints `v15 crop smoke ok`, `v15 land smoke ok` and `v15 farm smoke ok`;
- psql then stops inside the fish price block with an error that `public.fish_price_index` (type) or `public._fish_mult` does not exist.

- [ ] **Step 7: The fish price index in 0013**

**supabase/migrations/0013_v15_field.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- H. The fish price index (economy spec §5): the room's wealth sets a 3-hourly multiplier ----------
create table if not exists public.fish_price_index (                -- one snapshot per room, replaced each 3-hour period
  room_id uuid primary key references public.rooms(id) on delete cascade,
  period bigint not null,
  wealth bigint not null check (wealth >= 0),
  mult numeric(5,2) not null check (mult between 1 and 10),
  computed_at timestamptz not null
);
alter table public.fish_price_index enable row level security;
revoke all on public.fish_price_index from public, anon, authenticated;

-- 3-hour periods aligned to Vietnam time: boundaries at 00:00, 03:00, …, 21:00 (UTC+7) (§5.4).
create or replace function public._fish_period(p_now timestamptz) returns bigint
language sql immutable set search_path = public, extensions
as $$ select floor((extract(epoch from p_now) + 25200) / 10800)::bigint $$;

-- The floor of the average assets (xu plus 800 000 per private plot owned, in any room) of the room's members seen
-- in the last 14 days (§5.2); 0 when there are none.
create or replace function public._room_wealth(p_room uuid, p_now timestamptz) returns bigint
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(floor(avg(coalesce(w.coins, 0)
                            + 800000 * (select count(*) from public.field_plots fp where fp.owner_id = m.account_id))), 0)::bigint
    from public.members m
    left join public.wallets w on w.account_id = m.account_id
   where m.room_id = p_room and coalesce(m.last_seen_at, m.joined_at) > p_now - interval '14 days'
$$;

-- M = round(least(10, greatest(1, sqrt(W / 20 000))), 2) (§5.3).
create or replace function public._fish_mult(p_wealth bigint) returns numeric
language sql immutable set search_path = public, extensions
as $$ select round(least(10, greatest(1, sqrt(greatest(p_wealth, 0) / 20000.0))), 2) $$;

-- The room's snapshot for the period of p_now (§5.5): stored the first time the period is asked for; concurrent
-- first callers all end up with the first snapshot written.
create or replace function public._fish_index(p_room uuid, p_now timestamptz) returns public.fish_price_index
language plpgsql security definer set search_path = public, extensions
as $$
declare v_period bigint := public._fish_period(p_now); v_wealth bigint; r public.fish_price_index;
begin
  select * into r from public.fish_price_index where room_id = p_room;
  if found and r.period >= v_period then
    return r;
  end if;
  v_wealth := public._room_wealth(p_room, p_now);
  insert into public.fish_price_index (room_id, period, wealth, mult, computed_at)
  values (p_room, v_period, v_wealth, public._fish_mult(v_wealth), p_now)
  on conflict (room_id) do update
    set period = excluded.period, wealth = excluded.wealth, mult = excluded.mult, computed_at = excluded.computed_at
    where public.fish_price_index.period < excluded.period;
  select * into r from public.fish_price_index where room_id = p_room;
  return r;
end; $$;

-- S = trunc(0.80 + 0.60 × h, 2), h from the first 32 bits of md5(room:species:period) (§5.6): in [0.80, 1.39].
create or replace function public._fish_factor(p_room uuid, p_species text, p_period bigint) returns numeric
language sql immutable set search_path = public, extensions
as $$
  select trunc(0.80 + 0.60 * (('x' || left(md5(p_room::text || ':' || p_species || ':' || p_period::text), 8))::bit(32)::bigint
                              / 4294967296.0), 2)
$$;

-- What the board shows (§5.7): the multiplier, the wealth behind it, when the period ends and every species' factor.
create or replace function public._fish_prices(p_room uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.fish_price_index := public._fish_index(p_room, p_now);
begin
  return jsonb_build_object(
    'mult', r.mult, 'wealth', r.wealth, 'ends_at', to_timestamp((r.period + 1) * 10800 - 25200),
    'factors', coalesce((select jsonb_object_agg(s.id, public._fish_factor(p_room, s.id, r.period)) from public.fish_species s),
                        '{}'::jsonb));
end; $$;

-- v14's finish_cast (0012) with one change: the catch is priced with the room's fish price index (§5.7).
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
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
  -- the room's fish price index at the catch (economy spec §5.7); a cast whose room is gone keeps the base price
  if c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    r := public._fish_index(c.room_id, now());
    v_mult := r.mult;
    v_factor := public._fish_factor(c.room_id, sp.id, r.period);
  end if;
  v_price := greatest(1, round(sp.price_per_kg * c.weight_g / 1000.0 * v_mult * v_factor)::int);
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

-- v14's fishing_board (0012) plus the room's fish prices (§5.7).
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
    'my_coins', v_coins,
    'prices', public._fish_prices(p_room_id, now()));
end; $$;

revoke all on function public._fish_period(timestamptz) from public, anon, authenticated;
revoke all on function public._room_wealth(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._fish_mult(bigint) from public, anon, authenticated;
revoke all on function public._fish_index(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._fish_factor(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public._fish_prices(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.finish_cast(text, uuid, boolean) to anon, authenticated;
grant execute on function public.fishing_board(uuid, text) to anon, authenticated;
```

Two notes:
- `finish_cast` and `fishing_board` are 0012's functions, copied byte for byte except for the lines marked §5.7.
- `create or replace` keeps their grants. The two `grant` lines restate them for readers.

- [ ] **Step 8: Run the smoke test**

Run the same commands as Task 1 Step 4.
Expected:
- no `FAILED` line;
- `0013 ok` and `0013 re-run ok`;
- the smoke test prints `v15 crop smoke ok`, `v15 land smoke ok`, `v15 farm smoke ok` and `v15 fish price smoke ok`.

`tests/sql/v14-smoke.sql` still runs after 0012 only, as its header says. After 0013 its catch-price check no longer holds, because prices now carry the room's factor.

- [ ] **Step 9: The integration test and the README**

**tests/integration/v15.test.ts — edit 1 of 1.** Replace:

```ts
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
  });
```

with:

```ts
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers", "fish_price_index"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
  });

  it("prices fish by the room: a new room pays today's prices, with a season factor per species", async () => {
    const me = await reg();
    const r = await room(me.token);
    const b = await db.rpc("fishing_board", { p_room_id: r.room_id, p_session_token: me.token });
    expect(b.error).toBeNull();
    const p = (b.data as { prices: { mult: number; wealth: number; ends_at: string; factors: Record<string, number> } }).prices;
    expect(p.mult).toBe(1);
    expect(p.wealth).toBe(0);
    expect(Date.parse(p.ends_at) - Date.now()).toBeLessThanOrEqual(3 * 3600_000);
    const { data: species } = await db.from("fish_species").select("id");
    expect(Object.keys(p.factors).sort()).toEqual((species ?? []).map((s) => s.id).sort());
    expect(Object.values(p.factors).every((f) => f >= 0.8 && f <= 1.39)).toBe(true);
  });
```

**README.md — edit 1 of 2.** Replace:

```markdown
It also limits `buy_item` to fishing gear and adds `server_now` to the fishing state.
```

with:

```markdown
It also limits `buy_item` to fishing gear, adds `server_now` to the fishing state, prices every catch with the room's fish price index (`finish_cast`; the private table `fish_price_index` keeps one snapshot per room and 3-hour period) and adds the index to `fishing_board`.
```

**README.md — edit 2 of 2.** Replace:

```markdown
- The fishing prompts now count down on the server's clock.
```

with:

```markdown
- The fishing prompts now count down on the server's clock.
- **Giá cá:** fish prices follow the room. Every 3 hours (00:00, 03:00, … Vietnam time) the room's multiplier is set from the average wealth of the members seen in the last 14 days (xu plus 800 000 per private plot owned): ×1 up to 20 000 xu, then the square root of wealth ÷ 20 000, at most ×10. Each species also gets a season factor from ×0.80 to ×1.39. A fish's price is fixed when it is caught. The records panel's **Giá cá** tab shows the multiplier, when it changes and every species' price now.
```

- [ ] **Step 10: Final checks**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm eslint lib/game/fishing/prices.ts lib/game/fishing/rpc.ts components/game/fishing/RecordsPanel.tsx tests/unit/fishing-prices.test.ts tests/unit/fishing-rpc.test.ts tests/unit/fishing-panels.test.tsx tests/integration/v15.test.ts`
Expected:
- the full suite passes, with the integration files skipped;
- tsc prints nothing;
- eslint exits 0.

- [ ] **Step 11: Commit**

```bash
git add supabase/migrations/0013_v15_field.sql tests/sql/v15-smoke.sql lib/game/fishing/prices.ts tests/unit/fishing-prices.test.ts lib/game/fishing/rpc.ts components/game/fishing/RecordsPanel.tsx tests/unit/fishing-rpc.test.ts tests/unit/fishing-panels.test.tsx tests/integration/v15.test.ts README.md
git commit -m "feat(v15): fish prices follow the room's wealth every 3 hours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
