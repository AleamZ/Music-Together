# Music Together v15.3 — "Đồng vui" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gathering by the canal and the transplant minigame: 6 crab holes with a crab-grabbing minigame (CrabGame), 4 snail beds, hands of 3 plus a xô nhựa or a giỏ tre, cô Út buying cua & ốc at the room's fish multiplier fixed at the catch, pest snails landing in the container, and "Cấy lúa" / "Trồng cây ớt con" as TransplantGame rounds that gate progress only — server-authoritative, behind the anti-cheat guards.

**Architecture:** Migration `0018_v15_3_gather.sql` (sections A–F) adds the `critter_kinds` config, the two containers and the `critter_sell` ledger reason (A); the private tables `critters` and `gather_cooldowns` and the day's visits on `farm_profiles` (B); the price, capacity, catch and daily-limit helpers and the field state's new parts (C); the 4 guarded gathering RPCs `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters` (D); the transplant round's gates, pest snails for the picker and the containers at anh Hai's (E); and `0017`'s anti-cheat snapshot and wipe, which take the critters too (F). `tests/sql/v15-gather-smoke.sql` checks it against `tests/fixtures/gather-cases.json` and ends with the guard file. On the client, `lib/game/farm/gather.ts` mirrors the rules (the prices, the spot keys, the capacity, each spot's state and prompt); the catalog, state and RPC layer read the new fields; the field map gains the holes and beds, the art their look, the ready cues and both overlays' scenes; `minigames.ts` gains the seeded CrabRound and TransplantRound; `useFarmController` drives the crab visit, the bed's 3-second bar and the transplant round; and the plot panel, the shop, the depot, the bag, the handbook, the HUD and the admin tab show it all.

**Tech Stack:** Next.js 16.2.9 (App Router, client components), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom + RTL, pnpm 11, PostgreSQL 18 (a throwaway local cluster for the SQL checks).

**Spec:** `docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md` — decisions V1–V9, rulings R1–R24. Read it before starting any task: every section number below (§…) refers to it unless another spec is named. The anti-cheat spec (`2026-09-25-music-together-anticheat-design.md`) §11.3 rules 1–7 bind every SQL task.

## Global Constraints

- **Start** from `feat/v15-field` at `2fb74e8`: v15.1, `0014`, the anti-cheat layer `0015` with its fix round, v15.2 (`0016` and its client, with their fix round) and v16 (`0017`, the card corner, and its client), as reviewed up to `2fb74e8`. Work on the branch the owner names (suggested: `feat/v15.3`, created from that state, in place — no worktree). One commit per task, with the message the task gives; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The messages contain quotes and apostrophes: write each one to a file and commit with `git commit -F <file>`.
- **Package manager pnpm** (`pnpm test`, `pnpm lint`, `pnpm build`). Typecheck: `npx tsc --noEmit` (a checkout that has never run `next build` or `next dev` has no `next-env.d.ts` and fails on the `@/public/logo.png` imports: run either once, or write a `next-env.d.ts` with the two lines `/// <reference types="next" />` and `/// <reference types="next/image-types/global" />`; it is gitignored). One test file: `pnpm vitest run tests/unit/<file>`.
- **Baseline** (Task 1 records yours): on `2fb74e8`, `pnpm test` → 115 files passed / 13 skipped (1101 tests passed / 75 skipped), `npx tsc --noEmit` clean, `pnpm lint` 33 pre-existing problems (21 errors, 12 warnings) in 16 files, none of which this plan creates or modifies. After Task 14: 119 files passed / 14 skipped (1224 tests passed / 79 skipped); lint unchanged. Every file you create or modify must lint clean: `npx eslint <your files>`.
- **Next.js 16.2.9 is not the Next.js you know** (`AGENTS.md`): before using any Next.js API, read its guide in `node_modules/next/dist/docs/`. This plan adds no route, no config and no Next.js API; its components are client components under the existing `"use client"` shells.
- **React hook lint rules** (eslint-plugin-react-hooks 7, the React Compiler rules): no `ref.current` reads or writes during render, no synchronous `setState` directly in an effect body (callbacks, timers — `setTimeout(fn, 0)` included — `requestAnimationFrame` and promise continuations are fine), no `Date.now()` / `Math.random()` / `performance.now()` during render, and a helper an effect uses lives at module level when it needs nothing from the component. Hooks that drive the canvas take a getter `canvas: () => GameCanvasHandle | null`, never a ref object.
- **Tests:** Vitest runs without globals, so Testing Library does not clean up by itself: every component or hook test file calls `cleanup()` in an `afterEach`. Vitest 4's fake timers also fake `requestAnimationFrame` (16 ms frames) and `performance.now()`. Pure logic lives in `lib/` with tests in `tests/unit/`; a module a test imports must not reach `@/lib/supabase` unless the test mocks it.
- **Overlays:** every new overlay takes the canvas's input through `lib/game/overlays.ts` (`OpenOverlays`, `overlayLocks`), never through a new inline condition in `GameShell.tsx`. TransplantGame is a `farmRound` like HarvestGame (Task 10); CrabGame adds `farmCrab` (Task 11). A snail bed's 3-second bar locks nothing: walking cancels it (Task 12).
- **UI copy** is Vietnamese; use the strings given in the tasks verbatim (they come from spec §11.8, §13 and §14). Numbers in `vi-VN` (`1.500 xu`, via `formatXu` or `toLocaleString("vi-VN")`), decimals with a comma (`5,5 điểm`, `×2,24`).
- **Art** is original pixel art drawn in code (string grids and procedural painters), never copied from any game. The repo is public: no copyrighted assets, no secrets.
- **Never type a literal invisible character** (zero-width, bidi control, odd space, combining mark, or the emoji variation selector U+FE0F) into a source file: SQL writes them as escapes (`\u200b`), TypeScript as `"\u200b"` — an emoji that needs U+FE0F is written `"🌶\uFE0F"` (Task 10's heading). Emoji that need no selector (🦀, 🐌, 🪣, 🌱) are typed as they are.
- **SQL** is additive and re-runnable (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`, seeds `on conflict (id) do update`), every function has `set search_path = public, extensions`, every re-created public RPC keeps its signature and gets an explicit `grant execute … to anon, authenticated`, every private helper gets `revoke all … from public, anon, authenticated`, and every time rule lives in a private function that takes `p_now`. **The anti-cheat rules for later migrations** (anti-cheat spec §11.3) apply: each new game RPC starts guarded with `_ac_account` / `_ac_play` and its hard checks; a re-created guarded RPC keeps its guard, checks and grant; a re-created shared function keeps the parts of every migration before it; the `coin_ledger` reason check keeps `'wipe'` and every later reason; `tests/sql/anticheat-guards.sql`'s dynamic loop gains the new RPCs (this plan adds no non-game RPC, so the allowlist is unchanged). The owner runs migrations in the Supabase SQL editor — never run anything against a hosted database from here.
- **Local PostgreSQL:** never touch the installed PostgreSQL 18 service, its data directory or port 5432. Tasks 1–4 check the SQL on a throwaway cluster (`initdb --auth=trust`, port **5493**, in your session scratchpad `$SCRATCH`), always with `PGCLIENTENCODING=UTF8`, from the **repo root** (the smokes re-run migrations with `\i` and read `tests/fixtures/*.json` with `\copy`). The cluster mirrors Supabase's grants (`anon` and `authenticated` get every right on each new table and function unless a migration revokes it), and it replays the migrations in the production order: `0004`…`0012`, the v14 smoke (its catch prices hold after `0012` only), `0014`, `0013`, `0015`, `0016`, `0017`, then `0018` twice; then the lyrics, v15, anti-cheat, v15.2, v16 and gather smokes, and `0018` and the gather smoke once more. Every file runs with plain `psql -f`, **outside any open transaction and never under `psql -1`**: `tests/sql/anticheat-guards.sql` runs its own `begin; … rollback;` self-test. Create the check script once, in Git Bash, as `$SCRATCH/v153-sql.sh` (outside the repository) with:

```bash
#!/usr/bin/env bash
# The SQL check of the v15.3 plan on a throwaway PostgreSQL 18 cluster (trust auth, Supabase's default grants).
# Run it from the repo root:  SCRATCH=<your scratchpad> bash "$SCRATCH/v153-sql.sh"
# Fresh cluster → 0004…0012 → the v14 smoke (it holds after 0012 only) → 0014 → 0013 → 0015 → 0016 → 0017 → 0018 twice
# (the production order) → the lyrics, v15, anti-cheat, v15.2, v16 and gather smokes → 0018 again → the gather smoke
# again. The lyrics smoke runs once (it counts the rows it wrote). The v15 smoke's last section re-runs 0013, the
# anti-cheat smoke re-runs 0015, the v15.2 smoke re-runs 0016 and the v16 smoke re-runs 0017: they put back their own
# versions of functions 0018 re-creates, so the v15.2 and gather smokes re-run 0018 after them. Prints the smokes' "ok"
# rows and ALL OK, or FAILED and the end of the log. Leaves no cluster behind. Every file runs with plain `psql -f`,
# outside any open transaction and never under `psql -1`: tests/sql/anticheat-guards.sql (which the anti-cheat, v15.2,
# v16 and gather smokes end with) runs its own `begin; … rollback;` self-test.
set -u
export PGCLIENTENCODING=UTF8
PORT=5493
PG="/c/Program Files/PostgreSQL/18/bin"
D="$SCRATCH/pg-v153"
LOG="$SCRATCH/v153-sql.log"
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
         supabase/migrations/0016_*.sql supabase/migrations/0017_*.sql; do
  "${PSQL[@]}" -f "$f" >>"$LOG" 2>&1 || fail "$f"
done
M=supabase/migrations/0018_v15_3_gather.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M"
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (re-run)"
echo "0018 twice ok"
smoke tests/sql/lyrics-lockdown-smoke.sql
smoke tests/sql/v15-smoke.sql
smoke tests/sql/anticheat-smoke.sql
smoke tests/sql/v15-2-smoke.sql
smoke tests/sql/v16-smoke.sql
smoke tests/sql/v15-gather-smoke.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (after the smokes)"
smoke tests/sql/v15-gather-smoke.sql
"$PG/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1; rm -rf "$D"
echo "ALL OK"
```

  `SCRATCH` is your session scratchpad in Git Bash form (for example `/c/Users/<you>/AppData/Local/Temp/claude/<…>/scratchpad`): `export SCRATCH=…` in the shell that runs the script (with `set -u` it stops at once when `SCRATCH` is unset). A `WARNING: "wal_level" is insufficient` from `create publication` and `NOTICE … does not exist, skipping` lines only go to the log. Delete nothing else in `$SCRATCH`; the script removes its own cluster.
- **The repo is public:** never commit a password, a token or a key. The integration tests read `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` from the environment and are skipped without them. Never type a password (account or room) in a browser.
- **Do not start dev servers.** `pnpm build` (Task 14) is the only build; in a checkout without `.env.local`, give it `NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_test_key` (the test values of `vitest.config.ts`).
- **Deploy order** (R23) is the owner's and the reverse of v15.2's: the v15.3 client first, then `0018` as soon as possible after it, in the production order `0012` → `0014` → `0013` → `0015` → `0016` → `0017` → `0018`. The v15.3 client against a database without `0018` treats a missing `critter_kinds` (PGRST205 / 42P01) as an empty catalog, shows the gathering RPCs' PGRST202 as `NOT_OPEN_153`, and its transplant round's 9 s wait passes `0016`'s 2 s gate. If `0018` runs first, cached v15.2 tabs get `too fast` on transplanting until they reload.

## Rulings (decisions where the spec is silent, ambiguous or self-contradictory)

- **Built on `2fb74e8`** (v15.2 with its fix round, and v16's `0017`). `0018`'s ledger check lists `0017`'s 20 reasons plus `critter_sell` (21, spec V1), and section F takes `0017`'s bodies of `_ac_holdings` and `_ac_wipe`, their card parts kept; the SQL check replays `0016` → `0017` → `0018`. "Rebased onto `2fb74e8`" lists what the rebase from `391eb7a` changed.
- **`_work_gate` is re-created from `0013`**, its latest definition: `0016` never changed it (`harvest_part` has its own 8–120 s check inline), although §8.3 supposes it might have. A transplant is taken 8–120 s after its `begin_work` (`too fast` before, or with no record; `work expired` after); any other work — a hoa-màu picking — keeps the 2 s gate with no upper bound.
- **`_farm_do_transplant` is re-created from `0016` verbatim** except its comment, as §11.1 lists it, although `_work_gate` alone carries the change.
- **The lease gate (R19) is a rice round's for any transplant: 25 s** (5 s for a picking). The spec says 10 s, the rice round's gate when it was written; v15.2's fix round raised that to 25 s (a round's play and its 9 s claim), and V5 gives a transplant round v15.2's rules, so the transplant follows — its round takes 4–21 s before the same claim. The plot panel's reason "Sắp hết hạn thuê — không kịp cấy." uses `LEASE_ROUND_MS` (25 s), the constant of the rice round's reason, through one helper for both rounds. The smokes' transplant lease cases are 24 s → `lease ending` and 25 s → allowed, and Task 14 amends the v15.3 spec's R19, §3, §8.1, §8.3, §11.4, §13.4 and §16 to match. Should the owner prefer the spec's 10 s, only `0018`'s `interval '25 seconds'` for a transplant, a separate 10 s client constant and those cases change.
- **`_critter_add` reads the fish index only when something fits**, so a catch that all escapes writes no snapshot; `pick_snails`' snails go through it too (`array_fill('oc_buou_vang', 1 + floor(random() · 3))`, no `p_u`: the re-created core keeps its signature, R14), and its answer is the field view plus `snails`.
- **`_farm_mine`'s gathering part reads the day and the cooldowns on `now()`**, like `_fishing_state` (it takes no `p_now`): `ready_at` lists only the spots still cooling; `day_resets_at` is set only at 0 visits left.
- **The daily limit (§7.5):** `_gather_check` creates the account's farm profile when it has none; the soft `gather_daily_cap` goes through `_ac_flag(…, null, false)` with the detail `{day, visits: 200}`.
- **`buy_farm_item` for a container:** after the guard, a priced item of another kind is the soft `kind_mismatch`; a quantity outside 1–99 is `bad_qty` as for every farm item; then a tool or a container with a quantity ≠ 1 is a plain `invalid quantity` (R16), a container no larger than the largest held is `already owned` (`_critter_cap − 3 ≥ capacity`), and then the 99 cap and `not enough coins`.
- **The v15.2 smoke re-runs `0018` after each of its three re-runs of `0016`** (§16 omits it): `0016` puts back its versions of `_farm_do_begin_work`, `_farm_do_pick_snails`, `buy_farm_item`, `_farm_mine`, `_field_view`, the ledger check and section F. It re-runs no `0017`: `0018` puts section F back with `0017`'s card parts, and the v16 smoke, next, re-runs `0017` itself. The v15 and anti-cheat smokes claim transplants 8 s after `begin_work` as §16 says; the anti-cheat smoke's edit is cosmetic (it runs after the v15 smoke re-ran `0013`, whose transplant keeps the 2 s gate) but keeps the files in step.
- **The gather smoke's day-limit cases run at 01:00 Vietnam time of today**, so no Vietnam midnight falls inside a case; it runs twice on one database (random names), the second time after `0018` runs again. It re-runs `0018` first, and not `0017`: the v16 smoke just before it did, and `0017`'s ledger check, without `critter_sell`, could not be put back once a critter has been sold.
- **The guard file's comment states no count** ("every guarded game RPC"), so `0017`'s and `0018`'s additions merge without touching it; the assertion is `n = 52` (`0017`'s 6 card RPCs, then `0018`'s 4).
- **Prompts are the text after the shell's "E · "**, which the shell always adds (§13.1's table shows it on the ready rows only). A full bed reads "Bãi {n} · {giỏ tre | tay} đầy — bán ở vựa cô Út", the hole's wording; container names mid-sentence are lower-cased (`lowerFirst`), and bare hands read "tay".
- **A spot's state for me uses the server's `mine.critterCap`**, and the client lifts the daily limit once the server clock passes `day_resets_at` (`visitsLeft`), so a tab left open past midnight is not stuck on the limit.
- **Texts the spec leaves open:** a hole or bed refusal without numeric `details` says "ít phút"; a crab visit that keeps none but loses some reads "🦀 {1} con chạy mất vì {xô nhựa} đầy."; a bed that keeps none reads "🐌 Thả lại {2} con vì {tay} đầy."; the ớt round waits with "Đang cắm nốt hàng cây…" (§13.3 gives the rice line only); the handbook's ớt nursery line becomes "… đất Ẩm — mỗi lượt trồng 12 cây, được từ 6 điểm là xong. Cây già quá mất 3% mỗi giờ (tối đa 30%)."
- **The handbook's "Cua & ốc" tab and its Mẹo line show only once the catalog has critter kinds** (after `0018`), like the pest-snail hints.
- **The seeded rounds** judge an input edge at the end of the frame it arrives in, and the frames that change phase (lead-in → play, a try's end, a beat's end) ignore input, so a held key cannot score twice. The CrabGame pin (Task 11) plays twelve whole games frame by frame, about 1.5 s alone: it has its own 20 s timeout, since a loaded machine slows it past Vitest's 5 s default.
- **The map** (§6's banks and x positions): every hole is a 16 × 10 burrow in its bank and every bed a 20 × 10 patch across the water's edge, each use spot on the bank facing the water and at least 32 px from any other use spot (Task 6's table).
- **The ready cue** shows on each hole and bed that is open and not cooling for me (`readyAt ≤ now`); a full container or the daily limit shows in the prompt, not the cue.
- **The transplant round:** the 3-second job is now a hoa-màu picking only (`FarmWork.work` is `"harvest"`); a failed transplant round sends nothing (§8.1), while a failed rice round still reports its part as before; `begin_work('transplant')`'s refusals read in the transplant's context; the ớt heading is "🌶\uFE0F Trồng cây ớt con thửa {6}". It lives v15.2's round lifecycle as a rice round does — the idle end at 110 s ("Lượt cấy đã quá lâu — bắt đầu lại nhé."), "Nghỉ tay" and Esc once the claim is slow, a `begin_work` answer dropped after a close — and a lost transplant round leaves no report for "Thử lại" to wait for.
- **CrabGame:** "Dừng (Esc)" sits outside the grab area and is shown until the result; hits 0 are sent at once; closing never cancels a finish already due (R8) — a result that arrives after the overlay closed is toasted; leaving the field closes the overlay silently, and a `crab_start` answer that comes back after it is dropped, as a late `begin_work` answer is (the hole keeps its cooldown, R8). E at a hole or a bed says why it cannot be visited, in the server's order, before any call: the field still loading, `NOT_OPEN_153` before `0018`, the limit, full, cooling. A gathering RPC's PGRST202 toasts `NOT_OPEN_153` and does not raise the field's "chưa mở" banner.
- **A snail bed's bar** stands the avatar at the bed like any job and locks no input: a local move (a key step or a path, through `GameCanvas`'s new `onLocalMove`), "Huỷ" or Esc cancels it before anything is sent; `fa 7` at its start and at 2 s, `fa 0` at its end.
- **The pest-snail hint** carries its own handbook link ("📖 Cua & ốc", `PlotAction.handbook`); the panel's main handbook link is unchanged.
- **cô Út's "🦀 Cua & ốc"** shows once the catalog has critter kinds, with the price line when the field state has `critter_prices` and a row per kind held; the extended empty line shows only when nothing at all is held. The depot takes it as one optional prop (`critters: { prices, onSell }`), so a v15.2-era caller renders as before.
- **The bag's "🦀 Cua & ốc"** shows once the catalog has critter kinds; "Tay không" names anh Hai's containers in shelf order with their prices; the visits line uses the server clock (`BagFarm.now`).
- **The admin's holdings line always counts cua ốc** after hoa màu, 0 for an answer from before `0018` (as `produce` is read); v16's card seats stay last.
- **The integration test** goes a little past §16: besides `critter_kinds` and the `crab_finish` envelope, it runs a hits-0 visit, a bed and a sale, the honest refusals a fresh account meets, and the `bad_spot` envelopes.
- **The spec amendments** (Task 14) follow §3; they also fix the v15 spec's §9 container prices to 1 500 / 6 000 (the economy spec's ×10, v15.3 §9), add v15.3's rows to the anti-cheat spec's §8.1 detail table and §15.2 pins, bring its guard counts to 52 and its `WARN_LOCK` row to the new sentence, and amend the v15.3 spec itself for the transplant's 25 s gate, the transplant round's limits and the dropped late `crab_start` answer.
- **`WARN_LOCK`** keeps v16's sentence and puts "bắt cua mò ốc" right after "làm ruộng" (§11.6): "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường." The v17 spec expects "bắt cua mò ốc" in that place too.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0018_v15_3_gather.sql` | A config and catalog (`critter_kinds`, `box_bucket`, `box_basket`, the ledger's 21 reasons) · B tables (`critters`, `gather_cooldowns`, `farm_profiles.gather_on` / `gather_count`) · C helpers and views (`_critter_price`, `_critter_prices`, `_critter_cap`, `_critter_add`, `_gather_check`, `_gather_count`, `_farm_mine`, `_field_view`) · D gathering (`_gather_do_*`, `crab_start`, `crab_finish`, `pick_snail_bed`, `sell_critters`) · E farm changes (`_work_gate`, `_farm_do_transplant`, `_farm_do_begin_work`, `_farm_do_pick_snails`, `buy_farm_item`) · F `_ac_holdings`, `_ac_wipe` (`0017`'s, plus the critters) |
| `tests/sql/v15-gather-smoke.sql`, `tests/fixtures/gather-cases.json` | the smoke of every section, ending with the guard file, run twice on one database; the rules, prices and spot keys both sides share (§16) |
| `tests/sql/anticheat-guards.sql`, `v15-smoke.sql`, `anticheat-smoke.sql`, `v15-2-smoke.sql` (mod) | the 4 new guarded RPCs after `0017`'s 6 (52 calls); transplants claimed 8 s after `begin_work`; the v15.2 smoke re-runs `0018` after each `0016`, and its transplant lease case becomes 24 s / 25 s |
| `lib/game/farm/gather.ts` | the rules mirror, `critterPrice`, the spot keys, the capacity, each spot's state and prompt, today's visits left |
| `lib/game/farm/catalog.ts`, `state.ts`, `rpc.ts` (mod) | `CritterKind`, `boxRow`, the container description; the field state's critters, capacity, gathering and prices; the 4 new calls and `pick_snails`' snails |
| `lib/game/maps/types.ts`, `field.ts` (mod) | `crab_hole` / `snail_bed` interactables with their `spot`; 6 holes, 4 beds (§6) |
| `lib/game/farm/messages.ts`, `handbook.ts` (mod) | §11.8's refusals and contexts, the catch and sale toasts, the HUD count; the "Cua & ốc" tab and the transplant round's lines |
| `lib/game/farm/minigames.ts` (mod) | the seeded CrabRound (R17) and TransplantRound (R18) |
| `lib/game/art/farm-icons.ts`, `gather-art.ts`, `lib/game/maps/field-art.ts`, `lib/game/engine.ts`, `components/game/GameCanvas.tsx` (mod) | 6 icons; the holes and beds, the ready cues and both overlays' scenes (§15); `setGatherSpots`; `onLocalMove` |
| `components/game/farm/TransplantGame.tsx`, `CrabGame.tsx` | the two overlays (§13.2, §13.3) |
| `hooks/useField.ts`, `hooks/useFarmController.ts`, `lib/game/farm/actions.ts`, `lib/game/overlays.ts` (mod) | the new calls and `NOT_OPEN_153`; the transplant round, the crab visit, the bed's bar, the prompts, the cues, the sale; the plot's transplant and pest-snail buttons; `farmCrab` |
| `components/game/farm/PlotPanel.tsx`, `Handbook.tsx`, `FarmShopPanel.tsx`, `RiceDepotPanel.tsx`, `FarmOverlays.tsx`, `components/game/fishing/BagPanel.tsx`, `components/game/GameShell.tsx` (mod) | §13.4, §14 |
| `components/admin/AnticheatTab.tsx`, `lib/admin.ts`, `lib/anticheat.ts` (mod) | the two labels, the holdings line's cua ốc, the lock warning (§11.6) |
| `README.md`, the v15, v15.2, v15.3, anti-cheat and economy specs (mod), `tests/integration/v15-3.test.ts` | the v15.3 section after v16's; the §3 amendments; the v15.3 spec's lines on the transplant's 25 s gate and the rounds' limits; spec §16's integration checks |

## Rebased onto `2fb74e8`

This plan was first built and replayed on `391eb7a` (v15.2 before its fix round, no `0017`). Once `feat/v15-field` reached `2fb74e8` (v15.2's fix round and v16's `0017`, both reviewed), the work was rebased there once and replayed again from a clean checkout. The rebase changed:

1. **`0018` section F** (Task 4): `_ac_holdings` and `_ac_wipe` are `0017`'s bodies — its `"cards"` entry, and its first step `perform public._card_forfeit_all(p_account);` before the snapshot — plus only the lines marked `-- v15.3`. The gather smoke's wipe seats the account at the room's poker table with all its xu and checks that the seat is cashed out before the snapshot.
2. **The ledger check** (Task 1): `0017`'s 20 reasons plus `critter_sell`, 21 — the list this plan already had.
3. **The guard loop** (Task 2): `0017`'s 6 card RPCs, then this plan's 4: `n = 52`.
4. **The SQL check and the smokes:** `0017` runs between `0016` and `0018`, and the v16 smoke after the v15.2 smoke. The v15.2 smoke re-runs `0018` after each of its three re-runs of `0016` (the fix round added the sickle backfill's). The gather smoke re-runs `0018` only: the v16 smoke just before it re-ran `0017`, and `0017`'s ledger check cannot be put back once a critter has been sold.
5. **v15.2's fix round:** `0018`'s `_farm_do_begin_work` keeps the rice round's 25 s lease gate, and a transplant takes the same (ruling below; the spec said 10 s). A transplant round lives the fix round's round lifecycle (Task 10): the idle end at 110 s, "Nghỉ tay" once a claim is slow, a `begin_work` answer dropped after a close; a crab visit drops a late `crab_start` answer the same way (Task 11). The fix round's new test literals gain the v15.3 fields (Task 5), and its `WORK_EXPIRED` / `LEASE_ENDING` sit beside this plan's `WORK_EXPIRED_TP` / `LEASE_ENDING_TP`, which Task 7 now names.
6. **v16's client**, textual merges: `InteractKind` (`card_table`, `card_rules` and `game` beside `crab_hole`, `snail_bed` and `spot`), the canvas and the engine (`setCardTables` beside `setGatherSpots`), `overlays.ts` (`farmCrab` beside `cardPanel` and `rulesBook`), `GameShell`, the admin tab (the card labels and seats beside `bad_spot`, `gather_daily_cap` and the cua ốc), `WARN_LOCK` (one sentence), the README (the v15.3 section after v16's) and the anti-cheat spec (v16's lines, then v15.3's).

## Plan conflict scan (pre-flight, done by the plan author)

- **Validated end to end.** The plan author built every task on a scratch branch from `2fb74e8` with one commit per task: tsc clean and each task's tests green after every task, and after each of Tasks 1–4 the SQL check above (`ALL OK`). After Task 14: the full suite (119 files passed / 14 skipped (1224 tests passed / 79 skipped)), `pnpm lint` at the 33 baseline problems with none in this plan's files, and `pnpm build`. The code blocks below are generated from those commits, and a mechanical replay of this document on a clean checkout of `2fb74e8` — each task's blocks up to Step 2, its Step 2 check failing as stated, then the rest — reproduced every file of every commit, with tsc, the task's tests, its eslint command and the SQL check green after every task, and the final suite and lint as above; `pnpm build` ran on the branch head, whose tree the replay reproduced byte for byte (in the replay's worktree Turbopack refuses a `node_modules` junction that points outside the project). If an edit's "old" text is not found, re-read the file — do not improvise a different change.
- **The base.** `feat/v15-field` moved on while this plan was written. It was first built and replayed on `391eb7a`, then rebased once onto `2fb74e8` (v15.2's fix round and v16's `0017`) and replayed there; "Rebased onto `2fb74e8`" says what changed.
- **Files several tasks touch, in order:** `0018_v15_3_gather.sql` (Task 1 creates A–C, Tasks 2–4 append D, E and F); `tests/sql/v15-gather-smoke.sql` (Task 1 creates it ending with `\i tests/sql/anticheat-guards.sql`, Tasks 2–4 insert before that line); `lib/game/farm/gather.ts` (Tasks 5, 6, 13); `catalog.ts` (Tasks 5, 10); `messages.ts` (Tasks 7, 10); `actions.ts` (Tasks 10, 12); `lib/game/overlays.ts` (Tasks 10, 11); `hooks/useField.ts`, `hooks/useFarmController.ts` and `components/game/farm/FarmOverlays.tsx` (Tasks 10–13); `components/game/GameShell.tsx` (Tasks 11–13); `components/game/GameCanvas.tsx` (Tasks 9, 12); `components/game/farm/PlotPanel.tsx` (Tasks 10, 12); `tests/unit/use-farm-controller.test.tsx` and `farm-overlays.test.tsx` (Tasks 5, 10–13); `anticheat-pins.test.tsx` (Tasks 5, 10–12); `farm-actions.test.ts`, `farm-plot-panel.test.tsx` (Tasks 5, 10, 12); `farm-gather.test.ts` (Tasks 5, 6, 13); `farm-panels.test.tsx`, `fishing-panels.test.tsx` (Tasks 5, 13); `game-canvas-input.test.tsx` (Tasks 9, 12). Each task's blocks are generated against the file as the previous task left it.
- **The SQL smokes and the re-runs:** the v15 smoke's last section re-runs `0013`, the anti-cheat smoke re-runs `0015`, the v15.2 smoke re-runs `0016` (three times) and the v16 smoke re-runs `0017`; each puts back its own versions of functions `0018` re-creates, so the v15.2 smoke re-runs `0018` after each `0016`, and the gather smoke runs after them all (re-running `0018` first), then once more after `0018` runs again.
- **Nothing ships from here.** The integration tests are skipped without `SUPABASE_TEST_URL` (they were type-checked and linted only); the owner's manual pass (§16) comes after deploy.
- **Spec coverage:** §3 (Task 14), §6 (Tasks 6, 9), §7.1 (Tasks 1, 5), §7.2 (Tasks 2, 8, 11), §7.3 (Tasks 2, 12), §7.4 (Tasks 3, 5, 12), §7.5 (Tasks 1, 2, 13), §7.6 (Tasks 2, 13), §8.1 (Task 10), §8.2 (Task 8), §8.3 (Task 3), §9 (Tasks 1, 3, 5, 13), §10 (the config rows of Task 1; the spec amendments, Task 14), §11.1–§11.5 (Tasks 1–4), §11.6 (Tasks 2, 4, 14; the pins in Tasks 5, 10–12), §11.7 (Tasks 1, 5), §11.8 (Task 7; the contexts in Tasks 10, 11), §12 (Tasks 10–12), §13.1 (Tasks 6, 9, 12), §13.2 (Task 11), §13.3 (Task 10), §13.4 (Tasks 10, 12, 13), §14 (Tasks 7, 12), §15 (Task 9), §16 (every task; the integration part in Task 14).

---

### Task 1: Database — config, catalog, tables and the critter helpers (`0018` sections A–C)

**Files:**
- Create: `supabase/migrations/0018_v15_3_gather.sql` (sections A–C)
- Create: `tests/fixtures/gather-cases.json`, `tests/sql/v15-gather-smoke.sql` (the model part, ending with `\i tests/sql/anticheat-guards.sql`)

**Interfaces:**
- Consumes: from `0012`/`0013`: `shop_items(id, kind, name, price, starter, sort_order, capacity)` (the kind `critter_box` is in its check since `0013`), `inventory`, `wallets`, `farm_profiles`, `coin_ledger`, `_fish_index(room, now)` and its row's `mult`, `_fish_period`, `_fish_mult`, `_room_wealth` (`0015`: banned accounts left out), `_vn_today()`; from `0016`: `_farm_mine`'s and `_field_view`'s bodies (`0017` leaves them); from `0017`: the ledger's 20 reasons (`0016`'s 15, with `wipe`, `harvester` and `produce_sell`, and the five card reasons); from `0015`: `_ac_flag(account, code, rpc, detail, room, error, hard)`.
- Produces (Postgres):
  - **A:** `critter_kinds(id, name, grp crab|snail, base_price, sort_order)` (RLS with a public select policy, read-only for the API roles) seeded with `cua_dong` 12, `cua_gach` 45, `oc_dong` 8, `oc_buou_vang` 2 (§7.1); the items `box_bucket` (Xô nhựa, 1 500, capacity 15) and `box_basket` (Giỏ tre, 6 000, capacity 30) of kind `critter_box` (§9); the `coin_ledger` reason check with the 20 reasons in force after `0017` plus `critter_sell`, 21 in all (V1);
  - **B:** `critters(id, account_id, kind, price, caught_at)` (one row per critter, priced at the catch) and `gather_cooldowns(account_id, spot crab1–6|bed1–4, ready_at, visit_id, visit_at, visit_room)` (private: RLS on, no policies, revoked); `farm_profiles.gather_on` / `gather_count` (≥ 0);
  - **C** (private): `_critter_price(base, mult) = greatest(1, floor(base × mult))` (R4); `_critter_prices(room, now) → {mult, ends_at}`, the current index row or a preview, never a write (R12); `_critter_cap(account) = 3 + the largest container` (R5); `_critter_add(account, room, kinds[], now) → {caught: [{kind, price}], escaped}` (as many as fit, priced at the room's M, the index read only when something fits); `_gather_check(account, now)` (`gather daily limit`, SQLSTATE 53400, `details` = the seconds to the next Vietnam midnight) and `_gather_count(account, room, rpc, now)` (the 200th visit of a Vietnam day logs the soft `gather_daily_cap`); `_farm_mine` gains `critters {kind: {n, xu}}`, `critter_cap` and `gather {ready_at, left_today, day_resets_at}` (§11.7), and `_field_view` gains `critter_prices`.
- Produces (smoke): `tests/sql/v15-gather-smoke.sql` re-runs `0018` first, sets log mode, defines `pg_temp.err(sql) → text`, `pg_temp.errd(sql) → {message, detail, state}`, `set_coins`, `give`, `held` and `set_mult` (the room's index row by hand), loads the fixture with `\copy`, checks the config rows and grants, the fixture's prices and rules, the capacity, the catches at M, the field state's new parts and the daily count, prints `v15.3 model smoke ok`, and ends with `\i tests/sql/anticheat-guards.sql`. Tasks 2–4 insert their parts before that line.

- [ ] **Step 0: Record the baseline and create the SQL check script**

Run `pnpm test`, `npx tsc --noEmit` and `pnpm lint`, and write down the counts (the plan author's are in Global Constraints). Create `$SCRATCH/v153-sql.sh` from Global Constraints if it does not exist yet.

- [ ] **Step 1: Write the fixture and the smoke's model part**

Create `tests/fixtures/gather-cases.json` with exactly:

```json
{
  "rules": {
    "hand": 3,
    "boxes": [15, 30],
    "cooldown_s": 1200,
    "daily_visits": 200,
    "crab_gate_s": 3,
    "visit_window_s": 120,
    "transplant_gate_s": 8,
    "work_window_s": 120,
    "cua_gach_odds": 0.1,
    "oc_dong_odds": 0.7,
    "bed_snails": [1, 3]
  },
  "prices": [
    [12, 1.00, 12],
    [45, 1.00, 45],
    [12, 1.46, 17],
    [45, 1.46, 65],
    [8, 1.46, 11],
    [2, 1.46, 2],
    [45, 1.40, 63],
    [12, 2.24, 26],
    [45, 2.24, 100],
    [8, 2.24, 17],
    [2, 2.24, 4],
    [12, 5.00, 60],
    [45, 5.00, 225],
    [2, 10.00, 20]
  ],
  "spots": [
    ["crab_1", "crab1"], ["crab_2", "crab2"], ["crab_3", "crab3"], ["crab_4", "crab4"], ["crab_5", "crab5"], ["crab_6", "crab6"],
    ["bed_1", "bed1"], ["bed_2", "bed2"], ["bed_3", "bed3"], ["bed_4", "bed4"]
  ]
}
```

Create `tests/sql/v15-gather-smoke.sql` with exactly:

```sql
-- tests/sql/v15-gather-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0018 (see the plan),
-- from the repo root: it re-runs 0018 with \i, reads tests/fixtures/gather-cases.json with \copy, and ends with
-- tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
\set ON_ERROR_STOP on

-- The v15 smoke re-runs 0013, the anti-cheat smoke 0015, the v15.2 smoke 0016 and the v16 smoke 0017: they put back
-- their own versions of functions 0018 re-creates, so 0018 runs again first.
set client_min_messages = warning;
\i supabase/migrations/0018_v15_3_gather.sql
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
-- The critters an account holds, kinds in the order caught.
create function pg_temp.held(a uuid) returns text[] language sql
as $$ select coalesce(array_agg(kind order by id), '{}') from public.critters where account_id = a $$;
-- The room's fish price index row, set by hand for this period.
create function pg_temp.set_mult(r uuid, m numeric, t timestamptz) returns void language sql
as $$ insert into public.fish_price_index (room_id, period, wealth, mult, computed_at) values (r, public._fish_period(t), 0, m, t)
      on conflict (room_id) do update set period = excluded.period, mult = excluded.mult, computed_at = excluded.computed_at $$;

create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/gather-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;

-- ---------- the config, the prices, the tables and the ledger (§7.1, §9, §11.2) ----------
set role anon;
create temp table anon_read as select count(*)::int as n from public.critter_kinds;
reset role;

do $$
declare j jsonb := (select j from fx); r jsonb;
begin
  assert (select n from anon_read) = 4, 'anon reads critter_kinds';
  assert (select jsonb_agg(jsonb_build_array(id, name, grp, base_price, sort_order) order by sort_order) from public.critter_kinds)
         = '[["cua_dong", "Cua đồng", "crab", 12, 10], ["cua_gach", "Cua gạch", "crab", 45, 20],
             ["oc_dong", "Ốc đồng", "snail", 8, 30], ["oc_buou_vang", "Ốc bươu vàng", "snail", 2, 40]]', 'the four critters (§7.1)';
  assert not has_table_privilege('anon', 'public.critter_kinds', 'insert, update, delete, truncate')
     and not has_table_privilege('authenticated', 'public.critter_kinds', 'insert, update, delete, truncate'), 'read-only config';
  assert not has_table_privilege('anon', 'public.critters', 'select') and not has_table_privilege('authenticated', 'public.critters', 'select')
     and not has_table_privilege('anon', 'public.gather_cooldowns', 'select')
     and not has_table_privilege('authenticated', 'public.gather_cooldowns', 'select'), 'private tables';
  -- the containers (§9) and the fixture's rules
  assert (select jsonb_agg(jsonb_build_array(id, kind, name, price, capacity, sort_order) order by sort_order)
            from public.shop_items where kind = 'critter_box')
         = '[["box_bucket", "critter_box", "Xô nhựa", 1500, 15, 10], ["box_basket", "critter_box", "Giỏ tre", 6000, 30, 20]]',
    'the two containers';
  assert (select jsonb_agg(capacity order by capacity) from public.shop_items where kind = 'critter_box') = j->'rules'->'boxes',
    'the fixture''s boxes';
  -- the price law (R4): floor(base × M), against the shared fixture
  for r in select x from jsonb_array_elements(j->'prices') x loop
    assert public._critter_price((r->>0)::int, (r->>1)::numeric) = (r->>2)::int, format('price %s', r);
  end loop;
  assert public._critter_price(2, 0.3) = 1, 'at least 1';
  -- the ledger: exactly the 21 reasons in force after 0017, plus none
  assert (select array_agg(m[1] order by m[1]) from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g') m
           where c.conname = 'coin_ledger_reason_check')
         = (select array_agg(x order by x) from unnest(array['daily','song','sell','buy','rent','land_buy','land_sell','land_refund',
              'lease_pay','lease_income','farm_buy','rice_sell','wipe','harvester','produce_sell','card_hold','card_settle',
              'card_buyin','card_cashout','card_refund','critter_sell']) x), 'the 21 ledger reasons';
  assert pg_temp.err(format('insert into public.coin_ledger (account_id, delta, balance, reason, ref) values (%L, 0, 0, %L, %L)',
                            gen_random_uuid(), 'foo', 'x')) like '%coin_ledger_reason_check%', 'foo is refused';
  -- the tables' checks
  assert pg_temp.err(format('insert into public.gather_cooldowns (account_id, spot, ready_at) values (%L, %L, now())',
                            gen_random_uuid(), 'crab7')) like '%gather_cooldowns_spot_check%', 'crab1–crab6 and bed1–bed4 only';
  assert (select pg_get_constraintdef(oid) like '%gather_count >= 0%' from pg_constraint
           where conname = 'farm_profiles_gather_count_check'), 'gather_count ≥ 0';
  -- the helpers are private
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('_critter_price', '_critter_prices', '_critter_cap', '_critter_add', '_gather_check',
                                        '_gather_count')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
end $$;

-- ---------- capacity, the catch, the prices shown and the account's part (R4, R5, R12, §11.7) ----------
insert into smoke select 't1', token from public.register('gather_a_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't2', token from public.register('gather_b_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'a2', public._auth_account((select v from smoke where k = 't2'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Bờ mương', 'pw', (select v from smoke where k = 't1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
  from smoke where k = 't2';
insert into smoke select 'now', date_trunc('minute', now())::text;

do $$
declare j jsonb := (select j from fx); a1 uuid := (select v from smoke where k = 'a1')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        r jsonb; m jsonb;
begin
  -- 3 by hand, then the largest container (R5)
  assert public._critter_cap(a1) = (j->'rules'->>'hand')::int, 'hands: 3';
  perform pg_temp.give(a1, 'box_bucket', 1);
  assert public._critter_cap(a1) = 18, 'a bucket: 18';
  perform pg_temp.give(a1, 'box_basket', 1);
  assert public._critter_cap(a1) = 33, 'both: 33';
  delete from public.inventory where account_id = a1 and item_id = 'box_bucket';
  assert public._critter_cap(a1) = 33, 'a basket: 33';
  delete from public.inventory where account_id = a1 and item_id = 'box_basket';
  -- a catch takes the room's M at the moment and keeps it (R4): 12 × 2.24 → 26, 45 × 2.24 → 100
  perform pg_temp.set_mult(room, 2.24, t);
  r := public._critter_add(a1, room, array['cua_dong', 'cua_gach'], t);
  assert r = '{"caught": [{"kind": "cua_dong", "price": 26}, {"kind": "cua_gach", "price": 100}], "escaped": 0}', format('caught %s', r);
  assert (select array_agg(price order by id) from public.critters where account_id = a1) = '{26,100}'
     and (select bool_and(caught_at = t) from public.critters where account_id = a1), 'stored with the catch';
  -- only what fits is kept, in order; the rest escape
  r := public._critter_add(a1, room, array['oc_dong', 'oc_buou_vang', 'oc_dong'], t);
  assert r = '{"caught": [{"kind": "oc_dong", "price": 17}], "escaped": 2}', format('one place left %s', r);
  r := public._critter_add(a1, room, array['oc_dong'], t);
  assert r = '{"caught": [], "escaped": 1}' and pg_temp.held(a1) = '{cua_dong,cua_gach,oc_dong}', 'full: nothing kept';
  -- the account's part (§11.7): the critters held, the capacity and the gathering
  m := public._farm_mine(a1);
  assert m->'critters' = '{"cua_dong": {"n": 1, "xu": 26}, "cua_gach": {"n": 1, "xu": 100}, "oc_dong": {"n": 1, "xu": 17}}'
     and m->'critter_cap' = '3', format('mine %s', m);
  assert m->'gather' = '{"ready_at": {}, "left_today": 200, "day_resets_at": null}', format('gather %s', m->'gather');
  insert into public.gather_cooldowns (account_id, spot, ready_at) values
    (a1, 'crab3', now() + interval '12 minutes'), (a1, 'bed1', now() + interval '7 minutes'), (a1, 'crab1', now() - interval '1 minute');
  update public.farm_profiles set gather_on = public._vn_today(), gather_count = 13 where account_id = a1;
  if not found then
    insert into public.farm_profiles (account_id, gather_on, gather_count) values (a1, public._vn_today(), 13);
  end if;
  m := public._farm_mine(a1)->'gather';
  assert m->'ready_at' = jsonb_build_object('bed1', now() + interval '7 minutes', 'crab3', now() + interval '12 minutes')
     and m->'left_today' = '187' and m->'day_resets_at' = 'null', format('cooling spots, 187 left: %s', m);
  update public.farm_profiles set gather_count = 200 where account_id = a1;
  m := public._farm_mine(a1)->'gather';
  assert m->'left_today' = '0'
     and (m->>'day_resets_at')::timestamptz = (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh', format('none left %s', m);
  update public.farm_profiles set gather_on = public._vn_today() - 1 where account_id = a1;
  assert public._farm_mine(a1)->'gather'->'left_today' = '200', 'a new day';
end $$;

-- The prices the field shows (R12): the snapshot while its period is current, else a preview; a read never writes.
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        p jsonb; w bigint;
begin
  p := public._critter_prices(room, t);
  assert p = jsonb_build_object('mult', 2.24, 'ends_at', to_timestamp((public._fish_period(t) + 1) * 10800 - 25200)),
    format('the snapshot %s', p);
  assert public._field_view(room, a1, t)->'critter_prices' = p, 'field_state carries it';
  -- an older period: the preview of the room's wealth now, and no write
  update public.fish_price_index set period = period - 1 where room_id = room;
  perform pg_temp.set_coins(a1, 400000);
  perform pg_temp.set_coins(a2, 600000);
  w := public._room_wealth(room, t);
  p := public._critter_prices(room, t);
  assert (p->>'mult')::numeric = public._fish_mult(w) and public._fish_mult(w) = 5.00, format('the preview %s (W = %s)', p, w);
  assert (select period from public.fish_price_index where room_id = room) = public._fish_period(t) - 1, 'nothing written';
  -- a room with no row yet previews ×1 (one member)
  assert (public._critter_prices(gen_random_uuid(), t)->>'mult')::numeric = 1, 'no row';
  delete from public.fish_price_index where room_id = room;
  assert public._field_view(room, a1, t)->'critter_prices'->>'mult' = '5.00'
     and not exists (select 1 from public.fish_price_index where room_id = room), 'the view never writes the index';
end $$;

-- The daily limit's helpers (§7.5): the check first, the count after it; the 200th visit logs one soft signal.
do $$
declare a2 uuid := (select v from smoke where k = 'a2')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; v_day date := (t at time zone 'Asia/Ho_Chi_Minh')::date;
        e jsonb;
begin
  perform public._gather_check(a2, t);
  assert exists (select 1 from public.farm_profiles where account_id = a2 and gather_count = 0), 'a profile is made';
  update public.farm_profiles set gather_on = v_day, gather_count = 198 where account_id = a2;
  perform public._gather_count(a2, room, 'pick_snail_bed', t);
  assert (select gather_count from public.farm_profiles where account_id = a2) = 199
     and not exists (select 1 from public.anticheat_events where account_id = a2), '199: nothing logged';
  perform public._gather_check(a2, t);
  perform public._gather_count(a2, room, 'crab_start', t);
  assert (select outcome = 'soft' and code = 'gather_daily_cap' and rpc = 'crab_start' and room_id = room
                 and detail = jsonb_build_object('day', v_day, 'visits', 200)
            from public.anticheat_events where account_id = a2), 'the 200th visit is logged, soft';
  e := pg_temp.errd(format('select public._gather_check(%L, %L)', a2, t));
  assert e->>'message' = 'gather daily limit' and e->>'state' = '53400'
     and (e->>'detail')::int = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - t)))::int,
    format('the limit %s', e);
  -- a new Vietnam day starts the count again
  update public.farm_profiles set gather_on = v_day - 1 where account_id = a2;
  perform public._gather_check(a2, t);
  perform public._gather_count(a2, room, 'crab_start', t);
  assert (select gather_on = v_day and gather_count = 1 from public.farm_profiles where account_id = a2), 'day 2: 1';
  assert (select count(*) from public.anticheat_events where account_id = a2) = 1, 'the refusal is not logged';
end $$;

select 'v15.3 model smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected: `v14 smoke ok`, then `FAILED: supabase/migrations/0018_v15_3_gather.sql` — the migration does not exist yet (`psql: error: supabase/migrations/0018_v15_3_gather.sql: No such file or directory` in the log).

- [ ] **Step 3: Write sections A–C**

Create `supabase/migrations/0018_v15_3_gather.sql` with exactly:

```sql
-- =========================================================
-- 0018_v15_3_gather.sql — v15.3 "Đồng vui" (docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md): crab holes
-- and snail beds by the canal, the critters they give (sold to cô Út at the room's fish multiplier), the containers that
-- carry them, and the transplant round's gates.
-- ADDITIVE (no data drop) and re-runnable. Requires 0015, 0016 and 0017 (it re-creates functions they last defined and
-- keeps their parts, anti-cheat spec §11.3 rules 1 and 3); does not depend on 0014. Every function relies on
-- `set search_path = public, extensions`. Time rules live in private functions that take p_now; the public RPCs pass
-- now() (tests pass a fake time).
-- =========================================================

-- ---------- A. Config and catalog ----------
-- The critters (§7.1): a name and a base price each; the odds, the gates and the limits are constants below.
create table if not exists public.critter_kinds (
  id text primary key,
  name text not null,
  grp text not null check (grp in ('crab', 'snail')),
  base_price integer not null check (base_price > 0),
  sort_order integer not null default 0
);
alter table public.critter_kinds enable row level security;
drop policy if exists critter_kinds_select on public.critter_kinds;
create policy critter_kinds_select on public.critter_kinds for select to anon using (true);
grant select on public.critter_kinds to anon, authenticated;

insert into public.critter_kinds (id, name, grp, base_price, sort_order) values
  ('cua_dong',     'Cua đồng',     'crab',  12, 10),
  ('cua_gach',     'Cua gạch',     'crab',  45, 20),
  ('oc_dong',      'Ốc đồng',      'snail',  8, 30),
  ('oc_buou_vang', 'Ốc bươu vàng', 'snail',  2, 40)
on conflict (id) do update set
  name = excluded.name, grp = excluded.grp, base_price = excluded.base_price, sort_order = excluded.sort_order;

-- The config table is read-only for the API roles (Supabase's default privileges give them every right on a new table).
revoke insert, update, delete, truncate on public.critter_kinds from anon, authenticated;

-- The two containers (§9): the kind critter_box has been in the catalog's check since 0013.
insert into public.shop_items (id, kind, name, price, starter, sort_order, capacity) values
  ('box_bucket', 'critter_box', 'Xô nhựa', 1500, false, 10, 15),
  ('box_basket', 'critter_box', 'Giỏ tre', 6000, false, 20, 30)
on conflict (id) do update set
  kind = excluded.kind, name = excluded.name, price = excluded.price, starter = excluded.starter,
  sort_order = excluded.sort_order, capacity = excluded.capacity;

-- The reasons in force after 0017 (0015's, then 0016's harvester and produce_sell, then 0017's card reasons) plus the
-- critter sale (§11.2): 21 reasons. Anti-cheat §11.3 rule 4 keeps 'wipe'.
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell'));

-- ---------- B. Tables (private: RLS on, no policies — only the RPCs touch them) ----------
-- One row per critter held (at most 33 an account), priced at the catch (R4).
create table if not exists public.critters (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null references public.critter_kinds(id),
  price integer not null check (price >= 1),
  caught_at timestamptz not null
);
create index if not exists idx_critters_account on public.critters (account_id, kind);

-- A spot's cooldown per account, across rooms (R1); an open crab visit rides on its hole's row (R6).
create table if not exists public.gather_cooldowns (
  account_id uuid not null references public.accounts(id) on delete cascade,
  spot text not null check (spot ~ '^(crab[1-6]|bed[1-4])$'),
  ready_at timestamptz not null,
  visit_id uuid,
  visit_at timestamptz,
  visit_room uuid,
  primary key (account_id, spot),
  check ((visit_id is null) = (visit_at is null) and (visit_id is null) = (visit_room is null))
);
alter table public.critters enable row level security;
alter table public.gather_cooldowns enable row level security;
revoke all on public.critters, public.gather_cooldowns from anon, authenticated;

-- The daily limit (§7.5): the Vietnam day of the last visit and the visits that day.
alter table public.farm_profiles add column if not exists gather_on date;
alter table public.farm_profiles add column if not exists gather_count smallint not null default 0;
alter table public.farm_profiles drop constraint if exists farm_profiles_gather_count_check;
alter table public.farm_profiles add constraint farm_profiles_gather_count_check check (gather_count >= 0);

-- ---------- C. Helpers and views (§7.1, §7.5, §11.3, §11.7) ----------
-- The price of a critter at multiplier M: floor(base × M), at least 1 (R4). lib/game/farm/gather.ts mirrors it.
create or replace function public._critter_price(p_base integer, p_mult numeric) returns integer
language sql immutable set search_path = public, extensions
as $$ select greatest(1, floor(p_base * p_mult))::int $$;

-- The multiplier the field shows (R12): the room's fish price index while its period is current, else a preview of the
-- next snapshot. A read: it never writes the index.
create or replace function public._critter_prices(p_room uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(
    (select jsonb_build_object('mult', r.mult, 'ends_at', to_timestamp((r.period + 1) * 10800 - 25200))
       from public.fish_price_index r where r.room_id = p_room and r.period >= public._fish_period(p_now)),
    jsonb_build_object('mult', public._fish_mult(public._room_wealth(p_room, p_now)),
                       'ends_at', to_timestamp((public._fish_period(p_now) + 1) * 10800 - 25200)))
$$;

-- How many critters the account can hold (R5): 3 by hand plus its largest container.
create or replace function public._critter_cap(p_account uuid) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  select 3 + coalesce(max(s.capacity), 0) from public.inventory i join public.shop_items s on s.id = i.item_id
   where i.account_id = p_account and i.qty >= 1 and s.kind = 'critter_box'
$$;

-- Critters into the account's hands and container (R4, R5): as many of p_kinds as fit, in order, each at the room's M
-- taken now (_fish_index may write the snapshot: the caller holds the wallet lock, R12); the rest escape.
create or replace function public._critter_add(p_account uuid, p_room uuid, p_kinds text[], p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_all integer := coalesce(cardinality(p_kinds), 0); v_fit integer; v_mult numeric; v_caught jsonb := '[]'::jsonb;
        k integer; v_price integer;
begin
  v_fit := least(v_all, greatest(0, public._critter_cap(p_account)
                                    - (select count(*)::int from public.critters where account_id = p_account)));
  if v_fit > 0 then
    v_mult := (public._fish_index(p_room, p_now)).mult;
    for k in 1 .. v_fit loop
      v_price := public._critter_price((select base_price from public.critter_kinds where id = p_kinds[k]), v_mult);
      insert into public.critters (account_id, kind, price, caught_at) values (p_account, p_kinds[k], v_price, p_now);
      v_caught := v_caught || jsonb_build_array(jsonb_build_object('kind', p_kinds[k], 'price', v_price));
    end loop;
  end if;
  return jsonb_build_object('caught', v_caught, 'escaped', v_all - v_fit);
end $$;

-- The daily limit's check (§7.5), first in both visit RPCs: 200 visits a Vietnam day; details = the seconds until the
-- next Vietnam midnight. It makes the account's farm profile if there is none.
create or replace function public._gather_check(p_account uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_day date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date; pr public.farm_profiles;
begin
  insert into public.farm_profiles (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into pr from public.farm_profiles where account_id = p_account;
  if pr.gather_on = v_day and pr.gather_count >= 200 then
    raise exception 'gather daily limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - p_now)))::int::text;
  end if;
end $$;

-- Counts a visit once its checks have passed (§7.5); the 200th of a day logs the soft gather_daily_cap.
create or replace function public._gather_count(p_account uuid, p_room uuid, p_rpc text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_day date := (p_now at time zone 'Asia/Ho_Chi_Minh')::date; v_n integer;
begin
  update public.farm_profiles
     set gather_count = case when gather_on = v_day then gather_count + 1 else 1 end, gather_on = v_day
   where account_id = p_account
  returning gather_count into v_n;
  if v_n = 200 then
    perform public._ac_flag(p_account, 'gather_daily_cap', p_rpc, jsonb_build_object('day', v_day, 'visits', 200), p_room,
                            null, false);
  end if;
end $$;

-- The account's farm belongings (0016's body): also the critters held (count and what cô Út pays, per kind), the capacity
-- and the gathering (§11.7) — the spots still cooling for me in any room, the visits left today and, at 0 left, when the
-- day resets. Like _fishing_state, it reads the day and the cooldowns on now().
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
                                          from public.farm_profiles pr where pr.account_id = p_account), 200) as left_today) d))
$$;

-- The whole field_state answer (0013's body), plus the critter prices the field shows (R12).
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
    'critter_prices', public._critter_prices(p_room, p_now))
$$;

revoke all on function public._critter_price(integer, numeric) from public, anon, authenticated;
revoke all on function public._critter_prices(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._critter_cap(uuid) from public, anon, authenticated;
revoke all on function public._critter_add(uuid, uuid, text[], timestamptz) from public, anon, authenticated;
revoke all on function public._gather_check(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._gather_count(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_mine(uuid) from public, anon, authenticated;
revoke all on function public._field_view(uuid, uuid, timestamptz) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected:

```text
v14 smoke ok
0018 twice ok
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
anticheat guards ok
v15.3 model smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.3): 0018 config, catalog, tables and the critter helpers

Sections A–C of 0018_v15_3_gather.sql: critter_kinds with cua đồng, cua gạch, ốc đồng
and ốc bươu vàng; the xô nhựa and giỏ tre (kind critter_box); the ledger check with the
21 reasons in force after 0017 plus critter_sell; the critters and gather_cooldowns
tables and the daily count on farm_profiles; the private price, capacity, catch and
daily-limit helpers; and _farm_mine and _field_view with the critters, the capacity,
the gathering and the prices the field shows. tests/fixtures/gather-cases.json pins the
rules, the prices and the spot keys, and tests/sql/v15-gather-smoke.sql starts.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0018_v15_3_gather.sql tests/fixtures/gather-cases.json tests/sql/v15-gather-smoke.sql
git commit -F <message file>
```

---

### Task 2: Database — crab holes, snail beds and cô Út's critters (`0018` section D)

**Files:**
- Modify: `supabase/migrations/0018_v15_3_gather.sql` (append section D)
- Modify: `tests/sql/v15-gather-smoke.sql` (the gathering part), `tests/sql/anticheat-guards.sql` (the 4 new guarded RPCs after `0017`'s card RPCs, 52 calls)

**Interfaces:**
- Consumes: Task 1 (`_critter_cap`, `_critter_add`, `_gather_check`, `_gather_count`, `_farm_mine`, `critters`, `gather_cooldowns`); from `0012`/`0015`: `_wallet_lock(account)`, `_pay(account, delta, reason, ref)`, `_ac_play(room, token)`, `_ac_account(token)`, `_ac_flag(…)`.
- Produces (Postgres):
  - private cores, each taking `p_now` and the wallet lock first, no plot lock and no `fp` (R11): `_gather_do_crab_start(room, account, hole, now)` — the daily limit, a free place (`critters full`), the hole's cooldown for this account in any room (`hole empty`, `details` = the seconds left, R1), then `ready_at = now + 20 min`, the visit on the hole's row and a counted visit (R6), answering `{server_now, mine, visit: {id, hole, started_at}}`; `_gather_do_crab_finish(room, account, visit, hits, now, p_u default null)` — single use (`visit not found`), hits ≥ 1 no sooner than 3 s (`too fast`, the visit kept), nothing after 120 s (`visit expired`), each hit a cua gạch when u < 0.1, answering `crab: {caught, escaped, hits}` (R7, §11.5); `_gather_do_bed(room, account, bed, now, p_u default null)` — the same three refusals (`bed empty`), `1 + floor(u₁ · 3)` snails, each an ốc đồng when uᵢ < 0.7, answering `snails: {caught, escaped}` (§7.3);
  - guarded RPCs (§11.4, §11.6): `crab_start(room, token, hole)` and `pick_snail_bed(room, token, bed)` with `_ac_play` and the hard `bad_spot` (`invalid spot`, detail `{spot}`) for a hole outside 1–6 or a bed outside 1–4; `crab_finish(room, token, visit_id, hits)` with the hard `bad_qty` (`invalid quantity`, detail `{visit, hits}`) for hits null or outside 0–3; `sell_critters(token, kind)` with `_ac_account` — every critter of a kind (null = all) at its stored price, `invalid kind`, `no critters`, the ledger reason `critter_sell` with ref `'<kind|all> x<n>'`, answering `sold: {n, xu}` (R15).
- Produces (smoke): the gathering part (crab starts and finishes, the gate and the window, the escapes, prices at M fixed at the catch, the beds, the daily limit, the envelopes with the state unchanged), printing `v15.3 gathering smoke ok`; the guard file's dynamic loop gains the 4 RPCs after `0017`'s 6 (`n = 52`).

- [ ] **Step 1: Write the smoke's gathering part and the guard lines**

**tests/sql/v15-gather-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- gathering (§7.2–§7.6, §11.4, §11.5): the holes, the beds, the daily limit and cô Út ----------
insert into smoke select 't3', token from public.register('gather_c_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't4', token from public.register('gather_d_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a3', public._auth_account((select v from smoke where k = 't3'))::text;
insert into smoke select 'a4', public._auth_account((select v from smoke where k = 't4'))::text;
insert into smoke select 'room2', room_id::text from public.create_room('Hang cua', 'pw', (select v from smoke where k = 't3'));
insert into smoke select 'room3', room_id::text from public.create_room('Bãi ốc', 'pw', (select v from smoke where k = 't3'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room2')::uuid), 'pw', v)
  from smoke where k = 't4';
-- 01:00 in Vietnam today: every visit below falls in one Vietnam day and one 3-hour price period.
insert into smoke select 'tg', ((public._vn_today()::timestamp + interval '1 hour') at time zone 'Asia/Ho_Chi_Minh')::text;

-- Each hole and bed writes the fixture's key with the fixture's cooldown, and each visit counts (§6, §7.5).
do $$
declare j jsonb := (select j from fx); a4 uuid := (select v from smoke where k = 'a4')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        p jsonb; n integer;
begin
  perform pg_temp.set_mult(room, 2.24, tg);
  perform pg_temp.give(a4, 'box_basket', 1);
  for p in select x from jsonb_array_elements(j->'spots') x loop
    n := split_part(p->>0, '_', 2)::int;
    if p->>0 like 'crab%' then
      perform public._gather_do_crab_start(room, a4, n, tg);
    else
      perform public._gather_do_bed(room, a4, n, tg, '{0, 0}');
    end if;
    assert exists (select 1 from public.gather_cooldowns where account_id = a4 and spot = p->>1
                     and ready_at = tg + make_interval(secs => (j->'rules'->>'cooldown_s')::int)), format('the key of %s', p);
  end loop;
  assert (select count(*) from public.gather_cooldowns where account_id = a4) = 10
     and (select count(*) from public.gather_cooldowns where account_id = a4 and visit_id is not null) = 6, 'ten spots, six visits';
  assert (select gather_on = (tg at time zone 'Asia/Ho_Chi_Minh')::date and gather_count = 10
            from public.farm_profiles where account_id = a4), 'ten visits';
  assert pg_temp.held(a4) = '{oc_dong,oc_dong,oc_dong,oc_dong}', 'u = 0: one ốc đồng a bed';
end $$;

-- crab_start (§7.2, R1, R6): the cooldown and the visit on the hole's row; hole empty with the seconds left, in any room.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        room3 uuid := (select v from smoke where k = 'room3')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        r jsonb; g public.gather_cooldowns; e jsonb;
begin
  r := public._gather_do_crab_start(room, a3, 3, tg);
  select * into g from public.gather_cooldowns where account_id = a3 and spot = 'crab3';
  assert g.ready_at = tg + interval '20 minutes' and g.visit_at = tg and g.visit_room = room and g.visit_id is not null,
    format('the cooldown and the visit %s', to_jsonb(g));
  assert r->'visit' = jsonb_build_object('id', g.visit_id, 'hole', 3, 'started_at', tg) and (r->>'server_now')::timestamptz = tg
     and r->'mine'->'critter_cap' = '3' and r->'mine'->'critters' = '{}', format('the answer %s', r);
  insert into smoke values ('visit1', g.visit_id::text);
  e := pg_temp.errd(format('select public._gather_do_crab_start(%L, %L, 3, %L)', room, a3, tg + interval '19 minutes 59 seconds'));
  assert e->>'message' = 'hole empty' and e->>'state' = '22023' and e->>'detail' = '1', format('at 19:59 %s', e);
  e := pg_temp.errd(format('select public._gather_do_crab_start(%L, %L, 3, %L)', room3, a3, tg + interval '1 minute'));
  assert e->>'message' = 'hole empty' and e->>'detail' = '1140', format('the same hole in another room %s', e);
  assert (select visit_id = g.visit_id and ready_at = g.ready_at from public.gather_cooldowns where account_id = a3 and spot = 'crab3')
     and (select gather_count from public.farm_profiles where account_id = a3) = 1, 'a refusal changes and counts nothing';
end $$;

-- crab_finish (§11.5, R7): too fast under 3 s, the visit kept; at 3 s the hits roll at the room's M; single use.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        tg timestamptz := (select v from smoke where k = 'tg')::timestamptz; v1 uuid := (select v from smoke where k = 'visit1')::uuid;
        r jsonb;
begin
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 3, %L, %L)', room, a3, v1,
                            tg + interval '2.9 seconds', '{0.05, 0.5, 0.95}')) = 'too fast', 'hits 3 at 2.9 s';
  assert exists (select 1 from public.gather_cooldowns where account_id = a3 and visit_id = v1), 'the visit stays open';
  r := public._gather_do_crab_finish(room, a3, v1, 3, tg + interval '3 seconds', '{0.05, 0.5, 0.95}');
  assert r->'crab' = '{"hits": 3, "caught": [{"kind": "cua_gach", "price": 100}, {"kind": "cua_dong", "price": 26},
                                              {"kind": "cua_dong", "price": 26}], "escaped": 0}', format('at 3 s %s', r->'crab');
  assert r->'mine'->'critters' = '{"cua_dong": {"n": 2, "xu": 52}, "cua_gach": {"n": 1, "xu": 100}}'
     and (r->>'server_now')::timestamptz = tg + interval '3 seconds', format('mine %s', r->'mine'->'critters');
  assert (select visit_id is null and visit_at is null and visit_room is null and ready_at = tg + interval '20 minutes'
            from public.gather_cooldowns where account_id = a3 and spot = 'crab3'), 'consumed, still cooling';
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 0, %L)', room, a3, v1, tg + interval '4 seconds'))
         = 'visit not found', 'single use';
  assert (select gather_count from public.farm_profiles where account_id = a3) = 1, 'a finish counts no visit';
end $$;

-- Full hands refuse a visit before its cooldown (R5); hits 0 needs no wait; another room's finish finds no visit; a
-- finish after 120 s is expired and leaves the visit; what does not fit escapes.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        room3 uuid := (select v from smoke where k = 'room3')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        r jsonb; v uuid;
begin
  assert pg_temp.err(format('select public._gather_do_crab_start(%L, %L, 1, %L)', room, a3, tg + interval '1 minute'))
         = 'critters full', 'hands full';
  assert pg_temp.err(format('select public._gather_do_bed(%L, %L, 1, %L)', room, a3, tg + interval '1 minute')) = 'critters full',
    'a bed too';
  assert not exists (select 1 from public.gather_cooldowns where account_id = a3 and spot in ('crab1', 'bed1')), 'no cooldown spent';
  perform pg_temp.give(a3, 'box_bucket', 1);
  v := (public._gather_do_crab_start(room, a3, 1, tg + interval '1 minute')->'visit'->>'id')::uuid;
  r := public._gather_do_crab_finish(room, a3, v, 0, tg + interval '1 minute 0.5 seconds');
  assert r->'crab' = '{"hits": 0, "caught": [], "escaped": 0}' and pg_temp.held(a3) = '{cua_gach,cua_dong,cua_dong}',
    format('hits 0 at 0.5 s %s', r->'crab');
  assert (select visit_id is null from public.gather_cooldowns where account_id = a3 and spot = 'crab1'), 'consumed';
  v := (public._gather_do_crab_start(room, a3, 2, tg + interval '2 minutes')->'visit'->>'id')::uuid;
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 1, %L)', room3, a3, v,
                            tg + interval '2 minutes 5 seconds')) = 'visit not found', 'another room';
  assert pg_temp.err(format('select public._gather_do_crab_finish(%L, %L, %L, 1, %L, %L)', room, a3, v,
                            tg + interval '4 minutes 1 second', '{0.5}')) = 'visit expired', 'at 121 s';
  r := public._gather_do_crab_finish(room, a3, v, 1, tg + interval '4 minutes', '{0.5}');
  assert r->'crab' = '{"hits": 1, "caught": [{"kind": "cua_dong", "price": 26}], "escaped": 0}', format('at 120 s %s', r->'crab');
  insert into public.critters (account_id, kind, price, caught_at) select a3, 'oc_dong', 17, tg from generate_series(1, 13);
  assert (select count(*) from public.critters where account_id = a3) = 17, '17 of 18';
  v := (public._gather_do_crab_start(room, a3, 4, tg + interval '5 minutes')->'visit'->>'id')::uuid;
  r := public._gather_do_crab_finish(room, a3, v, 3, tg + interval '5 minutes 4 seconds', '{0.5, 0.05, 0.05}');
  assert r->'crab' = '{"hits": 3, "caught": [{"kind": "cua_dong", "price": 26}], "escaped": 2}', format('one place %s', r->'crab');
  assert (select gather_count from public.farm_profiles where account_id = a3) = 4, 'four visits';
end $$;

-- Prices (R4): stored at the catch; the room's M moves to 5.00 and cô Út still pays what was stored (§7.6, R15).
do $$
declare t3 text := (select v from smoke where k = 't3'); a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; tg timestamptz := (select v from smoke where k = 'tg')::timestamptz;
        r jsonb;
begin
  perform pg_temp.set_mult(room, 5.00, tg);
  perform pg_temp.set_coins(a3, 1000);
  assert pg_temp.err(format('select public.sell_critters(%L, %L)', t3, 'tom')) = 'invalid kind', 'an unknown kind';
  assert pg_temp.err(format('select public.sell_critters(%L, %L)', t3, 'oc_buou_vang')) = 'no critters', 'none of that kind';
  r := public.sell_critters(t3, 'cua_gach');
  assert r->'sold' = '{"n": 1, "xu": 100}' and r->'mine'->'coins' = '1100' and r->'mine'->'critters'->'cua_gach' is null
     and r->>'server_now' is not null, format('one cua gạch %s', r);
  assert exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'critter_sell' and delta = 100 and balance = 1100
                   and ref = 'cua_gach x1'), 'the ledger row';
  -- 4 cua đồng at 26 and 13 ốc đồng at 17, whatever M is now
  r := public.sell_critters(t3, null);
  assert r->'sold' = '{"n": 17, "xu": 325}' and r->'mine'->'critters' = '{}' and r->'mine'->'coins' = '1425', format('all %s', r->'sold');
  assert exists (select 1 from public.coin_ledger where account_id = a3 and reason = 'critter_sell' and delta = 325
                   and ref = 'all x17'), 'the ledger row for all';
  assert pg_temp.err(format('select public.sell_critters(%L, null)', t3)) = 'no critters', 'nothing left';
end $$;

-- A snail bed (§7.3): u = (0.99, 0.1, 0.8, 0.5) gives 3 snails at M = 5.00; bed empty with the seconds left; what does
-- not fit is let go; full.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        tg timestamptz := (select v from smoke where k = 'tg')::timestamptz; r jsonb; e jsonb;
begin
  r := public._gather_do_bed(room, a3, 2, tg + interval '10 minutes', '{0.99, 0.1, 0.8, 0.5}');
  assert r->'snails' = '{"caught": [{"kind": "oc_dong", "price": 40}, {"kind": "oc_buou_vang", "price": 10},
                                     {"kind": "oc_dong", "price": 40}], "escaped": 0}', format('three snails %s', r->'snails');
  assert (select ready_at = tg + interval '30 minutes' and visit_id is null from public.gather_cooldowns
           where account_id = a3 and spot = 'bed2'), 'the bed cools, with no visit';
  e := pg_temp.errd(format('select public._gather_do_bed(%L, %L, 2, %L)', room, a3, tg + interval '22 minutes'));
  assert e->>'message' = 'bed empty' and e->>'state' = '22023' and e->>'detail' = '480', format('bed empty %s', e);
  r := public._gather_do_bed(room, a3, 3, tg + interval '10 minutes', '{0, 0.95}');
  assert r->'snails' = '{"caught": [{"kind": "oc_buou_vang", "price": 10}], "escaped": 0}', format('u₁ = 0: one %s', r->'snails');
  insert into public.critters (account_id, kind, price, caught_at) select a3, 'oc_dong', 40, tg from generate_series(1, 13);
  r := public._gather_do_bed(room, a3, 4, tg + interval '11 minutes', '{0.99, 0.1, 0.1, 0.1}');
  assert r->'snails' = '{"caught": [{"kind": "oc_dong", "price": 40}], "escaped": 2}', format('one place %s', r->'snails');
  assert pg_temp.err(format('select public._gather_do_bed(%L, %L, 1, %L)', room, a3, tg + interval '11 minutes')) = 'critters full',
    'a full bucket';
  assert (select gather_count from public.farm_profiles where account_id = a3) = 7, 'seven visits';
  delete from public.critters where account_id = a3;
end $$;

-- The daily limit through the visits (§7.5, R3): the 200th works and logs one soft gather_daily_cap; the 201st is refused
-- first, before full and the cooldown; a new Vietnam day starts again.
do $$
declare a3 uuid := (select v from smoke where k = 'a3')::uuid; room uuid := (select v from smoke where k = 'room2')::uuid;
        tg timestamptz := (select v from smoke where k = 'tg')::timestamptz; v_day date := (tg at time zone 'Asia/Ho_Chi_Minh')::date;
        e jsonb;
begin
  update public.farm_profiles set gather_on = v_day, gather_count = 199 where account_id = a3;
  perform public._gather_do_crab_start(room, a3, 5, tg + interval '12 minutes');
  assert (select gather_count from public.farm_profiles where account_id = a3) = 200
     and (select count(*) from public.anticheat_events where account_id = a3 and code = 'gather_daily_cap' and outcome = 'soft'
            and rpc = 'crab_start' and room_id = room and detail = jsonb_build_object('day', v_day, 'visits', 200)) = 1,
    'the 200th visit';
  insert into public.critters (account_id, kind, price, caught_at) select a3, 'oc_dong', 40, tg from generate_series(1, 18);
  e := pg_temp.errd(format('select public._gather_do_bed(%L, %L, 1, %L)', room, a3, tg + interval '13 minutes'));
  assert e->>'message' = 'gather daily limit' and e->>'state' = '53400'
     and (e->>'detail')::int = ceil(extract(epoch from ((v_day + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh'
                                                        - (tg + interval '13 minutes'))))::int, format('the 201st %s', e);
  e := pg_temp.errd(format('select public._gather_do_crab_start(%L, %L, 5, %L)', room, a3, tg + interval '13 minutes'));
  assert e->>'message' = 'gather daily limit', format('before the cooldown %s', e);
  delete from public.critters where account_id = a3;
  update public.farm_profiles set gather_on = v_day - 1 where account_id = a3;
  perform public._gather_do_bed(room, a3, 1, tg + interval '13 minutes', '{0, 0}');
  assert (select gather_on = v_day and gather_count = 1 from public.farm_profiles where account_id = a3), 'a new day';
  assert (select count(*) from public.anticheat_events where account_id = a3 and code = 'gather_daily_cap') = 1, 'logged once';
end $$;

-- The RPCs (§11.4, §11.6): hard bad_qty and bad_spot envelopes that change nothing; the guard's path at now(); public
-- RPCs, private cores.
do $$
declare t3 text := (select v from smoke where k = 't3'); a3 uuid := (select v from smoke where k = 'a3')::uuid;
        room uuid := (select v from smoke where k = 'room2')::uuid; r jsonb; v uuid; n0 integer; c0 bigint;
begin
  delete from public.gather_cooldowns where account_id = a3;
  delete from public.critters where account_id = a3;
  n0 := (select gather_count from public.farm_profiles where account_id = a3);
  r := public.crab_finish(room, t3, gen_random_uuid(), 4);
  assert r->'anticheat'->>'code' = 'bad_qty' and r->'anticheat'->>'error' = 'invalid quantity' and r->'anticheat'->>'strike' = '0'
     and r - 'anticheat' = '{}', format('hits 4 %s', r);
  assert public.crab_finish(room, t3, gen_random_uuid(), -1)->'anticheat'->>'code' = 'bad_qty', 'hits -1';
  assert public.crab_finish(room, t3, gen_random_uuid(), null)->'anticheat'->>'code' = 'bad_qty', 'hits null';
  r := public.crab_start(room, t3, 7);
  assert r->'anticheat'->>'code' = 'bad_spot' and r->'anticheat'->>'error' = 'invalid spot' and r - 'anticheat' = '{}',
    format('hole 7 %s', r);
  assert public.crab_start(room, t3, 0)->'anticheat'->>'code' = 'bad_spot'
     and public.crab_start(room, t3, null)->'anticheat'->>'code' = 'bad_spot', 'hole 0 and null';
  r := public.pick_snail_bed(room, t3, 0);
  assert r->'anticheat'->>'code' = 'bad_spot' and r->'anticheat'->>'error' = 'invalid spot', format('bed 0 %s', r);
  assert public.pick_snail_bed(room, t3, 5)->'anticheat'->>'code' = 'bad_spot', 'bed 5';
  assert (select count(*) from public.anticheat_events where account_id = a3 and code = 'bad_qty' and rpc = 'crab_finish') = 3
     and exists (select 1 from public.anticheat_events where account_id = a3 and code = 'bad_qty' and detail->'hits' = '4'
                   and detail ? 'visit')
     and (select count(*) from public.anticheat_events where account_id = a3 and code = 'bad_spot') = 5
     and exists (select 1 from public.anticheat_events where account_id = a3 and code = 'bad_spot' and rpc = 'pick_snail_bed'
                   and detail = '{"spot": 0}' and room_id = room), 'the evidence';
  assert (select gather_count from public.farm_profiles where account_id = a3) = n0
     and not exists (select 1 from public.gather_cooldowns where account_id = a3), 'the state is unchanged';
  -- through the guard, at now()
  r := public.pick_snail_bed(room, t3, 4);
  assert jsonb_array_length(r->'snails'->'caught') between 1 and 3 and r->'snails'->'escaped' = '0' and r ? 'server_now'
     and r->'mine'->'gather'->'ready_at' ? 'bed4', format('pick_snail_bed %s', r);
  r := public.crab_start(room, t3, 6);
  v := (r->'visit'->>'id')::uuid;
  assert r->'visit'->'hole' = '6' and r->'mine'->'gather'->'ready_at' ? 'crab6', format('crab_start %s', r);
  r := public.crab_finish(room, t3, v, 0);
  assert r->'crab' = '{"hits": 0, "caught": [], "escaped": 0}', format('crab_finish %s', r);
  assert pg_temp.err(format('select public.crab_finish(%L, %L, %L, 1)', room, t3, v)) = 'visit not found', 'single use';
  assert (select gather_count from public.farm_profiles where account_id = a3) = n0 + 2, 'two visits';
  assert has_function_privilege('anon', 'public.crab_start(uuid,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.crab_finish(uuid,text,uuid,integer)', 'execute')
     and has_function_privilege('anon', 'public.pick_snail_bed(uuid,text,integer)', 'execute')
     and has_function_privilege('anon', 'public.sell_critters(text,text)', 'execute')
     and not has_function_privilege('anon', 'public._gather_do_crab_start(uuid,uuid,integer,timestamptz)', 'execute')
     and not has_function_privilege('anon', 'public._gather_do_crab_finish(uuid,uuid,uuid,integer,timestamptz,double precision[])',
                                    'execute')
     and not has_function_privilege('anon', 'public._gather_do_bed(uuid,uuid,integer,timestamptz,double precision[])', 'execute'),
    'public RPCs, private cores';
end $$;

select 'v15.3 gathering smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/anticheat-guards.sql — edit 1 of 2.** Replace:

```sql
    format('select public.pk_act(%L, %L, 0, %L, null)', room, t, 'fold'),
    format('select public.pk_topup(%L, %L, 1000)', room, t)] loop
    n := n + 1;
```

with:

```sql
    format('select public.pk_act(%L, %L, 0, %L, null)', room, t, 'fold'),
    format('select public.pk_topup(%L, %L, 1000)', room, t),
    -- v15.3 (0018)
    format('select public.crab_start(%L, %L, 1)', room, t),
    format('select public.crab_finish(%L, %L, %L, 1)', room, t, o),
    format('select public.pick_snail_bed(%L, %L, 1)', room, t),
    format('select public.sell_critters(%L, null)', t)] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 2 of 2.** Replace:

```sql
  end loop;
  assert n = 48, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 52, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` — its last step, the guard file, calls the new RPCs (`function public.crab_start(unknown, unknown, integer) does not exist` in the log).

- [ ] **Step 3: Append section D**

**supabase/migrations/0018_v15_3_gather.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- D. Gathering (§7.2–§7.6, §11.4, §11.5) ----------
-- A spot's key is 'crab' || hole or 'bed' || bed (lib/game/farm/gather.ts spotKey). Each core takes the wallet lock first,
-- then checks, then writes; _critter_add reads the fish index last (R12). No plot lock and no fp (R11).

-- A visit to a crab hole (§7.2, R6): the daily limit, a free place, the hole's cooldown for this account in any room
-- (R1); then the cooldown starts, the visit rides on the hole's row, and the visit counts.
create or replace function public._gather_do_crab_start(p_room uuid, p_account uuid, p_hole integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_spot text := 'crab' || p_hole; g public.gather_cooldowns; v_id uuid := gen_random_uuid();
begin
  perform public._wallet_lock(p_account);
  perform public._gather_check(p_account, p_now);
  if public._critter_cap(p_account) - (select count(*)::int from public.critters where account_id = p_account) < 1 then
    raise exception 'critters full' using errcode = '22023';
  end if;
  select * into g from public.gather_cooldowns where account_id = p_account and spot = v_spot for update;
  if found and p_now < g.ready_at then
    raise exception 'hole empty' using errcode = '22023', detail = ceil(extract(epoch from (g.ready_at - p_now)))::int::text;
  end if;
  insert into public.gather_cooldowns (account_id, spot, ready_at, visit_id, visit_at, visit_room)
  values (p_account, v_spot, p_now + interval '20 minutes', v_id, p_now, p_room)
  on conflict (account_id, spot) do update
    set ready_at = excluded.ready_at, visit_id = excluded.visit_id, visit_at = excluded.visit_at, visit_room = excluded.visit_room;
  perform public._gather_count(p_account, p_room, 'crab_start', p_now);
  return jsonb_build_object('server_now', p_now, 'mine', public._farm_mine(p_account),
                            'visit', jsonb_build_object('id', v_id, 'hole', p_hole, 'started_at', p_now));
end $$;

-- The end of a crab visit (§11.5, R7): single use; hits ≥ 1 need 3 s, and nothing is taken after 120 s. Each hit is a
-- cua gạch when u < 0.1, else a cua đồng (p_u for the tests, R14); what does not fit escapes.
create or replace function public._gather_do_crab_finish(p_room uuid, p_account uuid, p_visit uuid, p_hits integer,
                                                         p_now timestamptz, p_u double precision[] default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare g public.gather_cooldowns; v_kinds text[] := '{}'; v_res jsonb; k integer;
begin
  perform public._wallet_lock(p_account);
  select * into g from public.gather_cooldowns
   where account_id = p_account and visit_id = p_visit and visit_room = p_room for update;
  if not found then
    raise exception 'visit not found' using errcode = '22023';
  end if;
  if p_hits >= 1 and p_now < g.visit_at + interval '3 seconds' then
    raise exception 'too fast' using errcode = '22023';
  end if;
  if p_now > g.visit_at + interval '120 seconds' then
    raise exception 'visit expired' using errcode = '22023';
  end if;
  update public.gather_cooldowns set visit_id = null, visit_at = null, visit_room = null
   where account_id = p_account and spot = g.spot;
  for k in 1 .. p_hits loop
    v_kinds := v_kinds || case when coalesce(p_u[k], random()) < 0.1 then 'cua_gach' else 'cua_dong' end;
  end loop;
  v_res := public._critter_add(p_account, p_room, v_kinds, p_now);
  return jsonb_build_object('server_now', p_now, 'mine', public._farm_mine(p_account),
                            'crab', v_res || jsonb_build_object('hits', p_hits));
end $$;

-- A snail bed (§7.3): the same three refusals as a hole; then the cooldown, the visit, and 1 + floor(u₁ · 3) snails,
-- each an ốc đồng when uᵢ < 0.7, else an ốc bươu vàng (p_u for the tests, R14).
create or replace function public._gather_do_bed(p_room uuid, p_account uuid, p_bed integer, p_now timestamptz,
                                                 p_u double precision[] default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_spot text := 'bed' || p_bed; g public.gather_cooldowns; v_n integer; v_kinds text[] := '{}'; v_res jsonb; k integer;
begin
  perform public._wallet_lock(p_account);
  perform public._gather_check(p_account, p_now);
  if public._critter_cap(p_account) - (select count(*)::int from public.critters where account_id = p_account) < 1 then
    raise exception 'critters full' using errcode = '22023';
  end if;
  select * into g from public.gather_cooldowns where account_id = p_account and spot = v_spot for update;
  if found and p_now < g.ready_at then
    raise exception 'bed empty' using errcode = '22023', detail = ceil(extract(epoch from (g.ready_at - p_now)))::int::text;
  end if;
  insert into public.gather_cooldowns (account_id, spot, ready_at) values (p_account, v_spot, p_now + interval '20 minutes')
  on conflict (account_id, spot) do update set ready_at = excluded.ready_at;
  perform public._gather_count(p_account, p_room, 'pick_snail_bed', p_now);
  v_n := 1 + floor(coalesce(p_u[1], random()) * 3)::int;
  for k in 1 .. v_n loop
    v_kinds := v_kinds || case when coalesce(p_u[k + 1], random()) < 0.7 then 'oc_dong' else 'oc_buou_vang' end;
  end loop;
  v_res := public._critter_add(p_account, p_room, v_kinds, p_now);
  return jsonb_build_object('server_now', p_now, 'mine', public._farm_mine(p_account), 'snails', v_res);
end $$;

-- The guarded RPCs (§11.4, §11.6): the guard, then the hard checks (bad_spot, bad_qty) before any lock.
create or replace function public.crab_start(p_room_id uuid, p_session_token text, p_hole integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_hole is null or p_hole not between 1 and 6 then
    return public._ac_flag(v_account, 'bad_spot', 'crab_start', jsonb_build_object('spot', p_hole), p_room_id, 'invalid spot');
  end if;
  return public._gather_do_crab_start(p_room_id, v_account, p_hole, now());
end $$;

create or replace function public.crab_finish(p_room_id uuid, p_session_token text, p_visit_id uuid, p_hits integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_hits is null or p_hits not between 0 and 3 then
    return public._ac_flag(v_account, 'bad_qty', 'crab_finish', jsonb_build_object('visit', p_visit_id, 'hits', p_hits),
                           p_room_id, 'invalid quantity');
  end if;
  return public._gather_do_crab_finish(p_room_id, v_account, p_visit_id, p_hits, now());
end $$;

create or replace function public.pick_snail_bed(p_room_id uuid, p_session_token text, p_bed integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_bed is null or p_bed not between 1 and 4 then
    return public._ac_flag(v_account, 'bad_spot', 'pick_snail_bed', jsonb_build_object('spot', p_bed), p_room_id, 'invalid spot');
  end if;
  return public._gather_do_bed(p_room_id, v_account, p_bed, now());
end $$;

-- cô Út buys the critters (§7.6, R15): every one of a kind (null = all) at its stored price, ledger reason critter_sell.
create or replace function public.sell_critters(p_session_token text, p_kind text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_n integer; v_xu integer;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  if p_kind is not null and not exists (select 1 from public.critter_kinds where id = p_kind) then
    raise exception 'invalid kind' using errcode = '22023';
  end if;
  with sold as (
    delete from public.critters where account_id = v_account and (p_kind is null or kind = p_kind) returning price
  ) select count(*)::int, coalesce(sum(price), 0)::int into v_n, v_xu from sold;
  if v_n = 0 then
    raise exception 'no critters' using errcode = '22023';
  end if;
  perform public._pay(v_account, v_xu, 'critter_sell', coalesce(p_kind, 'all') || ' x' || v_n);
  return jsonb_build_object('server_now', now(), 'mine', public._farm_mine(v_account),
                            'sold', jsonb_build_object('n', v_n, 'xu', v_xu));
end $$;

revoke all on function public._gather_do_crab_start(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._gather_do_crab_finish(uuid, uuid, uuid, integer, timestamptz, double precision[])
  from public, anon, authenticated;
revoke all on function public._gather_do_bed(uuid, uuid, integer, timestamptz, double precision[]) from public, anon, authenticated;
grant execute on function public.crab_start(uuid, text, integer) to anon, authenticated;
grant execute on function public.crab_finish(uuid, text, uuid, integer) to anon, authenticated;
grant execute on function public.pick_snail_bed(uuid, text, integer) to anon, authenticated;
grant execute on function public.sell_critters(text, text) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected:

```text
v14 smoke ok
0018 twice ok
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
anticheat guards ok
v15.3 model smoke ok
v15.3 gathering smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.3): 0018 gathering — crab holes, snail beds and cô Út's critters

Section D of 0018_v15_3_gather.sql: crab_start records the visit on the hole's
20-minute cooldown (per account, across rooms), crab_finish takes 0–3 hits behind the
3 s gate and within 120 s, pick_snail_bed gives 1–3 snails, and sell_critters pays the
prices stored at the catch. The daily limit, a free place and the cooldown refuse in
that order; bad_spot and bad_qty are hard envelopes. The four RPCs join the guard loop
after 0017's card RPCs (52 calls), and the gather smoke pins the flows.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0018_v15_3_gather.sql tests/sql/anticheat-guards.sql tests/sql/v15-gather-smoke.sql
git commit -F <message file>
```

---

### Task 3: Database — the transplant round's gates, pest snails and the containers (`0018` section E)

**Files:**
- Modify: `supabase/migrations/0018_v15_3_gather.sql` (append section E)
- Modify: `tests/sql/v15-gather-smoke.sql` (the farm part), `tests/sql/v15-smoke.sql`, `tests/sql/anticheat-smoke.sql` and `tests/sql/v15-2-smoke.sql` (transplants claimed 8 s after `begin_work`; the v15.2 smoke re-runs `0018` after each `0016` and its transplant lease case becomes 24 s → `lease ending`, 25 s → allowed)

**Interfaces:**
- Consumes: Task 1's `_critter_add`, `_critter_cap`, `_farm_mine`, `_field_view`; from `0013`: `_work_gate(c, work, now)` (its latest definition), `_work_check`, `_farm_crop`, `_field_open`, `_plot_row`, `_crop_pests`, `_variety`, `_owns`; from `0016` (with its fix round): the bodies of `_farm_do_transplant`, `_farm_do_begin_work` (25 s on a lease for a rice round), `_farm_do_pick_snails` and `buy_farm_item`.
- Produces (Postgres, each re-created from its latest body with only the §8.3 / §7.4 / §9 changes):
  - `_work_gate(c, work, now)`: a transplant only while `work = 'transplant'` and 8 s ≤ now − `work_started_at` ≤ 120 s (`too fast` / `work expired`); any other work keeps the 2 s gate with no upper bound (R19);
  - `_farm_do_transplant(room, account, plot, quality, now)`: `0016`'s body (rice gets `transplant_at` and `q_transplant = 1.0`, an ớt nursery gets P), under the new gate;
  - `_farm_do_begin_work(room, account, plot, work, now)`: 25 s left on a lease for a rice round or any transplant (a rice round's gate, ruled), 5 s for a picking (`lease ending`);
  - `_farm_do_pick_snails(room, account, plot, now)`: `0016`'s checks and `picks` log, then 1–3 ốc bươu vàng for the picker through `_critter_add`; the answer is the field view plus `snails` (R10);
  - `buy_farm_item(token, item, qty)`: also `critter_box` — a quantity ≠ 1 is a plain `invalid quantity`, a container no larger than the largest held is `already owned` (R16).
- Produces (smoke): the farm part (the three gates for rice and ớt, replacement, the lease gate, a lease that runs out mid-round, pest snails with free space and full, the containers), printing `v15.3 farm smoke ok`.

- [ ] **Step 1: Write the smoke's farm part and move the earlier smokes to the 8 s gate**

**tests/sql/v15-gather-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- farm changes (§7.4, §8.3, §9, R10, R16, R19): containers, pest snails and the three gates ----------
insert into smoke select 't5', token from public.register('gather_e_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a5', public._auth_account((select v from smoke where k = 't5'))::text;
-- One room a test: an account farms at most 2 plots in a room.
insert into smoke select 'room4', room_id::text from public.create_room('Ruộng lúa', 'pw', (select v from smoke where k = 't5'));
insert into smoke select 'room5', room_id::text from public.create_room('Cấy lúa', 'pw', (select v from smoke where k = 't5'));
insert into smoke select 'room6', room_id::text from public.create_room('Cây ớt', 'pw', (select v from smoke where k = 't5'));
insert into smoke select 'room7', room_id::text from public.create_room('Hái hoa màu', 'pw', (select v from smoke where k = 't5'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room4')::uuid), 'pw', v)
  from smoke where k = 't4';
create function pg_temp.plot(s jsonb, n integer) returns jsonb language sql as $$ select s->'plots'->(n - 1) $$;
create function pg_temp.crop(r uuid, n integer) returns public.crops language sql
as $$ select * from public.crops where room_id = r and plot_no = n $$;
-- A rice crop on plot n, transplanted 4 h before t, whose first pest roll is a golden-snail outbreak (as in the v15 smoke).
create function pg_temp.snail_rice(r uuid, n integer, a uuid, t timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log,
                                pest_rolls)
      values (r, n, a, 'short', t - interval '16 hours', t - interval '16 hours', t - interval '14 hours', t - interval '4 hours',
              jsonb_build_array(jsonb_build_object('t', t - interval '16 hours', 'l', 2), jsonb_build_object('t', t - interval '4 hours', 'l', 2)),
              '[{"slot": 1, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.1}, {"slot": 2, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99},
                {"slot": 3, "u_time": 0.5, "u_kind": 0.5, "u_hit": 0.99}]') $$;
-- Rice seedlings on plot n, 9 h old at t (short: ready from 7.2 h), in shallow water (Nông).
create function pg_temp.seedlings(r uuid, n integer, a uuid, t timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, water_log)
      values (r, n, a, 'short', t - interval '12 hours', t - interval '12 hours', t - interval '9 hours',
              jsonb_build_array(jsonb_build_object('t', t - interval '12 hours', 'l', 3),
                                jsonb_build_object('t', t - interval '10 hours', 'l', 1),
                                jsonb_build_object('t', t - interval '1 hour', 'l', 2))) $$;
-- An ớt nursery on plot n, sown 11 h before t (ready from 10 h), on an Ẩm bed.
create function pg_temp.ot_nursery(r uuid, n integer, a uuid, t timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, sow_at, water_log)
      values (r, n, a, 'upland', 'ot', t - interval '12 hours', t - interval '11 hours',
              jsonb_build_array(jsonb_build_object('t', t - interval '12 hours', 'l', 1), jsonb_build_object('t', t, 'l', 1))) $$;
-- A khoai bed on plot n, ripe at t (R_1 = P + 48 h).
create function pg_temp.ripe_khoai(r uuid, n integer, a uuid, t timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, kind, upland, prepared_at, plant_at, water_log)
      values (r, n, a, 'upland', 'khoai', t - interval '49 hours', t - interval '48 hours',
              jsonb_build_array(jsonb_build_object('t', t - interval '49 hours', 'l', 1))) $$;
-- A ripe nếp crop on plot n (as in the v15.2 smoke): ripe until t + 10 h.
create function pg_temp.ripe_nep(r uuid, n integer, a uuid, t timestamptz) returns void language sql
as $$ insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, transplant_at, water_log)
      values (r, n, a, 'nep', t - interval '64 hours', t - interval '63 hours', t - interval '60 hours', t - interval '50 hours',
              jsonb_build_array(jsonb_build_object('t', t - interval '64 hours', 'l', 3),
                                jsonb_build_object('t', t - interval '5 hours', 'l', 1))) $$;

-- Containers at anh Hai's (§9, R16): one at a time and once; one no larger than the one held is already owned.
do $$
declare t5 text := (select v from smoke where k = 't5'); a5 uuid := (select v from smoke where k = 'a5')::uuid; r jsonb;
begin
  perform pg_temp.set_coins(a5, 10000);
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 2)', t5, 'box_bucket')) = 'invalid quantity', 'one at a time';
  assert not exists (select 1 from public.anticheat_events where account_id = a5), 'a plain refusal: no event';
  r := public.buy_farm_item(t5, 'box_bucket', 0);
  assert r->'anticheat'->>'code' = 'bad_qty' and r->'anticheat'->>'error' = 'invalid quantity', 'outside 1–99 stays hard';
  r := public.buy_farm_item(t5, 'box_bucket', 1);
  assert r->'mine'->'items'->'box_bucket' = '1' and r->'mine'->'critter_cap' = '18' and r->'mine'->'coins' = '8500'
     and exists (select 1 from public.coin_ledger where account_id = a5 and reason = 'farm_buy' and delta = -1500
                  and ref = 'box_bucket x1'), format('a bucket %s', r->'mine');
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t5, 'box_bucket')) = 'already owned', 'a second bucket';
  r := public.buy_farm_item(t5, 'box_basket', 1);
  assert r->'mine'->'critter_cap' = '33' and r->'mine'->'coins' = '2500', format('then a basket %s', r->'mine');
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t5, 'box_bucket')) = 'already owned', 'a basket holds more';
  -- the money comes last
  delete from public.inventory where account_id = a5 and item_id in ('box_bucket', 'box_basket');
  perform pg_temp.set_coins(a5, 1499);
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t5, 'box_bucket')) = 'not enough coins', 'not enough coins';
  -- the other kinds keep their rules
  r := public.buy_farm_item(t5, 'rod_bamboo', 1);
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'strike' = '0', 'no fishing gear here';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 2)', t5, 'tool_sickle')) = 'invalid quantity', 'tools too';
end $$;

-- Pest snails (§7.4, R10): a neighbour treats the plot and keeps 1–3 ốc bươu vàng; a full container still treats and lets
-- them go; no visit is counted.
do $$
declare a4 uuid := (select v from smoke where k = 'a4')::uuid; a5 uuid := (select v from smoke where k = 'a5')::uuid;
        room uuid := (select v from smoke where k = 'room4')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb; n0 integer;
begin
  perform pg_temp.set_coins(a5, 100000);
  perform public._farm_do_rent(room, a5, 5, t);
  perform public._farm_do_rent(room, a5, 6, t);
  perform pg_temp.snail_rice(room, 5, a5, t);
  perform pg_temp.snail_rice(room, 6, a5, t);
  assert pg_temp.plot(public._field_view(room, a5, t), 5)->'crop'->'pests'->0->>'kind' = 'snail', 'an outbreak';
  perform pg_temp.set_mult(room, 1.00, t);
  delete from public.critters where account_id = a4;
  n0 := (select gather_count from public.farm_profiles where account_id = a4);
  s := public._farm_do_pick_snails(room, a4, 5, t);
  assert pg_temp.plot(s, 5)->'crop'->'pests'->0->'treated_at' <> 'null', 'treated by a neighbour';
  assert jsonb_array_length(s->'snails'->'caught') between 1 and 3 and s->'snails'->'escaped' = '0'
     and s->'snails'->'caught'->0 = '{"kind": "oc_buou_vang", "price": 2}'
     and (select count(*) from public.critters where account_id = a4 and kind = 'oc_buou_vang' and price = 2)
         = jsonb_array_length(s->'snails'->'caught')
     and s->'mine'->'critters'->'oc_buou_vang'->'n' = to_jsonb(jsonb_array_length(s->'snails'->'caught')),
    format('the picker''s snails %s', s->'snails');
  assert (select gather_count from public.farm_profiles where account_id = a4) = n0, 'no visit counted';
  -- a full basket: the plot is still saved, and the snails go back into the canal
  insert into public.critters (account_id, kind, price, caught_at)
  select a4, 'oc_dong', 8, t from generate_series(1, 33 - (select count(*)::int from public.critters where account_id = a4));
  s := public._farm_do_pick_snails(room, a4, 6, t);
  assert pg_temp.plot(s, 6)->'crop'->'pests'->0->'treated_at' <> 'null' and s->'snails'->'caught' = '[]'
     and (s->'snails'->>'escaped')::int between 1 and 3 and (select count(*) from public.critters where account_id = a4) = 33,
    format('full %s', s->'snails');
  assert pg_temp.err(format('select public._farm_do_pick_snails(%L, %L, 6, %L)', room, a4, t)) = 'no snails', 'picked already';
  delete from public.critters where account_id = a4;
end $$;

-- The transplant gate (§8.3, R19): 8–120 s after begin_work, rice and ớt; a second begin_work restarts it; the quality
-- stays 1.0.
do $$
declare a5 uuid := (select v from smoke where k = 'a5')::uuid; room uuid := (select v from smoke where k = 'room5')::uuid;
        room6 uuid := (select v from smoke where k = 'room6')::uuid; t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        s jsonb;
begin
  perform pg_temp.set_coins(a5, 100000);
  perform public._farm_do_rent(room, a5, 5, t);
  perform public._farm_do_rent(room, a5, 6, t);
  perform pg_temp.seedlings(room, 5, a5, t);
  perform pg_temp.seedlings(room, 6, a5, t);
  -- rice, plot 5: 7.9 s and 121 s are refused and leave the record; a second begin_work restarts the gate
  perform public._farm_do_begin_work(room, a5, 5, 'transplant', t);
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 5, 1, %L)', room, a5, t + interval '7.9 seconds'))
         = 'too fast', '7.9 s';
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 5, 1, %L)', room, a5, t + interval '121 seconds'))
         = 'work expired', '121 s';
  assert (pg_temp.crop(room, 5)).work = 'transplant' and (pg_temp.crop(room, 5)).work_started_at = t, 'the record stays';
  perform public._farm_do_begin_work(room, a5, 5, 'transplant', t + interval '3 minutes');
  perform public._farm_do_begin_work(room, a5, 5, 'transplant', t + interval '3 minutes 5 seconds');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 5, 1, %L)', room, a5, t + interval '3 minutes 12 seconds'))
         = 'too fast', '12 s after the first, 7 s after the second';
  s := public._farm_do_transplant(room, a5, 5, 1, t + interval '3 minutes 13 seconds');
  assert pg_temp.plot(s, 5)->'crop'->>'phase' = 'tillering'
     and (pg_temp.crop(room, 5)).transplant_at = t + interval '3 minutes 13 seconds' and (pg_temp.crop(room, 5)).q_transplant = 1.0
     and (pg_temp.crop(room, 5)).work is null, 'transplanted at 8 s';
  -- rice, plot 6: accepted at 120 s
  perform public._farm_do_begin_work(room, a5, 6, 'transplant', t + interval '4 minutes');
  s := public._farm_do_transplant(room, a5, 6, 1, t + interval '6 minutes');
  assert (pg_temp.crop(room, 6)).transplant_at = t + interval '6 minutes' and (pg_temp.crop(room, 6)).q_transplant = 1.0,
    'transplanted at 120 s';
  -- ớt, room 6 plot 5: the same gate; P is set
  perform public._farm_do_rent(room6, a5, 5, t);
  perform pg_temp.ot_nursery(room6, 5, a5, t);
  perform public._farm_do_begin_work(room6, a5, 5, 'transplant', t + interval '7 minutes');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 5, 1, %L)', room6, a5, t + interval '7 minutes 7.9 seconds'))
         = 'too fast', 'ớt at 7.9 s';
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 5, 1, %L)', room6, a5, t + interval '9 minutes 1 second'))
         = 'work expired', 'ớt at 121 s';
  perform public._farm_do_begin_work(room6, a5, 5, 'transplant', t + interval '10 minutes');
  s := public._farm_do_transplant(room6, a5, 5, 1, t + interval '10 minutes 8 seconds');
  assert pg_temp.plot(s, 5)->'crop'->>'phase' = 'root' and (pg_temp.crop(room6, 5)).plant_at = t + interval '10 minutes 8 seconds'
     and (pg_temp.crop(room6, 5)).work is null, 'ớt planted out at 8 s';
end $$;

-- A transplant needs 25 s on the lease, as a rice round does (R19): 24 s left is lease ending, 25 s is allowed; a claim
-- after the lease ran out finds no plot.
do $$
declare a5 uuid := (select v from smoke where k = 'a5')::uuid; room uuid := (select v from smoke where k = 'room6')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; l timestamptz := t + interval '1 hour';
begin
  perform public._farm_do_rent(room, a5, 6, t);
  perform pg_temp.seedlings(room, 6, a5, t);
  update public.plot_leases set until = l where room_id = room and plot_no = 6;
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 6, %L, %L)', room, a5, 'transplant', l - interval '24 seconds'))
         = 'lease ending', '24 s left';
  perform public._farm_do_begin_work(room, a5, 6, 'transplant', l - interval '25 seconds');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 6, 1, %L)', room, a5, l + interval '1 second'))
         = 'not your plot', 'the lease ran out mid-round';
  perform public._field_open(room, l + interval '1 second');
  assert not exists (select 1 from public.crops where room_id = room and plot_no = 6), 'the seedlings went with the lease';
end $$;

-- The other gates stay (§8.3): a hoa-màu picking 2 s after its begin_work with no upper bound; harvest_part 8–120 s.
do $$
declare a5 uuid := (select v from smoke where k = 'a5')::uuid; room uuid := (select v from smoke where k = 'room7')::uuid;
        t timestamptz := (select v from smoke where k = 'now')::timestamptz; s jsonb;
begin
  perform public._farm_do_rent(room, a5, 5, t);
  perform public._farm_do_rent(room, a5, 6, t);
  perform pg_temp.ripe_khoai(room, 5, a5, t);
  perform pg_temp.ripe_khoai(room, 6, a5, t);
  perform public._farm_do_begin_work(room, a5, 5, 'harvest', t);
  assert pg_temp.err(format('select public._farm_do_harvest(%L, %L, 5, 1, %L)', room, a5, t + interval '1.9 seconds')) = 'too fast',
    'a picking at 1.9 s';
  s := public._farm_do_harvest(room, a5, 5, 1, t + interval '2 seconds');
  assert s->'harvest'->>'upland' = 'khoai' and s->'harvest'->'done' = 'true', format('a picking at 2 s %s', s->'harvest');
  perform public._farm_do_begin_work(room, a5, 6, 'harvest', t + interval '1 minute');
  s := public._farm_do_harvest(room, a5, 6, 1, t + interval '11 minutes');
  assert s->'harvest'->'done' = 'true', 'a picking 10 minutes after its begin_work';
  -- harvest_part on plot 7 (both khoai leases ended with their last picking)
  perform pg_temp.give(a5, 'tool_sickle', 1);
  perform public._farm_do_rent(room, a5, 7, t + interval '12 minutes');
  perform pg_temp.ripe_nep(room, 7, a5, t);
  perform public._farm_do_begin_work(room, a5, 7, 'harvest', t + interval '12 minutes');
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 7, true, %L)', room, a5, t + interval '12 minutes 7.9 seconds'))
         = 'too fast', 'part at 7.9 s';
  s := public._farm_do_harvest_part(room, a5, 7, true, t + interval '12 minutes 8 seconds');
  assert s->'harvest_part'->'parts' = '1', 'part 1 at 8 s';
  perform public._farm_do_begin_work(room, a5, 7, 'harvest', t + interval '13 minutes');
  s := public._farm_do_harvest_part(room, a5, 7, true, t + interval '15 minutes');
  assert s->'harvest_part'->'parts' = '2', 'part 2 at 120 s';
  perform public._farm_do_begin_work(room, a5, 7, 'harvest', t + interval '16 minutes');
  assert pg_temp.err(format('select public._farm_do_harvest_part(%L, %L, 7, true, %L)', room, a5, t + interval '18 minutes 1 second'))
         = 'work expired', 'part at 121 s';
end $$;

select 'v15.3 farm smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/v15-smoke.sql — edit 1 of 3.** Replace:

```sql
-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0016, from the repo
-- root (the crop fixtures are read with \copy, and the last section re-runs 0013 with \i). Every check is an ASSERT; the
```

with:

```sql
-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0018, from the repo
-- root (the crop fixtures are read with \copy, and the last section re-runs 0013 with \i). Every check is an ASSERT; the
```

**tests/sql/v15-smoke.sql — edit 2 of 3.** Replace:

```sql

  -- transplant: seedlings ≥ 7.2 h (short) in shallow water, after a 2 s action
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'transplant', t + interval '9 hours'))
```

with:

```sql

  -- transplant: seedlings ≥ 7.2 h (short) in shallow water, 8 s after begin_work (a TransplantGame round, 0018)
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 8, %L, %L)', room, a2, 'transplant', t + interval '9 hours'))
```

**tests/sql/v15-smoke.sql — edit 3 of 3.** Replace:

```sql
  perform public._farm_do_begin_work(room, a2, 8, 'transplant', t + interval '10 hours');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 8, 1, %L)', room, a2, t + interval '10 hours 1 second'))
    = 'too fast', 'the 2 s gate';
  tp := t + interval '10 hours 3 seconds';
  s := public._farm_do_transplant(room, a2, 8, 5.0, tp);
```

with:

```sql
  perform public._farm_do_begin_work(room, a2, 8, 'transplant', t + interval '10 hours');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 8, 1, %L)', room, a2, t + interval '10 hours 7 seconds'))
    = 'too fast', 'the 8 s gate';
  tp := t + interval '10 hours 8 seconds';
  s := public._farm_do_transplant(room, a2, 8, 5.0, tp);
```

**tests/sql/anticheat-smoke.sql.** Replace:

```sql
  values (room, 9, h3, 'short', t - interval '20 hours', t - interval '20 hours', t - interval '18 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '1 hour', 'l', 2)), 'transplant', t - interval '3 seconds')
  on conflict (room_id, plot_no) do nothing;
```

with:

```sql
  values (room, 9, h3, 'short', t - interval '20 hours', t - interval '20 hours', t - interval '18 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '1 hour', 'l', 2)), 'transplant', t - interval '8 seconds')
  on conflict (room_id, plot_no) do nothing;
```

**tests/sql/v15-2-smoke.sql — edit 1 of 9.** Replace:

```sql
-- tests/sql/v15-2-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0016 (see the plan),
-- from the repo root: it re-runs 0016 with \i, reads tests/fixtures/upland-cases.json and crop-cases.json with \copy,
-- and ends with tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
```

with:

```sql
-- tests/sql/v15-2-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0018 (see the plan),
-- from the repo root: it re-runs 0016 and 0018 with \i, reads tests/fixtures/upland-cases.json and crop-cases.json with
-- \copy, and ends with tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql
-- (ON_ERROR_STOP).
-- It runs twice on one database: every account and room it makes has a random name.
```

**tests/sql/v15-2-smoke.sql — edit 2 of 9.** Replace:

```sql
-- The v15 smoke re-runs 0013 and the anti-cheat smoke re-runs 0015: both put back their own versions of functions 0016
-- re-creates, so 0016 runs again first.
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
reset client_min_messages;
```

with:

```sql
-- The v15 smoke re-runs 0013 and the anti-cheat smoke re-runs 0015: both put back their own versions of functions 0016
-- re-creates, so 0016 runs again first, then 0018 (v15.3), which re-creates some of them after it.
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
\i supabase/migrations/0018_v15_3_gather.sql
reset client_min_messages;
```

**tests/sql/v15-2-smoke.sql — edit 3 of 9.** Replace:

```sql
        from smoke s where s.k in ('g1', 'g2', 'g3', 'g4', 'g5', 'g6') $$;
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
reset client_min_messages;
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := public._auth_account((select v from smoke where k = 't2'));
```

with:

```sql
        from smoke s where s.k in ('g1', 'g2', 'g3', 'g4', 'g5', 'g6') $$;
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
\i supabase/migrations/0018_v15_3_gather.sql
reset client_min_messages;
do $$
declare a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := public._auth_account((select v from smoke where k = 't2'));
```

**tests/sql/v15-2-smoke.sql — edit 4 of 9.** Replace:

```sql
-- a second run gives none more
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
reset client_min_messages;
do $$
begin
```

with:

```sql
-- a second run gives none more
set client_min_messages = warning;
\i supabase/migrations/0016_v15_2_crops.sql
\i supabase/migrations/0018_v15_3_gather.sql
reset client_min_messages;
do $$
begin
```

**tests/sql/v15-2-smoke.sql — edit 5 of 9.** Replace:

```sql

-- Pickings (§8.9, R16, R26): no rounds and no harvester on beds; a picking or a transplant needs 5 s on the lease; a
-- lease that runs out takes the pickings left, and the stock keeps the ones taken.
do $$
```

with:

```sql

-- Pickings (§8.9, R16, R26): no rounds and no harvester on beds; a picking needs 5 s on the lease and a transplant 25 s
-- (0018, as a rice round); a lease that runs out takes the pickings left, and the stock keeps the ones taken.
do $$
```

**tests/sql/v15-2-smoke.sql — edit 6 of 9.** Replace:

```sql

  -- plot 10 (a3): an ớt nursery, ready since t6 − 1 h; its transplant needs 5 s on the lease
  perform pg_temp.set_coins(a3, 100000);
```

with:

```sql

  -- plot 10 (a3): an ớt nursery, ready since t6 − 1 h; its transplant needs 25 s on the lease
  perform pg_temp.set_coins(a3, 100000);
```

**tests/sql/v15-2-smoke.sql — edit 7 of 9.** Replace:

```sql
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 10, %L, %L)', room, a3, 'transplant',
                            t6 + interval '56 seconds')) = 'lease ending', 'a transplant with 4 s left';
  perform public._farm_do_begin_work(room, a3, 10, 'transplant', t6 + interval '55 seconds');
  perform public._field_open(room, t6 + interval '1 minute');
```

with:

```sql
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 10, %L, %L)', room, a3, 'transplant',
                            t6 + interval '36 seconds')) = 'lease ending', 'a transplant with 24 s left';
  perform public._farm_do_begin_work(room, a3, 10, 'transplant', t6 + interval '35 seconds');
  perform public._field_open(room, t6 + interval '1 minute');
```

**tests/sql/v15-2-smoke.sql — edit 8 of 9.** Replace:

```sql

-- An ớt season (§8.8): ươm, trồng cây con after the 2 s action, three pickings 12 h apart; the last ends the lease.
do $$
```

with:

```sql

-- An ớt season (§8.8): ươm, trồng cây con 8 s after begin_work, three pickings 12 h apart; the last ends the lease.
do $$
```

**tests/sql/v15-2-smoke.sql — edit 9 of 9.** Replace:

```sql
  -- sown at t + 1 min, ready 10 h later; the bed dried to Khô at t + 12 h, so it is watered back to Ẩm first
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a1, 'transplant', p - interval '2 seconds'))
         = 'need water', 'Khô';
  perform public._farm_do_water(room, a1, 7, 1, t + interval '12 hours');
  perform public._farm_do_begin_work(room, a1, 7, 'transplant', p - interval '2 seconds');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 7, 1, %L)', room, a1, p - interval '1 second')) = 'too fast',
    'the 2 s gate';
  s := public._farm_do_transplant(room, a1, 7, 5.0, p);
```

with:

```sql
  -- sown at t + 1 min, ready 10 h later; the bed dried to Khô at t + 12 h, so it is watered back to Ẩm first
  assert pg_temp.err(format('select public._farm_do_begin_work(%L, %L, 7, %L, %L)', room, a1, 'transplant', p - interval '8 seconds'))
         = 'need water', 'Khô';
  perform public._farm_do_water(room, a1, 7, 1, t + interval '12 hours');
  perform public._farm_do_begin_work(room, a1, 7, 'transplant', p - interval '8 seconds');
  assert pg_temp.err(format('select public._farm_do_transplant(%L, %L, 7, 1, %L)', room, a1, p - interval '1 second')) = 'too fast',
    'the 8 s gate';
  s := public._farm_do_transplant(room, a1, 7, 5.0, p);
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected: `FAILED: tests/sql/v15-smoke.sql` — a transplant claimed 7 s after its `begin_work` still passes `0013`'s 2 s gate (`ERROR:  the 8 s gate` in the log).

- [ ] **Step 3: Append section E**

**supabase/migrations/0018_v15_3_gather.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- E. Farm changes (§7.4, §8.3, §9, R10, R16, R19) ----------
-- The work gate (0013's body): a transplant is a TransplantGame round, taken 8–120 s after its begin_work (R19); any other
-- work — a hoa-màu picking — keeps the 2 s gate with no upper bound. harvest_part keeps its own 8–120 s check (0016).
create or replace function public._work_gate(c public.crops, p_work text, p_now timestamptz) returns void
language plpgsql stable set search_path = public, extensions
as $$
begin
  if c.work is distinct from p_work or c.work_started_at is null
     or p_now - c.work_started_at < (case when p_work = 'transplant' then interval '8 seconds' else interval '2 seconds' end) then
    raise exception 'too fast' using errcode = '22023';
  end if;
  if p_work = 'transplant' and p_now - c.work_started_at > interval '120 seconds' then
    raise exception 'work expired' using errcode = '22023';
  end if;
end; $$;

-- Cấy lúa, or trồng cây ớt con (0016's body): after a TransplantGame round (_work_gate); rice gets transplant_at, an ớt
-- nursery gets P. The reported quality is ignored for good (D1, R20).
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

-- Starts a round or a 3-second picking (0016's body, R19): it replaces any earlier record, and it needs 25 s left on a
-- lease for a round — a rice harvest round or any transplant: the play and its 9 s claim — and 5 s for a picking.
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
                and pl.until < p_now + case when p_work = 'transplant' or (c.kind = 'rice' and p_work = 'harvest')
                                            then interval '25 seconds' else interval '5 seconds' end) then
    raise exception 'lease ending' using errcode = '22023';
  end if;
  update public.crops set work = p_work, work_started_at = p_now where room_id = p_room and plot_no = p_plot;
  return public._field_view(p_room, p_account, p_now);
end; $$;

-- Bắt ốc (0016's body): anyone may pick the golden apple snails off a rice plot, but not while it is being harvested. The
-- picker also gets 1–3 ốc bươu vàng within free space; the rest go back into the canal (R10). It counts no visit.
create or replace function public._farm_do_pick_snails(p_room uuid, p_account uuid, p_plot integer, p_now timestamptz)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.crops; v_snails jsonb;
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
  v_snails := public._critter_add(p_account, p_room, array_fill('oc_buou_vang'::text, array[1 + floor(random() * 3)::int]), p_now);
  return public._field_view(p_room, p_account, p_now) || jsonb_build_object('snails', v_snails);
end; $$;

-- anh Hai's shop (0016's body, §9, R16): also the containers. A container, like a tool, is bought once and one at a time;
-- one no larger than the largest held is already owned (v14's bucket rule).
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
  if it.kind not in ('seed', 'fertilizer', 'pesticide', 'tool', 'critter_box') then
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

revoke all on function public._work_gate(public.crops, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_transplant(uuid, uuid, integer, double precision, timestamptz)
  from public, anon, authenticated;
revoke all on function public._farm_do_begin_work(uuid, uuid, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._farm_do_pick_snails(uuid, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.buy_farm_item(text, text, integer) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected:

```text
v14 smoke ok
0018 twice ok
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
anticheat guards ok
v15.3 model smoke ok
v15.3 gathering smoke ok
v15.3 farm smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.3): 0018 farm changes — the transplant round's gates, pest snails and containers

Section E of 0018_v15_3_gather.sql: _work_gate takes a transplant 8–120 s after its
begin_work (a hoa-màu picking keeps 2 s), begin_work needs 25 s on the lease for any
transplant, as for a rice round, pick_snails also gives the picker 1–3 ốc bươu vàng
within free space, and anh Hai sells the xô nhựa and the giỏ tre once each. The v15,
anti-cheat and v15.2 smokes claim transplants 8 s after begin_work, the v15.2 smoke
re-runs 0018 after each 0016 and its transplant lease case becomes 24 s → lease ending,
25 s → allowed; the gather smoke pins the gates.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0018_v15_3_gather.sql tests/sql/anticheat-smoke.sql tests/sql/v15-2-smoke.sql tests/sql/v15-gather-smoke.sql tests/sql/v15-smoke.sql
git commit -F <message file>
```

---

### Task 4: Database — the snapshot and the wipe take the critters (`0018` section F, shared with `0017`)

**Files:**
- Modify: `supabase/migrations/0018_v15_3_gather.sql` (append section F)
- Modify: `tests/sql/v15-gather-smoke.sql` (the wipe part)

**Interfaces:**
- Consumes: Task 1's `critters` and `gather_cooldowns`; `0017`'s bodies of `_ac_holdings(account)` (with its `"cards"`) and `_ac_wipe(account, by)` (its first step `_card_forfeit_all(p_account)`), and its `_card_sit(room, account, game, seat, stake, buyin, now)` for the smoke.
- Produces (Postgres): `_ac_holdings` gains `"critters": [{kind, n, xu}]` after `"tank"`; `_ac_wipe` also deletes the account's `critters` and `gather_cooldowns` after the tank's update (the farm profile, with the gift and the day's visits, stays). Every other line is `0017`'s, as the section's header comment says.
- Produces (smoke): the wipe part — an account holding critters, cooldowns and a poker seat with all its xu: the snapshot's `critters` beside `0017`'s `cards`; after the wipe the seat cashed out before the snapshot (its xu in the wiped balance), the critters, cooldowns, seat and wallet gone, the farm profile kept; it prints `v15.3 wipe smoke ok`.

- [ ] **Step 1: Write the smoke's wipe part**

**tests/sql/v15-gather-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- the wipe (§11.6): the snapshot lists the critters; the critters and the cooldowns go ----------
insert into smoke select 't6', token from public.register('gather_f_' || floor(random() * 1e9)::text, 'pw123456');
do $$
declare a6 uuid := public._auth_account((select v from smoke where k = 't6')); t timestamptz := (select v from smoke where k = 'now')::timestamptz;
        room uuid := (select v from smoke where k = 'room')::uuid; h jsonb;
begin
  perform pg_temp.set_coins(a6, 5000);
  insert into public.critters (account_id, kind, price, caught_at)
  values (a6, 'cua_dong', 26, t), (a6, 'oc_dong', 17, t), (a6, 'cua_dong', 12, t);
  insert into public.gather_cooldowns (account_id, spot, ready_at)
  values (a6, 'crab2', t + interval '5 minutes'), (a6, 'bed4', t + interval '9 minutes');
  insert into public.farm_profiles (account_id, gather_on, gather_count) values (a6, public._vn_today(), 12);
  -- 0017's parts stay (anti-cheat §11.3 rule 3): a6 also sits at the room's poker table with all its xu
  perform public._card_sit(room, a6, 'poker', 1, 100, 5000, now());
  h := public._ac_holdings(a6);
  assert h->'critters' = '[{"kind": "cua_dong", "n": 2, "xu": 38}, {"kind": "oc_dong", "n": 1, "xu": 17}]',
    format('holdings %s', h->'critters');
  assert h ? 'produce' and h ? 'tank' and h->'wallet'->'coins' = '0'
     and h->'cards' = jsonb_build_array(jsonb_build_object('room_id', room, 'game', 'poker', 'seat', 1, 'chips', 5000, 'escrow', 0)),
    format('the earlier parts stay: %s', h);
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a6, 2, 'pending_wipe', now());
  h := public._ac_wipe(a6, null);
  assert h->'critters'->0->'n' = '2'
     and (select snapshot->'critters' from public.anticheat_wipes where account_id = a6) = h->'critters', 'the snapshot keeps them';
  assert h->'cards' = '[]' and h->'wallet'->'coins' = '5000', format('the seat is cashed out before the snapshot: %s', h);
  assert not exists (select 1 from public.critters where account_id = a6)
     and not exists (select 1 from public.gather_cooldowns where account_id = a6)
     and not exists (select 1 from public.card_seats where account_id = a6)
     and not exists (select 1 from public.wallets where account_id = a6), 'the critters, the cooldowns, the seat and the wallet are gone';
  assert (select gather_count from public.farm_profiles where account_id = a6) = 12, 'the farm profile stays';
  assert public._farm_mine(a6)->'critters' = '{}' and public._farm_mine(a6)->'gather'->'ready_at' = '{}', 'mine is empty';
end $$;

select 'v15.3 wipe smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected: `FAILED: tests/sql/v15-gather-smoke.sql` — the snapshot has no `critters` yet (`ERROR:  holdings` in the log).

- [ ] **Step 3: Append section F**

**supabase/migrations/0018_v15_3_gather.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- F. Anti-cheat (§11.6): the holdings and the wipe take the critters ----------
-- SHARED WITH 0017 (v16 cards), which re-created both functions last. Each body below is 0017's with only the lines
-- marked "v15.3" added: _ac_holdings gains "critters" after "tank" and keeps 0017's "cards" after "drying", and _ac_wipe
-- keeps 0017's first step (the seats resolved, §6.3 of the v16 spec) and deletes the critters and the cooldowns after
-- the tank.

-- What a wipe removes: 0017's snapshot also lists the critters held, per kind (count and what cô Út pays).
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

-- 0017's wipe (the seats first, so the xu they give back are part of the wiped balance; then the snapshot): it also
-- deletes the critters and the cooldowns; the farm profile (the gift, the day's visits) stays.
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
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

revoke all on function public._ac_holdings(uuid) from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v153-sql.sh"`
Expected:

```text
v14 smoke ok
0018 twice ok
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
v15.3 model smoke ok
v15.3 gathering smoke ok
v15.3 farm smoke ok
v15.3 wipe smoke ok
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(v15.3): 0018 anti-cheat — the snapshot lists the critters; the wipe takes them and the cooldowns

Section F of 0018_v15_3_gather.sql, the two functions 0017 (v16) re-created last:
_ac_holdings gains "critters" per kind after "tank", and _ac_wipe deletes the critters
and the gather cooldowns after the tank. Both are 0017's bodies with the "v15.3" lines
added: the snapshot keeps the card seats, and the wipe still resolves them first. The
gather smoke wipes an account that holds critters, cooldowns and a poker seat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0018_v15_3_gather.sql tests/sql/v15-gather-smoke.sql
git commit -F <message file>
```

---

### Task 5: The client's gathering rules, catalog, state and RPCs

**Files:**
- Create: `lib/game/farm/gather.ts`
- Modify: `lib/game/farm/catalog.ts`, `lib/game/farm/state.ts`, `lib/game/farm/rpc.ts`
- Test: `tests/unit/farm-gather.test.ts` (create); `tests/unit/farm-catalog.test.ts`, `farm-state.test.ts`, `farm-rpc.test.ts` and the literals of `anticheat-pins.test.tsx`, `farm-actions.test.ts`, `farm-land.test.ts`, `farm-overlays.test.tsx`, `farm-panels.test.tsx`, `farm-plot-panel.test.tsx`, `fishing-panels.test.tsx`, `use-farm-controller.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 1's fixture `tests/fixtures/gather-cases.json` and the `field_state` / answer shapes of §11.7 (Tasks 1–3); from v15.2: `FarmCatalog`, `FarmItem` (`capacity`), `describeFarmItem`, `parseFieldState`, `parseFarmMine`, `withMine`, `MineAnswer`, `fetchFarmCatalog`, `isMissingTable`.
- Produces:
  - `gather.ts` (pure; it imports only types): `GATHER` (hand 3, cooldown 20 min, 200 visits, gates and windows, odds, bed snails 1–3 — pinned by the fixture), `HOLE_COUNT` 6, `BED_COUNT` 4, `CRAB_FINISH_WAIT_MS` 4 000, `TRANSPLANT_WAIT_MS` 9 000, `BED_BAR_MS` 3 000, `critterPrice(base, mult)` (in whole hundredths of M: 45 × 1.40 is 63), `spotKey(id)` / `spotId(key)` (`crab_3` ↔ `crab3`), `heldBox(items, all)`, `critterCap(items, all)`, `critterCount(critters)`;
  - `catalog.ts`: `CritterKind { id, name, group, basePrice, sortOrder }`, `CritterKindRow`, `critterFromRow`, `FarmCatalog.critters`, the containers' `describeFarmItem` line ("Đựng thêm 15 con cua, ốc (tay cầm được 3 con)"), `BoxRow` and `boxRow(it, items, all)` (buy / owned / bigger, R16);
  - `state.ts`: `CritterStock`, `GatherMine`, `CritterPrices`; `FarmMine.critters`, `critterCap`, `gather` (before `0018`: none, 3, every spot ready, 200 left); `FieldState.critterPrices` (null before `0018`);
  - `rpc.ts`: `fetchFarmCatalog` also reads `critter_kinds` (a missing table is an empty list); `RPCS_153`; `CatchAnswer`, `CrabVisit`; `crabStart(room, token, hole)`, `crabFinish(room, token, visitId, hits)`, `pickSnailBed(room, token, bed)`, `sellCritters(token, kind)`; `FieldAnswer.snails` (`pick_snails`' catch, null before `0018`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-gather.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { farmItemFromRow } from "@/lib/game/farm/catalog";
import {
  BED_BAR_MS, BED_COUNT, CRAB_FINISH_WAIT_MS, critterCap, critterCount, critterPrice, GATHER, heldBox, HOLE_COUNT, spotId, spotKey,
  TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
import fixture from "@/tests/fixtures/gather-cases.json";

const F = fixture as unknown as {
  rules: {
    hand: number; boxes: number[]; cooldown_s: number; daily_visits: number; crab_gate_s: number; visit_window_s: number;
    transplant_gate_s: number; work_window_s: number; cua_gach_odds: number; oc_dong_odds: number; bed_snails: number[];
  };
  prices: [number, number, number][];
  spots: [string, string][];
};
const box = (id: string, capacity: number) => farmItemFromRow({
  id, kind: "critter_box", name: id, price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity,
});
const BOXES = [box("box_bucket", 15), box("box_basket", 30)];

describe("the gathering rules (0018; tests/fixtures/gather-cases.json)", () => {
  it("are the server's", () => {
    const r = F.rules;
    expect(GATHER).toEqual({
      hand: r.hand, cooldownMs: r.cooldown_s * 1000, dailyVisits: r.daily_visits, crabGateMs: r.crab_gate_s * 1000,
      visitWindowMs: r.visit_window_s * 1000, transplantGateMs: r.transplant_gate_s * 1000, workWindowMs: r.work_window_s * 1000,
      cuaGachOdds: r.cua_gach_odds, ocDongOdds: r.oc_dong_odds, bedSnails: r.bed_snails,
    });
    expect(BOXES.map((b) => b.capacity)).toEqual(r.boxes);
    expect([HOLE_COUNT, BED_COUNT]).toEqual([6, 4]);
  });
  it("waits past the server's gates (R7, §8.1)", () => {
    expect(CRAB_FINISH_WAIT_MS).toBe(4000);
    expect(CRAB_FINISH_WAIT_MS).toBeGreaterThan(GATHER.crabGateMs);
    expect(TRANSPLANT_WAIT_MS).toBe(9000);
    expect(TRANSPLANT_WAIT_MS).toBeGreaterThan(GATHER.transplantGateMs);
    expect(BED_BAR_MS).toBe(3000);
  });
});

describe("critterPrice (R4)", () => {
  it("floors base × M in whole hundredths, as the server does", () => {
    for (const [base, mult, price] of F.prices) expect(critterPrice(base, mult), `${base} × ${mult}`).toBe(price);
    // the float product falls just short: floor(45 × 1.4) would pay 62
    expect(Math.floor(45 * 1.4)).toBe(62);
    expect(critterPrice(45, 1.4)).toBe(63);
  });
  it("pays at least 1 xu", () => {
    expect(critterPrice(2, 0.3)).toBe(1);
  });
});

describe("the spot keys (§6)", () => {
  it("map each interactable to the server's key and back", () => {
    for (const [id, key] of F.spots) {
      expect(spotKey(id)).toBe(key);
      expect(spotId(key)).toBe(id);
    }
  });
  it("know only holes 1–6 and beds 1–4", () => {
    expect(["crab_0", "crab_7", "bed_5", "plot_1", "crab1", "crab_10"].map(spotKey)).toEqual([null, null, null, null, null, null]);
    expect(["crab7", "bed0", "crab_1", "bed"].map(spotId)).toEqual([null, null, null, null]);
  });
});

describe("the capacity (R5)", () => {
  it("is 3 by hand plus the largest container", () => {
    expect(critterCap({}, BOXES)).toBe(3);
    expect(critterCap({ box_bucket: 1 }, BOXES)).toBe(18);
    expect(critterCap({ box_basket: 1 }, BOXES)).toBe(33);
    expect(critterCap({ box_bucket: 1, box_basket: 1 }, BOXES)).toBe(33);
    expect(critterCap({ box_basket: 0 }, BOXES)).toBe(3);
  });
  it("names the container held, and counts the critters", () => {
    expect(heldBox({}, BOXES)).toBeNull();
    expect(heldBox({ box_bucket: 1 }, BOXES)?.id).toBe("box_bucket");
    expect(heldBox({ box_bucket: 1, box_basket: 1 }, BOXES)?.id).toBe("box_basket");
    expect(critterCount({})).toBe(0);
    expect(critterCount({ cua_dong: { n: 5 }, oc_dong: { n: 2 } })).toBe(7);
  });
});
```

**tests/unit/farm-catalog.test.ts — edit 1 of 3.** Replace:

```ts
import {
  describeFarmItem, farmItemFromRow, harvesterPrice, producePrice, ricePrice, ripeAfterHours, uplandFromRow, uplandHours, varietyFromRow,
  type FarmItemRow, type UplandCropRow, type VarietyRow,
} from "@/lib/game/farm/catalog";
```

with:

```ts
import {
  boxRow, critterFromRow, describeFarmItem, farmItemFromRow, harvesterPrice, producePrice, ricePrice, ripeAfterHours, uplandFromRow,
  uplandHours, varietyFromRow, type FarmItemRow, type UplandCropRow, type VarietyRow,
} from "@/lib/game/farm/catalog";
```

**tests/unit/farm-catalog.test.ts — edit 2 of 3.** Replace:

```ts
    expect(d({ kind: "pesticide", pest_target: "fungus" })).toBe("Trị đạo ôn lá, đạo ôn cổ bông, thán thư");
    expect(d({ kind: "critter_box", capacity: 15 })).toBe("Đựng 15 con cua, ốc");
  });
```

with:

```ts
    expect(d({ kind: "pesticide", pest_target: "fungus" })).toBe("Trị đạo ôn lá, đạo ôn cổ bông, thán thư");
    expect(d({ kind: "critter_box", capacity: 15 })).toBe("Đựng thêm 15 con cua, ốc (tay cầm được 3 con)");
  });
```

**tests/unit/farm-catalog.test.ts — edit 3 of 3.** Append at the end of the file, after a blank line:

```ts
describe("critters and containers (v15.3 §7.1, §9)", () => {
  it("reads the critter_kinds rows", () => {
    expect(critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }))
      .toEqual({ id: "cua_gach", name: "Cua gạch", group: "crab", basePrice: 45, sortOrder: 20 });
    expect(critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }).group).toBe("snail");
  });
  it("describes the two containers", () => {
    const d = (capacity: number) => describeFarmItem(farmItemFromRow(item({ kind: "critter_box", capacity })), VARIETIES);
    expect(d(15)).toBe("Đựng thêm 15 con cua, ốc (tay cầm được 3 con)");
    expect(d(30)).toBe("Đựng thêm 30 con cua, ốc (tay cầm được 3 con)");
  });
  it("sells a container once, and not one no larger than the one held (R16)", () => {
    const bucket = farmItemFromRow(item({ id: "box_bucket", kind: "critter_box", name: "Xô nhựa", capacity: 15 }));
    const basket = farmItemFromRow(item({ id: "box_basket", kind: "critter_box", name: "Giỏ tre", capacity: 30 }));
    const all = [bucket, basket];
    expect([boxRow(bucket, {}, all), boxRow(basket, {}, all)]).toEqual([{ state: "buy" }, { state: "buy" }]);
    expect([boxRow(bucket, { box_bucket: 1 }, all), boxRow(basket, { box_bucket: 1 }, all)]).toEqual([{ state: "owned" }, { state: "buy" }]);
    expect([boxRow(bucket, { box_basket: 1 }, all), boxRow(basket, { box_basket: 1 }, all)])
      .toEqual([{ state: "bigger", name: "Giỏ tre" }, { state: "owned" }]);
    expect(boxRow(bucket, { box_bucket: 1, box_basket: 1 }, all)).toEqual({ state: "owned" });
  });
});
```

**tests/unit/farm-state.test.ts — edit 1 of 2.** Replace:

```ts
      items: { seed_nep: 2 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, giftClaimed: true, produce: {}, tank: null,
      ownedPlot: 3, farming: [7],
```

with:

```ts
      items: { seed_nep: 2 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, giftClaimed: true, produce: {}, tank: null,
      critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
      ownedPlot: 3, farming: [7],
```

**tests/unit/farm-state.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("v15.3 (§11.7)", () => {
  const MINE = {
    ...ANSWER.mine,
    critters: { cua_dong: { n: 5, xu: 130 }, cua_gach: { n: 1, xu: 100 }, oc_dong: { n: 0, xu: 0 } },
    critter_cap: 33,
    gather: { ready_at: { crab3: "2026-09-25T10:12:00+00:00", bed1: "2026-09-25T10:07:00+00:00", bed2: "soon" }, left_today: 187,
              day_resets_at: null },
  };
  it("reads the critters held, the capacity and the gathering", () => {
    const m = parseFieldState({ ...ANSWER, mine: MINE })!.mine;
    expect(m.critters).toEqual({ cua_dong: { n: 5, xu: 130 }, cua_gach: { n: 1, xu: 100 } });
    expect(m.critterCap).toBe(33);
    expect(m.gather).toEqual({
      readyAt: { crab3: ms("2026-09-25T10:12:00Z"), bed1: ms("2026-09-25T10:07:00Z") }, leftToday: 187, dayResetsAt: null,
    });
    const done = parseFarmMine({ ...MINE, gather: { ready_at: {}, left_today: 0, day_resets_at: "2026-09-25T17:00:00+00:00" } })!;
    expect(done.gather).toEqual({ readyAt: {}, leftToday: 0, dayResetsAt: ms("2026-09-25T17:00:00Z") });
  });
  it("reads the prices the field shows", () => {
    const s = parseFieldState({ ...ANSWER, critter_prices: { mult: 2.24, ends_at: "2026-09-25T11:00:00+00:00" } })!;
    expect(s.critterPrices).toEqual({ mult: 2.24, endsAt: ms("2026-09-25T11:00:00Z") });
  });
  it("reads a database before 0018 as: no prices, no critters, cap 3, every spot ready, 200 left", () => {
    const s = parseFieldState(ANSWER)!;
    expect(s.critterPrices).toBeNull();
    expect(s.mine).toMatchObject({ critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null } });
    expect(parseFarmMine({ items: {}, rice: {}, coins: 0, gift_claimed: true })).toMatchObject({ critters: {}, critterCap: 3 });
  });
  it("keeps the newer account part's critters when it merges", () => {
    const next = withMine(parseFieldState(ANSWER)!, parseFarmMine(MINE)!);
    expect(next.mine).toMatchObject({ critterCap: 33, gather: { leftToday: 187 }, ownedPlot: 3 });
  });
});
```

**tests/unit/farm-rpc.test.ts — edit 1 of 7.** Replace:

```ts
import {
  actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, RPCS_152, sellProduce, sellRice,
} from "@/lib/game/farm/rpc";
```

with:

```ts
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, pickSnailBed,
  RPCS_152, RPCS_153, sellCritters, sellProduce, sellRice,
} from "@/lib/game/farm/rpc";
```

**tests/unit/farm-rpc.test.ts — edit 2 of 7.** Replace:

```ts
  pest_target: null, capacity: null, upland: "ot" };

describe("fetchFarmCatalog", () => {
  it("loads the varieties, the hoa-màu crops and the farm items once per page", async () => {
    const crops = (fixtures as unknown as { crops: unknown[] }).crops;
    h.from.mockImplementation((table: string) => chain(table === "rice_varieties" ? [VARIETY_ROW] : table === "upland_crops" ? crops : [ITEM_ROW]));
    const a = await fetchFarmCatalog();
    expect(await fetchFarmCatalog()).toBe(a);
    expect(h.from.mock.calls.map(([t]) => t)).toEqual(["rice_varieties", "upland_crops", "shop_items"]);
    expect(a.varieties[0]).toMatchObject({ id: "nep", baseKg: 75 });
```

with:

```ts
  pest_target: null, capacity: null, upland: "ot" };
const CRITTER_ROW = { id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 };
const rowsOf = (table: string, crops: unknown[] = []) =>
  table === "rice_varieties" ? [VARIETY_ROW] : table === "upland_crops" ? crops : table === "critter_kinds" ? [CRITTER_ROW] : [ITEM_ROW];

describe("fetchFarmCatalog", () => {
  it("loads the varieties, the hoa-màu crops, the farm items and the critters once per page", async () => {
    const crops = (fixtures as unknown as { crops: unknown[] }).crops;
    h.from.mockImplementation((table: string) => chain(rowsOf(table, crops)));
    const a = await fetchFarmCatalog();
    expect(await fetchFarmCatalog()).toBe(a);
    expect(h.from.mock.calls.map(([t]) => t)).toEqual(["rice_varieties", "upland_crops", "shop_items", "critter_kinds"]);
    expect(a.varieties[0]).toMatchObject({ id: "nep", baseKg: 75 });
```

**tests/unit/farm-rpc.test.ts — edit 3 of 7.** Replace:

```ts
    expect(a.items[0]).toMatchObject({ id: "seed_ot", kind: "seed", upland: "ot" });
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box", "tool"]]]);
```

with:

```ts
    expect(a.items[0]).toMatchObject({ id: "seed_ot", kind: "seed", upland: "ot" });
    expect(a.critters).toEqual([{ id: "cua_dong", name: "Cua đồng", group: "crab", basePrice: 12, sortOrder: 10 }]);
    expect(filters).toEqual([["kind", ["seed", "fertilizer", "pesticide", "critter_box", "tool"]]]);
```

**tests/unit/farm-rpc.test.ts — edit 4 of 7.** Replace:

```ts
      ? chain(null, { code: "PGRST205", message: "Could not find the table 'public.upland_crops' in the schema cache" })
      : chain(table === "rice_varieties" ? [VARIETY_ROW] : [ITEM_ROW]));
    expect((await fresh()).uplands).toEqual([]);
```

with:

```ts
      ? chain(null, { code: "PGRST205", message: "Could not find the table 'public.upland_crops' in the schema cache" })
      : chain(rowsOf(table)));
    expect((await fresh()).uplands).toEqual([]);
```

**tests/unit/farm-rpc.test.ts — edit 5 of 7.** Replace:

```ts
    await expect(again()).rejects.toMatchObject({ code: "42501" });
  });
```

with:

```ts
    await expect(again()).rejects.toMatchObject({ code: "42501" });
  });
  it("has no critters before 0018 (v15.3 §4), and fails on their other errors", async () => {
    vi.resetModules();
    const fresh = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "critter_kinds"
      ? chain(null, { code: "42P01", message: "relation \"public.critter_kinds\" does not exist" })
      : chain(rowsOf(table)));
    expect((await fresh()).critters).toEqual([]);
    vi.resetModules();
    const again = (await import("@/lib/game/farm/rpc")).fetchFarmCatalog;
    h.from.mockImplementation((table: string) => table === "critter_kinds" ? chain(null, { code: "57014", message: "timeout" }) : chain(rowsOf(table)));
    await expect(again()).rejects.toMatchObject({ code: "57014" });
  });
```

**tests/unit/farm-rpc.test.ts — edit 6 of 7.** Replace:

```ts
      serverNow: "2026-09-25T10:00:00+00:00",
      mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true, produce: {}, tank: null },
    });
```

with:

```ts
      serverNow: "2026-09-25T10:00:00+00:00",
      mine: { items: { seed_nep: 2 }, rice: {}, coins: 10, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null } },
    });
```

**tests/unit/farm-rpc.test.ts — edit 7 of 7.** Replace:

```ts
    expect(h.rpc).toHaveBeenLastCalledWith("sell_produce", { p_session_token: "tok", p_upland: "khoai", p_kg: 160 });
  });
```

with:

```ts
    expect(h.rpc).toHaveBeenLastCalledWith("sell_produce", { p_session_token: "tok", p_upland: "khoai", p_kg: 160 });
  });
});

describe("v15.3 (§11.4)", () => {
  const NOW = "2026-09-25T10:00:00+00:00";
  const mine = { ...MINE, critters: { cua_dong: { n: 2, xu: 52 } }, critter_cap: 18, gather: { ready_at: {}, left_today: 199 } };
  it("names the RPCs 0018 adds", () => {
    expect([...RPCS_153].sort()).toEqual(["crab_finish", "crab_start", "pick_snail_bed", "sell_critters"]);
  });
  it("starts and finishes a crab visit", async () => {
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, visit: { id: "v1", hole: 3, started_at: NOW } }, error: null });
    const s = await crabStart("r", "tok", 3);
    expect(h.rpc).toHaveBeenLastCalledWith("crab_start", { p_room_id: "r", p_session_token: "tok", p_hole: 3 });
    expect(s.visit).toEqual({ id: "v1", hole: 3, startedAt: Date.parse(NOW) });
    expect(s.mine).toMatchObject({ critterCap: 18, gather: { leftToday: 199 } });
    const crab = { hits: 3, caught: [{ kind: "cua_gach", price: 100 }, { kind: "cua_dong", price: 26 }], escaped: 1 };
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, crab }, error: null });
    expect((await crabFinish("r", "tok", "v1", 3)).crab).toEqual(crab);
    expect(h.rpc).toHaveBeenLastCalledWith("crab_finish", { p_room_id: "r", p_session_token: "tok", p_visit_id: "v1", p_hits: 3 });
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine }, error: null });
    await expect(crabStart("r", "tok", 3)).rejects.toThrow("bad crab visit");
  });
  it("picks a snail bed and sells critters", async () => {
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, snails: { caught: [{ kind: "oc_dong", price: 17 }], escaped: 0 } }, error: null });
    expect((await pickSnailBed("r", "tok", 2)).snails).toEqual({ caught: [{ kind: "oc_dong", price: 17 }], escaped: 0 });
    expect(h.rpc).toHaveBeenLastCalledWith("pick_snail_bed", { p_room_id: "r", p_session_token: "tok", p_bed: 2 });
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine: { ...mine, critters: {} }, sold: { n: 2, xu: 52 } }, error: null });
    const sold = await sellCritters("tok", null);
    expect(h.rpc).toHaveBeenLastCalledWith("sell_critters", { p_session_token: "tok", p_kind: null });
    expect(sold).toMatchObject({ sold: { n: 2, xu: 52 }, mine: { critters: {} } });
    h.rpc.mockResolvedValueOnce({ data: { server_now: NOW, mine, sold: { n: 1, xu: 26 } }, error: null });
    await sellCritters("tok", "cua_dong");
    expect(h.rpc).toHaveBeenLastCalledWith("sell_critters", { p_session_token: "tok", p_kind: "cua_dong" });
  });
  it("reads the picker's snails from pick_snails, none before 0018", async () => {
    h.rpc.mockResolvedValueOnce({ data: { ...FIELD, snails: { caught: [{ kind: "oc_buou_vang", price: 4 }], escaped: 2 } }, error: null });
    expect((await fieldAction("r", "tok", { kind: "pick_snails", plot: 5 })).snails)
      .toEqual({ caught: [{ kind: "oc_buou_vang", price: 4 }], escaped: 2 });
    h.rpc.mockResolvedValueOnce({ data: FIELD, error: null });
    expect((await fieldAction("r", "tok", { kind: "pick_snails", plot: 5 })).snails).toBeNull();
  });
```

**tests/unit/anticheat-pins.test.tsx — edit 1 of 3.** Replace:

```tsx
  uplands: [],
  items: [
```

with:

```tsx
  uplands: [],
  critters: [],
  items: [
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 3.** Replace:

```tsx
      items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1, tool_sickle: 1, seed_khoai: 1, seed_bap: 1, seed_ot: 1 },
      rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null,
    };
```

with:

```tsx
      items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1, tool_sickle: 1, seed_khoai: 1, seed_bap: 1, seed_ot: 1 },
      rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
    };
```

**tests/unit/anticheat-pins.test.tsx — edit 3 of 3.** Replace:

```tsx
    const beds: FarmCatalog = { ...FARM, uplands: [uplandFromRow({ ...khoai, cares: [...(khoai.cares as object[]), tia] })] };
    const mine: FarmMine = { items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null };
    const p = plot(3, crop({ kind: "upland", variety: null, upland: "khoai", soakAt: null, plantAt: at(0) }, [[0, 1]]));
```

with:

```tsx
    const beds: FarmCatalog = { ...FARM, uplands: [uplandFromRow({ ...khoai, cares: [...(khoai.cares as object[]), tia] })] };
    const mine: FarmMine = {
      items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3,
      gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
    };
    const p = plot(3, crop({ kind: "upland", variety: null, upland: "khoai", soakAt: null, plantAt: at(0) }, [[0, 1]]));
```

**tests/unit/farm-actions.test.ts — edit 1 of 3.** Replace:

```ts
  uplands: [],
  items: [
```

with:

```ts
  uplands: [],
  critters: [],
  items: [
```

**tests/unit/farm-actions.test.ts — edit 2 of 3.** Replace:

```ts
const ME = { id: "me", name: "Me" };
const mine = (items: Record<string, number>): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null });
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });
```

with:

```ts
const ME = { id: "me", name: "Me" };
const mine = (items: Record<string, number>): FarmMine => ({
  items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
});
const ALL = mine({ seed_nep: 1, fert_manure: 1, fert_urea: 2, spray_hopper: 1 });
```

**tests/unit/farm-actions.test.ts — edit 3 of 3.** Replace:

```ts
  uplands: ROWS.map(uplandFromRow),
  items: [
```

with:

```ts
  uplands: ROWS.map(uplandFromRow),
  critters: [],
  items: [
```

**tests/unit/farm-land.test.ts.** Replace:

```ts
const mine = (coins: number): FieldMine => ({
  items: {}, rice: {}, coins, giftClaimed: true, produce: {}, tank: null, ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
});
```

with:

```ts
const mine = (coins: number): FieldMine => ({
  items: {}, rice: {}, coins, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
  ownedPlot: null, farming: [], myOffers: [], incomingOffers: [],
});
```

**tests/unit/farm-overlays.test.tsx.** Replace:

```tsx
  uplands: [],
  items: [farmItemFromRow({ id: "fert_urea", kind: "fertilizer", name: "Phân urê", price: 60, sort_order: 30, variety: null, fert: "urea", pest_target: null, capacity: null })],
```

with:

```tsx
  uplands: [],
  critters: [],
  items: [farmItemFromRow({ id: "fert_urea", kind: "fertilizer", name: "Phân urê", price: 60, sort_order: 30, variety: null, fert: "urea", pest_target: null, capacity: null })],
```

**tests/unit/farm-panels.test.tsx.** Replace:

```tsx
  uplands: [],
  varieties: [
```

with:

```tsx
  uplands: [],
  critters: [],
  varieties: [
```

**tests/unit/farm-plot-panel.test.tsx.** Replace:

```tsx
  uplands: [],
  varieties: [nep],
```

with:

```tsx
  uplands: [],
  critters: [],
  varieties: [nep],
```

**tests/unit/fishing-panels.test.tsx.** Replace:

```tsx
  ];
  const mine = (items: Record<string, number>, tank: Tank | null): FarmMine => ({ items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank });
  const bag = (m: FarmMine) => {
```

with:

```tsx
  ];
  const mine = (items: Record<string, number>, tank: Tank | null): FarmMine => ({
    items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank, critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
  });
  const bag = (m: FarmMine) => {
```

**tests/unit/use-farm-controller.test.tsx.** Replace:

```tsx
  uplands: [],
  items: [
```

with:

```tsx
  uplands: [],
  critters: [],
  items: [
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-gather.test.ts tests/unit/farm-land.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-rpc.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-panels.test.tsx tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — `farm-gather.test.ts` cannot load `@/lib/game/farm/gather`, and 16 tests fail in `farm-catalog`, `farm-rpc` and `farm-state` (`critterFromRow is not a function`, `boxRow is not a function`, the old container line "Đựng 15 con cua, ốc", no `critter_kinds` fetch, no new calls, no critters or prices in the state); 4 files fail, 8 pass (the other files only gain the new fields in their literals).

- [ ] **Step 3: Implement**

Create `lib/game/farm/gather.ts` with exactly:

```ts
// v15.3 gathering (spec §7, §13.1): 0018's rules (tests/fixtures/gather-cases.json pins them against the SQL), the
// critter prices, the spot keys and the capacity. Pure.
import type { FarmItem } from "./catalog";

/** 0018's rules (R1–R5, R7, R19): the hands, a spot's cooldown, the visits a Vietnam day, the gates and windows, the
 *  odds, and the snails a bed gives. */
export const GATHER = {
  hand: 3,
  cooldownMs: 20 * 60_000,
  dailyVisits: 200,
  crabGateMs: 3_000,
  visitWindowMs: 120_000,
  transplantGateMs: 8_000,
  workWindowMs: 120_000,
  cuaGachOdds: 0.1,
  ocDongOdds: 0.7,
  bedSnails: [1, 3],
} as const;

/** The crab holes and the snail beds on the field (§6). */
export const HOLE_COUNT = 6;
export const BED_COUNT = 4;
/** The client's waits (R7, §8.1): a catch goes 4 s after crab_start's answer, a transplant 9 s after begin_work's. */
export const CRAB_FINISH_WAIT_MS = 4_000;
export const TRANSPLANT_WAIT_MS = 9_000;
/** A snail bed's progress bar (R9). */
export const BED_BAR_MS = 3_000;

/** max(1, floor(base × M)) in whole hundredths of M (R4), as 0018's _critter_price: 45 × 1.40 is 63, where the float
 *  product is 62.99…. */
export function critterPrice(base: number, mult: number): number {
  return Math.max(1, Math.floor((base * Math.round(mult * 100)) / 100));
}

const SPOT_ID = /^(crab|bed)_(\d)$/;
const SPOT_KEY = /^(crab|bed)(\d)$/;
const inRange = (grp: string, n: number): boolean => n >= 1 && n <= (grp === "crab" ? HOLE_COUNT : BED_COUNT);

/** The server's key of a hole's or a bed's interactable (§6): crab_1 → crab1, bed_4 → bed4; null for any other id. */
export function spotKey(id: string): string | null {
  const m = SPOT_ID.exec(id);
  return m && inRange(m[1], Number(m[2])) ? `${m[1]}${m[2]}` : null;
}

/** The interactable of a server key: crab1 → crab_1; null for any other key. */
export function spotId(key: string): string | null {
  const m = SPOT_KEY.exec(key);
  return m && inRange(m[1], Number(m[2])) ? `${m[1]}_${m[2]}` : null;
}

/** The largest container among the items held (R5), or null: bare hands. */
export function heldBox(items: Readonly<Record<string, number>>, all: readonly FarmItem[]): FarmItem | null {
  let best: FarmItem | null = null;
  for (const it of all) {
    if (it.kind === "critter_box" && (items[it.id] ?? 0) > 0 && (it.capacity ?? 0) > (best?.capacity ?? 0)) best = it;
  }
  return best;
}

/** 3 by hand plus the largest container: the server's critter_cap. */
export function critterCap(items: Readonly<Record<string, number>>, all: readonly FarmItem[]): number {
  return GATHER.hand + (heldBox(items, all)?.capacity ?? 0);
}

/** How many critters are held, every kind together. */
export function critterCount(critters: Readonly<Record<string, { n: number }>>): number {
  return Object.values(critters).reduce((s, c) => s + c.n, 0);
}
```

**lib/game/farm/catalog.ts — edit 1 of 7.** Replace:

```ts
// Client side of the farm config (spec §7, §8.1, §9; v15.2 §8.2, §9): varieties, hoa-màu crops, farm items, the land
// prices and number formats. Pure.
```

with:

```ts
// Client side of the farm config (spec §7, §8.1, §9; v15.2 §8.2, §9; v15.3 §7.1, §9): varieties, hoa-màu crops, farm
// items, critters, the land prices and number formats. Pure.
import { GATHER, heldBox } from "./gather";
```

**lib/game/farm/catalog.ts — edit 2 of 7.** Replace:

```ts
  pestTarget: PestTarget | null;
  /** critter_box (v15.2). */
  capacity: number | null;
}
```

with:

```ts
  pestTarget: PestTarget | null;
  /** critter_box: the critters it holds on top of the 3 in hand (v15.3 §9). */
  capacity: number | null;
}

/** A crab or a snail (v15.3 §7.1), one critter_kinds row: its price at M = 1. */
export interface CritterKind { id: string; name: string; group: "crab" | "snail"; basePrice: number; sortOrder: number }
```

**lib/game/farm/catalog.ts — edit 3 of 7.** Replace:

```ts

export interface FarmCatalog { varieties: Variety[]; uplands: UplandCrop[]; items: FarmItem[] }
```

with:

```ts

export interface FarmCatalog {
  varieties: Variety[];
  uplands: UplandCrop[];
  items: FarmItem[];
  /** None before 0018: the gathering is not open yet. */
  critters: CritterKind[];
}
```

**lib/game/farm/catalog.ts — edit 4 of 7.** Replace:

```ts
}
export interface UplandCropRow {
```

with:

```ts
}
export interface CritterKindRow { id: string; name: string; grp: string; base_price: number; sort_order: number }
export interface UplandCropRow {
```

**lib/game/farm/catalog.ts — edit 5 of 7.** Replace:

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

export function critterFromRow(r: CritterKindRow): CritterKind {
  return { id: r.id, name: r.name, group: r.grp === "snail" ? "snail" : "crab", basePrice: r.base_price, sortOrder: r.sort_order };
}
```

**lib/game/farm/catalog.ts — edit 6 of 7.** Replace:

```ts
    case "critter_box":
      return `Đựng ${it.capacity ?? 0} con cua, ốc`;
    case "tool":
```

with:

```ts
    case "critter_box":
      return `Đựng thêm ${it.capacity ?? 0} con cua, ốc (tay cầm được ${GATHER.hand} con)`;
    case "tool":
```

**lib/game/farm/catalog.ts — edit 7 of 7.** Append at the end of the file, after a blank line:

```ts
/** anh Hai's row for a container (R16): buy it, "✓ Đã có" when held, or "Đã có {giỏ tre} lớn hơn" when a larger one is. */
export type BoxRow = { state: "buy" } | { state: "owned" } | { state: "bigger"; name: string };

export function boxRow(it: FarmItem, items: Readonly<Record<string, number>>, all: readonly FarmItem[]): BoxRow {
  if ((items[it.id] ?? 0) > 0) return { state: "owned" };
  const held = heldBox(items, all);
  return held && (held.capacity ?? 0) >= (it.capacity ?? 0) ? { state: "bigger", name: held.name } : { state: "buy" };
}
```

**lib/game/farm/state.ts — edit 1 of 8.** Replace:

```ts
// The field_state JSON (spec §11.5; v15.2 §11.6), camelCased, with times as ms since the epoch. Pure.
```

with:

```ts
// The field_state JSON (spec §11.5; v15.2 §11.6; v15.3 §11.7), camelCased, with times as ms since the epoch. Pure.
import { GATHER } from "./gather";
```

**lib/game/farm/state.ts — edit 2 of 8.** Replace:

```ts

/** The account part of the answer — sell_rice, buy_farm_item, claim_farm_gift, load_sprayer and sell_produce return
 *  only this. */
export interface FarmMine {
```

with:

```ts

/** Critters of one kind held (v15.3 §11.7): how many, and what cô Út pays for them together. */
export interface CritterStock { n: number; xu: number }

/** The gathering (v15.3 §11.7): the spots still cooling for me in any room (server key → ms), the visits left today,
 *  and, at 0 left, when the Vietnam day resets. */
export interface GatherMine { readyAt: Record<string, number>; leftToday: number; dayResetsAt: number | null }

/** The multiplier the field prices critters at (R12): the room's fish price index, or a preview of the next one. */
export interface CritterPrices { mult: number; endsAt: number | null }

/** The account part of the answer — sell_rice, buy_farm_item, claim_farm_gift, load_sprayer, sell_produce and the
 *  gathering RPCs return only this. */
export interface FarmMine {
```

**lib/game/farm/state.ts — edit 3 of 8.** Replace:

```ts
  tank: Tank | null;
}
```

with:

```ts
  tank: Tank | null;
  /** v15.3: the critters held, per kind. */
  critters: Record<string, CritterStock>;
  /** 3 by hand plus the largest container. */
  critterCap: number;
  gather: GatherMine;
}
```

**lib/game/farm/state.ts — edit 4 of 8.** Replace:

```ts

export interface FieldState { serverNow: number; plots: PlotView[]; drying: DryingView[]; mine: FieldMine }
```

with:

```ts

export interface FieldState {
  serverNow: number;
  plots: PlotView[];
  drying: DryingView[];
  mine: FieldMine;
  /** null before 0018. */
  critterPrices: CritterPrices | null;
}
```

**lib/game/farm/state.ts — edit 5 of 8.** Replace:

```ts

/** The account part of any farm answer; null when it is not an object. */
```

with:

```ts

/** The gathering part of the account; before 0018: no critters, hands only, every spot ready, 200 visits left. */
function parseGather(m: Record<string, unknown>): Pick<FarmMine, "critters" | "critterCap" | "gather"> {
  const critters: Record<string, CritterStock> = {};
  for (const [k, v] of Object.entries(obj(m.critters))) if (num(obj(v).n) > 0) critters[k] = { n: num(obj(v).n), xu: num(obj(v).xu) };
  const g = obj(m.gather);
  const readyAt: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(g.ready_at))) {
    const t = time(v);
    if (t !== null) readyAt[k] = t;
  }
  return {
    critters,
    critterCap: num(m.critter_cap, GATHER.hand),
    gather: { readyAt, leftToday: num(g.left_today, GATHER.dailyVisits), dayResetsAt: time(g.day_resets_at) },
  };
}

/** The account part of any farm answer; null when it is not an object. */
```

**lib/game/farm/state.ts — edit 6 of 8.** Replace:

```ts
  const tank = t ? { item: typeof t.item === "string" ? t.item : null, charges: num(t.charges) } : null;
  return { items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true, produce, tank };
}
```

with:

```ts
  const tank = t ? { item: typeof t.item === "string" ? t.item : null, charges: num(t.charges) } : null;
  return { items, rice, coins: num(m.coins), giftClaimed: m.gift_claimed === true, produce, tank, ...parseGather(m) };
}
```

**lib/game/farm/state.ts — edit 7 of 8.** Replace:

```ts
  const offers = (v: unknown) => arr(v).map(parseOffer).filter((o): o is OfferView => o !== null);
  return {
```

with:

```ts
  const offers = (v: unknown) => arr(v).map(parseOffer).filter((o): o is OfferView => o !== null);
  const cp = obj(j.critter_prices);
  return {
```

**lib/game/farm/state.ts — edit 8 of 8.** Replace:

```ts
    },
  };
```

with:

```ts
    },
    critterPrices: numOrNull(cp.mult) === null ? null : { mult: num(cp.mult), endsAt: time(cp.ends_at) },
  };
```

**lib/game/farm/rpc.ts — edit 1 of 12.** Replace:

```ts
import {
  FARM_KINDS, farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type FarmItemRow, type UplandCropRow, type VarietyRow,
} from "./catalog";
```

with:

```ts
import {
  critterFromRow, FARM_KINDS, farmItemFromRow, uplandFromRow, varietyFromRow, type CritterKindRow, type FarmCatalog, type FarmItemRow,
  type UplandCropRow, type VarietyRow,
} from "./catalog";
```

**lib/game/farm/rpc.ts — edit 2 of 12.** Replace:

```ts

// Supabase calls for the field (spec §11.3; v15.2 §11.4). Every room answer is the whole field_state; the account-only
// ones (sell_rice, buy_farm_item, claim_farm_gift, load_sprayer, sell_produce) answer with the account part.
```

with:

```ts

// Supabase calls for the field (spec §11.3; v15.2 §11.4; v15.3 §11.4). Every farm answer in a room is the whole
// field_state; the account-only ones (sell_rice, buy_farm_item, claim_farm_gift, load_sprayer, sell_produce,
// sell_critters) and the gathering ones (crab_start, crab_finish, pick_snail_bed) answer with the account part.
```

**lib/game/farm/rpc.ts — edit 3 of 12.** Replace:

```ts

/** No such table: upland_crops before 0016 (PostgREST's PGRST205, Postgres' 42P01). */
const isMissingTable = (e: { code?: unknown } | null): boolean => e?.code === "PGRST205" || e?.code === "42P01";
```

with:

```ts

/** The RPCs 0018 adds: before it runs, PostgREST cannot find them (v15.3 R23). */
export const RPCS_153: ReadonlySet<string> = new Set(["crab_start", "crab_finish", "pick_snail_bed", "sell_critters"]);

/** No such table: upland_crops before 0016, critter_kinds before 0018 (PostgREST's PGRST205, Postgres' 42P01). */
const isMissingTable = (e: { code?: unknown } | null): boolean => e?.code === "PGRST205" || e?.code === "42P01";
```

**lib/game/farm/rpc.ts — edit 4 of 12.** Replace:

```ts

/** Varieties, hoa-màu crops and farm items, cached per page load (a failed fetch is retried on the next call). Before
 *  0016 there are no hoa-màu crops. */
export function fetchFarmCatalog(): Promise<FarmCatalog> {
```

with:

```ts

/** Varieties, hoa-màu crops, farm items and critters, cached per page load (a failed fetch is retried on the next
 *  call). Before 0016 there are no hoa-màu crops, and before 0018 no critters. */
export function fetchFarmCatalog(): Promise<FarmCatalog> {
```

**lib/game/farm/rpc.ts — edit 5 of 12.** Replace:

```ts
    catalogPromise = (async () => {
      const [va, up, it] = await Promise.all([
        supabase.from("rice_varieties").select("*").order("sort_order"),
```

with:

```ts
    catalogPromise = (async () => {
      const [va, up, it, cr] = await Promise.all([
        supabase.from("rice_varieties").select("*").order("sort_order"),
```

**lib/game/farm/rpc.ts — edit 6 of 12.** Replace:

```ts
        supabase.from("shop_items").select("*").in("kind", FARM_KINDS).order("kind").order("sort_order"),
      ]);
      const upErr = isMissingTable(up.error) ? null : up.error;
      if (va.error || upErr || it.error) throw va.error ?? upErr ?? it.error;
      return {
```

with:

```ts
        supabase.from("shop_items").select("*").in("kind", FARM_KINDS).order("kind").order("sort_order"),
        supabase.from("critter_kinds").select("*").order("sort_order"),
      ]);
      const upErr = isMissingTable(up.error) ? null : up.error;
      const crErr = isMissingTable(cr.error) ? null : cr.error;
      if (va.error || upErr || it.error || crErr) throw va.error ?? upErr ?? it.error ?? crErr;
      return {
```

**lib/game/farm/rpc.ts — edit 7 of 12.** Replace:

```ts
        items: ((it.data ?? []) as FarmItemRow[]).map(farmItemFromRow),
      };
```

with:

```ts
        items: ((it.data ?? []) as FarmItemRow[]).map(farmItemFromRow),
        critters: (cr.error ? [] : ((cr.data ?? []) as CritterKindRow[])).map(critterFromRow),
      };
```

**lib/game/farm/rpc.ts — edit 8 of 12.** Replace:

```ts

export interface FieldAnswer {
```

with:

```ts

/** Critters caught (v15.3 §7.2–§7.4): each kept one at its price, and how many got away for want of room (R5). */
export interface CatchAnswer { caught: { kind: string; price: number }[]; escaped: number }

export interface FieldAnswer {
```

**lib/game/farm/rpc.ts — edit 9 of 12.** Replace:

```ts
  picking: PickingAnswer | null;
}
```

with:

```ts
  picking: PickingAnswer | null;
  /** pick_snails' ốc bươu vàng for the picker (null before 0018). */
  snails: CatchAnswer | null;
}
```

**lib/game/farm/rpc.ts — edit 10 of 12.** Replace:

```ts
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
```

with:

```ts
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function catchOf(v: unknown): CatchAnswer | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.caught) || !isNum(o.escaped)) return null;
  const caught = o.caught.flatMap((c): CatchAnswer["caught"] => {
    const x = c && typeof c === "object" ? (c as Record<string, unknown>) : {};
    return typeof x.kind === "string" && isNum(x.price) ? [{ kind: x.kind, price: x.price }] : [];
  });
  return { caught, escaped: o.escaped };
}
```

**lib/game/farm/rpc.ts — edit 11 of 12.** Replace:

```ts
      ? { upland: h.upland, kg: h.kg, k: h.k, pickings: h.pickings, done: h.done === true } : null,
  };
```

with:

```ts
      ? { upland: h.upland, kg: h.kg, k: h.k, pickings: h.pickings, done: h.done === true } : null,
    snails: catchOf(r.snails),
  };
```

**lib/game/farm/rpc.ts — edit 12 of 12.** Append at the end of the file, after a blank line:

```ts
/** A crab visit (v15.3 §7.2): its id, the hole, and when the server started it. */
export interface CrabVisit { id: string; hole: number; startedAt: number }

/** Bắt cua (R6): the visit starts the hole's cooldown. */
export async function crabStart(roomId: string, token: string, hole: number): Promise<MineAnswer & { visit: CrabVisit }> {
  const r = await call("crab_start", { p_room_id: roomId, p_session_token: token, p_hole: hole });
  const v = r.visit && typeof r.visit === "object" ? (r.visit as Record<string, unknown>) : {};
  const startedAt = typeof v.started_at === "string" ? Date.parse(v.started_at) : NaN;
  if (typeof v.id !== "string" || !isNum(v.hole) || !Number.isFinite(startedAt)) throw new Error("bad crab visit");
  return { ...mineAnswer(r), visit: { id: v.id, hole: v.hole, startedAt } };
}

/** The end of a crab visit (R7): hits 0–3; what was kept and what escaped. */
export async function crabFinish(roomId: string, token: string, visitId: string, hits: number)
  : Promise<MineAnswer & { crab: CatchAnswer & { hits: number } }> {
  const r = await call("crab_finish", { p_room_id: roomId, p_session_token: token, p_visit_id: visitId, p_hits: hits });
  const c = catchOf(r.crab);
  if (!c) throw new Error("bad crab answer");
  const o = r.crab as Record<string, unknown>;
  return { ...mineAnswer(r), crab: { ...c, hits: isNum(o.hits) ? o.hits : hits } };
}

/** Mò ốc (§7.3): 1–3 snails from a bed. */
export async function pickSnailBed(roomId: string, token: string, bed: number): Promise<MineAnswer & { snails: CatchAnswer }> {
  const r = await call("pick_snail_bed", { p_room_id: roomId, p_session_token: token, p_bed: bed });
  const s = catchOf(r.snails);
  if (!s) throw new Error("bad snail answer");
  return { ...mineAnswer(r), snails: s };
}

/** cô Út buys every critter of a kind (null: all of them) at the prices stored at the catch (R15). */
export async function sellCritters(token: string, kind: string | null): Promise<MineAnswer & { sold: { n: number; xu: number } }> {
  const r = await call("sell_critters", { p_session_token: token, p_kind: kind });
  const s = r.sold && typeof r.sold === "object" ? (r.sold as Record<string, unknown>) : {};
  return { ...mineAnswer(r), sold: { n: isNum(s.n) ? s.n : 0, xu: isNum(s.xu) ? s.xu : 0 } };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (12 files, 179 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/catalog.ts lib/game/farm/gather.ts lib/game/farm/rpc.ts lib/game/farm/state.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-gather.test.ts tests/unit/farm-land.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-rpc.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-panels.test.tsx tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): the client's gathering rules, catalog, state and RPCs

lib/game/farm/gather.ts mirrors 0018's rules, the floor price at M in whole hundredths,
the spot keys and the capacity, pinned by tests/fixtures/gather-cases.json. The catalog
reads critter_kinds (none before 0018) and anh Hai's container rows; field_state gains
the critter prices, and the account part the critters held, the capacity and the
gathering. crab_start, crab_finish, pick_snail_bed and sell_critters are wired, and
pick_snails' answer gives the picker's snails.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/catalog.ts lib/game/farm/gather.ts lib/game/farm/rpc.ts lib/game/farm/state.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-catalog.test.ts tests/unit/farm-gather.test.ts tests/unit/farm-land.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-rpc.test.ts tests/unit/farm-state.test.ts tests/unit/fishing-panels.test.tsx tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 6: Six crab holes and four snail beds on the canal, and their prompts

**Files:**
- Modify: `lib/game/maps/types.ts`, `lib/game/maps/field.ts`, `lib/game/farm/gather.ts`
- Test: `tests/unit/game-field-map.test.ts`, `tests/unit/farm-gather.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`GATHER`, `spotKey`, `heldBox`, `critterCount`, `FarmMine.gather`, `critterCap`, `FarmCatalog.critters`); the field map's `CANAL` rect and its interactables.
- Produces:
  - `InteractKind` gains `crab_hole` and `snail_bed`; `Interactable.spot?: number` (a hole 1–6, a bed 1–4);
  - `field.ts`: `CRAB_HOLES` (six 16 × 10 burrows in the banks at §6's x) and `SNAIL_BEDS` (four 20 × 10 patches across the water's edge), each with the interactable `crab_{n}` "Hang cua {n}" / `bed_{n}` "Bãi ốc {n}", prompt "Bắt cua hang {n}" / "Mò ốc bãi {n}", a use spot on its bank and a face toward the water;
  - `gather.ts`: `SpotState` (`limit` | `full` with the container | `cooling` with `readyAt` | `ready`), `spotState(it, mine, catalog, now)` in the server's refusal order (every spot ready before `0018`), `minutesLeft(ms)`, `lowerFirst(name)`, `gatherPrompt(it, mine, catalog, now)` (§13.1, the text after the shell's "E · ").

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-field-map.test.ts — edit 1 of 3.** Replace:

```ts
    expect(field.interactables.map((i) => i.id).sort()).toEqual([
      "coop", "drying", "farm_shop", "field_to_hall", "field_to_pond",
      "plot_1", "plot_10", "plot_2", "plot_3", "plot_4", "plot_5", "plot_6", "plot_7", "plot_8", "plot_9", "rice_depot",
```

with:

```ts
    expect(field.interactables.map((i) => i.id).sort()).toEqual([
      "bed_1", "bed_2", "bed_3", "bed_4", "coop", "crab_1", "crab_2", "crab_3", "crab_4", "crab_5", "crab_6", "drying", "farm_shop",
      "field_to_hall", "field_to_pond",
      "plot_1", "plot_10", "plot_2", "plot_3", "plot_4", "plot_5", "plot_6", "plot_7", "plot_8", "plot_9", "rice_depot",
```

**tests/unit/game-field-map.test.ts — edit 2 of 3.** Replace:

```ts
    expect(prompt("plot_3")).toBe("Xem thửa 3");
  });
```

with:

```ts
    expect(prompt("plot_3")).toBe("Xem thửa 3");
    expect(prompt("crab_3")).toBe("Bắt cua hang 3");
    expect(prompt("bed_2")).toBe("Mò ốc bãi 2");
  });
```

**tests/unit/game-field-map.test.ts — edit 3 of 3.** Replace:

```ts
  });
  it("blocks the canal but not its bridges, the buildings, and not the drying yard", () => {
```

with:

```ts
  });
  it("puts 6 crab holes and 4 snail beds on the canal's banks, facing the water (v15.3 §6)", () => {
    const holes = ofKind("crab_hole"), beds = ofKind("snail_bed");
    expect(holes.map((h) => [h.id, h.spot, h.label])).toEqual([1, 2, 3, 4, 5, 6].map((n) => [`crab_${n}`, n, `Hang cua ${n}`]));
    expect(beds.map((b) => [b.id, b.spot, b.label])).toEqual([1, 2, 3, 4].map((n) => [`bed_${n}`, n, `Bãi ốc ${n}`]));
    const water = { x: CANAL.x, y: CANAL.y, w: CANAL.w, h: CANAL.h };
    for (const h of holes) {
      // a burrow in the bank: it touches the water's edge from the north or the south
      expect(h.rect.y + h.rect.h === CANAL.y || h.rect.y === CANAL.y + CANAL.h, h.id).toBe(true);
      expect(h.rect.x >= CANAL.x && h.rect.x + h.rect.w <= CANAL.x + CANAL.w, h.id).toBe(true);
    }
    for (const b of beds) {
      // shallow water at the edge: partly in the canal, partly on the bank
      expect(overlaps(b.rect, water), b.id).toBe(true);
      expect(b.rect.y < CANAL.y || b.rect.y + b.rect.h > CANAL.y + CANAL.h, b.id).toBe(true);
    }
    const spots = [...holes, ...beds];
    for (const s of spots) {
      for (const p of FIELD_PLOTS) expect(overlaps(s.rect, p.rect), `${s.id}/plot ${p.no}`).toBe(false);
      for (const r of [...FIELD_SOLIDS, ...BRIDGES, DRYING_YARD]) expect(overlaps(s.rect, r), s.id).toBe(false);
      for (const o of spots) if (o !== s) expect(overlaps(s.rect, o.rect), `${s.id}/${o.id}`).toBe(false);
      expect(s.face, s.id).toBe(s.use.y < CANAL.y ? "down" : "up");
      for (const o of field.interactables) {
        if (o !== s) expect(Math.hypot(o.use.x - s.use.x, o.use.y - s.use.y), `${s.id}/${o.id}`).toBeGreaterThanOrEqual(32);
      }
    }
    for (const h of holes) for (const o of holes) {
      if (o !== h) expect(Math.hypot(o.rect.x - h.rect.x, o.rect.y - h.rect.y), `${h.id}/${o.id}`).toBeGreaterThanOrEqual(40);
    }
  });
  it("blocks the canal but not its bridges, the buildings, and not the drying yard", () => {
```

**tests/unit/farm-gather.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { farmItemFromRow } from "@/lib/game/farm/catalog";
import {
  BED_BAR_MS, BED_COUNT, CRAB_FINISH_WAIT_MS, critterCap, critterCount, critterPrice, GATHER, heldBox, HOLE_COUNT, spotId, spotKey,
  TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
import fixture from "@/tests/fixtures/gather-cases.json";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { critterFromRow, farmItemFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import {
  BED_BAR_MS, BED_COUNT, CRAB_FINISH_WAIT_MS, critterCap, critterCount, critterPrice, GATHER, gatherPrompt, heldBox, HOLE_COUNT,
  minutesLeft, spotId, spotKey, spotState, TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
import type { FarmMine } from "@/lib/game/farm/state";
import type { Interactable } from "@/lib/game/maps/types";
import fixture from "@/tests/fixtures/gather-cases.json";
```

**tests/unit/farm-gather.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("the field prompts (§13.1)", () => {
  const NOW = Date.parse("2026-09-26T10:00:00Z");
  const spot = (id: string, kind: "crab_hole" | "snail_bed", n: number): Interactable => ({
    id, kind, label: "", prompt: "", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 0, y: 0 }, spot: n,
  });
  const HOLE = spot("crab_3", "crab_hole", 3);
  const BED = spot("bed_2", "snail_bed", 2);
  const named = (id: string, name: string, capacity: number) => farmItemFromRow({
    id, kind: "critter_box", name, price: 1, sort_order: 0, variety: null, fert: null, pest_target: null, capacity,
  });
  const CATALOG: FarmCatalog = {
    varieties: [], uplands: [], items: [named("box_bucket", "Xô nhựa", 15), named("box_basket", "Giỏ tre", 30)],
    critters: [critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 })],
  };
  const mine = (over: Partial<FarmMine> = {}): FarmMine => ({
    items: {}, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters: {}, critterCap: 3,
    gather: { readyAt: {}, leftToday: 200, dayResetsAt: null }, ...over,
  });
  const prompt = (it: Interactable, m: FarmMine, c: FarmCatalog = CATALOG) => gatherPrompt(it, m, c, NOW);
  const cooling = (key: string, ms: number) => ({ readyAt: { [key]: NOW + ms }, leftToday: 150, dayResetsAt: null });
  const LIMIT = { readyAt: {}, leftToday: 0, dayResetsAt: NOW + 3_600_000 };
  const FULL = { critters: { cua_dong: { n: 3, xu: 36 } } };

  it("reads E at a ready spot", () => {
    expect(prompt(HOLE, mine())).toBe("Bắt cua hang 3");
    expect(prompt(BED, mine())).toBe("Mò ốc bãi 2");
    expect(spotState(HOLE, mine(), CATALOG, NOW)).toEqual({ kind: "ready" });
  });
  it("counts a cooldown in whole minutes on the server clock, ready at its end", () => {
    expect(prompt(HOLE, mine({ gather: cooling("crab3", 11.5 * 60_000) }))).toBe("Hang 3 · cua chưa ra (còn 12 phút)");
    expect(prompt(BED, mine({ gather: cooling("bed2", 7 * 60_000) }))).toBe("Bãi 2 · còn 7 phút");
    expect(prompt(HOLE, mine({ gather: cooling("crab3", 1_000) }))).toBe("Hang 3 · cua chưa ra (còn 1 phút)");
    expect(prompt(HOLE, mine({ gather: cooling("crab3", 0) }))).toBe("Bắt cua hang 3");
    expect(prompt(HOLE, mine({ gather: cooling("crab4", 60_000) }))).toBe("Bắt cua hang 3");
    expect(spotState(HOLE, mine({ gather: cooling("crab3", 60_000) }), CATALOG, NOW)).toEqual({ kind: "cooling", readyAt: NOW + 60_000 });
    expect([1, 60_000, 60_001].map(minutesLeft)).toEqual([1, 1, 2]);
  });
  it("names the full container, or the hands", () => {
    expect(prompt(HOLE, mine(FULL))).toBe("Hang 3 · tay đầy — bán ở vựa cô Út");
    expect(prompt(BED, mine({ items: { box_bucket: 1 }, critterCap: 18, critters: { cua_dong: { n: 18, xu: 216 } } })))
      .toBe("Bãi 2 · xô nhựa đầy — bán ở vựa cô Út");
    expect(prompt(HOLE, mine({ items: { box_basket: 1 }, critterCap: 33, critters: { cua_dong: { n: 33, xu: 396 } } })))
      .toBe("Hang 3 · giỏ tre đầy — bán ở vựa cô Út");
    expect(spotState(HOLE, mine(FULL), CATALOG, NOW)).toEqual({ kind: "full", box: null });
    expect(spotState(BED, mine({ items: { box_bucket: 1 }, critterCap: 18, critters: { cua_dong: { n: 18, xu: 216 } } }), CATALOG, NOW))
      .toMatchObject({ kind: "full", box: { id: "box_bucket", name: "Xô nhựa" } });
  });
  it("shows the server's first refusal: the daily limit, then full, then the cooldown", () => {
    const all = mine({ ...FULL, gather: { ...LIMIT, readyAt: { crab3: NOW + 60_000 } } });
    expect(prompt(HOLE, all)).toBe("Hết lượt bắt cua, mò ốc hôm nay");
    expect(prompt(HOLE, mine({ ...FULL, gather: cooling("crab3", 60_000) }))).toBe("Hang 3 · tay đầy — bán ở vựa cô Út");
    // the Vietnam day turned since the answer: no longer at the limit
    expect(gatherPrompt(HOLE, mine({ gather: LIMIT }), CATALOG, NOW + 3_600_000)).toBe("Bắt cua hang 3");
  });
  it("shows every spot ready before 0018 (no critter kinds)", () => {
    const before = { ...CATALOG, critters: [] };
    expect(prompt(HOLE, mine({ ...FULL, gather: LIMIT }), before)).toBe("Bắt cua hang 3");
    expect(prompt(BED, mine({ gather: cooling("bed2", 60_000) }), before)).toBe("Mò ốc bãi 2");
    expect(gatherPrompt(HOLE, null, null, NOW)).toBe("Bắt cua hang 3");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-gather.test.ts tests/unit/game-field-map.test.ts`
Expected: FAIL — 8 tests fail (`gatherPrompt is not a function`; the map has no holes or beds, and no "Bắt cua hang 3" prompt); 16 pass.

- [ ] **Step 3: Implement**

**lib/game/maps/types.ts — edit 1 of 3.** Replace:

```ts
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying"
  | "card_table" | "card_rules";
```

with:

```ts
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying"
  | "card_table" | "card_rules" | "crab_hole" | "snail_bed";
```

**lib/game/maps/types.ts — edit 2 of 3.** Replace:

```ts
  use: Vec;
  /** fish_spot: the direction of the water. */
  face?: Facing;
```

with:

```ts
  use: Vec;
  /** fish_spot, crab_hole, snail_bed: the direction of the water. */
  face?: Facing;
```

**lib/game/maps/types.ts — edit 3 of 3.** Replace:

```ts
  game?: CardGame;
}
```

with:

```ts
  game?: CardGame;
  /** crab_hole: its number (1–6); snail_bed: its number (1–4). */
  spot?: number;
}
```

**lib/game/maps/field.ts — edit 1 of 3.** Replace:

```ts

/** Sân phơi: four concrete drying squares (walkable). */
```

with:

```ts

/** v15.3 (spec §6): six crab holes, burrows in the canal's banks, and four snail beds, shallow water across its edge.
 *  Holes 1, 3, 5 and bed 3 are on the north bank, the others on the south bank; their use spots stand on the bank,
 *  facing the water. */
const HOLE_BANKS: ReadonlyArray<[number, "north" | "south"]> = [[96, "north"], [250, "south"], [364, "north"], [500, "south"], [700, "north"], [640, "south"]];
export const CRAB_HOLES: Rect[] = HOLE_BANKS.map(([x, bank]) => ({ x: x - 8, y: bank === "north" ? CANAL.y - 10 : CANAL.y + CANAL.h, w: 16, h: 10 }));
export const SNAIL_BEDS: Rect[] = [
  { x: 70, y: 204, w: 20, h: 10 }, { x: 170, y: 204, w: 20, h: 10 }, { x: 630, y: 171, w: 20, h: 10 }, { x: 702, y: 203, w: 20, h: 10 },
];
const NORTH_BANK = CANAL.y - 12;
const SOUTH_BANK = CANAL.y + CANAL.h + 12;

/** Sân phơi: four concrete drying squares (walkable). */
```

**lib/game/maps/field.ts — edit 2 of 3.** Replace:

```ts

export const FIELD_INTERACTABLES: Interactable[] = [
```

with:

```ts

function gatherUse(kind: "crab_hole" | "snail_bed", rect: Rect, i: number): Interactable {
  const n = i + 1, north = rect.y < CANAL.y, hole = kind === "crab_hole";
  return {
    id: `${hole ? "crab" : "bed"}_${n}`, kind, label: hole ? `Hang cua ${n}` : `Bãi ốc ${n}`,
    prompt: hole ? `Bắt cua hang ${n}` : `Mò ốc bãi ${n}`, rect, spot: n,
    use: { x: rect.x + rect.w / 2, y: north ? NORTH_BANK : SOUTH_BANK }, face: north ? "down" : "up",
  };
}

export const FIELD_INTERACTABLES: Interactable[] = [
```

**lib/game/maps/field.ts — edit 3 of 3.** Replace:

```ts
  ...FIELD_PLOTS.map(plotUse),
];
```

with:

```ts
  ...FIELD_PLOTS.map(plotUse),
  ...CRAB_HOLES.map((r, i) => gatherUse("crab_hole", r, i)),
  ...SNAIL_BEDS.map((r, i) => gatherUse("snail_bed", r, i)),
];
```

**lib/game/farm/gather.ts — edit 1 of 2.** Replace:

```ts
// v15.3 gathering (spec §7, §13.1): 0018's rules (tests/fixtures/gather-cases.json pins them against the SQL), the
// critter prices, the spot keys and the capacity. Pure.
import type { FarmItem } from "./catalog";
```

with:

```ts
// v15.3 gathering (spec §7, §13.1): 0018's rules (tests/fixtures/gather-cases.json pins them against the SQL), the
// critter prices, the spot keys, the capacity, and each spot's state and prompt. Pure.
import type { Interactable } from "@/lib/game/maps/types";
import type { FarmCatalog, FarmItem } from "./catalog";
import type { FarmMine } from "./state";
```

**lib/game/farm/gather.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
/** Where a hole or a bed stands for me (§13.1), in the server's refusal order: the daily limit, a full container (or
 *  full hands: box null), the spot's cooldown on the server clock, ready. Before 0018 (no critter kinds) every spot is
 *  ready, and E shows NOT_OPEN_153. */
export type SpotState =
  | { kind: "limit" }
  | { kind: "full"; box: FarmItem | null }
  | { kind: "cooling"; readyAt: number }
  | { kind: "ready" };

export function spotState(it: Interactable, mine: FarmMine | null, catalog: FarmCatalog | null, now: number): SpotState {
  if (!mine || !catalog || catalog.critters.length === 0) return { kind: "ready" };
  const g = mine.gather;
  if (g.leftToday <= 0 && (g.dayResetsAt === null || now < g.dayResetsAt)) return { kind: "limit" };
  if (critterCount(mine.critters) >= mine.critterCap) return { kind: "full", box: heldBox(mine.items, catalog.items) };
  const key = spotKey(it.id);
  const readyAt = key === null ? undefined : g.readyAt[key];
  return readyAt !== undefined && readyAt > now ? { kind: "cooling", readyAt } : { kind: "ready" };
}

/** Whole minutes left, at least 1. */
export function minutesLeft(ms: number): number {
  return Math.max(1, Math.ceil(ms / 60_000));
}

/** A container's name mid-sentence: "Giỏ tre" → "giỏ tre". */
export const lowerFirst = (name: string): string => name.charAt(0).toLocaleLowerCase("vi-VN") + name.slice(1);

/** The field prompt of a hole or a bed (§13.1), after the shell's "E · ". */
export function gatherPrompt(it: Interactable, mine: FarmMine | null, catalog: FarmCatalog | null, now: number): string {
  const hole = it.kind === "crab_hole", n = it.spot ?? 0;
  const s = spotState(it, mine, catalog, now);
  switch (s.kind) {
    case "limit":
      return "Hết lượt bắt cua, mò ốc hôm nay";
    case "full":
      return `${hole ? "Hang" : "Bãi"} ${n} · ${s.box ? lowerFirst(s.box.name) : "tay"} đầy — bán ở vựa cô Út`;
    case "cooling": {
      const m = minutesLeft(s.readyAt - now);
      return hole ? `Hang ${n} · cua chưa ra (còn ${m} phút)` : `Bãi ${n} · còn ${m} phút`;
    }
    case "ready":
      return hole ? `Bắt cua hang ${n}` : `Mò ốc bãi ${n}`;
  }
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 24 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/gather.ts lib/game/maps/field.ts lib/game/maps/types.ts tests/unit/farm-gather.test.ts tests/unit/game-field-map.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): six crab holes and four snail beds on the canal, and their prompts

The field map gains the crab_hole and snail_bed interactables with their numbers: the
holes are burrows in the banks, the beds lie across the water's edge, and every use
spot stands on a bank facing the water, at least 32 px from any other. gather.ts works
out each spot's state for me in the server's refusal order (the daily limit, full,
cooling, ready) and its field prompt; before 0018 every spot is ready.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/gather.ts lib/game/maps/field.ts lib/game/maps/types.ts tests/unit/farm-gather.test.ts tests/unit/game-field-map.test.ts
git commit -F <message file>
```

---

### Task 7: The texts and the handbook — gathering refusals, catch toasts, the "Cua & ốc" tab

**Files:**
- Modify: `lib/game/farm/messages.ts`, `lib/game/farm/handbook.ts`
- Test: `tests/unit/farm-messages.test.ts`, `tests/unit/farm-handbook.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`GATHER`, `CatchAnswer`, `CritterKind`, the containers), Task 6 (`lowerFirst`); v15.2's `farmErrorMessage(err, itemName?, rpc?)`, `durationText`, `produceSummary`, `handbookTabs`, `handbookPage`.
- Produces:
  - `messages.ts`: `farmErrorMessage` maps §11.8's refusals (the minutes of `hole empty` / `bed empty` from `details`, "ít phút" without them; `critters full` with the container's name or the hands' line; `gather daily limit`; `visit not found`; `visit expired`; `no critters`) and reads `too fast` in the `crab_finish` and `transplant` contexts and `work expired`, `lease ending`, `not your plot` in the `transplant` context; `NOT_OPEN_153`, `GATHER_LIMIT_TEXT`, `crittersFullText(box)`, `holeEmptyText(ms)`, `bedEmptyText(ms)`, `CRAB_GAVE_UP`, `crabResultText(crab, kinds, box)`, `bedResultText(snails, kinds, box)`, `pestSnailText(plot, snails, box)`, `critterSaleText(n, xu)`; `WORK_EXPIRED_TP` and `LEASE_ENDING_TP`, the transplant round's two texts beside v15.2's `WORK_EXPIRED` and `LEASE_ENDING`; `produceSummary(rice, produce, critters = 0)` adds " · 🦀 {n}";
  - `handbook.ts`: `handbookTabs(uplands, critters = [])` adds "Cua & ốc" (id `critters`) last once there are critter kinds; `critterHandbook(kinds, boxes)` builds §14's lines from the config and `gather.ts`; step 6, the ớt nursery line and the tips tell the transplant round.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-messages.test.ts — edit 1 of 2.** Replace:

```ts
import {
  bedLevelsText, boughtText, durationText, farmErrorMessage, GIFT_TEXT, harvesterDoneText, harvesterStartText, harvestText, isMissingRpc,
  loadedText, NOT_OPEN_152, partsDoneText, partText, PEST_NAME, PEST_REMEDY, PHASE_NAME, pickingText, produceSaleText, produceSummary,
  riceSaleText, riceSummary, uplandPhaseName,
} from "@/lib/game/farm/messages";
import { uplandFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

with:

```ts
import {
  bedLevelsText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, durationText, farmErrorMessage,
  GATHER_LIMIT_TEXT, GIFT_TEXT, harvesterDoneText, harvesterStartText, harvestText, isMissingRpc, loadedText, NOT_OPEN_152, NOT_OPEN_153,
  partsDoneText, partText, PEST_NAME, PEST_REMEDY, pestSnailText, PHASE_NAME, pickingText, produceSaleText, produceSummary, riceSaleText,
  riceSummary, uplandPhaseName,
} from "@/lib/game/farm/messages";
import { critterFromRow, uplandFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import fixtures from "@/tests/fixtures/upland-cases.json";
```

**tests/unit/farm-messages.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("v15.3 texts (§11.8, §13.2, §13.4)", () => {
  const KINDS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
    critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
    critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
  ];
  const c = (kind: string, price = 1) => ({ kind, price });
  it("maps the gathering refusals, with the minutes from the details", () => {
    const m = (message: string, extra: Record<string, unknown> = {}, item?: string) => farmErrorMessage({ message, ...extra }, item);
    expect(m("hole empty", { details: "720" })).toBe("Cua chưa ra — quay lại sau 12 phút.");
    expect(m("hole empty", { details: "690" })).toBe("Cua chưa ra — quay lại sau 12 phút.");
    expect(m("bed empty", { details: "420" })).toBe("Bãi này vừa mò rồi — quay lại sau 7 phút.");
    expect(m("hole empty")).toBe("Cua chưa ra — quay lại sau ít phút.");
    expect(m("critters full", {}, "Giỏ tre")).toBe("Giỏ tre đầy rồi — ra vựa cô Út bán bớt nhé.");
    expect(m("critters full")).toBe("Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai.");
    expect(m("gather daily limit", { details: "3600" })).toBe("Hôm nay bạn bắt cua, mò ốc đủ 200 lượt rồi — mai quay lại nhé!");
    expect(m("visit not found")).toBe("Lượt bắt cua này đã xong.");
    expect(m("visit expired")).toBe("Lâu quá, cua chui mất rồi — lát nữa quay lại nhé.");
    expect(m("no critters")).toBe("Không có cua ốc để bán.");
    expect([m("invalid spot"), m("invalid kind")]).toEqual(["Có lỗi, thử lại nhé.", "Có lỗi, thử lại nhé."]);
    expect([crittersFullText("Xô nhựa"), GATHER_LIMIT_TEXT]).toEqual([
      "Xô nhựa đầy rồi — ra vựa cô Út bán bớt nhé.", "Hôm nay bạn bắt cua, mò ốc đủ 200 lượt rồi — mai quay lại nhé!",
    ]);
    expect(NOT_OPEN_153).toBe("Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018.");
  });
  it("reads a crab finish's and a transplant's refusals in their context, and keeps the others", () => {
    const m = (message: string, action?: string) => farmErrorMessage({ message }, undefined, action);
    expect(m("too fast", "crab_finish")).toBe("Chưa bắt xong — thử lại sau vài giây.");
    expect(m("too fast", "transplant")).toBe("Chưa cấy xong hàng mạ — thử lại sau vài giây.");
    expect(m("work expired", "transplant")).toBe("Lượt cấy đã quá lâu — bắt đầu lại nhé.");
    expect(m("lease ending", "transplant")).toBe("Sắp hết hạn thuê — không kịp cấy.");
    expect(m("not your plot", "transplant")).toBe("Hết hạn thuê — mạ trên thửa đã mất.");
    expect([m("too fast"), m("work expired"), m("lease ending"), m("not your plot")]).toEqual([
      "Từ từ thôi…", "Lượt gặt đã quá lâu — bắt đầu lại nhé.", "Sắp hết hạn thuê — không kịp gặt phần này.", "Thửa này không phải của bạn.",
    ]);
  });
  it("tells a crab visit's result (§13.2)", () => {
    expect(crabResultText({ hits: 2, caught: [c("cua_dong"), c("cua_gach")], escaped: 0 }, KINDS, null))
      .toBe("🦀 Bắt được 2 con: 1 cua đồng, 1 cua gạch!");
    expect(crabResultText({ hits: 3, caught: [c("cua_dong"), c("cua_dong")], escaped: 1 }, KINDS, "Xô nhựa"))
      .toBe("🦀 Bắt được 2 con: 2 cua đồng! 1 con chạy mất vì xô nhựa đầy.");
    expect(crabResultText({ hits: 2, caught: [], escaped: 2 }, KINDS, null)).toBe("🦀 2 con chạy mất vì tay đầy.");
    expect(crabResultText({ hits: 0, caught: [], escaped: 0 }, KINDS, null)).toBe("🦀 Cua chui hết vào hang rồi — 20 phút nữa quay lại nhé.");
    expect(CRAB_GAVE_UP).toBe("Đã rút tay — hang này 20 phút nữa mới có cua lại.");
  });
  it("tells a bed, a pest-snail pick and a sale (§13.4)", () => {
    expect(bedResultText({ caught: [c("oc_dong"), c("oc_buou_vang"), c("oc_dong")], escaped: 0 }, KINDS, null))
      .toBe("🐌 Mò được 3 con ốc: 2 ốc đồng, 1 ốc bươu vàng.");
    expect(bedResultText({ caught: [c("oc_dong")], escaped: 1 }, KINDS, "Xô nhựa")).toBe("🐌 Mò được 1 con ốc: 1 ốc đồng. Thả lại 1 con vì xô nhựa đầy.");
    expect(pestSnailText(5, { caught: [c("oc_buou_vang"), c("oc_buou_vang")], escaped: 0 }, null))
      .toBe("🐌 Bắt ốc thửa 5: được 2 con ốc bươu vàng.");
    expect(pestSnailText(5, { caught: [c("oc_buou_vang")], escaped: 1 }, "Xô nhựa"))
      .toBe("🐌 Bắt ốc thửa 5: được 1 con, thả 1 con xuống mương vì xô nhựa đầy.");
    expect(pestSnailText(5, { caught: [], escaped: 2 }, "Xô nhựa")).toBe("🐌 Bắt ốc thửa 5 — xô nhựa đầy, thả 2 con xuống mương.");
    expect(pestSnailText(5, { caught: [], escaped: 2 }, null)).toBe("🐌 Bắt ốc thửa 5 — tay đầy, thả 2 con xuống mương.");
    expect(pestSnailText(5, null, null)).toBe("Đã bắt ốc bươu vàng.");
    expect(critterSaleText(6, 230)).toBe("💰 Bán 6 con cua ốc được 230 xu.");
    expect(critterSaleText(40, 1250)).toBe("💰 Bán 40 con cua ốc được 1.250 xu.");
  });
  it("adds the critters held to the HUD's line", () => {
    expect(produceSummary({ nep: { wet: 0, dry: 70 } }, { khoai: 180 }, 12)).toBe("🌾 70 kg khô · 0 kg ướt · 🧺 180 kg màu · 🦀 12");
    expect(produceSummary({}, {}, 3)).toBe("🌾 Chưa có lúa · 🦀 3");
    expect(produceSummary({}, {}, 0)).toBe("🌾 Chưa có lúa");
  });
});
```

**tests/unit/farm-handbook.test.ts — edit 1 of 3.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookPage, handbookTabFor, handbookTabs, uplandHandbook } from "@/lib/game/farm/handbook";
import type { CropView } from "@/lib/game/farm/state";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { critterFromRow, farmItemFromRow, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { critterHandbook, HANDBOOK_TABS, handbookPage, handbookTabFor, handbookTabs, uplandHandbook } from "@/lib/game/farm/handbook";
import type { CropView } from "@/lib/game/farm/state";
```

**tests/unit/farm-handbook.test.ts — edit 2 of 3.** Replace:

```ts
      "2. Bón lót: phân chuồng hoai và phân lân trước khi trồng. Thiếu mỗi loại mất 5%.",
      "3. Ươm hạt ớt ở góc luống khi đất Ẩm, giữ Ẩm. Trồng cây ớt con khi cây 10–18 giờ tuổi, đất Ẩm; cây già quá mất 3% mỗi giờ (tối đa 30%).",
      "4. Bón thúc bén rễ: phân urê hoặc phân NPK, 4–12 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
```

with:

```ts
      "2. Bón lót: phân chuồng hoai và phân lân trước khi trồng. Thiếu mỗi loại mất 5%.",
      "3. Ươm hạt ớt ở góc luống khi đất Ẩm, giữ Ẩm. Trồng cây ớt con khi cây 10–18 giờ tuổi, đất Ẩm — mỗi lượt trồng 12 cây, được từ 6 điểm là xong. Cây già quá mất 3% mỗi giờ (tối đa 30%).",
      "4. Bón thúc bén rễ: phân urê hoặc phân NPK, 4–12 giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất 8%); bỏ trống mất 15%.",
```

**tests/unit/farm-handbook.test.ts — edit 3 of 3.** Append at the end of the file, after a blank line:

```ts
describe("v15.3: the Cua & ốc tab (§14)", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const KINDS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
    critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
    critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
  ];
  const BOXES = [["box_basket", "Giỏ tre", 6000, 30], ["box_bucket", "Xô nhựa", 1500, 15]].map(([id, name, price, capacity]) => farmItemFromRow({
    id: id as string, kind: "critter_box", name: name as string, price: price as number, sort_order: 0, variety: null, fert: null,
    pest_target: null, capacity: capacity as number,
  }));
  it("comes last, once 0018 has critters", () => {
    expect(handbookTabs(UPLANDS, KINDS).map(([, label]) => label)).toEqual([
      "Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo", "Khoai lang", "Bắp", "Ớt", "Nông cụ", "Cua & ốc",
    ]);
    expect(handbookTabs(UPLANDS, []).map(([tab]) => tab)).not.toContain("critters");
    expect(handbookTabs(UPLANDS).map(([tab]) => tab)).not.toContain("critters");
  });
  it("reads the spec's lines, the prices and the containers from the config", () => {
    const page = critterHandbook(KINDS, BOXES);
    expect(page.map((s) => s.title)).toEqual(["Bắt cua ở hang", "Mò ốc ở bãi", "Ốc bươu vàng trên ruộng — khác bãi ốc", "Đồ đựng", "Giá và bán"]);
    expect(page.map((s) => s.lines)).toEqual([
      [
        "Dọc bờ mương có 6 hang cua. Đứng trên bờ, bấm E để thò tay vào hang.",
        "Cua giơ càng mở ra khép vào, lần sau nhanh hơn lần trước. Chộp lúc càng khép là bắt được; chộp lúc càng mở là bị kẹp, con đó chạy mất. Mỗi hang thử 3 lần.",
        "Thò tay vào rồi thì hang phải 20 phút sau mới có cua lại — tính riêng cho bạn, ở phòng nào cũng vậy.",
        "Chừng mười con có một con cua gạch, giá gần gấp 4 cua đồng.",
      ],
      [
        "4 bãi ốc nằm chỗ nước cạn ven mương. Mò 3 giây được 1–3 con, phần nhiều là ốc đồng.",
        "Mỗi bãi mò xong 20 phút sau mới có ốc lại.",
      ],
      [
        "Ốc bươu vàng trên ruộng là sâu hại: thấy trứng hồng ở thửa nào thì bắt giúp, ruộng ai cũng được.",
        "Bắt ốc là cứu lúa, còn được thêm 1–3 con ốc bươu vàng bỏ xô. Xô đầy vẫn bắt được — ốc thả xuống mương.",
        "Bắt ốc trên ruộng không phải chờ và không tính vào lượt mò ốc.",
      ],
      [
        "Tay cầm được 3 con. Xô nhựa (1.500 xu) đựng thêm 15 con, giỏ tre (6.000 xu) thêm 30 — mua ở tiệm anh Hai; có giỏ thì khỏi cần xô.",
        "Cua và ốc đựng chung. Đầy rồi thì phải bán bớt mới bắt, mò tiếp được.",
      ],
      [
        "Bán cho cô Út ở vựa lúa. Giá gốc một con: cua đồng 12, cua gạch 45, ốc đồng 8, ốc bươu vàng 2 xu.",
        "Giá nhân hệ số phòng như giá cá, chốt lúc bắt được — bán sau vẫn giữ giá đó.",
        "Mỗi ngày bắt cua, mò ốc tối đa 200 lượt.",
      ],
    ]);
    expect(handbookPage("critters", [nep], UPLANDS, BOXES, KINDS)).toEqual(page);
    expect(handbookPage("critters", [nep], UPLANDS, BOXES, [])).toEqual([]);
  });
  it("edits step 6 and the tips (§14)", () => {
    expect(handbookPage("process", [nep])[0].lines[5]).toBe(
      "6. Cấy lúa: mạ đủ tuổi, nước Nông. Mỗi lượt cắm 12 khóm — thẳng hàng được từ 6 điểm là cấy xong; hụt thì cấy lại, không mất gì. Mạ già quá mất 3% mỗi giờ.");
    const tip = "Trong lúc chờ lúa, cứ 20 phút ghé bờ mương bắt cua, mò ốc — thêm tiền mà không tốn giống, phân.";
    expect(handbookPage("tips", [nep], [], [], KINDS)[0].lines.at(-1)).toBe(tip);
    expect(handbookPage("tips", [nep])[0].lines).not.toContain(tip);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts`
Expected: FAIL — 9 tests fail (`critterHandbook is not a function`, `crabResultText is not a function`, `bedResultText is not a function`, "Có lỗi, thử lại nhé." for `hole empty`, "Từ từ thôi…" in the `crab_finish` context, the old step 6 and ớt lines, no "Cua & ốc" tab); 18 pass.

- [ ] **Step 3: Implement**

**lib/game/farm/messages.ts — edit 1 of 9.** Replace:

```ts
import { lockSeconds, lockText } from "@/lib/anticheat";
import type { UplandCrop } from "./catalog";
import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13; v15.2 §11.7, §13): names, durations, toasts and the RPC errors.
// Pure.
```

with:

```ts
import { lockSeconds, lockText } from "@/lib/anticheat";
import type { CritterKind, UplandCrop } from "./catalog";
import { GATHER, lowerFirst } from "./gather";
import type { CatchAnswer } from "./rpc";
import type { PestKind, Phase } from "./state";

// The farm's Vietnamese texts (spec §8, §11.7, §13; v15.2 §11.7, §13; v15.3 §11.8, §13): names, durations, toasts and
// the RPC errors. Pure.
```

**lib/game/farm/messages.ts — edit 2 of 9.** Replace:

```ts
export const NOT_OPEN_152 = "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
```

with:

```ts
export const NOT_OPEN_152 = "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.";
/** A v15.3 gathering action against a database without 0018 (R23). */
export const NOT_OPEN_153 = "Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018.";
export const FIELD_LOADING = "Đang tải đồng ruộng…";
```

**lib/game/farm/messages.ts — edit 3 of 9.** Replace:

```ts
export const LEASE_ENDING = "Sắp hết hạn thuê — không kịp gặt phần này.";
export const DRYING_LIMIT_TEXT = "Bạn đang phơi 2 mẻ rồi — thu lúa trước nhé.";
```

with:

```ts
export const LEASE_ENDING = "Sắp hết hạn thuê — không kịp gặt phần này.";
/** The same two for a transplant round (v15.3 §11.8): one past the window or left idle, and too little lease left. */
export const WORK_EXPIRED_TP = "Lượt cấy đã quá lâu — bắt đầu lại nhé.";
export const LEASE_ENDING_TP = "Sắp hết hạn thuê — không kịp cấy.";
export const DRYING_LIMIT_TEXT = "Bạn đang phơi 2 mẻ rồi — thu lúa trước nhé.";
```

**lib/game/farm/messages.ts — edit 4 of 9.** Replace:

```ts

/** The HUD's line (§13.6): the rice, then the hoa màu when there is any. */
export function produceSummary(rice: Record<string, { wet: number; dry: number }>, produce: Record<string, number>): string {
  const kg = Object.values(produce).reduce((a, x) => a + x, 0);
  return kg > 0 ? `${riceSummary(rice)} · 🧺 ${kg} kg màu` : riceSummary(rice);
}
```

with:

```ts

/** The HUD's line (§13.6; v15.3 §13.4): the rice, then the hoa màu and the critters held when there are any. */
export function produceSummary(rice: Record<string, { wet: number; dry: number }>, produce: Record<string, number>, critters = 0): string {
  const kg = Object.values(produce).reduce((a, x) => a + x, 0);
  return `${riceSummary(rice)}${kg > 0 ? ` · 🧺 ${kg} kg màu` : ""}${critters > 0 ? ` · 🦀 ${critters}` : ""}`;
}

const COOL_MIN = GATHER.cooldownMs / 60_000;
/** A container mid-sentence, or the hands: "xô nhựa", "tay". */
const boxWord = (boxName: string | null): string => (boxName ? lowerFirst(boxName) : "tay");
/** The critters of a catch by kind, in the catalog's order: "2 cua đồng, 1 cua gạch". */
function kindsText(caught: CatchAnswer["caught"], kinds: readonly CritterKind[]): string {
  const counts = new Map<string, number>();
  for (const c of caught) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  const order = (k: string) => kinds.findIndex((x) => x.id === k);
  return [...counts].sort(([a], [b]) => order(a) - order(b))
    .map(([k, n]) => `${n} ${lowerFirst(kinds.find((x) => x.id === k)?.name ?? k)}`).join(", ");
}

/** The v15.3 refusals (§11.8). */
export const GATHER_LIMIT_TEXT = `Hôm nay bạn bắt cua, mò ốc đủ ${GATHER.dailyVisits} lượt rồi — mai quay lại nhé!`;
export function crittersFullText(boxName: string | null): string {
  return boxName ? `${boxName} đầy rồi — ra vựa cô Út bán bớt nhé.` : "Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai.";
}
/** A cooling hole or bed: the minutes left, or "ít phút" when the answer has none. */
export function holeEmptyText(ms: number | null): string {
  return `Cua chưa ra — quay lại sau ${ms === null ? "ít phút" : durationText(ms)}.`;
}
export function bedEmptyText(ms: number | null): string {
  return `Bãi này vừa mò rồi — quay lại sau ${ms === null ? "ít phút" : durationText(ms)}.`;
}

/** Dừng before the first try ends (R8): nothing is sent, and the hole keeps its cooldown. */
export const CRAB_GAVE_UP = `Đã rút tay — hang này ${COOL_MIN} phút nữa mới có cua lại.`;

/** CrabGame's result (§13.2). */
export function crabResultText(crab: CatchAnswer & { hits: number }, kinds: readonly CritterKind[], boxName: string | null): string {
  const n = crab.caught.length, lost = crab.escaped > 0 ? `${crab.escaped} con chạy mất vì ${boxWord(boxName)} đầy.` : "";
  if (n > 0) return `🦀 Bắt được ${n} con: ${kindsText(crab.caught, kinds)}!${lost ? ` ${lost}` : ""}`;
  return lost ? `🦀 ${lost}` : `🦀 Cua chui hết vào hang rồi — ${COOL_MIN} phút nữa quay lại nhé.`;
}

/** A snail bed's toast (§13.4). */
export function bedResultText(snails: CatchAnswer, kinds: readonly CritterKind[], boxName: string | null): string {
  const n = snails.caught.length, back = snails.escaped > 0 ? `Thả lại ${snails.escaped} con vì ${boxWord(boxName)} đầy.` : "";
  if (n === 0) return `🐌 ${back}`;
  return `🐌 Mò được ${n} con ốc: ${kindsText(snails.caught, kinds)}.${back ? ` ${back}` : ""}`;
}

/** pick_snails' toast (§13.4): the picker's ốc bươu vàng; an answer without snails (before 0018) keeps v15.2's text. */
export function pestSnailText(plot: number, snails: CatchAnswer | null, boxName: string | null): string {
  if (!snails) return "Đã bắt ốc bươu vàng.";
  const n = snails.caught.length, e = snails.escaped;
  if (e === 0) return `🐌 Bắt ốc thửa ${plot}: được ${n} con ốc bươu vàng.`;
  if (n > 0) return `🐌 Bắt ốc thửa ${plot}: được ${n} con, thả ${e} con xuống mương vì ${boxWord(boxName)} đầy.`;
  return `🐌 Bắt ốc thửa ${plot} — ${boxWord(boxName)} đầy, thả ${e} con xuống mương.`;
}

/** cô Út's toast for sell_critters (§13.4), from its `sold`. */
export function critterSaleText(n: number, xu: number): string {
  return `💰 Bán ${n} con cua ốc được ${xu.toLocaleString("vi-VN")} xu.`;
}
```

**lib/game/farm/messages.ts — edit 5 of 9.** Replace:

```ts

/** Vietnamese toast text for a farm RPC error (spec §11.7, v15.2 §11.7). `itemName` names the item a "no item" error is
 *  about; `action` = "harvest_part" reads a harvest round's refusals (the HarvestGame overlay). */
export function farmErrorMessage(err: unknown, itemName?: string, action?: string): string {
```

with:

```ts

/** The seconds an error's details carry (hole empty, bed empty), as ms; null without them. */
function detailMs(err: unknown): number | null {
  const d = (err && typeof err === "object" ? err : {}) as { details?: unknown };
  return typeof d.details === "string" && /^\d+$/.test(d.details) ? Number(d.details) * 1000 : null;
}

/** Vietnamese toast text for a farm RPC error (spec §11.7, v15.2 §11.7, v15.3 §11.8). `itemName` names the item a
 *  "no item" error is about, or the container a "critters full" one is; `action` reads a round's refusals in its
 *  context: "harvest_part" (HarvestGame), "crab_finish" (CrabGame) or "transplant" (TransplantGame). */
export function farmErrorMessage(err: unknown, itemName?: string, action?: string): string {
```

**lib/game/farm/messages.ts — edit 6 of 9.** Replace:

```ts
  const msg = typeof e.message === "string" ? e.message : "";
  const round = action === "harvest_part";
  switch (msg) {
    case "not your plot": return round ? "Hết hạn thuê — phần lúa chưa gặt đã mất." : "Thửa này không phải của bạn.";
    case "plot taken": return "Thửa này đã có người canh tác.";
```

with:

```ts
  const msg = typeof e.message === "string" ? e.message : "";
  const round = action === "harvest_part", crab = action === "crab_finish", tp = action === "transplant";
  switch (msg) {
    case "not your plot":
      return round ? "Hết hạn thuê — phần lúa chưa gặt đã mất." : tp ? "Hết hạn thuê — mạ trên thửa đã mất." : "Thửa này không phải của bạn.";
    case "plot taken": return "Thửa này đã có người canh tác.";
```

**lib/game/farm/messages.ts — edit 7 of 9.** Replace:

```ts
    case "invalid price": return "Số không hợp lệ.";
    case "too fast": return round ? "Chưa xong bó lúa — thử lại sau vài giây." : TOO_FAST;
    case "no sickle": return "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).";
```

with:

```ts
    case "invalid price": return "Số không hợp lệ.";
    case "too fast":
      return round ? "Chưa xong bó lúa — thử lại sau vài giây." : crab ? "Chưa bắt xong — thử lại sau vài giây."
        : tp ? "Chưa cấy xong hàng mạ — thử lại sau vài giây." : TOO_FAST;
    case "no sickle": return "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).";
```

**lib/game/farm/messages.ts — edit 8 of 9.** Replace:

```ts
    case "harvester busy": return "Máy gặt đang gặt thửa này.";
    case "work expired": return WORK_EXPIRED;
    case "lease ending": return LEASE_ENDING;
    case "lease ends": return "Không kịp gặt xong trước khi hết hạn thuê.";
```

with:

```ts
    case "harvester busy": return "Máy gặt đang gặt thửa này.";
    case "work expired": return tp ? WORK_EXPIRED_TP : WORK_EXPIRED;
    case "lease ending": return tp ? LEASE_ENDING_TP : LEASE_ENDING;
    case "lease ends": return "Không kịp gặt xong trước khi hết hạn thuê.";
```

**lib/game/farm/messages.ts — edit 9 of 9.** Replace:

```ts
    case "not enough crop": return "Không đủ hàng để bán.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
```

with:

```ts
    case "not enough crop": return "Không đủ hàng để bán.";
    case "hole empty": return holeEmptyText(detailMs(err));
    case "bed empty": return bedEmptyText(detailMs(err));
    case "critters full": return crittersFullText(itemName ?? null);
    case "gather daily limit": return GATHER_LIMIT_TEXT;
    case "visit not found": return "Lượt bắt cua này đã xong.";
    case "visit expired": return "Lâu quá, cua chui mất rồi — lát nữa quay lại nhé.";
    case "no critters": return "Không có cua ốc để bán.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
```

**lib/game/farm/handbook.ts — edit 1 of 9.** Replace:

```ts
import { ripeAfterHours, uplandHours, type FarmItem, type UplandCrop, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import { bedLevelsText } from "./messages";
```

with:

```ts
import { ripeAfterHours, uplandHours, type CritterKind, type FarmItem, type UplandCrop, type Variety } from "./catalog";
import { cropModel, cropPhase } from "./crop";
import { BED_BAR_MS, BED_COUNT, GATHER, HOLE_COUNT } from "./gather";
import { bedLevelsText } from "./messages";
```

**lib/game/farm/handbook.ts — edit 2 of 9.** Replace:

```ts

// Sổ tay nhà nông (spec §8.9, v15.2 §14): the six rice tabs, one tab per hoa-màu crop worked out from its config, and
// "Nông cụ"; the rice timings are worked out per variety from the catalog. Pure.

/** A rice tab, "tools", or a hoa-màu crop's id. */
export type HandbookTab = string;
```

with:

```ts

// Sổ tay nhà nông (spec §8.9, v15.2 §14, v15.3 §14): the six rice tabs, one tab per hoa-màu crop worked out from its
// config, "Nông cụ", and "Cua & ốc" once 0018 has critters; the rice timings are worked out per variety from the
// catalog. Pure.

/** A rice tab, "tools", "critters", or a hoa-màu crop's id. */
export type HandbookTab = string;
```

**lib/game/farm/handbook.ts — edit 3 of 9.** Replace:

```ts

/** Every tab (§14): the rice ones, a tab per hoa-màu crop, then Nông cụ. */
export function handbookTabs(uplands: readonly UplandCrop[]): ReadonlyArray<[HandbookTab, string]> {
  return [...HANDBOOK_TABS, ...uplands.map((u): [HandbookTab, string] => [u.id, u.name]), ["tools", "Nông cụ"]];
}
```

with:

```ts

/** Every tab (§14): the rice ones, a tab per hoa-màu crop, Nông cụ, then Cua & ốc when there are critters (0018). */
export function handbookTabs(uplands: readonly UplandCrop[], critters: readonly CritterKind[] = []): ReadonlyArray<[HandbookTab, string]> {
  return [
    ...HANDBOOK_TABS, ...uplands.map((u): [HandbookTab, string] => [u.id, u.name]), ["tools", "Nông cụ"],
    ...(critters.length > 0 ? [["critters", "Cua & ốc"] as [HandbookTab, string]] : []),
  ];
}
```

**lib/game/farm/handbook.ts — edit 4 of 9.** Replace:

```ts
    : `3. ${u.plantLabel} ở góc luống khi đất Ẩm, giữ Ẩm. ${u.transplantLabel ?? ""} khi cây ${start(u.nurseryReadyH ?? 0)}–`
      + `${end(u.nurseryOldH ?? 0)} giờ tuổi, đất Ẩm; cây già quá mất 3% mỗi giờ (tối đa 30%).`;
  const cares = u.cares.map((c, i) => `${4 + i}. ${c.name}: ` + (c.kind === "fert"
```

with:

```ts
    : `3. ${u.plantLabel} ở góc luống khi đất Ẩm, giữ Ẩm. ${u.transplantLabel ?? ""} khi cây ${start(u.nurseryReadyH ?? 0)}–`
      + `${end(u.nurseryOldH ?? 0)} giờ tuổi, đất Ẩm — mỗi lượt trồng 12 cây, được từ 6 điểm là xong. Cây già quá mất 3% mỗi giờ `
      + "(tối đa 30%).";
  const cares = u.cares.map((c, i) => `${4 + i}. ${c.name}: ` + (c.kind === "fert"
```

**lib/game/farm/handbook.ts — edit 5 of 9.** Replace:

```ts

/** The hour marks of a season for one variety (hours after transplanting unless said). */
```

with:

```ts

/** The Cua & ốc tab (v15.3 §14), verbatim, with the prices and the containers from the config and the rules from
 *  gather.ts. */
export function critterHandbook(kinds: readonly CritterKind[], boxes: readonly FarmItem[]): HandbookSection[] {
  const cool = GATHER.cooldownMs / 60_000;
  const price = (id: string) => kinds.find((k) => k.id === id)?.basePrice ?? 0;
  const xu = (n: number | null) => (n ?? 0).toLocaleString("vi-VN");
  const [small, large] = boxes.filter((b) => b.kind === "critter_box").sort((a, b) => (a.capacity ?? 0) - (b.capacity ?? 0));
  const containers = small && large
    ? `${small.name} (${xu(small.price)} xu) đựng thêm ${small.capacity ?? 0} con, ${lc(large.name)} (${xu(large.price)} xu) thêm `
      + `${large.capacity ?? 0} — mua ở tiệm anh Hai; có giỏ thì khỏi cần xô.`
    : "Mua xô, giỏ ở tiệm anh Hai.";
  const [lo, hi] = GATHER.bedSnails;
  return [
    {
      title: "Bắt cua ở hang",
      lines: [
        `Dọc bờ mương có ${HOLE_COUNT} hang cua. Đứng trên bờ, bấm E để thò tay vào hang.`,
        "Cua giơ càng mở ra khép vào, lần sau nhanh hơn lần trước. Chộp lúc càng khép là bắt được; chộp lúc càng mở là bị kẹp, con đó "
          + "chạy mất. Mỗi hang thử 3 lần.",
        `Thò tay vào rồi thì hang phải ${cool} phút sau mới có cua lại — tính riêng cho bạn, ở phòng nào cũng vậy.`,
        `Chừng mười con có một con cua gạch, giá gần gấp ${Math.round(price("cua_gach") / Math.max(1, price("cua_dong")))} cua đồng.`,
      ],
    },
    {
      title: "Mò ốc ở bãi",
      lines: [
        `${BED_COUNT} bãi ốc nằm chỗ nước cạn ven mương. Mò ${BED_BAR_MS / 1000} giây được ${lo}–${hi} con, phần nhiều là ốc đồng.`,
        `Mỗi bãi mò xong ${cool} phút sau mới có ốc lại.`,
      ],
    },
    {
      title: "Ốc bươu vàng trên ruộng — khác bãi ốc",
      lines: [
        "Ốc bươu vàng trên ruộng là sâu hại: thấy trứng hồng ở thửa nào thì bắt giúp, ruộng ai cũng được.",
        `Bắt ốc là cứu lúa, còn được thêm ${lo}–${hi} con ốc bươu vàng bỏ xô. Xô đầy vẫn bắt được — ốc thả xuống mương.`,
        "Bắt ốc trên ruộng không phải chờ và không tính vào lượt mò ốc.",
      ],
    },
    {
      title: "Đồ đựng",
      lines: [`Tay cầm được ${GATHER.hand} con. ${containers}`, "Cua và ốc đựng chung. Đầy rồi thì phải bán bớt mới bắt, mò tiếp được."],
    },
    {
      title: "Giá và bán",
      lines: [
        `Bán cho cô Út ở vựa lúa. Giá gốc một con: ${kinds.map((k) => `${lc(k.name)} ${xu(k.basePrice)}`).join(", ")} xu.`,
        "Giá nhân hệ số phòng như giá cá, chốt lúc bắt được — bán sau vẫn giữ giá đó.",
        `Mỗi ngày bắt cua, mò ốc tối đa ${GATHER.dailyVisits} lượt.`,
      ],
    },
  ];
}

/** The hour marks of a season for one variety (hours after transplanting unless said). */
```

**lib/game/farm/handbook.ts — edit 6 of 9.** Replace:

```ts
export function handbookPage(tab: HandbookTab, varieties: readonly Variety[], uplands: readonly UplandCrop[] = [],
  items: readonly FarmItem[] = []): HandbookSection[] {
  switch (tab) {
```

with:

```ts
export function handbookPage(tab: HandbookTab, varieties: readonly Variety[], uplands: readonly UplandCrop[] = [],
  items: readonly FarmItem[] = [], critters: readonly CritterKind[] = []): HandbookSection[] {
  switch (tab) {
```

**lib/game/farm/handbook.ts — edit 7 of 9.** Replace:

```ts
            "5. Chăm mạ: giữ nước Ẩm cho tới khi mạ đủ tuổi.",
            "6. Cấy lúa: mạ đủ tuổi, nước Nông. Mạ già quá mất 3% mỗi giờ.",
            "7. Bón thúc đẻ nhánh: urê hoặc NPK, đúng lúc thì được trọn công.",
```

with:

```ts
            "5. Chăm mạ: giữ nước Ẩm cho tới khi mạ đủ tuổi.",
            "6. Cấy lúa: mạ đủ tuổi, nước Nông. Mỗi lượt cắm 12 khóm — thẳng hàng được từ 6 điểm là cấy xong; hụt thì cấy lại, không "
              + "mất gì. Mạ già quá mất 3% mỗi giờ.",
            "7. Bón thúc đẻ nhánh: urê hoặc NPK, đúng lúc thì được trọn công.",
```

**lib/game/farm/handbook.ts — edit 8 of 9.** Replace:

```ts
          "Nạp thuốc trừ sâu vào bình phun là lợi nhất: nó trị sâu cuốn lá, sùng khoai, sâu keo và bọ trĩ.",
        ],
```

with:

```ts
          "Nạp thuốc trừ sâu vào bình phun là lợi nhất: nó trị sâu cuốn lá, sùng khoai, sâu keo và bọ trĩ.",
          ...(critters.length > 0
            ? [`Trong lúc chờ lúa, cứ ${GATHER.cooldownMs / 60_000} phút ghé bờ mương bắt cua, mò ốc — thêm tiền mà không tốn giống, phân.`]
            : []),
        ],
```

**lib/game/farm/handbook.ts — edit 9 of 9.** Replace:

```ts
      return TOOLS_PAGE;
    default: {
```

with:

```ts
      return TOOLS_PAGE;
    case "critters":
      return critters.length > 0 ? critterHandbook(critters, items) : [];
    default: {
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 27 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/handbook.ts lib/game/farm/messages.ts tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): the texts and the handbook — gathering refusals, catch toasts, the Cua & ốc tab

farmErrorMessage maps 0018's refusals (the minutes of a cooling hole or bed from the
details, the container of a full hand) and reads a crab finish's and a transplant's
refusals in their context. The crab, bed, pest-snail and sale toasts name the kinds in
the catalog's order, and the HUD's line counts the critters. Sổ tay gains Cua & ốc once
0018 has critters; step 6, the ớt nursery line and the tips tell the transplant round.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/handbook.ts lib/game/farm/messages.ts tests/unit/farm-handbook.test.ts tests/unit/farm-messages.test.ts
git commit -F <message file>
```

---

### Task 8: The CrabGame and TransplantGame rounds — seeded state machines

**Files:**
- Modify: `lib/game/farm/minigames.ts`
- Test: `tests/unit/farm-minigames.test.ts` (modify)

**Interfaces:**
- Consumes: v15.2's `minigames.ts` conventions (a seeded PRNG, `dtSec` clamped to 50 ms, an input edge judged at the frame's end).
- Produces:
  - **CrabRound** (R17): `CRAB` (3 tries, periods 1.2 / 0.95 / 0.75 s, closed for the last 40 % of a cycle, a 0.6 s lead-in, a slip after 4 cycles, a 0.5 s beat), `CrabMark` and `CRAB_MARK` ("Bắt được!", "Á! Bị cua kẹp", "Cua chui mất"), `CrabRound { phases, tries (the marks so far), hits, stage: "lead" | "claws" | "beat", stageMs, elapsedMs, outcome: "done" | null }`, `crabClosed(periodMs, phaseMs, tMs)`, `createCrabRound(seed)`, `stepCrabRound(s, dtSec, grab)`; the hits are 0–3 by construction, in 3.3–14.9 s;
  - **TransplantRound** (R18): `TRANSPLANT` (12 hills, a 1.4 s sweep, bands ±0.08 / ±0.18 around a centre in [0.35, 0.65], a 1 s lead-in, a 0.25 s beat, a pass at 6), `TransplantMark`, `transplantMarkText(mark, ot)` ("Thẳng hàng!", "Được", "Lệch hàng", "Bỏ sót khóm" / "Bỏ sót cây"), `TransplantHill { x, centre, mark, score }`, `TransplantRound { centres, hills, score, stage: "lead" | "sweep" | "beat", stageMs, x, elapsedMs, outcome: "pass" | "fail" | null }`, `scoreHill(x, centre)`, `createTransplantRound(seed)`, `stepTransplantRound(s, dtSec, press)`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-minigames.test.ts — edit 1 of 2.** Replace:

```ts
import {
  createHarvestRound, HARVEST, HARVEST_MARK, scoreRelease, scoreText, stepHarvestRound, type HarvestRound,
} from "@/lib/game/farm/minigames";
```

with:

```ts
import {
  crabClosed, CRAB, CRAB_MARK, createCrabRound, createHarvestRound, createTransplantRound, HARVEST, HARVEST_MARK, scoreHill, scoreRelease,
  scoreText, stepCrabRound, stepHarvestRound, stepTransplantRound, TRANSPLANT, transplantMarkText, type CrabRound, type HarvestRound,
  type TransplantRound,
} from "@/lib/game/farm/minigames";
```

**tests/unit/farm-minigames.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
/** Plays a crab game at `dt` seconds a frame, grabbing when `grab(state)` says so (only a frame in the claws matters). */
function crab(seed: number, grab: (s: CrabRound) => boolean, dt = 0.05, start?: Partial<CrabRound>): CrabRound {
  let s: CrabRound = { ...createCrabRound(seed), ...start };
  for (let f = 0; f < 100_000 && !s.outcome; f++) s = stepCrabRound(s, dt, grab(s));
  return s;
}
/** The claws' state in the frame after this one, when a grab would be judged. */
const nextClosed = (s: CrabRound, dt = 0.05) => crabClosed(CRAB.periodsMs[s.tries.length], s.phases[s.tries.length], s.stageMs + dt * 1000);

describe("CrabRound (v15.3 §7.2, R17)", () => {
  it("seeds a phase in [0, P) for each of the 3 tries", () => {
    const s = createCrabRound(4);
    expect(s).toMatchObject({ tries: [], hits: 0, stage: "lead", stageMs: 0, elapsedMs: 0, outcome: null });
    expect(CRAB.periodsMs).toEqual([1200, 950, 750]);
    s.phases.forEach((p, i) => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(CRAB.periodsMs[i]);
    });
    expect(createCrabRound(4)).toEqual(s);
    expect(createCrabRound(5).phases).not.toEqual(s.phases);
  });
  it("opens the claws for the first 60 % of each cycle and closes them for the last 40 %", () => {
    expect([0, 719, 720, 1199, 1200, 1920].map((t) => crabClosed(1200, 0, t))).toEqual([false, false, true, true, false, true]);
    expect([219, 220, 699, 700].map((t) => crabClosed(1200, 500, t))).toEqual([false, true, true, false]);
    expect([569, 570, 749].map((t) => crabClosed(950, 0, t))).toEqual([false, true, true]);
    expect([449, 450].map((t) => crabClosed(750, 0, t))).toEqual([false, true]);
  });
  it("ignores a grab in the 0.6 s lead-in and in the 0.5 s beat", () => {
    let s = createCrabRound(1);
    for (let i = 0; i < 11; i++) s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "lead", tries: [] });
    s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "claws", stageMs: 0, tries: [] });
    s = stepCrabRound(s, 0.05, true);
    expect(s.tries).toHaveLength(1);
    expect(s).toMatchObject({ stage: "beat" });
    for (let i = 0; i < 9; i++) s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "beat", tries: [expect.anything()] });
    s = stepCrabRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "lead", tries: [expect.anything()] });
  });
  it("scores a grab: a hit while closed, a pinch while open; no grab in 4 cycles is a slip", () => {
    const hits = crab(2, (s) => s.stage === "claws" && nextClosed(s));
    expect(hits.tries).toEqual(["hit", "hit", "hit"]);
    expect([hits.hits, hits.outcome]).toEqual([3, "done"]);
    const pinches = crab(2, (s) => s.stage === "claws" && !nextClosed(s));
    expect([pinches.tries, pinches.hits]).toEqual([["pinch", "pinch", "pinch"], 0]);
    const none = crab(2, () => false);
    expect([none.tries, none.hits]).toEqual([["slip", "slip", "slip"], 0]);
    expect(CRAB_MARK).toEqual({ hit: "Bắt được!", pinch: "Á! Bị cua kẹp", slip: "Cua chui mất" });
  });
  it("judges a grab at the open/closed edge on the claws' clock", () => {
    const at = (ms: number) => crab(0, (s) => s.stage === "claws" && s.stageMs + 1 >= ms && s.tries.length === 0, 0.001,
      { phases: [0, 0, 0] }).tries[0];
    expect([at(719), at(720)]).toEqual(["pinch", "hit"]);
  });
  it("counts 0–3 hits whatever the input", () => {
    let rng = 7;
    for (let game = 0; game < 200; game++) {
      const s = crab(game, () => {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        return rng % 7 === 0;
      }, 0.01 + (game % 5) * 0.01);
      expect(s.outcome).toBe("done");
      expect(s.hits).toBe(s.tries.filter((t) => t === "hit").length);
      expect(s.hits).toBeGreaterThanOrEqual(0);
      expect(s.hits).toBeLessThanOrEqual(3);
    }
  });
  it("takes 3.3 s at the least and 14.9 s at the most", () => {
    const fast = crab(3, (s) => s.stage === "claws", 0.001);
    expect(fast.elapsedMs).toBeGreaterThanOrEqual(3300);
    expect(fast.elapsedMs).toBeLessThan(3310);
    expect(crab(3, () => false).elapsedMs).toBeCloseTo(14_900, 6);
  });
  it("clamps a long frame to 50 ms, and stays put once done", () => {
    const s = stepCrabRound(createCrabRound(1), 3, false);
    expect(s.elapsedMs).toBeCloseTo(50, 6);
    const done = crab(1, () => false);
    expect(stepCrabRound(done, 0.05, true)).toBe(done);
  });
});

/** Plays a transplant round, pressing when the hand reaches `aim(centre, hill)` (null: never). */
function transplant(seed: number, aim: (c: number, i: number) => number | null, dt = 0.05): TransplantRound {
  let s = createTransplantRound(seed);
  for (let f = 0; f < 100_000 && !s.outcome; f++) {
    const a = s.stage === "sweep" ? aim(s.centres[s.hills.length], s.hills.length) : null;
    s = stepTransplantRound(s, dt, a !== null && s.x + (dt * 1000) / TRANSPLANT.sweepMs >= a);
  }
  return s;
}

describe("TransplantRound (v15.3 §8.2, R18)", () => {
  it("seeds 12 bands centred in [0.35, 0.65]", () => {
    const s = createTransplantRound(7);
    expect(s).toMatchObject({ hills: [], score: 0, stage: "lead", x: 0, elapsedMs: 0, outcome: null });
    expect(s.centres).toHaveLength(TRANSPLANT.hills);
    for (const c of s.centres) {
      expect(c).toBeGreaterThanOrEqual(0.35);
      expect(c).toBeLessThanOrEqual(0.65);
    }
    expect(createTransplantRound(7)).toEqual(s);
    expect(createTransplantRound(8).centres).not.toEqual(s.centres);
  });
  it("scores chuẩn within 0.08 of the centre, được within 0.18, else lệch", () => {
    expect(scoreHill(0.5, 0.5)).toEqual({ mark: "chuan", score: 1 });
    expect([scoreHill(0.58, 0.5), scoreHill(0.42, 0.5)].map((h) => h.mark)).toEqual(["chuan", "chuan"]);
    expect([scoreHill(0.59, 0.5), scoreHill(0.68, 0.5), scoreHill(0.32, 0.5)].map((h) => h.score)).toEqual([0.5, 0.5, 0.5]);
    expect([scoreHill(0.69, 0.5), scoreHill(0.31, 0.5)]).toEqual([{ mark: "lech", score: 0 }, { mark: "lech", score: 0 }]);
  });
  it("sweeps the hand from 0 to 1 in 1.4 s after a 1 s lead-in; a hill with no press is bỏ sót", () => {
    let s = createTransplantRound(2);
    for (let i = 0; i < 20; i++) s = stepTransplantRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "sweep", x: 0, hills: [] });
    for (let i = 0; i < 14; i++) s = stepTransplantRound(s, 0.05, false);
    expect(s.x).toBeCloseTo(0.5, 9);
    for (let i = 0; i < 14; i++) s = stepTransplantRound(s, 0.05, false);
    expect(s.hills).toEqual([{ x: null, centre: s.centres[0], mark: "sot", score: 0 }]);
    expect(s).toMatchObject({ stage: "beat" });
  });
  it("ignores a press in the lead-in and in the 0.25 s beat", () => {
    let s = createTransplantRound(3);
    for (let i = 0; i < 20; i++) s = stepTransplantRound(s, 0.05, true);
    s = stepTransplantRound(s, 0.05, true);
    expect(s.hills).toHaveLength(1);
    for (let i = 0; i < 4; i++) s = stepTransplantRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "beat" });
    expect(s.hills).toHaveLength(1);
    s = stepTransplantRound(s, 0.05, true);
    expect(s).toMatchObject({ stage: "sweep", x: 0 });
    expect(s.hills).toHaveLength(1);
  });
  it("needs 6 points of 12: 5,5 fails, 6 passes", () => {
    const six = transplant(5, (c, i) => (i < 6 ? c : null));
    expect([six.score, six.outcome]).toEqual([6, "pass"]);
    const half = transplant(5, (c, i) => (i < 5 ? c : i === 5 ? c + 0.12 : null));
    expect(half.hills.map((h) => h.mark)).toEqual([...Array(5).fill("chuan"), "duoc", ...Array(6).fill("sot")]);
    expect([half.score, scoreText(half.score), half.outcome]).toEqual([5.5, "5,5", "fail"]);
  });
  it("takes about 12 s when played well, 4 s at the least and under 21 s at the most", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = transplant(seed, (c) => c);
      expect(s.score).toBe(12);
      expect(s.elapsedMs).toBeGreaterThan(9_000);
      expect(s.elapsedMs).toBeLessThan(15_000);
    }
    const fast = transplant(1, () => 0, 0.001);
    expect(fast.elapsedMs).toBeGreaterThanOrEqual(4_000);
    expect(fast.elapsedMs).toBeLessThan(4_020);
    const idle = transplant(1, () => null);
    expect([idle.score, idle.outcome]).toEqual([0, "fail"]);
    expect(idle.elapsedMs).toBeCloseTo(20_800, 6);
  });
  it("names the marks, the ớt round with cây", () => {
    expect(["chuan", "duoc", "lech", "sot"].map((m) => transplantMarkText(m as "chuan", false)))
      .toEqual(["Thẳng hàng!", "Được", "Lệch hàng", "Bỏ sót khóm"]);
    expect(transplantMarkText("sot", true)).toBe("Bỏ sót cây");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-minigames.test.ts`
Expected: FAIL — the 15 new tests fail (`createCrabRound is not a function`, `crabClosed is not a function`, `createTransplantRound is not a function`); the 9 HarvestGame tests pass.

- [ ] **Step 3: Implement**

**lib/game/farm/minigames.ts — edit 1 of 2.** Replace:

```ts

// The field's minigames (v15.2 §6.2, R17): pure state machines, deterministic for a seed, driven by thin overlays.
//
```

with:

```ts

// The field's minigames (v15.2 §6.2, R17; v15.3 §7.2, §8.2): pure state machines, deterministic for a seed, driven by
// thin overlays.
//
```

**lib/game/farm/minigames.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
// CrabGame's round (v15.3 §7.2, R17): 3 tries. Each opens with a 0.6 s lead-in, then the claws cycle — open for the
// first 60 % of a period, closed for the last 40 %, from a seeded phase — with periods of 1.2, 0.95 and 0.75 s. A grab
// ends the try: while closed a hit, while open a pinch (that crab is lost); no grab in 4 cycles is a slip. A 0.5 s beat
// follows each try. The lead-in and the beat ignore input.

export const CRAB = {
  tries: 3,
  periodsMs: [1200, 950, 750],
  /** The claws are open for this share of a cycle, then closed. */
  openShare: 0.6,
  leadMs: 600,
  /** A try without a grab ends after this many cycles. */
  cycles: 4,
  beatMs: 500,
  maxDt: 0.05,
} as const;

export type CrabMark = "hit" | "pinch" | "slip";
export const CRAB_MARK: Record<CrabMark, string> = { hit: "Bắt được!", pinch: "Á! Bị cua kẹp", slip: "Cua chui mất" };

export interface CrabRound {
  /** Each try's seeded phase, in [0, its period). */
  phases: readonly number[];
  /** The marks of the tries done (0–3). */
  tries: CrabMark[];
  hits: number;
  stage: "lead" | "claws" | "beat";
  /** Time spent in the stage. */
  stageMs: number;
  elapsedMs: number;
  outcome: "done" | null;
}

/** The claws at `tMs` into a try: closed in the last 40 % of each cycle. */
export function crabClosed(periodMs: number, phaseMs: number, tMs: number): boolean {
  return (phaseMs + tMs) % periodMs >= CRAB.openShare * periodMs - 1e-9;
}

export function createCrabRound(seed: number): CrabRound {
  const phases: number[] = [];
  let rng = seed | 0;
  for (const p of CRAB.periodsMs) {
    const [u, next] = nextRandom(rng);
    rng = next;
    phases.push(u * p);
  }
  return { phases, tries: [], hits: 0, stage: "lead", stageMs: 0, elapsedMs: 0, outcome: null };
}

/** One frame: `dtSec` is clamped to [0, 50 ms]; `grab` is a press since the last frame. */
export function stepCrabRound(s: CrabRound, dtSec: number, grab: boolean): CrabRound {
  if (s.outcome) return s;
  const dtMs = Math.min(CRAB.maxDt, Math.max(0, dtSec)) * 1000;
  const elapsedMs = s.elapsedMs + dtMs, t = s.stageMs + dtMs;
  if (s.stage === "lead") {
    return t >= CRAB.leadMs ? { ...s, stage: "claws", stageMs: t - CRAB.leadMs, elapsedMs } : { ...s, stageMs: t, elapsedMs };
  }
  if (s.stage === "claws") {
    const i = s.tries.length, period = CRAB.periodsMs[i];
    const mark: CrabMark | null = grab ? (crabClosed(period, s.phases[i], t) ? "hit" : "pinch") : t >= CRAB.cycles * period ? "slip" : null;
    if (!mark) return { ...s, stageMs: t, elapsedMs };
    return { ...s, tries: [...s.tries, mark], hits: s.hits + (mark === "hit" ? 1 : 0), stage: "beat", stageMs: 0, elapsedMs };
  }
  if (t < CRAB.beatMs) return { ...s, stageMs: t, elapsedMs };
  return s.tries.length >= CRAB.tries
    ? { ...s, stageMs: t, elapsedMs, outcome: "done" }
    : { ...s, stage: "lead", stageMs: t - CRAB.beatMs, elapsedMs };
}

// TransplantGame's round (v15.3 §8.2, R18): a 1 s lead-in, then 12 hills. For each, a hand sweeps x from 0 to 1 in
// 1.4 s over a seeded band centred in [0.35, 0.65]; a press plants the hill there. A 0.25 s beat follows each hill; the
// lead-in and the beat ignore input. A score of 6 or more passes.

export const TRANSPLANT = {
  hills: 12,
  leadMs: 1000,
  sweepMs: 1400,
  centreMin: 0.35,
  centreMax: 0.65,
  /** |x − centre| up to this is chuẩn (1 point), up to `near` được (0.5). */
  exact: 0.08,
  near: 0.18,
  beatMs: 250,
  pass: 6,
  maxDt: 0.05,
} as const;

export type TransplantMark = "chuan" | "duoc" | "lech" | "sot";
const TRANSPLANT_MARK: Record<TransplantMark, string> = { chuan: "Thẳng hàng!", duoc: "Được", lech: "Lệch hàng", sot: "Bỏ sót khóm" };
/** A hill's mark; the ớt round says "cây" for "khóm". */
export function transplantMarkText(mark: TransplantMark, ot: boolean): string {
  return ot && mark === "sot" ? "Bỏ sót cây" : TRANSPLANT_MARK[mark];
}

export interface TransplantHill { x: number | null; centre: number; mark: TransplantMark; score: number }

export interface TransplantRound {
  /** The 12 bands' centres. */
  centres: readonly number[];
  hills: TransplantHill[];
  score: number;
  stage: "lead" | "sweep" | "beat";
  stageMs: number;
  /** The hand, 0–1 across the row (0 outside a sweep). */
  x: number;
  elapsedMs: number;
  outcome: "pass" | "fail" | null;
}

/** Scores a press at `x` against a band centred at `centre` (the boundaries count, up to rounding). */
export function scoreHill(x: number, centre: number): { mark: TransplantMark; score: number } {
  const d = Math.abs(x - centre);
  if (d <= TRANSPLANT.exact + 1e-9) return { mark: "chuan", score: 1 };
  if (d <= TRANSPLANT.near + 1e-9) return { mark: "duoc", score: 0.5 };
  return { mark: "lech", score: 0 };
}

export function createTransplantRound(seed: number): TransplantRound {
  const centres: number[] = [];
  let rng = seed | 0;
  for (let i = 0; i < TRANSPLANT.hills; i++) {
    const [u, next] = nextRandom(rng);
    rng = next;
    centres.push(TRANSPLANT.centreMin + u * (TRANSPLANT.centreMax - TRANSPLANT.centreMin));
  }
  return { centres, hills: [], score: 0, stage: "lead", stageMs: 0, x: 0, elapsedMs: 0, outcome: null };
}

/** One frame: `dtSec` is clamped to [0, 50 ms]; `press` is a press since the last frame. */
export function stepTransplantRound(s: TransplantRound, dtSec: number, press: boolean): TransplantRound {
  if (s.outcome) return s;
  const dtMs = Math.min(TRANSPLANT.maxDt, Math.max(0, dtSec)) * 1000;
  const elapsedMs = s.elapsedMs + dtMs, t = s.stageMs + dtMs;
  if (s.stage === "lead") {
    return t >= TRANSPLANT.leadMs ? { ...s, stage: "sweep", stageMs: t - TRANSPLANT.leadMs, x: 0, elapsedMs } : { ...s, stageMs: t, elapsedMs };
  }
  if (s.stage === "sweep") {
    const x = Math.min(1, t / TRANSPLANT.sweepMs), centre = s.centres[s.hills.length];
    if (!press && x < 1) return { ...s, stageMs: t, x, elapsedMs };
    const hill: TransplantHill = press ? { x, centre, ...scoreHill(x, centre) } : { x: null, centre, mark: "sot", score: 0 };
    return { ...s, hills: [...s.hills, hill], score: s.score + hill.score, stage: "beat", stageMs: 0, x: 0, elapsedMs };
  }
  if (t < TRANSPLANT.beatMs) return { ...s, stageMs: t, elapsedMs };
  return s.hills.length >= TRANSPLANT.hills
    ? { ...s, stageMs: t, elapsedMs, outcome: s.score >= TRANSPLANT.pass ? "pass" : "fail" }
    : { ...s, stage: "sweep", stageMs: t - TRANSPLANT.beatMs, x: 0, elapsedMs };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (24 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/farm/minigames.ts tests/unit/farm-minigames.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): the CrabGame and TransplantGame rounds — seeded state machines

CrabRound: 3 tries, each a 0.6 s lead-in, then claws that cycle every 1.2, 0.95 and
0.75 s, open for 60 % of a cycle and closed for the last 40 %; a grab while closed is a
hit, while open a pinch, and 4 cycles without one a slip; a 0.5 s beat follows. The
hits are 0–3 by construction, in 3.3–14.9 s. TransplantRound: a 1 s lead-in, then 12
hills a hand sweeps across in 1.4 s, chuẩn within 0.08 of the band, được within 0.18,
a 0.25 s beat; 6 points pass, in 4–21 s.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/farm/minigames.ts tests/unit/farm-minigames.test.ts
git commit -F <message file>
```

---

### Task 9: The art — six icons, holes and beds on the canal, the ready cues and both overlays' scenes

**Files:**
- Create: `lib/game/art/gather-art.ts`
- Modify: `lib/game/art/farm-icons.ts`, `lib/game/maps/field-art.ts`, `lib/game/engine.ts`, `components/game/GameCanvas.tsx`
- Test: `tests/unit/game-gather-art.test.ts` (create); `tests/unit/game-farm-icons.test.ts`, `tests/unit/game-canvas-input.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 6's `CRAB_HOLES`, `SNAIL_BEDS` and interactables; Task 8's `CrabMark`, `TransplantHill`; v15.2's `FARM_ICONS` / `iconMatrixFor`, the field background painter, the engine's `drawPlots`, the canvas handle.
- Produces:
  - `farm-icons.ts`: 16 × 16 icons for `box_bucket`, `box_basket`, `cua_dong`, `cua_gach` (belly-up, the roe showing), `oc_dong`, `oc_buou_vang` in §15's colours;
  - `gather-art.ts` (NEW, pure painters over `Paint = Pick<CanvasRenderingContext2D, "fillStyle" | "globalAlpha" | "fillRect">`): `paintHole(c, rect)` and `paintBed(c, rect)` for the background; `drawHoleCue(c, x, y, t, reduced)` (eye stalks, a claw tip and a rising bubble) and `drawBedCue(c, x, y, t, reduced)` (glinting shells); `CRAB_SCENE` 96 × 64, `CrabView { closed, lurking, mark, t, reduced }`, `drawCrabScene(c, v)` (claws open with a red outline, closed with a green one; the hand hovers, dips on a grab, jerks back with "!" on a pinch; no shake or splash under reduced motion); `TRANSPLANT_SCENE` 160 × 48, `TransplantView { hills, centre, x, ot, t, reduced }`, `hillX(i)`, `GUIDE_Y`, `drawTransplantScene(c, v)` (mud with a sheen, the guide line, 12 slots, the band at 35 % with its chuẩn core at 55 %, a lệch hill 2 px off the line, the hand with a tied bunch, rounder ớt leaves);
  - `field-art.ts` paints the holes and beds after the bridges; `GameEngine.setGatherSpots(spots: { id, ready }[])` draws a cue on each ready hole and bed after the plots; `GameCanvasHandle.setGatherSpots` passes the spots on at once and to the engine of the next map (beside v16's `setCardTables`).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-gather-art.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import {
  CRAB_SCENE, drawBedCue, drawCrabScene, drawHoleCue, drawTransplantScene, GUIDE_Y, hillX, paintBed, paintHole, TRANSPLANT_SCENE,
  type CrabView, type Paint, type TransplantView,
} from "@/lib/game/art/gather-art";
import type { TransplantHill } from "@/lib/game/farm/minigames";
import { CRAB_HOLES, SNAIL_BEDS } from "@/lib/game/maps/field";
import type { Rect } from "@/lib/game/maps/types";

type Op = { fill: string; alpha: number; x: number; y: number; w: number; h: number };

/** A 2D context that records each fill with its colour and alpha. */
function recorder(): { c: Paint; ops: Op[] } {
  const ops: Op[] = [];
  const c: Paint = {
    fillStyle: "",
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number, h: number) {
      ops.push({ fill: String(c.fillStyle), alpha: c.globalAlpha, x, y, w, h });
    },
  };
  return { c, ops };
}
const of = (ops: readonly Op[], fill: string) => ops.filter((o) => o.fill === fill);
const inside = (ops: readonly Op[], r: Rect) =>
  ops.every((o) => o.x >= r.x && o.y >= r.y && o.x + o.w <= r.x + r.w && o.y + o.h <= r.y + r.h);
const whole = (ops: readonly Op[]) => ops.every((o) => [o.x, o.y, o.w, o.h].every(Number.isInteger));

describe("the field's holes and beds (v15.3 §15)", () => {
  it("digs each hole: a 10 × 6 burrow in its rim, in bank mud, with 2–3 pellets, inside its rect", () => {
    for (const r of CRAB_HOLES) {
      const { c, ops } = recorder();
      paintHole(c, r);
      expect(inside(ops, r)).toBe(true);
      expect(of(ops, "#3a2a1a").map((o) => [o.w, o.h])).toEqual([[10, 6]]);
      expect(of(ops, "#5a4128")).toHaveLength(1);
      expect(of(ops, "#6e5230").length).toBeGreaterThan(0);
      expect(of(ops, "#7a5c38").length).toBeGreaterThanOrEqual(2);
      expect(of(ops, "#7a5c38").length).toBeLessThanOrEqual(3);
    }
  });
  it("lays each bed across the water's edge: sand under light water, hyacinth leaves and two stones, inside its rect", () => {
    for (const r of SNAIL_BEDS) {
      const { c, ops } = recorder();
      paintBed(c, r);
      expect([r.w, r.h]).toEqual([20, 10]);
      expect(inside(ops, r)).toBe(true);
      for (const col of ["#8cc3d6", "#c9b58a", "#4f9a38", "#6fbf4a"]) expect(of(ops, col).length, col).toBeGreaterThan(0);
      expect(of(ops, "#d9d2c0")).toHaveLength(2);
    }
  });
});

describe("the cues on a spot ready for me (v15.3 §15)", () => {
  const hole = (t: number, reduced = false) => {
    const { c, ops } = recorder();
    drawHoleCue(c, 100, 50, t, reduced);
    return ops;
  };
  const bed = (t: number, reduced = false) => {
    const { c, ops } = recorder();
    drawBedCue(c, 10, 20, t, reduced);
    return ops;
  };
  it("peeks a crab out of a hole, two eye stalks and a claw tip, with a bubble rising every 1.5 s", () => {
    expect(of(hole(0), "#2a2f3a")).toHaveLength(2);
    expect(of(hole(0), "#b8432f")).toHaveLength(1);
    const bubble = (t: number, reduced = false) => of(hole(t, reduced), "#e8f4f8")[0].y;
    expect(bubble(0)).not.toBe(bubble(1000));
    expect(bubble(200)).toBe(bubble(1700));
    expect(new Set([0, 400, 900, 1400].map((t) => bubble(t, true))).size).toBe(1);
  });
  it("glints 2–3 shells on a bed, ốc đồng and ốc bươu vàng, one at a time", () => {
    const shells = of(bed(0), "#4a3a22").length + of(bed(0), "#c9955a").length;
    expect(shells).toBeGreaterThanOrEqual(2);
    expect(shells).toBeLessThanOrEqual(3);
    expect(of(bed(0), "#c9955a").length).toBeGreaterThan(0);
    const glint = (t: number, reduced = false) => {
      const g = of(bed(t, reduced), "#e8f4f8")[0];
      return `${g.x},${g.y}`;
    };
    expect(glint(0)).not.toBe(glint(600));
    expect(new Set([0, 600, 1200].map((t) => glint(t, true))).size).toBe(1);
  });
});

describe("CrabGame's scene (v15.3 §15)", () => {
  const scene = (v: Partial<CrabView> = {}) => {
    const { c, ops } = recorder();
    drawCrabScene(c, { closed: false, lurking: false, mark: null, t: 0, reduced: false, ...v });
    return ops;
  };
  it("fills its 96 × 64 and no more, on whole pixels", () => {
    expect(CRAB_SCENE).toEqual({ w: 96, h: 64 });
    for (const v of [{}, { closed: true }, { lurking: true }, { mark: "hit" as const }, { mark: "pinch" as const, t: 700 }]) {
      const ops = scene(v);
      expect(inside(ops, { x: 0, y: 0, ...CRAB_SCENE })).toBe(true);
      expect(whole(ops)).toBe(true);
    }
  });
  it("outlines the claws red and spread wide when open, green and together when closed", () => {
    const open = scene(), closed = scene({ closed: true });
    expect(of(open, "#d8342a")).toHaveLength(2);
    expect(of(open, "#4caf50")).toHaveLength(0);
    expect(of(closed, "#4caf50")).toHaveLength(2);
    expect(of(closed, "#d8342a")).toHaveLength(0);
    const spread = (ops: Op[], col: string) => {
      const xs = of(ops, col).map((o) => o.x);
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(spread(open, "#d8342a")).toBeGreaterThan(2 * spread(closed, "#4caf50"));
    expect(of(open, "#6b5a2e").length).toBeGreaterThan(0);
  });
  it("keeps the crab low in the hole, its claws hidden, through the lead-in", () => {
    const lurk = scene({ lurking: true });
    expect(of(lurk, "#d8342a").length + of(lurk, "#4caf50").length).toBe(0);
    const shell = (ops: Op[]) => of(ops, "#6b5a2e").find((o) => o.w === 22)!.y;
    expect(shell(lurk)).toBeGreaterThan(shell(scene()));
  });
  it("dips the hand on a hit, and jerks it back with ! marks on a pinch", () => {
    const hand = (ops: Op[]) => of(ops, "#e0b089").find((o) => o.w === 12)!.y;
    const idle = scene({ reduced: true });
    expect(hand(scene({ mark: "hit", reduced: true }))).toBeGreaterThan(hand(idle));
    expect(hand(scene({ mark: "pinch", reduced: true }))).toBeLessThan(hand(idle));
    expect(of(scene({ mark: "pinch", reduced: true }), "#d8342a")).toHaveLength(of(idle, "#d8342a").length + 4);
  });
  it("shakes the open claws and hovers the hand, but not under reduced motion", () => {
    const ts = [0, 40, 80, 120, 160, 900];
    const claw = (t: number, reduced: boolean) => of(scene({ t, reduced }), "#d8342a")[0].x;
    expect(new Set(ts.map((t) => claw(t, false))).size).toBeGreaterThan(1);
    expect(new Set(ts.map((t) => claw(t, true))).size).toBe(1);
    const hand = (t: number, reduced: boolean) => of(scene({ t, reduced }), "#e0b089").find((o) => o.w === 12)!.y;
    expect(new Set(ts.map((t) => hand(t, true))).size).toBe(1);
  });
});

describe("TransplantGame's scene (v15.3 §15)", () => {
  const hill = (mark: TransplantHill["mark"]): TransplantHill => ({ x: mark === "sot" ? null : 0.5, centre: 0.5, mark, score: 0 });
  const scene = (v: Partial<TransplantView> = {}) => {
    const { c, ops } = recorder();
    drawTransplantScene(c, { hills: [], centre: 0.5, x: 0.3, ot: false, t: 0, reduced: false, ...v });
    return { ops, alpha: c.globalAlpha };
  };
  it("fills its 160 × 48 and no more, on whole pixels", () => {
    expect(TRANSPLANT_SCENE).toEqual({ w: 160, h: 48 });
    const hills = [hill("chuan"), hill("lech"), hill("sot"), ...Array.from({ length: 9 }, () => hill("duoc"))];
    for (const v of [{}, { centre: 0.35, x: 0 }, { centre: 0.65, x: 1, hills }, { ot: true, hills, t: 2500 }]) {
      const { ops } = scene(v);
      expect(inside(ops, { x: 0, y: 0, ...TRANSPLANT_SCENE })).toBe(true);
      expect(whole(ops)).toBe(true);
    }
  });
  it("draws the band at 35 % alpha around its chuẩn core at 55 %, then restores the alpha", () => {
    const { ops, alpha } = scene({ centre: 0.5 });
    const band = ops.filter((o) => o.alpha === 0.35), core = ops.filter((o) => o.alpha === 0.55);
    expect(band.map((o) => o.fill)).toEqual(["#6fbf4a"]);
    expect(core.map((o) => o.fill)).toEqual(["#6fbf4a"]);
    expect(core[0].w).toBeLessThan(band[0].w);
    const mid = (o: Op) => o.x + o.w / 2;
    expect(Math.abs(mid(core[0]) - mid(band[0]))).toBeLessThanOrEqual(1);
    expect(ops.filter((o) => ![1, 0.35, 0.55].includes(o.alpha))).toHaveLength(0);
    expect(alpha).toBe(1);
    expect(scene({ centre: null }).ops.filter((o) => o.alpha !== 1)).toHaveLength(0);
  });
  it("sets 12 slots on the guide line, a tuft for each hill set, a lệch one 2 px off the line, none for a sót", () => {
    expect(of(scene().ops, "#5a4128").filter((o) => o.w === 3 && o.h === 3)).toHaveLength(12);
    const stalks = of(scene({ hills: [hill("chuan"), hill("lech"), hill("sot"), hill("duoc")] }).ops, "#4f9a38");
    expect(stalks.map((o) => o.x)).toEqual([hillX(0), hillX(1), hillX(3)]);
    expect(stalks[0].y + stalks[0].h).toBe(GUIDE_Y);
    expect(stalks[1].y - stalks[0].y).toBe(2);
    expect(stalks[2].y).toBe(stalks[0].y);
  });
  it("moves the hand with its tied bunch along the sweep, and hides it outside one", () => {
    const hand = (x: number | null) => of(scene({ x }).ops, "#e0b089");
    expect(hand(0.2)[0].x).toBeLessThan(hand(0.8)[0].x);
    expect(of(scene({ x: 0.5 }).ops, "#8b5a33")).toHaveLength(1);
    expect(hand(null)).toHaveLength(0);
  });
  it("draws the ớt round's rounder leaves", () => {
    expect(of(scene({ ot: true, x: 0.5, hills: [hill("chuan")] }).ops, "#5caa4a").length).toBeGreaterThanOrEqual(3);
    expect(of(scene({ x: 0.5, hills: [hill("chuan")] }).ops, "#5caa4a")).toHaveLength(0);
  });
  it("lets the mud's sheen shimmer, but not under reduced motion", () => {
    const sheen = (t: number, reduced: boolean) => JSON.stringify(of(scene({ t, reduced }).ops, "#86683f"));
    expect(sheen(0, false)).not.toBe(sheen(500, false));
    expect(sheen(0, true)).toBe(sheen(500, true));
  });
});
```

**tests/unit/game-farm-icons.test.ts — edit 1 of 3.** Replace:

```ts
};
const seededItems = (): string[] => [...seeded("0013_v15_field.sql", "shop_items"), ...seeded("0016_v15_2_crops.sql", "shop_items")];
```

with:

```ts
};
const seededItems = (): string[] => [
  ...seeded("0013_v15_field.sql", "shop_items"), ...seeded("0016_v15_2_crops.sql", "shop_items"), ...seeded("0018_v15_3_gather.sql", "shop_items"),
];
```

**tests/unit/game-farm-icons.test.ts — edit 2 of 3.** Replace:

```ts
  });
  it("cover every seeded farm item, the two rice sacks and each hoa-màu crop's produce", () => {
    const produce = seeded("0016_v15_2_crops.sql", "upland_crops").map((u) => `produce_${u}`);
    expect(produce).toEqual(["produce_khoai", "produce_bap", "produce_ot"]);
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet", ...produce].sort());
  });
```

with:

```ts
  });
  it("cover every seeded farm item, the two rice sacks, each hoa-màu crop's produce and each critter kind", () => {
    const produce = seeded("0016_v15_2_crops.sql", "upland_crops").map((u) => `produce_${u}`);
    expect(produce).toEqual(["produce_khoai", "produce_bap", "produce_ot"]);
    const critters = seeded("0018_v15_3_gather.sql", "critter_kinds");
    expect(critters).toEqual(["cua_dong", "cua_gach", "oc_dong", "oc_buou_vang"]);
    expect(seeded("0018_v15_3_gather.sql", "shop_items")).toEqual(["box_bucket", "box_basket"]);
    expect(Object.keys(FARM_ICONS).sort()).toEqual([...seededItems(), "rice_dry", "rice_wet", ...produce, ...critters].sort());
  });
```

**tests/unit/game-farm-icons.test.ts — edit 3 of 3.** Replace:

```ts
    expect(iconMatrixFor("produce_ot")?.flat()).toContain("#d8342a");
  });
```

with:

```ts
    expect(iconMatrixFor("produce_ot")?.flat()).toContain("#d8342a");
  });
  it("draw the v15.3 containers and critters in their colours (§15)", () => {
    const colours: Record<string, string[]> = {
      box_bucket: ["#3d6fd1", "#2f56a6", "#d9d9e0"],
      box_basket: ["#c8a46a", "#9a7a44"],
      cua_dong: ["#6b5a2e", "#8e7a44", "#b8432f"],
      cua_gach: ["#e0662f", "#f29b4a", "#b8432f"],
      oc_dong: ["#4a3a22", "#8a6a3f"],
      oc_buou_vang: ["#c9955a", "#8a5a2b", "#f29bb5"],
    };
    for (const [id, cols] of Object.entries(colours)) expect(iconMatrixFor(id)?.flat(), id).toEqual(expect.arrayContaining(cols));
    // the cua gạch lies belly-up: no eyes, the roe instead
    expect(iconMatrixFor("cua_dong")?.flat()).toContain("#2a2f3a");
    expect(iconMatrixFor("cua_gach")?.flat()).not.toContain("#2a2f3a");
  });
```

**tests/unit/game-canvas-input.test.tsx — edit 1 of 4.** Replace:

```tsx

// One fake engine and channel per world: they record what the canvas tells them (input lock, plots, farm
// animations, messages, hellos and byes) and let a test deliver messages.
type EngineRec = {
  mapId: string; input: boolean[]; plots: unknown[]; cards: unknown[]; anims: number[]; applied: unknown[]; hellos: string[];
  removed: string[]; destroyed: boolean;
};
```

with:

```tsx

// One fake engine and channel per world: they record what the canvas tells them (input lock, plots, card labels,
// gathering cues, farm animations, messages, hellos and byes) and let a test deliver messages.
type EngineRec = {
  mapId: string; input: boolean[]; plots: unknown[]; cards: unknown[]; spots: unknown[]; anims: number[]; applied: unknown[];
  hellos: string[]; removed: string[]; destroyed: boolean;
};
```

**tests/unit/game-canvas-input.test.tsx — edit 2 of 4.** Replace:

```tsx
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], cards: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false };
      engines.push(this.rec);
```

with:

```tsx
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = {
        mapId: map.id, input: [], plots: [], cards: [], spots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false,
      };
      engines.push(this.rec);
```

**tests/unit/game-canvas-input.test.tsx — edit 3 of 4.** Replace:

```tsx
      this.rec.cards.push(labels);
    }
```

with:

```tsx
      this.rec.cards.push(labels);
    }
    setGatherSpots(spots: unknown) {
      this.rec.spots.push(spots);
    }
```

**tests/unit/game-canvas-input.test.tsx — edit 4 of 4.** Replace:

```tsx

describe("GameCanvas farm messages", () => {
```

with:

```tsx

describe("GameCanvas gathering cues across travel (v15.3 §13.1)", () => {
  it("passes the spots on at once and gives them to the next map's engine", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="field" {...props} />);
    const spots = [{ id: "crab_1", ready: true }, { id: "bed_2", ready: false }];
    ref.current!.setGatherSpots(spots);
    expect(engines[0].spots.at(-1)).toBe(spots);
    rerender(<GameCanvas ref={ref} mapId="pond" {...props} />);
    rerender(<GameCanvas ref={ref} mapId="field" {...props} />);
    expect(engines[2].spots.at(-1)).toBe(spots);
  });
});

describe("GameCanvas farm messages", () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-canvas-input.test.tsx tests/unit/game-farm-icons.test.ts tests/unit/game-gather-art.test.ts`
Expected: FAIL — `game-gather-art.test.ts` cannot load `@/lib/game/art/gather-art`, the icons lack the containers and critters, and the canvas handle has no `setGatherSpots` (`ref.current.setGatherSpots is not a function`); 3 tests fail, 15 pass.

- [ ] **Step 3: Implement**

Create `lib/game/art/gather-art.ts` with exactly:

```ts
import { TRANSPLANT, type CrabMark, type TransplantHill } from "@/lib/game/farm/minigames";
import type { Rect } from "@/lib/game/maps/types";

// v15.3 art (spec §15), drawn in code: the crab holes and snail beds on the field's background, the cues the engine
// draws on a spot ready for me, and the scenes of the two overlays, CrabGame (96 × 64) and TransplantGame (160 × 48),
// which their components draw at an integer scale. Original art.

/** What these painters need of a 2D context (a test records it). */
export type Paint = Pick<CanvasRenderingContext2D, "fillStyle" | "globalAlpha" | "fillRect">;

const K = {
  // the background
  bankMud: "#6e5230", burrow: "#3a2a1a", rim: "#5a4128", pellet: "#7a5c38",
  sand: "#c9b58a", shallow: "#8cc3d6", leaf: "#4f9a38", leafLight: "#6fbf4a", stone: "#d9d2c0",
  // the cues
  eye: "#2a2f3a", claw: "#b8432f", bubble: "#e8f4f8", ocDong: "#4a3a22", ocBuou: "#c9955a",
  // CrabGame
  carapace: "#6b5a2e", carapaceLight: "#8e7a44", open: "#d8342a", closed: "#4caf50", hand: "#e0b089", handDark: "#c08e68",
  // TransplantGame
  mud: "#6e5230", sheen: "#86683f", guide: "#5a4128", tuft: "#6fbf4a", tuftDark: "#4f9a38", tie: "#8b5a33", chili: "#5caa4a",
} as const;

function box(c: Paint, col: string, x: number, y: number, w: number, h: number): void {
  c.fillStyle = col;
  c.fillRect(Math.round(x), Math.round(y), w, h);
}

// ---------------------------------------------------------------- the field's background (field-art.ts)

/** A crab hole in the bank (`r`, 16 × 10): a patch of bank mud, a 10 × 6 burrow in its rim, three mud pellets. */
export function paintHole(c: Paint, r: Rect): void {
  box(c, K.bankMud, r.x + 1, r.y, r.w - 2, r.h);
  box(c, K.bankMud, r.x, r.y + 1, r.w, r.h - 2);
  box(c, K.rim, r.x + 2, r.y + 1, 12, 8);
  box(c, K.burrow, r.x + 3, r.y + 2, 10, 6);
  for (const [dx, dy] of [[0, 2], [14, 1], [15, 7]]) box(c, K.pellet, r.x + dx, r.y + dy, 1, 1);
}

/** A snail bed across the water's edge (`r`, 20 × 10): sand under light water, water-hyacinth leaves at both ends and
 *  two pale stones. */
export function paintBed(c: Paint, r: Rect): void {
  box(c, K.shallow, r.x + 1, r.y, r.w - 2, r.h);
  box(c, K.shallow, r.x, r.y + 1, r.w, r.h - 2);
  for (let y = 1; y < r.h - 1; y++) for (let x = 2 + (y % 3); x < r.w - 2; x += 3) box(c, K.sand, r.x + x, r.y + y, 1, 1);
  box(c, K.stone, r.x + 6, r.y + 6, 2, 1);
  box(c, K.stone, r.x + 12, r.y + 2, 2, 2);
  for (const [dx, dy] of [[0, 3], [16, 5]]) {
    box(c, K.leaf, r.x + dx, r.y + dy, 4, 2);
    box(c, K.leafLight, r.x + dx + 1, r.y + dy - 1, 2, 1);
  }
}

// ---------------------------------------------------------------- the engine's cues (§13.1)

/** A hole ready for me, at its rect's corner on screen: two eye stalks and a claw tip peek out of the burrow, and a
 *  bubble rises every 1.5 s. Still under reduced motion. */
export function drawHoleCue(c: Paint, x: number, y: number, t: number, reduced: boolean): void {
  box(c, K.eye, x + 6, y + 3, 1, 3);
  box(c, K.eye, x + 9, y + 3, 1, 3);
  box(c, K.claw, x + 11, y + 5, 2, 1);
  const rise = reduced ? 3 : Math.floor(((t % 1500) / 1500) * 7);
  box(c, K.bubble, x + 8, y + 1 - rise, 1, 1);
}

/** A bed ready for me: three shells, two ốc đồng and an ốc bươu vàng, glinting one at a time. Still under reduced
 *  motion. */
export function drawBedCue(c: Paint, x: number, y: number, t: number, reduced: boolean): void {
  const shells: ReadonlyArray<[number, number, string]> = [[4, 4, K.ocDong], [10, 6, K.ocBuou], [14, 3, K.ocDong]];
  for (const [dx, dy, col] of shells) box(c, col, x + dx, y + dy, 2, 2);
  const [gx, gy] = shells[reduced ? 1 : Math.floor(t / 600) % shells.length];
  box(c, K.bubble, x + gx, y + gy, 1, 1);
}

// ---------------------------------------------------------------- CrabGame (§7.2, §13.2)

export const CRAB_SCENE = { w: 96, h: 64 } as const;

export interface CrabView {
  /** The claws: closed (a grab now is a hit) or open. */
  closed: boolean;
  /** The lead-in: the crab lurks low in the hole, its claws hidden. */
  lurking: boolean;
  /** The last try's end, shown through its beat: the hand dips on a hit, and jerks back with "!" on a pinch. */
  mark: CrabMark | null;
  t: number;
  reduced: boolean;
}

/** A claw: its outline (red when open, green when closed), the shell and the red tip. */
function claw(c: Paint, x: number, y: number, outline: string, tipLeft: boolean): void {
  box(c, outline, x - 1, y - 1, 12, 9);
  box(c, K.carapace, x, y, 10, 7);
  box(c, K.carapaceLight, x + 2, y + 1, 6, 2);
  box(c, K.claw, tipLeft ? x : x + 7, y, 3, 3);
}

/** The bank in cross-section with the hole's mouth; the crab, its claws spread wide when open and together when closed;
 *  the hand over it. Reduced motion keeps the claws, without the shake, the hover or the splash. */
export function drawCrabScene(c: Paint, v: CrabView): void {
  box(c, K.bankMud, 0, 0, CRAB_SCENE.w, CRAB_SCENE.h);
  for (let i = 0; i < 26; i++) box(c, K.pellet, (i * 37) % 92, 3 + ((i * 23) % 26), 2, 1);
  box(c, K.shallow, 0, 56, CRAB_SCENE.w, 8);
  box(c, K.rim, 22, 30, 52, 27);
  box(c, K.burrow, 24, 32, 48, 25);
  const shake = !v.reduced && !v.lurking && !v.closed ? Math.round(Math.sin(v.t / 45)) : 0;
  const cy = v.lurking ? 48 : 42;
  box(c, K.eye, 42 + shake, cy - 4, 1, 4);
  box(c, K.eye, 53 + shake, cy - 4, 1, 4);
  box(c, K.carapace, 37 + shake, cy, 22, 10);
  box(c, K.carapaceLight, 40 + shake, cy + 1, 16, 3);
  if (!v.lurking) {
    if (v.closed) {
      claw(c, 36, cy - 12, K.closed, false);
      claw(c, 50, cy - 12, K.closed, true);
    } else {
      claw(c, 16 + shake, cy - 7, K.open, true);
      claw(c, 70 + shake, cy - 7, K.open, false);
    }
  }
  const hover = v.reduced ? 0 : Math.round(Math.sin(v.t / 300) * 2);
  const hy = v.mark === "pinch" ? 2 : v.mark === "hit" ? 24 : 12 + hover;
  box(c, K.hand, 42, hy, 12, 9);
  for (let k = 0; k < 4; k++) box(c, k === 3 ? K.handDark : K.hand, 42 + k * 3, hy + 9, 2, 4);
  if (v.mark === "pinch") {
    for (const bx of [32, 62]) {
      box(c, K.open, bx, 3, 2, 5);
      box(c, K.open, bx, 10, 2, 2);
    }
  }
  if (v.mark === "hit" && !v.reduced) for (const [sx, sy] of [[30, 52], [66, 52], [38, 49], [58, 49]]) box(c, K.bubble, sx, sy, 2, 1);
}

// ---------------------------------------------------------------- TransplantGame (§8.2, §13.3)

export const TRANSPLANT_SCENE = { w: 160, h: 48 } as const;

export interface TransplantView {
  /** The hills set so far, in order. */
  hills: readonly TransplantHill[];
  /** The current hill's band centre, and the hand, 0–1 across the row (null outside a sweep). */
  centre: number | null;
  x: number | null;
  /** The ớt round: seedlings with rounder leaves. */
  ot: boolean;
  t: number;
  reduced: boolean;
}

/** The sweep's x (0–1) on the scene's track. */
const trackX = (x: number) => Math.round(8 + x * 144);
/** Hill i's slot on the guide line. */
export const hillX = (i: number) => 14 + i * 12;
export const GUIDE_Y = 34;

/** A seedling set at (x, y): a tuft of rice, or an ớt seedling's stem and rounder leaves. */
function seedling(c: Paint, x: number, y: number, ot: boolean): void {
  if (ot) {
    box(c, K.tuftDark, x, y - 5, 1, 5);
    box(c, K.chili, x - 3, y - 6, 3, 2);
    box(c, K.chili, x + 1, y - 8, 3, 2);
    return;
  }
  box(c, K.tuft, x - 2, y - 6, 1, 6);
  box(c, K.tuftDark, x, y - 8, 1, 8);
  box(c, K.tuft, x + 2, y - 6, 1, 6);
}

/** The mud with its sheen, the guide line and its 12 slots, the hills set (a lệch one 2 px off the line, none for a
 *  sót), the band at 35 % with its chuẩn core at 55 %, and the hand with its tied bunch. Reduced motion stills the
 *  sheen; the sweep is the round itself. */
export function drawTransplantScene(c: Paint, v: TransplantView): void {
  box(c, K.mud, 0, 0, TRANSPLANT_SCENE.w, TRANSPLANT_SCENE.h);
  const shimmer = v.reduced ? 0 : Math.floor(v.t / 400) % 3;
  for (let i = 0; i < 14; i++) box(c, K.sheen, 6 + ((i * 29) % 146) + shimmer, 24 + ((i * 7) % 20), 3, 1);
  const centre = v.centre;
  if (centre !== null) {
    const band = (half: number, alpha: number) => {
      const x0 = trackX(centre - half), x1 = trackX(centre + half);
      c.globalAlpha = alpha;
      box(c, K.tuft, x0, 3, x1 - x0, 12);
    };
    band(TRANSPLANT.near, 0.35);
    band(TRANSPLANT.exact, 0.55);
    c.globalAlpha = 1;
  }
  box(c, K.guide, 8, GUIDE_Y, 144, 1);
  for (let i = 0; i < TRANSPLANT.hills; i++) box(c, K.guide, hillX(i) - 1, GUIDE_Y - 1, 3, 3);
  v.hills.forEach((h, i) => {
    if (h.mark !== "sot") seedling(c, hillX(i), GUIDE_Y + (h.mark === "lech" ? 2 : 0), v.ot);
  });
  if (v.x !== null) {
    const hx = trackX(v.x);
    box(c, K.hand, hx - 3, 5, 7, 6);
    box(c, v.ot ? K.chili : K.tuft, hx - 1, 11, 3, 6);
    box(c, K.tie, hx - 1, 12, 3, 1);
  }
}
```

**lib/game/art/farm-icons.ts — edit 1 of 3.** Replace:

```ts

// 16×16 icons for the farm (spec §14, v15.2 §15): seed sacks in the variety's colour, fertilizer bags with their
// nutrient on the label, pesticide bottles with their pest, rice sacks (wet/dry); hoa-màu seeds, the sickle, the
// sprayer and the hoa màu itself. "." transparent, "o" outline, other letters from the icon's own palette. Original art.
```

with:

```ts

// 16×16 icons for the farm (spec §14, v15.2 §15, v15.3 §15): seed sacks in the variety's colour, fertilizer bags with
// their nutrient on the label, pesticide bottles with their pest, rice sacks (wet/dry); hoa-màu seeds, the sickle, the
// sprayer and the hoa màu itself; the critter containers and the critters. "." transparent, "o" outline, other letters
// from the icon's own palette. Original art.
```

**lib/game/art/farm-icons.ts — edit 2 of 3.** Replace:

```ts

export const FARM_ICONS: Record<string, PixelIcon> = {
```

with:

```ts

// v15.3: a plastic bucket and a woven bamboo basket
const BOX_BUCKET: PixelIcon = {
  rows: [
    "................",
    ".....hhhhhh.....",
    "....h......h....",
    "...h........h...",
    "..oooooooooooo..",
    "..obbbbbbbbbBo..",
    "..oBBBBBBBBBBo..",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "...obbbbbbbBo...",
    "....obbbbbBo....",
    "....obbbbbBo....",
    "....oooooooo....",
    "................",
    "................",
  ],
  pal: { b: "#3d6fd1", B: "#2f56a6", h: "#d9d9e0" },
};

const BOX_BASKET: PixelIcon = {
  rows: [
    "................",
    "......oooo......",
    ".....o....o.....",
    "..oooooooooooo..",
    "..owWwWwWwWwWo..",
    "..oWWWWWWWWWWo..",
    "..owwWwwWwwWwo..",
    "...owWwwWwwWo...",
    "...oWwWWwWWwo...",
    "...owwWwwWwwo...",
    "....owWwwWwo....",
    "....oWwWWwWo....",
    ".....oooooo.....",
    "................",
    "................",
    "................",
  ],
  pal: { w: "#c8a46a", W: "#9a7a44" },
};

// the field crab from above, red-tipped claws raised; the cua gạch belly-up, its roe showing
const CRAB_TOP = [
  "................",
  "..rr........rr..",
  ".rrc........crr.",
  ".occ..e..e..cco.",
  "..oc..o..o..co..",
  "...oocccccccoo..",
  "..occCCCCCCcco..",
  ".occCCCCCCCCcco.",
  "o.ocCCCCCCCCco.o",
  ".oocCCCCCCCCcoo.",
  "o..occCCCCcco..o",
  ".o..occcccco..o.",
  "..o..oooooo..o..",
  "................",
  "................",
  "................",
];
const CRAB_BELLY = [
  ...CRAB_TOP.slice(0, 3),
  ".occ........cco.",
  "..oc........co..",
  CRAB_TOP[5],
  "..occgGGGGgcco..",
  ".occgGGggGGgcco.",
  "o.ocgGggggGgco.o",
  ".oocgGGggGGgcoo.",
  "o..occgGGgcco..o",
  ...CRAB_TOP.slice(11),
];
const CRAB_PAL = { r: "#b8432f", c: "#8e7a44", C: "#6b5a2e" };

const OC_DONG: PixelIcon = {
  rows: [
    "................",
    "................",
    "................",
    ".....oooooo.....",
    "....osssssso....",
    "...osppppppso...",
    "..ospsssssspso..",
    "..ospsppppspso..",
    "..ospspsspspso..",
    "..ospspppspsso..",
    "..ospsssspssso..",
    "...ospppppsso...",
    "....osssssso....",
    ".....oooooo.....",
    "................",
    "................",
  ],
  pal: { s: "#4a3a22", p: "#8a6a3f" },
};

const OC_BUOU_VANG: PixelIcon = {
  rows: [
    "................",
    "......oo........",
    ".....oyyo.......",
    ".....oyYo.......",
    "....oyyYYo......",
    "...oyyyyYYo.....",
    "..oyyYYyyyYo....",
    ".oyyyyYYyyyYo...",
    ".oyyyyyyYYyyYo..",
    ".oyYyyyyyyYYyYo.",
    ".oyyYYyyyyyyyYo.",
    "..oyyyYYYyyyYo..",
    "...oyyyyyyyYo.ee",
    "....ooooooooo.ee",
    "................",
    "................",
  ],
  pal: { y: "#c9955a", Y: "#8a5a2b", e: "#f29bb5" },
};

export const FARM_ICONS: Record<string, PixelIcon> = {
```

**lib/game/art/farm-icons.ts — edit 3 of 3.** Replace:

```ts
  produce_ot: PRODUCE_OT,
};
```

with:

```ts
  produce_ot: PRODUCE_OT,
  // v15.3
  box_bucket: BOX_BUCKET,
  box_basket: BOX_BASKET,
  cua_dong: { rows: CRAB_TOP, pal: { ...CRAB_PAL, e: "#2a2f3a" } },
  cua_gach: { rows: CRAB_BELLY, pal: { ...CRAB_PAL, g: "#e0662f", G: "#f29b4a" } },
  oc_dong: OC_DONG,
  oc_buou_vang: OC_BUOU_VANG,
};
```

**lib/game/maps/field-art.ts — edit 1 of 3.** Replace:

```ts
import { BRIDGES, CANAL, COOP, DRYING_SQUARES, DRYING_YARD, FARM_SHOP, FIELD_H, FIELD_PLOTS, FIELD_W, RICE_DEPOT } from "./field";
import { propSprite } from "./props";
```

with:

```ts
import { paintBed, paintHole } from "@/lib/game/art/gather-art";
import {
  BRIDGES, CANAL, COOP, CRAB_HOLES, DRYING_SQUARES, DRYING_YARD, FARM_SHOP, FIELD_H, FIELD_PLOTS, FIELD_W, RICE_DEPOT, SNAIL_BEDS,
} from "./field";
import { propSprite } from "./props";
```

**lib/game/maps/field-art.ts — edit 2 of 3.** Replace:

```ts
// field.ts; the rice on each plot is drawn by the engine from field_state (art/crops.ts) — here the plots are bare
// stubble. Original art in the approved Miền Tây style — no copied images.
```

with:

```ts
// field.ts; the rice on each plot is drawn by the engine from field_state (art/crops.ts) — here the plots are bare
// stubble — and so are the cues on the crab holes and snail beds painted here (art/gather-art.ts). Original art in the
// approved Miền Tây style — no copied images.
```

**lib/game/maps/field-art.ts — edit 3 of 3.** Replace:

```ts
  paintBridges(g);
  paintDryingYard(g);
```

with:

```ts
  paintBridges(g);
  for (const r of CRAB_HOLES) paintHole(g, r);
  for (const r of SNAIL_BEDS) paintBed(g, r);
  paintDryingYard(g);
```

**lib/game/engine.ts — edit 1 of 5.** Replace:

```ts
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
```

with:

```ts
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawBedCue, drawHoleCue } from "@/lib/game/art/gather-art";
import { drawHeldFish, drawRod } from "@/lib/game/art/fishing";
```

**lib/game/engine.ts — edit 2 of 5.** Replace:

```ts
  private cardTables: Partial<Record<CardGame, string>> = {};
  private raf = 0;
```

with:

```ts
  private cardTables: Partial<Record<CardGame, string>> = {};
  /** The field's crab holes and snail beds ready for me (their interactable ids). */
  private gatherReady = new Set<string>();
  private raf = 0;
```

**lib/game/engine.ts — edit 3 of 5.** Replace:

```ts
    this.cardTables = { ...labels };
  }
```

with:

```ts
    this.cardTables = { ...labels };
  }

  /** The field's crab holes and snail beds, each ready for me or not: a ready one shows its cue (v15.3 §13.1). */
  setGatherSpots(spots: ReadonlyArray<{ id: string; ready: boolean }>): void {
    this.gatherReady = new Set(spots.filter((s) => s.ready).map((s) => s.id));
  }
```

**lib/game/engine.ts — edit 4 of 5.** Replace:

```ts
    this.drawPlots(b, t, camX, camY, reduced);
```

with:

```ts
    this.drawPlots(b, t, camX, camY, reduced);
    this.drawGatherCues(b, t, camX, camY, reduced);
```

**lib/game/engine.ts — edit 5 of 5.** Replace:

```ts
      if (d.urgent) drawUrgentRing(b, x, y, w, h, t, reduced);
    }
```

with:

```ts
      if (d.urgent) drawUrgentRing(b, x, y, w, h, t, reduced);
    }
  }

  /** The cue on each crab hole and snail bed ready for me (v15.3 §15): over the background, under props and people. */
  private drawGatherCues(b: CanvasRenderingContext2D, t: number, camX: number, camY: number, reduced: boolean): void {
    if (this.gatherReady.size === 0) return;
    for (const it of this.map.interactables) {
      if (!this.gatherReady.has(it.id)) continue;
      const x = it.rect.x - camX, y = it.rect.y - camY;
      if (x > this.vw || y > this.vh || x + it.rect.w < 0 || y + it.rect.h < 0) continue;
      if (it.kind === "crab_hole") drawHoleCue(b, x, y, t, reduced);
      else if (it.kind === "snail_bed") drawBedCue(b, x, y, t, reduced);
    }
```

**components/game/GameCanvas.tsx — edit 1 of 5.** Replace:

```tsx
  setPlots: (plots: ReadonlyArray<PlotDraw>) => void;
  /** Play a farm animation on my character and show it to the others (`fa`; 0 stops it). */
```

with:

```tsx
  setPlots: (plots: ReadonlyArray<PlotDraw>) => void;
  /** Which of the field's crab holes and snail beds are ready for me: those show their cue (v15.3 §13.1). */
  setGatherSpots: (spots: ReadonlyArray<{ id: string; ready: boolean }>) => void;
  /** Play a farm animation on my character and show it to the others (`fa`; 0 stops it). */
```

**components/game/GameCanvas.tsx — edit 2 of 5.** Replace:

```tsx
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset, the input lock, the plots and
  // the card tables' labels.
  const handRef = useRef<string | null>(null);
```

with:

```tsx
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset, the input lock, the plots,
  // the card tables' labels and the gathering cues.
  const handRef = useRef<string | null>(null);
```

**components/game/GameCanvas.tsx — edit 3 of 5.** Replace:

```tsx
  const cardTablesRef = useRef<Readonly<Partial<Record<CardGame, string>>>>({});
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
```

with:

```tsx
  const cardTablesRef = useRef<Readonly<Partial<Record<CardGame, string>>>>({});
  const gatherRef = useRef<ReadonlyArray<{ id: string; ready: boolean }>>([]);
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
```

**components/game/GameCanvas.tsx — edit 4 of 5.** Replace:

```tsx
      },
      farmAnim: (a) => {
```

with:

```tsx
      },
      setGatherSpots: (spots) => {
        gatherRef.current = spots;
        engineRef.current?.setGatherSpots(spots);
      },
      farmAnim: (a) => {
```

**components/game/GameCanvas.tsx — edit 5 of 5.** Replace:

```tsx
    engine.setCardTables(cardTablesRef.current);
```

with:

```tsx
    engine.setCardTables(cardTablesRef.current);
    engine.setGatherSpots(gatherRef.current);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (3 files, 33 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameCanvas.tsx lib/game/art/farm-icons.ts lib/game/art/gather-art.ts lib/game/engine.ts lib/game/maps/field-art.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-farm-icons.test.ts tests/unit/game-gather-art.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): the art — six icons, holes and beds on the canal, the cues and both overlays' scenes

farm-icons.ts draws the xô nhựa, the giỏ tre, cua đồng, a belly-up cua gạch, ốc đồng and ốc
bươu vàng. gather-art.ts paints each crab hole and snail bed on the field's background,
the cue a ready spot shows (eye stalks, a claw tip and a rising bubble; glinting shells),
CrabGame's 96 × 64 scene (claws open in red, closed in green; the hand hovers, dips and
jerks back) and TransplantGame's 160 × 48 scene (the band, 12 slots, a lệch hill off the
line, ớt leaves). The engine draws the cues over the background from setGatherSpots, and
GameCanvas hands the spots to each new engine.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameCanvas.tsx lib/game/art/farm-icons.ts lib/game/art/gather-art.ts lib/game/engine.ts lib/game/maps/field-art.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-farm-icons.test.ts tests/unit/game-gather-art.test.ts
git commit -F <message file>
```

---

### Task 10: TransplantGame — "Cấy lúa" and "Trồng cây ớt con" are rounds

**Files:**
- Create: `components/game/farm/TransplantGame.tsx`
- Modify: `lib/game/farm/actions.ts`, `lib/game/farm/catalog.ts` (a comment), `lib/game/farm/messages.ts`, `lib/game/overlays.ts` (a comment), `hooks/useField.ts`, `hooks/useFarmController.ts`, `components/game/farm/FarmOverlays.tsx`, `components/game/farm/PlotPanel.tsx`
- Test: `tests/unit/farm-transplant-game.test.tsx` (create); `tests/unit/farm-actions.test.ts`, `anticheat-pins.test.tsx`, `use-farm-controller.test.tsx`, `farm-overlays.test.tsx`, `farm-harvest-game.test.tsx`, `farm-plot-panel.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`TRANSPLANT_WAIT_MS`), Task 7 (§11.8's transplant context), Task 8 (`TRANSPLANT`, `createTransplantRound`, `stepTransplantRound`, `transplantMarkText`), Task 9 (`drawTransplantScene`, `TRANSPLANT_SCENE`); Task 7's `WORK_EXPIRED_TP` and `LEASE_ENDING_TP`; v15.2's round machinery in `useFarmController` with its fix round (`startRound` with the `closes` counter and the awaited `lostReport`, `endRound`, `nextRound`, `closeRound`, `ROUND_FA_MS`, `PART_WAIT_MS`, the idle end `ROUND_LIMIT_MS`, the slow claim `CLAIM_SLOW_MS` and `FarmRound.slow`, `FARM_ANIM`), `useField.run`'s refusal handling, `LEASE_ROUND_MS` (25 s) and the rice round's `LEASE_ENDING` reason, HarvestGame's overlay pattern and `lib/game/overlays.ts`' `farmRound`.
- Produces:
  - `actions.ts`: `PlotRun`'s round is `{ kind: "round"; plot; game: "harvest" | "transplant" }` and its work `{ kind: "work"; plot; work: "harvest" }` (pickings only); "Cấy lúa" and "Trồng cây ớt con" start a transplant round, with the hint "Mỗi lượt cắm 12 {khóm | cây} — được từ 6 điểm là xong; hụt thì làm lại, không mất gì." and, in a lease's last `LEASE_ROUND_MS` (25 s, as for "Gặt"), the reason `LEASE_ENDING_TP`, through one helper for both rounds; `catalog.ts`' comment on `LEASE_ROUND_MS` names the transplant;
  - `messages.ts`: `transplantDoneText(plot, ot)`;
  - `useField`: a refusal of `begin_work('transplant')` reads in the transplant's context;
  - `useFarmController`: `FarmWork.work` is `"harvest"`; `FarmRound` gains `game` and `ot`; a transplant round is `begin_work(plot, 'transplant')`, `fa 1` every 2 s, and a pass claimed with `transplant(plot, 1)` `TRANSPLANT_WAIT_MS` after the answer; a fail sends nothing and "Thử lại" begins again (§8.1); like a rice round it ends itself when left idle `ROUND_LIMIT_MS` (with `WORK_EXPIRED_TP`), lets a claim slow for `CLAIM_SLOW_MS` be left, and drops a `begin_work` answer that comes back after a close;
  - `TransplantGame.tsx`: `transplantHelp(ot)` and the overlay (§13.3): the row's scene, "{Khóm | Cây} {n}/12 · {x} điểm", the marks, "Đang cắm nốt hàng mạ…" / "Đang cắm nốt hàng cây…", the success and failure lines, "Huỷ (Esc)", "Thử lại", "Nghỉ tay", "Đóng", and "Nghỉ tay" or Esc once the claim is slow; `FarmOverlays` shows it for a transplant round.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-transplant-game.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import TransplantGame, { transplantHelp } from "@/components/game/farm/TransplantGame";
import type { FarmRound } from "@/hooks/useFarmController";
import { createTransplantRound, TRANSPLANT } from "@/lib/game/farm/minigames";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const round = (over: Partial<FarmRound> = {}): FarmRound => ({
  game: "transplant", plot: 3, part: 0, ot: false, seed: 11, begunAt: 1, phase: "playing", score: null, result: null, message: null,
  slow: false, ...over,
});
function show(r: FarmRound, over: { panelOpen?: boolean; busy?: boolean } = {}) {
  const props = { onEnd: vi.fn(), onNext: vi.fn(), onClose: vi.fn() };
  render(<TransplantGame round={r} busy={over.busy ?? false} panelOpen={over.panelOpen ?? false} {...props} />);
  return props;
}
/** Frames of 16 ms for `ms`. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const space = (target: Window | Element = window) => fireEvent.keyDown(target, { code: "Space", key: " " });

describe("TransplantGame (v15.3 §13.3)", () => {
  it("names the round, rice or ớt, with its help and the hills so far", () => {
    show(round());
    expect(screen.getByRole("heading", { name: "🌱 Cấy lúa thửa 3" })).toBeInTheDocument();
    expect(screen.getByText(transplantHelp(false))).toBeInTheDocument();
    expect(transplantHelp(false)).toBe("Bấm Space (hoặc chạm, bấm chuột) khi bàn tay vào vùng xanh để cắm khóm mạ cho thẳng hàng.");
    expect(screen.getByText(/Khóm 1\/12 · 0 điểm/)).toBeInTheDocument();
    cleanup();
    show(round({ plot: 6, ot: true }));
    expect(screen.getByRole("heading", { name: "🌶\uFE0F Trồng cây ớt con thửa 6" })).toBeInTheDocument();
    expect(screen.getByText(transplantHelp(true))).toBeInTheDocument();
    expect(transplantHelp(true)).toBe("Bấm Space (hoặc chạm, bấm chuột) khi bàn tay vào vùng xanh để cắm cây ớt cho thẳng hàng.");
    expect(screen.getByText(/Cây 1\/12 · 0 điểm/)).toBeInTheDocument();
  });

  it("sets a hill with Space as the hand crosses the band: Thẳng hàng!", () => {
    show(round());
    const c = createTransplantRound(11).centres[0];
    run(16);
    run(TRANSPLANT.leadMs + Math.round(c * TRANSPLANT.sweepMs));
    space();
    run(32);
    expect(screen.getByText(/Khóm 2\/12 · 1 điểm/)).toBeInTheDocument();
    expect(screen.getByText(/Thẳng hàng!/)).toBeInTheDocument();
  });

  it("sets a hill with a tap or a click; one too early is Lệch hàng", () => {
    show(round());
    run(16);
    run(TRANSPLANT.leadMs + 32);
    fireEvent.pointerDown(screen.getByRole("group", { name: "Hàng mạ" }));
    run(32);
    expect(screen.getByText(/Khóm 2\/12 · 0 điểm/)).toBeInTheDocument();
    expect(screen.getByText(/Lệch hàng/)).toBeInTheDocument();
  });

  it("ignores Space typed into a text field, and a held key's repeats", () => {
    render(<input aria-label="Chat" />);
    show(round());
    run(16);
    run(TRANSPLANT.leadMs + 100);
    space(screen.getByRole("textbox", { name: "Chat" }));
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    run(32);
    expect(screen.getByText(/Khóm 1\/12 · 0 điểm/)).toBeInTheDocument();
  });

  it("reports the round's end once: twelve hills missed score 0 and fail", () => {
    const { onEnd } = show(round());
    run(22_000);
    expect(onEnd.mock.calls).toEqual([[false, 0]]);
    expect(screen.getByText(/Bỏ sót khóm/)).toBeInTheDocument();
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

  it("waits out the 9 s setting the last hills, without a way out", () => {
    const { onClose } = show(round({ phase: "waiting", score: 7 }));
    expect(screen.getByText("Đang cắm nốt hàng mạ…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    show(round({ phase: "waiting", score: 7, ot: true }));
    expect(screen.getByText("Đang cắm nốt hàng cây…")).toBeInTheDocument();
  });

  it("offers Nghỉ tay, and takes Esc, once the claim has been slow on its way", () => {
    const { onClose } = show(round({ phase: "waiting", score: 7, slow: true }));
    expect(screen.getByText("Đang cắm nốt hàng mạ…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Nghỉ tay" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("says the rice transplanted or the ớt set out, with Đóng", () => {
    const { onClose } = show(round({ phase: "won", score: 9 }));
    expect(screen.getByText("✅ Cấy xong thửa 3 — giữ nước Nông, bón thúc đúng lúc nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    show(round({ plot: 6, ot: true, phase: "won", score: 9 }));
    expect(screen.getByText("✅ Trồng xong cây ớt con thửa 6.")).toBeInTheDocument();
  });

  it("says a failed round's score, printed with a comma, with Thử lại and Nghỉ tay", () => {
    const { onNext, onClose } = show(round({ phase: "lost", score: 5.5 }));
    expect(screen.getByText("❌ Được 5,5/12 điểm — cần 6. Thử lại ngay nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Nghỉ tay" }));
    expect([onNext.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 1]);
  });

  it("shows the server's refusals in the transplant's words, and waits while busy", () => {
    show(round({ phase: "refused", score: 7, message: "Chưa cấy xong hàng mạ — thử lại sau vài giây." }), { busy: true });
    expect(screen.getByText("Chưa cấy xong hàng mạ — thử lại sau vài giây.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeDisabled();
  });
});
```

**tests/unit/farm-actions.test.ts — edit 1 of 5.** Replace:

```ts
  });
  it("transplants seedlings old enough in shallow water, as a work action", () => {
    const seedlings = (water: Array<[number, number]>) => plot(crop({ sowAt: at(3) }, water));
    expect(find(plotActions(seedlings([[0, 1]]), "me", nep, CATALOG, ALL, at(6)), "transplant")?.why)
```

with:

```ts
  });
  it("transplants seedlings old enough in shallow water, in a TransplantGame round (v15.3 §8)", () => {
    const seedlings = (water: Array<[number, number]>, over: Partial<PlotView> = {}) => plot(crop({ sowAt: at(3) }, water), over);
    expect(find(plotActions(seedlings([[0, 1]]), "me", nep, CATALOG, ALL, at(6)), "transplant")?.why)
```

**tests/unit/farm-actions.test.ts — edit 2 of 5.** Replace:

```ts
      .toBe("Cần mực nước Nông (đang Ẩm).");
    expect(find(plotActions(seedlings([[0, 1], [11, 2]]), "me", nep, CATALOG, ALL, at(11)), "transplant"))
      .toMatchObject({ enabled: true, run: { kind: "work", plot: 5, work: "transplant" } });
  });
```

with:

```ts
      .toBe("Cần mực nước Nông (đang Ẩm).");
    expect(find(plotActions(seedlings([[0, 1], [11, 2]]), "me", nep, CATALOG, ALL, at(11)), "transplant")).toMatchObject({
      label: "Cấy lúa", enabled: true, run: { kind: "round", plot: 5, game: "transplant" },
      hint: "Mỗi lượt cắm 12 khóm — được từ 6 điểm là xong; hụt thì làm lại, không mất gì.",
    });
    // a round needs 25 s left on the lease, as a rice round does (R19, v15.2 R11)
    const lease = (ms: number) => ({ lease: { source: "village" as const, until: at(11) + ms, price: 250 } });
    const ending = find(plotActions(seedlings([[0, 1], [11, 2]], lease(24_999)), "me", nep, CATALOG, ALL, at(11)), "transplant");
    expect(ending).toMatchObject({ enabled: false, why: "Sắp hết hạn thuê — không kịp cấy." });
    expect(ending?.hint).toBeUndefined();
    expect(find(plotActions(seedlings([[0, 1], [11, 2]], lease(25_000)), "me", nep, CATALOG, ALL, at(11)), "transplant")?.enabled)
      .toBe(true);
  });
```

**tests/unit/farm-actions.test.ts — edit 3 of 5.** Replace:

```ts
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, SICKLE, at(61)), "round")).toMatchObject({
      label: "Gặt bằng liềm", run: { kind: "round", plot: 5 }, enabled: true, hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần.",
    });
```

with:

```ts
    expect(find(plotActions(ripe([[0, 3], [55, 1]]), "me", nep, CATALOG, SICKLE, at(61)), "round")).toMatchObject({
      label: "Gặt bằng liềm", run: { kind: "round", plot: 5, game: "harvest" }, enabled: true, hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần.",
    });
```

**tests/unit/farm-actions.test.ts — edit 4 of 5.** Replace:

```ts
  });
  it("sets out the ớt seedlings once old enough, on moist beds", () => {
    const nursery = (water: Array<[number, number]>) => plot(bed("ot", { sowAt: at(0), plantAt: null }, water));
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(6)), "set_out")).toMatchObject({
```

with:

```ts
  });
  it("sets out the ớt seedlings once old enough, on moist beds, in a TransplantGame round (v15.3 §8)", () => {
    const nursery = (water: Array<[number, number]>, over: Partial<PlotView> = {}) => plot(bed("ot", { sowAt: at(0), plantAt: null }, water), over);
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(6)), "set_out")).toMatchObject({
```

**tests/unit/farm-actions.test.ts — edit 5 of 5.** Replace:

```ts
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(11)), "set_out")).toMatchObject({
      enabled: true, run: { kind: "work", plot: 5, work: "transplant" },
    });
  });
```

with:

```ts
    expect(find(plotActions(nursery([[0, 1]]), "me", null, BEDS, BEDMINE, at(11)), "set_out")).toMatchObject({
      enabled: true, run: { kind: "round", plot: 5, game: "transplant" },
      hint: "Mỗi lượt cắm 12 cây — được từ 6 điểm là xong; hụt thì làm lại, không mất gì.",
    });
    const ending = { lease: { source: "village" as const, until: at(11) + 5_000, price: 250 } };
    expect(find(plotActions(nursery([[0, 1]], ending), "me", null, BEDS, BEDMINE, at(11)), "set_out"))
      .toMatchObject({ enabled: false, why: "Sắp hết hạn thuê — không kịp cấy." });
  });
```

**tests/unit/anticheat-pins.test.tsx — edit 1 of 7.** Replace:

```tsx
import { useFarmController, WORK_MS } from "@/hooks/useFarmController";
```

with:

```tsx
import { useFarmController, WORK_MS } from "@/hooks/useFarmController";
import { TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 7.** Replace:

```tsx

  it("the plot panel sends its plot's number, pumps or drains one level, works only at transplanting and harvesting, and tends only with the config's acts", () => {
    const rows = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
```

with:

```tsx

  it("the plot panel sends its plot's number, pumps or drains one level, works only at pickings, plays rounds only at transplanting and cutting rice, and tends only with the config's acts", () => {
    const rows = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
```

**tests/unit/anticheat-pins.test.tsx — edit 3 of 7.** Replace:

```tsx
    const works = new Set<string>();
    const rounds = new Set<number>();
    const acts = new Set<string>();
```

with:

```tsx
    const works = new Set<string>();
    const rounds = new Set<string>();
    const acts = new Set<string>();
```

**tests/unit/anticheat-pins.test.tsx — edit 4 of 7.** Replace:

```tsx
          if (run.kind === "work") works.add(run.work);
          if (run.kind === "round") rounds.add(run.plot);
          if (run.kind === "tend") acts.add(run.act);
```

with:

```tsx
          if (run.kind === "work") works.add(run.work);
          if (run.kind === "round") rounds.add(`${run.plot}:${run.game}`);
          if (run.kind === "tend") acts.add(run.act);
```

**tests/unit/anticheat-pins.test.tsx — edit 5 of 7.** Replace:

```tsx
    expect([...deltas].sort()).toEqual([-1, 1]);
    expect([...works].sort()).toEqual(["harvest", "transplant"]);
    expect([...rounds]).toEqual([10]);
    expect([...acts].sort()).toEqual(["lat_day", "vun_goc"]);
```

with:

```tsx
    expect([...deltas].sort()).toEqual([-1, 1]);
    expect([...works].sort()).toEqual(["harvest"]);
    // begin_work's two works (bad_work): the rice seedlings' and the ớt nursery's transplant rounds, and ripe rice's round
    expect([...rounds].sort()).toEqual(["10:harvest", "10:transplant", "5:transplant", "6:transplant"]);
    expect([...acts].sort()).toEqual(["lat_day", "vun_goc"]);
```

**tests/unit/anticheat-pins.test.tsx — edit 6 of 7.** Replace:

```tsx

  it("transplants and harvests with quality 1", async () => {
    const canvas = { setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn() } as unknown as GameCanvasHandle;
```

with:

```tsx

  it("transplants after a TransplantGame round, and picks, with quality 1", async () => {
    const canvas = { setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn() } as unknown as GameCanvasHandle;
```

**tests/unit/anticheat-pins.test.tsx — edit 7 of 7.** Replace:

```tsx
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (const work of ["transplant", "harvest"] as const) {
      await act(async () => { await result.current.act({ kind: "work", plot: 6, work }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
      expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: work, plot: 6, quality: 1 });
    }
  });
```

with:

```tsx
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await result.current.act({ kind: "round", plot: 6, game: "transplant" }); });
    act(() => result.current.endRound(true, 12));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSPLANT_WAIT_MS); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "transplant", plot: 6, quality: 1 });
    await act(async () => { await result.current.act({ kind: "work", plot: 6, work: "harvest" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "harvest", plot: 6, quality: 1 });
  });
```

**tests/unit/use-farm-controller.test.tsx — edit 1 of 12.** Replace:

```tsx
import { farmItemFromRow, PART_WAIT_MS, PART_WINDOW_MS, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
```

with:

```tsx
import { farmItemFromRow, PART_WAIT_MS, PART_WINDOW_MS, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValue({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "transplant" }); });
    act(() => result.current.cancelWork());
```

with:

```tsx
    rpc.fieldAction.mockResolvedValue({ state: field(), harvest: null });
    await act(async () => { await result.current.act({ kind: "work", plot: 5, work: "harvest" }); });
    act(() => result.current.cancelWork());
```

**tests/unit/use-farm-controller.test.tsx — edit 3 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5 })).toBe(true); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
```

with:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5, game: "harvest" })).toBe(true); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "harvest" });
```

**tests/unit/use-farm-controller.test.tsx — edit 4 of 12.** Replace:

```tsx
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(result.current.round).toMatchObject({ plot: 5, part: 1, phase: "playing", score: null });
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(1);
```

with:

```tsx
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(result.current.round).toMatchObject({ game: "harvest", plot: 5, part: 1, phase: "playing", score: null });
    expect(fa(canvas, FARM_ANIM.harvest)).toBe(1);
```

**tests/unit/use-farm-controller.test.tsx — edit 5 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(false, 3.5));
```

with:

```tsx
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.endRound(false, 3.5));
```

**tests/unit/use-farm-controller.test.tsx — edit 6 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.closeRound());
```

with:

```tsx
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.closeRound());
```

**tests/unit/use-farm-controller.test.tsx — edit 7 of 12.** Replace:

```tsx
    // the lease ran out mid-round: the claim finds the plot gone
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(true, 5));
```

with:

```tsx
    // the lease ran out mid-round: the claim finds the plot gone
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.endRound(true, 5));
```

**tests/unit/use-farm-controller.test.tsx — edit 8 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    let report!: (a: unknown) => void;
```

with:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    let report!: (a: unknown) => void;
```

**tests/unit/use-farm-controller.test.tsx — edit 9 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(false, 2));
```

with:

```tsx
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.endRound(false, 2));
```

**tests/unit/use-farm-controller.test.tsx — edit 10 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    expect(ROUND_LIMIT_MS).toBeLessThan(PART_WINDOW_MS);
```

with:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    expect(ROUND_LIMIT_MS).toBeLessThan(PART_WINDOW_MS);
```

**tests/unit/use-farm-controller.test.tsx — edit 11 of 12.** Replace:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5 }); });
    act(() => result.current.endRound(true, 6));
```

with:

```tsx
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    act(() => result.current.endRound(true, 6));
```

**tests/unit/use-farm-controller.test.tsx — edit 12 of 12.** Replace:

```tsx

describe("useFarmController, the clock while a harvester runs", () => {
```

with:

```tsx

describe("useFarmController, v15.3 transplant rounds", () => {
  const answer = (s: FieldState) => ({ state: s, harvest: null, harvestPart: null, picking: null });
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  /** Plot 5 as an ớt nursery, sown 12 h ago. */
  const OT5 = {
    kind: "upland", upland: "ot", variety: null, phase: "nursery", soak_at: null, sow_at: iso(-12), transplant_at: null, plant_at: null,
    pests: [], picking: null, pickings: 3,
    log: { water: [{ t: iso(-12), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [] },
  };

  it("plays a transplant round: begin_work, fa 1 every 2 s, and transplant with quality 1 no earlier than 9 s after the answer", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5, game: "transplant" })).toBe(true); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "transplant" });
    const use = spot("plot_5");
    expect(canvas.plant).toHaveBeenCalledWith(use.use, use.face);
    expect(result.current.round).toMatchObject({ game: "transplant", plot: 5, ot: false, phase: "playing", score: null });
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(3);
    // passed at 5 s: fa 0, then "Đang cắm nốt hàng mạ…" until 9 s after the begin_work answer
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    act(() => result.current.endRound(true, 8.5));
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.round).toMatchObject({ phase: "waiting", score: 8.5 });
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSPLANT_WAIT_MS - 5000 - 1); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "transplant", plot: 5, quality: 1 });
    expect(result.current.round).toMatchObject({ phase: "won", result: null });
    expect(canvas.plotChanged).toHaveBeenCalledWith(5);
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(3);
  });

  it("sends nothing for a failed round, and Thử lại begins a new one", async () => {
    const { result } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValue(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "transplant" }); });
    act(() => result.current.endRound(false, 5.5));
    expect(result.current.round).toMatchObject({ phase: "lost", score: 5.5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
    await act(async () => { result.current.nextRound(); await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.fieldAction).toHaveBeenCalledTimes(2);
    expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: "begin_work", plot: 5, work: "transplant" });
    expect(result.current.round).toMatchObject({ game: "transplant", phase: "playing", score: null });
  });

  it("ends a transplant round left idle before the server's window closes, in its own words", async () => {
    const { result, canvas } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field()));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "transplant" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_LIMIT_MS); });
    expect(result.current.round).toMatchObject({ game: "transplant", phase: "refused", message: "Lượt cấy đã quá lâu — bắt đầu lại nhé." });
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    const sent = fa(canvas, FARM_ANIM.transplant);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 5); });
    expect(fa(canvas, FARM_ANIM.transplant)).toBe(sent);
    expect(rpc.fieldAction).toHaveBeenCalledTimes(1);
  });

  it("knows an ớt round, and shows a refused transplant in its own words", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ crop5: OT5 }));
    const { result, toast } = setup();
    await flush();
    rpc.fieldAction.mockResolvedValueOnce(answer(field({ crop5: OT5 })));
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "transplant" }); });
    expect(result.current.round).toMatchObject({ game: "transplant", plot: 5, ot: true, phase: "playing" });
    act(() => result.current.endRound(true, 7));
    rpc.fieldAction.mockRejectedValueOnce({ message: "work expired" });
    await act(async () => { await vi.advanceTimersByTimeAsync(TRANSPLANT_WAIT_MS); });
    expect(result.current.round).toMatchObject({ phase: "refused", message: "Lượt cấy đã quá lâu — bắt đầu lại nhé." });
    expect(toast).not.toHaveBeenCalled();
  });

  it("reads a begin_work refusal for a transplant in the transplant's words", async () => {
    const { result, toast } = setup();
    await flush();
    rpc.fieldAction.mockRejectedValueOnce({ message: "lease ending" });
    await act(async () => { expect(await result.current.act({ kind: "round", plot: 5, game: "transplant" })).toBe(false); });
    expect(toast).toHaveBeenCalledWith("Sắp hết hạn thuê — không kịp cấy.");
    expect(result.current.round).toBeNull();
    rpc.fieldAction.mockRejectedValueOnce({ message: "lease ending" });
    await act(async () => { await result.current.act({ kind: "round", plot: 5, game: "harvest" }); });
    expect(toast).toHaveBeenLastCalledWith("Sắp hết hạn thuê — không kịp gặt phần này.");
  });
});

describe("useFarmController, the clock while a harvester runs", () => {
```

**tests/unit/farm-overlays.test.tsx — edit 1 of 3.** Replace:

```tsx
  it("keeps working on an Esc typed into a text field", () => {
    const farm = controller({ work: { plot: 5, work: "transplant", startedAt: 1, text: "🌱 Đang cấy thửa 5…" } });
    render(<><input aria-label="Chat" /><FarmOverlays farm={farm} me="me" onField /></>);
```

with:

```tsx
  it("keeps working on an Esc typed into a text field", () => {
    const farm = controller({ work: { plot: 5, work: "harvest", startedAt: 1, text: "🧺 Đang đào khoai thửa 5…" } });
    render(<><input aria-label="Chat" /><FarmOverlays farm={farm} me="me" onField /></>);
```

**tests/unit/farm-overlays.test.tsx — edit 2 of 3.** Replace:

```tsx

describe("FarmOverlays, a harvest round", () => {
  const round = (over: Partial<FarmRound> = {}): FarmRound => ({
    plot: 5, part: 2, seed: 7, begunAt: 1, phase: "playing", score: null, result: null, message: null, slow: false, ...over,
  });
```

with:

```tsx

describe("FarmOverlays, a round", () => {
  const round = (over: Partial<FarmRound> = {}): FarmRound => ({
    game: "harvest", plot: 5, part: 2, ot: false, seed: 7, begunAt: 1, phase: "playing", score: null, result: null, message: null,
    slow: false, ...over,
  });
```

**tests/unit/farm-overlays.test.tsx — edit 3 of 3.** Replace:

```tsx
    expect(farm.closeRound).toHaveBeenCalledTimes(1);
  });
});
```

with:

```tsx
    expect(farm.closeRound).toHaveBeenCalledTimes(1);
  });

  it("opens TransplantGame for a transplant round (v15.3 §13.3)", () => {
    const farm = controller({ round: round({ game: "transplant", part: 0, phase: "won", score: 8 }) });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("dialog", { name: "Cấy lúa thửa 5" })).toBeInTheDocument();
    expect(screen.getByText("✅ Cấy xong thửa 5 — giữ nước Nông, bón thúc đúng lúc nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(farm.closeRound).toHaveBeenCalledTimes(1);
  });
});
```

**tests/unit/farm-harvest-game.test.tsx.** Replace:

```tsx
const round = (over: Partial<FarmRound> = {}): FarmRound => ({
  plot: 3, part: 2, seed: 11, begunAt: 1, phase: "playing", score: null, result: null, message: null, slow: false, ...over,
});
```

with:

```tsx
const round = (over: Partial<FarmRound> = {}): FarmRound => ({
  game: "harvest", plot: 3, part: 2, ot: false, seed: 11, begunAt: 1, phase: "playing", score: null, result: null, message: null,
  slow: false, ...over,
});
```

**tests/unit/farm-plot-panel.test.tsx.** Replace:

```tsx
    fireEvent.click(screen.getByRole("button", { name: "Gặt bằng liềm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "round", plot: 5 }, undefined);
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Nông cụ" }));
```

with:

```tsx
    fireEvent.click(screen.getByRole("button", { name: "Gặt bằng liềm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "round", plot: 5, game: "harvest" }, undefined);
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Nông cụ" }));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-harvest-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-transplant-game.test.tsx tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — `farm-transplant-game.test.tsx` cannot load `@/components/game/farm/TransplantGame`, and 13 tests fail (the plot's transplant is still a 3-second job, the rounds have no `game`, no "Cấy lúa thửa 5" dialog, no `transplant` claim, no idle end in the transplant's words, the refusal not in the transplant's words); 6 files fail, 1 passes.

- [ ] **Step 3: Implement**

**lib/game/farm/catalog.ts.** Replace:

```ts
export const PART_WAIT_MS = 9_000;
/** begin_work needs this much left on a lease: a rice round (its play and its 9 s claim), and a transplant or a picking
 *  (R11). */
export const LEASE_ROUND_MS = 25_000;
```

with:

```ts
export const PART_WAIT_MS = 9_000;
/** begin_work needs this much left on a lease: a round — a rice part or a transplant (v15.3 R19) — for its play and its
 *  9 s claim, and a picking (R11). */
export const LEASE_ROUND_MS = 25_000;
```

**lib/game/farm/messages.ts.** Replace:

```ts
  return `🌾 Gặt xong thửa ${plot}: tổng ${total} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}
```

with:

```ts
  return `🌾 Gặt xong thửa ${plot}: tổng ${total} kg ${varietyName.toLowerCase()} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!`;
}

/** A won transplant round (v15.3 §13.3): the rice transplanted, or the ớt seedlings set out. */
export function transplantDoneText(plot: number, ot: boolean): string {
  return ot ? `✅ Trồng xong cây ớt con thửa ${plot}.` : `✅ Cấy xong thửa ${plot} — giữ nước Nông, bón thúc đúng lúc nhé!`;
}
```

**lib/game/farm/actions.ts — edit 1 of 6.** Replace:

```ts
import {
  BED_WATER_NAME, bedLevelsText, durationText, LEASE_ENDING, NO_SEED, NOT_OPEN_152, PEST_NAME, PEST_REMEDY, TOO_FAST, WATER_NAME,
} from "./messages";
import type { FieldAction } from "./rpc";
```

with:

```ts
import {
  BED_WATER_NAME, bedLevelsText, durationText, LEASE_ENDING, LEASE_ENDING_TP, NO_SEED, NOT_OPEN_152, PEST_NAME, PEST_REMEDY,
  TOO_FAST, WATER_NAME,
} from "./messages";
import { TRANSPLANT } from "./minigames";
import type { FieldAction } from "./rpc";
```

**lib/game/farm/actions.ts — edit 2 of 6.** Replace:

```ts

/** A button's job: an RPC, a 3-second action behind the 2 s gate (begin_work, then transplant / harvest), or a rice
 *  harvest round (HarvestGame, v15.2 §6.2). */
export type PlotRun = FieldAction | { kind: "work"; plot: number; work: "transplant" | "harvest" } | { kind: "round"; plot: number };
```

with:

```ts

/** A button's job: an RPC, a 3-second hoa-màu picking behind the 2 s gate (begin_work, then harvest), or a round: a rice
 *  part (HarvestGame, v15.2 §6.2) or a transplant, rice or ớt (TransplantGame, v15.3 §8). */
export type PlotRun =
  | FieldAction
  | { kind: "work"; plot: number; work: "harvest" }
  | { kind: "round"; plot: number; game: "harvest" | "transplant" };
```

**lib/game/farm/actions.ts — edit 3 of 6.** Replace:

```ts

/** The rice seeds I hold (a hoa-màu seed is planted on beds, not soaked). */
```

with:

```ts

/** A transplant round's hint (v15.3 §13.4): rice hills are khóm, ớt seedlings cây. */
const transplantHint = (ot: boolean): string =>
  `Mỗi lượt cắm ${TRANSPLANT.hills} ${ot ? "cây" : "khóm"} — được từ ${TRANSPLANT.pass} điểm là xong; hụt thì làm lại, không mất gì.`;

/** Too little left on the plot's lease for a round (v15.2 R11, v15.3 R19): begin_work would answer `lease ending`. */
const leaseEnding = (p: PlotView, now: number): boolean => p.lease !== null && p.lease.until - now < LEASE_ROUND_MS;

/** The rice seeds I hold (a hoa-màu seed is planted on beds, not soaked). */
```

**lib/game/farm/actions.ts — edit 4 of 6.** Replace:

```ts
      : (mine.items[TOOL_SICKLE] ?? 0) < 1 ? "Chưa có liềm — mua ở tiệm anh Hai."
      : p.lease && p.lease.until - now < LEASE_ROUND_MS ? LEASE_ENDING : undefined;
    return { key: "round", label, run: { kind: "round", plot }, enabled: !why, why, ...(why ? {} : { hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần." }) };
  };
```

with:

```ts
      : (mine.items[TOOL_SICKLE] ?? 0) < 1 ? "Chưa có liềm — mua ở tiệm anh Hai."
      : leaseEnding(p, now) ? LEASE_ENDING : undefined;
    return {
      key: "round", label, run: { kind: "round", plot, game: "harvest" }, enabled: !why, why,
      ...(why ? {} : { hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần." }),
    };
  };
```

**lib/game/farm/actions.ts — edit 5 of 6.** Replace:

```ts
    const ready = transplantReadyAt(c, v)!;
    const why = now < ready ? `Mạ chưa đủ tuổi — cấy được sau ${durationText(ready - now)}.` : w !== 2 ? `Cần mực nước Nông (đang ${WATER_NAME[w]}).` : undefined;
    out.push({ key: "transplant", label: "Cấy lúa", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else if ((ph === "ripening" && v) || ph === "ripe" || ph === "overripe") {
```

with:

```ts
    const ready = transplantReadyAt(c, v)!;
    const why = now < ready ? `Mạ chưa đủ tuổi — cấy được sau ${durationText(ready - now)}.`
      : w !== 2 ? `Cần mực nước Nông (đang ${WATER_NAME[w]}).`
      : leaseEnding(p, now) ? LEASE_ENDING_TP : undefined;
    out.push({
      key: "transplant", label: "Cấy lúa", run: { kind: "round", plot, game: "transplant" }, enabled: !why, why,
      ...(why ? {} : { hint: transplantHint(false) }),
    });
  } else if ((ph === "ripening" && v) || ph === "ripe" || ph === "overripe") {
```

**lib/game/farm/actions.ts — edit 6 of 6.** Replace:

```ts
    const ready = nurseryReadyAt(c, u);
    const why = ready !== null && now < ready ? `Cây con chưa đủ tuổi — trồng được sau ${durationText(ready - now)}.` : moist;
    out.push({ key: "set_out", label: u.transplantLabel ?? "Trồng cây con", run: { kind: "work", plot, work: "transplant" }, enabled: !why, why });
  } else {
```

with:

```ts
    const ready = nurseryReadyAt(c, u);
    const why = ready !== null && now < ready ? `Cây con chưa đủ tuổi — trồng được sau ${durationText(ready - now)}.`
      : moist ?? (leaseEnding(p, now) ? LEASE_ENDING_TP : undefined);
    out.push({
      key: "set_out", label: u.transplantLabel ?? "Trồng cây con", run: { kind: "round", plot, game: "transplant" }, enabled: !why, why,
      ...(why ? {} : { hint: transplantHint(true) }),
    });
  } else {
```

**hooks/useField.ts — edit 1 of 3.** Replace:

```ts

  /** Run RPC `rpc` and apply its answer. On error: the Vietnamese text, read in the RPC's context (a harvest round's
   *  refusals read their own way), to `onError` or the toast; then a refetch, and null. A strike shows no text: the
   *  warning or the ban modal shows instead (anti-cheat §12.1). Before 0016 its RPCs are missing while the field is open:
   *  they say NOT_OPEN_152 and leave the field open (v15.2 R28). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void,
    opts: { rpc: string; itemName?: string; onError?: (text: string) => void }): Promise<T | null> => {
    const n = ++seq.current;
```

with:

```ts

  /** Run RPC `rpc` and apply its answer. On error: the Vietnamese text, read in its context (the RPC's, unless `context`
   *  names another: a round's refusals read their own way), to `onError` or the toast; then a refetch, and null. A strike
   *  shows no text: the warning or the ban modal shows instead (anti-cheat §12.1). Before 0016 its RPCs are missing while
   *  the field is open: they say NOT_OPEN_152 and leave the field open (v15.2 R28). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void,
    opts: { rpc: string; context?: string; itemName?: string; onError?: (text: string) => void }): Promise<T | null> => {
    const n = ++seq.current;
```

**hooks/useField.ts — edit 2 of 3.** Replace:

```ts
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) {
        (opts.onError ?? onErrorRef.current)(missing && v152 ? NOT_OPEN_152 : farmErrorMessage(err, opts.itemName, opts.rpc));
      }
```

with:

```ts
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) {
        (opts.onError ?? onErrorRef.current)(missing && v152 ? NOT_OPEN_152 : farmErrorMessage(err, opts.itemName, opts.context ?? opts.rpc));
      }
```

**hooks/useField.ts — edit 3 of 3.** Replace:

```ts
    run: useCallback((a: FieldAction, itemName?: string, onError?: (text: string) => void) =>
      call(() => fieldAction(roomId, token, a), (n, r) => apply(n, r.state), { rpc: actionCall(a)[0], itemName, onError }),
    [call, apply, roomId, token]),
```

with:

```ts
    run: useCallback((a: FieldAction, itemName?: string, onError?: (text: string) => void) =>
      call(() => fieldAction(roomId, token, a), (n, r) => apply(n, r.state), {
        // a transplant round's begin_work (lease ending) reads as the transplant does (v15.3 §11.8)
        rpc: actionCall(a)[0], context: a.kind === "begin_work" && a.work === "transplant" ? "transplant" : undefined, itemName, onError,
      }),
    [call, apply, roomId, token]),
```

**hooks/useFarmController.ts — edit 1 of 21.** Replace:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import {
  boughtText, GIFT_TEXT, harvestText, harvesterDoneText, loadedText, NOT_OPEN, pickingText, produceSaleText, riceSaleText,
  WORK_EXPIRED,
} from "@/lib/game/farm/messages";
```

with:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import { TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import {
  boughtText, GIFT_TEXT, harvestText, harvesterDoneText, loadedText, NOT_OPEN, pickingText, produceSaleText, riceSaleText,
  WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
```

**hooks/useFarmController.ts — edit 2 of 21.** Replace:

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
  /** playing → waiting (the 9 s, "Đang bó lúa…") → won; or lost; or refused (by the server, or left idle too long). */
  phase: "playing" | "waiting" | "won" | "lost" | "refused";
```

with:

```ts

/** A 3-second hoa-màu picking in progress: movement is locked until it is sent or cancelled (spec §16). `text` is the
 *  bar's line. */
export interface FarmWork { plot: number; work: "harvest"; startedAt: number; text: string }

/** A round: a rice part (HarvestGame, v15.2 §6.2) or a transplant (TransplantGame, v15.3 §8). The overlay plays it,
 *  the controller talks to the server. */
export interface FarmRound {
  game: "harvest" | "transplant";
  plot: number;
  /** The part a harvest round cuts, 1–6 (0 in a transplant round). */
  part: number;
  /** A transplant round on beds: the ớt seedlings, "cây" in its texts. */
  ot: boolean;
  /** Seeds the round's bands. */
  seed: number;
  /** When the begin_work answer arrived (client ms): a won round is claimed 9 s after it. */
  begunAt: number;
  /** playing → waiting (the 9 s: "Đang bó lúa…", "Đang cắm nốt hàng mạ…") → won; or lost; or refused (by the server, or
   *  left idle too long). */
  phase: "playing" | "waiting" | "won" | "lost" | "refused";
```

**hooks/useFarmController.ts — edit 3 of 21.** Replace:

```ts
  score: number | null;
  /** The part won. */
  result: PartAnswer | null;
```

with:

```ts
  score: number | null;
  /** The part won (a harvest round). */
  result: PartAnswer | null;
```

**hooks/useFarmController.ts — edit 4 of 21.** Replace:

```ts
  cancelWork: () => void;
  /** A harvest round, open in its overlay. */
  round: FarmRound | null;
  /** The overlay's round ended: a pass is claimed at 9 s, a fail is reported at once. */
  endRound: (pass: boolean, score: number) => void;
  /** "Gặt tiếp" or "Thử lại": a new round on the same plot (a new begin_work, once a lost round's report has landed). */
  nextRound: () => void;
```

with:

```ts
  cancelWork: () => void;
  /** A round, open in its overlay. */
  round: FarmRound | null;
  /** The overlay's round ended: a pass is claimed at 9 s; a harvest round's fail is reported at once, a transplant
   *  round's sends nothing. */
  endRound: (pass: boolean, score: number) => void;
  /** "Gặt tiếp" or "Thử lại": a new round of the same game on the same plot (a new begin_work, once a lost harvest
   *  round's report has landed). */
  nextRound: () => void;
```

**hooks/useFarmController.ts — edit 5 of 21.** Replace:

```ts
  closeRound: () => void;
  /** A land, farming or drying action (a work action starts the progress, a round opens HarvestGame); `done` is toasted
   *  when it succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
```

with:

```ts
  closeRound: () => void;
  /** A land, farming or drying action (a picking starts the progress, a round opens its game); `done` is toasted when it
   *  succeeds. */
  act: (a: PlotRun, done?: string) => Promise<boolean>;
```

**hooks/useFarmController.ts — edit 6 of 21.** Replace:

```ts

/** Transplanting and harvesting take this long on screen (the server's gate is 2 s; spec §4, §11.4). */
export const WORK_MS = 3000;
/** A harvest round re-sends `fa 2` this often while it runs (an `fa` lasts 2.5 s; v15.2 R14). */
export const ROUND_FA_MS = 2000;
/** A round still played this long after its begin_work answer ends as too long, 10 s before the server's window (R6)
 *  would refuse its claim: an idle round would otherwise re-send `fa 2` for ever. */
export const ROUND_LIMIT_MS = PART_WINDOW_MS - 10_000;
```

with:

```ts

/** A hoa-màu picking takes this long on screen (the server's gate is 2 s; spec §4, §11.4). */
export const WORK_MS = 3000;
/** A round re-sends its `fa` this often while it runs (an `fa` lasts 2.5 s; v15.2 R14, v15.3 §12). */
export const ROUND_FA_MS = 2000;
/** A round still played this long after its begin_work answer ends as too long, 10 s before the server's window (R6; a
 *  transplant's is the same, v15.3 §8.3) would refuse its claim: an idle round would otherwise re-send its `fa` for
 *  ever. */
export const ROUND_LIMIT_MS = PART_WINDOW_MS - 10_000;
```

**hooks/useFarmController.ts — edit 7 of 21.** Replace:

```ts
export const CLAIM_SLOW_MS = 15_000;
/** A harvester of mine is fetched this long after its end, on the server's clock (R15), and again after
```

with:

```ts
export const CLAIM_SLOW_MS = 15_000;
/** Each round's animation, and how long after its begin_work answer a won round is claimed (the gate is 8 s). */
const ROUND_ANIM: Record<FarmRound["game"], FarmAnim> = { harvest: FARM_ANIM.harvest, transplant: FARM_ANIM.transplant };
const ROUND_WAIT_MS: Record<FarmRound["game"], number> = { harvest: PART_WAIT_MS, transplant: TRANSPLANT_WAIT_MS };
/** A harvester of mine is fetched this long after its end, on the server's clock (R15), and again after
```

**hooks/useFarmController.ts — edit 8 of 21.** Replace:

```ts

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

with:

```ts

/** A picking's animation and bar line: the crop's config digs or picks; rice (a database without 0016) is cut. */
function workLook(p: PlotView | undefined, catalog: FarmCatalog | null, plot: number): { anim: FarmAnim; text: string } {
  const u = p?.crop?.kind === "upland" ? catalog?.uplands.find((x) => x.id === p.crop!.upland) : undefined;
  if (u) return { anim: u.harvestAnim === "dig" ? FARM_ANIM.dig : FARM_ANIM.pick, text: `🧺 Đang ${lower(u.harvestLabel)} thửa ${plot}…` };
  return { anim: FARM_ANIM.harvest, text: `🌾 Đang gặt thửa ${plot}…` };
}

/** Everything farming for the game shell (spec §7–§8, §12–§13; v15.2 §6, §12–§13; v15.3 §8): the field, the clock, the
 *  prompts, the panels, the due tasks and the plots on the canvas, the newcomer gift, the actions with their animations
 *  (`fa`) and the others' refetch (`fp`), the 3-second pickings, the harvest and transplant rounds and the end of my
 *  harvesters. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
```

**hooks/useFarmController.ts — edit 9 of 21.** Replace:

```ts

  // --- 3-second jobs: begin_work, the progress (movement locked), then the action with q = 1.0
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

with:

```ts

  // --- 3-second pickings: begin_work, the progress (movement locked), then harvest with q = 1.0
  const workTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
```

**hooks/useFarmController.ts — edit 10 of 21.** Replace:

```ts
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    const look = workLook(begun.state.plots.find((p) => p.no === plot), live.current.catalog, w, plot);
    c?.farmAnim(look.anim);
```

with:

```ts
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    const look = workLook(begun.state.plots.find((p) => p.no === plot), live.current.catalog, plot);
    c?.farmAnim(look.anim);
```

**hooks/useFarmController.ts — edit 11 of 21.** Replace:

```ts

  // --- harvest rounds (v15.2 §6.2): begin_work, the game with fa 2 every 2 s, then harvest_part — a pass 9 s after the
  // begin_work answer, a fail at once. Esc sends nothing: the server's record expires or the next begin_work replaces it.
  const roundAnim = useRef<ReturnType<typeof setInterval> | null>(null);
```

with:

```ts

  // --- rounds (v15.2 §6.2, v15.3 §8): begin_work, the game with its fa re-sent every 2 s (2 cuts rice, 1 transplants),
  // then the claim of a pass 9 s after the begin_work answer, harvest_part or transplant. A lost harvest round is
  // reported at once; a lost transplant round sends nothing. Esc sends nothing: the server's record expires or the next
  // begin_work replaces it.
  const roundAnim = useRef<ReturnType<typeof setInterval> | null>(null);
```

**hooks/useFarmController.ts — edit 12 of 21.** Replace:

```ts
  const roundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A lost round's report: it clears the server's record, so the next begin_work waits until it has landed. */
  const lostReport = useRef<Promise<unknown> | null>(null);
```

with:

```ts
  const roundTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** A lost harvest round's report: it clears the server's record, so the next begin_work waits until it has landed. */
  const lostReport = useRef<Promise<unknown> | null>(null);
```

**hooks/useFarmController.ts — edit 13 of 21.** Replace:

```ts
  }, []);
  const startRound = useCallback(async (plot: number): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
```

with:

```ts
  }, []);
  const startRound = useCallback(async (plot: number, game: FarmRound["game"]): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
```

**hooks/useFarmController.ts — edit 14 of 21.** Replace:

```ts
    await lostReport.current;
    const begun = closes.current === closed ? await run({ kind: "begin_work", plot, work: "harvest" }) : null;
    setBusy(false);
```

with:

```ts
    await lostReport.current;
    const begun = closes.current === closed ? await run({ kind: "begin_work", plot, work: game }) : null;
    setBusy(false);
```

**hooks/useFarmController.ts — edit 15 of 21.** Replace:

```ts
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    c?.farmAnim(FARM_ANIM.harvest);
    if (roundAnim.current) clearInterval(roundAnim.current);
    roundAnim.current = setInterval(() => canvas()?.farmAnim(FARM_ANIM.harvest), ROUND_FA_MS);
    setPanel(null);
    const parts = begun.state.plots.find((p) => p.no === plot)?.crop?.parts ?? 0;
    const r: FarmRound = {
      plot, part: parts + 1, seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), phase: "playing", score: null,
      result: null, message: null, slow: false,
    };
    setRound(r);
    // a round left idle ends before the server's window would refuse its claim, and its fa 2 with it
    if (roundTimer.current) clearTimeout(roundTimer.current);
```

with:

```ts
    if (spot) c?.plant(spot.use, spot.face ?? "up");
    const anim = ROUND_ANIM[game];
    c?.farmAnim(anim);
    if (roundAnim.current) clearInterval(roundAnim.current);
    roundAnim.current = setInterval(() => canvas()?.farmAnim(anim), ROUND_FA_MS);
    setPanel(null);
    const crop = begun.state.plots.find((p) => p.no === plot)?.crop;
    const r: FarmRound = {
      game, plot, part: game === "harvest" ? (crop?.parts ?? 0) + 1 : 0, ot: crop?.kind === "upland",
      seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), phase: "playing", score: null, result: null, message: null,
      slow: false,
    };
    setRound(r);
    // a round left idle ends before the server's window would refuse its claim, and its fa with it
    if (roundTimer.current) clearTimeout(roundTimer.current);
```

**hooks/useFarmController.ts — edit 16 of 21.** Replace:

```ts
      stopRoundAnim();
      setRound({ ...r, phase: "refused", message: WORK_EXPIRED });
    }, ROUND_LIMIT_MS);
```

with:

```ts
      stopRoundAnim();
      setRound({ ...r, phase: "refused", message: game === "harvest" ? WORK_EXPIRED : WORK_EXPIRED_TP });
    }, ROUND_LIMIT_MS);
```

**hooks/useFarmController.ts — edit 17 of 21.** Replace:

```ts
  }, [run, canvas, stopRoundAnim]);
  const claimPart = useCallback(async (r: FarmRound) => {
    // a claim slow on its way lets the overlay close; its answer still lands in the state
```

with:

```ts
  }, [run, canvas, stopRoundAnim]);
  const claimRound = useCallback(async (r: FarmRound) => {
    // a claim slow on its way lets the overlay close; its answer still lands in the state
```

**hooks/useFarmController.ts — edit 18 of 21.** Replace:

```ts
    let refusal: string | null = null;
    const ans = await run({ kind: "harvest_part", plot: r.plot, success: true }, undefined, (text) => { refusal = text; });
    clearTimeout(slow);
    if (roundTimer.current === slow) roundTimer.current = null;
    // the part changed the plot for everyone, even when the overlay was closed meanwhile
    if (ans) canvas()?.plotChanged(r.plot);
```

with:

```ts
    let refusal: string | null = null;
    const refused = (text: string) => { refusal = text; };
    // the transplant's quality is ignored for good, and always 1 (v15.3 R20)
    const ans = r.game === "harvest"
      ? await run({ kind: "harvest_part", plot: r.plot, success: true }, undefined, refused)
      : await run({ kind: "transplant", plot: r.plot, quality: 1 }, undefined, refused);
    clearTimeout(slow);
    if (roundTimer.current === slow) roundTimer.current = null;
    // the claim changed the plot for everyone, even when the overlay was closed meanwhile
    if (ans) canvas()?.plotChanged(r.plot);
```

**hooks/useFarmController.ts — edit 19 of 21.** Replace:

```ts
      setRound({ ...r, phase: "lost", score });
      // reported at once, with no gate: it clears the server's record and cuts nothing (R7)
      lostReport.current = run({ kind: "harvest_part", plot: r.plot, success: false }, undefined, () => {});
      return;
```

with:

```ts
      setRound({ ...r, phase: "lost", score });
      // a harvest round's fail is reported at once, with no gate: it clears the server's record and cuts nothing (v15.2
      // R7); a transplant round's sends nothing (v15.3 R19)
      if (r.game === "harvest") {
        lostReport.current = run({ kind: "harvest_part", plot: r.plot, success: false }, undefined, () => {});
      }
      return;
```

**hooks/useFarmController.ts — edit 20 of 21.** Replace:

```ts
      roundTimer.current = null;
      void claimPart(waiting);
    }, Math.max(0, r.begunAt + PART_WAIT_MS - Date.now()));
  }, [run, stopRoundAnim, claimPart]);
  const nextRound = useCallback(() => {
    const r = live.current.round;
    if (r && !roundOn(r)) void startRound(r.plot);
  }, [startRound]);
```

with:

```ts
      roundTimer.current = null;
      void claimRound(waiting);
    }, Math.max(0, r.begunAt + ROUND_WAIT_MS[r.game] - Date.now()));
  }, [run, stopRoundAnim, claimRound]);
  const nextRound = useCallback(() => {
    const r = live.current.round;
    if (r && !roundOn(r)) void startRound(r.plot, r.game);
  }, [startRound]);
```

**hooks/useFarmController.ts — edit 21 of 21.** Replace:

```ts
    if (a.kind === "work") return startWork(a.plot, a.work, done);
    if (a.kind === "round") return startRound(a.plot);
    setBusy(true);
```

with:

```ts
    if (a.kind === "work") return startWork(a.plot, a.work, done);
    if (a.kind === "round") return startRound(a.plot, a.game);
    setBusy(true);
```

**lib/game/overlays.ts.** Replace:

```ts
  farmPanel: boolean;
  /** A 3-second job (transplanting, a picking) is under way. */
  farmWork: boolean;
  /** A harvest round (HarvestGame) is open (v15.2 §6.2): the avatar stays at the plot. */
  farmRound: boolean;
```

with:

```ts
  farmPanel: boolean;
  /** A 3-second picking is under way. */
  farmWork: boolean;
  /** A round is open, HarvestGame (v15.2 §6.2) or TransplantGame (v15.3 §8): the avatar stays at the plot. */
  farmRound: boolean;
```

Create `components/game/farm/TransplantGame.tsx` with exactly:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import type { FarmRound } from "@/hooks/useFarmController";
import { drawTransplantScene, TRANSPLANT_SCENE } from "@/lib/game/art/gather-art";
import { transplantDoneText } from "@/lib/game/farm/messages";
import {
  createTransplantRound, scoreText, stepTransplantRound, TRANSPLANT, transplantMarkText, type TransplantRound,
} from "@/lib/game/farm/minigames";
import { isTyping } from "@/lib/game/keys";

/** The round's help line (v15.3 §13.3). */
export function transplantHelp(ot: boolean): string {
  return `Bấm Space (hoặc chạm, bấm chuột) khi bàn tay vào vùng xanh để cắm ${ot ? "cây ớt" : "khóm mạ"} cho thẳng hàng.`;
}

/** The mud, the row and the sweeping hand, drawn on a 160 × 48 canvas that CSS scales up in whole pixels (§15). The
 *  lines below it say the same in words. */
function Scene({ s, ot }: { s: TransplantRound; ot: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ctx = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (ctx.current === undefined) ctx.current = canvas.getContext("2d");
    const c = ctx.current;
    if (!c) return;
    const sweep = s.stage === "sweep";
    drawTransplantScene(c, {
      hills: s.hills, centre: sweep ? s.centres[s.hills.length] : null, x: sweep ? s.x : null, ot, t: s.elapsedMs,
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
  }, [s, ot]);
  return (
    <canvas ref={ref} width={TRANSPLANT_SCENE.w} height={TRANSPLANT_SCENE.h} aria-hidden="true"
      className="w-80 max-w-full [image-rendering:pixelated]" />
  );
}

/** The round itself (§8.2): a seeded TransplantRound stepped every frame; a press is Space, a click or a tap. Its end
 *  goes to `onEnd` once. */
function Playing({ round, onEnd }: { round: FarmRound; onEnd: (pass: boolean, score: number) => void }) {
  const [s, setS] = useState(() => createTransplantRound(round.seed));
  /** A press since the last frame. */
  const pressed = useRef(false);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    let cur = createTransplantRound(round.seed);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepTransplantRound(cur, Math.max(0, t - last) / 1000, pressed.current);
      pressed.current = false;
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
    // a held key's repeats are not presses
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || isTyping(e.target)) return;
      e.preventDefault();
      pressed.current = true;
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, []);

  const press = () => { pressed.current = true; };
  const last = s.stage === "beat" ? s.hills[s.hills.length - 1] : undefined;
  return (
    // the whole block takes a click or a tap
    <div role="group" aria-label={round.ot ? "Hàng cây" : "Hàng mạ"} onPointerDown={press}
      className="flex w-full touch-none select-none flex-col items-center gap-2 py-1">
      <Scene s={s} ot={round.ot} />
      <p aria-live="polite">
        {round.ot ? "Cây" : "Khóm"} {Math.min(s.hills.length + 1, TRANSPLANT.hills)}/{TRANSPLANT.hills} · {scoreText(s.score)} điểm
        {s.stage === "lead" && <b> · Sẵn sàng…</b>}
        {last && <b className={last.score === 0 ? "text-burgundy" : undefined}> · {transplantMarkText(last.mark, round.ot)}</b>}
      </p>
      <p className="text-base opacity-80">{transplantHelp(round.ot)}</p>
    </div>
  );
}

/** TransplantGame (v15.3 §13.3): the round, "Đang cắm nốt hàng mạ…" while a pass waits out its 9 s, then the rice
 *  transplanted or the ớt set out, a failed round's score or the server's refusal. Esc or "Huỷ" closes it and sends
 *  nothing; an Esc typed into a text field, or one for another open overlay, is not its own. While the claim is on its
 *  way Esc waits, until the claim is slow: then "Nghỉ tay" or Esc closes it too. */
export default function TransplantGame({ round, busy, panelOpen, onEnd, onNext, onClose }: {
  round: FarmRound;
  busy: boolean;
  panelOpen: boolean;
  onEnd: (pass: boolean, score: number) => void;
  onNext: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (panelOpen || (round.phase === "waiting" && !round.slow)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, round.phase, round.slow, onClose]);

  const title = round.ot ? `Trồng cây ớt con thửa ${round.plot}` : `Cấy lúa thửa ${round.plot}`;
  const button = (label: string, onClick: () => void, primary = false) => (
    <button type="button" className={`pch-btn${primary ? " pch-btn-primary" : ""}`} disabled={busy} onClick={onClick}>{label}</button>
  );
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="pch flex w-96 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">{round.ot ? "🌶\uFE0F" : "🌱"} {title}</h2>
        {round.phase === "playing" && (
          <>
            <Playing round={round} onEnd={onEnd} />
            {button("Huỷ (Esc)", onClose)}
          </>
        )}
        {round.phase === "waiting" && (
          <>
            <p role="status">{round.ot ? "Đang cắm nốt hàng cây…" : "Đang cắm nốt hàng mạ…"}</p>
            {round.slow && button("Nghỉ tay", onClose)}
          </>
        )}
        {round.phase === "won" && (
          <>
            <p role="status">{transplantDoneText(round.plot, round.ot)}</p>
            {button("Đóng", onClose, true)}
          </>
        )}
        {(round.phase === "lost" || round.phase === "refused") && (
          <>
            <p role="status" className="text-burgundy">
              {round.phase === "lost"
                ? `❌ Được ${scoreText(round.score ?? 0)}/${TRANSPLANT.hills} điểm — cần ${TRANSPLANT.pass}. Thử lại ngay nhé!`
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

**components/game/farm/FarmOverlays.tsx — edit 1 of 3.** Replace:

```tsx
import RiceDepotPanel from "./RiceDepotPanel";

/** A 3-second job (transplanting, setting out the ớt, a picking): its line, a bar that fills in WORK_MS, and "Huỷ" (or
 *  Esc) before it is sent. An Esc typed into a text field, or one that closes an open panel, is not for the work (v13/v14
 *  input rules). */
function WorkProgress({ work, panelOpen, onCancel }: { work: FarmWork; panelOpen: boolean; onCancel: () => void }) {
```

with:

```tsx
import RiceDepotPanel from "./RiceDepotPanel";
import TransplantGame from "./TransplantGame";

/** A 3-second picking: its line, a bar that fills in WORK_MS, and "Huỷ" (or Esc) before it is sent. An Esc typed into a
 *  text field, or one that closes an open panel, is not for the work (v13/v14 input rules). */
function WorkProgress({ work, panelOpen, onCancel }: { work: FarmWork; panelOpen: boolean; onCancel: () => void }) {
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 3.** Replace:

```tsx

/** The field on top of the world (spec §13): the banner before the migration, the work progress, a harvest round
 *  (v15.2 §13.2) and the field's panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

with:

```tsx

/** The field on top of the world (spec §13): the banner before the migration, the work progress, a round (HarvestGame,
 *  v15.2 §13.2; TransplantGame, v15.3 §13.3) and the field's panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

**components/game/farm/FarmOverlays.tsx — edit 3 of 3.** Replace:

```tsx
      )}
      {round && (
        // a new round (Gặt tiếp, Thử lại) starts a new game
        <HarvestGame key={round.begunAt} round={round} busy={busy} panelOpen={panelOpen || panel !== null} varietyName={varietyName}
          onEnd={farm.endRound} onNext={farm.nextRound} onClose={farm.closeRound} />
```

with:

```tsx
      )}
      {round?.game === "harvest" && (
        // a new round (Gặt tiếp, Thử lại) starts a new game
        <HarvestGame key={round.begunAt} round={round} busy={busy} panelOpen={panelOpen || panel !== null} varietyName={varietyName}
          onEnd={farm.endRound} onNext={farm.nextRound} onClose={farm.closeRound} />
      )}
      {round?.game === "transplant" && (
        <TransplantGame key={round.begunAt} round={round} busy={busy} panelOpen={panelOpen || panel !== null}
          onEnd={farm.endRound} onNext={farm.nextRound} onClose={farm.closeRound} />
```

**components/game/farm/PlotPanel.tsx.** Replace:

```tsx
};
/** The actions toasted by their own button: "Đã bón phân urê.", "Đã trồng dây khoai.", "Đã lật dây." (v15.2 §13.6). */
const BY_LABEL: ReadonlySet<string> = new Set(["fert", "spray", "plant", "tend", "set_out"]);
const doneText = (a: PlotAction): string | undefined => {
```

with:

```tsx
};
/** The actions toasted by their own button: "Đã bón phân urê.", "Đã trồng dây khoai.", "Đã lật dây." (v15.2 §13.6). A
 *  round's game says its own end. */
const BY_LABEL: ReadonlySet<string> = new Set(["fert", "spray", "plant", "tend"]);
const doneText = (a: PlotAction): string | undefined => {
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (7 files, 114 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/farm/FarmOverlays.tsx components/game/farm/PlotPanel.tsx components/game/farm/TransplantGame.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/farm/actions.ts lib/game/farm/catalog.ts lib/game/farm/messages.ts lib/game/overlays.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-harvest-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-transplant-game.test.tsx tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): TransplantGame — Cấy lúa and Trồng cây ớt con are rounds

The plot panel's Cấy lúa and Trồng cây ớt con open a TransplantGame round, with its hint,
and wait in the lease's last 25 s as a rice round does ("Sắp hết hạn thuê — không kịp
cấy."). The controller plays it as it plays a harvest round: begin_work('transplant'),
fa 1 every 2 s, the idle end at 110 s ("Lượt cấy đã quá lâu — bắt đầu lại nhé."), and a
pass claimed with transplant(plot, 1) 9 s after the answer, Nghỉ tay once the claim is
slow; a fail sends nothing and Thử lại begins again. The 3-second job is now a hoa-màu
picking only. The overlay draws the row on a pixel canvas and says each hill's mark;
begin_work's refusals for a transplant read in the transplant's words.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/farm/FarmOverlays.tsx components/game/farm/PlotPanel.tsx components/game/farm/TransplantGame.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/farm/actions.ts lib/game/farm/catalog.ts lib/game/farm/messages.ts lib/game/overlays.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-harvest-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/farm-transplant-game.test.tsx tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 11: Crab holes — E at a ready hole opens CrabGame

**Files:**
- Create: `components/game/farm/CrabGame.tsx`
- Modify: `hooks/useField.ts`, `hooks/useFarmController.ts`, `lib/game/overlays.ts`, `components/game/farm/FarmOverlays.tsx`, `components/game/GameShell.tsx`
- Test: `tests/unit/farm-crab-game.test.tsx` (create); `tests/unit/use-farm-controller.test.tsx`, `anticheat-pins.test.tsx`, `farm-overlays.test.tsx`, `game-overlays.test.ts` (modify)

**Interfaces:**
- Consumes: Task 5 (`crabStart`, `crabFinish`, `CrabVisit`, `RPCS_153`, `CRAB_FINISH_WAIT_MS`, `heldBox`), Task 6 (`spotState`, the `crab_hole` interactables and their `spot`), Task 7 (`NOT_OPEN_153`, `GATHER_LIMIT_TEXT`, `crittersFullText`, `holeEmptyText`, `bedEmptyText`, `CRAB_GAVE_UP`, `crabResultText`, the `crab_finish` context), Task 8 (`CRAB`, `createCrabRound`, `stepCrabRound`, `CRAB_MARK`, `crabClosed`), Task 9 (`drawCrabScene`, `CRAB_SCENE`); the canvas's `plant` and farm animation, `ROUND_FA_MS`, `FARM_ANIM`, `FIELD_LOADING`.
- Produces:
  - `useField`: `crabStart(hole)`, `crabFinish(visitId, hits, onError?)`; a missing RPC of `RPCS_153` toasts `NOT_OPEN_153` and leaves the field's "chưa mở" banner off;
  - `useFarmController`: `FarmCrab { hole, visit, seed, begunAt, phase: "playing" | "waiting" | "done" | "refused", hits, message }`; `crab`, `endCrab(hits)`, `closeCrab()`; E at a `crab_hole` says why it cannot be visited (loading, `NOT_OPEN_153`, the limit, full, cooling) or calls `crab_start(spot)`, stands the avatar at the hole and re-sends `fa 6` every 2 s; the end sends hits ≥ 1 no earlier than `CRAB_FINISH_WAIT_MS` after the answer and hits 0 at once; "Dừng" follows R8 (nothing sent before a try ends, and `CRAB_GAVE_UP`; a catch on its way is still sent and toasted); a `crab_start` answer that comes back after the field was left is dropped (the rounds' `closes` counter);
  - `CrabGame.tsx`: `CRAB_HELP` and the overlay (§13.2): the scene, "Lần {n}/3 · bắt được {h}" with the claws' state, an `aria-live` mark line, "Đang bỏ cua vào xô…", the result, "Dừng (Esc)", "Đóng";
  - `lib/game/overlays.ts`: `OpenOverlays.farmCrab` (beside v16's `cardPanel` and `rulesBook`) locks the canvas's input like a round; `GameShell` passes `farm.crab !== null`; `FarmOverlays` shows CrabGame.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/farm-crab-game.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrabGame, { CRAB_HELP } from "@/components/game/farm/CrabGame";
import type { FarmCrab } from "@/hooks/useFarmController";
import { CRAB, createCrabRound } from "@/lib/game/farm/minigames";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const crab = (over: Partial<FarmCrab> = {}): FarmCrab => ({
  hole: 3, visit: { id: "v1", hole: 3, startedAt: 1 }, seed: 5, begunAt: 1, phase: "playing", hits: null, message: null, ...over,
});
function show(c: FarmCrab, over: { panelOpen?: boolean } = {}) {
  const props = { onEnd: vi.fn(), onClose: vi.fn() };
  render(<CrabGame crab={c} panelOpen={over.panelOpen ?? false} {...props} />);
  return props;
}
/** Frames of 16 ms for `ms`. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const space = (target: Window | Element = window) => fireEvent.keyDown(target, { code: "Space", key: " " });
/** From the game's start: try 1's claws well inside a closed stretch, and well inside an open one (its period 1.2 s). */
const P = CRAB.periodsMs[0], p0 = createCrabRound(5).phases[0];
const CLOSED_AT = CRAB.leadMs + ((((CRAB.openShare * P - p0) % P) + P) % P) + 150;
const OPEN_AT = CRAB.leadMs + (((P - p0) % P) + P) % P + 150;

describe("CrabGame (v15.3 §13.2)", () => {
  it("names the hole, with the help, the try, the catch so far and the crab lurking", () => {
    show(crab());
    expect(screen.getByRole("heading", { name: "🦀 Bắt cua · hang 3" })).toBeInTheDocument();
    expect(screen.getByText(CRAB_HELP)).toBeInTheDocument();
    expect(CRAB_HELP).toBe("Cua giơ càng mở ra khép vào. Bấm Space (hoặc chạm, bấm chuột) lúc càng KHÉP để chộp — càng mở mà chộp là bị cua kẹp!");
    expect(screen.getByText(/Lần 1\/3 · bắt được 0/)).toBeInTheDocument();
    expect(screen.getByText(/Cua đang rình…/)).toBeInTheDocument();
  });

  it("writes the claws' state, and grabs with Space while they are closed: Bắt được!", () => {
    show(crab());
    run(16);
    run(CLOSED_AT - 16);
    expect(screen.getByText(/Càng khép — chộp!/)).toBeInTheDocument();
    space();
    run(32);
    expect(screen.getByText(/bắt được 1/)).toBeInTheDocument();
    expect(screen.getByText("Lần 1: Bắt được!")).toBeInTheDocument();
  });

  it("is pinched by a grab while the claws are open, by a click or a tap", () => {
    show(crab());
    run(16);
    run(OPEN_AT - 16);
    expect(screen.getByText(/Càng mở/)).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("group", { name: "Hang cua" }));
    run(32);
    expect(screen.getByText(/bắt được 0/)).toBeInTheDocument();
    expect(screen.getByText("Lần 1: Á! Bị cua kẹp")).toBeInTheDocument();
  });

  it("ignores Space typed into a text field, and a held key's repeats", () => {
    render(<input aria-label="Chat" />);
    show(crab());
    run(16);
    run(CLOSED_AT - 16);
    space(screen.getByRole("textbox", { name: "Chat" }));
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    run(32);
    expect(screen.queryByText(/^Lần 1: /)).toBeNull();
  });

  it("reports the game's end once: three slips catch nothing", () => {
    const { onEnd, onClose } = show(crab());
    run(15_500);
    expect(onEnd.mock.calls).toEqual([[0]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Lần 3: Cua chui mất")).toBeInTheDocument();
  });

  it("Dừng before the first try ends sends nothing; after a try it reports the hits so far (R8)", () => {
    const early = show(crab());
    run(300);
    fireEvent.click(screen.getByRole("button", { name: "Dừng (Esc)" }));
    expect(early.onClose).toHaveBeenCalledTimes(1);
    expect(early.onEnd).not.toHaveBeenCalled();
    cleanup();
    const late = show(crab());
    run(16);
    run(CLOSED_AT - 16);
    space();
    run(32);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(late.onEnd.mock.calls).toEqual([[1]]);
    expect(late.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    run(20_000);
    expect(late.onEnd).toHaveBeenCalledTimes(1);
  });

  it("puts a catch in the bucket for its 4 s; Dừng closes it, and the catch still goes", () => {
    const { onClose } = show(crab({ phase: "waiting", hits: 2 }));
    expect(screen.getByText("Đang bỏ cua vào xô…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dừng (Esc)" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows the result or the refusal, with Đóng; an Esc for another overlay is not its own", () => {
    const done = show(crab({ phase: "done", hits: 2, message: "🦀 Bắt được 2 con: 2 cua đồng!" }));
    expect(screen.getByText("🦀 Bắt được 2 con: 2 cua đồng!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(done.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const refused = show(crab({ phase: "refused", hits: 3, message: "Lâu quá, cua chui mất rồi — lát nữa quay lại nhé." }), { panelOpen: true });
    expect(screen.getByText("Lâu quá, cua chui mất rồi — lát nữa quay lại nhé.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(refused.onClose).not.toHaveBeenCalled();
  });
});
```

**tests/unit/use-farm-controller.test.tsx — edit 1 of 5.** Replace:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { farmItemFromRow, PART_WAIT_MS, PART_WINDOW_MS, uplandFromRow, varietyFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import { TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import { GIFT_TEXT, NOT_OPEN } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable } from "@/lib/game/maps/types";
import { FARM_ANIM } from "@/lib/game/net/protocol";
```

with:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import {
  critterFromRow, farmItemFromRow, PART_WAIT_MS, PART_WINDOW_MS, uplandFromRow, varietyFromRow, type UplandCropRow,
} from "@/lib/game/farm/catalog";
import { CRAB_FINISH_WAIT_MS, TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import { CRAB_GAVE_UP, GATHER_LIMIT_TEXT, GIFT_TEXT, NOT_OPEN, NOT_OPEN_153 } from "@/lib/game/farm/messages";
import { parseFarmMine, parseFieldState, type FieldState } from "@/lib/game/farm/state";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId } from "@/lib/game/maps/types";
import { FARM_ANIM } from "@/lib/game/net/protocol";
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 5.** Replace:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
}));
```

with:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
}));
```

**tests/unit/use-farm-controller.test.tsx — edit 3 of 5.** Replace:

```tsx

/** Plot 5: my ripe nếp, drained, with brown planthoppers (I have a sickle); plot 6: Lan's; plot 1: for sale. */
const field = (over: { coins?: number; giftClaimed?: boolean; crop5?: Record<string, unknown> | null; wet?: number } = {}): FieldState => parseFieldState({
  server_now: iso(0),
```

with:

```tsx

/** Plot 5: my ripe nếp, drained, with brown planthoppers (I have a sickle); plot 6: Lan's; plot 1: for sale. `mine` adds
 *  to my part of the answer. */
const field = (over: {
  coins?: number; giftClaimed?: boolean; crop5?: Record<string, unknown> | null; wet?: number; mine?: Record<string, unknown>;
} = {}): FieldState => parseFieldState({
  server_now: iso(0),
```

**tests/unit/use-farm-controller.test.tsx — edit 4 of 5.** Replace:

```tsx
    items: { spray_hopper: 1, tool_sickle: 1 }, rice: { nep: { wet: over.wet ?? 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [],
  },
```

with:

```tsx
    items: { spray_hopper: 1, tool_sickle: 1 }, rice: { nep: { wet: over.wet ?? 0, dry: 50 } }, coins: over.coins ?? 1000,
    gift_claimed: over.giftClaimed ?? true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [], ...over.mine,
  },
```

**tests/unit/use-farm-controller.test.tsx — edit 5 of 5.** Replace:

```tsx

describe("useFarmController, the clock while a harvester runs", () => {
```

with:

```tsx

describe("useFarmController, v15.3 crab holes", () => {
  const CRITTERS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
  ];
  const BUCKET = farmItemFromRow({
    id: "box_bucket", kind: "critter_box", name: "Xô nhựa", price: 1500, sort_order: 10, variety: null, fert: null, pest_target: null, capacity: 15,
  });
  const GATHERING = { ...CATALOG, critters: CRITTERS, items: [...CATALOG.items, BUCKET] };
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  const visit = (hole: number) => ({ serverNow: iso(0), mine: field().mine, visit: { id: `v${hole}`, hole, startedAt: NOW } });
  const caught = (kinds: Array<[string, number]>, escaped = 0) => ({
    serverNow: iso(0), mine: field().mine,
    crab: { caught: kinds.map(([kind, price]) => ({ kind, price })), escaped, hits: kinds.length + escaped },
  });
  /** Opens a visit to hole `hole` at a ready hole. */
  async function start(result: { current: ReturnType<typeof useFarmController> }, hole: number) {
    rpc.crabStart.mockResolvedValueOnce(visit(hole));
    await act(async () => {
      expect(result.current.interact(spot(`crab_${hole}`))).toBe(true);
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  beforeEach(() => {
    rpc.fetchFarmCatalog.mockResolvedValue(GATHERING);
  });

  it("starts a visit at a ready hole: crab_start with its spot, the avatar at the hole, fa 6 every 2 s", async () => {
    const { result, canvas } = setup();
    await flush();
    await start(result, 3);
    expect(rpc.crabStart).toHaveBeenCalledWith("r", "tok", 3);
    expect(canvas.plant).toHaveBeenCalledWith(spot("crab_3").use, spot("crab_3").face);
    expect(result.current.crab).toMatchObject({ hole: 3, visit: { id: "v3", hole: 3 }, phase: "playing", hits: null });
    expect(fa(canvas, FARM_ANIM.crab)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(fa(canvas, FARM_ANIM.crab)).toBe(3);
  });

  it("sends a catch no earlier than 4 s after crab_start's answer, and shows what it brought", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    await start(result, 3);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    act(() => result.current.endCrab(2));
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.crab).toMatchObject({ phase: "waiting", hits: 2 });
    rpc.crabFinish.mockResolvedValueOnce(caught([["cua_gach", 100], ["cua_dong", 26]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS - 2000 - 1); });
    expect(rpc.crabFinish).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.crabFinish).toHaveBeenCalledWith("r", "tok", "v3", 2);
    expect(result.current.crab).toMatchObject({ phase: "done", message: "🦀 Bắt được 2 con: 1 cua đồng, 1 cua gạch!" });
    act(() => result.current.closeCrab());
    expect(result.current.crab).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("sends hits 0 at once", async () => {
    const { result } = setup();
    await flush();
    await start(result, 1);
    rpc.crabFinish.mockResolvedValueOnce(caught([]));
    await act(async () => {
      result.current.endCrab(0);
      await Promise.resolve();
    });
    expect(rpc.crabFinish).toHaveBeenCalledWith("r", "tok", "v1", 0);
    await flush();
    expect(result.current.crab).toMatchObject({ phase: "done", hits: 0, message: "🦀 Cua chui hết vào hang rồi — 20 phút nữa quay lại nhé." });
  });

  it("Dừng before a try ends sends nothing; during the wait the catch is still sent, and toasted (R8)", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    await start(result, 2);
    act(() => result.current.closeCrab());
    expect(result.current.crab).toBeNull();
    expect(toast).toHaveBeenCalledWith(CRAB_GAVE_UP);
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(rpc.crabFinish).not.toHaveBeenCalled();

    await start(result, 4);
    act(() => result.current.endCrab(1));
    act(() => result.current.closeCrab());
    expect(result.current.crab).toBeNull();
    expect(toast).toHaveBeenCalledTimes(1);
    rpc.crabFinish.mockResolvedValueOnce(caught([["cua_dong", 26]]));
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS); });
    expect(rpc.crabFinish).toHaveBeenCalledWith("r", "tok", "v4", 1);
    expect(toast).toHaveBeenLastCalledWith("🦀 Bắt được 1 con: 1 cua đồng!");
    expect(result.current.crab).toBeNull();
  });

  it("shows a refused finish in the crab's words", async () => {
    const { result, toast } = setup();
    await flush();
    await start(result, 5);
    act(() => result.current.endCrab(3));
    rpc.crabFinish.mockRejectedValueOnce({ message: "visit expired" });
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS); });
    expect(result.current.crab).toMatchObject({ phase: "refused", message: "Lâu quá, cua chui mất rồi — lát nữa quay lại nhé." });
    act(() => result.current.closeCrab());
    await start(result, 6);
    act(() => result.current.endCrab(1));
    rpc.crabFinish.mockRejectedValueOnce({ message: "too fast" });
    await act(async () => { await vi.advanceTimersByTimeAsync(CRAB_FINISH_WAIT_MS); });
    expect(result.current.crab).toMatchObject({ phase: "refused", message: "Chưa bắt xong — thử lại sau vài giây." });
    expect(toast).not.toHaveBeenCalled();
  });

  it("says why a hole cannot be visited: before 0018, the day's limit, full hands or container, a cooling hole", async () => {
    rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
    const before = setup();
    await flush();
    act(() => { expect(before.result.current.interact(spot("crab_1"))).toBe(true); });
    expect(before.toast).toHaveBeenLastCalledWith(NOT_OPEN_153);
    rpc.fetchFarmCatalog.mockResolvedValue(GATHERING);
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ gather: { ready_at: {}, left_today: 0, day_resets_at: iso(5) } }, GATHER_LIMIT_TEXT],
      [{ critters: { cua_dong: { n: 3, xu: 36 } }, critter_cap: 3 }, "Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai."],
      [{ items: { box_bucket: 1 }, critters: { cua_dong: { n: 18, xu: 216 } }, critter_cap: 18 }, "Xô nhựa đầy rồi — ra vựa cô Út bán bớt nhé."],
      [{ gather: { ready_at: { crab1: new Date(NOW + 12 * 60_000).toISOString() }, left_today: 150 } }, "Cua chưa ra — quay lại sau 12 phút."],
    ];
    for (const [mine, text] of cases) {
      rpc.fetchFieldState.mockResolvedValue(field({ mine }));
      const s = setup();
      await flush();
      act(() => { s.result.current.interact(spot("crab_1")); });
      expect(s.toast).toHaveBeenLastCalledWith(text);
    }
    expect(rpc.crabStart).not.toHaveBeenCalled();
  });

  it("says NOT_OPEN_153 when crab_start is missing, and leaves the field open", async () => {
    const { result, toast } = setup();
    await flush();
    rpc.crabStart.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.crab_start" });
    await act(async () => {
      result.current.interact(spot("crab_2"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(toast).toHaveBeenCalledWith(NOT_OPEN_153);
    expect(result.current.data.notOpen).toBe(false);
    expect(result.current.crab).toBeNull();
  });

  it("drops a crab_start answer that comes back after I left the field", async () => {
    const canvas = handle();
    const view = renderHook(({ mapId }: { mapId: MapId }) => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId, canvas: () => canvas, toast: vi.fn(), onCoinsChanged: () => {},
    }), { initialProps: { mapId: "field" as MapId } });
    await flush();
    let started!: (a: unknown) => void;
    rpc.crabStart.mockReturnValueOnce(new Promise((resolve) => { started = resolve; }));
    act(() => { view.result.current.interact(spot("crab_3")); });
    expect(rpc.crabStart).toHaveBeenCalledWith("r", "tok", 3);
    view.rerender({ mapId: "pond" });
    await flush();
    await act(async () => { started(visit(3)); await vi.advanceTimersByTimeAsync(ROUND_FA_MS * 2); });
    expect(view.result.current.crab).toBeNull();
    expect(fa(canvas, FARM_ANIM.crab)).toBe(0);
  });
});

describe("useFarmController, the clock while a harvester runs", () => {
```

**tests/unit/anticheat-pins.test.tsx — edit 1 of 4.** Replace:

```tsx
import CoopPanel from "@/components/game/farm/CoopPanel";
import DryingPanel from "@/components/game/farm/DryingPanel";
```

with:

```tsx
import CoopPanel from "@/components/game/farm/CoopPanel";
import CrabGame from "@/components/game/farm/CrabGame";
import DryingPanel from "@/components/game/farm/DryingPanel";
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 4.** Replace:

```tsx
import {
  DRYING_SLOTS, farmItemFromRow, TEND_ACTS, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
```

with:

```tsx
import {
  critterFromRow, DRYING_SLOTS, farmItemFromRow, TEND_ACTS, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
```

**tests/unit/anticheat-pins.test.tsx — edit 3 of 4.** Replace:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
```

with:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
}));
```

**tests/unit/anticheat-pins.test.tsx — edit 4 of 4.** Append at the end of the file, after a blank line:

```tsx
describe("bad_spot and bad_qty (v15.3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const f of Object.values(rpc)) f.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the field's holes are 1–6 and its beds 1–4, and a visit sends its hole's spot", async () => {
    const spots = (kind: string) => getMap("field").interactables.filter((i) => i.kind === kind).map((i) => i.spot);
    expect(spots("crab_hole").sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(spots("snail_bed").sort()).toEqual([1, 2, 3, 4]);
    rpc.fetchFieldState.mockResolvedValue(STATE);
    rpc.fetchFarmCatalog.mockResolvedValue({
      ...FARM, critters: [critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 })],
    });
    rpc.crabStart.mockImplementation(async (_room: string, _token: string, hole: number) => ({
      serverNow: iso(0), mine: STATE.mine, visit: { id: `v${hole}`, hole, startedAt: NOW },
    }));
    const canvas = { setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn() } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId: "field", canvas: () => canvas, toast: noop, onCoinsChanged: noop,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (const it of getMap("field").interactables.filter((i) => i.kind === "crab_hole")) {
      await act(async () => {
        result.current.interact(it);
        await vi.advanceTimersByTimeAsync(0);
      });
      act(() => result.current.closeCrab());
    }
    expect(rpc.crabStart.mock.calls.map(([, , hole]) => hole).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  // twelve whole games, frame by frame: about 1.5 s alone and several times that on a loaded machine, hence the timeout
  it("CrabGame reports 0–3 hits whatever the input, once", () => {
    let rng = 11;
    for (let game = 0; game < 12; game++) {
      const onEnd = vi.fn();
      render(<CrabGame crab={{ hole: 1, visit: { id: "v", hole: 1, startedAt: 0 }, seed: game, begunAt: 0, phase: "playing", hits: null, message: null }}
        panelOpen={false} onEnd={onEnd} onClose={noop} />);
      for (let t = 0; t < 16_000; t += 50) {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        if (rng % 5 === 0) fireEvent.keyDown(window, { code: "Space", key: " " });
        act(() => { vi.advanceTimersByTime(50); });
      }
      expect(onEnd).toHaveBeenCalledTimes(1);
      const [hits] = onEnd.mock.calls[0] as [number];
      expect(Number.isInteger(hits) && hits >= 0 && hits <= 3).toBe(true);
      cleanup();
    }
  }, 20_000);
});
```

**tests/unit/farm-overlays.test.tsx — edit 1 of 2.** Replace:

```tsx
    state: STATE, catalog: CATALOG, failed: false, notOpen: false, reload: vi.fn(), run: vi.fn(), sellRice: vi.fn(), buyItem: vi.fn(),
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(),
  },
  now: NOW, tasks: [], urgent: 0, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), busy: false, work: null, cancelWork: vi.fn(),
  round: null, endRound: vi.fn(), nextRound: vi.fn(), closeRound: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
```

with:

```tsx
    state: STATE, catalog: CATALOG, failed: false, notOpen: false, reload: vi.fn(), run: vi.fn(), sellRice: vi.fn(), buyItem: vi.fn(),
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
  },
  now: NOW, tasks: [], urgent: 0, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), busy: false, work: null, cancelWork: vi.fn(),
  round: null, endRound: vi.fn(), nextRound: vi.fn(), closeRound: vi.fn(), crab: null, endCrab: vi.fn(), closeCrab: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
```

**tests/unit/farm-overlays.test.tsx — edit 2 of 2.** Replace:

```tsx

  it("opens TransplantGame for a transplant round (v15.3 §13.3)", () => {
```

with:

```tsx

  it("opens CrabGame for a crab visit (v15.3 §13.2)", () => {
    const farm = controller({
      crab: { hole: 4, visit: { id: "v", hole: 4, startedAt: 1 }, seed: 1, begunAt: 1, phase: "done", hits: 1, message: "🦀 Bắt được 1 con: 1 cua đồng!" },
    });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByRole("dialog", { name: "Bắt cua hang 4" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(farm.closeCrab).toHaveBeenCalledTimes(1);
  });

  it("opens TransplantGame for a transplant round (v15.3 §13.3)", () => {
```

**tests/unit/game-overlays.test.ts — edit 1 of 3.** Replace:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  cardPanel: false, rulesBook: false,
};
```

with:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  farmCrab: false, cardPanel: false, rulesBook: false,
};
```

**tests/unit/game-overlays.test.ts — edit 2 of 3.** Replace:

```ts

  it("takes only the canvas input for the field's own panel, the farm work and a harvest round, whose Esc the field handles", () => {
    expect(overlayLocks({ ...none, farmPanel: true })).toEqual({ blocking: true, panelOpen: false });
```

with:

```ts

  it("takes only the canvas input for the field's own panel, the farm work, a round and a crab visit, whose Esc the field handles", () => {
    expect(overlayLocks({ ...none, farmPanel: true })).toEqual({ blocking: true, panelOpen: false });
```

**tests/unit/game-overlays.test.ts — edit 3 of 3.** Replace:

```ts
    expect(overlayLocks({ ...none, farmRound: true })).toEqual({ blocking: true, panelOpen: false });
  });
```

with:

```ts
    expect(overlayLocks({ ...none, farmRound: true })).toEqual({ blocking: true, panelOpen: false });
    expect(overlayLocks({ ...none, farmCrab: true })).toEqual({ blocking: true, panelOpen: false });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-crab-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — `farm-crab-game.test.tsx` and `anticheat-pins.test.tsx` cannot load `@/components/game/farm/CrabGame`, and 10 tests fail (E at a hole does nothing — so there is no late answer to drop either —, no "Bắt cua hang 4" dialog, `farmCrab` locks nothing); 5 files fail.

- [ ] **Step 3: Implement**

**hooks/useField.ts — edit 1 of 5.** Replace:

```ts
import { syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc, NOT_OPEN_152 } from "@/lib/game/farm/messages";
import {
  actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, RPCS_152, sellProduce, sellRice,
  type FieldAction, type FieldAnswer, type MineAnswer,
} from "@/lib/game/farm/rpc";
```

with:

```ts
import { syncClock } from "@/lib/game/farm/clock";
import { farmErrorMessage, isMissingRpc, NOT_OPEN_152, NOT_OPEN_153 } from "@/lib/game/farm/messages";
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, RPCS_152,
  RPCS_153, sellProduce, sellRice, type CatchAnswer, type CrabVisit, type FieldAction, type FieldAnswer, type MineAnswer,
} from "@/lib/game/farm/rpc";
```

**hooks/useField.ts — edit 2 of 5.** Replace:

```ts
  sellProduce: (upland: string, kg: number) => Promise<MineAnswer | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

with:

```ts
  sellProduce: (upland: string, kg: number) => Promise<MineAnswer | null>;
  /** Bắt cua (v15.3 §7.2): a visit to hole `hole` (R6), then its end with the hits, 0–3 (R7); a refusal's text goes to
   *  `onError` when given. */
  crabStart: (hole: number) => Promise<(MineAnswer & { visit: CrabVisit }) | null>;
  crabFinish: (visitId: string, hits: number, onError?: (text: string) => void) =>
    Promise<(MineAnswer & { crab: CatchAnswer & { hits: number } }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

**hooks/useField.ts — edit 3 of 5.** Replace:

```ts
   *  shows no text: the warning or the ban modal shows instead (anti-cheat §12.1). Before 0016 its RPCs are missing while
   *  the field is open: they say NOT_OPEN_152 and leave the field open (v15.2 R28). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void,
```

with:

```ts
   *  shows no text: the warning or the ban modal shows instead (anti-cheat §12.1). Before 0016 its RPCs are missing while
   *  the field is open: they say NOT_OPEN_152 and leave the field open (v15.2 R28); before 0018 the gathering RPCs say
   *  NOT_OPEN_153 (v15.3 R23). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void,
```

**hooks/useField.ts — edit 4 of 5.** Replace:

```ts
    } catch (err) {
      const missing = isMissingRpc(err), v152 = RPCS_152.has(opts.rpc);
      if (missing && !v152) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) {
        (opts.onError ?? onErrorRef.current)(missing && v152 ? NOT_OPEN_152 : farmErrorMessage(err, opts.itemName, opts.context ?? opts.rpc));
      }
```

with:

```ts
    } catch (err) {
      const missing = isMissingRpc(err), v152 = RPCS_152.has(opts.rpc), v153 = RPCS_153.has(opts.rpc);
      if (missing && !v152 && !v153) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) {
        const text = missing && v152 ? NOT_OPEN_152 : missing && v153 ? NOT_OPEN_153 : farmErrorMessage(err, opts.itemName, opts.context ?? opts.rpc);
        (opts.onError ?? onErrorRef.current)(text);
      }
```

**hooks/useField.ts — edit 5 of 5.** Replace:

```ts
      call(() => sellProduce(token, upland, kg), applyMine, { rpc: "sell_produce" }), [call, applyMine, token]),
  };
```

with:

```ts
      call(() => sellProduce(token, upland, kg), applyMine, { rpc: "sell_produce" }), [call, applyMine, token]),
    crabStart: useCallback((hole: number) =>
      call(() => crabStart(roomId, token, hole), applyMine, { rpc: "crab_start" }), [call, applyMine, roomId, token]),
    crabFinish: useCallback((visitId: string, hits: number, onError?: (text: string) => void) =>
      call(() => crabFinish(roomId, token, visitId, hits), applyMine, { rpc: "crab_finish", onError }), [call, applyMine, roomId, token]),
  };
```

**hooks/useFarmController.ts — edit 1 of 15.** Replace:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import { TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import {
  boughtText, GIFT_TEXT, harvestText, harvesterDoneText, loadedText, NOT_OPEN, pickingText, produceSaleText, riceSaleText,
  WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
import type { FieldAction, PartAnswer } from "@/lib/game/farm/rpc";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
```

with:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import { CRAB_FINISH_WAIT_MS, heldBox, spotState, TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import {
  bedEmptyText, boughtText, CRAB_GAVE_UP, crabResultText, crittersFullText, FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText,
  harvesterDoneText, holeEmptyText, loadedText, NOT_OPEN, NOT_OPEN_153, pickingText, produceSaleText, riceSaleText, WORK_EXPIRED,
  WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
import type { CrabVisit, FieldAction, PartAnswer } from "@/lib/game/farm/rpc";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
```

**hooks/useFarmController.ts — edit 2 of 15.** Replace:

```ts

export interface FarmController {
```

with:

```ts

/** A crab visit (v15.3 §7.2): CrabGame plays it at a hole, the controller talks to the server. */
export interface FarmCrab {
  hole: number;
  /** The server's visit, from crab_start. */
  visit: CrabVisit;
  /** Seeds the claws' phases. */
  seed: number;
  /** When crab_start's answer arrived (client ms): a catch is sent CRAB_FINISH_WAIT_MS after it (R7). */
  begunAt: number;
  /** playing → waiting (a catch waits out its 4 s, "Đang bỏ cua vào xô…"; hits 0 go at once) → done; or refused. */
  phase: "playing" | "waiting" | "done" | "refused";
  /** The hits reported. */
  hits: number | null;
  /** What the visit brought, or a refusal, in words. */
  message: string | null;
}

export interface FarmController {
```

**hooks/useFarmController.ts — edit 3 of 15.** Replace:

```ts
  closeRound: () => void;
  /** A land, farming or drying action (a picking starts the progress, a round opens its game); `done` is toasted when it
```

with:

```ts
  closeRound: () => void;
  /** A crab visit, open in CrabGame. */
  crab: FarmCrab | null;
  /** CrabGame ended with `hits` (0–3), by itself or by Dừng after a try: a catch is sent 4 s after crab_start's answer,
   *  hits 0 at once (R7). */
  endCrab: (hits: number) => void;
  /** Dừng, Esc or Đóng (R8): before a try ends nothing is sent; a catch waiting out its 4 s is still sent, and toasted. */
  closeCrab: () => void;
  /** A land, farming or drying action (a picking starts the progress, a round opens its game); `done` is toasted when it
```

**hooks/useFarmController.ts — edit 4 of 15.** Replace:

```ts
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying"]);
```

with:

```ts
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying", "crab_hole"]);
```

**hooks/useFarmController.ts — edit 5 of 15.** Replace:

```ts
const sameRound = (showing: FarmRound | null, r: FarmRound): boolean => showing?.plot === r.plot && showing.begunAt === r.begunAt;
```

with:

```ts
const sameRound = (showing: FarmRound | null, r: FarmRound): boolean => showing?.plot === r.plot && showing.begunAt === r.begunAt;
/** The crab visit showing is still `c`. */
const sameCrab = (showing: FarmCrab | null, c: FarmCrab): boolean => showing?.visit.id === c.visit.id;

/** Why a hole or a bed cannot be visited now (v15.3 §13.1), in the server's refusal order, or null: it is ready. */
function gatherRefusal(it: Interactable, s: FieldState | null, catalog: FarmCatalog | null, now: number): string | null {
  if (!s || !catalog) return FIELD_LOADING;
  // before 0018 the catalog has no critters (R23)
  if (catalog.critters.length === 0) return NOT_OPEN_153;
  const st = spotState(it, s.mine, catalog, now);
  switch (st.kind) {
    case "limit": return GATHER_LIMIT_TEXT;
    case "full": return crittersFullText(st.box?.name ?? null);
    case "cooling": return it.kind === "crab_hole" ? holeEmptyText(st.readyAt - now) : bedEmptyText(st.readyAt - now);
    case "ready": return null;
  }
}
```

**hooks/useFarmController.ts — edit 6 of 15.** Replace:

```ts

/** Everything farming for the game shell (spec §7–§8, §12–§13; v15.2 §6, §12–§13; v15.3 §8): the field, the clock, the
 *  prompts, the panels, the due tasks and the plots on the canvas, the newcomer gift, the actions with their animations
 *  (`fa`) and the others' refetch (`fp`), the 3-second pickings, the harvest and transplant rounds and the end of my
 *  harvesters. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
```

with:

```ts

/** Everything farming for the game shell (spec §7–§8, §12–§13; v15.2 §6, §12–§13; v15.3 §7–§8): the field, the clock,
 *  the prompts, the panels, the due tasks and the plots on the canvas, the newcomer gift, the actions with their
 *  animations (`fa`) and the others' refetch (`fp`), the 3-second pickings, the harvest and transplant rounds, the crab
 *  visits and the end of my harvesters. */
export function useFarmController({ token, roomId, accountId, mapId, canvas, toast, onCoinsChanged }: FarmControllerOptions): FarmController {
```

**hooks/useFarmController.ts — edit 7 of 15.** Replace:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

with:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

**hooks/useFarmController.ts — edit 8 of 15.** Replace:

```ts
  const [round, setRound] = useState<FarmRound | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen, round };
  });
```

with:

```ts
  const [round, setRound] = useState<FarmRound | null>(null);
  const [crab, setCrab] = useState<FarmCrab | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round, crab });
  useEffect(() => {
    live.current = { toast, onCoinsChanged, state, catalog, notOpen, round, crab };
  });
```

**hooks/useFarmController.ts — edit 9 of 15.** Replace:

```ts
  const startWork = useCallback(async (plot: number, w: FarmWork["work"], done?: string): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
    setBusy(true);
```

with:

```ts
  const startWork = useCallback(async (plot: number, w: FarmWork["work"], done?: string): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round) || live.current.crab) return false;
    setBusy(true);
```

**hooks/useFarmController.ts — edit 10 of 15.** Replace:

```ts
  const lostReport = useRef<Promise<unknown> | null>(null);
  /** Counts the overlay's closes: a begin_work answer that comes back after one is dropped. */
  const closes = useRef(0);
```

with:

```ts
  const lostReport = useRef<Promise<unknown> | null>(null);
  /** Counts the round overlay's closes (leaving the field is one): a begin_work or crab_start answer that comes back after
   *  one is dropped. */
  const closes = useRef(0);
```

**hooks/useFarmController.ts — edit 11 of 15.** Replace:

```ts
  const startRound = useCallback(async (plot: number, game: FarmRound["game"]): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round)) return false;
    const closed = closes.current;
```

with:

```ts
  const startRound = useCallback(async (plot: number, game: FarmRound["game"]): Promise<boolean> => {
    if (workTimer.current || roundOn(live.current.round) || live.current.crab) return false;
    const closed = closes.current;
```

**hooks/useFarmController.ts — edit 12 of 15.** Replace:

```ts
  }, [stopRoundAnim]);
  useEffect(() => {
```

with:

```ts
  }, [stopRoundAnim]);

  // --- crab holes (v15.3 §7.2): crab_start, CrabGame with fa 6 every 2 s, then crab_finish — a catch no earlier than 4 s
  // after crab_start's answer, hits 0 at once (R7). Dừng before a try ends sends nothing, and the hole keeps its cooldown;
  // a catch waiting out its 4 s is still sent, and toasted once the overlay has closed (R8).
  const crabAnim = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopCrabAnim = useCallback(() => {
    if (!crabAnim.current) return;
    clearInterval(crabAnim.current);
    crabAnim.current = null;
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);
  useEffect(() => () => {
    if (crabAnim.current) clearInterval(crabAnim.current);
  }, []);
  const startCrab = useCallback(async (it: Interactable): Promise<boolean> => {
    if (it.spot === undefined || workTimer.current || roundOn(live.current.round) || live.current.crab) return false;
    const closed = closes.current;
    setBusy(true);
    const begun = await crabStart(it.spot);
    setBusy(false);
    // the field left meanwhile: the answer is dropped, and the hole keeps its cooldown as after Dừng before a try (R8)
    if (!begun || closes.current !== closed) return false;
    const c = canvas();
    c?.plant(it.use, it.face ?? "down");
    c?.farmAnim(FARM_ANIM.crab);
    if (crabAnim.current) clearInterval(crabAnim.current);
    crabAnim.current = setInterval(() => canvas()?.farmAnim(FARM_ANIM.crab), ROUND_FA_MS);
    setPanel(null);
    setCrab({
      hole: it.spot, visit: begun.visit, seed: Math.floor(Math.random() * 0x7fffffff), begunAt: Date.now(), phase: "playing", hits: null,
      message: null,
    });
    return true;
  }, [crabStart, canvas]);
  const finishCrab = useCallback(async (c: FarmCrab) => {
    let refusal: string | null = null;
    const r = await crabFinish(c.visit.id, c.hits ?? 0, (text) => { refusal = text; });
    const cat = live.current.catalog;
    const text = r ? crabResultText(r.crab, cat?.critters ?? [], heldBox(r.mine.items, cat?.items ?? [])?.name ?? null) : refusal;
    if (!sameCrab(live.current.crab, c)) {
      // closed while the catch waited (R8): what it brought comes as a toast
      if (text !== null) live.current.toast(text);
      return;
    }
    // a strike shows its modal instead of a text
    setCrab(text === null ? null : { ...c, phase: r ? "done" : "refused", message: text });
  }, [crabFinish]);
  const endCrab = useCallback((hits: number) => {
    const c = live.current.crab;
    if (!c || c.phase !== "playing") return;
    stopCrabAnim();
    const waiting: FarmCrab = { ...c, phase: "waiting", hits };
    setCrab(waiting);
    if (hits === 0) {
      void finishCrab(waiting);
      return;
    }
    // not cleared on a close: the catch is kept (R8)
    setTimeout(() => void finishCrab(waiting), Math.max(0, c.begunAt + CRAB_FINISH_WAIT_MS - Date.now()));
  }, [stopCrabAnim, finishCrab]);
  /** Closes the visit's overlay. Before a try ended nothing is sent, which the toast says unless the field was left. */
  const shutCrab = useCallback((told: boolean) => {
    const c = live.current.crab;
    if (!c) return;
    stopCrabAnim();
    if (c.phase === "playing" && told) live.current.toast(CRAB_GAVE_UP);
    setCrab(null);
  }, [stopCrabAnim]);
  const closeCrab = useCallback(() => shutCrab(true), [shutCrab]);

  useEffect(() => {
```

**hooks/useFarmController.ts — edit 13 of 15.** Replace:

```ts
    cancelWork();
    // leaving the field ends a round too (in a task, as the change of map has rendered)
    const t = setTimeout(closeRound, 0);
    return () => clearTimeout(t);
  }, [active, cancelWork, closeRound]);
```

with:

```ts
    cancelWork();
    // leaving the field ends a round and a crab visit too (in a task, as the change of map has rendered)
    const t = setTimeout(() => {
      closeRound();
      shutCrab(false);
    }, 0);
    return () => clearTimeout(t);
  }, [active, cancelWork, closeRound, shutCrab]);
```

**hooks/useFarmController.ts — edit 14 of 15.** Replace:

```ts
        break;
    }
    return true;
  }, []);
  const promptText = useCallback((it: Interactable): string | null => {
```

with:

```ts
        break;
      case "crab_hole": {
        const why = gatherRefusal(it, live.current.state, live.current.catalog, serverNow());
        if (why !== null) live.current.toast(why);
        else void startCrab(it);
        break;
      }
    }
    return true;
  }, [startCrab]);
  const promptText = useCallback((it: Interactable): string | null => {
```

**hooks/useFarmController.ts — edit 15 of 15.** Replace:

```ts
    closeRound,
    act,
```

with:

```ts
    closeRound,
    crab,
    endCrab,
    closeCrab,
    act,
```

**lib/game/overlays.ts — edit 1 of 2.** Replace:

```ts
  farmRound: boolean;
  /** A card table's panel (v16). */
```

with:

```ts
  farmRound: boolean;
  /** A crab visit is open in CrabGame (v15.3 §7.2): the avatar stays at the hole. */
  farmCrab: boolean;
  /** A card table's panel (v16). */
```

**lib/game/overlays.ts — edit 2 of 2.** Replace:

```ts
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal || o.cardPanel || o.rulesBook;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound, panelOpen };
}
```

with:

```ts
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal || o.cardPanel || o.rulesBook;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound || o.farmCrab, panelOpen };
}
```

Create `components/game/farm/CrabGame.tsx` with exactly:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FarmCrab } from "@/hooks/useFarmController";
import { CRAB_SCENE, drawCrabScene } from "@/lib/game/art/gather-art";
import { CRAB, CRAB_MARK, crabClosed, createCrabRound, stepCrabRound, type CrabRound } from "@/lib/game/farm/minigames";
import { isTyping } from "@/lib/game/keys";

export const CRAB_HELP =
  "Cua giơ càng mở ra khép vào. Bấm Space (hoặc chạm, bấm chuột) lúc càng KHÉP để chộp — càng mở mà chộp là bị cua kẹp!";

/** The claws right now: closed while a grab would be a hit (§7.2). */
function clawsClosed(s: CrabRound): boolean {
  const i = s.tries.length;
  return s.stage === "claws" && crabClosed(CRAB.periodsMs[i], s.phases[i], s.stageMs);
}

/** The bank, the hole, the crab and the hand, drawn on a 96 × 64 canvas that CSS scales up in whole pixels (§15). The
 *  lines below it say the same in words. */
function Scene({ s }: { s: CrabRound }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ctx = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (ctx.current === undefined) ctx.current = canvas.getContext("2d");
    const c = ctx.current;
    if (!c) return;
    drawCrabScene(c, {
      closed: clawsClosed(s), lurking: s.stage === "lead", mark: s.stage === "beat" ? s.tries[s.tries.length - 1] : null, t: s.elapsedMs,
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    });
  }, [s]);
  return (
    <canvas ref={ref} width={CRAB_SCENE.w} height={CRAB_SCENE.h} aria-hidden="true"
      className="w-72 max-w-full [image-rendering:pixelated]" />
  );
}

/** The game (§7.2): a seeded CrabRound stepped every frame; a grab is Space, a click or a tap. Its end goes to `onEnd`
 *  once. Dừng or Esc (R8): before the first try ends it closes the game and nothing is sent; after a try it ends the
 *  game with the hits so far. */
function Playing({ crab, panelOpen, onEnd, onClose }: {
  crab: FarmCrab;
  panelOpen: boolean;
  onEnd: (hits: number) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState(() => createCrabRound(crab.seed));
  /** A grab since the last frame. */
  const grabbed = useRef(false);
  /** The round as the last frame left it, and whether the game has been handed on (its end, or Dừng). */
  const latest = useRef(s);
  const over = useRef(false);
  const cb = useRef({ onEnd, onClose });
  useEffect(() => {
    cb.current = { onEnd, onClose };
  });
  const stop = useCallback(() => {
    if (over.current) return;
    over.current = true;
    if (latest.current.tries.length === 0) cb.current.onClose();
    else cb.current.onEnd(latest.current.hits);
  }, []);

  useEffect(() => {
    let cur = createCrabRound(crab.seed);
    let last = performance.now();
    let raf = requestAnimationFrame(function loop(t: number) {
      cur = stepCrabRound(cur, Math.max(0, t - last) / 1000, grabbed.current);
      grabbed.current = false;
      last = t;
      latest.current = cur;
      setS(cur);
      if (cur.outcome) {
        if (!over.current) {
          over.current = true;
          cb.current.onEnd(cur.hits);
        }
        return;
      }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [crab.seed]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        e.preventDefault();
        // a held key's repeats are not grabs
        if (!e.repeat) grabbed.current = true;
      } else if (e.key === "Escape" && !panelOpen) {
        stop();
      }
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [panelOpen, stop]);

  const grab = () => { grabbed.current = true; };
  const last = s.tries[s.tries.length - 1];
  const closed = clawsClosed(s);
  const line = s.stage === "lead" ? "Cua đang rình…" : s.stage === "claws" ? (closed ? "Càng khép — chộp!" : "Càng mở") : CRAB_MARK[last];
  return (
    <>
      {/* the whole block takes a click or a tap */}
      <div role="group" aria-label="Hang cua" onPointerDown={grab} className="flex w-full touch-none select-none flex-col items-center gap-2 py-1">
        <Scene s={s} />
        <p>
          Lần {Math.min(s.tries.length + (s.stage === "beat" ? 0 : 1), CRAB.tries)}/{CRAB.tries} · bắt được {s.hits}
          <b className={closed ? "text-[#2e7d32]" : undefined}> · {line}</b>
        </p>
        <p aria-live="polite" className="min-h-6">{last ? `Lần ${s.tries.length}: ${CRAB_MARK[last]}` : ""}</p>
        <p className="text-base opacity-80">{CRAB_HELP}</p>
      </div>
      <button type="button" className="pch-btn" onClick={stop}>Dừng (Esc)</button>
    </>
  );
}

/** CrabGame (v15.3 §13.2): the game at a hole; "Đang bỏ cua vào xô…" while a catch waits out its 4 s after crab_start's
 *  answer; then what the visit brought, or the server's refusal. Dừng (Esc) follows R8; an Esc typed into a text field,
 *  or one for another open overlay, is not its own. */
export default function CrabGame({ crab, panelOpen, onEnd, onClose }: {
  crab: FarmCrab;
  panelOpen: boolean;
  onEnd: (hits: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    // the game minds its own Esc (Dừng)
    if (panelOpen || crab.phase === "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, crab.phase, onClose]);

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center p-3" role="dialog" aria-modal="true"
      aria-label={`Bắt cua hang ${crab.hole}`}>
      <div className="pch flex w-80 max-w-full flex-col items-center gap-2 p-3 text-center font-vt text-lg leading-tight">
        <h2 className="font-vt text-2xl leading-none text-burgundy">🦀 Bắt cua · hang {crab.hole}</h2>
        {crab.phase === "playing" && <Playing crab={crab} panelOpen={panelOpen} onEnd={onEnd} onClose={onClose} />}
        {crab.phase === "waiting" && (
          <>
            {(crab.hits ?? 0) > 0 && <p role="status">Đang bỏ cua vào xô…</p>}
            <button type="button" className="pch-btn" onClick={onClose}>Dừng (Esc)</button>
          </>
        )}
        {(crab.phase === "done" || crab.phase === "refused") && (
          <>
            <p role="status" className={crab.phase === "refused" ? "text-burgundy" : undefined}>{crab.message}</p>
            <button type="button" className="pch-btn pch-btn-primary" onClick={onClose}>Đóng</button>
          </>
        )}
      </div>
    </div>
  );
}
```

**components/game/farm/FarmOverlays.tsx — edit 1 of 3.** Replace:

```tsx
import CoopPanel from "./CoopPanel";
import DryingPanel from "./DryingPanel";
```

with:

```tsx
import CoopPanel from "./CoopPanel";
import CrabGame from "./CrabGame";
import DryingPanel from "./DryingPanel";
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 3.** Replace:

```tsx
/** The field on top of the world (spec §13): the banner before the migration, the work progress, a round (HarvestGame,
 *  v15.2 §13.2; TransplantGame, v15.3 §13.3) and the field's panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

with:

```tsx
/** The field on top of the world (spec §13): the banner before the migration, the work progress, a round (HarvestGame,
 *  v15.2 §13.2; TransplantGame, v15.3 §13.3), a crab visit (CrabGame, v15.3 §13.2) and the field's panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

**components/game/farm/FarmOverlays.tsx — edit 3 of 3.** Replace:

```tsx
      )}
      {panel?.kind === "plot" && (
```

with:

```tsx
      )}
      {farm.crab && (
        <CrabGame key={farm.crab.visit.id} crab={farm.crab} panelOpen={panelOpen || panel !== null} onEnd={farm.endCrab}
          onClose={farm.closeCrab} />
      )}
      {panel?.kind === "plot" && (
```

**components/game/GameShell.tsx.** Replace:

```tsx
    panel: panel !== null, fishingPanel: fishing.panel !== null, creating, anticheatModal: anticheat.modal !== null,
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null,
```

with:

```tsx
    panel: panel !== null, fishingPanel: fishing.panel !== null, creating, anticheatModal: anticheat.modal !== null,
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null, farmCrab: farm.crab !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null,
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (5 files, 72 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameShell.tsx components/game/farm/CrabGame.tsx components/game/farm/FarmOverlays.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/overlays.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-crab-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): crab holes — E at a ready hole opens CrabGame

The controller starts a visit with crab_start at the hole's spot, stands the avatar at
the hole and re-sends fa 6 every 2 s. When the game ends, a catch goes to crab_finish no
earlier than 4 s after crab_start's answer ("Đang bỏ cua vào xô…"), hits 0 at once.
Dừng follows R8: before a try ends nothing is sent and the toast says the hole keeps
its 20 minutes; after a try it ends the game; during the wait the catch is still sent
and its result toasted. A crab_start answer that comes back after the field was left
is dropped, as a late begin_work answer is. E at a hole that cannot be visited says
why, in the server's order; before 0018 it says NOT_OPEN_153, and so do the gathering
RPCs. CrabGame keeps the avatar at the hole, and its hits are 0–3 whatever the input.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameShell.tsx components/game/farm/CrabGame.tsx components/game/farm/FarmOverlays.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/overlays.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-crab-game.test.tsx tests/unit/farm-overlays.test.tsx tests/unit/game-overlays.test.ts tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 12: Snail beds, pest snails, the gathering prompts and the ready cues

**Files:**
- Modify: `hooks/useField.ts`, `hooks/useFarmController.ts`, `lib/game/farm/actions.ts`, `components/game/farm/FarmOverlays.tsx`, `components/game/farm/PlotPanel.tsx`, `components/game/farm/Handbook.tsx`, `components/game/GameCanvas.tsx`, `components/game/GameShell.tsx`
- Test: `tests/unit/use-farm-controller.test.tsx`, `farm-actions.test.ts`, `farm-plot-panel.test.tsx`, `farm-overlays.test.tsx`, `game-canvas-input.test.tsx`, `anticheat-pins.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`pickSnailBed`, `BED_BAR_MS`, `FieldAnswer.snails`, `heldBox`, `critterCount`, `spotKey`), Task 6 (`gatherPrompt`, the `snail_bed` interactables), Task 7 (`bedResultText`, `pestSnailText`, `bedEmptyText`, `handbookTabs(uplands, critters)`), Task 9 (`setGatherSpots`), Task 11 (`gatherRefusal`, the crab flow); v15.2's work bar (`WORK_MS`), `promptText`, the 30 s field tick, the plot panel's handbook link.
- Produces:
  - `useField`: `pickSnailBed(bed)`;
  - `useFarmController`: `FarmBed { bed, startedAt, text }`; `bed`, `cancelBed()`, `moved()`; E at a ready `snail_bed` stands the avatar there and runs a `BED_BAR_MS` bar ("🐌 Đang mò ốc bãi {n}…") with `fa 7` at its start and at 2 s, then `pick_snail_bed(spot)`, `fa 0` and `bedResultText`; a move, "Huỷ" or Esc cancels it before anything is sent; a `pick_snails` answer toasts `pestSnailText`; `promptText` names a hole's or a bed's state (`gatherPrompt`); the canvas gets `setGatherSpots` after every answer and on the tick (open and not cooling for me; none before `0018`);
  - `actions.ts`: `PlotAction.handbook?`; the pest-snail button's hint (§13.4) with a link to "Cua & ốc", none before `0018`;
  - `PlotPanel`: a hint's own handbook link ("📖 Cua & ốc"), the tab names from `handbookTabs(uplands, critters)`; `Handbook` takes `critters`; `FarmOverlays` shows the bed's bar beside the work bar (`Progress`); `GameCanvas` gains `onLocalMove` (a local `mv` step or a path), which `GameShell` wires to `farm.moved`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/use-farm-controller.test.tsx — edit 1 of 4.** Replace:

```tsx
} from "@/lib/game/farm/catalog";
import { CRAB_FINISH_WAIT_MS, TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import { CRAB_GAVE_UP, GATHER_LIMIT_TEXT, GIFT_TEXT, NOT_OPEN, NOT_OPEN_153 } from "@/lib/game/farm/messages";
```

with:

```tsx
} from "@/lib/game/farm/catalog";
import { BED_BAR_MS, CRAB_FINISH_WAIT_MS, TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import { CRAB_GAVE_UP, GATHER_LIMIT_TEXT, GIFT_TEXT, NOT_OPEN, NOT_OPEN_153 } from "@/lib/game/farm/messages";
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 4.** Replace:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
}));
```

with:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(), pickSnailBed: vi.fn(),
}));
```

**tests/unit/use-farm-controller.test.tsx — edit 3 of 4.** Replace:

```tsx
const handle = () => ({
  setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(),
}) as unknown as GameCanvasHandle & Record<"setPlots" | "farmAnim" | "plotChanged" | "plant", ReturnType<typeof vi.fn>>;
const spot = (id: string): Interactable => getMap("field").interactables.find((i) => i.id === id)!;
```

with:

```tsx
const handle = () => ({
  setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(),
}) as unknown as GameCanvasHandle & Record<"setPlots" | "farmAnim" | "plotChanged" | "plant" | "setGatherSpots", ReturnType<typeof vi.fn>>;
const spot = (id: string): Interactable => getMap("field").interactables.find((i) => i.id === id)!;
```

**tests/unit/use-farm-controller.test.tsx — edit 4 of 4.** Replace:

```tsx

describe("useFarmController, the clock while a harvester runs", () => {
```

with:

```tsx

describe("useFarmController, v15.3 snail beds, pest snails, prompts and cues", () => {
  const CRITTERS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
    critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
  ];
  const BUCKET = farmItemFromRow({
    id: "box_bucket", kind: "critter_box", name: "Xô nhựa", price: 1500, sort_order: 10, variety: null, fert: null, pest_target: null, capacity: 15,
  });
  const GATHERING = { ...CATALOG, critters: CRITTERS, items: [...CATALOG.items, BUCKET] };
  const fa = (canvas: ReturnType<typeof handle>, a: number) => canvas.farmAnim.mock.calls.filter(([x]) => x === a).length;
  const snails = (kinds: string[], escaped = 0) => ({
    serverNow: iso(0), mine: field().mine, snails: { caught: kinds.map((kind) => ({ kind, price: kind === "oc_dong" ? 17 : 4 })), escaped },
  });
  const inMin = (m: number) => new Date(NOW + m * 60_000).toISOString();
  beforeEach(() => {
    rpc.fetchFarmCatalog.mockResolvedValue(GATHERING);
  });

  it("mò ốc at a ready bed: a 3 s bar with fa 7 at its start and at 2 s, then pick_snail_bed and what it gave", async () => {
    const { result, canvas, toast } = setup();
    await flush();
    act(() => { expect(result.current.interact(spot("bed_2"))).toBe(true); });
    expect(canvas.plant).toHaveBeenCalledWith(spot("bed_2").use, spot("bed_2").face);
    expect(result.current.bed).toMatchObject({ bed: 2, text: "🐌 Đang mò ốc bãi 2…" });
    expect(result.current.work).toBeNull();
    expect(fa(canvas, FARM_ANIM.snails)).toBe(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(fa(canvas, FARM_ANIM.snails)).toBe(2);
    rpc.pickSnailBed.mockResolvedValueOnce(snails(["oc_buou_vang", "oc_dong"]));
    await act(async () => { await vi.advanceTimersByTimeAsync(BED_BAR_MS - 2000 - 1); });
    expect(rpc.pickSnailBed).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.pickSnailBed).toHaveBeenCalledWith("r", "tok", 2);
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    expect(result.current.bed).toBeNull();
    expect(toast).toHaveBeenCalledWith("🐌 Mò được 2 con ốc: 1 ốc đồng, 1 ốc bươu vàng.");
  });

  it("cancels the bar before anything is sent when I move, or on Huỷ", async () => {
    const { result, canvas } = setup();
    await flush();
    act(() => { result.current.interact(spot("bed_1")); });
    act(() => result.current.moved());
    expect(result.current.bed).toBeNull();
    expect(canvas.farmAnim).toHaveBeenLastCalledWith(FARM_ANIM.stop);
    act(() => { result.current.interact(spot("bed_3")); });
    act(() => result.current.cancelBed());
    expect(result.current.bed).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(BED_BAR_MS * 2); });
    expect(rpc.pickSnailBed).not.toHaveBeenCalled();
    // moving with no bar running changes nothing
    act(() => result.current.moved());
    expect(result.current.bed).toBeNull();
  });

  it("says why a bed cannot be picked, and a refused pick as its toast", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { gather: { ready_at: { bed4: inMin(7) }, left_today: 100 } } }));
    const { result, toast } = setup();
    await flush();
    act(() => { result.current.interact(spot("bed_4")); });
    expect(toast).toHaveBeenLastCalledWith("Bãi này vừa mò rồi — quay lại sau 7 phút.");
    expect(result.current.bed).toBeNull();
    act(() => { result.current.interact(spot("bed_2")); });
    rpc.pickSnailBed.mockRejectedValueOnce({ message: "bed empty", details: "300" });
    await act(async () => { await vi.advanceTimersByTimeAsync(BED_BAR_MS); });
    expect(toast).toHaveBeenLastCalledWith("Bãi này vừa mò rồi — quay lại sau 5 phút.");
  });

  it("toasts what a pest-snail pick kept for the picker, or v15.2's line before 0018", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { items: { box_bucket: 1 } } }));
    const { result, toast } = setup();
    await flush();
    const answer = (s: unknown) => ({
      state: field({ mine: { items: { box_bucket: 1 } } }), harvest: null, harvestPart: null, picking: null, snails: s,
    });
    rpc.fieldAction.mockResolvedValueOnce(answer({ caught: [{ kind: "oc_buou_vang", price: 4 }, { kind: "oc_buou_vang", price: 4 }], escaped: 1 }));
    await act(async () => { await result.current.act({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng."); });
    expect(toast).toHaveBeenLastCalledWith("🐌 Bắt ốc thửa 6: được 2 con, thả 1 con xuống mương vì xô nhựa đầy.");
    rpc.fieldAction.mockResolvedValueOnce(answer(null));
    await act(async () => { await result.current.act({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng."); });
    expect(toast).toHaveBeenLastCalledWith("Đã bắt ốc bươu vàng.");
  });

  it("names a hole's or a bed's state in its prompt, on the server's clock", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { gather: { ready_at: { crab1: inMin(12), bed2: inMin(7) }, left_today: 150 } } }));
    const { result } = setup();
    await flush();
    expect(result.current.promptText(spot("crab_1"))).toBe("Hang 1 · cua chưa ra (còn 12 phút)");
    expect(result.current.promptText(spot("bed_2"))).toBe("Bãi 2 · còn 7 phút");
    expect(result.current.promptText(spot("crab_3"))).toBe("Bắt cua hang 3");
    expect(result.current.promptText(spot("bed_1"))).toBe("Mò ốc bãi 1");
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { critters: { cua_dong: { n: 3, xu: 36 } }, critter_cap: 3 } }));
    const full = setup();
    await flush();
    expect(full.result.current.promptText(spot("crab_3"))).toBe("Hang 3 · tay đầy — bán ở vựa cô Út");
  });

  it("draws the ready cue on each hole and bed open and not cooling for me, none before 0018", async () => {
    rpc.fetchFieldState.mockResolvedValue(field({ mine: { gather: { ready_at: { crab1: inMin(12), bed2: inMin(-1) }, left_today: 150 } } }));
    const { canvas } = setup();
    await flush();
    const spots = canvas.setGatherSpots.mock.calls.at(-1)![0] as Array<{ id: string; ready: boolean }>;
    expect(spots.map((s) => s.id).sort()).toEqual([
      "bed_1", "bed_2", "bed_3", "bed_4", "crab_1", "crab_2", "crab_3", "crab_4", "crab_5", "crab_6",
    ]);
    expect(spots.filter((s) => !s.ready).map((s) => s.id)).toEqual(["crab_1"]);
    rpc.fetchFarmCatalog.mockResolvedValue(CATALOG);
    const before = setup();
    await flush();
    const none = before.canvas.setGatherSpots.mock.calls.at(-1)![0] as Array<{ ready: boolean }>;
    expect(none.some((s) => s.ready)).toBe(false);
  });
});

describe("useFarmController, the clock while a harvester runs", () => {
```

**tests/unit/farm-actions.test.ts — edit 1 of 2.** Replace:

```ts
import {
  farmItemFromRow, LEASE_ROUND_MS, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
```

with:

```ts
import {
  critterFromRow, farmItemFromRow, LEASE_ROUND_MS, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
```

**tests/unit/farm-actions.test.ts — edit 2 of 2.** Replace:

```ts
      { key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot: 5 }, enabled: true },
    ]);
  });
  it("sows sprouted seed on a moist bed only", () => {
```

with:

```ts
      { key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot: 5 }, enabled: true },
    ]);
  });
  it("hints what a pest-snail pick gives the picker, or where the snails go when full; none before 0018 (v15.3 §13.4)", () => {
    const snail: PestView = { kind: "snail", since: at(16), treatedAt: null };
    const p = plot(crop({ transplantAt: at(12), sowAt: at(3), pests: [snail], log: null }), { farmer: { id: "lan", name: "Lan" } });
    const GATHERING: FarmCatalog = {
      ...CATALOG,
      critters: [critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 })],
      items: [...CATALOG.items, item("box_basket", "critter_box", "Giỏ tre", { capacity: 30 })],
    };
    expect(find(plotActions(p, "me", nep, GATHERING, ALL, at(20)), "pick")).toEqual({
      key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot: 5 }, enabled: true,
      hint: "Bắt ốc cứu lúa — được thêm 1–3 con ốc bươu vàng bỏ xô.", handbook: "critters",
    });
    const basket: FarmMine = { ...ALL, items: { ...ALL.items, box_basket: 1 }, critters: { oc_dong: { n: 33, xu: 264 } }, critterCap: 33 };
    expect(find(plotActions(p, "me", nep, GATHERING, basket, at(20)), "pick")).toMatchObject({
      enabled: true, hint: "Giỏ tre đầy — ốc bắt được thả xuống mương, lúa vẫn được cứu.", handbook: "critters",
    });
    const hands: FarmMine = { ...ALL, critters: { oc_dong: { n: 3, xu: 24 } }, critterCap: 3 };
    expect(find(plotActions(p, "me", nep, GATHERING, hands, at(20)), "pick")?.hint).toBe("Tay đầy — ốc bắt được thả xuống mương, lúa vẫn được cứu.");
  });
  it("sows sprouted seed on a moist bed only", () => {
```

**tests/unit/farm-plot-panel.test.tsx — edit 1 of 4.** Replace:

```tsx
import PlotPanel from "@/components/game/farm/PlotPanel";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

with:

```tsx
import PlotPanel from "@/components/game/farm/PlotPanel";
import {
  critterFromRow, farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

**tests/unit/farm-plot-panel.test.tsx — edit 2 of 4.** Replace:

```tsx

function renderPlot(no: number, state: FieldState = STATE) {
  const onAct = vi.fn(), onOpenHandbook = vi.fn();
  render(<PlotPanel no={no} state={state} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
    onOpenHandbook={onOpenHandbook} onReload={() => {}} onClose={() => {}} />);
  return { onAct, onOpenHandbook };
}

describe("PlotPanel", () => {
```

with:

```tsx

function renderPlot(no: number, state: FieldState = STATE, catalog: FarmCatalog = CATALOG) {
  const onAct = vi.fn(), onOpenHandbook = vi.fn();
  render(<PlotPanel no={no} state={state} catalog={catalog} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
    onOpenHandbook={onOpenHandbook} onReload={() => {}} onClose={() => {}} />);
  return { onAct, onOpenHandbook };
}
/** 0018's critters and containers. */
const CRITTERS = [
  critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
  critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
  critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
  critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
];
const BOXES = [
  item("box_bucket", "critter_box", "Xô nhựa", { price: 1500, capacity: 15 }), item("box_basket", "critter_box", "Giỏ tre", { price: 6000, capacity: 30 }),
];

describe("PlotPanel", () => {
```

**tests/unit/farm-plot-panel.test.tsx — edit 3 of 4.** Replace:

```tsx
    expect(screen.queryByRole("button", { name: /Bơm nước/ })).toBeNull();
  });
```

with:

```tsx
    expect(screen.queryByRole("button", { name: /Bơm nước/ })).toBeNull();
  });

  it("links the pest-snail hint to the handbook's Cua & ốc (v15.3 §13.4, §14)", () => {
    const { onAct, onOpenHandbook } = renderPlot(6, STATE, { ...CATALOG, critters: CRITTERS, items: [...CATALOG.items, ...BOXES] });
    expect(screen.getByText("Bắt ốc cứu lúa — được thêm 1–3 con ốc bươu vàng bỏ xô.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Cua & ốc" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("critters");
    fireEvent.click(screen.getByRole("button", { name: "Bắt ốc bươu vàng" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng.");
  });
```

**tests/unit/farm-plot-panel.test.tsx — edit 4 of 4.** Replace:

```tsx
    render(<Handbook varieties={[nep]} initial="nope" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Quy trình" })).toHaveAttribute("aria-selected", "true");
```

with:

```tsx
    render(<Handbook varieties={[nep]} initial="nope" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Quy trình" })).toHaveAttribute("aria-selected", "true");
  });

  it("has Cua & ốc once 0018 has critters (v15.3 §14)", () => {
    render(<Handbook varieties={[nep]} items={BOXES} critters={CRITTERS} initial="critters" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Cua & ốc" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Bắt cua ở hang" })).toBeInTheDocument();
    expect(screen.getByText("Dọc bờ mương có 6 hang cua. Đứng trên bờ, bấm E để thò tay vào hang.")).toBeInTheDocument();
    cleanup();
    render(<Handbook varieties={[nep]} initial="critters" onClose={() => {}} />);
    expect(screen.queryByRole("tab", { name: "Cua & ốc" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Quy trình" })).toHaveAttribute("aria-selected", "true");
```

**tests/unit/farm-overlays.test.tsx — edit 1 of 3.** Replace:

```tsx
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
  },
```

with:

```tsx
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
    pickSnailBed: vi.fn(),
  },
```

**tests/unit/farm-overlays.test.tsx — edit 2 of 3.** Replace:

```tsx
  round: null, endRound: vi.fn(), nextRound: vi.fn(), closeRound: vi.fn(), crab: null, endCrab: vi.fn(), closeCrab: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
```

with:

```tsx
  round: null, endRound: vi.fn(), nextRound: vi.fn(), closeRound: vi.fn(), crab: null, endCrab: vi.fn(), closeCrab: vi.fn(),
  bed: null, cancelBed: vi.fn(), moved: vi.fn(),
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
```

**tests/unit/farm-overlays.test.tsx — edit 3 of 3.** Replace:

```tsx
    expect(farm.cancelWork).toHaveBeenCalledTimes(2);
  });
```

with:

```tsx
    expect(farm.cancelWork).toHaveBeenCalledTimes(2);
  });

  it("shows a snail bed's bar, cancelled by its button or Esc (v15.3 §7.3)", () => {
    const farm = controller({ bed: { bed: 2, startedAt: 1, text: "🐌 Đang mò ốc bãi 2…" } });
    render(<FarmOverlays farm={farm} me="me" onField />);
    expect(screen.getByText("🐌 Đang mò ốc bãi 2…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Huỷ/ }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(farm.cancelBed).toHaveBeenCalledTimes(2);
  });
```

**tests/unit/game-canvas-input.test.tsx — edit 1 of 3.** Replace:

```tsx
  hellos: string[]; removed: string[]; destroyed: boolean;
};
```

with:

```tsx
  hellos: string[]; removed: string[]; destroyed: boolean;
  cb: { onLocalMove: (m: unknown) => void; onLocalPath: (m: unknown) => void };
};
```

**tests/unit/game-canvas-input.test.tsx — edit 2 of 3.** Replace:

```tsx
    rec: EngineRec;
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = {
        mapId: map.id, input: [], plots: [], cards: [], spots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false,
      };
```

with:

```tsx
    rec: EngineRec;
    constructor(_canvas: unknown, map: { id: string }, _art: unknown, cb: EngineRec["cb"]) {
      this.rec = {
        mapId: map.id, input: [], plots: [], cards: [], spots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false,
        cb,
      };
```

**tests/unit/game-canvas-input.test.tsx — edit 3 of 3.** Replace:

```tsx

describe("GameCanvas farm messages", () => {
```

with:

```tsx

describe("GameCanvas, my moves (v15.3 §7.3)", () => {
  it("tells the shell when I start walking or set off on a path, and sends them on; a stop or a jump is not a move", () => {
    const onLocalMove = vi.fn();
    render(<GameCanvas mapId="field" {...props} onLocalMove={onLocalMove} />);
    const { cb } = engines[0];
    cb.onLocalMove({ mv: false, x: 1, y: 2, vx: 0, vy: 0, f: 0 });
    expect(onLocalMove).not.toHaveBeenCalled();
    cb.onLocalMove({ mv: true, x: 1, y: 2, vx: 1, vy: 0, f: 3 });
    cb.onLocalPath({ x: 1, y: 2, p: [[3, 4]] });
    expect(onLocalMove).toHaveBeenCalledTimes(2);
    expect(channels[0].sent.map((m) => (m as { t: string }).t)).toEqual(["mv", "mv", "pa"]);
  });
});

describe("GameCanvas farm messages", () => {
```

**tests/unit/anticheat-pins.test.tsx — edit 1 of 5.** Replace:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
}));
```

with:

```tsx
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(), pickSnailBed: vi.fn(),
}));
```

**tests/unit/anticheat-pins.test.tsx — edit 2 of 5.** Replace:

```tsx
  it("transplants after a TransplantGame round, and picks, with quality 1", async () => {
    const canvas = { setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn() } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

with:

```tsx
  it("transplants after a TransplantGame round, and picks, with quality 1", async () => {
    const canvas = {
      setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(),
    } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

**tests/unit/anticheat-pins.test.tsx — edit 3 of 5.** Replace:

```tsx

  it("the field's holes are 1–6 and its beds 1–4, and a visit sends its hole's spot", async () => {
    const spots = (kind: string) => getMap("field").interactables.filter((i) => i.kind === kind).map((i) => i.spot);
```

with:

```tsx

  it("the field's holes are 1–6 and its beds 1–4, and a visit sends its spot", async () => {
    const spots = (kind: string) => getMap("field").interactables.filter((i) => i.kind === kind).map((i) => i.spot);
```

**tests/unit/anticheat-pins.test.tsx — edit 4 of 5.** Replace:

```tsx
    }));
    const canvas = { setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn() } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

with:

```tsx
    }));
    rpc.pickSnailBed.mockImplementation(async () => ({ serverNow: iso(0), mine: STATE.mine, snails: { caught: [], escaped: 0 } }));
    const canvas = {
      setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn(), setGatherSpots: vi.fn(),
    } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
```

**tests/unit/anticheat-pins.test.tsx — edit 5 of 5.** Replace:

```tsx
    expect(rpc.crabStart.mock.calls.map(([, , hole]) => hole).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
```

with:

```tsx
    expect(rpc.crabStart.mock.calls.map(([, , hole]) => hole).sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const it of getMap("field").interactables.filter((i) => i.kind === "snail_bed")) {
      act(() => { result.current.interact(it); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    }
    expect(rpc.pickSnailBed.mock.calls.map(([, , bed]) => bed).sort()).toEqual([1, 2, 3, 4]);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/game-canvas-input.test.tsx tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — 12 tests fail (`result.current.moved is not a function`, no bed bar or "🐌 Đang mò ốc bãi 2…", no pest-snail hint or its link, no "Cua & ốc" tab in Sổ tay, the hole's prompt still "Bắt cua hang 1", no cues, no `onLocalMove`, the beds send no spot); 112 pass.

- [ ] **Step 3: Implement**

**hooks/useField.ts — edit 1 of 3.** Replace:

```ts
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer, RPCS_152,
  RPCS_153, sellProduce, sellRice, type CatchAnswer, type CrabVisit, type FieldAction, type FieldAnswer, type MineAnswer,
} from "@/lib/game/farm/rpc";
```

with:

```ts
import {
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer,
  pickSnailBed, RPCS_152, RPCS_153, sellProduce, sellRice, type CatchAnswer, type CrabVisit, type FieldAction, type FieldAnswer,
  type MineAnswer,
} from "@/lib/game/farm/rpc";
```

**hooks/useField.ts — edit 2 of 3.** Replace:

```ts
    Promise<(MineAnswer & { crab: CatchAnswer & { hits: number } }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

with:

```ts
    Promise<(MineAnswer & { crab: CatchAnswer & { hits: number } }) | null>;
  /** Mò ốc (v15.3 §7.3): 1–3 snails from bed `bed`. */
  pickSnailBed: (bed: number) => Promise<(MineAnswer & { snails: CatchAnswer }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

**hooks/useField.ts — edit 3 of 3.** Replace:

```ts
      call(() => crabFinish(roomId, token, visitId, hits), applyMine, { rpc: "crab_finish", onError }), [call, applyMine, roomId, token]),
  };
```

with:

```ts
      call(() => crabFinish(roomId, token, visitId, hits), applyMine, { rpc: "crab_finish", onError }), [call, applyMine, roomId, token]),
    pickSnailBed: useCallback((bed: number) =>
      call(() => pickSnailBed(roomId, token, bed), applyMine, { rpc: "pick_snail_bed" }), [call, applyMine, roomId, token]),
  };
```

**hooks/useFarmController.ts — edit 1 of 14.** Replace:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import { CRAB_FINISH_WAIT_MS, heldBox, spotState, TRANSPLANT_WAIT_MS } from "@/lib/game/farm/gather";
import {
  bedEmptyText, boughtText, CRAB_GAVE_UP, crabResultText, crittersFullText, FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText,
  harvesterDoneText, holeEmptyText, loadedText, NOT_OPEN, NOT_OPEN_153, pickingText, produceSaleText, riceSaleText, WORK_EXPIRED,
  WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
```

with:

```ts
import { serverNow } from "@/lib/game/farm/clock";
import {
  BED_BAR_MS, CRAB_FINISH_WAIT_MS, gatherPrompt, heldBox, spotKey, spotState, TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, crittersFullText, FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT,
  harvestText, harvesterDoneText, holeEmptyText, loadedText, NOT_OPEN, NOT_OPEN_153, pestSnailText, pickingText, produceSaleText,
  riceSaleText, WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
```

**hooks/useFarmController.ts — edit 2 of 14.** Replace:

```ts

export interface FarmController {
```

with:

```ts

/** A snail bed's 3-second bar (v15.3 §7.3): movement stays free, and moving cancels it. `text` is the bar's line. */
export interface FarmBed { bed: number; startedAt: number; text: string }

export interface FarmController {
```

**hooks/useFarmController.ts — edit 3 of 14.** Replace:

```ts
  closeCrab: () => void;
  /** A land, farming or drying action (a picking starts the progress, a round opens its game); `done` is toasted when it
```

with:

```ts
  closeCrab: () => void;
  /** A snail bed's bar, running. */
  bed: FarmBed | null;
  /** "Huỷ" or Esc: the bar stops before anything is sent. */
  cancelBed: () => void;
  /** I moved (the canvas): a snail bed's bar stops before anything is sent (§7.3). */
  moved: () => void;
  /** A land, farming or drying action (a picking starts the progress, a round opens its game); `done` is toasted when it
```

**hooks/useFarmController.ts — edit 4 of 14.** Replace:

```ts
  interact: (it: Interactable) => boolean;
  /** A plot's prompt names my next job there; the field's other interactables keep theirs; null = not the field's. */
  promptText: (it: Interactable) => string | null;
```

with:

```ts
  interact: (it: Interactable) => boolean;
  /** A plot's prompt names my next job there, a hole's or a bed's its state for me (v15.3 §13.1); the field's other
   *  interactables keep theirs; null = not the field's. */
  promptText: (it: Interactable) => string | null;
```

**hooks/useFarmController.ts — edit 5 of 14.** Replace:

```ts
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying", "crab_hole"]);
```

with:

```ts
};
const FIELD_KINDS: ReadonlySet<string> = new Set(["plot", "coop", "farm_shop", "rice_depot", "drying", "crab_hole", "snail_bed"]);
```

**hooks/useFarmController.ts — edit 6 of 14.** Replace:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

with:

```ts
  const data = useField(roomId, token, active, toast);
  const { state, catalog, notOpen, run, claimGift, buyItem, sellRice, reload, crabStart, crabFinish, pickSnailBed } = data;
  const [panel, setPanel] = useState<FarmPanel | null>(null);
```

**hooks/useFarmController.ts — edit 7 of 14.** Replace:

```ts
  const [crab, setCrab] = useState<FarmCrab | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round, crab });
```

with:

```ts
  const [crab, setCrab] = useState<FarmCrab | null>(null);
  const [bed, setBed] = useState<FarmBed | null>(null);
  const live = useRef({ toast, onCoinsChanged, state, catalog, notOpen, round, crab });
```

**hooks/useFarmController.ts — edit 8 of 14.** Replace:

```ts
  }, [active, state, catalog, tasks, now, canvas]);
```

with:

```ts
  }, [active, state, catalog, tasks, now, canvas]);

  // --- the ready cue on each hole and bed (v15.3 §13.1): open (0018 has critters) and not cooling for me; it follows every
  //     answer and the clock's tick
  useEffect(() => {
    if (!active) return;
    const open = state !== null && (catalog?.critters.length ?? 0) > 0;
    const readyAt = state?.mine.gather.readyAt ?? {};
    canvas()?.setGatherSpots(getMap("field").interactables
      .filter((i) => i.kind === "crab_hole" || i.kind === "snail_bed")
      .map((i) => ({ id: i.id, ready: open && !((readyAt[spotKey(i.id) ?? ""] ?? 0) > now) })));
  }, [active, state, catalog, now, canvas]);
```

**hooks/useFarmController.ts — edit 9 of 14.** Replace:

```ts
  const closeCrab = useCallback(() => shutCrab(true), [shutCrab]);

  useEffect(() => {
    if (active) return;
    cancelWork();
    // leaving the field ends a round and a crab visit too (in a task, as the change of map has rendered)
```

with:

```ts
  const closeCrab = useCallback(() => shutCrab(true), [shutCrab]);

  // --- snail beds (v15.3 §7.3): a 3 s bar with fa 7 at its start and at 2 s, then pick_snail_bed (no server gate, R9).
  // Movement stays free: moving, Huỷ or Esc stops the bar before anything is sent.
  const bedTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  useEffect(() => () => bedTimers.current.forEach(clearTimeout), []);
  const finishBed = useCallback(async (n: number) => {
    bedTimers.current = [];
    setBed(null);
    canvas()?.farmAnim(FARM_ANIM.stop);
    const r = await pickSnailBed(n);
    if (!r) return;
    const cat = live.current.catalog;
    live.current.toast(bedResultText(r.snails, cat?.critters ?? [], heldBox(r.mine.items, cat?.items ?? [])?.name ?? null));
  }, [pickSnailBed, canvas]);
  const startBed = useCallback((it: Interactable) => {
    if (it.spot === undefined || workTimer.current || roundOn(live.current.round) || live.current.crab || bedTimers.current.length > 0) return;
    const n = it.spot;
    const c = canvas();
    c?.plant(it.use, it.face ?? "down");
    c?.farmAnim(FARM_ANIM.snails);
    setBed({ bed: n, startedAt: Date.now(), text: `🐌 Đang mò ốc bãi ${n}…` });
    bedTimers.current = [
      setTimeout(() => canvas()?.farmAnim(FARM_ANIM.snails), ROUND_FA_MS),
      setTimeout(() => void finishBed(n), BED_BAR_MS),
    ];
  }, [canvas, finishBed]);
  const cancelBed = useCallback(() => {
    if (bedTimers.current.length === 0) return;
    bedTimers.current.forEach(clearTimeout);
    bedTimers.current = [];
    setBed(null);
    canvas()?.farmAnim(FARM_ANIM.stop);
  }, [canvas]);

  useEffect(() => {
    if (active) return;
    cancelWork();
    cancelBed();
    // leaving the field ends a round and a crab visit too (in a task, as the change of map has rendered)
```

**hooks/useFarmController.ts — edit 10 of 14.** Replace:

```ts
    return () => clearTimeout(t);
  }, [active, cancelWork, closeRound, shutCrab]);
```

with:

```ts
    return () => clearTimeout(t);
  }, [active, cancelWork, cancelBed, closeRound, shutCrab]);
```

**hooks/useFarmController.ts — edit 11 of 14.** Replace:

```ts
      c?.plotChanged("plot" in a ? a.plot : 0);
      if (done) live.current.toast(done);
      return true;
```

with:

```ts
      c?.plotChanged("plot" in a ? a.plot : 0);
      // a pest-snail pick says what the picker kept (v15.3 R10); before 0018 its answer has no snails
      const said = a.kind === "pick_snails"
        ? pestSnailText(a.plot, r.snails, heldBox(r.state.mine.items, live.current.catalog?.items ?? [])?.name ?? null)
        : done;
      if (said) live.current.toast(said);
      return true;
```

**hooks/useFarmController.ts — edit 12 of 14.** Replace:

```ts
        break;
      case "crab_hole": {
        const why = gatherRefusal(it, live.current.state, live.current.catalog, serverNow());
        if (why !== null) live.current.toast(why);
        else void startCrab(it);
        break;
```

with:

```ts
        break;
      case "crab_hole":
      case "snail_bed": {
        const why = gatherRefusal(it, live.current.state, live.current.catalog, serverNow());
        if (why !== null) live.current.toast(why);
        else if (it.kind === "crab_hole") void startCrab(it);
        else startBed(it);
        break;
```

**hooks/useFarmController.ts — edit 13 of 14.** Replace:

```ts
    return true;
  }, [startCrab]);
  const promptText = useCallback((it: Interactable): string | null => {
    if (!FIELD_KINDS.has(it.kind)) return null;
    const p = it.kind === "plot" ? state?.plots.find((x) => x.no === it.plot) : undefined;
```

with:

```ts
    return true;
  }, [startCrab, startBed]);
  const promptText = useCallback((it: Interactable): string | null => {
    if (!FIELD_KINDS.has(it.kind)) return null;
    if (it.kind === "crab_hole" || it.kind === "snail_bed") return gatherPrompt(it, state?.mine ?? null, catalog, now);
    const p = it.kind === "plot" ? state?.plots.find((x) => x.no === it.plot) : undefined;
```

**hooks/useFarmController.ts — edit 14 of 14.** Replace:

```ts
    closeCrab,
    act,
```

with:

```ts
    closeCrab,
    bed,
    cancelBed,
    moved: cancelBed,
    act,
```

**lib/game/farm/actions.ts — edit 1 of 4.** Replace:

```ts
} from "./crop";
import {
```

with:

```ts
} from "./crop";
import { critterCount, heldBox } from "./gather";
import {
```

**lib/game/farm/actions.ts — edit 2 of 4.** Replace:

```ts
  hint?: string;
}
```

with:

```ts
  hint?: string;
  /** The handbook tab that tells more about the hint (the plot panel links it). */
  handbook?: string;
}
```

**lib/game/farm/actions.ts — edit 3 of 4.** Replace:

```ts

/** A transplant round's hint (v15.3 §13.4): rice hills are khóm, ớt seedlings cây. */
```

with:

```ts

/** The pest-snail button's hint (v15.3 §13.4): the picker's ốc bươu vàng, or where they go when there is no room. Before
 *  0018 (no critters in the catalog) there is none, so nothing promises snails. */
function pestSnailHint(catalog: FarmCatalog, mine: FarmMine): Pick<PlotAction, "hint" | "handbook"> {
  if (catalog.critters.length === 0) return {};
  if (critterCount(mine.critters) < mine.critterCap) return { hint: "Bắt ốc cứu lúa — được thêm 1–3 con ốc bươu vàng bỏ xô.", handbook: "critters" };
  const box = heldBox(mine.items, catalog.items);
  return { hint: `${box ? box.name : "Tay"} đầy — ốc bắt được thả xuống mương, lúa vẫn được cứu.`, handbook: "critters" };
}

/** A transplant round's hint (v15.3 §13.4): rice hills are khóm, ớt seedlings cây. */
```

**lib/game/farm/actions.ts — edit 4 of 4.** Replace:

```ts
  if (!cut && crop?.pests.some((x) => x.kind === "snail" && x.treatedAt === null)) {
    out.push({ key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot }, enabled: true });
  }
```

with:

```ts
  if (!cut && crop?.pests.some((x) => x.kind === "snail" && x.treatedAt === null)) {
    out.push({ key: "pick", label: "Bắt ốc bươu vàng", run: { kind: "pick_snails", plot }, enabled: true, ...pestSnailHint(catalog, mine) });
  }
```

**components/game/farm/PlotPanel.tsx — edit 1 of 3.** Replace:

```tsx
  const tab = handbookTabFor(p?.crop ?? null, v, now);
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
```

with:

```tsx
  const tab = handbookTabFor(p?.crop ?? null, v, now);
  const tabs = catalog ? handbookTabs(catalog.uplands, catalog.critters) : [];
  const tabName = (id: string) => tabs.find(([t]) => t === id)?.[1];
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
```

**components/game/farm/PlotPanel.tsx — edit 2 of 3.** Replace:

```tsx
                  {(a.why ?? a.hint) && <span className="min-w-0 flex-1 text-base opacity-80">{a.why ?? a.hint}</span>}
                </li>
```

with:

```tsx
                  {(a.why ?? a.hint) && <span className="min-w-0 flex-1 text-base opacity-80">{a.why ?? a.hint}</span>}
                  {!a.why && a.hint && a.handbook && tabName(a.handbook) && (
                    <button type="button" className="pch-btn" onClick={() => onOpenHandbook(a.handbook!)}>📖 {tabName(a.handbook)}</button>
                  )}
                </li>
```

**components/game/farm/PlotPanel.tsx — edit 3 of 3.** Replace:

```tsx
            <button type="button" className="pch-btn self-start" onClick={() => onOpenHandbook(tab)}>
              📖 Sổ tay: {handbookTabs(catalog.uplands).find(([id]) => id === tab)?.[1]}
            </button>
```

with:

```tsx
            <button type="button" className="pch-btn self-start" onClick={() => onOpenHandbook(tab)}>
              📖 Sổ tay: {tabName(tab)}
            </button>
```

**components/game/farm/Handbook.tsx — edit 1 of 4.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import type { FarmItem, UplandCrop, Variety } from "@/lib/game/farm/catalog";
import { handbookPage, handbookTabs, type HandbookTab } from "@/lib/game/farm/handbook";

/** 📖 Sổ tay nhà nông (spec §8.9, v15.2 §14): the six rice tabs, a tab per hoa-màu crop and Nông cụ; `initial` opens one
 *  (e.g. the plot panel's link). The crops' tabs are worked out from their config; `items` name the fertilizers and
 *  pesticides there. */
export default function Handbook({ varieties, uplands = [], items = [], initial, onClose }: {
  varieties: readonly Variety[];
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import type { CritterKind, FarmItem, UplandCrop, Variety } from "@/lib/game/farm/catalog";
import { handbookPage, handbookTabs, type HandbookTab } from "@/lib/game/farm/handbook";

/** 📖 Sổ tay nhà nông (spec §8.9, v15.2 §14, v15.3 §14): the six rice tabs, a tab per hoa-màu crop, Nông cụ, and Cua & ốc
 *  once there are critters; `initial` opens one (e.g. the plot panel's links). The crops' tabs are worked out from their
 *  config; `items` name the fertilizers, pesticides and containers there. */
export default function Handbook({ varieties, uplands = [], items = [], critters = [], initial, onClose }: {
  varieties: readonly Variety[];
```

**components/game/farm/Handbook.tsx — edit 2 of 4.** Replace:

```tsx
  items?: readonly FarmItem[];
  initial: string | null;
```

with:

```tsx
  items?: readonly FarmItem[];
  critters?: readonly CritterKind[];
  initial: string | null;
```

**components/game/farm/Handbook.tsx — edit 3 of 4.** Replace:

```tsx
}) {
  const tabs = handbookTabs(uplands);
  const [tab, setTab] = useState<HandbookTab>(tabs.some(([id]) => id === initial) ? initial! : "process");
```

with:

```tsx
}) {
  const tabs = handbookTabs(uplands, critters);
  const [tab, setTab] = useState<HandbookTab>(tabs.some(([id]) => id === initial) ? initial! : "process");
```

**components/game/farm/Handbook.tsx — edit 4 of 4.** Replace:

```tsx
        <div role="tabpanel" className="flex flex-col gap-2">
          {handbookPage(tab, varieties, uplands, items).map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
```

with:

```tsx
        <div role="tabpanel" className="flex flex-col gap-2">
          {handbookPage(tab, varieties, uplands, items, critters).map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
```

**components/game/farm/FarmOverlays.tsx — edit 1 of 7.** Replace:

```tsx
import { useEffect, useState } from "react";
import { WORK_MS, type FarmController, type FarmWork } from "@/hooks/useFarmController";
import { NOT_OPEN } from "@/lib/game/farm/messages";
```

with:

```tsx
import { useEffect, useState } from "react";
import { WORK_MS, type FarmController } from "@/hooks/useFarmController";
import { BED_BAR_MS } from "@/lib/game/farm/gather";
import { NOT_OPEN } from "@/lib/game/farm/messages";
```

**components/game/farm/FarmOverlays.tsx — edit 2 of 7.** Replace:

```tsx

/** A 3-second picking: its line, a bar that fills in WORK_MS, and "Huỷ" (or Esc) before it is sent. An Esc typed into a
 *  text field, or one that closes an open panel, is not for the work (v13/v14 input rules). */
function WorkProgress({ work, panelOpen, onCancel }: { work: FarmWork; panelOpen: boolean; onCancel: () => void }) {
  const [full, setFull] = useState(false);
```

with:

```tsx

/** A 3-second job, a picking or a snail bed (v15.3 §7.3): its line, a bar that fills in `ms`, and "Huỷ" (or Esc) before
 *  it is sent. An Esc typed into a text field, or one that closes an open panel, is not for the job (v13/v14 input rules). */
function Progress({ text, ms, panelOpen, onCancel }: { text: string; ms: number; panelOpen: boolean; onCancel: () => void }) {
  const [full, setFull] = useState(false);
```

**components/game/farm/FarmOverlays.tsx — edit 3 of 7.** Replace:

```tsx
    <div className="pch absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 p-2 font-vt text-xl" role="status">
      <span>{work.text}</span>
      <div className="h-3 w-48 overflow-hidden rounded-sm bg-ink/20">
```

with:

```tsx
    <div className="pch absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 p-2 font-vt text-xl" role="status">
      <span>{text}</span>
      <div className="h-3 w-48 overflow-hidden rounded-sm bg-ink/20">
```

**components/game/farm/FarmOverlays.tsx — edit 4 of 7.** Replace:

```tsx
          className="h-full bg-burgundy motion-reduce:transition-none"
          style={{ width: full ? "100%" : "0%", transition: `width ${WORK_MS}ms linear` }}
        />
```

with:

```tsx
          className="h-full bg-burgundy motion-reduce:transition-none"
          style={{ width: full ? "100%" : "0%", transition: `width ${ms}ms linear` }}
        />
```

**components/game/farm/FarmOverlays.tsx — edit 5 of 7.** Replace:

```tsx

/** The field on top of the world (spec §13): the banner before the migration, the work progress, a round (HarvestGame,
 *  v15.2 §13.2; TransplantGame, v15.3 §13.3), a crab visit (CrabGame, v15.3 §13.2) and the field's panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

with:

```tsx

/** The field on top of the world (spec §13): the banner before the migration, the progress of a picking or a snail bed, a
 *  round (HarvestGame, v15.2 §13.2; TransplantGame, v15.3 §13.3), a crab visit (CrabGame, v15.3 §13.2) and the field's
 *  panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false }: {
```

**components/game/farm/FarmOverlays.tsx — edit 6 of 7.** Replace:

```tsx
        // the field's own tasks panel and handbook can open from the HUD while the work runs
        <WorkProgress key={farm.work.startedAt} work={farm.work} panelOpen={panelOpen || panel !== null} onCancel={farm.cancelWork} />
      )}
```

with:

```tsx
        // the field's own tasks panel and handbook can open from the HUD while the work runs
        <Progress key={farm.work.startedAt} text={farm.work.text} ms={WORK_MS} panelOpen={panelOpen || panel !== null}
          onCancel={farm.cancelWork} />
      )}
      {farm.bed && (
        <Progress key={farm.bed.startedAt} text={farm.bed.text} ms={BED_BAR_MS} panelOpen={panelOpen || panel !== null}
          onCancel={farm.cancelBed} />
      )}
```

**components/game/farm/FarmOverlays.tsx — edit 7 of 7.** Replace:

```tsx
      {panel?.kind === "handbook" && (
        <Handbook varieties={catalog?.varieties ?? []} uplands={catalog?.uplands ?? []} items={catalog?.items ?? []} initial={panel.tab}
          onClose={closePanel} />
      )}
```

with:

```tsx
      {panel?.kind === "handbook" && (
        <Handbook varieties={catalog?.varieties ?? []} uplands={catalog?.uplands ?? []} items={catalog?.items ?? []}
          critters={catalog?.critters ?? []} initial={panel.tab} onClose={closePanel} />
      )}
```

**components/game/GameCanvas.tsx — edit 1 of 2.** Replace:

```tsx
  onPlotChanged?: (p: number) => void;
  /** A new world drew its first frame. */
```

with:

```tsx
  onPlotChanged?: (p: number) => void;
  /** I started walking or set off on a path (a stop or a jump is not a move): a snail bed's bar stops (v15.3 §7.3). */
  onLocalMove?: () => void;
  /** A new world drew its first frame. */
```

**components/game/GameCanvas.tsx — edit 2 of 2.** Replace:

```tsx
      engine = new GameEngine(canvas, map, art, {
        onLocalMove: (m) => channel.send({ t: "mv", id: localId, ...m }),
        onLocalPath: (m) => channel.send({ t: "pa", id: localId, ...m }),
        onInteract: (it) => propsRef.current.onInteract(it),
```

with:

```tsx
      engine = new GameEngine(canvas, map, art, {
        onLocalMove: (m) => {
          channel.send({ t: "mv", id: localId, ...m });
          if (m.mv) propsRef.current.onLocalMove?.();
        },
        onLocalPath: (m) => {
          channel.send({ t: "pa", id: localId, ...m });
          propsRef.current.onLocalMove?.();
        },
        onInteract: (it) => propsRef.current.onInteract(it),
```

**components/game/GameShell.tsx.** Replace:

```tsx
        onPlotChanged={farm.data.plotChanged}
        onFirstFrame={onFirstFrame}
```

with:

```tsx
        onPlotChanged={farm.data.plotChanged}
        onLocalMove={farm.moved}
        onFirstFrame={onFirstFrame}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (6 files, 124 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameCanvas.tsx components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/Handbook.tsx components/game/farm/PlotPanel.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/farm/actions.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/game-canvas-input.test.tsx tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): snail beds, pest snails, the gathering prompts and the ready cues

E at a ready bed runs a 3 s bar ("🐌 Đang mò ốc bãi 2…") with fa 7 at its start and at
2 s, then pick_snail_bed and a toast of what it gave; walking or setting off on a path
(the canvas's new onLocalMove), Huỷ or Esc stops it before anything is sent, and it
never locks movement. A pest-snail pick toasts what the picker kept, and its button
hints the 1–3 ốc bươu vàng (or where they go when full) with a link to the handbook's
Cua & ốc, which Sổ tay shows once 0018 has critters. A hole's or a bed's prompt names
its state for me, and the canvas shows the ready cue on each open spot that is not
cooling, following every answer and the 30 s tick.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameCanvas.tsx components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/Handbook.tsx components/game/farm/PlotPanel.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/farm/actions.ts tests/unit/anticheat-pins.test.tsx tests/unit/farm-actions.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-plot-panel.test.tsx tests/unit/game-canvas-input.test.tsx tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 13: anh Hai's containers, cô Út's cua & ốc, the bag's section and the HUD count

**Files:**
- Modify: `lib/game/farm/gather.ts`, `hooks/useField.ts`, `hooks/useFarmController.ts`, `components/game/farm/FarmShopPanel.tsx`, `components/game/farm/RiceDepotPanel.tsx`, `components/game/farm/FarmOverlays.tsx`, `components/game/fishing/BagPanel.tsx`, `components/game/GameShell.tsx`
- Test: `tests/unit/farm-gather.test.ts`, `farm-panels.test.tsx`, `fishing-panels.test.tsx`, `use-farm-controller.test.tsx`, `farm-overlays.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 5 (`sellCritters`, `boxRow`, `CritterKind`, `CritterPrices`, `GatherMine`, `critterPrice`, `heldBox`, `critterCount`, `describeFarmItem`), Task 6 (`lowerFirst`), Task 7 (`critterSaleText`, `produceSummary(…, critters)`); v14's `formatMult` (`lib/game/fishing/prices.ts`), `formatXu`, `ItemIcon`; v15.2's shop sections, depot rows, the bag's `BagFarm` and Nông cụ, the HUD's `riceLine`.
- Produces:
  - `gather.ts`: `visitsLeft(g, now)` (the server's count, or a whole day's once `now ≥ dayResetsAt`), which `spotState` now uses;
  - `useField`: `sellCritters(kind)`; `useFarmController`: `sellCritters(kind) → Promise<boolean>` with the toast `critterSaleText(sold.n, sold.xu)`;
  - `FarmShopPanel`: the section "🪣 Đồ đựng cua ốc" after "Nông cụ", one row per container with no stepper: "Mua · {1.500 xu}", or a disabled "✓ Đã có", "Đã có {giỏ tre} lớn hơn" or "Không đủ xu";
  - `RiceDepotPanel`: `DepotCritters { prices, onSell }` and the optional prop `critters`: the section "🦀 Cua & ốc" (the price line "Giá hôm nay ×{2,24}: cua đồng {26} · … xu/con", a row per kind held with "Bán {n} con · {xu}", "Bán hết cua ốc · {xu}", the footnote) and the extended empty line; `FarmOverlays` passes it once the catalog has critter kinds;
  - `BagPanel`: `BagFarm` gains `critters` and `now`; the section "🦀 Cua & ốc" (the container and how full it is, or "Tay không · {n}/3 con — tiệm anh Hai bán …", a line per kind held, today's visits left); `GameShell` fills them and adds the critter count to the HUD's line.

- [ ] **Step 1: Write the failing tests**

**tests/unit/farm-gather.test.ts — edit 1 of 2.** Replace:

```ts
  BED_BAR_MS, BED_COUNT, CRAB_FINISH_WAIT_MS, critterCap, critterCount, critterPrice, GATHER, gatherPrompt, heldBox, HOLE_COUNT,
  minutesLeft, spotId, spotKey, spotState, TRANSPLANT_WAIT_MS,
} from "@/lib/game/farm/gather";
```

with:

```ts
  BED_BAR_MS, BED_COUNT, CRAB_FINISH_WAIT_MS, critterCap, critterCount, critterPrice, GATHER, gatherPrompt, heldBox, HOLE_COUNT,
  minutesLeft, spotId, spotKey, spotState, TRANSPLANT_WAIT_MS, visitsLeft,
} from "@/lib/game/farm/gather";
```

**tests/unit/farm-gather.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("visitsLeft (v15.3 §7.5)", () => {
  it("is the server's count until its Vietnam midnight, then a whole day's", () => {
    const g = { readyAt: {}, leftToday: 13, dayResetsAt: 5_000 };
    expect([visitsLeft(g, 4_999), visitsLeft(g, 5_000)]).toEqual([13, GATHER.dailyVisits]);
    expect(visitsLeft({ ...g, dayResetsAt: null }, 9_999)).toBe(13);
  });
});
```

**tests/unit/farm-panels.test.tsx — edit 1 of 2.** Replace:

```tsx
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

with:

```tsx
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import {
  critterFromRow, farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow,
} from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
```

**tests/unit/farm-panels.test.tsx — edit 2 of 2.** Append at the end of the file, after a blank line:

```tsx
describe("v15.3: anh Hai's containers and cô Út's cua & ốc", () => {
  const KINDS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
    critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
    critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
  ];
  const GATHERING: FarmCatalog = {
    ...CATALOG, critters: KINDS,
    items: [
      ...CATALOG.items, item("tool_sickle", "tool", "Liềm", 1500),
      item("box_bucket", "critter_box", "Xô nhựa", 1500, { sort_order: 10, capacity: 15 }),
      item("box_basket", "critter_box", "Giỏ tre", 6000, { sort_order: 20, capacity: 30 }),
    ],
  };
  const shop = (coins: number, items: Record<string, number>, onBuy = vi.fn()) => {
    render(<FarmShopPanel mine={{ ...STATE.mine, coins, items }} catalog={GATHERING} failed={false} busy={false} onBuy={onBuy}
      onReload={noop} onClose={noop} />);
    return onBuy;
  };
  const row = (name: string) => screen.getByText(name).closest("li")!;

  it("sells the containers once each, after Nông cụ, and no smaller one than mine", () => {
    const onBuy = shop(10_000, {});
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(
      ["🌾 Giống lúa", "🧺 Phân bón", "🧴 Thuốc", "🛠\uFE0F Nông cụ", "🪣 Đồ đựng cua ốc"]);
    expect(within(row("Xô nhựa")).queryByRole("group")).toBeNull();
    expect(within(row("Xô nhựa")).getByText("Đựng thêm 15 con cua, ốc (tay cầm được 3 con)")).toBeInTheDocument();
    fireEvent.click(within(row("Xô nhựa")).getByRole("button", { name: "Mua · 1.500 xu" }));
    expect(onBuy).toHaveBeenCalledWith("box_bucket", 1);
    cleanup();
    shop(10_000, { box_basket: 1 });
    expect(within(row("Giỏ tre")).getByRole("button", { name: "✓ Đã có" })).toBeDisabled();
    expect(within(row("Xô nhựa")).getByRole("button", { name: "Đã có giỏ tre lớn hơn" })).toBeDisabled();
    cleanup();
    shop(10_000, { box_bucket: 1 });
    expect(within(row("Giỏ tre")).getByRole("button", { name: "Mua · 6.000 xu" })).toBeEnabled();
    cleanup();
    shop(1000, {});
    expect(within(row("Xô nhựa")).getByRole("button", { name: "Không đủ xu" })).toBeDisabled();
  });

  it("buys cua & ốc at the prices fixed at the catch, a kind or all, under today's prices", () => {
    const onSell = vi.fn();
    const mine = { ...STATE.mine, rice: {}, critters: { cua_dong: { n: 5, xu: 130 }, oc_buou_vang: { n: 1, xu: 4 } } };
    render(<RiceDepotPanel mine={mine} catalog={GATHERING} failed={false} busy={false} onSell={noop} onSellProduce={noop} onReload={noop}
      onClose={noop} critters={{ prices: { mult: 2.24, endsAt: null }, onSell }} />);
    expect(screen.getByRole("heading", { name: "🦀 Cua & ốc" })).toBeInTheDocument();
    expect(screen.getByText("Giá hôm nay ×2,24: cua đồng 26 · cua gạch 100 · ốc đồng 17 · ốc bươu vàng 4 xu/con")).toBeInTheDocument();
    fireEvent.click(within(row("Cua đồng × 5 · 130 xu")).getByRole("button", { name: "Bán 5 con · 130 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("cua_dong");
    fireEvent.click(within(row("Ốc bươu vàng × 1 · 4 xu")).getByRole("button", { name: "Bán 1 con · 4 xu" }));
    expect(onSell).toHaveBeenLastCalledWith("oc_buou_vang");
    fireEvent.click(screen.getByRole("button", { name: "Bán hết cua ốc · 134 xu" }));
    expect(onSell).toHaveBeenLastCalledWith(null);
    expect(screen.getByText("Giá chốt lúc bắt được; bán sau vẫn giữ giá đó.")).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có lúa/)).toBeNull();
  });

  it("names cua & ốc among what cô Út takes once 0018 is in, and shows its prices with nothing held", () => {
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={GATHERING} failed={false} busy={false} onSell={noop}
      onSellProduce={noop} onReload={noop} onClose={noop} critters={{ prices: { mult: 1, endsAt: null }, onSell: noop }} />);
    expect(screen.getByText("“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”")).toBeInTheDocument();
    expect(screen.getByText("Giá hôm nay ×1,00: cua đồng 12 · cua gạch 45 · ốc đồng 8 · ốc bươu vàng 2 xu/con")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Bán/ })).toBeNull();
    cleanup();
    render(<RiceDepotPanel mine={{ ...STATE.mine, rice: {} }} catalog={CATALOG} failed={false} busy={false} onSell={noop}
      onSellProduce={noop} onReload={noop} onClose={noop} />);
    expect(screen.getByText("“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”")).toBeInTheDocument();
    expect(screen.queryByText("🦀 Cua & ốc")).toBeNull();
  });
});
```

**tests/unit/fishing-panels.test.tsx — edit 1 of 3.** Replace:

```tsx
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { farmItemFromRow } from "@/lib/game/farm/catalog";
import type { FarmMine, Tank } from "@/lib/game/farm/state";
```

with:

```tsx
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { critterFromRow, farmItemFromRow } from "@/lib/game/farm/catalog";
import type { FarmMine, Tank } from "@/lib/game/farm/state";
```

**tests/unit/fishing-panels.test.tsx — edit 2 of 3.** Replace:

```tsx
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={() => {}} onRelease={() => {}} onClose={() => {}}
      farm={{ mine: m, items: ITEMS, busy: false, onLoad }} />);
    return onLoad;
```

with:

```tsx
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={() => {}} onRelease={() => {}} onClose={() => {}}
      farm={{ mine: m, items: ITEMS, critters: [], now: 0, busy: false, onLoad }} />);
    return onLoad;
```

**tests/unit/fishing-panels.test.tsx — edit 3 of 3.** Append at the end of the file, after a blank line:

```tsx
describe("BagPanel, Cua & ốc (v15.3 §13.4)", () => {
  const farmItem = (id: string, kind: string, name: string, price: number, over: Record<string, unknown> = {}) => farmItemFromRow({
    id, kind, name, price, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
  });
  const ITEMS = [
    farmItem("tool_sickle", "tool", "Liềm", 1500),
    farmItem("box_bucket", "critter_box", "Xô nhựa", 1500, { sort_order: 10, capacity: 15 }),
    farmItem("box_basket", "critter_box", "Giỏ tre", 6000, { sort_order: 20, capacity: 30 }),
  ];
  const KINDS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
  ];
  const mine = (items: Record<string, number>, critters: FarmMine["critters"], cap: number, left = 187, reset: number | null = null): FarmMine => ({
    items, rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null, critters, critterCap: cap,
    gather: { readyAt: {}, leftToday: left, dayResetsAt: reset },
  });
  const bag = (m: FarmMine, critters = KINDS, now = 0) => render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={() => {}}
    onRelease={() => {}} onClose={() => {}} farm={{ mine: m, items: ITEMS, critters, now, busy: false, onLoad: () => {} }} />);

  it("shows the container, the critters held and today's visits left", () => {
    bag(mine({ box_basket: 1 }, { cua_dong: { n: 11, xu: 286 }, cua_gach: { n: 1, xu: 100 } }, 33));
    expect(screen.getByText("🦀 Cua & ốc")).toBeInTheDocument();
    expect(screen.getByText("Giỏ tre · 12/33 con")).toBeInTheDocument();
    expect(screen.getByText("Cua đồng × 11 · 286 xu")).toBeInTheDocument();
    expect(screen.getByText("Cua gạch × 1 · 100 xu")).toBeInTheDocument();
    expect(screen.getByText("Bán ở vựa cô Út · hôm nay còn 187 lượt bắt cua, mò ốc.")).toBeInTheDocument();
  });

  it("says where to buy a container, and counts a new day's visits once it has begun", () => {
    bag(mine({}, { cua_dong: { n: 2, xu: 24 } }, 3, 0, 5_000), KINDS, 5_000);
    expect(screen.getByText("Tay không · 2/3 con — tiệm anh Hai bán xô nhựa 1.500 xu, giỏ tre 6.000 xu")).toBeInTheDocument();
    expect(screen.getByText("Bán ở vựa cô Út · hôm nay còn 200 lượt bắt cua, mò ốc.")).toBeInTheDocument();
  });

  it("is not there before 0018", () => {
    bag(mine({}, {}, 3), []);
    expect(screen.queryByText("🦀 Cua & ốc")).toBeNull();
  });
});
```

**tests/unit/use-farm-controller.test.tsx — edit 1 of 2.** Replace:

```tsx
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(), pickSnailBed: vi.fn(),
}));
```

with:

```tsx
  claimFarmGift: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(), pickSnailBed: vi.fn(),
  sellCritters: vi.fn(),
}));
```

**tests/unit/use-farm-controller.test.tsx — edit 2 of 2.** Replace:

```tsx

  it("draws the ready cue on each hole and bed open and not cooling for me, none before 0018", async () => {
```

with:

```tsx

  it("sells cua & ốc to cô Út, a kind or all, and toasts what she paid", async () => {
    const onCoinsChanged = vi.fn();
    const { result, toast } = setup({ onCoinsChanged });
    await flush();
    rpc.sellCritters.mockResolvedValueOnce({
      serverNow: iso(0), mine: parseFarmMine({ items: {}, rice: {}, coins: 1230, gift_claimed: true }), sold: { n: 6, xu: 230 },
    });
    await act(async () => { expect(await result.current.sellCritters(null)).toBe(true); });
    expect(rpc.sellCritters).toHaveBeenCalledWith("tok", null);
    expect(toast).toHaveBeenCalledWith("💰 Bán 6 con cua ốc được 230 xu.");
    expect(onCoinsChanged).toHaveBeenCalledTimes(1);
    rpc.sellCritters.mockRejectedValueOnce({ message: "no critters" });
    await act(async () => { expect(await result.current.sellCritters("cua_dong")).toBe(false); });
    expect(toast).toHaveBeenLastCalledWith("Không có cua ốc để bán.");
  });

  it("draws the ready cue on each hole and bed open and not cooling for me, none before 0018", async () => {
```

**tests/unit/farm-overlays.test.tsx — edit 1 of 4.** Replace:

```tsx
import type { FarmController, FarmRound } from "@/hooks/useFarmController";
import { farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { NOT_OPEN } from "@/lib/game/farm/messages";
```

with:

```tsx
import type { FarmController, FarmRound } from "@/hooks/useFarmController";
import { critterFromRow, farmItemFromRow, varietyFromRow } from "@/lib/game/farm/catalog";
import { NOT_OPEN } from "@/lib/game/farm/messages";
```

**tests/unit/farm-overlays.test.tsx — edit 2 of 4.** Replace:

```tsx
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
    pickSnailBed: vi.fn(),
  },
```

with:

```tsx
    claimGift: vi.fn(), plotChanged: vi.fn(), loadSprayer: vi.fn(), sellProduce: vi.fn(), crabStart: vi.fn(), crabFinish: vi.fn(),
    pickSnailBed: vi.fn(), sellCritters: vi.fn(),
  },
```

**tests/unit/farm-overlays.test.tsx — edit 3 of 4.** Replace:

```tsx
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
  loadSprayer: vi.fn().mockResolvedValue(true), sellProduce: vi.fn().mockResolvedValue(true), interact: vi.fn(), promptText: vi.fn(),
  ...over,
```

with:

```tsx
  act: vi.fn().mockResolvedValue(true), buy: vi.fn().mockResolvedValue(true), sell: vi.fn().mockResolvedValue(true),
  loadSprayer: vi.fn().mockResolvedValue(true), sellProduce: vi.fn().mockResolvedValue(true), sellCritters: vi.fn().mockResolvedValue(true),
  interact: vi.fn(), promptText: vi.fn(),
  ...over,
```

**tests/unit/farm-overlays.test.tsx — edit 4 of 4.** Replace:

```tsx
    expect(screen.getByRole("tab", { name: "Nước" })).toHaveAttribute("aria-selected", "true");
  });
});
```

with:

```tsx
    expect(screen.getByRole("tab", { name: "Nước" })).toHaveAttribute("aria-selected", "true");
  });

  it("sells cua & ốc at cô Út's once 0018 has critters (v15.3 §13.4)", () => {
    const kinds = [critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 })];
    const state = { ...STATE, critterPrices: { mult: 1.5, endsAt: null }, mine: { ...STATE.mine, critters: { cua_dong: { n: 2, xu: 36 } } } };
    const depot = controller({ panel: { kind: "depot" }, data: { ...controller().data, state, catalog: { ...CATALOG, critters: kinds } } });
    const { rerender } = render(<FarmOverlays farm={depot} me="me" onField />);
    expect(screen.getByText("Giá hôm nay ×1,50: cua đồng 18 xu/con")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bán hết cua ốc · 36 xu" }));
    expect(depot.sellCritters).toHaveBeenCalledWith(null);
    // before 0018: no critter kinds, no section
    rerender(<FarmOverlays farm={controller({ panel: { kind: "depot" } })} me="me" onField />);
    expect(screen.queryByText("🦀 Cua & ốc")).toBeNull();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/farm-gather.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/fishing-panels.test.tsx tests/unit/use-farm-controller.test.tsx`
Expected: FAIL — 8 tests fail (`visitsLeft is not a function`, `result.current.sellCritters is not a function`, no "🪣 Đồ đựng cua ốc" section, no "🦀 Cua & ốc" in the depot or the bag); 97 pass.

- [ ] **Step 3: Implement**

**lib/game/farm/gather.ts — edit 1 of 3.** Replace:

```ts
import type { FarmCatalog, FarmItem } from "./catalog";
import type { FarmMine } from "./state";
```

with:

```ts
import type { FarmCatalog, FarmItem } from "./catalog";
import type { FarmMine, GatherMine } from "./state";
```

**lib/game/farm/gather.ts — edit 2 of 3.** Replace:

```ts

/** How many critters are held, every kind together. */
```

with:

```ts

/** Today's visits left (§7.5): the server's count, or a whole day's once its Vietnam midnight has passed. */
export function visitsLeft(g: GatherMine, now: number): number {
  return g.dayResetsAt !== null && now >= g.dayResetsAt ? GATHER.dailyVisits : g.leftToday;
}

/** How many critters are held, every kind together. */
```

**lib/game/farm/gather.ts — edit 3 of 3.** Replace:

```ts
  const g = mine.gather;
  if (g.leftToday <= 0 && (g.dayResetsAt === null || now < g.dayResetsAt)) return { kind: "limit" };
  if (critterCount(mine.critters) >= mine.critterCap) return { kind: "full", box: heldBox(mine.items, catalog.items) };
```

with:

```ts
  const g = mine.gather;
  if (visitsLeft(g, now) <= 0) return { kind: "limit" };
  if (critterCount(mine.critters) >= mine.critterCap) return { kind: "full", box: heldBox(mine.items, catalog.items) };
```

**hooks/useField.ts — edit 1 of 3.** Replace:

```ts
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer,
  pickSnailBed, RPCS_152, RPCS_153, sellProduce, sellRice, type CatchAnswer, type CrabVisit, type FieldAction, type FieldAnswer,
  type MineAnswer,
} from "@/lib/game/farm/rpc";
```

with:

```ts
  actionCall, buyFarmItem, claimFarmGift, crabFinish, crabStart, fetchFarmCatalog, fetchFieldState, fieldAction, loadSprayer,
  pickSnailBed, RPCS_152, RPCS_153, sellCritters, sellProduce, sellRice, type CatchAnswer, type CrabVisit, type FieldAction,
  type FieldAnswer, type MineAnswer,
} from "@/lib/game/farm/rpc";
```

**hooks/useField.ts — edit 2 of 3.** Replace:

```ts
  pickSnailBed: (bed: number) => Promise<(MineAnswer & { snails: CatchAnswer }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

with:

```ts
  pickSnailBed: (bed: number) => Promise<(MineAnswer & { snails: CatchAnswer }) | null>;
  /** Sells every critter of a kind to cô Út, or all of them (null), at their stored prices (v15.3 R15). */
  sellCritters: (kind: string | null) => Promise<(MineAnswer & { sold: { n: number; xu: number } }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
```

**hooks/useField.ts — edit 3 of 3.** Replace:

```ts
      call(() => pickSnailBed(roomId, token, bed), applyMine, { rpc: "pick_snail_bed" }), [call, applyMine, roomId, token]),
  };
```

with:

```ts
      call(() => pickSnailBed(roomId, token, bed), applyMine, { rpc: "pick_snail_bed" }), [call, applyMine, roomId, token]),
    sellCritters: useCallback((kind: string | null) =>
      call(() => sellCritters(token, kind), applyMine, { rpc: "sell_critters" }), [call, applyMine, token]),
  };
```

**hooks/useFarmController.ts — edit 1 of 4.** Replace:

```ts
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, crittersFullText, FIELD_LOADING, GATHER_LIMIT_TEXT, GIFT_TEXT,
  harvestText, harvesterDoneText, holeEmptyText, loadedText, NOT_OPEN, NOT_OPEN_153, pestSnailText, pickingText, produceSaleText,
  riceSaleText, WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
```

with:

```ts
import {
  bedEmptyText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, FIELD_LOADING,
  GATHER_LIMIT_TEXT, GIFT_TEXT, harvestText, harvesterDoneText, holeEmptyText, loadedText, NOT_OPEN, NOT_OPEN_153, pestSnailText,
  pickingText, produceSaleText, riceSaleText, WORK_EXPIRED, WORK_EXPIRED_TP,
} from "@/lib/game/farm/messages";
```

**hooks/useFarmController.ts — edit 2 of 4.** Replace:

```ts
  sellProduce: (upland: string, kg: number) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
```

with:

```ts
  sellProduce: (upland: string, kg: number) => Promise<boolean>;
  /** cô Út buys my critters of a kind, or all of them (null), at their stored prices (v15.3 §7.6). */
  sellCritters: (kind: string | null) => Promise<boolean>;
  /** Handles the field's interactables; false for anything else. */
```

**hooks/useFarmController.ts — edit 3 of 4.** Replace:

```ts
  }, [sellCrop]);
```

with:

```ts
  }, [sellCrop]);
  const { sellCritters: sellCatch } = data;
  const sellCritters = useCallback(async (kind: string | null): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await sellCatch(kind);
      // what she paid, from the answer (the prices were fixed at the catch)
      if (r) live.current.toast(critterSaleText(r.sold.n, r.sold.xu));
      return r !== null;
    } finally {
      setBusy(false);
    }
  }, [sellCatch]);
```

**hooks/useFarmController.ts — edit 4 of 4.** Replace:

```ts
    sellProduce,
    interact,
```

with:

```ts
    sellProduce,
    sellCritters,
    interact,
```

**components/game/farm/FarmShopPanel.tsx — edit 1 of 6.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { describeFarmItem, ITEM_CAP, type FarmCatalog, type FarmItem } from "@/lib/game/farm/catalog";
import { itemCount, type FarmMine } from "@/lib/game/farm/state";
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { boxRow, describeFarmItem, ITEM_CAP, type FarmCatalog, type FarmItem } from "@/lib/game/farm/catalog";
import { lowerFirst } from "@/lib/game/farm/gather";
import { itemCount, type FarmMine } from "@/lib/game/farm/state";
```

**components/game/farm/FarmShopPanel.tsx — edit 2 of 6.** Replace:

```tsx

/** The shelves (v15.2 §13.5): rice seed, hoa-màu seed, fertilizers, pesticides and the tools. */
const SECTIONS: ReadonlyArray<[string, string, (i: FarmItem) => boolean]> = [
```

with:

```tsx

/** The shelves (v15.2 §13.5, v15.3 §13.4): rice seed, hoa-màu seed, fertilizers, pesticides, the tools and the critter
 *  containers. */
const SECTIONS: ReadonlyArray<[string, string, (i: FarmItem) => boolean]> = [
```

**components/game/farm/FarmShopPanel.tsx — edit 3 of 6.** Replace:

```tsx
  ["tool", "🛠️ Nông cụ", (i) => i.kind === "tool"],
];
```

with:

```tsx
  ["tool", "🛠️ Nông cụ", (i) => i.kind === "tool"],
  ["critter_box", "🪣 Đồ đựng cua ốc", (i) => i.kind === "critter_box"],
];
```

**components/game/farm/FarmShopPanel.tsx — edit 4 of 6.** Replace:

```tsx
        <button type="button" className="pch-btn" disabled>✓ Đã có</button>
      ) : mine.coins < price ? (
```

with:

```tsx
        <button type="button" className="pch-btn" disabled>✓ Đã có</button>
      ) : mine.coins < price ? (
        <button type="button" className="pch-btn" disabled>Không đủ xu</button>
      ) : (
        <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onBuy(item.id, 1)}>Mua · {formatXu(price)}</button>
      )}
    </li>
  );
}

/** A critter container (v15.3 R16): bought once, no stepper; one no larger than the one I hold is no use. */
function BoxRow({ item, mine, all, busy, onBuy }: {
  item: FarmItem;
  mine: FarmMine;
  all: readonly FarmItem[];
  busy: boolean;
  onBuy: (itemId: string, qty: number) => void;
}) {
  const price = item.price ?? 0;
  const row = boxRow(item, mine.items, all);
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
      {row.state === "owned" ? (
        <button type="button" className="pch-btn" disabled>✓ Đã có</button>
      ) : row.state === "bigger" ? (
        <button type="button" className="pch-btn" disabled>Đã có {lowerFirst(row.name)} lớn hơn</button>
      ) : mine.coins < price ? (
```

**components/game/farm/FarmShopPanel.tsx — edit 5 of 6.** Replace:

```tsx

/** 🧺 Tiệm vật tư · anh Hai (spec §9, §13.3; v15.2 §13.5): seeds, fertilizers and pesticides by the quantity, and the
 *  tools once. */
export default function FarmShopPanel({ mine, catalog, failed, busy, onBuy, onReload, onClose }: {
```

with:

```tsx

/** 🧺 Tiệm vật tư · anh Hai (spec §9, §13.3; v15.2 §13.5; v15.3 §13.4): seeds, fertilizers and pesticides by the
 *  quantity, and the tools and the critter containers once. */
export default function FarmShopPanel({ mine, catalog, failed, busy, onBuy, onReload, onClose }: {
```

**components/game/farm/FarmShopPanel.tsx — edit 6 of 6.** Replace:

```tsx
                      ? <ToolRow key={i.id} item={i} mine={mine} busy={busy} onBuy={onBuy} />
                      : <Row key={i.id} item={i} mine={mine} catalog={catalog} busy={busy} onBuy={onBuy} />))}
                  </ul>
```

with:

```tsx
                      ? <ToolRow key={i.id} item={i} mine={mine} busy={busy} onBuy={onBuy} />
                      : i.kind === "critter_box"
                        ? <BoxRow key={i.id} item={i} mine={mine} all={catalog.items} busy={busy} onBuy={onBuy} />
                        : <Row key={i.id} item={i} mine={mine} catalog={catalog} busy={busy} onBuy={onBuy} />))}
                  </ul>
```

**components/game/farm/RiceDepotPanel.tsx — edit 1 of 5.** Replace:

```tsx
import { producePrice, ricePrice, type FarmCatalog, type UplandCrop, type Variety } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import FieldStatus from "./FieldStatus";
```

with:

```tsx
import { producePrice, ricePrice, type FarmCatalog, type UplandCrop, type Variety } from "@/lib/game/farm/catalog";
import { critterPrice, lowerFirst } from "@/lib/game/farm/gather";
import type { CritterPrices, FarmMine } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import { formatMult } from "@/lib/game/fishing/prices";
import FieldStatus from "./FieldStatus";
```

**components/game/farm/RiceDepotPanel.tsx — edit 2 of 5.** Replace:

```tsx

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3; v15.2 §13.5): sell wet or dry rice per variety — dry rice pays the full price —
 *  and hoa màu, fresh. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose }: {
  mine: FarmMine | null;
```

with:

```tsx

/** cô Út's cua & ốc once 0018 has critters (v15.3 §13.4): today's prices, and the sale of a kind or of all (null). */
export interface DepotCritters { prices: CritterPrices | null; onSell: (kind: string | null) => void }

/** 🦀 Cua & ốc: today's prices from the room's M, a row per kind held at the prices fixed at the catch, and Bán hết. */
function CritterSection({ mine, catalog, critters, busy }: { mine: FarmMine; catalog: FarmCatalog; critters: DepotCritters; busy: boolean }) {
  const held = catalog.critters.flatMap((k) => ((mine.critters[k.id]?.n ?? 0) > 0 ? [{ k, s: mine.critters[k.id] }] : []));
  const total = held.reduce((xu, h) => xu + h.s.xu, 0);
  const { prices, onSell } = critters;
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xl text-burgundy">🦀 Cua & ốc</h3>
      {prices && (
        <p>
          Giá hôm nay {formatMult(prices.mult)}: {catalog.critters.map((k) => `${lowerFirst(k.name)} ${critterPrice(k.basePrice, prices.mult)}`).join(" · ")} xu/con
        </p>
      )}
      {held.length > 0 && (
        <ul className="flex flex-col gap-2">
          {held.map(({ k, s }) => (
            <li key={k.id} className="pch flex flex-wrap items-center justify-between gap-2 p-2">
              <span className="flex items-center gap-2"><ItemIcon id={k.id} scale={3} />{k.name} × {s.n} · {formatXu(s.xu)}</span>
              <button type="button" className="pch-btn" disabled={busy} onClick={() => onSell(k.id)}>Bán {s.n} con · {formatXu(s.xu)}</button>
            </li>
          ))}
        </ul>
      )}
      {held.length > 0 && (
        <button type="button" className="pch-btn pch-btn-primary self-end" disabled={busy} onClick={() => onSell(null)}>
          Bán hết cua ốc · {formatXu(total)}
        </button>
      )}
      <p className="text-base opacity-80">Giá chốt lúc bắt được; bán sau vẫn giữ giá đó.</p>
    </section>
  );
}

/** 🌾 Vựa lúa · cô Út (spec §8.7, §13.3; v15.2 §13.5; v15.3 §13.4): sell wet or dry rice per variety — dry rice pays the
 *  full price — hoa màu, fresh, and cua & ốc once 0018 has critters. */
export default function RiceDepotPanel({ mine, catalog, failed, busy, onSell, onSellProduce, onReload, onClose, critters = null }: {
  mine: FarmMine | null;
```

**components/game/farm/RiceDepotPanel.tsx — edit 3 of 5.** Replace:

```tsx
  onClose: () => void;
}) {
```

with:

```tsx
  onClose: () => void;
  critters?: DepotCritters | null;
}) {
```

**components/game/farm/RiceDepotPanel.tsx — edit 4 of 5.** Replace:

```tsx
  const produce = (catalog?.uplands ?? []).flatMap((u) => ((mine?.produce[u.id] ?? 0) > 0 ? [{ u, kg: mine!.produce[u.id] }] : []));
  return (
```

with:

```tsx
  const produce = (catalog?.uplands ?? []).flatMap((u) => ((mine?.produce[u.id] ?? 0) > 0 ? [{ u, kg: mine!.produce[u.id] }] : []));
  const caught = Object.values(mine?.critters ?? {}).some((s) => s.n > 0);
  return (
```

**components/game/farm/RiceDepotPanel.tsx — edit 5 of 5.** Replace:

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
          </>
```

with:

```tsx
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            {lines.length + produce.length > 0 ? (
              <>
                <p>{lines.length > 0 ? "“Lúa phơi khô cô trả đủ giá, lúa ướt chỉ được bảy phần.”" : "“Hoa màu bán tươi, khỏi phơi — cô lấy hết!”"}</p>
                <ul className="flex flex-col gap-2">
                  {lines.map((l) => <StockRow key={`${l.v.id}:${l.dry}`} {...l} busy={busy} onSell={onSell} />)}
                  {produce.map((x) => <ProduceRow key={x.u.id} u={x.u} kg={x.kg} busy={busy} onSell={onSellProduce} />)}
                </ul>
              </>
            ) : !critters ? (
              <p>“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”</p>
            ) : !caught && (
              <p>“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”</p>
            )}
            {critters && <CritterSection mine={mine} catalog={catalog} critters={critters} busy={busy} />}
          </>
```

**components/game/farm/FarmOverlays.tsx.** Replace:

```tsx
          onSell={(v, dry, kg) => void farm.sell(v, dry, kg)} onSellProduce={(u, kg) => void farm.sellProduce(u, kg)}
          onReload={onReload} onClose={closePanel} />
```

with:

```tsx
          onSell={(v, dry, kg) => void farm.sell(v, dry, kg)} onSellProduce={(u, kg) => void farm.sellProduce(u, kg)}
          critters={(catalog?.critters.length ?? 0) > 0
            ? { prices: state?.critterPrices ?? null, onSell: (k) => void farm.sellCritters(k) } : null}
          onReload={onReload} onClose={closePanel} />
```

**components/game/fishing/BagPanel.tsx — edit 1 of 4.** Replace:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { TANK_CHARGES, TOOL_SICKLE, TOOL_SPRAYER, type FarmItem } from "@/lib/game/farm/catalog";
import type { FarmMine } from "@/lib/game/farm/state";
```

with:

```tsx
import { ParchmentModal } from "@/components/game/Parchment";
import { TANK_CHARGES, TOOL_SICKLE, TOOL_SPRAYER, type CritterKind, type FarmItem } from "@/lib/game/farm/catalog";
import { critterCount, heldBox, lowerFirst, visitsLeft } from "@/lib/game/farm/gather";
import type { FarmMine } from "@/lib/game/farm/state";
```

**components/game/fishing/BagPanel.tsx — edit 2 of 4.** Replace:

```tsx

/** The field's side of the bag (v15.2 R29): my farm stock, the farm catalog's items, and Nạp thuốc. */
export interface BagFarm { mine: FarmMine; items: readonly FarmItem[]; busy: boolean; onLoad: (itemId: string) => void }
```

with:

```tsx

/** The field's side of the bag (v15.2 R29): my farm stock, the farm catalog's items and critter kinds (none before 0018),
 *  the server's clock, and Nạp thuốc. */
export interface BagFarm {
  mine: FarmMine;
  items: readonly FarmItem[];
  critters: readonly CritterKind[];
  now: number;
  busy: boolean;
  onLoad: (itemId: string) => void;
}
```

**components/game/fishing/BagPanel.tsx — edit 3 of 4.** Replace:

```tsx

/** 🎒 Giỏ đồ (spec §10.2, v15.2 R29): the fish (hand, then bucket), the owned rods and bobbers, the baits, the bait box
 *  and bucket, and — once the field has loaded — the farm tools. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose, farm = null }: {
```

with:

```tsx

/** 🦀 Cua & ốc (v15.3 §13.4): the container and how full it is (or where to buy one), a line per kind held, and today's
 *  visits left. */
function Critters({ farm }: { farm: BagFarm }) {
  const { mine, items, critters, now } = farm;
  const box = heldBox(mine.items, items);
  const n = critterCount(mine.critters);
  const shop = items.filter((i) => i.kind === "critter_box").sort((a, b) => a.sortOrder - b.sortOrder)
    .map((b) => `${lowerFirst(b.name)} ${formatXu(b.price ?? 0)}`).join(", ");
  return (
    <section>
      <h3 className="text-xl text-burgundy">🦀 Cua & ốc</h3>
      <ul>
        <li className="flex items-center gap-2 py-0.5">
          {box ? <ItemIcon id={box.id} scale={2} /> : <span className="w-8" />}
          <span>{box ? `${box.name} · ${n}/${mine.critterCap} con` : `Tay không · ${n}/${mine.critterCap} con — tiệm anh Hai bán ${shop}`}</span>
        </li>
        {critters.filter((k) => (mine.critters[k.id]?.n ?? 0) > 0).map((k) => (
          <li key={k.id} className="flex items-center gap-2 py-0.5">
            <ItemIcon id={k.id} scale={2} />
            <span>{k.name} × {mine.critters[k.id].n} · {formatXu(mine.critters[k.id].xu)}</span>
          </li>
        ))}
      </ul>
      <p className="text-base opacity-80">Bán ở vựa cô Út · hôm nay còn {visitsLeft(mine.gather, now)} lượt bắt cua, mò ốc.</p>
    </section>
  );
}

/** 🎒 Giỏ đồ (spec §10.2, v15.2 R29, v15.3 §13.4): the fish (hand, then bucket), the owned rods and bobbers, the baits,
 *  the bait box and bucket, and — once the field has loaded — the farm tools and the cua & ốc. */
export default function BagPanel({ state, catalog, busy, onEquip, onRelease, onClose, farm = null }: {
```

**components/game/fishing/BagPanel.tsx — edit 4 of 4.** Replace:

```tsx
        {farm && <FarmTools farm={farm} />}
      </div>
```

with:

```tsx
        {farm && <FarmTools farm={farm} />}
        {farm && farm.critters.length > 0 && <Critters farm={farm} />}
      </div>
```

**components/game/GameShell.tsx — edit 1 of 3.** Replace:

```tsx
import { formatClock } from "@/lib/format";
import { produceSummary } from "@/lib/game/farm/messages";
```

with:

```tsx
import { formatClock } from "@/lib/format";
import { critterCount } from "@/lib/game/farm/gather";
import { produceSummary } from "@/lib/game/farm/messages";
```

**components/game/GameShell.tsx — edit 2 of 3.** Replace:

```tsx
              onReload={() => void fishing.data.reload()}
              riceLine={map.id === "field" && farm.data.state ? produceSummary(farm.data.state.mine.rice, farm.data.state.mine.produce) : null}
            />
```

with:

```tsx
              onReload={() => void fishing.data.reload()}
              riceLine={map.id === "field" && farm.data.state
                ? produceSummary(farm.data.state.mine.rice, farm.data.state.mine.produce, critterCount(farm.data.state.mine.critters))
                : null}
            />
```

**components/game/GameShell.tsx — edit 3 of 3.** Replace:

```tsx
        farm={farm.data.state && farm.data.catalog?.items.some((i) => i.kind === "tool")
          ? { mine: farm.data.state.mine, items: farm.data.catalog.items, busy: farm.busy, onLoad: (id) => void farm.loadSprayer(id) }
          : null}
```

with:

```tsx
        farm={farm.data.state && farm.data.catalog?.items.some((i) => i.kind === "tool")
          ? {
            mine: farm.data.state.mine, items: farm.data.catalog.items, critters: farm.data.catalog.critters, now: farm.now, busy: farm.busy,
            onLoad: (id) => void farm.loadSprayer(id),
          }
          : null}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (5 files, 105 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/FarmShopPanel.tsx components/game/farm/RiceDepotPanel.tsx components/game/fishing/BagPanel.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/farm/gather.ts tests/unit/farm-gather.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/fishing-panels.test.tsx tests/unit/use-farm-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(v15.3): anh Hai's containers, cô Út's cua & ốc, the bag's section and the HUD count

anh Hai's shop gains "🪣 Đồ đựng cua ốc" after Nông cụ: a container is bought once, with no
stepper, and reads "✓ Đã có" when held or "Đã có giỏ tre lớn hơn" when a larger one is.
cô Út's depot gains "🦀 Cua & ốc" once 0018 has critters: today's prices under the room's M,
a row per kind held at the prices fixed at the catch, "Bán hết cua ốc", the footnote, and a
toast from the answer's sold; her empty line names cua ốc. The bag shows the container and
how full it is (or where to buy one), each kind held and today's visits left, counting a
whole day's once the server's Vietnam midnight has passed; the HUD's line adds 🦀 n.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameShell.tsx components/game/farm/FarmOverlays.tsx components/game/farm/FarmShopPanel.tsx components/game/farm/RiceDepotPanel.tsx components/game/fishing/BagPanel.tsx hooks/useFarmController.ts hooks/useField.ts lib/game/farm/gather.ts tests/unit/farm-gather.test.ts tests/unit/farm-overlays.test.tsx tests/unit/farm-panels.test.tsx tests/unit/fishing-panels.test.tsx tests/unit/use-farm-controller.test.tsx
git commit -F <message file>
```

---

### Task 14: The admin's cua ốc, the lock text, the integration tests, the README section, the spec amendments; the final checks

**Files:**
- Modify: `components/admin/AnticheatTab.tsx` (the two labels, the holdings line), `lib/admin.ts` (`AnticheatHoldings.critters`), `lib/anticheat.ts` (`WARN_LOCK`)
- Create: `tests/integration/v15-3.test.ts`
- Modify: `tests/unit/anticheat.test.ts`, `tests/unit/admin-anticheat.test.tsx`, `tests/integration/v15.test.ts` (the two containers)
- Modify: `README.md` (the v15 trust lines; append the "v15.3" section), `docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md`, `docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md`, `docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md`, `docs/superpowers/specs/2026-09-25-music-together-economy-design.md` (the v15.3 spec's §3 amendments), `docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md` (the transplant's 25 s gate, the rounds' limits)

**Interfaces:**
- Consumes: everything of Tasks 1–13; Task 4's `_ac_holdings` key `critters [{kind, n, xu}]`; Task 2's envelopes; `createClient` from `@supabase/supabase-js`; the integration tests' environment `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` (never put a value of these in a file).
- Produces:
  - `WARN_LOCK` names "bắt cua mò ốc" after "làm ruộng" (§11.6), in v16's sentence; `reasonText` keeps the generic line for the new codes;
  - `AnticheatTab`'s labels `bad_spot` "Số hang cua/bãi ốc sai" and `gather_daily_cap` "Chạm 200 lượt bắt cua, mò ốc/ngày" (before v16's card labels); `AnticheatHoldings.critters?` (older answers lack it) and the holdings line's `{n} con cua ốc` after `{kg} kg hoa màu`, v16's seats still last (anti-cheat §12.5 as amended);
  - `tests/integration/v15-3.test.ts` (§16; skipped without `SUPABASE_TEST_URL`, and the test project must be in log mode): anon reads `critter_kinds` and the containers but not `critters` or `gather_cooldowns`; a hits-0 visit and its honest refusals; a bed and its sale; strike-0 envelopes for `crab_finish` with hits 5 and for `bad_spot`; `v15.test.ts` counts 16 items of the farm kinds;
  - the README "v15.3" section after v16's (the migration and the production order, the deploy order, re-running older migrations, what's new, the trust model, the Realtime budget); the spec amendments, with the anti-cheat spec's guard counts at 52 and its `WARN_LOCK` row; the v15.3 spec's own lines for the transplant's 25 s gate (R19 as ruled), the transplant round's limits and the dropped late `crab_start` answer.

- [ ] **Step 1: Write the failing tests and the integration tests**

**tests/unit/anticheat.test.ts — edit 1 of 2.** Replace:

```ts
    for (const code of ["bad_plot", "bad_slot", "bad_water", "bad_work", "bad_qty", "bad_price", "foreign_offer",
      "kind_mismatch", "reel_gate_hug", "cast_daily_cap", "something_new"]) {
      expect(reasonText(code)).toBe("Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.");
```

with:

```ts
    for (const code of ["bad_plot", "bad_slot", "bad_water", "bad_work", "bad_qty", "bad_price", "foreign_offer",
      "kind_mismatch", "reel_gate_hug", "cast_daily_cap", "bad_spot", "gather_daily_cap", "something_new"]) {
      expect(reasonText(code)).toBe("Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.");
```

**tests/unit/anticheat.test.ts — edit 2 of 2.** Replace:

```ts
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
```

with:

```ts
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
```

**tests/unit/admin-anticheat.test.tsx — edit 1 of 3.** Replace:

```tsx
  tank: { item: "spray_insect", charges: 2 },
  plots: [{ room_id: "r", plot_no: 1, kind: "private", owned_at: T, sale_price: null, sublease_price: null }],
```

with:

```tsx
  tank: { item: "spray_insect", charges: 2 },
  critters: [{ kind: "cua_dong", n: 5, xu: 130 }, { kind: "oc_dong", n: 2, xu: 22 }],
  plots: [{ room_id: "r", plot_no: 1, kind: "private", owned_at: T, sale_price: null, sublease_price: null }],
```

**tests/unit/admin-anticheat.test.tsx — edit 2 of 3.** Replace:

```tsx
    expect(lan.getByText(
      "1.230 xu · 4 món đồ · 1 con cá · 2 kỷ lục · 1.500 kg lúa · 45 kg hoa màu · 1 thửa sở hữu · 0 thửa đang thuê · 1 đề nghị mua · 1 ô phơi · 2 tin khoe trong chat",
    )).toBeInTheDocument();
```

with:

```tsx
    expect(lan.getByText(
      "1.230 xu · 4 món đồ · 1 con cá · 2 kỷ lục · 1.500 kg lúa · 45 kg hoa màu · 7 con cua ốc · 1 thửa sở hữu · 0 thửa đang thuê · 1 đề nghị mua · 1 ô phơi · 2 tin khoe trong chat",
    )).toBeInTheDocument();
```

**tests/unit/admin-anticheat.test.tsx — edit 3 of 3.** Replace:

```tsx
    expect(lan.getByRole("button", { name: "Bằng chứng" })).toBeInTheDocument();
  });
});
```

with:

```tsx
    expect(lan.getByRole("button", { name: "Bằng chứng" })).toBeInTheDocument();
  });

  it("names v15.3's signals (§11.6)", async () => {
    const events = [
      { id: 4, created_at: T, code: "bad_spot", outcome: "log_only", rpc: "crab_start", room_id: "r", detail: { spot: 7 }, client: null,
        user_agent: null },
      { id: 3, created_at: T, code: "gather_daily_cap", outcome: "soft", rpc: "pick_snail_bed", room_id: "r", detail: { visits: 200 },
        client: null, user_agent: null },
    ];
    h.rpc.mockImplementation(async (fn: string) => (fn === "admin_anticheat_list"
      ? { data: { mode, mode_changed_at: T, server_now: T, cases: CASES }, error: null }
      : { data: { ...ACCOUNT, events }, error: null }));
    render(<AnticheatTab token="tok" />);
    const lan = within(await card("Lan"));
    fireEvent.click(lan.getByRole("button", { name: "Bằng chứng" }));
    expect(await lan.findByText(`${at(T)} · Số hang cua/bãi ốc sai · Chỉ ghi nhận · crab_start`)).toBeInTheDocument();
    expect(lan.getByText(`${at(T)} · Chạm 200 lượt bắt cua, mò ốc/ngày · Tín hiệu mềm · pick_snail_bed`)).toBeInTheDocument();
  });
});
```

Create `tests/integration/v15-3.test.ts` with exactly:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

// v15.3's crab holes, snail beds and cô Út's cua & ốc end to end, as far as a fresh account can go without xu; the
// gates, the odds, the prices and the daily limit are covered by tests/sql/v15-gather-smoke.sql. The test project must
// be in log mode ("Chỉ ghi nhận"): a flagged call then answers with strike 0 and never locks the test account.
run("v15.3 crab holes and snail beds", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("cua"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("mương"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };
  type Held = Record<string, { n: number; xu: number }>;

  it("lets anyone read the critter kinds and the containers, but nobody read the critters or the cooldowns", async () => {
    const { data: kinds, error } = await db.from("critter_kinds").select("id, name, grp, base_price");
    expect(error).toBeNull();
    expect((kinds ?? []).map((k) => [k.id, k.name, k.grp, k.base_price]).sort()).toEqual([
      ["cua_dong", "Cua đồng", "crab", 12], ["cua_gach", "Cua gạch", "crab", 45],
      ["oc_buou_vang", "Ốc bươu vàng", "snail", 2], ["oc_dong", "Ốc đồng", "snail", 8],
    ]);
    const { data: boxes } = await db.from("shop_items").select("id, price, capacity").eq("kind", "critter_box");
    expect((boxes ?? []).map((b) => [b.id, b.price, b.capacity]).sort()).toEqual([["box_basket", 6000, 30], ["box_bucket", 1500, 15]]);
    for (const table of ["critters", "gather_cooldowns"]) expect((await db.from(table).select("*")).error, table).not.toBeNull();
  });

  it("visits a hole once per cooldown, gives up with nothing caught, and refuses what a fresh account cannot do", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    const start = await call("crab_start", { p_hole: 1 });
    expect(start.error).toBeNull();
    const visit = (start.data as { visit: { id: string; hole: number } }).visit;
    expect(visit.hole).toBe(1);
    // hits 0 has no gate: the visit ends at once, with nothing caught
    const end = await call("crab_finish", { p_visit_id: visit.id, p_hits: 0 });
    expect(end.error).toBeNull();
    expect(end.data).toMatchObject({ crab: { hits: 0, caught: [], escaped: 0 } });
    expect((end.data as { mine: { critters: Held } }).mine.critters).toEqual({});
    expect((await call("crab_finish", { p_visit_id: visit.id, p_hits: 0 })).error?.message).toBe("visit not found");
    expect((await call("crab_start", { p_hole: 1 })).error?.message).toBe("hole empty");
    const mine = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_session_token: me.token, ...args });
    expect((await mine("sell_critters", { p_kind: null })).error?.message).toBe("no critters");
    expect((await mine("sell_critters", { p_kind: "tom" })).error?.message).toBe("invalid kind");
    expect((await mine("buy_farm_item", { p_item_id: "box_bucket", p_qty: 2 })).error?.message).toBe("invalid quantity");
    expect((await mine("buy_farm_item", { p_item_id: "box_basket", p_qty: 1 })).error?.message).toBe("not enough coins");
  });

  it("picks 1–3 snails from a bed and sells them to cô Út at the prices fixed at the pick", async () => {
    const me = await reg();
    const r = await room(me.token);
    const bed = await db.rpc("pick_snail_bed", { p_room_id: r.room_id, p_session_token: me.token, p_bed: 1 });
    expect(bed.error).toBeNull();
    const held = Object.values((bed.data as { mine: { critters: Held } }).mine.critters);
    const count = held.reduce((s, c) => s + c.n, 0), xu = held.reduce((s, c) => s + c.xu, 0);
    expect(count).toBeGreaterThanOrEqual(1);
    expect(count).toBeLessThanOrEqual(3);
    const sale = await db.rpc("sell_critters", { p_session_token: me.token, p_kind: null });
    expect(sale.error).toBeNull();
    expect(sale.data).toMatchObject({ sold: { n: count, xu } });
    expect((sale.data as { mine: { critters: Held } }).mine.critters).toEqual({});
  });

  it("answers the tampered calls with strike-0 envelopes in log mode", async () => {
    const me = await reg();
    const r = await room(me.token);
    const call = (fn: string, args: Record<string, unknown>) => db.rpc(fn, { p_room_id: r.room_id, p_session_token: me.token, ...args });
    const fin = await call("crab_finish", { p_visit_id: "00000000-0000-4000-8000-000000000000", p_hits: 5 });
    expect(fin.error).toBeNull();
    expect(fin.data).toMatchObject({ anticheat: { code: "bad_qty", strike: 0, error: "invalid quantity", locked_until: null, banned: false } });
    expect((await call("crab_start", { p_hole: 7 })).data).toMatchObject({ anticheat: { code: "bad_spot", strike: 0, error: "invalid spot" } });
    expect((await call("pick_snail_bed", { p_bed: 0 })).data).toMatchObject({ anticheat: { code: "bad_spot", strike: 0, error: "invalid spot" } });
    // the account is not locked: an honest call still gets its normal refusal
    expect((await db.rpc("sell_critters", { p_session_token: me.token, p_kind: null })).error?.message).toBe("no critters");
  });
});
```

**tests/integration/v15.test.ts.** Replace:

```ts
    expect((varieties ?? []).map((v) => v.id).sort()).toEqual(["nep", "short", "thom"]);
    // v15.2 adds the three hoa-màu seeds (kind seed): 11 + 3
    const { data: items } = await db.from("shop_items").select("id").in("kind", ["seed", "fertilizer", "pesticide", "critter_box"]);
    expect(items ?? []).toHaveLength(14);
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers", "fish_price_index"]) {
```

with:

```ts
    expect((varieties ?? []).map((v) => v.id).sort()).toEqual(["nep", "short", "thom"]);
    // v15.2 adds the three hoa-màu seeds (kind seed) and v15.3 the two containers: 11 + 3 + 2
    const { data: items } = await db.from("shop_items").select("id").in("kind", ["seed", "fertilizer", "pesticide", "critter_box"]);
    expect(items ?? []).toHaveLength(16);
    for (const table of ["field_plots", "crops", "rice_stock", "land_offers", "fish_price_index"]) {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/integration/v15-3.test.ts tests/integration/v15.test.ts tests/unit/admin-anticheat.test.tsx tests/unit/anticheat.test.ts`
Expected: FAIL — 3 tests fail (the lock text lacks "bắt cua mò ốc", the holdings line lacks "7 con cua ốc", no "Số hang cua/bãi ốc sai" label); 19 pass; the two integration files are skipped (11 tests) without `SUPABASE_TEST_URL`.

- [ ] **Step 3: Implement the lock text, the labels and the holdings line**

**lib/anticheat.ts.** Replace:

```ts
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
```

with:

```ts
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
```

**lib/admin.ts.** Replace:

```ts
  tank?: { item: string | null; charges: number } | null;
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
```

with:

```ts
  tank?: { item: string | null; charges: number } | null;
  /** v15.3 (`0018`): the critters held, per kind (count and what cô Út pays); older answers lack them. */
  critters?: Array<{ kind: string; n: number; xu: number }>;
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
```

**components/admin/AnticheatTab.tsx — edit 1 of 4.** Replace:

```tsx
  bad_slot: "Số ô phơi sai",
  bad_water: "Mức bơm/tháo nước sai",
```

with:

```tsx
  bad_slot: "Số ô phơi sai",
  bad_spot: "Số hang cua/bãi ốc sai",
  bad_water: "Mức bơm/tháo nước sai",
```

**components/admin/AnticheatTab.tsx — edit 2 of 4.** Replace:

```tsx
  cast_daily_cap: "Chạm 300 lần câu/ngày",
  bad_game: "Sai bàn bài",
```

with:

```tsx
  cast_daily_cap: "Chạm 300 lần câu/ngày",
  gather_daily_cap: "Chạm 200 lượt bắt cua, mò ốc/ngày",
  bad_game: "Sai bàn bài",
```

**components/admin/AnticheatTab.tsx — edit 3 of 4.** Replace:

```tsx
  const produce = (h.produce ?? []).reduce((a, p) => a + p.kg, 0);
  const seats = h.cards ?? [];
```

with:

```tsx
  const produce = (h.produce ?? []).reduce((a, p) => a + p.kg, 0);
  const critters = (h.critters ?? []).reduce((a, c) => a + c.n, 0);
  const seats = h.cards ?? [];
```

**components/admin/AnticheatTab.tsx — edit 4 of 4.** Replace:

```tsx
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(produce)} kg hoa màu`, `${count(h.plots.length)} thửa sở hữu`, `${count(h.leases.length)} thửa đang thuê`,
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
```

with:

```tsx
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(produce)} kg hoa màu`, `${count(critters)} con cua ốc`, `${count(h.plots.length)} thửa sở hữu`,
    `${count(h.leases.length)} thửa đang thuê`,
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (2 files, 22 tests; 2 skipped files (11 tests) without `SUPABASE_TEST_URL`).

- [ ] **Step 5: The README section and the spec amendments**

**README.md — edit 1 of 3.** Replace:

```markdown

The server decides every time and phase, the water levels, the pests (rolled at sowing and hidden until they fire), the yield, all prices, and land ownership, leases and reclaims. A client still sends a transplant and harvest quality, but v15.1 ignores it and uses 1.0 (anti-cheat decision D1) until the v15.3 transplant minigame (v15.2's harvest minigame only gates the rice parts); transplanting and harvesting stay behind the 2 s work gate. As in v14, where a player stands is not verified, and the plots' look and the farm animations come from each client's own copy of the field state. Like the rest of the members table, the new `members.last_seen_at` is readable with the anon key, so anyone who has the key can see when each member last visited a room, to the hour (it is written at most once an hour, for the 14-day reclaim).
```

with:

```markdown

The server decides every time and phase, the water levels, the pests (rolled at sowing and hidden until they fire), the yield, all prices, and land ownership, leases and reclaims. A client still sends a transplant and harvest quality, but the server ignores it and uses 1.0 for good (anti-cheat decision D1): v15.2's harvest minigame and v15.3's transplant minigame only gate progress, and the hoa-màu pickings stay behind the 2 s work gate. As in v14, where a player stands is not verified, and the plots' look and the farm animations come from each client's own copy of the field state. Like the rest of the members table, the new `members.last_seen_at` is readable with the anon key, so anyone who has the key can see when each member last visited a room, to the hour (it is written at most once an hour, for the 14-day reclaim).
```

**README.md — edit 2 of 3.** Replace:

```markdown
- **v14:** as above, plus the daily cap: a script that reels at the gate lands at most 300 fish a day instead of 960, and a reel reported faster than the gate is a strike.
- **v15:** v15.1 ignores the transplant and harvest quality and uses 1.0 until v15.3 (v15.2's harvest minigame gates the rice parts and sets no quality); a quality outside [0.9, 1.1] is a strike.
```

with:

```markdown
- **v14:** as above, plus the daily cap: a script that reels at the gate lands at most 300 fish a day instead of 960, and a reel reported faster than the gate is a strike.
- **v15:** the transplant and harvest quality are ignored for good (1.0, D1): v15.2's harvest minigame and v15.3's transplant minigame gate progress and set no quality; a quality outside [0.9, 1.1] is still a strike.
```

**README.md — edit 3 of 3.** Append at the end of the file, after a blank line:

```markdown
## v15.3: Đồng vui — hang cua, bãi ốc, cấy lúa bằng minigame

### DB migration

`supabase/migrations/0018_v15_3_gather.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`, seeds with `on conflict … do update`): run it in the Supabase SQL Editor after `0017`, so the production order is `0012` → `0014` → `0013` → `0015` → `0016` → `0017` → `0018`. It requires `0015`, `0016` and `0017`, because it re-creates functions they last defined and keeps their parts; it does not need `0014`. It adds `critter_kinds` (cua đồng, cua gạch, ốc đồng and ốc bươu vàng with their base prices, public read); two containers at anh Hai's (`box_bucket`, Xô nhựa, 15 places for 1 500 xu, and `box_basket`, Giỏ tre, 30 places for 6 000 xu); the private tables `critters` (one row per critter held, priced at the catch) and `gather_cooldowns` (each spot's 20-minute cooldown per account, across rooms, and an open crab visit); the day's visits on `farm_profiles`; the `coin_ledger` reason `critter_sell` (the list keeps every earlier reason, `wipe` and `0017`'s card reasons included); and 4 guarded RPCs: `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters`. It re-creates the work gate and `begin_work` (a transplant is now a round: `transplant` is accepted 8 to 120 s after its `begin_work`, which needs 25 s left on a lease, as a rice round does), `pick_snails` (the picker also gets 1–3 ốc bươu vàng), `buy_farm_item` (the containers, once each), the field state (today's critter prices, and each player's critters, capacity and visits left), and `_ac_holdings` and `_ac_wipe` (the critters and the cooldowns). `tests/sql/v15-gather-smoke.sql` checks it on a throwaway PostgreSQL cluster after the v15, anti-cheat, v15.2 and v16 smokes (from the repo root: it re-runs `0018`, reads `tests/fixtures/gather-cases.json`, and ends with `tests/sql/anticheat-guards.sql`, whose loop now calls 52 guarded RPCs). Run every file with plain `psql -f`, never under `psql -1`.

> **Deploy order:** the v15.3 client first, then `0018` as soon as possible after — the reverse of v15.2. The v15.3 client works against `0017`: its transplant round waits 9 s, which passes the old 2 s gate, and the crab holes and snail beds say "Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018." If `0018` runs first, cached v15.2 tabs get "Từ từ thôi…" when they transplant, until they reload.
>
> **Re-running earlier migrations:** `0013`, `0015`, `0016` and `0017` put back their own versions of the functions `0018` re-creates, and their `coin_ledger` reason checks lack `critter_sell`, so none of them can be re-run as it is once a critter has been sold. Add `critter_sell` to those lists first, then run them in order with `0018` last (anti-cheat §11.3 rule 7).

### What's new in v15.3

- **Hang cua:** 6 crab holes along the canal. E at a ready hole opens **Bắt cua**: the crab's claws open and close faster with each of 3 tries; grab (Space, the mouse button or a finger) while they are closed. Each hit is a cua đồng, or a cua gạch one time in ten. "Dừng (Esc)" before the first try sends nothing; after a try it keeps what was caught.
- **Bãi ốc:** 4 snail beds. E starts a 3-second bar that gives 1–3 snails (ốc đồng or ốc bươu vàng); walking away cancels it.
- Each hole and bed rests 20 minutes per player, in every room together, and a player has 200 visits a Vietnam day. A spot that is ready for you shows a small cue on the field.
- **Đồ đựng:** hands hold 3 critters; anh Hai sells a Xô nhựa (+15, 1 500 xu) and a Giỏ tre (+30, 6 000 xu), each bought once. A catch beyond the free space escapes, and the toast says so.
- **Cô Út** buys cua & ốc at the price fixed at the catch: the base price × the room's fish multiplier M at that moment. Pest snails picked off a rice plot now go into your container too (1–3 ốc bươu vàng), and a full container never stops the pick.
- **Cấy lúa and Trồng cây ớt con** are a TransplantGame round: a hand sweeps along the row, and you press inside the band for each of 12 hills; 6 points pass (chuẩn 1, được 0,5). A failed round costs nothing and can be retried at once. The round gates progress only: no score changes the yield.
- The bag's **🦀 Cua & ốc**, the HUD's count, the handbook's **Cua & ốc** tab and the admin's evidence cover all of it.

### Trust model (v15.3)

The server still decides every cooldown, limit, roll, price and capacity. A client now declares two more things: a transplant round's success, accepted only 8 to 120 s after its `begin_work` and with no effect on the yield, and a crab visit's hits, 0–3, accepted no sooner than 3 s after `crab_start`. A script that claims 3 hits at every visit earns no more than a perfect player: on average 975·M xu an hour and 9 180·M a day, and at worst 2 718·M an hour. A hole outside 1–6, a bed outside 1–4 or hits outside 0–3 are hard signals (`bad_spot`, `bad_qty`); the 200th visit of a day is logged as the soft `gather_daily_cap`. The transplant quality stays ignored for good (anti-cheat D1).

### Realtime budget (v15.3)

No new channel and no new `fa` code. A crab game re-sends `fa 6` and a transplant round `fa 1` every 2 s, and a snail bed sends `fa 7` twice; a round of 6 holes and 4 beds sends about 40 `fa` over about 2 minutes. Gathering sends no `fp`.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 1 of 11.** Replace:

```markdown
- **e) Water scoring.** The water penalty is sampled every 15 minutes of crop time.
- **f) Minigame trust.** The 2-second work gate exists from `0013` on. v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1); the harvest minigame (v15.2) only gates the rice parts, and how a transplant quality comes back is v15.3's question, which needs an SQL change.
- **g) Drying keeps the weight.** Drying changes the price, not the kilograms.
```

with:

```markdown
- **e) Water scoring.** The water penalty is sampled every 15 minutes of crop time.
- **f) Minigame trust.** The 2-second work gate exists from `0013` on. v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1), and it stays so: the harvest minigame (v15.2) and the transplant minigame (v15.3) only gate progress, and no quality comes back (v15.3 R20).
- **g) Drying keeps the weight.** Drying changes the price, not the kilograms.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 2 of 11.** Replace:

```markdown

**v15.3 "Đồng vui"** (`0018_v15_3_gather.sql`)
- Crab holes and snail beds, the critter containers (`box_bucket`, `box_basket`), and selling crabs and snails.
- Pest snails picked from plots now land in your container.
- The transplant minigame (transplanting stays behind the 2 s gate until then) and the crab minigame.
- How a transplant quality comes back (D1), with its soft signal.
```

with:

```markdown

**v15.3 "Đồng vui"** (`0018_v15_3_gather.sql`): see `2026-09-26-music-together-v15.3-design.md`.
- Crab holes and snail beds, the critter containers (`box_bucket`, `box_basket`), and selling crabs and snails.
- Pest snails picked from plots now land in your container.
- The transplant minigame (it gates progress only, behind an 8 s gate) and the crab minigame.
- No transplant quality comes back: D1 is permanent (v15.3 R20).
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 3 of 11.** Replace:

```markdown
- **Where you stand to act:** every plot has a use spot on an adjacent dike, facing the plot. Each NPC, the drying yard and each portal has one use spot.
- **v15.3 gathering spots:** 6 crab holes along the canal banks, at least 40 px apart and each with a use spot on the bank, and 4 snail beds at the canal's shallow edges.
- **Walkability:** dikes, bridges, roads and yards are walkable. Plot interiors are **walkable**, so you can step into your paddy, and the collision grid does not block them. Water in the canal is blocked.
```

with:

```markdown
- **Where you stand to act:** every plot has a use spot on an adjacent dike, facing the plot. Each NPC, the drying yard and each portal has one use spot.
- **v15.3 gathering spots:** 6 crab holes along the canal banks, at least 40 px apart and each with a use spot on the bank, and 4 snail beds at the canal's shallow edges. Their places are in the v15.3 spec, §6.
- **Walkability:** dikes, bridges, roads and yards are walkable. Plot interiors are **walkable**, so you can step into your paddy, and the collision grid does not block them. Water in the canal is blocked.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 4 of 11.** Replace:

```markdown
| `Mlate` | 1 − min(0.6, 0.02 · hours after the ripe window) |
| `qT` | transplant quality; always 1.0 until v15.3 (the server ignores the reported value, D1). The harvest quality `qH` is gone: the harvest minigame (v15.2) gates the 6 parts and multiplies nothing |
```

with:

```markdown
| `Mlate` | 1 − min(0.6, 0.02 · hours after the ripe window) |
| `qT` | transplant quality; always 1.0 (the server ignores the reported value, D1, for good since v15.3 R20). The harvest quality `qH` is gone: the harvest minigame (v15.2) gates the 6 parts and multiplies nothing |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 5 of 11.** Replace:

```markdown
| `spray_fungus` | pesticide | Thuốc trừ bệnh | 900 |
| `box_bucket` (v15.3) | critter_box | Xô nhựa | 150, capacity 15 |
| `box_basket` (v15.3) | critter_box | Giỏ tre | 600, capacity 30 |
```

with:

```markdown
| `spray_fungus` | pesticide | Thuốc trừ bệnh | 900 |
| `box_bucket` (v15.3) | critter_box | Xô nhựa | 1 500, capacity 15 |
| `box_basket` (v15.3) | critter_box | Giỏ tre | 6 000, capacity 30 |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 6 of 11.** Replace:

```markdown

**Crabs and snails (v15.3):**

| Item | Price |
|---|---|
```

with:

```markdown

**Crabs and snails (v15.3):** see `2026-09-26-music-together-v15.3-design.md` §10. A critter's price is its base × the room's multiplier M at the catch (floored, at least 1), stored with it:

| Item | Base price |
|---|---|
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 7 of 11.** Replace:

```markdown

- A full round of 6 crab holes every 20 min earns ≈ 800 xu/h, below fishing and without gear.
- Snails are a side activity, ≈ 240 xu/h.
```

with:

```markdown

- The 6 crab holes and the 4 snail beds (20 min each, 1–3 snails a bed) earn at most 975·M xu an hour on average, below fishing's 1 000·M floor, and 9 180·M a day under the 200-visit limit.
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 8 of 11.** Replace:

```markdown
| `members` (altered) | `add column if not exists last_seen_at timestamptz` |
| `coin_ledger` (altered) | the `reason` check is replaced to add `rent`, `land_buy`, `land_sell`, `land_refund`, `lease_pay`, `lease_income`, `farm_buy`, `rice_sell` (v15.2 adds `harvester` and `produce_sell`; v15.3 adds `critter_sell`) |
```

with:

```markdown
| `members` (altered) | `add column if not exists last_seen_at timestamptz` |
| `coin_ledger` (altered) | the `reason` check is replaced to add `rent`, `land_buy`, `land_sell`, `land_refund`, `lease_pay`, `lease_income`, `farm_buy`, `rice_sell` (v15.2 adds `harvester` and `produce_sell`; `0018` (v15.3) adds `critter_sell`) |
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 9 of 11.** Replace:

```markdown
3. They use `q` = 1.0 whatever the client sends (v15.1, D1) and clear `work`.
4. From v15.2 (its spec §6.2) the 2 s gate covers transplanting and the hoa-màu pickings (`harvest`). Rice is cut in parts with `harvest_part`, each accepted 8–120 s after its own `begin_work`.
```

with:

```markdown
3. They use `q` = 1.0 whatever the client sends (v15.1, D1) and clear `work`.
4. From v15.2 (its spec §6.2) the 2 s gate covers the hoa-màu pickings (`harvest`), and transplanting until v15.3. Rice is cut in parts with `harvest_part`, each accepted 8–120 s after its own `begin_work`.
5. From v15.3 (its spec §8.3) transplanting is a TransplantGame round: `transplant` is accepted 8–120 s after its own `begin_work`, and `q` stays 1.0 for good (D1, v15.3 R20).
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 10 of 11.** Replace:

```markdown

**Clients only report a few things:** the transplant and harvest quality, which v15.1 ignores (always 1.0, D1) behind a 2 s gate; from v15.2 a harvest round's success, which gates one rice part behind an 8 s gate and has no effect on the yield; and (v15.3) crab hits, bounded to 3 per hole visit.
```

with:

```markdown

**Clients only report a few things:** the transplant and harvest quality, which the server ignores for good (always 1.0, D1, v15.3 R20); from v15.2 a harvest round's success, which gates one rice part behind an 8 s gate and has no effect on the yield; and from v15.3 a transplant round's success (an 8 s gate, no effect on the yield) and crab hits (0–3 a visit, behind a 3 s gate). A script that claims 3 hits at every visit earns no more than a perfect player: on average 975·M xu an hour and 9 180·M a day, and at worst 2 718·M an hour (v15.3 §10, §11.6).
```

**docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md — edit 11 of 11.** Replace:

```markdown

### 15.1 Minigames
```

with:

```markdown

> **Superseded by `2026-09-26-music-together-v15.3-design.md`**, which designs this phase: the cooldowns hold across all rooms (its R1), a snail bed rests 20 minutes and gives 1–3 snails (R2), a player has 200 visits a Vietnam day (R3), and no quality comes back from the minigames (R20). The text below is the first sketch.

### 15.1 Minigames
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 1 of 15.** Replace:

```markdown
**Builds on:** `feat/v15-field` with v15.1 (`0013`, including the economy rebalance), `0014_lyrics_lockdown.sql` and the anti-cheat layer (`0015_anticheat.sql`). The stack is unchanged.
**Order:** `0013` → `0014` → `0015` → **`0016_v15_2_crops.sql` (this doc)** → v15.3 `0017_v15_3_gather.sql` → v16.
**Amends:** the v15 spec, the anti-cheat spec and the economy spec. §3 lists the lines.
```

with:

```markdown
**Builds on:** `feat/v15-field` with v15.1 (`0013`, including the economy rebalance), `0014_lyrics_lockdown.sql` and the anti-cheat layer (`0015_anticheat.sql`). The stack is unchanged.
**Order:** `0013` → `0014` → `0015` → **`0016_v15_2_crops.sql` (this doc)** → v16 `0017_v16_cards.sql` → v15.3 `0018_v15_3_gather.sql` (`2026-09-26-music-together-v15.3-design.md`, whose §3 amends this doc).
**Amends:** the v15 spec, the anti-cheat spec and the economy spec. §3 lists the lines.
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 2 of 15.** Replace:

```markdown
| S5 | **Sprayer.** A durable tool at anh Hai's, about 5 000 xu, one per account. "Nạp thuốc" turns 1 bottle into 3 charges of that pesticide, and reloading replaces the contents (the client confirms first). A spray uses a charge when the tank holds the matching pesticide, otherwise a bottle. |
| S6 | **Rice harvest.** Rice is harvested only by sickle (in parts) or by the harvester. Transplanting (rice and ớt) and the quick hoa-màu harvests keep the 3 s action behind the 2 s gate. |
| S7 | **Where hoa màu grows.** On the same plots. Làm đất offers "làm ruộng lúa" (flooded) or "lên luống" (raised beds), and the choice sets the plot's crop kind for that season. |
```

with:

```markdown
| S5 | **Sprayer.** A durable tool at anh Hai's, about 5 000 xu, one per account. "Nạp thuốc" turns 1 bottle into 3 charges of that pesticide, and reloading replaces the contents (the client confirms first). A spray uses a charge when the tank holds the matching pesticide, otherwise a bottle. |
| S6 | **Rice harvest.** Rice is harvested only by sickle (in parts) or by the harvester. The quick hoa-màu harvests keep the 3 s action behind the 2 s gate; so did transplanting (rice and ớt) until v15.3 made it a TransplantGame round (v15.3 R19). |
| S7 | **Where hoa màu grows.** On the same plots. Làm đất offers "làm ruộng lúa" (flooded) or "lên luống" (raised beds), and the choice sets the plot's crop kind for that season. |
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 3 of 15.** Replace:

```markdown
| R10 | Harvester completion is sweep step J. It runs after the anti-cheat step 0 and before step 1, and computes the grain at `harvester_until`. It pays only if the crop's farmer was still the plot's farmer at the job's start. | It runs before a lease can expire, and it never pays a wiped or reclaimed farmer. |
| R11 | Work must fit in the lease. `begin_work` needs 25 s left for a rice round and 5 s for a transplant or a picking (`lease ending`); a harvester needs 30 s (`lease ends`). The plot panel disables "Gặt" and "Gặt tiếp" with that reason in the lease's last 25 s. | A crop never outlives its lease mid-job: 25 s covers a round (10–14 s) and its claim. If a lease still runs out mid-round, the sweep takes the crop and the part is refused. |
| R12 | Any number of harvesters may run at once. | A shared machine would add waiting for no gameplay gain. The fee is the sink. |
```

with:

```markdown
| R10 | Harvester completion is sweep step J. It runs after the anti-cheat step 0 and before step 1, and computes the grain at `harvester_until`. It pays only if the crop's farmer was still the plot's farmer at the job's start. | It runs before a lease can expire, and it never pays a wiped or reclaimed farmer. |
| R11 | Work must fit in the lease. `begin_work` needs 25 s left for a rice round (and, from v15.3, a transplant round) and 5 s for a picking (`lease ending`); a harvester needs 30 s (`lease ends`). The plot panel disables "Gặt" and "Gặt tiếp" (from v15.3 also "Cấy lúa" and "Trồng cây ớt con") with that reason in the lease's last 25 s. | A crop never outlives its lease mid-job: 25 s covers a round (10–14 s; a transplant round 4–21 s, v15.3 §8.2) and its claim. If a lease still runs out mid-round, the sweep takes the crop and the part is refused. |
| R12 | Any number of harvesters may run at once. | A shared machine would add waiting for no gameplay gain. The fee is the sink. |
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 4 of 15.** Replace:

```markdown

**Moved to v15.3 "Đồng vui"** (`0017_v15_3_gather.sql`):
- crab holes and snail beds;
```

with:

```markdown

**Moved to v15.3 "Đồng vui"** (`0018_v15_3_gather.sql`; `0017` became the v16 card corner):
- crab holes and snail beds;
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 5 of 15.** Replace:

```markdown
- pest snails going into the container;
- the **transplant minigame** (transplanting stays behind the 2 s gate) and the **crab minigame**;
- the question of how a transplant quality returns (D1), with its soft signal.
```

with:

```markdown
- pest snails going into the container;
- the **transplant minigame** (transplanting stays behind the 2 s gate until v15.3 gates it at 8–120 s) and the **crab minigame**;
- the question of how a transplant quality returns (D1), with its soft signal. v15.3 closes it (its R20): no quality returns, and the signal is dropped.
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 6 of 15.** Replace:

```markdown
| §2 | Row 7 → "plus the harvest minigame (v15.2) and two more (v15.3)". Clarification f → the transplant quality is v15.3's question. |
| §3 | "v15.2 is `0016_v15_gather.sql`" → v15.2 is `0016_v15_2_crops.sql` and v15.3 is `0017_v15_3_gather.sql`. |
| §4 | Replace the v15.2 block with a pointer to this spec, and add a v15.3 block with the moved list above. |
| §5 | "v15.2: TransplantGame, HarvestGame, CrabGame" → v15.2: HarvestGame; v15.3: TransplantGame, CrabGame. Migrations: `0016_v15_2_crops.sql`, `0017_v15_3_gather.sql`. |
| §6.2 | "v15.2 gathering spots" → v15.3. |
```

with:

```markdown
| §2 | Row 7 → "plus the harvest minigame (v15.2) and two more (v15.3)". Clarification f → the transplant quality is v15.3's question. |
| §3 | "v15.2 is `0016_v15_gather.sql`" → v15.2 is `0016_v15_2_crops.sql` and v15.3 is `0018_v15_3_gather.sql`. |
| §4 | Replace the v15.2 block with a pointer to this spec, and add a v15.3 block with the moved list above. |
| §5 | "v15.2: TransplantGame, HarvestGame, CrabGame" → v15.2: HarvestGame; v15.3: TransplantGame, CrabGame. Migrations: `0016_v15_2_crops.sql`, `0018_v15_3_gather.sql`. |
| §6.2 | "v15.2 gathering spots" → v15.3. |
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 7 of 15.** Replace:

```markdown
| §13.3 | Shop: tools and hoa-màu seeds (v15.2), containers (v15.3). Depot: hoa màu (v15.2), crabs and snails (v15.3). Co-op: the "Máy gặt" tab. |
| §15 | Retitle to "v15.3 — gathering and minigames (`0017_v15_3_gather.sql`)". HarvestGame moves to v15.2 §6.2. "All three are pure state machines" → both. |
| §17 | Minigame tests: HarvestGame is v15.2, the others v15.3. "v15.2 adds v15-gather-smoke.sql" → v15.2 adds `v15-2-smoke.sql`, v15.3 adds `v15-gather-smoke.sql`. |
```

with:

```markdown
| §13.3 | Shop: tools and hoa-màu seeds (v15.2), containers (v15.3). Depot: hoa màu (v15.2), crabs and snails (v15.3). Co-op: the "Máy gặt" tab. |
| §15 | Retitle to "v15.3 — gathering and minigames (`0018_v15_3_gather.sql`)". HarvestGame moves to v15.2 §6.2. "All three are pure state machines" → both. |
| §17 | Minigame tests: HarvestGame is v15.2, the others v15.3. "v15.2 adds v15-gather-smoke.sql" → v15.2 adds `v15-2-smoke.sql`, v15.3 adds `v15-gather-smoke.sql`. |
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 8 of 15.** Replace:

```markdown
**Anti-cheat spec:**
- **Migration names.** The header order, D7 and §11.5 name `0016_v15_2_crops.sql`, then `0017_v15_3_gather.sql`.
- **Moved to v15.3.** In §6.4 and the §7.2 `quality_range` row, "v15.2 brings a real quality back" becomes v15.3. The "quality always 1.1" soft signal in §7.4 and §16 moves to `0017`.
- **§7.2 and §7.3.** `bad_plot` covers 24 plot RPCs, `bad_work` also covers `tend_crop`, and `bad_qty` also covers `sell_produce`. §7.3 gains the new honest refusals (§11.5).
- **§9.3 and §11.3.** Add the 7 v15.2 RPCs (42 in all); the gather RPCs belong to `0017`. Rule 4 adds `harvester` and `produce_sell` (v15.2), then `critter_sell` (v15.3).
- **§9.6, §12.5 and §1.5.** The wipe clears `produce_stock` and the tank, the holdings line gains `· {kg} kg hoa màu`, and §1.5 gains the harvest-part residual (§11.5).
```

with:

```markdown
**Anti-cheat spec:**
- **Migration names.** The header order, D7 and §11.5 name `0016_v15_2_crops.sql`, then `0017_v16_cards.sql` and `0018_v15_3_gather.sql`.
- **Moved to v15.3.** In §6.4 and the §7.2 `quality_range` row, "v15.2 brings a real quality back" becomes v15.3. The "quality always 1.1" soft signal in §7.4 and §16 moves to `0018`, and v15.3 drops it (its R20).
- **§7.2 and §7.3.** `bad_plot` covers 24 plot RPCs, `bad_work` also covers `tend_crop`, and `bad_qty` also covers `sell_produce`. §7.3 gains the new honest refusals (§11.5).
- **§9.3 and §11.3.** Add the 7 v15.2 RPCs (42 in all); the gather RPCs belong to `0018`. Rule 4 adds `harvester` and `produce_sell` (v15.2), then `critter_sell` (v15.3).
- **§9.6, §12.5 and §1.5.** The wipe clears `produce_stock` and the tank, the holdings line gains `· {kg} kg hoa màu`, and §1.5 gains the harvest-part residual (§11.5).
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 9 of 15.** Replace:

```markdown
- **When every remaining picking is lost** (t ≥ L_n), sweep step 6 deletes the crop, and the lease stays (R26).
- **When the lease runs out,** the crop is lost with every picking not yet taken, as rice is. The lease sweep (steps 1 and 4) runs in `_field_open`, before any action on the plot. `begin_work` for a picking or a transplant needs at least 5 s left on the lease (`lease ending`); a 3 s action that still loses the race is refused (`not your plot`).
```

with:

```markdown
- **When every remaining picking is lost** (t ≥ L_n), sweep step 6 deletes the crop, and the lease stays (R26).
- **When the lease runs out,** the crop is lost with every picking not yet taken, as rice is. The lease sweep (steps 1 and 4) runs in `_field_open`, before any action on the plot. `begin_work` for a picking needs at least 5 s left on the lease (`lease ending`), and for a transplant 25 s from v15.3 (its R19, as a rice round); a job that still loses the race is refused (`not your plot`).
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 10 of 15.** Replace:

```markdown
| Trồng / gieo / ươm | `plant_crop(item)` | Beds with nothing planted; the bed must be Ẩm. Uses one bag of a seed with `upland` set. Sets `upland` and P (cutting, direct) or `sow_at` (nursery), and rolls the pests. |
| Trồng cây con (ớt) | `begin_work('transplant')` + `transplant` | The nursery is ≥ `nursery_ready_h` old, the bed is Ẩm, and at least 5 s are left on the lease (`lease ending`). Sets P. The 2 s gate; quality ignored (D1). |
| Lật dây, vun gốc | `tend_crop(act)` | After P. The act must be one of this crop's `act` cares (`wrong crop`). Recorded in `work_log` whenever it is done; the panel warns outside the windows. |
```

with:

```markdown
| Trồng / gieo / ươm | `plant_crop(item)` | Beds with nothing planted; the bed must be Ẩm. Uses one bag of a seed with `upland` set. Sets `upland` and P (cutting, direct) or `sow_at` (nursery), and rolls the pests. |
| Trồng cây con (ớt) | `begin_work('transplant')` + `transplant` | The nursery is ≥ `nursery_ready_h` old, the bed is Ẩm, and at least 25 s are left on the lease (`lease ending`; 5 s before v15.3). Sets P. A TransplantGame round from v15.3, taken 8–120 s after `begin_work` (v15.3 §8.3; the 2 s gate before); quality ignored (D1). |
| Lật dây, vun gốc | `tend_crop(act)` | After P. The act must be one of this crop's `act` cares (`wrong crop`). Recorded in `work_log` whenever it is done; the panel warns outside the windows. |
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 11 of 15.** Replace:

```markdown
- `_farm_crop` now selects the crop `for update` and becomes `volatile` (§6.5), and it raises `harvester busy` while a harvester runs. `_work_check` handles the rice round (sickle, phase, water), the ớt transplant and hoa-màu pickings.
- `_farm_do_begin_work` replaces any earlier work record and applies the lease gates: 25 s left for a rice round, 5 s for a transplant or a picking (`lease ending`, R11).
- `_farm_do_soak` and `_farm_do_sow` raise `wrong crop` on beds. `_farm_do_fertilize`, `_farm_do_water` and `_farm_do_spray` use `_care_crop`, and spray also uses the tank.
```

with:

```markdown
- `_farm_crop` now selects the crop `for update` and becomes `volatile` (§6.5), and it raises `harvester busy` while a harvester runs. `_work_check` handles the rice round (sickle, phase, water), the ớt transplant and hoa-màu pickings.
- `_farm_do_begin_work` replaces any earlier work record and applies the lease gates: 25 s left for a rice round, 5 s for a transplant or a picking (`lease ending`, R11); from v15.3 a transplant needs 25 s too (v15.3 R19).
- `_farm_do_soak` and `_farm_do_sow` raise `wrong crop` on beds. `_farm_do_fertilize`, `_farm_do_water` and `_farm_do_spray` use `_care_crop`, and spray also uses the tank.
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 12 of 15.** Replace:

```markdown
**Changed behaviour, with the same signatures:**
- `begin_work` replaces any earlier record. On rice, `'harvest'` starts a round (§6.2). It raises `lease ending` with under 25 s (round) or 5 s (transplant, picking) left on the lease.
- `harvest(…, quality)` on rice raises `wrong crop`. `transplant` sets P on ớt. `spray` uses the tank. `buy_farm_item` sells tools (§9). `claim_farm_gift` adds the sickle.
```

with:

```markdown
**Changed behaviour, with the same signatures:**
- `begin_work` replaces any earlier record. On rice, `'harvest'` starts a round (§6.2). It raises `lease ending` with under 25 s (a round; a transplant from v15.3) or 5 s (a picking; a transplant before v15.3) left on the lease.
- `harvest(…, quality)` on rice raises `wrong crop`. `transplant` sets P on ớt. `spray` uses the tank. `buy_farm_item` sells tools (§9). `claim_farm_gift` adds the sickle.
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 13 of 15.** Replace:

```markdown
  | `plant_label`, one per owned hoa-màu seed | "Cần đất Ẩm (đang {Khô})." With no seed, a disabled "Trồng hoa màu": "Chưa có giống hoa màu — ghé tiệm anh Hai." |
  | `transplant_label` (ớt) | "Cây con chưa đủ tuổi — trồng được sau {d}." · "Cần đất Ẩm (đang {Đẫm})." |
  | each act care ("Lật dây", "Vun gốc") | done on time: disabled "Đã {lật dây} rồi." · on time: hint "Đúng lúc {lật dây}." · early: "Chưa tới lúc — {lật dây} lúc {24}–{32} giờ sau trồng." · half region: "Trễ rồi — chỉ được nửa công." · later: "Quá muộn — làm bây giờ là phí công." |
```

with:

```markdown
  | `plant_label`, one per owned hoa-màu seed | "Cần đất Ẩm (đang {Khô})." With no seed, a disabled "Trồng hoa màu": "Chưa có giống hoa màu — ghé tiệm anh Hai." |
  | `transplant_label` (ớt) | "Cây con chưa đủ tuổi — trồng được sau {d}." · "Cần đất Ẩm (đang {Đẫm})." From v15.3 it opens TransplantGame (v15.3 §13.3, §13.4). |
  | each act care ("Lật dây", "Vun gốc") | done on time: disabled "Đã {lật dây} rồi." · on time: hint "Đúng lúc {lật dây}." · early: "Chưa tới lúc — {lật dây} lúc {24}–{32} giờ sau trồng." · half region: "Trễ rồi — chỉ được nửa công." · later: "Quá muộn — làm bây giờ là phí công." |
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 14 of 15.** Replace:

```markdown
- **HUD:** `produceSummary` gives "🌾 {70} kg khô · {0} kg ướt", plus " · 🧺 {180} kg màu" when there is any.
- **Toasts:** "Đã lên luống — đất Ẩm, sẵn sàng trồng." · "Đã {trồng dây khoai}." · "Đã {lật dây}." · "🧺 Thu hoạch {24} kg {ớt} (lứa {1}/{3}) — đem bán cho cô Út nhé!" The 3 s bar reads "🧺 Đang {hái ớt} thửa {6}…" or "🌱 Đang trồng cây ớt con thửa {6}…".
- **Before `0016`:** the field shows no hoa-màu seeds, and the new RPCs toast `NOT_OPEN_152`: "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016."
```

with:

```markdown
- **HUD:** `produceSummary` gives "🌾 {70} kg khô · {0} kg ướt", plus " · 🧺 {180} kg màu" when there is any.
- **Toasts:** "Đã lên luống — đất Ẩm, sẵn sàng trồng." · "Đã {trồng dây khoai}." · "Đã {lật dây}." · "🧺 Thu hoạch {24} kg {ớt} (lứa {1}/{3}) — đem bán cho cô Út nhé!" The 3 s bar reads "🧺 Đang {hái ớt} thửa {6}…" (before v15.3 also "🌱 Đang trồng cây ớt con thửa {6}…"; v15.3 makes "Trồng cây ớt con" a TransplantGame round, and that bar goes).
- **Before `0016`:** the field shows no hoa-màu seeds, and the new RPCs toast `NOT_OPEN_152`: "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016."
```

**docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md — edit 15 of 15.** Replace:

```markdown
  - the lease end (R26): with picking 1 taken, `_field_open` after the end removes the crop and the lease, pickings 2 and 3 with them, and `produce_stock` keeps picking 1;
  - `begin_work` for a picking or a transplant with 4 s left → `lease ending`, with 5 s allowed; a picking claimed after the end → `not your plot`, nothing added.
- **Parts:**
```

with:

```markdown
  - the lease end (R26): with picking 1 taken, `_field_open` after the end removes the crop and the lease, pickings 2 and 3 with them, and `produce_stock` keeps picking 1;
  - `begin_work` for a picking with 4 s left → `lease ending`, with 5 s allowed (a transplant, from v15.3: 24 s → `lease ending`, 25 s allowed); a picking claimed after the end → `not your plot`, nothing added.
- **Parts:**
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 1 of 20.** Replace:

```markdown
|---|---|---|
| D1 | Farm quality in v15.1 | Ignored (always 1.0) until the v15.3 transplant minigame (v15.2's harvest minigame gates the rice parts and sets no quality). A separate v15.1 task does this inside `0013`; this spec relies on it (§6.4). |
| D2 | What the 5-minute lock blocks | Game actions only: fishing, farming, land, and the fishing and farm shops. The daily check-in and the farm gift count as fishing and farming. Chat, the music queue and all reads stay open (§9.3). |
```

with:

```markdown
|---|---|---|
| D1 | Farm quality in v15.1 | Ignored (always 1.0), for good: v15.2's harvest minigame and v15.3's transplant minigame gate progress and set no quality (v15.3 R20). A separate v15.1 task does this inside `0013`; this spec relies on it (§6.4). |
| D2 | What the 5-minute lock blocks | Game actions only: fishing, farming, land, and the fishing and farm shops. The daily check-in and the farm gift count as fishing and farming. Chat, the music queue and all reads stay open (§9.3). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 2 of 20.** Replace:

```markdown
- **In `0013`:** the v15.1 task makes `_farm_do_transplant` and `_farm_do_harvest` use 1.0 whatever `p_quality` is. The v15 smoke's "quality clamped" assertion becomes "quality ignored = 1".
- **In `0015`:** the public wrappers `transplant` and `harvest` gain the `quality_range` hard check (§7.2). It stays when v15.3 brings a real quality back.
```

with:

```markdown
- **In `0013`:** the v15.1 task makes `_farm_do_transplant` and `_farm_do_harvest` use 1.0 whatever `p_quality` is. The v15 smoke's "quality clamped" assertion becomes "quality ignored = 1".
- **In `0015`:** the public wrappers `transplant` and `harvest` gain the `quality_range` hard check (§7.2). It stays: no real quality comes back (v15.3 R20), and the client keeps sending exactly 1.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 3 of 20.** Replace:

```markdown
| `reel_too_fast` | `finish_cast` | `p_success = true`, the cast has not expired, and `now() < bite_at + 0.9·min_reel_ms`. This is the existing `too_early` branch. | none: the answer stays `{"result":"lost","why":"too_early"}` plus the envelope | See the timing argument below the table. |
| `quality_range` | `transplant`, `harvest` | `p_quality` is null, NaN or ±∞, or outside [0.9 − 1e-9, 1.1 + 1e-9]. NaN is larger than every number in PostgreSQL, so the range test catches it. | `invalid quality` | v15.1 sends exactly 1 (`useFarmController` `finishWork`). v15.3's `0.9 + 0.2·score/12` stays in range; the 1e-9 tolerance absorbs floating-point error. |
| `bad_plot` | the 24 plot RPCs (§10.3) | `p_plot` is null or outside 1–10 | `invalid plot` | Plot numbers come from `field_state` (`PlotView.no`) and from the map's plot interactables. `MAX_PLOT = 10`. |
| `bad_slot` | `dry_collect` | `p_slot` is null or outside 1–4 | `invalid slot` | `DryingPanel` loops over `1..DRYING_SLOTS` (4). |
| `bad_water` | `water` | `p_delta` is null or not ±1 | `invalid quantity` | `plotActions` sends `delta: 1` or `delta: -1` only (`lib/game/farm/actions.ts`). |
```

with:

```markdown
| `reel_too_fast` | `finish_cast` | `p_success = true`, the cast has not expired, and `now() < bite_at + 0.9·min_reel_ms`. This is the existing `too_early` branch. | none: the answer stays `{"result":"lost","why":"too_early"}` plus the envelope | See the timing argument below the table. |
| `quality_range` | `transplant`, `harvest` | `p_quality` is null, NaN or ±∞, or outside [0.9 − 1e-9, 1.1 + 1e-9]. NaN is larger than every number in PostgreSQL, so the range test catches it. | `invalid quality` | v15.1 sends exactly 1 (`useFarmController` `finishWork`), and so does v15.3's transplant round: D1 is permanent (v15.3 R20). The 1e-9 tolerance absorbs floating-point error. |
| `bad_plot` | the 24 plot RPCs (§10.3) | `p_plot` is null or outside 1–10 | `invalid plot` | Plot numbers come from `field_state` (`PlotView.no`) and from the map's plot interactables. `MAX_PLOT = 10`. |
| `bad_slot` | `dry_collect` | `p_slot` is null or outside 1–4 | `invalid slot` | `DryingPanel` loops over `1..DRYING_SLOTS` (4). |
| `bad_spot` | `crab_start`, `pick_snail_bed` (`0018`) | a hole null or outside 1–6; a bed null or outside 1–4 | `invalid spot` | The spot comes from the map's `crab_hole` and `snail_bed` interactables (`spot`), 1–6 and 1–4. |
| `bad_water` | `water` | `p_delta` is null or not ±1 | `invalid quantity` | `plotActions` sends `delta: 1` or `delta: -1` only (`lib/game/farm/actions.ts`). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 4 of 20.** Replace:

```markdown
| `bad_qty` | `sell_produce` (`0016`), after `_wallet_lock` | `p_kg` null or < 1 | `invalid quantity` | `RiceDepotPanel`'s produce rows send kg ∈ [1, stock], and "Bán hết" sends the stock (≥ 1). |
| `bad_price` | `list_plot`, `set_sublease` | a non-null price outside 1–5 000 000 / 1–100 000 (the economy spec's caps) | `invalid price` | `CoopPanel` sends only prices that pass `toPrice` → `priceRefusal` → `priceOk`. `LandButton` stays disabled unless the refusal is null, including "" and "0". |
```

with:

```markdown
| `bad_qty` | `sell_produce` (`0016`), after `_wallet_lock` | `p_kg` null or < 1 | `invalid quantity` | `RiceDepotPanel`'s produce rows send kg ∈ [1, stock], and "Bán hết" sends the stock (≥ 1). |
| `bad_qty` | `crab_finish` (`0018`) | `p_hits` null or outside 0–3 | `invalid quantity` | `CrabRound.hits` counts the hit tries (`CRAB_TRIES = 3`), and the controller sends it unchanged. |
| `bad_price` | `list_plot`, `set_sublease` | a non-null price outside 1–5 000 000 / 1–100 000 (the economy spec's caps) | `invalid price` | `CoopPanel` sends only prices that pass `toPrice` → `priceRefusal` → `priceOk`. `LandButton` stays disabled unless the refusal is null, including "" and "0". |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 5 of 20.** Replace:

```markdown
| `no sickle`, `no sprayer`, `already owned`, `wrong crop`, `invalid crop`, `not enough crop`, `invalid quantity` (a tool with a quantity other than 1) | farm, `load_sprayer`, `buy_farm_item`, `sell_produce` (`0016`) | stale state; two tabs; **the cached v15.1 client**, whose rice harvest gets `wrong crop`. It never sees the tools (it reads only its own `shop_items` kinds), so no shipped client sends a tool quantity other than 1; that refusal stays plain anyway (v15.2 R18). The hoa-màu seeds do reach it, and its soak of one gets `invalid item` (above). |
| `invalid video`, `video too long`, `duration unknown`, `banned keyword`, `order limit reached` | queue | the rules changed while the UI was stale; two tabs. The queue never strikes (R22). |
```

with:

```markdown
| `no sickle`, `no sprayer`, `already owned`, `wrong crop`, `invalid crop`, `not enough crop`, `invalid quantity` (a tool with a quantity other than 1) | farm, `load_sprayer`, `buy_farm_item`, `sell_produce` (`0016`) | stale state; two tabs; **the cached v15.1 client**, whose rice harvest gets `wrong crop`. It never sees the tools (it reads only its own `shop_items` kinds), so no shipped client sends a tool quantity other than 1; that refusal stays plain anyway (v15.2 R18). The hoa-màu seeds do reach it, and its soak of one gets `invalid item` (above). |
| `hole empty`, `bed empty`, `critters full`, `gather daily limit`, `visit not found`, `visit expired`, `too fast` (`crab_finish`, `transplant`), `work expired`, `lease ending`, `no critters`, `invalid kind`, `already owned`, `invalid quantity` (a container with a quantity other than 1) | gathering, `begin_work`, `transplant`, `sell_critters`, `buy_farm_item` (`0018`) | two tabs; a double finish; a lost answer; a backgrounded tab; a room switch; a stale state; **a cached v15.2 client after `0018`** |
| `invalid video`, `video too long`, `duration unknown`, `banned keyword`, `order limit reached` | queue | the rules changed while the UI was stale; two tabs. The queue never strikes (R22). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 6 of 20.** Replace:

```markdown
| `cast_daily_cap` | `start_cast` | the cast that brings the day's count to 300 | A long honest session can reach it. |
| `kind_mismatch` | `buy_item` | an existing priced item of a non-fishing kind | the old v14 client lists farm items as bait |
| `kind_mismatch` | `buy_farm_item` | an existing priced item that is not a seed, fertilizer, pesticide or (from `0016`) tool | catalogs change; v15.3 adds `critter_box` |
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |
```

with:

```markdown
| `cast_daily_cap` | `start_cast` | the cast that brings the day's count to 300 | A long honest session can reach it. |
| `gather_daily_cap` | `crab_start`, `pick_snail_bed` (`0018`) | the visit that brings the Vietnam day's count to 200 | A long honest session can reach it. |
| `kind_mismatch` | `buy_item` | an existing priced item of a non-fishing kind | the old v14 client lists farm items as bait |
| `kind_mismatch` | `buy_farm_item` | an existing priced item that is not a seed, fertilizer, pesticide, (from `0016`) tool or (from `0018`) critter box | catalogs change |
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 7 of 20.** Replace:

```markdown
- **Not logged:** every refusal in §7.3.
- **Later, v15.3 (`0018`):** a soft counter for "the quality is always 1.1".
```

with:

```markdown
- **Not logged:** every refusal in §7.3.
- **Dropped:** the soft counter for "the quality is always 1.1" once planned for v15.3, since no quality comes back (v15.3 R20).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 8 of 20.** Replace:

```markdown
| `bad_slot` | `slot` |
| `bad_water` | `plot`, `delta` |
| `bad_work` | `plot`, `work` |
| `bad_qty` | `item` or `variety`, `qty` or `kg`, `dry` |
| `bad_price` | `plot`, `price` |
```

with:

```markdown
| `bad_slot` | `slot` |
| `bad_spot` (`0018`) | `spot` |
| `bad_water` | `plot`, `delta` |
| `bad_work` | `plot`, `work` |
| `bad_qty` | `item` or `variety`, `qty` or `kg`, `dry`; `visit` and `hits` (`crab_finish`) |
| `bad_price` | `plot`, `price` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 9 of 20.** Replace:

```markdown
| `cast_daily_cap` | `day`, `casts` |
| `bad_game`, `bad_seat`, `bad_stake`, `bad_qty` (`0017`) | `game`, and `seat`, `stake` or `stake` and `buyin` (`card_sit`); `amount` (`pk_topup`) |
```

with:

```markdown
| `cast_daily_cap` | `day`, `casts` |
| `gather_daily_cap` (`0018`) | `day`, `visits` |
| `bad_game`, `bad_seat`, `bad_stake`, `bad_qty` (`0017`) | `game`, and `seat`, `stake` or `stake` and `buyin` (`card_sit`); `amount` (`pk_topup`) |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 10 of 20.** Replace:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 48 game RPCs (35 in `0015`, 7 more in `0016`, 6 more in `0017`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

with:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 52 game RPCs (35 in `0015`, 7 more in `0016`, 6 more in `0017`, 4 more in `0018`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 11 of 20.** Replace:

```markdown
  - plus `sell_rice`, `buy_farm_item` and `claim_farm_gift`.
- **v15.2 (7, `0016`):** `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`, 42 in all. The gather RPCs come with v15.3's `0018` (§11.3).
- **v16 (6, `0017`):** `card_sit`, `pk_topup`, `tl_play`, `tl_pass`, `cao_deal` and `pk_act`, 48 in all.
```

with:

```markdown
  - plus `sell_rice`, `buy_farm_item` and `claim_farm_gift`.
- **v15.2 (7, `0016`):** `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`, 42 in all.
- **v16 (6, `0017`):** `card_sit`, `pk_topup`, `tl_play`, `tl_pass`, `cao_deal` and `pk_act`, 48 in all.
- **v15.3 (4, `0018`):** `crab_start`, `crab_finish`, `pick_snail_bed` and `sell_critters`, 52 in all.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 12 of 20.** Replace:

```markdown
- the modes, how to review, and the deploy order;
- the updated trust models (v14: the daily cap; v15: quality ignored until v15.3).
```

with:

```markdown
- the modes, how to review, and the deploy order;
- the updated trust models (v14: the daily cap; v15: quality ignored for good, v15.3 R20).
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 13 of 20.** Replace:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `WARN_LOCK` | `Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.` (v16 adds "đánh bài") |
| `WARN_REPEAT` | `Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.` |
```

with:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `WARN_LOCK` | `Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.` (v15.3 adds "bắt cua mò ốc", v16 "đánh bài") |
| `WARN_REPEAT` | `Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 14 of 20.** Replace:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat`, then `· {n} ghế bàn bài ({formatXu(chips + escrow)})` when the account sits at card tables (`0017`) |
| events heading | `Ghi nhận ({n})` |
```

with:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} con cua ốc · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat`, then `· {n} ghế bàn bài ({formatXu(chips + escrow)})` when the account sits at card tables (`0017`); the cua ốc come with `0018` |
| events heading | `Ghi nhận ({n})` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 15 of 20.** Replace:

```markdown
| `bad_slot` | `Số ô phơi sai` |
| `bad_water` | `Mức bơm/tháo nước sai` |
```

with:

```markdown
| `bad_slot` | `Số ô phơi sai` |
| `bad_spot` (`0018`) | `Số hang cua/bãi ốc sai` |
| `bad_water` | `Mức bơm/tháo nước sai` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 16 of 20.** Replace:

```markdown
| `cast_daily_cap` | `Chạm 300 lần câu/ngày` |
| `bad_game` (`0017`) | `Sai bàn bài` |
```

with:

```markdown
| `cast_daily_cap` | `Chạm 300 lần câu/ngày` |
| `gather_daily_cap` (`0018`) | `Chạm 200 lượt bắt cua, mò ốc/ngày` |
| `bad_game` (`0017`) | `Sai bàn bài` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 17 of 20.** Replace:

```markdown
   - every hard signal gives `strike: 1`, committed: a `strike_1` row and `locked_until` ≈ now + 5 min;
   - each of the guarded RPCs (35 in `0015`, 42 from `0016`) then raises `account locked` for that account, with a numeric detail and the hint `anticheat` (the call list is the one in `anticheat-guards.sql`);
   - `fishing_state` has `lock`, and `field_state`, `fishing_board`, `touch_room`, chat and the queue still work;
```

with:

```markdown
   - every hard signal gives `strike: 1`, committed: a `strike_1` row and `locked_until` ≈ now + 5 min;
   - each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`, 52 from `0018`) then raises `account locked` for that account, with a numeric detail and the hint `anticheat` (the call list is the one in `anticheat-guards.sql`);
   - `fishing_state` has `lock`, and `field_state`, `fishing_board`, `touch_room`, chat and the queue still work;
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 18 of 20.** Replace:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads (from `0017` also `card_lobby`, `card_state`, `card_hand` and `card_tick`); each must succeed.
```

with:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`, 52 from `0018`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads (from `0017` also `card_lobby`, `card_state`, `card_hand` and `card_tick`); each must succeed.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 19 of 20.** Replace:

```markdown
| `bad_slot` | `DryingPanel` slots are 1–4. |
| `foreign_offer` | "Rút" uses `myOffers` ids; "Đồng ý" and "Từ chối" use `incomingOffers` ids. |
```

with:

```markdown
| `bad_slot` | `DryingPanel` slots are 1–4. |
| `bad_spot` | the map's crab holes are 1–6 and its snail beds 1–4, and `crab_start` / `pick_snail_bed` send their `spot` (v15.3). |
| `bad_qty` (crabs) | `crab_finish` sends `CrabRound.hits` ∈ 0..3 (v15.3). |
| `foreign_offer` | "Rút" uses `myOffers` ids; "Đồng ý" and "Từ chối" use `incomingOffers` ids. |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 20 of 20.** Replace:

```markdown
- **Cosmetic Realtime spoofing:** lobby spoofing, reaction and presence names, and the `[reply:…]` prefix (§14).
- **The v15.3 soft signal** "quality always 1.1", which comes with `0018`.
- **A soft counter for rice parts claimed under 9 s** after their `begin_work` (v15.2 §11.5).
```

with:

```markdown
- **Cosmetic Realtime spoofing:** lobby spoofing, reaction and presence names, and the `[reply:…]` prefix (§14).
- **The soft signal "quality always 1.1"**, dropped for good: no quality comes back (v15.3 R20).
- **A soft counter for crab finishes claimed right at the 3 s gate** (v15.3 R22).
- **A soft counter for rice parts claimed under 9 s** after their `begin_work` (v15.2 §11.5).
```

**docs/superpowers/specs/2026-09-25-music-together-economy-design.md.** Replace:

```markdown
- **Anti-cheat `0015`** re-creates `finish_cast` (H2). Its plan is refreshed after v15.1 so that it keeps the index pricing.
- **v15 spec §10** points here for the farm numbers. Task 20 also changes the v15 spec §7 land numbers, the §8.1 table and the §9 prices. Its v14 reference, "a skilled angler earns about 1 000–1 800 xu per active hour", holds at M = 1.
```

with:

```markdown
- **Anti-cheat `0015`** re-creates `finish_cast` (H2). Its plan is refreshed after v15.1 so that it keeps the index pricing.
- **v15.3** (`2026-09-26-music-together-v15.3-design.md` §7.1, §10): crabs and snails follow M too. Each is priced at the catch at `max(1, floor(base × M))`, with M from `_fish_index` (whose wealth leaves banned accounts out, anti-cheat R30) and no season factor, and stored per critter like a fish. That spec's §10 has the arithmetic: critters stay under fishing at every M.
- **v15 spec §10** points here for the farm numbers. Task 20 also changes the v15 spec §7 land numbers, the §8.1 table and the §9 prices. Its v14 reference, "a skilled angler earns about 1 000–1 800 xu per active hour", holds at M = 1.
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 1 of 11.** Replace:

```markdown
| R18 | **TransplantGame numbers** (§8.2): 12 beats, a 1.4 s sweep, bands ±0.08 / ±0.18 around c ∈ [0.35, 0.65], a 1 s lead-in, a 0.25 s beat, and a pass at ≥ 6. | The old design made concrete: about 12 s. |
| R19 | **Transplant contract.** `begin_work('transplant')` needs 10 s left on the lease (v15.2 R11: 5 s). Then `transplant(p_quality)`, with the quality still ignored; the client sends 1. A failure sends nothing: "Thử lại" calls `begin_work` again, which replaces the record. There is no new RPC. | V5 with the fewest changes; an honest round needs ≥ 9 s. The `quality_range` pin stays valid. |
| R20 | **D1 is permanent.** `q_transplant` stays 1.0, and the anti-cheat's planned soft signal "quality always 1.1" is dropped. | The quality is never used, and the client always sends 1. |
```

with:

```markdown
| R18 | **TransplantGame numbers** (§8.2): 12 beats, a 1.4 s sweep, bands ±0.08 / ±0.18 around c ∈ [0.35, 0.65], a 1 s lead-in, a 0.25 s beat, and a pass at ≥ 6. | The old design made concrete: about 12 s. |
| R19 | **Transplant contract.** `begin_work('transplant')` needs 25 s left on the lease, as a rice round (v15.2 R11, which its fix round raised from 10 s; a transplant needed 5 s). Then `transplant(p_quality)`, with the quality still ignored; the client sends 1. A failure sends nothing: "Thử lại" calls `begin_work` again, which replaces the record. There is no new RPC. | V5 with the fewest changes: a transplant round takes a rice round's gates, and 25 s covers its play (4–21 s, §8.2) and its 9 s claim. The `quality_range` pin stays valid. |
| R20 | **D1 is permanent.** `q_transplant` stays 1.0, and the anti-cheat's planned soft signal "quality always 1.1" is dropped. | The quality is never used, and the client always sends 1. |
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 2 of 11.** Replace:

```markdown
| v15.2 | Header, §3 | v15.3 is `0018_v15_3_gather.sql` (`0017` is v16). "Transplanting stays behind the 2 s gate" and the open transplant-quality question end here (§8, R20). |
| v15.2 | S6, R11, §8.3, §8.9, §11.3, §11.4 | Transplanting (rice and ớt) is a TransplantGame round: `begin_work` needs 10 s left on the lease (was 5 s) and `transplant` is gated at 8–120 s (was 2 s). Pickings keep the 3 s action, the 2 s gate and 5 s. |
| v15.2 | §13.1, §13.6, §16 | "Trồng cây ớt con" opens TransplantGame, and its 3 s bar and text go. The smoke's transplant lease case becomes 9 s → `lease ending`, 10 s → allowed. |
| anti-cheat | Header, D7, §9.3, §11.3 rules 2 and 4, §11.5 step 7 | The gather migration is `0018`, after `0016` and `0017`. |
```

with:

```markdown
| v15.2 | Header, §3 | v15.3 is `0018_v15_3_gather.sql` (`0017` is v16). "Transplanting stays behind the 2 s gate" and the open transplant-quality question end here (§8, R20). |
| v15.2 | S6, R11, §8.3, §8.9, §11.3, §11.4 | Transplanting (rice and ớt) is a TransplantGame round: `begin_work` needs 25 s left on the lease, as a rice round (was 5 s), and `transplant` is gated at 8–120 s (was 2 s). Pickings keep the 3 s action, the 2 s gate and 5 s. |
| v15.2 | §13.1, §13.6, §16 | "Trồng cây ớt con" opens TransplantGame, and its 3 s bar and text go. The smoke's transplant lease case becomes 24 s → `lease ending`, 25 s → allowed. |
| anti-cheat | Header, D7, §9.3, §11.3 rules 2 and 4, §11.5 step 7 | The gather migration is `0018`, after `0016` and `0017`. |
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 3 of 11.** Replace:

```markdown
2. It then sets `ready_at = now + 20 min`, records the visit (`visit_id`, `visit_at`, `visit_room`) and counts a visit (§7.5). It answers `visit: {id, hole, started_at}`.
3. The client plants the avatar at the hole's use spot, facing the water, and opens CrabGame. It sends `fa 6` at the start and every 2 s, then `fa 0` at the end.
4. **When the game ends:**
```

with:

```markdown
2. It then sets `ready_at = now + 20 min`, records the visit (`visit_id`, `visit_at`, `visit_room`) and counts a visit (§7.5). It answers `visit: {id, hole, started_at}`.
3. The client plants the avatar at the hole's use spot, facing the water, and opens CrabGame. It sends `fa 6` at the start and every 2 s, then `fa 0` at the end. An answer that comes back after the player left the field is dropped: the hole keeps its cooldown, as after "Dừng" before a try (R8).
4. **When the game ends:**
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 4 of 11.** Replace:

```markdown

1. "Cấy lúa" (rice, seedlings ≥ 8·s h old, water Nông) or "Trồng cây ớt con" (ớt, nursery ≥ `nursery_ready_h`, Ẩm) calls `begin_work(plot, 'transplant')`. It needs **10 s** left on the lease (`lease ending`, R19) and replaces any earlier record (v15.2 R6).
2. The client plants the avatar and opens the overlay when the answer arrives. It sends `fa 1` at the start and every 2 s, then `fa 0` at the end (v15.2 R14).
```

with:

```markdown

1. "Cấy lúa" (rice, seedlings ≥ 8·s h old, water Nông) or "Trồng cây ớt con" (ớt, nursery ≥ `nursery_ready_h`, Ẩm) calls `begin_work(plot, 'transplant')`. It needs **25 s** left on the lease, as a rice round (`lease ending`, R19), and replaces any earlier record (v15.2 R6).
2. The client plants the avatar and opens the overlay when the answer arrives. It sends `fa 1` at the start and every 2 s, then `fa 0` at the end (v15.2 R14).
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 5 of 11.** Replace:

```markdown
4. **Failure.** "❌ … Thử lại" starts a new round with a new `begin_work`. Nothing is reported. Esc, "Huỷ" or a disconnect sends nothing either; the leftover record expires after 120 s or is replaced.
```

with:

```markdown
4. **Failure.** "❌ … Thử lại" starts a new round with a new `begin_work`. Nothing is reported. Esc, "Huỷ" or a disconnect sends nothing either; the leftover record expires after 120 s or is replaced.
5. **Limits,** as a harvest round's (v15.2 §6.2 step 6): a round left idle ends itself after 110 s with "Lượt cấy đã quá lâu — bắt đầu lại nhé.", and a success whose claim is still unanswered after 15 s offers "Nghỉ tay" (and Esc), which closes the overlay; a late answer still updates the field, without a toast.
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 6 of 11.** Replace:

```markdown
- **`_work_gate` and `_farm_do_transplant`, each re-created from its latest definition** (`0016` may have changed the gate for `harvest_part`). For `transplant` the gate accepts only while `work = 'transplant'` and 8 s ≤ `p_now − work_started_at` ≤ 120 s: earlier, or with no record, is `too fast`; later is `work expired`. Every other work keeps its latest rule: a hoa-màu picking needs 2 s with no upper bound, and `harvest_part` keeps its 8–120 s. `_farm_do_transplant` applies that gate, sets `transplant_at` (rice) or P (ớt), and keeps `q_transplant = 1.0`.
- **`_farm_do_begin_work`, re-created from `0016`.** The lease gate is 10 s for a rice round or any transplant, and 5 s for a picking.
- **The wrapper** `transplant` keeps `bad_plot` and `quality_range`. The gather smoke pins all three gates (§16).
```

with:

```markdown
- **`_work_gate` and `_farm_do_transplant`, each re-created from its latest definition** (`0016` may have changed the gate for `harvest_part`). For `transplant` the gate accepts only while `work = 'transplant'` and 8 s ≤ `p_now − work_started_at` ≤ 120 s: earlier, or with no record, is `too fast`; later is `work expired`. Every other work keeps its latest rule: a hoa-màu picking needs 2 s with no upper bound, and `harvest_part` keeps its 8–120 s. `_farm_do_transplant` applies that gate, sets `transplant_at` (rice) or P (ớt), and keeps `q_transplant = 1.0`.
- **`_farm_do_begin_work`, re-created from `0016`.** The lease gate is 25 s for a rice round or any transplant, and 5 s for a picking.
- **The wrapper** `transplant` keeps `bad_plot` and `quality_range`. The gather smoke pins all three gates (§16).
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 7 of 11.** Replace:

```markdown
- **Changed, with the same signatures:**
  - `begin_work(…, 'transplant')` has the 10 s lease gate;
  - `transplant` has the 8–120 s gate;
```

with:

```markdown
- **Changed, with the same signatures:**
  - `begin_work(…, 'transplant')` has a rice round's 25 s lease gate;
  - `transplant` has the 8–120 s gate;
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 8 of 11.** Replace:

```markdown
- **Failure:** "❌ Được {5,5}/12 điểm — cần 6. Thử lại ngay nhé!", with "Thử lại" and "Nghỉ tay". Cancel is "Huỷ (Esc)".
```

with:

```markdown
- **Failure:** "❌ Được {5,5}/12 điểm — cần 6. Thử lại ngay nhé!", with "Thử lại" and "Nghỉ tay". Cancel is "Huỷ (Esc)".
- **Limits (§8.1 step 5):** an idle round ends with "Lượt cấy đã quá lâu — bắt đầu lại nhé."; a claim unanswered for 15 s shows "Nghỉ tay" under "Đang cắm nốt hàng mạ…".
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 9 of 11.** Replace:

```markdown
  - "Cấy lúa" and "Trồng cây ớt con" open TransplantGame. Their hint: "Mỗi lượt cắm 12 {khóm | cây} — được từ 6 điểm là xong; hụt thì làm lại, không mất gì."
  - A disabled reason is added: "Sắp hết hạn thuê — không kịp cấy." (under 10 s).
  - The pest button "Bắt ốc bươu vàng" gains the hint "Bắt ốc cứu lúa — được thêm 1–3 con ốc bươu vàng bỏ xô." When full, it reads "{Xô nhựa | Giỏ tre | Tay} đầy — ốc bắt được thả xuống mương, lúa vẫn được cứu." Before `0018` (no critter kinds in the catalog) it keeps v15.2's button with no hint, so nothing promises snails. The button stays enabled.
```

with:

```markdown
  - "Cấy lúa" and "Trồng cây ớt con" open TransplantGame. Their hint: "Mỗi lượt cắm 12 {khóm | cây} — được từ 6 điểm là xong; hụt thì làm lại, không mất gì."
  - A disabled reason is added: "Sắp hết hạn thuê — không kịp cấy." (under 25 s, as for "Gặt").
  - The pest button "Bắt ốc bươu vàng" gains the hint "Bắt ốc cứu lúa — được thêm 1–3 con ốc bươu vàng bỏ xô." When full, it reads "{Xô nhựa | Giỏ tre | Tay} đầy — ốc bắt được thả xuống mương, lúa vẫn được cứu." Before `0018` (no critter kinds in the catalog) it keeps v15.2's button with no hint, so nothing promises snails. The button stays enabled.
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 10 of 11.** Replace:

```markdown
  - `v15-smoke.sql`, `anticheat-smoke.sql` and `v15-2-smoke.sql` claim transplants 8 s after `begin_work`, not 2 s.
  - `v15-2-smoke.sql`'s transplant lease case becomes 9 s → `lease ending` and 10 s → allowed.
- **Config:** anon can select `critter_kinds`, and the rows equal §7.1. The fixture's prices and rules hold.
```

with:

```markdown
  - `v15-smoke.sql`, `anticheat-smoke.sql` and `v15-2-smoke.sql` claim transplants 8 s after `begin_work`, not 2 s.
  - `v15-2-smoke.sql`'s transplant lease case becomes 24 s → `lease ending` and 25 s → allowed.
- **Config:** anon can select `critter_kinds`, and the rows equal §7.1. The fixture's prices and rules hold.
```

**docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md — edit 11 of 11.** Replace:

```markdown
- **The three gates:**
  - transplant (rice and ớt): 7.9 s → `too fast`; 8 s and 120 s → transplanted with `q_transplant` = 1; 121 s → `work expired`. A second `begin_work` 5 s after the first restarts the gate. `lease ending` with 9 s left, allowed with 10 s. A claim after the lease ran out → `not your plot`.
  - a hoa-màu picking: 1.9 s → `too fast`; 2 s → picked; and no upper bound (a picking 10 minutes after its `begin_work` is accepted).
```

with:

```markdown
- **The three gates:**
  - transplant (rice and ớt): 7.9 s → `too fast`; 8 s and 120 s → transplanted with `q_transplant` = 1; 121 s → `work expired`. A second `begin_work` 5 s after the first restarts the gate. `lease ending` with 24 s left, allowed with 25 s. A claim after the lease ran out → `not your plot`.
  - a hoa-màu picking: 1.9 s → `too fast`; 2 s → picked; and no upper bound (a picking 10 minutes after its `begin_work` is accepted).
```

- [ ] **Step 6: The final checks**

Run, from the repo root:
- `pnpm test` → Expected: your Task 1 baseline plus 4 test files and 123 tests passed and 1 file and 4 tests skipped, none failing: from `2fb74e8`, 119 files passed / 14 skipped (1224 tests passed / 79 skipped). On a heavily loaded machine a few heavy tests (base ones too) can pass Vitest's 5 s default timeout: re-run such a file on its own before looking further.
- `npx tsc --noEmit` → clean, and `npx eslint components/admin/AnticheatTab.tsx lib/admin.ts lib/anticheat.ts tests/integration/v15-3.test.ts tests/integration/v15.test.ts tests/unit/admin-anticheat.test.tsx tests/unit/anticheat.test.ts` → clean.
- `pnpm lint` → the baseline's 33 problems (21 errors, 12 warnings), all in files this plan does not touch.
- `pnpm build` → compiles (in a checkout without `.env.local`: `NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_test_key pnpm build`).
- `bash "$SCRATCH/v153-sql.sh"` → `ALL OK` (Task 4's output).

- [ ] **Step 7: Commit**

Commit message:

```text
docs(v15.3): the README section, the spec amendments, the admin's cua ốc and the integration tests

The lock warning names bắt cua mò ốc after làm ruộng, beside v16's đánh bài. /admin's
anti-cheat tab labels bad_spot and gather_daily_cap, and its holdings line counts the cua ốc
a wipe would remove, before v16's seats. tests/integration/v15-3.test.ts runs the gathering
end to end as far as a fresh account can go, and the tampered calls' strike-0 envelopes in
log mode; v15.test.ts counts the two containers. The README gains the v15.3 section after
v16's (the migration and the production order, the deploy order — the client first, then
0018 —, what's new, the trust model and the Realtime budget) and says the transplant quality
stays ignored for good. The v15.3 spec's §3 amendments land in the v15, v15.2, anti-cheat and
economy specs, with the guard counts at 52; the v15.3 spec itself gives a transplant the
rice round's 25 s lease gate, which the v15.2 fix round set, and a transplant round the
harvest round's limits.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add README.md components/admin/AnticheatTab.tsx docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md docs/superpowers/specs/2026-09-25-music-together-economy-design.md docs/superpowers/specs/2026-09-25-music-together-v15-field-design.md docs/superpowers/specs/2026-09-25-music-together-v15.2-design.md docs/superpowers/specs/2026-09-26-music-together-v15.3-design.md lib/admin.ts lib/anticheat.ts tests/integration/v15-3.test.ts tests/integration/v15.test.ts tests/unit/admin-anticheat.test.tsx tests/unit/anticheat.test.ts
git commit -F <message file>
```

After this commit the owner deploys the v15.3 client, then runs `0018` in the Supabase SQL editor as soon as possible after it (after `0017`; R23), and does the manual pass (§16): a round with hands only, then with a bucket and a basket, including a pinch, an Esc and a full container; selling at two different M; a pest-snail pick on the other account's plot; transplanting rice and ớt through the game, with a failed round first; the phone layout of both overlays and the bag.
