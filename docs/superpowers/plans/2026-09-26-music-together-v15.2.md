# Music Together v15.2 — "Nông cụ & hoa màu" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the field with farm tools and new crops: rice is cut with a sickle in 6 parts (one HarvestGame round each) or by chú Tám's harvester; a sprayer turns a bottle into 3 charges; and raised beds grow khoai lang, bắp and ớt on one data-driven model, sold fresh to cô Út — server-authoritative, behind the anti-cheat guards.

**Architecture:** Migration `0016_v15_2_crops.sql` (sections A–F) adds the `upland_crops` config, the `tool` kind and five items, the crop columns for the kind, the pickings, the cut parts and the harvester, `produce_stock` and the sprayer's tank; the private hoa-màu model `_up_*` (a mirror of `lib/game/farm/upland.ts`, pinned by `tests/fixtures/upland-cases.json`); the locked crop row, the checks, the views and the sweep's step J; and 7 new guarded RPCs, with the farm RPCs it changes re-created from their `0015` bodies. `tests/sql/v15-2-smoke.sql` checks it on a throwaway cluster and ends with the guard file. On the client, the catalog, state and RPC layer read the new fields; `upland.ts` and `partKg` mirror the model; `actions.ts` / `dueTasks` offer the new jobs; `minigames.ts` is the seeded HarvestGame round and `HarvestGame.tsx` its overlay; `useFarmController` drives rounds, harvesters, pickings and the tank; the plot panel, the co-op, the shop, the depot, the bag and the handbook show it all, and the art draws beds, the three crops, the cut strips and the harvester.

**Tech Stack:** Next.js 16.2.9 (App Router, client components), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom + RTL, pnpm 11, PostgreSQL 18 (a throwaway local cluster for the SQL checks).

**Spec:** `docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md` — decisions S1–S15 and H1–H5, rulings R1–R33. Read it before starting any task: every section number below (§…) refers to it unless another spec is named. The anti-cheat spec (`2026-09-25-music-together-anticheat-design.md`) §11.3 rules 1–7 bind every SQL task.

## Global Constraints

- **Start** from `feat/v15-field` at `5442a8b`: v15.1, `0014`, the anti-cheat layer `0015` with its fix round (`de9ae10`: the guard allowlist by signature, `_ac_flag`'s detail caps, `_room_wealth` without banned accounts, the sweep's step 0a for manual bans, `lib/game/overlays.ts`), and `5442a8b` (`_ac_hug` takes the config row first, `subscribeChat` normalizes `system`, the v15.3 spec). Work on the branch the owner names (suggested: `feat/v15.2`, created from that state, in place — no worktree). One commit per task, with the message the task gives; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The messages contain quotes and apostrophes: write each one to a file and commit with `git commit -F <file>`.
- **Package manager pnpm** (`pnpm test`, `pnpm lint`, `pnpm build`). Typecheck: `npx tsc --noEmit` (a checkout that has never run `next build` or `next dev` has no `next-env.d.ts` and fails on the `@/public/logo.png` imports: run either once, or copy `next-env.d.ts` from another checkout). One test file: `pnpm vitest run tests/unit/<file>`.
- **Baseline** (Task 1 records yours): on `5442a8b`, `pnpm test` → 99 files passed / 11 skipped (773 tests passed / 67 skipped), `npx tsc --noEmit` clean, `pnpm lint` 33 pre-existing problems (21 errors, 12 warnings) in 16 files, none of which this plan creates or modifies. After Task 18: 102 files passed / 12 skipped (939 tests passed / 71 skipped); lint unchanged. Every file you create or modify must lint clean: `npx eslint <your files>`.
- **Next.js 16.2.9 is not the Next.js you know** (`AGENTS.md`): before using any Next.js API, read its guide in `node_modules/next/dist/docs/`. This plan adds no route, no config and no Next.js API; its components are client components under the existing `"use client"` shells.
- **React hook lint rules** (eslint-plugin-react-hooks 7, the React Compiler rules): no `ref.current` reads or writes during render, no synchronous `setState` directly in an effect body (callbacks, timers — `setTimeout(fn, 0)` included — `requestAnimationFrame` and promise continuations are fine), no `Date.now()` / `Math.random()` / `performance.now()` during render, and a helper an effect uses lives at module level when it needs nothing from the component. Hooks that drive the canvas take a getter `canvas: () => GameCanvasHandle | null`, never a ref object.
- **Tests:** Vitest runs without globals, so Testing Library does not clean up by itself: every component or hook test file calls `cleanup()` in an `afterEach`. Vitest 4's fake timers also fake `requestAnimationFrame` and `performance.now()`. Pure logic lives in `lib/` with tests in `tests/unit/`; a module a test imports must not reach `@/lib/supabase` unless the test mocks it.
- **Overlays:** every new panel or overlay takes the canvas's input through `lib/game/overlays.ts` (`OpenOverlays`, `overlayLocks`), never through a new inline condition in `GameShell.tsx`. HarvestGame is the one this plan adds (Task 14).
- **UI copy** is Vietnamese; use the strings given in the tasks verbatim (they come from spec §6.2, §11.7 and §13–§14). Numbers in `vi-VN` (`1.500 xu`, via `formatXu` or `toLocaleString("vi-VN")`), decimals with a comma (`3,5 điểm`).
- **Art** is original pixel art drawn in code (string grids and procedural painters), never copied from any game. The repo is public: no copyrighted assets, no secrets.
- **Never type a literal invisible character** (zero-width, bidi control, odd space, combining mark) into a source file: SQL writes them as escapes (`\u200b`), TypeScript as `"\u200b"`.
- **SQL** is additive and re-runnable (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`, seeds `on conflict (id) do update`), every function has `set search_path = public, extensions`, every re-created public RPC keeps its signature and gets an explicit `grant execute … to anon, authenticated`, every private helper gets `revoke all … from public, anon, authenticated`, and every time rule lives in a private function that takes `p_now`. **The anti-cheat rules for later migrations** (anti-cheat spec §11.3) apply: each new game RPC starts guarded with `_ac_account` / `_ac_play` and its hard checks; a re-created guarded RPC keeps its guard, checks and grant; a re-created shared function keeps `0015`'s parts (the sweep's step 0, including step 0a for manual bans, is copied from `0015` as of `de9ae10`); the `coin_ledger` reason check keeps `'wipe'`; `tests/sql/anticheat-guards.sql`'s dynamic loop gains the new RPCs, and a new non-game RPC would join its allowlist by signature (this plan adds none). The owner runs migrations in the Supabase SQL editor — never run anything against a hosted database from here.
- **Local PostgreSQL:** never touch the installed PostgreSQL 18 service, its data directory or port 5432. Tasks 1–5 check the SQL on a throwaway cluster (`initdb --auth=trust`, port **5496**, in your session scratchpad `$SCRATCH`), always with `PGCLIENTENCODING=UTF8`, from the **repo root** (the smokes re-run migrations with `\i` and read `tests/fixtures/*.json` with `\copy`). The cluster mirrors Supabase's grants (`anon` and `authenticated` get every right on each new table and function unless a migration revokes it), and it replays the migrations in the production order: `0004`…`0012`, the v14 smoke (its catch prices hold after `0012` only), `0014`, `0013`, `0015`, then `0016`. Every file runs with plain `psql -f`, **outside any open transaction and never under `psql -1`**: `tests/sql/anticheat-guards.sql` runs its own `begin; … rollback;` self-test. Create the check script once, in Git Bash, as `$SCRATCH/v152-sql.sh` (outside the repository) with:

```bash
#!/usr/bin/env bash
# The SQL check of the v15.2 plan on a throwaway PostgreSQL 18 cluster (trust auth, Supabase's default grants).
# Run it from the repo root:  SCRATCH=<your scratchpad> bash "$SCRATCH/v152-sql.sh"
# Fresh cluster → 0004…0012 → the v14 smoke (it holds after 0012 only) → 0014 → 0013 → 0015 → 0016 twice (the production
# order) → the lyrics, v15, anti-cheat and v15.2 smokes → the v15.2 smoke again. The lyrics smoke runs once (it counts the
# rows it wrote). The v15 smoke's last section re-runs 0013 and the anti-cheat smoke re-runs 0015, which put back their
# own versions of functions 0016 re-creates: the v15.2 smoke re-runs 0016 first. Prints the smokes' "ok" rows and
# ALL OK, or FAILED and the end of the log. Leaves no cluster behind. Every file runs with plain `psql -f`, outside any
# open transaction and never under `psql -1`: tests/sql/anticheat-guards.sql (which the v15.2 smoke ends with) runs its
# own `begin; … rollback;` self-test.
set -u
export PGCLIENTENCODING=UTF8
PORT=5496
PG="/c/Program Files/PostgreSQL/18/bin"
D="$SCRATCH/pg-v152"
LOG="$SCRATCH/v152-sql.log"
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
for f in supabase/migrations/0014_*.sql supabase/migrations/0013_*.sql supabase/migrations/0015_*.sql; do
  "${PSQL[@]}" -f "$f" >>"$LOG" 2>&1 || fail "$f"
done
M=supabase/migrations/0016_v15_2_crops.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M"
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (re-run)"
echo "0016 twice ok"
smoke tests/sql/lyrics-lockdown-smoke.sql
smoke tests/sql/v15-smoke.sql
smoke tests/sql/anticheat-smoke.sql
smoke tests/sql/v15-2-smoke.sql
smoke tests/sql/v15-2-smoke.sql
"$PG/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1; rm -rf "$D"
echo "ALL OK"
```

  `SCRATCH` is your session scratchpad in Git Bash form (for example `/c/Users/<you>/AppData/Local/Temp/claude/<…>/scratchpad`): `export SCRATCH=…` in the shell that runs the script (with `set -u` it stops at once when `SCRATCH` is unset). A `WARNING: "wal_level" is insufficient` from `create publication` and `NOTICE … does not exist, skipping` lines only go to the log. Delete nothing else in `$SCRATCH`; the script removes its own cluster.
- **The repo is public:** never commit a password, a token or a key. The integration tests read `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` from the environment and are skipped without them. Never type a password (account or room) in a browser.
- **Do not start dev servers.** `pnpm build` (Task 18) is the only build; in a checkout without `.env.local`, give it `NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_test_key` (the test values of `vitest.config.ts`).
- **Deploy order** (R28) is the owner's: `0016` first, in the production order `0012` → `0014` → `0013` → `0015` → `0016`, then the v15.2 client as soon as possible after it. Under `0016` a cached v15.1 client cannot harvest rice (`harvest` on rice answers `wrong crop`); the v15.2 client against a database without `0016` treats a missing `upland_crops` as an empty catalog and shows its new RPCs' PGRST202 as `NOT_OPEN_152`.

## Rulings (decisions where the spec is silent, ambiguous or self-contradictory)

- **v15.3 is `0018_v15_3_gather.sql`.** The v15.2 spec's §3 names it `0017`, but `0017` became the v16 card corner (v16 spec C9) and the v15.3 spec names itself `0018`. Task 18's amendments to the v15, anti-cheat and economy specs use `0018`; the v15.2 spec's own header and §3 are the v15.3 spec's amendment and stay as they are.
- **The sweep's step 0 is `0015`'s as of `de9ae10`** (step 0a also clears the listings and offers of accounts banned by hand), copied verbatim into `0016`'s `_field_sweep`; the smoke checks a manual ban there. `0016` re-creates none of `_room_wealth`, `_clean_title`, `_title_key` or `_ac_hug`, and adds no non-game RPC, so the guard allowlist is unchanged.
- **Flag details are capped** with `left(…, 32)` on every client string (`sell_produce`'s upland, `tend_crop`'s act), as `0015`'s checks do since `de9ae10`.
- **`tend_crop` keeps at most 20 entries** in a crop's `work_log` (`too fast` after that): the care model reads every entry, so the log must stay small. An honest farmer needs one per act.
- **`rent_harvester` re-checks the parts:** a plot with 6 parts cut (a stale panel) is `wrong phase`, like an unripe one.
- **The hoa-màu picking's answer** is `harvest: {upland, kg, k, pickings, done}` (the rice part's is `harvest_part: {variety, kg, parts, total, done}`); `harvest: {variety, kg}` stays the whole-rice answer of a database without `0016`.
- **The v15 smoke runs after `0016`:** its header says `0004`–`0016`, its farmer gets the gift's sickle and cuts the rice in six `harvest_part` rounds, and it deletes the tool rows before it re-runs `0013`, whose `shop_items` kind check lacks `tool` (the v15.2 smoke re-runs `0016` first and puts them back). The anti-cheat smoke harvests no rice, so it needs no change (spec §16 names both).
- **Re-running older migrations after `0016`** (README): `0013` cannot be re-run as it is — its kind check lacks `tool` and its ledger check lacks `wipe`, `harvester` and `produce_sell`; `0015`'s ledger check lacks `harvester` and `produce_sell`. Add the missing values to their lists first, run them in order and `0016` last.
- **Texts the spec leaves open:** the rot warnings use the crop's config name ("Tháo nước ngay — khoai lang đang thối củ!"); `pickingText` omits "(lứa k/n)" when a crop has one picking; a bed whose last picking is gone reads "Hết lứa"; a bed's Bỏ vụ warns "Bỏ vụ là mất hết hoa màu trên thửa này." and a partly cut plot's "Bỏ vụ là mất phần lúa chưa gặt."; the task list shows "Bón lót (phân chuồng, phân lân)" on beds before P, nursery included.
- **The round's refusal order** is the server's: ripening (`wrong phase`) → water (`need water`) → sickle (`no sickle`), so the panel's reason matches the toast.
- **"Lên luống trồng màu" always shows** on a bare plot; before `0016` it toasts `NOT_OPEN_152` like the other new actions.
- **A partly cut plot hides "Bắt ốc bươu vàng"** (§6.1 refuses snail picking with `harvesting`).
- **The HarvestGame round (R17):** after an auto-release the sickle waits until it is let go before the next charge (a held key cannot cut two bundles); the outcome comes after the last cut's beat; while "Đang bó lúa…" waits out the 9 s there are no buttons and Esc is ignored (the claim is on its way); a refused claim offers "Thử lại" and "Nghỉ tay".
- **The field's clock ticks every second while any harvester runs** (else every 30 s), so the post labels, the plot panel and the co-op tab count down together.
- **The co-op opens on "Máy gặt"** while a rice plot of mine is ripe or overripe with parts left, a running harvester included.
- **`PlotLook` gains `pickings`** (the pickings gone), so a picked ớt bed redraws.
- **The bag's Nông cụ** shows only when the field state has loaded and the catalog has tools (a database without `0016` has none), and "Nạp" asks first whenever the tank still holds charges, of any pesticide.
- **`holdingsLine` adds `{kg} kg hoa màu` after `kg lúa`** and reads a missing `produce` (an answer from before `0016`) as 0.
- **The rice formula loses `qH`** in the v15 spec's §8.6 (the formula and the factor row), since the harvest minigame multiplies nothing; the anti-cheat spec's §7.4 `kind_mismatch` rows also name `plant_crop` and `load_sprayer`, and its §15.1 counts say "35 in `0015`, 42 from `0016`".

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0016_v15_2_crops.sql` | A config and catalog (`upland_crops`, `shop_items.upland`, kind `tool`, 5 items, the ledger reasons) · B tables (`crops` columns, `produce_stock`, the tank) · C the hoa-màu model `_up_*`, `_part_kg`, `_produce_add` · D the field (`_farm_crop`, `_care_crop`, `_work_check`, `_plot_view`, `_farm_mine`, `_field_sweep` with step J) · E actions and RPCs (`begin_work`, `harvest_part`, `rent_harvester`, `harvest`, care, `claim_farm_gift`, the sprayer, `buy_farm_item`, `sell_produce`, beds) · F `_ac_holdings`, `_ac_wipe` |
| `tests/sql/v15-2-smoke.sql` | the smoke of every section, ending with the guard file; runs twice on one database |
| `tests/fixtures/upland-cases.json`, `tests/fixtures/crop-cases.json` (mod) | the shared model fixtures (§16) |
| `tests/sql/v15-smoke.sql`, `tests/sql/anticheat-guards.sql` (mod) | the gift's sickle, rice cut in 6 parts, the tools out before `0013` re-runs; the 7 new guarded RPCs |
| `lib/game/farm/catalog.ts`, `state.ts`, `rpc.ts` (mod) | `UplandCrop`, the `tool` kind and the v15.2 constants; the new `field_state` fields; the new RPCs and answers |
| `lib/game/farm/upland.ts`, `crop.ts` (mod) | the hoa-màu model mirror and the estimates; `partKg` |
| `lib/game/farm/messages.ts`, `handbook.ts` (mod) | the §11.7 refusals, the toasts, `produceSummary`; the crop tabs and Nông cụ |
| `lib/game/farm/actions.ts`, `land.ts` (mod) | the plot's actions and due tasks for rounds, beds, the tank and the harvester; `harvesterRefusal` |
| `lib/game/farm/minigames.ts` | the seeded HarvestGame round (R17) |
| `lib/game/art/crops.ts`, `farm-icons.ts`, `farm-anim.ts`, `lib/game/engine.ts`, `lib/game/net/protocol.ts` (mod) | beds, the three crops, the cut strips, the harvester and the post labels; 8 icons; `fa` 9 dig and 10 pick |
| `hooks/useField.ts`, `hooks/useFarmController.ts` (mod) | the new calls and `NOT_OPEN_152`; rounds, the harvester refetch, the hand jobs, the toasts, the clock |
| `components/game/farm/HarvestGame.tsx`, `lib/game/overlays.ts` (mod) | the round's overlay (§13.2) and its input lock |
| `components/game/farm/PlotPanel.tsx`, `Handbook.tsx`, `CoopPanel.tsx`, `FarmShopPanel.tsx`, `RiceDepotPanel.tsx`, `FarmOverlays.tsx` (mod) | §13.1, §13.4, §13.5, §14 |
| `components/game/fishing/BagPanel.tsx`, `FishingOverlays.tsx`, `components/game/GameShell.tsx` (mod) | the bag's Nông cụ and Nạp thuốc (R29); the HUD's hoa màu |
| `components/admin/AnticheatTab.tsx`, `lib/admin.ts` (mod) | the holdings line's hoa màu |
| `README.md`, the v15, anti-cheat and economy specs (mod), `tests/integration/v15-2.test.ts` | the v15.2 section; the §3 amendments; spec §16's integration checks |
| `tests/unit/farm-upland.test.ts`, `farm-minigames.test.ts`, `farm-harvest-game.test.tsx` and the other test changes | spec §16 |

## Plan conflict scan (pre-flight, done by the plan author)

- **Validated end to end.** The plan author built every task on a scratch branch from `5442a8b` with one commit per task: tsc clean and each task's tests green after every task, and after each of Tasks 1–5 the SQL check above (`ALL OK`). After Task 18: the full suite (102 files passed / 12 skipped (939 tests passed / 71 skipped)), `pnpm lint` at the 33 baseline problems with none in this plan's files, and `pnpm build`. The code blocks below are generated from those commits, and a mechanical replay of this document on a clean checkout of `5442a8b` — each task's blocks up to Step 2, its Step 2 check failing as stated, then the rest — reproduced every file of every commit, with tsc, the task's tests, its eslint command and the SQL check green after every task, and the final suite and lint as above; `pnpm build` ran on the branch head, whose tree the replay reproduced byte for byte (in the replay's worktree Turbopack refuses a `node_modules` junction that points outside the project). If an edit's "old" text is not found, re-read the file — do not improvise a different change.
- **The base moved twice while this plan was written** (`38814b9` → `de9ae10` → `5442a8b`), and the plan was rebuilt on each. From `de9ae10`: `_field_sweep`'s step 0 is copied from `0015` as it is now (step 0a also covers accounts banned by hand) and the smoke checks that case; flag details are capped with `left(…, 32)`; the guard file's allowlist names signatures, and `0016` adds nothing to it; any new overlay goes through `lib/game/overlays.ts` (HarvestGame, Task 14). `5442a8b` (`_ac_hug`'s lock order, `subscribeChat`'s `system`, the v15.3 spec) touches nothing this plan edits. `feat/v15-field` has since gained `d1acc27` (one new file, the v17 spec), which this plan does not touch either.
- **Files several tasks touch, in order:** `0016_v15_2_crops.sql` (Task 1 creates A–C, Tasks 2–5 append D, E and F); `tests/sql/v15-2-smoke.sql` (Task 1 creates it ending with `\i tests/sql/anticheat-guards.sql`, Tasks 2–5 insert before that line); `tests/sql/v15-smoke.sql` (Tasks 1–3); `tests/sql/anticheat-guards.sql` (Tasks 3–5: 37, 39, then 42 RPCs); `hooks/useFarmController.ts` (Tasks 9, 11, 13, 15); `components/game/farm/FarmOverlays.tsx` (Tasks 13–16); `components/game/GameShell.tsx` (Tasks 14, 17); `lib/game/farm/messages.ts` (Tasks 6, 8); `tests/unit/anticheat-pins.test.tsx` (Tasks 6, 9, 16); `tests/unit/farm-plot-panel.test.tsx` (Tasks 6, 9, 15); `tests/unit/use-farm-controller.test.tsx` (Tasks 9, 13, 15); `tests/unit/farm-overlays.test.tsx` (Tasks 6, 13, 14); `tests/unit/farm-actions.test.ts`, `farm-land.test.ts` (Tasks 6, 9); `farm-handbook.test.ts`, `farm-messages.test.ts` (Tasks 6, 8); `farm-panels.test.tsx` (Tasks 6, 16); `game-crop-art.test.ts` (Tasks 6, 11). Each task's blocks are generated against the file as the previous task left it.
- **The SQL smokes and a re-run of `0013`:** the v15 smoke's last section re-runs `0013` (its tools must leave first, see Rulings) and the anti-cheat smoke re-runs `0015`; both put back their own versions of functions `0016` re-creates, so `tests/sql/v15-2-smoke.sql` re-runs `0016` before its checks, and it runs twice on one database.
- **Nothing ships from here.** The integration tests are skipped without `SUPABASE_TEST_URL` (they were type-checked and linted only); the owner's manual pass (§16) comes after deploy.
- **Spec coverage:** §3 (Task 18), §6.1–§6.5 (Tasks 2, 3, 9, 13, 14, 15, 16), §7 (Tasks 4, 9, 17), §8 (Tasks 1, 5, 7, 9, 15), §9 (Tasks 1, 4, 6, 16), §10 (the config rows of Task 1; the economy spec's pointer, Task 18), §11.1–§11.5 (Tasks 1–5), §11.6 (Tasks 2, 6), §11.7 (Task 8), §12 (Tasks 12, 13), §13.1 (Tasks 9, 15), §13.2 (Tasks 10, 13, 14), §13.3 (Task 9; FarmTasks shows `dueTasks` as it is), §13.4–§13.5 (Tasks 16, 17), §13.6 (Tasks 8, 13, 17), §14 (Tasks 8, 15), §15 (Tasks 11, 12), §16 (every task; the integration part in Task 18).

---

### Task 1: Database — config, catalog, tables and the hoa-màu model (`0016` sections A–C)

**Files:**
- Create: `supabase/migrations/0016_v15_2_crops.sql` (sections A–C)
- Create: `tests/fixtures/upland-cases.json`, `tests/sql/v15-2-smoke.sql` (the model part, ending with `\i tests/sql/anticheat-guards.sql`)
- Modify: `tests/fixtures/crop-cases.json` (two rice cases cut in six parts), `tests/sql/v15-smoke.sql` (the tools leave before it re-runs `0013`)

**Interfaces:**
- Consumes: from `0013`: `crops`, `shop_items(id, kind, name, price, starter, sort_order, variety, fert, pest_target)`, `farm_profiles`, `coin_ledger`, `_plus_h(t, h)`, `_hrs(a, b)`, `_water_at(log, t)`, `_crop_yield(c, v, land, q, t)`; from `0015`: the `coin_ledger` reason list with `'wipe'`.
- Produces (Postgres):
  - **A:** `upland_crops` (id, name, sort_order, method `cutting`/`direct`/`nursery`, plant/transplant/harvest labels, `harvest_anim`, `base_kg`, `price_per_kg`, nursery hours, `stages`, `ripe_water`, `ripe_window_h`, `over_rate`, `lost_after_h`, `pickings`, `pick_gap_h`, rot fields, `cares`, `pests`; RLS with a public select policy) seeded with the §8.8 rows `khoai`, `bap`, `ot`; `shop_items.upland` (a reference to `upland_crops`); the `shop_items` kind check gains `tool`; the items `seed_khoai` 800, `seed_bap` 1 000, `seed_ot` 1 500 (kind `seed`), `tool_sickle` 1 500 and `tool_sprayer` 5 000 (kind `tool`); the `coin_ledger` reasons gain `harvester` and `produce_sell` and keep `wipe`;
  - **B:** `crops.kind` (`rice` | `upland`, default `rice`), `upland`, `plant_at` (P), `work_log` `[{t, act}]`, `harvests` `[{t, k, kg}]`, `harvested_parts` (0–6), `harvested_kg`, `harvester_at`, `harvester_until`; `produce_stock(account_id, upland, kg)` (private); `farm_profiles.tank_item` / `tank_charges` with the check "(null, 0) or (an item, 1–3)" (R21);
  - **C** (private): `_upland(id) → upland_crops`, `_up_hours(u, k)`, `_up_ready(c, u, k) → R_k`, `_up_next(c, u, t)` (0 = none left), `_up_phase(c, u, t)`, `_up_water_ok`, `_up_off_hours(c, u, until)`, `_up_rot_hours(c, u, until)`, `_up_excess_n(c, u, t)`, `_up_care(c, u) → {manure, phosphate, scores[], excess}`, `_up_pests(c, u, now) → [{slot, kind, since, treated_at}]`, `_up_yield(c, u, land, k, now) → {kg, mcare, mplant, mwater, mrot, mpest, mlate}`, `_part_kg(i, y)` (R5), `_produce_add(account, upland, kg)`.
- Produces (smoke): `tests/sql/v15-2-smoke.sql` re-runs `0016` first, sets log mode, defines `pg_temp.err(sql) → text`, replays every `upland-cases.json` case and edge through `_up_phase`, `_up_pests` and `_up_yield` and the rice parts of `crop-cases.json` through `_part_kg`, prints `v15.2 model smoke ok`, and ends with `\i tests/sql/anticheat-guards.sql`. Tasks 2–5 insert their parts before that line.

- [ ] **Step 0: Record the baseline and create the SQL check script**

Run `pnpm test`, `npx tsc --noEmit` and `pnpm lint`, and write down the counts (the plan author's are in Global Constraints). Create `$SCRATCH/v152-sql.sh` from Global Constraints if it does not exist yet.

- [ ] **Step 1: Write the fixtures and the smoke's model part**

Create `tests/fixtures/upland-cases.json` with exactly:

```json
{
  "t0": "2026-03-01T00:00:00Z",
  "crops": [
    {"id": "khoai", "name": "Khoai lang", "sort_order": 10, "method": "cutting", "plant_label": "Trồng dây khoai", "transplant_label": null, "harvest_label": "Đào khoai", "harvest_anim": "dig", "base_kg": 200, "price_per_kg": 265, "nursery_ready_h": null, "nursery_old_h": null, "stages": [{"id": "root", "name": "Bén rễ", "until_h": 6, "water": [1]}, {"id": "vine", "name": "Bò dây", "until_h": 22, "water": [0, 1]}, {"id": "tuber", "name": "Tượng củ", "until_h": 36, "water": [0, 1]}, {"id": "bulk", "name": "Củ lớn", "until_h": 48, "water": [0, 1]}], "ripe_water": [0, 1], "ripe_window_h": 12, "over_rate": 0.02, "lost_after_h": 48, "pickings": [100], "pick_gap_h": null, "rot_from_h": 22, "rot_rate": 0.03, "rot_cap": 0.5, "cares": [{"id": "td", "kind": "fert", "name": "Bón thúc nuôi củ", "items": ["fert_potash", "fert_npk"], "half_items": ["fert_urea"], "from_h": 16, "to_h": 26, "half_from_h": 6, "half_to_h": 36, "pen_half": 0.1, "pen_missing": 0.2}, {"id": "lat_day", "kind": "act", "name": "Lật dây", "items": [], "half_items": [], "from_h": 24, "to_h": 32, "half_from_h": 32, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.1}], "pests": [{"slot": 1, "kind": "weevil", "name": "Sùng khoai", "from_h": 24, "to_h": 40, "chance": 0.4, "dry_mult": 2, "wet_mult": 1, "remedy": "spray_insect"}]},
    {"id": "bap", "name": "Bắp", "sort_order": 20, "method": "direct", "plant_label": "Gieo hạt bắp", "transplant_label": null, "harvest_label": "Bẻ bắp", "harvest_anim": "pick", "base_kg": 150, "price_per_kg": 460, "nursery_ready_h": null, "nursery_old_h": null, "stages": [{"id": "sprout", "name": "Nảy mầm", "until_h": 6, "water": [1]}, {"id": "leaf", "name": "Ra lá", "until_h": 24, "water": [1, 2]}, {"id": "knee", "name": "Xoáy nõn", "until_h": 40, "water": [1, 2]}, {"id": "tassel", "name": "Trổ cờ, phun râu", "until_h": 50, "water": [1, 2]}, {"id": "fill", "name": "Chắc hạt", "until_h": 60, "water": [0, 1]}], "ripe_water": [0, 1], "ripe_window_h": 12, "over_rate": 0.02, "lost_after_h": 48, "pickings": [100], "pick_gap_h": null, "rot_from_h": null, "rot_rate": null, "rot_cap": null, "cares": [{"id": "td1", "kind": "fert", "name": "Bón thúc lần 1 (3–5 lá)", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"], "from_h": 8, "to_h": 16, "half_from_h": 6, "half_to_h": 24, "pen_half": 0.1, "pen_missing": 0.2}, {"id": "vun_goc", "kind": "act", "name": "Vun gốc", "items": [], "half_items": [], "from_h": 16, "to_h": 28, "half_from_h": 28, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.1}, {"id": "td2", "kind": "fert", "name": "Bón thúc lần 2 (trổ cờ)", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 38, "to_h": 46, "half_from_h": 30, "half_to_h": 50, "pen_half": 0.1, "pen_missing": 0.2}], "pests": [{"slot": 1, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 8, "to_h": 24, "chance": 0.35, "dry_mult": 1, "wet_mult": 1, "remedy": "spray_insect"}, {"slot": 2, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 26, "to_h": 44, "chance": 0.35, "dry_mult": 1, "wet_mult": 1, "remedy": "spray_insect"}]},
    {"id": "ot", "name": "Ớt", "sort_order": 30, "method": "nursery", "plant_label": "Ươm hạt ớt", "transplant_label": "Trồng cây ớt con", "harvest_label": "Hái ớt", "harvest_anim": "pick", "base_kg": 60, "price_per_kg": 1590, "nursery_ready_h": 10, "nursery_old_h": 18, "stages": [{"id": "root", "name": "Bén rễ", "until_h": 8, "water": [1]}, {"id": "grow", "name": "Phát triển thân lá", "until_h": 22, "water": [1, 2]}, {"id": "flower", "name": "Ra hoa", "until_h": 34, "water": [1, 2]}, {"id": "fruit", "name": "Đậu trái", "until_h": 46, "water": [1, 2]}], "ripe_water": [0, 1], "ripe_window_h": 8, "over_rate": 0.03, "lost_after_h": 24, "pickings": [40, 35, 25], "pick_gap_h": 12, "rot_from_h": null, "rot_rate": null, "rot_cap": null, "cares": [{"id": "td1", "kind": "fert", "name": "Bón thúc bén rễ", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"], "from_h": 4, "to_h": 12, "half_from_h": 0, "half_to_h": 20, "pen_half": 0.08, "pen_missing": 0.15}, {"id": "td2", "kind": "fert", "name": "Bón thúc ra hoa", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 22, "to_h": 30, "half_from_h": 20, "half_to_h": 40, "pen_half": 0.08, "pen_missing": 0.15}, {"id": "td3", "kind": "fert", "name": "Bón nuôi trái", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"], "from_h": 46, "to_h": 56, "half_from_h": 40, "half_to_h": 64, "pen_half": 0.08, "pen_missing": 0.15}], "pests": [{"slot": 1, "kind": "thrips", "name": "Bọ trĩ", "from_h": 6, "to_h": 24, "chance": 0.4, "dry_mult": 1.5, "wet_mult": 1, "remedy": "spray_insect"}, {"slot": 2, "kind": "anthracnose", "name": "Thán thư", "from_h": 40, "to_h": 64, "chance": 0.4, "dry_mult": 1, "wet_mult": 2, "remedy": "spray_fungus"}]}
  ],
  "cases": [
    {
      "name": "khoai, textbook",
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
      "expect": {"kg": 200, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "khoai left Đẫm for 6 h in tuber",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 51,
      "k": 1,
      "water": [[0, 1], [24, 1], [27, 2], [33, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 154, "mcare": 1.0, "mplant": 1.0, "mwater": 0.94, "mrot": 0.8200000000000001, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "khoai dry at the weevil's due time: a ×2 hit, sprayed 4 h late",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 51,
      "k": 1,
      "water": [[0, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [[37, "spray_insect"]],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.6}],
      "expect": {"kg": 188, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 0.94, "mlate": 1.0, "pests": [{"kind": "weevil", "since_s": 118800, "treated_s": 133200}]}
    },
    {
      "name": "khoai with no lật dây and late kali, on a private plot",
      "upland": "khoai",
      "land": 1.1,
      "sow": null,
      "plant": 1,
      "pick": 51,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [31, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 176, "mcare": 0.8, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "bắp, textbook",
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
      "expect": {"kg": 150, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "bắp with urê at T = 26: excess N, and an armyworm it invited, untreated",
      "upland": "bap",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 63,
      "k": 1,
      "water": [[0, 1], [11, 2], [35, 2]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [11, "fert_urea"], [41, "fert_potash"], [27, "fert_urea"]],
      "work": [[21, "vun_goc"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.9375, "u_hit": 0.45}],
      "expect": {"kg": 96, "mcare": 0.9, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 0.713125, "mlate": 1.0, "pests": [{"kind": "armyworm", "since_s": 157950, "treated_s": null}]}
    },
    {
      "name": "bắp picked 10 h overripe",
      "upland": "bap",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 83,
      "k": 1,
      "water": [[0, 1], [11, 2], [35, 2]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [11, "fert_urea"], [41, "fert_potash"]],
      "work": [[21, "vun_goc"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 120, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 0.8, "pests": []}
    },
    {
      "name": "ớt picking 1, textbook",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 11,
      "pick": 58,
      "k": 1,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [19, "fert_urea"], [37, "fert_potash"], [57, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 24, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "ớt picking 2, thrips treated late",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 11,
      "pick": 71,
      "k": 2,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [19, "fert_urea"], [37, "fert_potash"], [57, "fert_potash"]],
      "work": [],
      "spray": [[31, "spray_insect"]],
      "harvests": [[58, 1, 22]],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.3}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 19, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 0.925, "mlate": 1.0, "pests": [{"kind": "thrips", "since_s": 93600, "treated_s": 111600}]}
    },
    {
      "name": "ớt with old seedlings (transplanted at 24 h), picking 3",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 24,
      "pick": 95,
      "k": 3,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1], [60, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [32, "fert_urea"], [50, "fert_potash"], [70, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [[71, 1, 20], [83, 2, 17]],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 12, "mcare": 1.0, "mplant": 0.8200000000000001, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "ớt with anthracnose in a Đẫm bed, untreated at picking 3",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 11,
      "pick": 82,
      "k": 3,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1], [59, 2], [69, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [19, "fert_urea"], [37, "fert_potash"], [57, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [[58, 1, 24], [69, 2, 18]],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.6}],
      "expect": {"kg": 10, "mcare": 1.0, "mplant": 1.0, "mwater": 0.9, "mrot": 1.0, "mpest": 0.7150000000000001, "mlate": 1.0, "pests": [{"kind": "anthracnose", "since_s": 226800, "treated_s": null}]}
    }
  ],
  "edges": [
    {
      "name": "care: kali at from_h and lật dây at from_h are on time",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_potash"]],
      "work": [[25, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.0, 0.0]}
    },
    {
      "name": "care: 1 s before from_h, kali is half and lật dây missing",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [[17, -1], "fert_potash"]],
      "work": [[[25, -1], "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.1, 0.1]}
    },
    {
      "name": "care: at to_h both are on time",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [27, "fert_potash"]],
      "work": [[33, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.0, 0.0]}
    },
    {
      "name": "care: 1 s after to_h both are half",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [[27, 1], "fert_potash"]],
      "work": [[[33, 1], "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.1, 0.05]}
    },
    {
      "name": "care: kali at half_from_h and lật dây 1 s before half_to_h are half",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [7, "fert_potash"]],
      "work": [[[41, -1], "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.1, 0.05]}
    },
    {
      "name": "care: kali 1 s before half_from_h and lật dây at half_to_h are missing",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [[7, -1], "fert_potash"]],
      "work": [[41, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.2, 0.1]}
    },
    {
      "name": "care: kali 1 s before half_to_h is half",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [[37, -1], "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.1, 0.1]}
    },
    {
      "name": "care: kali at half_to_h is missing",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [37, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.2, 0.1]}
    },
    {
      "name": "care: an N bag at its care's half_to_h is excess",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [37, "fert_urea"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.2, 0.1], "excess": true}
    },
    {
      "name": "care: the same N bag 1 s before is not",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [[37, -1], "fert_urea"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.1, 0.1], "excess": false}
    },
    {
      "name": "care: a second N inside one care's half region is excess",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [11, "fert_urea"], [21, "fert_npk"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"scores": [0.0, 0.1], "excess": true}
    },
    {
      "name": "care: manure at P is wasted",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[1, "fert_manure"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"manure": false, "phosphate": false}
    },
    {
      "name": "care: manure 1 s before P counts",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[[1, -1], "fert_manure"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"manure": true, "phosphate": false}
    },
    {
      "name": "water: 12 h after it was set, one level lower",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 12,
      "k": 1,
      "water": [[0, 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"water": 1}
    },
    {
      "name": "water: 1 s before that, not yet",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": [12, -1],
      "k": 1,
      "water": [[0, 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"water": 2}
    },
    {
      "name": "water: an entry exactly on a sample is read by it",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 3,
      "k": 1,
      "water": [[0, 1], [2, 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"off_hours": 1.0}
    },
    {
      "name": "water: an entry 1 s after a sample is read by the next",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 3,
      "k": 1,
      "water": [[0, 1], [[2, 1], 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"off_hours": 0.75}
    },
    {
      "name": "water: a picking at start + 4 × 15 min counts 4 samples",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 2,
      "k": 1,
      "water": [[0, 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"off_hours": 1.0}
    },
    {
      "name": "water: 1 s later, 5",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": [2, 1],
      "k": 1,
      "water": [[0, 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"off_hours": 1.25}
    },
    {
      "name": "rot: nothing yet at P + rot_from_h",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 23,
      "k": 1,
      "water": [[0, 1], [21, 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"rot_hours": 0.0}
    },
    {
      "name": "rot: the first sample is at P + rot_from_h",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": [23, 1],
      "k": 1,
      "water": [[0, 1], [21, 2]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"rot_hours": 0.25}
    },
    {
      "name": "pests: at due − 1 s the slot is not evaluated",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": [25, -1],
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.3}],
      "expect": {"pests": []}
    },
    {
      "name": "pests: at due it is",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 25,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.3}],
      "expect": {"pests": [{"kind": "weevil", "since_s": 90000, "treated_s": null}]}
    },
    {
      "name": "pests: a 12 h drop landing on due makes the bed Khô (dry ×2)",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 25,
      "k": 1,
      "water": [[0, 1], [13, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.6}],
      "expect": {"pests": [{"kind": "weevil", "since_s": 90000, "treated_s": null}]}
    },
    {
      "name": "pests: set 1 s later, the bed is still Ẩm at due",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 25,
      "k": 1,
      "water": [[0, 1], [[13, 1], 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.6}],
      "expect": {"pests": []}
    },
    {
      "name": "pests: a spray at due treats",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 26,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [[25, "spray_insect"]],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.3}],
      "expect": {"pests": [{"kind": "weevil", "since_s": 90000, "treated_s": 90000}]}
    },
    {
      "name": "pests: a spray 1 s before due does not",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 26,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [[[25, -1], "spray_insect"]],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.3}],
      "expect": {"pests": [{"kind": "weevil", "since_s": 90000, "treated_s": null}]}
    },
    {
      "name": "pickings: R_1 − 1 s is the last stage",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": [49, -1],
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "bulk", "next": 1}
    },
    {
      "name": "pickings: R_1 is ripe",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 49,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "ripe", "next": 1}
    },
    {
      "name": "pickings: O_1 gives Mlate 1",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 61,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "overripe", "kg": 200, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "pickings: O_1 + 1 h gives 1 − over_rate",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 62,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "overripe", "kg": 196, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 0.98, "pests": []}
    },
    {
      "name": "pickings: L_1 − 1 s is still pickable",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": [109, -1],
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "overripe", "next": 1}
    },
    {
      "name": "pickings: L_1 is lost",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 109,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "done", "next": 0}
    },
    {
      "name": "pickings: R_2 − 1 s is waiting",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 11,
      "pick": [69, -1],
      "k": 1,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [[58, 1, 24]],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "waiting", "next": 2}
    },
    {
      "name": "pickings: R_2 is ripe",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 11,
      "pick": 69,
      "k": 1,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [[58, 1, 24]],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "ripe", "next": 2}
    },
    {
      "name": "pickings: an unpicked first picking 1 s before L_1",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 11,
      "pick": [89, -1],
      "k": 1,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "overripe", "next": 1}
    },
    {
      "name": "pickings: at L_1 it is lost and the second takes over",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 11,
      "pick": 89,
      "k": 1,
      "water": [[0, 1], [12, 1], [24, 1], [36, 1], [48, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "overripe", "next": 2}
    },
    {
      "name": "nursery: 1 s before sow + nursery_ready_h the seedlings are too young",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": null,
      "pick": [10, -1],
      "k": 1,
      "water": [[0, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "nursery", "transplant": false}
    },
    {
      "name": "nursery: at sow + nursery_ready_h they may go",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": null,
      "pick": 10,
      "k": 1,
      "water": [[0, 1]],
      "fert": [],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"phase": "nursery", "transplant": true}
    },
    {
      "name": "nursery: a transplant at nursery_old_h keeps Mplant 1",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 18,
      "pick": 65,
      "k": 1,
      "water": [[0, 1], [12, 1], [18, 1], [30, 1], [42, 1], [54, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [26, "fert_urea"], [44, "fert_potash"], [64, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 24, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "nursery: an hour later, 0.97",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 19,
      "pick": 66,
      "k": 1,
      "water": [[0, 1], [12, 1], [19, 1], [31, 1], [43, 1], [55, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [27, "fert_urea"], [45, "fert_potash"], [65, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 23, "mcare": 1.0, "mplant": 0.97, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "caps: 20 off-target hours cost the full 0.2",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 49,
      "k": 1,
      "water": [[0, 1], [7, 2], [19, 2], [27, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 141, "mcare": 1.0, "mplant": 1.0, "mwater": 0.8, "mrot": 0.88, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "caps: a pest active 20 h costs the full 0.3",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 50,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [[45, "spray_insect"]],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.3}],
      "expect": {"kg": 140, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 0.7, "mlate": 1.0, "pests": [{"kind": "weevil", "since_s": 90000, "treated_s": 162000}]}
    },
    {
      "name": "caps: seedlings 10 h old cost the full 0.3",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 28,
      "pick": 75,
      "k": 1,
      "water": [[0, 1], [12, 1], [24, 1], [28, 1], [40, 1], [52, 1], [64, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [36, "fert_urea"], [54, "fert_potash"], [74, "fert_potash"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 17, "mcare": 1.0, "mplant": 0.7, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "caps: 30 h overripe costs the full 0.6",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 91,
      "k": 1,
      "water": [[0, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 80, "mcare": 1.0, "mplant": 1.0, "mwater": 1.0, "mrot": 1.0, "mpest": 1.0, "mlate": 0.4, "pests": []}
    },
    {
      "name": "caps: rot past rot_cap costs rot_cap",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 49,
      "k": 1,
      "water": [[0, 1], [23, 2], [35, 2]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 80, "mcare": 1.0, "mplant": 1.0, "mwater": 0.8, "mrot": 0.5, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "rounding: x = 187.5 on an exact half rounds up",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 51,
      "k": 1,
      "water": [[0, 1], [9, 2], [15.25, 1], [24, 1], [36, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [21, "fert_potash"]],
      "work": [[29, "lat_day"]],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 188, "mcare": 1.0, "mplant": 1.0, "mwater": 0.9375, "mrot": 1.0, "mpest": 1.0, "mlate": 1.0, "pests": []}
    },
    {
      "name": "rounding: ớt picking 1 with every factor at its cap",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 28,
      "pick": 102,
      "k": 1,
      "water": [[0, 1]],
      "fert": [[93, "fert_urea"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0, "u_hit": 0.5}, {"slot": 2, "u_time": 0, "u_hit": 0.3}],
      "expect": {"kg": 3, "mcare": 0.35, "mplant": 0.7, "mwater": 0.8, "mrot": 1.0, "mpest": 0.48999999999999994, "mlate": 0.4, "pests": [{"kind": "thrips", "since_s": 122400, "treated_s": null}, {"kind": "anthracnose", "since_s": 244800, "treated_s": null}]}
    },
    {
      "name": "rounding: ớt picking 2 with every factor at its cap",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 28,
      "pick": 114,
      "k": 2,
      "water": [[0, 1]],
      "fert": [[93, "fert_urea"]],
      "work": [],
      "spray": [],
      "harvests": [[102, 1, 3]],
      "pest_rolls": [{"slot": 1, "u_time": 0, "u_hit": 0.5}, {"slot": 2, "u_time": 0, "u_hit": 0.3}],
      "expect": {"kg": 3, "mcare": 0.35, "mplant": 0.7, "mwater": 0.8, "mrot": 1.0, "mpest": 0.48999999999999994, "mlate": 0.4, "pests": [{"kind": "thrips", "since_s": 122400, "treated_s": null}, {"kind": "anthracnose", "since_s": 244800, "treated_s": null}]}
    },
    {
      "name": "rounding: ớt picking 3 with every factor at its cap",
      "upland": "ot",
      "land": 1,
      "sow": 0,
      "plant": 28,
      "pick": 126,
      "k": 3,
      "water": [[0, 1]],
      "fert": [[93, "fert_urea"]],
      "work": [],
      "spray": [],
      "harvests": [[102, 1, 3], [114, 2, 3]],
      "pest_rolls": [{"slot": 1, "u_time": 0, "u_hit": 0.5}, {"slot": 2, "u_time": 0, "u_hit": 0.3}],
      "expect": {"kg": 2, "mcare": 0.35, "mplant": 0.7, "mwater": 0.8, "mrot": 1.0, "mpest": 0.48999999999999994, "mlate": 0.4, "pests": [{"kind": "thrips", "since_s": 122400, "treated_s": null}, {"kind": "anthracnose", "since_s": 244800, "treated_s": null}]}
    },
    {
      "name": "rounding: khoai with every factor at its cap pays its floor of 20 kg",
      "upland": "khoai",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 91,
      "k": 1,
      "water": [[0, 3], [12, 3], [24, 3], [36, 3]],
      "fert": [[41, "fert_urea"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.0, "u_hit": 0.3}],
      "expect": {"kg": 20, "mcare": 0.5, "mplant": 1.0, "mwater": 0.8, "mrot": 0.5, "mpest": 0.7, "mlate": 0.4, "pests": [{"kind": "weevil", "since_s": 90000, "treated_s": null}]}
    },
    {
      "name": "rounding: bắp with every factor at its cap pays its floor of 15 kg",
      "upland": "bap",
      "land": 1,
      "sow": null,
      "plant": 1,
      "pick": 103,
      "k": 1,
      "water": [[0, 3], [12, 3], [24, 3], [36, 3], [48, 3], [60, 3]],
      "fert": [[29, "fert_urea"]],
      "work": [],
      "spray": [],
      "harvests": [],
      "pest_rolls": [{"slot": 1, "u_time": 0, "u_hit": 0.3}, {"slot": 2, "u_time": 0, "u_hit": 0.3}],
      "expect": {"kg": 15, "mcare": 0.29999999999999993, "mplant": 1.0, "mwater": 0.8, "mrot": 1.0, "mpest": 0.48999999999999994, "mlate": 0.4, "pests": [{"kind": "armyworm", "since_s": 32400, "treated_s": null}, {"kind": "armyworm", "since_s": 97200, "treated_s": null}]}
    }
  ]
}
```

**tests/fixtures/crop-cases.json.** Replace:

```json
      "expect": {"kg": 71, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 0.955, "mlate": 1, "pests": [{"kind": "leaf_folder", "since_s": 82800, "treated_s": 93600}]}
    }
```

with:

```json
      "expect": {"kg": 71, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 0.955, "mlate": 1, "pests": [{"kind": "leaf_folder", "since_s": 82800, "treated_s": 93600}]}
    },
    {
      "name": "nep, village, cut in six parts while overripe",
      "variety": "nep", "land": 1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 73,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 73, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 1, "mlate": 0.98, "pests": []},
      "parts": [[73, 12], [75, 12], [77, 11], [79, 10], [81, 10], [83, 10]]
    },
    {
      "name": "nep, private plot, cut in six parts across the overripe stretch",
      "variety": "nep", "land": 1.1, "q_transplant": 1, "q_harvest": 1,
      "soak": 0, "sow": 3, "transplant": 12, "harvest": 72,
      "water": [[0, 3], [2.5, 2], [2.75, 1], [12, 2], [24, 2], [28, 1], [30.25, 2], [30.5, 3], [52, 1]],
      "fert": [[0.25, "fert_manure"], [0.5, "fert_phosphate"], [17, "fert_urea"], [32, "fert_potash"]],
      "spray": [], "picks": [],
      "pest_rolls": [{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                     {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}],
      "expect": {"kg": 82, "mcare": 1, "mseed": 1, "mwater": 0.9975, "mpest": 1, "mlate": 1, "pests": []},
      "parts": [[72, 13], [80, 12], [88, 10], [96, 7], [104, 5], [112, 6]]
    }
```

Create `tests/sql/v15-2-smoke.sql` with exactly:

```sql
-- tests/sql/v15-2-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0016 (see the plan),
-- from the repo root: it re-runs 0016 with \i, reads tests/fixtures/upland-cases.json and crop-cases.json with \copy,
-- and ends with tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
\set ON_ERROR_STOP on

-- The v15 smoke re-runs 0013 and the anti-cheat smoke re-runs 0015: both put back their own versions of functions 0016
-- re-creates, so 0016 runs again first.
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
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

-- ---------- the config and the model against the shared fixtures (§8, §16) ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/upland-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;
create temp table fxr_raw (n serial, line text);
\copy fxr_raw (line) from 'tests/fixtures/crop-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fxr as select string_agg(line, e'\n' order by n)::jsonb as j from fxr_raw;

-- A fixture time: hours, or [hours, seconds].
create function pg_temp.fx_at(t0 timestamptz, h jsonb) returns timestamptz language sql
as $$
  select t0 + make_interval(secs => case when jsonb_typeof(h) = 'array'
                                         then (h->>0)::double precision * 3600 + (h->>1)::double precision
                                         else (h #>> '{}')::double precision * 3600 end)
$$;

create function pg_temp.fx_log(t0 timestamptz, a jsonb, k text) returns jsonb language sql
as $$ select coalesce(jsonb_agg(jsonb_build_object('t', pg_temp.fx_at(t0, e->0), k, e->1) order by n), '[]'::jsonb)
        from jsonb_array_elements(a) with ordinality w(e, n) $$;

-- A hoa-màu crop row from a fixture case.
create function pg_temp.fx_upcrop(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'kind', 'upland', 'upland', k->>'upland',
  'prepared_at', t0, 'q_transplant', 1, 'picks', '[]'::jsonb, 'harvested_parts', 0, 'harvested_kg', 0,
  'sow_at', case when k->'sow' = 'null' then null else pg_temp.fx_at(t0, k->'sow') end,
  'plant_at', case when k->'plant' = 'null' then null else pg_temp.fx_at(t0, k->'plant') end,
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'work_log', pg_temp.fx_log(t0, k->'work', 'act'), 'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'),
  'harvests', (select coalesce(jsonb_agg(jsonb_build_object('t', pg_temp.fx_at(t0, e->0), 'k', e->1, 'kg', e->2) order by n),
                               '[]'::jsonb)
                 from jsonb_array_elements(k->'harvests') with ordinality w(e, n)),
  'pest_rolls', k->'pest_rolls')) $$;

-- A rice crop row from a crop-cases.json case (as the v15 smoke builds it).
create function pg_temp.fx_rice(t0 timestamptz, k jsonb) returns public.crops language sql
as $$ select jsonb_populate_record(null::public.crops, jsonb_build_object(
  'room_id', gen_random_uuid(), 'plot_no', 5, 'farmer_id', gen_random_uuid(), 'variety', k->>'variety', 'prepared_at', t0,
  'soak_at', pg_temp.fx_at(t0, k->'soak'), 'sow_at', pg_temp.fx_at(t0, k->'sow'),
  'transplant_at', pg_temp.fx_at(t0, k->'transplant'), 'q_transplant', k->'q_transplant',
  'water_log', pg_temp.fx_log(t0, k->'water', 'l'), 'fert_log', pg_temp.fx_log(t0, k->'fert', 'item'),
  'spray_log', pg_temp.fx_log(t0, k->'spray', 'item'), 'picks', '[]'::jsonb, 'pest_rolls', k->'pest_rolls')) $$;

do $$
declare j jsonb := (select j from fx); u public.upland_crops; cr jsonb; cr2 jsonb; prev double precision; v_ids text[];
begin
  -- the seeded rows are the fixtures' config rows, verbatim
  assert (select jsonb_agg(to_jsonb(x) order by x.sort_order) from public.upland_crops x) = j->'crops',
    'upland_crops = the fixtures'' crops';
  -- the §8.2 seed checks
  for u in select * from public.upland_crops loop
    prev := -1;
    for cr in select x from jsonb_array_elements(u.stages) x loop
      assert (cr->>'until_h')::double precision > prev, format('%s: stages in order', u.id);
      assert cr->>'id' not in ('prepared', 'nursery', 'waiting', 'ripe', 'overripe', 'done'), format('%s: stage id %s', u.id, cr->>'id');
      prev := (cr->>'until_h')::double precision;
    end loop;
    assert (select sum(x::int) from jsonb_array_elements_text(u.pickings) x) = 100, format('%s: pickings sum to 100', u.id);
    assert (u.method = 'nursery') = (u.nursery_ready_h is not null and u.nursery_old_h is not null and u.transplant_label is not null),
      format('%s: nursery fields', u.id);
    assert (jsonb_array_length(u.pickings) > 1) = (u.pick_gap_h is not null), format('%s: the gap between pickings', u.id);
    for cr in select x from jsonb_array_elements(u.cares) x loop
      if cr->>'kind' = 'fert' then
        assert (cr->>'half_from_h')::double precision <= (cr->>'from_h')::double precision
           and (cr->>'to_h')::double precision < (cr->>'half_to_h')::double precision, format('%s: %s on time inside half', u.id, cr->>'id');
        assert not exists (select 1 from jsonb_array_elements((cr->'items') || (cr->'half_items')) i
                            where not exists (select 1 from public.shop_items s where s.id = i #>> '{}' and s.kind = 'fertilizer')),
          format('%s: %s items are fertilizers', u.id, cr->>'id');
        for cr2 in select x from jsonb_array_elements(u.cares) x where x->>'kind' = 'fert' and x->>'id' > cr->>'id' loop
          assert (cr->>'half_to_h')::double precision <= (cr2->>'half_from_h')::double precision
              or (cr2->>'half_to_h')::double precision <= (cr->>'half_from_h')::double precision,
            format('%s: %s and %s half regions overlap', u.id, cr->>'id', cr2->>'id');
        end loop;
      else
        assert cr->>'kind' = 'act' and cr->>'id' in ('lat_day', 'vun_goc'), format('%s: act %s', u.id, cr->>'id');
        assert (cr->>'half_from_h')::double precision = (cr->>'to_h')::double precision, format('%s: %s half starts at to_h', u.id, cr->>'id');
      end if;
    end loop;
    select array_agg(x->>'id') into v_ids from jsonb_array_elements(u.cares) x;
    assert cardinality(v_ids) = (select count(distinct x) from unnest(v_ids) x), format('%s: care ids unique', u.id);
    assert not exists (select 1 from jsonb_array_elements(u.pests) p
                        where not exists (select 1 from public.shop_items s where s.id = p->>'remedy' and s.kind = 'pesticide')),
      format('%s: remedies are pesticides', u.id);
    assert (select count(*) from public.shop_items s where s.kind = 'seed' and s.upland = u.id) = 1, format('%s: one seed', u.id);
  end loop;
  assert (select count(*) from public.upland_crops) = 3, 'three crops';
end $$;

do $$
declare j jsonb := (select j from fx); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops; u public.upland_crops;
        t timestamptz; want jsonb; got jsonb; care jsonb; f text; i int; n int := 0;
begin
  for k in select x from jsonb_array_elements((j->'cases') || (j->'edges')) x loop
    n := n + 1;
    c := pg_temp.fx_upcrop(t0, k);
    u := public._upland(k->>'upland');
    t := pg_temp.fx_at(t0, k->'pick');
    want := k->'expect';
    got := '{}'::jsonb;
    if want ? 'phase' then got := got || jsonb_build_object('phase', public._up_phase(c, u, t)); end if;
    if want ? 'next' then got := got || jsonb_build_object('next', public._up_next(c, u, t)); end if;
    if want ? 'water' then got := got || jsonb_build_object('water', public._water_at(c.water_log, t)); end if;
    if want ? 'off_hours' then got := got || jsonb_build_object('off_hours', public._up_off_hours(c, u, t)); end if;
    if want ? 'rot_hours' then got := got || jsonb_build_object('rot_hours', public._up_rot_hours(c, u, t)); end if;
    if want ?| array['scores', 'manure', 'phosphate', 'excess'] then
      care := public._up_care(c, u);
      got := got || jsonb_build_object('scores', care->'scores', 'manure', care->'manure', 'phosphate', care->'phosphate',
                                       'excess', care->'excess');
    end if;
    if want ? 'pests' then
      got := got || jsonb_build_object('pests', (
        select coalesce(jsonb_agg(jsonb_build_object('kind', p->>'kind',
                                                     'since_s', extract(epoch from (p->>'since')::timestamptz - t0)::int,
                                                     'treated_s', extract(epoch from (p->>'treated_at')::timestamptz - t0)::int)
                                  order by (p->>'slot')::int), '[]'::jsonb)
          from jsonb_array_elements(public._up_pests(c, u, t)) p));
    end if;
    if want ? 'transplant' then
      got := got || jsonb_build_object('transplant', public._up_phase(c, u, t) = 'nursery'
                                                     and t >= public._plus_h(c.sow_at, u.nursery_ready_h));
    end if;
    if want ? 'kg' then
      got := got || public._up_yield(c, u, (k->>'land')::double precision, (k->>'k')::int, t);
    end if;
    for f in select jsonb_object_keys(want) loop
      if f in ('mcare', 'mplant', 'mwater', 'mrot', 'mpest', 'mlate', 'off_hours', 'rot_hours') then
        assert abs((got->>f)::double precision - (want->>f)::double precision) < 1e-12,
          format('%s: %s %s, want %s', k->>'name', f, got->f, want->f);
      elsif f = 'scores' then
        assert jsonb_array_length(got->f) = jsonb_array_length(want->f), format('%s: scores %s, want %s', k->>'name', got->f, want->f);
        for i in 0 .. jsonb_array_length(want->f) - 1 loop
          assert abs((got->f->>i)::double precision - (want->f->>i)::double precision) < 1e-12,
            format('%s: scores %s, want %s', k->>'name', got->f, want->f);
        end loop;
      else
        assert got->f = want->f, format('%s: %s %s, want %s', k->>'name', f, got->f, want->f);
      end if;
    end loop;
  end loop;
  assert n = jsonb_array_length(j->'cases') + jsonb_array_length(j->'edges') and jsonb_array_length(j->'cases') = 11,
    format('%s fixtures', n);
end $$;

-- The rice parts (R5): part i pays _part_kg(i, Y) with Y the whole plot's yield at its cut.
do $$
declare j jsonb := (select j from fxr); t0 timestamptz := (j->>'t0')::timestamptz; k jsonb; c public.crops;
        v public.rice_varieties; p jsonb; i int; y int; n int := 0; s int; total int;
begin
  for k in select x from jsonb_array_elements(j->'cases') x where x ? 'parts' loop
    n := n + 1;
    c := pg_temp.fx_rice(t0, k);
    v := public._variety(k->>'variety');
    i := 0;
    for p in select x from jsonb_array_elements(k->'parts') x loop
      i := i + 1;
      y := (public._crop_yield(c, v, (k->>'land')::double precision, 1.0, pg_temp.fx_at(t0, p->0))->>'kg')::int;
      assert public._part_kg(i, y) = (p->>1)::int, format('%s: part %s at %s h, Y %s: %s kg, want %s', k->>'name', i, p->0, y,
                                                           public._part_kg(i, y), p->1);
    end loop;
    assert i = 6, format('%s: six parts', k->>'name');
  end loop;
  assert n = 2, 'two rice cases with parts';
  -- the six parts at a constant Y sum to Y, and after n parts the harvester pays exactly the rest
  assert (select array_agg(public._part_kg(g, 75) order by g) from generate_series(1, 6) g) = array[12, 13, 12, 13, 12, 13], 'Y = 75';
  assert (select array_agg(public._part_kg(g, 99) order by g) from generate_series(1, 6) g) = array[16, 17, 16, 17, 16, 17], 'Y = 99';
  assert (select array_agg(public._part_kg(g, 7) order by g) from generate_series(1, 6) g) = array[1, 1, 1, 1, 1, 2], 'Y = 7';
  for y in 6 .. 200 loop
    assert (select sum(public._part_kg(g, y)) from generate_series(1, 6) g) = y, format('six parts of %s', y);
    for s in 0 .. 5 loop
      select sum(public._part_kg(g, y)) into total from generate_series(s + 1, 6) g;
      assert y - (s * y) / 6 = total, format('the harvester after %s parts of %s', s, y);
    end loop;
  end loop;
end $$;

-- Tables, checks and privileges (§11.2).
do $$
declare a uuid;
begin
  insert into smoke select 't1', token from public.register('smoke152_a_' || floor(random() * 1e9)::text, 'pw123456');
  a := public._auth_account((select v from smoke where k = 't1'));
  insert into smoke values ('a1', a::text);
  -- the tank (R21): empty is (null, 0), loaded is (a pesticide, 1–3)
  insert into public.farm_profiles (account_id) values (a);
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a), 'an empty tank';
  update public.farm_profiles set tank_item = 'spray_insect', tank_charges = 3 where account_id = a;
  assert pg_temp.err(format('update public.farm_profiles set tank_charges = 0 where account_id = %L', a))
         like '%farm_profiles_tank_check%', '(item, 0) is refused';
  assert pg_temp.err(format('update public.farm_profiles set tank_item = null, tank_charges = 2 where account_id = %L', a))
         like '%farm_profiles_tank_check%', '(null, 2) is refused';
  assert pg_temp.err(format('update public.farm_profiles set tank_charges = 4 where account_id = %L', a))
         like '%farm_profiles_tank_check%', 'at most 3';
  -- a crop's kind and its cut parts
  assert pg_temp.err(format('insert into public.crops (room_id, plot_no, farmer_id, kind) values (%L, 1, %L, %L)',
                            gen_random_uuid(), a, 'field')) like '%crops_kind_check%', 'rice or upland';
  assert (select pg_get_constraintdef(oid) like '%harvested_parts >= 0%' and pg_get_constraintdef(oid) like '%harvested_parts <= 6%'
            from pg_constraint where conname = 'crops_parts_check'), 'parts 0–6';
  -- the ledger reasons keep 'wipe' (anti-cheat §11.3 rule 4) and add the harvester and the hoa-màu sale
  assert (select pg_get_constraintdef(oid) like '%''wipe''%' and pg_get_constraintdef(oid) like '%''harvester''%'
                 and pg_get_constraintdef(oid) like '%''produce_sell''%'
            from pg_constraint where conname = 'coin_ledger_reason_check'), 'ledger reasons';
  -- the items (§9)
  assert (select jsonb_agg(jsonb_build_array(id, kind, price, upland, sort_order) order by id) from public.shop_items
           where id in ('seed_khoai', 'seed_bap', 'seed_ot', 'tool_sickle', 'tool_sprayer'))
         = '[["seed_bap", "seed", 1000, "bap", 50], ["seed_khoai", "seed", 800, "khoai", 40], ["seed_ot", "seed", 1500, "ot", 60],
             ["tool_sickle", "tool", 1500, null, 10], ["tool_sprayer", "tool", 5000, null, 20]]', 'the five items';
  -- privileges: the config is public and read-only, the stock is private, the model is private
  assert has_table_privilege('anon', 'public.upland_crops', 'select') and has_table_privilege('authenticated', 'public.upland_crops', 'select')
     and not has_table_privilege('anon', 'public.upland_crops', 'insert, update, delete, truncate')
     and not has_table_privilege('authenticated', 'public.upland_crops', 'insert, update, delete, truncate'), 'upland_crops is read-only';
  assert not has_table_privilege('anon', 'public.produce_stock', 'select')
     and not has_table_privilege('authenticated', 'public.produce_stock', 'select'), 'produce_stock is private';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like '\_up\_%' or p.proname in ('_upland', '_part_kg', '_produce_add'))
                      and has_function_privilege('anon', p.oid, 'execute')), 'the model is private';
end $$;

-- A tank written with the check dropped reads (null, 0) once 0016 runs again, and the check is back.
alter table public.farm_profiles drop constraint farm_profiles_tank_check;
update public.farm_profiles set tank_item = 'spray_insect', tank_charges = 0 where account_id = (select v from smoke where k = 'a1')::uuid;
insert into smoke select 't2', token from public.register('smoke152_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into public.farm_profiles (account_id, tank_item, tank_charges)
select public._auth_account((select v from smoke where k = 't2')), null, 2;
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
reset client_min_messages;
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := public._auth_account((select v from smoke where k = 't2'));
begin
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a1), '(item, 0) → (null, 0)';
  assert (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a2), '(null, 2) → (null, 0)';
  assert exists (select 1 from pg_constraint where conname = 'farm_profiles_tank_check'), 'the check is back';
end $$;

select 'v15.2 model smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/v15-smoke.sql.** Replace:

```sql
end $$;
-- Supabase's default privileges give the API roles every right on a new table (TRUNCATE ignores RLS); this cluster has
```

with:

```sql
end $$;
-- 0016 (v15.2) sells tools, a kind 0013's item check does not know: take them out first (the v15.2 smoke runs 0016 again).
delete from public.inventory i using public.shop_items s where s.id = i.item_id and s.kind = 'tool';
delete from public.shop_items where kind = 'tool';
-- Supabase's default privileges give the API roles every right on a new table (TRUNCATE ignores RLS); this cluster has
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected: `v14 smoke ok`, then `FAILED: supabase/migrations/0016_v15_2_crops.sql` — the migration does not exist yet (`psql: error: supabase/migrations/0016_v15_2_crops.sql: No such file or directory` in the log).

- [ ] **Step 3: Write sections A–C**

Create `supabase/migrations/0016_v15_2_crops.sql` with exactly:

```sql
-- =========================================================
-- 0016_v15_2_crops.sql — v15.2 "Nông cụ & hoa màu" (docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md):
-- the sickle and the 6-part rice harvest, the harvester rental, the sprayer, and three hoa-màu crops (khoai lang, bắp,
-- ớt) on one data-driven model.
-- ADDITIVE (no data drop) and re-runnable. Requires 0013 and 0015 (it re-creates guarded RPCs and anti-cheat helpers and
-- keeps their parts, anti-cheat spec §11.3); does not depend on 0014. Every function relies on
-- `set search_path = public, extensions`. Time rules live in private functions that take p_now; the public RPCs pass
-- now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Config and catalog ----------
-- One row per hoa-màu crop (§8.2): hours count from P (planting, or transplanting for a nursery crop).
create table if not exists public.upland_crops (
  id text primary key,
  name text not null,
  sort_order integer not null default 0,
  method text not null check (method in ('cutting', 'direct', 'nursery')),
  plant_label text not null,
  transplant_label text,
  harvest_label text not null,
  harvest_anim text not null check (harvest_anim in ('dig', 'pick')),
  base_kg integer not null check (base_kg > 0),
  price_per_kg integer not null check (price_per_kg > 0),
  nursery_ready_h double precision,
  nursery_old_h double precision,
  stages jsonb not null,                       -- [{id, name, until_h, water: [levels]}]; the last until_h is ripe_h
  ripe_water jsonb not null,                   -- the levels accepted from ripe_h on
  ripe_window_h double precision not null,
  over_rate double precision not null,
  lost_after_h double precision not null,
  pickings jsonb not null,                     -- the percent of each picking, e.g. [40, 35, 25]
  pick_gap_h double precision,
  rot_from_h double precision,                 -- null: no rot
  rot_rate double precision,
  rot_cap double precision,
  cares jsonb not null default '[]'::jsonb,    -- [{id, kind, name, items, half_items, from_h, to_h, half_from_h, half_to_h,
                                               --   pen_half, pen_missing}]
  pests jsonb not null default '[]'::jsonb     -- [{slot, kind, name, from_h, to_h, chance, dry_mult, wet_mult, remedy}]
);
alter table public.upland_crops enable row level security;
drop policy if exists upland_crops_select on public.upland_crops;
create policy upland_crops_select on public.upland_crops for select to anon using (true);
grant select on public.upland_crops to anon, authenticated;

insert into public.upland_crops (id, name, sort_order, method, plant_label, transplant_label, harvest_label, harvest_anim,
                                 base_kg, price_per_kg, nursery_ready_h, nursery_old_h, stages, ripe_water, ripe_window_h,
                                 over_rate, lost_after_h, pickings, pick_gap_h, rot_from_h, rot_rate, rot_cap, cares, pests) values
  ('khoai', 'Khoai lang', 10, 'cutting', 'Trồng dây khoai', null, 'Đào khoai', 'dig', 200, 265, null, null,
   '[{"id": "root", "name": "Bén rễ", "until_h": 6, "water": [1]}, {"id": "vine", "name": "Bò dây", "until_h": 22, "water": [0, 1]},
     {"id": "tuber", "name": "Tượng củ", "until_h": 36, "water": [0, 1]}, {"id": "bulk", "name": "Củ lớn", "until_h": 48, "water": [0, 1]}]',
   '[0, 1]', 12, 0.02, 48, '[100]', null, 22, 0.03, 0.5,
   '[{"id": "td", "kind": "fert", "name": "Bón thúc nuôi củ", "items": ["fert_potash", "fert_npk"], "half_items": ["fert_urea"],
      "from_h": 16, "to_h": 26, "half_from_h": 6, "half_to_h": 36, "pen_half": 0.10, "pen_missing": 0.20},
     {"id": "lat_day", "kind": "act", "name": "Lật dây", "items": [], "half_items": [],
      "from_h": 24, "to_h": 32, "half_from_h": 32, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.10}]',
   '[{"slot": 1, "kind": "weevil", "name": "Sùng khoai", "from_h": 24, "to_h": 40, "chance": 0.40, "dry_mult": 2, "wet_mult": 1,
      "remedy": "spray_insect"}]'),
  ('bap', 'Bắp', 20, 'direct', 'Gieo hạt bắp', null, 'Bẻ bắp', 'pick', 150, 460, null, null,
   '[{"id": "sprout", "name": "Nảy mầm", "until_h": 6, "water": [1]}, {"id": "leaf", "name": "Ra lá", "until_h": 24, "water": [1, 2]},
     {"id": "knee", "name": "Xoáy nõn", "until_h": 40, "water": [1, 2]},
     {"id": "tassel", "name": "Trổ cờ, phun râu", "until_h": 50, "water": [1, 2]},
     {"id": "fill", "name": "Chắc hạt", "until_h": 60, "water": [0, 1]}]',
   '[0, 1]', 12, 0.02, 48, '[100]', null, null, null, null,
   '[{"id": "td1", "kind": "fert", "name": "Bón thúc lần 1 (3–5 lá)", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"],
      "from_h": 8, "to_h": 16, "half_from_h": 6, "half_to_h": 24, "pen_half": 0.10, "pen_missing": 0.20},
     {"id": "vun_goc", "kind": "act", "name": "Vun gốc", "items": [], "half_items": [],
      "from_h": 16, "to_h": 28, "half_from_h": 28, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.10},
     {"id": "td2", "kind": "fert", "name": "Bón thúc lần 2 (trổ cờ)", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 38, "to_h": 46, "half_from_h": 30, "half_to_h": 50, "pen_half": 0.10, "pen_missing": 0.20}]',
   '[{"slot": 1, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 8, "to_h": 24, "chance": 0.35, "dry_mult": 1, "wet_mult": 1,
      "remedy": "spray_insect"},
     {"slot": 2, "kind": "armyworm", "name": "Sâu keo mùa thu", "from_h": 26, "to_h": 44, "chance": 0.35, "dry_mult": 1, "wet_mult": 1,
      "remedy": "spray_insect"}]'),
  ('ot', 'Ớt', 30, 'nursery', 'Ươm hạt ớt', 'Trồng cây ớt con', 'Hái ớt', 'pick', 60, 1590, 10, 18,
   '[{"id": "root", "name": "Bén rễ", "until_h": 8, "water": [1]}, {"id": "grow", "name": "Phát triển thân lá", "until_h": 22, "water": [1, 2]},
     {"id": "flower", "name": "Ra hoa", "until_h": 34, "water": [1, 2]}, {"id": "fruit", "name": "Đậu trái", "until_h": 46, "water": [1, 2]}]',
   '[0, 1]', 8, 0.03, 24, '[40, 35, 25]', 12, null, null, null,
   '[{"id": "td1", "kind": "fert", "name": "Bón thúc bén rễ", "items": ["fert_urea", "fert_npk"], "half_items": ["fert_potash"],
      "from_h": 4, "to_h": 12, "half_from_h": 0, "half_to_h": 20, "pen_half": 0.08, "pen_missing": 0.15},
     {"id": "td2", "kind": "fert", "name": "Bón thúc ra hoa", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 22, "to_h": 30, "half_from_h": 20, "half_to_h": 40, "pen_half": 0.08, "pen_missing": 0.15},
     {"id": "td3", "kind": "fert", "name": "Bón nuôi trái", "items": ["fert_npk", "fert_potash"], "half_items": ["fert_urea"],
      "from_h": 46, "to_h": 56, "half_from_h": 40, "half_to_h": 64, "pen_half": 0.08, "pen_missing": 0.15}]',
   '[{"slot": 1, "kind": "thrips", "name": "Bọ trĩ", "from_h": 6, "to_h": 24, "chance": 0.40, "dry_mult": 1.5, "wet_mult": 1,
      "remedy": "spray_insect"},
     {"slot": 2, "kind": "anthracnose", "name": "Thán thư", "from_h": 40, "to_h": 64, "chance": 0.40, "dry_mult": 1, "wet_mult": 2,
      "remedy": "spray_fungus"}]')
on conflict (id) do update set
  name = excluded.name, sort_order = excluded.sort_order, method = excluded.method, plant_label = excluded.plant_label,
  transplant_label = excluded.transplant_label, harvest_label = excluded.harvest_label, harvest_anim = excluded.harvest_anim,
  base_kg = excluded.base_kg, price_per_kg = excluded.price_per_kg, nursery_ready_h = excluded.nursery_ready_h,
  nursery_old_h = excluded.nursery_old_h, stages = excluded.stages, ripe_water = excluded.ripe_water,
  ripe_window_h = excluded.ripe_window_h, over_rate = excluded.over_rate, lost_after_h = excluded.lost_after_h,
  pickings = excluded.pickings, pick_gap_h = excluded.pick_gap_h, rot_from_h = excluded.rot_from_h, rot_rate = excluded.rot_rate,
  rot_cap = excluded.rot_cap, cares = excluded.cares, pests = excluded.pests;

-- Hoa-màu seeds are seeds with an upland crop; the sickle and the sprayer are the new kind 'tool' (R20).
alter table public.shop_items add column if not exists upland text references public.upland_crops(id);
alter table public.shop_items drop constraint if exists shop_items_kind_check;
alter table public.shop_items add constraint shop_items_kind_check
  check (kind in ('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool'));

insert into public.shop_items (id, kind, name, price, starter, sort_order, variety, fert, pest_target, upland) values
  ('seed_khoai',   'seed', 'Dây khoai giống',  800, false, 40, null, null, null, 'khoai'),
  ('seed_bap',     'seed', 'Hạt bắp giống',   1000, false, 50, null, null, null, 'bap'),
  ('seed_ot',      'seed', 'Hạt ớt giống',    1500, false, 60, null, null, null, 'ot'),
  ('tool_sickle',  'tool', 'Liềm',            1500, false, 10, null, null, null, null),
  ('tool_sprayer', 'tool', 'Bình phun',       5000, false, 20, null, null, null, null)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, variety = excluded.variety, fert = excluded.fert, pest_target = excluded.pest_target,
  upland = excluded.upland;

-- The config tables are read-only for the API roles (Supabase's default privileges give them every right on a new table).
revoke insert, update, delete, truncate on public.upland_crops from anon, authenticated;

-- The 0015 reasons plus the harvester rental and the hoa-màu sale (anti-cheat §11.3 rule 4 keeps 'wipe').
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell'));

-- ---------- B. Tables ----------
-- Both kinds share the one crop row per plot (R2).
alter table public.crops add column if not exists kind text not null default 'rice';
alter table public.crops drop constraint if exists crops_kind_check;
alter table public.crops add constraint crops_kind_check check (kind in ('rice', 'upland'));
alter table public.crops add column if not exists upland text references public.upland_crops(id);   -- null until planted
alter table public.crops add column if not exists plant_at timestamptz;                               -- P
alter table public.crops add column if not exists work_log jsonb not null default '[]'::jsonb;        -- [{t, act}]
alter table public.crops add column if not exists harvests jsonb not null default '[]'::jsonb;        -- [{t, k, kg}] pickings
alter table public.crops add column if not exists harvested_parts smallint not null default 0;
alter table public.crops drop constraint if exists crops_parts_check;
alter table public.crops add constraint crops_parts_check check (harvested_parts between 0 and 6);
alter table public.crops add column if not exists harvested_kg integer not null default 0;
alter table public.crops add column if not exists harvester_at timestamptz;
alter table public.crops add column if not exists harvester_until timestamptz;

create table if not exists public.produce_stock (
  account_id uuid not null references public.accounts(id) on delete cascade,
  upland text not null references public.upland_crops(id),
  kg integer not null default 0 check (kg >= 0),
  primary key (account_id, upland)
);
alter table public.produce_stock enable row level security;
revoke all on public.produce_stock from anon, authenticated;

-- The sprayer's tank (R21): empty is (null, 0), loaded is (a pesticide, 1–3).
alter table public.farm_profiles add column if not exists tank_item text references public.shop_items(id);
alter table public.farm_profiles add column if not exists tank_charges smallint not null default 0;
update public.farm_profiles set tank_item = null, tank_charges = 0
 where not ((tank_item is null and tank_charges = 0) or (tank_item is not null and tank_charges between 1 and 3));
alter table public.farm_profiles drop constraint if exists farm_profiles_tank_check;
alter table public.farm_profiles add constraint farm_profiles_tank_check
  check ((tank_item is null and tank_charges = 0) or (tank_item is not null and tank_charges between 1 and 3));

-- ---------- C. The hoa-màu model (private, pure given the time; lib/game/farm/upland.ts mirrors it — spec §8) ----------
-- All arithmetic is double precision, in the same order as the TypeScript mirror (§8.7, R33), so both give the same
-- numbers: tests/fixtures/upland-cases.json pins them.

-- An upland crop's config by id.
create or replace function public._upland(p_id text) returns public.upland_crops
language sql stable security definer set search_path = public, extensions
as $$ select * from public.upland_crops where id = p_id $$;

-- Hours from P to picking k's ripe time: ripe_h (the last stage's until_h) + pick_gap_h·(k − 1).
create or replace function public._up_hours(u public.upland_crops, p_k integer) returns double precision
language sql immutable set search_path = public, extensions
as $$
  select (u.stages -> -1 ->> 'until_h')::double precision
         + coalesce(u.pick_gap_h, 0::double precision) * (p_k - 1)::double precision
$$;

-- R_k: picking k is ready (§8.3). O_k and L_k add ripe_window_h, then lost_after_h.
create or replace function public._up_ready(c public.crops, u public.upland_crops, p_k integer) returns timestamptz
language sql stable set search_path = public, extensions
as $$ select public._plus_h(c.plant_at, public._up_hours(u, p_k)) $$;

-- The next picking at t: the lowest one not yet picked and not lost yet (t < L_k); 0 when none is left (or before P).
create or replace function public._up_next(c public.crops, u public.upland_crops, t timestamptz) returns integer
language sql stable set search_path = public, extensions
as $$
  select coalesce((
    select k from generate_series(1, jsonb_array_length(u.pickings)) k
     where not exists (select 1 from jsonb_array_elements(c.harvests) x where (x->>'k')::int = k)
       and t < public._plus_h(c.plant_at, public._up_hours(u, k) + u.ripe_window_h + u.lost_after_h)
     order by k limit 1), 0)
$$;

-- The phase at t (§8.3): prepared, nursery, a stage id, then waiting / ripe / overripe per picking, and done.
create or replace function public._up_phase(c public.crops, u public.upland_crops, t timestamptz) returns text
language plpgsql stable set search_path = public, extensions
as $$
declare v_start timestamptz := coalesce(c.sow_at, c.plant_at); h double precision; st jsonb; k integer;
begin
  if v_start is null or t < v_start then return 'prepared'; end if;
  if c.plant_at is null or t < c.plant_at then return 'nursery'; end if;
  h := public._hrs(c.plant_at, t);
  for st in select x from jsonb_array_elements(u.stages) x loop
    if h < (st->>'until_h')::double precision then return st->>'id'; end if;
  end loop;
  k := public._up_next(c, u, t);
  if k = 0 then return 'done'; end if;
  if t < public._up_ready(c, u, k) then return 'waiting'; end if;
  if t < public._plus_h(c.plant_at, public._up_hours(u, k) + u.ripe_window_h) then return 'ripe'; end if;
  return 'overripe';
end; $$;

-- Does the water at t suit the crop (§8.4)? {1} in the nursery, the stage's levels, ripe_water from ripe_h on, and
-- anything before the first planting action.
create or replace function public._up_water_ok(c public.crops, u public.upland_crops, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare v_start timestamptz := coalesce(c.sow_at, c.plant_at); h double precision; st jsonb;
        l integer := public._water_at(c.water_log, t);
begin
  if v_start is null or t < v_start then return true; end if;
  if c.plant_at is null or t < c.plant_at then return l = 1; end if;
  h := public._hrs(c.plant_at, t);
  for st in select x from jsonb_array_elements(u.stages) x loop
    if h < (st->>'until_h')::double precision then return (st->'water') @> to_jsonb(l); end if;
  end loop;
  return u.ripe_water @> to_jsonb(l);
end; $$;

-- Off-target water hours from the first planting action until p_until: one sample every 15 minutes, 0.25 h per wrong one.
create or replace function public._up_off_hours(c public.crops, u public.upland_crops, p_until timestamptz)
returns double precision
language sql stable set search_path = public, extensions
as $$
  select case when coalesce(c.sow_at, c.plant_at) is null or p_until <= coalesce(c.sow_at, c.plant_at) then 0::double precision
         else (select count(*) filter (where not public._up_water_ok(c, u, t))
                 from generate_series(coalesce(c.sow_at, c.plant_at), p_until - interval '1 microsecond', interval '15 minutes') t
              )::double precision * 0.25::double precision end
$$;

-- Rot hours (§8.4): 15-minute samples from P + rot_from_h until p_until with the bed at Đẫm or Ngập (level ≥ 2).
create or replace function public._up_rot_hours(c public.crops, u public.upland_crops, p_until timestamptz)
returns double precision
language sql stable set search_path = public, extensions
as $$
  select case when u.rot_from_h is null or c.plant_at is null or p_until <= public._plus_h(c.plant_at, u.rot_from_h)
              then 0::double precision
         else (select count(*) filter (where public._water_at(c.water_log, t) >= 2)
                 from generate_series(public._plus_h(c.plant_at, u.rot_from_h), p_until - interval '1 microsecond',
                                      interval '15 minutes') t)::double precision * 0.25::double precision end
$$;

-- Excess nitrogen by t (§8.5, R23): walking the fert log from P in time order, an N bag (urê, NPK) where no fert care's
-- half region [half_from_h, half_to_h) lists it, or a second N inside one care's half region.
create or replace function public._up_excess_n(c public.crops, u public.upland_crops, t timestamptz) returns boolean
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; h double precision; cr jsonb; v_hit text; v_seen text[] := '{}';
begin
  if c.plant_at is null then return false; end if;
  for e in select x from jsonb_array_elements(c.fert_log) with ordinality w(x, n)
            where (x->>'t')::timestamptz >= c.plant_at and (x->>'t')::timestamptz <= t
            order by (x->>'t')::timestamptz, n loop
    if e->>'item' not in ('fert_urea', 'fert_npk') then continue; end if;
    h := public._hrs(c.plant_at, (e->>'t')::timestamptz);
    v_hit := null;
    for cr in select x from jsonb_array_elements(u.cares) x where x->>'kind' = 'fert' loop
      if h >= (cr->>'half_from_h')::double precision and h < (cr->>'half_to_h')::double precision
         and ((cr->'items') ? (e->>'item') or (cr->'half_items') ? (e->>'item')) then
        v_hit := cr->>'id';
        exit;
      end if;
    end loop;
    if v_hit is null or v_hit = any(v_seen) then return true; end if;
    v_seen := v_seen || v_hit;
  end loop;
  return false;
end; $$;

-- Care (§8.5): the base fertilizers before P, then each care row in config order — 0 on time (an items bag, or the act,
-- at T ∈ [from_h, to_h]), pen_half in its half region (an items or half_items bag, or the act, at T ∈ [half_from_h,
-- half_to_h)), else pen_missing; only the best entry counts. {manure, phosphate, scores[], excess}.
create or replace function public._up_care(c public.crops, u public.upland_crops) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare e jsonb; cr jsonb; h double precision; s double precision; v_best double precision; v_fert boolean;
        v_manure boolean := false; v_phos boolean := false; v_scores jsonb := '[]'::jsonb;
begin
  for e in select x from jsonb_array_elements(c.fert_log) x loop
    if c.plant_at is null or (e->>'t')::timestamptz < c.plant_at then
      if e->>'item' = 'fert_manure' then v_manure := true; end if;
      if e->>'item' = 'fert_phosphate' then v_phos := true; end if;
    end if;
  end loop;
  for cr in select x from jsonb_array_elements(u.cares) x loop
    v_best := (cr->>'pen_missing')::double precision;
    v_fert := cr->>'kind' = 'fert';
    if c.plant_at is not null then
      for e in select x from jsonb_array_elements(case when v_fert then c.fert_log else c.work_log end) x loop
        h := public._hrs(c.plant_at, (e->>'t')::timestamptz);
        if v_fert then
          if (cr->'items') ? (e->>'item')
             and h >= (cr->>'from_h')::double precision and h <= (cr->>'to_h')::double precision then
            s := 0;
          elsif ((cr->'items') ? (e->>'item') or (cr->'half_items') ? (e->>'item'))
                and h >= (cr->>'half_from_h')::double precision and h < (cr->>'half_to_h')::double precision then
            s := (cr->>'pen_half')::double precision;
          else
            continue;
          end if;
        else
          if e->>'act' is distinct from cr->>'id' then continue; end if;
          if h >= (cr->>'from_h')::double precision and h <= (cr->>'to_h')::double precision then
            s := 0;
          elsif h >= (cr->>'half_from_h')::double precision and h < (cr->>'half_to_h')::double precision then
            s := (cr->>'pen_half')::double precision;
          else
            continue;
          end if;
        end if;
        v_best := least(v_best, s);
      end loop;
    end if;
    v_scores := v_scores || to_jsonb(v_best);
  end loop;
  return jsonb_build_object('manure', v_manure, 'phosphate', v_phos, 'scores', v_scores,
                            'excess', public._up_excess_n(c, u, 'infinity'::timestamptz));
end; $$;

-- The pests revealed by p_now (§8.6): a slot is due at P + from_h + u_time·(to_h − from_h); its chance at due is ×1.5
-- with excess N by due, × dry_mult on a Khô bed, × wet_mult at Đẫm or more, capped at 0.9; the first spray of its remedy
-- at or after due treats it. [{slot, kind, since, treated_at}]; the rolls never leave the server.
create or replace function public._up_pests(c public.crops, u public.upland_crops, p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare r jsonb; pe jsonb; due timestamptz; p double precision; lvl integer; tr timestamptz; v_out jsonb := '[]'::jsonb;
begin
  if c.plant_at is null or c.pest_rolls is null then return v_out; end if;
  for r in select x from jsonb_array_elements(c.pest_rolls) x order by (x->>'slot')::int loop
    select x into pe from jsonb_array_elements(u.pests) x where (x->>'slot')::int = (r->>'slot')::int;
    if pe is null then continue; end if;
    due := public._plus_h(c.plant_at, (pe->>'from_h')::double precision
                          + (r->>'u_time')::double precision
                            * ((pe->>'to_h')::double precision - (pe->>'from_h')::double precision));
    if due > p_now then continue; end if;
    p := (pe->>'chance')::double precision;
    if public._up_excess_n(c, u, due) then p := p * 1.5::double precision; end if;
    lvl := public._water_at(c.water_log, due);
    if lvl = 0 then p := p * (pe->>'dry_mult')::double precision; end if;
    if lvl >= 2 then p := p * (pe->>'wet_mult')::double precision; end if;
    p := least(0.9::double precision, p);
    if (r->>'u_hit')::double precision >= p then continue; end if;
    select min((x->>'t')::timestamptz) into tr from jsonb_array_elements(c.spray_log) x
     where x->>'item' = pe->>'remedy' and (x->>'t')::timestamptz >= due and (x->>'t')::timestamptz <= p_now;
    v_out := v_out || jsonb_build_array(jsonb_build_object('slot', (r->>'slot')::int, 'kind', pe->>'kind', 'since', due,
                                                           'treated_at', tr));
  end loop;
  return v_out;
end; $$;

-- Picking k at p_now in kg (§8.7), with its factors: every factor at the picking time, the products left to right.
create or replace function public._up_yield(c public.crops, u public.upland_crops, p_land double precision, p_k integer,
                                            p_now timestamptz) returns jsonb
language plpgsql stable set search_path = public, extensions
as $$
declare care jsonb := public._up_care(c, u); s jsonb; pe jsonb; v_pen double precision := 0; v_end timestamptz;
        v_mcare double precision; v_mplant double precision := 1; v_mwater double precision; v_mrot double precision := 1;
        v_mpest double precision := 1; v_mlate double precision; v_x double precision; v_pct integer; v_kg integer;
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
  v_pct := (u.pickings->>(p_k - 1))::int;
  v_x := ((((((((u.base_kg * p_land) * v_mcare) * v_mplant) * v_mwater) * v_mrot) * v_mpest) * v_mlate) * v_pct) / 100;
  v_kg := greatest((u.base_kg * v_pct + 999) / 1000, floor(v_x + 0.5)::integer);
  return jsonb_build_object('kg', v_kg, 'mcare', v_mcare, 'mplant', v_mplant, 'mwater', v_mwater, 'mrot', v_mrot,
                            'mpest', v_mpest, 'mlate', v_mlate);
end; $$;

-- Rice part i (1..6) of a plot yielding y kg: floor(i·y/6) − floor((i − 1)·y/6), so six parts sum to y (R5).
create or replace function public._part_kg(p_i integer, p_y integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select (p_i * p_y) / 6 - ((p_i - 1) * p_y) / 6 $$;

-- Hoa-màu kilograms into the account's produce stock.
create or replace function public._produce_add(p_account uuid, p_upland text, p_kg integer) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.produce_stock (account_id, upland, kg) values (p_account, p_upland, p_kg)
  on conflict (account_id, upland) do update set kg = public.produce_stock.kg + excluded.kg
$$;

revoke all on function public._upland(text) from public, anon, authenticated;
revoke all on function public._up_hours(public.upland_crops, integer) from public, anon, authenticated;
revoke all on function public._up_ready(public.crops, public.upland_crops, integer) from public, anon, authenticated;
revoke all on function public._up_next(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_phase(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_water_ok(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_off_hours(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_rot_hours(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_excess_n(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_care(public.crops, public.upland_crops) from public, anon, authenticated;
revoke all on function public._up_pests(public.crops, public.upland_crops, timestamptz) from public, anon, authenticated;
revoke all on function public._up_yield(public.crops, public.upland_crops, double precision, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function public._part_kg(integer, integer) from public, anon, authenticated;
revoke all on function public._produce_add(uuid, text, integer) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected:

```text
v14 smoke ok
0016 twice ok
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
anticheat guards ok
v15.2 model smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.2): 0016 config, catalog, tables and the hoa-màu model

Sections A–C of 0016_v15_2_crops.sql: upland_crops with the khoai, bắp and ớt rows; the three seeds, the sickle and the
sprayer (kind 'tool'); the harvester and produce_sell ledger reasons; the crops columns for the kind, the pickings, the
cut parts and the harvester; produce_stock; the sprayer's tank; and the private hoa-màu model (phases, water, rot,
care, excess N, pests, yield) with the rice part split. tests/fixtures/upland-cases.json pins the model, crop-cases.json
gains two rice cases cut in six parts, and the v15 smoke takes the tools out before it re-runs 0013.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0016_v15_2_crops.sql tests/fixtures/crop-cases.json tests/fixtures/upland-cases.json tests/sql/v15-2-smoke.sql tests/sql/v15-smoke.sql
git commit -F <message file>
```

---

### Task 2: Database — the field: the locked crop row, the checks, the views and the sweep's step J (`0016` section D)

**Files:**
- Modify: `supabase/migrations/0016_v15_2_crops.sql` (append section D)
- Modify: `tests/sql/v15-2-smoke.sql` (insert the field part before the guard line), `tests/sql/v15-smoke.sql` (its farmer gets a sickle before the harvest)

**Interfaces:**
- Consumes: Task 1's tables and model; from `0013`: `_field_open(room, now)`, `_plot_row(room, plot)`, `_farmer(room, plot, t)`, `_variety(id)`, `_crop_phase(c, v, t)`, `_crop_pests(c, v, t)`, `_rice_add(account, variety, wet, dry)`, `_owns(account, item)`, `_who(account)`, `_field_view(room, account, now)`; from `0015` (as of `de9ae10`): `_field_sweep`'s step 0 (0a, including the manual bans, 0b and 0c) and the 400 000 xu reclaim refund.
- Produces (private, each revoked from the API roles):
  - `_farm_crop(room, plot, account, now) → crops`: `not your plot` unless the account farms the plot, `not prepared` without a crop row, `harvester busy` while a harvester runs; the row is locked `for update` (R32);
  - `_care_crop(room, plot, account, now) → crops`: `_farm_crop`, then `harvesting` while 0 < parts (R8);
  - `_work_check(c, v, work, now)`: rice as in `0013` plus `no sickle` for a harvest round; beds: an ớt transplant needs the nursery ≥ `nursery_ready_h` old at Ẩm (`wrong crop` / `wrong phase` / `need water`), a picking needs the next picking ready and the bed ≤ Ẩm;
  - `_plot_view(room, plot, viewer, now)`: the crop gains `kind`, `upland`, `plant_at`, `picking`, `pickings`, `parts`, `harvester {started_at, ends_at}`, and for its farmer `log.work`, `log.harvests`, `log.harvested_kg`;
  - `_farm_mine(account)`: `items` also lists tools; `produce {upland: kg}`; `tank {item, charges}` while the account owns the sprayer, else null;
  - `_field_sweep(room, now)`: step 0 exactly as `0015`, then **step J** (a finished harvester pays `Y − floor(n·Y/6)` at `harvester_until` to a farmer who still farmed the plot when the job started, ends the lease, and removes the crop), then steps 1–7; step 6 skips a running harvester and drops hoa màu whose last picking is lost.
- Produces (smoke): the field part (room `Nông cụ`, keys `t3`, `t4`, `a2`–`a4`, `room`, `now`; `pg_temp.set_coins`, `pg_temp.plot`, `pg_temp.crop`, `pg_temp.wc`, `pg_temp.ripe_nep`, `pg_temp.wet`), printing `v15.2 field smoke ok`.

- [ ] **Step 1: Write the smoke's field part**

**tests/sql/v15-2-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- the field (§6.4, §6.5, §11.6): the crop row, the checks, the views, the sweep ----------
insert into smoke select 't3', token from public.register('smoke152_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't4', token from public.register('smoke152_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'a4', public._auth_account((select v from smoke where k = 't4'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Nông cụ', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
  from smoke where k in ('t2', 't3', 't4');
insert into smoke select 'now', date_trunc('minute', now())::text;
create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.plot(s jsonb, n integer) returns jsonb language sql as $$ select s->'plots'->(n - 1) $$;
create function pg_temp.crop(r uuid, n integer) returns public.crops language sql
as $$ select * from public.crops where room_id = r and plot_no = n $$;
-- The work check of plot n's crop as it is now.
create function pg_temp.wc(r uuid, n integer, w text, t timestamptz) returns void language plpgsql as $$
declare c public.crops := pg_temp.crop(r, n);
begin
  perform public._work_check(c, public._variety(c.variety), w, t);
end $$;
-- A ripe nếp crop on plot n (transplanted 50 h before t, drained 5 h before t): ripe until t + 10 h.
create function pg_temp.ripe_nep(r uuid, n integer, a uuid, t timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
      values (r, n, a, 'nep', t - interval '64 hours', t - interval '63 hours', t - interval '60 hours', t - interval '50 hours',
              jsonb_build_array(jsonb_build_object('t', t - interval '64 hours', 'l', 3),
                                jsonb_build_object('t', t - interval '5 hours', 'l', 1))) $$;
-- The wet rice of an account.
create function pg_temp.wet(a uuid) returns integer language sql
as $$ select coalesce((select sum(wet_kg)::int from public.rice_stock where account_id = a), 0) $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; c jsonb;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform public._farm_do_rent(room, a1, 5, t);
  perform public._farm_do_rent(room, a1, 6, t);
  -- a rice round (§6.2): ripe, drained, and a sickle in the bag
  perform pg_temp.ripe_nep(room, 5, a1, t);
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t - interval '3 hours')) = 'wrong phase', 'not ripe';
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t)) = 'no sickle', 'a sickle';
  insert into public.inventory (account_id, item_id, qty) values (a1, 'tool_sickle', 1);
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t)) is null, 'a round may start';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t, 'l', 2))
   where room_id = room and plot_no = 5;
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'harvest', t)) = 'need water', 'drained first';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t, 'l', 1))
   where room_id = room and plot_no = 5;
  assert pg_temp.err(format('select pg_temp.wc(%L, 5, %L, %L)', room, 'dig', t)) = 'invalid work', 'two works';
  -- the row is locked for the call; a partly cut plot takes a round but no care (R8); a running harvester takes nothing
  assert (select provolatile = 'v' from pg_proc where proname = '_farm_crop' and pronamespace = 'public'::regnamespace),
    '_farm_crop locks, so it is volatile';
  update public.crops set harvested_parts = 2, harvested_kg = 25 where room_id = room and plot_no = 5;
  assert (public._farm_crop(room, 5, a1, t)).harvested_parts = 2, 'a partly cut plot';
  assert pg_temp.err(format('select public._care_crop(%L, 5, %L, %L)', room, a1, t)) = 'harvesting', 'no care while cutting';
  update public.crops set harvester_at = t, harvester_until = t + interval '30 seconds' where room_id = room and plot_no = 5;
  assert pg_temp.err(format('select public._farm_crop(%L, 5, %L, %L)', room, a1, t)) = 'harvester busy', 'a running harvester';
  -- the view (§11.6): the kind, the parts and the harvester; the logs for the farmer only
  s := public._field_view(room, a1, t);
  c := pg_temp.plot(s, 5)->'crop';
  assert c->>'kind' = 'rice' and c->>'variety' = 'nep' and c->'upland' = 'null' and c->>'phase' = 'ripe' and c->'parts' = '2'
     and c->'picking' = 'null' and c->'pickings' = '1' and c->'plant_at' = 'null'
     and c->'harvester' = jsonb_build_object('started_at', t, 'ends_at', t + interval '30 seconds'), format('rice %s', c);
  assert c->'log'->'harvested_kg' = '25' and c->'log'->'work' = '[]' and c->'log'->'harvests' = '[]', format('the log %s', c->'log');
  assert pg_temp.plot(public._field_view(room, a3, t), 5)->'crop'->'log' is null, 'no log for a neighbour';

  -- beds on plot 6: nothing planted, then an ớt nursery
  insert into public.crops (room_id, plot_no, farmer_id, kind, prepared_at, water_log)
  values (room, 6, a1, 'upland', t, jsonb_build_array(jsonb_build_object('t', t, 'l', 1)));
  c := pg_temp.plot(public._field_view(room, a1, t), 6)->'crop';
  assert c->>'kind' = 'upland' and c->'upland' = 'null' and c->>'phase' = 'prepared' and c->'picking' = 'null'
     and c->'pickings' = '0' and c->'parts' = '0' and c->'harvester' = 'null' and c->'pests' = '[]' and c->'water' = '1',
    format('bare beds %s', c);
  update public.crops set upland = 'ot', sow_at = t,
         pest_rolls = '[{"slot": 1, "u_time": 0, "u_hit": 0.1}, {"slot": 2, "u_time": 0, "u_hit": 0.99}]'
   where room_id = room and plot_no = 6;
  c := pg_temp.plot(public._field_view(room, a1, t + interval '1 hour'), 6)->'crop';
  assert c->>'upland' = 'ot' and c->>'phase' = 'nursery' and c->'picking' = '1' and c->'pickings' = '3'
     and (c->>'sow_at')::timestamptz = t and c->'plant_at' = 'null', format('the nursery %s', c);
  assert pg_temp.plot(public._field_view(room, a1, t), 6)::text not like '%u_hit%', 'the rolls stay secret';
  -- the ớt transplant (§8.9): ≥ nursery_ready_h old, on an Ẩm bed
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '9 hours 59 minutes 59 seconds'))
         = 'wrong phase', 'the seedlings are too young';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '10 hours')) is null, 'ready';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '12 hours')) = 'need water',
    'the bed dried to Khô at 12 h';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '10 hours')) = 'wrong phase',
    'nothing to pick in the nursery';
  -- transplanted at 11 h: the pests fire from P, the view counts the pickings from P
  update public.crops set plant_at = t + interval '11 hours',
         water_log = water_log || jsonb_build_array(jsonb_build_object('t', t + interval '11 hours', 'l', 1))
   where room_id = room and plot_no = 6;
  c := pg_temp.plot(public._field_view(room, a1, t + interval '18 hours'), 6)->'crop';
  assert c->>'phase' = 'root' and c->'picking' = '1' and c->'pests' = jsonb_build_array(jsonb_build_object(
           'kind', 'thrips', 'since', t + interval '17 hours', 'treated_at', null)), format('ớt at 18 h %s', c);
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'transplant', t + interval '18 hours')) = 'wrong phase',
    'transplanted once';
  -- a picking (§8.9): the next picking ready, the bed at most Ẩm
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t + interval '57 hours', 'l', 2))
   where room_id = room and plot_no = 6;
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '56 hours 59 minutes 59 seconds'))
         = 'wrong phase', 'R_1 − 1 s';
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '57 hours')) = 'need water', 'Đẫm';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t + interval '57 hours', 'l', 1))
   where room_id = room and plot_no = 6;
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '57 hours')) is null, 'R_1';
  update public.crops set harvests = jsonb_build_array(jsonb_build_object('t', t + interval '57 hours', 'k', 1, 'kg', 24))
   where room_id = room and plot_no = 6;
  c := pg_temp.plot(public._field_view(room, a1, t + interval '58 hours'), 6)->'crop';
  assert c->>'phase' = 'waiting' and c->'picking' = '2' and c->'log'->'harvests'->0->'kg' = '24', format('after picking 1 %s', c);
  assert pg_temp.err(format('select pg_temp.wc(%L, 6, %L, %L)', room, 'harvest', t + interval '58 hours')) = 'wrong phase', 'R_2';
end $$;

do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        m jsonb;
begin
  -- mine (§11.6): the tools, the hoa màu in stock and the tank (null without a sprayer)
  insert into public.produce_stock (account_id, upland, kg) values (a1, 'khoai', 180), (a1, 'bap', 0);
  m := public._farm_mine(a1);
  assert m->'items'->'tool_sickle' = '1' and m->'produce' = '{"khoai": 180}' and m->'tank' = 'null', format('mine %s', m);
  insert into public.inventory (account_id, item_id, qty) values (a1, 'tool_sprayer', 1);
  delete from public.farm_profiles where account_id = a1;
  assert public._farm_mine(a1)->'tank' = '{"item": null, "charges": 0}', 'a sprayer, no profile yet';
  insert into public.farm_profiles (account_id, tank_item, tank_charges) values (a1, 'spray_insect', 2);
  assert public._farm_mine(a1)->'tank' = '{"item": "spray_insect", "charges": 2}', 'a loaded tank';
end $$;

-- The sweep (§6.4): step J pays a finished harvester job; step 6 spares a running one and takes hoa màu whose last picking
-- is lost, leaving the lease.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a4 uuid := (select v from smoke where k = 'a4')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; y integer; w0 integer;
begin
  -- plot 5 (a1): 2 of 6 parts cut by hand at a constant Y, then the harvester, from t to t + 30 s
  y := (public._crop_yield(pg_temp.crop(room, 5), public._variety('nep'), 1.0, 1.0, t + interval '30 seconds')->>'kg')::int;
  delete from public.rice_stock where account_id = a1;
  perform public._rice_add(a1, 'nep', public._part_kg(1, y) + public._part_kg(2, y), 0);
  w0 := pg_temp.wet(a1);
  perform public._field_open(room, t + interval '29 seconds');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 5) and pg_temp.wet(a1) = w0, 'still cutting';
  perform public._field_open(room, t + interval '30 seconds');
  assert pg_temp.wet(a1) = w0 + y - (2 * y) / 6, format('the machine pays the 4 parts left: %s + %s', w0, y - (2 * y) / 6);
  assert pg_temp.wet(a1) = y, 'hand plus machine is exactly Y';
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 5)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 5), 'the harvest ends the lease';
  perform public._field_open(room, t + interval '31 seconds');
  assert pg_temp.wet(a1) = y, 'paid once';

  -- plot 7 (a4, wiped during the job): the job is not paid (R10), the crop goes
  perform pg_temp.set_coins(a4, 20000);
  perform public._farm_do_rent(room, a4, 7, t);
  perform pg_temp.ripe_nep(room, 7, a4, t);
  update public.crops set harvester_at = t, harvester_until = t + interval '30 seconds' where room_id = room and plot_no = 7;
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a4, 2, 'pending_wipe', now());
  perform public._ac_wipe(a4, null);
  perform public._field_open(room, t + interval '30 seconds');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 7) and pg_temp.wet(a4) = 0, 'a wiped farmer is not paid';

  -- plot 8 (a2): rice past its fall time is spared while a harvester runs, and paid at its end
  perform pg_temp.set_coins(a2, 20000);
  perform public._farm_do_rent(room, a2, 8, t);
  perform pg_temp.ripe_nep(room, 8, a2, t - interval '60 hours');
  update public.crops set harvester_at = t - interval '10 seconds', harvester_until = t + interval '20 seconds'
   where room_id = room and plot_no = 8;
  perform public._field_open(room, t);
  assert exists (select 1 from public.crops where room_id = room and plot_no = 8), 'a running harvester keeps fallen rice';
  perform public._field_open(room, t + interval '20 seconds');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 8) and pg_temp.wet(a2) > 0, 'paid at its end';

  -- plot 9 (a2): khoai whose only picking is lost at L_1 = P + 108 h; the lease stays (R26)
  perform public._farm_do_rent(room, a2, 9, t);
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
  values (room, 9, a2, 'upland', 'khoai', t - interval '109 hours', t - interval '108 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '109 hours', 'l', 1)));
  perform public._field_open(room, t - interval '1 second');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 9), 'L_1 − 1 s';
  perform public._field_open(room, t);
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 9)
     and exists (select 1 from public.plot_leases where room_id = room and plot_no = 9), 'lost at L_1; the lease stays';

  -- step 0 stays 0015's: an owner banned by hand leaves the land market
  update public.field_plots set owner_id = a2, owned_at = t - interval '1 day', sale_price = 9000, sublease_price = 300
   where room_id = room and plot_no = 2;
  update public.accounts set is_banned = true where id = a2;
  perform public._field_open(room, t);
  assert (select owner_id = a2 and sale_price is null and sublease_price is null from public.field_plots
           where room_id = room and plot_no = 2), 'a ban set by hand withdraws the listing and the sublease';
  update public.accounts set is_banned = false where id = a2;
end $$;

select 'v15.2 field smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/v15-smoke.sql.** Replace:

```sql

  -- harvest: ripe at T = 43.2 h (short), in a drained plot, after a 2 s action; the lease ends with it
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '40 hours'))
```

with:

```sql

  -- harvest: ripe at T = 43.2 h (short), in a drained plot, with a sickle (v15.2), after a 2 s action; the lease ends with it
  insert into public.inventory (account_id, item_id, qty) values (a2, 'tool_sickle', 1);
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '40 hours'))
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected: `FAILED: tests/sql/v15-2-smoke.sql`, with `ERROR:  a sickle` in the log — `0013`'s `_work_check` lets a harvest round start without one.

- [ ] **Step 3: Write section D**

**supabase/migrations/0016_v15_2_crops.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- D. The field: the crop row, the checks, the views and the sweep (§6.5, §11.3, §11.6) ----------
-- The crop of a plot the account farms, locked for this call (R32). While a harvester runs, the plot takes no action.
create or replace function public._farm_crop(p_room uuid, p_plot integer, p_account uuid, p_now timestamptz)
returns public.crops
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot for update;
  if not found then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  if c.harvester_until is not null then
    raise exception 'harvester busy' using errcode = '22023';
  end if;
  return c;
end; $$;

-- The crop of a care action (fertilizing, watering, spraying): no care while the rice is partly cut (R8).
create or replace function public._care_crop(p_room uuid, p_plot integer, p_account uuid, p_now timestamptz)
returns public.crops
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops := public._farm_crop(p_room, p_plot, p_account, p_now);
begin
  if c.harvested_parts > 0 then
    raise exception 'harvesting' using errcode = '22023';
  end if;
  return c;
end; $$;

-- What a work needs (§6.2, §8.9). Rice: transplanting needs seedlings ≥ 8·s h old in shallow water (Nông); a harvest round
-- needs ripe rice, a drained plot (≤ Ẩm) and a sickle. Beds: transplanting needs an ớt nursery ≥ nursery_ready_h old on
-- an Ẩm bed; a picking needs the next picking ready and the bed ≤ Ẩm.
create or replace function public._work_check(c public.crops, v public.rice_varieties, p_work text, p_now timestamptz)
returns void
language plpgsql stable set search_path = public, extensions
as $$
declare u public.upland_crops; k integer;
begin
  if p_work is null or p_work not in ('transplant', 'harvest') then
    raise exception 'invalid work' using errcode = '22023';
  end if;
  if c.kind = 'upland' then
    u := public._upland(c.upland);
    if p_work = 'transplant' then
      if u.method is distinct from 'nursery' then
        raise exception 'wrong crop' using errcode = '22023';
      end if;
      if public._up_phase(c, u, p_now) <> 'nursery' or p_now < public._plus_h(c.sow_at, u.nursery_ready_h) then
        raise exception 'wrong phase' using errcode = '22023';
      end if;
      if public._water_at(c.water_log, p_now) <> 1 then
        raise exception 'need water' using errcode = '22023';
      end if;
    else
      k := public._up_next(c, u, p_now);
      if c.plant_at is null or k = 0 or p_now < public._up_ready(c, u, k) then
        raise exception 'wrong phase' using errcode = '22023';
      end if;
      if public._water_at(c.water_log, p_now) > 1 then
        raise exception 'need water' using errcode = '22023';
      end if;
    end if;
    return;
  end if;
  if p_work = 'transplant' then
    if public._crop_phase(c, v, p_now) <> 'seedling' or public._hrs(c.sow_at, p_now) < 8 * v.scale then
      raise exception 'wrong phase' using errcode = '22023';
    end if;
    if public._water_at(c.water_log, p_now) <> 2 then
      raise exception 'need water' using errcode = '22023';
    end if;
  else
    if public._crop_phase(c, v, p_now) not in ('ripe', 'overripe') then
      raise exception 'wrong phase' using errcode = '22023';
    end if;
    if public._water_at(c.water_log, p_now) > 1 then
      raise exception 'need water' using errcode = '22023';
    end if;
    if not public._owns(c.farmer_id, 'tool_sickle') then
      raise exception 'no sickle' using errcode = '22023';
    end if;
  end if;
end; $$;

-- One plot as everyone sees it (§11.6): rice or beds, the pickings, the cut parts and a running harvester; its farmer also
-- gets the crop's logs. The pest rolls never leave the server.
create or replace function public._plot_view(p_room uuid, p_plot integer, p_viewer uuid, p_now timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare f public.field_plots; l public.plot_leases; c public.crops; v public.rice_varieties; u public.upland_crops;
        v_phase text; v_pests jsonb := '[]'::jsonb; v_excess boolean := false; v_picking integer; v_pickings integer := 1;
        v_crop jsonb := null;
begin
  select * into f from public.field_plots where room_id = p_room and plot_no = p_plot;
  select * into l from public.plot_leases where room_id = p_room and plot_no = p_plot and until > p_now;
  select * into c from public.crops where room_id = p_room and plot_no = p_plot;
  if found then
    if c.kind = 'upland' then
      u := public._upland(c.upland);
      if u.id is null then
        v_phase := 'prepared';
        v_pickings := 0;
      else
        v_phase := public._up_phase(c, u, p_now);
        v_pests := public._up_pests(c, u, p_now);
        v_excess := public._up_excess_n(c, u, p_now);
        v_picking := case when c.plant_at is null then 1 else public._up_next(c, u, p_now) end;
        v_pickings := jsonb_array_length(u.pickings);
      end if;
    else
      select * into v from public.rice_varieties where id = c.variety;
      v_phase := public._crop_phase(c, v, p_now);
      v_pests := public._crop_pests(c, v, p_now);
      v_excess := public._excess_n(c, v, p_now);
    end if;
    v_crop := jsonb_build_object(
      'kind', c.kind, 'variety', c.variety, 'upland', c.upland, 'phase', v_phase,
      'prepared_at', c.prepared_at, 'soak_at', c.soak_at, 'sow_at', c.sow_at, 'transplant_at', c.transplant_at,
      'plant_at', c.plant_at,
      'water', public._water_at(c.water_log, p_now),
      'water_set_at', (select max((x->>'t')::timestamptz) from jsonb_array_elements(c.water_log) x
                        where (x->>'t')::timestamptz <= p_now),
      'pests', (select coalesce(jsonb_agg(jsonb_build_object('kind', x->'kind', 'since', x->'since', 'treated_at', x->'treated_at')
                                          order by (x->>'slot')::int), '[]'::jsonb)
                  from jsonb_array_elements(v_pests) x),
      'excess_n', v_excess,
      'ripe', v_phase in ('ripe', 'overripe'),
      'rotted_at', c.rotted_at,
      'picking', v_picking, 'pickings', v_pickings, 'parts', c.harvested_parts,
      'harvester', case when c.harvester_until is not null
                        then jsonb_build_object('started_at', c.harvester_at, 'ends_at', c.harvester_until) end);
    if p_viewer = c.farmer_id then
      v_crop := v_crop || jsonb_build_object('log', jsonb_build_object(
        'water', c.water_log, 'fert', c.fert_log, 'spray', c.spray_log, 'picks', c.picks, 'q_transplant', c.q_transplant,
        'work', c.work_log, 'harvests', c.harvests, 'harvested_kg', c.harvested_kg));
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

-- The account's farm belongings (the room-free part of field_state.mine): the tools too, the hoa màu in stock and the
-- sprayer's tank (null without a sprayer).
create or replace function public._farm_mine(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_object_agg(i.item_id, i.qty order by i.item_id)
                         from public.inventory i join public.shop_items s on s.id = i.item_id
                        where i.account_id = p_account and i.qty >= 1
                          and s.kind in ('seed','fertilizer','pesticide','critter_box','tool')), '{}'::jsonb),
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
                               jsonb_build_object('item', null, 'charges', 0)) end)
$$;

-- The lazy clock of a room's field (§6.4): 0015's step 0, then the harvester jobs that have ended (J), then steps 1–7.
-- Step J runs before a lease can expire (step 1) and never pays a farmer who no longer farmed the plot when the job
-- started (a wipe released it): R10, R32.
create or replace function public._field_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots; d public.drying_slots; c public.crops; v_y integer;
begin
  -- 0a. banned accounts leave the land market: an anti-cheat ban (review pending or wiped) or a ban set by hand
  delete from public.land_offers lo
   where lo.room_id = p_room
     and (exists (select 1 from public.accounts a where a.id = lo.buyer_id and a.is_banned)
          or exists (select 1 from public.anticheat_status s where s.account_id = lo.buyer_id and s.ban_state is not null));
  update public.field_plots fp set sale_price = null, sublease_price = null
   where fp.room_id = p_room and (fp.sale_price is not null or fp.sublease_price is not null)
     and (exists (select 1 from public.accounts a where a.id = fp.owner_id and a.is_banned)
          or exists (select 1 from public.anticheat_status s where s.account_id = fp.owner_id and s.ban_state is not null));
  -- 0b. a wipe releases what the account held at the time of the wipe, without refund
  delete from public.plot_leases pl using public.anticheat_status s
   where pl.room_id = p_room and s.account_id = pl.farmer_id and s.wiped_at is not null and pl.starts_at <= s.wiped_at;
  update public.field_plots fp set owner_id = null, owned_at = null, sale_price = null, sublease_price = null
    from public.anticheat_status s
   where fp.room_id = p_room and s.account_id = fp.owner_id and s.wiped_at is not null
     and (fp.owned_at is null or fp.owned_at <= s.wiped_at);
  delete from public.land_offers lo using public.anticheat_status s
   where lo.room_id = p_room and s.account_id = lo.buyer_id and s.wiped_at is not null and lo.created_at <= s.wiped_at;
  delete from public.drying_slots ds using public.anticheat_status s
   where ds.room_id = p_room and s.account_id = ds.account_id and s.wiped_at is not null
     and ds.ready_at <= s.wiped_at + interval '3 hours';
  -- 0c. offers on a plot that has no owner any more (a release above, or a deleted account)
  delete from public.land_offers lo using public.field_plots fp
   where lo.room_id = p_room and fp.room_id = lo.room_id and fp.plot_no = lo.plot_no and fp.owner_id is null;
  -- J. finished harvester jobs: lock the crop row, re-check it, pay the parts still uncut at the job's end, end the lease
  for c in select cr.* from public.crops cr
            where cr.room_id = p_room and cr.harvester_until is not null and cr.harvester_until <= p_now
            order by cr.plot_no for update loop
    if c.farmer_id = public._farmer(p_room, c.plot_no, c.harvester_at) then
      v_y := (public._crop_yield(c, public._variety(c.variety),
                                 case when (select fp.kind from public.field_plots fp
                                             where fp.room_id = p_room and fp.plot_no = c.plot_no) = 'private' then 1.1 else 1.0 end,
                                 1.0, c.harvester_until)->>'kg')::int;
      perform public._rice_add(c.farmer_id, c.variety, v_y - (c.harvested_parts * v_y) / 6, 0);   -- the parts left: R5
      delete from public.plot_leases where room_id = p_room and plot_no = c.plot_no;
    end if;
    delete from public.crops where room_id = p_room and plot_no = c.plot_no;
  end loop;
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
    perform public._pay(f.owner_id, 400000, 'land_refund', 'plot ' || f.plot_no);
  end loop;
  -- 4. a crop belongs to the plot's farmer: a crop left by an ended lease or a reclaim is lost, with its uncut parts and
  --    untaken pickings (R26)
  delete from public.crops cr
   where cr.room_id = p_room and cr.farmer_id is distinct from public._farmer(p_room, cr.plot_no, p_now);
  -- 5. sprouted seed not sown 24 h after sprouting (soak + 26 h) rots: the plot goes back to prepared, or to bare
  delete from public.crops
   where room_id = p_room and sow_at is null and prepared_at is null and p_now >= soak_at + interval '26 hours';
  update public.crops set rotted_at = soak_at + interval '26 hours', soak_at = null, variety = null
   where room_id = p_room and sow_at is null and p_now >= soak_at + interval '26 hours';
  -- 6. rice left 48 h after its ripe window has all fallen (not while a harvester runs: step J pays it first); hoa màu
  --    whose last picking is lost. The lease stays (R26).
  delete from public.crops cr using public.rice_varieties rv
   where cr.room_id = p_room and cr.kind = 'rice' and rv.id = cr.variety and cr.transplant_at is not null
     and cr.harvester_until is null and p_now >= public._plus_h(cr.transplant_at, 48 * rv.scale + 60);
  delete from public.crops cr using public.upland_crops u
   where cr.room_id = p_room and cr.kind = 'upland' and u.id = cr.upland and cr.plant_at is not null
     and public._up_next(cr, u, p_now) = 0;
  -- 7. a drying batch left 24 h after it is ready is collected for its owner
  for d in delete from public.drying_slots where room_id = p_room and ready_at <= p_now - interval '24 hours' returning * loop
    perform public._rice_add(d.account_id, d.variety, 0, d.kg);
  end loop;
end; $$;

revoke all on function public._farm_crop(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._care_crop(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._work_check(public.crops, public.rice_varieties, text, timestamptz) from public, anon, authenticated;
revoke all on function public._plot_view(uuid, integer, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
revoke all on function public._field_sweep(uuid, timestamptz) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected:

```text
v14 smoke ok
0016 twice ok
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
anticheat guards ok
v15.2 model smoke ok
v15.2 field smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.2): 0016 field — the locked crop row, the checks, the views and the sweep's step J

Section D of 0016_v15_2_crops.sql: _farm_crop locks the crop row and refuses a plot whose harvester runs; _care_crop
refuses care on a partly cut plot; _work_check adds the sickle to a rice round and handles the ớt transplant and the
pickings; _plot_view shows the kind, the pickings, the cut parts and the harvester; _farm_mine lists the tools, the hoa
màu and the tank; the sweep keeps 0015's step 0, pays finished harvester jobs in step J and drops hoa màu whose last
picking is lost. The v15 smoke gives its farmer a sickle before the harvest.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0016_v15_2_crops.sql tests/sql/v15-2-smoke.sql tests/sql/v15-smoke.sql
git commit -F <message file>
```

---

### Task 3: Database — the harvest: rice in six parts, the harvester, hoa-màu pickings (`0016` section E, first part)

**Files:**
- Modify: `supabase/migrations/0016_v15_2_crops.sql` (append the first part of section E)
- Modify: `tests/sql/v15-2-smoke.sql` (insert the harvest part), `tests/sql/v15-smoke.sql` (the gift's sickle, rice cut in six parts, the header), `tests/sql/anticheat-guards.sql` (the loop calls `harvest_part` and `rent_harvester`: 37 RPCs)

**Interfaces:**
- Consumes: Task 2's `_farm_crop`, `_care_crop`, `_work_check`, `_field_sweep` (step J); Task 1's `_part_kg`, `_produce_add`, `_up_next`, `_up_yield`; from `0013`: `_pay(account, delta, reason, ref)`, `_wallet_lock`, `_crop_yield`, `_rice_add`, `_use_item`; from `0015`: `_ac_play(room, token) → account`, `_ac_account(token) → account`, `_ac_flag(account, code, rpc, detail, room, error[, hard])`.
- Produces:
  - `_farm_do_begin_work(room, account, plot, work, now)`: replaces any earlier record; `lease ending` unless the lease has 10 s left for a rice round, 5 s for a transplant or a picking (R6, R11);
  - `_farm_do_harvest_part(room, account, plot, success, now)`: `wrong crop` on beds; `false` / null clears `work` and cuts nothing, with no gate (R7); `true` needs `work = 'harvest'` and 8 s ≤ now − `work_started_at` ≤ 120 s (`too fast` / `work expired`), re-runs `_work_check`, pays part i = parts + 1 of Y(now) as wet rice, and the sixth part deletes the crop and the lease; the answer adds `harvest_part {variety, kg, parts, total, done}`;
  - `_farm_do_rent_harvester(room, account, plot, now)`: `wrong crop`, `wrong phase` (not ripe, or 6 parts), `need water`, `lease ends` (< 30 s left), `not enough coins`; pays `500 × (6 − parts)` with reason `harvester`, sets `harvester_at` / `harvester_until = now + 30 s`, clears `work`;
  - `_farm_do_harvest(room, account, plot, quality, now)`: a hoa-màu picking only (rice raises `wrong crop`, R16); it takes the next picking's kg into `produce_stock`, and the last one ends the crop and a lease; the answer adds `harvest {upland, kg, k, pickings, done}`;
  - `_farm_do_fertilize`, `_farm_do_water`: through `_care_crop` (`harvesting`), beds included; `_farm_do_pick_snails`: `harvester busy`, `harvesting`; `_farm_do_abandon`: `harvester busy`, and the grain already cut stays;
  - the guarded RPCs `harvest_part(room, token, plot, success)` and `rent_harvester(room, token, plot)`: `_ac_play`, then `bad_plot` (`invalid plot`); `claim_farm_gift(token)`: a sickle joins the first gift (`on conflict do nothing`, R4).
- Produces (smoke): the harvest part (room `Gặt lúa`), printing `v15.2 harvest smoke ok`.

- [ ] **Step 1: Write the smoke's harvest part and the smoke changes**

**tests/sql/v15-2-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- the rice harvest (§6.1–§6.5) and the hoa-màu pickings (§8.9), in room 'Gặt lúa' ----------
insert into smoke select 'room3', room_id::text from public.create_room('Gặt lúa', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room3')::uuid), 'pw', v)
  from smoke where k in ('t2', 't3');
-- The hoa màu of an account.
create function pg_temp.produce(a uuid, u text) returns integer language sql
as $$ select coalesce((select kg from public.produce_stock where account_id = a and upland = u), 0) $$;

-- A hand harvest (§6.2, R5–R8): the 8 s gate, the 120 s window, a replaced or forgotten round, failures, six parts.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room3')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; y integer; w0 integer;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform pg_temp.set_coins(a2, 100000);
  perform public._farm_do_rent(room, a1, 5, t);
  perform pg_temp.ripe_nep(room, 5, a1, t);
  perform public._farm_do_rent(room, a2, 7, t);
  perform pg_temp.ripe_nep(room, 7, a2, t);
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a2, 'harvest', t)) = 'no sickle',
    'a round needs a sickle';
  y := (public._crop_yield(pg_temp.crop(room, 5), public._variety('nep'), 1.0, 1.0, t)->>'kg')::int;
  w0 := pg_temp.wet(a1);
  -- part 1, at least 8 s after its begin_work
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t)) = 'too fast', 'no round';
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t);
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '7.9 seconds'))
         = 'too fast', '7.9 s';
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '8 seconds');
  assert s->'harvest_part' = jsonb_build_object('variety', 'nep', 'kg', y / 6, 'parts', 1, 'total', y / 6, 'done', false)
     and pg_temp.wet(a1) = w0 + y / 6, format('part 1 pays Y / 6 of %s: %s', y, s->'harvest_part');
  assert pg_temp.plot(s, 5)->'crop'->'parts' = '1' and (pg_temp.crop(room, 5)).work is null, 'a part clears the round';
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '9 seconds'))
         = 'too fast', 'every part needs its own round';
  -- no care while partly cut (R8)
  assert pg_temp.err(format('select public._farm_do_fertilize(%L, %L, 5, %L, %L)', room, a1, 'fert_urea', t + interval '10 seconds'))
         = 'harvesting', 'no fertilizer';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 5, -1, %L)', room, a1, t + interval '10 seconds'))
         = 'harvesting', 'no water';
  assert pg_temp.err(format('select public._farm_do_pick_snails(%L, %L, 5, %L)', room, a2, t + interval '10 seconds'))
         = 'harvesting', 'no snail picking';
  -- the 120 s window (R6)
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '1 minute');
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '3 minutes');
  assert s->'harvest_part'->'parts' = '2', 'a claim at 120 s';
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '4 minutes');
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '6 minutes 1 second'))
         = 'work expired', 'a claim at 121 s';
  -- a second begin_work restarts the gate
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '7 minutes');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '7 minutes 5 seconds');
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t + interval '7 minutes 9 seconds'))
         = 'too fast', '9 s after the first, 4 s after the second';
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '7 minutes 13 seconds');
  assert s->'harvest_part'->'parts' = '3', '8 s after the second';
  -- an Esc or a disconnect leaves a record that blocks nothing
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '10 minutes');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '13 minutes 20 seconds');
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '13 minutes 28 seconds');
  assert s->'harvest_part'->'parts' = '4', 'a new round 200 s later';
  -- a failed round (false, or null) cuts nothing, clears the record and has no gate (R7)
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '20 minutes');
  s := public._farm_do_harvest_part(room, a1, 5, false, t + interval '20 minutes 1 second');
  assert s->'harvest_part' is null and pg_temp.plot(s, 5)->'crop'->'parts' = '4' and (pg_temp.crop(room, 5)).work is null,
    'a failure';
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '21 minutes');
  s := public._farm_do_harvest_part(room, a1, 5, null, t + interval '21 minutes 1 second');
  assert s->'harvest_part' is null and (pg_temp.crop(room, 5)).work is null and (pg_temp.crop(room, 5)).harvested_parts = 4,
    'null is a failure';
  assert pg_temp.wet(a1) = w0 + (4 * y) / 6 and (pg_temp.crop(room, 5)).harvested_kg = (4 * y) / 6, 'four parts so far';
  -- parts 5 and 6: the sixth completes the harvest and ends the lease
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '22 minutes');
  perform public._farm_do_harvest_part(room, a1, 5, true, t + interval '22 minutes 8 seconds');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t + interval '23 minutes');
  s := public._farm_do_harvest_part(room, a1, 5, true, t + interval '23 minutes 8 seconds');
  assert s->'harvest_part' = jsonb_build_object('variety', 'nep', 'kg', public._part_kg(6, y), 'parts', 6, 'total', y, 'done', true),
    format('part 6 %s', s->'harvest_part');
  assert pg_temp.wet(a1) = w0 + y, 'six parts at a constant Y sum to Y';
  assert pg_temp.plot(s, 5)->'crop' = 'null' and pg_temp.plot(s, 5)->'lease' = 'null', 'bare, and the lease ended';
end $$;

-- Work must fit in the lease (R11): 10 s for a round, 30 s for the harvester. A round the lease cuts short pays nothing.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; l timestamptz := t + interval '1 hour';
        y integer; w0 integer;
begin
  perform public._farm_do_rent(room, a1, 6, t);
  perform pg_temp.ripe_nep(room, 6, a1, t);
  update public.plot_leases set until = l where room_id = room and plot_no = 6;
  w0 := pg_temp.wet(a1);
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 6, %L, %L)', room, a1, 'harvest', l - interval '9 seconds'))
         = 'lease ending', '9 s left';
  perform public._farm_do_begin_work(room, a1, 6, 'harvest', l - interval '10 seconds');
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 6, %L)', room, a1, l - interval '29 seconds'))
         = 'lease ends', 'the harvester needs 30 s';
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 6, true, %L)', room, a1, l + interval '1 second'))
         = 'not your plot', 'the lease ran out mid-round';
  perform public._field_open(room, l + interval '1 second');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 6)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 6) and pg_temp.wet(a1) = w0,
    'the crop went with the lease; no rice';
  -- a harvester rented with 30 s left ends with the lease: step J pays before step 1 ends the lease
  perform public._farm_do_rent(room, a1, 6, l + interval '1 minute');
  perform pg_temp.ripe_nep(room, 6, a1, l);
  l := l + interval '10 minutes';
  update public.plot_leases set until = l where room_id = room and plot_no = 6;
  y := (public._crop_yield(pg_temp.crop(room, 6), public._variety('nep'), 1.0, 1.0, l)->>'kg')::int;
  perform public._farm_do_rent_harvester(room, a1, 6, l - interval '30 seconds');
  perform public._field_open(room, l);
  assert pg_temp.wet(a1) = w0 + y and not exists (select 1 from public.crops where room_id = room and plot_no = 6)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 6), 'paid in the lease''s last second';
end $$;

-- The harvester (§6.3, §6.4, R9, R32): its checks in order, a pro-rated price, busy while it runs, paid once at its end.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room3')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        t2 timestamptz := t + interval '2 hours'; s jsonb; y integer; w0 integer; c0 integer;
begin
  -- plot 7 (a2, no sickle): a whole plot for 3 000 xu
  perform public._farm_do_rent(room, a2, 8, t2);
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 11, %L)', room, a2, t2)) = 'invalid plot', 'plot 11';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a1, t2)) = 'not your plot', 'a2''s plot';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 8, %L)', room, a2, t2)) = 'not prepared', 'no crop';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t - interval '3 hours'))
         = 'wrong phase', 'still ripening';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t2, 'l', 2))
   where room_id = room and plot_no = 7;
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2)) = 'need water', 'drain first';
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', t2, 'l', 1))
   where room_id = room and plot_no = 7;
  update public.crops set harvested_parts = 6 where room_id = room and plot_no = 7;
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2)) = 'wrong phase',
    'nothing left to cut';
  update public.crops set harvested_parts = 0 where room_id = room and plot_no = 7;
  perform pg_temp.set_coins(a2, 2999);
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2)) = 'not enough coins',
    '500 xu a part';
  perform pg_temp.set_coins(a2, 3000);
  y := (public._crop_yield(pg_temp.crop(room, 7), public._variety('nep'), 1.0, 1.0, t2 + interval '30 seconds')->>'kg')::int;
  w0 := pg_temp.wet(a2);
  s := public._farm_do_rent_harvester(room, a2, 7, t2);
  assert pg_temp.plot(s, 7)->'crop'->'harvester' = jsonb_build_object('started_at', t2, 'ends_at', t2 + interval '30 seconds')
     and s->'mine'->'coins' = '0', format('rented %s', pg_temp.plot(s, 7)->'crop'->'harvester');
  assert exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'harvester' and delta = -3000 and ref = 'plot 7'),
    'the ledger row';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 7, %L)', room, a2, t2 + interval '1 second'))
         = 'harvester busy', 'one job at a time';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a2, 'harvest', t2 + interval '1 second'))
         = 'harvester busy', 'no round';
  assert pg_temp.err(format('select public._farm_do_fertilize(%L, %L, 7, %L, %L)', room, a2, 'fert_urea', t2 + interval '1 second'))
         = 'harvester busy', 'no care';
  assert pg_temp.err(format('select public._farm_do_water(%L, %L, 7, -1, %L)', room, a2, t2 + interval '1 second'))
         = 'harvester busy', 'no water';
  assert pg_temp.err(format('select public._farm_do_pick_snails(%L, %L, 7, %L)', room, a1, t2 + interval '1 second'))
         = 'harvester busy', 'no snail picking';
  assert pg_temp.err(format('select public._farm_do_abandon(%L, %L, 7, %L)', room, a2, t2 + interval '1 second'))
         = 'harvester busy', 'no abandon';
  perform public._field_open(room, t2 + interval '29 seconds');
  assert pg_temp.wet(a2) = w0 and exists (select 1 from public.crops where room_id = room and plot_no = 7), 'still cutting';
  perform public._field_open(room, t2 + interval '30 seconds');
  assert pg_temp.wet(a2) = w0 + y and not exists (select 1 from public.crops where room_id = room and plot_no = 7)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 7), format('the machine cut %s kg', y);

  -- plot 5 (a1): two parts by hand, then the machine for the four left (2 000 xu); a round begun before the rent pays nothing
  perform public._farm_do_rent(room, a1, 5, t2);
  perform pg_temp.ripe_nep(room, 5, a1, t2);
  y := (public._crop_yield(pg_temp.crop(room, 5), public._variety('nep'), 1.0, 1.0, t2 + interval '1 minute')->>'kg')::int;
  w0 := pg_temp.wet(a1);
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t2);
  perform public._farm_do_harvest_part(room, a1, 5, true, t2 + interval '8 seconds');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t2 + interval '10 seconds');
  perform public._farm_do_harvest_part(room, a1, 5, true, t2 + interval '18 seconds');
  perform public._farm_do_begin_work(room, a1, 5, 'harvest', t2 + interval '20 seconds');
  c0 := (select coins from public.wallets where account_id = a1);
  s := public._farm_do_rent_harvester(room, a1, 5, t2 + interval '22 seconds');
  assert s->'mine'->'coins' = to_jsonb(c0 - 2000) and (pg_temp.crop(room, 5)).work is null
     and exists (select 1 from public.coin_ledger where account_id = a1 and reason = 'harvester' and delta = -2000 and ref = 'plot 5'),
    'four parts left: 2 000 xu, and the round is cleared';
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 5, true, %L)', room, a1, t2 + interval '29 seconds'))
         = 'harvester busy' and pg_temp.wet(a1) = w0 + (2 * y) / 6, 'no hand part during the job';
  perform public._field_open(room, t2 + interval '52 seconds');
  assert pg_temp.wet(a1) = w0 + y and not exists (select 1 from public.crops where room_id = room and plot_no = 5)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 5), 'hand plus machine is exactly Y';
  perform public._field_open(room, t2 + interval '1 minute');
  assert pg_temp.wet(a1) = w0 + y, 'paid once';
end $$;

-- Pickings (§8.9, R16, R26): no rounds and no harvester on beds; a picking or a transplant needs 5 s on the lease; a
-- lease that runs out takes the pickings left, and the stock keeps the ones taken.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room3')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        t6 timestamptz := t + interval '6 hours'; s jsonb; kg integer;
begin
  -- plot 8 (a2): khoai planted 42 h before t, ripe at t6 (R_1 = P + 48 h), on dry beds
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
  values (room, 8, a2, 'upland', 'khoai', t - interval '43 hours', t - interval '42 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '43 hours', 'l', 1)));
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 8, true, %L)', room, a2, t6)) = 'wrong crop',
    'no rounds on beds';
  assert pg_temp.err(format('select public._farm_do_rent_harvester(%L, %L, 8, %L)', room, a2, t6)) = 'wrong crop',
    'no harvester for hoa màu';
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 8, 1, %L)', room, a2, t6)) = 'too fast', 'the action first';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', t6 - interval '1 second'))
         = 'wrong phase', 'R_1 − 1 s';
  update public.plot_leases set until = t6 + interval '1 minute' where room_id = room and plot_no = 8;
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', t6 + interval '56 seconds'))
         = 'lease ending', '4 s left';
  perform public._farm_do_begin_work(room, a2, 8, 'harvest', t6 + interval '55 seconds');
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 8, 1, %L)', room, a2, t6 + interval '56 seconds'))
         = 'too fast', 'the 2 s gate';
  kg := (public._up_yield(pg_temp.crop(room, 8), public._upland('khoai'), 1.0, 1, t6 + interval '57 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a2, 8, 5.0, t6 + interval '57 seconds');
  assert s->'harvest' = jsonb_build_object('upland', 'khoai', 'kg', kg, 'k', 1, 'pickings', 1, 'done', true)
     and s->'mine'->'produce' = jsonb_build_object('khoai', kg) and pg_temp.produce(a2, 'khoai') = kg,
    format('dug %s kg, quality ignored: %s', kg, s->'harvest');
  assert pg_temp.plot(s, 8)->'crop' = 'null' and pg_temp.plot(s, 8)->'lease' = 'null', 'the last picking ends the lease';

  -- plot 10 (a3): an ớt nursery, ready since t6 − 1 h; its transplant needs 5 s on the lease
  perform pg_temp.set_coins(a3, 100000);
  perform public._farm_do_rent(room, a3, 10, t6);
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, water_log)
  values (room, 10, a3, 'upland', 'ot', t6 - interval '12 hours', t6 - interval '11 hours',
          jsonb_build_array(jsonb_build_object('t', t6 - interval '12 hours', 'l', 1), jsonb_build_object('t', t6, 'l', 1)));
  update public.plot_leases set until = t6 + interval '1 minute' where room_id = room and plot_no = 10;
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 10, %L, %L)', room, a3, 'transplant',
                            t6 + interval '56 seconds')) = 'lease ending', 'a transplant with 4 s left';
  perform public._farm_do_begin_work(room, a3, 10, 'transplant', t6 + interval '55 seconds');
  perform public._field_open(room, t6 + interval '1 minute');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 10), 'the nursery went with the lease';

  -- plot 10 again: ớt planted 46 h before t6, so picking 1 is ripe at t6 and picking 2 at t6 + 12 h
  perform public._farm_do_rent(room, a3, 10, t6 + interval '2 minutes');
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, plant_at, water_log)
  values (room, 10, a3, 'upland', 'ot', t6 - interval '60 hours', t6 - interval '58 hours', t6 - interval '46 hours',
          jsonb_build_array(jsonb_build_object('t', t6 - interval '60 hours', 'l', 1), jsonb_build_object('t', t6 - interval '1 hour', 'l', 1)));
  perform public._farm_do_begin_work(room, a3, 10, 'harvest', t6 + interval '3 minutes');
  kg := (public._up_yield(pg_temp.crop(room, 10), public._upland('ot'), 1.0, 1, t6 + interval '3 minutes 2 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a3, 10, 1, t6 + interval '3 minutes 2 seconds');
  assert s->'harvest' = jsonb_build_object('upland', 'ot', 'kg', kg, 'k', 1, 'pickings', 3, 'done', false)
     and pg_temp.plot(s, 10)->'crop'->'picking' = '2' and pg_temp.produce(a3, 'ot') = kg
     and (pg_temp.crop(room, 10)).harvests
         = jsonb_build_array(jsonb_build_object('t', t6 + interval '3 minutes 2 seconds', 'k', 1, 'kg', kg))
     and (pg_temp.crop(room, 10)).work is null, format('picking 1: %s', s->'harvest');
  update public.plot_leases set until = t6 + interval '12 hours 10 seconds' where room_id = room and plot_no = 10;
  perform public._farm_do_begin_work(room, a3, 10, 'harvest', t6 + interval '12 hours');
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 10, 1, %L)', room, a3, t6 + interval '12 hours 11 seconds'))
         = 'not your plot', 'picking 2 after the lease';
  perform public._field_open(room, t6 + interval '12 hours 11 seconds');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 10)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 10) and pg_temp.produce(a3, 'ot') = kg,
    'pickings 2 and 3 went with the lease; picking 1 stays';
end $$;

-- A later part is smaller (§6.1); rice is not picked (R16); fallen rice takes its uncut parts (sweep step 6).
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room3')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; s jsonb; y1 integer; y2 integer; w0 integer;
begin
  insert into public.inventory (account_id, item_id, qty) values (a3, 'tool_sickle', 1);
  perform public._farm_do_rent(room, a3, 9, t + interval '7 hours');
  perform pg_temp.ripe_nep(room, 9, a3, t - interval '12 hours');
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 9, 1, %L)', room, a3, t + interval '7 hours'))
         = 'wrong crop', 'rice is cut in parts';
  w0 := pg_temp.wet(a3);
  y1 := (public._crop_yield(pg_temp.crop(room, 9), public._variety('nep'), 1.0, 1.0, t + interval '7 hours 8 seconds')->>'kg')::int;
  perform public._farm_do_begin_work(room, a3, 9, 'harvest', t + interval '7 hours');
  s := public._farm_do_harvest_part(room, a3, 9, true, t + interval '7 hours 8 seconds');
  assert s->'harvest_part'->'kg' = to_jsonb(public._part_kg(1, y1)), format('part 1 of %s', y1);
  y2 := (public._crop_yield(pg_temp.crop(room, 9), public._variety('nep'), 1.0, 1.0, t + interval '9 hours 8 seconds')->>'kg')::int;
  perform public._farm_do_begin_work(room, a3, 9, 'harvest', t + interval '9 hours');
  s := public._farm_do_harvest_part(room, a3, 9, true, t + interval '9 hours 8 seconds');
  assert y2 < y1 and s->'harvest_part' = jsonb_build_object('variety', 'nep', 'kg', public._part_kg(2, y2), 'parts', 2,
                                                            'total', public._part_kg(1, y1) + public._part_kg(2, y2), 'done', false),
    format('Y fell from %s to %s: %s', y1, y2, s->'harvest_part');
  assert pg_temp.wet(a3) = w0 + public._part_kg(1, y1) + public._part_kg(2, y2), 'two parts paid';
  -- the crop falls 48 h after its ripe window (transplant + 108 h = t + 46 h)
  perform public._field_open(room, t + interval '45 hours 59 minutes 59 seconds');
  assert exists (select 1 from public.crops where room_id = room and plot_no = 9), 'standing';
  perform public._field_open(room, t + interval '46 hours');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 9)
     and exists (select 1 from public.plot_leases where room_id = room and plot_no = 9)
     and pg_temp.wet(a3) = w0 + public._part_kg(1, y1) + public._part_kg(2, y2), 'fallen: the uncut parts are lost, the lease stays';
end $$;

-- The RPCs (§11.4, §11.5): guarded, flagged on a bad plot, public; the gift's sickle (R4).
do $$
declare t1 text := (select v from smoke where k = 't1'); t3 text := (select v from smoke where k = 't3');
        room uuid := (select v from smoke where k = 'room3')::uuid; r jsonb;
begin
  r := public.harvest_part(room, t1, 0, true);
  assert r->'anticheat'->>'code' = 'bad_plot' and r->'anticheat'->>'error' = 'invalid plot', format('harvest_part %s', r);
  r := public.rent_harvester(room, t1, null);
  assert r->'anticheat'->>'code' = 'bad_plot' and r->'anticheat'->>'error' = 'invalid plot', format('rent_harvester %s', r);
  assert pg_temp.err(format('select public.rent_harvester(%L, %L, 5)', room, t1)) = 'not your plot', 'the core answers';
  assert pg_temp.err(format('select public.harvest_part(%L, %L, 5, false)', room, t1)) = 'not your plot', 'a failure too';
  assert has_function_privilege('anon', 'public.harvest_part(uuid,text,integer,boolean)', 'execute')
     and has_function_privilege('anon', 'public.rent_harvester(uuid,text,integer)', 'execute')
     and not has_function_privilege('anon', 'public._farm_do_harvest_part(uuid,uuid,integer,boolean,timestamptz)', 'execute')
     and not has_function_privilege('anon', 'public._farm_do_rent_harvester(uuid,uuid,integer,timestamptz)', 'execute'),
    'public RPCs, private cores';
  -- the gift adds a sickle, and one already held stays one
  r := public.claim_farm_gift(t3);
  assert r->'gifted' = 'true' and r->'mine'->'items'->'tool_sickle' = '1' and r->'mine'->'items'->'seed_short' = '1'
     and r->'mine'->'items'->'fert_urea' = '1', format('the gift %s', r->'mine'->'items');
end $$;

select 'v15.2 harvest smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/v15-smoke.sql — edit 1 of 5.** Replace:

```sql
-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0015, from the repo
-- root (the crop fixtures are read with \copy, and the last section re-runs 0013 with \i). Every check is an ASSERT; the
```

with:

```sql
-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0016, from the repo
-- root (the crop fixtures are read with \copy, and the last section re-runs 0013 with \i). Every check is an ASSERT; the
```

**tests/sql/v15-smoke.sql — edit 2 of 5.** Replace:

```sql
begin
  -- chú Tám's gift, once per account
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'true' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1}' and r->>'server_now' is not null, 'gift';
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'false' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1}' and r->'mine'->'gift_claimed' = 'true',
    'only once';
  -- the farm shop at anh Hai
```

with:

```sql
begin
  -- chú Tám's gift, once per account (a sickle too, from 0016 on)
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'true' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1, "tool_sickle": 1}'
     and r->>'server_now' is not null, 'gift';
  r := public.claim_farm_gift(t2);
  assert r->'gifted' = 'false' and r->'mine'->'items' = '{"fert_urea": 1, "seed_short": 1, "tool_sickle": 1}'
     and r->'mine'->'gift_claimed' = 'true', 'only once';
  -- the farm shop at anh Hai
```

**tests/sql/v15-smoke.sql — edit 3 of 5.** Replace:

```sql
        room uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        tp timestamptz; s jsonb; c public.crops; v_kg integer;
begin
```

with:

```sql
        room uuid := (select v from smoke where k = 'room2')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        tp timestamptz; s jsonb; c public.crops; v_kg integer; i integer;
begin
```

**tests/sql/v15-smoke.sql — edit 4 of 5.** Replace:

```sql

  -- harvest: ripe at T = 43.2 h (short), in a drained plot, with a sickle (v15.2), after a 2 s action; the lease ends with it
  insert into public.inventory (account_id, item_id, qty) values (a2, 'tool_sickle', 1);
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '40 hours'))
```

with:

```sql

  -- harvest (v15.2): ripe at T = 43.2 h (short), in a drained plot, with the gift's sickle, in 6 parts of one 8 s round each;
  -- the sixth ends the lease
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'harvest', tp + interval '40 hours'))
```

**tests/sql/v15-smoke.sql — edit 5 of 5.** Replace:

```sql
  perform public._farm_do_water(room, a2, 8, -1, tp + interval '44 hours');
  perform public._farm_do_begin_work(room, a2, 8, 'harvest', tp + interval '44 hours');
  select * into c from public.crops where room_id = room and plot_no = 8;
  v_kg := (public._crop_yield(c, public._variety('short'), 1.0, 1.0, tp + interval '44 hours 2 seconds')->>'kg')::int;
  s := public._farm_do_harvest(room, a2, 8, 5.0, tp + interval '44 hours 2 seconds');
  assert s->'harvest' = jsonb_build_object('variety', 'short', 'kg', v_kg) and s->'mine'->'rice'->'short'->'wet' = to_jsonb(v_kg),
    format('harvested %s kg wet, quality ignored (D1)', v_kg);
  assert pg_temp.plot(s, 8)->'crop' = 'null' and pg_temp.plot(s, 8)->'lease' = 'null' and s->'mine'->'farming' = '[]',
```

with:

```sql
  perform public._farm_do_water(room, a2, 8, -1, tp + interval '44 hours');
  select * into c from public.crops where room_id = room and plot_no = 8;
  v_kg := (public._crop_yield(c, public._variety('short'), 1.0, 1.0, tp + interval '44 hours 8 seconds')->>'kg')::int;
  for i in 1 .. 6 loop
    perform public._farm_do_begin_work(room, a2, 8, 'harvest', tp + interval '44 hours' + (i - 1) * interval '10 seconds');
    s := public._farm_do_harvest_part(room, a2, 8, true, tp + interval '44 hours 8 seconds' + (i - 1) * interval '10 seconds');
    assert s->'harvest_part' = jsonb_build_object('variety', 'short', 'kg', public._part_kg(i, v_kg), 'parts', i,
                                                  'total', (i * v_kg) / 6, 'done', i = 6), format('part %s: %s', i, s->'harvest_part');
  end loop;
  assert s->'mine'->'rice'->'short'->'wet' = to_jsonb(v_kg), format('harvested %s kg wet', v_kg);
  assert pg_temp.plot(s, 8)->'crop' = 'null' and pg_temp.plot(s, 8)->'lease' = 'null' and s->'mine'->'farming' = '[]',
```

**tests/sql/anticheat-guards.sql — edit 1 of 3.** Replace:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 35 game RPCs, and
--    the four reads still answer.
```

with:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 37 game RPCs, and
--    the four reads still answer.
```

**tests/sql/anticheat-guards.sql — edit 2 of 3.** Replace:

```sql
    format('select public.buy_farm_item(%L, %L, 1)', t, 'fert_urea'),
    format('select public.claim_farm_gift(%L)', t)] loop
    n := n + 1;
```

with:

```sql
    format('select public.buy_farm_item(%L, %L, 1)', t, 'fert_urea'),
    format('select public.claim_farm_gift(%L)', t),
    -- v15.2 (0016)
    format('select public.harvest_part(%L, %L, 5, true)', room, t),
    format('select public.rent_harvester(%L, %L, 5)', room, t)] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 3 of 3.** Replace:

```sql
  end loop;
  assert n = 35, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 37, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected: `FAILED: tests/sql/v15-smoke.sql`, with `ERROR:  gift` in the log — the gift has no sickle yet.

- [ ] **Step 3: Write the harvest part of section E**

**supabase/migrations/0016_v15_2_crops.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- E. Actions and RPCs (§6, §7, §8.9, §11.4). Each _farm_do_* takes p_now; its public RPC passes now(). ----------
-- Starts a rice round or a 3-second action (R6, R11): it replaces any earlier record, and it needs 10 s left on a lease for
-- a round and 5 s for a transplant or a picking.
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
  if exists (select 1 from public.plot_leases pl
              where pl.room_id = p_room and pl.plot_no = p_plot
                and pl.until < p_now + case when c.kind = 'rice' and p_work = 'harvest' then interval '10 seconds'
                                            else interval '5 seconds' end) then
    raise exception 'lease ending' using errcode = '22023';
  end if;
  update public.crops set work = p_work, work_started_at = p_now where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- One part of a rice harvest (§6.2, R5–R7, R32). A success 8–120 s after its begin_work pays part i = harvested_parts + 1
-- of Y(p_now) as wet rice, on the locked row; the sixth part ends the crop and the lease. A failure (false or null) clears
-- the record and cuts nothing, with no gate.
create or replace function public._farm_do_harvest_part(p_room uuid, p_account uuid, p_plot integer, p_success boolean,
                                                        p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v public.rice_varieties; f public.field_plots; v_y integer; v_i integer; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind <> 'rice' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  if not coalesce(p_success, false) then
    update public.crops set work = null, work_started_at = null where room_id = p_room and plot_no = p_plot;
    return public._field_view(p_room, p_account, p_now);
  end if;
  if c.work is distinct from 'harvest' or c.work_started_at is null or p_now - c.work_started_at < interval '8 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
  if p_now - c.work_started_at > interval '120 seconds' then
    raise exception 'work expired' using errcode = '22023';
  end if;
  v := public._variety(c.variety);
  perform public._work_check(c, v, 'harvest', p_now);
  f := public._plot_row(p_room, p_plot);
  v_y := (public._crop_yield(c, v, case when f.kind = 'private' then 1.1 else 1.0 end, 1.0, p_now)->>'kg')::int;
  v_i := c.harvested_parts + 1;
  v_kg := public._part_kg(v_i, v_y);
  perform public._rice_add(p_account, c.variety, v_kg, 0);
  if v_i = 6 then
    delete from public.crops where room_id = p_room and plot_no = p_plot;
    delete from public.plot_leases where room_id = p_room and plot_no = p_plot;
  else
    update public.crops set harvested_parts = v_i, harvested_kg = harvested_kg + v_kg, work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest_part', jsonb_build_object('variety', c.variety, 'kg', v_kg, 'parts', v_i,
                                                                 'total', c.harvested_kg + v_kg, 'done', v_i = 6));
end; $$;

-- The co-op's harvester (§6.3, R9, R11, R12): 500 xu for each part still uncut, 30 s, paid by the sweep's step J at its
-- end. It needs no sickle; there is no cancel and no refund. The locked row is re-checked before the charge (R32).
create or replace function public._farm_do_rent_harvester(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare w public.wallets; c public.crops; v_price integer;
begin
  perform public._field_open(p_room, p_now);
  w := public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind <> 'rice' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  if c.harvested_parts >= 6 or public._crop_phase(c, public._variety(c.variety), p_now) not in ('ripe', 'overripe') then
    raise exception 'wrong phase' using errcode = '22023';
  end if;
  if public._water_at(c.water_log, p_now) > 1 then
    raise exception 'need water' using errcode = '22023';
  end if;
  if exists (select 1 from public.plot_leases pl
              where pl.room_id = p_room and pl.plot_no = p_plot and pl.until < p_now + interval '30 seconds') then
    raise exception 'lease ends' using errcode = '22023';
  end if;
  v_price := 500 * (6 - c.harvested_parts);
  if w.coins < v_price then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  perform public._pay(p_account, -v_price, 'harvester', 'plot ' || p_plot);
  update public.crops
     set harvester_at = p_now, harvester_until = p_now + interval '30 seconds', work = null, work_started_at = null
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- A hoa-màu picking (§8.9, R16): the next picking after its 2 s action, into the farmer's produce; the last one ends the
-- crop and a lease. Rice is cut in parts or by the harvester ('wrong crop'). The reported quality is ignored (D1).
create or replace function public._farm_do_harvest(p_room uuid, p_account uuid, p_plot integer, p_quality double precision,
                                                   p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; u public.upland_crops; f public.field_plots; v_k integer; v_n integer; v_kg integer;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind <> 'upland' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  perform public._work_gate(c, 'harvest', p_now);
  perform public._work_check(c, null, 'harvest', p_now);
  u := public._upland(c.upland);
  f := public._plot_row(p_room, p_plot);
  v_k := public._up_next(c, u, p_now);
  v_n := jsonb_array_length(u.pickings);
  v_kg := (public._up_yield(c, u, case when f.kind = 'private' then 1.1 else 1.0 end, v_k, p_now)->>'kg')::int;
  perform public._produce_add(p_account, c.upland, v_kg);
  if v_k = v_n then
    delete from public.crops where room_id = p_room and plot_no = p_plot;
    delete from public.plot_leases where room_id = p_room and plot_no = p_plot;
  else
    update public.crops
       set harvests = harvests || jsonb_build_array(jsonb_build_object('t', p_now, 'k', v_k, 'kg', v_kg)),
           work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now)
         || jsonb_build_object('harvest', jsonb_build_object('upland', c.upland, 'kg', v_kg, 'k', v_k, 'pickings', v_n,
                                                            'done', v_k = v_n));
end; $$;

-- Any fertilizer, any time after làm đất; not while the rice is partly cut (R8).
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
  c := public._care_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  update public.crops set fert_log = fert_log || jsonb_build_array(jsonb_build_object('t', p_now, 'item', p_item))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Bơm / tưới (+1) or tháo (−1) one level (0013's caps: 60 entries a crop, 6 an hour); not while the rice is partly cut.
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
  c := public._care_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  if jsonb_array_length(c.water_log) >= 60
     or (select count(*) from jsonb_array_elements(c.water_log) x where (x->>'t')::timestamptz > p_now - interval '1 hour') >= 6 then
    raise exception 'too fast' using errcode = '22023';
  end if;
  v_level := greatest(0, least(3, public._water_at(c.water_log, p_now) + p_delta));
  update public.crops set water_log = water_log || jsonb_build_array(jsonb_build_object('t', p_now, 'l', v_level))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Bắt ốc: anyone may pick the golden apple snails off a rice plot, but not while it is being harvested.
create or replace function public._farm_do_pick_snails(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  select * into c from public.crops where room_id = p_room and plot_no = p_plot for update;
  if found and c.harvester_until is not null then
    raise exception 'harvester busy' using errcode = '22023';
  end if;
  if found and c.harvested_parts > 0 then
    raise exception 'harvesting' using errcode = '22023';
  end if;
  if not found or not exists (select 1 from jsonb_array_elements(public._crop_pests(c, public._variety(c.variety), p_now)) x
                               where x->>'kind' = 'snail' and x->>'treated_at' is null) then
    raise exception 'no snails' using errcode = '22023';
  end if;
  update public.crops set picks = picks || jsonb_build_array(jsonb_build_object('t', p_now))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- The farmer gives up the crop; the grain already cut stays, the plot is bare and the lease goes on (§6.1). Not while a
-- harvester runs.
create or replace function public._farm_do_abandon(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_until timestamptz;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  perform public._plot_row(p_room, p_plot);
  if public._farmer(p_room, p_plot, p_now) is distinct from p_account then
    raise exception 'not your plot' using errcode = '22023';
  end if;
  select harvester_until into v_until from public.crops where room_id = p_room and plot_no = p_plot for update;
  if found and v_until is not null then
    raise exception 'harvester busy' using errcode = '22023';
  end if;
  delete from public.crops where room_id = p_room and plot_no = p_plot;
  if not found then
    raise exception 'no crop' using errcode = '22023';
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

revoke all on function public._farm_do_begin_work(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_harvest_part(uuid, uuid, integer, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_rent_harvester(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_harvest(uuid, uuid, integer, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._farm_do_fertilize(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_water(uuid, uuid, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_pick_snails(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_abandon(uuid, uuid, integer, timestamptz) from public, anon, authenticated;

-- The new room RPCs start guarded (anti-cheat §11.3 rules 2 and 6): the lock gate, then bad_plot.
create or replace function public.harvest_part(p_room_id uuid, p_session_token text, p_plot integer, p_success boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'harvest_part', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_harvest_part(p_room_id, v_account, p_plot, p_success, now());
end $$;

create or replace function public.rent_harvester(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'rent_harvester', jsonb_build_object('plot', p_plot), p_room_id,
                           'invalid plot');
  end if;
  return public._farm_do_rent_harvester(p_room_id, v_account, p_plot, now());
end $$;

-- Chú Tám's gift (0015's claim_farm_gift, guarded): a sickle joins the seed and the urê on a first claim (R4).
create or replace function public.claim_farm_gift(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_gifted boolean;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  insert into public.farm_profiles (account_id) values (v_account) on conflict (account_id) do nothing;
  update public.farm_profiles set gift_at = now() where account_id = v_account and gift_at is null;
  v_gifted := found;
  if v_gifted then
    insert into public.inventory (account_id, item_id, qty) values (v_account, 'seed_short', 1), (v_account, 'fert_urea', 1)
    on conflict (account_id, item_id) do update set qty = least(99, public.inventory.qty + 1);
    insert into public.inventory (account_id, item_id, qty) values (v_account, 'tool_sickle', 1)
    on conflict (account_id, item_id) do nothing;
  end if;
  return jsonb_build_object('gifted', v_gifted, 'server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

grant execute on function public.harvest_part(uuid, text, integer, boolean) to anon, authenticated;
grant execute on function public.rent_harvester(uuid, text, integer) to anon, authenticated;
grant execute on function public.claim_farm_gift(text) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected:

```text
v14 smoke ok
0016 twice ok
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
anticheat guards ok
v15.2 model smoke ok
v15.2 field smoke ok
v15.2 harvest smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.2): 0016 harvest — rice in six parts, the harvester, hoa-màu pickings

begin_work replaces the record and gates on the lease (10 s a round, 5 s a
transplant or a picking); harvest_part pays part i of Y(t) behind the 8 s
gate and the 120 s window; rent_harvester charges 500 xu a part left; harvest
now picks hoa màu only. Care refuses a partly cut plot, every action refuses a
running harvester, and the gift adds a sickle. The v15 smoke cuts its rice in
six parts; the guard file has 37 RPCs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0016_v15_2_crops.sql tests/sql/anticheat-guards.sql tests/sql/v15-2-smoke.sql tests/sql/v15-smoke.sql
git commit -F <message file>
```

---

### Task 4: Database — tools and trade: the sprayer's tank, tools at anh Hai's, cô Út buys hoa màu (`0016` section E, second part)

**Files:**
- Modify: `supabase/migrations/0016_v15_2_crops.sql` (append the tools-and-trade part of section E)
- Modify: `tests/sql/v15-2-smoke.sql` (insert the tools part), `tests/sql/anticheat-guards.sql` (the loop calls `load_sprayer` and `sell_produce`: 39 RPCs)

**Interfaces:**
- Consumes: Task 2's `_care_crop`, `_farm_mine`; Task 1's `upland_crops.price_per_kg`, `produce_stock`, `farm_profiles.tank_item` / `tank_charges`; from `0013`: `_use_item(account, item)` (`no item`), `_owns`, `_pay`, `_wallet_lock`; from `0015`: `_ac_account`, `_ac_flag`, and `buy_farm_item`'s body (its guard, soft `kind_mismatch` and hard `bad_qty`).
- Produces:
  - `_farm_do_spray(room, account, plot, item, now)`: through `_care_crop` (`harvesting`); one `update` uses a tank charge when the tank holds this pesticide and the account owns the sprayer, clearing the item with the last charge (R21), else a bottle from the bag;
  - `load_sprayer(token, item)` (guarded, `_ac_account`): `invalid item` for an unknown item; soft `kind_mismatch` (`invalid item`) for an item of another kind; `no sprayer`; then one bottle becomes 3 charges, replacing what the tank held; answers `{server_now, mine}`;
  - `buy_farm_item(token, item, qty)` (re-created from `0015`): sells kind `tool` too; a tool with a quantity other than 1 is a plain `invalid quantity` (R18), a second one `already owned`;
  - `sell_produce(token, upland, kg)` (guarded, `_ac_account`): after `_wallet_lock`, hard `bad_qty` (`invalid quantity`) for kg null or < 1; `invalid crop`; `not enough crop`; pays `kg × price_per_kg` with reason `produce_sell` (ref `<upland> <kg> kg`); answers `{server_now, mine}`.
- Produces (smoke): the tools part, printing `v15.2 tools smoke ok`.

- [ ] **Step 1: Write the smoke's tools part and the guard loop's two calls**

**tests/sql/v15-2-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- tools and trade (§7, §9, R18, R21): anh Hai's tools, the tank, cô Út buys hoa màu ----------
insert into smoke select 'room4', room_id::text from public.create_room('Bình phun', 'pw', (select v from smoke where k = 't2'));

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid; r jsonb;
begin
  perform pg_temp.set_coins(a2, 20000);
  delete from public.inventory where account_id = a2 and item_id like 'tool\_%';
  -- a tool is bought once, one at a time (R18)
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 2)', t2, 'tool_sickle')) = 'invalid quantity', 'one at a time';
  r := public.buy_farm_item(t2, 'tool_sickle', 0);
  assert r->'anticheat'->>'code' = 'bad_qty' and r->'anticheat'->>'error' = 'invalid quantity', 'a quantity outside 1–99 stays hard';
  r := public.buy_farm_item(t2, 'tool_sickle', 1);
  assert r->'mine'->'items'->'tool_sickle' = '1' and r->'mine'->'coins' = '18500'
     and exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'farm_buy' and delta = -1500
                  and ref = 'tool_sickle x1'), 'a sickle for 1 500 xu';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t2, 'tool_sickle')) = 'already owned', 'bought once';
  r := public.buy_farm_item(t2, 'rod_bamboo', 1);
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0', 'no fishing gear here';
  -- the sprayer: nothing to load before it is bought; then an empty tank
  assert pg_temp.err(format('select public.load_sprayer(%L, %L)', t2, 'spray_insect')) = 'no sprayer', 'no sprayer';
  r := public.buy_farm_item(t2, 'tool_sprayer', 1);
  assert r->'mine'->'tank' = '{"item": null, "charges": 0}' and r->'mine'->'coins' = '13500', 'an empty tank';
  r := public.load_sprayer(t2, 'fert_urea');
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid item',
    'a fertilizer is a soft kind_mismatch';
  assert pg_temp.err(format('select public.load_sprayer(%L, %L)', t2, 'spray_x')) = 'invalid item', 'an unknown item';
  assert pg_temp.err(format('select public.load_sprayer(%L, %L)', t2, 'spray_insect')) = 'no item', 'no bottle';
  perform public.buy_farm_item(t2, 'spray_insect', 3);
  perform public.buy_farm_item(t2, 'spray_fungus', 2);
  r := public.load_sprayer(t2, 'spray_insect');
  assert r->'mine'->'tank' = '{"item": "spray_insect", "charges": 3}' and r->'mine'->'items'->'spray_insect' = '2',
    'one bottle, three charges';
end $$;

-- Spraying from the tank (§7, R21), and spraying as care (R8, R32).
do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room4')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; r jsonb;
begin
  perform pg_temp.set_coins(a2, 100000);
  perform public._farm_do_rent(room, a2, 5, t);
  perform public._farm_do_rent(room, a2, 6, t);
  insert into public.crops (room_id, plot_no, farmer_id, kind, prepared_at, water_log)
  values (room, 5, a2, 'upland', t, jsonb_build_array(jsonb_build_object('t', t, 'l', 1)));
  s := public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '1 minute');
  assert s->'mine'->'tank' = '{"item": "spray_insect", "charges": 2}' and s->'mine'->'items'->'spray_insect' = '2',
    'a matching spray uses a charge, not a bottle';
  s := public._farm_do_spray(room, a2, 5, 'spray_fungus', t + interval '2 minutes');
  assert s->'mine'->'tank' = '{"item": "spray_insect", "charges": 2}' and s->'mine'->'items'->'spray_fungus' = '1',
    'another pesticide uses a bottle';
  perform public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '3 minutes');
  s := public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '4 minutes');
  assert s->'mine'->'tank' = '{"item": null, "charges": 0}' and s->'mine'->'items'->'spray_insect' = '2'
     and (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a2),
    'the third charge empties the tank';
  s := public._farm_do_spray(room, a2, 5, 'spray_insect', t + interval '5 minutes');
  assert s->'mine'->'tank' = '{"item": null, "charges": 0}' and s->'mine'->'items'->'spray_insect' = '1', 'then a bottle';
  assert jsonb_array_length((pg_temp.crop(room, 5)).spray_log) = 5, 'five sprays logged';
  -- a reload pours out what is left
  r := public.load_sprayer(t2, 'spray_fungus');
  perform public._farm_do_spray(room, a2, 5, 'spray_fungus', t + interval '6 minutes');
  r := public.load_sprayer(t2, 'spray_insect');
  assert r->'mine'->'tank' = '{"item": "spray_insect", "charges": 3}' and r->'mine'->'items'->'spray_insect' is null
     and r->'mine'->'items'->'spray_fungus' is null, 'the fungicide left in the tank is gone';
  -- no charge without the sprayer
  delete from public.inventory where account_id = a2 and item_id = 'tool_sprayer';
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 5, %L, %L)', room, a2, 'spray_insect', t + interval '7 minutes'))
         = 'no item', 'the tank needs its sprayer';
  assert (select tank_item = 'spray_insect' and tank_charges = 3 from public.farm_profiles where account_id = a2)
     and public._farm_mine(a2)->'tank' = 'null', 'the tank is kept, and hidden';
  insert into public.inventory (account_id, item_id, qty) values (a2, 'tool_sprayer', 1);
  -- spraying is care: not on a partly cut plot, nor under a running harvester
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, harvested_parts,
                            harvested_kg)
  values (room, 6, a2, 'nep', t - interval '64 hours', t - interval '63 hours', t - interval '60 hours', t - interval '50 hours', 2, 25);
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 6, %L, %L)', room, a2, 'spray_insect', t + interval '8 minutes'))
         = 'harvesting', 'partly cut';
  update public.crops set harvester_at = t + interval '8 minutes', harvester_until = t + interval '8 minutes 30 seconds'
   where room_id = room and plot_no = 6;
  assert pg_temp.err(format('select public._farm_do_spray(%L, %L, 6, %L, %L)', room, a2, 'spray_insect', t + interval '8 minutes'))
         = 'harvester busy', 'a running harvester';
  assert (select tank_charges from public.farm_profiles where account_id = a2) = 3, 'nothing used';
end $$;

-- cô Út buys hoa màu (§9, §11.4): kg · price_per_kg, ledger reason produce_sell.
do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid; r jsonb; c0 integer;
begin
  insert into public.produce_stock (account_id, upland, kg) values (a2, 'bap', 30)
  on conflict (account_id, upland) do update set kg = excluded.kg;
  r := public.sell_produce(t2, 'bap', 0);
  assert r->'anticheat'->>'code' = 'bad_qty' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid quantity'
     and r - 'anticheat' = '{}', format('kg 0 %s', r);
  assert public.sell_produce(t2, 'bap', null)->'anticheat'->>'code' = 'bad_qty', 'kg null';
  assert pg_temp.err(format('select public.sell_produce(%L, %L, 1)', t2, 'lua')) = 'invalid crop', 'an unknown crop';
  assert pg_temp.err(format('select public.sell_produce(%L, null, 1)', t2)) = 'invalid crop', 'no crop';
  assert pg_temp.err(format('select public.sell_produce(%L, %L, 31)', t2, 'bap')) = 'not enough crop', 'more than held';
  assert pg_temp.err(format('select public.sell_produce(%L, %L, 1)', t2, 'ot')) = 'not enough crop', 'none held';
  c0 := (select coins from public.wallets where account_id = a2);
  r := public.sell_produce(t2, 'bap', 30);
  assert r->'mine'->'coins' = to_jsonb(c0 + 30 * 460) and r->'mine'->'produce'->'bap' is null and r->>'server_now' is not null
     and exists (select 1 from public.coin_ledger where account_id = a2 and reason = 'produce_sell' and delta = 13800
                  and ref = 'bap 30 kg'), 'sold 30 kg of bắp for 13 800 xu';
  assert has_function_privilege('anon', 'public.load_sprayer(text,text)', 'execute')
     and has_function_privilege('anon', 'public.sell_produce(text,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.buy_farm_item(text,text,integer)', 'execute'), 'public RPCs';
end $$;

select 'v15.2 tools smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/anticheat-guards.sql — edit 1 of 3.** Replace:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 37 game RPCs, and
--    the four reads still answer.
```

with:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 39 game RPCs, and
--    the four reads still answer.
```

**tests/sql/anticheat-guards.sql — edit 2 of 3.** Replace:

```sql
    format('select public.harvest_part(%L, %L, 5, true)', room, t),
    format('select public.rent_harvester(%L, %L, 5)', room, t)] loop
    n := n + 1;
```

with:

```sql
    format('select public.harvest_part(%L, %L, 5, true)', room, t),
    format('select public.rent_harvester(%L, %L, 5)', room, t),
    format('select public.load_sprayer(%L, %L)', t, 'spray_insect'),
    format('select public.sell_produce(%L, %L, 1)', t, 'khoai')] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 3 of 3.** Replace:

```sql
  end loop;
  assert n = 37, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 39, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` (the first smoke that ends with the guard file), with `function public.load_sprayer(unknown, unknown) does not exist` in the log.

- [ ] **Step 3: Write the tools-and-trade part of section E**

**supabase/migrations/0016_v15_2_crops.sql.** Append at the end of the file, after a blank line:

```sql
-- Xịt thuốc (§7): a charge from the sprayer's tank when it holds this pesticide, else a bottle from the bag. One statement
-- uses the charge and clears the item at the last one (R21), and only while the account owns the sprayer.
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
  c := public._care_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  update public.farm_profiles
     set tank_charges = tank_charges - 1, tank_item = case when tank_charges = 1 then null else tank_item end
   where account_id = p_account and tank_item = p_item and tank_charges >= 1 and public._owns(p_account, 'tool_sprayer');
  if not found then
    perform public._use_item(p_account, p_item);
  end if;
  update public.crops set spray_log = spray_log || jsonb_build_array(jsonb_build_object('t', p_now, 'item', p_item))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

revoke all on function public._farm_do_spray(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;

-- Nạp thuốc (§7): one bottle becomes 3 charges of that pesticide; what was left in the tank is poured out. An item of
-- another kind is a soft kind_mismatch (§11.5); an unknown one is the plain refusal.
create or replace function public.load_sprayer(p_session_token text, p_item_id text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_kind text;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  select kind into v_kind from public.shop_items where id = p_item_id;
  if not found then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  if v_kind <> 'pesticide' then
    return public._ac_flag(v_account, 'kind_mismatch', 'load_sprayer', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           null, 'invalid item', false);
  end if;
  if not public._owns(v_account, 'tool_sprayer') then
    raise exception 'no sprayer' using errcode = '22023';
  end if;
  perform public._use_item(v_account, p_item_id);
  insert into public.farm_profiles (account_id, tank_item, tank_charges) values (v_account, p_item_id, 3)
  on conflict (account_id) do update set tank_item = excluded.tank_item, tank_charges = excluded.tank_charges;
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- anh Hai's shop (§9, R18): seeds, fertilizers, pesticides and tools. A fishing item is a soft kind_mismatch and a
-- quantity outside 1–99 a hard bad_qty, as in 0015. A tool is bought once, one at a time: another quantity is a plain
-- refusal, because the cached v15.1 shop shows a stepper on tool rows.
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
  if it.kind not in ('seed', 'fertilizer', 'pesticide', 'tool') then
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_farm_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return public._ac_flag(v_account, 'bad_qty', 'buy_farm_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  if it.kind = 'tool' and p_qty <> 1 then
    raise exception 'invalid quantity' using errcode = '22023';
  end if;
  if it.kind = 'tool' and public._owns(v_account, it.id) then
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

-- cô Út buys hoa màu fresh, by the kg (§9, S10): kg · price_per_kg, ledger reason produce_sell. A kg under 1 is a hard
-- bad_qty after the wallet lock (§11.5).
create or replace function public.sell_produce(p_session_token text, p_upland text, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; u public.upland_crops; ps public.produce_stock;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  if p_kg is null or p_kg < 1 then
    return public._ac_flag(v_account, 'bad_qty', 'sell_produce', jsonb_build_object('upland', left(p_upland, 32), 'kg', p_kg),
                           null, 'invalid quantity');
  end if;
  u := public._upland(p_upland);
  if u.id is null then
    raise exception 'invalid crop' using errcode = '22023';
  end if;
  select * into ps from public.produce_stock where account_id = v_account and upland = p_upland for update;
  if not found or ps.kg < p_kg then
    raise exception 'not enough crop' using errcode = '22023';
  end if;
  update public.produce_stock set kg = kg - p_kg where account_id = v_account and upland = p_upland;
  perform public._pay(v_account, p_kg * u.price_per_kg, 'produce_sell', p_upland || ' ' || p_kg || ' kg');
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

grant execute on function public.load_sprayer(text, text) to anon, authenticated;
grant execute on function public.buy_farm_item(text, text, integer) to anon, authenticated;
grant execute on function public.sell_produce(text, text, integer) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected:

```text
v14 smoke ok
0016 twice ok
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
anticheat guards ok
v15.2 model smoke ok
v15.2 field smoke ok
v15.2 harvest smoke ok
v15.2 tools smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.2): 0016 tools and trade — the sprayer's tank, tools at anh Hai's, cô Út buys hoa màu

spray uses a tank charge when the tank holds that pesticide (one statement
clears the item at the last one), else a bottle, and refuses a partly cut
plot. load_sprayer turns a bottle into 3 charges; buy_farm_item sells tools
once, one at a time; sell_produce pays kg · price_per_kg. The guard file has
39 RPCs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0016_v15_2_crops.sql tests/sql/anticheat-guards.sql tests/sql/v15-2-smoke.sql
git commit -F <message file>
```

---

### Task 5: Database — beds: lên luống, planting, tending; the wipe takes the hoa màu (`0016` sections E, last part, and F)

**Files:**
- Modify: `supabase/migrations/0016_v15_2_crops.sql` (append the beds part of section E and section F)
- Modify: `tests/sql/v15-2-smoke.sql` (insert the beds part), `tests/sql/anticheat-guards.sql` (the loop calls `prepare_beds`, `plant_crop` and `tend_crop`: all 42 RPCs)

**Interfaces:**
- Consumes: Tasks 1–4; from `0013`: `_has_crop(room, plot)`, `_farm_do_soak`, `_farm_do_sow`, `_farm_do_transplant` (their bodies); from `0015` (as of `de9ae10`): `_ac_holdings` and `_ac_wipe` (their bodies), `_ac_play`, `_ac_flag`.
- Produces:
  - `_farm_do_prepare_beds(room, account, plot, now)`: the farmer only (`not your plot`), `crop exists`; a crop row of kind `upland` at Ẩm (water 1); withdraws the owner's listing and sublease offer, as làm đất does;
  - `_farm_do_plant(room, account, plot, item, now)`: `invalid item` unless a hoa-màu seed; `not prepared`, `wrong crop` (a paddy), `crop exists` (already planted), `need water` (not Ẩm); uses one bag; a cutting or a direct sowing sets P, an ớt starts its nursery (`sow_at`); one secret `pest_rolls` entry per config slot;
  - `_farm_do_tend(room, account, plot, act, now)`: `not prepared`; `wrong crop` unless the act is one of this crop's `act` cares; `wrong phase` before P; `too fast` at 20 entries; appends `{t, act}` to `work_log`;
  - `_farm_do_soak` and `_farm_do_sow` refuse beds (`wrong crop`); `_farm_do_transplant` sets P on an ớt nursery (rice keeps `transplant_at`);
  - the guarded RPCs `prepare_beds(room, token, plot)`, `plant_crop(room, token, plot, item)` (then soft `kind_mismatch` for an existing item that is not a seed) and `tend_crop(room, token, plot, act)` (then hard `bad_work`, `invalid act`, unless `lat_day` / `vun_goc`), each `_ac_play` and `bad_plot` first;
  - **F:** `_ac_holdings(account)` gains `produce [{upland, kg}]`, `tank {item, charges}` and, per crop, `kind`, `upland`, `plant_at`, `parts`, `harvester_until`; `_ac_wipe(account, by)` also deletes `produce_stock` and empties the tank.
- Produces (smoke): the beds part — the refusals in order; khoai, bắp and ớt planted by their methods; a khoai season with a treated weevil (197 kg); an ớt season with three pickings, the last ending the lease, sold to cô Út; the RPCs' guards and envelopes (`tend_crop('x')`, `sell_produce` with kg 0); the wipe — printing `v15.2 beds smoke ok`.

- [ ] **Step 1: Write the smoke's beds part and the guard loop's last three calls**

**tests/sql/v15-2-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- hoa màu (§8.9): beds, planting, care, a season of each method, and the wipe (§11.5) ----------
insert into smoke select 'room5', room_id::text from public.create_room('Hoa màu', 'pw', (select v from smoke where k = 't3'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room5')::uuid), 'pw', v)
  from smoke where k = 't1';
create function pg_temp.give(a uuid, it text, n integer) returns void language sql
as $$ insert into public.inventory (account_id, item_id, qty) values (a, it, n)
      on conflict (account_id, item_id) do update set qty = excluded.qty $$;

-- Lên luống, planting and tending: the refusals in their order (§11.4).
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room5')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; c jsonb; i integer;
begin
  perform pg_temp.set_coins(a1, 100000);
  perform pg_temp.set_coins(a3, 100000);
  perform public._farm_do_rent(room, a3, 5, t);
  perform public._farm_do_rent(room, a3, 6, t);
  perform public._farm_do_rent(room, a1, 7, t);
  perform pg_temp.give(a3, 'seed_khoai', 2);
  perform pg_temp.give(a3, 'seed_bap', 1);
  perform pg_temp.give(a3, 'seed_short', 1);
  perform pg_temp.give(a1, 'seed_ot', 1);
  perform pg_temp.give(a1, 'seed_short', 1);
  -- lên luống: a bare plot of mine, at Ẩm
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 11, %L)', room, a3, t)) = 'invalid plot', 'plot 11';
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 5, %L)', room, a1, t)) = 'not your plot', 'a3''s plot';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_khoai', t)) = 'not prepared',
    'a bare plot';
  s := public._farm_do_prepare_beds(room, a3, 5, t);
  c := pg_temp.plot(s, 5)->'crop';
  assert c->>'kind' = 'upland' and c->>'phase' = 'prepared' and c->'water' = '1' and c->'upland' = 'null', format('beds %s', c);
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 5, %L)', room, a3, t)) = 'crop exists', 'once';
  assert pg_temp.err(format('select public._farm_do_prepare(%L, %L, 5, %L)', room, a3, t)) = 'crop exists', 'no paddy on beds';
  assert pg_temp.err(format('select public._farm_do_soak(%L, %L, 5, %L, %L)', room, a3, 'seed_short', t)) = 'wrong crop',
    'no rice seed on beds';
  assert pg_temp.err(format('select public._farm_do_sow(%L, %L, 5, %L)', room, a3, t)) = 'wrong crop', 'no sowing on beds';
  -- a paddy takes no hoa màu, and a soaked rice seed is not làm đất
  perform public._farm_do_prepare(room, a3, 6, t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 6, %L, %L)', room, a3, 'seed_bap', t)) = 'wrong crop', 'a paddy';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 6, %L, %L)', room, a3, 'vun_goc', t)) = 'wrong crop', 'no tending';
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 6, %L)', room, a3, t)) = 'crop exists', 'a paddy first';
  perform public._farm_do_abandon(room, a3, 6, t);
  perform public._farm_do_prepare_beds(room, a3, 6, t);
  perform public._farm_do_soak(room, a1, 7, 'seed_short', t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 7, %L, %L)', room, a1, 'seed_ot', t)) = 'not prepared',
    'a soaked seed';
  assert pg_temp.err(format('select public._farm_do_prepare_beds(%L, %L, 7, %L)', room, a1, t)) = 'crop exists', 'soaking';
  perform public._farm_do_abandon(room, a1, 7, t);
  perform public._farm_do_prepare_beds(room, a1, 7, t);
  -- planting: a hoa-màu seed, on beds with nothing planted, at Ẩm, from the bag
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_short', t)) = 'invalid item',
    'a rice seed';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'fert_urea', t)) = 'invalid item',
    'not a seed';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 8, %L, %L)', room, a3, 'seed_khoai', t)) = 'not your plot',
    'plot 8';
  perform public._farm_do_water(room, a3, 5, 1, t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_khoai', t)) = 'need water', 'Đẫm';
  perform public._farm_do_water(room, a3, 5, -1, t);
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_ot', t)) = 'no item', 'no ớt seed';
  -- bón lót before P, then khoai (a cutting: P now), bắp (direct: P now) and ớt (a nursery: sow_at now, P later)
  perform pg_temp.give(a3, 'fert_manure', 1);
  perform pg_temp.give(a3, 'fert_phosphate', 1);
  perform public._farm_do_fertilize(room, a3, 5, 'fert_manure', t);
  perform public._farm_do_fertilize(room, a3, 5, 'fert_phosphate', t);
  s := public._farm_do_plant(room, a3, 5, 'seed_khoai', t + interval '1 minute');
  c := pg_temp.plot(s, 5)->'crop';
  assert c->>'upland' = 'khoai' and c->>'phase' = 'root' and (c->>'plant_at')::timestamptz = t + interval '1 minute'
     and c->'sow_at' = 'null' and c->'picking' = '1' and c->'pickings' = '1' and s->'mine'->'items'->'seed_khoai' = '1',
    format('khoai %s', c);
  assert (select jsonb_array_length(pest_rolls) = 1 and pest_rolls->0->>'slot' = '1' and (pest_rolls->0->>'u_hit')::float8 < 1
            from public.crops where room_id = room and plot_no = 5), 'one secret roll per pest slot';
  assert pg_temp.plot(s, 5)::text not like '%u_hit%', 'the rolls stay secret';
  assert pg_temp.err(format('select public._farm_do_plant(%L, %L, 5, %L, %L)', room, a3, 'seed_khoai', t + interval '1 minute'))
         = 'crop exists', 'planted already';
  s := public._farm_do_plant(room, a3, 6, 'seed_bap', t + interval '1 minute');
  assert pg_temp.plot(s, 6)->'crop'->>'phase' = 'sprout'
     and (select jsonb_array_length(pest_rolls) from public.crops where room_id = room and plot_no = 6) = 2, 'bắp, two slots';
  s := public._farm_do_plant(room, a1, 7, 'seed_ot', t + interval '1 minute');
  c := pg_temp.plot(s, 7)->'crop';
  assert c->>'phase' = 'nursery' and (c->>'sow_at')::timestamptz = t + interval '1 minute' and c->'plant_at' = 'null'
     and c->'pickings' = '3', format('the ớt nursery %s', c);
  -- tending: one of the crop's acts, after P, recorded whenever it is done; at most 20 a crop
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 5, %L, %L)', room, a3, 'vun_goc', t + interval '24 hours'))
         = 'wrong crop', 'khoai has no vun gốc';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 7, %L, %L)', room, a1, 'lat_day', t + interval '2 hours'))
         = 'wrong crop', 'ớt has no act';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 5, %L, %L)', room, a3, 'lat_day', t)) = 'wrong phase', 'before P';
  for i in 1 .. 20 loop
    s := public._farm_do_tend(room, a3, 6, 'vun_goc', t + interval '20 hours');
  end loop;
  assert pg_temp.plot(s, 6)->'crop'->'log'->'work'->0 = jsonb_build_object('t', t + interval '20 hours', 'act', 'vun_goc')
     and jsonb_array_length(pg_temp.plot(s, 6)->'crop'->'log'->'work') = 20, 'recorded';
  assert pg_temp.err(format('select public._farm_do_tend(%L, %L, 6, %L, %L)', room, a3, 'vun_goc', t + interval '21 hours'))
         = 'too fast', 'twenty at most';
end $$;

-- A khoai season by the book (§8.8): 200 kg, less one hour of a treated weevil = 197 kg.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room5')::uuid;
        p timestamptz := (select v from smoke where k = 'now')::timestamptz + interval '1 minute'; s jsonb; c jsonb;
begin
  -- the weevil (slot 1, 24–40 h) is due at P + 32 h, on a Khô bed (×2)
  update public.crops set pest_rolls = '[{"slot": 1, "u_time": 0.5, "u_hit": 0.1}]' where room_id = room and plot_no = 5;
  perform pg_temp.give(a3, 'fert_potash', 1);
  perform public._farm_do_fertilize(room, a3, 5, 'fert_potash', p + interval '20 hours');
  s := public._farm_do_tend(room, a3, 5, 'lat_day', p + interval '28 hours');
  assert pg_temp.plot(s, 5)->'crop'->>'phase' = 'tuber', 'tuber at 28 h';
  c := pg_temp.plot(public._field_view(room, a3, p + interval '32 hours'), 5)->'crop';
  assert c->'pests' = jsonb_build_array(jsonb_build_object('kind', 'weevil', 'since', p + interval '32 hours', 'treated_at', null)),
    format('the weevil %s', c->'pests');
  perform pg_temp.give(a3, 'spray_insect', 1);
  s := public._farm_do_spray(room, a3, 5, 'spray_insect', p + interval '33 hours');
  assert pg_temp.plot(s, 5)->'crop'->'pests'->0->>'treated_at' is not null, 'treated an hour later';
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 5, %L, %L)', room, a3, 'harvest',
                            p + interval '47 hours 59 minutes 59 seconds')) = 'wrong phase', 'R_1 − 1 s';
  perform public._farm_do_begin_work(room, a3, 5, 'harvest', p + interval '48 hours');
  s := public._farm_do_harvest(room, a3, 5, 1, p + interval '48 hours 2 seconds');
  assert s->'harvest' = '{"upland": "khoai", "kg": 197, "k": 1, "pickings": 1, "done": true}'
     and pg_temp.produce(a3, 'khoai') = 197, format('khoai %s', s->'harvest');
  assert pg_temp.plot(s, 5)->'crop' = 'null' and pg_temp.plot(s, 5)->'lease' = 'null', 'dug; the lease ended';
end $$;

-- An ớt season (§8.8): ươm, trồng cây con after the 2 s action, three pickings 12 h apart; the last ends the lease.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; t1 text := (select v from smoke where k = 't1');
        room uuid := (select v from smoke where k = 'room5')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        p timestamptz := t + interval '12 hours 1 minute'; s jsonb; k integer; kg integer[] := '{}'; r jsonb; c0 integer;
begin
  update public.crops set pest_rolls = '[{"slot": 1, "u_time": 0.5, "u_hit": 0.99}, {"slot": 2, "u_time": 0.5, "u_hit": 0.99}]'
   where room_id = room and plot_no = 7;
  -- sown at t + 1 min, ready 10 h later; the bed dried to Khô at t + 12 h, so it is watered back to Ẩm first
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a1, 'transplant', p - interval '2 seconds'))
         = 'need water', 'Khô';
  perform public._farm_do_water(room, a1, 7, 1, t + interval '12 hours');
  perform public._farm_do_begin_work(room, a1, 7, 'transplant', p - interval '2 seconds');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 7, 1, %L)', room, a1, p - interval '1 second')) = 'too fast',
    'the 2 s gate';
  s := public._farm_do_transplant(room, a1, 7, 5.0, p);
  assert pg_temp.plot(s, 7)->'crop'->>'phase' = 'root' and (pg_temp.plot(s, 7)->'crop'->>'plant_at')::timestamptz = p
     and (pg_temp.crop(room, 7)).transplant_at is null and (pg_temp.crop(room, 7)).work is null, 'P is set; quality ignored';
  -- pickings at R_1 = P + 46 h, R_2 = R_1 + 12 h, R_3 = R_1 + 24 h
  for k in 1 .. 3 loop
    if k > 1 then
      assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a1, 'harvest',
                                p + make_interval(hours => 46 + 12 * (k - 1)) - interval '1 second')) = 'wrong phase',
        format('R_%s − 1 s', k);
    end if;
    perform public._farm_do_begin_work(room, a1, 7, 'harvest', p + make_interval(hours => 46 + 12 * (k - 1)));
    kg := kg || (public._up_yield(pg_temp.crop(room, 7), public._upland('ot'), 1.0, k,
                                  p + make_interval(hours => 46 + 12 * (k - 1), secs => 2))->>'kg')::int;
    s := public._farm_do_harvest(room, a1, 7, 1, p + make_interval(hours => 46 + 12 * (k - 1), secs => 2));
    assert s->'harvest' = jsonb_build_object('upland', 'ot', 'kg', kg[k], 'k', k, 'pickings', 3, 'done', k = 3),
      format('picking %s: %s', k, s->'harvest');
  end loop;
  assert kg[1] > kg[2] and kg[2] > kg[3] and pg_temp.produce(a1, 'ot') = kg[1] + kg[2] + kg[3], format('40/35/25 %s', kg);
  assert pg_temp.plot(s, 7)->'crop' = 'null' and pg_temp.plot(s, 7)->'lease' = 'null', 'the last picking ends the lease';
  -- cô Út buys it all
  c0 := (select coins from public.wallets where account_id = a1);
  r := public.sell_produce(t1, 'ot', kg[1] + kg[2] + kg[3]);
  assert r->'mine'->'coins' = to_jsonb(c0 + (kg[1] + kg[2] + kg[3]) * 1590) and r->'mine'->'produce'->'ot' is null, 'sold';
end $$;

-- The RPCs (§11.4, §11.5): guarded, flagged as the spec lists, public.
do $$
declare t3 text := (select v from smoke where k = 't3'); room uuid := (select v from smoke where k = 'room5')::uuid; r jsonb;
begin
  r := public.prepare_beds(room, t3, 0);
  assert r->'anticheat'->>'code' = 'bad_plot' and r->'anticheat'->>'error' = 'invalid plot', format('prepare_beds %s', r);
  r := public.plant_crop(room, t3, null, 'seed_bap');
  assert r->'anticheat'->>'code' = 'bad_plot', format('plant_crop %s', r);
  r := public.plant_crop(room, t3, 6, 'fert_urea');
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid item',
    format('a fertilizer is a soft kind_mismatch %s', r);
  assert pg_temp.err(format('select public.plant_crop(%L, %L, 6, %L)', room, t3, 'seed_short')) = 'invalid item',
    'a rice seed is the core''s refusal';
  r := public.tend_crop(room, t3, 6, 'x');
  assert r->'anticheat'->>'code' = 'bad_work' and r->'anticheat'->>'strike' = '0' and r->'anticheat'->>'error' = 'invalid act'
     and r - 'anticheat' = '{}', format('tend_crop x %s', r);
  assert public.tend_crop(room, t3, 6, null)->'anticheat'->>'code' = 'bad_work', 'no act';
  assert public.tend_crop(room, t3, 11, 'vun_goc')->'anticheat'->>'code' = 'bad_plot', 'plot 11';
  assert has_function_privilege('anon', 'public.prepare_beds(uuid,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.plant_crop(uuid,text,integer,text)', 'execute')
     and has_function_privilege('anon', 'public.tend_crop(uuid,text,integer,text)', 'execute'), 'public RPCs';
end $$;

-- The wipe (§11.5): the snapshot lists the hoa màu, the tank and the crops' new fields; the stock goes, the tank empties.
insert into smoke select 't5', token from public.register('smoke152_e_' || floor(random() * 1e9)::text, 'pw123456');
do $$
declare a5 uuid := public._auth_account((select v from smoke where k = 't5')); room uuid := (select v from smoke where k = 'room5')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; h jsonb;
begin
  perform pg_temp.set_coins(a5, 50000);
  perform public._farm_do_rent(room, a5, 9, t);
  insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
  values (room, 9, a5, 'upland', 'bap', t, t, jsonb_build_array(jsonb_build_object('t', t, 'l', 1)));
  insert into public.produce_stock (account_id, upland, kg) values (a5, 'khoai', 50), (a5, 'ot', 0);
  perform pg_temp.give(a5, 'tool_sprayer', 1);
  insert into public.farm_profiles (account_id, tank_item, tank_charges) values (a5, 'spray_fungus', 2);
  h := public._ac_holdings(a5);
  assert h->'produce' = '[{"kg": 50, "upland": "khoai"}, {"kg": 0, "upland": "ot"}]'
     and h->'tank' = '{"item": "spray_fungus", "charges": 2}', format('holdings %s %s', h->'produce', h->'tank');
  assert h->'crops'->0 @> jsonb_build_object('plot_no', 9, 'kind', 'upland', 'variety', null, 'upland', 'bap', 'plant_at', t,
                                             'parts', 0, 'harvester_until', null), format('crops %s', h->'crops');
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a5, 2, 'pending_wipe', now());
  h := public._ac_wipe(a5, null);
  assert h->'produce'->0->'kg' = '50', 'the snapshot keeps them';
  assert not exists (select 1 from public.produce_stock where account_id = a5)
     and (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = a5)
     and public._farm_mine(a5)->'tank' = 'null', 'the hoa màu is gone and the tank is empty';
end $$;

select 'v15.2 beds smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/anticheat-guards.sql — edit 1 of 3.** Replace:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 39 game RPCs, and
--    the four reads still answer.
```

with:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 42 game RPCs, and
--    the four reads still answer.
```

**tests/sql/anticheat-guards.sql — edit 2 of 3.** Replace:

```sql
    format('select public.load_sprayer(%L, %L)', t, 'spray_insect'),
    format('select public.sell_produce(%L, %L, 1)', t, 'khoai')] loop
    n := n + 1;
```

with:

```sql
    format('select public.load_sprayer(%L, %L)', t, 'spray_insect'),
    format('select public.sell_produce(%L, %L, 1)', t, 'khoai'),
    format('select public.prepare_beds(%L, %L, 5)', room, t),
    format('select public.plant_crop(%L, %L, 5, %L)', room, t, 'seed_bap'),
    format('select public.tend_crop(%L, %L, 5, %L)', room, t, 'vun_goc')] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 3 of 3.** Replace:

```sql
  end loop;
  assert n = 39, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 42, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql`, with `function public.prepare_beds(unknown, unknown, integer) does not exist` in the log.

- [ ] **Step 3: Write the beds part of section E and section F**

**supabase/migrations/0016_v15_2_crops.sql.** Append at the end of the file, after a blank line:

```sql
-- Lên luống (§8.9, S7): a bare plot becomes raised beds at Ẩm (water 1), and the season's crop is hoa màu. Farming
-- withdraws the owner's listing and sublease offer, as làm đất does.
create or replace function public._farm_do_prepare_beds(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
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
  if public._has_crop(p_room, p_plot) then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  insert into public.crops (room_id, plot_no, farmer_id, kind, prepared_at, water_log)
  values (p_room, p_plot, p_account, 'upland', p_now, jsonb_build_array(jsonb_build_object('t', p_now, 'l', 1)));
  update public.field_plots set sale_price = null, sublease_price = null where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Trồng / gieo / ươm (§8.9): one bag of a hoa-màu seed on beds with nothing planted, at Ẩm. A cutting or a direct sowing
-- sets P now; a nursery crop starts its nursery (sow_at) and gets P at its transplant. The pest chances are rolled now,
-- one per config slot, and stay secret.
create or replace function public._farm_do_plant(p_room uuid, p_account uuid, p_plot integer, p_item text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; u public.upland_crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  u := public._upland((select s.upland from public.shop_items s where s.id = p_item and s.kind = 'seed'));
  if u.id is null then
    raise exception 'invalid item' using errcode = '22023';
  end if;
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  if c.kind <> 'upland' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  if c.upland is not null then
    raise exception 'crop exists' using errcode = '22023';
  end if;
  if public._water_at(c.water_log, p_now) <> 1 then
    raise exception 'need water' using errcode = '22023';
  end if;
  perform public._use_item(p_account, p_item);
  update public.crops
     set upland = u.id,
         sow_at = case when u.method = 'nursery' then p_now end,
         plant_at = case when u.method = 'nursery' then null else p_now end,
         pest_rolls = (select coalesce(jsonb_agg(jsonb_build_object('slot', (x->>'slot')::int, 'u_time', random(), 'u_hit', random())
                                                 order by (x->>'slot')::int), '[]'::jsonb)
                         from jsonb_array_elements(u.pests) x)
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Lật dây, vun gốc (§8.5, §8.9): one of this crop's act cares, after P, recorded whenever it is done (the plot panel warns
-- outside the windows). The care model reads every entry, so a crop keeps at most 20.
create or replace function public._farm_do_tend(p_room uuid, p_account uuid, p_plot integer, p_act text, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; u public.upland_crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.prepared_at is null then
    raise exception 'not prepared' using errcode = '22023';
  end if;
  u := public._upland(c.upland);
  if c.kind <> 'upland'
     or not exists (select 1 from jsonb_array_elements(u.cares) x where x->>'kind' = 'act' and x->>'id' = p_act) then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
  if c.plant_at is null or p_now < c.plant_at then
    raise exception 'wrong phase' using errcode = '22023';
  end if;
  if jsonb_array_length(c.work_log) >= 20 then
    raise exception 'too fast' using errcode = '22023';
  end if;
  update public.crops set work_log = work_log || jsonb_build_array(jsonb_build_object('t', p_now, 'act', p_act))
   where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Ngâm ủ (0013's body): rice seed only, so beds raise 'wrong crop'.
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
  if v_has and c.kind = 'upland' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
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

-- Gieo mạ (0013's body): rice only.
create or replace function public._farm_do_sow(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops;
begin
  perform public._field_open(p_room, p_now);
  perform public._wallet_lock(p_account);
  c := public._farm_crop(p_room, p_plot, p_account, p_now);
  if c.kind = 'upland' then
    raise exception 'wrong crop' using errcode = '22023';
  end if;
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

-- Cấy lúa, or trồng cây ớt con (§8.9): after the 2 s action; rice gets transplant_at, an ớt nursery gets P. The reported
-- quality is ignored (D1; v15.3 decides how it comes back).
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
  if c.kind = 'upland' then
    update public.crops set plant_at = p_now, work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  else
    update public.crops set transplant_at = p_now, q_transplant = 1.0, work = null, work_started_at = null
     where room_id = p_room and plot_no = p_plot;
  end if;
  return public._field_view(p_room, p_account, p_now);
end; $$;

revoke all on function public._farm_do_prepare_beds(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_plant(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_tend(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_soak(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_sow(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_transplant(uuid, uuid, integer, double precision, timestamptz)
  from public, anon, authenticated;

create or replace function public.prepare_beds(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'prepare_beds', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_prepare_beds(p_room_id, v_account, p_plot, now());
end $$;

-- kind_mismatch (§11.5) is soft: an existing item of another kind. An unknown item or a rice seed is the core's refusal.
create or replace function public.plant_crop(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_kind text;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'plant_crop', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  select kind into v_kind from public.shop_items where id = p_item_id;
  if found and v_kind <> 'seed' then
    return public._ac_flag(v_account, 'kind_mismatch', 'plant_crop', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           p_room_id, 'invalid item', false);
  end if;
  return public._farm_do_plant(p_room_id, v_account, p_plot, p_item_id, now());
end $$;

-- bad_work (R19): the plot panel sends only the acts of the crop's config, which are lat_day and vun_goc.
create or replace function public.tend_crop(p_room_id uuid, p_session_token text, p_plot integer, p_act text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'tend_crop', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_act is null or p_act not in ('lat_day', 'vun_goc') then
    return public._ac_flag(v_account, 'bad_work', 'tend_crop', jsonb_build_object('plot', p_plot, 'act', left(p_act, 32)),
                           p_room_id, 'invalid act');
  end if;
  return public._farm_do_tend(p_room_id, v_account, p_plot, p_act, now());
end $$;

grant execute on function public.prepare_beds(uuid, text, integer) to anon, authenticated;
grant execute on function public.plant_crop(uuid, text, integer, text) to anon, authenticated;
grant execute on function public.tend_crop(uuid, text, integer, text) to anon, authenticated;

-- ---------- F. Anti-cheat touch points (§11.5): the holdings and the wipe gain the hoa màu and the tank ----------
-- What a wipe removes (0015's body): the snapshot also lists the hoa màu and the tank, and each crop its kind, crop, P,
-- cut parts and harvester.
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
    'announcements', (select count(*) from public.chat_messages m where m.system and m.about_account_id = p_account))
$$;

-- The wipe (0015's body): it also deletes the hoa màu and empties the tank; the farm profile (the gift) stays.
create or replace function public._ac_wipe(p_account uuid, p_by uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_snap jsonb := public._ac_holdings(p_account); v_id bigint; v_coins integer;
begin
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
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

revoke all on function public._ac_holdings(uuid) from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v152-sql.sh"`
Expected:

```text
v14 smoke ok
0016 twice ok
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
v15.2 model smoke ok
v15.2 field smoke ok
v15.2 harvest smoke ok
v15.2 tools smoke ok
v15.2 beds smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.2): 0016 beds — lên luống, planting, tending; the wipe takes the hoa màu

prepare_beds makes Ẩm raised beds; plant_crop sets P (cutting, direct) or
starts the ớt nursery and rolls one secret chance per pest slot; tend_crop
records the crop's acts after P (20 at most); soak and sow refuse beds, and
transplant sets P on ớt. The wipe deletes produce_stock and empties the tank,
and the holdings list both. The guard file has all 42 RPCs.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0016_v15_2_crops.sql tests/sql/anticheat-guards.sql tests/sql/v15-2-smoke.sql
git commit -F <message file>
```

---

### Task 6: Client catalog, state and RPCs — hoa-màu crops, tools, parts, the harvester

**Files:**
- Modify: `lib/game/farm/catalog.ts`, `lib/game/farm/state.ts`, `lib/game/farm/rpc.ts`, `lib/game/farm/messages.ts` (the four new pests' names and remedies)
- Test: `tests/unit/farm-catalog.test.ts`, `tests/unit/farm-state.test.ts`, `tests/unit/farm-rpc.test.ts`, `tests/unit/farm-messages.test.ts` (the new behaviour); `tests/unit/farm-actions.test.ts`, `farm-handbook.test.ts`, `farm-land.test.ts`, `farm-overlays.test.tsx`, `farm-panels.test.tsx`, `farm-plot-panel.test.tsx`, `game-crop-art.test.ts`, `anticheat-pins.test.tsx` (their fixtures gain the new required fields: `uplands: []`, the crop's `kind` / `upland` / `plantAt` / `picking` / `pickings` / `parts` / `harvester`, the log's `work` / `harvests` / `harvestedKg`, the account's `produce` / `tank`) (modify)

**Interfaces:**
- Consumes: from v15.1: `farmItemFromRow`, `varietyFromRow`, `FarmItem`, `Variety`, `parseFieldState`, `CropView`, `CropLog`, `FarmMine`, `call(fn, args)`, `mineAnswer`, `fieldAnswer`, `FieldAction`, `actionCall`; Tasks 1–5's `upland_crops` rows, `field_state` fields and RPCs.
- Produces:
  - `catalog.ts`: `FarmItemKind` gains `"tool"` (`FARM_KINDS`); `UplandMethod`, `UplandStage`, `UplandCare`, `UplandPest`, `UplandCrop` (camel-cased config row), `UplandCropRow`, `uplandFromRow(row)`, `uplandHours(u, k)`; `FarmCatalog { varieties; uplands; items }`; `FarmItem.upland`; the constants `TOOL_SICKLE`, `TOOL_SPRAYER`, `HARVEST_PARTS` 6, `HARVESTER_PART_PRICE` 500, `HARVESTER_MS` 30 000, `PART_GATE_MS` 8 000, `PART_WINDOW_MS` 120 000, `PART_WAIT_MS` 9 000, `LEASE_ROUND_MS` 10 000, `LEASE_ACTION_MS` 5 000, `TANK_CHARGES` 3, `TEND_MAX` 20; `harvesterPrice(parts)`, `producePrice(kg, u)`; `describeFarmItem(it, varieties, uplands = [])` with the §9 seed and tool lines;
  - `state.ts`: `PestKind` gains `weevil`, `armyworm`, `thrips`, `anthracnose`; `WorkEntry { t, act }`, `HarvestEntry { t, k, kg }`; `CropLog` gains `work`, `harvests`, `harvestedKg`; `CropView` gains `kind: "rice" | "upland"`, `upland`, `plantAt`, `picking`, `pickings`, `parts`, `harvester: { startedAt; endsAt } | null` (defaults for an answer from before `0016`: rice, uncut, no harvester); `Tank { item; charges }`; `FarmMine` gains `produce: Record<string, number>` and `tank: Tank | null`;
  - `rpc.ts`: `fetchFarmCatalog` also reads `upland_crops` (none when the table is missing: PGRST205 / 42P01); `RPCS_152` (the seven new RPC names); `FieldAction` gains `prepare_beds`, `plant`, `tend`, `harvest_part`, `rent_harvester`; `PartAnswer`, `PickingAnswer`; `FieldAnswer` gains `harvestPart` and `picking`; `loadSprayer(token, itemId)`, `sellProduce(token, upland, kg)`;
  - `messages.ts`: `PEST_NAME` and `PEST_REMEDY` for the four new pests.

- [ ] **Step 1: Write the failing tests and the fixture updates**

**tests/unit/farm-catalog.test.ts — edit 1 of 4.** Replace:

```ts
import {
  describeFarmItem, farmItemFromRow, ricePrice, ripeAfterHours, varietyFromRow, type FarmItemRow, type VarietyRow,
} from "@/lib/game/farm/catalog";
```

with:

```ts
import {
  describeFarmItem, farmItemFromRow, harvesterPrice, producePrice, ricePrice, ripeAfterHours, uplandFromRow, uplandHours, varietyFromRow,
  type FarmItemRow, type UplandCropRow, type VarietyRow,
} from "@/lib/game/farm/catalog";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/farm-catalog.test.ts — edit 2 of 4.** Replace:

```ts
    expect(farmItemFromRow(item({ id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, fert: "npk" }))).toEqual({
      id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, sortOrder: 0, variety: null, fert: "npk", pestTarget: null,
      capacity: null,
    });
  });
```

with:

```ts
    expect(farmItemFromRow(item({ id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, fert: "npk" }))).toEqual({
      id: "fert_npk", kind: "fertilizer", name: "Phân NPK", price: 90, sortOrder: 0, variety: null, upland: null, fert: "npk",
      pestTarget: null, capacity: null,
    });
    expect(farmItemFromRow(item({ id: "seed_ot", upland: "ot" })).upland).toBe("ot");
    expect(farmItemFromRow(item({ id: "tool_sickle", kind: "tool" })).kind).toBe("tool");
  });
```

**tests/unit/farm-catalog.test.ts — edit 3 of 4.** Replace:

```ts
    expect(d({ kind: "fertilizer", fert: "npk" })).toBe("Bón thúc đẻ nhánh hoặc đón đòng");
    expect(d({ kind: "pesticide", pest_target: "hopper" })).toBe("Trị rầy nâu");
    expect(d({ kind: "pesticide", pest_target: "fungus" })).toBe("Trị đạo ôn lá và đạo ôn cổ bông");
    expect(d({ kind: "critter_box", capacity: 15 })).toBe("Đựng 15 con cua, ốc");
```

with:

```ts
    expect(d({ kind: "fertilizer", fert: "npk" })).toBe("Bón thúc đẻ nhánh hoặc đón đòng");
    expect(d({ kind: "pesticide", pest_target: "insect" })).toBe("Trị sâu cuốn lá, sùng khoai, sâu keo, bọ trĩ");
    expect(d({ kind: "pesticide", pest_target: "hopper" })).toBe("Trị rầy nâu");
    expect(d({ kind: "pesticide", pest_target: "fungus" })).toBe("Trị đạo ôn lá, đạo ôn cổ bông, thán thư");
    expect(d({ kind: "critter_box", capacity: 15 })).toBe("Đựng 15 con cua, ốc");
```

**tests/unit/farm-catalog.test.ts — edit 4 of 4.** Append at the end of the file, after a blank line:

```ts
describe("hoa-màu crops and tools (v15.2 §8.2, §9)", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const [khoai, bap, ot] = UPLANDS;
  it("reads the config rows", () => {
    expect(UPLANDS.map((u) => [u.id, u.method, u.harvestAnim, u.pickings])).toEqual([
      ["khoai", "cutting", "dig", [100]], ["bap", "direct", "pick", [100]], ["ot", "nursery", "pick", [40, 35, 25]],
    ]);
    expect(ot).toMatchObject({
      name: "Ớt", plantLabel: "Ươm hạt ớt", transplantLabel: "Trồng cây ớt con", harvestLabel: "Hái ớt", baseKg: 60, pricePerKg: 1590,
      nurseryReadyH: 10, nurseryOldH: 18, ripeWater: [0, 1], ripeWindowH: 8, overRate: 0.03, lostAfterH: 24, pickGapH: 12, rotFromH: null,
    });
    expect(ot.stages[1]).toEqual({ id: "grow", name: "Phát triển thân lá", untilH: 22, water: [1, 2] });
    expect(khoai.cares[1]).toEqual({
      id: "lat_day", kind: "act", name: "Lật dây", items: [], halfItems: [], fromH: 24, toH: 32, halfFromH: 32, halfToH: 40,
      penHalf: 0.05, penMissing: 0.1,
    });
    expect(ot.pests[1]).toEqual({
      slot: 2, kind: "anthracnose", name: "Thán thư", fromH: 40, toH: 64, chance: 0.4, dryMult: 1, wetMult: 2, remedy: "spray_fungus",
    });
    expect([khoai.rotFromH, khoai.rotRate, khoai.rotCap]).toEqual([22, 0.03, 0.5]);
  });
  it("counts each picking's ripe hour from P", () => {
    expect([uplandHours(khoai, 1), uplandHours(bap, 1), uplandHours(ot, 1), uplandHours(ot, 2), uplandHours(ot, 3)])
      .toEqual([48, 60, 46, 58, 70]);
  });
  it("describes the seeds from their crop, and the tools", () => {
    const d = (over: Partial<FarmItemRow>) => describeFarmItem(farmItemFromRow(item(over)), VARIETIES, UPLANDS);
    expect(d({ upland: "khoai" })).toBe("Trồng dây · chín ~48 giờ · 200 kg/thửa · 265 xu/kg");
    expect(d({ upland: "bap" })).toBe("Gieo thẳng · chín ~60 giờ · 150 kg/thửa · 460 xu/kg");
    expect(d({ upland: "ot" })).toBe("Ươm 10 giờ rồi trồng · lứa đầu ~46 giờ, 3 lứa · 60 kg/thửa · 1.590 xu/kg");
    expect(d({ id: "tool_sickle", kind: "tool" })).toBe("Gặt lúa tay, 6 phần — mua một lần");
    expect(d({ id: "tool_sprayer", kind: "tool" })).toBe("Nạp 1 chai thuốc được 3 lần xịt — mua một lần");
  });
  it("prices the harvester per part left, and hoa màu by the kg", () => {
    expect([0, 2, 5].map(harvesterPrice)).toEqual([3000, 2000, 500]);
    expect(producePrice(180, khoai)).toBe(47_700);
  });
});
```

**tests/unit/farm-state.test.ts — edit 1 of 3.** Replace:

```ts
      fert: [{ t: ms("2026-09-24T17:00:00Z"), item: "fert_urea" }], spray: [], picks: [ms("2026-09-25T09:30:00Z")],
      qTransplant: 1.05,
    });
```

with:

```ts
      fert: [{ t: ms("2026-09-24T17:00:00Z"), item: "fert_urea" }], spray: [], picks: [ms("2026-09-25T09:30:00Z")],
      qTransplant: 1.05, work: [], harvests: [], harvestedKg: 0,
    });
```

**tests/unit/farm-state.test.ts — edit 2 of 3.** Replace:

```ts
    expect(s.mine).toEqual({
      items: { seed_nep: 2 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, giftClaimed: true, ownedPlot: 3, farming: [7],
      myOffers: [{ id: "o1", plot: 2, price: 8000, expiresAt: ms("2026-09-26T10:00:00Z"), buyer: null }],
```

with:

```ts
    expect(s.mine).toEqual({
      items: { seed_nep: 2 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, giftClaimed: true, produce: {}, tank: null,
      ownedPlot: 3, farming: [7],
      myOffers: [{ id: "o1", plot: 2, price: 8000, expiresAt: ms("2026-09-26T10:00:00Z"), buyer: null }],
```

**tests/unit/farm-state.test.ts — edit 3 of 3.** Replace:

```ts
    expect(parseFieldState({ server_now: T, plots: [] })).toBeNull();
  });
```

with:

```ts
    expect(parseFieldState({ server_now: T, plots: [] })).toBeNull();
  });
});

describe("v15.2 (§11.6)", () => {
  const plot = (crop: Record<string, unknown>) => ({
    no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: DAT, lease: null, offers: 0, crop,
  });
  const answer = (crop: Record<string, unknown>, mine: Record<string, unknown> = {}) => ({
    ...ANSWER, plots: [plot(crop)], mine: { ...ANSWER.mine, ...mine },
  });
  it("reads a rice crop from before 0016 as a whole, uncut plot", () => {
    const c = parseFieldState(answer({ variety: "nep", phase: "ripe", water: 1 }))!.plots[0].crop!;
    expect(c).toMatchObject({ kind: "rice", upland: null, plantAt: null, picking: null, pickings: 1, parts: 0, harvester: null });
  });
  it("reads the cut parts and a running harvester", () => {
    const c = parseFieldState(answer({
      kind: "rice", variety: "nep", phase: "ripe", water: 1, parts: 2, picking: null, pickings: 1,
      harvester: { started_at: "2026-09-25T09:59:50+00:00", ends_at: "2026-09-25T10:00:20+00:00" },
      log: { water: [], fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [], harvested_kg: 25 },
    }))!.plots[0].crop!;
    expect(c).toMatchObject({ parts: 2, harvester: { startedAt: ms("2026-09-25T09:59:50Z"), endsAt: ms("2026-09-25T10:00:20Z") } });
    expect(c.log?.harvestedKg).toBe(25);
  });
  it("reads beds, their crop, P, the pickings and the hoa-màu logs", () => {
    const c = parseFieldState(answer({
      kind: "upland", variety: null, upland: "ot", phase: "flower", prepared_at: "2026-09-24T00:00:00+00:00",
      sow_at: "2026-09-24T01:00:00+00:00", plant_at: "2026-09-24T12:00:00+00:00", water: 1, picking: 1, pickings: 3, parts: 0,
      harvester: null, pests: [{ kind: "thrips", since: "2026-09-24T20:00:00+00:00", treated_at: null }],
      log: {
        water: [], fert: [], spray: [], picks: [], q_transplant: 1, harvested_kg: 0,
        work: [{ t: "2026-09-24T20:00:00+00:00", act: "vun_goc" }, { t: "2026-09-24T21:00:00+00:00" }],
        harvests: [{ t: "2026-09-25T09:00:00+00:00", k: 1, kg: 24 }],
      },
    }))!.plots[0].crop!;
    expect(c).toMatchObject({
      kind: "upland", upland: "ot", phase: "flower", plantAt: ms("2026-09-24T12:00:00Z"), picking: 1, pickings: 3,
      pests: [{ kind: "thrips", since: ms("2026-09-24T20:00:00Z"), treatedAt: null }],
    });
    expect(c.log?.work).toEqual([{ t: ms("2026-09-24T20:00:00Z"), act: "vun_goc" }]);
    expect(c.log?.harvests).toEqual([{ t: ms("2026-09-25T09:00:00Z"), k: 1, kg: 24 }]);
    // bare beds: nothing planted, no pickings yet
    const bare = parseFieldState(answer({ kind: "upland", upland: null, phase: "prepared", water: 1, picking: null, pickings: 0 }))!;
    expect(bare.plots[0].crop).toMatchObject({ kind: "upland", upland: null, picking: null, pickings: 0 });
  });
  it("reads the hoa màu in stock and the sprayer's tank", () => {
    const m = (tank: unknown) => parseFieldState(answer({ variety: "nep" }, { produce: { khoai: 180, bap: 0 }, tank }))!.mine;
    expect(m({ item: "spray_insect", charges: 2 })).toMatchObject({ produce: { khoai: 180 }, tank: { item: "spray_insect", charges: 2 } });
    expect(m({ item: null, charges: 0 }).tank).toEqual({ item: null, charges: 0 });
    expect(m(null).tank).toBeNull();
    expect(parseFarmMine({ items: {}, rice: {}, coins: 0, gift_claimed: true })).toMatchObject({ produce: {}, tank: null });
  });
```

**tests/unit/farm-rpc.test.ts — edit 1 of 7.** Replace:

```ts
import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import { actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice } from "@/lib/game/farm/rpc";
```

with:

```ts
import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import {
  actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, RPCS_152, sellProduce, sellRice,
} from "@/lib/game/farm/rpc";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/farm-rpc.test.ts — edit 2 of 7.** Replace:

```ts
const filters: unknown[][] = [];
const chain = (rows: unknown[]) => {
  const c: Record<string, unknown> = {};
```

with:

```ts
const filters: unknown[][] = [];
const chain = (rows: unknown[] | null, error: unknown = null) => {
  const c: Record<string, unknown> = {};
```

**tests/unit/farm-rpc.test.ts — edit 3 of 7.** Replace:

```ts
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return c;
```

with:

```ts
  c.order = () => c;
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve);
  return c;
```

**tests/unit/farm-rpc.test.ts — edit 4 of 7.** Replace:

```ts

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
```

with:

```ts

const VARIETY_ROW = { id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 };
const ITEM_ROW = { id: "seed_ot", kind: "seed", name: "Hạt ớt giống", price: 1500, sort_order: 60, variety: null, fert: null,
  pest_target: null, capacity: null, upland: "ot" };

describe("fetchFarmCatalog", () => {
  it("loads the varieties, the hoa-màu crops and the farm items once per page", async () => {
    const crops = (fixtures as unknown as { crops: unknown[] }).crops;
    h.from.mockImplementation((table: string) => chain(table === "rice_varieties" ? [VARIETY_ROW] : table === "upland_crops" ? crops : [ITEM_ROW]));
    const a = await fetchFarmCatalog();
    expect(await fetchFarmCatalog()).toBe(a);
    expect(h.from.mock.calls.map(([t]) => t)).toEqual(["rice_varieties", "upland_crops", "shop_items"]);
    expect(a.varieties[0]).toMatchObject({ id: "nep", baseKg: 75 });
    expect(a.uplands.map((u) => u.id)).toEqual(["khoai", "bap", "ot"]);
    expect(a.items[0]).toMatchObject({ id: "seed_ot", kind: "seed", upland: "ot" });
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box", "tool"]]]);
  });
  it("has no hoa-màu crops before 0016, and fails on any other error", async () => {
    vi.resetModules();
    const fresh = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "upland_crops"
      ? chain(null, { code: "PGRST205", message: "Could not find the table 'public.upland_crops' in the schema cache" })
      : chain(table === "rice_varieties" ? [VARIETY_ROW] : [ITEM_ROW]));
    expect((await fresh()).uplands).toEqual([]);
    vi.resetModules();
    const again = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "upland_crops" ? chain(null, { code: "42501", message: "denied" }) : chain([]));
    await expect(again()).rejects.toMatchObject({ code: "42501" });
  });
```

**tests/unit/farm-rpc.test.ts — edit 5 of 7.** Replace:

```ts
  });
  it("sends an action with the room and the token, and reads a harvest", async () => {
```

with:

```ts
  });
  it("names the v15.2 room actions (§11.4)", () => {
    expect(actionCall({ kind: "prepare_beds", plot: 6 })).toEqual(["prepare_beds", { p_plot: 6 }]);
    expect(actionCall({ kind: "plant", plot: 6, item: "seed_ot" })).toEqual(["plant_crop", { p_plot: 6, p_item_id: "seed_ot" }]);
    expect(actionCall({ kind: "tend", plot: 6, act: "vun_goc" })).toEqual(["tend_crop", { p_plot: 6, p_act: "vun_goc" }]);
    expect(actionCall({ kind: "harvest_part", plot: 3, success: false })).toEqual(["harvest_part", { p_plot: 3, p_success: false }]);
    expect(actionCall({ kind: "rent_harvester", plot: 3 })).toEqual(["rent_harvester", { p_plot: 3 }]);
    expect([...RPCS_152].sort()).toEqual([
      "harvest_part", "load_sprayer", "plant_crop", "prepare_beds", "rent_harvester", "sell_produce", "tend_crop",
    ]);
  });
  it("reads a hand part and a picking", async () => {
    h.rpc.mockResolvedValue({ data: { ...FIELD, harvest_part: { variety: "nep", kg: 13, parts: 2, total: 25, done: false } }, error: null });
    const r = await fieldAction("r", "tok", { kind: "harvest_part", plot: 3, success: true });
    expect(h.rpc).toHaveBeenCalledWith("harvest_part", { p_room_id: "r", p_session_token: "tok", p_plot: 3, p_success: true });
    expect(r).toMatchObject({ harvest: null, picking: null, harvestPart: { variety: "nep", kg: 13, parts: 2, total: 25, done: false } });
    h.rpc.mockResolvedValue({ data: { ...FIELD, harvest: { upland: "ot", kg: 24, k: 1, pickings: 3, done: false } }, error: null });
    expect(await fieldAction("r", "tok", { kind: "harvest", plot: 6, quality: 1 })).toMatchObject({
      harvest: null, harvestPart: null, picking: { upland: "ot", kg: 24, k: 1, pickings: 3, done: false },
    });
    h.rpc.mockResolvedValue({ data: FIELD, error: null });
    expect(await fieldAction("r", "tok", { kind: "harvest_part", plot: 3, success: false })).toMatchObject({
      harvest: null, harvestPart: null, picking: null,
    });
  });
  it("sends an action with the room and the token, and reads a harvest", async () => {
```

**tests/unit/farm-rpc.test.ts — edit 6 of 7.** Replace:

```ts
    expect(await sellRice("tok", "nep", true, 10)).toEqual({
      serverNow: "2026-09-25T10:00:00+00:00", mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true },
    });
```

with:

```ts
    expect(await sellRice("tok", "nep", true, 10)).toEqual({
      serverNow: "2026-09-25T10:00:00+00:00",
      mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true, produce: {}, tank: null },
    });
```

**tests/unit/farm-rpc.test.ts — edit 7 of 7.** Replace:

```ts
    expect((await claimFarmGift("tok")).gifted).toBe(true);
  });
```

with:

```ts
    expect((await claimFarmGift("tok")).gifted).toBe(true);
  });
  it("loads the sprayer and sells hoa màu (v15.2)", async () => {
    const mine = { ...MINE, produce: { khoai: 20 }, tank: { item: "spray_insect", charges: 3 } };
    h.rpc.mockResolvedValue({ data: { server_now: "2026-09-25T10:00:00+00:00", mine }, error: null });
    expect((await loadSprayer("tok", "spray_insect")).mine.tank).toEqual({ item: "spray_insect", charges: 3 });
    expect(h.rpc).toHaveBeenLastCalledWith("load_sprayer", { p_session_token: "tok", p_item_id: "spray_insect" });
    expect((await sellProduce("tok", "khoai", 160)).mine.produce).toEqual({ khoai: 20 });
    expect(h.rpc).toHaveBeenLastCalledWith("sell_produce", { p_session_token: "tok", p_upland: "khoai", p_kg: 160 });
  });
```

**tests/unit/farm-messages.test.ts.** Replace:

```ts
      snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
    });
```

with:

```ts
      snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
      weevil: "spray_insect", armyworm: "spray_insect", thrips: "spray_insect", anthracnose: "spray_fungus",
    });
```

**tests/unit/farm-actions.test.ts — edit 1 of 3.** Replace:

```ts
  varieties: [nep],
  items: [
```

with:

```ts
  varieties: [nep],
  uplands: [],
  items: [
```

**tests/unit/farm-actions.test.ts — edit 2 of 3.** Replace:

```ts
const ME = { id: "me", name: "Me" };
const mine = (items: Record<string, number>): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true });
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });
```

with:

```ts
const ME = { id: "me", name: "Me" };
const mine = (items: Record<string, number>): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null });
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });
```

**tests/unit/farm-actions.test.ts — edit 3 of 3.** Replace:

```ts
const crop = (over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 3]], fert: Array<[number, string]> = []): CropView => ({
  variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null, water: 0, waterSetAt: null,
  pests: [], excessN: false, ripe: false, rottedAt: null,
  log: { water: water.map(([h, l]) => ({ t: at(h), l })), fert: fert.map(([h, i]) => ({ t: at(h), item: i })), spray: [], picks: [], qTransplant: 1 },
  ...over,
```

with:

```ts
const crop = (over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 3]], fert: Array<[number, string]> = []): CropView => ({
  kind: "rice", variety: "nep", upland: null, phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null,
  plantAt: null, water: 0, waterSetAt: null, pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1, parts: 0,
  harvester: null,
  log: {
    water: water.map(([h, l]) => ({ t: at(h), l })), fert: fert.map(([h, i]) => ({ t: at(h), item: i })), spray: [], picks: [],
    qTransplant: 1, work: [], harvests: [], harvestedKg: 0,
  },
  ...over,
```

**tests/unit/farm-handbook.test.ts.** Replace:

```ts
    const crop = (over: Partial<CropView>): CropView => ({
      variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12), water: 2, waterSetAt: at(12),
      pests: [], excessN: false, ripe: false, rottedAt: null, log: null, ...over,
    });
```

with:

```ts
    const crop = (over: Partial<CropView>): CropView => ({
      kind: "rice", variety: "nep", upland: null, phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12),
      plantAt: null, water: 2, waterSetAt: at(12), pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1,
      parts: 0, harvester: null, log: null, ...over,
    });
```

**tests/unit/farm-land.test.ts.** Replace:

```ts
const mine = (coins: number): FieldMine => ({
  items: {}, rice: {}, coins, giftClaimed: true, ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
});
```

with:

```ts
const mine = (coins: number): FieldMine => ({
  items: {}, rice: {}, coins, giftClaimed: true, produce: {}, tank: null, ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
});
```

**tests/unit/farm-overlays.test.tsx.** Replace:

```tsx
  varieties: [varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 })],
  items: [farmItemFromRow({ id: "fert_urea", kind: "fertilizer", name: "Phân urê", price: 60, sort_order: 30, variety: null, fert: "urea", pest_target: null, capacity: null })],
```

with:

```tsx
  varieties: [varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 })],
  uplands: [],
  items: [farmItemFromRow({ id: "fert_urea", kind: "fertilizer", name: "Phân urê", price: 60, sort_order: 30, variety: null, fert: "urea", pest_target: null, capacity: null })],
```

**tests/unit/farm-panels.test.tsx.** Replace:

```tsx
const CATALOG: FarmCatalog = {
  varieties: [
```

with:

```tsx
const CATALOG: FarmCatalog = {
  uplands: [],
  varieties: [
```

**tests/unit/farm-plot-panel.test.tsx.** Replace:

```tsx
const CATALOG: FarmCatalog = {
  varieties: [nep],
```

with:

```tsx
const CATALOG: FarmCatalog = {
  uplands: [],
  varieties: [nep],
```

**tests/unit/game-crop-art.test.ts — edit 1 of 3.** Replace:

```ts
const crop = (over: Partial<CropView> = {}): CropView => ({
  variety: "nep", phase: "tillering", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12), water: 2, waterSetAt: at(12),
  pests: [], excessN: false, ripe: false, rottedAt: null, log: null, ...over,
});
const plot = (over: Partial<PlotView> = {}): PlotView => ({
```

with:

```ts
const crop = (over: Partial<CropView> = {}): CropView => ({
  kind: "rice", variety: "nep", upland: null, phase: "tillering", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12),
  plantAt: null, water: 2, waterSetAt: at(12), pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1,
  parts: 0, harvester: null, log: null, ...over,
});
const NO_LOG = { work: [], harvests: [], harvestedKg: 0 };
const plot = (over: Partial<PlotView> = {}): PlotView => ({
```

**tests/unit/game-crop-art.test.ts — edit 2 of 3.** Replace:

```ts
    expect(plotLook(5, crop({ pests }), nep, at(22))).toMatchObject({ pests: ["hopper"], wobble: false });
    const log = { water: [], fert: [], spray: [], picks: [], qTransplant: 0.95 };
    expect(plotLook(5, crop({ log }), nep, at(22))?.wobble).toBe(true);
```

with:

```ts
    expect(plotLook(5, crop({ pests }), nep, at(22))).toMatchObject({ pests: ["hopper"], wobble: false });
    const log = { water: [], fert: [], spray: [], picks: [], qTransplant: 0.95, ...NO_LOG };
    expect(plotLook(5, crop({ log }), nep, at(22))?.wobble).toBe(true);
```

**tests/unit/game-crop-art.test.ts — edit 3 of 3.** Replace:

```ts
    expect(plotLook(5, crop({ water: 3 }), nep, at(40))?.water).toBe(3);
    const log = { water: [{ t: at(12), l: 3 }], fert: [], spray: [], picks: [], qTransplant: 1 };
    // one level lost per 12 h: 3 at 12 h → 1 at 36 h
```

with:

```ts
    expect(plotLook(5, crop({ water: 3 }), nep, at(40))?.water).toBe(3);
    const log = { water: [{ t: at(12), l: 3 }], fert: [], spray: [], picks: [], qTransplant: 1, ...NO_LOG };
    // one level lost per 12 h: 3 at 12 h → 1 at 36 h
```

**tests/unit/anticheat-pins.test.tsx — edit 1 of 3.** Replace:

```tsx
  varieties: [nep],
  items: [
```

with:

```tsx
  varieties: [nep],
  uplands: [],
  items: [
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 3.** Replace:

```tsx
  const crop = (over: Partial<CropView>, water: Array<[number, number]>): CropView => ({
    variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null, water: 0, waterSetAt: null,
    pests: [], excessN: false, ripe: false, rottedAt: null,
    log: { water: water.map(([h, l]) => ({ t: at(h), l })), fert: [], spray: [], picks: [], qTransplant: 1 },
    ...over,
```

with:

```tsx
  const crop = (over: Partial<CropView>, water: Array<[number, number]>): CropView => ({
    kind: "rice", variety: "nep", upland: null, phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null,
    plantAt: null, water: 0, waterSetAt: null, pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1,
    parts: 0, harvester: null,
    log: {
      water: water.map(([h, l]) => ({ t: at(h), l })), fert: [], spray: [], picks: [], qTransplant: 1, work: [], harvests: [],
      harvestedKg: 0,
    },
    ...over,
```

**tests/unit/anticheat-pins.test.tsx — edit 3 of 3.** Replace:

```tsx
  it("the plot panel sends its plot's number, pumps or drains one level, and works only at transplanting and harvesting", () => {
    const mine: FarmMine = { items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1 }, rice: {}, coins: 0, giftClaimed: true };
    const plots = [
```

with:

```tsx
  it("the plot panel sends its plot's number, pumps or drains one level, and works only at transplanting and harvesting", () => {
    const mine: FarmMine = {
      items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1 }, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null,
    };
    const plots = [
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-handbook.test.ts tests/unit/farm-land.test.ts tests/unit/farm-messages.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-rpc.test.ts tests/unit/farm-state.test.ts tests/unit/game-crop-art.test.ts`
Expected: FAIL — `tests/unit/farm-catalog.test.ts` does not load (`uplandFromRow` is not there yet), and 13 tests fail in `farm-messages`, `farm-rpc` and `farm-state` (no new pests, no `upland_crops`, no new actions or answers, no `loadSprayer`, no new state fields); 88 pass.

- [ ] **Step 3: Implement**

**lib/game/farm/catalog.ts — edit 1 of 11.** Replace:

```ts
// Client side of the farm config (spec §7, §8.1, §9): varieties, farm items, the land prices and number formats. Pure.

export type FarmItemKind = "seed" | "fertilizer" | "pesticide" | "critter_box";
export type FertKind = "manure" | "phosphate" | "urea" | "potash" | "npk";
```

with:

```ts
// Client side of the farm config (spec §7, §8.1, §9; v15.2 §8.2, §9): varieties, hoa-màu crops, farm items, the land
// prices and number formats. Pure.

export type FarmItemKind = "seed" | "fertilizer" | "pesticide" | "critter_box" | "tool";
export type FertKind = "manure" | "phosphate" | "urea" | "potash" | "npk";
```

**lib/game/farm/catalog.ts — edit 2 of 11.** Replace:

```ts
/** The shop_items kinds the farm shop sells (the fishing shop sells the others). */
export const FARM_KINDS: readonly FarmItemKind[] = ["seed", "fertilizer", "pesticide", "critter_box"];
const FERTS: readonly string[] = ["manure", "phosphate", "urea", "potash", "npk"];
```

with:

```ts
/** The shop_items kinds the farm shop sells (the fishing shop sells the others). */
export const FARM_KINDS: readonly FarmItemKind[] = ["seed", "fertilizer", "pesticide", "critter_box", "tool"];
const FERTS: readonly string[] = ["manure", "phosphate", "urea", "potash", "npk"];
```

**lib/game/farm/catalog.ts — edit 3 of 11.** Replace:

```ts
  sortOrder: number;
  /** seed: the variety it grows. */
  variety: string | null;
  fert: FertKind | null;
```

with:

```ts
  sortOrder: number;
  /** A rice seed: the variety it grows. */
  variety: string | null;
  /** A hoa-màu seed (v15.2): the upland crop it grows. */
  upland: string | null;
  fert: FertKind | null;
```

**lib/game/farm/catalog.ts — edit 4 of 11.** Replace:

```ts

export interface FarmCatalog { varieties: Variety[]; items: FarmItem[] }
```

with:

```ts

export type UplandMethod = "cutting" | "direct" | "nursery";

/** A growth stage (v15.2 §8.2): it lasts until `untilH` hours after P, and accepts these water levels. */
export interface UplandStage { id: string; name: string; untilH: number; water: number[] }

/** A care row (§8.5): a fertilizer window ("fert") or a hand job ("act"). */
export interface UplandCare {
  id: string;
  kind: "fert" | "act";
  name: string;
  items: string[];
  halfItems: string[];
  fromH: number;
  toH: number;
  halfFromH: number;
  halfToH: number;
  penHalf: number;
  penMissing: number;
}

/** A pest slot (§8.6): its hidden roll fires between fromH and toH after P. */
export interface UplandPest {
  slot: number;
  kind: string;
  name: string;
  fromH: number;
  toH: number;
  chance: number;
  dryMult: number;
  wetMult: number;
  remedy: string;
}

/** A hoa-màu crop, one upland_crops row (§8.2): hours count from P, the planting (or the transplant of a nursery crop). */
export interface UplandCrop {
  id: string;
  name: string;
  sortOrder: number;
  method: UplandMethod;
  plantLabel: string;
  transplantLabel: string | null;
  harvestLabel: string;
  harvestAnim: "dig" | "pick";
  baseKg: number;
  pricePerKg: number;
  nurseryReadyH: number | null;
  nurseryOldH: number | null;
  stages: UplandStage[];
  ripeWater: number[];
  ripeWindowH: number;
  overRate: number;
  lostAfterH: number;
  /** Each picking's share in percent (40, 35, 25). */
  pickings: number[];
  pickGapH: number | null;
  rotFromH: number | null;
  rotRate: number | null;
  rotCap: number | null;
  cares: UplandCare[];
  pests: UplandPest[];
}

export interface FarmCatalog { varieties: Variety[]; uplands: UplandCrop[]; items: FarmItem[] }
```

**lib/game/farm/catalog.ts — edit 5 of 11.** Replace:

```ts
  variety: string | null; fert: string | null; pest_target: string | null; capacity: number | null;
}
```

with:

```ts
  variety: string | null; fert: string | null; pest_target: string | null; capacity: number | null;
  /** From 0016 on. */
  upland?: string | null;
}
export interface UplandCropRow {
  id: string; name: string; sort_order: number; method: string; plant_label: string; transplant_label: string | null;
  harvest_label: string; harvest_anim: string; base_kg: number; price_per_kg: number; nursery_ready_h: number | null;
  nursery_old_h: number | null; stages: unknown; ripe_water: unknown; ripe_window_h: number; over_rate: number;
  lost_after_h: number; pickings: unknown; pick_gap_h: number | null; rot_from_h: number | null; rot_rate: number | null;
  rot_cap: number | null; cares: unknown; pests: unknown;
}
```

**lib/game/farm/catalog.ts — edit 6 of 11.** Replace:

```ts
    id: r.id, kind: (FARM_KINDS as readonly string[]).includes(r.kind) ? (r.kind as FarmItemKind) : "seed", name: r.name,
    price: r.price, sortOrder: r.sort_order, variety: r.variety ?? null,
    fert: r.fert !== null && FERTS.includes(r.fert) ? (r.fert as FertKind) : null,
```

with:

```ts
    id: r.id, kind: (FARM_KINDS as readonly string[]).includes(r.kind) ? (r.kind as FarmItemKind) : "seed", name: r.name,
    price: r.price, sortOrder: r.sort_order, variety: r.variety ?? null, upland: r.upland ?? null,
    fert: r.fert !== null && FERTS.includes(r.fert) ? (r.fert as FertKind) : null,
```

**lib/game/farm/catalog.ts — edit 7 of 11.** Replace:

```ts
    capacity: r.capacity ?? null,
  };
}
```

with:

```ts
    capacity: r.capacity ?? null,
  };
}

const rows = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
const nums = (v: unknown): number[] => (Array.isArray(v) ? v.map(Number).filter(Number.isFinite) : []);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const numOr = (v: unknown, d: number): number => numOrNull(v) ?? d;
const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function uplandFromRow(r: UplandCropRow): UplandCrop {
  return {
    id: r.id, name: r.name, sortOrder: r.sort_order,
    method: r.method === "direct" || r.method === "nursery" ? r.method : "cutting",
    plantLabel: r.plant_label, transplantLabel: r.transplant_label ?? null, harvestLabel: r.harvest_label,
    harvestAnim: r.harvest_anim === "dig" ? "dig" : "pick",
    baseKg: r.base_kg, pricePerKg: r.price_per_kg,
    nurseryReadyH: numOrNull(r.nursery_ready_h), nurseryOldH: numOrNull(r.nursery_old_h),
    stages: rows(r.stages).map((x) => ({ id: text(x.id), name: text(x.name), untilH: numOr(x.until_h, 0), water: nums(x.water) })),
    ripeWater: nums(r.ripe_water), ripeWindowH: numOr(r.ripe_window_h, 0), overRate: numOr(r.over_rate, 0),
    lostAfterH: numOr(r.lost_after_h, 0), pickings: nums(r.pickings), pickGapH: numOrNull(r.pick_gap_h),
    rotFromH: numOrNull(r.rot_from_h), rotRate: numOrNull(r.rot_rate), rotCap: numOrNull(r.rot_cap),
    cares: rows(r.cares).map((x) => ({
      id: text(x.id), kind: x.kind === "act" ? "act" : "fert", name: text(x.name), items: strs(x.items), halfItems: strs(x.half_items),
      fromH: numOr(x.from_h, 0), toH: numOr(x.to_h, 0), halfFromH: numOr(x.half_from_h, 0), halfToH: numOr(x.half_to_h, 0),
      penHalf: numOr(x.pen_half, 0), penMissing: numOr(x.pen_missing, 0),
    })),
    pests: rows(r.pests).map((x) => ({
      slot: numOr(x.slot, 0), kind: text(x.kind), name: text(x.name), fromH: numOr(x.from_h, 0), toH: numOr(x.to_h, 0),
      chance: numOr(x.chance, 0), dryMult: numOr(x.dry_mult, 1), wetMult: numOr(x.wet_mult, 1), remedy: text(x.remedy),
    })),
  };
}

/** Hours from P to picking k's ripe time: the last stage's end, plus pick_gap_h per later picking (0016 `_up_hours`). */
export function uplandHours(u: UplandCrop, k: number): number {
  return (u.stages[u.stages.length - 1]?.untilH ?? 0) + (u.pickGapH ?? 0) * (k - 1);
}
```

**lib/game/farm/catalog.ts — edit 8 of 11.** Replace:

```ts

/** What cô Út pays: dry rice at the full price per kg, wet rice at 70 % (the same integer arithmetic as sell_rice). */
```

with:

```ts

// The v15.2 tools and rules — the server's constants in 0016.
export const TOOL_SICKLE = "tool_sickle";
export const TOOL_SPRAYER = "tool_sprayer";
/** A rice plot is cut in this many parts (v15.2 §6.1). */
export const HARVEST_PARTS = 6;
/** The co-op's harvester: xu per part still uncut, and how long it runs (§6.3, R9). */
export const HARVESTER_PART_PRICE = 500;
export const HARVESTER_MS = 30_000;
/** harvest_part accepts a success from this long after its begin_work, and until the window ends (R6). */
export const PART_GATE_MS = 8_000;
export const PART_WINDOW_MS = 120_000;
/** The client claims a won round this long after the begin_work answer (§6.2). */
export const PART_WAIT_MS = 9_000;
/** begin_work needs this much left on a lease: a rice round, and a transplant or a picking (R11). */
export const LEASE_ROUND_MS = 10_000;
export const LEASE_ACTION_MS = 5_000;
/** One bottle loads the sprayer's tank with this many sprays (§7). */
export const TANK_CHARGES = 3;
/** A hoa-màu crop records at most this many hand jobs (0016 `_farm_do_tend`). */
export const TEND_MAX = 20;

/** What the harvester costs for a plot with `parts` already cut. */
export function harvesterPrice(parts: number): number {
  return HARVESTER_PART_PRICE * (HARVEST_PARTS - parts);
}

/** What cô Út pays for hoa màu, fresh: kg · price_per_kg (sell_produce). */
export function producePrice(kg: number, u: UplandCrop): number {
  return kg * u.pricePerKg;
}

/** What cô Út pays: dry rice at the full price per kg, wet rice at 70 % (the same integer arithmetic as sell_rice). */
```

**lib/game/farm/catalog.ts — edit 9 of 11.** Replace:

```ts

/** The one-line use of a farm item, shown in the shop. */
export function describeFarmItem(it: FarmItem, varieties: readonly Variety[]): string {
  switch (it.kind) {
    case "seed": {
      const v = varieties.find((x) => x.id === it.variety);
```

with:

```ts

/** A hoa-màu seed's line (§9): how it is planted, when it is ripe, the yield and the price. */
function describeUpland(u: UplandCrop): string {
  const how = u.method === "cutting" ? "Trồng dây" : u.method === "direct" ? "Gieo thẳng" : `Ươm ${u.nurseryReadyH ?? 0} giờ rồi trồng`;
  const n = u.pickings.length, h = uplandHours(u, 1);
  return `${how} · ${n > 1 ? `lứa đầu ~${h} giờ, ${n} lứa` : `chín ~${h} giờ`} · ${u.baseKg} kg/thửa · `
    + `${u.pricePerKg.toLocaleString("vi-VN")} xu/kg`;
}

/** The one-line use of a farm item, shown in the shop. */
export function describeFarmItem(it: FarmItem, varieties: readonly Variety[], uplands: readonly UplandCrop[] = []): string {
  switch (it.kind) {
    case "seed": {
      const u = uplands.find((x) => x.id === it.upland);
      if (u) return describeUpland(u);
      const v = varieties.find((x) => x.id === it.variety);
```

**lib/game/farm/catalog.ts — edit 10 of 11.** Replace:

```ts
      switch (it.pestTarget) {
        case "insect": return "Trị sâu cuốn lá";
        case "hopper": return "Trị rầy nâu";
        case "fungus": return "Trị đạo ôn lá và đạo ôn cổ bông";
        default: return "Thuốc bảo vệ thực vật";
```

with:

```ts
      switch (it.pestTarget) {
        case "insect": return "Trị sâu cuốn lá, sùng khoai, sâu keo, bọ trĩ";
        case "hopper": return "Trị rầy nâu";
        case "fungus": return "Trị đạo ôn lá, đạo ôn cổ bông, thán thư";
        default: return "Thuốc bảo vệ thực vật";
```

**lib/game/farm/catalog.ts — edit 11 of 11.** Replace:

```ts
      return `Đựng ${it.capacity ?? 0} con cua, ốc`;
  }
```

with:

```ts
      return `Đựng ${it.capacity ?? 0} con cua, ốc`;
    case "tool":
      return it.id === TOOL_SPRAYER ? "Nạp 1 chai thuốc được 3 lần xịt — mua một lần" : "Gặt lúa tay, 6 phần — mua một lần";
  }
```

**lib/game/farm/state.ts — edit 1 of 13.** Replace:

```ts
// The field_state JSON (spec §11.5), camelCased, with times as ms since the epoch. Pure.

export type Phase = "prepared" | "soaking" | "sprouted" | "seedling" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe";
export type PestKind = "snail" | "leaf_folder" | "hopper" | "leaf_blast" | "neck_blast";

const PHASES: readonly string[] = ["prepared", "soaking", "sprouted", "seedling", "tillering", "panicle", "heading", "ripening", "ripe", "overripe"];
const PESTS: readonly string[] = ["snail", "leaf_folder", "hopper", "leaf_blast", "neck_blast"];
```

with:

```ts
// The field_state JSON (spec §11.5; v15.2 §11.6), camelCased, with times as ms since the epoch. Pure.

export type Phase = "prepared" | "soaking" | "sprouted" | "seedling" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe";
/** Rice pests, then the hoa-màu ones (v15.2 §8.8). */
export type PestKind = "snail" | "leaf_folder" | "hopper" | "leaf_blast" | "neck_blast" | "weevil" | "armyworm" | "thrips" | "anthracnose";

const PHASES: readonly string[] = ["prepared", "soaking", "sprouted", "seedling", "tillering", "panicle", "heading", "ripening", "ripe", "overripe"];
const PESTS: readonly string[] = ["snail", "leaf_folder", "hopper", "leaf_blast", "neck_blast", "weevil", "armyworm", "thrips", "anthracnose"];
```

**lib/game/farm/state.ts — edit 2 of 13.** Replace:

```ts

/** The crop's logs — only its farmer gets them. */
export interface CropLog { water: WaterEntry[]; fert: ItemEntry[]; spray: ItemEntry[]; picks: number[]; qTransplant: number }
```

with:

```ts

/** A hand job on a hoa-màu crop (lật dây, vun gốc). */
export interface WorkEntry { t: number; act: string }
/** A picking taken: picking k gave kg. */
export interface HarvestEntry { t: number; k: number; kg: number }

/** The crop's logs — only its farmer gets them. */
export interface CropLog {
  water: WaterEntry[];
  fert: ItemEntry[];
  spray: ItemEntry[];
  picks: number[];
  qTransplant: number;
  work: WorkEntry[];
  harvests: HarvestEntry[];
  /** Rice: the kg of the parts cut so far. */
  harvestedKg: number;
}
```

**lib/game/farm/state.ts — edit 3 of 13.** Replace:

```ts
export interface CropView {
  variety: string | null;
  phase: Phase;
  preparedAt: number | null;
```

with:

```ts
export interface CropView {
  /** A paddy (rice) or raised beds (hoa màu), chosen at làm đất. */
  kind: "rice" | "upland";
  variety: string | null;
  /** The hoa-màu crop planted on the beds (null until planted). */
  upland: string | null;
  /** Rice: a Phase. Hoa màu: prepared, nursery, a stage id, waiting, ripe, overripe or done. The client works phases
   *  out itself; this is the server's view at its fetch. */
  phase: string;
  preparedAt: number | null;
```

**lib/game/farm/state.ts — edit 4 of 13.** Replace:

```ts
  transplantAt: number | null;
  /** The level now, and when it was last set (it drops one level per 12 h after that). */
```

with:

```ts
  transplantAt: number | null;
  /** Hoa màu: P, the planting (or the ớt transplant). */
  plantAt: number | null;
  /** The level now, and when it was last set (it drops one level per 12 h after that). */
```

**lib/game/farm/state.ts — edit 5 of 13.** Replace:

```ts
  rottedAt: number | null;
  log: CropLog | null;
```

with:

```ts
  rottedAt: number | null;
  /** Hoa màu: the next picking (1 before P, 0 = none left); rice: null. */
  picking: number | null;
  /** How many pickings the crop gives: 0 on bare beds, 1 for rice. */
  pickings: number;
  /** Rice: the parts cut so far (0–6, R5). */
  parts: number;
  /** The co-op's harvester on this plot (§6.3). */
  harvester: { startedAt: number; endsAt: number } | null;
  log: CropLog | null;
```

**lib/game/farm/state.ts — edit 6 of 13.** Replace:

```ts

/** The account part of the answer — sell_rice, buy_farm_item and claim_farm_gift return only this. */
export interface FarmMine {
```

with:

```ts

/** The sprayer's tank (§7): empty is { item: null, charges: 0 }. */
export interface Tank { item: string | null; charges: number }

/** The account part of the answer — sell_rice, buy_farm_item, claim_farm_gift, load_sprayer and sell_produce return
 *  only this. */
export interface FarmMine {
```

**lib/game/farm/state.ts — edit 7 of 13.** Replace:

```ts
  giftClaimed: boolean;
}
```

with:

```ts
  giftClaimed: boolean;
  /** Hoa màu in stock, kg per crop (v15.2). */
  produce: Record<string, number>;
  /** null without a sprayer. */
  tank: Tank | null;
}
```

**lib/game/farm/state.ts — edit 8 of 13.** Replace:

```ts
    qTransplant: num(o.q_transplant, 1),
  };
```

with:

```ts
    qTransplant: num(o.q_transplant, 1),
    work: arr(o.work).map(obj).map((e) => ({ t: time(e.t), act: str(e.act) })).filter((e): e is WorkEntry => e.t !== null && e.act !== ""),
    harvests: arr(o.harvests).map(obj).map((e) => ({ t: time(e.t), k: num(e.k), kg: num(e.kg) }))
      .filter((e): e is HarvestEntry => e.t !== null),
    harvestedKg: num(o.harvested_kg),
  };
```

**lib/game/farm/state.ts — edit 9 of 13.** Replace:

```ts
  const c = v as Record<string, unknown>;
  const phase = PHASES.includes(str(c.phase)) ? (c.phase as Phase) : "prepared";
  return {
    variety: typeof c.variety === "string" ? c.variety : null,
    phase,
    preparedAt: time(c.prepared_at),
```

with:

```ts
  const c = v as Record<string, unknown>;
  const kind = c.kind === "upland" ? "upland" : "rice";
  const h = obj(c.harvester);
  const startedAt = time(h.started_at), endsAt = time(h.ends_at);
  return {
    kind,
    variety: typeof c.variety === "string" ? c.variety : null,
    upland: typeof c.upland === "string" ? c.upland : null,
    phase: kind === "upland" ? str(c.phase, "prepared") : PHASES.includes(str(c.phase)) ? str(c.phase) : "prepared",
    preparedAt: time(c.prepared_at),
```

**lib/game/farm/state.ts — edit 10 of 13.** Replace:

```ts
    transplantAt: time(c.transplant_at),
    water: num(c.water),
```

with:

```ts
    transplantAt: time(c.transplant_at),
    plantAt: time(c.plant_at),
    water: num(c.water),
```

**lib/game/farm/state.ts — edit 11 of 13.** Replace:

```ts
    rottedAt: time(c.rotted_at),
    log: parseLog(c.log),
```

with:

```ts
    rottedAt: time(c.rotted_at),
    picking: kind === "upland" ? numOrNull(c.picking) : null,
    pickings: num(c.pickings, kind === "upland" ? 0 : 1),
    parts: num(c.parts),
    harvester: startedAt !== null && endsAt !== null ? { startedAt, endsAt } : null,
    log: parseLog(c.log),
```

**lib/game/farm/state.ts — edit 12 of 13.** Replace:

```ts
  for (const [k, v] of Object.entries(obj(m.rice))) rice[k] = { wet: num(obj(v).wet), dry: num(obj(v).dry) };
  return { items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true };
}
```

with:

```ts
  for (const [k, v] of Object.entries(obj(m.rice))) rice[k] = { wet: num(obj(v).wet), dry: num(obj(v).dry) };
  const produce: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(m.produce))) if (num(v) > 0) produce[k] = num(v);
  const t = m.tank && typeof m.tank === "object" ? (m.tank as Record<string, unknown>) : null;
  const tank = t ? { item: typeof t.item === "string" ? t.item : null, charges: num(t.charges) } : null;
  return { items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true, produce, tank };
}
```

**lib/game/farm/state.ts — edit 13 of 13.** Replace:

```ts

/** A field state with a newer account part (the answer of sell_rice, buy_farm_item or claim_farm_gift). */
export function withMine(s: FieldState, mine: FarmMine): FieldState {
```

with:

```ts

/** A field state with a newer account part (the answer of an account-only RPC). */
export function withMine(s: FieldState, mine: FarmMine): FieldState {
```

**lib/game/farm/rpc.ts — edit 1 of 8.** Replace:

```ts
import { supabase } from "@/lib/supabase";
import { FARM_KINDS, farmItemFromRow, varietyFromRow, type FarmCatalog, type FarmItemRow, type VarietyRow } from "./catalog";
import { parseFarmMine, parseFieldState, type FarmMine, type FieldState } from "./state";

// Supabase calls for the field (spec §11.3). Every room answer is the whole field_state; the account-only ones
// (sell_rice, buy_farm_item, claim_farm_gift) answer with the account part.
```

with:

```ts
import { supabase } from "@/lib/supabase";
import {
  FARM_KINDS, farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type FarmItemRow, type UplandCropRow, type VarietyRow,
} from "./catalog";
import { parseFarmMine, parseFieldState, type FarmMine, type FieldState } from "./state";

// Supabase calls for the field (spec §11.3; v15.2 §11.4). Every room answer is the whole field_state; the account-only
// ones (sell_rice, buy_farm_item, claim_farm_gift, load_sprayer, sell_produce) answer with the account part.

/** The RPCs 0016 adds: before it runs, PostgREST cannot find them (v15.2 R28). */
export const RPCS_152: ReadonlySet<string> = new Set([
  "prepare_beds", "plant_crop", "tend_crop", "harvest_part", "rent_harvester", "load_sprayer", "sell_produce",
]);

/** No such table: upland_crops before 0016 (PostgREST's PGRST205, Postgres' 42P01). */
const isMissingTable = (e: { code?: unknown } | null): boolean => e?.code === "PGRST205" || e?.code === "42P01";
```

**lib/game/farm/rpc.ts — edit 2 of 8.** Replace:

```ts

/** Varieties + farm items, cached per page load (a failed fetch is retried on the next call). */
export function fetchFarmCatalog(): Promise<FarmCatalog> {
```

with:

```ts

/** Varieties, hoa-màu crops and farm items, cached per page load (a failed fetch is retried on the next call). Before
 *  0016 there are no hoa-màu crops. */
export function fetchFarmCatalog(): Promise<FarmCatalog> {
```

**lib/game/farm/rpc.ts — edit 3 of 8.** Replace:

```ts
    catalogPromise = (async () => {
      const [va, it] = await Promise.all([
        supabase.from("rice_varieties").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").in("kind", FARM_KINDS).order("kind").order("sort_order"),
      ]);
      if (va.error || it.error) throw va.error ?? it.error;
      return {
        varieties: ((va.data ?? []) as VarietyRow[]).map(varietyFromRow),
        items: ((it.data ?? []) as FarmItemRow[]).map(farmItemFromRow),
```

with:

```ts
    catalogPromise = (async () => {
      const [va, up, it] = await Promise.all([
        supabase.from("rice_varieties").select("*").order("sort_order"),
        supabase.from("upland_crops").select("*").order("sort_order"),
        supabase.from("shop_items").select("*").in("kind", FARM_KINDS).order("kind").order("sort_order"),
      ]);
      const upErr = isMissingTable(up.error) ? null : up.error;
      if (va.error || upErr || it.error) throw va.error ?? upErr ?? it.error;
      return {
        varieties: ((va.data ?? []) as VarietyRow[]).map(varietyFromRow),
        uplands: (up.error ? [] : ((up.data ?? []) as UplandCropRow[])).map(uplandFromRow),
        items: ((it.data ?? []) as FarmItemRow[]).map(farmItemFromRow),
```

**lib/game/farm/rpc.ts — edit 4 of 8.** Replace:

```ts
  | { kind: "prepare"; plot: number }
  | { kind: "fertilize"; plot: number; item: string }
```

with:

```ts
  | { kind: "prepare"; plot: number }
  | { kind: "prepare_beds"; plot: number }
  | { kind: "plant"; plot: number; item: string }
  | { kind: "tend"; plot: number; act: string }
  | { kind: "harvest_part"; plot: number; success: boolean }
  | { kind: "rent_harvester"; plot: number }
  | { kind: "fertilize"; plot: number; item: string }
```

**lib/game/farm/rpc.ts — edit 5 of 8.** Replace:

```ts
    case "prepare": return ["prepare_plot", { p_plot: a.plot }];
    case "fertilize": return ["apply_fertilizer", { p_plot: a.plot, p_item_id: a.item }];
```

with:

```ts
    case "prepare": return ["prepare_plot", { p_plot: a.plot }];
    case "prepare_beds": return ["prepare_beds", { p_plot: a.plot }];
    case "plant": return ["plant_crop", { p_plot: a.plot, p_item_id: a.item }];
    case "tend": return ["tend_crop", { p_plot: a.plot, p_act: a.act }];
    case "harvest_part": return ["harvest_part", { p_plot: a.plot, p_success: a.success }];
    case "rent_harvester": return ["rent_harvester", { p_plot: a.plot }];
    case "fertilize": return ["apply_fertilizer", { p_plot: a.plot, p_item_id: a.item }];
```

**lib/game/farm/rpc.ts — edit 6 of 8.** Replace:

```ts

export interface FieldAnswer { state: FieldState; harvest: { variety: string; kg: number } | null }
```

with:

```ts

/** A rice part cut by hand (§6.2): its kg, the parts cut now, the plot's kg so far, and whether it was the sixth. */
export interface PartAnswer { variety: string; kg: number; parts: number; total: number; done: boolean }
/** A hoa-màu picking (§8.9): picking k of n gave kg; `done` = it was the last. */
export interface PickingAnswer { upland: string; kg: number; k: number; pickings: number; done: boolean }

export interface FieldAnswer {
  state: FieldState;
  /** A whole rice harvest (a database without 0016). */
  harvest: { variety: string; kg: number } | null;
  harvestPart: PartAnswer | null;
  picking: PickingAnswer | null;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
```

**lib/game/farm/rpc.ts — edit 7 of 8.** Replace:

```ts
  const h = r.harvest && typeof r.harvest === "object" ? (r.harvest as Record<string, unknown>) : null;
  return {
    state: fieldOf(r),
    harvest: h && typeof h.variety === "string" && typeof h.kg === "number" ? { variety: h.variety, kg: h.kg } : null,
  };
```

with:

```ts
  const h = r.harvest && typeof r.harvest === "object" ? (r.harvest as Record<string, unknown>) : null;
  const p = r.harvest_part && typeof r.harvest_part === "object" ? (r.harvest_part as Record<string, unknown>) : null;
  return {
    state: fieldOf(r),
    harvest: h && typeof h.variety === "string" && isNum(h.kg) ? { variety: h.variety, kg: h.kg } : null,
    harvestPart: p && typeof p.variety === "string" && isNum(p.kg) && isNum(p.parts) && isNum(p.total)
      ? { variety: p.variety, kg: p.kg, parts: p.parts, total: p.total, done: p.done === true } : null,
    picking: h && typeof h.upland === "string" && isNum(h.kg) && isNum(h.k) && isNum(h.pickings)
      ? { upland: h.upland, kg: h.kg, k: h.k, pickings: h.pickings, done: h.done === true } : null,
  };
```

**lib/game/farm/rpc.ts — edit 8 of 8.** Append at the end of the file, after a blank line:

```ts
/** Nạp thuốc (§7): one bottle of the pesticide into the sprayer's tank, 3 sprays. */
export async function loadSprayer(token: string, itemId: string): Promise<MineAnswer> {
  return mineAnswer(await call("load_sprayer", { p_session_token: token, p_item_id: itemId }));
}

/** Sells kg of a hoa-màu crop to cô Út (§9). */
export async function sellProduce(token: string, upland: string, kg: number): Promise<MineAnswer> {
  return mineAnswer(await call("sell_produce", { p_session_token: token, p_upland: upland, p_kg: kg }));
}
```

**lib/game/farm/messages.ts.** Replace:

```ts
  snail: "Ốc bươu vàng", leaf_folder: "Sâu cuốn lá", hopper: "Rầy nâu", leaf_blast: "Đạo ôn lá", neck_blast: "Đạo ôn cổ bông",
};

/** The spray that treats each pest; snails are picked by hand (§8.5). */
export const PEST_REMEDY: Record<PestKind, string | null> = {
  snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
};
```

with:

```ts
  snail: "Ốc bươu vàng", leaf_folder: "Sâu cuốn lá", hopper: "Rầy nâu", leaf_blast: "Đạo ôn lá", neck_blast: "Đạo ôn cổ bông",
  weevil: "Sùng khoai", armyworm: "Sâu keo mùa thu", thrips: "Bọ trĩ", anthracnose: "Thán thư",
};

/** The spray that treats each pest; snails are picked by hand (§8.5). The hoa-màu ones are the config's remedies. */
export const PEST_REMEDY: Record<PestKind, string | null> = {
  snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
  weevil: "spray_insect", armyworm: "spray_insect", thrips: "spray_insect", anthracnose: "spray_fungus",
};
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (12 files, 111 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/catalog.ts lib/game/farm/messages.ts lib/game/farm/rpc.ts lib/game/farm/state.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-handbook.test.ts tests/unit/farm-land.test.ts tests/unit/farm-messages.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-rpc.test.ts tests/unit/farm-state.test.ts tests/unit/game-crop-art.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): client catalog, state and RPCs — hoa-màu crops, tools, parts, the harvester

The catalog reads upland_crops (none before 0016), tools and the hoa-màu
seeds; field_state gains the crop kind, P, the pickings, the cut parts, a
running harvester, the new logs, the hoa màu in stock and the tank. The five
room actions and load_sprayer / sell_produce are wired, with the answers of
a hand part and a picking.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/catalog.ts lib/game/farm/messages.ts lib/game/farm/rpc.ts lib/game/farm/state.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-handbook.test.ts tests/unit/farm-land.test.ts tests/unit/farm-messages.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-rpc.test.ts tests/unit/farm-state.test.ts tests/unit/game-crop-art.test.ts
git commit -F <message file>
```

---

### Task 7: The hoa-màu model on the client, and the rice parts

**Files:**
- Create: `lib/game/farm/upland.ts`
- Modify: `lib/game/farm/crop.ts` (`partKg`)
- Test: `tests/unit/farm-upland.test.ts` (create), `tests/unit/farm-crop.test.ts` (modify)

**Interfaces:**
- Consumes: Task 6's `UplandCrop`, `UplandStage`, `uplandHours`, `CropView`, `HarvestEntry`, `WorkEntry`, `PestKind`; from v15.1: `hrs`, `plusH`, `SAMPLE_MS`, `waterAt` (`crop.ts`) and `PestView`, `ItemEntry`, `WaterEntry` (`state.ts`); Task 1's `tests/fixtures/upland-cases.json` (the same cases and edges the SQL smoke replays) and the parts cases of `crop-cases.json`.
- Produces:
  - `crop.ts`: `partKg(i, y) = floor(i·y/6) − floor((i−1)·y/6)` (R5);
  - `upland.ts` (pure, the mirror of `0016` section C, R33): `UplandModel { sowAt; plantAt; water; fert; work; spray; harvests }`, `uplandModel(c: CropView)`, `UplandRoll`; `upReadyAt`, `upOverAt`, `upLostAt(c, u, k)`; `upNext(c, u, t)` (0 = none left); `upPhase`, `upStage`, `upWantedWater`, `upWaterOk(c, u, t)`; `upOffHours`, `upRotHours(c, u, until)`; `upExcessN(c, u, t)`; `upCare(c, u) → { manure, phosphate, scores, excess }`, `upMcare(care)`; `upPests(c, u, rolls, now) → PestView[]`; `upYield(c, u, land, k, pests, now) → { kg, mcare, mplant, mwater, mrot, mpest, mlate }`; the plot panel's hopeful `upEstimate(…)` and `upSeasonEstimate(c, u, land, pests, now)`; `upNextPhaseAt`; `nurseryReadyAt`, `nurseryOldAt`, `rotFromAt(c, u)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-upland.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { uplandFromRow, type UplandCrop, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS, plusH, waterAt } from "@/lib/game/farm/crop";
import { PEST_NAME, PEST_REMEDY } from "@/lib/game/farm/messages";
import type { PestKind } from "@/lib/game/farm/state";
import {
  nurseryReadyAt, upCare, upEstimate, upExcessN, upLostAt, upNext, upNextPhaseAt, upOffHours, upOverAt, upPests, upPhase, upReadyAt,
  upRotHours, upSeasonEstimate, upWantedWater, upYield, type UplandModel, type UplandRoll,
} from "@/lib/game/farm/upland";
import fixtures from "@/tests/fixtures/upland-cases.json";

/** A fixture time: hours after t0, or [hours, seconds]. */
type At = number | [number, number];
interface Case {
  name: string; upland: string; land: number; sow: At | null; plant: At | null; pick: At; k: number;
  water: Array<[At, number]>; fert: Array<[At, string]>; work: Array<[At, string]>; spray: Array<[At, string]>;
  harvests: Array<[At, number, number]>; pest_rolls: Array<{ slot: number; u_time: number; u_hit: number }>;
  expect: Record<string, unknown>;
}
const FX = fixtures as unknown as { t0: string; crops: UplandCropRow[]; cases: Case[]; edges: Case[] };
const t0 = Date.parse(FX.t0);
const at = (h: At) => t0 + (Array.isArray(h) ? h[0] * 3600 + h[1] : h * 3600) * 1000;
const U: Record<string, UplandCrop> = Object.fromEntries(FX.crops.map((r) => [r.id, uplandFromRow(r)]));

const modelOf = (k: Case): UplandModel => ({
  sowAt: k.sow === null ? null : at(k.sow), plantAt: k.plant === null ? null : at(k.plant),
  water: k.water.map(([h, l]) => ({ t: at(h), l })), fert: k.fert.map(([h, item]) => ({ t: at(h), item })),
  work: k.work.map(([h, act]) => ({ t: at(h), act })), spray: k.spray.map(([h, item]) => ({ t: at(h), item })),
  harvests: k.harvests.map(([h, n, kg]) => ({ t: at(h), k: n, kg })),
});
const rollsOf = (k: Case): UplandRoll[] => k.pest_rolls.map((r) => ({ slot: r.slot, uTime: r.u_time, uHit: r.u_hit }));

/** What the SQL smoke reads for each expected key (tests/sql/v15-2-smoke.sql). */
function evaluate(k: Case): Record<string, unknown> {
  const c = modelOf(k), u = U[k.upland], t = at(k.pick), got: Record<string, unknown> = {};
  const pests = upPests(c, u, rollsOf(k), t);
  for (const f of Object.keys(k.expect)) {
    switch (f) {
      case "phase": got.phase = upPhase(c, u, t); break;
      case "next": got.next = upNext(c, u, t); break;
      case "water": got.water = waterAt(c.water, t); break;
      case "off_hours": got.off_hours = upOffHours(c, u, t); break;
      case "rot_hours": got.rot_hours = upRotHours(c, u, t); break;
      case "scores": case "manure": case "phosphate": case "excess": got[f] = upCare(c, u)[f]; break;
      case "pests":
        got.pests = pests.map((p) => ({ kind: p.kind, since_s: (p.since - t0) / 1000, treated_s: p.treatedAt === null ? null : (p.treatedAt - t0) / 1000 }));
        break;
      case "transplant": got.transplant = upPhase(c, u, t) === "nursery" && t >= plusH(c.sowAt!, u.nurseryReadyH!); break;
      default: got[f] = upYield(c, u, k.land, k.k, pests, t)[f as "kg"];
    }
  }
  return got;
}

const FLOATS = new Set(["mcare", "mplant", "mwater", "mrot", "mpest", "mlate", "off_hours", "rot_hours"]);

describe("the shared hoa-màu fixtures (the SQL smoke replays the same cases)", () => {
  it("has the 11 cases of §16", () => {
    expect(FX.cases).toHaveLength(11);
  });
  for (const k of [...FX.cases, ...FX.edges]) {
    it(k.name, () => {
      const got = evaluate(k);
      for (const [f, want] of Object.entries(k.expect)) {
        if (FLOATS.has(f)) expect(got[f] as number, f).toBeCloseTo(want as number, 12);
        else if (f === "scores") (want as number[]).forEach((w, i) => expect((got.scores as number[])[i], `score ${i}`).toBeCloseTo(w, 12));
        else expect(got[f], f).toEqual(want);
      }
    });
  }
});

const khoai = U.khoai, bap = U.bap, ot = U.ot;
const T = (h: number) => t0 + h * HOUR_MS;
const beds = (over: Partial<UplandModel> = {}): UplandModel => ({
  sowAt: null, plantAt: null, water: [{ t: T(0), l: 1 }], fert: [], work: [], spray: [], harvests: [], ...over,
});
/** ớt sown at 0 h and transplanted at 12 h: R_1 = 58 h, R_2 = 70 h, R_3 = 82 h. */
const ots = (over: Partial<UplandModel> = {}) => beds({ sowAt: T(0), plantAt: T(12), ...over });

describe("phases and pickings (§8.3, R24)", () => {
  it("go from the beds through the nursery and the stages to each picking", () => {
    const c = ots();
    const ph = (h: number) => upPhase(c, ot, T(h));
    expect(upPhase(beds(), ot, T(5))).toBe("prepared");
    expect([ph(-1), ph(0), ph(11.9), ph(12), ph(19.9), ph(20), ph(45), ph(57.9)]).toEqual([
      "prepared", "nursery", "nursery", "root", "root", "grow", "flower", "fruit",
    ]);
    // picking 1 stays the next one, overripe, until it is lost at L_1 = 90 h
    expect([ph(58), ph(65.9), ph(66), ph(89.9), ph(90)]).toEqual(["ripe", "ripe", "overripe", "overripe", "overripe"]);
    // picking 1 taken at 60 h: waiting for picking 2 until R_2
    const picked = ots({ harvests: [{ t: T(60), k: 1, kg: 24 }] });
    expect([upPhase(picked, ot, T(61)), upPhase(picked, ot, T(70))]).toEqual(["waiting", "ripe"]);
    expect(upNextPhaseAt(picked, ot, T(61))).toBe(T(70));
  });
  it("loses an unpicked picking after its window, and is done when none is left", () => {
    const c = ots();
    expect([upReadyAt(c, ot, 1), upOverAt(c, ot, 1), upLostAt(c, ot, 1)]).toEqual([T(58), T(66), T(90)]);
    expect([upNext(c, ot, T(89.9)), upNext(c, ot, T(90)), upNext(c, ot, T(102)), upNext(c, ot, T(114))]).toEqual([1, 2, 3, 0]);
    expect(upPhase(c, ot, T(114))).toBe("done");
    expect(upNext(beds(), ot, T(5))).toBe(0);
  });
  it("tells when the nursery is ready and what the beds should hold", () => {
    expect(nurseryReadyAt(ots(), ot)).toBe(T(10));
    expect([upWantedWater(beds(), khoai, T(1)), upWantedWater(ots(), ot, T(5)), upWantedWater(ots(), ot, T(25))]).toEqual([null, [1], [1, 2]]);
    const k = beds({ plantAt: T(0) });
    expect([upWantedWater(k, khoai, T(3)), upWantedWater(k, khoai, T(30)), upWantedWater(k, khoai, T(50))]).toEqual([[1], [0, 1], [0, 1]]);
  });
});

describe("water and rot (§8.4)", () => {
  it("counts off-target samples from the first planting action, and rot at Đẫm or more from rot_from_h", () => {
    // khoai planted at 0 h on a bed flooded to Đẫm at 20 h: the vine stage wants Khô–Ẩm
    const c = beds({ plantAt: T(0), water: [{ t: T(0), l: 1 }, { t: T(20), l: 2 }] });
    expect(upOffHours(c, khoai, T(22))).toBe(2);
    expect(upRotHours(c, khoai, T(22))).toBe(0);
    expect(upRotHours(c, khoai, T(24))).toBe(2);
    expect(upRotHours(c, bap, T(24))).toBe(0);
  });
});

describe("care (§8.5, R23)", () => {
  const P = T(1);
  const fert = (list: Array<[number, string]>) => beds({ plantAt: P, fert: list.map(([h, item]) => ({ t: T(h), item })) });
  it("scores bón lót before P and each care's best entry", () => {
    const c = fert([[0, "fert_manure"], [0.5, "fert_phosphate"], [8, "fert_urea"], [21, "fert_potash"]]);
    // khoai: td half at 7 h after P (urê), then on time at 20 h (kali): the best counts; lật dây missing
    expect(upCare(c, khoai)).toEqual({ manure: true, phosphate: true, scores: [0, 0.1], excess: false });
    const work = beds({ plantAt: P, work: [{ t: T(36), act: "lat_day" }, { t: T(30), act: "lat_day" }] });
    expect(upCare(work, khoai).scores).toEqual([0.2, 0]);
  });
  it("finds excess N outside every region that takes it, or twice in one region", () => {
    expect(upExcessN(fert([[40, "fert_urea"]]), khoai, Infinity)).toBe(true);
    expect(upExcessN(fert([[17, "fert_npk"], [20, "fert_npk"]]), khoai, Infinity)).toBe(true);
    expect(upExcessN(fert([[17, "fert_npk"], [20, "fert_npk"]]), khoai, T(19))).toBe(false);
    expect(upExcessN(fert([[10, "fert_urea"], [40, "fert_npk"]]), bap, Infinity)).toBe(false);
  });
});

describe("the yield (§8.7)", () => {
  it("pays old seedlings −3 %/h past nursery_old_h, at most 30 %", () => {
    const y = (plantH: number) => upYield(beds({ sowAt: T(0), plantAt: T(plantH) }), ot, 1, 1, [], T(plantH + 46)).mplant;
    expect([y(18), y(20)]).toEqual([1, 1 - 0.03 * 2]);
    expect(y(40)).toBeCloseTo(0.7, 12);
  });
  it("estimates as if the open cares are done on time, the whole season too", () => {
    // ớt transplanted at 12 h, nothing done yet at 14 h: the base fertilizers are gone (−10 %), the cares still open
    const c = ots();
    expect(upEstimate(c, ot, 1, 1, [], T(14)).mcare).toBeCloseTo(0.9, 12);
    expect(upEstimate(beds({ sowAt: T(0) }), ot, 1, 1, [], T(5)).mcare).toBe(1);
    const all = upSeasonEstimate(c, ot, 1, [], T(14));
    expect(all).toBe([1, 2, 3].reduce((a, k) => a + upEstimate(c, ot, 1, k, [], T(14)).kg, 0));
    const picked = ots({ harvests: [{ t: T(60), k: 1, kg: 20 }] });
    expect(upSeasonEstimate(picked, ot, 1, [], T(61))).toBe(20 + upEstimate(picked, ot, 1, 2, [], T(61)).kg + upEstimate(picked, ot, 1, 3, [], T(61)).kg);
  });
});

describe("the pests' names and remedies", () => {
  it("match the config", () => {
    for (const u of Object.values(U)) {
      for (const p of u.pests) {
        expect(PEST_NAME[p.kind as PestKind], p.kind).toBe(p.name);
        expect(PEST_REMEDY[p.kind as PestKind], p.kind).toBe(p.remedy);
      }
    }
  });
});
```

**tests/unit/farm-crop.test.ts — edit 1 of 3.** Replace:

```ts
import {
  cropCare, cropPhase, cropYield, excessN, HOUR_MS, nextPhaseAt, nextWaterDrop, pestHours, waterAt, waterOffHours, wantedWater,
  yieldEstimate, type CropModel,
```

with:

```ts
import {
  cropCare, cropPhase, cropYield, excessN, HOUR_MS, nextPhaseAt, nextWaterDrop, partKg, pestHours, waterAt, waterOffHours, wantedWater,
  yieldEstimate, type CropModel,
```

**tests/unit/farm-crop.test.ts — edit 2 of 3.** Replace:

```ts
  };
}
```

with:

```ts
  };
  /** v15.2: six hand parts, [hours, kg] each — part i pays partKg(i, Y) with Y the plot's yield at its cut. */
  parts?: Array<[number, number]>;
}
```

**tests/unit/farm-crop.test.ts — edit 3 of 3.** Replace:

```ts
      for (const f of ["mcare", "mseed", "mwater", "mpest", "mlate"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
    });
```

with:

```ts
      for (const f of ["mcare", "mseed", "mwater", "mpest", "mlate"] as const) expect(y[f], f).toBeCloseTo(k.expect[f], 12);
    });
  }
});

describe("rice in six parts (v15.2 §6.1, R5)", () => {
  it("splits Y exactly", () => {
    const parts = (y: number) => [1, 2, 3, 4, 5, 6].map((i) => partKg(i, y));
    expect(parts(75)).toEqual([12, 13, 12, 13, 12, 13]);
    expect(parts(99)).toEqual([16, 17, 16, 17, 16, 17]);
    expect(parts(7)).toEqual([1, 1, 1, 1, 1, 2]);
    for (let y = 6; y <= 200; y++) {
      expect(parts(y).reduce((a, b) => a + b, 0)).toBe(y);
      // after n parts the harvester pays y − floor(n·y/6): exactly parts n+1..6
      for (let n = 0; n <= 5; n++) expect(y - Math.floor((n * y) / 6)).toBe(parts(y).slice(n).reduce((a, b) => a + b, 0));
    }
  });
  for (const k of FX.cases.filter((c) => c.parts)) {
    it(`pays each part of Y at its cut: ${k.name}`, () => {
      k.parts!.forEach(([h, kg], i) => {
        const y = cropYield(cropOf(k), V[k.variety], k.land, 1, [], at(h)).kg;
        expect(partKg(i + 1, y), `part ${i + 1} at ${h} h (Y = ${y})`).toBe(kg);
      });
    });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-crop.test.ts tests/unit/farm-upland.test.ts`
Expected: FAIL — `tests/unit/farm-upland.test.ts` does not load (`Failed to resolve import "@/lib/game/farm/upland"`), and 3 `farm-crop` tests fail (`partKg is not a function`); 24 pass.

- [ ] **Step 3: Implement**

Create `lib/game/farm/upland.ts` with exactly:

```ts
import { uplandHours, type UplandCrop, type UplandStage } from "./catalog";
import { hrs, plusH, SAMPLE_MS, waterAt } from "./crop";
import type { CropView, HarvestEntry, ItemEntry, PestKind, PestView, WaterEntry, WorkEntry } from "./state";

// The hoa-màu model (v15.2 §8) on the client: the same arithmetic, in the same order, as 0016 section C, so the plot
// panel agrees with the server (tests/fixtures/upland-cases.json pins both sides, R33). Times are ms since the epoch;
// hours count from P, the planting (or the transplant of a nursery crop). Pure.

/** What the model reads of a crop on beds. */
export interface UplandModel {
  sowAt: number | null;
  plantAt: number | null;
  water: readonly WaterEntry[];
  fert: readonly ItemEntry[];
  work: readonly WorkEntry[];
  spray: readonly ItemEntry[];
  harvests: readonly HarvestEntry[];
}

/** A pest slot's hidden roll (the server keeps them; the fixtures replay them). */
export interface UplandRoll { slot: number; uTime: number; uHit: number }

/** The model of a crop on beds as field_state shows it (the logs are there for its farmer only). */
export function uplandModel(c: CropView): UplandModel {
  return {
    sowAt: c.sowAt, plantAt: c.plantAt, water: c.log?.water ?? [], fert: c.log?.fert ?? [], work: c.log?.work ?? [],
    spray: c.log?.spray ?? [], harvests: c.log?.harvests ?? [],
  };
}

/** R_k: picking k is ready. */
export function upReadyAt(c: UplandModel, u: UplandCrop, k: number): number | null {
  return c.plantAt === null ? null : plusH(c.plantAt, uplandHours(u, k));
}

/** O_k: picking k is overripe (−over_rate per hour) from here. */
export function upOverAt(c: UplandModel, u: UplandCrop, k: number): number | null {
  return c.plantAt === null ? null : plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH);
}

/** L_k: picking k is lost here. */
export function upLostAt(c: UplandModel, u: UplandCrop, k: number): number | null {
  return c.plantAt === null ? null : plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH + u.lostAfterH);
}

/** The next picking at t: the lowest one not picked and not lost yet; 0 when none is left, or before P (`_up_next`). */
export function upNext(c: UplandModel, u: UplandCrop, t: number): number {
  if (c.plantAt === null) return 0;
  for (let k = 1; k <= u.pickings.length; k++) {
    if (c.harvests.some((h) => h.k === k)) continue;
    if (t < plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH + u.lostAfterH)) return k;
  }
  return 0;
}

/** The phase at t (§8.3): prepared, nursery, a stage id, then waiting / ripe / overripe for the next picking, and done. */
export function upPhase(c: UplandModel, u: UplandCrop, t: number): string {
  const start = c.sowAt ?? c.plantAt;
  if (start === null || t < start) return "prepared";
  if (c.plantAt === null || t < c.plantAt) return "nursery";
  const h = hrs(c.plantAt, t);
  for (const st of u.stages) if (h < st.untilH) return st.id;
  const k = upNext(c, u, t);
  if (k === 0) return "done";
  if (t < plusH(c.plantAt, uplandHours(u, k))) return "waiting";
  if (t < plusH(c.plantAt, uplandHours(u, k) + u.ripeWindowH)) return "ripe";
  return "overripe";
}

/** The growth stage at t, or null before P and from ripe_h on. */
export function upStage(c: UplandModel, u: UplandCrop, t: number): UplandStage | null {
  if (c.plantAt === null || t < c.plantAt) return null;
  const h = hrs(c.plantAt, t);
  return u.stages.find((st) => h < st.untilH) ?? null;
}

/** The levels the beds should hold at t: {1} in the nursery, the stage's, ripe_water from ripe_h on; null before the
 *  first planting action (anything goes). */
export function upWantedWater(c: UplandModel, u: UplandCrop, t: number): readonly number[] | null {
  const start = c.sowAt ?? c.plantAt;
  if (start === null || t < start) return null;
  if (c.plantAt === null || t < c.plantAt) return [1];
  return upStage(c, u, t)?.water ?? u.ripeWater;
}

/** Does the water at t suit the crop (`_up_water_ok`)? */
export function upWaterOk(c: UplandModel, u: UplandCrop, t: number): boolean {
  const want = upWantedWater(c, u, t);
  return want === null || want.includes(waterAt(c.water, t));
}

/** Off-target water hours from the first planting action until `until`: one sample every 15 minutes, 0.25 h each. */
export function upOffHours(c: UplandModel, u: UplandCrop, until: number): number {
  const start = c.sowAt ?? c.plantAt;
  if (start === null || until <= start) return 0;
  let wrong = 0;
  for (let t = start; t < until; t += SAMPLE_MS) if (!upWaterOk(c, u, t)) wrong++;
  return wrong * 0.25;
}

/** Rot hours (§8.4): samples from P + rot_from_h until `until` with the beds at Đẫm or Ngập. */
export function upRotHours(c: UplandModel, u: UplandCrop, until: number): number {
  if (u.rotFromH === null || c.plantAt === null) return 0;
  const from = plusH(c.plantAt, u.rotFromH);
  if (until <= from) return 0;
  let wet = 0;
  for (let t = from; t < until; t += SAMPLE_MS) if (waterAt(c.water, t) >= 2) wet++;
  return wet * 0.25;
}

const isN = (item: string) => item === "fert_urea" || item === "fert_npk";

/** Excess nitrogen by t (§8.5, R23): walking the fertilizer log from P in time order, an N bag where no fertilizer care's
 *  half region [half_from_h, half_to_h) takes it, or a second N inside one care's half region. */
export function upExcessN(c: UplandModel, u: UplandCrop, t: number): boolean {
  const p = c.plantAt;
  if (p === null) return false;
  const seen: string[] = [];
  const log = c.fert.map((e, n) => ({ e, n })).filter(({ e }) => e.t >= p && e.t <= t).sort((a, b) => a.e.t - b.e.t || a.n - b.n);
  for (const { e } of log) {
    if (!isN(e.item)) continue;
    const h = hrs(p, e.t);
    const hit = u.cares.find((cr) => cr.kind === "fert" && h >= cr.halfFromH && h < cr.halfToH
      && (cr.items.includes(e.item) || cr.halfItems.includes(e.item)));
    if (!hit || seen.includes(hit.id)) return true;
    seen.push(hit.id);
  }
  return false;
}

/** The care scores (§8.5): the base fertilizers before P, then each care row in config order — 0 on time, pen_half in
 *  its half region, else pen_missing; only the best entry counts. */
export interface UplandCareScore { manure: boolean; phosphate: boolean; scores: number[]; excess: boolean }

export function upCare(c: UplandModel, u: UplandCrop): UplandCareScore {
  let manure = false, phosphate = false;
  for (const e of c.fert) {
    if (c.plantAt === null || e.t < c.plantAt) {
      if (e.item === "fert_manure") manure = true;
      if (e.item === "fert_phosphate") phosphate = true;
    }
  }
  const p = c.plantAt;
  const scores = u.cares.map((cr) => {
    let best = cr.penMissing;
    if (p === null) return best;
    if (cr.kind === "fert") {
      for (const e of c.fert) {
        const h = hrs(p, e.t);
        if (cr.items.includes(e.item) && h >= cr.fromH && h <= cr.toH) best = Math.min(best, 0);
        else if ((cr.items.includes(e.item) || cr.halfItems.includes(e.item)) && h >= cr.halfFromH && h < cr.halfToH) {
          best = Math.min(best, cr.penHalf);
        }
      }
    } else {
      for (const e of c.work) {
        if (e.act !== cr.id) continue;
        const h = hrs(p, e.t);
        if (h >= cr.fromH && h <= cr.toH) best = Math.min(best, 0);
        else if (h >= cr.halfFromH && h < cr.halfToH) best = Math.min(best, cr.penHalf);
      }
    }
    return best;
  });
  return { manure, phosphate, scores, excess: upExcessN(c, u, Infinity) };
}

/** The pests revealed by `now` from the hidden rolls (§8.6), as `_up_pests` works them out: a slot is due at
 *  P + from_h + u_time·(to_h − from_h); its chance is ×1.5 with excess N by then, × dry_mult on a Khô bed, × wet_mult at
 *  Đẫm or more, capped at 0.9; the first spray of its remedy at or after due treats it. */
export function upPests(c: UplandModel, u: UplandCrop, rolls: readonly UplandRoll[], now: number): PestView[] {
  const p = c.plantAt;
  if (p === null) return [];
  const out: PestView[] = [];
  for (const r of [...rolls].sort((a, b) => a.slot - b.slot)) {
    const pe = u.pests.find((x) => x.slot === r.slot);
    if (!pe) continue;
    const due = plusH(p, pe.fromH + r.uTime * (pe.toH - pe.fromH));
    if (due > now) continue;
    let chance = pe.chance;
    if (upExcessN(c, u, due)) chance = chance * 1.5;
    const lvl = waterAt(c.water, due);
    if (lvl === 0) chance = chance * pe.dryMult;
    if (lvl >= 2) chance = chance * pe.wetMult;
    chance = Math.min(0.9, chance);
    if (r.uHit >= chance) continue;
    let treatedAt: number | null = null;
    for (const s of c.spray) if (s.item === pe.remedy && s.t >= due && s.t <= now && (treatedAt === null || s.t < treatedAt)) treatedAt = s.t;
    out.push({ kind: pe.kind as PestKind, since: due, treatedAt });
  }
  return out;
}

export interface UplandYield { kg: number; mcare: number; mplant: number; mwater: number; mrot: number; mpest: number; mlate: number }

/** 1 − the care penalties, summed in the SQL's order. */
export function upMcare(care: UplandCareScore): number {
  let pen = 0;
  if (!care.manure) pen += 0.05;
  if (!care.phosphate) pen += 0.05;
  for (const s of care.scores) pen += s;
  if (care.excess) pen += 0.1;
  return 1 - pen;
}

/** Old seedlings (R30): −3 % per hour past nursery_old_h at the transplant, at most 30 %. */
function mplantOf(u: UplandCrop, sowAt: number | null, plantAt: number | null): number {
  if (u.method !== "nursery" || u.nurseryOldH === null || sowAt === null || plantAt === null) return 1;
  return 1 - Math.min(0.3, 0.03 * Math.max(0, hrs(sowAt, plantAt) - u.nurseryOldH));
}

function yieldOf(u: UplandCrop, land: number, k: number, mcare: number, mplant: number, offHours: number, rotHours: number,
  pests: readonly PestView[], late: number, now: number): UplandYield {
  const mwater = 1 - Math.min(0.2, 0.01 * offHours);
  const mrot = u.rotFromH === null ? 1 : 1 - Math.min(u.rotCap ?? 1, (u.rotRate ?? 0) * rotHours);
  let mpest = 1;
  for (const pe of pests) {
    const end = pe.treatedAt ?? now;
    mpest = mpest * (1 - Math.min(0.3, 0.015 * (end <= pe.since ? 0 : hrs(pe.since, end))));
  }
  const mlate = 1 - Math.min(0.6, u.overRate * Math.max(0, late));
  const pct = u.pickings[k - 1] ?? 0;
  const x = ((((((((u.baseKg * land) * mcare) * mplant) * mwater) * mrot) * mpest) * mlate) * pct) / 100;
  return { kg: Math.max(Math.ceil((u.baseKg * pct) / 1000), Math.floor(x + 0.5)), mcare, mplant, mwater, mrot, mpest, mlate };
}

/** Picking k at `now` (§8.7) — what the server pays out. `pests` are the revealed ones, in slot order. */
export function upYield(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
  const over = upOverAt(c, u, k);
  return yieldOf(u, land, k, upMcare(upCare(c, u)), mplantOf(u, c.sowAt, c.plantAt), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), now);
}

/** The plot panel's estimate for picking k (§13.1): as if everything still open is done on time — the base fertilizers
 *  until P, each care until its on-time window closes, the ớt transplant now — with the water, rot, pests and delays so
 *  far. Hidden pests cannot be counted. */
export function upEstimate(c: UplandModel, u: UplandCrop, land: number, k: number, pests: readonly PestView[], now: number): UplandYield {
  const care = upCare(c, u);
  const T = c.plantAt === null ? null : hrs(c.plantAt, now);
  const hopeful: UplandCareScore = {
    manure: care.manure || T === null,
    phosphate: care.phosphate || T === null,
    scores: care.scores.map((s, i) => (T === null || T <= u.cares[i].toH ? 0 : s)),
    excess: care.excess,
  };
  const over = upOverAt(c, u, k);
  return yieldOf(u, land, k, upMcare(hopeful), mplantOf(u, c.sowAt, c.plantAt ?? now), upOffHours(c, u, now), upRotHours(c, u, now),
    pests, over === null ? 0 : hrs(over, now), now);
}

/** The whole season's estimate: the kg picked so far plus each picking still to come, estimated as above. */
export function upSeasonEstimate(c: UplandModel, u: UplandCrop, land: number, pests: readonly PestView[], now: number): number {
  let kg = c.harvests.reduce((a, h) => a + h.kg, 0);
  const next = c.plantAt === null ? 1 : upNext(c, u, now);
  if (next === 0) return kg;
  for (let k = next; k <= u.pickings.length; k++) kg += upEstimate(c, u, land, k, pests, now).kg;
  return kg;
}

/** When the crop enters its next phase, or null when it waits for the farmer (planting, the transplant) or nothing is
 *  next. */
export function upNextPhaseAt(c: UplandModel, u: UplandCrop, now: number): number | null {
  if (c.plantAt === null || now < c.plantAt) return null;
  const h = hrs(c.plantAt, now);
  const st = u.stages.find((s) => h < s.untilH);
  if (st) return plusH(c.plantAt, st.untilH);
  const k = upNext(c, u, now);
  if (k === 0) return null;
  const ready = upReadyAt(c, u, k)!, over = upOverAt(c, u, k)!;
  return now < ready ? ready : now < over ? over : upLostAt(c, u, k);
}

/** The ớt nursery: its seedlings may go out from sow + nursery_ready_h, and are old (−3 %/h) from sow + nursery_old_h. */
export const nurseryReadyAt = (c: UplandModel, u: UplandCrop): number | null =>
  c.sowAt === null || u.nurseryReadyH === null ? null : plusH(c.sowAt, u.nurseryReadyH);
export const nurseryOldAt = (c: UplandModel, u: UplandCrop): number | null =>
  c.sowAt === null || u.nurseryOldH === null ? null : plusH(c.sowAt, u.nurseryOldH);

/** Rot starts here (khoai: P + 22 h), or null for a crop that does not rot. */
export const rotFromAt = (c: UplandModel, u: UplandCrop): number | null =>
  c.plantAt === null || u.rotFromH === null ? null : plusH(c.plantAt, u.rotFromH);
```

**lib/game/farm/crop.ts.** Replace:

```ts

function factors(
```

with:

```ts

/** Rice part i (1..6) of a plot yielding y kg (v15.2 R5): floor(i·y/6) − floor((i − 1)·y/6), so the six parts of a
 *  constant y sum to y, and after n parts the harvester's y − floor(n·y/6) is exactly the rest. */
export function partKg(i: number, y: number): number {
  return Math.floor((i * y) / 6) - Math.floor(((i - 1) * y) / 6);
}

function factors(
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 100 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/crop.ts lib/game/farm/upland.ts tests/unit/farm-crop.test.ts tests/unit/farm-upland.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the hoa-màu model on the client, and the rice parts

lib/game/farm/upland.ts mirrors 0016 section C (phases, pickings, water,
rot, care, excess N, the hidden pests, the yield) with the same arithmetic,
plus the plot panel's hopeful estimate; partKg splits a rice plot in six.
The shared fixtures pin both sides.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/crop.ts lib/game/farm/upland.ts tests/unit/farm-crop.test.ts tests/unit/farm-upland.test.ts
git commit -F <message file>
```

---

### Task 8: The texts and the handbook — v15.2 refusals, toasts, crop tabs, Nông cụ

**Files:**
- Modify: `lib/game/farm/messages.ts`, `lib/game/farm/handbook.ts`
- Test: `tests/unit/farm-messages.test.ts`, `tests/unit/farm-handbook.test.ts` (modify)

**Interfaces:**
- Consumes: Task 6's `UplandCrop`, `uplandHours`, `FarmItem`, `CropView.kind` / `upland` / `parts` (the crop tabs print the config's hours); from v15.1: `farmErrorMessage(err, itemName)`, `PHASE_NAME`, `WATER_NAME`, `durationText`, `riceSummary`, `handbookPage(tab, varieties)`, `handbookTabFor`, `HandbookSection`.
- Produces:
  - `messages.ts`: `BED_WATER_NAME` (Khô / Ẩm / Đẫm / Ngập), `bedLevelsText(levels)`, `uplandPhaseName(u, phase)`; `GIFT_TEXT` names the sickle; `NOT_OPEN_152 = "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016."`; the toasts `partText(k, kg)`, `partsDoneText(plot, total, varietyName)`, `harvesterStartText(plot)`, `harvesterDoneText(plot, kg, varietyName)`, `pickingText(kg, cropName, k, n)`, `produceSaleText(kg, cropName, earned)`, `loadedText(itemName)`; `produceSummary(rice, produce)` (the HUD line); `farmErrorMessage(err, itemName?, action?)` maps the §11.7 refusals, and with the `"harvest_part"` context reads `too fast` as "Chưa xong bó lúa — thử lại sau vài giây." and `not your plot` as "Hết hạn thuê — phần lúa chưa gặt đã mất.";
  - `handbook.ts`: `HandbookTab` is a string; `handbookTabs(uplands)` = the rice tabs, a tab per crop (its id and name), then `["tools", "Nông cụ"]`; `uplandHandbook(u, items)` works a crop's page out of its config; `handbookPage(tab, varieties, uplands = [], items = [])`; `handbookTabFor` links beds to their crop's tab and ripe or partly cut rice to Nông cụ; the rice tabs get the §14 edits.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-messages.test.ts — edit 1 of 4.** Replace:

```ts
import {
  boughtText, durationText, farmErrorMessage, harvestText, isMissingRpc, PEST_NAME, PEST_REMEDY, PHASE_NAME, riceSaleText, riceSummary,
} from "@/lib/game/farm/messages";
import { AnticheatError } from "@/lib/anticheat";
```

with:

```ts
import {
  bedLevelsText, boughtText, durationText, farmErrorMessage, GIFT_TEXT, harvesterDoneText, harvesterStartText, harvestText, isMissingRpc,
  loadedText, NOT_OPEN_152, partsDoneText, partText, PEST_NAME, PEST_REMEDY, PHASE_NAME, pickingText, produceSaleText, produceSummary,
  riceSaleText, riceSummary, uplandPhaseName,
} from "@/lib/game/farm/messages";
import { uplandFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import fixtures from "@/tests/fixtures/upland-cases.json";
import { AnticheatError } from "@/lib/anticheat";
```

**tests/unit/farm-messages.test.ts — edit 2 of 4.** Replace:

```ts
    expect([m("offer expired"), m("offer not found")]).toEqual(["Đề nghị không còn nữa.", "Đề nghị không còn nữa."]);
    expect(m("crop exists")).toBe("Đang có lúa trên thửa — gặt hoặc bỏ vụ trước.");
    expect(m("leased")).toBe("Thửa đang cho thuê.");
```

with:

```ts
    expect([m("offer expired"), m("offer not found")]).toEqual(["Đề nghị không còn nữa.", "Đề nghị không còn nữa."]);
    expect(m("crop exists")).toBe("Đang có vụ trên thửa — thu hoạch hoặc bỏ vụ trước.");
    expect(m("leased")).toBe("Thửa đang cho thuê.");
```

**tests/unit/farm-messages.test.ts — edit 3 of 4.** Replace:

```ts
    expect(farmErrorMessage({ message: "account banned" })).toBe("Tài khoản đã bị khoá.");
  });
```

with:

```ts
    expect(farmErrorMessage({ message: "account banned" })).toBe("Tài khoản đã bị khoá.");
  });
  it("maps the v15.2 refusals (§11.7), and reads a harvest round's in its context", () => {
    const m = (message: string, action?: string) => farmErrorMessage({ message }, undefined, action);
    expect(m("no sickle")).toBe("Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).");
    expect(m("no sprayer")).toBe("Chưa có bình phun — mua ở tiệm anh Hai.");
    expect(m("harvesting")).toBe("Đang gặt dở — gặt cho xong đã.");
    expect(m("harvester busy")).toBe("Máy gặt đang gặt thửa này.");
    expect(m("work expired")).toBe("Lượt gặt đã quá lâu — bắt đầu lại nhé.");
    expect(m("lease ending")).toBe("Sắp hết hạn thuê — không kịp gặt phần này.");
    expect(m("lease ends")).toBe("Không kịp gặt xong trước khi hết hạn thuê.");
    expect(m("wrong crop")).toBe("Việc này không hợp với cây trên thửa.");
    expect(m("already owned")).toBe("Bạn đã có món này rồi.");
    expect(m("not enough crop")).toBe("Không đủ hàng để bán.");
    expect([m("invalid crop"), m("invalid act")]).toEqual(["Có lỗi, thử lại nhé.", "Có lỗi, thử lại nhé."]);
    expect([m("too fast", "harvest_part"), m("too fast")]).toEqual(["Chưa xong bó lúa — thử lại sau vài giây.", "Từ từ thôi…"]);
    expect([m("not your plot", "harvest_part"), m("not your plot")])
      .toEqual(["Hết hạn thuê — phần lúa chưa gặt đã mất.", "Thửa này không phải của bạn."]);
    expect(NOT_OPEN_152).toBe("Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.");
  });
```

**tests/unit/farm-messages.test.ts — edit 4 of 4.** Append at the end of the file, after a blank line:

```ts
describe("v15.2 texts (§9, §13)", () => {
  const [khoai, , ot] = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  it("names the beds' water and the hoa-màu phases", () => {
    expect([bedLevelsText([1]), bedLevelsText([0, 1]), bedLevelsText([1, 2]), bedLevelsText([3])]).toEqual(["Ẩm", "Khô–Ẩm", "Ẩm–Đẫm", "Ngập"]);
    expect(["prepared", "nursery", "grow", "waiting", "ripe", "overripe"].map((p) => uplandPhaseName(ot, p))).toEqual([
      "Đã lên luống", "Đang ươm cây con", "Phát triển thân lá", "Chờ lứa sau", "Chín", "Chín quá",
    ]);
    expect(uplandPhaseName(khoai, "tuber")).toBe("Tượng củ");
  });
  it("tells the gift, the parts, the harvester, the pickings, the sale and the tank", () => {
    expect(GIFT_TEXT).toBe("🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày, 1 bao urê và 1 cây liềm — xem Sổ tay nhà nông nhé!");
    expect(partText(2, 13)).toBe("✅ Xong phần 2/6: 13 kg lúa.");
    expect(partsDoneText(3, 75, "Nếp")).toBe("🌾 Gặt xong thửa 3: tổng 75 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
    expect(harvesterStartText(3)).toBe("🚜 Máy gặt đang vào thửa 3 — 30 giây nữa xong.");
    expect(harvesterDoneText(3, 50, "Nếp")).toBe("🚜 Máy gặt gặt xong thửa 3: 50 kg nếp (lúa ướt).");
    expect(pickingText(24, "Ớt", 1, 3)).toBe("🧺 Thu hoạch 24 kg ớt (lứa 1/3) — đem bán cho cô Út nhé!");
    expect(pickingText(197, "Khoai lang", 1, 1)).toBe("🧺 Thu hoạch 197 kg khoai lang — đem bán cho cô Út nhé!");
    expect(produceSaleText(180, "Khoai lang", 47_700)).toBe("💰 Bán 180 kg khoai lang được 47.700 xu.");
    expect(loadedText("Thuốc trừ sâu")).toBe("🧴 Đã nạp thuốc trừ sâu vào bình phun — 3 lần xịt.");
  });
  it("adds the hoa màu to the HUD's line when there is any", () => {
    expect(produceSummary({ nep: { wet: 0, dry: 70 } }, {})).toBe("🌾 70 kg khô · 0 kg ướt");
    expect(produceSummary({ nep: { wet: 0, dry: 70 } }, { khoai: 180 })).toBe("🌾 70 kg khô · 0 kg ướt · 🧺 180 kg màu");
    expect(produceSummary({}, { ot: 22, bap: 8 })).toBe("🌾 Chưa có lúa · 🧺 30 kg màu");
  });
});
```

**tests/unit/farm-handbook.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookPage, handbookTabFor } from "@/lib/game/farm/handbook";
import type { CropView } from "@/lib/game/farm/state";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookPage, handbookTabFor, handbookTabs, uplandHandbook } from "@/lib/game/farm/handbook";
import type { CropView } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/farm-handbook.test.ts — edit 2 of 2.** Replace:

```ts
    expect(handbookTabFor(crop({}), nep, at(12 + 45))).toBe("process");
  });
});
```

with:

```ts
    expect(handbookTabFor(crop({}), nep, at(12 + 45))).toBe("process");
    // v15.2: ripe or partly cut rice opens Nông cụ; beds open their crop's tab
    expect(handbookTabFor(crop({}), nep, at(12 + 49))).toBe("tools");
    expect(handbookTabFor(crop({ parts: 2 }), nep, at(12 + 47))).toBe("tools");
    expect(handbookTabFor(crop({ kind: "upland", variety: null, upland: "ot" }), null, at(20))).toBe("ot");
    expect(handbookTabFor(crop({ kind: "upland", variety: null, upland: null }), null, at(20))).toBe("process");
  });
});

describe("v15.2 tabs (§14)", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const [khoai, bap, ot] = UPLANDS;
  const ITEMS = [
    ["fert_urea", "Phân urê"], ["fert_potash", "Phân kali"], ["fert_npk", "Phân NPK"], ["spray_insect", "Thuốc trừ sâu"],
    ["spray_fungus", "Thuốc trừ bệnh"],
  ].map(([id, name]) => farmItemFromRow({ id, kind: "fertilizer", name, price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null }));
  it("adds a tab per crop and Nông cụ, after the rice tabs", () => {
    expect(handbookTabs(UPLANDS).map(([, label]) => label)).toEqual([
      "Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo", "Khoai lang", "Bắp", "Ớt", "Nông cụ",
    ]);
    expect(handbookPage("process", [nep])[0].lines[10]).toBe(
      "11. Gặt: lúa chín và đã rút nước thì gặt bằng liềm hoặc thuê máy gặt. Ruộng chia 6 phần; mỗi lượt gặt tay có 8 bó — được từ 4 điểm trở lên (chuẩn 1, được nửa điểm, lệch 0) là xong 1 phần. Lúa chín quá vẫn mất 2% mỗi giờ tới lúc cắt từng phần; để 2 ngày thì rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út.");
    expect(handbookPage("pests", [nep]).flatMap((s) => s.lines)).toContain("Hoa màu có sâu bệnh riêng — xem tab từng cây.");
    expect(handbookPage("tips", [nep])[0].lines.slice(-2)).toEqual([
      "Làm đất có hai cách: làm ruộng lúa hoặc lên luống trồng màu — xen vụ lúa với vụ màu cho đỡ nhàm.",
      "Nạp thuốc trừ sâu vào bình phun là lợi nhất: nó trị sâu cuốn lá, sùng khoai, sâu keo và bọ trĩ.",
    ]);
    expect(handbookPage("tools", [nep]).map((s) => s.title)).toEqual(["Liềm và gặt lúa", "Máy gặt", "Bình phun", "Hoa màu"]);
    expect(handbookPage("ot", [nep], UPLANDS, ITEMS)).toEqual(uplandHandbook(ot, ITEMS));
    expect(handbookPage("dua", [nep], UPLANDS, ITEMS)).toEqual([]);
  });
  it("works each crop's page out of its config", () => {
    const [how, pests] = uplandHandbook(ot, ITEMS);
    expect(how.title).toBe("Cách trồng ớt (~80 giờ, hái 3 lứa)");
    expect(how.lines).toEqual([
      "1. Lên luống: đắp luống cao cho ráo nước; đất sẵn Ẩm.",
      "2. Bón lót: phân chuồng hoai và phân lân trước khi trồng. Thiếu mỗi loại mất 5%.",
      "3. Ươm hạt ớt ở góc luống khi đất Ẩm, giữ Ẩm. Trồng cây ớt con khi cây 10–18 giờ tuổi, đất Ẩm; cây già quá mất 3% mỗi giờ (tối đa 30%).",
      "4. Bón thúc bén rễ: phân urê hoặc phân NPK, 4–12 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
      "5. Bón thúc ra hoa: phân NPK hoặc phân kali, 22–30 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
      "6. Bón nuôi trái: phân NPK hoặc phân kali, 46–56 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
      "Nước: Bén rễ Ẩm; Phát triển thân lá, Ra hoa, Đậu trái Ẩm–Đẫm; từ lúc chín Khô–Ẩm. Cứ 12 giờ nước tự rút một mức; mỗi giờ sai mức mất 1% (tối đa 20%).",
      "Hái ớt: chín 46 giờ sau trồng, rồi cứ 12 giờ một lứa (40% – 35% – 25%). Đất phải Khô–Ẩm. Chín quá 8 giờ mất 3% mỗi giờ; để thêm 24 giờ là lứa đó hư.",
    ]);
    expect(pests.lines).toEqual([
      "Bọ trĩ: hay tới 6–24 giờ sau trồng; đất Khô dễ bị gấp 1,5. Xịt thuốc trừ sâu.",
      "Thán thư: hay tới 40–64 giờ sau trồng; đất Đẫm dễ bị gấp 2. Xịt thuốc trừ bệnh.",
      "Bón đạm (urê, NPK) ngoài các đợt bón thúc, hoặc hai lần trong một đợt, là dư đạm: mất 10%, sâu bệnh dễ tới gấp rưỡi.",
      "Mẹo: ớt nhiều việc nhất mà lời nhất; tháo nước về Ẩm trước mỗi lứa hái.",
    ]);
    const [kHow, kPests] = uplandHandbook(khoai, ITEMS);
    expect(kHow.title).toBe("Cách trồng khoai lang (~48 giờ)");
    expect(kHow.lines[2]).toBe("3. Trồng dây khoai khi đất Ẩm.");
    expect(kHow.lines[4]).toBe("5. Lật dây: 24–32 giờ sau trồng; trễ tới 40 giờ được nửa công (mất 5%); không làm mất 10%.");
    expect(kHow.lines[6]).toBe("Đào khoai: chín 48 giờ sau trồng. Đất phải Khô–Ẩm. Chín quá 12 giờ mất 2% mỗi giờ; để thêm 48 giờ là cả vụ hư.");
    expect(kPests.lines[1]).toBe("Từ 22 giờ sau trồng, đất Đẫm hay Ngập là úng, thối củ: mất 3% mỗi giờ (tối đa 50%).");
    expect(uplandHandbook(bap, ITEMS)[0].lines[2]).toBe("3. Gieo hạt bắp thẳng xuống luống khi đất Ẩm — không cần ươm.");
  });
  it("prints every hour inside its window", () => {
    for (const u of UPLANDS) {
      const lines = uplandHandbook(u, ITEMS)[0].lines;
      u.cares.forEach((c, i) => {
        const [, from, to] = /(\d+)–(\d+) giờ sau trồng/.exec(lines[3 + i])!.map(Number);
        expect(from >= c.fromH && to <= c.toH && from <= to, `${u.id} ${c.id}`).toBe(true);
      });
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts`
Expected: FAIL — 9 tests fail (`handbookTabs is not a function`, `uplandHandbook is not a function`, `bedLevelsText is not a function`, `produceSummary is not a function`, the old gift text, "Có lỗi, thử lại nhé." for the new refusals); 10 pass.

- [ ] **Step 3: Implement**

**lib/game/farm/messages.ts — edit 1 of 7.** Replace:

```ts
import { lockSeconds, lockText } from "@/lib/anticheat";
import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13): names, durations, toasts and the RPC errors. Pure.
```

with:

```ts
import { lockSeconds, lockText } from "@/lib/anticheat";
import type { UplandCrop } from "./catalog";
import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13; v15.2 §11.7, §13): names, durations, toasts and the RPC errors.
// Pure.
```

**lib/game/farm/messages.ts — edit 2 of 7.** Replace:

```ts
export const WATER_NAME: readonly string[] = ["Khô", "Ẩm", "Nông", "Sâu"];

export const GIFT_TEXT = "🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày và 1 bao urê — xem Sổ tay nhà nông nhé!";
export const NOT_OPEN = "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
```

with:

```ts
export const WATER_NAME: readonly string[] = ["Khô", "Ẩm", "Nông", "Sâu"];
/** The same four levels on raised beds (v15.2 R22). */
export const BED_WATER_NAME: readonly string[] = ["Khô", "Ẩm", "Đẫm", "Ngập"];

/** A run of levels on beds: [1] → "Ẩm", [0, 1] → "Khô–Ẩm". */
export function bedLevelsText(levels: readonly number[]): string {
  if (levels.length === 0) return "";
  const lo = Math.min(...levels), hi = Math.max(...levels);
  return lo === hi ? BED_WATER_NAME[lo] : `${BED_WATER_NAME[lo]}–${BED_WATER_NAME[hi]}`;
}

/** The phases of a crop on beds (v15.2 §13.1); a stage is named by the crop's config. */
const UP_PHASE_NAME: Record<string, string> = {
  prepared: "Đã lên luống", nursery: "Đang ươm cây con", waiting: "Chờ lứa sau", ripe: "Chín", overripe: "Chín quá", done: "Hết lứa",
};
export function uplandPhaseName(u: UplandCrop | null, phase: string): string {
  return UP_PHASE_NAME[phase] ?? u?.stages.find((s) => s.id === phase)?.name ?? phase;
}

export const GIFT_TEXT = "🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày, 1 bao urê và 1 cây liềm — xem Sổ tay nhà nông nhé!";
export const NOT_OPEN = "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013.";
/** A v15.2 action against a database without 0016 (R28). */
export const NOT_OPEN_152 = "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
```

**lib/game/farm/messages.ts — edit 3 of 7.** Replace:

```ts

/** The HUD's rice line on the field: every variety together. */
```

with:

```ts

/** A won round's part (§13.2), and the sixth part's whole harvest. */
export function partText(k: number, kg: number): string {
  return `✅ Xong phần ${k}/6: ${kg} kg lúa.`;
}
export function partsDoneText(plot: number, total: number, varietyName: string): string {
  return `🌾 Gặt xong thửa ${plot}: tổng ${total} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}

/** The harvester's toasts (§13.4): at the rent, and at its end with the wet stock it brought (R15). */
export function harvesterStartText(plot: number): string {
  return `🚜 Máy gặt đang vào thửa ${plot} — 30 giây nữa xong.`;
}
export function harvesterDoneText(plot: number, kg: number, varietyName: string): string {
  return `🚜 Máy gặt gặt xong thửa ${plot}: ${kg} kg ${varietyName.toLowerCase()} (lúa ướt).`;
}

/** A picking (§13.6); "(lứa k/n)" only for a crop picked more than once. */
export function pickingText(kg: number, cropName: string, k: number, n: number): string {
  return `🧺 Thu hoạch ${kg} kg ${cropName.toLowerCase()}${n > 1 ? ` (lứa ${k}/${n})` : ""} — đem bán cho cô Út nhé!`;
}

export function produceSaleText(kg: number, cropName: string, earned: number): string {
  return `💰 Bán ${kg} kg ${cropName.toLowerCase()} được ${earned.toLocaleString("vi-VN")} xu.`;
}

/** Nạp thuốc (§13.5). */
export function loadedText(itemName: string): string {
  return `🧴 Đã nạp ${itemName.charAt(0).toLowerCase()}${itemName.slice(1)} vào bình phun — 3 lần xịt.`;
}

/** The HUD's rice line on the field: every variety together. */
```

**lib/game/farm/messages.ts — edit 4 of 7.** Replace:

```ts
  return dry + wet === 0 ? "🌾 Chưa có lúa" : `🌾 ${dry} kg khô · ${wet} kg ướt`;
}
```

with:

```ts
  return dry + wet === 0 ? "🌾 Chưa có lúa" : `🌾 ${dry} kg khô · ${wet} kg ướt`;
}

/** The HUD's line (§13.6): the rice, then the hoa màu when there is any. */
export function produceSummary(rice: Record<string, { wet: number; dry: number }>, produce: Record<string, number>): string {
  const kg = Object.values(produce).reduce((a, x) => a + x, 0);
  return kg > 0 ? `${riceSummary(rice)} · 🧺 ${kg} kg màu` : riceSummary(rice);
}
```

**lib/game/farm/messages.ts — edit 5 of 7.** Replace:

```ts

/** Vietnamese toast text for a farm RPC error (spec §11.7). `itemName` names the item a "no item" error is about. */
export function farmErrorMessage(err: unknown, itemName?: string): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  switch (msg) {
    case "not your plot": return "Thửa này không phải của bạn.";
    case "plot taken": return "Thửa này đã có người canh tác.";
```

with:

```ts

/** Vietnamese toast text for a farm RPC error (spec §11.7, v15.2 §11.7). `itemName` names the item a "no item" error is
 *  about; `action` = "harvest_part" reads a harvest round's refusals (the HarvestGame overlay). */
export function farmErrorMessage(err: unknown, itemName?: string, action?: string): string {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const round = action === "harvest_part";
  switch (msg) {
    case "not your plot": return round ? "Hết hạn thuê — phần lúa chưa gặt đã mất." : "Thửa này không phải của bạn.";
    case "plot taken": return "Thửa này đã có người canh tác.";
```

**lib/game/farm/messages.ts — edit 6 of 7.** Replace:

```ts
    case "buyer cannot buy": return "Người mua không còn đủ điều kiện (xu hoặc đất).";
    case "crop exists": return "Đang có lúa trên thửa — gặt hoặc bỏ vụ trước.";
    case "leased": return "Thửa đang cho thuê.";
```

with:

```ts
    case "buyer cannot buy": return "Người mua không còn đủ điều kiện (xu hoặc đất).";
    case "crop exists": return "Đang có vụ trên thửa — thu hoạch hoặc bỏ vụ trước.";
    case "leased": return "Thửa đang cho thuê.";
```

**lib/game/farm/messages.ts — edit 7 of 7.** Replace:

```ts
    case "invalid price": return "Số không hợp lệ.";
    case "too fast": return TOO_FAST;
    case "account locked": return lockText(lockSeconds(err) ?? 300);
```

with:

```ts
    case "invalid price": return "Số không hợp lệ.";
    case "too fast": return round ? "Chưa xong bó lúa — thử lại sau vài giây." : TOO_FAST;
    case "no sickle": return "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).";
    case "no sprayer": return "Chưa có bình phun — mua ở tiệm anh Hai.";
    case "harvesting": return "Đang gặt dở — gặt cho xong đã.";
    case "harvester busy": return "Máy gặt đang gặt thửa này.";
    case "work expired": return "Lượt gặt đã quá lâu — bắt đầu lại nhé.";
    case "lease ending": return "Sắp hết hạn thuê — không kịp gặt phần này.";
    case "lease ends": return "Không kịp gặt xong trước khi hết hạn thuê.";
    case "wrong crop": return "Việc này không hợp với cây trên thửa.";
    case "already owned": return "Bạn đã có món này rồi.";
    case "not enough crop": return "Không đủ hàng để bán.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
```

**lib/game/farm/handbook.ts — edit 1 of 7.** Replace:

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
```

with:

```ts
import { ripeAfterHours, uplandHours, type FarmItem, type UplandCrop, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import { bedLevelsText } from "./messages";
import type { CropView } from "./state";

// Sổ tay nhà nông (spec §8.9, v15.2 §14): the six rice tabs, one tab per hoa-màu crop worked out from its config, and
// "Nông cụ"; the rice timings are worked out per variety from the catalog. Pure.

/** A rice tab, "tools", or a hoa-màu crop's id. */
export type HandbookTab = string;

/** The rice tabs. */
export const HANDBOOK_TABS: ReadonlyArray<[HandbookTab, string]> = [
  ["process", "Quy trình"], ["fertilizer", "Phân bón"], ["pests", "Sâu bệnh"], ["water", "Nước"], ["varieties", "Giống lúa"], ["tips", "Mẹo"],
];

/** Every tab (§14): the rice ones, a tab per hoa-màu crop, then Nông cụ. */
export function handbookTabs(uplands: readonly UplandCrop[]): ReadonlyArray<[HandbookTab, string]> {
  return [...HANDBOOK_TABS, ...uplands.map((u): [HandbookTab, string] => [u.id, u.name]), ["tools", "Nông cụ"]];
}

export interface HandbookSection { title: string; lines: string[] }
```

**lib/game/farm/handbook.ts — edit 2 of 7.** Replace:

```ts
const end = (x: number) => `${Math.floor(x)}`;
```

with:

```ts
const end = (x: number) => `${Math.floor(x)}`;
const pct = (x: number) => `${Math.round(x * 100)}`;
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The crop tips (§14), by crop id. */
const UPLAND_TIPS: Record<string, string> = {
  khoai: "Mẹo: tưới cho Ẩm lúc tượng củ để sùng khỏi chui vào củ, nhưng đừng tưới tới Đẫm.",
  bap: "Mẹo: bắp ưa nước — tưới lên Đẫm là giữ được cả ngày; lúc chắc hạt thì cho ráo.",
  ot: "Mẹo: ớt nhiều việc nhất mà lời nhất; tháo nước về Ẩm trước mỗi lứa hái.",
};

/** A crop's tab (§14), worked out from its config; `items` name the fertilizers and pesticides. */
export function uplandHandbook(u: UplandCrop, items: readonly FarmItem[]): HandbookSection[] {
  const itemName = (id: string) => lc(items.find((i) => i.id === id)?.name ?? id);
  const n = u.pickings.length;
  const total = (u.nurseryReadyH ?? 0) + uplandHours(u, n);
  const how = u.method === "cutting" ? `3. ${u.plantLabel} khi đất Ẩm.`
    : u.method === "direct" ? `3. ${u.plantLabel} thẳng xuống luống khi đất Ẩm — không cần ươm.`
    : `3. ${u.plantLabel} ở góc luống khi đất Ẩm, giữ Ẩm. ${u.transplantLabel ?? ""} khi cây ${start(u.nurseryReadyH ?? 0)}–`
      + `${end(u.nurseryOldH ?? 0)} giờ tuổi, đất Ẩm; cây già quá mất 3% mỗi giờ (tối đa 30%).`;
  const cares = u.cares.map((c, i) => `${4 + i}. ${c.name}: ` + (c.kind === "fert"
    ? `${c.items.map(itemName).join(" hoặc ")}, ${start(c.fromH)}–${end(c.toH)} giờ sau trồng. Sai lúc hoặc sai loại được nửa công `
      + `(mất ${pct(c.penHalf)}%); bỏ trống mất ${pct(c.penMissing)}%.`
    : `${start(c.fromH)}–${end(c.toH)} giờ sau trồng; trễ tới ${end(c.halfToH)} giờ được nửa công (mất ${pct(c.penHalf)}%); `
      + `không làm mất ${pct(c.penMissing)}%.`));
  // stages in a row that want the same levels read as one group
  const groups: Array<{ names: string[]; levels: string }> = [];
  for (const st of u.stages) {
    const levels = bedLevelsText(st.water), last = groups[groups.length - 1];
    if (last && last.levels === levels) last.names.push(st.name);
    else groups.push({ names: [st.name], levels });
  }
  const water = `Nước: ${groups.map((g) => `${g.names.join(", ")} ${g.levels}`).join("; ")}; từ lúc chín ${bedLevelsText(u.ripeWater)}. `
    + "Cứ 12 giờ nước tự rút một mức; mỗi giờ sai mức mất 1% (tối đa 20%).";
  const harvest = `${u.harvestLabel}: chín ${end(uplandHours(u, 1))} giờ sau trồng`
    + (n > 1 ? `, rồi cứ ${end(u.pickGapH ?? 0)} giờ một lứa (${u.pickings.map((p) => `${p}%`).join(" – ")})` : "")
    + `. Đất phải ${bedLevelsText(u.ripeWater)}. Chín quá ${end(u.ripeWindowH)} giờ mất ${pct(u.overRate)}% mỗi giờ; `
    + `để thêm ${end(u.lostAfterH)} giờ là ${n > 1 ? "lứa đó" : "cả vụ"} hư.`;
  const mult = (x: number) => x.toLocaleString("vi-VN");
  const pests = u.pests.map((p) => `${p.name}: hay tới ${start(p.fromH)}–${end(p.toH)} giờ sau trồng`
    + (p.dryMult > 1 ? `; đất Khô dễ bị gấp ${mult(p.dryMult)}` : "") + (p.wetMult > 1 ? `; đất Đẫm dễ bị gấp ${mult(p.wetMult)}` : "")
    + `. Xịt ${itemName(p.remedy)}.`);
  const rot = u.rotFromH === null ? [] : [
    `Từ ${start(u.rotFromH)} giờ sau trồng, đất Đẫm hay Ngập là úng, thối củ: mất ${pct(u.rotRate ?? 0)}% mỗi giờ `
      + `(tối đa ${pct(u.rotCap ?? 0)}%).`,
  ];
  return [
    {
      title: `Cách trồng ${lc(u.name)} (~${end(total)} giờ${n > 1 ? `, hái ${n} lứa` : ""})`,
      lines: [
        "1. Lên luống: đắp luống cao cho ráo nước; đất sẵn Ẩm.",
        "2. Bón lót: phân chuồng hoai và phân lân trước khi trồng. Thiếu mỗi loại mất 5%.",
        how, ...cares, water, harvest,
      ],
    },
    {
      title: "Sâu bệnh và lưu ý",
      lines: [
        ...pests, ...rot,
        "Bón đạm (urê, NPK) ngoài các đợt bón thúc, hoặc hai lần trong một đợt, là dư đạm: mất 10%, sâu bệnh dễ tới gấp rưỡi.",
        ...(UPLAND_TIPS[u.id] ? [UPLAND_TIPS[u.id]] : []),
      ],
    },
  ];
}

/** The Nông cụ tab (§14), verbatim. */
const TOOLS_PAGE: HandbookSection[] = [
  {
    title: "Liềm và gặt lúa",
    lines: [
      "Lúa chín phải gặt bằng liềm hoặc máy gặt, và phải rút nước (Khô–Ẩm) trước.",
      "Liềm (1.500 xu, mua một lần ở tiệm anh Hai). Ruộng lúa chia 6 phần; mỗi phần gặt bằng một lượt tay.",
      "Mỗi lượt có 8 bó: giữ cho lực liềm lên, thả khi vạch nằm trong vùng xanh. Chuẩn được 1 điểm, được nửa điểm, lệch 0 điểm. Từ 4 điểm trở lên là xong 1 phần; hụt thì thử lại ngay, không mất gì.",
      "Mỗi phần cho 1/6 sản lượng lúc cắt: lúa chín quá thì phần cắt sau ít hơn. Điểm cao không làm tăng sản lượng — chỉ cần đạt.",
      "Đang gặt dở thì chưa bón, tưới hay xịt được — gặt cho xong.",
    ],
  },
  {
    title: "Máy gặt",
    lines: [
      "Thuê ở Hợp tác xã (chú Tám): 500 xu mỗi phần còn lại, cả thửa 3.000 xu. Gặt hết trong 30 giây, không cần liềm, không huỷ được.",
      "Thuê được cả khi đã gặt tay dở. Ruộng thuê phải gặt xong trước khi hết hạn.",
    ],
  },
  {
    title: "Bình phun",
    lines: [
      "Bình phun (5.000 xu, mua một lần): nạp 1 chai thuốc được 3 lần xịt.",
      "Xịt đúng loại thuốc trong bình thì dùng bình; loại khác thì lấy chai trong giỏ.",
      "Nạp loại khác là đổ bỏ phần thuốc còn lại trong bình.",
    ],
  },
  { title: "Hoa màu", lines: ["Khoai, bắp, ớt không cần liềm: đào, bẻ, hái bằng tay trong 3 giây."] },
];
```

**lib/game/farm/handbook.ts — edit 3 of 7.** Replace:

```ts

export function handbookPage(tab: HandbookTab, varieties: readonly Variety[]): HandbookSection[] {
  switch (tab) {
```

with:

```ts

export function handbookPage(tab: HandbookTab, varieties: readonly Variety[], uplands: readonly UplandCrop[] = [],
  items: readonly FarmItem[] = []): HandbookSection[] {
  switch (tab) {
```

**lib/game/farm/handbook.ts — edit 4 of 7.** Replace:

```ts
            "10. Rút nước: khi lúa vào chắc.",
            "11. Gặt: khi lúa chín; trễ mất 2% mỗi giờ, để 2 ngày thì lúa rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út.",
          ],
```

with:

```ts
            "10. Rút nước: khi lúa vào chắc.",
            "11. Gặt: lúa chín và đã rút nước thì gặt bằng liềm hoặc thuê máy gặt. Ruộng chia 6 phần; mỗi lượt gặt tay có 8 bó — được từ 4 điểm trở lên (chuẩn 1, được nửa điểm, lệch 0) là xong 1 phần. Lúa chín quá vẫn mất 2% mỗi giờ tới lúc cắt từng phần; để 2 ngày thì rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út.",
          ],
```

**lib/game/farm/handbook.ts — edit 5 of 7.** Replace:

```ts
            "Dư đạm làm sâu bệnh dễ tới hơn; lúa thơm dễ bị đạo ôn hơn.",
          ],
```

with:

```ts
            "Dư đạm làm sâu bệnh dễ tới hơn; lúa thơm dễ bị đạo ôn hơn.",
            "Hoa màu có sâu bệnh riêng — xem tab từng cây.",
          ],
```

**lib/game/farm/handbook.ts — edit 6 of 7.** Replace:

```ts
          "Gặt xong là trả ruộng thuê; muốn làm vụ nữa thì thuê lại.",
        ],
      }];
  }
```

with:

```ts
          "Gặt xong là trả ruộng thuê; muốn làm vụ nữa thì thuê lại.",
          "Làm đất có hai cách: làm ruộng lúa hoặc lên luống trồng màu — xen vụ lúa với vụ màu cho đỡ nhàm.",
          "Nạp thuốc trừ sâu vào bình phun là lợi nhất: nó trị sâu cuốn lá, sùng khoai, sâu keo và bọ trĩ.",
        ],
      }];
    case "tools":
      return TOOLS_PAGE;
    default: {
      const u = uplands.find((x) => x.id === tab);
      return u ? uplandHandbook(u, items) : [];
    }
  }
```

**lib/game/farm/handbook.ts — edit 7 of 7.** Replace:

```ts

/** The tab the plot panel links to: what matters on this crop now. */
export function handbookTabFor(crop: CropView | null, v: Variety | null, now: number): HandbookTab {
  if (!crop) return "process";
  if (crop.pests.some((p) => p.treatedAt === null)) return "pests";
  const ph = cropPhase(cropModel(crop), v, now);
  return ph === "tillering" || ph === "panicle" ? "fertilizer" : "process";
```

with:

```ts

/** The tab the plot panel links to: what matters on this crop now — the crop's tab for beds, Nông cụ for ripe or partly
 *  cut rice (§13.1). */
export function handbookTabFor(crop: CropView | null, v: Variety | null, now: number): HandbookTab {
  if (!crop) return "process";
  if (crop.kind === "upland") return crop.upland ?? "process";
  if (crop.pests.some((p) => p.treatedAt === null)) return "pests";
  const ph = cropPhase(cropModel(crop), v, now);
  if (ph === "ripe" || ph === "overripe" || crop.parts > 0) return "tools";
  return ph === "tillering" || ph === "panicle" ? "fertilizer" : "process";
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 19 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/handbook.ts lib/game/farm/messages.ts tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the texts and the handbook — v15.2 refusals, toasts, crop tabs, Nông cụ

farmErrorMessage maps the new refusals and reads a harvest round's in its
context; the toasts and the HUD line gain parts, the harvester, pickings, the
sale and the tank. The handbook gains a tab per hoa-màu crop, worked out from
its config, and the verbatim Nông cụ tab; the rice tabs get their edits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/handbook.ts lib/game/farm/messages.ts tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts
git commit -F <message file>
```

---

### Task 9: The plot's actions and tasks — rounds, beds, the tank, the harvester's refusals

**Files:**
- Modify: `lib/game/farm/actions.ts`, `lib/game/farm/land.ts`, `hooks/useFarmController.ts` (`dueTasks` gets the catalog and my stock; a round is left to its overlay)
- Test: `tests/unit/farm-actions.test.ts`, `tests/unit/farm-land.test.ts`, `tests/unit/farm-plot-panel.test.tsx`, `tests/unit/use-farm-controller.test.tsx`, `tests/unit/anticheat-pins.test.tsx` (modify)

**Interfaces:**
- Consumes: Tasks 6–8 (`FarmCatalog`, `UplandCrop`, `UplandCare`, the constants, `harvesterPrice`, `CropView`'s new fields, `FarmMine.tank`, the `upland.ts` model, `BED_WATER_NAME`, `bedLevelsText`, `durationText`); from v15.1: `PlotAction { key, label, run, enabled, reason?, warn? }`, `plotActions`, `fertAdvice`, `plotPrompt`, `PROMPT_JOB`, `FarmTask`; `land.ts`'s `LandCtx`, `isFarmer` and the other `…Refusal(p, ctx)` helpers (a server error code or null).
- Produces:
  - `actions.ts`: `PlotRun` gains `{ kind: "round"; plot }`; `uplandOf(crop, catalog)`, `harvesterOn(crop)`; `upFertAdvice(c, u, item, name, now)`, `tendAdvice(c, care, now) → { done, ok, text }`; `plotActions(p, me, v, catalog, mine, now)`: a bare plot offers "Làm ruộng lúa" and "Lên luống trồng màu" (and soaking); ripe rice offers "Gặt bằng liềm", then "Gặt tiếp (phần n/6)", disabled with the server's reason in order (ripening → water → sickle); a partly cut plot keeps only the next round and "Bỏ vụ"; a running harvester takes every button; beds plant each hoa-màu seed held, set out the ớt, tend by the config's acts (stopping at `TEND_MAX`), water with the rot warning, fertilize by `upFertAdvice`, spray from the tank first ("còn c lần") and pick "(lứa k/n)"; `plotPrompt` names the rounds and the bed jobs; `dueTasks(plots, me, catalog, mine, now)` follows the parts, a running harvester, a missing sickle from heading on, and the beds (planting, bón lót, the nursery, the hand jobs, the pickings, the water, the pests);
  - `land.ts`: `harvesterRefusal(p, ctx, v, now) → string | null`, `rent_harvester`'s checks in its order (not your plot, not prepared, harvester busy, wrong crop, wrong phase, need water, lease ends, not enough coins).

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-actions.test.ts — edit 1 of 8.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { dueTasks, fertAdvice, plotActions, plotPrompt, type PlotAction } from "@/lib/game/farm/actions";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { HOUR_MS, type CropModel } from "@/lib/game/farm/crop";
import type { CropView, FarmMine, PestView, PlotView } from "@/lib/game/farm/state";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
  dueTasks, fertAdvice, harvesterOn, lower, plotActions, plotPrompt, tendAdvice, upFertAdvice, uplandOf, type PlotAction,
} from "@/lib/game/farm/actions";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS, type CropModel } from "@/lib/game/farm/crop";
import type { CropView, FarmMine, PestView, PlotView } from "@/lib/game/farm/state";
import type { UplandModel } from "@/lib/game/farm/upland";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/farm-actions.test.ts — edit 2 of 8.** Replace:

```ts
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });
```

with:

```ts
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });
const SICKLE = mine({ ...ALL.items, tool_sickle: 1 });
```

**tests/unit/farm-actions.test.ts — edit 3 of 8.** Replace:

```ts

describe("plotActions", () => {
  it("offers làm đất and soaking on a bare plot", () => {
    expect(keys(plotActions(plot(null), "me", null, CATALOG, ALL, at(0)))).toEqual(["prepare", "soak:seed_nep"]);
    const noSeed = plotActions(plot(null), "me", null, CATALOG, mine({}), at(0));
```

with:

```ts

// --- beds: the three crops of the shared fixtures (khoai lang, bắp, ớt)
const ROWS = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
const U = Object.fromEntries(ROWS.map((r) => [r.id, uplandFromRow(r)]));
const BEDS: FarmCatalog = {
  varieties: [nep],
  uplands: ROWS.map(uplandFromRow),
  items: [
    ...CATALOG.items,
    item("seed_khoai", "seed", "Dây khoai giống", { upland: "khoai" }),
    item("seed_ot", "seed", "Hạt ớt giống", { upland: "ot" }),
    item("fert_potash", "fertilizer", "Phân kali", { fert: "potash" }),
    item("spray_insect", "pesticide", "Thuốc trừ sâu", { pest_target: "insect" }),
  ],
};
const BEDMINE = mine({ seed_khoai: 1, seed_ot: 1, fert_manure: 1, fert_urea: 1, fert_potash: 1, spray_insect: 1 });
/** Beds on plot 5, Ẩm from 0 h: `upland` planted at 0 h unless `over` says otherwise. */
const bed = (upland: string | null, over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 1]],
  fert: Array<[number, string]> = [], work: Array<[number, string]> = [], harvests: Array<[number, number, number]> = []): CropView => ({
  ...crop({ kind: "upland", variety: null, upland, soakAt: null, plantAt: upland === null ? null : at(0), pickings: 0 }),
  log: {
    water: water.map(([h, l]) => ({ t: at(h), l })), fert: fert.map(([h, i]) => ({ t: at(h), item: i })), spray: [], picks: [],
    qTransplant: 1, work: work.map(([h, act]) => ({ t: at(h), act })), harvests: harvests.map(([h, k, kg]) => ({ t: at(h), k, kg })),
    harvestedKg: 0,
  },
  ...over,
});

describe("plotActions", () => {
  it("offers làm đất as a paddy or as beds, and soaking, on a bare plot", () => {
    const list = plotActions(plot(null), "me", null, CATALOG, ALL, at(0));
    expect(keys(list)).toEqual(["prepare", "prepare_beds", "soak:seed_nep"]);
    expect(find(list, "prepare")).toMatchObject({ label: "Làm ruộng lúa", hint: "Cày bừa, cho nước ngập ruộng — để cấy lúa." });
    expect(find(list, "prepare_beds")).toMatchObject({
      label: "Lên luống trồng màu", run: { kind: "prepare_beds", plot: 5 }, enabled: true, hint: "Đắp luống cao, đất Ẩm — trồng khoai, bắp, ớt.",
    });
    const noSeed = plotActions(plot(null), "me", null, CATALOG, mine({}), at(0));
```

**tests/unit/farm-actions.test.ts — edit 4 of 8.** Replace:

```ts
  });
  it("harvests ripe rice in a drained plot", () => {
    const ripe = (water: Array<[number, number]>) => plot(crop({ sowAt: at(3), transplantAt: at(12) }, water));
    expect(find(plotActions(ripe([[0, 3], [50, 1]]), "me", nep, CATALOG, ALL, at(55)), "harvest")?.why).toBe("Lúa chưa chín — gặt được sau 5 giờ.");
    expect(find(plotActions(ripe([[0, 3], [55, 3]]), "me", nep, CATALOG, ALL, at(61)), "harvest")?.why).toBe("Rút nước trước khi gặt (đang Sâu).");
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, ALL, at(61)), "harvest")?.enabled).toBe(true);
  });
```

with:

```ts
  });
  it("cuts ripe rice in a drained plot with a sickle, a round at a time", () => {
    const ripe = (water: Array<[number, number]>, over: Partial<CropView> = {}) => plot(crop({ sowAt: at(3), transplantAt: at(12), ...over }, water));
    expect(find(plotActions(ripe([[0, 3], [50, 1]]), "me", nep, CATALOG, SICKLE, at(55)), "round")?.why).toBe("Lúa chưa chín — gặt được sau 5 giờ.");
    expect(find(plotActions(ripe([[0, 3], [55, 3]]), "me", nep, CATALOG, SICKLE, at(61)), "round")?.why).toBe("Rút nước trước khi gặt (đang Sâu).");
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, ALL, at(61)), "round")?.why).toBe("Chưa có liềm — mua ở tiệm anh Hai.");
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, SICKLE, at(61)), "round")).toMatchObject({
      label: "Gặt bằng liềm", run: { kind: "round", plot: 5 }, enabled: true, hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần.",
    });
    // a partly cut plot takes only the next round and Bỏ vụ; nobody picks its snails (R8)
    const snail: PestView = { kind: "snail", since: at(20), treatedAt: null };
    const cut = ripe([[0, 3], [55, 1]], { parts: 2, pests: [snail] });
    const list = plotActions(cut, "me", nep, CATALOG, SICKLE, at(61));
    expect(keys(list)).toEqual(["round", "abandon"]);
    expect(find(list, "round")).toMatchObject({ label: "Gặt tiếp (phần 3/6)", enabled: true });
    expect(find(list, "abandon")?.warn).toBe("Bỏ vụ là mất phần lúa chưa gặt.");
    expect(plotActions({ ...cut, farmer: { id: "lan", name: "Lan" } }, "me", nep, CATALOG, SICKLE, at(61))).toEqual([]);
    // a running harvester takes every button
    const running = ripe([[0, 3], [55, 1]], { harvester: { startedAt: at(61), endsAt: at(61) + 30_000 } });
    expect(plotActions(running, "me", nep, CATALOG, SICKLE, at(61))).toEqual([]);
  });
```

**tests/unit/farm-actions.test.ts — edit 5 of 8.** Replace:

```ts
    ];
    expect(dueTasks(plots, "me", [nep], at(17))).toEqual([
      { plot: 5, text: "Thửa 5 · Bón thúc đẻ nhánh — còn 5 giờ", urgent: true },
      { plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true },
      { plot: 6, text: "Thửa 6 · Làm đất, ngâm giống", urgent: false },
    ]);
```

with:

```ts
    ];
    expect(dueTasks(plots, "me", CATALOG, ALL, at(17))).toEqual([
      { plot: 5, text: "Thửa 5 · Bón thúc đẻ nhánh — còn 5 giờ", urgent: true },
      { plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true },
      { plot: 6, text: "Thửa 6 · Làm đất (ruộng lúa hoặc lên luống)", urgent: false },
    ]);
```

**tests/unit/farm-actions.test.ts — edit 6 of 8.** Replace:

```ts
    const p = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [12, 2]]), { lease: { source: "village", until: at(26), price: 250 } });
    expect(dueTasks([p], "me", [nep], at(24)).map((t) => t.text)).toEqual([
      "Thửa 5 · Hết hạn thuê sau 2 giờ",
```

with:

```ts
    const p = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [12, 2]]), { lease: { source: "village", until: at(26), price: 250 } });
    expect(dueTasks([p], "me", CATALOG, ALL, at(24)).map((t) => t.text)).toEqual([
      "Thửa 5 · Hết hạn thuê sau 2 giờ",
```

**tests/unit/farm-actions.test.ts — edit 7 of 8.** Replace:

```ts
    const ripe = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [52, 1]]));
    expect(dueTasks([ripe], "me", [nep], at(70))).toEqual([{ plot: 5, text: "Thửa 5 · Gặt — còn 2 giờ", urgent: true }]);
  });
```

with:

```ts
    const ripe = plot(crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [52, 1]]));
    expect(dueTasks([ripe], "me", CATALOG, SICKLE, at(70))).toEqual([{ plot: 5, text: "Thửa 5 · Gặt — còn 2 giờ", urgent: true }]);
  });
  it("asks for a sickle from heading on, and follows a cut plot and a running harvester", () => {
    const rice = (water: Array<[number, number]>, over: Partial<CropView> = {}) => plot(crop({ sowAt: at(3), transplantAt: at(12), ...over }, water));
    const tasks = (p: PlotView, h: number, m = ALL) => dueTasks([p], "me", CATALOG, m, at(h)).map((t) => [t.text, t.urgent]);
    expect(tasks(rice([[0, 3], [44, 3]]), 45)).toEqual([["Thửa 5 · Chưa có liềm — mua ở tiệm anh Hai hoặc thuê máy gặt", false]]);
    expect(tasks(rice([[0, 3], [44, 3]]), 45, SICKLE)).toEqual([]);
    expect(tasks(rice([[0, 3], [52, 1]]), 61)).toEqual([
      ["Thửa 5 · Chưa có liềm — mua ở tiệm anh Hai hoặc thuê máy gặt", true], ["Thửa 5 · Gặt — còn 11 giờ", false],
    ]);
    expect(tasks(rice([[0, 3], [52, 1]], { parts: 2 }), 61)).toEqual([["Thửa 5 · Gặt tiếp — đã gặt 2/6 phần", false]]);
    expect(tasks(rice([[0, 3], [52, 1]], { parts: 2 }), 73)).toEqual([["Thửa 5 · Gặt tiếp — đã gặt 2/6 phần", true]]);
    const running = rice([[0, 3], [52, 1]], { harvester: { startedAt: at(61), endsAt: at(61) + 30_000 } });
    expect(dueTasks([running], "me", CATALOG, ALL, at(61) + 5_000)).toEqual([
      { plot: 5, text: "Thửa 5 · Máy gặt đang gặt — còn 25 giây", urgent: false },
    ]);
  });
  it("follows the beds: planting, the ớt nursery, the hand jobs, the pickings, the water and the pests", () => {
    const tasks = (c: CropView, h: number) => dueTasks([plot(c)], "me", BEDS, BEDMINE, at(h)).map((t) => [t.text.replace("Thửa 5 · ", ""), t.urgent]);
    expect(tasks(bed(null), 1)).toEqual([["Trồng hoa màu", false]]);
    // ớt sown at 0 h: its seedlings go out from 10 h and are old from 18 h
    const nursery = (fert: Array<[number, string]> = []) => bed("ot", { sowAt: at(0), plantAt: null }, [[0, 1], [12, 1]], fert);
    expect(tasks(nursery(), 5)).toEqual([["Bón lót (phân chuồng, phân lân)", false], ["Cây ớt con đang lớn — trồng được sau 5 giờ", false]]);
    const based = nursery([[1, "fert_manure"], [1, "fert_phosphate"]]);
    expect(tasks(based, 11)).toEqual([["Trồng cây ớt con", false]]);
    expect(tasks(based, 19)).toEqual([["Trồng cây ớt con", true]]);
    // khoai planted at 0 h: bón thúc nuôi củ 16–26 h, lật dây 24–32 h, rot from 22 h, ripe at 48 h for 12 h
    expect(tasks(bed("khoai", {}, [[0, 0]]), 3)).toEqual([["Tưới nước (đang Khô, cần Ẩm)", true]]);
    expect(tasks(bed("khoai", {}, [[0, 1], [24, 1]]), 25)).toEqual([["Bón thúc nuôi củ — còn 1 giờ", true], ["Lật dây — còn 7 giờ", true]]);
    const tended = (water: Array<[number, number]>) => bed("khoai", {}, water, [[20, "fert_potash"]], [[25, "lat_day"]]);
    expect(tasks(tended([[0, 1], [24, 1]]), 26)).toEqual([]);
    expect(tasks(bed("khoai", {}, [[0, 1], [22, 2]]), 23)).toEqual([
      ["Bón thúc nuôi củ — còn 3 giờ", true], ["Tháo nước ngay — khoai lang đang thối củ!", true],
    ]);
    expect(tasks(tended([[0, 1], [48, 1]]), 50)).toEqual([["Đào khoai — còn 10 giờ", false]]);
    expect(tasks(tended([[0, 1], [48, 1]]), 58)).toEqual([["Đào khoai — còn 2 giờ", true]]);
    expect(tasks(tended([[0, 1], [48, 1]]), 61)).toEqual([["Đào khoai ngay — đang hư!", true]]);
    const weevil: PestView = { kind: "weevil", since: at(30), treatedAt: null };
    expect(tasks({ ...tended([[0, 1], [24, 1]]), pests: [weevil] }, 31)).toEqual([["Sùng khoai! Xịt thuốc trừ sâu", true]]);
    // ớt set out at 12 h and picked once at 59 h: the next picking is ripe at 70 h
    const ot = bed("ot", { sowAt: at(0), plantAt: at(12) }, [[0, 1], [59, 1]], [], [], [[59, 1, 24]]);
    expect(tasks(ot, 60)).toEqual([["Bón nuôi trái — còn 8 giờ", true], ["Hái ớt lứa 2 — chín sau 10 giờ", false]]);
  });
});

describe("plotActions on beds", () => {
  it("plants each hoa-màu seed I hold on moist beds, or says there is none", () => {
    const list = plotActions(plot(bed(null)), "me", null, BEDS, BEDMINE, at(1));
    expect(keys(list)).toEqual([
      "plant:seed_khoai", "plant:seed_ot", "water_up", "water_down", "fert:fert_manure", "fert:fert_urea", "fert:fert_potash",
      "spray:spray_insect", "abandon",
    ]);
    expect(find(list, "plant:seed_khoai")).toMatchObject({ label: "Trồng dây khoai", run: { kind: "plant", plot: 5, item: "seed_khoai" }, enabled: true });
    expect(find(list, "plant:seed_ot")?.label).toBe("Ươm hạt ớt");
    expect([find(list, "water_up")?.label, find(list, "water_down")?.label]).toEqual(["Tưới nước (lên Đẫm)", "Tháo nước (xuống Khô)"]);
    expect(find(list, "fert:fert_manure")?.hint).toBe("Bón lót trước khi trồng.");
    expect(find(list, "fert:fert_urea")?.warn).toBe("Chưa trồng — bón thúc bây giờ là phí.");
    expect(find(list, "abandon")?.warn).toBe("Bỏ vụ là mất hết hoa màu trên thửa này.");
    const dry = plotActions(plot(bed(null, {}, [[0, 0]])), "me", null, BEDS, BEDMINE, at(1));
    expect(find(dry, "plant:seed_khoai")).toMatchObject({ enabled: false, why: "Cần đất Ẩm (đang Khô)." });
    expect(find(dry, "water_down")).toMatchObject({ enabled: false, why: "Luống đã khô." });
    expect(find(plotActions(plot(bed(null, {}, [[0, 3]])), "me", null, BEDS, BEDMINE, at(1)), "water_up")?.label).toBe("Tưới thêm (giữ Ngập)");
    expect(find(plotActions(plot(bed(null)), "me", null, BEDS, mine({}), at(1)), "plant")).toMatchObject({
      label: "Trồng hoa màu", enabled: false, why: "Chưa có giống hoa màu — ghé tiệm anh Hai.",
    });
  });
  it("sets out the ớt seedlings once old enough, on moist beds", () => {
    const nursery = (water: Array<[number, number]>) => plot(bed("ot", { sowAt: at(0), plantAt: null }, water));
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(6)), "set_out")).toMatchObject({
      label: "Trồng cây ớt con", enabled: false, why: "Cây con chưa đủ tuổi — trồng được sau 4 giờ.",
    });
    expect(find(plotActions(nursery([[0, 1], [10, 2]]), "me", null, BEDS, BEDMINE, at(11)), "set_out")?.why).toBe("Cần đất Ẩm (đang Đẫm).");
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(11)), "set_out")).toMatchObject({
      enabled: true, run: { kind: "work", plot: 5, work: "transplant" },
    });
  });
  it("advises the hand jobs by their windows, and stops at 20 of them", () => {
    const khoai = (work: Array<[number, string]> = []) => plot(bed("khoai", {}, [[0, 1]], [], work));
    const lat = (p: PlotView, h: number) => find(plotActions(p, "me", null, BEDS, BEDMINE, at(h)), "tend:lat_day");
    expect(lat(khoai(), 20)).toMatchObject({
      label: "Lật dây", run: { kind: "tend", plot: 5, act: "lat_day" }, enabled: true, warn: "Chưa tới lúc — lật dây lúc 24–32 giờ sau trồng.",
    });
    expect(lat(khoai(), 25)).toMatchObject({ enabled: true, hint: "Đúng lúc lật dây." });
    expect(lat(khoai([[25, "lat_day"]]), 26)).toMatchObject({ enabled: false, why: "Đã lật dây rồi." });
    expect(lat(khoai(), 33)).toMatchObject({ enabled: true, warn: "Trễ rồi — chỉ được nửa công." });
    expect(lat(khoai(), 41)).toMatchObject({ enabled: true, warn: "Quá muộn — làm bây giờ là phí công." });
    expect(lat(khoai(Array.from({ length: 20 }, (_, i): [number, string] => [i, "lat_day"])), 25)).toMatchObject({ enabled: false, why: "Từ từ thôi…" });
    const bap = uplandModel0({ plantAt: at(0) });
    expect(tendAdvice(bap, U.bap.cares.find((c) => c.id === "vun_goc")!, at(20))).toEqual({ done: false, ok: true, text: "Đúng lúc vun gốc." });
  });
  it("warns before watering khoai into rot, and picks only ripe and drained", () => {
    const k = (water: Array<[number, number]>) => plot(bed("khoai", {}, water));
    expect(find(plotActions(k([[0, 1], [22, 1]]), "me", null, BEDS, BEDMINE, at(23)), "water_up")?.warn).toBe("Đất Đẫm làm thối củ khoai lang!");
    expect(find(plotActions(k([[0, 1], [12, 1]]), "me", null, BEDS, BEDMINE, at(20)), "water_up")?.warn).toBeUndefined();
    const pick = (p: PlotView, h: number) => find(plotActions(p, "me", null, BEDS, BEDMINE, at(h)), "picking");
    expect(pick(k([[0, 1]]), 40)).toMatchObject({ label: "Đào khoai", enabled: false, why: "Chưa chín — đào khoai được sau 8 giờ." });
    expect(pick(k([[0, 1], [49, 2]]), 50)?.why).toBe("Tháo bớt nước trước khi đào khoai (đang Đẫm).");
    expect(pick(k([[0, 1], [48, 1]]), 50)).toMatchObject({ enabled: true, run: { kind: "work", plot: 5, work: "harvest" } });
    const ot = plot(bed("ot", { sowAt: at(0), plantAt: at(12) }, [[0, 1], [48, 1]], [], [], [[59, 1, 24]]));
    expect(pick(ot, 60)).toMatchObject({ label: "Hái ớt (lứa 2/3)", enabled: false, why: "Chưa chín — hái ớt được sau 10 giờ." });
  });
  it("sprays from the sprayer's tank first, and says the charges left", () => {
    const weevil: PestView = { kind: "weevil", since: at(30), treatedAt: null };
    const sick = plot(bed("khoai", { pests: [weevil] }));
    const spray = (m: FarmMine) => find(plotActions(sick, "me", null, BEDS, m, at(31)), "spray:spray_insect");
    expect(spray({ ...mine({}), tank: { item: "spray_insect", charges: 2 } })).toMatchObject({
      label: "Xịt thuốc trừ sâu (bình phun)", run: { kind: "spray", plot: 5, item: "spray_insect" }, hint: "Trị sùng khoai. Bình còn 2 lần.",
    });
    expect(spray(BEDMINE)).toMatchObject({ label: "Xịt thuốc trừ sâu", hint: "Trị sùng khoai." });
    expect(spray({ ...BEDMINE, tank: { item: null, charges: 0 } })?.label).toBe("Xịt thuốc trừ sâu");
    expect(spray({ ...mine({}), tank: { item: null, charges: 0 } })).toBeUndefined();
  });
  it("finds the crop on the beds and a running harvester, and lower-cases a name's first letter", () => {
    expect(uplandOf(bed("khoai"), BEDS)?.name).toBe("Khoai lang");
    expect(uplandOf(bed(null), BEDS)).toBeNull();
    expect(uplandOf(crop(), BEDS)).toBeNull();
    expect([harvesterOn(crop({ harvester: { startedAt: 0, endsAt: 1 } })), harvesterOn(crop()), harvesterOn(null)]).toEqual([true, false, false]);
    expect(lower("Phân NPK")).toBe("phân NPK");
  });
});

/** A hoa-màu model: Ẩm from 0 h, nothing done. */
function uplandModel0(over: Partial<UplandModel> = {}): UplandModel {
  return { sowAt: null, plantAt: null, water: [{ t: at(0), l: 1 }], fert: [], work: [], spray: [], harvests: [], ...over };
}

describe("upFertAdvice", () => {
  const NAME: Record<string, string> = {
    fert_manure: "Phân chuồng hoai", fert_phosphate: "Phân lân", fert_urea: "Phân urê", fert_potash: "Phân kali", fert_npk: "Phân NPK",
  };
  const advice = (fert: Array<[number, string]>, item: string, h: number, plant: number | null = 0) => upFertAdvice(
    uplandModel0({ plantAt: plant === null ? null : at(plant), fert: fert.map(([t, i]) => ({ t: at(t), item: i })) }), U.khoai, item, NAME[item], at(h),
  );
  it("before planting: the base fertilizers, once each", () => {
    expect(advice([], "fert_manure", 1, null)).toEqual({ ok: true, text: "Bón lót trước khi trồng." });
    expect(advice([[1, "fert_manure"]], "fert_manure", 2, null)).toEqual({ ok: false, text: "Đã bón lót loại này — bón thêm là phí." });
    expect(advice([], "fert_urea", 1, null)).toEqual({ ok: false, text: "Chưa trồng — bón thúc bây giờ là phí." });
    expect(advice([], "fert_phosphate", 1, 5)).toEqual({ ok: true, text: "Bón lót trước khi trồng." });
  });
  it("after planting: the care windows, the half items and excess nitrogen", () => {
    expect(advice([], "fert_manure", 1)).toEqual({ ok: false, text: "Đã trồng — bón lót bây giờ là phí." });
    expect(advice([], "fert_potash", 20)).toEqual({ ok: true, text: "Đúng lúc bón thúc nuôi củ." });
    expect(advice([], "fert_potash", 10)).toEqual({ ok: false, text: "Hơi sớm — chỉ được nửa công (đúng lúc sau 6 giờ)." });
    expect(advice([], "fert_potash", 30)).toEqual({ ok: false, text: "Trễ rồi — chỉ được nửa công." });
    expect(advice([], "fert_urea", 20)).toEqual({ ok: false, text: "Phân urê lúc này chỉ được nửa công." });
    expect(advice([[20, "fert_npk"]], "fert_npk", 21)).toEqual({ ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" });
    expect(advice([], "fert_urea", 40)).toEqual({ ok: false, text: "Bón đạm lúc này gây dư đạm!" });
    expect(advice([], "fert_potash", 40)).toEqual({ ok: false, text: "Lúc này bón là phí." });
    expect(advice([[20, "fert_potash"]], "fert_potash", 22)).toEqual({ ok: false, text: "Lúc này bón là phí." });
  });
```

**tests/unit/farm-actions.test.ts — edit 8 of 8.** Append at the end of the file, after a blank line:

```ts
describe("plotPrompt, v15.2", () => {
  it("names the rounds and the bed jobs by their buttons", () => {
    const ripe = (over: Partial<CropView> = {}) => plot(crop({ sowAt: at(3), transplantAt: at(12), ...over }, [[0, 3], [55, 1]]));
    expect(plotPrompt(ripe(), "me", nep, CATALOG, SICKLE, at(61))).toBe("Gặt bằng liềm thửa 5");
    expect(plotPrompt(ripe({ parts: 2 }), "me", nep, CATALOG, SICKLE, at(61))).toBe("Gặt tiếp thửa 5");
    expect(plotPrompt(ripe({ harvester: { startedAt: at(61), endsAt: at(61) + 30_000 } }), "me", nep, CATALOG, SICKLE, at(61))).toBe("Xem thửa 5");
    expect(plotPrompt(plot(bed(null)), "me", null, BEDS, BEDMINE, at(1))).toBe("Trồng dây khoai thửa 5");
    expect(plotPrompt(plot(bed("khoai", {}, [[0, 1], [48, 1]])), "me", null, BEDS, BEDMINE, at(50))).toBe("Đào khoai thửa 5");
    expect(plotPrompt(plot(bed("ot", { sowAt: at(0), plantAt: at(12) }, [[0, 1], [57, 1]])), "me", null, BEDS, BEDMINE, at(58))).toBe("Hái ớt thửa 5");
    expect(plotPrompt(plot(bed("ot", { sowAt: at(0), plantAt: null })), "me", null, BEDS, BEDMINE, at(11))).toBe("Trồng cây ớt con thửa 5");
  });
});
```

**tests/unit/farm-land.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, listRefusal, offerRefusal, reasonText, rentRefusal,
  rentSubleaseRefusal, sellBackRefusal, subleaseRefusal, type LandCtx,
```

with:

```ts
import { describe, it, expect } from "vitest";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, harvesterRefusal, listRefusal, offerRefusal, reasonText, rentRefusal,
  rentSubleaseRefusal, sellBackRefusal, subleaseRefusal, type LandCtx,
```

**tests/unit/farm-land.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("the co-op's harvester", () => {
  const H = 3_600_000;
  const t0 = Date.parse("2026-09-25T00:00:00Z");
  const at = (h: number) => t0 + h * H;
  const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
  /** My nếp on plot 5, transplanted at 12 h (ripe 60–72 h), drained at 55 h. */
  const rice = (over: Partial<CropView> = {}, water: Array<[number, number]> = [[0, 3], [55, 1]]): CropView => ({
    kind: "rice", variety: "nep", upland: null, phase: "ripe", preparedAt: at(0), soakAt: at(0), sowAt: at(3), transplantAt: at(12),
    plantAt: null, water: 1, waterSetAt: null, pests: [], excessN: false, ripe: true, rottedAt: null, picking: null, pickings: 1, parts: 0,
    harvester: null,
    log: {
      water: water.map(([h, l]) => ({ t: at(h), l })), fert: [], spray: [], picks: [], qTransplant: 1, work: [], harvests: [], harvestedKg: 0,
    },
    ...over,
  });
  const mineRice = (c: CropView | null, until = at(96)) => plot(5, { farmer: ME, lease: { source: "village", until, price: 250 }, crop: c });
  const now = at(61);

  it("rents for a ripe, drained rice plot of mine, 500 xu a part left, with 30 s left on the lease", () => {
    expect(harvesterRefusal(mineRice(rice()), ctx([]), nep, now)).toBeNull();
    expect(harvesterRefusal(mineRice(rice()), ctx([], 2999), nep, now)).toBe("not enough coins");
    expect(harvesterRefusal(mineRice(rice({ parts: 2 })), ctx([], 2000), nep, now)).toBeNull();
    expect(harvesterRefusal(mineRice(rice({ parts: 2 })), ctx([], 1999), nep, now)).toBe("not enough coins");
    expect(harvesterRefusal(mineRice(rice(), now + 30_000), ctx([]), nep, now)).toBeNull();
    expect(harvesterRefusal(mineRice(rice(), now + 29_999), ctx([]), nep, now)).toBe("lease ends");
  });
  it("refuses in the server's order", () => {
    expect(harvesterRefusal({ ...mineRice(rice()), farmer: LAN }, ctx([]), nep, now)).toBe("not your plot");
    expect(harvesterRefusal(mineRice(null), ctx([]), nep, now)).toBe("not prepared");
    const running = rice({ harvester: { startedAt: now - 5_000, endsAt: now + 25_000 } });
    expect(harvesterRefusal(mineRice(running), ctx([], 0), nep, now)).toBe("harvester busy");
    expect(harvesterRefusal(mineRice(rice({ kind: "upland", variety: null, upland: "khoai" })), ctx([]), nep, now)).toBe("wrong crop");
    expect(harvesterRefusal(mineRice(rice()), ctx([]), nep, at(55))).toBe("wrong phase");
    expect(harvesterRefusal(mineRice(rice({ parts: 6 })), ctx([]), nep, now)).toBe("wrong phase");
    expect(harvesterRefusal(mineRice(rice({}, [[0, 3], [55, 2]])), ctx([], 0), nep, now)).toBe("need water");
    expect(reasonText("harvester busy")).toBe("Máy gặt đang gặt thửa này.");
    expect(reasonText("lease ends")).toBe("Không kịp gặt xong trước khi hết hạn thuê.");
  });
});
```

**tests/unit/farm-plot-panel.test.tsx.** Replace:

```tsx
    renderPlot(2);
    expect(screen.getByRole("button", { name: "Làm đất" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rao bán" })).toBeInTheDocument();
```

with:

```tsx
    renderPlot(2);
    expect(screen.getByRole("button", { name: "Làm ruộng lúa" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Lên luống trồng màu" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rao bán" })).toBeInTheDocument();
```

**tests/unit/use-farm-controller.test.tsx — edit 1 of 4.** Replace:

```tsx
  varieties: [nep],
  items: [farmItemFromRow({ id: "spray_hopper", kind: "pesticide", name: "Thuốc trừ rầy", price: 80, sort_order: 20, variety: null, fert: null, pest_target: "hopper", capacity: null })],
```

with:

```tsx
  varieties: [nep],
  uplands: [],
  items: [farmItemFromRow({ id: "spray_hopper", kind: "pesticide", name: "Thuốc trừ rầy", price: 80, sort_order: 20, variety: null, fert: null, pest_target: "hopper", capacity: null })],
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 4.** Replace:

```tsx

/** Plot 5: my ripe nếp, drained, with brown planthoppers; plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean } = {}): FieldState => parseFieldState({
```

with:

```tsx

/** Plot 5: my ripe nếp, drained, with brown planthoppers (I have a sickle); plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean } = {}): FieldState => parseFieldState({
```

**tests/unit/use-farm-controller.test.tsx — edit 3 of 4.** Replace:

```tsx
  mine: {
    items: { spray_hopper: 1 }, rice: { nep: { wet: 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [],
```

with:

```tsx
  mine: {
    items: { spray_hopper: 1, tool_sickle: 1 }, rice: { nep: { wet: 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [],
```

**tests/unit/use-farm-controller.test.tsx — edit 4 of 4.** Replace:

```tsx
    await flush();
    expect(result.current.promptText(spot("plot_5"))).toBe("Gặt lúa thửa 5");
    expect(result.current.promptText(spot("plot_6"))).toBe("Xem thửa 6 (của Lan)");
```

with:

```tsx
    await flush();
    expect(result.current.promptText(spot("plot_5"))).toBe("Gặt bằng liềm thửa 5");
    expect(result.current.promptText(spot("plot_6"))).toBe("Xem thửa 6 (của Lan)");
```

**tests/unit/anticheat-pins.test.tsx — edit 1 of 7.** Replace:

```tsx
import { plotActions } from "@/lib/game/farm/actions";
import { DRYING_SLOTS, farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
```

with:

```tsx
import { plotActions } from "@/lib/game/farm/actions";
import { DRYING_SLOTS, farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 7.** Replace:

```tsx
import { getMap } from "@/lib/game/maps/registry";
```

with:

```tsx
import { getMap } from "@/lib/game/maps/registry";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/anticheat-pins.test.tsx — edit 3 of 7.** Replace:

```tsx

  it("the plot panel sends its plot's number, pumps or drains one level, and works only at transplanting and harvesting", () => {
    const mine: FarmMine = {
      items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1 }, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null,
    };
    const plots = [
```

with:

```tsx

  it("the plot panel sends its plot's number, pumps or drains one level, works only at transplanting and harvesting, and tends only with the config's acts", () => {
    const rows = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
    const beds: FarmCatalog = {
      ...FARM,
      uplands: rows.map(uplandFromRow),
      items: [...FARM.items, ...rows.map((r) => item(`seed_${r.id}`, "seed", r.name, 800, { upland: r.id }))],
    };
    const mine: FarmMine = {
      items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1, tool_sickle: 1, seed_khoai: 1, seed_bap: 1, seed_ot: 1 },
      rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null,
    };
    const upland = (id: string | null, over: Partial<CropView> = {}) =>
      crop({ kind: "upland", variety: null, upland: id, soakAt: null, plantAt: id === null ? null : at(0), ...over }, [[0, 1], [40, 1], [80, 1]]);
    const plots = [
```

**tests/unit/anticheat-pins.test.tsx — edit 4 of 7.** Replace:

```tsx
      plot(10, crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [55, 1]])),
    ];
```

with:

```tsx
      plot(10, crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [55, 1]])),
      plot(2, upland(null)),
      plot(3, upland("khoai")),
      plot(4, upland("bap")),
      plot(6, upland("ot", { sowAt: at(0), plantAt: null })),
      plot(7, upland("ot", { sowAt: at(0), plantAt: at(12) })),
    ];
```

**tests/unit/anticheat-pins.test.tsx — edit 5 of 7.** Replace:

```tsx
    const works = new Set<string>();
    for (const p of plots) {
      for (let h = 0; h <= 100; h++) {
        for (const a of plotActions(p, "me", nep, FARM, mine, at(h))) {
          const run = a.run;
```

with:

```tsx
    const works = new Set<string>();
    const rounds = new Set<number>();
    const acts = new Set<string>();
    for (const p of plots) {
      for (let h = 0; h <= 100; h++) {
        for (const a of plotActions(p, "me", nep, beds, mine, at(h))) {
          const run = a.run;
```

**tests/unit/anticheat-pins.test.tsx — edit 6 of 7.** Replace:

```tsx
          if (run.kind === "work") works.add(run.work);
        }
```

with:

```tsx
          if (run.kind === "work") works.add(run.work);
          if (run.kind === "round") rounds.add(run.plot);
          if (run.kind === "tend") acts.add(run.act);
        }
```

**tests/unit/anticheat-pins.test.tsx — edit 7 of 7.** Replace:

```tsx
    expect([...works].sort()).toEqual(["harvest", "transplant"]);
  });
```

with:

```tsx
    expect([...works].sort()).toEqual(["harvest", "transplant"]);
    expect([...rounds]).toEqual([10]);
    expect([...acts].sort()).toEqual(["lat_day", "vun_goc"]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-land.test.ts tests/unit/farm-plot-panel.test.tsx tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — 20 tests fail (`uplandOf is not a function`, `upFertAdvice is not a function`, `harvesterRefusal is not a function`, `varieties.find is not a function` where `dueTasks` now gets the catalog, no "Làm ruộng lúa" button, "Gặt lúa thửa 5" instead of "Gặt bằng liềm thửa 5"); 42 pass.

- [ ] **Step 3: Implement**

**lib/game/farm/actions.ts — edit 1 of 16.** Replace:

```ts
import { WATER_LOG_MAX, WATER_PER_HOUR, type FarmCatalog, type FarmItemKind, type Variety } from "./catalog";
import {
```

with:

```ts
import {
  HARVEST_PARTS, TEND_MAX, TOOL_SICKLE, WATER_LOG_MAX, WATER_PER_HOUR, type FarmCatalog, type FarmItem, type FarmItemKind, type UplandCare,
  type UplandCrop, type Variety,
} from "./catalog";
import {
```

**lib/game/farm/actions.ts — edit 2 of 16.** Replace:

```ts
} from "./crop";
import { durationText, NO_SEED, PEST_NAME, PEST_REMEDY, TOO_FAST, WATER_NAME } from "./messages";
import type { FieldAction } from "./rpc";
import type { FarmMine, PlotView } from "./state";

// What can be done on a plot right now (the plot panel's buttons) and what is due on my plots (the HUD task list,
// spec §13.1–13.2). Pure.

/** A button's job: an RPC, or a 2-second work action (begin_work, then transplant / harvest). */
export type PlotRun = FieldAction | { kind: "work"; plot: number; work: "transplant" | "harvest" };
```

with:

```ts
} from "./crop";
import {
  BED_WATER_NAME, bedLevelsText, durationText, NO_SEED, PEST_NAME, PEST_REMEDY, TOO_FAST, WATER_NAME,
} from "./messages";
import type { FieldAction } from "./rpc";
import type { CropView, FarmMine, PlotView } from "./state";
import {
  nurseryOldAt, nurseryReadyAt, rotFromAt, upCare, uplandModel, upLostAt, upNext, upOverAt, upReadyAt, upWantedWater, type UplandModel,
} from "./upland";

// What can be done on a plot right now (the plot panel's buttons) and what is due on my plots (the HUD task list,
// spec §13.1–13.2; v15.2 §13.1, §13.3). Pure.

/** A button's job: an RPC, a 3-second action behind the 2 s gate (begin_work, then transplant / harvest), or a rice
 *  harvest round (HarvestGame, v15.2 §6.2). */
export type PlotRun = FieldAction | { kind: "work"; plot: number; work: "transplant" | "harvest" } | { kind: "round"; plot: number };
```

**lib/game/farm/actions.ts — edit 3 of 16.** Replace:

```ts
export const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
```

with:

```ts
export const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** The hoa-màu crop on a plot's beds, if any. */
export const uplandOf = (crop: CropView | null, catalog: FarmCatalog): UplandCrop | null =>
  crop?.kind === "upland" ? catalog.uplands.find((u) => u.id === crop.upland) ?? null : null;

/** A running harvester on the plot (until the state after its end arrives). */
export const harvesterOn = (crop: CropView | null): boolean => !!crop?.harvester;
```

**lib/game/farm/actions.ts — edit 4 of 16.** Replace:

```ts

/** The buttons of the plot panel for `me` (spec §13.2). Anyone may pick snails; the rest is for the plot's farmer. */
export function plotActions(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): PlotAction[] {
```

with:

```ts

/** Would this fertilizer help a crop on beds now (v15.2 §13.1)? `name` is the item's name; `u` is null on beds with
 *  nothing planted. */
export function upFertAdvice(c: UplandModel, u: UplandCrop | null, item: string, name: string, now: number): { ok: boolean; text: string } {
  const base = item === "fert_manure" || item === "fert_phosphate";
  if (c.plantAt === null || now < c.plantAt) {
    if (!base) return { ok: false, text: "Chưa trồng — bón thúc bây giờ là phí." };
    return c.fert.some((e) => e.item === item && (c.plantAt === null || e.t < c.plantAt))
      ? { ok: false, text: "Đã bón lót loại này — bón thêm là phí." }
      : { ok: true, text: "Bón lót trước khi trồng." };
  }
  if (base) return { ok: false, text: "Đã trồng — bón lót bây giờ là phí." };
  if (!u) return { ok: false, text: "Lúc này bón là phí." };
  const P = c.plantAt;
  const T = (now - P) / HOUR_MS;
  const takes = (cr: UplandCare, x: string) => cr.items.includes(x) || cr.halfItems.includes(x);
  const region = (h: number, x: string) => u.cares.find((cr) => cr.kind === "fert" && h >= cr.halfFromH && h < cr.halfToH && takes(cr, x));
  const care = region(T, item);
  if (isN(item)) {
    if (!care) return { ok: false, text: "Bón đạm lúc này gây dư đạm!" };
    if (c.fert.some((e) => e.t >= P && e.t <= now && isN(e.item) && region((e.t - P) / HOUR_MS, e.item)?.id === care.id)) {
      return { ok: false, text: "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" };
    }
  }
  if (!care || upCare(c, u).scores[u.cares.indexOf(care)] === 0) return { ok: false, text: "Lúc này bón là phí." };
  if (!care.items.includes(item)) return { ok: false, text: `${name} lúc này chỉ được nửa công.` };
  if (T < care.fromH) return { ok: false, text: `Hơi sớm — chỉ được nửa công (đúng lúc sau ${durationText((care.fromH - T) * HOUR_MS)}).` };
  if (T <= care.toH) return { ok: true, text: `Đúng lúc ${lower(care.name)}.` };
  return { ok: false, text: "Trễ rồi — chỉ được nửa công." };
}

/** A hand job on beds now (§13.1): done on time already (the button waits), on time (a hint), or a warning. */
export function tendAdvice(c: UplandModel, care: UplandCare, now: number): { done: boolean; ok: boolean; text: string } {
  const job = lower(care.name);
  const P = c.plantAt ?? now;
  const onTime = (t: number) => (t - P) / HOUR_MS >= care.fromH && (t - P) / HOUR_MS <= care.toH;
  if (c.work.some((e) => e.act === care.id && onTime(e.t))) return { done: true, ok: false, text: `Đã ${job} rồi.` };
  const T = (now - P) / HOUR_MS;
  if (T < care.fromH) return { done: false, ok: false, text: `Chưa tới lúc — ${job} lúc ${Math.ceil(care.fromH)}–${Math.floor(care.toH)} giờ sau trồng.` };
  if (T <= care.toH) return { done: false, ok: true, text: `Đúng lúc ${job}.` };
  if (T < care.halfToH) return { done: false, ok: false, text: "Trễ rồi — chỉ được nửa công." };
  return { done: false, ok: false, text: "Quá muộn — làm bây giờ là phí công." };
}

/** The water buttons (§8.3, §13.1): one level up or down; the server refuses past 60 log entries or 6 in the last hour. */
function waterButtons(p: PlotView, crop: CropView, w: number, beds: boolean, now: number, rotWarn?: string): PlotAction[] {
  const plot = p.no, names = beds ? BED_WATER_NAME : WATER_NAME;
  const log = crop.log?.water ?? [];
  const tooFast = log.length >= WATER_LOG_MAX || log.filter((e) => e.t > now - HOUR_MS).length >= WATER_PER_HOUR;
  const up = beds ? (w >= 3 ? "Tưới thêm (giữ Ngập)" : `Tưới nước (lên ${names[w + 1]})`) : (w >= 3 ? "Bơm thêm nước (giữ Sâu)" : `Bơm nước (lên ${names[w + 1]})`);
  return [
    {
      key: "water_up", label: up, run: { kind: "water", plot, delta: 1 }, enabled: !tooFast, why: tooFast ? TOO_FAST : undefined,
      ...(rotWarn && !tooFast ? { warn: rotWarn } : {}),
    },
    {
      key: "water_down", label: w === 0 ? "Tháo nước" : `Tháo nước (xuống ${names[w - 1]})`, run: { kind: "water", plot, delta: -1 },
      enabled: !tooFast && w > 0, why: tooFast ? TOO_FAST : w === 0 ? (beds ? "Luống đã khô." : "Ruộng đã khô.") : undefined,
    },
  ];
}

/** The spray buttons (§8.5, v15.2 §7): the bottles I hold and the tank's pesticide; a matching tank is used first. */
function sprayButtons(p: PlotView, crop: CropView, catalog: FarmCatalog, mine: FarmMine): PlotAction[] {
  const tank = mine.tank;
  return catalog.items
    .filter((i) => i.kind === "pesticide" && ((mine.items[i.id] ?? 0) > 0 || (tank?.item === i.id && tank.charges > 0)))
    .map((s) => {
      const fromTank = tank?.item === s.id && tank.charges > 0;
      const target = crop.pests.find((x) => x.treatedAt === null && PEST_REMEDY[x.kind] === s.id);
      return {
        key: `spray:${s.id}`, label: `Xịt ${lower(s.name)}${fromTank ? " (bình phun)" : ""}`, run: { kind: "spray", plot: p.no, item: s.id },
        enabled: true,
        ...(target
          ? { hint: `Trị ${lower(PEST_NAME[target.kind])}.${fromTank ? ` Bình còn ${tank!.charges} lần.` : ""}` }
          : { warn: "Không có sâu bệnh nào trị bằng thuốc này — xịt là phí." }),
      };
    });
}

/** The rice seeds I hold (a hoa-màu seed is planted on beds, not soaked). */
const riceSeeds = (catalog: FarmCatalog, mine: FarmMine): FarmItem[] =>
  catalog.items.filter((i) => i.kind === "seed" && i.upland === null && (mine.items[i.id] ?? 0) > 0);

/** The buttons of the plot panel for `me` (spec §13.2, v15.2 §13.1). Anyone may pick snails; the rest is for the plot's
 *  farmer. A running harvester takes every action (R32); a partly cut plot takes only the next round and Bỏ vụ (R8). */
export function plotActions(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): PlotAction[] {
```

**lib/game/farm/actions.ts — edit 5 of 16.** Replace:

```ts
  const plot = p.no;
  if (crop?.pests.some((x) => x.kind === "snail" && x.treatedAt === null)) {
    out.push({ key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot }, enabled: true });
```

with:

```ts
  const plot = p.no;
  if (harvesterOn(crop)) return out;
  const cut = crop?.kind === "rice" && crop.parts > 0;
  if (!cut && crop?.pests.some((x) => x.kind === "snail" && x.treatedAt === null)) {
    out.push({ key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot }, enabled: true });
```

**lib/game/farm/actions.ts — edit 6 of 16.** Replace:

```ts
  const soaks = (): PlotAction[] => {
    const seeds = owned("seed");
    if (seeds.length === 0) return [{ key: "soak", label: "Ngâm giống", run: { kind: "soak", plot, item: "" }, enabled: false, why: NO_SEED }];
```

with:

```ts
  const soaks = (): PlotAction[] => {
    const seeds = riceSeeds(catalog, mine);
    if (seeds.length === 0) return [{ key: "soak", label: "Ngâm giống", run: { kind: "soak", plot, item: "" }, enabled: false, why: NO_SEED }];
```

**lib/game/farm/actions.ts — edit 7 of 16.** Replace:

```ts
  };
  const prepare: PlotAction = { key: "prepare", label: "Làm đất", run: { kind: "prepare", plot }, enabled: true, hint: "Cày bừa, cho nước vào ngập ruộng." };
  if (!crop) return [...out, prepare, ...soaks()];
```

with:

```ts
  };
  const prepare: PlotAction = {
    key: "prepare", label: "Làm ruộng lúa", run: { kind: "prepare", plot }, enabled: true, hint: "Cày bừa, cho nước ngập ruộng — để cấy lúa.",
  };
  if (!crop) {
    const beds: PlotAction = {
      key: "prepare_beds", label: "Lên luống trồng màu", run: { kind: "prepare_beds", plot }, enabled: true,
      hint: "Đắp luống cao, đất Ẩm — trồng khoai, bắp, ớt.",
    };
    return [...out, prepare, beds, ...soaks()];
  }
  if (crop.kind === "upland") return [...out, ...bedActions(p, crop, catalog, mine, now)];
```

**lib/game/farm/actions.ts — edit 8 of 16.** Replace:

```ts
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  if (crop.preparedAt === null) out.push(prepare);
```

with:

```ts
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  const round = (): PlotAction => {
    const label = crop.parts > 0 ? `Gặt tiếp (phần ${crop.parts + 1}/${HARVEST_PARTS})` : "Gặt bằng liềm";
    const why = ph === "ripening" && v ? `Lúa chưa chín — gặt được sau ${durationText(ripeAt(c, v)! - now)}.`
      : w > 1 ? `Rút nước trước khi gặt (đang ${WATER_NAME[w]}).`
      : (mine.items[TOOL_SICKLE] ?? 0) < 1 ? "Chưa có liềm — mua ở tiệm anh Hai." : undefined;
    return { key: "round", label, run: { kind: "round", plot }, enabled: !why, why, ...(why ? {} : { hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần." }) };
  };
  if (cut) {
    return [...out, round(), {
      key: "abandon", label: "Bỏ vụ", run: { kind: "abandon", plot }, enabled: true, warn: "Bỏ vụ là mất phần lúa chưa gặt.",
    }];
  }
  if (crop.preparedAt === null) out.push(prepare);
```

**lib/game/farm/actions.ts — edit 9 of 16.** Replace:

```ts
    out.push({ key: "transplant", label: "Cấy lúa", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else if (ph === "ripening" && v) {
    out.push({ key: "harvest", label: "Gặt lúa", run: { kind: "work", plot, work: "harvest" }, enabled: false, why: `Lúa chưa chín — gặt được sau ${durationText(ripeAt(c, v)! - now)}.` });
  } else if (ph === "ripe" || ph === "overripe") {
    const why = w > 1 ? `Rút nước trước khi gặt (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "harvest", label: "Gặt lúa", run: { kind: "work", plot, work: "harvest" }, enabled: !why, why });
  }
  if (crop.preparedAt !== null) {
    // the server refuses a water change past 60 log entries, or past 6 in the last hour
    const log = crop.log?.water ?? [];
    const tooFast = log.length >= WATER_LOG_MAX || log.filter((e) => e.t > now - HOUR_MS).length >= WATER_PER_HOUR;
    out.push({
      key: "water_up", label: w >= 3 ? "Bơm thêm nước (giữ Sâu)" : `Bơm nước (lên ${WATER_NAME[w + 1]})`, run: { kind: "water", plot, delta: 1 },
      enabled: !tooFast, why: tooFast ? TOO_FAST : undefined,
    });
    out.push({
      key: "water_down", label: w === 0 ? "Tháo nước" : `Tháo nước (xuống ${WATER_NAME[w - 1]})`, run: { kind: "water", plot, delta: -1 },
      enabled: !tooFast && w > 0, why: tooFast ? TOO_FAST : w === 0 ? "Ruộng đã khô." : undefined,
    });
    for (const f of owned("fertilizer")) {
```

with:

```ts
    out.push({ key: "transplant", label: "Cấy lúa", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else if ((ph === "ripening" && v) || ph === "ripe" || ph === "overripe") {
    out.push(round());
  }
  if (crop.preparedAt !== null) {
    out.push(...waterButtons(p, crop, w, false, now));
    for (const f of owned("fertilizer")) {
```

**lib/game/farm/actions.ts — edit 10 of 16.** Replace:

```ts
    }
    for (const s of owned("pesticide")) {
      const target = crop.pests.find((x) => x.treatedAt === null && PEST_REMEDY[x.kind] === s.id);
      out.push({
        key: `spray:${s.id}`, label: `Xịt ${lower(s.name)}`, run: { kind: "spray", plot, item: s.id }, enabled: true,
        ...(target ? { hint: `Trị ${lower(PEST_NAME[target.kind])}.` } : { warn: "Không có sâu bệnh nào trị bằng thuốc này — xịt là phí." }),
      });
    }
  }
```

with:

```ts
    }
    out.push(...sprayButtons(p, crop, catalog, mine));
  }
```

**lib/game/farm/actions.ts — edit 11 of 16.** Replace:

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
```

with:

```ts

/** The buttons on my beds (§8.9, §13.1): plant, transplant the ớt, the hand jobs, water, fertilizer, sprays, the picking. */
function bedActions(p: PlotView, crop: CropView, catalog: FarmCatalog, mine: FarmMine, now: number): PlotAction[] {
  const out: PlotAction[] = [];
  const plot = p.no;
  const u = uplandOf(crop, catalog);
  const c = uplandModel(crop);
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  const moist = w === 1 ? undefined : `Cần đất Ẩm (đang ${BED_WATER_NAME[w]}).`;
  if (!u) {
    const seeds = catalog.items.filter((i) => i.kind === "seed" && i.upland !== null && (mine.items[i.id] ?? 0) > 0
      && catalog.uplands.some((x) => x.id === i.upland));
    if (seeds.length === 0) {
      out.push({ key: "plant", label: "Trồng hoa màu", run: { kind: "plant", plot, item: "" }, enabled: false, why: "Chưa có giống hoa màu — ghé tiệm anh Hai." });
    }
    for (const s of seeds) {
      const x = catalog.uplands.find((y) => y.id === s.upland)!;
      out.push({ key: `plant:${s.id}`, label: x.plantLabel, run: { kind: "plant", plot, item: s.id }, enabled: !moist, why: moist });
    }
  } else if (c.plantAt === null) {
    const ready = nurseryReadyAt(c, u);
    const why = ready !== null && now < ready ? `Cây con chưa đủ tuổi — trồng được sau ${durationText(ready - now)}.` : moist;
    out.push({ key: "set_out", label: u.transplantLabel ?? "Trồng cây con", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else {
    for (const care of u.cares.filter((x) => x.kind === "act")) {
      const a = tendAdvice(c, care, now);
      const full = c.work.length >= TEND_MAX;
      out.push({
        key: `tend:${care.id}`, label: care.name, run: { kind: "tend", plot, act: care.id }, enabled: !a.done && !full,
        ...(a.done ? { why: a.text } : full ? { why: TOO_FAST } : a.ok ? { hint: a.text } : { warn: a.text }),
      });
    }
  }
  const rotFrom = u ? rotFromAt(c, u) : null;
  const rotWarn = u && rotFrom !== null && now >= rotFrom && w + 1 >= 2 ? `Đất ${BED_WATER_NAME[Math.min(3, w + 1)]} làm thối củ ${lower(u.name)}!` : undefined;
  out.push(...waterButtons(p, crop, w, true, now, rotWarn));
  for (const f of catalog.items.filter((i) => i.kind === "fertilizer" && (mine.items[i.id] ?? 0) > 0)) {
    const a = upFertAdvice(c, u, f.id, f.name, now);
    out.push({ key: `fert:${f.id}`, label: `Bón ${lower(f.name)}`, run: { kind: "fertilize", plot, item: f.id }, enabled: true, ...(a.ok ? { hint: a.text } : { warn: a.text }) });
  }
  out.push(...sprayButtons(p, crop, catalog, mine));
  if (u && c.plantAt !== null) {
    const k = upNext(c, u, now), n = u.pickings.length;
    if (k > 0) {
      const ready = upReadyAt(c, u, k)!;
      const job = lower(u.harvestLabel);
      const why = now < ready ? `Chưa chín — ${job} được sau ${durationText(ready - now)}.`
        : w > 1 ? `Tháo bớt nước trước khi ${job} (đang ${BED_WATER_NAME[w]}).` : undefined;
      out.push({
        key: "picking", label: `${u.harvestLabel}${n > 1 ? ` (lứa ${k}/${n})` : ""}`, run: { kind: "work", plot, work: "harvest" },
        enabled: !why, why,
      });
    }
  }
  out.push({ key: "abandon", label: "Bỏ vụ", run: { kind: "abandon", plot }, enabled: true, warn: "Bỏ vụ là mất hết hoa màu trên thửa này." });
  return out;
}

/** The jobs a plot's prompt can name, by action key (before the ":"); the v15.2 jobs are named by their button. */
const PROMPT_JOB: Record<string, string | null> = {
  pick: "Bắt ốc", prepare: "Làm đất", prepare_beds: "Làm đất", soak: "Ngâm giống", sow: "Gieo mạ", transplant: "Cấy lúa",
  round: null, plant: null, set_out: null, picking: null,
};

/** A plot's HUD prompt (spec §13.2, v15.2 §13.6): my next job there ("Gieo mạ thửa 3", "Gặt tiếp thửa 3", "Hái ớt thửa 6"),
 *  else whose plot it is ("Xem thửa 5 (của Lan)"). */
export function plotPrompt(p: PlotView, me: string, v: Variety | null, catalog: FarmCatalog, mine: FarmMine, now: number): string {
  if (p.farmer?.id === me) {
    const job = plotActions(p, me, v, catalog, mine, now).map((a) => {
      const key = a.key.split(":")[0];
      if (!a.enabled || !(key in PROMPT_JOB)) return undefined;
      return PROMPT_JOB[key] ?? a.label.replace(/ \(.*\)$/, "");
    }).find(Boolean);
    return job ? `${job} thửa ${p.no}` : `Xem thửa ${p.no}`;
```

**lib/game/farm/actions.ts — edit 12 of 16.** Replace:

```ts

/** What is due on the plots I farm (spec §13.1): urgent tasks first, then by plot. */
export function dueTasks(plots: readonly PlotView[], me: string, varieties: readonly Variety[], now: number): FarmTask[] {
  const out: FarmTask[] = [];
```

with:

```ts

/** What is due on the plots I farm (spec §13.1, v15.2 §13.3): urgent tasks first, then by plot. */
export function dueTasks(plots: readonly PlotView[], me: string, catalog: FarmCatalog, mine: FarmMine, now: number): FarmTask[] {
  const out: FarmTask[] = [];
```

**lib/game/farm/actions.ts — edit 13 of 16.** Replace:

```ts
    if (!crop) {
      add("Làm đất, ngâm giống", false);
      continue;
    }
    const v = varieties.find((x) => x.id === crop.variety) ?? null;
    const c = cropModel(crop);
```

with:

```ts
    if (!crop) {
      add("Làm đất (ruộng lúa hoặc lên luống)", false);
      continue;
    }
    if (crop.harvester) {
      add(`Máy gặt đang gặt — còn ${Math.max(0, Math.ceil((crop.harvester.endsAt - now) / 1000))} giây`, false);
      continue;
    }
    if (crop.kind === "upland") {
      bedTasks(crop, catalog, now, add);
      continue;
    }
    const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
    const c = cropModel(crop);
```

**lib/game/farm/actions.ts — edit 14 of 16.** Replace:

```ts
    const w = crop.log ? waterAt(c.water, now) : crop.water;
    if (crop.preparedAt === null) add("Làm đất", false);
```

with:

```ts
    const w = crop.log ? waterAt(c.water, now) : crop.water;
    if (crop.parts > 0) {
      add(`Gặt tiếp — đã gặt ${crop.parts}/${HARVEST_PARTS} phần`, ph === "overripe");
      continue;
    }
    if (crop.preparedAt === null) add("Làm đất", false);
```

**lib/game/farm/actions.ts — edit 15 of 16.** Replace:

```ts
    }
    const want = crop.log ? wantedWater(c, v, now) : null;
```

with:

```ts
    }
    if (["heading", "ripening", "ripe", "overripe"].includes(ph) && (mine.items[TOOL_SICKLE] ?? 0) < 1) {
      add("Chưa có liềm — mua ở tiệm anh Hai hoặc thuê máy gặt", ph === "ripe" || ph === "overripe");
    }
    const want = crop.log ? wantedWater(c, v, now) : null;
```

**lib/game/farm/actions.ts — edit 16 of 16.** Replace:

```ts
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

with:

```ts
    }
    pestTasks(crop, add);
  }
  return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || a.plot - b.plot);
}

function pestTasks(crop: CropView, add: (text: string, urgent: boolean) => void): void {
  for (const x of crop.pests) {
    if (x.treatedAt !== null) continue;
    const remedy = PEST_REMEDY[x.kind];
    add(`${PEST_NAME[x.kind]}! ${remedy ? `Xịt ${REMEDY_LABEL[remedy]}` : "Bắt ốc hoặc tháo cạn nước"}`, true);
  }
}

/** What is due on my beds (§13.3). */
function bedTasks(crop: CropView, catalog: FarmCatalog, now: number, add: (text: string, urgent: boolean) => void): void {
  const u = uplandOf(crop, catalog);
  const c = uplandModel(crop);
  if (!u) {
    add("Trồng hoa màu", false);
    return;
  }
  if (c.plantAt === null) {
    const care = upCare(c, u);
    if (!care.manure || !care.phosphate) add("Bón lót (phân chuồng, phân lân)", false);
    const ready = nurseryReadyAt(c, u), old = nurseryOldAt(c, u);
    if (ready !== null && now < ready) add(`Cây ớt con đang lớn — trồng được sau ${durationText(ready - now)}`, false);
    else add(u.transplantLabel ?? "Trồng cây con", old !== null && now >= old);
  } else {
    const T = (now - c.plantAt) / HOUR_MS;
    const scores = upCare(c, u).scores;
    u.cares.forEach((care, i) => {
      if (scores[i] !== 0 && T >= care.fromH && T <= care.toH) add(`${care.name} — còn ${durationText((care.toH - T) * HOUR_MS)}`, true);
    });
    const k = upNext(c, u, now);
    if (k > 0) {
      const ready = upReadyAt(c, u, k)!, over = upOverAt(c, u, k)!, lost = upLostAt(c, u, k)!;
      const job = u.harvestLabel;
      if (now >= over && now < lost) add(`${job} ngay — đang hư!`, true);
      else if (now >= ready) add(`${job} — còn ${durationText(over - now)}`, over - now <= 3 * HOUR_MS);
      else if (k > 1) add(`${job} lứa ${k} — chín sau ${durationText(ready - now)}`, false);
    }
  }
  const w = crop.log ? waterAt(c.water, now) : crop.water;
  const want = crop.log ? upWantedWater(c, u, now) : null;
  const rotFrom = rotFromAt(c, u);
  if (rotFrom !== null && now >= rotFrom && w >= 2) add(`Tháo nước ngay — ${lower(u.name)} đang thối củ!`, true);
  else if (want && !want.includes(w)) {
    add(`${w < Math.min(...want) ? "Tưới nước" : "Tháo nước"} (đang ${BED_WATER_NAME[w]}, cần ${bedLevelsText(want)})`, true);
  }
  pestTasks(crop, add);
}
```

**lib/game/farm/land.ts — edit 1 of 2.** Replace:

```ts
import { FARM_LIMIT, PLOT_PRICE, RENT_PRICE, SALE_MAX, SUBLEASE_MAX } from "./catalog";
import { farmErrorMessage } from "./messages";
```

with:

```ts
import {
  FARM_LIMIT, HARVEST_PARTS, HARVESTER_MS, harvesterPrice, PLOT_PRICE, RENT_PRICE, SALE_MAX, SUBLEASE_MAX, type Variety,
} from "./catalog";
import { cropModel, cropPhase, waterAt } from "./crop";
import { farmErrorMessage } from "./messages";
```

**lib/game/farm/land.ts — edit 2 of 2.** Replace:

```ts

/** Accepting an offer: the buyer is checked by the server. */
```

with:

```ts

/** Renting the co-op's harvester for a rice plot I farm (v15.2 §6.3): the server's checks in their order — the farmer,
 *  a crop, no running job, rice, ripe or overripe with parts left, drained, 30 s left on a lease, and 500 xu per part
 *  left. */
export function harvesterRefusal(p: PlotView, ctx: LandCtx, v: Variety | null, now: number): string | null {
  if (!isFarmer(p, ctx.me)) return "not your plot";
  const crop = p.crop;
  if (!crop) return "not prepared";
  if (crop.harvester) return "harvester busy";
  if (crop.kind !== "rice") return "wrong crop";
  const c = cropModel(crop);
  const ph = cropPhase(c, v, now);
  if (crop.parts >= HARVEST_PARTS || (ph !== "ripe" && ph !== "overripe")) return "wrong phase";
  if ((crop.log ? waterAt(c.water, now) : crop.water) > 1) return "need water";
  if (p.lease && p.lease.until < now + HARVESTER_MS) return "lease ends";
  if (ctx.mine.coins < harvesterPrice(crop.parts)) return "not enough coins";
  return null;
}

/** Accepting an offer: the buyer is checked by the server. */
```

**hooks/useFarmController.ts — edit 1 of 2.** Replace:

```ts
  // --- due tasks, and the plots on the canvas with my urgent rings
  const tasks = useMemo(() => (state && catalog ? dueTasks(state.plots, accountId, catalog.varieties, now) : []), [state, catalog, accountId, now]);
  useEffect(() => {
```

with:

```ts
  // --- due tasks, and the plots on the canvas with my urgent rings
  const tasks = useMemo(() => (state && catalog ? dueTasks(state.plots, accountId, catalog, state.mine, now) : []), [state, catalog, accountId, now]);
  useEffect(() => {
```

**hooks/useFarmController.ts — edit 2 of 2.** Replace:

```ts
    if (a.kind === "work") return startWork(a.plot, a.work);
    setBusy(true);
```

with:

```ts
    if (a.kind === "work") return startWork(a.plot, a.work);
    // a harvest round (v15.2 §6.2) has its own overlay and flow (Tasks 13 and 14)
    if (a.kind === "round") return false;
    setBusy(true);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (5 files, 62 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint hooks/useFarmController.ts lib/game/farm/actions.ts lib/game/farm/land.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-land.test.ts tests/unit/farm-plot-panel.test.tsx tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the plot's actions and tasks — rounds, beds, the tank, the harvester's refusals

lib/game/farm/actions.ts: a bare plot offers Làm ruộng lúa or Lên luống trồng màu; ripe rice is cut a round at a time
with a sickle ("Gặt bằng liềm", then "Gặt tiếp (phần n/6)"), a partly cut plot keeps only the next round and Bỏ vụ, and a
running harvester takes every button; beds plant, set out the ớt, tend by the config's acts, water with the rot warning,
fertilize by upFertAdvice, spray from the tank first and pick "(lứa k/n)"; dueTasks follows the parts, the harvester, the
missing sickle and the beds. lib/game/farm/land.ts: harvesterRefusal mirrors rent_harvester's checks in their order.
The controller passes the catalog and my stock to dueTasks and leaves a round to its overlay (Tasks 13 and 14).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add hooks/useFarmController.ts lib/game/farm/actions.ts lib/game/farm/land.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-land.test.ts tests/unit/farm-plot-panel.test.tsx tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 10: The HarvestGame round — a seeded state machine for the sickle

**Files:**
- Create: `lib/game/farm/minigames.ts`
- Test: `tests/unit/farm-minigames.test.ts` (create)

**Interfaces:**
- Consumes: v14's `nextRandom(seed)` (`lib/game/fishing/reel.ts`, a seeded generator), so a test replays a round exactly.
- Produces (pure, R17, §6.2):
  - `HARVEST = { bundles: 8, fillMs: 1200, band: 0.14, centreMin: 0.62, centreMax: 0.78, exact: 0.07, near: 0.17, beatMs: 350, pass: 4, maxDt: 0.05 }`;
  - `HarvestMark = "chuan" | "duoc" | "sot" | "rung"`, `HARVEST_MARK` (the marks' Vietnamese: "Chuẩn!", "Được", "Lệch — sót hạt", "Lệch — rụng hạt"), `HarvestCut { level, centre, mark, score }`;
  - `HarvestRound { centres, bundle, chargeMs, level, charging, armed, beatMs, cuts, score, elapsedMs, outcome }`;
  - `scoreRelease(level, centre) → { mark, score }` (chuẩn 1 within 0.07 of the centre, được 0.5 within 0.17, else lệch: sót hạt below, rụng hạt above; a 1e-9 tolerance at the edges); `scoreText(n)` ("3,5");
  - `createHarvestRound(seed)` (8 centres in [0.62, 0.78]); `stepHarvestRound(s, dtSec, holding)`: holding fills the bar in 1.2 s and it auto-releases at 1 (rụng hạt); a release scores the cut; a 0.35 s beat follows each cut; after an auto-release the sickle waits to be let go; the outcome (`"pass"` at 4 points or more, else `"fail"`) comes after the last cut's beat; `dtSec` is clamped to 0.05.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/farm-minigames.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import {
  createHarvestRound, HARVEST, HARVEST_MARK, scoreRelease, scoreText, stepHarvestRound, type HarvestRound,
} from "@/lib/game/farm/minigames";

/** Plays a round at `dt` seconds a frame: holds until the bar reaches `aim(centre, bundle)`, lets go, and presses again
 *  once the cut beat is over. */
function play(seed: number, aim: (c: number, i: number) => number, dt = 1 / 60): HarvestRound {
  let s = createHarvestRound(seed);
  for (let f = 0; f < 60 * 120 && !s.outcome; f++) {
    const holding = s.beatMs > 0 ? false : !(s.charging && s.level >= aim(s.centres[s.bundle], s.bundle));
    s = stepHarvestRound(s, dt, holding);
  }
  return s;
}

describe("createHarvestRound", () => {
  it("seeds 8 sweet bands centred in [0.62, 0.78]", () => {
    const s = createHarvestRound(7);
    expect(s).toMatchObject({ bundle: 0, level: 0, charging: false, beatMs: 0, cuts: [], score: 0, elapsedMs: 0, outcome: null });
    expect(s.centres).toHaveLength(HARVEST.bundles);
    for (const c of s.centres) {
      expect(c).toBeGreaterThanOrEqual(0.62);
      expect(c).toBeLessThanOrEqual(0.78);
    }
    expect(createHarvestRound(7)).toEqual(s);
    expect(createHarvestRound(8).centres).not.toEqual(s.centres);
  });
});

describe("scoreRelease", () => {
  it("scores chuẩn within 0.07 of the centre, được within 0.17, and says which way a miss went", () => {
    expect(scoreRelease(0.7, 0.7)).toEqual({ mark: "chuan", score: 1 });
    expect(scoreRelease(0.77, 0.7)).toEqual({ mark: "chuan", score: 1 });
    expect(scoreRelease(0.63, 0.7)).toEqual({ mark: "chuan", score: 1 });
    expect(scoreRelease(0.78, 0.7)).toEqual({ mark: "duoc", score: 0.5 });
    expect(scoreRelease(0.87, 0.7)).toEqual({ mark: "duoc", score: 0.5 });
    expect(scoreRelease(0.53, 0.7)).toEqual({ mark: "duoc", score: 0.5 });
    expect(scoreRelease(0.52, 0.7)).toEqual({ mark: "sot", score: 0 });
    expect(scoreRelease(0.88, 0.7)).toEqual({ mark: "rung", score: 0 });
    expect(scoreRelease(1, 0.78)).toEqual({ mark: "rung", score: 0 });
    expect(HARVEST_MARK).toEqual({ chuan: "Chuẩn!", duoc: "Được", sot: "Lệch — sót hạt", rung: "Lệch — rụng hạt" });
  });
});

describe("stepHarvestRound", () => {
  it("raises the bar from 0 to 1 in 1.2 s while held, and auto-releases it at 1 as rụng hạt", () => {
    let s = createHarvestRound(1);
    s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ charging: true, level: 0 });
    for (let i = 0; i < 12; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s.level).toBeCloseTo(0.5, 9);
    for (let i = 0; i < 12; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ bundle: 1, level: 0, charging: false, beatMs: HARVEST.beatMs, score: 0 });
    expect(s.cuts).toEqual([{ level: 1, centre: s.centres[0], mark: "rung", score: 0 }]);
    // still held after the beat: nothing happens until the sickle is let go and pressed again
    for (let i = 0; i < 40; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ bundle: 1, charging: false, level: 0, beatMs: 0 });
    s = stepHarvestRound(stepHarvestRound(s, 0.05, false), 0.05, true);
    expect(s.charging).toBe(true);
  });

  it("ignores input for 0.35 s after a cut, and starts the next charge once the beat is over", () => {
    let s = createHarvestRound(2);
    s = stepHarvestRound(s, 0.05, true);
    for (let i = 0; i < 10; i++) s = stepHarvestRound(s, 0.05, true);
    s = stepHarvestRound(s, 0.05, false);
    expect(s.cuts).toHaveLength(1);
    expect(s.cuts[0].level).toBeCloseTo(10 * 0.05 / 1.2, 9);
    for (let i = 0; i < 6; i++) s = stepHarvestRound(s, 0.05, true);
    expect(s).toMatchObject({ charging: false, level: 0 });
    expect(s.beatMs).toBeCloseTo(50, 6);
    s = stepHarvestRound(s, 0.05, true);
    expect(s.beatMs).toBe(0);
    s = stepHarvestRound(s, 0.05, true);
    expect(s.charging).toBe(true);
  });

  it("clamps a long frame to 50 ms and ignores a negative one", () => {
    let s = stepHarvestRound(createHarvestRound(3), 0.05, true);
    s = stepHarvestRound(s, 2, true);
    expect(s.level).toBeCloseTo(0.05 / 1.2, 9);
    expect(s.elapsedMs).toBeCloseTo(100, 6);
    expect(stepHarvestRound(s, -1, true).level).toBeCloseTo(s.level, 9);
  });

  it("passes a clean round with 8 points in about 10 s, at 60 and at 20 frames a second", () => {
    for (const dt of [1 / 60, 0.05]) {
      for (let seed = 1; seed <= 20; seed++) {
        const s = play(seed, (c) => c, dt);
        expect(s.outcome).toBe("pass");
        expect(s.score).toBe(8);
        expect(s.cuts.map((x) => x.mark)).toEqual(Array(8).fill("chuan"));
        expect(s.elapsedMs).toBeGreaterThan(8_000);
        expect(s.elapsedMs).toBeLessThan(12_000);
      }
    }
  });

  it("needs 4 points of 8: 3.5 fails, 4 passes", () => {
    const four = play(5, (c, i) => (i < 4 ? c : 0.2));
    expect([four.score, four.outcome]).toEqual([4, "pass"]);
    const threeAndHalf = play(5, (c, i) => (i < 3 ? c : i === 3 ? c + 0.12 : 0.2));
    expect(threeAndHalf.cuts.map((x) => x.mark)).toEqual(["chuan", "chuan", "chuan", "duoc", "sot", "sot", "sot", "sot"]);
    expect([threeAndHalf.score, threeAndHalf.outcome]).toEqual([3.5, "fail"]);
    const late = play(6, () => 1);
    expect(late.cuts.every((x) => x.mark === "rung")).toBe(true);
    expect(late.outcome).toBe("fail");
  });

  it("ends after the last cut's beat, and then stays put", () => {
    let s = createHarvestRound(9);
    let beforeEnd: HarvestRound | null = null;
    for (let f = 0; f < 10_000 && !s.outcome; f++) {
      const holding = s.beatMs > 0 ? false : !(s.charging && s.level >= s.centres[s.bundle]);
      const next = stepHarvestRound(s, 1 / 60, holding);
      if (next.outcome && !beforeEnd) beforeEnd = s;
      s = next;
    }
    expect(beforeEnd).toMatchObject({ bundle: 8, outcome: null });
    expect(beforeEnd!.beatMs).toBeGreaterThan(0);
    expect(stepHarvestRound(s, 1 / 60, true)).toBe(s);
  });
});

describe("scoreText", () => {
  it("writes a half point with a comma", () => {
    expect([scoreText(3.5), scoreText(4), scoreText(0), scoreText(0.5)]).toEqual(["3,5", "4", "0", "0,5"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/farm-minigames.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/game/farm/minigames"`.

- [ ] **Step 3: Implement**

Create `lib/game/farm/minigames.ts` with exactly:

```ts
import { nextRandom } from "../fishing/reel";

// The field's minigames (v15.2 §6.2, R17): pure state machines, deterministic for a seed, driven by thin overlays.
//
// HarvestGame's round: 8 bundles. Holding raises the sickle's power bar from 0 to 1 in 1.2 s, and letting go cuts the
// bundle at that level; the bar auto-releases at 1. Each bundle has a seeded sweet band. A 0.35 s cut beat after each
// cut ignores input, and after an auto-release the sickle waits to be let go before the next charge. A score of 4 or
// more passes.

export const HARVEST = {
  bundles: 8,
  /** Hold time from an empty bar to a full one. */
  fillMs: 1200,
  /** The sweet band: 0.14 wide (the chuẩn zone), centred in [0.62, 0.78]. */
  band: 0.14,
  centreMin: 0.62,
  centreMax: 0.78,
  /** |level − centre| up to this is chuẩn (1 point), up to `near` được (0.5). */
  exact: 0.07,
  near: 0.17,
  beatMs: 350,
  pass: 4,
  /** The longest frame a step counts (a hidden tab does not charge the bar). */
  maxDt: 0.05,
} as const;

export type HarvestMark = "chuan" | "duoc" | "sot" | "rung";
export const HARVEST_MARK: Record<HarvestMark, string> = {
  chuan: "Chuẩn!", duoc: "Được", sot: "Lệch — sót hạt", rung: "Lệch — rụng hạt",
};

export interface HarvestCut { level: number; centre: number; mark: HarvestMark; score: number }

export interface HarvestRound {
  /** The 8 bands' centres. */
  centres: readonly number[];
  /** Bundles cut so far (0–8). */
  bundle: number;
  /** How long the current charge has been held, and the bar it gives (0 between charges). */
  chargeMs: number;
  level: number;
  charging: boolean;
  /** Let go since the last auto-release: a new charge may start. */
  armed: boolean;
  /** The cut beat left; input is ignored until it is over. */
  beatMs: number;
  cuts: HarvestCut[];
  score: number;
  elapsedMs: number;
  outcome: "pass" | "fail" | null;
}

/** Scores a cut at bar `level` against a band centred at `centre` (the boundaries count, up to rounding). */
export function scoreRelease(level: number, centre: number): { mark: HarvestMark; score: number } {
  const d = Math.abs(level - centre);
  if (d <= HARVEST.exact + 1e-9) return { mark: "chuan", score: 1 };
  if (d <= HARVEST.near + 1e-9) return { mark: "duoc", score: 0.5 };
  return { mark: level < centre ? "sot" : "rung", score: 0 };
}

/** "3,5": a score with the Vietnamese decimal comma. */
export const scoreText = (n: number): string => String(n).replace(".", ",");

export function createHarvestRound(seed: number): HarvestRound {
  const centres: number[] = [];
  let rng = seed | 0;
  for (let i = 0; i < HARVEST.bundles; i++) {
    const [u, next] = nextRandom(rng);
    rng = next;
    centres.push(HARVEST.centreMin + u * (HARVEST.centreMax - HARVEST.centreMin));
  }
  return {
    centres, bundle: 0, chargeMs: 0, level: 0, charging: false, armed: true, beatMs: 0, cuts: [], score: 0, elapsedMs: 0,
    outcome: null,
  };
}

/** One frame: `dtSec` is clamped to [0, 50 ms]; `holding` is the sickle's button. Once there is an outcome the same
 *  state is returned. */
export function stepHarvestRound(s: HarvestRound, dtSec: number, holding: boolean): HarvestRound {
  if (s.outcome) return s;
  const dtMs = Math.min(HARVEST.maxDt, Math.max(0, dtSec)) * 1000;
  const elapsedMs = s.elapsedMs + dtMs;
  const armed = s.armed || !holding;
  if (s.beatMs > 0) {
    const beatMs = Math.max(0, s.beatMs - dtMs);
    const outcome = beatMs === 0 && s.bundle >= HARVEST.bundles ? (s.score >= HARVEST.pass ? "pass" : "fail") : null;
    return { ...s, beatMs, elapsedMs, armed, outcome };
  }
  if (!s.charging) {
    return holding && armed ? { ...s, charging: true, chargeMs: 0, level: 0, elapsedMs, armed } : { ...s, elapsedMs, armed };
  }
  if (!holding) return cut(s, s.level, elapsedMs, true);
  const chargeMs = s.chargeMs + dtMs;
  if (chargeMs >= HARVEST.fillMs) return cut(s, 1, elapsedMs, false);
  return { ...s, chargeMs, level: chargeMs / HARVEST.fillMs, elapsedMs, armed };
}

function cut(s: HarvestRound, level: number, elapsedMs: number, armed: boolean): HarvestRound {
  const centre = s.centres[s.bundle];
  const { mark, score } = scoreRelease(level, centre);
  return {
    ...s, bundle: s.bundle + 1, chargeMs: 0, level: 0, charging: false, armed, beatMs: HARVEST.beatMs,
    cuts: [...s.cuts, { level, centre, mark, score }], score: s.score + score, elapsedMs,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: the command of Step 2.
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/minigames.ts tests/unit/farm-minigames.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the HarvestGame round — a seeded state machine for the sickle

lib/game/farm/minigames.ts (R17): 8 bundles with seeded sweet bands centred in [0.62, 0.78]; holding fills the bar in
1.2 s and it auto-releases at 1; a cut scores chuẩn 1 within 0.07 of the centre, được 0.5 within 0.17, otherwise lệch
(sót hạt below, rụng hạt above); a 0.35 s beat follows each cut; 4 points of 8 pass. After an auto-release the sickle
waits to be let go. The marks' texts and scoreText ("3,5") go with it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/minigames.ts tests/unit/farm-minigames.test.ts
git commit -F <message file>
```

---

### Task 11: The art on the plots — raised beds, khoai, bắp, ớt, the cut strips and the harvester

**Files:**
- Modify: `lib/game/art/crops.ts`, `lib/game/engine.ts` (the harvester and the post labels, on the server's clock), `hooks/useFarmController.ts` (`plotDraws` gets the catalog)
- Test: `tests/unit/game-crop-art.test.ts`, `tests/unit/game-canvas-input.test.tsx` (its plot draw gains `parts` and `harvester`) (modify)

**Interfaces:**
- Consumes: Tasks 6–7 (`CropView.kind` / `upland` / `parts` / `harvester`, `UplandCrop.stages`, the `upland.ts` phases and pickings, `HARVESTER_MS`, `HARVEST_PARTS`); from v15.1 `crops.ts`: `PlotLook`, `plotLook`, `lookKey`, `paintPlot`, `drawPlotShimmer`, `plotDraws`, the rice painters and pest overlays; `serverNow()` (`lib/game/farm/clock.ts`); the engine's `setPlots` and plot layer.
- Produces:
  - `crops.ts`: `CropStage` gains `beds`, `nursery`, `g0`–`g4` and `waiting`; `PlotLook` gains `crop`, `cut` (0–1) and `pickings`; `HarvesterJob { startedAt; endsAt }`; `PlotDraw` gains `parts` and `harvester`; `riceCut(parts, harvester, now)`; `plotLook(no, crop, v, now, u = null)` (beds by the config's stages, the ớt nursery, ripe, waiting and overripe, the four new pests); `lookKey` adds the crop, the cut in twelfths and the pickings; `postLabel(d, now)` ("· gặt 2/6", "· máy gặt 12s"); `liveLook(d, now)`; `plotDraws(plots, { varieties, uplands }, urgent, now)`; the painters for ridges and furrows by water level, khoai, bắp and ớt, and the cut strips (stubble and tied sheaves); `HARVESTER_W` 32, `HARVESTER_H` 20, `HARVESTER_ROWS`, `HARVESTER_PAL`, `harvesterSpot(x, y, w, h, cut)`, `drawHarvester(b, at, t, reduced)`;
  - `engine.ts`: each frame reads the plot's live look and label on `serverNow()`, and draws a running harvester over the uncut strips.

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-crop-art.test.ts — edit 1 of 3.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { lookKey, plotDraws, plotLabel, plotLook } from "@/lib/game/art/crops";
import { varietyFromRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import type { CropView, PlotView } from "@/lib/game/farm/state";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
  HARVESTER_H, HARVESTER_PAL, HARVESTER_ROWS, HARVESTER_W, harvesterSpot, liveLook, lookKey, plotDraws, plotLabel, plotLook, postLabel,
  riceCut, type PlotDraw,
} from "@/lib/game/art/crops";
import { uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import type { CropView, PlotView } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/game-crop-art.test.ts — edit 2 of 3.** Replace:

```ts
    expect(key(4)).not.toBe(key(10));
    expect(key(4)).toBe("tillering|0|2||0");
  });
```

with:

```ts
    expect(key(4)).not.toBe(key(10));
    expect(key(4)).toBe("rice|tillering|0|2||0|0|0");
  });
```

**tests/unit/game-crop-art.test.ts — edit 3 of 3.** Replace:

```ts
    const plots = [plot({ no: 5, crop: crop() }), plot({ no: 6 })];
    const draws = plotDraws(plots, [nep], new Set([5]), at(16));
    expect(draws.map((d) => [d.no, d.look?.stage ?? null, d.label, d.urgent])).toEqual([
      [5, "tillering", "5 · đất trống", true],
      [6, null, "6 · đất trống", false],
    ]);
  });
});
```

with:

```ts
    const plots = [plot({ no: 5, crop: crop() }), plot({ no: 6 })];
    const draws = plotDraws(plots, { varieties: [nep], uplands: [] }, new Set([5]), at(16));
    expect(draws.map((d) => [d.no, d.look?.stage ?? null, d.label, d.urgent, d.parts, d.harvester])).toEqual([
      [5, "tillering", "5 · đất trống", true, 0, null],
      [6, null, "6 · đất trống", false, 0, null],
    ]);
  });
});

describe("v15.2: beds, the cut strips and the harvester", () => {
  const U = Object.fromEntries((fixtures as unknown as { crops: UplandCropRow[] }).crops.map((r) => [r.id, uplandFromRow(r)]));
  const LOG = { fert: [], spray: [], picks: [], qTransplant: 1, work: [], harvestedKg: 0 };
  /** Beds on plot 5 prepared at 0 h, Ẩm; `upland` planted at 0 h unless `over` says otherwise. */
  const beds = (upland: string | null, over: Partial<CropView> = {}, harvests: Array<[number, number]> = []): CropView => crop({
    kind: "upland", variety: null, upland, soakAt: null, sowAt: null, transplantAt: null, plantAt: upland === null ? null : at(0), water: 1,
    pickings: upland === null ? 0 : U[upland].pickings.length,
    log: { ...LOG, water: [{ t: at(0), l: 1 }], harvests: harvests.map(([h, k]) => ({ t: at(h), k, kg: 10 })) },
    ...over,
  });
  const look = (c: CropView, h: number) => plotLook(5, c, null, at(h), c.upland ? U[c.upland] : null);

  it("draws bare beds, then the config's stages by index, the ripe window and the overripe one", () => {
    expect(look(beds(null), 1)).toMatchObject({ crop: "", stage: "beds", water: 1, cut: 0, picked: 0 });
    expect(look(beds("khoai"), 3)).toMatchObject({ crop: "khoai", stage: "g0", progress: 0.5 });
    expect(look(beds("khoai"), 10)).toMatchObject({ stage: "g1", progress: 0.25 });
    expect(look(beds("khoai"), 51)).toMatchObject({ stage: "ripe", progress: 0.25, picked: 0, pickings: 1 });
    expect(look(beds("khoai"), 72)).toMatchObject({ stage: "overripe", progress: 0.25 });
    expect(look(beds("bap"), 55)).toMatchObject({ crop: "bap", stage: "g4", progress: 0.5 });
    // no config yet (the catalog before 0016 loads): bare beds
    expect(plotLook(5, beds("khoai"), null, at(10))).toMatchObject({ crop: "", stage: "beds" });
  });
  it("draws the ớt nursery, then its pickings thinning out", () => {
    const nursery = beds("ot", { sowAt: at(0), plantAt: null });
    expect(look(nursery, 5)).toMatchObject({ crop: "ot", stage: "nursery", progress: 0.5 });
    // set out at 12 h: picking 1 is ripe at 58 h, picking 2 at 70 h
    const ot = (harvests: Array<[number, number]>) => beds("ot", { sowAt: at(0), plantAt: at(12) }, harvests);
    expect(look(ot([]), 60)).toMatchObject({ stage: "ripe", picked: 0, pickings: 3 });
    expect(look(ot([[59, 1]]), 62)).toMatchObject({ stage: "waiting", picked: 1 });
    // a neighbour has no log: the server's next picking tells what is gone
    const seen = { ...ot([]), log: null, picking: 2 };
    expect(look(seen, 72)).toMatchObject({ stage: "ripe", picked: 1 });
    expect(look({ ...seen, picking: 0 }, 72)).toMatchObject({ stage: "beds", picked: 3 });
  });
  it("cuts rice strips by the parts, and a harvester over the rest on its way", () => {
    const job = { startedAt: at(61), endsAt: at(61) + 30_000 };
    expect(riceCut(0, null, at(61))).toBe(0);
    expect(riceCut(2, null, at(61))).toBeCloseTo(2 / 6, 12);
    expect(riceCut(2, job, at(61) + 15_000)).toBeCloseTo(4 / 6, 12);
    expect(riceCut(2, job, at(61) + 60_000)).toBe(1);
    const cut = plotLook(5, crop({ parts: 2 }), nep, at(62))!;
    expect(cut.cut).toBeCloseTo(2 / 6, 12);
    expect(lookKey(cut)).toBe(`rice|${cut.stage}|${Math.floor(cut.progress * 5)}|2||0|4|0`);
    const d: PlotDraw = { no: 5, look: plotLook(5, crop({ parts: 2, harvester: job }), nep, at(61)), label: "5 · Bình", urgent: false, parts: 2, harvester: job };
    expect(liveLook(d, at(61) + 15_000)?.cut).toBeCloseTo(4 / 6, 12);
    const still = { ...d, harvester: null };
    expect(liveLook(still, at(62))).toBe(still.look);
  });
  it("counts the parts and a harvester's seconds on the name post", () => {
    const d: PlotDraw = { no: 5, look: null, label: "5 · Bình", urgent: false, parts: 2, harvester: null };
    expect(postLabel(d, at(0))).toBe("5 · Bình · gặt 2/6");
    expect(postLabel({ ...d, parts: 0 }, at(0))).toBe("5 · Bình");
    const job = { startedAt: at(0), endsAt: at(0) + 30_000 };
    expect(postLabel({ ...d, harvester: job }, at(0) + 5_000)).toBe("5 · Bình · máy gặt 25s");
    expect(postLabel({ ...d, harvester: job }, at(0) + 29_500)).toBe("5 · Bình · máy gặt 1s");
    // ended on this clock: the job is hidden until the state catches up
    expect(postLabel({ ...d, harvester: job }, at(0) + 30_000)).toBe("5 · Bình");
  });
  it("draws a 32 × 20 combine in its palette, its reel on the cut line", () => {
    expect([HARVESTER_W, HARVESTER_H]).toEqual([32, 20]);
    expect(HARVESTER_ROWS).toHaveLength(HARVESTER_H);
    for (const row of HARVESTER_ROWS) {
      expect(row).toHaveLength(HARVESTER_W);
      for (const ch of row) expect(ch === "." || ch in HARVESTER_PAL, ch).toBe(true);
    }
    expect(HARVESTER_PAL).toMatchObject({ b: "#d9532b", B: "#a83a1c", g: "#9fc3cf", t: "#2a2f3a", T: "#5a5f68", r: "#f6c945" });
    expect(harvesterSpot(100, 50, 128, 76, 0.5)).toEqual({ x: 136, y: 78 });
  });
});
```

**tests/unit/game-canvas-input.test.tsx.** Replace:

```tsx
    const { rerender } = render(<GameCanvas ref={ref} mapId="field" {...props} />);
    const plots = [{ no: 1, look: null, label: "1 · An", urgent: false }];
    ref.current!.setPlots(plots);
```

with:

```tsx
    const { rerender } = render(<GameCanvas ref={ref} mapId="field" {...props} />);
    const plots = [{ no: 1, look: null, label: "1 · An", urgent: false, parts: 0, harvester: null }];
    ref.current!.setPlots(plots);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-canvas-input.test.tsx tests/unit/game-crop-art.test.ts`
Expected: FAIL — 7 `game-crop-art` tests fail (the old `lookKey`, `varieties.find is not a function` where `plotDraws` now gets the catalog, no beds or nursery looks, `riceCut is not a function`, `postLabel is not a function`, no harvester sprite); 15 pass.

- [ ] **Step 3: Implement**

**lib/game/art/crops.ts — edit 1 of 15.** Replace:

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
```

with:

```ts
import type { FarmCatalog, UplandCrop, Variety } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, hrs, waterAt } from "@/lib/game/farm/crop";
import type { CropView, PestKind, PlotView } from "@/lib/game/farm/state";
import { uplandModel, upNext, upOverAt, upPhase, upReadyAt, type UplandModel } from "@/lib/game/farm/upland";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx } from "@/lib/game/maps/scene-art";

// The crops on a plot (spec §13.4, §14; v15.2 §15): what to draw (pure) and its procedural painters (browser only:
// canvas) — the rice stages and its cut strips, raised beds and the hoa-màu crops, the water by level, the pests and
// the co-op's harvester. Original art.

export type CropStage =
  | "prepared" | "seedbed" | "transplanted" | "tillering" | "panicle" | "heading" | "ripening" | "ripe" | "overripe"
  // hoa màu: bare beds, the ớt nursery, the config's stages by index, and the wait for the next picking
  | "beds" | "nursery" | "g0" | "g1" | "g2" | "g3" | "g4" | "waiting";

export interface PlotLook {
  /** "rice" on a paddy; on beds the hoa-màu crop's id, "" before planting. */
  crop: string;
  stage: CropStage;
```

**lib/game/art/crops.ts — edit 2 of 15.** Replace:

```ts
  progress: number;
  /** 0 khô … 3 sâu. */
  water: number;
```

with:

```ts
  progress: number;
  /** 0 khô … 3 sâu (on beds: Khô … Ngập). */
  water: number;
```

**lib/game/art/crops.ts — edit 3 of 15.** Replace:

```ts
  wobble: boolean;
  seed: number;
```

with:

```ts
  wobble: boolean;
  /** Rice: the share cut from the left, 0–1 (the parts, and a harvester on its way). */
  cut: number;
  /** Hoa màu: the pickings gone (taken or lost) of the crop's `pickings`. */
  picked: number;
  pickings: number;
  seed: number;
```

**lib/game/art/crops.ts — edit 4 of 15.** Replace:

```ts

/** What the engine draws on a plot: its look (null = the background's bare stubble), the name post's label and the
 *  farmer's urgent ring. */
export interface PlotDraw { no: number; look: PlotLook | null; label: string; urgent: boolean }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** The look of a plot's crop at `now`; null while the plot is unprepared (no crop, or seed soaking before preparing). */
export function plotLook(no: number, crop: CropView | null, v: Variety | null, now: number): PlotLook | null {
  if (!crop || crop.preparedAt === null) return null;
  const c = cropModel(crop);
```

with:

```ts

/** A running harvester (v15.2 §6.3). */
export interface HarvesterJob { startedAt: number; endsAt: number }

/** What the engine draws on a plot: its look (null = the background's bare stubble), the name post's label, the
 *  farmer's urgent ring, and what changes every frame: the rice parts cut and a running harvester. */
export interface PlotDraw {
  no: number;
  look: PlotLook | null;
  label: string;
  urgent: boolean;
  parts: number;
  harvester: HarvesterJob | null;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const untreated = (crop: CropView): PestKind[] => crop.pests.filter((p) => p.treatedAt === null).map((p) => p.kind);

/** The share of a rice plot cut at `now`: its parts, and a harvester's progress over the rest (§15). */
export function riceCut(parts: number, harvester: HarvesterJob | null, now: number): number {
  const p = Math.max(0, Math.min(6, parts));
  if (!harvester) return p / 6;
  const span = harvester.endsAt - harvester.startedAt;
  return (p + (span > 0 ? clamp01((now - harvester.startedAt) / span) : 1) * (6 - p)) / 6;
}

/** The look of a plot's crop at `now`; null while the plot is unprepared (no crop, or seed soaking before preparing).
 *  `u` is the hoa-màu crop's config on beds. */
export function plotLook(no: number, crop: CropView | null, v: Variety | null, now: number, u: UplandCrop | null = null): PlotLook | null {
  if (!crop) return null;
  if (crop.kind === "upland") return bedLook(no, crop, u, now);
  if (crop.preparedAt === null) return null;
  const c = cropModel(crop);
```

**lib/game/art/crops.ts — edit 5 of 15.** Replace:

```ts
  return {
    stage, progress: clamp01(progress),
    // the farmer has the log (exact at any time); the others get the level at the last fetch
    water: crop.log ? waterAt(crop.log.water, now) : crop.water,
    pests: crop.pests.filter((p) => p.treatedAt === null).map((p) => p.kind),
    wobble: (crop.log?.qTransplant ?? 1) < 1, seed: no * 7919,
  };
```

with:

```ts
  return {
    crop: "rice", stage, progress: clamp01(progress),
    // the farmer has the log (exact at any time); the others get the level at the last fetch
    water: crop.log ? waterAt(crop.log.water, now) : crop.water,
    pests: untreated(crop), wobble: (crop.log?.qTransplant ?? 1) < 1, cut: riceCut(crop.parts, crop.harvester, now), picked: 0,
    pickings: 1, seed: no * 7919,
  };
```

**lib/game/art/crops.ts — edit 6 of 15.** Replace:

```ts

/** The cache key of a look: progress in fifths is enough to see the rice grow. */
export function lookKey(l: PlotLook): string {
  return `${l.stage}|${Math.floor(l.progress * 5)}|${l.water}|${l.pests.join(",")}|${l.wobble ? 1 : 0}`;
}
```

with:

```ts

/** The farmer's model of the beds; a neighbour has no log, so the pickings before the server's next one are gone. */
function bedModel(crop: CropView): UplandModel {
  const c = uplandModel(crop);
  if (crop.log || crop.picking === null) return c;
  const gone = crop.picking === 0 ? crop.pickings : Math.max(0, crop.picking - 1);
  return { ...c, harvests: Array.from({ length: gone }, (_, j) => ({ t: 0, k: j + 1, kg: 0 })) };
}

function bedLook(no: number, crop: CropView, u: UplandCrop | null, now: number): PlotLook {
  const n = u?.pickings.length ?? 1;
  const base = {
    crop: crop.upland ?? "", water: crop.log ? waterAt(crop.log.water, now) : crop.water, pests: untreated(crop), wobble: false,
    cut: 0, pickings: n, seed: no * 7919,
  };
  if (!u || crop.upland === null) return { ...base, crop: "", stage: "beds", progress: 0, picked: 0 };
  const c = bedModel(crop);
  const k = upNext(c, u, now);
  let stage: CropStage = "beds";
  let progress = 0;
  const ph = upPhase(c, u, now);
  if (ph === "nursery") {
    stage = "nursery";
    progress = c.sowAt !== null && u.nurseryReadyH ? hrs(c.sowAt, now) / u.nurseryReadyH : 0;
  } else if (ph === "waiting") {
    stage = "waiting";
  } else if (ph === "ripe" && k > 0) {
    stage = "ripe";
    progress = hrs(upReadyAt(c, u, k)!, now) / u.ripeWindowH;
  } else if (ph === "overripe" && k > 0) {
    stage = "overripe";
    progress = hrs(upOverAt(c, u, k)!, now) / u.lostAfterH;
  } else {
    const i = u.stages.findIndex((st) => st.id === ph);
    if (i >= 0 && c.plantAt !== null) {
      stage = `g${Math.min(i, 4)}` as CropStage;
      const from = i === 0 ? 0 : u.stages[i - 1].untilH;
      progress = (hrs(c.plantAt, now) - from) / (u.stages[i].untilH - from);
    }
  }
  return { ...base, stage, progress: clamp01(progress), picked: k === 0 ? n : k - 1 };
}

/** The cache key of a look: progress in fifths is enough to see a crop grow, and the cut in twelfths (half strips) to
 *  see a harvester cross. */
export function lookKey(l: PlotLook): string {
  return `${l.crop}|${l.stage}|${Math.floor(l.progress * 5)}|${l.water}|${l.pests.join(",")}|${l.wobble ? 1 : 0}|${Math.floor(l.cut * 12)}|${l.picked}`;
}
```

**lib/game/art/crops.ts — edit 7 of 15.** Replace:

```ts

/** Everything the engine draws on the plots at `now`; `urgent` = the plots with an urgent task of mine. */
export function plotDraws(plots: readonly PlotView[], varieties: readonly Variety[], urgent: ReadonlySet<number>, now: number): PlotDraw[] {
  return plots.map((p) => ({
    no: p.no,
    look: plotLook(p.no, p.crop, varieties.find((v) => v.id === p.crop?.variety) ?? null, now),
    label: plotLabel(p),
    urgent: urgent.has(p.no),
  }));
```

with:

```ts

/** The name post at `now` (v15.2 §13.6): "· máy gặt 25s" while a harvester runs, "· gặt 2/6" while partly cut. */
export function postLabel(d: PlotDraw, now: number): string {
  if (d.harvester) return now < d.harvester.endsAt ? `${d.label} · máy gặt ${Math.ceil((d.harvester.endsAt - now) / 1000)}s` : d.label;
  return d.parts > 0 && d.parts < 6 ? `${d.label} · gặt ${d.parts}/6` : d.label;
}

/** A plot's look at `now` with the cut a running harvester has reached (drawn every frame). */
export function liveLook(d: PlotDraw, now: number): PlotLook | null {
  return d.look && d.harvester ? { ...d.look, cut: riceCut(d.parts, d.harvester, now) } : d.look;
}

/** Everything the engine draws on the plots at `now`; `urgent` = the plots with an urgent task of mine. */
export function plotDraws(plots: readonly PlotView[], catalog: Pick<FarmCatalog, "varieties" | "uplands">, urgent: ReadonlySet<number>,
  now: number): PlotDraw[] {
  return plots.map((p) => ({
    no: p.no,
    look: plotLook(p.no, p.crop, catalog.varieties.find((v) => v.id === p.crop?.variety) ?? null, now,
      catalog.uplands.find((u) => u.id === p.crop?.upland) ?? null),
    label: plotLabel(p),
    urgent: urgent.has(p.no),
    parts: p.crop?.kind === "rice" ? p.crop.parts : 0,
    harvester: p.crop?.harvester ?? null,
  }));
```

**lib/game/art/crops.ts — edit 8 of 15.** Replace:

```ts
  egg: "#f29bb5", shell: "#8a5a2b", roll: "#f4f1ea", hopper: "#7a4a2a", blast: "#8e5a2a", dike: "#5a7f30",
};
```

with:

```ts
  egg: "#f29bb5", shell: "#8a5a2b", roll: "#f4f1ea", hopper: "#7a4a2a", blast: "#8e5a2a", dike: "#5a7f30",
  // v15.2: the cut rice, khoai, bắp, ớt and their pests
  tie: "#8b5a33", vine: "#8e4a8a", tuber: "#b0486e", tuberDark: "#7e2f4e", yellowLeaf: "#d9c27a", tassel: "#d9c27a",
  silk: "#c9607a", husk: "#8fbf5a", tan: "#e0c56a", dry: "#b8902a", flower: "#f4f1ea", chiliGreen: "#6fbf4a",
  chiliRed: "#d8342a", chiliOld: "#8e1f1a", weevil: "#2f3a6e", waist: "#e0662f", worm: "#8a6a3f", frass: "#d9c9a0",
  thrips: "#c9a23a", ring: "#3a2a1a",
};
```

**lib/game/art/crops.ts — edit 9 of 15.** Replace:

```ts

/** The transplanted hills in rows 8 px apart; returns where the panicles go ([x, y, kind]). */
function paintHills(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): Array<[number, number, number]> {
```

with:

```ts

/** The transplanted hills in rows 8 px apart; returns where the panicles go ([x, y, kind]). Hills left of `cutX` are
 *  cut: stubble, with a tied sheaf on every third hill. */
function paintHills(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): Array<[number, number, number]> {
```

**lib/game/art/crops.ts — edit 10 of 15.** Replace:

```ts
  const { stage, progress } = look;
  for (let y = 7; y < h - 1; y += 8) {
```

with:

```ts
  const { stage, progress } = look;
  const cutX = Math.round(look.cut * w);
  let hill = 0;
  for (let y = 7; y < h - 1; y += 8) {
```

**lib/game/art/crops.ts — edit 11 of 15.** Replace:

```ts
      const lean = (R() - 0.5) * 2;
      switch (stage) {
```

with:

```ts
      const lean = (R() - 0.5) * 2;
      if (x < cutX) {
        px(c, K.goldDark, bx - 1, by); px(c, K.goldDark, bx, by - 1); px(c, K.goldDark, bx + 1, by);
        if (hill++ % 3 === 0) {
          rect(c, K.gold, bx + 2, by - 4, 2, 4); px(c, K.goldLight, bx + 2, by - 5); px(c, K.goldDark, bx + 3, by - 1);
          px(c, K.tie, bx + 2, by - 2); px(c, K.tie, bx + 3, by - 2);
        }
        continue;
      }
      switch (stage) {
```

**lib/game/art/crops.ts — edit 12 of 15.** Replace:

```ts

function paintPests(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
```

with:

```ts

// --- raised beds (v15.2 §15): east–west ridges 8 px wide between 4 px furrows
const RIDGE = 8;
const PITCH = 12;

/** The ridges' top rows. */
function ridgeRows(h: number): number[] {
  const out: number[] = [];
  for (let y = 3; y + RIDGE <= h - 3; y += PITCH) out.push(y);
  return out;
}

/** Khô: light cracked soil; Ẩm: dark; Đẫm: water in the furrows; Ngập: water over all but the ridge tops. */
function paintBedSoil(c: Ctx, w: number, h: number, water: number, R: () => number): void {
  rect(c, water >= 2 ? K.deep : water === 1 ? K.mudWet : K.crack, 0, 0, w, h);
  for (const y of ridgeRows(h)) {
    const top = water === 0 ? K.mudDry : K.mud;
    if (water === 3) {
      rect(c, top, 2, y + 2, w - 4, RIDGE - 4);
    } else {
      rect(c, top, 1, y, w - 2, RIDGE);
      rect(c, water === 0 ? K.crack : K.mudWet, 1, y + RIDGE - 1, w - 2, 1);
    }
    for (let i = 0; i < w * 0.25; i++) {
      const x = 2 + Math.floor(R() * (w - 6)), yy = y + 2 + Math.floor(R() * (RIDGE - 4));
      if (water === 0) { px(c, K.crack, x, yy); px(c, K.crack, x + 1, yy + 1); } else px(c, K.mudWet, x, yy);
    }
  }
  if (water >= 2) {
    for (const y of ridgeRows(h)) {
      const fy = y + RIDGE + 1;
      for (let x = 3 + (y % 7); x < w - 6; x += 13) rect(c, K.sheen, x, fy, 3, 1);
    }
  }
}

/** The plants' base points: along each ridge, 8 px apart. */
function bedSpots(w: number, h: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const y of ridgeRows(h)) for (let x = 6; x < w - 5; x += 8) out.push([x, y + 5]);
  return out;
}

function paintKhoai(c: Ctx, l: PlotLook, x: number, y: number, R: () => number): void {
  const leaf = (lx: number, ly: number, col = R() < 0.5 ? K.young : K.youngDark) => { px(c, col, lx, ly); px(c, col, lx + 1, ly); };
  switch (l.stage) {
    case "g0":
      // a cutting with two leaves
      px(c, K.vine, x, y); px(c, K.vine, x, y - 1); leaf(x - 2, y - 2); leaf(x + 1, y - 3);
      break;
    case "g1": {
      // the vines creep along the ridge
      const len = 3 + Math.round(l.progress * 3);
      for (let k = 0; k < len; k++) px(c, K.vine, x + k - 1, y - (k % 2));
      for (let k = 0; k < len; k += 2) leaf(x + k - 1, y - 2);
      break;
    }
    case "g2":
    case "g3":
    case "ripe":
    case "overripe": {
      // a mat over the ridge: denser with age, yellowing when ripe, drooping when overripe
      const n = l.stage === "g2" ? 7 + Math.round(l.progress * 5) : 14;
      const col = l.stage === "ripe" ? mix(K.young, K.yellowLeaf, 0.5) : l.stage === "overripe" ? mix(K.youngDark, K.dry, 0.5) : K.young;
      for (let k = 0; k < n; k++) {
        const lx = x - 4 + Math.floor(R() * 8), ly = y - 4 + Math.floor(R() * 5);
        const yellow = (l.stage === "g3" && R() < 0.12) || (l.stage === "ripe" && R() < 0.35);
        px(c, yellow ? K.yellowLeaf : R() < 0.4 ? K.youngDark : col, lx, ly + (l.stage === "overripe" ? 1 : 0));
      }
      px(c, K.vine, x - 3, y); px(c, K.vine, x + 2, y - 1);
      if (l.stage === "ripe" || l.stage === "overripe") {
        // tubers peeking at the ridge's side; dark-spotted when overripe
        rect(c, K.tuber, x - 2, y + 2, 2, 1); px(c, K.tuberDark, x, y + 2);
        if (l.stage === "overripe") px(c, C.outline, x - 1, y + 2);
      }
      break;
    }
    default:
      break;
  }
}

function paintBap(c: Ctx, l: PlotLook, x: number, y: number, R: () => number): void {
  const stalk = (hgt: number, col: string, dark: string, lodged = false) => {
    for (let k = 0; k < hgt; k++) px(c, k % 3 === 0 ? dark : col, lodged ? x + k : x, lodged ? y - 1 : y - k);
  };
  const leaves = (at: number[], col: string, dark: string) => {
    for (const k of at) { px(c, col, x - 1, y - k); px(c, dark, x - 2, y - k + 1); px(c, col, x + 1, y - k - 1); px(c, dark, x + 2, y - k); }
  };
  switch (l.stage) {
    case "g0": px(c, K.young, x, y); px(c, K.young, x, y - 1); break;
    case "g1": stalk(3, K.young, K.leafDark); leaves([1, 2], K.young, K.leafDark); break;
    case "g2": stalk(6, K.young, K.leafDark); leaves([2, 4], K.young, K.leafDark); break;
    case "g3":
    case "g4":
      stalk(10, K.young, K.leafDark); leaves([2, 5, 7], K.young, K.leafDark);
      px(c, K.tassel, x, y - 10); px(c, K.tassel, x - 1, y - 11); px(c, K.tassel, x + 1, y - 11);
      if (l.stage === "g3") { px(c, K.silk, x + 1, y - 6); px(c, K.silk, x + 2, y - 5); }
      else { rect(c, K.husk, x + 1, y - 6, 2, 3); px(c, K.silk, x + 2, y - 7); }
      break;
    case "ripe":
      stalk(10, K.tan, K.dry); leaves([2, 5, 7], K.tan, K.dry); rect(c, K.tan, x + 1, y - 6, 2, 3); px(c, K.dry, x + 2, y - 7);
      break;
    case "overripe":
      if (R() < 0.35) { stalk(8, K.dry, K.crack, true); px(c, K.tan, x + 5, y - 2); }
      else { stalk(9, K.dry, K.crack); leaves([2, 5], K.dry, K.crack); rect(c, K.dry, x + 1, y - 5, 2, 3); }
      break;
    default:
      break;
  }
}

function paintOt(c: Ctx, l: PlotLook, x: number, y: number, R: () => number): void {
  const bush = (wd: number, hg: number) => {
    for (let k = 0; k < wd * hg; k++) {
      const bx = x - Math.floor(wd / 2) + (k % wd), by = y - Math.floor(k / wd);
      if ((k % wd === 0 || k % wd === wd - 1) && Math.floor(k / wd) === hg - 1) continue;
      px(c, (k + Math.floor(k / wd)) % 3 === 0 ? K.leafDark : K.leaf, bx, by);
    }
  };
  const fruit = (col: string, n: number) => {
    for (let k = 0; k < n; k++) { const fx = x - 2 + ((k * 3) % 5), fy = y - 1 - (k % 3); px(c, col, fx, fy); px(c, col, fx, fy + 1); }
  };
  switch (l.stage) {
    case "g0": bush(3, 2); break;
    case "g1": bush(5, 3 + Math.round(l.progress)); break;
    case "g2": bush(5, 4); px(c, K.flower, x - 1, y - 4); px(c, K.flower, x + 2, y - 2); px(c, K.flower, x - 2, y - 1); break;
    case "g3": bush(5, 4); fruit(K.chiliGreen, 3); break;
    case "ripe": {
      bush(5, 4);
      // thinner with each picking gone
      const n = Math.max(1, Math.round(4 * (1 - l.picked / Math.max(1, l.pickings))));
      fruit(K.chiliRed, n);
      break;
    }
    case "waiting": bush(5, 4); fruit(K.chiliGreen, 3); if (R() < 0.5) px(c, K.chiliRed, x + 1, y - 3); break;
    case "overripe": bush(5, 3); fruit(K.chiliOld, 2); px(c, K.chiliOld, x + 3, y + 2); px(c, K.chiliOld, x - 3, y + 2); break;
    default: break;
  }
}

/** A crop without its own drawing: green tufts that grow, turning gold when ripe. */
function paintGeneric(c: Ctx, l: PlotLook, x: number, y: number): void {
  const i = l.stage.startsWith("g") ? Number(l.stage.slice(1)) : 4;
  const col = l.stage === "ripe" || l.stage === "waiting" ? K.gold : l.stage === "overripe" ? K.dry : K.young;
  tuft(c, x, y, 2 + i, 1, col, K.leafDark, 0);
}

/** The ớt nursery: a patch in the beds' corner. */
function paintNursery(c: Ctx, look: PlotLook, R: () => number): void {
  const bw = 14 + Math.round(look.progress * 8), bh = 8;
  rect(c, K.mudWet, 3, 4, bw, bh);
  for (let i = 0; i < bw * bh * 0.5; i++) px(c, R() < 0.5 ? K.leaf : K.leafDark, 3 + Math.floor(R() * bw), 4 + Math.floor(R() * bh));
}

function paintBeds(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
  paintBedSoil(c, w, h, look.water, R);
  if (look.stage === "beds") return;
  if (look.stage === "nursery") {
    paintNursery(c, look, R);
    return;
  }
  const paint = look.crop === "khoai" ? paintKhoai : look.crop === "bap" ? paintBap : look.crop === "ot" ? paintOt : null;
  for (const [x, y] of bedSpots(w, h)) {
    if (paint) paint(c, look, x, y, R);
    else paintGeneric(c, look, x, y);
  }
}

function paintPests(c: Ctx, look: PlotLook, w: number, h: number, R: () => number): void {
```

**lib/game/art/crops.ts — edit 13 of 15.** Replace:

```ts
        case "neck_blast": px(c, C.white, x, y - 6); px(c, C.white, x, y - 7); px(c, "#d6cfc0", x + 1, y - 7); break;
      }
```

with:

```ts
        case "neck_blast": px(c, C.white, x, y - 6); px(c, C.white, x, y - 7); px(c, "#d6cfc0", x + 1, y - 7); break;
        // v15.2: tiny ants with an orange waist; caterpillars and their frass; silvery streaks; dark rings on the fruit
        case "weevil": px(c, K.weevil, x, y); px(c, K.waist, x + 1, y); px(c, K.weevil, x + 2, y); break;
        case "armyworm":
          rect(c, K.worm, x, y - 2, 3, 1); px(c, C.outline, x + 3, y - 2); px(c, K.frass, x - 1, y); px(c, K.frass, x + 2, y + 1);
          break;
        case "thrips": px(c, K.thrips, x, y - 3); px(c, K.thrips, x + 1, y - 3); px(c, K.thrips, x + 2, y - 4); break;
        case "anthracnose": px(c, K.ring, x, y - 2); px(c, K.ring, x + 2, y - 2); px(c, K.ring, x + 1, y - 3); px(c, K.ring, x + 1, y - 1); break;
      }
```

**lib/game/art/crops.ts — edit 14 of 15.** Replace:

```ts
  const R = rng(look.seed);
  paintSoil(c, w, h, look.water, R);
  if (look.stage === "seedbed") paintSeedbed(c, look, w, h, R);
  const heads = paintHills(c, look, w, h, R);
  for (const [x, y, kind] of heads) {
    const col = kind === 0 ? K.panicle : kind === 1 ? mix(K.panicle, K.goldLight, look.progress) : kind === 2 ? K.goldLight : K.gold;
    px(c, col, x, y); px(c, col, x + 1, y + 1); px(c, col, x - 1, y + 1);
  }
```

with:

```ts
  const R = rng(look.seed);
  if (look.crop !== "rice") {
    paintBeds(c, look, w, h, R);
  } else {
    paintSoil(c, w, h, look.water, R);
    if (look.stage === "seedbed") paintSeedbed(c, look, w, h, R);
    const heads = paintHills(c, look, w, h, R);
    for (const [x, y, kind] of heads) {
      const col = kind === 0 ? K.panicle : kind === 1 ? mix(K.panicle, K.goldLight, look.progress) : kind === 2 ? K.goldLight : K.gold;
      px(c, col, x, y); px(c, col, x + 1, y + 1); px(c, col, x - 1, y + 1);
    }
  }
```

**lib/game/art/crops.ts — edit 15 of 15.** Append at the end of the file, after a blank line:

```ts
// --- the co-op's harvester (v15.2 §15): a 32 × 20 combine facing right, the reel in front
export const HARVESTER_W = 32;
export const HARVESTER_H = 20;
export const HARVESTER_ROWS: readonly string[] = [
  "................................",
  "...........oooooooo.............",
  "...........oggggGGo.............",
  "...........oggggGGo.............",
  "...........oggggggo.............",
  ".....ooooooobbbbbbooooooooo.....",
  ".....obbbbbbbbbbbbbbbbbbbbo.....",
  ".....obbbbbbbbbbbbbbbbbbbbo..oo.",
  ".....obbbbbbbbbbbbbbbbbbbbo.orro",
  ".....obbbbbbbbbbbbbbbbbbbboooRro",
  ".....oBBBBBBBBBBBBBBBBBBBBo.orRo",
  ".....oBBBBBBBBBBBBBBBBBBBBo.orro",
  ".....ooooooooooooooooooooooo.oo.",
  "....ottttttttttttttttttttttto...",
  "...otTttTttTttTttTttTttTttTtto..",
  "...ottttttttttttttttttttttttto..",
  "....ottttttttttttttttttttttto...",
  ".....ooooooooooooooooooooooo....",
  "................................",
  "................................",
];
export const HARVESTER_PAL: Record<string, string> = {
  o: C.outline, b: "#d9532b", B: "#a83a1c", g: "#9fc3cf", G: "#c9e3ea", t: "#2a2f3a", T: "#5a5f68", r: "#f6c945", R: "#c9a23a",
};

let harvesterSprite: HTMLCanvasElement | null = null;

/** The harvester's sprite, painted once (browser only). */
function harvesterCanvas(): HTMLCanvasElement {
  if (harvesterSprite) return harvesterSprite;
  const cv = makeCanvas(HARVESTER_W, HARVESTER_H);
  const c = ctx2d(cv);
  HARVESTER_ROWS.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ".") px(c, HARVESTER_PAL[ch], x, y); }));
  harvesterSprite = cv;
  return cv;
}

/** Where the harvester stands on a plot at view (x, y, w, h) with `cut` of it cut: its reel on the cut line, crossing
 *  the plot's middle. */
export function harvesterSpot(x: number, y: number, w: number, h: number, cut: number): { x: number; y: number } {
  return { x: Math.round(x + cut * w - HARVESTER_W + 4), y: Math.round(y + h / 2 - HARVESTER_H / 2) };
}

/** The harvester at work, bobbing 1 px with straw puffs behind; static without puffs when motion is reduced. */
export function drawHarvester(b: Ctx, at: { x: number; y: number }, t: number, reduced: boolean): void {
  const bob = reduced ? 0 : Math.floor(t / 160) % 2;
  if (!reduced) {
    for (let k = 0; k < 4; k++) {
      const age = ((t / 90 + k * 7) % 28) / 28;
      b.fillStyle = k % 2 ? K.gold : K.goldLight;
      b.fillRect(Math.round(at.x + 4 - age * 10), Math.round(at.y + 7 - age * 6 + k), 2, 1);
    }
  }
  b.drawImage(harvesterCanvas(), at.x, at.y + bob);
}
```

**lib/game/engine.ts — edit 1 of 7.** Replace:

```ts
import { createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { drawPlotShimmer, drawUrgentRing, lookKey, paintPlot, type PlotDraw } from "@/lib/game/art/crops";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
import { getCharacterFrames } from "@/lib/game/art/raster";
```

with:

```ts
import { createActor, setKeyboard, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import {
  drawHarvester, drawPlotShimmer, drawUrgentRing, harvesterSpot, liveLook, lookKey, paintPlot, postLabel, type PlotDraw,
} from "@/lib/game/art/crops";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
import { serverNow } from "@/lib/game/farm/clock";
import { getCharacterFrames } from "@/lib/game/art/raster";
```

**lib/game/engine.ts — edit 2 of 7.** Replace:

```ts

  /** The crops on the plots (between the background and the props), their glints and my urgent rings. */
  private drawPlots(b: CanvasRenderingContext2D, t: number, camX: number, camY: number, reduced: boolean): void {
    for (const g of this.map.plots) {
```

with:

```ts

  /** The crops on the plots (between the background and the props), their glints, a running harvester (v15.2 §15)
   *  and my urgent rings. A harvester's cut and its end are read on the server's clock. */
  private drawPlots(b: CanvasRenderingContext2D, t: number, camX: number, camY: number, reduced: boolean): void {
    const now = serverNow();
    for (const g of this.map.plots) {
```

**lib/game/engine.ts — edit 3 of 7.** Replace:

```ts
      if (x > this.vw || y > this.vh || x + w < 0 || y + h < 0) continue;
      if (d.look) {
        const key = lookKey(d.look);
        let art = this.plotArt.get(g.no);
        if (!art || art.key !== key) {
          art = { key, canvas: paintPlot(d.look, w, h) };
          this.plotArt.set(g.no, art);
```

with:

```ts
      if (x > this.vw || y > this.vh || x + w < 0 || y + h < 0) continue;
      const look = liveLook(d, now);
      if (look) {
        const key = lookKey(look);
        let art = this.plotArt.get(g.no);
        if (!art || art.key !== key) {
          art = { key, canvas: paintPlot(look, w, h) };
          this.plotArt.set(g.no, art);
```

**lib/game/engine.ts — edit 4 of 7.** Replace:

```ts
        b.drawImage(art.canvas, x, y);
        drawPlotShimmer(b, x, y, w, h, d.look, t, reduced);
      }
```

with:

```ts
        b.drawImage(art.canvas, x, y);
        drawPlotShimmer(b, x, y, w, h, look, t, reduced);
        if (d.harvester && now < d.harvester.endsAt) drawHarvester(b, harvesterSpot(x, y, w, h, look.cut), t, reduced);
      }
```

**lib/game/engine.ts — edit 5 of 7.** Replace:

```ts

    // the plots' name posts: a label over each post, under the people's tags
    c.font = `${Math.round(4 * s)}px ${font}`;
    for (const g of this.map.plots) {
```

with:

```ts

    // the plots' name posts: a label over each post, under the people's tags (a cut plot's parts and a harvester's
    // seconds are counted every frame)
    c.font = `${Math.round(4 * s)}px ${font}`;
    const farmNow = serverNow();
    for (const g of this.map.plots) {
```

**lib/game/engine.ts — edit 6 of 7.** Replace:

```ts
      const [x, y] = dev(g.post.x, g.post.y - 22);
      const w = Math.round(c.measureText(d.label).width + 3 * s), h = Math.round(4.8 * s);
      if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) continue;
```

with:

```ts
      const [x, y] = dev(g.post.x, g.post.y - 22);
      const label = postLabel(d, farmNow);
      const w = Math.round(c.measureText(label).width + 3 * s), h = Math.round(4.8 * s);
      if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) continue;
```

**lib/game/engine.ts — edit 7 of 7.** Replace:

```ts
      c.fillStyle = "#fbf3dc";
      c.fillText(d.label, x, y + s * 0.3);
    }
```

with:

```ts
      c.fillStyle = "#fbf3dc";
      c.fillText(label, x, y + s * 0.3);
    }
```

**hooks/useFarmController.ts.** Replace:

```ts
    const urgentPlots = new Set(tasks.filter((t) => t.urgent).map((t) => t.plot));
    canvas()?.setPlots(plotDraws(state.plots, catalog?.varieties ?? [], urgentPlots, now));
  }, [active, state, catalog, tasks, now, canvas]);
```

with:

```ts
    const urgentPlots = new Set(tasks.filter((t) => t.urgent).map((t) => t.plot));
    canvas()?.setPlots(plotDraws(state.plots, catalog ?? { varieties: [], uplands: [] }, urgentPlots, now));
  }, [active, state, catalog, tasks, now, canvas]);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 22 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint hooks/useFarmController.ts lib/game/art/crops.ts lib/game/engine.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-crop-art.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the art on the plots — raised beds, khoai, bắp, ớt, the cut strips and the harvester

lib/game/art/crops.ts: PlotLook gains the crop, the cut and the pickings gone; beds are drawn as ridges and furrows by
water level, with khoai, bắp and ớt through the config's stages (g0–g4), the ớt nursery, ripe, waiting and overripe, and
the four new pests; rice shows its cut strips (stubble and tied sheaves); lookKey adds the crop, the cut in twelfths and
the pickings. postLabel counts "gặt 2/6" and a harvester's seconds on the name post, and the 32 × 20 combine crosses the
uncut strips. lib/game/engine.ts reads the cut and the labels on the server's clock every frame; plotDraws takes the
catalog.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add hooks/useFarmController.ts lib/game/art/crops.ts lib/game/engine.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-crop-art.test.ts
git commit -F <message file>
```

---

### Task 12: Icons for the seeds, tools and hoa màu; digging and picking; `fa` 9 and 10

**Files:**
- Modify: `lib/game/art/farm-icons.ts`, `lib/game/art/farm-anim.ts`, `lib/game/net/protocol.ts`
- Test: `tests/unit/game-farm-icons.test.ts`, `tests/unit/game-protocol.test.ts` (modify)

**Interfaces:**
- Consumes: from v15.1: `PixelIcon`, `FARM_ICONS`, the seed-sack / fertilizer / bottle / rice-sack templates; `FARM_ANIM`, `drawFarmAnim`, `COL`; `FarmAnim`, `isFarmAnim`, `parseGameMessage`.
- Produces:
  - `farm-icons.ts`: 8 new 16 × 16 icons with complete palettes — `seed_khoai` (a bundle of cuttings), `seed_bap` and `seed_ot` (seed packets with a cob and a chili), `tool_sickle`, `tool_sprayer`, `produce_khoai`, `produce_bap`, `produce_ot`;
  - `farm-anim.ts`: a shared `hoe(c, hand, flip, down)`; `FARM_ANIM.dig = 9` (the hoe comes down and three tubers pop up) and `FARM_ANIM.pick = 10` (a hand reaches into the plants and a woven basket fills);
  - `protocol.ts`: `FarmAnim` is `0 | … | 10`, and `fa` above 10 is refused (R27).

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-farm-icons.test.ts — edit 1 of 3.** Replace:

```ts

const sql = readFileSync("supabase/migrations/0013_v15_field.sql", "utf8");
/** The farm items seeded by `insert into public.shop_items … on conflict`. */
const seededItems = (): string[] => {
  const start = sql.indexOf("insert into public.shop_items");
  const block = sql.slice(start, sql.indexOf("on conflict", start));
```

with:

```ts

/** The ids seeded by `insert into public.<table> … on conflict` in a migration. */
const seeded = (file: string, table: string): string[] => {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  const start = sql.indexOf(`insert into public.${table}`);
  const block = sql.slice(start, sql.indexOf("on conflict", start));
```

**tests/unit/game-farm-icons.test.ts — edit 2 of 3.** Replace:

```ts
};
```

with:

```ts
};
const seededItems = (): string[] => [...seeded("0013_v15_field.sql", "shop_items"), ...seeded("0016_v15_2_crops.sql", "shop_items")];
```

**tests/unit/game-farm-icons.test.ts — edit 3 of 3.** Replace:

```ts
  });
  it("cover every seeded farm item and the two rice sacks", () => {
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet"].sort());
  });
```

with:

```ts
  });
  it("cover every seeded farm item, the two rice sacks and each hoa-màu crop's produce", () => {
    const produce = seeded("0016_v15_2_crops.sql", "upland_crops").map((u) => `produce_${u}`);
    expect(produce).toEqual(["produce_khoai", "produce_bap", "produce_ot"]);
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet", ...produce].sort());
  });
  it("draw the v15.2 tools in their colours", () => {
    expect(iconMatrixFor("tool_sickle")?.flat()).toEqual(expect.arrayContaining(["#5a5f68", "#e8e8ee", "#6e4424"]));
    expect(iconMatrixFor("tool_sprayer")?.flat()).toEqual(expect.arrayContaining(["#3d6fd1", "#2f56a6"]));
    expect(iconMatrixFor("produce_ot")?.flat()).toContain("#d8342a");
  });
```

**tests/unit/game-protocol.test.ts — edit 1 of 2.** Replace:

```ts
  });
  it("accepts the field's fp (plot 0–10) and fa (animation 0–8)", () => {
    expect(GAME_EVENTS).toEqual(expect.arrayContaining(["fp", "fa"]));
```

with:

```ts
  });
  it("accepts the field's fp (plot 0–10) and fa (animation 0–10)", () => {
    expect(GAME_EVENTS).toEqual(expect.arrayContaining(["fp", "fa"]));
```

**tests/unit/game-protocol.test.ts — edit 2 of 2.** Replace:

```ts
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.stop }, B)).toEqual({ t: "fa", id: "a", a: 0 });
    const bad: Array<[string, unknown]> = [
      ["fp", { id: "a", p: 11 }], ["fp", { id: "a", p: -1 }], ["fp", { id: "a", p: 1.5 }], ["fp", { id: "a", p: "3" }], ["fp", { id: "a" }],
      ["fa", { id: "a", a: 9 }], ["fa", { id: "a", a: -1 }], ["fa", { id: "a", a: "1" }], ["fa", { id: "" , a: 1 }],
    ];
```

with:

```ts
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.stop }, B)).toEqual({ t: "fa", id: "a", a: 0 });
    // v15.2: đào khoai digs (9); bẻ bắp and hái ớt pick (10)
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.dig }, B)).toEqual({ t: "fa", id: "a", a: 9 });
    expect(parseGameMessage("fa", { id: "a", a: FARM_ANIM.pick }, B)).toEqual({ t: "fa", id: "a", a: 10 });
    const bad: Array<[string, unknown]> = [
      ["fp", { id: "a", p: 11 }], ["fp", { id: "a", p: -1 }], ["fp", { id: "a", p: 1.5 }], ["fp", { id: "a", p: "3" }], ["fp", { id: "a" }],
      ["fa", { id: "a", a: 11 }], ["fa", { id: "a", a: -1 }], ["fa", { id: "a", a: "1" }], ["fa", { id: "" , a: 1 }],
    ];
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-farm-icons.test.ts tests/unit/game-protocol.test.ts`
Expected: FAIL — 3 tests fail (the 8 icons are missing, and `fa` 9 parses as `null`); 15 pass.

- [ ] **Step 3: Implement**

**lib/game/art/farm-icons.ts — edit 1 of 3.** Replace:

```ts

// 16×16 icons for the farm (spec §14): seed sacks in the variety's colour, fertilizer bags with their nutrient on
// the label, pesticide bottles with their pest, and rice sacks (wet/dry). "." transparent, "o" outline, other letters
// from the icon's own palette. Original art.
```

with:

```ts

// 16×16 icons for the farm (spec §14, v15.2 §15): seed sacks in the variety's colour, fertilizer bags with their
// nutrient on the label, pesticide bottles with their pest, rice sacks (wet/dry); hoa-màu seeds, the sickle, the
// sprayer and the hoa màu itself. "." transparent, "o" outline, other letters from the icon's own palette. Original art.
```

**lib/game/art/farm-icons.ts — edit 2 of 3.** Replace:

```ts

export const FARM_ICONS: Record<string, PixelIcon> = {
```

with:

```ts

/** A paper seed packet; "____" rows carry the picture. */
const PACKET = [
  "................",
  "...oooooooooo...",
  "...oPPPPPPPPo...",
  "...oppppppppo...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...o________o...",
  "...oppppppppo...",
  "...oPPPPPPPPo...",
  "...oooooooooo...",
  "................",
];

/** Put an 8-wide picture ("." = the paper) into the packet's "________" rows. */
function packet(picture: readonly string[], ink: Record<string, string>): PixelIcon {
  let i = 0;
  return {
    rows: PACKET.map((row) => (row.includes("________") ? row.replace("________", picture[i++].replace(/\./g, "p")) : row)),
    pal: { p: "#f4efe0", P: "#d8cfb8", ...ink },
  };
}

// v15.2: a tied bundle of three khoai cuttings
const SEED_KHOAI: PixelIcon = {
  rows: [
    "................",
    "...oo.....oo....",
    "..oggo...oGgo...",
    "..oggGo.oGggo...",
    "...oGgGoggGo....",
    "....ogggGgo.....",
    "....oovvvoo.....",
    ".....ovVvo......",
    "....orrrrro.....",
    ".....ovVvo......",
    ".....ovVvo......",
    "....ovvoVvo.....",
    "....ovo.oVo.....",
    "...ovo...oVo....",
    "...oo.....oo....",
    "................",
  ],
  pal: { g: "#6fbf4a", G: "#4f9a38", v: "#8e4a8a", V: "#6e3a6a", r: "#8b5a33" },
};

const TOOL_SICKLE: PixelIcon = {
  rows: [
    "................",
    "......oooo......",
    "....oobbbboo....",
    "...obbeeeebbo...",
    "..obeo....oebo..",
    "..obo......obo..",
    "..oo.......obo..",
    "...........obo..",
    "..........oebo..",
    ".........oebo...",
    "........ohoo....",
    ".......ohHo.....",
    "......ohHo......",
    ".....ohHo.......",
    ".....ooo........",
    "................",
  ],
  pal: { b: "#5a5f68", e: "#e8e8ee", h: "#6e4424", H: "#4a2e18" },
};

const TOOL_SPRAYER: PixelIcon = {
  rows: [
    "................",
    "....oooooo......",
    "...ottttTTo.....",
    "o.otuttttTTo...n",
    "l.otuttttTTo...w",
    "l.otuttttTTo..w.",
    "l.oTTTTTTTTo..w.",
    "l.otttttTTTo..w.",
    "l.otttttTTTo.w..",
    "llotttttTTTo.w..",
    "..otttttTTTohh..",
    "..oTTTTTTTTo....",
    "...oTTTTTTo.....",
    "....oooooo......",
    "................",
    "................",
  ],
  pal: { t: "#3d6fd1", T: "#2f56a6", u: "#6f95e0", l: "#5a5f68", w: "#5a5f68", n: "#e8e8ee", h: "#2a2f3a" },
};

const PRODUCE_KHOAI: PixelIcon = {
  rows: [
    "................",
    "................",
    ".....oooo.......",
    "...ookjkkoo.....",
    "..okkjkkkkKo....",
    "..okkkkkkKKo....",
    "...ooKKKKKo.....",
    ".....ooooo......",
    "........oooo....",
    "......ookjkkoo..",
    ".....okkjkkkkKo.",
    ".....okkkkkkKKo.",
    "......ooKKKKKo..",
    "........ooooo...",
    "................",
    "................",
  ],
  pal: { k: "#b0486e", K: "#7e2f4e", j: "#d77a9a" },
};

const PRODUCE_BAP: PixelIcon = {
  rows: [
    "................",
    "..........oo....",
    ".........oyYo...",
    "........oyYyYo..",
    ".......oyYyYyo..",
    "......oyYyYyo...",
    ".....oyYyYyo....",
    "....oyYyYyo.....",
    "...ogyYyYo......",
    "..ogGgyYo.......",
    ".ogGgGgo........",
    ".oGgGgo.........",
    "..ooGo..........",
    "....o...........",
    "................",
    "................",
  ],
  pal: { y: "#f6c945", Y: "#e0b33c", g: "#8fbf5a", G: "#5f8f3a" },
};

const PRODUCE_OT: PixelIcon = {
  rows: [
    "................",
    "..s.....s....s..",
    ".oso...oso..oso.",
    ".oro...oro..oro.",
    ".orRo..orRo.orRo",
    ".orRo..orRo.orRo",
    ".orRo..orRo.orRo",
    "..orRo.orRo.orRo",
    "..orRo..orRo.oRo",
    "..orRo..orRo.oo.",
    "...orRo.oRo.....",
    "...orRo..oo.....",
    "....oRo.........",
    ".....o..........",
    "................",
    "................",
  ],
  pal: { r: "#d8342a", R: "#a82a22", s: "#4f9a38" },
};

export const FARM_ICONS: Record<string, PixelIcon> = {
```

**lib/game/art/farm-icons.ts — edit 3 of 3.** Replace:

```ts
  rice_dry: riceSack("#f6c945", "#e0b33c", "#e0662f"),
};
```

with:

```ts
  rice_dry: riceSack("#f6c945", "#e0b33c", "#e0662f"),
  // v15.2: hoa-màu seeds (a cob and a chili on paper packets), the two tools and the hoa màu
  seed_khoai: SEED_KHOAI,
  seed_bap: packet(
    ["...gYY..", "..gYyY..", ".gYyYYg.", ".gYYyYg.", ".gYyYYg.", "..gYyY..", "..gYYg..", "...gg..."],
    { Y: "#f6c945", y: "#e0b33c", g: "#8fbf5a" },
  ),
  seed_ot: packet(
    [".....gg.", "....rg..", "....rr..", "...rrR..", "..rrR...", ".rrR....", ".rR.....", "........"],
    { r: "#d8342a", R: "#a82a22", g: "#4f9a38" },
  ),
  tool_sickle: TOOL_SICKLE,
  tool_sprayer: TOOL_SPRAYER,
  produce_khoai: PRODUCE_KHOAI,
  produce_bap: PRODUCE_BAP,
  produce_ot: PRODUCE_OT,
};
```

**lib/game/art/farm-anim.ts — edit 1 of 4.** Replace:

```ts

// The farm animations (v15 spec §12), drawn in world pixels over a character while they play: seedlings, the sickle,
// pumped water, spray mist, fertilizer, a crab, a snail, the hoe. Browser only (canvas). Original art.
```

with:

```ts

// The farm animations (v15 spec §12, v15.2 §15), drawn in world pixels over a character while they play: seedlings,
// the sickle, pumped water, spray mist, fertilizer, a crab, a snail, the hoe, digging tubers and picking into a basket.
// Browser only (canvas). Original art.
```

**lib/game/art/farm-anim.ts — edit 2 of 4.** Replace:

```ts
  granule: "#f4efe0", crab: "#b8432f", crabLight: "#d9776a", shell: "#8a5a2b", shellLight: "#c9955a", egg: "#f29bb5",
  soil: "#6e5230",
};
```

with:

```ts
  granule: "#f4efe0", crab: "#b8432f", crabLight: "#d9776a", shell: "#8a5a2b", shellLight: "#c9955a", egg: "#f29bb5",
  soil: "#6e5230", tuber: "#b0486e", tuberDark: "#7e2f4e", basket: "#c8a46a", basketDark: "#a8844f", hand: "#e8b890",
  corn: "#f6c945", chili: "#d8342a",
};
```

**lib/game/art/farm-anim.ts — edit 3 of 4.** Replace:

```ts
  for (let d = -1; d <= 1; d++) px(c, COL.tie, p.x + d, p.y);
}
```

with:

```ts
  for (let d = -1; d <= 1; d++) px(c, COL.tie, p.x + d, p.y);
}

/** The hoe from the hand, up or down in the ground; returns its head. */
function hoe(c: Ctx, hand: Vec, flip: number, down: boolean): Vec {
  const head = { x: hand.x + 5 * flip, y: hand.y + (down ? 6 : -6) };
  for (let k = 0; k <= 6; k++) px(c, COL.handle, hand.x + ((head.x - hand.x) * k) / 6, hand.y + ((head.y - hand.y) * k) / 6);
  c.fillStyle = COL.blade;
  c.fillRect(Math.round(head.x) - 2, Math.round(head.y), 4, 2);
  px(c, COL.edge, head.x - 2 * flip, head.y + 1);
  return head;
}
```

**lib/game/art/farm-anim.ts — edit 4 of 4.** Replace:

```ts
      const down = beat >= 2;
      const head = { x: hand.x + 5 * flip, y: hand.y + (down ? 6 : -6) };
      for (let k = 0; k <= 6; k++) px(c, COL.handle, hand.x + ((head.x - hand.x) * k) / 6, hand.y + ((head.y - hand.y) * k) / 6);
      c.fillStyle = COL.blade;
      c.fillRect(Math.round(head.x) - 2, Math.round(head.y), 4, 2);
      px(c, COL.edge, head.x - 2 * flip, head.y + 1);
      if (down) for (let k = 0; k < 4; k++) px(c, COL.soil, head.x - 3 + k * 2, head.y - 1 - (k % 2) * 2);
      break;
```

with:

```ts
      const down = beat >= 2;
      const head = hoe(c, hand, flip, down);
      if (down) for (let k = 0; k < 4; k++) px(c, COL.soil, head.x - 3 + k * 2, head.y - 1 - (k % 2) * 2);
      break;
    }
    case FARM_ANIM.dig: {
      // the hoe comes down, and three tubers pop up in front
      const down = beat >= 1;
      hoe(c, hand, flip, down);
      if (down) {
        for (let k = 0; k < 3; k++) {
          const x = g.x - 4 + k * 4, y = g.y - 1 - (reduced ? 1 : (beat + k) % 3);
          px(c, COL.tuber, x, y); px(c, COL.tuber, x + 1, y); px(c, COL.tuberDark, x + 1, y + 1); px(c, COL.soil, x - 1, y + 2);
        }
      }
      break;
    }
    case FARM_ANIM.pick: {
      // a hand reaching into the plants, and a woven basket at the feet filling with yellow and red
      const reach = { x: hand.x + f.x * 4 + (f.x === 0 ? 2 : 0), y: hand.y + f.y * 3 - (reduced ? 0 : beat % 2) };
      c.fillStyle = COL.hand;
      c.fillRect(Math.round(reach.x), Math.round(reach.y), 2, 2);
      px(c, beat % 2 ? COL.chili : COL.corn, reach.x + flip, reach.y - 1);
      const bx = Math.round(feet.x - 9 * flip) - 3, by = Math.round(feet.y) - 3;
      c.fillStyle = COL.basketDark;
      c.fillRect(bx, by, 7, 4);
      c.fillStyle = COL.basket;
      for (let k = 0; k < 7; k += 2) c.fillRect(bx + k, by + 1, 1, 3);
      const fill = reduced ? 3 : 1 + beat;
      for (let k = 0; k < fill; k++) px(c, k % 2 ? COL.chili : COL.corn, bx + 1 + k * 2, by);
      break;
```

**lib/game/net/protocol.ts — edit 1 of 2.** Replace:

```ts
/** Farm animation (v15 spec §12), played for 2.5 s; 0 stops it. */
export type FarmAnim = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export const FARM_ANIM = {
  stop: 0, transplant: 1, harvest: 2, pump: 3, spray: 4, fertilize: 5, crab: 6, snails: 7, prepare: 8,
} as const satisfies Record<string, FarmAnim>;
```

with:

```ts
/** Farm animation (v15 spec §12), played for 2.5 s; 0 stops it. */
export type FarmAnim = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
/** v15.2 adds dig (đào khoai) and pick (bẻ bắp, hái ớt); older clients drop codes they do not know. */
export const FARM_ANIM = {
  stop: 0, transplant: 1, harvest: 2, pump: 3, spray: 4, fertilize: 5, crab: 6, snails: 7, prepare: 8, dig: 9, pick: 10,
} as const satisfies Record<string, FarmAnim>;
```

**lib/game/net/protocol.ts — edit 2 of 2.** Replace:

```ts
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isFarmAnim = (v: unknown): v is FarmAnim => isInt(v) && v >= 0 && v <= 8;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
```

with:

```ts
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isFarmAnim = (v: unknown): v is FarmAnim => isInt(v) && v >= 0 && v <= 10;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 18 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/art/farm-anim.ts lib/game/art/farm-icons.ts lib/game/net/protocol.ts tests/unit/game-farm-icons.test.ts tests/unit/game-protocol.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): icons for the seeds, tools and hoa màu; digging and picking; fa 9 and 10

lib/game/art/farm-icons.ts: a bundle of khoai cuttings, seed packets with a cob and a chili, the sickle, the sprayer,
and the three hoa màu (tubers, a husked cob, chilies). lib/game/art/farm-anim.ts: 9 dig brings the hoe down and pops
three tubers up; 10 pick reaches into the plants and fills a woven basket. lib/game/net/protocol.ts: FarmAnim is 0–10
(R27).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/art/farm-anim.ts lib/game/art/farm-icons.ts lib/game/net/protocol.ts tests/unit/game-farm-icons.test.ts tests/unit/game-protocol.test.ts
git commit -F <message file>
```

---

### Task 13: The field's hooks — harvest rounds, harvesters, pickings, the sprayer and cô Út's hoa màu

**Files:**
- Modify: `hooks/useField.ts`, `hooks/useFarmController.ts`, `components/game/farm/FarmOverlays.tsx` (the work bar shows the job's own line)
- Test: `tests/unit/use-field.test.tsx`, `tests/unit/use-farm-controller.test.tsx`, `tests/unit/farm-overlays.test.tsx` (modify)

**Interfaces:**
- Consumes: Tasks 6–12 (`RPCS_152`, `loadSprayer`, `sellProduce`, `FieldAction`'s new actions, `FieldAnswer.harvestPart` / `picking`, `PartAnswer`, `PART_WAIT_MS`, `HARVESTER_MS`, `NOT_OPEN_152`, `farmErrorMessage(err, itemName, rpc)`, the toasts, `PlotRun`'s round, `uplandOf`, `FARM_ANIM.dig` / `pick`); from v15.1 / the anti-cheat round: `useField`'s `call`, `run`, `plotChanged`, `isMissingRpc`; `useFarmController`'s `act`, `startWork`, `finishWork`, `cancelWork`, the canvas's farm animation and `fp` sends, the prompt clock and the toasts.
- Produces:
  - `useField`: `run(a, itemName?, onError?)` reads a refusal in its RPC's context and hands it to `onError` (the round) instead of the toast; a missing RPC of `RPCS_152` toasts `NOT_OPEN_152` and leaves the field open (R28); `loadSprayer(itemId, itemName?)`, `sellProduce(upland, kg)` update the account part;
  - `useFarmController`: `FarmWork { plot; work; startedAt; text }` (dig or pick for pickings, "🌱 Đang cấy…" / "🌾 Đang gặt…" lines); `FarmRound { plot, part, seed, begunAt, phase: "playing" | "waiting" | "won" | "lost" | "refused", score, result, message }`; `ROUND_FA_MS` 2 000, `HARVESTER_REFETCH_MS` 1 000; `round`, `endRound(pass, score)`, `nextRound()`, `closeRound()`: a round is `begin_work(harvest)`, then `fa 2` every 2 s (R14); a pass is claimed with `harvest_part(true)` `PART_WAIT_MS` after the `begin_work` answer, a fail with `harvest_part(false)` at once, Esc sends nothing; a harvester of mine is fetched `HARVESTER_REFETCH_MS` after its end (retried), with `fp` and `harvesterDoneText` from the wet-stock change (R15); pickings are toasted; lên luống, planting, tending and the other instant actions play their `fa` codes (§12); `loadSprayer(itemId)` and `sellProduce(upland, kg)` with their toasts; leaving the field cancels the work and closes a round;
  - `FarmOverlays`: `WorkProgress` shows `work.text`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/use-field.test.tsx — edit 1 of 3.** Replace:

```tsx
import { clockOffset } from "@/lib/game/farm/clock";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

with:

```tsx
import { clockOffset } from "@/lib/game/farm/clock";
import { NOT_OPEN_152 } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

**tests/unit/use-field.test.tsx — edit 2 of 3.** Replace:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
```

with:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
}));
```

**tests/unit/use-field.test.tsx — edit 3 of 3.** Append at the end of the file, after a blank line:

```tsx
describe("useField, v15.2", () => {
  it("loads the sprayer and sells hoa màu into the field's account part", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.loadSprayer.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 100, tank: { item: "spray_insect", charges: 3 } })! });
    await act(async () => { await result.current.loadSprayer("spray_insect", "Thuốc trừ sâu"); });
    expect(rpc.loadSprayer).toHaveBeenCalledWith("tok", "spray_insect");
    expect(result.current.state?.mine.tank).toEqual({ item: "spray_insect", charges: 3 });
    rpc.sellProduce.mockResolvedValueOnce({ serverNow: NOW, mine: parseFarmMine({ coins: 47_800, produce: {} })! });
    await act(async () => { await result.current.sellProduce("khoai", 180); });
    expect(rpc.sellProduce).toHaveBeenCalledWith("tok", "khoai", 180);
    expect(result.current.state?.mine.coins).toBe(47_800);
  });

  it("reads a harvest round's refusals in its own words, and hands them to the round instead of the toast", async () => {
    const onError = vi.fn(), onRound = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fieldAction.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { await result.current.run({ kind: "harvest_part", plot: 5, success: true }, undefined, onRound); });
    rpc.fieldAction.mockRejectedValueOnce({ message: "not your plot" });
    await act(async () => { await result.current.run({ kind: "harvest_part", plot: 5, success: true }, undefined, onRound); });
    expect(onRound.mock.calls).toEqual([["Chưa xong bó lúa — thử lại sau vài giây."], ["Hết hạn thuê — phần lúa chưa gặt đã mất."]]);
    expect(onError).not.toHaveBeenCalled();
    rpc.fieldAction.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { await result.current.run({ kind: "water", plot: 5, delta: 1 }); });
    expect(onError).toHaveBeenCalledWith("Từ từ thôi…");
  });

  it("says a v15.2 call waits for 0016 and leaves the field open; a missing v15 call still closes it", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fetchFieldState.mockReturnValue(new Promise(() => {})); // the refetches after the errors never answer
    const missing = (fn: string) => ({ code: "PGRST202", message: `Could not find the function public.${fn}` });
    rpc.fieldAction.mockRejectedValueOnce(missing("prepare_beds"));
    await act(async () => { await result.current.run({ kind: "prepare_beds", plot: 5 }); });
    rpc.sellProduce.mockRejectedValueOnce(missing("sell_produce"));
    await act(async () => { await result.current.sellProduce("khoai", 1); });
    expect(onError.mock.calls).toEqual([[NOT_OPEN_152], [NOT_OPEN_152]]);
    expect(result.current.notOpen).toBe(false);
    rpc.fieldAction.mockRejectedValueOnce(missing("prepare_plot"));
    await act(async () => { await result.current.run({ kind: "prepare", plot: 5 }); });
    expect(result.current.notOpen).toBe(true);
  });
});
```

**tests/unit/use-farm-controller.test.tsx — edit 1 of 9.** Replace:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
```

with:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { farmItemFromRow, PART_WAIT_MS, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 9.** Replace:

```tsx
import type { Interactable } from "@/lib/game/maps/types";
```

with:

```tsx
import type { Interactable } from "@/lib/game/maps/types";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/use-farm-controller.test.tsx — edit 3 of 9.** Replace:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
```

with:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
}));
```

**tests/unit/use-farm-controller.test.tsx — edit 4 of 9.** Replace:

```tsx

import { useFarmController, WORK_MS } from "@/hooks/useFarmController";
```

with:

```tsx

import { HARVESTER_REFETCH_MS, ROUND_FA_MS, useFarmController, WORK_MS } from "@/hooks/useFarmController";
```

**tests/unit/use-farm-controller.test.tsx — edit 5 of 9.** Replace:

```tsx
/** Plot 5: my ripe nếp, drained, with brown planthoppers (I have a sickle); plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean } = {}): FieldState => parseFieldState({
  server_now: iso(0),
```

with:

```tsx
/** Plot 5: my ripe nếp, drained, with brown planthoppers (I have a sickle); plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean; crop5?: Record<string, unknown> | null; wet?: number } = {}): FieldState => parseFieldState({
  server_now: iso(0),
```

**tests/unit/use-farm-controller.test.tsx — edit 6 of 9.** Replace:

```tsx
      lease: { source: "village", until: iso(40), price: 250 }, offers: 0,
      crop: {
        variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50),
```

with:

```tsx
      lease: { source: "village", until: iso(40), price: 250 }, offers: 0,
      crop: over.crop5 === null ? null : {
        variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50),
```

**tests/unit/use-farm-controller.test.tsx — edit 7 of 9.** Replace:

```tsx
        log: { water: [{ t: iso(-64), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
```

with:

```tsx
        log: { water: [{ t: iso(-64), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1 },
        ...over.crop5,
      },
```

**tests/unit/use-farm-controller.test.tsx — edit 8 of 9.** Replace:

```tsx
  mine: {
    items: { spray_hopper: 1, tool_sickle: 1 }, rice: { nep: { wet: 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [],
```

with:

```tsx
  mine: {
    items: { spray_hopper: 1, tool_sickle: 1 }, rice: { nep: { wet: over.wet ?? 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [],
```

**tests/unit/use-farm-controller.test.tsx — edit 9 of 9.** Append at the end of the file, after a blank line:

```tsx
describe("useFarmController, v15.2", () => {
  const ROWS = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
  const UPLANDS = ROWS.map(uplandFromRow);
  const seed = (id: string, name: string, upland: string) =>
    farmItemFromRow({ id, kind: "seed", name, price: 800, sort_order: 40, variety: null, fert: null, pest_target: null, capacity: null, upland });
  const BEDS = {
    ...CATALOG, uplands: UPLANDS,
    items: [
      ...CATALOG.items, seed("seed_khoai", "Dây khoai giống", "khoai"), seed("seed_bap", "Hạt bắp giống", "bap"),
      farmItemFromRow({ id: "spray_insect", kind: "pesticide", name: "Thuốc trừ sâu", price: 700, sort_order: 10, variety: null, fert: null, pest_target: "insect", capacity: null }),
    ],
  };
  /** Plot 5 as beds of khoai lang, planted 49 h ago: ripe. */
  const KHOAI5 = {
    kind: "upland", upland: "khoai", variety: null, phase: "ripe", soak_at: null, sow_at: null, transplant_at: null, plant_at: iso(-49),
    pests: [], picking: 1, pickings: 1,
    log: { water: [{ t: iso(-2), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [] },
  };
  const answer = (s: FieldState, over: Record<string, unknown> = {}) => ({ state: s, harvest: null, harvestPart: null, picking: null, ...over });
  const part = (i: number, kg: number) => ({ variety: "nep", kg, parts: i, total: kg * i, done: i === 6 });
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;

  it("plays a harvest round: begin_work, fa 2 every 2 s, and the claim of a pass no earlier than 9 s after the answer", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5 })).toBe(true); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    const use = spot("plot_5");
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(result.current.round).toMatchObject({ plot: 5, part: 1, phase: "playing", score: null });
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(3);
    // won at 5 s: fa 0, then "Đang bó lúa…" until 9 s after the begin_work answer
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    act(() => result.current.endRound(true, 6.5));
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.round).toMatchObject({ phase: "waiting", score: 6.5 });
    rpc.fieldAction.mockResolvedValueOnce(answer(field(), { harvestPart: part(1, 12) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(PART_WAIT_MS - 5000 - 1); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest_part", plot: 5, success: true });
    expect(result.current.round).toMatchObject({ phase: "won", result: part(1, 12) });
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(3);
  });

  it("reports a lost round at once, and Thử lại begins a new one", async () => {
    const { result } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(false, 3.5));
    expect(result.current.round).toMatchObject({ phase: "lost", score: 3.5 });
    await flush();
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest_part", plot: 5, success: false });
    await act(async () => { result.current.nextRound(); await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
    expect(result.current.round).toMatchObject({ phase: "playing", score: null });
  });

  it("sends nothing on Esc, and shows a refused claim in the round's own words", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.closeRound());
    expect(result.current.round).toBeNull();
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    // the lease ran out mid-round: the claim finds the plot gone
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(true, 5));
    rpc.fieldAction.mockRejectedValueOnce({ message: "not your plot" });
    await act(async () => { await vi.advanceTimersByTimeAsync(PART_WAIT_MS); });
    expect(result.current.round).toMatchObject({ phase: "refused", message: "Hết hạn thuê — phần lúa chưa gặt đã mất." });
    expect(toast).not.toHaveBeenCalled();
  });

  it("fetches a harvester of mine 1 s after its end, tells the others and toasts the wet rice it brought", async () => {
    const ends = new Date(Date.parse(iso(0)) + 10_000).toISOString();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: { harvester: { started_at: iso(0), ends_at: ends } } }));
    const { canvas, toast } = setup();
    await flush();
    rpc.fetchFieldState.mockClear();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: null, wet: 50 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000 + HARVESTER_REFETCH_MS - 1); });
    expect(rpc.fetchFieldState).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(toast).toHaveBeenCalledWith("🚜 Máy gặt gặt xong thửa 5: 50 kg nếp (lúa ướt).");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
  });

  it("digs khoai with its own animation and line, then toasts the picking", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(BEDS);
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: KHOAI5 }));
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field({ crop5: KHOAI5 })));
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "harvest" }); });
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.dig);
    expect(result.current.work).toMatchObject({ plot: 5, work: "harvest", text: "🧺 Đang đào khoai thửa 5…" });
    rpc.fieldAction.mockResolvedValueOnce(answer(field({ crop5: null }), { picking: { upland: "khoai", kg: 180, k: 1, pickings: 1, done: true } }));
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest", plot: 5, quality: 1 });
    expect(toast).toHaveBeenCalledWith("🧺 Thu hoạch 180 kg khoai lang — đem bán cho cô Út nhé!");
  });

  it("plays each instant action's animation (§12), and none for the harvester", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(BEDS);
    const { result, canvas, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    const cases: Array<[Parameters<typeof result.current.act>[0], number]> = [
      [{ kind: "prepare_beds", plot: 5 }, FARM_ANIM.prepare],
      [{ kind: "tend", plot: 5, act: "lat_day" }, FARM_ANIM.prepare],
      [{ kind: "plant", plot: 5, item: "seed_khoai" }, FARM_ANIM.transplant],
      [{ kind: "plant", plot: 5, item: "seed_bap" }, FARM_ANIM.fertilize],
    ];
    for (const [a, anim] of cases) {
      await act(async () => { await result.current.act(a); });
      expect(canvas.farmAnim).toHaveBeenLastCalledWith(anim);
    }
    canvas.farmAnim.mockClear();
    await act(async () => { await result.current.act({ kind: "rent_harvester", plot: 5 }, "🚜 Máy gặt đang vào thửa 5 — 30 giây nữa xong."); });
    expect(canvas.farmAnim).not.toHaveBeenCalled();
    expect(canvas.plotChanged).toHaveBeenLastCalledWith(5);
    expect(toast).toHaveBeenLastCalledWith("🚜 Máy gặt đang vào thửa 5 — 30 giây nữa xong.");
  });

  it("loads the sprayer and sells hoa màu, with their toasts", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(BEDS);
    const { result, toast } = setup();
    await flush();
    rpc.loadSprayer.mockResolvedValueOnce({ serverNow: iso(0), mine: parseFarmMine({ items: {}, coins: 1000, gift_claimed: true, tank: { item: "spray_insect", charges: 3 } }) });
    await act(async () => { expect(await result.current.loadSprayer("spray_insect")).toBe(true); });
    expect(rpc.loadSprayer).toHaveBeenCalledWith("tok", "spray_insect");
    expect(toast).toHaveBeenCalledWith("🧴 Đã nạp thuốc trừ sâu vào bình phun — 3 lần xịt.");
    rpc.sellProduce.mockResolvedValueOnce({ serverNow: iso(0), mine: parseFarmMine({ items: {}, coins: 48_700, gift_claimed: true }) });
    await act(async () => { expect(await result.current.sellProduce("khoai", 180)).toBe(true); });
    expect(rpc.sellProduce).toHaveBeenCalledWith("tok", "khoai", 180);
    expect(toast).toHaveBeenCalledWith("💰 Bán 180 kg khoai lang được 47.700 xu.");
  });
});
```

**tests/unit/farm-overlays.test.tsx — edit 1 of 4.** Replace:

```tsx
    state: STATE, catalog: CATALOG, failed: false, notOpen: false, reload: vi.fn(), run: vi.fn(), sellRice: vi.fn(), buyItem: vi.fn(),
    claimGift: vi.fn(), plotChanged: vi.fn(),
  },
  now: NOW, tasks: [], urgent: 0, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), busy: false, work: null, cancelWork: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true), interact: vi.fn(),
  promptText: vi.fn(),
  ...over,
```

with:

```tsx
    state: STATE, catalog: CATALOG, failed: false, notOpen: false, reload: vi.fn(), run: vi.fn(), sellRice: vi.fn(), buyItem: vi.fn(),
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
  },
  now: NOW, tasks: [], urgent: 0, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), busy: false, work: null, cancelWork: vi.fn(),
  round: null, endRound: vi.fn(), nextRound: vi.fn(), closeRound: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
  loadSprayer: vi.fn().mockResolvedValue(true), sellProduce: vi.fn().mockResolvedValue(true), interact: vi.fn(), promptText: vi.fn(),
  ...over,
```

**tests/unit/farm-overlays.test.tsx — edit 2 of 4.** Replace:

```tsx
  it("shows the work progress, cancelled by its button or Esc", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1 } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText("🌾 Đang gặt thửa 5…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
```

with:

```tsx
  it("shows the work progress, cancelled by its button or Esc", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1, text: "🧺 Đang hái ớt thửa 5…" } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText("🧺 Đang hái ớt thửa 5…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
```

**tests/unit/farm-overlays.test.tsx — edit 3 of 4.** Replace:

```tsx
  it("keeps working on an Esc typed into a text field", () => {
    const farm = controller({ work: { plot: 5, work: "transplant", startedAt: 1 } });
    render(<><input aria-label="Chat" /><FarmOverlays farm={farm} me="me" onField /></>);
```

with:

```tsx
  it("keeps working on an Esc typed into a text field", () => {
    const farm = controller({ work: { plot: 5, work: "transplant", startedAt: 1, text: "🌱 Đang cấy thửa 5…" } });
    render(<><input aria-label="Chat" /><FarmOverlays farm={farm} me="me" onField /></>);
```

**tests/unit/farm-overlays.test.tsx — edit 4 of 4.** Replace:

```tsx
  it("keeps working on an Esc that closes another panel", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1 } });
    const { rerender } = render(<FarmOverlays farm={farm} me="me" onField panelOpen />);
```

with:

```tsx
  it("keeps working on an Esc that closes another panel", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1, text: "🧺 Đang hái ớt thửa 5…" } });
    const { rerender } = render(<FarmOverlays farm={farm} me="me" onField panelOpen />);
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-overlays.test.tsx tests/unit/use-farm-controller.test.tsx tests/unit/use-field.test.tsx`
Expected: FAIL — 11 tests fail (`result.current.loadSprayer is not a function`, `result.current.sellProduce is not a function`, `result.current.endRound is not a function`, `result.current.closeRound is not a function`, the refusals still toasted, no `NOT_OPEN_152`, no dig / pick animations, the work bar's old line); 24 pass.

- [ ] **Step 3: Implement**

**hooks/useField.ts — edit 1 of 6.** Replace:

```ts
import { syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc } from "@/lib/game/farm/messages";
import {
  buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice,
  type FieldAction, type FieldAnswer, type MineAnswer,
```

with:

```ts
import { syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc, NOT_OPEN_152 } from "@/lib/game/farm/messages";
import {
  actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, RPCS_152, sellProduce, sellRice,
  type FieldAction, type FieldAnswer, type MineAnswer,
```

**hooks/useField.ts — edit 2 of 6.** Replace:

```ts
  reload: () => Promise<FieldState | null>;
  /** A land, farming or drying action; its answer replaces the state. On error: toast, refetch, null. */
  run: (a: FieldAction, itemName?: string) => Promise<FieldAnswer | null>;
  sellRice: (variety: string, dry: boolean, kg: number) => Promise<MineAnswer | null>;
```

with:

```ts
  reload: () => Promise<FieldState | null>;
  /** A land, farming or drying action; its answer replaces the state. On error: the refusal's text goes to `onError`
   *  (the harvest round shows it) or to the toast; then a refetch, and null. */
  run: (a: FieldAction, itemName?: string, onError?: (text: string) => void) => Promise<FieldAnswer | null>;
  sellRice: (variety: string, dry: boolean, kg: number) => Promise<MineAnswer | null>;
```

**hooks/useField.ts — edit 3 of 6.** Replace:

```ts
  claimGift: () => Promise<(MineAnswer & { gifted: boolean }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

with:

```ts
  claimGift: () => Promise<(MineAnswer & { gifted: boolean }) | null>;
  /** Nạp thuốc: one bottle of the pesticide into the sprayer (v15.2 §7). */
  loadSprayer: (itemId: string, itemName?: string) => Promise<MineAnswer | null>;
  /** Sells kg of a hoa-màu crop to cô Út (v15.2 §9). */
  sellProduce: (upland: string, kg: number) => Promise<MineAnswer | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

**hooks/useField.ts — edit 4 of 6.** Replace:

```ts

  /** Run an RPC and apply its answer. On error: toast, refetch, null. A strike shows no toast: the warning or the ban
   *  modal shows instead (anti-cheat §12.1). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void, itemName?: string): Promise<T | null> => {
    const n = ++seq.current;
```

with:

```ts

  /** Run RPC `rpc` and apply its answer. On error: the Vietnamese text, read in the RPC's context (a harvest round's
   *  refusals read their own way), to `onError` or the toast; then a refetch, and null. A strike shows no text: the
   *  warning or the ban modal shows instead (anti-cheat §12.1). Before 0016 its RPCs are missing while the field is open:
   *  they say NOT_OPEN_152 and leave the field open (v15.2 R28). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void,
    opts: { rpc: string; itemName?: string; onError?: (text: string) => void }): Promise<T | null> => {
    const n = ++seq.current;
```

**hooks/useField.ts — edit 5 of 6.** Replace:

```ts
    } catch (err) {
      if (isMissingRpc(err)) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) onErrorRef.current(farmErrorMessage(err, itemName));
      void reload();
```

with:

```ts
    } catch (err) {
      const missing = isMissingRpc(err), v152 = RPCS_152.has(opts.rpc);
      if (missing && !v152) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) {
        (opts.onError ?? onErrorRef.current)(missing && v152 ? NOT_OPEN_152 : farmErrorMessage(err, opts.itemName, opts.rpc));
      }
      void reload();
```

**hooks/useField.ts — edit 6 of 6.** Replace:

```ts
    state, catalog, failed: fieldFailed || catalogFailed, notOpen, reload, plotChanged,
    run: useCallback((a: FieldAction, itemName?: string) =>
      call(() => fieldAction(roomId, token, a), (n, r) => apply(n, r.state), itemName), [call, apply, roomId, token]),
    sellRice: useCallback((variety: string, dry: boolean, kg: number) =>
      call(() => sellRice(token, variety, dry, kg), applyMine), [call, applyMine, token]),
    buyItem: useCallback((itemId: string, qty: number, itemName?: string) =>
      call(() => buyFarmItem(token, itemId, qty), applyMine, itemName), [call, applyMine, token]),
    claimGift: useCallback(() => call(() => claimFarmGift(token), applyMine), [call, applyMine, token]),
  };
```

with:

```ts
    state, catalog, failed: fieldFailed || catalogFailed, notOpen, reload, plotChanged,
    run: useCallback((a: FieldAction, itemName?: string, onError?: (text: string) => void) =>
      call(() => fieldAction(roomId, token, a), (n, r) => apply(n, r.state), { rpc: actionCall(a)[0], itemName, onError }),
    [call, apply, roomId, token]),
    sellRice: useCallback((variety: string, dry: boolean, kg: number) =>
      call(() => sellRice(token, variety, dry, kg), applyMine, { rpc: "sell_rice" }), [call, applyMine, token]),
    buyItem: useCallback((itemId: string, qty: number, itemName?: string) =>
      call(() => buyFarmItem(token, itemId, qty), applyMine, { rpc: "buy_farm_item", itemName }), [call, applyMine, token]),
    claimGift: useCallback(() => call(() => claimFarmGift(token), applyMine, { rpc: "claim_farm_gift" }), [call, applyMine, token]),
    loadSprayer: useCallback((itemId: string, itemName?: string) =>
      call(() => loadSprayer(token, itemId), applyMine, { rpc: "load_sprayer", itemName }), [call, applyMine, token]),
    sellProduce: useCallback((upland: string, kg: number) =>
      call(() => sellProduce(token, upland, kg), applyMine, { rpc: "sell_produce" }), [call, applyMine, token]),
  };
```

**hooks/useFarmController.ts — edit 1 of 19.** Replace:

```ts
import { plotDraws } from "@/lib/game/art/crops";
import { dueTasks, plotPrompt, type FarmTask, type PlotRun } from "@/lib/game/farm/actions";
import { ricePrice } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
import { boughtText, GIFT_TEXT, harvestText, NOT_OPEN, riceSaleText } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import { getMap } from "@/lib/game/maps/registry";
```

with:

```ts
import { plotDraws } from "@/lib/game/art/crops";
import { dueTasks, lower, plotPrompt, type FarmTask, type PlotRun } from "@/lib/game/farm/actions";
import { PART_WAIT_MS, producePrice, ricePrice, type FarmCatalog } from "@/lib/game/farm/catalog";
import { serverNow } from "@/lib/game/farm/clock";
import {
  boughtText, GIFT_TEXT, harvestText, harvesterDoneText, loadedText, NOT_OPEN, pickingText, produceSaleText, riceSaleText,
} from "@/lib/game/farm/messages";
import type { FieldAction, PartAnswer } from "@/lib/game/farm/rpc";
import type { PlotView } from "@/lib/game/farm/state";
import { getMap } from "@/lib/game/maps/registry";
```

**hooks/useFarmController.ts — edit 2 of 19.** Replace:

```ts

/** Transplanting or harvesting in progress: movement is locked until it is sent or cancelled (spec §16). */
export interface FarmWork { plot: number; work: "transplant" | "harvest"; startedAt: number }
```

with:

```ts

/** A 3-second job in progress (transplanting, setting out the ớt, a hoa-màu picking): movement is locked until it is
 *  sent or cancelled (spec §16). `text` is the bar's line. */
export interface FarmWork { plot: number; work: "transplant" | "harvest"; startedAt: number; text: string }

/** A rice harvest round (v15.2 §6.2): HarvestGame plays it, the controller talks to the server. */
export interface FarmRound {
  plot: number;
  /** The part this round cuts, 1–6. */
  part: number;
  /** Seeds the round's sweet bands. */
  seed: number;
  /** When the begin_work answer arrived (client ms): a won round is claimed PART_WAIT_MS after it. */
  begunAt: number;
  /** playing → waiting (the 9 s, "Đang bó lúa…") → won; or lost; or refused by the server. */
  phase: "playing" | "waiting" | "won" | "lost" | "refused";
  /** The round's score once it is over. */
  score: number | null;
  /** The part won. */
  result: PartAnswer | null;
  /** A refusal's text (read in the round's context). */
  message: string | null;
}
```

**hooks/useFarmController.ts — edit 3 of 19.** Replace:

```ts
  cancelWork: () => void;
  /** A land, farming or drying action (a work action starts the progress); `done` is toasted when it succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
```

with:

```ts
  cancelWork: () => void;
  /** A harvest round, open in its overlay. */
  round: FarmRound | null;
  /** The overlay's round ended: a pass is claimed at 9 s, a fail is reported at once. */
  endRound: (pass: boolean, score: number) => void;
  /** "Gặt tiếp" or "Thử lại": a new round on the same plot (a new begin_work). */
  nextRound: () => void;
  /** "Nghỉ tay", "Đóng" or Esc: the overlay closes and nothing is sent. */
  closeRound: () => void;
  /** A land, farming or drying action (a work action starts the progress, a round opens HarvestGame); `done` is toasted
   *  when it succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
```

**hooks/useFarmController.ts — edit 4 of 19.** Replace:

```ts
  sell: (variety: string, dry: boolean, kg: number) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
```

with:

```ts
  sell: (variety: string, dry: boolean, kg: number) => Promise<boolean>;
  loadSprayer: (itemId: string) => Promise<boolean>;
  sellProduce: (upland: string, kg: number) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
```

**hooks/useFarmController.ts — edit 5 of 19.** Replace:

```ts
export const WORK_MS = 3000;
/** How often the clock ticks while on the field. */
const TICK_MS = 30_000;
/** The animation each instant action plays (the work actions play theirs while they run). */
const ANIM: Partial<Record<FieldAction["kind"], FarmAnim>> = {
  prepare: FARM_ANIM.prepare, water: FARM_ANIM.pump, spray: FARM_ANIM.spray, fertilize: FARM_ANIM.fertilize,
  pick_snails: FARM_ANIM.snails,
};
```

with:

```ts
export const WORK_MS = 3000;
/** A harvest round re-sends `fa 2` this often while it runs (an `fa` lasts 2.5 s; v15.2 R14). */
export const ROUND_FA_MS = 2000;
/** A harvester of mine is fetched this long after its end, on the server's clock (R15), and again after
 *  HARVESTER_RETRY_MS while it still shows, at most HARVESTER_TRIES times. */
export const HARVESTER_REFETCH_MS = 1000;
const HARVESTER_RETRY_MS = 2000;
const HARVESTER_TRIES = 3;
/** How often the clock ticks while on the field. */
const TICK_MS = 30_000;
/** The animation each instant action plays (the work actions and the rounds play theirs while they run; v15.2 §12). */
const ANIM: Partial<Record<FieldAction["kind"], FarmAnim>> = {
  prepare: FARM_ANIM.prepare, prepare_beds: FARM_ANIM.prepare, tend: FARM_ANIM.prepare, water: FARM_ANIM.pump, spray: FARM_ANIM.spray,
  fertilize: FARM_ANIM.fertilize, pick_snails: FARM_ANIM.snails,
};
```

**hooks/useFarmController.ts — edit 6 of 19.** Replace:

```ts

/** Everything farming for the game shell (spec §7–§8, §12–§13): the field, the clock, the prompts, the panels, the
 *  due tasks and the plots on the canvas, the newcomer gift, the actions with their animations (`fa`) and the others'
 *  refetch (`fp`), and the transplant / harvest progress. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
```

with:

```ts

/** A round is being played or waits for its claim: no other job or round starts. */
const roundOn = (r: FarmRound | null): boolean => r !== null && (r.phase === "playing" || r.phase === "waiting");
/** The round showing is still `r` (not closed or replaced meanwhile). */
const sameRound = (showing: FarmRound | null, r: FarmRound): boolean => showing?.plot === r.plot && showing.begunAt === r.begunAt;

/** Planting: cuttings are set like seedlings (1); seed is sown (5) — gieo bắp, ươm ớt. */
function plantAnim(catalog: FarmCatalog | null, item: string): FarmAnim {
  const upland = catalog?.items.find((i) => i.id === item)?.upland;
  return catalog?.uplands.find((u) => u.id === upland)?.method === "cutting" ? FARM_ANIM.transplant : FARM_ANIM.fertilize;
}

/** A 3-second job's animation and bar line: rice is transplanted; on beds the ớt is set out and the crops are dug or
 *  picked by their config. */
function workLook(p: PlotView | undefined, catalog: FarmCatalog | null, w: FarmWork["work"], plot: number): { anim: FarmAnim; text: string } {
  const u = p?.crop?.kind === "upland" ? catalog?.uplands.find((x) => x.id === p.crop!.upland) : undefined;
  if (u && w === "harvest") return { anim: u.harvestAnim === "dig" ? FARM_ANIM.dig : FARM_ANIM.pick, text: `🧺 Đang ${lower(u.harvestLabel)} thửa ${plot}…` };
  if (u) return { anim: FARM_ANIM.transplant, text: `🌱 Đang ${lower(u.transplantLabel ?? "Trồng cây con")} thửa ${plot}…` };
  return w === "transplant"
    ? { anim: FARM_ANIM.transplant, text: `🌱 Đang cấy thửa ${plot}…` }
    : { anim: FARM_ANIM.harvest, text: `🌾 Đang gặt thửa ${plot}…` };
}

/** Everything farming for the game shell (spec §7–§8, §12–§13; v15.2 §6, §12–§13): the field, the clock, the prompts,
 *  the panels, the due tasks and the plots on the canvas, the newcomer gift, the actions with their animations (`fa`)
 *  and the others' refetch (`fp`), the 3-second jobs, the harvest rounds and the end of my harvesters. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
```

**hooks/useFarmController.ts — edit 7 of 19.** Replace:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

with:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

**hooks/useFarmController.ts — edit 8 of 19.** Replace:

```ts
  const [work, setWork] = useState<FarmWork | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen };
  });
```

with:

```ts
  const [work, setWork] = useState<FarmWork | null>(null);
  const [round, setRound] = useState<FarmRound | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen, round };
  });
```

**hooks/useFarmController.ts — edit 9 of 19.** Replace:

```ts

  // --- transplanting and harvesting: begin_work, the progress (movement locked), then the action with q = 1.0
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

with:

```ts

  // --- 3-second jobs: begin_work, the progress (movement locked), then the action with q = 1.0
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

**hooks/useFarmController.ts — edit 10 of 19.** Replace:

```ts
  }, []);
  const finishWork = useCallback(async (plot: number, w: FarmWork["work"]) => {
    const r = await run({ kind: w, plot, quality: 1 });
```

with:

```ts
  }, []);
  const finishWork = useCallback(async (plot: number, w: FarmWork["work"], done?: string) => {
    const r = await run({ kind: w, plot, quality: 1 });
```

**hooks/useFarmController.ts — edit 11 of 19.** Replace:

```ts
    canvas()?.plotChanged(plot);
    if (r.harvest) {
      const name = live.current.catalog?.varieties.find((v) => v.id === r.harvest!.variety)?.name ?? r.harvest.variety;
      live.current.toast(harvestText(r.harvest.kg, name));
    }
  }, [run, canvas]);
  const startWork = useCallback(async (plot: number, w: FarmWork["work"]): Promise<boolean> => {
    if (workTimer.current) return false;
    setBusy(true);
```

with:

```ts
    canvas()?.plotChanged(plot);
    const cat = live.current.catalog;
    if (r.picking) {
      const u = cat?.uplands.find((x) => x.id === r.picking!.upland);
      live.current.toast(pickingText(r.picking.kg, u?.name ?? r.picking.upland, r.picking.k, r.picking.pickings));
    } else if (r.harvest) {
      // a whole rice harvest: a database without 0016
      const name = cat?.varieties.find((v) => v.id === r.harvest!.variety)?.name ?? r.harvest.variety;
      live.current.toast(harvestText(r.harvest.kg, name));
    } else if (done) {
      live.current.toast(done);
    }
  }, [run, canvas]);
  const startWork = useCallback(async (plot: number, w: FarmWork["work"], done?: string): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
    setBusy(true);
```

**hooks/useFarmController.ts — edit 12 of 19.** Replace:

```ts
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    c?.farmAnim(w === "transplant" ? FARM_ANIM.transplant : FARM_ANIM.harvest);
    setPanel(null);
    setWork({ plot, work: w, startedAt: Date.now() });
    workTimer.current = setTimeout(() => {
      workTimer.current = null;
      void finishWork(plot, w);
    }, WORK_MS);
```

with:

```ts
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    const look = workLook(begun.state.plots.find((p) => p.no === plot), live.current.catalog, w, plot);
    c?.farmAnim(look.anim);
    setPanel(null);
    setWork({ plot, work: w, startedAt: Date.now(), text: look.text });
    workTimer.current = setTimeout(() => {
      workTimer.current = null;
      void finishWork(plot, w, done);
    }, WORK_MS);
```

**hooks/useFarmController.ts — edit 13 of 19.** Replace:

```ts
  }, [canvas]);
  useEffect(() => {
    if (!active) cancelWork();
  }, [active, cancelWork]);
```

with:

```ts
  }, [canvas]);

  // --- harvest rounds (v15.2 §6.2): begin_work, the game with fa 2 every 2 s, then harvest_part — a pass 9 s after the
  // begin_work answer, a fail at once. Esc sends nothing: the server's record expires or the next begin_work replaces it.
  const roundAnim = useRef<ReturnType<typeof setInterval> | null>(null);
  const roundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRoundAnim = useCallback(() => {
    if (!roundAnim.current) return;
    clearInterval(roundAnim.current);
    roundAnim.current = null;
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);
  useEffect(() => () => {
    if (roundAnim.current) clearInterval(roundAnim.current);
    if (roundTimer.current) clearTimeout(roundTimer.current);
  }, []);
  const startRound = useCallback(async (plot: number): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
    setBusy(true);
    const begun = await run({ kind: "begin_work", plot, work: "harvest" });
    setBusy(false);
    if (!begun) return false;
    const c = canvas();
    const spot = getMap("field").interactables.find((i) => i.plot === plot);
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    c?.farmAnim(FARM_ANIM.harvest);
    if (roundAnim.current) clearInterval(roundAnim.current);
    roundAnim.current = setInterval(() => canvas()?.farmAnim(FARM_ANIM.harvest), ROUND_FA_MS);
    setPanel(null);
    const parts = begun.state.plots.find((p) => p.no === plot)?.crop?.parts ?? 0;
    setRound({
      plot, part: parts + 1, seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), phase: "playing", score: null,
      result: null, message: null,
    });
    return true;
  }, [run, canvas]);
  const claimPart = useCallback(async (r: FarmRound) => {
    let refusal: string | null = null;
    const ans = await run({ kind: "harvest_part", plot: r.plot, success: true }, undefined, (text) => { refusal = text; });
    if (!sameRound(live.current.round, r)) return;
    if (!ans) {
      // a strike shows its modal instead of a text
      setRound(refusal === null ? null : { ...r, phase: "refused", message: refusal });
      return;
    }
    canvas()?.plotChanged(r.plot);
    setRound({ ...r, phase: "won", result: ans.harvestPart });
  }, [run, canvas]);
  const endRound = useCallback((pass: boolean, score: number) => {
    const r = live.current.round;
    if (!r || r.phase !== "playing") return;
    stopRoundAnim();
    if (!pass) {
      setRound({ ...r, phase: "lost", score });
      // reported at once, with no gate: it clears the server's record and cuts nothing (R7)
      void run({ kind: "harvest_part", plot: r.plot, success: false }, undefined, () => {});
      return;
    }
    const waiting: FarmRound = { ...r, phase: "waiting", score };
    setRound(waiting);
    roundTimer.current = setTimeout(() => {
      roundTimer.current = null;
      void claimPart(waiting);
    }, Math.max(0, r.begunAt + PART_WAIT_MS - Date.now()));
  }, [run, stopRoundAnim, claimPart]);
  const nextRound = useCallback(() => {
    const r = live.current.round;
    if (r && !roundOn(r)) void startRound(r.plot);
  }, [startRound]);
  const closeRound = useCallback(() => {
    if (roundTimer.current) clearTimeout(roundTimer.current);
    roundTimer.current = null;
    stopRoundAnim();
    setRound(null);
  }, [stopRoundAnim]);
  useEffect(() => {
    if (active) return;
    cancelWork();
    // leaving the field ends a round too (in a task, as the change of map has rendered)
    const t = setTimeout(closeRound, 0);
    return () => clearTimeout(t);
  }, [active, cancelWork, closeRound]);

  // --- my harvesters (R15): fetched at the end + 1 s, then fp, and a toast with the wet rice they brought
  const harvesterTries = useRef(new Map<string, number>());
  const harvesterEnded = useCallback(async (plot: number, variety: string, key: string) => {
    harvesterTries.current.set(key, (harvesterTries.current.get(key) ?? 0) + 1);
    const before = live.current.state?.mine.rice[variety]?.wet ?? 0;
    const s = await reload();
    if (!s || s.plots.find((p) => p.no === plot)?.crop?.harvester) return;
    canvas()?.plotChanged(plot);
    const got = (s.mine.rice[variety]?.wet ?? 0) - before;
    const name = live.current.catalog?.varieties.find((v) => v.id === variety)?.name ?? variety;
    if (got > 0) live.current.toast(harvesterDoneText(plot, got, name));
  }, [reload, canvas]);
  useEffect(() => {
    if (!active || !state) return;
    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (const p of state.plots) {
      const job = p.crop?.harvester;
      if (!job || p.farmer?.id !== accountId) continue;
      const key = `${p.no}:${job.endsAt}`;
      const tries = harvesterTries.current.get(key) ?? 0;
      if (tries >= HARVESTER_TRIES) continue;
      const wait = tries === 0 ? job.endsAt + HARVESTER_REFETCH_MS - serverNow() : HARVESTER_RETRY_MS;
      const variety = p.crop!.variety ?? "";
      timers.push(setTimeout(() => void harvesterEnded(p.no, variety, key), Math.max(0, wait)));
    }
    return () => timers.forEach(clearTimeout);
  }, [active, state, accountId, harvesterEnded]);
```

**hooks/useFarmController.ts — edit 14 of 19.** Replace:

```ts
  const act = useCallback(async (a: PlotRun, done?: string): Promise<boolean> => {
    if (a.kind === "work") return startWork(a.plot, a.work);
    // a harvest round (v15.2 §6.2) has its own overlay and flow (Tasks 13 and 14)
    if (a.kind === "round") return false;
    setBusy(true);
```

with:

```ts
  const act = useCallback(async (a: PlotRun, done?: string): Promise<boolean> => {
    if (a.kind === "work") return startWork(a.plot, a.work, done);
    if (a.kind === "round") return startRound(a.plot);
    setBusy(true);
```

**hooks/useFarmController.ts — edit 15 of 19.** Replace:

```ts
      const c = canvas();
      const anim = ANIM[a.kind];
      if (anim) c?.farmAnim(anim);
```

with:

```ts
      const c = canvas();
      const anim = a.kind === "plant" ? plantAnim(live.current.catalog, a.item) : ANIM[a.kind];
      if (anim) c?.farmAnim(anim);
```

**hooks/useFarmController.ts — edit 16 of 19.** Replace:

```ts
    }
  }, [run, canvas, startWork]);
  const buy = useCallback(async (itemId: string, qty: number): Promise<boolean> => {
```

with:

```ts
    }
  }, [run, canvas, startWork, startRound]);
  const buy = useCallback(async (itemId: string, qty: number): Promise<boolean> => {
```

**hooks/useFarmController.ts — edit 17 of 19.** Replace:

```ts
  }, [sellRice]);
```

with:

```ts
  }, [sellRice]);
  const { loadSprayer: loadTank, sellProduce: sellCrop } = data;
  const loadSprayer = useCallback(async (itemId: string): Promise<boolean> => {
    setBusy(true);
    try {
      const name = live.current.catalog?.items.find((i) => i.id === itemId)?.name ?? itemId;
      const r = await loadTank(itemId, name);
      if (r) live.current.toast(loadedText(name));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [loadTank]);
  const sellProduce = useCallback(async (upland: string, kg: number): Promise<boolean> => {
    setBusy(true);
    try {
      const before = live.current.state?.mine.coins ?? 0;
      const u = live.current.catalog?.uplands.find((x) => x.id === upland);
      const r = await sellCrop(upland, kg);
      if (r) live.current.toast(produceSaleText(kg, u?.name ?? upland, u ? producePrice(kg, u) : r.mine.coins - before));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [sellCrop]);
```

**hooks/useFarmController.ts — edit 18 of 19.** Replace:

```ts
    cancelWork,
    act,
```

with:

```ts
    cancelWork,
    round,
    endRound,
    nextRound,
    closeRound,
    act,
```

**hooks/useFarmController.ts — edit 19 of 19.** Replace:

```ts
    sell,
    interact,
```

with:

```ts
    sell,
    loadSprayer,
    sellProduce,
    interact,
```

**components/game/farm/FarmOverlays.tsx — edit 1 of 2.** Replace:

```tsx

/** Transplanting or harvesting: a bar that fills in WORK_MS, and "Huỷ" (or Esc) before it is sent. An Esc typed into a
 *  text field, or one that closes an open panel, is not for the work (v13/v14 input rules). */
function WorkProgress({ work, panelOpen, onCancel }: { work: FarmWork; panelOpen: boolean; onCancel: () => void }) {
```

with:

```tsx

/** A 3-second job (transplanting, setting out the ớt, a picking): its line, a bar that fills in WORK_MS, and "Huỷ" (or
 *  Esc) before it is sent. An Esc typed into a text field, or one that closes an open panel, is not for the work (v13/v14
 *  input rules). */
function WorkProgress({ work, panelOpen, onCancel }: { work: FarmWork; panelOpen: boolean; onCancel: () => void }) {
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 2.** Replace:

```tsx
    <div className="pch absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 p-2 font-vt text-xl" role="status">
      <span>{work.work === "transplant" ? `🌱 Đang cấy thửa ${work.plot}…` : `🌾 Đang gặt thửa ${work.plot}…`}</span>
      <div className="h-3 w-48 overflow-hidden rounded-sm bg-ink/20">
```

with:

```tsx
    <div className="pch absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 p-2 font-vt text-xl" role="status">
      <span>{work.text}</span>
      <div className="h-3 w-48 overflow-hidden rounded-sm bg-ink/20">
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (3 files, 35 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/farm/FarmOverlays.tsx hooks/useFarmController.ts hooks/useField.ts tests/unit/farm-overlays.test.tsx tests/unit/use-farm-controller.test.tsx tests/unit/use-field.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the field's hooks — harvest rounds, harvesters, pickings, the sprayer and cô Út's hoa màu

hooks/useField.ts: loadSprayer and sellProduce; a refusal reads in its RPC's context and can go to the harvest round
instead of the toast; before 0016 its RPCs say NOT_OPEN_152 and leave the field open (R28).
hooks/useFarmController.ts: a round is begin_work, then HarvestGame with fa 2 every 2 s (R14), a pass claimed with
harvest_part(true) 9 s after the begin_work answer, a fail reported at once, Esc sending nothing; a harvester of mine is
fetched 1 s after its end, with fp and a toast of the wet rice it brought (R15); the 3-second jobs play dig or pick and
carry their own line; pickings are toasted; planting, lên luống and the hand jobs play their animations (§12).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/farm/FarmOverlays.tsx hooks/useFarmController.ts hooks/useField.ts tests/unit/farm-overlays.test.tsx tests/unit/use-farm-controller.test.tsx tests/unit/use-field.test.tsx
git commit -F <message file>
```

---

### Task 14: HarvestGame — the sickle's round on screen

**Files:**
- Create: `components/game/farm/HarvestGame.tsx`
- Modify: `components/game/farm/FarmOverlays.tsx` (opens HarvestGame for the controller's round), `lib/game/overlays.ts` (`OpenOverlays.farmRound` blocks the canvas input), `components/game/GameShell.tsx` (passes `farmRound`)
- Test: `tests/unit/farm-harvest-game.test.tsx` (create), `tests/unit/farm-overlays.test.tsx`, `tests/unit/game-overlays.test.ts` (modify)

**Interfaces:**
- Consumes: Task 10's `HARVEST`, `HARVEST_MARK`, `createHarvestRound`, `stepHarvestRound`, `scoreText`; Task 13's `FarmRound`, `endRound`, `nextRound`, `closeRound`; Task 8's `partText`, `partsDoneText`; Task 6's `HARVEST_PARTS`; from v14: `isTyping` (`lib/game/keys.ts`, the typing guard); `lib/game/overlays.ts`'s `OpenOverlays` / `overlayLocks` (the anti-cheat fix round).
- Produces:
  - `HarvestGame.tsx` (§13.2): `HARVEST_HELP`; `HarvestGame({ round, busy, panelOpen, varietyName, onEnd, onNext, onClose })` — a dialog "🌾 Gặt thửa N · phần k/6", the help, the power bar (`role="progressbar"`, "Lực liềm") with its green band, "Bó i/8 · x điểm" and the marks; holding Space, the mouse button or a finger over the whole block charges the bar (a rAF loop; the typing guard; a blur lets go); "Đang bó lúa…" while a pass waits out its 9 s (no buttons, Esc ignored); the part won with "Gặt tiếp phần k+1" and "Nghỉ tay", or the whole harvest with "Đóng"; a lost round's "❌ Được x/8 điểm — cần 4. Thử lại ngay nhé!" with "Thử lại" and "Nghỉ tay"; the server's refusals in the round's words; "Huỷ (Esc)" sends nothing;
  - `overlays.ts`: `OpenOverlays.farmRound`, and `overlayLocks` blocks the canvas while a round is open.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-harvest-game.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import HarvestGame, { HARVEST_HELP } from "@/components/game/farm/HarvestGame";
import type { FarmRound } from "@/hooks/useFarmController";
import { createHarvestRound } from "@/lib/game/farm/minigames";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const round = (over: Partial<FarmRound> = {}): FarmRound => ({
  plot: 3, part: 2, seed: 11, begunAt: 1, phase: "playing", score: null, result: null, message: null, ...over,
});
function show(r: FarmRound, over: { panelOpen?: boolean; busy?: boolean } = {}) {
  const props = { onEnd: vi.fn(), onNext: vi.fn(), onClose: vi.fn() };
  render(<HarvestGame round={r} busy={over.busy ?? false} panelOpen={over.panelOpen ?? false} varietyName="Nếp" {...props} />);
  return props;
}
/** Frames of 16 ms for `ms`. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const space = (type: "keyDown" | "keyUp", target: Window | Element = window) => fireEvent[type](target, { code: "Space", key: " " });

describe("HarvestGame", () => {
  it("shows the part, the help, the bundle and the points", () => {
    show(round());
    expect(screen.getByRole("heading", { name: "🌾 Gặt thửa 3 · phần 2/6" })).toBeInTheDocument();
    expect(screen.getByText(HARVEST_HELP)).toBeInTheDocument();
    expect(screen.getByText(/Bó 1\/8 · 0 điểm/)).toBeInTheDocument();
  });

  it("cuts with Space: let go in the green band for Chuẩn", () => {
    show(round());
    const c = createHarvestRound(11).centres[0];
    run(16);
    space("keyDown");
    run(16 + Math.round(c * 1200));
    space("keyUp");
    run(32);
    expect(screen.getByText(/Bó 2\/8 · 1 điểm/)).toBeInTheDocument();
    expect(screen.getByText(/Chuẩn!/)).toBeInTheDocument();
  });

  it("cuts with a held mouse button or finger; a tap cuts too early (sót hạt)", () => {
    show(round());
    const bar = screen.getByRole("progressbar", { name: "Lực liềm" });
    run(16);
    fireEvent.pointerDown(bar);
    run(48);
    fireEvent.pointerUp(bar);
    run(32);
    expect(screen.getByText(/Lệch — sót hạt/)).toBeInTheDocument();
  });

  it("ignores Space typed into a text field", () => {
    render(<input aria-label="Chat" />);
    show(round());
    run(16);
    space("keyDown", screen.getByRole("textbox", { name: "Chat" }));
    run(2000);
    expect(screen.getByText(/Bó 1\/8 · 0 điểm/)).toBeInTheDocument();
  });

  it("reports the round's end once: eight taps score 0 and fail", () => {
    const { onEnd } = show(round());
    for (let i = 0; i < 8; i++) {
      run(16);
      space("keyDown");
      run(32);
      space("keyUp");
      run(400);
    }
    run(400);
    expect(onEnd.mock.calls).toEqual([[false, 0]]);
  });

  it("closes on Esc or Huỷ and sends nothing; an Esc for another overlay is not its own", () => {
    const { onClose, onEnd } = show(round());
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Huỷ (Esc)" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onEnd).not.toHaveBeenCalled();
    cleanup();
    const other = show(round(), { panelOpen: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(other.onClose).not.toHaveBeenCalled();
  });

  it("waits out the 9 s bundling the rice, without a way out", () => {
    const { onClose } = show(round({ phase: "waiting", score: 5 }));
    expect(screen.getByText("Đang bó lúa…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says the part won, with Gặt tiếp and Nghỉ tay", () => {
    const { onNext, onClose } = show(round({ phase: "won", score: 6, result: { variety: "nep", kg: 13, parts: 2, total: 25, done: false } }));
    expect(screen.getByText("✅ Xong phần 2/6: 13 kg lúa.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gặt tiếp phần 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Nghỉ tay" }));
    expect([onNext.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 1]);
  });

  it("says a failed round's score, printed with a comma, with Thử lại", () => {
    const { onNext } = show(round({ phase: "lost", score: 3.5 }));
    expect(screen.getByText("❌ Được 3,5/8 điểm — cần 4. Thử lại ngay nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusals in the round's words, and waits while busy", () => {
    show(round({ phase: "refused", score: 5, message: "Chưa xong bó lúa — thử lại sau vài giây." }), { busy: true });
    expect(screen.getByText("Chưa xong bó lúa — thử lại sau vài giây.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeDisabled();
    cleanup();
    show(round({ phase: "refused", score: 5, message: "Hết hạn thuê — phần lúa chưa gặt đã mất." }));
    expect(screen.getByText("Hết hạn thuê — phần lúa chưa gặt đã mất.")).toBeInTheDocument();
  });
});
```

**tests/unit/farm-overlays.test.tsx — edit 1 of 2.** Replace:

```tsx
import FarmOverlays from "@/components/game/farm/FarmOverlays";
import type { FarmController } from "@/hooks/useFarmController";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
```

with:

```tsx
import FarmOverlays from "@/components/game/farm/FarmOverlays";
import type { FarmController, FarmRound } from "@/hooks/useFarmController";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
```

**tests/unit/farm-overlays.test.tsx — edit 2 of 2.** Append at the end of the file, after a blank line:

```tsx
describe("FarmOverlays, a harvest round", () => {
  const round = (over: Partial<FarmRound> = {}): FarmRound => ({
    plot: 5, part: 2, seed: 7, begunAt: 1, phase: "playing", score: null, result: null, message: null, ...over,
  });

  it("opens HarvestGame for the round, with the harvest's variety for its last line", () => {
    const farm = controller({ round: round({ phase: "won", result: { variety: "nep", kg: 13, parts: 6, total: 75, done: true } }) });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("dialog", { name: "Gặt thửa 5" })).toBeInTheDocument();
    expect(screen.getByText("🌾 Gặt xong thửa 5: tổng 75 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(farm.closeRound).toHaveBeenCalledTimes(1);
  });
});
```

**tests/unit/game-overlays.test.ts — edit 1 of 2.** Replace:

```ts

const none = { panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false };
```

with:

```ts

const none = {
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
};
```

**tests/unit/game-overlays.test.ts — edit 2 of 2.** Replace:

```ts

  it("takes only the canvas input for the field's own panel and the farm work, whose Esc the field handles", () => {
    expect(overlayLocks({ ...none, farmPanel: true })).toEqual({ blocking: true, panelOpen: false });
    expect(overlayLocks({ ...none, farmWork: true })).toEqual({ blocking: true, panelOpen: false });
  });
```

with:

```ts

  it("takes only the canvas input for the field's own panel, the farm work and a harvest round, whose Esc the field handles", () => {
    expect(overlayLocks({ ...none, farmPanel: true })).toEqual({ blocking: true, panelOpen: false });
    expect(overlayLocks({ ...none, farmWork: true })).toEqual({ blocking: true, panelOpen: false });
    expect(overlayLocks({ ...none, farmRound: true })).toEqual({ blocking: true, panelOpen: false });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-harvest-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/game-overlays.test.ts`
Expected: FAIL — `tests/unit/farm-harvest-game.test.tsx` does not load (`Failed to resolve import "@/components/game/farm/HarvestGame"`), `FarmOverlays` shows no "Gặt thửa 5" dialog, and a round does not block the canvas; 8 tests pass.

- [ ] **Step 3: Implement**

Create `components/game/farm/HarvestGame.tsx` with exactly:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { FarmRound } from "@/hooks/useFarmController";
import { HARVEST_PARTS } from "@/lib/game/farm/catalog";
import { partsDoneText, partText } from "@/lib/game/farm/messages";
import { createHarvestRound, HARVEST, HARVEST_MARK, scoreText, stepHarvestRound, type HarvestRound } from "@/lib/game/farm/minigames";
import { isTyping } from "@/lib/game/keys";

export const HARVEST_HELP = "Giữ Space (hoặc giữ chuột, giữ ngón tay) cho lực liềm lên — thả khi vạch nằm trong vùng xanh.";

/** The sickle's power bar: the được zone, the chuẩn band, the bar and the last cut. */
function PowerBar({ s }: { s: HarvestRound }) {
  const bundle = Math.min(s.bundle, HARVEST.bundles - 1);
  const c = s.centres[bundle];
  const last = s.beatMs > 0 ? s.cuts[s.cuts.length - 1] : undefined;
  const pct = (x: number) => `${Math.max(0, Math.min(1, x)) * 100}%`;
  return (
    <div className="relative h-7 w-64 max-w-full overflow-hidden rounded-sm border-2 border-ink bg-parchment-300" role="progressbar"
      aria-label="Lực liềm" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.level * 100)}>
      <div className="absolute inset-y-0 bg-[#9bd07f]/60" style={{ left: pct(c - HARVEST.near), width: pct(2 * HARVEST.near) }} />
      <div className="absolute inset-y-0 bg-[#4caf50]" style={{ left: pct(c - HARVEST.band / 2), width: pct(HARVEST.band) }} />
      <div className="absolute inset-y-1 left-0 bg-[#e0b33c]/90" style={{ width: pct(s.level) }} />
      {last && <div className="absolute inset-y-0 w-0.5 bg-burgundy" style={{ left: pct(last.level) }} />}
    </div>
  );
}

/** The round itself (v15.2 §6.2): a seeded HarvestRound stepped every frame; the sickle is Space, a mouse button or a
 *  finger held down. Its end goes to `onEnd` once. */
function Playing({ round, onEnd }: { round: FarmRound; onEnd: (pass: boolean, score: number) => void }) {
  const [s, setS] = useState(() => createHarvestRound(round.seed));
  const holding = useRef(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    let cur = createHarvestRound(round.seed);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepHarvestRound(cur, Math.max(0, t - last) / 1000, holding.current);
      last = t;
      setS(cur);
      if (cur.outcome) {
        onEndRef.current(cur.outcome === "pass", cur.score);
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [round.seed]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault();
      holding.current = true;
    };
    // A release always lets go: a hold never sticks when focus moved into a text field.
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

  const hold = (on: boolean) => () => { holding.current = on; };
  const last = s.beatMs > 0 ? s.cuts[s.cuts.length - 1] : undefined;
  return (
    // the whole block takes a held mouse button or finger
    <div className="flex w-full touch-none select-none flex-col items-center gap-2 py-1"
      onPointerDown={hold(true)} onPointerUp={hold(false)} onPointerCancel={hold(false)} onPointerLeave={hold(false)}>
      <PowerBar s={s} />
      <p aria-live="polite">
        Bó {Math.min(s.bundle + 1, HARVEST.bundles)}/{HARVEST.bundles} · {scoreText(s.score)} điểm
        {last && <b className={last.score === 0 ? "text-burgundy" : undefined}> · {HARVEST_MARK[last.mark]}</b>}
      </p>
      <p className="text-base opacity-80">{HARVEST_HELP}</p>
    </div>
  );
}

/** HarvestGame (v15.2 §13.2): the round, "Đang bó lúa…" while a pass waits out its 9 s, then the part won, a failed
 *  round's score or the server's refusal. Esc or "Huỷ" closes it and sends nothing; an Esc typed into a text field, or
 *  one for another open overlay, is not its own. */
export default function HarvestGame({ round, busy, panelOpen, varietyName, onEnd, onNext, onClose }: {
  round: FarmRound;
  busy: boolean;
  panelOpen: boolean;
  /** The plot's variety, for the harvest's last line. */
  varietyName: string;
  onEnd: (pass: boolean, score: number) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (panelOpen || round.phase === "waiting") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, round.phase, onClose]);

  const done = round.phase === "won" && round.result?.done === true;
  const button = (label: string, onClick: () => void, primary = false) => (
    <button type="button" className={`pch-btn${primary ? " pch-btn-primary" : ""}`} disabled={busy} onClick={onClick}>{label}</button>
  );
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true"
      aria-label={`Gặt thửa ${round.plot}`}>
      <div className="pch flex w-80 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">🌾 Gặt thửa {round.plot} · phần {round.part}/{HARVEST_PARTS}</h2>
        {round.phase === "playing" && (
          <>
            <Playing round={round} onEnd={onEnd} />
            {button("Huỷ (Esc)", onClose)}
          </>
        )}
        {round.phase === "waiting" && <p role="status">Đang bó lúa…</p>}
        {round.phase === "won" && (
          <>
            <p role="status">
              {done
                ? partsDoneText(round.plot, round.result!.total, varietyName)
                : partText(round.part, round.result?.kg ?? 0)}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {done ? button("Đóng", onClose, true) : (
                <>
                  {button(`Gặt tiếp phần ${round.part + 1}`, onNext, true)}
                  {button("Nghỉ tay", onClose)}
                </>
              )}
            </div>
          </>
        )}
        {(round.phase === "lost" || round.phase === "refused") && (
          <>
            <p role="status" className="text-burgundy">
              {round.phase === "lost"
                ? `❌ Được ${scoreText(round.score ?? 0)}/${HARVEST.bundles} điểm — cần ${HARVEST.pass}. Thử lại ngay nhé!`
                : round.message}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {button("Thử lại", onNext, true)}
              {button("Nghỉ tay", onClose)}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

**components/game/farm/FarmOverlays.tsx — edit 1 of 4.** Replace:

```tsx
import Handbook from "./Handbook";
import PlotPanel from "./PlotPanel";
```

with:

```tsx
import Handbook from "./Handbook";
import HarvestGame from "./HarvestGame";
import PlotPanel from "./PlotPanel";
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 4.** Replace:

```tsx

/** The field on top of the world (spec §13): the banner before the migration, the work progress and the field's
 *  panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

with:

```tsx

/** The field on top of the world (spec §13): the banner before the migration, the work progress, a harvest round
 *  (v15.2 §13.2) and the field's panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

**components/game/farm/FarmOverlays.tsx — edit 3 of 4.** Replace:

```tsx
  const act = (a: Parameters<FarmController["act"]>[0], done?: string) => void farm.act(a, done);
  return (
```

with:

```tsx
  const act = (a: Parameters<FarmController["act"]>[0], done?: string) => void farm.act(a, done);
  const round = farm.round;
  const variety = round?.result?.variety ?? state?.plots.find((p) => p.no === round?.plot)?.crop?.variety ?? null;
  const varietyName = catalog?.varieties.find((v) => v.id === variety)?.name ?? variety ?? "";
  return (
```

**components/game/farm/FarmOverlays.tsx — edit 4 of 4.** Replace:

```tsx
        <WorkProgress key={farm.work.startedAt} work={farm.work} panelOpen={panelOpen || panel !== null} onCancel={farm.cancelWork} />
      )}
```

with:

```tsx
        <WorkProgress key={farm.work.startedAt} work={farm.work} panelOpen={panelOpen || panel !== null} onCancel={farm.cancelWork} />
      )}
      {round && (
        // a new round (Gặt tiếp, Thử lại) starts a new game
        <HarvestGame key={round.begunAt} round={round} busy={busy} panelOpen={panelOpen || panel !== null} varietyName={varietyName}
          onEnd={farm.endRound} onNext={farm.nextRound} onClose={farm.closeRound} />
      )}
```

**lib/game/overlays.ts — edit 1 of 2.** Replace:

```ts
  farmPanel: boolean;
  /** Transplanting or harvesting is under way. */
  farmWork: boolean;
}
```

with:

```ts
  farmPanel: boolean;
  /** A 3-second job (transplanting, a picking) is under way. */
  farmWork: boolean;
  /** A harvest round (HarvestGame) is open (v15.2 §6.2): the avatar stays at the plot. */
  farmRound: boolean;
}
```

**lib/game/overlays.ts — edit 2 of 2.** Replace:

```ts
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal;
  return { blocking: panelOpen || o.farmPanel || o.farmWork, panelOpen };
}
```

with:

```ts
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound, panelOpen };
}
```

**components/game/GameShell.tsx.** Replace:

```tsx
    panel: panel !== null, fishingPanel: fishing.panel !== null, creating, anticheatModal: anticheat.modal !== null,
    farmPanel: farm.panel !== null, farmWork: farm.work !== null,
  });
```

with:

```tsx
    panel: panel !== null, fishingPanel: fishing.panel !== null, creating, anticheatModal: anticheat.modal !== null,
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null,
  });
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (3 files, 20 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/HarvestGame.tsx lib/game/overlays.ts tests/unit/farm-harvest-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/game-overlays.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): HarvestGame — the sickle's round on screen

components/game/farm/HarvestGame.tsx (§13.2): the part, the help, the power bar with its green band, "Bó i/8 · 3,5
điểm" and the marks; Space, a held mouse button or a finger, with the typing guard; "Đang bó lúa…" while a pass waits
out its 9 s; the part won with Gặt tiếp and Nghỉ tay, or the whole harvest with Đóng; a failed round's score with Thử
lại; the server's refusals in the round's words. Esc or Huỷ sends nothing. FarmOverlays opens it for the controller's
round, and lib/game/overlays.ts takes the canvas's input while it is open (the shell passes farmRound).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/HarvestGame.tsx lib/game/overlays.ts tests/unit/farm-harvest-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/game-overlays.test.ts
git commit -F <message file>
```

---

### Task 15: The plot panel for beds, cut rice and the harvester; the handbook's new tabs

**Files:**
- Modify: `components/game/farm/PlotPanel.tsx`, `components/game/farm/Handbook.tsx`, `components/game/farm/FarmOverlays.tsx` (the handbook gets the crops and items), `hooks/useFarmController.ts` (the clock ticks every second while a harvester runs)
- Test: `tests/unit/farm-plot-panel.test.tsx`, `tests/unit/use-farm-controller.test.tsx` (modify)

**Interfaces:**
- Consumes: Tasks 6–9 and 13 (`plotActions` with the catalog and my stock, `uplandOf`, `harvesterOn`, the `upland.ts` estimates, `upPhase`, `rotFromAt`, `BED_WATER_NAME`, `bedLevelsText`, `uplandPhaseName`, `handbookTabs`, `handbookPage(tab, varieties, uplands, items)`, `handbookTabFor`, `HARVESTER_PART_PRICE`, `durationText`); from v15.1: `PlotPanel`'s land section, `ConfirmButton`, `Handbook({ varieties, initial, onClose })`, `useFarmController`'s `TICK_MS` clock.
- Produces:
  - `PlotPanel.tsx` (§13.1): the done toasts gain "Đã lên luống — đất Ẩm, sẵn sàng trồng." and "Đã {label}." for fertilizing, spraying, planting, tending and setting out; rice shows its ripening countdown, "🌾 Đã gặt n/6 phần (kg kg)" on a partly cut plot, a running harvester's "🚜 Máy gặt đang gặt — còn N giây", and ripe rice points to the co-op ("🚜 Hoặc thuê máy gặt ở Hợp tác xã: 30 giây, 500 xu mỗi phần còn lại."); beds show "🌱 Luống đã lên — chưa trồng gì.", the crop and its stage, "💧 Đất: X · cần Y", excess N, "⚠️ Đất úng — củ đang thối!", the pests and my estimate for this picking and the season; the handbook link names the crop's tab or Nông cụ;
  - `Handbook({ varieties, uplands = [], items = [], initial, onClose })`: the tabs of `handbookTabs(uplands)`;
  - `useFarmController`: `MACHINE_TICK_MS` 1 000 — the clock ticks every second while any harvester runs on the field, else every `TICK_MS`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-plot-panel.test.tsx — edit 1 of 2.** Replace:

```tsx
import PlotPanel from "@/components/game/farm/PlotPanel";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

with:

```tsx
import PlotPanel from "@/components/game/farm/PlotPanel";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/farm-plot-panel.test.tsx — edit 2 of 2.** Append at the end of the file, after a blank line:

```tsx
describe("PlotPanel, v15.2", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const BEDS: FarmCatalog = {
    ...CATALOG, uplands: UPLANDS,
    items: [
      ...CATALOG.items, item("seed_khoai", "seed", "Dây khoai giống", { upland: "khoai" }),
      item("spray_insect", "pesticide", "Thuốc trừ sâu", { pest_target: "insect" }), item("fert_potash", "fertilizer", "Phân kali", { fert: "potash" }),
    ],
  };
  const LOG = { fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [] };
  /** Plot 5, mine, with `crop`; the rest as STATE has them. */
  const withCrop = (crop: Record<string, unknown> | null, items: Record<string, number> = {}): FieldState => parseFieldState({
    server_now: iso(0),
    plots: [bare(5, "village", { farmer: ME, lease: { source: "village", until: iso(80), price: 250 }, crop })],
    drying: [],
    mine: { items, rice: {}, coins: 10_000, gift_claimed: true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [] },
  })!;
  const beds = (over: Record<string, unknown>) => ({
    kind: "upland", variety: null, upland: null, phase: "prepared", prepared_at: iso(-30), water: 1, water_set_at: iso(-1), pests: [],
    excess_n: false, ripe: false, rotted_at: null, picking: 0, pickings: 0, log: { ...LOG, water: [{ t: iso(-1), l: 1 }] }, ...over,
  });
  function show(state: FieldState, catalog: FarmCatalog = BEDS) {
    const onAct = vi.fn(), onOpenHandbook = vi.fn();
    render(<PlotPanel no={5} state={state} catalog={catalog} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
      onOpenHandbook={onOpenHandbook} onReload={() => {}} onClose={() => {}} />);
    return { onAct, onOpenHandbook };
  }
  const li = (text: string) => screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === text);

  it("offers the two ways to làm đất on a bare plot, with their toasts", () => {
    const { onAct } = show(withCrop(null));
    expect(screen.getByText("Cày bừa, cho nước ngập ruộng — để cấy lúa.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lên luống trồng màu" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "prepare_beds", plot: 5 }, "Đã lên luống — đất Ẩm, sẵn sàng trồng.");
    fireEvent.click(screen.getByRole("button", { name: "Làm ruộng lúa" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "prepare", plot: 5 }, "Đã làm đất — ruộng ngập nước.");
  });

  it("shows bare beds and plants a seed I hold", () => {
    const { onAct } = show(withCrop(beds({}), { seed_khoai: 1 }));
    expect(li("🌱 Luống đã lên — chưa trồng gì.")).toBeInTheDocument();
    expect(li("💧 Đất: Ẩm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trồng dây khoai" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "plant", plot: 5, item: "seed_khoai" }, "Đã trồng dây khoai.");
  });

  it("shows khoai's stage, the soil, the rot and the estimate; lật dây is toasted; the handbook opens at Khoai lang", () => {
    // planted 25 h ago; Đẫm since an hour ago (rot from 22 h)
    const crop = beds({
      upland: "khoai", phase: "tuber", plant_at: iso(-25), picking: 1, pickings: 1, water: 2,
      log: { ...LOG, water: [{ t: iso(-25), l: 1 }, { t: iso(-1), l: 2 }] },
    });
    const { onAct, onOpenHandbook } = show(withCrop(crop));
    expect(li("🌱 Khoai lang · Tượng củ — giai đoạn sau: còn 11 giờ")).toBeInTheDocument();
    expect(li("💧 Đất: Đẫm · cần Khô–Ẩm")).toBeInTheDocument();
    expect(li("⚠️ Đất úng — củ đang thối!")).toBeInTheDocument();
    expect(screen.getByText(/^⚖️ Ước tính: ~\d+ kg \(chưa tính sâu bệnh chưa tới\)$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lật dây" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "tend", plot: 5, act: "lat_day" }, "Đã lật dây.");
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Khoai lang" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("khoai");
  });

  it("gives ớt's estimate per picking and for the season", () => {
    const crop = beds({
      upland: "ot", phase: "ripe", sow_at: iso(-60), plant_at: iso(-48), picking: 1, pickings: 3, log: { ...LOG, water: [{ t: iso(-2), l: 1 }] },
    });
    show(withCrop(crop));
    expect(screen.getByText(/^⚖️ Ước tính: lứa này ~\d+ kg · cả vụ ~\d+ kg \(chưa tính sâu bệnh chưa tới\)$/)).toBeInTheDocument();
  });

  const RIPE = {
    variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50), water: 1,
    water_set_at: iso(-3), pests: [], excess_n: false, ripe: true, rotted_at: null,
    log: { water: [{ t: iso(-64), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, harvested_kg: 25 },
  };

  it("points ripe rice to the sickle and the co-op's harvester", () => {
    const { onAct, onOpenHandbook } = show(withCrop(RIPE, { tool_sickle: 1 }));
    expect(li("🚜 Hoặc thuê máy gặt ở Hợp tác xã: 30 giây, 500 xu mỗi phần còn lại.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gặt bằng liềm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "round", plot: 5 }, undefined);
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Nông cụ" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("tools");
  });

  it("shows a partly cut plot with only Gặt tiếp and Bỏ vụ", () => {
    show(withCrop({ ...RIPE, parts: 2 }, { tool_sickle: 1 }));
    expect(li("🌾 Đã gặt 2/6 phần (25 kg)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^(Gặt|Bỏ)/ }).map((b) => b.textContent)).toEqual(["Gặt tiếp (phần 3/6)", "Bỏ vụ"]);
  });

  it("counts a running harvester down, with no buttons", () => {
    show(withCrop({ ...RIPE, parts: 2, harvester: { started_at: iso(0), ends_at: new Date(NOW + 25_000).toISOString() } }, { tool_sickle: 1 }));
    expect(li("🚜 Máy gặt đang gặt — còn 25 giây")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Gặt|Bỏ vụ|Bơm|Tháo)/ })).toBeNull();
  });
});

describe("Handbook, v15.2", () => {
  it("adds a tab per hoa-màu crop and Nông cụ", () => {
    const uplands = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
    render(<Handbook varieties={[nep]} uplands={uplands} items={CATALOG.items} initial="khoai" onClose={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(
      ["Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo", "Khoai lang", "Bắp", "Ớt", "Nông cụ"]);
    expect(screen.getByRole("tab", { name: "Khoai lang" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/^Cách trồng khoai lang/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Nông cụ" }));
    expect(screen.getByRole("tab", { name: "Nông cụ" })).toHaveAttribute("aria-selected", "true");
  });
});
```

**tests/unit/use-farm-controller.test.tsx.** Append at the end of the file, after a blank line:

```tsx
describe("useFarmController, the clock while a harvester runs", () => {
  it("ticks every second, so the tasks count the harvester down", async () => {
    const ends = new Date(Date.parse(iso(0)) + 10_000).toISOString();
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: { harvester: { started_at: iso(0), ends_at: ends } } }));
    const { result } = setup();
    await flush();
    expect(result.current.tasks.map((t) => t.text)).toContain("Thửa 5 · Máy gặt đang gặt — còn 10 giây");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.tasks.map((t) => t.text)).toContain("Thửa 5 · Máy gặt đang gặt — còn 9 giây");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-plot-panel.test.tsx tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — 9 tests fail (the panel's v15.2 texts and estimates, the Handbook's new tabs, and the task list still counting a harvester down every 30 s); 23 pass.

- [ ] **Step 3: Implement**

**components/game/farm/PlotPanel.tsx — edit 1 of 7.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { lower, plotActions, type PlotAction, type PlotRun } from "@/lib/game/farm/actions";
import { PLOT_PRICE, RENT_PRICE, type FarmCatalog } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, nextPhaseAt, waterAt, wantedWater, yieldEstimate } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookTabFor, type HandbookTab } from "@/lib/game/farm/handbook";
import type { LandCtx } from "@/lib/game/farm/land";
import { durationText, PEST_NAME, PEST_REMEDY, PHASE_NAME, WATER_NAME } from "@/lib/game/farm/messages";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { lower, plotActions, uplandOf, type PlotAction, type PlotRun } from "@/lib/game/farm/actions";
import { HARVEST_PARTS, PLOT_PRICE, RENT_PRICE, type FarmCatalog } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, nextPhaseAt, waterAt, wantedWater, yieldEstimate } from "@/lib/game/farm/crop";
import { handbookTabFor, handbookTabs, type HandbookTab } from "@/lib/game/farm/handbook";
import type { LandCtx } from "@/lib/game/farm/land";
import {
  BED_WATER_NAME, bedLevelsText, durationText, PEST_NAME, PEST_REMEDY, PHASE_NAME, uplandPhaseName, WATER_NAME,
} from "@/lib/game/farm/messages";
import type { CropView, FieldState, PlotView } from "@/lib/game/farm/state";
import {
  rotFromAt, upEstimate, uplandModel, upNext, upNextPhaseAt, upPhase, upSeasonEstimate, upWantedWater,
} from "@/lib/game/farm/upland";
import { formatXu } from "@/lib/game/fishing/catalog";
```

**components/game/farm/PlotPanel.tsx — edit 2 of 7.** Replace:

```tsx
const DONE: Record<string, string> = {
  prepare: "Đã làm đất — ruộng ngập nước.", soak: "Đang ngâm giống — 2 giờ nữa là nứt nanh.", sow: "Đã gieo mạ.",
  pick: "Đã bắt ốc bươu vàng.", abandon: "Đã bỏ vụ.",
};
const doneText = (a: PlotAction): string | undefined =>
  DONE[a.key.split(":")[0]] ?? (a.key.startsWith("fert:") || a.key.startsWith("spray:") ? `Đã ${lower(a.label)}.` : undefined);

function Status({ p, me, catalog, now }: { p: PlotView; me: string; catalog: FarmCatalog; now: number }) {
  const crop = p.crop;
  if (!crop) return <p>Ruộng còn gốc rạ — chưa làm đất.</p>;
  const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
```

with:

```tsx
const DONE: Record<string, string> = {
  prepare: "Đã làm đất — ruộng ngập nước.", prepare_beds: "Đã lên luống — đất Ẩm, sẵn sàng trồng.",
  soak: "Đang ngâm giống — 2 giờ nữa là nứt nanh.", sow: "Đã gieo mạ.", pick: "Đã bắt ốc bươu vàng.", abandon: "Đã bỏ vụ.",
};
/** The actions toasted by their own button: "Đã bón phân urê.", "Đã trồng dây khoai.", "Đã lật dây." (v15.2 §13.6). */
const BY_LABEL: ReadonlySet<string> = new Set(["fert", "spray", "plant", "tend", "set_out"]);
const doneText = (a: PlotAction): string | undefined => {
  const key = a.key.split(":")[0];
  return DONE[key] ?? (BY_LABEL.has(key) ? `Đã ${lower(a.label)}.` : undefined);
};

function Pests({ crop, catalog }: { crop: CropView; catalog: FarmCatalog }) {
  const remedy = (id: string | null) => (id ? catalog.items.find((i) => i.id === id)?.name ?? id : "Bắt ốc bằng tay");
  return crop.pests.map((x) => (
    <li key={`${x.kind}:${x.since}`} className={x.treatedAt === null ? "text-burgundy" : "opacity-80"}>
      {x.treatedAt === null ? `❗ ${PEST_NAME[x.kind]} — ${remedy(PEST_REMEDY[x.kind])}` : `✓ Đã trị ${PEST_NAME[x.kind].toLowerCase()}`}
    </li>
  ));
}

/** A running harvester's countdown (the panel's clock ticks every second meanwhile). */
const harvesterLine = (crop: CropView, now: number): string | null =>
  crop.harvester && now < crop.harvester.endsAt ? `🚜 Máy gặt đang gặt — còn ${Math.ceil((crop.harvester.endsAt - now) / 1000)} giây` : null;

function RiceStatus({ p, me, catalog, now }: { p: PlotView; me: string; catalog: FarmCatalog; now: number }) {
  const crop = p.crop!;
  const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
```

**components/game/farm/PlotPanel.tsx — edit 3 of 7.** Replace:

```tsx
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
```

with:

```tsx
  const estimate = farmer && v && crop.soakAt !== null ? yieldEstimate(c, v, p.kind === "private" ? 1.1 : 1, crop.pests, now).kg : null;
  const machine = harvesterLine(crop, now);
  const cut = crop.parts > 0 && crop.parts < HARVEST_PARTS;
  return (
    <ul className="flex flex-col gap-0.5">
      {machine && <li><b>{machine}</b></li>}
      {cut && !machine && <li>🌾 Đã gặt {crop.parts}/{HARVEST_PARTS} phần{crop.log ? ` (${crop.log.harvestedKg} kg)` : ""}</li>}
      <li>🌱 {v ? v.name : "Chưa ngâm giống"} · <b>{PHASE_NAME[phase]}</b>{next !== null && next > now ? ` — giai đoạn sau: còn ${durationText(next - now)}` : ""}</li>
      <li>💧 Nước: <b>{WATER_NAME[water]}</b>{want ? ` · cần ${want.label}` : ""}</li>
      <Pests crop={crop} catalog={catalog} />
      {crop.excessN && <li className="text-burgundy">⚠️ Dư đạm — sâu bệnh dễ tới, lúa dễ đổ.</li>}
```

**components/game/farm/PlotPanel.tsx — edit 4 of 7.** Replace:

```tsx
      {estimate !== null && <li>⚖️ Ước tính: ~{estimate} kg (chưa tính sâu bệnh chưa tới)</li>}
    </ul>
```

with:

```tsx
      {estimate !== null && <li>⚖️ Ước tính: ~{estimate} kg (chưa tính sâu bệnh chưa tới)</li>}
      {farmer && !machine && (phase === "ripe" || phase === "overripe") && (
        <li className="opacity-80">🚜 Hoặc thuê máy gặt ở Hợp tác xã: 30 giây, 500 xu mỗi phần còn lại.</li>
      )}
    </ul>
  );
}

/** Raised beds (v15.2 §13.1): the crop and its stage, the soil's water, the pests, excess N, rot, and my estimate. */
function BedStatus({ p, me, catalog, now }: { p: PlotView; me: string; catalog: FarmCatalog; now: number }) {
  const crop = p.crop!;
  const u = uplandOf(crop, catalog);
  const c = uplandModel(crop);
  const water = crop.log ? waterAt(c.water, now) : crop.water;
  if (!u) {
    return (
      <ul className="flex flex-col gap-0.5">
        <li>🌱 Luống đã lên — chưa trồng gì.</li>
        <li>💧 Đất: <b>{BED_WATER_NAME[water]}</b></li>
      </ul>
    );
  }
  const phase = upPhase(c, u, now);
  const next = upNextPhaseAt(c, u, now);
  const want = upWantedWater(c, u, now);
  const rotFrom = rotFromAt(c, u);
  const land = p.kind === "private" ? 1.1 : 1;
  const k = c.plantAt === null ? 1 : upNext(c, u, now);
  const farmer = p.farmer?.id === me && crop.log !== null;
  const one = farmer && k > 0 ? upEstimate(c, u, land, k, crop.pests, now).kg : null;
  const season = farmer && k > 0 ? upSeasonEstimate(c, u, land, crop.pests, now) : null;
  return (
    <ul className="flex flex-col gap-0.5">
      <li>🌱 {u.name} · <b>{uplandPhaseName(u, phase)}</b>{next !== null && next > now ? ` — giai đoạn sau: còn ${durationText(next - now)}` : ""}</li>
      <li>💧 Đất: <b>{BED_WATER_NAME[water]}</b>{want ? ` · cần ${bedLevelsText(want)}` : ""}</li>
      <Pests crop={crop} catalog={catalog} />
      {crop.excessN && <li className="text-burgundy">⚠️ Dư đạm — mất 10%, sâu bệnh dễ tới.</li>}
      {rotFrom !== null && now >= rotFrom && water >= 2 && <li className="text-burgundy">⚠️ Đất úng — củ đang thối!</li>}
      {one !== null && season !== null && (
        <li>
          ⚖️ Ước tính: {u.pickings.length > 1 ? `lứa này ~${one} kg · cả vụ ~${season} kg` : `~${season} kg`} (chưa tính sâu bệnh chưa tới)
        </li>
      )}
    </ul>
```

**components/game/farm/PlotPanel.tsx — edit 5 of 7.** Replace:

```tsx

/** 🌾 Thửa N (spec §13.2): the crop's status, what I can do on it now (disabled buttons say why), the land actions,
 *  and a link to the handbook tab that matters. */
export default function PlotPanel({ no, state, catalog, failed, me, busy, now, onAct, onOpenHandbook, onReload, onClose }: {
```

with:

```tsx

/** 🌾 Thửa N (spec §13.2, v15.2 §13.1): the crop's status (rice or beds, the parts cut, a harvester at work), what I can
 *  do on it now (disabled buttons say why), the land actions, and a link to the handbook tab that matters. */
export default function PlotPanel({ no, state, catalog, failed, me, busy, now, onAct, onOpenHandbook, onReload, onClose }: {
```

**components/game/farm/PlotPanel.tsx — edit 6 of 7.** Replace:

```tsx
            </p>
            <Status p={p} me={me} catalog={catalog} now={now} />
            <ul className="flex flex-col gap-1">
```

with:

```tsx
            </p>
            {!p.crop ? (
              <p>Ruộng còn gốc rạ — chưa làm đất.</p>
            ) : p.crop.kind === "upland" ? (
              <BedStatus p={p} me={me} catalog={catalog} now={now} />
            ) : (
              <RiceStatus p={p} me={me} catalog={catalog} now={now} />
            )}
            <ul className="flex flex-col gap-1">
```

**components/game/farm/PlotPanel.tsx — edit 7 of 7.** Replace:

```tsx
            <button type="button" className="pch-btn self-start" onClick={() => onOpenHandbook(tab)}>
              📖 Sổ tay: {HANDBOOK_TABS.find(([id]) => id === tab)?.[1]}
            </button>
```

with:

```tsx
            <button type="button" className="pch-btn self-start" onClick={() => onOpenHandbook(tab)}>
              📖 Sổ tay: {handbookTabs(catalog.uplands).find(([id]) => id === tab)?.[1]}
            </button>
```

**components/game/farm/Handbook.tsx — edit 1 of 3.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import type { Variety } from "@/lib/game/farm/catalog";
import { HANDBOOK_TABS, handbookPage, type HandbookTab } from "@/lib/game/farm/handbook";

const isTab = (t: string | null): t is HandbookTab => HANDBOOK_TABS.some(([id]) => id === t);

/** 📖 Sổ tay nhà nông (spec §8.9): six tabs; `initial` opens one (e.g. the plot panel's link). */
export default function Handbook({ varieties, initial, onClose }: { varieties: readonly Variety[]; initial: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<HandbookTab>(isTab(initial) ? initial : "process");
  return (
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import type { FarmItem, UplandCrop, Variety } from "@/lib/game/farm/catalog";
import { handbookPage, handbookTabs, type HandbookTab } from "@/lib/game/farm/handbook";

/** 📖 Sổ tay nhà nông (spec §8.9, v15.2 §14): the six rice tabs, a tab per hoa-màu crop and Nông cụ; `initial` opens one
 *  (e.g. the plot panel's link). The crops' tabs are worked out from their config; `items` name the fertilizers and
 *  pesticides there. */
export default function Handbook({ varieties, uplands = [], items = [], initial, onClose }: {
  varieties: readonly Variety[];
  uplands?: readonly UplandCrop[];
  items?: readonly FarmItem[];
  initial: string | null;
  onClose: () => void;
}) {
  const tabs = handbookTabs(uplands);
  const [tab, setTab] = useState<HandbookTab>(tabs.some(([id]) => id === initial) ? initial! : "process");
  return (
```

**components/game/farm/Handbook.tsx — edit 2 of 3.** Replace:

```tsx
        <div role="tablist" aria-label="Sổ tay nhà nông" className="flex flex-wrap gap-1">
          {HANDBOOK_TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
```

with:

```tsx
        <div role="tablist" aria-label="Sổ tay nhà nông" className="flex flex-wrap gap-1">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
```

**components/game/farm/Handbook.tsx — edit 3 of 3.** Replace:

```tsx
        <div role="tabpanel" className="flex flex-col gap-2">
          {handbookPage(tab, varieties).map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
```

with:

```tsx
        <div role="tabpanel" className="flex flex-col gap-2">
          {handbookPage(tab, varieties, uplands, items).map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
```

**components/game/farm/FarmOverlays.tsx.** Replace:

```tsx
      )}
      {panel?.kind === "handbook" && <Handbook varieties={catalog?.varieties ?? []} initial={panel.tab} onClose={closePanel} />}
      {panel?.kind === "tasks" && (
```

with:

```tsx
      )}
      {panel?.kind === "handbook" && (
        <Handbook varieties={catalog?.varieties ?? []} uplands={catalog?.uplands ?? []} items={catalog?.items ?? []} initial={panel.tab}
          onClose={closePanel} />
      )}
      {panel?.kind === "tasks" && (
```

**hooks/useFarmController.ts — edit 1 of 4.** Replace:

```ts
const HARVESTER_TRIES = 3;
/** How often the clock ticks while on the field. */
const TICK_MS = 30_000;
/** The animation each instant action plays (the work actions and the rounds play theirs while they run; v15.2 §12). */
```

with:

```ts
const HARVESTER_TRIES = 3;
/** How often the clock ticks while on the field, and while a harvester runs there (its countdowns, v15.2 §13.1, §13.3). */
const TICK_MS = 30_000;
const MACHINE_TICK_MS = 1000;
/** The animation each instant action plays (the work actions and the rounds play theirs while they run; v15.2 §12). */
```

**hooks/useFarmController.ts — edit 2 of 4.** Replace:

```ts

  // --- the clock: an answer carries the server's time, and a tick moves it on while I am on the field
  const [tick, setTick] = useState(0);
  useEffect(() => {
```

with:

```ts

  // --- the clock: an answer carries the server's time, and a tick moves it on while I am on the field — every second
  //     while a harvester runs there
  const [tick, setTick] = useState(0);
  const now = Math.max(tick, state?.serverNow ?? 0);
  const machine = state?.plots.some((p) => p.crop?.harvester && p.crop.harvester.endsAt > now) ?? false;
  useEffect(() => {
```

**hooks/useFarmController.ts — edit 3 of 4.** Replace:

```ts
    const first = setTimeout(beat, 0);
    const timer = setInterval(beat, TICK_MS);
    return () => {
```

with:

```ts
    const first = setTimeout(beat, 0);
    const timer = setInterval(beat, machine ? MACHINE_TICK_MS : TICK_MS);
    return () => {
```

**hooks/useFarmController.ts — edit 4 of 4.** Replace:

```ts
    };
  }, [active]);
  const now = Math.max(tick, state?.serverNow ?? 0);
```

with:

```ts
    };
  }, [active, machine]);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 32 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/farm/FarmOverlays.tsx components/game/farm/Handbook.tsx components/game/farm/PlotPanel.tsx hooks/useFarmController.ts tests/unit/farm-plot-panel.test.tsx tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the plot panel for beds, cut rice and the harvester; the handbook's new tabs

components/game/farm/PlotPanel.tsx (§13.1): beds show the crop and its stage, the soil against what it needs, the pests,
excess N, rot and my estimate (per picking and for the season); a partly cut plot says what was cut; a running harvester
counts down; ripe rice points to the co-op's harvester; lên luống, planting, the hand jobs and the ớt's setting out are
toasted; the handbook link names the crop's tab or Nông cụ. components/game/farm/Handbook.tsx: the crop tabs and Nông
cụ from the catalog. The field's clock ticks every second while a harvester runs, for the countdowns.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/farm/FarmOverlays.tsx components/game/farm/Handbook.tsx components/game/farm/PlotPanel.tsx hooks/useFarmController.ts tests/unit/farm-plot-panel.test.tsx tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 16: Chú Tám's harvester, anh Hai's tools and cô Út's hoa màu

**Files:**
- Modify: `components/game/farm/CoopPanel.tsx`, `components/game/farm/FarmShopPanel.tsx`, `components/game/farm/RiceDepotPanel.tsx`, `components/game/farm/FarmOverlays.tsx` (the co-op gets the catalog; the depot gets `onSellProduce`)
- Test: `tests/unit/farm-panels.test.tsx`, `tests/unit/anticheat-pins.test.tsx` (modify)

**Interfaces:**
- Consumes: Tasks 6, 8, 9 and 13 (`FarmCatalog.uplands`, `TOOL_SICKLE`, `harvesterPrice`, `producePrice`, `describeFarmItem(it, varieties, uplands)`, `harvesterRefusal`, `harvesterStartText`, `useFarmController`'s `sellProduce`); from v15.1: `CoopPanel`'s tabs and `LandButton` (a disabled reason, a confirm `warn`), `FarmShopPanel`'s rows and `Stepper`, `RiceDepotPanel`'s rice rows and intros, `ConfirmButton`, `formatXu`.
- Produces:
  - `CoopPanel({ state, catalog = null, failed, me, busy, now, onAct, onReload, onClose })` (§13.4): a "Máy gặt" tab before "Của tôi" lists my rice plots ("Thửa N · Variety · state", then " · đã gặt n/6 phần" once cut), rents the harvester after "Thuê máy gặt cho thửa N, k phần còn lại, giá X? Không huỷ được." (`rent_harvester`, then `harvesterStartText`), gives `harvesterRefusal`'s reason, counts a running job down, and says "Bạn chưa làm ruộng lúa nào trong phòng này." when I farm no rice here; the panel opens on it while a rice plot of mine is ripe with parts left;
  - `FarmShopPanel`: the shelves "🌾 Giống lúa", "🥔 Giống hoa màu", "🧺 Phân bón", "🧴 Thuốc", "🛠️ Nông cụ"; a tool row has no stepper: "Mua · 1.500 xu" sends quantity 1, "✓ Đã có" once owned, "Không đủ xu";
  - `RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose })`: hoa-màu rows "{name} · {kg} kg", "{price} xu/kg · bán tươi", "Bán" / "Bán hết" by `producePrice`; the hoa-màu intro and the new empty line "“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”";
  - the pins (anti-cheat §15.2): a tool is bought 1 at a time (R18); a hoa-màu row sends whole kg from 1 to the stock.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-panels.test.tsx — edit 1 of 5.** Replace:

```tsx
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import { farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

with:

```tsx
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/farm-panels.test.tsx — edit 2 of 5.** Replace:

```tsx
    render(<FarmShopPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onBuy={onBuy} onReload={noop} onClose={noop} />);
    expect(screen.getByText("🌱 Giống lúa")).toBeInTheDocument();
    const seed = screen.getByText("Giống nếp").closest("li")!;
```

with:

```tsx
    render(<FarmShopPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onBuy={onBuy} onReload={noop} onClose={noop} />);
    expect(screen.getByText("🌾 Giống lúa")).toBeInTheDocument();
    const seed = screen.getByText("Giống nếp").closest("li")!;
```

**tests/unit/farm-panels.test.tsx — edit 3 of 5.** Replace:

```tsx
    const onSell = vi.fn();
    render(<RiceDepotPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onSell={onSell} onReload={noop} onClose={noop} />);
    const dry = screen.getByText("Nếp khô · 50 kg").closest("li")!;
```

with:

```tsx
    const onSell = vi.fn();
    render(<RiceDepotPanel mine={STATE.mine} catalog={CATALOG} failed={false} busy={false} onSell={onSell} onSellProduce={noop} onReload={noop}
      onClose={noop} />);
    const dry = screen.getByText("Nếp khô · 50 kg").closest("li")!;
```

**tests/unit/farm-panels.test.tsx — edit 4 of 5.** Replace:

```tsx
  });
  it("has nothing to buy without rice", () => {
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={CATALOG} failed={false} busy={false} onSell={noop} onReload={noop} onClose={noop} />);
    expect(screen.queryByRole("button", { name: /Bán/ })).toBeNull();
  });
```

with:

```tsx
  });
  it("has nothing to buy without rice or hoa màu", () => {
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={CATALOG} failed={false} busy={false} onSell={noop} onSellProduce={noop}
      onReload={noop} onClose={noop} />);
    expect(screen.queryByRole("button", { name: /Bán/ })).toBeNull();
    expect(screen.getByText("“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”")).toBeInTheDocument();
  });
```

**tests/unit/farm-panels.test.tsx — edit 5 of 5.** Append at the end of the file, after a blank line:

```tsx
describe("v15.2: the shop's tools, cô Út's hoa màu and chú Tám's harvester", () => {
  const khoai = uplandFromRow((fixtures as unknown as { crops: UplandCropRow[] }).crops.find((r) => r.id === "khoai")!);
  const BEDS: FarmCatalog = {
    ...CATALOG, uplands: [khoai],
    items: [
      ...CATALOG.items, item("seed_khoai", "seed", "Dây khoai giống", 800, { upland: "khoai" }), item("tool_sickle", "tool", "Liềm", 1500),
      item("tool_sprayer", "tool", "Bình phun", 5000),
    ],
  };

  it("sorts the shop into five sections, and sells a tool once, without a stepper", () => {
    const onBuy = vi.fn();
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 3000, items: { tool_sprayer: 1 } }} catalog={BEDS} failed={false} busy={false}
      onBuy={onBuy} onReload={noop} onClose={noop} />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      ["🌾 Giống lúa", "🥔 Giống hoa màu", "🧺 Phân bón", "🧴 Thuốc", "🛠️ Nông cụ"]);
    expect(within(screen.getByText("Dây khoai giống").closest("li")!).getByText("Trồng dây · chín ~48 giờ · 200 kg/thửa · 265 xu/kg")).toBeInTheDocument();
    const sickle = screen.getByText("Liềm").closest("li")!;
    expect(within(sickle).queryByRole("group")).toBeNull();
    expect(within(sickle).getByText("Gặt lúa tay, 6 phần — mua một lần")).toBeInTheDocument();
    fireEvent.click(within(sickle).getByRole("button", { name: "Mua · 1.500 xu" }));
    expect(onBuy).toHaveBeenCalledWith("tool_sickle", 1);
    expect(within(screen.getByText("Bình phun").closest("li")!).getByRole("button", { name: "✓ Đã có" })).toBeDisabled();
    cleanup();
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 1000, items: {} }} catalog={BEDS} failed={false} busy={false} onBuy={onBuy}
      onReload={noop} onClose={noop} />);
    expect(within(screen.getByText("Liềm").closest("li")!).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
  });

  it("buys hoa màu fresh, some or all", () => {
    const onSellProduce = vi.fn();
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {}, produce: { khoai: 180 } }} catalog={BEDS} failed={false} busy={false} onSell={noop}
      onSellProduce={onSellProduce} onReload={noop} onClose={noop} />);
    expect(screen.getByText("“Hoa màu bán tươi, khỏi phơi — cô lấy hết!”")).toBeInTheDocument();
    const row = screen.getByText("Khoai lang · 180 kg").closest("li")!;
    expect(within(row).getByText("265 xu/kg · bán tươi")).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Bán · 2.650 xu" }));
    expect(onSellProduce).toHaveBeenLastCalledWith("khoai", 10);
    fireEvent.click(within(row).getByRole("button", { name: "Bán hết · 47.700 xu" }));
    expect(onSellProduce).toHaveBeenLastCalledWith("khoai", 180);
  });

  /** Plot 6, rented by me, with `crop`; plot 7 free. */
  const riceState = (crop: Record<string, unknown> | null, coins = 10_000): FieldState => parseFieldState({
    server_now: iso(0),
    plots: [bare(6, "village", { farmer: ME, lease: lease(5), crop }), bare(7, "village")],
    drying: [],
    mine: { items: {}, rice: {}, coins, gift_claimed: true, owned_plot: null, farming: [6], my_offers: [], incoming_offers: [] },
  })!;
  /** Nếp transplanted 62 h ago: overripe for 2 h; drained; 2 parts cut. */
  const OVERRIPE = {
    variety: "nep", phase: "overripe", prepared_at: iso(-80), soak_at: iso(-79), sow_at: iso(-76), transplant_at: iso(-62), water: 1,
    water_set_at: iso(-3), pests: [], excess_n: false, ripe: true, rotted_at: null, parts: 2,
    log: { water: [{ t: iso(-80), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, harvested_kg: 25 },
  };
  const coop = (state: FieldState) => {
    const onAct = vi.fn();
    render(<CoopPanel state={state} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    return onAct;
  };

  it("opens on Máy gặt when my rice is ripe, and rents the harvester after asking", () => {
    const onAct = coop(riceState(OVERRIPE));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Đất làng", "Đất tư", "Chợ đất", "Máy gặt", "Của tôi"]);
    expect(screen.getByRole("tab", { name: "Máy gặt" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("“Máy gặt của hợp tác xã: 500 xu mỗi phần, cả thửa 3.000 xu, 30 giây là xong, khỏi cầm liềm. Nhớ rút nước trước nghen!”"))
      .toBeInTheDocument();
    const row = screen.getByText("Thửa 6 · Nếp · Chín quá 2 giờ · đã gặt 2/6 phần").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Thuê máy gặt · 4 phần · 2.000 xu" }));
    expect(screen.getByText("⚠️ Thuê máy gặt cho thửa 6, 4 phần còn lại, giá 2.000 xu? Không huỷ được.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenCalledWith({ kind: "rent_harvester", plot: 6 }, "🚜 Máy gặt đang vào thửa 6 — 30 giây nữa xong.");
  });

  it("says why the harvester cannot come, and counts a running one down", () => {
    coop(riceState(OVERRIPE, 1000));
    expect(within(screen.getByText(/^Thửa 6 · Nếp/).closest("li")!).getByRole("button", { name: /^Thuê máy gặt/ })).toBeDisabled();
    expect(screen.getByText("Không đủ xu.")).toBeInTheDocument();
    cleanup();
    coop(riceState({ ...OVERRIPE, water: 2, log: { ...OVERRIPE.log, water: [{ t: iso(-80), l: 3 }, { t: iso(-1), l: 2 }] } }));
    expect(screen.getByText("Mực nước chưa đúng — xem Sổ tay.")).toBeInTheDocument();
    cleanup();
    coop(riceState({ ...OVERRIPE, harvester: { started_at: iso(0), ends_at: new Date(NOW + 25_000).toISOString() } }));
    expect(screen.getByText("🚜 Máy gặt đang gặt — còn 25 giây")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Thuê máy gặt/ })).toBeNull();
  });

  it("opens on Đất làng otherwise, and says so when I farm no rice here", () => {
    coop(riceState(null));
    expect(screen.getByRole("tab", { name: "Đất làng" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Máy gặt" }));
    expect(screen.getByText("Bạn chưa làm ruộng lúa nào trong phòng này.")).toBeInTheDocument();
  });
});
```

**tests/unit/anticheat-pins.test.tsx — edit 1 of 2.** Replace:

```tsx
    const mine = { ...STATE.mine, rice: { nep: { wet: 1, dry: 3 } } };
    render(<RiceDepotPanel mine={mine} catalog={FARM} failed={false} busy={false} onSell={onSell} onReload={noop} onClose={noop} />);
    for (const line of screen.getAllByRole("listitem")) {
```

with:

```tsx
    const mine = { ...STATE.mine, rice: { nep: { wet: 1, dry: 3 } } };
    render(<RiceDepotPanel mine={mine} catalog={FARM} failed={false} busy={false} onSell={onSell} onSellProduce={noop} onReload={noop}
      onClose={noop} />);
    for (const line of screen.getAllByRole("listitem")) {
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 2.** Replace:

```tsx
    expect(onAct.mock.calls.map(([a]) => a)).toEqual([{ kind: "dry_start", variety: "nep", kg: 1 }]);
  });
```

with:

```tsx
    expect(onAct.mock.calls.map(([a]) => a)).toEqual([{ kind: "dry_start", variety: "nep", kg: 1 }]);
  });
});

describe("bad_qty, v15.2", () => {
  it("the farm shop sends 1 for a tool (R18)", () => {
    const onBuy = vi.fn();
    const tools = { ...FARM, items: [...FARM.items, item("tool_sickle", "tool", "Liềm", 1500)] };
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 1_000_000, items: {} }} catalog={tools} failed={false} busy={false}
      onBuy={onBuy} onReload={noop} onClose={noop} />);
    fireEvent.click(within(screen.getByText("Liềm").closest("li")!).getByRole("button", { name: /^Mua/ }));
    expect(onBuy.mock.calls).toEqual([["tool_sickle", 1]]);
  });

  it("cô Út's hoa-màu rows send whole kg from 1 to the stock", () => {
    const onSellProduce = vi.fn();
    const crops = { ...FARM, uplands: (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow) };
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {}, produce: { khoai: 3, ot: 1 } }} catalog={crops} failed={false} busy={false}
      onSell={noop} onSellProduce={onSellProduce} onReload={noop} onClose={noop} />);
    for (const line of screen.getAllByRole("listitem")) {
      for (let i = 0; i < 5; i++) fireEvent.click(within(line).getByRole("button", { name: "Bớt" }));
      for (const b of within(line).getAllByRole("button", { name: /^Bán/ })) fireEvent.click(b);
      fireEvent.click(within(line).getByRole("button", { name: "Tối đa" }));
      fireEvent.click(within(line).getByRole("button", { name: /^Bán ·/ }));
    }
    expect(onSellProduce.mock.calls).toEqual([["khoai", 1], ["khoai", 3], ["khoai", 3], ["ot", 1], ["ot", 1], ["ot", 1]]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-panels.test.tsx`
Expected: FAIL — 9 tests fail (no "Máy gặt" tab, the old three shelves, no tool row, no hoa-màu rows, the old empty line); 26 pass.

- [ ] **Step 3: Implement**

**components/game/farm/CoopPanel.tsx — edit 1 of 5.** Replace:

```tsx
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
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import {
  FARM_LIMIT, HARVEST_PARTS, harvesterPrice, LEASE_HOURS, PLOT_PRICE, RENT_PRICE, SALE_MAX, SELL_BACK_PRICE, SUBLEASE_MAX,
  type FarmCatalog, type Variety,
} from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, overripeAt } from "@/lib/game/farm/crop";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, harvesterRefusal, listRefusal, offerRefusal, reasonText, rentRefusal,
  rentSubleaseRefusal, sellBackRefusal, subleaseRefusal, type LandCtx,
} from "@/lib/game/farm/land";
import { durationText, harvesterStartText, PHASE_NAME } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import type { CropView, FieldState, PlotView } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
```

**components/game/farm/CoopPanel.tsx — edit 2 of 5.** Replace:

```tsx

type Tab = "village" | "private" | "market" | "mine";
const TABS: ReadonlyArray<[Tab, string]> = [["village", "Đất làng"], ["private", "Đất tư"], ["market", "Chợ đất"], ["mine", "Của tôi"]];
```

with:

```tsx

type Tab = "village" | "private" | "market" | "harvester" | "mine";
const TABS: ReadonlyArray<[Tab, string]> = [
  ["village", "Đất làng"], ["private", "Đất tư"], ["market", "Chợ đất"], ["harvester", "Máy gặt"], ["mine", "Của tôi"],
];
```

**components/game/farm/CoopPanel.tsx — edit 3 of 5.** Replace:

```tsx

/** 🏛️ Hợp tác xã · chú Tám (spec §7, §13.3): rent village plots, buy private ones, the land market and my land. */
export default function CoopPanel({ state, failed, me, busy, now, onAct, onReload, onClose }: {
  state: FieldState | null;
  failed: boolean;
```

with:

```tsx

/** The rice plots I farm here. */
const myRice = (ctx: LandCtx): PlotView[] => ctx.plots.filter((p) => p.farmer?.id === ctx.me && p.crop?.kind === "rice");

/** "Chín", "Chín quá 2 giờ", or the phase's name. */
function riceState(crop: CropView, v: Variety | null, now: number): string {
  const c = cropModel(crop);
  const ph = cropPhase(c, v, now);
  const over = v ? overripeAt(c, v) : null;
  return ph === "overripe" && over !== null ? `Chín quá ${durationText(now - over)}` : PHASE_NAME[ph];
}

/** A rice plot of mine is ripe here (a harvester may be at work on it): the panel opens on Máy gặt. */
function riceReady(ctx: LandCtx, varieties: readonly Variety[], now: number): boolean {
  return myRice(ctx).some((p) => {
    const crop = p.crop!;
    const ph = cropPhase(cropModel(crop), varieties.find((v) => v.id === crop.variety) ?? null, now);
    return crop.parts < HARVEST_PARTS && (ph === "ripe" || ph === "overripe");
  });
}

/** Máy gặt (v15.2 §13.4): the co-op's harvester for my rice plots here, 500 xu a part left, 30 seconds, no refund. */
function HarvesterTab({ ctx, varieties, busy, now, onAct }: {
  ctx: LandCtx;
  varieties: readonly Variety[];
  busy: boolean;
  now: number;
  onAct: Act;
}) {
  const plots = myRice(ctx);
  return (
    <>
      <p className="opacity-80">
        “Máy gặt của hợp tác xã: 500 xu mỗi phần, cả thửa 3.000 xu, 30 giây là xong, khỏi cầm liềm. Nhớ rút nước trước nghen!”
      </p>
      {plots.length === 0 ? (
        <p>Bạn chưa làm ruộng lúa nào trong phòng này.</p>
      ) : (
        <ul>
          {plots.map((p) => {
            const crop = p.crop!;
            const v = varieties.find((x) => x.id === crop.variety) ?? null;
            const left = HARVEST_PARTS - crop.parts, price = harvesterPrice(crop.parts);
            const job = crop.harvester && now < crop.harvester.endsAt ? crop.harvester : null;
            return (
              <Line key={p.no} action={job ? (
                <span>🚜 Máy gặt đang gặt — còn {Math.ceil((job.endsAt - now) / 1000)} giây</span>
              ) : (
                <LandButton refusal={harvesterRefusal(p, ctx, v, now)} busy={busy} primary
                  warn={`Thuê máy gặt cho thửa ${p.no}, ${left} phần còn lại, giá ${formatXu(price)}? Không huỷ được.`}
                  onClick={() => onAct({ kind: "rent_harvester", plot: p.no }, harvesterStartText(p.no))}>
                  Thuê máy gặt · {left} phần · {formatXu(price)}
                </LandButton>
              )}>
                Thửa {p.no} · {v?.name ?? "Chưa ngâm giống"} · {riceState(crop, v, now)}
                {crop.parts > 0 ? ` · đã gặt ${crop.parts}/${HARVEST_PARTS} phần` : ""}
              </Line>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** 🏛️ Hợp tác xã · chú Tám (spec §7, §13.3; v15.2 §13.4): rent village plots, buy private ones, the land market, the
 *  harvester and my land. It opens on Máy gặt while a rice plot of mine is ripe. */
export default function CoopPanel({ state, catalog = null, failed, me, busy, now, onAct, onReload, onClose }: {
  state: FieldState | null;
  /** The varieties, for the rice's phases (without it every variety ripens as nếp does). */
  catalog?: FarmCatalog | null;
  failed: boolean;
```

**components/game/farm/CoopPanel.tsx — edit 4 of 5.** Replace:

```tsx
}) {
  const [tab, setTab] = useState<Tab>("village");
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
  return (
```

with:

```tsx
}) {
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
  const varieties = catalog?.varieties ?? [];
  const [tab, setTab] = useState<Tab>(() => (ctx && riceReady(ctx, varieties, now) ? "harvester" : "village"));
  return (
```

**components/game/farm/CoopPanel.tsx — edit 5 of 5.** Replace:

```tsx
            {tab === "market" && <MarketTab ctx={ctx} busy={busy} onAct={onAct} />}
            {tab === "mine" && <MineTab ctx={ctx} state={state} busy={busy} now={now} onAct={onAct} />}
```

with:

```tsx
            {tab === "market" && <MarketTab ctx={ctx} busy={busy} onAct={onAct} />}
            {tab === "harvester" && <HarvesterTab ctx={ctx} varieties={varieties} busy={busy} now={now} onAct={onAct} />}
            {tab === "mine" && <MineTab ctx={ctx} state={state} busy={busy} now={now} onAct={onAct} />}
```

**components/game/farm/FarmShopPanel.tsx — edit 1 of 5.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { describeFarmItem, ITEM_CAP, type FarmCatalog, type FarmItem, type FarmItemKind } from "@/lib/game/farm/catalog";
import { itemCount, type FarmMine } from "@/lib/game/farm/state";
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { describeFarmItem, ITEM_CAP, type FarmCatalog, type FarmItem } from "@/lib/game/farm/catalog";
import { itemCount, type FarmMine } from "@/lib/game/farm/state";
```

**components/game/farm/FarmShopPanel.tsx — edit 2 of 5.** Replace:

```tsx

const SECTIONS: ReadonlyArray<[FarmItemKind, string]> = [["seed", "🌱 Giống lúa"], ["fertilizer", "🧺 Phân bón"], ["pesticide", "🧴 Thuốc"]];
```

with:

```tsx

/** The shelves (v15.2 §13.5): rice seed, hoa-màu seed, fertilizers, pesticides and the tools. */
const SECTIONS: ReadonlyArray<[string, string, (i: FarmItem) => boolean]> = [
  ["rice", "🌾 Giống lúa", (i) => i.kind === "seed" && i.upland === null],
  ["upland", "🥔 Giống hoa màu", (i) => i.kind === "seed" && i.upland !== null],
  ["fertilizer", "🧺 Phân bón", (i) => i.kind === "fertilizer"],
  ["pesticide", "🧴 Thuốc", (i) => i.kind === "pesticide"],
  ["tool", "🛠️ Nông cụ", (i) => i.kind === "tool"],
];

/** A tool: bought once, no stepper (R18). */
function ToolRow({ item, mine, busy, onBuy }: { item: FarmItem; mine: FarmMine; busy: boolean; onBuy: (itemId: string, qty: number) => void }) {
  const price = item.price ?? 0;
  const owned = itemCount(mine, item.id) > 0;
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={item.id} scale={3} />
        <div className="flex min-w-0 flex-1 flex-col leading-none">
          <span className="truncate text-xl">{item.name}</span>
          <span className="text-base">{formatXu(price)}</span>
        </div>
      </div>
      <p className="text-base leading-tight opacity-80">{describeFarmItem(item, [])}</p>
      {owned ? (
        <button type="button" className="pch-btn" disabled>✓ Đã có</button>
      ) : mine.coins < price ? (
        <button type="button" className="pch-btn" disabled>Không đủ xu</button>
      ) : (
        <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, 1)}>Mua · {formatXu(price)}</button>
      )}
    </li>
  );
}
```

**components/game/farm/FarmShopPanel.tsx — edit 3 of 5.** Replace:

```tsx
      </div>
      <p className="text-base leading-tight opacity-80">{describeFarmItem(item, catalog.varieties)}</p>
      {max < 1 ? (
```

with:

```tsx
      </div>
      <p className="text-base leading-tight opacity-80">{describeFarmItem(item, catalog.varieties, catalog.uplands)}</p>
      {max < 1 ? (
```

**components/game/farm/FarmShopPanel.tsx — edit 4 of 5.** Replace:

```tsx

/** 🧺 Tiệm vật tư · anh Hai (spec §9, §13.3): seeds, fertilizers and pesticides, bought by the quantity. */
export default function FarmShopPanel({ mine, catalog, failed, busy, onBuy, onReload, onClose }: {
```

with:

```tsx

/** 🧺 Tiệm vật tư · anh Hai (spec §9, §13.3; v15.2 §13.5): seeds, fertilizers and pesticides by the quantity, and the
 *  tools once. */
export default function FarmShopPanel({ mine, catalog, failed, busy, onBuy, onReload, onClose }: {
```

**components/game/farm/FarmShopPanel.tsx — edit 5 of 5.** Replace:

```tsx
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
```

with:

```tsx
            <p>Bạn có <b>{formatXu(mine.coins)}</b>. “Cần gì cứ lấy, anh chỉ cách dùng luôn!”</p>
            {SECTIONS.map(([id, title, shelf]) => {
              const items = catalog.items.filter((i) => shelf(i) && i.price !== null).sort((a, b) => a.sortOrder - b.sortOrder);
              if (items.length === 0) return null;
              return (
                <section key={id} className="flex flex-col gap-1">
                  <h3 className="text-xl text-burgundy">{title}</h3>
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map((i) => (i.kind === "tool"
                      ? <ToolRow key={i.id} item={i} mine={mine} busy={busy} onBuy={onBuy} />
                      : <Row key={i.id} item={i} mine={mine} catalog={catalog} busy={busy} onBuy={onBuy} />))}
                  </ul>
```

**components/game/farm/RiceDepotPanel.tsx — edit 1 of 5.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { ricePrice, type FarmCatalog, type Variety } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { producePrice, ricePrice, type FarmCatalog, type UplandCrop, type Variety } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
```

**components/game/farm/RiceDepotPanel.tsx — edit 2 of 5.** Replace:

```tsx

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3): sell wet or dry rice per variety; dry rice pays the full price. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onReload, onClose }: {
  mine: FarmMine | null;
```

with:

```tsx

/** One hoa-màu line (v15.2 §13.5): sold fresh, some or all. */
function ProduceRow({ u, kg, busy, onSell }: { u: UplandCrop; kg: number; busy: boolean; onSell: (upland: string, kg: number) => void }) {
  const [amount, setAmount] = useState(Math.min(10, kg));
  const n = Math.min(Math.max(1, amount), kg);
  return (
    <li className="pch flex flex-col gap-1 p-2">
      <div className="flex items-center gap-2">
        <ItemIcon id={`produce_${u.id}`} scale={3} />
        <div className="flex flex-col leading-none">
          <span className="text-xl">{u.name} · {kg} kg</span>
          <span className="text-base">{u.pricePerKg.toLocaleString("vi-VN")} xu/kg · bán tươi</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1">
        <Stepper value={n} max={kg} label={`Số kg ${u.name}`} unit=" kg" onChange={setAmount} />
        <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell(u.id, n)}>Bán · {formatXu(producePrice(n, u))}</button>
      </div>
      <button type="button" className="pch-btn pch-btn-primary self-end" disabled={busy} onClick={() => onSell(u.id, kg)}>
        Bán hết · {formatXu(producePrice(kg, u))}
      </button>
    </li>
  );
}

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3; v15.2 §13.5): sell wet or dry rice per variety — dry rice pays the full price —
 *  and hoa màu, fresh. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose }: {
  mine: FarmMine | null;
```

**components/game/farm/RiceDepotPanel.tsx — edit 3 of 5.** Replace:

```tsx
  onSell: (variety: string, dry: boolean, kg: number) => void;
  onReload: () => void;
```

with:

```tsx
  onSell: (variety: string, dry: boolean, kg: number) => void;
  onSellProduce: (upland: string, kg: number) => void;
  onReload: () => void;
```

**components/game/farm/RiceDepotPanel.tsx — edit 4 of 5.** Replace:

```tsx
  });
  return (
```

with:

```tsx
  });
  const produce = (catalog?.uplands ?? []).flatMap((u) => ((mine?.produce[u.id] ?? 0) > 0 ? [{ u, kg: mine!.produce[u.id] }] : []));
  return (
```

**components/game/farm/RiceDepotPanel.tsx — edit 5 of 5.** Replace:

```tsx
          <FieldStatus failed={failed} onReload={onReload} />
        ) : lines.length === 0 ? (
          <p>“Chưa có lúa hả con? Gặt xong đem phơi cho khô rồi mang qua, cô trả giá cao!”</p>
        ) : (
          <>
            <p>“Lúa phơi khô cô trả đủ giá, lúa ướt chỉ được bảy phần.”</p>
            <ul className="flex flex-col gap-2">
              {lines.map((l) => <StockRow key={`${l.v.id}:${l.dry}`} {...l} busy={busy} onSell={onSell} />)}
            </ul>
```

with:

```tsx
          <FieldStatus failed={failed} onReload={onReload} />
        ) : lines.length + produce.length === 0 ? (
          <p>“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”</p>
        ) : (
          <>
            <p>{lines.length > 0 ? "“Lúa phơi khô cô trả đủ giá, lúa ướt chỉ được bảy phần.”" : "“Hoa màu bán tươi, khỏi phơi — cô lấy hết!”"}</p>
            <ul className="flex flex-col gap-2">
              {lines.map((l) => <StockRow key={`${l.v.id}:${l.dry}`} {...l} busy={busy} onSell={onSell} />)}
              {produce.map((x) => <ProduceRow key={x.u.id} u={x.u} kg={x.kg} busy={busy} onSell={onSellProduce} />)}
            </ul>
```

**components/game/farm/FarmOverlays.tsx — edit 1 of 2.** Replace:

```tsx
      {panel?.kind === "coop" && (
        <CoopPanel state={state} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload} onClose={closePanel} />
      )}
```

with:

```tsx
      {panel?.kind === "coop" && (
        <CoopPanel state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload}
          onClose={closePanel} />
      )}
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 2.** Replace:

```tsx
        <RiceDepotPanel mine={state?.mine ?? null} catalog={catalog} failed={failed} busy={busy}
          onSell={(v, dry, kg) => void farm.sell(v, dry, kg)} onReload={onReload} onClose={closePanel} />
      )}
```

with:

```tsx
        <RiceDepotPanel mine={state?.mine ?? null} catalog={catalog} failed={failed} busy={busy}
          onSell={(v, dry, kg) => void farm.sell(v, dry, kg)} onSellProduce={(u, kg) => void farm.sellProduce(u, kg)}
          onReload={onReload} onClose={closePanel} />
      )}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 35 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/farm/CoopPanel.tsx components/game/farm/FarmOverlays.tsx components/game/farm/FarmShopPanel.tsx components/game/farm/RiceDepotPanel.tsx tests/unit/anticheat-pins.test.tsx tests/unit/farm-panels.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): chú Tám's harvester, anh Hai's tools and cô Út's hoa màu

components/game/farm/CoopPanel.tsx (§13.4): a "Máy gặt" tab lists my rice plots with their phase and parts cut, rents
the harvester after a confirm (500 xu a part left, no refund), says why it cannot come through harvesterRefusal, counts a
running one down, and the panel opens on it while a rice plot of mine is ripe. components/game/farm/FarmShopPanel.tsx:
five shelves, and a tool row bought once without a stepper ("✓ Đã có" once owned). components/game/farm/RiceDepotPanel.tsx:
hoa-màu rows sold fresh, some or all, with their intro and the new empty line. The pins: a tool is bought 1 at a time,
and hoa màu is sold in whole kg from 1 to the stock.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/farm/CoopPanel.tsx components/game/farm/FarmOverlays.tsx components/game/farm/FarmShopPanel.tsx components/game/farm/RiceDepotPanel.tsx tests/unit/anticheat-pins.test.tsx tests/unit/farm-panels.test.tsx
git commit -F <message file>
```

---

### Task 17: The bag's Nông cụ, Nạp thuốc, and the HUD's hoa màu

**Files:**
- Modify: `components/game/fishing/BagPanel.tsx`, `components/game/fishing/FishingOverlays.tsx`, `components/game/GameShell.tsx` (the bag's farm side; the HUD's line)
- Test: `tests/unit/fishing-panels.test.tsx` (modify)

**Interfaces:**
- Consumes: Tasks 6, 8 and 13 (`TANK_CHARGES`, `TOOL_SICKLE`, `TOOL_SPRAYER`, `FarmItem`, `FarmMine.tank` / `items`, `produceSummary`, `useFarmController`'s `loadSprayer` and `busy`); from v14 / v15.1: `BagPanel({ state, catalog, busy, onEquip, onRelease, onClose })`, `FishingOverlays({ fishing })`, `ItemIcon`, `ConfirmButton` (its warn line reads "⚠️ {warn}" and its confirm button "Vẫn làm"), `formatXu`, `riceSummary` in the game shell's HUD.
- Produces:
  - `BagPanel.tsx`: `BagFarm { mine; items; busy; onLoad }`; `BagPanel` takes `farm?: BagFarm | null` and then shows "🌾 Nông cụ" (R29, §13.5): "Liềm — gặt lúa 6 phần" or "Chưa có liềm — tiệm anh Hai bán 1.500 xu"; "Bình phun — {Tên} · còn c/3 lần", "Bình phun — trống" or "Chưa có bình phun — tiệm anh Hai bán 5.000 xu"; one "Nạp {tên} (n chai)" per pesticide held, which asks "Bình còn c lần {x}. Nạp {y} sẽ đổ bỏ phần còn lại — nạp chứ?" while charges remain and waits ("Bình đang đầy thuốc này.") while the tank is full of the same;
  - `FishingOverlays({ fishing, farm = null })` hands `farm` to the bag; the game shell passes the field's stock, the farm catalog's items and `loadSprayer` once the field state has loaded and the catalog has tools (none before `0016`), and the HUD's line becomes `produceSummary(rice, produce)`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/fishing-panels.test.tsx — edit 1 of 2.** Replace:

```tsx
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { shopItemFromRow, speciesFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
```

with:

```tsx
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { farmItemFromRow } from "@/lib/game/farm/catalog";
import type { FarmMine, Tank } from "@/lib/game/farm/state";
import { shopItemFromRow, speciesFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
```

**tests/unit/fishing-panels.test.tsx — edit 2 of 2.** Append at the end of the file, after a blank line:

```tsx
describe("BagPanel, Nông cụ (v15.2 R29)", () => {
  const farmItem = (id: string, kind: string, name: string, price: number, over: Record<string, unknown> = {}) => farmItemFromRow({
    id, kind, name, price, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
  });
  const ITEMS = [
    farmItem("tool_sickle", "tool", "Liềm", 1500), farmItem("tool_sprayer", "tool", "Bình phun", 5000),
    farmItem("spray_insect", "pesticide", "Thuốc trừ sâu", 700, { pest_target: "insect" }),
    farmItem("spray_fungus", "pesticide", "Thuốc trừ bệnh", 900, { pest_target: "fungus" }),
  ];
  const mine = (items: Record<string, number>, tank: Tank | null): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank });
  const bag = (m: FarmMine) => {
    const onLoad = vi.fn();
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={() => {}} onRelease={() => {}} onClose={() => {}}
      farm={{ mine: m, items: ITEMS, busy: false, onLoad }} />);
    return onLoad;
  };

  it("is not there before the field has loaded", () => {
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={() => {}} onRelease={() => {}} onClose={() => {}} />);
    expect(screen.queryByText("🌾 Nông cụ")).toBeNull();
  });

  it("says where to buy the tools", () => {
    bag(mine({}, null));
    expect(screen.getByText("🌾 Nông cụ")).toBeInTheDocument();
    expect(screen.getByText("Chưa có liềm — tiệm anh Hai bán 1.500 xu")).toBeInTheDocument();
    expect(screen.getByText("Chưa có bình phun — tiệm anh Hai bán 5.000 xu")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Nạp/ })).toBeNull();
  });

  it("shows the tank, and asks before pouring another pesticide's charges away", () => {
    const onLoad = bag(mine({ tool_sickle: 1, tool_sprayer: 1, spray_insect: 2, spray_fungus: 1 }, { item: "spray_fungus", charges: 2 }));
    expect(screen.getByText("Liềm — gặt lúa 6 phần")).toBeInTheDocument();
    expect(screen.getByText("Bình phun — Thuốc trừ bệnh · còn 2/3 lần")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nạp thuốc trừ sâu (2 chai)" }));
    expect(screen.getByText("⚠️ Bình còn 2 lần thuốc trừ bệnh. Nạp thuốc trừ sâu sẽ đổ bỏ phần còn lại — nạp chứ?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onLoad).toHaveBeenCalledWith("spray_insect");
  });

  it("loads an empty tank at once, and waits while it is full of the same", () => {
    const onLoad = bag(mine({ tool_sprayer: 1, spray_insect: 1 }, { item: null, charges: 0 }));
    expect(screen.getByText("Bình phun — trống")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nạp thuốc trừ sâu (1 chai)" }));
    expect(onLoad).toHaveBeenCalledWith("spray_insect");
    cleanup();
    bag(mine({ tool_sprayer: 1, spray_insect: 1 }, { item: "spray_insect", charges: 3 }));
    expect(screen.getByRole("button", { name: "Nạp thuốc trừ sâu (1 chai)" })).toBeDisabled();
    expect(screen.getByText("Bình đang đầy thuốc này.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/fishing-panels.test.tsx`
Expected: FAIL — 3 tests fail (no "🌾 Nông cụ" section); 9 pass.

- [ ] **Step 3: Implement**

**components/game/fishing/BagPanel.tsx — edit 1 of 4.** Replace:

```tsx

import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { describeItem, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { baitCount, ownsItem, type FishingState, type Loadout } from "@/lib/game/fishing/state";
```

with:

```tsx

import ConfirmButton from "@/components/game/farm/ConfirmButton";
import ItemIcon from "@/components/game/ItemIcon";
import { ParchmentModal } from "@/components/game/Parchment";
import { TANK_CHARGES, TOOL_SICKLE, TOOL_SPRAYER, type FarmItem } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
import { describeItem, formatXu, type FishingCatalog, type ShopItem } from "@/lib/game/fishing/catalog";
import { baitCount, ownsItem, type FishingState, type Loadout } from "@/lib/game/fishing/state";
```

**components/game/fishing/BagPanel.tsx — edit 2 of 4.** Replace:

```tsx

/** 🎒 Giỏ đồ (spec §10.2): the fish (hand, then bucket), the owned rods and bobbers, the baits, the bait box and bucket. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose }: {
  state: FishingState | null;
```

with:

```tsx

/** The field's side of the bag (v15.2 R29): my farm stock, the farm catalog's items, and Nạp thuốc. */
export interface BagFarm { mine: FarmMine; items: readonly FarmItem[]; busy: boolean; onLoad: (itemId: string) => void }

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** 🌾 Nông cụ (v15.2 §13.5): the sickle, the sprayer's tank, and a Nạp button per pesticide held. Loading over other
 *  charges pours them away, so it asks first; a tank full of the same pesticide waits. */
function FarmTools({ farm }: { farm: BagFarm }) {
  const { mine, items, busy, onLoad } = farm;
  const has = (id: string) => (mine.items[id] ?? 0) > 0;
  const nameOf = (id: string) => items.find((i) => i.id === id)?.name ?? id;
  const priceOf = (id: string) => formatXu(items.find((i) => i.id === id)?.price ?? 0);
  const tank = mine.tank;
  return (
    <section>
      <h3 className="text-xl text-burgundy">🌾 Nông cụ</h3>
      <ul>
        <li className="flex items-center gap-2 py-0.5">
          <ItemIcon id={TOOL_SICKLE} scale={2} />
          <span>{has(TOOL_SICKLE) ? "Liềm — gặt lúa 6 phần" : `Chưa có liềm — tiệm anh Hai bán ${priceOf(TOOL_SICKLE)}`}</span>
        </li>
        <li className="flex items-center gap-2 py-0.5">
          <ItemIcon id={TOOL_SPRAYER} scale={2} />
          <span>
            {!has(TOOL_SPRAYER) ? `Chưa có bình phun — tiệm anh Hai bán ${priceOf(TOOL_SPRAYER)}`
              : tank?.item ? `Bình phun — ${nameOf(tank.item)} · còn ${tank.charges}/${TANK_CHARGES} lần` : "Bình phun — trống"}
          </span>
        </li>
        {has(TOOL_SPRAYER) && items.filter((i) => i.kind === "pesticide" && has(i.id)).map((p) => {
          const full = tank?.item === p.id && tank.charges >= TANK_CHARGES;
          const left = tank?.item && tank.charges > 0 ? tank : null;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-0.5">
              <ConfirmButton disabled={busy || full} onConfirm={() => onLoad(p.id)}
                warn={left ? `Bình còn ${left.charges} lần ${lower(nameOf(left.item!))}. Nạp ${lower(p.name)} sẽ đổ bỏ phần còn lại — nạp chứ?` : undefined}>
                Nạp {lower(p.name)} ({mine.items[p.id]} chai)
              </ConfirmButton>
              {full && <span className="text-base opacity-80">Bình đang đầy thuốc này.</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 🎒 Giỏ đồ (spec §10.2, v15.2 R29): the fish (hand, then bucket), the owned rods and bobbers, the baits, the bait box
 *  and bucket, and — once the field has loaded — the farm tools. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose, farm = null }: {
  state: FishingState | null;
```

**components/game/fishing/BagPanel.tsx — edit 3 of 4.** Replace:

```tsx
  onClose: () => void;
}) {
```

with:

```tsx
  onClose: () => void;
  farm?: BagFarm | null;
}) {
```

**components/game/fishing/BagPanel.tsx — edit 4 of 4.** Replace:

```tsx
        </section>
      </div>
```

with:

```tsx
        </section>
        {farm && <FarmTools farm={farm} />}
      </div>
```

**components/game/fishing/FishingOverlays.tsx — edit 1 of 3.** Replace:

```tsx
import type { FishingController } from "@/hooks/useFishingController";
import BagPanel from "./BagPanel";
import CatchCard from "./CatchCard";
```

with:

```tsx
import type { FishingController } from "@/hooks/useFishingController";
import BagPanel, { type BagFarm } from "./BagPanel";
import CatchCard from "./CatchCard";
```

**components/game/fishing/FishingOverlays.tsx — edit 2 of 3.** Replace:

```tsx
/** Fishing on top of the world (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the
 *  catch card and the four fishing panels. */
export default function FishingOverlays({ fishing }: { fishing: FishingController }) {
  const { cast, caught, panel, busy, closePanel } = fishing;
```

with:

```tsx
/** Fishing on top of the world (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the
 *  catch card and the four fishing panels; the bag shows the farm tools once the field has loaded (v15.2 R29). */
export default function FishingOverlays({ fishing, farm = null }: { fishing: FishingController; farm?: BagFarm | null }) {
  const { cast, caught, panel, busy, closePanel } = fishing;
```

**components/game/fishing/FishingOverlays.tsx — edit 3 of 3.** Replace:

```tsx
      {panel === "bag" && (
        <BagPanel state={state} catalog={catalog} busy={busy} onEquip={fishing.equip} onRelease={fishing.release} onClose={closePanel} />
      )}
```

with:

```tsx
      {panel === "bag" && (
        <BagPanel state={state} catalog={catalog} busy={busy} onEquip={fishing.equip} onRelease={fishing.release} onClose={closePanel}
          farm={farm} />
      )}
```

**components/game/GameShell.tsx — edit 1 of 3.** Replace:

```tsx
import { formatClock } from "@/lib/format";
import { riceSummary } from "@/lib/game/farm/messages";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
```

with:

```tsx
import { formatClock } from "@/lib/format";
import { produceSummary } from "@/lib/game/farm/messages";
import { freshAnnouncements } from "@/lib/game/fishing/announce";
```

**components/game/GameShell.tsx — edit 2 of 3.** Replace:

```tsx
              onReload={() => void fishing.data.reload()}
              riceLine={map.id === "field" && farm.data.state ? riceSummary(farm.data.state.mine.rice) : null}
            />
```

with:

```tsx
              onReload={() => void fishing.data.reload()}
              riceLine={map.id === "field" && farm.data.state ? produceSummary(farm.data.state.mine.rice, farm.data.state.mine.produce) : null}
            />
```

**components/game/GameShell.tsx — edit 3 of 3.** Replace:

```tsx

      <FishingOverlays fishing={fishing} />
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} />
```

with:

```tsx

      <FishingOverlays
        fishing={fishing}
        // the bag's farm tools, once the field has loaded and the catalog has them (before 0016 it has none)
        farm={farm.data.state && farm.data.catalog?.items.some((i) => i.kind === "tool")
          ? { mine: farm.data.state.mine, items: farm.data.catalog.items, busy: farm.busy, onLoad: (id) => void farm.loadSprayer(id) }
          : null}
      />
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} />
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameShell.tsx components/game/fishing/BagPanel.tsx components/game/fishing/FishingOverlays.tsx tests/unit/fishing-panels.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.2): the bag's Nông cụ, Nạp thuốc, and the HUD's hoa màu

components/game/fishing/BagPanel.tsx (R29, §13.5): once the field has loaded, a "🌾 Nông cụ" section shows the sickle,
the sprayer's tank ("còn 2/3 lần", "trống") or where to buy them, and a "Nạp" button per pesticide held — asking before
it pours other charges away, waiting while the tank is full of the same. The game shell hands the bag the field's stock
and the controller's loadSprayer (before 0016 the catalog has no tools and the section stays away), and the HUD's rice
line adds the hoa màu (produceSummary).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameShell.tsx components/game/fishing/BagPanel.tsx components/game/fishing/FishingOverlays.tsx tests/unit/fishing-panels.test.tsx
git commit -F <message file>
```

---

### Task 18: The admin's hoa màu, the integration tests, the README section, the spec amendments; the final checks

**Files:**
- Modify: `components/admin/AnticheatTab.tsx` (the holdings line), `lib/admin.ts` (`AnticheatHoldings.produce` / `tank`)
- Create: `tests/integration/v15-2.test.ts`
- Modify: `tests/unit/admin-anticheat.test.tsx`, `tests/integration/v15.test.ts` (the three hoa-màu seeds)
- Modify: `README.md` (the v15 trust lines; append the "v15.2" section), `docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md`, `docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md`, `docs/superpowers/specs/2026-09-25-music-together-economy-design.md` (the v15.2 spec's §3 amendments, with v15.3 as `0018_v15_3_gather.sql`)

**Interfaces:**
- Consumes: everything of Tasks 1–17; Task 5's `_ac_holdings` keys `produce [{upland, kg}]` and `tank`; `createClient` from `@supabase/supabase-js`; the integration tests' environment `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` (never put a value of these in a file).
- Produces:
  - `AnticheatHoldings` gains `produce?: Array<{ upland; kg }>` and `tank?: { item; charges } | null` (older answers lack them); `holdingsLine` adds `{kg} kg hoa màu` after `{kg} kg lúa` (anti-cheat §12.5 as amended);
  - `tests/integration/v15-2.test.ts` (§16; skipped without `SUPABASE_TEST_URL`, and the test project must be in log mode): anon reads `upland_crops` and the five new items but not `produce_stock`; the gift's sickle; the honest refusals of the seven new RPCs; strike-0 envelopes for `sell_produce` with kg 0, `tend_crop('x')`, `harvest_part` on plot 11 and the soft `load_sprayer('fert_urea')`; `v15.test.ts` counts 14 items of the farm kinds (`0013`'s 11 and the three hoa-màu seeds);
  - the README "v15.2" section (the migration and the production order `0012` → `0014` → `0013` → `0015` → `0016`, the deploy order, re-running older migrations, what's new, the trust model, the Realtime budget); the spec amendments.

- [ ] **Step 1: Write the failing test and the integration tests**

**tests/unit/admin-anticheat.test.tsx — edit 1 of 2.** Replace:

```tsx
  rice: [{ variety: "nep", wet_kg: 1200, dry_kg: 300 }],
  plots: [{ room_id: "r", plot_no: 1, kind: "private", owned_at: T, sale_price: null, sublease_price: null }],
```

with:

```tsx
  rice: [{ variety: "nep", wet_kg: 1200, dry_kg: 300 }],
  produce: [{ upland: "khoai", kg: 40 }, { upland: "ot", kg: 5 }],
  tank: { item: "spray_insect", charges: 2 },
  plots: [{ room_id: "r", plot_no: 1, kind: "private", owned_at: T, sale_price: null, sublease_price: null }],
```

**tests/unit/admin-anticheat.test.tsx — edit 2 of 2.** Replace:

```tsx
    expect(lan.getByText(
      "1.230 xu · 4 món đồ · 1 con cá · 2 kỷ lục · 1.500 kg lúa · 1 thửa sở hữu · 0 thửa đang thuê · 1 đề nghị mua · 1 ô phơi · 2 tin khoe trong chat",
    )).toBeInTheDocument();
```

with:

```tsx
    expect(lan.getByText(
      "1.230 xu · 4 món đồ · 1 con cá · 2 kỷ lục · 1.500 kg lúa · 45 kg hoa màu · 1 thửa sở hữu · 0 thửa đang thuê · 1 đề nghị mua · 1 ô phơi · 2 tin khoe trong chat",
    )).toBeInTheDocument();
```

Create `tests/integration/v15-2.test.ts` with exactly:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// The v15.2 tools and hoa màu end to end, as far as a fresh account can go without xu; the seasons, the six parts and
// the harvester are covered by tests/sql/v15-2-smoke.sql. The test project must be in log mode ("Chỉ ghi nhận"): a
// flagged call then answers with strike 0 and never locks the test account.
run("v15.2 tools and hoa màu", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("hm"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("mau"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("lets anyone read the hoa-màu crops, their seeds and the tools, but nobody read the stock", async () => {
    const { data: uplands, error } = await db.from("upland_crops").select("id, name, method");
    expect(error).toBeNull();
    expect((uplands ?? []).map((u) => [u.id, u.name, u.method]).sort()).toEqual([
      ["bap", "Bắp", "direct"], ["khoai", "Khoai lang", "cutting"], ["ot", "Ớt", "nursery"],
    ]);
    const { data: items } = await db.from("shop_items").select("id, kind, upland, price")
      .in("id", ["seed_khoai", "seed_bap", "seed_ot", "tool_sickle", "tool_sprayer"]);
    expect((items ?? []).map((i) => [i.id, i.kind, i.upland, i.price]).sort()).toEqual([
      ["seed_bap", "seed", "bap", 1000], ["seed_khoai", "seed", "khoai", 800], ["seed_ot", "seed", "ot", 1500],
      ["tool_sickle", "tool", null, 1500], ["tool_sprayer", "tool", null, 5000],
    ]);
    expect((await db.from("produce_stock").select("*")).error).not.toBeNull();
  });

  it("gives the newcomer a sickle with the gift", async () => {
    const me = await reg();
    const a = await db.rpc("claim_farm_gift", { p_session_token: me.token });
    expect(a.error).toBeNull();
    expect(a.data).toMatchObject({
      gifted: true, mine: { items: { seed_short: 1, fert_urea: 1, tool_sickle: 1 }, produce: {}, tank: null },
    });
  });

  it("refuses the new actions on plots it does not farm, a tool bought twice at once and hoa màu it does not have", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    expect((await call("prepare_beds", { p_plot: 5 })).error?.message).toBe("not your plot");
    expect((await call("plant_crop", { p_plot: 5, p_item_id: "seed_khoai" })).error?.message).toBe("not your plot");
    expect((await call("tend_crop", { p_plot: 5, p_act: "lat_day" })).error?.message).toBe("not your plot");
    expect((await call("harvest_part", { p_plot: 5, p_success: true })).error?.message).toBe("not your plot");
    expect((await call("rent_harvester", { p_plot: 5 })).error?.message).toBe("not your plot");
    const mine = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_session_token: me.token, ...args });
    expect((await mine("buy_farm_item", { p_item_id: "tool_sickle", p_qty: 2 })).error?.message).toBe("invalid quantity");
    expect((await mine("buy_farm_item", { p_item_id: "tool_sprayer", p_qty: 1 })).error?.message).toBe("not enough coins");
    expect((await mine("load_sprayer", { p_item_id: "spray_insect" })).error?.message).toBe("no sprayer");
    expect((await mine("sell_produce", { p_upland: "khoai", p_kg: 1 })).error?.message).toBe("not enough crop");
    expect((await mine("sell_produce", { p_upland: "lua", p_kg: 1 })).error?.message).toBe("invalid crop");
  });

  it("answers the tampered calls with strike-0 envelopes in log mode", async () => {
    const me = await reg();
    const r = await room(me.token);
    const sale = await db.rpc("sell_produce", { p_session_token: me.token, p_upland: "khoai", p_kg: 0 });
    expect(sale.error).toBeNull();
    expect(sale.data).toMatchObject({ anticheat: { code: "bad_qty", strike: 0, error: "invalid quantity", locked_until: null, banned: false } });
    const tend = await db.rpc("tend_crop", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 5, p_act: "x" });
    expect(tend.data).toMatchObject({ anticheat: { code: "bad_work", strike: 0, error: "invalid act" } });
    const part = await db.rpc("harvest_part", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 11, p_success: true });
    expect(part.data).toMatchObject({ anticheat: { code: "bad_plot", strike: 0, error: "invalid plot" } });
    // an item of another kind is soft: logged, never a strike
    const load = await db.rpc("load_sprayer", { p_session_token: me.token, p_item_id: "fert_urea" });
    expect(load.data).toMatchObject({ anticheat: { code: "kind_mismatch", strike: 0, error: "invalid item" } });
    // the account is not locked: an honest call still gets its normal refusal
    const honest = await db.rpc("sell_produce", { p_session_token: me.token, p_upland: "khoai", p_kg: 1 });
    expect(honest.error?.message).toBe("not enough crop");
  });
});
```

**tests/integration/v15.test.ts.** Replace:

```ts
    expect((varieties ?? []).map((v) => v.id).sort()).toEqual(["nep", "short", "thom"]);
    const { data: items } = await db.from("shop_items").select("id").in("kind", ["seed", "fertilizer", "pesticide", "critter_box"]);
    expect(items ?? []).toHaveLength(11);
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers", "fish_price_index"]) {
```

with:

```ts
    expect((varieties ?? []).map((v) => v.id).sort()).toEqual(["nep", "short", "thom"]);
    // v15.2 adds the three hoa-màu seeds (kind seed): 11 + 3
    const { data: items } = await db.from("shop_items").select("id").in("kind", ["seed", "fertilizer", "pesticide", "critter_box"]);
    expect(items ?? []).toHaveLength(14);
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers", "fish_price_index"]) {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/integration/v15-2.test.ts tests/integration/v15.test.ts tests/unit/admin-anticheat.test.tsx`
Expected: FAIL — the holdings line lacks "45 kg hoa màu" (1 test fails, 7 pass); the two integration files are skipped (11 tests) without `SUPABASE_TEST_URL`.

- [ ] **Step 3: Implement the holdings line**

**lib/admin.ts.** Replace:

```ts
  rice: Array<{ variety: string; wet_kg: number; dry_kg: number }>;
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
```

with:

```ts
  rice: Array<{ variety: string; wet_kg: number; dry_kg: number }>;
  /** v15.2 (`0016`): the hoa màu and the sprayer's tank; older answers lack them. */
  produce?: Array<{ upland: string; kg: number }>;
  tank?: { item: string | null; charges: number } | null;
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
```

**components/admin/AnticheatTab.tsx.** Replace:

```tsx
  const kg = h.rice.reduce((a, r) => a + r.wet_kg + r.dry_kg, 0);
  return [
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(h.plots.length)} thửa sở hữu`, `${count(h.leases.length)} thửa đang thuê`,
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
```

with:

```tsx
  const kg = h.rice.reduce((a, r) => a + r.wet_kg + r.dry_kg, 0);
  const produce = (h.produce ?? []).reduce((a, p) => a + p.kg, 0);
  return [
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(produce)} kg hoa màu`, `${count(h.plots.length)} thửa sở hữu`, `${count(h.leases.length)} thửa đang thuê`,
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (8 tests; the two integration files stay skipped).

- [ ] **Step 5: The README section and the spec amendments**

**README.md — edit 1 of 3.** Replace:

```markdown

The server decides every time and phase, the water levels, the pests (rolled at sowing and hidden until they fire), the yield, all prices, and land ownership, leases and reclaims. A client still sends a transplant and harvest quality, but v15.1 ignores it and uses 1.0 (anti-cheat decision D1) until the v15.2 minigames; transplanting and harvesting stay behind the 2 s work gate. As in v14, where a player stands is not verified, and the plots' look and the farm animations come from each client's own copy of the field state. Like the rest of the members table, the new `members.last_seen_at` is readable with the anon key, so anyone who has the key can see when each member last visited a room, to the hour (it is written at most once an hour, for the 14-day reclaim).
```

with:

```markdown

The server decides every time and phase, the water levels, the pests (rolled at sowing and hidden until they fire), the yield, all prices, and land ownership, leases and reclaims. A client still sends a transplant and harvest quality, but v15.1 ignores it and uses 1.0 (anti-cheat decision D1) until the v15.3 transplant minigame (v15.2's harvest minigame only gates the rice parts); transplanting and harvesting stay behind the 2 s work gate. As in v14, where a player stands is not verified, and the plots' look and the farm animations come from each client's own copy of the field state. Like the rest of the members table, the new `members.last_seen_at` is readable with the anon key, so anyone who has the key can see when each member last visited a room, to the hour (it is written at most once an hour, for the 14-day reclaim).
```

**README.md — edit 2 of 3.** Replace:

```markdown
- **v14:** as above, plus the daily cap: a script that reels at the gate lands at most 300 fish a day instead of 960, and a reel reported faster than the gate is a strike.
- **v15:** v15.1 ignores the transplant and harvest quality and uses 1.0 until the v15.2 minigames; a quality outside [0.9, 1.1] is a strike.
```

with:

```markdown
- **v14:** as above, plus the daily cap: a script that reels at the gate lands at most 300 fish a day instead of 960, and a reel reported faster than the gate is a strike.
- **v15:** v15.1 ignores the transplant and harvest quality and uses 1.0 until v15.3 (v15.2's harvest minigame gates the rice parts and sets no quality); a quality outside [0.9, 1.1] is a strike.
```

**README.md — edit 3 of 3.** Append at the end of the file, after a blank line:

```markdown
## v15.2: Nông cụ & hoa màu — liềm, máy gặt, bình phun, khoai, bắp, ớt

### DB migration

`supabase/migrations/0016_v15_2_crops.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor after `0015`, so the production order is `0012` → `0014` → `0013` → `0015` → `0016`. It requires `0013` and `0015`, because it re-creates their farm RPCs, the field sweep and the anti-cheat helpers and keeps their parts; it does not need `0014`. It adds `upland_crops` (one config row each for khoai lang, bắp and ớt, public read); the column `shop_items.upland`, the kind `tool` and 5 items (the three hoa-màu seeds, `tool_sickle` for 1 500 xu and `tool_sprayer` for 5 000 xu); on `crops` the crop's kind, the hoa-màu crop and its logs, the cut parts and the harvester job; the sprayer's tank on `farm_profiles`; the private table `produce_stock`; the `coin_ledger` reasons `harvester` and `produce_sell` (the list keeps `wipe`); and 7 guarded RPCs: `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`. It re-creates the farm actions it changes (`harvest` now serves hoa màu only and answers `wrong crop` on rice), the sweep (a finished harvester is paid first), `buy_farm_item` (tools, once each), `claim_farm_gift` (a sickle joins the gift), the field state, and `_ac_holdings` and `_ac_wipe` (the hoa màu and the tank). `tests/sql/v15-2-smoke.sql` checks it on a throwaway PostgreSQL cluster after the v15 and anti-cheat smokes (from the repo root: it re-runs `0016`, reads `tests/fixtures/upland-cases.json` and `crop-cases.json`, and ends with `tests/sql/anticheat-guards.sql`, whose loop now calls 42 guarded RPCs). Run every file with plain `psql -f`, never under `psql -1`: the guard file rolls back its own self-test.

> **Deploy order:** `0016` first, then the v15.2 client right after, ideally at a quiet hour. Until they reload, cached v15.1 clients cannot harvest rice: they have no sickle round, and `harvest` on rice answers `wrong crop`. A v15.2 client against a database without `0016` shows no hoa-màu seeds or tools, and the new actions, cutting rice included (a round's part goes through `harvest_part`), say "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016."
>
> **Re-running earlier migrations:** `0013` and `0015` put back their own versions of the functions `0016` re-creates, and their checks lack its values, so neither can be re-run as it is after `0016`: `0013`'s `shop_items` kind check lacks `tool` (the tools always exist) and its `coin_ledger` reasons lack `wipe`, `harvester` and `produce_sell`; `0015`'s reasons lack `harvester` and `produce_sell` (a problem once a harvester has been rented or hoa màu sold). Add the missing values to those lists first, then run them in order, `0013`, `0015`, and `0016` last (anti-cheat §11.3 rule 7).

### What's new in v15.2

- **Liềm and the harvest minigame:** rice is cut with a sickle in 6 parts. Each part is one round: hold Space, the mouse button or a finger to raise the sickle's power and let go inside the band, 8 bundles; 4 points pass (chuẩn 1, được 0,5). A failed round cuts nothing and can be retried at once. Each part pays a sixth of the plot's yield at that moment as wet rice, and the sixth part ends the season and a lease. Newcomers get a sickle with chú Tám's gift; anh Hai sells it for 1 500 xu.
- **Máy gặt:** chú Tám's co-op has a new tab that rents a harvester for 500 xu per part still uncut. It cuts the rest of the plot in 30 seconds, even a half-cut one, with no cancel and no refund.
- **Bình phun:** a 5 000 xu sprayer. **Nạp** in the bag (🎒 Giỏ đồ → 🌾 Nông cụ) turns one bottle into 3 sprays of that pesticide.
- **Hoa màu:** at làm đất, choose **Làm ruộng lúa** or **Lên luống**. Raised beds grow **khoai lang** (cuttings, about 48 h; a soaked bed rots the tubers), **bắp** (sown directly, about 60 h, two waves of armyworms) or **ớt** (a 10 h nursery, then transplanting and 3 pickings 12 h apart). Each has its own care, pests, handbook tab and seed at anh Hai's (800–1 500 xu); cô Út buys them fresh by the kg, with no drying.
- The plot panel, the task list, the shop (a **🛠️ Nông cụ** shelf), the depot and the handbook (a tab per crop and **Nông cụ**) cover all of it, and the HUD's rice line adds the hoa màu.

### Trust model (v15.2)

The server still decides every time, water level, pest, yield and price. A client now declares one more thing: that a harvest round succeeded (`harvest_part`). The server accepts a part only 8 to 120 s after its `begin_work`, so a script gains only time, one part per 8 s (a plot in 48 s instead of 1–3 minutes by hand), and never kg: the minigame multiplies nothing, and each part pays its share of the yield at the cut.

### Realtime budget (v15.2)

No new channel. A round sends `fa` every 2 s while it runs and `fp` after each part, about 36 `fa` and 6 `fp` for a whole plot by hand; the farmer's client refetches once when a harvester's 30 s are up. Older clients drop the new `fa` codes 9 (dig) and 10 (pick).
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 1 of 29.** Replace:

```markdown
**Builds on:** `main` @ `cd32174`. That commit has v13 (game mode), v14 (fishing pond, xu economy) and the lyrics/karaoke line from PR #10. v15 is developed on `feat/v15-field`. The stack is unchanged: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth and SECURITY DEFINER RPCs.
**Roadmap:** v13 = game mode + hall → v14 = fishing pond + xu economy → **v15 = rice paddies, land, crabs and snails (this doc)** → v16 = the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná).
```

with:

```markdown
**Builds on:** `main` @ `cd32174`. That commit has v13 (game mode), v14 (fishing pond, xu economy) and the lyrics/karaoke line from PR #10. v15 is developed on `feat/v15-field`. The stack is unchanged: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth and SECURITY DEFINER RPCs.
**Roadmap:** v13 = game mode + hall → v14 = fishing pond + xu economy → **v15 (this doc) = rice paddies and land (15.1), tools and hoa màu (15.2), crabs and snails (15.3)** → v16 = the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná).
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 2 of 29.** Replace:

```markdown
   The village reclaims land from owners who stopped coming.
3. **Gather crabs and snails** in the canal by hand and carry more in a bucket or a basket. This comes in the second phase (§4).

It also includes three minigames: transplanting, harvesting and crab-grabbing (second phase). The server stays authoritative, as in v14: every timer, roll, price, balance and ownership change happens in SECURITY DEFINER RPCs.
```

with:

```markdown
   The village reclaims land from owners who stopped coming.
3. **Gather crabs and snails** in the canal by hand and carry more in a bucket or a basket. This comes in v15.3 (§4).

It also includes three minigames: the harvest minigame gates the rice parts (v15.2); transplanting and crab-grabbing come in v15.3. The server stays authoritative, as in v14: every timer, roll, price, balance and ownership change happens in SECURITY DEFINER RPCs.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 3 of 29.** Replace:

```markdown
| 6 | Crab/snail containers | Their own containers (hands 3, bucket 15, basket 30), separate from the v14 fish bucket. Sold at the rice depot (A) |
| 7 | Farm actions | Actions with an animation and a progress bar, plus three minigames: transplanting, harvesting and crab-grabbing (B) |
| 8 | Absent owners | Absent 14 days in a row (no visit to the room) → the village reclaims the plot and refunds 50 % of the list price. A plot on lease is reclaimed when the lease ends. The owner may sell back to the village for 50 % at any time, and may sell to another player at a negotiated price |
```

with:

```markdown
| 6 | Crab/snail containers | Their own containers (hands 3, bucket 15, basket 30), separate from the v14 fish bucket. Sold at the rice depot (A) |
| 7 | Farm actions | Actions with an animation and a progress bar, plus the harvest minigame (v15.2) and two more, transplanting and crab-grabbing (v15.3) (B) |
| 8 | Absent owners | Absent 14 days in a row (no visit to the room) → the village reclaims the plot and refunds 50 % of the list price. A plot on lease is reclaimed when the lease ends. The owner may sell back to the village for 50 % at any time, and may sell to another player at a negotiated price |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 4 of 29.** Replace:

```markdown
- **e) Water scoring.** The water penalty is sampled every 15 minutes of crop time.
- **f) Minigame trust.** The 2-second work gate exists from `0013` on. v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1); v15.2 decides how a minigame quality comes back, which needs an SQL change.
- **g) Drying keeps the weight.** Drying changes the price, not the kilograms.
```

with:

```markdown
- **e) Water scoring.** The water penalty is sampled every 15 minutes of crop time.
- **f) Minigame trust.** The 2-second work gate exists from `0013` on. v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1); the harvest minigame (v15.2) only gates the rice parts, and how a transplant quality comes back is v15.3's question, which needs an SQL change.
- **g) Drying keeps the weight.** Drying changes the price, not the kilograms.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 5 of 29.** Replace:

```markdown
  - "per day" rules on the `Asia/Ho_Chi_Minh` calendar.
- **Migrations:** v15.1 is `0013_v15_field.sql` and v15.2 is `0016_v15_gather.sql` (`0014` is the lyrics hotfix and `0015` the anti-cheat layer, see the anti-cheat spec, D7). Each is additive and re-runnable: `if not exists`, `create or replace`, `drop … if exists`, and seeds use `on conflict do update`. The owner runs them in the Supabase SQL editor.
- **The field map is 800 × 480 world px** (cell 8). The v13 camera and view code (`computeView`, `cameraFor`) already scroll any map size. The first map task confirms this at 800 × 480 on desktop and phone view sizes.
```

with:

```markdown
  - "per day" rules on the `Asia/Ho_Chi_Minh` calendar.
- **Migrations:** v15.1 is `0013_v15_field.sql`, v15.2 is `0016_v15_2_crops.sql` and v15.3 is `0018_v15_3_gather.sql` (`0014` is the lyrics hotfix, `0015` the anti-cheat layer, see the anti-cheat spec, D7, and `0017` the v16 card corner). Each is additive and re-runnable: `if not exists`, `create or replace`, `drop … if exists`, and seeds use `on conflict do update`. The owner runs them in the Supabase SQL editor.
- **The field map is 800 × 480 world px** (cell 8). The v13 camera and view code (`computeView`, `cameraFor`) already scroll any map size. The first map task confirms this at 800 × 480 on desktop and phone view sizes.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 6 of 29.** Replace:

```markdown

One spec, two plans, and the owner ships after each phase.
```

with:

```markdown

One spec, three phases (v15.2 and v15.3 have their own specs), and the owner ships after each phase.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 7 of 29.** Replace:

```markdown

**v15.2 "Đồng vui"**
- The three minigames. Transplanting and harvesting then send a real quality score.
- Crab holes and snail beds, the critter containers, and selling crabs and snails.
- Pest snails picked from plots now land in your container.
```

with:

```markdown

**v15.2 "Nông cụ & hoa màu"** (`0016_v15_2_crops.sql`): see `2026-09-25-music-together-v15.2-design.md`. The sickle and the harvest minigame (a rice plot is cut in 6 parts), the harvester, the sprayer, and khoai lang, bắp and ớt on raised beds.

**v15.3 "Đồng vui"** (`0018_v15_3_gather.sql`)
- Crab holes and snail beds, the critter containers (`box_bucket`, `box_basket`), and selling crabs and snails.
- Pest snails picked from plots now land in your container.
- The transplant minigame (transplanting stays behind the 2 s gate until then) and the crab minigame.
- How a transplant quality comes back (D1), with its soft signal.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 8 of 29.** Replace:

```markdown
 └─ components/game/farm/*             CoopPanel, FarmShopPanel, RiceDepotPanel, PlotPanel, DryingPanel,
                                       Handbook, FarmTasks; v15.2: TransplantGame, HarvestGame, CrabGame
lib/game/farm/                         pure: catalog, crop (schedule, water, pests-visible, yield preview, due tasks),
```

with:

```markdown
 └─ components/game/farm/*             CoopPanel, FarmShopPanel, RiceDepotPanel, PlotPanel, DryingPanel,
                                       Handbook, FarmTasks; v15.2: HarvestGame; v15.3: TransplantGame, CrabGame
lib/game/farm/                         pure: catalog, crop (schedule, water, pests-visible, yield preview, due tasks),
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 9 of 29.** Replace:

````markdown
                                       rice, containers, crabs, snails
supabase/migrations/0013_v15_field.sql, 0016_v15_gather.sql
```
````

with:

````markdown
                                       rice, containers, crabs, snails
supabase/migrations/0013_v15_field.sql, 0016_v15_2_crops.sql, 0018_v15_3_gather.sql
```
````

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 10 of 29.** Replace:

```markdown
- **Where you stand to act:** every plot has a use spot on an adjacent dike, facing the plot. Each NPC, the drying yard and each portal has one use spot.
- **v15.2 gathering spots:** 6 crab holes along the canal banks, at least 40 px apart and each with a use spot on the bank, and 4 snail beds at the canal's shallow edges.
- **Walkability:** dikes, bridges, roads and yards are walkable. Plot interiors are **walkable**, so you can step into your paddy, and the collision grid does not block them. Water in the canal is blocked.
```

with:

```markdown
- **Where you stand to act:** every plot has a use spot on an adjacent dike, facing the plot. Each NPC, the drying yard and each portal has one use spot.
- **v15.3 gathering spots:** 6 crab holes along the canal banks, at least 40 px apart and each with a use spot on the bank, and 4 snail beds at the canal's shallow edges.
- **Walkability:** dikes, bridges, roads and yards are walkable. Plot interiors are **walkable**, so you can step into your paddy, and the collision grid does not block them. Water in the canal is blocked.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 11 of 29.** Replace:

```markdown
| `ripening` | 40·s | 48·s | drain |
| `ripe` | 48·s | 48·s + 12 h | harvest, no penalty |
| overripe | 48·s + 12 h | +48 h after ripe → lost | harvest at −2 %/h, cap −60 % |
```

with:

```markdown
| `ripening` | 40·s | 48·s | drain |
| `ripe` | 48·s | 48·s + 12 h | harvest by sickle in 6 parts or by the harvester (v15.2 §6), no penalty |
| overripe | 48·s + 12 h | +48 h after ripe → lost | harvest at −2 %/h, cap −60 % |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 12 of 29.** Replace:

````markdown
```
kg = max(ceil(0.1 · base), round(base · land · Mcare · Mseed · Mwater · Mpest · Mlate · qT · qH))
```
````

with:

````markdown
```
kg = max(ceil(0.1 · base), round(base · land · Mcare · Mseed · Mwater · Mpest · Mlate · qT))
```
````

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 13 of 29.** Replace:

```markdown
| `Mlate` | 1 − min(0.6, 0.02 · hours after the ripe window) |
| `qT`, `qH` | transplant and harvest quality; always 1.0 in v15.1 (the server ignores the reported value, D1) |
```

with:

```markdown
| `Mlate` | 1 − min(0.6, 0.02 · hours after the ripe window) |
| `qT` | transplant quality; always 1.0 until v15.3 (the server ignores the reported value, D1). The harvest quality `qH` is gone: the harvest minigame (v15.2) gates the 6 parts and multiplies nothing |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 14 of 29.** Replace:

```markdown

- **Harvest:**
  - `harvest(room, plot, quality)` needs `ripe` or later, plus the work gate (§11.4).
  - It adds the yield as **wet** rice of the variety to the farmer's `rice_stock`, deletes the crop, leaves the plot bare, and ends a lease.
- **Drying:**
```

with:

```markdown

- **Harvest** (v15.2 §6): by sickle in 6 parts (`begin_work` + `harvest_part`, one harvest-minigame round each) or by the harvester (`rent_harvester`, 30 s), from `ripe` on. `harvest` now serves hoa màu only.
  - Each part adds its share of the yield at the cut as **wet** rice of the variety to the farmer's `rice_stock`. The sixth part (or the harvester's end) deletes the crop, leaves the plot bare, and ends a lease.
- **Drying:**
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 15 of 29.** Replace:

```markdown
| `spray_fungus` | pesticide | Thuốc trừ bệnh | 900 |
| `box_bucket` (v15.2) | critter_box | Xô nhựa | 150, capacity 15 |
| `box_basket` (v15.2) | critter_box | Giỏ tre | 600, capacity 30 |
```

with:

```markdown
| `spray_fungus` | pesticide | Thuốc trừ bệnh | 900 |
| `box_bucket` (v15.3) | critter_box | Xô nhựa | 150, capacity 15 |
| `box_basket` (v15.3) | critter_box | Giỏ tre | 600, capacity 30 |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 16 of 29.** Replace:

```markdown
- v14's `_fishing_state.owned` is filtered to fishing kinds, so farm items never show in the fishing bag.
```

with:

```markdown
- v14's `_fishing_state.owned` is filtered to fishing kinds, so farm items never show in the fishing bag.
- **v15.2** (its spec §9) adds the hoa-màu seeds (kind `seed`, with `shop_items.upland`) and the tools (a new kind `tool`: the sickle and the sprayer, bought once each).
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 17 of 29.** Replace:

```markdown

**Crabs and snails (v15.2):**
```

with:

```markdown

**Crabs and snails (v15.3):**
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 18 of 29.** Replace:

```markdown
| `members` (altered) | `add column if not exists last_seen_at timestamptz` |
| `coin_ledger` (altered) | the `reason` check is replaced to add `rent`, `land_buy`, `land_sell`, `land_refund`, `lease_pay`, `lease_income`, `farm_buy`, `rice_sell` (v15.2 adds `critter_sell`) |
```

with:

```markdown
| `members` (altered) | `add column if not exists last_seen_at timestamptz` |
| `coin_ledger` (altered) | the `reason` check is replaced to add `rent`, `land_buy`, `land_sell`, `land_refund`, `lease_pay`, `lease_income`, `farm_buy`, `rice_sell` (v15.2 adds `harvester` and `produce_sell`; v15.3 adds `critter_sell`) |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 19 of 29.** Replace:

```markdown
3. They use `q` = 1.0 whatever the client sends (v15.1, D1) and clear `work`.
```

with:

```markdown
3. They use `q` = 1.0 whatever the client sends (v15.1, D1) and clear `work`.
4. From v15.2 (its spec §6.2) the 2 s gate covers transplanting and the hoa-màu pickings (`harvest`). Rice is cut in parts with `harvest_part`, each accepted 8–120 s after its own `begin_work`.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 20 of 29.** Replace:

```markdown

**Clients only report two things:** the transplant and harvest quality, which v15.1 ignores (always 1.0, D1) behind a 2 s gate, and (v15.2) crab hits, bounded to 3 per hole visit.
```

with:

```markdown

**Clients only report a few things:** the transplant and harvest quality, which v15.1 ignores (always 1.0, D1) behind a 2 s gate; from v15.2 a harvest round's success, which gates one rice part behind an 8 s gate and has no effect on the yield; and (v15.3) crab hits, bounded to 3 per hole visit.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 21 of 29.** Replace:

```markdown
- **`fa` {t, id, a}:** a farm animation code, played for 2.5 s. `a = 0` stops it.
  - Codes: 1 transplant, 2 harvest, 3 pump, 4 spray, 5 fertilize, 6 grab a crab, 7 pick snails, 8 prepare.
  - It is a control message (FIFO), and an action sends at most one.
```

with:

```markdown
- **`fa` {t, id, a}:** a farm animation code, played for 2.5 s. `a = 0` stops it.
  - Codes: 1 transplant, 2 harvest, 3 pump, 4 spray, 5 fertilize, 6 grab a crab, 7 pick snails, 8 prepare; v15.2 adds 9 dig and 10 pick.
  - It is a control message (FIFO), and an action sends at most one.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 22 of 29.** Replace:

```markdown

- **CoopPanel (chú Tám)**, with four tabs:
  - **Đất làng**: free plots, rent 10 000 xu.
```

with:

```markdown

- **CoopPanel (chú Tám)**, with four tabs (v15.2 adds a fifth, **Máy gặt**, to rent the harvester):
  - **Đất làng**: free plots, rent 10 000 xu.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 23 of 29.** Replace:

```markdown
  - **Của tôi**: my plot, my offers, incoming offers with Đồng ý / Từ chối, sell back.
- **FarmShopPanel (anh Hai):** seeds, fertilizers, pesticides with quantity steppers; containers in v15.2. Each row shows its use in one line ("Bón thúc đẻ nhánh").
- **RiceDepotPanel (cô Út):** rice per variety, wet and dry, with "Bán" / "Bán hết" and the price; crabs and snails in v15.2.
- **DryingPanel:** the 4 slots, "Phơi lúa" (variety + kg), "Lấy lúa".
```

with:

```markdown
  - **Của tôi**: my plot, my offers, incoming offers with Đồng ý / Từ chối, sell back.
- **FarmShopPanel (anh Hai):** seeds, fertilizers, pesticides with quantity steppers; tools and hoa-màu seeds in v15.2, containers in v15.3. Each row shows its use in one line ("Bón thúc đẻ nhánh").
- **RiceDepotPanel (cô Út):** rice per variety, wet and dry, with "Bán" / "Bán hết" and the price; hoa màu in v15.2, crabs and snails in v15.3.
- **DryingPanel:** the 4 slots, "Phơi lúa" (variety + kg), "Lấy lúa".
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 24 of 29.** Replace:

```markdown

## 15. v15.2 — gathering and minigames (`0016_v15_gather.sql`)
```

with:

```markdown

## 15. v15.3 — gathering and minigames (`0018_v15_3_gather.sql`)
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 25 of 29.** Replace:

```markdown

Each returns a quality `q` in [0.9, 1.1]; how the server accepts it after D1 is decided in the v15.2 plan.
```

with:

```markdown

Each returns a quality `q` in [0.9, 1.1]; how the server accepts it after D1 is decided in v15.3.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 26 of 29.** Replace:

```markdown
  - About 12–15 s.
- **Harvesting (`HarvestGame`):** hold to raise the sickle's power bar and release inside the sweet band to cut a bundle.
  - Releasing early leaves grain; releasing late shatters it.
  - 8 bundles, scored the same way.
  - About 10–14 s.
- **Crab grabbing (`CrabGame`):** a hand hovers over the hole while the crab's claws open and close on a rhythm that speeds up with each grab.
```

with:

```markdown
  - About 12–15 s.
- **Harvesting (`HarvestGame`):** moved to v15.2 §6.2, where one round (8 bundles) gates one of a rice plot's 6 parts and sets no quality.
- **Crab grabbing (`CrabGame`):** a hand hovers over the hole while the crab's claws open and close on a rhythm that speeds up with each grab.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 27 of 29.** Replace:

```markdown

All three are pure state machines in `lib/game/farm/minigames.ts`, with seeded tests, plus thin overlay components. They follow the v14 input rules: typing guard, pointer, touch, Space.
```

with:

```markdown

Both are pure state machines in `lib/game/farm/minigames.ts` (beside v15.2's HarvestGame), with seeded tests, plus thin overlay components. They follow the v14 input rules: typing guard, pointer, touch, Space.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 28 of 29.** Replace:

```markdown
  - `clock.ts`, `state.ts` (parsers), `messages.ts`, `rpc.ts` (mocked Supabase).
  - v15.2: the minigame state machines with seeded inputs.
- **Shared fixtures:** `tests/fixtures/crop-cases.json`, about 12 crop timelines (actions with times) with their expected yields. The TS tests assert them, and the SQL smoke replays the same cases through the private functions and asserts the same kilograms.
```

with:

```markdown
  - `clock.ts`, `state.ts` (parsers), `messages.ts`, `rpc.ts` (mocked Supabase).
  - the minigame state machines with seeded inputs: HarvestGame in v15.2, the others in v15.3.
- **Shared fixtures:** `tests/fixtures/crop-cases.json`, about 12 crop timelines (actions with times) with their expected yields. The TS tests assert them, and the SQL smoke replays the same cases through the private functions and asserts the same kilograms.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 29 of 29.** Replace:

```markdown

  v15.2 adds its own smoke (`v15-gather-smoke.sql`).
- **Maps:**
```

with:

```markdown

  v15.2 adds its own smoke (`v15-2-smoke.sql`), and v15.3 adds `v15-gather-smoke.sql`.
- **Maps:**
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 1 of 26.** Replace:

```markdown
**Source:** the tamper-surface audit of 2026-09-25. Its hole numbers H1–H5 are kept here. The owner's answers to its open questions are §2 (D1–D8).
**Order:** `0014_lyrics_lockdown.sql` (hotfix on `main`) and v15.1 (`0013`) → **anti-cheat (`0015_anticheat.sql`, this doc)** → v15.2 (`0016_v15_gather.sql`) → v16.
```

with:

```markdown
**Source:** the tamper-surface audit of 2026-09-25. Its hole numbers H1–H5 are kept here. The owner's answers to its open questions are §2 (D1–D8).
**Order:** `0014_lyrics_lockdown.sql` (hotfix on `main`) and v15.1 (`0013`) → **anti-cheat (`0015_anticheat.sql`, this doc)** → v15.2 (`0016_v15_2_crops.sql`) → v16 (`0017_v16_cards.sql`) → v15.3 (`0018_v15_3_gather.sql`).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 2 of 26.** Replace:

```markdown
- **Queue title and duration are still declared by the client** until server-signed metadata comes (D8, §16).
```

with:

```markdown
- **Queue title and duration are still declared by the client** until server-signed metadata comes (D8, §16).
- **A rice part's success is declared by the client** (v15.2 `harvest_part`), like the reel. A script can cut one part per 8 s, a whole plot in 48 s against about 1–3 min by hand. It gains only time, never kg: there is no quality factor, and each part pays its share of the yield at the cut (v15.2 §11.5).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 3 of 26.** Replace:

```markdown
|---|---|---|
| D1 | Farm quality in v15.1 | Ignored (always 1.0) until the v15.2 minigames. A separate v15.1 task does this inside `0013`; this spec relies on it (§6.4). |
| D2 | What the 5-minute lock blocks | Game actions only: fishing, farming, land, and the fishing and farm shops. The daily check-in and the farm gift count as fishing and farming. Chat, the music queue and all reads stay open (§9.3). |
```

with:

```markdown
|---|---|---|
| D1 | Farm quality in v15.1 | Ignored (always 1.0) until the v15.3 transplant minigame (v15.2's harvest minigame gates the rice parts and sets no quality). A separate v15.1 task does this inside `0013`; this spec relies on it (§6.4). |
| D2 | What the 5-minute lock blocks | Game actions only: fishing, farming, land, and the fishing and farm shops. The daily check-in and the farm gift count as fishing and farming. Chat, the music queue and all reads stay open (§9.3). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 4 of 26.** Replace:

```markdown
| D6 | Chat on a wipe | Chat messages are kept. Only that user's catch and land announcements are deleted. |
| D7 | Migration order | `0014_lyrics_lockdown.sql` is a separate hotfix on `main`. The anti-cheat is `0015_anticheat.sql`, which requires `0012` and `0013`. The v15.2 gather migration moves from `0014` to `0016`. |
| D8 | Queue song metadata | Format and length checks now. Server-signed metadata comes later and is out of scope. |
```

with:

```markdown
| D6 | Chat on a wipe | Chat messages are kept. Only that user's catch and land announcements are deleted. |
| D7 | Migration order | `0014_lyrics_lockdown.sql` is a separate hotfix on `main`. The anti-cheat is `0015_anticheat.sql`, which requires `0012` and `0013`. The gather migration, first planned as `0014`, is v15.3's `0018_v15_3_gather.sql`; v15.2 is `0016_v15_2_crops.sql` and v16 is `0017`. |
| D8 | Queue song metadata | Format and length checks now. Server-signed metadata comes later and is out of scope. |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 5 of 26.** Replace:

```markdown
- **In `0013`:** the v15.1 task makes `_farm_do_transplant` and `_farm_do_harvest` use 1.0 whatever `p_quality` is. The v15 smoke's "quality clamped" assertion becomes "quality ignored = 1".
- **In `0015`:** the public wrappers `transplant` and `harvest` gain the `quality_range` hard check (§7.2). It stays when v15.2 brings a real quality back.
```

with:

```markdown
- **In `0013`:** the v15.1 task makes `_farm_do_transplant` and `_farm_do_harvest` use 1.0 whatever `p_quality` is. The v15 smoke's "quality clamped" assertion becomes "quality ignored = 1".
- **In `0015`:** the public wrappers `transplant` and `harvest` gain the `quality_range` hard check (§7.2). It stays when v15.3 brings a real quality back.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 6 of 26.** Replace:

```markdown
| `reel_too_fast` | `finish_cast` | `p_success = true`, the cast has not expired, and `now() < bite_at + 0.9·min_reel_ms`. This is the existing `too_early` branch. | none: the answer stays `{"result":"lost","why":"too_early"}` plus the envelope | See the timing argument below the table. |
| `quality_range` | `transplant`, `harvest` | `p_quality` is null, NaN or ±∞, or outside [0.9 − 1e-9, 1.1 + 1e-9]. NaN is larger than every number in PostgreSQL, so the range test catches it. | `invalid quality` | v15.1 sends exactly 1 (`useFarmController` `finishWork`). v15.2's `0.9 + 0.2·score/12` stays in range; the 1e-9 tolerance absorbs floating-point error. |
| `bad_plot` | the 19 plot RPCs (§10.3) | `p_plot` is null or outside 1–10 | `invalid plot` | Plot numbers come from `field_state` (`PlotView.no`) and from the map's plot interactables. `MAX_PLOT = 10`. |
| `bad_slot` | `dry_collect` | `p_slot` is null or outside 1–4 | `invalid slot` | `DryingPanel` loops over `1..DRYING_SLOTS` (4). |
```

with:

```markdown
| `reel_too_fast` | `finish_cast` | `p_success = true`, the cast has not expired, and `now() < bite_at + 0.9·min_reel_ms`. This is the existing `too_early` branch. | none: the answer stays `{"result":"lost","why":"too_early"}` plus the envelope | See the timing argument below the table. |
| `quality_range` | `transplant`, `harvest` | `p_quality` is null, NaN or ±∞, or outside [0.9 − 1e-9, 1.1 + 1e-9]. NaN is larger than every number in PostgreSQL, so the range test catches it. | `invalid quality` | v15.1 sends exactly 1 (`useFarmController` `finishWork`). v15.3's `0.9 + 0.2·score/12` stays in range; the 1e-9 tolerance absorbs floating-point error. |
| `bad_plot` | the 24 plot RPCs (§10.3) | `p_plot` is null or outside 1–10 | `invalid plot` | Plot numbers come from `field_state` (`PlotView.no`) and from the map's plot interactables. `MAX_PLOT = 10`. |
| `bad_slot` | `dry_collect` | `p_slot` is null or outside 1–4 | `invalid slot` | `DryingPanel` loops over `1..DRYING_SLOTS` (4). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 7 of 26.** Replace:

```markdown
| `bad_work` | `begin_work` | `p_work` is null or not `transplant`/`harvest` | `invalid work` | `PlotRun.work` is `"transplant" \| "harvest"`. |
| `bad_qty` | `buy_item`, **after** the kind check | bait `p_qty` null or outside 1–99; gear `p_qty` ≠ 1 | `invalid quantity` | `ShopPanel` sends bait `n` ∈ [1, `maxBuyQty` ≤ 99] and gear 1. Checking the kind first spares the old v14 client, which offers farm items as bait with quantities up to 99 (§7.3). |
```

with:

```markdown
| `bad_work` | `begin_work` | `p_work` is null or not `transplant`/`harvest` | `invalid work` | `PlotRun.work` is `"transplant" \| "harvest"`. |
| `bad_work` | `tend_crop` (`0016`) | `p_act` is null or not `lat_day`/`vun_goc` | `invalid act` | `plotActions` emits acts only from the crop's config, whose act ids the v15.2 smoke pins to {`lat_day`, `vun_goc`}. |
| `bad_qty` | `buy_item`, **after** the kind check | bait `p_qty` null or outside 1–99; gear `p_qty` ≠ 1 | `invalid quantity` | `ShopPanel` sends bait `n` ∈ [1, `maxBuyQty` ≤ 99] and gear 1. Checking the kind first spares the old v14 client, which offers farm items as bait with quantities up to 99 (§7.3). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 8 of 26.** Replace:

```markdown
| `bad_qty` | `dry_start` | `p_kg` null or < 1 | `invalid quantity` | `DryingPanel` `n` ∈ [1, wet stock]; it only lists varieties with wet stock > 0. |
| `bad_price` | `list_plot`, `set_sublease` | a non-null price outside 1–5 000 000 / 1–100 000 (the economy spec's caps) | `invalid price` | `CoopPanel` sends only prices that pass `toPrice` → `priceRefusal` → `priceOk`. `LandButton` stays disabled unless the refusal is null, including "" and "0". |
```

with:

```markdown
| `bad_qty` | `dry_start` | `p_kg` null or < 1 | `invalid quantity` | `DryingPanel` `n` ∈ [1, wet stock]; it only lists varieties with wet stock > 0. |
| `bad_qty` | `sell_produce` (`0016`), after `_wallet_lock` | `p_kg` null or < 1 | `invalid quantity` | `RiceDepotPanel`'s produce rows send kg ∈ [1, stock], and "Bán hết" sends the stock (≥ 1). |
| `bad_price` | `list_plot`, `set_sublease` | a non-null price outside 1–5 000 000 / 1–100 000 (the economy spec's caps) | `invalid price` | `CoopPanel` sends only prices that pass `toPrice` → `priceRefusal` → `priceOk`. `LandButton` stays disabled unless the refusal is null, including "" and "0". |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 9 of 26.** Replace:

```markdown
| `no snails` | `pick_snails` | someone picked them first |
| `invalid video`, `video too long`, `duration unknown`, `banned keyword`, `order limit reached` | queue | the rules changed while the UI was stale; two tabs. The queue never strikes (R22). |
```

with:

```markdown
| `no snails` | `pick_snails` | someone picked them first |
| `too fast` (the part gate), `work expired`, `harvesting`, `harvester busy`, `lease ending`, `lease ends` | `harvest_part`, `begin_work`, `rent_harvester`, farm care (`0016`) | two tabs; a stale state; a disconnect; a lease or a harvester running out |
| `no sickle`, `no sprayer`, `already owned`, `wrong crop`, `invalid crop`, `not enough crop`, `invalid quantity` (a tool with a quantity other than 1) | farm, `load_sprayer`, `buy_farm_item`, `sell_produce` (`0016`) | stale state; two tabs; **the cached v15.1 client**, whose shop shows a stepper on tool rows and whose rice harvest gets `wrong crop` |
| `invalid video`, `video too long`, `duration unknown`, `banned keyword`, `order limit reached` | queue | the rules changed while the UI was stale; two tabs. The queue never strikes (R22). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 10 of 26.** Replace:

```markdown
| `kind_mismatch` | `buy_item` | an existing priced item of a non-fishing kind | the old v14 client lists farm items as bait |
| `kind_mismatch` | `buy_farm_item` | an existing priced item that is not a seed, fertilizer or pesticide | catalogs change; v15.2 adds `critter_box` |
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray` | an existing item of the wrong kind | as above |

- **Not logged:** every refusal in §7.3.
- **Later, v15.2 (`0016`):** a soft counter for "the quality is always 1.1".
```

with:

```markdown
| `kind_mismatch` | `buy_item` | an existing priced item of a non-fishing kind | the old v14 client lists farm items as bait |
| `kind_mismatch` | `buy_farm_item` | an existing priced item that is not a seed, fertilizer, pesticide or (from `0016`) tool | catalogs change; v15.3 adds `critter_box` |
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |

- **Not logged:** every refusal in §7.3.
- **Later, v15.3 (`0018`):** a soft counter for "the quality is always 1.1".
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 11 of 26.** Replace:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 35 game RPCs |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

with:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 42 game RPCs (35 in `0015`, 7 more in `0016`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 12 of 26.** Replace:

```markdown
  - plus `sell_rice`, `buy_farm_item` and `claim_farm_gift`.
- **v15.2:** the gather RPCs in `0016` (§11.3).
```

with:

```markdown
  - plus `sell_rice`, `buy_farm_item` and `claim_farm_gift`.
- **v15.2 (7, `0016`):** `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`, 42 in all. The gather RPCs come with v15.3's `0018` (§11.3).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 13 of 26.** Replace:

```markdown
| `wallets` | One last `coin_ledger` row (`delta = −coins`, `balance = 0`, `reason = 'wipe'`, `ref = 'wipe #<id>'`), then the wallet row is deleted. This clears xu and the daily and bonus counters. |
| `inventory` | All rows deleted: gear, bait, seeds, fertilizers, pesticides. |
| `fishing_profiles`, `casts`, `fish` | Deleted. |
```

with:

```markdown
| `wallets` | One last `coin_ledger` row (`delta = −coins`, `balance = 0`, `reason = 'wipe'`, `ref = 'wipe #<id>'`), then the wallet row is deleted. This clears xu and the daily and bonus counters. |
| `inventory` | All rows deleted: gear, bait, seeds, fertilizers, pesticides and (from `0016`) tools. |
| `fishing_profiles`, `casts`, `fish` | Deleted. |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 14 of 26.** Replace:

```markdown
| `rice_stock` | Deleted. |
| Catch and land announcements (D6) | `delete from chat_messages where system and about_account_id = <account>`. Realtime DELETE events remove them from open chats. |
```

with:

```markdown
| `rice_stock` | Deleted. |
| `produce_stock` (`0016`) | Deleted: the hoa màu. |
| The sprayer's tank (`0016`) | Emptied: `farm_profiles.tank_item` null and `tank_charges` 0. The profile stays, so the gift stays claimed. |
| Catch and land announcements (D6) | `delete from chat_messages where system and about_account_id = <account>`. Realtime DELETE events remove them from open chats. |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 15 of 26.** Replace:

```markdown
| `plot_leases` held | Deleted by step 0b. A village plot is free again; an owner's plot goes back to its owner, who keeps the rent. |
| `crops` farmed | Removed by the existing sweep step 4 once the plot has no farmer. |
| `land_offers` made | Deleted by steps 0a and 0b. |
```

with:

```markdown
| `plot_leases` held | Deleted by step 0b. A village plot is free again; an owner's plot goes back to its owner, who keeps the rent. |
| `crops` farmed | Removed by the existing sweep step 4 once the plot has no farmer. A running harvester job is never paid (v15.2 R10). |
| `land_offers` made | Deleted by steps 0a and 0b. |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 16 of 26.** Replace:

```markdown

**The 19 plot RPCs** are the ones that check `bad_plot`: `rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot`, `buy_listed_plot`, `offer_plot`, `set_sublease`, `rent_sublease`, `abandon_crop`, `prepare_plot`, `apply_fertilizer`, `soak_seed`, `sow_seed`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`.
```

with:

```markdown

**The 24 plot RPCs** are the ones that check `bad_plot`: `rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot`, `buy_listed_plot`, `offer_plot`, `set_sublease`, `rent_sublease`, `abandon_crop`, `prepare_plot`, `apply_fertilizer`, `soak_seed`, `sow_seed`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`, and from `0016` `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop` and `tend_crop`.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 17 of 26.** Replace:

```markdown
| `water` | `bad_plot`, then `bad_water` |
| `dry_start` | `bad_qty` (kg) |
```

with:

```markdown
| `water` | `bad_plot`, then `bad_water` |
| `prepare_beds`, `harvest_part`, `rent_harvester` (`0016`) | `bad_plot` |
| `plant_crop` (`0016`) | `bad_plot`, then `kind_mismatch` (soft, error `invalid item`) when the item exists with another kind than `seed` |
| `tend_crop` (`0016`) | `bad_plot`, then `bad_work` (error `invalid act`) |
| `dry_start` | `bad_qty` (kg) |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 18 of 26.** Replace:

```markdown
| `sell_rice(text, text, boolean, integer)` | After `_wallet_lock`: `bad_qty` (kg, dry), then the existing variety check. |
| `buy_farm_item(text, text, integer)` | After reading the item: `kind_mismatch` (soft, error `item not available`), then `bad_qty`. More than 99 held still raises `invalid quantity` unlogged (§7.3). |
| `claim_farm_gift(text)` | — |
```

with:

```markdown
| `sell_rice(text, text, boolean, integer)` | After `_wallet_lock`: `bad_qty` (kg, dry), then the existing variety check. |
| `buy_farm_item(text, text, integer)` | After reading the item: `kind_mismatch` (soft, error `item not available`), then `bad_qty`. More than 99 held still raises `invalid quantity` unlogged (§7.3). From `0016` a `tool` is a farm kind too, and a tool with a quantity other than 1 raises `invalid quantity` unlogged (v15.2 R18). |
| `claim_farm_gift(text)` | — |
| `load_sprayer(text, text)` (`0016`) | `kind_mismatch` (soft, error `invalid item`) when the item exists with another kind than `pesticide`. |
| `sell_produce(text, text, integer)` (`0016`) | After `_wallet_lock`: `bad_qty` (kg). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 19 of 26.** Replace:

```markdown
1. **A re-created game RPC keeps its guard.** Any `create or replace` of a guarded RPC keeps its `_ac_account`/`_ac_play` call, its hard checks and its explicit grant.
2. **New game RPCs start guarded** (deny by default, R23). For `0016`: `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters`.
   - `crab_finish` with `hits` outside 0–3 is a hard `bad_qty`.
```

with:

```markdown
1. **A re-created game RPC keeps its guard.** Any `create or replace` of a guarded RPC keeps its `_ac_account`/`_ac_play` call, its hard checks and its explicit grant.
2. **New game RPCs start guarded** (deny by default, R23). For `0016` (v15.2): `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`. The gather RPCs `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters` come with `0018` (v15.3).
   - `crab_finish` with `hits` outside 0–3 is a hard `bad_qty`.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 20 of 26.** Replace:

```markdown
   - `_land_sale` and `finish_cast` keep `system` and `about_account_id`.
4. **A new `coin_ledger` reason check keeps `'wipe'`.** This applies to v15.2's `critter_sell`.
5. **Wider honest inputs widen the hard check.** A migration that widens the range of honest inputs widens the matching hard check in the same migration, and ships before its client.
```

with:

```markdown
   - `_land_sale` and `finish_cast` keep `system` and `about_account_id`.
4. **A new `coin_ledger` reason check keeps `'wipe'`.** This applies to v15.2's `harvester` and `produce_sell`, then v15.3's `critter_sell`.
5. **Wider honest inputs widen the hard check.** A migration that widens the range of honest inputs widens the matching hard check in the same migration, and ships before its client.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 21 of 26.** Replace:

```markdown
6. After 7 days, the review (§9.8), then `enforce` in /admin.
7. Later, `0016_v15_gather.sql`, keeping the guards (§11.3).
```

with:

```markdown
6. After 7 days, the review (§9.8), then `enforce` in /admin.
7. Later, `0016_v15_2_crops.sql` (v15.2), then `0017_v16_cards.sql` (v16) and `0018_v15_3_gather.sql` (v15.3), keeping the guards (§11.3).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 22 of 26.** Replace:

```markdown
- the modes, how to review, and the deploy order;
- the updated trust models (v14: the daily cap; v15: quality ignored until v15.2).
```

with:

```markdown
- the modes, how to review, and the deploy order;
- the updated trust models (v14: the daily cap; v15: quality ignored until v15.3).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 23 of 26.** Replace:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat` |
| events heading | `Ghi nhận ({n})` |
```

with:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat` |
| events heading | `Ghi nhận ({n})` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 24 of 26.** Replace:

```markdown
   - every hard signal gives `strike: 1`, committed: a `strike_1` row and `locked_until` ≈ now + 5 min;
   - each of the 35 guarded RPCs then raises `account locked` for that account, with a numeric detail and the hint `anticheat` (the call list is the one in `anticheat-guards.sql`);
   - `fishing_state` has `lock`, and `field_state`, `fishing_board`, `touch_room`, chat and the queue still work;
```

with:

```markdown
   - every hard signal gives `strike: 1`, committed: a `strike_1` row and `locked_until` ≈ now + 5 min;
   - each of the guarded RPCs (35 in `0015`, 42 from `0016`) then raises `account locked` for that account, with a numeric detail and the hint `anticheat` (the call list is the one in `anticheat-guards.sql`);
   - `fishing_state` has `lock`, and `field_state`, `fishing_board`, `touch_room`, chat and the queue still work;
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 25 of 26.** Replace:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the 35 guarded RPCs with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads; each must succeed.
```

with:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads; each must succeed.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 26 of 26.** Replace:

```markdown
- **Cosmetic Realtime spoofing:** lobby spoofing, reaction and presence names, and the `[reply:…]` prefix (§14).
- **The v15.2 soft signal** "quality always 1.1", which comes with `0016`.
- **The lyrics hole (H1) and its broadcast budget**, which `0014` covers.
```

with:

```markdown
- **Cosmetic Realtime spoofing:** lobby spoofing, reaction and presence names, and the `[reply:…]` prefix (§14).
- **The v15.3 soft signal** "quality always 1.1", which comes with `0018`.
- **A soft counter for rice parts claimed under 9 s** after their `begin_work` (v15.2 §11.5).
- **The lyrics hole (H1) and its broadcast budget**, which `0014` covers.
```

**docs/superpowers/specs/2026-09-25-music-together-economy-design.md.** Replace:

```markdown
- One season's profit equals 30–60 hours of fishing at multiplier 1. The fish price index (§5) narrows that gap as rooms get richer.
```

with:

```markdown
- One season's profit equals 30–60 hours of fishing at multiplier 1. The fish price index (§5) narrows that gap as rooms get richer.
- **v15.2** (`2026-09-25-music-together-v15.2-design.md` §10) restates this table: a hand harvest adds no per-season cost (the sickle is a one-time tool), the harvester adds 3 000, and it adds the hoa-màu seasons (khoai lang, bắp, ớt).
```

- [ ] **Step 6: The final checks**

Run, from the repo root:
- `pnpm test` → Expected: your Task 1 baseline plus 3 test files and 166 tests passed and 1 file and 4 tests skipped, none failing: from `5442a8b`, 102 files passed / 12 skipped (939 tests passed / 71 skipped).
- `npx tsc --noEmit` → clean, and `npx eslint components/admin/AnticheatTab.tsx lib/admin.ts tests/integration/v15-2.test.ts tests/integration/v15.test.ts tests/unit/admin-anticheat.test.tsx` → clean.
- `pnpm lint` → the baseline's 33 problems (21 errors, 12 warnings), all in files this plan does not touch.
- `pnpm build` → compiles (in a checkout without `.env.local`: `NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_test_key pnpm build`).
- `bash "$SCRATCH/v152-sql.sh"` → `ALL OK` (Task 5's output).

- [ ] **Step 7: Commit**

Commit message:

```text
docs(v15.2): the README section, the spec amendments, the admin's hoa màu and the integration tests

components/admin/AnticheatTab.tsx: the holdings line counts the hoa màu after the rice ("· 45 kg hoa màu"), and
lib/admin.ts reads 0016's produce and tank (older answers lack them). README.md: a v15.2 section (the migration, the
deploy order, re-running, what's new, the trust model and the Realtime budget), and the v15 trust lines now say the
transplant quality waits for v15.3. The v15.2 spec's §3 amendments land in the v15, anti-cheat and economy specs, with
v15.3 named 0018_v15_3_gather.sql (0017 is v16). tests/integration/v15-2.test.ts (skipped without SUPABASE_TEST_URL):
anon reads upland_crops, the gift's sickle, the honest refusals, and strike-0 envelopes in log mode; v15.test.ts counts
the three hoa-màu seeds.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add README.md components/admin/AnticheatTab.tsx docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md docs/superpowers/specs/2026-09-25-music-together-economy-design.md docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md lib/admin.ts tests/integration/v15-2.test.ts tests/integration/v15.test.ts tests/unit/admin-anticheat.test.tsx
git commit -F <message file>
```

After this commit the owner runs `0016` in the Supabase SQL editor (after `0015`), deploys the v15.2 client right after it (R28), and does the manual pass (§16): a khoai, a bắp and an ớt season, a rice plot cut 3 parts by hand and finished by the harvester, a failed round and a retry, the sprayer's load, reload and spray, and the phone layout of the round's overlay and the bag.
