# Music Together v17 — "Mùa chuột" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the harvest-season rats, the slingshot (ná) and the dog (chó cỏ): rats come out of the bunds and eat ripe rice, khoai and bắp (at most 10 % of a crop) until someone catches them, anyone on the field can shoot one with the ná's aim-and-release minigame, a fed dog follows its owner on every map and pounces on a nearby rat every 5 minutes, and cô Út buys the rats at the room's fish multiplier fixed at the catch — server-authoritative, behind the anti-cheat guards.

**Architecture:** Migration `0019_v17_rats.sql` (sections A–F) adds the catalog (rat food, the ná, the pellets, the dog food, the ledger reasons `rat_sell` and `dog_adopt`), the private tables (`field_rats`, `rat_clocks`, `rat_bag`, `dogs`, `sling_aims`, a rat log per crop) and the rat model (a deterministic spawn clock, rat-hours and Mrat in both yields) (A–C); the lazy rat sweep in `_field_open`, the catch caps, the catch and the field state's `rats` (D); the 7 guarded RPCs and the allowlisted `dog_state` (E); and `0018`'s anti-cheat snapshot and wipe, which take the dog and the rats too (F). `tests/sql/v17-smoke.sql` checks it against the shared fixtures and ends with the guard file. On the client, `lib/game/farm/rats.ts` mirrors the damage and draws every rat from its seed, `sling.ts` is the minigame's seeded state machine, `lib/game/dog.ts` holds the dog's rules and its follower, `lib/game/pack.ts` steps the world's dogs and rats; the state and RPC layer read the new fields; presence carries the dog; the engine draws dogs and rats and offers a rat as a synthetic prompt; `useField`, `useFarmController` and `useDog` drive the calls, the SlingGame, the auto-hunt and the dog; and the shop, the depot, the bag, the plot panel, the handbook, the HUD and the admin tab show it all.

**Tech Stack:** Next.js 16.2.9 (App Router, client components), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom + RTL, pnpm 11, PostgreSQL 18 (a throwaway local cluster for the SQL checks).

**Spec:** `docs/superpowers/specs/2026-09-26-music-together-v17-rats-design.md` — the controller's decisions C1–C9 and the rulings D1–D30. Read it before starting any task: every section number below (§…) refers to it unless another spec is named. The anti-cheat spec (`2026-09-25-music-together-anticheat-design.md`) §11.3 rules 1–7 bind every SQL task.

## Global Constraints

- **Start** from `feat/v15-field` at `793f8b4`: v15.1, `0014`, the anti-cheat layer `0015`, v15.2 (`0016`), v16 (`0017`) and v15.3 (`0018`), each with its fix round, as reviewed up to `793f8b4`. Work on the branch the owner names (suggested: `feat/v17`, created from that state, in place — no worktree). One commit per task, with the message the task gives; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The messages contain quotes and apostrophes: write each one to a file and commit with `git commit -F <file>`.
- **Package manager pnpm** (`pnpm test`, `pnpm lint`, `pnpm build`). Typecheck: `npx tsc --noEmit` (a checkout that has never run `next build` or `next dev` has no `next-env.d.ts` and fails on the `@/public/logo.png` imports: run either once, or write a `next-env.d.ts` with the two lines `/// <reference types="next" />` and `/// <reference types="next/image-types/global" />`; it is gitignored). One test file: `pnpm vitest run tests/unit/<file>`.
- **Baseline** (Task 1 records yours): on `793f8b4`, `pnpm test` → 119 files passed / 14 skipped (1232 tests passed / 79 skipped), `npx tsc --noEmit` clean, `pnpm lint` 33 pre-existing problems (21 errors, 12 warnings), none in a file this plan creates or modifies. After Task 18: 129 files passed / 15 skipped (1409 tests passed / 81 skipped); lint unchanged. Every file you create or modify must lint clean: `npx eslint <your files>`.
- **Next.js 16.2.9 is not the Next.js you know** (`AGENTS.md`): before using any Next.js API, read its guide in `node_modules/next/dist/docs/`. This plan adds no route, no config and no Next.js API; its components are client components under the existing `"use client"` shells.
- **React hook lint rules** (eslint-plugin-react-hooks 7, the React Compiler rules): no `ref.current` reads or writes during render, no synchronous `setState` directly in an effect body (callbacks, timers, `requestAnimationFrame` and promise continuations are fine), no `Date.now()` / `Math.random()` / `performance.now()` during render, and a helper an effect uses lives at module level when it needs nothing from the component. Hooks that drive the canvas take a getter `canvas: () => GameCanvasHandle | null`, never a ref object.
- **The controller's `closes` guard** (793f8b4): an action that awaits a server answer and then plants, animates or opens an overlay captures `closes.current` before the call and drops the answer unless the count is unchanged and `canvas()?.mapId() === "field"` (Tasks 15, 16).
- **Tests:** Vitest runs without globals, so Testing Library does not clean up by itself: every component or hook test file calls `cleanup()` in an `afterEach`. Vitest 4's fake timers also fake `requestAnimationFrame` (16 ms frames) and `performance.now()`. jsdom has no 2D canvas: a test that draws stubs `HTMLCanvasElement.prototype.getContext`. Pure logic lives in `lib/` with tests in `tests/unit/`; a module a test imports must not reach `@/lib/supabase` unless the test mocks it. The machine may be loaded: the heavy loops carry a timeout and collect their failures before one assertion.
- **Overlays:** every new overlay takes the canvas's input through `lib/game/overlays.ts` (`OpenOverlays`, `overlayLocks`), never through a new inline condition in `GameShell.tsx`: SlingGame is `slingGame` (blocking only, like `farmWork`, Task 15), DogPanel is `dogPanel` (both locks, Task 16).
- **UI copy** is Vietnamese; use the strings given in the tasks verbatim (they come from spec §10.6, §12 and §13). Numbers in `vi-VN` (`3.000 xu`, via `formatXu` or `toLocaleString("vi-VN")`).
- **Art** is original pixel art drawn in code (string grids and procedural painters), never copied from any game. The repo is public: no copyrighted assets, no secrets.
- **Never type a literal invisible character** (zero-width, bidi control, odd space, combining mark, or the emoji variation selector U+FE0F) into a source file: SQL writes them as escapes (`U&'\200B'`, or a regular-expression escape), TypeScript as `"\u200b"` — an emoji that needs U+FE0F is written `"\u270f\ufe0f"` (the pencil on Task 16's "Đổi tên" button). Emoji that need no selector (🐀, 🐕, 🎯, 🐾) are typed as they are.
- **SQL** is additive and re-runnable (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`, seeds `on conflict (id) do update`), every function has `set search_path = public, extensions`, every re-created public RPC keeps its signature and gets an explicit `grant execute … to anon, authenticated`, every private helper gets `revoke all … from public, anon, authenticated`, and every time rule lives in a private function that takes `p_now`. **The anti-cheat rules for later migrations** (anti-cheat spec §11.3) apply: each new game RPC starts guarded with `_ac_account` / `_ac_play`; a re-created guarded RPC keeps its guard, checks and grant; a re-created shared function keeps the parts of every migration before it (each body is copied from its latest definition, with only the lines marked `v17` added); the `coin_ledger` reason check keeps `'wipe'` and every later reason; `tests/sql/anticheat-guards.sql`'s dynamic loop gains the new RPCs and its allowlist the read-only `dog_state(text)`. The owner runs migrations in the Supabase SQL editor — never run anything against a hosted database from here.
- **Local PostgreSQL:** never touch the installed PostgreSQL 18 service, its data directory or port 5432. Tasks 1–4 check the SQL on a throwaway cluster (`initdb --auth=trust`, port **5493**, in your session scratchpad `$SCRATCH`), always with `PGCLIENTENCODING=UTF8`, from the **repo root** (the smokes re-run migrations with `\i` and read `tests/fixtures/*.json` with `\copy`). The cluster mirrors Supabase's grants (`anon` and `authenticated` get every right on each new table and function unless a migration revokes it), and it replays the migrations in the production order: `0004`…`0012`, the v14 smoke (its catch prices hold after `0012` only), `0014`, `0013`, `0015`, `0016`, `0017`, `0018`, then `0019` twice; then the lyrics, v15, anti-cheat, v15.2, v16 and gather smokes; `0019` again and the v17 smoke; `0019` again and the v17 smoke once more. Every smoke that grows crops switches the rats off in its rooms (`pg_temp.no_rats`, Task 2). Every file runs with plain `psql -f`, **outside any open transaction and never under `psql -1`**: `tests/sql/anticheat-guards.sql` runs its own `begin; … rollback;` self-test. Create the check script once, in Git Bash, as `$SCRATCH/v17-sql.sh` (outside the repository) with:

```bash
#!/usr/bin/env bash
# The SQL check of the v17 plan on a throwaway PostgreSQL 18 cluster (trust auth, Supabase's default grants).
# Run it from the repo root:  SCRATCH=<your scratchpad> bash "$SCRATCH/v17-sql.sh"
# Fresh cluster → 0004…0012 → the v14 smoke (it holds after 0012 only) → 0014 → 0013 → 0015 → 0016 → 0017 → 0018 →
# 0019 twice (the production order) → the lyrics, v15, anti-cheat, v15.2, v16 and gather smokes → 0019 again → the v17
# smoke → 0019 again → the v17 smoke again. The lyrics smoke runs once (it counts the rows it wrote). The v15 smoke's
# last section re-runs 0013, the anti-cheat smoke 0015, the v15.2 smoke 0016 (and 0018 after each), the v16 smoke 0017
# and the gather smoke 0018: they put back their own versions of functions 0019 re-creates, so 0019 runs again after
# them, and the v17 smoke runs last (its sales and adoptions write ledger reasons the earlier checks lack). Prints the
# smokes' "ok" rows and ALL OK, or FAILED and the end of the log. Leaves no cluster behind. Every file runs with plain
# `psql -f`, outside any open transaction and never under `psql -1`: tests/sql/anticheat-guards.sql (which the
# anti-cheat, v15.2, v16, gather and v17 smokes end with) runs its own `begin; … rollback;` self-test.
set -u
export PGCLIENTENCODING=UTF8
PORT=5493
PG="/c/Program Files/PostgreSQL/18/bin"
D="$SCRATCH/pg-v17"
LOG="$SCRATCH/v17-sql.log"
PSQL=("$PG/psql" -p $PORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
: > "$LOG"
fail() { echo "FAILED: $1"; tail -15 "$LOG"; "$PG/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1; rm -rf "$D"; exit 1; }
"$PG/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1; rm -rf "$D"
"$PG/initdb" -D "$D" -U postgres --auth=trust -E UTF8 >>"$LOG" 2>&1 || fail initdb
"$PG/pg_ctl" -D "$D" -o "-p $PORT" -l "$D/server.log" start >>"$LOG" 2>&1 || fail "cluster start"
for i in 1 2 3 4 5 6 7 8 9 10; do "$PG/pg_isready" -p $PORT -q && break; sleep 1; done
"${PSQL[@]}" -c "create schema extensions; create role anon nologin; create role authenticated nologin;
  create publication supabase_realtime; grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;" >>"$LOG" 2>&1 || fail prelude
smoke() {
  "${PSQL[@]}" -t -f "$1" >"$LOG.out" 2>&1; local rc=$?
  cat "$LOG.out" >>"$LOG"
  [ $rc -eq 0 ] || fail "$1"
  grep -E "smoke ok|guards ok" "$LOG.out" | sed 's/^ *//'
}
for f in supabase/migrations/00{04,05,06,07,08,09,10,11,12}_*.sql; do
  "${PSQL[@]}" -f "$f" >>"$LOG" 2>&1 || fail "$f"
done
smoke tests/sql/v14-smoke.sql
for f in supabase/migrations/0014_*.sql supabase/migrations/0013_*.sql supabase/migrations/0015_*.sql \
         supabase/migrations/0016_*.sql supabase/migrations/0017_*.sql supabase/migrations/0018_*.sql; do
  "${PSQL[@]}" -f "$f" >>"$LOG" 2>&1 || fail "$f"
done
M=supabase/migrations/0019_v17_rats.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M"
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (re-run)"
echo "0019 twice ok"
smoke tests/sql/lyrics-lockdown-smoke.sql
smoke tests/sql/v15-smoke.sql
smoke tests/sql/anticheat-smoke.sql
smoke tests/sql/v15-2-smoke.sql
smoke tests/sql/v16-smoke.sql
smoke tests/sql/v15-gather-smoke.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (after the smokes)"
smoke tests/sql/v17-smoke.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (after the v17 smoke)"
smoke tests/sql/v17-smoke.sql
"$PG/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1; rm -rf "$D"
echo "ALL OK"
```

  `SCRATCH` is your session scratchpad in Git Bash form (for example `/c/Users/<you>/AppData/Local/Temp/claude/<…>/scratchpad`): `export SCRATCH=…` in the shell that runs the script (with `set -u` it stops at once when `SCRATCH` is unset). A `WARNING: "wal_level" is insufficient` from `create publication` and `NOTICE … does not exist, skipping` lines only go to the log. Delete nothing else in `$SCRATCH`; the script removes its own cluster.
- **The repo is public:** never commit a password, a token or a key. The integration tests read `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` from the environment and are skipped without them. Never type a password (account or room) in a browser.
- **Do not start dev servers.** `pnpm build` (Task 18) is the only build; in a checkout without `.env.local`, give it `NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_test_key` (the test values of `vitest.config.ts`). Turbopack refuses a `node_modules` that is a junction or symlink pointing outside the project: build in a checkout with its own install.
- **Deploy order** (§3) is the owner's: `0019` first, then the v17 client right after, in the production order `0012` → `0014` → `0013` → `0015` → `0016` → `0017` → `0018` → `0019`. A v17 client against a database without `0019` has no `rats` in the field state (no rats, no chip), no dog, and shows the v17 RPCs' PGRST202 as `NOT_OPEN_17`.

## Rulings (decisions where the spec is silent, ambiguous or self-contradictory)

- **The earlier smokes switch the rats off in their rooms** (§15): each of the v15, anti-cheat, v15.2 and gather smokes gains one setup block, `pg_temp.no_rats(p_key)`, which does nothing before `0019` (`to_regclass('public.rat_clocks')` is null) and otherwise parks the room's clock at `last_k = 9000000000000000000`. It is called right after each room is created. In the gather smoke, whose text 793f8b4 reworked, that means every room key it creates (`room` … `room7`). The v14 and v16 smokes grow no crops.
- **The v15 smoke takes the new item kinds out before it re-runs `0013`** (Task 1): `0013`'s `shop_items` kind check does not know `ammo` and `pet_food`, so the smoke deletes `ammo_pellet` and `food_dog` first, and the next `0019` run seeds them again. §16 does not mention it.
- **`presenceDog` accepts what the server stores** (Task 12): a name of 1–16 code points without a hidden character (0015's register classes, `hasHidden`), so plain spaces and symbols pass. §7.3 reads "no C/S/Z character", which would refuse the single spaces `_pet_name` keeps.
- **The v17 answer parsers are strict** (Task 7), as v15.3's catches are since 793f8b4: an aim, a shot (hit a boolean, pellets a number, a hit's price a number), a pounce, a dog answer or a sale that is not whole throws, and the call reads as failed.
- **A sling hit is judged at the aim when the band was let go** (Task 8): the pellet flies where it was aimed (`shotX`), and the rat must be within 9 px of that point when it lands. §6.2 says "within ±9 px of `aimX` then", which would let an aim moved during the flight steer the pellet.
- **The texts §12 leaves open** (Task 9): a cap or rest refusal without seconds reads "ít phút"; `ratGoneText` names "chó" when the catcher's dog has no name in `recent`; the plot line counts only the rats on the plot now ("0 con" on a plot that only has a log); the hungry dog's task line is an account line with `plot: 0`, not urgent.
- **`WARN_LOCK`** (Task 9) keeps v16's shipped place for "đánh bài", at the end ("… mua bán đất, mua bán ở các tiệm và đánh bài …"), and inserts "săn chuột" right after "bắt cua mò ốc", as §16 says to do when v16 shipped it elsewhere.
- **The handbook's "Chuột, chó & ná" tab shows once the catalog sells the ná** (`tool_sling`, i.e. after `0019`), like v15.3's "Cua & ốc" once there are critters; `handbookTabs` gains a third argument, the items.
- **The world's dogs and rats live in a new pure module, `lib/game/pack.ts`** (Task 13), which the engine steps every frame; §4 names only the engine. The rat prompt is a synthetic interactable (`ratInteractable`, kind `"rat"`, id `rat_{id}`) that `promptTarget` offers only when no map interactable is within `PROMPT_RANGE`.
- **`lastInputAt` lives in `GameCanvas`** (Task 13), across worlds, like the dog and the rats it keeps for every new world.
- **SlingGame's refusals** (Task 15): every refusal ends the session with its text, not only §6.2's `rat gone` and caps (`too fast`, `no aim` and `aim expired` do not come from an honest client), and `rat gone` names the catcher from the state's `recent` once the refetch lands (or "Chuột chạy về hang rồi."). A `sling_start` answer that lands after the game was closed, or after the field was left, is dropped (the `closes` guard of 793f8b4's controller).
- **"I am not locked"** in §7.2's auto-hunt conditions is read as "no farm job is open": no picking, round, crab visit, snail bed bar or SlingGame. The anti-cheat lock is left to the server: its refusal pauses the hunt 10 s like any other (D30). The dog is called back after a refusal only while the canvas still shows the field.
- **The farmer's spawn toast** fires once per rat and session, rats already live at the first fetch included.
- **DogPanel lives in `components/game/farm/`** beside the other field panels (§4 names `components/game/DogPanel.tsx`), with a small `DogSprite` for the adoption's coat buttons. The texts §12.3 leaves open: the name hints "Tên cần 2–16 ký tự.", "Tên có ký tự ẩn — gõ lại nhé." and "Tên này dành riêng — chọn tên khác nhé."; food left in whole hours ("còn 18 giờ"), `durationVi` under an hour; the adoption day in Vietnam time; the HUD's hungry mark as "🐕 {Mực} !".
- **Shop, depot and bag** (Task 17): dog food buys with the plain stepper as "Mua {n} · {xu}"; cô Út's empty text with rats open reads "“Chưa có lúa, hoa màu, cua ốc hay chuột hả con? Có hàng mang qua, cô trả giá cao!”", and her rat intro shows when only rats are in stock; the bag shows the Ná line once the catalog sells it and the dog food line only while some is held.
- **The admin's label for `rat_daily_cap`** is "Chạm 24 con chuột/ngày" (§16 names no text), and the holdings line shows "· {n} con chuột" whenever the answer has the rats (after `0019`) and "· chó {tên}" only with a dog.
- **The README's deploy order follows §3:** `0019` first, then the v17 client right after.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0019_v17_rats.sql` | A catalog (`upland_crops.rat_food`, the kinds `ammo` and `pet_food`, `tool_sling`, `ammo_pellet`, `food_dog`, the ledger's 23 reasons) · B tables (`crops.rat_log`, `field_rats`, `rat_clocks`, `rat_bag`, `dogs`, `sling_aims`, the catch caps on `farm_profiles`) · C model (`_rat_u`, `_rat_t`, `_rat_k`, `_rat_hours`, `_rat_factor`, `_rat_close`, `_rat_food`, `_pet_name`, `_crop_yield`, `_up_yield`) · D field (`_rat_sweep`, `_rat_caps`, `_rat_caps_view`, `_rat_catch`, `_dog_view`, `_rats_view`, `_field_open`, `_farm_mine`, `_field_view`) · E RPCs (`sling_start`, `sling_shoot`, `dog_hunt`, `adopt_dog`, `rename_dog`, `feed_dog`, `sell_rats`, `dog_state`, `buy_farm_item`) · F `_ac_holdings`, `_ac_wipe` |
| `tests/sql/v17-smoke.sql`, `tests/fixtures/crop-cases.json`, `upland-cases.json` | the smoke of every section, ending with the guard file, run twice on one database; the rat cases both sides share (§15) |
| `tests/sql/anticheat-guards.sql`, `v15-smoke.sql`, `anticheat-smoke.sql`, `v15-2-smoke.sql`, `v15-gather-smoke.sql` (mod) | 59 guarded calls and `dog_state` allowlisted; `pg_temp.no_rats` in the smokes that grow crops |
| `lib/game/farm/rats.ts`, `crop.ts`, `upland.ts` | the damage mirror, the rats' paths, the parse, the holes' homes, `nearestRat`, the prompt target; Mrat in both yields |
| `lib/game/dog.ts` | coats, the dog's answers, `dogNameRefusal`, `dogStatus`, `feedRefusal`, `hasHidden`, the follower |
| `lib/game/farm/catalog.ts`, `state.ts`, `rpc.ts`, `season.ts` | the new kinds and items; the field's rats, the bag, the caps and the dog; the 8 new calls; rat season |
| `lib/game/farm/sling.ts` | the SlingGame's seeded state machine |
| `lib/game/farm/messages.ts`, `handbook.ts`, `actions.ts`, `lib/anticheat.ts` | §10.6's refusals, the rat and dog texts, the "Chuột, chó & ná" tab, the rat and dog tasks, the lock and wipe texts |
| `lib/game/maps/field.ts`, `field-art.ts` | the 10 rat holes |
| `lib/game/art/rats.ts`, `dog.ts`, `farm-icons.ts`, `farm-anim.ts`, `sling-art.ts`, `lib/game/net/protocol.ts` | the rat and dog sprites, 5 icons, `fa` 11 and 12, the SlingGame's scene |
| `lib/presence-modes.ts`, `lib/realtime.ts`, `lib/game/social.ts`, `lib/game/world.ts`, `hooks/useRoom.ts` | presence's `dog` |
| `lib/game/pack.ts`, `lib/game/engine.ts`, `lib/game/maps/types.ts`, `components/game/GameCanvas.tsx` | dogs and rats in the world, the rat prompt, the handle's new calls |
| `hooks/useField.ts`, `hooks/useFarmController.ts`, `hooks/useDog.ts`, `lib/game/overlays.ts` | the calls and the rat refetch; the SlingGame session, the auto-hunt, the rat sale, the rats on the canvas; my dog; `slingGame` and `dogPanel` |
| `components/game/farm/SlingGame.tsx`, `DogPanel.tsx`, `DogSprite.tsx`, `RatChip.tsx` | the new overlays and the chip (§12) |
| `components/game/farm/CoopPanel.tsx`, `FarmShopPanel.tsx`, `RiceDepotPanel.tsx`, `PlotPanel.tsx`, `Handbook.tsx`, `Stepper.tsx`, `FarmOverlays.tsx`, `components/game/fishing/BagPanel.tsx`, `components/game/GameShell.tsx` (mod) | §12.1, §12.3, §12.4 |
| `components/admin/AnticheatTab.tsx`, `lib/admin.ts` (mod) | the `rat_daily_cap` label, the holdings line's rats and dog |
| `README.md`, the anti-cheat, v15, v15.2 and economy specs (mod), `tests/integration/v17.test.ts` | the v17 section; §16's lines; §15's integration checks |

## Rebased onto `793f8b4`

This plan was first built on an earlier `feat/v15-field`. Once the branch reached `793f8b4` (v15.3's fix round), the work was rebased there once, re-derived where the base had moved, and replayed from a clean checkout. `0018` did not change. The rebase changed:

1. **The gather smoke** (Task 2): 793f8b4 reworked `tests/sql/v15-gather-smoke.sql` (its rules read from the fixture, the day's cases pinned to 20:00). Its `pg_temp.no_rats` block and calls sit in the new text, one call after each room it creates (`room` … `room7`).
2. **The strict parsers** (Task 7): v15.3's catches throw on an answer that is not whole since 793f8b4, and so do the v17 answers (`bad shot answer`, `bad hunt answer`, `bad sale answer`, `bad dog answer`), with their tests.
3. **The controller's `closes` guard** (Tasks 15, 16): a `sling_start` answer is dropped unless the `closes` count is unchanged and `canvas()?.mapId()` is still `"field"`, as 793f8b4 does for `begin_work` and `crab_start`; the dog is called back after a refusal under the same condition. `GameCanvasHandle.mapId()` comes from the base.
4. **`useField`'s gathering calls** take the container's name (`crabStart(hole, boxName)`, `pickSnailBed(bed, boxName)`) since 793f8b4; the v17 calls sit beside them (Task 14), and the pins test's canvas mock gains `setRats` (Task 15).
5. **The anti-cheat spec** (Task 18): 793f8b4 rewrote §11.3 rules 3 and 7 after `0018`; the `0019` lines go after them, in the same style. The v15.3 spec's §3 and the v16 spec's §11.6, which the base also changed, need nothing from v17.

## Plan conflict scan (pre-flight, done by the plan author)

- **Validated end to end.** The plan author built every task on a scratch branch from `793f8b4` with one commit per task: tsc clean and each task's tests green after every task, and after each of Tasks 1–4 the SQL check above (`ALL OK`), with the TS tests that read the shared fixtures still green. After Task 18: the full suite (129 files passed / 15 skipped (1409 tests passed / 81 skipped)), `pnpm lint` at the 33 baseline problems with none in this plan's files, and `pnpm build`. The code blocks below are generated from those commits, and a mechanical replay of this document on a clean checkout of `793f8b4` — each task's blocks up to Step 2, its Step 2 check failing as stated, then the rest — reproduced every file of every commit, with tsc, the task's tests, its eslint command and the SQL check green after every task, and the final suite and lint as above. `pnpm build` ran in a checkout with its own install, at the branch head, whose tree the replay reproduced byte for byte. If an edit's "old" text is not found, re-read the file — do not improvise a different change.
- **The base.** `feat/v15-field` moved on while this plan was written; the work was rebased once onto `793f8b4` and replayed there. "Rebased onto `793f8b4`" says what changed.
- **Files several tasks touch, in order:** `0019_v17_rats.sql` (Task 1 creates A–C, Tasks 2–4 append D, E and F); `tests/sql/v17-smoke.sql` (Task 1 creates it ending with `\i tests/sql/anticheat-guards.sql`, Tasks 2–4 insert before that line); `tests/sql/v15-smoke.sql` (Tasks 1, 2); `lib/game/farm/rats.ts` and `tests/unit/farm-rats.test.ts` (Tasks 5, 10, 13); `lib/game/dog.ts` (Tasks 6, 12); `lib/game/world.ts` (Tasks 12, 13); `lib/game/farm/messages.ts` (Tasks 9, 15, 16); `farm-actions.test.ts` (Tasks 7, 9); `anticheat-pins.test.tsx` (Tasks 7, 15); `lib/game/overlays.ts` and `game-overlays.test.ts` (Tasks 15, 16); `hooks/useFarmController.ts`, `components/game/farm/FarmOverlays.tsx`, `components/game/GameShell.tsx` and `use-farm-controller.test.tsx` (Tasks 15–17); `farm-overlays.test.tsx` (Tasks 14, 15, 17). Each task's blocks are generated against the file as the previous task left it.
- **The SQL smokes and the re-runs:** the v15 smoke's last section re-runs `0013`, the anti-cheat smoke `0015`, the v15.2 smoke `0016` (and `0018` after each), the v16 smoke `0017` and the gather smoke `0018`; each puts back its own versions of functions `0019` re-creates, so `0019` runs again after them all and the v17 smoke runs last, then once more after `0019` runs again. The v17 smoke's sales and adoptions write ledger reasons the earlier checks lack, which is why no earlier smoke runs after it.
- **Nothing ships from here.** The integration tests are skipped without `SUPABASE_TEST_URL` (they were type-checked and linted only); the owner's manual pass (§15) comes after deploy.
- **Spec coverage:** §3 (the README, Task 18), §5.1–§5.5 (Tasks 1, 2, 5, 10), §5.6 (Tasks 2, 3, 7), §6.1 (Task 3), §6.2 (Tasks 8, 15), §7.1 (Tasks 3, 6, 16), §7.2 (Tasks 3, 16), §7.3 (Tasks 6, 12, 13, 16), §8 (Tasks 1, 3, 7, 17), §9 (the prices of Tasks 1–3), §10 (Tasks 1–4; §10.6 in Task 9; §10.7 in Tasks 2–4 and 18), §11 (Tasks 11–16), §12.1 (Tasks 9, 13, 15, 17), §12.2 (Tasks 9, 15), §12.3 (Task 16), §12.4 (Task 17), §13 (Task 9), §14 (Tasks 10, 11, 15), §15 (every task; the integration part in Task 18), §16 (Tasks 9, 18).

---

### Task 1: Database — catalog, tables and the rat model (`0019` sections A–C)

**Files:**
- Create: `supabase/migrations/0019_v17_rats.sql`
- Test: `tests/sql/v17-smoke.sql` (create); `tests/fixtures/crop-cases.json`, `tests/fixtures/upland-cases.json`, `tests/sql/v15-smoke.sql` (modify)

**Interfaces:**
- Consumes: from `0013`/`0016`: `shop_items(id, kind, name, price, starter, sort_order)`, `upland_crops`, `crops` (and its rice and hoa-màu yields `_crop_yield(c, v, land, t)` and `_up_yield(c, u, land, k, t)`, whose latest bodies are `0016`'s), `farm_profiles`, `coin_ledger`; from `0018`: the kind check with `critter_box`, the ledger's 21 reasons (with `wipe` and `critter_sell`), `_critter_price(base, mult)` and `_critter_prices(room, now)`; from `0015`: the `register` name classes and `_name_key(text)`.
- Produces (Postgres):
  - **A:** `upland_crops.rat_food` (true for `khoai` and `bap`); the kind check with `ammo` and `pet_food` (§16); `tool_sling` (Ná, 3 000, `tool`, sort 30), `ammo_pellet` (Đạn đất, 10, `ammo`) and `food_dog` (Thức ăn chó, 150, `pet_food`) (§8); the ledger check with the 21 reasons plus `rat_sell` and `dog_adopt`, 23 (C1);
  - **B:** `crops.rat_log jsonb` (`[{r, from, to}]`); the private tables `field_rats` (a room's rats: plot, `spawned_at`, seed, `ended_at`, `how` sling | dog | fled, `caught_by`), `rat_clocks(room_id, last_k)`, `rat_bag` (one row per caught rat, priced at the catch), `dogs(account_id, name, coat, adopted_at, fed_until, next_hunt_at, catches)` and `sling_aims` (one aim per account); the catch caps' window and day on `farm_profiles` (RLS on, no policies, revoked);
  - **C** (private): the spawn clock `_rat_u(room, k, s)`, `_rat_t(room, k)` (`k·900 s + floor(u·300) s`, D1) and `_rat_k(room, t)`; `_rat_hours(log, t)`, `_rat_factor(h) = 1 − min(0.10, 0.02·h)` (D6) and `_rat_close(log, rat, t)`; `_rat_food(c, t)` (D4); `_pet_name(name)` (§7.1: NFC, trimmed, single spaces, 2–16 characters, no hidden character, no reserved key; `invalid name`); `_crop_yield` and `_up_yield` re-created with Mrat from the crop's `rat_log` as the last factor (§16's products).
- Produces (smoke and fixtures): the rat cases R1–R4 in `crop-cases.json` and U1, U2 in `upland-cases.json`, with the rat edges (§15); `tests/sql/v17-smoke.sql` re-runs `0019` first, sets log mode, defines its helpers, checks the catalog, the tables and the ledger, the spawn clock, the damage against the fixtures, rat food and the dog's name, prints `v17 model smoke ok` and ends with `\i tests/sql/anticheat-guards.sql`. Tasks 2–4 insert their parts before that line. The v15 smoke deletes `ammo_pellet` and `food_dog` before it re-runs `0013`, whose kind check does not know them (ruling).

- [ ] **Step 0: Record the baseline and create the SQL check script**

Run `pnpm test`, `npx tsc --noEmit` and `pnpm lint`, and write down the counts (the plan author's are in Global Constraints). Create `$SCRATCH/v17-sql.sh` from Global Constraints if it does not exist yet.

- [ ] **Step 1: Write the fixtures and the smoke's model part**

**tests/fixtures/crop-cases.json.** Replace:

```json
    }
  ]
```

with:

```json
    }
  ],
  "rats": [
    {
      "name": "R1, short, one rat for 2 h",
      "variety": "short", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 58,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [27, 1], [28.25, 2], [28.5, 3], [48, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [16, "fert_urea"], [30, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "rats": [[1, 56, 58]],
      "expect": {"kg": 86, "mcare": 1, "mseed": 1, "mwater": 1, "mpest": 1, "mlate": 1, "mrat": 0.96, "pests": []}
    },
    {
      "name": "R2, nep, three rats summing exactly 5 h: the 10 % cap",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3.1, "transplant": 12, "harvest": 62,
      "water": [[0, 3], [3, 1], [12, 2], [24, 2], [29.9, 1], [30.05, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "rats": [[1, 60, 62], [2, 60, 62], [3, 61, 62]],
      "expect": {"kg": 68, "mcare": 1, "mseed": 1, "mwater": 1, "mpest": 1, "mlate": 1, "mrat": 0.9, "pests": []}
    },
    {
      "name": "R3, thom, a live rat for 3 h at the cut",
      "variety": "thom", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 13, "harvest": 71.5,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [13, 2], [25, 2], [33, 1], [33.75, 3], [45, 3], [59, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [18, "fert_urea"], [36, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "rats": [[1, 68.5, null]],
      "expect": {"kg": 56, "mcare": 1, "mseed": 1, "mwater": 1, "mpest": 1, "mlate": 1, "mrat": 0.94, "pests": []}
    },
    {
      "name": "R4, nep, cut in six parts while a rat eats",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3.1, "transplant": 12, "harvest": 61,
      "water": [[0, 3], [3, 1], [12, 2], [24, 2], [29.9, 1], [30.05, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "rats": [[1, 60, null]],
      "expect": {"kg": 74, "mcare": 1, "mseed": 1, "mwater": 1, "mpest": 1, "mlate": 1, "mrat": 0.98, "pests": []},
      "parts": [[61, 12], [62, 12], [63, 12], [64, 12], [65, 11], [66, 12]]
    }
  ],
  "rat_edges": [
    {"name": "an entry from t counts nothing", "log": [[1, 10, null]], "t": 10, "hours": 0, "mrat": 1},
    {"name": "an entry closed at t counts fully", "log": [[1, 8, 10]], "t": 10, "hours": 2, "mrat": 0.96},
    {"name": "an entry after t counts nothing", "log": [[1, 11, null]], "t": 10, "hours": 0, "mrat": 1},
    {"name": "an entry closed after t counts up to t", "log": [[1, 8, 12]], "t": 10, "hours": 2, "mrat": 0.96},
    {"name": "an open entry counts up to t", "log": [[1, 7.5, null]], "t": 10, "hours": 2.5, "mrat": 0.95},
    {"name": "summed in log order", "log": [[1, 0, 0.1], [2, 0, 0.2], [3, 0, 0.3]], "t": 1, "hours": 0.6000000000000001, "mrat": 0.988},
    {"name": "summed in log order, reversed", "log": [[3, 0, 0.3], [2, 0, 0.2], [1, 0, 0.1]], "t": 1, "hours": 0.6, "mrat": 0.988},
    {"name": "exactly 5 h is the cap", "log": [[1, 0, 5]], "t": 5, "hours": 5, "mrat": 0.9},
    {"name": "beyond the cap", "log": [[1, 0, 3], [2, 1, 4], [3, 2, null]], "t": 5, "hours": 9, "mrat": 0.9},
    {"name": "no rats", "log": [], "t": 5, "hours": 0, "mrat": 1}
  ]
```

**tests/fixtures/upland-cases.json — edit 1 of 2.** Replace:

```json
  "crops": [
    {"id": "khoai", "name": "Khoai lang", "sort_order": 10, "method": "cutting", "plant_label": "Trồng dây khoai", "transplant_label": null, "harvest_label": "Đào khoai", "harvest_anim": "dig", "base_kg": 200, "price_per_kg": 265, "nursery_ready_h": null, "nursery_old_h": null, "stages": [{"id": "root", "name": "Bén rễ", "until_h": 6, "water": [1]}, {"id": "vine", "name": "Bò dây", "until_h": 22, "water": [0, 1]}, {"id": "tuber", "name": "Tượng củ", "until_h": 36, "water": [0, 1]}, {"id": "bulk", "name": "Củ lớn", "until_h": 48, "water": [0, 1]}], "ripe_water": [0, 1], "ripe_window_h": 12, "over_rate": 0.02, "lost_after_h": 48, "pickings": [100], "pick_gap_h": null, "rot_from_h": 22, "rot_rate": 0.03, "rot_cap": 0.5, "cares": [{"id": "td", "kind": "fert", "name": "Bón thúc nuôi củ", "items": ["fert_potash", "fert_npk"], "half_items": ["fert_urea"], "from_h": 16, "to_h": 26, "half_from_h": 6, "half_to_h": 36, "pen_half": 0.1, "pen_missing": 0.2}, {"id": "lat_day", "kind": "act", "name": "Lật dây", "items": [], "half_items": [], "from_h": 24, "to_h": 32, "half_from_h": 32, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.1}], "pests": [{"slot": 1, "kind": "weevil", "name": "Sùng khoai", "from_h": 24, "to_h": 40, "chance": 0.4, "dry_mult": 2, "wet_mult": 1, "remedy": "spray_insect"}]},
    {"id": "bap", "name": "Bắp", "sort_order": 20, "method": "direct", "plant_label": "Gieo hạt bắp", "transplant_label": null, "harvest_label": "Bẻ bắp", "harvest_anim": "pick", "base_kg": 150, "price_per_kg": 460, "nursery_ready_h": null, "nursery_old_h": null, "stages": [{"id": "sprout", "name": "Nảy mầm", "until_h": 6, "water": [1]}, {"id": "leaf", "name": "Ra lá", "until_h": 24, "water": [1, 2]}, {"id": "knee", "name": "Xoáy nõn", "until_h": 40, "water": [1, 2]}, {"id": "tassel", "name": "Trổ cờ, phun râu", "until_h": 50, "water": [1, 2]}, {"id": "fill", "name": "Chắc hạt", "until_h": 60, "water": [0, 1]}], "ripe_water": [0, 1], "ripe_window_h": 12, "over_rate": 0.02, "lost_after_h": 48, "pickings": [100], "pick_gap_h": null, "rot_from_h": null, "rot_rate": null, "rot_cap": null, "cares": [{"id": "td1", "kind": "fert", "name": "Bón thúc lần 1 (3–5 lá)", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"], "from_h": 8, "to_h": 16, "half_from_h": 6, "half_to_h": 24, "pen_half": 0.1, "pen_missing": 0.2}, {"id": "vun_goc", "kind": "act", "name": "Vun gốc", "items": [], "half_items": [], "from_h": 16, "to_h": 28, "half_from_h": 28, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.1}, {"id": "td2", "kind": "fert", "name": "Bón thúc lần 2 (trổ cờ)", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 38, "to_h": 46, "half_from_h": 30, "half_to_h": 50, "pen_half": 0.1, "pen_missing": 0.2}], "pests": [{"slot": 1, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 8, "to_h": 24, "chance": 0.35, "dry_mult": 1, "wet_mult": 1, "remedy": "spray_insect"}, {"slot": 2, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 26, "to_h": 44, "chance": 0.35, "dry_mult": 1, "wet_mult": 1, "remedy": "spray_insect"}]},
    {"id": "ot", "name": "Ớt", "sort_order": 30, "method": "nursery", "plant_label": "Ươm hạt ớt", "transplant_label": "Trồng cây ớt con", "harvest_label": "Hái ớt", "harvest_anim": "pick", "base_kg": 60, "price_per_kg": 1590, "nursery_ready_h": 10, "nursery_old_h": 18, "stages": [{"id": "root", "name": "Bén rễ", "until_h": 8, "water": [1]}, {"id": "grow", "name": "Phát triển thân lá", "until_h": 22, "water": [1, 2]}, {"id": "flower", "name": "Ra hoa", "until_h": 34, "water": [1, 2]}, {"id": "fruit", "name": "Đậu trái", "until_h": 46, "water": [1, 2]}], "ripe_water": [0, 1], "ripe_window_h": 8, "over_rate": 0.03, "lost_after_h": 24, "pickings": [40, 35, 25], "pick_gap_h": 12, "rot_from_h": null, "rot_rate": null, "rot_cap": null, "cares": [{"id": "td1", "kind": "fert", "name": "Bón thúc bén rễ", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"], "from_h": 4, "to_h": 12, "half_from_h": 0, "half_to_h": 20, "pen_half": 0.08, "pen_missing": 0.15}, {"id": "td2", "kind": "fert", "name": "Bón thúc ra hoa", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 22, "to_h": 30, "half_from_h": 20, "half_to_h": 40, "pen_half": 0.08, "pen_missing": 0.15}, {"id": "td3", "kind": "fert", "name": "Bón nuôi trái", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 46, "to_h": 56, "half_from_h": 40, "half_to_h": 64, "pen_half": 0.08, "pen_missing": 0.15}], "pests": [{"slot": 1, "kind": "thrips", "name": "Bọ trĩ", "from_h": 6, "to_h": 24, "chance": 0.4, "dry_mult": 1.5, "wet_mult": 1, "remedy": "spray_insect"}, {"slot": 2, "kind": "anthracnose", "name": "Thán thư", "from_h": 40, "to_h": 64, "chance": 0.4, "dry_mult": 1, "wet_mult": 2, "remedy": "spray_fungus"}]}
  ],
```

with:

```json
  "crops": [
    {"id": "khoai", "name": "Khoai lang", "sort_order": 10, "method": "cutting", "plant_label": "Trồng dây khoai", "transplant_label": null, "harvest_label": "Đào khoai", "harvest_anim": "dig", "base_kg": 200, "price_per_kg": 265, "nursery_ready_h": null, "nursery_old_h": null, "stages": [{"id": "root", "name": "Bén rễ", "until_h": 6, "water": [1]}, {"id": "vine", "name": "Bò dây", "until_h": 22, "water": [0, 1]}, {"id": "tuber", "name": "Tượng củ", "until_h": 36, "water": [0, 1]}, {"id": "bulk", "name": "Củ lớn", "until_h": 48, "water": [0, 1]}], "ripe_water": [0, 1], "ripe_window_h": 12, "over_rate": 0.02, "lost_after_h": 48, "pickings": [100], "pick_gap_h": null, "rot_from_h": 22, "rot_rate": 0.03, "rot_cap": 0.5, "cares": [{"id": "td", "kind": "fert", "name": "Bón thúc nuôi củ", "items": ["fert_potash", "fert_npk"], "half_items": ["fert_urea"], "from_h": 16, "to_h": 26, "half_from_h": 6, "half_to_h": 36, "pen_half": 0.1, "pen_missing": 0.2}, {"id": "lat_day", "kind": "act", "name": "Lật dây", "items": [], "half_items": [], "from_h": 24, "to_h": 32, "half_from_h": 32, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.1}], "pests": [{"slot": 1, "kind": "weevil", "name": "Sùng khoai", "from_h": 24, "to_h": 40, "chance": 0.4, "dry_mult": 2, "wet_mult": 1, "remedy": "spray_insect"}], "rat_food": true},
    {"id": "bap", "name": "Bắp", "sort_order": 20, "method": "direct", "plant_label": "Gieo hạt bắp", "transplant_label": null, "harvest_label": "Bẻ bắp", "harvest_anim": "pick", "base_kg": 150, "price_per_kg": 460, "nursery_ready_h": null, "nursery_old_h": null, "stages": [{"id": "sprout", "name": "Nảy mầm", "until_h": 6, "water": [1]}, {"id": "leaf", "name": "Ra lá", "until_h": 24, "water": [1, 2]}, {"id": "knee", "name": "Xoáy nõn", "until_h": 40, "water": [1, 2]}, {"id": "tassel", "name": "Trổ cờ, phun râu", "until_h": 50, "water": [1, 2]}, {"id": "fill", "name": "Chắc hạt", "until_h": 60, "water": [0, 1]}], "ripe_water": [0, 1], "ripe_window_h": 12, "over_rate": 0.02, "lost_after_h": 48, "pickings": [100], "pick_gap_h": null, "rot_from_h": null, "rot_rate": null, "rot_cap": null, "cares": [{"id": "td1", "kind": "fert", "name": "Bón thúc lần 1 (3–5 lá)", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"], "from_h": 8, "to_h": 16, "half_from_h": 6, "half_to_h": 24, "pen_half": 0.1, "pen_missing": 0.2}, {"id": "vun_goc", "kind": "act", "name": "Vun gốc", "items": [], "half_items": [], "from_h": 16, "to_h": 28, "half_from_h": 28, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.1}, {"id": "td2", "kind": "fert", "name": "Bón thúc lần 2 (trổ cờ)", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 38, "to_h": 46, "half_from_h": 30, "half_to_h": 50, "pen_half": 0.1, "pen_missing": 0.2}], "pests": [{"slot": 1, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 8, "to_h": 24, "chance": 0.35, "dry_mult": 1, "wet_mult": 1, "remedy": "spray_insect"}, {"slot": 2, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 26, "to_h": 44, "chance": 0.35, "dry_mult": 1, "wet_mult": 1, "remedy": "spray_insect"}], "rat_food": true},
    {"id": "ot", "name": "Ớt", "sort_order": 30, "method": "nursery", "plant_label": "Ươm hạt ớt", "transplant_label": "Trồng cây ớt con", "harvest_label": "Hái ớt", "harvest_anim": "pick", "base_kg": 60, "price_per_kg": 1590, "nursery_ready_h": 10, "nursery_old_h": 18, "stages": [{"id": "root", "name": "Bén rễ", "until_h": 8, "water": [1]}, {"id": "grow", "name": "Phát triển thân lá", "until_h": 22, "water": [1, 2]}, {"id": "flower", "name": "Ra hoa", "until_h": 34, "water": [1, 2]}, {"id": "fruit", "name": "Đậu trái", "until_h": 46, "water": [1, 2]}], "ripe_water": [0, 1], "ripe_window_h": 8, "over_rate": 0.03, "lost_after_h": 24, "pickings": [40, 35, 25], "pick_gap_h": 12, "rot_from_h": null, "rot_rate": null, "rot_cap": null, "cares": [{"id": "td1", "kind": "fert", "name": "Bón thúc bén rễ", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"], "from_h": 4, "to_h": 12, "half_from_h": 0, "half_to_h": 20, "pen_half": 0.08, "pen_missing": 0.15}, {"id": "td2", "kind": "fert", "name": "Bón thúc ra hoa", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 22, "to_h": 30, "half_from_h": 20, "half_to_h": 40, "pen_half": 0.08, "pen_missing": 0.15}, {"id": "td3", "kind": "fert", "name": "Bón nuôi trái", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 46, "to_h": 56, "half_from_h": 40, "half_to_h": 64, "pen_half": 0.08, "pen_missing": 0.15}], "pests": [{"slot": 1, "kind": "thrips", "name": "Bọ trĩ", "from_h": 6, "to_h": 24, "chance": 0.4, "dry_mult": 1.5, "wet_mult": 1, "remedy": "spray_insect"}, {"slot": 2, "kind": "anthracnose", "name": "Thán thư", "from_h": 40, "to_h": 64, "chance": 0.4, "dry_mult": 1, "wet_mult": 2, "remedy": "spray_fungus"}], "rat_food": false}
  ],
```

**tests/fixtures/upland-cases.json — edit 2 of 2.** Replace:

```json
      "expect": {"kg": 15, "mcare": 0.29999999999999993, "mplant": 1.0, "mwater": 0.8, "mrot": 1.0, "mpest": 0.48999999999999994, "mlate": 0.4, "pests": [{"kind": "armyworm", "since_s": 32400, "treated_s": null}, {"kind": "armyworm", "since_s": 97200, "treated_s": null}]}
    }
  ]
}
```

with:

```json
      "expect": {"kg": 15, "mcare": 0.29999999999999993, "mplant": 1.0, "mwater": 0.8, "mrot": 1.0, "mpest": 0.48999999999999994, "mlate": 0.4, "pests": [{"kind": "armyworm", "since_s": 32400, "treated_s": null}, {"kind": "armyworm", "since_s": 97200, "treated_s": null}]}
    }
  ],
  "rats": [
    {
      "name": "U1, khoai textbook with a 1 h rat",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 51,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "rats": [[1, 50, 51]],
      "expect": {"kg": 196, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "mrat": 0.98, "pests": []}
    },
    {
      "name": "U2, bắp textbook with a 1 h rat",
      "upland": "bap",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 63,
      "k": 1,
      "water": [[0, 1], [11, 2], [35, 2]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [11, "fert_urea"], [41, "fert_potash"]],
      "work": [[21, "vun_goc"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "rats": [[1, 62, null]],
      "expect": {"kg": 147, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "mrat": 0.98, "pests": []}
    }
  ]
}
```

**tests/sql/v15-smoke.sql.** Replace:

```sql
end $$;
-- 0016 (v15.2) sells tools, a kind 0013's item check does not know: take them out first (the v15.2 smoke runs 0016 again).
delete from public.inventory i using public.shop_items s where s.id = i.item_id and s.kind = 'tool';
delete from public.shop_items where kind = 'tool';
-- Supabase's default privileges give the API roles every right on a new table (TRUNCATE ignores RLS); this cluster has
```

with:

```sql
end $$;
-- 0016 (v15.2) sells tools and 0019 (v17) pellets and dog food, kinds 0013's item check does not know: take them out first
-- (the v15.2 smoke runs 0016 again, and the SQL check runs 0019 again before the v17 smoke).
delete from public.inventory i using public.shop_items s where s.id = i.item_id and s.kind in ('tool', 'ammo', 'pet_food');
delete from public.shop_items where kind in ('tool', 'ammo', 'pet_food');
-- Supabase's default privileges give the API roles every right on a new table (TRUNCATE ignores RLS); this cluster has
```

Create `tests/sql/v17-smoke.sql` with exactly:

```sql
-- tests/sql/v17-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0019 (see the plan), from
-- the repo root: it re-runs 0019 with \i, reads tests/fixtures/crop-cases.json and upland-cases.json with \copy, and ends
-- with tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
\set ON_ERROR_STOP on
-- Timestamps inside JSON print in the session's zone: UTC, as on Supabase.
set time zone 'UTC';

-- The v15 smoke re-runs 0013, the anti-cheat smoke 0015, the v15.2 smoke 0016 and 0018, the v16 smoke 0017 and the gather
-- smoke 0018: they put back their own versions of functions 0019 re-creates, so 0019 runs again first.
set client_min_messages = warning;
\i supabase/migrations/0019_v17_rats.sql
reset client_min_messages;

-- The tampered calls below are only recorded: log mode locks nobody.
update public.anticheat_config set mode = 'log';

create temp table smoke (k text primary key, v text);

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- The error of a statement with its SQLSTATE and details, or null.
create function pg_temp.errd(p_sql text) returns jsonb language plpgsql as $$
declare v_msg text; v_detail text; v_state text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_state = returned_sqlstate;
  return jsonb_build_object('message', v_msg, 'detail', v_detail, 'state', v_state);
end $$;

create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.give(a uuid, it text, n integer) returns void language sql
as $$ insert into public.inventory (account_id, item_id, qty) values (a, it, n)
      on conflict (account_id, item_id) do update set qty = excluded.qty $$;
create function pg_temp.qty(a uuid, it text) returns integer language sql
as $$ select coalesce((select qty from public.inventory where account_id = a and item_id = it), 0) $$;
-- The room's fish price index row, set by hand for this period.
create function pg_temp.set_mult(r uuid, m numeric, t timestamptz) returns void language sql
as $$ insert into public.fish_price_index (room_id, period, wealth, mult, computed_at) values (r, public._fish_period(t), 0, m, t)
      on conflict (room_id) do update set period = excluded.period, mult = excluded.mult, computed_at = excluded.computed_at $$;

-- ---------- the shared fixtures (§15) ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/crop-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;
create temp table fxu_raw (n serial, line text);
\copy fxu_raw (line) from 'tests/fixtures/upland-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fxu as select string_agg(line, e'\n' order by n)::jsonb as j from fxu_raw;

create function pg_temp.fx_at(t0 timestamptz, h jsonb) returns timestamptz language sql
as $$ select t0 + make_interval(secs => (h #>> '{}')::double precision * 3600) $$;

create function pg_temp.fx_log(t0 timestamptz, a jsonb, k text) returns jsonb language sql
as $$ select coalesce(jsonb_agg(jsonb_build_object('t', pg_temp.fx_at(t0, e->0), k, e->1) order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

-- A rat log from the fixtures' [rat, from, to | null] entries (hours after t0).
create function pg_temp.fx_rats(t0 timestamptz, a jsonb) returns jsonb language sql
as $$ select coalesce(jsonb_agg(jsonb_build_object('r', e->0, 'from', pg_temp.fx_at(t0, e->1),
                                                   'to', case when e->2 = 'null' then null else pg_temp.fx_at(t0, e->2) end)
                                order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

-- A rice crop row from a crop-cases.json rat case (as the v15 smoke builds one), with its rat log.
create function pg_temp.fx_rice(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'rice', 'variety', k->>'variety',
  'prepared_at', t0, 'soak_at', pg_temp.fx_at(t0, k->'soak'), 'sow_at', pg_temp.fx_at(t0, k->'sow'),
  'transplant_at', pg_temp.fx_at(t0, k->'transplant'), 'q_transplant', k->'q_transplant',
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'), 'picks', '[]'::jsonb, 'pest_rolls', k->'pest_rolls',
  'rat_log', pg_temp.fx_rats(t0, k->'rats'))) $$;

-- A hoa-màu crop row from an upland-cases.json rat case (as the v15.2 smoke builds one), with its rat log.
create function pg_temp.fx_upcrop(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'upland', 'upland', k->>'upland',
  'prepared_at', t0, 'q_transplant', 1, 'picks', '[]'::jsonb, 'harvested_parts', 0, 'harvested_kg', 0,
  'sow_at', case when k->'sow' = 'null' then null else pg_temp.fx_at(t0, k->'sow') end,
  'plant_at', case when k->'plant' = 'null' then null else pg_temp.fx_at(t0, k->'plant') end,
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'work_log', pg_temp.fx_log(t0, k->'work', 'act'), 'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'),
  'harvests', '[]'::jsonb, 'pest_rolls', k->'pest_rolls', 'rat_log', pg_temp.fx_rats(t0, k->'rats'))) $$;

-- ---------- the catalog, the tables and the ledger (§8, §10.1, §10.2, C1) ----------
do $$
begin
  assert (select jsonb_agg(jsonb_build_array(id, kind, name, price, starter, sort_order) order by id)
            from public.shop_items where id in ('tool_sling', 'ammo_pellet', 'food_dog'))
         = '[["ammo_pellet", "ammo", "Đạn đất", 10, false, 10], ["food_dog", "pet_food", "Thức ăn chó", 150, false, 20],
             ["tool_sling", "tool", "Ná", 3000, false, 30]]', 'anh Hai''s three items (§8)';
  assert (select array_agg(m[1] order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
           where c.conname = 'shop_items_kind_check')
         = (select array_agg(x order by x) from unnest(array['rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide',
              'critter_box','tool','ammo','pet_food']) x), 'the kinds after 0019 (§16)';
  assert (select jsonb_object_agg(id, rat_food order by id) from public.upland_crops)
         = '{"bap": true, "khoai": true, "ot": false}', 'rat food: khoai and bắp, not ớt (D4)';
  -- the ledger: the 21 reasons in force after 0018 plus rat_sell and dog_adopt
  assert (select array_agg(m[1] order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
           where c.conname = 'coin_ledger_reason_check')
         = (select array_agg(x order by x) from unnest(array['daily','song','sell','buy','rent','land_buy','land_sell','land_refund',
              'lease_pay','lease_income','farm_buy','rice_sell','wipe','harvester','produce_sell','card_hold','card_settle',
              'card_buyin','card_cashout','card_refund','critter_sell','rat_sell','dog_adopt']) x), 'the 23 ledger reasons';
  assert pg_temp.err(format('insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (%L, 0, 0, %L, %L)',
                            gen_random_uuid(), 'foo', 'x')) like '%coin_ledger_reason_check%', 'foo is refused';
  -- the tables' checks
  assert pg_temp.err(format('insert into public.dogs (account_id, name, coat, adopted_at) values (%L, %L, %L, now())',
                            gen_random_uuid(), 'Ki', 'xam')) like '%dogs_coat_check%', 'four coats';
  assert pg_temp.err(format('insert into public.field_rats (room_id, plot_no, k, seed, spawned_at) values (%L, 11, 1, 1, now())',
                            gen_random_uuid())) like '%field_rats_plot_no_check%', 'plots 1–10';
  assert (select column_default = '''[]''::jsonb' and is_nullable = 'NO' from information_schema.columns
           where table_schema = 'public' and table_name = 'crops' and column_name = 'rat_log'), 'crops.rat_log';
  assert (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'farm_profiles'
           and column_name in ('rat_win_start', 'rat_win_count', 'rat_day_on', 'rat_day_count')) = 4, 'the caps'' columns';
  -- private: RLS on, and the API roles cannot read the five tables
  assert (select bool_and(c.relrowsecurity) from pg_class c
           where c.oid in ('public.field_rats'::regclass, 'public.rat_clocks'::regclass, 'public.rat_bag'::regclass,
                           'public.dogs'::regclass, 'public.sling_aims'::regclass)), 'RLS on';
  assert not exists (select 1 from unnest(array['anon', 'authenticated']) r,
                            unnest(array['public.field_rats', 'public.rat_clocks', 'public.rat_bag', 'public.dogs',
                                         'public.sling_aims']) tb
                      where has_table_privilege(r, tb, 'select') or has_table_privilege(r, tb, 'insert')), 'private tables';
  -- the helpers are private
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('_rat_u', '_rat_t', '_rat_k', '_rat_hours', '_rat_factor', '_rat_close', '_rat_food',
                                        '_pet_name', '_crop_yield', '_up_yield')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
end $$;

-- ---------- the spawn clock (§5.3, D1) ----------
do $$
declare room uuid := gen_random_uuid(); k0 bigint := floor(extract(epoch from now()) / 900)::bigint; k bigint;
        t timestamptz; prev timestamptz := null; gap double precision; lo double precision := 1e9; hi double precision := 0;
begin
  for k in k0 .. k0 + 999 loop
    t := public._rat_t(room, k);
    assert t = date_trunc('second', t), format('t(%s) is whole seconds: %s', k, t);
    assert t >= to_timestamp(k * 900) and t < to_timestamp(k * 900 + 300), format('t(%s) in its slot', k);
    assert public._rat_k(room, t) = k, format('k(t(%s))', k);
    assert public._rat_k(room, t - interval '1 second') = k - 1, format('k(t(%s) − 1 s)', k);
    if prev is not null then
      gap := extract(epoch from t - prev);
      lo := least(lo, gap);
      hi := greatest(hi, gap);
    end if;
    prev := t;
  end loop;
  assert lo >= 601 and hi <= 1199 and lo < 700 and hi > 1100, format('two candidates are 601–1 199 s apart: %s–%s', lo, hi);
  assert public._rat_u(room, k0, 't') >= 0 and public._rat_u(room, k0, 't') < 1
     and public._rat_u(room, k0, 't') <> public._rat_u(room, k0, 'p'), 'u in [0, 1), one draw per purpose';
end $$;

-- ---------- the damage against the shared fixtures (§5.5, §15) ----------
do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        v public.rice_varieties; y jsonb; f text; p jsonb; i int; n int := 0; np int := 0;
begin
  for k in select x from jsonb_array_elements(j->'rats') x loop
    n := n + 1;
    c := pg_temp.fx_rice(t0, k);
    v := public._variety(k->>'variety');
    y := public._crop_yield(c, v, (k->>'land')::double precision, (k->>'q_harvest')::double precision, pg_temp.fx_at(t0, k->'harvest'));
    assert (y->>'kg')::int = (k->'expect'->>'kg')::int, format('%s: kg %s, want %s', k->>'name', y->>'kg', k->'expect'->>'kg');
    foreach f in array array['mcare', 'mseed', 'mwater', 'mpest', 'mlate', 'mrat'] loop
      assert abs((y->>f)::double precision - (k->'expect'->>f)::double precision) < 1e-12,
        format('%s: %s %s, want %s', k->>'name', f, y->>f, k->'expect'->>f);
    end loop;
    assert public._crop_pests(c, v, pg_temp.fx_at(t0, k->'harvest')) = '[]', format('%s: no pests', k->>'name');
    -- a part cut while a rat eats pays part i of Y at its cut, Mrat included (v15.2 §6.1 as §16 amends it)
    i := 0;
    for p in select x from jsonb_array_elements(coalesce(k->'parts', '[]')) x loop
      i := i + 1;
      y := public._crop_yield(c, v, (k->>'land')::double precision, 1.0, pg_temp.fx_at(t0, p->0));
      assert public._part_kg(i, (y->>'kg')::int) = (p->>1)::int,
        format('%s: part %s at %s h, Y %s: %s kg, want %s', k->>'name', i, p->0, y->>'kg', public._part_kg(i, (y->>'kg')::int), p->1);
      np := np + 1;
    end loop;
  end loop;
  assert n = 4 and np = 6, format('%s rice rat cases, %s parts', n, np);
  -- by hand: R1 is 90 × 0.96 = 86.4 → 86 kg, R2 is 75 × 0.90 = 67.5 → 68 kg
  assert (select (e->'expect'->>'kg')::int from jsonb_array_elements(j->'rats') e where e->>'name' like 'R1,%') = 86
     and (select (e->'expect'->>'kg')::int from jsonb_array_elements(j->'rats') e where e->>'name' like 'R2,%') = 68, 'by hand';
end $$;

do $$
declare j jsonb := (select j from fxu); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        u public.upland_crops; y jsonb; f text; n int := 0;
begin
  for k in select x from jsonb_array_elements(j->'rats') x loop
    n := n + 1;
    c := pg_temp.fx_upcrop(t0, k);
    u := public._upland(k->>'upland');
    y := public._up_yield(c, u, (k->>'land')::double precision, (k->>'k')::int, pg_temp.fx_at(t0, k->'pick'));
    assert (y->>'kg')::int = (k->'expect'->>'kg')::int, format('%s: kg %s, want %s', k->>'name', y->>'kg', k->'expect'->>'kg');
    foreach f in array array['mcare', 'mplant', 'mwater', 'mrot', 'mpest', 'mlate', 'mrat'] loop
      assert abs((y->>f)::double precision - (k->'expect'->>f)::double precision) < 1e-12,
        format('%s: %s %s, want %s', k->>'name', f, y->>f, k->'expect'->>f);
    end loop;
  end loop;
  assert n = 2, format('%s hoa-màu rat cases', n);
end $$;

do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; e jsonb; h double precision; n int := 0;
begin
  for e in select x from jsonb_array_elements(j->'rat_edges') x loop
    n := n + 1;
    h := public._rat_hours(pg_temp.fx_rats(t0, e->'log'), pg_temp.fx_at(t0, e->'t'));
    assert h = (e->>'hours')::double precision, format('%s: %s h, want %s', e->>'name', h, e->>'hours');
    assert abs(public._rat_factor(h) - (e->>'mrat')::double precision) < 1e-12,
      format('%s: Mrat %s, want %s', e->>'name', public._rat_factor(h), e->>'mrat');
  end loop;
  assert n = 10, format('%s edges', n);
  assert public._rat_hours(null, now()) = 0, 'a crop row without a log';
  -- closing: the rat's open entry only, never before it opened
  assert public._rat_close('[{"r": 1, "from": "2026-03-01T00:00:00+00:00", "to": "2026-03-01T01:00:00+00:00"},
                             {"r": 2, "from": "2026-03-01T00:00:00+00:00", "to": null},
                             {"r": 3, "from": "2026-03-01T00:00:00+00:00", "to": null}]', 2, '2026-03-01 02:00+00')
         = '[{"r": 1, "from": "2026-03-01T00:00:00+00:00", "to": "2026-03-01T01:00:00+00:00"},
             {"r": 2, "from": "2026-03-01T00:00:00+00:00", "to": "2026-03-01T02:00:00+00:00"},
             {"r": 3, "from": "2026-03-01T00:00:00+00:00", "to": null}]', 'closes one entry';
  assert public._rat_close('[{"r": 4, "from": "2026-03-01T03:00:00+00:00", "to": null}]', 4, '2026-03-01 02:00+00')
         = '[{"r": 4, "from": "2026-03-01T03:00:00+00:00", "to": "2026-03-01T03:00:00+00:00"}]', 'never before it opened';
end $$;

-- ---------- rat food and the dog's name (§5.2, §7.1, D4, D20) ----------
do $$
declare t timestamptz := '2026-03-10 00:00:00+00'; c public.crops;
begin
  -- rice (short, s = 0.9): ripe from T + 43.2 h, overripe from T + 55.2 h
  c := jsonb_populate_record(null::public.crops, jsonb_build_object(
    'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'rice', 'variety', 'short',
    'prepared_at', t - interval '60 hours', 'soak_at', t - interval '60 hours', 'sow_at', t - interval '57 hours',
    'transplant_at', t - interval '48 hours', 'q_transplant', 1, 'harvested_parts', 2));
  assert public._rat_food(c, t - interval '5 hours') = false, 'ripening';
  assert public._rat_food(c, t), 'ripe, partly cut';
  assert public._rat_food(c, t + interval '8 hours'), 'overripe';
  c.harvester_at := t + interval '1 hour';
  assert public._rat_food(c, t) and not public._rat_food(c, t + interval '1 hour'), 'not once a harvester job has started';
  -- hoa màu: khoai and bắp ripe or overripe; ớt never; bare beds never
  c := jsonb_populate_record(null::public.crops, jsonb_build_object(
    'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'upland', 'upland', 'khoai',
    'prepared_at', t - interval '60 hours', 'plant_at', t - interval '50 hours', 'harvests', '[]'::jsonb));
  assert public._rat_food(c, t) and not public._rat_food(c, t - interval '3 hours'), 'khoai ripe at P + 48 h';
  c.upland := 'bap';
  assert public._rat_food(c, t + interval '11 hours') and not public._rat_food(c, t), 'bắp ripe at P + 60 h';
  c.upland := 'ot';
  c.sow_at := t - interval '70 hours';
  assert not exists (select 1 from generate_series(0, 120) h where public._rat_food(c, t + make_interval(hours => h))), 'ớt never';
  c.upland := null;
  c.plant_at := null;
  c.sow_at := null;
  assert not public._rat_food(c, t), 'bare beds';
  -- a dog's name: register's rules with 2–16 characters (lib/game/dog.ts dogNameRefusal refuses the same names)
  assert public._pet_name('Mực') = 'Mực' and public._pet_name('  Ki   Ki  ') = 'Ki Ki' and public._pet_name('Vàng Vện Đốm 16c') = 'Vàng Vện Đốm 16c'
     and public._pet_name('Ki') = 'Ki' and public._pet_name(U&'Mu\0301c') = 'Múc', 'accepted (NFC, trimmed, single spaces)';
  assert pg_temp.err('select public._pet_name(''M'')') = 'invalid name', '1 character';
  assert pg_temp.err('select public._pet_name(''Mười bảy ký tự nè'')') = 'invalid name', '17 characters';
  assert pg_temp.err('select public._pet_name(''Ao cá'')') = 'invalid name', 'a reserved name';
  assert pg_temp.err('select public._pet_name(''Hợp  tác  xã'')') = 'invalid name', 'a reserved name, spaced';
  assert pg_temp.err('select public._pet_name(''admin'')') = 'invalid name', 'admin';
  assert pg_temp.err(format('select public._pet_name(%L)', U&'\200B\200B')) = 'invalid name', 'zero-width';
  assert pg_temp.err(format('select public._pet_name(%L)', U&'Ki\200Bki')) = 'invalid name', 'a zero-width space inside';
  assert pg_temp.err(format('select public._pet_name(%L)', U&'Ki\00A0ki')) = 'invalid name', 'an odd space';
  assert pg_temp.err('select public._pet_name(null)') = 'invalid name', 'none';
end $$;

select 'v17 model smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected: `v14 smoke ok`, then `FAILED: supabase/migrations/0019_v17_rats.sql` — the migration does not exist yet (`psql: error: supabase/migrations/0019_v17_rats.sql: No such file or directory` in the log).

- [ ] **Step 3: Write sections A–C**

Create `supabase/migrations/0019_v17_rats.sql` with exactly:

```sql
-- =========================================================
-- 0019_v17_rats.sql — v17 "Mùa chuột" (docs/superpowers/specs/2026-09-26-music-together-v17-rats-design.md): field
-- rats that come out of the bunds and eat ripe plots, the slingshot (ná) and its clay pellets, and the dog (chó cỏ) that
-- follows its owner and pounces on a rat every 5 minutes. Caught rats are sold to cô Út at the room's fish multiplier.
-- ADDITIVE (no data drop) and re-runnable. Requires 0013, 0015, 0016, 0017 and 0018: it re-creates functions they last
-- defined, each from its latest body with only the lines marked "v17" added (anti-cheat spec §11.3 rules 1 and 3). Every
-- function relies on `set search_path = public, extensions`. Time rules live in private functions that take p_now; the
-- public RPCs pass now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Catalog (§5.2, §8, C1) ----------
-- Rat food (D4): rice by its kind; of the hoa màu, khoai and bắp. Ớt never.
alter table public.upland_crops add column if not exists rat_food boolean not null default false;
update public.upland_crops set rat_food = true where id in ('khoai', 'bap');

-- The kinds in force after 0018 plus the pellets and the dog food (§16).
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food'));

-- anh Hai's three new items (§8, D29): the ná is a tool, bought once; pellets and food stack to 99.
insert into public.shop_items (id, kind, name, price, starter, sort_order) values
  ('tool_sling',  'tool',     'Ná',          3000, false, 30),
  ('ammo_pellet', 'ammo',     'Đạn đất',       10, false, 10),
  ('food_dog',    'pet_food', 'Thức ăn chó',  150, false, 20)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order;

-- The 21 reasons in force after 0018 plus the rat sale and the adoption (C1): 23. Anti-cheat §11.3 rule 4 keeps 'wipe'.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell',
                    'rat_sell','dog_adopt'));

-- ---------- B. Tables (§10.2; private: RLS on, no policies — only the RPCs touch them) ----------
-- A crop's rats (D6): [{r, from, to}], one entry per rat that ate it; the entry opens at the sweep that found the rat.
alter table public.crops add column if not exists rat_log jsonb not null default '[]'::jsonb;

-- The room's rats: one per spawn candidate k (D1), alive while ended_at is null.
create table if not exists public.field_rats (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  plot_no smallint not null check (plot_no between 1 and 10),
  k bigint not null,
  seed integer not null,
  spawned_at timestamptz not null,
  ended_at timestamptz,
  how text check (how in ('sling', 'dog', 'fled')),
  caught_by uuid references public.accounts(id) on delete set null,
  price integer check (price > 0),
  unique (room_id, k)
);
create index if not exists idx_field_rats_room on public.field_rats (room_id, ended_at);

-- The last spawn candidate a room's sweep has evaluated (§5.3).
create table if not exists public.rat_clocks (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  last_k bigint not null
);

-- Caught rats, each at the price fixed at its catch (D11, D12), until cô Út buys them.
create table if not exists public.rat_bag (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  price integer not null check (price > 0),
  caught_at timestamptz not null,
  how text not null check (how in ('sling', 'dog'))
);
create index if not exists idx_rat_bag_account on public.rat_bag (account_id);

-- One dog per account (D22): named by its owner, fed daily, resting 5 minutes after a catch.
create table if not exists public.dogs (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 16),
  coat text not null check (coat in ('vang', 'muc', 'ven', 'dom')),
  adopted_at timestamptz not null,
  fed_until timestamptz,
  next_hunt_at timestamptz,
  catches integer not null default 0 check (catches >= 0)
);

-- The slingshot's aim (D14): one per account, bound to a room and a rat.
create table if not exists public.sling_aims (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  rat_id bigint not null,
  started_at timestamptz not null,
  last_shot_at timestamptz,
  shots smallint not null default 0
);

alter table public.field_rats enable row level security;
alter table public.rat_clocks enable row level security;
alter table public.rat_bag enable row level security;
alter table public.dogs enable row level security;
alter table public.sling_aims enable row level security;
revoke all on public.field_rats, public.rat_clocks, public.rat_bag, public.dogs, public.sling_aims from anon, authenticated;

-- The catch caps (D13): the hourly window and the Vietnam day of each account.
alter table public.farm_profiles add column if not exists rat_win_start timestamptz;
alter table public.farm_profiles add column if not exists rat_win_count smallint not null default 0;
alter table public.farm_profiles add column if not exists rat_day_on date;
alter table public.farm_profiles add column if not exists rat_day_count smallint not null default 0;

-- ---------- C. The model (§5.2–§5.5, §7.1; private) ----------
-- u(k, s) in [0, 1): the first 32 bits of md5(room:k:s) (§5.3).
create or replace function public._rat_u(p_room uuid, p_k bigint, p_s text) returns double precision
language sql immutable set search_path = public, extensions
as $$ select (('x' || left(md5(p_room::text || ':' || p_k::text || ':' || p_s), 8))::bit(32)::bigint)::double precision / 4294967296 $$;

-- t(k): candidate k of a room is due at k·900 s + floor(u(k, 't')·300) s, whole seconds (D1).
create or replace function public._rat_t(p_room uuid, p_k bigint) returns timestamptz
language sql immutable set search_path = public, extensions
as $$ select to_timestamp((p_k * 900)::double precision + floor(public._rat_u(p_room, p_k, 't') * 300)) $$;

-- k(t): the last candidate due at or before t.
create or replace function public._rat_k(p_room uuid, p_t timestamptz) returns bigint
language sql stable set search_path = public, extensions
as $$
  select case when public._rat_t(p_room, x.k0) <= p_t then x.k0 else x.k0 - 1 end
    from (select floor(extract(epoch from p_t) / 900)::bigint as k0) x
$$;

-- Rat-hours of a crop's log at t (§5.5): each entry with from < t counts hrs(from, min(to ?? t, t)), added in log order
-- (lib/game/farm/rats.ts ratHours adds in the same order).
create or replace function public._rat_hours(p_log jsonb, p_t timestamptz) returns double precision
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; v_h double precision := 0; v_from timestamptz;
begin
  for e in select x from jsonb_array_elements(coalesce(p_log, '[]'::jsonb)) with ordinality w(x, n) order by n loop
    v_from := (e->>'from')::timestamptz;
    if v_from < p_t then
      v_h := v_h + public._hrs(v_from, least(coalesce((e->>'to')::timestamptz, p_t), p_t));
    end if;
  end loop;
  return v_h;
end $$;

-- Mrat = 1 − min(0.10, 0.02 · rat-hours) (D6).
create or replace function public._rat_factor(p_h double precision) returns double precision
language sql immutable set search_path = public, extensions
as $$ select 1 - least(0.10::double precision, 0.02::double precision * p_h) $$;

-- Closes a rat's open entry at t (never before it opened); the other entries stay as they are.
create or replace function public._rat_close(p_log jsonb, p_rat bigint, p_t timestamptz) returns jsonb
language sql stable set search_path = public, extensions
as $$
  select coalesce(jsonb_agg(case when (w.x->>'r')::bigint = p_rat and w.x->'to' = 'null'::jsonb
                                 then jsonb_set(w.x, '{to}', to_jsonb(greatest(p_t, (w.x->>'from')::timestamptz)))
                                 else w.x end order by w.n), '[]'::jsonb)
    from jsonb_array_elements(p_log) with ordinality w(x, n)
$$;

-- Is the crop rat food at t (§5.2)? Rice ripe or overripe with no harvester job started; khoai and bắp ripe or overripe.
create or replace function public._rat_food(c public.crops, p_t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare u public.upland_crops;
begin
  if c.kind = 'rice' then
    return public._crop_phase(c, public._variety(c.variety), p_t) in ('ripe', 'overripe')
       and not (c.harvester_at is not null and p_t >= c.harvester_at);
  end if;
  u := public._upland(c.upland);
  return coalesce(u.rat_food, false) and public._up_phase(c, u, p_t) in ('ripe', 'overripe');
end $$;

-- A dog's name (§7.1, D20): register's rules (0015) with 2–16 characters — NFC, trimmed, single spaces, no control,
-- odd-space, invisible or combining character, no reserved key. lib/game/dog.ts dogNameRefusal mirrors it.
create or replace function public._pet_name(p_name text) returns text
language plpgsql stable set search_path = public, extensions
as $$
declare v text := regexp_replace(btrim(normalize(coalesce(p_name, ''), NFC)), ' {2,}', ' ', 'g');
begin
  if char_length(v) not between 2 and 16
     or v ~ '[\u0001-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]'
     or public._name_key(v) in ('aoca', 'hoptacxa', 'hethong', 'quantri', 'quantrivien', 'admin', 'root', 'system') then
    raise exception 'invalid name' using errcode = '22023';
  end if;
  return v;
end $$;

-- The harvest in kg (0013's body, §8.6), with its factors for tests and the plot panel; v17: Mrat, the rats' share at
-- p_now, is the last factor of the product (§5.5), and the JSON gains mrat.
create or replace function public._crop_yield(c public.crops, v public.rice_varieties, p_land double precision,
                                              p_qh double precision, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare s double precision := v.scale; care jsonb := public._crop_care(c, v); pe jsonb; v_pen double precision := 0;
        v_mcare double precision; v_mseed double precision; v_mwater double precision; v_mpest double precision := 1;
        v_mlate double precision; v_x double precision; v_kg integer;
        v_mrat double precision;                                                          -- v17
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
  v_mrat := public._rat_factor(public._rat_hours(c.rat_log, p_now));                  -- v17
  v_x := v.base_kg * p_land * v_mcare * v_mseed * v_mwater * v_mpest * v_mlate * c.q_transplant * p_qh * v_mrat;   -- v17: · Mrat
  v_kg := greatest((v.base_kg + 9) / 10, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mseed', v_mseed, 'mwater', v_mwater, 'mpest', v_mpest,
                            'mlate', v_mlate, 'mrat', v_mrat);                                -- v17: mrat
end; $$;

-- Picking k at p_now in kg (0016's body, v15.2 §8.7), with its factors: every factor at the picking time, the products
-- left to right; v17: Mrat right after Mlate, before · pct / 100 (§5.5, §16), and the JSON gains mrat.
create or replace function public._up_yield(c public.crops, u public.upland_crops, p_land double precision, p_k integer,
                                            p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare care jsonb := public._up_care(c, u); s jsonb; pe jsonb; v_pen double precision := 0; v_end timestamptz;
        v_mcare double precision; v_mplant double precision := 1; v_mwater double precision; v_mrot double precision := 1;
        v_mpest double precision := 1; v_mlate double precision; v_x double precision; v_pct integer; v_kg integer;
        v_mrat double precision;                                                          -- v17
begin
  if not (care->>'manure')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  if not (care->>'phosphate')::boolean then v_pen := v_pen + 0.05::double precision; end if;
  for s in select x from jsonb_array_elements(care->'scores') x loop
    v_pen := v_pen + (s #>> '{}')::double precision;
  end loop;
  if (care->>'excess')::boolean then v_pen := v_pen + 0.10::double precision; end if;
  v_mcare := 1 - v_pen;
  if u.method = 'nursery' then
    v_mplant := 1 - least(0.3::double precision,
                          0.03::double precision * greatest(0::double precision, public._hrs(c.sow_at, c.plant_at) - u.nursery_old_h));
  end if;
  v_mwater := 1 - least(0.2::double precision, 0.01::double precision * public._up_off_hours(c, u, p_now));
  if u.rot_from_h is not null then
    v_mrot := 1 - least(u.rot_cap, u.rot_rate * public._up_rot_hours(c, u, p_now));
  end if;
  for pe in select x from jsonb_array_elements(public._up_pests(c, u, p_now)) x loop
    v_end := coalesce((pe->>'treated_at')::timestamptz, p_now);
    v_mpest := v_mpest * (1 - least(0.3::double precision, 0.015::double precision
               * case when v_end <= (pe->>'since')::timestamptz then 0::double precision
                      else public._hrs((pe->>'since')::timestamptz, v_end) end));
  end loop;
  v_mlate := 1 - least(0.6::double precision, u.over_rate * greatest(0::double precision,
               public._hrs(public._plus_h(c.plant_at, public._up_hours(u, p_k) + u.ripe_window_h), p_now)));
  v_mrat := public._rat_factor(public._rat_hours(c.rat_log, p_now));                  -- v17
  v_pct := (u.pickings->>(p_k - 1))::int;
  v_x := (((((((((u.base_kg * p_land) * v_mcare) * v_mplant) * v_mwater) * v_mrot) * v_mpest) * v_mlate) * v_mrat) * v_pct) / 100;
  v_kg := greatest((u.base_kg * v_pct + 999) / 1000, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mplant', v_mplant, 'mwater', v_mwater, 'mrot', v_mrot,
                            'mpest', v_mpest, 'mlate', v_mlate, 'mrat', v_mrat);          -- v17: mrat
end; $$;

revoke all on function public._rat_u(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public._rat_t(uuid, bigint) from public, anon, authenticated;
revoke all on function public._rat_k(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_hours(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_factor(double precision) from public, anon, authenticated;
revoke all on function public._rat_close(jsonb, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_food(public.crops, timestamptz) from public, anon, authenticated;
revoke all on function public._pet_name(text) from public, anon, authenticated;
revoke all on function public._crop_yield(public.crops, public.rice_varieties, double precision, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._up_yield(public.crops, public.upland_crops, double precision, integer, timestamptz)
  from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected:

```text
v14 smoke ok
0019 twice ok
lyrics lockdown smoke ok
v15 crop smoke ok
v15 land smoke ok
v15 farm smoke ok
v15 fish price smoke ok
v15 upgrade reset smoke ok
anticheat names and queue smoke ok
anticheat flow smoke ok
anticheat fishing smoke ok
anticheat farm smoke ok
anticheat shared functions smoke ok
anticheat admin smoke ok
anticheat guards ok
v15.2 model smoke ok
v15.2 field smoke ok
v15.2 harvest smoke ok
v15.2 tools smoke ok
v15.2 beds smoke ok
anticheat guards ok
v16 rules smoke ok
v16 cao and poker rules smoke ok
v16 tables smoke ok
v16 tienlen smoke ok
v16 cao smoke ok
v16 poker smoke ok
v16 holdings and deletions smoke ok
anticheat guards ok
v15.3 model smoke ok
v15.3 gathering smoke ok
v15.3 farm smoke ok
v15.3 wipe smoke ok
anticheat guards ok
v17 model smoke ok
anticheat guards ok
v17 model smoke ok
anticheat guards ok
ALL OK
```

Also run `pnpm vitest run tests/unit/farm-crop.test.ts tests/unit/farm-upland.test.ts`: they still pass (the rat cases sit under their own key, which Task 5 reads).

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v17): 0019 catalog, tables and the rat model

Sections A–C of 0019_v17_rats.sql: upland_crops.rat_food (khoai and bắp); the kinds
ammo and pet_food; the ná, đạn đất and thức ăn chó at anh Hai's; the ledger check with
the 21 reasons in force after 0018 plus rat_sell and dog_adopt; crops.rat_log, the
private tables field_rats, rat_clocks, rat_bag, dogs and sling_aims, and the catch caps
on farm_profiles; the spawn clock (_rat_u, _rat_t, _rat_k), the rat-hours and Mrat
(_rat_hours, _rat_factor, _rat_close), rat food (_rat_food) and the dog's name
(_pet_name); and _crop_yield and _up_yield with Mrat as the last factor of the product.
The shared fixtures gain the rat cases R1–R4, U1, U2 and the rat edges, and
tests/sql/v17-smoke.sql starts. The v15 smoke takes the new kinds out before it re-runs
0013, whose item check does not know them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0019_v17_rats.sql tests/fixtures/crop-cases.json tests/fixtures/upland-cases.json tests/sql/v15-smoke.sql tests/sql/v17-smoke.sql
git commit -F <message file>
```

---

### Task 2: Database — the field's rats: spawn, damage, flight and the catch (`0019` section D)

**Files:**
- Modify: `supabase/migrations/0019_v17_rats.sql`
- Test: `tests/sql/anticheat-smoke.sql`, `tests/sql/v15-2-smoke.sql`, `tests/sql/v15-gather-smoke.sql`, `tests/sql/v15-smoke.sql`, `tests/sql/v17-smoke.sql` (modify)

**Interfaces:**
- Consumes: Task 1 (the tables, the clock, `_rat_hours`, `_rat_close`, `_rat_food`); from `0013`–`0018`: `_field_open(room, now)` (`0016`'s: `_field_sweep`, then the lease and fall steps), `_farm_mine(account)` and `_field_view(room, viewer, now)` (`0018`'s bodies), `_fish_index`, `_critter_price`, `_critter_prices`, `_ac_flag`, `_vn_today()`.
- Produces (private, §5.3–§5.6, §10.3, §10.5):
  - `_rat_sweep(room, now)`, run by `_field_open` after `_field_sweep`: rats whose crop stopped being food flee (their log entry closes, `how = 'fled'`), rows ended over 1 h ago are purged, then the candidates `k` after the room's `last_k` and at most 30 minutes old spawn a rat each on a food plot while fewer than 3 are alive and the crop has drawn fewer than 20 (`last_k = greatest(last_k, k)`);
  - `_rat_caps(account, now, take, how, room)` (6 per hourly window, 24 per Vietnam day: `rat limit` with the seconds, `rat daily limit`; the 24th logs the soft `rat_daily_cap`) and `_rat_caps_view(account, now)`;
  - `_rat_catch(room, account, rat, how, now) → price`: `rat gone` unless the rat is live in this room; the caps; `floor(150 × M)` from the room's index at the catch, after the caller's wallet; the bag row; the rat ends with its catcher;
  - `_dog_view(account)`, `_rats_view(room, now) → {next_at, price, live, recent, plots}`;
  - `_farm_mine` gains `rats {count, value}`, `rat_caps {hour_left, hour_resets_at, day_left}` and `dog`, and `_field_view` gains `rats`.
- Produces (smokes): `pg_temp.no_rats(p_key)` in the v15, anti-cheat, v15.2 and gather smokes, called after each room they create (ruling); the v17 smoke's field part: the sweep, the lookback, `last_k`, the caps of 3 alive and 20 a crop, the flights, the purge, the damage of cut parts, the room binding, the prices without an index write, the caps, prints `v17 field smoke ok`.

- [ ] **Step 1: Switch the rats off in the earlier smokes, and write the smoke's field part**

**tests/sql/anticheat-smoke.sql — edit 1 of 5.** Replace:

```sql
create temp table smoke (k text primary key, v text);
```

with:

```sql
create temp table smoke (k text primary key, v text);

-- v17 (0019): rats off in this smoke's rooms. Once 0019 is in, no_rats gives the room a far-future rat clock, so its
-- sweep evaluates no spawn candidate; before 0019 it does nothing.
create function pg_temp.no_rats(p_key text) returns void language plpgsql as $$
begin
  if to_regclass('public.rat_clocks') is not null then
    execute format('insert into public.rat_clocks (room_id, last_k) select v::uuid, 9000000000000000000 from smoke where k = %L
                    on conflict (room_id) do update set last_k = excluded.last_k', p_key);
  end if;
end $$;
```

**tests/sql/anticheat-smoke.sql — edit 2 of 5.** Replace:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Chống gian lận', 'pw', (select v from smoke where k = 't1'));
```

with:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Chống gian lận', 'pw', (select v from smoke where k = 't1'));
select pg_temp.no_rats('room');
```

**tests/sql/anticheat-smoke.sql — edit 3 of 5.** Replace:

```sql
insert into smoke select 'froom', room_id::text from public.create_room('Đồng gian lận', 'pw', (select v from smoke where k = 'g1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'froom')::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'froom', room_id::text from public.create_room('Đồng gian lận', 'pw', (select v from smoke where k = 'g1'));
select pg_temp.no_rats('froom');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'froom')::uuid), 'pw', v)
```

**tests/sql/anticheat-smoke.sql — edit 4 of 5.** Replace:

```sql
insert into smoke select 'sroom', room_id::text from public.create_room('Ruộng quét', 'pw', (select v from smoke where k = 'k1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'sroom')::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'sroom', room_id::text from public.create_room('Ruộng quét', 'pw', (select v from smoke where k = 'k1'));
select pg_temp.no_rats('sroom');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'sroom')::uuid), 'pw', v)
```

**tests/sql/anticheat-smoke.sql — edit 5 of 5.** Replace:

```sql
insert into smoke select 'aroom', room_id::text from public.create_room('Phòng xử', 'pw', (select v from smoke where k = 'n1'));
insert into smoke select 'aroom2', room_id::text from public.create_room('Phòng xử 2', 'pw', (select v from smoke where k = 'n1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = r)::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'aroom', room_id::text from public.create_room('Phòng xử', 'pw', (select v from smoke where k = 'n1'));
select pg_temp.no_rats('aroom');
insert into smoke select 'aroom2', room_id::text from public.create_room('Phòng xử 2', 'pw', (select v from smoke where k = 'n1'));
select pg_temp.no_rats('aroom2');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = r)::uuid), 'pw', v)
```

**tests/sql/v15-2-smoke.sql — edit 1 of 3.** Replace:

```sql
create temp table smoke (k text primary key, v text);
```

with:

```sql
create temp table smoke (k text primary key, v text);

-- v17 (0019): rats off in this smoke's rooms. Once 0019 is in, no_rats gives the room a far-future rat clock, so its
-- sweep evaluates no spawn candidate; before 0019 it does nothing.
create function pg_temp.no_rats(p_key text) returns void language plpgsql as $$
begin
  if to_regclass('public.rat_clocks') is not null then
    execute format('insert into public.rat_clocks (room_id, last_k) select v::uuid, 9000000000000000000 from smoke where k = %L
                    on conflict (room_id) do update set last_k = excluded.last_k', p_key);
  end if;
end $$;
```

**tests/sql/v15-2-smoke.sql — edit 2 of 3.** Replace:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Nông cụ', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Nông cụ', 'pw', (select v from smoke where k = 't1'));
select pg_temp.no_rats('room');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
```

**tests/sql/v15-2-smoke.sql — edit 3 of 3.** Replace:

```sql
insert into smoke select 'room3', room_id::text from public.create_room('Gặt lúa', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room3')::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'room3', room_id::text from public.create_room('Gặt lúa', 'pw', (select v from smoke where k = 't1'));
select pg_temp.no_rats('room3');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room3')::uuid), 'pw', v)
```

**tests/sql/v15-gather-smoke.sql — edit 1 of 4.** Replace:

```sql
create temp table smoke (k text primary key, v text);
```

with:

```sql
create temp table smoke (k text primary key, v text);

-- v17 (0019): rats off in this smoke's rooms. Once 0019 is in, no_rats gives the room a far-future rat clock, so its
-- sweep evaluates no spawn candidate; before 0019 it does nothing.
create function pg_temp.no_rats(p_key text) returns void language plpgsql as $$
begin
  if to_regclass('public.rat_clocks') is not null then
    execute format('insert into public.rat_clocks (room_id, last_k) select v::uuid, 9000000000000000000 from smoke where k = %L
                    on conflict (room_id) do update set last_k = excluded.last_k', p_key);
  end if;
end $$;
```

**tests/sql/v15-gather-smoke.sql — edit 2 of 4.** Replace:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Bờ mương', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Bờ mương', 'pw', (select v from smoke where k = 't1'));
select pg_temp.no_rats('room');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
```

**tests/sql/v15-gather-smoke.sql — edit 3 of 4.** Replace:

```sql
insert into smoke select 'room2', room_id::text from public.create_room('Hang cua', 'pw', (select v from smoke where k = 't3'));
insert into smoke select 'room3', room_id::text from public.create_room('Bãi ốc', 'pw', (select v from smoke where k = 't3'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room2')::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'room2', room_id::text from public.create_room('Hang cua', 'pw', (select v from smoke where k = 't3'));
select pg_temp.no_rats('room2');
insert into smoke select 'room3', room_id::text from public.create_room('Bãi ốc', 'pw', (select v from smoke where k = 't3'));
select pg_temp.no_rats('room3');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room2')::uuid), 'pw', v)
```

**tests/sql/v15-gather-smoke.sql — edit 4 of 4.** Replace:

```sql
insert into smoke select 'room4', room_id::text from public.create_room('Ruộng lúa', 'pw', (select v from smoke where k = 't5'));
insert into smoke select 'room5', room_id::text from public.create_room('Cấy lúa', 'pw', (select v from smoke where k = 't5'));
insert into smoke select 'room6', room_id::text from public.create_room('Cây ớt', 'pw', (select v from smoke where k = 't5'));
insert into smoke select 'room7', room_id::text from public.create_room('Hái hoa màu', 'pw', (select v from smoke where k = 't5'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room4')::uuid), 'pw', v)
```

with:

```sql
insert into smoke select 'room4', room_id::text from public.create_room('Ruộng lúa', 'pw', (select v from smoke where k = 't5'));
select pg_temp.no_rats('room4');
insert into smoke select 'room5', room_id::text from public.create_room('Cấy lúa', 'pw', (select v from smoke where k = 't5'));
select pg_temp.no_rats('room5');
insert into smoke select 'room6', room_id::text from public.create_room('Cây ớt', 'pw', (select v from smoke where k = 't5'));
select pg_temp.no_rats('room6');
insert into smoke select 'room7', room_id::text from public.create_room('Hái hoa màu', 'pw', (select v from smoke where k = 't5'));
select pg_temp.no_rats('room7');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room4')::uuid), 'pw', v)
```

**tests/sql/v15-smoke.sql — edit 1 of 3.** Replace:

```sql
create temp table smoke (k text primary key, v text);
insert into smoke select 't1', token from public.register('smoke15_a_' || floor(random() * 1e9)::text, 'pw123456');
```

with:

```sql
create temp table smoke (k text primary key, v text);

-- v17 (0019): rats off in this smoke's rooms. Once 0019 is in, no_rats gives the room a far-future rat clock, so its
-- sweep evaluates no spawn candidate; before 0019 it does nothing.
create function pg_temp.no_rats(p_key text) returns void language plpgsql as $$
begin
  if to_regclass('public.rat_clocks') is not null then
    execute format('insert into public.rat_clocks (room_id, last_k) select v::uuid, 9000000000000000000 from smoke where k = %L
                    on conflict (room_id) do update set last_k = excluded.last_k', p_key);
  end if;
end $$;
insert into smoke select 't1', token from public.register('smoke15_a_' || floor(random() * 1e9)::text, 'pw123456');
```

**tests/sql/v15-smoke.sql — edit 2 of 3.** Replace:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Đồng test', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'code', code from public.rooms where id = (select v from smoke where k = 'room')::uuid;
```

with:

```sql
insert into smoke select 'room', room_id::text from public.create_room('Đồng test', 'pw', (select v from smoke where k = 't1'));
select pg_temp.no_rats('room');
insert into smoke select 'code', code from public.rooms where id = (select v from smoke where k = 'room')::uuid;
```

**tests/sql/v15-smoke.sql — edit 3 of 3.** Replace:

```sql
insert into smoke select 'room2', room_id::text from public.create_room('Ruộng test', 'pw', (select v from smoke where k = 't2'));
insert into smoke select 'code2', code from public.rooms where id = (select v from smoke where k = 'room2')::uuid;
```

with:

```sql
insert into smoke select 'room2', room_id::text from public.create_room('Ruộng test', 'pw', (select v from smoke where k = 't2'));
select pg_temp.no_rats('room2');
insert into smoke select 'code2', code from public.rooms where id = (select v from smoke where k = 'room2')::uuid;
```

**tests/sql/v17-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- the field: spawning, the rats' life, the damage, the catch and the view (§5.3–§5.6, §10.5) ----------
insert into smoke select 't1', token from public.register('rat_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('rat_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('rat_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a' || right(k, 1), public._auth_account(v)::text from smoke where k in ('t1', 't2', 't3');
insert into smoke select 'room', room_id::text from public.create_room('Mùa chuột', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'room2', room_id::text from public.create_room('Ruộng khó ăn', 'pw', (select v from smoke where k = 't1'));
insert into smoke select 'room3', room_id::text from public.create_room('Chuột chạy', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = r.v::uuid), 'pw', a.v)
  from smoke r, smoke a where r.k in ('room', 'room2', 'room3') and a.k in ('t2', 't3');
insert into smoke select 'now', date_trunc('minute', now())::text;

create function pg_temp.crop(r uuid, n integer) returns public.crops language sql
as $$ select * from public.crops where room_id = r and plot_no = n $$;
create function pg_temp.wet(a uuid) returns integer language sql
as $$ select coalesce((select sum(wet_kg)::int from public.rice_stock where account_id = a), 0) $$;
-- A rice crop on plot n, farmed by a, transplanted at tp and drained from tp + 40 h (short: ripe from tp + 43.2 h,
-- overripe from tp + 55.2 h, fallen at tp + 103.2 h).
create function pg_temp.rice(r uuid, n integer, a uuid, variety text, tp timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
      values (r, n, a, variety, tp - interval '12 hours', tp - interval '12 hours', tp - interval '9 hours', tp,
              jsonb_build_array(jsonb_build_object('t', tp - interval '12 hours', 'l', 3),
                                jsonb_build_object('t', tp + interval '40 hours', 'l', 1))) $$;
-- A hoa-màu crop on plot n, planted at p (khoai: ripe from p + 48 h; bắp: from p + 60 h; ớt: picking 1 from p + 46 h).
create function pg_temp.upland(r uuid, n integer, a uuid, u text, p timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, plant_at, water_log)
      values (r, n, a, 'upland', u, p - interval '12 hours', case when u = 'ot' then p - interval '11 hours' end, p,
              jsonb_build_array(jsonb_build_object('t', p - interval '12 hours', 'l', 1))) $$;
-- A live rat on plot n since t, with its entry in the crop's log (for rooms whose clock is off; its k is made up).
create temp sequence rat_k;
create function pg_temp.rat(r uuid, n integer, t timestamptz) returns bigint language plpgsql as $$
declare v_id bigint;
begin
  insert into public.field_rats (room_id, plot_no, k, seed, spawned_at) values (r, n, -nextval('rat_k'), 4242, t)
  returning id into v_id;
  update public.crops set rat_log = rat_log || jsonb_build_array(jsonb_build_object('r', v_id, 'from', t, 'to', null))
   where room_id = r and plot_no = n;
  return v_id;
end $$;
create function pg_temp.live(s jsonb) returns bigint[] language sql
as $$ select coalesce(array_agg((x->>'id')::bigint order by (x->>'id')::bigint), '{}') from jsonb_array_elements(s->'rats'->'live') x $$;
create function pg_temp.recent(s jsonb, id bigint) returns jsonb language sql
as $$ select x from jsonb_array_elements(s->'rats'->'recent') x where (x->>'id')::bigint = id $$;

-- Spawning (§5.3): at t(k) once a sweep runs after it; a late sweep looks back 30 minutes and its rats eat from that sweep;
-- last_k; one rat per (room, k); at most 3 alive.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; v_k bigint; tk timestamptz; t3 timestamptz;
        r public.field_rats; n integer;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform public._farm_do_rent(room, a1, 5, t);
  assert (select last_k from public.rat_clocks where room_id = room) = public._rat_k(room, t), 'the first sweep sets the clock';
  assert not exists (select 1 from public.field_rats where room_id = room), 'no crop, no rat';
  perform pg_temp.rice(room, 5, a1, 'short', t - interval '44 hours');
  v_k := public._rat_k(room, t) + 1;
  tk := public._rat_t(room, v_k);
  perform public._field_open(room, tk - interval '1 second');
  assert not exists (select 1 from public.field_rats where room_id = room), 'nothing before t(k)';
  perform public._field_open(room, tk);
  select * into r from public.field_rats where room_id = room;
  assert r.k = v_k and r.spawned_at = tk and r.plot_no = 5 and r.ended_at is null and r.how is null and r.caught_by is null
     and r.seed = floor(public._rat_u(room, v_k, 's') * 2147483647)::int, format('a rat at t(k): %s', to_jsonb(r));
  assert (pg_temp.crop(room, 5)).rat_log = jsonb_build_array(jsonb_build_object('r', r.id, 'from', tk, 'to', null)),
    'its entry opens at the sweep';
  -- 3 h later: only the candidates of the last 30 minutes, spawned at t(k) but eating from this sweep (D3)
  t3 := tk + interval '3 hours';
  perform public._field_open(room, t3);
  n := least(2, public._rat_k(room, t3) - public._rat_k(room, t3 - interval '1800 seconds'));
  assert (select count(*) from public.field_rats where room_id = room and id <> r.id) = n and n >= 1
     and not exists (select 1 from public.field_rats where room_id = room and id <> r.id
                      and (spawned_at <= t3 - interval '1800 seconds' or spawned_at > t3
                           or spawned_at <> public._rat_t(room, k))), format('the lookback: %s new', n);
  assert (select count(*) from jsonb_array_elements((pg_temp.crop(room, 5)).rat_log) e
           where (e->>'r')::bigint <> r.id and (e->>'from')::timestamptz = t3 and e->'to' = 'null') = n, 'found late: from this sweep';
  assert (select last_k from public.rat_clocks where room_id = room) = public._rat_k(room, t3), 'last_k = k(p_now)';
  -- last_k stops a second evaluation, and a re-evaluation keeps one rat per (room, k)
  perform public._field_open(room, t3);
  update public.rat_clocks set last_k = last_k - 10 where room_id = room;
  perform public._field_open(room, t3);
  assert (select count(*) from public.field_rats where room_id = room) = n + 1
     and jsonb_array_length((pg_temp.crop(room, 5)).rat_log) = n + 1, 'one rat per candidate';
  assert (select last_k from public.rat_clocks where room_id = room) = public._rat_k(room, t3), 'last_k is back';
  -- at most 3 alive
  perform public._field_open(room, t3 + interval '1 hour');
  assert (select count(*) from public.field_rats where room_id = room and ended_at is null) = 3, 'three alive';
  perform public._field_open(room, t3 + interval '2 hours');
  assert (select count(*) from public.field_rats where room_id = room) = 3, 'no fourth while three are alive';
  insert into smoke values ('t_room', (t3 + interval '2 hours')::text);
end $$;

-- Where no rat comes (§5.2, D4, D7): a crop with 20 rats in its life, a crop not yet ripe, a started harvester, ớt; a
-- far-future last_k spawns nothing and stays. Khoai and bắp do get rats.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        r public.field_rats;
begin
  perform pg_temp.set_coins(a3, 100000);
  perform public._field_open(room, t);
  update public.field_plots set owner_id = a2, owned_at = t where room_id = room and plot_no between 1 and 4;
  perform pg_temp.rice(room, 1, a2, 'short', t - interval '44 hours');
  update public.crops set rat_log = (select jsonb_agg(jsonb_build_object('r', -g, 'from', t - interval '3 hours', 'to', t - interval '2 hours'))
                                       from generate_series(1, 20) g)
   where room_id = room and plot_no = 1;
  perform pg_temp.rice(room, 2, a2, 'short', t - interval '30 hours');
  perform pg_temp.rice(room, 3, a2, 'short', t - interval '44 hours');
  update public.crops set harvester_at = t, harvester_until = t + interval '10 hours' where room_id = room and plot_no = 3;
  perform pg_temp.upland(room, 4, a2, 'ot', t - interval '47 hours');
  perform public._field_open(room, t + interval '1 hour');
  perform public._field_open(room, t + interval '2 hours');
  assert not exists (select 1 from public.field_rats where room_id = room), 'no rats for these crops';
  -- khoai: none while the clock is far in the future, which the sweep keeps
  perform public._farm_do_rent(room, a3, 5, t + interval '2 hours');
  perform pg_temp.upland(room, 5, a3, 'khoai', t - interval '47 hours');
  update public.rat_clocks set last_k = 9000000000000000000 where room_id = room;
  perform public._field_open(room, t + interval '3 hours');
  assert not exists (select 1 from public.field_rats where room_id = room)
     and (select last_k from public.rat_clocks where room_id = room) = 9000000000000000000, 'far-future last_k';
  update public.rat_clocks set last_k = public._rat_k(room, t + interval '3 hours') where room_id = room;
  perform public._field_open(room, t + interval '4 hours');
  assert exists (select 1 from public.field_rats where room_id = room)
     and not exists (select 1 from public.field_rats where room_id = room and plot_no <> 5), 'khoai gets rats';
  -- bắp, once the khoai is gone
  perform public._farm_do_abandon(room, a3, 5, t + interval '5 hours');
  perform public._farm_do_rent(room, a3, 6, t + interval '5 hours');
  perform pg_temp.upland(room, 6, a3, 'bap', t - interval '56 hours');
  perform public._field_open(room, t + interval '6 hours');
  assert exists (select 1 from public.field_rats where room_id = room and plot_no = 6 and ended_at is null)
     and not exists (select 1 from public.field_rats where room_id = room and plot_no = 5 and ended_at is null), 'bắp gets rats';
end $$;

-- The rats' life (§5.4, D5): the acting call's answer lists a rat whose crop is gone or no longer food as fled, the next
-- sweep ends it; a lease end, fallen rice, the harvester; the purge. Room 3's clock is off: its rats are placed by hand.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; s jsonb; x jsonb; y jsonb; v_kg integer; w0 integer;
        r6 bigint; r7 bigint; r5 bigint; r2 bigint; r5b bigint; r1 bigint;
begin
  perform public._field_open(room, t - interval '2 hours');
  update public.rat_clocks set last_k = 9000000000000000000 where room_id = room;
  perform pg_temp.set_coins(a1, 100000);
  perform pg_temp.set_coins(a2, 100000);
  perform pg_temp.set_coins(a3, 100000);
  perform pg_temp.give(a2, 'tool_sickle', 1);
  -- the sixth rice part: the answer lists the rat as fled; part 6 pays partKg(6, Y) with Mrat in Y
  perform public._farm_do_rent(room, a2, 6, t - interval '1 hour');
  perform pg_temp.rice(room, 6, a2, 'short', t - interval '44 hours');
  update public.crops set harvested_parts = 5, harvested_kg = 70 where room_id = room and plot_no = 6;
  r6 := pg_temp.rat(room, 6, t - interval '30 minutes');
  perform public._farm_do_begin_work(room, a2, 6, 'harvest', t);
  y := public._crop_yield(pg_temp.crop(room, 6), public._variety('short'), 1.0, 1.0, t + interval '8 seconds');
  assert (y->>'mrat')::double precision = public._rat_factor(public._hrs(t - interval '30 minutes', t + interval '8 seconds'))
     and (y->>'mrat')::double precision < 1, format('the rat counts in Y: %s', y);
  s := public._farm_do_harvest_part(room, a2, 6, true, t + interval '8 seconds');
  assert (s->'harvest_part'->>'kg')::int = public._part_kg(6, (y->>'kg')::int) and s->'harvest_part'->'done' = 'true',
    format('part 6 of Y %s: %s', y->>'kg', s->'harvest_part');
  x := pg_temp.recent(s, r6);
  assert x->>'how' = 'fled' and (x->>'ended_at')::timestamptz = t + interval '8 seconds' and x->'by' = 'null' and x->'dog' = 'null'
     and not (r6 = any(pg_temp.live(s))), format('fled in the answer: %s', x);
  assert (select ended_at is null from public.field_rats where id = r6), 'the row ends at the next sweep';
  perform public._field_open(room, t + interval '9 seconds');
  assert (select ended_at = t + interval '9 seconds' and how = 'fled' and caught_by is null from public.field_rats where id = r6), 'fled';
  -- a khoai picking
  perform public._farm_do_rent(room, a3, 7, t - interval '1 hour');
  perform pg_temp.upland(room, 7, a3, 'khoai', t - interval '49 hours');
  r7 := pg_temp.rat(room, 7, t - interval '1 hour');
  perform public._farm_do_begin_work(room, a3, 7, 'harvest', t);
  v_kg := (public._up_yield(pg_temp.crop(room, 7), public._upland('khoai'), 1.0, 1, t + interval '2 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a3, 7, 1, t + interval '2 seconds');
  assert (s->'harvest'->>'kg')::int = v_kg and v_kg < (public._up_yield(pg_temp.crop(room, 7), public._upland('khoai'), 1.0, 1, t - interval '1 hour')->>'kg')::int
     and pg_temp.recent(s, r7)->>'how' = 'fled' and not (r7 = any(pg_temp.live(s))), format('a picking: %s kg', v_kg);
  -- abandon
  perform public._farm_do_rent(room, a1, 5, t - interval '1 hour');
  perform pg_temp.rice(room, 5, a1, 'short', t - interval '44 hours');
  r5 := pg_temp.rat(room, 5, t - interval '10 minutes');
  s := public._farm_do_abandon(room, a1, 5, t + interval '10 seconds');
  assert pg_temp.recent(s, r5)->>'how' = 'fled' and not (r5 = any(pg_temp.live(s))), 'abandoned';
  perform public._field_open(room, t + interval '20 seconds');
  assert (select ended_at = t + interval '20 seconds' and how = 'fled' from public.field_rats where id = r5), 'fled at the next sweep';
  -- the answer lists a rat that ended in the last 10 s, then no more
  assert pg_temp.recent(public._field_view(room, a1, t + interval '29.999 seconds'), r5) is not null
     and pg_temp.recent(public._field_view(room, a1, t + interval '30 seconds'), r5) is null, 'recent: 10 s';
  -- the harvester: the answer lists the rat as fled; a sweep 10 s later ends it and closes its entry while the crop stays;
  -- step J at harvester_until counts the rat only up to that close
  update public.field_plots set owner_id = a2, owned_at = t where room_id = room and plot_no = 2;
  perform pg_temp.rice(room, 2, a2, 'short', t - interval '44 hours');
  r2 := pg_temp.rat(room, 2, t - interval '1 hour');
  s := public._farm_do_rent_harvester(room, a2, 2, t + interval '1 minute');
  assert pg_temp.recent(s, r2)->>'how' = 'fled' and not (r2 = any(pg_temp.live(s))), 'the harvester: fled in the answer';
  perform public._field_open(room, t + interval '70 seconds');
  assert (select ended_at = t + interval '70 seconds' from public.field_rats where id = r2)
     and (pg_temp.crop(room, 2)).rat_log->0->>'to' is not null
     and ((pg_temp.crop(room, 2)).rat_log->0->>'to')::timestamptz = t + interval '70 seconds', 'closed at that sweep; the crop stays';
  y := public._crop_yield(pg_temp.crop(room, 2), public._variety('short'), 1.1, 1.0, t + interval '90 seconds');
  assert (y->>'mrat')::double precision = public._rat_factor(public._hrs(t - interval '1 hour', t + interval '70 seconds')),
    format('Y counts the rat up to its close: %s', y);
  w0 := pg_temp.wet(a2);
  perform public._field_open(room, t + interval '91 seconds');
  assert pg_temp.wet(a2) = w0 + (y->>'kg')::int and pg_temp.crop(room, 2) is null, 'step J pays that Y';
  -- the purge: an hour after it ended
  perform public._field_open(room, t + interval '1 hour 20 seconds');
  assert exists (select 1 from public.field_rats where id = r5), 'kept for an hour';
  perform public._field_open(room, t + interval '1 hour 21 seconds');
  assert not exists (select 1 from public.field_rats where id = r5), 'purged after an hour';
  -- a lease end (step 1, then step 4) makes R1 flee the rat in the same sweep
  perform pg_temp.rice(room, 5, a1, 'short', t + interval '50 hours');
  r5b := pg_temp.rat(room, 5, t + interval '94 hours');
  perform public._field_open(room, t + interval '94 hours 1 minute');
  assert (select ended_at is null from public.field_rats where id = r5b), 'eating while the lease runs';
  perform public._field_open(room, t + interval '95 hours');
  assert (select ended_at = t + interval '95 hours' and how = 'fled' from public.field_rats where id = r5b)
     and pg_temp.crop(room, 5) is null, 'the lease ended: the crop is lost and the rat flees';
  -- fallen rice (step 6) too
  update public.field_plots set owner_id = a1, owned_at = t where room_id = room and plot_no = 1;
  perform pg_temp.rice(room, 1, a1, 'short', t);
  r1 := pg_temp.rat(room, 1, t + interval '100 hours');
  perform public._field_open(room, t + interval '104 hours');
  assert (select ended_at = t + interval '104 hours' and how = 'fled' from public.field_rats where id = r1)
     and pg_temp.crop(room, 1) is null, 'fallen rice: the rat flees';
end $$;

-- The catch (§5.6): room-bound, first valid catch wins, priced at floor(150 × M) with M from the room's index at the
-- catch, the entry closes and the bag gets it. The field shows the price a catch would fetch, and never writes the index.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; room2 uuid := (select v from smoke where k = 'room2')::uuid;
        t timestamptz := (select v from smoke where k = 't_room')::timestamptz; ids bigint[]; s jsonb; x jsonb; b0 integer;
begin
  select array_agg(id order by id) into ids from public.field_rats where room_id = room and ended_at is null;
  assert cardinality(ids) = 3, 'three live rats';
  -- a new period: the field shows the preview and writes no index row
  delete from public.fish_price_index where room_id = room;
  s := public._field_view(room, a2, t);
  assert (s->'rats'->>'price')::int = public._critter_price(150, public._fish_mult(public._room_wealth(room, t)))
     and not exists (select 1 from public.fish_price_index where room_id = room), 'the preview, no write';
  assert s->'rats'->'next_at' = to_jsonb(public._rat_t(room, public._rat_k(room, t) + 1))
     and (s->'rats'->>'next_at')::timestamptz > t, 'next_at: the next candidate';
  assert pg_temp.live(s) = ids and s->'rats'->'recent' = '[]'
     and s->'rats'->'live'->0 = (select jsonb_build_object('id', id, 'plot', plot_no, 'since', spawned_at, 'seed', seed)
                                   from public.field_rats where id = ids[1]), format('live %s', s->'rats'->'live');
  assert s->'rats'->'plots'->'5' = (pg_temp.crop(room, 5)).rat_log and s->'rats'->'plots'->'6' is null, 'the logs by plot';
  -- the catch writes the period's row: M 2.24 → 336
  perform pg_temp.set_mult(room, 2.24, t);
  perform public._wallet_lock(a2);
  assert public._rat_catch(room, a2, ids[1], 'sling', t) = 336, 'floor(150 × 2.24)';
  assert (select how = 'sling' and caught_by = a2 and price = 336 and ended_at = t from public.field_rats where id = ids[1])
     and exists (select 1 from jsonb_array_elements((pg_temp.crop(room, 5)).rat_log) e
                  where (e->>'r')::bigint = ids[1] and (e->>'to')::timestamptz = t)
     and exists (select 1 from public.rat_bag where account_id = a2 and price = 336 and caught_at = t and how = 'sling'),
    'ended, closed, bagged';
  -- first valid catch wins; bound to its room
  assert pg_temp.err(format('select public._rat_catch(%L, %L, %s, %L, %L)', room, a3, ids[1], 'dog', t)) = 'rat gone', 'caught already';
  assert pg_temp.err(format('select public._rat_catch(%L, %L, %s, %L, %L)', room2, a3, ids[2], 'sling', t)) = 'rat gone', 'another room';
  assert pg_temp.err(format('select public._rat_catch(%L, %L, null, %L, %L)', room, a3, 'sling', t)) = 'rat gone', 'no rat';
  -- M 1.13 → 169 (a rounding would give 170)
  update public.fish_price_index set mult = 1.13 where room_id = room;
  assert public._rat_catch(room, a2, ids[2], 'sling', t + interval '1 second') = 169, 'floor(150 × 1.13)';
  -- the answer's recent list, and what the bag holds
  s := public._field_view(room, a2, t + interval '2 seconds');
  x := pg_temp.recent(s, ids[1]);
  assert x->>'how' = 'sling' and x->'by' = public._who(a2) and x->'dog' = 'null' and (x->>'ended_at')::timestamptz = t
     and pg_temp.live(s) = array[ids[3]], format('recent %s', s->'rats'->'recent');
  assert public._farm_mine(a2)->'rats' = '{"count": 2, "value": 505}', format('the bag %s', public._farm_mine(a2)->'rats');
  assert public._farm_mine(a3)->'rats' = '{"count": 0, "value": 0}' and public._farm_mine(a3)->'dog' = 'null', 'an empty bag';
end $$;

-- The caps (§5.6, D13): 6 catches in an hourly window, 24 a Vietnam day; rat_daily_cap, soft, once.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t1 timestamptz := (date_trunc('day', now() at time zone 'Asia/Ho_Chi_Minh') + interval '1 hour') at time zone 'Asia/Ho_Chi_Minh';
        ids bigint[]; h integer; i integer; n integer := 0; e jsonb; c jsonb;
begin
  select array_agg(pg_temp.rat(room, 9, t1)) into ids from generate_series(1, 26);
  perform public._wallet_lock(a3);
  c := public._rat_caps_view(a3, t1);
  assert c = '{"day_left": 24, "hour_left": 6, "hour_resets_at": null}', format('full caps %s', c);
  for h in 0 .. 3 loop
    for i in 1 .. 6 loop
      n := n + 1;
      perform public._rat_catch(room, a3, ids[n], 'sling', t1 + make_interval(hours => h, secs => i));
    end loop;
    if h = 0 then
      e := pg_temp.errd(format('select public._rat_catch(%L, %L, %s, %L, %L)', room, a3, ids[25], 'sling', t1 + interval '7 seconds'));
      assert e->>'message' = 'rat limit' and e->>'state' = '53400' and e->>'detail' = '3594', format('the 7th in a window: %s', e);
      c := public._rat_caps_view(a3, t1 + interval '7 seconds');
      assert c = jsonb_build_object('day_left', 18, 'hour_left', 0, 'hour_resets_at', t1 + interval '1 hour 1 second'),
        format('caps after 6: %s', c);
      assert pg_temp.err(format('select public._rat_caps(%L, %L, false)', a3, t1 + interval '8 seconds')) = 'rat limit', 'a check';
    end if;
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = a3 and code = 'rat_daily_cap') = 1
     and (select outcome = 'soft' and rpc = 'sling_shoot' and room_id = room
                 and detail = jsonb_build_object('day', (t1 at time zone 'Asia/Ho_Chi_Minh')::date, 'count', 24)
            from public.anticheat_events where account_id = a3 and code = 'rat_daily_cap'), 'rat_daily_cap, soft, once';
  e := pg_temp.errd(format('select public._rat_catch(%L, %L, %s, %L, %L)', room, a3, ids[25], 'dog', t1 + interval '4 hours 1 second'));
  assert e->>'message' = 'rat daily limit' and e->>'state' = '53400' and e->>'detail' = '68399', format('the 25th of a day: %s', e);
  assert public._rat_caps_view(a3, t1 + interval '4 hours 1 second') = '{"day_left": 0, "hour_left": 6, "hour_resets_at": null}',
    'the day is used up';
  assert (select count(*) from public.rat_bag where account_id = a3) = 24
     and (select count(*) from public.anticheat_events where account_id = a3 and code = 'rat_daily_cap') = 1, 'nothing more';
  -- the next Vietnam day
  assert public._rat_catch(room, a3, ids[25], 'dog', t1 + interval '23 hours') > 0, 'a new day';
end $$;

select 'v17 field smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected: every earlier smoke's `ok` rows (their rooms keep their clocks parked), `v17 model smoke ok` in the log, then `FAILED: tests/sql/v17-smoke.sql` with `ERROR:  the first sweep sets the clock` — `_field_open` does not run a rat sweep yet.

- [ ] **Step 3: Write section D**

**supabase/migrations/0019_v17_rats.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- D. The field (§5.3, §5.6, §10.3, §10.5) ----------
-- The rats' lazy clock (§5.3), run by _field_open after _field_sweep, under the room's plot locks. It locks rat and crop
-- rows only, never the fish price index (v15.3 R12). R1: a live rat whose crop no longer carries its entry, or is no
-- longer rat food, flees, and its entry closes. R2: rats ended more than an hour ago go. R3: each candidate k after the
-- room's last_k and inside the last 30 minutes spawns a rat on a food plot while fewer than 3 are alive; a rat found late
-- keeps spawned_at = t(k) (its path) but eats only from this sweep (D3). A far-future last_k switches the room's rats off.
create or replace function public._rat_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.field_rats; c public.crops; v_found boolean; v_last bigint; v_hi bigint; v_k bigint; v_t timestamptz;
        v_plots integer[]; v_plot integer; v_id bigint;
begin
  -- R1. flee
  for r in select fr.* from public.field_rats fr where fr.room_id = p_room and fr.ended_at is null order by fr.id for update loop
    select * into c from public.crops cr
     where cr.room_id = p_room and cr.plot_no = r.plot_no and cr.rat_log @> jsonb_build_array(jsonb_build_object('r', r.id))
       for update;
    v_found := found;
    if not v_found or not public._rat_food(c, p_now) then
      update public.field_rats set ended_at = p_now, how = 'fled' where id = r.id;
      if v_found then
        update public.crops set rat_log = public._rat_close(rat_log, r.id, p_now) where room_id = p_room and plot_no = r.plot_no;
      end if;
    end if;
  end loop;
  -- R2. purge
  delete from public.field_rats where room_id = p_room and ended_at < p_now - interval '1 hour';
  -- R3. spawn: k(p_now − 1 800 s) < k ≤ k(p_now), and k > last_k
  select last_k into v_last from public.rat_clocks where room_id = p_room for update;
  v_hi := public._rat_k(p_room, p_now);
  v_k := greatest(public._rat_k(p_room, p_now - interval '1800 seconds'), coalesce(v_last, -1)) + 1;
  while v_k <= v_hi loop
    v_t := public._rat_t(p_room, v_k);
    if (select count(*) from public.field_rats fr
         where fr.room_id = p_room and fr.spawned_at <= v_t and (fr.ended_at is null or fr.ended_at > v_t)) < 3 then
      select array_agg(cr.plot_no::integer order by cr.plot_no) into v_plots from public.crops cr
       where cr.room_id = p_room and public._rat_food(cr, v_t) and jsonb_array_length(cr.rat_log) < 20;
      if v_plots is not null then
        v_plot := v_plots[1 + floor(public._rat_u(p_room, v_k, 'p') * cardinality(v_plots))::integer];
        insert into public.field_rats (room_id, plot_no, k, seed, spawned_at)
        values (p_room, v_plot, v_k, floor(public._rat_u(p_room, v_k, 's') * 2147483647)::integer, v_t)
        on conflict (room_id, k) do nothing
        returning id into v_id;
        if v_id is not null then
          update public.crops
             set rat_log = rat_log || jsonb_build_array(jsonb_build_object('r', v_id, 'from', p_now, 'to', null))
           where room_id = p_room and plot_no = v_plot;
        end if;
      end if;
    end if;
    v_k := v_k + 1;
  end loop;
  insert into public.rat_clocks (room_id, last_k) values (p_room, v_hi)
  on conflict (room_id) do update set last_k = greatest(public.rat_clocks.last_k, excluded.last_k);
end $$;

-- The catch caps (§5.6, D13), on the account's farm profile (created if missing, locked): 6 catches in an hourly window
-- (it starts at the first catch after the last one ended) and 24 a Vietnam day. At the cap it raises 'rat limit' or 'rat
-- daily limit' (53400, details = the seconds until the window or the day ends); with p_take it counts the catch, and the
-- catch that makes the day's 24 logs the soft rat_daily_cap once.
create or replace function public._rat_caps(p_account uuid, p_now timestamptz, p_take boolean, p_how text default null,
                                            p_room uuid default null) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare pr public.farm_profiles; v_day date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date; v_open boolean;
        v_win integer; v_n integer;
begin
  insert into public.farm_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into pr from public.farm_profiles where account_id = p_account for update;
  v_open := pr.rat_win_start is not null and p_now < pr.rat_win_start + interval '1 hour';
  v_win := case when v_open then pr.rat_win_count else 0 end;
  v_n := case when pr.rat_day_on = v_day then pr.rat_day_count else 0 end;
  if v_win >= 6 then
    raise exception 'rat limit' using errcode = '53400',
      detail = ceil(extract(epoch from (pr.rat_win_start + interval '1 hour' - p_now)))::int::text;
  end if;
  if v_n >= 24 then
    raise exception 'rat daily limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - p_now)))::int::text;
  end if;
  if p_take then
    update public.farm_profiles
       set rat_win_start = case when v_open then rat_win_start else p_now end, rat_win_count = v_win + 1,
           rat_day_on = v_day, rat_day_count = v_n + 1
     where account_id = p_account;
    if v_n + 1 = 24 then
      perform public._ac_flag(p_account, 'rat_daily_cap', case when p_how = 'dog' then 'dog_hunt' else 'sling_shoot' end,
                              jsonb_build_object('day', v_day, 'count', 24), p_room, null, false);
    end if;
  end if;
end $$;

-- What the caps leave at p_now (§10.5 mine.rat_caps): a read, no lock.
create or replace function public._rat_caps_view(p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'hour_left', case when x.open then greatest(0, 6 - x.win) else 6 end,
    'hour_resets_at', case when x.open then x.win_start + interval '1 hour' end,
    'day_left', case when x.day_on = (p_now at time zone 'Asia/Ho_Chi_Minh')::date then greatest(0, 24 - x.day_n) else 24 end)
    from (select coalesce(pr.rat_win_start is not null and p_now < pr.rat_win_start + interval '1 hour', false) as open,
                 pr.rat_win_count as win, pr.rat_win_start as win_start, pr.rat_day_on as day_on, pr.rat_day_count as day_n
            from (select 1) one left join public.farm_profiles pr on pr.account_id = p_account) x
$$;

-- A catch (§5.6), after the caller's wallet lock: the rat (bound to the room; missing or ended is 'rat gone'), the crop
-- that carries its entry, the caps (counted), then the price floor(150 × M) with M from the room's index at the catch —
-- that row is the last lock taken — and the rat ends, its entry closes and the bag gets it. Returns the price.
create or replace function public._rat_catch(p_room uuid, p_account uuid, p_rat bigint, p_how text, p_now timestamptz)
returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare r public.field_rats; v_price integer;
begin
  select * into r from public.field_rats where id = p_rat and room_id = p_room for update;
  if not found or r.ended_at is not null then
    raise exception 'rat gone' using errcode = '22023';
  end if;
  perform 1 from public.crops
   where room_id = p_room and plot_no = r.plot_no and rat_log @> jsonb_build_array(jsonb_build_object('r', r.id)) for update;
  perform public._rat_caps(p_account, p_now, true, p_how, p_room);
  v_price := public._critter_price(150, (public._fish_index(p_room, p_now)).mult);
  update public.field_rats set ended_at = p_now, how = p_how, caught_by = p_account, price = v_price where id = r.id;
  update public.crops set rat_log = public._rat_close(rat_log, r.id, p_now)
   where room_id = p_room and plot_no = r.plot_no and rat_log @> jsonb_build_array(jsonb_build_object('r', r.id));
  insert into public.rat_bag (account_id, price, caught_at, how) values (p_account, v_price, p_now, p_how);
  return v_price;
end $$;

-- The account's dog (§10.3), or null.
create or replace function public._dog_view(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('name', d.name, 'coat', d.coat, 'adopted_at', d.adopted_at, 'fed_until', d.fed_until,
                            'next_hunt_at', d.next_hunt_at, 'catches', d.catches)
    from public.dogs d where d.account_id = p_account
$$;

-- The field's rats (§10.5), a read that never writes: when the next candidate is due, the price a catch would fetch now
-- (_critter_prices: the period's snapshot or its preview), the live rats, the rats that ended in the last 10 s, and the
-- non-empty rat logs by plot. It judges each live rat itself: one whose crop entry is gone, or whose crop is no longer
-- food at p_now, is listed as fled even before a sweep ends it.
create or replace function public._rats_view(p_room uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  with r as (
    select fr.id, fr.plot_no, fr.seed, fr.spawned_at, fr.ended_at, fr.how, fr.caught_by,
           fr.ended_at is null and not exists (select 1 from public.crops cr
                                                where cr.room_id = p_room and cr.plot_no = fr.plot_no
                                                  and cr.rat_log @> jsonb_build_array(jsonb_build_object('r', fr.id))
                                                  and public._rat_food(cr, p_now)) as gone
      from public.field_rats fr
     where fr.room_id = p_room and (fr.ended_at is null or fr.ended_at > p_now - interval '10 seconds')
  )
  select jsonb_build_object(
    'next_at', public._rat_t(p_room, public._rat_k(p_room, p_now) + 1),
    'price', public._critter_price(150, (public._critter_prices(p_room, p_now)->>'mult')::numeric),
    'live', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'plot', r.plot_no, 'since', r.spawned_at, 'seed', r.seed)
                                       order by r.id)
                        from r where r.ended_at is null and not r.gone), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
                                 'id', r.id, 'plot', r.plot_no, 'since', r.spawned_at, 'seed', r.seed,
                                 'ended_at', coalesce(r.ended_at, p_now), 'how', coalesce(r.how, 'fled'),
                                 'by', public._who(r.caught_by),
                                 'dog', case when r.how = 'dog' then (select d.name from public.dogs d where d.account_id = r.caught_by) end)
                               order by coalesce(r.ended_at, p_now), r.id)
                          from r where r.ended_at is not null or r.gone), '[]'::jsonb),
    'plots', coalesce((select jsonb_object_agg(cr.plot_no::text, cr.rat_log order by cr.plot_no) from public.crops cr
                        where cr.room_id = p_room and jsonb_array_length(cr.rat_log) > 0), '{}'::jsonb))
$$;

-- Every field call starts here (0013's body): create the plots if needed, lock them (one field call per room at a time
-- — before any wallet lock, so a sale that pays the other party cannot deadlock with that party's own field call),
-- sweep; v17: then the rats' sweep (D28).
create or replace function public._field_open(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_init(p_room);
  perform 1 from public.field_plots where room_id = p_room order by plot_no for update;
  perform public._field_sweep(p_room, p_now);
  perform public._rat_sweep(p_room, p_now);                                         -- v17
end; $$;
-- The account's farm belongings (0018's body): v17 adds the kinds ammo and pet_food to the items, the rats in the bag
-- (count and what cô Út pays), what the catch caps leave and the dog (§10.5). Like the gathering part, the caps are read
-- on now().
create or replace function public._farm_mine(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty order by i.item_id)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food')), '{}'::jsonb),
    'rice', coalesce((select jsonb_object_agg(rs.variety, jsonb_build_object('wet', rs.wet_kg, 'dry', rs.dry_kg) order by rs.variety)
                        from public.rice_stock rs where rs.account_id = p_account and (rs.wet_kg > 0 or rs.dry_kg > 0)),
                     '{}'::jsonb),
    'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0),
    'gift_claimed', exists (select 1 from public.farm_profiles pr where pr.account_id = p_account and pr.gift_at is not null),
    'produce', coalesce((select jsonb_object_agg(ps.upland, ps.kg order by ps.upland)
                           from public.produce_stock ps where ps.account_id = p_account and ps.kg > 0), '{}'::jsonb),
    'tank', case when public._owns(p_account, 'tool_sprayer')
                 then coalesce((select jsonb_build_object('item', pr.tank_item, 'charges', pr.tank_charges)
                                  from public.farm_profiles pr where pr.account_id = p_account),
                               jsonb_build_object('item', null, 'charges', 0)) end,
    'critters', coalesce((select jsonb_object_agg(k.kind, jsonb_build_object('n', k.n, 'xu', k.xu) order by k.kind)
                            from (select cr.kind, count(*)::int as n, sum(cr.price)::int as xu
                                    from public.critters cr where cr.account_id = p_account group by cr.kind) k), '{}'::jsonb),
    'critter_cap', public._critter_cap(p_account),
    'gather', (select jsonb_build_object(
                 'ready_at', coalesce((select jsonb_object_agg(g.spot, g.ready_at order by g.spot) from public.gather_cooldowns g
                                        where g.account_id = p_account and g.ready_at > now()), '{}'::jsonb),
                 'left_today', d.left_today,
                 'day_resets_at', case when d.left_today = 0
                                       then (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end)
                 from (select coalesce((select case when pr.gather_on = public._vn_today() then greatest(0, 200 - pr.gather_count)
                                                    else 200 end
                                          from public.farm_profiles pr where pr.account_id = p_account), 200) as left_today) d),
    -- v17: the rats in the bag, the caps and the dog
    'rats', (select jsonb_build_object('count', count(*)::int, 'value', coalesce(sum(b.price), 0)::int)
               from public.rat_bag b where b.account_id = p_account),
    'rat_caps', public._rat_caps_view(p_account, now()),
    'dog', public._dog_view(p_account))
$$;

-- The whole field_state answer (0018's body); v17: plus the field's rats (§10.5, D28).
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
                                   where lo.room_id = p_room and fp.owner_id = p_viewer), '[]'::jsonb)),
    'critter_prices', public._critter_prices(p_room, p_now),
    'rats', public._rats_view(p_room, p_now))                                        -- v17
$$;

revoke all on function public._rat_sweep(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_caps(uuid, timestamptz, boolean, text, uuid) from public, anon, authenticated;
revoke all on function public._rat_caps_view(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_catch(uuid, uuid, bigint, text, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_view(uuid) from public, anon, authenticated;
revoke all on function public._rats_view(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._field_open(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
revoke all on function public._field_view(uuid, uuid, timestamptz) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected:

```text
v14 smoke ok
0019 twice ok
lyrics lockdown smoke ok
v15 crop smoke ok
v15 land smoke ok
v15 farm smoke ok
v15 fish price smoke ok
v15 upgrade reset smoke ok
anticheat names and queue smoke ok
anticheat flow smoke ok
anticheat fishing smoke ok
anticheat farm smoke ok
anticheat shared functions smoke ok
anticheat admin smoke ok
anticheat guards ok
v15.2 model smoke ok
v15.2 field smoke ok
v15.2 harvest smoke ok
v15.2 tools smoke ok
v15.2 beds smoke ok
anticheat guards ok
v16 rules smoke ok
v16 cao and poker rules smoke ok
v16 tables smoke ok
v16 tienlen smoke ok
v16 cao smoke ok
v16 poker smoke ok
v16 holdings and deletions smoke ok
anticheat guards ok
v15.3 model smoke ok
v15.3 gathering smoke ok
v15.3 farm smoke ok
v15.3 wipe smoke ok
anticheat guards ok
v17 model smoke ok
v17 field smoke ok
anticheat guards ok
v17 model smoke ok
v17 field smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v17): 0019 field — rats spawn, eat, flee and are caught

Section D of 0019_v17_rats.sql: _rat_sweep, the rats' lazy clock that _field_open now
runs after _field_sweep (flee, purge, then the spawn candidates of the last 30 minutes
after the room's last_k, at most 3 alive and 20 a crop); _rat_caps (6 catches an hour,
24 a Vietnam day, the soft rat_daily_cap) and _rat_caps_view; _rat_catch (room-bound,
priced at floor(150 × M) from the room's index at the catch, after the caller's wallet);
_dog_view and _rats_view (next_at, the price shown, live, recent and the logs by plot,
judging each live rat itself); and _farm_mine and _field_view re-created from 0018 with
the new kinds, the rat bag, the caps, the dog and the field's rats. The v15, anti-cheat,
v15.2 and gather smokes turn the rats off in their rooms with pg_temp.no_rats.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0019_v17_rats.sql tests/sql/anticheat-smoke.sql tests/sql/v15-2-smoke.sql tests/sql/v15-gather-smoke.sql tests/sql/v15-smoke.sql tests/sql/v17-smoke.sql
git commit -F <message file>
```

---

### Task 3: Database — the ná, the dog, the rat sale and the new items (`0019` section E)

**Files:**
- Modify: `supabase/migrations/0019_v17_rats.sql`
- Test: `tests/sql/anticheat-guards.sql`, `tests/sql/v17-smoke.sql` (modify)

**Interfaces:**
- Consumes: Tasks 1–2 (`_pet_name`, `_rat_catch`, `_rat_caps`, `_dog_view`, `_field_view`, `_farm_mine`); from `0015`: `_ac_account(token, rpc)`, `_ac_play(room, token, rpc)` and the guard file's dynamic loop and allowlist (by signature); `buy_farm_item`'s latest body (`0018`).
- Produces (§6.1, §7.1, §7.2, §10.4; each public RPC is a guarded wrapper around a private twin that takes `p_now`):
  - `sling_start(p_room_id, p_session_token, p_rat_id)` → the field view and `aim {rat, started_at}`: `no sling`, `no pellets`, `rat gone`, `rat limit`, `rat daily limit`;
  - `sling_shoot(p_room_id, p_session_token, p_rat_id, p_hit)` → the field view and `shot {hit, price, pellets}`: `no aim`, `rat gone`, `too fast` (under 2 s after the aim or the last shot), `aim expired` (over 60 s), `no pellets`; a miss uses a pellet, a refused hit none (D15);
  - `dog_hunt(p_room_id, p_session_token, p_rat_id)` → the field view and `dog_hunt {price}`: `no dog`, `dog hungry`, `dog resting` (the seconds), then the catch's refusals; 5 minutes' rest and `catches + 1`;
  - `adopt_dog(p_session_token, p_name, p_coat)`, `rename_dog(p_session_token, p_name)`, `feed_dog(p_session_token)` → `{server_now, dog, food, coins}`: `invalid name`, `invalid coat`, `already own dog`, `not enough coins` (20 000, `dog_adopt`, fed 24 h); `no dog`; `dog full` above 12 h, `no item` (`_use_item`), then `fed_until = greatest(fed_until, now) + 24 h`;
  - `sell_rats(p_session_token)` → the account part and `sold {count, xu}` (`rat_sell`; `nothing to sell`); `dog_state(p_session_token)` (read-only, allowlisted);
  - `buy_farm_item` re-created from `0018`: it sells the pellets and the dog food (99 held at most), and its soft `kind_mismatch` allows `ammo` and `pet_food`;
  - the guard file's loop gains the 7 RPCs (59 calls) and its allowlist `dog_state(text)`.

- The smoke's RPC part prints `v17 rpc smoke ok`.

- [ ] **Step 1: Write the guard calls and the smoke's RPC part**

**tests/sql/anticheat-guards.sql — edit 1 of 4.** Replace:

```sql
     'card_lobby(uuid,text)', 'card_state(uuid,text,text)', 'card_hand(uuid,text,text)', 'card_tick(uuid,text,text)',
     'card_leave(uuid,text,text)')
$$;
```

with:

```sql
     'card_lobby(uuid,text)', 'card_state(uuid,text,text)', 'card_hand(uuid,text,text)', 'card_tick(uuid,text,text)',
     'card_leave(uuid,text,text)', 'dog_state(text)')
$$;
```

**tests/sql/anticheat-guards.sql — edit 2 of 4.** Replace:

```sql
    format('select public.pick_snail_bed(%L, %L, 1)', room, t),
    format('select public.sell_critters(%L, null)', t)] loop
    n := n + 1;
```

with:

```sql
    format('select public.pick_snail_bed(%L, %L, 1)', room, t),
    format('select public.sell_critters(%L, null)', t),
    -- v17 (0019)
    format('select public.sling_start(%L, %L, 1)', room, t),
    format('select public.sling_shoot(%L, %L, 1, true)', room, t),
    format('select public.dog_hunt(%L, %L, 1)', room, t),
    format('select public.adopt_dog(%L, %L, %L)', t, 'Ki', 'vang'),
    format('select public.rename_dog(%L, %L)', t, 'Ki'),
    format('select public.feed_dog(%L)', t),
    format('select public.sell_rats(%L)', t)] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 3 of 4.** Replace:

```sql
  end loop;
  assert n = 52, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 59, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

**tests/sql/anticheat-guards.sql — edit 4 of 4.** Replace:

```sql
  perform public.card_tick(room, t, 'tienlen');
end $$;
```

with:

```sql
  perform public.card_tick(room, t, 'tienlen');
  perform public.dog_state(t);
end $$;
```

**tests/sql/v17-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- the RPCs: the slingshot, the dog, the sale and anh Hai's items (§6.1, §7.1, §7.2, §8, §10.4, §10.7) ----------
insert into smoke select 'room4', room_id::text from public.create_room('Bắn ná', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room4')::uuid), 'pw', v)
  from smoke where k in ('t2', 't3');
insert into smoke select 't4', token from public.register('rat_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a4', public._auth_account(v)::text from smoke where k = 't4';

-- The slingshot (§6.1, D14–D16): the refusals in their order, the 2 s and 60 s bounds, misses, hits and their prices,
-- and two hunters on one rat. Room 4's clock is off: its rats are placed by hand on a1's ripe plot.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room4')::uuid;
        room2 uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        ra bigint; rb bigint; rc bigint; rd bigint; s jsonb; m numeric;
begin
  perform public._field_open(room, t - interval '1 hour');
  update public.rat_clocks set last_k = 9000000000000000000 where room_id = room;
  perform pg_temp.set_coins(a1, 100000);
  perform public._farm_do_rent(room, a1, 5, t - interval '1 hour');
  perform pg_temp.rice(room, 5, a1, 'short', t - interval '44 hours');
  ra := pg_temp.rat(room, 5, t - interval '5 minutes');
  rb := pg_temp.rat(room, 5, t - interval '5 minutes');
  rc := pg_temp.rat(room, 5, t - interval '5 minutes');
  -- the aim: no sling, no pellets, rat gone, in that order
  delete from public.inventory where account_id = a2 and item_id in ('tool_sling', 'ammo_pellet');
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, 0, %L)', room, a2, t)) = 'no sling', 'no sling';
  perform pg_temp.give(a2, 'tool_sling', 1);
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, 0, %L)', room, a2, t)) = 'no pellets', 'no pellets';
  perform pg_temp.give(a2, 'ammo_pellet', 5);
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, 0, %L)', room, a2, t)) = 'rat gone', 'no such rat';
  assert pg_temp.err(format('select public._rat_do_sling_start(%L, %L, null, %L)', room, a2, t)) = 'rat gone', 'a null rat';
  s := public._rat_do_sling_start(room, a2, ra, t);
  assert s->'aim' = jsonb_build_object('rat', ra, 'started_at', t) and s->'rats'->'live' is not null
     and (select room_id = room and rat_id = ra and started_at = t and last_shot_at is null and shots = 0
            from public.sling_aims where account_id = a2), format('the aim %s', s->'aim');
  -- 2 s after the aim, then after each shot; a miss (or a null hit) uses a pellet
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room, a2, ra, t + interval '1.9 seconds'))
         = 'too fast', '1.9 s';
  s := public._rat_do_sling_shoot(room, a2, ra, false, t + interval '2 seconds');
  assert s->'shot' = '{"hit": false, "price": null, "pellets": 4}' and pg_temp.qty(a2, 'ammo_pellet') = 4
     and (select last_shot_at = t + interval '2 seconds' and shots = 1 from public.sling_aims where account_id = a2),
    format('a miss at 2.0 s: %s', s->'shot');
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, true, %L)', room, a2, ra, t + interval '3.9 seconds'))
         = 'too fast', 'from the previous shot';
  s := public._rat_do_sling_shoot(room, a2, ra, null, t + interval '4 seconds');
  assert s->'shot' = '{"hit": false, "price": null, "pellets": 3}'
     and not exists (select 1 from public.anticheat_events where account_id = a2 and rpc = 'sling_shoot'), 'null is a miss, unflagged';
  -- 60 s is the bound; another rat or another room has no aim
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room, a2, ra, t + interval '65 seconds'))
         = 'aim expired', '61 s idle';
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room, a2, rb, t + interval '6 seconds'))
         = 'no aim', 'another rat';
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, false, %L)', room2, a2, ra, t + interval '6 seconds'))
         = 'no aim', 'another room';
  assert pg_temp.qty(a2, 'ammo_pellet') = 3, 'refusals use no pellet';
  -- a hit in a new period: the price of the preview, and the catch writes the row
  delete from public.fish_price_index where room_id = room;
  m := public._fish_mult(public._room_wealth(room, t + interval '6 seconds'));
  s := public._rat_do_sling_shoot(room, a2, ra, true, t + interval '6 seconds');
  assert s->'shot' = jsonb_build_object('hit', true, 'price', public._critter_price(150, m), 'pellets', 2)
     and (select mult = m from public.fish_price_index where room_id = room), format('a hit at M %s: %s', m, s->'shot');
  assert (select how = 'sling' and caught_by = a2 and ended_at = t + interval '6 seconds' from public.field_rats where id = ra)
     and not exists (select 1 from public.sling_aims where account_id = a2)
     and exists (select 1 from public.rat_bag where account_id = a2 and caught_at = t + interval '6 seconds')
     and s->'rats'->'recent'->0->>'how' = 'sling' and s->'rats'->'recent'->0->'by' = public._who(a2), 'caught, aim gone, bagged';
  -- M 2.24 → 336; and two hunters on one rat: the first valid hit wins
  perform pg_temp.set_mult(room, 2.24, t);
  -- a3 used up a day's catches above, on another Vietnam day: a clean slate
  update public.farm_profiles set rat_win_start = null, rat_win_count = 0, rat_day_on = null, rat_day_count = 0
   where account_id = a3;
  perform pg_temp.give(a3, 'tool_sling', 1);
  perform pg_temp.give(a3, 'ammo_pellet', 10);
  perform public._rat_do_sling_start(room, a2, rb, t + interval '7 seconds');
  perform public._rat_do_sling_start(room, a3, rb, t + interval '7 seconds');
  s := public._rat_do_sling_shoot(room, a3, rb, true, t + interval '10 seconds');
  assert (s->'shot'->>'price')::int = 336, 'floor(150 × 2.24)';
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, true, %L)', room, a2, rb, t + interval '10 seconds'))
         = 'rat gone', 'the second hunter';
  assert pg_temp.qty(a2, 'ammo_pellet') = 2 and exists (select 1 from public.sling_aims where account_id = a2 and rat_id = rb),
    'a refused hit uses no pellet';
  -- M 1.13 → 169 (a rounding would give 170)
  update public.fish_price_index set mult = 1.13 where room_id = room;
  perform public._rat_do_sling_start(room, a2, rc, t + interval '11 seconds');
  s := public._rat_do_sling_shoot(room, a2, rc, true, t + interval '14 seconds');
  assert s->'shot' = '{"hit": true, "price": 169, "pellets": 1}', format('floor(150 × 1.13): %s', s->'shot');
  -- the last pellet
  rd := pg_temp.rat(room, 5, t + interval '15 seconds');
  perform public._rat_do_sling_start(room, a2, rd, t + interval '15 seconds');
  perform public._rat_do_sling_shoot(room, a2, rd, false, t + interval '17 seconds');
  assert pg_temp.err(format('select public._rat_do_sling_shoot(%L, %L, %s, true, %L)', room, a2, rd, t + interval '19 seconds'))
         = 'no pellets', 'out of pellets';
  insert into smoke values ('rd', rd::text);
end $$;

-- The dog (§7.1, §7.2): adoption and its refusals, food, the pounce, its rest, and a new name.
do $$
declare t3 text := (select v from smoke where k = 't3'); a3 uuid := (select v from smoke where k = 'a3')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room4')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; rd bigint := (select v from smoke where k = 'rd')::bigint;
        s jsonb; re bigint; x jsonb;
begin
  delete from public.dogs where account_id = a3;
  perform pg_temp.set_coins(a3, 19999);
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'M', 'x')) = 'invalid name', '1 character, before the coat';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Mười bảy ký tự nè', 'muc')) = 'invalid name', '17 characters';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Ao cá', 'muc')) = 'invalid name', 'Ao cá';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, U&'\200B\200B', 'muc')) = 'invalid name', 'zero-width';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Mực', 'x')) = 'invalid coat', 'coat x';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, null)', t3, 'Mực')) = 'invalid coat', 'no coat';
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Mực', 'muc')) = 'not enough coins', '19 999 xu';
  perform pg_temp.set_coins(a3, 20000);
  s := public.adopt_dog(t3, '  Mực ', 'muc');
  assert s->'dog' = jsonb_build_object('name', 'Mực', 'coat', 'muc', 'adopted_at', s->'server_now',
                                       'fed_until', (s->>'server_now')::timestamptz + interval '24 hours', 'next_hunt_at', null,
                                       'catches', 0)
     and s->'food' = '0' and s->'coins' = '0', format('adopted, fed for 24 h: %s', s);
  assert exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'dog_adopt' and delta = -20000
                  and balance = 0 and ref = 'dog muc'), 'the dog_adopt row';
  perform pg_temp.set_coins(a3, 50000);
  assert pg_temp.err(format('select public.adopt_dog(%L, %L, %L)', t3, 'Ki', 'vang')) = 'already own dog', 'one a person';
  assert public.dog_state(t3)->'dog'->>'name' = 'Mực' and public.dog_state(t3)->'coins' = '50000', 'dog_state';
  -- food: refused above 12 h; 24 h from max(now, fed_until); no food
  update public.dogs set fed_until = t + interval '12 hours 1 second' where account_id = a3;
  perform pg_temp.give(a3, 'food_dog', 2);
  assert pg_temp.err(format('select public._dog_do_feed(%L, %L)', a3, t)) = 'dog full', 'more than 12 h left';
  update public.dogs set fed_until = t + interval '11 hours' where account_id = a3;
  s := public._dog_do_feed(a3, t);
  assert (s->'dog'->>'fed_until')::timestamptz = t + interval '35 hours' and s->'food' = '1', 'from fed_until';
  update public.dogs set fed_until = t - interval '5 hours' where account_id = a3;
  s := public._dog_do_feed(a3, t);
  assert (s->'dog'->>'fed_until')::timestamptz = t + interval '24 hours' and s->'food' = '0', 'from now';
  update public.dogs set fed_until = t - interval '1 hour' where account_id = a3;
  assert pg_temp.err(format('select public._dog_do_feed(%L, %L)', a3, t)) = 'no item', 'no food';
  assert pg_temp.err(format('select public._dog_do_feed(%L, %L)', a1, t)) = 'no dog', 'no dog to feed';
  -- the pounce: hungry, then fed; a catch rests it 5 minutes (details = seconds)
  assert pg_temp.err(format('select public._dog_do_hunt(%L, %L, %s, %L)', room, a3, rd, t + interval '20 seconds')) = 'dog hungry', 'hungry';
  assert pg_temp.err(format('select public._dog_do_hunt(%L, %L, %s, %L)', room, a1, rd, t + interval '20 seconds')) = 'no dog', 'no dog';
  update public.dogs set fed_until = t + interval '20 hours' where account_id = a3;
  s := public._dog_do_hunt(room, a3, rd, t + interval '20 seconds');
  assert (s->'dog_hunt'->>'price')::int = 169 and (select how = 'dog' and caught_by = a3 from public.field_rats where id = rd)
     and (select next_hunt_at = t + interval '5 minutes 20 seconds' and catches = 1 from public.dogs where account_id = a3),
    format('the pounce %s', s->'dog_hunt');
  x := pg_temp.recent(s, rd);
  assert x->>'how' = 'dog' and x->>'dog' = 'Mực' and x->'by' = public._who(a3), format('recent %s', x);
  assert s->'mine'->'dog'->'catches' = '1' and s->'mine'->'rats'->'count' is not null, 'mine.dog';
  re := pg_temp.rat(room, 5, t + interval '30 seconds');
  assert pg_temp.errd(format('select public._dog_do_hunt(%L, %L, %s, %L)', room, a3, re, t + interval '1 minute'))
         = '{"message": "dog resting", "detail": "260", "state": "22023"}', 'resting, with the seconds';
  s := public._dog_do_hunt(room, a3, re, t + interval '5 minutes 20 seconds');
  assert (select catches = 2 from public.dogs where account_id = a3), 'rested';
  -- a new name: refused names, no dog, then free
  assert pg_temp.err(format('select public.rename_dog(%L, %L)', t3, 'X')) = 'invalid name', 'rename: 1 character';
  assert pg_temp.err(format('select public.rename_dog(%L, %L)', (select v from smoke where k = 't4'), 'Vện')) = 'no dog',
    'rename: no dog';
  s := public.rename_dog(t3, 'Ki Ki');
  assert s->'dog'->>'name' = 'Ki Ki' and (select coins from public.wallets where account_id = a3) = 50000, 'renamed, free';
  assert public.dog_state((select v from smoke where k = 't4')) = jsonb_build_object('server_now', now(), 'dog', null, 'food', 0,
                                                                                    'coins', 0), 'a fresh account';
end $$;

-- Room binding (§5.6): a live rat of another room, called through this one, is 'rat gone'; nothing changes.
do $$
declare t2 text := (select v from smoke where k = 't2'); t3 text := (select v from smoke where k = 't3');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; room4 uuid := (select v from smoke where k = 'room4')::uuid;
        rb bigint; p0 integer; b0 integer;
begin
  select id into rb from public.field_rats where room_id = room4 and ended_at is null order by id limit 1;
  if rb is null then
    rb := pg_temp.rat(room4, 5, now());
  end if;
  perform pg_temp.give(a2, 'ammo_pellet', 5);
  update public.dogs set fed_until = now() + interval '1 day', next_hunt_at = null where account_id = a3;
  delete from public.sling_aims where account_id = a2;
  p0 := pg_temp.qty(a2, 'ammo_pellet');
  b0 := (select count(*) from public.rat_bag where account_id in (a2, a3));
  assert pg_temp.err(format('select public.sling_start(%L, %L, %s)', room, t2, rb)) = 'rat gone', 'sling_start';
  insert into public.sling_aims (account_id, room_id, rat_id, started_at) values (a2, room, rb, now() - interval '5 seconds');
  assert pg_temp.err(format('select public.sling_shoot(%L, %L, %s, true)', room, t2, rb)) = 'rat gone', 'sling_shoot';
  assert pg_temp.err(format('select public.dog_hunt(%L, %L, %s)', room, t3, rb)) = 'rat gone', 'dog_hunt';
  assert (select ended_at is null from public.field_rats where id = rb) and pg_temp.qty(a2, 'ammo_pellet') = p0
     and (select shots = 0 and last_shot_at is null from public.sling_aims where account_id = a2)
     and (select next_hunt_at is null and catches = 2 from public.dogs where account_id = a3)
     and (select count(*) from public.rat_bag where account_id in (a2, a3)) = b0, 'nothing changed';
  delete from public.sling_aims where account_id = a2;
end $$;

-- cô Út buys the bag at its stored prices (§5.6, D12); anh Hai sells the three items (§8).
do $$
declare t1 text := (select v from smoke where k = 't1'); t2 text := (select v from smoke where k = 't2');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        n integer; xu integer; c0 integer; r jsonb;
begin
  select count(*)::int, sum(price)::int into n, xu from public.rat_bag where account_id = a2;
  assert n >= 3, format('a2 caught %s', n);
  c0 := (select coins from public.wallets where account_id = a2);
  r := public.sell_rats(t2);
  assert r->'sold' = jsonb_build_object('count', n, 'xu', xu) and r->'mine'->'coins' = to_jsonb(c0 + xu)
     and r->'mine'->'rats' = '{"count": 0, "value": 0}'
     and exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'rat_sell' and delta = xu and ref = n || ' con'),
    format('sold %s for %s: %s', n, xu, r->'sold');
  assert pg_temp.err(format('select public.sell_rats(%L)', t2)) = 'nothing to sell', 'an empty bag';
  -- the three items; the ná once, the stacks up to 99
  delete from public.inventory where account_id = a1 and item_id in ('tool_sling', 'ammo_pellet', 'food_dog');
  perform pg_temp.set_coins(a1, 10000);
  r := public.buy_farm_item(t1, 'tool_sling', 1);
  assert r->'mine'->'items'->'tool_sling' = '1' and r->'mine'->'coins' = '7000'
     and exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'farm_buy' and delta = -3000
                  and ref = 'tool_sling x1'), 'the ná for 3 000 xu';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t1, 'tool_sling')) = 'already owned', 'bought once';
  r := public.buy_farm_item(t1, 'ammo_pellet', 10);
  assert r->'mine'->'items'->'ammo_pellet' = '10' and r->'mine'->'coins' = '6900', '10 pellets for 100 xu';
  r := public.buy_farm_item(t1, 'food_dog', 2);
  assert r->'mine'->'items'->'food_dog' = '2' and r->'mine'->'coins' = '6600', 'two bags of food';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 90)', t1, 'ammo_pellet')) = 'invalid quantity', '99 at most';
  r := public.buy_farm_item(t1, 'ammo_pellet', 0);
  assert r->'anticheat'->>'code' = 'bad_qty', 'a quantity outside 1–99 stays hard';
  r := public.buy_farm_item(t1, 'rod_bamboo', 1);
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0', 'no fishing gear here';
  -- public and guarded; the twins private
  assert has_function_privilege('anon', 'public.sling_start(uuid,text,bigint)', 'execute')
     and has_function_privilege('anon', 'public.sling_shoot(uuid,text,bigint,boolean)', 'execute')
     and has_function_privilege('anon', 'public.dog_hunt(uuid,text,bigint)', 'execute')
     and has_function_privilege('anon', 'public.adopt_dog(text,text,text)', 'execute')
     and has_function_privilege('anon', 'public.rename_dog(text,text)', 'execute')
     and has_function_privilege('anon', 'public.feed_dog(text)', 'execute')
     and has_function_privilege('anon', 'public.sell_rats(text)', 'execute')
     and has_function_privilege('anon', 'public.dog_state(text)', 'execute'), 'public RPCs';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like '\_rat\_%' or p.proname like '\_dog\_%')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the twins and helpers are private';
end $$;

select 'v17 rpc smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected: the v15 smoke's rows, then `FAILED: tests/sql/anticheat-smoke.sql` — the guard file it ends with calls `sling_start` (`function public.sling_start(unknown, unknown, integer) does not exist` in the log).

- [ ] **Step 3: Write section E**

**supabase/migrations/0019_v17_rats.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- E. RPCs (§6.1, §7.1, §7.2, §10.4, §10.7) ----------
-- Each public RPC runs its guard (_ac_play for the room RPCs, _ac_account for the account RPCs), then its private twin
-- with now(). A twin takes p_now: a room twin opens the field (the plot locks and both sweeps), then takes the wallet; an
-- account twin takes the wallet. Every refusal raises, so a refused call changes nothing, pellet included (D15).

-- The slingshot's aim (§6.1, D14): a ná, a pellet, a live rat of this room, room under the caps (checked, not counted);
-- one aim per account, replaced by a new one.
create or replace function public._rat_do_sling_start(p_room uuid, p_account uuid, p_rat bigint, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  if not public._owns(p_account, 'tool_sling') then
    raise exception 'no sling' using errcode = '22023';
  end if;
  if not public._owns(p_account, 'ammo_pellet') then
    raise exception 'no pellets' using errcode = '22023';
  end if;
  if not exists (select 1 from public.field_rats where id = p_rat and room_id = p_room and ended_at is null) then
    raise exception 'rat gone' using errcode = '22023';
  end if;
  perform public._rat_caps(p_account, p_now, false);
  insert into public.sling_aims (account_id, room_id, rat_id, started_at, last_shot_at, shots)
  values (p_account, p_room, p_rat, p_now, null, 0)
  on conflict (account_id) do update
    set room_id = excluded.room_id, rat_id = excluded.rat_id, started_at = excluded.started_at, last_shot_at = null, shots = 0;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('aim', jsonb_build_object('rat', p_rat, 'started_at', p_now));
end $$;

-- A shot (§6.1, D14, D15): the aim at this room and rat, a live rat, 2–60 s after the aim or the previous shot, a pellet.
-- The pellet is used; a hit (null is a miss) catches the rat and ends the aim.
create or replace function public._rat_do_sling_shoot(p_room uuid, p_account uuid, p_rat bigint, p_hit boolean,
                                                      p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare a public.sling_aims; v_prev timestamptz; v_price integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into a from public.sling_aims where account_id = p_account for update;
  if not found or a.room_id is distinct from p_room or a.rat_id is distinct from p_rat then
    raise exception 'no aim' using errcode = '22023';
  end if;
  if not exists (select 1 from public.field_rats where id = p_rat and room_id = p_room and ended_at is null) then
    raise exception 'rat gone' using errcode = '22023';
  end if;
  v_prev := coalesce(a.last_shot_at, a.started_at);
  if p_now < v_prev + interval '2 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
  if p_now > v_prev + interval '60 seconds' then
    raise exception 'aim expired' using errcode = '22023';
  end if;
  if not public._owns(p_account, 'ammo_pellet') then
    raise exception 'no pellets' using errcode = '22023';
  end if;
  perform public._use_item(p_account, 'ammo_pellet');
  update public.sling_aims set last_shot_at = p_now, shots = shots + 1 where account_id = p_account;
  if coalesce(p_hit, false) then
    v_price := public._rat_catch(p_room, p_account, p_rat, 'sling', p_now);
    delete from public.sling_aims where account_id = p_account;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('shot', jsonb_build_object(
              'hit', coalesce(p_hit, false), 'price', v_price,
              'pellets', coalesce((select qty from public.inventory where account_id = p_account and item_id = 'ammo_pellet'), 0)));
end $$;

-- The dog's pounce (§7.2, D17, D18): a dog, fed, rested; then the catch, and 5 minutes' rest.
create or replace function public._dog_do_hunt(p_room uuid, p_account uuid, p_rat bigint, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare d public.dogs; v_price integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  select * into d from public.dogs where account_id = p_account for update;
  if not found then
    raise exception 'no dog' using errcode = '22023';
  end if;
  if d.fed_until is null or d.fed_until <= p_now then
    raise exception 'dog hungry' using errcode = '22023';
  end if;
  if d.next_hunt_at > p_now then
    raise exception 'dog resting' using errcode = '22023', detail = ceil(extract(epoch from (d.next_hunt_at - p_now)))::int::text;
  end if;
  v_price := public._rat_catch(p_room, p_account, p_rat, 'dog', p_now);
  update public.dogs set next_hunt_at = p_now + interval '5 minutes', catches = catches + 1 where account_id = p_account;
  return public._field_view(p_room, p_account, p_now) || jsonb_build_object('dog_hunt', jsonb_build_object('price', v_price));
end $$;

-- What the dog calls answer (§10.4): the dog, the food_dog count and the wallet.
create or replace function public._dog_answer(p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('server_now', p_now, 'dog', public._dog_view(p_account),
    'food', coalesce((select i.qty from public.inventory i where i.account_id = p_account and i.item_id = 'food_dog'), 0),
    'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0))
$$;

-- Adoption at chú Tám's (§7.1, D19–D21, D29): a valid name and coat, one dog an account, 20 000 xu; it comes fed for 24 h.
create or replace function public._dog_do_adopt(p_account uuid, p_name text, p_coat text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; v_name text;
begin
  w := public._wallet_lock(p_account);
  v_name := public._pet_name(p_name);
  if p_coat is null or p_coat not in ('vang', 'muc', 'ven', 'dom') then
    raise exception 'invalid coat' using errcode = '22023';
  end if;
  if exists (select 1 from public.dogs where account_id = p_account) then
    raise exception 'already own dog' using errcode = '22023';
  end if;
  if w.coins < 20000 then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(p_account, -20000, 'dog_adopt', 'dog ' || p_coat);
  insert into public.dogs (account_id, name, coat, adopted_at, fed_until)
  values (p_account, v_name, p_coat, p_now, p_now + interval '24 hours');
  return public._dog_answer(p_account, p_now);
end $$;

-- A new name, free, any time (§7.1).
create or replace function public._dog_do_rename(p_account uuid, p_name text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_name text;
begin
  perform public._wallet_lock(p_account);
  v_name := public._pet_name(p_name);
  update public.dogs set name = v_name where account_id = p_account;
  if not found then
    raise exception 'no dog' using errcode = '22023';
  end if;
  return public._dog_answer(p_account, p_now);
end $$;

-- A meal (§7.1, D19): refused while more than 12 h of food remain; 1 bịch feeds 24 h from max(now, fed_until).
create or replace function public._dog_do_feed(p_account uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare d public.dogs;
begin
  perform public._wallet_lock(p_account);
  select * into d from public.dogs where account_id = p_account for update;
  if not found then
    raise exception 'no dog' using errcode = '22023';
  end if;
  if d.fed_until > p_now + interval '12 hours' then
    raise exception 'dog full' using errcode = '22023';
  end if;
  perform public._use_item(p_account, 'food_dog');
  update public.dogs set fed_until = greatest(d.fed_until, p_now) + interval '24 hours' where account_id = p_account;
  return public._dog_answer(p_account, p_now);
end $$;

-- cô Út buys every rat in the bag at its stored price (§5.6, D12): ledger reason rat_sell.
create or replace function public._rat_do_sell(p_account uuid, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_n integer; v_xu integer;
begin
  perform public._wallet_lock(p_account);
  with sold as (delete from public.rat_bag where account_id = p_account returning price)
  select count(*)::int, coalesce(sum(price), 0)::int into v_n, v_xu from sold;
  if v_n = 0 then
    raise exception 'nothing to sell' using errcode = '22023';
  end if;
  perform public._pay(p_account, v_xu, 'rat_sell', v_n || ' con');
  return jsonb_build_object('server_now', p_now, 'mine', public._farm_mine(p_account),
                            'sold', jsonb_build_object('count', v_n, 'xu', v_xu));
end $$;

-- The guarded RPCs (§10.7): no hard check after the guard — rat ids come from the state, names are typed.
create or replace function public.sling_start(p_room_id uuid, p_session_token text, p_rat_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._rat_do_sling_start(p_room_id, v_account, p_rat_id, now());
end $$;

create or replace function public.sling_shoot(p_room_id uuid, p_session_token text, p_rat_id bigint, p_hit boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._rat_do_sling_shoot(p_room_id, v_account, p_rat_id, p_hit, now());
end $$;

create or replace function public.dog_hunt(p_room_id uuid, p_session_token text, p_rat_id bigint) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._dog_do_hunt(p_room_id, v_account, p_rat_id, now());
end $$;

create or replace function public.adopt_dog(p_session_token text, p_name text, p_coat text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._dog_do_adopt(v_account, p_name, p_coat, now());
end $$;

create or replace function public.rename_dog(p_session_token text, p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._dog_do_rename(v_account, p_name, now());
end $$;

create or replace function public.feed_dog(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._dog_do_feed(v_account, now());
end $$;

create or replace function public.sell_rats(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_account(p_session_token);
begin
  return public._rat_do_sell(v_account, now());
end $$;

-- The dog on entering the game (§7.3): a read, on the guard file's allowlist (D26).
create or replace function public.dog_state(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  return public._dog_answer(v_account, now());
end $$;

-- anh Hai's shop (0018's body, §8): v17 sells the pellets and the dog food too — the soft kind_mismatch allows the kinds
-- ammo and pet_food; the ná is a tool, bought once.
create or replace function public.buy_farm_item(p_session_token text, p_item_id text, p_qty integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; it public.shop_items; v_cost integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind not in ('seed', 'fertilizer', 'pesticide', 'tool', 'critter_box', 'ammo', 'pet_food') then   -- v17: ammo, pet_food
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_farm_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return public._ac_flag(v_account, 'bad_qty', 'buy_farm_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  if it.kind in ('tool', 'critter_box') and p_qty <> 1 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  if it.kind = 'tool' and public._owns(v_account, it.id) then
    raise exception 'already owned' using errcode = '22023';
  end if;
  if it.kind = 'critter_box' and public._critter_cap(v_account) - 3 >= it.capacity then
    raise exception 'already owned' using errcode = '22023';
  end if;
  if coalesce((select qty from public.inventory where account_id = v_account and item_id = it.id), 0) + p_qty > 99 then
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

revoke all on function public._rat_do_sling_start(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_do_sling_shoot(uuid, uuid, bigint, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_hunt(uuid, uuid, bigint, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_answer(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_adopt(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_rename(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._dog_do_feed(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._rat_do_sell(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.sling_start(uuid, text, bigint) to anon, authenticated;
grant execute on function public.sling_shoot(uuid, text, bigint, boolean) to anon, authenticated;
grant execute on function public.dog_hunt(uuid, text, bigint) to anon, authenticated;
grant execute on function public.adopt_dog(text, text, text) to anon, authenticated;
grant execute on function public.rename_dog(text, text) to anon, authenticated;
grant execute on function public.feed_dog(text) to anon, authenticated;
grant execute on function public.sell_rats(text) to anon, authenticated;
grant execute on function public.dog_state(text) to anon, authenticated;
grant execute on function public.buy_farm_item(text, text, integer) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected:

```text
v14 smoke ok
0019 twice ok
lyrics lockdown smoke ok
v15 crop smoke ok
v15 land smoke ok
v15 farm smoke ok
v15 fish price smoke ok
v15 upgrade reset smoke ok
anticheat names and queue smoke ok
anticheat flow smoke ok
anticheat fishing smoke ok
anticheat farm smoke ok
anticheat shared functions smoke ok
anticheat admin smoke ok
anticheat guards ok
v15.2 model smoke ok
v15.2 field smoke ok
v15.2 harvest smoke ok
v15.2 tools smoke ok
v15.2 beds smoke ok
anticheat guards ok
v16 rules smoke ok
v16 cao and poker rules smoke ok
v16 tables smoke ok
v16 tienlen smoke ok
v16 cao smoke ok
v16 poker smoke ok
v16 holdings and deletions smoke ok
anticheat guards ok
v15.3 model smoke ok
v15.3 gathering smoke ok
v15.3 farm smoke ok
v15.3 wipe smoke ok
anticheat guards ok
v17 model smoke ok
v17 field smoke ok
v17 rpc smoke ok
anticheat guards ok
v17 model smoke ok
v17 field smoke ok
v17 rpc smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v17): 0019 RPCs — the slingshot, the dog, the rat sale and anh Hai's new items

Section E of 0019_v17_rats.sql: the guarded room RPCs sling_start, sling_shoot and
dog_hunt (_ac_play) and account RPCs adopt_dog, rename_dog, feed_dog and sell_rats
(_ac_account), each with its private twin taking p_now; the allowlisted read dog_state;
and buy_farm_item re-created from 0018 so it sells the pellets and the dog food. A shot
is gated 2–60 s after the aim or the previous shot and uses a pellet, a hit catches;
the dog needs food and 5 minutes' rest after a catch; a new dog comes fed for 24 h and
a bịch feeds 24 h from max(now, fed_until). The guard file allowlists dog_state(text)
and its dynamic loop gains the 7 new RPCs: 59 guarded calls.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0019_v17_rats.sql tests/sql/anticheat-guards.sql tests/sql/v17-smoke.sql
git commit -F <message file>
```

---

### Task 4: Database — the anti-cheat snapshot and wipe take the dog and the rats (`0019` section F)

**Files:**
- Modify: `supabase/migrations/0019_v17_rats.sql`
- Test: `tests/sql/v17-smoke.sql` (modify)

**Interfaces:**
- Consumes: `0018`'s `_ac_holdings(account)` and `_ac_wipe(account, by)` (with `0017`'s card seats: `_card_forfeit_all(p_account)` first, and the holdings' `cards`), Tasks 1–3's tables.
- Produces (§10.7, §16): `_ac_holdings` gains `dog` (`_dog_view`) and `rats {count, value}` after `0018`'s `critters`; `_ac_wipe` also deletes the account's `dogs`, `rat_bag` and `sling_aims` rows, and its inventory delete takes the ná, the pellets and the dog food (the farm profile stays). The v17 smoke wipes an account that holds a dog, rats in the bag, an aim, the new items, a critter, a cooldown and a poker seat, and prints `v17 wipe smoke ok`.

- [ ] **Step 1: Write the smoke's wipe part**

**tests/sql/v17-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- the wipe (§10.7, §16): the snapshot lists the dog and the rats; the dog, the bag, the aim, the ná, the pellets
-- and the food go; the earlier migrations' parts stay ----------
insert into smoke select 't5', token from public.register('rat_e_' || floor(random() * 1e9)::text, 'pw123456');
do $$
declare a5 uuid := public._auth_account((select v from smoke where k = 't5')); room uuid := (select v from smoke where k = 'room4')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; h jsonb;
begin
  perform pg_temp.set_coins(a5, 5000);
  perform pg_temp.give(a5, 'tool_sling', 1);
  perform pg_temp.give(a5, 'ammo_pellet', 20);
  perform pg_temp.give(a5, 'food_dog', 3);
  insert into public.dogs (account_id, name, coat, adopted_at, fed_until, catches)
  values (a5, 'Vện', 'ven', t, t + interval '1 day', 4);
  insert into public.rat_bag (account_id, price, caught_at, how) values (a5, 150, t, 'sling'), (a5, 336, t, 'dog');
  insert into public.sling_aims (account_id, room_id, rat_id, started_at) values (a5, room, 1, t);
  insert into public.farm_profiles (account_id, rat_day_on, rat_day_count) values (a5, public._vn_today(), 5);
  -- 0018's and 0017's parts stay (anti-cheat §11.3 rule 3): a critter, a cooldown, and a seat at the poker table
  insert into public.critters (account_id, kind, price, caught_at) values (a5, 'cua_dong', 26, t);
  insert into public.gather_cooldowns (account_id, spot, ready_at) values (a5, 'crab2', t + interval '5 minutes');
  perform public._card_sit(room, a5, 'poker', 1, 100, 5000, now());
  h := public._ac_holdings(a5);
  assert h->'dog' = jsonb_build_object('name', 'Vện', 'coat', 'ven', 'adopted_at', t, 'fed_until', t + interval '1 day',
                                       'next_hunt_at', null, 'catches', 4)
     and h->'rats' = '{"count": 2, "value": 486}', format('holdings %s %s', h->'dog', h->'rats');
  assert h->'critters' = '[{"kind": "cua_dong", "n": 1, "xu": 26}]' and h ? 'produce' and h ? 'tank' and h->'wallet'->'coins' = '0'
     and h->'cards' = jsonb_build_array(jsonb_build_object('room_id', room, 'game', 'poker', 'seat', 1, 'chips', 5000, 'escrow', 0)),
    format('the earlier parts stay: %s', h);
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a5, 2, 'pending_wipe', now());
  h := public._ac_wipe(a5, null);
  assert h->'rats'->'count' = '2' and h->'dog'->>'name' = 'Vện'
     and h->'inventory' @> '[{"item_id": "ammo_pellet", "qty": 20}, {"item_id": "food_dog", "qty": 3}, {"item_id": "tool_sling", "qty": 1}]'
     and (select snapshot from public.anticheat_wipes where account_id = a5) = h, 'the snapshot keeps them';
  assert h->'cards' = '[]' and h->'wallet'->'coins' = '5000', format('the seat is cashed out before the snapshot: %s', h);
  assert not exists (select 1 from public.dogs where account_id = a5) and not exists (select 1 from public.rat_bag where account_id = a5)
     and not exists (select 1 from public.sling_aims where account_id = a5) and not exists (select 1 from public.inventory where account_id = a5)
     and not exists (select 1 from public.critters where account_id = a5)
     and not exists (select 1 from public.gather_cooldowns where account_id = a5)
     and not exists (select 1 from public.card_seats where account_id = a5)
     and not exists (select 1 from public.wallets where account_id = a5), 'the dog, the bag, the aim, the items and the rest are gone';
  assert exists (select 1 from public.coin_ledger where account_id = a5 and reason = 'wipe' and delta = -5000)
     and (select ban_state = 'wiped' from public.anticheat_status where account_id = a5), 'the wipe row and the state';
  assert (select rat_day_count from public.farm_profiles where account_id = a5) = 5, 'the farm profile stays';
  assert public._farm_mine(a5)->'dog' = 'null' and public._farm_mine(a5)->'rats' = '{"count": 0, "value": 0}'
     and public._farm_mine(a5)->'items' = '{}', 'mine is empty';
end $$;

select 'v17 wipe smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected: every earlier smoke's `ok` rows, then `FAILED: tests/sql/v17-smoke.sql` after `v17 field smoke ok` and `v17 rpc smoke ok` (in the log), with `ERROR:  holdings` — the snapshot has no `dog` and `rats` yet.

- [ ] **Step 3: Write section F**

**supabase/migrations/0019_v17_rats.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- F. Anti-cheat (§10.7, §16): the holdings and the wipe take the dog and the rats ----------
-- SHARED WITH 0018 (v15.3), which re-created both functions last. Each body below is 0018's with only the lines marked
-- "v17" added: _ac_holdings gains "dog" and "rats" after 0018's "critters" (0017's "cards" stays after "drying"), and
-- _ac_wipe keeps 0017's first step (the seats resolved, §6.3 of the v16 spec) and deletes the dog, the rat bag and the
-- aim after 0018's critters and cooldowns; the inventory delete already takes the ná, the pellets and the food.

-- What a wipe removes: 0018's snapshot also lists the dog and the rats in the bag (count and what cô Út pays).
create or replace function public._ac_holdings(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'wallet', (select jsonb_build_object('coins', w.coins, 'daily_on', w.daily_on, 'bonus_on', w.bonus_on,
                                         'bonus_count', w.bonus_count)
                 from public.wallets w where w.account_id = p_account),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('item_id', i.item_id, 'qty', i.qty) order by i.item_id)
                             from public.inventory i where i.account_id = p_account), '[]'::jsonb),
    'fishing_profile', (select jsonb_build_object('rod', p.rod, 'bobber', p.bobber, 'bait', p.bait)
                          from public.fishing_profiles p where p.account_id = p_account),
    'fish', coalesce((select jsonb_agg(jsonb_build_object('species_id', f.species_id, 'weight_g', f.weight_g, 'price', f.price,
                                                          'caught_at', f.caught_at) order by f.caught_at, f.id)
                        from public.fish f where f.account_id = p_account), '[]'::jsonb),
    'personal_bests', coalesce((select jsonb_agg(jsonb_build_object('species_id', b.species_id, 'weight_g', b.weight_g,
                                                                    'caught_at', b.caught_at) order by b.species_id)
                                  from public.personal_bests b where b.account_id = p_account), '[]'::jsonb),
    'rice', coalesce((select jsonb_agg(jsonb_build_object('variety', r.variety, 'wet_kg', r.wet_kg, 'dry_kg', r.dry_kg)
                                       order by r.variety)
                        from public.rice_stock r where r.account_id = p_account), '[]'::jsonb),
    'produce', coalesce((select jsonb_agg(jsonb_build_object('upland', ps.upland, 'kg', ps.kg) order by ps.upland)
                           from public.produce_stock ps where ps.account_id = p_account), '[]'::jsonb),
    'tank', (select jsonb_build_object('item', pr.tank_item, 'charges', pr.tank_charges)
               from public.farm_profiles pr where pr.account_id = p_account),
    -- v15.3: the critters held
    'critters', coalesce((select jsonb_agg(jsonb_build_object('kind', k.kind, 'n', k.n, 'xu', k.xu) order by k.kind)
                            from (select cr.kind, count(*)::int as n, sum(cr.price)::int as xu from public.critters cr
                                   where cr.account_id = p_account group by cr.kind) k), '[]'::jsonb),
    -- v17: the dog and the rats in the bag
    'dog', public._dog_view(p_account),
    'rats', (select jsonb_build_object('count', count(*)::int, 'value', coalesce(sum(b.price), 0)::int)
               from public.rat_bag b where b.account_id = p_account),
    'plots', coalesce((select jsonb_agg(jsonb_build_object('room_id', fp.room_id, 'plot_no', fp.plot_no, 'kind', fp.kind,
                                                           'owned_at', fp.owned_at, 'sale_price', fp.sale_price,
                                                           'sublease_price', fp.sublease_price) order by fp.room_id, fp.plot_no)
                         from public.field_plots fp where fp.owner_id = p_account), '[]'::jsonb),
    'leases', coalesce((select jsonb_agg(jsonb_build_object('room_id', pl.room_id, 'plot_no', pl.plot_no, 'source', pl.source,
                                                            'price', pl.price, 'until', pl.until) order by pl.room_id, pl.plot_no)
                          from public.plot_leases pl where pl.farmer_id = p_account), '[]'::jsonb),
    'offers', coalesce((select jsonb_agg(jsonb_build_object('room_id', lo.room_id, 'plot_no', lo.plot_no, 'price', lo.price,
                                                            'created_at', lo.created_at) order by lo.created_at, lo.id)
                          from public.land_offers lo where lo.buyer_id = p_account), '[]'::jsonb),
    'crops', coalesce((select jsonb_agg(jsonb_build_object('room_id', c.room_id, 'plot_no', c.plot_no, 'kind', c.kind,
                                                           'variety', c.variety, 'upland', c.upland,
                                                           'transplant_at', c.transplant_at, 'plant_at', c.plant_at,
                                                           'parts', c.harvested_parts, 'harvester_until', c.harvester_until)
                                        order by c.room_id, c.plot_no)
                         from public.crops c where c.farmer_id = p_account), '[]'::jsonb),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('room_id', d.room_id, 'slot', d.slot, 'variety', d.variety,
                                                            'kg', d.kg, 'ready_at', d.ready_at) order by d.room_id, d.slot)
                          from public.drying_slots d where d.account_id = p_account), '[]'::jsonb),
    'cards', coalesce((select jsonb_agg(jsonb_build_object('room_id', s.room_id, 'game', s.game, 'seat', s.seat, 'chips', s.chips,
                                                           'escrow', s.escrow) order by s.room_id, s.game)
                         from public.card_seats s where s.account_id = p_account), '[]'::jsonb),
    'announcements', (select count(*) from public.chat_messages m where m.system and m.about_account_id = p_account))
$$;

-- 0018's wipe (the seats first, so the xu they give back are part of the wiped balance; then the snapshot): v17 also
-- deletes the dog, the rat bag and the aim; the farm profile (the gift, the day's visits and catches) stays.
create or replace function public._ac_wipe(p_account uuid, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_snap jsonb; v_id bigint; v_coins integer;
begin
  perform public._card_forfeit_all(p_account);
  v_snap := public._ac_holdings(p_account);
  insert into public.anticheat_wipes (account_id, username, wiped_by, snapshot)
  values (p_account, (select username from public.accounts where id = p_account), p_by, v_snap)
  returning id into v_id;
  select coins into v_coins from public.wallets where account_id = p_account;
  if found then
    insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (p_account, -v_coins, 0, 'wipe', 'wipe #' || v_id);
    delete from public.wallets where account_id = p_account;
  end if;
  delete from public.inventory where account_id = p_account;
  delete from public.casts where account_id = p_account;
  delete from public.fish where account_id = p_account;
  delete from public.fishing_profiles where account_id = p_account;
  delete from public.personal_bests where account_id = p_account;
  delete from public.rice_stock where account_id = p_account;
  delete from public.produce_stock where account_id = p_account;
  update public.farm_profiles set tank_item = null, tank_charges = 0 where account_id = p_account;
  delete from public.critters where account_id = p_account;                          -- v15.3
  delete from public.gather_cooldowns where account_id = p_account;                  -- v15.3
  delete from public.dogs where account_id = p_account;                              -- v17
  delete from public.rat_bag where account_id = p_account;                           -- v17
  delete from public.sling_aims where account_id = p_account;                        -- v17
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

revoke all on function public._ac_holdings(uuid) from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v17-sql.sh"`
Expected:

```text
v14 smoke ok
0019 twice ok
lyrics lockdown smoke ok
v15 crop smoke ok
v15 land smoke ok
v15 farm smoke ok
v15 fish price smoke ok
v15 upgrade reset smoke ok
anticheat names and queue smoke ok
anticheat flow smoke ok
anticheat fishing smoke ok
anticheat farm smoke ok
anticheat shared functions smoke ok
anticheat admin smoke ok
anticheat guards ok
v15.2 model smoke ok
v15.2 field smoke ok
v15.2 harvest smoke ok
v15.2 tools smoke ok
v15.2 beds smoke ok
anticheat guards ok
v16 rules smoke ok
v16 cao and poker rules smoke ok
v16 tables smoke ok
v16 tienlen smoke ok
v16 cao smoke ok
v16 poker smoke ok
v16 holdings and deletions smoke ok
anticheat guards ok
v15.3 model smoke ok
v15.3 gathering smoke ok
v15.3 farm smoke ok
v15.3 wipe smoke ok
anticheat guards ok
v17 model smoke ok
v17 field smoke ok
v17 rpc smoke ok
v17 wipe smoke ok
anticheat guards ok
v17 model smoke ok
v17 field smoke ok
v17 rpc smoke ok
v17 wipe smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v17): 0019 anti-cheat — the snapshot lists the dog and the rats; the wipe takes them

Section F of 0019_v17_rats.sql: _ac_holdings and _ac_wipe re-created from 0018's bodies
with only the v17 lines added. The snapshot gains "dog" and "rats" (count and value)
after 0018's critters, keeping 0017's card seats; the wipe still resolves the seats
first, then also deletes the dog, the rat bag and the slingshot's aim, and its
inventory delete takes the ná, the pellets and the dog food. The smoke wipes an account
that holds all of it, a critter, a cooldown and a poker seat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0019_v17_rats.sql tests/sql/v17-smoke.sql
git commit -F <message file>
```

---

### Task 5: The rat model on the client — Mrat, the rats' paths and the field's rats

**Files:**
- Create: `lib/game/farm/rats.ts`
- Modify: `lib/game/farm/crop.ts`, `lib/game/farm/upland.ts`
- Test: `tests/unit/farm-rats.test.ts` (create)

**Interfaces:**
- Consumes: Task 1's fixtures (`crop-cases.json`'s `rats` cases R1–R4, `upland-cases.json`'s U1, U2 and the rat edges); `crop.ts`'s `cropModel`, `cropYield`, `yieldEstimate` and `upland.ts`'s `uplandModel`, `upYield`, `upEstimate`; `lib/game/types.ts`' `Vec`, `Rect`; `fishing/reel.ts`' `nextRandom` (mulberry32).
- Produces (`lib/game/farm/rats.ts`, §5.4, §5.5, §10.5):
  - `RAT` (the constants the client shows: `rate` 0.02, `lossCap` 0.10, `hourCap` 6, `dayCap` 24, the path's speeds and legs); `RatLogEntry {r, from, to}`, `RatLive {id, plot, since, seed}`, `RatEnd`, `RatRecent` (+ `endedAt`, `how`, `by`, `dog`), `FieldRats {nextAt, price, live, recent, plots}`, `RatBag {count, value}`, `RatCaps {hourLeft, hourResetsAt, dayLeft}`, `EMPTY_BAG`, `FULL_CAPS`;
  - `ratHours(log, t)` and `ratFactor(h)` (0019's operations in its order), `parseRats(v)` (null before 0019), `parseRatBag`, `parseRatCaps`;
  - `RatPose {x, y, dir, moving}`, `ratPos(seed, since, hole, plot, t)` (out of the hole to the nearest point of the inset plot at 48 px/s, then 6 s legs) and `ratFleePos(seed, since, endedAt, hole, plot, t)` (home in 1.5 s);
  - `cropModel(c, rats = [])` and `uplandModel(c, rats = [])` carry the log; `YieldFactors.mrat` and `UplandYield.mrat`: Mrat is the rice product's last factor and comes right after Mlate in the hoa-màu product; estimates count no future rats.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-rats.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { uplandFromRow, varietyFromRow, type UplandCrop, type UplandCropRow, type Variety } from "@/lib/game/farm/catalog";
import { cropModel, cropYield, HOUR_MS, partKg, yieldEstimate, type CropModel } from "@/lib/game/farm/crop";
import {
  FULL_CAPS, parseRatBag, parseRatCaps, parseRats, RAT, ratFactor, ratFleePos, ratHours, ratPos, type RatLogEntry,
} from "@/lib/game/farm/rats";
import type { CropView } from "@/lib/game/farm/state";
import { upEstimate, uplandModel, upYield, type UplandModel } from "@/lib/game/farm/upland";
import { nextRandom } from "@/lib/game/fishing/reel";
import rice from "@/tests/fixtures/crop-cases.json";
import upland from "@/tests/fixtures/upland-cases.json";

const V: Record<string, Variety> = Object.fromEntries([
  { id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 710, blast_mult: 1, sort_order: 10 },
  { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 950, blast_mult: 1, sort_order: 20 },
  { id: "thom", name: "Lúa thơm", scale: 1.15, base_kg: 60, price_per_kg: 1350, blast_mult: 1.3, sort_order: 30 },
].map((r) => [r.id, varietyFromRow(r)]));

/** [rat, from, to | null], hours after t0. */
type Entry = [number, number, number | null];
interface RiceCase {
  name: string; variety: string; land: number; q_transplant: number; q_harvest: number;
  soak: number; sow: number; transplant: number; harvest: number;
  water: Array<[number, number]>; fert: Array<[number, string]>; rats: Entry[];
  expect: { kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number; mrat: number };
  parts?: Array<[number, number]>;
}
interface UplandCase {
  name: string; upland: string; land: number; sow: number | null; plant: number; pick: number; k: number;
  water: Array<[number, number]>; fert: Array<[number, string]>; work: Array<[number, string]>; rats: Entry[];
  expect: { kg: number; mcare: number; mplant: number; mwater: number; mrot: number; mpest: number; mlate: number; mrat: number };
}
interface Edge { name: string; log: Entry[]; t: number; hours: number; mrat: number }
const RX = rice as unknown as { t0: string; rats: RiceCase[]; rat_edges: Edge[] };
const UX = upland as unknown as { t0: string; crops: UplandCropRow[]; rats: UplandCase[] };
const U: Record<string, UplandCrop> = Object.fromEntries(UX.crops.map((r) => [r.id, uplandFromRow(r)]));
const t0 = Date.parse(RX.t0);
const at = (h: number) => t0 + h * HOUR_MS;

const logOf = (a: Entry[]): RatLogEntry[] => a.map(([r, from, to]) => ({ r, from: at(from), to: to === null ? null : at(to) }));
const riceOf = (k: RiceCase): CropModel => ({
  soakAt: at(k.soak), sowAt: at(k.sow), transplantAt: at(k.transplant), qTransplant: k.q_transplant,
  water: k.water.map(([h, l]) => ({ t: at(h), l })), fert: k.fert.map(([h, item]) => ({ t: at(h), item })), rats: logOf(k.rats),
});
const bedsOf = (k: UplandCase): UplandModel => ({
  sowAt: k.sow === null ? null : at(k.sow), plantAt: at(k.plant), water: k.water.map(([h, l]) => ({ t: at(h), l })),
  fert: k.fert.map(([h, item]) => ({ t: at(h), item })), work: k.work.map(([h, act]) => ({ t: at(h), act })), spray: [],
  harvests: [], rats: logOf(k.rats),
});

describe("the shared rat fixtures (the SQL smoke replays the same cases)", () => {
  it("has R1–R4, U1, U2 and ten edges", () => {
    expect(RX.rats.map((k) => k.name.slice(0, 2))).toEqual(["R1", "R2", "R3", "R4"]);
    expect(UX.rats.map((k) => k.name.slice(0, 2))).toEqual(["U1", "U2"]);
    expect(RX.rat_edges).toHaveLength(10);
  });
  for (const e of RX.rat_edges) {
    it(`rat-hours: ${e.name}`, () => {
      const h = ratHours(logOf(e.log), at(e.t));
      expect(h).toBe(e.hours);
      expect(ratFactor(h)).toBeCloseTo(e.mrat, 12);
    });
  }
  for (const k of RX.rats) {
    it(`rice: ${k.name}`, () => {
      const y = cropYield(riceOf(k), V[k.variety], k.land, k.q_harvest, [], at(k.harvest));
      expect(y.kg).toBe(k.expect.kg);
      for (const f of ["mcare", "mseed", "mwater", "mpest", "mlate", "mrat"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
      (k.parts ?? []).forEach(([h, kg], i) => {
        const whole = cropYield(riceOf(k), V[k.variety], k.land, 1, [], at(h)).kg;
        expect(partKg(i + 1, whole), `part ${i + 1} at ${h} h (Y = ${whole})`).toBe(kg);
      });
    });
  }
  for (const k of UX.rats) {
    it(`hoa màu: ${k.name}`, () => {
      const y = upYield(bedsOf(k), U[k.upland], k.land, k.k, [], at(k.pick));
      expect(y.kg).toBe(k.expect.kg);
      for (const f of ["mcare", "mplant", "mwater", "mrot", "mpest", "mlate", "mrat"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
    });
  }
  it("by hand: R1 is 90 × 0.96 = 86.4 → 86 kg, R2 is 75 × 0.90 = 67.5 → 68 kg", () => {
    expect(Math.floor(90 * ratFactor(2) + 0.5)).toBe(86);
    expect(Math.floor(75 * ratFactor(5) + 0.5)).toBe(68);
    expect(ratFactor(50)).toBe(ratFactor(5));
  });
});

describe("the estimate counts the rats so far, not future ones (§5.5)", () => {
  const r1 = RX.rats[0];
  it("rice", () => {
    expect(yieldEstimate(riceOf(r1), V.short, 1, [], at(58)).mrat).toBeCloseTo(0.96, 12);
    expect(yieldEstimate({ ...riceOf(r1), rats: undefined }, V.short, 1, [], at(58)).mrat).toBe(1);
    expect(yieldEstimate(riceOf(r1), V.short, 1, [], at(56)).mrat).toBe(1);
  });
  it("hoa màu", () => {
    const u1 = UX.rats[0];
    expect(upEstimate(bedsOf(u1), U.khoai, 1, 1, [], at(51)).mrat).toBeCloseTo(0.98, 12);
    expect(upEstimate(bedsOf(u1), U.khoai, 1, 1, [], at(50)).mrat).toBe(1);
  });
  it("the models take the plot's rat log (none by default)", () => {
    const view = { soakAt: null, sowAt: null, transplantAt: null, plantAt: null, log: null } as unknown as CropView;
    const log = logOf([[1, 1, null]]);
    expect(cropModel(view, log).rats).toBe(log);
    expect(cropModel(view).rats).toEqual([]);
    expect(uplandModel(view, log).rats).toBe(log);
    expect(uplandModel(view).rats).toEqual([]);
  });
});

describe("a rat's path (§5.4)", () => {
  // times are ms from the rat's `since` (0 here, so no precision is lost to the epoch)
  const hole = { x: 172, y: 46 }, plot = { x: 72, y: 52, w: 128, h: 96 }, seed = 1234567, since = 0;
  /** E = (172, 60), the inset plot's nearest point, 14 px from the hole. */
  const entry = (14 / 48) * 1000;
  const P = (i: number) => {
    const [a, s] = nextRandom(seed + 7919 * i);
    const [b] = nextRandom(s);
    return { x: 80 + a * 112, y: 60 + b * 80 };
  };
  const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);

  it("comes out of its hole at `since` and runs at 48 px/s to the nearest point of the inset plot", () => {
    expect(ratPos(seed, since, hole, plot, since - 1)).toBeNull();
    expect(ratPos(seed, since, hole, plot, since)).toEqual({ x: 172, y: 46, dir: 1, moving: true });
    const mid = ratPos(seed, since, hole, plot, since + entry / 2)!;
    expect(mid.x).toBe(172);
    expect(mid.y).toBeCloseTo(53, 9);
    const e = ratPos(seed, since, hole, plot, since + entry)!;
    expect(e.x).toBeCloseTo(172, 9);
    expect(e.y).toBeCloseTo(60, 9);
  });
  it("then 6 s legs: a run of at most 1.5 s to P(i), then nibbling there", () => {
    for (const i of [0, 1, 2, 7]) {
      const start = since + entry + i * RAT.legMs, from = i === 0 ? { x: 172, y: 60 } : P(i - 1), to = P(i);
      const run = Math.min(1500, (dist(from, to) / 48) * 1000);
      const s0 = ratPos(seed, since, hole, plot, start)!;
      expect(s0.x).toBeCloseTo(from.x, 9);
      expect(s0.y).toBeCloseTo(from.y, 9);
      const half = ratPos(seed, since, hole, plot, start + run / 2)!;
      expect(half.moving).toBe(true);
      expect(half.x).toBeCloseTo((from.x + to.x) / 2, 9);
      expect(half.dir).toBe(to.x < from.x ? -1 : 1);
      expect(ratPos(seed, since, hole, plot, start + run + 1)).toMatchObject({ x: to.x, y: to.y, moving: false });
      expect(ratPos(seed, since, hole, plot, start + RAT.legMs - 1)).toMatchObject({ x: to.x, y: to.y, moving: false });
    }
  });
  it("stays inside the inset plot after its entry, the same on every call", () => {
    const bad: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const t = since + entry + i * 137;
      const p = ratPos(seed, since, hole, plot, t)!;
      if (!(p.x >= 80 && p.x <= 192 && p.y >= 60 && p.y <= 140)) bad.push(`${i}: ${p.x}, ${p.y}`);
      const q = ratPos(seed, since, hole, plot, t)!;
      if (q.x !== p.x || q.y !== p.y || q.dir !== p.dir || q.moving !== p.moving) bad.push(`${i}: not the same`);
    }
    expect(bad).toEqual([]);
    expect(ratPos(seed + 1, since, hole, plot, since + 60_000)).not.toEqual(ratPos(seed, since, hole, plot, since + 60_000));
  }, 30_000);
  it("a fled rat runs back to its hole in 1.5 s", () => {
    const end = since + 20_000, p = ratPos(seed, since, hole, plot, end)!;
    expect(ratFleePos(seed, since, end, hole, plot, end)).toMatchObject({ x: p.x, y: p.y, moving: true });
    const half = ratFleePos(seed, since, end, hole, plot, end + 750)!;
    expect(half.x).toBeCloseTo((p.x + 172) / 2, 9);
    expect(half.y).toBeCloseTo((p.y + 46) / 2, 9);
    expect(ratFleePos(seed, since, end, hole, plot, end + 1500)).toBeNull();
  });
});

describe("the field's rats (§10.5)", () => {
  it("an answer from before 0019 has none", () => {
    expect(parseRats(undefined)).toBeNull();
    expect(parseRats(null)).toBeNull();
    expect(parseRats({ price: 150, live: [] })).toBeNull();
  });
  it("reads next_at, the price, the live and recent rats and the logs by plot", () => {
    const r = parseRats({
      next_at: "2026-03-01T00:20:00Z", price: 336,
      live: [{ id: 812, plot: 3, since: "2026-03-01T00:05:00Z", seed: 1234567 }, { id: "x", plot: 3 }],
      recent: [
        { id: 811, plot: 3, since: "2026-03-01T00:01:00Z", seed: 99, ended_at: "2026-03-01T00:15:00Z", how: "sling",
          by: { id: "u1", name: "Lan" }, dog: null },
        { id: 810, plot: 4, since: "2026-03-01T00:02:00Z", seed: 5, ended_at: "2026-03-01T00:15:01Z", how: "dog",
          by: { id: "u2", name: "Dat" }, dog: "Mực" },
        { id: 809, plot: 4, since: "2026-03-01T00:02:00Z", seed: 5, ended_at: "2026-03-01T00:15:02Z", how: "fled", by: null, dog: null },
        { id: 808, plot: 4, since: "2026-03-01T00:02:00Z", seed: 5, ended_at: "2026-03-01T00:15:02Z", how: "eaten" },
      ],
      plots: {
        3: [{ r: 811, from: "2026-03-01T00:02:00Z", to: "2026-03-01T00:15:00Z" }, { r: 812, from: "2026-03-01T00:06:00Z", to: null }],
        4: [], 11: [{ r: 1, from: "2026-03-01T00:02:00Z", to: null }],
      },
    });
    const T = (s: string) => Date.parse(`2026-03-01T00:${s}Z`);
    expect(r).toEqual({
      nextAt: T("20:00"), price: 336,
      live: [{ id: 812, plot: 3, since: T("05:00"), seed: 1234567 }],
      recent: [
        { id: 811, plot: 3, since: T("01:00"), seed: 99, endedAt: T("15:00"), how: "sling", by: { id: "u1", name: "Lan" }, dog: null },
        { id: 810, plot: 4, since: T("02:00"), seed: 5, endedAt: T("15:01"), how: "dog", by: { id: "u2", name: "Dat" }, dog: "Mực" },
        { id: 809, plot: 4, since: T("02:00"), seed: 5, endedAt: T("15:02"), how: "fled", by: null, dog: null },
      ],
      plots: { 3: [{ r: 811, from: T("02:00"), to: T("15:00") }, { r: 812, from: T("06:00"), to: null }] },
    });
  });
  it("reads the bag and the caps; an answer without them holds none and leaves the caps full", () => {
    expect(parseRatBag({ count: 2, value: 486 })).toEqual({ count: 2, value: 486 });
    expect(parseRatBag(undefined)).toEqual({ count: 0, value: 0 });
    expect(parseRatCaps({ hour_left: 4, hour_resets_at: "2026-03-01T01:00:00Z", day_left: 21 }))
      .toEqual({ hourLeft: 4, hourResetsAt: Date.parse("2026-03-01T01:00:00Z"), dayLeft: 21 });
    expect(parseRatCaps(undefined)).toEqual(FULL_CAPS);
    expect(FULL_CAPS).toEqual({ hourLeft: 6, hourResetsAt: null, dayLeft: 24 });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-rats.test.ts`
Expected: FAIL — `farm-rats.test.ts` cannot load `@/lib/game/farm/rats` ("Failed to resolve import"); 1 file fails, no tests run.

- [ ] **Step 3: Implement**

**lib/game/farm/crop.ts — edit 1 of 8.** Replace:

```ts
import type { Variety } from "./catalog";
import type { CropView, ItemEntry, PestView, Phase, WaterEntry } from "./state";
```

with:

```ts
import type { Variety } from "./catalog";
import { ratFactor, ratHours, type RatLogEntry } from "./rats";
import type { CropView, ItemEntry, PestView, Phase, WaterEntry } from "./state";
```

**lib/game/farm/crop.ts — edit 2 of 8.** Replace:

```ts
  fert: readonly ItemEntry[];
}

/** The model of a crop as field_state shows it (the logs are there for its farmer only). */
export function cropModel(c: CropView): CropModel {
  return {
    soakAt: c.soakAt, sowAt: c.sowAt, transplantAt: c.transplantAt, qTransplant: c.log?.qTransplant ?? 1,
    water: c.log?.water ?? [], fert: c.log?.fert ?? [],
  };
```

with:

```ts
  fert: readonly ItemEntry[];
  /** v17: the rats that ate it (the field's rats.plots); none before 0019. */
  rats?: readonly RatLogEntry[];
}

/** The model of a crop as field_state shows it (the logs are there for its farmer only), with its plot's rat log. */
export function cropModel(c: CropView, rats: readonly RatLogEntry[] = []): CropModel {
  return {
    soakAt: c.soakAt, sowAt: c.sowAt, transplantAt: c.transplantAt, qTransplant: c.log?.qTransplant ?? 1,
    water: c.log?.water ?? [], fert: c.log?.fert ?? [], rats,
  };
```

**lib/game/farm/crop.ts — edit 3 of 8.** Replace:

```ts

export interface YieldFactors { kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number }
```

with:

```ts

export interface YieldFactors { kg: number; mcare: number; mseed: number; mwater: number; mpest: number; mlate: number; mrat: number }
```

**lib/game/farm/crop.ts — edit 4 of 8.** Replace:

```ts
  v: Variety, land: number, qT: number, qH: number, care: Care, lateSow: number, oldSeedlings: number, offHours: number,
  pestH: readonly number[], lateHarvest: number,
): YieldFactors {
```

with:

```ts
  v: Variety, land: number, qT: number, qH: number, care: Care, lateSow: number, oldSeedlings: number, offHours: number,
  pestH: readonly number[], lateHarvest: number, ratH: number,
): YieldFactors {
```

**lib/game/farm/crop.ts — edit 5 of 8.** Replace:

```ts
  const mlate = 1 - Math.min(0.6, 0.02 * Math.max(0, lateHarvest));
  const x = v.baseKg * land * mcare * mseed * mwater * mpest * mlate * qT * qH;
  return { kg: Math.max(Math.ceil(v.baseKg / 10), Math.floor(x + 0.5)), mcare, mseed, mwater, mpest, mlate };
}

/** The harvest at `now` (§8.6) — what the server pays out. `pests` are the revealed ones, in slot order. */
export function cropYield(c: CropModel, v: Variety, land: number, qH: number, pests: readonly PestView[], now: number): YieldFactors {
```

with:

```ts
  const mlate = 1 - Math.min(0.6, 0.02 * Math.max(0, lateHarvest));
  const mrat = ratFactor(ratH);
  const x = v.baseKg * land * mcare * mseed * mwater * mpest * mlate * qT * qH * mrat;
  return { kg: Math.max(Math.ceil(v.baseKg / 10), Math.floor(x + 0.5)), mcare, mseed, mwater, mpest, mlate, mrat };
}

/** The harvest at `now` (§8.6) — what the server pays out. `pests` are the revealed ones, in slot order; the rats'
 *  share (v17 Mrat) is the last factor. */
export function cropYield(c: CropModel, v: Variety, land: number, qH: number, pests: readonly PestView[], now: number): YieldFactors {
```

**lib/game/farm/crop.ts — edit 6 of 8.** Replace:

```ts
    waterOffHours(c, v, now), pests.map((p) => pestHours(c, p, now)), hrs(transplant, now) - (48 * s + 12),
  );
```

with:

```ts
    waterOffHours(c, v, now), pests.map((p) => pestHours(c, p, now)), hrs(transplant, now) - (48 * s + 12),
    ratHours(c.rats ?? [], now),
  );
```

**lib/game/farm/crop.ts — edit 7 of 8.** Replace:

```ts
 *  fertilizers before transplanting, the top-dresses until their windows close, phơi ruộng until T = 18·s — with
 *  the care, water, pests and delays so far. Hidden pests cannot be counted. */
export function yieldEstimate(c: CropModel, v: Variety, land: number, pests: readonly PestView[], now: number): YieldFactors {
```

with:

```ts
 *  fertilizers before transplanting, the top-dresses until their windows close, phơi ruộng until T = 18·s — with
 *  the care, water, pests, rats and delays so far. Hidden pests and future rats cannot be counted. */
export function yieldEstimate(c: CropModel, v: Variety, land: number, pests: readonly PestView[], now: number): YieldFactors {
```

**lib/game/farm/crop.ts — edit 8 of 8.** Replace:

```ts
  return factors(v, land, c.qTransplant, 1, hopeful, lateSow, old, waterOffHours(c, v, now),
    pests.map((p) => pestHours(c, p, now)), lateHarvest);
}
```

with:

```ts
  return factors(v, land, c.qTransplant, 1, hopeful, lateSow, old, waterOffHours(c, v, now),
    pests.map((p) => pestHours(c, p, now)), lateHarvest, ratHours(c.rats ?? [], now));
}
```

Create `lib/game/farm/rats.ts` with exactly:

```ts
import { nextRandom } from "../fishing/reel";
import type { Rect } from "../maps/types";
import type { Vec } from "../types";

// v17 "Mùa chuột" (spec §5): the rats on the client. The server spawns them, judges which plots they eat, and prices and
// counts every catch; the client mirrors the damage (ratHours and ratFactor are 0019's _rat_hours and _rat_factor, the
// same operations in the same order, pinned by the shared fixtures), draws each rat from its seed the same way on every
// client (ratPos) and reads the field's rats (parseRats). Pure.

export const RAT = {
  /** Mrat = 1 − min(lossCap, rate · rat-hours) (D6). */
  rate: 0.02,
  lossCap: 0.1,
  /** A rat pays floor(basePrice × M) at the catch (D11); the client only shows the server's price. */
  basePrice: 150,
  /** At most this many alive on a field (D2). */
  aliveCap: 3,
  /** Catches per account: an hourly window and a Vietnam day, slingshot and dog together (D13). */
  hourCap: 6,
  dayCap: 24,
  /** A catch or a flight is listed in `recent` this long. */
  recentMs: 10_000,
  /** How fast a rat runs on the field, px/s (§5.4). */
  speed: 48,
  /** The plot rect is inset this much for a rat's legs. */
  inset: 8,
  /** Each leg lasts 6 s: a run of at most 1.5 s to its point, then nibbling. */
  legMs: 6000,
  runMaxMs: 1500,
  /** Leg i's point comes from mulberry32(seed + legStep · i). */
  legStep: 7919,
  /** A fleeing rat runs back to its hole in 1.5 s. */
  fleeMs: 1500,
} as const;

/** A rat's stay on a crop (the crop's rat_log): from the sweep that found it until it was caught or fled. */
export interface RatLogEntry { r: number; from: number; to: number | null }

/** A rat on the field: its plot, when it came out of its hole (its path starts there) and its path's seed. */
export interface RatLive { id: number; plot: number; since: number; seed: number }

export type RatEnd = "sling" | "dog" | "fled";

/** A rat that ended in the last 10 s: how, by whom (a catch) and, for a pounce, the catcher's dog's name. */
export interface RatRecent extends RatLive {
  endedAt: number;
  how: RatEnd;
  by: { id: string; name: string } | null;
  dog: string | null;
}

/** The field's rats (§10.5). */
export interface FieldRats {
  /** When the next spawn candidate is due: the client refetches then, in rat season (§11). */
  nextAt: number;
  /** What a catch fetches now, floor(150 × M) — shown, never computed. */
  price: number;
  live: RatLive[];
  recent: RatRecent[];
  /** The rat logs of the plots that have one. */
  plots: Record<number, RatLogEntry[]>;
}

/** The rats in the account's bag: how many, and what cô Út pays for them together (their prices fixed at the catch). */
export interface RatBag { count: number; value: number }

/** What the catch caps leave (D13): this hour's window (null = no window open) and the Vietnam day. */
export interface RatCaps { hourLeft: number; hourResetsAt: number | null; dayLeft: number }

export const EMPTY_BAG: RatBag = { count: 0, value: 0 };
export const FULL_CAPS: RatCaps = { hourLeft: RAT.hourCap, hourResetsAt: null, dayLeft: RAT.dayCap };

/** Rat-hours of a crop's log at t: each entry that opened before t counts until it closed, or until t (§5.5). */
export function ratHours(log: readonly RatLogEntry[], t: number): number {
  let h = 0;
  for (const e of log) if (e.from < t) h += (Math.min(e.to ?? t, t) - e.from) / 3_600_000;
  return h;
}

/** Mrat: the share of the harvest the rats leave, the last factor of the yield (§5.5). */
export function ratFactor(h: number): number {
  return 1 - Math.min(RAT.lossCap, RAT.rate * h);
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const ENDS: readonly string[] = ["sling", "dog", "fled"];

function parseLive(v: unknown): RatLive | null {
  const o = obj(v);
  const since = time(o.since);
  if (typeof o.id !== "number" || since === null) return null;
  return { id: o.id, plot: num(o.plot), since, seed: num(o.seed) };
}

function parseLog(v: unknown): RatLogEntry[] {
  return (Array.isArray(v) ? v : []).map(obj).flatMap((e): RatLogEntry[] => {
    const from = time(e.from);
    return typeof e.r === "number" && from !== null ? [{ r: e.r, from, to: time(e.to) }] : [];
  });
}

/** The `rats` of a field_state answer; null for an answer from before 0019. */
export function parseRats(v: unknown): FieldRats | null {
  const o = obj(v);
  const nextAt = time(o.next_at);
  if (nextAt === null) return null;
  const plots: Record<number, RatLogEntry[]> = {};
  for (const [k, log] of Object.entries(obj(o.plots))) {
    const n = Number(k), entries = parseLog(log);
    if (Number.isInteger(n) && n >= 1 && n <= 10 && entries.length > 0) plots[n] = entries;
  }
  return {
    nextAt,
    price: num(o.price),
    live: (Array.isArray(o.live) ? o.live : []).map(parseLive).filter((r): r is RatLive => r !== null),
    recent: (Array.isArray(o.recent) ? o.recent : []).flatMap((x): RatRecent[] => {
      const r = parseLive(x), e = obj(x), endedAt = time(e.ended_at), by = obj(e.by);
      if (!r || endedAt === null || !ENDS.includes(String(e.how))) return [];
      return [{
        ...r, endedAt, how: e.how as RatEnd,
        by: typeof by.id === "string" ? { id: by.id, name: typeof by.name === "string" ? by.name : "" } : null,
        dog: typeof e.dog === "string" ? e.dog : null,
      }];
    }),
    plots,
  };
}

/** mine.rats; an answer without it holds none. */
export function parseRatBag(v: unknown): RatBag {
  const o = obj(v);
  return { count: num(o.count), value: num(o.value) };
}

/** mine.rat_caps; an answer without it leaves the caps full. */
export function parseRatCaps(v: unknown): RatCaps {
  if (!v || typeof v !== "object") return FULL_CAPS;
  const o = v as Record<string, unknown>;
  return { hourLeft: num(o.hour_left, RAT.hourCap), hourResetsAt: time(o.hour_resets_at), dayLeft: num(o.day_left, RAT.dayCap) };
}

/** Where a rat is drawn: its point, which way it faces (1 right, −1 left) and whether it runs or nibbles. */
export interface RatPose { x: number; y: number; dir: 1 | -1; moving: boolean }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const dist = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y);

function inset(r: Rect): Rect {
  return { x: r.x + RAT.inset, y: r.y + RAT.inset, w: r.w - 2 * RAT.inset, h: r.h - 2 * RAT.inset };
}

/** Leg i's point: the first two draws of mulberry32(seed + 7 919 · i), across the inset plot. */
function legPoint(seed: number, i: number, r: Rect): Vec {
  const [a, s] = nextRandom(seed + RAT.legStep * i);
  const [b] = nextRandom(s);
  return { x: r.x + a * r.w, y: r.y + b * r.h };
}

function between(from: Vec, to: Vec, f: number): RatPose {
  return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f, dir: to.x < from.x ? -1 : 1, moving: true };
}

/** Where a rat is at t (§5.4), the same on every client: out of its hole at `since`, it runs at 48 px/s to E, the point
 *  of the inset plot nearest the hole; then leg i (6 s each) runs from the last point to P(i) in min(1.5 s, distance /
 *  48), and nibbles there. O(1). Null before it comes out. */
export function ratPos(seed: number, since: number, hole: Vec, plot: Rect, t: number): RatPose | null {
  const dt = t - since;
  if (dt < 0) return null;
  const r = inset(plot);
  const e = { x: clamp(hole.x, r.x, r.x + r.w), y: clamp(hole.y, r.y, r.y + r.h) };
  const entry = (dist(hole, e) / RAT.speed) * 1000;
  if (dt < entry) return between(hole, e, dt / entry);
  const after = dt - entry, i = Math.floor(after / RAT.legMs), u = after - i * RAT.legMs;
  const from = i === 0 ? e : legPoint(seed, i - 1, r), to = legPoint(seed, i, r);
  const run = Math.min(RAT.runMaxMs, (dist(from, to) / RAT.speed) * 1000);
  if (u < run) return between(from, to, u / run);
  return { x: to.x, y: to.y, dir: to.x < from.x ? -1 : 1, moving: false };
}

/** A fled rat (§5.4): from where it was at its end, it runs back to its hole in 1.5 s; null once it is in. */
export function ratFleePos(seed: number, since: number, endedAt: number, hole: Vec, plot: Rect, t: number): RatPose | null {
  const f = (t - endedAt) / RAT.fleeMs;
  if (f >= 1) return null;
  const at = ratPos(seed, since, hole, plot, endedAt) ?? { x: hole.x, y: hole.y };
  return between(at, hole, Math.max(0, f));
}
```

**lib/game/farm/upland.ts — edit 1 of 9.** Replace:

```ts
import { hrs, plusH, SAMPLE_MS, waterAt } from "./crop";
import type { CropView, HarvestEntry, ItemEntry, PestKind, PestView, WaterEntry, WorkEntry } from "./state";
```

with:

```ts
import { hrs, plusH, SAMPLE_MS, waterAt } from "./crop";
import { ratFactor, ratHours, type RatLogEntry } from "./rats";
import type { CropView, HarvestEntry, ItemEntry, PestKind, PestView, WaterEntry, WorkEntry } from "./state";
```

**lib/game/farm/upland.ts — edit 2 of 9.** Replace:

```ts
  harvests: readonly HarvestEntry[];
}
```

with:

```ts
  harvests: readonly HarvestEntry[];
  /** v17: the rats that ate it (the field's rats.plots); none before 0019. */
  rats?: readonly RatLogEntry[];
}
```

**lib/game/farm/upland.ts — edit 3 of 9.** Replace:

```ts

/** The model of a crop on beds as field_state shows it (the logs are there for its farmer only). */
export function uplandModel(c: CropView): UplandModel {
  return {
    sowAt: c.sowAt, plantAt: c.plantAt, water: c.log?.water ?? [], fert: c.log?.fert ?? [], work: c.log?.work ?? [],
    spray: c.log?.spray ?? [], harvests: c.log?.harvests ?? [],
  };
```

with:

```ts

/** The model of a crop on beds as field_state shows it (the logs are there for its farmer only), with its plot's rat
 *  log. */
export function uplandModel(c: CropView, rats: readonly RatLogEntry[] = []): UplandModel {
  return {
    sowAt: c.sowAt, plantAt: c.plantAt, water: c.log?.water ?? [], fert: c.log?.fert ?? [], work: c.log?.work ?? [],
    spray: c.log?.spray ?? [], harvests: c.log?.harvests ?? [], rats,
  };
```

**lib/game/farm/upland.ts — edit 4 of 9.** Replace:

```ts

export interface UplandYield { kg: number; mcare: number; mplant: number; mwater: number; mrot: number; mpest: number; mlate: number }
```

with:

```ts

export interface UplandYield { kg: number; mcare: number; mplant: number; mwater: number; mrot: number; mpest: number; mlate: number; mrat: number }
```

**lib/game/farm/upland.ts — edit 5 of 9.** Replace:

```ts
function yieldOf(u: UplandCrop, land: number, k: number, mcare: number, mplant: number, offHours: number, rotHours: number,
  pests: readonly PestView[], late: number, now: number): UplandYield {
  const mwater = 1 - Math.min(0.2, 0.01 * offHours);
```

with:

```ts
function yieldOf(u: UplandCrop, land: number, k: number, mcare: number, mplant: number, offHours: number, rotHours: number,
  pests: readonly PestView[], late: number, ratH: number, now: number): UplandYield {
  const mwater = 1 - Math.min(0.2, 0.01 * offHours);
```

**lib/game/farm/upland.ts — edit 6 of 9.** Replace:

```ts
  const mlate = 1 - Math.min(0.6, u.overRate * Math.max(0, late));
  const pct = u.pickings[k - 1] ?? 0;
  const x = ((((((((u.baseKg * land) * mcare) * mplant) * mwater) * mrot) * mpest) * mlate) * pct) / 100;
  return { kg: Math.max(Math.ceil((u.baseKg * pct) / 1000), Math.floor(x + 0.5)), mcare, mplant, mwater, mrot, mpest, mlate };
}

/** Picking k at `now` (§8.7) — what the server pays out. `pests` are the revealed ones, in slot order. */
export function upYield(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
```

with:

```ts
  const mlate = 1 - Math.min(0.6, u.overRate * Math.max(0, late));
  const mrat = ratFactor(ratH);
  const pct = u.pickings[k - 1] ?? 0;
  const x = (((((((((u.baseKg * land) * mcare) * mplant) * mwater) * mrot) * mpest) * mlate) * mrat) * pct) / 100;
  return { kg: Math.max(Math.ceil((u.baseKg * pct) / 1000), Math.floor(x + 0.5)), mcare, mplant, mwater, mrot, mpest, mlate, mrat };
}

/** Picking k at `now` (§8.7) — what the server pays out. `pests` are the revealed ones, in slot order; the rats'
 *  share (v17 Mrat) comes right after Mlate. */
export function upYield(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
```

**lib/game/farm/upland.ts — edit 7 of 9.** Replace:

```ts
  return yieldOf(u, land, k, upMcare(upCare(c, u)), mplantOf(u, c.sowAt, c.plantAt), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), now);
}
```

with:

```ts
  return yieldOf(u, land, k, upMcare(upCare(c, u)), mplantOf(u, c.sowAt, c.plantAt), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), ratHours(c.rats ?? [], now), now);
}
```

**lib/game/farm/upland.ts — edit 8 of 9.** Replace:

```ts
 *  until P, each care until its on-time window closes, the ớt transplant now — with the water, rot, pests and delays so
 *  far. Hidden pests cannot be counted. */
export function upEstimate(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
```

with:

```ts
 *  until P, each care until its on-time window closes, the ớt transplant now — with the water, rot, pests and delays so
 *  far. Hidden pests and future rats cannot be counted. */
export function upEstimate(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
```

**lib/game/farm/upland.ts — edit 9 of 9.** Replace:

```ts
  return yieldOf(u, land, k, upMcare(hopeful), mplantOf(u, c.sowAt, c.plantAt ?? now), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), now);
}
```

with:

```ts
  return yieldOf(u, land, k, upMcare(hopeful), mplantOf(u, c.sowAt, c.plantAt ?? now), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), ratHours(c.rats ?? [], now), now);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (28 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/crop.ts lib/game/farm/rats.ts lib/game/farm/upland.ts tests/unit/farm-rats.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the rat model on the client — Mrat, the rats' paths and the field's rats

lib/game/farm/rats.ts mirrors 0019's damage (ratHours and ratFactor, the same
operations in the same order), draws a rat from its seed the same way on every client
(ratPos: out of its hole to the nearest point of the inset plot at 48 px/s, then 6 s
legs; ratFleePos back to the hole in 1.5 s) and reads the field's rats, the bag and
the caps. cropYield, yieldEstimate, upYield and upEstimate take the plot's rat log
through the crop models and multiply by Mrat as the last factor (rice) or right after
Mlate (hoa màu), counting no future rats. The shared fixtures' rat cases pin both.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/crop.ts lib/game/farm/rats.ts lib/game/farm/upland.ts tests/unit/farm-rats.test.ts
git commit -F <message file>
```

---

### Task 6: The dog's rules and its follower

**Files:**
- Create: `lib/game/dog.ts`
- Test: `tests/unit/game-dog.test.ts` (create)

**Interfaces:**
- Consumes: `lib/game/movement.ts`' `facingForVector`, `lib/game/types.ts`' `Facing`, `Vec`.
- Produces (`lib/game/dog.ts`, §7.1–§7.3):
  - `DogCoat`, `DOG_COATS`, `COAT_NAME`, `isCoat`, `DOG` (price 20 000, name 2–16, `foodMs` 24 h, `fullMs` 12 h, `restMs` 5 min, `huntRadius` 96, `activeMs` 3 min, `refusalPauseMs` 10 s, the follower's and the pounce's numbers, `petEveryMs` 3 s, `petMs` 2.5 s);
  - `DogView {name, coat, adoptedAt, fedUntil, nextHuntAt, catches}`, `DogAnswer {serverNow, dog, food, coins}`, `parseDog`, `parseDogAnswer`;
  - `normalizeDogName`, `DogNameProblem` (`length` | `hidden` | `reserved`), `dogNameRefusal(raw)` (0019's `_pet_name`); `DogStatus`, `dogStatus(d, now)`, `feedRefusal(d, food, now)` (`full`, then `no_food`);
  - the follower: `HEEL`, `FRONT`, `heelSpot`, `frontSpot`, `DogMode`, `DogPose`, `Follower`, `newFollower`, `stepFollower(f, owner, now, blocked)`, `pounce(f, at)`, `recall(f)`, `pet(f, now)`, `followerPose(f, now, hungry)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-dog.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import {
  COAT_NAME, DOG, DOG_COATS, dogNameRefusal, dogStatus, feedRefusal, followerPose, frontSpot, heelSpot, newFollower, normalizeDogName,
  parseDog, parseDogAnswer, pet, pounce, recall, stepFollower, type DogView, type Follower,
} from "@/lib/game/dog";
import type { Facing } from "@/lib/game/types";

const H = 3_600_000;
const free = () => false;

describe("the coats and the dog from the server (§7.1, §10.3)", () => {
  it("has four coats with their names", () => {
    expect(DOG_COATS).toEqual(["vang", "muc", "ven", "dom"]);
    expect(DOG_COATS.map((c) => COAT_NAME[c])).toEqual(["Vàng", "Mực", "Vện", "Đốm"]);
    expect(DOG.price).toBe(20_000);
  });
  it("parses a dog and a dog call's answer", () => {
    const raw = { name: "Mực", coat: "muc", adopted_at: "2026-09-26T01:00:00Z", fed_until: "2026-09-27T01:00:00Z", next_hunt_at: null, catches: 12 };
    const dog: DogView = {
      name: "Mực", coat: "muc", adoptedAt: Date.parse("2026-09-26T01:00:00Z"), fedUntil: Date.parse("2026-09-27T01:00:00Z"),
      nextHuntAt: null, catches: 12,
    };
    expect(parseDog(raw)).toEqual(dog);
    expect(parseDog(null)).toBeNull();
    expect(parseDog({ ...raw, coat: "xam" })).toBeNull();
    expect(parseDogAnswer({ server_now: "2026-09-26T02:00:00Z", dog: raw, food: 3, coins: 1500 }))
      .toEqual({ serverNow: Date.parse("2026-09-26T02:00:00Z"), dog, food: 3, coins: 1500 });
    expect(parseDogAnswer({ server_now: "2026-09-26T02:00:00Z", dog: null, food: 0, coins: 0 })?.dog).toBeNull();
    expect(parseDogAnswer({ dog: raw })).toBeNull();
  });
});

describe("the dog's name (the names the SQL smoke refuses and accepts)", () => {
  it("accepts 2–16 characters, stored NFC with single spaces", () => {
    expect(dogNameRefusal("Mực")).toBeNull();
    expect(dogNameRefusal("Ki")).toBeNull();
    expect(dogNameRefusal("  Ki   Ki  ")).toBeNull();
    expect(normalizeDogName("  Ki   Ki  ")).toBe("Ki Ki");
    expect(dogNameRefusal("Vàng Vện Đốm 16c")).toBeNull();
    expect(dogNameRefusal("Mu\u0301c")).toBeNull();
    expect(normalizeDogName("Mu\u0301c")).toBe("Múc");
  });
  it("refuses a name of 1 or 17 characters", () => {
    expect(dogNameRefusal("M")).toBe("length");
    expect(dogNameRefusal("Mười bảy ký tự nè")).toBe("length");
    expect(dogNameRefusal("")).toBe("length");
    expect(dogNameRefusal("   ")).toBe("length");
  });
  it("refuses hidden characters", () => {
    expect(dogNameRefusal("\u200b\u200b")).toBe("hidden");
    expect(dogNameRefusal("Ki\u200bki")).toBe("hidden");
    expect(dogNameRefusal("Ki\u00a0ki")).toBe("hidden");
    expect(dogNameRefusal("\tKiki")).toBe("hidden");
    expect(dogNameRefusal("Ki\u{e0041}ki")).toBe("hidden");
  });
  it("refuses the reserved names, however they are written", () => {
    expect(dogNameRefusal("Ao cá")).toBe("reserved");
    expect(dogNameRefusal("Hợp  tác  xã")).toBe("reserved");
    expect(dogNameRefusal("admin")).toBe("reserved");
    expect(dogNameRefusal("Hệ-thống")).toBe("reserved");
    expect(dogNameRefusal("Quản trị viên")).toBe("reserved");
  });
});

describe("food and the hunt (D17–D19)", () => {
  const now = Date.parse("2026-09-26T10:00:00Z");
  const dog = (fed: number | null, next: number | null): DogView => ({
    name: "Mực", coat: "muc", adoptedAt: now - 48 * H, fedUntil: fed, nextHuntAt: next, catches: 0,
  });
  it("dogStatus: fed and ready, resting, hungry", () => {
    expect(dogStatus(dog(now + 18 * H, null), now)).toEqual({ fed: true, foodLeftMs: 18 * H, hunt: "ready", restLeftMs: 0 });
    expect(dogStatus(dog(now + H, now + 192_000), now)).toEqual({ fed: true, foodLeftMs: H, hunt: "resting", restLeftMs: 192_000 });
    expect(dogStatus(dog(now, now + 192_000), now)).toMatchObject({ fed: false, hunt: "hungry" });
    expect(dogStatus(dog(null, null), now)).toMatchObject({ fed: false, foodLeftMs: 0, hunt: "hungry" });
  });
  it("feedRefusal: full above 12 h, then no food", () => {
    expect(feedRefusal(dog(now + 12 * H + 1000, null), 3, now)).toBe("full");
    expect(feedRefusal(dog(now + 12 * H, null), 3, now)).toBeNull();
    expect(feedRefusal(dog(now + 12 * H + 1000, null), 0, now)).toBe("full");
    expect(feedRefusal(dog(now - H, null), 0, now)).toBe("no_food");
    expect(feedRefusal(dog(null, null), 1, now)).toBeNull();
  });
});

describe("the follower (§7.3)", () => {
  const walls = (bad: Array<[number, number]>) => (x: number, y: number) => bad.some(([bx, by]) => bx === x && by === y);
  const run = (f: Follower, o: { x: number; y: number; facing: Facing }, from: number, to: number, blocked = free) => {
    let g = f;
    for (let t = from; t <= to; t += 16) g = stepFollower(g, o, t, blocked);
    return g;
  };

  it("sits at the heel spot, or its mirror when that side is blocked, or on the owner", () => {
    const o = { x: 100, y: 100 };
    expect(heelSpot(o, "down", free)).toEqual({ x: 110, y: 98 });
    expect(heelSpot(o, "up", free)).toEqual({ x: 90, y: 102 });
    expect(heelSpot(o, "left", free)).toEqual({ x: 108, y: 103 });
    expect(heelSpot(o, "right", free)).toEqual({ x: 92, y: 103 });
    expect(heelSpot(o, "down", walls([[110, 98]]))).toEqual({ x: 90, y: 98 });
    expect(heelSpot(o, "down", walls([[110, 98], [90, 98]]))).toEqual({ x: 100, y: 100 });
    expect(frontSpot(o, "down", free)).toEqual({ x: 100, y: 109 });
    const f = newFollower(o, "left", 0, free);
    expect([f.x, f.y, f.mode]).toEqual([108, 103, "follow"]);
    const g = run(f, { ...o, facing: "down" }, 16, 1000);
    expect([g.x, g.y]).toEqual([110, 98]);
  });
  it("follows where the owner was 450 ms ago while the owner walks, at up to 84 px/s", () => {
    let f = newFollower({ x: 100, y: 100 }, "right", 0, free);
    let x = 100;
    for (let t = 16; t <= 3000; t += 16) {
      x += (70 * 16) / 1000;
      f = stepFollower(f, { x, y: 100, facing: "right" }, t, free);
    }
    // 70 px/s × 0.45 s behind the owner
    expect(x - f.x).toBeGreaterThan(29);
    expect(x - f.x).toBeLessThan(34);
    expect(f.y).toBeCloseTo(100, 6);
    expect(f.moving).toBe(true);
    expect(f.facing).toBe("right");
    const slow = stepFollower({ ...f, x: f.x - 40 }, { x: x + 1, y: 100, facing: "right" }, f.at + 16, free);
    expect(slow.x - (f.x - 40)).toBeCloseTo((84 * 16) / 1000, 6);
  });
  it("snaps beyond 64 px (a portal, a restore)", () => {
    const f = run(newFollower({ x: 100, y: 100 }, "down", 0, free), { x: 100, y: 100, facing: "down" }, 16, 1000);
    const far = run(f, { x: 400, y: 300, facing: "down" }, 1016, 1600);
    expect([far.x, far.y]).toEqual([410, 298]);
  });
  it("stands, then sits 3 s after it stopped; its owner's hungry dog droops", () => {
    const f = run(newFollower({ x: 100, y: 100 }, "down", 0, free), { x: 100, y: 100, facing: "down" }, 16, 500);
    expect(followerPose(f, 500)).toBe("idle");
    expect(followerPose(f, 2999)).toBe("idle");
    expect(followerPose(f, 3000)).toBe("sit");
    expect(followerPose(f, 3000, true)).toBe("hungry");
    const moved = stepFollower(f, { x: 130, y: 100, facing: "right" }, 516, free);
    expect(followerPose(moved, 516)).toBe("walk");
  });
  it("pounces at 120 px/s, leaps 350 ms, carries the rat back to the heel; a recall ends it", () => {
    const o = { x: 100, y: 100, facing: "down" as Facing };
    const f0 = run(newFollower(o, "down", 0, free), o, 16, 500);
    let f = pounce(f0, { x: 170, y: 98 });
    f = stepFollower(f, o, f0.at + 16, free);
    expect(f.x - f0.x).toBeCloseTo((120 * 16) / 1000, 6);
    expect(followerPose(f, f.at)).toBe("run");
    for (let t = f.at + 16; t <= 1100 && f.mode === "pounce"; t += 16) f = stepFollower(f, o, t, free);
    expect(f.mode).toBe("leap");
    expect([f.x, f.y]).toEqual([170, 98]);
    const leapEnds = f.until;
    expect(followerPose(f, leapEnds - 1)).toBe("leap");
    f = stepFollower(f, o, leapEnds, free);
    expect(f.mode).toBe("carry");
    expect(followerPose(f, leapEnds)).toBe("carry");
    f = run(f, o, leapEnds + 16, leapEnds + 2000);
    expect(f.mode).toBe("follow");
    expect([f.x, f.y]).toEqual([110, 98]);
    const back = recall(pounce(f0, { x: 170, y: 98 }));
    expect(back.mode).toBe("follow");
    expect(back.goal).toBeNull();
  });
  it("a pet brings it to its owner's front for 2.5 s, wagging", () => {
    const o = { x: 100, y: 100, facing: "down" as Facing };
    let f = pet(run(newFollower(o, "down", 0, free), o, 16, 500), 500);
    f = run(f, o, 516, 1500);
    expect([f.x, f.y]).toEqual([100, 109]);
    expect(followerPose(f, 1500)).toBe("wag");
    f = run(f, o, 1516, 3200);
    expect(f.mode).toBe("follow");
    expect([f.x, f.y]).toEqual([110, 98]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-dog.test.ts`
Expected: FAIL — `game-dog.test.ts` cannot load `@/lib/game/dog`; 1 file fails, no tests run.

- [ ] **Step 3: Implement**

Create `lib/game/dog.ts` with exactly:

```ts
import { facingForVector } from "./movement";
import type { Facing, Vec } from "./types";

// v17 (spec §7): the dog (chó cỏ). Its coats, its state from the server and the rules the UI shows (dogNameRefusal
// mirrors 0019's _pet_name, dogStatus and feedRefusal its dog calls), and the follower that walks it behind its owner
// on every client from the owner's drawn positions — no messages (C8, D24). Pure.

export type DogCoat = "vang" | "muc" | "ven" | "dom";
/** Chosen at adoption and fixed (D21): vàng, mực, vện, đốm. */
export const DOG_COATS: readonly DogCoat[] = ["vang", "muc", "ven", "dom"];
export const COAT_NAME: Record<DogCoat, string> = { vang: "Vàng", muc: "Mực", ven: "Vện", dom: "Đốm" };

const HOUR = 3_600_000;

export const DOG = {
  price: 20_000,
  nameMin: 2,
  nameMax: 16,
  /** A bịch feeds 24 h (D19); the dog refuses food while more than 12 h remain. */
  foodMs: 24 * HOUR,
  fullMs: 12 * HOUR,
  /** 5 minutes' rest after a catch (D18). */
  restMs: 5 * 60_000,
  /** The auto-hunt (D17, D30): a rat within 96 px of the owner, input within 3 minutes, 10 s quiet after a refusal. */
  huntRadius: 96,
  activeMs: 3 * 60_000,
  refusalPauseMs: 10_000,
  /** The follower (§7.3). */
  trailMs: 1000,
  lagMs: 450,
  moveGraceMs: 300,
  followSpeed: 84,
  snapDist: 64,
  sitAfterMs: 3000,
  /** The pounce: a run at 120 px/s, a 350 ms leap, then the carry back. */
  pounceSpeed: 120,
  leapMs: 350,
  /** Petting (D27): one every 3 s; the dog stays at its owner's front 2.5 s. */
  petEveryMs: 3000,
  petMs: 2500,
} as const;

export const isCoat = (v: unknown): v is DogCoat => typeof v === "string" && (DOG_COATS as readonly string[]).includes(v);

/** The account's dog as the server shows it (§10.3). */
export interface DogView {
  name: string;
  coat: DogCoat;
  adoptedAt: number;
  fedUntil: number | null;
  nextHuntAt: number | null;
  catches: number;
}

/** What the dog calls answer (§10.4): the dog, the food_dog count and the wallet. */
export interface DogAnswer { serverNow: number; dog: DogView | null; food: number; coins: number }

const time = (v: unknown): number | null => {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** A dog from the server; null for none (or anything that is not one). */
export function parseDog(v: unknown): DogView | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const adoptedAt = time(o.adopted_at);
  if (typeof o.name !== "string" || !isCoat(o.coat) || adoptedAt === null) return null;
  return { name: o.name, coat: o.coat, adoptedAt, fedUntil: time(o.fed_until), nextHuntAt: time(o.next_hunt_at), catches: num(o.catches) };
}

/** A dog call's answer; null when it is not one. */
export function parseDogAnswer(v: unknown): DogAnswer | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const serverNow = time(o.server_now);
  if (serverNow === null) return null;
  return { serverNow, dog: parseDog(o.dog), food: num(o.food), coins: num(o.coins) };
}

// The name (§7.1, D20): register's rules with 2–16 characters. The same classes as 0015's register regex: control,
// odd-space, invisible and combining characters.
const HIDDEN: ReadonlyArray<readonly [number, number]> = [
  [0x0001, 0x001f], [0x007f, 0x009f], [0x00a0, 0x00a0], [0x00ad, 0x00ad], [0x0300, 0x036f], [0x034f, 0x034f], [0x061c, 0x061c],
  [0x115f, 0x1160], [0x1680, 0x1680], [0x17b4, 0x17b5], [0x180b, 0x180f], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x2000, 0x200f],
  [0x2028, 0x202f], [0x205f, 0x206f], [0x20d0, 0x20ff], [0x3000, 0x3000], [0x3164, 0x3164], [0xfe00, 0xfe0f], [0xfe20, 0xfe2f],
  [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xffff], [0xe0000, 0xe0fff],
];
const RESERVED: readonly string[] = ["aoca", "hoptacxa", "hethong", "quantri", "quantrivien", "admin", "root", "system"];

/** The name as the server stores it: NFC, spaces trimmed, runs of spaces made one. */
export function normalizeDogName(raw: string): string {
  return raw.normalize("NFC").replace(/^ +| +$/g, "").replace(/ {2,}/g, " ");
}

/** The key reserved names are compared on (0015's _name_key): no accents, nothing but a–z and 0–9. */
function nameKey(v: string): string {
  return v.normalize("NFC").toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, "");
}

export type DogNameProblem = "length" | "hidden" | "reserved";

/** Why the server would refuse this name ('invalid name'), or null: 2–16 characters (code points), no hidden character,
 *  no reserved name. A hint for the UI; the server decides. */
export function dogNameRefusal(raw: string): DogNameProblem | null {
  const v = normalizeDogName(raw);
  const chars = [...v];
  if (chars.length < DOG.nameMin || chars.length > DOG.nameMax) return "length";
  if (chars.some((ch) => HIDDEN.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi))) return "hidden";
  if (RESERVED.includes(nameKey(v))) return "reserved";
  return null;
}

/** The dog's state at `now` (D17–D19): fed or hungry, and whether it can hunt. */
export interface DogStatus { fed: boolean; foodLeftMs: number; hunt: "ready" | "resting" | "hungry"; restLeftMs: number }

export function dogStatus(d: DogView, now: number): DogStatus {
  const foodLeftMs = Math.max(0, (d.fedUntil ?? 0) - now);
  const restLeftMs = Math.max(0, (d.nextHuntAt ?? 0) - now);
  const fed = foodLeftMs > 0;
  return { fed, foodLeftMs, hunt: !fed ? "hungry" : restLeftMs > 0 ? "resting" : "ready", restLeftMs };
}

/** Why a meal would be refused, in the server's order: 'dog full' above 12 h, then no food. */
export function feedRefusal(d: DogView, food: number, now: number): "full" | "no_food" | null {
  if (d.fedUntil !== null && d.fedUntil > now + DOG.fullMs) return "full";
  return food < 1 ? "no_food" : null;
}

// The follower (§7.3): one per walking actor with a dog, stepped every frame from its owner's drawn position.

/** The heel spot by facing: behind the owner, a little to the side. */
export const HEEL: Record<Facing, Vec> = { down: { x: 10, y: -2 }, up: { x: -10, y: 2 }, left: { x: 8, y: 3 }, right: { x: -8, y: 3 } };
/** In front of the owner, for petting. */
export const FRONT: Record<Facing, Vec> = { down: { x: 0, y: 9 }, up: { x: 0, y: -9 }, left: { x: -11, y: 1 }, right: { x: 11, y: 1 } };

type Blocked = (x: number, y: number) => boolean;

/** The first free of: the spot, its mirror across the owner, the owner's own position. */
function spotBy(o: Vec, off: Vec, blocked: Blocked): Vec {
  for (const p of [{ x: o.x + off.x, y: o.y + off.y }, { x: o.x - off.x, y: o.y + off.y }]) if (!blocked(p.x, p.y)) return p;
  return { x: o.x, y: o.y };
}

export const heelSpot = (o: Vec, facing: Facing, blocked: Blocked): Vec => spotBy(o, HEEL[facing], blocked);
export const frontSpot = (o: Vec, facing: Facing, blocked: Blocked): Vec => spotBy(o, FRONT[facing], blocked);

export type DogMode = "follow" | "pounce" | "leap" | "carry" | "pet";
export type DogPose = "walk" | "idle" | "sit" | "hungry" | "run" | "leap" | "carry" | "wag";

export interface Follower {
  x: number;
  y: number;
  facing: Facing;
  /** When it was last stepped. */
  at: number;
  /** The owner's drawn positions of the last second, oldest first. */
  trail: ReadonlyArray<{ t: number; x: number; y: number }>;
  ownerMovedAt: number;
  /** When the dog last stood still after moving (it sits 3 s later). */
  stillSince: number;
  moving: boolean;
  mode: DogMode;
  /** The pounce's point (the rat). */
  goal: Vec | null;
  /** When a leap or a pet ends. */
  until: number;
}

export function newFollower(o: Vec, facing: Facing, now: number, blocked: Blocked): Follower {
  const h = heelSpot(o, facing, blocked);
  return {
    x: h.x, y: h.y, facing, at: now, trail: [{ t: now, x: o.x, y: o.y }], ownerMovedAt: -Infinity, stillSince: now, moving: false,
    mode: "follow", goal: null, until: 0,
  };
}

/** The owner's position `t` ago: the latest one drawn at or before it, else the oldest kept. */
function lagged(trail: Follower["trail"], t: number): Vec {
  let p = trail[0];
  for (const q of trail) if (q.t <= t) p = q;
  return { x: p.x, y: p.y };
}

/** One frame (§7.3): while the owner moves (or moved in the last 0.3 s) the dog heads for where the owner was 450 ms
 *  ago, else for the heel spot; at up to 84 px/s, snapping beyond 64 px (portals, restores). A pounce runs to the rat at
 *  120 px/s, leaps 350 ms, then carries it back to the heel; a pet brings it to the owner's front for 2.5 s. */
export function stepFollower(f: Follower, o: { x: number; y: number; facing: Facing }, now: number, blocked: Blocked): Follower {
  const dt = Math.max(0, Math.min(0.1, (now - f.at) / 1000));
  const last = f.trail[f.trail.length - 1];
  const ownerMovedAt = !last || last.x !== o.x || last.y !== o.y ? now : f.ownerMovedAt;
  const trail = [...f.trail.filter((p) => p.t >= now - DOG.trailMs), { t: now, x: o.x, y: o.y }];
  let mode = f.mode, until = f.until;
  if (mode === "leap" && now >= until) mode = "carry";
  if (mode === "pet" && now >= until) mode = "follow";
  let target: Vec, speed: number = DOG.followSpeed;
  if (mode === "pounce" && f.goal) {
    target = f.goal;
    speed = DOG.pounceSpeed;
  } else if (mode === "leap") target = { x: f.x, y: f.y };
  else if (mode === "pet") target = frontSpot(o, o.facing, blocked);
  else if (mode === "carry" || now - ownerMovedAt > DOG.moveGraceMs) target = heelSpot(o, o.facing, blocked);
  else target = lagged(trail, now - DOG.lagMs);
  const dx = target.x - f.x, dy = target.y - f.y, d = Math.hypot(dx, dy);
  let x = f.x, y = f.y, moving = false;
  if (d > DOG.snapDist && (mode === "follow" || mode === "pet")) {
    x = target.x;
    y = target.y;
  } else if (d <= 0.5) {
    x = target.x;
    y = target.y;
  } else {
    const s = Math.min(d, speed * dt);
    x = s >= d ? target.x : x + (dx / d) * s;
    y = s >= d ? target.y : y + (dy / d) * s;
    moving = s > 0;
  }
  const arrived = Math.hypot(target.x - x, target.y - y) <= 0.5;
  if (arrived) {
    x = target.x;
    y = target.y;
  }
  if (mode === "pounce" && arrived) {
    mode = "leap";
    until = now + DOG.leapMs;
  } else if (mode === "carry" && arrived) mode = "follow";
  const facing = moving ? facingForVector({ x: dx, y: dy }, f.facing) : mode === "follow" ? o.facing : f.facing;
  return {
    x, y, facing, at: now, trail, ownerMovedAt, stillSince: moving || f.moving ? now : f.stillSince, moving,
    mode, goal: mode === "pounce" || mode === "leap" ? f.goal : null, until,
  };
}

/** The dog runs for a rat at `at` (its own pounce starts at the dog_hunt call; others' come from rats.recent). */
export function pounce(f: Follower, at: Vec): Follower {
  return { ...f, mode: "pounce", goal: { x: at.x, y: at.y } };
}

/** A refused pounce: the dog comes back. */
export function recall(f: Follower): Follower {
  return { ...f, mode: "follow", goal: null };
}

/** Petting (D27): to the owner's front for 2.5 s, wagging. */
export function pet(f: Follower, now: number): Follower {
  return { ...f, mode: "pet", goal: null, until: now + DOG.petMs };
}

/** How it is drawn: walking, standing, sitting 3 s after it stopped (drooping while hungry, for its owner's own dog),
 *  running, leaping, carrying or wagging. */
export function followerPose(f: Follower, now: number, hungry = false): DogPose {
  switch (f.mode) {
    case "pounce": return "run";
    case "leap": return "leap";
    case "carry": return "carry";
    case "pet": return f.moving ? "walk" : "wag";
    default:
      if (f.moving) return "walk";
      return now - f.stillSince >= DOG.sitAfterMs ? (hungry ? "hungry" : "sit") : "idle";
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (14 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/dog.ts tests/unit/game-dog.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the dog's rules and its follower

lib/game/dog.ts: the four coats (vàng, mực, vện, đốm), the dog and the dog calls'
answer from the server, dogNameRefusal (0019's _pet_name: 2–16 characters, no hidden
character, no reserved name), dogStatus (fed or hungry; ready, resting or hungry to
hunt) and feedRefusal (full above 12 h, then no food). The follower walks a dog behind
its owner from the owner's drawn positions: where the owner was 450 ms ago while
walking, else the heel spot (or its mirror, or the owner's spot, whichever is free), at
up to 84 px/s, snapping beyond 64 px; it sits 3 s after it stopped; a pounce runs at
120 px/s, leaps 350 ms and carries the rat back; a pet brings it to its owner's front.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/dog.ts tests/unit/game-dog.test.ts
git commit -F <message file>
```

---

### Task 7: The field's rats, the bag, the caps and the dog in the state; the new calls

**Files:**
- Create: `lib/game/farm/season.ts`
- Modify: `lib/game/farm/catalog.ts`, `lib/game/farm/rpc.ts`, `lib/game/farm/state.ts`
- Test: `tests/unit/farm-season.test.ts` (create); `tests/unit/anticheat-pins.test.tsx`, `tests/unit/farm-actions.test.ts`, `tests/unit/farm-catalog.test.ts`, `tests/unit/farm-gather.test.ts`, `tests/unit/farm-land.test.ts`, `tests/unit/farm-rpc.test.ts`, `tests/unit/farm-state.test.ts`, `tests/unit/fishing-panels.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`parseRats`, `parseRatBag`, `parseRatCaps`, `EMPTY_BAG`, `FULL_CAPS`), Task 6 (`parseDog`, `parseDogAnswer`, `DogAnswer`, `DogCoat`); `rpc.ts`' `call`, `fieldOf`, `mineAnswer`, `isNum` and v15.3's strict catch parsers (793f8b4); `crop.ts`' and `upland.ts`' phase models.
- Produces:
  - `catalog.ts`: `FarmItemKind` and `FARM_KINDS` with `ammo` and `pet_food`; `UplandCrop.ratFood` (from `rat_food`); `TOOL_SLING`, `AMMO_PELLET`, `FOOD_DOG`, `PELLET_STEP` (10); `describeFarmItem` for the three items (§8);
  - `state.ts`: `FarmMine.rats` (`RatBag`), `.ratCaps` (`RatCaps`) and `.dog` (`DogView | null`), `FieldState.rats` (`FieldRats | null`), kept by `withMine`;
  - `rpc.ts`: `RPCS_17` (the 8 v17 RPCs), `SlingAim`, `ShotAnswer`, `slingStart(roomId, token, rat)`, `slingShoot(roomId, token, rat, hit)`, `dogHunt(roomId, token, rat)` (→ `{state, price}`), `dogState`, `adoptDog`, `renameDog`, `feedDog` (→ `DogAnswer`), `sellRats(token)` (→ the account part and `sold {count, xu}`); an answer that is not whole throws (`bad shot answer`, `bad hunt answer`, `bad dog answer`, `bad sale answer`);
  - `lib/game/farm/season.ts`: `ratFoodAt(plot, catalog, t)` and `ratSeason(state, catalog, nextAt)` (§11);
  - the account part's test literals gain the new fields.

- [ ] **Step 1: Write the failing tests**

**tests/unit/anticheat-pins.test.tsx — edit 1 of 2.** Replace:

```tsx
      rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
    };
```

with:

```tsx
      rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
      rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
    };
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 2.** Replace:

```tsx
      items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3,
      gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
    };
```

with:

```tsx
      items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3,
      gather: { readyAt: {}, leftToday: 200, dayResetsAt: null }, rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
    };
```

**tests/unit/farm-actions.test.ts.** Replace:

```ts
  items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
});
```

with:

```ts
  items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
  rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
});
```

**tests/unit/farm-catalog.test.ts — edit 1 of 2.** Replace:

```ts
import {
  boxRow, critterFromRow, describeFarmItem, farmItemFromRow, harvesterPrice, producePrice, ricePrice, ripeAfterHours, uplandFromRow,
  uplandHours, varietyFromRow, type FarmItemRow, type UplandCropRow, type VarietyRow,
```

with:

```ts
import {
  boxRow, critterFromRow, describeFarmItem, FARM_KINDS, farmItemFromRow, harvesterPrice, producePrice, ricePrice, ripeAfterHours, uplandFromRow,
  uplandHours, varietyFromRow, type FarmItemRow, type UplandCropRow, type VarietyRow,
```

**tests/unit/farm-catalog.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("the slingshot, its pellets, the dog food and rat food (v17 §8, D4)", () => {
  it("sells the ná, the pellets and the dog food", () => {
    expect(FARM_KINDS).toEqual(["seed", "fertilizer", "pesticide", "critter_box", "tool", "ammo", "pet_food"]);
    expect(farmItemFromRow(item({ id: "ammo_pellet", kind: "ammo", name: "Đạn đất", price: 10 })).kind).toBe("ammo");
    expect(farmItemFromRow(item({ id: "food_dog", kind: "pet_food", name: "Thức ăn chó", price: 150 })).kind).toBe("pet_food");
    const d = (over: Partial<FarmItemRow>) => describeFarmItem(farmItemFromRow(item(over)), VARIETIES);
    expect(d({ id: "tool_sling", kind: "tool", price: 3000 })).toBe("Bắn chuột đồng — mua một lần");
    expect(d({ id: "ammo_pellet", kind: "ammo", price: 10 })).toBe("Đạn cho ná · 10 viên 100 xu");
    expect(d({ id: "food_dog", kind: "pet_food", price: 150 })).toBe("Cho chó ăn · no 24 giờ");
  });
  it("reads upland_crops.rat_food: khoai and bắp, not ớt; none before 0019", () => {
    const rows = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
    expect(rows.map(uplandFromRow).map((u) => [u.id, u.ratFood])).toEqual([["khoai", true], ["bap", true], ["ot", false]]);
    expect(uplandFromRow({ ...rows[0], rat_food: undefined }).ratFood).toBe(false);
  });
});
```

**tests/unit/farm-gather.test.ts.** Replace:

```ts
    items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3,
    gather: { readyAt: {}, leftToday: 200, dayResetsAt: null }, ...over,
  });
```

with:

```ts
    items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3,
    gather: { readyAt: {}, leftToday: 200, dayResetsAt: null }, rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null, ...over,
  });
```

**tests/unit/farm-land.test.ts.** Replace:

```ts
  items: {}, rice: {}, coins, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
  ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
```

with:

```ts
  items: {}, rice: {}, coins, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
  rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
  ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
```

**tests/unit/farm-rpc.test.ts — edit 1 of 4.** Replace:

```ts
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, pickSnailBed,
  RPCS_152, RPCS_153, sellCritters, sellProduce, sellRice,
} from "@/lib/game/farm/rpc";
```

with:

```ts
import {
  actionCall, adoptDog, buyFarmItem, claimFarmGift, crabFinish, crabStart, dogHunt, dogState, feedDog, fetchFarmCatalog, fetchFieldState,
  fieldAction, loadSprayer, pickSnailBed, renameDog, RPCS_152, RPCS_153, RPCS_17, sellCritters, sellProduce, sellRats, sellRice, slingShoot,
  slingStart,
} from "@/lib/game/farm/rpc";
```

**tests/unit/farm-rpc.test.ts — edit 2 of 4.** Replace:

```ts
    expect(a.critters).toEqual([{ id: "cua_dong", name: "Cua đồng", group: "crab", basePrice: 12, sortOrder: 10 }]);
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box", "tool"]]]);
  });
```

with:

```ts
    expect(a.critters).toEqual([{ id: "cua_dong", name: "Cua đồng", group: "crab", basePrice: 12, sortOrder: 10 }]);
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box", "tool", "ammo", "pet_food"]]]);
  });
```

**tests/unit/farm-rpc.test.ts — edit 3 of 4.** Replace:

```ts
      serverNow: "2026-09-25T10:00:00+00:00",
      mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null } },
    });
```

with:

```ts
      serverNow: "2026-09-25T10:00:00+00:00",
      mine: {
        items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
        rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
      },
    });
```

**tests/unit/farm-rpc.test.ts — edit 4 of 4.** Replace:

```ts

describe("the anti-cheat envelope (anti-cheat spec §12.1)", () => {
```

with:

```ts

describe("v17 (§10.4)", () => {
  const NOW = "2026-09-25T10:00:00+00:00";
  const DOG = { name: "Mực", coat: "muc", adopted_at: NOW, fed_until: "2026-09-26T10:00:00+00:00", next_hunt_at: null, catches: 0 };
  it("names the RPCs 0019 adds", () => {
    expect([...RPCS_17].sort()).toEqual(["adopt_dog", "dog_hunt", "dog_state", "feed_dog", "rename_dog", "sell_rats", "sling_shoot", "sling_start"]);
  });
  it("aims, shoots and pounces, with the room and the token", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ...FIELD, aim: { rat: 812, started_at: NOW } }, error: null });
    const a = await slingStart("r", "tok", 812);
    expect(h.rpc).toHaveBeenLastCalledWith("sling_start", { p_room_id: "r", p_session_token: "tok", p_rat_id: 812 });
    expect(a.aim).toEqual({ rat: 812, startedAt: Date.parse(NOW) });
    expect(a.state.plots[0].no).toBe(5);
    h.rpc.mockResolvedValueOnce({ data: { ...FIELD, shot: { hit: true, price: 336, pellets: 11 } }, error: null });
    expect((await slingShoot("r", "tok", 812, true)).shot).toEqual({ hit: true, price: 336, pellets: 11 });
    expect(h.rpc).toHaveBeenLastCalledWith("sling_shoot", { p_room_id: "r", p_session_token: "tok", p_rat_id: 812, p_hit: true });
    h.rpc.mockResolvedValueOnce({ data: { ...FIELD, shot: { hit: false, price: null, pellets: 10 } }, error: null });
    expect((await slingShoot("r", "tok", 812, false)).shot).toEqual({ hit: false, price: null, pellets: 10 });
    h.rpc.mockResolvedValueOnce({ data: { ...FIELD, dog_hunt: { price: 169 } }, error: null });
    expect((await dogHunt("r", "tok", 813)).price).toBe(169);
    expect(h.rpc).toHaveBeenLastCalledWith("dog_hunt", { p_room_id: "r", p_session_token: "tok", p_rat_id: 813 });
    h.rpc.mockResolvedValueOnce({ data: FIELD, error: null });
    await expect(slingStart("r", "tok", 812)).rejects.toThrow("bad aim");
  });
  it("throws on a shot, a pounce or a sale that is not whole (as v15.3's catches do)", async () => {
    for (const shot of [undefined, { hit: "yes", pellets: 3 }, { hit: false }, { hit: true, pellets: 3 }, { hit: true, price: null, pellets: 3 }]) {
      h.rpc.mockResolvedValueOnce({ data: { ...FIELD, shot }, error: null });
      await expect(slingShoot("r", "tok", 812, true), JSON.stringify(shot)).rejects.toThrow("bad shot answer");
    }
    for (const dog_hunt of [undefined, {}, { price: "169" }]) {
      h.rpc.mockResolvedValueOnce({ data: { ...FIELD, dog_hunt }, error: null });
      await expect(dogHunt("r", "tok", 813), JSON.stringify(dog_hunt)).rejects.toThrow("bad hunt answer");
    }
    for (const sold of [undefined, { count: 3 }, { xu: 486 }, { count: "3", xu: 486 }]) {
      h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine: MINE, sold }, error: null });
      await expect(sellRats("tok"), JSON.stringify(sold)).rejects.toThrow("bad sale answer");
    }
  });
  it("reads the dog calls' answer", async () => {
    const answer = { server_now: NOW, dog: DOG, food: 3, coins: 1500 };
    const want = { serverNow: Date.parse(NOW), dog: expect.objectContaining({ name: "Mực", coat: "muc" }), food: 3, coins: 1500 };
    h.rpc.mockResolvedValue({ data: answer, error: null });
    expect(await dogState("tok")).toEqual(want);
    expect(h.rpc).toHaveBeenLastCalledWith("dog_state", { p_session_token: "tok" });
    expect(await adoptDog("tok", "Mực", "muc")).toEqual(want);
    expect(h.rpc).toHaveBeenLastCalledWith("adopt_dog", { p_session_token: "tok", p_name: "Mực", p_coat: "muc" });
    await renameDog("tok", "Ki");
    expect(h.rpc).toHaveBeenLastCalledWith("rename_dog", { p_session_token: "tok", p_name: "Ki" });
    await feedDog("tok");
    expect(h.rpc).toHaveBeenLastCalledWith("feed_dog", { p_session_token: "tok" });
    h.rpc.mockResolvedValue({ data: { server_now: NOW, dog: null, food: 0, coins: 0 }, error: null });
    expect((await dogState("tok")).dog).toBeNull();
    h.rpc.mockResolvedValue({ data: {}, error: null });
    await expect(dogState("tok")).rejects.toThrow("bad dog answer");
  });
  it("sells the rats", async () => {
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine: { ...MINE, rats: { count: 0, value: 0 } }, sold: { count: 3, xu: 486 } }, error: null });
    const r = await sellRats("tok");
    expect(h.rpc).toHaveBeenLastCalledWith("sell_rats", { p_session_token: "tok" });
    expect(r).toMatchObject({ sold: { count: 3, xu: 486 }, mine: { rats: { count: 0, value: 0 } } });
  });
});

describe("the anti-cheat envelope (anti-cheat spec §12.1)", () => {
```

Create `tests/unit/farm-season.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { ratFoodAt, ratSeason } from "@/lib/game/farm/season";
import { parseFieldState } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";

const T0 = Date.parse("2026-09-25T00:00:00Z");
const iso = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
const at = (h: number) => Date.parse(iso(h));
const CATALOG: FarmCatalog = {
  varieties: [varietyFromRow({ id: "short", name: "Lúa ngắn ngày", scale: 0.9, base_kg: 90, price_per_kg: 710, blast_mult: 1, sort_order: 10 })],
  uplands: (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow),
  items: [],
  critters: [],
};
const plot = (no: number, crop: Record<string, unknown> | null) => ({
  no, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop,
});
/** Short rice transplanted at tp hours: ripe from tp + 43.2 h. */
const rice = (tp: number, harvester: { started_at: string; ends_at: string } | null = null) => ({
  kind: "rice", variety: "short", phase: "ripe", prepared_at: iso(tp - 12), soak_at: iso(tp - 12), sow_at: iso(tp - 9),
  transplant_at: iso(tp), water: 1, harvester,
});
/** Beds planted at p hours: khoai ripe from p + 48 h, bắp from p + 60 h, ớt's first picking from p + 46 h. */
const beds = (upland: string, p: number) => ({
  kind: "upland", upland, phase: "ripe", prepared_at: iso(p - 12), sow_at: upland === "ot" ? iso(p - 11) : null, plant_at: iso(p),
  water: 1, picking: 1, pickings: upland === "ot" ? 3 : 1,
});
const RATS = { next_at: iso(50), price: 150, live: [], recent: [], plots: {} };
const state = (plots: unknown[], rats: unknown = RATS) =>
  parseFieldState({ server_now: iso(49), plots, drying: [], mine: { items: {}, rice: {}, coins: 0, gift_claimed: true }, rats })!;

describe("rat season (§11)", () => {
  it("live rats make it", () => {
    const s = state([plot(5, null)], { ...RATS, live: [{ id: 1, plot: 5, since: iso(49), seed: 1 }] });
    expect(ratSeason(s, CATALOG, s.rats!.nextAt)).toBe(true);
    expect(ratSeason(state([plot(5, null)]), CATALOG, at(50))).toBe(false);
  });
  it("a ripe or overripe rice, khoai or bắp plot at next_at makes it", () => {
    expect(ratSeason(state([plot(5, rice(6))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(5, rice(7))]), CATALOG, at(50))).toBe(false);
    expect(ratSeason(state([plot(5, rice(-20))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(6, beds("khoai", 2))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(6, beds("khoai", 3))]), CATALOG, at(50))).toBe(false);
    expect(ratSeason(state([plot(6, beds("bap", -10))]), CATALOG, at(50))).toBe(true);
    expect(ratSeason(state([plot(6, beds("bap", -9))]), CATALOG, at(50))).toBe(false);
  });
  it("not ớt, not once a harvester job has started, and not before 0019", () => {
    expect(ratSeason(state([plot(7, beds("ot", 0))]), CATALOG, at(50))).toBe(false);
    const job = { started_at: iso(49.5), ends_at: iso(49.51) };
    expect(ratSeason(state([plot(5, rice(0, job))]), CATALOG, at(50))).toBe(false);
    expect(ratFoodAt(state([plot(5, rice(0, job))]).plots[0], CATALOG, at(49))).toBe(true);
    const old = state([plot(5, rice(6))], null);
    expect(old.rats).toBeNull();
    expect(ratSeason(old, CATALOG, at(50))).toBe(false);
  });
});
```

**tests/unit/farm-state.test.ts — edit 1 of 2.** Replace:

```ts
      critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
      ownedPlot: 3, farming: [7],
```

with:

```ts
      critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
      rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
      ownedPlot: 3, farming: [7],
```

**tests/unit/farm-state.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("v17 (§10.5)", () => {
  const RATS = {
    next_at: "2026-09-25T10:14:00+00:00", price: 336,
    live: [{ id: 812, plot: 3, since: "2026-09-25T09:58:00+00:00", seed: 1234567 }], recent: [],
    plots: { 3: [{ r: 812, from: "2026-09-25T09:59:00+00:00", to: null }] },
  };
  const DOG = {
    name: "Mực", coat: "muc", adopted_at: "2026-09-24T08:00:00+00:00", fed_until: "2026-09-26T08:00:00+00:00", next_hunt_at: null,
    catches: 12,
  };
  it("reads the field's rats", () => {
    expect(parseFieldState({ ...ANSWER, rats: RATS })!.rats).toEqual({
      nextAt: ms("2026-09-25T10:14:00Z"), price: 336, live: [{ id: 812, plot: 3, since: ms("2026-09-25T09:58:00Z"), seed: 1234567 }],
      recent: [], plots: { 3: [{ r: 812, from: ms("2026-09-25T09:59:00Z"), to: null }] },
    });
  });
  it("reads the bag, the caps and the dog in the account part", () => {
    const m = parseFarmMine({
      ...ANSWER.mine, rats: { count: 2, value: 486 }, dog: DOG,
      rat_caps: { hour_left: 4, hour_resets_at: "2026-09-25T10:40:00+00:00", day_left: 21 },
    })!;
    expect(m.rats).toEqual({ count: 2, value: 486 });
    expect(m.ratCaps).toEqual({ hourLeft: 4, hourResetsAt: ms("2026-09-25T10:40:00Z"), dayLeft: 21 });
    expect(m.dog).toEqual({
      name: "Mực", coat: "muc", adoptedAt: ms("2026-09-24T08:00:00Z"), fedUntil: ms("2026-09-26T08:00:00Z"), nextHuntAt: null,
      catches: 12,
    });
  });
  it("reads a database before 0019 as: no rats, an empty bag, full caps, no dog", () => {
    const s = parseFieldState(ANSWER)!;
    expect(s.rats).toBeNull();
    expect(s.mine).toMatchObject({ rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null });
  });
  it("keeps the newer account part's bag, caps and dog when it merges", () => {
    const s = parseFieldState({ ...ANSWER, rats: RATS, mine: { ...ANSWER.mine, rats: { count: 2, value: 486 }, dog: DOG } })!;
    const next = withMine(s, parseFarmMine({ ...ANSWER.mine, rats: { count: 0, value: 0 }, dog: DOG })!);
    expect(next.mine.rats).toEqual({ count: 0, value: 0 });
    expect(next.mine.dog?.name).toBe("Mực");
    expect(next.rats?.price).toBe(336);
  });
});
```

**tests/unit/fishing-panels.test.tsx — edit 1 of 2.** Replace:

```tsx
    items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
  });
```

with:

```tsx
    items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
    rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
  });
```

**tests/unit/fishing-panels.test.tsx — edit 2 of 2.** Replace:

```tsx
    items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters, critterCap: cap,
    gather: { readyAt: {}, leftToday: left, dayResetsAt: reset },
  });
```

with:

```tsx
    items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters, critterCap: cap,
    gather: { readyAt: {}, leftToday: left, dayResetsAt: reset }, rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-gather.test.ts tests/unit/farm-land.test.ts tests/unit/farm-rpc.test.ts tests/unit/farm-season.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-panels.test.tsx`
Expected: FAIL — `farm-season.test.ts` cannot load `@/lib/game/farm/season`, and 14 tests fail in `farm-state.test.ts` (5: no `rats`, bag, caps or dog), `farm-catalog.test.ts` (2: no ná, pellets, dog food or `ratFood`) and `farm-rpc.test.ts` (7: no `RPCS_17`, no v17 calls, the catalog's new rows); 4 files fail, 5 pass (126 tests).

- [ ] **Step 3: Implement**

**lib/game/farm/catalog.ts — edit 1 of 7.** Replace:

```ts
// Client side of the farm config (spec §7, §8.1, §9; v15.2 §8.2, §9; v15.3 §7.1, §9): varieties, hoa-màu crops, farm
// items, critters, the land prices and number formats. Pure.
import { GATHER, heldBox } from "./gather";

export type FarmItemKind = "seed" | "fertilizer" | "pesticide" | "critter_box" | "tool";
export type FertKind = "manure" | "phosphate" | "urea" | "potash" | "npk";
```

with:

```ts
// Client side of the farm config (spec §7, §8.1, §9; v15.2 §8.2, §9; v15.3 §7.1, §9; v17 §8): varieties, hoa-màu crops,
// farm items, critters, the land prices and number formats. Pure.
import { GATHER, heldBox } from "./gather";

export type FarmItemKind = "seed" | "fertilizer" | "pesticide" | "critter_box" | "tool" | "ammo" | "pet_food";
export type FertKind = "manure" | "phosphate" | "urea" | "potash" | "npk";
```

**lib/game/farm/catalog.ts — edit 2 of 7.** Replace:

```ts
/** The shop_items kinds the farm shop sells (the fishing shop sells the others). */
export const FARM_KINDS: readonly FarmItemKind[] = ["seed", "fertilizer", "pesticide", "critter_box", "tool"];
const FERTS: readonly string[] = ["manure", "phosphate", "urea", "potash", "npk"];
```

with:

```ts
/** The shop_items kinds the farm shop sells (the fishing shop sells the others). */
export const FARM_KINDS: readonly FarmItemKind[] = ["seed", "fertilizer", "pesticide", "critter_box", "tool", "ammo", "pet_food"];
const FERTS: readonly string[] = ["manure", "phosphate", "urea", "potash", "npk"];
```

**lib/game/farm/catalog.ts — edit 3 of 7.** Replace:

```ts
  pests: UplandPest[];
}
```

with:

```ts
  pests: UplandPest[];
  /** v17 (D4): rats eat it while it is ripe or overripe (khoai, bắp); false before 0019. */
  ratFood: boolean;
}
```

**lib/game/farm/catalog.ts — edit 4 of 7.** Replace:

```ts
  rot_cap: number | null; cares: unknown; pests: unknown;
}
```

with:

```ts
  rot_cap: number | null; cares: unknown; pests: unknown;
  /** From 0019 on. */
  rat_food?: boolean;
}
```

**lib/game/farm/catalog.ts — edit 5 of 7.** Replace:

```ts
    })),
  };
```

with:

```ts
    })),
    ratFood: r.rat_food === true,
  };
```

**lib/game/farm/catalog.ts — edit 6 of 7.** Replace:

```ts
export const TEND_ACTS: readonly string[] = ["lat_day", "vun_goc"];
```

with:

```ts
export const TEND_ACTS: readonly string[] = ["lat_day", "vun_goc"];

// v17 (§8, D29): anh Hai's slingshot, its clay pellets and the dog food.
export const TOOL_SLING = "tool_sling";
export const AMMO_PELLET = "ammo_pellet";
export const FOOD_DOG = "food_dog";
/** The shop sells pellets in steps of this many. */
export const PELLET_STEP = 10;
```

**lib/game/farm/catalog.ts — edit 7 of 7.** Replace:

```ts
    case "tool":
      return it.id === TOOL_SPRAYER ? "Nạp 1 chai thuốc được 3 lần xịt — mua một lần" : "Gặt lúa tay, 6 phần — mua một lần";
  }
```

with:

```ts
    case "tool":
      if (it.id === TOOL_SLING) return "Bắn chuột đồng — mua một lần";
      return it.id === TOOL_SPRAYER ? "Nạp 1 chai thuốc được 3 lần xịt — mua một lần" : "Gặt lúa tay, 6 phần — mua một lần";
    case "ammo":
      return `Đạn cho ná · ${PELLET_STEP} viên ${(PELLET_STEP * (it.price ?? 0)).toLocaleString("vi-VN")} xu`;
    case "pet_food":
      return "Cho chó ăn · no 24 giờ";
  }
```

**lib/game/farm/rpc.ts — edit 1 of 4.** Replace:

```ts
import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
```

with:

```ts
import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { parseDogAnswer, type DogAnswer, type DogCoat } from "@/lib/game/dog";
import { supabase } from "@/lib/supabase";
```

**lib/game/farm/rpc.ts — edit 2 of 4.** Replace:

```ts

// Supabase calls for the field (spec §11.3; v15.2 §11.4; v15.3 §11.4). Every farm answer in a room is the whole
// field_state; the account-only ones (sell_rice, buy_farm_item, claim_farm_gift, load_sprayer, sell_produce,
// sell_critters) and the gathering ones (crab_start, crab_finish, pick_snail_bed) answer with the account part.
```

with:

```ts

// Supabase calls for the field (spec §11.3; v15.2 §11.4; v15.3 §11.4; v17 §10.4). Every farm answer in a room is the
// whole field_state; the account-only ones (sell_rice, buy_farm_item, claim_farm_gift, load_sprayer, sell_produce,
// sell_critters, sell_rats) and the gathering ones (crab_start, crab_finish, pick_snail_bed) answer with the account
// part, and the dog's (dog_state, adopt_dog, rename_dog, feed_dog) with the dog, its food and the wallet.
```

**lib/game/farm/rpc.ts — edit 3 of 4.** Replace:

```ts
export const RPCS_153: ReadonlySet<string> = new Set(["crab_start", "crab_finish", "pick_snail_bed", "sell_critters"]);
```

with:

```ts
export const RPCS_153: ReadonlySet<string> = new Set(["crab_start", "crab_finish", "pick_snail_bed", "sell_critters"]);

/** The RPCs 0019 adds: before it runs, PostgREST cannot find them (v17 §3). */
export const RPCS_17: ReadonlySet<string> = new Set([
  "sling_start", "sling_shoot", "dog_hunt", "adopt_dog", "rename_dog", "feed_dog", "sell_rats", "dog_state",
]);
```

**lib/game/farm/rpc.ts — edit 4 of 4.** Append at the end of the file, after a blank line:

```ts
/** The slingshot's aim (v17 §6.1): at this rat, from the server's start (the 2–60 s gate counts from it). */
export interface SlingAim { rat: number; startedAt: number }
/** A shot (§6.1): a hit catches; its price is fixed at the catch; the pellets left. */
export interface ShotAnswer { hit: boolean; price: number | null; pellets: number }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export async function slingStart(roomId: string, token: string, rat: number): Promise<{ state: FieldState; aim: SlingAim }> {
  const r = await call("sling_start", { p_room_id: roomId, p_session_token: token, p_rat_id: rat });
  const a = obj(r.aim);
  const startedAt = typeof a.started_at === "string" ? Date.parse(a.started_at) : NaN;
  if (!isNum(a.rat) || !Number.isFinite(startedAt)) throw new Error("bad aim");
  return { state: fieldOf(r), aim: { rat: a.rat, startedAt } };
}

/** A shot's answer is the server's (as a catch's is, v15.3): a hit with its price, or a miss, and the pellets left; an
 *  answer without them whole is malformed. */
export async function slingShoot(roomId: string, token: string, rat: number, hit: boolean): Promise<{ state: FieldState; shot: ShotAnswer }> {
  const r = await call("sling_shoot", { p_room_id: roomId, p_session_token: token, p_rat_id: rat, p_hit: hit });
  const s = obj(r.shot);
  if (typeof s.hit !== "boolean" || !isNum(s.pellets) || (s.hit && !isNum(s.price))) throw new Error("bad shot answer");
  return { state: fieldOf(r), shot: { hit: s.hit, price: s.hit && isNum(s.price) ? s.price : null, pellets: s.pellets } };
}

/** The dog's pounce (§7.2): what the rat it caught fetched; an answer without it is malformed. */
export async function dogHunt(roomId: string, token: string, rat: number): Promise<{ state: FieldState; price: number }> {
  const r = await call("dog_hunt", { p_room_id: roomId, p_session_token: token, p_rat_id: rat });
  const d = obj(r.dog_hunt);
  if (!isNum(d.price)) throw new Error("bad hunt answer");
  return { state: fieldOf(r), price: d.price };
}

async function dogCall(fn: string, args: Record<string, unknown>): Promise<DogAnswer> {
  const a = parseDogAnswer(await call(fn, args));
  if (!a) throw new Error("bad dog answer");
  return a;
}

/** The dog on entering the game (§7.3): a read. */
export function dogState(token: string): Promise<DogAnswer> {
  return dogCall("dog_state", { p_session_token: token });
}

/** Nhận nuôi at chú Tám's (§7.1): a name and a coat, 20 000 xu. */
export function adoptDog(token: string, name: string, coat: DogCoat): Promise<DogAnswer> {
  return dogCall("adopt_dog", { p_session_token: token, p_name: name, p_coat: coat });
}

export function renameDog(token: string, name: string): Promise<DogAnswer> {
  return dogCall("rename_dog", { p_session_token: token, p_name: name });
}

/** One bịch of thức ăn chó: fed 24 h more (D19). */
export function feedDog(token: string): Promise<DogAnswer> {
  return dogCall("feed_dog", { p_session_token: token });
}

/** cô Út buys every rat in the bag at the prices fixed at each catch (D12); `sold` is what she paid, so an answer
 *  without it whole is malformed. */
export async function sellRats(token: string): Promise<MineAnswer & { sold: { count: number; xu: number } }> {
  const r = await call("sell_rats", { p_session_token: token });
  const s = obj(r.sold);
  if (!isNum(s.count) || !isNum(s.xu)) throw new Error("bad sale answer");
  return { ...mineAnswer(r), sold: { count: s.count, xu: s.xu } };
}
```

Create `lib/game/farm/season.ts` with exactly:

```ts
import type { FarmCatalog } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import type { FieldState, PlotView } from "./state";
import { uplandModel, upPhase } from "./upland";

// v17 rat season (§11): rats are out, or some plot is rat food at the next spawn candidate. Only then do clients on the
// field refetch field_state at rats.next_at (D10); spawns send no message. Pure.

/** Is the plot's crop rat food at t, by the client's phase models (0019 _rat_food): rice ripe or overripe with no
 *  harvester job started; khoai or bắp (upland_crops.rat_food) ripe or overripe; never ớt. */
export function ratFoodAt(p: PlotView, catalog: FarmCatalog, t: number): boolean {
  const c = p.crop;
  if (!c) return false;
  if (c.kind === "rice") {
    const v = catalog.varieties.find((x) => x.id === c.variety);
    if (!v) return false;
    const ph = cropPhase(cropModel(c), v, t);
    return (ph === "ripe" || ph === "overripe") && !(c.harvester !== null && t >= c.harvester.startedAt);
  }
  const u = catalog.uplands.find((x) => x.id === c.upland);
  if (!u || !u.ratFood) return false;
  const ph = upPhase(uplandModel(c), u, t);
  return ph === "ripe" || ph === "overripe";
}

/** Rat season: live rats, or a plot that is rat food at next_at. Before 0019 (no rats) it never is. */
export function ratSeason(state: FieldState, catalog: FarmCatalog, nextAt: number): boolean {
  if (!state.rats) return false;
  return state.rats.live.length > 0 || state.plots.some((p) => ratFoodAt(p, catalog, nextAt));
}
```

**lib/game/farm/state.ts — edit 1 of 5.** Replace:

```ts
// The field_state JSON (spec §11.5; v15.2 §11.6; v15.3 §11.7), camelCased, with times as ms since the epoch. Pure.
import { GATHER } from "./gather";
```

with:

```ts
// The field_state JSON (spec §11.5; v15.2 §11.6; v15.3 §11.7; v17 §10.5), camelCased, with times as ms since the epoch.
// Pure.
import { parseDog, type DogView } from "../dog";
import { GATHER } from "./gather";
import { parseRatBag, parseRatCaps, parseRats, type FieldRats, type RatBag, type RatCaps } from "./rats";
```

**lib/game/farm/state.ts — edit 2 of 5.** Replace:

```ts
  gather: GatherMine;
}
```

with:

```ts
  gather: GatherMine;
  /** v17: the rats in the bag (none before 0019). */
  rats: RatBag;
  /** v17: what the catch caps leave (full before 0019). */
  ratCaps: RatCaps;
  /** v17: the account's dog (null: none yet, or before 0019). */
  dog: DogView | null;
}
```

**lib/game/farm/state.ts — edit 3 of 5.** Replace:

```ts
  critterPrices: CritterPrices | null;
}
```

with:

```ts
  critterPrices: CritterPrices | null;
  /** v17: the field's rats; null before 0019. */
  rats: FieldRats | null;
}
```

**lib/game/farm/state.ts — edit 4 of 5.** Replace:

```ts
  const tank = t ? { item: typeof t.item === "string" ? t.item : null, charges: num(t.charges) } : null;
  return { items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true, produce, tank, ...parseGather(m) };
}
```

with:

```ts
  const tank = t ? { item: typeof t.item === "string" ? t.item : null, charges: num(t.charges) } : null;
  return {
    items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true, produce, tank, ...parseGather(m),
    rats: parseRatBag(m.rats), ratCaps: parseRatCaps(m.rat_caps), dog: parseDog(m.dog),
  };
}
```

**lib/game/farm/state.ts — edit 5 of 5.** Replace:

```ts
    critterPrices: numOrNull(cp.mult) === null ? null : { mult: num(cp.mult), endsAt: time(cp.ends_at) },
  };
```

with:

```ts
    critterPrices: numOrNull(cp.mult) === null ? null : { mult: num(cp.mult), endsAt: time(cp.ends_at) },
    rats: parseRats(j.rats),
  };
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (9 files, 143 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/catalog.ts lib/game/farm/rpc.ts lib/game/farm/season.ts lib/game/farm/state.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-gather.test.ts tests/unit/farm-land.test.ts tests/unit/farm-rpc.test.ts tests/unit/farm-season.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-panels.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the field's rats, the bag, the caps and the dog in the state; the new calls

The catalog knows the kinds ammo and pet_food (FARM_KINDS), describes the ná, the
pellets and the dog food, and reads upland_crops.rat_food as ratFood. field_state's
`rats` becomes FieldState.rats (null before 0019), and the account part gains the rat
bag, what the catch caps leave and the dog (an empty bag, full caps and no dog before
0019), so withMine carries them. rpc.ts adds RPCS_17 and slingStart, slingShoot,
dogHunt, dogState, adoptDog, renameDog, feedDog and sellRats; an aim, a shot, a
pounce, a dog answer or a sale that is not whole throws, as v15.3's catches do since
793f8b4. lib/game/farm/season.ts judges rat season: live rats, or a plot the client's
phase models call rat food at next_at. The test literals of the account part gain the
new fields.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/catalog.ts lib/game/farm/rpc.ts lib/game/farm/season.ts lib/game/farm/state.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-gather.test.ts tests/unit/farm-land.test.ts tests/unit/farm-rpc.test.ts tests/unit/farm-season.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-panels.test.tsx
git commit -F <message file>
```

---

### Task 8: The SlingGame state machine

**Files:**
- Create: `lib/game/farm/sling.ts`
- Test: `tests/unit/farm-sling.test.ts` (create)

**Interfaces:**
- Consumes: `fishing/reel.ts`' `nextRandom`.
- Produces (`lib/game/farm/sling.ts`, §6.2, D14–D16): `SLING` (the scene 320 × 180, the lane y 70 and x 16–304, the rat's runs and stops, `shotStep` 7 919, `aimSpeed` 180, `fillMs` 1 000, the band 0.60–0.85, `flightMs` 300, `hitPx` 9, `reloadMs` 2 200, `reaimMs` 55 000), `SlingMark`, `SLING_MISS` (§12.2's three lines), `SlingStage` (`reload` → `ready` → `draw` → `flight` → `send` | `reaim` → `wait`), `SlingState`, `SlingInput {holding, aimTo, left, right}`, `createSling(seed)`, `bandMark(power)`, `stepSling(s, dtSec, input)`, `slingSent(s)`, `slingAnswered(s)` (the reload, and the next shot's rat on `seed + 7 919 · shots`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-sling.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { nextRandom } from "@/lib/game/fishing/reel";
import {
  bandMark, createSling, SLING, SLING_MISS, slingAnswered, slingSent, stepSling, type SlingInput, type SlingState,
} from "@/lib/game/farm/sling";

const IDLE: SlingInput = { holding: false, aimTo: null, left: false, right: false };
const HOLD: SlingInput = { ...IDLE, holding: true };

/** Steps `ms` in 10 ms frames with one input. */
function run(s: SlingState, ms: number, input: SlingInput = IDLE): SlingState {
  for (let t = 0; t < ms; t += 10) s = stepSling(s, 0.01, input);
  return s;
}

/** A game past its 2.2 s reload, ready to draw. */
const ready = (seed = 1) => run(createSling(seed), SLING.reloadMs);

/** The rat at x, standing still for a minute, or running right at 100 px/s. */
const still = (s: SlingState, x: number): SlingState => ({ ...s, rat: { ...s.rat, x, moving: false, segMs: 60_000 } });
const running = (s: SlingState, x: number): SlingState =>
  ({ ...s, rat: { ...s.rat, x, dir: 1, moving: true, speed: 100, segMs: 60_000 } });

/** A pellet let go at `power` towards `shotX`, just leaving the sling. */
const flying = (power: number, shotX: number): SlingState =>
  ({ ...ready(), stage: "flight", stageMs: 0, power, shotX, aimX: shotX });

/** Draws for `ms` at the still rat's x, lets go, and waits out the flight. */
function release(ms: number): SlingState {
  const at = { ...HOLD, aimTo: 160 };
  let s = stepSling(still(ready(), 160), 0.01, at);
  s = run(s, ms, at);
  s = stepSling(s, 0, { ...at, holding: false });
  return run(s, SLING.flightMs, { ...at, holding: false });
}

describe("SlingGame", () => {
  it("reloads 2.2 s after the start answer, then is ready", () => {
    let s = createSling(5);
    expect(s).toMatchObject({ seed: 5, shots: 0, stage: "reload", power: 0, mark: null, shotX: null, aimX: 160, sinceAnswerMs: 0 });
    expect(s.rat).toMatchObject({ x: 160, moving: true });
    s = run(s, SLING.reloadMs - 10, HOLD);
    expect(s.stage).toBe("reload");
    s = stepSling(s, 0.01, IDLE);
    expect(s).toMatchObject({ stage: "ready", stageMs: 0 });
    expect(stepSling(s, 1, IDLE).sinceAnswerMs).toBe(SLING.reloadMs + 50);
    expect(stepSling(s, -1, IDLE).sinceAnswerMs).toBe(SLING.reloadMs);
  });

  it("draws 0 → 1 in 1 s while held; a full draw lets go by itself and flies over", () => {
    let s = stepSling(ready(), 0.01, HOLD);
    expect(s).toMatchObject({ stage: "draw", power: 0 });
    s = run(s, 500, HOLD);
    expect(s.power).toBe(0.5);
    s = run(s, 490, HOLD);
    expect(s.stage).toBe("draw");
    s = stepSling(s, 0.01, HOLD);
    expect(s).toMatchObject({ stage: "flight", power: 1, armed: false });
    s = run(s, SLING.flightMs - 10, HOLD);
    expect(s).toMatchObject({ stage: "flight", mark: null });
    s = stepSling(s, 0.01, HOLD);
    expect(s).toMatchObject({ stage: "send", mark: "over" });
    // still held since the auto-release: no new draw until the band is let go
    s = run(slingAnswered(slingSent(s)), SLING.reloadMs + 100, HOLD);
    expect(s.stage).toBe("ready");
    s = stepSling(stepSling(s, 0.01, IDLE), 0.01, HOLD);
    expect(s.stage).toBe("draw");
  });

  it("has the band edges 0.60 and 0.85", () => {
    expect(bandMark(0.5999)).toBe("short");
    expect(bandMark(0.6)).toBe("in");
    expect(bandMark(0.85)).toBe("in");
    expect(bandMark(0.8501)).toBe("over");
    expect(bandMark(1)).toBe("over");
    expect(release(590)).toMatchObject({ stage: "send", power: 0.59, mark: "short" });
    expect(release(600)).toMatchObject({ stage: "send", power: 0.6, mark: "hit" });
    expect(release(850)).toMatchObject({ stage: "send", power: 0.85, mark: "hit" });
    expect(release(860)).toMatchObject({ stage: "send", power: 0.86, mark: "over" });
    expect(SLING_MISS).toEqual({ short: "Hụt — đạn rơi trước.", over: "Hụt — căng quá, đạn bay qua.", wide: "Hụt — lệch rồi." });
  });

  it("hits when the rat is within ±9 px of the shot when the pellet lands, 0.3 s after the release", () => {
    const land = (s: SlingState, input: SlingInput = IDLE) => run(s, SLING.flightMs, input).mark;
    expect(land(still(flying(0.7, 109), 100))).toBe("hit");
    expect(land(still(flying(0.7, 91), 100))).toBe("hit");
    expect(land(still(flying(0.7, 109.5), 100))).toBe("wide");
    expect(land(still(flying(0.7, 90.5), 100))).toBe("wide");
    // a running rat is judged where it is at the landing, 30 px on; moving the aim in flight changes nothing
    expect(land(running(flying(0.7, 100), 100))).toBe("wide");
    expect(land(running(flying(0.7, 130), 100))).toBe("hit");
    expect(land(running(flying(0.7, 130), 100), { ...IDLE, aimTo: 20 })).toBe("hit");
    expect(land(still(flying(0.59, 100), 100))).toBe("short");
    expect(land(still(flying(0.86, 100), 100))).toBe("over");
  });

  it("moves the aim with the pointer, or ←/→ at 180 px/s, inside the lane", () => {
    let s = stepSling(createSling(3), 0.01, { ...IDLE, aimTo: 40 });
    expect(s.aimX).toBe(40);
    s = run(s, 100, { ...IDLE, right: true });
    expect(s.aimX).toBeCloseTo(58, 9);
    s = run(s, 100, { ...IDLE, left: true, right: true });
    expect(s.aimX).toBeCloseTo(58, 9);
    s = run(s, 1000, { ...IDLE, left: true });
    expect(s.aimX).toBe(SLING.laneMin);
    expect(stepSling(s, 0.01, { ...IDLE, aimTo: 999 }).aimX).toBe(SLING.laneMax);
  });

  it("runs the rat 0.5–1.2 s at 60–110 px/s with stops of 0.2–0.6 s, in the lane, the same for a seed", () => {
    const bad: string[] = [];
    for (const seed of [1, 2, 3, 99, 12345]) {
      let s = createSling(seed), since = 0, turns = 0;
      for (let f = 0; f < 6000; f++) {
        const prev = s.rat;
        s = stepSling(s, 0.01, IDLE);
        since += 10;
        const r = s.rat;
        if (r.x < SLING.laneMin || r.x > SLING.laneMax) bad.push(`${seed}/${f}: x ${r.x}`);
        if (r.moving && (r.speed < SLING.speedMin || r.speed > SLING.speedMax)) bad.push(`${seed}/${f}: speed ${r.speed}`);
        if (r.dir !== prev.dir) turns++;
        if (r.moving !== prev.moving) {
          // a segment is seen to end within the 10 ms frame it ends in
          const [lo, hi] = prev.moving ? [SLING.runMinMs, SLING.runMaxMs] : [SLING.stopMinMs, SLING.stopMaxMs];
          if (since < lo - 10 || since > hi + 10) bad.push(`${seed}/${f}: ${prev.moving ? "run" : "stop"} of ${since} ms`);
          since = 0;
        }
      }
      if (turns === 0) bad.push(`${seed}: never turned`);
    }
    expect(bad).toEqual([]);
    const play = (seed: number) => run(createSling(seed), 8000, { ...IDLE, aimTo: 50 });
    expect(play(11)).toEqual(play(11));
    expect(play(11).rat).not.toEqual(play(12).rat);
  }, 30_000);

  it("reseeds each shot's rat with seed + 7919 · shot, and counts only the shots sent", () => {
    const sent = release(700);
    expect(sent.stage).toBe("send");
    expect(slingSent(sent).stage).toBe("wait");
    expect(slingSent(ready()).stage).toBe("ready");
    const next = slingAnswered(slingSent(sent));
    expect(next).toMatchObject({ shots: 1, stage: "reload", stageMs: 0, power: 0, mark: null, shotX: null, sinceAnswerMs: 0 });
    expect(next.rat.rng).toBe((1 + 7919) | 0);
    expect(slingAnswered(slingSent({ ...next, stage: "send", mark: "wide" })).rat.rng).toBe((1 + 2 * 7919) | 0);
  });

  it("drops a shot ready 55 s or more after the last answer for a new aim", () => {
    const shootAt = (idleMs: number) => {
      let s = run(ready(4), idleMs);
      s = run(stepSling(s, 0.01, HOLD), 700, HOLD);
      s = stepSling(s, 0, IDLE);
      return run(s, SLING.flightMs);
    };
    expect(shootAt(51_780)).toMatchObject({ stage: "send", sinceAnswerMs: 54_990 });
    const late = shootAt(51_790);
    expect(late).toMatchObject({ stage: "reaim", mark: null, sinceAnswerMs: 55_000 });
    const again = slingAnswered(slingSent(late));
    expect(again).toMatchObject({ shots: 0, stage: "reload", sinceAnswerMs: 0 });
  });

  it("sends no result before T + 2.5 s and no hit before T + 3.1 s, over 1 000 random inputs", () => {
    let hits = 0, misses = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      let rng = seed * 7 + 3;
      const u = () => {
        const [v, n] = nextRandom(rng);
        rng = n;
        return v;
      };
      let s = createSling(seed), since = 0, target = u() * 1.1;
      for (let f = 0; f < 800; f++) {
        const dt = u() * 0.06;
        s = stepSling(s, dt, {
          holding: s.stage === "draw" ? s.power < target : u() < 0.5,
          aimTo: u() < 0.8 ? s.rat.x + (u() - 0.5) * 24 : null,
          left: u() < 0.1,
          right: u() < 0.1,
        });
        since += Math.min(0.05, dt) * 1000;
        if (s.stage === "send") {
          expect(since).toBeGreaterThanOrEqual(2500);
          if (s.mark === "hit") {
            expect(since).toBeGreaterThanOrEqual(3100);
            hits++;
          } else misses++;
          s = slingAnswered(slingSent(s));
          since = 0;
          target = u() * 1.1;
        }
      }
    }
    expect(hits).toBeGreaterThan(100);
    expect(misses).toBeGreaterThan(100);
  }, 60_000);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-sling.test.ts`
Expected: FAIL — `farm-sling.test.ts` cannot load `@/lib/game/farm/sling`; 1 file fails, no tests run.

- [ ] **Step 3: Implement**

Create `lib/game/farm/sling.ts` with exactly:

```ts
import { nextRandom } from "../fishing/reel";

// SlingGame (v17 §6.2, D14–D16): a pure state machine, deterministic for a seed, driven by a thin overlay. A rat runs
// along a lane; the player aims (pointer or ←/→), holds to draw the band (power 0 → 1 in 1 s) and lets go: under 0.60
// the pellet falls short, over 0.85 it flies over (a full draw lets go by itself), otherwise it lands 0.3 s later and
// hits if the rat is within 9 px of the aim then. Every result waits out the flight, then goes to the server; 2.2 s of
// "Nạp đạn…" follow every answer, so an honest shot is sent at least 2.5 s (a miss) or 3.1 s (a hit) after the last
// answer, clear of the server's 2 s gate. A shot ready 55 s or more after the last answer is dropped for a new aim.

export const SLING = {
  /** The scene, in logical px; the rat's lane. */
  width: 320,
  height: 180,
  laneY: 70,
  laneMin: 16,
  laneMax: 304,
  /** The rat: runs of 0.5–1.2 s at 60–110 px/s, stops of 0.2–0.6 s; a run turns back with this chance. */
  runMinMs: 500,
  runMaxMs: 1200,
  speedMin: 60,
  speedMax: 110,
  stopMinMs: 200,
  stopMaxMs: 600,
  turnChance: 0.35,
  /** Shot i's rat moves on mulberry32(seed + shotStep · i). */
  shotStep: 7919,
  /** ←/→ move the aim this fast, px/s. */
  aimSpeed: 180,
  /** Holding draws the band from 0 to 1 in 1 s; the green band is [0.60, 0.85]. */
  fillMs: 1000,
  bandLow: 0.6,
  bandHigh: 0.85,
  flightMs: 300,
  hitPx: 9,
  reloadMs: 2200,
  /** A shot ready this long after the last sling answer is dropped: the client aims again (the server's bound is 60 s). */
  reaimMs: 55_000,
  maxDt: 0.05,
} as const;

/** A shot's result: a hit, short of the band, over it, or in it but wide of the rat. */
export type SlingMark = "hit" | "short" | "over" | "wide";

/** The misses' lines (§12.2); a hit's line carries the price and is the overlay's. */
export const SLING_MISS: Record<Exclude<SlingMark, "hit">, string> = {
  short: "Hụt — đạn rơi trước.",
  over: "Hụt — căng quá, đạn bay qua.",
  wide: "Hụt — lệch rồi.",
};

export type SlingStage = "reload" | "ready" | "draw" | "flight" | "send" | "reaim" | "wait";

export interface SlingRat { x: number; dir: 1 | -1; moving: boolean; speed: number; segMs: number; rng: number }

export interface SlingState {
  seed: number;
  /** Shots sent so far. */
  shots: number;
  rat: SlingRat;
  aimX: number;
  stage: SlingStage;
  stageMs: number;
  /** The band's draw (0 outside a draw); the draw that was let go, during the flight. */
  power: number;
  /** Let go since the last full draw: a new draw may start. */
  armed: boolean;
  /** The flight's result, and where the pellet went (for the scene). */
  mark: SlingMark | null;
  shotX: number | null;
  /** Since the last sling answer (sling_start's or sling_shoot's). */
  sinceAnswerMs: number;
}

export interface SlingInput {
  holding: boolean;
  /** A pointer's x in scene px, or null. */
  aimTo: number | null;
  left: boolean;
  right: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function draw(rng: number, lo: number, hi: number): [number, number] {
  const [u, next] = nextRandom(rng);
  return [lo + u * (hi - lo), next];
}

/** The rat's next segment: after a run a stop, after a stop a run (sometimes turning back). */
function nextSegment(r: SlingRat): SlingRat {
  if (r.moving) {
    const [ms, rng] = draw(r.rng, SLING.stopMinMs, SLING.stopMaxMs);
    return { ...r, moving: false, segMs: ms, rng };
  }
  const [ms, a] = draw(r.rng, SLING.runMinMs, SLING.runMaxMs);
  const [speed, b] = draw(a, SLING.speedMin, SLING.speedMax);
  const [turn, rng] = nextRandom(b);
  return { ...r, moving: true, segMs: ms, speed, dir: turn < SLING.turnChance ? (r.dir === 1 ? -1 : 1) : r.dir, rng };
}

function stepRat(r: SlingRat, dtMs: number): SlingRat {
  let rat = r, left = dtMs;
  while (left > 0) {
    const t = Math.min(left, rat.segMs);
    if (rat.moving) {
      let x = rat.x + rat.dir * rat.speed * (t / 1000), dir = rat.dir;
      if (x <= SLING.laneMin || x >= SLING.laneMax) {
        x = clamp(x, SLING.laneMin, SLING.laneMax);
        dir = dir === 1 ? -1 : 1;
      }
      rat = { ...rat, x, dir };
    }
    rat = { ...rat, segMs: rat.segMs - t };
    left -= t;
    if (rat.segMs <= 0) rat = nextSegment(rat);
  }
  return rat;
}

/** A new game, just after sling_start's answer: the rat mid-lane and starting a run, the aim centred, reloading. */
export function createSling(seed: number): SlingState {
  const rat = nextSegment({ x: (SLING.laneMin + SLING.laneMax) / 2, dir: 1, moving: false, speed: 0, segMs: 0, rng: seed | 0 });
  return {
    seed, shots: 0, rat, aimX: SLING.width / 2, stage: "reload", stageMs: 0, power: 0, armed: true, mark: null, shotX: null,
    sinceAnswerMs: 0,
  };
}

/** Where a draw let go lands: short, over, or in the band (then the rat decides, after the flight). */
export function bandMark(power: number): "short" | "over" | "in" {
  if (power < SLING.bandLow) return "short";
  if (power > SLING.bandHigh) return "over";
  return "in";
}

/** One frame: `dtSec` is clamped to [0, 50 ms]. The rat always runs; the aim follows the pointer or the keys. */
export function stepSling(s: SlingState, dtSec: number, input: SlingInput): SlingState {
  const dtMs = Math.min(SLING.maxDt, Math.max(0, dtSec)) * 1000;
  const rat = stepRat(s.rat, dtMs);
  const keys = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const aimX = clamp(input.aimTo ?? s.aimX + keys * SLING.aimSpeed * (dtMs / 1000), SLING.laneMin, SLING.laneMax);
  const sinceAnswerMs = s.sinceAnswerMs + dtMs, stageMs = s.stageMs + dtMs;
  const armed = s.armed || !input.holding;
  const base = { ...s, rat, aimX, sinceAnswerMs, armed };
  switch (s.stage) {
    case "reload":
      return stageMs >= SLING.reloadMs ? { ...base, stage: "ready", stageMs: 0 } : { ...base, stageMs };
    case "ready":
      return input.holding && armed ? { ...base, stage: "draw", stageMs: 0, power: 0 } : { ...base, stageMs };
    case "draw": {
      const power = Math.min(1, stageMs / SLING.fillMs);
      if (input.holding && power < 1) return { ...base, stageMs, power };
      return { ...base, stage: "flight", stageMs: 0, power, armed: !input.holding, shotX: aimX, mark: null };
    }
    case "flight": {
      if (stageMs < SLING.flightMs) return { ...base, stageMs };
      // Measured when the shot would be sent: too late, and the shot is dropped (no result) for a new sling_start.
      if (sinceAnswerMs >= SLING.reaimMs) return { ...base, stage: "reaim", stageMs: 0, mark: null };
      const band = bandMark(s.power);
      const mark: SlingMark = band !== "in" ? band : Math.abs(rat.x - (s.shotX ?? aimX)) <= SLING.hitPx ? "hit" : "wide";
      return { ...base, stage: "send", stageMs: 0, mark };
    }
    default:
      return { ...base, stageMs };
  }
}

/** The overlay has sent the shot (sling_shoot, stage "send") or the new aim (sling_start, stage "reaim"): wait. */
export function slingSent(s: SlingState): SlingState {
  return s.stage === "send" || s.stage === "reaim" ? { ...s, stage: "wait", stageMs: 0 } : s;
}

/** A sling answer came (a miss, or the new aim): 2.2 s of reload, and the next shot's rat moves on its own seed. */
export function slingAnswered(s: SlingState): SlingState {
  const shots = s.mark !== null ? s.shots + 1 : s.shots;
  return {
    ...s, shots, stage: "reload", stageMs: 0, power: 0, mark: null, shotX: null, sinceAnswerMs: 0,
    rat: { ...s.rat, rng: (s.seed + SLING.shotStep * shots) | 0 },
  };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/sling.ts tests/unit/farm-sling.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the SlingGame state machine

lib/game/farm/sling.ts is the ná's minigame as a pure, seeded state machine. A rat
runs a lane (x 16–304) in runs of 0.5–1.2 s at 60–110 px/s and stops of 0.2–0.6 s,
on mulberry32(seed + 7919 · shot). The aim follows the pointer or ←/→ at 180 px/s.
Holding draws the band 0 → 1 in 1 s; under 0.60 the pellet falls short, over 0.85 it
flies over (a full draw lets go by itself), otherwise it lands 0.3 s after the release
and hits within 9 px of the shot. Every result waits out the flight; 2.2 s of reload
follow every answer, so no miss goes out before 2.5 s and no hit before 3.1 s. A shot
ready 55 s or more after the last answer is dropped for a new sling_start.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/sling.ts tests/unit/farm-sling.test.ts
git commit -F <message file>
```

---

### Task 9: The rats' texts, the handbook tab, the tasks and the lock texts

**Files:**
- Modify: `lib/anticheat.ts`, `lib/game/farm/actions.ts`, `lib/game/farm/handbook.ts`, `lib/game/farm/messages.ts`
- Test: `tests/unit/anticheat.test.ts`, `tests/unit/farm-actions.test.ts`, `tests/unit/farm-handbook.test.ts`, `tests/unit/farm-messages.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`RAT`, `RatLive`, `RatRecent`), Task 6 (`dogStatus`), Task 7 (`TOOL_SLING`, `AMMO_PELLET`, `FarmMine.dog`); `lib/anticheat.ts`' `durationVi`; `messages.ts`' `farmErrorMessage(err, itemName, context)`; `handbook.ts`' tabs and `HANDBOOK_TABS`; `actions.ts`' `dueTasks`.
- Produces:
  - `messages.ts` (§10.6, §12.1, §12.2): the v17 refusals in `farmErrorMessage` ("too fast" reads "Đang nạp đạn…" in the `"sling"` context), `NOT_OPEN_17`, `NO_PELLETS`, `RAT_DAILY_LIMIT_TEXT`, `ratLimitText(sec)`, `dogRestingText(sec)`, `slingGear(items)`, `ratPrompt(gear)`, `ratSpawnText`, `dogCatchText`, `ratSaleText`, `ratChipText`, `ratChipLabel`, `ratPlotText(live, lostPct)`, `slingTitle`, `SLING_HELP`, `SLING_CANCEL`, `slingStatus(pellets, reloading)`, `slingHitText(price)`, `ratGoneText(recent)`;
  - `handbook.ts` (§13): the tab `"rats"` "Chuột, chó & ná" (verbatim) once the items include the ná, the Mẹo tip; `handbookTabs(uplands, critters, items)`, `handbookTabFor(crop, v, now, ratted = false)`;
  - `actions.ts`: `dueTasks(…, rats = [])` lists the rats on my plots (urgent) and my hungry dog (plot 0, not urgent);
  - `lib/anticheat.ts`: `WARN_LOCK` with "săn chuột", `BAN_WIPE` with "chó" (§16).

- [ ] **Step 1: Write the failing tests**

**tests/unit/anticheat.test.ts — edit 1 of 2.** Replace:

```ts
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
```

with:

```ts
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, săn chuột, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
```

**tests/unit/anticheat.test.ts — edit 2 of 2.** Replace:

```ts
    expect(BAN_BODY).toBe("Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.");
    expect(BAN_WIPE).toBe("Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất).");
    expect(BAN_OK).toBe("Đăng xuất");
```

with:

```ts
    expect(BAN_BODY).toBe("Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.");
    expect(BAN_WIPE).toBe("Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất, chó).");
    expect(BAN_OK).toBe("Đăng xuất");
```

**tests/unit/farm-actions.test.ts.** Replace:

```ts
    expect(list.filter((t) => t.urgent)).toHaveLength(1);
  });
});
```

with:

```ts
    expect(list.filter((t) => t.urgent)).toHaveLength(1);
  });
  it("adds the rats eating my plots, urgent, and my hungry dog on a line of its own (v17 §12.1)", () => {
    const ripe = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [52, 1]]));
    const lans = plot(null, { no: 7, farmer: { id: "lan", name: "Lan" } });
    const rat = (id: number, no: number) => ({ id, plot: no, since: at(69), seed: id });
    expect(dueTasks([ripe, lans], "me", CATALOG, SICKLE, at(70), [rat(1, 5), rat(2, 5), rat(3, 7)])).toEqual([
      { plot: 5, text: "Thửa 5 · 🐀 Chuột đang phá (2 con) — bắn ná, dẫn chó tới hoặc thu hoạch cho xong", urgent: true },
      { plot: 5, text: "Thửa 5 · Gặt — còn 2 giờ", urgent: true },
    ]);
    const dog = { name: "Mực", coat: "muc" as const, adoptedAt: at(0), fedUntil: at(70), nextHuntAt: null, catches: 0 };
    expect(dueTasks([ripe], "me", CATALOG, { ...SICKLE, dog }, at(70))).toEqual([
      { plot: 5, text: "Thửa 5 · Gặt — còn 2 giờ", urgent: true },
      { plot: 0, text: "🐕 Mực đói — cho ăn để nó săn chuột", urgent: false },
    ]);
    expect(dueTasks([], "me", CATALOG, { ...SICKLE, dog: { ...dog, fedUntil: null } }, at(70))).toEqual([
      { plot: 0, text: "🐕 Mực đói — cho ăn để nó săn chuột", urgent: false },
    ]);
    expect(dueTasks([], "me", CATALOG, { ...SICKLE, dog: { ...dog, fedUntil: at(71) } }, at(70))).toEqual([]);
  });
});
```

**tests/unit/farm-handbook.test.ts.** Append at the end of the file, after a blank line:

```ts
describe("v17: the Chuột, chó & ná tab (§13)", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const KINDS = [critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 })];
  const SLING = farmItemFromRow({
    id: "tool_sling", kind: "tool", name: "Ná", price: 3000, sort_order: 30, variety: null, fert: null, pest_target: null, capacity: null,
  });
  it("comes last, once 0019 sells the ná", () => {
    expect(handbookTabs(UPLANDS, KINDS, [SLING]).map(([, label]) => label)).toEqual([
      "Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo", "Khoai lang", "Bắp", "Ớt", "Nông cụ", "Cua & ốc", "Chuột, chó & ná",
    ]);
    expect(handbookTabs(UPLANDS, [], [SLING]).map(([tab]) => tab).at(-1)).toBe("rats");
    expect(handbookTabs(UPLANDS, KINDS).map(([tab]) => tab)).not.toContain("rats");
    expect(handbookPage("rats", [nep], UPLANDS, [])).toEqual([]);
  });
  it("reads the spec's lines verbatim", () => {
    const page = handbookPage("rats", [nep], UPLANDS, [SLING]);
    expect(page.map((s) => s.title)).toEqual(["Mùa chuột", "Ná", "Chó cỏ"]);
    expect(page.map((s) => s.lines)).toEqual([
      [
        "Lúa, khoai lang, bắp chín là mùa chuột đồng. Chuột đào hang dưới bờ ruộng, cứ 10–20 phút lại có một con mò ra ăn một thửa đang chín; cả đồng cùng lúc tối đa 3 con. Ớt cay, chuột chê.",
        "Mỗi con chuột ngồi trên thửa ăn mất 2% sản lượng mỗi giờ; cộng lại chuột lấy tối đa 10% một vụ. Bắt được trong 15 phút thì gần như không mất gì.",
        "Chuột chỉ chịu đi khi bị bắt, hoặc khi thửa đó gặt xong cả 6 phần (hay đào, bẻ xong), thuê máy gặt, bỏ vụ hoặc bị mất. Gặt dở chừng thì chuột vẫn ăn phần còn lại.",
        "Chuột là của chung cả đồng: ai bắt trước thì được, kể cả chuột trên ruộng người khác. Mỗi người bắt tối đa 6 con mỗi giờ, 24 con mỗi ngày.",
        "Chuột bắt được bán cho cô Út: 150 xu × hệ số phòng (như giá cá), chốt giá lúc bắt.",
      ],
      [
        "Ná 3.000 xu, mua một lần ở tiệm anh Hai. Đạn đất 10 xu một viên — 10 viên 100 xu.",
        "Lại gần con chuột, bấm E (hoặc chạm vào nó) để giương ná. Rê chuột hoặc bấm ←/→ để ngắm; giữ Space (hoặc giữ chuột, giữ ngón tay) cho dây căng tới vùng xanh rồi thả.",
        "Căng chưa tới vùng xanh là đạn rơi trước, căng quá là đạn bay qua. Đạn bay mất một chút: chuột đang chạy thì ngắm đón đầu, hoặc chờ nó dừng lại gặm lúa.",
        "Mỗi phát tốn 1 viên, trúng là bắt được. Bắn xong phải nạp đạn 2 giây.",
      ],
      [
        "Nhận nuôi ở Hợp tác xã (chú Tám): 20.000 xu, mỗi người một con. Chọn màu lông vàng, mực, vện hay đốm, rồi đặt tên.",
        "Chó theo bạn khắp nơi: sảnh, ao cá, đồng ruộng. Ai trong phòng cũng thấy nó.",
        "Mỗi ngày cho ăn 1 bịch thức ăn chó (150 xu, tiệm anh Hai): no 24 giờ; còn no hơn 12 giờ thì chưa ăn thêm. Chú Tám cho ăn bữa đầu.",
        "Chó no, bạn ở ngoài đồng và đứng gần con chuột (cỡ một thửa ruộng) là nó tự vồ — 5 phút một lần, vồ là trúng. Chó đói chỉ đi theo; bạn ngồi im quá 3 phút thì nó cũng thôi săn.",
        "Vuốt ve cho vui — không tốn gì.",
      ],
    ]);
  });
  it("adds the rat tip to Mẹo, after the crab one", () => {
    const tip = "Lúa chín là mùa chuột — thu hoạch cho xong sớm (hoặc thuê máy gặt), hay rủ hàng xóm ra bắn chuột giùm.";
    const tips = handbookPage("tips", [nep], [], [SLING], KINDS)[0].lines;
    expect(tips.at(-1)).toBe(tip);
    expect(tips.at(-2)).toBe("Trong lúc chờ lúa, cứ 20 phút ghé bờ mương bắt cua, mò ốc — thêm tiền mà không tốn giống, phân.");
    expect(handbookPage("tips", [nep], [], [], KINDS)[0].lines).not.toContain(tip);
  });
  it("links a plot with rats to the tab", () => {
    const crop: CropView = {
      kind: "rice", variety: "nep", upland: null, phase: "ripe", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12),
      plantAt: null, water: 1, waterSetAt: at(12), pests: [], excessN: false, ripe: true, rottedAt: null, picking: null, pickings: 1,
      parts: 2, harvester: null, log: null,
    };
    expect(handbookTabFor(crop, nep, at(12 + 49), true)).toBe("rats");
    expect(handbookTabFor(crop, nep, at(12 + 49))).toBe("tools");
    expect(handbookTabFor(null, null, at(0), true)).toBe("process");
  });
});
```

**tests/unit/farm-messages.test.ts — edit 1 of 2.** Replace:

```ts
import {
  bedLevelsText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, durationText, farmErrorMessage,
  GATHER_LIMIT_TEXT, GIFT_TEXT, harvesterDoneText, harvesterStartText, harvestText, isMissingRpc, loadedText, NOT_OPEN_152, NOT_OPEN_153,
  partsDoneText, partText, PEST_NAME, PEST_REMEDY, pestSnailText, PHASE_NAME, pickingText, produceSaleText, produceSummary, riceSaleText,
  riceSummary, uplandPhaseName,
} from "@/lib/game/farm/messages";
```

with:

```ts
import {
  bedLevelsText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, dogCatchText, dogRestingText,
  durationText, farmErrorMessage, GATHER_LIMIT_TEXT, GIFT_TEXT, harvesterDoneText, harvesterStartText, harvestText, isMissingRpc, loadedText,
  NO_PELLETS, NOT_OPEN_152, NOT_OPEN_153, NOT_OPEN_17, partsDoneText, partText, PEST_NAME, PEST_REMEDY, pestSnailText, PHASE_NAME,
  pickingText, produceSaleText, produceSummary, RAT_DAILY_LIMIT_TEXT, ratChipLabel, ratChipText, ratGoneText, ratLimitText, ratPlotText,
  ratPrompt, ratSaleText, ratSpawnText, riceSaleText, riceSummary, SLING_CANCEL, SLING_HELP, slingGear, slingHitText, slingStatus,
  slingTitle, uplandPhaseName,
} from "@/lib/game/farm/messages";
```

**tests/unit/farm-messages.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("v17 texts (§10.6, §12)", () => {
  const m = (message: string, extra: Record<string, unknown> = {}, action?: string) => farmErrorMessage({ message, ...extra }, undefined, action);
  it("maps the rat, sling and dog refusals (§10.6), with the waits from the details", () => {
    expect(m("no sling")).toBe("Chưa có ná — mua ở tiệm anh Hai.");
    expect(m("no pellets")).toBe("Hết đạn đất — mua ở tiệm anh Hai.");
    expect(m("rat gone")).toBe("Con chuột này không còn nữa.");
    expect(m("rat limit", { details: "1500" })).toBe("Bạn bắt đủ 6 con chuột trong giờ này rồi — nghỉ 25 phút nhé.");
    expect(m("rat limit", { details: "125" })).toBe("Bạn bắt đủ 6 con chuột trong giờ này rồi — nghỉ 2 phút 5 giây nhé.");
    expect(m("rat limit")).toBe("Bạn bắt đủ 6 con chuột trong giờ này rồi — nghỉ ít phút nhé.");
    expect(m("rat daily limit", { details: "40000" })).toBe("Hôm nay bạn bắt đủ 24 con chuột rồi — mai nhé!");
    expect(m("no aim")).toBe("Ná chưa giương — thử lại nhé.");
    expect(m("aim expired")).toBe("Giương ná lâu quá — ngắm lại nhé.");
    expect(m("no dog")).toBe("Bạn chưa nuôi chó.");
    expect(m("dog hungry")).toBe("Chó đói rồi — cho ăn trước đã.");
    expect(m("dog resting", { details: "192" })).toBe("Chó đang nghỉ — 3 phút 12 giây nữa mới vồ tiếp.");
    expect(m("dog resting")).toBe("Chó đang nghỉ — ít phút nữa mới vồ tiếp.");
    expect(m("dog full")).toBe("Chó còn no — chưa ăn thêm được.");
    expect(m("already own dog")).toBe("Bạn đã nuôi một con rồi — mỗi người một con thôi.");
    expect(m("invalid name")).toBe("Tên chó cần 2–16 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã…) hoặc ký tự ẩn.");
    expect(m("nothing to sell")).toBe("Chưa có con chuột nào để bán.");
    expect(farmErrorMessage({ message: "no item" }, "thức ăn chó")).toBe("Chưa có thức ăn chó — ghé tiệm anh Hai.");
    expect(m("invalid coat")).toBe("Có lỗi, thử lại nhé.");
    expect([NO_PELLETS, RAT_DAILY_LIMIT_TEXT, ratLimitText(3600), dogRestingText(59)]).toEqual([
      "Hết đạn đất — mua ở tiệm anh Hai.", "Hôm nay bạn bắt đủ 24 con chuột rồi — mai nhé!",
      "Bạn bắt đủ 6 con chuột trong giờ này rồi — nghỉ 60 phút nhé.", "Chó đang nghỉ — 59 giây nữa mới vồ tiếp.",
    ]);
    expect(NOT_OPEN_17).toBe("Mùa chuột chưa mở — chủ phòng cần chạy migration 0019.");
  });
  it("reads too fast in the SlingGame's context, and keeps the others", () => {
    expect(m("too fast", {}, "sling")).toBe("Đang nạp đạn…");
    expect(m("too fast")).toBe("Từ từ thôi…");
    expect(m("aim expired", {}, "sling")).toBe("Giương ná lâu quá — ngắm lại nhé.");
  });
  it("tells the gear a rat's prompt needs (§12.1)", () => {
    expect(slingGear({})).toBe("no sling");
    expect(slingGear({ ammo_pellet: 12 })).toBe("no sling");
    expect(slingGear({ tool_sling: 1 })).toBe("no pellets");
    expect(slingGear({ tool_sling: 1, ammo_pellet: 0 })).toBe("no pellets");
    expect(slingGear({ tool_sling: 1, ammo_pellet: 12 })).toBeNull();
    expect([ratPrompt(null), ratPrompt("no sling"), ratPrompt("no pellets")]).toEqual([
      "Bắn chuột", "Chuột đồng (cần ná)", "Chuột đồng (hết đạn)",
    ]);
  });
  it("tells the field's toasts, the chip and the plot line (§12.1)", () => {
    expect(ratSpawnText(3)).toBe("🐀 Chuột mò ra phá thửa 3 của bạn!");
    expect(dogCatchText("Mực")).toBe("🐕 Mực vồ được một con chuột! Đem bán cho cô Út nhé.");
    expect(ratSaleText(3, 450)).toBe("💰 Bán 3 con chuột được 450 xu.");
    expect(ratSaleText(12, 4032)).toBe("💰 Bán 12 con chuột được 4.032 xu.");
    expect(ratChipText(2)).toBe("🐀 Mùa chuột · 2 con");
    expect(ratChipLabel(2)).toBe("Mùa chuột: 2 con chuột đang phá đồng — mở Sổ tay");
    expect(ratPlotText(2, 3.2)).toBe("🐀 2 con chuột đang ăn · đã mất ~3% (tối đa 10%)");
    expect(ratPlotText(1, 0.5)).toBe("🐀 1 con chuột đang ăn · đã mất dưới 1% (tối đa 10%)");
    expect(ratPlotText(0, 10)).toBe("🐀 0 con chuột đang ăn · đã mất ~10% (tối đa 10%)");
  });
  it("tells the SlingGame's lines (§12.2)", () => {
    expect(slingTitle(3)).toBe("🎯 Bắn chuột · thửa 3");
    expect(SLING_HELP).toBe("Rê chuột hoặc bấm ←/→ để ngắm. Giữ Space (hoặc giữ chuột, giữ ngón tay) cho dây căng tới vùng xanh rồi thả.");
    expect(slingStatus(12, true)).toBe("Đạn: 12 viên · Nạp đạn…");
    expect(slingStatus(11, false)).toBe("Đạn: 11 viên");
    expect(slingHitText(336)).toBe("🎯 Trúng! Bắt được chuột đồng — 336 xu, đem bán ở vựa cô Út.");
    expect(slingHitText(1050)).toBe("🎯 Trúng! Bắt được chuột đồng — 1.050 xu, đem bán ở vựa cô Út.");
    const r = { id: 1, plot: 3, since: 0, seed: 1, endedAt: 0, by: { id: "u2", name: "Lan" }, dog: null };
    expect(ratGoneText({ ...r, how: "sling" })).toBe("Chuột bị Lan bắt mất rồi!");
    expect(ratGoneText({ ...r, how: "dog", by: { id: "u3", name: "Dat" }, dog: "Mực" })).toBe("Chuột bị Mực của Dat vồ mất rồi!");
    expect(ratGoneText({ ...r, how: "fled", by: null })).toBe("Chuột chạy về hang rồi.");
    expect(ratGoneText(null)).toBe("Chuột chạy về hang rồi.");
    expect(SLING_CANCEL).toBe("Thôi (Esc)");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat.test.ts tests/unit/farm-actions.test.ts tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts`
Expected: FAIL — 11 tests fail in the 4 files (the lock text lacks "săn chuột"; no v17 refusals, no "Đang nạp đạn…", no rat prompt, toasts, chip, plot line or SlingGame lines; no "Chuột, chó & ná" tab or tip; no rat or dog tasks); 66 pass.

- [ ] **Step 3: Implement**

**lib/anticheat.ts — edit 1 of 2.** Replace:

```ts
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
```

with:

```ts
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, săn chuột, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
```

**lib/anticheat.ts — edit 2 of 2.** Replace:

```ts
export const BAN_BODY = "Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.";
export const BAN_WIPE = "Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất).";
export const BAN_OK = "Đăng xuất";
```

with:

```ts
export const BAN_BODY = "Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.";
export const BAN_WIPE = "Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất, chó).";
export const BAN_OK = "Đăng xuất";
```

**lib/game/farm/actions.ts — edit 1 of 4.** Replace:

```ts
} from "./crop";
import { critterCount, heldBox } from "./gather";
```

with:

```ts
} from "./crop";
import { dogStatus } from "../dog";
import { critterCount, heldBox } from "./gather";
```

**lib/game/farm/actions.ts — edit 2 of 4.** Replace:

```ts
import { TRANSPLANT } from "./minigames";
import type { FieldAction } from "./rpc";
```

with:

```ts
import { TRANSPLANT } from "./minigames";
import type { RatLive } from "./rats";
import type { FieldAction } from "./rpc";
```

**lib/game/farm/actions.ts — edit 3 of 4.** Replace:

```ts

/** What is due on the plots I farm (spec §13.1, v15.2 §13.3): urgent tasks first, then by plot. */
export function dueTasks(plots: readonly PlotView[], me: string, catalog: FarmCatalog, mine: FarmMine, now: number): FarmTask[] {
  const out: FarmTask[] = [];
  for (const p of plots) {
```

with:

```ts

/** What is due on the plots I farm (spec §13.1, v15.2 §13.3; v17 §12.1: the rats eating them, and my hungry dog on a
 *  line of its own, plot 0): urgent tasks first, then by plot. `rats` are the field's live rats. */
export function dueTasks(plots: readonly PlotView[], me: string, catalog: FarmCatalog, mine: FarmMine, now: number,
  rats: readonly RatLive[] = []): FarmTask[] {
  const out: FarmTask[] = [];
  if (mine.dog && !dogStatus(mine.dog, now).fed) out.push({ plot: 0, text: `🐕 ${mine.dog.name} đói — cho ăn để nó săn chuột`, urgent: false });
  for (const p of plots) {
```

**lib/game/farm/actions.ts — edit 4 of 4.** Replace:

```ts
    if (p.lease && p.lease.until - now <= 12 * HOUR_MS) add(`Hết hạn thuê sau ${durationText(p.lease.until - now)}`, p.lease.until - now <= 3 * HOUR_MS);
    const crop = p.crop;
```

with:

```ts
    if (p.lease && p.lease.until - now <= 12 * HOUR_MS) add(`Hết hạn thuê sau ${durationText(p.lease.until - now)}`, p.lease.until - now <= 3 * HOUR_MS);
    const eating = rats.filter((r) => r.plot === p.no).length;
    if (eating > 0) add(`🐀 Chuột đang phá (${eating} con) — bắn ná, dẫn chó tới hoặc thu hoạch cho xong`, true);
    const crop = p.crop;
```

**lib/game/farm/handbook.ts — edit 1 of 8.** Replace:

```ts
import { ripeAfterHours, uplandHours, type CritterKind, type FarmItem, type UplandCrop, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
```

with:

```ts
import { ripeAfterHours, TOOL_SLING, uplandHours, type CritterKind, type FarmItem, type UplandCrop, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
```

**lib/game/farm/handbook.ts — edit 2 of 8.** Replace:

```ts

// Sổ tay nhà nông (spec §8.9, v15.2 §14, v15.3 §14): the six rice tabs, one tab per hoa-màu crop worked out from its
// config, "Nông cụ", and "Cua & ốc" once 0018 has critters; the rice timings are worked out per variety from the
// catalog. Pure.

/** A rice tab, "tools", "critters", or a hoa-màu crop's id. */
export type HandbookTab = string;
```

with:

```ts

// Sổ tay nhà nông (spec §8.9, v15.2 §14, v15.3 §14, v17 §13): the six rice tabs, one tab per hoa-màu crop worked out
// from its config, "Nông cụ", "Cua & ốc" once 0018 has critters, and "Chuột, chó & ná" once 0019 sells the ná; the
// rice timings are worked out per variety from the catalog. Pure.

/** A rice tab, "tools", "critters", "rats", or a hoa-màu crop's id. */
export type HandbookTab = string;
```

**lib/game/farm/handbook.ts — edit 3 of 8.** Replace:

```ts

/** Every tab (§14): the rice ones, a tab per hoa-màu crop, Nông cụ, then Cua & ốc when there are critters (0018). */
export function handbookTabs(uplands: readonly UplandCrop[], critters: readonly CritterKind[] = []): ReadonlyArray<[HandbookTab, string]> {
  return [
```

with:

```ts

/** 0019 is in: anh Hai sells the ná. */
const ratsOpen = (items: readonly FarmItem[]): boolean => items.some((i) => i.id === TOOL_SLING);

/** Every tab (§14): the rice ones, a tab per hoa-màu crop, Nông cụ, then Cua & ốc when there are critters (0018), and
 *  Chuột, chó & ná when the shop has the ná (0019). */
export function handbookTabs(uplands: readonly UplandCrop[], critters: readonly CritterKind[] = [],
  items: readonly FarmItem[] = []): ReadonlyArray<[HandbookTab, string]> {
  return [
```

**lib/game/farm/handbook.ts — edit 4 of 8.** Replace:

```ts
    ...(critters.length > 0 ? [["critters", "Cua & ốc"] as [HandbookTab, string]] : []),
  ];
```

with:

```ts
    ...(critters.length > 0 ? [["critters", "Cua & ốc"] as [HandbookTab, string]] : []),
    ...(ratsOpen(items) ? [["rats", "Chuột, chó & ná"] as [HandbookTab, string]] : []),
  ];
```

**lib/game/farm/handbook.ts — edit 5 of 8.** Replace:

```ts

/** The hour marks of a season for one variety (hours after transplanting unless said). */
```

with:

```ts

/** The Chuột, chó & ná tab (v17 §13), verbatim. */
const RATS_PAGE: HandbookSection[] = [
  {
    title: "Mùa chuột",
    lines: [
      "Lúa, khoai lang, bắp chín là mùa chuột đồng. Chuột đào hang dưới bờ ruộng, cứ 10–20 phút lại có một con mò ra ăn một thửa đang chín; cả đồng cùng lúc tối đa 3 con. Ớt cay, chuột chê.",
      "Mỗi con chuột ngồi trên thửa ăn mất 2% sản lượng mỗi giờ; cộng lại chuột lấy tối đa 10% một vụ. Bắt được trong 15 phút thì gần như không mất gì.",
      "Chuột chỉ chịu đi khi bị bắt, hoặc khi thửa đó gặt xong cả 6 phần (hay đào, bẻ xong), thuê máy gặt, bỏ vụ hoặc bị mất. Gặt dở chừng thì chuột vẫn ăn phần còn lại.",
      "Chuột là của chung cả đồng: ai bắt trước thì được, kể cả chuột trên ruộng người khác. Mỗi người bắt tối đa 6 con mỗi giờ, 24 con mỗi ngày.",
      "Chuột bắt được bán cho cô Út: 150 xu × hệ số phòng (như giá cá), chốt giá lúc bắt.",
    ],
  },
  {
    title: "Ná",
    lines: [
      "Ná 3.000 xu, mua một lần ở tiệm anh Hai. Đạn đất 10 xu một viên — 10 viên 100 xu.",
      "Lại gần con chuột, bấm E (hoặc chạm vào nó) để giương ná. Rê chuột hoặc bấm ←/→ để ngắm; giữ Space (hoặc giữ chuột, giữ ngón tay) cho dây căng tới vùng xanh rồi thả.",
      "Căng chưa tới vùng xanh là đạn rơi trước, căng quá là đạn bay qua. Đạn bay mất một chút: chuột đang chạy thì ngắm đón đầu, hoặc chờ nó dừng lại gặm lúa.",
      "Mỗi phát tốn 1 viên, trúng là bắt được. Bắn xong phải nạp đạn 2 giây.",
    ],
  },
  {
    title: "Chó cỏ",
    lines: [
      "Nhận nuôi ở Hợp tác xã (chú Tám): 20.000 xu, mỗi người một con. Chọn màu lông vàng, mực, vện hay đốm, rồi đặt tên.",
      "Chó theo bạn khắp nơi: sảnh, ao cá, đồng ruộng. Ai trong phòng cũng thấy nó.",
      "Mỗi ngày cho ăn 1 bịch thức ăn chó (150 xu, tiệm anh Hai): no 24 giờ; còn no hơn 12 giờ thì chưa ăn thêm. Chú Tám cho ăn bữa đầu.",
      "Chó no, bạn ở ngoài đồng và đứng gần con chuột (cỡ một thửa ruộng) là nó tự vồ — 5 phút một lần, vồ là trúng. Chó đói chỉ đi theo; bạn ngồi im quá 3 phút thì nó cũng thôi săn.",
      "Vuốt ve cho vui — không tốn gì.",
    ],
  },
];
/** The tip v17 adds to Mẹo (§13). */
const RAT_TIP = "Lúa chín là mùa chuột — thu hoạch cho xong sớm (hoặc thuê máy gặt), hay rủ hàng xóm ra bắn chuột giùm.";

/** The hour marks of a season for one variety (hours after transplanting unless said). */
```

**lib/game/farm/handbook.ts — edit 6 of 8.** Replace:

```ts
            : []),
        ],
```

with:

```ts
            : []),
          ...(ratsOpen(items) ? [RAT_TIP] : []),
        ],
```

**lib/game/farm/handbook.ts — edit 7 of 8.** Replace:

```ts
      return critters.length > 0 ? critterHandbook(critters, items) : [];
    default: {
```

with:

```ts
      return critters.length > 0 ? critterHandbook(critters, items) : [];
    case "rats":
      return ratsOpen(items) ? RATS_PAGE : [];
    default: {
```

**lib/game/farm/handbook.ts — edit 8 of 8.** Replace:

```ts

/** The tab the plot panel links to: what matters on this crop now — the crop's tab for beds, Nông cụ for ripe or partly
 *  cut rice (§13.1). */
export function handbookTabFor(crop: CropView | null, v: Variety | null, now: number): HandbookTab {
  if (!crop) return "process";
  if (crop.kind === "upland") return crop.upland ?? "process";
```

with:

```ts

/** The tab the plot panel links to: what matters on this crop now — Chuột, chó & ná on a plot with a rat log (v17
 *  §12.1), the crop's tab for beds, Nông cụ for ripe or partly cut rice (§13.1). */
export function handbookTabFor(crop: CropView | null, v: Variety | null, now: number, ratted = false): HandbookTab {
  if (!crop) return "process";
  if (ratted) return "rats";
  if (crop.kind === "upland") return crop.upland ?? "process";
```

**lib/game/farm/messages.ts — edit 1 of 7.** Replace:

```ts
import { lockSeconds, lockText } from "@/lib/anticheat";
import type { CritterKind, UplandCrop } from "./catalog";
import { GATHER, lowerFirst } from "./gather";
import type { CatchAnswer } from "./rpc";
```

with:

```ts
import { durationVi, lockSeconds, lockText } from "@/lib/anticheat";
import { AMMO_PELLET, TOOL_SLING, type CritterKind, type UplandCrop } from "./catalog";
import { GATHER, lowerFirst } from "./gather";
import { RAT, type RatRecent } from "./rats";
import type { CatchAnswer } from "./rpc";
```

**lib/game/farm/messages.ts — edit 2 of 7.** Replace:

```ts

// The farm's Vietnamese texts (spec §8, §11.7, §13; v15.2 §11.7, §13; v15.3 §11.8, §13): names, durations, toasts and
// the RPC errors. Pure.
```

with:

```ts

// The farm's Vietnamese texts (spec §8, §11.7, §13; v15.2 §11.7, §13; v15.3 §11.8, §13; v17 §10.6, §12): names,
// durations, toasts and the RPC errors. Pure.
```

**lib/game/farm/messages.ts — edit 3 of 7.** Replace:

```ts
export const NOT_OPEN_153 = "Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
```

with:

```ts
export const NOT_OPEN_153 = "Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018.";
/** A v17 action (the ná, the dog, the rat sale) against a database without 0019 (v17 §10.6). */
export const NOT_OPEN_17 = "Mùa chuột chưa mở — chủ phòng cần chạy migration 0019.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
```

**lib/game/farm/messages.ts — edit 4 of 7.** Replace:

```ts

/** The seconds an error's details carry (hole empty, bed empty), as ms; null without them. */
function detailMs(err: unknown): number | null {
```

with:

```ts

// v17 (§10.6, §12): the rats, the ná and the dog.

/** No pellets (§10.6), which also ends a SlingGame (§12.2). */
export const NO_PELLETS = "Hết đạn đất — mua ở tiệm anh Hai.";
export const RAT_DAILY_LIMIT_TEXT = `Hôm nay bạn bắt đủ ${RAT.dayCap} con chuột rồi — mai nhé!`;
/** A catch cap's wait, or a resting dog's, from the refusal's seconds; "ít phút" when the answer has none. */
export function ratLimitText(sec: number | null): string {
  return `Bạn bắt đủ ${RAT.hourCap} con chuột trong giờ này rồi — nghỉ ${sec === null ? "ít phút" : durationVi(sec)} nhé.`;
}
export function dogRestingText(sec: number | null): string {
  return `Chó đang nghỉ — ${sec === null ? "ít phút" : durationVi(sec)} nữa mới vồ tiếp.`;
}

/** What stops a shot before the server would (§12.1), as its refusal: no ná, then no pellet; null with both. */
export function slingGear(items: Readonly<Record<string, number>>): "no sling" | "no pellets" | null {
  if ((items[TOOL_SLING] ?? 0) < 1) return "no sling";
  return (items[AMMO_PELLET] ?? 0) < 1 ? "no pellets" : null;
}
/** A rat's field prompt (§12.1), after the shell's "E · ". */
export function ratPrompt(gear: "no sling" | "no pellets" | null): string {
  return gear === "no sling" ? "Chuột đồng (cần ná)" : gear === "no pellets" ? "Chuột đồng (hết đạn)" : "Bắn chuột";
}

/** The toasts (§12.1): a rat out on my plot (once per rat), my dog's catch, and cô Út's for sell_rats. */
export function ratSpawnText(plot: number): string {
  return `🐀 Chuột mò ra phá thửa ${plot} của bạn!`;
}
export function dogCatchText(dog: string): string {
  return `🐕 ${dog} vồ được một con chuột! Đem bán cho cô Út nhé.`;
}
export function ratSaleText(n: number, xu: number): string {
  return `💰 Bán ${n} con chuột được ${xu.toLocaleString("vi-VN")} xu.`;
}

/** The field chip (§12.1) while rats are live: its text and its aria-label. */
export function ratChipText(n: number): string {
  return `🐀 Mùa chuột · ${n} con`;
}
export function ratChipLabel(n: number): string {
  return `Mùa chuột: ${n} con chuột đang phá đồng — mở Sổ tay`;
}

/** The plot panel's line (§12.1) on a plot with a rat log: the rats on it now and the share lost so far. */
export function ratPlotText(live: number, lostPct: number): string {
  return `🐀 ${live} con chuột đang ăn · đã mất ${lostPct < 1 ? "dưới 1%" : `~${Math.round(lostPct)}%`} (tối đa 10%)`;
}

/** The SlingGame overlay (§12.2); the misses are sling.ts's SLING_MISS. */
export function slingTitle(plot: number): string {
  return `🎯 Bắn chuột · thửa ${plot}`;
}
export const SLING_HELP = "Rê chuột hoặc bấm ←/→ để ngắm. Giữ Space (hoặc giữ chuột, giữ ngón tay) cho dây căng tới vùng xanh rồi thả.";
export const SLING_CANCEL = "Thôi (Esc)";
export function slingStatus(pellets: number, reloading: boolean): string {
  return `Đạn: ${pellets} viên${reloading ? " · Nạp đạn…" : ""}`;
}
export function slingHitText(price: number): string {
  return `🎯 Trúng! Bắt được chuột đồng — ${price.toLocaleString("vi-VN")} xu, đem bán ở vựa cô Út.`;
}
/** Why the rat is gone (§12.2), from its `recent` entry when there is one: a sling, a dog, or back to its hole. */
export function ratGoneText(r: RatRecent | null): string {
  if (r?.how === "sling" && r.by) return `Chuột bị ${r.by.name} bắt mất rồi!`;
  if (r?.how === "dog" && r.by) return `Chuột bị ${r.dog ?? "chó"} của ${r.by.name} vồ mất rồi!`;
  return "Chuột chạy về hang rồi.";
}

/** The seconds an error's details carry (hole empty, bed empty, rat limit, dog resting), as ms; null without them. */
function detailMs(err: unknown): number | null {
```

**lib/game/farm/messages.ts — edit 5 of 7.** Replace:

```ts
}

/** Vietnamese toast text for a farm RPC error (spec §11.7, v15.2 §11.7, v15.3 §11.8). `itemName` names the item a
 *  "no item" error is about, or the container a "critters full" one is; `action` reads a round's refusals in its
 *  context: "harvest_part" (HarvestGame), "crab_finish" (CrabGame) or "transplant" (TransplantGame). */
export function farmErrorMessage(err: unknown, itemName?: string, action?: string): string {
```

with:

```ts
}
const detailSec = (err: unknown): number | null => {
  const ms = detailMs(err);
  return ms === null ? null : ms / 1000;
};

/** Vietnamese toast text for a farm RPC error (spec §11.7, v15.2 §11.7, v15.3 §11.8, v17 §10.6; the dog calls share
 *  it). `itemName` names the item a "no item" error is about, or the container a "critters full" one is; `action`
 *  reads a round's refusals in its context: "harvest_part" (HarvestGame), "crab_finish" (CrabGame), "transplant"
 *  (TransplantGame) or "sling" (SlingGame). */
export function farmErrorMessage(err: unknown, itemName?: string, action?: string): string {
```

**lib/game/farm/messages.ts — edit 6 of 7.** Replace:

```ts
      return round ? "Chưa xong bó lúa — thử lại sau vài giây." : crab ? "Chưa bắt xong — thử lại sau vài giây."
        : tp ? "Chưa cấy xong hàng mạ — thử lại sau vài giây." : TOO_FAST;
    case "no sickle": return "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).";
```

with:

```ts
      return round ? "Chưa xong bó lúa — thử lại sau vài giây." : crab ? "Chưa bắt xong — thử lại sau vài giây."
        : tp ? "Chưa cấy xong hàng mạ — thử lại sau vài giây." : action === "sling" ? "Đang nạp đạn…" : TOO_FAST;
    case "no sickle": return "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).";
```

**lib/game/farm/messages.ts — edit 7 of 7.** Replace:

```ts
    case "no critters": return "Không có cua ốc để bán.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
```

with:

```ts
    case "no critters": return "Không có cua ốc để bán.";
    case "no sling": return "Chưa có ná — mua ở tiệm anh Hai.";
    case "no pellets": return NO_PELLETS;
    case "rat gone": return "Con chuột này không còn nữa.";
    case "rat limit": return ratLimitText(detailSec(err));
    case "rat daily limit": return RAT_DAILY_LIMIT_TEXT;
    case "no aim": return "Ná chưa giương — thử lại nhé.";
    case "aim expired": return "Giương ná lâu quá — ngắm lại nhé.";
    case "no dog": return "Bạn chưa nuôi chó.";
    case "dog hungry": return "Chó đói rồi — cho ăn trước đã.";
    case "dog resting": return dogRestingText(detailSec(err));
    case "dog full": return "Chó còn no — chưa ăn thêm được.";
    case "already own dog": return "Bạn đã nuôi một con rồi — mỗi người một con thôi.";
    case "invalid name": return "Tên chó cần 2–16 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã…) hoặc ký tự ẩn.";
    case "nothing to sell": return "Chưa có con chuột nào để bán.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (4 files, 77 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/anticheat.ts lib/game/farm/actions.ts lib/game/farm/handbook.ts lib/game/farm/messages.ts tests/unit/anticheat.test.ts tests/unit/farm-actions.test.ts tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the rats' texts, the handbook tab, the tasks and the lock texts

farmErrorMessage maps the v17 refusals (§10.6): the rat and dog waits come from the
refusal's seconds through durationVi, and "too fast" reads "Đang nạp đạn…" in the
SlingGame's context. messages.ts gains NOT_OPEN_17, the rat prompt and the gear it
needs, the toasts, the chip, the plot line and the SlingGame's lines (§12.1, §12.2).
The handbook gains "Chuột, chó & ná" (§13, verbatim) and the Mẹo tip once the shop
sells the ná (0019), and a plot with rats links to it. dueTasks lists the rats
eating my plots (urgent) and my hungry dog on a line of its own. WARN_LOCK names
"săn chuột" after "bắt cua mò ốc", and BAN_WIPE's list ends with "chó" (§16).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/anticheat.ts lib/game/farm/actions.ts lib/game/farm/handbook.ts lib/game/farm/messages.ts tests/unit/anticheat.test.ts tests/unit/farm-actions.test.ts tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts
git commit -F <message file>
```

---

### Task 10: Rat holes on the field and the nearest rat

**Files:**
- Modify: `lib/game/farm/rats.ts`, `lib/game/maps/field-art.ts`, `lib/game/maps/field.ts`
- Test: `tests/unit/farm-rats.test.ts`, `tests/unit/game-field-map.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`ratPos`, `RatLive`, `RatPose`); `field.ts`' `FIELD_PLOTS`; `field-art.ts`' painters.
- Produces: `field.ts`' `RAT_HOLES` (one per plot, on its outer bund: `x = rect.x + 100`, y 46 north of plots 1–4, 310 between the village rows, 412 on the south edge; D9); `field-art.ts`' hole painter (§14); `rats.ts`' `ratHome(plot)`, `ratAt(rat, t)` and `nearestRat(live, pos, t, radius)`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-rats.test.ts — edit 1 of 2.** Replace:

```ts
import {
  FULL_CAPS, parseRatBag, parseRatCaps, parseRats, RAT, ratFactor, ratFleePos, ratHours, ratPos, type RatLogEntry,
} from "@/lib/game/farm/rats";
```

with:

```ts
import {
  FULL_CAPS, nearestRat, parseRatBag, parseRatCaps, parseRats, RAT, ratAt, ratFactor, ratFleePos, ratHome, ratHours, ratPos,
  type RatLogEntry,
} from "@/lib/game/farm/rats";
```

**tests/unit/farm-rats.test.ts — edit 2 of 2.** Replace:

```ts

describe("the field's rats (§10.5)", () => {
```

with:

```ts

describe("the rats on the field map (§5.4, §7.2)", () => {
  const T = Date.parse("2026-09-26T08:00:00Z");
  it("finds each plot's hole and rect, and draws a live rat from them", () => {
    expect(ratHome(1)).toEqual({ hole: { x: 172, y: 46 }, rect: { x: 72, y: 52, w: 128, h: 96 } });
    expect(ratHome(9)).toEqual({ hole: { x: 324, y: 412 }, rect: { x: 224, y: 328, w: 128, h: 76 } });
    expect([ratHome(0), ratHome(11)]).toEqual([null, null]);
    const r = { id: 1, plot: 1, since: T, seed: 1234567 };
    expect(ratAt(r, T + 20_000)).toEqual(ratPos(1234567, T, { x: 172, y: 46 }, { x: 72, y: 52, w: 128, h: 96 }, T + 20_000));
    expect(ratAt(r, T - 1)).toBeNull();
    expect(ratAt({ ...r, plot: 12 }, T + 20_000)).toBeNull();
  });
  it("finds the rat drawn nearest a point, within the radius", () => {
    // at `since` a rat is at its hole: plot 5's is (172, 310), plot 6's (324, 310), plot 1's (172, 46)
    const rat = (id: number, plot: number) => ({ id, plot, since: T, seed: id });
    const live = [rat(1, 5), rat(2, 6), rat(3, 1)];
    expect(nearestRat(live, { x: 180, y: 310 }, T, 96)?.id).toBe(1);
    expect(nearestRat(live, { x: 300, y: 310 }, T, 96)?.id).toBe(2);
    expect(nearestRat(live, { x: 247, y: 310 }, T, 96)?.id).toBe(1);
    expect(nearestRat(live, { x: 172, y: 406 }, T, 96)?.id).toBe(1);
    expect(nearestRat(live, { x: 172, y: 407 }, T, 96)).toBeNull();
    expect(nearestRat(live, { x: 172, y: 86 }, T, 40)?.id).toBe(3);
    expect(nearestRat(live, { x: 172, y: 87 }, T, 40)).toBeNull();
    expect(nearestRat(live, { x: 180, y: 310 }, T - 1, 96)).toBeNull();
    expect(nearestRat([], { x: 180, y: 310 }, T, 96)).toBeNull();
  });
  it("measures from where the rat is drawn now", () => {
    const r = { id: 7, plot: 5, since: T, seed: 7 };
    const t = T + 30_000, p = ratAt(r, t)!;
    expect(nearestRat([r], { x: p.x + 90, y: p.y }, t, 96)?.id).toBe(7);
    expect(nearestRat([r], { x: p.x, y: p.y + 97 }, t, 96)).toBeNull();
  });
});

describe("the field's rats (§10.5)", () => {
```

**tests/unit/game-field-map.test.ts — edit 1 of 2.** Replace:

```ts
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "@/lib/game/maps/arrivals";
import { BRIDGES, buildFieldMap, CANAL, DRYING_SQUARES, DRYING_YARD, FIELD_PLOTS, FIELD_SOLIDS } from "@/lib/game/maps/field";
import { propFrame } from "@/lib/game/maps/props";
```

with:

```ts
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "@/lib/game/maps/arrivals";
import { BRIDGES, buildFieldMap, CANAL, DRYING_SQUARES, DRYING_YARD, FIELD_PLOTS, FIELD_SOLIDS, RAT_HOLES } from "@/lib/game/maps/field";
import { propFrame } from "@/lib/game/maps/props";
```

**tests/unit/game-field-map.test.ts — edit 2 of 2.** Replace:

```ts
  });
  it("blocks the canal but not its bridges, the buildings, and not the drying yard", () => {
```

with:

```ts
  });
  it("digs a rat hole on the bund by each plot, clear of solids, the canal, use spots and posts (v17 §5.4, §14)", () => {
    expect(RAT_HOLES).toEqual([
      { x: 172, y: 46 }, { x: 324, y: 46 }, { x: 476, y: 46 }, { x: 628, y: 46 },
      { x: 172, y: 310 }, { x: 324, y: 310 }, { x: 476, y: 310 },
      { x: 172, y: 412 }, { x: 324, y: 412 }, { x: 476, y: 412 },
    ]);
    RAT_HOLES.forEach((h, i) => {
      const no = i + 1, art: Rect = { x: h.x - 5, y: h.y - 2, w: 11, h: 6 };   // the burrow, its rim and its crumbs
      for (const s of [...FIELD_SOLIDS, CANAL, ...BRIDGES, DRYING_YARD]) expect(overlaps(art, s), `hole ${no}`).toBe(false);
      for (const p of FIELD_PLOTS) expect(overlaps(art, p.rect), `hole ${no}/plot ${p.no}`).toBe(false);
      for (const o of field.interactables) {
        expect(overlaps(art, o.rect), `hole ${no}/${o.id}`).toBe(false);
        expect(Math.hypot(o.use.x - h.x, o.use.y - h.y), `hole ${no}/${o.id}`).toBeGreaterThanOrEqual(16);
      }
      for (const p of FIELD_PLOTS) expect(Math.hypot(p.post.x - h.x, p.post.y - h.y), `hole ${no}/post ${p.no}`).toBeGreaterThanOrEqual(16);
      expect(isBlockedAt(field, h.x, h.y), `hole ${no}`).toBe(false);
      // its own plot is the nearest, a few px away
      const nearest = FIELD_PLOTS.reduce((a, b) => (gap(h, b.rect) < gap(h, a.rect) ? b : a));
      expect(nearest.no, `hole ${no}`).toBe(no);
      expect(gap(h, nearest.rect), `hole ${no}`).toBeLessThanOrEqual(8);
    });
  });
  it("blocks the canal but not its bridges, the buildings, and not the drying yard", () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-rats.test.ts tests/unit/game-field-map.test.ts`
Expected: FAIL — 4 tests fail (no `ratHome`, `ratAt` or `nearestRat`; no rat holes on the field map); 2 files fail, 39 tests pass.

- [ ] **Step 3: Implement**

**lib/game/farm/rats.ts — edit 1 of 3.** Replace:

```ts
import { nextRandom } from "../fishing/reel";
import type { Rect } from "../maps/types";
```

with:

```ts
import { nextRandom } from "../fishing/reel";
import { FIELD_PLOTS, RAT_HOLES } from "../maps/field";
import type { Rect } from "../maps/types";
```

**lib/game/farm/rats.ts — edit 2 of 3.** Replace:

```ts
// same operations in the same order, pinned by the shared fixtures), draws each rat from its seed the same way on every
// client (ratPos) and reads the field's rats (parseRats). Pure.
```

with:

```ts
// same operations in the same order, pinned by the shared fixtures), draws each rat from its seed the same way on every
// client (ratPos, from its plot's hole: ratAt), finds the one nearest a player (nearestRat) and reads the field's rats
// (parseRats). Pure.
```

**lib/game/farm/rats.ts — edit 3 of 3.** Append at the end of the file, after a blank line:

```ts
/** A plot's hole and rect on the field map; null for a plot the map does not have. */
export function ratHome(plot: number): { hole: Vec; rect: Rect } | null {
  const g = FIELD_PLOTS.find((p) => p.no === plot), hole = RAT_HOLES[plot - 1];
  return g && hole ? { hole, rect: g.rect } : null;
}

/** Where a live rat is drawn at t; null before it comes out, or off the map. */
export function ratAt(r: RatLive, t: number): RatPose | null {
  const home = ratHome(r.plot);
  return home ? ratPos(r.seed, r.since, home.hole, home.rect, t) : null;
}

/** The live rat drawn nearest `pos` at t, within `radius` px (the auto-hunt's 96, the prompt's 40); null for none. */
export function nearestRat(live: readonly RatLive[], pos: Vec, t: number, radius: number): RatLive | null {
  let best: RatLive | null = null, bestD = Infinity;
  for (const r of live) {
    const p = ratAt(r, t);
    const d = p ? Math.hypot(p.x - pos.x, p.y - pos.y) : Infinity;
    if (d <= radius && d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best;
}
```

**lib/game/maps/field-art.ts — edit 1 of 3.** Replace:

```ts
import {
  BRIDGES, CANAL, COOP, CRAB_HOLES, DRYING_SQUARES, DRYING_YARD, FARM_SHOP, FIELD_H, FIELD_PLOTS, FIELD_W, RICE_DEPOT, SNAIL_BEDS,
} from "./field";
```

with:

```ts
import {
  BRIDGES, CANAL, COOP, CRAB_HOLES, DRYING_SQUARES, DRYING_YARD, FARM_SHOP, FIELD_H, FIELD_PLOTS, FIELD_W, RAT_HOLES, RICE_DEPOT,
  SNAIL_BEDS,
} from "./field";
```

**lib/game/maps/field-art.ts — edit 2 of 3.** Replace:

```ts

function paintBuildings(c: Ctx): void {
```

with:

```ts

/** A rat hole (v17 §14): a dark 7 × 4 burrow, its lit south rim and three crumbs of dug earth, 11 × 6 px in all around
 *  (x, y). */
function paintRatHole(c: Ctx, x: number, y: number): void {
  rect(c, "#24190f", x - 2, y - 2, 5, 1);
  rect(c, "#24190f", x - 3, y - 1, 7, 2);
  rect(c, "#24190f", x - 2, y + 1, 5, 1);
  rect(c, "#6e5230", x - 2, y + 2, 5, 1);
  px(c, "#8a6a3f", x - 5, y + 2);
  px(c, "#8a6a3f", x + 4, y + 3);
  px(c, "#8a6a3f", x + 5, y + 1);
}

function paintBuildings(c: Ctx): void {
```

**lib/game/maps/field-art.ts — edit 3 of 3.** Replace:

```ts
  for (const r of SNAIL_BEDS) paintBed(g, r);
  paintDryingYard(g);
```

with:

```ts
  for (const r of SNAIL_BEDS) paintBed(g, r);
  for (const h of RAT_HOLES) paintRatHole(g, h.x, h.y);
  paintDryingYard(g);
```

**lib/game/maps/field.ts — edit 1 of 2.** Replace:

```ts
import { ANH_HAI_LOOK, CHU_TAM_LOOK, CO_UT_LOOK } from "@/lib/game/look";
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "./arrivals";
```

with:

```ts
import { ANH_HAI_LOOK, CHU_TAM_LOOK, CO_UT_LOOK } from "@/lib/game/look";
import type { Vec } from "@/lib/game/types";
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "./arrivals";
```

**lib/game/maps/field.ts — edit 2 of 2.** Replace:

```ts
  }))),
];

/** Hợp tác xã (chú Tám), Tiệm vật tư nông nghiệp (anh Hai), Vựa lúa (cô Út) and the pump house (decoration). */
```

with:

```ts
  }))),
];

/** v17 (spec §5.4): a rat hole on the bund by each plot, 100 px along it — north of plots 1–4 under the bamboo (y 46),
 *  between the village rows for plots 5–7 (y 310), on the south edge for plots 8–10 (y 412). Indexed by plot − 1. */
export const RAT_HOLES: readonly Vec[] = FIELD_PLOTS.map((g) => ({ x: g.rect.x + 100, y: g.no <= 4 ? 46 : g.no <= 7 ? 310 : 412 }));

/** Hợp tác xã (chú Tám), Tiệm vật tư nông nghiệp (anh Hai), Vựa lúa (cô Út) and the pump house (decoration). */
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 43 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/rats.ts lib/game/maps/field-art.ts lib/game/maps/field.ts tests/unit/farm-rats.test.ts tests/unit/game-field-map.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): rat holes on the field and the nearest rat

field.ts gains RAT_HOLES, a hole on the bund by each plot 100 px along it (y 46 north
of plots 1–4, y 310 between the village rows, y 412 on the south edge), and
field-art.ts paints each: a dark 7 × 4 burrow, a lit south rim and three crumbs. The
map test pins that they avoid solids, the canal, use spots, name posts and plots.
rats.ts gains ratHome (a plot's hole and rect), ratAt (a live rat drawn from them)
and nearestRat (the rat drawn nearest a point within a radius: the auto-hunt's 96 px,
the prompt's 40 px).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/rats.ts lib/game/maps/field-art.ts lib/game/maps/field.ts tests/unit/farm-rats.test.ts tests/unit/game-field-map.test.ts
git commit -F <message file>
```

---

### Task 11: The rat's and the dog's art, five icons, and fa 11 and 12

**Files:**
- Create: `lib/game/art/dog.ts`, `lib/game/art/rats.ts`
- Modify: `lib/game/art/farm-anim.ts`, `lib/game/art/farm-icons.ts`, `lib/game/net/protocol.ts`
- Test: `tests/unit/game-dog-art.test.ts` (create); `tests/unit/game-farm-icons.test.ts`, `tests/unit/game-protocol.test.ts` (modify)

**Interfaces:**
- Consumes: Task 6 (`DogCoat`, `DogPose`); `farm-icons.ts`' `iconMatrixFor`; `farm-anim.ts`' poses; `protocol.ts`' `FARM_ANIM` and `isFarmAnim`.
- Produces (§14): `lib/game/art/rats.ts` (`RAT_W`, `RAT_H`, `RatFrame`, `RAT_FRAMES`, `RAT_PAL`, `RAT_ART`, `ratMatrix`, `ratFrame(moving, t)`, `drawRat(c, frame, dir, x, y, scale)`, feet-anchored); `lib/game/art/dog.ts` (`DOG_W`, `DOG_H`, `DOG_ANCHOR`, `DogFrame`, `DOG_FRAMES`, `COAT_PAL`, `DOG_FIXED`, `dogArt`, `dogMatrix`, `dogFrame(pose, t)`, `getDogFrames(coat)`, `drawDog`); the icons `tool_sling`, `ammo_pellet`, `food_dog`, `rat`, `dog_bowl`; `FarmAnim` 0–12 with `FARM_ANIM.pet` 11 and `.aim` 12, accepted by the parser (13 refused).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-dog-art.test.ts` with exactly:

```ts
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  COAT_PAL, DOG_ANCHOR, DOG_FIXED, DOG_FRAMES, DOG_H, DOG_W, dogArt, dogFrame, dogMatrix, drawDog, getDogFrames, type DogFrame,
} from "@/lib/game/art/dog";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawRat, RAT_ART, RAT_FRAMES, RAT_H, RAT_PAL, RAT_W, ratFrame, ratMatrix } from "@/lib/game/art/rats";
import { DOG_COATS } from "@/lib/game/dog";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import type { Facing } from "@/lib/game/types";

const FACINGS: Facing[] = ["down", "up", "left", "right"];

// jsdom has no 2D canvas: the sprite caches get blank canvases, quietly
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A 2D context that records the colour of every pixel filled, and the images drawn. */
function recorder() {
  const px: Array<{ col: string; x: number; y: number }> = [];
  const images: Array<[number, number, number?, number?]> = [];
  const c = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px.push({ col: String(this.fillStyle), x: x + i, y: y + j });
    },
    drawImage: vi.fn((_img: unknown, x: number, y: number, w?: number, h?: number) => { images.push([x, y, w, h]); }),
  };
  return { c: c as unknown as CanvasRenderingContext2D, px, images };
}

describe("the rat's art (§14)", () => {
  it("has five 10 × 7 side frames in its palette", () => {
    expect(RAT_FRAMES).toEqual(["run0", "run1", "nibble0", "nibble1", "fall"]);
    expect(RAT_PAL).toEqual({
      f: "#7a6450", s: "#5a4636", b: "#b8a48a", p: "#c98f86", e: "#1c1410", o: "#2e2218", g: "#e0b33c",
    });
    for (const f of RAT_FRAMES) {
      expect(RAT_ART[f], f).toHaveLength(RAT_H);
      for (const row of RAT_ART[f]) {
        expect(row, f).toHaveLength(RAT_W);
        for (const ch of row) expect(ch === "." || ch in RAT_PAL, `${f}: ${ch}`).toBe(true);
      }
    }
    // a nibbling rat has its grain; a running one does not
    expect(ratMatrix("nibble0", 1).flat()).toContain("#e0b33c");
    expect(ratMatrix("run0", 1).flat()).not.toContain("#e0b33c");
  });
  it("mirrors for left, and picks run or nibble frames by time", () => {
    for (const f of RAT_FRAMES) expect(ratMatrix(f, -1), f).toEqual(ratMatrix(f, 1).map((row) => [...row].reverse()));
    expect([ratFrame(true, 0), ratFrame(true, 120), ratFrame(true, 240)]).toEqual(["run0", "run1", "run0"]);
    expect([ratFrame(false, 0), ratFrame(false, 400)]).toEqual(["nibble0", "nibble1"]);
  });
  it("draws with its feet's middle at the point, at × 1 or × 2", () => {
    const r = recorder();
    drawRat(r.c, "run0", 1, 100, 50);
    drawRat(r.c, "fall", -1, 160, 70, 2);
    expect(r.images).toEqual([[95, 43, 10, 7], [150, 56, 20, 14]]);
  });
});

describe("the dog's art (§14)", () => {
  it("has every coat's colours", () => {
    expect(DOG_COATS.map((c) => COAT_PAL[c])).toEqual([
      { b: "#c8913f", B: "#9a6a2c", w: "#ecd3a2", d: "#9a6a2c" },
      { b: "#2f2a28", B: "#1b1716", w: "#5a4f48", d: "#1b1716" },
      { b: "#a8783e", B: "#7a5226", w: "#d8b88a", d: "#4a3018" },
      { b: "#efe6d4", B: "#c9bca4", w: "#fbf6ea", d: "#4a3a2a" },
    ]);
    expect(DOG_FIXED).toMatchObject({ n: "#1c1410", e: "#1c1410", t: "#d9776a", c: "#c0392b" });
  });
  it("draws every coat, facing and frame at 20 × 16 in the coat's palette, standing on its anchor", () => {
    expect(DOG_FRAMES).toHaveLength(13);
    const bad: string[] = [];
    for (const coat of DOG_COATS) {
      const allowed = new Set(["", ...Object.values(COAT_PAL[coat]), ...Object.values(DOG_FIXED)]);
      for (const facing of FACINGS) for (const frame of DOG_FRAMES) {
        const m = dogMatrix(coat, facing, frame), id = `${coat} ${facing} ${frame}`;
        if (m.length !== DOG_H || m.some((row) => row.length !== DOG_W)) bad.push(`${id}: size`);
        for (const col of m.flat()) if (!allowed.has(col)) bad.push(`${id}: ${col}`);
        // feet on the anchor's row, within 6 px of it, unless the dog runs or leaps
        if (!["run0", "run1", "leap"].includes(frame)) {
          const feet = m[DOG_ANCHOR.y].map((col, x) => (col ? Math.abs(x - DOG_ANCHOR.x) : 99));
          if (Math.min(...feet) > 6) bad.push(`${id}: feet`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 30_000);
  it("mirrors right for left, and moves between its frames", () => {
    for (const frame of DOG_FRAMES) {
      expect(dogMatrix("vang", "left", frame), frame).toEqual(dogMatrix("vang", "right", frame).map((row) => [...row].reverse()));
    }
    const pairs: Array<[DogFrame, DogFrame]> = [
      ["walk0", "walk2"], ["walk0", "idle"], ["walk2", "idle"], ["wag0", "wag1"], ["run0", "run1"], ["sit", "hungry"],
      ["sit", "idle"], ["carry", "idle"], ["leap", "idle"],
    ];
    for (const facing of ["down", "up", "right"] as const) {
      for (const [a, b] of pairs) expect(dogArt(facing, a).join("|"), `${facing} ${a}/${b}`).not.toBe(dogArt(facing, b).join("|"));
    }
  });
  it("puts vện's stripes and đốm's spots on the body, the others plain", () => {
    const count = (coat: "vang" | "muc" | "ven" | "dom") =>
      dogMatrix(coat, "right", "idle").flat().filter((c) => c === COAT_PAL[coat].d).length;
    const paws = dogArt("right", "idle").join("").split("").filter((ch) => ch === "d").length;
    expect(count("ven")).toBeGreaterThan(paws + 4);
    expect(count("dom")).toBeGreaterThan(paws + 4);
    // vàng and mực draw d as their shade: only the paws, the ear tip and the shaded pixels
    expect(dogMatrix("vang", "right", "idle").flat()).not.toContain("#4a3018");
  });
  it("hangs its ears and tail when hungry, shows the tongue when wagging, and carries the rat at its mouth", () => {
    expect(dogArt("right", "hungry")).not.toEqual(dogArt("right", "sit"));
    expect(dogArt("down", "wag0").join("")).toContain("t");
    expect(dogArt("right", "carry").join("")).toMatch(/R/);
    expect(dogArt("down", "carry").join("")).toMatch(/R/);
  });
  it("picks frames from the follower's pose and the time", () => {
    expect([0, 150, 300, 450, 600].map((t) => dogFrame("walk", t))).toEqual(["walk0", "walk1", "walk2", "walk3", "walk0"]);
    expect([dogFrame("run", 0), dogFrame("run", 100)]).toEqual(["run0", "run1"]);
    expect([dogFrame("wag", 0), dogFrame("wag", 150)]).toEqual(["wag0", "wag1"]);
    expect(["idle", "sit", "hungry", "leap", "carry"].map((p) => dogFrame(p as "idle", 777))).toEqual(["idle", "sit", "hungry", "leap", "carry"]);
  });
  it("caches the sprites per coat and draws the anchor at the point", () => {
    expect(getDogFrames("muc")).toBe(getDogFrames("muc"));
    expect(getDogFrames("muc").left.sit).toBeDefined();
    const r = recorder();
    drawDog(r.c, "ven", "down", "idle", 200, 120);
    expect(r.images).toEqual([[190, 105, undefined, undefined]]);
  });
});

describe("the v17 farm animations (§14)", () => {
  const feet = { x: 100, y: 100 };
  const colours = (a: 11 | 12, t: number, reduced = false, facing: Facing = "down") => {
    const r = recorder();
    drawFarmAnim(r.c, feet, facing, a, t, reduced);
    return r.px;
  };
  it("pets with the hand lowered in front and three rising hearts", () => {
    const px = colours(FARM_ANIM.pet, 0);
    expect(px.filter((p) => p.col === "#e0526a")).toHaveLength(3 * 6);
    expect(px.some((p) => p.col === "#e8b890")).toBe(true);
    const later = colours(FARM_ANIM.pet, 300);
    expect(later).not.toEqual(px);
    // reduced motion holds one pose
    expect(colours(FARM_ANIM.pet, 0, true)).toEqual(colours(FARM_ANIM.pet, 500, true));
  });
  it("aims with the fork, the band drawn back to the chest and a pellet, trembling every other beat", () => {
    const px = colours(FARM_ANIM.aim, 0);
    for (const col of ["#8b5a33", "#2e2a2a", "#a0522d"]) expect(px.some((p) => p.col === col), col).toBe(true);
    expect(colours(FARM_ANIM.aim, 180)).not.toEqual(px);
    expect(colours(FARM_ANIM.aim, 360)).toEqual(px);
    expect(colours(FARM_ANIM.aim, 180, true)).toEqual(colours(FARM_ANIM.aim, 0, true));
    for (const facing of FACINGS) expect(colours(FARM_ANIM.aim, 0, false, facing).length, facing).toBeGreaterThan(10);
  });
});
```

**tests/unit/game-farm-icons.test.ts — edit 1 of 2.** Replace:

```ts
  ...seeded("0013_v15_field.sql", "shop_items"), ...seeded("0016_v15_2_crops.sql", "shop_items"), ...seeded("0018_v15_3_gather.sql", "shop_items"),
];
```

with:

```ts
  ...seeded("0013_v15_field.sql", "shop_items"), ...seeded("0016_v15_2_crops.sql", "shop_items"), ...seeded("0018_v15_3_gather.sql", "shop_items"),
  ...seeded("0019_v17_rats.sql", "shop_items"),
];
```

**tests/unit/game-farm-icons.test.ts — edit 2 of 2.** Replace:

```ts
    expect(seeded("0018_v15_3_gather.sql", "shop_items")).toEqual(["box_bucket", "box_basket"]);
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet", ...produce, ...critters].sort());
  });
```

with:

```ts
    expect(seeded("0018_v15_3_gather.sql", "shop_items")).toEqual(["box_bucket", "box_basket"]);
    // v17: the three items of 0019, the depot's rat and the dog panel's bowl
    expect(seeded("0019_v17_rats.sql", "shop_items")).toEqual(["tool_sling", "ammo_pellet", "food_dog"]);
    expect(Object.keys(FARM_ICONS).sort()).toEqual(
      [...seededItems(), "rice_dry", "rice_wet", ...produce, ...critters, "rat", "dog_bowl"].sort(),
    );
  });
  it("draw the v17 ná, pellets, dog food, rat and bowl in their colours (§14)", () => {
    const colours: Record<string, string[]> = {
      tool_sling: ["#8b5a33", "#6e4424", "#2e2a2a", "#b0643a"],
      ammo_pellet: ["#a0522d", "#c9784a", "#d9c9a0"],
      food_dog: ["#d9c27a", "#b8a05a", "#f4efe0"],
      rat: ["#7a6450", "#5a4636", "#b8a48a", "#c98f86", "#1c1410"],
      dog_bowl: ["#b0643a", "#8a4a26", "#8b5a33"],
    };
    for (const [id, cols] of Object.entries(colours)) expect(iconMatrixFor(id)?.flat(), id).toEqual(expect.arrayContaining(cols));
  });
```

**tests/unit/game-protocol.test.ts — edit 1 of 2.** Replace:

```ts
  });
  it("accepts the field's fp (plot 0–10) and fa (animation 0–10)", () => {
    expect(GAME_EVENTS).toEqual(expect.arrayContaining(["fp", "fa"]));
```

with:

```ts
  });
  it("accepts the field's fp (plot 0–10) and fa (animation 0–12)", () => {
    expect(GAME_EVENTS).toEqual(expect.arrayContaining(["fp", "fa"]));
```

**tests/unit/game-protocol.test.ts — edit 2 of 2.** Replace:

```ts
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.pick }, B)).toEqual({ t: "fa", id: "a", a: 10 });
    const bad: Array<[string, unknown]> = [
      ["fp", { id: "a", p: 11 }], ["fp", { id: "a", p: -1 }], ["fp", { id: "a", p: 1.5 }], ["fp", { id: "a", p: "3" }], ["fp", { id: "a" }],
      ["fa", { id: "a", a: 11 }], ["fa", { id: "a", a: -1 }], ["fa", { id: "a", a: "1" }], ["fa", { id: "" , a: 1 }],
    ];
```

with:

```ts
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.pick }, B)).toEqual({ t: "fa", id: "a", a: 10 });
    // v17: petting a dog (11) and aiming a ná (12)
    expect([FARM_ANIM.pet, FARM_ANIM.aim]).toEqual([11, 12]);
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.pet }, B)).toEqual({ t: "fa", id: "a", a: 11 });
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.aim }, B)).toEqual({ t: "fa", id: "a", a: 12 });
    const bad: Array<[string, unknown]> = [
      ["fp", { id: "a", p: 11 }], ["fp", { id: "a", p: -1 }], ["fp", { id: "a", p: 1.5 }], ["fp", { id: "a", p: "3" }], ["fp", { id: "a" }],
      ["fa", { id: "a", a: 13 }], ["fa", { id: "a", a: -1 }], ["fa", { id: "a", a: "1" }], ["fa", { id: "" , a: 1 }],
    ];
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-dog-art.test.ts tests/unit/game-farm-icons.test.ts tests/unit/game-protocol.test.ts`
Expected: FAIL — `game-dog-art.test.ts` cannot load `@/lib/game/art/dog`, and 3 tests fail (no v17 icons; `fa` 11 and 12 refused); 3 files fail, 17 tests pass.

- [ ] **Step 3: Implement**

Create `lib/game/art/dog.ts` with exactly:

```ts
import type { DogCoat, DogPose } from "@/lib/game/dog";
import type { Facing } from "@/lib/game/types";

// v17 (spec §14): the dog (chó cỏ), 20 × 16 px anchored at (10, 15), for down, up and right (left mirrors right): walk
// 0–3, idle, sit, hungry (ears and tail down), run 0/1, leap, wag 0/1 and carry (the fall-rat at its mouth). Frames
// are built from parts; letters: b body, B shade, w muzzle and belly, d detail, n nose, e eyes, t tongue, c collar,
// and S R P the carried rat. A vện coat puts stripes, a đốm coat spots, on its body pixels. Cached per coat, like
// getCharacterFrames. Original art.

export const DOG_W = 20;
export const DOG_H = 16;
/** The pixel drawn at the dog's feet. */
export const DOG_ANCHOR = { x: 10, y: 15 } as const;

export type DogFrame =
  | "walk0" | "walk1" | "walk2" | "walk3" | "idle" | "sit" | "hungry" | "run0" | "run1" | "leap" | "wag0" | "wag1" | "carry";
export const DOG_FRAMES: readonly DogFrame[] = [
  "walk0", "walk1", "walk2", "walk3", "idle", "sit", "hungry", "run0", "run1", "leap", "wag0", "wag1", "carry",
];

/** The coats' b, B, w and d (§14). */
export const COAT_PAL: Readonly<Record<DogCoat, { b: string; B: string; w: string; d: string }>> = {
  vang: { b: "#c8913f", B: "#9a6a2c", w: "#ecd3a2", d: "#9a6a2c" },
  muc: { b: "#2f2a28", B: "#1b1716", w: "#5a4f48", d: "#1b1716" },
  ven: { b: "#a8783e", B: "#7a5226", w: "#d8b88a", d: "#4a3018" },
  dom: { b: "#efe6d4", B: "#c9bca4", w: "#fbf6ea", d: "#4a3a2a" },
};
/** Every coat's nose and eyes, tongue and collar, and the carried rat's fur, shade and tail. */
export const DOG_FIXED: Readonly<Record<string, string>> = {
  n: "#1c1410", e: "#1c1410", t: "#d9776a", c: "#c0392b", S: "#5a4636", R: "#7a6450", P: "#c98f86",
};

interface Part { top: number; rows: readonly string[] }
const at = (top: number, rows: readonly string[]): Part => ({ top, rows });

/** Paints the parts in order over a blank frame; "." leaves what is under it. */
function compose(...parts: Part[]): string[] {
  const m = Array.from({ length: DOG_H }, () => new Array<string>(DOG_W).fill("."));
  for (const p of parts) {
    p.rows.forEach((row, i) => {
      const y = p.top + i;
      if (y < 0 || y >= DOG_H) return;
      for (let x = 0; x < DOG_W; x++) if (row[x] !== undefined && row[x] !== ".") m[y][x] = row[x];
    });
  }
  return m.map((r) => r.join(""));
}

// ---------------------------------------------------------------- side (facing right)

const HEAD_S = [
  "..............Bd....",
  ".............BbbB...",
  "............bbbebb..",
  "............bbbbbwwn",
  "............cbbbwww.",
  "............cbbbb...",
];
const HEAD_S_TONGUE = [...HEAD_S.slice(0, 4), "............cbbbw.tt", "............cbbbb.t."];
const HEAD_S_RAT = [...HEAD_S.slice(0, 4), "............cbbbwSRS", "............cbbbbRRR", ".................P.."];
const TORSO_S = [
  "...bbbbbbbbbbbbbb...",
  "...bbbbbbbbbbbbbb...",
  "...Bbbbbbbbbbbbbb...",
  "....wwwwwwwwwwwbB...",
];
const LEGS_S = {
  idle: ["....bb.......bb.....", "....bb.......bb.....", "....bB.......bB.....", "....bB.......bB.....", "....dd.......dd....."],
  walk0: ["....bb.......bb.....", "...bb.........bb....", "...bB.........bB....", "..bB...........bB...", "..dd...........dd..."],
  walk1: ["....bbb.....bbb.....", ".....bb.....bb......", ".....bB.....bB......", ".....bB.....bB......", ".....dd.....dd......"],
  walk2: ["....bb.......bb.....", ".....bb.....bb......", "......bB...bB.......", "......bB...bB.......", "......dd...dd......."],
  run0: ["..bb..........bb....", ".bB............bB...", "bB..............bB..", "d................d.."],
  run1: ["......bb...bb.......", ".......bB.bB........", ".......dd.dd........", "...................."],
  leap: ["..bb...........bbb..", ".bB..............bB.", "bB.................d", "d..................."],
};
const TAIL_S_UP = [".d..................", ".b..................", "..b.................", "..bb................"];
const TAIL_S_WAG = ["...d................", "...b................", "..bb................", "..bb................"];
const TAIL_S_BACK = ["dbb................."];
const SIT_S_BODY = [
  "...........bcbbb....",
  "..........bbbbbw....",
  ".........bbbbbbw....",
  "........bbbbbbbw....",
  ".......Bbbbbbbbw....",
  ".......Bbbbbbbb.bb..",
  "......Bbbbbbbbb.bb..",
  "......bbbbbbbbb.bB..",
  "..dbbbBBBBBBBBB.bB..",
  "......dddd......dd..",
];
const HEAD_S_DROOP = [
  ".............bbb....",
  "............Bbbebb..",
  "............Bbbbbwwn",
  "............dcbbwww.",
];

function side(frame: DogFrame): string[] {
  const stand = (head: readonly string[], legs: readonly string[], tail: readonly string[]) =>
    compose(at(3, tail), at(1, head), at(7, TORSO_S), at(11, legs));
  switch (frame) {
    case "walk0": case "walk1": case "walk2": return stand(HEAD_S, LEGS_S[frame], TAIL_S_UP);
    case "walk3": case "idle": return stand(HEAD_S, LEGS_S.idle, TAIL_S_UP);
    case "wag0": return stand(HEAD_S_TONGUE, LEGS_S.idle, TAIL_S_UP);
    case "wag1": return stand(HEAD_S_TONGUE, LEGS_S.idle, TAIL_S_WAG);
    case "carry": return stand(HEAD_S_RAT, LEGS_S.walk1, TAIL_S_UP);
    case "run0": case "run1": return compose(at(8, TAIL_S_BACK), at(2, HEAD_S), at(8, TORSO_S), at(12, LEGS_S[frame]));
    case "leap": return compose(at(6, TAIL_S_BACK), at(0, HEAD_S), at(6, TORSO_S), at(10, LEGS_S.leap));
    case "sit": return compose(at(1, HEAD_S.slice(0, 5)), at(6, SIT_S_BODY));
    case "hungry": return compose(at(2, HEAD_S_DROOP), at(6, SIT_S_BODY));
  }
}

// ---------------------------------------------------------------- front (facing down) and back (facing up)

const HEAD_F = [
  "......Bd....dB......",
  "......BbbbbbbB......",
  ".......bebbeb.......",
  ".......bbwwbb.......",
  "........wnnw........",
  "........cccc........",
];
const HEAD_F_TONGUE = [...HEAD_F.slice(0, 5), "........cttc........"];
const HEAD_F_RAT = [...HEAD_F.slice(0, 5), ".......SRRRRS.......", "......P............."];
const HEAD_F_DROOP = [
  "....................",
  ".......bbbbbb.......",
  "......BbebbebB......",
  "......BbbwwbbB......",
  "......d.wnnw.d......",
  "........cccc........",
];
const HEAD_U = [
  "......Bb....bB......",
  "......BbbbbbbB......",
  ".......bbbbbb.......",
  ".......bbbbbb.......",
  "........bbbb........",
  "........cccc........",
];
const HEAD_U_RAT = [...HEAD_U, ".............P......"];
const HEAD_U_DROOP = [
  "....................",
  ".......bbbbbb.......",
  "......BbbbbbbB......",
  "......BbbbbbbB......",
  "......d.bbbb.d......",
  "........cccc........",
];
const TORSO_F = [".......bbwwbb.......", "......bbbwwbbb......", "......bbbwwbbb......", "......bbbwwbbb......"];
const TORSO_U = [".......bbbbbb.......", "......bbbbbbbb......", "......bbbbbbbb......", "......bBbbbbBb......"];
const LEGS_F = {
  idle: ["......bb....bb......", "......bb....bb......", "......bB....bB......", "......bB....bB......", "......dd....dd......"],
  walk0: ["......bb....bb......", "......bb....bb......", "......dd....bB......", "............bB......", "............dd......"],
  walk2: ["......bb....bb......", "......bb....bb......", "......bB....dd......", "......bB............", "......dd............"],
  run0: [".....bb......bb.....", "....bb........bb....", "....bB........bB....", "...dd..........dd..."],
  run1: [".......bb..bb.......", ".......bB..bB.......", ".......dd..dd......."],
};
const SIT_F_BODY = [
  ".......bbwwbb.......",
  "......bbbwwbbb......",
  "......bbbwwbbb......",
  ".....bbbbwwbbbb.....",
  ".....bbb.bb.bbb.....",
  ".....bbb.bb.bbb.....",
  ".....BBb.bB.bBB.....",
  ".....BBB.bB.BBB.....",
  ".....ddd.dd.ddd.....",
];
const SIT_U_BODY = [
  ".......bbbbbb.......",
  "......bbbbbbbb......",
  "......bbbbbbbb......",
  ".....bbbbbbbbbb.....",
  ".....bbbbbbbbbb.....",
  ".....bbbbbbbbbb.....",
  ".....BBbbbbbbBB.....",
  ".....BBBbbbbBBB.....",
  ".....ddd.bb.ddd.....",
];
/** The tail seen past the body: from the front it sticks out at a side, from behind it rises over the rump. */
const TAIL_F = [["...............d....", "..............b....."], ["....d...............", ".....b.............."]];
const TAIL_U = [[".........d..........", ".........B..........", ".........B.........."], ["..........d.........", "..........B.........", ".........BB........."]];

function frontBack(facing: "down" | "up", frame: DogFrame): string[] {
  const down = facing === "down";
  const head = down ? HEAD_F : HEAD_U, torso = down ? TORSO_F : TORSO_U;
  const tail = (k: number): Part => (down ? at(5, TAIL_F[k]) : at(8, TAIL_U[k]));
  const stand = (h: readonly string[], legs: readonly string[], t: Part | null) =>
    compose(...(t && down ? [t] : []), at(1, h), at(7, torso), at(11, legs), ...(t && !down ? [t] : []));
  switch (frame) {
    case "walk0": case "walk2": return stand(head, LEGS_F[frame], down ? null : tail(0));
    case "walk1": case "walk3": case "idle": return stand(head, LEGS_F.idle, down ? null : tail(0));
    case "wag0": return stand(down ? HEAD_F_TONGUE : head, LEGS_F.idle, tail(0));
    case "wag1": return stand(down ? HEAD_F_TONGUE : head, LEGS_F.idle, tail(1));
    case "carry": return stand(down ? HEAD_F_RAT : HEAD_U_RAT, LEGS_F.idle, down ? null : tail(0));
    case "run0": case "run1": return compose(at(1, head), at(7, torso), at(11, LEGS_F[frame]));
    case "leap": return compose(at(0, head), at(6, torso), at(10, LEGS_F.run1));
    case "sit": return compose(at(1, head), at(7, down ? SIT_F_BODY : SIT_U_BODY));
    case "hungry": return compose(at(1, down ? HEAD_F_DROOP : HEAD_U_DROOP), at(7, down ? SIT_F_BODY : SIT_U_BODY));
  }
}

/** The letters of a frame, facing right for "left" too (the matrix mirrors it). */
export function dogArt(facing: Facing, frame: DogFrame): string[] {
  return facing === "down" || facing === "up" ? frontBack(facing, frame) : side(frame);
}

/** A coat's pattern on a body pixel: vện's stripes below the head, đốm's 2 × 2 spots. */
function marked(coat: DogCoat, x: number, y: number): boolean {
  if (coat === "ven") return y >= 7 && (x + (y >> 2)) % 3 === 0;
  if (coat === "dom") return ((x >> 1) * 3 + (y >> 1) * 5) % 7 === 2;
  return false;
}

/** A frame's colours by row ("" = transparent) for a coat and a facing; "left" mirrors "right". */
export function dogMatrix(coat: DogCoat, facing: Facing, frame: DogFrame): string[][] {
  const pal = COAT_PAL[coat];
  const colours: Record<string, string> = { ...DOG_FIXED, b: pal.b, B: pal.B, w: pal.w, d: pal.d };
  const m = dogArt(facing, frame).map((row, y) => [...row].map((ch, x) => {
    if (ch === ".") return "";
    return ch === "b" && marked(coat, x, y) ? pal.d : colours[ch] ?? "";
  }));
  if (facing === "left") for (const row of m) row.reverse();
  return m;
}

/** What a dog shows (DogPose from the follower): walking legs every 150 ms, running every 100 ms, a wag every 150 ms. */
export function dogFrame(pose: DogPose, t: number): DogFrame {
  switch (pose) {
    case "walk": return (["walk0", "walk1", "walk2", "walk3"] as const)[Math.floor(t / 150) % 4];
    case "run": return Math.floor(t / 100) % 2 ? "run1" : "run0";
    case "wag": return Math.floor(t / 150) % 2 ? "wag1" : "wag0";
    default: return pose;
  }
}

const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];
type DogSprites = Record<Facing, Record<DogFrame, HTMLCanvasElement>>;
const cache = new Map<DogCoat, DogSprites>();

function toCanvas(m: string[][]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = DOG_W;
  cv.height = DOG_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  m.forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }));
  return cv;
}

/** Every facing × frame of a coat, rendered once. */
export function getDogFrames(coat: DogCoat): DogSprites {
  const hit = cache.get(coat);
  if (hit) return hit;
  const sprites = {} as DogSprites;
  for (const f of FACINGS) {
    sprites[f] = {} as Record<DogFrame, HTMLCanvasElement>;
    for (const fr of DOG_FRAMES) sprites[f][fr] = toCanvas(dogMatrix(coat, f, fr));
  }
  cache.set(coat, sprites);
  return sprites;
}

/** Draws a dog with its anchor at (x, y) (world px minus the camera). Browser only. */
export function drawDog(c: CanvasRenderingContext2D, coat: DogCoat, facing: Facing, frame: DogFrame, x: number, y: number): void {
  c.drawImage(getDogFrames(coat)[facing][frame], Math.round(x) - DOG_ANCHOR.x, Math.round(y) - DOG_ANCHOR.y);
}
```

**lib/game/art/farm-anim.ts — edit 1 of 4.** Replace:

```ts

// The farm animations (v15 spec §12, v15.2 §15), drawn in world pixels over a character while they play: seedlings,
// the sickle, pumped water, spray mist, fertilizer, a crab, a snail, the hoe, digging tubers and picking into a basket.
// Browser only (canvas). Original art.
```

with:

```ts

// The farm animations (v15 spec §12, v15.2 §15, v17 §14), drawn in world pixels over a character while they play:
// seedlings, the sickle, pumped water, spray mist, fertilizer, a crab, a snail, the hoe, digging tubers, picking into a
// basket, petting a dog (hearts) and aiming a ná. Browser only (canvas). Original art.
```

**lib/game/art/farm-anim.ts — edit 2 of 4.** Replace:

```ts
  corn: "#f6c945", chili: "#d8342a",
};
```

with:

```ts
  corn: "#f6c945", chili: "#d8342a",
  heart: "#e0526a", fork: "#8b5a33", band: "#2e2a2a", pellet: "#a0522d",
};
```

**lib/game/art/farm-anim.ts — edit 3 of 4.** Replace:

```ts
  return head;
}
```

with:

```ts
  return head;
}

/** A straight line of n + 1 pixels from a to b. */
function line(c: Ctx, col: string, a: Vec, b: Vec, n: number): void {
  for (let k = 0; k <= n; k++) px(c, col, a.x + ((b.x - a.x) * k) / n, a.y + ((b.y - a.y) * k) / n);
}

/** A 3 × 3 heart whose top middle is (x, y). */
function heart(c: Ctx, x: number, y: number): void {
  px(c, COL.heart, x - 1, y); px(c, COL.heart, x + 1, y);
  for (let d = -1; d <= 1; d++) px(c, COL.heart, x + d, y + 1);
  px(c, COL.heart, x, y + 2);
}
```

**lib/game/art/farm-anim.ts — edit 4 of 4.** Replace:

```ts
    }
  }
```

with:

```ts
    }
    case FARM_ANIM.pet: {
      // v17: the hand lowered in front, over the dog, and three hearts rising in turn
      c.fillStyle = COL.hand;
      c.fillRect(Math.round(g.x) - 1, Math.round(g.y) - 3, 3, 2);
      for (let k = 0; k < 3; k++) {
        const rise = reduced ? k / 3 : (t / 900 + k / 3) % 1;
        heart(c, g.x - 4 + k * 4, g.y - 7 - rise * 14);
      }
      break;
    }
    case FARM_ANIM.aim: {
      // v17: the ná at arm's length, its band drawn back to the chest with a pellet in the pouch, trembling every
      // other beat
      const s = reduced ? 0 : beat % 2;
      const grip = { x: hand.x + f.x * 6 + s, y: hand.y + f.y * 4 };
      for (let k = 0; k <= 2; k++) px(c, COL.fork, grip.x, grip.y + k);
      const l = { x: grip.x - 2, y: grip.y - 3 }, r = { x: grip.x + 2, y: grip.y - 3 };
      line(c, COL.fork, grip, l, 2);
      line(c, COL.fork, grip, r, 2);
      const chest = { x: feet.x + s - f.x * 2, y: feet.y - 24 };
      line(c, COL.band, l, chest, 6);
      line(c, COL.band, r, chest, 6);
      c.fillStyle = COL.pellet;
      c.fillRect(Math.round(chest.x) - 1, Math.round(chest.y) - 1, 2, 2);
      break;
    }
  }
```

**lib/game/art/farm-icons.ts — edit 1 of 3.** Replace:

```ts

// 16×16 icons for the farm (spec §14, v15.2 §15, v15.3 §15): seed sacks in the variety's colour, fertilizer bags with
// their nutrient on the label, pesticide bottles with their pest, rice sacks (wet/dry); hoa-màu seeds, the sickle, the
// sprayer and the hoa màu itself; the critter containers and the critters. "." transparent, "o" outline, other letters
// from the icon's own palette. Original art.
```

with:

```ts

// 16×16 icons for the farm (spec §14, v15.2 §15, v15.3 §15, v17 §14): seed sacks in the variety's colour, fertilizer
// bags with their nutrient on the label, pesticide bottles with their pest, rice sacks (wet/dry); hoa-màu seeds, the
// sickle, the sprayer and the hoa màu itself; the critter containers and the critters; the ná, its pellets, the dog's
// food and bowl, and the rat. "." transparent, "o" outline, other letters from the icon's own palette. Original art.
```

**lib/game/art/farm-icons.ts — edit 2 of 3.** Replace:

```ts

export const FARM_ICONS: Record<string, PixelIcon> = {
```

with:

```ts

// v17: the ná (a forked stick, its band and pouch), three clay pellets on a cloth, a sack of dog food with a bone, the
// map rat's run pose outlined, and a clay bowl of kibble
const TOOL_SLING: PixelIcon = {
  rows: [
    "................",
    "..oo........oo..",
    ".oyYkk....kkyYo.",
    ".oyYo.kppk.oyYo.",
    "..oyYo.pp.oyYo..",
    "...oyYo..oyYo...",
    "....oyYooyYo....",
    ".....oyyyYo.....",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    "......oyYo......",
    ".......oo.......",
    "................",
  ],
  pal: { y: "#8b5a33", Y: "#6e4424", k: "#2e2a2a", p: "#b0643a" },
};

const AMMO_PELLET: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    "......oooo......",
    ".....oLaaao.....",
    ".....oaaaao.....",
    ".....oaaaao.....",
    "..oooooooooooo..",
    "..oLaaaooLaaao..",
    "..oaaaaooaaaao..",
    "..oaaaaooaaaao..",
    "cccooooccooooccc",
    "cccccccccccccccc",
    ".cccccccccccccc.",
    "................",
    "................",
  ],
  pal: { a: "#a0522d", L: "#c9784a", c: "#d9c9a0" },
};

const FOOD_DOG: PixelIcon = {
  rows: [
    "................",
    "......oooo......",
    ".....osssso.....",
    "......oSSo......",
    ".....osssSo.....",
    "....osssssSo....",
    "...ossssssSSo...",
    "..osssssssSSSo..",
    "..osksssskSSSo..",
    "..oskkkkkkSSSo..",
    "..osksssskSSSo..",
    "..ossssssssSSo..",
    "...osssssssSo...",
    "....oooooooo....",
    "................",
    "................",
  ],
  pal: { s: "#d9c27a", S: "#b8a05a", k: "#f4efe0" },
};

const RAT_ICON: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    "..........pp....",
    ".........offo...",
    "......oooffffo..",
    "....oofffffffeo.",
    "...offssffffffpo",
    "p.offsssfffffo..",
    "p.offfffffffo...",
    ".pofsbbbbbbso...",
    "..ooso.....so...",
    "....so.....so...",
    "....oo.....oo...",
    "................",
    "................",
  ],
  pal: { f: "#7a6450", s: "#5a4636", b: "#b8a48a", p: "#c98f86", e: "#1c1410" },
};

const DOG_BOWL: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    "................",
    "................",
    "......k.kk......",
    "....kkkkkkkk....",
    "..oooooooooooo..",
    "..obbbbbbbbbBo..",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "....oBBBBBBo....",
    ".....oooooo.....",
    "................",
    "................",
    "................",
  ],
  pal: { b: "#b0643a", B: "#8a4a26", k: "#8b5a33" },
};

export const FARM_ICONS: Record<string, PixelIcon> = {
```

**lib/game/art/farm-icons.ts — edit 3 of 3.** Replace:

```ts
  oc_buou_vang: OC_BUOU_VANG,
};
```

with:

```ts
  oc_buou_vang: OC_BUOU_VANG,
  // v17
  tool_sling: TOOL_SLING,
  ammo_pellet: AMMO_PELLET,
  food_dog: FOOD_DOG,
  rat: RAT_ICON,
  dog_bowl: DOG_BOWL,
};
```

Create `lib/game/art/rats.ts` with exactly:

```ts
// v17 (spec §14): the field rat, 10 × 7 px, side view facing right (mirrored for left): run 0/1, nibble 0/1 (head down
// at a grain) and fall (on its back). "." is transparent; the letters are RAT_PAL's. The SlingGame draws the same art
// at × 2. Original art.

export const RAT_W = 10;
export const RAT_H = 7;

export type RatFrame = "run0" | "run1" | "nibble0" | "nibble1" | "fall";
export const RAT_FRAMES: readonly RatFrame[] = ["run0", "run1", "nibble0", "nibble1", "fall"];

/** f fur, s shade, b belly, p ears, tail and nose, e eye, o the partial outline, g the grain it nibbles. */
export const RAT_PAL: Readonly<Record<string, string>> = {
  f: "#7a6450", s: "#5a4636", b: "#b8a48a", p: "#c98f86", e: "#1c1410", o: "#2e2218", g: "#e0b33c",
};

export const RAT_ART: Readonly<Record<RatFrame, readonly string[]>> = {
  run0: [
    "......pp..",
    "...offffo.",
    "..offfffeo",
    "pofssffffp",
    ".psbbbbbo.",
    "..s....s..",
    ".s......s.",
  ],
  run1: [
    "......pp..",
    "...offffo.",
    "..offfffeo",
    "pofssffffp",
    "p.sbbbbbo.",
    "...s..s...",
    "...s..s...",
  ],
  nibble0: [
    "..........",
    "...offf...",
    "..offffpp.",
    ".offssfffo",
    "pfsbbbbfeo",
    "p.s...s.pg",
    "..s...s..g",
  ],
  nibble1: [
    "..........",
    "...offfpp.",
    "..offfffo.",
    ".offssffeo",
    "pfsbbbbffp",
    "p.s...s..g",
    "..s...s..g",
  ],
  fall: [
    "..........",
    "..s..s.s..",
    ".sbbbbbbs.",
    "pobbbbbbfe",
    "p.offfffpo",
    "...oooooo.",
    "..........",
  ],
};

/** A frame's colours by row ("" = transparent), facing right, or mirrored for left. */
export function ratMatrix(frame: RatFrame, dir: 1 | -1): string[][] {
  const m = RAT_ART[frame].map((row) => [...row].map((ch) => (ch === "." ? "" : RAT_PAL[ch] ?? "")));
  if (dir === -1) for (const row of m) row.reverse();
  return m;
}

/** What a rat shows: running legs every 120 ms, nibbling bobs every 400 ms. */
export function ratFrame(moving: boolean, t: number): RatFrame {
  return moving ? (Math.floor(t / 120) % 2 ? "run1" : "run0") : Math.floor(t / 400) % 2 ? "nibble1" : "nibble0";
}

const cache = new Map<string, HTMLCanvasElement>();

function sprite(frame: RatFrame, dir: 1 | -1): HTMLCanvasElement {
  const key = `${frame}${dir}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = RAT_W;
  cv.height = RAT_H;
  const ctx = cv.getContext("2d");
  if (ctx) {
    ratMatrix(frame, dir).forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }));
  }
  cache.set(key, cv);
  return cv;
}

/** Draws a rat with its feet's middle at (x, y), `scale` px a pixel (the SlingGame's 2). Browser only. */
export function drawRat(c: CanvasRenderingContext2D, frame: RatFrame, dir: 1 | -1, x: number, y: number, scale = 1): void {
  c.drawImage(sprite(frame, dir), Math.round(x - (RAT_W * scale) / 2), Math.round(y - RAT_H * scale), RAT_W * scale, RAT_H * scale);
}
```

**lib/game/net/protocol.ts — edit 1 of 2.** Replace:

```ts
/** Farm animation (v15 spec §12), played for 2.5 s; 0 stops it. */
export type FarmAnim = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
/** v15.2 adds dig (đào khoai) and pick (bẻ bắp, hái ớt); older clients drop codes they do not know. */
export const FARM_ANIM = {
  stop: 0, transplant: 1, harvest: 2, pump: 3, spray: 4, fertilize: 5, crab: 6, snails: 7, prepare: 8, dig: 9, pick: 10,
} as const satisfies Record<string, FarmAnim>;
```

with:

```ts
/** Farm animation (v15 spec §12), played for 2.5 s; 0 stops it. */
export type FarmAnim = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
/** v15.2 adds dig (đào khoai) and pick (bẻ bắp, hái ớt), v17 pet (a dog) and aim (a ná); older clients drop codes they
 *  do not know. */
export const FARM_ANIM = {
  stop: 0, transplant: 1, harvest: 2, pump: 3, spray: 4, fertilize: 5, crab: 6, snails: 7, prepare: 8, dig: 9, pick: 10, pet: 11, aim: 12,
} as const satisfies Record<string, FarmAnim>;
```

**lib/game/net/protocol.ts — edit 2 of 2.** Replace:

```ts
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isFarmAnim = (v: unknown): v is FarmAnim => isInt(v) && v >= 0 && v <= 10;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
```

with:

```ts
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isFarmAnim = (v: unknown): v is FarmAnim => isInt(v) && v >= 0 && v <= 12;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (3 files, 32 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/art/dog.ts lib/game/art/farm-anim.ts lib/game/art/farm-icons.ts lib/game/art/rats.ts lib/game/net/protocol.ts tests/unit/game-dog-art.test.ts tests/unit/game-farm-icons.test.ts tests/unit/game-protocol.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the rat's and the dog's art, five icons, and fa 11 and 12

art/rats.ts draws the field rat, 10 × 7 px side frames (run 0/1, nibble 0/1 with a
grain, fall) mirrored for left, at × 1 or the SlingGame's × 2. art/dog.ts builds the
dog's 20 × 16 frames from parts for down, up and right (left mirrored): walk 0–3,
idle, sit, hungry, run 0/1, leap, wag 0/1 and carry, in the four coats' colours, with
vện's stripes and đốm's spots on the body, cached per coat; dogFrame picks a frame
from the follower's pose. farm-icons gains the ná, the pellets, the dog food, the
rat and the bowl. FarmAnim becomes 0–12: 11 pets (a lowered hand and rising hearts)
and 12 aims a ná (the band drawn back to the chest, trembling), and the parser
accepts them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/art/dog.ts lib/game/art/farm-anim.ts lib/game/art/farm-icons.ts lib/game/art/rats.ts lib/game/net/protocol.ts tests/unit/game-dog-art.test.ts tests/unit/game-farm-icons.test.ts tests/unit/game-protocol.test.ts
git commit -F <message file>
```

---

### Task 12: Presence carries the dog

**Files:**
- Modify: `hooks/useRoom.ts`, `lib/game/dog.ts`, `lib/game/social.ts`, `lib/game/world.ts`, `lib/presence-modes.ts`, `lib/realtime.ts`
- Test: `tests/unit/game-social.test.ts`, `tests/unit/presence-mode.test.ts`, `tests/unit/presence-scheduler.test.ts` (modify)

**Interfaces:**
- Consumes: Task 6 (`DogCoat`, `isCoat`); `presence-modes.ts`' `aggregatePresenceModes`; `realtime.ts`' `trackPresence` and its budget; `social.ts`' `buildRoster`; `world.ts`' `RosterEntry`; `useRoom`.
- Produces (§7.3, §11, D23): `dog.ts`' `hasHidden(s)`; `PresenceDog {name, coat}`, `PresenceMeta.dog`, `PresenceEntry.dog?`, `presenceDog(v)` (a name of 1–16 code points with no hidden character, a known coat; ruling); the aggregate takes the dog from the latest game tab; `trackPresence`'s `setDog(dog | null)` (merged and budgeted with the mode and the map, sent as `{n, c}`); `RosterEntry.dog?` (a walking member's, none seated); `useRoom`'s `setPresenceDog`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-social.test.ts.** Replace:

```ts

describe("buildRoster per map", () => {
```

with:

```ts

describe("buildRoster's dogs (v17 §7.3)", () => {
  it("walks a walking member's dog with them, and seats no dog", () => {
    const muc = { name: "Mực", coat: "muc" as const };
    const presence: PresenceEntry[] = [
      { accountId: "g1", name: "Giang", mode: "game", map: "field", dog: muc },
      { accountId: "c2", name: "Chi", mode: "game", map: "field" },
      { accountId: "c1", name: "Cúc", mode: "classic", map: null, dog: muc },
    ];
    const byId = (mapId: MapId) => new Map(buildRoster({
      presence, members, room, localId: "me", looks: new Map(), mapId, seating: mapId === "hall" ? seating : null,
    }).map((e) => [e.id, e]));
    expect(byId("field").get("g1")?.dog).toEqual(muc);
    expect(byId("field").get("c2")?.dog).toBeNull();
    expect(byId("hall").get("c1")?.dog).toBeNull();
  });
});

describe("buildRoster per map", () => {
```

**tests/unit/presence-mode.test.ts — edit 1 of 4.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { aggregatePresenceModes, mapCounts, presenceDelay, type PresenceEntry } from "@/lib/presence-modes";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { aggregatePresenceModes, mapCounts, presenceDelay, presenceDog, type PresenceEntry } from "@/lib/presence-modes";
```

**tests/unit/presence-mode.test.ts — edit 2 of 4.** Replace:

```ts
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game", map: "hall" },
      { accountId: "b", name: "Bee", mode: "classic", map: null },
    ]);
```

with:

```ts
    expect(out).toEqual([
      { accountId: "a", name: "Ann", mode: "game", map: "hall", dog: null },
      { accountId: "b", name: "Bee", mode: "classic", map: null, dog: null },
    ]);
```

**tests/unit/presence-mode.test.ts — edit 3 of 4.** Replace:

```ts
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic", map: null }]);
  });
```

with:

```ts
    const out = aggregatePresenceModes({ a: [{ name: "Ann" }], b: [] });
    expect(out).toEqual([{ accountId: "a", name: "Ann", mode: "classic", map: null, dog: null }]);
  });
```

**tests/unit/presence-mode.test.ts — edit 4 of 4.** Replace:

```ts
    expect(aggregatePresenceModes({ a: [{ mode: "game" }] })[0].name).toBe("");
  });
```

with:

```ts
    expect(aggregatePresenceModes({ a: [{ mode: "game" }] })[0].name).toBe("");
  });
  it("takes the dog from the game tab that tracked last, and shows none in the classic view (v17 §7.3)", () => {
    const tab = (dog: unknown, at: string, mode = "game") => ({ name: "Ann", mode, map: "field", online_at: at, dog });
    const muc = { n: "Mực", c: "muc" };
    expect(aggregatePresenceModes({ a: [tab(muc, "2026-09-26T10:00:00Z")] })[0].dog).toEqual({ name: "Mực", coat: "muc" });
    expect(aggregatePresenceModes({ a: [tab(muc, "2026-09-26T10:00:00Z"), tab(null, "2026-09-26T10:05:00Z")] })[0].dog).toBeNull();
    expect(aggregatePresenceModes({ a: [tab(null, "2026-09-26T10:00:00Z"), tab(muc, "2026-09-26T10:05:00Z")] })[0].dog)
      .toEqual({ name: "Mực", coat: "muc" });
    expect(aggregatePresenceModes({ a: [tab(muc, "2026-09-26T10:00:00Z", "classic")] })[0].dog).toBeNull();
    // an old client without a dog
    expect(aggregatePresenceModes({ a: [{ name: "Ann", mode: "game", map: "hall" }] })[0].dog).toBeNull();
  });
});

describe("presenceDog", () => {
  it("accepts a name of 1–16 characters with no hidden character, and a known coat", () => {
    expect(presenceDog({ n: "Ki", c: "vang" })).toEqual({ name: "Ki", coat: "vang" });
    expect(presenceDog({ n: "K", c: "dom" })).toEqual({ name: "K", coat: "dom" });
    expect(presenceDog({ n: "Vàng Vện Đốm 16c", c: "ven" })).toEqual({ name: "Vàng Vện Đốm 16c", coat: "ven" });
    expect(presenceDog({ n: "Mực 🐾", c: "muc" })).toEqual({ name: "Mực 🐾", coat: "muc" });
  });
  it("gives no dog for anything else", () => {
    for (const v of [
      null, undefined, "Ki", { n: "Ki" }, { c: "vang" }, { n: "", c: "vang" }, { n: "A".repeat(17), c: "vang" }, { n: 5, c: "vang" },
      { n: "Ki", c: "x" }, { n: "Ki\u200bki", c: "vang" }, { n: "Ki\u00a0ki", c: "vang" }, { n: "Ki\tki", c: "vang" },
      { n: "Mu\u0301c", c: "muc" },
    ]) {
      expect(presenceDog(v), JSON.stringify(v)).toBeNull();
    }
  });
```

**tests/unit/presence-scheduler.test.ts — edit 1 of 3.** Replace:

```ts
    subscribeCb: null as ((s: string) => void) | null,
    calls: [] as { at: number; mode: unknown; map: unknown }[],
    replies: [] as Array<string | Promise<string> | Error>,
```

with:

```ts
    subscribeCb: null as ((s: string) => void) | null,
    calls: [] as { at: number; mode: unknown; map: unknown; dog: unknown }[],
    replies: [] as Array<string | Promise<string> | Error>,
```

**tests/unit/presence-scheduler.test.ts — edit 2 of 3.** Replace:

```ts
    presenceState() { return {}; },
    track(payload: { mode: unknown; map?: unknown }) {
      state.calls.push({ at: Date.now(), mode: payload.mode, map: payload.map });
      const reply = state.replies.shift() ?? "ok";
```

with:

```ts
    presenceState() { return {}; },
    track(payload: { mode: unknown; map?: unknown; dog?: unknown }) {
      state.calls.push({ at: Date.now(), mode: payload.mode, map: payload.map, dog: payload.dog });
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

  it("publishes the dog as {n, c} with the mode and the map, in game mode only (v17 §7.3)", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "field", dog: { name: "Mực", coat: "muc" } }, () => {});
    sub(); await adv(0);
    expect(h.state.calls.map((c) => c.dog)).toEqual([{ n: "Mực", c: "muc" }]);
    hd.setDog({ name: "Mực", coat: "muc" }); await adv(10_000); expect(h.state.calls).toHaveLength(1); // the same dog
    hd.setDog({ name: "Ki", coat: "muc" }); await adv(400); hd.setMap("hall"); await adv(1000);
    expect(h.state.calls.map((c) => [c.map, c.dog])).toEqual([["field", { n: "Mực", c: "muc" }], ["hall", { n: "Ki", c: "muc" }]]);
    hd.setMode("classic"); await adv(1000);
    expect(h.state.calls.at(-1)).toMatchObject({ mode: "classic", map: null, dog: null });
    hd.setDog(null); await adv(10_000); expect(h.state.calls).toHaveLength(3); // nothing visible changed
    hd.setMode("game"); await adv(1000);
    expect(h.state.calls.at(-1)).toMatchObject({ mode: "game", map: "hall", dog: null });
    hd.unsubscribe();
  });

  it("shares the 4-per-30 s budget between dog, map and mode changes", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "hall" }, () => {});
    sub(); await adv(0);
    for (let i = 0; i < 12; i++) {
      if (i % 3 === 0) hd.setDog(i % 2 ? null : { name: "Ki", coat: "vang" });
      else if (i % 3 === 1) hd.setMap(i % 2 ? "pond" : "field");
      else hd.setMode(i % 2 ? "classic" : "game");
      await adv(1500);
    }
    await adv(120_000);
    const ts = times();
    for (const t of ts) expect(ts.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(4);
    hd.unsubscribe();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-social.test.ts tests/unit/presence-mode.test.ts tests/unit/presence-scheduler.test.ts`
Expected: FAIL — 8 tests fail (no roster dog, no `presenceDog`, no dog in the aggregate or in `trackPresence`); 3 files fail, 33 tests pass.

- [ ] **Step 3: Implement**

**hooks/useRoom.ts — edit 1 of 5.** Replace:

```ts
import { subscribeRoom, trackPresence, type PresenceHandle, type RoomState } from "@/lib/realtime";
import type { PresenceEntry, PresenceMode } from "@/lib/presence-modes";
import { supabase } from "@/lib/supabase";
```

with:

```ts
import { subscribeRoom, trackPresence, type PresenceHandle, type RoomState } from "@/lib/realtime";
import type { PresenceDog, PresenceEntry, PresenceMode } from "@/lib/presence-modes";
import { supabase } from "@/lib/supabase";
```

**hooks/useRoom.ts — edit 2 of 5.** Replace:

```ts
  setPresenceMap: (m: MapId) => void;
  token: string; accountId: string; username: string; myMemberId: string | null;
```

with:

```ts
  setPresenceMap: (m: MapId) => void;
  /** My dog (v17 §7.3; published with the mode and the map, in game mode only; shared presence budget). */
  setPresenceDog: (d: PresenceDog | null) => void;
  token: string; accountId: string; username: string; myMemberId: string | null;
```

**hooks/useRoom.ts — edit 3 of 5.** Replace:

```ts
    presenceRef.current?.setMap(m);
  }, []);
```

with:

```ts
    presenceRef.current?.setMap(m);
  }, []);
  const dogRef = useRef<PresenceDog | null>(null);
  const setPresenceDog = useCallback((d: PresenceDog | null) => {
    dogRef.current = d;
    presenceRef.current?.setDog(d);
  }, []);
```

**hooks/useRoom.ts — edit 4 of 5.** Replace:

```ts
          memberId: account.accountId, name: account.username, mode: modeRef.current ?? readStoredMode(), map: mapRef.current,
        }, setPresence);
```

with:

```ts
          memberId: account.accountId, name: account.username, mode: modeRef.current ?? readStoredMode(), map: mapRef.current,
          dog: dogRef.current,
        }, setPresence);
```

**hooks/useRoom.ts — edit 5 of 5.** Replace:

```ts
  return {
    loading, state, onlineIds, presence, setPresenceMode, setPresenceMap, token: token ?? "", accountId, username: account?.username ?? "",
    myMemberId, role, kicked,
  };
```

with:

```ts
  return {
    loading, state, onlineIds, presence, setPresenceMode, setPresenceMap, setPresenceDog, token: token ?? "", accountId,
    username: account?.username ?? "", myMemberId, role, kicked,
  };
```

**lib/game/dog.ts — edit 1 of 2.** Replace:

```ts

/** Why the server would refuse this name ('invalid name'), or null: 2–16 characters (code points), no hidden character,
```

with:

```ts

/** Whether s has a hidden character: 0015's register classes (controls, odd spaces, invisibles, combining marks). */
export function hasHidden(s: string): boolean {
  return [...s].some((ch) => HIDDEN.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi));
}

/** Why the server would refuse this name ('invalid name'), or null: 2–16 characters (code points), no hidden character,
```

**lib/game/dog.ts — edit 2 of 2.** Replace:

```ts
  if (chars.length < DOG.nameMin || chars.length > DOG.nameMax) return "length";
  if (chars.some((ch) => HIDDEN.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi))) return "hidden";
  if (RESERVED.includes(nameKey(v))) return "reserved";
```

with:

```ts
  if (chars.length < DOG.nameMin || chars.length > DOG.nameMax) return "length";
  if (hasHidden(v)) return "hidden";
  if (RESERVED.includes(nameKey(v))) return "reserved";
```

**lib/game/social.ts — edit 1 of 2.** Replace:

```ts
 * the hall with a fixed spot — the DJ behind the mixer, the others on café seats in account-id order — so every
 * client shows the same arrangement. Game-view members on this map walk (spot null).
 */
```

with:

```ts
 * the hall with a fixed spot — the DJ behind the mixer, the others on café seats in account-id order — so every
 * client shows the same arrangement. Game-view members on this map walk (spot null), with their dog (v17).
 */
```

**lib/game/social.ts — edit 2 of 2.** Replace:

```ts
      spot,
    };
```

with:

```ts
      spot,
      dog: classic ? null : p.dog ?? null,
    };
```

**lib/game/world.ts.** Replace:

```ts
import type { Look } from "@/lib/game/types";

/** One other online member. `spot` = fixed place for classic-mode members; null = walking (game mode). */
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null }
```

with:

```ts
import type { Look } from "@/lib/game/types";
import type { PresenceDog } from "@/lib/presence-modes";

/** One other online member. `spot` = fixed place for classic-mode members; null = walking (game mode). `dog` (v17):
 *  the dog walking with them; seated members show none. */
export interface RosterEntry { id: string; name: string; badges: string; look: Look; spot: Spot | null; dog?: PresenceDog | null }
```

**lib/presence-modes.ts — edit 1 of 5.** Replace:

```ts
import type { MapId } from "@/lib/game/maps/types";
```

with:

```ts
import { hasHidden, isCoat, type DogCoat } from "@/lib/game/dog";
import type { MapId } from "@/lib/game/maps/types";
```

**lib/presence-modes.ts — edit 2 of 5.** Replace:

```ts
export type PresenceMode = ViewMode;
export interface PresenceMeta { name?: unknown; online_at?: unknown; mode?: unknown; map?: unknown }
/** `map`: the game map the member walks on (v14); null in the classic view. */
export interface PresenceEntry { accountId: string; name: string; mode: PresenceMode; map: MapId | null }
```

with:

```ts
export type PresenceMode = ViewMode;
export interface PresenceMeta { name?: unknown; online_at?: unknown; mode?: unknown; map?: unknown; dog?: unknown }
/** A member's dog as presence carries it (v17 §7.3): `{n, c}` on the wire. */
export interface PresenceDog { name: string; coat: DogCoat }
/** `map`: the game map the member walks on (v14); null in the classic view. `dog` (v17): the dog walking with them,
 *  from the same tab as `map`; null in the classic view or without one (absent in hand-made entries). */
export interface PresenceEntry { accountId: string; name: string; mode: PresenceMode; map: MapId | null; dog?: PresenceDog | null }

/** A presence `dog` value: `n` a name of 1–16 characters with no hidden character (the names the server stores), and
 *  `c` a known coat; anything else is no dog. */
export function presenceDog(v: unknown): PresenceDog | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.n !== "string" || !isCoat(o.c)) return null;
  const len = [...o.n].length;
  return len >= 1 && len <= 16 && !hasHidden(o.n) ? { name: o.n, coat: o.c } : null;
}
```

**lib/presence-modes.ts — edit 3 of 5.** Replace:

```ts
/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode; its map comes from the game tab that tracked
 *  last (an old client without a map, or with one it does not know, is in the hall). Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
```

with:

```ts
/** Presence state (key = account id, one meta per open tab) → one entry per account.
 *  An account counts as "game" when ANY of its tabs is in game mode; its map and its dog come from the game tab that
 *  tracked last (an old client without a map, or with one it does not know, is in the hall). Sorted by account id. */
export function aggregatePresenceModes(state: Record<string, PresenceMeta[] | undefined>): PresenceEntry[] {
```

**lib/presence-modes.ts — edit 4 of 5.** Replace:

```ts
    if (games.length === 0) {
      out.push({ accountId, name, mode: "classic", map: null });
      continue;
```

with:

```ts
    if (games.length === 0) {
      out.push({ accountId, name, mode: "classic", map: null, dog: null });
      continue;
```

**lib/presence-modes.ts — edit 5 of 5.** Replace:

```ts
    const latest = games.reduce((a, b) => (onlineAt(b) > onlineAt(a) ? b : a));
    out.push({ accountId, name, mode: "game", map: presenceMap(latest.map) });
  }
```

with:

```ts
    const latest = games.reduce((a, b) => (onlineAt(b) > onlineAt(a) ? b : a));
    out.push({ accountId, name, mode: "game", map: presenceMap(latest.map), dog: presenceDog(latest.dog) });
  }
```

**lib/realtime.ts — edit 1 of 5.** Replace:

```ts
import {
  aggregatePresenceModes, presenceDelay, PRESENCE_BUDGET, type PresenceEntry, type PresenceMeta, type PresenceMode,
} from "@/lib/presence-modes";
```

with:

```ts
import {
  aggregatePresenceModes, presenceDelay, PRESENCE_BUDGET, type PresenceDog, type PresenceEntry, type PresenceMeta, type PresenceMode,
} from "@/lib/presence-modes";
```

**lib/realtime.ts — edit 2 of 5.** Replace:

```ts
  setMap: (map: MapId) => void;
}

interface Published { mode: PresenceMode; map: MapId | null }

/** Realtime Presence keyed by account id. The payload also carries the member's view mode (v13) and game map (v14).
 *  track() calls are budgeted (Supabase allows 5 per 30 s): ≤ 4 calls per 30 s for mode and map changes together;
 *  a re-track after a reconnect may use the 5th. Changes within 1 s are merged, a state the server already
 *  acknowledged is never re-sent, and failed tracks are retried. */
export function trackPresence(
  roomId: string,
  me: { memberId: string; name: string; mode: PresenceMode; map?: MapId },
  onChange: (entries: PresenceEntry[]) => void,
```

with:

```ts
  setMap: (map: MapId) => void;
  /** My dog (v17 §7.3), or null. Published only while the mode is "game" (classic → dog null). */
  setDog: (dog: PresenceDog | null) => void;
}

interface Published { mode: PresenceMode; map: MapId | null; dog: PresenceDog | null }

const sameDog = (a: PresenceDog | null, b: PresenceDog | null) => a === b || (!!a && !!b && a.name === b.name && a.coat === b.coat);

/** Realtime Presence keyed by account id. The payload also carries the member's view mode (v13), game map (v14) and
 *  dog (v17, `{n, c}`). track() calls are budgeted (Supabase allows 5 per 30 s): ≤ 4 calls per 30 s for mode, map and
 *  dog changes together; a re-track after a reconnect may use the 5th. Changes within 1 s are merged, a state the
 *  server already acknowledged is never re-sent, and failed tracks are retried. */
export function trackPresence(
  roomId: string,
  me: { memberId: string; name: string; mode: PresenceMode; map?: MapId; dog?: PresenceDog | null },
  onChange: (entries: PresenceEntry[]) => void,
```

**lib/realtime.ts — edit 3 of 5.** Replace:

```ts
  let map: MapId = me.map ?? "hall";
  let published: Published | null = null;    // …and the last state the server acknowledged with 'ok'
  const wanted = (): Published => ({ mode, map: mode === "game" ? map : null });
  const isPublished = () => published !== null && published.mode === wanted().mode && published.map === wanted().map;
  let subscribed = false;
```

with:

```ts
  let map: MapId = me.map ?? "hall";
  let dog: PresenceDog | null = me.dog ?? null;
  let published: Published | null = null;    // …and the last state the server acknowledged with 'ok'
  const wanted = (): Published => ({ mode, map: mode === "game" ? map : null, dog: mode === "game" ? dog : null });
  const isPublished = () => {
    const w = wanted();
    return published !== null && published.mode === w.mode && published.map === w.map && sameDog(published.dog, w.dog);
  };
  let subscribed = false;
```

**lib/realtime.ts — edit 4 of 5.** Replace:

```ts
    // A rejected call counts as failed (retried below) instead of leaving `sending` stuck.
    const status = await channel.track({ name: me.name, online_at: new Date(now).toISOString(), mode: next.mode, map: next.map })
      .catch(() => "error" as const);
    sending = false;
```

with:

```ts
    // A rejected call counts as failed (retried below) instead of leaving `sending` stuck.
    const status = await channel.track({
      name: me.name, online_at: new Date(now).toISOString(), mode: next.mode, map: next.map,
      dog: next.dog ? { n: next.dog.name, c: next.dog.coat } : null,
    }).catch(() => "error" as const);
    sending = false;
```

**lib/realtime.ts — edit 5 of 5.** Replace:

```ts
    },
  };
```

with:

```ts
    },
    setDog: (next) => {
      if (closed || sameDog(next, dog)) return;
      dog = next;
      schedule(1000);
    },
  };
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (3 files, 41 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint hooks/useRoom.ts lib/game/dog.ts lib/game/social.ts lib/game/world.ts lib/presence-modes.ts lib/realtime.ts tests/unit/game-social.test.ts tests/unit/presence-mode.test.ts tests/unit/presence-scheduler.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): presence carries the dog

Presence gains `dog: {n, c}` in game mode (null in the classic view). presenceDog
accepts a name of 1–16 characters with no hidden character (dog.ts's hasHidden, the
names the server stores) and a known coat; aggregatePresenceModes takes the dog
from the game tab that tracked last, with the map. trackPresence gains setDog: the
dog is merged and budgeted with the mode and the map (≤ 4 tracks per 30 s), sent
as {n, c}, and a dog already published is never re-sent. buildRoster walks a
walking member's dog with them and seats none; useRoom exposes setPresenceDog.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add hooks/useRoom.ts lib/game/dog.ts lib/game/social.ts lib/game/world.ts lib/presence-modes.ts lib/realtime.ts tests/unit/game-social.test.ts tests/unit/presence-mode.test.ts tests/unit/presence-scheduler.test.ts
git commit -F <message file>
```

---

### Task 13: Dogs and rats in the world, and the rat prompt

**Files:**
- Create: `lib/game/pack.ts`
- Modify: `components/game/GameCanvas.tsx`, `lib/game/engine.ts`, `lib/game/farm/rats.ts`, `lib/game/maps/types.ts`, `lib/game/world.ts`
- Test: `tests/unit/game-pack.test.ts` (create); `tests/unit/farm-rats.test.ts`, `tests/unit/game-canvas-input.test.tsx`, `tests/unit/game-world.test.ts` (modify)

**Interfaces:**
- Consumes: Tasks 5, 6, 10, 11, 12 (`ratAt`, `ratFleePos`, `ratHome`, `nearestRat`, the follower, `drawRat`, `drawDog`, `dogFrame`, `RosterEntry.dog`); the engine's walkers, props and `PROMPT_RANGE`; `world.ts`' farm animations; `GameCanvasHandle` (with 793f8b4's `mapId()`).
- Produces:
  - `lib/game/pack.ts`: `DogWalker`, `DrawnDog`, `DrawnRat`, `SLING_END_MS` (600), `DOG_END_MS` (6 000), `class Pack` (`setRats(rats, now)` → puffs, `step(walkers, now)`, `pounce(ratId, now, serverT)`, `recall()`, `pet(now)`, `drawnDogs()`, `drawnRats()`, `liveRats()`);
  - `rats.ts`: `RAT_PROMPT_RANGE` (40), `ratInteractable(rat, p)`, `promptTarget(map, feet, live, t)` (a map interactable in range always wins); `maps/types.ts`: `InteractKind` `"rat"`, `Interactable.rat?`; `world.ts`: `farmAnimAt`;
  - `engine.ts`: `LocalInfo.dog?` and `.dogHungry?`, `setRats`, `dogPounce`, `dogRecall`, `petDog`, `localPos`, an `onInput` callback, the rat prompt and tap, dogs and rats drawn depth-sorted;
  - `GameCanvasHandle`: `setLocal` keeps my dog when a call has none, `setRats` (kept for every new field world), `dogPounce(ratId)`, `dogRecall()`, `petDog()` (`fa 11` for everyone), `localPos()`, `lastInputAt()`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-rats.test.ts — edit 1 of 2.** Replace:

```ts
import {
  FULL_CAPS, nearestRat, parseRatBag, parseRatCaps, parseRats, RAT, ratAt, ratFactor, ratFleePos, ratHome, ratHours, ratPos,
  type RatLogEntry,
} from "@/lib/game/farm/rats";
import type { CropView } from "@/lib/game/farm/state";
```

with:

```ts
import {
  FULL_CAPS, nearestRat, parseRatBag, parseRatCaps, parseRats, promptTarget, RAT, ratAt, ratFactor, ratFleePos, ratHome, ratHours,
  ratPos, type RatLogEntry,
} from "@/lib/game/farm/rats";
import { buildFieldMap } from "@/lib/game/maps/field";
import type { Interactable } from "@/lib/game/maps/types";
import type { CropView } from "@/lib/game/farm/state";
```

**tests/unit/farm-rats.test.ts — edit 2 of 2.** Replace:

```ts

describe("the field's rats (§10.5)", () => {
```

with:

```ts

describe("the rat prompt (§12.1)", () => {
  const T = Date.parse("2026-09-26T08:00:00Z");
  const field = buildFieldMap();
  // at `since` the rat is at plot 5's hole, (172, 310)
  const r = { id: 7, plot: 5, since: T, seed: 7 };
  it("offers the nearest live rat within 40 px when no interactable is in range", () => {
    expect(promptTarget(field, { x: 172, y: 330 }, [r], T)).toMatchObject({
      id: "rat_7", kind: "rat", rat: 7, prompt: "Bắn chuột", use: { x: 172, y: 310 }, rect: { x: 166, y: 303, w: 12, h: 9 },
    });
    expect(promptTarget(field, { x: 172, y: 351 }, [r], T)).toBeNull();
    expect(promptTarget(field, { x: 172, y: 330 }, [], T)).toBeNull();
  });
  it("never takes E from a plot, a keeper or a portal in range", () => {
    // plot 8's use spot is 37 px from the rat
    const plot8 = field.interactables.find((i) => i.id === "plot_8")!;
    expect(Math.hypot(plot8.use.x - 172, plot8.use.y - 310)).toBeLessThanOrEqual(40);
    expect(promptTarget(field, plot8.use, [r], T)).toBe(plot8);
    const at = (kind: Interactable["kind"]): Interactable =>
      ({ id: kind, kind, label: kind, prompt: kind, rect: { x: 160, y: 320, w: 8, h: 8 }, use: { x: 172, y: 330 } });
    for (const kind of ["portal", "coop", "farm_shop", "rice_depot"] as const) {
      const it = at(kind);
      expect(promptTarget({ ...field, interactables: [...field.interactables, it] }, { x: 172, y: 330 }, [r], T), kind).toBe(it);
    }
  });
  it("offers rats on the field only", () => {
    expect(promptTarget({ ...field, id: "hall" }, { x: 172, y: 330 }, [r], T)).toBeNull();
  });
});

describe("the field's rats (§10.5)", () => {
```

**tests/unit/game-canvas-input.test.tsx — edit 1 of 3.** Replace:

```tsx
  hellos: string[]; removed: string[]; destroyed: boolean;
  cb: { onLocalMove: (m: unknown) => void; onLocalPath: (m: unknown) => void };
};
```

with:

```tsx
  hellos: string[]; removed: string[]; destroyed: boolean;
  // v17: what setLocal, setRats and the dog calls received
  locals: unknown[]; rats: unknown[]; pounces: number[]; recalls: number; pets: number;
  cb: { onLocalMove: (m: unknown) => void; onLocalPath: (m: unknown) => void; onInput?: () => void };
};
```

**tests/unit/game-canvas-input.test.tsx — edit 2 of 3.** Replace:

```tsx
        mapId: map.id, input: [], plots: [], cards: [], spots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false,
        cb,
      };
      engines.push(this.rec);
    }
```

with:

```tsx
        mapId: map.id, input: [], plots: [], cards: [], spots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false,
        locals: [], rats: [], pounces: [], recalls: 0, pets: 0, cb,
      };
      engines.push(this.rec);
    }
    setLocal(info: unknown) {
      this.rec.locals.push(info);
    }
    setRats(rats: unknown) {
      this.rec.rats.push(rats);
    }
    dogPounce(ratId: number) {
      this.rec.pounces.push(ratId);
      return true;
    }
    dogRecall() {
      this.rec.recalls++;
    }
    petDog() {
      this.rec.pets++;
    }
    localPos() {
      return { x: 5, y: 6 };
    }
```

**tests/unit/game-canvas-input.test.tsx — edit 3 of 3.** Replace:

```tsx

describe("GameCanvas presence filter and receive budgets (anti-cheat spec §14)", () => {
```

with:

```tsx

describe("GameCanvas, the dog and the rats (v17)", () => {
  const muc = { name: "Mực", coat: "muc" as const };
  const RATS = { nextAt: 1, price: 150, live: [{ id: 3, plot: 5, since: 0, seed: 3 }], recent: [], plots: {} };

  it("keeps my dog across travel, and a setLocal without a dog keeps it (null removes it)", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="hall" {...props} />);
    expect(engines[0].locals.at(-1)).toMatchObject({ name: "An" });
    expect((engines[0].locals.at(-1) as { dog?: unknown }).dog).toBeUndefined();
    ref.current!.setLocal({ name: "An", badges: "", look: DEFAULT_LOOK, dog: muc, dogHungry: true });
    expect(engines[0].locals.at(-1)).toMatchObject({ dog: muc, dogHungry: true });
    ref.current!.setLocal({ name: "An", badges: "👑", look: DEFAULT_LOOK });
    expect(engines[0].locals.at(-1)).toMatchObject({ badges: "👑", dog: muc, dogHungry: true });
    rerender(<GameCanvas ref={ref} mapId="pond" {...props} />);
    expect(engines[1].locals.at(-1)).toMatchObject({ dog: muc, dogHungry: true });
    ref.current!.setLocal({ name: "An", badges: "", look: DEFAULT_LOOK, dog: null, dogHungry: false });
    rerender(<GameCanvas ref={ref} mapId="hall" {...props} />);
    expect(engines[2].locals.at(-1)).toMatchObject({ dog: null, dogHungry: false });
  });
  it("passes the rats on at once and gives them to the next field engine only", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="field" {...props} />);
    ref.current!.setRats(RATS);
    expect(engines[0].rats.at(-1)).toBe(RATS);
    rerender(<GameCanvas ref={ref} mapId="pond" {...props} />);
    expect(engines[1].rats).toEqual([]);
    rerender(<GameCanvas ref={ref} mapId="field" {...props} />);
    expect(engines[2].rats.at(-1)).toBe(RATS);
  });
  it("pets my dog with fa 11 for everyone, and passes on the pounce, the recall and where I stand", () => {
    const ref = createRef<GameCanvasHandle>();
    render(<GameCanvas ref={ref} mapId="field" {...props} />);
    ref.current!.petDog();
    expect(engines[0]).toMatchObject({ pets: 1, anims: [11] });
    expect(channels[0].sent).toEqual([{ t: "fa", id: "me", a: 11 }]);
    expect(ref.current!.dogPounce(3)).toBe(true);
    ref.current!.dogRecall();
    expect(engines[0]).toMatchObject({ pounces: [3], recalls: 1 });
    expect(ref.current!.localPos()).toEqual({ x: 5, y: 6 });
  });
  it("remembers my last key or touch across worlds", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender, unmount } = render(<GameCanvas ref={ref} mapId="field" {...props} />);
    expect(ref.current!.lastInputAt()).toBe(-Infinity);
    const now = vi.spyOn(performance, "now").mockReturnValue(4321);
    engines[0].cb.onInput!();
    now.mockRestore();
    rerender(<GameCanvas ref={ref} mapId="pond" {...props} />);
    expect(ref.current!.lastInputAt()).toBe(4321);
    const handle = ref.current!;
    unmount();
    expect(handle.localPos()).toBeNull();
    expect(handle.dogPounce(3)).toBe(false);
  });
});

describe("GameCanvas presence filter and receive budgets (anti-cheat spec §14)", () => {
```

Create `tests/unit/game-pack.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { ratAt, ratHome, ratPos, type FieldRats, type RatLive, type RatRecent } from "@/lib/game/farm/rats";
import { DOG_END_MS, Pack, SLING_END_MS, type DogWalker } from "@/lib/game/pack";

const T = Date.parse("2026-09-26T08:00:00Z");
const free = () => false;
const rats = (live: RatLive[], recent: RatRecent[] = []): FieldRats => ({ nextAt: T + 600_000, price: 150, live, recent, plots: {} });
/** A rat of plot 5 (its hole at (172, 310)), out since T. */
const rat = (id: number, plot = 5): RatLive => ({ id, plot, since: T, seed: id });
const ended = (r: RatLive, how: RatRecent["how"], endedAt: number, by: string | null = null, dog: string | null = null): RatRecent =>
  ({ ...r, endedAt, how, by: by ? { id: by, name: by } : null, dog });
const walker = (id: string, x: number, y: number, over: Partial<DogWalker> = {}): DogWalker =>
  ({ id, x, y, facing: "down", dog: { name: "Mực", coat: "muc" }, hungry: false, petAt: null, ...over });

describe("Pack: the rats (§5.4)", () => {
  it("draws the live rats on their paths", () => {
    const p = new Pack(free, "me");
    expect(p.setRats(rats([rat(1), rat(2, 8)]), 0)).toEqual([]);
    const drawn = p.drawnRats(0, T + 30_000);
    expect(drawn.map((r) => r.key)).toEqual(["r1", "r2"]);
    expect(drawn[0]).toMatchObject({ ...ratAt(rat(1), T + 30_000), fallen: false });
    expect(p.liveRats.map((r) => r.id)).toEqual([1, 2]);
    p.setRats(null, 10);
    expect(p.drawnRats(10, T + 30_000)).toEqual([]);
  });
  it("plays a sling catch once: the rat lies fallen with a puff for 0.6 s", () => {
    const p = new Pack(free, "me");
    p.setRats(rats([rat(1)]), 0);
    const end = ended(rat(1), "sling", T + 20_000, "lan");
    const at = ratAt(rat(1), T + 20_000)!;
    expect(p.setRats(rats([], [end]), 1000)).toEqual([{ x: at.x, y: at.y }]);
    p.step([], 1000 + SLING_END_MS - 1);
    expect(p.drawnRats(1599, T + 25_000)).toEqual([{ key: "e1", x: at.x, y: at.y, dir: at.dir, moving: false, fallen: true }]);
    p.step([], 1000 + SLING_END_MS);
    expect(p.drawnRats(1600, T + 25_000)).toEqual([]);
    // the same entry in the next state is not played again
    expect(p.setRats(rats([], [end]), 2000)).toEqual([]);
    expect(p.drawnRats(2000, T + 25_000)).toEqual([]);
  });
  it("runs a fled rat home in 1.5 s from when this client first sees it", () => {
    const p = new Pack(free, "me");
    const r = rat(3);
    p.setRats(rats([], [ended(r, "fled", T + 20_000)]), 5000);
    const home = ratHome(5)!;
    const from = ratPos(r.seed, r.since, home.hole, home.rect, T + 20_000)!;
    const mid = p.drawnRats(5750, 0)[0];
    expect(mid).toMatchObject({ key: "e3", moving: true, fallen: false });
    expect(mid.x).toBeCloseTo((from.x + 172) / 2, 9);
    expect(mid.y).toBeCloseTo((from.y + 310) / 2, 9);
    p.step([], 6500);
    expect(p.drawnRats(6500, 0)).toEqual([]);
  });
  it("sends a dog's catcher's dog when it walks here; otherwise the catch plays as a sling one; mine is not replayed", () => {
    const r = rat(4);
    const at = ratAt(r, T + 20_000)!;
    const catchBy = (who: string) => rats([], [ended(r, "dog", T + 20_000, who, "Mực")]);
    const p = new Pack(free, "me");
    p.step([walker("dat", 150, 330)], 0);
    expect(p.setRats(catchBy("dat"), 10)).toEqual([]);
    expect(p.drawnDogs(10)[0].pose).toBe("run");
    // the rat lies where it was caught until the dog carries it off
    let t = 10;
    while (t < 5000 && p.drawnDogs(t)[0].pose !== "carry") {
      expect(p.drawnRats(t, 0)).toEqual([{ key: "e4", x: at.x, y: at.y, dir: at.dir, moving: false, fallen: true }]);
      t += 16;
      p.step([walker("dat", 150, 330)], t);
    }
    expect(p.drawnDogs(t)[0].pose).toBe("carry");
    expect(p.drawnRats(t, 0)).toEqual([]);
    const away = new Pack(free, "me");
    expect(away.setRats(catchBy("dat"), 0)).toEqual([{ x: at.x, y: at.y }]);
    expect(away.drawnRats(0, 0)[0]).toMatchObject({ key: "e4", fallen: true });
    const mine = new Pack(free, "me");
    mine.step([walker("me", 150, 330)], 0);
    expect(mine.setRats(catchBy("me"), 0)).toEqual([]);
    expect(mine.drawnRats(0, 0)).toEqual([]);
    expect(mine.drawnDogs(0)[0].pose).not.toBe("run");
  });
  it("gives a dog's catch up after 6 s if the dog never gets there", () => {
    // a frame steps the dog 0.1 s at most: one step across the whole wait leaves it short of the rat
    const p = new Pack(free, "me");
    p.step([walker("dat", 150, 330)], 0);
    p.setRats(rats([], [ended(rat(4), "dog", T + 20_000, "dat")]), 0);
    p.step([walker("dat", 150, 330)], DOG_END_MS - 1);
    expect(p.drawnRats(DOG_END_MS - 1, 0)).toHaveLength(1);
    p.step([walker("dat", 150, 330)], DOG_END_MS);
    expect(p.drawnRats(DOG_END_MS, 0)).toEqual([]);
  });
});

describe("Pack: the dogs (§7.3)", () => {
  it("follows each walker, starting at the heel; a walker gone loses the dog, a new coat is a new dog", () => {
    const p = new Pack(free, "me");
    p.step([walker("ann", 100, 100)], 0);
    expect(p.drawnDogs(0)).toEqual([{ id: "ann", x: 110, y: 98, facing: "down", coat: "muc", pose: "idle" }]);
    p.step([walker("ann", 100, 100, { dog: { name: "Mực", coat: "dom" } })], 16);
    expect(p.drawnDogs(16)).toMatchObject([{ id: "ann", x: 110, y: 98, coat: "dom" }]);
    p.step([], 32);
    expect(p.drawnDogs(32)).toEqual([]);
  });
  it("pets a remote walker's dog once per new fa 11, and mine when I pet it", () => {
    const p = new Pack(free, "me");
    let t = 0;
    /** Steps `ms` in 16 ms frames, Ann's latest fa 11 starting at `petAt`. */
    const run = (ms: number, petAt: number | null) => {
      for (const end = t + ms; t < end;) {
        t += 16;
        p.step([walker("ann", 100, 100, { petAt }), walker("me", 200, 100)], t);
      }
    };
    const dog = (id: string) => p.drawnDogs(t).find((d) => d.id === id)!;
    run(400, null);
    expect(dog("ann")).toMatchObject({ x: 110, y: 98, pose: "idle" });
    const petAt = t;
    run(1000, petAt);
    expect(dog("ann")).toMatchObject({ x: 100, y: 109, pose: "wag" });
    expect(dog("me")).toMatchObject({ x: 210, y: 98 });
    // once its 2.5 s are over, the same animation does not pet it again
    run(2000, petAt);
    expect(dog("ann")).toMatchObject({ x: 110, y: 98 });
    expect(dog("ann").pose).not.toBe("wag");
    p.pet(t);
    run(500, petAt);
    expect(dog("me")).toMatchObject({ x: 200, y: 109, pose: "wag" });
    expect(dog("ann")).toMatchObject({ x: 110, y: 98 });
  });
  it("droops my own hungry dog once it sits", () => {
    const p = new Pack(free, "me");
    p.step([walker("me", 100, 100, { hungry: true })], 0);
    p.step([walker("me", 100, 100, { hungry: true })], 3000);
    expect(p.drawnDogs(3000)[0].pose).toBe("hungry");
    p.step([walker("me", 100, 100)], 3016);
    expect(p.drawnDogs(3016)[0].pose).toBe("sit");
  });
  it("sends my dog for a live rat: the rat lies fallen until carried; a recall brings the dog back and the rat runs on", () => {
    const p = new Pack(free, "me");
    p.setRats(rats([rat(1)]), 0);
    expect(p.pounce(1, 0, T + 20_000)).toBe(false); // no dog of mine yet
    p.step([walker("me", 150, 330)], 0);
    expect(p.pounce(9, 0, T + 20_000)).toBe(false); // no such rat
    expect(p.pounce(1, 0, T + 20_000)).toBe(true);
    const at = ratAt(rat(1), T + 20_000)!;
    expect(p.liveRats).toEqual([]);
    expect(p.drawnRats(0, T + 25_000)).toEqual([{ key: "p1", x: at.x, y: at.y, dir: at.dir, moving: false, fallen: true }]);
    expect(p.drawnDogs(0)[0].pose).toBe("run");
    p.recall();
    expect(p.liveRats.map((r) => r.id)).toEqual([1]);
    expect(p.drawnRats(0, T + 25_000).map((r) => r.key)).toEqual(["r1"]);
    p.step([walker("me", 150, 330)], 16);
    expect(p.drawnDogs(16)[0].pose).not.toBe("run");
  });
  it("keeps my pounce playing when the hunt's answer removes the rat (its recent entry is mine, not replayed)", () => {
    const p = new Pack(free, "me");
    p.setRats(rats([rat(1)]), 0);
    p.step([walker("me", 150, 330)], 0);
    p.pounce(1, 0, T + 20_000);
    expect(p.setRats(rats([], [ended(rat(1), "dog", T + 20_000, "me", "Ki")]), 100)).toEqual([]);
    expect(p.drawnRats(100, T + 25_000).map((r) => r.key)).toEqual(["p1"]);
  });
});
```

**tests/unit/game-world.test.ts.** Replace:

```ts

  it("forgets it on bye and ignores my own fa", () => {
```

with:

```ts

  it("tells when the one playing started, so a new fa 11 pets a dog once (v17)", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 0);
    w.applyMessage({ t: "fa", id: "ann", a: 11 }, 1000);
    expect(w.farmAnimAt("ann", 1500)).toBe(1000);
    w.applyMessage({ t: "fa", id: "ann", a: 11 }, 2000);
    expect(w.farmAnimAt("ann", 2500)).toBe(2000);
    expect(w.farmAnimAt("ann", 2000 + FARM_ANIM_MS)).toBeNull();
    expect(w.farmAnimAt("bob", 1500)).toBeNull();
  });

  it("forgets it on bye and ignores my own fa", () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-rats.test.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-pack.test.ts tests/unit/game-world.test.ts`
Expected: FAIL — `game-pack.test.ts` cannot load `@/lib/game/pack`, and 8 tests fail (no rat prompt, no dog or rats on the canvas handle); 4 files fail, 63 tests pass.

- [ ] **Step 3: Implement**

**components/game/GameCanvas.tsx — edit 1 of 10.** Replace:

```tsx
import type { CardGame } from "@/lib/game/cards/deck";
import { GameEngine, type LocalFishing, type RosterEntry } from "@/lib/game/engine";
import { phaseCode } from "@/lib/game/fishing/cast";
```

with:

```tsx
import type { CardGame } from "@/lib/game/cards/deck";
import { GameEngine, type LocalFishing, type LocalInfo, type RosterEntry } from "@/lib/game/engine";
import type { FieldRats } from "@/lib/game/farm/rats";
import { phaseCode } from "@/lib/game/fishing/cast";
```

**components/game/GameCanvas.tsx — edit 2 of 10.** Replace:

```tsx
import { joinGameChannel } from "@/lib/game/net/channel";
import type { FarmAnim, FishPhase, GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs, type ReplyScheduler } from "@/lib/game/net/replies";
```

with:

```tsx
import { joinGameChannel } from "@/lib/game/net/channel";
import { FARM_ANIM, type FarmAnim, type FishPhase, type GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs, type ReplyScheduler } from "@/lib/game/net/replies";
```

**components/game/GameCanvas.tsx — edit 3 of 10.** Replace:

```tsx
  setRoster: (entries: RosterEntry[]) => void;
  setLocal: (info: { name: string; badges: string; look: Look }) => void;
  showBubble: (accountId: string, text: string) => void;
```

with:

```tsx
  setRoster: (entries: RosterEntry[]) => void;
  /** Me: name, badges, look, and (v17) my dog, drooping while hungry. */
  setLocal: (info: LocalInfo) => void;
  showBubble: (accountId: string, text: string) => void;
```

**components/game/GameCanvas.tsx — edit 4 of 10.** Replace:

```tsx
  mapId: () => MapId | null;
}
```

with:

```tsx
  mapId: () => MapId | null;
  /** The field's rats (v17 §5.4): each walks its seeded path; an ending in `recent` plays once. */
  setRats: (rats: FieldRats | null) => void;
  /** My dog runs for live rat `ratId` (the dog_hunt call, §7.2); false without my dog or the rat. */
  dogPounce: (ratId: number) => boolean;
  /** A refused hunt: my dog comes back. */
  dogRecall: () => void;
  /** Pet my dog (D27): it comes to my front and wags, and `fa 11` shows the hearts to everyone. */
  petDog: () => void;
  /** Where I stand on the map shown (world px), or null while none is. */
  localPos: () => Vec | null;
  /** When I last pressed a key or touched the canvas (performance.now(); −Infinity before). */
  lastInputAt: () => number;
}
```

**components/game/GameCanvas.tsx — edit 5 of 10.** Replace:

```tsx
  arrive: Spot | null;
  /** Used when a world starts; later changes go through the handle's setLocal. */
  initial: { name: string; badges: string; look: Look };
```

with:

```tsx
  arrive: Spot | null;
  /** Used when a world starts; later changes go through the handle's setLocal (whose dog every new world keeps). */
  initial: { name: string; badges: string; look: Look };
```

**components/game/GameCanvas.tsx — edit 6 of 10.** Replace:

```tsx
  const gatherRef = useRef<ReadonlyArray<{ id: string; ready: boolean }>>([]);
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
```

with:

```tsx
  const gatherRef = useRef<ReadonlyArray<{ id: string; ready: boolean }>>([]);
  // v17: my dog (from the latest setLocal), the field's rats and my last input, kept across worlds
  const dogRef = useRef<Pick<LocalInfo, "dog" | "dogHungry">>({});
  const ratsRef = useRef<FieldRats | null>(null);
  const inputAtRef = useRef(-Infinity);
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
```

**components/game/GameCanvas.tsx — edit 7 of 10.** Replace:

```tsx
      },
      setLocal: (info) => engineRef.current?.setLocal(info),
      showBubble: (id, text) => engineRef.current?.showBubble(id, text),
```

with:

```tsx
      },
      setLocal: (info) => {
        // a call without a dog keeps the one I have (null removes it)
        dogRef.current = {
          dog: info.dog !== undefined ? info.dog : dogRef.current.dog, dogHungry: info.dogHungry ?? dogRef.current.dogHungry,
        };
        engineRef.current?.setLocal({ ...info, ...dogRef.current });
      },
      showBubble: (id, text) => engineRef.current?.showBubble(id, text),
```

**components/game/GameCanvas.tsx — edit 8 of 10.** Replace:

```tsx
      mapId: () => worldRef.current,
    };
```

with:

```tsx
      mapId: () => worldRef.current,
      setRats: (rats) => {
        ratsRef.current = rats;
        engineRef.current?.setRats(rats);
      },
      dogPounce: (ratId) => engineRef.current?.dogPounce(ratId) ?? false,
      dogRecall: () => engineRef.current?.dogRecall(),
      petDog: () => {
        const e = engineRef.current;
        if (!e) return;
        e.petDog();
        e.showFarmAnim(FARM_ANIM.pet);
        sendRef.current?.({ t: "fa", id: localId, a: FARM_ANIM.pet });
      },
      localPos: () => engineRef.current?.localPos() ?? null,
      lastInputAt: () => inputAtRef.current,
    };
```

**components/game/GameCanvas.tsx — edit 9 of 10.** Replace:

```tsx
        onFatal: () => propsRef.current.onFatal(),
      }, {
```

with:

```tsx
        onFatal: () => propsRef.current.onFatal(),
        onInput: () => {
          inputAtRef.current = performance.now();
        },
      }, {
```

**components/game/GameCanvas.tsx — edit 10 of 10.** Replace:

```tsx
    engine.setGatherSpots(gatherRef.current);
```

with:

```tsx
    engine.setGatherSpots(gatherRef.current);
    engine.setLocal({ name: init.name, badges: init.badges, look: init.look, ...dogRef.current });
    if (map.id === "field") engine.setRats(ratsRef.current);
```

**lib/game/engine.ts — edit 1 of 16.** Replace:

```ts
import type { CardGame } from "@/lib/game/cards/deck";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawBedCue, drawHoleCue } from "@/lib/game/art/gather-art";
```

with:

```ts
import type { CardGame } from "@/lib/game/cards/deck";
import { dogFrame, drawDog } from "@/lib/game/art/dog";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawRat, ratFrame } from "@/lib/game/art/rats";
import { drawBedCue, drawHoleCue } from "@/lib/game/art/gather-art";
```

**lib/game/engine.ts — edit 2 of 16.** Replace:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import { getCharacterFrames } from "@/lib/game/art/raster";
```

with:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import { promptTarget, RAT_PROMPT_RANGE, ratAt, ratInteractable, type FieldRats } from "@/lib/game/farm/rats";
import { getCharacterFrames } from "@/lib/game/art/raster";
```

**lib/game/engine.ts — edit 3 of 16.** Replace:

```ts
import type { GameMap, Interactable, Spot } from "@/lib/game/maps/types";
import { inputDir, type KeyState } from "@/lib/game/movement";
import { facingToCode, MAX_PATH_POINTS, type FacingCode, type FarmAnim, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { unseenGraceMs } from "@/lib/game/net/replies";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView, hitsCharacter, interactableAt, inUseRange, nearestInteractable, stackBoxes, type Box } from "@/lib/game/scene";
import { wrapBubble } from "@/lib/game/text";
```

with:

```ts
import type { GameMap, Interactable, Spot } from "@/lib/game/maps/types";
import { inputDir, isBlockedAt, type KeyState } from "@/lib/game/movement";
import { FARM_ANIM, facingToCode, MAX_PATH_POINTS, type FacingCode, type FarmAnim, type GameMessage, type Unit } from "@/lib/game/net/protocol";
import { Pack, type DogWalker } from "@/lib/game/pack";
import { unseenGraceMs } from "@/lib/game/net/replies";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView, hitsCharacter, interactableAt, inUseRange, stackBoxes, type Box } from "@/lib/game/scene";
import { wrapBubble } from "@/lib/game/text";
```

**lib/game/engine.ts — edit 4 of 16.** Replace:

```ts
import { CATCH_LABEL_MS, FARM_ANIM_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";

export type { RosterEntry } from "@/lib/game/world";
```

with:

```ts
import { CATCH_LABEL_MS, FARM_ANIM_MS, RemoteWorld, type RosterEntry } from "@/lib/game/world";
import type { PresenceDog } from "@/lib/presence-modes";

export type { RosterEntry } from "@/lib/game/world";

/** Me as the engine draws me; `dog` (v17) walks with me, drooping while `dogHungry`. */
export interface LocalInfo { name: string; badges: string; look: Look; dog?: PresenceDog | null; dogHungry?: boolean }
```

**lib/game/engine.ts — edit 5 of 16.** Replace:

```ts
  onFatal?: (err: unknown) => void;
}
```

with:

```ts
  onFatal?: (err: unknown) => void;
  /** I pressed a key or touched the canvas (the dog's auto-hunt wants input in the last 3 minutes, v17 §7.2). */
  onInput?: () => void;
}
```

**lib/game/engine.ts — edit 6 of 16.** Replace:

```ts
  private reactions: Array<{ id: string | null; emoji: string; born: number; dx: number }> = [];
  private localInfo: { name: string; badges: string; look: Look };
  private keys: KeyState = { ...NO_KEYS };
```

with:

```ts
  private reactions: Array<{ id: string | null; emoji: string; born: number; dx: number }> = [];
  private localInfo: LocalInfo;
  /** The dogs and the field's rats (v17). */
  private readonly pack: Pack;
  private keys: KeyState = { ...NO_KEYS };
```

**lib/game/engine.ts — edit 7 of 16.** Replace:

```ts
    this.world = new RemoteWorld(map, opts.localId);
    this.localInfo = { name: opts.name, badges: opts.badges, look: opts.look };
```

with:

```ts
    this.world = new RemoteWorld(map, opts.localId);
    this.pack = new Pack((x, y) => isBlockedAt(map, x, y), opts.localId);
    this.localInfo = { name: opts.name, badges: opts.badges, look: opts.look };
```

**lib/game/engine.ts — edit 8 of 16.** Replace:

```ts

  setLocal(info: { name: string; badges: string; look: Look }): void {
    this.localInfo = info;
  }
```

with:

```ts

  setLocal(info: LocalInfo): void {
    this.localInfo = info;
  }

  /** The field's rats (v17 §5.4): each walks its seeded path; a `recent` ending plays once (a sling catch with a puff). */
  setRats(rats: FieldRats | null): void {
    for (const p of this.pack.setRats(rats, performance.now())) this.puff(p);
  }

  /** My dog runs for live rat `ratId` (the dog_hunt call); false without my dog or the rat. */
  dogPounce(ratId: number): boolean {
    return this.pack.pounce(ratId, performance.now(), serverNow());
  }

  /** A refused hunt: my dog comes back. */
  dogRecall(): void {
    this.pack.recall();
  }

  /** My dog comes to my front for 2.5 s (the caller shows `fa 11`). */
  petDog(): void {
    this.pack.pet(performance.now());
  }

  /** Where I stand (world px). */
  localPos(): Vec {
    return { x: this.local.pos.x, y: this.local.pos.y };
  }
```

**lib/game/engine.ts — edit 9 of 16.** Replace:

```ts
    if (!this.inputEnabled || e.ctrlKey || e.metaKey || e.altKey || this.isTyping(e.target)) return;
    if (this.rodOut) {
```

with:

```ts
    if (!this.inputEnabled || e.ctrlKey || e.metaKey || e.altKey || this.isTyping(e.target)) return;
    this.cb.onInput?.();
    if (this.rodOut) {
```

**lib/game/engine.ts — edit 10 of 16.** Replace:

```ts
    if (!this.inputEnabled || e.button !== 0) return;
    if (this.rodOut) {
```

with:

```ts
    if (!this.inputEnabled || e.button !== 0) return;
    this.cb.onInput?.();
    if (this.rodOut) {
```

**lib/game/engine.ts — edit 11 of 16.** Replace:

```ts
    }
    const hit = this.actorAt(w);
```

with:

```ts
    }
    // v17: a tap on a rat shoots it within 40 px, else walks toward it (§12.1)
    const rat = this.ratUnder(w);
    if (rat) {
      if (Math.hypot(rat.use.x - this.local.pos.x, rat.use.y - this.local.pos.y) <= RAT_PROMPT_RANGE) this.trigger(rat);
      else {
        this.pendingInteract = null;
        this.walkTo(rat.use);
      }
      return;
    }
    const hit = this.actorAt(w);
```

**lib/game/engine.ts — edit 12 of 16.** Replace:

```ts
    this.walkTo(w);
  };

  /** Front-most other member under world point p. */
```

with:

```ts
    this.walkTo(w);
  };

  /** The live rat drawn under world point p (a finger-sized box around it), as its interactable; field only. */
  private ratUnder(p: Vec): Interactable | null {
    if (this.map.id !== "field") return null;
    const t = serverNow();
    for (const r of this.pack.liveRats) {
      const at = ratAt(r, t);
      if (at && Math.abs(p.x - at.x) <= 8 && p.y >= at.y - 10 && p.y <= at.y + 4) return ratInteractable(r, at);
    }
    return null;
  }

  /** Front-most other member under world point p. */
```

**lib/game/engine.ts — edit 13 of 16.** Replace:

```ts
    this.announceMove(now);
    const near = this.rodOut ? null : nearestInteractable(this.map, this.local.pos);
    if (near !== this.prompt) {
      this.prompt = near;
```

with:

```ts
    this.announceMove(now);
    // a map interactable in range always wins E; else, on the field, a rat within 40 px (v17 §12.1). The same rat keeps
    // its prompt object while it runs.
    const near = this.rodOut ? null : promptTarget(this.map, this.local.pos, this.pack.liveRats, serverNow());
    if (near?.kind === "rat" && this.prompt?.kind === "rat" && near.rat === this.prompt.rat) {
      this.prompt.use = near.use;
      this.prompt.rect = near.rect;
    } else if (near !== this.prompt) {
      this.prompt = near;
```

**lib/game/engine.ts — edit 14 of 16.** Replace:

```ts
    this.world.tick(dt, now);
    const inset = Math.ceil((this.insetCss * this.dpr) / this.scale);
```

with:

```ts
    this.world.tick(dt, now);
    this.pack.step(this.dogWalkers(now), now);
    const inset = Math.ceil((this.insetCss * this.dpr) / this.scale);
```

**lib/game/engine.ts — edit 15 of 16.** Replace:

```ts
    if (this.puffs.length > 0) this.puffs = this.puffs.filter((p) => now - p.born < PUFF_MS);
  }
```

with:

```ts
    if (this.puffs.length > 0) this.puffs = this.puffs.filter((p) => now - p.born < PUFF_MS);
  }

  /** Everyone drawn walking with a dog this frame: me, and the visible walkers whose presence has one (v17 §7.3). */
  private dogWalkers(now: number): DogWalker[] {
    const out: DogWalker[] = [];
    const me = this.localInfo;
    if (me.dog) {
      out.push({
        id: this.opts.localId, x: this.local.display.x, y: this.local.display.y, facing: this.local.facing, dog: me.dog,
        hungry: me.dogHungry ?? false, petAt: null,
      });
    }
    for (const e of this.world.roster.values()) {
      const a = e.dog && !e.spot ? this.world.actors.get(e.id) : undefined;
      if (!e.dog || !a || !this.visible(e.id, now)) continue;
      out.push({
        id: e.id, x: a.display.x, y: a.display.y, facing: a.facing, dog: e.dog, hungry: false,
        petAt: this.world.farmAnim(e.id, now) === FARM_ANIM.pet ? this.world.farmAnimAt(e.id, now) : null,
      });
    }
    return out;
  }
```

**lib/game/engine.ts — edit 16 of 16.** Replace:

```ts
      if (onScreen(n.spot)) items.push({ y: n.spot.y, draw: () => drawActor(n.look, n.spot, n.spot.dir, 0) });
    }
```

with:

```ts
      if (onScreen(n.spot)) items.push({ y: n.spot.y, draw: () => drawActor(n.look, n.spot, n.spot.dir, 0) });
    }
    // v17: the dogs, and the field's rats, sorted with props and people (one frame held under reduced motion)
    const ft = reduced ? 0 : t;
    for (const d of this.pack.drawnDogs(t)) {
      if (onScreen(d)) items.push({ y: d.y, draw: () => drawDog(b, d.coat, d.facing, dogFrame(d.pose, ft), Math.round(d.x) - camX, Math.round(d.y) - camY) });
    }
    if (this.map.id === "field") {
      for (const r of this.pack.drawnRats(t, serverNow())) {
        if (!onScreen(r)) continue;
        items.push({ y: r.y, draw: () => drawRat(b, r.fallen ? "fall" : ratFrame(r.moving, ft), r.dir, Math.round(r.x) - camX, Math.round(r.y) - camY) });
      }
    }
```

**lib/game/farm/rats.ts — edit 1 of 2.** Replace:

```ts
import { FIELD_PLOTS, RAT_HOLES } from "../maps/field";
import type { Rect } from "../maps/types";
import type { Vec } from "../types";
```

with:

```ts
import { FIELD_PLOTS, RAT_HOLES } from "../maps/field";
import type { GameMap, Interactable, Rect } from "../maps/types";
import { nearestInteractable } from "../scene";
import type { Vec } from "../types";
```

**lib/game/farm/rats.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
/** How near a rat must be drawn for its prompt (§12.1). */
export const RAT_PROMPT_RANGE = 40;

/** A live rat drawn at p as an interactable (kind "rat"): E shoots it, a tap walks toward it. */
export function ratInteractable(r: RatLive, p: Vec): Interactable {
  return {
    id: `rat_${r.id}`, kind: "rat", label: "Chuột đồng", prompt: "Bắn chuột", rect: { x: p.x - 6, y: p.y - 7, w: 12, h: 9 },
    use: { x: p.x, y: p.y }, rat: r.id,
  };
}

/** What E does where I stand (§12.1): the nearest map interactable within PROMPT_RANGE always wins; else, on the
 *  field, the nearest live rat drawn within 40 px. */
export function promptTarget(map: GameMap, feet: Vec, live: readonly RatLive[], t: number): Interactable | null {
  const near = nearestInteractable(map, feet);
  if (near || map.id !== "field") return near;
  const r = nearestRat(live, feet, t, RAT_PROMPT_RANGE);
  const p = r ? ratAt(r, t) : null;
  return r && p ? ratInteractable(r, p) : null;
}
```

**lib/game/maps/types.ts — edit 1 of 2.** Replace:

```ts
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying"
  | "card_table" | "card_rules" | "crab_hole" | "snail_bed";
```

with:

```ts
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying"
  | "card_table" | "card_rules" | "crab_hole" | "snail_bed"
  // v17: a live rat, offered by the engine when no map interactable is in range (never in a map's list)
  | "rat";
```

**lib/game/maps/types.ts — edit 2 of 2.** Replace:

```ts
  spot?: number;
}
```

with:

```ts
  spot?: number;
  /** rat (v17): the live rat's id. */
  rat?: number;
}
```

Create `lib/game/pack.ts` with exactly:

```ts
import { followerPose, newFollower, pet, pounce, recall, stepFollower, type DogCoat, type DogPose, type Follower } from "./dog";
import { RAT, ratAt, ratFleePos, ratHome, ratPos, type FieldRats, type RatLive } from "./farm/rats";
import type { Facing, Vec } from "./types";
import type { PresenceDog } from "@/lib/presence-modes";

// v17 (spec §5.4, §7.3): the dogs and the rats of a world, stepped every frame from what the engine sees — each dog
// follows its walker, pounces and is petted; each rat walks its seeded path, and each ending in `rats.recent` plays
// once. No messages (C8, D24). Pure; the engine draws what it returns.

type Blocked = (x: number, y: number) => boolean;

/** A walker with a dog this frame: where they are drawn, their dog, and when their latest `fa 11` started (remote). */
export interface DogWalker {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  dog: PresenceDog;
  /** My own dog droops while hungry; the others' hunger is not known. */
  hungry: boolean;
  /** The start of the petting animation now playing on this walker, or null. */
  petAt: number | null;
}

export interface DrawnDog { id: string; x: number; y: number; facing: Facing; coat: DogCoat; pose: DogPose }
export interface DrawnRat { key: string; x: number; y: number; dir: 1 | -1; moving: boolean; fallen: boolean }

/** A sling catch shows the fallen rat and a puff this long; a dog's catch waits at most this long for the dog. */
export const SLING_END_MS = 600;
export const DOG_END_MS = 6000;

interface Ending {
  key: string;
  rat: RatLive;
  endedAt: number;
  how: "sling" | "dog" | "fled";
  /** The walker whose dog fetches it (a dog's catch on this map). */
  catcher: string | null;
  /** Where it was when it ended, and which way it faced. */
  at: Vec;
  dir: 1 | -1;
  /** When this client first saw the ending (it plays from then). */
  seenAt: number;
}

export class Pack {
  private readonly blocked: Blocked;
  private readonly localId: string;
  private readonly dogs = new Map<string, { f: Follower; coat: DogCoat; hungry: boolean; petAt: number | null }>();
  private live: RatLive[] = [];
  private recentIds = new Set<number>();
  private endings: Ending[] = [];
  /** Live rats my own dog is fetching: drawn fallen by their ending, not on their path. */
  private hidden = new Set<number>();

  constructor(blocked: Blocked, localId: string) {
    this.blocked = blocked;
    this.localId = localId;
  }

  /** The live rats, for the prompt and the auto-hunt. */
  get liveRats(): readonly RatLive[] {
    return this.live.filter((r) => !this.hidden.has(r.id));
  }

  /** The field's rats from the latest state (null: none). A `recent` entry seen for the first time starts its ending: a
   *  fled rat runs home, a sling catch lies fallen with a puff (whose points this returns), a dog's catch sends the
   *  catcher's dog when it walks here and otherwise plays as a sling catch. My own dog's catch is not replayed. */
  setRats(rats: FieldRats | null, now: number): Vec[] {
    this.live = rats?.live ?? [];
    this.hidden = new Set([...this.hidden].filter((id) => this.live.some((r) => r.id === id)));
    const recent = rats?.recent ?? [];
    const puffs: Vec[] = [];
    for (const r of recent) {
      if (this.recentIds.has(r.id) || (r.how === "dog" && r.by?.id === this.localId)) continue;
      const home = ratHome(r.plot);
      const p = home ? ratPos(r.seed, r.since, home.hole, home.rect, r.endedAt) : null;
      if (!p) continue;
      const catcher = r.how === "dog" && r.by && this.dogs.has(r.by.id) ? r.by.id : null;
      const how = r.how === "dog" && !catcher ? "sling" : r.how;
      if (catcher) this.update(catcher, (f) => pounce(f, p));
      if (how === "sling") puffs.push({ x: p.x, y: p.y });
      this.endings.push({ key: `e${r.id}`, rat: r, endedAt: r.endedAt, how, catcher, at: { x: p.x, y: p.y }, dir: p.dir, seenAt: now });
    }
    this.recentIds = new Set(recent.map((r) => r.id));
    return puffs;
  }

  /** One frame: each walker's dog follows them (a new one starts at the heel; a walker gone, or without a dog, loses
   *  it; a new coat is a new dog), a remote walker's fresh `fa 11` brings their dog to their front, and the endings that
   *  are over go. */
  step(walkers: readonly DogWalker[], now: number): void {
    const here = new Set<string>();
    for (const w of walkers) {
      here.add(w.id);
      let d = this.dogs.get(w.id);
      if (!d || d.coat !== w.dog.coat) {
        d = { f: newFollower(w, w.facing, now, this.blocked), coat: w.dog.coat, hungry: w.hungry, petAt: w.petAt };
        this.dogs.set(w.id, d);
      }
      const f = w.petAt !== null && w.petAt !== d.petAt ? pet(d.f, now) : d.f;
      d.f = stepFollower(f, { x: w.x, y: w.y, facing: w.facing }, now, this.blocked);
      d.hungry = w.hungry;
      d.petAt = w.petAt;
    }
    for (const id of [...this.dogs.keys()]) if (!here.has(id)) this.dogs.delete(id);
    this.endings = this.endings.filter((e) => !this.over(e, now));
  }

  /** My dog runs for live rat `ratId` (the dog_hunt call, §7.2); the rat lies fallen where it is drawn now until the
   *  dog carries it. False without my dog or the rat. */
  pounce(ratId: number, now: number, serverT: number): boolean {
    const r = this.live.find((x) => x.id === ratId);
    const p = r ? ratAt(r, serverT) : null;
    if (!r || !p || !this.dogs.has(this.localId)) return false;
    this.update(this.localId, (f) => pounce(f, p));
    this.hidden.add(ratId);
    this.endings.push({
      key: `p${ratId}`, rat: r, endedAt: serverT, how: "dog", catcher: this.localId, at: { x: p.x, y: p.y }, dir: p.dir, seenAt: now,
    });
    return true;
  }

  /** A refused hunt: my dog comes back, and the rat runs on. */
  recall(): void {
    this.update(this.localId, recall);
    this.endings = this.endings.filter((e) => e.key.charAt(0) !== "p");
    this.hidden.clear();
  }

  /** My pet (D27): my dog comes to my front for 2.5 s. */
  pet(now: number): void {
    this.update(this.localId, (f) => pet(f, now));
  }

  /** The dogs to draw. */
  drawnDogs(now: number): DrawnDog[] {
    return [...this.dogs].map(([id, d]) => ({ id, x: d.f.x, y: d.f.y, facing: d.f.facing, coat: d.coat, pose: followerPose(d.f, now, d.hungry) }));
  }

  /** The rats to draw: the live ones on their paths at server time `serverT`, and the endings as they play. */
  drawnRats(now: number, serverT: number): DrawnRat[] {
    const out: DrawnRat[] = [];
    for (const r of this.liveRats) {
      const p = ratAt(r, serverT);
      if (p) out.push({ key: `r${r.id}`, x: p.x, y: p.y, dir: p.dir, moving: p.moving, fallen: false });
    }
    for (const e of this.endings) {
      if (e.how !== "fled") {
        out.push({ key: e.key, x: e.at.x, y: e.at.y, dir: e.dir, moving: false, fallen: true });
        continue;
      }
      const home = ratHome(e.rat.plot);
      const p = home ? ratFleePos(e.rat.seed, e.rat.since, e.endedAt, home.hole, home.rect, e.endedAt + (now - e.seenAt)) : null;
      if (p) out.push({ key: e.key, x: p.x, y: p.y, dir: p.dir, moving: true, fallen: false });
    }
    return out;
  }

  private update(id: string, fn: (f: Follower) => Follower): void {
    const d = this.dogs.get(id);
    if (d) d.f = fn(d.f);
  }

  private over(e: Ending, now: number): boolean {
    const age = now - e.seenAt;
    if (e.how === "fled") return age >= RAT.fleeMs;
    if (e.how === "sling") return age >= SLING_END_MS;
    const mode = e.catcher ? this.dogs.get(e.catcher)?.f.mode : undefined;
    return age >= DOG_END_MS || (mode !== "pounce" && mode !== "leap");
  }
}
```

**lib/game/world.ts.** Replace:

```ts

  /** A member's fishing as of `now`: a phase older than FISHING_STALE_MS reads as idle, a catch label lasts CATCH_LABEL_MS. */
```

with:

```ts

  /** When the farm animation playing on a member now started (null = none): a new `fa 11` pets their dog once (v17). */
  farmAnimAt(id: string, now: number): number | null {
    const n = this.farmById.get(id);
    return n && now - n.at < FARM_ANIM_MS ? n.at : null;
  }

  /** A member's fishing as of `now`: a phase older than FISHING_STALE_MS reads as idle, a catch label lasts CATCH_LABEL_MS. */
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (4 files, 81 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameCanvas.tsx lib/game/engine.ts lib/game/farm/rats.ts lib/game/maps/types.ts lib/game/pack.ts lib/game/world.ts tests/unit/farm-rats.test.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-pack.test.ts tests/unit/game-world.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): dogs and rats in the world, and the rat prompt

lib/game/pack.ts steps a world's dogs and rats every frame from what the engine sees:
each walker's dog follows them (mine droops while hungry), a fresh fa 11 pets a
remote walker's dog once, my dog pounces for a rat and comes back on a refusal; the
live rats walk their seeded paths, and each `recent` ending plays once from when the
client first sees it — a fled rat runs home, a sling catch lies fallen with a puff,
a dog's catch sends the catcher's dog when it walks here (else it plays as a sling
catch), and my own dog's catch is not replayed. The engine draws them depth-sorted
with props and people, offers the nearest live rat within 40 px as a synthetic "rat"
interactable when no map interactable is in range (promptTarget: a plot, a keeper or
a portal always wins E), and walks toward a tapped rat. GameCanvas's handle gains
setRats, dogPounce, dogRecall, petDog (fa 11 for everyone), localPos and
lastInputAt, and keeps my dog and the rats for every new world.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameCanvas.tsx lib/game/engine.ts lib/game/farm/rats.ts lib/game/maps/types.ts lib/game/pack.ts lib/game/world.ts tests/unit/farm-rats.test.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-pack.test.ts tests/unit/game-world.test.ts
git commit -F <message file>
```

---

### Task 14: useField aims, shoots, pounces and sells, and wakes for the next rat

**Files:**
- Modify: `hooks/useField.ts`
- Test: `tests/unit/farm-overlays.test.tsx`, `tests/unit/use-field.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 7 (`RPCS_17`, `slingStart`, `slingShoot`, `dogHunt`, `sellRats`, `SlingAim`, `ShotAnswer`, `ratSeason`), Task 9 (`NOT_OPEN_17`, the `"sling"` context); `useField`'s `call`, `apply`, `applyMine`, `reload` (and 793f8b4's `crabStart(hole, boxName)`, `pickSnailBed(bed, boxName)`); `clock.ts`' `serverNow`.
- Produces: `FieldData.slingStart(rat, onError?)`, `.slingShoot(rat, hit, onError?)` (refusals read in the `"sling"` context), `.dogHunt(rat, onError?)`, `.sellRats()`; a missing v17 RPC says `NOT_OPEN_17` and leaves the field open; `RAT_REFETCH_JITTER_MS` (10 s) and `RAT_REFETCH_MIN_MS` (60 s): in rat season the field refetches at `next_at` plus 0–10 s, never sooner than a minute after the last rat refetch (§11, D10); the overlay test's field mock gains the four calls.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-overlays.test.tsx.** Replace:

```tsx
    pickSnailBed: vi.fn(), sellCritters: vi.fn(),
  },
```

with:

```tsx
    pickSnailBed: vi.fn(), sellCritters: vi.fn(),
    slingStart: vi.fn(), slingShoot: vi.fn(), dogHunt: vi.fn(), sellRats: vi.fn(),
  },
```

**tests/unit/use-field.test.tsx — edit 1 of 4.** Replace:

```tsx
import { clockOffset } from "@/lib/game/farm/clock";
import { NOT_OPEN_152 } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

with:

```tsx
import { clockOffset } from "@/lib/game/farm/clock";
import { NOT_OPEN_152, NOT_OPEN_17 } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

**tests/unit/use-field.test.tsx — edit 2 of 4.** Replace:

```tsx
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
}));
```

with:

```tsx
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
  slingStart: vi.fn(), slingShoot: vi.fn(), dogHunt: vi.fn(), sellRats: vi.fn(),
}));
```

**tests/unit/use-field.test.tsx — edit 3 of 4.** Replace:

```tsx

import { FP_GATHER_MS, FP_MIN_GAP_MS, useField } from "@/hooks/useField";
```

with:

```tsx

import { FP_GATHER_MS, FP_MIN_GAP_MS, RAT_REFETCH_MIN_MS, useField } from "@/hooks/useField";
```

**tests/unit/use-field.test.tsx — edit 4 of 4.** Append at the end of the file, after a blank line:

```tsx
describe("useField, v17", () => {
  const at = (s: number) => new Date(Date.parse(NOW) + s * 1000).toISOString();
  /** A field with rats: next_at `nextS` seconds after NOW, and the live rats given. */
  const ratField = (nextS: number, live: unknown[] = [], serverNow = NOW): FieldState => parseFieldState({
    server_now: serverNow,
    plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
    drying: [],
    mine: { items: {}, rice: {}, coins: 10, gift_claimed: true },
    rats: { next_at: at(nextS), price: 150, live, recent: [], plots: {} },
  })!;
  const RAT = { id: 1, plot: 5, since: NOW, seed: 1 };

  it("aims, shoots, pounces and sells, applying their answers", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.slingStart.mockResolvedValueOnce({ state: field(40), aim: { rat: 1, startedAt: 5 } });
    await act(async () => { expect(await result.current.slingStart(1)).toMatchObject({ aim: { rat: 1 } }); });
    expect(rpc.slingStart).toHaveBeenCalledWith("r", "tok", 1);
    expect(result.current.state?.mine.coins).toBe(40);
    rpc.slingShoot.mockResolvedValueOnce({ state: field(41), shot: { hit: true, price: 336, pellets: 9 } });
    await act(async () => { await result.current.slingShoot(1, true); });
    expect(rpc.slingShoot).toHaveBeenCalledWith("r", "tok", 1, true);
    expect(result.current.state?.mine.coins).toBe(41);
    rpc.dogHunt.mockResolvedValueOnce({ state: field(42), price: 169 });
    await act(async () => { expect(await result.current.dogHunt(1)).toMatchObject({ price: 169 }); });
    expect(rpc.dogHunt).toHaveBeenCalledWith("r", "tok", 1);
    rpc.sellRats.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 528 })!, sold: { count: 3, xu: 486 } });
    await act(async () => { expect(await result.current.sellRats()).toMatchObject({ sold: { count: 3, xu: 486 } }); });
    expect(rpc.sellRats).toHaveBeenCalledWith("tok");
    expect(result.current.state?.mine.coins).toBe(528);
  });

  it("reads the ná's refusals in the SlingGame's words and hands them to it; a hunt's go to its own handler", async () => {
    const onError = vi.fn(), onGame = vi.fn(), onHunt = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.slingShoot.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { expect(await result.current.slingShoot(1, false, onGame)).toBeNull(); });
    rpc.slingStart.mockRejectedValueOnce({ message: "rat gone" });
    await act(async () => { await result.current.slingStart(1, onGame); });
    expect(onGame.mock.calls).toEqual([["Đang nạp đạn…"], ["Con chuột này không còn nữa."]]);
    rpc.dogHunt.mockRejectedValueOnce({ message: "dog resting", details: "192" });
    await act(async () => { await result.current.dogHunt(1, onHunt); });
    expect(onHunt).toHaveBeenCalledWith("Chó đang nghỉ — 3 phút 12 giây nữa mới vồ tiếp.");
    expect(onError).not.toHaveBeenCalled();
    rpc.sellRats.mockRejectedValueOnce({ message: "nothing to sell" });
    await act(async () => { await result.current.sellRats(); });
    expect(onError).toHaveBeenCalledWith("Chưa có con chuột nào để bán.");
  });

  it("says a v17 call waits for 0019 and leaves the field open", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fetchFieldState.mockReturnValue(new Promise(() => {}));
    rpc.sellRats.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.sell_rats" });
    await act(async () => { await result.current.sellRats(); });
    expect(onError).toHaveBeenCalledWith(NOT_OPEN_17);
    expect(result.current.notOpen).toBe(false);
  });

  it("refetches at next_at plus 0–10 s in rat season, at most once a minute", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    rpc.fetchFieldState.mockResolvedValue(ratField(30, [RAT]));
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    expect(result.current.state?.rats?.live).toHaveLength(1);
    rpc.fetchFieldState.mockClear();
    // next_at in 30 s, plus 5 s of jitter
    await act(async () => { await vi.advanceTimersByTimeAsync(34_999); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    rpc.fetchFieldState.mockResolvedValue(ratField(40, [RAT], at(35)));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    // the next next_at is 5 s away (+ 5 s): the minute since the last one wins
    await act(async () => { await vi.advanceTimersByTimeAsync(RAT_REFETCH_MIN_MS - 1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    random.mockRestore();
  });

  it("waits for no spawn out of rat season, or before 0019", async () => {
    rpc.fetchFieldState.mockResolvedValue(ratField(30));
    const { result, unmount } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    expect(result.current.state?.rats).not.toBeNull();
    rpc.fetchFieldState.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    unmount();
    rpc.fetchFieldState.mockResolvedValue(field(1));
    renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.fetchFieldState.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-overlays.test.tsx tests/unit/use-field.test.tsx`
Expected: FAIL — the 4 v17 tests of `use-field.test.tsx` fail (no v17 calls, no `NOT_OPEN_17`, no rat refetch); 1 file fails, 1 passes (25 tests).

- [ ] **Step 3: Implement**

**hooks/useField.ts — edit 1 of 7.** Replace:

```ts
import type { FarmCatalog } from "@/lib/game/farm/catalog";
import { syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc, NOT_OPEN_152, NOT_OPEN_153 } from "@/lib/game/farm/messages";
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer,
  pickSnailBed, RPCS_152, RPCS_153, sellCritters, sellProduce, sellRice, type CatchAnswer, type CrabVisit, type FieldAction,
  type FieldAnswer, type MineAnswer,
} from "@/lib/game/farm/rpc";
import { withMine, type FarmMine, type FieldState } from "@/lib/game/farm/state";
```

with:

```ts
import type { FarmCatalog } from "@/lib/game/farm/catalog";
import { serverNow, syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc, NOT_OPEN_152, NOT_OPEN_153, NOT_OPEN_17 } from "@/lib/game/farm/messages";
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, dogHunt, fetchFarmCatalog, fetchFieldState, fieldAction,
  loadSprayer, pickSnailBed, RPCS_152, RPCS_153, RPCS_17, sellCritters, sellProduce, sellRats, sellRice, slingShoot, slingStart,
  type CatchAnswer, type CrabVisit, type FieldAction, type FieldAnswer, type MineAnswer, type ShotAnswer, type SlingAim,
} from "@/lib/game/farm/rpc";
import { ratSeason } from "@/lib/game/farm/season";
import { withMine, type FarmMine, type FieldState } from "@/lib/game/farm/state";
```

**hooks/useField.ts — edit 2 of 7.** Replace:

```ts
  sellCritters: (kind: string | null) => Promise<(MineAnswer & { sold: { n: number; xu: number } }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

with:

```ts
  sellCritters: (kind: string | null) => Promise<(MineAnswer & { sold: { n: number; xu: number } }) | null>;
  /** v17 (§6.1): aim the ná at a live rat. A refusal's text goes to `onError` when given (the SlingGame shows it). */
  slingStart: (rat: number, onError?: (text: string) => void) => Promise<{ state: FieldState; aim: SlingAim } | null>;
  /** A shot; a hit catches. Refusals read in the SlingGame's context ("too fast" is "Đang nạp đạn…"). */
  slingShoot: (rat: number, hit: boolean, onError?: (text: string) => void) => Promise<{ state: FieldState; shot: ShotAnswer } | null>;
  /** My dog's pounce (§7.2); a refusal's text goes to `onError` when given (the auto-hunt shows none). */
  dogHunt: (rat: number, onError?: (text: string) => void) => Promise<{ state: FieldState; price: number } | null>;
  /** cô Út buys every rat in the bag at the prices fixed at each catch (§5.6). */
  sellRats: () => Promise<(MineAnswer & { sold: { count: number; xu: number } }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

**hooks/useField.ts — edit 3 of 7.** Replace:

```ts
export const FP_MIN_GAP_MS = 2000;
```

with:

```ts
export const FP_MIN_GAP_MS = 2000;
/** v17 (§11): in rat season the field is fetched at `rats.next_at` plus up to 10 s, at most once a minute. */
export const RAT_REFETCH_JITTER_MS = 10_000;
export const RAT_REFETCH_MIN_MS = 60_000;
```

**hooks/useField.ts — edit 4 of 7.** Replace:

```ts

  /** Run RPC `rpc` and apply its answer. On error: the Vietnamese text, read in its context (the RPC's, unless `context`
```

with:

```ts

  // v17 (§11): spawns send nothing, so in rat season the field is fetched again at rats.next_at plus 0–10 s, at most once
  // a minute; each newer state sets the timer anew
  const ratFetchAt = useRef<number | null>(null);
  useEffect(() => {
    const rats = state?.rats;
    if (!active || !state || !rats || !catalog || !ratSeason(state, catalog, rats.nextAt)) return;
    const due = rats.nextAt - serverNow() + Math.random() * RAT_REFETCH_JITTER_MS;
    const floor = ratFetchAt.current === null ? 0 : ratFetchAt.current + RAT_REFETCH_MIN_MS - Date.now();
    const timer = setTimeout(() => {
      ratFetchAt.current = Date.now();
      void reload();
    }, Math.max(0, due, floor));
    return () => clearTimeout(timer);
  }, [active, state, catalog, reload]);

  /** Run RPC `rpc` and apply its answer. On error: the Vietnamese text, read in its context (the RPC's, unless `context`
```

**hooks/useField.ts — edit 5 of 7.** Replace:

```ts
   *  the field is open: they say NOT_OPEN_152 and leave the field open (v15.2 R28); before 0018 the gathering RPCs say
   *  NOT_OPEN_153 (v15.3 R23). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void,
```

with:

```ts
   *  the field is open: they say NOT_OPEN_152 and leave the field open (v15.2 R28); before 0018 the gathering RPCs say
   *  NOT_OPEN_153 (v15.3 R23), and before 0019 the v17 ones NOT_OPEN_17. */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void,
```

**hooks/useField.ts — edit 6 of 7.** Replace:

```ts
    } catch (err) {
      const missing = isMissingRpc(err), v152 = RPCS_152.has(opts.rpc), v153 = RPCS_153.has(opts.rpc);
      if (missing && !v152 && !v153) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) {
        const text = missing && v152 ? NOT_OPEN_152 : missing && v153 ? NOT_OPEN_153 : farmErrorMessage(err, opts.itemName, opts.context ?? opts.rpc);
        (opts.onError ?? onErrorRef.current)(text);
```

with:

```ts
    } catch (err) {
      const missing = isMissingRpc(err), v152 = RPCS_152.has(opts.rpc), v153 = RPCS_153.has(opts.rpc), v17 = RPCS_17.has(opts.rpc);
      if (missing && !v152 && !v153 && !v17) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) {
        const text = missing && v152 ? NOT_OPEN_152 : missing && v153 ? NOT_OPEN_153 : missing && v17 ? NOT_OPEN_17
          : farmErrorMessage(err, opts.itemName, opts.context ?? opts.rpc);
        (opts.onError ?? onErrorRef.current)(text);
```

**hooks/useField.ts — edit 7 of 7.** Replace:

```ts
      call(() => sellCritters(token, kind), applyMine, { rpc: "sell_critters" }), [call, applyMine, token]),
  };
```

with:

```ts
      call(() => sellCritters(token, kind), applyMine, { rpc: "sell_critters" }), [call, applyMine, token]),
    slingStart: useCallback((rat: number, onError?: (text: string) => void) =>
      call(() => slingStart(roomId, token, rat), (n, r) => apply(n, r.state), { rpc: "sling_start", context: "sling", onError }),
    [call, apply, roomId, token]),
    slingShoot: useCallback((rat: number, hit: boolean, onError?: (text: string) => void) =>
      call(() => slingShoot(roomId, token, rat, hit), (n, r) => apply(n, r.state), { rpc: "sling_shoot", context: "sling", onError }),
    [call, apply, roomId, token]),
    dogHunt: useCallback((rat: number, onError?: (text: string) => void) =>
      call(() => dogHunt(roomId, token, rat), (n, r) => apply(n, r.state), { rpc: "dog_hunt", onError }), [call, apply, roomId, token]),
    sellRats: useCallback(() => call(() => sellRats(token), applyMine, { rpc: "sell_rats" }), [call, applyMine, token]),
  };
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 29 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint hooks/useField.ts tests/unit/farm-overlays.test.tsx tests/unit/use-field.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): useField aims, shoots, pounces and sells, and wakes for the next rat

useField gains slingStart, slingShoot, dogHunt and sellRats. The ná's refusals are
read in the "sling" context, so a "too fast" shot says "Đang nạp đạn…", and each
call takes an onError so the SlingGame and the auto-hunt can show their own words.
A v17 call missing before 0019 says NOT_OPEN_17 and leaves the field open. In rat
season the hook refetches the field at next_at plus 0-10 s of jitter, never sooner
than a minute after the last rat refetch; out of season, or before 0019, it waits
for nothing. The overlay test's field mock gains the four calls.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add hooks/useField.ts tests/unit/farm-overlays.test.tsx tests/unit/use-field.test.tsx
git commit -F <message file>
```

---

### Task 15: SlingGame, and E at a rat aims the ná

**Files:**
- Create: `components/game/farm/SlingGame.tsx`, `lib/game/art/sling-art.ts`
- Modify: `components/game/GameShell.tsx`, `components/game/farm/FarmOverlays.tsx`, `hooks/useFarmController.ts`, `lib/game/farm/messages.ts`, `lib/game/overlays.ts`
- Test: `tests/unit/farm-sling-game.test.tsx` (create); `tests/unit/anticheat-pins.test.tsx`, `tests/unit/farm-overlays.test.tsx`, `tests/unit/game-overlays.test.ts`, `tests/unit/use-farm-controller.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 8 (`createSling`, `stepSling`, `slingSent`, `slingAnswered`, `SLING`, `SLING_MISS`), Task 9 (`slingGear`, `ratPrompt`, `farmErrorMessage`, `NO_PELLETS`, `slingTitle`, `SLING_HELP`, `SLING_CANCEL`, `slingStatus`, `slingHitText`, `ratGoneText`, `ratSpawnText`, `NOT_OPEN_17`), Task 11 (`drawRat`, `ratFrame`, `FARM_ANIM.aim`), Task 13 (`GameCanvasHandle.setRats`, the synthetic rat interactable), Task 14 (`slingStart`, `slingShoot`); the controller's `closes` counter and `canvas()?.mapId()` (793f8b4).
- Produces:
  - `messages.ts`: `RAT_GONE` (the `rat gone` text, which `farmErrorMessage` returns);
  - `useFarmController`: `FarmSling {rat, plot, seed, begunAt, answers, phase, message, gone}`, `SLING_FA_MS` (2 s), `sling`, `slingShot(hit)`, `slingReaim()`, `closeSling()`; E at a rat says what gear is missing or calls `sling_start` (answer dropped after a close or off the field) and opens the game with `fa 12` every 2 s; a miss with pellets left counts an answer, a hit ends it with its price and `fp {plot}`, the last pellet or a refusal ends it; `promptText` for `"rat"`; the rats go to the canvas with every state, and a rat on a plot I farm is toasted once;
  - `lib/game/art/sling-art.ts`: `drawSlingScene(c, s, t, reduced)` (§12.2's scene);
  - `components/game/farm/SlingGame.tsx` (§12.2), shown by `FarmOverlays` (`rat gone` named from the state's `recent`);
  - `overlays.ts`: `OpenOverlays.slingGame` (blocking only), set by `GameShell`; the pins test's canvas mock gains `setRats`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/anticheat-pins.test.tsx — edit 1 of 2.** Replace:

```tsx
  it("transplants after a TransplantGame round, and picks, with quality 1", async () => {
    const canvas = {
      setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(), mapId: () => "field",
    } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

with:

```tsx
  it("transplants after a TransplantGame round, and picks, with quality 1", async () => {
    const canvas = {
      setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(), mapId: () => "field", setRats: vi.fn(),
    } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 2.** Replace:

```tsx
    rpc.pickSnailBed.mockImplementation(async () => ({ serverNow: iso(0), mine: STATE.mine, snails: { caught: [], escaped: 0 } }));
    const canvas = {
      setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(), mapId: () => "field",
    } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

with:

```tsx
    rpc.pickSnailBed.mockImplementation(async () => ({ serverNow: iso(0), mine: STATE.mine, snails: { caught: [], escaped: 0 } }));
    const canvas = {
      setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(), mapId: () => "field", setRats: vi.fn(),
    } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

**tests/unit/farm-overlays.test.tsx — edit 1 of 2.** Replace:

```tsx
  bed: null, cancelBed: vi.fn(), moved: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
```

with:

```tsx
  bed: null, cancelBed: vi.fn(), moved: vi.fn(),
  sling: null, slingShot: vi.fn(), slingReaim: vi.fn(), closeSling: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
```

**tests/unit/farm-overlays.test.tsx — edit 2 of 2.** Replace:

```tsx
  ...over,
});
```

with:

```tsx
  ...over,
});

describe("FarmOverlays, the ná (v17 §12.2)", () => {
  const SLING = { rat: 7, plot: 5, seed: 1, begunAt: 1, answers: 0, phase: "refused" as const, message: "Con chuột này không còn nữa.", gone: true };
  const withRats = (recent: unknown[]) => parseFieldState({
    server_now: new Date(NOW).toISOString(),
    plots: [{ no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null }],
    drying: [],
    mine: { items: { ammo_pellet: 12 }, rice: {}, coins: 10, gift_claimed: true },
    rats: { next_at: new Date(NOW).toISOString(), price: 150, live: [], recent, plots: {} },
  })!;

  it("names who took a gone rat from the state's recent, or sends it home", () => {
    const ended = new Date(NOW).toISOString();
    const recent = [{ id: 7, plot: 5, since: ended, seed: 1, ended_at: ended, how: "dog", by: { id: "b", name: "Dat" }, dog: "Mực" }];
    const farm = controller({ sling: SLING, data: { ...controller().data, state: withRats(recent) } });
    const { rerender } = render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("status")).toHaveTextContent("Chuột bị Mực của Dat vồ mất rồi!");
    rerender(<FarmOverlays farm={controller({ sling: SLING, data: { ...controller().data, state: withRats([]) } })} me="me" onField />);
    expect(screen.getByRole("status")).toHaveTextContent("Chuột chạy về hang rồi.");
  });

  it("shows a refusal's own text, and closes on Đóng", () => {
    const farm = controller({ sling: { ...SLING, gone: false, message: "Hết đạn đất — mua ở tiệm anh Hai." } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("status")).toHaveTextContent("Hết đạn đất — mua ở tiệm anh Hai.");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(farm.closeSling).toHaveBeenCalled();
  });
});
```

Create `tests/unit/farm-sling-game.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import SlingGame from "@/components/game/farm/SlingGame";
import type { FarmSling } from "@/hooks/useFarmController";
import { drawSlingScene } from "@/lib/game/art/sling-art";
import { SLING_HELP } from "@/lib/game/farm/messages";
import { createSling, SLING, stepSling } from "@/lib/game/farm/sling";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sling = (over: Partial<FarmSling> = {}): FarmSling => ({
  rat: 7, plot: 3, seed: 11, begunAt: 1, answers: 0, phase: "playing", message: null, gone: false, ...over,
});
function show(s: FarmSling, over: { panelOpen?: boolean; pellets?: number } = {}) {
  const props = { onShot: vi.fn(), onReaim: vi.fn(), onClose: vi.fn() };
  const ui = (x: FarmSling) => (
    <SlingGame sling={x} pellets={over.pellets ?? 12} message={x.message} panelOpen={over.panelOpen ?? false} {...props} />
  );
  const { rerender } = render(ui(s));
  return { ...props, rerender: (x: FarmSling) => rerender(ui(x)) };
}
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const hold = (target: Window | Element = window) => fireEvent.keyDown(target, { code: "Space", key: " " });
const release = () => fireEvent.keyUp(window, { code: "Space", key: " " });

describe("drawSlingScene (v17 §12.2)", () => {
  it("paints inside the 320 × 180 scene at every stage, the power bar filling while drawing", () => {
    const rects: Array<[number, number, number, number]> = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const c = {
      imageSmoothingEnabled: true, fillStyle: "", fillRect: (...r: [number, number, number, number]) => rects.push(r),
      drawImage: (_img: unknown, ...r: [number, number, number, number]) => rects.push(r),
    };
    let s = createSling(4);
    for (let i = 0; i < 200; i++) {
      s = stepSling(s, 0.03, { holding: i > 80, aimTo: null, left: false, right: i % 2 === 0 });
      drawSlingScene(c as unknown as CanvasRenderingContext2D, s, i * 30, i % 2 === 0);
    }
    const bad = rects.filter(([x, y, w, h]) => x < 0 || y < 0 || x + w > SLING.width || y + h > SLING.height);
    expect(bad).toEqual([]);
    expect(c.imageSmoothingEnabled).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("SlingGame (v17 §12.2)", () => {
  it("names the plot, with the help, the pellets and the reload after the start answer", () => {
    show(sling());
    expect(screen.getByRole("heading", { name: "🎯 Bắn chuột · thửa 3" })).toBeInTheDocument();
    expect(screen.getByText(SLING_HELP)).toBeInTheDocument();
    run(16);
    expect(screen.getByText("Đạn: 12 viên · Nạp đạn…")).toBeInTheDocument();
    run(2300);
    expect(screen.getByText("Đạn: 12 viên")).toBeInTheDocument();
  });

  it("sends no shot before 2.2 s of reload, the draw and the 0.3 s flight: a full draw flies over", () => {
    const p = show(sling());
    hold();
    run(2200 + 1000 + 250);
    expect(p.onShot).not.toHaveBeenCalled();
    run(150);
    expect(p.onShot).toHaveBeenCalledTimes(1);
    expect(p.onShot).toHaveBeenCalledWith(false);
    expect(screen.getByText("Hụt — căng quá, đạn bay qua.")).toBeInTheDocument();
    // the answer came: the reload starts again
    release();
    p.rerender(sling({ answers: 1 }));
    run(16);
    expect(screen.getByText("Đạn: 12 viên · Nạp đạn…")).toBeInTheDocument();
  });

  it("draws with a pointer held on the scene: let go early and the pellet falls short", () => {
    const p = show(sling());
    run(2300);
    fireEvent.pointerDown(screen.getByRole("group", { name: "Ná" }), { clientX: 0 });
    run(300);
    fireEvent.pointerUp(screen.getByRole("group", { name: "Ná" }));
    run(400);
    expect(p.onShot).toHaveBeenCalledWith(false);
    expect(screen.getByText("Hụt — đạn rơi trước.")).toBeInTheDocument();
  });

  it("ignores Space typed into a text field", () => {
    render(<input aria-label="Chat" />);
    const p = show(sling());
    run(2300);
    hold(screen.getByRole("textbox", { name: "Chat" }));
    run(2000);
    expect(p.onShot).not.toHaveBeenCalled();
  });

  it("closes on Thôi or Esc and sends nothing; an Esc for another open panel is not its own", () => {
    const p = show(sling(), { panelOpen: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onClose).not.toHaveBeenCalled();
    cleanup();
    const q = show(sling());
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Thôi (Esc)" }));
    expect(q.onClose).toHaveBeenCalledTimes(2);
    expect(q.onShot).not.toHaveBeenCalled();
  });

  it("drops a shot ready 55 s or more after the last answer, and aims again instead", () => {
    const p = show(sling());
    run(55_000);
    hold();
    run(1400);
    expect(p.onShot).not.toHaveBeenCalled();
    expect(p.onReaim).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("shows the hit or the refusal, closed by Đóng or Esc", () => {
    const p = show(sling({ phase: "done", message: "🎯 Trúng! Bắt được chuột đồng — 336 xu, đem bán ở vựa cô Út." }));
    expect(screen.getByRole("status")).toHaveTextContent("🎯 Trúng! Bắt được chuột đồng — 336 xu, đem bán ở vựa cô Út.");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
```

**tests/unit/game-overlays.test.ts — edit 1 of 2.** Replace:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  farmCrab: false, cardPanel: false, rulesBook: false,
};
```

with:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  farmCrab: false, slingGame: false, cardPanel: false, rulesBook: false,
};
```

**tests/unit/game-overlays.test.ts — edit 2 of 2.** Replace:

```ts
  });
});
```

with:

```ts
  });

  it("takes only the canvas input for a SlingGame, which minds its own Esc (v17 §12.2)", () => {
    expect(overlayLocks({ ...none, slingGame: true })).toEqual({ blocking: true, panelOpen: false });
  });
});
```

**tests/unit/use-farm-controller.test.tsx — edit 1 of 4.** Replace:

```tsx
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(), pickSnailBed: vi.fn(),
  sellCritters: vi.fn(),
}));
```

with:

```tsx
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(), pickSnailBed: vi.fn(),
  sellCritters: vi.fn(), slingStart: vi.fn(), slingShoot: vi.fn(), dogHunt: vi.fn(), sellRats: vi.fn(),
}));
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 4.** Replace:

```tsx
import {
  CLAIM_SLOW_MS, HARVESTER_REFETCH_MS, ROUND_FA_MS, ROUND_LIMIT_MS, useFarmController, WORK_MS,
} from "@/hooks/useFarmController";
```

with:

```tsx
import {
  CLAIM_SLOW_MS, HARVESTER_REFETCH_MS, ROUND_FA_MS, ROUND_LIMIT_MS, SLING_FA_MS, useFarmController, WORK_MS,
} from "@/hooks/useFarmController";
```

**tests/unit/use-farm-controller.test.tsx — edit 3 of 4.** Replace:

```tsx
  setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(), mapId: vi.fn(() => "field"),
}) as unknown as GameCanvasHandle
  & Record<"setPlots" | "farmAnim" | "plotChanged" | "plant" | "setGatherSpots" | "mapId", ReturnType<typeof vi.fn>>;
const spot = (id: string): Interactable => getMap("field").interactables.find((i) => i.id === id)!;
```

with:

```tsx
  setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(), mapId: vi.fn(() => "field"),
  setRats: vi.fn(),
}) as unknown as GameCanvasHandle
  & Record<"setPlots" | "farmAnim" | "plotChanged" | "plant" | "setGatherSpots" | "mapId" | "setRats", ReturnType<typeof vi.fn>>;
const spot = (id: string): Interactable => getMap("field").interactables.find((i) => i.id === id)!;
```

**tests/unit/use-farm-controller.test.tsx — edit 4 of 4.** Append at the end of the file, after a blank line:

```tsx
describe("useFarmController, v17 the ná", () => {
  const RAT = { id: 7, plot: 6, since: iso(0), seed: 3 };
  /** The field with rat 7 on Lan's plot 6 (and `live` more), my pellets and my ná. */
  const ratField = (over: { items?: Record<string, number>; live?: unknown[]; recent?: unknown[] } = {}): FieldState => {
    const f = field({ mine: { items: over.items ?? { tool_sling: 1, ammo_pellet: 12 } } });
    return parseFieldState({
      server_now: iso(0),
      plots: [
        { no: 5, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: ME, lease: null, offers: 0, crop: null },
        { no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: LAN, lease: null, offers: 0, crop: null },
      ],
      drying: [],
      mine: { items: f.mine.items, rice: {}, coins: 1000, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
      rats: { next_at: iso(1), price: 150, live: over.live ?? [RAT], recent: over.recent ?? [], plots: {} },
    })!;
  };
  const ratSpot = (id = 7): Interactable => ({
    id: `rat_${id}`, kind: "rat", rat: id, prompt: "", use: { x: 0, y: 0 }, rect: { x: 0, y: 0, w: 1, h: 1 },
  }) as unknown as Interactable;
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  const aim = () => ({ state: ratField(), aim: { rat: 7, startedAt: NOW } });
  async function open(result: { current: ReturnType<typeof useFarmController> }) {
    rpc.slingStart.mockResolvedValueOnce(aim());
    await act(async () => {
      expect(result.current.interact(ratSpot())).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  beforeEach(() => {
    rpc.fetchFieldState.mockResolvedValue(ratField());
  });

  it("puts the rats on the canvas, and names the gear in the prompt", async () => {
    const { result, canvas } = setup();
    await flush();
    expect(canvas.setRats).toHaveBeenLastCalledWith(expect.objectContaining({ live: [expect.objectContaining({ id: 7 })] }));
    expect(result.current.promptText(ratSpot())).toBe("Bắn chuột");
    rpc.fetchFieldState.mockResolvedValue(ratField({ items: { tool_sling: 1 } }));
    await act(async () => { await result.current.data.reload(); });
    expect(result.current.promptText(ratSpot())).toBe("Chuột đồng (hết đạn)");
    rpc.fetchFieldState.mockResolvedValue(ratField({ items: {} }));
    await act(async () => { await result.current.data.reload(); });
    expect(result.current.promptText(ratSpot())).toBe("Chuột đồng (cần ná)");
  });

  it("says what gear is missing on E and calls nothing", async () => {
    rpc.fetchFieldState.mockResolvedValue(ratField({ items: { ammo_pellet: 5 } }));
    const { result, toast } = setup();
    await flush();
    act(() => { result.current.interact(ratSpot()); });
    expect(toast).toHaveBeenCalledWith("Chưa có ná — mua ở tiệm anh Hai.");
    expect(rpc.slingStart).not.toHaveBeenCalled();
  });

  it("aims with sling_start and opens the game, with fa 12 every 2 s", async () => {
    const { result, canvas } = setup();
    await flush();
    await open(result);
    expect(rpc.slingStart).toHaveBeenCalledWith("r", "tok", 7);
    expect(result.current.sling).toMatchObject({ rat: 7, plot: 6, answers: 0, phase: "playing" });
    expect(fa(canvas, FARM_ANIM.aim)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(SLING_FA_MS * 3); });
    expect(fa(canvas, FARM_ANIM.aim)).toBe(4);
    act(() => result.current.closeSling());
    expect(result.current.sling).toBeNull();
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    await act(async () => { await vi.advanceTimersByTimeAsync(SLING_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.aim)).toBe(4);
  });

  it("drops a sling_start answer that lands after the game was closed or the field left", async () => {
    const { result, canvas } = setup();
    await flush();
    let answer: (v: unknown) => void = () => {};
    rpc.slingStart.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    act(() => { result.current.interact(ratSpot()); });
    canvas.mapId.mockReturnValue("lobby");
    await act(async () => { answer(aim()); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.sling).toBeNull();
    expect(fa(canvas, FARM_ANIM.aim)).toBe(0);
  });

  it("counts a miss as an answer, ends on a hit with its price and sends fp for the plot", async () => {
    const { result, canvas } = setup();
    await flush();
    await open(result);
    rpc.slingShoot.mockResolvedValueOnce({ state: ratField(), shot: { hit: false, price: null, pellets: 11 } });
    await act(async () => { await result.current.slingShot(false); });
    expect(rpc.slingShoot).toHaveBeenCalledWith("r", "tok", 7, false);
    expect(result.current.sling).toMatchObject({ answers: 1, phase: "playing" });
    expect(canvas.plotChanged).not.toHaveBeenCalled();
    rpc.slingShoot.mockResolvedValueOnce({ state: ratField({ live: [] }), shot: { hit: true, price: 336, pellets: 10 } });
    await act(async () => { await result.current.slingShot(true); });
    expect(result.current.sling).toMatchObject({
      phase: "done", message: "🎯 Trúng! Bắt được chuột đồng — 336 xu, đem bán ở vựa cô Út.",
    });
    expect(canvas.plotChanged).toHaveBeenCalledWith(6);
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
  });

  it("ends when the last pellet is spent, and on a refusal: rat gone asks the overlay to name the catcher", async () => {
    const { result } = setup();
    await flush();
    await open(result);
    rpc.slingShoot.mockResolvedValueOnce({ state: ratField(), shot: { hit: false, price: null, pellets: 0 } });
    await act(async () => { await result.current.slingShot(false); });
    expect(result.current.sling).toMatchObject({ phase: "refused", message: "Hết đạn đất — mua ở tiệm anh Hai.", gone: false });
    act(() => result.current.closeSling());
    await open(result);
    rpc.slingShoot.mockRejectedValueOnce({ message: "rat gone" });
    await act(async () => { await result.current.slingShot(true); });
    expect(result.current.sling).toMatchObject({ phase: "refused", gone: true });
    act(() => result.current.closeSling());
    await open(result);
    rpc.slingShoot.mockRejectedValueOnce({ message: "rat limit", details: "600" });
    await act(async () => { await result.current.slingShot(true); });
    expect(result.current.sling).toMatchObject({ phase: "refused", message: "Bạn bắt đủ 6 con chuột trong giờ này rồi — nghỉ 10 phút nhé.", gone: false });
  });

  it("re-aims with a new sling_start, which counts an answer", async () => {
    const { result } = setup();
    await flush();
    await open(result);
    rpc.slingStart.mockResolvedValueOnce(aim());
    await act(async () => { await result.current.slingReaim(); });
    expect(rpc.slingStart).toHaveBeenCalledTimes(2);
    expect(result.current.sling).toMatchObject({ answers: 1, phase: "playing" });
  });

  it("toasts a rat out on a plot I farm, once per rat", async () => {
    rpc.fetchFieldState.mockResolvedValue(ratField({ live: [RAT, { id: 8, plot: 5, since: iso(0), seed: 4 }] }));
    const { result, toast } = setup();
    await flush();
    expect(vi.mocked(toast).mock.calls).toEqual([["🐀 Chuột mò ra phá thửa 5 của bạn!"]]);
    await act(async () => { await result.current.data.reload(); });
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/farm-sling-game.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — `farm-sling-game.test.tsx` cannot load `SlingGame`, and 11 tests fail (no `slingGame` lock, no sling session, no rats on the canvas, no spawn toast, no SlingGame in the overlays); 4 files fail, 1 passes (77 tests).

- [ ] **Step 3: Implement**

**components/game/GameShell.tsx.** Replace:

```tsx
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null, farmCrab: farm.crab !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null,
```

with:

```tsx
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null, farmCrab: farm.crab !== null,
    slingGame: farm.sling !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null,
```

**components/game/farm/FarmOverlays.tsx — edit 1 of 3.** Replace:

```tsx
import { BED_BAR_MS } from "@/lib/game/farm/gather";
import { NOT_OPEN } from "@/lib/game/farm/messages";
import { isTyping } from "@/lib/game/keys";
```

with:

```tsx
import { BED_BAR_MS } from "@/lib/game/farm/gather";
import { AMMO_PELLET } from "@/lib/game/farm/catalog";
import { NOT_OPEN, ratGoneText } from "@/lib/game/farm/messages";
import { isTyping } from "@/lib/game/keys";
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 3.** Replace:

```tsx
import RiceDepotPanel from "./RiceDepotPanel";
import TransplantGame from "./TransplantGame";
```

with:

```tsx
import RiceDepotPanel from "./RiceDepotPanel";
import SlingGame from "./SlingGame";
import TransplantGame from "./TransplantGame";
```

**components/game/farm/FarmOverlays.tsx — edit 3 of 3.** Replace:

```tsx
      )}
      {panel?.kind === "plot" && (
```

with:

```tsx
      )}
      {farm.sling && (
        <SlingGame key={farm.sling.begunAt} sling={farm.sling} pellets={state?.mine.items[AMMO_PELLET] ?? 0}
          message={farm.sling.gone ? ratGoneText(state?.rats?.recent.find((r) => r.id === farm.sling?.rat) ?? null) : farm.sling.message}
          panelOpen={panelOpen || panel !== null} onShot={(hit) => void farm.slingShot(hit)} onReaim={() => void farm.slingReaim()}
          onClose={farm.closeSling} />
      )}
      {panel?.kind === "plot" && (
```

Create `components/game/farm/SlingGame.tsx` with exactly:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import type { FarmSling } from "@/hooks/useFarmController";
import { drawSlingScene } from "@/lib/game/art/sling-art";
import { SLING_CANCEL, SLING_HELP, slingStatus, slingTitle } from "@/lib/game/farm/messages";
import { createSling, SLING, SLING_MISS, slingAnswered, slingSent, stepSling, type SlingMark, type SlingState } from "@/lib/game/farm/sling";
import { isTyping } from "@/lib/game/keys";

/** The scene on a 320 × 180 canvas that CSS scales to the overlay's width; the lines below it say the same in words. */
function Scene({ s }: { s: SlingState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ctx = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (ctx.current === undefined) ctx.current = canvas.getContext("2d");
    const c = ctx.current;
    if (!c) return;
    drawSlingScene(c, s, performance.now(), window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  }, [s]);
  return (
    <canvas ref={ref} width={SLING.width} height={SLING.height} aria-hidden="true"
      className="w-full max-w-[640px] [image-rendering:pixelated]" />
  );
}

/** The game (§6.2): a seeded SlingState stepped every frame. A finished flight goes to `onShot` (sling_shoot), a shot
 *  ready too late to `onReaim` (sling_start); each new answer (`answers`) starts the 2.2 s reload. Holding is Space, a
 *  mouse button or a finger; the aim follows the pointer (a finger drags it while holding) or ←/→. */
function Playing({ sling, pellets, panelOpen, onShot, onReaim, onClose }: {
  sling: FarmSling;
  pellets: number;
  panelOpen: boolean;
  onShot: (hit: boolean) => void;
  onReaim: () => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(() => createSling(sling.seed));
  /** The last shot's mark, for its line until the next shot. */
  const [mark, setMark] = useState<SlingMark | null>(null);
  const input = useRef({ key: false, pointer: false, aimTo: null as number | null, left: false, right: false });
  const cur = useRef(s);
  const answers = useRef(sling.answers);
  const cb = useRef({ onShot, onReaim });
  useEffect(() => {
    cb.current = { onShot, onReaim };
  });

  // a new answer (a miss, a new aim): the reload starts
  useEffect(() => {
    if (sling.answers === answers.current) return;
    answers.current = sling.answers;
    cur.current = slingAnswered(cur.current);
    setS(cur.current);
  }, [sling.answers]);

  useEffect(() => {
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      const i = input.current;
      let next = stepSling(cur.current, Math.max(0, t - last) / 1000, {
        holding: i.key || i.pointer, aimTo: i.aimTo, left: i.left, right: i.right,
      });
      last = t;
      if (next.stage === "send") {
        const m = next.mark;
        next = slingSent(next);
        setMark(m);
        cb.current.onShot(m === "hit");
      } else if (next.stage === "reaim") {
        next = slingSent(next);
        setMark(null);
        cb.current.onReaim();
      }
      cur.current = next;
      setS(next);
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        input.current.key = true;
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        input.current.left = true;
        input.current.aimTo = null;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        input.current.right = true;
        input.current.aimTo = null;
      } else if (e.key === "Escape" && !panelOpen) {
        onClose();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") input.current.key = false;
      else if (e.key === "ArrowLeft") input.current.left = false;
      else if (e.key === "ArrowRight") input.current.right = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [panelOpen, onClose]);

  /** A pointer's x in scene px. */
  const aimAt = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) input.current.aimTo = ((e.clientX - r.left) / r.width) * SLING.width;
  }, []);

  const reloading = s.stage === "reload" || s.stage === "wait";
  const line = mark === null || mark === "hit" ? null : SLING_MISS[mark];
  return (
    <>
      {/* the whole scene takes the pointer: move to aim, hold to draw */}
      <div role="group" aria-label="Ná" className="w-full touch-none select-none"
        onPointerMove={aimAt}
        onPointerDown={(e) => { aimAt(e); input.current.pointer = true; }}
        onPointerUp={() => { input.current.pointer = false; }}
        onPointerCancel={() => { input.current.pointer = false; }}
        onPointerLeave={() => { input.current.pointer = false; }}>
        <Scene s={s} />
      </div>
      <p>{slingStatus(pellets, reloading)}</p>
      <p aria-live="polite" className="min-h-6">{line ?? ""}</p>
      <p className="text-base opacity-80">{SLING_HELP}</p>
      <button type="button" className="pch-btn" onClick={onClose}>{SLING_CANCEL}</button>
    </>
  );
}

/** SlingGame (v17 §12.2): the game at a rat, then the hit or the refusal (`message`, the state's `recent` already read
 *  into it for `rat gone`). Thôi (Esc) sends nothing; an Esc typed into a text field, or one for another open overlay, is
 *  not its own. */
export default function SlingGame({ sling, pellets, message, panelOpen, onShot, onReaim, onClose }: {
  sling: FarmSling;
  pellets: number;
  message: string | null;
  panelOpen: boolean;
  onShot: (hit: boolean) => void;
  onReaim: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    // the game minds its own Esc (Thôi)
    if (panelOpen || sling.phase === "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, sling.phase, onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true"
      aria-label={slingTitle(sling.plot)}>
      <div className="pch flex w-[40rem] max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{slingTitle(sling.plot)}</h2>
        {sling.phase === "playing" && (
          <Playing sling={sling} pellets={pellets} panelOpen={panelOpen} onShot={onShot} onReaim={onReaim} onClose={onClose} />
        )}
        {sling.phase !== "playing" && (
          <>
            <p role="status" className={sling.phase === "refused" ? "text-burgundy" : undefined}>{message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}
```

**hooks/useFarmController.ts — edit 1 of 11.** Replace:

```ts
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, FIELD_LOADING,
  GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NOT_OPEN, NOT_OPEN_153, pestSnailText,
  pickingText, produceSaleText, riceSaleText, WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
```

with:

```ts
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, farmErrorMessage,
  FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NO_PELLETS, NOT_OPEN,
  NOT_OPEN_153, NOT_OPEN_17, pestSnailText, pickingText, produceSaleText, RAT_GONE, ratPrompt, ratSpawnText, riceSaleText,
  slingGear, slingHitText, WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
```

**hooks/useFarmController.ts — edit 2 of 11.** Replace:

```ts

export interface FarmController {
```

with:

```ts

/** A SlingGame session (v17 §6.2): SlingGame plays it at a rat, the controller talks to the server. */
export interface FarmSling {
  rat: number;
  /** The plot the rat eats (the title, and the `fp` after a hit). */
  plot: number;
  /** Seeds the rat's runs (shot i moves on seed + 7 919 · i). */
  seed: number;
  /** When sling_start's answer arrived (client ms): a new session is a new game. */
  begunAt: number;
  /** The sling answers since the start (a miss, a new aim): each one starts the overlay's 2.2 s reload. */
  answers: number;
  /** playing (shots go out) → done (a hit); or refused (a refusal, or the last pellet spent). */
  phase: "playing" | "done" | "refused";
  /** The hit's line or the refusal's. */
  message: string | null;
  /** The refusal was `rat gone`: the overlay names who took it, from the state's `recent` (§12.2). */
  gone: boolean;
}

export interface FarmController {
```

**hooks/useFarmController.ts — edit 3 of 11.** Replace:

```ts
  cancelBed: () => void;
  /** I moved (the canvas): a snail bed's bar stops before anything is sent (§7.3). */
```

with:

```ts
  cancelBed: () => void;
  /** A SlingGame session, open in its overlay (v17 §6.2). */
  sling: FarmSling | null;
  /** The overlay's shot, after its flight: sling_shoot. A miss with pellets left counts an answer; a hit, a refusal or the
   *  last pellet ends the session. */
  slingShot: (hit: boolean) => Promise<void>;
  /** A shot ready 55 s or more after the last answer was dropped: a new sling_start, which counts an answer. */
  slingReaim: () => Promise<void>;
  /** "Thôi", "Đóng" or Esc: the overlay closes and nothing is sent; a sling answer still to come is dropped. */
  closeSling: () => void;
  /** I moved (the canvas): a snail bed's bar stops before anything is sent (§7.3). */
```

**hooks/useFarmController.ts — edit 4 of 11.** Replace:

```ts
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying", "crab_hole", "snail_bed"]);
```

with:

```ts
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying", "crab_hole", "snail_bed", "rat"]);
/** A SlingGame re-sends its `fa 12` this often while it is open (§6.2, §11). */
export const SLING_FA_MS = 2000;
```

**hooks/useFarmController.ts — edit 5 of 11.** Replace:

```ts
const sameCrab = (showing: FarmCrab | null, c: FarmCrab): boolean => showing?.visit.id === c.visit.id;
```

with:

```ts
const sameCrab = (showing: FarmCrab | null, c: FarmCrab): boolean => showing?.visit.id === c.visit.id;
/** The sling session showing is still `s`. */
const sameSling = (showing: FarmSling | null, s: FarmSling): boolean => showing?.rat === s.rat && showing.begunAt === s.begunAt;
```

**hooks/useFarmController.ts — edit 6 of 11.** Replace:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish, pickSnailBed } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

with:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish, pickSnailBed, slingStart, slingShoot } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

**hooks/useFarmController.ts — edit 7 of 11.** Replace:

```ts
  const [bed, setBed] = useState<FarmBed | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round, crab });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen, round, crab };
  });
```

with:

```ts
  const [bed, setBed] = useState<FarmBed | null>(null);
  const [sling, setSling] = useState<FarmSling | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round, crab, sling });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen, round, crab, sling };
  });
```

**hooks/useFarmController.ts — edit 8 of 11.** Replace:

```ts

  // leaving the field drops a begin_work or crab_start answer still on its way from the commit that leaves it, before the
```

with:

```ts

  // --- the field's rats (v17 §5.4, §12.1): on the canvas with every state, and a toast for each rat out on a plot I farm
  //     (once per rat)
  useEffect(() => {
    if (active) canvas()?.setRats(state?.rats ?? null);
  }, [active, state, canvas]);
  const ratsSeen = useRef(new Set<number>());
  useEffect(() => {
    if (!active || !state?.rats) return;
    for (const r of state.rats.live) {
      if (ratsSeen.current.has(r.id)) continue;
      ratsSeen.current.add(r.id);
      if (state.plots.find((p) => p.no === r.plot)?.farmer?.id === accountId) live.current.toast(ratSpawnText(r.plot));
    }
  }, [active, state, accountId]);

  // --- the ná (v17 §6.2): sling_start, SlingGame with fa 12 every 2 s, then a sling_shoot per shot, each after its flight.
  // A hit sends fp {plot}. Thôi or Esc sends nothing; an answer still on its way is dropped.
  const slingAnim = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopSlingAnim = useCallback(() => {
    if (!slingAnim.current) return;
    clearInterval(slingAnim.current);
    slingAnim.current = null;
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);
  useEffect(() => () => {
    if (slingAnim.current) clearInterval(slingAnim.current);
  }, []);
  const startSling = useCallback(async (ratId: number): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round) || live.current.crab || live.current.sling) return false;
    const plot = live.current.state?.rats?.live.find((r) => r.id === ratId)?.plot;
    if (plot === undefined) return false;
    const closed = closes.current;
    setBusy(true);
    const begun = await slingStart(ratId);
    setBusy(false);
    // the field left meanwhile, or the canvas shows another map by now: the aim is dropped (it expires on the server)
    const c = canvas();
    if (!begun || closes.current !== closed || c?.mapId() !== "field") return false;
    c?.farmAnim(FARM_ANIM.aim);
    if (slingAnim.current) clearInterval(slingAnim.current);
    slingAnim.current = setInterval(() => canvas()?.farmAnim(FARM_ANIM.aim), SLING_FA_MS);
    setPanel(null);
    setSling({
      rat: ratId, plot, seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), answers: 0, phase: "playing",
      message: null, gone: false,
    });
    return true;
  }, [slingStart, canvas]);
  /** A refusal ends the session with its text; a strike (no text) closes it for its modal. */
  const slingRefused = useCallback((s: FarmSling, text: string | null) => {
    stopSlingAnim();
    setSling(text === null ? null : { ...s, phase: "refused", message: text, gone: text === RAT_GONE });
  }, [stopSlingAnim]);
  const slingShot = useCallback(async (hit: boolean) => {
    const s = live.current.sling;
    if (!s || s.phase !== "playing") return;
    let refusal: string | null = null;
    const r = await slingShoot(s.rat, hit, (text) => { refusal = text; });
    // a catch changed the plot for everyone, even when the overlay was closed meanwhile
    if (r?.shot.hit) canvas()?.plotChanged(s.plot);
    if (!sameSling(live.current.sling, s)) return;
    if (!r) return slingRefused(s, refusal);
    if (r.shot.hit) {
      stopSlingAnim();
      setSling({ ...s, phase: "done", message: slingHitText(r.shot.price ?? 0) });
    } else if (r.shot.pellets < 1) {
      slingRefused(s, NO_PELLETS);
    } else {
      setSling({ ...s, answers: s.answers + 1 });
    }
  }, [slingShoot, canvas, stopSlingAnim, slingRefused]);
  const slingReaim = useCallback(async () => {
    const s = live.current.sling;
    if (!s || s.phase !== "playing") return;
    let refusal: string | null = null;
    const r = await slingStart(s.rat, (text) => { refusal = text; });
    if (!sameSling(live.current.sling, s)) return;
    if (!r) return slingRefused(s, refusal);
    setSling({ ...s, answers: s.answers + 1 });
  }, [slingStart, slingRefused]);
  const closeSling = useCallback(() => {
    closes.current += 1;
    stopSlingAnim();
    setSling(null);
  }, [stopSlingAnim]);

  // leaving the field drops a begin_work or crab_start answer still on its way from the commit that leaves it, before the
```

**hooks/useFarmController.ts — edit 9 of 11.** Replace:

```ts
      shutCrab(false);
    }, 0);
    return () => clearTimeout(t);
  }, [active, cancelWork, cancelBed, closeRound, shutCrab]);
```

with:

```ts
      shutCrab(false);
      closeSling();
    }, 0);
    return () => clearTimeout(t);
  }, [active, cancelWork, cancelBed, closeRound, shutCrab, closeSling]);
```

**hooks/useFarmController.ts — edit 10 of 11.** Replace:

```ts
      }
    }
    return true;
  }, [startCrab, startBed]);
  const promptText = useCallback((it: Interactable): string | null => {
    if (!FIELD_KINDS.has(it.kind)) return null;
    if (it.kind === "crab_hole" || it.kind === "snail_bed") return gatherPrompt(it, state?.mine ?? null, catalog, now);
```

with:

```ts
      }
      case "rat": {
        // without the ná or a pellet, E says so (§12.1); before 0019 there are no rats to meet
        const s = live.current.state;
        if (!s) live.current.toast(FIELD_LOADING);
        else if (!s.rats) live.current.toast(NOT_OPEN_17);
        else {
          const gear = slingGear(s.mine.items);
          if (gear) live.current.toast(farmErrorMessage({ message: gear }, undefined, "sling"));
          else if (it.rat !== undefined) void startSling(it.rat);
        }
        break;
      }
    }
    return true;
  }, [startCrab, startBed, startSling]);
  const promptText = useCallback((it: Interactable): string | null => {
    if (!FIELD_KINDS.has(it.kind)) return null;
    if (it.kind === "rat") return ratPrompt(slingGear(state?.mine.items ?? {}));
    if (it.kind === "crab_hole" || it.kind === "snail_bed") return gatherPrompt(it, state?.mine ?? null, catalog, now);
```

**hooks/useFarmController.ts — edit 11 of 11.** Replace:

```ts
    cancelBed,
    moved: cancelBed,
```

with:

```ts
    cancelBed,
    sling,
    slingShot,
    slingReaim,
    closeSling,
    moved: cancelBed,
```

Create `lib/game/art/sling-art.ts` with exactly:

```ts
import { SLING, type SlingState } from "../farm/sling";
import { drawRat, ratFrame } from "./rats";

// The SlingGame scene (v17 §12.2), original and drawn in code: a golden paddy lane, the rat at ×2, a crosshair, the ná at
// the bottom with its band pulled back by the draw, and a vertical power bar with its green band.

const PAL = {
  sky: "#f3e6c4",
  paddy: "#d8b24a",
  paddyDark: "#b8902e",
  bund: "#8a6a3f",
  cross: "#c0392b",
  fork: "#8b5a33",
  forkDark: "#6e4424",
  band: "#2e2a2a",
  pouch: "#b0643a",
  pellet: "#a0522d",
  barBack: "#3a2a1c",
  barGreen: "#4caf50",
  barFill: "#f4efe0",
} as const;

const RAT_SCALE = 2;
/** The ná's fork, bottom centre; the band's rest line is at forkY. */
const FORK_X = SLING.width / 2;
const FORK_Y = 150;
const BAR = { x: 300, y: 96, w: 8, h: 76 } as const;

/** One frame of the scene. `reduced`: no shake, and the pellet flies without a trail. */
export function drawSlingScene(c: CanvasRenderingContext2D, s: SlingState, t: number, reduced: boolean): void {
  c.imageSmoothingEnabled = false;
  c.fillStyle = PAL.sky;
  c.fillRect(0, 0, SLING.width, SLING.height);
  // the paddy lane, with rows of stalks
  c.fillStyle = PAL.paddy;
  c.fillRect(0, SLING.laneY - 22, SLING.width, 44);
  c.fillStyle = PAL.paddyDark;
  for (let x = 4; x < SLING.width; x += 8) {
    c.fillRect(x, SLING.laneY - 20 + ((x / 8) % 2) * 3, 1, 6);
    c.fillRect(x + 3, SLING.laneY + 10 - ((x / 8) % 2) * 3, 1, 6);
  }
  c.fillStyle = PAL.bund;
  c.fillRect(0, SLING.laneY + 22, SLING.width, 4);
  // the rat, on the lane at ×2 (its feet's middle a little below the lane line)
  drawRat(c, ratFrame(s.rat.moving, t), s.rat.dir, s.rat.x, SLING.laneY + 4, RAT_SCALE);
  // the crosshair
  const shake = !reduced && s.stage === "draw" && s.power > SLING.bandHigh ? (Math.floor(t / 60) % 2 ? 1 : -1) : 0;
  const ax = Math.round(s.aimX) + shake;
  c.fillStyle = PAL.cross;
  c.fillRect(ax - 6, SLING.laneY, 4, 1);
  c.fillRect(ax + 3, SLING.laneY, 4, 1);
  c.fillRect(ax, SLING.laneY - 6, 1, 4);
  c.fillRect(ax, SLING.laneY + 3, 1, 4);
  // the pellet in flight, from the fork toward the aim at release
  if (s.stage === "flight" && s.shotX !== null) {
    const k = Math.min(1, s.stageMs / SLING.flightMs);
    const px = FORK_X + (s.shotX - FORK_X) * k, py = FORK_Y - 10 + (SLING.laneY - (FORK_Y - 10)) * k;
    if (!reduced) {
      c.fillStyle = PAL.paddyDark;
      c.fillRect(Math.round(FORK_X + (s.shotX - FORK_X) * (k * 0.8)), Math.round(FORK_Y - 10 + (SLING.laneY - FORK_Y + 10) * k * 0.8), 2, 2);
    }
    c.fillStyle = PAL.pellet;
    c.fillRect(Math.round(px) - 1, Math.round(py) - 1, 3, 3);
  }
  // the ná: a Y fork, its band pulled back by the draw
  c.fillStyle = PAL.forkDark;
  c.fillRect(FORK_X - 1, FORK_Y, 3, 26);
  c.fillStyle = PAL.fork;
  c.fillRect(FORK_X - 9, FORK_Y - 12, 3, 14);
  c.fillRect(FORK_X + 7, FORK_Y - 12, 3, 14);
  c.fillRect(FORK_X - 7, FORK_Y, 15, 3);
  const pull = s.stage === "draw" ? Math.round(s.power * 18) : 0;
  c.fillStyle = PAL.band;
  for (let i = 0; i <= 8; i++) {
    const y = FORK_Y - 11 + Math.round((pull * i) / 8);
    c.fillRect(FORK_X - 8 + i, y, 1, 1);
    c.fillRect(FORK_X + 8 - i, y, 1, 1);
  }
  c.fillStyle = PAL.pouch;
  c.fillRect(FORK_X - 2, FORK_Y - 12 + pull, 5, 3);
  if (s.stage === "ready" || s.stage === "draw") {
    c.fillStyle = PAL.pellet;
    c.fillRect(FORK_X - 1, FORK_Y - 13 + pull, 3, 3);
  }
  // the power bar, filling upward, with the green band
  c.fillStyle = PAL.barBack;
  c.fillRect(BAR.x, BAR.y, BAR.w, BAR.h);
  c.fillStyle = PAL.barGreen;
  const g0 = BAR.y + BAR.h - Math.round(BAR.h * SLING.bandHigh), g1 = BAR.y + BAR.h - Math.round(BAR.h * SLING.bandLow);
  c.fillRect(BAR.x, g0, BAR.w, g1 - g0);
  const fill = Math.round(BAR.h * (s.stage === "draw" || s.stage === "flight" ? s.power : 0));
  c.fillStyle = PAL.barFill;
  c.fillRect(BAR.x + 2, BAR.y + BAR.h - fill, BAR.w - 4, fill);
}
```

**lib/game/farm/messages.ts — edit 1 of 2.** Replace:

```ts
}
/** Why the rat is gone (§12.2), from its `recent` entry when there is one: a sling, a dog, or back to its hole. */
```

with:

```ts
}
/** `rat gone` (§10.6): the SlingGame then names who took it, from the state's `recent` (ratGoneText). */
export const RAT_GONE = "Con chuột này không còn nữa.";
/** Why the rat is gone (§12.2), from its `recent` entry when there is one: a sling, a dog, or back to its hole. */
```

**lib/game/farm/messages.ts — edit 2 of 2.** Replace:

```ts
    case "no pellets": return NO_PELLETS;
    case "rat gone": return "Con chuột này không còn nữa.";
    case "rat limit": return ratLimitText(detailSec(err));
```

with:

```ts
    case "no pellets": return NO_PELLETS;
    case "rat gone": return RAT_GONE;
    case "rat limit": return ratLimitText(detailSec(err));
```

**lib/game/overlays.ts — edit 1 of 2.** Replace:

```ts
  farmCrab: boolean;
  /** A card table's panel (v16). */
```

with:

```ts
  farmCrab: boolean;
  /** A SlingGame is open (v17 §12.2): the avatar stays by the rat. */
  slingGame: boolean;
  /** A card table's panel (v16). */
```

**lib/game/overlays.ts — edit 2 of 2.** Replace:

```ts
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal || o.cardPanel || o.rulesBook;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound || o.farmCrab, panelOpen };
}
```

with:

```ts
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal || o.cardPanel || o.rulesBook;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound || o.farmCrab || o.slingGame, panelOpen };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (5 files, 96 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/SlingGame.tsx hooks/useFarmController.ts lib/game/art/sling-art.ts lib/game/farm/messages.ts lib/game/overlays.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/farm-sling-game.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): SlingGame, and E at a rat aims the ná

E at a rat (the engine's synthetic interactable) says what gear is missing, or calls
sling_start and opens SlingGame; an answer that lands after the game was closed or the
field left is dropped, as crab_start's is. The rat's prompt names the gear. The game
steps sling.ts's state machine every frame on a 320 x 180 scene drawn in code
(art/sling-art.ts): Space, a held pointer or finger draw the band, the pointer or
arrow keys aim. A finished flight is sent as sling_shoot; a miss with pellets left
starts the 2.2 s reload, a hit shows its price and sends fp for the plot, and the
last pellet or a refusal ends the game. `rat gone` names who took the rat from the
state's recent entries. A shot ready 55 s after the last answer is dropped for a new
sling_start. Thôi or Esc sends nothing. The controller sends fa 12 every 2 s while
the game is open, puts the field's rats on the canvas, and toasts a rat on a plot I
farm once. overlayLocks gains slingGame, which blocks the canvas only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/SlingGame.tsx hooks/useFarmController.ts lib/game/art/sling-art.ts lib/game/farm/messages.ts lib/game/overlays.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/farm-sling-game.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 16: The dog in game mode: auto-hunt, DogPanel, adoption at chú Tám's

**Files:**
- Create: `components/game/farm/DogPanel.tsx`, `components/game/farm/DogSprite.tsx`, `hooks/useDog.ts`
- Modify: `components/game/GameShell.tsx`, `components/game/farm/CoopPanel.tsx`, `components/game/farm/FarmOverlays.tsx`, `hooks/useFarmController.ts`, `lib/game/farm/messages.ts`, `lib/game/overlays.ts`
- Test: `tests/unit/farm-dog-ui.test.tsx` (create); `tests/unit/game-overlays.test.ts`, `tests/unit/use-farm-controller.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 6 (`DOG`, `dogStatus`, `feedRefusal`, `dogNameRefusal`, `COAT_NAME`, `DOG_COATS`), Task 7 (`dogState`, `adoptDog`, `renameDog`, `feedDog`, `FOOD_DOG`, `FarmMine.dog`, `.ratCaps`), Task 9 (`dogCatchText`), Task 10 (`nearestRat`), Task 11 (`dogMatrix`), Task 12 (`useRoom`'s `setPresenceDog`, `PresenceDog`), Task 13 (`dogPounce`, `dogRecall`, `petDog`, `localPos`, `lastInputAt`, `setLocal`'s dog), Task 14 (`dogHunt`); `CoopPanel`'s tabs and `ConfirmButton`; `ParchmentModal`.
- Produces:
  - `messages.ts` (§12.3): `dogHudText`, `dogCoatLine`, `dogFoodLine`, `dogHuntLine`, `dogCatchesLine`, `dogFeedButton`, `DOG_FEED_REFUSAL`, `DOG_NAME_HINT`, `DOG_NAME_PROBLEM`, `dogFedText`, `dogRenamedText`, `ADOPT_INTRO`, `ADOPT_BUTTON`, `adoptConfirmText`, `dogOwnedText`, `dogWelcomeText`;
  - `hooks/useDog.ts`: `useDog({token, field, petDog, setPresenceDog, toast, onCoinsChanged}) → DogController {dog, food, hungry, busy, adopt, rename, feed, pet}` (`dog_state` once, then the newer of its answers and the field's `mine.dog`; one pet per 3 s);
  - `useFarmController`: `DOG_HUNT_EVERY_MS` (1 s) and the auto-hunt of §7.2 (`dogPounce` at the call, `fp {plot}` and a toast on a catch, `dogRecall` only while the field is shown and a 10 s pause on a refusal);
  - `components/game/farm/DogPanel.tsx`, `DogSprite.tsx`; `CoopPanel`'s `CoopDog` and the "🐕 Chó cỏ" tab before "Của tôi"; `FarmOverlays`' `dog` prop; `GameShell`: the HUD's "🐕 {name}" button, DogPanel, the dog on the canvas and in presence;
  - `overlays.ts`: `OpenOverlays.dogPanel` (both locks).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-dog-ui.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { DogView } from "@/lib/game/dog";
import { parseFieldState } from "@/lib/game/farm/state";

const rpc = vi.hoisted(() => ({ dogState: vi.fn(), adoptDog: vi.fn(), renameDog: vi.fn(), feedDog: vi.fn() }));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import CoopPanel from "@/components/game/farm/CoopPanel";
import DogPanel from "@/components/game/farm/DogPanel";
import { useDog } from "@/hooks/useDog";

const NOW = Date.parse("2026-09-26T03:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const MUC: DogView = { name: "Mực", coat: "muc", adoptedAt: Date.parse("2026-09-26T01:00:00Z"), fedUntil: NOW + 18 * 3_600_000, nextHuntAt: null, catches: 12 };
const answer = (dog: DogView | null, food = 3, at = NOW) => ({ serverNow: at, dog, food, coins: 500 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const f of Object.values(rpc)) f.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useDog (v17 §7.3)", () => {
  function setup(field: Parameters<typeof useDog>[0]["field"] = null) {
    const opts = { token: "tok", field, petDog: vi.fn(), setPresenceDog: vi.fn(), toast: vi.fn(), onCoinsChanged: vi.fn() };
    const view = renderHook((o) => useDog(o), { initialProps: opts });
    return { ...opts, ...view };
  }

  it("learns the dog on entering game mode and publishes it to presence", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(MUC));
    const { result, setPresenceDog } = setup();
    await flush();
    expect(rpc.dogState).toHaveBeenCalledWith("tok");
    expect(result.current).toMatchObject({ dog: MUC, food: 3, hungry: false });
    expect(setPresenceDog).toHaveBeenLastCalledWith({ name: "Mực", coat: "muc" });
  });

  it("has no dog before 0019, and publishes none", async () => {
    rpc.dogState.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.dog_state" });
    const { result, setPresenceDog } = setup();
    await flush();
    expect(result.current.dog).toBeNull();
    expect(setPresenceDog).toHaveBeenLastCalledWith(null);
  });

  it("takes the field's dog when its answer is newer", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(MUC, 3, NOW - 1000));
    const field = parseFieldState({
      server_now: iso(0), plots: [], drying: [],
      mine: { items: { food_dog: 7 }, rice: {}, coins: 1, gift_claimed: true, dog: { name: "Ki", coat: "dom", adopted_at: iso(-5), fed_until: iso(-1), next_hunt_at: null, catches: 0 } },
    });
    const { result } = setup(field);
    await flush();
    expect(result.current).toMatchObject({ dog: { name: "Ki", coat: "dom" }, food: 7, hungry: true });
  });

  it("adopts, renames and feeds with their toasts; a refusal says why", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(null));
    const { result, toast, onCoinsChanged } = setup();
    await flush();
    rpc.adoptDog.mockResolvedValueOnce(answer(MUC));
    await act(async () => { expect(await result.current.adopt("Mực", "muc")).toBe(true); });
    expect(rpc.adoptDog).toHaveBeenCalledWith("tok", "Mực", "muc");
    expect(toast).toHaveBeenLastCalledWith("🐕 Chào mừng Mực về nhà! Nó sẽ theo bạn khắp nơi.");
    expect(onCoinsChanged).toHaveBeenCalled();
    rpc.renameDog.mockResolvedValueOnce(answer({ ...MUC, name: "Ki" }));
    await act(async () => { await result.current.rename("Ki"); });
    expect(toast).toHaveBeenLastCalledWith("\u270f\ufe0f Đã đổi tên thành Ki.");
    rpc.feedDog.mockRejectedValueOnce({ message: "dog full" });
    await act(async () => { expect(await result.current.feed()).toBe(false); });
    expect(toast).toHaveBeenLastCalledWith("Chó còn no — chưa ăn thêm được.");
    rpc.feedDog.mockResolvedValueOnce(answer({ ...MUC, name: "Ki" }, 2));
    await act(async () => { await result.current.feed(); });
    expect(toast).toHaveBeenLastCalledWith("🦴 Ki ăn ngon lành — no 24 giờ.");
  });

  it("pets at most once every 3 s", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(MUC));
    const { result, petDog } = setup();
    await flush();
    expect(result.current.pet()).toBe(true);
    expect(result.current.pet()).toBe(false);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.pet()).toBe(true);
    expect(petDog).toHaveBeenCalledTimes(2);
  });
});

describe("DogPanel (v17 §12.3)", () => {
  const show = (dog: DogView, food = 3) => {
    const p = { onFeed: vi.fn(), onRename: vi.fn().mockResolvedValue(true), onPet: vi.fn(), onClose: vi.fn() };
    render(<DogPanel dog={dog} food={food} busy={false} {...p} />);
    return p;
  };

  it("shows the coat, the day, food, hunting and catches", () => {
    show(MUC);
    expect(screen.getByText("Chó cỏ lông mực · nuôi từ 26/9")).toBeInTheDocument();
    expect(screen.getByText("🍖 No — còn 18 giờ")).toBeInTheDocument();
    expect(screen.getByText("🐀 Sẵn sàng — ra đồng, đứng gần chuột là nó vồ")).toBeInTheDocument();
    expect(screen.getByText("🏅 Đã bắt 12 con chuột")).toBeInTheDocument();
  });

  it("counts a rest down, and shows a hungry dog", () => {
    cleanup();
    show({ ...MUC, nextHuntAt: NOW + 192_000 });
    expect(screen.getByText("🐀 Nghỉ — vồ tiếp sau 3:12")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("🐀 Nghỉ — vồ tiếp sau 3:10")).toBeInTheDocument();
    cleanup();
    show({ ...MUC, fedUntil: NOW - 1 });
    expect(screen.getByText("🍖 Đói — cho ăn để nó đi săn")).toBeInTheDocument();
    expect(screen.getByText("🐀 Đói nên không săn")).toBeInTheDocument();
  });

  it("feeds, or says why not", () => {
    const p = show({ ...MUC, fedUntil: NOW + 6 * 3_600_000 });
    fireEvent.click(screen.getByRole("button", { name: "🦴 Cho ăn (3 bịch)" }));
    expect(p.onFeed).toHaveBeenCalled();
    cleanup();
    show(MUC);
    expect(screen.getByRole("button", { name: "🦴 Cho ăn (3 bịch)" })).toBeDisabled();
    expect(screen.getByText("Còn no hơn 12 giờ — chưa ăn thêm được.")).toBeInTheDocument();
    cleanup();
    show({ ...MUC, fedUntil: NOW }, 0);
    expect(screen.getByText("Hết thức ăn chó — mua ở tiệm anh Hai.")).toBeInTheDocument();
  });

  it("renames with hints, and pets", async () => {
    const p = show(MUC);
    fireEvent.click(screen.getByRole("button", { name: "🤚 Vuốt ve" }));
    expect(p.onPet).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "\u270f\ufe0f Đổi tên" }));
    const input = screen.getByRole("textbox");
    expect(screen.getByText("2–16 ký tự")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "K" } });
    expect(screen.getByText("Tên cần 2–16 ký tự.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "Ao cá" } });
    expect(screen.getByText("Tên này dành riêng — chọn tên khác nhé.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Ki" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lưu" })); });
    expect(p.onRename).toHaveBeenCalledWith("Ki");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("CoopPanel, 🐕 Chó cỏ (v17 §12.3)", () => {
  const STATE = parseFieldState({
    server_now: iso(0), plots: [], drying: [],
    mine: { items: {}, rice: {}, coins: 25_000, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
  });
  const show = (dog: DogView | null, onAdopt = vi.fn().mockResolvedValue(true), onOpenDog = vi.fn()) => {
    render(<CoopPanel state={STATE} failed={false} me="me" busy={false} now={NOW} onAct={vi.fn()} onReload={vi.fn()} onClose={vi.fn()}
      dog={{ dog, busy: false, onAdopt, onOpenDog }} />);
    fireEvent.click(screen.getByRole("tab", { name: "🐕 Chó cỏ" }));
    return { onAdopt, onOpenDog };
  };

  it("sits before Của tôi, and is not there without its part", () => {
    show(null);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Đất làng", "Đất tư", "Chợ đất", "Máy gặt", "🐕 Chó cỏ", "Của tôi"]);
    cleanup();
    render(<CoopPanel state={STATE} failed={false} me="me" busy={false} now={NOW} onAct={vi.fn()} onReload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "🐕 Chó cỏ" })).toBeNull();
  });

  it("picks a coat, names the dog after it, and adopts after asking", () => {
    const { onAdopt } = show(null);
    expect(screen.getByText(/Chó cỏ nhà chú mới đẻ một bầy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vàng" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mực" }));
    expect(screen.getByRole("button", { name: "Mực" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox")).toHaveValue("Mực");
    fireEvent.click(screen.getByRole("button", { name: "Nhận nuôi · 20.000 xu" }));
    expect(screen.getByText(/Nhận nuôi Mực \(lông mực\) với giá 20\.000 xu\? Mỗi người chỉ nuôi một con\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAdopt).toHaveBeenCalledWith("Mực", "muc");
  });

  it("says a dog is owned, and opens its panel", () => {
    const { onOpenDog } = show(MUC);
    expect(screen.getByText("Bạn đã nuôi Mực rồi — mỗi người một con thôi.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở bảng chó" }));
    expect(onOpenDog).toHaveBeenCalled();
  });
});
```

**tests/unit/game-overlays.test.ts — edit 1 of 2.** Replace:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  farmCrab: false, slingGame: false, cardPanel: false, rulesBook: false,
};
```

with:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  farmCrab: false, slingGame: false, cardPanel: false, rulesBook: false, dogPanel: false,
};
```

**tests/unit/game-overlays.test.ts — edit 2 of 2.** Replace:

```ts
  it("takes both for a shell panel, a fishing panel, the character editor, a card table or the rules book", () => {
    for (const open of ["panel", "fishingPanel", "creating", "cardPanel", "rulesBook"] as const) {
      expect(overlayLocks({ ...none, [open]: true })).toEqual({ blocking: true, panelOpen: true });
```

with:

```ts
  it("takes both for a shell panel, a fishing panel, the character editor, a card table or the rules book", () => {
    for (const open of ["panel", "fishingPanel", "creating", "cardPanel", "rulesBook", "dogPanel"] as const) {
      expect(overlayLocks({ ...none, [open]: true })).toEqual({ blocking: true, panelOpen: true });
```

**tests/unit/use-farm-controller.test.tsx — edit 1 of 3.** Replace:

```tsx
import { CRAB_GAVE_UP, GATHER_LIMIT_TEXT, GIFT_TEXT, NOT_OPEN, NOT_OPEN_153 } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

with:

```tsx
import { CRAB_GAVE_UP, GATHER_LIMIT_TEXT, GIFT_TEXT, NOT_OPEN, NOT_OPEN_153 } from "@/lib/game/farm/messages";
import { ratAt } from "@/lib/game/farm/rats";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 3.** Replace:

```tsx
import {
  CLAIM_SLOW_MS, HARVESTER_REFETCH_MS, ROUND_FA_MS, ROUND_LIMIT_MS, SLING_FA_MS, useFarmController, WORK_MS,
} from "@/hooks/useFarmController";
```

with:

```tsx
import {
  CLAIM_SLOW_MS, DOG_HUNT_EVERY_MS, HARVESTER_REFETCH_MS, ROUND_FA_MS, ROUND_LIMIT_MS, SLING_FA_MS, useFarmController, WORK_MS,
} from "@/hooks/useFarmController";
```

**tests/unit/use-farm-controller.test.tsx — edit 3 of 3.** Append at the end of the file, after a blank line:

```tsx
describe("useFarmController, v17 the dog's auto-hunt", () => {
  const RAT = { id: 9, plot: 6, since: iso(-0.1), seed: 5 };
  const DOG = (over: Record<string, unknown> = {}) => ({
    name: "Mực", coat: "muc", adopted_at: iso(-48), fed_until: iso(10), next_hunt_at: null, catches: 2, ...over,
  });
  const huntField = (over: { dog?: Record<string, unknown> | null; caps?: Record<string, unknown>; live?: unknown[] } = {}): FieldState =>
    parseFieldState({
      server_now: iso(0),
      plots: [
        { no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: LAN, lease: null, offers: 0, crop: null },
      ],
      drying: [],
      mine: {
        items: {}, rice: {}, coins: 1000, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [],
        dog: over.dog === undefined ? DOG() : over.dog, rat_caps: over.caps ?? { hour_left: 6, hour_resets_at: null, day_left: 24 },
      },
      rats: { next_at: iso(1), price: 150, live: over.live ?? [RAT], recent: [], plots: {} },
    })!;
  /** The canvas with my feet on the rat (or `far` px from it), my last input `idleMs` ago. */
  function hunter(opts: { far?: number; idleMs?: number } = {}) {
    const canvas = handle() as ReturnType<typeof handle> & Record<"localPos" | "lastInputAt" | "dogPounce" | "dogRecall", ReturnType<typeof vi.fn>>;
    Object.assign(canvas, {
      localPos: vi.fn(() => {
        const p = ratAt({ ...RAT, since: Date.parse(RAT.since) }, Date.now());
        return p ? { x: p.x + (opts.far ?? 0), y: p.y } : null;
      }),
      lastInputAt: vi.fn(() => Date.now() - (opts.idleMs ?? 0)),
      dogPounce: vi.fn(() => true), dogRecall: vi.fn(),
    });
    const toast = vi.fn();
    const view = renderHook(() => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId: "field", canvas: () => canvas, toast, onCoinsChanged: () => {},
    }));
    return { canvas, toast, ...view };
  }
  const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(DOG_HUNT_EVERY_MS); });

  it("pounces at a rat within 96 px: the dog runs at the call, then fp for the plot and a toast", async () => {
    rpc.fetchFieldState.mockResolvedValue(huntField());
    rpc.dogHunt.mockResolvedValueOnce({ state: huntField({ live: [], dog: DOG({ next_hunt_at: iso(0.1) }) }), price: 169 });
    const { canvas, toast } = hunter();
    await flush();
    await tick();
    expect(canvas.dogPounce).toHaveBeenCalledWith(9);
    expect(rpc.dogHunt).toHaveBeenCalledWith("r", "tok", 9);
    expect(canvas.plotChanged).toHaveBeenCalledWith(6);
    expect(toast).toHaveBeenCalledWith("🐕 Mực vồ được một con chuột! Đem bán cho cô Út nhé.");
    // resting now: no second call
    await tick();
    expect(rpc.dogHunt).toHaveBeenCalledTimes(1);
  });

  it("calls the dog back on a refusal, says nothing, and waits 10 s", async () => {
    rpc.fetchFieldState.mockResolvedValue(huntField());
    rpc.dogHunt.mockRejectedValue({ message: "rat gone" });
    const { canvas, toast } = hunter();
    await flush();
    await tick();
    expect(canvas.dogRecall).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(rpc.dogHunt).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(rpc.dogHunt).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["no dog", { dog: null }, {}],
    ["a hungry dog", { dog: DOG({ fed_until: iso(-1) }) }, {}],
    ["a resting dog", { dog: DOG({ next_hunt_at: iso(0.05) }) }, {}],
    ["no room in this hour's cap", { caps: { hour_left: 0, hour_resets_at: iso(0.5), day_left: 20 } }, {}],
    ["no room in the day's cap", { caps: { hour_left: 6, hour_resets_at: null, day_left: 0 } }, {}],
    ["a rat farther than 96 px", {}, { far: 100 }],
    ["no input for 3 minutes", {}, { idleMs: 3 * 60_000 + 1000 }],
  ] as const)("waits with %s", async (_why, field, opts) => {
    rpc.fetchFieldState.mockResolvedValue(huntField(field as Parameters<typeof huntField>[0]));
    hunter(opts);
    await flush();
    await tick();
    await tick();
    expect(rpc.dogHunt).not.toHaveBeenCalled();
  });

  it("hunts again once this hour's window has passed", async () => {
    rpc.fetchFieldState.mockResolvedValue(huntField({ caps: { hour_left: 0, hour_resets_at: iso(-0.01), day_left: 20 } }));
    rpc.dogHunt.mockResolvedValueOnce({ state: huntField({ live: [] }), price: 169 });
    hunter();
    await flush();
    await tick();
    expect(rpc.dogHunt).toHaveBeenCalledTimes(1);
  });

  it("waits while the SlingGame is open", async () => {
    const f = huntField();
    const withSling = { ...f, mine: { ...f.mine, items: { tool_sling: 1, ammo_pellet: 3 } } };
    rpc.fetchFieldState.mockResolvedValue(withSling);
    const { result } = hunter();
    await flush();
    rpc.slingStart.mockResolvedValueOnce({ state: withSling, aim: { rat: 9, startedAt: NOW } });
    await act(async () => {
      result.current.interact({ id: "rat_9", kind: "rat", rat: 9 } as unknown as Interactable);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.sling).not.toBeNull();
    await tick();
    expect(rpc.dogHunt).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-dog-ui.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — `farm-dog-ui.test.tsx` cannot load `useDog`, and 4 tests fail (no `dogPanel` lock, no auto-hunt); 3 files fail, 66 tests pass.

- [ ] **Step 3: Implement**

**components/game/GameShell.tsx — edit 1 of 11.** Replace:

```tsx
import { useChat } from "@/hooks/useChat";
import { useFarmController } from "@/hooks/useFarmController";
```

with:

```tsx
import { useChat } from "@/hooks/useChat";
import { useDog } from "@/hooks/useDog";
import { useFarmController } from "@/hooks/useFarmController";
```

**components/game/GameShell.tsx — edit 2 of 11.** Replace:

```tsx
import { critterCount } from "@/lib/game/farm/gather";
import { produceSummary } from "@/lib/game/farm/messages";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
```

with:

```tsx
import { critterCount } from "@/lib/game/farm/gather";
import { dogHudText, produceSummary } from "@/lib/game/farm/messages";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
```

**components/game/GameShell.tsx — edit 3 of 11.** Replace:

```tsx
import CharacterEditor from "./CharacterEditor";
import FarmOverlays from "./farm/FarmOverlays";
```

with:

```tsx
import CharacterEditor from "./CharacterEditor";
import DogPanel from "./farm/DogPanel";
import FarmOverlays from "./farm/FarmOverlays";
```

**components/game/GameShell.tsx — edit 4 of 11.** Replace:

```tsx

type Panel = "queue" | "board" | "settings" | "members" | "chat" | "wardrobe" | null;
```

with:

```tsx

type Panel = "queue" | "board" | "settings" | "members" | "chat" | "wardrobe" | "dog" | null;
```

**components/game/GameShell.tsx — edit 5 of 11.** Replace:

```tsx
export default function GameShell({ view, derived, playback, sponsorBlock, onExitGame }: GameShellProps) {
  const { state, role, presence, onlineIds, token, accountId, username, myMemberId, setPresenceMap } = view;
  const room = state.room!;
```

with:

```tsx
export default function GameShell({ view, derived, playback, sponsorBlock, onExitGame }: GameShellProps) {
  const { state, role, presence, onlineIds, token, accountId, username, myMemberId, setPresenceMap, setPresenceDog } = view;
  const room = state.room!;
```

**components/game/GameShell.tsx — edit 6 of 11.** Replace:

```tsx
  const creating = savedLook !== null && !exists;
  useEffect(() => {
    canvasRef.current?.setLocal({ name: myName, badges: myBadges, look: myLook });
  }, [myName, myBadges, myLook]);
```

with:

```tsx
  const creating = savedLook !== null && !exists;
```

**components/game/GameShell.tsx — edit 7 of 11.** Replace:

```tsx

  // --- the card corner: the hall's labels, the table panels, the rules book, and the table I sit at (v16)
```

with:

```tsx

  // --- my dog (v17 §7.3, §12.3): learned on entering game mode, on the canvas behind me and in presence
  const petDog = useCallback(() => canvasRef.current?.petDog(), []);
  const dog = useDog({
    token, field: farm.data.state, petDog, setPresenceDog, toast: showToast, onCoinsChanged: () => void fishing.data.reload(),
  });
  const dogName = dog.dog?.name ?? null, dogCoat = dog.dog?.coat ?? null, dogHungry = dog.hungry;
  useEffect(() => {
    canvasRef.current?.setLocal({
      name: myName, badges: myBadges, look: myLook, dog: dogName !== null && dogCoat !== null ? { name: dogName, coat: dogCoat } : null, dogHungry,
    });
  }, [myName, myBadges, myLook, dogName, dogCoat, dogHungry]);
  const { closePanel: closeFarmPanel } = farm;
  const coopDog = { dog: dog.dog, busy: dog.busy, onAdopt: dog.adopt, onOpenDog: () => { closeFarmPanel(); setPanel("dog"); } };

  // --- the card corner: the hall's labels, the table panels, the rules book, and the table I sit at (v16)
```

**components/game/GameShell.tsx — edit 8 of 11.** Replace:

```tsx
    slingGame: farm.sling !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null,
  });
```

with:

```tsx
    slingGame: farm.sling !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null, dogPanel: panel === "dog",
  });
```

**components/game/GameShell.tsx — edit 9 of 11.** Replace:

```tsx
              <button type="button" className="pch-btn" onClick={() => fishing.openPanel("bag")}>🎒 Giỏ đồ</button>
              {map.id === "field" && <FarmTasksButton urgent={farm.urgent} onClick={() => farm.openPanel({ kind: "tasks" })} />}
```

with:

```tsx
              <button type="button" className="pch-btn" onClick={() => fishing.openPanel("bag")}>🎒 Giỏ đồ</button>
              {dog.dog && (
                <button type="button" className="pch-btn" onClick={() => setPanel("dog")}>{dogHudText(dog.dog.name, dog.hungry)}</button>
              )}
              {map.id === "field" && <FarmTasksButton urgent={farm.urgent} onClick={() => farm.openPanel({ kind: "tasks" })} />}
```

**components/game/GameShell.tsx — edit 10 of 11.** Replace:

```tsx
      />
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} />
      <CardOverlays cards={cards} me={accountId} coins={fishing.data.state?.coins ?? null} />
```

with:

```tsx
      />
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} dog={coopDog} />
      <CardOverlays cards={cards} me={accountId} coins={fishing.data.state?.coins ?? null} />
```

**components/game/GameShell.tsx — edit 11 of 11.** Replace:

```tsx
      />
      {panel === "wardrobe" && savedLook && (
```

with:

```tsx
      />
      {panel === "dog" && dog.dog && (
        <DogPanel dog={dog.dog} food={dog.food} busy={dog.busy} onFeed={() => void dog.feed()}
          onRename={dog.rename} onPet={() => void dog.pet()} onClose={close} />
      )}
      {panel === "wardrobe" && savedLook && (
```

**components/game/farm/CoopPanel.tsx — edit 1 of 5.** Replace:

```tsx
} from "@/lib/game/farm/land";
import { durationText, harvesterStartText, PHASE_NAME } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
```

with:

```tsx
} from "@/lib/game/farm/land";
import { COAT_NAME, DOG, DOG_COATS, dogNameRefusal, type DogCoat, type DogView } from "@/lib/game/dog";
import {
  ADOPT_BUTTON, ADOPT_INTRO, adoptConfirmText, DOG_NAME_HINT, DOG_NAME_PROBLEM, dogOwnedText, durationText, harvesterStartText,
  PHASE_NAME,
} from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
```

**components/game/farm/CoopPanel.tsx — edit 2 of 5.** Replace:

```tsx
import ConfirmButton from "./ConfirmButton";
import FieldStatus from "./FieldStatus";

type Tab = "village" | "private" | "market" | "harvester" | "mine";
const TABS: ReadonlyArray<[Tab, string]> = [
  ["village", "Đất làng"], ["private", "Đất tư"], ["market", "Chợ đất"], ["harvester", "Máy gặt"], ["mine", "Của tôi"],
];
```

with:

```tsx
import ConfirmButton from "./ConfirmButton";
import DogSprite from "./DogSprite";
import FieldStatus from "./FieldStatus";

type Tab = "village" | "private" | "market" | "harvester" | "dog" | "mine";
const TABS: ReadonlyArray<[Tab, string]> = [
  ["village", "Đất làng"], ["private", "Đất tư"], ["market", "Chợ đất"], ["harvester", "Máy gặt"], ["dog", "🐕 Chó cỏ"], ["mine", "Của tôi"],
];

/** The dog tab's part (v17 §12.3): my dog, and the adoption. Null before 0019 (the field has no rats): no tab. */
export interface CoopDog {
  dog: DogView | null;
  busy: boolean;
  onAdopt: (name: string, coat: DogCoat) => Promise<boolean>;
  onOpenDog: () => void;
}

/** 🐕 Chó cỏ: the four coats (sprites), the name (the coat's by default) and "Nhận nuôi", which asks first; with a dog
 *  owned, a line and "Mở bảng chó". */
function DogTab({ coins, part }: { coins: number; part: CoopDog }) {
  const [coat, setCoat] = useState<DogCoat>("vang");
  const [typed, setTyped] = useState<string | null>(null);
  if (part.dog) {
    return (
      <>
        <p>{dogOwnedText(part.dog.name)}</p>
        <button type="button" className="pch-btn self-start" onClick={part.onOpenDog}>Mở bảng chó</button>
      </>
    );
  }
  const name = typed ?? COAT_NAME[coat];
  const problem = dogNameRefusal(name);
  return (
    <>
      <p className="italic">{ADOPT_INTRO}</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Màu lông">
        {DOG_COATS.map((c) => (
          <button key={c} type="button" aria-pressed={coat === c} className={`pch-btn flex flex-col items-center ${coat === c ? "pch-btn-primary" : ""}`}
            onClick={() => setCoat(c)}>
            <DogSprite coat={c} />
            {COAT_NAME[c]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        Tên
        <input className="flex-1 rounded-sm border border-ink/40 bg-parchment px-1" value={name} maxLength={32}
          onChange={(e) => setTyped(e.target.value)} />
      </label>
      <span className={`text-base ${problem ? "text-burgundy" : "opacity-80"}`}>{problem ? DOG_NAME_PROBLEM[problem] : DOG_NAME_HINT}</span>
      <div className="self-start">
        <ConfirmButton primary warn={adoptConfirmText(name, coat)} disabled={part.busy || problem !== null || coins < DOG.price}
          onConfirm={() => void part.onAdopt(name, coat)}>
          {ADOPT_BUTTON}
        </ConfirmButton>
      </div>
    </>
  );
}
```

**components/game/farm/CoopPanel.tsx — edit 3 of 5.** Replace:

```tsx
 *  harvester and my land. It opens on Máy gặt while a rice plot of mine is ripe. */
export default function CoopPanel({ state, catalog = null, failed, me, busy, now, onAct, onReload, onClose }: {
  state: FieldState | null;
  /** The varieties, for the rice's phases (without it every variety ripens as nếp does). */
```

with:

```tsx
 *  harvester and my land. It opens on Máy gặt while a rice plot of mine is ripe. */
export default function CoopPanel({ state, catalog = null, failed, me, busy, now, onAct, onReload, onClose, dog = null }: {
  state: FieldState | null;
  /** v17: the dog tab's part; null hides the tab. */
  dog?: CoopDog | null;
  /** The varieties, for the rice's phases (without it every variety ripens as nếp does). */
```

**components/game/farm/CoopPanel.tsx — edit 4 of 5.** Replace:

```tsx
        <div role="tablist" aria-label="Hợp tác xã" className="flex flex-wrap gap-1">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
```

with:

```tsx
        <div role="tablist" aria-label="Hợp tác xã" className="flex flex-wrap gap-1">
          {TABS.filter(([id]) => id !== "dog" || dog !== null).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
```

**components/game/farm/CoopPanel.tsx — edit 5 of 5.** Replace:

```tsx
            {tab === "harvester" && <HarvesterTab ctx={ctx} varieties={varieties} busy={busy} now={now} onAct={onAct} />}
            {tab === "mine" && <MineTab ctx={ctx} state={state} busy={busy} now={now} onAct={onAct} />}
```

with:

```tsx
            {tab === "harvester" && <HarvesterTab ctx={ctx} varieties={varieties} busy={busy} now={now} onAct={onAct} />}
            {tab === "dog" && dog && <DogTab coins={state.mine.coins} part={dog} />}
            {tab === "mine" && <MineTab ctx={ctx} state={state} busy={busy} now={now} onAct={onAct} />}
```

Create `components/game/farm/DogPanel.tsx` with exactly:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { dogNameRefusal, dogStatus, feedRefusal, type DogView } from "@/lib/game/dog";
import { serverNow } from "@/lib/game/farm/clock";
import {
  DOG_FEED_REFUSAL, DOG_NAME_HINT, DOG_NAME_PROBLEM, dogCatchesLine, dogCoatLine, dogFeedButton, dogFoodLine, dogHuntLine,
} from "@/lib/game/farm/messages";

/** The rename form: the name, "Lưu" (while dogNameRefusal finds nothing) and "Huỷ". */
function Rename({ current, busy, onSave, onCancel }: {
  current: string;
  busy: boolean;
  onSave: (name: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(current);
  const problem = dogNameRefusal(name);
  return (
    <form className="flex flex-col gap-1" onSubmit={(e) => {
      e.preventDefault();
      if (!problem) void onSave(name).then((ok) => { if (ok) onCancel(); });
    }}>
      <label className="flex items-center gap-2">
        Tên
        <input className="flex-1 rounded-sm border border-ink/40 bg-parchment px-1" value={name} maxLength={32}
          onChange={(e) => setName(e.target.value)} />
      </label>
      <span className={`text-base ${problem ? "text-burgundy" : "opacity-80"}`}>{problem ? DOG_NAME_PROBLEM[problem] : DOG_NAME_HINT}</span>
      <div className="flex gap-1">
        <button type="submit" className="pch-btn pch-btn-primary" disabled={busy || problem !== null}>Lưu</button>
        <button type="button" className="pch-btn" onClick={onCancel}>Huỷ</button>
      </div>
    </form>
  );
}

/** DogPanel (v17 §12.3): my dog's coat and day, food, hunting and catches; "Cho ăn", "Đổi tên" and "Vuốt ve". */
export default function DogPanel({ dog, food, busy, onFeed, onRename, onPet, onClose }: {
  dog: DogView;
  food: number;
  busy: boolean;
  onFeed: () => void;
  onRename: (name: string) => Promise<boolean>;
  onPet: () => void;
  onClose: () => void;
}) {
  const [renaming, setRenaming] = useState(false);
  // the countdowns tick on the server's clock
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);
  const s = dogStatus(dog, now);
  const refusal = feedRefusal(dog, food, now);
  return (
    <ParchmentModal title={`🐕 ${dog.name}`} onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <p>{dogCoatLine(dog.coat, dog.adoptedAt)}</p>
        <p>{dogFoodLine(s)}</p>
        <p>{dogHuntLine(s)}</p>
        <p>{dogCatchesLine(dog.catches)}</p>
        <div className="flex flex-col items-start gap-1">
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || refusal !== null} onClick={onFeed}>
            {dogFeedButton(food)}
          </button>
          {refusal && <span className="text-base opacity-80">{DOG_FEED_REFUSAL[refusal]}</span>}
        </div>
        {renaming ? (
          <Rename current={dog.name} busy={busy} onSave={onRename} onCancel={() => setRenaming(false)} />
        ) : (
          <div className="flex flex-wrap gap-1">
            <button type="button" className="pch-btn" onClick={() => setRenaming(true)}>{"\u270f\ufe0f Đổi tên"}</button>
            <button type="button" className="pch-btn" onClick={onPet}>🤚 Vuốt ve</button>
          </div>
        )}
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/farm/DogSprite.tsx` with exactly:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { DOG_H, DOG_W, dogMatrix } from "@/lib/game/art/dog";
import type { DogCoat } from "@/lib/game/dog";

/** A dog of `coat`, sitting and facing down, drawn in code at `scale` px a pixel (the adoption's coat buttons). */
export default function DogSprite({ coat, scale = 3 }: { coat: DogCoat; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (!c) return;
    c.clearRect(0, 0, DOG_W, DOG_H);
    dogMatrix(coat, "down", "sit").forEach((row, y) => row.forEach((col, x) => {
      if (!col) return;
      c.fillStyle = col;
      c.fillRect(x, y, 1, 1);
    }));
  }, [coat]);
  return (
    <canvas ref={ref} width={DOG_W} height={DOG_H} aria-hidden="true" style={{ width: DOG_W * scale, height: DOG_H * scale }}
      className="[image-rendering:pixelated]" />
  );
}
```

**components/game/farm/FarmOverlays.tsx — edit 1 of 4.** Replace:

```tsx
import { isTyping } from "@/lib/game/keys";
import CoopPanel from "./CoopPanel";
import CrabGame from "./CrabGame";
```

with:

```tsx
import { isTyping } from "@/lib/game/keys";
import CoopPanel, { type CoopDog } from "./CoopPanel";
import CrabGame from "./CrabGame";
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 4.** Replace:

```tsx
 *  panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
  farm: FarmController;
```

with:

```tsx
 *  panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false, dog = null }: {
  farm: FarmController;
```

**components/game/farm/FarmOverlays.tsx — edit 3 of 4.** Replace:

```tsx
  onField: boolean;
  /** A panel or modal outside the field's own is open (the shell's, fishing's, the character editor or the anti-cheat
```

with:

```tsx
  onField: boolean;
  /** v17: the CoopPanel's dog tab (null before 0019). */
  dog?: CoopDog | null;
  /** A panel or modal outside the field's own is open (the shell's, fishing's, the character editor or the anti-cheat
```

**components/game/farm/FarmOverlays.tsx — edit 4 of 4.** Replace:

```tsx
        <CoopPanel state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload}
          onClose={closePanel} />
      )}
```

with:

```tsx
        <CoopPanel state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload}
          onClose={closePanel} dog={state?.rats ? dog : null} />
      )}
```

Create `hooks/useDog.ts` with exactly:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError } from "@/lib/anticheat";
import { DOG, dogStatus, type DogAnswer, type DogCoat, type DogView } from "@/lib/game/dog";
import { FOOD_DOG } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
import { dogFedText, dogRenamedText, dogWelcomeText, farmErrorMessage } from "@/lib/game/farm/messages";
import { adoptDog, dogState, feedDog, renameDog } from "@/lib/game/farm/rpc";
import type { FieldState } from "@/lib/game/farm/state";
import type { PresenceDog } from "@/lib/presence-modes";

export interface DogController {
  /** My dog (null: none, or not known yet). */
  dog: DogView | null;
  /** My food_dog bịch. */
  food: number;
  /** The dog is hungry now (the HUD's "!", the drooping sit). */
  hungry: boolean;
  /** A dog call is in flight. */
  busy: boolean;
  adopt: (name: string, coat: DogCoat) => Promise<boolean>;
  rename: (name: string) => Promise<boolean>;
  feed: () => Promise<boolean>;
  /** "🤚 Vuốt ve": at most one every 3 s (D27); false while too soon, or without a dog. */
  pet: () => boolean;
}

export interface DogOptions {
  token: string;
  /** The field's state, whose account part carries my dog and my food (the newest answer wins). */
  field: FieldState | null;
  /** My dog on the canvas (petting). */
  petDog: () => void;
  setPresenceDog: (d: PresenceDog | null) => void;
  toast: (text: string) => void;
  /** An adoption paid: the HUD's wallet fetches again. */
  onCoinsChanged: () => void;
}

/** My dog in game mode (v17 §7.3, §12.3): dog_state once on entering it, then every dog answer and the field's `mine.dog`,
 *  whichever is newer on the server's clock. It publishes {name, coat} to presence; the shell passes it to the canvas. */
export function useDog({ token, field, petDog, setPresenceDog, toast, onCoinsChanged }: DogOptions): DogController {
  const [own, setOwn] = useState<DogAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const live = useRef({ toast, onCoinsChanged });
  useEffect(() => {
    live.current = { toast, onCoinsChanged };
  });

  // entering game mode: dog_state (before 0019 it is missing, and there is no dog)
  useEffect(() => {
    let on = true;
    dogState(token).then((a) => { if (on) setOwn(a); }, () => {});
    return () => { on = false; };
  }, [token]);

  // the newest of my own answers and the field's
  const fromField = field !== null && (own === null || field.serverNow > own.serverNow);
  const dog = fromField ? field.mine.dog : own?.dog ?? null;
  const food = fromField ? field.mine.items[FOOD_DOG] ?? 0 : own?.food ?? 0;
  const hungry = dog !== null && !dogStatus(dog, serverNow()).fed;

  const name = dog?.name ?? null, coat = dog?.coat ?? null;
  useEffect(() => {
    setPresenceDog(name !== null && coat !== null ? { name, coat } : null);
  }, [name, coat, setPresenceDog]);

  const call = useCallback(async (job: () => Promise<DogAnswer>, rpc: string, done: (a: DogAnswer) => string): Promise<boolean> => {
    setBusy(true);
    try {
      const a = await job();
      setOwn(a);
      live.current.toast(done(a));
      return true;
    } catch (err) {
      // a strike shows its modal instead
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) live.current.toast(farmErrorMessage(err, undefined, rpc));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const lastPet = useRef(-Infinity);
  return {
    dog, food, hungry, busy,
    adopt: useCallback(async (n: string, c: DogCoat) => {
      const ok = await call(() => adoptDog(token, n, c), "adopt_dog", (a) => dogWelcomeText(a.dog?.name ?? n));
      if (ok) live.current.onCoinsChanged();
      return ok;
    }, [call, token]),
    rename: useCallback((n: string) => call(() => renameDog(token, n), "rename_dog", (a) => dogRenamedText(a.dog?.name ?? n)), [call, token]),
    feed: useCallback(() => call(() => feedDog(token), "feed_dog", (a) => dogFedText(a.dog?.name ?? "")), [call, token]),
    pet: useCallback(() => {
      const t = Date.now();
      if (name === null || t - lastPet.current < DOG.petEveryMs) return false;
      lastPet.current = t;
      petDog();
      return true;
    }, [name, petDog]),
  };
}
```

**hooks/useFarmController.ts — edit 1 of 6.** Replace:

```ts
import { PART_WAIT_MS, PART_WINDOW_MS, producePrice, ricePrice, type FarmCatalog } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
```

with:

```ts
import { PART_WAIT_MS, PART_WINDOW_MS, producePrice, ricePrice, type FarmCatalog } from "@/lib/game/farm/catalog";
import { DOG, dogStatus } from "@/lib/game/dog";
import { serverNow } from "@/lib/game/farm/clock";
```

**hooks/useFarmController.ts — edit 2 of 6.** Replace:

```ts
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, farmErrorMessage,
  FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NO_PELLETS, NOT_OPEN,
```

with:

```ts
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, dogCatchText, farmErrorMessage,
  FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NO_PELLETS, NOT_OPEN,
```

**hooks/useFarmController.ts — edit 3 of 6.** Replace:

```ts
import type { CrabVisit, FieldAction, PartAnswer } from "@/lib/game/farm/rpc";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
```

with:

```ts
import type { CrabVisit, FieldAction, PartAnswer } from "@/lib/game/farm/rpc";
import { nearestRat } from "@/lib/game/farm/rats";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
```

**hooks/useFarmController.ts — edit 4 of 6.** Replace:

```ts
export const SLING_FA_MS = 2000;
```

with:

```ts
export const SLING_FA_MS = 2000;
/** The auto-hunt looks for a rat this often (§7.2). */
export const DOG_HUNT_EVERY_MS = 1000;
```

**hooks/useFarmController.ts — edit 5 of 6.** Replace:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish, pickSnailBed, slingStart, slingShoot } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

with:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish, pickSnailBed, slingStart, slingShoot, dogHunt } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

**hooks/useFarmController.ts — edit 6 of 6.** Replace:

```ts

  // leaving the field drops a begin_work or crab_start answer still on its way from the commit that leaves it, before the
```

with:

```ts

  // --- my dog's auto-hunt (v17 §7.2, D17, D30): every second, dog_hunt at the nearest rat within 96 px when the dog is
  // fed and rested, my caps have room, I pressed a key or the pointer in the last 3 minutes, no job or SlingGame is open
  // and no refusal came in the last 10 s. The dog runs at the call; a refusal calls it back, and says nothing.
  const hunting = useRef(false);
  const huntRefusedAt = useRef(-Infinity);
  const huntOn = active && state !== null && state.rats !== null && state.mine.dog !== null;
  useEffect(() => {
    if (!huntOn) return;
    const timer = setInterval(() => {
      const { state: s, round: r, crab: c, sling: sl } = live.current;
      const cv = canvas();
      const at = Date.now(), t = serverNow();
      const dog = s?.mine.dog;
      if (!s?.rats || !dog || !cv || hunting.current) return;
      if (dogStatus(dog, t).hunt !== "ready") return;
      const caps = s.mine.ratCaps;
      const hourOpen = caps.hourLeft > 0 || (caps.hourResetsAt !== null && caps.hourResetsAt <= t);
      if (!hourOpen || caps.dayLeft < 1) return;
      if (cv.lastInputAt() < at - DOG.activeMs || at - huntRefusedAt.current < DOG.refusalPauseMs) return;
      if (sl || workTimer.current || roundOn(r) || c || bedTimers.current.length > 0) return;
      const pos = cv.localPos();
      const rat = pos ? nearestRat(s.rats.live, pos, t, DOG.huntRadius) : null;
      if (!rat) return;
      void (async () => {
        hunting.current = true;
        const closed = closes.current;
        cv.dogPounce(rat.id);
        const got = await dogHunt(rat.id, () => {});
        hunting.current = false;
        if (got) {
          // the catch changed the plot for everyone
          canvas()?.plotChanged(rat.plot);
          live.current.toast(dogCatchText(dog.name));
          return;
        }
        huntRefusedAt.current = Date.now();
        const now = canvas();
        if (closes.current === closed && now?.mapId() === "field") now.dogRecall();
      })();
    }, DOG_HUNT_EVERY_MS);
    return () => clearInterval(timer);
  }, [huntOn, canvas, dogHunt]);

  // leaving the field drops a begin_work or crab_start answer still on its way from the commit that leaves it, before the
```

**lib/game/farm/messages.ts — edit 1 of 2.** Replace:

```ts
import { durationVi, lockSeconds, lockText } from "@/lib/anticheat";
import { AMMO_PELLET, TOOL_SLING, type CritterKind, type UplandCrop } from "./catalog";
```

with:

```ts
import { durationVi, lockSeconds, lockText } from "@/lib/anticheat";
import { COAT_NAME, type DogCoat, type DogNameProblem, type DogStatus } from "../dog";
import { AMMO_PELLET, TOOL_SLING, type CritterKind, type UplandCrop } from "./catalog";
```

**lib/game/farm/messages.ts — edit 2 of 2.** Replace:

```ts

/** The seconds an error's details carry (hole empty, bed empty, rat limit, dog resting), as ms; null without them. */
```

with:

```ts

// The dog (§12.3): the HUD, DogPanel and the CoopPanel's tab.

/** The HUD's button: the name, with "!" while hungry. */
export function dogHudText(name: string, hungry: boolean): string {
  return `🐕 ${name}${hungry ? " !" : ""}`;
}
/** DogPanel's lines: the coat and the adoption day (Vietnam time), food, hunting and catches. */
export function dogCoatLine(coat: DogCoat, adoptedAt: number): string {
  const d = new Date(adoptedAt + 7 * 3_600_000);
  return `Chó cỏ lông ${COAT_NAME[coat].toLowerCase()} · nuôi từ ${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
}
export function dogFoodLine(s: DogStatus): string {
  if (!s.fed) return "🍖 Đói — cho ăn để nó đi săn";
  const h = Math.floor(s.foodLeftMs / 3_600_000);
  return `🍖 No — còn ${h >= 1 ? `${h} giờ` : durationVi(Math.ceil(s.foodLeftMs / 1000))}`;
}
export function dogHuntLine(s: DogStatus): string {
  if (s.hunt === "hungry") return "🐀 Đói nên không săn";
  if (s.hunt === "ready") return "🐀 Sẵn sàng — ra đồng, đứng gần chuột là nó vồ";
  const sec = Math.ceil(s.restLeftMs / 1000);
  return `🐀 Nghỉ — vồ tiếp sau ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
export function dogCatchesLine(n: number): string {
  return `🏅 Đã bắt ${n} con chuột`;
}
export function dogFeedButton(food: number): string {
  return `🦴 Cho ăn (${food} bịch)`;
}
/** Why "Cho ăn" is disabled (feedRefusal). */
export const DOG_FEED_REFUSAL: Record<"full" | "no_food", string> = {
  full: "Còn no hơn 12 giờ — chưa ăn thêm được.",
  no_food: "Hết thức ăn chó — mua ở tiệm anh Hai.",
};
/** The name field's hint: the rule, or what dogNameRefusal finds. */
export const DOG_NAME_HINT = "2–16 ký tự";
export const DOG_NAME_PROBLEM: Record<DogNameProblem, string> = {
  length: "Tên cần 2–16 ký tự.",
  hidden: "Tên có ký tự ẩn — gõ lại nhé.",
  reserved: "Tên này dành riêng — chọn tên khác nhé.",
};
export function dogFedText(name: string): string {
  return `🦴 ${name} ăn ngon lành — no 24 giờ.`;
}
export function dogRenamedText(name: string): string {
  return `\u270f\ufe0f Đã đổi tên thành ${name}.`;
}
export const ADOPT_INTRO =
  "“Chó cỏ nhà chú mới đẻ một bầy, con nào cũng khôn. 20.000 xu con mang về nuôi — nhớ cho ăn mỗi ngày, mùa lúa chín nó bắt chuột giỏi lắm!”";
export const ADOPT_BUTTON = "Nhận nuôi · 20.000 xu";
export function adoptConfirmText(name: string, coat: DogCoat): string {
  return `Nhận nuôi ${name} (lông ${COAT_NAME[coat].toLowerCase()}) với giá 20.000 xu? Mỗi người chỉ nuôi một con.`;
}
export function dogOwnedText(name: string): string {
  return `Bạn đã nuôi ${name} rồi — mỗi người một con thôi.`;
}
export function dogWelcomeText(name: string): string {
  return `🐕 Chào mừng ${name} về nhà! Nó sẽ theo bạn khắp nơi.`;
}

/** The seconds an error's details carry (hole empty, bed empty, rat limit, dog resting), as ms; null without them. */
```

**lib/game/overlays.ts — edit 1 of 2.** Replace:

```ts
  rulesBook: boolean;
}
```

with:

```ts
  rulesBook: boolean;
  /** DogPanel (v17 §12.3). */
  dogPanel: boolean;
}
```

**lib/game/overlays.ts — edit 2 of 2.** Replace:

```ts
export function overlayLocks(o: OpenOverlays): { blocking: boolean; panelOpen: boolean } {
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal || o.cardPanel || o.rulesBook;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound || o.farmCrab || o.slingGame, panelOpen };
```

with:

```ts
export function overlayLocks(o: OpenOverlays): { blocking: boolean; panelOpen: boolean } {
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal || o.cardPanel || o.rulesBook || o.dogPanel;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound || o.farmCrab || o.slingGame, panelOpen };
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (3 files, 82 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameShell.tsx components/game/farm/CoopPanel.tsx components/game/farm/DogPanel.tsx components/game/farm/DogSprite.tsx components/game/farm/FarmOverlays.tsx hooks/useDog.ts hooks/useFarmController.ts lib/game/farm/messages.ts lib/game/overlays.ts tests/unit/farm-dog-ui.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the dog in game mode: auto-hunt, DogPanel, adoption at chú Tám's

useDog learns my dog with dog_state on entering game mode and then takes whichever is
newer on the server's clock, its own answers or the field's mine.dog. It publishes
{name, coat} to presence, and GameShell passes it to the canvas, drooping while
hungry. Adopt, rename and feed toast their lines; a refusal toasts its §10.6 text,
and petting goes out at most once every 3 s. The HUD's player card gains
"🐕 {name}" ("!" while hungry), which opens DogPanel with the coat and day, food,
hunting, catches, "Cho ăn" with its reasons, "Đổi tên" with dogNameRefusal's hints,
and "Vuốt ve". CoopPanel gains the "🐕 Chó cỏ" tab before "Của tôi" (after 0019):
four coats drawn in code, a name that defaults to the coat's, and "Nhận nuôi" after
a confirmation. useFarmController hunts every second when all the §7.2 conditions
hold. The dog runs at the dog_hunt call. A catch sends fp for the plot and toasts. A
refusal calls the dog back (only while the field is still shown), says nothing and
pauses the hunt 10 s. overlayLocks gains dogPanel, which sets both locks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameShell.tsx components/game/farm/CoopPanel.tsx components/game/farm/DogPanel.tsx components/game/farm/DogSprite.tsx components/game/farm/FarmOverlays.tsx hooks/useDog.ts hooks/useFarmController.ts lib/game/farm/messages.ts lib/game/overlays.ts tests/unit/farm-dog-ui.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 17: The ná, pellets and dog food in the shops and the bag; the rats on the panels

**Files:**
- Create: `components/game/farm/RatChip.tsx`
- Modify: `components/game/GameShell.tsx`, `components/game/farm/FarmOverlays.tsx`, `components/game/farm/FarmShopPanel.tsx`, `components/game/farm/Handbook.tsx`, `components/game/farm/PlotPanel.tsx`, `components/game/farm/RiceDepotPanel.tsx`, `components/game/farm/Stepper.tsx`, `components/game/fishing/BagPanel.tsx`, `hooks/useFarmController.ts`
- Test: `tests/unit/farm-rat-panels.test.tsx` (create); `tests/unit/farm-overlays.test.tsx`, `tests/unit/use-farm-controller.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`ratHours`, `ratFactor`, `FarmMine.rats`), Task 7 (`TOOL_SLING`, `AMMO_PELLET`, `FOOD_DOG`, `ITEM_CAP`), Task 9 (`ratPlotText`, `ratSaleText`, `ratChipText`, `ratChipLabel`, `handbookTabs(…, items)`, `handbookTabFor(…, ratted)`, `dueTasks(…, rats)`), Task 14 (`sellRats`); `ItemIcon` (Task 11's icons).
- Produces (§12.1, §12.4): `Stepper`'s `by`; `FarmShopPanel`'s "🐾 Đạn & thức ăn chó" shelf (`PetRow`); `RiceDepotPanel`'s `DepotRats {price, onSell}` and rat section, intro and empty text; `BagPanel`'s Ná and dog food lines; `PlotPanel`'s rat line and handbook link; `Handbook` passes the items; `components/game/farm/RatChip.tsx` under the map counts; `useFarmController.sellRats()` and the tasks with the rats.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-overlays.test.tsx.** Replace:

```tsx
  loadSprayer: vi.fn().mockResolvedValue(true), sellProduce: vi.fn().mockResolvedValue(true), sellCritters: vi.fn().mockResolvedValue(true),
  interact: vi.fn(), promptText: vi.fn(),
```

with:

```tsx
  loadSprayer: vi.fn().mockResolvedValue(true), sellProduce: vi.fn().mockResolvedValue(true), sellCritters: vi.fn().mockResolvedValue(true),
  sellRats: vi.fn().mockResolvedValue(true),
  interact: vi.fn(), promptText: vi.fn(),
```

Create `tests/unit/farm-rat-panels.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import BagPanel from "@/components/game/fishing/BagPanel";
import FarmShopPanel from "@/components/game/farm/FarmShopPanel";
import PlotPanel from "@/components/game/farm/PlotPanel";
import RatChip from "@/components/game/farm/RatChip";
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import Stepper from "@/components/game/farm/Stepper";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { parseFarmMine, parseFieldState } from "@/lib/game/farm/state";
import type { FishingCatalog } from "@/lib/game/fishing/catalog";
import { parseFishingState } from "@/lib/game/fishing/state";

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const NOW = Date.parse("2026-09-26T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const item = (id: string, kind: string, name: string, price: number, sort: number) =>
  farmItemFromRow({ id, kind, name, price, sort_order: sort, variety: null, fert: null, pest_target: null, capacity: null });
const SLING = item("tool_sling", "tool", "Ná", 3000, 30);
const PELLET = item("ammo_pellet", "ammo", "Đạn đất", 10, 10);
const FOOD = item("food_dog", "pet_food", "Thức ăn chó", 150, 20);
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG = { varieties: [nep], uplands: [], critters: [], items: [SLING, PELLET, FOOD] };
const mine = (over: Record<string, unknown> = {}) => parseFarmMine({ items: {}, rice: {}, coins: 5000, gift_claimed: true, ...over })!;

describe("Stepper's by (v17 §12.4)", () => {
  it("moves by `by`, inside [min, max]", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Stepper value={10} max={35} by={10} label="Số lượng" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(onChange).toHaveBeenLastCalledWith(20);
    fireEvent.click(screen.getByRole("button", { name: "Bớt" }));
    expect(onChange).toHaveBeenLastCalledWith(1);
    rerender(<Stepper value={30} max={35} by={10} label="Số lượng" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Thêm" }));
    expect(onChange).toHaveBeenLastCalledWith(35);
  });
});

describe("FarmShopPanel, v17 (§12.4)", () => {
  const show = (m = mine()) => {
    const onBuy = vi.fn();
    render(<FarmShopPanel mine={m} catalog={CATALOG} failed={false} busy={false} onBuy={onBuy} onReload={vi.fn()} onClose={vi.fn()} />);
    return onBuy;
  };

  it("sells the ná once, under Nông cụ", () => {
    const onBuy = show();
    fireEvent.click(screen.getByRole("button", { name: "Mua · 3.000 xu" }));
    expect(onBuy).toHaveBeenCalledWith("tool_sling", 1);
    cleanup();
    show(mine({ items: { tool_sling: 1 } }));
    expect(screen.getByRole("button", { name: "✓ Đã có" })).toBeDisabled();
  });

  it("sells pellets by 10 up to 99 held, and dog food by the bịch", () => {
    const onBuy = show(mine({ items: { ammo_pellet: 75 } }));
    expect(screen.getByRole("heading", { name: "🐾 Đạn & thức ăn chó" })).toBeInTheDocument();
    expect(screen.getByText(/10 xu\/viên · có 75/)).toBeInTheDocument();
    expect(screen.getByText(/150 xu\/bịch · no 24 giờ · có 0/)).toBeInTheDocument();
    const pellets = screen.getByRole("group", { name: "Số lượng Đạn đất" });
    fireEvent.click(pellets.querySelector("button[aria-label='Thêm']")!);
    fireEvent.click(pellets.querySelector("button[aria-label='Thêm']")!);
    // 99 − 75 = 24 at most
    fireEvent.click(screen.getByRole("button", { name: "Mua 24 viên · 240 xu" }));
    expect(onBuy).toHaveBeenCalledWith("ammo_pellet", 24);
    fireEvent.click(screen.getByRole("button", { name: "Mua 1 · 150 xu" }));
    expect(onBuy).toHaveBeenCalledWith("food_dog", 1);
  });

  it("starts pellets at 10, or at what the coins pay for", () => {
    show(mine({ coins: 70 }));
    expect(screen.getByRole("button", { name: "Mua 7 viên · 70 xu" })).toBeInTheDocument();
    cleanup();
    show();
    expect(screen.getByRole("button", { name: "Mua 10 viên · 100 xu" })).toBeInTheDocument();
  });
});

describe("RiceDepotPanel, v17 (§12.4)", () => {
  const show = (m = mine(), rats: { price: number; onSell: () => void } | null = { price: 336, onSell: vi.fn() }) =>
    render(<RiceDepotPanel mine={m} catalog={CATALOG} failed={false} busy={false} onSell={vi.fn()} onSellProduce={vi.fn()}
      onReload={vi.fn()} onClose={vi.fn()} critters={{ prices: null, onSell: vi.fn() }} rats={rats} />);

  it("sells the whole rat bag at its fixed prices, with today's price under it", () => {
    const onSell = vi.fn();
    show(mine({ rats: { count: 3, value: 486 } }), { price: 336, onSell });
    expect(screen.getByText("🐀 Chuột đồng · 3 con")).toBeInTheDocument();
    expect(screen.getByText("486 xu (giá chốt lúc bắt)")).toBeInTheDocument();
    expect(screen.getByText("Giá chuột bây giờ: 336 xu một con")).toBeInTheDocument();
    expect(screen.getByText("“Chuột đồng béo vậy, cô lấy hết — đem nướng lu là ngon số một!”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bán hết · 486 xu" }));
    expect(onSell).toHaveBeenCalled();
  });

  it("adds rats to the empty text, and has no rat row before 0019", () => {
    show();
    expect(screen.getByText("“Chưa có lúa, hoa màu, cua ốc hay chuột hả con? Có hàng mang qua, cô trả giá cao!”")).toBeInTheDocument();
    cleanup();
    show(mine({ rats: { count: 3, value: 486 } }), null);
    expect(screen.queryByText(/Chuột đồng/)).toBeNull();
    expect(screen.getByText("“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”")).toBeInTheDocument();
  });
});

describe("BagPanel's Nông cụ, v17 (§12.4)", () => {
  const FISH: FishingCatalog = { items: [], species: [] };
  const STATE = parseFishingState({
    coins: 0, loadout: { rod: "rod_wood", bobber: "bobber_feather", bait: "bait_worm" }, owned: [], bait: {}, bait_cap: 20, fish: [], fish_cap: 6,
  })!;
  const show = (m: ReturnType<typeof mine>, items = CATALOG.items) => render(
    <BagPanel state={STATE} catalog={FISH} busy={false} onEquip={vi.fn()} onRelease={vi.fn()} onClose={vi.fn()}
      farm={{ mine: m, items, critters: [], now: NOW, busy: false, onLoad: vi.fn() }} />,
  );

  it("names the ná and its pellets, or where to buy it, and the dog food held", () => {
    show(mine({ items: { tool_sling: 1, ammo_pellet: 12, food_dog: 3 } }));
    expect(screen.getByText("Ná — còn 12 viên đạn đất")).toBeInTheDocument();
    expect(screen.getByText("Thức ăn chó — 3 bịch")).toBeInTheDocument();
    cleanup();
    show(mine());
    expect(screen.getByText("Chưa có ná — tiệm anh Hai bán 3.000 xu")).toBeInTheDocument();
    expect(screen.queryByText(/Thức ăn chó/)).toBeNull();
    cleanup();
    show(mine(), []);
    expect(screen.queryByText(/ná/)).toBeNull();
  });
});

describe("PlotPanel, v17 (§12.1)", () => {
  const field = (rats: Record<string, unknown>) => parseFieldState({
    server_now: iso(0),
    plots: [{
      no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0,
      crop: {
        variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50), water: 1,
        water_set_at: iso(-3), pests: [], excess_n: false, ripe: true, rotted_at: null,
        log: { water: [], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
    }],
    drying: [],
    mine: { items: {}, rice: {}, coins: 1, gift_claimed: true },
    rats: { next_at: iso(1), price: 150, live: [], recent: [], plots: {}, ...rats },
  });
  const show = (rats: Record<string, unknown>) => {
    const onOpenHandbook = vi.fn();
    render(<PlotPanel no={6} state={field(rats)} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={vi.fn()}
      onOpenHandbook={onOpenHandbook} onReload={vi.fn()} onClose={vi.fn()} />);
    return onOpenHandbook;
  };

  it("says how many rats eat and what they took, and links the rats' tab", () => {
    const onOpenHandbook = show({
      live: [{ id: 1, plot: 6, since: iso(-2), seed: 1 }, { id: 2, plot: 6, since: iso(-1), seed: 2 }],
      plots: { 6: [{ r: 1, from: iso(-2), to: null }, { r: 2, from: iso(-1), to: null }] },
    });
    expect(screen.getByText("🐀 2 con chuột đang ăn · đã mất ~6% (tối đa 10%)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Chuột, chó & ná" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("rats");
  });

  it("says under 1% for a short visit, and nothing without rats", () => {
    show({ plots: { 6: [{ r: 1, from: iso(-0.2), to: iso(-0.1) }] } });
    expect(screen.getByText("🐀 0 con chuột đang ăn · đã mất dưới 1% (tối đa 10%)")).toBeInTheDocument();
    cleanup();
    show({});
    expect(screen.queryByText(/con chuột đang ăn/)).toBeNull();
  });
});

describe("RatChip (v17 §12.1)", () => {
  it("counts the live rats and opens the handbook; nothing without rats", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<RatChip live={2} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: "Mùa chuột: 2 con chuột đang phá đồng — mở Sổ tay" }));
    expect(screen.getByText("🐀 Mùa chuột · 2 con")).toBeInTheDocument();
    expect(onOpen).toHaveBeenCalled();
    rerender(<RatChip live={0} onOpen={onOpen} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
```

**tests/unit/use-farm-controller.test.tsx.** Append at the end of the file, after a blank line:

```tsx
describe("useFarmController, v17 cô Út buys the rats", () => {
  it("sells the bag and toasts what she paid", async () => {
    const { result, toast } = setup();
    await flush();
    rpc.sellRats.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 1486 })!, sold: { count: 3, xu: 486 } });
    await act(async () => { expect(await result.current.sellRats()).toBe(true); });
    expect(toast).toHaveBeenCalledWith("💰 Bán 3 con chuột được 486 xu.");
  });

  it("lists a rat on my plot among the due tasks", async () => {
    const f = field();
    rpc.fetchFieldState.mockResolvedValue({ ...f, rats: { nextAt: NOW + 3_600_000, price: 150, live: [{ id: 1, plot: 5, since: NOW, seed: 1 }], recent: [], plots: {} } });
    const { result } = setup();
    await flush();
    expect(result.current.tasks[0]).toEqual({ plot: 5, text: "Thửa 5 · 🐀 Chuột đang phá (1 con) — bắn ná, dẫn chó tới hoặc thu hoạch cho xong", urgent: true });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-overlays.test.tsx tests/unit/farm-rat-panels.test.tsx tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — `farm-rat-panels.test.tsx` cannot load `RatChip`, and 2 tests fail (no `sellRats`, no rat task); 2 files fail, 1 passes (77 tests).

- [ ] **Step 3: Implement**

**components/game/GameShell.tsx — edit 1 of 2.** Replace:

```tsx
import FarmOverlays from "./farm/FarmOverlays";
import { FarmTasksButton } from "./farm/FarmTasks";
```

with:

```tsx
import FarmOverlays from "./farm/FarmOverlays";
import RatChip from "./farm/RatChip";
import { FarmTasksButton } from "./farm/FarmTasks";
```

**components/game/GameShell.tsx — edit 2 of 2.** Replace:

```tsx
        </div>
        <MapCounts counts={counts} />
        <HudNowPlaying
```

with:

```tsx
        </div>
        <div className="flex flex-col items-center gap-1">
          <MapCounts counts={counts} />
          {map.id === "field" && (
            <RatChip live={farm.data.state?.rats?.live.length ?? 0} onOpen={() => farm.openPanel({ kind: "handbook", tab: "rats" })} />
          )}
        </div>
        <HudNowPlaying
```

**components/game/farm/FarmOverlays.tsx.** Replace:

```tsx
            ? { prices: state?.critterPrices ?? null, onSell: (k) => void farm.sellCritters(k) } : null}
          onReload={onReload} onClose={closePanel} />
```

with:

```tsx
            ? { prices: state?.critterPrices ?? null, onSell: (k) => void farm.sellCritters(k) } : null}
          rats={state?.rats ? { price: state.rats.price, onSell: () => void farm.sellRats() } : null}
          onReload={onReload} onClose={closePanel} />
```

**components/game/farm/FarmShopPanel.tsx — edit 1 of 2.** Replace:

```tsx
  ["critter_box", "🪣 Đồ đựng cua ốc", (i) => i.kind === "critter_box"],
];
```

with:

```tsx
  ["critter_box", "🪣 Đồ đựng cua ốc", (i) => i.kind === "critter_box"],
  ["pet", "🐾 Đạn & thức ăn chó", (i) => i.kind === "ammo" || i.kind === "pet_food"],
];

/** Pellets (by 10, "Mua {10} viên · {100} xu") and dog food, v17 §12.4: at most 99 held, as many as the coins pay for. */
function PetRow({ item, mine, busy, onBuy }: { item: FarmItem; mine: FarmMine; busy: boolean; onBuy: (itemId: string, qty: number) => void }) {
  const price = item.price ?? 0;
  const held = itemCount(mine, item.id);
  const max = Math.min(ITEM_CAP - held, Math.floor(mine.coins / Math.max(1, price)));
  const ammo = item.kind === "ammo";
  const [qty, setQty] = useState(ammo ? 10 : 1);
  const n = Math.min(qty, Math.max(1, max));
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{ammo ? `${price} xu/viên` : `${price} xu/bịch · no 24 giờ`} · có {held}</span>
        </div>
      </div>
      {max < 1 ? (
        <button type="button" className="pch-btn" disabled>{held >= ITEM_CAP ? `Đã đủ ${ITEM_CAP}` : "Không đủ xu"}</button>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <Stepper value={n} max={max} by={ammo ? 10 : 1} label={`Số lượng ${item.name}`} onChange={setQty} />
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, n)}>
            {ammo ? `Mua ${n} viên` : `Mua ${n}`} · {formatXu(price * n)}
          </button>
        </div>
      )}
    </li>
  );
}
```

**components/game/farm/FarmShopPanel.tsx — edit 2 of 2.** Replace:

```tsx
                        ? <BoxRow key={i.id} item={i} mine={mine} all={catalog.items} busy={busy} onBuy={onBuy} />
                        : <Row key={i.id} item={i} mine={mine} catalog={catalog} busy={busy} onBuy={onBuy} />))}
                  </ul>
```

with:

```tsx
                        ? <BoxRow key={i.id} item={i} mine={mine} all={catalog.items} busy={busy} onBuy={onBuy} />
                        : i.kind === "ammo" || i.kind === "pet_food"
                          ? <PetRow key={i.id} item={i} mine={mine} busy={busy} onBuy={onBuy} />
                          : <Row key={i.id} item={i} mine={mine} catalog={catalog} busy={busy} onBuy={onBuy} />))}
                  </ul>
```

**components/game/farm/Handbook.tsx.** Replace:

```tsx
}) {
  const tabs = handbookTabs(uplands, critters);
  const [tab, setTab] = useState<HandbookTab>(tabs.some(([id]) => id === initial) ? initial! : "process");
```

with:

```tsx
}) {
  const tabs = handbookTabs(uplands, critters, items);
  const [tab, setTab] = useState<HandbookTab>(tabs.some(([id]) => id === initial) ? initial! : "process");
```

**components/game/farm/PlotPanel.tsx — edit 1 of 3.** Replace:

```tsx
import {
  BED_WATER_NAME, bedLevelsText, durationText, PEST_NAME, PEST_REMEDY, PHASE_NAME, uplandPhaseName, WATER_NAME,
} from "@/lib/game/farm/messages";
import type { CropView, FieldState, PlotView } from "@/lib/game/farm/state";
```

with:

```tsx
import {
  BED_WATER_NAME, bedLevelsText, durationText, PEST_NAME, PEST_REMEDY, PHASE_NAME, ratPlotText, uplandPhaseName, WATER_NAME,
} from "@/lib/game/farm/messages";
import { ratFactor, ratHours } from "@/lib/game/farm/rats";
import type { CropView, FieldState, PlotView } from "@/lib/game/farm/state";
```

**components/game/farm/PlotPanel.tsx — edit 2 of 3.** Replace:

```tsx
  const v = p?.crop ? catalog?.varieties.find((x) => x.id === p.crop!.variety) ?? null : null;
  const tab = handbookTabFor(p?.crop ?? null, v, now);
  const tabs = catalog ? handbookTabs(catalog.uplands, catalog.critters) : [];
  const tabName = (id: string) => tabs.find(([t]) => t === id)?.[1];
```

with:

```tsx
  const v = p?.crop ? catalog?.varieties.find((x) => x.id === p.crop!.variety) ?? null : null;
  // v17 §12.1: a plot with a rat log or live rats says so, and its handbook link goes to the rats' tab
  const ratLog = state?.rats?.plots[no] ?? null;
  const ratsHere = state?.rats?.live.filter((r) => r.plot === no).length ?? 0;
  const ratted = ratLog !== null || ratsHere > 0;
  const tab = handbookTabFor(p?.crop ?? null, v, now, ratted);
  const tabs = catalog ? handbookTabs(catalog.uplands, catalog.critters, catalog.items) : [];
  const tabName = (id: string) => tabs.find(([t]) => t === id)?.[1];
```

**components/game/farm/PlotPanel.tsx — edit 3 of 3.** Replace:

```tsx
            )}
            <ul className="flex flex-col gap-1">
```

with:

```tsx
            )}
            {ratted && <p>{ratPlotText(ratsHere, (1 - ratFactor(ratHours(ratLog ?? [], now))) * 100)}</p>}
            <ul className="flex flex-col gap-1">
```

Create `components/game/farm/RatChip.tsx` with exactly:

```tsx
"use client";

import { ratChipLabel, ratChipText } from "@/lib/game/farm/messages";

/** The field's rat season chip (v17 §12.1), under the map counts while rats are live: it opens the handbook at
 *  "Chuột, chó & ná". Nothing while there are none. */
export default function RatChip({ live, onOpen }: { live: number; onOpen: () => void }) {
  if (live < 1) return null;
  return (
    <button type="button" className="pch-btn pointer-events-auto font-vt text-lg" aria-label={ratChipLabel(live)} onClick={onOpen}>
      {ratChipText(live)}
    </button>
  );
}
```

**components/game/farm/RiceDepotPanel.tsx — edit 1 of 5.** Replace:

```tsx

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3; v15.2 §13.5; v15.3 §13.4): sell wet or dry rice per variety — dry rice pays the
 *  full price — hoa màu, fresh, and cua & ốc once 0018 has critters. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose, critters = null }: {
  mine: FarmMine | null;
```

with:

```tsx

/** cô Út's rats once 0019 is in (v17 §12.4): what a catch fetches now, and the sale of the whole bag. */
export interface DepotRats { price: number; onSell: () => void }

/** 🐀 Chuột đồng: the bag at the prices fixed at the catch, Bán hết, and today's price. */
function RatSection({ mine, rats, busy }: { mine: FarmMine; rats: DepotRats; busy: boolean }) {
  const { count, value } = mine.rats;
  return (
    <section className="flex flex-col gap-1">
      {count > 0 && (
        <div className="pch flex flex-wrap items-center justify-between gap-2 p-2">
          <span className="flex items-center gap-2">
            <ItemIcon id="rat" scale={3} />
            <span className="flex flex-col leading-none">
              <span className="text-xl">🐀 Chuột đồng · {count} con</span>
              <span className="text-base">{formatXu(value)} (giá chốt lúc bắt)</span>
            </span>
          </span>
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={rats.onSell}>Bán hết · {formatXu(value)}</button>
        </div>
      )}
      <p className="text-base opacity-80">Giá chuột bây giờ: {rats.price.toLocaleString("vi-VN")} xu một con</p>
    </section>
  );
}

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3; v15.2 §13.5; v15.3 §13.4; v17 §12.4): sell wet or dry rice per variety — dry
 *  rice pays the full price — hoa màu, fresh, cua & ốc once 0018 has critters, and rats once 0019 is in. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose, critters = null, rats = null }: {
  mine: FarmMine | null;
```

**components/game/farm/RiceDepotPanel.tsx — edit 2 of 5.** Replace:

```tsx
  critters?: DepotCritters | null;
}) {
```

with:

```tsx
  critters?: DepotCritters | null;
  rats?: DepotRats | null;
}) {
```

**components/game/farm/RiceDepotPanel.tsx — edit 3 of 5.** Replace:

```tsx
  const caught = Object.values(mine?.critters ?? {}).some((s) => s.n > 0);
  return (
```

with:

```tsx
  const caught = Object.values(mine?.critters ?? {}).some((s) => s.n > 0);
  const ratted = rats !== null && (mine?.rats.count ?? 0) > 0;
  return (
```

**components/game/farm/RiceDepotPanel.tsx — edit 4 of 5.** Replace:

```tsx
              <p>“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”</p>
            ) : !caught && (
              <p>“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”</p>
```

with:

```tsx
              <p>“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”</p>
            ) : caught ? null : ratted ? (
              <p>“Chuột đồng béo vậy, cô lấy hết — đem nướng lu là ngon số một!”</p>
            ) : rats ? (
              <p>“Chưa có lúa, hoa màu, cua ốc hay chuột hả con? Có hàng mang qua, cô trả giá cao!”</p>
            ) : (
              <p>“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”</p>
```

**components/game/farm/RiceDepotPanel.tsx — edit 5 of 5.** Replace:

```tsx
            {critters && <CritterSection mine={mine} catalog={catalog} critters={critters} busy={busy} />}
          </>
```

with:

```tsx
            {critters && <CritterSection mine={mine} catalog={catalog} critters={critters} busy={busy} />}
            {rats && <RatSection mine={mine} rats={rats} busy={busy} />}
          </>
```

**components/game/farm/Stepper.tsx — edit 1 of 3.** Replace:

```tsx

/** − n + and "Tối đa" for a quantity in [min, max]. */
export default function Stepper({ value, min = 1, max, label, unit = "", onChange }: {
  value: number;
```

with:

```tsx

/** − n + and "Tối đa" for a quantity in [min, max]; − and + move it by `by` (v17: pellets go by 10). */
export default function Stepper({ value, min = 1, max, by = 1, label, unit = "", onChange }: {
  value: number;
```

**components/game/farm/Stepper.tsx — edit 2 of 3.** Replace:

```tsx
  max: number;
  /** What is counted, for screen readers ("Số lượng Phân urê"). */
```

with:

```tsx
  max: number;
  by?: number;
  /** What is counted, for screen readers ("Số lượng Phân urê"). */
```

**components/game/farm/Stepper.tsx — edit 3 of 3.** Replace:

```tsx
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="pch-btn px-2" onClick={() => step(-1)} disabled={value <= min} aria-label="Bớt">−</button>
      <span className="min-w-12 text-center" aria-live="polite">{value}{unit}</span>
      <button type="button" className="pch-btn px-2" onClick={() => step(1)} disabled={value >= max} aria-label="Thêm">+</button>
      <button type="button" className="pch-btn text-base" onClick={() => onChange(max)} disabled={value >= max}>Tối đa</button>
```

with:

```tsx
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className="pch-btn px-2" onClick={() => step(-by)} disabled={value <= min} aria-label="Bớt">−</button>
      <span className="min-w-12 text-center" aria-live="polite">{value}{unit}</span>
      <button type="button" className="pch-btn px-2" onClick={() => step(by)} disabled={value >= max} aria-label="Thêm">+</button>
      <button type="button" className="pch-btn text-base" onClick={() => onChange(max)} disabled={value >= max}>Tối đa</button>
```

**components/game/fishing/BagPanel.tsx — edit 1 of 2.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { TANK_CHARGES, TOOL_SICKLE, TOOL_SPRAYER, type CritterKind, type FarmItem } from "@/lib/game/farm/catalog";
import { critterCount, heldBox, lowerFirst, visitsLeft } from "@/lib/game/farm/gather";
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import {
  AMMO_PELLET, FOOD_DOG, TANK_CHARGES, TOOL_SICKLE, TOOL_SLING, TOOL_SPRAYER, type CritterKind, type FarmItem,
} from "@/lib/game/farm/catalog";
import { critterCount, heldBox, lowerFirst, visitsLeft } from "@/lib/game/farm/gather";
```

**components/game/fishing/BagPanel.tsx — edit 2 of 2.** Replace:

```tsx
        })}
      </ul>
```

with:

```tsx
        })}
        {/* v17 §12.4: the ná and the dog food, once the shop sells them (0019) */}
        {items.some((i) => i.id === TOOL_SLING) && (
          <li className="flex items-center gap-2 py-0.5">
            <ItemIcon id={TOOL_SLING} scale={2} />
            <span>{has(TOOL_SLING) ? `Ná — còn ${mine.items[AMMO_PELLET] ?? 0} viên đạn đất` : `Chưa có ná — tiệm anh Hai bán ${priceOf(TOOL_SLING)}`}</span>
          </li>
        )}
        {has(FOOD_DOG) && (
          <li className="flex items-center gap-2 py-0.5">
            <ItemIcon id={FOOD_DOG} scale={2} />
            <span>Thức ăn chó — {mine.items[FOOD_DOG]} bịch</span>
          </li>
        )}
      </ul>
```

**hooks/useFarmController.ts — edit 1 of 5.** Replace:

```ts
  FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NO_PELLETS, NOT_OPEN,
  NOT_OPEN_153, NOT_OPEN_17, pestSnailText, pickingText, produceSaleText, RAT_GONE, ratPrompt, ratSpawnText, riceSaleText,
  slingGear, slingHitText, WORK_EXPIRED, WORK_EXPIRED_TP,
```

with:

```ts
  FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NO_PELLETS, NOT_OPEN,
  NOT_OPEN_153, NOT_OPEN_17, pestSnailText, pickingText, produceSaleText, RAT_GONE, ratPrompt, ratSaleText, ratSpawnText, riceSaleText,
  slingGear, slingHitText, WORK_EXPIRED, WORK_EXPIRED_TP,
```

**hooks/useFarmController.ts — edit 2 of 5.** Replace:

```ts
  sellCritters: (kind: string | null) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
```

with:

```ts
  sellCritters: (kind: string | null) => Promise<boolean>;
  /** cô Út buys my whole rat bag at the prices fixed at the catch (v17 §5.6). */
  sellRats: () => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
```

**hooks/useFarmController.ts — edit 3 of 5.** Replace:

```ts
  // --- due tasks, and the plots on the canvas with my urgent rings
  const tasks = useMemo(() => (state && catalog ? dueTasks(state.plots, accountId, catalog, state.mine, now) : []), [state, catalog, accountId, now]);
  useEffect(() => {
```

with:

```ts
  // --- due tasks, and the plots on the canvas with my urgent rings
  const tasks = useMemo(() => (state && catalog ? dueTasks(state.plots, accountId, catalog, state.mine, now, state.rats?.live ?? []) : []), [state, catalog, accountId, now]);
  useEffect(() => {
```

**hooks/useFarmController.ts — edit 4 of 5.** Replace:

```ts
  }, [sellCatch]);
```

with:

```ts
  }, [sellCatch]);
  const { sellRats: sellBag } = data;
  const sellRats = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await sellBag();
      if (r) live.current.toast(ratSaleText(r.sold.count, r.sold.xu));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [sellBag]);
```

**hooks/useFarmController.ts — edit 5 of 5.** Replace:

```ts
    sellCritters,
    interact,
```

with:

```ts
    sellCritters,
    sellRats,
    interact,
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (3 files, 89 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/FarmShopPanel.tsx components/game/farm/Handbook.tsx components/game/farm/PlotPanel.tsx components/game/farm/RatChip.tsx components/game/farm/RiceDepotPanel.tsx components/game/farm/Stepper.tsx components/game/fishing/BagPanel.tsx hooks/useFarmController.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-rat-panels.test.tsx tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v17): the ná, pellets and dog food in the shops and the bag; the rats on the panels

anh Hai's shop sells the ná once under Nông cụ, and a new "🐾 Đạn & thức ăn chó"
shelf sells pellets by 10 (at most 99 held; the stepper starts at 10, or at what the
coins pay for) and dog food by the bịch. Stepper gains `by`. cô Út's depot shows the
rat bag at the prices fixed at the catch with "Bán hết", today's rat price under it,
her rat intro when only rats are in stock, and "hay chuột" in the empty text; the
controller's sellRats toasts her answer. The bag's Nông cụ names the ná and its
pellets, or where to buy it, and the dog food held. PlotPanel says how many rats eat
a plot and what they took (under 1%, or ~n%, up to 10%), and its handbook link goes
to "Chuột, chó & ná". The handbook shows that tab once the shop sells the ná. The
due tasks list the rats on my plots, and RatChip under the map counts opens the
handbook at the rats while any are live.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/FarmShopPanel.tsx components/game/farm/Handbook.tsx components/game/farm/PlotPanel.tsx components/game/farm/RatChip.tsx components/game/farm/RiceDepotPanel.tsx components/game/farm/Stepper.tsx components/game/fishing/BagPanel.tsx hooks/useFarmController.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-rat-panels.test.tsx tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 18: The README, the other specs' lines, the admin's rat signal and holdings; the final checks

**Files:**
- Modify: `README.md`, `components/admin/AnticheatTab.tsx`, `docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md`, `docs/superpowers/specs/2026-09-25-music-together-economy-design.md`, `docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md`, `docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md`, `lib/admin.ts`
- Test: `tests/integration/v17.test.ts`, `tests/unit/admin-rats.test.ts` (create)

**Interfaces:**
- Consumes: everything of Tasks 1–17; Task 4's `_ac_holdings` keys `dog` and `rats`; the integration tests' environment `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` (never put a value of these in a file).
- Produces: `AnticheatTab`'s `rat_daily_cap` label and the holdings line's rats and dog; `AnticheatHoldings.dog?` and `.rats?`; `tests/integration/v17.test.ts` (§15; skipped without `SUPABASE_TEST_URL`); the README's v17 section; §16's lines in the anti-cheat, v15, v15.2 and economy specs.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/v17.test.ts` with exactly:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// v17's rats and dog end to end, as far as a fresh account can go without xu; the spawns, the damage, the ná, the dog,
// the caps and the prices are covered by tests/sql/v17-smoke.sql. The test project must be in log mode ("Chỉ ghi nhận").
run("v17 rats and the dog", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("chuot"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("đồng"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("gives a fresh account no dog, and refuses what it cannot do yet", async () => {
    const me = await reg();
    const state = await db.rpc("dog_state", { p_session_token: me.token });
    expect(state.error).toBeNull();
    expect(state.data).toMatchObject({ dog: null, food: 0 });
    expect((await db.rpc("feed_dog", { p_session_token: me.token })).error?.message).toBe("no dog");
    expect((await db.rpc("rename_dog", { p_session_token: me.token, p_name: "Mực" })).error?.message).toBe("no dog");
    expect((await db.rpc("adopt_dog", { p_session_token: me.token, p_name: "Mực", p_coat: "muc" })).error?.message)
      .toBe("not enough coins");
    expect((await db.rpc("sell_rats", { p_session_token: me.token })).error?.message).toBe("nothing to sell");
  });

  it("carries the rats in field_state, and keeps the new tables private", async () => {
    const me = await reg();
    const r = await room(me.token);
    const f = await db.rpc("field_state", { p_room_id: r.room_id, p_session_token: me.token });
    expect(f.error).toBeNull();
    const rats = (f.data as { rats: { next_at: string; price: number; live: unknown[] } }).rats;
    expect(Number.isFinite(Date.parse(rats.next_at))).toBe(true);
    expect(rats.price).toBeGreaterThan(0);
    expect(rats.live).toEqual([]);
    expect((await db.rpc("sling_start", { p_room_id: r.room_id, p_session_token: me.token, p_rat_id: 1 })).error?.message)
      .toBe("no sling");
    for (const table of ["dogs", "rat_bag", "sling_aims", "field_rats", "rat_clocks"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
  });
});
```

Create `tests/unit/admin-rats.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { CODE_LABEL, holdingsLine } from "@/components/admin/AnticheatTab";
import { reasonText } from "@/lib/anticheat";
import type { AnticheatHoldings } from "@/lib/admin";

describe("the admin tab, v17 (anti-cheat §12.5)", () => {
  it("names rat_daily_cap, which the player sees as the generic reason", () => {
    expect(CODE_LABEL.rat_daily_cap).toBe("Chạm 24 con chuột/ngày");
    expect(reasonText("rat_daily_cap")).toBe("Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.");
  });

  it("counts the rat bag and names the dog in a wipe's preview", () => {
    const h: AnticheatHoldings = {
      wallet: { coins: 100 }, inventory: [], fish: [], personal_bests: [], rice: [], plots: [], leases: [], offers: [], crops: [],
      drying: [], announcements: 0,
    };
    // before 0019: neither
    expect(holdingsLine(h)).not.toMatch(/chuột|chó/);
    const line = holdingsLine({ ...h, critters: [], rats: { count: 3, value: 486 }, dog: { name: "Mực" } });
    expect(line).toContain("0 con cua ốc · 3 con chuột · chó Mực · 0 thửa sở hữu");
    expect(holdingsLine({ ...h, rats: { count: 0, value: 0 }, dog: null })).toContain("0 con chuột · 0 thửa sở hữu");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/integration/v17.test.ts tests/unit/admin-rats.test.ts`
Expected: FAIL — 2 tests fail (no `rat_daily_cap` label; the holdings line has no rats or dog); the integration file is skipped (2 tests) without `SUPABASE_TEST_URL`.

- [ ] **Step 3: Implement**

**README.md.** Append at the end of the file, after a blank line:

```markdown
## v17: Mùa chuột — chuột đồng, chó cỏ và cái ná

### DB migration

`supabase/migrations/0019_v17_rats.sql` is **additive and re-runnable**: run it in the Supabase SQL Editor after `0018`, so the production order is `0012` → `0014` → `0013` → `0015` → `0016` → `0017` → `0018` → `0019`. It requires `0013`, `0015`, `0016`, `0017` and `0018`, because it re-creates functions they last defined and keeps their parts. It adds:

- `upland_crops.rat_food` (khoai and bắp; rice always, ớt never);
- three items at anh Hai's: `tool_sling` (Ná, 3 000 xu, once), `ammo_pellet` (Đạn đất, 10 xu) and `food_dog` (Thức ăn chó, 150 xu);
- the private tables `field_rats`, `rat_clocks`, `rat_bag`, `dogs` and `sling_aims`, and a rat log on each crop;
- the `coin_ledger` reasons `rat_sell` and `dog_adopt` (the list keeps every earlier reason, `wipe` included);
- 7 guarded RPCs, `sling_start`, `sling_shoot`, `dog_hunt`, `adopt_dog`, `rename_dog`, `feed_dog` and `sell_rats`, and the read-only `dog_state`.

It re-creates the field's opening sweep (the rats' spawn clock), the rice and hoa-màu yields (the rats' share, at most 10 %), `buy_farm_item` (the new kinds), the field state (the rats, the rat bag, the catch caps and the dog), and `_ac_holdings` and `_ac_wipe` (the dog and the rats). `tests/sql/v17-smoke.sql` checks it on a throwaway PostgreSQL cluster after the earlier smokes, which switch the rats off in their rooms (`pg_temp.no_rats`), and ends with `tests/sql/anticheat-guards.sql`, whose loop now calls 59 guarded RPCs. Run every file with plain `psql -f`, never under `psql -1`.

> **Deploy order** (v17 §3): `0019` first, then the v17 client right after. Until the client ships, rats eat ripe crops that cached tabs can neither see nor hunt, and those tabs drop `fa` 11 and 12 and ignore presence's `dog`. Their shop hides the pellets and the dog food but lists the Ná (a `tool`); buying it there is harmless, and it works after a reload. A v17 client that meets a database without `0019` shows no rats and no dog, and its new calls say "Mùa chuột chưa mở — chủ phòng cần chạy migration 0019.".
>
> **Re-running earlier migrations:** `0013`, `0015`, `0016`, `0017` and `0018` put back their own versions of the functions `0019` re-creates, and their `coin_ledger` reason checks lack `rat_sell` and `dog_adopt`. None of them can be re-run as it is once a rat has been sold or a dog adopted. Re-run them in order with `0019` last (anti-cheat §11.3 rule 7).

### What's new in v17

- **Chuột đồng:** while rice, khoai or bắp is ripe, a rat comes out of a bund hole every 10–20 minutes to eat a ripe plot, up to 3 on the field at once. Each rat on a plot eats 2 % of its harvest an hour, and the rats take at most 10 % of a crop. A rat leaves only when it is caught, or when the plot is harvested, handed to the harvester, abandoned or lost. The chip under the map counts shows the season, and the plot panel shows what the rats took.
- **Cái ná:** walk up to a rat and press E. Aim with the mouse or ←/→, hold Space (the mouse button or a finger) to pull the band into the green zone, and let go. Every shot costs one pellet and a 2-second reload, and a hit catches the rat.
- **Chó cỏ:** adopt one at chú Tám's (20 000 xu, one per player) in vàng, mực, vện or đốm, and name it. It follows you on every map, and everyone in the room sees it. Fed (one bịch lasts 24 hours), it pounces on a rat near you once every 5 minutes, as long as you are playing. Pet it for hearts.
- **Cô Út** buys rats at the price fixed at the catch: 150 xu × the room's fish multiplier M. A player catches at most 6 rats an hour and 24 a day.

### Trust model (v17)

The server decides the spawns, which plots the rats eat, the damage, the prices, the caps, and the dog's hunger and cooldown. A client reports a shot's hit or miss, no sooner than 2 s after its last sling answer, and when its dog pounces. A rat is shared by the whole field, so the first catch wins. Rat and dog positions, the slingshot minigame and presence's `dog` are client-side, spoofable and cosmetic. The 24th catch of a day is logged as the soft `rat_daily_cap`.

### Realtime budget (v17)

No new channel. Spawns send nothing: a client on the field refetches at the next spawn time plus 0–10 s, at most once a minute, and only in rat season. A catch sends one `fp`. The slingshot sends `fa 12` every 2 s (7 in a 12 s session), and petting sends one `fa 11`, at most one every 3 s. The dog sends nothing: presence carries its name and coat, re-tracked within the 4-per-30-s budget.
```

**components/admin/AnticheatTab.tsx — edit 1 of 2.** Replace:

```tsx
  gather_daily_cap: "Chạm 200 lượt bắt cua, mò ốc/ngày",
  bad_game: "Sai bàn bài",
```

with:

```tsx
  gather_daily_cap: "Chạm 200 lượt bắt cua, mò ốc/ngày",
  rat_daily_cap: "Chạm 24 con chuột/ngày",
  bad_game: "Sai bàn bài",
```

**components/admin/AnticheatTab.tsx — edit 2 of 2.** Replace:

```tsx
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(produce)} kg hoa màu`, `${count(critters)} con cua ốc`, `${count(h.plots.length)} thửa sở hữu`,
    `${count(h.leases.length)} thửa đang thuê`,
```

with:

```tsx
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(produce)} kg hoa màu`, `${count(critters)} con cua ốc`,
    // v17: the rat bag, and the dog when there is one
    ...(h.rats ? [`${count(h.rats.count)} con chuột`] : []), ...(h.dog ? [`chó ${h.dog.name}`] : []),
    `${count(h.plots.length)} thửa sở hữu`,
    `${count(h.leases.length)} thửa đang thuê`,
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 1 of 14.** Replace:

```markdown
**Source:** the tamper-surface audit of 2026-09-25. Its hole numbers H1–H5 are kept here. The owner's answers to its open questions are §2 (D1–D8).
**Order:** `0014_lyrics_lockdown.sql` (hotfix on `main`) and v15.1 (`0013`) → **anti-cheat (`0015_anticheat.sql`, this doc)** → v15.2 (`0016_v15_2_crops.sql`) → v16 (`0017_v16_cards.sql`) → v15.3 (`0018_v15_3_gather.sql`).
```

with:

```markdown
**Source:** the tamper-surface audit of 2026-09-25. Its hole numbers H1–H5 are kept here. The owner's answers to its open questions are §2 (D1–D8).
**Order:** `0014_lyrics_lockdown.sql` (hotfix on `main`) and v15.1 (`0013`) → **anti-cheat (`0015_anticheat.sql`, this doc)** → v15.2 (`0016_v15_2_crops.sql`) → v16 (`0017_v16_cards.sql`) → v15.3 (`0018_v15_3_gather.sql`) → v17 (`0019_v17_rats.sql`).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 2 of 14.** Replace:

```markdown
| `hole empty`, `bed empty`, `critters full`, `gather daily limit`, `visit not found`, `visit expired`, `too fast` (`crab_finish`, `transplant`), `work expired`, `lease ending`, `no critters`, `invalid kind`, `already owned`, `invalid quantity` (a container with a quantity other than 1) | gathering, `begin_work`, `transplant`, `sell_critters`, `buy_farm_item` (`0018`) | two tabs; a double finish; a lost answer; a backgrounded tab; a room switch; a stale state; **a cached v15.2 client after `0018`** |
| `invalid video`, `video too long`, `duration unknown`, `banned keyword`, `order limit reached` | queue | the rules changed while the UI was stale; two tabs. The queue never strikes (R22). |
```

with:

```markdown
| `hole empty`, `bed empty`, `critters full`, `gather daily limit`, `visit not found`, `visit expired`, `too fast` (`crab_finish`, `transplant`), `work expired`, `lease ending`, `no critters`, `invalid kind`, `already owned`, `invalid quantity` (a container with a quantity other than 1) | gathering, `begin_work`, `transplant`, `sell_critters`, `buy_farm_item` (`0018`) | two tabs; a double finish; a lost answer; a backgrounded tab; a room switch; a stale state; **a cached v15.2 client after `0018`** |
| `rat gone`, `rat limit`, `rat daily limit`, `no aim`, `aim expired`, `too fast` (`sling_shoot`), `no sling`, `no pellets`, `no dog`, `dog hungry`, `dog resting`, `dog full`, `already own dog`, `invalid name`, `invalid coat`, `nothing to sell` | the ná, the dog and `sell_rats` (`0019`) | two tabs; a stale state; a background tab; another hunter or dog first; typing |
| `invalid video`, `video too long`, `duration unknown`, `banned keyword`, `order limit reached` | queue | the rules changed while the UI was stale; two tabs. The queue never strikes (R22). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 3 of 14.** Replace:

```markdown
| `gather_daily_cap` | `crab_start`, `pick_snail_bed` (`0018`) | the visit that brings the Vietnam day's count to 200 | A long honest session can reach it. |
| `kind_mismatch` | `buy_item` | an existing priced item of a non-fishing kind | the old v14 client lists farm items as bait |
| `kind_mismatch` | `buy_farm_item` | an existing priced item that is not a seed, fertilizer, pesticide, (from `0016`) tool or (from `0018`) critter box | catalogs change |
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |
```

with:

```markdown
| `gather_daily_cap` | `crab_start`, `pick_snail_bed` (`0018`) | the visit that brings the Vietnam day's count to 200 | A long honest session can reach it. |
| `rat_daily_cap` | `sling_shoot`, `dog_hunt` (`0019`) | the catch that brings the Vietnam day's count to 24 | A long honest session can reach it. |
| `kind_mismatch` | `buy_item` | an existing priced item of a non-fishing kind | the old v14 client lists farm items as bait |
| `kind_mismatch` | `buy_farm_item` | an existing priced item that is not a seed, fertilizer, pesticide, (from `0016`) tool, (from `0018`) critter box or (from `0019`) ammo or pet food | catalogs change |
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 4 of 14.** Replace:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 52 game RPCs (35 in `0015`, 7 more in `0016`, 6 more in `0017`, 4 more in `0018`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

with:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 59 game RPCs (35 in `0015`, 7 more in `0016`, 6 more in `0017`, 4 more in `0018`, 7 more in `0019`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 5 of 14.** Replace:

```markdown
- **v15.3 (4, `0018`):** `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters`, 52 in all.
```

with:

```markdown
- **v15.3 (4, `0018`):** `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters`, 52 in all.
- **v17 (7, `0019`):** `sling_start`, `sling_shoot`, `dog_hunt`, `adopt_dog`, `rename_dog`, `feed_dog` and `sell_rats`, 59 in all.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 6 of 14.** Replace:

```markdown
1. **A re-created game RPC keeps its guard.** Any `create or replace` of a guarded RPC keeps its `_ac_account`/`_ac_play` call, its hard checks and its explicit grant.
2. **New game RPCs start guarded** (deny by default, R23). For `0016` (v15.2): `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`. The gather RPCs `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters` come with `0018` (v15.3).
   - `crab_finish` with `hits` outside 0–3 is a hard `bad_qty`.
```

with:

```markdown
1. **A re-created game RPC keeps its guard.** Any `create or replace` of a guarded RPC keeps its `_ac_account`/`_ac_play` call, its hard checks and its explicit grant.
2. **New game RPCs start guarded** (deny by default, R23). For `0016` (v15.2): `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`. The gather RPCs `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters` come with `0018` (v15.3). The ná, the dog and the rat sale come with `0019` (v17): `sling_start`, `sling_shoot`, `dog_hunt`, `adopt_dog`, `rename_dog`, `feed_dog` and `sell_rats`; the read-only `dog_state(text)` joins the allowlist.
   - `crab_finish` with `hits` outside 0–3 is a hard `bad_qty`.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 7 of 14.** Replace:

```markdown
   - `_ac_wipe` deletes the account's `critters` and `gather_cooldowns`, and `_ac_holdings` has `critters` (both from `0018`).
4. **A new `coin_ledger` reason check keeps `'wipe'`.** This applies to v15.2's `harvester` and `produce_sell`, v16's `card_hold`, `card_settle`, `card_buyin`, `card_cashout` and `card_refund`, then v15.3's `critter_sell`.
5. **Wider honest inputs widen the hard check.** A migration that widens the range of honest inputs widens the matching hard check in the same migration, and ships before its client.
6. **Every later smoke run ends with `tests/sql/anticheat-guards.sql`.** The dynamic loop in that file gains the new game RPCs, and a new RPC that is not a game action joins its allowlist by signature.
7. **Re-running `0013` after `0015` undoes the guards.** `0013` re-creates the game RPCs and the `coin_ledger` reason check without the anti-cheat parts. After any re-run of `0013`, run `0015` again right away. On a database that has already seen a wipe, `0013`'s reason check (without `'wipe'`) fails, so add `'wipe'` to its list first. Later migrations follow the same order: `0013` → `0015` → the rest. Once `0016` has run, re-running `0013` or `0015` also needs the checks they re-create to accept what later migrations wrote: `0013`'s `shop_items` kind check lacks `tool`, and the `coin_ledger` checks lack `harvester` and `produce_sell` (and `0013`'s also lacks `wipe`). Once `0017` has run, the `coin_ledger` checks of `0013`, `0015` and `0016` also lack its five card reasons, and `0015` and `0016` put back `_ac_holdings` and `_ac_wipe` without the card seats. Once `0018` has run, the `coin_ledger` checks of `0013`, `0015`, `0016` and `0017` also lack `critter_sell`; `0015`, `0016` and `0017` put back `_ac_holdings` and `_ac_wipe` without the critters; and `0013` and `0016` put back `_farm_mine`, `_field_view`, `_farm_do_begin_work`, `_farm_do_pick_snails` and `buy_farm_item`, and `0013` also `_work_gate`, all without v15.3's parts (`_field_view` comes from `0013` alone, and `0015` puts back `buy_farm_item` too). Add those values to the file first (after `0018`, `critter_sell`), then run the whole chain in order with the latest migration last (`0018`). In the SQL Editor a failing script rolls back whole, while under `psql -f` it stops part-way, each statement before the failure already committed (and without `ON_ERROR_STOP` psql runs on past it). A `0017` that fails on its ledger check, for one, has already dropped the check: the ledger is left with no reason check at all, and, run on past the failure, `_ac_holdings` and `_ac_wipe` lose the critters, until `0018` runs again.
```

with:

```markdown
   - `_ac_wipe` deletes the account's `critters` and `gather_cooldowns`, and `_ac_holdings` has `critters` (both from `0018`).
   - `_ac_wipe` deletes the account's `dogs`, `rat_bag` and `sling_aims`, and `_ac_holdings` has `dog` and `rats` (both from `0019`).
4. **A new `coin_ledger` reason check keeps `'wipe'`.** This applies to v15.2's `harvester` and `produce_sell`, v16's `card_hold`, `card_settle`, `card_buyin`, `card_cashout` and `card_refund`, then v15.3's `critter_sell`, then v17's `rat_sell` and `dog_adopt`.
5. **Wider honest inputs widen the hard check.** A migration that widens the range of honest inputs widens the matching hard check in the same migration, and ships before its client.
6. **Every later smoke run ends with `tests/sql/anticheat-guards.sql`.** The dynamic loop in that file gains the new game RPCs, and a new RPC that is not a game action joins its allowlist by signature.
7. **Re-running `0013` after `0015` undoes the guards.** `0013` re-creates the game RPCs and the `coin_ledger` reason check without the anti-cheat parts. After any re-run of `0013`, run `0015` again right away. On a database that has already seen a wipe, `0013`'s reason check (without `'wipe'`) fails, so add `'wipe'` to its list first. Later migrations follow the same order: `0013` → `0015` → the rest. Once `0016` has run, re-running `0013` or `0015` also needs the checks they re-create to accept what later migrations wrote: `0013`'s `shop_items` kind check lacks `tool`, and the `coin_ledger` checks lack `harvester` and `produce_sell` (and `0013`'s also lacks `wipe`). Once `0017` has run, the `coin_ledger` checks of `0013`, `0015` and `0016` also lack its five card reasons, and `0015` and `0016` put back `_ac_holdings` and `_ac_wipe` without the card seats. Once `0018` has run, the `coin_ledger` checks of `0013`, `0015`, `0016` and `0017` also lack `critter_sell`; `0015`, `0016` and `0017` put back `_ac_holdings` and `_ac_wipe` without the critters; and `0013` and `0016` put back `_farm_mine`, `_field_view`, `_farm_do_begin_work`, `_farm_do_pick_snails` and `buy_farm_item`, and `0013` also `_work_gate`, all without v15.3's parts (`_field_view` comes from `0013` alone, and `0015` puts back `buy_farm_item` too). Add those values to the file first (after `0018`, `critter_sell`), then run the whole chain in order with the latest migration last (`0018`). In the SQL Editor a failing script rolls back whole, while under `psql -f` it stops part-way, each statement before the failure already committed (and without `ON_ERROR_STOP` psql runs on past it). A `0017` that fails on its ledger check, for one, has already dropped the check: the ledger is left with no reason check at all, and, run on past the failure, `_ac_holdings` and `_ac_wipe` lose the critters, until `0018` runs again. Re-running `0013`, `0015`, `0016`, `0017` or `0018` after `0019` undoes `0019`'s re-created parts, and their ledger checks lack `rat_sell` and `dog_adopt`, so they fail once a rat is sold or a dog adopted. Re-run them in order with `0019` last.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 8 of 14.** Replace:

```markdown
6. After 7 days, the review (§9.8), then `enforce` in /admin.
7. Later, `0016_v15_2_crops.sql` (v15.2), then `0017_v16_cards.sql` (v16) and `0018_v15_3_gather.sql` (v15.3), keeping the guards (§11.3).
```

with:

```markdown
6. After 7 days, the review (§9.8), then `enforce` in /admin.
7. Later, `0016_v15_2_crops.sql` (v15.2), then `0017_v16_cards.sql` (v16), `0018_v15_3_gather.sql` (v15.3) and `0019_v17_rats.sql` (v17), keeping the guards (§11.3).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 9 of 14.** Replace:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `WARN_LOCK` | `Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.` (v15.3 adds "bắt cua mò ốc", v16 "đánh bài") |
| `WARN_REPEAT` | `Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.` |
```

with:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `WARN_LOCK` | `Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, săn chuột, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.` (v15.3 adds "bắt cua mò ốc", v17 "săn chuột" right after it, v16 "đánh bài") |
| `WARN_REPEAT` | `Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 10 of 14.** Replace:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `BAN_WIPE` | `Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất).` |
| `BAN_OK` | `Đăng xuất` |
```

with:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `BAN_WIPE` | `Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất, chó).` (v17 adds "chó") |
| `BAN_OK` | `Đăng xuất` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 11 of 14.** Replace:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} con cua ốc · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat`, then `· {n} ghế bàn bài ({formatXu(chips + escrow)})` when the account sits at card tables (`0017`); the cua ốc come with `0018` |
| events heading | `Ghi nhận ({n})` |
```

with:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} con cua ốc · {n} con chuột · chó {tên} · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat`, then `· {n} ghế bàn bài ({formatXu(chips + escrow)})` when the account sits at card tables (`0017`); the cua ốc come with `0018`, and the rats and the dog (only when there is one) with `0019` |
| events heading | `Ghi nhận ({n})` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 12 of 14.** Replace:

```markdown
| `gather_daily_cap` (`0018`) | `Chạm 200 lượt bắt cua, mò ốc/ngày` |
| `bad_game` (`0017`) | `Sai bàn bài` |
```

with:

```markdown
| `gather_daily_cap` (`0018`) | `Chạm 200 lượt bắt cua, mò ốc/ngày` |
| `rat_daily_cap` (`0019`) | `Chạm 24 con chuột/ngày` |
| `bad_game` (`0017`) | `Sai bàn bài` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 13 of 14.** Replace:

```markdown
   - every hard signal gives `strike: 1`, committed: a `strike_1` row and `locked_until` ≈ now + 5 min;
   - each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`, 52 from `0018`) then raises `account locked` for that account, with a numeric detail and the hint `anticheat` (the call list is the one in `anticheat-guards.sql`);
   - `fishing_state` has `lock`, and `field_state`, `fishing_board`, `touch_room`, chat and the queue still work;
```

with:

```markdown
   - every hard signal gives `strike: 1`, committed: a `strike_1` row and `locked_until` ≈ now + 5 min;
   - each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`, 52 from `0018`, 59 from `0019`) then raises `account locked` for that account, with a numeric detail and the hint `anticheat` (the call list is the one in `anticheat-guards.sql`);
   - `fishing_state` has `lock`, and `field_state`, `fishing_board`, `touch_room`, chat and the queue still work;
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 14 of 14.** Replace:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`, 52 from `0018`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads (from `0017` also `card_lobby`, `card_state`, `card_hand` and `card_tick`); each must succeed.
```

with:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`, 52 from `0018`, 59 from `0019`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads (from `0017` also `card_lobby`, `card_state`, `card_hand` and `card_tick`); each must succeed.
```

**docs/superpowers/specs/2026-09-25-music-together-economy-design.md.** Replace:

```markdown
- **v15.3** (`2026-09-26-music-together-v15.3-design.md` §7.1, §10): crabs and snails follow M too. Each is priced at the catch at `max(1, floor(base × M))`, with M from `_fish_index` (whose wealth leaves banned accounts out, anti-cheat R30) and no season factor, and stored per critter like a fish. That spec's §10 has the arithmetic: critters stay under fishing at every M.
- **v15 spec §10** points here for the farm numbers. Task 20 also changes the v15 spec §7 land numbers, the §8.1 table and the §9 prices. Its v14 reference, "a skilled angler earns about 1 000–1 800 xu per active hour", holds at M = 1.
```

with:

```markdown
- **v15.3** (`2026-09-26-music-together-v15.3-design.md` §7.1, §10): crabs and snails follow M too. Each is priced at the catch at `max(1, floor(base × M))`, with M from `_fish_index` (whose wealth leaves banned accounts out, anti-cheat R30) and no season factor, and stored per critter like a fish. That spec's §10 has the arithmetic: critters stay under fishing at every M.
- **v17** (`2026-09-26-music-together-v17-rats-design.md` §9): rats are priced with the same M: floor(150 × M), no season factor (v17 §9).
- **v15 spec §10** points here for the farm numbers. Task 20 also changes the v15 spec §7 land numbers, the §8.1 table and the §9 prices. Its v14 reference, "a skilled angler earns about 1 000–1 800 xu per active hour", holds at M = 1.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 1 of 4.** Replace:

```markdown
**Builds on:** `main` @ `cd32174`. That commit has v13 (game mode), v14 (fishing pond, xu economy) and the lyrics/karaoke line from PR #10. v15 is developed on `feat/v15-field`. The stack is unchanged: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth and SECURITY DEFINER RPCs.
**Roadmap:** v13 = game mode + hall → v14 = fishing pond + xu economy → **v15 (this doc) = rice paddies and land (15.1), tools and hoa màu (15.2), crabs and snails (15.3)** → v16 = the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná).
```

with:

```markdown
**Builds on:** `main` @ `cd32174`. That commit has v13 (game mode), v14 (fishing pond, xu economy) and the lyrics/karaoke line from PR #10. v15 is developed on `feat/v15-field`. The stack is unchanged: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth and SECURITY DEFINER RPCs.
**Roadmap:** v13 = game mode + hall → v14 = fishing pond + xu economy → **v15 (this doc) = rice paddies and land (15.1), tools and hoa màu (15.2), crabs and snails (15.3)** → v17 (`2026-09-26-music-together-v17-rats-design.md`) = the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná); v16 became the card corner.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 2 of 4.** Replace:

```markdown
|---|---|---|
| 1 | Version split | v15 = rice + land + crabs/snails; v16 = rat hunt + dog + slingshot (B) |
| 2 | Where land lives | Each room has one shared field map with a fixed set of plots. A plot belongs to an account *in that room*, and everyone sees everyone's rice. Xu and items stay account-wide, as in v14 (A) |
```

with:

```markdown
|---|---|---|
| 1 | Version split | v15 = rice + land + crabs/snails; v17 = rat hunt + dog + slingshot (B; first planned as v16) |
| 2 | Where land lives | Each room has one shared field map with a fixed set of plots. A plot belongs to an account *in that room*, and everyone sees everyone's rice. Xu and items stay account-wide, as in v14 (A) |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 3 of 4.** Replace:

```markdown
      "pests": [{ "kind": "hopper", "since": "…" }],
      "excess_n": false, "ripe": false,    // "ripe" is the v16 rat hook
      "log": { … } | absent                // fert/spray/water logs, only for the farmer
```

with:

```markdown
      "pests": [{ "kind": "hopper", "since": "…" }],
      "excess_n": false, "ripe": false,    // "ripe" was the rat hook; v17 uses _rat_food
      "log": { … } | absent                // fert/spray/water logs, only for the farmer
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 4 of 4.** Replace:

```markdown

- **v16:** the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná). The `ripe` flag in `field_state` is its hook.
- **Not in v15:**
```

with:

```markdown

- **v17:** the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná), in v17 (`2026-09-26-music-together-v17-rats-design.md`). Its hook is `_rat_food`, not the `ripe` flag in `field_state`.
- **Not in v15:**
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 1 of 4.** Replace:

```markdown
| R32 | Every path that pays parts or removes a partly cut crop locks the crop row and re-checks `harvester_until` and `harvested_parts` under the lock: `harvest_part`, the harvester's completion and the lease sweep. Payout, crop deletion and lease end are one transition (§6.5). A hand part during a harvester job is refused (`harvester busy`). | No double payout and no lost part, even if the room-wide plot locks of `_field_open` are relaxed later (anti-cheat R36). |
| R33 | The hoa-màu model follows the rice model's parity conventions (§8.7): epoch-ms times, 15-min samples while t < end, left-to-right products with explicit SQL parentheses, and `floor(x + 0.5)`. | Equal results on both sides, pinned by boundary fixtures (§16). |
```

with:

```markdown
| R32 | Every path that pays parts or removes a partly cut crop locks the crop row and re-checks `harvester_until` and `harvested_parts` under the lock: `harvest_part`, the harvester's completion and the lease sweep. Payout, crop deletion and lease end are one transition (§6.5). A hand part during a harvester job is refused (`harvester busy`). | No double payout and no lost part, even if the room-wide plot locks of `_field_open` are relaxed later (anti-cheat R36). |
| R33 | The hoa-màu model follows the rice model's parity conventions (§8.7): epoch-ms times, 15-min samples while t < end, left-to-right products with explicit SQL parentheses, and `floor(x + 0.5)`. From v17 these conventions cover Mrat in both products. | Equal results on both sides, pinned by boundary fixtures (§16). |
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 2 of 4.** Replace:

```markdown
- At a constant Y the six parts sum to exactly Y. Nếp at full care, Y = 75, pays 12, 13, 12, 13, 12, 13 = 75 kg.
- Nothing locks the yield. Parts cut later in the overripe window give less, and each part is within 1 kg of Y(t)/6. Uncut parts are lost when the crop falls (48 h after the ripe window, sweep step 6) or when its lease runs out (R26).
- **The sixth part completes the harvest.** The crop is deleted, a lease ends, and the plot is bare.
```

with:

```markdown
- At a constant Y the six parts sum to exactly Y. Nếp at full care, Y = 75, pays 12, 13, 12, 13, 12, 13 = 75 kg.
- Nothing locks the yield. Parts cut later in the overripe window, or while rats eat, give less (Y(t) includes Mrat, v17 §5.5), and each part is within 1 kg of Y(t)/6. Uncut parts are lost when the crop falls (48 h after the ripe window, sweep step 6) or when its lease runs out (R26).
- **The sixth part completes the harvest.** The crop is deleted, a lease ends, and the plot is bare.
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 3 of 4.** Replace:

```markdown
Mlate  = 1 − min(0.6, over_rate · max(0, hrs(O_k, t)))
x      = ((((((((base_kg · land) · Mcare) · Mplant) · Mwater) · Mrot) · Mpest) · Mlate) · pct_k) / 100
kg_k   = max(ceil(base_kg · pct_k / 1000), floor(x + 0.5))
```

with:

```markdown
Mlate  = 1 − min(0.6, over_rate · max(0, hrs(O_k, t)))
x      = (((((((((base_kg · land) · Mcare) · Mplant) · Mwater) · Mrot) · Mpest) · Mlate) · Mrat) · pct_k) / 100
kg_k   = max(ceil(base_kg · pct_k / 1000), floor(x + 0.5))
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 4 of 4.** Replace:

```markdown

- **Terms.** `land` is 1.10 on a private plot and 1.00 on a village plot. Every factor is evaluated at the picking time t.
- **`pct_k`** is the picking's integer percentage (40, 35, 25; 100 for one picking). The floor `ceil(base_kg · pct_k / 1000)` is 10 % of that picking's share. SQL computes it as `(base_kg * pct_k + 999) / 1000` (integer division), TS as `Math.ceil(base_kg * pct_k / 1000)` (R31). ớt picking 1: `ceil(60 · 40 / 1000)` = 3 kg.
```

with:

```markdown

- **Terms.** `land` is 1.10 on a private plot and 1.00 on a village plot. Every factor is evaluated at the picking time t. `Mrat` (v17 §5.5) is the share the rats leave; the rice product (v15 §8.6, as §3 leaves it) gains `· Mrat` after `qT`, as its last factor, taken at the cut's time.
- **`pct_k`** is the picking's integer percentage (40, 35, 25; 100 for one picking). The floor `ceil(base_kg · pct_k / 1000)` is 10 % of that picking's share. SQL computes it as `(base_kg * pct_k + 999) / 1000` (integer division), TS as `Math.ceil(base_kg * pct_k / 1000)` (R31). ớt picking 1: `ceil(60 · 40 / 1000)` = 3 kg.
```

**lib/admin.ts.** Replace:

```ts
  critters?: Array<{ kind: string; n: number; xu: number }>;
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
```

with:

```ts
  critters?: Array<{ kind: string; n: number; xu: number }>;
  /** v17 (`0019`): the dog and the rats in the bag; older answers lack them. */
  dog?: { name: string } | null;
  rats?: { count: number; value: number };
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 tests; 1 skipped file (2 tests) without `SUPABASE_TEST_URL`).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/admin/AnticheatTab.tsx lib/admin.ts tests/integration/v17.test.ts tests/unit/admin-rats.test.ts` (clean).

- [ ] **Step 5b: The final checks**

Run `pnpm test` (expected: 129 files passed / 15 skipped (1409 tests passed / 81 skipped)), `pnpm lint` (the 33 baseline problems, none in a file of this plan), `pnpm build` (in a checkout with its own install, with the two test values of Global Constraints when there is no `.env.local`), and the SQL check (`ALL OK`). Scan the lines this plan added for invisible characters (Global Constraints): there must be none.

- [ ] **Step 6: Commit**

Commit message:

```text
docs(v17): README, the other specs' lines, the admin's rat signal and holdings

The README gains the v17 section: 0019, the deploy order (0019 first), re-running
earlier migrations, what is new, the trust model and the realtime budget. The v17
spec's §16 lines go into the other specs:
- anti-cheat: §7.3's refusals, §7.4's rat_daily_cap and the kind_mismatch items, the 59
  guarded RPCs (§9.3), §11.3 rules 2, 3, 4 and 7 (after 0018's lines), §12.2's
  WARN_LOCK and BAN_WIPE, and §12.5's label and holdings line;
- v15: the roadmap and the rat hook;
- v15.2: Mrat in the products and the parts;
- economy: §5.9's rat price.
The admin tab names rat_daily_cap and counts the rat bag and the dog in a wipe's
preview. tests/integration/v17.test.ts checks dog_state, the fresh account's refusals
and field_state's rats (skipped without SUPABASE_TEST_URL).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add README.md components/admin/AnticheatTab.tsx docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md docs/superpowers/specs/2026-09-25-music-together-economy-design.md docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md lib/admin.ts tests/integration/v17.test.ts tests/unit/admin-rats.test.ts
git commit -F <message file>
```

---
