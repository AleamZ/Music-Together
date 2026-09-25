# Music Together — Anti-cheat ("Chống gian lận") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the tamper holes of the game economy and add a server-side anti-cheat layer: checks on every game RPC for inputs no shipped client can send, an evidence log, a strike flow (a warning with a 5-minute lock, then a ban that waits for the owner's wipe or pardon) behind a log/enforce switch, the Vietnamese client for it, a root-only /admin tab, and receive budgets for Realtime.

**Architecture:** Migration `0015_anticheat.sql` (sections A–G) re-creates the 35 game RPCs with a lock gate (`_ac_account` / `_ac_play`) and hard checks that call `_ac_flag`, which writes the evidence row and returns an `anticheat` envelope instead of raising, so PostgREST commits it. `tests/sql/anticheat-smoke.sql` and the deny-by-default `tests/sql/anticheat-guards.sql` check it on a throwaway cluster. On the client, `lib/anticheat.ts` reads the envelope and feeds a small hub; the fishing and farm `call()` throw `AnticheatError`; `useAnticheat` drives the warning or ban modal and the 🔒 chip in the game shell; `components/admin/AnticheatTab.tsx` is the owner's review tool; `lib/game/net/budget.ts` rate-limits what each client accepts from Broadcast.

**Tech Stack:** Next.js 16.2.9 (App Router, client components), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom + RTL, pnpm 11, PostgreSQL 18 (a throwaway local cluster for the SQL checks).

**Spec:** `docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md` — decisions D1–D8 and rulings R1–R37. Read it before starting any task: every section number below (§…) refers to it. D1 (v15.1 ignores the farm quality) is the v15.1 plan's Task 19 and H1 (lyrics) is `0014`; neither is in this plan.

## Global Constraints

- **Start** from the v15.1 end state: `feat/v15-field` at `4e511da` (the v15.1 plan's Tasks 17–21 and its final fix round, and the merge of `main` that brings `0014_lyrics_lockdown.sql`). Work on the branch the owner names (suggested: `feat/anticheat`, created from that state, in place — no worktree). One commit per task, with the message the task gives; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The messages contain quotes and apostrophes: write each one to a file and commit with `git commit -F <file>`.
- **Package manager pnpm** (`pnpm test`, `pnpm lint`, `pnpm build`). Typecheck: `npx tsc --noEmit`. One test file: `pnpm vitest run tests/unit/<file>`.
- **Baseline** (Task 1 records yours): on `4e511da`, `pnpm test` → 89 files passed / 10 skipped (688 tests passed / 61 skipped), `npx tsc --noEmit` clean, `pnpm lint` 33 pre-existing problems (21 errors, 12 warnings) in 16 files, none of which this plan creates or modifies. After Task 14: 98 files passed / 11 skipped (762 tests passed / 67 skipped); lint unchanged. Every file you create or modify must lint clean: `npx eslint <your files>`.
- **Next.js 16.2.9 is not the Next.js you know** (`AGENTS.md`): before using any Next.js API, read its guide in `node_modules/next/dist/docs/`. Task 11 uses `env` in `next.config.ts` (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/env.md`: the value is inlined at build time).
- **React hook lint rules** (eslint-plugin-react-hooks 7): no `ref.current` reads or writes during render, no synchronous `setState` directly in an effect body (callbacks, timers and promise continuations are fine), no `Date.now()` / `Math.random()` / `performance.now()` during render. Hooks that drive the canvas take a getter `canvas: () => GameCanvasHandle | null`, never a ref object.
- **Tests:** Vitest runs without globals, so Testing Library does not clean up by itself: every component or hook test file calls `cleanup()` in an `afterEach`. Pure logic lives in `lib/` with tests in `tests/unit/`; a module a test imports must not reach `@/lib/supabase` unless the test mocks it.
- **UI copy** is Vietnamese; use the strings given in the tasks verbatim (they come from spec §12–§13). Numbers in `vi-VN` (`1.230 xu`, via `formatXu` or `toLocaleString("vi-VN")`). New strings spell "khoá" / "xoá" (R37); leave the admin page's existing "Khóa" / "Xóa" buttons alone.
- **Never type a literal invisible character** (zero-width, bidi control, odd space, combining mark) into a source file: the repo is public and such characters hide code. SQL writes them as ARE escapes (`\u200b`), SQL test data as `U&'\200B'`, TypeScript as `"\u200b"`.
- **SQL** is additive and re-runnable (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`, `on conflict do nothing`), every function has `set search_path = public, extensions`, every re-created public RPC keeps its signature and gets an explicit `grant execute … to anon, authenticated`, every private helper gets `revoke all … from public, anon, authenticated`. The owner runs migrations in the Supabase SQL editor — never run anything against a hosted database from here.
- **Local PostgreSQL:** never touch the installed PostgreSQL 18 service, its data directory or port 5432 (its password is unknown). Tasks 1–6 check the SQL on a throwaway cluster (`initdb --auth=trust`, port **5499**, in your session scratchpad `$SCRATCH`), always with `PGCLIENTENCODING=UTF8`, from the **repo root** (the smokes re-run migrations with `\i` and read `tests/fixtures/crop-cases.json` and `tests/sql/anticheat-guards.sql`). The cluster mirrors Supabase's grants (`anon` and `authenticated` get every right on each new table and function unless a migration revokes it), or the anon checks prove nothing, and it replays the migrations in the production order: `0004`…`0012`, then `0014`, then `0013`, then `0015`. `tests/sql/v14-smoke.sql` runs right after `0012`, as its header says: since `0013` prices every catch with the room's fish price index, its catch-price check holds there only. Create the check script once, in Git Bash, as `$SCRATCH/anticheat-sql.sh` (outside the repository) with:

```bash
#!/usr/bin/env bash
# The SQL check of the anti-cheat plan on a throwaway PostgreSQL 18 cluster (trust auth, Supabase's default grants).
# Run it from the repo root:  SCRATCH=<your scratchpad> bash "$SCRATCH/anticheat-sql.sh"
# Fresh cluster → 0004…0012 → the v14 smoke (it holds after 0012 only) → 0014 → 0013 → 0015 twice (the production
# order) → the lyrics, v15 and anti-cheat smokes → 0015 a third time → the anti-cheat smoke again. The lyrics and v15
# smokes run once: the lyrics smoke counts the rows it wrote, and the v15 smoke's last section re-runs 0013, which fails
# once the anti-cheat smoke has wiped an account (0013's coin_ledger reasons lack 'wipe'). Prints the smokes' "ok" rows
# and ALL OK, or FAILED and the end of the log. Leaves no cluster behind.
set -u
export PGCLIENTENCODING=UTF8
PORT=5499
PG="/c/Program Files/PostgreSQL/18/bin"
D="$SCRATCH/pg-anticheat"
LOG="$SCRATCH/anticheat-sql.log"
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
for f in supabase/migrations/0014_*.sql supabase/migrations/0013_*.sql; do
  "${PSQL[@]}" -f "$f" >>"$LOG" 2>&1 || fail "$f"
done
M=supabase/migrations/0015_anticheat.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M"
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (re-run)"
echo "0015 twice ok"
smoke tests/sql/lyrics-lockdown-smoke.sql
smoke tests/sql/v15-smoke.sql
smoke tests/sql/anticheat-smoke.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (third run)"
smoke tests/sql/anticheat-smoke.sql
"$PG/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1; rm -rf "$D"
echo "ALL OK"
```

  `SCRATCH` is your session scratchpad in Git Bash form (for example `/c/Users/<you>/AppData/Local/Temp/claude/<…>/scratchpad`): `export SCRATCH=…` in the shell that runs the script (with `set -u` it stops at once when `SCRATCH` is unset). A `WARNING: "wal_level" is insufficient` from `create publication` and `NOTICE … does not exist, skipping` lines only go to the log. The last section of `tests/sql/v15-smoke.sql` re-runs `0013` with `\i`, which puts back `0013`'s unguarded versions of the functions `0015` re-creates; the anti-cheat smoke re-runs `0015` right after its first part (which needs none of them), so the order above holds. On a real database the same applies: re-run `0015` after any re-run of `0013`, and once an account has been wiped, `0013` cannot be re-run until its `coin_ledger` reasons include `'wipe'` (see Rulings).
- **The repo is public:** never commit a password, a token or a key. The integration tests read `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and, for one check, `SUPABASE_TEST_ROOT_USERNAME` / `SUPABASE_TEST_ROOT_PASSWORD` from the environment and are skipped without them. Never type a password (account or room) in a browser.
- **Do not start dev servers.** `pnpm build` (Task 14) is the only build.
- **Deploy order** (spec §11.5) is the owner's: the migrations in the production order `0012` → `0014` → `0013` → `0015` (the §11.4 pre-deploy queries right before `0015`, which starts in log mode), then the anti-cheat client — never the client first, because it reads `chat_messages.system`. `0015` re-creates functions of `0012` and `0013`: after any later re-run of `0013`, run `0015` again (see Rulings).

## Rulings (decisions where the spec is silent, ambiguous or self-contradictory)

- **Character classes as escapes.** The spec's §6.1 table shows the C, S, Z and M classes as literal characters. `0015` writes the same code points as ARE escapes (`\u00a0`, `\u202a-\u202e`, `\U000e0000-\U000e0fff`) in plain ASCII: literal bidi controls and invisible characters in a public repo hide code and do not survive copying.
- **`_field_sweep` step 0 aliases `drying_slots` as `ds`.** The spec's `delete from public.drying_slots d …` clashes with the function's variable `d` ("column reference is ambiguous").
- **`_ac_case(uuid)`** is an added private helper: the one case JSON (16 keys) that `admin_anticheat_list`, `admin_anticheat_account` and `admin_anticheat_resolve` share.
- **`admin_anticheat_resolve(…, 'wipe')` answers `not pending` for an unknown account** before it takes `_wallet_lock`, so the wallet lock never tries to create a wallet for an account that does not exist.
- **The v15 smoke follows `0015`; the v14 smoke stays after `0012`.** `tests/sql/v15-smoke.sql` sets log mode and reads the envelope of the refusals that became tamper signals (`buy_item` of a farm item, `buy_farm_item` with quantity 0 or a fishing item, `sell_rice` with a null `dry` or 0 kg). `tests/sql/v14-smoke.sql` is not changed: since v15.1 Task 21 prices every catch with the room's fish price index, its catch-price check holds only right after `0012`, where the SQL check runs it (spec §15.1 runs it after `0015`).
- **The anti-cheat smoke runs twice** on one database (the SQL check does): it deletes its fixed names first, and each phase sets the mode it needs.
- **The guard regression's allowlist** names `0014`'s lyrics RPCs (`upsert_video_lyrics`, `update_video_lyric_offset`) whether or not `0014` is applied.
- **`finish_cast` and `fishing_board` come from `0013` section H** (v15.1 Task 21), not from `0012`: `0015` re-creates them byte for byte except the anti-cheat lines, so the catch keeps the room's fish price and the board keeps its `prices`; `_field_sweep` likewise keeps v15.1 Task 20's 400 000 xu reclaim refund. The v15 smoke, which runs after `0015`, checks both.
- **`bad_price` follows v15.1 Task 20's caps:** 1–5 000 000 for `list_plot` and `offer_plot`, 1–100 000 for `set_sublease` (spec §11.3 rule 5). The smoke's refused prices are 5 000 001 and 100 001, and its land fixtures pay a rent of 10 000 xu and a plot of 800 000.
- **The SQL check mirrors Supabase and production:** default grants to `anon` and `authenticated`, then `0004`…`0012`, the v14 smoke, `0014`, `0013` and `0015`. The lyrics lockdown smoke and the v15 smoke run once, before the anti-cheat smoke: the lyrics smoke counts the rows it wrote, and the v15 smoke's last section re-runs `0013`, which fails on a database with a wipe (next ruling).
- **Re-running `0013` after `0015`** puts back `0013`'s unguarded farm and land RPCs, `buy_item`, `finish_cast`, `fishing_board`, `_fishing_state`, `_field_sweep` and `_land_sale`, and its `coin_ledger` reason check without `'wipe'`. `0015` must run again right after it, and once an account has been wiped the re-run of `0013` fails at that check until its reason list gains `'wipe'` (spec §11.3 rule 4). The README tells the owner; the anti-cheat smoke re-runs `0015` itself after its first part.
- **Banned accounts still count in the fish price index** (`_room_wealth`) until they are wiped: `0015` does not re-create the index functions (the spec predates v15.1 Task 21), and a wipe zeroes the account's xu.
- **One screening step for both RPC wrappers:** `screenAnswer(data, error)` in `lib/anticheat.ts` reports an `account locked` refusal as a lock, sets the server clock from an envelope and reports strikes 1 and 2; the hub's events are `{ kind: "strike", info }` and `{ kind: "lock", until, code }`.
- **A lock learned from an `account locked` refusal has no code:** it runs the chip's countdown but shows no warning (its end, `serverNow() + seconds`, moves with rounding and would warn again and again). The warning shows for a strike 1 and for `fishing_state.lock`, once per lock end per page load.
- **`FinishCast`'s lost variant gains `anticheat?: AnticheatInfo | null`.** `finishCast` always sets it; it is optional in the type so the hand-built answers of the older tests still type-check.
- **Fallbacks:** `lockText` uses 300 s when the refusal's details cannot be read; a `fishing_state.lock` whose `until` does not parse reads as no lock; `castsTodayLeft` is 300 before `0015`.
- **The daily cap** is `dayCapped(state, now)`: `castBlocker` checks it right after the hourly cap (the server's order), and the fishing controller's prompt clock also ticks while it runs.
- **The /admin tab:** "{n} món đồ" is the sum of the inventory quantities and "{kg} kg lúa" is wet plus dry; the pardon confirm adds " Dữ liệu đã xoá không được khôi phục." whenever `wiped_at` is set; errors show in a `role="alert"` line; the list and the open evidence reload after every action, refused or not.
- **The build id** is computed in `next.config.ts` (`clientBuild()`); without one (`vitest`, a bare `next dev`) the header says `music-together/dev`.
- **Budgets:** `st`, `mv` and `pa` share one movement bucket per sender; `fs` and `fa` have a bucket each; `lk` and `fp` are capped where they are handled (`useLooks`, `useField`), not in `GameCanvas`; a dropped reaction spends nothing; a budget forgets full buckets once it tracks more than 256 senders.
- **The newcomer reply (R34):** a new world's first roster only records who is here; after that, a roster in which a member newly passes `isHere` calls the reply scheduler once.
- **The `fp` gap** applies to refetches started by `fp`; my own actions still refetch at once.
- **The anti-cheat modal blocks the canvas input** like the other panels.
- **Integration tests:** the short test video ids are padded to 11 characters; the banned-login check needs a root account of the test project and is skipped without one; the v15 test reads the soft `kind_mismatch` envelope of an item from the other shop.
- **The co-op pins pick a plot first:** since `7e9e707` the offer form has no plot until the player picks one, and its button stays off until then, so the offer pin picks a plot before it tries the prices; the pins refuse 5 000 001 and 100 001 (Task 20's caps).

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0015_anticheat.sql` | A names, login, system lines · B queue checks · C evidence tables · D helpers (`_ac_guard`, `_ac_account`, `_ac_play`, `_ac_flag`, `_ac_hug`, `_ac_lock_state`, `_ac_holdings`, `_ac_wipe`, `_ac_pardon`) · E the 35 guarded game RPCs and `_land_sale` · F `_fishing_state`, `_field_sweep`, `_song_bonus`, `fishing_board` · G admin RPCs |
| `tests/sql/anticheat-smoke.sql` | the smoke of every section (six parts), ending with the guard regression |
| `tests/sql/anticheat-guards.sql` | deny-by-default check of anon-callable SECURITY DEFINER functions; the 35 guarded RPCs refuse a locked account |
| `tests/sql/v15-smoke.sql` (mod) | log mode, envelope refusals |
| `lib/anticheat.ts` | pure: the envelope, `AnticheatError`, `lockSeconds`, the Vietnamese texts; the hub; `screenAnswer` |
| `lib/game/fishing/rpc.ts`, `lib/game/farm/rpc.ts` (mod) | `call()` screens every answer; `finishCast` keeps its envelope; error texts |
| `lib/game/fishing/state.ts`, `messages.ts`, `lib/game/farm/messages.ts` (mod) | `castsTodayLeft`, `dayResetsAt`, `lock`, `dayCapped`, `daily_limit`; the lock and daily-cap texts |
| `hooks/useFishing.ts`, `useField.ts`, `useCastSession.ts`, `useFishingController.ts` (mod) | no toast for a strike; the state's lock; the daily-cap clock; the `fp` gap |
| `hooks/useAnticheat.ts`, `components/game/AnticheatModal.tsx`, `AnticheatChip.tsx` | the modal and the lock countdown for the game shell |
| `components/game/GameShell.tsx`, `GameCanvas.tsx` (mod) | the modal and chip; the presence filter, the budgets and the newcomer reply |
| `lib/chat.ts`, `lib/game/fishing/announce.ts`, `components/auth/AuthScreen.tsx` (mod) | the `system` flag; the login and register texts |
| `lib/admin.ts` (mod), `components/admin/AnticheatTab.tsx`, `app/admin/page.tsx` (mod) | the /admin tab "Chống gian lận" |
| `next.config.ts`, `lib/supabase.ts` (mod) | `NEXT_PUBLIC_CLIENT_BUILD` and the `X-Client-Info` header |
| `lib/game/net/budget.ts`, `lib/game/social.ts` (mod), `hooks/useLooks.ts`, `hooks/useReactions.ts` (mod) | per-sender receive budgets, `isHereOn`, the `lk` window, the reaction budget |
| `tests/unit/anticheat*.test.ts(x)` and the other new tests | the unit, RTL and hard-signal pin tests (spec §15.2) |
| `README.md` (mod), `tests/integration/anticheat.test.ts` and the older integration tests (mod) | the "Anti-cheat" section; spec §15.3 |

## Plan conflict scan (pre-flight, done by the plan author)

- **Validated end to end.** The plan author built every task on a scratch branch from `4e511da` with one commit per task: tsc clean and each task's tests green after every task, and after each of Tasks 1–6 the SQL check above (`ALL OK`). After Task 14: the full suite (98 files passed / 11 skipped, 762 tests passed / 67 skipped), `pnpm lint` at the 33 baseline problems with none in this plan's files, and `pnpm build` (the build id is inlined, e.g. `music-together/202609251711`). The code blocks below are generated from those commits, and a mechanical replay of this document on a clean checkout of `4e511da` — each task's blocks up to Step 2, its Step 2 check failing as stated, then the rest — reproduced every file of every commit, with tsc, the task's tests, its eslint command and the SQL check green after every task, Task 13's mutation step failing and restoring as stated, and the final suite and lint as above. If an edit's "old" text is not found, re-read the file — do not improvise a different change.
- **Second version.** The first version of this plan was built on a projection of v15.1 (`b82a70a`); this one is rebuilt on `4e511da`. Besides regenerating every block, it re-creates `finish_cast` and `fishing_board` from `0013` section H and `_field_sweep` with the 400 000 xu refund (Tasks 3, 5); moves `bad_price` to the new caps (Task 4) and the smoke's land fixtures to the new prices (Tasks 4, 6); no longer edits `tests/sql/v14-smoke.sql`; checks the SQL with Supabase's default grants, in the production order, with the lyrics lockdown smoke; lets the offer pin pick a plot and moves the co-op pins to the new caps (Task 13); and tells the owner to re-run `0015` after any re-run of `0013` (Task 14).
- **Files several tasks touch, in order:** `0015_anticheat.sql` (Task 1 creates A–B, Tasks 2–6 append C–G); `tests/sql/anticheat-smoke.sql` (Task 1 creates part 1, Tasks 2–4 append, Task 4 ends it with `\i tests/sql/anticheat-guards.sql`, Tasks 5–6 insert before that line); `tests/sql/v15-smoke.sql` (Tasks 3, 4); `components/game/GameShell.tsx` (Tasks 9, 12); `hooks/useField.ts` and `tests/unit/use-field.test.tsx` (Tasks 8, 12). Each task's blocks are generated against the file as the previous task left it.
- **Nothing ships from here.** The integration tests are skipped without `SUPABASE_TEST_URL` (they were type-checked and linted only); the owner's manual pass (§15.4) and the 7-day review (§9.8) come after deploy.
- **Spec coverage:** §6.1 H5 (Tasks 1, 10), §6.2 H4 (Task 1), §6.3 H2 (Tasks 3, 5, 8), §7 (Tasks 3–4, 13), §8–§9 (Tasks 2, 5, 6), §10 (Tasks 1–6), §11 (Tasks 1–6, 14), §12 (Tasks 7–11), §13 (Tasks 8, 10, 11), §14 (Task 12), §15.1 (Tasks 1–6), §15.2 (Tasks 7–13), §15.3 (Task 14). §6.4 (D1) is the v15.1 plan's Task 19; §6.5 (H1) is `0014`.

---

### Task 1: Database — names, the login ban, system chat lines and the queue checks (`0015` sections A–B)

**Files:**
- Create: `supabase/migrations/0015_anticheat.sql` (sections A–B; Tasks 2–6 append C–G)
- Create: `tests/sql/anticheat-smoke.sql` (part 1; Tasks 2–6 add the rest)

**Interfaces:**
- Consumes (migrations `0004`–`0013`): `accounts(id, username, is_root, is_banned, created_at)`, `account_secrets(account_id, password_hash)`, `sessions(token_hash, account_id)`, `_auth(room, token, role) → member id`, `_auth_account(token) → uuid` (raises `invalid session` / `account banned`), `chat_messages(id, room_id, account_id, username, body, created_at)`, `queue_items`, `play_history`, the queue rules `_check_queue_rules(room, title, duration)`, `_orders_remaining(room, member, account)` and `_queue_status_for(room, member)`, and the extensions `unaccent`, `crypt`, `gen_salt`, `digest`, `gen_random_bytes` in schema `extensions`.
- Produces (Postgres):
  - private, revoked: `_name_norm(t text) → text` (immutable: NFC, trimmed, single spaces, lower case), `_name_key(t text) → text` (unaccented, only `[a-z0-9]`), `_clean_title(t text) → text` (C and S → space, Z removed, spaces collapsed, at most 200 characters), `_yt_thumb(p_video_id text) → text` (`https://i.ytimg.com/vi/<id>/mqdefault.jpg`);
  - `register(p_username, p_password, out account_id, out username, out token)` (same signature): `invalid username` (22023) for 2–24 characters broken, a C/S/Z/M character or a reserved key (`aoca`, `hoptacxa`, `hethong`, `quantri`, `quantrivien`, `admin`, `root`, `system`); `username already taken` (23505) on the same `_name_norm`; stores and returns the NFC single-space form;
  - `login(p_username, p_password, out account_id, out username, out token)`: finds `_name_norm(p_username)`, the exact lower-case match first; `invalid username or password` (28P01); then `account banned` (42501);
  - `chat_messages.system boolean not null default false`, `chat_messages.about_account_id uuid`, `idx_chat_about`, the backfill of the old catch and land lines;
  - `add_queue_item(p_room_id, p_session_token, p_video_id, p_title, p_thumb, p_duration) → uuid`: `invalid video` (22023) unless the id matches `^[A-Za-z0-9_-]{11}$`; the title cleaned (empty → the id); `p_thumb` ignored for `_yt_thumb(id)`; a duration outside 1–86 400 is null; `add_queue_items(p_room_id, p_session_token, p_items jsonb) → int` skips an element with a bad id; the existing `queue_items` / `play_history` thumbnails rewritten.
- Produces (smoke): `tests/sql/anticheat-smoke.sql` starts with `\set ON_ERROR_STOP on`, the temp table `smoke(k, v)` and `pg_temp.err(p_sql text) → text` (the error message, or null), and part 1 ends with `select 'anticheat names and queue smoke ok'`. It keeps the keys `t1`, `a1`, `room` in `smoke` for later parts.

- [ ] **Step 0: Record the baseline and create the SQL check script**

Run `pnpm test`, `npx tsc --noEmit` and `pnpm lint`, and write down the counts (the plan author's are in Global Constraints). Create `$SCRATCH/anticheat-sql.sh` from Global Constraints if it does not exist yet.

- [ ] **Step 1: Write smoke part 1**

Create `tests/sql/anticheat-smoke.sql` with exactly:

```sql
-- tests/sql/anticheat-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0015 (see the
-- plan), from the repo root: it re-runs the migration with \i and reads tests/sql/anticheat-guards.sql. Every check is
-- an ASSERT; the first failure stops psql (ON_ERROR_STOP). It runs twice on one database: the fixed names are removed
-- first, every other account has a random name, and every phase sets the anti-cheat mode it needs.
\set ON_ERROR_STOP on

create temp table smoke (k text primary key, v text);

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create or replace function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- ---------- H5: usernames and login (§6.1) ----------
delete from public.accounts where public._name_norm(username) in ('đạt', 'lan_99', 'minh anh');

do $$
declare n text; r record; a uuid;
begin
  foreach n in array array['A', repeat('x', 25), 'Ao cá', 'AO CA', 'Ao  cá', 'Hợp tác xã', 'hop-tac-xa', 'root',
                           'Lan' || U&'\200B', 'Lan' || U&'\00A0', 'La' || U&'\0301\0301' || 'n',
                           'Lan' || U&'\202E', 'Lan' || U&'\2028', 'Lan' || U&'\FEFF', 'Lan' || U&'\+0E0001'] loop
    assert pg_temp.err(format('select public.register(%L, %L)', n, 'pw123456')) = 'invalid username', format('refused: %s', n);
  end loop;
  select * into r from public.register('Đạt', 'pw123456');
  assert r.username = 'Đạt' and r.token is not null, 'Đạt accepted';
  perform public.register('lan_99', 'pw123456');
  select * into r from public.register('  Minh   Anh ', 'pw123456');
  assert r.username = 'Minh Anh' and (select username from public.accounts where id = r.account_id) = 'Minh Anh',
    'stored NFC with single spaces';
  assert pg_temp.err(format('select public.register(%L, %L)', 'minh  anh', 'pw123456')) = 'username already taken', 'twin';
  assert pg_temp.err(format('select public.register(%L, %L)', normalize('Đạt', NFD), 'pw123456')) = 'username already taken',
    'decomposed twin';
  select * into r from public.login(normalize('Đạt', NFD), 'pw123456');
  assert r.username = 'Đạt' and r.token is not null, 'login with the NFD form';
  select * into r from public.login('  minh   ANH ', 'pw123456');
  assert r.username = 'Minh Anh', 'login with extra spaces';
  assert pg_temp.err(format('select public.login(%L, %L)', 'lan_99', 'wrong')) = 'invalid username or password', 'password';
  a := (select id from public.accounts where username = 'lan_99');
  update public.accounts set is_banned = true where id = a;
  assert pg_temp.err(format('select public.login(%L, %L)', 'lan_99', 'wrong')) = 'invalid username or password',
    'a ban is not revealed to a wrong password';
  assert pg_temp.err(format('select public.login(%L, %L)', 'lan_99', 'pw123456')) = 'account banned', 'banned';
end $$;

-- ---------- system lines (§6.1): members write system = false; the backfill marks the well-formed announcer lines ----------
insert into smoke select 't1', token from public.register('ac1_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a1', public._auth_account((select v from smoke where k = 't1'))::text;
insert into smoke select 'room', room_id::text from public.create_room('Chống gian lận', 'pw', (select v from smoke where k = 't1'));

do $$
declare t1 text := (select v from smoke where k = 't1'); room uuid := (select v from smoke where k = 'room')::uuid;
        v_id uuid;
begin
  v_id := public.send_chat_message(t1, room, '[catch:00000000-0000-0000-0000-000000000000|ca_ro|200] fake');
  assert (select not system and about_account_id is null from public.chat_messages where id = v_id),
    'a member line is never a system line';
  -- old lines from before 0015: two well-formed, one without the prefix, one with a member author
  insert into public.chat_messages (room_id, account_id, username, body) values
    (room, null, 'Ao cá', '[catch:11111111-2222-3333-4444-555555555555|ca_tra|3150] 🎣 Lan vừa câu được Cá tra 3,2 kg (Hiếm)!'),
    (room, null, 'Hợp tác xã', '[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.'),
    (room, null, 'Ao cá', 'no prefix here'),
    (room, (select v from smoke where k = 'a1')::uuid, 'Ao cá', '[catch:11111111-2222-3333-4444-555555555555|ca_tra|3150] x');
end $$;

-- ---------- H4: queue metadata (§6.2) ----------
do $$
declare t1 text := (select v from smoke where k = 't1'); room uuid := (select v from smoke where k = 'room')::uuid;
        v_id uuid; q public.queue_items; n int; bad text;
begin
  update public.rooms set max_duration_seconds = 0 where id = room;   -- unlimited: a null duration is allowed
  foreach bad in array array['abc', 'dQw4w9WgXcQ?', 'dQw4w9WgXc', 'dQw4w9WgXcQQ', 'dQw4w9 gXcQ'] loop
    assert pg_temp.err(format('select public.add_queue_item(%L, %L, %L, %L, null, 100)', room, t1, bad, 'x'))
           = 'invalid video', format('bad id %s', bad);
  end loop;
  assert pg_temp.err(format('select public.add_queue_item(%L, %L, null, %L, null, 100)', room, t1, 'x')) = 'invalid video', 'null id';
  v_id := public.add_queue_item(room, t1, 'dQw4w9WgXcQ',
          E'  Never\tGonna' || U&'\00A0\00A0' || 'Give' || U&'\200B\202E\2028' || ' You   Up  ' || repeat('x', 250),
          'https://evil.example/pixel.gif', 0);
  select * into q from public.queue_items where id = v_id;
  assert q.title = left('Never Gonna Give You Up ' || repeat('x', 250), 200) and char_length(q.title) = 200, format('title %s', q.title);
  assert q.thumbnail_url = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg', 'derived thumbnail';
  assert q.duration_seconds is null, 'duration 0 is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa1', U&'\200B\00A0', null, -5);
  select * into q from public.queue_items where id = v_id;
  assert q.title = 'aaaaaaaaaa1' and q.duration_seconds is null, 'an empty title falls back to the id; -5 is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa2', 'Long', null, 90000);
  assert (select duration_seconds is null from public.queue_items where id = v_id), '90 000 s is unknown';
  v_id := public.add_queue_item(room, t1, 'aaaaaaaaaa3', 'Ok', null, 86400);
  assert (select duration_seconds = 86400 from public.queue_items where id = v_id), '86 400 s is kept';
  -- a zero-width character no longer splits a banned keyword (R26)
  update public.rooms set banned_keywords = array['remix'] where id = room;
  assert pg_temp.err(format('select public.add_queue_item(%L, %L, %L, %L, null, 100)', room, t1, 'aaaaaaaaaa4',
                            'Song (re' || U&'\200B' || 'mix)')) = 'banned keyword: remix', 'keyword';
  update public.rooms set banned_keywords = '{}' where id = room;
  -- the batch skips bad ids and cleans the rest
  n := public.add_queue_items(room, t1, jsonb_build_array(
         jsonb_build_object('video_id', 'bad', 'title', 'x', 'thumb', 'https://evil.example/a.gif', 'duration', 100),
         jsonb_build_object('video_id', 'bbbbbbbbbb1', 'title', E'Two\n' || U&'\2060' || 'lines', 'thumb', 'https://evil.example/b.gif',
                            'duration', 100000),
         jsonb_build_object('video_id', 'bbbbbbbbbb2', 'title', '', 'duration', 42.9),
         jsonb_build_object('title', 'no id')));
  assert n = 2, format('batch added %s', n);
  select * into q from public.queue_items where room_id = room and youtube_video_id = 'bbbbbbbbbb1';
  assert q.title = 'Two lines' and q.thumbnail_url = 'https://i.ytimg.com/vi/bbbbbbbbbb1/mqdefault.jpg' and q.duration_seconds is null,
    format('batch row 1: %s / %s / %s', q.title, q.thumbnail_url, q.duration_seconds);
  select * into q from public.queue_items where room_id = room and youtube_video_id = 'bbbbbbbbbb2';
  assert q.title = 'bbbbbbbbbb2' and q.duration_seconds = 42, 'batch row 2';
  -- rows from before 0015, for the re-run below
  insert into public.queue_items (room_id, youtube_video_id, title, thumbnail_url, added_by_name, position)
  values (room, 'ccccccccccc', 'old', 'https://evil.example/c.gif', 'x', 99), (room, 'old!', 'older', 'https://evil.example/d.gif', 'x', 98);
  insert into public.play_history (room_id, youtube_video_id, title, thumbnail_url)
  values (room, 'ccccccccccc', 'old', 'https://evil.example/e.gif'), (room, 'old!', 'older', 'https://evil.example/f.gif');
end $$;

-- Re-running the migration backfills the old chat lines and rewrites the old thumbnails (and proves it re-runs).
\i supabase/migrations/0015_anticheat.sql

do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
begin
  assert (select system and about_account_id = '11111111-2222-3333-4444-555555555555' from public.chat_messages
           where room_id = room and account_id is null and body like '[catch:%'), 'old catch line marked, with its catcher';
  assert (select system and about_account_id is null from public.chat_messages where room_id = room and body like '[land:3]%'),
    'old land line marked, unattributed (R13)';
  assert (select not system from public.chat_messages where room_id = room and body = 'no prefix here'), 'no prefix → not system';
  assert (select not system from public.chat_messages where room_id = room and account_id is not null and body like '[catch:%x'),
    'a member author → not system';
  assert (select thumbnail_url from public.queue_items where room_id = room and youtube_video_id = 'ccccccccccc')
         = 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg'
     and (select thumbnail_url is null from public.queue_items where room_id = room and youtube_video_id = 'old!'), 'queue rewritten';
  assert (select thumbnail_url from public.play_history where room_id = room and youtube_video_id = 'ccccccccccc')
         = 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg'
     and (select thumbnail_url is null from public.play_history where room_id = room and youtube_video_id = 'old!'), 'history rewritten';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and p.proname in ('_name_norm', '_name_key', '_clean_title', '_yt_thumb')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the name and queue helpers are private';
end $$;

select 'anticheat names and queue smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run (repo root, Git Bash): `bash "$SCRATCH/anticheat-sql.sh"`
Expected: `v14 smoke ok`, then `FAILED: supabase/migrations/0015_anticheat.sql` — the migration does not exist yet.

- [ ] **Step 3: Write the migration's sections A–B**

Create `supabase/migrations/0015_anticheat.sql` with exactly:

```sql
-- =========================================================
-- 0015_anticheat.sql — the anti-cheat layer (docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md):
-- username rules and server-only system chat lines (H5), the queue metadata checks (H4), the daily cast cap (H2), the
-- evidence log, strikes, the 5-minute lock, the ban with the owner's wipe, and the guarded game RPCs.
-- ADDITIVE (no data drop) and re-runnable. Requires 0012 and 0013; does not depend on 0014. Every function relies on
-- `set search_path = public, extensions`. It starts in log mode: strikes are recorded, nobody is locked or banned.
-- Character classes (§6.1), written as PostgreSQL ARE escapes:
--   C controls                  \u0001-\u001f\u007f-\u009f
--   S odd spaces                \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000
--   Z invisible and format      \u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e
--                               \u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff
--   M combining marks (names)   \u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f
-- =========================================================

-- ---------- A. Accounts and chat (§6.1) ----------
-- The form register and login compare: NFC, trimmed, single spaces, lower case (R27).
create or replace function public._name_norm(t text) returns text
language sql immutable set search_path = public, extensions
as $$ select lower(regexp_replace(btrim(normalize(coalesce(t, ''), NFC)), ' {2,}', ' ', 'g')) $$;

-- The key reserved names are compared on: no accents, nothing but a–z and 0–9 (R28).
create or replace function public._name_key(t text) returns text
language sql stable set search_path = public, extensions
as $$ select regexp_replace(lower(extensions.unaccent(normalize(coalesce(t, ''), NFC))), '[^a-z0-9]+', '', 'g') $$;

-- A queue title (R26): C and S characters become spaces, Z characters go, runs of spaces collapse, at most 200 characters.
create or replace function public._clean_title(t text) returns text
language sql immutable set search_path = public, extensions
as $$
  select left(btrim(regexp_replace(regexp_replace(regexp_replace(coalesce(t, ''),
    '[\u0001-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]', ' ', 'g'),
    '[\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff]',
    '', 'g'), ' {2,}', ' ', 'g')), 200)
$$;

-- The thumbnail of a video (R25): YouTube's 16:9 picture, derived from the id.
create or replace function public._yt_thumb(p_video_id text) returns text
language sql immutable set search_path = public, extensions
as $$ select 'https://i.ytimg.com/vi/' || p_video_id || '/mqdefault.jpg' $$;

revoke all on function public._name_norm(text) from public, anon, authenticated;
revoke all on function public._name_key(text) from public, anon, authenticated;
revoke all on function public._clean_title(text) from public, anon, authenticated;
revoke all on function public._yt_thumb(text) from public, anon, authenticated;

-- 2–24 characters, no control, odd-space, invisible or combining character, no reserved name; unique on the
-- normalized form. The stored name is the NFC form with single spaces, and the username OUT parameter returns it.
create or replace function public.register(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_name text := regexp_replace(btrim(normalize(coalesce(p_username, ''), NFC)), ' {2,}', ' ', 'g');
begin
  if char_length(v_name) not between 2 and 24
     or v_name ~ '[\u0001-\u001f\u007f-\u009f\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\U000e0000-\U000e0fff\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]'
     or public._name_key(v_name) in ('aoca', 'hoptacxa', 'hethong', 'quantri', 'quantrivien', 'admin', 'root', 'system') then
    raise exception 'invalid username' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounts a where public._name_norm(a.username) = public._name_norm(v_name)) then
    raise exception 'username already taken' using errcode = '23505';
  end if;
  account_id := gen_random_uuid(); username := v_name; token := encode(gen_random_bytes(32), 'hex');
  insert into public.accounts (id, username) values (account_id, v_name);
  insert into public.account_secrets (account_id, password_hash) values (account_id, crypt(p_password, gen_salt('bf')));
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

-- The same normalized lookup (an exact match first); a banned account learns it only after the right password.
create or replace function public.login(
  p_username text, p_password text,
  out account_id uuid, out username text, out token text
) language plpgsql security definer set search_path = public, extensions
as $$
declare v_hash text; v_banned boolean;
begin
  select a.id, a.username, s.password_hash, a.is_banned into account_id, username, v_hash, v_banned
  from public.accounts a join public.account_secrets s on s.account_id = a.id
  where public._name_norm(a.username) = public._name_norm(p_username)
  order by (lower(a.username) = lower(btrim(p_username))) desc, a.created_at
  limit 1;
  if account_id is null or crypt(p_password, v_hash) <> v_hash then
    raise exception 'invalid username or password' using errcode = '28P01';
  end if;
  if v_banned then
    raise exception 'account banned' using errcode = '42501';
  end if;
  token := encode(gen_random_bytes(32), 'hex');
  insert into public.sessions (token_hash, account_id) values (encode(digest(token, 'sha256'), 'hex'), account_id);
end; $$;

grant execute on function public.register(text, text) to anon, authenticated;
grant execute on function public.login(text, text) to anon, authenticated;

-- A system line is written by a SECURITY DEFINER function only (RLS has no write policy); about_account_id is the
-- catcher of a catch line and the buyer of a land line (R12), so a wipe deletes exactly that account's lines (D6).
alter table public.chat_messages add column if not exists system boolean not null default false;
alter table public.chat_messages add column if not exists about_account_id uuid;
create index if not exists idx_chat_about on public.chat_messages (about_account_id) where system;

-- Backfill (touches only system = false rows): well-formed author-less announcer lines. Land lines keep no account (R13).
update public.chat_messages
   set system = true,
       about_account_id = substring(body from '^\[catch:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\|')::uuid
 where not system and account_id is null and username = 'Ao cá'
   and body ~ '^\[catch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\|[a-z_]{1,32}\|[0-9]{1,6}\] ';
update public.chat_messages set system = true
 where not system and account_id is null and username = 'Hợp tác xã' and body ~ '^\[land:[0-9]{1,2}\] ';

-- ---------- B. Queue (§6.2) ----------
-- An 11-character YouTube id or 'invalid video'; the title cleaned (else the id); the thumbnail derived from the id
-- (p_thumb is ignored); a duration outside 1–86 400 s is unknown (R24). The room rules, the order limit and the
-- approval status then run on these values.
create or replace function public.add_queue_item(
  p_room_id uuid, p_session_token text,
  p_video_id text, p_title text, p_thumb text, p_duration integer
) returns uuid language plpgsql security definer set search_path = public, extensions
as $$
declare v_member uuid; v_account uuid; v_name text; v_status text; v_pos double precision; v_id uuid;
        v_title text; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');
  v_account := public._auth_account(p_session_token);
  if p_video_id is null or p_video_id !~ '^[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid video' using errcode = '22023';
  end if;
  v_title := coalesce(nullif(public._clean_title(p_title), ''), p_video_id);
  v_duration := case when p_duration between 1 and 86400 then p_duration end;
  select username into v_name from public.accounts where id = v_account;
  perform public._check_queue_rules(p_room_id, v_title, v_duration);
  if coalesce(public._orders_remaining(p_room_id, v_member, v_account), 1) <= 0 then
    raise exception 'order limit reached' using errcode = '23514';
  end if;
  v_status := public._queue_status_for(p_room_id, v_member);
  if v_status = 'pending' then
    v_pos := 0;
  else
    select coalesce(max(position), 0) + 1 into v_pos from public.queue_items where room_id = p_room_id and status = 'approved';
  end if;
  insert into public.queue_items
    (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position, status)
  values (p_room_id, p_video_id, v_title, public._yt_thumb(p_video_id), v_duration, v_account, v_name, v_pos, v_status)
  returning id into v_id;
  return v_id;
end; $$;

-- The playlist add: an element whose id fails the pattern is skipped, as an empty id is; the same title, thumbnail and
-- duration rules.
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_member uuid; v_account uuid; v_name text; v_status text; v_base double precision; v_remaining int;
  v_idx int := 0; v_count int := 0; v_item jsonb; v_video text; v_title text; v_num numeric; v_duration integer;
begin
  v_member := public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  v_status := public._queue_status_for(p_room_id, v_member);
  v_remaining := public._orders_remaining(p_room_id, v_member, v_account);   -- null = unlimited
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id and status = 'approved';
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    v_video := v_item->>'video_id';
    if v_video is null or v_video !~ '^[A-Za-z0-9_-]{11}$' then continue; end if;
    v_title := coalesce(nullif(public._clean_title(v_item->>'title'), ''), v_video);
    v_num := case when jsonb_typeof(v_item->'duration') = 'number' then floor((v_item->>'duration')::numeric) end;
    v_duration := case when v_num between 1 and 86400 then v_num::int end;
    begin
      perform public._check_queue_rules(p_room_id, v_title, v_duration);
    exception when check_violation then
      continue;   -- skip this element, keep going (does not use a slot)
    end;
    if v_remaining is not null and v_count >= v_remaining then exit; end if;   -- slots used up
    v_idx := v_idx + 1;
    insert into public.queue_items
      (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position, status)
    values (
      p_room_id, v_video, v_title, public._yt_thumb(v_video), v_duration,
      v_account, v_name,
      case when v_status = 'pending' then 0 else v_base + v_idx end,
      v_status
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.add_queue_item(uuid, text, text, text, text, integer) to anon, authenticated;
grant execute on function public.add_queue_items(uuid, text, jsonb) to anon, authenticated;

-- Existing rows (idempotent): every thumbnail becomes the derived one; a row whose id fails the pattern gets none.
update public.queue_items
   set thumbnail_url = case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end
 where thumbnail_url is distinct from
       (case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end);
update public.play_history
   set thumbnail_url = case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end
 where thumbnail_url is distinct from
       (case when youtube_video_id ~ '^[A-Za-z0-9_-]{11}$' then public._yt_thumb(youtube_video_id) end);
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected:

```text
v14 smoke ok
0015 twice ok
lyrics lockdown smoke ok
v15 crop smoke ok
v15 land smoke ok
v15 farm smoke ok
v15 fish price smoke ok
v15 upgrade reset smoke ok
anticheat names and queue smoke ok
anticheat names and queue smoke ok
ALL OK
```

Any failed `ASSERT` stops psql; the script prints `FAILED:` with the assertion's message.

- [ ] **Step 5: Commit**

Commit message:

```text
feat(anticheat): 0015 names, login ban, system chat lines and queue checks

Sections A–B of 0015_anticheat.sql: usernames are 2–24 characters without hidden or combining characters or reserved
names and are unique on their NFC, single-space, lower-case form; login finds that form and refuses a banned account
after the right password; chat_messages gains system and about_account_id with a backfill of the old announcer lines;
the queue takes 11-character ids only, cleans titles, derives thumbnails and forgets impossible durations.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0015_anticheat.sql tests/sql/anticheat-smoke.sql
git commit -F <message file>
```

---

### Task 2: Database — the evidence tables, the strike flow, the wipe and the pardon (`0015` sections C–D)

**Files:**
- Modify: `supabase/migrations/0015_anticheat.sql` (append sections C–D)
- Modify: `tests/sql/anticheat-smoke.sql` (append part 2)

**Interfaces:**
- Consumes: Task 1's `0015` A–B and smoke part 1 (`smoke`, `pg_temp.err`); from `0012`–`0013`: `_vn_today() → date`, `_auth_account`, `_farm_auth(room, token) → uuid` (membership and `last_seen_at`), `wallets`, `coin_ledger(account_id, delta, balance, reason, ref)` and its reason check, `inventory`, `casts`, `fish`, `fishing_profiles`, `personal_bests`, `rice_stock`, `field_plots`, `plot_leases`, `land_offers`, `crops`, `drying_slots`; the PostgREST setting `request.headers`.
- Produces (Postgres, all private and revoked):
  - tables `anticheat_config(id boolean pk = true, mode 'log' | 'enforce' default 'log', mode_changed_at, mode_changed_by)` with its one row, `anticheat_status(account_id pk, strikes 0–2, last_strike_at, last_strike_code, locked_until, ban_state null | 'pending_wipe' | 'wiped', banned_at, wiped_at, pardoned_at, pardoned_by, hug_on, hug_count, events_on, events_count)`, `anticheat_events(id, account_id, username, code, outcome, rpc, room_id, detail, client, user_agent, created_at)` (`outcome` ∈ `soft`, `log_only`, `root`, `in_lock`, `strike_1`, `strike_2`), `anticheat_wipes(id, account_id, username, wiped_at, wiped_by, snapshot)`; RLS on, all revoked;
  - `fishing_profiles.day_on date`, `day_casts smallint`; the `coin_ledger` reason check gains `'wipe'`;
  - `_ac_guard(uuid)` raises `account locked` (42501, detail = whole seconds left, hint `anticheat`); `_ac_account(token) → uuid`; `_ac_play(room, token) → uuid`; `_ac_lock_state(uuid) → {until, code} | null`;
  - `_ac_flag(p_account uuid, p_code text, p_rpc text, p_detail jsonb, p_room uuid default null, p_error text default null, p_hard boolean default true) → jsonb` — the evidence row, the outcome, strike 1 (5-minute lock) or strike 2 (ban, sessions deleted, `pending_wipe`), the 200-rows-a-day cap, the 90-day purge (at most 500 rows), and the envelope `{"anticheat": {code, strike, error, locked_until, banned, server_now}}`;
  - `_ac_hug(uuid, numeric, uuid)` (the 20th gate hug of a Vietnam day logs a soft `reel_gate_hug`), `_ac_holdings(uuid) → jsonb` (`wallet`, `inventory`, `fishing_profile`, `fish`, `personal_bests`, `rice`, `plots`, `leases`, `offers`, `crops`, `drying`, `announcements`), `_ac_wipe(uuid, by uuid) → snapshot`, `_ac_pardon(uuid, by uuid)` (`nothing to pardon` without a ban, a running lock or a strike in 30 days).
- Produces (smoke): `pg_temp.errd(sql) → {message, detail, hint}`, `pg_temp.flag(a uuid, code text default 'bad_plot', hard boolean default true) → jsonb`, `pg_temp.status(a uuid) → anticheat_status`, `pg_temp.last_outcome(a uuid) → text`; keys `t2`–`t6`, `troot`, `a2`–`a6`, `aroot`; part 2 ends with `select 'anticheat flow smoke ok'`.

- [ ] **Step 1: Write smoke part 2**

**tests/sql/anticheat-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- the flow (§9): the lock gate, the evidence, strikes, root, log mode, the caps, holdings, wipe, pardon ----------
-- An error as {message, detail, hint}, or null when the statement succeeds.
create or replace function pg_temp.errd(p_sql text) returns jsonb language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return jsonb_build_object('message', v_msg, 'detail', v_detail, 'hint', v_hint);
end $$;
-- A flagged input of the kind the room RPCs report (hard by default).
create or replace function pg_temp.flag(a uuid, code text default 'bad_plot', hard boolean default true) returns jsonb
language sql as $$ select public._ac_flag(a, code, 'water', jsonb_build_object('plot', 99), null, 'invalid plot', hard) $$;
create or replace function pg_temp.status(a uuid) returns public.anticheat_status language sql
as $$ select * from public.anticheat_status where account_id = a $$;
create or replace function pg_temp.last_outcome(a uuid) returns text language sql
as $$ select outcome from public.anticheat_events where account_id = a order by id desc limit 1 $$;

insert into smoke select 't2', token from public.register('ac2_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't3', token from public.register('ac3_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't4', token from public.register('ac4_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't5', token from public.register('ac5_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 't6', token from public.register('ac6_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'troot', token from public.register('acroot_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('t2', 't3', 't4', 't5', 't6', 'troot');
update public.accounts set is_root = true where id = (select v from smoke where k = 'aroot')::uuid;
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw',
                        (select v from smoke where k = 't2'));

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; e jsonb; f text;
begin
  -- private objects
  assert (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
           and p.proname in ('_ac_guard', '_ac_account', '_ac_play', '_ac_flag', '_ac_hug', '_ac_lock_state', '_ac_holdings',
                             '_ac_wipe', '_ac_pardon')) = 9, 'nine helpers';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_ac\_%'
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
  foreach f in array array['anticheat_config', 'anticheat_status', 'anticheat_events', 'anticheat_wipes'] loop
    assert not has_table_privilege('anon', 'public.' || f, 'select') and not has_table_privilege('anon', 'public.' || f, 'insert'), f;
  end loop;
  assert (select count(*) from public.anticheat_config) = 1, 'one config row';

  -- the lock gate: the account RPCs and the room RPCs raise 'account locked' with the seconds and the hint
  assert public._ac_account(t2) = a2 and public._ac_play(room, t2) = a2, 'no lock';
  insert into public.anticheat_status (account_id, locked_until) values (a2, now() + interval '125 seconds')
  on conflict (account_id) do update set locked_until = excluded.locked_until;
  e := pg_temp.errd(format('select public._ac_account(%L)', t2));
  assert e->>'message' = 'account locked' and e->>'hint' = 'anticheat' and e->>'detail' = '125', format('lock %s', e);
  e := pg_temp.errd(format('select public._ac_play(%L, %L)', room, t2));
  assert e->>'message' = 'account locked' and e->>'detail' = '125', format('room lock %s', e);
  assert pg_temp.err(format('select public._ac_play(%L, %L)', gen_random_uuid(), t2)) = 'account is not a member of this room',
    'membership first';
  assert pg_temp.err(format('select public._ac_account(%L)', 'no such token')) = 'invalid session', 'session first';
  assert public._ac_lock_state(a2) = jsonb_build_object('until', now() + interval '125 seconds', 'code', null), 'lock state';
  update public.anticheat_status set locked_until = null where account_id = a2;
  assert public._ac_lock_state(a2) is null and public._ac_lock_state(gen_random_uuid()) is null, 'no lock state';
end $$;

do $$
declare t2 text := (select v from smoke where k = 't2'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; aroot uuid := (select v from smoke where k = 'aroot')::uuid;
        r jsonb; s public.anticheat_status;
begin
  -- log mode (D5): recorded, never escalated, and never counted later (R7)
  update public.anticheat_config set mode = 'log';
  r := pg_temp.flag(a2);
  assert r = jsonb_build_object('anticheat', jsonb_build_object('code', 'bad_plot', 'strike', 0, 'error', 'invalid plot',
                                'locked_until', null, 'banned', false, 'server_now', now())), format('log envelope %s', r);
  assert pg_temp.last_outcome(a2) = 'log_only', 'log_only row';
  assert (select username = (select username from public.accounts where id = a2) and rpc = 'water' and detail = '{"plot": 99}'
            and client is null and user_agent is null
            from public.anticheat_events where account_id = a2 order by id desc limit 1), 'the evidence row';
  s := pg_temp.status(a2);
  assert s.strikes = 0 and s.locked_until is null and s.events_count = 1 and s.events_on = public._vn_today(), 'counted, not struck';

  -- enforce: strike 1 locks for 5 minutes
  update public.anticheat_config set mode = 'enforce';
  r := pg_temp.flag(a2);
  assert (r->'anticheat'->>'strike')::int = 1 and (r->'anticheat'->>'locked_until')::timestamptz = now() + interval '5 minutes'
     and not (r->'anticheat'->>'banned')::boolean, format('strike 1 %s', r);
  s := pg_temp.status(a2);
  assert s.strikes = 1 and s.last_strike_code = 'bad_plot' and s.last_strike_at = now()
     and s.locked_until = now() + interval '5 minutes' and s.events_count = 1, 'locked; strike rows are not counted';
  assert pg_temp.last_outcome(a2) = 'strike_1', 'strike_1 row';
  assert public._ac_lock_state(a2) = jsonb_build_object('until', now() + interval '5 minutes', 'code', 'bad_plot'), 'lock state';
  -- one strike per lock (§9.4)
  r := pg_temp.flag(a2, 'bad_water');
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(a2) = 'in_lock' and (pg_temp.status(a2)).strikes = 1, 'in_lock';
  -- after the lock, the next hard signal bans (D3)
  update public.anticheat_status set locked_until = now() - interval '1 second' where account_id = a2;
  r := pg_temp.flag(a2, 'bad_water');
  assert (r->'anticheat'->>'strike')::int = 2 and (r->'anticheat'->>'banned')::boolean and r->'anticheat'->'locked_until' = 'null',
    format('strike 2 %s', r);
  s := pg_temp.status(a2);
  assert s.strikes = 2 and s.ban_state = 'pending_wipe' and s.banned_at = now() and s.locked_until is null
     and s.last_strike_code = 'bad_water', 'pending wipe';
  assert (select is_banned from public.accounts where id = a2) and not exists (select 1 from public.sessions where account_id = a2),
    'banned, sessions deleted';
  assert pg_temp.err(format('select public._ac_account(%L)', t2)) = 'invalid session', 'the old token is dead';
  r := pg_temp.flag(a2);
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(a2) = 'in_lock', 'a banned account: in_lock';

  -- a lone strike 1 older than 30 days has expired (D4)
  insert into public.anticheat_status (account_id, strikes, last_strike_at, last_strike_code)
  values (a3, 1, now() - interval '31 days', 'bad_plot')
  on conflict (account_id) do update set strikes = 1, last_strike_at = excluded.last_strike_at, locked_until = null, ban_state = null;
  r := pg_temp.flag(a3);
  assert (r->'anticheat'->>'strike')::int = 1 and (pg_temp.status(a3)).last_strike_at = now(), 'strike 1 again';
  update public.anticheat_status set locked_until = null, last_strike_at = now() - interval '29 days' where account_id = a3;
  r := pg_temp.flag(a3);
  assert (r->'anticheat'->>'strike')::int = 2, 'within 30 days: strike 2';

  -- root is never locked or banned (§9.8)
  r := pg_temp.flag(aroot);
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(aroot) = 'root'
     and (pg_temp.status(aroot)).locked_until is null and not (select is_banned from public.accounts where id = aroot), 'root';
end $$;

do $$
declare a4 uuid := (select v from smoke where k = 'a4')::uuid; a5 uuid := (select v from smoke where k = 'a5')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; r jsonb; i int;
begin
  update public.anticheat_config set mode = 'enforce';
  -- soft signals never escalate, in any mode
  r := pg_temp.flag(a4, 'kind_mismatch', false);
  assert (r->'anticheat'->>'strike')::int = 0 and pg_temp.last_outcome(a4) = 'soft' and (pg_temp.status(a4)).locked_until is null, 'soft';
  -- at most 200 non-strike rows per account and Vietnam day; strike rows are always written (R31)
  for i in 2..201 loop
    perform pg_temp.flag(a4, 'kind_mismatch', false);
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = a4) = 200, '200 rows a day';
  r := pg_temp.flag(a4);
  assert (r->'anticheat'->>'strike')::int = 1 and (select count(*) from public.anticheat_events where account_id = a4) = 201,
    'the strike row is written past the cap';
  update public.anticheat_status set events_on = events_on - 1 where account_id = a4;
  perform pg_temp.flag(a4, 'kind_mismatch', false);
  assert (select count(*) from public.anticheat_events where account_id = a4) = 202, 'a new day restarts the count';
  -- the purge: other rows live 90 days, strike rows forever (§8.4)
  insert into public.anticheat_events (account_id, username, code, outcome, rpc, created_at) values
    (a4, 'x', 'kind_mismatch', 'soft', 'buy_item', now() - interval '91 days'),
    (a4, 'x', 'bad_plot', 'strike_1', 'water', now() - interval '91 days');
  perform pg_temp.flag(a4, 'kind_mismatch', false);
  assert not exists (select 1 from public.anticheat_events where account_id = a4 and outcome = 'soft'
                       and created_at < now() - interval '90 days'), 'old soft row purged';
  assert exists (select 1 from public.anticheat_events where account_id = a4 and outcome = 'strike_1'
                   and created_at < now() - interval '90 days'), 'old strike row kept';
  -- the client build and the browser come from the request headers, capped; a bad value is ignored (R32)
  perform set_config('request.headers',
    json_build_object('x-client-info', 'music-together/' || repeat('9', 120), 'user-agent', repeat('U', 300))::text, true);
  perform pg_temp.flag(a5, 'kind_mismatch', false);
  assert (select client = left('music-together/' || repeat('9', 120), 100) and user_agent = repeat('U', 200)
            from public.anticheat_events where account_id = a5 order by id desc limit 1), 'headers';
  perform set_config('request.headers', 'not json', true);
  perform pg_temp.flag(a5, 'kind_mismatch', false);
  assert (select client is null and user_agent is null from public.anticheat_events where account_id = a5 order by id desc limit 1),
    'a bad header value';
  perform set_config('request.headers', '', true);
  -- reel gate hugs: counted per Vietnam day, logged once at the 20th (R20)
  for i in 1..19 loop
    perform public._ac_hug(a5, 0.95, room);
  end loop;
  assert not exists (select 1 from public.anticheat_events where account_id = a5 and code = 'reel_gate_hug'), '19 hugs: nothing';
  perform public._ac_hug(a5, 0.97, room);
  perform public._ac_hug(a5, 0.95, room);
  assert (select count(*) from public.anticheat_events where account_id = a5 and code = 'reel_gate_hug') = 1, 'logged once';
  assert (select outcome = 'soft' and rpc = 'finish_cast' and room_id = room
                 and detail = jsonb_build_object('day', public._vn_today(), 'count', 20, 'ratio', 0.97)
            from public.anticheat_events where account_id = a5 and code = 'reel_gate_hug'), 'the hug row';
  update public.anticheat_status set hug_on = hug_on - 1 where account_id = a5;
  perform public._ac_hug(a5, 0.95, room);
  assert (pg_temp.status(a5)).hug_count = 1 and (pg_temp.status(a5)).hug_on = public._vn_today(), 'a new day';
  assert (pg_temp.status(a5)).strikes = 0, 'hugs never strike';
end $$;

do $$
declare a5 uuid := (select v from smoke where k = 'a5')::uuid; a6 uuid := (select v from smoke where k = 'a6')::uuid;
        aroot uuid := (select v from smoke where k = 'aroot')::uuid; room uuid := (select v from smoke where k = 'room')::uuid;
        h jsonb; snap jsonb; w public.anticheat_wipes;
begin
  -- holdings: everything a wipe would remove (§9.6)
  insert into public.wallets (account_id, coins, daily_on, bonus_on, bonus_count) values (a6, 1230, '2026-10-01', '2026-10-01', 3);
  insert into public.inventory (account_id, item_id, qty) values (a6, 'rod_bamboo', 1), (a6, 'bait_worm', 7), (a6, 'seed_nep', 2);
  insert into public.fishing_profiles (account_id, rod) values (a6, 'rod_bamboo');
  insert into public.casts (account_id, room_id, species_id, weight_g, min_reel_ms, bite_at, expires_at)
  values (a6, room, 'ca_ro', 100, 2600, now(), now() + interval '1 minute');
  insert into public.fish (account_id, species_id, weight_g, price) values (a6, 'ca_tra', 3150, 221);
  insert into public.personal_bests (account_id, species_id, weight_g) values (a6, 'ca_tra', 3150);
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (a6, 'nep', 0, 70);
  perform public._field_init(room);
  update public.field_plots set owner_id = a6, owned_at = now(), sublease_price = 300 where room_id = room and plot_no = 3;
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until)
  values (room, 7, a6, 'village', 250, now(), now() + interval '96 hours');
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (room, 2, a6, 8000, now());
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at) values (room, 7, a6, 'nep', now());
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at) values (room, 2, a6, 'nep', 70, now());
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id) values
    (room, null, 'Ao cá', '[catch:' || a6 || '|ca_tra|3150] 🎣 x', true, a6),
    (room, a6, 'x', 'a line of my own', false, null);
  h := public._ac_holdings(a6);
  assert h->'wallet' = '{"coins": 1230, "daily_on": "2026-10-01", "bonus_on": "2026-10-01", "bonus_count": 3}', format('wallet %s', h->'wallet');
  assert h->'inventory' = '[{"qty": 7, "item_id": "bait_worm"}, {"qty": 1, "item_id": "rod_bamboo"}, {"qty": 2, "item_id": "seed_nep"}]',
    format('inventory %s', h->'inventory');
  assert h->'fishing_profile' = '{"rod": "rod_bamboo", "bait": "bait_worm", "bobber": "bobber_feather"}', 'profile';
  assert h->'fish'->0->>'species_id' = 'ca_tra' and h->'personal_bests'->0->>'weight_g' = '3150', 'fish and bests';
  assert h->'rice' = '[{"dry_kg": 70, "wet_kg": 0, "variety": "nep"}]', 'rice';
  assert h->'plots'->0->>'plot_no' = '3' and h->'plots'->0->>'sublease_price' = '300' and h->'plots'->0->>'kind' = 'private', 'plot';
  assert h->'leases'->0->>'plot_no' = '7' and h->'offers'->0->>'price' = '8000' and h->'crops'->0->>'variety' = 'nep'
     and h->'drying'->0->>'kg' = '70' and h->>'announcements' = '1', 'land, crops, drying, lines';
  assert public._ac_holdings(a5) = jsonb_build_object('wallet', null, 'inventory', '[]'::jsonb, 'fishing_profile', null,
           'fish', '[]'::jsonb, 'personal_bests', '[]'::jsonb, 'rice', '[]'::jsonb, 'plots', '[]'::jsonb, 'leases', '[]'::jsonb,
           'offers', '[]'::jsonb, 'crops', '[]'::jsonb, 'drying', '[]'::jsonb, 'announcements', 0), 'nothing held';

  -- the wipe (the admin RPC checks pending_wipe and takes the wallet lock first)
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (a6, 2, 'pending_wipe', now());
  snap := public._ac_wipe(a6, aroot);
  select * into w from public.anticheat_wipes where account_id = a6 order by id desc limit 1;
  assert snap = h and w.snapshot = h and w.wiped_by = aroot and w.username = (select username from public.accounts where id = a6),
    'the snapshot';
  assert (select delta = -1230 and balance = 0 and ref = 'wipe #' || w.id from public.coin_ledger
           where account_id = a6 and reason = 'wipe'), 'the last ledger row';
  assert not exists (select 1 from public.wallets where account_id = a6) and not exists (select 1 from public.inventory where account_id = a6)
     and not exists (select 1 from public.fishing_profiles where account_id = a6) and not exists (select 1 from public.casts where account_id = a6)
     and not exists (select 1 from public.fish where account_id = a6) and not exists (select 1 from public.personal_bests where account_id = a6)
     and not exists (select 1 from public.rice_stock where account_id = a6), 'the game data is gone';
  assert not exists (select 1 from public.chat_messages where about_account_id = a6)
     and exists (select 1 from public.chat_messages where account_id = a6 and body = 'a line of my own'), 'only the system lines go (D6)';
  assert (pg_temp.status(a6)).ban_state = 'wiped' and (pg_temp.status(a6)).wiped_at = now(), 'wiped';
  assert (select owner_id from public.field_plots where room_id = room and plot_no = 3) = a6, 'land waits for the sweep';

  -- pardon (§9.7)
  assert pg_temp.err(format('select public._ac_pardon(%L, %L)', a5, aroot)) = 'nothing to pardon', 'no strike, lock or ban';
  assert pg_temp.err(format('select public._ac_pardon(%L, %L)', gen_random_uuid(), aroot)) = 'nothing to pardon', 'no status row';
  update public.accounts set is_banned = true where id = a6;
  perform public._ac_pardon(a6, aroot);
  assert not (select is_banned from public.accounts where id = a6), 'unbanned';
  assert (select strikes = 0 and last_strike_at is null and last_strike_code is null and locked_until is null and ban_state is null
                 and banned_at is null and pardoned_at = now() and pardoned_by = aroot and wiped_at = now()
            from public.anticheat_status where account_id = a6), 'pardoned; wiped_at kept (R11)';
  update public.anticheat_config set mode = 'log';
end $$;

select 'anticheat flow smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` with `function public._ac_flag(uuid, text, unknown, jsonb, unknown, unknown, boolean) does not exist`.

- [ ] **Step 3: Write sections C–D**

**supabase/migrations/0015_anticheat.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- C. Tables (§8) ----------
-- Private, like every per-account table: RLS on, no policies, no grants — only the SECURITY DEFINER functions touch them.
create table if not exists public.anticheat_config (          -- exactly one row
  id boolean primary key default true check (id),
  mode text not null default 'log' check (mode in ('log', 'enforce')),
  mode_changed_at timestamptz not null default now(),
  mode_changed_by uuid references public.accounts(id) on delete set null
);
insert into public.anticheat_config (id) values (true) on conflict (id) do nothing;   -- a re-run never resets the mode

create table if not exists public.anticheat_status (          -- one row per account ever flagged or counted
  account_id uuid primary key references public.accounts(id) on delete cascade,
  strikes smallint not null default 0 check (strikes between 0 and 2),
  last_strike_at timestamptz,
  last_strike_code text,
  locked_until timestamptz,
  ban_state text check (ban_state in ('pending_wipe', 'wiped')),   -- null = not banned by the anti-cheat
  banned_at timestamptz,
  wiped_at timestamptz,                                          -- the last wipe; kept after a pardon (R11)
  pardoned_at timestamptz,
  pardoned_by uuid references public.accounts(id) on delete set null,
  hug_on date,
  hug_count smallint not null default 0,
  events_on date,
  events_count smallint not null default 0
);

create table if not exists public.anticheat_events (          -- the evidence log: append-only, never wiped, no FK
  id bigint generated always as identity primary key,
  account_id uuid not null,
  username text not null,                                       -- snapshot
  code text not null,                                           -- §7.2 / §7.4 codes
  outcome text not null check (outcome in ('soft', 'log_only', 'root', 'in_lock', 'strike_1', 'strike_2')),
  rpc text not null,
  room_id uuid,
  detail jsonb not null default '{}'::jsonb,                    -- inputs + server context; never a session token
  client text,                                                  -- X-Client-Info, at most 100 characters
  user_agent text,                                              -- User-Agent, at most 200 characters
  created_at timestamptz not null default now()
);
create index if not exists idx_ac_events_account on public.anticheat_events (account_id, created_at desc);
create index if not exists idx_ac_events_purge on public.anticheat_events (created_at)
  where outcome in ('soft', 'log_only', 'root', 'in_lock');

create table if not exists public.anticheat_wipes (           -- one row per confirmed wipe
  id bigint generated always as identity primary key,
  account_id uuid not null,
  username text not null,
  wiped_at timestamptz not null default now(),
  wiped_by uuid,                                                -- root; no FK, the row outlives accounts
  snapshot jsonb not null                                       -- _ac_holdings() at the moment of the wipe (§9.6)
);
create index if not exists idx_ac_wipes_account on public.anticheat_wipes (account_id, wiped_at desc);

alter table public.anticheat_config enable row level security;
alter table public.anticheat_status enable row level security;
alter table public.anticheat_events enable row level security;
alter table public.anticheat_wipes enable row level security;
revoke all on public.anticheat_config, public.anticheat_status, public.anticheat_events, public.anticheat_wipes
  from anon, authenticated;

-- The daily cast cap counts per Vietnam day (§6.3).
alter table public.fishing_profiles add column if not exists day_on date;
alter table public.fishing_profiles add column if not exists day_casts smallint not null default 0;

-- The 0013 reasons plus the last ledger row of a wipe (§9.6).
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe'));

-- ---------- D. Helpers (§9.2; private) ----------
-- Lock gate for the 35 game RPCs. Reads stay open, so the UI can show the countdown.
create or replace function public._ac_guard(p_account uuid) returns void
language plpgsql stable security definer set search_path = public, extensions
as $$
declare v_until timestamptz;
begin
  select locked_until into v_until from public.anticheat_status where account_id = p_account;
  if v_until > now() then
    raise exception 'account locked' using errcode = '42501', hint = 'anticheat',
      detail = ceil(extract(epoch from (v_until - now())))::int::text;
  end if;
end $$;

-- The account of a game RPC: the session, then the lock.
create or replace function public._ac_account(p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._auth_account(p_session_token);
begin
  perform public._ac_guard(v_account);
  return v_account;
end $$;

-- The account of a room game RPC: membership and the visit (_farm_auth), then the lock.
create or replace function public._ac_play(p_room_id uuid, p_session_token text) returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  perform public._ac_guard(v_account);
  return v_account;
end $$;

-- The running lock for the fishing state (R14): {until, code}, or null.
create or replace function public._ac_lock_state(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select case when s.locked_until > now() then jsonb_build_object('until', s.locked_until, 'code', s.last_strike_code) end
    from public.anticheat_status s where s.account_id = p_account
$$;

-- Record a flagged input (§9.2) and return the envelope. It never raises for the input itself (R1): the caller returns
-- the envelope, so PostgREST commits the evidence row and any strike. Hard signals escalate: strike 1 locks the game
-- actions for 5 minutes, strike 2 bans. Soft signals, log mode, root and anything during a lock or ban never escalate.
create or replace function public._ac_flag(p_account uuid, p_code text, p_rpc text, p_detail jsonb, p_room uuid default null,
                                           p_error text default null, p_hard boolean default true) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_mode text; v_name text; v_root boolean; s public.anticheat_status; v_outcome text; v_today date := public._vn_today();
        v_write boolean; v_h json; v_client text; v_agent text;
begin
  select mode into v_mode from public.anticheat_config where id;
  select username, is_root into v_name, v_root from public.accounts where id = p_account;
  -- one account escalates one call at a time
  insert into public.anticheat_status (account_id) values (p_account) on conflict (account_id) do nothing;
  select * into s from public.anticheat_status where account_id = p_account for update;
  -- a lone strike 1 expires after 30 days (D4)
  if s.strikes = 1 and s.last_strike_at <= now() - interval '30 days' and s.ban_state is null then
    update public.anticheat_status set strikes = 0 where account_id = p_account;
    s.strikes := 0;
  end if;
  v_outcome := case
    when not p_hard then 'soft'
    when v_mode is distinct from 'enforce' then 'log_only'
    when coalesce(v_root, false) then 'root'
    when s.ban_state is not null or s.locked_until > now() then 'in_lock'
    when s.strikes = 0 then 'strike_1'
    else 'strike_2' end;
  -- the evidence: every strike row, and at most 200 other rows per account and Vietnam day (R31)
  if v_outcome in ('strike_1', 'strike_2') then
    v_write := true;
  else
    if s.events_on is distinct from v_today then
      s.events_on := v_today;
      s.events_count := 0;
    end if;
    v_write := s.events_count < 200;
    if v_write then
      s.events_count := s.events_count + 1;
    end if;
    update public.anticheat_status set events_on = s.events_on, events_count = s.events_count where account_id = p_account;
  end if;
  if v_write then
    begin
      v_h := nullif(current_setting('request.headers', true), '')::json;
      v_client := left(v_h->>'x-client-info', 100);
      v_agent := left(v_h->>'user-agent', 200);
    exception when others then
      v_client := null;
      v_agent := null;
    end;
    insert into public.anticheat_events (account_id, username, code, outcome, rpc, room_id, detail, client, user_agent)
    values (p_account, coalesce(v_name, '?'), p_code, v_outcome, p_rpc, p_room, coalesce(p_detail, '{}'::jsonb), v_client, v_agent);
  end if;
  if v_outcome = 'strike_1' then
    update public.anticheat_status
       set strikes = 1, last_strike_at = now(), last_strike_code = p_code, locked_until = now() + interval '5 minutes'
     where account_id = p_account;
  elsif v_outcome = 'strike_2' then
    update public.anticheat_status
       set strikes = 2, last_strike_at = now(), last_strike_code = p_code, locked_until = null,
           ban_state = 'pending_wipe', banned_at = now()
     where account_id = p_account;
    update public.accounts set is_banned = true where id = p_account;
    delete from public.sessions where account_id = p_account;
  end if;
  -- the lazy purge (§8.4): soft, log-only, root and in-lock rows live 90 days
  delete from public.anticheat_events
   where id in (select id from public.anticheat_events
                 where outcome in ('soft', 'log_only', 'root', 'in_lock') and created_at < now() - interval '90 days'
                 order by created_at limit 500);
  return jsonb_build_object('anticheat', jsonb_build_object(
    'code', p_code,
    'strike', case v_outcome when 'strike_1' then 1 when 'strike_2' then 2 else 0 end,
    'error', p_error,
    'locked_until', case when v_outcome = 'strike_1' then now() + interval '5 minutes' end,
    'banned', v_outcome = 'strike_2',
    'server_now', now()));
end $$;

-- A won reel close to the time gate (§7.4): counted per Vietnam day, logged once, at the 20th (R20).
create or replace function public._ac_hug(p_account uuid, p_ratio numeric, p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_today date := public._vn_today(); v_count integer;
begin
  insert into public.anticheat_status as s (account_id, hug_on, hug_count) values (p_account, v_today, 1)
  on conflict (account_id) do update
    set hug_count = case when s.hug_on = v_today then s.hug_count + 1 else 1 end, hug_on = v_today
  returning hug_count into v_count;
  if v_count = 20 then
    perform public._ac_flag(p_account, 'reel_gate_hug', 'finish_cast',
                            jsonb_build_object('day', v_today, 'count', 20, 'ratio', p_ratio), p_room, null, false);
  end if;
end $$;

-- What a wipe removes (§9.6): the snapshot shape, and the preview in /admin.
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
    'crops', coalesce((select jsonb_agg(jsonb_build_object('room_id', c.room_id, 'plot_no', c.plot_no, 'variety', c.variety,
                                                           'transplant_at', c.transplant_at) order by c.room_id, c.plot_no)
                         from public.crops c where c.farmer_id = p_account), '[]'::jsonb),
    'drying', coalesce((select jsonb_agg(jsonb_build_object('room_id', d.room_id, 'slot', d.slot, 'variety', d.variety,
                                                            'kg', d.kg, 'ready_at', d.ready_at) order by d.room_id, d.slot)
                          from public.drying_slots d where d.account_id = p_account), '[]'::jsonb),
    'announcements', (select count(*) from public.chat_messages m where m.system and m.about_account_id = p_account))
$$;

-- The wipe of the owner (§9.6), under the wallet lock the admin RPC takes first: the snapshot, the last ledger row, the
-- game data of the account and its catch and land lines. Land is released by each room at its next sweep (step 0b).
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
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

-- Pardon (§9.7): unbanned, no strike, no lock; wiped_at stays (R11). No data comes back (R8).
create or replace function public._ac_pardon(p_account uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.anticheat_status;
begin
  select * into s from public.anticheat_status where account_id = p_account for update;
  if not found or (s.ban_state is null and not coalesce(s.locked_until > now(), false)
                   and not coalesce(s.strikes >= 1 and s.last_strike_at > now() - interval '30 days', false)) then
    raise exception 'nothing to pardon' using errcode = '22023';
  end if;
  update public.accounts set is_banned = false where id = p_account;
  update public.anticheat_status
     set strikes = 0, last_strike_at = null, last_strike_code = null, locked_until = null, ban_state = null, banned_at = null,
         pardoned_at = now(), pardoned_by = p_by
   where account_id = p_account;
end $$;

revoke all on function public._ac_guard(uuid) from public, anon, authenticated;
revoke all on function public._ac_account(text) from public, anon, authenticated;
revoke all on function public._ac_play(uuid, text) from public, anon, authenticated;
revoke all on function public._ac_lock_state(uuid) from public, anon, authenticated;
revoke all on function public._ac_flag(uuid, text, text, jsonb, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public._ac_hug(uuid, numeric, uuid) from public, anon, authenticated;
revoke all on function public._ac_holdings(uuid) from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
revoke all on function public._ac_pardon(uuid, uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: `v14 smoke ok`, `0015 twice ok`, `lyrics lockdown smoke ok`, the five v15 rows, then twice `anticheat names and queue smoke ok` and `anticheat flow smoke ok`, and `ALL OK`.

- [ ] **Step 5: Commit**

Commit message:

```text
feat(anticheat): 0015 evidence tables, the strike flow, wipe and pardon helpers

Sections C–D of 0015_anticheat.sql: the private anticheat_config (log mode first), anticheat_status, anticheat_events
and anticheat_wipes tables, the daily cast counters and the wipe ledger reason; the lock gate (_ac_guard, _ac_account,
_ac_play), _ac_flag with its outcomes, the 200-rows-a-day cap, the 90-day purge and the request headers, the gate-hug
counter, the lock state, and the holdings, wipe and pardon helpers.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0015_anticheat.sql tests/sql/anticheat-smoke.sql
git commit -F <message file>
```

---

### Task 3: Database — the fishing RPCs take the lock gate and the hard checks (`0015` section E, fishing)

**Files:**
- Modify: `supabase/migrations/0015_anticheat.sql` (append section E's fishing part)
- Modify: `tests/sql/anticheat-smoke.sql` (append part 3)
- Modify: `tests/sql/v15-smoke.sql` (log mode; the refusals that became envelopes)

**Interfaces:**
- Consumes: Task 2's `_ac_account`, `_ac_flag`, `_ac_hug`, `anticheat_config`, `fishing_profiles.day_on` / `day_casts`, the smoke helpers `pg_temp.err` (Task 1) and `pg_temp.errd` (Task 2); from `0012`–`0013`: `_wallet_lock`, `_fishing_profile`, `_fishing_state`, `_bucket_cap`, `_roll_rarity`, `_weight_text`, `_vn_today`, `shop_items.kind`; `finish_cast` of `0013` section H (v15.1 Task 21), which prices the catch with the room's fish price index (`fish_price_index`, `_fish_index`, `_fish_factor`).
- Produces (Postgres; same signatures, granted to anon and authenticated):
  - `claim_daily`, `dig_worms`, `set_loadout`, `sell_fish`, `release_fish` authenticate with `_ac_account` (a locked account gets `account locked`);
  - `buy_item(token, item, qty)`: `item not available` (raised) for an unknown or unpriced item; an item of another kind → soft `kind_mismatch` envelope with error `item not available`; bait `p_qty` null or outside 1–99, or gear `p_qty` ≠ 1 → hard `bad_qty`, error `invalid quantity`;
  - `start_cast(room, token)`: after the hourly cap, `daily cast limit` (53400, detail = seconds to the next Vietnam midnight) at 300 casts a Vietnam day; the 300th cast logs a soft `cast_daily_cap`;
  - `finish_cast(token, cast, success)`: `0013` section H's body (the catch keeps the room's fish price) with these changes only: the existing `too_early` loss logs `reel_too_fast` and carries its envelope in the lost answer (`{"result":"lost","why":"too_early","state":…,"anticheat":…}`); a won reel under 1.05 × the gate counts a gate hug; a rare+ catch line is posted with `system = true, about_account_id = <catcher>`.
- Produces (smoke): `pg_temp.angler(a uuid)` (20 worms, a fresh hourly window, nothing in hand); keys `f1`–`f3`, `b1`–`b3`; part 3 ends with `select 'anticheat fishing smoke ok'`. The v15 smoke starts with `update public.anticheat_config set mode = 'log';`.

- [ ] **Step 1: Write smoke part 3 and update the v15 smoke**

**tests/sql/anticheat-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- fishing (§6.3, §7.2–§7.4, §10.2): the daily cap, reel_too_fast, the shop checks, gate hugs, catch lines ----------
insert into smoke select 'f1', token from public.register('acf1_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'f2', token from public.register('acf2_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'f3', token from public.register('acf3_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'b' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('f1', 'f2', 'f3');
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
  from smoke where k in ('f1', 'f2', 'f3');
-- An angler with worms, the hourly window fresh and nothing in hand.
create or replace function pg_temp.angler(a uuid) returns void language sql as $$
  insert into public.inventory (account_id, item_id, qty) values (a, 'bait_worm', 20)
  on conflict (account_id, item_id) do update set qty = 20;
  insert into public.fishing_profiles (account_id) values (a) on conflict (account_id) do nothing;
  update public.fishing_profiles set window_start = now(), window_casts = 0, bait = 'bait_worm' where account_id = a;
  delete from public.fish where account_id = a;
$$;

do $$
declare f1 text := (select v from smoke where k = 'f1'); b1 uuid := (select v from smoke where k = 'b1')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; c jsonb; e jsonb; r jsonb;
begin
  perform pg_temp.angler(b1);
  -- the daily cap (§6.3): the 300th cast works and is logged once; the 301st is refused until the Vietnam midnight
  update public.fishing_profiles set day_on = public._vn_today(), day_casts = 298 where account_id = b1;
  c := public.start_cast(room, f1);
  assert (select day_casts from public.fishing_profiles where account_id = b1) = 299
     and not exists (select 1 from public.anticheat_events where account_id = b1), '299: nothing logged';
  c := public.start_cast(room, f1);
  assert (select day_casts from public.fishing_profiles where account_id = b1) = 300, '300 casts';
  assert (select outcome = 'soft' and code = 'cast_daily_cap' and rpc = 'start_cast' and room_id = room
                 and detail = jsonb_build_object('day', public._vn_today(), 'casts', 300)
            from public.anticheat_events where account_id = b1), 'cast_daily_cap logged';
  e := pg_temp.errd(format('select public.start_cast(%L, %L)', room, f1));
  assert e->>'message' = 'daily cast limit' and (e->>'detail')::int between 1 and 86400, format('daily limit %s', e);
  assert (select count(*) from public.anticheat_events where account_id = b1) = 1, 'the refusal is not logged';
  update public.fishing_profiles set day_on = public._vn_today() - 1 where account_id = b1;
  c := public.start_cast(room, f1);
  assert (select day_on = public._vn_today() and day_casts = 1 from public.fishing_profiles where account_id = b1), 'a new day';

  -- log mode: a won reel reported at once is reel_too_fast, logged only; the answer stays the lost one
  update public.anticheat_config set mode = 'log';
  r := public.finish_cast(f1, (c->>'cast_id')::uuid, true);
  assert r->>'result' = 'lost' and r->>'why' = 'too_early' and r->'state'->>'coins' is not null, format('lost %s', r);
  assert r->'anticheat'->>'code' = 'reel_too_fast' and (r->'anticheat'->>'strike')::int = 0 and r->'anticheat'->'error' = 'null',
    format('envelope %s', r->'anticheat');
  assert (select outcome = 'log_only' and rpc = 'finish_cast' and room_id = room
                 and detail ?& array['cast_id', 'species_id', 'bite_at', 'min_reel_ms', 'finished_at', 'ratio']
                 and detail->>'cast_id' = c->>'cast_id'
            from public.anticheat_events where account_id = b1 and code = 'reel_too_fast'), 'the reel_too_fast row';
  assert not exists (select 1 from public.casts where account_id = b1), 'the cast is consumed';

  -- the fishing shop: bad quantities are hard, farm items soft, unknown and unpriced items plain refusals
  update public.wallets set coins = 5000 where account_id = b1;
  foreach e in array array[jsonb_build_array('bait_shrimp', 500), jsonb_build_array('bait_shrimp', 0),
                           jsonb_build_array('bait_shrimp', null), jsonb_build_array('rod_bamboo', 2),
                           jsonb_build_array('bucket_small', 0)] loop
    r := public.buy_item(f1, e->>0, (e->>1)::int);
    assert r = jsonb_build_object('anticheat', jsonb_build_object('code', 'bad_qty', 'strike', 0, 'error', 'invalid quantity',
                                  'locked_until', null, 'banned', false, 'server_now', now())), format('bad_qty %s: %s', e, r);
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = b1 and code = 'bad_qty' and outcome = 'log_only') = 5,
    'five bad_qty rows';
  assert (select detail = '{"item": "bait_shrimp", "qty": 500}' from public.anticheat_events
           where account_id = b1 and code = 'bad_qty' order by id limit 1), 'bad_qty detail';
  r := public.buy_item(f1, 'seed_short', 5);
  assert r->'anticheat'->>'code' = 'kind_mismatch' and r->'anticheat'->>'error' = 'item not available', 'kind_mismatch';
  assert (select outcome = 'soft' and detail = '{"item": "seed_short", "kind": "seed"}' from public.anticheat_events
           where account_id = b1 and code = 'kind_mismatch'), 'soft kind_mismatch row';
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', f1, 'no_such_item')) = 'item not available', 'unknown';
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', f1, 'rod_wood')) = 'item not available', 'unpriced';
  assert not exists (select 1 from public.anticheat_events where account_id = b1 and detail->>'item' in ('no_such_item', 'rod_wood')),
    'plain refusals are not logged';
  assert (select coins from public.wallets where account_id = b1) = 5000, 'nothing was bought';
  r := public.buy_item(f1, 'bait_shrimp', 3);
  assert (r->'state'->'bait'->>'bait_shrimp')::int = 3, 'an honest purchase';
end $$;

do $$
declare f2 text := (select v from smoke where k = 'f2'); b2 uuid := (select v from smoke where k = 'b2')::uuid;
        f3 text := (select v from smoke where k = 'f3'); b3 uuid := (select v from smoke where k = 'b3')::uuid;
        room uuid := (select v from smoke where k = 'room')::uuid; c jsonb; r jsonb; e jsonb; call text;
begin
  update public.anticheat_config set mode = 'enforce';
  perform pg_temp.angler(b2);
  -- no false positives in enforce (§7.3): give up, a double finish, a finish after expiry, a won reel at the gate
  c := public.start_cast(room, f2);
  r := public.finish_cast(f2, (c->>'cast_id')::uuid, false);
  assert r->>'why' = 'gave_up' and r->'anticheat' is null, 'gave up';
  assert pg_temp.err(format('select public.finish_cast(%L, %L, true)', f2, c->>'cast_id')) = 'cast not found', 'double finish';
  c := public.start_cast(room, f2);
  update public.casts set expires_at = now() - interval '1 second' where account_id = b2;
  r := public.finish_cast(f2, (c->>'cast_id')::uuid, true);
  assert r->>'why' = 'expired' and r->'anticheat' is null, 'expired';
  c := public.start_cast(room, f2);
  update public.casts set species_id = 'ca_tra', weight_g = 3150, bite_at = now() - make_interval(secs => min_reel_ms / 1000.0)
   where account_id = b2;
  r := public.finish_cast(f2, (c->>'cast_id')::uuid, true);
  assert r->>'result' = 'caught' and r->'anticheat' is null, 'a won reel at ratio 1.0 is caught';
  assert (select hug_count = 1 and hug_on = public._vn_today() from public.anticheat_status where account_id = b2), 'a gate hug';
  assert (select system and account_id is null and username = 'Ao cá' and about_account_id = b2
            from public.chat_messages where room_id = room and body like '[catch:' || b2 || '|ca_tra|3150]%'), 'a system catch line';
  assert not exists (select 1 from public.anticheat_events where account_id = b2), 'nothing logged';
  r := public.buy_item(f2, 'seed_short', 5);
  assert (r->'anticheat'->>'strike')::int = 0 and (select outcome from public.anticheat_events where account_id = b2) = 'soft'
     and not exists (select 1 from public.anticheat_status where account_id = b2 and locked_until is not null),
    'the old v14 client buying a farm item: soft only';

  -- enforce: reel_too_fast is strike 1, the lock stops every fishing RPC with the seconds left
  perform pg_temp.angler(b3);
  c := public.start_cast(room, f3);
  r := public.finish_cast(f3, (c->>'cast_id')::uuid, true);
  assert r->>'why' = 'too_early' and (r->'anticheat'->>'strike')::int = 1
     and (r->'anticheat'->>'locked_until')::timestamptz = now() + interval '5 minutes', format('strike 1 %s', r->'anticheat');
  foreach call in array array[
    format('select public.claim_daily(%L)', f3), format('select public.dig_worms(%L)', f3),
    format('select public.buy_item(%L, %L, 1)', f3, 'bait_shrimp'),
    format('select public.set_loadout(%L, %L, %L, %L)', f3, 'rod_wood', 'bobber_feather', 'bait_worm'),
    format('select public.start_cast(%L, %L)', room, f3), format('select public.finish_cast(%L, %L, false)', f3, gen_random_uuid()),
    format('select public.sell_fish(%L, %L)', f3, array[gen_random_uuid()]), format('select public.release_fish(%L, %L)', f3, gen_random_uuid())] loop
    e := pg_temp.errd(call);
    assert e->>'message' = 'account locked' and e->>'hint' = 'anticheat' and (e->>'detail')::int = 300, format('%s: %s', call, e);
  end loop;
  assert public.fishing_state(f3)->>'coins' is not null and public.fishing_board(room, f3)->>'my_rank' is not null, 'reads stay open';
  update public.anticheat_config set mode = 'log';
end $$;

select 'anticheat fishing smoke ok' as result;
```

**tests/sql/v15-smoke.sql — edit 1 of 2.** Replace:

```sql
-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0013, from the repo
-- root (the crop fixtures are read with \copy, and the last section re-runs 0013 with \i). Every check is an ASSERT; the
-- first failure stops psql (ON_ERROR_STOP).
\set ON_ERROR_STOP on
```

with:

```sql
-- tests/sql/v15-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0015, from the repo
-- root (the crop fixtures are read with \copy, and the last section re-runs 0013 with \i). Every check is an ASSERT; the
-- first failure stops psql (ON_ERROR_STOP). A refusal the anti-cheat reads as tampering comes back as an envelope
-- (0015): its `error` is checked instead.
\set ON_ERROR_STOP on

-- The tampered calls below are only recorded: log mode locks nobody.
update public.anticheat_config set mode = 'log';
```

**tests/sql/v15-smoke.sql — edit 2 of 2.** Replace:

```sql
  insert into public.wallets (account_id, coins) values (a1, 1000) on conflict (account_id) do update set coins = 1000;
  assert pg_temp.err(format('select public.buy_item(%L, %L, 1)', t1, 'seed_short')) = 'item not available', 'seeds are not fishing gear';
  assert pg_temp.err(format('select public.buy_item(%L, %L)', t1, 'fert_urea')) = 'item not available', 'nor fertilizer';
  insert into public.inventory (account_id, item_id, qty) values (a1, 'seed_nep', 2), (a1, 'rod_bamboo', 1)
```

with:

```sql
  insert into public.wallets (account_id, coins) values (a1, 1000) on conflict (account_id) do update set coins = 1000;
  assert public.buy_item(t1, 'seed_short', 1)->'anticheat'->>'error' = 'item not available', 'seeds are not fishing gear';
  assert public.buy_item(t1, 'fert_urea')->'anticheat'->>'error' = 'item not available', 'nor fertilizer';
  insert into public.inventory (account_id, item_id, qty) values (a1, 'seed_nep', 2), (a1, 'rod_bamboo', 1)
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: `FAILED: tests/sql/v15-smoke.sql` with `ERROR:  item not available` — `buy_item` still raises for a farm item instead of answering with an envelope.

- [ ] **Step 3: Write the fishing part of section E**

**supabase/migrations/0015_anticheat.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- E. Guarded RPCs (§10.2, §10.3) ----------
-- Every game RPC runs _ac_account or _ac_play (the session, then the lock), then its hard checks, then its body. A flagged
-- input returns the envelope of _ac_flag instead of raising (R1). Signatures stay; each grant is repeated.

-- Fishing (bodies from 0012; buy_item, and finish_cast with the fish price index, from 0013).
create or replace function public.claim_daily(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; v_today date := public._vn_today();
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  if w.daily_on is not distinct from v_today then
    return jsonb_build_object('claimed', false, 'amount', 0, 'state', public._fishing_state(v_account));
  end if;
  update public.wallets set daily_on = v_today where account_id = v_account;
  perform public._pay(v_account, 20, 'daily', v_today::text);
  return jsonb_build_object('claimed', true, 'amount', 20, 'state', public._fishing_state(v_account));
end; $$;

create or replace function public.dig_worms(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; v_total integer; v_cap integer; v_gain integer;
begin
  v_account := public._ac_account(p_session_token);
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

-- A farm item is a soft kind_mismatch (the old v14 client lists them as bait, §7.3); then the quantity is a hard bad_qty:
-- bait 1–99, gear exactly 1. An unknown or unpriced item still raises 'item not available', unlogged.
create or replace function public.buy_item(p_session_token text, p_item_id text, p_qty integer default 1) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; w public.wallets; p public.fishing_profiles; it public.shop_items; v_cost integer; v_equipped integer;
begin
  v_account := public._ac_account(p_session_token);
  w := public._wallet_lock(v_account);
  p := public._fishing_profile(v_account);
  select * into it from public.shop_items where id = p_item_id;
  if not found or it.price is null then
    raise exception 'item not available' using errcode = '22023';
  end if;
  if it.kind not in ('rod','bobber','bait','bait_box','bucket') then
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if (it.kind = 'bait' and (p_qty is null or p_qty < 1 or p_qty > 99)) or (it.kind <> 'bait' and p_qty is distinct from 1) then
    return public._ac_flag(v_account, 'bad_qty', 'buy_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
  end if;
  if it.kind = 'bait' then
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
  v_account := public._ac_account(p_session_token);
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

-- The daily cap (§6.3): 300 casts per Vietnam day after the hourly 40; the 300th cast is logged as a soft signal.
create or replace function public.start_cast(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; p public.fishing_profiles; rod public.shop_items; bob public.shop_items; sp public.fish_species;
        v_rarity smallint; v_weight integer; v_bite integer; v_window integer; v_min_reel integer; v_id uuid;
        v_switched boolean := false; v_bucket integer; v_today date := public._vn_today(); v_day integer;
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  v_account := public._ac_account(p_session_token);
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
  -- 1b. daily cap: the seconds until the next Vietnam midnight
  if p.day_on = v_today and p.day_casts >= 300 then
    raise exception 'daily cast limit' using errcode = '53400',
      detail = ceil(extract(epoch from ((v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' - now())))::int::text;
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
  -- 5. roll the fish (v14 spec §7.2)
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
  update public.fishing_profiles
     set window_casts = window_casts + 1,
         day_casts = case when day_on = v_today then day_casts + 1 else 1 end,
         day_on = v_today
   where account_id = v_account
  returning day_casts into v_day;
  if v_day = 300 then
    perform public._ac_flag(v_account, 'cast_daily_cap', 'start_cast', jsonb_build_object('day', v_today, 'casts', 300),
                            p_room_id, null, false);
  end if;
  return jsonb_build_object(
    'cast_id', v_id, 'bite_ms', v_bite, 'window_ms', v_window, 'difficulty', sp.difficulty,
    'min_reel_ms', v_min_reel, 'zone_pct', coalesce(rod.zone_pct, 25),
    'rarity', case when bob.shows_rarity then v_rarity end,
    'bait_switched', v_switched,
    'state', public._fishing_state(v_account));
end; $$;

-- finish_cast is 0013 section H's, which prices the catch with the room's fish price index. A won reel reported before
-- the time gate is the hard reel_too_fast (§7.2): still the lost answer, plus the envelope.
-- A catch within 5 % of the gate counts a gate hug (§7.4). The catch line is a system line about the catcher (§6.1).
create or replace function public.finish_cast(p_session_token text, p_cast_id uuid, p_success boolean) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; c public.casts; sp public.fish_species; v_fish uuid; v_price integer; v_prev integer;
        v_record boolean := false; v_name text; v_why text; v_ratio numeric; v_ac jsonb;
        r public.fish_price_index; v_mult numeric := 1; v_factor numeric := 1;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  -- single use: the cast is gone whatever happens next (lost outcomes return instead of raising, so the delete stays)
  delete from public.casts where account_id = v_account and id = p_cast_id returning * into c;
  if not found then
    raise exception 'cast not found' using errcode = '22023';
  end if;
  v_ratio := extract(epoch from (now() - c.bite_at)) * 1000 / c.min_reel_ms;
  if now() > c.expires_at then
    v_why := 'expired';
  elsif not coalesce(p_success, false) then
    v_why := 'gave_up';
  elsif now() < c.bite_at + make_interval(secs => 0.9 * c.min_reel_ms / 1000.0) then   -- the existing gate, unchanged
    v_why := 'too_early';
    v_ac := public._ac_flag(v_account, 'reel_too_fast', 'finish_cast',
              jsonb_build_object('cast_id', c.id, 'species_id', c.species_id, 'bite_at', c.bite_at,
                                 'min_reel_ms', c.min_reel_ms, 'finished_at', now(), 'ratio', round(v_ratio, 3)),
              c.room_id);
  elsif (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account) then
    v_why := 'full';
  end if;
  if v_why is not null then
    return jsonb_build_object('result', 'lost', 'why', v_why, 'state', public._fishing_state(v_account))
           || coalesce(v_ac, '{}'::jsonb);
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
  if v_ratio < 1.05 then
    perform public._ac_hug(v_account, round(v_ratio, 3), c.room_id);
  end if;
  -- rare+ catches are announced in the room's chat (v14 spec §8.5), as a system line about the catcher
  if sp.rarity >= 3 and c.room_id is not null and exists (select 1 from public.rooms where id = c.room_id) then
    select username into v_name from public.accounts where id = v_account;
    insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
    values (c.room_id, null, 'Ao cá',
            format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', v_account, sp.id, c.weight_g, v_name, sp.name,
                   public._weight_text(c.weight_g), (array['Thường','Khá','Hiếm','Quý','Huyền thoại'])[sp.rarity]),
            true, v_account);
    delete from public.chat_messages
     where room_id = c.room_id
       and id not in (select id from public.chat_messages where room_id = c.room_id order by created_at desc limit 200);
  end if;
  return jsonb_build_object('result', 'caught',
    'fish', jsonb_build_object('id', v_fish, 'species_id', sp.id, 'weight_g', c.weight_g, 'price', v_price, 'rarity', sp.rarity),
    'record', v_record,
    'state', public._fishing_state(v_account));
end; $$;

create or replace function public.sell_fish(p_session_token text, p_fish_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v_count integer; v_sum integer;
begin
  v_account := public._ac_account(p_session_token);
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
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  delete from public.fish where account_id = v_account and id = p_fish_id;
  if not found then
    raise exception 'fish not found' using errcode = '22023';
  end if;
  return jsonb_build_object('state', public._fishing_state(v_account));
end; $$;

grant execute on function public.claim_daily(text) to anon, authenticated;
grant execute on function public.dig_worms(text) to anon, authenticated;
grant execute on function public.buy_item(text, text, integer) to anon, authenticated;
grant execute on function public.set_loadout(text, text, text, text) to anon, authenticated;
grant execute on function public.start_cast(uuid, text) to anon, authenticated;
grant execute on function public.finish_cast(text, uuid, boolean) to anon, authenticated;
grant execute on function public.sell_fish(text, uuid[]) to anon, authenticated;
grant execute on function public.release_fish(text, uuid) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: as in Task 2 plus `anticheat fishing smoke ok` after `anticheat flow smoke ok` (both anti-cheat runs), and `ALL OK`. `v15 fish price smoke ok` shows the re-created `finish_cast` still prices catches with the room's index.

- [ ] **Step 5: Commit**

Commit message:

```text
feat(anticheat): 0015 guards the fishing RPCs

Section E, fishing: the eight fishing RPCs take the lock gate; buy_item logs farm items as a soft kind_mismatch and a
quantity no shop sends as a hard bad_qty; start_cast adds the 300-casts-a-day cap and logs the 300th cast; finish_cast,
re-created from 0013 section H so the catch keeps the room's fish price, reports a reel won before the time gate as
reel_too_fast, counts gate hugs and posts catch lines as system lines. The v15 smoke runs in log mode and reads the
envelope of the refusals that became tamper signals.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0015_anticheat.sql tests/sql/anticheat-smoke.sql tests/sql/v15-smoke.sql
git commit -F <message file>
```

---

### Task 4: Database — the farm and land RPCs; the guard regression (`0015` section E, farm)

**Files:**
- Modify: `supabase/migrations/0015_anticheat.sql` (append section E's farm part)
- Create: `tests/sql/anticheat-guards.sql`
- Modify: `tests/sql/anticheat-smoke.sql` (append part 4, which ends with `\i tests/sql/anticheat-guards.sql`)
- Modify: `tests/sql/v15-smoke.sql` (the four refusals that became envelopes)

**Interfaces:**
- Consumes: Task 2's `_ac_account`, `_ac_play`, `_ac_flag`, `anticheat_config`, `anticheat_status`, `anticheat_events`; Task 3's guarded fishing RPCs (the guard regression calls them); the smoke helpers `pg_temp.err`, `pg_temp.errd`, `pg_temp.status`, `pg_temp.last_outcome`; from `0013`: the cores `_farm_do_rent`, `_farm_do_buy_plot`, `_farm_do_sell_to_village`, `_farm_do_list`, `_farm_do_buy_listed`, `_farm_do_offer`, `_farm_do_withdraw_offer`, `_farm_do_decline_offer`, `_farm_do_accept_offer`, `_farm_do_set_sublease`, `_farm_do_rent_sublease`, `_farm_do_abandon`, `_farm_do_prepare`, `_farm_do_fertilize`, `_farm_do_soak`, `_farm_do_sow`, `_farm_do_begin_work`, `_farm_do_transplant`, `_farm_do_water`, `_farm_do_spray`, `_farm_do_pick_snails`, `_farm_do_harvest`, `_farm_do_dry_start`, `_farm_do_dry_collect` (each `(room, account, …, now) → jsonb`), `_land_sale`, `_variety(text) → rice_varieties`, `_pay`, `_farm_mine`, `_wallet_lock`, `land_offers(id, room_id, plot_no, buyer_id, …)`, `field_plots(room_id, plot_no, owner_id, …)`, `rice_stock`, `shop_items(id, kind, price)`, `wallets`.
- Produces (Postgres; same signatures, granted to anon and authenticated):
  - the 24 room wrappers (`rent_plot`, `buy_plot`, `sell_plot_to_village`, `list_plot`, `buy_listed_plot`, `offer_plot`, `withdraw_offer`, `decline_offer`, `accept_offer`, `set_sublease`, `rent_sublease`, `abandon_crop`, `prepare_plot`, `apply_fertilizer`, `soak_seed`, `sow_seed`, `begin_work`, `transplant`, `water`, `spray`, `pick_snails`, `harvest`, `dry_start`, `dry_collect`) are plpgsql: `_ac_play`, then the hard checks, then the unchanged core with `now()`. Hard: `bad_plot` (`p_plot` null or outside 1–10, error `invalid plot`), `bad_price` (`list_plot` a non-null price outside 1–5 000 000, `offer_plot` a null price or one outside 1–5 000 000, `set_sublease` a non-null price outside 1–100 000 — v15.1 Task 20's caps; `invalid price`), `foreign_offer` (`withdraw_offer` of this room's offer by another buyer, `decline_offer` / `accept_offer` on a plot the caller does not own; `offer not found` / `not your plot`), `bad_work` (not `transplant` / `harvest`; `invalid work`), `quality_range` (`transplant` / `harvest` quality null, NaN or outside 0.9–1.1; `invalid quality`), `bad_water` (`p_delta` not ±1; `invalid quantity`), `bad_qty` (`dry_start` kg null or < 1; `invalid quantity`), `bad_slot` (`dry_collect` slot outside 1–4; `invalid slot`). Soft: `kind_mismatch` for an existing item of another kind in `apply_fertilizer`, `soak_seed`, `spray` (`invalid item`);
  - `sell_rice(token, variety, dry, kg)`: `_ac_account`; `bad_qty` (kg null or < 1, or `dry` null; `invalid quantity`) before the variety check;
  - `buy_farm_item(token, item, qty)`: `_ac_account`; an unknown or unpriced item raises `item not available`; a fishing item is a soft `kind_mismatch` (`item not available`); a quantity outside 1–99 a hard `bad_qty` (`invalid quantity`); more than 99 held stays the raised `invalid quantity`;
  - `claim_farm_gift(token)`: `_ac_account`;
  - `_land_sale(room, plot, buyer, price, now)` (private): the sale's chat line is `system = true, about_account_id = <buyer>`.
  - `tests/sql/anticheat-guards.sql` (self-contained, superuser): 1. static, deny by default — every `SECURITY DEFINER` function in `public` that `anon` may execute is on its allowlist or its body calls `_ac_account(` / `_ac_play(`; 2. dynamic — a locked account gets `account locked` (detail = whole seconds, hint `anticheat`) from all 35 game RPCs, and `fishing_state`, `field_state`, `fishing_board` and `touch_room` still answer; it ends with `select 'anticheat guards ok'`.
- Produces (smoke): `pg_temp.set_coins(a uuid, n integer)`, `pg_temp.env(r jsonb, code text, strike int, error text) → boolean` (the answer is that envelope and nothing else); keys `g1`–`g5`, `h1`–`h5`, `froom`, `o5` (the fixtures pay Task 20's prices: a rent is 10 000 xu, a plot 800 000); part 4 ends with `select 'anticheat farm smoke ok'` and then `\i tests/sql/anticheat-guards.sql`. Tasks 5 and 6 insert their parts before that `\i` line.

- [ ] **Step 1: Write the guard regression, smoke part 4 and the v15 smoke changes**

Create `tests/sql/anticheat-guards.sql` with exactly:

```sql
-- tests/sql/anticheat-guards.sql — the guard regression (anti-cheat spec §15.1, R23). Self-contained: run it as the
-- superuser on the throwaway PostgreSQL cluster after 0015 and after every later migration (anticheat-smoke.sql ends
-- with it). A new game RPC that does not call _ac_account or _ac_play fails the static check until it is guarded or,
-- when it is not a game action, put on the allowlist below; a new guarded RPC joins the dynamic loop.
\set ON_ERROR_STOP on

-- 1. Static, deny by default: every SECURITY DEFINER function in public that anon may execute is on the allowlist or
--    calls the lock gate.
do $$
declare bad text;
begin
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ' order by p.proname) into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in (
       'register', 'login', 'me', 'logout',
       'create_room', 'join_room', 'rename_room', 'kick_member', 'assign_dj', 'transfer_admin', 'set_play_mode',
       'update_room_settings', 'touch_room',
       'add_queue_item', 'add_queue_items', 'advance_queue', 'set_playback', 'seek_playback', 'reorder_item', 'bump_to_top',
       'delete_item', 'approve_queue_item', 'approve_all_pending', 'reject_queue_item',
       'send_chat_message', 'delete_chat_message',
       'submit_feedback', 'list_feedback', 'set_feedback_status', 'delete_feedback',
       'admin_list_rooms', 'admin_delete_room', 'admin_list_accounts', 'admin_set_ban', 'admin_delete_account', 'admin_stats',
       'admin_anticheat_list', 'admin_anticheat_account', 'admin_anticheat_resolve', 'admin_anticheat_set_mode',
       'save_character', 'upsert_video_lyrics', 'update_video_lyric_offset',
       'fishing_state', 'fishing_board', 'field_state')
     and p.prosrc !~ '_ac_(account|play)\(';
  assert bad is null, 'unguarded: ' || bad;
end $$;

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 35 game RPCs, and
--    the four reads still answer.
create temp table guards (k text primary key, v text);
insert into guards select 't', token from public.register('guard_' || floor(random() * 1e9)::text, 'pw123456');
insert into guards select 'room', room_id::text from public.create_room('Guards', 'pw', (select v from guards where k = 't'));
insert into public.anticheat_status (account_id, locked_until)
values (public._auth_account((select v from guards where k = 't')), now() + interval '5 minutes')
on conflict (account_id) do update set locked_until = excluded.locked_until;

create or replace function pg_temp.guard_err(p_sql text) returns text language plpgsql as $$
declare v_msg text; v_detail text; v_hint text;
begin
  execute p_sql;
  return 'no error';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return v_msg || '|' || coalesce(v_hint, '') || '|' || case when v_detail ~ '^[0-9]+$' then 'seconds' else coalesce(v_detail, '') end;
end $$;

do $$
declare t text := (select v from guards where k = 't'); room uuid := (select v from guards where k = 'room')::uuid;
        o uuid := gen_random_uuid(); call text; e text; n int := 0;
begin
  foreach call in array array[
    -- fishing (8)
    format('select public.claim_daily(%L)', t),
    format('select public.dig_worms(%L)', t),
    format('select public.buy_item(%L, %L, 1)', t, 'bait_shrimp'),
    format('select public.set_loadout(%L, %L, %L, %L)', t, 'rod_wood', 'bobber_feather', 'bait_worm'),
    format('select public.start_cast(%L, %L)', room, t),
    format('select public.finish_cast(%L, %L, true)', t, o),
    format('select public.sell_fish(%L, %L)', t, array[o]),
    format('select public.release_fish(%L, %L)', t, o),
    -- farm and land: the 24 room actions
    format('select public.rent_plot(%L, %L, 5)', room, t),
    format('select public.buy_plot(%L, %L, 1)', room, t),
    format('select public.sell_plot_to_village(%L, %L, 1)', room, t),
    format('select public.list_plot(%L, %L, 1, 9000)', room, t),
    format('select public.buy_listed_plot(%L, %L, 1, 9000)', room, t),
    format('select public.offer_plot(%L, %L, 1, 5000)', room, t),
    format('select public.withdraw_offer(%L, %L, %L)', room, t, o),
    format('select public.decline_offer(%L, %L, %L)', room, t, o),
    format('select public.accept_offer(%L, %L, %L)', room, t, o),
    format('select public.set_sublease(%L, %L, 1, 300)', room, t),
    format('select public.rent_sublease(%L, %L, 1, 300)', room, t),
    format('select public.abandon_crop(%L, %L, 5)', room, t),
    format('select public.prepare_plot(%L, %L, 5)', room, t),
    format('select public.apply_fertilizer(%L, %L, 5, %L)', room, t, 'fert_urea'),
    format('select public.soak_seed(%L, %L, 5, %L)', room, t, 'seed_short'),
    format('select public.sow_seed(%L, %L, 5)', room, t),
    format('select public.begin_work(%L, %L, 5, %L)', room, t, 'transplant'),
    format('select public.transplant(%L, %L, 5, 1)', room, t),
    format('select public.water(%L, %L, 5, 1)', room, t),
    format('select public.spray(%L, %L, 5, %L)', room, t, 'spray_insect'),
    format('select public.pick_snails(%L, %L, 5)', room, t),
    format('select public.harvest(%L, %L, 5, 1)', room, t),
    format('select public.dry_start(%L, %L, %L, 10)', room, t, 'short'),
    format('select public.dry_collect(%L, %L, 1)', room, t),
    -- and the account-only three
    format('select public.sell_rice(%L, %L, true, 1)', t, 'short'),
    format('select public.buy_farm_item(%L, %L, 1)', t, 'fert_urea'),
    format('select public.claim_farm_gift(%L)', t)] loop
    n := n + 1;
    e := pg_temp.guard_err(call);
    assert e = 'account locked|anticheat|seconds', format('%s → %s', call, e);
  end loop;
  assert n = 35, format('%s guarded calls', n);
  perform public.fishing_state(t);
  perform public.fishing_board(room, t);
  perform public.field_state(room, t);
  perform public.touch_room(room, t);
end $$;

select 'anticheat guards ok' as result;
```

**tests/sql/anticheat-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- farm and land (§7.2, §7.3, §10.3): the hard signals, the lock, foreign offers, no false positives ----------
insert into smoke select 'g' || n, token from generate_series(1, 5) n,
  lateral public.register('acg' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'h' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('g1', 'g2', 'g3', 'g4', 'g5');
insert into smoke select 'froom', room_id::text from public.create_room('Đồng gian lận', 'pw', (select v from smoke where k = 'g1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'froom')::uuid), 'pw', v)
  from smoke where k in ('g2', 'g3', 'g4', 'g5');
create or replace function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
-- An envelope with this code, strike and error, and nothing else in the answer.
create or replace function pg_temp.env(r jsonb, code text, strike int, error text) returns boolean language sql
as $$ select r->'anticheat'->>'code' = code and (r->'anticheat'->>'strike')::int = strike and r->'anticheat'->>'error' = error
             and r - 'anticheat' = '{}'::jsonb $$;

-- g1 farms village plot 8 (prepared, flooded); g4 owns plot 1; g5 offers on it
do $$
declare h1 uuid := (select v from smoke where k = 'h1')::uuid; h4 uuid := (select v from smoke where k = 'h4')::uuid;
        h5 uuid := (select v from smoke where k = 'h5')::uuid; room uuid := (select v from smoke where k = 'froom')::uuid;
        t timestamptz := now();
begin
  perform pg_temp.set_coins(h1, 10750);
  perform public._farm_do_rent(room, h1, 8, t);
  perform public._farm_do_prepare(room, h1, 8, t);
  perform pg_temp.set_coins(h4, 801000);
  perform public._farm_do_buy_plot(room, h4, 1, t);
  perform pg_temp.set_coins(h5, 20000);
  perform public._farm_do_offer(room, h5, 1, 5000, t);
  insert into smoke select 'o5', id::text from public.land_offers where room_id = room and buyer_id = h5;
end $$;

-- Every hard signal of the farm and the shops (§7.2) as g1 sends it, with the refusal it stands for.
create temp table hard_calls as
select v.code, v.error, v.call
  from (select (select v from smoke where k = 'froom') as room, (select v from smoke where k = 'g1') as g1,
               (select v from smoke where k = 'o5') as o5) s,
       lateral (values
         ('bad_plot', 'invalid plot', format('select public.rent_plot(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.buy_plot(%L, %L, 11)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.sell_plot_to_village(%L, %L, null)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.list_plot(%L, %L, -1, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.buy_listed_plot(%L, %L, 11, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.offer_plot(%L, %L, 0, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.set_sublease(%L, %L, 11, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.rent_sublease(%L, %L, 0, 100)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.abandon_crop(%L, %L, 99)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.prepare_plot(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.apply_fertilizer(%L, %L, 0, %L)', s.room, s.g1, 'fert_urea')),
         ('bad_plot', 'invalid plot', format('select public.soak_seed(%L, %L, 0, %L)', s.room, s.g1, 'seed_nep')),
         ('bad_plot', 'invalid plot', format('select public.sow_seed(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.begin_work(%L, %L, 0, %L)', s.room, s.g1, 'transplant')),
         ('bad_plot', 'invalid plot', format('select public.transplant(%L, %L, 0, 1)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.water(%L, %L, 0, 1)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.spray(%L, %L, 0, %L)', s.room, s.g1, 'spray_insect')),
         ('bad_plot', 'invalid plot', format('select public.pick_snails(%L, %L, 0)', s.room, s.g1)),
         ('bad_plot', 'invalid plot', format('select public.harvest(%L, %L, 0, 1)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.list_plot(%L, %L, 1, 0)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.list_plot(%L, %L, 1, 5000001)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.set_sublease(%L, %L, 1, 100001)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.offer_plot(%L, %L, 1, null)', s.room, s.g1)),
         ('bad_price', 'invalid price', format('select public.offer_plot(%L, %L, 1, 0)', s.room, s.g1)),
         ('bad_slot', 'invalid slot', format('select public.dry_collect(%L, %L, 0)', s.room, s.g1)),
         ('bad_slot', 'invalid slot', format('select public.dry_collect(%L, %L, 5)', s.room, s.g1)),
         ('bad_slot', 'invalid slot', format('select public.dry_collect(%L, %L, null)', s.room, s.g1)),
         ('bad_water', 'invalid quantity', format('select public.water(%L, %L, 8, 5)', s.room, s.g1)),
         ('bad_water', 'invalid quantity', format('select public.water(%L, %L, 8, 0)', s.room, s.g1)),
         ('bad_water', 'invalid quantity', format('select public.water(%L, %L, 8, null)', s.room, s.g1)),
         ('bad_work', 'invalid work', format('select public.begin_work(%L, %L, 8, %L)', s.room, s.g1, 'dig')),
         ('bad_work', 'invalid work', format('select public.begin_work(%L, %L, 8, null)', s.room, s.g1)),
         ('quality_range', 'invalid quality', format('select public.transplant(%L, %L, 8, %L)', s.room, s.g1, 'NaN')),
         ('quality_range', 'invalid quality', format('select public.transplant(%L, %L, 8, 1.2)', s.room, s.g1)),
         ('quality_range', 'invalid quality', format('select public.transplant(%L, %L, 8, 0.8)', s.room, s.g1)),
         ('quality_range', 'invalid quality', format('select public.harvest(%L, %L, 8, %L)', s.room, s.g1, 'Infinity')),
         ('quality_range', 'invalid quality', format('select public.harvest(%L, %L, 8, null)', s.room, s.g1)),
         ('bad_qty', 'invalid quantity', format('select public.dry_start(%L, %L, %L, 0)', s.room, s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.dry_start(%L, %L, %L, null)', s.room, s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.sell_rice(%L, %L, true, 0)', s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.sell_rice(%L, %L, null, 5)', s.g1, 'nep')),
         ('bad_qty', 'invalid quantity', format('select public.buy_farm_item(%L, %L, 0)', s.g1, 'fert_urea')),
         ('bad_qty', 'invalid quantity', format('select public.buy_farm_item(%L, %L, 100)', s.g1, 'fert_urea')),
         ('bad_qty', 'invalid quantity', format('select public.buy_item(%L, %L, 500)', s.g1, 'bait_shrimp')),
         ('bad_qty', 'invalid quantity', format('select public.buy_item(%L, %L, 2)', s.g1, 'rod_bamboo')),
         ('foreign_offer', 'offer not found', format('select public.withdraw_offer(%L, %L, %L)', s.room, s.g1, s.o5)),
         ('foreign_offer', 'offer not found', format('select public.decline_offer(%L, %L, %L)', s.room, s.g1, s.o5)),
         ('foreign_offer', 'not your plot', format('select public.accept_offer(%L, %L, %L)', s.room, s.g1, s.o5))
       ) v(code, error, call);

do $$
declare g1 text := (select v from smoke where k = 'g1'); h1 uuid := (select v from smoke where k = 'h1')::uuid;
        h4 uuid := (select v from smoke where k = 'h4')::uuid; h5 uuid := (select v from smoke where k = 'h5')::uuid;
        room uuid := (select v from smoke where k = 'froom')::uuid; o5 uuid := (select v from smoke where k = 'o5')::uuid;
        v_log jsonb; r jsonb; c record; n int := 0;
begin
  update public.anticheat_config set mode = 'log';
  select water_log into v_log from public.crops where room_id = room and plot_no = 8;
  -- log mode: every hard signal is an envelope with strike 0 and the refusal it replaces, logged, nothing changed
  for c in select * from hard_calls loop
    n := n + 1;
    execute c.call into r;
    assert pg_temp.env(r, c.code, 0, c.error), format('%s → %s', c.call, r);
    assert pg_temp.last_outcome(h1) = 'log_only'
       and (select code from public.anticheat_events where account_id = h1 order by id desc limit 1) = c.code, c.call;
  end loop;
  assert n = 48 and (select count(*) from public.anticheat_events where account_id = h1 and outcome = 'log_only') = 48, 'all logged';
  assert (pg_temp.status(h1)).strikes = 0 and (pg_temp.status(h1)).locked_until is null, 'no strike, no lock in log mode';
  assert (select water_log from public.crops where room_id = room and plot_no = 8) = v_log, 'water with delta 5 changed nothing';
  assert (select detail from public.anticheat_events where account_id = h1 and code = 'quality_range' order by id limit 1)
         = '{"plot": 8, "quality": "NaN"}', 'NaN kept as text';
  assert (select detail from public.anticheat_events where account_id = h1 and code = 'foreign_offer' and rpc = 'withdraw_offer')
         = jsonb_build_object('offer_id', o5, 'buyer_id', h5), 'withdraw detail';
  assert (select detail from public.anticheat_events where account_id = h1 and code = 'foreign_offer' and rpc = 'accept_offer')
         = jsonb_build_object('offer_id', o5, 'plot', 1, 'owner_id', h4), 'accept detail';
  assert exists (select 1 from public.land_offers where id = o5) and (select coins from public.wallets where account_id = h1) = 750,
    'nothing changed';

  -- soft kind mismatches (§7.4) and plain refusals of unknown items
  assert pg_temp.env(public.buy_farm_item(g1, 'rod_bamboo', 1), 'kind_mismatch', 0, 'item not available'), 'buy_farm_item kind';
  assert pg_temp.env(public.apply_fertilizer(room, g1, 8, 'seed_nep'), 'kind_mismatch', 0, 'invalid item'), 'fertilizer kind';
  assert pg_temp.env(public.soak_seed(room, g1, 8, 'fert_urea'), 'kind_mismatch', 0, 'invalid item'), 'seed kind';
  assert pg_temp.env(public.spray(room, g1, 8, 'fert_urea'), 'kind_mismatch', 0, 'invalid item'), 'pesticide kind';
  assert (select count(*) from public.anticheat_events where account_id = h1 and outcome = 'soft' and code = 'kind_mismatch') = 4,
    'four soft rows';
  assert pg_temp.err(format('select public.apply_fertilizer(%L, %L, 8, %L)', room, g1, 'no_such_item')) = 'invalid item', 'unknown';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', g1, 'no_such_item')) = 'item not available', 'unknown';

  -- honest calls still work
  perform public.water(room, g1, 8, -1);
  assert (select jsonb_array_length(water_log) from public.crops where room_id = room and plot_no = 8) = 2, 'a real water change';
end $$;

do $$
declare h1 uuid := (select v from smoke where k = 'h1')::uuid; r jsonb; c record;
begin
  -- enforce: every hard signal is strike 1, a strike_1 row and a 5-minute lock (each call starts unlocked)
  update public.anticheat_config set mode = 'enforce';
  for c in select * from hard_calls loop
    update public.anticheat_status set strikes = 0, locked_until = null where account_id = h1;
    execute c.call into r;
    assert pg_temp.env(r, c.code, 1, c.error) and (r->'anticheat'->>'locked_until')::timestamptz = now() + interval '5 minutes',
      format('%s → %s', c.call, r);
    assert pg_temp.last_outcome(h1) = 'strike_1' and (pg_temp.status(h1)).locked_until = now() + interval '5 minutes', c.call;
  end loop;
  assert (select count(*) from public.anticheat_events where account_id = h1 and outcome = 'strike_1') = 48, 'every one struck';
  update public.anticheat_status set strikes = 0, locked_until = null where account_id = h1;
  update public.anticheat_config set mode = 'log';
end $$;

do $$
declare g2 text := (select v from smoke where k = 'g2'); h2 uuid := (select v from smoke where k = 'h2')::uuid;
        g3 text := (select v from smoke where k = 'g3'); h3 uuid := (select v from smoke where k = 'h3')::uuid;
        g4 text := (select v from smoke where k = 'g4'); h4 uuid := (select v from smoke where k = 'h4')::uuid;
        g5 text := (select v from smoke where k = 'g5'); h5 uuid := (select v from smoke where k = 'h5')::uuid;
        room uuid := (select v from smoke where k = 'froom')::uuid; other uuid := (select v from smoke where k = 'room')::uuid;
        t timestamptz := now(); r jsonb; e jsonb; o5 uuid; call text;
begin
  update public.anticheat_config set mode = 'enforce';
  -- no false positives in enforce (§7.3)
  perform pg_temp.set_coins(h3, 10750);
  perform public._farm_do_rent(room, h3, 9, t);
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at, soak_at, sow_at, water_log, work, work_started_at)
  values (room, 9, h3, 'short', t - interval '20 hours', t - interval '20 hours', t - interval '18 hours',
          jsonb_build_array(jsonb_build_object('t', t - interval '1 hour', 'l', 2)), 'transplant', t - interval '3 seconds')
  on conflict (room_id, plot_no) do nothing;
  r := public.transplant(room, g3, 9, 1);
  assert (select transplant_at = t from public.crops where room_id = room and plot_no = 9), 'transplanted';
  assert pg_temp.err(format('select public.transplant(%L, %L, 9, 1)', room, g3)) = 'too fast', 'a repeated transplant is refused';
  perform public.water(room, g3, 9, 1);
  perform public.water(room, g3, 9, 1);   -- level 3: "Bơm thêm nước (giữ Sâu)"
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at) values (room, 3, h3, 'short', 5, t - interval '25 hours');
  assert pg_temp.err(format('select public.dry_collect(%L, %L, 3)', room, g3)) = 'invalid slot', 'the sweep collected it first';
  update public.field_plots set sale_price = 9000 where room_id = room and plot_no = 1;
  perform pg_temp.set_coins(h3, 20000);
  assert pg_temp.err(format('select public.buy_listed_plot(%L, %L, 1, 8000)', room, g3)) = 'price changed', 'price changed';
  select id into o5 from public.land_offers where room_id = room and buyer_id = h5;
  perform public.join_room((select code from public.rooms where id = other), 'pw', g5);
  assert pg_temp.err(format('select public.withdraw_offer(%L, %L, %L)', other, g5, o5)) = 'offer not found', 'another room';
  assert pg_temp.err(format('select public.accept_offer(%L, %L, %L)', other, g5, o5)) = 'offer expired', 'another room';
  assert pg_temp.err(format('select public.add_queue_item(%L, %L, %L, %L, null, 100)', room, g3, 'short', 'x')) = 'invalid video',
    'a refused queue add';
  assert pg_temp.err(format('select public.register(%L, %L)', 'Ao cá', 'pw123456')) = 'invalid username', 'a refused register';
  assert not exists (select 1 from public.anticheat_events where account_id in (h3, h5) and outcome <> 'soft')
     and not exists (select 1 from public.anticheat_status where account_id in (h3, h5) and locked_until is not null),
    'no hard row, no lock';

  -- a player-to-player sale is a system line about the buyer (R12)
  r := public.buy_listed_plot(room, g5, 1, 9000);
  assert (select system and about_account_id = h5 and account_id is null and username = 'Hợp tác xã'
            from public.chat_messages where room_id = room and body like '[land:1] %'), 'the land line';

  -- enforce: a hard signal is strike 1; the farm RPCs are locked, the reads, chat and the queue are not
  r := public.water(room, g2, 8, 5);
  assert pg_temp.env(r, 'bad_water', 1, 'invalid quantity'), format('strike 1 %s', r);
  foreach call in array array[
    format('select public.water(%L, %L, 8, 1)', room, g2), format('select public.dry_collect(%L, %L, 1)', room, g2),
    format('select public.sell_rice(%L, %L, true, 1)', g2, 'nep'), format('select public.buy_farm_item(%L, %L, 1)', g2, 'fert_urea'),
    format('select public.claim_farm_gift(%L)', g2)] loop
    e := pg_temp.errd(call);
    assert e->>'message' = 'account locked' and e->>'hint' = 'anticheat' and (e->>'detail')::int = 300, format('%s: %s', call, e);
  end loop;
  perform public.field_state(room, g2);
  perform public.touch_room(room, g2);
  perform public.send_chat_message(g2, room, 'vẫn chat được');
  perform public.add_queue_item(room, g2, 'ddddddddddd', 'vẫn gọi bài được', null, 200);
  update public.anticheat_config set mode = 'log';
end $$;

select 'anticheat farm smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

**tests/sql/v15-smoke.sql — edit 1 of 2.** Replace:

```sql
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 98)', t2, 'fert_manure')) = 'invalid quantity', '99 at most held';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 0)', t2, 'fert_manure')) = 'invalid quantity', 'qty 1-99';
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 1)', t2, 'rod_bamboo')) = 'item not available', 'no fishing gear';
  perform pg_temp.set_coins(a2, 10);
```

with:

```sql
  assert pg_temp.err(format('select public.buy_farm_item(%L, %L, 98)', t2, 'fert_manure')) = 'invalid quantity', '99 at most held';
  assert public.buy_farm_item(t2, 'fert_manure', 0)->'anticheat'->>'error' = 'invalid quantity', 'qty 1-99';
  assert public.buy_farm_item(t2, 'rod_bamboo', 1)->'anticheat'->>'error' = 'item not available', 'no fishing gear';
  perform pg_temp.set_coins(a2, 10);
```

**tests/sql/v15-smoke.sql — edit 2 of 2.** Replace:

```sql
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 1)', t2, 'bogus')) = 'invalid variety', 'variety';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, null, 1)', t2, 'short')) = 'invalid quantity', 'dry or wet';
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 0)', t2, 'short')) = 'invalid quantity', 'kg';
end $$;
```

with:

```sql
  assert pg_temp.err(format('select public.sell_rice(%L, %L, true, 1)', t2, 'bogus')) = 'invalid variety', 'variety';
  assert public.sell_rice(t2, 'short', null, 1)->'anticheat'->>'error' = 'invalid quantity', 'dry or wet';
  assert public.sell_rice(t2, 'short', true, 0)->'anticheat'->>'error' = 'invalid quantity', 'kg';
end $$;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: `FAILED: tests/sql/v15-smoke.sql` with `ERROR:  invalid quantity` — `buy_farm_item(…, 0)` still raises.

- [ ] **Step 3: Write the farm part of section E**

**supabase/migrations/0015_anticheat.sql.** Append at the end of the file, after a blank line:

```sql
-- Farm and land (cores from 0013). The 24 room wrappers become plpgsql: the lock gate, the hard checks of §10.3 in
-- order, then the unchanged core with now(). The checks run before the core, so before the room's sweep.
create or replace function public.rent_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'rent_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_rent(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.buy_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'buy_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_buy_plot(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.sell_plot_to_village(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'sell_plot_to_village', jsonb_build_object('plot', p_plot), p_room_id,
                           'invalid plot');
  end if;
  return public._farm_do_sell_to_village(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.list_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'list_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_price is not null and p_price not between 1 and 5000000 then
    return public._ac_flag(v_account, 'bad_price', 'list_plot', jsonb_build_object('plot', p_plot, 'price', p_price), p_room_id,
                           'invalid price');
  end if;
  return public._farm_do_list(p_room_id, v_account, p_plot, p_price, now());
end $$;

create or replace function public.buy_listed_plot(p_room_id uuid, p_session_token text, p_plot integer,
                                                  p_expected_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'buy_listed_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_buy_listed(p_room_id, v_account, p_plot, p_expected_price, now());
end $$;

create or replace function public.offer_plot(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'offer_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_price is null or p_price not between 1 and 5000000 then
    return public._ac_flag(v_account, 'bad_price', 'offer_plot', jsonb_build_object('plot', p_plot, 'price', p_price), p_room_id,
                           'invalid price');
  end if;
  return public._farm_do_offer(p_room_id, v_account, p_plot, p_price, now());
end $$;

-- foreign_offer (§7.2): an offer of this room whose buyer is someone else (R18: another room's id is a plain refusal).
create or replace function public.withdraw_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_buyer uuid;
begin
  select lo.buyer_id into v_buyer from public.land_offers lo where lo.id = p_offer_id and lo.room_id = p_room_id;
  if found and v_buyer <> v_account then
    return public._ac_flag(v_account, 'foreign_offer', 'withdraw_offer',
                           jsonb_build_object('offer_id', p_offer_id, 'buyer_id', v_buyer), p_room_id, 'offer not found');
  end if;
  return public._farm_do_withdraw_offer(p_room_id, v_account, p_offer_id, now());
end $$;

-- foreign_offer: an offer of this room on a plot the caller does not own (every change of owner deletes its offers).
create or replace function public.decline_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_plot integer; v_owner uuid;
begin
  select lo.plot_no, fp.owner_id into v_plot, v_owner
    from public.land_offers lo join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
   where lo.id = p_offer_id and lo.room_id = p_room_id;
  if found and v_owner is distinct from v_account then
    return public._ac_flag(v_account, 'foreign_offer', 'decline_offer',
                           jsonb_build_object('offer_id', p_offer_id, 'plot', v_plot, 'owner_id', v_owner), p_room_id,
                           'offer not found');
  end if;
  return public._farm_do_decline_offer(p_room_id, v_account, p_offer_id, now());
end $$;

create or replace function public.accept_offer(p_room_id uuid, p_session_token text, p_offer_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_plot integer; v_owner uuid;
begin
  select lo.plot_no, fp.owner_id into v_plot, v_owner
    from public.land_offers lo join public.field_plots fp on fp.room_id = lo.room_id and fp.plot_no = lo.plot_no
   where lo.id = p_offer_id and lo.room_id = p_room_id;
  if found and v_owner is distinct from v_account then
    return public._ac_flag(v_account, 'foreign_offer', 'accept_offer',
                           jsonb_build_object('offer_id', p_offer_id, 'plot', v_plot, 'owner_id', v_owner), p_room_id,
                           'not your plot');
  end if;
  return public._farm_do_accept_offer(p_room_id, v_account, p_offer_id, now());
end $$;

create or replace function public.set_sublease(p_room_id uuid, p_session_token text, p_plot integer, p_price integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'set_sublease', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_price is not null and p_price not between 1 and 100000 then
    return public._ac_flag(v_account, 'bad_price', 'set_sublease', jsonb_build_object('plot', p_plot, 'price', p_price),
                           p_room_id, 'invalid price');
  end if;
  return public._farm_do_set_sublease(p_room_id, v_account, p_plot, p_price, now());
end $$;

create or replace function public.rent_sublease(p_room_id uuid, p_session_token text, p_plot integer,
                                                p_expected_price integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'rent_sublease', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_rent_sublease(p_room_id, v_account, p_plot, p_expected_price, now());
end $$;

create or replace function public.abandon_crop(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'abandon_crop', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_abandon(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.prepare_plot(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'prepare_plot', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_prepare(p_room_id, v_account, p_plot, now());
end $$;

-- kind_mismatch (§7.4) is soft: an existing item of another kind; an unknown item is the core's plain refusal.
create or replace function public.apply_fertilizer(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_kind text;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'apply_fertilizer', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  select kind into v_kind from public.shop_items where id = p_item_id;
  if found and v_kind <> 'fertilizer' then
    return public._ac_flag(v_account, 'kind_mismatch', 'apply_fertilizer', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           p_room_id, 'invalid item', false);
  end if;
  return public._farm_do_fertilize(p_room_id, v_account, p_plot, p_item_id, now());
end $$;

create or replace function public.soak_seed(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_kind text;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'soak_seed', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  select kind into v_kind from public.shop_items where id = p_item_id;
  if found and v_kind <> 'seed' then
    return public._ac_flag(v_account, 'kind_mismatch', 'soak_seed', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           p_room_id, 'invalid item', false);
  end if;
  return public._farm_do_soak(p_room_id, v_account, p_plot, p_item_id, now());
end $$;

create or replace function public.sow_seed(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'sow_seed', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_sow(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.begin_work(p_room_id uuid, p_session_token text, p_plot integer, p_work text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'begin_work', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_work is null or p_work not in ('transplant', 'harvest') then
    return public._ac_flag(v_account, 'bad_work', 'begin_work', jsonb_build_object('plot', p_plot, 'work', p_work), p_room_id,
                           'invalid work');
  end if;
  return public._farm_do_begin_work(p_room_id, v_account, p_plot, p_work, now());
end $$;

-- quality_range (§6.4): NaN is larger than every number, so the range test catches it; the detail keeps it as text.
create or replace function public.transplant(p_room_id uuid, p_session_token text, p_plot integer,
                                             p_quality double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'transplant', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_quality is null or p_quality not between 0.9 - 1e-9 and 1.1 + 1e-9 then
    return public._ac_flag(v_account, 'quality_range', 'transplant', jsonb_build_object('plot', p_plot, 'quality', p_quality::text),
                           p_room_id, 'invalid quality');
  end if;
  return public._farm_do_transplant(p_room_id, v_account, p_plot, p_quality, now());
end $$;

create or replace function public.water(p_room_id uuid, p_session_token text, p_plot integer, p_delta integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'water', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_delta is null or p_delta not in (1, -1) then
    return public._ac_flag(v_account, 'bad_water', 'water', jsonb_build_object('plot', p_plot, 'delta', p_delta),
                           p_room_id, 'invalid quantity');
  end if;
  return public._farm_do_water(p_room_id, v_account, p_plot, p_delta, now());
end $$;

create or replace function public.spray(p_room_id uuid, p_session_token text, p_plot integer, p_item_id text)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token); v_kind text;
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'spray', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  select kind into v_kind from public.shop_items where id = p_item_id;
  if found and v_kind <> 'pesticide' then
    return public._ac_flag(v_account, 'kind_mismatch', 'spray', jsonb_build_object('item', p_item_id, 'kind', v_kind),
                           p_room_id, 'invalid item', false);
  end if;
  return public._farm_do_spray(p_room_id, v_account, p_plot, p_item_id, now());
end $$;

create or replace function public.pick_snails(p_room_id uuid, p_session_token text, p_plot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'pick_snails', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  return public._farm_do_pick_snails(p_room_id, v_account, p_plot, now());
end $$;

create or replace function public.harvest(p_room_id uuid, p_session_token text, p_plot integer,
                                          p_quality double precision) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_plot is null or p_plot not between 1 and 10 then
    return public._ac_flag(v_account, 'bad_plot', 'harvest', jsonb_build_object('plot', p_plot), p_room_id, 'invalid plot');
  end if;
  if p_quality is null or p_quality not between 0.9 - 1e-9 and 1.1 + 1e-9 then
    return public._ac_flag(v_account, 'quality_range', 'harvest', jsonb_build_object('plot', p_plot, 'quality', p_quality::text),
                           p_room_id, 'invalid quality');
  end if;
  return public._farm_do_harvest(p_room_id, v_account, p_plot, p_quality, now());
end $$;

create or replace function public.dry_start(p_room_id uuid, p_session_token text, p_variety text, p_kg integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_kg is null or p_kg < 1 then
    return public._ac_flag(v_account, 'bad_qty', 'dry_start', jsonb_build_object('variety', p_variety, 'kg', p_kg), p_room_id,
                           'invalid quantity');
  end if;
  return public._farm_do_dry_start(p_room_id, v_account, p_variety, p_kg, now());
end $$;

-- bad_slot (R17): the drying panel only offers slots 1–4.
create or replace function public.dry_collect(p_room_id uuid, p_session_token text, p_slot integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_slot is null or p_slot not between 1 and 4 then
    return public._ac_flag(v_account, 'bad_slot', 'dry_collect', jsonb_build_object('slot', p_slot), p_room_id, 'invalid slot');
  end if;
  return public._farm_do_dry_collect(p_room_id, v_account, p_slot, now());
end $$;

-- The account-only farm RPCs (bodies from 0013).
create or replace function public.sell_rice(p_session_token text, p_variety text, p_dry boolean, p_kg integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid; v public.rice_varieties; rs public.rice_stock; v_pay integer;
begin
  v_account := public._ac_account(p_session_token);
  perform public._wallet_lock(v_account);
  if p_kg is null or p_kg < 1 or p_dry is null then
    return public._ac_flag(v_account, 'bad_qty', 'sell_rice', jsonb_build_object('variety', p_variety, 'kg', p_kg, 'dry', p_dry),
                           null, 'invalid quantity');
  end if;
  v := public._variety(p_variety);
  if v.id is null then
    raise exception 'invalid variety' using errcode = '22023';
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

-- A fishing item is a soft kind_mismatch, a quantity outside 1–99 a hard bad_qty; more than 99 held stays a plain refusal.
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
  if it.kind not in ('seed', 'fertilizer', 'pesticide') then
    return public._ac_flag(v_account, 'kind_mismatch', 'buy_farm_item', jsonb_build_object('item', it.id, 'kind', it.kind),
                           null, 'item not available', false);
  end if;
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    return public._ac_flag(v_account, 'bad_qty', 'buy_farm_item', jsonb_build_object('item', it.id, 'qty', p_qty), null,
                           'invalid quantity');
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
  end if;
  return jsonb_build_object('gifted', v_gifted, 'server_now', now(), 'mine', public._farm_mine(v_account));
end; $$;

-- A player-to-player sale (0013): the announcement is a system line about the buyer (R12); nothing else changes.
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
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id)
  values (p_room, null, 'Hợp tác xã',
          format('[land:%s] 🏡 %s đã mua thửa %s của %s với giá %s xu.', p_plot,
                 (select username from public.accounts where id = p_buyer), p_plot,
                 (select username from public.accounts where id = v_seller),
                 replace(to_char(p_price, 'FM9,999,999'), ',', '.')),
          true, p_buyer);
  delete from public.chat_messages
   where room_id = p_room
     and id not in (select id from public.chat_messages where room_id = p_room order by created_at desc limit 200);
end; $$;
revoke all on function public._land_sale(uuid, integer, uuid, integer, timestamptz) from public, anon, authenticated;

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

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected:

```text
v14 smoke ok
0015 twice ok
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
anticheat guards ok
anticheat names and queue smoke ok
anticheat flow smoke ok
anticheat fishing smoke ok
anticheat farm smoke ok
anticheat guards ok
ALL OK
```

If the static guard check fails with `unguarded: <function>(<args>)`, that function is an anon-callable `SECURITY DEFINER` function that neither calls the lock gate nor is on the allowlist: a game action must call `_ac_account` or `_ac_play`; anything else goes on the allowlist, by name.

- [ ] **Step 5: Commit**

Commit message:

```text
feat(anticheat): 0015 guards the farm and land RPCs; the guard regression

Section E, farm: the 24 room wrappers become plpgsql with the lock gate and the hard checks bad_plot, bad_price,
foreign_offer, bad_work, quality_range, bad_water, bad_qty and bad_slot, and soft kind mismatches for the items;
sell_rice, buy_farm_item and claim_farm_gift take the lock gate and their quantity checks; a land sale posts a system
line about the buyer. tests/sql/anticheat-guards.sql fails for any anon-callable SECURITY DEFINER function that is
neither allowlisted nor guarded, and checks that all 35 game RPCs refuse a locked account while the reads answer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0015_anticheat.sql tests/sql/anticheat-guards.sql tests/sql/anticheat-smoke.sql tests/sql/v15-smoke.sql
git commit -F <message file>
```

---

### Task 5: Database — the shared functions: the daily cap in the fishing state, the sweep's step 0, banned accounts off the board (`0015` section F)

**Files:**
- Modify: `supabase/migrations/0015_anticheat.sql` (append section F)
- Modify: `tests/sql/anticheat-smoke.sql` (part 5, inserted before the closing `\i tests/sql/anticheat-guards.sql`)

**Interfaces:**
- Consumes: Task 2's `anticheat_status` (`ban_state`, `wiped_at`), `_ac_lock_state(uuid) → {until, code} | null`, `fishing_profiles.day_on` / `day_casts`, `_ac_wipe`; the smoke's `smoke` table (Task 1); from `0012`–`0013`: `_fishing_state(uuid)`, `_field_init(room)`, `_field_open(room, now)` (runs the sweep), `_bait_cap`, `_bucket_cap`, `_vn_today`, `_field_sweep(room, now)` (steps 1–7), `_farmer`, `_plus_h`, `_rice_add`, `_pay`, `_wallet_lock`, the `_song_bonus()` trigger, `fishing_board(room, token)`, `accounts.is_banned`, `field_plots`, `plot_leases(room_id, plot_no, farmer_id, starts_at, until)`, `land_offers`, `drying_slots(room_id, account_id, ready_at, …)`.
- Produces (Postgres):
  - `_fishing_state(uuid)` (private) answers everything it did plus `casts_today_left` (300 minus today's casts, a Vietnam day), `day_resets_at` (the next Vietnam midnight when none are left, else null) and `lock` (`_ac_lock_state`: `{"until": <timestamptz>, "code": <text>}` while a lock runs, else null). `fishing_state` and every fishing answer that carries `state` show them;
  - `_field_sweep(room, now)` (private; `0013`'s sweep, with v15.1 Task 20's 400 000 xu reclaim refund) runs a new step 0 first: 0a. an account under a ban (`ban_state` not null) loses its offers and its plots' sale and sublease prices; 0b. after a wipe, its leases, plots, offers and drying batches from before the wipe are released without refund; 0c. offers on a plot without an owner are deleted. Steps 1–7 are unchanged;
  - `_song_bonus()` never pays a banned account; `fishing_board(room, token)` (same signature, granted; `0013` section H's board, which keeps its `prices`) leaves banned accounts out of the records, the richest and the ranks.
- Produces (smoke): keys `k1`–`k5`, `m1`–`m5`, `sroom`; part 5 ends with `select 'anticheat shared functions smoke ok'`, before the guard regression's `\i`.

- [ ] **Step 1: Write smoke part 5**

**tests/sql/anticheat-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- shared functions (§10.4, R10, R11, R30): the fishing state, the board, the song bonus, the sweep ----------
insert into smoke select 'k' || n, token from generate_series(1, 5) n,
  lateral public.register('ack' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'm' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('k1', 'k2', 'k3', 'k4', 'k5');
insert into smoke select 'sroom', room_id::text from public.create_room('Ruộng quét', 'pw', (select v from smoke where k = 'k1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = 'sroom')::uuid), 'pw', v)
  from smoke where k in ('k2', 'k3', 'k4', 'k5');

do $$
declare k2 text := (select v from smoke where k = 'k2'); m2 uuid := (select v from smoke where k = 'm2')::uuid; s jsonb;
begin
  -- the fishing state carries the daily cap and the running lock
  s := public.fishing_state(k2);
  assert (s->>'casts_today_left')::int = 300 and s->'day_resets_at' = 'null' and s->'lock' = 'null', format('fresh %s', s);
  insert into public.fishing_profiles (account_id, day_on, day_casts) values (m2, public._vn_today(), 120);
  assert (public.fishing_state(k2)->>'casts_today_left')::int = 180, '180 left';
  update public.fishing_profiles set day_casts = 300 where account_id = m2;
  s := public.fishing_state(k2);
  assert (s->>'casts_today_left')::int = 0
     and (s->>'day_resets_at')::timestamptz = (public._vn_today() + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh', 'the day is over';
  update public.fishing_profiles set day_on = public._vn_today() - 1 where account_id = m2;
  assert (public.fishing_state(k2)->>'casts_today_left')::int = 300, 'yesterday does not count';
  insert into public.anticheat_status (account_id, locked_until, last_strike_code) values (m2, now() + interval '4 minutes', 'bad_plot');
  s := public.fishing_state(k2);
  assert s->'lock' = jsonb_build_object('until', now() + interval '4 minutes', 'code', 'bad_plot'), format('lock %s', s->'lock');
  update public.anticheat_status set locked_until = now() - interval '1 second' where account_id = m2;
  assert public.fishing_state(k2)->'lock' = 'null', 'the lock ended';
end $$;

do $$
declare k1 text := (select v from smoke where k = 'k1'); m1 uuid := (select v from smoke where k = 'm1')::uuid;
        m3 uuid := (select v from smoke where k = 'm3')::uuid; m4 uuid := (select v from smoke where k = 'm4')::uuid;
        m5 uuid := (select v from smoke where k = 'm5')::uuid; room uuid := (select v from smoke where k = 'sroom')::uuid;
        aroot uuid := (select v from smoke where k = 'aroot')::uuid; b jsonb; q uuid; t timestamptz := now();
begin
  -- m3 cheats later; m4 subleases m3's plot; m5 owns plot 3
  insert into public.wallets (account_id, coins) values (m1, 100), (m3, 999999), (m4, 500), (m5, 500)
  on conflict (account_id) do update set coins = excluded.coins;
  insert into public.personal_bests (account_id, species_id, weight_g) values (m3, 'ca_ho', 39000), (m4, 'ca_ho', 12000);
  b := public.fishing_board(room, k1);
  assert b->'records'->0->>'username' = (select username from public.accounts where id = m3)
     and (b->'richest'->0->>'coins')::int = 999999 and (b->>'my_rank')::int = 4, format('before the ban %s', b);

  -- the ban (strike 2 sets these): the board hides m3 and the song bonus skips it (R30)
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (m3, 2, 'pending_wipe', t);
  update public.accounts set is_banned = true where id = m3;
  b := public.fishing_board(room, k1);
  assert b->'records'->0->>'username' = (select username from public.accounts where id = m4)
     and not (b->'richest' @> jsonb_build_array(jsonb_build_object('coins', 999999))) and (b->>'my_rank')::int = 3,
    format('after the ban %s', b);
  insert into public.queue_items (room_id, youtube_video_id, title, duration_seconds, added_by_account_id, added_by_name, position)
  values (room, 'eeeeeeeeeee', 'Bài của m3', 240, m3, 'm3', 1) returning id into q;
  update public.rooms set current_item_id = q where id = room;
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  perform public.advance_queue(room, k1);
  assert not exists (select 1 from public.coin_ledger where account_id = m3 and reason = 'song'), 'no song bonus for a banned account';
  insert into public.queue_items (room_id, youtube_video_id, title, duration_seconds, added_by_account_id, added_by_name, position)
  values (room, 'fffffffffff', 'Bài của m4', 240, m4, 'm4', 2) returning id into q;
  update public.rooms set current_item_id = q where id = room;
  update public.rooms set item_began_at = now() - interval '10 minutes' where id = room;
  perform public.advance_queue(room, k1);
  assert exists (select 1 from public.coin_ledger where account_id = m4 and reason = 'song' and delta = 10), 'others still earn it';

  -- the market freeze at the next sweep (R10): offers gone, listing and sublease price cleared, the plot kept
  perform public._field_init(room);
  update public.field_plots set owner_id = m3, owned_at = t - interval '2 days', sale_price = 9000, sublease_price = 300
   where room_id = room and plot_no = 2;
  update public.field_plots set owner_id = m5, owned_at = t - interval '2 days' where room_id = room and plot_no = 3;
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (room, 3, m3, 7000, t - interval '1 hour');
  perform public._field_open(room, t);
  assert not exists (select 1 from public.land_offers where room_id = room and buyer_id = m3), 'the offer is gone';
  assert (select owner_id = m3 and sale_price is null and sublease_price is null from public.field_plots
           where room_id = room and plot_no = 2), 'listing and sublease cleared, the plot kept until the wipe';

  -- what m3 holds when the owner wipes it: plot 2 subleased to m4, village plot 7 with a crop, a batch, an offer
  insert into public.plot_leases (room_id, plot_no, farmer_id, source, price, starts_at, until) values
    (room, 2, m4, 'owner', 300, t - interval '1 day', t + interval '3 days'),
    (room, 7, m3, 'village', 250, t - interval '1 day', t + interval '3 days');
  insert into public.crops (room_id, plot_no, farmer_id, variety, prepared_at) values (room, 7, m3, 'nep', t - interval '1 day');
  insert into public.drying_slots (room_id, slot, account_id, variety, kg, ready_at) values (room, 1, m3, 'nep', 40, t + interval '1 hour');
  insert into public.land_offers (room_id, plot_no, buyer_id, price, created_at) values (room, 3, m3, 7500, t - interval '1 minute');
  perform public._ac_wipe(m3, aroot);
  -- the next field call releases it all, without refund; m4's sublease runs on (R11)
  perform public._field_open(room, t);
  assert (select owner_id is null and owned_at is null from public.field_plots where room_id = room and plot_no = 2), 'plot released';
  assert not exists (select 1 from public.coin_ledger where account_id = m3 and reason = 'land_refund'), 'no refund';
  assert exists (select 1 from public.plot_leases where room_id = room and plot_no = 2 and farmer_id = m4), 'the sublease runs on';
  assert not exists (select 1 from public.plot_leases where room_id = room and farmer_id = m3)
     and not exists (select 1 from public.crops where room_id = room and farmer_id = m3)
     and not exists (select 1 from public.drying_slots where room_id = room and account_id = m3)
     and not exists (select 1 from public.land_offers where room_id = room and buyer_id = m3), 'lease, crop, batch and offer gone';
  assert not exists (select 1 from public.rice_stock where account_id = m3), 'no dry rice from the batch';
  assert (select owner_id = m5 from public.field_plots where room_id = room and plot_no = 3), 'innocent land stays';
  perform public._field_open(room, t + interval '3 days');
  assert (select owner_id is null from public.field_plots where room_id = room and plot_no = 2)
     and not exists (select 1 from public.plot_leases where room_id = room and plot_no = 2), 'the village gets it after the lease';
end $$;

select 'anticheat shared functions smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` with `ERROR:  fresh {"bait": …}` — the fishing state has no `casts_today_left` yet.

- [ ] **Step 3: Write section F**

**supabase/migrations/0015_anticheat.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- F. Shared functions (§10.4) ----------
-- The fishing state of 0013 plus the daily cap (casts_today_left, day_resets_at) and the running lock (R14).
create or replace function public._fishing_state(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions
as $$
declare w public.wallets; p public.fishing_profiles; v_resets timestamptz; v_left integer; v_dig timestamptz;
        v_today date := public._vn_today(); v_day_left integer;
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
  v_day_left := case when p.day_on = v_today then greatest(0, 300 - p.day_casts) else 300 end;
  return jsonb_build_object(
    'coins', coalesce(w.coins, 0),
    'daily_claimed', coalesce(w.daily_on = v_today, false),
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
    'server_now', now(),
    'casts_today_left', v_day_left,
    'day_resets_at', case when v_day_left = 0 then (v_today + 1)::timestamp at time zone 'Asia/Ho_Chi_Minh' end,
    'lock', public._ac_lock_state(p_account)
  );
end; $$;
revoke all on function public._fishing_state(uuid) from public, anon, authenticated;

-- The sweep of 0013 with step 0 first: a banned account leaves the land market (R10), and a wipe releases what the
-- account held at the time of the wipe, without refund (R11). Step 0 runs before the reclaim (step 3), so a wiped owner
-- is never refunded, and before the auto-collect (step 7), so a wiped batch never becomes dry rice.
create or replace function public._field_sweep(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare f public.field_plots; d public.drying_slots;
begin
  -- 0a. banned accounts (review pending or wiped) leave the land market
  delete from public.land_offers lo using public.anticheat_status s
   where lo.room_id = p_room and s.account_id = lo.buyer_id and s.ban_state is not null;
  update public.field_plots fp set sale_price = null, sublease_price = null
    from public.anticheat_status s
   where fp.room_id = p_room and s.account_id = fp.owner_id and s.ban_state is not null
     and (fp.sale_price is not null or fp.sublease_price is not null);
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
revoke all on function public._field_sweep(uuid, timestamptz) from public, anon, authenticated;

-- The song bonus of 0012, which never pays a banned account (R30).
create or replace function public._song_bonus() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
declare q public.queue_items; w public.wallets; v_today date;
begin
  begin
    select * into q from public.queue_items where id = old.current_item_id;
    if not found or q.added_by_account_id is null or coalesce(q.duration_seconds, 0) < 60
       or old.item_began_at is null
       or extract(epoch from (now() - old.item_began_at)) < 0.75 * q.duration_seconds
       or exists (select 1 from public.accounts a where a.id = q.added_by_account_id and a.is_banned) then
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
revoke all on function public._song_bonus() from public, anon, authenticated;

-- The board of 0013 section H (with the room's fish prices) without banned accounts: no record, no place among the
-- richest, no rank (R30).
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
    join public.accounts a on a.id = m.account_id
   where m.room_id = p_room_id and w.coins > v_coins and not a.is_banned;
  return jsonb_build_object(
    'records', coalesce((
      select jsonb_agg(jsonb_build_object('species_id', r.species_id, 'username', r.username, 'weight_g', r.weight_g)
                       order by r.species_id)
        from (select distinct on (pb.species_id) pb.species_id, a.username, pb.weight_g
                from public.personal_bests pb
                join public.members m on m.account_id = pb.account_id and m.room_id = p_room_id
                join public.accounts a on a.id = pb.account_id and not a.is_banned
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
               where m.room_id = p_room_id and w.coins > 0 and not a.is_banned
               order by w.coins desc, a.username
               limit 10) t), '[]'::jsonb),
    'my_rank', v_rank,
    'my_coins', v_coins,
    'prices', public._fish_prices(p_room_id, now()));
end; $$;
grant execute on function public.fishing_board(uuid, text) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: as in Task 4, with `anticheat shared functions smoke ok` between `anticheat farm smoke ok` and `anticheat guards ok` in both anti-cheat runs, and `ALL OK`.

- [ ] **Step 5: Commit**

Commit message:

```text
feat(anticheat): 0015 shared functions — the daily cap state, the sweep's step 0, banned accounts leave the board

Section F: _fishing_state gains casts_today_left, day_resets_at and the running lock; _field_sweep's new step 0 takes
banned accounts off the land market and releases what a wiped account held at the wipe, without refund, before the
reclaim and the auto-collect; _song_bonus never pays a banned account, and fishing_board (0013 section H's, with the
room's fish prices) leaves banned accounts out of the records, the richest and the ranks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0015_anticheat.sql tests/sql/anticheat-smoke.sql
git commit -F <message file>
```

---

### Task 6: Database — the admin RPCs: the list, the evidence, wipe, pardon and the mode switch (`0015` section G)

**Files:**
- Modify: `supabase/migrations/0015_anticheat.sql` (append section G)
- Modify: `tests/sql/anticheat-smoke.sql` (part 6, inserted before the closing `\i tests/sql/anticheat-guards.sql`)

**Interfaces:**
- Consumes: Task 2's `anticheat_config`, `anticheat_status`, `anticheat_events`, `anticheat_wipes`, `_ac_holdings`, `_ac_wipe(uuid, by uuid)`, `_ac_pardon(uuid, by uuid)`; Task 5's step 0 of `_field_sweep` (the smoke checks a wipe end to end); the smoke helpers `pg_temp.err`, `pg_temp.flag`, `pg_temp.status` (Task 2) and `pg_temp.set_coins` (Task 4), and the keys `troot` / `aroot` (a root account, Task 2); from `0005`: `_auth_root(token) → uuid` (raises `root role required`), `admin_set_ban(token, account, banned)`; from `0012`–`0013`: `_wallet_lock`, `_field_init(room)`, `_field_open(room, now)`.
- Produces (Postgres; root only; granted to anon and authenticated like the other `admin_*` RPCs):
  - `_ac_case(p_account uuid) → jsonb | null` (private): `{account_id, username, is_root, is_banned, strikes, active_strikes (2 under a ban, 1 for a strike in 30 days, else 0), last_strike_at, last_strike_code, locked_until (only while it runs), ban_state, banned_at, wiped_at, pardoned_at, hard_events, soft_events, last_event_at}`;
  - `admin_anticheat_list(p_session_token text) → {mode, mode_changed_at, server_now, cases: _ac_case[]}` — accounts with a strike, a ban, a running lock, a pardon or an event in 90 days; pending wipes first, then running locks, then the latest event; at most 200;
  - `admin_anticheat_account(p_session_token text, p_account_id uuid) → {case, holdings, events, wipes}` — `holdings` is `_ac_holdings`; `events` the newest 300 `{id, created_at, code, outcome, rpc, room_id, detail, client, user_agent}`; `wipes` `{id, wiped_at, wiped_by (username), snapshot}`, newest first;
  - `admin_anticheat_resolve(p_session_token text, p_account_id uuid, p_action text) → _ac_case`: `invalid action` unless `wipe` / `pardon`; `wipe` answers `not pending` unless `ban_state = 'pending_wipe'` (checked under `_wallet_lock`, and for an unknown account before it), then `_ac_wipe`; `pardon` is `_ac_pardon` (`nothing to pardon`);
  - `admin_anticheat_set_mode(p_session_token text, p_mode text) → {mode, mode_changed_at}`: `invalid mode` unless `log` / `enforce`; switching to `log` lifts the running locks (bans stay);
  - `admin_set_ban(token, account, banned)` (same signature): unbanning an account under an anti-cheat ban is the pardon; everything else as in `0005`.
- Produces (smoke): keys `n1`–`n6`, `p1`–`p6`, `aroom`, `aroom2`, `p2token`; part 6 ends with `select 'anticheat admin smoke ok'`, before the guard regression's `\i`.

- [ ] **Step 1: Write smoke part 6**

**tests/sql/anticheat-smoke.sql.** Replace:

```sql

\i tests/sql/anticheat-guards.sql
```

with:

```sql

-- ---------- admin (§9.5–§9.8, §10.5): the preview, the wipe, the pardon, the ban switch, the mode, the list ----------
insert into smoke select 'n' || n, token from generate_series(1, 6) n,
  lateral public.register('acn' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'p' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('n1', 'n2', 'n3', 'n4', 'n5', 'n6');
insert into smoke select 'aroom', room_id::text from public.create_room('Phòng xử', 'pw', (select v from smoke where k = 'n1'));
insert into smoke select 'aroom2', room_id::text from public.create_room('Phòng xử 2', 'pw', (select v from smoke where k = 'n1'));
select public.join_room((select code from public.rooms where id = (select v from smoke where k = r)::uuid), 'pw', v)
  from smoke, unnest(array['aroom', 'aroom2']) r where k in ('n2', 'n3', 'n4', 'n5', 'n6');

do $$
declare n1 text := (select v from smoke where k = 'n1'); p2 uuid := (select v from smoke where k = 'p2')::uuid;
        troot text := (select v from smoke where k = 'troot'); aroot uuid := (select v from smoke where k = 'aroot')::uuid;
        call text; r jsonb;
begin
  foreach call in array array[format('select public.admin_anticheat_list(%L)', n1),
                              format('select public.admin_anticheat_account(%L, %L)', n1, p2),
                              format('select public.admin_anticheat_resolve(%L, %L, %L)', n1, p2, 'pardon'),
                              format('select public.admin_anticheat_set_mode(%L, %L)', n1, 'log')] loop
    assert pg_temp.err(call) = 'root role required', call;
  end loop;
  assert pg_temp.err(format('select public.admin_anticheat_set_mode(%L, %L)', troot, 'off')) = 'invalid mode', 'no off mode (R2)';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p2, 'erase')) = 'invalid action', 'action';
  assert not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = '_ac_case'
                       and has_function_privilege('anon', oid, 'execute')), '_ac_case is private';
  r := public.admin_anticheat_set_mode(troot, 'enforce');
  assert r = jsonb_build_object('mode', 'enforce', 'mode_changed_at', now()), format('set mode %s', r);
  assert (select mode = 'enforce' and mode_changed_by = aroot from public.anticheat_config), 'recorded';
end $$;

do $$
declare n2 text := (select v from smoke where k = 'n2'); p2 uuid := (select v from smoke where k = 'p2')::uuid;
        troot text := (select v from smoke where k = 'troot'); room uuid := (select v from smoke where k = 'aroom')::uuid;
        room2 uuid := (select v from smoke where k = 'aroom2')::uuid; r jsonb; a jsonb; h jsonb; c jsonb;
begin
  -- p2 holds xu, a fish, a record, rice, a catch line and a plot in each room, then strikes twice
  perform pg_temp.set_coins(p2, 1230);
  insert into public.fish (account_id, species_id, weight_g, price) values (p2, 'ca_loc', 900, 54);
  insert into public.personal_bests (account_id, species_id, weight_g) values (p2, 'ca_loc', 900);
  insert into public.rice_stock (account_id, variety, wet_kg, dry_kg) values (p2, 'short', 12, 30);
  insert into public.chat_messages (room_id, account_id, username, body, system, about_account_id) values
    (room, null, 'Ao cá', '[catch:' || p2 || '|ca_ho|39000] 🎣 x', true, p2),
    (room, p2, 'x', 'tin nhắn thường', false, null);
  perform public._field_init(room);
  perform public._field_init(room2);
  update public.field_plots set owner_id = p2, owned_at = now() - interval '1 day' where room_id in (room, room2) and plot_no = 2;
  r := public.water(room, n2, 5, 5);
  assert (r->'anticheat'->>'strike')::int = 1, 'strike 1';
  update public.anticheat_status set locked_until = now() - interval '1 second' where account_id = p2;
  r := public.water(room, n2, 5, 5);
  assert (r->'anticheat'->>'strike')::int = 2 and (r->'anticheat'->>'banned')::boolean, 'strike 2';
  assert pg_temp.err(format('select public.login(%L, %L)', (select username from public.accounts where id = p2), 'pw123456'))
         = 'account banned', 'login refused';

  -- the case, the preview and the evidence, newest first
  a := public.admin_anticheat_account(troot, p2);
  assert a->'case'->>'ban_state' = 'pending_wipe' and (a->'case'->>'active_strikes')::int = 2 and (a->'case'->>'strikes')::int = 2
     and (a->'case'->>'hard_events')::int = 2 and (a->'case'->>'soft_events')::int = 0 and a->'case'->>'last_strike_code' = 'bad_water'
     and a->'case'->'locked_until' = 'null' and (a->'case'->>'is_banned')::boolean, format('case %s', a->'case');
  assert a->'holdings' = public._ac_holdings(p2) and jsonb_array_length(a->'holdings'->'plots') = 2, 'the preview';
  assert jsonb_array_length(a->'events') = 2 and a->'events'->0->>'outcome' = 'strike_2' and a->'events'->1->>'outcome' = 'strike_1'
     and a->'events'->0->'detail' = '{"plot": 5, "delta": 5}' and a->'events'->0->>'rpc' = 'water'
     and a->'events'->0->>'room_id' = room::text and a->'wipes' = '[]', format('events %s', a->'events');

  -- the wipe (§9.6)
  h := public._ac_holdings(p2);
  c := public.admin_anticheat_resolve(troot, p2, 'wipe');
  assert c->>'ban_state' = 'wiped' and (c->>'wiped_at')::timestamptz = now() and c->>'account_id' = p2::text, format('wiped %s', c);
  assert (select snapshot = h from public.anticheat_wipes where account_id = p2), 'the snapshot is the preview';
  assert (select delta = -1230 and balance = 0 from public.coin_ledger where account_id = p2 and reason = 'wipe'), 'ledger';
  assert not exists (select 1 from public.wallets where account_id = p2) and not exists (select 1 from public.fish where account_id = p2)
     and not exists (select 1 from public.personal_bests where account_id = p2)
     and not exists (select 1 from public.rice_stock where account_id = p2), 'data gone';
  assert not exists (select 1 from public.chat_messages where about_account_id = p2)
     and exists (select 1 from public.chat_messages where account_id = p2 and body = 'tin nhắn thường'), 'catch line gone, chat kept';
  a := public.admin_anticheat_account(troot, p2);
  assert a->'wipes'->0->>'wiped_by' = (select username from public.accounts where id = (select v from smoke where k = 'aroot')::uuid)
     and a->'wipes'->0->'snapshot' = h, 'the wipe as the tab shows it';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p2, 'wipe')) = 'not pending', 'wiped once';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, (select v from smoke where k = 'p1'), 'wipe'))
         = 'not pending', 'nothing pending';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, gen_random_uuid(), 'wipe')) = 'not pending',
    'unknown account';
  -- room 1 is swept now; room 2 is not
  perform public._field_open(room, now());
  assert (select owner_id is null from public.field_plots where room_id = room and plot_no = 2)
     and (select owner_id = p2 from public.field_plots where room_id = room2 and plot_no = 2), 'released lazily';
end $$;

-- A later transaction: the pardon, and land bought after it.
do $$
declare p2 uuid := (select v from smoke where k = 'p2')::uuid; troot text := (select v from smoke where k = 'troot');
        room uuid := (select v from smoke where k = 'aroom')::uuid; room2 uuid := (select v from smoke where k = 'aroom2')::uuid;
        c jsonb; l record;
begin
  c := public.admin_anticheat_resolve(troot, p2, 'pardon');
  assert c->'ban_state' = 'null' and not (c->>'is_banned')::boolean and (c->>'active_strikes')::int = 0
     and (c->>'pardoned_at')::timestamptz = now() and c->'wiped_at' <> 'null', format('pardoned %s', c);
  select * into l from public.login((select username from public.accounts where id = p2), 'pw123456');
  assert (public.fishing_state(l.token)->>'coins')::int = 0 and public.fishing_state(l.token)->'fish' = '[]', 'back with zero data (R8)';
  perform pg_temp.set_coins(p2, 801000);
  perform public.buy_plot(room, l.token, 4);
  assert (select owned_at > (select wiped_at from public.anticheat_status where account_id = p2)
            from public.field_plots where room_id = room and plot_no = 4 and owner_id = p2), 'bought after the wipe';
  insert into smoke values ('p2token', l.token);
end $$;

do $$
declare p2 uuid := (select v from smoke where k = 'p2')::uuid; room uuid := (select v from smoke where k = 'aroom')::uuid;
        room2 uuid := (select v from smoke where k = 'aroom2')::uuid;
begin
  perform public._field_open(room, now());
  perform public._field_open(room2, now());
  assert (select owner_id = p2 from public.field_plots where room_id = room and plot_no = 4), 'land bought after the pardon stays (R11)';
  assert (select owner_id is null from public.field_plots where room_id = room2 and plot_no = 2), 'pre-wipe land is still released';
end $$;

do $$
declare n3 text := (select v from smoke where k = 'n3'); p3 uuid := (select v from smoke where k = 'p3')::uuid;
        p4 uuid := (select v from smoke where k = 'p4')::uuid; p5 uuid := (select v from smoke where k = 'p5')::uuid;
        n6 text := (select v from smoke where k = 'n6'); p6 uuid := (select v from smoke where k = 'p6')::uuid;
        troot text := (select v from smoke where k = 'troot'); c jsonb; r jsonb; bad int;
begin
  -- pardon while pending: unbanned, no strike, login works
  perform pg_temp.flag(p3);
  update public.anticheat_status set locked_until = null where account_id = p3;
  perform pg_temp.flag(p3);
  assert (pg_temp.status(p3)).ban_state = 'pending_wipe', 'p3 pending';
  c := public.admin_anticheat_resolve(troot, p3, 'pardon');
  assert c->'ban_state' = 'null' and (c->>'strikes')::int = 0 and not (c->>'is_banned')::boolean and c->'wiped_at' = 'null', 'pardon';
  perform public.login((select username from public.accounts where id = p3), 'pw123456');
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p3, 'pardon')) = 'nothing to pardon', 'twice';
  -- the Accounts tab's unban of an anti-cheat ban is the pardon (R9); a manual ban stays a plain ban
  perform pg_temp.flag(p4);
  update public.anticheat_status set locked_until = null where account_id = p4;
  perform pg_temp.flag(p4);
  perform public.admin_set_ban(troot, p4, false);
  assert not (select is_banned from public.accounts where id = p4)
     and (select ban_state is null and strikes = 0 and pardoned_at = now() from public.anticheat_status where account_id = p4),
    'admin_set_ban false = pardon';
  perform public.admin_set_ban(troot, p5, true);
  assert (select is_banned from public.accounts where id = p5) and not exists (select 1 from public.sessions where account_id = p5)
     and not exists (select 1 from public.anticheat_status where account_id = p5), 'a manual ban';
  assert pg_temp.err(format('select public.admin_anticheat_resolve(%L, %L, %L)', troot, p5, 'pardon')) = 'nothing to pardon',
    'a manual ban is not the anti-cheat''s';
  perform public.admin_set_ban(troot, p5, false);
  assert not (select is_banned from public.accounts where id = p5), 'a manual unban';
  -- the list: pending wipes first, then running locks, then by the last event
  perform pg_temp.flag(p5);
  update public.anticheat_status set locked_until = null where account_id = p5;
  perform pg_temp.flag(p5);
  r := public.water((select v from smoke where k = 'aroom')::uuid, n6, 5, 5);
  assert (r->'anticheat'->>'strike')::int = 1, 'p6 locked';
  r := public.admin_anticheat_list(troot);
  assert r->>'mode' = 'enforce' and (r->>'server_now')::timestamptz = now() and r->>'mode_changed_at' is not null, 'list header';
  assert exists (select 1 from jsonb_array_elements(r->'cases') x where x->>'account_id' = p6::text
                   and (x->>'locked_until')::timestamptz = now() + interval '5 minutes' and (x->>'active_strikes')::int = 1),
    'the locked case';
  assert (select count(*) from jsonb_object_keys(r->'cases'->0)) = 16, 'sixteen keys a case';
  select count(*) into bad from jsonb_array_elements(r->'cases') with ordinality a(x, i)
    join jsonb_array_elements(r->'cases') with ordinality b(y, j) on j > i
   where ((y->>'ban_state') = 'pending_wipe' and (x->>'ban_state') is distinct from 'pending_wipe')
      or ((x->>'ban_state') is distinct from 'pending_wipe' and (y->>'ban_state') is distinct from 'pending_wipe'
          and x->'locked_until' = 'null' and y->'locked_until' <> 'null');
  assert bad = 0, format('%s cases out of order', bad);
  -- back to log mode: running locks end, bans stay (R6)
  r := public.admin_anticheat_set_mode(troot, 'log');
  assert r->>'mode' = 'log' and (pg_temp.status(p6)).locked_until is null, 'the lock is lifted';
  assert (select is_banned from public.accounts where id = p5) and (pg_temp.status(p5)).ban_state = 'pending_wipe', 'the ban stays';
end $$;

select 'anticheat admin smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` with `ERROR:  select public.admin_anticheat_list('<token>')` — the first assertion of part 6 gets `function … does not exist` instead of `root role required`.

- [ ] **Step 3: Write section G**

**supabase/migrations/0015_anticheat.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- G. Admin (§10.5): root only, granted like the other admin_* RPCs ----------
-- One case as the /admin tab lists it; null for an unknown account.
create or replace function public._ac_case(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'account_id', a.id, 'username', a.username, 'is_root', a.is_root, 'is_banned', a.is_banned,
    'strikes', coalesce(s.strikes, 0),
    'active_strikes', case when s.ban_state is not null then 2
                           when s.strikes >= 1 and s.last_strike_at > now() - interval '30 days' then 1 else 0 end,
    'last_strike_at', s.last_strike_at, 'last_strike_code', s.last_strike_code,
    'locked_until', case when s.locked_until > now() then s.locked_until end,
    'ban_state', s.ban_state, 'banned_at', s.banned_at, 'wiped_at', s.wiped_at, 'pardoned_at', s.pardoned_at,
    'hard_events', (select count(*) from public.anticheat_events e where e.account_id = a.id and e.outcome <> 'soft'),
    'soft_events', (select count(*) from public.anticheat_events e where e.account_id = a.id and e.outcome = 'soft'),
    'last_event_at', (select max(e.created_at) from public.anticheat_events e where e.account_id = a.id))
  from public.accounts a left join public.anticheat_status s on s.account_id = a.id
  where a.id = p_account
$$;
revoke all on function public._ac_case(uuid) from public, anon, authenticated;

-- The mode and the cases: pending wipes first, then running locks, then by the last event; at most 200.
create or replace function public.admin_anticheat_list(p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare c public.anticheat_config;
begin
  perform public._auth_root(p_session_token);
  select * into c from public.anticheat_config where id;
  return jsonb_build_object(
    'mode', coalesce(c.mode, 'log'), 'mode_changed_at', c.mode_changed_at, 'server_now', now(),
    'cases', coalesce((
      select jsonb_agg(public._ac_case(x.account_id) order by x.pending desc, x.locked desc, x.last_event_at desc nulls last)
        from (select s.account_id,
                     coalesce(s.ban_state = 'pending_wipe', false) as pending,
                     coalesce(s.locked_until > now(), false) as locked,
                     (select max(e.created_at) from public.anticheat_events e where e.account_id = s.account_id) as last_event_at
                from public.anticheat_status s
               where s.strikes > 0 or s.ban_state is not null or s.locked_until > now() or s.pardoned_at is not null
                  or exists (select 1 from public.anticheat_events e
                              where e.account_id = s.account_id and e.created_at > now() - interval '90 days')
               order by pending desc, locked desc, last_event_at desc nulls last
               limit 200) x), '[]'::jsonb));
end $$;

-- One account: the case, what a wipe would remove now, the newest 300 events and the wipes with their snapshots.
create or replace function public.admin_anticheat_account(p_session_token text, p_account_id uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth_root(p_session_token);
  return jsonb_build_object(
    'case', public._ac_case(p_account_id),
    'holdings', public._ac_holdings(p_account_id),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'created_at', e.created_at, 'code', e.code, 'outcome', e.outcome,
                                          'rpc', e.rpc, 'room_id', e.room_id, 'detail', e.detail, 'client', e.client,
                                          'user_agent', e.user_agent) order by e.created_at desc, e.id desc)
        from (select * from public.anticheat_events where account_id = p_account_id
               order by created_at desc, id desc limit 300) e), '[]'::jsonb),
    'wipes', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'wiped_at', w.wiped_at, 'wiped_by', a.username, 'snapshot', w.snapshot)
                       order by w.wiped_at desc, w.id desc)
        from public.anticheat_wipes w left join public.accounts a on a.id = w.wiped_by
       where w.account_id = p_account_id), '[]'::jsonb));
end $$;

-- 'wipe' (§9.6: the wallet row, then the status row — R16) or 'pardon' (§9.7); the answer is the updated case.
create or replace function public.admin_anticheat_resolve(p_session_token text, p_account_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); s public.anticheat_status;
begin
  if p_action is null or p_action not in ('wipe', 'pardon') then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  if p_action = 'wipe' then
    if not exists (select 1 from public.accounts where id = p_account_id) then
      raise exception 'not pending' using errcode = '22023';
    end if;
    perform public._wallet_lock(p_account_id);
    select * into s from public.anticheat_status where account_id = p_account_id for update;
    if not found or s.ban_state is distinct from 'pending_wipe' then
      raise exception 'not pending' using errcode = '22023';
    end if;
    perform public._ac_wipe(p_account_id, v_root);
  else
    perform public._ac_pardon(p_account_id, v_root);
  end if;
  return public._ac_case(p_account_id);
end $$;

-- log or enforce; switching to log lifts the running locks, bans stay (R6).
create or replace function public.admin_anticheat_set_mode(p_session_token text, p_mode text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_root uuid := public._auth_root(p_session_token); c public.anticheat_config;
begin
  if p_mode is null or p_mode not in ('log', 'enforce') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  update public.anticheat_config set mode = p_mode, mode_changed_at = now(), mode_changed_by = v_root where id
  returning * into c;
  if p_mode = 'log' then
    update public.anticheat_status set locked_until = null where locked_until > now();
  end if;
  return jsonb_build_object('mode', c.mode, 'mode_changed_at', c.mode_changed_at);
end $$;

-- The Accounts tab's unban of an anti-cheat ban is the pardon (R9); everything else as in 0005.
create or replace function public.admin_set_ban(p_session_token text, p_account_id uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = public, extensions
as $$
declare v_self uuid;
begin
  v_self := public._auth_root(p_session_token);
  if p_account_id = v_self then raise exception 'cannot ban yourself' using errcode='42501'; end if;
  if not p_banned and exists (select 1 from public.anticheat_status where account_id = p_account_id and ban_state is not null) then
    perform public._ac_pardon(p_account_id, v_self);
    return;
  end if;
  update public.accounts set is_banned = p_banned where id = p_account_id;
  if p_banned then delete from public.sessions where account_id = p_account_id; end if;
end; $$;

grant execute on function public.admin_anticheat_list(text) to anon, authenticated;
grant execute on function public.admin_anticheat_account(text, uuid) to anon, authenticated;
grant execute on function public.admin_anticheat_resolve(text, uuid, text) to anon, authenticated;
grant execute on function public.admin_anticheat_set_mode(text, text) to anon, authenticated;
grant execute on function public.admin_set_ban(text, uuid, boolean) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/anticheat-sql.sh"`
Expected:

```text
v14 smoke ok
0015 twice ok
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
anticheat names and queue smoke ok
anticheat flow smoke ok
anticheat fishing smoke ok
anticheat farm smoke ok
anticheat shared functions smoke ok
anticheat admin smoke ok
anticheat guards ok
ALL OK
```

This is the database's final state: `0015` is complete. Keep the script — it is the owner's check after any later change to `0015`.

- [ ] **Step 5: Commit**

Commit message:

```text
feat(anticheat): 0015 admin RPCs — list, evidence, wipe, pardon and the mode switch

Section G: admin_anticheat_list (pending wipes, then running locks, then the latest events), admin_anticheat_account
(the case, the holdings a wipe would remove, the newest 300 events, the wipes and their snapshots),
admin_anticheat_resolve (the wipe under the wallet lock, or the pardon), admin_anticheat_set_mode (log lifts the running
locks) and admin_set_ban, whose unban of an anti-cheat ban is the pardon. All root only.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0015_anticheat.sql tests/sql/anticheat-smoke.sql
git commit -F <message file>
```

---

### Task 7: `lib/anticheat.ts` — the envelope, the lock, the texts and the event hub

**Files:**
- Create: `lib/anticheat.ts`
- Test: `tests/unit/anticheat.test.ts` (create)

**Interfaces:**
- Consumes: `syncClock(serverNow: string | number | null | undefined, receivedAt = Date.now())` and `serverNow(): number` from `@/lib/game/farm/clock` (the one server clock of the game, v15.1); the server's envelope `{"anticheat": {code, strike, error, locked_until, banned, server_now}}` (Task 2) and its `account locked` refusal (a PostgREST error with `message: "account locked"`, `details: "<seconds>"`, `hint: "anticheat"`).
- Produces (`@/lib/anticheat`):
  - `interface AnticheatInfo { code: string; strike: 0 | 1 | 2; error: string | null; lockedUntil: number | null; banned: boolean; serverNow: number | null }` (times in ms since the epoch);
  - `parseAnticheat(data: unknown): AnticheatInfo | null`; `class AnticheatError extends Error { readonly info: AnticheatInfo }` (`name` `"AnticheatError"`, `message` = `info.error ?? "anticheat"`); `lockSeconds(err: unknown): number | null` (the seconds of an `account locked` refusal);
  - the texts: `WARN_TITLE`, `WARN_BODY`, `WARN_LOCK`, `WARN_REPEAT`, `WARN_OK`, `BAN_TITLE`, `BAN_BODY`, `BAN_WIPE`, `BAN_OK`, `durationVi(sec)` ("59 giây", "1 phút", "2 phút 5 giây"), `lockText(sec)`, `chipText(sec)` ("🔒 4:07"), `chipLabel(sec)`, `reasonText(code)`;
  - the hub: `type AnticheatEvent = { kind: "strike"; info: AnticheatInfo } | { kind: "lock"; until: number; code: string | null }`, `reportAnticheat(info)`, `reportLock(untilMs, code)`, `subscribeAnticheat(fn) → unsubscribe`;
  - `screenAnswer(data: unknown, error: unknown): AnticheatInfo | null` — an `account locked` error reports a lock (`serverNow() + seconds`, code null); an envelope sets the server clock and reports a strike of 1 or 2; returns the envelope or null.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/anticheat.test.ts` with exactly:

```ts
import { afterEach, describe, it, expect, vi } from "vitest";
import { clockOffset, syncClock } from "@/lib/game/farm/clock";
import {
  AnticheatError, BAN_BODY, BAN_OK, BAN_TITLE, BAN_WIPE, chipLabel, chipText, durationVi, lockSeconds, lockText,
  parseAnticheat, reasonText, reportAnticheat, reportLock, screenAnswer, subscribeAnticheat, WARN_BODY, WARN_LOCK, WARN_OK,
  WARN_REPEAT, WARN_TITLE, type AnticheatEvent,
} from "@/lib/anticheat";

const ENVELOPE = {
  anticheat: {
    code: "bad_plot", strike: 1, error: "invalid plot", locked_until: "2026-10-02T10:20:00.000+00:00", banned: false,
    server_now: "2026-10-02T10:15:00.000+00:00",
  },
};

afterEach(() => {
  syncClock(0, 0);
  vi.useRealTimers();
});

describe("parseAnticheat", () => {
  it("reads the envelope of a flagged answer", () => {
    expect(parseAnticheat(ENVELOPE)).toEqual({
      code: "bad_plot", strike: 1, error: "invalid plot", lockedUntil: Date.parse("2026-10-02T10:20:00Z"), banned: false,
      serverNow: Date.parse("2026-10-02T10:15:00Z"),
    });
    const lost = {
      result: "lost", why: "too_early", state: {},
      anticheat: { code: "reel_too_fast", strike: 2, error: null, locked_until: null, banned: true, server_now: "2026-10-02T10:15:00.123456+00:00" },
    };
    expect(parseAnticheat(lost)).toEqual({
      code: "reel_too_fast", strike: 2, error: null, lockedUntil: null, banned: true, serverNow: Date.parse("2026-10-02T10:15:00.123Z"),
    });
  });

  it("fills what a strike-0 envelope leaves out", () => {
    expect(parseAnticheat({ anticheat: { code: "bad_qty", strike: 0 } })).toEqual({
      code: "bad_qty", strike: 0, error: null, lockedUntil: null, banned: false, serverNow: null,
    });
  });

  it("is null without an envelope, or with one it cannot read", () => {
    expect(parseAnticheat(null)).toBeNull();
    expect(parseAnticheat("anticheat")).toBeNull();
    expect(parseAnticheat({ state: {} })).toBeNull();
    expect(parseAnticheat({ anticheat: null })).toBeNull();
    expect(parseAnticheat({ anticheat: "bad_plot" })).toBeNull();
    expect(parseAnticheat({ anticheat: { code: "bad_plot", strike: 3 } })).toBeNull();
    expect(parseAnticheat({ anticheat: { code: "bad_plot", strike: "1" } })).toBeNull();
    expect(parseAnticheat({ anticheat: { code: 7, strike: 0 } })).toBeNull();
  });
});

describe("AnticheatError", () => {
  it("carries the envelope, with the refusal it stands for as its message", () => {
    const info = parseAnticheat(ENVELOPE)!;
    const e = new AnticheatError(info);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AnticheatError");
    expect(e.message).toBe("invalid plot");
    expect(e.info).toBe(info);
    expect(new AnticheatError({ ...info, error: null }).message).toBe("anticheat");
  });
});

describe("lockSeconds", () => {
  it("reads the seconds of an account locked refusal", () => {
    expect(lockSeconds({ message: "account locked", details: "125", hint: "anticheat" })).toBe(125);
    expect(lockSeconds({ message: "account locked", details: 7 })).toBe(7);
  });
  it("is null for any other error, or without readable seconds", () => {
    expect(lockSeconds({ message: "account locked", details: null })).toBeNull();
    expect(lockSeconds({ message: "account locked", details: "" })).toBeNull();
    expect(lockSeconds({ message: "account locked", details: "soon" })).toBeNull();
    expect(lockSeconds({ message: "cast limit", details: "300" })).toBeNull();
    expect(lockSeconds(new Error("account locked"))).toBeNull();
    expect(lockSeconds(null)).toBeNull();
  });
});

describe("the Vietnamese texts (spec §12.2)", () => {
  it("says a duration in minutes and seconds, at least one second", () => {
    expect(durationVi(0.2)).toBe("1 giây");
    expect(durationVi(0)).toBe("1 giây");
    expect(durationVi(59)).toBe("59 giây");
    expect(durationVi(59.5)).toBe("1 phút");
    expect(durationVi(60)).toBe("1 phút");
    expect(durationVi(125)).toBe("2 phút 5 giây");
    expect(durationVi(300)).toBe("5 phút");
  });

  it("builds the lock toast, the chip and its label", () => {
    expect(lockText(125)).toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 2 phút 5 giây.");
    expect(chipText(247)).toBe("🔒 4:07");
    expect(chipText(300)).toBe("🔒 5:00");
    expect(chipText(4.2)).toBe("🔒 0:05");
    expect(chipLabel(247)).toBe("Tạm khoá trò chơi — còn 4 phút 7 giây");
    expect(chipLabel(60)).toBe("Tạm khoá trò chơi — còn 1 phút");
  });

  it("gives a reason for every signal", () => {
    expect(reasonText("reel_too_fast")).toBe("Báo kéo được cá nhanh hơn mức trò chơi cho phép.");
    expect(reasonText("quality_range")).toBe("Gửi điểm cấy/gặt ngoài phạm vi của trò chơi.");
    for (const code of ["bad_plot", "bad_slot", "bad_water", "bad_work", "bad_qty", "bad_price", "foreign_offer",
      "kind_mismatch", "reel_gate_hug", "cast_daily_cap", "something_new"]) {
      expect(reasonText(code)).toBe("Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.");
    }
  });

  it("keeps the modal texts verbatim", () => {
    expect(WARN_TITLE).toBe("⚠️ Cảnh báo gian lận");
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất và mua bán ở các tiệm trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
    expect(WARN_OK).toBe("Tôi đã hiểu");
    expect(BAN_TITLE).toBe("🚫 Tài khoản bị khoá vĩnh viễn");
    expect(BAN_BODY).toBe("Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.");
    expect(BAN_WIPE).toBe("Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất).");
    expect(BAN_OK).toBe("Đăng xuất");
  });
});

describe("the event hub", () => {
  it("tells every listener about strikes and locks until it unsubscribes", () => {
    const a: AnticheatEvent[] = [];
    const b: AnticheatEvent[] = [];
    const offA = subscribeAnticheat((e) => a.push(e));
    const offB = subscribeAnticheat((e) => b.push(e));
    const info = parseAnticheat(ENVELOPE)!;
    reportAnticheat(info);
    reportLock(1234, "reel_too_fast");
    offA();
    reportLock(5678, null);
    offB();
    reportLock(9, null);
    expect(a).toEqual([{ kind: "strike", info }, { kind: "lock", until: 1234, code: "reel_too_fast" }]);
    expect(b).toEqual([...a, { kind: "lock", until: 5678, code: null }]);
  });
});

describe("screenAnswer", () => {
  it("sets the server clock from an envelope and reports a strike", () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T10:14:00Z")); // this client runs a minute behind the server
    const info = screenAnswer(ENVELOPE, null);
    expect(info).toMatchObject({ code: "bad_plot", strike: 1, error: "invalid plot" });
    expect(clockOffset()).toBe(60_000);
    expect(events).toEqual([{ kind: "strike", info }]);
    // a strike-0 envelope sets the clock but reports nothing
    expect(screenAnswer({ anticheat: { ...ENVELOPE.anticheat, strike: 0, locked_until: null } }, null)).toMatchObject({ strike: 0 });
    expect(events).toHaveLength(1);
    expect(screenAnswer({ state: {} }, null)).toBeNull();
    off();
  });

  it("reports the lock of an account locked refusal on the server clock", () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T10:14:00Z"));
    syncClock("2026-10-02T10:15:00Z");
    expect(screenAnswer(null, { message: "account locked", details: "125", hint: "anticheat" })).toBeNull();
    expect(events).toEqual([{ kind: "lock", until: Date.parse("2026-10-02T10:17:05Z"), code: null }]);
    expect(screenAnswer(null, { message: "not enough coins" })).toBeNull();
    expect(events).toHaveLength(1);
    off();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/anticheat.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/anticheat"`.

- [ ] **Step 3: Write `lib/anticheat.ts`**

Create `lib/anticheat.ts` with exactly:

```ts
import { serverNow, syncClock } from "@/lib/game/farm/clock";

// The client half of the anti-cheat layer (spec §12.1): the envelope a flagged RPC returns instead of raising, the lock
// a guarded RPC raises, the Vietnamese texts of the warning, the lock and the ban (§12.2), and a small hub the game
// shell listens to. Pure, apart from the hub and screenAnswer.

/** The `anticheat` envelope of a flagged answer (§9.1). Times are ms since the epoch on the server's clock. */
export interface AnticheatInfo {
  /** The signal (§7.2, §7.4). */
  code: string;
  /** 0 recorded only · 1 warning and a 5-minute lock · 2 ban. */
  strike: 0 | 1 | 2;
  /** The refusal the call stands for; null for finish_cast. */
  error: string | null;
  /** Strike 1: the end of the lock. */
  lockedUntil: number | null;
  banned: boolean;
  serverNow: number | null;
}

const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** The envelope of an RPC answer; null when there is none or it cannot be read. */
export function parseAnticheat(data: unknown): AnticheatInfo | null {
  const a = data && typeof data === "object" ? (data as { anticheat?: unknown }).anticheat : null;
  if (!a || typeof a !== "object") return null;
  const r = a as Record<string, unknown>;
  const code = r.code;
  const strike = r.strike;
  if (typeof code !== "string" || (strike !== 0 && strike !== 1 && strike !== 2)) return null;
  return {
    code, strike, error: typeof r.error === "string" ? r.error : null, lockedUntil: time(r.locked_until),
    banned: r.banned === true, serverNow: time(r.server_now),
  };
}

/** A flagged call's refusal. Its message is the refusal the call stands for, so the fishing and farm error texts
 *  translate a strike-0 envelope as before (§13). */
export class AnticheatError extends Error {
  readonly info: AnticheatInfo;
  constructor(info: AnticheatInfo) {
    super(info.error ?? "anticheat");
    this.name = "AnticheatError";
    this.info = info;
  }
}

/** The seconds left of the lock an `account locked` refusal reports in its details; null for any other error. */
export function lockSeconds(err: unknown): number | null {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; details?: unknown };
  const n = typeof e.details === "number" ? e.details
    : typeof e.details === "string" && e.details.trim() !== "" ? Number(e.details) : NaN;
  return e.message === "account locked" && Number.isFinite(n) ? n : null;
}

export const WARN_TITLE = "⚠️ Cảnh báo gian lận";
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất và mua bán ở các tiệm trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
export const WARN_OK = "Tôi đã hiểu";
export const BAN_TITLE = "🚫 Tài khoản bị khoá vĩnh viễn";
export const BAN_BODY = "Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.";
export const BAN_WIPE = "Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất).";
export const BAN_OK = "Đăng xuất";

/** Whole seconds, at least 1. */
const whole = (sec: number): number => Math.max(1, Math.ceil(Number.isFinite(sec) ? sec : 0));

/** "59 giây", "1 phút", "2 phút 5 giây". */
export function durationVi(sec: number): string {
  const n = whole(sec);
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m === 0) return `${s} giây`;
  return s === 0 ? `${m} phút` : `${m} phút ${s} giây`;
}

/** The toast of an action refused during the lock. */
export function lockText(sec: number): string {
  return `🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn ${durationVi(sec)}.`;
}

/** The player card's countdown: "🔒 4:07". */
export function chipText(sec: number): string {
  const n = whole(sec);
  return `🔒 ${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/** The chip's title and aria-label. */
export function chipLabel(sec: number): string {
  return `Tạm khoá trò chơi — còn ${durationVi(sec)}`;
}

/** Why the warning or the ban came, for the modal's "Lý do:" line. */
export function reasonText(code: string): string {
  switch (code) {
    case "reel_too_fast": return "Báo kéo được cá nhanh hơn mức trò chơi cho phép.";
    case "quality_range": return "Gửi điểm cấy/gặt ngoài phạm vi của trò chơi.";
    default: return "Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.";
  }
}

/** What the hub passes on: a strike (1 or 2) from an envelope, or a running lock. The code of a lock is known from
 *  fishing_state's `lock`, and unknown (null) when the lock comes from an `account locked` refusal. */
export type AnticheatEvent =
  | { kind: "strike"; info: AnticheatInfo }
  | { kind: "lock"; until: number; code: string | null };

const listeners = new Set<(e: AnticheatEvent) => void>();

function emit(e: AnticheatEvent): void {
  for (const fn of [...listeners]) fn(e);
}

export function reportAnticheat(info: AnticheatInfo): void {
  emit({ kind: "strike", info });
}

/** A lock running until `untilMs` on the server's clock. */
export function reportLock(untilMs: number, code: string | null): void {
  emit({ kind: "lock", until: untilMs, code });
}

export function subscribeAnticheat(fn: (e: AnticheatEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** What the fishing and farm `call()` do first with an RPC answer (§12.1): an `account locked` refusal reports the
 *  lock; an envelope sets the server clock and reports a strike of 1 or 2. Returns the envelope, or null. */
export function screenAnswer(data: unknown, error: unknown): AnticheatInfo | null {
  const sec = lockSeconds(error);
  if (sec !== null) reportLock(serverNow() + sec * 1000, null);
  if (error) return null;
  const info = parseAnticheat(data);
  if (!info) return null;
  syncClock(info.serverNow);
  if (info.strike > 0) reportAnticheat(info);
  return info;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm vitest run tests/unit/anticheat.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/anticheat.ts tests/unit/anticheat.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(anticheat): lib/anticheat — the envelope, the lock, the texts and the event hub

parseAnticheat reads the anticheat envelope a flagged RPC returns; AnticheatError carries it with the refusal as its
message; lockSeconds reads an account locked refusal; durationVi, lockText, chipText, chipLabel, reasonText and the
warning and ban constants are the Vietnamese texts of spec §12.2; reportAnticheat, reportLock and subscribeAnticheat
are the hub the game shell listens to; screenAnswer is what the fishing and farm call() do first with an answer.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/anticheat.ts tests/unit/anticheat.test.ts
git commit -F <message file>
```

---

### Task 8: The RPC wrappers read the envelope; the daily cast cap and the lock in the fishing state

**Files:**
- Modify: `lib/game/fishing/rpc.ts`, `lib/game/farm/rpc.ts` (`call()` screens every answer; `finishCast` keeps its envelope; the error texts)
- Modify: `lib/game/fishing/state.ts` (`castsTodayLeft`, `dayResetsAt`, `lock`, `dayCapped`, the `daily_limit` blocker)
- Modify: `lib/game/fishing/messages.ts`, `lib/game/farm/messages.ts` (the daily-cap and lock texts)
- Modify: `hooks/useFishing.ts`, `hooks/useField.ts`, `hooks/useCastSession.ts`, `hooks/useFishingController.ts`
- Test: `tests/unit/fishing-rpc.test.ts`, `tests/unit/farm-rpc.test.ts`, `tests/unit/fishing-state.test.ts`, `tests/unit/fishing-messages.test.ts`, `tests/unit/farm-messages.test.ts`, `tests/unit/use-fishing.test.tsx`, `tests/unit/use-field.test.tsx`, `tests/unit/use-cast-session.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 7's `AnticheatError`, `AnticheatInfo`, `parseAnticheat`, `screenAnswer`, `lockSeconds`, `lockText`, `reportLock`; Task 5's `fishing_state` keys `casts_today_left`, `day_resets_at`, `lock` and Task 3's `daily cast limit` refusal; from v14/v15.1: `call(fn, args)` in both `rpc.ts`, `FinishCast`, `finishCast`, `fishingErrorMessage(err)`, `farmErrorMessage(err, itemName)`, `parseFishingState`, `FishingState`, `castBlocker(s, now)`, `blockerText`, `promptText`, the hooks' `onError` / `onErrorRef` toasts.
- Produces:
  - `lib/game/fishing/rpc.ts`: `call()` runs `screenAnswer(data, error)` first; an envelope throws `AnticheatError`, except for `finish_cast`, whose lost answer carries it: `FinishCast` lost variant `{ result: "lost"; why: LostWhy; state: FishingState; anticheat?: AnticheatInfo | null }` (`finishCast` always sets `anticheat`); `fishingErrorMessage` maps `account locked` → `lockText(seconds ?? 300)` and `daily cast limit` → `DAILY_LIMIT_TEXT`;
  - `lib/game/farm/rpc.ts`: `call()` throws `AnticheatError` for any envelope; `lib/game/farm/messages.ts`: `farmErrorMessage` maps `account locked` like fishing;
  - `lib/game/fishing/state.ts`: `interface FishingLock { until: string; code: string }`; `FishingState` gains `castsTodayLeft: number` (default 300), `dayResetsAt: string | null`, `lock: FishingLock | null`; `dayCapped(s: FishingState, now: number): boolean`; `CastBlocker` gains `"daily_limit"`, returned right after `"cast_limit"`;
  - `lib/game/fishing/messages.ts`: `DAILY_LIMIT_TEXT = "Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!"`; `blockerText("daily_limit")`; a fishing spot's prompt says "Hết lượt câu hôm nay" while `dayCapped`;
  - `useFishing` reports `state.lock` with `reportLock(Date.parse(until), code)`; `useFishing`, `useField` and `useCastSession` show no toast for an `AnticheatError` of strike ≥ 1 (they still refetch); `useFishingController`'s prompt clock also ticks while `dayCapped`.

- [ ] **Step 1: Write the failing tests**

**tests/unit/fishing-rpc.test.ts — edit 1 of 4.** Replace:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
```

with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

**tests/unit/fishing-rpc.test.ts — edit 2 of 4.** Replace:

```ts

import { fetchFishingBoard, fetchFishingCatalog, finishCast, fishingErrorMessage, sellFish, startCast } from "@/lib/game/fishing/rpc";
```

with:

```ts

import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import {
  buyItem, fetchFishingBoard, fetchFishingCatalog, finishCast, fishingErrorMessage, sellFish, startCast,
} from "@/lib/game/fishing/rpc";
```

**tests/unit/fishing-rpc.test.ts — edit 3 of 4.** Replace:

```ts

describe("fishingErrorMessage", () => {
```

with:

```ts

describe("the anti-cheat envelope (anti-cheat spec §12.1)", () => {
  const envelope = (strike: 0 | 1 | 2) => ({
    code: "bad_qty", strike, error: "invalid quantity", locked_until: strike === 1 ? "2026-10-02T10:20:00+00:00" : null,
    banned: strike === 2, server_now: "2026-10-02T10:15:00+00:00",
  });
  const events: AnticheatEvent[] = [];
  let off = () => {};
  beforeEach(() => {
    events.length = 0;
    off = subscribeAnticheat((e) => events.push(e));
  });
  afterEach(() => off());

  it("throws an AnticheatError for every strike, and reports strikes 1 and 2", async () => {
    for (const strike of [0, 1, 2] as const) {
      h.rpc.mockResolvedValueOnce({ data: { anticheat: envelope(strike) }, error: null });
      const err = await buyItem("tok", "bait_shrimp", 500).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AnticheatError);
      expect(err).toMatchObject({ message: "invalid quantity", info: { code: "bad_qty", strike } });
    }
    expect(events.map((e) => (e.kind === "strike" ? e.info.strike : null))).toEqual([1, 2]);
  });

  it("returns the lost answer of finish_cast with its envelope", async () => {
    h.rpc.mockResolvedValueOnce({
      data: { result: "lost", why: "too_early", state: STATE, anticheat: { ...envelope(1), code: "reel_too_fast", error: null } },
      error: null,
    });
    expect(await finishCast("tok", "c1", true)).toMatchObject({
      result: "lost", why: "too_early", anticheat: { code: "reel_too_fast", strike: 1, error: null },
    });
    expect(events).toHaveLength(1);
    h.rpc.mockResolvedValueOnce({ data: { result: "lost", why: "gave_up", state: STATE }, error: null });
    expect(await finishCast("tok", "c1", false)).toMatchObject({ result: "lost", why: "gave_up", anticheat: null });
  });

  it("reports the lock of an account locked refusal, then throws it", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "account locked", details: "125", hint: "anticheat" } });
    await expect(sellFish("tok", ["x"])).rejects.toMatchObject({ message: "account locked" });
    expect(events).toEqual([{ kind: "lock", until: expect.any(Number), code: null }]);
  });
});

describe("fishingErrorMessage", () => {
```

**tests/unit/fishing-rpc.test.ts — edit 4 of 4.** Replace:

```ts
    expect(fishingErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
});
```

with:

```ts
    expect(fishingErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
  it("tells a locked account how long the lock runs, and a capped angler to come back tomorrow (anti-cheat §13)", () => {
    expect(fishingErrorMessage({ message: "account locked", details: "125", hint: "anticheat" }))
      .toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 2 phút 5 giây.");
    expect(fishingErrorMessage({ message: "daily cast limit", details: "3600" })).toBe("Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!");
    const info = { code: "bad_qty", strike: 0 as const, error: "invalid quantity", lockedUntil: null, banned: false, serverNow: null };
    expect(fishingErrorMessage(new AnticheatError(info))).toBe("Món này không mua được.");
  });
});
```

**tests/unit/farm-rpc.test.ts — edit 1 of 2.** Replace:

```ts

import { actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice } from "@/lib/game/farm/rpc";
```

with:

```ts

import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import { actionCall, buyFarmItem, claimFarmGift, fetchFarmCatalog, fetchFieldState, fieldAction, sellRice } from "@/lib/game/farm/rpc";
```

**tests/unit/farm-rpc.test.ts — edit 2 of 2.** Append at the end of the file, after a blank line:

```ts
describe("the anti-cheat envelope (anti-cheat spec §12.1)", () => {
  it("throws an AnticheatError for an envelope, reports a strike, and reports a lock", async () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    const envelope = { code: "bad_water", strike: 0, error: "invalid quantity", locked_until: null, banned: false, server_now: "2026-10-02T10:15:00+00:00" };
    h.rpc.mockResolvedValueOnce({ data: { anticheat: envelope }, error: null });
    const err = await fieldAction("r", "tok", { kind: "water", plot: 7, delta: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnticheatError);
    expect(err).toMatchObject({ message: "invalid quantity", info: { code: "bad_water", strike: 0 } });
    expect(events).toEqual([]);
    h.rpc.mockResolvedValueOnce({
      data: { anticheat: { ...envelope, code: "bad_qty", strike: 1, locked_until: "2026-10-02T10:20:00+00:00" } }, error: null,
    });
    await expect(sellRice("tok", "nep", true, 0)).rejects.toBeInstanceOf(AnticheatError);
    expect(events).toMatchObject([{ kind: "strike", info: { code: "bad_qty", strike: 1 } }]);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "account locked", details: "60", hint: "anticheat" } });
    await expect(claimFarmGift("tok")).rejects.toMatchObject({ message: "account locked" });
    expect(events[1]).toEqual({ kind: "lock", until: expect.any(Number), code: null });
    off();
  });
});
```

**tests/unit/fishing-state.test.ts — edit 1 of 2.** Replace:

```ts
import {
  baitTotal, castBlocker, castWaitMin, digWaitSec, handFish, maxBuyQty, ownsItem, parseFishingState, type FishingState,
} from "@/lib/game/fishing/state";
```

with:

```ts
import {
  baitTotal, castBlocker, castWaitMin, dayCapped, digWaitSec, handFish, maxBuyQty, ownsItem, parseFishingState, type FishingState,
} from "@/lib/game/fishing/state";
```

**tests/unit/fishing-state.test.ts — edit 2 of 2.** Replace:

```ts
    });
  });
```

with:

```ts
    });
  });
});

describe("the daily cap and the lock (anti-cheat spec §10.4)", () => {
  it("reads casts_today_left, day_resets_at and the running lock", () => {
    const s = parseFishingState({
      ...RAW, casts_today_left: 0, day_resets_at: "2026-09-24T17:00:00Z", lock: { until: "2026-09-24T10:35:00Z", code: "bad_qty" },
    });
    expect(s).toMatchObject({ castsTodayLeft: 0, dayResetsAt: "2026-09-24T17:00:00Z", lock: { until: "2026-09-24T10:35:00Z", code: "bad_qty" } });
    expect(S).toMatchObject({ castsTodayLeft: 300, dayResetsAt: null, lock: null });
    expect(parseFishingState({ ...RAW, lock: { until: "soon", code: "bad_qty" } })?.lock).toBeNull();
    expect(parseFishingState({ ...RAW, lock: "bad_qty" })?.lock).toBeNull();
  });
  it("blocks a cast at the daily cap until the Vietnam day turns, after the hourly cap", () => {
    const capped = withS({ castsTodayLeft: 0, dayResetsAt: "2026-09-24T17:00:00Z" });
    expect(dayCapped(capped, NOW)).toBe(true);
    expect(castBlocker(capped, NOW)).toBe("daily_limit");
    expect(dayCapped(capped, Date.parse("2026-09-24T17:00:00Z"))).toBe(false);
    expect(castBlocker(capped, Date.parse("2026-09-24T17:00:00Z"))).toBeNull();
    expect(castBlocker({ ...capped, castsLeft: 0 }, NOW)).toBe("cast_limit");
    expect(castBlocker({ ...capped, fish: [...S.fish, ...S.fish, ...S.fish] }, NOW)).toBe("daily_limit");
    expect(dayCapped(S, NOW)).toBe(false);
  });
```

**tests/unit/fishing-messages.test.ts — edit 1 of 3.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { blockerText, castRefusal, dailyText, digText, digWaitText, lostText, promptText, saleText } from "@/lib/game/fishing/messages";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

with:

```ts
import { describe, it, expect } from "vitest";
import {
  blockerText, castRefusal, DAILY_LIMIT_TEXT, dailyText, digText, digWaitText, lostText, promptText, saleText,
} from "@/lib/game/fishing/messages";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

**tests/unit/fishing-messages.test.ts — edit 2 of 3.** Replace:

```ts
    expect(blockerText("cast_limit", 0)).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 1 phút).");
  });
```

with:

```ts
    expect(blockerText("cast_limit", 0)).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 1 phút).");
    expect(blockerText("daily_limit", 0)).toBe("Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!");
    expect(DAILY_LIMIT_TEXT).toBe("Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!");
  });
```

**tests/unit/fishing-messages.test.ts — edit 3 of 3.** Replace:

```ts
    expect(promptText(spot, withS({ castsLeft: 0 }), NOW)).toBe("Nghỉ tay — còn 30 phút");
  });
```

with:

```ts
    expect(promptText(spot, withS({ castsLeft: 0 }), NOW)).toBe("Nghỉ tay — còn 30 phút");
  });
  it("tells an angler at the daily cap that today is over (anti-cheat §12.4)", () => {
    const spot = it_("fish_spot", "Quăng cần");
    const capped = withS({ castsTodayLeft: 0, dayResetsAt: "2026-09-24T17:00:00Z" });
    expect(promptText(spot, capped, NOW)).toBe("Hết lượt câu hôm nay");
    expect(promptText(spot, { ...capped, castsLeft: 0 }, NOW)).toBe("Nghỉ tay — còn 30 phút");
    expect(promptText(spot, capped, Date.parse("2026-09-24T17:00:00Z"))).toBe("Quăng cần");
    expect(castRefusal({ ...capped, bait: { bait_worm: 1 } }, false, NOW, false)).toBe("Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!");
  });
```

**tests/unit/farm-messages.test.ts — edit 1 of 2.** Replace:

```ts
} from "@/lib/game/farm/messages";
```

with:

```ts
} from "@/lib/game/farm/messages";
import { AnticheatError } from "@/lib/anticheat";
```

**tests/unit/farm-messages.test.ts — edit 2 of 2.** Replace:

```ts
    expect(farmErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
```

with:

```ts
    expect(farmErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
  it("tells a locked account how long the lock runs, and reads a strike-0 envelope as its refusal (anti-cheat §13)", () => {
    expect(farmErrorMessage({ message: "account locked", details: "125", hint: "anticheat" }))
      .toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 2 phút 5 giây.");
    const info = { code: "bad_price", strike: 0 as const, error: "invalid price", lockedUntil: null, banned: false, serverNow: null };
    expect(farmErrorMessage(new AnticheatError(info))).toBe("Số không hợp lệ.");
    expect(farmErrorMessage({ message: "account banned" })).toBe("Tài khoản đã bị khoá.");
  });
```

**tests/unit/use-fishing.test.tsx — edit 1 of 3.** Replace:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { clockOffset } from "@/lib/game/farm/clock";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

with:

```tsx
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { AnticheatError, subscribeAnticheat, type AnticheatEvent, type AnticheatInfo } from "@/lib/anticheat";
import { clockOffset, serverNow } from "@/lib/game/farm/clock";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
```

**tests/unit/use-fishing.test.tsx — edit 2 of 3.** Replace:

```tsx
    expect(result.current.state?.coins).toBe(44);
  });
```

with:

```tsx
    expect(result.current.state?.coins).toBe(44);
  });

  it("shows no toast for a strike, which the modal shows instead, but fetches again (anti-cheat §12.1)", async () => {
    const errors: string[] = [];
    const { result } = renderHook(() => useFishing("tok", (t) => errors.push(t)));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const info = (strike: 0 | 1 | 2): AnticheatInfo => ({
      code: "bad_qty", strike, error: "invalid quantity", lockedUntil: null, banned: strike === 2, serverNow: null,
    });
    rpc.fetchFishingState.mockClear();
    rpc.buyItem.mockRejectedValueOnce(new AnticheatError(info(1)));
    await act(async () => { expect(await result.current.buy("bait_shrimp", 500)).toBe(false); });
    rpc.buyItem.mockRejectedValueOnce(new AnticheatError(info(2)));
    await act(async () => { expect(await result.current.buy("bait_shrimp", 500)).toBe(false); });
    await flush();
    expect(errors).toEqual([]);
    expect(rpc.fetchFishingState).toHaveBeenCalledTimes(2);
    rpc.buyItem.mockRejectedValueOnce(new AnticheatError(info(0)));
    await act(async () => { await result.current.buy("bait_shrimp", 500); });
    expect(errors).toEqual(["Món này không mua được."]);
  });

  it("reports the running lock a state carries (anti-cheat R14)", async () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    rpc.fetchFishingState.mockResolvedValue(state({ lock: { until: "2026-10-02T10:20:00+00:00", code: "bad_plot" } }));
    renderHook(() => useFishing("tok", () => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    off();
    expect(events).toEqual([{ kind: "lock", until: Date.parse("2026-10-02T10:20:00Z"), code: "bad_plot" }]);
  });
```

**tests/unit/use-fishing.test.tsx — edit 3 of 3.** Replace:

```tsx

  it("does not dig into a full bait box", async () => {
```

with:

```tsx

  it("shows the daily cap at a fishing spot until the day turns (anti-cheat §12.4)", async () => {
    const capped = () => state({ casts_today_left: 0, day_resets_at: new Date(serverNow() + 5000).toISOString() });
    const first = capped();
    rpc.fetchFishingState.mockResolvedValue(first);
    rpc.claimDaily.mockResolvedValue({ claimed: false, amount: 0, state: first });
    const { result } = setup();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const spot = { id: "fish_1", kind: "fish_spot" as const, label: "x", prompt: "Quăng cần", rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 0, y: 0 } };
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.promptText(spot)).toBe("Hết lượt câu hôm nay");
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.promptText(spot)).toBe("Quăng cần");
  });

  it("does not dig into a full bait box", async () => {
```

**tests/unit/use-field.test.tsx — edit 1 of 2.** Replace:

```tsx
import { act, cleanup, renderHook } from "@testing-library/react";
import { clockOffset } from "@/lib/game/farm/clock";
```

with:

```tsx
import { act, cleanup, renderHook } from "@testing-library/react";
import { AnticheatError, type AnticheatInfo } from "@/lib/anticheat";
import { clockOffset } from "@/lib/game/farm/clock";
```

**tests/unit/use-field.test.tsx — edit 2 of 2.** Replace:

```tsx

  it("keeps the newest answer when answers overtake each other", async () => {
```

with:

```tsx

  it("shows no toast for a strike but fetches again; a strike-0 envelope toasts its refusal (anti-cheat §12.1)", async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useField("r", "tok", true, onError));
    await flush();
    rpc.fetchFieldState.mockClear();
    const info = (strike: 0 | 1 | 2, error: string): AnticheatInfo => ({
      code: "bad_plot", strike, error, lockedUntil: null, banned: strike === 2, serverNow: null,
    });
    rpc.fieldAction.mockRejectedValueOnce(new AnticheatError(info(1, "invalid plot")));
    await act(async () => { expect(await result.current.run({ kind: "rent", plot: 11 })).toBeNull(); });
    rpc.buyFarmItem.mockRejectedValueOnce(new AnticheatError(info(2, "invalid quantity")));
    await act(async () => { expect(await result.current.buyItem("fert_urea", 100)).toBeNull(); });
    await flush();
    expect(onError).not.toHaveBeenCalled();
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    rpc.fieldAction.mockRejectedValueOnce(new AnticheatError(info(0, "invalid price")));
    await act(async () => { await result.current.run({ kind: "list", plot: 1, price: 0 }); });
    expect(onError).toHaveBeenCalledWith("Số không hợp lệ.");
  });

  it("keeps the newest answer when answers overtake each other", async () => {
```

**tests/unit/use-cast-session.test.tsx.** Replace:

```tsx

  it("gives the cast up quietly when abandoned, even before start_cast answered", async () => {
```

with:

```tsx

  it("shows no lost toast when the reel came back as a strike (anti-cheat §12.1)", async () => {
    const ac = (strike: 0 | 1 | 2) => ({ code: "reel_too_fast", strike, error: null, lockedUntil: null, banned: strike === 2, serverNow: null });
    const struck = setup(async () => answer(), async () => ({ result: "lost", why: "too_early", state: STATE, anticheat: ac(1) }));
    act(() => struck.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    act(() => struck.result.current.hook());
    await act(async () => { struck.result.current.reelDone(true); await vi.advanceTimersByTimeAsync(0); });
    expect(struck.finishCast).toHaveBeenCalledWith("c1", true);
    expect(struck.toasts).toEqual([]);
    expect(struck.canvas.setFishing).toHaveBeenLastCalledWith({ phase: "idle" });
    const logged = setup(async () => answer(), async () => ({ result: "lost", why: "too_early", state: STATE, anticheat: ac(0) }));
    act(() => logged.result.current.cast(SPOT));
    await act(async () => { await vi.advanceTimersByTimeAsync(4100); });
    act(() => logged.result.current.hook());
    await act(async () => { logged.result.current.reelDone(true); await vi.advanceTimersByTimeAsync(0); });
    expect(logged.toasts).toEqual(["Cá đã thoát!"]);
  });

  it("gives the cast up quietly when abandoned, even before start_cast answered", async () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/fishing-rpc.test.ts tests/unit/farm-rpc.test.ts tests/unit/fishing-state.test.ts tests/unit/fishing-messages.test.ts tests/unit/farm-messages.test.ts tests/unit/use-fishing.test.tsx tests/unit/use-field.test.tsx tests/unit/use-cast-session.test.tsx`
Expected: FAIL — 15 tests fail (no envelope handling, no daily cap or lock in the state, no lock or daily-cap texts, toasts for strikes), 70 pass.

- [ ] **Step 3: Implement**

**lib/game/fishing/rpc.ts — edit 1 of 6.** Replace:

```ts
import { supabase } from "@/lib/supabase";
```

with:

```ts
import { AnticheatError, lockSeconds, lockText, parseAnticheat, screenAnswer, type AnticheatInfo } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
```

**lib/game/fishing/rpc.ts — edit 2 of 6.** Replace:

```ts
} from "./catalog";
import { parseFishPrices, type FishPrices } from "./prices";
```

with:

```ts
} from "./catalog";
import { DAILY_LIMIT_TEXT } from "./messages";
import { parseFishPrices, type FishPrices } from "./prices";
```

**lib/game/fishing/rpc.ts — edit 3 of 6.** Replace:

```ts

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
```

with:

```ts

/** An RPC's answer. A flagged answer (anti-cheat §9.1) throws an AnticheatError, except finish_cast's: its envelope
 *  rides on the lost answer. */
async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged && fn !== "finish_cast") throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
```

**lib/game/fishing/rpc.ts — edit 4 of 6.** Replace:

```ts
  | { result: "caught"; fish: CaughtFish; record: boolean; state: FishingState }
  | { result: "lost"; why: LostWhy; state: FishingState };
```

with:

```ts
  | { result: "caught"; fish: CaughtFish; record: boolean; state: FishingState }
  /** `anticheat`: the envelope of a reel reported too fast (finishCast always sets it; null when there is none). */
  | { result: "lost"; why: LostWhy; state: FishingState; anticheat?: AnticheatInfo | null };
```

**lib/game/fishing/rpc.ts — edit 5 of 6.** Replace:

```ts
  const why: LostWhy = r.why === "expired" || r.why === "too_early" || r.why === "full" ? r.why : "gave_up";
  return { result: "lost", why, state };
}
```

with:

```ts
  const why: LostWhy = r.why === "expired" || r.why === "too_early" || r.why === "full" ? r.why : "gave_up";
  return { result: "lost", why, state, anticheat: parseAnticheat(r) };
}
```

**lib/game/fishing/rpc.ts — edit 6 of 6.** Replace:

```ts
    case "fish not found": return "Con cá này không còn nữa.";
  }
```

with:

```ts
    case "fish not found": return "Con cá này không còn nữa.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
    case "daily cast limit": return DAILY_LIMIT_TEXT;
  }
```

**lib/game/farm/rpc.ts — edit 1 of 2.** Replace:

```ts
import { supabase } from "@/lib/supabase";
```

with:

```ts
import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
```

**lib/game/farm/rpc.ts — edit 2 of 2.** Replace:

```ts

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return (data ?? {}) as Record<string, unknown>;
```

with:

```ts

/** An RPC's answer; a flagged answer (anti-cheat §9.1) throws an AnticheatError. */
async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
```

**lib/game/fishing/state.ts — edit 1 of 6.** Replace:

```ts
export interface Loadout { rod: string; bobber: string; bait: string }
export interface FishingState {
```

with:

```ts
export interface Loadout { rod: string; bobber: string; bait: string }
/** A running anti-cheat lock (anti-cheat spec R14): its end and the signal that caused it. */
export interface FishingLock { until: string; code: string }
export interface FishingState {
```

**lib/game/fishing/state.ts — edit 2 of 6.** Replace:

```ts
  serverNow: string | null;
}
export type CastBlocker = "no_bait" | "hands_full" | "bucket_full" | "cast_limit";
```

with:

```ts
  serverNow: string | null;
  /** Casts left today (300 per Vietnam day, anti-cheat R21; 300 before migration 0015). */
  castsTodayLeft: number;
  /** The next Vietnam midnight, while no cast is left today. */
  dayResetsAt: string | null;
  lock: FishingLock | null;
}
export type CastBlocker = "no_bait" | "hands_full" | "bucket_full" | "cast_limit" | "daily_limit";
```

**lib/game/fishing/state.ts — edit 3 of 6.** Replace:

```ts
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
```

with:

```ts
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

function lockOf(v: unknown): FishingLock | null {
  const l = obj(v);
  return typeof l.until === "string" && Number.isFinite(Date.parse(l.until)) ? { until: l.until, code: str(l.code) } : null;
}
```

**lib/game/fishing/state.ts — edit 4 of 6.** Replace:

```ts
    serverNow: strOrNull(j.server_now),
  };
```

with:

```ts
    serverNow: strOrNull(j.server_now),
    castsTodayLeft: num(j.casts_today_left, 300),
    dayResetsAt: strOrNull(j.day_resets_at),
    lock: lockOf(j.lock),
  };
```

**lib/game/fishing/state.ts — edit 5 of 6.** Replace:

```ts

/** Why start_cast would refuse right now (same order as the server), or null. `now` = serverNow(). */
```

with:

```ts

/** No cast is left today and the Vietnam day has not turned yet. */
export function dayCapped(s: FishingState, now: number): boolean {
  return s.castsTodayLeft <= 0 && !(s.dayResetsAt !== null && Date.parse(s.dayResetsAt) <= now);
}

/** Why start_cast would refuse right now (same order as the server), or null. `now` = serverNow(). */
```

**lib/game/fishing/state.ts — edit 6 of 6.** Replace:

```ts
  if (s.castsLeft <= 0 && !windowOver) return "cast_limit";
  if (s.fish.length >= s.fishCap) return s.fishCap <= 1 ? "hands_full" : "bucket_full";
```

with:

```ts
  if (s.castsLeft <= 0 && !windowOver) return "cast_limit";
  if (dayCapped(s, now)) return "daily_limit";
  if (s.fish.length >= s.fishCap) return s.fishCap <= 1 ? "hands_full" : "bucket_full";
```

**lib/game/fishing/messages.ts — edit 1 of 5.** Replace:

```ts
import type { LostWhy } from "./rpc";
import { castBlocker, castWaitMin, digWaitSec, type CastBlocker, type FishingState } from "./state";
```

with:

```ts
import type { LostWhy } from "./rpc";
import { castBlocker, castWaitMin, dayCapped, digWaitSec, type CastBlocker, type FishingState } from "./state";
```

**lib/game/fishing/messages.ts — edit 2 of 5.** Replace:

```ts
export const SONG_BONUS = "🎵 Bài bạn gọi đã phát xong: +10 xu";
```

with:

```ts
export const SONG_BONUS = "🎵 Bài bạn gọi đã phát xong: +10 xu";
/** The daily cast cap (anti-cheat spec §12.4). */
export const DAILY_LIMIT_TEXT = "Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!";
```

**lib/game/fishing/messages.ts — edit 3 of 5.** Replace:

```ts
    case "cast_limit": return `Câu nhiều quá rồi, nghỉ tay chút nhé (còn ${Math.max(1, waitMin)} phút).`;
  }
```

with:

```ts
    case "cast_limit": return `Câu nhiều quá rồi, nghỉ tay chút nhé (còn ${Math.max(1, waitMin)} phút).`;
    case "daily_limit": return DAILY_LIMIT_TEXT;
  }
```

**lib/game/fishing/messages.ts — edit 4 of 5.** Replace:

```ts

/** The HUD prompt for an interactable: a dig spot counts down its cooldown, a fishing spot the hourly cap. */
export function promptText(it: Interactable, s: FishingState | null, now: number | null): string {
```

with:

```ts

/** The HUD prompt for an interactable: a dig spot counts down its cooldown, a fishing spot the hourly cap and the daily
 *  cap. */
export function promptText(it: Interactable, s: FishingState | null, now: number | null): string {
```

**lib/game/fishing/messages.ts — edit 5 of 5.** Replace:

```ts
    const min = castWaitMin(s, now);
    return min > 0 ? `Nghỉ tay — còn ${min} phút` : it.prompt;
  }
```

with:

```ts
    const min = castWaitMin(s, now);
    if (min > 0) return `Nghỉ tay — còn ${min} phút`;
    return dayCapped(s, now) ? "Hết lượt câu hôm nay" : it.prompt;
  }
```

**lib/game/farm/messages.ts — edit 1 of 2.** Replace:

```ts
import type { PestKind, Phase } from "./state";
```

with:

```ts
import { lockSeconds, lockText } from "@/lib/anticheat";
import type { PestKind, Phase } from "./state";
```

**lib/game/farm/messages.ts — edit 2 of 2.** Replace:

```ts
    case "too fast": return TOO_FAST;
  }
```

with:

```ts
    case "too fast": return TOO_FAST;
    case "account locked": return lockText(lockSeconds(err) ?? 300);
  }
```

**hooks/useFishing.ts — edit 1 of 4.** Replace:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { syncClock } from "@/lib/game/farm/clock";
```

with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError, reportLock } from "@/lib/anticheat";
import { syncClock } from "@/lib/game/farm/clock";
```

**hooks/useFishing.ts — edit 2 of 4.** Replace:

```ts
    applied.current = n;
    setState(s);
```

with:

```ts
    applied.current = n;
    // a lock that runs brings the chip back, after a reload too (anti-cheat R14)
    if (s.lock) reportLock(Date.parse(s.lock.until), s.lock.code);
    setState(s);
```

**hooks/useFishing.ts — edit 3 of 4.** Replace:

```ts

  /** Run an RPC; its state replaces ours. On error: toast, refetch, null. */
  const act = useCallback(async <T,>(call: () => Promise<T>, stateOf: (r: T) => FishingState, errorText = fishingErrorMessage): Promise<T | null> => {
```

with:

```ts

  /** Run an RPC; its state replaces ours. On error: toast, refetch, null. A strike shows no toast: the warning or the ban
   *  modal shows instead (anti-cheat §12.1). */
  const act = useCallback(async <T,>(call: () => Promise<T>, stateOf: (r: T) => FishingState, errorText = fishingErrorMessage): Promise<T | null> => {
```

**hooks/useFishing.ts — edit 4 of 4.** Replace:

```ts
    } catch (err) {
      onErrorRef.current(errorText(err));
      void reload();
```

with:

```ts
    } catch (err) {
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) onErrorRef.current(errorText(err));
      void reload();
```

**hooks/useField.ts — edit 1 of 3.** Replace:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { FarmCatalog } from "@/lib/game/farm/catalog";
```

with:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError } from "@/lib/anticheat";
import type { FarmCatalog } from "@/lib/game/farm/catalog";
```

**hooks/useField.ts — edit 2 of 3.** Replace:

```ts

  /** Run an RPC and apply its answer. On error: toast, refetch, null. */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void, itemName?: string): Promise<T | null> => {
```

with:

```ts

  /** Run an RPC and apply its answer. On error: toast, refetch, null. A strike shows no toast: the warning or the ban
   *  modal shows instead (anti-cheat §12.1). */
  const call = useCallback(async <T,>(job: () => Promise<T>, keep: (n: number, r: T) => void, itemName?: string): Promise<T | null> => {
```

**hooks/useField.ts — edit 3 of 3.** Replace:

```ts
      if (isMissingRpc(err)) setNotOpen(true);
      onErrorRef.current(farmErrorMessage(err, itemName));
      void reload();
```

with:

```ts
      if (isMissingRpc(err)) setNotOpen(true);
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) onErrorRef.current(farmErrorMessage(err, itemName));
      void reload();
```

**hooks/useCastSession.ts.** Replace:

```ts
      canvas()?.setFishing({ phase: "idle" });
      toastRef.current(lostText(cause, success ? r.why : null, r.state.fishCap));
    }
```

with:

```ts
      canvas()?.setFishing({ phase: "idle" });
      // a reel reported too fast as a strike: the warning or the ban modal shows instead (anti-cheat §12.1)
      if ((r.anticheat?.strike ?? 0) < 1) toastRef.current(lostText(cause, success ? r.why : null, r.state.fishCap));
    }
```

**hooks/useFishingController.ts — edit 1 of 3.** Replace:

```ts
import { fetchFishingBoard, type FishingBoard } from "@/lib/game/fishing/rpc";
import { baitTotal, castWaitMin, digWaitSec, handFish, type Loadout } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";
```

with:

```ts
import { fetchFishingBoard, type FishingBoard } from "@/lib/game/fishing/rpc";
import { baitTotal, castWaitMin, dayCapped, digWaitSec, handFish, type Loadout } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";
```

**hooks/useFishingController.ts — edit 2 of 3.** Replace:

```ts

  // --- a clock for the prompts while a cooldown or the hourly cap runs
  const [now, setNow] = useState<number | null>(null);
```

with:

```ts

  // --- a clock for the prompts while a cooldown, the hourly cap or the daily cap runs
  const [now, setNow] = useState<number | null>(null);
```

**hooks/useFishingController.ts — edit 3 of 3.** Replace:

```ts
  const capRunning = !!state && castWaitMin(state, now ?? 0) > 0;
  const ticking = digRunning || capRunning;
  useEffect(() => {
```

with:

```ts
  const capRunning = !!state && castWaitMin(state, now ?? 0) > 0;
  const dayRunning = !!state && dayCapped(state, now ?? 0);
  const ticking = digRunning || capRunning || dayRunning;
  useEffect(() => {
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (85 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/fishing lib/game/farm/rpc.ts lib/game/farm/messages.ts hooks/useFishing.ts hooks/useField.ts hooks/useCastSession.ts hooks/useFishingController.ts tests/unit/fishing-rpc.test.ts tests/unit/farm-rpc.test.ts tests/unit/fishing-state.test.ts tests/unit/fishing-messages.test.ts tests/unit/farm-messages.test.ts tests/unit/use-fishing.test.tsx tests/unit/use-field.test.tsx tests/unit/use-cast-session.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(anticheat): the RPC wrappers read the envelope; the daily cast cap and the lock in the fishing state

The fishing and farm call() report an account locked refusal as a running lock, set the server clock from an envelope,
report strikes 1 and 2, and throw an AnticheatError (finish_cast keeps its lost answer, with the envelope on it).
fishingErrorMessage and farmErrorMessage tell a locked account how long the lock runs, and fishingErrorMessage the daily
cap. parseFishingState reads casts_today_left, day_resets_at and lock; castBlocker gives daily_limit after the hourly
cap, and the fishing spot prompt says "Hết lượt câu hôm nay". useFishing, useField and useCastSession show no toast for
a strike (the modal shows instead); useFishing reports the lock a state carries; the controller's prompt clock ticks
through the daily cap.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add hooks/useCastSession.ts hooks/useField.ts hooks/useFishing.ts hooks/useFishingController.ts lib/game/farm/messages.ts lib/game/farm/rpc.ts lib/game/fishing/messages.ts lib/game/fishing/rpc.ts lib/game/fishing/state.ts tests/unit/farm-messages.test.ts tests/unit/farm-rpc.test.ts tests/unit/fishing-messages.test.ts tests/unit/fishing-rpc.test.ts tests/unit/fishing-state.test.ts tests/unit/use-cast-session.test.tsx tests/unit/use-field.test.tsx tests/unit/use-fishing.test.tsx
git commit -F <message file>
```

---

### Task 9: The warning and ban modals and the lock chip in the game shell

**Files:**
- Create: `hooks/useAnticheat.ts`, `components/game/AnticheatModal.tsx`, `components/game/AnticheatChip.tsx`
- Modify: `components/game/GameShell.tsx` (the imports, `blocking`, the chip under `FishingHud`, the modal at the end)
- Test: `tests/unit/anticheat-ui.test.tsx` (create)

**Interfaces:**
- Consumes: Task 7's `subscribeAnticheat`, `reasonText`, `chipText`, `chipLabel` and the `WARN_*` / `BAN_*` texts; `serverNow()` from `@/lib/game/farm/clock`; `useAuth().logout` from `@/hooks/useAuth`; `ParchmentModal({ title, onClose, children })` from `components/game/Parchment` (✕, Esc and the backdrop call `onClose`); in `GameShell`: `FishingHud` in the player card, the `blocking` flag that turns the canvas input off.
- Produces:
  - `hooks/useAnticheat.ts`: `interface AnticheatView { modal: "warn" | "ban" | null; reason: string; secondsLeft: number; dismiss: () => void }` and `useAnticheat(): AnticheatView` — a strike 1 with `lockedUntil`, or a lock event with a code, shows the warning once per lock end per page load (a module-level `Set`); a lock event without a code only runs the countdown; a strike 2 shows the ban, and no warning replaces it; `secondsLeft` counts down every second on the server clock;
  - `components/game/AnticheatModal.tsx`: `default function AnticheatModal({ kind, reason, onClose }: { kind: "warn" | "ban"; reason: string; onClose: () => void })` — the warning closes with "Tôi đã hiểu", ✕ or Esc; the ban calls `onClose()` and `logout()` however it is closed;
  - `components/game/AnticheatChip.tsx`: `default function AnticheatChip({ secondsLeft }: { secondsLeft: number })` — `role="timer"` "🔒 m:ss" with `chipLabel` as title and aria-label; nothing at 0;
  - `GameShell` renders `<AnticheatChip>` under `FishingHud` and the modal last, and `blocking` includes `anticheat.modal !== null`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/anticheat-ui.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

import AnticheatChip from "@/components/game/AnticheatChip";
import AnticheatModal from "@/components/game/AnticheatModal";
import { useAnticheat } from "@/hooks/useAnticheat";
import {
  BAN_BODY, BAN_WIPE, reportAnticheat, reportLock, WARN_BODY, WARN_LOCK, WARN_REPEAT, type AnticheatInfo,
} from "@/lib/anticheat";
import { serverNow, syncClock } from "@/lib/game/farm/clock";

const REEL = "Báo kéo được cá nhanh hơn mức trò chơi cho phép.";
const OTHER = "Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.";
const strike = (over: Partial<AnticheatInfo>): AnticheatInfo => ({
  code: "reel_too_fast", strike: 1, error: null, lockedUntil: null, banned: false, serverNow: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-02T10:00:00Z"));
  auth.logout.mockReset();
  auth.logout.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  syncClock(0, 0);
  vi.useRealTimers();
});

describe("useAnticheat", () => {
  it("warns once per lock for a strike 1, and counts the lock down on the server clock", async () => {
    syncClock(Date.now() + 60_000); // the server runs a minute ahead of this client
    const until = serverNow() + 125_000;
    const { result } = renderHook(() => useAnticheat());
    expect(result.current).toMatchObject({ modal: null, secondsLeft: 0 });
    act(() => reportAnticheat(strike({ lockedUntil: until })));
    expect(result.current).toMatchObject({ modal: "warn", reason: REEL });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.secondsLeft).toBe(125);
    act(() => result.current.dismiss());
    expect(result.current.modal).toBeNull();
    // the same lock again, from the fishing state of a refetch: no second warning
    act(() => reportLock(until, "reel_too_fast"));
    expect(result.current.modal).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.secondsLeft).toBe(120);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(result.current.secondsLeft).toBe(0);
  });

  it("warns for a lock the fishing state reports, and only counts down one an account locked refusal reports", async () => {
    const { result } = renderHook(() => useAnticheat());
    act(() => reportLock(serverNow() + 60_000, null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ modal: null, secondsLeft: 60 });
    act(() => reportLock(serverNow() + 290_000, "bad_plot"));
    expect(result.current).toMatchObject({ modal: "warn", reason: OTHER });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.secondsLeft).toBe(289);
  });

  it("shows the ban for a strike 2, and no warning replaces it", () => {
    const { result } = renderHook(() => useAnticheat());
    act(() => reportAnticheat(strike({ code: "bad_qty", strike: 2, banned: true })));
    expect(result.current).toMatchObject({ modal: "ban", reason: OTHER });
    act(() => reportLock(serverNow() + 1_000_000, "quality_range"));
    expect(result.current).toMatchObject({ modal: "ban", reason: OTHER });
  });
});

describe("AnticheatModal", () => {
  it("warns with the reason, and closes with its button or Esc", () => {
    const onClose = vi.fn();
    render(<AnticheatModal kind="warn" reason={REEL} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "⚠️ Cảnh báo gian lận" })).toBeInTheDocument();
    for (const text of [WARN_BODY, `Lý do: ${REEL}`, WARN_LOCK, WARN_REPEAT]) expect(screen.getByText(text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã hiểu" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("logs out from the ban however it is closed (R15)", () => {
    const onClose = vi.fn();
    render(<AnticheatModal kind="ban" reason={OTHER} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "🚫 Tài khoản bị khoá vĩnh viễn" })).toBeInTheDocument();
    for (const text of [BAN_BODY, `Lý do: ${OTHER}`, BAN_WIPE]) expect(screen.getByText(text)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(auth.logout).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(auth.logout).toHaveBeenCalledTimes(3);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("AnticheatChip", () => {
  function Chip() {
    const { secondsLeft } = useAnticheat();
    return <AnticheatChip secondsLeft={secondsLeft} />;
  }

  it("counts the lock down in the player card and goes when it ends", async () => {
    render(<Chip />);
    expect(screen.queryByRole("timer")).toBeNull();
    act(() => reportLock(serverNow() + 247_000, null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const chip = screen.getByRole("timer");
    expect(chip).toHaveTextContent("🔒 4:07");
    expect(chip).toHaveAttribute("title", "Tạm khoá trò chơi — còn 4 phút 7 giây");
    expect(chip).toHaveAccessibleName("Tạm khoá trò chơi — còn 4 phút 7 giây");
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(screen.getByRole("timer")).toHaveTextContent("🔒 4:00");
    await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
    expect(screen.queryByRole("timer")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/anticheat-ui.test.tsx`
Expected: FAIL — `Failed to resolve import` for one of the three modules this task creates (`@/components/game/AnticheatChip`, `@/components/game/AnticheatModal` or `@/hooks/useAnticheat`: which one Vite names first varies).

- [ ] **Step 3: Write the hook and the two components**

Create `hooks/useAnticheat.ts` with exactly:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { reasonText, subscribeAnticheat } from "@/lib/anticheat";
import { serverNow } from "@/lib/game/farm/clock";

export interface AnticheatView {
  /** The warning (strike 1) or the ban (strike 2), or none. */
  modal: "warn" | "ban" | null;
  /** Why, for the modal's "Lý do:" line. */
  reason: string;
  /** Whole seconds left of the running lock; 0 when none runs. */
  secondsLeft: number;
  /** Closes the modal. */
  dismiss: () => void;
}

/** The lock ends the warning has shown for on this page load. */
const warned = new Set<number>();

/** The game shell's side of the anti-cheat layer (spec §12.1): the modal the last strike asks for, and the lock's
 *  countdown on the server's clock. The warning shows once per lock end per page load; a lock that only an
 *  `account locked` refusal reported (its code unknown) runs the countdown without a warning. */
export function useAnticheat(): AnticheatView {
  const [modal, setModal] = useState<{ kind: "warn" | "ban"; code: string } | null>(null);
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => subscribeAnticheat((e) => {
    const warn = (end: number, code: string) => {
      if (warned.has(end)) return;
      warned.add(end);
      setModal((m) => (m?.kind === "ban" ? m : { kind: "warn", code }));
    };
    if (e.kind === "lock") {
      setUntil(e.until);
      if (e.code !== null) warn(e.until, e.code);
    } else if (e.info.strike === 2) {
      setModal({ kind: "ban", code: e.info.code });
    } else if (e.info.lockedUntil !== null) {
      setUntil(e.info.lockedUntil);
      warn(e.info.lockedUntil, e.info.code);
    }
  }), []);

  // the countdown ticks every second while the lock runs
  const running = until !== null && (now === null || until > now);
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(serverNow());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [running]);

  return {
    modal: modal?.kind ?? null,
    reason: modal ? reasonText(modal.code) : "",
    secondsLeft: until !== null && now !== null ? Math.max(0, Math.ceil((until - now) / 1000)) : 0,
    dismiss: useCallback(() => setModal(null), []),
  };
}
```

Create `components/game/AnticheatModal.tsx` with exactly:

```tsx
"use client";

import { useAuth } from "@/hooks/useAuth";
import { BAN_BODY, BAN_OK, BAN_TITLE, BAN_WIPE, WARN_BODY, WARN_LOCK, WARN_OK, WARN_REPEAT, WARN_TITLE } from "@/lib/anticheat";
import { ParchmentModal } from "./Parchment";

/** The anti-cheat warning (strike 1) and ban (strike 2) (spec §12.1, §12.2). The warning closes with its button, ✕ or
 *  Esc; the ban logs out however it is closed, because the server has already ended the session (R15). */
export default function AnticheatModal({ kind, reason, onClose }: {
  kind: "warn" | "ban";
  reason: string;
  onClose: () => void;
}) {
  const { logout } = useAuth();
  if (kind === "warn") {
    return (
      <ParchmentModal title={WARN_TITLE} onClose={onClose}>
        <div className="flex flex-col gap-2 font-vt text-lg leading-snug">
          <p>{WARN_BODY}</p>
          <p>{`Lý do: ${reason}`}</p>
          <p>{WARN_LOCK}</p>
          <p>{WARN_REPEAT}</p>
          <button type="button" className="pch-btn pch-btn-primary self-end" onClick={onClose}>{WARN_OK}</button>
        </div>
      </ParchmentModal>
    );
  }
  const leave = () => {
    onClose();
    void logout();
  };
  return (
    <ParchmentModal title={BAN_TITLE} onClose={leave}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-snug">
        <p>{BAN_BODY}</p>
        <p>{`Lý do: ${reason}`}</p>
        <p>{BAN_WIPE}</p>
        <button type="button" className="pch-btn pch-btn-primary self-end" onClick={leave}>{BAN_OK}</button>
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/AnticheatChip.tsx` with exactly:

```tsx
"use client";

import { chipLabel, chipText } from "@/lib/anticheat";

/** The running anti-cheat lock in the player card, "🔒 4:07" (spec §12.1); nothing when no lock runs. */
export default function AnticheatChip({ secondsLeft }: { secondsLeft: number }) {
  if (secondsLeft <= 0) return null;
  const label = chipLabel(secondsLeft);
  return (
    <span role="timer" title={label} aria-label={label} className="self-start rounded-sm bg-burgundy px-1.5 py-0.5 text-lg leading-none text-parchment">
      {chipText(secondsLeft)}
    </span>
  );
}
```

- [ ] **Step 4: Wire them into the game shell**

**components/game/GameShell.tsx — edit 1 of 5.** Replace:

```tsx
import SettingsDialog from "@/components/room/SettingsDialog";
import { useChat } from "@/hooks/useChat";
```

with:

```tsx
import SettingsDialog from "@/components/room/SettingsDialog";
import { useAnticheat } from "@/hooks/useAnticheat";
import { useChat } from "@/hooks/useChat";
```

**components/game/GameShell.tsx — edit 2 of 5.** Replace:

```tsx
import { getCategoryLabel } from "@/lib/sponsorblock";
import CharacterEditor from "./CharacterEditor";
```

with:

```tsx
import { getCategoryLabel } from "@/lib/sponsorblock";
import AnticheatChip from "./AnticheatChip";
import AnticheatModal from "./AnticheatModal";
import CharacterEditor from "./CharacterEditor";
```

**components/game/GameShell.tsx — edit 3 of 5.** Replace:

```tsx

  // --- input is off while any panel, the farm work or the create editor is open
  const blocking = panel !== null || fishing.panel !== null || farm.panel !== null || farm.work !== null || creating;
  useEffect(() => {
```

with:

```tsx

  // --- anti-cheat: the warning or the ban after a strike, and the lock's countdown (anti-cheat spec §12.1)
  const anticheat = useAnticheat();

  // --- input is off while any panel, the farm work, the create editor or an anti-cheat modal is open
  const blocking = panel !== null || fishing.panel !== null || farm.panel !== null || farm.work !== null || creating
    || anticheat.modal !== null;
  useEffect(() => {
```

**components/game/GameShell.tsx — edit 4 of 5.** Replace:

```tsx
            />
          </div>
```

with:

```tsx
            />
            <AnticheatChip secondsLeft={anticheat.secondsLeft} />
          </div>
```

**components/game/GameShell.tsx — edit 5 of 5.** Replace:

```tsx
      )}
    </div>
```

with:

```tsx
      )}
      {anticheat.modal && <AnticheatModal kind={anticheat.modal} reason={anticheat.reason} onClose={anticheat.dismiss} />}
    </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/unit/anticheat-ui.test.tsx`
Expected: PASS (6 tests). No unit test renders `GameShell`; `npx tsc --noEmit` below checks the wiring.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint hooks/useAnticheat.ts components/game/AnticheatModal.tsx components/game/AnticheatChip.tsx components/game/GameShell.tsx tests/unit/anticheat-ui.test.tsx` (clean).

- [ ] **Step 7: Commit**

Commit message:

```text
feat(anticheat): the warning and ban modals and the lock chip in the game shell

useAnticheat listens to the hub: a strike 1 or a lock from the fishing state shows the warning once per lock end per
page load, a strike 2 shows the ban, and the lock counts down every second on the server clock. AnticheatModal is the
warning (closed with its button, ✕ or Esc) and the ban (which logs out however it is closed); AnticheatChip shows
🔒 m:ss in the player card under the fishing line. The game shell blocks the canvas input while a modal is open.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/AnticheatChip.tsx components/game/AnticheatModal.tsx components/game/GameShell.tsx hooks/useAnticheat.ts tests/unit/anticheat-ui.test.tsx
git commit -F <message file>
```

---

### Task 10: System chat lines on the client; the login and register refusals

**Files:**
- Modify: `lib/chat.ts` (`ChatMessage.system`; `fetchRecentMessages` selects it)
- Modify: `lib/game/fishing/announce.ts` (the catch and land parsers require `system === true`)
- Modify: `components/auth/AuthScreen.tsx` (`authErrorText`)
- Test: `tests/unit/chat-fetch.test.ts`, `tests/unit/auth-screen.test.tsx` (create); `tests/unit/fishing-announce.test.ts`, `tests/unit/chat-catch-line.test.tsx`, `tests/unit/chat-notify.test.ts`, `tests/unit/game-social.test.ts` (modify: their fixtures gain `system`)

**Interfaces:**
- Consumes: Task 1's `chat_messages.system` column and the `invalid username` / `account banned` refusals of `register` / `login`; from v13–v15.1: `ChatMessage` and `fetchRecentMessages(roomId)` in `lib/chat.ts`, `parseCatchAnnouncement(m)` / `parseLandAnnouncement(m)` with `ANNOUNCER_NAME` / `LAND_ANNOUNCER_NAME` in `lib/game/fishing/announce.ts`, `ChatMessageItem` (renders a parsed catch line as a card), `AuthScreen` (uses `useAuth()`).
- Produces:
  - `ChatMessage` gains `system: boolean` ("posted by the server; members cannot set it"); `fetchRecentMessages` selects `id, room_id, account_id, username, body, created_at, system`;
  - `parseCatchAnnouncement` and `parseLandAnnouncement` return null unless `m.system === true` (and, as before, no author account and the announcer's name), so a forged or orphaned line renders as a normal message;
  - `AuthScreen` shows `authErrorText(message)`: "Tên đăng nhập đã tồn tại." (already taken), "Sai tên đăng nhập hoặc mật khẩu." (invalid username or password), "Tên đăng nhập cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn." (exactly `invalid username`), "🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên." (account banned); anything else as the server sent it.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/chat-fetch.test.ts` with exactly:

```ts
import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const calls: Record<string, unknown[]> = {};
  const rows = [
    { id: "2", room_id: "r", account_id: null, username: "Ao cá", body: "b", created_at: "2026-10-02T10:00:02Z", system: true },
    { id: "1", room_id: "r", account_id: "a", username: "Lan", body: "a", created_at: "2026-10-02T10:00:01Z", system: false },
  ];
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order", "limit"]) {
    chain[k] = (...args: unknown[]) => {
      calls[k] = args;
      return chain;
    };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return { calls, chain };
});
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => {
      h.calls.from = [table];
      return h.chain;
    },
  },
}));

import { fetchRecentMessages } from "@/lib/chat";

describe("fetchRecentMessages", () => {
  it("reads the system flag with the last messages, oldest first (anti-cheat §6.1)", async () => {
    const out = await fetchRecentMessages("r", 50);
    expect(h.calls.from).toEqual(["chat_messages"]);
    expect(h.calls.select).toEqual(["id, room_id, account_id, username, body, created_at, system"]);
    expect(h.calls.eq).toEqual(["room_id", "r"]);
    expect(out.map((m) => [m.id, m.system])).toEqual([["1", false], ["2", true]]);
  });
});
```

Create `tests/unit/auth-screen.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/components/brand/Logo", () => ({ default: () => null }));

import AuthScreen from "@/components/auth/AuthScreen";

beforeEach(() => {
  auth.login.mockReset();
  auth.register.mockReset();
});
afterEach(cleanup);

function submit(username: string) {
  fireEvent.change(screen.getByPlaceholderText("Tên đăng nhập (username)"), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), { target: { value: "mat-khau-thu" } });
  fireEvent.submit(screen.getByPlaceholderText("Mật khẩu").closest("form")!);
}

describe("AuthScreen — anti-cheat refusals (spec §12.3)", () => {
  it("tells a banned account at login, without saying for how long", async () => {
    auth.login.mockRejectedValueOnce({ message: "account banned" });
    render(<AuthScreen />);
    submit("Dat");
    expect(await screen.findByText("🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên."))
      .toBeInTheDocument();
    expect(auth.login).toHaveBeenCalledWith("Dat", "mat-khau-thu");
  });

  it("explains the username rules when register refuses a name", async () => {
    auth.register.mockRejectedValueOnce({ message: "invalid username" });
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Đăng ký" }));
    submit("Ao cá");
    expect(await screen.findByText(
      "Tên đăng nhập cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn.",
    )).toBeInTheDocument();
  });

  it("keeps the old texts", async () => {
    auth.login.mockRejectedValueOnce({ message: "invalid username or password" });
    render(<AuthScreen />);
    submit("Dat");
    expect(await screen.findByText("Sai tên đăng nhập hoặc mật khẩu.")).toBeInTheDocument();
    auth.login.mockRejectedValueOnce({ message: "username already taken" });
    submit("Dat");
    expect(await screen.findByText("Tên đăng nhập đã tồn tại.")).toBeInTheDocument();
  });
});
```

**tests/unit/fishing-announce.test.ts — edit 1 of 3.** Replace:

```ts
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: ANNOUNCER_NAME, body: BODY, created_at: "2026-09-24T10:00:00Z", ...over,
});
```

with:

```ts
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: ANNOUNCER_NAME, body: BODY, created_at: "2026-09-24T10:00:00Z", system: true,
  ...over,
});
```

**tests/unit/fishing-announce.test.ts — edit 2 of 3.** Replace:

```ts
    expect(parseCatchAnnouncement(msg({ body: `[catch:${ACC}|CA TRA|3150] x` }))).toBeNull();
  });
```

with:

```ts
    expect(parseCatchAnnouncement(msg({ body: `[catch:${ACC}|CA TRA|3150] x` }))).toBeNull();
  });
  it("ignores a line the server did not post as a system line (anti-cheat §6.1)", () => {
    expect(parseCatchAnnouncement(msg({ system: false }))).toBeNull();
    expect(parseAnnouncement(msg({ system: false }))).toBeNull();
  });
```

**tests/unit/fishing-announce.test.ts — edit 3 of 3.** Replace:

```ts
    expect(parseLandAnnouncement(msg({ username: LAND_ANNOUNCER_NAME, body: "[land:x] hi" }))).toBeNull();
  });
```

with:

```ts
    expect(parseLandAnnouncement(msg({ username: LAND_ANNOUNCER_NAME, body: "[land:x] hi" }))).toBeNull();
    expect(parseLandAnnouncement(msg({ username: LAND_ANNOUNCER_NAME, body: LAND, system: false }))).toBeNull();
  });
```

**tests/unit/chat-catch-line.test.tsx — edit 1 of 2.** Replace:

```tsx
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: "Ao cá", body: BODY, created_at: "2026-09-24T10:00:00Z", ...over,
});
```

with:

```tsx
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: "Ao cá", body: BODY, created_at: "2026-09-24T10:00:00Z", system: true, ...over,
});
```

**tests/unit/chat-catch-line.test.tsx — edit 2 of 2.** Replace:

```tsx
  it("renders a member typing the prefix as a normal message", () => {
    renderItem(msg({ account_id: ACC, username: "Dat" }), false);
    expect(screen.getByTitle("Trả lời tin nhắn")).toBeInTheDocument();
```

with:

```tsx
  it("renders a member typing the prefix as a normal message", () => {
    renderItem(msg({ account_id: ACC, username: "Dat", system: false }), false);
    expect(screen.getByTitle("Trả lời tin nhắn")).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
  });
  it("renders a line without the system flag as a normal message, whatever its name (anti-cheat §6.1)", () => {
    renderItem(msg({ system: false }), false);
    expect(screen.getByTitle("Trả lời tin nhắn")).toBeInTheDocument();
```

**tests/unit/chat-notify.test.ts — edit 1 of 3.** Replace:

```ts
const msg = (id: string, account_id: string | null): ChatMessage =>
  ({ id, room_id: "r", account_id, username: "u" + id, body: "b" + id, created_at: id });
// a server catch announcement (v14): no author, the announcer's name, the catcher's account in the prefix
```

with:

```ts
const msg = (id: string, account_id: string | null): ChatMessage =>
  ({ id, room_id: "r", account_id, username: "u" + id, body: "b" + id, created_at: id, system: false });
// a server catch announcement (v14): no author, the announcer's name, the catcher's account in the prefix
```

**tests/unit/chat-notify.test.ts — edit 2 of 3.** Replace:

```ts
const catchMsg = (id: string, catcher: string): ChatMessage =>
  ({ id, room_id: "r", account_id: null, username: ANNOUNCER_NAME, body: `[catch:${catcher}|ca_tra|3150] 🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!`, created_at: id });
```

with:

```ts
const catchMsg = (id: string, catcher: string): ChatMessage =>
  ({ id, room_id: "r", account_id: null, username: ANNOUNCER_NAME, body: `[catch:${catcher}|ca_tra|3150] 🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!`, created_at: id, system: true });
```

**tests/unit/chat-notify.test.ts — edit 3 of 3.** Replace:

```ts
  it("shows the readable part of a land sale", () => {
    const sale: ChatMessage = { id: "l", room_id: "r", account_id: null, username: "Hợp tác xã", body: "[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.", created_at: "l" };
    expect(notificationText(sale)).toBe("🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.");
```

with:

```ts
  it("shows the readable part of a land sale", () => {
    const sale: ChatMessage = { id: "l", room_id: "r", account_id: null, username: "Hợp tác xã", body: "[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.", created_at: "l", system: true };
    expect(notificationText(sale)).toBe("🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.");
```

**tests/unit/game-social.test.ts.** Replace:

```ts
  const msg = (id: string, account: string | null, ageMs: number): ChatMessage =>
    ({ id, room_id: "r", account_id: account, username: "u", body: "hi", created_at: new Date(now - ageMs).toISOString() });
  it("keeps unseen, recent messages written by people", () => {
```

with:

```ts
  const msg = (id: string, account: string | null, ageMs: number): ChatMessage =>
    ({ id, room_id: "r", account_id: account, username: "u", body: "hi", created_at: new Date(now - ageMs).toISOString(), system: false });
  it("keeps unseen, recent messages written by people", () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/chat-fetch.test.ts tests/unit/auth-screen.test.tsx tests/unit/fishing-announce.test.ts tests/unit/chat-catch-line.test.tsx tests/unit/chat-notify.test.ts tests/unit/game-social.test.ts`
Expected: FAIL — 6 tests fail (the select has no `system`, the parsers accept a line without it, the old login and register texts), 29 pass.

- [ ] **Step 3: Implement**

**lib/chat.ts — edit 1 of 2.** Replace:

```ts
  username: string; body: string; created_at: string;
}
```

with:

```ts
  username: string; body: string; created_at: string;
  /** Posted by the server (a catch or a land sale; anti-cheat spec §6.1). Members cannot set it. */
  system: boolean;
}
```

**lib/chat.ts — edit 2 of 2.** Replace:

```ts
    .from("chat_messages")
    .select("id, room_id, account_id, username, body, created_at")
    .eq("room_id", roomId)
```

with:

```ts
    .from("chat_messages")
    .select("id, room_id, account_id, username, body, created_at, system")
    .eq("room_id", roomId)
```

**lib/game/fishing/announce.ts — edit 1 of 2.** Replace:

```ts

type Posted = Pick<ChatMessage, "account_id" | "username" | "body">;

/** Only server messages count: no author account and the announcer's name, so a member cannot fake one. */
export function parseCatchAnnouncement(m: Posted): CatchAnnouncement | null {
  if (m.account_id !== null || m.username !== ANNOUNCER_NAME) return null;
  const x = CATCH.exec(m.body);
```

with:

```ts

type Posted = Pick<ChatMessage, "account_id" | "username" | "body" | "system">;

/** Only server messages count: the system flag, no author account and the announcer's name, so a member cannot fake
 *  one (anti-cheat spec §6.1). */
export function parseCatchAnnouncement(m: Posted): CatchAnnouncement | null {
  if (m.system !== true || m.account_id !== null || m.username !== ANNOUNCER_NAME) return null;
  const x = CATCH.exec(m.body);
```

**lib/game/fishing/announce.ts — edit 2 of 2.** Replace:

```ts

/** A land sale: no author account, the co-op's name and the `[land:<plot>]` prefix. */
export function parseLandAnnouncement(m: Posted): LandAnnouncement | null {
  if (m.account_id !== null || m.username !== LAND_ANNOUNCER_NAME) return null;
  const x = LAND.exec(m.body);
```

with:

```ts

/** A land sale: the system flag, no author account, the co-op's name and the `[land:<plot>]` prefix. */
export function parseLandAnnouncement(m: Posted): LandAnnouncement | null {
  if (m.system !== true || m.account_id !== null || m.username !== LAND_ANNOUNCER_NAME) return null;
  const x = LAND.exec(m.body);
```

**components/auth/AuthScreen.tsx — edit 1 of 2.** Replace:

```tsx
import Logo from "@/components/brand/Logo";
```

with:

```tsx
import Logo from "@/components/brand/Logo";

/** The Vietnamese text of a login or register refusal (anti-cheat spec §12.3); anything else shows as the server sent it. */
function authErrorText(msg: string): string {
  if (msg.includes("already taken")) return "Tên đăng nhập đã tồn tại.";
  if (msg.includes("invalid username or password")) return "Sai tên đăng nhập hoặc mật khẩu.";
  if (msg === "invalid username") {
    return "Tên đăng nhập cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn.";
  }
  if (msg.includes("account banned")) return "🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên.";
  return msg;
}
```

**components/auth/AuthScreen.tsx — edit 2 of 2.** Replace:

```tsx
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("already taken") ? "Tên đăng nhập đã tồn tại."
        : msg.includes("invalid username or password") ? "Sai tên đăng nhập hoặc mật khẩu." : msg);
      setBusy(false);
```

with:

```tsx
    } catch (err) {
      setError(authErrorText((err as { message?: string }).message ?? "Có lỗi xảy ra"));
      setBusy(false);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (35 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean — every `ChatMessage` literal in the tests now has `system`) and `npx eslint lib/chat.ts lib/game/fishing/announce.ts components/auth/AuthScreen.tsx tests/unit/chat-fetch.test.ts tests/unit/auth-screen.test.tsx tests/unit/fishing-announce.test.ts tests/unit/chat-catch-line.test.tsx tests/unit/chat-notify.test.ts tests/unit/game-social.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(anticheat): system chat lines on the client; the login and register refusals

ChatMessage gains system and fetchRecentMessages reads it; the catch and land parsers accept a line only when the
server posted it as a system line, so a forged or orphaned line renders as a normal message. AuthScreen explains the
username rules for invalid username and tells a banned account that it is locked.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/auth/AuthScreen.tsx lib/chat.ts lib/game/fishing/announce.ts tests/unit/auth-screen.test.tsx tests/unit/chat-catch-line.test.tsx tests/unit/chat-fetch.test.ts tests/unit/chat-notify.test.ts tests/unit/fishing-announce.test.ts tests/unit/game-social.test.ts
git commit -F <message file>
```

---

### Task 11: The /admin tab "Chống gian lận" and the build header

**Files:**
- Modify: `lib/admin.ts` (the anti-cheat types and four wrappers)
- Create: `components/admin/AnticheatTab.tsx`
- Modify: `app/admin/page.tsx` (the fifth tab)
- Modify: `next.config.ts` (`NEXT_PUBLIC_CLIENT_BUILD`), `lib/supabase.ts` (the `X-Client-Info` header)
- Test: `tests/unit/admin-anticheat.test.tsx`, `tests/unit/build-header.test.ts` (create)

**Interfaces:**
- Consumes: Task 6's `admin_anticheat_list`, `admin_anticheat_account`, `admin_anticheat_resolve`, `admin_anticheat_set_mode` (their JSON shapes); `supabase` from `@/lib/supabase`; `formatXu(n)` from `@/lib/game/fishing/catalog`; the admin page's `Tab` union, its tab list `{ id, label }[]` and `token` (the root session); Next.js `NextConfig.env` (read `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/env.md` first: the values are inlined into the client bundle at build time).
- Produces:
  - `lib/admin.ts`: `type AnticheatMode = "log" | "enforce"`; `interface AnticheatCase` (the 16 keys of `_ac_case`, snake_case); `AnticheatList { mode; mode_changed_at; server_now; cases }`; `AnticheatHoldings`; `AnticheatEventRow`; `AnticheatWipe { id; wiped_at; wiped_by; snapshot }`; `AnticheatAccount { case; holdings; events; wipes }`; `adminAnticheatList(token): Promise<AnticheatList>`, `adminAnticheatAccount(token, accountId): Promise<AnticheatAccount>`, `adminAnticheatResolve(token, accountId, action: "wipe" | "pardon"): Promise<AnticheatCase>`, `adminAnticheatSetMode(token, mode): Promise<{ mode; mode_changed_at }>` (each throws the RPC error);
  - `components/admin/AnticheatTab.tsx`: `default function AnticheatTab({ token }: { token: string })` — the heading "🛡️ Chống gian lận", the mode and its confirmed switch, the cases with their status, the evidence (holdings line, events, wipes with their snapshots), the confirmed wipe (pending accounts only) and pardon; after every action, refused or not, it reloads the list and the open evidence; errors in a `role="alert"` line;
  - `app/admin/page.tsx`: tab `"anticheat"` labelled "Chống gian lận";
  - `next.config.ts`: `env.NEXT_PUBLIC_CLIENT_BUILD` = `VERCEL_GIT_COMMIT_SHA` or `CF_PAGES_COMMIT_SHA` cut to 7 characters, else the build time in UTC as `YYYYMMDDHHmm`;
  - `lib/supabase.ts`: every request carries `X-Client-Info: music-together/<NEXT_PUBLIC_CLIENT_BUILD or "dev">` (the server's evidence reads it).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/admin-anticheat.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

import AnticheatTab from "@/components/admin/AnticheatTab";

const T = "2026-10-02T10:00:00+00:00";
const at = (x: string) => new Date(x).toLocaleString("vi-VN");
const base = {
  is_root: false, is_banned: false, strikes: 0, active_strikes: 0, last_strike_at: null, last_strike_code: null, locked_until: null,
  ban_state: null, banned_at: null, wiped_at: null, pardoned_at: null, hard_events: 0, soft_events: 0, last_event_at: T,
};
const CASES = [
  { ...base, account_id: "a1", username: "Lan", is_banned: true, strikes: 2, active_strikes: 2, ban_state: "pending_wipe", banned_at: T,
    hard_events: 2, soft_events: 1 },
  { ...base, account_id: "a2", username: "Minh", strikes: 1, active_strikes: 1, locked_until: "2026-10-02T10:05:00+00:00", hard_events: 1 },
  { ...base, account_id: "a3", username: "Hoa", strikes: 1, active_strikes: 1, hard_events: 1 },
  { ...base, account_id: "a4", username: "Tú", is_banned: true, strikes: 2, active_strikes: 2, ban_state: "wiped", wiped_at: T, hard_events: 2 },
  { ...base, account_id: "a5", username: "Bảo", pardoned_at: T, soft_events: 3 },
  { ...base, account_id: "a6", username: "root", is_root: true, soft_events: 1 },
];
const HOLDINGS = {
  wallet: { coins: 1230, daily_on: null, bonus_on: null, bonus_count: 0 },
  inventory: [{ item_id: "bait_worm", qty: 3 }, { item_id: "rod_bamboo", qty: 1 }],
  fishing_profile: { rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_worm" },
  fish: [{ species_id: "ca_ro", weight_g: 120, price: 5, caught_at: T }],
  personal_bests: [{ species_id: "ca_ro", weight_g: 120, caught_at: T }, { species_id: "ca_loc", weight_g: 900, caught_at: T }],
  rice: [{ variety: "nep", wet_kg: 1200, dry_kg: 300 }],
  plots: [{ room_id: "r", plot_no: 1, kind: "private", owned_at: T, sale_price: null, sublease_price: null }],
  leases: [],
  offers: [{ room_id: "r", plot_no: 2, price: 5000, created_at: T }],
  crops: [],
  drying: [{ room_id: "r", slot: 1, variety: "nep", kg: 70, ready_at: T }],
  announcements: 2,
};
const ACCOUNT = {
  case: CASES[0],
  holdings: HOLDINGS,
  events: [
    { id: 2, created_at: T, code: "bad_qty", outcome: "strike_2", rpc: "buy_item", room_id: null, detail: { item_id: "bait_shrimp", qty: 500 },
      client: "music-together/abc1234", user_agent: "Mozilla/5.0" },
    { id: 1, created_at: T, code: "reel_gate_hug", outcome: "soft", rpc: "finish_cast", room_id: "r", detail: { ratio: 1.01 },
      client: null, user_agent: null },
  ],
  wipes: [{ id: 7, wiped_at: T, wiped_by: "root", snapshot: { wallet: { coins: 99 } } }],
};

let mode = "log";
let resolveError: { message: string } | null = null;
beforeEach(() => {
  mode = "log";
  resolveError = null;
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (fn: string) => {
    switch (fn) {
      case "admin_anticheat_list": return { data: { mode, mode_changed_at: T, server_now: T, cases: CASES }, error: null };
      case "admin_anticheat_account": return { data: ACCOUNT, error: null };
      case "admin_anticheat_resolve": return resolveError ? { data: null, error: resolveError } : { data: CASES[0], error: null };
      case "admin_anticheat_set_mode": return { data: { mode, mode_changed_at: T }, error: null };
      default: return { data: null, error: { message: "unknown" } };
    }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = async (username: string) => (await screen.findByText(username)).closest("li")!;
const calls = (fn: string) => h.rpc.mock.calls.filter((c) => c[0] === fn);

describe("AnticheatTab (anti-cheat spec §12.5)", () => {
  it("shows the mode and every case with its status and counts", async () => {
    render(<AnticheatTab token="tok" />);
    expect(screen.getByText("Đang tải…")).toBeInTheDocument();
    expect(await screen.findByText(`Chế độ: Chỉ ghi nhận · từ ${at(T)}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "🛡️ Chống gian lận" })).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_list", { p_session_token: "tok" });
    expect(screen.getByRole("button", { name: "Chỉ ghi nhận" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Thi hành" })).toHaveAttribute("aria-pressed", "false");
    const status = async (username: string) => within(await card(username));
    expect((await status("Lan")).getByText("🚫 Đã cấm — chờ xoá dữ liệu")).toBeInTheDocument();
    expect((await status("Lan")).getByText(`Vi phạm 2/2 · 2 cứng · 1 mềm · lần cuối ${at(T)}`)).toBeInTheDocument();
    expect((await status("Minh")).getByText(`🔒 Đang khoá đến ${at("2026-10-02T10:05:00+00:00")}`)).toBeInTheDocument();
    expect((await status("Hoa")).getByText("⚠️ Cảnh cáo (1/2)")).toBeInTheDocument();
    expect((await status("Tú")).getByText("🚫 Đã cấm — đã xoá dữ liệu")).toBeInTheDocument();
    expect((await status("Bảo")).getByText("🕊️ Đã ân xá")).toBeInTheDocument();
    expect((await status("root 👑")).getByText("Chỉ có ghi nhận")).toBeInTheDocument();
    // "Xoá dữ liệu" only while a wipe is pending; "Ân xá" for any active strike, lock or ban
    expect(screen.getAllByRole("button", { name: "Xoá dữ liệu" })).toHaveLength(1);
    expect((await status("Lan")).getByRole("button", { name: "Xoá dữ liệu" })).toBeInTheDocument();
    for (const name of ["Lan", "Minh", "Hoa", "Tú"]) expect((await status(name)).getByRole("button", { name: "Ân xá" })).toBeInTheDocument();
    for (const name of ["Bảo", "root 👑"]) expect((await status(name)).queryByRole("button", { name: "Ân xá" })).toBeNull();
    expect(screen.getByText(/^Ghi nhận mềm, ghi nhận lúc chỉ ghi nhận/)).toBeInTheDocument();
  });

  it("says when there is nothing yet", async () => {
    h.rpc.mockImplementation(async () => ({ data: { mode: "enforce", mode_changed_at: T, server_now: T, cases: [] }, error: null }));
    render(<AnticheatTab token="tok" />);
    expect(await screen.findByText("Chưa có ghi nhận nào.")).toBeInTheDocument();
    expect(screen.getByText(`Chế độ: Thi hành · từ ${at(T)}`)).toBeInTheDocument();
  });

  it("wipes a pending account only after the confirm, then reloads the list and the open evidence", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AnticheatTab token="tok" />);
    const lan = within(await card("Lan"));
    fireEvent.click(lan.getByRole("button", { name: "Bằng chứng" }));
    await screen.findByText("Dữ liệu hiện có");
    fireEvent.click(lan.getByRole("button", { name: "Xoá dữ liệu" }));
    expect(confirm).toHaveBeenLastCalledWith(
      "Xoá toàn bộ dữ liệu trò chơi của Lan? Xu, đồ, cá, kỷ lục và lúa bị xoá ngay; đất được trả về làng ở lần mở ruộng kế tiếp. Không hoàn tác được.",
    );
    expect(calls("admin_anticheat_resolve")).toHaveLength(0);
    fireEvent.click(lan.getByRole("button", { name: "Xoá dữ liệu" }));
    await waitFor(() => expect(calls("admin_anticheat_list")).toHaveLength(2));
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_resolve", { p_session_token: "tok", p_account_id: "a1", p_action: "wipe" });
    await waitFor(() => expect(calls("admin_anticheat_account")).toHaveLength(2));
  });

  it("pardons after the confirm, which warns that wiped data stays gone", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnticheatTab token="tok" />);
    fireEvent.click(within(await card("Tú")).getByRole("button", { name: "Ân xá" }));
    expect(confirm).toHaveBeenLastCalledWith("Ân xá Tú? Tài khoản được mở khoá và xoá vi phạm. Dữ liệu đã xoá không được khôi phục.");
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith(
      "admin_anticheat_resolve", { p_session_token: "tok", p_account_id: "a4", p_action: "pardon" },
    ));
    fireEvent.click(within(await card("Minh")).getByRole("button", { name: "Ân xá" }));
    expect(confirm).toHaveBeenLastCalledWith("Ân xá Minh? Tài khoản được mở khoá và xoá vi phạm.");
    await waitFor(() => expect(calls("admin_anticheat_resolve")).toHaveLength(2));
  });

  it("explains a refused wipe or pardon", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnticheatTab token="tok" />);
    resolveError = { message: "not pending" };
    fireEvent.click(within(await card("Lan")).getByRole("button", { name: "Xoá dữ liệu" }));
    expect(await screen.findByText("Tài khoản này không còn chờ xoá dữ liệu.")).toBeInTheDocument();
    resolveError = { message: "nothing to pardon" };
    fireEvent.click(within(await card("Hoa")).getByRole("button", { name: "Ân xá" }));
    expect(await screen.findByText("Tài khoản này không có gì để ân xá.")).toBeInTheDocument();
    resolveError = { message: "boom" };
    fireEvent.click(within(await card("Hoa")).getByRole("button", { name: "Ân xá" }));
    expect(await screen.findByText("Có lỗi, thử lại nhé.")).toBeInTheDocument();
  });

  it("switches the mode only after its confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    render(<AnticheatTab token="tok" />);
    await screen.findByText(`Chế độ: Chỉ ghi nhận · từ ${at(T)}`);
    fireEvent.click(screen.getByRole("button", { name: "Thi hành" }));
    expect(confirm).toHaveBeenLastCalledWith("Bật chế độ Thi hành? Từ giờ vi phạm lần 1 bị khoá trò chơi 5 phút, lần 2 bị cấm tài khoản.");
    expect(calls("admin_anticheat_set_mode")).toHaveLength(0);
    mode = "enforce";
    fireEvent.click(screen.getByRole("button", { name: "Thi hành" }));
    expect(await screen.findByText(`Chế độ: Thi hành · từ ${at(T)}`)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_set_mode", { p_session_token: "tok", p_mode: "enforce" });
    // the current mode's button does nothing
    fireEvent.click(screen.getByRole("button", { name: "Thi hành" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    mode = "log";
    fireEvent.click(screen.getByRole("button", { name: "Chỉ ghi nhận" }));
    expect(confirm).toHaveBeenLastCalledWith("Chuyển về Chỉ ghi nhận? Các lượt khoá 5 phút đang chạy sẽ được gỡ; tài khoản đã bị cấm vẫn bị cấm.");
    expect(await screen.findByText(`Chế độ: Chỉ ghi nhận · từ ${at(T)}`)).toBeInTheDocument();
  });

  it("opens and closes the evidence: holdings, events and wipes", async () => {
    render(<AnticheatTab token="tok" />);
    const lan = within(await card("Lan"));
    fireEvent.click(lan.getByRole("button", { name: "Bằng chứng" }));
    expect(await lan.findByText("Dữ liệu hiện có")).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_account", { p_session_token: "tok", p_account_id: "a1" });
    expect(lan.getByText(
      "1.230 xu · 4 món đồ · 1 con cá · 2 kỷ lục · 1.500 kg lúa · 1 thửa sở hữu · 0 thửa đang thuê · 1 đề nghị mua · 1 ô phơi · 2 tin khoe trong chat",
    )).toBeInTheDocument();
    expect(lan.getByText("Ghi nhận (2)")).toBeInTheDocument();
    expect(lan.getByText(`${at(T)} · Số lượng sai · Vi phạm 2 → cấm · buy_item`)).toBeInTheDocument();
    expect(lan.getByText(`${at(T)} · Kéo cá sát ngưỡng (20 lần/ngày) · Tín hiệu mềm · finish_cast`)).toBeInTheDocument();
    expect(lan.getByText("Client: music-together/abc1234 · Trình duyệt: Mozilla/5.0")).toBeInTheDocument();
    expect(lan.getByText("Client: — · Trình duyệt: —")).toBeInTheDocument();
    expect(lan.getByText((_, el) => el?.tagName === "PRE" && el.textContent === JSON.stringify({ item_id: "bait_shrimp", qty: 500 }, null, 2)))
      .toBeInTheDocument();
    expect(lan.getByText("Đã xoá dữ liệu")).toBeInTheDocument();
    expect(lan.getByText(`${at(T)} · bởi root`)).toBeInTheDocument();
    fireEvent.click(lan.getByRole("button", { name: "Xem dữ liệu đã xoá" }));
    expect(lan.getByText((_, el) => el?.tagName === "PRE" && el.textContent === JSON.stringify({ wallet: { coins: 99 } }, null, 2)))
      .toBeInTheDocument();
    fireEvent.click(lan.getByRole("button", { name: "Ẩn" }));
    expect(lan.queryByRole("button", { name: "Ẩn" })).toBeNull();
    fireEvent.click(lan.getByRole("button", { name: "Ẩn bằng chứng" }));
    expect(lan.queryByText("Dữ liệu hiện có")).toBeNull();
    expect(lan.getByRole("button", { name: "Bằng chứng" })).toBeInTheDocument();
  });
});
```

Create `tests/unit/build-header.test.ts` with exactly:

```ts
import { afterEach, describe, it, expect, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
});

const build = async () => {
  vi.resetModules();
  return (await import("@/next.config")).default.env?.NEXT_PUBLIC_CLIENT_BUILD;
};

describe("the client build id (anti-cheat spec §12.6)", () => {
  it("is the host's commit, cut to 7 characters", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
    vi.stubEnv("CF_PAGES_COMMIT_SHA", "fedcba9876543210");
    expect(await build()).toBe("0123456");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    expect(await build()).toBe("fedcba9");
  });

  it("is the build time in UTC without a commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("CF_PAGES_COMMIT_SHA", "");
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T03:04:05Z"));
    expect(await build()).toBe("202610020304");
  });
});

describe("the X-Client-Info header", () => {
  const header = async () => {
    vi.resetModules();
    const { supabase } = await import("@/lib/supabase");
    return (supabase as unknown as { headers: Record<string, string> }).headers["X-Client-Info"];
  };

  it("names the app and its build instead of the supabase-js default", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_BUILD", "abc1234");
    expect(await header()).toBe("music-together/abc1234");
  });

  it("says dev without a build id", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_BUILD", undefined);
    expect(await header()).toBe("music-together/dev");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/admin-anticheat.test.tsx tests/unit/build-header.test.ts`
Expected: FAIL — `Failed to resolve import "@/components/admin/AnticheatTab"`, and the 4 build-header tests (`NEXT_PUBLIC_CLIENT_BUILD` is undefined; the header is still `supabase-js/…`).

- [ ] **Step 3: The admin wrappers and the tab**

**lib/admin.ts — edit 1 of 2.** Replace:

```ts
export interface AdminStats { total_rooms: number; total_accounts: number; feedback_new: number; feedback_total: number; }
```

with:

```ts
export interface AdminStats { total_rooms: number; total_accounts: number; feedback_new: number; feedback_total: number; }

/** The anti-cheat tab (anti-cheat spec §10.5, §12.5). */
export type AnticheatMode = "log" | "enforce";
export interface AnticheatCase {
  account_id: string; username: string; is_root: boolean; is_banned: boolean;
  strikes: number; active_strikes: number; last_strike_at: string | null; last_strike_code: string | null;
  /** Only while the lock runs. */
  locked_until: string | null;
  ban_state: "pending_wipe" | "wiped" | null; banned_at: string | null; wiped_at: string | null; pardoned_at: string | null;
  hard_events: number; soft_events: number; last_event_at: string | null;
}
export interface AnticheatList { mode: AnticheatMode; mode_changed_at: string | null; server_now: string; cases: AnticheatCase[]; }
/** What a wipe would remove (the same JSON is a wipe's snapshot). */
export interface AnticheatHoldings {
  wallet: { coins: number } | null;
  inventory: Array<{ item_id: string; qty: number }>;
  fish: unknown[]; personal_bests: unknown[];
  rice: Array<{ variety: string; wet_kg: number; dry_kg: number }>;
  plots: unknown[]; leases: unknown[]; offers: unknown[]; crops: unknown[]; drying: unknown[];
  /** Catch and land lines about the account in the chat. */
  announcements: number;
}
export interface AnticheatEventRow {
  id: number; created_at: string; code: string; outcome: string; rpc: string; room_id: string | null; detail: unknown;
  client: string | null; user_agent: string | null;
}
export interface AnticheatWipe { id: number; wiped_at: string; wiped_by: string | null; snapshot: unknown; }
export interface AnticheatAccount { case: AnticheatCase | null; holdings: AnticheatHoldings; events: AnticheatEventRow[]; wipes: AnticheatWipe[]; }
```

**lib/admin.ts — edit 2 of 2.** Append at the end of the file:

```ts
export async function adminAnticheatList(token: string): Promise<AnticheatList> {
  const { data, error } = await supabase.rpc("admin_anticheat_list", { p_session_token: token });
  if (error) throw error;
  return data as AnticheatList;
}
export async function adminAnticheatAccount(token: string, accountId: string): Promise<AnticheatAccount> {
  const { data, error } = await supabase.rpc("admin_anticheat_account", { p_session_token: token, p_account_id: accountId });
  if (error) throw error;
  return data as AnticheatAccount;
}
export async function adminAnticheatResolve(token: string, accountId: string, action: "wipe" | "pardon"): Promise<AnticheatCase> {
  const { data, error } = await supabase.rpc("admin_anticheat_resolve", { p_session_token: token, p_account_id: accountId, p_action: action });
  if (error) throw error;
  return data as AnticheatCase;
}
export async function adminAnticheatSetMode(token: string, mode: AnticheatMode): Promise<{ mode: AnticheatMode; mode_changed_at: string }> {
  const { data, error } = await supabase.rpc("admin_anticheat_set_mode", { p_session_token: token, p_mode: mode });
  if (error) throw error;
  return data as { mode: AnticheatMode; mode_changed_at: string };
}
```

Create `components/admin/AnticheatTab.tsx` with exactly:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminAnticheatAccount, adminAnticheatList, adminAnticheatResolve, adminAnticheatSetMode,
  type AnticheatAccount, type AnticheatCase, type AnticheatHoldings, type AnticheatList, type AnticheatMode, type AnticheatWipe,
} from "@/lib/admin";
import { formatXu } from "@/lib/game/fishing/catalog";

// /admin "Chống gian lận" (anti-cheat spec §12.5): the mode, the cases, their evidence, the wipe and the pardon.

const MODE_LABEL: Record<AnticheatMode, string> = { log: "Chỉ ghi nhận", enforce: "Thi hành" };
const MODE_CONFIRM: Record<AnticheatMode, string> = {
  enforce: "Bật chế độ Thi hành? Từ giờ vi phạm lần 1 bị khoá trò chơi 5 phút, lần 2 bị cấm tài khoản.",
  log: "Chuyển về Chỉ ghi nhận? Các lượt khoá 5 phút đang chạy sẽ được gỡ; tài khoản đã bị cấm vẫn bị cấm.",
};
const MODE_HELP = "Chỉ ghi nhận: lưu vi phạm, không khoá ai. Thi hành: vi phạm lần 1 khoá trò chơi 5 phút, lần 2 cấm tài khoản; dữ liệu chỉ bị xoá khi bạn xác nhận.";
const FOOTNOTE = "Ghi nhận mềm, ghi nhận lúc chỉ ghi nhận, của root hoặc lúc đang khoá được giữ 90 ngày; vi phạm và dữ liệu đã xoá được giữ lâu dài.";

const CODE_LABEL: Record<string, string> = {
  reel_too_fast: "Kéo cá quá nhanh",
  quality_range: "Điểm cấy/gặt sai",
  bad_plot: "Số thửa sai",
  bad_slot: "Số ô phơi sai",
  bad_water: "Mức bơm/tháo nước sai",
  bad_work: "Việc đồng sai",
  bad_qty: "Số lượng sai",
  bad_price: "Giá đất sai",
  foreign_offer: "Đụng đề nghị của người khác",
  kind_mismatch: "Sai loại vật phẩm",
  reel_gate_hug: "Kéo cá sát ngưỡng (20 lần/ngày)",
  cast_daily_cap: "Chạm 300 lần câu/ngày",
};
const OUTCOME_LABEL: Record<string, string> = {
  soft: "Tín hiệu mềm",
  log_only: "Chỉ ghi nhận",
  root: "Root — miễn",
  in_lock: "Khi đang khoá/cấm",
  strike_1: "Vi phạm 1 → khoá 5 phút",
  strike_2: "Vi phạm 2 → cấm",
};

const time = (x: string | null): string => (x ? new Date(x).toLocaleString("vi-VN") : "—");
const count = (n: number): string => n.toLocaleString("vi-VN");

function statusText(c: AnticheatCase): string {
  if (c.ban_state === "pending_wipe") return "🚫 Đã cấm — chờ xoá dữ liệu";
  if (c.ban_state === "wiped") return "🚫 Đã cấm — đã xoá dữ liệu";
  if (c.locked_until) return `🔒 Đang khoá đến ${time(c.locked_until)}`;
  if (c.active_strikes === 1) return "⚠️ Cảnh cáo (1/2)";
  if (c.pardoned_at) return "🕊️ Đã ân xá";
  return "Chỉ có ghi nhận";
}

/** What a wipe would remove now; items count every piece. */
function holdingsLine(h: AnticheatHoldings): string {
  const items = h.inventory.reduce((a, i) => a + i.qty, 0);
  const kg = h.rice.reduce((a, r) => a + r.wet_kg + r.dry_kg, 0);
  return [
    formatXu(h.wallet?.coins ?? 0), `${count(items)} món đồ`, `${count(h.fish.length)} con cá`, `${count(h.personal_bests.length)} kỷ lục`,
    `${count(kg)} kg lúa`, `${count(h.plots.length)} thửa sở hữu`, `${count(h.leases.length)} thửa đang thuê`,
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
  ].join(" · ");
}

function errorText(err: unknown): string {
  const msg = err && typeof err === "object" ? (err as { message?: unknown }).message : null;
  if (msg === "not pending") return "Tài khoản này không còn chờ xoá dữ liệu.";
  if (msg === "nothing to pardon") return "Tài khoản này không có gì để ân xá.";
  return "Có lỗi, thử lại nhé.";
}

const BUTTON = "rounded border border-gold-200 px-2 py-0.5 text-burgundy disabled:opacity-50";

export default function AnticheatTab({ token }: { token: string }) {
  const [list, setList] = useState<AnticheatList | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [account, setAccount] = useState<AnticheatAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // the account whose evidence is open, for answers that arrive after another one was opened
  const openRef = useRef<string | null>(null);

  const loadList = useCallback(() => adminAnticheatList(token).then(setList, (e: unknown) => setError(errorText(e))), [token]);
  const loadAccount = useCallback((id: string) => adminAnticheatAccount(token, id).then((a) => {
    if (openRef.current === id) setAccount(a);
  }, (e: unknown) => setError(errorText(e))), [token]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  /** An admin action, then the list and the open evidence again. */
  const act = async (job: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
    await loadList();
    const id = openRef.current;
    if (id) await loadAccount(id);
  };

  const setMode = (mode: AnticheatMode) => {
    if (!list || list.mode === mode || !window.confirm(MODE_CONFIRM[mode])) return;
    void act(() => adminAnticheatSetMode(token, mode));
  };
  const wipe = (c: AnticheatCase) => {
    const text = `Xoá toàn bộ dữ liệu trò chơi của ${c.username}? Xu, đồ, cá, kỷ lục và lúa bị xoá ngay; đất được trả về làng ở lần mở ruộng kế tiếp. Không hoàn tác được.`;
    if (window.confirm(text)) void act(() => adminAnticheatResolve(token, c.account_id, "wipe"));
  };
  const pardon = (c: AnticheatCase) => {
    const text = `Ân xá ${c.username}? Tài khoản được mở khoá và xoá vi phạm.${c.wiped_at ? " Dữ liệu đã xoá không được khôi phục." : ""}`;
    if (window.confirm(text)) void act(() => adminAnticheatResolve(token, c.account_id, "pardon"));
  };
  const toggle = (id: string) => {
    const next = openId === id ? null : id;
    openRef.current = next;
    setOpenId(next);
    setAccount(null);
    if (next) void loadAccount(next);
  };

  return (
    <section className="flex flex-col gap-3 text-sm text-ink">
      <h2 className="font-playfair text-xl font-bold text-burgundy">🛡️ Chống gian lận</h2>
      {error && <p role="alert" className="text-burgundy-accent">{error}</p>}
      {!list ? <p>Đang tải…</p> : (
        <>
          <div className="flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream p-3">
            <p>{`Chế độ: ${MODE_LABEL[list.mode]}${list.mode_changed_at ? ` · từ ${time(list.mode_changed_at)}` : ""}`}</p>
            <div className="flex gap-1">
              {(["log", "enforce"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={list.mode === m} disabled={busy} onClick={() => setMode(m)}
                  className={`${BUTTON} ${list.mode === m ? "bg-burgundy text-cream" : ""}`}>
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <p className="text-xs opacity-80">{MODE_HELP}</p>
          </div>
          {list.cases.length === 0 ? <p>Chưa có ghi nhận nào.</p> : (
            <ul className="flex flex-col gap-2">
              {list.cases.map((c) => (
                <li key={c.account_id} className="rounded-xl border border-gold-200 bg-cream p-3">
                  <p><b className="text-burgundy">{`${c.username}${c.is_root ? " 👑" : ""}`}</b> · <span>{statusText(c)}</span></p>
                  <p>{`Vi phạm ${c.active_strikes}/2 · ${count(c.hard_events)} cứng · ${count(c.soft_events)} mềm · lần cuối ${time(c.last_event_at)}`}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <button type="button" className={BUTTON} onClick={() => toggle(c.account_id)}>
                      {openId === c.account_id ? "Ẩn bằng chứng" : "Bằng chứng"}
                    </button>
                    {c.ban_state === "pending_wipe" && (
                      <button type="button" className={BUTTON} disabled={busy} onClick={() => wipe(c)}>Xoá dữ liệu</button>
                    )}
                    {(c.active_strikes > 0 || c.locked_until !== null || c.ban_state !== null) && (
                      <button type="button" className={BUTTON} disabled={busy} onClick={() => pardon(c)}>Ân xá</button>
                    )}
                  </div>
                  {openId === c.account_id && (account ? <Evidence account={account} /> : <p>Đang tải…</p>)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="text-xs opacity-70">{FOOTNOTE}</p>
    </section>
  );
}

function Evidence({ account }: { account: AnticheatAccount }) {
  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-gold-200 pt-2">
      <h3 className="font-bold text-burgundy">Dữ liệu hiện có</h3>
      <p>{holdingsLine(account.holdings)}</p>
      <h3 className="font-bold text-burgundy">{`Ghi nhận (${count(account.events.length)})`}</h3>
      <ul className="flex flex-col gap-2">
        {account.events.map((e) => (
          <li key={e.id}>
            <p>{`${time(e.created_at)} · ${CODE_LABEL[e.code] ?? e.code} · ${OUTCOME_LABEL[e.outcome] ?? e.outcome} · ${e.rpc}`}</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-parchment p-2 text-xs">{JSON.stringify(e.detail, null, 2)}</pre>
            <p className="text-xs opacity-80">{`Client: ${e.client ?? "—"} · Trình duyệt: ${e.user_agent ?? "—"}`}</p>
          </li>
        ))}
      </ul>
      {account.wipes.length > 0 && (
        <>
          <h3 className="font-bold text-burgundy">Đã xoá dữ liệu</h3>
          <ul className="flex flex-col gap-2">
            {account.wipes.map((w) => <WipeRow key={w.id} wipe={w} />)}
          </ul>
        </>
      )}
    </div>
  );
}

function WipeRow({ wipe }: { wipe: AnticheatWipe }) {
  const [shown, setShown] = useState(false);
  return (
    <li className="flex flex-col items-start gap-1">
      <p>{`${time(wipe.wiped_at)} · bởi ${wipe.wiped_by ?? "—"}`}</p>
      <button type="button" className={BUTTON} onClick={() => setShown((s) => !s)}>{shown ? "Ẩn" : "Xem dữ liệu đã xoá"}</button>
      {shown && <pre className="w-full overflow-x-auto whitespace-pre-wrap rounded bg-parchment p-2 text-xs">{JSON.stringify(wipe.snapshot, null, 2)}</pre>}
    </li>
  );
}
```

**app/admin/page.tsx — edit 1 of 4.** Replace:

```tsx
import StatsTab from "@/components/admin/StatsTab";
import Logo from "@/components/brand/Logo";
```

with:

```tsx
import StatsTab from "@/components/admin/StatsTab";
import AnticheatTab from "@/components/admin/AnticheatTab";
import Logo from "@/components/brand/Logo";
```

**app/admin/page.tsx — edit 2 of 4.** Replace:

```tsx

type Tab = "feedback" | "rooms" | "accounts" | "stats";
const TABS: { id: Tab; label: string }[] = [
```

with:

```tsx

type Tab = "feedback" | "rooms" | "accounts" | "stats" | "anticheat";
const TABS: { id: Tab; label: string }[] = [
```

**app/admin/page.tsx — edit 3 of 4.** Replace:

```tsx
  { id: "accounts", label: "Tài khoản" }, { id: "stats", label: "Thống kê" },
];
```

with:

```tsx
  { id: "accounts", label: "Tài khoản" }, { id: "stats", label: "Thống kê" },
  { id: "anticheat", label: "Chống gian lận" },
];
```

**app/admin/page.tsx — edit 4 of 4.** Replace:

```tsx
      {token && tab === "stats" && <StatsTab token={token} />}
    </main>
```

with:

```tsx
      {token && tab === "stats" && <StatsTab token={token} />}
      {token && tab === "anticheat" && <AnticheatTab token={token} />}
    </main>
```

- [ ] **Step 4: The build id and the header**

**next.config.ts.** Replace:

```ts

const nextConfig: NextConfig = {
  /* config options here */
};
```

with:

```ts

/** The client build sent in X-Client-Info (anti-cheat spec §12.6): the host's commit, else the build time (UTC). */
function clientBuild(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  return new Date().toISOString().replace(/\D/g, "").slice(0, 12);
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_CLIENT_BUILD: clientBuild() },
};
```

**lib/supabase.ts.** Replace:

```ts
  realtime: { params: { eventsPerSecond: 5 } },
});
```

with:

```ts
  realtime: { params: { eventsPerSecond: 5 } },
  // the anti-cheat evidence reads the client build from this header (anti-cheat spec §12.6)
  global: { headers: { "X-Client-Info": `music-together/${process.env.NEXT_PUBLIC_CLIENT_BUILD ?? "dev"}` } },
});
```

- [ ] **Step 5: Run them to verify they pass**

Run: `pnpm vitest run tests/unit/admin-anticheat.test.tsx tests/unit/build-header.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/admin.ts components/admin/AnticheatTab.tsx app/admin/page.tsx next.config.ts lib/supabase.ts tests/unit/admin-anticheat.test.tsx tests/unit/build-header.test.ts` (clean).

- [ ] **Step 7: Commit**

Commit message:

```text
feat(anticheat): the /admin tab "Chống gian lận" and the build header

lib/admin.ts gains adminAnticheatList, adminAnticheatAccount, adminAnticheatResolve and adminAnticheatSetMode; the new
tab shows the mode with its switch and confirms, the cases with their status, the evidence (holdings, events, wipes
and their snapshots), the confirmed wipe and pardon, and reloads after each action. next.config.ts sets
NEXT_PUBLIC_CLIENT_BUILD from the host's commit or the build time, and the Supabase client sends it as
X-Client-Info: music-together/<build>.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add app/admin/page.tsx components/admin/AnticheatTab.tsx lib/admin.ts lib/supabase.ts next.config.ts tests/unit/admin-anticheat.test.tsx tests/unit/build-header.test.ts
git commit -F <message file>
```

---

### Task 12: Realtime receive hardening — the presence filter, per-sender budgets, the `fp` and `lk` caps

**Files:**
- Create: `lib/game/net/budget.ts`
- Modify: `lib/game/social.ts` (`isHereOn`)
- Modify: `components/game/GameCanvas.tsx` (the `isHere` prop, the filter, the budgets, the newcomer reply), `components/game/GameShell.tsx` (passes `isHere`)
- Modify: `hooks/useField.ts` (`FP_MIN_GAP_MS`), `hooks/useLooks.ts` (`LK_WINDOW_MS`), `hooks/useReactions.ts` (the reaction budget)
- Test: `tests/unit/game-budget.test.ts`, `tests/unit/use-reactions.test.tsx` (create); `tests/unit/game-canvas-input.test.tsx`, `tests/unit/game-character-hooks.test.ts`, `tests/unit/use-field.test.tsx` (modify)

**Interfaces:**
- Consumes: from v13–v15.1: `GameEvent` (`"hello" | "st" | "mv" | "pa" | "fs" | "fp" | "fa" | "lk" | "bye"`) from `lib/game/net/protocol`; `createReplyScheduler`, `replyWindowMs` and `ReplyScheduler { onHello(): void; … }` from `lib/game/net/replies`; `GameCanvas`'s props (`isMember`, …), `propsRef`, `engineRef`, its handle's `setRoster(entries)` and its message handler; `PresenceEntry { accountId, mode, map, … }` (`@/lib/presence-modes`) and `MapId` (`@/lib/game/maps/types`); `presence` and `travel.mapId` in `GameShell`; `useField`'s `FP_GATHER_MS` gather of `fp` refetches; `useLooks(accountIds)`'s `refresh(accountId)` (the `lk` handler) and its `load(ids)`; `joinReactions(roomId, onReaction)` in `useReactions`. Task 9's `GameShell` edits come before this task's.
- Produces:
  - `lib/game/net/budget.ts` (pure): `interface Bucket { rate: number; burst: number }`; `interface ReceiveBudget { take(sender: string, kind: string, now: number): boolean; size(): number }`; `createBudget(limits: Readonly<Record<string, Bucket>>, maxKeys = 256): ReceiveBudget` (a kind without a limit always passes; past `maxKeys` buckets the full ones are forgotten, past twice as many all of them); `GAME_LIMITS` (`move` 5/s burst 5, `hello` and `bye` 0.1/s burst 1, `fs` and `fa` 2/s burst 3); `budgetKind(t: GameEvent): keyof typeof GAME_LIMITS | null` (`st` / `mv` / `pa` → `move`; `lk`, `fp` and the rest → null); `REACTION_LIMITS` (4/s per sender, 12/s in all); `interface ReactionBudget { take(sender: { accountId?: string; username?: string }, now: number): boolean }`; `createReactionBudget(): ReactionBudget` (a drop spends nothing);
  - `lib/game/social.ts`: `isHereOn(presence: readonly PresenceEntry[], accountId: string, mapId: MapId): boolean` — in game mode on this map;
  - `GameCanvas` prop `isHere: (accountId: string) => boolean`: every message but `st` / `mv` / `pa` from a member who is not here is dropped; each sender's messages over its budget are dropped (`performance.now()`); a roster in which a member newly passes `isHere` calls the reply scheduler's `onHello()` once, except for a world's first roster;
  - `useField`: `export const FP_MIN_GAP_MS = 2000` — `fp` refetches start at least 2 s apart, with one trailing refetch;
  - `useLooks`: `export const LK_WINDOW_MS = 30_000` — an account's look refreshes at most once per 30 s, with one trailing refresh;
  - `useReactions` drops a sender's reactions over its budget.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/game-budget.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { budgetKind, createBudget, createReactionBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { isHereOn } from "@/lib/game/social";
import type { PresenceEntry } from "@/lib/presence-modes";

describe("createBudget", () => {
  it("keeps a token bucket per sender and kind", () => {
    const b = createBudget({ move: { rate: 5, burst: 5 }, hello: { rate: 0.1, burst: 1 } });
    expect(Array.from({ length: 7 }, () => b.take("ann", "move", 0))).toEqual([true, true, true, true, true, false, false]);
    expect(b.take("bob", "move", 0)).toBe(true);
    expect(b.take("ann", "hello", 0)).toBe(true);
    expect(b.take("ann", "move", 200)).toBe(true); // 200 ms bring one token back
    expect(b.take("ann", "move", 200)).toBe(false);
    expect(b.take("ann", "hello", 9_999)).toBe(false);
    expect(b.take("ann", "hello", 10_000)).toBe(true);
    expect(b.take("ann", "lk", 0)).toBe(true); // a kind without a budget passes
  });

  it("never saves up more than the burst", () => {
    const b = createBudget({ fs: { rate: 2, burst: 3 } });
    b.take("ann", "fs", 0);
    expect(Array.from({ length: 5 }, () => b.take("ann", "fs", 60_000)).filter(Boolean)).toHaveLength(3);
  });

  it("forgets senders whose bucket is full again once it holds too many", () => {
    const b = createBudget({ fs: { rate: 2, burst: 3 } }, 4);
    for (const id of ["a", "b", "c", "d", "e"]) b.take(id, "fs", 0);
    expect(b.size()).toBe(5);
    b.take("f", "fs", 10_000);
    expect(b.size()).toBe(1);
  });
});

describe("the game and reaction budgets (anti-cheat spec §14)", () => {
  it("matches the spec's table", () => {
    expect(GAME_LIMITS).toEqual({
      move: { rate: 5, burst: 5 }, hello: { rate: 0.1, burst: 1 }, bye: { rate: 0.1, burst: 1 },
      fs: { rate: 2, burst: 3 }, fa: { rate: 2, burst: 3 },
    });
    expect((["st", "mv", "pa", "hello", "bye", "fs", "fa", "lk", "fp"] as const).map(budgetKind))
      .toEqual(["move", "move", "move", "hello", "bye", "fs", "fa", null, null]);
  });

  it("keys reactions by account, else by name, else one shared bucket, with 12 a second in total", () => {
    const b = createReactionBudget();
    const passed = (d: { accountId?: string; username?: string }, times: number, now = 0) =>
      Array.from({ length: times }, () => b.take(d, now)).filter(Boolean).length;
    expect(passed({ accountId: "a" }, 6)).toBe(4);
    expect(passed({ accountId: "b", username: "a" }, 6)).toBe(4);
    expect(passed({ username: "Lan" }, 6)).toBe(4);
    expect(passed({ username: "Minh" }, 1)).toBe(0);
    expect(passed({}, 6, 1000)).toBe(4);
    expect(passed({}, 1, 1000)).toBe(0);
    expect(passed({ username: "Minh" }, 1, 1000)).toBe(1);
  });
});

describe("isHereOn", () => {
  const presence: PresenceEntry[] = [
    { accountId: "ann", name: "Ann", mode: "game", map: "pond" },
    { accountId: "bob", name: "Bob", mode: "classic", map: null },
    { accountId: "cara", name: "Cara", mode: "game", map: "hall" },
  ];
  it("is true only for an account in game mode on this map", () => {
    expect(isHereOn(presence, "ann", "pond")).toBe(true);
    expect(isHereOn(presence, "ann", "hall")).toBe(false);
    expect(isHereOn(presence, "bob", "hall")).toBe(false);
    expect(isHereOn(presence, "cara", "hall")).toBe(true);
    expect(isHereOn(presence, "dan", "hall")).toBe(false);
  });
});
```

Create `tests/unit/use-reactions.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactionData } from "@/lib/reactions";

const h = vi.hoisted(() => ({ onReact: null as ((d: ReactionData) => void) | null }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ account: { accountId: "me", username: "Me", isRoot: false } }) }));
vi.mock("@/lib/reactions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reactions")>()),
  joinReactions: (_roomId: string, onReact: (d: ReactionData) => void) => {
    h.onReact = onReact;
    return { send: () => {}, unsubscribe: () => {} };
  },
}));

import { useReactions } from "@/hooks/useReactions";

beforeEach(() => {
  vi.useFakeTimers();
  h.onReact = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useReactions", () => {
  it("drops the reactions a sender sends over its budget (anti-cheat §14)", () => {
    const onEvent = vi.fn();
    renderHook(() => useReactions("r", "Me", { onEvent }));
    act(() => {
      for (let i = 0; i < 6; i++) h.onReact!({ emoji: "🔥", accountId: "spam", username: "Spam" });
    });
    expect(onEvent).toHaveBeenCalledTimes(4);
    act(() => h.onReact!({ emoji: "🎉", accountId: "lan", username: "Lan" }));
    expect(onEvent).toHaveBeenCalledTimes(5);
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => h.onReact!({ emoji: "🔥", accountId: "spam", username: "Spam" }));
    expect(onEvent).toHaveBeenCalledTimes(6);
  });
});
```

**tests/unit/game-canvas-input.test.tsx — edit 1 of 7.** Replace:

```tsx
// One fake engine and channel per world: they record what the canvas tells them (input lock, plots, farm
// animations, messages) and let a test deliver messages.
type EngineRec = { mapId: string; input: boolean[]; plots: unknown[]; anims: number[]; applied: unknown[]; destroyed: boolean };
const { engines, channels } = vi.hoisted(() => ({
  engines: [] as EngineRec[],
  channels: [] as Array<{ onMessage: (msg: unknown) => void; sent: unknown[] }>,
}));
```

with:

```tsx
// One fake engine and channel per world: they record what the canvas tells them (input lock, plots, farm
// animations, messages, hellos and byes) and let a test deliver messages.
type EngineRec = {
  mapId: string; input: boolean[]; plots: unknown[]; anims: number[]; applied: unknown[]; hellos: string[]; removed: string[];
  destroyed: boolean;
};
const { engines, channels, replies } = vi.hoisted(() => ({
  engines: [] as EngineRec[],
  channels: [] as Array<{ onMessage: (msg: unknown) => void; sent: unknown[] }>,
  replies: { hellos: 0 },
}));
```

**tests/unit/game-canvas-input.test.tsx — edit 2 of 7.** Replace:

```tsx
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], anims: [], applied: [], destroyed: false };
      engines.push(this.rec);
```

with:

```tsx
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false };
      engines.push(this.rec);
```

**tests/unit/game-canvas-input.test.tsx — edit 3 of 7.** Replace:

```tsx
    }
    setLocalHand() {}
```

with:

```tsx
    }
    noteHello(id: string) {
      this.rec.hellos.push(id);
    }
    removeActor(id: string) {
      this.rec.removed.push(id);
    }
    setRoster() {}
    setLocalHand() {}
```

**tests/unit/game-canvas-input.test.tsx — edit 4 of 7.** Replace:

```tsx
vi.mock("@/lib/game/net/replies", () => ({
  createReplyScheduler: () => ({ onHello: () => {}, dispose: () => {} }),
  replyWindowMs: () => 0,
```

with:

```tsx
vi.mock("@/lib/game/net/replies", () => ({
  createReplyScheduler: () => ({ onHello: () => { replies.hellos++; }, dispose: () => {} }),
  replyWindowMs: () => 0,
```

**tests/unit/game-canvas-input.test.tsx — edit 5 of 7.** Replace:

```tsx
  channels.length = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
```

with:

```tsx
  channels.length = 0;
  replies.hellos = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query }));
```

**tests/unit/game-canvas-input.test.tsx — edit 6 of 7.** Replace:

```tsx
  isMember: () => true,
  onInteract: noop,
```

with:

```tsx
  isMember: () => true,
  isHere: () => true,
  onInteract: noop,
```

**tests/unit/game-canvas-input.test.tsx — edit 7 of 7.** Append at the end of the file, after a blank line:

```tsx
describe("GameCanvas presence filter and receive budgets (anti-cheat spec §14)", () => {
  const mv = (id: string) => ({ t: "mv", id, x: 1, y: 1, d: "d", mv: true, vx: 0, vy: 1 });
  const entry = (id: string) => ({ id, name: id, badges: "", look: DEFAULT_LOOK, spot: null });

  it("takes hello, bye, lk, fs, fa and fp only from members on this map; movement from any member", () => {
    const onLookChanged = vi.fn();
    const onPlotChanged = vi.fn();
    render(<GameCanvas mapId="field" {...props} isMember={(id) => id !== "stranger"} isHere={(id) => id === "ann"}
      onLookChanged={onLookChanged} onPlotChanged={onPlotChanged} />);
    const deliver = (msg: unknown) => channels[0].onMessage(msg);
    for (const id of ["bob", "stranger"]) {
      for (const msg of [{ t: "hello", id }, { t: "lk", id }, { t: "fp", id, p: 1 }, { t: "fs", id, f: 1, h: null }, { t: "fa", id, a: 1 }, { t: "bye", id }]) {
        deliver(msg);
      }
    }
    expect(onLookChanged).not.toHaveBeenCalled();
    expect(onPlotChanged).not.toHaveBeenCalled();
    expect(engines[0]).toMatchObject({ applied: [], hellos: [], removed: [] });
    expect(replies.hellos).toBe(0);
    deliver(mv("bob"));
    deliver(mv("stranger"));
    expect(engines[0].applied).toEqual([mv("bob")]);
    for (const msg of [{ t: "hello", id: "ann" }, { t: "lk", id: "ann" }, { t: "fp", id: "ann", p: 1 }, { t: "fa", id: "ann", a: 1 }, { t: "bye", id: "ann" }]) {
      deliver(msg);
    }
    expect(engines[0]).toMatchObject({ hellos: ["ann"], removed: ["ann"] });
    expect(replies.hellos).toBe(1);
    expect(onLookChanged).toHaveBeenCalledWith("ann");
    expect(onPlotChanged).toHaveBeenCalledWith(1);
    expect(engines[0].applied).toEqual([mv("bob"), { t: "fa", id: "ann", a: 1 }]);
  });

  it("drops what a sender sends over its budget", () => {
    render(<GameCanvas mapId="pond" {...props} />);
    const deliver = (msg: unknown, times: number) => { for (let i = 0; i < times; i++) channels[0].onMessage(msg); };
    deliver(mv("ann"), 10);
    deliver({ t: "fs", id: "ann", f: 1, h: null }, 5);
    deliver({ t: "fa", id: "ann", a: 2 }, 5);
    deliver({ t: "hello", id: "ann" }, 5);
    deliver({ t: "bye", id: "ann" }, 3);
    deliver(mv("bob"), 1);
    const applied = engines[0].applied as Array<{ t: string; id: string }>;
    expect(applied.filter((m) => m.t === "mv" && m.id === "ann")).toHaveLength(5);
    expect(applied.filter((m) => m.t === "fs")).toHaveLength(3);
    expect(applied.filter((m) => m.t === "fa")).toHaveLength(3);
    expect(applied.filter((m) => m.id === "bob")).toHaveLength(1);
    expect(engines[0]).toMatchObject({ hellos: ["ann"], removed: ["ann"] });
    expect(replies.hellos).toBe(1);
  });

  it("answers a member who appears on this map as a hello would, but not the roster a world starts with", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="pond" {...props} isHere={(id) => id !== "cara"} />);
    ref.current!.setRoster([entry("ann")]);
    expect(replies.hellos).toBe(0);
    ref.current!.setRoster([entry("ann"), entry("bob")]);
    expect(replies.hellos).toBe(1);
    ref.current!.setRoster([entry("ann"), entry("bob"), entry("cara")]);
    expect(replies.hellos).toBe(1);
    ref.current!.setRoster([entry("ann")]);
    ref.current!.setRoster([entry("ann"), entry("bob")]);
    expect(replies.hellos).toBe(2);
    rerender(<GameCanvas ref={ref} mapId="hall" {...props} isHere={(id) => id !== "cara"} />);
    ref.current!.setRoster([entry("dan")]);
    expect(replies.hellos).toBe(2);
  });
});
```

**tests/unit/game-character-hooks.test.ts — edit 1 of 3.** Replace:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { useLooks } from "@/hooks/useLooks";
import { useMyCharacter } from "@/hooks/useMyCharacter";
```

with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { LK_WINDOW_MS, useLooks } from "@/hooks/useLooks";
import { useMyCharacter } from "@/hooks/useMyCharacter";
```

**tests/unit/game-character-hooks.test.ts — edit 2 of 3.** Replace:

```ts
  fetchCharacters.mockReset();
});
```

with:

```ts
  fetchCharacters.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
```

**tests/unit/game-character-hooks.test.ts — edit 3 of 3.** Replace:

```ts
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(PINK));
  });
});
```

with:

```ts
    await waitFor(() => expect(result.current.looks.get("a")).toEqual(PINK));
  });
  it("refreshes an account at most once per 30 s, with one trailing refresh (anti-cheat §14)", async () => {
    vi.useFakeTimers();
    fetchCharacters.mockResolvedValue(new Map([["a", TAN]]));
    const { result } = renderHook(() => useLooks(["a"]));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    fetchCharacters.mockClear();
    act(() => {
      for (let i = 0; i < 5; i++) result.current.refresh("a");
    });
    expect(fetchCharacters.mock.calls).toEqual([[["a"]]]);
    act(() => result.current.refresh("b"));
    expect(fetchCharacters).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(LK_WINDOW_MS - 1); });
    expect(fetchCharacters).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(fetchCharacters.mock.calls).toEqual([[["a"]], [["b"]], [["a"]]]);
    await act(async () => { await vi.advanceTimersByTimeAsync(LK_WINDOW_MS * 2); });
    expect(fetchCharacters).toHaveBeenCalledTimes(3);
  });
});
```

**tests/unit/use-field.test.tsx — edit 1 of 2.** Replace:

```tsx

import { FP_GATHER_MS, useField } from "@/hooks/useField";
```

with:

```tsx

import { FP_GATHER_MS, FP_MIN_GAP_MS, useField } from "@/hooks/useField";
```

**tests/unit/use-field.test.tsx — edit 2 of 2.** Replace:

```tsx
  });
});
```

with:

```tsx
  });

  it("starts fp refetches at least 2 s apart, with one trailing refetch (anti-cheat R35)", async () => {
    const { result } = renderHook(() => useField("r", "tok", true, () => {}));
    await flush();
    rpc.fetchFieldState.mockClear();
    // 10 fp in a second: one refetch 400 ms after the first, one more 2 s after that
    for (let i = 0; i < 10; i++) {
      act(() => result.current.plotChanged());
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    }
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(FP_GATHER_MS + FP_MIN_GAP_MS - 1000 - 1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(2);
    // a lone fp later is gathered for 400 ms, as before
    act(() => result.current.plotChanged());
    await act(async () => { await vi.advanceTimersByTimeAsync(FP_GATHER_MS); });
    expect(rpc.fetchFieldState).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-budget.test.ts tests/unit/use-reactions.test.tsx tests/unit/game-canvas-input.test.tsx tests/unit/game-character-hooks.test.ts tests/unit/use-field.test.tsx`
Expected: FAIL — `Failed to resolve import "@/lib/game/net/budget"`; 6 tests fail (messages from members who are not here and over the budgets pass, no newcomer reply, no `fp` gap, no `lk` window, no reaction budget), 21 pass.

- [ ] **Step 3: The budgets and the presence test**

Create `lib/game/net/budget.ts` with exactly:

```ts
import type { GameEvent } from "./protocol";

// Per-sender receive budgets (anti-cheat spec §14). The server never sees Broadcast, so each client drops what an
// honest sender could never send: token buckets keyed by sender and kind. Pure.

/** `rate` tokens a second, at most `burst` saved up. */
export interface Bucket { rate: number; burst: number }

export interface ReceiveBudget {
  /** May a `kind` message from `sender` pass at `now` (ms)? It spends a token when it does. A kind without a budget
   *  always passes. */
  take(sender: string, kind: string, now: number): boolean;
  /** How many buckets are kept. */
  size(): number;
}

interface Level { tokens: number; at: number }

function level(b: Level | undefined, lim: Bucket, now: number): number {
  return b ? Math.min(lim.burst, b.tokens + (Math.max(0, now - b.at) / 1000) * lim.rate) : lim.burst;
}

/** Buckets per sender and kind. Past `maxKeys` buckets, the full ones are forgotten (and all of them past twice as
 *  many), so a flood of made-up senders cannot grow it without end. */
export function createBudget(limits: Readonly<Record<string, Bucket>>, maxKeys = 256): ReceiveBudget {
  const buckets = new Map<string, Level>();
  const prune = (now: number) => {
    for (const [key, b] of buckets) {
      const lim = limits[key.slice(0, key.indexOf("|"))];
      if (!lim || level(b, lim, now) >= lim.burst) buckets.delete(key);
    }
    if (buckets.size > 2 * maxKeys) buckets.clear();
  };
  return {
    take(sender, kind, now) {
      const lim = limits[kind];
      if (!lim) return true;
      const key = `${kind}|${sender}`;
      const tokens = level(buckets.get(key), lim, now);
      const ok = tokens >= 1;
      buckets.set(key, { tokens: ok ? tokens - 1 : tokens, at: now });
      if (buckets.size > maxKeys) prune(now);
      return ok;
    },
    size: () => buckets.size,
  };
}

/** The game channel (anti-cheat spec §14): movement 5 a second, burst 5; hello and bye 1 per 10 s; fs and fa 2 a second,
 *  burst 3. */
export const GAME_LIMITS = {
  move: { rate: 5, burst: 5 },
  hello: { rate: 0.1, burst: 1 },
  bye: { rate: 0.1, burst: 1 },
  fs: { rate: 2, burst: 3 },
  fa: { rate: 2, burst: 3 },
} as const satisfies Record<string, Bucket>;

/** The budget a game message counts against; null for `lk` and `fp`, which are capped where they are handled. */
export function budgetKind(t: GameEvent): keyof typeof GAME_LIMITS | null {
  switch (t) {
    case "st":
    case "mv":
    case "pa":
      return "move";
    case "hello":
    case "bye":
    case "fs":
    case "fa":
      return t;
    default:
      return null;
  }
}

/** Reactions: 4 a second per sender, burst 4; at most 12 a second in all. */
export const REACTION_LIMITS = { sender: { rate: 4, burst: 4 }, total: { rate: 12, burst: 12 } } as const;

export interface ReactionBudget {
  take(sender: { accountId?: string; username?: string }, now: number): boolean;
}

/** The reaction budget, keyed by the account id, else the name, else one shared bucket; a drop spends nothing. */
export function createReactionBudget(): ReactionBudget {
  const senders = createBudget({ react: REACTION_LIMITS.sender });
  let total: Level | undefined;
  return {
    take(sender, now) {
      const all = level(total, REACTION_LIMITS.total, now);
      if (all < 1) return false;
      const key = sender.accountId ? `a:${sender.accountId}` : sender.username ? `u:${sender.username}` : "*";
      if (!senders.take(key, "react", now)) return false;
      total = { tokens: all - 1, at: now };
      return true;
    },
  };
}
```

**lib/game/social.ts.** Replace:

```ts

/** Chat messages that should pop up as bubbles: not shown yet, written by a person, at most maxAgeMs old. */
```

with:

```ts

/** Is this account in the room's presence in game mode on this map? Game messages other than movement are taken only
 *  from such a member (anti-cheat spec §14). */
export function isHereOn(presence: readonly PresenceEntry[], accountId: string, mapId: MapId): boolean {
  return presence.some((p) => p.accountId === accountId && p.mode === "game" && p.map === mapId);
}

/** Chat messages that should pop up as bubbles: not shown yet, written by a person, at most maxAgeMs old. */
```

- [ ] **Step 4: The canvas and the shell**

**components/game/GameCanvas.tsx — edit 1 of 7.** Replace:

```tsx
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { joinGameChannel } from "@/lib/game/net/channel";
import type { FarmAnim, FishPhase, GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs } from "@/lib/game/net/replies";
import type { Facing, Look, Vec } from "@/lib/game/types";
```

with:

```tsx
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { budgetKind, createBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { joinGameChannel } from "@/lib/game/net/channel";
import type { FarmAnim, FishPhase, GameMessage } from "@/lib/game/net/protocol";
import { createReplyScheduler, replyWindowMs, type ReplyScheduler } from "@/lib/game/net/replies";
import type { Facing, Look, Vec } from "@/lib/game/types";
```

**components/game/GameCanvas.tsx — edit 2 of 7.** Replace:

```tsx
  isMember: (accountId: string) => boolean;
  onInteract: (it: Interactable) => void;
```

with:

```tsx
  isMember: (accountId: string) => boolean;
  /** Is this member in the room's presence, in game mode, on this map? Only movement is taken from members who are not
   *  (anti-cheat spec §14). */
  isHere: (accountId: string) => boolean;
  onInteract: (it: Interactable) => void;
```

**components/game/GameCanvas.tsx — edit 3 of 7.** Replace:

```tsx
  const plotsRef = useRef<ReadonlyArray<PlotDraw>>([]);
  useEffect(() => {
```

with:

```tsx
  const plotsRef = useRef<ReadonlyArray<PlotDraw>>([]);
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
  const repliesRef = useRef<ReplyScheduler | null>(null);
  const hereRef = useRef<Set<string> | null>(null);
  useEffect(() => {
```

**components/game/GameCanvas.tsx — edit 4 of 7.** Replace:

```tsx
    return {
      setRoster: (entries) => engineRef.current?.setRoster(entries),
      setLocal: (info) => engineRef.current?.setLocal(info),
```

with:

```tsx
    return {
      setRoster: (entries) => {
        engineRef.current?.setRoster(entries);
        // a member who appears on this map gets my state, as their `hello` would bring (anti-cheat R34)
        const here = new Set(entries.map((e) => e.id).filter((id) => propsRef.current.isHere(id)));
        const known = hereRef.current;
        if (known && [...here].some((id) => !known.has(id))) repliesRef.current?.onHello();
        hereRef.current = here;
      },
      setLocal: (info) => engineRef.current?.setLocal(info),
```

**components/game/GameCanvas.tsx — edit 5 of 7.** Replace:

```tsx
    });
    const channel = joinGameChannel(roomId, map, {
```

with:

```tsx
    });
    repliesRef.current = replies;
    hereRef.current = null;
    // what one sender may send (anti-cheat spec §14): the rest is dropped
    const budget = createBudget(GAME_LIMITS);
    const channel = joinGameChannel(roomId, map, {
```

**components/game/GameCanvas.tsx — edit 6 of 7.** Replace:

```tsx
        }
        if (!propsRef.current.isMember(msg.id)) return;
        switch (msg.t) {
```

with:

```tsx
        }
        const p = propsRef.current;
        if (!p.isMember(msg.id)) return;
        if (msg.t !== "st" && msg.t !== "mv" && msg.t !== "pa" && !p.isHere(msg.id)) return;
        const kind = budgetKind(msg.t);
        if (kind && !budget.take(msg.id, kind, performance.now())) return;
        switch (msg.t) {
```

**components/game/GameCanvas.tsx — edit 7 of 7.** Replace:

```tsx
      replies.dispose();
      sendRef.current = null;
```

with:

```tsx
      replies.dispose();
      repliesRef.current = null;
      sendRef.current = null;
```

**components/game/GameShell.tsx — edit 1 of 2.** Replace:

```tsx
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { Look } from "@/lib/game/types";
```

with:

```tsx
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { badgesFor, buildRoster, freshChatBubbles, isHereOn, roleAccounts } from "@/lib/game/social";
import type { Look } from "@/lib/game/types";
```

**components/game/GameShell.tsx — edit 2 of 2.** Replace:

```tsx
        isMember={(id) => memberIds.has(id)}
        onInteract={onInteract}
```

with:

```tsx
        isMember={(id) => memberIds.has(id)}
        isHere={(id) => isHereOn(presence, id, travel.mapId)}
        onInteract={onInteract}
```

- [ ] **Step 5: The `fp`, `lk` and reaction caps**

**hooks/useField.ts — edit 1 of 4.** Replace:

```ts
  claimGift: () => Promise<(MineAnswer & { gifted: boolean }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst. */
  plotChanged: () => void;
```

with:

```ts
  claimGift: () => Promise<(MineAnswer & { gifted: boolean }) | null>;
  /** Someone changed a plot (`fp`): one refetch FP_GATHER_MS after the first of a burst, and refetch starts at least
   *  FP_MIN_GAP_MS apart. */
  plotChanged: () => void;
```

**hooks/useField.ts — edit 2 of 4.** Replace:

```ts
export const FP_GATHER_MS = 400;
```

with:

```ts
export const FP_GATHER_MS = 400;
/** Refetches for `fp` start at least this far apart; an `fp` inside the gap brings one trailing refetch, so a flood costs
 *  at most one field_state every 2 s (anti-cheat R35). */
export const FP_MIN_GAP_MS = 2000;
```

**hooks/useField.ts — edit 3 of 4.** Replace:

```ts
  const gather = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
```

with:

```ts
  const gather = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the last refetch for an `fp` started. */
  const fpAt = useRef<number | null>(null);
  useEffect(() => {
```

**hooks/useField.ts — edit 4 of 4.** Replace:

```ts
    if (gather.current) return;
    gather.current = setTimeout(() => {
      gather.current = null;
      void reload();
    }, FP_GATHER_MS);
  }, [reload]);
```

with:

```ts
    if (gather.current) return;
    const gap = fpAt.current === null ? 0 : fpAt.current + FP_MIN_GAP_MS - Date.now();
    gather.current = setTimeout(() => {
      gather.current = null;
      fpAt.current = Date.now();
      void reload();
    }, Math.max(FP_GATHER_MS, gap));
  }, [reload]);
```

**hooks/useLooks.ts — edit 1 of 3.** Replace:

```ts

/** Looks of other members: each account is fetched once, and again on refresh (their `lk`). Missing → DEFAULT_LOOK at the caller. */
```

with:

```ts

/** A member's `lk` refreshes their look at most once in this window; one more inside it waits for its end (anti-cheat
 *  spec §14). */
export const LK_WINDOW_MS = 30_000;

/** Looks of other members: each account is fetched once, and again on refresh (their `lk`). Missing → DEFAULT_LOOK at the caller. */
```

**hooks/useLooks.ts — edit 2 of 3.** Replace:

```ts
  const requested = useRef(new Set<string>());
  const key = [...new Set(accountIds)].sort().join(",");
```

with:

```ts
  const requested = useRef(new Set<string>());
  // per account: when its look was last refreshed, and the refresh waiting for the end of its window
  const refreshedAt = useRef(new Map<string, number>());
  const trailing = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const timers = trailing.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);
  const key = [...new Set(accountIds)].sort().join(",");
```

**hooks/useLooks.ts — edit 3 of 3.** Replace:

```ts
  const refresh = useCallback((accountId: string) => {
    requested.current.add(accountId);
    load([accountId]);
  }, [load]);
```

with:

```ts
  const refresh = useCallback((accountId: string) => {
    if (trailing.current.has(accountId)) return;
    const run = () => {
      refreshedAt.current.set(accountId, Date.now());
      requested.current.add(accountId);
      load([accountId]);
    };
    const last = refreshedAt.current.get(accountId);
    const wait = last === undefined ? 0 : last + LK_WINDOW_MS - Date.now();
    if (wait <= 0) {
      run();
      return;
    }
    trailing.current.set(accountId, setTimeout(() => {
      trailing.current.delete(accountId);
      run();
    }, wait));
  }, [load]);
```

**hooks/useReactions.ts — edit 1 of 2.** Replace:

```ts
import { useAuth } from "@/hooks/useAuth";
import { loadSession } from "@/lib/session";
```

with:

```ts
import { useAuth } from "@/hooks/useAuth";
import { createReactionBudget } from "@/lib/game/net/budget";
import { loadSession } from "@/lib/session";
```

**hooks/useReactions.ts — edit 2 of 2.** Replace:

```ts
  useEffect(() => {
    const handle = joinReactions(roomId, (data) => spawn(data));
    handleRef.current = handle;
```

with:

```ts
  useEffect(() => {
    // a sender over its budget is dropped (anti-cheat spec §14)
    const budget = createReactionBudget();
    const handle = joinReactions(roomId, (data) => {
      if (budget.take(data, Date.now())) spawn(data);
    });
    handleRef.current = handle;
```

- [ ] **Step 6: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (33 tests: the 6 budget tests and the 27 of the other four files).

- [ ] **Step 7: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/net/budget.ts lib/game/social.ts components/game/GameCanvas.tsx components/game/GameShell.tsx hooks/useField.ts hooks/useLooks.ts hooks/useReactions.ts tests/unit/game-budget.test.ts tests/unit/use-reactions.test.tsx tests/unit/game-canvas-input.test.tsx tests/unit/game-character-hooks.test.ts tests/unit/use-field.test.tsx` (clean).

- [ ] **Step 8: Commit**

Commit message:

```text
feat(anticheat): Realtime receive hardening — presence filter, per-sender budgets, fp and lk caps

GameCanvas takes hello, bye, lk, fs, fa and fp from another account only when the member is in this map's presence in
game mode (isHere from the shell), drops what one sender sends over the budgets of lib/game/net/budget.ts, and answers
a member who appears on the map as their hello would. useField starts fp refetches at least 2 s apart with one
trailing refetch, useLooks refreshes a look at most once per 30 s with one trailing refresh, and useReactions drops a
sender's reactions over 4 a second (12 a second in all).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameCanvas.tsx components/game/GameShell.tsx hooks/useField.ts hooks/useLooks.ts hooks/useReactions.ts lib/game/net/budget.ts lib/game/social.ts tests/unit/game-budget.test.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-character-hooks.test.ts tests/unit/use-field.test.tsx tests/unit/use-reactions.test.tsx
git commit -F <message file>
```

---

### Task 13: Pin the client code that keeps honest players clear of every hard signal

**Files:**
- Test: `tests/unit/anticheat-pins.test.tsx` (create)

**Interfaces:**
- Consumes (all existing v14/v15.1 code; nothing changes): `createReel`, `stepReel`, `zoneHeight`, `ReelParams` (`lib/game/fishing/reel`); `canHook`, `CastInfo` (`lib/game/fishing/cast`); `shopItemFromRow`, `ShopItemRow`, `FishingCatalog` (`lib/game/fishing/catalog`); `parseFishingState`; `ShopPanel`; `FarmShopPanel`, `RiceDepotPanel`, `DryingPanel`, `CoopPanel` (`components/game/farm`); `plotActions` (`lib/game/farm/actions`); `DRYING_SLOTS`, `farmItemFromRow`, `varietyFromRow`, `FarmCatalog` (`lib/game/farm/catalog`); `HOUR_MS` (`lib/game/farm/crop`); `parseFieldState`, `CropView`, `FarmMine`, `FieldState`, `PlotView` (`lib/game/farm/state`); `FIELD_PLOTS` (`lib/game/maps/field`); `getMap` (`lib/game/maps/registry`); `useFarmController`, `WORK_MS` (`hooks/useFarmController`), with `@/lib/game/farm/rpc` mocked around its real module.
- Produces: one test per hard signal of spec §7.2 (§15.2): `reel_too_fast` (no fish lands before `minReelMs` at 16 ms and 50 ms frames for difficulties 12–90, zones 25/40/90 %, three players; no hook before the bite), `bad_qty` (the fishing shop sends bait by 1–99 and gear one at a time; the farm shop 1–99; the depot and the drying yard whole kg ≥ 1 and a boolean `dry`), `bad_price` (the co-op's buttons stay disabled for prices the server refuses — v15.1 Task 20's caps, so 5 000 001 for a sale or an offer and 100 001 for a sublease — and the offer pin picks a plot first, as a player must), `bad_plot` / `bad_water` / `bad_work` (plots 1–10; one level; work only at transplanting and harvesting), `bad_slot` (slots 1–4), `foreign_offer` (only my own offers are withdrawn; only offers to me are accepted or declined), `quality_range` (transplant and harvest send quality 1).

- [ ] **Step 1: Write the pin tests**

Create `tests/unit/anticheat-pins.test.tsx` with exactly:

```tsx
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import CoopPanel from "@/components/game/farm/CoopPanel";
import DryingPanel from "@/components/game/farm/DryingPanel";
import FarmShopPanel from "@/components/game/farm/FarmShopPanel";
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { plotActions } from "@/lib/game/farm/actions";
import { DRYING_SLOTS, farmItemFromRow, varietyFromRow, type FarmCatalog } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { parseFieldState, type CropView, type FarmMine, type FieldState, type PlotView } from "@/lib/game/farm/state";
import { canHook, type CastInfo } from "@/lib/game/fishing/cast";
import { shopItemFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
import { createReel, stepReel, zoneHeight, type ReelParams } from "@/lib/game/fishing/reel";
import { parseFishingState } from "@/lib/game/fishing/state";
import { FIELD_PLOTS } from "@/lib/game/maps/field";
import { getMap } from "@/lib/game/maps/registry";

// One test per hard signal of the anti-cheat layer (spec §7.2, §15.2). Each pins the client code that keeps an honest
// player from ever sending what the server strikes: if one fails, a player could be struck without cheating.

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { useFarmController, WORK_MS } from "@/hooks/useFarmController";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * HOUR_MS).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const AN = { id: "an", name: "An" };
const noop = () => {};

// --- the fishing shop
const row = (id: string, kind: string, name: string, price: number | null, over: Partial<ShopItemRow> = {}): ShopItemRow => ({
  id, kind, name, price, starter: price === null && kind !== "bait", sort_order: 0, zone_pct: null, weight_k: null, rare_mult: 1,
  window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
  ...over,
});
const FISHING: FishingCatalog = {
  species: [],
  items: [
    row("rod_bamboo", "rod", "Cần tre", 300, { zone_pct: 30, weight_k: 1.5 }),
    row("bobber_foam", "bobber", "Phao xốp", 150, { window_ms: 2000, bite_max_ms: 10000, shows_rarity: true }),
    row("bait_shrimp", "bait", "Mồi tép", 5),
    row("bucket_small", "bucket", "Xô nhỏ", 200, { capacity: 5 }),
  ].map(shopItemFromRow),
};

// --- the field: plot 2 mine, 3 An's (listed and subleased), 4 Lan's, 5 Lan rents, 6 I rent, the rest free
const item = (id: string, kind: string, name: string, price: number, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const FARM: FarmCatalog = {
  varieties: [nep],
  items: [
    item("seed_nep", "seed", "Giống nếp", 90, { variety: "nep" }),
    item("fert_urea", "fertilizer", "Phân urê", 60, { fert: "urea" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", 40, { fert: "manure" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", 80, { pest_target: "hopper" }),
  ],
};
const bare = (no: number, kind: "private" | "village", over: Record<string, unknown> = {}) => ({
  no, kind, owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});
const lease = (h: number) => ({ source: "village", until: iso(h), price: 250 });
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
  drying: [],
  mine: {
    items: {}, rice: { nep: { wet: 30, dry: 50 } }, coins: 1000, gift_claimed: true, owned_plot: 2, farming: [2, 6],
    my_offers: [{ id: "o1", plot: 4, price: 5000, expires_at: iso(20) }, { id: "o3", plot: 3, price: 7000, expires_at: iso(21) }],
    incoming_offers: [
      { id: "o2", plot: 2, buyer: LAN, price: 9000, expires_at: iso(10) },
      { id: "o4", plot: 2, buyer: AN, price: 9500, expires_at: iso(11) },
    ],
  },
})!;

describe("reel_too_fast", () => {
  it("never lands a fish before minReelMs, at 16 ms and 50 ms frames, for difficulties 12–90", () => {
    // holding all the time with a 90 % zone keeps the fish inside it: the fastest reel there is
    const players: Array<(fish: number, zone: number, h: number) => boolean> = [
      () => true,
      () => false,
      (fish, zone, h) => fish > zone + h / 2,
    ];
    let caught = 0;
    for (let difficulty = 12; difficulty <= 90; difficulty += 13) {
      const minReelMs = 2000 + 40 * difficulty;
      for (const zonePct of [25, 40, 90]) {
        for (const dt of [0.016, 0.05]) {
          for (let seed = 1; seed <= 5; seed++) {
            for (const hold of players) {
              const p: ReelParams = { zonePct, difficulty, minReelMs, seed };
              let s = createReel(p);
              while (!s.outcome) s = stepReel(s, p, dt, hold(s.fish, s.zone, zoneHeight(p)));
              if (s.outcome !== "caught") continue;
              caught++;
              expect(s.elapsedMs).toBeGreaterThanOrEqual(minReelMs - 1e-6);
            }
          }
        }
      }
    }
    expect(caught).toBeGreaterThan(0);
  });

  it("never hooks before the bite", () => {
    const info: CastInfo = { castId: "c1", biteMs: 4000, windowMs: 1500, difficulty: 38, minReelMs: 3520, zonePct: 25, rarity: null };
    for (const t of [0, 1000, 3999, 3999.9]) expect(canHook(info, t)).toBe(false);
    expect(canHook(info, 4000)).toBe(true);
    expect(canHook(info, 5499)).toBe(true);
    expect(canHook(info, 5500)).toBe(false);
  });
});

describe("bad_qty", () => {
  it("the fishing shop offers bait by 1–99 and sends gear one at a time", () => {
    const onBuy = vi.fn();
    const rich = parseFishingState({ coins: 1_000_000, bait: {}, bait_cap: 500 })!;
    render(<ShopPanel state={rich} catalog={FISHING} busy={false} onBuy={onBuy} onClose={noop} />);
    const shrimp = screen.getByText("Mồi tép").closest("li")!;
    for (const choice of within(within(shrimp).getByRole("group", { name: "Số lượng Mồi tép" })).getAllByRole("button")) {
      fireEvent.click(choice);
      fireEvent.click(within(shrimp).getByRole("button", { name: /^Mua / }));
    }
    for (const name of ["Cần tre", "Phao xốp", "Xô nhỏ"]) {
      fireEvent.click(within(screen.getByText(name).closest("li")!).getByRole("button", { name: "Mua" }));
    }
    expect(onBuy.mock.calls).toEqual([
      ["bait_shrimp", 1], ["bait_shrimp", 5], ["bait_shrimp", 10], ["bait_shrimp", 99],
      ["rod_bamboo", 1], ["bobber_foam", 1], ["bucket_small", 1],
    ]);
  });

  it("the farm shop sends 1–99", () => {
    const onBuy = vi.fn();
    const { unmount } = render(<FarmShopPanel mine={{ ...STATE.mine, coins: 1_000_000, items: {} }} catalog={FARM} failed={false} busy={false}
      onBuy={onBuy} onReload={noop} onClose={noop} />);
    const urea = () => screen.getByText("Phân urê").closest("li")!;
    fireEvent.click(within(urea()).getByRole("button", { name: "Tối đa" }));
    fireEvent.click(within(urea()).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(urea()).getByRole("button", { name: /^Mua / }));
    // one lookup: the stepper keeps its button, and 120 role queries would take seconds
    const less = within(urea()).getByRole("button", { name: "Bớt" });
    for (let i = 0; i < 120; i++) fireEvent.click(less);
    fireEvent.click(within(urea()).getByRole("button", { name: /^Mua / }));
    unmount();
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 1_000_000, items: { fert_urea: 98 } }} catalog={FARM} failed={false} busy={false}
      onBuy={onBuy} onReload={noop} onClose={noop} />);
    fireEvent.click(within(urea()).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(urea()).getByRole("button", { name: /^Mua / }));
    expect(onBuy.mock.calls).toEqual([["fert_urea", 99], ["fert_urea", 1], ["fert_urea", 1]]);
  });

  it("the rice depot and the drying yard send whole kg of at least 1, and a boolean dry", () => {
    const onSell = vi.fn();
    const onAct = vi.fn();
    const mine = { ...STATE.mine, rice: { nep: { wet: 1, dry: 3 } } };
    render(<RiceDepotPanel mine={mine} catalog={FARM} failed={false} busy={false} onSell={onSell} onReload={noop} onClose={noop} />);
    for (const line of screen.getAllByRole("listitem")) {
      for (let i = 0; i < 5; i++) fireEvent.click(within(line).getByRole("button", { name: "Bớt" }));
      for (const b of within(line).getAllByRole("button", { name: /^Bán/ })) fireEvent.click(b);
    }
    expect(onSell.mock.calls).toEqual([["nep", true, 1], ["nep", true, 3], ["nep", false, 1], ["nep", false, 1]]);
    cleanup();
    render(<DryingPanel state={{ ...STATE, mine }} catalog={FARM} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
      onReload={noop} onClose={noop} />);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Bớt" }));
    fireEvent.click(screen.getByRole("button", { name: "Phơi lúa" }));
    expect(onAct.mock.calls.map(([a]) => a)).toEqual([{ kind: "dry_start", variety: "nep", kg: 1 }]);
  });
});

describe("bad_price", () => {
  const BAD = ["", "0", "1.5", "-3", "5000001"];
  const coop = (state: FieldState, tab: string) => {
    render(<CoopPanel state={state} failed={false} me="me" busy={false} now={NOW} onAct={noop} onReload={noop} onClose={noop} />);
    fireEvent.click(screen.getByRole("tab", { name: tab }));
  };

  it("keeps Gửi đề nghị disabled for a price the server refuses", () => {
    const free = { ...STATE, plots: STATE.plots.map((p) => (p.no === 2 ? { ...p, owner: null, farmer: null } : p.no === 6 ? { ...p, farmer: null, lease: null } : p)) };
    coop({ ...free, mine: { ...free.mine, coins: 9000 } }, "Chợ đất");
    // the plot first: until one is picked the button is off whatever the price
    fireEvent.click(within(screen.getByRole("group", { name: "Thửa muốn mua" })).getAllByRole("button")[0]);
    const send = () => screen.getByRole("button", { name: "Gửi đề nghị" });
    for (const v of BAD) {
      fireEvent.change(screen.getByLabelText("Giá"), { target: { value: v } });
      expect(send()).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "6000" } });
    expect(send()).toBeEnabled();
  });

  it("keeps Rao bán and Cho thuê disabled for a price the server refuses", () => {
    coop(STATE, "Của tôi");
    for (const [label, good] of [["Rao bán", "12000"], ["Cho thuê một vụ", "3000"]] as const) {
      const button = () => screen.getByRole("button", { name: label === "Rao bán" ? "Rao bán" : "Cho thuê" });
      for (const v of [...BAD, ...(label === "Cho thuê một vụ" ? ["100001"] : [])]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
        expect(button()).toBeDisabled();
      }
      fireEvent.change(screen.getByLabelText(label), { target: { value: good } });
      expect(button()).toBeEnabled();
    }
  });
});

describe("bad_plot, bad_water and bad_work", () => {
  const at = (h: number) => NOW + h * HOUR_MS;
  const crop = (over: Partial<CropView>, water: Array<[number, number]>): CropView => ({
    variety: "nep", phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null, water: 0, waterSetAt: null,
    pests: [], excessN: false, ripe: false, rottedAt: null,
    log: { water: water.map(([h, l]) => ({ t: at(h), l })), fert: [], spray: [], picks: [], qTransplant: 1 },
    ...over,
  });
  const plot = (no: number, c: CropView | null): PlotView => ({
    no, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: ME, lease: { source: "village", until: at(96), price: 250 },
    offers: 0, crop: c,
  });

  it("the field has plots 1–10, and every plot spot is one of them", () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(FIELD_PLOTS.map((p) => p.no).sort((a, b) => a - b)).toEqual(ten);
    expect(getMap("field").interactables.filter((i) => i.kind === "plot").map((i) => i.plot).sort((a, b) => a! - b!)).toEqual(ten);
  });

  it("the plot panel sends its plot's number, pumps or drains one level, and works only at transplanting and harvesting", () => {
    const mine: FarmMine = { items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1 }, rice: {}, coins: 0, giftClaimed: true };
    const plots = [
      plot(1, null),
      plot(5, crop({ sowAt: at(3) }, [[0, 1], [11, 2]])),
      plot(10, crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [55, 1]])),
    ];
    const deltas = new Set<number>();
    const works = new Set<string>();
    for (const p of plots) {
      for (let h = 0; h <= 100; h++) {
        for (const a of plotActions(p, "me", nep, FARM, mine, at(h))) {
          const run = a.run;
          expect("plot" in run && run.plot).toBe(p.no);
          expect(["transplant", "harvest"]).not.toContain(run.kind);
          if (run.kind === "water") deltas.add(run.delta);
          if (run.kind === "work") works.add(run.work);
        }
      }
    }
    expect([...deltas].sort()).toEqual([-1, 1]);
    expect([...works].sort()).toEqual(["harvest", "transplant"]);
  });
});

describe("bad_slot", () => {
  it("the drying yard shows slots 1–4 and collects only those", () => {
    const onAct = vi.fn();
    const drying = [1, 2, 3, 4, 7].map((slot) => ({ slot, owner: ME, variety: "nep", kg: 10, readyAt: NOW - 1 }));
    render(<DryingPanel state={{ ...STATE, drying }} catalog={FARM} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
      onReload={noop} onClose={noop} />);
    for (const b of screen.getAllByRole("button", { name: "Lấy lúa" })) fireEvent.click(b);
    expect(DRYING_SLOTS).toBe(4);
    expect(onAct.mock.calls.map(([a]) => a)).toEqual([1, 2, 3, 4].map((slot) => ({ kind: "dry_collect", slot })));
  });
});

describe("foreign_offer", () => {
  it("withdraws only my offers, and accepts or declines only the offers made to me", () => {
    const onAct = vi.fn();
    render(<CoopPanel state={STATE} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    fireEvent.click(screen.getByRole("tab", { name: "Của tôi" }));
    for (const b of screen.getAllByRole("button", { name: "Rút" })) fireEvent.click(b);
    for (const b of screen.getAllByRole("button", { name: "Từ chối" })) fireEvent.click(b);
    for (const b of screen.getAllByRole("button", { name: "Đồng ý" })) {
      fireEvent.click(b);
      fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    }
    const sent = onAct.mock.calls.map(([a]) => a as { kind: string; offer: string });
    expect(sent.filter((a) => a.kind === "withdraw_offer").map((a) => a.offer)).toEqual(["o1", "o3"]);
    expect(sent.filter((a) => a.kind === "decline_offer").map((a) => a.offer)).toEqual(["o2", "o4"]);
    expect(sent.filter((a) => a.kind === "accept_offer").map((a) => a.offer)).toEqual(["o2", "o4"]);
  });
});

describe("quality_range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const f of Object.values(rpc)) f.mockReset();
    rpc.fetchFieldState.mockResolvedValue(STATE);
    rpc.fetchFarmCatalog.mockResolvedValue(FARM);
    rpc.fieldAction.mockResolvedValue({ state: STATE, harvest: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("transplants and harvests with quality 1", async () => {
    const canvas = { setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn() } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId: "field", canvas: () => canvas, toast: noop, onCoinsChanged: noop,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (const work of ["transplant", "harvest"] as const) {
      await act(async () => { await result.current.act({ kind: "work", plot: 6, work }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
      expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: work, plot: 6, quality: 1 });
    }
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run tests/unit/anticheat-pins.test.tsx`
Expected: PASS (12 tests) at once — they pin code that already exists. A pin that fails means a player could be struck without cheating: fix the client (or, if the server is wrong, stop and ask), never the pin.

- [ ] **Step 3: See a pin bite, then restore**

In `lib/game/fishing/reel.ts`, replace `(0.7 / (p.minReelMs / 1000))` with `(0.8 / (p.minReelMs / 1000))` (a reel that fills faster than the server allows), then run `pnpm vitest run tests/unit/anticheat-pins.test.tsx -t reel_too_fast`.
Expected: FAIL — `expected … to be greater than or equal to …` (a fish landed before `minReelMs`). Restore the file with `git checkout -- lib/game/fishing/reel.ts` and run the Step 2 command again: PASS.

- [ ] **Step 4: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint tests/unit/anticheat-pins.test.tsx` (clean). `git status` shows only the new test file.

- [ ] **Step 5: Commit**

Commit message:

```text
test(anticheat): pin the client code that keeps honest players clear of every hard signal

One test per hard signal (spec §15.2): the reel never lands a fish before minReelMs and no hook comes before the bite;
the fishing shop sends bait by 1–99 and gear one at a time; the farm shop sends 1–99; the rice depot and the drying
yard send whole kg of at least 1 and a boolean dry; the co-op keeps its price buttons disabled for prices the server
refuses; plot actions name their own plot 1–10, pump or drain one level and work only at transplanting and
harvesting; the drying yard collects slots 1–4 only; offers are withdrawn, accepted or declined only from my own
lists; transplanting and harvesting send quality 1.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add tests/unit/anticheat-pins.test.tsx
git commit -F <message file>
```

---

### Task 14: The README "Anti-cheat" section; the integration tests; the final checks

**Files:**
- Modify: `README.md` (append the "Anti-cheat: chống gian lận" section)
- Create: `tests/integration/anticheat.test.ts`
- Modify: `tests/integration/v9.test.ts`, `tests/integration/v11.test.ts`, `tests/integration/v12.test.ts`, `tests/integration/rpc.test.ts` (11-character video ids), `tests/integration/v15.test.ts` (the `kind_mismatch` envelopes)

**Interfaces:**
- Consumes: everything of Tasks 1–13; `createClient` from `@supabase/supabase-js`; the integration tests' environment `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and, for the banned-login check only, `SUPABASE_TEST_ROOT_USERNAME` / `SUPABASE_TEST_ROOT_PASSWORD` (a root account of the test project). Never put a value of these in a file.
- Produces: `tests/integration/anticheat.test.ts` (spec §15.3: reserved and malformed names, the banned login, `casts_today_left` in the fishing state, a strike-0 envelope in log mode, 11-character video ids and the derived thumbnail, the private evidence tables and the root-only admin RPCs); in `v9` / `v11` / `v12`, `const vid = (id: string) => id.padEnd(11, "0");` for their queue ids, and `rpc.test.ts` queues `"abcdefghijk"`; `v15.test.ts` reads the soft `kind_mismatch` envelope of `buy_farm_item("rod_bamboo")` and `buy_item("seed_nep")`; the README section (the migration, the production order `0012` → `0014` → `0013` → `0015` and the rule to run `0015` again after any re-run of `0013`, the deploy order, what is detected and what is not, modes, strikes, the review, wipe and pardon, the updated trust model, the Realtime hardening).

- [ ] **Step 1: Write the integration tests**

Create `tests/integration/anticheat.test.ts` with exactly:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;
// The ban check needs a root account of the test project (it bans and unbans a fresh account).
const rootUser = process.env.SUPABASE_TEST_ROOT_USERNAME;
const rootPass = process.env.SUPABASE_TEST_ROOT_PASSWORD;

// The anti-cheat layer end to end (spec §15.3). The test project must be in log mode ("Chỉ ghi nhận"): a flagged
// call then answers with strike 0 and never locks the test account.
run("anti-cheat", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username = uniq("ac")) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("ac"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("refuses reserved and malformed names", async () => {
    for (const name of ["Ao cá", "hợp  tác xã", "ROOT", "a", "x".repeat(25), "an\u200bh"]) {
      const r = await db.rpc("register", { p_username: name, p_password: "pw123456" });
      expect(r.error?.message, name).toBe("invalid username");
    }
  });

  (rootUser && rootPass ? it : it.skip)("refuses a banned account at login, after the right password", async () => {
    const root = await db.rpc("login", { p_username: rootUser, p_password: rootPass });
    expect(root.error).toBeNull();
    const rootToken = (Array.isArray(root.data) ? root.data[0] : root.data).token as string;
    const me = await reg();
    const ban = (banned: boolean) => db.rpc("admin_set_ban", { p_session_token: rootToken, p_account_id: me.account_id, p_banned: banned });
    expect((await ban(true)).error).toBeNull();
    expect((await db.rpc("login", { p_username: me.username, p_password: "wrong" })).error?.message).toBe("invalid username or password");
    expect((await db.rpc("login", { p_username: me.username, p_password: "pw123456" })).error?.message).toBe("account banned");
    expect((await ban(false)).error).toBeNull();
    expect((await db.rpc("login", { p_username: me.username, p_password: "pw123456" })).error).toBeNull();
  });

  it("tells the fishing state how many casts are left today", async () => {
    const me = await reg();
    const s = await db.rpc("fishing_state", { p_session_token: me.token });
    expect(s.error).toBeNull();
    expect(s.data).toMatchObject({ casts_today_left: 300, day_resets_at: null, lock: null });
  });

  it("answers a tampered call with a strike-0 envelope in log mode", async () => {
    const me = await reg();
    const r = await room(me.token);
    const w = await db.rpc("water", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 7, p_delta: 5 });
    expect(w.error).toBeNull();
    expect(w.data).toMatchObject({ anticheat: { code: "bad_water", strike: 0, error: "invalid quantity", locked_until: null, banned: false } });
    // the account is not locked: an honest call still gets its normal refusal
    const honest = await db.rpc("water", { p_room_id: r.room_id, p_session_token: me.token, p_plot: 7, p_delta: 1 });
    expect(honest.error?.message).toBe("not your plot");
  });

  it("takes 11-character video ids only", async () => {
    const me = await reg();
    const r = await room(me.token);
    const add = (id: string) => db.rpc("add_queue_item", {
      p_room_id: r.room_id, p_session_token: me.token, p_video_id: id, p_title: "t", p_thumb: "https://example.com/x.png", p_duration: 100,
    });
    expect((await add("abc")).error?.message).toBe("invalid video");
    const ok = await add("dQw4w9WgXcQ");
    expect(ok.error).toBeNull();
    const { data } = await db.from("queue_items").select("thumbnail_url").eq("id", ok.data as string).single();
    expect(data).toEqual({ thumbnail_url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg" });
  });

  it("keeps the evidence and the admin RPCs away from everyone but root", async () => {
    for (const table of ["anticheat_config", "anticheat_status", "anticheat_events", "anticheat_wipes"]) {
      expect((await db.from(table).select("*")).error, table).not.toBeNull();
    }
    const me = await reg();
    const zero = "00000000-0000-0000-0000-000000000000";
    const calls: Array<readonly [string, Record<string, unknown>]> = [
      ["admin_anticheat_list", { p_session_token: me.token }],
      ["admin_anticheat_account", { p_session_token: me.token, p_account_id: zero }],
      ["admin_anticheat_resolve", { p_session_token: me.token, p_account_id: zero, p_action: "pardon" }],
      ["admin_anticheat_set_mode", { p_session_token: me.token, p_mode: "enforce" }],
    ];
    for (const [fn, args] of calls) expect((await db.rpc(fn, args)).error?.message, fn).toContain("root role required");
  });
});
```

**tests/integration/v9.test.ts — edit 1 of 7.** Replace:

```ts
  };
  const add = (roomId: string, token: string, videoId: string, title: string, duration: number | null) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: videoId, p_title: title, p_thumb: null, p_duration: duration });
  const settings = (roomId: string, token: string, max: number, approval: boolean, kws: string[]) =>
```

with:

```ts
  };
  /** 0015 takes 11-character YouTube ids only: the short test ids are padded. */
  const vid = (id: string) => id.padEnd(11, "0");
  const add = (roomId: string, token: string, videoId: string, title: string, duration: number | null) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: vid(videoId), p_title: title, p_thumb: null, p_duration: duration });
  const settings = (roomId: string, token: string, max: number, approval: boolean, kws: string[]) =>
```

**tests/integration/v9.test.ts — edit 2 of 7.** Replace:

```ts
    const { data: memId } = await add(room.room_id, member.token, "m1", "Member", 100);
    expect(await row(memId as string)).toEqual({ status: "pending", position: 0, youtube_video_id: "m1" });
    const { data: admId } = await add(room.room_id, admin.token, "a1", "Admin", 100);
```

with:

```ts
    const { data: memId } = await add(room.room_id, member.token, "m1", "Member", 100);
    expect(await row(memId as string)).toEqual({ status: "pending", position: 0, youtube_video_id: vid("m1") });
    const { data: admId } = await add(room.room_id, admin.token, "a1", "Admin", 100);
```

**tests/integration/v9.test.ts — edit 3 of 7.** Replace:

```ts
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: "b1", title: "ok", thumb: null, duration: 100 },
      { video_id: "b2", title: "too long", thumb: null, duration: 700 },
      { video_id: "b3", title: "Karaoke x", thumb: null, duration: 100 },
      { video_id: "b4", title: "no duration", thumb: null },
    ] });
```

with:

```ts
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: vid("b1"), title: "ok", thumb: null, duration: 100 },
      { video_id: vid("b2"), title: "too long", thumb: null, duration: 700 },
      { video_id: vid("b3"), title: "Karaoke x", thumb: null, duration: 100 },
      { video_id: vid("b4"), title: "no duration", thumb: null },
    ] });
```

**tests/integration/v9.test.ts — edit 4 of 7.** Replace:

```ts
    const { data: rows } = await db.from("queue_items").select("youtube_video_id, status").eq("room_id", room.room_id);
    expect(rows).toEqual([{ youtube_video_id: "b1", status: "pending" }]);
  });
```

with:

```ts
    const { data: rows } = await db.from("queue_items").select("youtube_video_id, status").eq("room_id", room.room_id);
    expect(rows).toEqual([{ youtube_video_id: vid("b1"), status: "pending" }]);
  });
```

**tests/integration/v9.test.ts — edit 5 of 7.** Replace:

```ts
      .eq("room_id", room.room_id).eq("status", "approved").order("position");
    expect((ordered as { youtube_video_id: string }[]).map((r) => r.youtube_video_id)).toEqual(["a1", "m2", "m1", "m3"]);
  });
```

with:

```ts
      .eq("room_id", room.room_id).eq("status", "approved").order("position");
    expect((ordered as { youtube_video_id: string }[]).map((r) => r.youtube_video_id)).toEqual(["a1", "m2", "m1", "m3"].map(vid));
  });
```

**tests/integration/v9.test.ts — edit 6 of 7.** Replace:

```ts
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: admin.token, p_items: [
      { video_id: "c1", title: "one", thumb: null, duration: 100 },
      { video_id: "c2", title: "two", thumb: null, duration: 100 },
    ] });
```

with:

```ts
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: admin.token, p_items: [
      { video_id: vid("c1"), title: "one", thumb: null, duration: 100 },
      { video_id: vid("c2"), title: "two", thumb: null, duration: 100 },
    ] });
```

**tests/integration/v9.test.ts — edit 7 of 7.** Replace:

```ts
    const batch = rows as { youtube_video_id: string; status: string; position: number }[];
    expect(batch.map((r) => [r.youtube_video_id, r.status])).toEqual([["c1", "approved"], ["c2", "approved"]]);
    expect(batch[0].position).toBeLessThan(batch[1].position);
```

with:

```ts
    const batch = rows as { youtube_video_id: string; status: string; position: number }[];
    expect(batch.map((r) => [r.youtube_video_id, r.status])).toEqual([[vid("c1"), "approved"], [vid("c2"), "approved"]]);
    expect(batch[0].position).toBeLessThan(batch[1].position);
```

**tests/integration/v11.test.ts — edit 1 of 3.** Replace:

```ts
  };
  const add = (roomId: string, token: string, videoId: string) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: videoId, p_title: videoId, p_thumb: null, p_duration: 100 });
  const addMany = (roomId: string, token: string, ids: string[], duration = 100) =>
    db.rpc("add_queue_items", { p_room_id: roomId, p_session_token: token, p_items: ids.map((id) => ({ video_id: id, title: id, thumb: null, duration })) });
  const settings = (roomId: string, token: string, maxOrders: number | null, approval = false) =>
```

with:

```ts
  };
  /** 0015 takes 11-character YouTube ids only: the short test ids are padded. */
  const vid = (id: string) => id.padEnd(11, "0");
  const add = (roomId: string, token: string, videoId: string) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: vid(videoId), p_title: videoId, p_thumb: null, p_duration: 100 });
  const addMany = (roomId: string, token: string, ids: string[], duration = 100) =>
    db.rpc("add_queue_items", { p_room_id: roomId, p_session_token: token, p_items: ids.map((id) => ({ video_id: vid(id), title: id, thumb: null, duration })) });
  const settings = (roomId: string, token: string, maxOrders: number | null, approval = false) =>
```

**tests/integration/v11.test.ts — edit 2 of 3.** Replace:

```ts
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: "p1", title: "ok", thumb: null, duration: 100 },
      { video_id: "p2", title: "too long", thumb: null, duration: 700 },
      { video_id: "p3", title: "ok", thumb: null, duration: 100 },
      { video_id: "p4", title: "ok", thumb: null, duration: 100 },
    ] });
```

with:

```ts
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: member.token, p_items: [
      { video_id: vid("p1"), title: "ok", thumb: null, duration: 100 },
      { video_id: vid("p2"), title: "too long", thumb: null, duration: 700 },
      { video_id: vid("p3"), title: "ok", thumb: null, duration: 100 },
      { video_id: vid("p4"), title: "ok", thumb: null, duration: 100 },
    ] });
```

**tests/integration/v11.test.ts — edit 3 of 3.** Replace:

```ts
    const { data: rows } = await db.from("queue_items").select("youtube_video_id").eq("room_id", room.room_id).order("position");
    expect(rows).toEqual([{ youtube_video_id: "p1" }, { youtube_video_id: "p3" }]);
    const again = await addMany(room.room_id, member.token, ["p5"]);
```

with:

```ts
    const { data: rows } = await db.from("queue_items").select("youtube_video_id").eq("room_id", room.room_id).order("position");
    expect(rows).toEqual([{ youtube_video_id: vid("p1") }, { youtube_video_id: vid("p3") }]);
    const again = await addMany(room.room_id, member.token, ["p5"]);
```

**tests/integration/v12.test.ts.** Replace:

```ts
  };
  const add = (roomId: string, token: string, videoId: string) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: videoId, p_title: videoId, p_thumb: null, p_duration: 100 });
  const setReplay = (roomId: string, token: string, enable: boolean) =>
```

with:

```ts
  };
  /** 0015 takes 11-character YouTube ids only: the short test ids are padded. */
  const vid = (id: string) => id.padEnd(11, "0");
  const add = (roomId: string, token: string, videoId: string) =>
    db.rpc("add_queue_item", { p_room_id: roomId, p_session_token: token, p_video_id: vid(videoId), p_title: videoId, p_thumb: null, p_duration: 100 });
  const setReplay = (roomId: string, token: string, enable: boolean) =>
```

**tests/integration/rpc.test.ts.** Replace:

```ts
    await db.rpc("join_room", { p_code: r.code, p_password: "secret", p_session_token: guest.token });
    await db.rpc("add_queue_item", { p_room_id: r.room_id, p_session_token: guest.token, p_video_id: "abc", p_title: "A", p_thumb: null, p_duration: 10 });
    const denied = await db.rpc("advance_queue", { p_room_id: r.room_id, p_session_token: guest.token });
```

with:

```ts
    await db.rpc("join_room", { p_code: r.code, p_password: "secret", p_session_token: guest.token });
    await db.rpc("add_queue_item", { p_room_id: r.room_id, p_session_token: guest.token, p_video_id: "abcdefghijk", p_title: "A", p_thumb: null, p_duration: 10 });
    const denied = await db.rpc("advance_queue", { p_room_id: r.room_id, p_session_token: guest.token });
```

**tests/integration/v15.test.ts.** Replace:

```ts
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).error?.message).toBe("not enough coins");
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "rod_bamboo", p_qty: 1 })).error?.message).toBe("item not available");
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).error?.message).toBe("item not available");
    const fishing = await db.rpc("fishing_state", { p_session_token: me.token });
```

with:

```ts
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).error?.message).toBe("not enough coins");
    // an item of the other shop: since 0015 a soft kind_mismatch, answered with an envelope instead of raising
    const wrongShop = { anticheat: { code: "kind_mismatch", strike: 0, error: "item not available" } };
    expect((await db.rpc("buy_farm_item", { p_session_token: me.token, p_item_id: "rod_bamboo", p_qty: 1 })).data).toMatchObject(wrongShop);
    expect((await db.rpc("buy_item", { p_session_token: me.token, p_item_id: "seed_nep", p_qty: 1 })).data).toMatchObject(wrongShop);
    const fishing = await db.rpc("fishing_state", { p_session_token: me.token });
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run tests/integration/anticheat.test.ts tests/integration/v9.test.ts tests/integration/v11.test.ts tests/integration/v12.test.ts tests/integration/rpc.test.ts tests/integration/v15.test.ts`
Expected without `SUPABASE_TEST_URL`: `6 skipped` files (38 tests skipped) — they run only against a test project with `0015` applied, in log mode. Then `npx tsc --noEmit` (clean) and `npx eslint tests/integration/anticheat.test.ts tests/integration/v9.test.ts tests/integration/v11.test.ts tests/integration/v12.test.ts tests/integration/rpc.test.ts tests/integration/v15.test.ts` (clean).

- [ ] **Step 3: Append the README section**

**README.md.** Append at the end of the file, after a blank line:

```markdown
## Anti-cheat: chống gian lận

### DB migration

`supabase/migrations/0015_anticheat.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop constraint if exists` + `add constraint`; the config row is inserted `on conflict do nothing`, so a re-run never switches `enforce` back to `log`): run it in the Supabase SQL Editor last: the production order is `0012` → `0014` → `0013` → `0015` (`0015` does not need `0014`). It adds the private tables `anticheat_config` (the mode), `anticheat_status`, `anticheat_events` and `anticheat_wipes`; `chat_messages.system` and `about_account_id`; the daily cast counters in `fishing_profiles`; the lock guard and the hard checks in the 8 fishing and the 27 farm and land RPCs; and the root-only RPCs `admin_anticheat_list`, `admin_anticheat_account`, `admin_anticheat_resolve` and `admin_anticheat_set_mode`. `tests/sql/anticheat-smoke.sql` checks it on a throwaway PostgreSQL cluster with Supabase's default grants (after `0004`–`0015` in that order, from the repo root). It ends with `tests/sql/anticheat-guards.sql`, which fails for any SECURITY DEFINER function in `public` that anon may call and that is neither on its allowlist nor guarded: every later migration keeps it passing.

> **Before running `0015`**, run the two pre-deploy queries in the spec (`docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md`, §11.4): the names the new rules would refuse (they keep working), and the author-less announcer lines that the backfill marks as system lines.
>
> **Deploy order:** `0015` first, then the anti-cheat client — the client reads `chat_messages.system`, so it must never go live before the migration. The v15.1 client against `0015` only shows the raw `invalid username` / `account banned` on the login screen, and "Có lỗi, thử lại nhé." for the daily cast cap and for the calls only a tampered client makes. `0015` starts in **log** mode.
>
> **Re-running `0013` after `0015`** puts back its unguarded versions of the functions `0015` re-creates (the game RPCs, the sweep, the fishing state and board): run `0015` again right after it. Once an account has been wiped, `0013` cannot be re-run as it is, because its `coin_ledger` reason check lacks `'wipe'`: add `'wipe'` to that list first.

### What is detected

- **Hard signals**, inputs that no shipped client can produce: a reel reported won before the reel time gate; a transplant or harvest quality outside [0.9, 1.1]; a plot outside 1–10 or a drying slot outside 1–4; a water change other than ±1 or a work other than transplanting or harvesting; a quantity no shop sends (bait 1–99, gear 1, farm items 1–99, rice at least 1 kg); a land price outside 1–1 000 000 (a sublease 1–5 000); an offer of this room that belongs to someone else. `tests/unit/anticheat-pins.test.tsx` pins, for each one, the client code that keeps honest players clear of it.
- **Soft signals**, logged for review and never a strike: the 20th catch of a day within 5 % of the reel gate, the 300th cast of a day, and an item bought or used at the wrong counter (the old v14 client lists farm items as bait).
- **Never counted:** the refusals an honest player can cause — double clicks, two tabs, stale state, slow networks, clock drift, a cached client after a deploy.
- **Not detected:** where a player stands, a script that reels exactly at the gate (now held to 300 casts a day), and anything sent over Realtime; the receiving clients filter and rate-limit that instead (below).

### Modes, strikes and the review

- **Chỉ ghi nhận** (log, the default): a flagged call is refused as before and logged; nothing is locked or banned, and log-mode rows never count later.
- **Thi hành** (enforce): the first hard signal is strike 1 — the warning and a 5-minute lock of fishing, farming, the land market and the shops (chat and music keep working; the player card shows 🔒 m:ss). Another one within 30 days is strike 2 — a permanent ban: the sessions end, login answers "🚫 Tài khoản này đã bị khoá…", and the account waits for the owner. Root is never struck.
- **/admin → Chống gian lận:** the mode switch, the cases (pending wipes first) and, per account, the evidence: its events with the client build (`X-Client-Info: music-together/<build>`) and the browser, and what a wipe would remove. **Xoá dữ liệu** wipes a banned account's game data (xu, gear, fish, records, rice; its land goes back to the village at the next field visit, and its catch and land lines leave the chat) and keeps a snapshot. **Ân xá** lifts a lock or a ban and clears the strikes, without restoring wiped data; unbanning an anti-cheat ban in the Accounts tab is the same pardon.
- **Review before enforcing:** after 7 days in log mode, look at the hard `log_only` rows. If any could come from an honest client, stay in log mode and fix the check; otherwise switch to Thi hành.
- The evidence is kept 90 days (strikes and wipe snapshots for good), at most 200 rows per account and Vietnam day besides the strikes. No IP address is stored.

### Also in this release

- **Names:** 2–24 characters, no hidden characters and no reserved names (Ao cá, Hợp tác xã, root…); names that differ only in case, spacing or Unicode form are the same name. A banned account is told so at login, after the right password.
- **Chat:** catch and land announcements are system lines that only the server can post; a look-alike line from a member shows as a normal message.
- **Queue:** 11-character YouTube ids only; the title is cleaned, the thumbnail comes from the id, and an impossible duration counts as unknown.
- **Fishing:** at most 300 casts per Vietnam day ("Hôm nay bạn câu đủ 300 lần rồi — mai quay lại nhé!").
- **Banned accounts** leave the records and the richest list, earn no song bonus, and lose their land-market listings and offers.

### Trust model (updated)

- **v14:** as above, plus the daily cap: a script that reels at the gate lands at most 300 fish a day instead of 960, and a reel reported faster than the gate is a strike.
- **v15:** v15.1 ignores the transplant and harvest quality and uses 1.0 until the v15.2 minigames; a quality outside [0.9, 1.1] is a strike.

### Realtime hardening

The server never sees Broadcast, so each client filters what it receives. `hello`, `bye`, `lk`, `fs`, `fa` and `fp` count only from a member who is in this map's presence in game mode. Each sender has a budget — movement 5/s, `hello` and `bye` 1 per 10 s, `fs` and `fa` 2/s, reactions 4/s (12/s in all) — and the rest is dropped; `fp` refetches start at least 2 s apart, and a look is fetched again at most once per 30 s. A member whose `hello` arrived before their presence still gets everyone's state. Not stopped: a spoofer using the id of a member who is on the map, fake presence, and floods against the project's Realtime quota (spec §14).
```

- [ ] **Step 4: The final checks**

Run, from the repo root:
- `pnpm test` → Expected: your Task 1 baseline plus 9 test files and 74 tests passed and 1 file and 6 tests skipped, none failing: from `4e511da`, 98 files passed / 11 skipped (762 tests passed / 67 skipped).
- `npx tsc --noEmit` → clean.
- `pnpm lint` → the baseline's 33 problems (21 errors, 12 warnings), all in files this plan does not touch.
- `pnpm build` → compiles; `NEXT_PUBLIC_CLIENT_BUILD` is inlined (search `.next/static` for `music-together/`: the header shows the build id, e.g. `music-together/202609251711`, not `music-together/dev`).
- `bash "$SCRATCH/anticheat-sql.sh"` → `ALL OK` (Task 6's output).

- [ ] **Step 5: Commit**

Commit message:

```text
docs(anticheat): README "Anti-cheat" section; integration tests for 0015

The README tells what is detected and what is not, the modes, strikes, wipe and pardon, the review before enforcing,
the deploy order (0012, 0014, 0013, then 0015, and 0015 again after any re-run of 0013) and the updated trust models.
tests/integration/anticheat.test.ts covers reserved names, the banned login (with a root account of the test project),
the daily cap in the fishing state, a strike-0 envelope in log mode, 11-character video ids and the private evidence.
The old integration tests queue 11-character ids and read the kind_mismatch envelope that replaced two raised refusals.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add README.md tests/integration/anticheat.test.ts tests/integration/rpc.test.ts tests/integration/v11.test.ts tests/integration/v12.test.ts tests/integration/v15.test.ts tests/integration/v9.test.ts
git commit -F <message file>
```

After this commit the owner runs `0015` in the Supabase SQL editor (spec §11.4 queries first; it starts in log mode), deploys the client, and reviews the evidence for 7 days before switching to "Thi hành" (spec §9.8, §15.4).
