# Music Together v16 — "Góc đánh bài": Tiến lên, Cào and Poker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card corner in the hall with three tables — Tiến lên miền Nam (2–4 players), Cào (ba cây, cào cái, 2–6) and Texas Hold'em no-limit (2–6) — played for the players' own xu, zero-sum and without a house cut: the server shuffles, deals, keeps every hand private, validates every move, runs the lazy turn timers and settles; other members watch the public state; 📜 Sổ luật teaches the three games in Vietnamese.

**Architecture:** Migration `0017_v16_cards.sql` (sections A–F) adds five private tables (`card_tables`, `card_seats`, `card_hands`, `card_secrets`, `card_log`), the card reasons of the `coin_ledger` check, the three rule sets as immutable functions (mirrored in TypeScript and pinned by `tests/fixtures/card-cases.json`), the table machinery (a table row locked first, a sweep for timeouts, idle seats, banned players and non-members, payouts under the wallet locks), the three engines, 11 public RPCs (the reads, `card_tick` and `card_leave` on the guard allowlist; `card_sit`, `pk_topup`, `tl_play`, `tl_pass`, `cao_deal` and `pk_act` guarded), the BEFORE DELETE triggers on `rooms` and `accounts`, and `0016`'s `_ac_holdings` / `_ac_wipe` re-created so a wipe resolves the seats first. `tests/sql/v16-smoke.sql` plays every game on a throwaway cluster and ends with the guard file. On the client, `lib/game/cards/*` holds the deck, the mirrors, the parsers, the RPC wrappers, the Vietnamese texts and the rules book's content; `useCardTable` follows one table (the `cv` hint on `cards:{roomId}:{game}`, the gather and gap, the 15 s poll, the ticks); `useCardLobby` and `useCardsController` drive the hall's labels, the panel, the rules book, the seat chip and the turn toast; `components/game/cards/*` draw the cards, the table panel with its three boards, the sit dialog and 📜 Sổ luật; the hall map gains the corner.

**Tech Stack:** Next.js 16.2.9 (App Router, client components), React 19, TypeScript 5 (strict), Tailwind v4, Supabase JS 2 (Postgres RPC + Realtime), Vitest 4 + jsdom + RTL, pnpm 11, PostgreSQL 18 (a throwaway local cluster for the SQL checks).

**Spec:** `docs/superpowers/specs/2026-09-25-music-together-v16-cards-design.md` — controller decisions C1–C10 and rulings R1–R38. Read it before starting any task: every section number below (§…) refers to it unless another spec is named. The anti-cheat spec (`2026-09-25-music-together-anticheat-design.md`) §11.3 rules 1–7 bind every SQL task.

**Adopted:** the plan writer replay-validated the 18 task commits on `391eb7a`. The controller cherry-picked them onto `feat/v15-field` at `7682859` (v15.2's fix round), where every block applies unchanged. The counts below are those of the `391eb7a` replay; the fix round adds 12 tests.

**After review:** the v16 fix round (`0f4c920`…`d44f29b`) and a controller follow-up changed:
- `_pk_pots` / `pkPots`: one pot when no live seat has put anything;
- `_tl_leave`: out seats settle before a forfeit;
- `_pk_refund`: now `(uuid, timestamptz, integer[])`, with dead money for banned and deleted accounts;
- `_card_sit`: the wallets in one account-id pass, with the touch after it;
- `useCardTable` / `useCardLobby`: an answer is dropped after a room change;
- the README and both specs.

The task blocks below are the plan as it was validated, not the final code, and the rulings on `_pk_refund` and `_card_sit` are superseded.

## Global Constraints

- **Start** from `feat/v15-field` at `391eb7a`: v15.1, `0014`, the anti-cheat layer `0015` with its fix rounds, and v15.2 (`0016_v15_2_crops.sql` and its client, the v15.2 plan, anti-cheat rule 7 on re-runs after `0016`). Work on the branch the owner names (suggested: `feat/v16`, created from that state, in place — no worktree). One commit per task, with the message the task gives; every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The messages contain quotes and apostrophes: write each one to a file and commit with `git commit -F <file>`.
- **Package manager pnpm** (`pnpm test`, `pnpm lint`, `pnpm build`). Typecheck: `npx tsc --noEmit` (a checkout that has never run `next build` or `next dev` has no `next-env.d.ts` and fails on the `@/public/logo.png` imports: run either once, or copy `next-env.d.ts` from another checkout). One test file: `pnpm vitest run tests/unit/<file>`.
- **Baseline** (Task 1 records yours): on `391eb7a`, `pnpm test` → 102 files passed / 12 skipped (939 tests passed / 71 skipped), `npx tsc --noEmit` clean, `pnpm lint` 33 pre-existing problems (21 errors, 12 warnings) in 16 files, none of which this plan creates or modifies. After Task 18: 115 files passed / 13 skipped (1 081 tests passed / 75 skipped); lint unchanged. Every file you create or modify must lint clean: `npx eslint <your files>`.
- **Next.js 16.2.9 is not the Next.js you know** (`AGENTS.md`): before using any Next.js API, read its guide in `node_modules/next/dist/docs/`. This plan adds no route, no config and no Next.js API; its components are client components under the existing `"use client"` shells.
- **React hook lint rules** (eslint-plugin-react-hooks 7, the React Compiler rules): no `ref.current` reads or writes during render, no synchronous `setState` directly in an effect body (callbacks, timers and promise continuations are fine), no `Date.now()` / `Math.random()` / `performance.now()` during render (the panels read the server clock through `serverNow()` in a state that a 1 s interval refreshes), and a helper an effect uses lives at module level when it needs nothing from the component. Hooks that drive the canvas take a getter, never a ref object.
- **Tests:** Vitest runs without globals, so Testing Library does not clean up by itself: every component or hook test file calls `cleanup()` in an `afterEach`. Pure logic lives in `lib/` with tests in `tests/unit/`; a module a test imports must not reach `@/lib/supabase` unless the test mocks it.
- **Overlays:** the table panel and the rules book take the canvas's input through `lib/game/overlays.ts` (`OpenOverlays`, `overlayLocks`: `cardPanel` and `rulesBook`, next to v15.2's `farmRound`), never through a new inline condition in `GameShell.tsx`.
- **Hands stay private** (§6.4, R25): `card_state` is the same for every viewer and never carries a hand; a player's cards come only from `card_hand` and from their own action answers. No client code may assume it can see another player's cards before a showdown or a result.
- **UI copy** is Vietnamese; use the strings given in the tasks verbatim (they come from spec §5, §11.5 and §13–§14). Numbers in `vi-VN` (`1.000 xu`, via `formatXu` or `toLocaleString("vi-VN")`); a signed amount uses the minus sign − (U+2212, a visible character), not a hyphen.
- **Art** is original pixel art drawn in code (procedural painters and small canvas shapes), never copied from any game or card deck. The repo is public: no copyrighted assets, no secrets.
- **Never type a literal invisible character** (zero-width, bidi control, odd space, combining mark) into a source file: SQL writes them as escapes (`\u200b`), TypeScript as `"\u200b"`.
- **SQL** is additive and re-runnable (`create … if not exists`, `create or replace`, `drop trigger if exists` + `create trigger`, `drop constraint if exists` + `add constraint`), every function has `set search_path = public, extensions`, every new public RPC gets an explicit `grant execute … to anon, authenticated`, every private helper gets `revoke all … from public, anon, authenticated`, every time rule takes `p_now` and every deal `p_deck integer[] default null` (§3). **The anti-cheat rules for later migrations** (anti-cheat spec §11.3) apply: the six new game RPCs start guarded with `_ac_play` and their hard checks; the five that are not game actions (`card_lobby`, `card_state`, `card_hand`, `card_tick`, `card_leave`) join the guard file's allowlist by signature (R31); the `coin_ledger` reason check keeps `'wipe'` and `0016`'s `harvester` and `produce_sell`; `_ac_holdings` and `_ac_wipe` are re-created from `0016`'s bodies and keep all their parts; `tests/sql/anticheat-guards.sql`'s dynamic loop gains the six (48 RPCs). The owner runs migrations in the Supabase SQL editor — never run anything against a hosted database from here.
- **Local PostgreSQL:** never touch the installed PostgreSQL 18 service, its data directory or port 5432. Tasks 1–7 check the SQL on a throwaway cluster (`initdb --auth=trust`, port **5494**, in your session scratchpad `$SCRATCH`), always with `PGCLIENTENCODING=UTF8`, from the **repo root** (the smokes re-run migrations with `\i` and read `tests/fixtures/*.json` with `\copy`). The cluster mirrors Supabase's grants (`anon` and `authenticated` get every right on each new table and function unless a migration revokes it), and it replays the migrations in the production order: `0004`…`0012`, the v14 smoke (its catch prices hold after `0012` only), `0014`, `0013`, `0015`, `0016`, then `0017`. Every file runs with plain `psql -f`, **outside any open transaction and never under `psql -1`**: `tests/sql/anticheat-guards.sql` runs its own `begin; … rollback;` self-test. Create the check script once, in Git Bash, as `$SCRATCH/v16-sql.sh` (outside the repository) with:

```bash
#!/usr/bin/env bash
# The SQL check of the v16 plan on a throwaway PostgreSQL 18 cluster (trust auth, Supabase's default grants).
# Run it from the repo root:  SCRATCH=<your scratchpad> bash "$SCRATCH/v16-sql.sh"
# Fresh cluster → 0004…0012 → the v14 smoke (it holds after 0012 only) → 0014 → 0013 → 0015 → 0016 → 0017 twice (the
# production order) → the lyrics, v15, anti-cheat and v15.2 smokes, once each → the v16 smoke → the guard file on its
# own. The v15 smoke's last section re-runs 0013, the anti-cheat smoke re-runs 0015 and the v15.2 smoke re-runs 0016;
# they put back their own versions of what 0017 re-creates, so the v16 smoke re-runs 0017 first. Prints the smokes'
# "ok" rows and ALL OK, or FAILED and the end of the log. Leaves no cluster behind. Every file runs with plain
# `psql -f`, outside any open transaction and never under `psql -1`: tests/sql/anticheat-guards.sql (which the
# anti-cheat, v15.2 and v16 smokes end with) runs its own `begin; … rollback;` self-test.
set -u
export PGCLIENTENCODING=UTF8
PORT=5494
PG="/c/Program Files/PostgreSQL/18/bin"
D="$SCRATCH/pg-v16"
LOG="$SCRATCH/v16-sql.log"
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
         supabase/migrations/0016_*.sql; do
  "${PSQL[@]}" -f "$f" >>"$LOG" 2>&1 || fail "$f"
done
M=supabase/migrations/0017_v16_cards.sql
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M"
"${PSQL[@]}" -f "$M" >>"$LOG" 2>&1 || fail "$M (re-run)"
echo "0017 twice ok"
smoke tests/sql/lyrics-lockdown-smoke.sql
smoke tests/sql/v15-smoke.sql
smoke tests/sql/anticheat-smoke.sql
smoke tests/sql/v15-2-smoke.sql
smoke tests/sql/v16-smoke.sql
smoke tests/sql/anticheat-guards.sql
"$PG/pg_ctl" -D "$D" stop -m fast >/dev/null 2>&1; rm -rf "$D"
echo "ALL OK"
```

  `SCRATCH` is your session scratchpad in Git Bash form (for example `/c/Users/<you>/AppData/Local/Temp/claude/<…>/scratchpad`): `export SCRATCH=…` in the shell that runs the script (with `set -u` it stops at once when `SCRATCH` is unset). A `WARNING: "wal_level" is insufficient` from `create publication` and `NOTICE … does not exist, skipping` lines only go to the log. The lyrics, v15, anti-cheat and v15.2 smokes run once each: the lyrics smoke counts the rows it wrote, and the v15 smoke's last section, the anti-cheat smoke and the v15.2 smoke re-run `0013`, `0015` and `0016`, which put back their own versions of what `0017` re-creates — so the v16 smoke re-runs `0017` first. Delete nothing else in `$SCRATCH`; the script removes its own cluster.
- **The repo is public:** never commit a password, a token or a key. The integration tests read `SUPABASE_TEST_URL` and `SUPABASE_TEST_ANON_KEY` (and, for the full game, `SUPABASE_TEST_CARD_PLAYER_A` / `SUPABASE_TEST_CARD_PLAYER_B` as `name:password` of two funded test accounts) from the environment and are skipped without them. Never type a password (account or room) in a browser.
- **Do not start dev servers.** `pnpm build` (Task 18) is the only build; in a checkout without `.env.local`, give it `NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_test_key` (the test values of `vitest.config.ts`).
- **Deploy order** is the owner's: `0017` after `0016`, in the production order `0012` → `0014` → `0013` → `0015` → `0016` → `0017`, then the v16 client. A v16 client against a database without `0017` shows "Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017." at the tables and keeps everything else; an older client draws the hall without the corner and never calls the card RPCs. `0017` requires `0016`: it re-creates `0016`'s `_ac_holdings` (whose body reads `produce_stock` and the sprayer's tank).

## Rulings (decisions where the spec is silent, ambiguous or self-contradictory)

**Server**
- **Tiến lên money is one pure function.** `_tl_money(pub, event, hands)` takes the public state, one money event (`cut`, `close`, `out`, `forfeit`, `leave`, `trang`, `end`) and the hands, and returns the new lines in half-stakes (1 S = 2). `_tl_pay` is the spec's `_card_line` for Tiến lên: it pays a line up to what is left of the payer's 10 S cap (R14) and drops it when either seat is settled, gone or leaving in the same sweep (R13). The engine calls `_tl_money` at each money event (`_tl_event`) and moves the escrows by the lines' paid amounts; `tlMoney` / `tlSettle` mirror it, and the `tienlen.settle` fixtures fold it in both languages. Cào's lines are exact by construction (each player's 1 S is escrowed), so Cào has no line helper.
- **Lines that pay 0** (the cap spent, a settled party, a recipient in the leaving set) are not recorded. **Cóng** is one line `why: "cong"` of 2 S plus the cóng player's thối.
- **Deals** hand out blocks in ascending seat order (13, 3 or 2 cards each); the poker board is the next 5 cards of the same deck (no burns). The fixtures and the smoke write cards as codes (`"10H"`, `"AS"`, `"2D"`: rank + S, C, D, H).
- **`seq` moves only with game actions.** A sit, a top-up or a leave outside a hand bumps `v` only; a leave inside a live hand bumps `seq` too (it changes whose turn it may be).
- **`stale` rolls the sweep back.** An action with an old `seq` raises `stale` after the sweep, so the sweep's changes are rolled back with it; the client answers `stale` with `card_tick` (which commits what is due), not `card_state` — otherwise a ban or kick waiting in the sweep would make every action `stale` until the next deadline.
- **`_card_live`** (is this seat in the hand?) requires the same account in the hand row: `_card_forfeit_all` deletes a row at once, and a newcomer may sit in that seat before the hand ends.
- **`card_sit`'s buy-in bound uses `p_stake`** (the table's stake may be unset); **`pk_topup`'s hard `bad_qty` bound is 2 000 000** (200 BB at the top stake), because the table's stake can change between the client's view and the call; `too many chips` (raised, not flagged) does the rest. **`_card_touch`** writes `seen_at` at most once per 10 s, on reads and writes.
- **The out-of-turn cut** (💣 Chặt!, R9) is exactly 4 đôi thông (4 pairs); 5 đôi thông never reaches play (it is tới trắng). A forfeit clears `must` only when the must card was in the forfeiter's hand. `tl_play` also flags a multi-dimensional array as `bad_cards`.
- **Timeouts:** two consecutive missed turns count across hands; `missed` is reset only by a real action. `card_log` records a seat stood up at a deal as `idle` besides `leave`, `timeout`, `sweep` and `forfeit_all`.
- **Dispatch:** `_card_due` (the sweep's timed step), `_card_leave_live` (leaves inside a hand) and `_card_action` (the moves, after the lock, the sweep, the seat and the `seq`) branch per game; Tasks 5 and 6 add their game's branch. `_card_lock_wallets` locks every seated account's wallet of the table in account-id order before any hand money moves (a deal, a leave), so later settlements never lock out of order (§11.6).
- **Cào:** `pub = {dealer, order, left, note}`. In `deal_wait`, `dealer` and `turn` show the previewed dealer; the preview is recomputed only when the previewed seat is gone (a sit or leave never moves it under a player who may be pressing 🃏 Chia bài, so an honest press never meets `not dealer`). A preview that finds nobody who can cover the dealer's escrow sets `note: "no_dealer"`; a deal that finds nobody starts the wait again, so the table retries every 15 s. `last.hands` shows the hands still in play (a leaver's cards stay private); a cancelled hand shows `hands: {}` and the leavers' lines. The dealer's missed deals count as misses; at the showdown a dealer with two misses in a row is stood up (`timeout`), and `cao_deal` resets it.
- **Poker:** `pub` also carries `order`; each player's `acted` is the bet level after their last action, and raising re-opens for a player when `cur − acted ≥ raise` (so cumulative short all-ins re-open correctly, TDA). Refusals: a check, call or bet out of place → `invalid bet`; a raise that is not re-opened (or an all-in above the call when it is not) → `cannot raise`; an amount out of range → `invalid bet` (all soft `bad_move`). An uncalled bet returned to a live owner clears its all-in flag. When a sweep leaves nobody live, `_pk_refund` returns every contribution (to the stack while seated, else to the wallet as `card_refund`; a deleted account's share goes with it). On a room deletion, the contributions of banned and deleted accounts are dead money split among the live seats, the odd xu from the button. `last.pots[].hand` is the winners' `_pk_eval` key; the client names it.
- **`_card_forfeit_all`** locks the account's tables in `(room_id, game)` order, runs the leave operation for each seat (`forfeit_all`), deletes the rows at once, then resets, readies and bumps each table. **`_ac_wipe`** takes its snapshot after the forfeit, so the xu the seats give back are part of the wiped balance and `snapshot.cards` is `[]`.
- **`_ac_holdings` and `_ac_wipe` are `0016`'s bodies** plus the card parts (`"cards"`; `_card_forfeit_all` first). They keep v15.2's hoa màu, tank and crop fields; the v16 smoke checks that a wipe still takes the hoa màu and empties the tank.
- **The guard file** allowlists the five non-game card RPCs by signature and calls the six guarded ones in its loop: 43 after Task 3, 45 after Task 4, 46 after Task 5, 48 after Task 6. Its comment no longer counts them.

**Client**
- **Hints:** `tlCandidates` gives one candidate per (type, length, key) with the lowest fillers; `tlLegalPlays` orders them weakest first — the non-bombs by key, type and length, then the bombs — which is the order 💡 Gợi ý cycles; `tlSlams` lists the 4 đôi thông that beat the top. "Xếp bài" toggles `tlArrange(hand, "rank" | "group")` (group: tứ quý, sám cô, đôi, then the rest, each ascending).
- **Names:** `caoName` gives "Sáp K", "Ba tây", "{n} nút" or "Bù"; `pkHandName` gives the Vietnamese rank names of pokervietnam.net ("Đôi K", "Thú A và 8", "Thùng phá sảnh A (royal flush)", "Mậu thầu A", …). `pkPresets`: ½ pot and pot are sized on the pot after my call (`cur + (pot + toCall) / 2` and `cur + pot + toCall` for a raise), clamped to the legal bounds.
- **Parsers** return `null` for anything malformed — a state whose `pub` or `last` does not parse is `null` as a whole, so the panel keeps the last good state; an empty `pub` (`{}`, an idle table) parses as `null`.
- **Data flow (§12, R26):** an answer applies only when its `v` is not older than the applied one, and my hand only from the newest call; a `cv {id, v}` from a non-member or with `v` ≤ the applied version is dropped, the rest go through the per-sender budget `cv` (5 a second, burst 5, in `lib/game/net/budget.ts`); refetches wait 150 ms, start at least 500 ms apart with one trailing; the 15 s poll re-arms after every fetch. Ticks: a seated client ticks at deadline + 300 ms + 200 ms × its index among the seated players, a spectator 3 s later; a tick that found nothing due (the clocks disagree) goes again at least 1 s later, until the state moves on.
- **The controller** keeps two `useCardTable`s: one for the seat I hold (found from the states it sees and the lobby) and one for the open panel when it shows another table. The turn toast ("🃏 Đến lượt bạn ở bàn {game}!") shows once per `hand_no:seq` while that table's panel is closed.
- **Texts not in the spec:** the Cào countdown "Lật bài sau {n} giây" is the status line only; `LEAVE_CONFIRM` ("Rời bàn giữa ván sẽ bị xử thua…") confirms a stand-up in a live hand at all three tables; the Cào dealer's stand-up button reads "Đứng dậy · Chờ lật bài xong" and is disabled during `peek`; an empty seat offers "Ngồi đây" to a player without a seat at this table, and reads "Ghế {n}" to one who has a seat there; `WARN_LOCK` becomes "…mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút…"; the admin's holdings line adds "{n} ghế bàn bài ({xu})" when the account sits at card tables.
- **Layout:** `ParchmentModal`'s own `max-w-lg` comes later in Tailwind's output than `max-w-3xl`, so the panel and the rules book widen with `sm:max-w-3xl` / `sm:max-w-2xl`. On phones the seats form a scrolling row above the felt; from `sm` they sit around it.

**Tests and docs**
- **The integration test** checks the zero-sum rule through the two wallets (`fishing_state.coins`), because `coin_ledger` is private; the full 2-player game needs two funded test accounts from the environment and is skipped without them (a fresh account has no xu).
- **The anti-cheat spec** is amended in Task 18 wherever v16 changes what it states: the hard signals and `bad_move`, the lock list and the guard file (48 RPCs, five more on the allowlist), the wipe's card seats, `WARN_LOCK`, the admin labels, and rules 4 and 7.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/0017_v16_cards.sql` | A tables and the ledger check · B the pure rules (cards, Tiến lên, Cào, poker) · C table machinery · D the three engines · E the 11 public RPCs · F `_card_forfeit_all`, `_card_room_gone`, the BEFORE DELETE triggers, `_ac_holdings`, `_ac_wipe` |
| `tests/fixtures/card-cases.json` | the shared cases of the rules (§17), read by the SQL smoke and the TypeScript tests |
| `tests/sql/v16-smoke.sql` | the smoke of every section (seven parts), ending with the guard file |
| `tests/sql/anticheat-guards.sql` (mod) | the five card RPCs on the allowlist, the six guarded ones in the loop (48) |
| `lib/game/cards/deck.ts`, `tienlen.ts`, `cao.ts`, `poker.ts` | cards and labels; the mirrors of the rules and the client's hints and bounds |
| `lib/game/cards/state.ts`, `rpc.ts`, `messages.ts`, `rules.ts`, `channel.ts` | parsers, RPC wrappers, Vietnamese texts, 📜 Sổ luật's content, the `cv` channel |
| `lib/game/net/budget.ts` (mod) | `CARD_LIMITS`: the `cv` budget |
| `hooks/useCardTable.ts`, `useCardLobby.ts`, `useCardsController.ts` | one table; the hall's lobby; the corner's controller |
| `components/game/cards/*` | `PlayingCard`, `CardHand`, `SitDialog`, `RulesBook`, `TienLenBoard`, `CaoBoard`, `PokerBoard`, `CardTablePanel`, `CardSeatChip`, `CardOverlays` |
| `lib/game/maps/types.ts`, `hall.ts`, `props.ts`, `hall-art.ts`, `lib/game/engine.ts`, `components/game/GameCanvas.tsx` (mod) | the corner in the hall and the tables' labels on the canvas |
| `lib/game/overlays.ts`, `components/game/GameShell.tsx`, `lib/anticheat.ts`, `lib/admin.ts`, `components/admin/AnticheatTab.tsx` (mod) | the corner in the shell; `WARN_LOCK`; the admin labels and holdings |
| `README.md`, `docs/…/2026-09-25-music-together-anticheat-design.md` (mod), `tests/integration/v16.test.ts` | the v16 section, the anti-cheat amendments, the integration test |
| `tests/unit/cards-*.test.ts(x)`, `use-card*.test.tsx`, `tests/unit/helpers/card-states.ts` and the updated game tests | the unit and RTL tests (§17) |

## Plan conflict scan (pre-flight, done by the plan author)

- **Validated end to end.** The plan author built every task on a scratch branch from `391eb7a` with one commit per task: tsc clean, each task's tests green and its eslint command clean after every task, and after each of Tasks 1–7 the SQL check above (`ALL OK`). After Task 18: the full suite (115 files passed / 13 skipped, 1 081 tests passed / 75 skipped), `pnpm lint` at the 33 baseline problems with none in this plan's files, and `pnpm build`. The code blocks below are generated from those commits, and a mechanical replay of this document on a clean checkout of `391eb7a` — each task's blocks up to Step 2, its Step 2 check failing as stated, then the rest — reproduced every file of every commit, with tsc, the task's tests, its eslint command and the SQL check green after every task. If an edit's "old" text is not found, re-read the file — do not improvise a different change.
- **Rebased once.** The plan was first built on `5442a8b`; when v15.2 landed it was rebased onto `391eb7a` and rebuilt: the guard file keeps v15.2's seven calls before the card calls (43–48 RPCs), `_ac_holdings` and `_ac_wipe` are re-derived from `0016`'s bodies (the v16 smoke now checks the hoa màu and the tank in a wipe), `overlayLocks` gains the card flags next to `farmRound`, `holdingsLine` keeps the hoa màu, the engine keeps v15.2's harvester imports, the README's v16 section follows v15.2's, the SQL check runs `0016` and the v15.2 smoke, and `0017` now requires `0016`.
- **Files several tasks touch, in order:** `0017_v16_cards.sql` (Task 1 creates A–B, Task 2 adds B's Cào and poker, Task 3 C and E's first RPCs, Tasks 4–6 D and their RPCs, Task 7 F); `tests/sql/v16-smoke.sql` (Task 1 creates it, Tasks 2–7 add their parts; Task 7 ends it with `\i tests/sql/anticheat-guards.sql`); `tests/fixtures/card-cases.json` (Tasks 1, 2); `tests/sql/anticheat-guards.sql` (Tasks 3–6). Each task's blocks are generated against the file as the previous task left it.
- **Shared with v15.2's files** (already on `391eb7a`): `lib/game/engine.ts`, `lib/game/overlays.ts`, `components/game/GameShell.tsx`, `lib/admin.ts`, `components/admin/AnticheatTab.tsx`, `tests/sql/anticheat-guards.sql`, `README.md` and the anti-cheat spec — the blocks below are generated against their `391eb7a` text.
- **Nothing ships from here.** The integration tests are skipped without `SUPABASE_TEST_URL` (they were type-checked and linted only); the owner's manual pass (§17) comes after deploy.
- **Spec coverage:** §5 (Task 12), §6 (Tasks 3–7), §7 (Tasks 1, 4, 8), §8 (Tasks 2, 5, 9), §9 (Tasks 2, 6, 9), §10 (Tasks 3–6, 13), §11 (Tasks 1–7, 10, 17), §12 (Tasks 13, 14), §13 (Tasks 10, 13–17), §14 (Tasks 11, 15), §15 (Tasks 12, 15, 16), §16 (Tasks 15, 18), §17 (every task).

---

### Task 1: Database — the tables, the ledger reasons and the Tiến lên rules as pure functions (`0017` sections A–B); the shared fixtures

**Files:**
- Create: `supabase/migrations/0017_v16_cards.sql` (sections A–B; Tasks 2–7 add the rest)
- Create: `tests/fixtures/card-cases.json` (the Tiến lên cases; Task 2 adds Cào and poker)
- Create: `tests/sql/v16-smoke.sql` (part 1; Tasks 2–7 add the rest)

**Interfaces:**
- Consumes (migrations `0004`–`0016`): `rooms(id)`, `accounts(id)`, `coin_ledger(account_id, delta, balance, reason, ref)` and `0016`'s reason check (`…, 'wipe', 'harvester', 'produce_sell'`), the extension functions in schema `extensions` (`gen_random_bytes`).
- Produces (Postgres, section A): the private tables (RLS on, revoked from `anon` and `authenticated`)
  - `card_tables(room_id → rooms on delete cascade, game ∈ tienlen|cao|poker, stake null|100|1000|10000, v bigint, seq int, hand_no int, phase idle|countdown|playing|deal_wait|peek|result, turn, deadline, pos, lead_id, first_game, pub jsonb, last jsonb)`, PK `(room_id, game)`;
  - `card_seats(room_id, game, seat, account_id → accounts on delete cascade, chips, escrow ≥ 0, leaving, missed, seen_at, sat_at)`, PK `(room_id, game, seat)`, unique `(room_id, account_id)` (leaving rows included, R2);
  - `card_hands(room_id, game, hand_no, seat, account_id, dealt int[], cards int[])`, `card_secrets(room_id, game, hand_no, board int[])`, `card_log(id, room_id, game, hand_no, account_id, seat, action, detail, at)` with `idx_card_log_at`;
  - the `coin_ledger` reason check: `0016`'s list plus `card_hold`, `card_settle`, `card_buyin`, `card_cashout`, `card_refund`.
- Produces (section B, private, `immutable` where pure): `_card_max(game) → int` (4/6/6), `_card_ints(jsonb) → int[]`, `_card_after(order int[], seat) → int[]` (the seats after `seat`, then those before it), `_card_rand(n) → int` (unbiased, from `gen_random_bytes`), `_card_shuffle() → int[]` (Fisher–Yates); `_tl_combo(int[]) → jsonb {type, len, key, cards}` or null, `_tl_beats(top, x) → bool`, `_tl_value(combo) → int` (half-stakes), `_tl_thoi(int[]) → int`, `_tl_trang(int[]) → text` (`sanh_rong`, `nam_doi_thong`, `tu_quy_heo`, `sau_doi` or null), `_tl_trang_rank(text) → int`, `_tl_pay(pub, from, to, h, why, gone int[] default '{}') → jsonb` (the `pub` with one more line `{from, to, h, paid, why}` in `lines`, capped at 20 h a payer), `_tl_money(pub, ev, hands) → jsonb` (the next `pub` after one money event: `cut`, `close`, `out`, `forfeit`, `leave`, `trang` or `end`).
- Produces (smoke): `tests/sql/v16-smoke.sql` re-runs `0017` first, defines `pg_temp.err(sql) → text`, `pg_temp.c(code) → int` and `pg_temp.cs(jsonb) → int[]`, reads the fixtures with `\copy`, replays `tienlen.combo`, `tienlen.beats`, `tienlen.trang`, `tienlen.thoi` and `tienlen.settle`, checks the shuffle, that the five tables and the helpers are private, and the ledger reasons, and prints `v16 rules smoke ok`.

- [ ] **Step 0: Record the baseline and create the SQL check script**

Run `pnpm test`, `npx tsc --noEmit` and `pnpm lint`, and write down the counts (the plan author's are in Global Constraints). Create `$SCRATCH/v16-sql.sh` from Global Constraints if it does not exist yet.

- [ ] **Step 1: Write the fixtures and smoke part 1**

Create `tests/fixtures/card-cases.json` with exactly:

```json
{
  "cards": "Cards are written rank + suit: 3 4 5 6 7 8 9 10 J Q K A 2 and S (♠) C (♣) D (♦) H (♥). Tiến lên amounts are in half-stakes (h): 2 h = 1 S.",
  "tienlen": {
    "combo": [
      { "cards": ["7D"], "expect": { "type": "single", "len": 1, "key": "7D" }, "value": 0 },
      { "cards": ["2H"], "expect": { "type": "single", "len": 1, "key": "2H" }, "value": 2 },
      { "cards": ["2S"], "expect": { "type": "single", "len": 1, "key": "2S" }, "value": 1 },
      { "cards": ["9S", "9H"], "expect": { "type": "pair", "len": 2, "key": "9H" }, "value": 0 },
      { "cards": ["2S", "2D"], "expect": { "type": "pair", "len": 2, "key": "2D" }, "value": 3 },
      { "cards": ["2C", "2S"], "expect": { "type": "pair", "len": 2, "key": "2C" }, "value": 2 },
      { "cards": ["2D", "2H"], "expect": { "type": "pair", "len": 2, "key": "2H" }, "value": 4 },
      { "cards": ["QC", "QD", "QH"], "expect": { "type": "triple", "len": 3, "key": "QH" }, "value": 0 },
      { "cards": ["2S", "2C", "2D"], "expect": { "type": "triple", "len": 3, "key": "2D" }, "value": 0 },
      { "cards": ["8S", "8C", "8D", "8H"], "expect": { "type": "quad", "len": 4, "key": "8H" }, "value": 4 },
      { "cards": ["5S", "6D", "7C"], "expect": { "type": "straight", "len": 3, "key": "7C" }, "value": 0 },
      { "cards": ["7C", "5S", "6D"], "expect": { "type": "straight", "len": 3, "key": "7C" }, "value": 0 },
      { "cards": ["6S", "7S", "8S", "9S"], "expect": { "type": "straight", "len": 4, "key": "9S" }, "value": 0 },
      { "cards": ["QD", "KS", "AH"], "expect": { "type": "straight", "len": 3, "key": "AH" }, "value": 0 },
      { "cards": ["3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS", "AS"], "expect": { "type": "straight", "len": 12, "key": "AS" }, "value": 0 },
      { "cards": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": { "type": "pairs", "len": 3, "key": "6D" }, "value": 3 },
      { "cards": ["QS", "QD", "KC", "KH", "AS", "AD"], "expect": { "type": "pairs", "len": 3, "key": "AD" }, "value": 3 },
      { "cards": ["4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H"], "expect": { "type": "pairs", "len": 4, "key": "7H" }, "value": 6 },
      { "cards": ["3S", "3C", "4D", "4H", "5S", "5C", "6D", "6H", "7S", "7C"], "expect": { "type": "pairs", "len": 5, "key": "7C" }, "value": 6 },
      { "cards": ["KS", "AH", "2C"], "expect": null },
      { "cards": ["AH", "2C", "3D"], "expect": null },
      { "cards": ["10S", "JS", "QS", "KS", "AS", "2S"], "expect": null },
      { "cards": ["5S", "6D", "8C"], "expect": null },
      { "cards": ["5S", "5D", "6C"], "expect": null },
      { "cards": ["9S", "10H"], "expect": null },
      { "cards": ["3S", "4C"], "expect": null },
      { "cards": ["KS", "KD", "AC", "AH", "2S", "2D"], "expect": null },
      { "cards": ["4S", "4D", "4C", "5H", "5S", "6D"], "expect": null },
      { "cards": ["4S", "4D", "5C", "5H", "7S", "7D"], "expect": null },
      { "cards": ["4S", "4D", "5C", "5H"], "expect": null },
      { "cards": ["9S", "9H", "9D", "9C", "10S"], "expect": null },
      { "cards": ["3S", "3C", "4D", "4H", "5S", "5C", "5D"], "expect": null },
      { "cards": ["3S", "4S", "5S", "6S", "7S", "8S", "9S", "10S", "JS", "QS", "KS", "AS", "2S"], "expect": null },
      { "cards": ["7D", "7D"], "expect": null },
      { "cards": [], "expect": null }
    ],
    "beats": [
      { "top": ["7D"], "x": ["7H"], "expect": true },
      { "top": ["7H"], "x": ["7D"], "expect": false },
      { "top": ["8S"], "x": ["7H"], "expect": false },
      { "top": ["2S"], "x": ["2H"], "expect": true },
      { "top": ["2H"], "x": ["2D"], "expect": false },
      { "top": ["AH"], "x": ["2S"], "expect": true },
      { "top": ["9S", "9H"], "x": ["10S", "10C"], "expect": true },
      { "top": ["9C", "9H"], "x": ["9S", "9D"], "expect": false },
      { "top": ["9S", "9D"], "x": ["9C", "9H"], "expect": true },
      { "top": ["5S", "6D", "7C"], "x": ["6S", "7D", "8H"], "expect": true },
      { "top": ["6D", "7H", "8C"], "x": ["6S", "7D", "8H"], "expect": true },
      { "top": ["6S", "7D", "8H"], "x": ["6D", "7H", "8C"], "expect": false },
      { "top": ["5S", "6D", "7C"], "x": ["6S", "7D", "8H", "9S"], "expect": false },
      { "top": ["6S", "7S", "8S", "9S"], "x": ["7C", "8C", "9C", "10C"], "expect": true },
      { "top": ["5S", "6D", "7C"], "x": ["8S", "8H"], "expect": false },
      { "top": ["3S"], "x": ["4S", "4C"], "expect": false },
      { "top": ["4S", "4C"], "x": ["5S"], "expect": false },
      { "top": ["JS", "JC", "JD"], "x": ["QS", "QC", "QD"], "expect": true },
      { "top": ["2H"], "x": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": true },
      { "top": ["2S"], "x": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": true },
      { "top": ["2S", "2H"], "x": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": false },
      { "top": ["2H"], "x": ["8S", "8C", "8D", "8H"], "expect": true },
      { "top": ["2S", "2H"], "x": ["8S", "8C", "8D", "8H"], "expect": true },
      { "top": ["4S", "4D", "5C", "5H", "6S", "6D"], "x": ["3S", "3C", "3D", "3H"], "expect": true },
      { "top": ["QS", "QD", "KC", "KH", "AS", "AD"], "x": ["3S", "3C", "3D", "3H"], "expect": true },
      { "top": ["4S", "4D", "5C", "5H", "6S", "6D"], "x": ["4C", "4H", "5S", "5D", "6C", "6H"], "expect": true },
      { "top": ["4S", "4D", "5C", "5H", "6S", "6D"], "x": ["3S", "3C", "4C", "4H", "5S", "5D"], "expect": false },
      { "top": ["4S", "4D", "5C", "5H", "6S", "6D"], "x": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "expect": true },
      { "top": ["8S", "8C", "8D", "8H"], "x": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "expect": true },
      { "top": ["8S", "8C", "8D", "8H"], "x": ["9S", "9C", "9D", "9H"], "expect": true },
      { "top": ["9S", "9C", "9D", "9H"], "x": ["8S", "8C", "8D", "8H"], "expect": false },
      { "top": ["2S", "2H"], "x": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "expect": true },
      { "top": ["2H"], "x": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "expect": true },
      { "top": ["AH"], "x": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": false },
      { "top": ["AH"], "x": ["8S", "8C", "8D", "8H"], "expect": false },
      { "top": ["AS", "AH"], "x": ["8S", "8C", "8D", "8H"], "expect": false },
      { "top": ["2S", "2C", "2D"], "x": ["8S", "8C", "8D", "8H"], "expect": false },
      { "top": ["2S", "2C", "2D"], "x": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "expect": false },
      { "top": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "x": ["8S", "8C", "8D", "8H"], "expect": false },
      { "top": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "x": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": false },
      { "top": ["3S", "3C", "4C", "4H", "5S", "5D", "6C", "6H"], "x": ["7S", "7C", "8C", "8H", "9S", "9D", "10C", "10H"], "expect": true },
      { "top": ["8S", "8C", "8D", "8H"], "x": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": false }
    ],
    "trang": [
      { "cards": ["3S", "4S", "5D", "6C", "7H", "8S", "9S", "10D", "JC", "QH", "KS", "AS", "2D"], "expect": "sanh_rong" },
      { "cards": ["3S", "3C", "4S", "4C", "5S", "5C", "6S", "6C", "7S", "7C", "9D", "JD", "KH"], "expect": "nam_doi_thong" },
      { "cards": ["3S", "3C", "3D", "4S", "4C", "5S", "5C", "6S", "6C", "7S", "7C", "9D", "KH"], "expect": "nam_doi_thong" },
      { "cards": ["10S", "10C", "JS", "JC", "QS", "QC", "KS", "KC", "AS", "AC", "3D", "5H", "7C"], "expect": "nam_doi_thong" },
      { "cards": ["JS", "JC", "QS", "QC", "KS", "KC", "AS", "AC", "2S", "2C", "3S", "5D", "7H"], "expect": null },
      { "cards": ["2S", "2C", "2D", "2H", "3S", "4D", "5C", "7H", "8S", "9D", "JC", "KH", "AS"], "expect": "tu_quy_heo" },
      { "cards": ["3S", "3C", "5S", "5C", "7S", "7C", "9S", "9C", "JS", "JC", "KS", "KC", "AD"], "expect": "sau_doi" },
      { "cards": ["3S", "3C", "3D", "3H", "5S", "5C", "7S", "7C", "9S", "9C", "JS", "JC", "AD"], "expect": "sau_doi" },
      { "cards": ["3S", "3C", "5S", "5C", "7S", "7C", "9S", "9C", "JS", "JC", "KS", "AD", "QH"], "expect": null },
      { "cards": ["3S", "3C", "3D", "5S", "5C", "7S", "7C", "9S", "9C", "JS", "JC", "KH", "AD"], "expect": null },
      { "cards": ["3S", "3C", "4S", "4C", "5S", "5C", "6S", "6C", "7S", "7C", "9S", "9C", "KH"], "expect": "nam_doi_thong" },
      { "cards": ["2S", "2C", "2D", "2H", "3S", "3C", "5S", "5C", "7S", "7C", "9S", "9C", "KH"], "expect": "tu_quy_heo" },
      { "cards": ["3S", "4S", "5D", "6C", "7H", "8S", "9S", "10D", "JC", "QH", "KS", "2S", "2D"], "expect": null }
    ],
    "thoi": [
      { "cards": [], "expect": 0 },
      { "cards": ["2S"], "expect": 1 },
      { "cards": ["2C"], "expect": 1 },
      { "cards": ["2D"], "expect": 2 },
      { "cards": ["2H", "2S"], "expect": 3 },
      { "cards": ["9S", "9C", "9D", "9H"], "expect": 4 },
      { "cards": ["4S", "4D", "5C", "5H", "6S", "6D"], "expect": 3 },
      { "cards": ["4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H"], "expect": 6 },
      { "cards": ["4S", "4D", "4C", "5H", "5S", "6D", "6C"], "expect": 3 },
      { "cards": ["4S", "4D", "5C", "5H"], "expect": 0 },
      { "cards": ["4S", "4D", "5C", "5H", "6S", "6D", "6C", "6H"], "expect": 4 },
      { "cards": ["4S", "4D", "5C", "5H", "6S", "6D", "6C", "6H", "7S", "7D", "8S", "8D", "9S"], "expect": 4 },
      { "cards": ["2H", "2D", "2S", "9S", "9C", "9D", "9H", "3S", "3C", "4D", "4H", "5S", "5C"], "expect": 12 },
      { "cards": ["AS", "AC", "KS", "KD", "QS", "QH", "JS", "JH"], "expect": 6 },
      { "cards": ["KS", "KD", "AS", "AC", "2S", "2C"], "expect": 2 },
      { "cards": ["3S", "3C", "5S", "5C", "7S", "7C"], "expect": 0 },
      { "cards": ["2D", "9S", "9C", "9D", "9H", "3S", "5C", "7D", "JH", "KS", "AC", "4D", "6H"], "expect": 6 }
    ],
    "settle": [
      {
        "name": "plain: bét pays nhất 1 S, ba pays nhì ½ S",
        "order": [1, 2, 3, 4], "played": [1, 2, 3, 4], "hands": { "4": ["3S"] },
        "events": [{ "k": "out", "seat": 1 }, { "k": "out", "seat": 2 }, { "k": "out", "seat": 3 }, { "k": "end" }],
        "expect": {
          "lines": [[4, 1, 2, 2, "bet"], [3, 2, 1, 1, "ba"]],
          "places": { "1": 1, "2": 2, "3": 3, "4": 4 }, "out": { "1": "done", "2": "done", "3": "done" },
          "net": { "1": 2, "2": 1, "3": -1, "4": -2 }
        }
      },
      {
        "name": "example 1: a cut chain across three players, then thối heo to the player just above",
        "order": [1, 2, 3, 4], "played": [1, 2, 3, 4], "hands": { "4": ["2S"] },
        "events": [
          { "k": "cut", "seat": 2, "top": { "seat": 4, "cards": ["2H"], "done": false } },
          { "k": "cut", "seat": 3, "top": { "seat": 2, "cards": ["5S", "5C", "6S", "6C", "7S", "7C"], "done": false } },
          { "k": "close" }, { "k": "out", "seat": 1 }, { "k": "out", "seat": 2 }, { "k": "out", "seat": 3 }, { "k": "end" }
        ],
        "expect": {
          "lines": [[2, 3, 5, 5, "chat"], [4, 1, 2, 2, "bet"], [3, 2, 1, 1, "ba"], [4, 3, 1, 1, "thoi"]],
          "places": { "1": 1, "2": 2, "3": 3, "4": 4 }, "out": { "1": "done", "2": "done", "3": "done" },
          "net": { "1": 2, "2": -4, "3": 5, "4": -3 }
        }
      },
      {
        "name": "a void chain: the victim went out with the cut 2",
        "order": [1, 2, 3, 4], "played": [1, 2, 3, 4], "hands": { "3": ["4S"] },
        "events": [
          { "k": "out", "seat": 4 },
          { "k": "cut", "seat": 2, "top": { "seat": 4, "cards": ["2H"], "done": true } },
          { "k": "close" }, { "k": "out", "seat": 1 }, { "k": "out", "seat": 2 }, { "k": "end" }
        ],
        "expect": {
          "lines": [[3, 4, 2, 2, "bet"], [2, 1, 1, 1, "ba"]],
          "places": { "4": 1, "1": 2, "2": 3, "3": 4 }, "out": { "4": "done", "1": "done", "2": "done" },
          "net": { "1": 1, "2": -1, "3": -2, "4": 2 }
        }
      },
      {
        "name": "example 2: cóng pays nhất 2 S plus thối and takes the bottom place",
        "order": [1, 2, 3, 4], "played": [1, 2, 3],
        "hands": { "4": ["2D", "9S", "9C", "9D", "9H", "3S", "5C", "7D", "JH", "KS", "AC", "4D", "6H"], "3": ["8S"] },
        "events": [{ "k": "out", "seat": 1 }, { "k": "out", "seat": 2 }, { "k": "end" }],
        "expect": {
          "lines": [[4, 1, 10, 10, "cong"], [3, 2, 1, 1, "ba"]],
          "places": { "1": 1, "2": 2, "3": 3, "4": 4 }, "out": { "1": "done", "2": "done", "4": "cong" },
          "net": { "1": 10, "2": 1, "3": -1, "4": -10 }
        }
      },
      {
        "name": "two cóng players: the farthest from nhất in turn order is bét",
        "order": [1, 2, 3, 4], "played": [2, 3], "hands": { "4": ["2S"], "1": ["5D"], "2": ["7C"] },
        "events": [{ "k": "out", "seat": 3 }, { "k": "end" }],
        "expect": {
          "lines": [[4, 3, 5, 5, "cong"], [1, 3, 4, 4, "cong"]],
          "places": { "3": 1, "2": 2, "4": 3, "1": 4 }, "out": { "3": "done", "4": "cong", "1": "cong" },
          "net": { "1": -4, "2": 0, "3": 9, "4": -5 }
        }
      },
      {
        "name": "three cóng players take places 2 to 4 in turn order from nhất",
        "order": [1, 2, 3, 4], "played": [3], "hands": { "4": ["2S"], "1": ["2H"], "2": ["3S"] },
        "events": [{ "k": "out", "seat": 3 }, { "k": "end" }],
        "expect": {
          "lines": [[4, 3, 5, 5, "cong"], [1, 3, 6, 6, "cong"], [2, 3, 4, 4, "cong"]],
          "places": { "3": 1, "4": 2, "1": 3, "2": 4 }, "out": { "3": "done", "4": "cong", "1": "cong", "2": "cong" },
          "net": { "1": -6, "2": -4, "3": 15, "4": -5 }
        }
      },
      {
        "name": "example 4: a forfeit pays 1 S to each active player and its thối to the next of them",
        "order": [1, 2, 3, 4], "played": [1, 2, 3, 4], "hands": { "4": ["2H", "5S"], "3": ["6S"] },
        "events": [{ "k": "out", "seat": 1 }, { "k": "forfeit", "seats": [4] }, { "k": "out", "seat": 2 }, { "k": "end" }],
        "expect": {
          "lines": [[4, 2, 2, 2, "forfeit"], [4, 3, 2, 2, "forfeit"], [4, 2, 2, 2, "thoi"], [3, 1, 2, 2, "bet"]],
          "places": { "1": 1, "2": 2, "3": 3 }, "out": { "1": "done", "2": "done", "4": "forfeit" },
          "net": { "1": 2, "2": 4, "3": 0, "4": -6 }
        }
      },
      {
        "name": "a forfeit closes the open chain it is the victim of",
        "order": [1, 2, 3], "played": [1, 2, 3], "hands": { "2": ["9S"], "3": ["8D"] },
        "events": [
          { "k": "cut", "seat": 1, "top": { "seat": 2, "cards": ["2S"], "done": false } },
          { "k": "forfeit", "seats": [2] }, { "k": "out", "seat": 1 }, { "k": "end" }
        ],
        "expect": {
          "lines": [[2, 1, 1, 1, "chat"], [2, 3, 2, 2, "forfeit"], [2, 1, 2, 2, "forfeit"], [3, 1, 2, 2, "bet"]],
          "places": { "1": 1, "3": 2 }, "out": { "1": "done", "2": "forfeit" },
          "net": { "1": 5, "2": -5, "3": 0 }
        }
      },
      {
        "name": "a forfeit drops the open chain it is the cutter of",
        "order": [1, 2, 3], "played": [1, 2, 3], "hands": { "2": ["2D"], "1": ["4S"] },
        "events": [
          { "k": "cut", "seat": 2, "top": { "seat": 1, "cards": ["2H"], "done": false } },
          { "k": "forfeit", "seats": [2] }, { "k": "out", "seat": 3 }, { "k": "end" }
        ],
        "expect": {
          "lines": [[2, 3, 2, 2, "forfeit"], [2, 1, 2, 2, "forfeit"], [2, 3, 2, 2, "thoi"], [1, 3, 2, 2, "bet"]],
          "places": { "3": 1, "1": 2 }, "out": { "3": "done", "2": "forfeit" },
          "net": { "1": 0, "2": -6, "3": 6 }
        }
      },
      {
        "name": "a player who has played nothing is paid 1 S at a forfeit and becomes cóng only at the first go-out",
        "order": [1, 2, 3, 4], "played": [1, 2, 4], "hands": { "4": ["5D"], "3": ["2C"], "2": ["6C"] },
        "events": [{ "k": "forfeit", "seats": [4] }, { "k": "out", "seat": 1 }, { "k": "end" }],
        "expect": {
          "lines": [[4, 1, 2, 2, "forfeit"], [4, 2, 2, 2, "forfeit"], [4, 3, 2, 2, "forfeit"], [3, 1, 5, 5, "cong"]],
          "places": { "1": 1, "2": 2, "3": 3 }, "out": { "1": "done", "3": "cong", "4": "forfeit" },
          "net": { "1": 7, "2": 2, "3": -3, "4": -6 }
        }
      },
      {
        "name": "the cap binds part-way through a forfeit's 1 S lines, in turn order",
        "order": [1, 2, 3, 4], "played": [1, 2, 3, 4], "hands": { "1": ["2H"] },
        "events": [
          { "k": "cut", "seat": 2, "top": { "seat": 1, "cards": ["2H", "2D"], "done": false } }, { "k": "close" },
          { "k": "cut", "seat": 3, "top": { "seat": 1, "cards": ["3S", "3C", "4S", "4C", "5S", "5C", "6S", "6C"], "done": false } },
          { "k": "close" },
          { "k": "cut", "seat": 4, "top": { "seat": 1, "cards": ["8S", "8C", "8D", "8H"], "done": false } }, { "k": "close" },
          { "k": "cut", "seat": 2, "top": { "seat": 1, "cards": ["9S", "9C", "10S", "10C", "JS", "JC"], "done": false } },
          { "k": "close" },
          { "k": "forfeit", "seats": [1] }, { "k": "out", "seat": 2 }, { "k": "out", "seat": 3 }, { "k": "end" }
        ],
        "expect": {
          "lines": [
            [1, 2, 4, 4, "chat"], [1, 3, 6, 6, "chat"], [1, 4, 4, 4, "chat"], [1, 2, 3, 3, "chat"],
            [1, 2, 2, 2, "forfeit"], [1, 3, 2, 1, "forfeit"], [4, 2, 2, 2, "bet"]
          ],
          "places": { "2": 1, "3": 2, "4": 3 }, "out": { "1": "forfeit", "2": "done", "3": "done" },
          "net": { "1": -20, "2": 11, "3": 7, "4": 2 }
        }
      },
      {
        "name": "two seats swept together as the last active players: no line is paid",
        "order": [1, 2, 3], "played": [1, 2, 3], "hands": { "2": ["2H"], "3": ["2D"] },
        "events": [{ "k": "out", "seat": 1 }, { "k": "forfeit", "seats": [3, 2] }, { "k": "end" }],
        "expect": {
          "lines": [], "places": { "1": 1 }, "out": { "1": "done", "2": "forfeit", "3": "forfeit" },
          "net": { "1": 0, "2": 0, "3": 0 }
        }
      },
      {
        "name": "the survivor of forfeits is nhất and pays nothing",
        "order": [1, 2, 3], "played": [1, 2, 3], "hands": { "1": ["2S"], "2": ["5S"], "3": ["2H"] },
        "events": [{ "k": "forfeit", "seats": [1, 2] }, { "k": "end" }],
        "expect": {
          "lines": [[1, 3, 2, 2, "forfeit"], [1, 3, 1, 1, "thoi"], [2, 3, 2, 2, "forfeit"]],
          "places": { "3": 1 }, "out": { "1": "forfeit", "2": "forfeit" },
          "net": { "1": -3, "2": -2, "3": 5 }
        }
      },
      {
        "name": "the cap: nobody loses more than 10 S in one game",
        "order": [1, 2, 3, 4], "played": [1, 2, 3, 4], "hands": { "4": ["2S", "9S", "9C", "9D", "9H"] },
        "events": [
          { "k": "cut", "seat": 2, "top": { "seat": 4, "cards": ["3S", "3C", "4S", "4C", "5S", "5C", "6S", "6C"], "done": false } },
          { "k": "close" },
          { "k": "cut", "seat": 3, "top": { "seat": 4, "cards": ["7S", "7C", "8S", "8C", "9S", "9C", "10S", "10C"], "done": false } },
          { "k": "close" },
          { "k": "cut", "seat": 1, "top": { "seat": 4, "cards": ["2H", "2D"], "done": false } }, { "k": "close" },
          { "k": "out", "seat": 1 }, { "k": "out", "seat": 2 }, { "k": "out", "seat": 3 }, { "k": "end" }
        ],
        "expect": {
          "lines": [
            [4, 2, 6, 6, "chat"], [4, 3, 6, 6, "chat"], [4, 1, 4, 4, "chat"], [4, 1, 2, 2, "bet"], [3, 2, 1, 1, "ba"],
            [4, 3, 5, 2, "thoi"]
          ],
          "places": { "1": 1, "2": 2, "3": 3, "4": 4 }, "out": { "1": "done", "2": "done", "3": "done" },
          "net": { "1": 6, "2": 7, "3": 7, "4": -20 }
        }
      },
      {
        "name": "example 3: tới trắng — every other player pays 2 S, no thối",
        "order": [1, 2, 3, 4], "played": [], "hands": {},
        "events": [{ "k": "trang", "seat": 3 }],
        "expect": {
          "lines": [[4, 3, 4, 4, "trang"], [1, 3, 4, 4, "trang"], [2, 3, 4, 4, "trang"]],
          "places": {}, "out": {},
          "net": { "1": -4, "2": -4, "3": 12, "4": -4 }
        }
      },
      {
        "name": "a seat that left after going out receives nothing more",
        "order": [1, 2, 3, 4], "played": [1, 2, 3, 4], "hands": { "4": ["2S"] },
        "events": [
          { "k": "out", "seat": 1 }, { "k": "leave", "seat": 1 }, { "k": "out", "seat": 2 }, { "k": "out", "seat": 3 },
          { "k": "end" }
        ],
        "expect": {
          "lines": [[3, 2, 1, 1, "ba"], [4, 3, 1, 1, "thoi"]],
          "places": { "1": 1, "2": 2, "3": 3, "4": 4 }, "out": { "1": "done", "2": "done", "3": "done" },
          "net": { "1": 0, "2": 1, "3": 0, "4": -1 }
        }
      },
      {
        "name": "two players: the loser pays 1 S and its thối",
        "order": [2, 4], "played": [2, 4], "hands": { "4": ["2D"] },
        "events": [{ "k": "out", "seat": 2 }, { "k": "end" }],
        "expect": {
          "lines": [[4, 2, 2, 2, "bet"], [4, 2, 2, 2, "thoi"]],
          "places": { "2": 1, "4": 2 }, "out": { "2": "done" },
          "net": { "2": 4, "4": -4 }
        }
      },
      {
        "name": "three players: bét pays nhất 1 S",
        "order": [1, 2, 3], "played": [1, 2, 3], "hands": { "2": ["3S"] },
        "events": [{ "k": "out", "seat": 3 }, { "k": "out", "seat": 1 }, { "k": "end" }],
        "expect": {
          "lines": [[2, 3, 2, 2, "bet"]],
          "places": { "3": 1, "1": 2, "2": 3 }, "out": { "3": "done", "1": "done" },
          "net": { "1": 0, "2": -2, "3": 2 }
        }
      }
    ]
  }
}
```

Create `tests/sql/v16-smoke.sql` with exactly:

```sql
-- tests/sql/v16-smoke.sql — run as the superuser on the throwaway PostgreSQL cluster after 0004–0017 (see the plan),
-- from the repo root: it re-runs the migration with \i, reads tests/fixtures/card-cases.json with \copy and ends with
-- tests/sql/anticheat-guards.sql. Every check is an ASSERT; the first failure stops psql (ON_ERROR_STOP). The engines run
-- through their private functions with fixed decks and times; the public RPCs are called as the client calls them.
\set ON_ERROR_STOP on

-- The v15, anti-cheat and v15.2 smokes re-run 0013, 0015 and 0016, which put back their own ledger reasons and wipe:
-- run 0017 again first.
set client_min_messages = warning;
\i supabase/migrations/0017_v16_cards.sql
reset client_min_messages;

create temp table smoke (k text primary key, v text);

-- The error text of a statement, or null when it succeeds (its effects are rolled back either way on error).
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- A card from its code (rank + S/C/D/H: "10H", "AS", "2D"), and a JSON array of codes as cards.
create function pg_temp.c(p text) returns integer language sql immutable as $$
  select (array_position(array['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'], left(p, -1)) - 1) * 4
         + position(right(p, 1) in 'SCDH') - 1
$$;
create function pg_temp.cs(p jsonb) returns integer[] language sql immutable as $$
  select coalesce(array_agg(pg_temp.c(x) order by n), '{}') from jsonb_array_elements_text(p) with ordinality e(x, n)
$$;

-- ---------- the rules against the shared fixtures (§17): Tiến lên ----------
create temp table fx_raw (n serial, line text);
\copy fx_raw (line) from 'tests/fixtures/card-cases.json' with (format csv, quote e'\x01', delimiter e'\x02')
create temp table fx as select string_agg(line, e'\n' order by n)::jsonb as j from fx_raw;

-- A settle case: _tl_money folded over its events from the start of a game (every seat dealt 13, none settled).
create function pg_temp.tl_fold(k jsonb) returns jsonb language plpgsql as $$
declare pub jsonb; ev jsonb; hands jsonb := '{}'; s text; x jsonb;
begin
  pub := jsonb_build_object('order', k->'order', 'chain', null, 'lines', '[]'::jsonb,
    'players', (select jsonb_object_agg(q, jsonb_build_object('id', null, 'n', 13, 'played', (k->'played') @> q::jsonb,
                                                              'out', null, 'place', null, 'paid', 0, 'settled', false))
                  from jsonb_array_elements_text(k->'order') q));
  for s, x in select key, value from jsonb_each(k->'hands') loop
    hands := hands || jsonb_build_object(s, to_jsonb(pg_temp.cs(x)));
  end loop;
  for ev in select value from jsonb_array_elements(k->'events') loop
    if ev->>'k' = 'cut' then
      ev := ev || jsonb_build_object('top', public._tl_combo(pg_temp.cs(ev->'top'->'cards'))
                                            || jsonb_build_object('seat', ev->'top'->'seat', 'done', ev->'top'->'done'));
    end if;
    pub := public._tl_money(pub, ev, hands);
  end loop;
  return pub;
end $$;

do $$
declare j jsonb := (select j from fx)->'tienlen'; k jsonb; got jsonb; pub jsonb; v jsonb;
begin
  for k in select x from jsonb_array_elements(j->'combo') x loop
    got := public._tl_combo(pg_temp.cs(k->'cards'));
    if k->'expect' = 'null'::jsonb then
      assert got is null, format('combo %s: %s, want none', k->'cards', got);
    else
      assert got->>'type' = k->'expect'->>'type' and (got->>'len')::int = (k->'expect'->>'len')::int
             and (got->>'key')::int = pg_temp.c(k->'expect'->>'key'), format('combo %s: %s, want %s', k->'cards', got, k->'expect');
      assert public._tl_value(got) = (k->>'value')::int, format('value %s: %s', k->'cards', public._tl_value(got));
    end if;
  end loop;
  for k in select x from jsonb_array_elements(j->'beats') x loop
    assert public._tl_beats(public._tl_combo(pg_temp.cs(k->'top')), public._tl_combo(pg_temp.cs(k->'x'))) = (k->>'expect')::boolean,
      format('beats %s over %s: want %s', k->'x', k->'top', k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'trang') x loop
    assert public._tl_trang(pg_temp.cs(k->'cards')) is not distinct from k->>'expect',
      format('trang %s: %s, want %s', k->'cards', public._tl_trang(pg_temp.cs(k->'cards')), k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'thoi') x loop
    assert public._tl_thoi(pg_temp.cs(k->'cards')) = (k->>'expect')::int,
      format('thoi %s: %s, want %s', k->'cards', public._tl_thoi(pg_temp.cs(k->'cards')), k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'settle') x loop
    pub := pg_temp.tl_fold(k);
    got := (select coalesce(jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'h', l->'paid', l->'why') order by n), '[]')
              from jsonb_array_elements(pub->'lines') with ordinality e(l, n));
    assert got = k->'expect'->'lines', format('%s: lines %s, want %s', k->>'name', got, k->'expect'->'lines');
    got := (select coalesce(jsonb_object_agg(key, value->'place'), '{}') from jsonb_each(pub->'players') where value->>'place' is not null);
    assert got = k->'expect'->'places', format('%s: places %s, want %s', k->>'name', got, k->'expect'->'places');
    got := (select coalesce(jsonb_object_agg(key, value->'out'), '{}') from jsonb_each(pub->'players') where value->>'out' is not null);
    assert got = k->'expect'->'out', format('%s: out %s, want %s', k->>'name', got, k->'expect'->'out');
    got := (select jsonb_object_agg(q, coalesce((select sum(case when l->>'to' = q then (l->>'paid')::int else -(l->>'paid')::int end)
                                                   from jsonb_array_elements(pub->'lines') l where q in (l->>'from', l->>'to')), 0))
              from jsonb_array_elements_text(k->'order') q);
    assert got = k->'expect'->'net', format('%s: net %s, want %s', k->>'name', got, k->'expect'->'net');
    v := (select to_jsonb(sum(value::int)) from jsonb_each_text(got));
    assert v = '0'::jsonb, format('%s: the net sums to %s', k->>'name', v);
  end loop;
end $$;

-- ---------- the shuffle and privacy (§6.4, §11.1) ----------
do $$
declare d integer[]; n integer; def text;
begin
  for n in 1..20 loop
    d := public._card_shuffle();
    assert (select array_agg(x order by x) from unnest(d) x) = array(select generate_series(0, 51)), 'a shuffle is a permutation';
  end loop;
  assert (select bool_and(public._card_rand(7) between 0 and 6) from generate_series(1, 300)), 'draws stay in range';
  assert (select count(distinct public._card_rand(3)) from generate_series(1, 300)) = 3, 'every value comes up';
  assert not exists (select 1 from unnest(array['card_tables', 'card_seats', 'card_hands', 'card_secrets', 'card_log']) t,
                                   unnest(array['anon', 'authenticated']) r
                      where has_table_privilege(r, 'public.' || t, 'select, insert, update, delete')), 'the card tables are private';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like '\_card\_%' or p.proname like '\_tl\_%')
                      and has_function_privilege('anon', p.oid, 'execute')), 'the helpers are private';
  def := (select pg_get_constraintdef(oid) from pg_constraint where conname = 'coin_ledger_reason_check');
  assert (select bool_and(position(quote_literal(r) in def) > 0)
            from unnest(array['wipe', 'harvester', 'produce_sell', 'card_hold', 'card_settle', 'card_buyin', 'card_cashout',
                              'card_refund', 'land_refund', 'rice_sell']) r), format('ledger reasons: %s', def);
end $$;

select 'v16 rules smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run (repo root, Git Bash): `bash "$SCRATCH/v16-sql.sh"`
Expected: `v14 smoke ok`, then `FAILED: supabase/migrations/0017_v16_cards.sql` — the migration does not exist yet.

- [ ] **Step 3: Write the migration's sections A–B**

Create `supabase/migrations/0017_v16_cards.sql` with exactly:

```sql
-- =========================================================
-- 0017_v16_cards.sql — v16 "Góc đánh bài" (docs/superpowers/specs/2026-09-25-music-together-v16-cards-design.md): three
-- card tables per room in the hall — Tiến lên miền Nam, Cào (ba cây, cào cái) and Texas Hold'em no-limit — played for
-- the players' own xu, zero-sum, with no house cut. The server shuffles with a crypto RNG, deals, keeps every hand
-- private, validates every move, runs the lazy turn timers and settles.
-- ADDITIVE (no data drop) and re-runnable. Requires 0013, 0015 and 0016: it keeps 0016's ledger reasons and re-creates
-- 0016's _ac_holdings and _ac_wipe. Every function relies on `set search_path = public, extensions`. Time and randomness are
-- injectable: the engines take p_now and every deal takes p_deck (null = shuffle); the public RPCs pass now() and null.
-- A card is an integer c in 0–51: rank r = c / 4 (0–12 = 3 4 5 6 7 8 9 10 J Q K A 2), suit s = c % 4 (0 ♠, 1 ♣, 2 ♦, 3 ♥).
-- =========================================================

-- ---------- A. Tables (§11.1): private — RLS on, no policies, no grants; only the SECURITY DEFINER functions touch them ----------
create table if not exists public.card_tables (                      -- one row per room and game, created lazily
  room_id uuid not null references public.rooms(id) on delete cascade,
  game text not null check (game in ('tienlen', 'cao', 'poker')),
  stake integer check (stake in (100, 1000, 10000)),                 -- S; null while the table is empty
  v bigint not null default 0,                                        -- bumped by every visible change
  seq integer not null default 0,                                     -- bumped by every game action (R24)
  hand_no integer not null default 0,
  phase text not null default 'idle'
    check (phase in ('idle', 'countdown', 'deal_wait', 'playing', 'peek', 'result')),
  turn integer,
  deadline timestamptz,                                               -- the turn's or the phase's (§10)
  pos integer,                                                        -- poker: the button; Cào: the last dealer
  lead_id uuid,                                                       -- Tiến lên: the last game's nhất
  first_game boolean not null default true,
  pub jsonb not null default '{}'::jsonb,                             -- the game's public state (§11.4)
  last jsonb,                                                         -- the last hand's result
  primary key (room_id, game)
);

create table if not exists public.card_seats (
  room_id uuid not null,
  game text not null,
  seat integer not null check (seat between 1 and 6),
  account_id uuid not null references public.accounts(id) on delete cascade,
  chips integer not null default 0 check (chips >= 0),                -- poker: the stack on the table
  escrow integer not null default 0 check (escrow >= 0),              -- Tiến lên, Cào: the seat's balance in the hand
  leaving boolean not null default false,                             -- left a live hand: kept until the hand ends (R2)
  missed smallint not null default 0,                                 -- consecutive timeouts
  seen_at timestamptz not null default now(),                         -- the owner's last card call (R28)
  sat_at timestamptz not null default now(),
  primary key (room_id, game, seat),
  constraint card_seats_one_per_room unique (room_id, account_id),   -- leaving rows included (R2)
  foreign key (room_id, game) references public.card_tables (room_id, game) on delete cascade
);

create table if not exists public.card_hands (                       -- every dealt hand; card_hand shows only its owner's
  room_id uuid not null,
  game text not null,
  hand_no integer not null,
  seat integer not null,
  account_id uuid not null,                                           -- no FK: the row goes at the table's next deal
  dealt integer[] not null,
  cards integer[] not null,                                           -- the cards still held
  primary key (room_id, game, hand_no, seat),
  foreign key (room_id, game) references public.card_tables (room_id, game) on delete cascade
);

create table if not exists public.card_secrets (                     -- the poker board, dealt at the start
  room_id uuid not null,
  game text not null,
  hand_no integer not null,
  board integer[] not null,
  primary key (room_id, game, hand_no),
  foreign key (room_id, game) references public.card_tables (room_id, game) on delete cascade
);

create table if not exists public.card_log (                         -- evidence for disputes, kept 14 days (R34); no FK
  id bigint generated always as identity primary key,
  room_id uuid not null,
  game text not null,
  hand_no integer,
  account_id uuid,
  seat integer,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists idx_card_log_at on public.card_log (at);

alter table public.card_tables enable row level security;
alter table public.card_seats enable row level security;
alter table public.card_hands enable row level security;
alter table public.card_secrets enable row level security;
alter table public.card_log enable row level security;
revoke all on public.card_tables, public.card_seats, public.card_hands, public.card_secrets, public.card_log
  from anon, authenticated;

-- The reasons in force after 0015 and 0016, plus the five card moves (R33).
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund'));

-- ---------- B. Pure helpers (§6.4, §7): cards and Tiến lên; lib/game/cards/*.ts mirrors them (tests/fixtures/card-cases.json) ----------
-- Seats per table: Tiến lên 4, Cào 6, poker 6.
create or replace function public._card_max(p_game text) returns integer
language sql immutable set search_path = public, extensions
as $$ select case p_game when 'tienlen' then 4 when 'cao' then 6 when 'poker' then 6 end $$;

-- An integer array from a JSON array (in its order); anything else is empty.
create or replace function public._card_ints(p jsonb) returns integer[]
language sql immutable set search_path = public, extensions
as $$
  select coalesce(array_agg(x::int order by n), '{}')
    from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) with ordinality e(x, n)
$$;

-- The seats of p_order after p_seat in turn order (ascending, wrapping round), p_seat itself left out.
create or replace function public._card_after(p_order integer[], p_seat integer) returns integer[]
language sql immutable set search_path = public, extensions
as $$ select coalesce(array_agg(s order by s <= p_seat, s), '{}') from unnest(p_order) s where s <> p_seat $$;

-- A uniform integer in 0 … p_n − 1 from 4 random bytes, without modulo bias (values ≥ 2³² − 2³² mod n are drawn again).
create or replace function public._card_rand(p_n integer) returns integer
language plpgsql volatile set search_path = public, extensions
as $$
declare b bytea; v bigint; lim bigint := 4294967296 - (4294967296 % p_n);
begin
  loop
    b := extensions.gen_random_bytes(4);
    v := get_byte(b, 0)::bigint * 16777216 + get_byte(b, 1) * 65536 + get_byte(b, 2) * 256 + get_byte(b, 3);
    exit when v < lim;
  end loop;
  return (v % p_n)::int;
end $$;

-- A shuffled deck (Fisher–Yates); no seed is kept.
create or replace function public._card_shuffle() returns integer[]
language plpgsql volatile set search_path = public, extensions
as $$
declare d integer[] := array(select generate_series(0, 51)); i integer; j integer; t integer;
begin
  for i in reverse 52..2 loop
    j := 1 + public._card_rand(i);
    t := d[i]; d[i] := d[j]; d[j] := t;
  end loop;
  return d;
end $$;

-- A Tiến lên combination (§7.1): {type, len, key, cards} or null. key = the highest card; len = cards for a sảnh, pairs
-- for đôi thông, else the card count; cards sorted.
create or replace function public._tl_combo(p_cards integer[]) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare c integer[] := array(select x from unnest(p_cards) x order by x); n integer := coalesce(cardinality(p_cards), 0);
        r integer[]; t text; ln integer;
begin
  if n = 0 or exists (select 1 from unnest(c) x where x is null or x not between 0 and 51)
     or (select count(distinct x) from unnest(c) x) <> n then
    return null;
  end if;
  r := array(select x / 4 from unnest(c) with ordinality u(x, k) order by k);
  if r[1] = r[n] and n <= 4 then
    t := case n when 1 then 'single' when 2 then 'pair' when 3 then 'triple' else 'quad' end;
    ln := n;
  elsif n >= 3 and r[n] < 12 and (select bool_and(r[k] = r[1] + k - 1) from generate_series(1, n) k) then
    t := 'straight';
    ln := n;
  elsif n >= 6 and n % 2 = 0 and r[n] < 12
        and (select bool_and(r[2 * k - 1] = r[1] + k - 1 and r[2 * k] = r[1] + k - 1) from generate_series(1, n / 2) k) then
    t := 'pairs';
    ln := n / 2;
  end if;
  if t is null then
    return null;
  end if;
  return jsonb_build_object('type', t, 'len', ln, 'key', c[n], 'cards', to_jsonb(c));
end $$;

-- Does x beat top (§7.2)? The same type (and length for sảnh and đôi thông) with a higher key, or a bomb: 3 đôi thông over
-- a single 2; tứ quý over a single 2, a pair of 2s or any 3 đôi thông; 4 đôi thông over those and any tứ quý.
create or replace function public._tl_beats(p_top jsonb, p_x jsonb) returns boolean
language sql immutable set search_path = public, extensions
as $$
  select coalesce(
    (p_x->>'type' = p_top->>'type' and (p_x->>'type' not in ('straight', 'pairs') or p_x->'len' = p_top->'len')
     and (p_x->>'key')::int > (p_top->>'key')::int)
    or (p_top->>'type' = 'single' and (p_top->>'key')::int / 4 = 12
        and (p_x->>'type' = 'quad' or (p_x->>'type' = 'pairs' and (p_x->>'len')::int in (3, 4))))
    or (p_top->>'type' = 'pair' and (p_top->>'key')::int / 4 = 12
        and (p_x->>'type' = 'quad' or (p_x->>'type' = 'pairs' and (p_x->>'len')::int = 4)))
    or (p_top->>'type' = 'pairs' and (p_top->>'len')::int = 3
        and (p_x->>'type' = 'quad' or (p_x->>'type' = 'pairs' and (p_x->>'len')::int = 4)))
    or (p_top->>'type' = 'quad' and p_x->>'type' = 'pairs' and (p_x->>'len')::int = 4),
    false)
$$;

-- What cutting a combination is worth, in half-stakes (§7.2): 2♠/2♣ 1, 2♦/2♥ 2, a pair of 2s the sum, 3 đôi thông 3,
-- tứ quý 4, 4 đôi thông 6; anything else 0.
create or replace function public._tl_value(p_combo jsonb) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case
    when p_combo->>'type' in ('single', 'pair') and (p_combo->>'key')::int / 4 = 12 then
      (select coalesce(sum(case when x::int % 4 >= 2 then 2 else 1 end), 0)::int
         from jsonb_array_elements_text(p_combo->'cards') x)
    when p_combo->>'type' = 'pairs' and (p_combo->>'len')::int = 3 then 3
    when p_combo->>'type' = 'quad' then 4
    when p_combo->>'type' = 'pairs' and (p_combo->>'len')::int >= 4 then 6
    else 0 end
$$;

-- Thối (§7.4, R12) in half-stakes: each 2 (black 1, red 2), each tứ quý below 2 (4), then over the other ranks below 2
-- each maximal run of ≥ 3 consecutive ranks holding ≥ 2 cards (3 ranks 3, 4 or more 6).
create or replace function public._tl_thoi(p_cards integer[]) returns integer
language plpgsql immutable set search_path = public, extensions
as $$
declare n integer[] := array_fill(0, array[13]); x integer; h integer := 0; run integer := 0; r integer;
begin
  foreach x in array coalesce(p_cards, '{}') loop
    n[x / 4 + 1] := n[x / 4 + 1] + 1;
    if x / 4 = 12 then
      h := h + case when x % 4 >= 2 then 2 else 1 end;
    end if;
  end loop;
  for r in 1..12 loop
    if n[r] = 4 then
      h := h + 4;
      n[r] := 0;
    end if;
  end loop;
  for r in 1..13 loop
    if r <= 12 and n[r] >= 2 then
      run := run + 1;
    else
      h := h + case when run = 3 then 3 when run >= 4 then 6 else 0 end;
      run := 0;
    end if;
  end loop;
  return h;
end $$;

-- Tới trắng (§7.4, R10): the best pattern of a dealt hand, or null — sảnh rồng (3 → A), 5 đôi thông (no 2),
-- tứ quý heo, 6 đôi (a tứ quý counts as 2 pairs).
create or replace function public._tl_trang(p_cards integer[]) returns text
language plpgsql immutable set search_path = public, extensions
as $$
declare n integer[] := array_fill(0, array[13]); x integer; r integer;
begin
  foreach x in array coalesce(p_cards, '{}') loop
    n[x / 4 + 1] := n[x / 4 + 1] + 1;
  end loop;
  if (select bool_and(n[k] >= 1) from generate_series(1, 12) k) then
    return 'sanh_rong';
  end if;
  for r in 1..8 loop
    if n[r] >= 2 and n[r + 1] >= 2 and n[r + 2] >= 2 and n[r + 3] >= 2 and n[r + 4] >= 2 then
      return 'nam_doi_thong';
    end if;
  end loop;
  if n[13] = 4 then
    return 'tu_quy_heo';
  end if;
  if (select sum(n[k] / 2) from generate_series(1, 13) k) >= 6 then
    return 'sau_doi';
  end if;
  return null;
end $$;

-- The strength of a tới trắng pattern: the highest wins (R10).
create or replace function public._tl_trang_rank(p_pattern text) returns integer
language sql immutable set search_path = public, extensions
as $$
  select case p_pattern when 'sanh_rong' then 4 when 'nam_doi_thong' then 3 when 'tu_quy_heo' then 2 when 'sau_doi' then 1
         else 0 end
$$;

-- One line of a Tiến lên game in half-stakes (§6.2, §7.5, R14): from → to, at most what is left of the payer's 10 S
-- (20 h). A line from or to a settled seat, or to a seat of p_gone (seats leaving together), is dropped; so is a line
-- that pays 0. The line lands in pub.lines as {from, to, h, paid, why}; the payer's players.paid grows by what it paid.
create or replace function public._tl_pay(p_pub jsonb, p_from integer, p_to integer, p_h integer, p_why text,
                                          p_gone integer[] default '{}') returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare f text := p_from::text; x integer;
begin
  if p_h is null or p_h <= 0 or p_from is null or p_to is null or p_from = p_to or p_to = any(p_gone)
     or coalesce((p_pub->'players'->f->>'settled')::boolean, true)
     or coalesce((p_pub->'players'->(p_to::text)->>'settled')::boolean, true) then
    return p_pub;
  end if;
  x := least(p_h, 20 - coalesce((p_pub->'players'->f->>'paid')::int, 0));
  if x <= 0 then
    return p_pub;
  end if;
  return jsonb_set(
    jsonb_set(p_pub, array['players', f, 'paid'], to_jsonb(coalesce((p_pub->'players'->f->>'paid')::int, 0) + x)),
    '{lines}', coalesce(p_pub->'lines', '[]'::jsonb)
               || jsonb_build_array(jsonb_build_object('from', p_from, 'to', p_to, 'h', p_h, 'paid', x, 'why', p_why)));
end $$;

-- The money of a Tiến lên game (§7.3–§7.5), one event at a time: the next pub. p_hands holds the cards each seat holds
-- now ({seat: [c…]}), for thối. Events:
--   {k: "cut", seat, top}      seat cuts top ({seat, cards, done}): the chain grows by the value of top
--   {k: "close"}               the round closes: the chain's victim pays its cutter, unless the chain is void
--   {k: "out", seat}           seat goes out; at the first go-out every active player who has played nothing is cóng and
--                              pays nhất 2 S + thối at once (R11)
--   {k: "forfeit", seats}      those seats leave together (R13): an open chain as victim is paid, as cutter dropped; 1 S to
--                              each other active player in turn order; thối to the next of them
--   {k: "leave", seat}         a seat already out leaves: lines to or from it are dropped from now on
--   {k: "trang", seat}         tới trắng: every other player pays 2 S (R10)
--   {k: "end"}                 a pending chain, the places (cóng at the bottom in reverse turn order from nhất), the place
--                              payments (skipped for a cóng payer) and the thối of the last holder to the player just above
create or replace function public._tl_money(p_pub jsonb, p_ev jsonb, p_hands jsonb) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare pub jsonb := p_pub; ord integer[] := public._card_ints(p_pub->'order'); k text := p_ev->>'k'; ch jsonb;
        s integer; p integer; f integer[]; r integer[]; placed integer; holder integer; nhat integer; pl integer[];
        m integer;
begin
  ch := pub->'chain';
  if k = 'cut' then
    pub := jsonb_set(pub, '{chain}', jsonb_build_object(
      'h', coalesce((ch->>'h')::int, 0) + public._tl_value(p_ev->'top'),
      'victim', (p_ev->'top'->>'seat')::int, 'cutter', (p_ev->>'seat')::int,
      'void', coalesce((p_ev->'top'->>'done')::boolean, false)));
  elsif k = 'close' then
    if jsonb_typeof(ch) = 'object' and not coalesce((ch->>'void')::boolean, false) then
      pub := public._tl_pay(pub, (ch->>'victim')::int, (ch->>'cutter')::int, (ch->>'h')::int, 'chat');
    end if;
    pub := jsonb_set(pub, '{chain}', 'null');
  elsif k = 'out' then
    s := (p_ev->>'seat')::int;
    placed := (select count(*) from jsonb_each(pub->'players') e where e.value->>'place' is not null);
    pub := jsonb_set(jsonb_set(pub, array['players', s::text, 'out'], '"done"'),
                     array['players', s::text, 'place'], to_jsonb(placed + 1));
    if placed = 0 then
      foreach p in array public._card_after(ord, s) loop
        if pub->'players'->(p::text)->>'out' is null
           and not coalesce((pub->'players'->(p::text)->>'played')::boolean, false) then
          pub := jsonb_set(pub, array['players', p::text, 'out'], '"cong"');
          pub := public._tl_pay(pub, p, s, 4 + public._tl_thoi(public._card_ints(p_hands->(p::text))), 'cong');
        end if;
      end loop;
    end if;
  elsif k = 'forfeit' then
    f := array(select x from unnest(public._card_ints(p_ev->'seats')) x order by x);
    foreach s in array f loop
      pub := jsonb_set(pub, array['players', s::text, 'out'], '"forfeit"');
    end loop;
    foreach s in array f loop
      ch := pub->'chain';
      if jsonb_typeof(ch) = 'object' and (ch->>'victim')::int = s then
        if not coalesce((ch->>'void')::boolean, false) then
          pub := public._tl_pay(pub, s, (ch->>'cutter')::int, (ch->>'h')::int, 'chat', f);
        end if;
        pub := jsonb_set(pub, '{chain}', 'null');
      elsif jsonb_typeof(ch) = 'object' and (ch->>'cutter')::int = s then
        pub := jsonb_set(pub, '{chain}', 'null');
      end if;
      r := array(select q from unnest(public._card_after(ord, s)) with ordinality u(q, n)
                  where pub->'players'->(q::text)->>'out' is null order by n);
      foreach p in array r loop
        pub := public._tl_pay(pub, s, p, 2, 'forfeit', f);
      end loop;
      if cardinality(r) > 0 then
        pub := public._tl_pay(pub, s, r[1], public._tl_thoi(public._card_ints(p_hands->(s::text))), 'thoi', f);
      end if;
    end loop;
    foreach s in array f loop
      pub := jsonb_set(pub, array['players', s::text, 'settled'], 'true');
    end loop;
  elsif k = 'leave' then
    pub := jsonb_set(pub, array['players', p_ev->>'seat', 'settled'], 'true');
  elsif k = 'trang' then
    s := (p_ev->>'seat')::int;
    foreach p in array public._card_after(ord, s) loop
      pub := public._tl_pay(pub, p, s, 4, 'trang');
    end loop;
  elsif k = 'end' then
    if jsonb_typeof(ch) = 'object' and not coalesce((ch->>'void')::boolean, false) then
      pub := public._tl_pay(pub, (ch->>'victim')::int, (ch->>'cutter')::int, (ch->>'h')::int, 'chat');
    end if;
    pub := jsonb_set(pub, '{chain}', 'null');
    placed := (select count(*) from jsonb_each(pub->'players') e where e.value->>'place' is not null);
    holder := (select min(q) from unnest(ord) q where pub->'players'->(q::text)->>'out' is null);
    if holder is not null then
      placed := placed + 1;
      pub := jsonb_set(pub, array['players', holder::text, 'place'], to_jsonb(placed));
    end if;
    nhat := (select q from unnest(ord) q where (pub->'players'->(q::text)->>'place')::int = 1);
    foreach p in array coalesce(array(select q from unnest(public._card_after(ord, nhat)) with ordinality u(q, n)
                                       where pub->'players'->(q::text)->>'out' = 'cong' order by n), '{}') loop
      placed := placed + 1;
      pub := jsonb_set(pub, array['players', p::text, 'place'], to_jsonb(placed));
    end loop;
    pl := array(select q from unnest(ord) q where pub->'players'->(q::text)->>'place' is not null
                 order by (pub->'players'->(q::text)->>'place')::int);
    m := cardinality(pl);
    if m = 4 then
      if pub->'players'->(pl[4]::text)->>'out' is distinct from 'cong' then
        pub := public._tl_pay(pub, pl[4], pl[1], 2, 'bet');
      end if;
      if pub->'players'->(pl[3]::text)->>'out' is distinct from 'cong' then
        pub := public._tl_pay(pub, pl[3], pl[2], 1, 'ba');
      end if;
    elsif m >= 2 and pub->'players'->(pl[m]::text)->>'out' is distinct from 'cong' then
      pub := public._tl_pay(pub, pl[m], pl[1], 2, 'bet');
    end if;
    if holder is not null and (pub->'players'->(holder::text)->>'place')::int > 1 then
      pub := public._tl_pay(pub, holder, pl[(pub->'players'->(holder::text)->>'place')::int - 1],
                            public._tl_thoi(public._card_ints(p_hands->(holder::text))), 'thoi');
    end if;
  end if;
  return pub;
end $$;

revoke all on function public._card_max(text) from public, anon, authenticated;
revoke all on function public._card_ints(jsonb) from public, anon, authenticated;
revoke all on function public._card_after(integer[], integer) from public, anon, authenticated;
revoke all on function public._card_rand(integer) from public, anon, authenticated;
revoke all on function public._card_shuffle() from public, anon, authenticated;
revoke all on function public._tl_combo(integer[]) from public, anon, authenticated;
revoke all on function public._tl_beats(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._tl_value(jsonb) from public, anon, authenticated;
revoke all on function public._tl_thoi(integer[]) from public, anon, authenticated;
revoke all on function public._tl_trang(integer[]) from public, anon, authenticated;
revoke all on function public._tl_trang_rank(text) from public, anon, authenticated;
revoke all on function public._tl_pay(jsonb, integer, integer, integer, text, integer[]) from public, anon, authenticated;
revoke all on function public._tl_money(jsonb, jsonb, jsonb) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected:

```text
v14 smoke ok
0017 twice ok
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
anticheat guards ok
ALL OK
```

Any failed `ASSERT` stops psql; the script prints `FAILED:` with the assertion's message.

- [ ] **Step 5: Commit**

Commit message:

```text
feat(cards): 0017 tables and the Tiến lên rules as pure functions; the shared card fixtures

Section A of 0017_v16_cards.sql: the private tables card_tables, card_seats, card_hands, card_secrets and card_log (RLS
on, no grants), and the coin_ledger reason check re-created with 0016's list plus card_hold, card_settle, card_buyin,
card_cashout and card_refund. Section B: the card helpers (_card_max, _card_after, the unbiased _card_rand and the
Fisher–Yates _card_shuffle over gen_random_bytes) and Tiến lên as immutable functions: _tl_combo, _tl_beats, _tl_value,
_tl_thoi, _tl_trang, and the money of a game, _tl_money over its events (cut, close, out, forfeit, leave, trắng, end), in
half-stakes within the 10 S cap. tests/fixtures/card-cases.json pins them for the TypeScript mirrors; smoke part 1
replays every case and checks the shuffle and the privacy of the tables.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0017_v16_cards.sql tests/fixtures/card-cases.json tests/sql/v16-smoke.sql
git commit -F <message file>
```

---

### Task 2: Database — the Cào and poker rules as pure functions (`0017` section B, second part)

**Files:**
- Modify: `supabase/migrations/0017_v16_cards.sql` (append section B's Cào and poker helpers)
- Modify: `tests/fixtures/card-cases.json` (the `cao` and `poker` cases)
- Modify: `tests/sql/v16-smoke.sql` (append part 2)

**Interfaces:**
- Consumes: Task 1's `_card_ints`, `_card_after` and the smoke's `pg_temp.c`, `pg_temp.cs` and fixture table.
- Produces (private, `immutable`):
  - `_cao_key(card) → int` (Cào rank × 4 + suit, A low, ♠ 0 < ♣ 1 < ♥ 2 < ♦ 3), `_cao_eval(int[3]) → jsonb {kind: "sap"|"ba_tay"|"nut", points, rank, top}`, `_cao_cmp(a, b) → int` (1, −1; never 0 for two real hands), `_cao_settle({dealer, order, left, hands}) → jsonb {lines: [{from, to, why}], net: {seat: units}}` (units of S);
  - `_pk_rank(card) → int` (2–14), `_pk_straight(int[]) → int`, `_pk_eval(int[5..7]) → int[]` (category 0–8, then the ranks that break ties; arrays compare as keys), `_pk_pots({players: {seat: {put, fold, allin}}, keys: {seat: key}, button}) → jsonb` (`[{xu, seats, winners, shares}]`, main pot first; folded chips above the highest live total join the top pot; odd xu one at a time to the winners from the left of the button; `winners` and `shares` only when `keys` or a single eligible seat decide them).
- Produces (smoke): part 2 replays `cao.eval`, `cao.cmp`, `cao.settle`, `poker.eval`, `poker.cmp` and `poker.pots` and prints `v16 cao and poker rules smoke ok`.

- [ ] **Step 1: Write the cases and smoke part 2**

**tests/fixtures/card-cases.json.** Replace:

```json
    ]
  }
```

with:

```json
    ]
  },
  "cao": {
    "eval": [
      { "cards": ["9S", "8C", "2H"], "expect": { "kind": "nut", "points": 9, "top": "9S" } },
      { "cards": ["JS", "QH", "KC"], "expect": { "kind": "ba_tay", "points": 0, "top": "KC" } },
      { "cards": ["4D", "4C", "4S"], "expect": { "kind": "sap", "points": 2, "rank": 4, "top": "4D" } },
      { "cards": ["7H", "10C", "AD"], "expect": { "kind": "nut", "points": 8, "top": "10C" } },
      { "cards": ["KD", "5S", "3C"], "expect": { "kind": "nut", "points": 8, "top": "KD" } },
      { "cards": ["10S", "JD", "QC"], "expect": { "kind": "nut", "points": 0, "top": "QC" } },
      { "cards": ["KS", "KH", "KD"], "expect": { "kind": "sap", "points": 0, "rank": 13, "top": "KD" } },
      { "cards": ["AS", "AC", "AD"], "expect": { "kind": "sap", "points": 3, "rank": 1, "top": "AD" } },
      { "cards": ["2S", "2H", "2D"], "expect": { "kind": "sap", "points": 6, "rank": 2, "top": "2D" } },
      { "cards": ["JS", "JD", "QH"], "expect": { "kind": "ba_tay", "points": 0, "top": "QH" } },
      { "cards": ["7S", "8D", "9C"], "expect": { "kind": "nut", "points": 4, "top": "9C" } },
      { "cards": ["2S", "3S", "4S"], "expect": { "kind": "nut", "points": 9, "top": "4S" } },
      { "cards": ["5S", "5D", "10H"], "expect": { "kind": "nut", "points": 0, "top": "10H" } },
      { "cards": ["AH", "9D", "KS"], "expect": { "kind": "nut", "points": 0, "top": "KS" } }
    ],
    "cmp": [
      { "a": ["2S", "2H", "2D"], "b": ["JS", "QH", "KC"], "expect": 1 },
      { "a": ["JS", "QH", "KC"], "b": ["9S", "8C", "2H"], "expect": 1 },
      { "a": ["KS", "KH", "KD"], "b": ["AS", "AC", "AD"], "expect": 1 },
      { "a": ["2S", "2H", "2D"], "b": ["AS", "AC", "AD"], "expect": 1 },
      { "a": ["AS", "AC", "AD"], "b": ["3S", "3C", "3D"], "expect": -1 },
      { "a": ["9S", "8C", "2H"], "b": ["KD", "5S", "3C"], "expect": 1 },
      { "a": ["KD", "5S", "3C"], "b": ["7H", "10C", "AD"], "expect": 1 },
      { "a": ["KD", "4S", "3C"], "b": ["KH", "4C", "3S"], "expect": 1 },
      { "a": ["KH", "6S", "AC"], "b": ["KC", "5S", "2D"], "expect": 1 },
      { "a": ["KC", "5S", "2D"], "b": ["KS", "6C", "AD"], "expect": 1 },
      { "a": ["JS", "QH", "QD"], "b": ["JC", "QS", "KH"], "expect": -1 },
      { "a": ["10S", "JD", "QC"], "b": ["AS", "2D", "8H"], "expect": -1 },
      { "a": ["AS", "2D", "2H"], "b": ["3S", "2C", "KH"], "expect": -1 }
    ],
    "settle": [
      {
        "name": "§8.3: three players beat dealer B, one loses",
        "dealer": 2, "order": [1, 2, 3, 4, 5], "left": [],
        "hands": { "1": ["9S", "8C", "2H"], "2": ["KD", "5S", "3C"], "3": ["JS", "QH", "KC"], "4": ["4D", "4C", "4S"], "5": ["7H", "10C", "AD"] },
        "expect": { "lines": [[2, 1, "cao"], [2, 3, "cao"], [2, 4, "cao"], [5, 2, "cao"]], "net": { "1": 1, "2": -2, "3": 1, "4": 1, "5": -1 } }
      },
      {
        "name": "a player who left lost 1 S to the dealer",
        "dealer": 1, "order": [1, 2, 3], "left": [3],
        "hands": { "1": ["QS", "QC", "2D"], "2": ["5H", "4H", "KS"], "3": ["9S", "9C", "9D"] },
        "expect": { "lines": [[1, 2, "cao"], [3, 1, "left"]], "net": { "1": 0, "2": 1, "3": -1 } }
      },
      {
        "name": "the dealer beats everyone",
        "dealer": 3, "order": [2, 3, 6], "left": [],
        "hands": { "2": ["AS", "AC", "3D"], "3": ["9D", "KC", "QS"], "6": ["JS", "JD", "10H"] },
        "expect": { "lines": [[2, 3, "cao"], [6, 3, "cao"]], "net": { "2": -1, "3": 2, "6": -1 } }
      }
    ]
  },
  "poker": {
    "eval": [
      { "cards": ["AH", "KH", "QH", "JH", "10H", "2C", "3D"], "expect": [8, 14] },
      { "cards": ["9H", "10H", "JH", "QH", "KH", "2S", "2D"], "expect": [8, 13] },
      { "cards": ["AS", "2S", "3S", "4S", "5S", "KH", "QD"], "expect": [8, 5] },
      { "cards": ["5H", "6H", "7H", "8H", "9H", "9S", "9D"], "expect": [8, 9] },
      { "cards": ["9S", "9C", "9D", "9H", "KS", "2C", "3D"], "expect": [7, 9, 13] },
      { "cards": ["9S", "9C", "9D", "9H", "AS"], "expect": [7, 9, 14] },
      { "cards": ["KS", "KC", "KD", "4S", "4H", "2C", "3D"], "expect": [6, 13, 4] },
      { "cards": ["KS", "KC", "KD", "4S", "4H", "4D", "2C"], "expect": [6, 13, 4] },
      { "cards": ["AH", "AD", "AC", "KS", "KD", "KC", "2S"], "expect": [6, 14, 13] },
      { "cards": ["7S", "7C", "7D", "QS", "QH", "5C", "5D"], "expect": [6, 7, 12] },
      { "cards": ["QH", "QC", "5S", "5D", "5H"], "expect": [6, 5, 12] },
      { "cards": ["AH", "JH", "9H", "6H", "3H", "2H", "KS"], "expect": [5, 14, 11, 9, 6, 3] },
      { "cards": ["AH", "KH", "9H", "7H", "5H", "3H", "2C"], "expect": [5, 14, 13, 9, 7, 5] },
      { "cards": ["4H", "5H", "6H", "7C", "8D", "9H", "2H"], "expect": [5, 9, 6, 5, 4, 2] },
      { "cards": ["5S", "6D", "7C", "8H", "9S", "KD", "2C"], "expect": [4, 9] },
      { "cards": ["AS", "2D", "3C", "4H", "5S", "KD", "QC"], "expect": [4, 5] },
      { "cards": ["10S", "JD", "QC", "KH", "AS", "2C", "3D"], "expect": [4, 14] },
      { "cards": ["4S", "5D", "6C", "7H", "8S", "9D", "KC"], "expect": [4, 9] },
      { "cards": ["2C", "3D", "10S", "JD", "QC", "KH", "AS"], "expect": [4, 14] },
      { "cards": ["QS", "QC", "QD", "7H", "5S", "3D", "2C"], "expect": [3, 12, 7, 5] },
      { "cards": ["JS", "JC", "4D", "4H", "AS", "3C", "2D"], "expect": [2, 11, 4, 14] },
      { "cards": ["KS", "KD", "9C", "9H", "5S", "5D", "2C"], "expect": [2, 13, 9, 5] },
      { "cards": ["10S", "10C", "AH", "KD", "7S", "4C", "2D"], "expect": [1, 10, 14, 13, 7] },
      { "cards": ["AH", "QD", "9C", "7S", "5H", "3D", "2C"], "expect": [0, 14, 12, 9, 7, 5] },
      { "cards": ["AS", "AH"], "expect": [1, 14] },
      { "cards": ["KS", "7D"], "expect": [0, 13, 7] }
    ],
    "cmp": [
      { "a": ["AS", "AC", "KD", "9H", "7C", "4S", "2D"], "b": ["AD", "AH", "QD", "9S", "7D", "4C", "2H"], "expect": 1 },
      { "a": ["10S", "JD", "QC", "KH", "AS", "2C", "3D"], "b": ["10H", "JC", "QD", "KS", "AH", "4C", "5D"], "expect": 0 },
      { "a": ["KS", "KD", "9C", "9H", "AS", "3D", "2C"], "b": ["KC", "KH", "9S", "9D", "QS", "3C", "2D"], "expect": 1 },
      { "a": ["AS", "2D", "3C", "4H", "5S"], "b": ["2S", "3D", "4C", "5H", "6S"], "expect": -1 },
      { "a": ["7S", "7C", "7D", "QS", "QH"], "b": ["5S", "5C", "5D", "AS", "AH"], "expect": 1 },
      { "a": ["AH", "QD", "9C", "7S", "5H", "3D", "2C"], "b": ["AS", "QC", "9D", "7H", "4H", "3C", "2D"], "expect": 1 },
      { "a": ["AH", "JH", "9H", "6H", "3H"], "b": ["5S", "6D", "7C", "8H", "9S"], "expect": 1 }
    ],
    "pots": [
      {
        "name": "§9.3: a side pot — B wins the main pot, A beats C for the side pot",
        "players": { "1": { "put": 18000 }, "2": { "put": 8000, "allin": true }, "3": { "put": 18000 } },
        "keys": { "1": [3, 5, 14, 13], "2": [5, 14, 11, 9, 6, 3], "3": [1, 12, 14, 13, 7] }, "button": 1,
        "expect": [
          { "xu": 24000, "seats": [1, 2, 3], "winners": [2], "shares": { "2": 24000 } },
          { "xu": 20000, "seats": [1, 3], "winners": [1], "shares": { "1": 20000 } }
        ]
      },
      {
        "name": "uncontested: the last live seat takes every chip",
        "players": { "1": { "put": 3000 }, "2": { "put": 1000, "fold": true }, "3": { "put": 500, "fold": true } }, "button": 3,
        "expect": [{ "xu": 4500, "seats": [1], "winners": [1], "shares": { "1": 4500 } }]
      },
      {
        "name": "§9.3: the odd chip goes to the winner first left of the button",
        "players": { "2": { "put": 1500 }, "3": { "put": 1500 }, "4": { "put": 1, "fold": true } },
        "keys": { "2": [1, 13, 9, 7, 4], "3": [1, 13, 9, 7, 4] }, "button": 3,
        "expect": [{ "xu": 3001, "seats": [2, 3], "winners": [2, 3], "shares": { "2": 1501, "3": 1500 } }]
      },
      {
        "name": "a three-way split: two odd xu, from the left of the button",
        "players": { "1": { "put": 333 }, "2": { "put": 333 }, "3": { "put": 333 }, "4": { "put": 2, "fold": true } },
        "keys": { "1": [4, 9], "2": [4, 9], "3": [4, 9] }, "button": 2,
        "expect": [{ "xu": 1001, "seats": [1, 2, 3], "winners": [1, 2, 3], "shares": { "1": 334, "2": 333, "3": 334 } }]
      },
      {
        "name": "multi-way side pots: each all-in wins only what it covered",
        "players": { "1": { "put": 1000, "allin": true }, "2": { "put": 3000, "allin": true }, "3": { "put": 5000 }, "4": { "put": 5000 } },
        "keys": { "1": [6, 14, 13], "2": [5, 14, 13, 9, 7, 5], "3": [2, 13, 9, 5], "4": [1, 14, 13, 12, 11] }, "button": 4,
        "expect": [
          { "xu": 4000, "seats": [1, 2, 3, 4], "winners": [1], "shares": { "1": 4000 } },
          { "xu": 6000, "seats": [2, 3, 4], "winners": [2], "shares": { "2": 6000 } },
          { "xu": 4000, "seats": [3, 4], "winners": [3], "shares": { "3": 4000 } }
        ]
      },
      {
        "name": "a short all-in wins the main pot; the other two split the side pot",
        "players": { "1": { "put": 500, "allin": true }, "2": { "put": 2000 }, "3": { "put": 2000 } },
        "keys": { "1": [8, 10], "2": [1, 5, 14, 13, 12], "3": [1, 5, 14, 13, 12] }, "button": 3,
        "expect": [
          { "xu": 1500, "seats": [1, 2, 3], "winners": [1], "shares": { "1": 1500 } },
          { "xu": 3000, "seats": [2, 3], "winners": [2, 3], "shares": { "2": 1500, "3": 1500 } }
        ]
      },
      {
        "name": "chips a folded player put above the highest live total land in the top pot",
        "players": { "1": { "put": 5000, "fold": true }, "2": { "put": 2000 }, "3": { "put": 2000 } },
        "keys": { "2": [3, 9, 14, 13], "3": [2, 9, 4, 14] }, "button": 1,
        "expect": [{ "xu": 9000, "seats": [2, 3], "winners": [2], "shares": { "2": 9000 } }]
      },
      {
        "name": "without keys the pots have no winners yet",
        "players": { "1": { "put": 1000 }, "2": { "put": 1000 } }, "button": 1,
        "expect": [{ "xu": 2000, "seats": [1, 2] }]
      }
    ]
  }
```

**tests/sql/v16-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- the rules against the shared fixtures (§17): Cào and poker ----------
do $$
declare j jsonb := (select j from fx); k jsonb; got jsonb; want jsonb; ek integer[]; c integer;
begin
  for k in select x from jsonb_array_elements(j->'cao'->'eval') x loop
    got := public._cao_eval(pg_temp.cs(k->'cards'));
    want := k->'expect';
    assert got->>'kind' = want->>'kind' and (got->>'points')::int = (want->>'points')::int
           and (got->>'rank')::int is not distinct from (want->>'rank')::int
           and (got->>'top')::int = public._cao_key(pg_temp.c(want->>'top')), format('cao %s: %s, want %s', k->'cards', got, want);
  end loop;
  for k in select x from jsonb_array_elements(j->'cao'->'cmp') x loop
    c := public._cao_cmp(public._cao_eval(pg_temp.cs(k->'a')), public._cao_eval(pg_temp.cs(k->'b')));
    assert c = (k->>'expect')::int and -c = public._cao_cmp(public._cao_eval(pg_temp.cs(k->'b')), public._cao_eval(pg_temp.cs(k->'a'))),
      format('cao %s vs %s: %s, want %s', k->'a', k->'b', c, k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'cao'->'settle') x loop
    got := public._cao_settle(jsonb_build_object('dealer', k->'dealer', 'order', k->'order', 'left', k->'left',
             'hands', (select jsonb_object_agg(key, to_jsonb(pg_temp.cs(value))) from jsonb_each(k->'hands'))));
    assert (select jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'why') order by n)
              from jsonb_array_elements(got->'lines') with ordinality e(l, n)) = k->'expect'->'lines'
           and got->'net' = k->'expect'->'net', format('%s: %s', k->>'name', got);
  end loop;
  for k in select x from jsonb_array_elements(j->'poker'->'eval') x loop
    ek := public._pk_eval(pg_temp.cs(k->'cards'));
    assert to_jsonb(ek) = k->'expect', format('poker %s: %s, want %s', k->'cards', ek, k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'poker'->'cmp') x loop
    ek := public._pk_eval(pg_temp.cs(k->'a'));
    c := case when ek > public._pk_eval(pg_temp.cs(k->'b')) then 1 when ek < public._pk_eval(pg_temp.cs(k->'b')) then -1 else 0 end;
    assert c = (k->>'expect')::int, format('poker %s vs %s: %s, want %s', k->'a', k->'b', c, k->'expect');
  end loop;
  for k in select x from jsonb_array_elements(j->'poker'->'pots') x loop
    got := public._pk_pots(jsonb_build_object('players', k->'players', 'keys', k->'keys', 'button', k->'button'));
    assert got = k->'expect', format('%s: %s, want %s', k->>'name', got, k->'expect');
  end loop;
end $$;

select 'v16 cao and poker rules smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected: `FAILED: tests/sql/v16-smoke.sql` after `v16 rules smoke ok`, with `function public._cao_eval(integer[]) does not exist` in the log.

- [ ] **Step 3: Write section B's Cào and poker helpers**

**supabase/migrations/0017_v16_cards.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- B (cont.). Pure helpers: Cào and poker (§8.1, §8.3, §9.1, §9.2) ----------
-- A card's Cào key (§8.1): cao_rank × 4 + cao_suit, with A = 1, 2–10 their number, J 11, Q 12, K 13 and ♠ 0, ♣ 1, ♥ 2, ♦ 3.
create or replace function public._cao_key(p_card integer) returns integer
language sql immutable set search_path = public, extensions
as $$
  select (case p_card / 4 when 11 then 1 when 12 then 2 else p_card / 4 + 3 end) * 4
         + case p_card % 4 when 2 then 3 when 3 then 2 else p_card % 4 end
$$;

-- A Cào hand (§8.1, R18): {kind: "sap" | "ba_tay" | "nut", points (the nút), rank (a sáp's rank: A 1 … K 13), top (the
-- highest card's Cào key)}.
create or replace function public._cao_eval(p_cards integer[]) returns jsonb
language sql immutable set search_path = public, extensions
as $$
  select jsonb_build_object(
    'kind', case when count(distinct c / 4) = 1 then 'sap' when bool_and(c / 4 between 8 and 10) then 'ba_tay' else 'nut' end,
    'points', sum(least(public._cao_key(c) / 4, 10)) % 10,
    'rank', case when count(distinct c / 4) = 1 then min(public._cao_key(c) / 4) end,
    'top', max(public._cao_key(c)))
  from unnest(p_cards) c
$$;

-- Compare two Cào hands (R18, R19): 1 when a wins, −1 when b wins. Sáp > ba tây > nút; two sáp by rank; ba tây, and equal
-- nút, by the top card (rank, then ♦ > ♥ > ♣ > ♠). Two hands never share a card, so it is never 0.
create or replace function public._cao_cmp(a jsonb, b jsonb) returns integer
language sql immutable set search_path = public, extensions
as $$
  with x as (select case a->>'kind' when 'sap' then 2 when 'ba_tay' then 1 else 0 end ca,
                    case b->>'kind' when 'sap' then 2 when 'ba_tay' then 1 else 0 end cb)
  select case
    when ca <> cb then sign(ca - cb)::int
    when ca = 2 then sign((a->>'rank')::int - (b->>'rank')::int)::int
    when ca = 0 and (a->>'points')::int <> (b->>'points')::int then sign((a->>'points')::int - (b->>'points')::int)::int
    else sign((a->>'top')::int - (b->>'top')::int)::int end
  from x
$$;

-- A Cào hand's money (§8.3, R17), in units of S: each player still in the hand wins or loses 1 against the dealer, and a
-- player who left lost 1 to the dealer. p = {dealer, order (the dealt seats), left, hands: {seat: [c…]}}; the answer is
-- {lines: [{from, to, why: "cao" | "left"}], net: {seat: units}}.
create or replace function public._cao_settle(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare d integer := (p->>'dealer')::int; s integer; lines jsonb := '[]'; dh jsonb;
begin
  dh := public._cao_eval(public._card_ints(p->'hands'->(d::text)));
  foreach s in array public._card_ints(p->'order') loop
    continue when s = d;
    if s = any(public._card_ints(p->'left')) then
      lines := lines || jsonb_build_array(jsonb_build_object('from', s, 'to', d, 'why', 'left'));
    elsif public._cao_cmp(public._cao_eval(public._card_ints(p->'hands'->(s::text))), dh) > 0 then
      lines := lines || jsonb_build_array(jsonb_build_object('from', d, 'to', s, 'why', 'cao'));
    else
      lines := lines || jsonb_build_array(jsonb_build_object('from', s, 'to', d, 'why', 'cao'));
    end if;
  end loop;
  return jsonb_build_object('lines', lines, 'net', (
    select jsonb_object_agg(q::text, coalesce((select sum(case when (l->>'to')::int = q then 1 else -1 end)
                                                 from jsonb_array_elements(lines) l
                                                where q in ((l->>'from')::int, (l->>'to')::int)), 0))
      from unnest(public._card_ints(p->'order')) q));
end $$;

-- A card's poker rank: 2 … 14 (A = 14).
create or replace function public._pk_rank(p_card integer) returns integer
language sql immutable set search_path = public, extensions
as $$ select case when p_card / 4 = 12 then 2 else p_card / 4 + 3 end $$;

-- The top of the best straight among poker ranks (the ace also plays low: A-2-3-4-5 tops at 5), or null.
create or replace function public._pk_straight(p_ranks integer[]) returns integer
language sql immutable set search_path = public, extensions
as $$
  select max(t) from generate_series(5, 14) t
   where (select count(distinct x) from unnest(p_ranks || case when 14 = any(p_ranks) then array[1] else '{}'::int[] end) x
           where x between t - 4 and t) = 5
$$;

-- The best poker hand in up to 7 cards (§9.1), as a key compared lexicographically: [8, top] straight flush ·
-- [7, quad, kicker] · [6, trips, pair] · [5, the flush suit's top five] · [4, top] straight · [3, trips, k1, k2] ·
-- [2, high, low, kicker] · [1, pair, k1, k2, k3] · [0, the top five]. Suits never break ties.
create or replace function public._pk_eval(p_cards integer[]) returns integer[]
language plpgsql immutable set search_path = public, extensions
as $$
declare rs integer[]; fs integer; fr integer[]; t integer; q integer; tr integer[]; pr integer[];
begin
  rs := array(select public._pk_rank(c) from unnest(p_cards) c order by 1 desc);
  select c % 4 into fs from unnest(p_cards) c group by c % 4 having count(*) >= 5;
  if fs is not null then
    fr := array(select public._pk_rank(c) from unnest(p_cards) c where c % 4 = fs order by 1 desc);
    t := public._pk_straight(fr);
    if t is not null then
      return array[8, t];
    end if;
  end if;
  q := (select r from unnest(rs) r group by r having count(*) = 4);
  if q is not null then
    return array[7, q] || array(select r from unnest(rs) r where r <> q order by r desc limit 1);
  end if;
  tr := array(select r from unnest(rs) r group by r having count(*) = 3 order by r desc);
  pr := array(select r from unnest(rs) r group by r having count(*) = 2 order by r desc);
  if cardinality(tr) >= 2 then
    return array[6, tr[1], tr[2]];
  end if;
  if cardinality(tr) = 1 and cardinality(pr) >= 1 then
    return array[6, tr[1], pr[1]];
  end if;
  if fs is not null then
    return array[5] || fr[1:5];
  end if;
  t := public._pk_straight(rs);
  if t is not null then
    return array[4, t];
  end if;
  if cardinality(tr) = 1 then
    return array[3, tr[1]] || array(select r from unnest(rs) r where r <> tr[1] order by r desc limit 2);
  end if;
  if cardinality(pr) >= 2 then
    return array[2, pr[1], pr[2]] || array(select r from unnest(rs) r where r not in (pr[1], pr[2]) order by r desc limit 1);
  end if;
  if cardinality(pr) = 1 then
    return array[1, pr[1]] || array(select r from unnest(rs) r where r <> pr[1] order by r desc limit 3);
  end if;
  return array[0] || rs[1:5];
end $$;

-- The pots of a hand (§9.2): a level at each live all-in total and at the highest live total; each pot goes to the live
-- seats that reach its level, and the top pot also takes every folded chip above the highest live total. With the live
-- hands' keys (or a single eligible seat) each pot gets its winners, and its odd xu go one at a time to the winners in
-- seat order starting left of the button (TDA 20). p = {players: {seat: {put, fold, allin}}, keys: {seat: key}, button};
-- the answer is [{xu, seats, winners, shares: {seat: xu}}] (winners and shares only when they are known).
create or replace function public._pk_pots(p jsonb) returns jsonb
language plpgsql immutable set search_path = public, extensions
as $$
declare pl jsonb := coalesce(p->'players', '{}'); btn integer := (p->>'button')::int; top integer; lv integer[];
        lvl integer; prev integer := 0; amt integer; el integer[]; pots jsonb := '[]'; res jsonb := '[]'; pot jsonb;
        w integer[]; best integer[]; q integer; r integer;
begin
  top := (select max((v->>'put')::int) from jsonb_each(pl) e(k, v) where not coalesce((v->>'fold')::boolean, false));
  if top is null or top <= 0 then
    return '[]';
  end if;
  lv := array(select distinct x from (select (v->>'put')::int x from jsonb_each(pl) e(k, v)
                                       where not coalesce((v->>'fold')::boolean, false)
                                         and coalesce((v->>'allin')::boolean, false)
                                      union all select top) u
               where x > 0 order by x);
  foreach lvl in array lv loop
    amt := (select coalesce(sum(least((v->>'put')::int, lvl) - least((v->>'put')::int, prev)), 0) from jsonb_each(pl) e(k, v));
    el := array(select k::int from jsonb_each(pl) e(k, v)
                 where not coalesce((v->>'fold')::boolean, false) and (v->>'put')::int >= lvl order by k::int);
    if amt > 0 then
      if jsonb_array_length(pots) > 0 and pots->-1->'seats' = to_jsonb(el) then
        pots := jsonb_set(pots, array[(jsonb_array_length(pots) - 1)::text, 'xu'], to_jsonb((pots->-1->>'xu')::int + amt));
      else
        pots := pots || jsonb_build_array(jsonb_build_object('xu', amt, 'seats', to_jsonb(el)));
      end if;
    end if;
    prev := lvl;
  end loop;
  amt := (select coalesce(sum(greatest((v->>'put')::int - top, 0)), 0) from jsonb_each(pl) e(k, v));
  if amt > 0 then
    pots := jsonb_set(pots, array[(jsonb_array_length(pots) - 1)::text, 'xu'], to_jsonb((pots->-1->>'xu')::int + amt));
  end if;
  for pot in select value from jsonb_array_elements(pots) loop
    el := public._card_ints(pot->'seats');
    w := null;
    if cardinality(el) = 1 then
      w := el;
    elsif jsonb_typeof(p->'keys') = 'object' then
      best := (select max(public._card_ints(p->'keys'->(s::text))) from unnest(el) s);
      w := array(select s from unnest(el) s where public._card_ints(p->'keys'->(s::text)) = best order by s);
    end if;
    if w is not null then
      q := (pot->>'xu')::int / cardinality(w);
      r := (pot->>'xu')::int % cardinality(w);
      pot := pot || jsonb_build_object('winners', to_jsonb(w), 'shares', (
        select jsonb_object_agg(s::text, q + case when n <= r then 1 else 0 end)
          from (select s, row_number() over (order by case when btn is null then s else (s - btn + 5) % 6 end) n
                  from unnest(w) s) z));
    end if;
    res := res || jsonb_build_array(pot);
  end loop;
  return res;
end $$;

revoke all on function public._cao_key(integer) from public, anon, authenticated;
revoke all on function public._cao_eval(integer[]) from public, anon, authenticated;
revoke all on function public._cao_cmp(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public._cao_settle(jsonb) from public, anon, authenticated;
revoke all on function public._pk_rank(integer) from public, anon, authenticated;
revoke all on function public._pk_straight(integer[]) from public, anon, authenticated;
revoke all on function public._pk_eval(integer[]) from public, anon, authenticated;
revoke all on function public._pk_pots(jsonb) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected:

```text
v14 smoke ok
0017 twice ok
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
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(cards): 0017 Cào and poker rules as pure functions — hand values, comparisons, the dealer's settlement and the pots

Section B, continued: _cao_eval (sáp, ba tây, nút), _cao_cmp (the top card, then ♦ > ♥ > ♣ > ♠; no pushes) and
_cao_settle (each player still in the hand wins or loses 1 S against the dealer); _pk_eval (the category and the kickers
as one comparable key, the wheel, the board playing) and _pk_pots (side pots by contribution, folded chips included, the
odd chips from the button). The fixtures gain cao.eval, cao.cmp, cao.settle, poker.eval, poker.cmp and poker.pots; smoke
part 2 replays them.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0017_v16_cards.sql tests/fixtures/card-cases.json tests/sql/v16-smoke.sql
git commit -F <message file>
```

---

### Task 3: Database — the table machinery; the reads, `card_tick`, `card_leave` and `card_sit` (`0017` sections C and E, first part)

**Files:**
- Modify: `supabase/migrations/0017_v16_cards.sql` (append section C and the first RPCs of section E)
- Modify: `tests/sql/anticheat-guards.sql` (the allowlist gains the five card RPCs; the loop calls `card_sit`: 43 RPCs)
- Modify: `tests/sql/v16-smoke.sql` (append part 3)

**Interfaces:**
- Consumes: Tasks 1–2; from `0004`–`0016`: `_auth(room, token, 'any') → member id` (raises `invalid session` / `account is not a member of this room`), `_farm_auth(room, token) → uuid`, `_ac_play(room, token) → uuid` (the lock gate), `_ac_flag(account, code, rpc, detail, room, error, hard default true) → jsonb` (the envelope), `_wallet_lock(uuid)`, `wallets(account_id, coins)`, `coin_ledger`, `members(id, room_id, account_id)`, `accounts(username, is_banned)`.
- Produces (section C, private, revoked): `_card_init(room)`, `_card_open(room, game) → card_tables` (creates the three rows, locks one `for update`), `_card_game(text) → text` (`invalid game` otherwise), `_card_bump(room, game, action bool)` (`v += 1`; `seq += 1` for game actions), `_card_log(…)`, `_card_ref(game, hand_no) → text` (`tl#41`, `cao#7`, `pk#12`), `_card_touch(room, account, now)`, `_card_view(room, game, now) → jsonb` (the state of §11.4, the same for every viewer, never a hand), `_card_hand(room, game, account, now) → jsonb`, `_card_answer(room, game, account, now) → jsonb {changed: true, state, hand, coins}`, `_card_payout(room, game, seat, reason) → int`, `_card_settle(room, game)`, `_card_reset_if_empty(room, game)` (R36), `_card_live(room, game, seat) → bool`, `_card_leave_seat` / `_card_leave_seats(room, game, seat(s), how, now)` (the leave operation), `_card_ready(room, game, now)` (the countdown or `deal_wait` when two eligible seats wait), `_card_sweep(room, game, now, deck default null) → bool`, `_card_sit`, `_card_leave`, `_card_tick(room, account, game, now, deck default null) → jsonb`.
- Produces (section E, `security definer`, granted to `anon` and `authenticated`): `card_lobby(p_room_id, p_session_token) → {server_now, tables: [{game, stake, phase, max, seats: [{seat, id, name}]}]}`; `card_state(p_room_id, p_session_token, p_game) → state`; `card_hand(…, p_game) → {server_now, game, hand_no, seat, cards}`; `card_tick(…, p_game) → {changed, state}`; `card_leave(…, p_game) → the action answer` (`not seated`; `dealer busy` comes with Task 5); `card_sit(p_room_id, p_session_token, p_game, p_seat, p_stake, p_buyin) → the action answer`, guarded, with the hard checks `bad_game`, `bad_seat`, `bad_stake` and `bad_qty` (§11.5), then `still leaving`, `already seated`, `table full`, `seat taken`, `stake changed`, `not enough coins`.
- Produces (smoke): `pg_temp.set_coins(uuid, int)`, `pg_temp.coins(uuid) → int`, `pg_temp.money(room, accounts) → bigint`, `pg_temp.env(answer, code, error) → bool`; keys `c1`–`c6`, `a1`–`a6`, `room`, `other`; part 3 prints `v16 tables smoke ok`.

- [ ] **Step 1: Write the guard changes and smoke part 3**

**tests/sql/anticheat-guards.sql — edit 1 of 5.** Replace:

```sql
     'upsert_video_lyrics(text,text,text,text,text,integer,text,text)', 'update_video_lyric_offset(text,integer,text)',
     'fishing_state(text)', 'fishing_board(uuid,text)', 'field_state(uuid,text)')
$$;
```

with:

```sql
     'upsert_video_lyrics(text,text,text,text,text,integer,text,text)', 'update_video_lyric_offset(text,integer,text)',
     'fishing_state(text)', 'fishing_board(uuid,text)', 'field_state(uuid,text)',
     'card_lobby(uuid,text)', 'card_state(uuid,text,text)', 'card_hand(uuid,text,text)', 'card_tick(uuid,text,text)',
     'card_leave(uuid,text,text)')
$$;
```

**tests/sql/anticheat-guards.sql — edit 2 of 5.** Replace:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from all 42 game RPCs, and
--    the four reads still answer.
create temp table guards (k text primary key, v text);
```

with:

```sql

-- 2. Dynamic: a locked account gets 'account locked' (the seconds left, hint 'anticheat') from every guarded game RPC,
--    and the reads still answer.
create temp table guards (k text primary key, v text);
```

**tests/sql/anticheat-guards.sql — edit 3 of 5.** Replace:

```sql
    format('select public.plant_crop(%L, %L, 5, %L)', room, t, 'seed_bap'),
    format('select public.tend_crop(%L, %L, 5, %L)', room, t, 'vun_goc')] loop
    n := n + 1;
```

with:

```sql
    format('select public.plant_crop(%L, %L, 5, %L)', room, t, 'seed_bap'),
    format('select public.tend_crop(%L, %L, 5, %L)', room, t, 'vun_goc'),
    -- the card tables (v16)
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, t, 'tienlen')] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 4 of 5.** Replace:

```sql
  end loop;
  assert n = 42, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 43, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

**tests/sql/anticheat-guards.sql — edit 5 of 5.** Replace:

```sql
  perform public.touch_room(room, t);
end $$;
```

with:

```sql
  perform public.touch_room(room, t);
  perform public.card_lobby(room, t);
  perform public.card_state(room, t, 'tienlen');
  perform public.card_hand(room, t, 'tienlen');
  perform public.card_tick(room, t, 'tienlen');
end $$;
```

**tests/sql/v16-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- tables and seats (§6.1, §6.3, §11.3): the reads, sitting and its refusals, leaving, the sweep, the reset ----------
-- The tampered calls below are only recorded: log mode locks nobody.
update public.anticheat_config set mode = 'log';
insert into smoke select 'c' || n, token from generate_series(1, 6) n,
  lateral public.register('v16c' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('c1', 'c2', 'c3', 'c4', 'c5', 'c6');
insert into smoke select 'room', room_id::text from public.create_room('Góc bài', 'pw', (select v from smoke where k = 'c1'));
do $$
begin
  perform public.join_room((select code from public.rooms where id = (select v from smoke where k = 'room')::uuid), 'pw', v)
     from smoke where k in ('c2', 'c3', 'c4', 'c6');
end $$;
insert into smoke select 'other', room_id::text from public.create_room('Phòng khác', 'pw', (select v from smoke where k = 'c5'));

create function pg_temp.set_coins(a uuid, n integer) returns void language sql
as $$ insert into public.wallets (account_id, coins) values (a, n) on conflict (account_id) do update set coins = n $$;
create function pg_temp.coins(a uuid) returns integer language sql
as $$ select coalesce((select coins from public.wallets where account_id = a), 0) $$;
-- The xu of these accounts plus everything on the room's tables: escrows, stacks and a live pot (§6.2). Card calls never
-- change it.
create function pg_temp.money(p_room uuid, p_accounts uuid[]) returns bigint language sql as $$
  select coalesce((select sum(w.coins) from public.wallets w where w.account_id = any(p_accounts)), 0)
       + coalesce((select sum(s.chips + s.escrow) from public.card_seats s where s.room_id = p_room), 0)
       + coalesce((select sum((p.value->>'put')::bigint) from public.card_tables t, jsonb_each(t.pub->'players') p
                    where t.room_id = p_room and t.game = 'poker' and t.phase = 'playing'), 0)
$$;
-- A strike-0 envelope with this code and error, and nothing else in the answer.
create function pg_temp.env(r jsonb, code text, error text) returns boolean language sql
as $$ select r->'anticheat'->>'code' = code and (r->'anticheat'->>'strike')::int = 0 and r->'anticheat'->>'error' = error
             and r - 'anticheat' = '{}'::jsonb $$;

do $$
declare c1 text := (select v from smoke where k = 'c1'); c5 text := (select v from smoke where k = 'c5');
        room uuid := (select v from smoke where k = 'room')::uuid; a1 uuid := (select v from smoke where k = 'a1')::uuid;
        r jsonb; s jsonb; call text;
begin
  -- a room with no card rows reads as three idle, empty tables, and reading creates nothing (R37)
  r := public.card_lobby(room, c1);
  assert (select jsonb_agg(jsonb_build_array(x->'game', x->'max', x->'phase', x->'stake', x->'seats')) from jsonb_array_elements(r->'tables') x)
         = '[["tienlen", 4, "idle", null, []], ["cao", 6, "idle", null, []], ["poker", 6, "idle", null, []]]'::jsonb,
    format('the empty lobby: %s', r);
  s := public.card_state(room, c1, 'poker');
  assert s->>'game' = 'poker' and s->>'phase' = 'idle' and s->'seats' = '[]' and (s->>'v')::int = 0 and (s->>'max')::int = 6
         and s->'stake' = 'null' and s->'pub' = '{}' and s->'last' = 'null' and s->>'server_now' is not null, format('idle state: %s', s);
  s := public.card_hand(room, c1, 'tienlen');
  assert s->'cards' = '[]' and s->'seat' = 'null' and (s->>'hand_no')::int = 0, format('no hand: %s', s);
  assert not exists (select 1 from public.card_tables where room_id = room), 'reads create no table rows';
  -- membership comes first (R38)
  foreach call in array array[
    format('select public.card_lobby(%L, %L)', room, c5),
    format('select public.card_state(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_hand(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_tick(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_leave(%L, %L, %L)', room, c5, 'tienlen'),
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c5, 'tienlen')] loop
    assert pg_temp.err(call) = 'account is not a member of this room', format('%s: %s', call, pg_temp.err(call));
    assert pg_temp.err(replace(call, c5, 'nope')) = 'invalid session', format('%s with a bad token', call);
  end loop;
  -- a bad game from a read, a tick or a leave is refused, never flagged (§11.5)
  foreach call in array array[
    format('select public.card_state(%L, %L, %L)', room, c1, 'bai'),
    format('select public.card_hand(%L, %L, null)', room, c1),
    format('select public.card_tick(%L, %L, %L)', room, c1, 'Poker'),
    format('select public.card_leave(%L, %L, %L)', room, c1, '')] loop
    assert pg_temp.err(call) = 'invalid game', format('%s: %s', call, pg_temp.err(call));
  end loop;
  -- the hard signals of card_sit (§11.5): an envelope in log mode, and nothing sits
  assert pg_temp.env(public.card_sit(room, c1, 'bai', 1, 1000, null), 'bad_game', 'invalid game'), 'bad_game';
  assert pg_temp.env(public.card_sit(room, c1, null, 1, 1000, null), 'bad_game', 'invalid game'), 'bad_game null';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 5, 1000, null), 'bad_seat', 'invalid seat'), 'bad_seat 5';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 0, 1000, null), 'bad_seat', 'invalid seat'), 'bad_seat 0';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 7, 1000, 100000), 'bad_seat', 'invalid seat'), 'bad_seat 7';
  assert pg_temp.env(public.card_sit(room, c1, 'cao', null, 1000, null), 'bad_seat', 'invalid seat'), 'bad_seat null';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 1, 500, null), 'bad_stake', 'invalid stake'), 'bad_stake';
  assert pg_temp.env(public.card_sit(room, c1, 'cao', 1, null, null), 'bad_stake', 'invalid stake'), 'bad_stake null';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 1, 1000, 49999), 'bad_qty', 'invalid quantity'), 'buy-in below 50 BB';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 1, 1000, 200001), 'bad_qty', 'invalid quantity'), 'buy-in above 200 BB';
  assert pg_temp.env(public.card_sit(room, c1, 'poker', 1, 100, null), 'bad_qty', 'invalid quantity'), 'no buy-in';
  assert pg_temp.env(public.card_sit(room, c1, 'tienlen', 1, 1000, 10000), 'bad_qty', 'invalid quantity'), 'a buy-in at Tiến lên';
  assert (select count(*) from public.anticheat_events where account_id = a1 and outcome = 'log_only'
            and code in ('bad_game', 'bad_seat', 'bad_stake', 'bad_qty') and rpc = 'card_sit') = 12, 'twelve hard signals logged';
  assert not exists (select 1 from public.card_seats where room_id = room), 'nobody sat';
end $$;

do $$
declare c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c6 text := (select v from smoke where k = 'c6'); room uuid := (select v from smoke where k = 'room')::uuid;
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a6 uuid := (select v from smoke where k = 'a6')::uuid; accs uuid[]; m bigint; r jsonb; v0 bigint;
begin
  accs := array[a1, a2, a3, a4, a6];
  perform pg_temp.set_coins(a1, 50000);
  perform pg_temp.set_coins(a2, 9999);
  perform pg_temp.set_coins(a3, 20000);
  perform pg_temp.set_coins(a4, 20000);
  perform pg_temp.set_coins(a6, 20000);
  m := pg_temp.money(room, accs);
  -- the first player picks the stake; Tiến lên holds nothing until the deal
  r := public.card_sit(room, c1, 'tienlen', 1, 1000, null);
  assert (r->>'changed')::boolean and (r->'state'->>'stake')::int = 1000 and r->'state'->>'phase' = 'idle'
         and r->'state'->'seats' = jsonb_build_array(jsonb_build_object('seat', 1, 'id', a1, 'name', (select username from public.accounts where id = a1),
                                                                        'chips', 0, 'escrow', 0, 'leaving', false))
         and (r->>'coins')::int = 50000 and r->'hand'->'cards' = '[]' and (r->'hand'->>'seat')::int = 1, format('c1 sits: %s', r);
  -- 10 S in the wallet to sit at Tiến lên (§6.1)
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 2, 1000, null)', room, c2, 'tienlen')) = 'not enough coins', 'c2 is short';
  perform pg_temp.set_coins(a2, 10000);
  m := pg_temp.money(room, accs);
  r := public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  assert r->'state'->>'phase' = 'countdown'
         and (r->'state'->>'deadline')::timestamptz between now() + interval '7 seconds' and now() + interval '9 seconds',
    format('the second seat starts the 8 s countdown: %s', r->'state');
  -- the refusals, in their order (§11.3)
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, null)', room, c1, 'cao')) = 'already seated', 'one seat per room';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c3, 'tienlen')) = 'seat taken', 'seat taken';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 3, 100, null)', room, c3, 'tienlen')) = 'stake changed', 'the stake is 1000';
  perform public.card_sit(room, c3, 'tienlen', 3, 1000, null);
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c6, 'tienlen')) = 'table full', 'full before taken';
  -- standing up outside a hand: the seat goes at once
  r := public.card_leave(room, c4, 'tienlen');
  assert jsonb_array_length(r->'state'->'seats') = 3 and r->'hand'->'seat' = 'null', 'c4 stood up';
  assert pg_temp.err(format('select public.card_leave(%L, %L, %L)', room, c4, 'tienlen')) = 'not seated', 'not seated';
  -- poker: the buy-in moves to the table, standing up cashes it out, and the empty table resets
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 3, 1000, 50000)', room, c6, 'poker')) = 'not enough coins', 'buy-in > wallet';
  r := public.card_sit(room, c4, 'poker', 2, 100, 5000);
  assert pg_temp.coins(a4) = 15000 and (r->>'coins')::int = 15000 and (r->'state'->'seats'->0->>'chips')::int = 5000
         and (r->'state'->>'stake')::int = 100, format('the buy-in: %s', r->'state');
  assert (select reason = 'card_buyin' and delta = -5000 and ref = 'pk#0' from public.coin_ledger where account_id = a4 order by id desc limit 1),
    'card_buyin in the ledger';
  assert pg_temp.money(room, accs) = m, 'zero-sum after the buy-in';
  v0 := (select v from public.card_tables where room_id = room and game = 'poker');
  r := public.card_leave(room, c4, 'poker');
  assert pg_temp.coins(a4) = 20000 and r->'state'->'seats' = '[]' and r->'state'->'stake' = 'null', format('cashed out: %s', r->'state');
  assert (select reason = 'card_cashout' and delta = 5000 from public.coin_ledger where account_id = a4 order by id desc limit 1),
    'card_cashout in the ledger';
  assert (select v > v0 from public.card_tables where room_id = room and game = 'poker'), 'the reset shows';
  assert pg_temp.money(room, accs) = m, 'zero-sum after the cash-out';
  -- a read touches seen_at, at most once per 10 s (R28)
  update public.card_seats set seen_at = now() - interval '5 minutes' where room_id = room and account_id = a1;
  perform public.card_state(room, c1, 'cao');
  assert (select seen_at > now() - interval '1 minute' from public.card_seats where room_id = room and account_id = a1), 'touched';
  -- the sweep stands up a kicked member and a banned account together (§6.3)
  perform public.kick_member(room, c1, (select id from public.members where room_id = room and account_id = a3));
  update public.accounts set is_banned = true where id = a2;
  r := public.card_tick(room, c1, 'tienlen');
  assert (r->>'changed')::boolean and jsonb_array_length(r->'state'->'seats') = 1 and r->'state'->>'phase' = 'idle',
    format('the sweep left one seat and went idle: %s', r->'state');
  assert pg_temp.money(room, accs) = m, 'zero-sum after the sweep';
  update public.accounts set is_banned = false where id = a2;
  perform public.join_room((select code from public.rooms where id = room), 'pw', c3);
  r := public.card_tick(room, c1, 'tienlen');
  assert not (r->>'changed')::boolean, 'nothing more is due';
  -- the last seat to go resets the table (R36)
  update public.card_tables set lead_id = a1, pos = 3, first_game = false, last = '{"hand_no": 1}'
   where room_id = room and game = 'tienlen';
  perform public.card_leave(room, c1, 'tienlen');
  assert (select stake is null and phase = 'idle' and first_game and pub = '{}' and last is null and lead_id is null and pos is null
                 and turn is null and deadline is null
            from public.card_tables where room_id = room and game = 'tienlen'), 'the empty table reset';
  -- a locked account cannot sit, but reads, ticks and leaves (R31)
  insert into public.anticheat_status (account_id, locked_until) values (a6, now() + interval '5 minutes')
  on conflict (account_id) do update set locked_until = excluded.locked_until;
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, null)', room, c6, 'cao')) = 'account locked', 'locked';
  perform public.card_lobby(room, c6);
  perform public.card_state(room, c6, 'cao');
  perform public.card_hand(room, c6, 'cao');
  perform public.card_tick(room, c6, 'cao');
  assert pg_temp.err(format('select public.card_leave(%L, %L, %L)', room, c6, 'cao')) = 'not seated', 'a locked account may leave';
  update public.anticheat_status set locked_until = null where account_id = a6;
  assert pg_temp.money(room, accs) = m, 'zero-sum at the end';
end $$;

select 'v16 tables smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` — the guard file it ends with now calls `card_sit`: `function public.card_sit(unknown, unknown, unknown, integer, integer, unknown) does not exist` in the log.

- [ ] **Step 3: Write section C and the first RPCs of section E**

**supabase/migrations/0017_v16_cards.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- C. Table machinery (§6, §10, §11.2, §11.6) ----------
-- The room's three tables, created by the first card tick or write; a read shows a missing row as idle and empty.
create or replace function public._card_init(p_room uuid) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.card_tables (room_id, game) select p_room, g from unnest(array['tienlen', 'cao', 'poker']) g
  on conflict (room_id, game) do nothing
$$;

-- A tick or a write takes the table row first (§11.6): one call per table at a time, before any wallet.
create or replace function public._card_open(p_room uuid, p_game text) returns public.card_tables
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables;
begin
  perform public._card_init(p_room);
  select * into t from public.card_tables where room_id = p_room and game = p_game for update;
  return t;
end $$;

-- The game a read, a tick or a leave names; anything else is refused and never flagged (§11.5).
create or replace function public._card_game(p_game text) returns text
language plpgsql immutable set search_path = public, extensions
as $$
begin
  if p_game is null or p_game not in ('tienlen', 'cao', 'poker') then
    raise exception 'invalid game' using errcode = '22023';
  end if;
  return p_game;
end $$;

-- v counts every visible change, seq every game action (R24).
create or replace function public._card_bump(p_room uuid, p_game text, p_action boolean) returns void
language sql security definer set search_path = public, extensions
as $$
  update public.card_tables set v = v + 1, seq = seq + case when p_action then 1 else 0 end
   where room_id = p_room and game = p_game
$$;

-- One row of the evidence log (R34).
create or replace function public._card_log(p_room uuid, p_game text, p_hand integer, p_account uuid, p_seat integer,
                                            p_action text, p_detail jsonb, p_at timestamptz) returns void
language sql security definer set search_path = public, extensions
as $$
  insert into public.card_log (room_id, game, hand_no, account_id, seat, action, detail, at)
  values (p_room, p_game, p_hand, p_account, p_seat, p_action, coalesce(p_detail, '{}'::jsonb), p_at)
$$;

-- A hand's ledger ref (§6.2): tl#41, cao#7, pk#12.
create or replace function public._card_ref(p_game text, p_hand integer) returns text
language sql immutable set search_path = public, extensions
as $$ select case p_game when 'tienlen' then 'tl#' when 'cao' then 'cao#' else 'pk#' end || p_hand $$;

-- The owner of a card call was seen (R28): at most one write per 10 s.
create or replace function public._card_touch(p_room uuid, p_account uuid, p_now timestamptz) returns void
language sql security definer set search_path = public, extensions
as $$
  update public.card_seats set seen_at = p_now
   where room_id = p_room and account_id = p_account and seen_at < p_now - interval '10 seconds'
$$;

-- A table's public state (§11.4), the same for every viewer (R25), built in one statement: one snapshot, no writes.
create or replace function public._card_view(p_room uuid, p_game text, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now, 'game', g.game, 'stake', t.stake, 'max', public._card_max(g.game),
    'v', coalesce(t.v, 0), 'seq', coalesce(t.seq, 0), 'hand_no', coalesce(t.hand_no, 0), 'phase', coalesce(t.phase, 'idle'),
    'turn', t.turn, 'deadline', t.deadline,
    'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'id', s.account_id, 'name', a.username,
                                                           'chips', s.chips, 'escrow', s.escrow, 'leaving', s.leaving)
                                        order by s.seat)
                         from public.card_seats s join public.accounts a on a.id = s.account_id
                        where s.room_id = p_room and s.game = g.game), '[]'::jsonb),
    'pub', coalesce(t.pub, '{}'::jsonb), 'last', t.last)
  from (select p_game as game) g
  left join public.card_tables t on t.room_id = p_room and t.game = g.game
$$;

-- The caller's cards (§11.3): the hand dealt to this account in the table's current hand, or none.
create or replace function public._card_hand(p_room uuid, p_game text, p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'server_now', p_now, 'game', p_game, 'hand_no', coalesce(t.hand_no, 0),
    'seat', (select s.seat from public.card_seats s where s.room_id = p_room and s.game = p_game and s.account_id = p_account),
    'cards', coalesce((select to_jsonb(h.cards) from public.card_hands h
                        where h.room_id = p_room and h.game = p_game and h.hand_no = t.hand_no and h.account_id = p_account),
                      '[]'::jsonb))
  from (select 1) x
  left join public.card_tables t on t.room_id = p_room and t.game = p_game
$$;

-- The answer of every write (§11.3): the state, the caller's hand and the caller's coins.
create or replace function public._card_answer(p_room uuid, p_game text, p_account uuid, p_now timestamptz) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object('changed', true, 'state', public._card_view(p_room, p_game, p_now),
                            'hand', public._card_hand(p_room, p_game, p_account, p_now),
                            'coins', coalesce((select w.coins from public.wallets w where w.account_id = p_account), 0))
$$;

-- Pay one seat out (§6.2): its balance (Tiến lên, Cào) or its stack (poker) goes to its wallet with p_reason, and the seat
-- keeps 0. No ledger row when it is 0. Returns the amount.
create or replace function public._card_payout(p_room uuid, p_game text, p_seat integer, p_reason text) returns integer
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.card_seats; v_amt integer; v_hand integer;
begin
  select * into s from public.card_seats where room_id = p_room and game = p_game and seat = p_seat for update;
  if not found then
    return 0;
  end if;
  v_amt := s.chips + s.escrow;
  update public.card_seats set chips = 0, escrow = 0 where room_id = p_room and game = p_game and seat = p_seat;
  if v_amt > 0 then
    select hand_no into v_hand from public.card_tables where room_id = p_room and game = p_game;
    perform public._wallet_lock(s.account_id);
    perform public._pay(s.account_id, v_amt, p_reason, public._card_ref(p_game, v_hand));
  end if;
  return v_amt;
end $$;

-- Pay every seat its balance at a hand's end (§6.2), the wallets locked in account-id order first (§11.6).
create or replace function public._card_settle(p_room uuid, p_game text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;
begin
  for r in select account_id from public.card_seats where room_id = p_room and game = p_game and escrow > 0
            order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  for r in select seat from public.card_seats where room_id = p_room and game = p_game and escrow > 0 order by seat loop
    perform public._card_payout(p_room, p_game, r.seat, 'card_settle');
  end loop;
end $$;

-- The empty-table reset (R36): a new group never inherits a winner, a dealer, a button or a stake. hand_no keeps counting.
create or replace function public._card_reset_if_empty(p_room uuid, p_game text) returns void
language sql security definer set search_path = public, extensions
as $$
  update public.card_tables
     set first_game = true, lead_id = null, pos = null, turn = null, deadline = null, pub = '{}'::jsonb, last = null,
         stake = null, phase = 'idle', v = v + 1, seq = seq + 1
   where room_id = p_room and game = p_game
     and not exists (select 1 from public.card_seats s where s.room_id = p_room and s.game = p_game)
$$;

-- Is this seat in the live hand: dealt into the current hand, by the account that sits there, while it is played?
create or replace function public._card_live(p_room uuid, p_game text, p_seat integer) returns boolean
language sql stable security definer set search_path = public, extensions
as $$
  select exists (
    select 1 from public.card_tables t
      join public.card_hands h on h.room_id = t.room_id and h.game = t.game and h.hand_no = t.hand_no and h.seat = p_seat
      join public.card_seats s on s.room_id = t.room_id and s.game = t.game and s.seat = p_seat and s.account_id = h.account_id
     where t.room_id = p_room and t.game = p_game and t.phase in ('playing', 'peek'))
$$;

-- The leave operation (§6.3), for one seat: a seat that is not in the live hand is paid out (a poker stack is cashed
-- out) and goes at once; the last seat to go resets the table. p_how: leave, timeout, sweep or forfeit_all.
create or replace function public._card_leave_seat(p_room uuid, p_game text, p_seat integer, p_how text, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare s public.card_seats; v_hand integer;
begin
  select * into s from public.card_seats where room_id = p_room and game = p_game and seat = p_seat for update;
  if not found then
    return;
  end if;
  select hand_no into v_hand from public.card_tables where room_id = p_room and game = p_game;
  perform public._card_payout(p_room, p_game, p_seat, case when p_game = 'poker' then 'card_cashout' else 'card_settle' end);
  delete from public.card_seats where room_id = p_room and game = p_game and seat = p_seat;
  perform public._card_log(p_room, p_game, v_hand, s.account_id, p_seat, 'leave', jsonb_build_object('how', p_how), p_now);
  perform public._card_reset_if_empty(p_room, p_game);
end $$;

-- Several seats leave together, as one sweep removes them (§6.3): their wallets are locked in account-id order first.
create or replace function public._card_leave_seats(p_room uuid, p_game text, p_seats integer[], p_how text, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record; v_seat integer;
begin
  for r in select account_id from public.card_seats where room_id = p_room and game = p_game and seat = any(p_seats)
            order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  foreach v_seat in array p_seats loop
    perform public._card_leave_seat(p_room, p_game, v_seat, p_how, p_now);
  end loop;
end $$;

-- Two seats start a table (§6.1): the countdown (Tiến lên 8 s, poker 5 s) or the dealer's wait (Cào, 15 s). Before the
-- deal, fewer than two seats send it back to idle.
create or replace function public._card_ready(p_room uuid, p_game text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; n integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = p_game;
  n := (select count(*) from public.card_seats where room_id = p_room and game = p_game and not leaving);
  if t.phase = 'idle' and n >= 2 then
    update public.card_tables
       set phase = case p_game when 'cao' then 'deal_wait' else 'countdown' end, turn = null, pub = '{}'::jsonb,
           deadline = p_now + case p_game when 'tienlen' then interval '8 seconds' when 'cao' then interval '15 seconds'
                                          else interval '5 seconds' end
     where room_id = p_room and game = p_game;
  elsif t.phase in ('countdown', 'deal_wait') and n < 2 then
    update public.card_tables set phase = 'idle', deadline = null, turn = null, pub = '{}'::jsonb
     where room_id = p_room and game = p_game;
  end if;
end $$;

-- The lazy clock of a table (§6.3, §10), under its lock: the seats of non-members and banned accounts leave together
-- (R13, anti-cheat R10), then the one step that is due. True when it changed anything.
create or replace function public._card_sweep(p_room uuid, p_game text, p_now timestamptz, p_deck integer[] default null)
returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare f integer[]; v_changed boolean := false;
begin
  f := array(select s.seat from public.card_seats s join public.accounts a on a.id = s.account_id
              where s.room_id = p_room and s.game = p_game and not s.leaving
                and (a.is_banned or not exists (select 1 from public.members m
                                                 where m.room_id = p_room and m.account_id = s.account_id))
              order by s.seat);
  if cardinality(f) > 0 then
    perform public._card_leave_seats(p_room, p_game, f, 'sweep', p_now);
    v_changed := true;
  end if;
  if v_changed then
    perform public._card_ready(p_room, p_game, p_now);
    perform public._card_bump(p_room, p_game, true);
  end if;
  return v_changed;
end $$;

-- Sit (§11.3): the refusals in their order, then the stake, the requirement (§6.1) and the poker buy-in.
create or replace function public._card_sit(p_room uuid, p_account uuid, p_game text, p_seat integer, p_stake integer,
                                            p_buyin integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; w public.wallets;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_touch(p_room, p_account, p_now);
  perform public._card_sweep(p_room, p_game, p_now);
  select * into t from public.card_tables where room_id = p_room and game = p_game;
  if exists (select 1 from public.card_seats where room_id = p_room and account_id = p_account and leaving) then
    raise exception 'still leaving' using errcode = '22023';
  end if;
  if exists (select 1 from public.card_seats where room_id = p_room and account_id = p_account) then
    raise exception 'already seated' using errcode = '22023';
  end if;
  if (select count(*) from public.card_seats where room_id = p_room and game = p_game) >= public._card_max(p_game) then
    raise exception 'table full' using errcode = '22023';
  end if;
  if exists (select 1 from public.card_seats where room_id = p_room and game = p_game and seat = p_seat) then
    raise exception 'seat taken' using errcode = '22023';
  end if;
  if exists (select 1 from public.card_seats where room_id = p_room and game = p_game) and t.stake is distinct from p_stake then
    raise exception 'stake changed' using errcode = '22023';
  end if;
  w := public._wallet_lock(p_account);
  if w.coins < (case p_game when 'tienlen' then 10 * p_stake when 'cao' then p_stake else p_buyin end) then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  update public.card_tables set stake = p_stake where room_id = p_room and game = p_game;
  insert into public.card_seats (room_id, game, seat, account_id, chips, seen_at, sat_at)
  values (p_room, p_game, p_seat, p_account, case when p_game = 'poker' then p_buyin else 0 end, p_now, p_now);
  if p_game = 'poker' then
    perform public._pay(p_account, -p_buyin, 'card_buyin', public._card_ref(p_game, t.hand_no));
  end if;
  perform public._card_log(p_room, p_game, t.hand_no, p_account, p_seat, 'sit',
                           jsonb_build_object('stake', p_stake, 'buyin', p_buyin), p_now);
  perform public._card_ready(p_room, p_game, p_now);
  perform public._card_bump(p_room, p_game, false);
  return public._card_answer(p_room, p_game, p_account, p_now);
end $$;

-- Stand up (§6.3): the leave operation on the caller's seat.
create or replace function public._card_leave(p_room uuid, p_account uuid, p_game text, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seat integer; v_live boolean;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_sweep(p_room, p_game, p_now);
  select seat into v_seat from public.card_seats
   where room_id = p_room and game = p_game and account_id = p_account and not leaving;
  if v_seat is null then
    raise exception 'not seated' using errcode = '22023';
  end if;
  v_live := public._card_live(p_room, p_game, v_seat);
  perform public._card_leave_seat(p_room, p_game, v_seat, 'leave', p_now);
  perform public._card_ready(p_room, p_game, p_now);
  perform public._card_bump(p_room, p_game, v_live);
  return public._card_answer(p_room, p_game, p_account, p_now);
end $$;

-- A tick (§10): the lock, the sweep, the state.
create or replace function public._card_tick(p_room uuid, p_account uuid, p_game text, p_now timestamptz,
                                             p_deck integer[] default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_changed boolean;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_touch(p_room, p_account, p_now);
  v_changed := public._card_sweep(p_room, p_game, p_now, p_deck);
  return jsonb_build_object('changed', v_changed, 'state', public._card_view(p_room, p_game, p_now));
end $$;

revoke all on function public._card_init(uuid) from public, anon, authenticated;
revoke all on function public._card_open(uuid, text) from public, anon, authenticated;
revoke all on function public._card_game(text) from public, anon, authenticated;
revoke all on function public._card_bump(uuid, text, boolean) from public, anon, authenticated;
revoke all on function public._card_log(uuid, text, integer, uuid, integer, text, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public._card_ref(text, integer) from public, anon, authenticated;
revoke all on function public._card_touch(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_view(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_hand(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_answer(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_payout(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public._card_settle(uuid, text) from public, anon, authenticated;
revoke all on function public._card_reset_if_empty(uuid, text) from public, anon, authenticated;
revoke all on function public._card_live(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._card_leave_seat(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_leave_seats(uuid, text, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_ready(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_sweep(uuid, text, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._card_sit(uuid, uuid, text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._card_leave(uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_tick(uuid, uuid, text, timestamptz, integer[]) from public, anon, authenticated;

-- ---------- E. Public RPCs (§11.3): membership first (R38); reads are snapshots (R37); ticks and writes lock and sweep ----------
-- The hall's table labels (R27): every table's stake, phase and seats; no touch, no lock.
create or replace function public.card_lobby(p_room_id uuid, p_session_token text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._auth(p_room_id, p_session_token, 'any');
  return jsonb_build_object('server_now', now(), 'tables', (
    select jsonb_agg(jsonb_build_object(
             'game', g.game, 'stake', t.stake, 'phase', coalesce(t.phase, 'idle'), 'max', public._card_max(g.game),
             'seats', coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat, 'id', s.account_id, 'name', a.username)
                                                 order by s.seat)
                                  from public.card_seats s join public.accounts a on a.id = s.account_id
                                 where s.room_id = p_room_id and s.game = g.game), '[]'::jsonb)) order by g.n)
      from unnest(array['tienlen', 'cao', 'poker']) with ordinality g(game, n)
      left join public.card_tables t on t.room_id = p_room_id and t.game = g.game));
end $$;

-- A table's public state (§11.4); the caller's seen_at is touched in a separate statement.
create or replace function public.card_state(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := (select account_id from public.members where id = public._auth(p_room_id, p_session_token, 'any'));
        v jsonb;
begin
  v := public._card_view(p_room_id, public._card_game(p_game), now());
  perform public._card_touch(p_room_id, v_account, now());
  return v;
end $$;

-- The caller's own cards, and nobody else's (§6.4).
create or replace function public.card_hand(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := (select account_id from public.members where id = public._auth(p_room_id, p_session_token, 'any'));
        v jsonb;
begin
  v := public._card_hand(p_room_id, public._card_game(p_game), v_account, now());
  perform public._card_touch(p_room_id, v_account, now());
  return v;
end $$;

-- Apply what is due (§10). Allowlisted (R31): it applies only what is due.
create or replace function public.card_tick(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  return public._card_tick(p_room_id, v_account, public._card_game(p_game), now(), null);
end $$;

-- Stand up. Allowlisted (R31): leaving never helps a cheater.
create or replace function public.card_leave(p_room_id uuid, p_session_token text, p_game text) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._farm_auth(p_room_id, p_session_token);
begin
  return public._card_leave(p_room_id, v_account, public._card_game(p_game), now());
end $$;

-- Sit down (§11.3). Guarded; the hard checks (§11.5) come before any lock.
create or replace function public.card_sit(p_room_id uuid, p_session_token text, p_game text, p_seat integer, p_stake integer,
                                           p_buyin integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_game is null or p_game not in ('tienlen', 'cao', 'poker') then
    return public._ac_flag(v_account, 'bad_game', 'card_sit', jsonb_build_object('game', p_game), p_room_id, 'invalid game');
  end if;
  if p_seat is null or p_seat not between 1 and public._card_max(p_game) then
    return public._ac_flag(v_account, 'bad_seat', 'card_sit', jsonb_build_object('game', p_game, 'seat', p_seat), p_room_id,
                           'invalid seat');
  end if;
  if p_stake is null or p_stake not in (100, 1000, 10000) then
    return public._ac_flag(v_account, 'bad_stake', 'card_sit', jsonb_build_object('game', p_game, 'stake', p_stake), p_room_id,
                           'invalid stake');
  end if;
  if (p_game = 'poker' and (p_buyin is null or p_buyin not between 50 * p_stake and 200 * p_stake))
     or (p_game <> 'poker' and p_buyin is not null) then
    return public._ac_flag(v_account, 'bad_qty', 'card_sit',
                           jsonb_build_object('game', p_game, 'stake', p_stake, 'buyin', p_buyin), p_room_id, 'invalid quantity');
  end if;
  return public._card_sit(p_room_id, v_account, p_game, p_seat, p_stake, p_buyin, now());
end $$;

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
grant execute on function public.card_state(uuid, text, text) to anon, authenticated;
grant execute on function public.card_hand(uuid, text, text) to anon, authenticated;
grant execute on function public.card_tick(uuid, text, text) to anon, authenticated;
grant execute on function public.card_leave(uuid, text, text) to anon, authenticated;
grant execute on function public.card_sit(uuid, text, text, integer, integer, integer) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected:

```text
v14 smoke ok
0017 twice ok
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
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(cards): 0017 table machinery — lobby, state, hand, tick, sit and leave; the sweep and the empty-table reset

Section C: the three table rows made lazily and locked first (_card_open), v and seq (_card_bump), the log, the seen_at
touch (at most every 10 s), the public state built in one snapshot (_card_view), the caller's hand, payouts and the
settlement under the wallet locks, the leave operation, the sweep (non-members and banned accounts leave, due timeouts,
the idle rule) and the empty-table reset. Section E starts: card_lobby, card_state and card_hand (membership first,
snapshots), card_tick and card_leave (allowlisted), and the guarded card_sit with its hard checks. The guard file
allowlists the five by signature and its loop calls card_sit (43 guarded RPCs). Smoke part 3: the reads, sitting and its
refusals, leaving, the sweep, the reset and the envelopes of the tampered calls.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0017_v16_cards.sql tests/sql/anticheat-guards.sql tests/sql/v16-smoke.sql
git commit -F <message file>
```

---

### Task 4: Database — the Tiến lên engine; `tl_play` and `tl_pass` (`0017` sections C and D)

**Files:**
- Modify: `supabase/migrations/0017_v16_cards.sql` (the dispatchers and the wallet locks in section C, the Tiến lên engine in section D, `tl_play` and `tl_pass` in section E)
- Modify: `tests/sql/anticheat-guards.sql` (the loop calls `tl_play` and `tl_pass`: 45 RPCs)
- Modify: `tests/sql/v16-smoke.sql` (append part 4)

**Interfaces:**
- Consumes: Tasks 1–3 (`_tl_money` and the other rules, the machinery, `_card_answer`, `_card_bump`, the sweep).
- Produces (section C): `_card_lock_wallets(room, game)` (every seated account's wallet, account-id order), `_card_leave_live(room, game, seats, how, now)` and `_card_due(room, game, now, deck) → bool` (per-game dispatch; Tasks 5–6 add their branches), `_card_action(room, account, game, kind, seq, args, now, deck default null) → jsonb` (the lock, the sweep, the seat, `stale` (R24), the move; a refused move returns the soft `bad_move` envelope with `strike: 0`, R30); `_card_sweep` now deals and times out through `_card_due`.
- Produces (section D, private): `_tl_hands(room) → jsonb`, `_tl_active(pub) → int[]`, `_tl_event(room, ev) → jsonb` (runs `_tl_money` and moves the escrows), `_tl_last(room, trang) → jsonb` (the result: places, outs, lines, nets in xu), `_tl_deal(room, now, deck) → bool` (13 each, the first game's `must`, the lead, tới trắng), `_tl_do_trang`, `_tl_advance`, `_tl_close`, `_tl_do_play(room, seat, cards, now) → text` (the refusal or null: `wrong phase`, `not your turn`, `invalid play`, `must include`, `cannot beat`; an out-of-turn 4 đôi thông is a cut, R9), `_tl_do_pass(…) → text` (`wrong phase`, `not your turn`, `must play`), `_tl_timeout(room, now)`, `_tl_leave(room, seats, how, now)`, `_tl_end(room, now)`, `_tl_due(room, now, deck) → bool`.
- Produces (section E): `tl_play(p_room_id, p_session_token, p_seq, p_cards int[])` (hard `bad_cards`: null, empty, not one-dimensional, more than 13, outside 0–51 or duplicates) and `tl_pass(p_room_id, p_session_token, p_seq)`, both guarded; each returns the action answer, the envelope, or raises `stale` / `not seated`.
- Produces (smoke): helpers `pg_temp.hand`, `sorted`, `deck`, `total`, `tt`, `esc`, `plines`, `result`, `deal`, `tl`, `tl_bad`; eight games (§17's Tiến lên list); part 4 prints `v16 tienlen smoke ok`.

- [ ] **Step 1: Write the guard changes and smoke part 4**

**tests/sql/anticheat-guards.sql — edit 1 of 2.** Replace:

```sql
    -- the card tables (v16)
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, t, 'tienlen')] loop
    n := n + 1;
```

with:

```sql
    -- the card tables (v16)
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, t, 'tienlen'),
    format('select public.tl_play(%L, %L, 0, array[0])', room, t),
    format('select public.tl_pass(%L, %L, 0)', room, t)] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 2 of 2.** Replace:

```sql
  end loop;
  assert n = 43, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 45, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

**tests/sql/v16-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- Tiến lên (§7, §17): four players, fixed decks, the public RPCs; the clock through _card_tick ----------
-- A hand from its codes ("3S 10H"), the same sorted as card_hand shows it, a deck that deals these hands in seat order
-- (the other cards follow in card order), the money of the six accounts plus the room's tables, the Tiến lên row, the
-- balances by seat, the lines so far (half-stakes) and the last result (xu).
create function pg_temp.hand(p text) returns integer[] language sql immutable as $$
  select array_agg(pg_temp.c(x) order by n) from unnest(string_to_array(p, ' ')) with ordinality u(x, n)
$$;
create function pg_temp.sorted(p text) returns jsonb language sql immutable as $$
  select to_jsonb(array(select x from unnest(pg_temp.hand(p)) x order by x))
$$;
create function pg_temp.deck(variadic p text[]) returns integer[] language sql immutable as $$
  select d || array(select c from generate_series(0, 51) c where not (c = any(d)) order by c)
    from (select array_agg(x order by i, j) d
            from unnest(p) with ordinality h(s, i), unnest(pg_temp.hand(s)) with ordinality u(x, j)) z
$$;
create function pg_temp.total() returns bigint language sql as $$
  select pg_temp.money((select v from smoke where k = 'room')::uuid, array(select v::uuid from smoke where k ~ '^a[1-6]$'))
$$;
create function pg_temp.tt() returns public.card_tables language sql as $$
  select * from public.card_tables where room_id = (select v from smoke where k = 'room')::uuid and game = 'tienlen'
$$;
create function pg_temp.esc() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(seat::text, escrow), '{}') from public.card_seats
   where room_id = (select v from smoke where k = 'room')::uuid and game = 'tienlen'
$$;
create function pg_temp.plines() returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'h', l->'paid', l->'why') order by n), '[]')
    from jsonb_array_elements((pg_temp.tt()).pub->'lines') with ordinality e(l, n)
$$;
create function pg_temp.result() returns jsonb language sql as $$
  select jsonb_build_object('places', t.last->'places', 'out', t.last->'out', 'net', t.last->'net',
    'lines', (select coalesce(jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'xu', l->'paid', l->'why') order by n), '[]')
                from jsonb_array_elements(t.last->'lines') with ordinality e(l, n)))
    from pg_temp.tt() t
$$;
-- The deal that is due, at the table's deadline, with this deck.
create function pg_temp.deal(p_deck integer[]) returns public.card_tables language plpgsql as $$
declare r jsonb;
begin
  r := public._card_tick((select v from smoke where k = 'room')::uuid, (select v from smoke where k = 'a1')::uuid, 'tienlen',
                         (pg_temp.tt()).deadline, p_deck);
  assert (r->>'changed')::boolean, format('the deal: %s', r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the deal';
  return pg_temp.tt();
end $$;
-- A play (codes) or a pass (null) with the table's seq: an action answer, the seq moved on, and the money in place.
create function pg_temp.tl(p_token text, p_cards text) returns jsonb language plpgsql as $$
declare room uuid := (select v from smoke where k = 'room')::uuid; q integer := (pg_temp.tt()).seq; r jsonb;
begin
  if p_cards is null then
    r := public.tl_pass(room, p_token, q);
  else
    r := public.tl_play(room, p_token, q, pg_temp.hand(p_cards));
  end if;
  assert r ? 'state' and (r->'state'->>'seq')::int > q, format('%s: %s', coalesce(p_cards, 'pass'), r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, format('zero-sum after %s', coalesce(p_cards, 'pass'));
  return r;
end $$;
-- A move the state refuses: a soft bad_move with this error (R30), and nothing changes.
create function pg_temp.tl_bad(p_token text, p_cards text, p_error text) returns void language plpgsql as $$
declare room uuid := (select v from smoke where k = 'room')::uuid; q integer := (pg_temp.tt()).seq; r jsonb;
begin
  if p_cards is null then
    r := public.tl_pass(room, p_token, q);
  else
    r := public.tl_play(room, p_token, q, pg_temp.hand(p_cards));
  end if;
  assert pg_temp.env(r, 'bad_move', p_error), format('%s: %s, want %s', coalesce(p_cards, 'pass'), r, p_error);
  assert (pg_temp.tt()).seq = q, format('%s changed the table', coalesce(p_cards, 'pass'));
end $$;

-- Game 1 (Example 1): the first game and its `must`, the hard signals, stale, the refused moves, a cut chain across three
-- players, the settlement.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c6 text := (select v from smoke where k = 'c6');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a6 uuid := (select v from smoke where k = 'a6')::uuid; t public.card_tables; r jsonb; s jsonb; q integer;
begin
  perform pg_temp.set_coins(a, 100000) from unnest(array[a1, a2, a3, a4, a6]) a;
  insert into smoke values ('m', pg_temp.total()::text) on conflict (k) do update set v = excluded.v;
  perform public.card_sit(room, c1, 'tienlen', 1, 1000, null);
  perform public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  perform public.card_sit(room, c3, 'tienlen', 3, 1000, null);
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  t := pg_temp.deal(pg_temp.deck('3S 4H 5H 6H 7H 8H 9H 10H JH QH KH 2C 2D', '4S 5C 5D 6C 6D 7C 7D 8S 9S 10S JS QS KS',
                                 '5S AS AC AD AH 3C 3D 8C 9C 10C JC QC KC', '2H 2S 3H 4C 4D 6S 7S 8D 9D 10D JD QD KD'));
  -- the first game (R15): the holder of 3♠ leads, and the lead must include it
  assert t.phase = 'playing' and t.hand_no = 1 and t.turn = 1 and (t.pub->>'first')::boolean and (t.pub->>'must')::int = 0
         and t.pub->'order' = '[1, 2, 3, 4]' and (select bool_and(p.value->'n' = '13') from jsonb_each(t.pub->'players') p),
    format('the first game: %s', t.pub);
  assert pg_temp.esc() = '{"1": 10000, "2": 10000, "3": 10000, "4": 10000}' and pg_temp.coins(a1) = 90000
         and (select count(*) from public.coin_ledger where reason = 'card_hold' and ref = 'tl#1' and delta = -10000) = 4,
    'each player holds 10 S';
  -- the hands are private (§6.4, R25): card_hand shows the owner's cards only, and the state holds none
  r := public.card_hand(room, c1, 'tienlen');
  assert r->'cards' = pg_temp.sorted('3S 4H 5H 6H 7H 8H 9H 10H JH QH KH 2C 2D') and (r->>'seat')::int = 1, format('c1: %s', r);
  r := public.card_hand(room, c6, 'tienlen');
  assert r->'cards' = '[]' and r->'seat' = 'null', format('a spectator: %s', r);
  s := public.card_state(room, c1, 'tienlen');
  assert s = public.card_state(room, c6, 'tienlen'), 'every viewer reads the same state';
  assert (select array_agg(k order by k collate "C") from jsonb_object_keys(s->'pub') k)
         = array['chain', 'first', 'lines', 'must', 'order', 'passed', 'pile', 'players', 'top'], format('the public keys: %s', s->'pub');
  assert (select bool_and((select array_agg(k order by k collate "C") from jsonb_object_keys(p.value) k)
                          = array['id', 'n', 'out', 'paid', 'place', 'played', 'settled'])
            from jsonb_each(s->'pub'->'players') p), format('the players show counts, never cards: %s', s->'pub'->'players');
  -- the hard signal of tl_play (§11.5): an envelope in log mode, before any lock
  q := (pg_temp.tt()).seq;
  assert pg_temp.env(public.tl_play(room, c1, q, null), 'bad_cards', 'invalid cards'), 'null cards';
  assert pg_temp.env(public.tl_play(room, c1, q, '{}'), 'bad_cards', 'invalid cards'), 'no cards';
  assert pg_temp.env(public.tl_play(room, c1, q, array(select generate_series(0, 13))), 'bad_cards', 'invalid cards'), '14 cards';
  assert pg_temp.env(public.tl_play(room, c1, q, array[52]), 'bad_cards', 'invalid cards'), 'card 52';
  assert pg_temp.env(public.tl_play(room, c1, q, array[-1]), 'bad_cards', 'invalid cards'), 'card -1';
  assert pg_temp.env(public.tl_play(room, c1, q, array[0, 0]), 'bad_cards', 'invalid cards'), 'a card twice';
  assert pg_temp.env(public.tl_play(room, c1, q, array[0, null]), 'bad_cards', 'invalid cards'), 'a null card';
  assert pg_temp.env(public.tl_play(room, c1, q, '{{0, 1}, {2, 3}}'), 'bad_cards', 'invalid cards'), 'a 2-D array';
  assert (select count(*) from public.anticheat_events where account_id = a1 and code = 'bad_cards' and outcome = 'log_only'
            and rpc = 'tl_play') = 8, 'eight hard signals logged';
  -- stale (R24) and not seated are raised and never logged
  assert pg_temp.err(format('select public.tl_play(%L, %L, %s, array[0])', room, c1, q - 1)) = 'stale', 'an old seq';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, null)', room, c1)) = 'stale', 'no seq';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, %s)', room, c6, q)) = 'not seated', 'a spectator acts';
  -- well-formed moves the state refuses are soft (R30)
  perform pg_temp.tl_bad(c1, '4H', 'must include');
  perform pg_temp.tl_bad(c1, null, 'must play');
  perform pg_temp.tl_bad(c1, '3S 4H', 'invalid play');
  perform pg_temp.tl_bad(c1, '3C', 'invalid play');
  perform pg_temp.tl_bad(c2, '4S', 'not your turn');
  perform pg_temp.tl_bad(c2, null, 'not your turn');
  assert (select count(*) from public.anticheat_events where account_id in (a1, a2) and code = 'bad_move' and outcome = 'soft'
            and rpc in ('tl_play', 'tl_pass')) = 6, 'six soft signals';
  -- round 1: D's 2♥ is cut by B's 3 đôi thông, B by C's tứ quý; B pays C the chain when the round closes (R7)
  perform pg_temp.tl(c1, '3S');
  perform pg_temp.tl(c2, '4S');
  perform pg_temp.tl_bad(c3, '3C', 'cannot beat');
  perform pg_temp.tl(c3, '5S');
  perform pg_temp.tl(c4, '2H');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '5C 5D 6C 6D 7C 7D');
  assert (pg_temp.tt()).pub->'chain' = '{"h": 2, "victim": 4, "cutter": 2, "void": false}', format('the first cut: %s', (pg_temp.tt()).pub->'chain');
  perform pg_temp.tl(c3, 'AS AC AD AH');
  t := pg_temp.tt();
  assert t.pub->'chain' = '{"h": 5, "victim": 2, "cutter": 3, "void": false}' and t.turn = 4, format('the second cut: %s', t.pub);
  perform pg_temp.tl(c4, null);
  t := pg_temp.tt();
  assert t.turn = 2 and t.pub->'passed' = '[1, 4]', format('the passed seats are skipped: %s', t.pub->'passed');
  perform pg_temp.tl(c2, null);
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'chain' = 'null' and t.pub->'top' = 'null' and t.pub->'passed' = '[]' and t.pub->'pile' = '[]'
         and pg_temp.plines() = '[[2, 3, 5, 5, "chat"]]', format('the round closed: %s', t.pub);
  assert pg_temp.esc() = '{"1": 10000, "2": 7500, "3": 12500, "4": 10000}', format('the chain moved at once: %s', pg_temp.esc());
  -- round 2: a pair of 2s takes the round
  perform pg_temp.tl(c3, '3C 3D');
  perform pg_temp.tl(c4, null);
  perform pg_temp.tl(c1, '2C 2D');
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  assert (pg_temp.tt()).turn = 1, 'the pair of 2s leads';
  -- round 3: A goes out; everyone has played, so nobody is cóng; the next seat leads (hưởng sái)
  perform pg_temp.tl(c1, '4H 5H 6H 7H 8H 9H 10H JH QH KH');
  t := pg_temp.tt();
  assert t.pub->'players'->'1' @> '{"out": "done", "place": 1, "n": 0}' and t.turn = 2
         and not exists (select 1 from jsonb_each(t.pub->'players') p where p.value->>'out' = 'cong'), format('nhất: %s', t.pub);
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, null);
  assert (pg_temp.tt()).turn = 2, 'hưởng sái';
  -- round 4: B and C go out; D, still holding 2♠, is bét
  perform pg_temp.tl(c2, '8S 9S 10S JS QS KS');
  r := pg_temp.tl(c3, '8C 9C 10C JC QC KC');
  t := pg_temp.tt();
  assert t.phase = 'result' and t.turn is null and t.deadline = now() + interval '8 seconds' and t.lead_id = a1 and not t.first_game,
    format('the result: %s', to_jsonb(t));
  assert pg_temp.result() = '{"places": [1, 2, 3, 4], "out": {"1": "done", "2": "done", "3": "done"},
                              "net": {"1": 1000, "2": -2000, "3": 2500, "4": -1500},
                              "lines": [[2, 3, 2500, 2500, "chat"], [4, 1, 1000, 1000, "bet"], [3, 2, 500, 500, "ba"],
                                        [4, 3, 500, 500, "thoi"]]}', format('Example 1: %s', pg_temp.result());
  assert t.last->'hands' = jsonb_build_object('4', pg_temp.sorted('2S 3H 4C 4D 6S 7S 8D 9D 10D JD QD KD')),
    format('the cards still held: %s', t.last->'hands');
  assert pg_temp.coins(a1) = 101000 and pg_temp.coins(a2) = 98000 and pg_temp.coins(a3) = 102500 and pg_temp.coins(a4) = 98500
         and (r->>'coins')::int = 102500 and pg_temp.esc() = '{"1": 0, "2": 0, "3": 0, "4": 0}'
         and (select count(*) from public.coin_ledger where reason = 'card_settle' and ref = 'tl#1') = 4, 'everyone is paid out';
end $$;

-- Game 2: nhất leads; a chain of three cuts, the last a 4 đôi thông out of turn after passing (R9); D leaves while the
-- chain is open on it — the forfeit at once, capped at 10 S (R13, R14); `still leaving`; the others finish as three.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c6 text := (select v from smoke where k = 'c6');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        t public.card_tables; r jsonb;
begin
  t := pg_temp.deal(pg_temp.deck('2D 2H 6D 7D 8D 9D 10D JD QD KC KD AC AD', '6S 6C 7S 7C 8S 8C 9S 9C 10S JS QS KS AS',
                                 '3S 3C 3D 3H 6H 7H 8H 9H 10H JH QH KH AH', '4S 4C 4D 4H 5S 5C 5D 5H 2S 2C 10C JC QC'));
  assert t.hand_no = 2 and t.turn = 1 and not (t.pub->>'first')::boolean and t.pub->'must' = 'null', format('nhất leads: %s', t.pub);
  perform pg_temp.tl(c1, '2D 2H');
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, '3S 3C 3D 3H');
  perform pg_temp.tl(c4, '4S 4C 4D 4H');
  t := pg_temp.tt();
  assert t.turn = 1 and t.pub->'chain' = '{"h": 8, "victim": 3, "cutter": 4, "void": false}', format('two cuts: %s', t.pub);
  perform pg_temp.tl_bad(c3, '6H', 'not your turn');
  perform pg_temp.tl_bad(c2, '6S 6C 7S 7C 8S 8C', 'not your turn');
  perform pg_temp.tl(c2, '6S 6C 7S 7C 8S 8C 9S 9C');
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'passed' = '[]' and t.pub->'chain' = '{"h": 12, "victim": 4, "cutter": 2, "void": false}',
    format('4 đôi thông after passing: %s', t.pub);
  r := public.card_leave(room, c4, 'tienlen');
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the forfeit';
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'chain' = 'null' and t.pub->'players'->'4' @> '{"out": "forfeit", "settled": true, "paid": 20}'
         and pg_temp.plines() = '[[4, 2, 12, 12, "chat"], [4, 1, 2, 2, "forfeit"], [4, 2, 2, 2, "forfeit"],
                                  [4, 3, 2, 2, "forfeit"], [4, 1, 6, 2, "thoi"]]', format('the forfeit: %s', t.pub);
  assert pg_temp.esc() = '{"1": 12000, "2": 17000, "3": 11000, "4": 0}' and (r->>'coins')::int = 88500 and pg_temp.coins(a4) = 88500
         and (select leaving from public.card_seats where room_id = room and game = 'tienlen' and seat = 4)
         and not exists (select 1 from public.coin_ledger where account_id = a4 and ref = 'tl#2' and reason = 'card_settle'),
    format('D pays 10 S and leaves with nothing: %s', pg_temp.esc());
  -- the leaving row keeps the seat and the account's one seat in the room until the game ends (R2)
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, null)', room, c4, 'cao')) = 'still leaving', 'cao';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 100, 5000)', room, c4, 'poker')) = 'still leaving', 'poker';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 4, 1000, null)', room, c4, 'tienlen')) = 'still leaving', 'tienlen';
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 4, 1000, null)', room, c6, 'tienlen')) = 'table full', 'the seat is held';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, %s)', room, c4, (pg_temp.tt()).seq)) = 'not seated', 'D never acts again';
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, null);
  assert (pg_temp.tt()).turn = 2, 'the last cutter leads';
  perform pg_temp.tl(c2, '10S JS QS KS AS');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, null);
  assert (pg_temp.tt()).turn = 3, 'hưởng sái';
  perform pg_temp.tl(c3, '6H 7H 8H 9H 10H JH QH KH AH');
  t := pg_temp.tt();
  assert pg_temp.result() = '{"places": [2, 3, 1], "out": {"2": "done", "3": "done", "4": "forfeit"},
                              "net": {"1": 1000, "2": 8000, "3": 1000, "4": -10000},
                              "lines": [[4, 2, 6000, 6000, "chat"], [4, 1, 1000, 1000, "forfeit"], [4, 2, 1000, 1000, "forfeit"],
                                        [4, 3, 1000, 1000, "forfeit"], [4, 1, 3000, 1000, "thoi"], [1, 2, 1000, 1000, "bet"]]}',
    format('a smaller game: %s', pg_temp.result());
  assert t.last->'hands' = jsonb_build_object('1', pg_temp.sorted('6D 7D 8D 9D 10D JD QD KC KD AC AD'),
                                              '4', pg_temp.sorted('5S 5C 5D 5H 2S 2C 10C JC QC')), format('hands: %s', t.last->'hands');
  assert t.lead_id = a2 and not exists (select 1 from public.card_seats where room_id = room and account_id = a4),
    'the leaving row goes when the game ends';
  assert pg_temp.coins(a1) = 102000 and pg_temp.coins(a2) = 106000 and pg_temp.coins(a3) = 103500, 'paid out';
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
end $$;

-- Game 3 (Example 3): C is dealt 6 đôi — tới trắng; the next deal is a first game (R10, R15).
do $$
declare t public.card_tables; d timestamptz := (pg_temp.tt()).deadline;
begin
  t := pg_temp.deal(pg_temp.deck('3D 4S 5D 6S 7D 8S 9D 10S JD QS KD 2C 2D', '3H 4C 4D 5H 6C 6D 7H 8C 8D AS AC AD AH',
                                 '3S 3C 5S 5C 7S 7C 9S 9C JS JC KS KC 2S', '4H 6H 8H 9H 10C 10D 10H JH QC QD QH KH 2H'));
  assert t.hand_no = 3 and t.phase = 'result' and t.turn is null and t.deadline = d + interval '8 seconds'
         and t.first_game and t.lead_id is null, format('tới trắng: %s', to_jsonb(t));
  assert t.last->'trang' = jsonb_build_object('seat', 3, 'pattern', 'sau_doi',
                                              'cards', pg_temp.sorted('3S 3C 5S 5C 7S 7C 9S 9C JS JC KS KC 2S'))
         and t.last->'hands' = jsonb_build_object('3', pg_temp.sorted('3S 3C 5S 5C 7S 7C 9S 9C JS JC KS KC 2S')),
    format('the winner''s cards: %s', t.last);
  assert pg_temp.result() = '{"places": [], "out": {}, "net": {"1": -2000, "2": -2000, "3": 6000, "4": -2000},
                              "lines": [[4, 3, 2000, 2000, "trang"], [1, 3, 2000, 2000, "trang"], [2, 3, 2000, 2000, "trang"]]}',
    format('Example 3: %s', pg_temp.result());
  assert pg_temp.esc() = '{"1": 0, "2": 0, "3": 0, "4": 0}', 'everyone is paid out';
end $$;

-- Game 4: a first game again (3♠ leads with `must`, although B was the last nhất); three cóng, placed in turn order from
-- nhất, the farthest bét (R11). Then nhất leaves.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        a4 uuid := (select v from smoke where k = 'a4')::uuid; t public.card_tables; r jsonb;
begin
  t := pg_temp.deal(pg_temp.deck('4S 5S 6S 7S 8S 9S 10S JS QS KS AS AC 2H', '4C 5C 6C 7C 8C 9C 10C JC QC KC AD AH 2S',
                                 '3H 4D 5D 6D 7D 8D 9D 10D JD QD KD 2C 2D', '3S 3C 3D 4H 5H 6H 7H 8H 9H 10H JH QH KH'));
  assert t.hand_no = 4 and t.turn = 4 and (t.pub->>'first')::boolean and (t.pub->>'must')::int = 0, format('3♠ leads: %s', t.pub);
  perform pg_temp.tl_bad(c4, '4H', 'must include');
  perform pg_temp.tl(c4, '3S 3C 3D');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, '4H 5H 6H 7H 8H 9H 10H JH QH KH');
  assert pg_temp.result() = '{"places": [4, 1, 2, 3], "out": {"1": "cong", "2": "cong", "3": "cong", "4": "done"},
                              "net": {"1": -3000, "2": -2500, "3": -3500, "4": 9000},
                              "lines": [[1, 4, 3000, 3000, "cong"], [2, 4, 2500, 2500, "cong"], [3, 4, 3500, 3500, "cong"]]}',
    format('three cóng: %s', pg_temp.result());
  r := public.card_leave(room, c4, 'tienlen');
  assert jsonb_array_length(r->'state'->'seats') = 3 and (pg_temp.tt()).lead_id = a4, 'nhất stood up between games';
end $$;

-- Game 5: three players, a first game because the last nhất left (R15); reads never apply a deadline (R37); two
-- timeouts in a row forfeit B before anyone has gone out: C, who has played nothing, is paid and not made cóng — until A
-- goes out (R11, R13, R28).
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); a2 uuid := (select v from smoke where k = 'a2')::uuid;
        t public.card_tables; r jsonb; s jsonb; v0 bigint;
begin
  t := pg_temp.deal(pg_temp.deck('3S 4S 3C 4C 5H 6H 7H 8H 9H 10H JH QH KH', '2D 3D 5S 6S 7S 8S 9S 10S JS QS KS AS AC',
                                 '2C 3H 4D 4H 5C 6C 7C 8C 9C 10C JC QC KC'));
  assert t.hand_no = 5 and t.pub->'order' = '[1, 2, 3]' and t.turn = 1 and (t.pub->>'first')::boolean
         and (t.pub->>'must')::int = 0 and (select count(*) from public.card_hands where room_id = room and game = 'tienlen') = 3,
    format('three players: %s', t.pub);
  perform pg_temp.tl(c1, '3S');
  update public.card_tables set deadline = now() - interval '1 second' where room_id = room and game = 'tienlen';
  v0 := (pg_temp.tt()).v;
  s := public.card_state(room, c1, 'tienlen');
  perform public.card_hand(room, c2, 'tienlen');
  perform public.card_lobby(room, c3);
  assert s->>'phase' = 'playing' and (s->>'turn')::int = 2 and (s->>'v')::bigint = v0 and (pg_temp.tt()).v = v0
         and (pg_temp.tt()).turn = 2, 'a read past the deadline changes nothing';
  r := public.card_tick(room, c1, 'tienlen');
  assert (r->>'changed')::boolean and (r->'state'->>'turn')::int = 3 and r->'state'->'pub'->'passed' = '[2]'
         and (select missed from public.card_seats where room_id = room and game = 'tienlen' and seat = 2) = 1,
    format('the tick passes for B: %s', r->'state');
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the timeout';
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, '4S');
  update public.card_tables set deadline = now() - interval '1 second' where room_id = room and game = 'tienlen';
  r := public.card_tick(room, c1, 'tienlen');
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the forfeit';
  t := pg_temp.tt();
  assert t.turn = 3 and t.pub->'players'->'2' @> '{"out": "forfeit", "settled": true}'
         and t.pub->'players'->'3' @> '{"out": null, "played": false}'
         and pg_temp.plines() = '[[2, 3, 2, 2, "forfeit"], [2, 1, 2, 2, "forfeit"], [2, 3, 2, 2, "thoi"]]',
    format('B forfeits, the turn moves on: %s', t.pub);
  assert (select leaving and escrow = 0 and missed = 2 from public.card_seats where room_id = room and game = 'tienlen' and seat = 2)
         and pg_temp.coins(a2) = 98500, 'B is paid out at once';
  assert pg_temp.err(format('select public.tl_pass(%L, %L, %s)', room, c2, t.seq)) = 'not seated', 'B never plays or passes again';
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c1, '3C 4C 5H 6H 7H 8H 9H 10H JH QH KH');
  assert pg_temp.result() = '{"places": [1, 3], "out": {"1": "done", "2": "forfeit", "3": "cong"},
                              "net": {"1": 3500, "2": -3000, "3": -500},
                              "lines": [[2, 3, 1000, 1000, "forfeit"], [2, 1, 1000, 1000, "forfeit"], [2, 3, 1000, 1000, "thoi"],
                                        [3, 1, 2500, 2500, "cong"]]}', format('cóng at the first go-out: %s', pg_temp.result());
  assert (select count(*) from public.card_log where room_id = room and game = 'tienlen' and hand_no = 5 and action = 'timeout') = 2,
    'the timeouts are logged';
end $$;

-- Game 6 (Example 4): A goes out, D leaves holding 2♥ — 1 S to B and C, the thối of 2♥ to B — and B, C finish.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        t public.card_tables; r jsonb;
begin
  perform public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  t := pg_temp.deal(pg_temp.deck('3D 2S 3C 4C 5C 6C 7C 8C 9C 10C JC QC KC', '5D 6S 7S 8S 9S 10S JS QS KS AS AC 2C 2D',
                                 '3S 3H 4S 4D 5S 6D 7D 8D 9D 10D JD QD KD', '2H 4H 5H 6H 7H 8H 9H 10H JH QH KH AD AH'));
  assert t.hand_no = 6 and t.turn = 1 and not (t.pub->>'first')::boolean, format('A leads: %s', t.pub);
  perform pg_temp.tl(c1, '3D');
  perform pg_temp.tl(c2, '5D');
  perform pg_temp.tl(c3, '6D');
  perform pg_temp.tl(c4, '7H');
  perform pg_temp.tl(c1, '2S');
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, null);
  perform pg_temp.tl(c1, '3C 4C 5C 6C 7C 8C 9C 10C JC QC KC');
  r := public.card_leave(room, c4, 'tienlen');
  assert pg_temp.plines() = '[[4, 2, 2, 2, "forfeit"], [4, 3, 2, 2, "forfeit"], [4, 2, 2, 2, "thoi"]]'
         and (r->>'coins')::int = 92500 and (pg_temp.tt()).turn = 2, format('Example 4''s forfeit: %s', pg_temp.plines());
  perform pg_temp.tl(c2, null);
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c2, 'AS AC');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c2, '2C 2D');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c2, '6S 7S 8S 9S 10S JS QS KS');
  assert pg_temp.result() = '{"places": [1, 2, 3], "out": {"1": "done", "2": "done", "4": "forfeit"},
                              "net": {"1": 1000, "2": 2000, "3": 0, "4": -3000},
                              "lines": [[4, 2, 1000, 1000, "forfeit"], [4, 3, 1000, 1000, "forfeit"], [4, 2, 1000, 1000, "thoi"],
                                        [3, 1, 1000, 1000, "bet"]]}', format('Example 4: %s', pg_temp.result());
end $$;

-- Game 7: C and D are banned mid-game; one sweep forfeits them together and they pay each other nothing (R13, anti-cheat
-- R10); A and B finish as two.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        t public.card_tables; r jsonb;
begin
  perform public.card_sit(room, c4, 'tienlen', 4, 1000, null);
  t := pg_temp.deal(pg_temp.deck('3S 3H 4S 5S 5C 6C 7C 8C 9C 10C JC QC KC', '4D 6S 7S 8S 9S 10S JS QS KS AS AC AD AH',
                                 '3D 4C 5D 6D 7D 8D 9D 10D JD QD KD 2C 2D', '3C 4H 5H 6H 7H 8H 9H 10H JH QH KH 2S 2H'));
  assert t.hand_no = 7 and t.turn = 1, 'A leads';
  perform pg_temp.tl(c1, '3S');
  perform pg_temp.tl(c2, '4D');
  perform pg_temp.tl(c3, null);
  perform pg_temp.tl(c4, null);
  perform pg_temp.tl(c1, null);
  update public.accounts set is_banned = true where id in (a3, a4);
  r := public.card_tick(room, c1, 'tienlen');
  update public.accounts set is_banned = false where id in (a3, a4);
  assert (r->>'changed')::boolean and pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'the sweep';
  t := pg_temp.tt();
  assert t.turn = 2 and pg_temp.plines() = '[[3, 1, 2, 2, "forfeit"], [3, 2, 2, 2, "forfeit"], [3, 1, 3, 3, "thoi"],
                                             [4, 1, 2, 2, "forfeit"], [4, 2, 2, 2, "forfeit"], [4, 1, 3, 3, "thoi"]]',
    format('swept together: %s', t.pub);
  assert (select count(*) from public.card_log where room_id = room and game = 'tienlen' and hand_no = 7 and action = 'leave'
            and detail->>'how' = 'sweep') = 2, 'both leave by the sweep';
  perform pg_temp.tl(c2, 'AS AC AD AH');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '6S 7S 8S 9S 10S JS QS KS');
  assert pg_temp.result() = '{"places": [2, 1], "out": {"2": "done", "3": "forfeit", "4": "forfeit"},
                              "net": {"1": 4000, "2": 3000, "3": -3500, "4": -3500},
                              "lines": [[3, 1, 1000, 1000, "forfeit"], [3, 2, 1000, 1000, "forfeit"], [3, 1, 1500, 1500, "thoi"],
                                        [4, 1, 1000, 1000, "forfeit"], [4, 2, 1000, 1000, "forfeit"], [4, 1, 1500, 1500, "thoi"],
                                        [1, 2, 1000, 1000, "bet"]]}', format('two players finish: %s', pg_temp.result());
end $$;

-- Game 8: the table empties and resets (R36); a third seat unseen for 60 s is stood up at the deal (R28); two players,
-- 3♠ undealt, so 3♣ leads (R15).
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c6 text := (select v from smoke where k = 'c6');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a6 uuid := (select v from smoke where k = 'a6')::uuid; t public.card_tables;
begin
  perform public.card_leave(room, c1, 'tienlen');
  perform public.card_leave(room, c2, 'tienlen');
  t := pg_temp.tt();
  assert t.stake is null and t.first_game and t.lead_id is null and t.phase = 'idle', 'the empty table reset';
  perform public.card_sit(room, c1, 'tienlen', 1, 1000, null);
  perform public.card_sit(room, c2, 'tienlen', 2, 1000, null);
  perform public.card_sit(room, c6, 'tienlen', 3, 1000, null);
  update public.card_seats set seen_at = now() - interval '2 minutes' where room_id = room and account_id = a6;
  t := pg_temp.deal(pg_temp.deck('3C 5S 6S 7S 8S 9S 10S JS QS KS AS AC AH', '2H 2D 3D 4D 5D 6D 7D 8D 9D 10D JD QD KD'));
  assert t.hand_no = 8 and t.pub->'order' = '[1, 2]' and t.turn = 1 and (t.pub->>'must')::int = 1
         and not exists (select 1 from public.card_seats where room_id = room and account_id = a6)
         and (select count(*) from public.card_log where room_id = room and account_id = a6 and action = 'leave'
                and detail->>'how' = 'idle') = 1, format('two players, 3♣ leads: %s', t.pub);
  perform pg_temp.tl_bad(c1, '5S', 'must include');
  perform pg_temp.tl(c1, '3C');
  perform pg_temp.tl(c2, '2H');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '3D 4D 5D 6D 7D 8D 9D 10D JD QD KD');
  perform pg_temp.tl(c1, null);
  perform pg_temp.tl(c2, '2D');
  assert pg_temp.result() = '{"places": [2, 1], "out": {"2": "done"}, "net": {"1": -1000, "2": 1000},
                              "lines": [[1, 2, 1000, 1000, "bet"]]}', format('a 2-player game: %s', pg_temp.result());
  perform public.card_leave(room, c1, 'tienlen');
  perform public.card_leave(room, c2, 'tienlen');
  assert not exists (select 1 from public.card_seats where room_id = room)
         and pg_temp.total() = (select v from smoke where k = 'm')::bigint
         and pg_temp.coins(a1) = 104500 and pg_temp.coins(a2) = 104500 and pg_temp.coins(a3) = 102000
         and pg_temp.coins(a4) = 89000 and pg_temp.coins(a6) = 100000, 'eight games, zero-sum';
end $$;

select 'v16 tienlen smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` — the guard loop now calls `tl_play`: `function public.tl_play(unknown, unknown, integer, integer[]) does not exist` in the log.

- [ ] **Step 3: Write the Tiến lên engine and its RPCs**

**supabase/migrations/0017_v16_cards.sql — edit 1 of 12.** Replace:

```sql

-- Pay one seat out (§6.2): its balance (Tiến lên, Cào) or its stack (poker) goes to its wallet with p_reason, and the seat
```

with:

```sql

-- Lock the wallets of every seat at a table in account-id order (§11.6), before a hand's money moves.
create or replace function public._card_lock_wallets(p_room uuid, p_game text) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record;
begin
  for r in select account_id from public.card_seats where room_id = p_room and game = p_game order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
end $$;

-- Pay one seat out (§6.2): its balance (Tiến lên, Cào) or its stack (poker) goes to its wallet with p_reason, and the seat
```

**supabase/migrations/0017_v16_cards.sql — edit 2 of 12.** Replace:

```sql

-- The leave operation (§6.3), for one seat: a seat that is not in the live hand is paid out (a poker stack is cashed
-- out) and goes at once; the last seat to go resets the table. p_how: leave, timeout, sweep or forfeit_all.
create or replace function public._card_leave_seat(p_room uuid, p_game text, p_seat integer, p_how text, p_now timestamptz)
```

with:

```sql

-- The leave operation for seats in the live hand (§6.3), the table's wallets locked first: each game's own rules.
create or replace function public._card_leave_live(p_room uuid, p_game text, p_seats integer[], p_how text, p_now timestamptz)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._card_lock_wallets(p_room, p_game);
  if p_game = 'tienlen' then
    perform public._tl_leave(p_room, p_seats, p_how, p_now);
  end if;
end $$;

-- The step that is due at a table (§10), by game: true when it changed anything.
create or replace function public._card_due(p_room uuid, p_game text, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
begin
  if p_game = 'tienlen' then
    return public._tl_due(p_room, p_now, p_deck);
  end if;
  return false;
end $$;

-- The leave operation (§6.3), for one seat: a seat in the live hand leaves by its game's rules (_card_leave_live); any
-- other seat is paid out (a poker stack is cashed out) and goes at once, and the last seat to go resets the table.
-- p_how: leave, timeout, sweep, idle (stood up at a deal, R28) or forfeit_all.
create or replace function public._card_leave_seat(p_room uuid, p_game text, p_seat integer, p_how text, p_now timestamptz)
```

**supabase/migrations/0017_v16_cards.sql — edit 3 of 12.** Replace:

```sql
  end if;
  select hand_no into v_hand from public.card_tables where room_id = p_room and game = p_game;
```

with:

```sql
  end if;
  if public._card_live(p_room, p_game, p_seat) then
    perform public._card_leave_live(p_room, p_game, array[p_seat], p_how, p_now);
    return;
  end if;
  select hand_no into v_hand from public.card_tables where room_id = p_room and game = p_game;
```

**supabase/migrations/0017_v16_cards.sql — edit 4 of 12.** Replace:

```sql

-- Several seats leave together, as one sweep removes them (§6.3): their wallets are locked in account-id order first.
create or replace function public._card_leave_seats(p_room uuid, p_game text, p_seats integer[], p_how text, p_now timestamptz)
```

with:

```sql

-- Several seats leave together, as one sweep removes them (§6.3, R13): the table's wallets are locked in account-id
-- order first; the seats in the live hand leave in one go, then the others.
create or replace function public._card_leave_seats(p_room uuid, p_game text, p_seats integer[], p_how text, p_now timestamptz)
```

**supabase/migrations/0017_v16_cards.sql — edit 5 of 12.** Replace:

```sql
as $$
declare r record; v_seat integer;
begin
  for r in select account_id from public.card_seats where room_id = p_room and game = p_game and seat = any(p_seats)
            order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  foreach v_seat in array p_seats loop
    perform public._card_leave_seat(p_room, p_game, v_seat, p_how, p_now);
  end loop;
```

with:

```sql
as $$
declare v_live integer[]; v_seat integer;
begin
  perform public._card_lock_wallets(p_room, p_game);
  v_live := array(select x from unnest(p_seats) x where public._card_live(p_room, p_game, x) order by x);
  if cardinality(v_live) > 0 then
    perform public._card_leave_live(p_room, p_game, v_live, p_how, p_now);
  end if;
  foreach v_seat in array p_seats loop
    if not (v_seat = any(v_live)) then
      perform public._card_leave_seat(p_room, p_game, v_seat, p_how, p_now);
    end if;
  end loop;
```

**supabase/migrations/0017_v16_cards.sql — edit 6 of 12.** Replace:

```sql
    v_changed := true;
  end if;
```

with:

```sql
    v_changed := true;
  end if;
  if (select deadline from public.card_tables where room_id = p_room and game = p_game) <= p_now then
    if public._card_due(p_room, p_game, p_now, p_deck) then
      v_changed := true;
    end if;
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 7 of 12.** Replace:

```sql

revoke all on function public._card_init(uuid) from public, anon, authenticated;
```

with:

```sql

-- A game action (§11.3): the lock, the sweep, the caller's seat and the seq (R24), then the move. A move the state refuses
-- is a soft bad_move (R30): logged and answered with the envelope, and nothing moves. A real action resets the misses.
create or replace function public._card_action(p_room uuid, p_account uuid, p_game text, p_kind text, p_seq integer,
                                               p_args jsonb, p_now timestamptz, p_deck integer[] default null) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_seat integer; v_err text;
begin
  perform public._card_open(p_room, p_game);
  perform public._card_touch(p_room, p_account, p_now);
  perform public._card_sweep(p_room, p_game, p_now, p_deck);
  select seat into v_seat from public.card_seats
   where room_id = p_room and game = p_game and account_id = p_account and not leaving;
  if v_seat is null then
    raise exception 'not seated' using errcode = '22023';
  end if;
  if p_seq is distinct from (select seq from public.card_tables where room_id = p_room and game = p_game) then
    raise exception 'stale' using errcode = '22023';
  end if;
  if p_kind = 'tl_play' then
    v_err := public._tl_do_play(p_room, v_seat, public._card_ints(p_args->'cards'), p_now);
  elsif p_kind = 'tl_pass' then
    v_err := public._tl_do_pass(p_room, v_seat, p_now);
  end if;
  if v_err is not null then
    return public._ac_flag(p_account, 'bad_move', p_kind,
                           jsonb_build_object('game', p_game, 'seat', v_seat, 'seq', p_seq) || coalesce(p_args, '{}'::jsonb),
                           p_room, v_err, false);
  end if;
  update public.card_seats set missed = 0
   where room_id = p_room and game = p_game and seat = v_seat and account_id = p_account;
  perform public._card_bump(p_room, p_game, true);
  return public._card_answer(p_room, p_game, p_account, p_now);
end $$;

revoke all on function public._card_init(uuid) from public, anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 8 of 12.** Replace:

```sql
revoke all on function public._card_answer(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_payout(uuid, text, integer, text) from public, anon, authenticated;
```

with:

```sql
revoke all on function public._card_answer(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._card_lock_wallets(uuid, text) from public, anon, authenticated;
revoke all on function public._card_payout(uuid, text, integer, text) from public, anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 9 of 12.** Replace:

```sql
revoke all on function public._card_live(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._card_leave_seat(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
```

with:

```sql
revoke all on function public._card_live(uuid, text, integer) from public, anon, authenticated;
revoke all on function public._card_leave_live(uuid, text, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_due(uuid, text, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._card_leave_seat(uuid, text, integer, text, timestamptz) from public, anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 10 of 12.** Replace:

```sql
revoke all on function public._card_tick(uuid, uuid, text, timestamptz, integer[]) from public, anon, authenticated;
```

with:

```sql
revoke all on function public._card_tick(uuid, uuid, text, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._card_action(uuid, uuid, text, text, integer, jsonb, timestamptz, integer[])
  from public, anon, authenticated;

-- ---------- D. The engines (§7.3, §8.2, §9.2): each step takes p_now, each deal p_deck ----------
-- Tiến lên (§7). The cards each seat of the current hand holds now ({seat: [c…]}), for thối.
create or replace function public._tl_hands(p_room uuid) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(jsonb_object_agg(h.seat::text, to_jsonb(h.cards)), '{}'::jsonb)
    from public.card_hands h
    join public.card_tables t on t.room_id = h.room_id and t.game = h.game and t.hand_no = h.hand_no
   where h.room_id = p_room and h.game = 'tienlen'
$$;

-- The active seats (§7.3): dealt, still holding cards, neither out, cóng nor forfeited; in turn order.
create or replace function public._tl_active(p_pub jsonb) returns integer[]
language sql immutable set search_path = public, extensions
as $$
  select coalesce(array_agg(s order by s), '{}') from unnest(public._card_ints(p_pub->'order')) s
   where p_pub->'players'->(s::text)->>'out' is null
$$;

-- One money event (§7.5) on the table's pub: _tl_money gives the next pub, and its new lines move their paid amounts
-- (half-stakes × S / 2) between the seats' balances at once (§6.2). Returns the stored pub.
create or replace function public._tl_event(p_room uuid, p_ev jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; l jsonb; x integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  v_pub := public._tl_money(t.pub, p_ev, public._tl_hands(p_room));
  for l in select e.value from jsonb_array_elements(v_pub->'lines') with ordinality e(value, n)
            where e.n > coalesce(jsonb_array_length(t.pub->'lines'), 0) loop
    x := (l->>'paid')::int * t.stake / 2;
    update public.card_seats set escrow = escrow - x
     where room_id = p_room and game = 'tienlen' and seat = (l->>'from')::int
       and account_id = (v_pub->'players'->(l->>'from')->>'id')::uuid;
    update public.card_seats set escrow = escrow + x
     where room_id = p_room and game = 'tienlen' and seat = (l->>'to')::int
       and account_id = (v_pub->'players'->(l->>'to')->>'id')::uuid;
  end loop;
  update public.card_tables set pub = v_pub where room_id = p_room and game = 'tienlen';
  return v_pub;
end $$;

-- A game's result (§11.4): the places, the outs, the cards still held (the tới trắng hand alone), the lines and nets in xu.
create or replace function public._tl_last(p_room uuid, p_trang jsonb) returns jsonb
language sql stable security definer set search_path = public, extensions
as $$
  select jsonb_build_object(
    'hand_no', t.hand_no, 'trang', p_trang,
    'places', coalesce((select jsonb_agg(p.key::int order by (p.value->>'place')::int) from jsonb_each(t.pub->'players') p
                         where p.value->>'place' is not null), '[]'::jsonb),
    'out', coalesce((select jsonb_object_agg(p.key, p.value->'out') from jsonb_each(t.pub->'players') p
                      where p.value->>'out' is not null), '{}'::jsonb),
    'hands', case when p_trang is not null then jsonb_build_object(p_trang->>'seat', p_trang->'cards')
             else coalesce((select jsonb_object_agg(h.seat::text, to_jsonb(h.cards)) from public.card_hands h
                             where h.room_id = p_room and h.game = 'tienlen' and h.hand_no = t.hand_no
                               and cardinality(h.cards) > 0), '{}'::jsonb) end,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('from', l->'from', 'to', l->'to', 'xu', (l->>'h')::int * t.stake / 2,
                                                           'paid', (l->>'paid')::int * t.stake / 2, 'why', l->'why') order by n)
                         from jsonb_array_elements(t.pub->'lines') with ordinality e(l, n)), '[]'::jsonb),
    'net', (select jsonb_object_agg(q, coalesce((select sum(case when l->>'to' = q then (l->>'paid')::int else -(l->>'paid')::int end)
                                                   from jsonb_array_elements(t.pub->'lines') l
                                                  where q in (l->>'from', l->>'to')), 0) * t.stake / 2)
              from jsonb_array_elements_text(t.pub->'order') q))
  from public.card_tables t where t.room_id = p_room and t.game = 'tienlen'
$$;

-- The deal (§7.3, §7.6): the table's wallets locked in account-id order, then the unseen (R28) and those short of 10 S
-- stand up; fewer than two players → idle. 10 S held from each; 13 cards each in seat order; the leader (R15); tới trắng.
create or replace function public._tl_deal(p_room uuid, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; r record; v_seats integer[]; v_deck integer[]; v_hand integer; i integer; v_cards integer[];
        v_first boolean; v_low integer; v_leader integer; v_best integer; v_rank integer := 0; v_r integer; s integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  perform public._card_lock_wallets(p_room, 'tienlen');
  for r in select cs.seat from public.card_seats cs left join public.wallets w on w.account_id = cs.account_id
            where cs.room_id = p_room and cs.game = 'tienlen' and not cs.leaving
              and (cs.seen_at < p_now - interval '60 seconds' or coalesce(w.coins, 0) < 10 * t.stake)
            order by cs.seat loop
    perform public._card_leave_seat(p_room, 'tienlen', r.seat, 'idle', p_now);
  end loop;
  v_seats := array(select seat from public.card_seats where room_id = p_room and game = 'tienlen' and not leaving order by seat);
  if cardinality(v_seats) < 2 then
    update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
     where room_id = p_room and game = 'tienlen';
    return true;
  end if;
  v_deck := coalesce(p_deck, public._card_shuffle());
  v_hand := t.hand_no + 1;
  delete from public.card_hands where room_id = p_room and game = 'tienlen';
  delete from public.card_secrets where room_id = p_room and game = 'tienlen';
  for i in 1..cardinality(v_seats) loop
    v_cards := array(select c from unnest(v_deck[13 * i - 12 : 13 * i]) c order by c);
    insert into public.card_hands (room_id, game, hand_no, seat, account_id, dealt, cards)
    select p_room, 'tienlen', v_hand, v_seats[i], account_id, v_cards, v_cards
      from public.card_seats where room_id = p_room and game = 'tienlen' and seat = v_seats[i];
  end loop;
  for r in select seat, account_id from public.card_seats where room_id = p_room and game = 'tienlen' and seat = any(v_seats)
            order by seat loop
    perform public._pay(r.account_id, -10 * t.stake, 'card_hold', public._card_ref('tienlen', v_hand));
    update public.card_seats set escrow = 10 * t.stake where room_id = p_room and game = 'tienlen' and seat = r.seat;
  end loop;
  -- the first game, a game after tới trắng, or one the last nhất is not dealt into: the lowest dealt card leads (R15)
  v_first := t.first_game or not exists (select 1 from public.card_seats where room_id = p_room and game = 'tienlen'
                                            and account_id = t.lead_id and seat = any(v_seats));
  v_low := (select min(c) from public.card_hands h, unnest(h.cards) c where h.room_id = p_room and h.game = 'tienlen');
  v_leader := case when v_first
                then (select seat from public.card_hands where room_id = p_room and game = 'tienlen' and v_low = any(cards))
                else (select seat from public.card_seats where room_id = p_room and game = 'tienlen' and account_id = t.lead_id) end;
  update public.card_tables
     set hand_no = v_hand, phase = 'playing', turn = v_leader, deadline = p_now + interval '20 seconds',
         pub = jsonb_build_object(
           'first', v_first, 'must', case when v_first then v_low end, 'order', to_jsonb(v_seats),
           'players', (select jsonb_object_agg(cs.seat::text, jsonb_build_object('id', cs.account_id, 'n', 13, 'played', false,
                                                 'out', null, 'place', null, 'paid', 0, 'settled', false))
                         from public.card_seats cs where cs.room_id = p_room and cs.game = 'tienlen' and cs.seat = any(v_seats)),
           'top', null, 'passed', '[]'::jsonb, 'pile', '[]'::jsonb, 'chain', null, 'lines', '[]'::jsonb)
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', v_hand, null, null, 'deal',
    jsonb_build_object('hands', (select jsonb_object_agg(seat::text, to_jsonb(dealt)) from public.card_hands
                                  where room_id = p_room and game = 'tienlen'), 'leader', v_leader, 'first', v_first), p_now);
  delete from public.card_log where id in (select id from public.card_log where at < p_now - interval '14 days' order by at limit 500);
  -- tới trắng (§7.4): the best pattern wins; the same pattern goes to the first in turn order from the leader
  foreach s in array array[v_leader] || public._card_after(v_seats, v_leader) loop
    v_r := public._tl_trang_rank(public._tl_trang((select cards from public.card_hands
                                                     where room_id = p_room and game = 'tienlen' and seat = s)));
    if v_r > v_rank then
      v_rank := v_r;
      v_best := s;
    end if;
  end loop;
  if v_best is not null then
    perform public._tl_do_trang(p_room, v_best, p_now);
  end if;
  return true;
end $$;

-- Tới trắng (§7.3 trang()): every other player pays 2 S, every seat is paid out, and the next deal is a first game (R15).
create or replace function public._tl_do_trang(p_room uuid, p_seat integer, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_cards integer[]; v_hand integer;
begin
  select cards, hand_no into v_cards, v_hand from public.card_hands where room_id = p_room and game = 'tienlen' and seat = p_seat;
  perform public._tl_event(p_room, jsonb_build_object('k', 'trang', 'seat', p_seat));
  update public.card_tables
     set last = public._tl_last(p_room, jsonb_build_object('seat', p_seat, 'pattern', public._tl_trang(v_cards),
                                                           'cards', to_jsonb(v_cards)))
   where room_id = p_room and game = 'tienlen';
  perform public._card_settle(p_room, 'tienlen');
  update public.card_tables
     set first_game = true, lead_id = null, phase = 'result', turn = null, deadline = p_now + interval '8 seconds'
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', v_hand, null, p_seat, 'trang',
                           jsonb_build_object('pattern', public._tl_trang(v_cards)), p_now);
end $$;

-- The next turn (§7.3 advance): the first seat after p_from that is active, does not own the top and has not passed;
-- nobody left closes the round.
create or replace function public._tl_advance(p_room uuid, p_from integer, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pub jsonb; v_cand integer[]; v_turn integer;
begin
  select pub into v_pub from public.card_tables where room_id = p_room and game = 'tienlen';
  v_cand := array(select s from unnest(public._tl_active(v_pub)) s
                   where s is distinct from (v_pub->'top'->>'seat')::int and not (s = any(public._card_ints(v_pub->'passed'))));
  if cardinality(v_cand) = 0 then
    perform public._tl_close(p_room, p_now);
    return;
  end if;
  v_turn := (select s from unnest(public._card_after(public._card_ints(v_pub->'order'), p_from)) with ordinality u(s, n)
              where s = any(v_cand) order by n limit 1);
  update public.card_tables set turn = v_turn, deadline = p_now + interval '20 seconds'
   where room_id = p_room and game = 'tienlen';
end $$;

-- The round closes (§7.3 close_round): the chain is paid, and the top's owner leads — or, when it went out, the next
-- active seat after it ("hưởng sái").
create or replace function public._tl_close(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pub jsonb; v_top integer; v_turn integer;
begin
  v_pub := public._tl_event(p_room, '{"k": "close"}'::jsonb);
  v_top := (v_pub->'top'->>'seat')::int;
  v_turn := case when v_pub->'players'->(v_top::text)->>'out' is null then v_top
                 else (select s from unnest(public._card_after(public._card_ints(v_pub->'order'), v_top)) with ordinality u(s, n)
                        where v_pub->'players'->(s::text)->>'out' is null order by n limit 1) end;
  update public.card_tables
     set pub = v_pub || jsonb_build_object('top', null, 'passed', '[]'::jsonb, 'pile', '[]'::jsonb),
         turn = v_turn, deadline = p_now + interval '20 seconds'
   where room_id = p_room and game = 'tienlen';
end $$;

-- A play (§7.3 play): the refusal of a move that is not legal (a bad_move, §11.5), else null. In turn: any combination to
-- lead (a first game's lead includes `must`), or one that beats the top. Out of turn: only a 4 đôi thông that beats the
-- top (R9). A bomb over a heo combination or another bomb cuts (§7.2).
create or replace function public._tl_do_play(p_room uuid, p_seat integer, p_cards integer[], p_now timestamptz) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; v_acc uuid; v_hand integer[]; x jsonb; v_top jsonb; v_left integer[];
        s text := p_seat::text;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  if t.phase <> 'playing' then
    return 'wrong phase';
  end if;
  v_pub := t.pub;
  select account_id into v_acc from public.card_seats where room_id = p_room and game = 'tienlen' and seat = p_seat;
  if v_pub->'players'->s->>'out' is not null or (v_pub->'players'->s->>'id')::uuid is distinct from v_acc then
    return 'not your turn';
  end if;
  select cards into v_hand from public.card_hands
   where room_id = p_room and game = 'tienlen' and hand_no = t.hand_no and seat = p_seat;
  x := public._tl_combo(p_cards);
  if x is null or not coalesce(v_hand @> p_cards, false) then
    return 'invalid play';
  end if;
  v_top := case when jsonb_typeof(v_pub->'top') = 'object' then v_pub->'top' end;
  if t.turn = p_seat then
    if v_top is null then
      if jsonb_typeof(v_pub->'must') = 'number' and not ((v_pub->>'must')::int = any(p_cards)) then
        return 'must include';
      end if;
    elsif not public._tl_beats(v_top, x) then
      return 'cannot beat';
    end if;
  else
    if x->>'type' <> 'pairs' or (x->>'len')::int <> 4 or v_top is null or (v_top->>'seat')::int = p_seat then
      return 'not your turn';
    end if;
    if not public._tl_beats(v_top, x) then
      return 'cannot beat';
    end if;
  end if;
  if v_top is not null and x->>'type' in ('quad', 'pairs')
     and (v_top->>'type' in ('quad', 'pairs') or (v_top->>'type' in ('single', 'pair') and (v_top->>'key')::int / 4 = 12)) then
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'cut', 'seat', p_seat, 'top', v_top));
  end if;
  v_left := array(select c from unnest(v_hand) c where not (c = any(p_cards)) order by c);
  update public.card_hands set cards = v_left
   where room_id = p_room and game = 'tienlen' and hand_no = t.hand_no and seat = p_seat;
  v_pub := jsonb_set(jsonb_set(v_pub, array['players', s, 'played'], 'true'), array['players', s, 'n'], to_jsonb(cardinality(v_left)))
    || jsonb_build_object(
         'must', null,
         'passed', coalesce((select jsonb_agg(q) from jsonb_array_elements(v_pub->'passed') q where q::int <> p_seat), '[]'::jsonb),
         'top', x || jsonb_build_object('seat', p_seat, 'done', cardinality(v_left) = 0),
         'pile', (select coalesce(jsonb_agg(z.e order by z.n), '[]'::jsonb)
                    from (select e, n from jsonb_array_elements(coalesce(v_pub->'pile', '[]'::jsonb)
                                         || jsonb_build_array(jsonb_build_object('seat', p_seat, 'cards', x->'cards')))
                                         with ordinality w(e, n) order by n desc limit 8) z));
  update public.card_tables set pub = v_pub where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', t.hand_no, v_acc, p_seat, 'play', jsonb_build_object('cards', x->'cards'), p_now);
  if cardinality(v_left) = 0 then
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'out', 'seat', p_seat));
  end if;
  if cardinality(public._tl_active(v_pub)) <= 1 then
    perform public._tl_end(p_room, p_now);
  else
    perform public._tl_advance(p_room, p_seat, p_now);
  end if;
  return null;
end $$;

-- A pass (§7.3 pass): only in turn, and never while leading.
create or replace function public._tl_do_pass(p_room uuid, p_seat integer, p_now timestamptz) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  if t.phase <> 'playing' then
    return 'wrong phase';
  end if;
  if t.turn is distinct from p_seat then
    return 'not your turn';
  end if;
  if coalesce(jsonb_typeof(t.pub->'top'), 'null') <> 'object' then
    return 'must play';
  end if;
  update public.card_tables set pub = jsonb_set(pub, '{passed}', coalesce(pub->'passed', '[]'::jsonb) || to_jsonb(p_seat))
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', t.hand_no,
                           (select account_id from public.card_seats where room_id = p_room and game = 'tienlen' and seat = p_seat),
                           p_seat, 'pass', '{}'::jsonb, p_now);
  perform public._tl_advance(p_room, p_seat, p_now);
  return null;
end $$;

-- A turn that ran out (§10): the lowest card when leading, else a pass; the second miss in a row leaves the game as
-- card_leave would (R28).
create or replace function public._tl_timeout(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_missed integer; v_acc uuid; v_low integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  update public.card_seats set missed = missed + 1 where room_id = p_room and game = 'tienlen' and seat = t.turn
  returning missed, account_id into v_missed, v_acc;
  perform public._card_log(p_room, 'tienlen', t.hand_no, v_acc, t.turn, 'timeout', jsonb_build_object('missed', v_missed), p_now);
  if v_missed >= 2 then
    perform public._card_leave_seat(p_room, 'tienlen', t.turn, 'timeout', p_now);
  elsif coalesce(jsonb_typeof(t.pub->'top'), 'null') <> 'object' then
    select min(c) into v_low from public.card_hands h, unnest(h.cards) c
     where h.room_id = p_room and h.game = 'tienlen' and h.hand_no = t.hand_no and h.seat = t.turn;
    perform public._tl_do_play(p_room, t.turn, array[v_low], p_now);
  else
    perform public._tl_do_pass(p_room, t.turn, p_now);
  end if;
end $$;

-- The leave operation in a live game (§6.3), with the table's wallets locked: seats still holding cards forfeit together
-- (R13) and are paid out at once; seats already out or cóng are paid out and receive nothing more. The rows stay
-- `leaving` until the game ends; the others play on as a smaller game.
create or replace function public._tl_leave(p_room uuid, p_seats integer[], p_how text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; v_hold integer[]; v_done integer[]; s integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'tienlen';
  v_pub := t.pub;
  v_hold := array(select x from unnest(p_seats) x where v_pub->'players'->(x::text)->>'out' is null
                   and not coalesce((v_pub->'players'->(x::text)->>'settled')::boolean, true) order by x);
  v_done := array(select x from unnest(p_seats) x where v_pub->'players'->(x::text)->>'out' is not null
                   and not coalesce((v_pub->'players'->(x::text)->>'settled')::boolean, true) order by x);
  if cardinality(v_hold) > 0 then
    -- a first lead's `must` goes with the forfeiter who holds it
    if jsonb_typeof(v_pub->'must') = 'number'
       and exists (select 1 from public.card_hands where room_id = p_room and game = 'tienlen' and hand_no = t.hand_no
                      and seat = any(v_hold) and (v_pub->>'must')::int = any(cards)) then
      update public.card_tables set pub = jsonb_set(pub, '{must}', 'null') where room_id = p_room and game = 'tienlen';
    end if;
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'forfeit', 'seats', to_jsonb(v_hold)));
  end if;
  foreach s in array v_done loop
    v_pub := public._tl_event(p_room, jsonb_build_object('k', 'leave', 'seat', s));
  end loop;
  perform public._card_lock_wallets(p_room, 'tienlen');
  foreach s in array v_hold || v_done loop
    perform public._card_payout(p_room, 'tienlen', s, 'card_settle');
    update public.card_seats set leaving = true where room_id = p_room and game = 'tienlen' and seat = s;
    perform public._card_log(p_room, 'tienlen', t.hand_no, (v_pub->'players'->(s::text)->>'id')::uuid, s, 'leave',
                             jsonb_build_object('how', p_how, 'forfeit', s = any(v_hold)), p_now);
  end loop;
  if cardinality(v_hold) > 0 then
    if cardinality(public._tl_active(v_pub)) <= 1 then
      perform public._tl_end(p_room, p_now);
    elsif t.turn = any(v_hold) then
      perform public._tl_advance(p_room, t.turn, p_now);
    end if;
  end if;
end $$;

-- The end of a game (§7.3 end_game): the end lines, the result, every balance paid, the leaving rows gone; nhất leads the
-- next game (R15).
create or replace function public._tl_end(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pub jsonb; v_hand integer; v_nhat text;
begin
  v_pub := public._tl_event(p_room, '{"k": "end"}'::jsonb);
  v_nhat := (select key from jsonb_each(v_pub->'players') where (value->>'place')::int = 1);
  update public.card_tables set last = public._tl_last(p_room, null) where room_id = p_room and game = 'tienlen'
  returning hand_no into v_hand;
  perform public._card_settle(p_room, 'tienlen');
  delete from public.card_seats where room_id = p_room and game = 'tienlen' and leaving;
  update public.card_tables
     set lead_id = (v_pub->'players'->v_nhat->>'id')::uuid, first_game = false, phase = 'result', turn = null,
         deadline = p_now + interval '8 seconds'
   where room_id = p_room and game = 'tienlen';
  perform public._card_log(p_room, 'tienlen', v_hand, null, null, 'end',
                           (select jsonb_build_object('places', last->'places', 'net', last->'net') from public.card_tables
                             where room_id = p_room and game = 'tienlen'), p_now);
  perform public._card_reset_if_empty(p_room, 'tienlen');
end $$;

-- What is due at a Tiến lên table (§10): the deal after the countdown or the result, or the turn's timeout.
create or replace function public._tl_due(p_room uuid, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_phase text;
begin
  select phase into v_phase from public.card_tables where room_id = p_room and game = 'tienlen';
  if v_phase in ('countdown', 'result') then
    return public._tl_deal(p_room, p_now, p_deck);
  elsif v_phase = 'playing' then
    perform public._tl_timeout(p_room, p_now);
    return true;
  end if;
  return false;
end $$;

revoke all on function public._tl_hands(uuid) from public, anon, authenticated;
revoke all on function public._tl_active(jsonb) from public, anon, authenticated;
revoke all on function public._tl_event(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._tl_last(uuid, jsonb) from public, anon, authenticated;
revoke all on function public._tl_deal(uuid, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._tl_do_trang(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_advance(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_close(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_do_play(uuid, integer, integer[], timestamptz) from public, anon, authenticated;
revoke all on function public._tl_do_pass(uuid, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_timeout(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_leave(uuid, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_end(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._tl_due(uuid, timestamptz, integer[]) from public, anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 11 of 12.** Replace:

```sql

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
```

with:

```sql

-- Play cards (§7.3). Guarded; bad_cards (§11.5) comes before any lock.
create or replace function public.tl_play(p_room_id uuid, p_session_token text, p_seq integer, p_cards integer[]) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_cards is null or coalesce(cardinality(p_cards), 0) = 0 or cardinality(p_cards) > 13 or array_ndims(p_cards) <> 1
     or exists (select 1 from unnest(p_cards) c where c is null or c not between 0 and 51)
     or (select count(distinct c) from unnest(p_cards) c) <> cardinality(p_cards) then
    return public._ac_flag(v_account, 'bad_cards', 'tl_play', jsonb_build_object('seq', p_seq, 'cards', to_jsonb(p_cards)),
                           p_room_id, 'invalid cards');
  end if;
  return public._card_action(p_room_id, v_account, 'tienlen', 'tl_play', p_seq, jsonb_build_object('cards', to_jsonb(p_cards)),
                             now());
end $$;

-- Pass (§7.3). Guarded.
create or replace function public.tl_pass(p_room_id uuid, p_session_token text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._card_action(p_room_id, v_account, 'tienlen', 'tl_pass', p_seq, '{}'::jsonb, now());
end $$;

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 12 of 12.** Append at the end of the file:

```sql
grant execute on function public.tl_play(uuid, text, integer, integer[]) to anon, authenticated;
grant execute on function public.tl_pass(uuid, text, integer) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected:

```text
v14 smoke ok
0017 twice ok
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
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(cards): 0017 the Tiến lên engine — deal, plays, passes, cuts, timeouts, forfeits, settlement; tl_play and tl_pass

Section D's Tiến lên: the deal with the first game's `must` and the lead, plays and passes, cuts and cut chains (4 đôi
thông out of turn after passing), the round's close, going out, cóng, tới trắng, two timeouts in a row as a forfeit, the
leave rules of R13 settled at once, and the settlement; every money event runs _tl_money and moves the escrows. The
dispatchers (_card_due, _card_leave_live, _card_action) and _card_lock_wallets serve the three engines. tl_play and
tl_pass are guarded, with bad_cards as the hard check and the refused moves as the soft bad_move; the guard loop gains
them (45). Smoke part 4 plays eight games on the public RPCs with fixed decks.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0017_v16_cards.sql tests/sql/anticheat-guards.sql tests/sql/v16-smoke.sql
git commit -F <message file>
```

---

### Task 5: Database — the Cào engine; `cao_deal` (`0017` section D)

**Files:**
- Modify: `supabase/migrations/0017_v16_cards.sql` (the Cào branches of the dispatchers, the Cào engine, `cao_deal`, `dealer busy` in `_card_leave`)
- Modify: `tests/sql/anticheat-guards.sql` (the loop calls `cao_deal`: 46 RPCs)
- Modify: `tests/sql/v16-smoke.sql` (append part 5)

**Interfaces:**
- Consumes: Tasks 1–4 (`_cao_eval`, `_cao_settle`, the machinery, `_card_lock_wallets`, `_card_action`, `_card_due`, `_card_leave_live`).
- Produces (section D, private): `_cao_preview(room, now) → int` (the next dealer who can cover (n − 1) S, or null), `_cao_start(room, now)` (`deal_wait`, 15 s, the preview in `pub.dealer` and `turn`, `note: "no_dealer"` when nobody can deal), `_cao_do_deal(room, seat, now, deck) → text` (`wrong phase`, `not dealer`; the players and the dealer rebuilt under the wallet locks, the escrows, 3 cards each, `peek` for 15 s; fewer than 2 → `idle`), `_cao_cancel(room, now)`, `_cao_leave(room, seats, how, now)` (a player in `peek` loses S to the dealer; the dealer removed by a sweep cancels the hand), `_cao_showdown(room, now)`, `_cao_due(room, now, deck) → bool` (the auto-deal on timeout, with the dealer's misses).
- Produces (section E): `cao_deal(p_room_id, p_session_token, p_seq)`, guarded (no hard check; its refusals are `bad_move`); `card_leave` refuses the Cào dealer during `peek` with `dealer busy` (R35).
- Produces (smoke): helpers `pg_temp.ct`, `cesc`, `cresult`, `cao_due`, `cao_deal`; six hands, a table with no dealer and a wallet drained before the deal; part 5 prints `v16 cao smoke ok`.

- [ ] **Step 1: Write the guard change and smoke part 5**

**tests/sql/anticheat-guards.sql — edit 1 of 2.** Replace:

```sql
    format('select public.tl_play(%L, %L, 0, array[0])', room, t),
    format('select public.tl_pass(%L, %L, 0)', room, t)] loop
    n := n + 1;
```

with:

```sql
    format('select public.tl_play(%L, %L, 0, array[0])', room, t),
    format('select public.tl_pass(%L, %L, 0)', room, t),
    format('select public.cao_deal(%L, %L, 0)', room, t)] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 2 of 2.** Replace:

```sql
  end loop;
  assert n = 45, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 46, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

**tests/sql/v16-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- Cào (§8, §17): five players, the dealer rotating; time stands still (each step's deadline is moved back) ----------
create function pg_temp.ct() returns public.card_tables language sql as $$
  select * from public.card_tables where room_id = (select v from smoke where k = 'room')::uuid and game = 'cao'
$$;
create function pg_temp.cesc() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(seat::text, escrow), '{}') from public.card_seats
   where room_id = (select v from smoke where k = 'room')::uuid and game = 'cao'
$$;
create function pg_temp.cresult() returns jsonb language sql as $$
  select jsonb_build_object('dealer', t.last->'dealer', 'cancelled', t.last->'cancelled', 'net', t.last->'net',
    'lines', (select coalesce(jsonb_agg(jsonb_build_array(l->'from', l->'to', l->'xu', l->'why') order by n), '[]')
                from jsonb_array_elements(t.last->'lines') with ordinality e(l, n)))
    from pg_temp.ct() t
$$;
-- What is due at the Cào table: its deadline moved to the past, then a tick with this deck.
create function pg_temp.cao_due(p_deck integer[]) returns public.card_tables language plpgsql as $$
declare room uuid := (select v from smoke where k = 'room')::uuid; r jsonb;
begin
  update public.card_tables set deadline = now() - interval '1 second' where room_id = room and game = 'cao';
  r := public._card_tick(room, (select v from smoke where k = 'a1')::uuid, 'cao', now(), p_deck);
  assert (r->>'changed')::boolean, format('the tick: %s', r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the tick';
  return pg_temp.ct();
end $$;
-- The previewed dealer's cao_deal with this deck, through the action path.
create function pg_temp.cao_deal(p_account uuid, p_deck integer[]) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := public._card_action((select v from smoke where k = 'room')::uuid, p_account, 'cao', 'cao_deal', (pg_temp.ct()).seq,
                           '{}'::jsonb, now(), p_deck);
  assert r ? 'state', format('cao_deal: %s', r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the deal';
  return r;
end $$;

do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c6 text := (select v from smoke where k = 'c6');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a6 uuid := (select v from smoke where k = 'a6')::uuid; t public.card_tables; r jsonb; s jsonb;
begin
  perform pg_temp.set_coins(a1, 20000);
  perform pg_temp.set_coins(a2, 20000);
  perform pg_temp.set_coins(a3, 2000);
  perform pg_temp.set_coins(a4, 20000);
  perform pg_temp.set_coins(a6, 20000);
  update smoke set v = pg_temp.total()::text where k = 'm';
  -- the first dealer is the first to sit (§8.2); the preview holds while others sit
  perform public.card_sit(room, c2, 'cao', 2, 1000, null);
  update public.card_seats set sat_at = now() - interval '1 minute' where room_id = room and account_id = a2;
  r := public.card_sit(room, c1, 'cao', 1, 1000, null);
  assert r->'state'->>'phase' = 'deal_wait' and r->'state'->'pub'->'dealer' = '2' and r->'state'->'turn' = '2'
         and (r->'state'->>'deadline')::timestamptz = now() + interval '15 seconds' and (r->>'coins')::int = 20000,
    format('the dealer waits: %s', r->'state');
  perform public.card_sit(room, c3, 'cao', 3, 1000, null);
  perform public.card_sit(room, c4, 'cao', 4, 1000, null);
  perform public.card_sit(room, c6, 'cao', 5, 1000, null);
  t := pg_temp.ct();
  assert t.pub = '{"dealer": 2, "order": [], "left": [], "note": null}' and t.hand_no = 0, format('the preview: %s', t.pub);
  -- only the previewed dealer deals, with the table's seq (§11.5, R24)
  assert pg_temp.env(public.cao_deal(room, c1, t.seq), 'bad_move', 'not dealer'), 'not dealer';
  assert pg_temp.err(format('select public.cao_deal(%L, %L, %s)', room, c2, t.seq - 1)) = 'stale', 'stale';
  perform public.cao_deal(room, c1, t.seq);
  assert (select count(*) from public.anticheat_events where account_id = a1 and code = 'bad_move' and outcome = 'soft'
            and rpc = 'cao_deal') = 2 and (pg_temp.ct()).seq = t.seq, 'a refused deal is logged each time, and changes nothing';
  -- hand 1 (§8.3's example): B deals; the escrows total 2 (n − 1) S
  r := pg_temp.cao_deal(a2, pg_temp.deck('9S 8C 2H', 'KD 5S 3C', 'JS QH KC', '4D 4C 4S', '7H 10C AD'));
  t := pg_temp.ct();
  assert t.phase = 'peek' and t.hand_no = 1 and t.pos = 2 and t.turn is null and t.deadline = now() + interval '15 seconds'
         and t.pub = '{"dealer": 2, "order": [1, 2, 3, 4, 5], "left": [], "note": null}', format('peek: %s', to_jsonb(t));
  assert pg_temp.cesc() = '{"1": 1000, "2": 4000, "3": 1000, "4": 1000, "5": 1000}'
         and (select count(*) from public.coin_ledger where reason = 'card_hold' and ref = 'cao#1') = 5, format('escrows: %s', pg_temp.cesc());
  assert r->'hand'->'cards' = pg_temp.sorted('KD 5S 3C') and (r->>'coins')::int = 16000, 'the dealer sees its own cards';
  -- the hands stay private until the showdown (§6.4)
  s := public.card_state(room, c6, 'cao');
  assert s->'pub' = t.pub and s->'last' = 'null', format('no cards in the state: %s', s);
  assert public.card_hand(room, c3, 'cao')->'cards' = pg_temp.sorted('JS QH KC'), 'c3 sees its own';
  assert pg_temp.env(public.cao_deal(room, c2, t.seq), 'bad_move', 'wrong phase'), 'no deal during peek';
  -- the showdown at the peek deadline: every hand in play is shown
  t := pg_temp.cao_due(null);
  assert t.phase = 'result' and t.deadline = now() + interval '6 seconds', 'the result for 6 s';
  assert pg_temp.cresult() = '{"dealer": 2, "cancelled": false, "net": {"1": 1000, "2": -2000, "3": 1000, "4": 1000, "5": -1000},
                               "lines": [[2, 1, 1000, "cao"], [2, 3, 1000, "cao"], [2, 4, 1000, "cao"], [5, 2, 1000, "cao"]]}',
    format('the example: %s', pg_temp.cresult());
  assert t.last->'hands'->'3' = jsonb_build_object('cards', pg_temp.sorted('JS QH KC'), 'kind', 'ba_tay', 'points', 0)
         and t.last->'hands'->'4' = jsonb_build_object('cards', pg_temp.sorted('4D 4C 4S'), 'kind', 'sap', 'points', 2)
         and (select count(*) from jsonb_object_keys(t.last->'hands')) = 5, format('every hand is shown: %s', t.last->'hands');
  assert pg_temp.coins(a1) = 21000 and pg_temp.coins(a2) = 18000 and pg_temp.coins(a3) = 3000 and pg_temp.coins(a4) = 21000
         and pg_temp.coins(a6) = 19000 and pg_temp.cesc() = '{"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}', 'everyone is paid';
  -- hand 2: after B comes C, who cannot cover 4 S, so D is previewed (R20); D does not deal in time: the automatic deal,
  -- and a miss for D
  t := pg_temp.cao_due(null);
  assert t.phase = 'deal_wait' and t.pub->'dealer' = '4' and t.turn = 4, format('C is skipped: %s', t.pub);
  t := pg_temp.cao_due(pg_temp.deck('2S 3S 4S', '5C 6C 7C', '8S 9S AS', 'KS KC KD', '10S JC QC'));
  assert t.phase = 'peek' and t.hand_no = 2 and t.pub->'dealer' = '4'
         and (select missed from public.card_seats where room_id = room and game = 'cao' and seat = 4) = 1
         and pg_temp.cesc() = '{"1": 1000, "2": 1000, "3": 1000, "4": 4000, "5": 1000}', format('the automatic deal: %s', t.pub);
  t := pg_temp.cao_due(null);
  assert pg_temp.cresult()->'net' = '{"1": -1000, "2": -1000, "3": -1000, "4": 4000, "5": -1000}', 'sáp K takes all';
  -- hand 3: E is previewed, then its wallet runs dry: at the deal E stands up and the dealer passes on to A (§8.2)
  t := pg_temp.cao_due(null);
  assert t.pub->'dealer' = '5', 'E is previewed';
  perform pg_temp.set_coins(a6, 500);
  update smoke set v = pg_temp.total()::text where k = 'm';
  t := pg_temp.cao_due(pg_temp.deck('3S 3C 3D', '5S 5C 5D', '2C 7S AC', 'JD QD KH'));
  assert t.pub = '{"dealer": 1, "order": [1, 2, 3, 4], "left": [], "note": null}'
         and pg_temp.cesc() = '{"1": 3000, "2": 1000, "3": 1000, "4": 1000}'
         and not exists (select 1 from public.card_seats where room_id = room and account_id = a6)
         and (select count(*) from public.card_log where room_id = room and game = 'cao' and account_id = a6 and action = 'leave'
                and detail->>'how' = 'idle') = 1, format('rebuilt under the locks: %s', t.pub);
  t := pg_temp.cao_due(null);
  assert pg_temp.cresult()->'lines' = '[[1, 2, 1000, "cao"], [3, 1, 1000, "cao"], [4, 1, 1000, "cao"]]',
    format('hand 3: %s', pg_temp.cresult());
  -- hand 4: B deals; the dealer cannot leave during peek (R35); C leaves and loses S at once (§6.3)
  t := pg_temp.cao_due(null);
  assert t.pub->'dealer' = '2', 'B is next';
  perform pg_temp.cao_deal(a2, pg_temp.deck('4C 4H 4D', '9H 10H QH', '2S 3H 5H', '6D 6H 7D'));
  assert pg_temp.err(format('select public.card_leave(%L, %L, %L)', room, c2, 'cao')) = 'dealer busy', 'dealer busy';
  r := public.card_leave(room, c3, 'cao');
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the leave';
  t := pg_temp.ct();
  assert t.pub->'left' = '[3]' and pg_temp.cesc() = '{"1": 1000, "2": 4000, "3": 0, "4": 1000}' and (r->>'coins')::int = 0
         and (select leaving from public.card_seats where room_id = room and game = 'cao' and seat = 3), format('C left: %s', t.pub);
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c3, 'tienlen')) = 'still leaving',
    'still leaving';
  t := pg_temp.cao_due(null);
  assert pg_temp.cresult() = '{"dealer": 2, "cancelled": false, "net": {"1": 1000, "2": 1000, "3": -1000, "4": -1000},
                               "lines": [[2, 1, 1000, "cao"], [3, 2, 1000, "left"], [4, 2, 1000, "cao"]]}',
    format('hand 4: %s', pg_temp.cresult());
  assert not (t.last->'hands' ? '3') and not exists (select 1 from public.card_seats where room_id = room and account_id = a3),
    'the leaver''s hand stays out of the showdown, and its row goes';
  -- hand 5: D's second miss in a row as dealer: D deals automatically, then stands up once the hand settles (§8.2)
  t := pg_temp.cao_due(null);
  assert t.pub->'dealer' = '4', 'D is next';
  t := pg_temp.cao_due(pg_temp.deck('2D 3D 4H', '5H 6C 7H', 'AH 2H 3H'));
  assert t.pub->'dealer' = '4' and pg_temp.cesc() = '{"1": 1000, "2": 1000, "4": 2000}'
         and (select missed from public.card_seats where room_id = room and game = 'cao' and seat = 4) = 2, 'the second miss';
  t := pg_temp.cao_due(null);
  assert pg_temp.cresult()->'net' = '{"1": 1000, "2": 1000, "4": -2000}'
         and not exists (select 1 from public.card_seats where room_id = room and account_id = a4)
         and pg_temp.coins(a4) = 21000, 'D is stood up after the hand';
  -- hand 6: a banned dealer is swept during peek: the hand is cancelled and every balance refunded (§6.3, R35)
  t := pg_temp.cao_due(null);
  assert t.pub->'dealer' = '1', 'A is next';
  perform pg_temp.cao_deal(a1, pg_temp.deck('5D 6D 8H', '9C JH 2D'));
  update public.accounts set is_banned = true where id = a1;
  r := public.card_tick(room, c2, 'cao');
  update public.accounts set is_banned = false where id = a1;
  t := pg_temp.ct();
  assert (r->>'changed')::boolean and t.phase = 'result'
         and pg_temp.cresult() = '{"dealer": 1, "cancelled": true, "net": {"1": 0, "2": 0}, "lines": []}'
         and pg_temp.cesc() = '{"2": 0}' and pg_temp.coins(a1) = 23000 and pg_temp.coins(a2) = 20000
         and pg_temp.total() = (select v from smoke where k = 'm')::bigint, format('Ván huỷ: %s', to_jsonb(t));
  -- nobody can cover the dealer's escrow: the wait says so and starts again (R20)
  perform public.card_sit(room, c1, 'cao', 1, 1000, null);
  perform public.card_sit(room, c4, 'cao', 4, 1000, null);
  perform pg_temp.set_coins(a, 1500) from unnest(array[a1, a2, a4]) a;
  update smoke set v = pg_temp.total()::text where k = 'm';
  t := pg_temp.cao_due(null);
  assert t.phase = 'deal_wait' and t.pub = '{"dealer": null, "order": [], "left": [], "note": "no_dealer"}' and t.turn is null,
    format('nobody can deal: %s', t.pub);
  t := pg_temp.cao_due(null);
  assert t.phase = 'deal_wait' and t.pub->>'note' = 'no_dealer' and t.hand_no = 6, 'still nobody';
  -- wallets drained before the deal: fewer than two players, so the table goes idle (§8.2)
  perform pg_temp.set_coins(a, 500) from unnest(array[a2, a4]) a;
  update smoke set v = pg_temp.total()::text where k = 'm';
  t := pg_temp.cao_due(null);
  assert t.phase = 'idle' and t.pub = '{}' and (select count(*) from public.card_seats where room_id = room and game = 'cao') = 1,
    format('idle: %s', to_jsonb(t));
  perform public.card_leave(room, c1, 'cao');
  assert not exists (select 1 from public.card_seats where room_id = room) and (pg_temp.ct()).stake is null
         and pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'the Cào table is empty';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_cao\_%'
                      and has_function_privilege('anon', p.oid, 'execute')), 'the Cào helpers are private';
end $$;

select 'v16 cao smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` — the guard loop now calls `cao_deal`: `function public.cao_deal(unknown, unknown, integer) does not exist` in the log.

- [ ] **Step 3: Write the Cào engine and `cao_deal`**

**supabase/migrations/0017_v16_cards.sql — edit 1 of 11.** Replace:

```sql
    perform public._tl_leave(p_room, p_seats, p_how, p_now);
  end if;
```

with:

```sql
    perform public._tl_leave(p_room, p_seats, p_how, p_now);
  elsif p_game = 'cao' then
    perform public._cao_leave(p_room, p_seats, p_how, p_now);
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 2 of 11.** Replace:

```sql
    return public._tl_due(p_room, p_now, p_deck);
  end if;
```

with:

```sql
    return public._tl_due(p_room, p_now, p_deck);
  elsif p_game = 'cao' then
    return public._cao_due(p_room, p_now, p_deck);
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 3 of 11.** Replace:

```sql

-- Two seats start a table (§6.1): the countdown (Tiến lên 8 s, poker 5 s) or the dealer's wait (Cào, 15 s). Before the
-- deal, fewer than two seats send it back to idle.
create or replace function public._card_ready(p_room uuid, p_game text, p_now timestamptz) returns void
```

with:

```sql

-- Two seats start a table (§6.1): the countdown (Tiến lên 8 s, poker 5 s) or the dealer's wait (Cào, _cao_start). Before
-- the deal, fewer than two seats send it back to idle, and a Cào wait whose previewed dealer is gone starts again.
create or replace function public._card_ready(p_room uuid, p_game text, p_now timestamptz) returns void
```

**supabase/migrations/0017_v16_cards.sql — edit 4 of 11.** Replace:

```sql
  n := (select count(*) from public.card_seats where room_id = p_room and game = p_game and not leaving);
  if t.phase = 'idle' and n >= 2 then
    update public.card_tables
       set phase = case p_game when 'cao' then 'deal_wait' else 'countdown' end, turn = null, pub = '{}'::jsonb,
           deadline = p_now + case p_game when 'tienlen' then interval '8 seconds' when 'cao' then interval '15 seconds'
                                          else interval '5 seconds' end
     where room_id = p_room and game = p_game;
```

with:

```sql
  n := (select count(*) from public.card_seats where room_id = p_room and game = p_game and not leaving);
  if t.phase = 'idle' and n >= 2 and p_game = 'cao' then
    perform public._cao_start(p_room, p_now);
  elsif t.phase = 'idle' and n >= 2 then
    update public.card_tables
       set phase = 'countdown', turn = null, pub = '{}'::jsonb,
           deadline = p_now + case p_game when 'tienlen' then interval '8 seconds' else interval '5 seconds' end
     where room_id = p_room and game = p_game;
```

**supabase/migrations/0017_v16_cards.sql — edit 5 of 11.** Replace:

```sql
     where room_id = p_room and game = p_game;
  end if;
```

with:

```sql
     where room_id = p_room and game = p_game;
  elsif t.phase = 'deal_wait'
        and not exists (select 1 from public.card_seats where room_id = p_room and game = p_game and not leaving
                         and seat = (t.pub->>'dealer')::int) then
    perform public._cao_start(p_room, p_now);
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 6 of 11.** Replace:

```sql

-- Stand up (§6.3): the leave operation on the caller's seat.
create or replace function public._card_leave(p_room uuid, p_account uuid, p_game text, p_now timestamptz) returns jsonb
```

with:

```sql

-- Stand up (§6.3): the leave operation on the caller's seat; the Cào dealer waits for the showdown (R35).
create or replace function public._card_leave(p_room uuid, p_account uuid, p_game text, p_now timestamptz) returns jsonb
```

**supabase/migrations/0017_v16_cards.sql — edit 7 of 11.** Replace:

```sql
  v_live := public._card_live(p_room, p_game, v_seat);
  perform public._card_leave_seat(p_room, p_game, v_seat, 'leave', p_now);
```

with:

```sql
  v_live := public._card_live(p_room, p_game, v_seat);
  if v_live and p_game = 'cao'
     and (select (pub->>'dealer')::int from public.card_tables where room_id = p_room and game = p_game) = v_seat then
    raise exception 'dealer busy' using errcode = '22023';
  end if;
  perform public._card_leave_seat(p_room, p_game, v_seat, 'leave', p_now);
```

**supabase/migrations/0017_v16_cards.sql — edit 8 of 11.** Replace:

```sql
    v_err := public._tl_do_pass(p_room, v_seat, p_now);
  end if;
```

with:

```sql
    v_err := public._tl_do_pass(p_room, v_seat, p_now);
  elsif p_kind = 'cao_deal' then
    v_err := public._cao_do_deal(p_room, v_seat, p_now, p_deck);
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 9 of 11.** Replace:

```sql

-- ---------- E. Public RPCs (§11.3): membership first (R38); reads are snapshots (R37); ticks and writes lock and sweep ----------
```

with:

```sql

-- Cào (§8). The dealer a deal_wait shows (§8.2): among the seats that look able to play (seen within 60 s, a wallet ≥ S),
-- the first — from the first to sit at a new table, else from the seat after the last dealer — whose wallet covers
-- (n − 1) S. A preview only: the deal rebuilds it under the locks (R20).
create or replace function public._cao_preview(p_room uuid, p_now timestamptz) returns integer
language sql stable security definer set search_path = public, extensions
as $$
  with t as (select stake, pos from public.card_tables where room_id = p_room and game = 'cao'),
  p as (select s.seat, s.sat_at, coalesce(w.coins, 0) as coins
          from public.card_seats s left join public.wallets w on w.account_id = s.account_id
         where s.room_id = p_room and s.game = 'cao' and not s.leaving and s.seen_at >= p_now - interval '60 seconds'
           and coalesce(w.coins, 0) >= (select stake from t))
  select p.seat from p, t
   where p.coins >= ((select count(*) from p) - 1) * t.stake
   order by case when t.pos is not null and p.seat <= t.pos then 1 else 0 end, case when t.pos is null then p.sat_at end, p.seat
   limit 1
$$;

-- The dealer's wait (§8.2): 15 s for the previewed dealer's "Chia bài"; nobody able to deal is noted ("no_dealer"). Fewer
-- than two seats → idle.
create or replace function public._cao_start(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_dealer integer;
begin
  if (select count(*) from public.card_seats where room_id = p_room and game = 'cao' and not leaving) < 2 then
    update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
     where room_id = p_room and game = 'cao';
    return;
  end if;
  v_dealer := public._cao_preview(p_room, p_now);
  update public.card_tables
     set phase = 'deal_wait', turn = v_dealer, deadline = p_now + interval '15 seconds',
         pub = jsonb_build_object('dealer', v_dealer, 'order', '[]'::jsonb, 'left', '[]'::jsonb,
                                  'note', case when v_dealer is null then 'no_dealer' end)
   where room_id = p_room and game = 'cao';
end $$;

-- The deal (§8.2): the previewed dealer's cao_deal (p_seat), or the deadline (p_seat null: a miss for the previewed
-- dealer). The table's wallets are locked; the players are rebuilt (seen, not leaving, a wallet ≥ S; the others stand
-- up) and the dealer from the preview on (R20); then S is held from each player and (n − 1) S from the dealer, and 3 cards
-- are dealt to each in seat order. The refusal of a move that is not legal, else null.
create or replace function public._cao_do_deal(p_room uuid, p_seat integer, p_now timestamptz, p_deck integer[]) returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_prev integer; r record; v_players integer[]; n integer; v_dealer integer;
        v_deck integer[]; v_hand integer; i integer; v_cards integer[]; v_missed integer; v_acc uuid;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'cao';
  if t.phase <> 'deal_wait' then
    return 'wrong phase';
  end if;
  v_prev := (t.pub->>'dealer')::int;
  if p_seat is not null and p_seat is distinct from v_prev then
    return 'not dealer';
  end if;
  if p_seat is null and v_prev is not null then
    update public.card_seats set missed = missed + 1
     where room_id = p_room and game = 'cao' and seat = v_prev and not leaving
    returning missed, account_id into v_missed, v_acc;
    if found then
      perform public._card_log(p_room, 'cao', t.hand_no, v_acc, v_prev, 'timeout', jsonb_build_object('missed', v_missed), p_now);
    end if;
  end if;
  perform public._card_lock_wallets(p_room, 'cao');
  for r in select cs.seat from public.card_seats cs left join public.wallets w on w.account_id = cs.account_id
            where cs.room_id = p_room and cs.game = 'cao' and not cs.leaving
              and (cs.seen_at < p_now - interval '60 seconds' or coalesce(w.coins, 0) < t.stake)
            order by cs.seat loop
    perform public._card_leave_seat(p_room, 'cao', r.seat, 'idle', p_now);
  end loop;
  v_players := array(select seat from public.card_seats where room_id = p_room and game = 'cao' and not leaving order by seat);
  n := cardinality(v_players);
  if n < 2 then
    update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
     where room_id = p_room and game = 'cao';
    return null;
  end if;
  v_dealer := (select cs.seat from public.card_seats cs join public.wallets w on w.account_id = cs.account_id
                where cs.room_id = p_room and cs.game = 'cao' and cs.seat = any(v_players) and w.coins >= (n - 1) * t.stake
                order by case when v_prev is not null then (cs.seat < v_prev)::int
                              when t.pos is not null then (cs.seat <= t.pos)::int else 0 end,
                         case when v_prev is null and t.pos is null then cs.sat_at end, cs.seat
                limit 1);
  if v_dealer is null then
    perform public._cao_start(p_room, p_now);
    return null;
  end if;
  v_deck := coalesce(p_deck, public._card_shuffle());
  v_hand := t.hand_no + 1;
  delete from public.card_hands where room_id = p_room and game = 'cao';
  delete from public.card_secrets where room_id = p_room and game = 'cao';
  for i in 1..n loop
    v_cards := array(select c from unnest(v_deck[3 * i - 2 : 3 * i]) c order by c);
    insert into public.card_hands (room_id, game, hand_no, seat, account_id, dealt, cards)
    select p_room, 'cao', v_hand, v_players[i], account_id, v_cards, v_cards
      from public.card_seats where room_id = p_room and game = 'cao' and seat = v_players[i];
  end loop;
  for r in select seat, account_id from public.card_seats where room_id = p_room and game = 'cao' and seat = any(v_players)
            order by seat loop
    perform public._pay(r.account_id, -(case when r.seat = v_dealer then n - 1 else 1 end) * t.stake, 'card_hold',
                        public._card_ref('cao', v_hand));
    update public.card_seats set escrow = (case when r.seat = v_dealer then n - 1 else 1 end) * t.stake
     where room_id = p_room and game = 'cao' and seat = r.seat;
  end loop;
  update public.card_tables
     set hand_no = v_hand, pos = v_dealer, phase = 'peek', turn = null, deadline = p_now + interval '15 seconds',
         pub = jsonb_build_object('dealer', v_dealer, 'order', to_jsonb(v_players), 'left', '[]'::jsonb, 'note', null)
   where room_id = p_room and game = 'cao';
  perform public._card_log(p_room, 'cao', v_hand, null, v_dealer, 'deal',
    jsonb_build_object('hands', (select jsonb_object_agg(seat::text, to_jsonb(dealt)) from public.card_hands
                                  where room_id = p_room and game = 'cao'), 'by', coalesce(p_seat::text, 'timeout')), p_now);
  delete from public.card_log where id in (select id from public.card_log where at < p_now - interval '14 days' order by at limit 500);
  return null;
end $$;

-- A hand cancelled (§6.3, R35): its dealer was removed by the sweep or _card_forfeit_all. What players who left already
-- lost stands; every seat is paid its balance, and `last` says "Ván huỷ" (cancelled).
create or replace function public._cao_cancel(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_dealer integer; v_left integer[];
begin
  select * into t from public.card_tables where room_id = p_room and game = 'cao';
  v_dealer := (t.pub->>'dealer')::int;
  v_left := public._card_ints(t.pub->'left');
  update public.card_tables
     set last = jsonb_build_object('hand_no', t.hand_no, 'dealer', v_dealer, 'cancelled', true, 'hands', '{}'::jsonb,
           'lines', coalesce((select jsonb_agg(jsonb_build_object('from', s, 'to', v_dealer, 'xu', t.stake, 'why', 'left') order by n)
                                from unnest(v_left) with ordinality u(s, n)), '[]'::jsonb),
           'net', (select jsonb_object_agg(q::text, (case when q = v_dealer then cardinality(v_left) when q = any(v_left) then -1
                                                           else 0 end) * t.stake)
                     from unnest(public._card_ints(t.pub->'order')) q))
   where room_id = p_room and game = 'cao';
  perform public._card_settle(p_room, 'cao');
  delete from public.card_seats where room_id = p_room and game = 'cao' and leaving;
  update public.card_tables set phase = 'result', turn = null, deadline = p_now + interval '6 seconds'
   where room_id = p_room and game = 'cao';
  perform public._card_log(p_room, 'cao', t.hand_no, null, v_dealer, 'cancel', '{}'::jsonb, p_now);
  perform public._card_reset_if_empty(p_room, 'cao');
end $$;

-- The leave operation during peek (§6.3), with the table's wallets locked: a player loses S to the dealer at once and is
-- paid out, the row stays `leaving`, and the hand is left out of the showdown. A dealer among the seats (the sweep or
-- _card_forfeit_all; card_leave refuses it, R35) cancels the hand, and those seats pay nothing.
create or replace function public._cao_leave(p_room uuid, p_seats integer[], p_how text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_dealer integer; v_dacc uuid; s integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'cao';
  v_dealer := (t.pub->>'dealer')::int;
  if v_dealer = any(p_seats) then
    perform public._cao_cancel(p_room, p_now);
    foreach s in array p_seats loop
      perform public._card_leave_seat(p_room, 'cao', s, p_how, p_now);
    end loop;
    return;
  end if;
  select account_id into v_dacc from public.card_hands
   where room_id = p_room and game = 'cao' and hand_no = t.hand_no and seat = v_dealer;
  foreach s in array p_seats loop
    update public.card_seats set escrow = escrow - t.stake where room_id = p_room and game = 'cao' and seat = s;
    update public.card_seats set escrow = escrow + t.stake
     where room_id = p_room and game = 'cao' and seat = v_dealer and account_id = v_dacc;
    update public.card_tables set pub = jsonb_set(pub, '{left}', coalesce(pub->'left', '[]'::jsonb) || to_jsonb(s))
     where room_id = p_room and game = 'cao';
    perform public._card_payout(p_room, 'cao', s, 'card_settle');
    update public.card_seats set leaving = true where room_id = p_room and game = 'cao' and seat = s;
    perform public._card_log(p_room, 'cao', t.hand_no, (select account_id from public.card_seats
                                                          where room_id = p_room and game = 'cao' and seat = s),
                             s, 'leave', jsonb_build_object('how', p_how, 'lost', t.stake), p_now);
  end loop;
end $$;

-- The showdown at the peek deadline (§8.2, §8.3): each hand still in play against the dealer's, S a line; the hands in
-- play shown in `last`; every balance paid; the leaving rows gone, and a dealer with two misses in a row stood up (§6.3).
create or replace function public._cao_showdown(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_set jsonb; l jsonb; r record; v_left integer[];
begin
  select * into t from public.card_tables where room_id = p_room and game = 'cao';
  v_left := public._card_ints(t.pub->'left');
  v_set := public._cao_settle(jsonb_build_object('dealer', t.pub->'dealer', 'order', t.pub->'order', 'left', t.pub->'left',
             'hands', (select jsonb_object_agg(seat::text, to_jsonb(cards)) from public.card_hands
                        where room_id = p_room and game = 'cao' and hand_no = t.hand_no)));
  for l in select e.value from jsonb_array_elements(v_set->'lines') e where e.value->>'why' = 'cao' loop
    update public.card_seats cs set escrow = cs.escrow - t.stake
      from public.card_hands h
     where cs.room_id = p_room and cs.game = 'cao' and cs.seat = (l->>'from')::int
       and h.room_id = p_room and h.game = 'cao' and h.hand_no = t.hand_no and h.seat = cs.seat and h.account_id = cs.account_id;
    update public.card_seats cs set escrow = cs.escrow + t.stake
      from public.card_hands h
     where cs.room_id = p_room and cs.game = 'cao' and cs.seat = (l->>'to')::int
       and h.room_id = p_room and h.game = 'cao' and h.hand_no = t.hand_no and h.seat = cs.seat and h.account_id = cs.account_id;
  end loop;
  update public.card_tables
     set last = jsonb_build_object('hand_no', t.hand_no, 'dealer', t.pub->'dealer', 'cancelled', false,
           'hands', (select jsonb_object_agg(h.seat::text, jsonb_build_object('cards', to_jsonb(h.cards))
                                                            || (public._cao_eval(h.cards) - 'rank' - 'top'))
                       from public.card_hands h
                      where h.room_id = p_room and h.game = 'cao' and h.hand_no = t.hand_no and not (h.seat = any(v_left))),
           'lines', (select coalesce(jsonb_agg(jsonb_build_object('from', l2->'from', 'to', l2->'to', 'xu', t.stake, 'why', l2->'why')
                                               order by n), '[]'::jsonb)
                       from jsonb_array_elements(v_set->'lines') with ordinality e(l2, n)),
           'net', (select jsonb_object_agg(key, value::int * t.stake) from jsonb_each_text(v_set->'net')))
   where room_id = p_room and game = 'cao';
  perform public._card_settle(p_room, 'cao');
  delete from public.card_seats where room_id = p_room and game = 'cao' and leaving;
  update public.card_tables set phase = 'result', turn = null, deadline = p_now + interval '6 seconds'
   where room_id = p_room and game = 'cao';
  for r in select seat from public.card_seats where room_id = p_room and game = 'cao' and missed >= 2 order by seat loop
    perform public._card_leave_seat(p_room, 'cao', r.seat, 'timeout', p_now);
  end loop;
  perform public._card_log(p_room, 'cao', t.hand_no, null, (t.pub->>'dealer')::int, 'end',
                           jsonb_build_object('net', v_set->'net'), p_now);
  perform public._card_reset_if_empty(p_room, 'cao');
end $$;

-- What is due at a Cào table (§10): the automatic deal, the showdown, or the next dealer's wait.
create or replace function public._cao_due(p_room uuid, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_phase text;
begin
  select phase into v_phase from public.card_tables where room_id = p_room and game = 'cao';
  if v_phase = 'deal_wait' then
    perform public._cao_do_deal(p_room, null, p_now, p_deck);
  elsif v_phase = 'peek' then
    perform public._cao_showdown(p_room, p_now);
  elsif v_phase = 'result' then
    perform public._cao_start(p_room, p_now);
  else
    return false;
  end if;
  return true;
end $$;

revoke all on function public._cao_preview(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._cao_start(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._cao_do_deal(uuid, integer, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._cao_cancel(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._cao_leave(uuid, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._cao_showdown(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._cao_due(uuid, timestamptz, integer[]) from public, anon, authenticated;

-- ---------- E. Public RPCs (§11.3): membership first (R38); reads are snapshots (R37); ticks and writes lock and sweep ----------
```

**supabase/migrations/0017_v16_cards.sql — edit 10 of 11.** Replace:

```sql

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
```

with:

```sql

-- Deal (§8.2): the previewed dealer's "Chia bài". Guarded.
create or replace function public.cao_deal(p_room_id uuid, p_session_token text, p_seq integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  return public._card_action(p_room_id, v_account, 'cao', 'cao_deal', p_seq, '{}'::jsonb, now());
end $$;

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 11 of 11.** Append at the end of the file:

```sql
grant execute on function public.cao_deal(uuid, text, integer) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected:

```text
v14 smoke ok
0017 twice ok
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
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(cards): 0017 the Cào engine — the dealer's rotation, the deal under the locks, peek, the showdown; cao_deal

Section D's Cào: the dealer previewed in deal_wait and rotated each hand (a dealer who cannot cover (n − 1) S is skipped),
the deal under the wallet locks with the players rebuilt, the escrows, 15 s to deal and to peek, the dealer's misses, a
player leaving during peek (S lost), `dealer busy`, the showdown lines, and the hand cancelled when its dealer is
removed. cao_deal is guarded; the guard loop gains it (46). Smoke part 5 plays six hands, a table with no dealer and a
wallet drained before the deal.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0017_v16_cards.sql tests/sql/anticheat-guards.sql tests/sql/v16-smoke.sql
git commit -F <message file>
```

---

### Task 6: Database — the poker engine; `pk_act` and `pk_topup` (`0017` section D)

**Files:**
- Modify: `supabase/migrations/0017_v16_cards.sql` (the poker branches of the dispatchers, the poker engine, `pk_act` and `pk_topup`)
- Modify: `tests/sql/anticheat-guards.sql` (the loop calls `pk_act` and `pk_topup`: 48 RPCs)
- Modify: `tests/sql/v16-smoke.sql` (append part 6)

**Interfaces:**
- Consumes: Tasks 1–5 (`_pk_eval`, `_pk_pots`, the machinery, the dispatchers, `card_secrets`).
- Produces (section D, private): `_pk_next(pub, from) → int`, `_pk_pot(pub) → int`, `_pk_deal(room, now, deck) → bool` (the button moves to the next seat with chips, 0-chip seats stood up, the blinds — heads-up: the button posts the small blind and acts first preflop — 2 cards each, the board kept in `card_secrets`), `_pk_after(room, from, now, move)`, `_pk_do_act(room, seat, action, amount, now) → text` (`wrong phase`, `not your turn`, `invalid bet`, `cannot raise`), `_pk_street_end(room, now)`, `_pk_end(room, now, pots, keys, uncontested)`, `_pk_showdown(room, now)`, `_pk_award(room, now)`, `_pk_refund(room, now)`, `_pk_timeout(room, now)` (check when nothing is to call, else fold; the second miss in a row leaves), `_pk_leave(room, seats, how, now)`, `_pk_due(room, now, deck) → bool`, `_pk_topup(room, account, amount, now) → jsonb` (`hand running`, `too many chips`, `not enough coins`).
- Produces (section E): `pk_act(p_room_id, p_session_token, p_seq, p_action, p_amount)` (hard `bad_bet`) and `pk_topup(p_room_id, p_session_token, p_amount)` (hard `bad_qty`: null, < 1 or > 2 000 000), both guarded.
- Produces (smoke): helpers `pg_temp.pt`, `pp`, `chips`, `presult`, `pk_due`, `pk`, `pk_bad`; six hands (§17's poker list); part 6 prints `v16 poker smoke ok`.

- [ ] **Step 1: Write the guard change and smoke part 6**

**tests/sql/anticheat-guards.sql — edit 1 of 2.** Replace:

```sql
    format('select public.tl_pass(%L, %L, 0)', room, t),
    format('select public.cao_deal(%L, %L, 0)', room, t)] loop
    n := n + 1;
```

with:

```sql
    format('select public.tl_pass(%L, %L, 0)', room, t),
    format('select public.cao_deal(%L, %L, 0)', room, t),
    format('select public.pk_act(%L, %L, 0, %L, null)', room, t, 'fold'),
    format('select public.pk_topup(%L, %L, 1000)', room, t)] loop
    n := n + 1;
```

**tests/sql/anticheat-guards.sql — edit 2 of 2.** Replace:

```sql
  end loop;
  assert n = 46, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

with:

```sql
  end loop;
  assert n = 48, format('%s guarded calls', n);
  perform public.fishing_state(t);
```

**tests/sql/v16-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- Poker (§9, §17): four accounts, blinds 500/1 000; time stands still (each step's deadline is moved back) ----------
create function pg_temp.pt() returns public.card_tables language sql as $$
  select * from public.card_tables where room_id = (select v from smoke where k = 'room')::uuid and game = 'poker'
$$;
create function pg_temp.pp(p_seat integer) returns jsonb language sql as $$
  select (pg_temp.pt()).pub->'players'->(p_seat::text)
$$;
create function pg_temp.chips() returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(seat::text, chips), '{}') from public.card_seats
   where room_id = (select v from smoke where k = 'room')::uuid and game = 'poker'
$$;
create function pg_temp.presult() returns jsonb language sql as $$
  select jsonb_build_object('uncontested', t.last->'uncontested', 'net', t.last->'net',
    'pots', (select coalesce(jsonb_agg(jsonb_build_array(x->'xu', x->'seats', x->'winners') order by n), '[]')
               from jsonb_array_elements(t.last->'pots') with ordinality e(x, n)))
    from pg_temp.pt() t
$$;
-- What is due at the poker table: its deadline moved to the past, then a tick with this deck.
create function pg_temp.pk_due(p_deck integer[]) returns public.card_tables language plpgsql as $$
declare room uuid := (select v from smoke where k = 'room')::uuid; r jsonb;
begin
  update public.card_tables set deadline = now() - interval '1 second' where room_id = room and game = 'poker';
  r := public._card_tick(room, (select v from smoke where k = 'a1')::uuid, 'poker', now(), p_deck);
  assert (r->>'changed')::boolean, format('the tick: %s', r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, 'zero-sum after the tick';
  return pg_temp.pt();
end $$;
-- An act with the table's seq: an action answer, and the money in place.
create function pg_temp.pk(p_token text, p_action text, p_amount integer) returns jsonb language plpgsql as $$
declare q integer := (pg_temp.pt()).seq; r jsonb;
begin
  r := public.pk_act((select v from smoke where k = 'room')::uuid, p_token, q, p_action, p_amount);
  assert r ? 'state' and (r->'state'->>'seq')::int > q, format('%s %s: %s', p_action, p_amount, r);
  assert pg_temp.total() = (select v from smoke where k = 'm')::bigint, format('zero-sum after %s', p_action);
  return r;
end $$;
-- An act the state refuses: a soft bad_move with this error, and nothing changes.
create function pg_temp.pk_bad(p_token text, p_action text, p_amount integer, p_error text) returns void language plpgsql as $$
declare q integer := (pg_temp.pt()).seq; r jsonb;
begin
  r := public.pk_act((select v from smoke where k = 'room')::uuid, p_token, q, p_action, p_amount);
  assert pg_temp.env(r, 'bad_move', p_error), format('%s %s: %s, want %s', p_action, p_amount, r, p_error);
  assert (pg_temp.pt()).seq = q, format('%s changed the table', p_action);
end $$;

-- Hands 1–3: heads-up blinds and order, a check and a fold timeout, an uncontested win; the side pot and the short
-- all-in of §9.3.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        t public.card_tables; r jsonb; q integer;
begin
  perform pg_temp.set_coins(a, 500000) from unnest(array[a1, a2, a3, a4]) a;
  update smoke set v = pg_temp.total()::text where k = 'm';
  perform public.card_sit(room, c1, 'poker', 1, 1000, 100000);
  r := public.card_sit(room, c2, 'poker', 2, 1000, 100000);
  assert r->'state'->>'phase' = 'countdown' and (r->'state'->>'deadline')::timestamptz = now() + interval '5 seconds',
    'the 5 s countdown';
  update public.card_tables set pos = 2 where room_id = room and game = 'poker';
  -- hand 1, heads-up (§9.1): the button posts the SB and acts first preflop
  t := pg_temp.pk_due(pg_temp.deck('2C 7D', '3C 8D', '4H 9S JC QD KH'));
  assert t.phase = 'playing' and t.hand_no = 1 and t.pos = 1 and t.turn = 1 and t.deadline = now() + interval '30 seconds'
         and t.pub->'button' = '1' and t.pub->'sb' = '1' and t.pub->'bb' = '2' and t.pub->>'street' = 'preflop'
         and t.pub->'cur' = '1000' and t.pub->'raise' = '1000' and t.pub->'pot' = '1500' and t.pub->'board' = '[]',
    format('heads-up: %s', t.pub);
  assert pg_temp.chips() = '{"1": 99500, "2": 99000}' and pg_temp.pp(1) @> '{"bet": 500, "put": 500, "last": "sb", "pending": true}'
         and pg_temp.pp(2) @> '{"bet": 1000, "put": 1000, "last": "bb", "pending": true}', 'the blinds';
  assert not exists (select 1 from jsonb_each(t.pub->'players') p where p.value ? 'cards'), 'no hole cards in the state';
  -- the hard signals of pk_act (§11.5), in log mode
  q := t.seq;
  assert pg_temp.env(public.pk_act(room, c1, q, 'shove', null), 'bad_bet', 'invalid bet'), 'an unknown action';
  assert pg_temp.env(public.pk_act(room, c1, q, null, null), 'bad_bet', 'invalid bet'), 'no action';
  assert pg_temp.env(public.pk_act(room, c1, q, 'raise', null), 'bad_bet', 'invalid bet'), 'a raise with no amount';
  assert pg_temp.env(public.pk_act(room, c1, q, 'bet', -1), 'bad_bet', 'invalid bet'), 'a negative bet';
  assert pg_temp.env(public.pk_act(room, c1, q, 'raise', 2000000001), 'bad_bet', 'invalid bet'), 'above 2·10⁹';
  assert (select count(*) from public.anticheat_events where account_id = a1 and code = 'bad_bet' and outcome = 'log_only'
            and rpc = 'pk_act') = 5, 'five hard signals logged';
  assert pg_temp.err(format('select public.pk_act(%L, %L, %s, %L, null)', room, c1, q + 1, 'call')) = 'stale', 'stale';
  -- refused acts are soft (R30)
  perform pg_temp.pk_bad(c2, 'check', null, 'not your turn');
  perform pg_temp.pk_bad(c1, 'check', null, 'invalid bet');
  perform pg_temp.pk_bad(c1, 'bet', 3000, 'invalid bet');
  perform pg_temp.pk_bad(c1, 'raise', 1500, 'invalid bet');
  perform pg_temp.pk_bad(c1, 'raise', 100001, 'invalid bet');
  perform pg_temp.pk(c1, 'call', null);
  assert (pg_temp.pt()).turn = 2 and pg_temp.chips() = '{"1": 99000, "2": 99000}', 'A completes; the BB''s option';
  -- the BB's turn runs out with nothing to call: a check (§10); the flop, where the BB acts first
  t := pg_temp.pk_due(null);
  assert t.pub->>'street' = 'flop' and t.turn = 2 and t.pub->'board' = to_jsonb(pg_temp.hand('4H 9S JC')) and t.pub->'cur' = '0'
         and pg_temp.pp(2) @> '{"last": "check", "bet": 0}'
         and (select missed from public.card_seats where room_id = room and game = 'poker' and seat = 2) = 1,
    format('the check timeout: %s', t.pub);
  perform pg_temp.pk(c2, 'check', null);
  assert (select missed from public.card_seats where room_id = room and game = 'poker' and seat = 2) = 0, 'a real act resets';
  perform pg_temp.pk_bad(c1, 'bet', 999, 'invalid bet');
  perform pg_temp.pk(c1, 'bet', 2000);
  -- facing a bet the turn runs out: a fold, and A wins uncontested, no card shown, 3 s
  t := pg_temp.pk_due(null);
  assert t.phase = 'result' and t.deadline = now() + interval '3 seconds'
         and pg_temp.presult() = '{"pots": [[4000, [1], [1]]], "net": {"1": 1000, "2": -1000}, "uncontested": true}'
         and t.last->'shown' = '{}' and t.last->'board' = to_jsonb(pg_temp.hand('4H 9S JC'))
         and pg_temp.chips() = '{"1": 101000, "2": 99000}', format('uncontested: %s', t.last);
  perform pg_temp.pk_bad(c1, 'check', null, 'wrong phase');
  -- hand 2 (§9.3, the side pot): A (button) 60 000, B (SB) 8 000, C (BB) 40 000
  perform public.card_sit(room, c3, 'poker', 3, 1000, 50000);
  update public.card_seats set chips = case seat when 1 then 60000 when 2 then 8000 else 40000 end
   where room_id = room and game = 'poker';
  update public.card_tables set pos = 3 where room_id = room and game = 'poker';
  update smoke set v = pg_temp.total()::text where k = 'm';
  t := pg_temp.pk_due(pg_temp.deck('KH KD', 'AS AH', 'QC 3D', '2S 7D 9C JH 4C'));
  assert t.pub->'button' = '1' and t.pub->'sb' = '2' and t.pub->'bb' = '3' and t.turn = 1, 'left of the BB acts first';
  perform pg_temp.pk(c1, 'raise', 3000);
  perform pg_temp.pk(c2, 'allin', null);
  t := pg_temp.pt();
  assert t.pub->'cur' = '8000' and t.pub->'raise' = '5000' and pg_temp.pp(2) @> '{"allin": true, "put": 8000}' and t.turn = 3,
    format('an all-in full raise: %s', t.pub);
  perform pg_temp.pk(c3, 'call', null);
  perform pg_temp.pk(c1, 'call', null);
  t := pg_temp.pt();
  assert t.pub->>'street' = 'flop' and t.turn = 3 and t.pub->'pot' = '24000', format('the flop: %s', t.pub);
  perform pg_temp.pk(c3, 'bet', 10000);
  perform pg_temp.pk(c1, 'call', null);
  perform pg_temp.pk(c3, 'check', null);
  perform pg_temp.pk(c1, 'check', null);
  perform pg_temp.pk(c3, 'check', null);
  perform pg_temp.pk(c1, 'check', null);
  t := pg_temp.pt();
  assert pg_temp.presult() = '{"pots": [[24000, [1, 2, 3], [2]], [20000, [1, 3], [1]]], "net": {"1": 2000, "2": 16000, "3": -18000},
                              "uncontested": false}', format('the side pot: %s', t.last);
  assert t.last->'pots'->0->'hand' = '[1, 14, 11, 9, 7]' and t.last->'pots'->1->'hand' = '[1, 13, 11, 9, 7]'
         and t.last->'shown' = jsonb_build_object('1', pg_temp.sorted('KH KD'), '2', pg_temp.sorted('AS AH'), '3', pg_temp.sorted('QC 3D'))
         and t.last->'board' = to_jsonb(pg_temp.hand('2S 7D 9C JH 4C')) and t.deadline = now() + interval '6 seconds'
         and pg_temp.chips() = '{"1": 62000, "2": 24000, "3": 22000}', format('every live hand shown: %s', t.last);
  -- hand 3 (§9.3, the short all-in): A bets 4 000, B all-in for 5 000, C calls; A may call or fold, not raise (TDA 47)
  update public.card_seats set chips = case seat when 2 then 6000 else 50000 end where room_id = room and game = 'poker';
  update public.card_tables set pos = 2 where room_id = room and game = 'poker';
  update smoke set v = pg_temp.total()::text where k = 'm';
  t := pg_temp.pk_due(pg_temp.deck('AC AD', 'QD JD', 'KC KS', '2H 5S 8C 9D 3C'));
  assert t.pub->'button' = '3' and t.pub->'sb' = '1' and t.pub->'bb' = '2' and t.turn = 3, 'C is the button';
  perform pg_temp.pk(c3, 'call', null);
  perform pg_temp.pk(c1, 'call', null);
  perform pg_temp.pk(c2, 'check', null);
  assert (pg_temp.pt()).pub->>'street' = 'flop' and (pg_temp.pt()).turn = 1, 'left of the button acts first after the flop';
  perform pg_temp.pk(c1, 'bet', 4000);
  perform pg_temp.pk(c2, 'allin', null);
  t := pg_temp.pt();
  assert t.pub->'cur' = '5000' and t.pub->'raise' = '4000' and t.turn = 3, format('a short all-in: %s', t.pub);
  perform pg_temp.pk(c3, 'call', null);
  perform pg_temp.pk_bad(c1, 'raise', 9000, 'cannot raise');
  perform pg_temp.pk_bad(c1, 'allin', null, 'cannot raise');
  perform pg_temp.pk(c1, 'call', null);
  perform pg_temp.pk(c1, 'check', null);
  perform pg_temp.pk(c3, 'check', null);
  perform pg_temp.pk(c1, 'check', null);
  perform pg_temp.pk(c3, 'check', null);
  assert pg_temp.presult() = '{"pots": [[18000, [1, 2, 3], [1]]], "net": {"1": 12000, "2": -6000, "3": -6000}, "uncontested": false}'
         and pg_temp.chips() = '{"1": 62000, "2": 0, "3": 44000}', format('the short all-in: %s', pg_temp.presult());
end $$;

-- Top-ups (R23); hand 4: the 0-chip seat stands up at the deal, and C's second timeout in a row leaves the hand (§6.3).
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        t public.card_tables;
begin
  assert pg_temp.env(public.pk_topup(room, c2, 0), 'bad_qty', 'invalid quantity'), 'a zero top-up';
  assert pg_temp.env(public.pk_topup(room, c2, -5), 'bad_qty', 'invalid quantity'), 'a negative top-up';
  assert pg_temp.env(public.pk_topup(room, c2, null), 'bad_qty', 'invalid quantity'), 'no amount';
  assert pg_temp.env(public.pk_topup(room, c2, 2000001), 'bad_qty', 'invalid quantity'), 'more than any table allows';
  assert pg_temp.err(format('select public.pk_topup(%L, %L, 200001)', room, c2)) = 'too many chips', '200 BB at most';
  assert pg_temp.err(format('select public.pk_topup(%L, %L, 1000)', room, c4)) = 'not seated', 'D has no seat';
  perform public.card_sit(room, c4, 'poker', 4, 1000, 50000);
  t := pg_temp.pk_due(pg_temp.deck('AH AS', 'QS QH', '2D 7C', '3S 8H 9D JC 4D'));
  assert t.hand_no = 4 and t.pub->'order' = '[1, 3, 4]' and t.pub->'button' = '4' and t.pub->'sb' = '1' and t.pub->'bb' = '3'
         and t.turn = 4 and not exists (select 1 from public.card_seats where room_id = room and account_id = a2)
         and (select count(*) from public.card_log where room_id = room and game = 'poker' and account_id = a2 and action = 'leave'
                and detail->>'how' = 'idle') = 1, format('B had no chips and stood up: %s', t.pub);
  perform pg_temp.pk(c4, 'call', null);
  perform pg_temp.pk(c1, 'call', null);
  t := pg_temp.pk_due(null);
  assert t.pub->>'street' = 'flop' and t.turn = 1
         and (select missed from public.card_seats where room_id = room and game = 'poker' and seat = 3) = 1, 'C checked by timeout';
  perform pg_temp.pk(c1, 'check', null);
  t := pg_temp.pk_due(null);
  assert t.turn = 4 and pg_temp.pp(3) @> '{"fold": true, "last": "timeout", "put": 1000}'
         and (select leaving and chips = 0 and missed = 2 from public.card_seats where room_id = room and game = 'poker' and seat = 3)
         and pg_temp.coins(a3) = 493000, format('the second miss: C folds and its stack goes home: %s', t.pub);
  assert pg_temp.err(format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c3, 'cao')) = 'still leaving', 'still leaving';
  perform pg_temp.pk(c4, 'check', null);
  perform pg_temp.pk(c1, 'check', null);
  perform pg_temp.pk(c4, 'check', null);
  perform pg_temp.pk(c1, 'check', null);
  perform pg_temp.pk(c4, 'check', null);
  t := pg_temp.pt();
  assert pg_temp.presult() = '{"pots": [[3000, [1, 4], [1]]], "net": {"1": 2000, "3": -1000, "4": -1000}, "uncontested": false}'
         and t.last->'shown' = jsonb_build_object('1', pg_temp.sorted('AH AS'), '4', pg_temp.sorted('2D 7C'))
         and not exists (select 1 from public.card_seats where room_id = room and account_id = a3),
    format('C''s chips stay in the pot; its row goes with the hand: %s', t.last);
end $$;

-- Hand 5: a 3-way all-in — B's uncalled 14 000 comes back, two side pots, and the odd xu (TDA 20). Hand 6: B stands up
-- holding the top bet — its uncalled part is dead money in the top pot; top-ups during a hand.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        a2 uuid := (select v from smoke where k = 'a2')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        t public.card_tables; r jsonb;
begin
  perform public.card_sit(room, c2, 'poker', 2, 1000, 50000);
  update public.card_seats set chips = case seat when 1 then 3001 when 2 then 20000 else 6000 end
   where room_id = room and game = 'poker';
  update smoke set v = pg_temp.total()::text where k = 'm';
  t := pg_temp.pk_due(pg_temp.deck('QC 3D', 'JS 5D', 'QD 4C', 'KS KD 7C 7H 2S'));
  assert t.pub->'button' = '1' and t.pub->'sb' = '2' and t.pub->'bb' = '4' and t.turn = 1, 'A is the button';
  perform pg_temp.pk(c1, 'allin', null);
  perform pg_temp.pk(c2, 'allin', null);
  perform pg_temp.pk(c4, 'allin', null);
  t := pg_temp.pt();
  assert t.phase = 'result' and t.last->'board' = to_jsonb(pg_temp.hand('KS KD 7C 7H 2S'))
         and pg_temp.presult() = '{"pots": [[9003, [1, 2, 4], [1, 4]], [5998, [2, 4], [4]]], "net": {"1": 1500, "2": -6000, "4": 4500},
                                   "uncontested": false}', format('a 3-way all-in: %s', t.last);
  assert pg_temp.chips() = '{"1": 4501, "2": 14000, "4": 10500}', format('the odd xu to D, first left of the button: %s', pg_temp.chips());
  -- hand 6: the button B raises to 10 000 and stands up while D is to act
  update public.card_seats set chips = case seat when 1 then 3000 when 4 then 6000 else chips end
   where room_id = room and game = 'poker';
  update smoke set v = pg_temp.total()::text where k = 'm';
  t := pg_temp.pk_due(pg_temp.deck('AS AD', '2H 7S', 'KS KD', '2C 6H 9D JC 4S'));
  assert t.pub->'button' = '2' and t.pub->'sb' = '4' and t.pub->'bb' = '1' and t.turn = 2, 'B is the button';
  perform pg_temp.pk(c2, 'raise', 10000);
  r := public.card_leave(room, c2, 'poker');
  t := pg_temp.pt();
  assert t.turn = 4 and pg_temp.pp(2) @> '{"fold": true, "last": "left", "put": 10000}'
         and (select leaving and chips = 0 and missed = 0 from public.card_seats where room_id = room and game = 'poker' and seat = 2)
         and (r->>'coins')::int = 354000 and pg_temp.coins(a2) = 354000 and pg_temp.total() = (select v from smoke where k = 'm')::bigint,
    format('B stood up mid-hand: %s', t.pub);
  -- the caller in the live hand cannot top up; a seat that is not in it can (R23)
  assert pg_temp.err(format('select public.pk_topup(%L, %L, 1000)', room, c1)) = 'hand running', 'hand running';
  perform public.card_sit(room, c3, 'poker', 3, 1000, 50000);
  r := public.pk_topup(room, c3, 10000);
  assert (r->>'coins')::int = 433000 and pg_temp.coins(a3) = 433000
         and (select chips from public.card_seats where room_id = room and game = 'poker' and seat = 3) = 60000
         and (select reason = 'card_buyin' and delta = -10000 and ref = 'pk#6' from public.coin_ledger
               where account_id = a3 order by id desc limit 1), format('a top-up: %s', r);
  assert pg_temp.err(format('select public.pk_topup(%L, %L, 140001)', room, c3)) = 'too many chips', 'too many chips';
  perform pg_temp.pk(c4, 'allin', null);
  perform pg_temp.pk(c1, 'allin', null);
  assert pg_temp.presult() = '{"pots": [[9000, [1, 4], [1]], [10000, [4], [4]]], "net": {"1": 6000, "2": -10000, "4": 4000},
                              "uncontested": false}', format('dead money in the top pot: %s', pg_temp.presult());
  assert pg_temp.chips() = '{"1": 9000, "3": 60000, "4": 10000}'
         and not exists (select 1 from public.card_seats where room_id = room and account_id = a2), 'B''s row goes with the hand';
  -- standing up between hands cashes the stack out, and the empty table resets
  perform public.card_leave(room, c1, 'poker');
  perform public.card_leave(room, c3, 'poker');
  r := public.card_leave(room, c4, 'poker');
  assert r->'state'->'seats' = '[]' and r->'state'->'stake' = 'null' and pg_temp.total() = (select v from smoke where k = 'm')::bigint
         and not exists (select 1 from public.card_seats where room_id = room)
         and (select count(*) from public.coin_ledger where reason = 'card_cashout' and ref = 'pk#6') >= 3, 'all cashed out';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '\_pk\_%'
                      and has_function_privilege('anon', p.oid, 'execute')), 'the poker helpers are private';
end $$;

select 'v16 poker smoke ok' as result;
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected: `FAILED: tests/sql/anticheat-smoke.sql` — the guard loop now calls `pk_act`: `function public.pk_act(unknown, unknown, integer, unknown, unknown) does not exist` in the log.

- [ ] **Step 3: Write the poker engine and its RPCs**

**supabase/migrations/0017_v16_cards.sql — edit 1 of 6.** Replace:

```sql
    perform public._cao_leave(p_room, p_seats, p_how, p_now);
  end if;
```

with:

```sql
    perform public._cao_leave(p_room, p_seats, p_how, p_now);
  elsif p_game = 'poker' then
    perform public._pk_leave(p_room, p_seats, p_how, p_now);
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 2 of 6.** Replace:

```sql
    return public._cao_due(p_room, p_now, p_deck);
  end if;
```

with:

```sql
    return public._cao_due(p_room, p_now, p_deck);
  elsif p_game = 'poker' then
    return public._pk_due(p_room, p_now, p_deck);
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 3 of 6.** Replace:

```sql
    v_err := public._cao_do_deal(p_room, v_seat, p_now, p_deck);
  end if;
```

with:

```sql
    v_err := public._cao_do_deal(p_room, v_seat, p_now, p_deck);
  elsif p_kind = 'pk_act' then
    v_err := public._pk_do_act(p_room, v_seat, p_args->>'action', (p_args->>'amount')::int, p_now);
  end if;
```

**supabase/migrations/0017_v16_cards.sql — edit 4 of 6.** Replace:

```sql

-- ---------- E. Public RPCs (§11.3): membership first (R38); reads are snapshots (R37); ticks and writes lock and sweep ----------
```

with:

```sql

-- Poker (§9). The next seat to act after p_from (§9.1): the first pending seat in turn order, p_from itself last.
create or replace function public._pk_next(p_pub jsonb, p_from integer) returns integer
language sql immutable set search_path = public, extensions
as $$
  select s from unnest(public._card_after(public._card_ints(p_pub->'order'), p_from) || p_from) with ordinality u(s, n)
   where coalesce((p_pub->'players'->(s::text)->>'pending')::boolean, false) order by n limit 1
$$;

-- The total in the pot (§11.4): every seat's `put`, folded seats included.
create or replace function public._pk_pot(p_pub jsonb) returns integer
language sql immutable set search_path = public, extensions
as $$ select coalesce(sum((value->>'put')::int), 0)::int from jsonb_each(coalesce(p_pub->'players', '{}'::jsonb)) $$;

-- The deal (§9.2): the table's wallets locked; the unseen (R28) and the seats with no chips (R23) stand up, their stacks
-- cashed out; fewer than two → idle. The button moves to the next player (a random one when the table has none), the
-- blinds are posted (a short stack posts what it has; the call stays a full BB), 2 cards each in seat order, and the
-- board is kept secret until its street.
create or replace function public._pk_deal(p_room uuid, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; r record; v_players integer[]; n integer; v_btn integer; v_sb integer; v_bb integer;
        v_deck integer[]; v_hand integer; i integer; v_cards integer[]; v_pub jsonb; v_chips integer; v_amt integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  perform public._card_lock_wallets(p_room, 'poker');
  for r in select seat from public.card_seats
            where room_id = p_room and game = 'poker' and not leaving and (seen_at < p_now - interval '60 seconds' or chips = 0)
            order by seat loop
    perform public._card_leave_seat(p_room, 'poker', r.seat, 'idle', p_now);
  end loop;
  v_players := array(select seat from public.card_seats where room_id = p_room and game = 'poker' and not leaving order by seat);
  n := cardinality(v_players);
  if n < 2 then
    update public.card_tables set phase = 'idle', turn = null, deadline = null, pub = '{}'::jsonb
     where room_id = p_room and game = 'poker';
    return true;
  end if;
  v_btn := case when t.pos is null then v_players[1 + public._card_rand(n)] else (public._card_after(v_players, t.pos))[1] end;
  v_sb := case when n = 2 then v_btn else (public._card_after(v_players, v_btn))[1] end;
  v_bb := (public._card_after(v_players, v_sb))[1];
  v_deck := coalesce(p_deck, public._card_shuffle());
  v_hand := t.hand_no + 1;
  delete from public.card_hands where room_id = p_room and game = 'poker';
  delete from public.card_secrets where room_id = p_room and game = 'poker';
  for i in 1..n loop
    v_cards := array(select c from unnest(v_deck[2 * i - 1 : 2 * i]) c order by c);
    insert into public.card_hands (room_id, game, hand_no, seat, account_id, dealt, cards)
    select p_room, 'poker', v_hand, v_players[i], account_id, v_cards, v_cards
      from public.card_seats where room_id = p_room and game = 'poker' and seat = v_players[i];
  end loop;
  insert into public.card_secrets (room_id, game, hand_no, board) values (p_room, 'poker', v_hand, v_deck[2 * n + 1 : 2 * n + 5]);
  v_pub := jsonb_build_object('button', v_btn, 'sb', v_sb, 'bb', v_bb, 'street', 'preflop', 'board', '[]'::jsonb,
             'cur', t.stake, 'raise', t.stake, 'pot', 0, 'order', to_jsonb(v_players),
             'players', (select jsonb_object_agg(cs.seat::text, jsonb_build_object('id', cs.account_id, 'bet', 0, 'put', 0,
                                  'fold', false, 'allin', false, 'acted', null, 'pending', true, 'last', null))
                           from public.card_seats cs where cs.room_id = p_room and cs.game = 'poker' and cs.seat = any(v_players)));
  for r in select * from (values (v_sb, t.stake / 2, 'sb'), (v_bb, t.stake, 'bb')) b(seat, blind, what) loop
    select chips into v_chips from public.card_seats where room_id = p_room and game = 'poker' and seat = r.seat;
    v_amt := least(v_chips, r.blind);
    update public.card_seats set chips = chips - v_amt where room_id = p_room and game = 'poker' and seat = r.seat;
    v_pub := jsonb_set(v_pub, array['players', r.seat::text], v_pub->'players'->(r.seat::text)
               || jsonb_build_object('bet', v_amt, 'put', v_amt, 'allin', v_chips = v_amt, 'pending', v_chips > v_amt, 'last', r.what));
  end loop;
  v_pub := jsonb_set(v_pub, '{pot}', to_jsonb(public._pk_pot(v_pub)));
  update public.card_tables
     set hand_no = v_hand, pos = v_btn, phase = 'playing', turn = null, deadline = p_now + interval '30 seconds', pub = v_pub
   where room_id = p_room and game = 'poker';
  perform public._card_log(p_room, 'poker', v_hand, null, v_btn, 'deal',
    jsonb_build_object('hands', (select jsonb_object_agg(seat::text, to_jsonb(dealt)) from public.card_hands
                                  where room_id = p_room and game = 'poker'), 'board', to_jsonb(v_deck[2 * n + 1 : 2 * n + 5])), p_now);
  delete from public.card_log where id in (select id from public.card_log where at < p_now - interval '14 days' order by at limit 500);
  -- preflop starts left of the BB (heads-up: the button)
  perform public._pk_after(p_room, v_bb, p_now, true);
  return true;
end $$;

-- The checks after an act (§9.2): nobody left in the hand → refund; one player left → the pots to them (uncontested);
-- nobody to act → the street ends; else the next pending seat (only when the turn moves: a player who leaves out of
-- turn does not move it).
create or replace function public._pk_after(p_room uuid, p_from integer, p_now timestamptz, p_move boolean) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare v_pub jsonb; v_live integer;
begin
  select pub into v_pub from public.card_tables where room_id = p_room and game = 'poker';
  v_live := (select count(*) from jsonb_each(v_pub->'players') where not (value->>'fold')::boolean);
  if v_live = 0 then
    perform public._pk_refund(p_room, p_now);
  elsif v_live = 1 then
    perform public._pk_award(p_room, p_now);
  elsif not exists (select 1 from jsonb_each(v_pub->'players') where (value->>'pending')::boolean) then
    perform public._pk_street_end(p_room, p_now);
  elsif p_move then
    update public.card_tables set turn = public._pk_next(v_pub, p_from), deadline = p_now + interval '30 seconds'
     where room_id = p_room and game = 'poker';
  end if;
end $$;

-- An act (§9.1): the refusal of a move that is not legal (a bad_move, §11.5), else null. `raise` is the size of the last
-- full bet or raise this street; a player may raise when it has not acted this street or when cur − acted ≥ raise, so a
-- short all-in does not re-open raising (TDA 47).
create or replace function public._pk_do_act(p_room uuid, p_seat integer, p_action text, p_amount integer, p_now timestamptz)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; p jsonb; s text := p_seat::text; v_chips integer; v_bet integer; v_cur integer;
        v_raise integer; v_to integer; v_amt integer; v_may boolean; v_full boolean; q text;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  if t.phase <> 'playing' then
    return 'wrong phase';
  end if;
  v_pub := t.pub;
  p := v_pub->'players'->s;
  select chips into v_chips from public.card_seats
   where room_id = p_room and game = 'poker' and seat = p_seat and account_id = (p->>'id')::uuid and not leaving;
  if t.turn is distinct from p_seat or p is null or v_chips is null or (p->>'fold')::boolean or (p->>'allin')::boolean then
    return 'not your turn';
  end if;
  v_bet := (p->>'bet')::int;
  v_cur := (v_pub->>'cur')::int;
  v_raise := (v_pub->>'raise')::int;
  v_may := jsonb_typeof(p->'acted') is distinct from 'number' or v_cur - (p->>'acted')::int >= v_raise;
  if p_action is null or p_action not in ('fold', 'check', 'call', 'bet', 'raise', 'allin')
     or (p_action in ('bet', 'raise') and p_amount is null) then
    return 'invalid bet';
  elsif p_action = 'check' then
    if v_cur > v_bet then
      return 'invalid bet';
    end if;
    v_to := v_bet;
  elsif p_action = 'call' then
    if v_cur <= v_bet then
      return 'invalid bet';
    end if;
    v_to := least(v_cur, v_bet + v_chips);
  elsif p_action = 'bet' then
    if v_cur > 0 or p_amount > v_bet + v_chips or p_amount <= 0 or (p_amount < t.stake and p_amount <> v_bet + v_chips) then
      return 'invalid bet';
    end if;
    v_to := p_amount;
  elsif p_action = 'raise' then
    if v_cur = 0 or p_amount <= v_cur or p_amount > v_bet + v_chips then
      return 'invalid bet';
    end if;
    if not v_may then
      return 'cannot raise';
    end if;
    if p_amount < v_cur + v_raise and p_amount <> v_bet + v_chips then
      return 'invalid bet';
    end if;
    v_to := p_amount;
  elsif p_action = 'allin' then
    v_to := v_bet + v_chips;
    if v_to > v_cur and not v_may then
      return 'cannot raise';
    end if;
  end if;
  if p_action = 'fold' then
    p := p || jsonb_build_object('fold', true, 'pending', false, 'last', 'fold');
  else
    v_amt := v_to - v_bet;
    update public.card_seats set chips = chips - v_amt where room_id = p_room and game = 'poker' and seat = p_seat;
    p := p || jsonb_build_object('bet', v_to, 'put', (p->>'put')::int + v_amt, 'allin', v_amt = v_chips, 'pending', false,
                                 'last', p_action);
    if v_to > v_cur then
      v_full := v_to - v_cur >= v_raise or (v_cur = 0 and v_to >= t.stake);
      if v_full then
        v_raise := v_to - v_cur;
      end if;
      -- a full bet or raise re-opens the street for every other live player; a short all-in only for those below it
      for q in select key from jsonb_each(v_pub->'players')
                where key <> s and not (value->>'fold')::boolean and not (value->>'allin')::boolean
                  and (v_full or (value->>'bet')::int < v_to) loop
        v_pub := jsonb_set(v_pub, array['players', q, 'pending'], 'true');
      end loop;
      v_cur := v_to;
    end if;
    p := p || jsonb_build_object('acted', v_cur);
  end if;
  v_pub := jsonb_set(v_pub, array['players', s], p) || jsonb_build_object('cur', v_cur, 'raise', v_raise);
  v_pub := jsonb_set(v_pub, '{pot}', to_jsonb(public._pk_pot(v_pub)));
  update public.card_tables set pub = v_pub where room_id = p_room and game = 'poker';
  perform public._card_log(p_room, 'poker', t.hand_no, (p->>'id')::uuid, p_seat, 'act',
                           jsonb_build_object('action', p_action, 'to', v_to), p_now);
  perform public._pk_after(p_room, p_seat, p_now, true);
  return null;
end $$;

-- The end of a street (§9.2): the uncalled part of the top bet goes back to its owner if still live (a folded owner's
-- stays as dead money); with at most one live player able to act, or after the river, the board is revealed and the
-- hands shown; else the next street.
create or replace function public._pk_street_end(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; v_seat text; v_top integer; v_back integer; v_board integer[]; v_street text;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  v_pub := t.pub;
  select key, (value->>'bet')::int into v_seat, v_top from jsonb_each(v_pub->'players')
   order by (value->>'bet')::int desc, key limit 1;
  v_back := v_top - coalesce((select max((value->>'bet')::int) from jsonb_each(v_pub->'players') where key <> v_seat), 0);
  if v_back > 0 and not (v_pub->'players'->v_seat->>'fold')::boolean then
    update public.card_seats set chips = chips + v_back
     where room_id = p_room and game = 'poker' and seat = v_seat::int and account_id = (v_pub->'players'->v_seat->>'id')::uuid;
    v_pub := jsonb_set(v_pub, array['players', v_seat], v_pub->'players'->v_seat || jsonb_build_object(
               'bet', v_top - v_back, 'put', (v_pub->'players'->v_seat->>'put')::int - v_back, 'allin', false));
    v_pub := jsonb_set(v_pub, '{pot}', to_jsonb(public._pk_pot(v_pub)));
  end if;
  v_board := (select board from public.card_secrets where room_id = p_room and game = 'poker' and hand_no = t.hand_no);
  if v_pub->>'street' = 'river'
     or (select count(*) from jsonb_each(v_pub->'players')
          where not (value->>'fold')::boolean and not (value->>'allin')::boolean) <= 1 then
    update public.card_tables set pub = v_pub || jsonb_build_object('board', to_jsonb(v_board))
     where room_id = p_room and game = 'poker';
    perform public._pk_showdown(p_room, p_now);
    return;
  end if;
  v_street := case v_pub->>'street' when 'preflop' then 'flop' when 'flop' then 'turn' else 'river' end;
  v_pub := v_pub || jsonb_build_object('street', v_street, 'cur', 0, 'raise', t.stake,
             'board', to_jsonb(v_board[1 : case v_street when 'flop' then 3 when 'turn' then 4 else 5 end]),
             'players', (select jsonb_object_agg(key, value || jsonb_build_object('bet', 0, 'acted', null,
                                  'pending', not (value->>'fold')::boolean and not (value->>'allin')::boolean))
                           from jsonb_each(v_pub->'players')));
  update public.card_tables
     set pub = v_pub, turn = public._pk_next(v_pub, (v_pub->>'button')::int), deadline = p_now + interval '30 seconds'
   where room_id = p_room and game = 'poker';
end $$;

-- A hand's end (§9.1, §9.2): the pots' shares go to the winners' stacks; `last` holds the board, the hands shown (none
-- when uncontested), the pots with their winners and hand, and every seat's net; the result lasts 6 s (3 s uncontested);
-- the leaving rows go.
create or replace function public._pk_end(p_room uuid, p_now timestamptz, p_pots jsonb, p_keys jsonb, p_uncontested boolean)
returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; pot jsonb; sh record; v_won jsonb := '{}'::jsonb;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  for pot in select value from jsonb_array_elements(p_pots) loop
    for sh in select key, value::int as xu from jsonb_each_text(coalesce(pot->'shares', '{}'::jsonb)) loop
      update public.card_seats set chips = chips + sh.xu
       where room_id = p_room and game = 'poker' and seat = sh.key::int
         and account_id = (t.pub->'players'->sh.key->>'id')::uuid;
      v_won := v_won || jsonb_build_object(sh.key, coalesce((v_won->>sh.key)::int, 0) + sh.xu);
    end loop;
  end loop;
  update public.card_tables
     set last = jsonb_build_object('hand_no', t.hand_no, 'board', t.pub->'board', 'uncontested', p_uncontested,
           'shown', case when p_keys is null then '{}'::jsonb
                    else (select coalesce(jsonb_object_agg(h.seat::text, to_jsonb(h.cards)), '{}'::jsonb) from public.card_hands h
                           where h.room_id = p_room and h.game = 'poker' and h.hand_no = t.hand_no and p_keys ? h.seat::text) end,
           'pots', (select coalesce(jsonb_agg(jsonb_build_object('xu', x->'xu', 'seats', x->'seats', 'winners', x->'winners',
                                                                 'hand', p_keys->(x->'winners'->>0)) order by n), '[]'::jsonb)
                      from jsonb_array_elements(p_pots) with ordinality e(x, n)),
           'net', (select jsonb_object_agg(key, coalesce((v_won->>key)::int, 0) - (value->>'put')::int)
                     from jsonb_each(t.pub->'players'))),
         phase = 'result', turn = null,
         deadline = p_now + case when p_uncontested then interval '3 seconds' else interval '6 seconds' end
   where room_id = p_room and game = 'poker';
  delete from public.card_seats where room_id = p_room and game = 'poker' and leaving;
  perform public._card_log(p_room, 'poker', t.hand_no, null, null, 'end',
                           (select jsonb_build_object('net', last->'net') from public.card_tables
                             where room_id = p_room and game = 'poker'), p_now);
  perform public._card_reset_if_empty(p_room, 'poker');
end $$;

-- The showdown (§9.1, R21): every live hand is shown, and the pots are split among the best hands.
create or replace function public._pk_showdown(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_board integer[]; v_keys jsonb;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  v_board := public._card_ints(t.pub->'board');
  v_keys := (select jsonb_object_agg(h.seat::text, to_jsonb(public._pk_eval(h.cards || v_board)))
               from public.card_hands h
              where h.room_id = p_room and h.game = 'poker' and h.hand_no = t.hand_no
                and not coalesce((t.pub->'players'->(h.seat::text)->>'fold')::boolean, true));
  perform public._pk_end(p_room, p_now,
    public._pk_pots(jsonb_build_object('players', t.pub->'players', 'keys', v_keys, 'button', t.pub->'button')), v_keys, false);
end $$;

-- One player left (§9.2): every pot goes to them, and no card is shown.
create or replace function public._pk_award(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  perform public._pk_end(p_room, p_now,
    public._pk_pots(jsonb_build_object('players', t.pub->'players', 'button', t.pub->'button')), null, true);
end $$;

-- Nobody left in the hand (every live player removed by one sweep): each contribution goes back to its contributor — to
-- the stack while the seat is still theirs, else to the wallet (card_refund) — and the hand ends without a winner.
create or replace function public._pk_refund(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; r record;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  for r in select key::int as seat, (value->>'id')::uuid as id, (value->>'put')::int as put from jsonb_each(t.pub->'players')
            where (value->>'put')::int > 0 order by (value->>'id') loop
    update public.card_seats set chips = chips + r.put
     where room_id = p_room and game = 'poker' and seat = r.seat and account_id = r.id and not leaving;
    if not found then
      perform public._wallet_lock(r.id);
      perform public._pay(r.id, r.put, 'card_refund', public._card_ref('poker', t.hand_no));
    end if;
  end loop;
  update public.card_tables
     set last = jsonb_build_object('hand_no', t.hand_no, 'board', t.pub->'board', 'uncontested', false, 'cancelled', true,
                                   'shown', '{}'::jsonb, 'pots', '[]'::jsonb,
                                   'net', (select jsonb_object_agg(key, 0) from jsonb_each(t.pub->'players'))),
         phase = 'result', turn = null, deadline = p_now + interval '6 seconds'
   where room_id = p_room and game = 'poker';
  delete from public.card_seats where room_id = p_room and game = 'poker' and leaving;
  perform public._card_log(p_room, 'poker', t.hand_no, null, null, 'refund', '{}'::jsonb, p_now);
  perform public._card_reset_if_empty(p_room, 'poker');
end $$;

-- A turn that ran out (§10): check when nothing is to call, else fold; the second miss in a row leaves the hand as
-- card_leave would (§6.3).
create or replace function public._pk_timeout(p_room uuid, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_missed integer; v_acc uuid;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  update public.card_seats set missed = missed + 1 where room_id = p_room and game = 'poker' and seat = t.turn
  returning missed, account_id into v_missed, v_acc;
  perform public._card_log(p_room, 'poker', t.hand_no, v_acc, t.turn, 'timeout', jsonb_build_object('missed', v_missed), p_now);
  if v_missed >= 2 then
    perform public._card_leave_seat(p_room, 'poker', t.turn, 'timeout', p_now);
  else
    perform public._pk_do_act(p_room, t.turn,
      case when (t.pub->>'cur')::int > (t.pub->'players'->(t.turn::text)->>'bet')::int then 'fold' else 'check' end, null, p_now);
  end if;
end $$;

-- The leave operation in a live hand (§6.3), with the table's wallets locked: the seats fold, even out of turn; their
-- stacks go back to their wallets at once (card_cashout) and what they put stays in the pot; the rows stay `leaving`
-- (chips 0) until the hand ends. Then the checks after an act; the turn moves on only if it was theirs.
create or replace function public._pk_leave(p_room uuid, p_seats integer[], p_how text, p_now timestamptz) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_pub jsonb; s integer;
begin
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  v_pub := t.pub;
  foreach s in array p_seats loop
    v_pub := jsonb_set(v_pub, array['players', s::text], v_pub->'players'->(s::text) || jsonb_build_object(
               'fold', true, 'pending', false, 'last', case when p_how = 'timeout' then 'timeout' else 'left' end));
  end loop;
  update public.card_tables set pub = v_pub where room_id = p_room and game = 'poker';
  foreach s in array p_seats loop
    perform public._card_payout(p_room, 'poker', s, 'card_cashout');
    update public.card_seats set leaving = true where room_id = p_room and game = 'poker' and seat = s;
    perform public._card_log(p_room, 'poker', t.hand_no, (v_pub->'players'->(s::text)->>'id')::uuid, s, 'leave',
                             jsonb_build_object('how', p_how), p_now);
  end loop;
  perform public._pk_after(p_room, t.turn, p_now, t.turn = any(p_seats));
end $$;

-- What is due at a poker table (§10): the deal after the countdown or the result, or the turn's timeout.
create or replace function public._pk_due(p_room uuid, p_now timestamptz, p_deck integer[]) returns boolean
language plpgsql security definer set search_path = public, extensions
as $$
declare v_phase text;
begin
  select phase into v_phase from public.card_tables where room_id = p_room and game = 'poker';
  if v_phase in ('countdown', 'result') then
    return public._pk_deal(p_room, p_now, p_deck);
  elsif v_phase = 'playing' then
    perform public._pk_timeout(p_room, p_now);
    return true;
  end if;
  return false;
end $$;

-- A top-up (§6.2, R23): between the caller's hands, up to 200 BB on the table.
create or replace function public._pk_topup(p_room uuid, p_account uuid, p_amount integer, p_now timestamptz) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; v_seat integer; v_chips integer; w public.wallets;
begin
  perform public._card_open(p_room, 'poker');
  perform public._card_touch(p_room, p_account, p_now);
  perform public._card_sweep(p_room, 'poker', p_now);
  select * into t from public.card_tables where room_id = p_room and game = 'poker';
  select seat, chips into v_seat, v_chips from public.card_seats
   where room_id = p_room and game = 'poker' and account_id = p_account and not leaving;
  if v_seat is null then
    raise exception 'not seated' using errcode = '22023';
  end if;
  if public._card_live(p_room, 'poker', v_seat) then
    raise exception 'hand running' using errcode = '22023';
  end if;
  if v_chips + p_amount > 200 * t.stake then
    raise exception 'too many chips' using errcode = '22023';
  end if;
  w := public._wallet_lock(p_account);
  if w.coins < p_amount then
    raise exception 'not enough coins' using errcode = '22023';
  end if;
  update public.card_seats set chips = chips + p_amount where room_id = p_room and game = 'poker' and seat = v_seat;
  perform public._pay(p_account, -p_amount, 'card_buyin', public._card_ref('poker', t.hand_no));
  perform public._card_log(p_room, 'poker', t.hand_no, p_account, v_seat, 'topup', jsonb_build_object('amount', p_amount), p_now);
  perform public._card_bump(p_room, 'poker', false);
  return public._card_answer(p_room, 'poker', p_account, p_now);
end $$;

revoke all on function public._pk_next(jsonb, integer) from public, anon, authenticated;
revoke all on function public._pk_pot(jsonb) from public, anon, authenticated;
revoke all on function public._pk_deal(uuid, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._pk_after(uuid, integer, timestamptz, boolean) from public, anon, authenticated;
revoke all on function public._pk_do_act(uuid, integer, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public._pk_street_end(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._pk_end(uuid, timestamptz, jsonb, jsonb, boolean) from public, anon, authenticated;
revoke all on function public._pk_showdown(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._pk_award(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._pk_refund(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._pk_timeout(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public._pk_leave(uuid, integer[], text, timestamptz) from public, anon, authenticated;
revoke all on function public._pk_due(uuid, timestamptz, integer[]) from public, anon, authenticated;
revoke all on function public._pk_topup(uuid, uuid, integer, timestamptz) from public, anon, authenticated;

-- ---------- E. Public RPCs (§11.3): membership first (R38); reads are snapshots (R37); ticks and writes lock and sweep ----------
```

**supabase/migrations/0017_v16_cards.sql — edit 5 of 6.** Replace:

```sql

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
```

with:

```sql

-- Act (§9.1): fold, check, call, bet, raise or all-in. Guarded; bad_bet (§11.5) comes before any lock.
create or replace function public.pk_act(p_room_id uuid, p_session_token text, p_seq integer, p_action text, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_action is null or p_action not in ('fold', 'check', 'call', 'bet', 'raise', 'allin')
     or (p_action in ('bet', 'raise') and (p_amount is null or p_amount < 0 or p_amount > 2000000000)) then
    return public._ac_flag(v_account, 'bad_bet', 'pk_act', jsonb_build_object('seq', p_seq, 'action', p_action, 'amount', p_amount),
                           p_room_id, 'invalid bet');
  end if;
  return public._card_action(p_room_id, v_account, 'poker', 'pk_act', p_seq,
                             jsonb_build_object('action', p_action, 'amount', p_amount), now());
end $$;

-- Top up the stack (R23). Guarded; bad_qty (§11.5) comes before any lock: null, < 1 or above 200 BB at the top stake.
create or replace function public.pk_topup(p_room_id uuid, p_session_token text, p_amount integer) returns jsonb
language plpgsql security definer set search_path = public, extensions
as $$
declare v_account uuid := public._ac_play(p_room_id, p_session_token);
begin
  if p_amount is null or p_amount < 1 or p_amount > 2000000 then
    return public._ac_flag(v_account, 'bad_qty', 'pk_topup', jsonb_build_object('amount', p_amount), p_room_id, 'invalid quantity');
  end if;
  return public._pk_topup(p_room_id, v_account, p_amount, now());
end $$;

grant execute on function public.card_lobby(uuid, text) to anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 6 of 6.** Append at the end of the file:

```sql
grant execute on function public.pk_act(uuid, text, integer, text, integer) to anon, authenticated;
grant execute on function public.pk_topup(uuid, text, integer) to anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected:

```text
v14 smoke ok
0017 twice ok
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
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(cards): 0017 the poker engine — blinds, re-opening, the uncalled bet, side pots, leaving mid-hand; pk_act and pk_topup

Section D's poker: the button and the heads-up blinds, the deal with the board kept secret, fold, check, call, bet, raise
and all-in with the TDA minimum raise and re-opening, the uncalled bet, the streets and the showdown with side pots and
the odd chips, check and fold timeouts (the second in a row leaves), standing up mid-hand (the uncalled part stays as
dead money), a 0-chip seat stood up at the deal, top-ups between hands, and the refund when nobody is left. pk_act
(bad_bet) and pk_topup (bad_qty) are guarded; the guard loop gains them (48). Smoke part 6 plays six hands.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0017_v16_cards.sql tests/sql/anticheat-guards.sql tests/sql/v16-smoke.sql
git commit -F <message file>
```

---

### Task 7: Database — holdings, wipes and deletions; `_ac_holdings` and `_ac_wipe` (`0017` section F)

**Files:**
- Modify: `supabase/migrations/0017_v16_cards.sql` (the sweep's leaving set as `_card_swept`; `_pk_refund` skips deleted accounts; section F)
- Modify: `tests/sql/v16-smoke.sql` (append part 7, ending with `\i tests/sql/anticheat-guards.sql`)

**Interfaces:**
- Consumes: Tasks 1–6; from `0015`–`0016`: `anticheat_wipes`, `anticheat_status`, `admin_anticheat_resolve(token, account, 'wipe')`, `admin_delete_account`, `admin_delete_room`, and `0016`'s `_ac_holdings` / `_ac_wipe` bodies (the hoa màu in `produce_stock`, the sprayer's tank on `farm_profiles`, the crops' kind, crop, parts and harvester).
- Produces (private, revoked): `_card_swept(room, game) → int[]` (the seats of non-members and banned accounts, which leave together), `_card_forfeit_all(account)` (the account's tables locked in `(room_id, game)` order; each seat leaves as `forfeit_all`; the rows deleted at once; each table reset, readied and bumped), `_card_room_gone(room)` (the tables locked in order, then every seated wallet; banned and non-member seats leave first; every live hand cancelled and refunded; the contributions of banned and deleted accounts split among the live seats, the odd xu from the button), the trigger functions `_card_rooms_bd()` and `_card_accounts_bd()` (after `_wallet_lock(old.id)`), and the BEFORE DELETE triggers `card_rooms_bd` on `rooms` and `card_accounts_bd` on `accounts`.
- Produces (re-created from `0016`): `_ac_holdings(account) → jsonb` gains `"cards": [{room_id, game, seat, chips, escrow}]`; `_ac_wipe(account, by) → jsonb` calls `_card_forfeit_all` first and takes the snapshot after it; both keep every part `0016` gave them.
- Produces (smoke): keys `cx`, `cw`, `cy`, `croot`, `ax`, `aw`, `ay`, `aroot`, `r3`, `r4`; `pg_temp.all_money() → bigint`; membership refused by all 11 RPCs; a wipe with four live seats (Tiến lên, a Cào player, a Cào dealer, poker), the hoa màu and the tank taken too; an account deletion and room deletions during live hands; part 7 prints `v16 holdings and deletions smoke ok` and ends with the guard file.

- [ ] **Step 1: Write smoke part 7**

**tests/sql/v16-smoke.sql.** Append at the end of the file, after a blank line:

```sql
-- ---------- Holdings, wipes and deletions (§6.3, §11.5, R32), membership (R38), and the guards ----------
-- Everything in xu: every wallet, every seat's stack and balance, and every live pot.
create function pg_temp.all_money() returns bigint language sql as $$
  select coalesce((select sum(coins) from public.wallets), 0)
       + coalesce((select sum(chips + escrow) from public.card_seats), 0)
       + coalesce((select sum((p.value->>'put')::bigint) from public.card_tables t, jsonb_each(t.pub->'players') p
                    where t.game = 'poker' and t.phase = 'playing'), 0)
$$;
insert into smoke select 'c' || n, token from unnest(array['x', 'w', 'y', 'root']) n,
  lateral public.register('v16' || n || '_' || floor(random() * 1e9)::text, 'pw123456');
insert into smoke select 'a' || substr(k, 2), public._auth_account(v)::text from smoke where k in ('cx', 'cw', 'cy', 'croot');
update public.accounts set is_root = true where id = (select v from smoke where k = 'aroot')::uuid;
insert into smoke select 'r3', room_id::text from public.create_room('Chiếu Y', 'pw', (select v from smoke where k = 'cy'));
insert into smoke select 'r4', room_id::text from public.create_room('Bàn C', 'pw', (select v from smoke where k = 'c3'));
do $$
declare x text := (select v from smoke where k = 'cx');
begin
  perform public.join_room((select code from public.rooms where id = (select v from smoke where k = r)::uuid), 'pw', x)
     from unnest(array['room', 'other', 'r3', 'r4']) r;
  perform public.join_room((select code from public.rooms where id = (select v from smoke where k = 'r4')::uuid), 'pw', v)
     from smoke where k in ('cw', 'c4', 'c6');
end $$;

-- membership comes first in all 11 RPCs (R38)
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid; c5 text := (select v from smoke where k = 'c5'); call text;
begin
  foreach call in array array[
    format('select public.card_lobby(%L, %L)', room, c5),
    format('select public.card_state(%L, %L, %L)', room, c5, 'cao'),
    format('select public.card_hand(%L, %L, %L)', room, c5, 'cao'),
    format('select public.card_tick(%L, %L, %L)', room, c5, 'cao'),
    format('select public.card_leave(%L, %L, %L)', room, c5, 'cao'),
    format('select public.card_sit(%L, %L, %L, 1, 1000, null)', room, c5, 'cao'),
    format('select public.pk_topup(%L, %L, 1000)', room, c5),
    format('select public.tl_play(%L, %L, 0, array[0])', room, c5),
    format('select public.tl_pass(%L, %L, 0)', room, c5),
    format('select public.cao_deal(%L, %L, 0)', room, c5),
    format('select public.pk_act(%L, %L, 0, %L, null)', room, c5, 'fold')] loop
    assert pg_temp.err(call) = 'account is not a member of this room', format('%s: %s', call, pg_temp.err(call));
    assert pg_temp.err(replace(call, c5, 'nope')) = 'invalid session', format('%s with a bad token', call);
  end loop;
end $$;

-- X sits in four rooms: a Tiến lên game (holding 3♠), a Cào hand as a player, one as the dealer, and a poker hand
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid; other uuid := (select v from smoke where k = 'other')::uuid;
        r3 uuid := (select v from smoke where k = 'r3')::uuid; r4 uuid := (select v from smoke where k = 'r4')::uuid;
        c1 text := (select v from smoke where k = 'c1'); c2 text := (select v from smoke where k = 'c2');
        c3 text := (select v from smoke where k = 'c3'); c4 text := (select v from smoke where k = 'c4');
        c5 text := (select v from smoke where k = 'c5'); c6 text := (select v from smoke where k = 'c6');
        cx text := (select v from smoke where k = 'cx'); cw text := (select v from smoke where k = 'cw');
        cy text := (select v from smoke where k = 'cy');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a3 uuid := (select v from smoke where k = 'a3')::uuid;
        a5 uuid := (select v from smoke where k = 'a5')::uuid; ax uuid := (select v from smoke where k = 'ax')::uuid;
        t public.card_tables; r jsonb; tok text;
begin
  perform pg_temp.set_coins(v::uuid, 200000) from smoke where k in ('a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'ax', 'aw', 'ay');
  -- Tiến lên in the main room: X, c1, c2
  perform public.card_sit(room, cx, 'tienlen', 1, 1000, null);
  perform public.card_sit(room, c1, 'tienlen', 2, 1000, null);
  perform public.card_sit(room, c2, 'tienlen', 3, 1000, null);
  t := pg_temp.tt();
  r := public._card_tick(room, a1, 'tienlen', t.deadline,
         pg_temp.deck('3S 4S 5S 6S 7S 8S 9S 10S JS QS KS 2H 2S', '3C 3D 4C 5C 6C 7C 8C 9C 10C JC QC KC 2C',
                      '3H 4D 4H 5D 6D 7D 8D 9D 10D JD QD KD 2D'));
  assert (pg_temp.tt()).phase = 'playing' and (pg_temp.tt()).turn = 1 and ((pg_temp.tt()).pub->>'must')::int = 0, 'X leads with 3♠';
  -- Cào in the other room: c5 deals, X plays
  perform public.card_sit(other, c5, 'cao', 1, 1000, null);
  update public.card_seats set sat_at = now() - interval '1 minute' where room_id = other and account_id = a5;
  perform public.card_sit(other, cx, 'cao', 2, 1000, null);
  r := public._card_action(other, a5, 'cao', 'cao_deal', (select seq from public.card_tables where room_id = other and game = 'cao'),
                           '{}'::jsonb, now(), pg_temp.deck('9S 8C 2H', 'KD 5S 3C'));
  assert r->'state'->>'phase' = 'peek' and r->'state'->'pub'->'dealer' = '1', format('c5 deals: %s', r->'state');
  -- Cào in r3: X deals, cy plays
  perform public.card_sit(r3, cx, 'cao', 1, 1000, null);
  update public.card_seats set sat_at = now() - interval '1 minute' where room_id = r3 and account_id = ax;
  perform public.card_sit(r3, cy, 'cao', 2, 1000, null);
  r := public._card_action(r3, ax, 'cao', 'cao_deal', (select seq from public.card_tables where room_id = r3 and game = 'cao'),
                           '{}'::jsonb, now(), pg_temp.deck('4C 4H 4D', '9H 10H QH'));
  assert r->'state'->>'phase' = 'peek' and r->'state'->'pub'->'dealer' = '1', format('X deals: %s', r->'state');
  -- poker in r4: X (button), W, c3, c4, c6; everyone puts 2 001 preflop
  perform public.card_sit(r4, k, 'poker', n::int, 1000, 50000)
     from unnest(array[cx, cw, c3, c4, c6]) with ordinality u(k, n);
  update public.card_tables set pos = 5, deadline = now() - interval '1 second' where room_id = r4 and game = 'poker';
  r := public._card_tick(r4, a3, 'poker', now(),
         pg_temp.deck('AS AD', 'KS KD', 'QS QD', 'JS JD', '10S 10D', '2C 6H 9C JC 4H'));
  assert r->'state'->'pub'->'button' = '1' and (r->'state'->>'turn')::int = 4, format('the poker hand: %s', r->'state'->'pub');
  foreach tok in array array[c4, c6, cx, cw, c3, c4, c6] loop
    r := public.pk_act(r4, tok, (select seq from public.card_tables where room_id = r4 and game = 'poker'),
                       case when tok = cx then 'raise' else 'call' end, case when tok = cx then 2001 end);
    assert r ? 'state', format('an act: %s', r);
  end loop;
  t := (select x from public.card_tables x where room_id = r4 and game = 'poker');
  assert t.pub->>'street' = 'flop' and t.turn = 2 and (t.pub->>'pot')::int = 10005, format('the flop: %s', t.pub);
  assert jsonb_array_length(public._ac_holdings(ax)->'cards') = 4, format('the preview: %s', public._ac_holdings(ax)->'cards');
end $$;

-- The wipe (§6.3, §11.5): X's seats are resolved first — the Tiến lên forfeit, the lost Cào stake, the cancelled Cào hand,
-- the folded poker hand — and only X's own balance is destroyed.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid; other uuid := (select v from smoke where k = 'other')::uuid;
        r3 uuid := (select v from smoke where k = 'r3')::uuid; r4 uuid := (select v from smoke where k = 'r4')::uuid;
        croot text := (select v from smoke where k = 'croot'); ax uuid := (select v from smoke where k = 'ax')::uuid;
        ay uuid := (select v from smoke where k = 'ay')::uuid;
        v0 bigint; v_wiped bigint; t public.card_tables; c jsonb;
begin
  update public.accounts set is_banned = true where id = ax;
  delete from public.sessions where account_id = ax;
  insert into public.anticheat_status (account_id, strikes, ban_state, banned_at) values (ax, 2, 'pending_wipe', now())
  on conflict (account_id) do update set strikes = 2, ban_state = 'pending_wipe', banned_at = now();
  -- 0016's parts of the wipe stay (anti-cheat §11.3 rule 3): X's hoa màu and sprayer tank go too
  insert into public.produce_stock (account_id, upland, kg) values (ax, 'khoai', 12);
  insert into public.farm_profiles (account_id, tank_item, tank_charges) values (ax, 'spray_insect', 2)
  on conflict (account_id) do update set tank_item = 'spray_insect', tank_charges = 2;
  v0 := pg_temp.all_money();
  c := public.admin_anticheat_resolve(croot, ax, 'wipe');
  v_wiped := (select -delta from public.coin_ledger where account_id = ax and reason = 'wipe' order by id desc limit 1);
  assert v_wiped = 193499 and pg_temp.all_money() = v0 - v_wiped, format('only X''s own %s xu go', v_wiped);
  assert not exists (select 1 from public.card_seats where account_id = ax)
         and (select snapshot->'cards' = '[]' and (snapshot->'wallet'->>'coins')::int = v_wiped from public.anticheat_wipes
               where account_id = ax order by id desc limit 1), 'the snapshot comes after the seats are resolved';
  assert not exists (select 1 from public.produce_stock where account_id = ax)
         and (select tank_item is null and tank_charges = 0 from public.farm_profiles where account_id = ax)
         and (select snapshot->'produce' = '[{"upland": "khoai", "kg": 12}]' and snapshot->'tank' = '{"item": "spray_insect", "charges": 2}'
                from public.anticheat_wipes where account_id = ax order by id desc limit 1), 'the hoa màu and the tank go too';
  -- Tiến lên: X forfeits (R13); c1 leads, the first lead's `must` gone with X's cards
  t := pg_temp.tt();
  assert t.phase = 'playing' and t.turn = 2 and t.pub->'must' = 'null' and t.pub->'players'->'1' @> '{"out": "forfeit", "settled": true}'
         and pg_temp.plines() = '[[1, 2, 2, 2, "forfeit"], [1, 3, 2, 2, "forfeit"], [1, 2, 3, 3, "thoi"]]'
         and pg_temp.esc() = '{"2": 12500, "3": 11000}', format('the forfeit: %s', t.pub);
  -- Cào as a player: X lost S to the dealer; Cào as the dealer: the hand is cancelled, cy is refunded
  assert (select pub->'left' = '[2]' and phase = 'peek' from public.card_tables where room_id = other and game = 'cao')
         and (select escrow from public.card_seats where room_id = other and game = 'cao' and seat = 1) = 2000, 'X lost S';
  assert (select phase = 'result' and last->'cancelled' = 'true' from public.card_tables where room_id = r3 and game = 'cao')
         and (select escrow from public.card_seats where room_id = r3 and account_id = ay) = 0 and pg_temp.coins(ay) = 200000,
    'the dealer''s hand is cancelled';
  -- poker: X folded; its 2 001 stay in the pot
  t := (select x from public.card_tables x where room_id = r4 and game = 'poker');
  assert t.phase = 'playing' and t.turn = 2 and t.pub->'players'->'1' @> '{"fold": true, "put": 2001}' and (t.pub->>'pot')::int = 10005,
    format('X folded: %s', t.pub);
end $$;

-- An account deleted mid-hand (R32): the accounts trigger resolves its seat first; only its own balance goes.
do $$
declare r4 uuid := (select v from smoke where k = 'r4')::uuid; croot text := (select v from smoke where k = 'croot');
        aw uuid := (select v from smoke where k = 'aw')::uuid; v0 bigint; t public.card_tables;
begin
  v0 := pg_temp.all_money();
  perform public.admin_delete_account(croot, aw);
  t := (select x from public.card_tables x where room_id = r4 and game = 'poker');
  assert pg_temp.all_money() = v0 - 150000 - 47999 and not exists (select 1 from public.card_seats where account_id = aw)
         and t.turn = 3 and t.pub->'players'->'2' @> '{"fold": true, "put": 2001}', format('W is gone, its chips in the pot: %s', t.pub);
end $$;

-- Room deletions (§6.3): a banned seat leaves first; every live hand is cancelled and every balance, contribution and stack
-- goes home; the contributions of banned and deleted accounts are split among the live seats, the odd xu from the button.
do $$
declare room uuid := (select v from smoke where k = 'room')::uuid; other uuid := (select v from smoke where k = 'other')::uuid;
        r3 uuid := (select v from smoke where k = 'r3')::uuid; r4 uuid := (select v from smoke where k = 'r4')::uuid;
        croot text := (select v from smoke where k = 'croot');
        a1 uuid := (select v from smoke where k = 'a1')::uuid; a2 uuid := (select v from smoke where k = 'a2')::uuid;
        a3 uuid := (select v from smoke where k = 'a3')::uuid; a4 uuid := (select v from smoke where k = 'a4')::uuid;
        a5 uuid := (select v from smoke where k = 'a5')::uuid; a6 uuid := (select v from smoke where k = 'a6')::uuid;
        v0 bigint;
begin
  v0 := pg_temp.all_money();
  update public.accounts set is_banned = true where id = a6;
  perform public.admin_delete_room(croot, r4);
  update public.accounts set is_banned = false where id = a6;
  assert pg_temp.all_money() = v0 and not exists (select 1 from public.card_tables where room_id = r4), 'nothing lost with r4';
  assert pg_temp.coins(a3) = 150000 + 2001 + 3002 + 47999 and pg_temp.coins(a4) = 150000 + 2001 + 3001 + 47999
         and pg_temp.coins(a6) = 150000 + 47999
         and (select count(*) from public.coin_ledger where account_id in (a3, a4) and reason = 'card_refund') = 4,
    format('r4: %s %s %s', pg_temp.coins(a3), pg_temp.coins(a4), pg_temp.coins(a6));
  perform public.admin_delete_room(croot, other);
  perform public.admin_delete_room(croot, r3);
  perform public.admin_delete_room(croot, room);
  assert pg_temp.all_money() = v0 and not exists (select 1 from public.card_seats where room_id in (room, other, r3, r4))
         and not exists (select 1 from public.card_tables where room_id in (room, other, r3, r4)), 'every table gone, every xu home';
  assert pg_temp.coins(a5) = 199000 + 2000 and pg_temp.coins(a1) = 190000 + 12500 and pg_temp.coins(a2) = 190000 + 11000,
    format('the balances: %s %s %s', pg_temp.coins(a5), pg_temp.coins(a1), pg_temp.coins(a2));
  assert (select count(*) from public.card_log where action = 'room_gone') >= 3, 'the deletions are logged';
end $$;

select 'v16 holdings and deletions smoke ok' as result;

\i tests/sql/anticheat-guards.sql
```

- [ ] **Step 2: Run the SQL check to verify it fails**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected: `FAILED: tests/sql/v16-smoke.sql` after `v16 poker smoke ok`, with `ERROR:  the preview: ` in the log — `0016`'s `_ac_holdings` has no `cards` yet.

- [ ] **Step 3: Write section F**

**supabase/migrations/0017_v16_cards.sql — edit 1 of 6.** Replace:

```sql

-- The lazy clock of a table (§6.3, §10), under its lock: the seats of non-members and banned accounts leave together
```

with:

```sql

-- The seats a sweep removes (§6.3, anti-cheat R10): those of banned accounts and of accounts no longer in the room.
create or replace function public._card_swept(p_room uuid, p_game text) returns integer[]
language sql stable security definer set search_path = public, extensions
as $$
  select coalesce(array_agg(s.seat order by s.seat), '{}') from public.card_seats s join public.accounts a on a.id = s.account_id
   where s.room_id = p_room and s.game = p_game and not s.leaving
     and (a.is_banned or not exists (select 1 from public.members m where m.room_id = p_room and m.account_id = s.account_id))
$$;

-- The lazy clock of a table (§6.3, §10), under its lock: the seats of non-members and banned accounts leave together
```

**supabase/migrations/0017_v16_cards.sql — edit 2 of 6.** Replace:

```sql
as $$
declare f integer[]; v_changed boolean := false;
begin
  f := array(select s.seat from public.card_seats s join public.accounts a on a.id = s.account_id
              where s.room_id = p_room and s.game = p_game and not s.leaving
                and (a.is_banned or not exists (select 1 from public.members m
                                                 where m.room_id = p_room and m.account_id = s.account_id))
              order by s.seat);
  if cardinality(f) > 0 then
```

with:

```sql
as $$
declare f integer[] := public._card_swept(p_room, p_game); v_changed boolean := false;
begin
  if cardinality(f) > 0 then
```

**supabase/migrations/0017_v16_cards.sql — edit 3 of 6.** Replace:

```sql
revoke all on function public._card_ready(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_sweep(uuid, text, timestamptz, integer[]) from public, anon, authenticated;
```

with:

```sql
revoke all on function public._card_ready(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public._card_swept(uuid, text) from public, anon, authenticated;
revoke all on function public._card_sweep(uuid, text, timestamptz, integer[]) from public, anon, authenticated;
```

**supabase/migrations/0017_v16_cards.sql — edit 4 of 6.** Replace:

```sql
-- Nobody left in the hand (every live player removed by one sweep): each contribution goes back to its contributor — to
-- the stack while the seat is still theirs, else to the wallet (card_refund) — and the hand ends without a winner.
create or replace function public._pk_refund(p_room uuid, p_now timestamptz) returns void
```

with:

```sql
-- Nobody left in the hand (every live player removed by one sweep): each contribution goes back to its contributor — to
-- the stack while the seat is still theirs, else to the wallet (card_refund); a deleted account's went with it — and the
-- hand ends without a winner.
create or replace function public._pk_refund(p_room uuid, p_now timestamptz) returns void
```

**supabase/migrations/0017_v16_cards.sql — edit 5 of 6.** Replace:

```sql
     where room_id = p_room and game = 'poker' and seat = r.seat and account_id = r.id and not leaving;
    if not found then
      perform public._wallet_lock(r.id);
```

with:

```sql
     where room_id = p_room and game = 'poker' and seat = r.seat and account_id = r.id and not leaving;
    if not found and exists (select 1 from public.accounts where id = r.id) then
      perform public._wallet_lock(r.id);
```

**supabase/migrations/0017_v16_cards.sql — edit 6 of 6.** Append at the end of the file, after a blank line:

```sql
-- ---------- F. Holdings, wipes and deletions (§6.3, §11.5, R32): the BEFORE DELETE triggers; 0016's _ac_holdings and _ac_wipe ----------
-- Resolve an account's seats before a wipe or its deletion (§6.3), its wallet already locked (anti-cheat R16): every table
-- where it sits is locked in table-id order, the leave operation runs on each of its seats, and the rows go at once.
create or replace function public._card_forfeit_all(p_account uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare r record; v_now timestamptz := now();
begin
  perform 1 from public.card_tables t
   where (t.room_id, t.game) in (select s.room_id, s.game from public.card_seats s where s.account_id = p_account)
   order by t.room_id, t.game for update of t;
  for r in select room_id, game, seat, leaving from public.card_seats where account_id = p_account order by room_id, game loop
    if not r.leaving then
      perform public._card_leave_seat(r.room_id, r.game, r.seat, 'forfeit_all', v_now);
    end if;
    delete from public.card_seats where room_id = r.room_id and game = r.game and seat = r.seat and account_id = p_account;
    perform public._card_reset_if_empty(r.room_id, r.game);
    perform public._card_ready(r.room_id, r.game, v_now);
    perform public._card_bump(r.room_id, r.game, true);
  end loop;
end $$;

-- A room about to be deleted (§6.3, R32): its tables locked in table-id order and the wallets of every seated account in
-- account-id order; the sweep's first step (banned accounts and non-members leave as at any sweep); then every live hand
-- is cancelled. Tiến lên and Cào pay every seat its balance (lines already applied stand). Poker returns each contribution
-- to its contributor (card_refund); those of banned or deleted accounts are dead money, split equally among the live
-- seats, the odd xu from the button (§9.1). Then every seat goes, a poker stack cashed out.
create or replace function public._card_room_gone(p_room uuid) returns void
language plpgsql security definer set search_path = public, extensions
as $$
declare t public.card_tables; r record; f integer[]; v_now timestamptz := now(); v_dead integer; v_live integer[];
        q integer; m integer;
begin
  perform 1 from public.card_tables where room_id = p_room order by game for update;
  for r in select distinct account_id from public.card_seats where room_id = p_room order by account_id loop
    perform public._wallet_lock(r.account_id);
  end loop;
  for t in select * from public.card_tables where room_id = p_room order by game loop
    f := public._card_swept(p_room, t.game);
    if cardinality(f) > 0 then
      perform public._card_leave_seats(p_room, t.game, f, 'sweep', v_now);
    end if;
  end loop;
  for t in select * from public.card_tables where room_id = p_room order by game loop
    if t.game = 'poker' and t.phase = 'playing' then
      v_live := array(select key::int from jsonb_each(t.pub->'players') where not (value->>'fold')::boolean order by 1);
      v_dead := 0;
      for r in select (value->>'id')::uuid as id, (value->>'put')::int as put from jsonb_each(t.pub->'players')
                where (value->>'put')::int > 0 order by value->>'id' loop
        if exists (select 1 from public.accounts a where a.id = r.id and not a.is_banned) then
          perform public._pay(r.id, r.put, 'card_refund', public._card_ref('poker', t.hand_no));
        else
          v_dead := v_dead + r.put;
        end if;
      end loop;
      if v_dead > 0 and cardinality(v_live) > 0 then
        q := v_dead / cardinality(v_live);
        m := v_dead % cardinality(v_live);
        for r in select s, row_number() over (order by (s - (t.pub->>'button')::int + 5) % 6) as n from unnest(v_live) s loop
          perform public._pay((t.pub->'players'->(r.s::text)->>'id')::uuid, q + case when r.n <= m then 1 else 0 end,
                              'card_refund', public._card_ref('poker', t.hand_no));
        end loop;
      end if;
    end if;
    for r in select seat from public.card_seats where room_id = p_room and game = t.game order by seat loop
      perform public._card_payout(p_room, t.game, r.seat, case when t.game = 'poker' then 'card_cashout' else 'card_settle' end);
    end loop;
    delete from public.card_seats where room_id = p_room and game = t.game;
    perform public._card_log(p_room, t.game, t.hand_no, null, null, 'room_gone', jsonb_build_object('phase', t.phase), v_now);
  end loop;
end $$;

create or replace function public._card_rooms_bd() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._card_room_gone(old.id);
  return old;
end $$;

create or replace function public._card_accounts_bd() returns trigger
language plpgsql security definer set search_path = public, extensions
as $$
begin
  perform public._wallet_lock(old.id);
  perform public._card_forfeit_all(old.id);
  return old;
end $$;

drop trigger if exists card_rooms_bd on public.rooms;
create trigger card_rooms_bd before delete on public.rooms for each row execute function public._card_rooms_bd();
drop trigger if exists card_accounts_bd on public.accounts;
create trigger card_accounts_bd before delete on public.accounts for each row execute function public._card_accounts_bd();

-- 0016's _ac_holdings (0015's, with v15.2's hoa màu, tank and crop fields), plus "cards" (§11.5): the account's seats,
-- with their stacks and balances.
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
    'cards', coalesce((select jsonb_agg(jsonb_build_object('room_id', s.room_id, 'game', s.game, 'seat', s.seat, 'chips', s.chips,
                                                           'escrow', s.escrow) order by s.room_id, s.game)
                         from public.card_seats s where s.account_id = p_account), '[]'::jsonb),
    'announcements', (select count(*) from public.chat_messages m where m.system and m.about_account_id = p_account))
$$;

-- 0016's wipe (0015's §9.6, which v15.2 extends to the hoa màu and the tank), under the wallet lock the admin RPC takes
-- first — the account's seats are resolved first (§6.3), so the xu they give back are part of the wiped balance; then the
-- snapshot, the last ledger row and the deletes, unchanged.
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
  delete from public.chat_messages where system and about_account_id = p_account;
  update public.anticheat_status set ban_state = 'wiped', wiped_at = now() where account_id = p_account;
  return v_snap;
end $$;

revoke all on function public._card_forfeit_all(uuid) from public, anon, authenticated;
revoke all on function public._card_room_gone(uuid) from public, anon, authenticated;
revoke all on function public._card_rooms_bd() from public, anon, authenticated;
revoke all on function public._card_accounts_bd() from public, anon, authenticated;
revoke all on function public._ac_holdings(uuid) from public, anon, authenticated;
revoke all on function public._ac_wipe(uuid, uuid) from public, anon, authenticated;
```

- [ ] **Step 4: Run the SQL check**

Run: `bash "$SCRATCH/v16-sql.sh"`
Expected:

```text
v14 smoke ok
0017 twice ok
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
anticheat guards ok
ALL OK
```

- [ ] **Step 5: Commit**

Commit message:

```text
feat(cards): 0017 holdings and deletions — _card_forfeit_all, _card_room_gone, the delete triggers; _ac_holdings and _ac_wipe

Section F: _card_forfeit_all leaves every seat of an account (its tables locked in order, the leave rules, the rows
deleted at once); _card_room_gone cancels every live hand of a room and refunds (banned and non-member seats leave first;
the contributions of banned and deleted accounts are split among the live seats); the BEFORE DELETE triggers on rooms
and accounts call them. 0016's _ac_holdings gains "cards", and 0016's _ac_wipe resolves the seats first and still takes
the hoa màu and the tank. Smoke part 7: membership in all 11 RPCs, a wipe with four live seats, account and room
deletions during live hands, the zero-sum invariant, and the guard file at the end.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add supabase/migrations/0017_v16_cards.sql tests/sql/v16-smoke.sql
git commit -F <message file>
```

---

### Task 8: The deck and the Tiến lên mirror — combinations, beating, thối, tới trắng, the money and the hints

**Files:**
- Create: `lib/game/cards/deck.ts`, `lib/game/cards/tienlen.ts`
- Test: `tests/unit/cards-deck.test.ts`, `tests/unit/cards-tienlen.test.ts` (create)

**Interfaces:**
- Consumes: `tests/fixtures/card-cases.json` (Tasks 1–2; the tests import `@/tests/fixtures/card-cases.json`).
- Produces (`@/lib/game/cards/deck`): `type Card = number` (0–51: rank `c / 4`, 3 … A, 2; suit `c % 4`, ♠ ♣ ♦ ♥ — the SQL encoding), `type CardGame = "tienlen" | "cao" | "poker"`, `CARD_GAMES`, `RANK_NAMES`, `SUIT_GLYPHS` (`["♠", "♣", "♦", "♥"]`), `SUIT_NAMES` (`["bích", "chuồn", "rô", "cơ"]`), `isCardGame`, `isCard`, `rankOf`, `suitOf`, `isRed`, `cardLabel(c)` ("10♥"), `cardAria(c)` ("10 cơ"), `parseCard(code | label) → Card | null`, `cardsOf(codes) → Card[]` (throws on a bad code), `cardCode(c)` ("10H"), `sortCards(cards)`.
- Produces (`@/lib/game/cards/tienlen`), mirrors of section B: `TlType`, `TlCombo {type, len, key, cards}`, `tlCombo(cards) → TlCombo | null`, `isBomb`, `tlBeats(top, x)`, `tlIsCut(top, x)`, `tlValue(combo)` (half-stakes), `tlThoi(cards)`, `tlTrang(cards) → TlTrang | null`, `tlTrangRank`, `TlPlayer`, `TlChain`, `TlLine`, `TlMoney`, `TlEvent`, `seatsAfter(order, seat)`, `tlMoney(m, event, hands) → TlMoney` (= `_tl_money`), `tlNet(m) → {seat: h}`, `TlGame`, `tlSettle(game) → TlMoney` (a whole game's events folded); the hints `tlCandidates(hand)`, `tlLegalPlays(hand, top, must)` (weakest first, bombs last), `tlSlams(hand, top)` (the 4 đôi thông that may cut out of turn), `tlArrange(hand, "rank" | "group")`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cards-deck.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import {
  cardAria, cardCode, cardLabel, cardsOf, isCard, isCardGame, isRed, parseCard, rankOf, sortCards, suitOf,
} from "@/lib/game/cards/deck";

describe("cards (spec §6.4)", () => {
  it("encodes rank and suit: 3♠ = 0, 2♥ = 51", () => {
    expect([rankOf(0), suitOf(0), rankOf(51), suitOf(51)]).toEqual([0, 0, 12, 3]);
    expect(parseCard("3S")).toBe(0);
    expect(parseCard("2H")).toBe(51);
    expect(parseCard("10D")).toBe(7 * 4 + 2);
    expect(parseCard("10♦")).toBe(parseCard("10D"));
    expect([parseCard("1S"), parseCard("10X"), parseCard(""), parseCard("S")]).toEqual([null, null, null, null]);
  });

  it("labels a card for the eye and for the screen reader", () => {
    const c = parseCard("10H")!;
    expect(cardLabel(c)).toBe("10♥");
    expect(cardAria(c)).toBe("10 cơ");
    expect(cardAria(parseCard("AS")!)).toBe("A bích");
    expect(cardAria(parseCard("2C")!)).toBe("2 chuồn");
    expect(cardAria(parseCard("JD")!)).toBe("J rô");
    expect(cardCode(c)).toBe("10H");
    expect([isRed(parseCard("5D")!), isRed(parseCard("5H")!), isRed(parseCard("5S")!), isRed(parseCard("5C")!)])
      .toEqual([true, true, false, false]);
  });

  it("sorts in Tiến lên order and checks cards and games", () => {
    expect(sortCards(cardsOf(["2S", "3H", "3S", "AH"])).map(cardCode)).toEqual(["3S", "3H", "AH", "2S"]);
    expect(() => cardsOf(["3S", "ZZ"])).toThrow();
    expect([isCard(0), isCard(51), isCard(52), isCard(-1), isCard(1.5), isCard("3")]).toEqual([true, true, false, false, false, false]);
    expect([isCardGame("tienlen"), isCardGame("cao"), isCardGame("poker"), isCardGame("liêng")]).toEqual([true, true, true, false]);
  });
});
```

Create `tests/unit/cards-tienlen.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { cardCode, cardsOf, type Card } from "@/lib/game/cards/deck";
import {
  tlArrange, tlBeats, tlCombo, tlIsCut, tlLegalPlays, tlSettle, tlSlams, tlThoi, tlTrang, tlValue, type TlCombo, type TlEvent,
} from "@/lib/game/cards/tienlen";
import fixtures from "@/tests/fixtures/card-cases.json";

type Codes = string[];
interface SettleCase {
  name: string; order: number[]; played: number[]; hands: Record<string, Codes>;
  events: Array<{ k: string; seat?: number; seats?: number[]; top?: { seat: number; cards: Codes; done: boolean } }>;
  expect: { lines: Array<[number, number, number, number, string]>; places: Record<string, number>; out: Record<string, string>; net: Record<string, number> };
}
const FX = fixtures.tienlen as unknown as {
  combo: Array<{ cards: Codes; expect: { type: string; len: number; key: string } | null; value?: number }>;
  beats: Array<{ top: Codes; x: Codes; expect: boolean }>;
  trang: Array<{ cards: Codes; expect: string | null }>;
  thoi: Array<{ cards: Codes; expect: number }>;
  settle: SettleCase[];
};

const combo = (codes: Codes): TlCombo => {
  const x = tlCombo(cardsOf(codes));
  if (!x) throw new Error(`no combination: ${codes.join(" ")}`);
  return x;
};
const codes = (x: { cards: Card[] }): string => x.cards.map(cardCode).join(" ");
const keyed = <T,>(o: Record<string, T>): Record<number, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));

describe("the shared Tiến lên fixtures (the SQL smoke replays the same cases)", () => {
  it("combinations and their values", () => {
    for (const k of FX.combo) {
      const got = tlCombo(cardsOf(k.cards));
      if (k.expect === null) {
        expect(got, k.cards.join(" ")).toBeNull();
      } else {
        expect(got && { type: got.type, len: got.len, key: cardCode(got.key) }, k.cards.join(" ")).toEqual(k.expect);
        expect(tlValue(got!), k.cards.join(" ")).toBe(k.value);
      }
    }
  });
  it("beating", () => {
    for (const k of FX.beats) expect(tlBeats(combo(k.top), combo(k.x)), `${k.x.join(" ")} over ${k.top.join(" ")}`).toBe(k.expect);
  });
  it("tới trắng", () => {
    for (const k of FX.trang) expect(tlTrang(cardsOf(k.cards)), k.cards.join(" ")).toBe(k.expect);
  });
  it("thối", () => {
    for (const k of FX.thoi) expect(tlThoi(cardsOf(k.cards)), k.cards.join(" ")).toBe(k.expect);
  });
  for (const k of FX.settle) {
    it(`settle: ${k.name}`, () => {
      const r = tlSettle({
        order: k.order, played: k.played,
        hands: keyed(Object.fromEntries(Object.entries(k.hands).map(([s, cs]) => [s, cardsOf(cs)]))),
        events: k.events.map((e) => (e.k === "cut" ? { ...e, top: { ...e.top!, cards: cardsOf(e.top!.cards) } } : e)) as TlEvent[],
      });
      expect(r.lines.map((l) => [l.from, l.to, l.h, l.paid, l.why])).toEqual(k.expect.lines);
      expect(r.places).toEqual(keyed(k.expect.places));
      expect(r.out).toEqual(keyed(k.expect.out));
      expect(r.net).toEqual(keyed(k.expect.net));
      expect(Object.values(r.net).reduce((a, b) => a + b, 0)).toBe(0);
    });
  }
});

describe("cutting (§7.2)", () => {
  it("is a bomb over a heo combination or another bomb, never a 2 over a 2", () => {
    expect(tlIsCut(combo(["2H"]), combo(["4S", "4D", "5C", "5H", "6S", "6D"]))).toBe(true);
    expect(tlIsCut(combo(["4S", "4D", "5C", "5H", "6S", "6D"]), combo(["8S", "8C", "8D", "8H"]))).toBe(true);
    expect(tlIsCut(combo(["2S"]), combo(["2H"]))).toBe(false);
    expect(tlIsCut(combo(["KS"]), combo(["8S", "8C", "8D", "8H"]))).toBe(false);
  });
});

describe("hints (§13.2)", () => {
  const hand = cardsOf(["3S", "3D", "4C", "5H", "5S", "6D", "9S", "9C", "9D", "KH", "AS", "2C", "2H"]);

  it("a first lead must include `must`; the weakest play comes first", () => {
    const plays = tlLegalPlays(hand, null, cardsOf(["3S"])[0]);
    expect(plays.length).toBeGreaterThan(0);
    expect(plays.every((x) => x.cards.includes(0))).toBe(true);
    expect(codes(plays[0])).toBe("3S");
    expect(plays.map(codes)).toContain("3S 4C 5S");
    expect(plays.map(codes)).toContain("3S 3D");
  });

  it("with a top, only what beats it; each key once; bombs last", () => {
    const plays = tlLegalPlays(hand, combo(["8H"]), null);
    expect(plays.map(codes)).toEqual(["9S", "9C", "9D", "KH", "AS", "2C", "2H"]);
    expect(tlLegalPlays(hand, combo(["QS", "QD"]), null).map(codes)).toEqual(["2C 2H"]);
    expect(tlLegalPlays(hand, combo(["4S", "5D", "6C"]), null).map(codes)).toEqual(["4C 5S 6D"]);
    const bombs = cardsOf(["3S", "3C", "4S", "4C", "5S", "5C", "9S", "9C", "9D", "9H", "JD", "QH", "KS"]);
    expect(tlLegalPlays(bombs, combo(["2H"]), null).map(codes)).toEqual(["3S 3C 4S 4C 5S 5C", "9S 9C 9D 9H"]);
    expect(tlLegalPlays(bombs, combo(["2S", "2H"]), null).map(codes)).toEqual(["9S 9C 9D 9H"]);
    expect(tlLegalPlays(bombs, combo(["10S"]), null).map(codes)).toEqual(["JD", "QH", "KS"]);
  });

  it("💣 Chặt! plays only a 4 đôi thông that beats the top", () => {
    const slam = cardsOf(["4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H", "9S", "JD", "QH", "KS", "AC"]);
    expect(tlSlams(slam, null)).toEqual([]);
    expect(tlSlams(slam, combo(["9C"]))).toEqual([]);
    expect(tlSlams(slam, combo(["2S"])).map(codes)).toEqual(["4S 4D 5C 5H 6S 6D 7C 7H"]);
    expect(tlSlams(slam, combo(["8S", "8C", "8D", "8H"])).map(codes)).toEqual(["4S 4D 5C 5H 6S 6D 7C 7H"]);
    expect(tlSlams(hand, combo(["2S"]))).toEqual([]);
  });

  it("Xếp bài sorts by rank or groups the combinations", () => {
    expect(tlArrange(cardsOf(["9S", "3S", "9C", "2H", "9D"]), "rank").map(cardCode)).toEqual(["3S", "9S", "9C", "9D", "2H"]);
    expect(tlArrange(cardsOf(["5S", "3S", "9C", "5H", "9D", "9H"]), "group").map(cardCode)).toEqual(["9C", "9D", "9H", "5S", "5H", "3S"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/cards-deck.test.ts tests/unit/cards-tienlen.test.ts`
Expected: FAIL — both files stop at `Failed to resolve import "@/lib/game/cards/…"` (the modules do not exist yet).

- [ ] **Step 3: Write the deck and the mirror**

Create `lib/game/cards/deck.ts` with exactly:

```ts
// Cards (spec §6.4): a card is an integer c in 0–51; r = c / 4 (0–12 = 3 4 5 6 7 8 9 10 J Q K A 2) and s = c % 4 (0 ♠,
// 1 ♣, 2 ♦, 3 ♥). In Tiến lên a higher c is a stronger card; Cào and poker map r to their own orders. Pure.

export type Card = number;
export type CardGame = "tienlen" | "cao" | "poker";

export const CARD_GAMES: readonly CardGame[] = ["tienlen", "cao", "poker"];
export const RANK_NAMES: readonly string[] = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2"];
export const SUIT_GLYPHS: readonly string[] = ["♠", "♣", "♦", "♥"];
export const SUIT_NAMES: readonly string[] = ["bích", "chuồn", "rô", "cơ"];
/** The fixtures' suit letters (tests/fixtures/card-cases.json): S ♠, C ♣, D ♦, H ♥. */
const SUIT_CODES = "SCDH";

export function isCardGame(v: unknown): v is CardGame {
  return v === "tienlen" || v === "cao" || v === "poker";
}

export function isCard(v: unknown): v is Card {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 51;
}

export const rankOf = (c: Card): number => Math.floor(c / 4);
export const suitOf = (c: Card): number => c % 4;
/** ♦ and ♥ are drawn red. */
export const isRed = (c: Card): boolean => suitOf(c) >= 2;

/** "10♥". */
export function cardLabel(c: Card): string {
  return `${RANK_NAMES[rankOf(c)]}${SUIT_GLYPHS[suitOf(c)]}`;
}

/** "10 cơ" (the card's aria label). */
export function cardAria(c: Card): string {
  return `${RANK_NAMES[rankOf(c)]} ${SUIT_NAMES[suitOf(c)]}`;
}

/** A card from its fixture code ("10H", "AS", "2D") or its label ("10♥"); null for anything else. */
export function parseCard(code: string): Card | null {
  const rank = RANK_NAMES.indexOf(code.slice(0, -1));
  const tail = code.slice(-1);
  const suit = SUIT_CODES.includes(tail) ? SUIT_CODES.indexOf(tail) : SUIT_GLYPHS.indexOf(tail);
  return rank < 0 || suit < 0 ? null : rank * 4 + suit;
}

/** Cards from codes or labels; throws on a bad one (for fixed content: the fixtures and the rules book). */
export function cardsOf(codes: readonly string[]): Card[] {
  return codes.map((code) => {
    const c = parseCard(code);
    if (c === null) throw new Error(`bad card ${code}`);
    return c;
  });
}

/** The fixture code of a card ("10H"). */
export function cardCode(c: Card): string {
  return `${RANK_NAMES[rankOf(c)]}${SUIT_CODES[suitOf(c)]}`;
}

/** Ascending in Tiến lên order: 3♠ first, 2♥ last. */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => a - b);
}
```

Create `lib/game/cards/tienlen.ts` with exactly:

```ts
import { rankOf, sortCards, suitOf, type Card } from "./deck";

// Tiến lên miền Nam on the client (spec §7): the combinations, beating and cutting, the values, thối, tới trắng and the
// money of a game, the same arithmetic in the same order as 0017 section B (_tl_combo … _tl_money), so the hints and the
// rules book agree with the server (tests/fixtures/card-cases.json pins both sides). Amounts are in half-stakes (h):
// 2 h = 1 S. Pure.

export type TlType = "single" | "pair" | "triple" | "quad" | "straight" | "pairs";

/** A combination: `key` = the highest card; `len` = the cards of a sảnh, the pairs of a đôi thông, else the card count. */
export interface TlCombo { type: TlType; len: number; key: Card; cards: Card[] }

export type TlTrang = "sanh_rong" | "nam_doi_thong" | "tu_quy_heo" | "sau_doi";
export type TlOut = "done" | "cong" | "forfeit";
export type TlWhy = "bet" | "ba" | "chat" | "thoi" | "cong" | "trang" | "forfeit";

/** The rank of the 2s (heo). */
const HEO = 12;

/** A combination of these cards (§7.1), or null. */
export function tlCombo(cards: readonly Card[]): TlCombo | null {
  const n = cards.length;
  if (n === 0 || cards.some((c) => !Number.isInteger(c) || c < 0 || c > 51) || new Set(cards).size !== n) return null;
  const c = sortCards(cards);
  const r = c.map(rankOf);
  let type: TlType | null = null;
  let len = n;
  if (r[0] === r[n - 1] && n <= 4) {
    type = n === 1 ? "single" : n === 2 ? "pair" : n === 3 ? "triple" : "quad";
  } else if (n >= 3 && r[n - 1] < HEO && r.every((x, k) => x === r[0] + k)) {
    type = "straight";
  } else if (n >= 6 && n % 2 === 0 && r[n - 1] < HEO
             && Array.from({ length: n / 2 }, (_, k) => k).every((k) => r[2 * k] === r[0] + k && r[2 * k + 1] === r[0] + k)) {
    type = "pairs";
    len = n / 2;
  }
  return type === null ? null : { type, len, key: c[n - 1], cards: c };
}

const isHeo = (x: TlCombo): boolean => (x.type === "single" || x.type === "pair") && rankOf(x.key) === HEO;
/** A bomb (hàng): a tứ quý or a đôi thông. */
export const isBomb = (x: TlCombo): boolean => x.type === "quad" || x.type === "pairs";

/** Does x beat top (§7.2)? */
export function tlBeats(top: TlCombo, x: TlCombo): boolean {
  if (x.type === top.type && (x.type !== "straight" && x.type !== "pairs" || x.len === top.len) && x.key > top.key) return true;
  const heoRank = rankOf(top.key) === HEO;
  if (top.type === "single" && heoRank) return x.type === "quad" || (x.type === "pairs" && (x.len === 3 || x.len === 4));
  if (top.type === "pair" && heoRank) return x.type === "quad" || (x.type === "pairs" && x.len === 4);
  if (top.type === "pairs" && top.len === 3) return x.type === "quad" || (x.type === "pairs" && x.len === 4);
  if (top.type === "quad") return x.type === "pairs" && x.len === 4;
  return false;
}

/** Is playing x over top a cut (chặt): a bomb over a heo combination or another bomb (§7.2)? */
export function tlIsCut(top: TlCombo, x: TlCombo): boolean {
  return isBomb(x) && (isBomb(top) || isHeo(top));
}

/** What cutting a combination is worth, in half-stakes: 2♠/2♣ 1, 2♦/2♥ 2, a pair of 2s the sum, 3 đôi thông 3, tứ quý 4,
 *  4 đôi thông 6; anything else 0. */
export function tlValue(x: TlCombo): number {
  if (isHeo(x)) return x.cards.reduce((h, c) => h + (suitOf(c) >= 2 ? 2 : 1), 0);
  if (x.type === "pairs" && x.len === 3) return 3;
  if (x.type === "quad") return 4;
  if (x.type === "pairs" && x.len >= 4) return 6;
  return 0;
}

/** Thối (§7.4, R12) in half-stakes: each 2 (black 1, red 2), each tứ quý below 2 (4), then over the other ranks below 2
 *  each maximal run of ≥ 3 consecutive ranks holding ≥ 2 cards (3 ranks 3, 4 or more 6). */
export function tlThoi(cards: readonly Card[]): number {
  const n = new Array<number>(13).fill(0);
  let h = 0;
  for (const c of cards) {
    n[rankOf(c)] += 1;
    if (rankOf(c) === HEO) h += suitOf(c) >= 2 ? 2 : 1;
  }
  for (let r = 0; r < HEO; r++) {
    if (n[r] === 4) {
      h += 4;
      n[r] = 0;
    }
  }
  let run = 0;
  for (let r = 0; r <= HEO; r++) {
    if (r < HEO && n[r] >= 2) {
      run += 1;
    } else {
      h += run === 3 ? 3 : run >= 4 ? 6 : 0;
      run = 0;
    }
  }
  return h;
}

/** Tới trắng (§7.4, R10): the best pattern of a dealt hand, or null. */
export function tlTrang(cards: readonly Card[]): TlTrang | null {
  const n = new Array<number>(13).fill(0);
  for (const c of cards) n[rankOf(c)] += 1;
  if (n.slice(0, HEO).every((x) => x >= 1)) return "sanh_rong";
  for (let r = 0; r + 4 < HEO; r++) {
    if ([0, 1, 2, 3, 4].every((k) => n[r + k] >= 2)) return "nam_doi_thong";
  }
  if (n[HEO] === 4) return "tu_quy_heo";
  if (n.reduce((a, x) => a + Math.floor(x / 2), 0) >= 6) return "sau_doi";
  return null;
}

/** The strength of a tới trắng pattern: the highest wins (R10). */
export function tlTrangRank(p: TlTrang | null): number {
  return p === "sanh_rong" ? 4 : p === "nam_doi_thong" ? 3 : p === "tu_quy_heo" ? 2 : p === "sau_doi" ? 1 : 0;
}

// ------------------------------------------------------------------ money (§7.5)

export interface TlPlayer { played: boolean; out: TlOut | null; place: number | null; paid: number; settled: boolean }
export interface TlChain { h: number; victim: number; cutter: number; void: boolean }
export interface TlLine { from: number; to: number; h: number; paid: number; why: TlWhy }

/** What the money of a game reads and writes of the table's pub. */
export interface TlMoney {
  order: readonly number[];
  players: Readonly<Record<number, TlPlayer>>;
  chain: TlChain | null;
  lines: readonly TlLine[];
}

/** The money events (0017 _tl_money). A cut's top names the cards it cut. */
export type TlEvent =
  | { k: "cut"; seat: number; top: { seat: number; cards: readonly Card[]; done: boolean } }
  | { k: "close" }
  | { k: "out"; seat: number }
  | { k: "forfeit"; seats: readonly number[] }
  | { k: "leave"; seat: number }
  | { k: "trang"; seat: number }
  | { k: "end" };

/** The seats of `order` after `seat` in turn order (ascending, wrapping round), `seat` itself left out. */
export function seatsAfter(order: readonly number[], seat: number | null): number[] {
  if (seat === null) return [];
  const rest = order.filter((s) => s !== seat);
  return [...rest.filter((s) => s > seat).sort((a, b) => a - b), ...rest.filter((s) => s < seat).sort((a, b) => a - b)];
}

/** One line within the payer's cap of 20 h (R14): dropped when it pays nothing, when either side is settled, or when the
 *  recipient is one of `gone` (seats leaving together). */
function pay(m: TlMoney, from: number, to: number, h: number, why: TlWhy, gone: readonly number[] = []): TlMoney {
  const payer = m.players[from];
  if (h <= 0 || from === to || gone.includes(to) || (payer?.settled ?? true) || (m.players[to]?.settled ?? true)) return m;
  const x = Math.min(h, 20 - payer.paid);
  if (x <= 0) return m;
  return {
    ...m,
    players: { ...m.players, [from]: { ...payer, paid: payer.paid + x } },
    lines: [...m.lines, { from, to, h, paid: x, why }],
  };
}

function setPlayer(m: TlMoney, seat: number, patch: Partial<TlPlayer>): TlMoney {
  return { ...m, players: { ...m.players, [seat]: { ...m.players[seat], ...patch } } };
}

const placedCount = (m: TlMoney): number => Object.values(m.players).filter((p) => p.place !== null).length;

/** The money of a game, one event at a time: the next state (0017 _tl_money, the same steps in the same order). `hands`
 *  holds the cards each seat holds now, for thối. */
export function tlMoney(m0: TlMoney, ev: TlEvent, hands: Readonly<Record<number, readonly Card[]>>): TlMoney {
  let m = m0;
  const ord = m.order;
  const ch = m.chain;
  const held = (s: number): readonly Card[] => hands[s] ?? [];
  switch (ev.k) {
    case "cut": {
      const top = tlCombo(ev.top.cards);
      return {
        ...m,
        chain: { h: (ch?.h ?? 0) + (top ? tlValue(top) : 0), victim: ev.top.seat, cutter: ev.seat, void: ev.top.done },
      };
    }
    case "close":
      if (ch && !ch.void) m = pay(m, ch.victim, ch.cutter, ch.h, "chat");
      return { ...m, chain: null };
    case "out": {
      const s = ev.seat;
      const placed = placedCount(m);
      m = setPlayer(m, s, { out: "done", place: placed + 1 });
      if (placed === 0) {
        for (const p of seatsAfter(ord, s)) {
          if (m.players[p]?.out === null && !m.players[p].played) {
            m = setPlayer(m, p, { out: "cong" });
            m = pay(m, p, s, 4 + tlThoi(held(p)), "cong");
          }
        }
      }
      return m;
    }
    case "forfeit": {
      const f = [...ev.seats].sort((a, b) => a - b);
      for (const s of f) m = setPlayer(m, s, { out: "forfeit" });
      for (const s of f) {
        const c = m.chain;
        if (c && c.victim === s) {
          if (!c.void) m = pay(m, s, c.cutter, c.h, "chat", f);
          m = { ...m, chain: null };
        } else if (c && c.cutter === s) {
          m = { ...m, chain: null };
        }
        const r = seatsAfter(ord, s).filter((q) => m.players[q]?.out === null);
        for (const p of r) m = pay(m, s, p, 2, "forfeit", f);
        if (r.length > 0) m = pay(m, s, r[0], tlThoi(held(s)), "thoi", f);
      }
      for (const s of f) m = setPlayer(m, s, { settled: true });
      return m;
    }
    case "leave":
      return setPlayer(m, ev.seat, { settled: true });
    case "trang":
      for (const p of seatsAfter(ord, ev.seat)) m = pay(m, p, ev.seat, 4, "trang");
      return m;
    case "end": {
      if (ch && !ch.void) m = pay(m, ch.victim, ch.cutter, ch.h, "chat");
      m = { ...m, chain: null };
      let placed = placedCount(m);
      const holder = [...ord].sort((a, b) => a - b).find((q) => m.players[q]?.out === null) ?? null;
      if (holder !== null) {
        placed += 1;
        m = setPlayer(m, holder, { place: placed });
      }
      const nhat = ord.find((q) => m.players[q]?.place === 1) ?? null;
      for (const p of seatsAfter(ord, nhat).filter((q) => m.players[q]?.out === "cong")) {
        placed += 1;
        m = setPlayer(m, p, { place: placed });
      }
      const pl = ord.filter((q) => m.players[q]?.place !== null && m.players[q]?.place !== undefined)
        .sort((a, b) => (m.players[a].place ?? 0) - (m.players[b].place ?? 0));
      const n = pl.length;
      const cong = (s: number): boolean => m.players[s].out === "cong";
      if (n === 4) {
        if (!cong(pl[3])) m = pay(m, pl[3], pl[0], 2, "bet");
        if (!cong(pl[2])) m = pay(m, pl[2], pl[1], 1, "ba");
      } else if (n >= 2 && !cong(pl[n - 1])) {
        m = pay(m, pl[n - 1], pl[0], 2, "bet");
      }
      const hp = holder === null ? null : m.players[holder].place;
      if (holder !== null && hp !== null && hp > 1) m = pay(m, holder, pl[hp - 2], tlThoi(held(holder)), "thoi");
      return m;
    }
  }
}

/** Each seat's result of the lines: what it received minus what it paid (in half-stakes). */
export function tlNet(order: readonly number[], lines: readonly TlLine[]): Record<number, number> {
  const net: Record<number, number> = {};
  for (const s of order) net[s] = 0;
  for (const l of lines) {
    net[l.from] = (net[l.from] ?? 0) - l.paid;
    net[l.to] = (net[l.to] ?? 0) + l.paid;
  }
  return net;
}

/** A whole game's money from its events (every seat dealt 13, none settled at the start): what the rules book's examples
 *  and the fixtures fold. */
export interface TlGame {
  order: readonly number[];
  /** The seats that have played a card by the time of the first go-out (the others become cóng). */
  played: readonly number[];
  hands: Readonly<Record<number, readonly Card[]>>;
  events: readonly TlEvent[];
}

export function tlSettle(g: TlGame): { lines: TlLine[]; places: Record<number, number>; out: Record<number, TlOut>; net: Record<number, number> } {
  let m: TlMoney = {
    order: g.order, chain: null, lines: [],
    players: Object.fromEntries(g.order.map((s) => [s, { played: g.played.includes(s), out: null, place: null, paid: 0, settled: false }])),
  };
  for (const ev of g.events) m = tlMoney(m, ev, g.hands);
  const places: Record<number, number> = {};
  const out: Record<number, TlOut> = {};
  for (const s of g.order) {
    const p = m.players[s];
    if (p.place !== null) places[s] = p.place;
    if (p.out !== null) out[s] = p.out;
  }
  return { lines: [...m.lines], places, out, net: tlNet(g.order, m.lines) };
}

// ------------------------------------------------------------------ hints (§13.2)

/** Every combination type, weakest first, for sorting hints. */
const TYPE_ORDER: readonly TlType[] = ["single", "pair", "triple", "straight", "pairs", "quad"];

/** The candidate combinations of a hand, one per (type, length, key): the other cards are the lowest that fit, so each
 *  key a player could play appears once. */
export function tlCandidates(hand: readonly Card[]): TlCombo[] {
  const byRank: Card[][] = Array.from({ length: 13 }, () => []);
  for (const c of sortCards(hand)) byRank[rankOf(c)].push(c);
  const out: TlCombo[] = [];
  const push = (cards: Card[]) => {
    const x = tlCombo(cards);
    if (x) out.push(x);
  };
  for (let r = 0; r < 13; r++) {
    const cs = byRank[r];
    for (let k = 0; k < cs.length; k++) {
      push([cs[k]]);
      if (k >= 1) push([cs[0], cs[k]]);
      if (k >= 2) push([cs[0], cs[1], cs[k]]);
    }
    if (cs.length === 4) push(cs);
  }
  // sảnh: ranks lo … hi (no 2), the lowest card of each rank but the top one, whose every card gives a key
  for (let lo = 0; lo < HEO; lo++) {
    for (let hi = lo + 2; hi < HEO; hi++) {
      if (byRank.slice(lo, hi + 1).some((cs) => cs.length === 0)) break;
      const base = byRank.slice(lo, hi).map((cs) => cs[0]);
      for (const top of byRank[hi]) push([...base, top]);
    }
  }
  // đôi thông: the two lowest cards of each rank but the top one, whose pairs give each key once
  for (let lo = 0; lo < HEO; lo++) {
    for (let hi = lo + 2; hi < HEO; hi++) {
      if (byRank.slice(lo, hi + 1).some((cs) => cs.length < 2)) break;
      const base = byRank.slice(lo, hi).flatMap((cs) => cs.slice(0, 2));
      const top = byRank[hi];
      for (let k = 1; k < top.length; k++) push([...base, top[0], top[k]]);
    }
  }
  return out;
}

const hintOrder = (a: TlCombo, b: TlCombo): number =>
  Number(isBomb(a)) - Number(isBomb(b)) || a.key - b.key || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)
  || a.cards.length - b.cards.length;

/** The plays this hand may make on its turn (§7.3): with nothing on the table any combination (a first game's lead
 *  includes `must`), else those that beat the top. Weakest first, bombs last — the order of 💡 Gợi ý. */
export function tlLegalPlays(hand: readonly Card[], top: TlCombo | null, must: Card | null): TlCombo[] {
  const all = tlCandidates(hand);
  const ok = top === null
    ? all.filter((x) => must === null || x.cards.includes(must))
    : all.filter((x) => tlBeats(top, x));
  return ok.sort(hintOrder);
}

/** The 4 đôi thông of this hand that beat the top: what 💣 Chặt! may play out of turn (R9). */
export function tlSlams(hand: readonly Card[], top: TlCombo | null): TlCombo[] {
  if (top === null) return [];
  return tlCandidates(hand).filter((x) => x.type === "pairs" && x.len === 4 && tlBeats(top, x)).sort(hintOrder);
}

/** "Xếp bài" (§13.2): by rank, or grouped by combination — tứ quý, sám cô, đôi, then the rest, each ascending. */
export function tlArrange(hand: readonly Card[], mode: "rank" | "group"): Card[] {
  const sorted = sortCards(hand);
  if (mode === "rank") return sorted;
  const count = new Map<number, number>();
  for (const c of sorted) count.set(rankOf(c), (count.get(rankOf(c)) ?? 0) + 1);
  return [...sorted].sort((a, b) => (count.get(rankOf(b)) ?? 0) - (count.get(rankOf(a)) ?? 0) || a - b);
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (30 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/cards/deck.ts lib/game/cards/tienlen.ts tests/unit/cards-deck.test.ts tests/unit/cards-tienlen.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): the deck and the Tiến lên mirror — combinations, beating, thối, tới trắng, the money and the hints

lib/game/cards/deck.ts: cards as 0–51, their labels ("10♥"), aria names ("10 cơ"), codes and sorting.
lib/game/cards/tienlen.ts mirrors 0017's Tiến lên functions (tlCombo, tlBeats, tlValue, tlThoi, tlTrang, tlMoney,
tlSettle) and adds the client's hints: tlLegalPlays (one candidate per type, length and key, the bombs last), tlSlams
and tlArrange. The tests replay tests/fixtures/card-cases.json.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/cards/deck.ts lib/game/cards/tienlen.ts tests/unit/cards-deck.test.ts tests/unit/cards-tienlen.test.ts
git commit -F <message file>
```

---

### Task 9: The Cào and poker mirrors — hand values and names, the settlement, the evaluator, the pots, the legal actions

**Files:**
- Create: `lib/game/cards/cao.ts`, `lib/game/cards/poker.ts`
- Test: `tests/unit/cards-cao-poker.test.ts` (create)

**Interfaces:**
- Consumes: Task 8's deck; the `cao` and `poker` fixtures.
- Produces (`@/lib/game/cards/cao`), mirrors of section B: `CaoKind`, `CaoHand {kind, points, rank, top}`, `caoRank`, `caoKey`, `caoEval(cards)`, `caoCompare(a, b) → 1 | -1`, `CaoLine`, `caoSettle({dealer, order, left, hands}) → {lines, net}` (units of S), `caoName(hand)` ("Sáp K", "Ba tây", "7 nút", "Bù").
- Produces (`@/lib/game/cards/poker`): `pkRank`, `pkEval(cards) → number[]`, `pkCompare(a, b)` (PostgreSQL array order), `pkHandName(key)` (the Vietnamese rank names), `PkSeatPut`, `PkPot`, `pkPots({players, keys?, button}) → PkPot[]` (= `_pk_pots`); for the buttons and the slider: `PkSpot {cur, raise, bet, acted, chips, stake}`, `PkOptions {canCheck, canCall, callTo, callCost, canBet, canRaise, min, max, canAllin}`, `pkLegal(spot)`, `pkAmountOk(o, to)`, `pkPresets(o, spot, pot) → {min, half, pot}`, `pkBuyInRange(stake, coins) → {min, max} | null` (50–200 BB within the wallet), `pkTopUpRange(stake, chips, coins) → {min, max} | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cards-cao-poker.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { caoCompare, caoEval, caoKey, caoName, caoSettle } from "@/lib/game/cards/cao";
import { cardsOf, parseCard } from "@/lib/game/cards/deck";
import {
  pkAmountOk, pkBuyInRange, pkCompare, pkEval, pkHandName, pkLegal, pkPots, pkPresets, pkTopUpRange, type PkSeatPut,
} from "@/lib/game/cards/poker";
import fixtures from "@/tests/fixtures/card-cases.json";

type Codes = string[];
const FX = fixtures as unknown as {
  cao: {
    eval: Array<{ cards: Codes; expect: { kind: string; points: number; rank?: number; top: string } }>;
    cmp: Array<{ a: Codes; b: Codes; expect: number }>;
    settle: Array<{ name: string; dealer: number; order: number[]; left: number[]; hands: Record<string, Codes>;
                    expect: { lines: Array<[number, number, string]>; net: Record<string, number> } }>;
  };
  poker: {
    eval: Array<{ cards: Codes; expect: number[] }>;
    cmp: Array<{ a: Codes; b: Codes; expect: number }>;
    pots: Array<{ name: string; players: Record<string, PkSeatPut>; keys?: Record<string, number[]>; button: number; expect: unknown }>;
  };
};
const keyed = <T,>(o: Record<string, T>): Record<number, T> => Object.fromEntries(Object.entries(o).map(([k, v]) => [Number(k), v]));

describe("the shared Cào fixtures (the SQL smoke replays the same cases)", () => {
  it("hand values", () => {
    for (const k of FX.cao.eval) {
      const h = caoEval(cardsOf(k.cards));
      expect({ kind: h.kind, points: h.points, rank: h.rank, top: h.top }, k.cards.join(" "))
        .toEqual({ kind: k.expect.kind, points: k.expect.points, rank: k.expect.rank ?? null, top: caoKey(parseCard(k.expect.top)!) });
    }
  });
  it("comparisons, both ways", () => {
    for (const k of FX.cao.cmp) {
      const a = caoEval(cardsOf(k.a)), b = caoEval(cardsOf(k.b));
      expect(caoCompare(a, b), `${k.a.join(" ")} vs ${k.b.join(" ")}`).toBe(k.expect);
      expect(caoCompare(b, a)).toBe(-k.expect);
    }
  });
  for (const k of FX.cao.settle) {
    it(`settle: ${k.name}`, () => {
      const r = caoSettle({
        dealer: k.dealer, order: k.order, left: k.left,
        hands: keyed(Object.fromEntries(Object.entries(k.hands).map(([s, cs]) => [s, cardsOf(cs)]))),
      });
      expect(r.lines.map((l) => [l.from, l.to, l.why])).toEqual(k.expect.lines);
      expect(r.net).toEqual(keyed(k.expect.net));
    });
  }
  it("names a hand", () => {
    expect(caoName(caoEval(cardsOf(["4D", "4C", "4S"])))).toBe("Sáp 4");
    expect(caoName(caoEval(cardsOf(["KS", "KH", "KD"])))).toBe("Sáp K");
    expect(caoName(caoEval(cardsOf(["JS", "QH", "KC"])))).toBe("Ba tây");
    expect(caoName(caoEval(cardsOf(["7H", "10C", "AD"])))).toBe("8 nút");
    expect(caoName(caoEval(cardsOf(["10S", "JD", "QC"])))).toBe("Bù");
  });
});

describe("the shared poker fixtures (the SQL smoke replays the same cases)", () => {
  it("the evaluator", () => {
    for (const k of FX.poker.eval) expect(pkEval(cardsOf(k.cards)), k.cards.join(" ")).toEqual(k.expect);
  });
  it("comparisons", () => {
    for (const k of FX.poker.cmp) {
      expect(pkCompare(pkEval(cardsOf(k.a)), pkEval(cardsOf(k.b))), `${k.a.join(" ")} vs ${k.b.join(" ")}`).toBe(k.expect);
    }
  });
  for (const k of FX.poker.pots) {
    it(`pots: ${k.name}`, () => {
      expect(pkPots({ players: keyed(k.players), keys: k.keys ? keyed(k.keys) : null, button: k.button })).toEqual(k.expect);
    });
  }
  it("names a hand", () => {
    expect(pkHandName([1, 13, 9, 7, 4])).toBe("Đôi K");
    expect(pkHandName([2, 14, 8, 5])).toBe("Thú A và 8");
    expect(pkHandName([4, 5])).toBe("Sảnh 5");
    expect(pkHandName([6, 13, 4])).toBe("Cù lũ K 4");
    expect(pkHandName([0, 14, 12, 9, 7, 5])).toBe("Mậu thầu A");
    expect(pkHandName(pkEval(cardsOf(["KS", "KD"])))).toBe("Đôi K");
  });
});

describe("pkLegal: what the player to act may do (§9.1)", () => {
  it("the big blind's option preflop: check, or raise from 2 BB", () => {
    const o = pkLegal({ cur: 1000, raise: 1000, bet: 1000, acted: null, chips: 99_000, stake: 1000 });
    expect(o).toMatchObject({ canCheck: true, canCall: false, canBet: false, canRaise: true, min: 2000, max: 100_000, canAllin: true });
  });
  it("facing a bet: call it, or raise by at least the bet", () => {
    const o = pkLegal({ cur: 4000, raise: 4000, bet: 0, acted: null, chips: 10_000, stake: 1000 });
    expect(o).toMatchObject({ canCheck: false, canCall: true, callTo: 4000, callCost: 4000, canRaise: true, min: 8000, max: 10_000 });
    expect([pkAmountOk(o, 7999), pkAmountOk(o, 8000), pkAmountOk(o, 10_000), pkAmountOk(o, 10_001)]).toEqual([false, true, true, false]);
  });
  it("a short all-in does not re-open raising for a player who already acted (TDA 47)", () => {
    const o = pkLegal({ cur: 5000, raise: 4000, bet: 4000, acted: 4000, chips: 50_000, stake: 1000 });
    expect(o).toMatchObject({ canCall: true, callTo: 5000, callCost: 1000, canRaise: false, canAllin: false, min: 0, max: 0 });
    expect(pkAmountOk(o, 9000)).toBe(false);
  });
  it("a short stack calls all-in for less and cannot raise", () => {
    const o = pkLegal({ cur: 5000, raise: 5000, bet: 0, acted: null, chips: 3000, stake: 1000 });
    expect(o).toMatchObject({ canCall: true, callTo: 3000, callCost: 3000, canRaise: false, canAllin: true });
  });
  it("a bet: at least the big blind, less only all-in; the presets stay within the bounds", () => {
    const o = pkLegal({ cur: 0, raise: 1000, bet: 0, acted: null, chips: 20_000, stake: 1000 });
    expect(o).toMatchObject({ canCheck: true, canBet: true, canRaise: false, min: 1000, max: 20_000 });
    expect(pkPresets(o, { cur: 0, raise: 1000, bet: 0, acted: null, chips: 20_000, stake: 1000 }, 9000)).toEqual({ min: 1000, half: 4500, pot: 9000 });
    expect(pkPresets(o, { cur: 0, raise: 1000, bet: 0, acted: null, chips: 20_000, stake: 1000 }, 90_000)).toEqual({ min: 1000, half: 20_000, pot: 20_000 });
    const short = pkLegal({ cur: 0, raise: 1000, bet: 0, acted: null, chips: 500, stake: 1000 });
    expect(short).toMatchObject({ canBet: true, min: 500, max: 500 });
    const raise = { cur: 2000, raise: 1000, bet: 0, acted: null, chips: 50_000, stake: 1000 };
    expect(pkPresets(pkLegal(raise), raise, 3500)).toEqual({ min: 3000, half: 4750, pot: 7500 });
  });
  it("buy-in and top-up bounds", () => {
    expect(pkBuyInRange(1000, 500_000)).toEqual({ min: 50_000, max: 200_000 });
    expect(pkBuyInRange(1000, 80_000)).toEqual({ min: 50_000, max: 80_000 });
    expect(pkBuyInRange(1000, 49_999)).toBeNull();
    expect(pkTopUpRange(1000, 150_000, 1_000_000)).toEqual({ min: 1, max: 50_000 });
    expect(pkTopUpRange(1000, 200_000, 1_000_000)).toBeNull();
    expect(pkTopUpRange(100, 0, 700)).toEqual({ min: 1, max: 700 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/cards-cao-poker.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/game/cards/…"` (`cao.ts` and `poker.ts` do not exist yet; either may be named first).

- [ ] **Step 3: Write the two mirrors**

Create `lib/game/cards/cao.ts` with exactly:

```ts
import { rankOf, suitOf, type Card } from "./deck";

// Cào ba cây, "cào cái" (spec §8), on the client: the hand values, the comparison and the dealer's settlement, the same
// arithmetic as 0017 (_cao_key, _cao_eval, _cao_cmp, _cao_settle; tests/fixtures/card-cases.json pins both sides). Pure.

export type CaoKind = "sap" | "ba_tay" | "nut";

/** A hand: its class, its nút (the total mod 10), a sáp's rank (A 1 … K 13) and the key of its top card. */
export interface CaoHand { kind: CaoKind; points: number; rank: number | null; top: number }

/** The Cào rank of a card: A 1, 2–10 their number, J 11, Q 12, K 13. */
export function caoRank(c: Card): number {
  const r = rankOf(c);
  return r === 11 ? 1 : r === 12 ? 2 : r + 3;
}

/** A card's key for the tie-break (§8.1): cao_rank × 4 + cao_suit, with ♠ 0, ♣ 1, ♥ 2, ♦ 3. */
export function caoKey(c: Card): number {
  const s = suitOf(c);
  return caoRank(c) * 4 + (s === 2 ? 3 : s === 3 ? 2 : s);
}

export function caoEval(cards: readonly Card[]): CaoHand {
  const ranks = new Set(cards.map(rankOf));
  const sap = ranks.size === 1;
  const baTay = cards.every((c) => rankOf(c) >= 8 && rankOf(c) <= 10);
  return {
    kind: sap ? "sap" : baTay ? "ba_tay" : "nut",
    points: cards.reduce((a, c) => a + Math.min(caoRank(c), 10), 0) % 10,
    rank: sap ? Math.min(...cards.map(caoRank)) : null,
    top: Math.max(...cards.map(caoKey)),
  };
}

const classOf = (h: Pick<CaoHand, "kind">): number => (h.kind === "sap" ? 2 : h.kind === "ba_tay" ? 1 : 0);

/** 1 when a wins, −1 when b wins (R18, R19): sáp > ba tây > nút; two sáp by rank; ba tây, and equal nút, by the top card. */
export function caoCompare(a: CaoHand, b: CaoHand): number {
  const ca = classOf(a), cb = classOf(b);
  if (ca !== cb) return Math.sign(ca - cb);
  if (ca === 2) return Math.sign((a.rank ?? 0) - (b.rank ?? 0));
  if (ca === 0 && a.points !== b.points) return Math.sign(a.points - b.points);
  return Math.sign(a.top - b.top);
}

export interface CaoLine { from: number; to: number; why: "cao" | "left" }

/** A hand's money in units of S (§8.3): each player still in the hand wins or loses 1 against the dealer, and a player
 *  who left lost 1 to the dealer. */
export function caoSettle(p: { dealer: number; order: readonly number[]; left: readonly number[]; hands: Readonly<Record<number, readonly Card[]>> }):
  { lines: CaoLine[]; net: Record<number, number> } {
  const dh = caoEval(p.hands[p.dealer] ?? []);
  const lines: CaoLine[] = [];
  for (const s of p.order) {
    if (s === p.dealer) continue;
    if (p.left.includes(s)) lines.push({ from: s, to: p.dealer, why: "left" });
    else if (caoCompare(caoEval(p.hands[s] ?? []), dh) > 0) lines.push({ from: p.dealer, to: s, why: "cao" });
    else lines.push({ from: s, to: p.dealer, why: "cao" });
  }
  const net: Record<number, number> = {};
  for (const q of p.order) {
    net[q] = lines.reduce((a, l) => a + (l.to === q ? 1 : l.from === q ? -1 : 0), 0);
  }
  return { lines, net };
}

const CAO_RANK_NAMES = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/** "Sáp K", "Ba tây", "7 nút" or "Bù". */
export function caoName(h: Pick<CaoHand, "kind" | "points" | "rank">): string {
  if (h.kind === "sap") return `Sáp ${CAO_RANK_NAMES[h.rank ?? 0] ?? ""}`.trim();
  if (h.kind === "ba_tay") return "Ba tây";
  return h.points === 0 ? "Bù" : `${h.points} nút`;
}
```

Create `lib/game/cards/poker.ts` with exactly:

```ts
import { rankOf, suitOf, type Card } from "./deck";

// Texas Hold'em no-limit (spec §9) on the client: the evaluator, the pots, what the player to act may do, and the buy-in
// bounds — the same arithmetic as 0017 (_pk_rank, _pk_straight, _pk_eval, _pk_pots, _pk_do_act, card_sit, _pk_topup;
// tests/fixtures/card-cases.json pins the evaluator and the pots). Pure.

/** A card's poker rank: 2 … 14 (A = 14). */
export function pkRank(c: Card): number {
  return rankOf(c) === 12 ? 2 : rankOf(c) + 3;
}

/** The top of the best straight among these ranks (the ace also plays low: A-2-3-4-5 tops at 5), or null. */
function straightTop(ranks: readonly number[]): number | null {
  const have = new Set(ranks);
  if (have.has(14)) have.add(1);
  for (let t = 14; t >= 5; t--) {
    if ([0, 1, 2, 3, 4].every((k) => have.has(t - k))) return t;
  }
  return null;
}

const desc = (a: number, b: number) => b - a;

/** The best hand in up to 7 cards (§9.1) as a key compared lexicographically: [8, top] straight flush · [7, quad, kicker]
 *  · [6, trips, pair] · [5, the flush suit's top five] · [4, top] straight · [3, trips, k1, k2] · [2, high, low, kicker] ·
 *  [1, pair, k1, k2, k3] · [0, the top five]. Suits never break ties. */
export function pkEval(cards: readonly Card[]): number[] {
  const rs = cards.map(pkRank).sort(desc);
  const bySuit = [0, 1, 2, 3].map((s) => cards.filter((c) => suitOf(c) === s));
  const flush = bySuit.find((cs) => cs.length >= 5) ?? null;
  const fr = flush ? flush.map(pkRank).sort(desc) : [];
  if (flush) {
    const t = straightTop(fr);
    if (t !== null) return [8, t];
  }
  const count = new Map<number, number>();
  for (const r of rs) count.set(r, (count.get(r) ?? 0) + 1);
  const withCount = (n: number) => [...count].filter(([, k]) => k === n).map(([r]) => r).sort(desc);
  const quad = withCount(4)[0];
  if (quad !== undefined) return [7, quad, ...rs.filter((r) => r !== quad).slice(0, 1)];
  const tr = withCount(3);
  const pr = withCount(2);
  if (tr.length >= 2) return [6, tr[0], tr[1]];
  if (tr.length === 1 && pr.length >= 1) return [6, tr[0], pr[0]];
  if (flush) return [5, ...fr.slice(0, 5)];
  const t = straightTop(rs);
  if (t !== null) return [4, t];
  if (tr.length === 1) return [3, tr[0], ...rs.filter((r) => r !== tr[0]).slice(0, 2)];
  if (pr.length >= 2) return [2, pr[0], pr[1], ...rs.filter((r) => r !== pr[0] && r !== pr[1]).slice(0, 1)];
  if (pr.length === 1) return [1, pr[0], ...rs.filter((r) => r !== pr[0]).slice(0, 3)];
  return [0, ...rs.slice(0, 5)];
}

/** Compare two keys as Postgres compares integer arrays: element by element, a shorter prefix first. */
export function pkCompare(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  }
  return Math.sign(a.length - b.length);
}

const RANK = (r: number): string => (r === 14 || r === 1 ? "A" : r === 13 ? "K" : r === 12 ? "Q" : r === 11 ? "J" : String(r));

/** The Vietnamese name of a key: "Đôi K", "Thú A và 8", "Sảnh 9" … */
export function pkHandName(key: readonly number[]): string {
  const [cat, a, b] = key;
  switch (cat) {
    case 8: return a === 14 ? "Thùng phá sảnh A (royal flush)" : `Thùng phá sảnh ${RANK(a)}`;
    case 7: return `Tứ quý ${RANK(a)}`;
    case 6: return `Cù lũ ${RANK(a)} ${RANK(b)}`;
    case 5: return `Thùng ${RANK(a)}`;
    case 4: return `Sảnh ${RANK(a)}`;
    case 3: return `Sám ${RANK(a)}`;
    case 2: return `Thú ${RANK(a)} và ${RANK(b)}`;
    case 1: return `Đôi ${RANK(a)}`;
    default: return a === undefined ? "Mậu thầu" : `Mậu thầu ${RANK(a)}`;
  }
}

export interface PkSeatPut { put: number; fold?: boolean; allin?: boolean }
export interface PkPot { xu: number; seats: number[]; winners?: number[]; shares?: Record<number, number> }

/** The pots of a hand (§9.2): a level at each live all-in total and at the highest live total; each pot goes to the live
 *  seats that reach its level, and the top pot also takes every folded chip above the highest live total. With the live
 *  hands' keys (or one eligible seat) each pot gets its winners; its odd xu go one at a time to the winners in seat order
 *  starting left of the button (TDA 20). */
export function pkPots(p: { players: Readonly<Record<number, PkSeatPut>>; keys?: Readonly<Record<number, readonly number[]>> | null; button: number | null }): PkPot[] {
  const seats = Object.keys(p.players).map(Number).sort((a, b) => a - b);
  const live = seats.filter((s) => !p.players[s].fold);
  const put = (s: number) => p.players[s].put;
  if (live.length === 0) return [];
  const top = Math.max(...live.map(put));
  if (top <= 0) return [];
  const levels = [...new Set([...live.filter((s) => p.players[s].allin).map(put), top])].filter((x) => x > 0).sort((a, b) => a - b);
  const pots: PkPot[] = [];
  let prev = 0;
  for (const lvl of levels) {
    const amt = seats.reduce((a, s) => a + Math.min(put(s), lvl) - Math.min(put(s), prev), 0);
    const el = live.filter((s) => put(s) >= lvl);
    if (amt > 0) {
      const last = pots[pots.length - 1];
      if (last && last.seats.length === el.length && last.seats.every((s, i) => s === el[i])) last.xu += amt;
      else pots.push({ xu: amt, seats: el });
    }
    prev = lvl;
  }
  const over = seats.reduce((a, s) => a + Math.max(put(s) - top, 0), 0);
  if (over > 0) pots[pots.length - 1].xu += over;
  const btn = p.button;
  const order = (s: number) => (btn === null ? s : (s - btn + 5) % 6);
  return pots.map((pot) => {
    let w: number[] | null = null;
    if (pot.seats.length === 1) {
      w = pot.seats;
    } else if (p.keys) {
      const key = (s: number) => p.keys?.[s] ?? [];
      const best = pot.seats.map(key).reduce((m, k) => (pkCompare(k, m) > 0 ? k : m));
      w = pot.seats.filter((s) => pkCompare(key(s), best) === 0);
    }
    if (w === null) return pot;
    const q = Math.floor(pot.xu / w.length), r = pot.xu % w.length;
    const ranked = [...w].sort((a, b) => order(a) - order(b));
    return { ...pot, winners: w, shares: Object.fromEntries(ranked.map((s, i) => [s, q + (i < r ? 1 : 0)])) };
  });
}

/** What the player to act sees of the hand (the parsed pub and the seat's stack). */
export interface PkSpot {
  cur: number;
  raise: number;
  /** My bet this street, the bet level I last acted at (null: not yet this street), my stack. */
  bet: number;
  acted: number | null;
  chips: number;
  /** The table's stake (the big blind). */
  stake: number;
}

/** What I may do on my turn (§9.1; 0017 _pk_do_act). Amounts are "to" levels this street. */
export interface PkOptions {
  canCheck: boolean;
  canCall: boolean;
  /** The level a call brings me to (all-in when short) and what it costs. */
  callTo: number;
  callCost: number;
  /** "Cược": nothing bet this street. "Tố lên": a bet exists and I may raise. */
  canBet: boolean;
  canRaise: boolean;
  /** The slider's bounds for a bet or a raise. */
  min: number;
  max: number;
  canAllin: boolean;
}

export function pkLegal(s: PkSpot): PkOptions {
  const stack = s.bet + s.chips;
  const may = s.acted === null || s.cur - s.acted >= s.raise;
  const canBet = s.cur === 0 && s.chips > 0;
  const canRaise = s.cur > 0 && may && stack > s.cur;
  const min = canBet ? Math.min(s.stake, stack) : canRaise ? Math.min(s.cur + s.raise, stack) : 0;
  const callTo = Math.min(s.cur, stack);
  return {
    canCheck: s.cur <= s.bet,
    canCall: s.cur > s.bet,
    callTo,
    callCost: Math.max(0, callTo - s.bet),
    canBet,
    canRaise,
    min,
    max: canBet || canRaise ? stack : 0,
    canAllin: s.chips > 0 && !(stack > s.cur && !may),
  };
}

/** Is `to` a bet or raise the server takes (not counting all-in, which is always `stack`)? */
export function pkAmountOk(o: PkOptions, to: number): boolean {
  return (o.canBet || o.canRaise) && Number.isInteger(to) && to >= o.min && to <= o.max;
}

/** The slider's presets (§13.2): the minimum, half the pot and the pot, each kept within the bounds. A pot-sized raise
 *  first calls, then raises by the pot after the call. */
export function pkPresets(o: PkOptions, s: PkSpot, pot: number): { min: number; half: number; pot: number } {
  const clamp = (x: number) => Math.max(o.min, Math.min(o.max, Math.floor(x)));
  const after = pot + Math.max(0, s.cur - s.bet);
  return {
    min: o.min,
    half: clamp(o.canBet ? pot / 2 : s.cur + after / 2),
    pot: clamp(o.canBet ? pot : s.cur + after),
  };
}

/** The buy-in slider (card_sit): 50–200 big blinds, no more than the wallet; null when the wallet cannot cover 50. */
export function pkBuyInRange(stake: number, coins: number): { min: number; max: number } | null {
  const min = 50 * stake, max = Math.min(200 * stake, coins);
  return max >= min ? { min, max } : null;
}

/** A top-up between hands (R23): up to 200 big blinds on the table, no more than the wallet; null when none fits. */
export function pkTopUpRange(stake: number, chips: number, coins: number): { min: number; max: number } | null {
  const max = Math.min(200 * stake - chips, coins);
  return max >= 1 ? { min: 1, max } : null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: the command of Step 2.
Expected: PASS (23 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/cards/cao.ts lib/game/cards/poker.ts tests/unit/cards-cao-poker.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): the Cào and poker mirrors — hand values and names, the settlement, the evaluator, the pots, the legal actions

lib/game/cards/cao.ts mirrors _cao_eval, _cao_cmp and _cao_settle and names the hands ("Sáp K", "Ba tây", "7 nút");
lib/game/cards/poker.ts mirrors _pk_eval and _pk_pots and adds pkHandName, pkLegal (what the server takes: check, call,
the bet or raise bounds, all-in), pkPresets (½ pot, pot), pkBuyInRange and pkTopUpRange. The tests replay the fixtures.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/cards/cao.ts lib/game/cards/poker.ts tests/unit/cards-cao-poker.test.ts
git commit -F <message file>
```

---

### Task 10: The client's state parsers, the RPC wrappers and the Vietnamese texts

**Files:**
- Create: `lib/game/cards/state.ts`, `lib/game/cards/rpc.ts`, `lib/game/cards/messages.ts`
- Test: `tests/unit/cards-state.test.ts`, `tests/unit/cards-rpc.test.ts`, `tests/unit/cards-messages.test.ts`, and the shared builders `tests/unit/helpers/card-states.ts` (create)

**Interfaces:**
- Consumes: Tasks 8–9; `screenAnswer(data, error)`, `AnticheatError`, `lockText(sec)` and `lockSeconds(err)` from `@/lib/anticheat` (the envelope and the lock, as the farm and fishing `call()` use them), `isMissingRpc(err)` from `@/lib/game/farm/messages`, `supabase` from `@/lib/supabase`; the answers of Tasks 3–6's RPCs.
- Produces (`@/lib/game/cards/state`): the types `CardPhase`, `CardSeat {seat, id, name, chips, escrow, leaving}`, `TlPub`/`TlLast`, `CaoPub`/`CaoLast`, `PkPub`/`PkLast`, `CardState` (a union by `game`: `serverNow`, `stake`, `max`, `v`, `seq`, `handNo`, `phase`, `turn`, `deadline`, `seats`, `pub`, `last`), `CardHand {serverNow, game, handNo, seat, cards}`, `CardLobby`, `LobbyTable`, `CardAnswer {changed, state, hand, coins}`, `CardTick {changed, state}`; `parseCardState`, `parseCardHand`, `parseCardLobby`, `parseCardAnswer`, `parseCardTick` (each `null` when malformed), `mySeat(state, accountId)`, `inHand(state, hand)`, `secondsLeft(state, nowMs)`.
- Produces (`@/lib/game/cards/rpc`): `fetchCardLobby(roomId, token)`, `fetchCardState(roomId, token, game)`, `fetchCardHand(roomId, token, game)`, `tickCardTable(roomId, token, game)`; `type CardAction = sit | leave | topup | tl_play | tl_pass | cao_deal | pk_act` (with `seq` where the RPC takes it), `cardActionCall(game, action) → [rpc name, args]`, `cardAction(roomId, token, game, action) → CardAnswer`; a refusal is thrown as the PostgREST error, an envelope as `AnticheatError`.
- Produces (`@/lib/game/cards/messages`): `GAME_NAME`, `TABLE_TITLE` ("🃏 Bàn Tiến lên", "🃏 Chiếu Cào", "🃏 Bàn Poker"), `CARDS_NOT_OPEN`, `CARDS_LOADING`, `CARDS_FAILED`, `WAITING_PLAYERS`, `WATCHING`, `SIT_HERE`, `STAND_UP`, `LEAVE_CONFIRM`, `DEALER_WAIT`, `CANCELLED`, `NO_DEALER`, `PLAY_MONEY`, `STAKES`, `xuNum`, `signedXu`, `stakeLine`, `hallLabel`, `statusLine`, `seatChipText`, `turnToast`, `holdLine`, `PLACE_NAME`, `placeBadge`, `TRANG_NAME`, `thoiName`, `tlResultLines`, `caoHandName`, `cutBanner`, `mustText`, `cardErrorMessage(err, must?)` (every error of §11.5 verbatim; a missing RPC → `CARDS_NOT_OPEN`; `account locked` → `lockText`).
- Produces (tests): `tests/unit/helpers/card-states.ts` — `T0`, `at(seconds)`, `ID` (six account ids), `NAMES`, `seatRaw(seat, over)`, `tlRaw(over, pub)`, `caoRaw(over, pub)`, `pkRaw(over, pub)`, `parsed(raw) → CardState`, `cs(...codes)`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/helpers/card-states.ts` with exactly:

```ts
import { cardsOf } from "@/lib/game/cards/deck";
import { parseCardState, type CardState } from "@/lib/game/cards/state";

/** card_state answers as the server sends them (spec §11.4), for the parser, hook and panel tests. */

export const T0 = "2026-09-26T10:00:00+00:00";
export const at = (sec: number): string => new Date(Date.parse(T0) + sec * 1000).toISOString();
export const ID = ["a1", "a2", "a3", "a4", "a5", "a6"].map((x) => `00000000-0000-4000-8000-0000000000${x}`);
export const NAMES = ["An", "Bình", "Chi", "Dũng", "Em", "Giang"];

export type Raw = Record<string, unknown>;

export function seatRaw(seat: number, over: Raw = {}): Raw {
  return { seat, id: ID[seat - 1], name: NAMES[seat - 1], chips: 0, escrow: 0, leaving: false, ...over };
}

function base(game: string, max: number, over: Raw): Raw {
  return {
    server_now: T0, game, stake: 1000, max, v: 10, seq: 5, hand_no: 3, phase: "playing", turn: 1, deadline: at(15),
    seats: [], pub: {}, last: null, ...over,
  };
}

/** A Tiến lên game: seats 1–4 dealt, 1 to play, 3♠ lead done. */
export function tlRaw(over: Raw = {}, pub: Raw = {}): Raw {
  const players: Raw = {};
  for (const s of [1, 2, 3, 4]) {
    players[s] = { id: ID[s - 1], n: 13, played: false, out: null, place: null, paid: 0, settled: false };
  }
  return base("tienlen", 4, {
    seats: [1, 2, 3, 4].map((s) => seatRaw(s, { escrow: 10000 })),
    pub: {
      first: false, must: null, order: [1, 2, 3, 4], players, top: null, passed: [], pile: [], chain: null, lines: [], ...pub,
    },
    ...over,
  });
}

/** A Cào hand in peek: seats 1–3, dealer 2. */
export function caoRaw(over: Raw = {}, pub: Raw = {}): Raw {
  return base("cao", 6, {
    phase: "peek", turn: null,
    seats: [1, 2, 3].map((s) => seatRaw(s, { escrow: s === 2 ? 2000 : 1000 })),
    pub: { dealer: 2, order: [1, 2, 3], left: [], note: null, ...pub },
    ...over,
  });
}

/** A poker hand preflop: seats 1–3, button 1, SB 2, BB 3, seat 1 to act. */
export function pkRaw(over: Raw = {}, pub: Raw = {}): Raw {
  const p = (s: number, bet: number, last: string | null) => ({
    id: ID[s - 1], bet, put: bet, fold: false, allin: false, acted: null, pending: true, last,
  });
  return base("poker", 6, {
    seats: [1, 2, 3].map((s) => seatRaw(s, { chips: 100000 - (s === 2 ? 500 : s === 3 ? 1000 : 0) })),
    pub: {
      button: 1, sb: 2, bb: 3, street: "preflop", board: [], cur: 1000, raise: 1000, pot: 1500, order: [1, 2, 3],
      players: { 1: p(1, 0, null), 2: p(2, 500, "sb"), 3: p(3, 1000, "bb") }, ...pub,
    },
    ...over,
  });
}

export function parsed(raw: Raw): CardState {
  const s = parseCardState(raw);
  if (!s) throw new Error("the sample state does not parse");
  return s;
}

export const cs = (...codes: string[]): number[] => cardsOf(codes);
```

Create `tests/unit/cards-state.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import {
  inHand, mySeat, parseCardAnswer, parseCardHand, parseCardLobby, parseCardState, parseCardTick, secondsLeft,
} from "@/lib/game/cards/state";
import { at, caoRaw, cs, ID, parsed, pkRaw, seatRaw, T0, tlRaw } from "./helpers/card-states";

describe("parseCardState (spec §11.4)", () => {
  it("reads a Tiến lên game: the seats, the top, the pile, the chain and the lines", () => {
    const s = parseCardState(tlRaw({}, {
      must: null, top: { type: "pair", len: 2, key: cs("9H")[0], cards: cs("9S", "9H"), seat: 2, done: false },
      pile: [{ seat: 1, cards: cs("7S", "7C") }, { seat: 2, cards: cs("9S", "9H") }], passed: [3],
      chain: { h: 3, victim: 4, cutter: 2, void: false }, lines: [{ from: 4, to: 2, h: 3, paid: 3, why: "chat" }],
    }));
    expect(s?.game).toBe("tienlen");
    if (s?.game !== "tienlen" || !s.pub) throw new Error("no pub");
    expect(s).toMatchObject({ serverNow: Date.parse(T0), stake: 1000, max: 4, v: 10, seq: 5, handNo: 3, phase: "playing", turn: 1,
      deadline: Date.parse(at(15)) });
    expect(s.seats[0]).toEqual({ seat: 1, id: ID[0], name: "An", chips: 0, escrow: 10000, leaving: false });
    expect(s.pub.top).toMatchObject({ type: "pair", len: 2, key: cs("9H")[0], seat: 2, done: false });
    expect(s.pub.pile).toHaveLength(2);
    expect(s.pub.chain).toEqual({ h: 3, victim: 4, cutter: 2, void: false });
    expect(s.pub.players[4]).toMatchObject({ id: ID[3], n: 13, out: null, place: null });
    expect(s.last).toBeNull();
  });

  it("reads an idle table (no stake, no deadline, pub {}) and a result", () => {
    const idle = parseCardState({ server_now: T0, game: "poker", stake: null, max: 6, v: 0, seq: 0, hand_no: 0, phase: "idle",
      turn: null, deadline: null, seats: [], pub: {}, last: null });
    expect(idle).toMatchObject({ game: "poker", stake: null, deadline: null, pub: null, last: null, seats: [] });
    const done = parsed(tlRaw({ phase: "result", turn: null, last: {
      hand_no: 3, trang: null, places: [1, 2, 3, 4], out: { 1: "done", 2: "done", 3: "done" }, hands: { 4: cs("2S") },
      lines: [{ from: 4, to: 1, xu: 1000, paid: 1000, why: "bet" }], net: { 1: 1000, 2: 0, 3: 0, 4: -1000 },
    } }));
    expect(done.game === "tienlen" && done.last).toMatchObject({ places: [1, 2, 3, 4], hands: { 4: cs("2S") }, net: { 4: -1000 } });
  });

  it("reads a Cào hand and its showdown, and a poker hand and its pots", () => {
    const c = parsed(caoRaw({ phase: "result", last: {
      hand_no: 3, dealer: 2, cancelled: false, hands: { 1: { cards: cs("9S", "8C", "2H"), kind: "nut", points: 9 } },
      lines: [{ from: 2, to: 1, xu: 1000, why: "cao" }], net: { 1: 1000, 2: -1000 },
    } }));
    expect(c.game === "cao" && c.pub).toEqual({ dealer: 2, order: [1, 2, 3], left: [], note: null });
    expect(c.game === "cao" && c.last?.hands[1]).toEqual({ cards: cs("9S", "8C", "2H"), kind: "nut", points: 9 });
    const wait = parsed(caoRaw({ phase: "deal_wait", turn: null }, { dealer: null, order: [], note: "no_dealer" }));
    expect(wait.game === "cao" && wait.pub?.note).toBe("no_dealer");
    const p = parsed(pkRaw({ last: { hand_no: 2, board: cs("2S", "7D", "9C", "JH", "KS"), uncontested: false, shown: { 1: cs("AS", "AH") },
      pots: [{ xu: 3000, seats: [1, 2], winners: [1], hand: [1, 14, 13, 11, 9] }], net: { 1: 1500, 2: -1500 } } }));
    if (p.game !== "poker" || !p.pub || !p.last) throw new Error("no poker");
    expect(p.pub).toMatchObject({ button: 1, sb: 2, bb: 3, street: "preflop", cur: 1000, pot: 1500, order: [1, 2, 3] });
    expect(p.pub.players[3]).toMatchObject({ bet: 1000, last: "bb", acted: null, pending: true });
    expect(p.last).toMatchObject({ cancelled: false, uncontested: false, pots: [{ xu: 3000, winners: [1], hand: [1, 14, 13, 11, 9] }] });
  });

  it("is null on malformed input", () => {
    expect(parseCardState(null)).toBeNull();
    expect(parseCardState({ ...tlRaw(), game: "liêng" })).toBeNull();
    expect(parseCardState({ ...tlRaw(), phase: "nap" })).toBeNull();
    expect(parseCardState({ ...tlRaw(), seats: [seatRaw(1, { chips: "9" })] })).toBeNull();
    expect(parseCardState(tlRaw({}, { order: "1,2" }))).toBeNull();
    expect(parseCardState(tlRaw({}, { must: 99 }))).toBeNull();
    expect(parseCardState(tlRaw({}, { top: { cards: cs("3S", "5D"), seat: 1, done: false } }))).toBeNull();
    expect(parseCardState(pkRaw({}, { street: "fifth" }))).toBeNull();
    expect(parseCardState(caoRaw({}, { note: "late" }))).toBeNull();
    expect(parseCardState({ ...tlRaw(), deadline: "soon" })).toBeNull();
  });
});

describe("the other answers", () => {
  it("card_hand: my cards, none when I am not in the hand", () => {
    expect(parseCardHand({ server_now: T0, game: "tienlen", hand_no: 3, seat: 2, cards: cs("3S", "2H") }))
      .toEqual({ serverNow: Date.parse(T0), game: "tienlen", handNo: 3, seat: 2, cards: cs("3S", "2H") });
    expect(parseCardHand({ server_now: T0, game: "cao", hand_no: 0, seat: null, cards: [] })).toMatchObject({ seat: null, cards: [] });
    expect(parseCardHand({ server_now: T0, game: "cao", hand_no: 0, seat: null, cards: [52] })).toBeNull();
  });

  it("card_lobby: every table's stake, phase and seats", () => {
    const l = parseCardLobby({ server_now: T0, tables: [
      { game: "tienlen", stake: 1000, phase: "playing", max: 4, seats: [{ seat: 1, id: ID[0], name: "An" }] },
      { game: "cao", stake: null, phase: "idle", max: 6, seats: [] },
    ] });
    expect(l?.tables).toEqual([
      { game: "tienlen", stake: 1000, phase: "playing", max: 4, seats: [{ seat: 1, id: ID[0], name: "An" }] },
      { game: "cao", stake: null, phase: "idle", max: 6, seats: [] },
    ]);
    expect(parseCardLobby({ server_now: T0, tables: [{ game: "cao", stake: null, phase: "idle", max: 6 }] })).toBeNull();
  });

  it("a write's answer and a tick's", () => {
    const a = parseCardAnswer({ changed: true, state: tlRaw(), hand: { server_now: T0, game: "tienlen", hand_no: 3, seat: 1, cards: cs("3S") },
      coins: 42 });
    expect(a).toMatchObject({ changed: true, coins: 42, hand: { seat: 1 } });
    expect(parseCardAnswer({ changed: true, state: { nope: 1 } })).toBeNull();
    expect(parseCardTick({ changed: false, state: caoRaw() })).toMatchObject({ changed: false, state: { game: "cao" } });
  });
});

describe("reading a state", () => {
  it("finds my seat, whether I am in the hand, and the seconds left", () => {
    const s = parsed(tlRaw({ seats: [seatRaw(1), seatRaw(2, { leaving: true })] }));
    expect(mySeat(s, ID[1])?.leaving).toBe(true);
    expect(mySeat(s, ID[4])).toBeNull();
    const hand = { serverNow: 0, game: "tienlen" as const, handNo: 3, seat: 1, cards: cs("3S") };
    expect(inHand(s, hand)).toBe(true);
    expect(inHand(s, { ...hand, handNo: 2 })).toBe(false);
    expect(inHand(s, { ...hand, cards: [] })).toBe(false);
    expect(secondsLeft(s, Date.parse(T0))).toBe(15);
    expect(secondsLeft(s, Date.parse(T0) + 14_100)).toBe(1);
    expect(secondsLeft(s, Date.parse(T0) + 99_000)).toBe(0);
  });
});
```

Create `tests/unit/cards-rpc.test.ts` with exactly:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

import { AnticheatError, subscribeAnticheat, type AnticheatEvent } from "@/lib/anticheat";
import {
  cardAction, cardActionCall, fetchCardHand, fetchCardLobby, fetchCardState, tickCardTable,
} from "@/lib/game/cards/rpc";
import { caoRaw, cs, T0, tlRaw } from "./helpers/card-states";

const events: AnticheatEvent[] = [];
let off: () => void = () => {};
beforeEach(() => {
  h.rpc.mockReset();
  events.length = 0;
  off = subscribeAnticheat((e) => events.push(e));
});
afterEach(() => off());

describe("card reads (spec §11.3)", () => {
  it("call their RPCs with the room, the token and the game", async () => {
    h.rpc.mockResolvedValueOnce({ data: { server_now: T0, tables: [] }, error: null });
    expect(await fetchCardLobby("r", "tok")).toEqual({ serverNow: Date.parse(T0), tables: [] });
    expect(h.rpc).toHaveBeenLastCalledWith("card_lobby", { p_room_id: "r", p_session_token: "tok" });
    h.rpc.mockResolvedValueOnce({ data: tlRaw(), error: null });
    expect((await fetchCardState("r", "tok", "tienlen")).game).toBe("tienlen");
    expect(h.rpc).toHaveBeenLastCalledWith("card_state", { p_room_id: "r", p_session_token: "tok", p_game: "tienlen" });
    h.rpc.mockResolvedValueOnce({ data: { server_now: T0, game: "cao", hand_no: 3, seat: 1, cards: cs("9S", "8C", "2H") }, error: null });
    expect((await fetchCardHand("r", "tok", "cao")).cards).toHaveLength(3);
    h.rpc.mockResolvedValueOnce({ data: { changed: true, state: caoRaw() }, error: null });
    expect(await tickCardTable("r", "tok", "cao")).toMatchObject({ changed: true, state: { game: "cao" } });
    expect(h.rpc).toHaveBeenLastCalledWith("card_tick", { p_room_id: "r", p_session_token: "tok", p_game: "cao" });
  });

  it("throw on an error or a malformed answer", async () => {
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "invalid game", code: "22023" } });
    await expect(fetchCardState("r", "tok", "tienlen")).rejects.toMatchObject({ message: "invalid game" });
    h.rpc.mockResolvedValueOnce({ data: { what: 1 }, error: null });
    await expect(fetchCardState("r", "tok", "tienlen")).rejects.toThrow("bad card state");
  });
});

describe("card writes", () => {
  it("name each action's RPC and arguments", () => {
    expect(cardActionCall("poker", { kind: "sit", seat: 3, stake: 1000, buyin: 100_000 }))
      .toEqual(["card_sit", { p_game: "poker", p_seat: 3, p_stake: 1000, p_buyin: 100_000 }]);
    expect(cardActionCall("tienlen", { kind: "sit", seat: 1, stake: 100, buyin: null }))
      .toEqual(["card_sit", { p_game: "tienlen", p_seat: 1, p_stake: 100, p_buyin: null }]);
    expect(cardActionCall("cao", { kind: "leave" })).toEqual(["card_leave", { p_game: "cao" }]);
    expect(cardActionCall("poker", { kind: "topup", amount: 5000 })).toEqual(["pk_topup", { p_amount: 5000 }]);
    expect(cardActionCall("tienlen", { kind: "tl_play", seq: 7, cards: [0, 1] })).toEqual(["tl_play", { p_seq: 7, p_cards: [0, 1] }]);
    expect(cardActionCall("tienlen", { kind: "tl_pass", seq: 7 })).toEqual(["tl_pass", { p_seq: 7 }]);
    expect(cardActionCall("cao", { kind: "cao_deal", seq: 2 })).toEqual(["cao_deal", { p_seq: 2 }]);
    expect(cardActionCall("poker", { kind: "pk_act", seq: 9, action: "raise", amount: 4000 }))
      .toEqual(["pk_act", { p_seq: 9, p_action: "raise", p_amount: 4000 }]);
  });

  it("answer the state, my hand and my coins", async () => {
    h.rpc.mockResolvedValueOnce({ data: { changed: true, state: tlRaw(), hand: { server_now: T0, game: "tienlen", hand_no: 3, seat: 1,
      cards: cs("3S") }, coins: 9000 }, error: null });
    const a = await cardAction("r", "tok", "tienlen", { kind: "tl_pass", seq: 5 });
    expect(h.rpc).toHaveBeenCalledWith("tl_pass", { p_room_id: "r", p_session_token: "tok", p_seq: 5 });
    expect(a).toMatchObject({ changed: true, coins: 9000, hand: { cards: cs("3S") } });
  });

  it("a flagged answer throws an AnticheatError and reports a strike; a lock is reported (anti-cheat §12.1)", async () => {
    h.rpc.mockResolvedValueOnce({ data: { anticheat: { code: "bad_cards", strike: 1, error: "invalid cards",
      locked_until: "2026-09-26T10:05:00+00:00", banned: false, server_now: T0 } }, error: null });
    const err = await cardAction("r", "tok", "tienlen", { kind: "tl_play", seq: 5, cards: [99] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AnticheatError);
    expect((err as AnticheatError).message).toBe("invalid cards");
    expect(events.map((e) => e.kind)).toEqual(["strike"]);
    h.rpc.mockResolvedValueOnce({ data: { anticheat: { code: "bad_move", strike: 0, error: "cannot beat", locked_until: null,
      banned: false, server_now: T0 } }, error: null });
    await expect(cardAction("r", "tok", "tienlen", { kind: "tl_play", seq: 5, cards: [0] })).rejects.toMatchObject({ message: "cannot beat" });
    expect(events).toHaveLength(1);
    h.rpc.mockResolvedValueOnce({ data: null, error: { message: "account locked", details: "120", code: "42501" } });
    await expect(cardAction("r", "tok", "cao", { kind: "cao_deal", seq: 1 })).rejects.toMatchObject({ message: "account locked" });
    expect(events.map((e) => e.kind)).toEqual(["strike", "lock"]);
  });
});
```

Create `tests/unit/cards-messages.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { AnticheatError } from "@/lib/anticheat";
import { cardsOf } from "@/lib/game/cards/deck";
import {
  CARDS_NOT_OPEN, cardErrorMessage, hallLabel, holdLine, placeBadge, seatChipText, signedXu, stakeLine, statusLine, thoiName,
  tlResultLines, turnToast,
} from "@/lib/game/cards/messages";

describe("cardErrorMessage (spec §11.5): every error in Vietnamese", () => {
  const TABLE: Array<[string, string]> = [
    ["invalid game", "Bàn bài không hợp lệ."],
    ["invalid seat", "Ghế không hợp lệ."],
    ["invalid stake", "Mức cược của bàn không hợp lệ."],
    ["invalid quantity", "Số xu không hợp lệ."],
    ["invalid cards", "Lá bài không hợp lệ."],
    ["invalid bet", "Số tiền cược không hợp lệ."],
    ["stale", "Bàn vừa thay đổi — xem lại nhé."],
    ["not seated", "Bạn chưa ngồi bàn này."],
    ["already seated", "Bạn đang ngồi một bàn khác trong phòng."],
    ["still leaving", "Ván bạn vừa rời chưa xong — hết ván đó bạn mới ngồi lại được."],
    ["table full", "Bàn đã đủ người."],
    ["seat taken", "Ghế này có người rồi."],
    ["stake changed", "Mức cược vừa đổi — xem lại nhé."],
    ["not enough coins", "Không đủ xu."],
    ["not your turn", "Chưa tới lượt bạn."],
    ["invalid play", "Bộ bài không hợp lệ."],
    ["cannot beat", "Bài này không chặn được."],
    ["must play", "Bạn đang mở vòng — phải đánh."],
    ["cannot raise", "Chưa được tố thêm — chỉ theo hoặc úp."],
    ["hand running", "Đang có ván — chờ hết ván nhé."],
    ["too many chips", "Trên bàn tối đa 200 lần mù lớn."],
    ["not dealer", "Chỉ nhà cái được chia bài."],
    ["dealer busy", "Nhà cái chờ lật bài xong rồi hãy rời bàn."],
    ["wrong phase", "Chưa tới lúc làm việc này."],
    ["invalid session", "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại."],
    ["account banned", "Tài khoản đã bị khoá."],
    ["account is not a member of this room", "Bạn không còn ở trong phòng này."],
    ["something odd", "Có lỗi, thử lại nhé."],
  ];
  for (const [code, text] of TABLE) {
    it(code, () => expect(cardErrorMessage({ message: code })).toBe(text));
  }
  it("must include names the card", () => {
    expect(cardErrorMessage({ message: "must include" }, cardsOf(["3C"])[0])).toBe("Ván đầu phải đánh kèm lá 3♣.");
    expect(cardErrorMessage({ message: "must include" })).toBe("Ván đầu phải đánh kèm lá 3♠.");
  });
  it("the lock, a strike-0 envelope's refusal and a missing RPC", () => {
    expect(cardErrorMessage({ message: "account locked", details: "90" })).toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 1 phút 30 giây.");
    const env = new AnticheatError({ code: "bad_move", strike: 0, error: "cannot beat", lockedUntil: null, banned: false, serverNow: null });
    expect(cardErrorMessage(env)).toBe("Bài này không chặn được.");
    expect(cardErrorMessage({ code: "PGRST202", message: "Could not find the function public.card_state" })).toBe(CARDS_NOT_OPEN);
    expect(CARDS_NOT_OPEN).toBe("Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017.");
    expect(cardErrorMessage(null)).toBe("Có lỗi, thử lại nhé.");
  });
});

describe("the table's texts (spec §5, §13)", () => {
  it("stakes, labels and lines", () => {
    expect(stakeLine("tienlen", 1000)).toBe("Mức cược 1.000 xu");
    expect(stakeLine("poker", 1000)).toBe("Mù 500/1.000");
    expect(hallLabel({ game: "tienlen", stake: 1000, phase: "playing", max: 4, seats: [{ seat: 1, id: "a", name: "A" }, { seat: 2, id: "b", name: "B" }] }))
      .toBe("Tiến lên · 2/4 · 1.000");
    expect(hallLabel({ game: "poker", stake: 1000, phase: "playing", max: 6,
      seats: [1, 2, 3, 4, 5].map((s) => ({ seat: s, id: String(s), name: String(s) })) })).toBe("Poker · 5/6 · 500/1.000");
    expect(hallLabel({ game: "cao", stake: null, phase: "idle", max: 6, seats: [] })).toBe("Trống");
    expect(holdLine("tienlen", 1000)).toBe("Mỗi ván giữ tạm 10.000 để trả thua — hết ván trả lại phần dư.");
    expect(holdLine("cao", 1000)).toBe("Mỗi ván giữ tạm 1.000; khi làm cái giữ 1.000 × số nhà con.");
    expect([signedXu(1000), signedXu(-2500), signedXu(0)]).toEqual(["+1.000", "−2.500", "0"]);
  });

  it("the status line and the HUD chip", () => {
    expect(statusLine("idle", 1, 0, null)).toBe("Chờ người chơi (cần ít nhất 2)");
    expect(statusLine("countdown", 2, 7, null)).toBe("Ván mới sau 7 giây");
    expect(statusLine("playing", 3, 14, { mine: true, name: "An" })).toBe("Đến lượt bạn! 14s");
    expect(statusLine("playing", 3, 9, { mine: false, name: "Bình" })).toBe("Lượt Bình · 9s");
    expect(statusLine("peek", 3, 4, null)).toBe("Lật bài sau 4 giây");
    expect(seatChipText("tienlen", "turn", 14)).toBe("🃏 Tiến lên · Đến lượt bạn! 14s");
    expect(seatChipText("poker", "playing", 0)).toBe("🃏 Poker · Đang chơi");
    expect(seatChipText("cao", "waiting", 0)).toBe("🃏 Cào · Chờ ván mới");
    expect(turnToast("cao")).toBe("🃏 Đến lượt bạn ở bàn Cào!");
  });

  it("places and the result lines", () => {
    expect([placeBadge(1, 4), placeBadge(2, 4), placeBadge(3, 4), placeBadge(4, 4), placeBadge(3, 3), placeBadge(2, 2)])
      .toEqual(["Về nhất", "Về nhì", "Về ba", "Về bét", "Về bét", "Về bét"]);
    expect(thoiName(cardsOf(["2S", "5D"]))).toBe("Thối heo");
    expect(thoiName(cardsOf(["9S", "9C", "9D", "9H"]))).toBe("Thối hàng");
    const name = (s: number) => "ABCD"[s - 1];
    expect(tlResultLines({ trang: null, hands: { 4: cardsOf(["2S"]) }, lines: [
      { from: 4, to: 2, xu: 1000, paid: 1000, why: "forfeit" }, { from: 4, to: 3, xu: 1000, paid: 1000, why: "forfeit" },
      { from: 4, to: 2, xu: 500, paid: 500, why: "thoi" }, { from: 4, to: 1, xu: 5000, paid: 5000, why: "cong" },
    ] }, name)).toEqual(["Xử thua: D trả mỗi người 1.000", "Thối heo: D trả B 500", "Cóng: D trả A 5.000"]);
    expect(tlResultLines({ trang: { pattern: "sau_doi" }, hands: {}, lines: [{ from: 1, to: 3, xu: 2000, paid: 2000, why: "trang" }] }, name))
      .toEqual(["Tới trắng: 6 đôi", "Tới trắng: A trả C 2.000"]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/cards-state.test.ts tests/unit/cards-rpc.test.ts tests/unit/cards-messages.test.ts`
Expected: FAIL — each file stops at `Failed to resolve import "@/lib/game/cards/…"`.

- [ ] **Step 3: Write the parsers, the wrappers and the texts**

Create `lib/game/cards/state.ts` with exactly:

```ts
import type { CaoKind } from "./cao";
import { isCard, isCardGame, type Card, type CardGame } from "./deck";
import { tlCombo, type TlChain, type TlCombo, type TlLine, type TlOut, type TlTrang, type TlWhy } from "./tienlen";

// The card RPCs' JSON (spec §11.3, §11.4), camelCased, with times as ms since the epoch: the lobby, a table's public
// state, the caller's hand and the answers. Defensive: anything malformed parses to null. Pure.

export type CardPhase = "idle" | "countdown" | "playing" | "result" | "deal_wait" | "peek";
const PHASES: readonly string[] = ["idle", "countdown", "playing", "result", "deal_wait", "peek"];

export interface CardSeat { seat: number; id: string; name: string; chips: number; escrow: number; leaving: boolean }

export interface TlTop extends TlCombo { seat: number; done: boolean }
export interface TlPubPlayer { id: string; n: number; played: boolean; out: TlOut | null; place: number | null; paid: number; settled: boolean }
export interface TlPub {
  first: boolean;
  /** The card a first game's lead must include, until the first play. */
  must: Card | null;
  order: number[];
  players: Record<number, TlPubPlayer>;
  top: TlTop | null;
  passed: number[];
  /** This round's plays, the last 8. */
  pile: Array<{ seat: number; cards: Card[] }>;
  chain: TlChain | null;
  /** The lines applied so far, in half-stakes. */
  lines: TlLine[];
}
export interface TlLastLine { from: number; to: number; xu: number; paid: number; why: TlWhy }
export interface TlLast {
  handNo: number;
  trang: { seat: number; pattern: TlTrang; cards: Card[] } | null;
  /** The seats in place order. */
  places: number[];
  out: Record<number, TlOut>;
  /** The cards still held at the end (forfeiters' included; the tới trắng hand alone). */
  hands: Record<number, Card[]>;
  lines: TlLastLine[];
  net: Record<number, number>;
}

export interface CaoPub { dealer: number | null; order: number[]; left: number[]; note: "no_dealer" | null }
export interface CaoLastLine { from: number; to: number; xu: number; why: "cao" | "left" }
export interface CaoLast {
  handNo: number;
  dealer: number | null;
  /** The dealer was removed: every escrow went back ("Ván huỷ"). */
  cancelled: boolean;
  hands: Record<number, { cards: Card[]; kind: CaoKind; points: number }>;
  lines: CaoLastLine[];
  net: Record<number, number>;
}

export type PkStreet = "preflop" | "flop" | "turn" | "river";
export interface PkPubPlayer {
  id: string; bet: number; put: number; fold: boolean; allin: boolean;
  /** The bet level at my last action this street (null: none yet). */
  acted: number | null;
  pending: boolean;
  last: string | null;
}
export interface PkPub {
  button: number; sb: number; bb: number; street: PkStreet; board: Card[]; cur: number; raise: number; pot: number;
  order: number[]; players: Record<number, PkPubPlayer>;
}
export interface PkLastPot { xu: number; seats: number[]; winners: number[]; hand: number[] | null }
export interface PkLast {
  handNo: number; board: Card[]; uncontested: boolean;
  /** Nobody was left in the hand: every contribution went back. */
  cancelled: boolean;
  shown: Record<number, Card[]>;
  pots: PkLastPot[];
  net: Record<number, number>;
}

interface StateBase {
  serverNow: number;
  stake: number | null;
  max: number;
  v: number;
  seq: number;
  handNo: number;
  phase: CardPhase;
  turn: number | null;
  deadline: number | null;
  seats: CardSeat[];
}
export type TlState = StateBase & { game: "tienlen"; pub: TlPub | null; last: TlLast | null };
export type CaoState = StateBase & { game: "cao"; pub: CaoPub | null; last: CaoLast | null };
export type PkState = StateBase & { game: "poker"; pub: PkPub | null; last: PkLast | null };
export type CardState = TlState | CaoState | PkState;

export interface CardHand { serverNow: number; game: CardGame; handNo: number; seat: number | null; cards: Card[] }
export interface LobbyTable { game: CardGame; stake: number | null; phase: CardPhase; max: number; seats: Array<{ seat: number; id: string; name: string }> }
export interface CardLobby { serverNow: number; tables: LobbyTable[] }
/** A write's answer: the state, my hand and my wallet after it. */
export interface CardAnswer { changed: boolean; state: CardState; hand: CardHand | null; coins: number | null }
export interface CardTick { changed: boolean; state: CardState }

// ------------------------------------------------------------------ readers (null = malformed)

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);
const intOrNull = (v: unknown): number | null | undefined => (v === null || v === undefined ? null : int(v) ?? undefined);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const ints = (v: unknown): number[] | null => (Array.isArray(v) && v.every((x) => int(x) !== null) ? (v as number[]) : null);
const cards = (v: unknown): Card[] | null => (Array.isArray(v) && v.every(isCard) ? (v as Card[]) : null);

/** A JSON object keyed by seat numbers, each value read by `f`; null when a key or a value is bad. */
function bySeat<T>(v: unknown, f: (x: unknown) => T | null): Record<number, T> | null {
  const o = obj(v);
  if (!o) return null;
  const out: Record<number, T> = {};
  for (const [k, x] of Object.entries(o)) {
    const s = Number(k);
    const y = f(x);
    if (!Number.isInteger(s) || y === null) return null;
    out[s] = y;
  }
  return out;
}

function list<T>(v: unknown, f: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const y = f(x);
    if (y === null) return null;
    out.push(y);
  }
  return out;
}

const OUTS: readonly string[] = ["done", "cong", "forfeit"];
const WHYS: readonly string[] = ["bet", "ba", "chat", "thoi", "cong", "trang", "forfeit"];
const TRANGS: readonly string[] = ["sanh_rong", "nam_doi_thong", "tu_quy_heo", "sau_doi"];
const out = (v: unknown): TlOut | null => (typeof v === "string" && OUTS.includes(v) ? (v as TlOut) : null);

function tlPlayer(v: unknown): TlPubPlayer | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.id), n = int(o.n), played = bool(o.played), paid = int(o.paid), settled = bool(o.settled);
  const place = intOrNull(o.place);
  const o2 = o.out === null || o.out === undefined ? null : out(o.out);
  if (id === null || n === null || played === null || paid === null || settled === null || place === undefined) return null;
  if (o.out !== null && o.out !== undefined && o2 === null) return null;
  return { id, n, played, out: o2, place, paid, settled };
}

function tlTop(v: unknown): TlTop | null | undefined {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const cs = cards(o?.cards);
  const seat = int(o?.seat), done = bool(o?.done);
  const x = cs ? tlCombo(cs) : null;
  if (!o || !x || seat === null || done === null) return undefined;
  return { ...x, seat, done };
}

function tlChain(v: unknown): TlChain | null | undefined {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  const h = int(o?.h), victim = int(o?.victim), cutter = int(o?.cutter), vd = bool(o?.void);
  return h === null || victim === null || cutter === null || vd === null ? undefined : { h, victim, cutter, void: vd };
}

function tlLine(v: unknown): TlLine | null {
  const o = obj(v);
  const from = int(o?.from), to = int(o?.to), h = int(o?.h), paid = int(o?.paid), why = str(o?.why);
  return from === null || to === null || h === null || paid === null || why === null || !WHYS.includes(why) ? null
    : { from, to, h, paid, why: why as TlWhy };
}

function tlPub(o: Obj): TlPub | null {
  const first = bool(o.first), order = ints(o.order), players = bySeat(o.players, tlPlayer), passed = ints(o.passed);
  const must = intOrNull(o.must);
  const top = tlTop(o.top), chain = tlChain(o.chain);
  const pile = list(o.pile, (x) => {
    const p = obj(x);
    const seat = int(p?.seat), cs = cards(p?.cards);
    return seat === null || cs === null ? null : { seat, cards: cs };
  });
  const lines = list(o.lines, tlLine);
  if (first === null || order === null || players === null || passed === null || must === undefined || (must !== null && !isCard(must))
      || top === undefined || chain === undefined || pile === null || lines === null) return null;
  return { first, must, order, players, top, passed, pile, chain, lines };
}

function tlLast(o: Obj): TlLast | null {
  const handNo = int(o.hand_no), places = ints(o.places), outs = bySeat(o.out, out), hands = bySeat(o.hands, cards);
  const net = bySeat(o.net, int);
  const lines = list(o.lines, (x) => {
    const l = obj(x);
    const from = int(l?.from), to = int(l?.to), xu = int(l?.xu), paid = int(l?.paid), why = str(l?.why);
    return from === null || to === null || xu === null || paid === null || why === null || !WHYS.includes(why) ? null
      : { from, to, xu, paid, why: why as TlWhy };
  });
  let trang: TlLast["trang"] = null;
  if (o.trang !== null && o.trang !== undefined) {
    const t = obj(o.trang);
    const seat = int(t?.seat), pattern = str(t?.pattern), cs = cards(t?.cards);
    if (seat === null || pattern === null || !TRANGS.includes(pattern) || cs === null) return null;
    trang = { seat, pattern: pattern as TlTrang, cards: cs };
  }
  if (handNo === null || places === null || outs === null || hands === null || net === null || lines === null) return null;
  return { handNo, trang, places, out: outs, hands, lines, net };
}

function caoPub(o: Obj): CaoPub | null {
  const dealer = intOrNull(o.dealer), order = ints(o.order), left = ints(o.left);
  const note = o.note === "no_dealer" ? "no_dealer" : o.note === null || o.note === undefined ? null : undefined;
  if (dealer === undefined || order === null || left === null || note === undefined) return null;
  return { dealer, order, left, note };
}

const KINDS: readonly string[] = ["sap", "ba_tay", "nut"];

function caoLast(o: Obj): CaoLast | null {
  const handNo = int(o.hand_no), dealer = intOrNull(o.dealer), cancelled = bool(o.cancelled), net = bySeat(o.net, int);
  const hands = bySeat(o.hands, (x) => {
    const h = obj(x);
    const cs = cards(h?.cards), kind = str(h?.kind), points = int(h?.points);
    return cs === null || kind === null || !KINDS.includes(kind) || points === null ? null : { cards: cs, kind: kind as CaoKind, points };
  });
  const lines = list(o.lines, (x): CaoLastLine | null => {
    const l = obj(x);
    const from = int(l?.from), to = int(l?.to), xu = int(l?.xu), why = l?.why;
    return from === null || to === null || xu === null || (why !== "cao" && why !== "left") ? null : { from, to, xu, why };
  });
  if (handNo === null || dealer === undefined || cancelled === null || net === null || hands === null || lines === null) return null;
  return { handNo, dealer, cancelled, hands, lines, net };
}

const STREETS: readonly string[] = ["preflop", "flop", "turn", "river"];

function pkPlayer(v: unknown): PkPubPlayer | null {
  const o = obj(v);
  if (!o) return null;
  const id = str(o.id), bet = int(o.bet), put = int(o.put), fold = bool(o.fold), allin = bool(o.allin), pending = bool(o.pending);
  const acted = intOrNull(o.acted);
  const last = o.last === null || o.last === undefined ? null : str(o.last);
  if (id === null || bet === null || put === null || fold === null || allin === null || pending === null || acted === undefined
      || (o.last !== null && o.last !== undefined && last === null)) return null;
  return { id, bet, put, fold, allin, acted, pending, last };
}

function pkPub(o: Obj): PkPub | null {
  const button = int(o.button), sb = int(o.sb), bb = int(o.bb), street = str(o.street), board = cards(o.board);
  const cur = int(o.cur), raise = int(o.raise), pot = int(o.pot), order = ints(o.order), players = bySeat(o.players, pkPlayer);
  if (button === null || sb === null || bb === null || street === null || !STREETS.includes(street) || board === null || cur === null
      || raise === null || pot === null || order === null || players === null) return null;
  return { button, sb, bb, street: street as PkStreet, board, cur, raise, pot, order, players };
}

function pkLast(o: Obj): PkLast | null {
  const handNo = int(o.hand_no), board = cards(o.board), uncontested = bool(o.uncontested), shown = bySeat(o.shown, cards);
  const net = bySeat(o.net, int);
  const pots = list(o.pots, (x) => {
    const p = obj(x);
    const xu = int(p?.xu), seats = ints(p?.seats), winners = p?.winners === null || p?.winners === undefined ? [] : ints(p.winners);
    const hand = p?.hand === null || p?.hand === undefined ? null : ints(p.hand);
    if (xu === null || seats === null || winners === null || (p?.hand !== null && p?.hand !== undefined && hand === null)) return null;
    return { xu, seats, winners, hand };
  });
  if (handNo === null || board === null || uncontested === null || shown === null || net === null || pots === null) return null;
  return { handNo, board, uncontested, cancelled: o.cancelled === true, shown, pots, net };
}

function seatOf(v: unknown): CardSeat | null {
  const o = obj(v);
  const seat = int(o?.seat), id = str(o?.id), name = str(o?.name), chips = int(o?.chips), escrow = int(o?.escrow), leaving = bool(o?.leaving);
  return seat === null || id === null || name === null || chips === null || escrow === null || leaving === null ? null
    : { seat, id, name, chips, escrow, leaving };
}

/** A pub or a last: an empty object or null is "none"; anything else must parse. */
function part<T>(v: unknown, f: (o: Obj) => T | null): T | null | undefined {
  if (v === null || v === undefined) return null;
  const o = obj(v);
  if (!o) return undefined;
  if (Object.keys(o).length === 0) return null;
  return f(o) ?? undefined;
}

/** card_state (§11.4). */
export function parseCardState(raw: unknown): CardState | null {
  const o = obj(raw);
  if (!o) return null;
  const serverNow = time(o.server_now), game = o.game, max = int(o.max), v = int(o.v), seq = int(o.seq), handNo = int(o.hand_no);
  const phase = str(o.phase), stake = intOrNull(o.stake), turn = intOrNull(o.turn);
  const deadline = o.deadline === null || o.deadline === undefined ? null : time(o.deadline);
  const seats = list(o.seats, seatOf);
  if (serverNow === null || !isCardGame(game) || max === null || v === null || seq === null || handNo === null || phase === null
      || !PHASES.includes(phase) || stake === undefined || turn === undefined || seats === null
      || (o.deadline !== null && o.deadline !== undefined && deadline === null)) return null;
  const base: StateBase = { serverNow, stake, max, v, seq, handNo, phase: phase as CardPhase, turn, deadline, seats };
  if (game === "tienlen") {
    const pub = part(o.pub, tlPub), last = part(o.last, tlLast);
    return pub === undefined || last === undefined ? null : { ...base, game, pub, last };
  }
  if (game === "cao") {
    const pub = part(o.pub, caoPub), last = part(o.last, caoLast);
    return pub === undefined || last === undefined ? null : { ...base, game, pub, last };
  }
  const pub = part(o.pub, pkPub), last = part(o.last, pkLast);
  return pub === undefined || last === undefined ? null : { ...base, game, pub, last };
}

/** card_hand (§11.3): `cards` is empty when I am not in the hand. */
export function parseCardHand(raw: unknown): CardHand | null {
  const o = obj(raw);
  const serverNow = time(o?.server_now), game = o?.game, handNo = int(o?.hand_no), seat = intOrNull(o?.seat), cs = cards(o?.cards);
  if (!o || serverNow === null || !isCardGame(game) || handNo === null || seat === undefined || cs === null) return null;
  return { serverNow, game, handNo, seat, cards: cs };
}

/** card_lobby (§11.3). */
export function parseCardLobby(raw: unknown): CardLobby | null {
  const o = obj(raw);
  const serverNow = time(o?.server_now);
  const tables = list(o?.tables, (x) => {
    const t = obj(x);
    const game = t?.game, stake = intOrNull(t?.stake), phase = str(t?.phase), max = int(t?.max);
    const seats = list(t?.seats, (y) => {
      const s = obj(y);
      const seat = int(s?.seat), id = str(s?.id), name = str(s?.name);
      return seat === null || id === null || name === null ? null : { seat, id, name };
    });
    if (!isCardGame(game) || stake === undefined || phase === null || !PHASES.includes(phase) || max === null || seats === null) return null;
    return { game, stake, phase: phase as CardPhase, max, seats };
  });
  return serverNow === null || tables === null ? null : { serverNow, tables };
}

/** A write's answer {changed, state, hand, coins}. */
export function parseCardAnswer(raw: unknown): CardAnswer | null {
  const o = obj(raw);
  const state = parseCardState(o?.state);
  const changed = bool(o?.changed);
  if (!o || !state || changed === null) return null;
  const hand = o.hand === undefined || o.hand === null ? null : parseCardHand(o.hand);
  if (o.hand !== undefined && o.hand !== null && hand === null) return null;
  return { changed, state, hand, coins: int(o.coins) };
}

/** card_tick's answer {changed, state}. */
export function parseCardTick(raw: unknown): CardTick | null {
  const o = obj(raw);
  const state = parseCardState(o?.state);
  const changed = bool(o?.changed);
  return !o || !state || changed === null ? null : { changed, state };
}

// ------------------------------------------------------------------ reading a state

/** My seat at this table (a `leaving` one included: it still holds the seat until the hand ends). */
export function mySeat(s: CardState, accountId: string): CardSeat | null {
  return s.seats.find((x) => x.id === accountId) ?? null;
}

/** Am I dealt into the table's current hand? Only card_hand knows: my cards for this hand. */
export function inHand(s: CardState, hand: CardHand | null): boolean {
  return hand !== null && hand.handNo === s.handNo && hand.cards.length > 0 && (s.phase === "playing" || s.phase === "peek");
}

/** Whole seconds left before the deadline on the server's clock (0 when past or none). */
export function secondsLeft(s: Pick<CardState, "deadline">, now: number): number {
  return s.deadline === null ? 0 : Math.max(0, Math.ceil((s.deadline - now) / 1000));
}
```

Create `lib/game/cards/rpc.ts` with exactly:

```ts
import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import type { CardGame } from "./deck";
import {
  parseCardAnswer, parseCardHand, parseCardLobby, parseCardState, parseCardTick,
  type CardAnswer, type CardHand, type CardLobby, type CardState, type CardTick,
} from "./state";

// Supabase calls for the card corner (spec §11.3). The reads are snapshots; card_tick and the writes lock the table and
// apply what is due first. A flagged answer (anti-cheat §9.1) throws an AnticheatError, exactly as the farm and the
// fishing wrappers do (anti-cheat §12.1).

/** An RPC's answer; a flagged answer throws an AnticheatError. */
async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return data;
}

function parsed<T>(v: T | null, what: string): T {
  if (v === null) throw new Error(`bad ${what}`);
  return v;
}

export async function fetchCardLobby(roomId: string, token: string): Promise<CardLobby> {
  return parsed(parseCardLobby(await call("card_lobby", { p_room_id: roomId, p_session_token: token })), "card lobby");
}

export async function fetchCardState(roomId: string, token: string, game: CardGame): Promise<CardState> {
  return parsed(parseCardState(await call("card_state", { p_room_id: roomId, p_session_token: token, p_game: game })), "card state");
}

export async function fetchCardHand(roomId: string, token: string, game: CardGame): Promise<CardHand> {
  return parsed(parseCardHand(await call("card_hand", { p_room_id: roomId, p_session_token: token, p_game: game })), "card hand");
}

/** Apply what is due at the table (§10). */
export async function tickCardTable(roomId: string, token: string, game: CardGame): Promise<CardTick> {
  return parsed(parseCardTick(await call("card_tick", { p_room_id: roomId, p_session_token: token, p_game: game })), "card tick");
}

/** Every card write (§11.3). The game actions carry the table's `seq` (R24). */
export type CardAction =
  | { kind: "sit"; seat: number; stake: number; buyin: number | null }
  | { kind: "leave" }
  | { kind: "topup"; amount: number }
  | { kind: "tl_play"; seq: number; cards: number[] }
  | { kind: "tl_pass"; seq: number }
  | { kind: "cao_deal"; seq: number }
  | { kind: "pk_act"; seq: number; action: "fold" | "check" | "call" | "bet" | "raise" | "allin"; amount: number | null };

/** The RPC name and its own arguments for an action at `game`'s table. */
export function cardActionCall(game: CardGame, a: CardAction): [string, Record<string, unknown>] {
  switch (a.kind) {
    case "sit": return ["card_sit", { p_game: game, p_seat: a.seat, p_stake: a.stake, p_buyin: a.buyin }];
    case "leave": return ["card_leave", { p_game: game }];
    case "topup": return ["pk_topup", { p_amount: a.amount }];
    case "tl_play": return ["tl_play", { p_seq: a.seq, p_cards: a.cards }];
    case "tl_pass": return ["tl_pass", { p_seq: a.seq }];
    case "cao_deal": return ["cao_deal", { p_seq: a.seq }];
    case "pk_act": return ["pk_act", { p_seq: a.seq, p_action: a.action, p_amount: a.amount }];
  }
}

export async function cardAction(roomId: string, token: string, game: CardGame, a: CardAction): Promise<CardAnswer> {
  const [fn, args] = cardActionCall(game, a);
  return parsed(parseCardAnswer(await call(fn, { p_room_id: roomId, p_session_token: token, ...args })), "card answer");
}
```

Create `lib/game/cards/messages.ts` with exactly:

```ts
import { lockSeconds, lockText } from "@/lib/anticheat";
import { isMissingRpc } from "@/lib/game/farm/messages";
import { caoName, caoEval } from "./cao";
import { cardLabel, rankOf, type Card, type CardGame } from "./deck";
import type { CardPhase, LobbyTable, TlLastLine } from "./state";
import { tlThoi, type TlTrang } from "./tienlen";

// The card corner's Vietnamese texts (spec §5, §11.5, §13): names, the table and HUD lines, the results and the RPC
// errors. Pure.

export { isMissingRpc };

export const GAME_NAME: Record<CardGame, string> = { tienlen: "Tiến lên", cao: "Cào", poker: "Poker" };
export const TABLE_TITLE: Record<CardGame, string> = { tienlen: "🃏 Bàn Tiến lên", cao: "🃏 Chiếu Cào", poker: "🃏 Bàn Poker" };

export const CARDS_NOT_OPEN = "Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017.";
export const CARDS_LOADING = "Đang tải bàn…";
export const CARDS_FAILED = "Chưa tải được bàn — thử lại nhé.";
export const WAITING_PLAYERS = "Chờ người chơi (cần ít nhất 2)";
export const WATCHING = "👀 Đang xem";
export const SIT_HERE = "Ngồi đây";
export const STAND_UP = "Đứng dậy";
export const LEAVE_CONFIRM = "Rời bàn giữa ván sẽ bị xử thua… Hết ván này bạn mới ngồi lại được.";
export const DEALER_WAIT = "Chờ lật bài xong";
export const CANCELLED = "Ván huỷ — đã trả lại tiền giữ";
export const NO_DEALER = "Chưa ai đủ xu làm cái";
export const PLAY_MONEY = "🪙 Xu chỉ là điểm trong trò chơi — không mua bằng tiền thật, không đổi ra tiền thật.";
export const STAKES: readonly number[] = [100, 1000, 10000];

/** "1.000" (vi-VN grouping, no unit). */
export function xuNum(n: number): string {
  return n.toLocaleString("vi-VN");
}

/** "+1.000", "−500" or "0". */
export function signedXu(n: number): string {
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${xuNum(Math.abs(n))}`;
}

/** "Mức cược 1.000 xu", or for poker "Mù 500/1.000". */
export function stakeLine(game: CardGame, stake: number): string {
  return game === "poker" ? `Mù ${xuNum(stake / 2)}/${xuNum(stake)}` : `Mức cược ${xuNum(stake)} xu`;
}

/** The hall's label over a table (§5): "Tiến lên · 2/4 · 1.000", "Poker · 5/6 · 500/1.000", or "Trống". */
export function hallLabel(t: LobbyTable): string {
  if (t.seats.length === 0 || t.stake === null) return "Trống";
  const stake = t.game === "poker" ? `${xuNum(t.stake / 2)}/${xuNum(t.stake)}` : xuNum(t.stake);
  return `${GAME_NAME[t.game]} · ${t.seats.length}/${t.max} · ${stake}`;
}

/** The panel's status line (§13.2). `turnName` is null when it is my turn. */
export function statusLine(phase: CardPhase, seats: number, secs: number, turn: { mine: boolean; name: string } | null): string {
  if (phase === "idle" || seats < 2) return WAITING_PLAYERS;
  if (phase === "countdown" || phase === "result") return `Ván mới sau ${secs} giây`;
  if (phase === "peek") return `Lật bài sau ${secs} giây`;
  if (!turn) return "";
  return turn.mine ? `Đến lượt bạn! ${secs}s` : `Lượt ${turn.name} · ${secs}s`;
}

/** The HUD chip while seated (§13.1): "🃏 Tiến lên · Đến lượt bạn! 14s", "· Đang chơi" or "· Chờ ván mới". */
export function seatChipText(game: CardGame, state: "turn" | "playing" | "waiting", secs: number): string {
  const tail = state === "turn" ? `Đến lượt bạn! ${secs}s` : state === "playing" ? "Đang chơi" : "Chờ ván mới";
  return `🃏 ${GAME_NAME[game]} · ${tail}`;
}

/** The toast once per turn while the panel is closed. */
export function turnToast(game: CardGame): string {
  return `🃏 Đến lượt bạn ở bàn ${GAME_NAME[game]}!`;
}

/** The sit dialog's requirement line (§13.2) for Tiến lên and Cào. */
export function holdLine(game: "tienlen" | "cao", stake: number): string {
  return game === "tienlen"
    ? `Mỗi ván giữ tạm ${xuNum(10 * stake)} để trả thua — hết ván trả lại phần dư.`
    : `Mỗi ván giữ tạm ${xuNum(stake)}; khi làm cái giữ ${xuNum(stake)} × số nhà con.`;
}

export const PLACE_NAME: readonly string[] = ["", "Về nhất", "Về nhì", "Về ba", "Về bét"];

/** A Tiến lên seat's place badge: nhất, nhì, then ba or bét (the last of 3 or 2 is bét). */
export function placeBadge(place: number, placed: number): string {
  if (place === 1) return PLACE_NAME[1];
  if (place === placed) return PLACE_NAME[4];
  return PLACE_NAME[place] ?? "";
}

export const TRANG_NAME: Record<TlTrang, string> = {
  sanh_rong: "sảnh rồng", nam_doi_thong: "5 đôi thông", tu_quy_heo: "tứ quý heo", sau_doi: "6 đôi",
};

/** "Thối heo", "Thối hàng" or "Thối heo và hàng", from the cards still held. */
export function thoiName(held: readonly Card[]): string {
  const heo = held.some((c) => rankOf(c) === 12);
  const hang = tlThoi(held.filter((c) => rankOf(c) !== 12)) > 0;
  return heo && hang ? "Thối heo và hàng" : hang ? "Thối hàng" : "Thối heo";
}

/** The result's Tiến lên lines (§13.2), in xu: "Thối heo: D trả C 500", "Cóng: D trả A 5.000", "Tới trắng: 6 đôi",
 *  "Xử thua: D trả mỗi người 1.000". A forfeit's 1 S lines of equal amounts are told once. */
export function tlResultLines(last: { trang: { pattern: TlTrang } | null; lines: readonly TlLastLine[]; hands: Readonly<Record<number, readonly Card[]>> },
  name: (seat: number) => string): string[] {
  const out: string[] = [];
  if (last.trang) out.push(`Tới trắng: ${TRANG_NAME[last.trang.pattern]}`);
  const lines = last.lines;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const pay = `${name(l.from)} trả ${name(l.to)} ${xuNum(l.paid)}`;
    switch (l.why) {
      case "forfeit": {
        let j = i;
        while (j + 1 < lines.length && lines[j + 1].why === "forfeit" && lines[j + 1].from === l.from && lines[j + 1].paid === l.paid) j++;
        out.push(j > i ? `Xử thua: ${name(l.from)} trả mỗi người ${xuNum(l.paid)}` : `Xử thua: ${pay}`);
        i = j;
        break;
      }
      case "bet": out.push(`Về bét: ${pay}`); break;
      case "ba": out.push(`Về ba: ${pay}`); break;
      case "chat": out.push(`Chặt: ${pay}`); break;
      case "thoi": out.push(`${thoiName(last.hands[l.from] ?? [])}: ${pay}`); break;
      case "cong": out.push(`Cóng: ${pay}`); break;
      case "trang": out.push(`Tới trắng: ${pay}`); break;
    }
  }
  return out;
}

/** A Cào hand's name from its cards: "Sáp K", "Ba tây", "7 nút", "Bù". */
export function caoHandName(cards: readonly Card[]): string {
  return caoName(caoEval(cards));
}

/** "💣 C chặt B!" */
export function cutBanner(cutter: string, victim: string): string {
  return `💣 ${cutter} chặt ${victim}!`;
}

/** "Ván đầu phải đánh kèm lá 3♠." */
export function mustText(must: Card | null | undefined): string {
  return `Ván đầu phải đánh kèm lá ${cardLabel(must ?? 0)}.`;
}

/** Vietnamese toast text for a card RPC error (spec §11.5). `must` names the card a first lead must include. */
export function cardErrorMessage(err: unknown, must?: Card | null): string {
  if (isMissingRpc(err)) return CARDS_NOT_OPEN;
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  switch (msg) {
    case "invalid game": return "Bàn bài không hợp lệ.";
    case "invalid seat": return "Ghế không hợp lệ.";
    case "invalid stake": return "Mức cược của bàn không hợp lệ.";
    case "invalid quantity": return "Số xu không hợp lệ.";
    case "invalid cards": return "Lá bài không hợp lệ.";
    case "invalid bet": return "Số tiền cược không hợp lệ.";
    case "stale": return "Bàn vừa thay đổi — xem lại nhé.";
    case "not seated": return "Bạn chưa ngồi bàn này.";
    case "already seated": return "Bạn đang ngồi một bàn khác trong phòng.";
    case "still leaving": return "Ván bạn vừa rời chưa xong — hết ván đó bạn mới ngồi lại được.";
    case "table full": return "Bàn đã đủ người.";
    case "seat taken": return "Ghế này có người rồi.";
    case "stake changed": return "Mức cược vừa đổi — xem lại nhé.";
    case "not enough coins": return "Không đủ xu.";
    case "not your turn": return "Chưa tới lượt bạn.";
    case "invalid play": return "Bộ bài không hợp lệ.";
    case "cannot beat": return "Bài này không chặn được.";
    case "must include": return mustText(must);
    case "must play": return "Bạn đang mở vòng — phải đánh.";
    case "cannot raise": return "Chưa được tố thêm — chỉ theo hoặc úp.";
    case "hand running": return "Đang có ván — chờ hết ván nhé.";
    case "too many chips": return "Trên bàn tối đa 200 lần mù lớn.";
    case "not dealer": return "Chỉ nhà cái được chia bài.";
    case "dealer busy": return "Nhà cái chờ lật bài xong rồi hãy rời bàn.";
    case "wrong phase": return "Chưa tới lúc làm việc này.";
    case "account locked": return lockText(lockSeconds(err) ?? 300);
  }
  if (msg.includes("invalid session")) return "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.";
  if (msg.includes("account banned")) return "Tài khoản đã bị khoá.";
  if (msg.includes("not a member")) return "Bạn không còn ở trong phòng này.";
  return "Có lỗi, thử lại nhé.";
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (46 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/cards/state.ts lib/game/cards/rpc.ts lib/game/cards/messages.ts tests/unit/helpers/card-states.ts tests/unit/cards-state.test.ts tests/unit/cards-rpc.test.ts tests/unit/cards-messages.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): the client's state parsers, the RPC wrappers and the Vietnamese texts — every card error and the results

lib/game/cards/state.ts parses the lobby, the state, the hand, an action answer and a tick defensively (null when
malformed); rpc.ts calls the card RPCs through the anti-cheat screening, as the farm and fishing wrappers do;
messages.ts holds the panel's Vietnamese texts and cardErrorMessage for every error of spec §11.5.
tests/unit/helpers/card-states.ts builds the raw states the tests share.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/cards/messages.ts lib/game/cards/rpc.ts lib/game/cards/state.ts tests/unit/cards-messages.test.ts tests/unit/cards-rpc.test.ts tests/unit/cards-state.test.ts tests/unit/helpers/card-states.ts
git commit -F <message file>
```

---

### Task 11: 📜 Sổ luật's content — the three games' sections and their money examples at the table's stake

**Files:**
- Create: `lib/game/cards/rules.ts`
- Test: `tests/unit/cards-rules.test.ts` (create)

**Interfaces:**
- Consumes: Tasks 8–10 (`tlSettle`, `caoSettle`, `pkPots`, `cardsOf`, `cardLabel`, the texts).
- Produces (`@/lib/game/cards/rules`): `RuleSeg = string | {cards}`, `RuleLine = RuleSeg[]`, `RuleExample {title, lines, net: [{who, xu}]}`, `RuleSection {title, lines, examples}`, `RulesPage {game, header, sections}`, `RULES_TABS` (`[{game, label}]`), `RULES_HEADER` (§14's three lines, verbatim), `ruleLine(text)` (turns "[7♦]" groups into cards), `ruleText(line)`, `POKER_RANK_EXAMPLES`, `rulesPage(game, stake = 1000) → RulesPage` (§14's sections; Tiến lên's examples 1–4, Cào's §8.3 example and poker's §9.3 examples, computed at the stake so every example's net sums to 0).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cards-rules.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { cardsOf } from "@/lib/game/cards/deck";
import { pkEval } from "@/lib/game/cards/poker";
import { POKER_RANK_EXAMPLES, RULES_HEADER, RULES_TABS, ruleLine, rulesPage, ruleText } from "@/lib/game/cards/rules";

const TITLES = {
  tienlen: ["Mục tiêu", "Thứ tự bài", "Các bộ", "Lượt chơi", "Luật đặc biệt", "Tính tiền"],
  cao: ["Mục tiêu", "Tính điểm", "Bài đặc biệt", "So bằng", "Lượt chơi", "Tính tiền"],
  poker: ["Mục tiêu", "Thứ tự tay bài", "Lượt chơi", "Luật cược", "Tiền"],
} as const;

describe("📜 Sổ luật (spec §14)", () => {
  it("has a tab per game with its sections, under the play-money header", () => {
    expect(RULES_TABS.map((t) => t.label)).toEqual(["Tiến lên", "Cào", "Poker"]);
    for (const { game } of RULES_TABS) {
      const page = rulesPage(game);
      expect(page.header).toBe(RULES_HEADER);
      expect(page.sections.map((s) => s.title)).toEqual(TITLES[game]);
      for (const s of page.sections) expect(s.lines.length, `${game} ${s.title}`).toBeGreaterThan(0);
    }
    expect(RULES_HEADER[1]).toBe("Xu không mua được bằng tiền thật và không đổi ra tiền thật. Mua bán xu hay tài khoản bằng tiền thật bị cấm.");
  });

  it("shows card groups as cards", () => {
    expect(ruleLine("Đôi [9♠ 9♥] thắng")).toEqual(["Đôi ", { cards: cardsOf(["9S", "9H"]) }, " thắng"]);
    expect(ruleText(ruleLine("Rác [7♦]"))).toBe("Rác [7♦]");
    const combos = rulesPage("tienlen").sections[2];
    expect(combos.lines.flat().filter((s) => typeof s !== "string")).toHaveLength(8);
  });

  it("computes the money examples with the engine's rules: the nets sum to 0 and scale with the stake", () => {
    for (const { game } of RULES_TABS) {
      for (const stake of [100, 1000, 10000]) {
        const examples = rulesPage(game, stake).sections.flatMap((s) => s.examples);
        expect(examples.length, game).toBeGreaterThan(0);
        for (const e of examples) expect(e.net.reduce((a, n) => a + n.xu, 0), `${game} ${e.title}`).toBe(0);
      }
    }
    const tl = rulesPage("tienlen", 1000).sections[5].examples;
    expect(tl.map((e) => e.net.map((n) => n.xu))).toEqual([
      [1000, -2000, 2500, -1500], [5000, 500, -500, -5000], [-2000, -2000, 6000, -2000], [1000, 2000, 0, -3000],
    ]);
    expect(rulesPage("tienlen", 100).sections[5].examples[0].net.map((n) => n.xu)).toEqual([100, -200, 250, -150]);
    expect(rulesPage("cao", 1000).sections[5].examples[0].net).toEqual([
      { who: "A", xu: 1000 }, { who: "B", xu: -2000 }, { who: "C", xu: 1000 }, { who: "D", xu: 1000 }, { who: "E", xu: -1000 },
    ]);
    expect(rulesPage("poker", 1000).sections[4].examples[0].net).toEqual([
      { who: "A", xu: 2000 }, { who: "B", xu: 16000 }, { who: "C", xu: -18000 },
    ]);
    expect(ruleText(rulesPage("poker", 1000).sections[4].examples[0].lines[3])).toBe("Pot chính 24.000 (A, B, C); pot phụ 20.000 (A, C).");
  });

  it("gives every poker hand rank a matching example, strongest first", () => {
    const cats = POKER_RANK_EXAMPLES.map((r) => pkEval(cardsOf(r.cards))[0]);
    expect(cats).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/cards-rules.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/game/cards/rules"`.

- [ ] **Step 3: Write the rules book's content**

Create `lib/game/cards/rules.ts` with exactly:

```ts
import { caoSettle } from "./cao";
import { cardLabel, cardsOf, type Card, type CardGame } from "./deck";
import { signedXu, xuNum } from "./messages";
import { pkPots } from "./poker";
import { tlSettle, type TlGame } from "./tienlen";

// 📜 Sổ luật (spec §14): the rules of the three games in Vietnamese, as static data. A line is text with card groups
// ("[7♦]" in the source, shown as mini cards). The money examples are computed with tlSettle / caoSettle / pkPots at the
// viewer's table stake (1 000 by default), so the book always matches the engine. Pure.

export type RuleSeg = string | { cards: Card[] };
export type RuleLine = RuleSeg[];
export interface RuleExample { title: string; lines: RuleLine[]; net: Array<{ who: string; xu: number }> }
export interface RuleSection { title: string; lines: RuleLine[]; examples: RuleExample[] }
export interface RulesPage { game: CardGame; header: readonly string[]; sections: RuleSection[] }

export const RULES_TABS: ReadonlyArray<{ game: CardGame; label: string }> = [
  { game: "tienlen", label: "Tiến lên" }, { game: "cao", label: "Cào" }, { game: "poker", label: "Poker" },
];

export const RULES_HEADER: readonly string[] = [
  "🪙 Xu là điểm chơi trong Music Together — kiếm được khi câu cá, làm ruộng, điểm danh và nghe nhạc.",
  "Xu không mua được bằng tiền thật và không đổi ra tiền thật. Mua bán xu hay tài khoản bằng tiền thật bị cấm.",
  "Bàn bài chỉ để giải trí: người thắng nhận đúng phần người thua trả, không ai thu phí.",
];

/** A line from text with card groups in brackets: "Đôi [9♠ 9♥]". */
export function ruleLine(text: string): RuleLine {
  const segs: RuleLine = [];
  let at = 0;
  for (const m of text.matchAll(/\[([^\]]+)\]/g)) {
    const i = m.index ?? 0;
    if (i > at) segs.push(text.slice(at, i));
    segs.push({ cards: cardsOf(m[1].split(" ")) });
    at = i + m[0].length;
  }
  if (at < text.length) segs.push(text.slice(at));
  return segs;
}

/** A line as plain text (cards as their labels in brackets). */
export function ruleText(line: RuleLine): string {
  return line.map((s) => (typeof s === "string" ? s : `[${s.cards.map(cardLabel).join(" ")}]`)).join("");
}

const section = (title: string, texts: readonly string[], examples: RuleExample[] = []): RuleSection =>
  ({ title, lines: texts.map(ruleLine), examples });

// ------------------------------------------------------------------ Tiến lên

const TL_PEOPLE = ["A", "B", "C", "D"];

function tlExample(title: string, texts: readonly string[], g: TlGame, stake: number): RuleExample {
  const net = tlSettle(g).net;
  return {
    title, lines: texts.map(ruleLine),
    net: g.order.map((s) => ({ who: TL_PEOPLE[s - 1], xu: (net[s] ?? 0) * stake / 2 })),
  };
}

function tienlen(stake: number): RuleSection[] {
  const x = (units: number) => xuNum(units * stake);
  const S = xuNum(stake);
  const cut = (seat: number, top: number, codes: string[], done = false) =>
    ({ k: "cut" as const, seat, top: { seat: top, cards: cardsOf(codes), done } });
  const out = (seat: number) => ({ k: "out" as const, seat });
  const examples = [
    tlExample(`Ví dụ 1 — chặt chồng (mức ${S}; A, B, C, D)`, [
      "D đánh [2♥]; B chặt bằng 3 đôi thông [5♠ 5♣ 6♠ 6♣ 7♠ 7♣]; C chặt lại B bằng tứ quý [9♠ 9♣ 9♦ 9♥].",
      `Mọi người bỏ lượt: B trả C ${x(2.5)} (${x(1)} cho 2♥ và ${x(1.5)} cho 3 đôi thông).`,
      `Hết ván: A nhất, B nhì, C ba, D bét. D còn [2♠] nên thối ${x(0.5)} cho C.`,
      `D trả A ${x(1)}; C trả B ${x(0.5)}.`,
    ], {
      order: [1, 2, 3, 4], played: [1, 2, 3, 4], hands: { 4: cardsOf(["2S"]) },
      events: [cut(2, 4, ["2H"]), cut(3, 2, ["5S", "5C", "6S", "6C", "7S", "7C"]), { k: "close" }, out(1), out(2), out(3), { k: "end" }],
    }, stake),
    tlExample(`Ví dụ 2 — cóng (mức ${S})`, [
      "A về nhất khi D chưa đánh lá nào: D bị cóng.",
      `D còn [2♦] và tứ quý [9♠ 9♣ 9♦ 9♥] nên thối ${x(1)} + ${x(2)}: D trả A ${x(2)} + ${x(3)} = ${x(5)}.`,
      `B và C đánh tiếp: B về nhì, C về ba trả B ${x(0.5)}.`,
    ], {
      order: [1, 2, 3, 4], played: [1, 2, 3],
      hands: { 4: cardsOf(["2D", "9S", "9C", "9D", "9H", "3S", "5C", "7D", "JH", "KS", "AC", "4D", "6H"]), 3: cardsOf(["8S"]) },
      events: [out(1), out(2), { k: "end" }],
    }, stake),
    tlExample(`Ví dụ 3 — tới trắng (mức ${S})`, [
      `C được chia 6 đôi: tới trắng. A, B và D mỗi người trả C ${x(2)}.`,
    ], { order: [1, 2, 3, 4], played: [], hands: {}, events: [{ k: "trang", seat: 3 }] }, stake),
    tlExample(`Ví dụ 4 — xử thua (mức ${S}; lượt A, B, C, D)`, [
      "A đã về nhất. D rời bàn khi còn [2♥], B và C còn bài.",
      `D trả B và C mỗi người ${x(1)}, rồi thối 2♥ (${x(1)}) cho B — người kế tiếp sau D. D được trả lại ${x(10)} − ${x(3)}.`,
      `B và C chơi tiếp như bàn 3 người (A, B, C): B về nhì, C về bét trả A ${x(1)}.`,
    ], {
      order: [1, 2, 3, 4], played: [1, 2, 3, 4], hands: { 4: cardsOf(["2H", "5S"]), 3: cardsOf(["6S"]) },
      events: [out(1), { k: "forfeit", seats: [4] }, out(2), { k: "end" }],
    }, stake),
  ];
  return [
    section("Mục tiêu", [
      "Mỗi người 13 lá. Ai đánh hết bài trước về nhất; những người còn lại đánh tiếp để phân nhì, ba, bét. Bàn 2–4 người.",
    ]),
    section("Thứ tự bài", [
      "3 < 4 < … < K < A < 2 (heo). Cùng số thì so chất: ♠ bích < ♣ chuồn < ♦ rô < ♥ cơ. Nhỏ nhất 3♠, lớn nhất 2♥.",
    ]),
    section("Các bộ", [
      "Rác [7♦] · Đôi [9♠ 9♥] · Sám cô [Q♣ Q♦ Q♥]",
      "Sảnh ≥ 3 lá liên tiếp, không có heo [5♠ 6♦ 7♣]",
      "Tứ quý [8♠ 8♣ 8♦ 8♥]",
      "Đôi thông ≥ 3 đôi liên tiếp, không có heo [4♠ 4♦ 5♣ 5♥ 6♠ 6♦].",
      "Chặn bằng bộ cùng loại, cùng số lá, lá lớn nhất lớn hơn: [6♠ 7♦ 8♥] chặn [6♦ 7♥ 8♣] vì 8♥ > 8♣.",
    ]),
    section("Lượt chơi", [
      "Ván đầu (bàn mới, sau tới trắng, hoặc khi người về nhất ván trước không còn chơi): ai có lá nhỏ nhất được chia (thường 3♠) đánh trước, phải đánh kèm lá đó.",
      "Ván sau: người về nhất đánh trước.",
      "Lần lượt chặn hoặc Bỏ lượt; đã bỏ lượt thì chờ vòng sau.",
      "Mọi người khác bỏ lượt thì người đánh sau cùng mở vòng mới; người đó đã hết bài thì người kế tiếp mở.",
      "Mỗi lượt 20 giây; hết giờ tự bỏ lượt (đang mở vòng thì tự đánh lá nhỏ nhất); lỡ 2 lượt liên tiếp bị xử thua.",
    ]),
    section("Luật đặc biệt", [
      "Chặt heo: 3 đôi thông chặt 1 heo; tứ quý chặt 1 heo, đôi heo, 3 đôi thông; 4 đôi thông chặt 1 heo, đôi heo, 3 đôi thông, tứ quý — và chặt được cả khi đã bỏ lượt (nút 💣 Chặt!).",
      "Hàng lớn chặt hàng nhỏ cùng loại.",
      "Chặt chồng: người bị chặt sau cùng trả cả chuỗi cho người chặt sau cùng khi hết vòng.",
      "Tới trắng: vừa chia có sảnh rồng (3 → A), 5 đôi thông, tứ quý heo hoặc 6 đôi là thắng ngay.",
      "Cóng: có người về nhất mà bạn chưa đánh lá nào; nhiều người cùng cóng thì ai cách người về nhất xa nhất theo lượt đánh thì về bét.",
      "Thối: hết ván còn heo hoặc hàng trên tay.",
      "Xử thua (rời bàn giữa ván hoặc lỡ 2 lượt liên tiếp): trả ngay 1 mức cho mỗi người còn đang chơi, dù họ còn bao nhiêu lá, rồi tiền thối bài mình cho người kế tiếp trong số đó.",
      "Xử thua không làm ai bị cóng; không còn ai để nhận thì khoản đó không phải trả.",
      "Những người còn lại chơi tiếp như một bàn ít người hơn.",
    ]),
    section("Tính tiền", [
      "Bét trả nhất 1 mức, ba trả nhì ½ mức (3 người: bét trả nhất 1 mức; 2 người: thua trả thắng 1 mức).",
      "Heo đen ½ · heo đỏ 1 · 3 đôi thông 1½ · tứ quý 2 · 4 đôi thông 3 mức, cho cả thối và chặt.",
      "Cóng: trả nhất 2 mức + thối. Tới trắng: mỗi người trả 2 mức.",
      "Thối của người về bét trả người về ngay trên; của người cóng trả người về nhất; của người bị xử thua trả người kế tiếp còn đang chơi.",
      "Xử thua: trả mỗi người còn đang chơi 1 mức.",
      "Mỗi ván giữ tạm 10 mức; không ai thua quá 10 mức một ván.",
    ], examples),
  ];
}

// ------------------------------------------------------------------ Cào

function cao(stake: number): RuleSection[] {
  const S = xuNum(stake);
  const hands = { 1: ["9S", "8C", "2H"], 2: ["KD", "5S", "3C"], 3: ["JS", "QH", "KC"], 4: ["4D", "4C", "4S"], 5: ["7H", "10C", "AD"] };
  const who = ["A", "B", "C", "D", "E"];
  const r = caoSettle({
    dealer: 2, order: [1, 2, 3, 4, 5], left: [],
    hands: Object.fromEntries(Object.entries(hands).map(([s, c]) => [Number(s), cardsOf(c)])),
  });
  const example: RuleExample = {
    title: `Ví dụ (mức ${S}; 5 người, B làm cái)`,
    lines: [
      `B giữ tạm ${xuNum(4 * stake)}; A, C, D và E mỗi người ${S} — cả bàn ${xuNum(8 * stake)}.`,
      "B có [K♦ 5♠ 3♣] = 8 nút, lá lớn nhất K♦.",
      `A [9♠ 8♣ 2♥] 9 nút — thắng ${signedXu(stake)}.`,
      `C [J♠ Q♥ K♣] ba tây — thắng ${signedXu(stake)}.`,
      `D [4♦ 4♣ 4♠] sáp 4 — thắng ${signedXu(stake)}.`,
      `E [7♥ 10♣ A♦] 8 nút, lá lớn nhất 10♣ thua K♦ — thua ${signedXu(-stake)}.`,
      `B: ${signedXu(-3 * stake)} ${signedXu(stake)} = ${signedXu(-2 * stake)}, nhận lại ${xuNum(2 * stake)} trong ${xuNum(4 * stake)} đã giữ.`,
    ].map(ruleLine),
    net: [1, 2, 3, 4, 5].map((s) => ({ who: who[s - 1], xu: (r.net[s] ?? 0) * stake })),
  };
  return [
    section("Mục tiêu", [
      "Mỗi người 3 lá, so với nhà cái: cao hơn cái thì ăn 1 mức, thấp hơn thì chung 1 mức. Bàn 2–6 người; cái xoay vòng mỗi ván.",
    ]),
    section("Tính điểm", [
      "A = 1, 2–9 theo số, 10 · J · Q · K = 10.",
      "Nút là hàng đơn vị của tổng: [7♠ 8♦ 9♣] = 24 → 4 nút.",
      "9 nút cao nhất; tròn chục là bù (0 nút).",
    ]),
    section("Bài đặc biệt", [
      "Sáp: 3 lá cùng số [5♠ 5♦ 5♥] thắng mọi bài khác; sáp lớn thắng sáp nhỏ (K cao nhất, A thấp nhất).",
      "Ba tây: 3 lá hình J/Q/K bất kỳ [J♣ Q♦ Q♠], thắng mọi bài tính nút.",
    ]),
    section("So bằng", [
      "Cùng nút hoặc cùng ba tây: so lá lớn nhất mỗi bên, K > Q > J > 10 > … > 2 > A; cùng số thì so chất ♦ rô > ♥ cơ > ♣ chuồn > ♠ bích.",
      "Không có hai lá giống nhau nên luôn có thắng thua.",
    ]),
    section("Lượt chơi", [
      "Cái bấm 🃏 Chia bài trong 15 giây (quá giờ tự chia). Mọi người có 15 giây nặn bài, rồi cả bàn lật bài.",
      "Nhà con rời bàn giữa ván thì mất 1 mức cho cái; nhà cái chờ lật bài xong mới rời được.",
    ]),
    section("Tính tiền", [
      "Mỗi nhà con thắng hoặc thua cái đúng 1 mức.",
      "Mỗi nhà con giữ tạm 1 mức; nhà cái giữ tạm (số nhà con × mức cược); không đủ thì bỏ qua lượt cái.",
    ], [example]),
  ];
}

// ------------------------------------------------------------------ Poker

/** Each hand rank with a card example (§14), strongest first. */
export const POKER_RANK_EXAMPLES: ReadonlyArray<{ name: string; cards: string[] }> = [
  { name: "Thùng phá sảnh", cards: ["9H", "10H", "JH", "QH", "KH"] },
  { name: "Tứ quý", cards: ["8S", "8C", "8D", "8H", "KS"] },
  { name: "Cù lũ", cards: ["QS", "QD", "QH", "5C", "5D"] },
  { name: "Thùng", cards: ["AC", "JC", "9C", "6C", "3C"] },
  { name: "Sảnh", cards: ["5S", "6D", "7C", "8H", "9S"] },
  { name: "Sám", cards: ["7S", "7D", "7H", "KC", "2D"] },
  { name: "Thú", cards: ["JS", "JH", "4C", "4D", "AS"] },
  { name: "Đôi", cards: ["10S", "10H", "AD", "8C", "3S"] },
  { name: "Mậu thầu", cards: ["AH", "QD", "9C", "7S", "5H"] },
];

function poker(stake: number): RuleSection[] {
  const x = (units: number) => xuNum(units * stake);
  // §9.3: A (the button) 60 S, B (SB) 8 S, C (BB) 40 S; B's flush wins the main pot, A's trips beat C's pair for the side
  const pots = pkPots({
    players: { 1: { put: 18 * stake }, 2: { put: 8 * stake, allin: true }, 3: { put: 18 * stake } },
    keys: { 1: [3, 5, 14, 13], 2: [5, 14, 11, 9, 6, 3], 3: [1, 12, 14, 13, 7] }, button: 1,
  });
  const won = (s: number) => pots.reduce((a, p) => a + (p.shares?.[s] ?? 0), 0);
  const put: Record<number, number> = { 1: 18 * stake, 2: 8 * stake, 3: 18 * stake };
  const example: RuleExample = {
    title: `Ví dụ — pot phụ (mù ${xuNum(stake / 2)}/${xuNum(stake)})`,
    lines: [
      `A (giữ nút D) có ${x(60)}, B (mù nhỏ) ${x(8)}, C (mù lớn) ${x(40)}.`,
      `Trước flop: A tố lên ${x(3)}; B tất tay ${x(8)}; C theo ${x(8)}; A theo.`,
      `Flop: C cược ${x(10)}, A theo. Turn và river: cả hai xem bài.`,
      `Pot chính ${xuNum(pots[0].xu)} (A, B, C); pot phụ ${xuNum(pots[1].xu)} (A, C).`,
      "B thắng pot chính; A thắng C ở pot phụ.",
    ].map(ruleLine),
    net: [{ who: "A", s: 1 }, { who: "B", s: 2 }, { who: "C", s: 3 }].map(({ who, s }) => ({ who, xu: won(s) - put[s] })),
  };
  return [
    section("Mục tiêu", [
      "Mỗi người 2 lá tẩy, bàn có 5 lá chung. Ghép 5 lá tốt nhất từ 7 lá; tay mạnh nhất khi lật bài, hoặc người cuối cùng chưa úp bài, ăn pot.",
    ]),
    section("Thứ tự tay bài", [
      "Thùng phá sảnh [9♥ 10♥ J♥ Q♥ K♥] > Tứ quý > Cù lũ > Thùng > Sảnh (A đứng đầu hoặc cuối: A-2-3-4-5) > Sám > Thú > Đôi > Mậu thầu.",
      ...POKER_RANK_EXAMPLES.slice(1).map((r) => `${r.name} [${cardsOf(r.cards).map(cardLabel).join(" ")}]`),
      "Cùng hạng thì so lá cao và lá phụ (kicker); chất không phân hơn thua.",
    ]),
    section("Lượt chơi", [
      "Nút D xoay vòng. Hai người bên trái nút đặt mù nhỏ (½ mức) và mù lớn (1 mức); bàn 2 người thì người giữ nút đặt mù nhỏ và nói trước ở vòng đầu.",
      "Bốn vòng cược: trước flop, flop (3 lá), turn (1 lá), river (1 lá).",
      "Mỗi lượt 30 giây; hết giờ tự Xem bài nếu được, không thì Úp bài; lỡ 2 lượt liên tiếp thì bị úp bài và rời bàn, chip chưa cược về ví.",
    ]),
    section("Luật cược", [
      "Cược ít nhất 1 mù lớn. Tố phải tăng ít nhất bằng lần cược hoặc tố lớn nhất trước đó trong vòng.",
      "Tất tay lúc nào cũng được; tất tay chưa đủ một lần tố thì người đã nói không được tố lại.",
      "Người tất tay chỉ ăn phần pot mình theo được (pot phụ).",
      "Hoà thì chia đều; 1 xu lẻ cho người thắng ngồi gần bên trái nút nhất.",
    ]),
    section("Tiền", [
      "Mang vào bàn 50–200 lần mù lớn; đứng dậy thì chip về ví. Nạp thêm giữa các ván, tối đa 200 lần mù lớn. Không phí bàn.",
    ], [example]),
  ];
}

/** The rules book's tab for a game, its money examples at this stake. */
export function rulesPage(game: CardGame, stake = 1000): RulesPage {
  const sections = game === "tienlen" ? tienlen(stake) : game === "cao" ? cao(stake) : poker(stake);
  return { game, header: RULES_HEADER, sections };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: the command of Step 2.
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/cards/rules.ts tests/unit/cards-rules.test.ts` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): 📜 Sổ luật's content — the three games' sections and their money examples at the table's stake

lib/game/cards/rules.ts: the tabs, the header lines and each game's sections (the goal, the cards, the combinations with
card examples, the flow, the special rules, the money), with worked examples whose nets come from tlSettle, caoSettle
and pkPots at the table's stake, so they always sum to 0.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add lib/game/cards/rules.ts tests/unit/cards-rules.test.ts
git commit -F <message file>
```

---

### Task 12: Góc đánh bài in the hall — the deck, three tables, the sign, a light pole; the tables' labels on the canvas

**Files:**
- Modify: `lib/game/maps/types.ts`, `lib/game/maps/hall.ts`, `lib/game/maps/props.ts`, `lib/game/maps/hall-art.ts`, `lib/game/engine.ts`, `components/game/GameCanvas.tsx`
- Test: `tests/unit/game-hall-map.test.ts`, `tests/unit/game-hall-art.test.ts`, `tests/unit/game-canvas-input.test.tsx` (modify)

**Interfaces:**
- Consumes: Task 8's `CardGame`; the hall map, its props and art (v13–v15.2), `GameEngine`, `GameCanvasHandle`.
- Produces (`lib/game/maps/types.ts`): `InteractKind` gains `"card_table"` and `"card_rules"`; `Interactable.game?: CardGame`; the prop `{ kind: "card_table"; x; y; game }`; `SignIcon` gains `"cards"`.
- Produces (`lib/game/maps/hall.ts`, §5): `CARD_DECK = { x: 62, y: 240, w: 182, h: 86 }` and `CARD_SOLIDS` (the three tables, the sign and the pole, part of `HALL_SOLIDS`); the interactables `cards_tienlen`, `cards_cao`, `cards_poker` (`card_table`, with their `game`) and `cards_sign` (`card_rules`), with the spec's labels and prompts; the props (three `card_table`s, the sign with the `cards` icon, a light pole) and one more light string.
- Produces (art): `props.ts` paints the tables (felt, stools or cushions, tiny cards) and the sign's ♠♥; `hall-art.ts` paints the deck (`paintCardCorner`: planks, a rope edge, lanterns, grass) after the ground.
- Produces (canvas): `GameEngine.setCardTables(labels: Partial<Record<CardGame, string>>)` draws each table's label over it; `GameCanvasHandle.setCardTables(labels)` passes them to the engine at once and to the next map's engine.

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-hall-map.test.ts — edit 1 of 3.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { FIELD_WEST_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildHallMap, HALL_CELL, HALL_H, HALL_W } from "@/lib/game/maps/hall";
import { isBlockedAt } from "@/lib/game/movement";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { FIELD_WEST_ARRIVE, HALL_DOCK_ARRIVE, HALL_FIELD_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildHallMap, CARD_DECK, CARD_SOLIDS, HALL_CELL, HALL_H, HALL_PROPS, HALL_SOLIDS, HALL_W, overlaps } from "@/lib/game/maps/hall";
import { isBlockedAt } from "@/lib/game/movement";
```

**tests/unit/game-hall-map.test.ts — edit 2 of 3.** Replace:

```ts
  });
  it("has unique interactables: the three v13 ones and the v15 field sign", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual(["dj_booth", "dock_sign", "field_sign", "notice_board"]);
  });
```

with:

```ts
  });
  it("has unique interactables: the three v13 ones, the v15 field sign and the v16 card corner", () => {
    expect(hall.interactables.map((i) => i.id).sort()).toEqual([
      "cards_cao", "cards_poker", "cards_sign", "cards_tienlen", "dj_booth", "dock_sign", "field_sign", "notice_board",
    ]);
  });
```

**tests/unit/game-hall-map.test.ts — edit 3 of 3.** Replace:

```ts
  });
  it("has six café seats and no shopkeepers", () => {
```

with:

```ts
  });
  it("has the card corner of the v16 spec (§5): three tables and the sign, their labels and prompts", () => {
    const pick = (id: string) => hall.interactables.find((i) => i.id === id)!;
    expect(pick("cards_tienlen")).toMatchObject({ kind: "card_table", game: "tienlen", label: "Bàn Tiến lên", prompt: "Vào bàn Tiến lên" });
    expect(pick("cards_cao")).toMatchObject({ kind: "card_table", game: "cao", label: "Chiếu Cào", prompt: "Vào chiếu Cào" });
    expect(pick("cards_poker")).toMatchObject({ kind: "card_table", game: "poker", label: "Bàn Poker", prompt: "Vào bàn Poker" });
    expect(pick("cards_sign")).toMatchObject({ kind: "card_rules", label: "Góc đánh bài", prompt: "Đọc Sổ luật" });
    for (const id of ["cards_tienlen", "cards_cao", "cards_poker", "cards_sign"]) {
      const it = pick(id);
      expect(overlaps(CARD_DECK, it.rect), id).toBe(true);
      expect(isBlockedAt(hall, it.use.x, it.use.y), id).toBe(false);
      for (const from of [hall.spawn, HALL_DOCK_ARRIVE, HALL_FIELD_ARRIVE]) {
        expect(findPath(hall, from, it.use), `${id} from ${JSON.stringify(from)}`).not.toBeNull();
      }
    }
    expect(HALL_PROPS.filter((p) => p.kind === "card_table").map((p) => p.kind === "card_table" && p.game)).toEqual(["tienlen", "cao", "poker"]);
  });
  it("keeps the corner's tables off every other solid and off each other; the field sign stays reachable", () => {
    const tables = CARD_SOLIDS.slice(0, 3);
    const others = HALL_SOLIDS.filter((s) => !CARD_SOLIDS.includes(s));
    for (const t of tables) {
      for (const s of others) expect(overlaps(t, s), JSON.stringify([t, s])).toBe(false);
      for (const u of tables) if (u !== t) expect(overlaps(t, u)).toBe(false);
    }
    const sign = hall.interactables.find((i) => i.id === "field_sign")!;
    expect(findPath(hall, hall.spawn, sign.use)).not.toBeNull();
    expect(hall.seating!.standSpots).toContainEqual({ x: 300, y: 300, dir: "left" });
    expect(hall.seating!.standSpots.some((s) => overlaps(CARD_DECK, { x: s.x, y: s.y, w: 1, h: 1 }))).toBe(false);
  });
  it("has six café seats and no shopkeepers", () => {
```

**tests/unit/game-hall-art.test.ts.** Replace:

```ts

  it("sizes the hammock from its two anchors", () => {
```

with:

```ts

  it("draws the card tables and the corner's sign where their interaction rects are (v16 spec §5)", () => {
    const tables = HALL_PROPS.filter((p) => p.kind === "card_table");
    expect(tables.map(box)).toEqual(["cards_tienlen", "cards_cao", "cards_poker"].map(target));
    const sign = HALL_PROPS.find((p) => p.kind === "sign" && p.icon === "cards")!;
    expect(box(sign)).toEqual(target("cards_sign"));
  });

  it("sizes the hammock from its two anchors", () => {
```

**tests/unit/game-canvas-input.test.tsx — edit 1 of 4.** Replace:

```tsx
type EngineRec = {
  mapId: string; input: boolean[]; plots: unknown[]; anims: number[]; applied: unknown[]; hellos: string[]; removed: string[];
  destroyed: boolean;
};
```

with:

```tsx
type EngineRec = {
  mapId: string; input: boolean[]; plots: unknown[]; cards: unknown[]; anims: number[]; applied: unknown[]; hellos: string[];
  removed: string[]; destroyed: boolean;
};
```

**tests/unit/game-canvas-input.test.tsx — edit 2 of 4.** Replace:

```tsx
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false };
      engines.push(this.rec);
```

with:

```tsx
    constructor(_canvas: unknown, map: { id: string }) {
      this.rec = { mapId: map.id, input: [], plots: [], cards: [], anims: [], applied: [], hellos: [], removed: [], destroyed: false };
      engines.push(this.rec);
```

**tests/unit/game-canvas-input.test.tsx — edit 3 of 4.** Replace:

```tsx
      this.rec.plots.push(plots);
    }
```

with:

```tsx
      this.rec.plots.push(plots);
    }
    setCardTables(labels: unknown) {
      this.rec.cards.push(labels);
    }
```

**tests/unit/game-canvas-input.test.tsx — edit 4 of 4.** Replace:

```tsx

describe("GameCanvas farm messages", () => {
```

with:

```tsx

describe("GameCanvas card-table labels across travel", () => {
  it("passes the labels on at once and gives them to the next map's engine", () => {
    const ref = createRef<GameCanvasHandle>();
    const { rerender } = render(<GameCanvas ref={ref} mapId="hall" {...props} />);
    const labels = { tienlen: "Tiến lên · 2/4 · 1.000", cao: "Trống" };
    ref.current!.setCardTables(labels);
    expect(engines[0].cards.at(-1)).toBe(labels);
    rerender(<GameCanvas ref={ref} mapId="pond" {...props} />);
    rerender(<GameCanvas ref={ref} mapId="hall" {...props} />);
    expect(engines[2].cards.at(-1)).toBe(labels);
  });
});

describe("GameCanvas farm messages", () => {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-hall-map.test.ts tests/unit/game-hall-art.test.ts tests/unit/game-canvas-input.test.tsx`
Expected: FAIL — 5 tests fail (no corner in the hall, no card tables in the art, no `setCardTables`), 19 pass.

- [ ] **Step 3: The corner, its art and the labels**

**lib/game/maps/types.ts — edit 1 of 5.** Replace:

```ts
import type { Facing, Look, Vec } from "@/lib/game/types";
```

with:

```ts
import type { CardGame } from "@/lib/game/cards/deck";
import type { Facing, Look, Vec } from "@/lib/game/types";
```

**lib/game/maps/types.ts — edit 2 of 5.** Replace:

```ts
  | "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records"
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying";
```

with:

```ts
  | "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records"
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying"
  | "card_table" | "card_rules";
```

**lib/game/maps/types.ts — edit 3 of 5.** Replace:

```ts
  plot?: number;
}
```

with:

```ts
  plot?: number;
  /** card_table: its game (v16). */
  game?: CardGame;
}
```

**lib/game/maps/types.ts — edit 4 of 5.** Replace:

```ts
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number; icon?: "fish" | "note" | "rice" }
  | { kind: "banana"; x: number; y: number }
```

with:

```ts
  | { kind: "board"; x: number; y: number }
  | { kind: "sign"; x: number; y: number; icon?: SignIcon }
  | { kind: "banana"; x: number; y: number }
```

**lib/game/maps/types.ts — edit 5 of 5.** Replace:

```ts
  | { kind: "haystack"; x: number; y: number }
  | { kind: "scarecrow"; x: number; y: number };
```

with:

```ts
  | { kind: "haystack"; x: number; y: number }
  | { kind: "scarecrow"; x: number; y: number }
  | { kind: "card_table"; x: number; y: number; game: CardGame };

/** A signpost's pixel icon: a fish (to the pond), a music note (to the hall), a rice panicle (to the field) or ♠♥ (the
 *  card corner's rules). */
export type SignIcon = "fish" | "note" | "rice" | "cards";
```

**lib/game/maps/hall.ts — edit 1 of 6.** Replace:

```ts
  return 338 + 5 * Math.sin(x / 40) + 2 * Math.sin(x / 13);
}

export const HALL_SOLIDS: Rect[] = [
```

with:

```ts
  return 338 + 5 * Math.sin(x / 40) + 2 * Math.sin(x / 13);
}

/** Góc đánh bài (v16 spec §5): the plank deck in the south-west, between palm A and palm B. */
export const CARD_DECK: Rect = { x: 62, y: 240, w: 182, h: 86 };

/** Each card table's rect covers the table and its stools (west, east and south); the north side stays open for the use
 *  spot. Then the "Góc đánh bài" sign and the corner's light pole. */
export const CARD_SOLIDS: Rect[] = [
  { x: 78, y: 272, w: 40, h: 26 },    // Tiến lên table + 4 stools
  { x: 130, y: 296, w: 52, h: 26 },   // Cào mat + 6 cushions
  { x: 188, y: 272, w: 52, h: 27 },   // poker table + 6 stools
  { x: 150, y: 242, w: 14, h: 10 },   // "Góc đánh bài" sign
  { x: 238, y: 246, w: 4, h: 4 },     // light pole of the corner
];

export const HALL_SOLIDS: Rect[] = [
```

**lib/game/maps/hall.ts — edit 2 of 6.** Replace:

```ts
  { x: 444, y: 166, w: 4, h: 4 },     // light pole east
];
```

with:

```ts
  { x: 444, y: 166, w: 4, h: 4 },     // light pole east
  ...CARD_SOLIDS,
];
```

**lib/game/maps/hall.ts — edit 3 of 6.** Replace:

```ts
  },
];
```

with:

```ts
  },
  {
    id: "cards_tienlen", kind: "card_table", game: "tienlen", label: "Bàn Tiến lên", prompt: "Vào bàn Tiến lên",
    rect: { x: 76, y: 268, w: 44, h: 30 }, use: { x: 98, y: 266 }, face: "down",
  },
  {
    id: "cards_cao", kind: "card_table", game: "cao", label: "Chiếu Cào", prompt: "Vào chiếu Cào",
    rect: { x: 128, y: 294, w: 56, h: 28 }, use: { x: 156, y: 290 }, face: "down",
  },
  {
    id: "cards_poker", kind: "card_table", game: "poker", label: "Bàn Poker", prompt: "Vào bàn Poker",
    rect: { x: 187, y: 268, w: 54, h: 31 }, use: { x: 214, y: 266 }, face: "down",
  },
  {
    id: "cards_sign", kind: "card_rules", label: "Góc đánh bài", prompt: "Đọc Sổ luật",
    rect: { x: 147, y: 226, w: 18, h: 26 }, use: { x: 156, y: 262 }, face: "up",
  },
];
```

**lib/game/maps/hall.ts — edit 4 of 6.** Replace:

```ts
export const HALL_STAND_SPOTS: Spot[] = [
  { x: 180, y: 172, dir: "down" }, { x: 452, y: 158, dir: "down" }, { x: 150, y: 280, dir: "right" },
  { x: 430, y: 300, dir: "left" }, { x: 260, y: 306, dir: "up" }, { x: 380, y: 168, dir: "down" },
```

with:

```ts
export const HALL_STAND_SPOTS: Spot[] = [
  { x: 180, y: 172, dir: "down" }, { x: 452, y: 158, dir: "down" }, { x: 300, y: 300, dir: "left" },
  { x: 430, y: 300, dir: "left" }, { x: 260, y: 306, dir: "up" }, { x: 380, y: 168, dir: "down" },
```

**lib/game/maps/hall.ts — edit 5 of 6.** Replace:

```ts
  { kind: "lightpole", x: 446, y: 170 },
];
```

with:

```ts
  { kind: "lightpole", x: 446, y: 170 },
  { kind: "card_table", x: 98, y: 298, game: "tienlen" },
  { kind: "card_table", x: 156, y: 322, game: "cao" },
  { kind: "card_table", x: 214, y: 299, game: "poker" },
  { kind: "sign", x: 156, y: 252, icon: "cards" },
  { kind: "lightpole", x: 240, y: 250 },
];
```

**lib/game/maps/hall.ts — edit 6 of 6.** Replace:

```ts
  [160, 152, 446, 134, 14],  // across the yard between the light poles
];
```

with:

```ts
  [160, 152, 446, 134, 14],  // across the yard between the light poles
  [100, 128, 240, 214, 10],  // palm A crown → the card corner's pole
];
```

**lib/game/maps/props.ts — edit 1 of 4.** Replace:

```ts
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type PropFrame, type PropSprite } from "./scene-art";
import type { PropPlacement } from "./types";
```

with:

```ts
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type PropFrame, type PropSprite } from "./scene-art";
import type { CardGame } from "@/lib/game/cards/deck";
import type { PropPlacement, SignIcon } from "./types";
```

**lib/game/maps/props.ts — edit 2 of 4.** Replace:

```ts
    case "scarecrow": return { w: 20, h: 34, ox: 10, oy: 34 };
  }
}
```

with:

```ts
    case "scarecrow": return { w: 20, h: 34, ox: 10, oy: 34 };
    case "card_table": return CARD_TABLE_FRAMES[p.game];
  }
}

/** The card tables' sprites (v16 spec §15): the base point is the bottom of the south stools. */
const CARD_TABLE_FRAMES: Record<CardGame, PropFrame> = {
  tienlen: { w: 44, h: 30, ox: 22, oy: 30 },
  cao: { w: 56, h: 28, ox: 28, oy: 28 },
  poker: { w: 54, h: 31, ox: 27, oy: 31 },
};
```

**lib/game/maps/props.ts — edit 3 of 4.** Replace:

```ts

const SIGN_ICONS: Record<"fish" | "note" | "rice", { rows: string[]; color: string; x: number; y: number }> = {
  fish: { rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 },
  note: { rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 },
  rice: { rows: ["..#.#..", ".#.#.#.", "..#.#..", ".#.#.#.", "...#...", "...#..."], color: C.gold, x: 5, y: 2 },
};

/** A signpost with a pixel icon: a fish (to the pond), a music note (to the hall) or a rice panicle (to the field). */
function drawSign(c: Ctx, icon: "fish" | "note" | "rice"): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
  rect(c, C.outline, 0, 0, 18, 12); rect(c, C.woodLight, 1, 1, 16, 10);
  const ic = SIGN_ICONS[icon];
  ic.rows.forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, ic.color, ic.x + i, ic.y + j);
  });
  if (icon === "fish") px(c, C.white, 6, 5);
}
```

with:

```ts

type SignGlyph = { rows: string[]; color: string; x: number; y: number };
const SIGN_ICONS: Record<SignIcon, SignGlyph[]> = {
  fish: [{ rows: ["..####...", ".######.#", "########.", ".######.#", "..####..."], color: "#3d86a8", x: 4, y: 3 }],
  note: [{ rows: ["...##.", "...#.#", "...#..", ".###..", "####..", ".##..."], color: C.red, x: 6, y: 2 }],
  rice: [{ rows: ["..#.#..", ".#.#.#.", "..#.#..", ".#.#.#.", "...#...", "...#..."], color: C.gold, x: 5, y: 2 }],
  cards: [
    { rows: ["..#..", ".###.", "#####", "#####", "..#..", ".###."], color: C.outline, x: 3, y: 2 },
    { rows: [".#.#.", "#####", "#####", ".###.", "..#.."], color: C.red, x: 10, y: 3 },
  ],
};

/** A signpost with a pixel icon: a fish (to the pond), a music note (to the hall), a rice panicle (to the field) or ♠♥
 *  (the card corner). */
function drawSign(c: Ctx, icon: SignIcon): void {
  rect(c, C.outline, 7, 10, 4, 16); rect(c, C.wood, 8, 10, 2, 16);
  rect(c, C.outline, 0, 0, 18, 12); rect(c, C.woodLight, 1, 1, 16, 10);
  for (const ic of SIGN_ICONS[icon]) {
    ic.rows.forEach((r, j) => {
      for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, ic.color, ic.x + i, ic.y + j);
    });
  }
  if (icon === "fish") px(c, C.white, 6, 5);
}

const STOOL_BLUE = "#3d6fd1", STOOL_BLUE_LIGHT = "#6f9be8", STOOL_BLUE_DARK = "#2a4f9c";

/** A blue plastic stool (ghế nhựa) seen from the front: its seat's top-left at (x, y). */
function drawStool(c: Ctx, x: number, y: number): void {
  rect(c, C.outline, x, y, 8, 4); rect(c, STOOL_BLUE, x + 1, y + 1, 6, 2); rect(c, STOOL_BLUE_LIGHT, x + 1, y + 1, 6, 1);
  rect(c, C.outline, x + 1, y + 4, 2, 4); rect(c, C.outline, x + 5, y + 4, 2, 4);
  px(c, STOOL_BLUE_DARK, x + 1, y + 4); px(c, STOOL_BLUE_DARK, x + 6, y + 4);
}

/** A cushion (gối ngồi) on the floor. */
function drawCushion(c: Ctx, x: number, y: number, col: string): void {
  rect(c, C.outline, x + 1, y, 6, 6); rect(c, C.outline, x, y + 1, 8, 4);
  rect(c, col, x + 1, y + 1, 6, 4); rect(c, C.goldLight, x + 3, y + 2, 2, 2);
}

/** A tiny card lying on a table: a white face with a red or black pip, or a burgundy back. */
function drawTinyCard(c: Ctx, x: number, y: number, face: "red" | "black" | "back"): void {
  rect(c, C.outline, x, y, 5, 6);
  rect(c, face === "back" ? "#8e2a3f" : C.white, x + 1, y + 1, 3, 4);
  if (face === "back") px(c, C.gold, x + 2, y + 2);
  else px(c, face === "red" ? C.red : C.outline, x + 2, y + 2);
}

/** Tiến lên: a low square table with a red-checked cloth, a fan of cards and 4 blue plastic stools. */
function drawTienLenTable(c: Ctx): void {
  drawStool(c, 2, 12); drawStool(c, 34, 12);
  // the table: cloth top, a checked apron, two legs
  rect(c, C.outline, 9, 5, 26, 17);
  for (let y = 6; y < 18; y++) for (let x = 10; x < 34; x++) {
    const check = (Math.floor((x - 10) / 3) + Math.floor((y - 6) / 3)) % 2 === 0;
    px(c, check ? C.red : C.white, x, y);
  }
  rect(c, C.redDark, 10, 18, 24, 3);
  for (let x = 10; x < 34; x += 3) px(c, C.white, x, 19);
  rect(c, C.outline, 11, 21, 3, 4); rect(c, C.outline, 30, 21, 3, 4);
  rect(c, C.woodDark, 12, 21, 1, 3); rect(c, C.woodDark, 31, 21, 1, 3);
  // a fan of cards and the pile
  drawTinyCard(c, 15, 9, "black"); drawTinyCard(c, 18, 8, "red"); drawTinyCard(c, 21, 9, "black");
  drawTinyCard(c, 27, 10, "back");
  drawStool(c, 12, 22); drawStool(c, 24, 22);
}

/** Cào: a round straw mat (chiếu cói) with a red envelope, a stack of cards and 6 cushions. */
function drawCaoMat(c: Ctx): void {
  drawCushion(c, 2, 4, C.red); drawCushion(c, 47, 4, "#5caa4a");
  const cx = 28, cy = 12, rx = 18, ry = 7;
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d > 1.16) continue;
    if (d > 0.9) px(c, d > 1.02 ? C.outline : "#a8843f", x, y);
    else px(c, (x + y) % 4 === 0 ? "#c4a85e" : (x - y) % 6 === 0 ? "#e8d28a" : "#d8c07a", x, y);
  }
  // the red envelope (lì xì) and the stack of cards
  rect(c, C.outline, 17, 8, 8, 6); rect(c, C.red, 18, 9, 6, 4); rect(c, C.gold, 20, 10, 2, 2);
  drawTinyCard(c, 30, 8, "back"); drawTinyCard(c, 31, 7, "back");
  drawCushion(c, 4, 14, C.gold); drawCushion(c, 45, 14, C.blue);
  drawCushion(c, 17, 21, "#b5566f"); drawCushion(c, 32, 21, C.red);
}

/** Poker: an oval table with green felt, a wooden rim, a stack of chips and 6 stools. */
function drawPokerTable(c: Ctx): void {
  drawStool(c, 2, 11); drawStool(c, 44, 11);
  rect(c, C.outline, 24, 20, 7, 6); rect(c, C.woodDeep, 25, 20, 5, 5);
  const cx = 27, cy = 14, rx = 17, ry = 7;
  for (let y = cy - ry - 1; y <= cy + ry + 1; y++) for (let x = cx - rx - 1; x <= cx + rx + 1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d > 1.14) continue;
    if (d > 1.0) px(c, C.outline, x, y);
    else if (d > 0.72) px(c, y > cy ? C.woodDark : C.wood, x, y);
    else px(c, d < 0.25 && y < cy ? "#3f9a62" : "#2f7d4f", x, y);
  }
  // the chips: red, white and blue coins
  for (const [x, col] of [[22, C.red], [26, C.white], [30, C.blue]] as const) {
    rect(c, C.outline, x - 1, 11, 5, 5);
    for (let k = 0; k < 3; k++) rect(c, k % 2 === 0 ? col : C.goldLight, x, 12 + k, 3, 1);
  }
  drawTinyCard(c, 14, 10, "back"); drawTinyCard(c, 36, 11, "back");
  for (const x of [11, 19, 27, 35]) drawStool(c, x, 23);
}

function drawCardTable(c: Ctx, game: CardGame): void {
  if (game === "tienlen") drawTienLenTable(c);
  else if (game === "cao") drawCaoMat(c);
  else drawPokerTable(c);
}
```

**lib/game/maps/props.ts — edit 4 of 4.** Replace:

```ts
    case "scarecrow": return drawScarecrow(c);
  }
```

with:

```ts
    case "scarecrow": return drawScarecrow(c);
    case "card_table": return drawCardTable(c, p.game);
  }
```

**lib/game/maps/hall-art.ts — edit 1 of 3.** Replace:

```ts
import { HALL_H, HALL_W, LIGHT_STRINGS, hallShoreY } from "./hall";
import { propSprite } from "./props";
```

with:

```ts
import { CARD_DECK, HALL_H, HALL_W, LIGHT_STRINGS, hallShoreY } from "./hall";
import { propSprite } from "./props";
```

**lib/game/maps/hall-art.ts — edit 2 of 3.** Replace:

```ts

// ---------------------------------------------------------------- public
```

with:

```ts

/** Góc đánh bài (v16 spec §15): a plank deck with a rope edge, a few floor lanterns and grass tufts at the edge. */
function paintCardCorner(c: Ctx): void {
  const R = rng(37);
  const { x: x0, y: y0, w, h } = CARD_DECK;
  const bottom = (x: number) => Math.min(y0 + h, Math.floor(hallShoreY(x)) - 5);
  const planks = ["#a8743f", "#b07c46", "#9c6c3a"];
  for (let x = x0; x < x0 + w; x++) {
    for (let y = y0; y < bottom(x); y++) {
      const row = Math.floor((y - y0) / 5);
      const joint = (x - x0 + row * 23) % 46 === 0;
      const seam = (y - y0) % 5 === 4;
      px(c, seam || joint ? C.woodDark : planks[row % 3], x, y);
    }
  }
  for (let i = 0; i < 140; i++) {
    const x = x0 + Math.floor(R() * w), y = y0 + Math.floor(R() * h);
    if (y < bottom(x) - 1 && (y - y0) % 5 !== 4) px(c, R() < 0.5 ? C.woodLight : "#8e5e32", x, y);
  }
  // the rope edge: a twisted rope along the deck, two tones
  const rope = (x: number, y: number, k: number) => px(c, k % 3 === 0 ? "#8a6a3f" : "#e0c27a", x, y);
  for (let x = x0; x < x0 + w; x++) {
    rope(x, y0, x);
    rope(x, bottom(x) - 1, x + 1);
  }
  for (let y = y0; y < bottom(x0); y++) rope(x0, y, y);
  for (let y = y0; y < bottom(x0 + w - 1); y++) rope(x0 + w - 1, y, y);
  // floor lanterns (đèn lồng) at the corners
  for (const [lx, ly] of [[68, 246], [237, 246], [70, 312]] as const) {
    rect(c, C.outline, lx - 2, ly - 5, 5, 7);
    rect(c, C.red, lx - 1, ly - 4, 3, 5); rect(c, C.goldLight, lx, ly - 3, 1, 3);
    rect(c, C.gold, lx - 1, ly - 6, 3, 1); rect(c, C.gold, lx - 1, ly + 2, 3, 1);
  }
  // grass tufts at the edge
  for (let i = 0; i < 40; i++) {
    const top = R() < 0.5;
    const x = x0 + Math.floor(R() * w), y = top ? y0 - 1 : bottom(x);
    px(c, C.grassDeep, x, y); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x - 1, y - 1);
  }
}

// ---------------------------------------------------------------- public
```

**lib/game/maps/hall-art.ts — edit 3 of 3.** Replace:

```ts
  paintGround(g);
  paintRiverDetails(g);
```

with:

```ts
  paintGround(g);
  paintCardCorner(g);
  paintRiverDetails(g);
```

**lib/game/engine.ts — edit 1 of 4.** Replace:

```ts
} from "@/lib/game/art/crops";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
```

with:

```ts
} from "@/lib/game/art/crops";
import type { CardGame } from "@/lib/game/cards/deck";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
```

**lib/game/engine.ts — edit 2 of 4.** Replace:

```ts
  private plotArt = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  private raf = 0;
```

with:

```ts
  private plotArt = new Map<number, { key: string; canvas: HTMLCanvasElement }>();
  /** The hall's card-table labels (v16 spec §5). */
  private cardTables: Partial<Record<CardGame, string>> = {};
  private raf = 0;
```

**lib/game/engine.ts — edit 3 of 4.** Replace:

```ts
    this.plots = new Map(plots.map((p) => [p.no, p]));
  }
```

with:

```ts
    this.plots = new Map(plots.map((p) => [p.no, p]));
  }

  /** The card tables' labels from card_lobby (v16 spec §5): one line over each table of the hall. */
  setCardTables(labels: Readonly<Partial<Record<CardGame, string>>>): void {
    this.cardTables = { ...labels };
  }
```

**lib/game/engine.ts — edit 4 of 4.** Replace:

```ts

    // name tags under the feet — neighbours at a table would overlap, so later tags move down
```

with:

```ts

    // the card tables' labels: the lobby's line over each table (v16 spec §5)
    for (const it of this.map.interactables) {
      const text = it.kind === "card_table" && it.game ? this.cardTables[it.game] : undefined;
      if (!text) continue;
      const [x, y] = dev(it.rect.x + it.rect.w / 2, it.rect.y - 4);
      const w = Math.round(c.measureText(text).width + 3 * s), h = Math.round(4.8 * s);
      if (x + w / 2 < 0 || x - w / 2 > this.canvas.width || y + h < 0 || y - h > this.canvas.height) continue;
      c.fillStyle = "rgba(31, 90, 58, 0.9)";
      c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
      c.fillStyle = "#fbf3dc";
      c.fillText(text, x, y + s * 0.3);
    }

    // name tags under the feet — neighbours at a table would overlap, so later tags move down
```

**components/game/GameCanvas.tsx — edit 1 of 6.** Replace:

```tsx
import type { PlotDraw } from "@/lib/game/art/crops";
import { GameEngine, type LocalFishing, type RosterEntry } from "@/lib/game/engine";
```

with:

```tsx
import type { PlotDraw } from "@/lib/game/art/crops";
import type { CardGame } from "@/lib/game/cards/deck";
import { GameEngine, type LocalFishing, type RosterEntry } from "@/lib/game/engine";
```

**components/game/GameCanvas.tsx — edit 2 of 6.** Replace:

```tsx
  plotChanged: (p: number) => void;
}
```

with:

```tsx
  plotChanged: (p: number) => void;
  /** The hall's card-table labels (v16 spec §5). */
  setCardTables: (labels: Readonly<Partial<Record<CardGame, string>>>) => void;
}
```

**components/game/GameCanvas.tsx — edit 3 of 6.** Replace:

```tsx
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset, the input lock and the plots.
  const handRef = useRef<string | null>(null);
```

with:

```tsx
  const propsRef = useRef(rest);
  // What every new engine must know again: my hand fish, the species names, the HUD inset, the input lock, the plots and
  // the card tables' labels.
  const handRef = useRef<string | null>(null);
```

**components/game/GameCanvas.tsx — edit 4 of 6.** Replace:

```tsx
  const plotsRef = useRef<ReadonlyArray<PlotDraw>>([]);
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
```

with:

```tsx
  const plotsRef = useRef<ReadonlyArray<PlotDraw>>([]);
  const cardTablesRef = useRef<Readonly<Partial<Record<CardGame, string>>>>({});
  // This world's answer to `hello`s, and who of its roster is here (null until its first roster).
```

**components/game/GameCanvas.tsx — edit 5 of 6.** Replace:

```tsx
      plotChanged: (p) => sendRef.current?.({ t: "fp", id: localId, p }),
    };
```

with:

```tsx
      plotChanged: (p) => sendRef.current?.({ t: "fp", id: localId, p }),
      setCardTables: (labels) => {
        cardTablesRef.current = labels;
        engineRef.current?.setCardTables(labels);
      },
    };
```

**components/game/GameCanvas.tsx — edit 6 of 6.** Replace:

```tsx
    engine.setPlots(plotsRef.current);
```

with:

```tsx
    engine.setPlots(plotsRef.current);
    engine.setCardTables(cardTablesRef.current);
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (24 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/maps/types.ts lib/game/maps/hall.ts lib/game/maps/props.ts lib/game/maps/hall-art.ts lib/game/engine.ts components/game/GameCanvas.tsx tests/unit/game-hall-map.test.ts tests/unit/game-hall-art.test.ts tests/unit/game-canvas-input.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): Góc đánh bài in the hall — the deck, three tables, the sign, a light pole; the tables' labels on the canvas

The hall's south-west corner (spec §5): a plank deck with the three tables, their stools and cushions, the 📜 Sổ luật
sign, and a light pole with its string, all drawn in code; their solids, the interactables card_table (with its game)
and card_rules, and their prompts. The engine draws each table's label over it (setCardTables), and GameCanvas hands the
labels to the next map's engine.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/GameCanvas.tsx lib/game/engine.ts lib/game/maps/hall-art.ts lib/game/maps/hall.ts lib/game/maps/props.ts lib/game/maps/types.ts tests/unit/game-canvas-input.test.tsx tests/unit/game-hall-art.test.ts tests/unit/game-hall-map.test.ts
git commit -F <message file>
```

---

### Task 13: `useCardTable` — the state and my hand, the `cv` hints, the 15 s poll and the lazy timers' ticks

**Files:**
- Create: `lib/game/cards/channel.ts`, `hooks/useCardTable.ts`
- Modify: `lib/game/net/budget.ts` (`CARD_LIMITS`)
- Test: `tests/unit/cards-channel.test.ts`, `tests/unit/use-card-table.test.tsx` (create), `tests/unit/game-budget.test.ts` (modify)

**Interfaces:**
- Consumes: Tasks 8–10 (the parsers, the RPC wrappers, `cardErrorMessage`, `mySeat`); `syncClock` / `serverNow` from `@/lib/game/farm/clock`; `createBudget` and the `Bucket` type from `@/lib/game/net/budget` (anti-cheat §14); `whenTopicFree` / `markLeaving` from `@/lib/channel-lifecycle` and `supabase.channel` / `removeChannel`, as the other game channels use them.
- Produces (`@/lib/game/cards/channel`): `CardHint {id, v}`, `parseCardHint(payload) → CardHint | null` (an id of 1–64 characters, an integer `v ≥ 0`), `cardTopic(roomId, game)` (`cards:{roomId}:{game}`), `joinCardChannel(roomId, game, onHint) → CardChannelHandle {send(hint), leave()}` (broadcast `self: false`, event `cv`; a hint sent before the channel is subscribed is dropped — the others poll).
- Produces (`lib/game/net/budget.ts`): `CARD_LIMITS = { cv: { rate: 5, burst: 5 } }` (5 hints a second per sender, burst 5).
- Produces (`@/hooks/useCardTable`): the constants `CV_GATHER_MS` 150, `CV_MIN_GAP_MS` 500, `CARD_POLL_MS` 15 000, `TICK_LAG_MS` 300, `TICK_STEP_MS` 200, `SPECTATOR_LAG_MS` 3 000, `TICK_RETRY_MS` 1 000; `useCardTable({roomId, token, accountId, game, active, isMember, onError, onCoins?, onState?}) → CardTable {game, state, hand, failed, notOpen, busy, refetch, tick, act}`. `act(action)` sends the write, applies its answer (the newest version wins), sends `cv`, reports my coins; on an error it toasts, and refetches (`stale` ticks instead). While `active` it joins the channel, answers members' hints within the budget (gather, gap, one trailing), polls, ticks after a deadline, and fetches `card_hand` when the hand number changes and I hold a seat in it.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/cards-channel.test.ts` with exactly:

```ts
import { describe, it, expect } from "vitest";
import { cardTopic, parseCardHint } from "@/lib/game/cards/channel";

describe("the card table's channel (spec §12)", () => {
  it("is one topic per table", () => {
    expect(cardTopic("room-1", "poker")).toBe("cards:room-1:poker");
  });

  it("reads a cv hint {id, v} and nothing else", () => {
    expect(parseCardHint({ id: "a1", v: 812 })).toEqual({ id: "a1", v: 812 });
    expect(parseCardHint({ id: "a1", v: 812, state: { phase: "idle" } })).toEqual({ id: "a1", v: 812 });
    for (const bad of [null, "cv", { id: "a1" }, { v: 3 }, { id: "", v: 3 }, { id: "a1", v: -1 }, { id: "a1", v: 1.5 },
      { id: "x".repeat(65), v: 3 }, { id: 7, v: 3 }]) {
      expect(parseCardHint(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
```

**tests/unit/game-budget.test.ts — edit 1 of 2.** Replace:

```ts
import { describe, it, expect } from "vitest";
import { budgetKind, createBudget, createReactionBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { isHereOn } from "@/lib/game/social";
```

with:

```ts
import { describe, it, expect } from "vitest";
import { budgetKind, CARD_LIMITS, createBudget, createReactionBudget, GAME_LIMITS } from "@/lib/game/net/budget";
import { isHereOn } from "@/lib/game/social";
```

**tests/unit/game-budget.test.ts — edit 2 of 2.** Replace:

```ts

  it("keys reactions by account, else by name, else one shared bucket, with 12 a second in total", () => {
```

with:

```ts

  it("gives the card tables' hint its own budget: cv 5 a second per sender, burst 5 (v16 spec §12)", () => {
    expect(CARD_LIMITS).toEqual({ cv: { rate: 5, burst: 5 } });
    const b = createBudget(CARD_LIMITS);
    expect(Array.from({ length: 6 }, () => b.take("ann", "cv", 0))).toEqual([true, true, true, true, true, false]);
    expect(b.take("bob", "cv", 0)).toBe(true);
    expect(b.take("ann", "cv", 200)).toBe(true);
  });

  it("keys reactions by account, else by name, else one shared bucket, with 12 a second in total", () => {
```

Create `tests/unit/use-card-table.test.tsx` with exactly:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { AnticheatError } from "@/lib/anticheat";
import type { CardHand } from "@/lib/game/cards/state";
import { syncClock } from "@/lib/game/farm/clock";
import { cs, ID, parsed, T0, tlRaw, type Raw } from "./helpers/card-states";

const rpc = vi.hoisted(() => ({ fetchCardState: vi.fn(), fetchCardHand: vi.fn(), tickCardTable: vi.fn(), cardAction: vi.fn() }));
vi.mock("@/lib/game/cards/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/cards/rpc")>()),
  ...rpc,
}));
const ch = vi.hoisted(() => ({ onHint: null as null | ((h: { id: string; v: number }) => void), sent: [] as unknown[], joins: 0, leaves: 0 }));
vi.mock("@/lib/game/cards/channel", () => ({
  joinCardChannel: (_room: string, _game: string, onHint: (h: { id: string; v: number }) => void) => {
    ch.onHint = onHint;
    ch.joins++;
    return { send: (h: unknown) => ch.sent.push(h), leave: () => { ch.leaves++; } };
  },
}));

import {
  CARD_POLL_MS, CV_GATHER_MS, CV_MIN_GAP_MS, SPECTATOR_LAG_MS, TICK_LAG_MS, TICK_RETRY_MS, TICK_STEP_MS, useCardTable,
} from "@/hooks/useCardTable";

const ME = ID[1]; // seat 2 of the sample table
const state = (over: Raw = {}) => parsed(tlRaw(over));
const hand = (handNo: number, cards = cs("3S", "4D")): CardHand => ({ serverNow: Date.parse(T0), game: "tienlen", handNo, seat: 2, cards });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const members = new Set(ID.slice(0, 5));

function mount(over: {
  active?: boolean; accountId?: string; onError?: (t: string) => void; onCoins?: (c: number) => void;
  onState?: (g: string, s: unknown) => void;
} = {}) {
  return renderHook((p: { active: boolean }) => useCardTable({
    roomId: "r", token: "tok", accountId: over.accountId ?? ME, game: "tienlen", active: p.active,
    isMember: (id) => members.has(id), onError: over.onError ?? (() => {}), onCoins: over.onCoins, onState: over.onState,
  }), { initialProps: { active: over.active ?? true } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(T0));
  syncClock(T0);
  for (const f of Object.values(rpc)) f.mockReset();
  ch.onHint = null;
  ch.sent.length = 0;
  ch.joins = 0;
  ch.leaves = 0;
  // no deadline unless a test sets one: the ticks stay out of the way
  rpc.fetchCardState.mockResolvedValue(state({ deadline: null }));
  rpc.fetchCardHand.mockResolvedValue(hand(3));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCardTable (spec §12, §13.1)", () => {
  it("fetches the table while active, subscribes to its hints, and fetches my hand once per hand number", async () => {
    const onState = vi.fn();
    const { result, rerender } = mount({ active: false, onState });
    await flush();
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    rerender({ active: true });
    await flush();
    expect(ch.joins).toBe(1);
    expect(rpc.fetchCardState).toHaveBeenCalledWith("r", "tok", "tienlen");
    expect(result.current.state?.v).toBe(10);
    expect(onState).toHaveBeenCalledWith("tienlen", result.current.state);
    expect(rpc.fetchCardHand).toHaveBeenCalledTimes(1);
    expect(result.current.hand?.cards).toEqual(cs("3S", "4D"));
    await act(async () => { await result.current.refetch(); });
    expect(rpc.fetchCardHand).toHaveBeenCalledTimes(1);
    rpc.fetchCardState.mockResolvedValueOnce(state({ deadline: null, v: 11, hand_no: 4 }));
    rpc.fetchCardHand.mockResolvedValueOnce(hand(4, cs("2H")));
    await act(async () => { await result.current.refetch(); });
    expect(rpc.fetchCardHand).toHaveBeenCalledTimes(2);
    expect(result.current.hand).toMatchObject({ handNo: 4, cards: cs("2H") });
    rerender({ active: false });
    expect(ch.leaves).toBe(1);
  });

  it("a spectator gets no hand", async () => {
    const { result } = mount({ accountId: ID[5] });
    await flush();
    expect(result.current.state).not.toBeNull();
    expect(rpc.fetchCardHand).not.toHaveBeenCalled();
    expect(result.current.hand).toBeNull();
  });

  it("answers a hint with one refetch after 150 ms, and keeps refetches 500 ms apart with one trailing refetch", async () => {
    mount();
    await flush();
    rpc.fetchCardState.mockClear();
    act(() => ch.onHint!({ id: ID[0], v: 11 }));
    act(() => ch.onHint!({ id: ID[2], v: 12 }));
    await advance(CV_GATHER_MS - 1);
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    act(() => ch.onHint!({ id: ID[0], v: 13 }));
    await advance(CV_MIN_GAP_MS - 1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    act(() => ch.onHint!({ id: ID[0], v: 14 }));
    await advance(1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(2);
  });

  it("drops hints from non-members, for a version I already show, and past the sender's budget", async () => {
    mount();
    await flush();
    rpc.fetchCardState.mockClear();
    act(() => ch.onHint!({ id: "stranger", v: 99 }));
    act(() => ch.onHint!({ id: ID[0], v: 10 }));
    await advance(1000);
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    // six hints at once from one sender: the budget lets five through, and they are all answered by one refetch
    for (let k = 0; k < 6; k++) act(() => ch.onHint!({ id: ID[0], v: 20 + k }));
    await advance(CV_GATHER_MS);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
  });

  it("ticks after the deadline, in seat order, spectators later; a new state cancels the pending tick", async () => {
    rpc.fetchCardState.mockResolvedValue(state({ deadline: new Date(Date.parse(T0) + 2000).toISOString() }));
    rpc.tickCardTable.mockResolvedValue({ changed: true, state: state({ v: 11, deadline: new Date(Date.parse(T0) + 60_000).toISOString() }) });
    mount();
    await flush();
    const at = 2000 + TICK_LAG_MS + TICK_STEP_MS * 1; // I sit in seat 2: index 1
    await advance(at - 1);
    expect(rpc.tickCardTable).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.tickCardTable).toHaveBeenCalledWith("r", "tok", "tienlen");
    expect(ch.sent).toEqual([{ id: ME, v: 11 }]);
    // a spectator waits 3 s more
    cleanup();
    rpc.tickCardTable.mockClear();
    vi.setSystemTime(Date.parse(T0));
    rpc.fetchCardState.mockResolvedValue(state({ deadline: new Date(Date.parse(T0) + 2000).toISOString() }));
    mount({ accountId: ID[5] });
    await flush();
    await advance(2000 + TICK_LAG_MS + SPECTATOR_LAG_MS - 1);
    expect(rpc.tickCardTable).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
  });

  it("sends a tick that found nothing due again a second later; a newer state moves the schedule", async () => {
    const due = new Date(Date.parse(T0) + 1000).toISOString();
    rpc.fetchCardState.mockResolvedValue(state({ deadline: due }));
    // the answer carries the server's time when it was made (the clock follows it)
    rpc.tickCardTable.mockImplementation(async () => ({
      changed: false, state: state({ deadline: due, server_now: new Date(Date.now()).toISOString() }),
    }));
    const { result } = mount({ accountId: ID[0] });
    await flush();
    await advance(1000 + TICK_LAG_MS);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
    await advance(TICK_RETRY_MS - 1);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(2);
    expect(ch.sent).toEqual([]);
    rpc.fetchCardState.mockResolvedValueOnce(state({ v: 12, deadline: new Date(Date.parse(T0) + 30_000).toISOString() }));
    await act(async () => { await result.current.refetch(); });
    await advance(5000);
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(2);
  });

  it("polls every 15 s while nothing arrives", async () => {
    mount();
    await flush();
    rpc.fetchCardState.mockClear();
    await advance(CARD_POLL_MS - 1);
    expect(rpc.fetchCardState).not.toHaveBeenCalled();
    await advance(1);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    await advance(CARD_POLL_MS);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(2);
  });

  it("applies an action's answer, hints the others and reports my coins; a refusal toasts and refetches, `stale` ticks", async () => {
    const onError = vi.fn(), onCoins = vi.fn();
    const { result } = mount({ onError, onCoins });
    await flush();
    rpc.cardAction.mockResolvedValueOnce({ changed: true, state: state({ v: 15, deadline: null }), hand: hand(3, cs("4D")), coins: 7000 });
    await act(async () => { await result.current.act({ kind: "tl_play", seq: 5, cards: cs("3S") }); });
    expect(rpc.cardAction).toHaveBeenCalledWith("r", "tok", "tienlen", { kind: "tl_play", seq: 5, cards: cs("3S") });
    expect(result.current.state?.v).toBe(15);
    expect(result.current.hand?.cards).toEqual(cs("4D"));
    expect(ch.sent).toEqual([{ id: ME, v: 15 }]);
    expect(onCoins).toHaveBeenCalledWith(7000);

    rpc.fetchCardState.mockClear();
    rpc.cardAction.mockRejectedValueOnce({ message: "cannot beat" });
    await act(async () => { expect(await result.current.act({ kind: "tl_play", seq: 6, cards: cs("4D") })).toBeNull(); });
    expect(onError).toHaveBeenLastCalledWith("Bài này không chặn được.");
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);

    rpc.tickCardTable.mockResolvedValueOnce({ changed: true, state: state({ v: 16, deadline: null }) });
    rpc.cardAction.mockRejectedValueOnce({ message: "stale" });
    await act(async () => { await result.current.act({ kind: "tl_pass", seq: 1 }); });
    expect(onError).toHaveBeenLastCalledWith("Bàn vừa thay đổi — xem lại nhé.");
    expect(rpc.tickCardTable).toHaveBeenCalledTimes(1);
    expect(result.current.state?.v).toBe(16);

    onError.mockClear();
    rpc.cardAction.mockRejectedValueOnce(new AnticheatError({ code: "bad_cards", strike: 1, error: "invalid cards", lockedUntil: null,
      banned: false, serverNow: null }));
    await act(async () => { await result.current.act({ kind: "tl_play", seq: 6, cards: [99] }); });
    expect(onError).not.toHaveBeenCalled();
  });

  it("keeps the newest version when answers overtake each other", async () => {
    const { result } = mount();
    await flush();
    let slow!: (s: unknown) => void;
    rpc.fetchCardState.mockReturnValueOnce(new Promise((resolve) => { slow = resolve; }));
    const pending = act(async () => { await result.current.refetch(); });
    rpc.cardAction.mockResolvedValueOnce({ changed: true, state: state({ v: 30, deadline: null }), hand: hand(3), coins: null });
    await act(async () => { await result.current.act({ kind: "tl_pass", seq: 5 }); });
    slow(state({ v: 20, deadline: null }));
    await pending;
    expect(result.current.state?.v).toBe(30);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/cards-channel.test.ts tests/unit/game-budget.test.ts tests/unit/use-card-table.test.tsx`
Expected: FAIL — `cards-channel.test.ts` and `use-card-table.test.tsx` stop at `Failed to resolve import …` (`channel.ts` and `useCardTable.ts` do not exist yet); in `game-budget.test.ts` the `cv` test fails (1 failed, 6 passed).

- [ ] **Step 3: The channel, the budget and the hook**

Create `lib/game/cards/channel.ts` with exactly:

```ts
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import { supabase, type RealtimeChannel } from "@/lib/supabase";
import type { CardGame } from "./deck";

// The card table's broadcast channel (spec §12): `cards:{roomId}:{game}`, one hint `cv {id, v}` — "the table changed,
// version v" — sent once by the client whose RPC changed it. A hint carries no state: receivers fetch card_state.
// Browser only.

/** A hint: who changed the table, and its version after the change. */
export interface CardHint { id: string; v: number }

/** A `cv` payload, or null for anything else. */
export function parseCardHint(payload: unknown): CardHint | null {
  const p = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  const id = p?.id, v = p?.v;
  return typeof id === "string" && id.length > 0 && id.length <= 64 && typeof v === "number" && Number.isInteger(v) && v >= 0
    ? { id, v } : null;
}

export interface CardChannelHandle {
  /** Send a hint once the channel is subscribed (dropped before: the others poll). */
  send(h: CardHint): void;
  leave(): void;
}

export function cardTopic(roomId: string, game: CardGame): string {
  return `cards:${roomId}:${game}`;
}

export function joinCardChannel(roomId: string, game: CardGame, onHint: (h: CardHint) => void): CardChannelHandle {
  const topic = cardTopic(roomId, game);
  let channel: RealtimeChannel | null = null;
  let subscribed = false;
  let left = false;
  const joined = whenTopicFree(topic).then(() => {
    if (left) return;
    const ch = supabase.channel(topic, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "cv" }, (m: { payload?: unknown }) => {
      const h = parseCardHint(m.payload);
      if (h) onHint(h);
    });
    channel = ch;
    ch.subscribe((status) => {
      subscribed = status === "SUBSCRIBED";
    });
  });
  return {
    send: (h) => {
      if (channel && subscribed) channel.send({ type: "broadcast", event: "cv", payload: { id: h.id, v: h.v } }).catch(() => {});
    },
    leave: () => {
      if (left) return;
      left = true;
      markLeaving(topic, joined.then(() => {
        if (!channel) return;
        subscribed = false;
        return supabase.removeChannel(channel);
      }));
    },
  };
}
```

**lib/game/net/budget.ts.** Replace:

```ts

/** Reactions: 5 a second per sender, burst 5; at most 12 a second in all. */
```

with:

```ts

/** The card tables' channel (v16 spec §12): a `cv` hint 5 a second per sender, burst 5. */
export const CARD_LIMITS = { cv: { rate: 5, burst: 5 } } as const satisfies Record<string, Bucket>;

/** Reactions: 5 a second per sender, burst 5; at most 12 a second in all. */
```

Create `hooks/useCardTable.ts` with exactly:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError } from "@/lib/anticheat";
import { joinCardChannel, type CardChannelHandle } from "@/lib/game/cards/channel";
import type { CardGame } from "@/lib/game/cards/deck";
import { cardErrorMessage, isMissingRpc } from "@/lib/game/cards/messages";
import { cardAction, fetchCardHand, fetchCardState, tickCardTable, type CardAction } from "@/lib/game/cards/rpc";
import { mySeat, type CardAnswer, type CardHand, type CardState } from "@/lib/game/cards/state";
import { serverNow, syncClock } from "@/lib/game/farm/clock";
import { CARD_LIMITS, createBudget } from "@/lib/game/net/budget";

/** Hints arriving this close together are answered by one card_state (spec §12, R26). */
export const CV_GATHER_MS = 150;
/** Refetches for hints start at least this far apart; a hint inside the gap brings one trailing refetch. */
export const CV_MIN_GAP_MS = 500;
/** While no hint arrives the table is fetched this often (a lost hint costs at most this). */
export const CARD_POLL_MS = 15_000;
/** A seated client ticks at deadline + TICK_LAG_MS + TICK_STEP_MS × its index among the seated players (§10). */
export const TICK_LAG_MS = 300;
export const TICK_STEP_MS = 200;
/** Spectators tick this much later still. */
export const SPECTATOR_LAG_MS = 3000;
/** A tick that found nothing due (the clocks disagree a little) goes again this much later. */
export const TICK_RETRY_MS = 1000;

export interface CardTableOptions {
  roomId: string;
  token: string;
  accountId: string;
  /** The table; null = none (the hook idles). */
  game: CardGame | null;
  /** The panel is open on it, or I sit at it: fetch it, subscribe to its hints, poll and tick. */
  active: boolean;
  /** Is this account a room member? Hints from anyone else are dropped. */
  isMember: (accountId: string) => boolean;
  /** An action's refusal, in Vietnamese. */
  onError: (text: string) => void;
  /** My wallet after an action. */
  onCoins?: (coins: number) => void;
  /** Every state applied (the controller follows where I sit). */
  onState?: (game: CardGame, state: CardState) => void;
}

export interface CardTable {
  game: CardGame | null;
  /** The table as card_state shows it (the same for every viewer); null before the first answer. */
  state: CardState | null;
  /** My cards in the table's current hand (card_hand and my own answers); null when I hold none. */
  hand: CardHand | null;
  failed: boolean;
  /** Migration 0017 is not run. */
  notOpen: boolean;
  /** An action is in flight. */
  busy: boolean;
  refetch: () => Promise<void>;
  tick: () => Promise<void>;
  /** A card write; its answer replaces the state and my hand, and the others get a hint. On error: toast, refetch (a
   *  `stale` refusal ticks instead: its sweep was rolled back with it), null. */
  act: (a: CardAction) => Promise<CardAnswer | null>;
}

/** One card table (spec §13.1): its state and my hand, the channel's hints (gathered, gapped and budgeted), the 15 s
 *  poll and the lazy timers' ticks. */
export function useCardTable({ roomId, token, accountId, game, active, isMember, onError, onCoins, onState }: CardTableOptions): CardTable {
  const [data, setData] = useState<{ game: CardGame | null; state: CardState | null; hand: CardHand | null }>(
    { game: null, state: null, hand: null });
  const [failed, setFailed] = useState(false);
  const [notOpen, setNotOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Bumped after every fetch or tick, so the poll and the tick schedule re-arm. */
  const [pulse, setPulse] = useState(0);
  const live = useRef({ roomId, token, accountId, game, isMember, onError, onCoins, onState });
  useEffect(() => {
    live.current = { roomId, token, accountId, game, isMember, onError, onCoins, onState };
  });

  /** The version applied last (answers may overtake each other), the call that brought the hand, the hand number
   *  fetched last, and the state applied last (for an error's `must`). */
  const appliedV = useRef(-1);
  const callNo = useRef(0);
  const handAt = useRef(0);
  const handNo = useRef<number | null>(null);
  const lastState = useRef<CardState | null>(null);
  const channel = useRef<CardChannelHandle | null>(null);

  const loadHand = useCallback(async (g: CardGame) => {
    const n = ++callNo.current;
    try {
      const h = await fetchCardHand(live.current.roomId, live.current.token, g);
      if (live.current.game !== g || n < handAt.current) return;
      handAt.current = n;
      handNo.current = h.handNo;
      setData((d) => (d.game === g ? { ...d, hand: h.cards.length > 0 ? h : null } : d));
    } catch {
      handNo.current = null; // the next state tries again
    }
  }, []);

  /** Apply a state (and the hand that came with it): only the newest version, only for the table I still watch. A new
   *  hand number fetches my cards once while I sit at the table. */
  const apply = useCallback((g: CardGame, s: CardState, n: number, hand?: CardHand | null) => {
    syncClock(s.serverNow);
    if (live.current.game !== g || s.v < appliedV.current) return;
    appliedV.current = s.v;
    lastState.current = s;
    const seat = mySeat(s, live.current.accountId);
    const sitting = seat !== null && !seat.leaving;
    let fresh: CardHand | null | undefined;
    if (hand !== undefined && n >= handAt.current) {
      handAt.current = n;
      handNo.current = hand?.handNo ?? s.handNo;
      fresh = hand && hand.cards.length > 0 ? hand : null;
    }
    setData((d) => {
      let h = fresh !== undefined ? fresh : d.game === g ? d.hand : null;
      if (!sitting || (h && h.handNo !== s.handNo)) h = null;
      return { game: g, state: s, hand: h };
    });
    setFailed(false);
    setNotOpen(false);
    live.current.onState?.(g, s);
    if (sitting && fresh === undefined && handNo.current !== s.handNo) {
      handNo.current = s.handNo;
      void loadHand(g);
    }
  }, [loadHand]);

  const refetch = useCallback(async () => {
    const g = live.current.game;
    if (!g) return;
    const n = ++callNo.current;
    try {
      apply(g, await fetchCardState(live.current.roomId, live.current.token, g), n);
    } catch (err) {
      if (isMissingRpc(err)) setNotOpen(true);
      else setFailed(true);
    } finally {
      setPulse((p) => p + 1);
    }
  }, [apply]);

  const tick = useCallback(async () => {
    const g = live.current.game;
    if (!g) return;
    const n = ++callNo.current;
    try {
      const r = await tickCardTable(live.current.roomId, live.current.token, g);
      apply(g, r.state, n);
      if (r.changed) channel.current?.send({ id: live.current.accountId, v: r.state.v });
    } catch (err) {
      if (isMissingRpc(err)) setNotOpen(true);
    } finally {
      setPulse((p) => p + 1);
    }
  }, [apply]);

  const act = useCallback(async (a: CardAction): Promise<CardAnswer | null> => {
    const g = live.current.game;
    if (!g) return null;
    const n = ++callNo.current;
    setBusy(true);
    try {
      const r = await cardAction(live.current.roomId, live.current.token, g, a);
      apply(g, r.state, n, r.hand);
      if (r.changed) channel.current?.send({ id: live.current.accountId, v: r.state.v });
      if (r.coins !== null) live.current.onCoins?.(r.coins);
      return r;
    } catch (err) {
      const s = lastState.current;
      const must = s?.game === "tienlen" ? s.pub?.must ?? null : null;
      // a strike shows the anti-cheat warning or ban instead (anti-cheat §12.1)
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) live.current.onError(cardErrorMessage(err, must));
      if (isMissingRpc(err)) setNotOpen(true);
      const msg = err && typeof err === "object" ? (err as { message?: unknown }).message : null;
      void (msg === "stale" ? tick() : refetch());
      return null;
    } finally {
      setBusy(false);
    }
  }, [apply, refetch, tick]);

  // --- the channel: hints from members, newer than what I show, within the sender's budget; gathered, then gapped
  const gather = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintAt = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !game) return;
    appliedV.current = -1;
    handAt.current = 0;
    handNo.current = null;
    lastState.current = null;
    const budget = createBudget(CARD_LIMITS);
    const hinted = () => {
      if (gather.current) return;
      const gap = hintAt.current === null ? 0 : hintAt.current + CV_MIN_GAP_MS - Date.now();
      gather.current = setTimeout(() => {
        gather.current = null;
        hintAt.current = Date.now();
        void refetch();
      }, Math.max(CV_GATHER_MS, gap));
    };
    const ch = joinCardChannel(roomId, game, (h) => {
      if (!live.current.isMember(h.id) || h.v <= appliedV.current) return;
      if (!budget.take(h.id, "cv", performance.now())) return;
      hinted();
    });
    channel.current = ch;
    const first = setTimeout(() => void refetch(), 0);
    return () => {
      clearTimeout(first);
      if (gather.current) clearTimeout(gather.current);
      gather.current = null;
      hintAt.current = null;
      channel.current = null;
      ch.leave();
    };
  }, [active, game, roomId, refetch]);

  const state = data.game === game ? data.state : null;
  const hand = data.game === game ? data.hand : null;

  // --- the poll: every 15 s while nothing else fetched the table
  useEffect(() => {
    if (!active || !game) return;
    const t = setTimeout(() => void refetch(), CARD_POLL_MS);
    return () => clearTimeout(t);
  }, [active, game, pulse, state, refetch]);

  // --- the lazy timers (§10): a tick after the deadline, seated players in seat order, spectators later; a new state
  //     cancels it, and a tick that found nothing due goes again a second later
  const deadline = state?.deadline ?? null;
  const v = state?.v ?? -1;
  const sitting = state ? state.seats.filter((s) => !s.leaving) : [];
  const index = sitting.findIndex((s) => s.id === accountId);
  const tickedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !game || deadline === null) return;
    const lag = index >= 0 ? TICK_LAG_MS + TICK_STEP_MS * index : TICK_LAG_MS + SPECTATOR_LAG_MS;
    let delay = deadline - serverNow() + lag;
    if (tickedFor.current === deadline) delay = Math.max(delay, TICK_RETRY_MS);
    const t = setTimeout(() => {
      tickedFor.current = deadline;
      void tick();
    }, Math.max(0, delay));
    return () => clearTimeout(t);
  }, [active, game, deadline, v, index, pulse, tick]);

  return { game, state, hand, failed, notOpen, busy, refetch, tick, act };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (18 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/cards/channel.ts lib/game/net/budget.ts hooks/useCardTable.ts tests/unit/cards-channel.test.ts tests/unit/game-budget.test.ts tests/unit/use-card-table.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): useCardTable — the state and my hand, the cv hints, the 15 s poll and the lazy timers' ticks

lib/game/cards/channel.ts joins cards:{roomId}:{game} and parses the cv hint; lib/game/net/budget.ts gains CARD_LIMITS
(cv 5 a second per sender, burst 5). hooks/useCardTable keeps one table's state (the newest version wins) and my hand,
answers hints from members after 150 ms with refetches at least 500 ms apart, polls every 15 s, ticks after a deadline
(seated players first, spectators later, a retry when nothing was due), turns a stale refusal into a tick, and syncs the
server clock.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add hooks/useCardTable.ts lib/game/cards/channel.ts lib/game/net/budget.ts tests/unit/cards-channel.test.ts tests/unit/game-budget.test.ts tests/unit/use-card-table.test.tsx
git commit -F <message file>
```

---

### Task 14: `useCardLobby` and `useCardsController` — the hall's labels, the panel, the seated table, a toast once per turn

**Files:**
- Create: `hooks/useCardLobby.ts`, `hooks/useCardsController.ts`
- Test: `tests/unit/use-cards-controller.test.tsx` (create)

**Interfaces:**
- Consumes: Task 13's `useCardTable`; Task 10's `fetchCardLobby`, `hallLabel`, `turnToast`, `CARDS_NOT_OPEN`, `mySeat`; Task 12's `GameCanvasHandle.setCardTables` and the `card_table` / `card_rules` interactables; `MapId`, `Interactable`.
- Produces (`@/hooks/useCardLobby`): `LOBBY_POLL_MS` (20 000), `CardLobbyData {lobby, notOpen}`, `useCardLobby(roomId, token, active, onLobby?)` (`card_lobby` now and every 20 s while `active`).
- Produces (`@/hooks/useCardsController`): `CardsControllerOptions {token, roomId, accountId, mapId, canvas, toast, isMember, onCoinsChanged}`, `CardsController {lobby, notOpen, panel, openPanel(game), closePanel(), rules: {game, stake} | null, openRules(game?), closeRules(), table, seated, seatTable, act(action), interact(it) → boolean}`, `useCardsController(options)`: the lobby on the hall and the tables' labels on the canvas; the E of a `card_table` opens its panel and of `card_rules` the book (on the tab of the table I sit at, else Tiến lên, at that table's stake; before `0017` both toast `CARDS_NOT_OPEN`); one `useCardTable` for the seat I hold and one for the panel when it shows another table; the turn toast once per turn while that panel is closed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/use-cards-controller.test.tsx` with exactly:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { syncClock } from "@/lib/game/farm/clock";
import { getMap } from "@/lib/game/maps/registry";
import type { MapId } from "@/lib/game/maps/types";
import { caoRaw, ID, parsed, seatRaw, T0, tlRaw } from "./helpers/card-states";

const rpc = vi.hoisted(() => ({
  fetchCardLobby: vi.fn(), fetchCardState: vi.fn(), fetchCardHand: vi.fn(), tickCardTable: vi.fn(), cardAction: vi.fn(),
}));
vi.mock("@/lib/game/cards/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/cards/rpc")>()),
  ...rpc,
}));
vi.mock("@/lib/game/cards/channel", () => ({ joinCardChannel: () => ({ send: () => {}, leave: () => {} }) }));

import { LOBBY_POLL_MS } from "@/hooks/useCardLobby";
import { useCardsController } from "@/hooks/useCardsController";

const ME = ID[0];
const lobby = (seats: Array<{ game: string; ids: string[] }> = []) => ({
  serverNow: Date.parse(T0),
  tables: (["tienlen", "cao", "poker"] as const).map((game) => {
    const ids = seats.find((s) => s.game === game)?.ids ?? [];
    return { game, stake: ids.length ? 1000 : null, phase: "idle" as const, max: game === "tienlen" ? 4 : 6,
      seats: ids.map((id, i) => ({ seat: i + 1, id, name: `P${i + 1}` })) };
  }),
});
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const canvas = { setCardTables: vi.fn() };
const it_ = (id: string) => getMap("hall").interactables.find((i) => i.id === id)!;

function mount(mapId: MapId = "hall", toast = vi.fn()) {
  return renderHook((p: { mapId: MapId }) => useCardsController({
    token: "tok", roomId: "r", accountId: ME, mapId: p.mapId, canvas: () => canvas as unknown as GameCanvasHandle, toast,
    isMember: () => true, onCoinsChanged: () => {},
  }), { initialProps: { mapId } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(T0));
  syncClock(T0);
  for (const f of Object.values(rpc)) f.mockReset();
  canvas.setCardTables.mockReset();
  rpc.fetchCardLobby.mockResolvedValue(lobby());
  rpc.fetchCardHand.mockResolvedValue({ serverNow: Date.parse(T0), game: "tienlen", handNo: 3, seat: 1, cards: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCardsController (spec §13.1)", () => {
  it("reads the lobby every 20 s on the hall only, and labels the tables on the canvas", async () => {
    rpc.fetchCardLobby.mockResolvedValue(lobby([{ game: "tienlen", ids: [ID[1], ID[2]] }]));
    const { rerender } = mount("pond");
    await flush();
    expect(rpc.fetchCardLobby).not.toHaveBeenCalled();
    rerender({ mapId: "hall" });
    await flush();
    expect(rpc.fetchCardLobby).toHaveBeenCalledWith("r", "tok");
    expect(canvas.setCardTables).toHaveBeenLastCalledWith({ tienlen: "Tiến lên · 2/4 · 1.000", cao: "Trống", poker: "Trống" });
    await advance(LOBBY_POLL_MS);
    expect(rpc.fetchCardLobby).toHaveBeenCalledTimes(2);
  });

  it("opens a table's panel from its table, the rules book from the sign, and says when 0017 is missing", async () => {
    const toast = vi.fn();
    rpc.fetchCardState.mockResolvedValue(parsed(caoRaw({ deadline: null, seats: [seatRaw(2), seatRaw(3)] })));
    const { result } = mount("hall", toast);
    await flush();
    act(() => { expect(result.current.interact(it_("cards_cao"))).toBe(true); });
    expect(result.current.panel).toBe("cao");
    await flush();
    expect(result.current.table.state?.game).toBe("cao");
    act(() => { result.current.interact(it_("cards_sign")); });
    expect(result.current.rules).toEqual({ game: "tienlen", stake: 1000 });
    expect(result.current.interact(it_("dj_booth"))).toBe(false);
    rpc.fetchCardLobby.mockRejectedValue({ code: "PGRST202", message: "Could not find the function public.card_lobby" });
    await advance(LOBBY_POLL_MS);
    act(() => { result.current.interact(it_("cards_poker")); });
    expect(toast).toHaveBeenLastCalledWith("Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017.");
  });

  it("keeps the table I sit at, finds it again from the lobby, and toasts once per turn while its panel is closed", async () => {
    const toast = vi.fn();
    rpc.fetchCardLobby.mockResolvedValue(lobby([{ game: "tienlen", ids: [ME, ID[1]] }]));
    const mine = parsed(tlRaw({ turn: 1, deadline: null, seats: [seatRaw(1), seatRaw(2)] }));
    rpc.fetchCardState.mockResolvedValue(mine);
    const { result, rerender } = mount("hall", toast);
    await flush();
    await flush();
    expect(result.current.seated).toBe("tienlen");
    expect(result.current.seatTable.state?.v).toBe(10);
    expect(toast).toHaveBeenCalledWith("🃏 Đến lượt bạn ở bàn Tiến lên!");
    await act(async () => { await result.current.seatTable.refetch(); });
    expect(toast).toHaveBeenCalledTimes(1);
    // on the pond the table stays with me
    rerender({ mapId: "pond" });
    rpc.fetchCardState.mockResolvedValueOnce(parsed(tlRaw({ v: 11, seq: 6, turn: 1, deadline: null, seats: [seatRaw(1), seatRaw(2)] })));
    await act(async () => { await result.current.seatTable.refetch(); });
    expect(toast).toHaveBeenCalledTimes(2);
    // standing up (a leaving seat) ends it
    rpc.fetchCardState.mockResolvedValueOnce(parsed(tlRaw({ v: 12, deadline: null, seats: [seatRaw(1, { leaving: true }), seatRaw(2)] })));
    await act(async () => { await result.current.seatTable.refetch(); });
    expect(result.current.seated).toBeNull();
  });

  it("sitting at the table I watch makes it my table without a new fetch, and refreshes the labels", async () => {
    rpc.fetchCardState.mockResolvedValue(parsed(tlRaw({ deadline: null, seats: [seatRaw(2)] })));
    const { result } = mount();
    await flush();
    act(() => result.current.openPanel("tienlen"));
    await flush();
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    rpc.cardAction.mockResolvedValueOnce({ changed: true, state: parsed(tlRaw({ v: 11, deadline: null, seats: [seatRaw(1), seatRaw(2)] })),
      hand: null, coins: 5000 });
    await act(async () => { await result.current.act({ kind: "sit", seat: 1, stake: 1000, buyin: null }); });
    expect(result.current.seated).toBe("tienlen");
    expect(result.current.table).toBe(result.current.seatTable);
    expect(result.current.table.state?.v).toBe(11);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    await flush();
    expect(rpc.fetchCardLobby).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/use-cards-controller.test.tsx`
Expected: FAIL — `Failed to resolve import "@/hooks/useCard…"` (the hooks do not exist yet).

- [ ] **Step 3: Write the two hooks**

Create `hooks/useCardLobby.ts` with exactly:

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isMissingRpc } from "@/lib/game/cards/messages";
import { fetchCardLobby } from "@/lib/game/cards/rpc";
import type { CardLobby } from "@/lib/game/cards/state";

/** The hall's table labels are fetched this often while I am on the hall (spec R27). */
export const LOBBY_POLL_MS = 20_000;

export interface CardLobbyData {
  lobby: CardLobby | null;
  /** Migration 0017 is not run. */
  notOpen: boolean;
  reload: () => Promise<void>;
}

/** card_lobby every 20 s while `active` (on the hall): every table's stake, phase and seats. No realtime. */
export function useCardLobby(roomId: string, token: string, active: boolean, onLobby?: (l: CardLobby) => void): CardLobbyData {
  const [lobby, setLobby] = useState<CardLobby | null>(null);
  const [notOpen, setNotOpen] = useState(false);
  const live = useRef({ roomId, token, onLobby });
  useEffect(() => {
    live.current = { roomId, token, onLobby };
  });
  const seq = useRef(0);
  const applied = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const l = await fetchCardLobby(live.current.roomId, live.current.token);
      if (n < applied.current) return;
      applied.current = n;
      setLobby(l);
      setNotOpen(false);
      live.current.onLobby?.(l);
    } catch (err) {
      if (isMissingRpc(err)) setNotOpen(true);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), LOBBY_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, roomId, reload]);
  return { lobby, notOpen, reload };
}
```

Create `hooks/useCardsController.ts` with exactly:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { useCardLobby } from "@/hooks/useCardLobby";
import { useCardTable, type CardTable } from "@/hooks/useCardTable";
import type { CardGame } from "@/lib/game/cards/deck";
import { CARDS_NOT_OPEN, hallLabel, turnToast } from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import { mySeat, type CardAnswer, type CardLobby, type CardState } from "@/lib/game/cards/state";
import type { Interactable, MapId } from "@/lib/game/maps/types";

export interface CardsControllerOptions {
  token: string;
  roomId: string;
  accountId: string;
  /** The map I am on: the lobby is polled only on the hall. */
  mapId: MapId;
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  isMember: (accountId: string) => boolean;
  /** My wallet changed at a table (the HUD reads the fishing state: fetch it again). */
  onCoinsChanged: () => void;
}

export interface CardsController {
  lobby: CardLobby | null;
  notOpen: boolean;
  /** The table panel's game; null = closed. */
  panel: CardGame | null;
  openPanel: (game: CardGame) => void;
  closePanel: () => void;
  /** 📜 Sổ luật: open on a game's tab, its examples at a stake. */
  rules: { game: CardGame; stake: number } | null;
  openRules: (game?: CardGame) => void;
  closeRules: () => void;
  /** The table the panel shows. */
  table: CardTable;
  /** Where I sit (a seat that is not leaving), and that table's hook. */
  seated: CardGame | null;
  seatTable: CardTable;
  /** A write at the panel's table; sitting and standing up refresh the hall's labels. */
  act: (a: CardAction) => Promise<CardAnswer | null>;
  /** Handles the card corner's interactables; false for anything else. */
  interact: (it: Interactable) => boolean;
}

/** My turn at this state, once per turn: the hand and the action count; null when it is not my turn. */
function turnKey(s: CardState | null, accountId: string): string | null {
  if (!s || s.turn === null || (s.phase !== "playing" && s.phase !== "deal_wait")) return null;
  const seat = mySeat(s, accountId);
  return seat && !seat.leaving && seat.seat === s.turn ? `${s.handNo}:${s.seq}` : null;
}

/** The card corner for the game shell (spec §13.1): the lobby and the hall's labels, the open panel and the rules book,
 *  the table I sit at (kept while the panel is closed) and the one I watch, and a toast once per turn while the panel
 *  is closed. */
export function useCardsController({ token, roomId, accountId, mapId, canvas, toast, isMember, onCoinsChanged }: CardsControllerOptions): CardsController {
  const [seatGame, setSeatGame] = useState<CardGame | null>(null);
  const [panel, setPanel] = useState<CardGame | null>(null);
  const [rules, setRules] = useState<{ game: CardGame; stake: number } | null>(null);

  // --- where I sit follows every state I see, and the lobby after a reload
  const onState = useCallback((g: CardGame, s: CardState) => {
    const seat = mySeat(s, accountId);
    if (seat && !seat.leaving) setSeatGame(g);
    else setSeatGame((cur) => (cur === g ? null : cur));
  }, [accountId]);
  const onLobby = useCallback((l: CardLobby) => {
    const t = l.tables.find((x) => x.seats.some((s) => s.id === accountId));
    if (t) setSeatGame((cur) => cur ?? t.game);
  }, [accountId]);
  const { lobby, notOpen, reload } = useCardLobby(roomId, token, mapId === "hall", onLobby);

  // --- two tables at most: the one I sit at (or else the panel's), and the panel's when it is another
  const primary = seatGame ?? panel;
  const secondary = panel !== null && panel !== primary ? panel : null;
  const common = { roomId, token, accountId, isMember, onError: toast, onCoins: onCoinsChanged, onState };
  const first = useCardTable({ ...common, game: primary, active: primary !== null });
  const second = useCardTable({ ...common, game: secondary, active: secondary !== null });
  const table = panel !== null && panel === secondary ? second : first;

  // --- the hall's labels over the tables
  useEffect(() => {
    if (!lobby) return;
    canvas()?.setCardTables(Object.fromEntries(lobby.tables.map((t) => [t.game, hallLabel(t)])));
  }, [lobby, canvas]);

  // --- a toast once per turn while that table's panel is closed
  const seatState = seatGame !== null && first.game === seatGame ? first.state : null;
  const myTurn = turnKey(seatState, accountId);
  const toasted = useRef<string | null>(null);
  useEffect(() => {
    if (!myTurn || !seatGame || panel === seatGame || toasted.current === myTurn) return;
    toasted.current = myTurn;
    toast(turnToast(seatGame));
  }, [myTurn, seatGame, panel, toast]);

  const act = useCallback(async (a: CardAction) => {
    const r = await table.act(a);
    if (r && (a.kind === "sit" || a.kind === "leave")) void reload();
    return r;
  }, [table, reload]);

  const stakeOf = useCallback((g: CardGame) => lobby?.tables.find((t) => t.game === g)?.stake ?? 1000, [lobby]);
  const openRules = useCallback((g?: CardGame) => {
    const game = g ?? seatGame ?? "tienlen";
    setRules({ game, stake: stakeOf(game) });
  }, [seatGame, stakeOf]);

  const interact = useCallback((it: Interactable): boolean => {
    if (it.kind !== "card_table" && it.kind !== "card_rules") return false;
    if (notOpen) {
      toast(CARDS_NOT_OPEN);
      return true;
    }
    if (it.kind === "card_table") {
      if (it.game) setPanel(it.game);
    } else {
      openRules();
    }
    return true;
  }, [notOpen, toast, openRules]);

  return useMemo(() => ({
    lobby, notOpen, panel, openPanel: setPanel, closePanel: () => setPanel(null), rules, openRules, closeRules: () => setRules(null),
    table, seated: seatGame, seatTable: first, act, interact,
  }), [lobby, notOpen, panel, rules, openRules, table, seatGame, first, act, interact]);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: the command of Step 2.
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint hooks/useCardLobby.ts hooks/useCardsController.ts tests/unit/use-cards-controller.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): useCardLobby and useCardsController — the hall's labels, the panel, the seated table, a toast once per turn

hooks/useCardLobby reads card_lobby every 20 s while on the hall. hooks/useCardsController owns the lobby, the open
panel and 📜 Sổ luật, keeps a table hook for the seat I hold and one for the panel I watch, follows where I sit from the
states it sees, and toasts "🃏 Đến lượt bạn ở bàn …!" once per turn while that panel is closed.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add hooks/useCardLobby.ts hooks/useCardsController.ts tests/unit/use-cards-controller.test.tsx
git commit -F <message file>
```

---

### Task 15: PlayingCard, CardHand, SitDialog and RulesBook — the pixel-font cards, my hand, the stake and buy-in, 📜 Sổ luật's tabs

**Files:**
- Create: `components/game/cards/PlayingCard.tsx`, `components/game/cards/CardHand.tsx`, `components/game/cards/SitDialog.tsx`, `components/game/cards/RulesBook.tsx`
- Test: `tests/unit/cards-components.test.tsx` (create)

**Interfaces:**
- Consumes: Tasks 8–11 (`cardAria`, `isRed`, `RANK_NAMES`, `SUIT_GLYPHS`, `pkBuyInRange`, `GAME_NAME`, `STAKES`, `stakeLine`, `PLAY_MONEY`, `holdLine`, `xuNum`, `signedXu`, `RULES_TABS`, `rulesPage`); `ParchmentModal` from `@/components/game/Parchment` (title, `onClose`, Esc, `className`).
- Produces (`components/game/cards/`):
  - `PlayingCard({card, faceDown?, selected?, size?: "normal" | "mini" | "tiny", onClick?, disabled?})` — a face (rank and suit in the pixel font, red for ♦ ♥), a back (a burgundy lattice), or a toggle button (`aria-pressed`, lifted when selected); `CardRow({cards, size?, label?})` (a `null` card is a back);
  - `CardHand({cards, selected?, onToggle?, hidden?, disabled?, label?})` — my cards in a row that scrolls on phones;
  - `sitNeeds(game, stake) → xu`, `SitDialog({game, seat, stake, coins, busy, onSit, onClose})` — the stake picker only while the table has no stake, the poker buy-in slider (50–200 BB within my xu, step one stake), what the seat holds, "Không đủ xu.", `PLAY_MONEY`, "Ngồi xuống" / "Thôi";
  - `RulesBook({initial, stake, onClose})` — 📜 Sổ luật: the header lines, a tab per game, each section with its card examples and money examples (`sm:max-w-2xl`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cards-components.test.tsx` with exactly:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CardHand from "@/components/game/cards/CardHand";
import PlayingCard from "@/components/game/cards/PlayingCard";
import RulesBook from "@/components/game/cards/RulesBook";
import SitDialog from "@/components/game/cards/SitDialog";
import { cardsOf } from "@/lib/game/cards/deck";

afterEach(cleanup);

describe("PlayingCard and CardHand (spec §13.2)", () => {
  it("draws a face with its aria label, red for hearts and diamonds, and a back without one", () => {
    render(<><PlayingCard card={cardsOf(["10H"])[0]} /><PlayingCard card={cardsOf(["AS"])[0]} /><PlayingCard card={null} /></>);
    expect(screen.getByRole("img", { name: "10 cơ" })).toHaveTextContent("10♥");
    expect(screen.getByRole("img", { name: "10 cơ" }).className).toContain("text-[#c0392b]");
    expect(screen.getByRole("img", { name: "A bích" }).className).not.toContain("text-[#c0392b]");
    expect(screen.getByRole("img", { name: "Lá úp" })).toHaveTextContent("");
  });

  it("toggles cards: a selected card is pressed and lifted; hidden cards stay face down", () => {
    const onToggle = vi.fn();
    const hand = cardsOf(["3S", "7D", "2H"]);
    render(<CardHand cards={hand} selected={[hand[1]]} hidden={[hand[2]]} onToggle={onToggle} />);
    const seven = screen.getByRole("button", { name: "7 rô" });
    expect(seven).toHaveAttribute("aria-pressed", "true");
    expect(seven.className).toContain("-translate-y-2");
    expect(screen.getByRole("button", { name: "3 bích" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Lá úp" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 bích" }));
    expect(onToggle).toHaveBeenCalledWith(hand[0]);
  });
});

describe("SitDialog (spec §13.2)", () => {
  it("offers the stake only at an empty table, with each hand's hold and the play-money line", () => {
    const onSit = vi.fn();
    const { unmount } = render(<SitDialog game="tienlen" seat={2} stake={null} coins={1_000_000} onSit={onSit} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "100 xu" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "10.000 xu" }));
    expect(screen.getByText("Mỗi ván giữ tạm 100.000 để trả thua — hết ván trả lại phần dư.")).toBeInTheDocument();
    expect(screen.getByText("🪙 Xu chỉ là điểm trong trò chơi — không mua bằng tiền thật, không đổi ra tiền thật.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ngồi xuống" }));
    expect(onSit).toHaveBeenCalledWith(10000, null);
    unmount();
    render(<SitDialog game="cao" seat={4} stake={1000} coins={50_000} onSit={onSit} onClose={() => {}} />);
    expect(screen.queryByRole("group", { name: "Mức cược" })).toBeNull();
    expect(screen.getByText("Mức cược 1.000 xu")).toBeInTheDocument();
    expect(screen.getByText("Mỗi ván giữ tạm 1.000; khi làm cái giữ 1.000 × số nhà con.")).toBeInTheDocument();
  });

  it("bounds poker's buy-in to 50–200 big blinds and the wallet", () => {
    const onSit = vi.fn();
    const { unmount } = render(<SitDialog game="poker" seat={1} stake={1000} coins={80_000} onSit={onSit} onClose={() => {}} />);
    const slider = screen.getByRole("slider", { name: "Mang vào bàn" });
    expect(slider).toHaveAttribute("min", "50000");
    expect(slider).toHaveAttribute("max", "80000");
    fireEvent.change(slider, { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ngồi xuống" }));
    expect(onSit).toHaveBeenCalledWith(1000, 60000);
    unmount();
    render(<SitDialog game="poker" seat={1} stake={1000} coins={40_000} onSit={onSit} onClose={() => {}} />);
    expect(screen.getByText("Không đủ xu.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ngồi xuống" })).toBeDisabled();
  });

  it("refuses a table the wallet cannot cover", () => {
    render(<SitDialog game="tienlen" seat={1} stake={1000} coins={9_999} onSit={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Ngồi xuống" })).toBeDisabled();
  });
});

describe("RulesBook (spec §14)", () => {
  it("opens on the table's tab, switches tabs, and shows the examples at the table's stake", () => {
    render(<RulesBook initial="cao" stake={100} onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Cào" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Bài đặc biệt" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Kết quả")[0]).toHaveTextContent("A +100 · B −200 · C +100 · D +100 · E −100");
    fireEvent.click(screen.getByRole("tab", { name: "Tiến lên" }));
    expect(screen.getByRole("heading", { name: "Luật đặc biệt" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Kết quả")).toHaveLength(4);
    const combos = screen.getByRole("heading", { name: "Các bộ" }).closest("section")!;
    expect(within(combos).getAllByRole("img", { name: "9 bích" }).length).toBeGreaterThan(0);
    expect(screen.getByText("🪙 Xu là điểm chơi trong Music Together — kiếm được khi câu cá, làm ruộng, điểm danh và nghe nhạc.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/cards-components.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/game/cards/…"` (the components do not exist yet).

- [ ] **Step 3: Write the four components**

Create `components/game/cards/PlayingCard.tsx` with exactly:

```tsx
"use client";

import { cardAria, isRed, RANK_NAMES, rankOf, SUIT_GLYPHS, suitOf, type Card } from "@/lib/game/cards/deck";

/** The card sizes (spec §13.2): 40 × 56 (32 × 46 on phones), a mini size for the rules book and the pile, and a tiny
 *  one for the backs at the seats. */
const SIZE = {
  normal: "h-[46px] w-8 text-base sm:h-14 sm:w-10 sm:text-lg",
  mini: "h-[34px] w-6 text-sm",
  tiny: "h-[22px] w-4 text-[10px]",
} as const;

/** The back: burgundy with a gold lattice (CSS gradients). */
const BACK = {
  backgroundColor: "#6e2233",
  backgroundImage: "repeating-linear-gradient(45deg, rgb(224 179 60 / 0.55) 0 1px, transparent 1px 5px), "
    + "repeating-linear-gradient(-45deg, rgb(224 179 60 / 0.55) 0 1px, transparent 1px 5px)",
} as const;

/** A playing card in the pixel font: parchment face, red for ♥ ♦, the rank over the suit; or its back. As a button
 *  (`onClick`) it is a toggle: a selected card lifts 8 px. */
export default function PlayingCard({ card, faceDown = false, selected = false, size = "normal", onClick, disabled }: {
  card: Card | null;
  faceDown?: boolean;
  selected?: boolean;
  size?: keyof typeof SIZE;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const hidden = faceDown || card === null;
  const face = hidden ? null : (
    <>
      <span className="leading-none">{RANK_NAMES[rankOf(card)]}</span>
      <span className="leading-none">{SUIT_GLYPHS[suitOf(card)]}</span>
    </>
  );
  const look = `${SIZE[size]} inline-flex shrink-0 select-none flex-col items-center justify-center rounded-[3px] border-2 border-ink/70 font-vt `
    + `shadow-[1px_1px_0_rgb(58_36_24_/_0.35)] motion-safe:transition-transform motion-safe:duration-150 `
    + `${hidden ? "" : `bg-cream ${isRed(card) ? "text-[#c0392b]" : "text-ink"}`} ${selected ? "-translate-y-2" : ""}`;
  const label = hidden ? "Lá úp" : cardAria(card);
  if (onClick) {
    return (
      <button type="button" className={look} style={hidden ? BACK : undefined} aria-label={label} aria-pressed={selected}
        disabled={disabled} onClick={onClick}>
        {face}
      </button>
    );
  }
  return (
    <span className={look} style={hidden ? BACK : undefined} role="img" aria-label={label}>
      {face}
    </span>
  );
}

/** Cards in a row (a pile, a board, a shown hand). */
export function CardRow({ cards, size = "mini", label }: { cards: readonly (Card | null)[]; size?: keyof typeof SIZE; label?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5" aria-label={label}>
      {cards.map((c, i) => <PlayingCard key={c ?? `back${i}`} card={c} size={size} />)}
    </span>
  );
}
```

Create `components/game/cards/CardHand.tsx` with exactly:

```tsx
"use client";

import type { Card } from "@/lib/game/cards/deck";
import PlayingCard from "./PlayingCard";

/** My hand (spec §13.2): the cards in a row that scrolls sideways on phones. With `onToggle` each card is a toggle and
 *  the selection is always a set of the cards shown; `hidden` keeps some face down (Cào's nặn bài). */
export default function CardHand({ cards, selected = [], onToggle, hidden = [], disabled, label = "Bài của bạn" }: {
  cards: readonly Card[];
  selected?: readonly Card[];
  onToggle?: (card: Card) => void;
  hidden?: readonly Card[];
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto px-1 pb-1 pt-3" role="group" aria-label={label}>
      {cards.map((c) => (
        <PlayingCard
          key={c}
          card={c}
          faceDown={hidden.includes(c)}
          selected={selected.includes(c)}
          disabled={disabled}
          onClick={onToggle ? () => onToggle(c) : undefined}
        />
      ))}
    </div>
  );
}
```

Create `components/game/cards/SitDialog.tsx` with exactly:

```tsx
"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import type { CardGame } from "@/lib/game/cards/deck";
import { GAME_NAME, holdLine, PLAY_MONEY, STAKES, stakeLine, xuNum } from "@/lib/game/cards/messages";
import { pkBuyInRange } from "@/lib/game/cards/poker";

/** What sitting needs in the wallet (§6.1): Tiến lên 10 S, Cào S, poker the buy-in (at least 50 BB). */
export function sitNeeds(game: CardGame, stake: number): number {
  return game === "tienlen" ? 10 * stake : game === "cao" ? stake : 50 * stake;
}

/** Sitting down (spec §13.2): the stake picker only at an empty table, what each hand holds (or poker's buy-in slider,
 *  50–200 big blinds), and the play-money line. */
export default function SitDialog({ game, seat, stake, coins, busy, onSit, onClose }: {
  game: CardGame;
  seat: number;
  /** The table's stake; null while the table is empty (the first to sit picks it). */
  stake: number | null;
  /** My wallet (null: not loaded yet — the server checks). */
  coins: number | null;
  busy?: boolean;
  onSit: (stake: number, buyin: number | null) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(1000);
  const s = stake ?? picked;
  const wallet = coins ?? Number.MAX_SAFE_INTEGER;
  const range = game === "poker" ? pkBuyInRange(s, wallet) : null;
  const [bb, setBb] = useState(100);
  const buyin = range ? Math.min(range.max, Math.max(range.min, bb * s)) : null;
  const enough = game === "poker" ? range !== null : wallet >= sitNeeds(game, s);
  return (
    <ParchmentModal title={`🪑 Ngồi ghế ${seat} · ${GAME_NAME[game]}`} onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {stake === null ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Mức cược">
            <span>Chọn mức cược:</span>
            {STAKES.map((x) => (
              <button key={x} type="button" className="pch-btn" aria-pressed={picked === x} onClick={() => setPicked(x)}>
                {`${xuNum(x)} xu`}
              </button>
            ))}
          </div>
        ) : (
          <p>{stakeLine(game, stake)}</p>
        )}
        {game === "poker" ? (
          <label className="flex flex-col gap-1">
            <span>Mang vào bàn:</span>
            {range && (
              <>
                <input type="range" aria-label="Mang vào bàn" min={range.min} max={range.max} step={s}
                  value={buyin ?? range.min} onChange={(e) => setBb(Math.round(Number(e.target.value) / s))} />
                <span>{`${Math.round((buyin ?? range.min) / s)} lần mù lớn · ${xuNum(buyin ?? range.min)} xu (50–200 lần mù lớn)`}</span>
              </>
            )}
          </label>
        ) : (
          <p>{holdLine(game, s)}</p>
        )}
        {!enough && <p className="text-burgundy">Không đủ xu.</p>}
        <p className="text-base opacity-80">{PLAY_MONEY}</p>
        <div className="flex justify-end gap-1">
          <button type="button" className="pch-btn" onClick={onClose}>Thôi</button>
          <button type="button" className="pch-btn pch-btn-primary" disabled={!enough || busy} onClick={() => onSit(s, game === "poker" ? buyin : null)}>
            Ngồi xuống
          </button>
        </div>
      </div>
    </ParchmentModal>
  );
}
```

Create `components/game/cards/RulesBook.tsx` with exactly:

```tsx
"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import type { CardGame } from "@/lib/game/cards/deck";
import { signedXu } from "@/lib/game/cards/messages";
import { RULES_TABS, rulesPage, type RuleLine } from "@/lib/game/cards/rules";
import { CardRow } from "./PlayingCard";

function Line({ line }: { line: RuleLine }) {
  return (
    <>
      {line.map((seg, i) => (typeof seg === "string" ? <span key={i}>{seg}</span> : <CardRow key={i} cards={seg.cards} />))}
    </>
  );
}

/** 📜 Sổ luật (spec §14): a tab per game, opened on the current table's, its money examples at that table's stake. */
export default function RulesBook({ initial, stake, onClose }: { initial: CardGame; stake: number; onClose: () => void }) {
  const [tab, setTab] = useState<CardGame>(initial);
  const page = rulesPage(tab, stake);
  return (
    // sm:, because ParchmentModal's own max-w-lg comes later in Tailwind's output than a plain max-w-2xl
    <ParchmentModal title="📜 Sổ luật" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Sổ luật" className="flex flex-wrap gap-1">
          {RULES_TABS.map((t) => (
            <button key={t.game} type="button" role="tab" aria-selected={tab === t.game}
              className={`pch-btn ${tab === t.game ? "pch-btn-primary" : ""}`} onClick={() => setTab(t.game)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 rounded-sm bg-parchment-200 p-1.5 text-base">
          {page.header.map((h) => <p key={h}>{h}</p>)}
        </div>
        <div role="tabpanel" className="flex flex-col gap-2">
          {page.sections.map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
              <h3 className="text-xl text-burgundy">{sec.title}</h3>
              <ul className="flex flex-col gap-1">
                {sec.lines.map((l, i) => <li key={i} className="flex flex-wrap items-center gap-x-1"><Line line={l} /></li>)}
              </ul>
              {sec.examples.map((e) => (
                <div key={e.title} className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5">
                  <h4 className="text-burgundy">{e.title}</h4>
                  {e.lines.map((l, i) => <p key={i} className="flex flex-wrap items-center gap-x-1"><Line line={l} /></p>)}
                  <p aria-label="Kết quả">{e.net.map((n) => `${n.who} ${signedXu(n.xu)}`).join(" · ")}</p>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </ParchmentModal>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: the command of Step 2.
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/cards/PlayingCard.tsx components/game/cards/CardHand.tsx components/game/cards/SitDialog.tsx components/game/cards/RulesBook.tsx tests/unit/cards-components.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): PlayingCard, CardHand, SitDialog and RulesBook — the pixel-font cards, my hand, the stake and buy-in, 📜 Sổ luật's tabs

components/game/cards: PlayingCard (the face, the back, or a toggle button; three sizes) and CardRow; CardHand (my cards
in a row, each a toggle, some kept face down for nặn bài); SitDialog (the stake on an empty table, the poker buy-in
slider, the escrow and xu lines, the play-money note); RulesBook (a tab per game).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/cards/CardHand.tsx components/game/cards/PlayingCard.tsx components/game/cards/RulesBook.tsx components/game/cards/SitDialog.tsx tests/unit/cards-components.test.tsx
git commit -F <message file>
```

---

### Task 16: The table panel — the seats around the felt, the status line; the Tiến lên, Cào and poker boards

**Files:**
- Create: `components/game/cards/TienLenBoard.tsx`, `components/game/cards/CaoBoard.tsx`, `components/game/cards/PokerBoard.tsx`, `components/game/cards/CardTablePanel.tsx`
- Test: `tests/unit/cards-panel.test.tsx` (create)

**Interfaces:**
- Consumes: Tasks 8–15 (`tlCombo`, `tlBeats`, `tlLegalPlays`, `tlSlams`, `tlArrange`, `pkEval`, `pkHandName`, `pkLegal`, `pkPots`, `pkPresets`, `pkTopUpRange`, the texts, `CardAction`, `mySeat`, `inHand`, `secondsLeft`, `CardTable`, `PlayingCard` / `CardRow` / `CardHand`, `SitDialog`); `serverNow()`; `ConfirmButton` from `@/components/game/farm/ConfirmButton`; `ParchmentModal`.
- Produces (`components/game/cards/`):
  - `comboName(combo)`, `playBlocker(state, mine, cards, selection) → string | null` (why Đánh is off: not my turn, not a combination, cannot beat, the first lead's `must`), `TienLenBoard({state, cards, mine, busy, act, name})` — the top and the cut banner, my hand with selection, Đánh, Bỏ lượt, Bỏ chọn, 💡 Gợi ý (cycles `tlLegalPlays`), Xếp bài, 💣 Chặt! (only when `tlSlams` has one), the result lines;
  - `CaoBoard({state, cards, mine, busy, act, name})` — the dealer line or `NO_DEALER`, the leavers, 🃏 Chia bài for the previewed dealer only, nặn bài (my cards face down until turned), the showdown with each hand's name and the nets, `CANCELLED`;
  - `PokerBoard({state, cards, mine, coins, busy, act, name})` — the board, the pot and side pots, my cards and "Bạn đang có: …", Úp bài, Xem bài or Theo, Cược or Tố lên with its slider ("Mức cược" / "Mức tố", bounded by `pkLegal`) and Tối thiểu / ½ pot / Pot, Tất tay, "Nạp thêm" between my hands, the showdown;
  - `ringOrder(max, bottom)`, `CardTablePanel({game, table, me, coins, act, onOpenRules, onClose})` — the title, the stake and my xu, 📜 Sổ luật, the seats around the felt (me at the bottom; a scrolling row on phones) with their chips or balances, card backs, places and timers, "Ngồi đây" → `SitDialog`, "Đứng dậy" (with `LEAVE_CONFIRM` in a live hand; disabled for the Cào dealer during `peek`), the status line with its countdown (a 1 s clock), 👀 Đang xem for a spectator, and the game's board; `sm:max-w-3xl`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/cards-panel.test.tsx` with exactly:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CardTablePanel, { ringOrder } from "@/components/game/cards/CardTablePanel";
import type { CardTable } from "@/hooks/useCardTable";
import type { CardGame } from "@/lib/game/cards/deck";
import type { CardHand, CardState } from "@/lib/game/cards/state";
import { syncClock } from "@/lib/game/farm/clock";
import { caoRaw, cs, ID, parsed, pkRaw, seatRaw, T0, tlRaw } from "./helpers/card-states";

beforeEach(() => syncClock(T0, Date.now()));
afterEach(cleanup);

const handOf = (game: CardGame, seat: number, codes: string[], handNo = 3): CardHand =>
  ({ serverNow: Date.parse(T0), game, handNo, seat, cards: cs(...codes) });
const tableOf = (state: CardState, hand: CardHand | null = null): CardTable => ({
  game: state.game, state, hand, failed: false, notOpen: false, busy: false,
  refetch: async () => {}, tick: async () => {}, act: async () => null,
});
function show(state: CardState, me: string, hand: CardHand | null = null, act = vi.fn(async () => null)) {
  render(<CardTablePanel game={state.game} table={tableOf(state, hand)} me={me} coins={500_000} act={act} onOpenRules={() => {}}
    onClose={() => {}} />);
  return act;
}

describe("CardTablePanel (spec §13.2)", () => {
  it("draws my seat at the bottom, the others counter-clockwise", () => {
    expect(ringOrder(4, 3)).toEqual([3, 4, 1, 2]);
    expect(ringOrder(6, 1)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("a spectator sees no hand and no actions", () => {
    show(parsed(tlRaw()), ID[5]);
    expect(screen.getByText("👀 Đang xem")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Bài của bạn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Đánh" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Lượt An · 15s");
    expect(within(screen.getByLabelText("Ghế 2")).getByText("13 lá")).toBeInTheDocument();
  });

  it("disables Đánh for an illegal selection and plays a legal one with the table's seq", () => {
    const state = parsed(tlRaw({}, { top: { type: "pair", len: 2, key: cs("9H")[0], cards: cs("9S", "9H"), seat: 4, done: false } }));
    const act = show(state, ID[0], handOf("tienlen", 1, ["3S", "7D", "JC", "JH", "2H"]));
    expect(screen.getByRole("status")).toHaveTextContent("Đến lượt bạn! 15s");
    const play = screen.getByRole("button", { name: "Đánh" });
    expect(play).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "3 bích" }));
    expect(play).toBeDisabled();
    expect(screen.getByText("Bài này không chặn được.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 bích" }));
    fireEvent.click(screen.getByRole("button", { name: "J chuồn" }));
    fireEvent.click(screen.getByRole("button", { name: "J cơ" }));
    expect(play).toBeEnabled();
    fireEvent.click(play);
    expect(act).toHaveBeenCalledWith({ kind: "tl_play", seq: 5, cards: cs("JC", "JH") });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lượt" }));
    expect(act).toHaveBeenLastCalledWith({ kind: "tl_pass", seq: 5 });
  });

  it("a first lead must include `must`; Gợi ý picks a legal play", () => {
    const state = parsed(tlRaw({}, { first: true, must: cs("3C")[0] }));
    show(state, ID[0], handOf("tienlen", 1, ["3C", "5D", "5H", "KS"]));
    expect(screen.getByRole("button", { name: "Bỏ lượt" })).toBeDisabled();
    expect(screen.getByLabelText("Giữa bàn")).toHaveTextContent("Ván đầu phải đánh kèm lá 3♣.");
    fireEvent.click(screen.getByRole("button", { name: "K bích" }));
    expect(screen.getByRole("button", { name: "Đánh" })).toHaveAttribute("title", "Ván đầu phải đánh kèm lá 3♣.");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    fireEvent.click(screen.getByRole("button", { name: "💡 Gợi ý" }));
    expect(screen.getByRole("button", { name: "3 chuồn" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Đánh" })).toBeEnabled();
  });

  it("shows 💣 Chặt! only out of turn, with a 4 đôi thông that beats the top", () => {
    const slam = ["4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H", "9S"];
    const over = (top: string[], key: string, turn = 1) =>
      parsed(tlRaw({ turn }, { top: { type: "single", len: 1, key: cs(key)[0], cards: cs(...top), seat: 2, done: false } }));
    const act = show(over(["2H"], "2H"), ID[2], handOf("tienlen", 3, slam));
    fireEvent.click(screen.getByRole("button", { name: "💣 Chặt!" }));
    expect(act).toHaveBeenCalledWith({ kind: "tl_play", seq: 5, cards: cs("4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H") });
    cleanup();
    show(over(["8C"], "8C"), ID[2], handOf("tienlen", 3, slam));
    expect(screen.queryByRole("button", { name: "💣 Chặt!" })).toBeNull();
    cleanup();
    show(over(["2H"], "2H", 3), ID[2], handOf("tienlen", 3, slam));
    expect(screen.queryByRole("button", { name: "💣 Chặt!" })).toBeNull();
  });

  it("bounds the poker slider and names my hand", () => {
    const state = parsed(pkRaw({ turn: 1, seats: [seatRaw(1, { chips: 10_000 }), seatRaw(2, { chips: 50_000 }), seatRaw(3, { chips: 50_000 })] }, {
      street: "flop", board: cs("KD", "7C", "2S"), cur: 4000, raise: 4000, pot: 9000,
      players: {
        1: { id: ID[0], bet: 0, put: 1000, fold: false, allin: false, acted: null, pending: true, last: null },
        2: { id: ID[1], bet: 4000, put: 5000, fold: false, allin: false, acted: 4000, pending: false, last: "bet" },
        3: { id: ID[2], bet: 0, put: 1000, fold: true, allin: false, acted: null, pending: false, last: "fold" },
      },
    }));
    const act = show(state, ID[0], handOf("poker", 1, ["KS", "KH"]));
    expect(screen.getByText("Bạn đang có: Sám K")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Mức tố" });
    expect(slider).toHaveAttribute("min", "8000");
    expect(slider).toHaveAttribute("max", "10000");
    fireEvent.click(screen.getByRole("button", { name: "Pot" }));
    fireEvent.click(screen.getByRole("button", { name: "Tố lên 10.000" }));
    expect(act).toHaveBeenLastCalledWith({ kind: "pk_act", seq: 5, action: "raise", amount: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Theo 4.000" }));
    expect(act).toHaveBeenLastCalledWith({ kind: "pk_act", seq: 5, action: "call", amount: null });
    expect(within(screen.getByLabelText("Ghế 3")).getByText("Úp bài")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Ghế 1")).getByText("D")).toBeInTheDocument();
  });

  it("shows 🃏 Chia bài only to the dealer, and keeps the dealer seated during the peek", () => {
    const wait = (dealer: number) => parsed(caoRaw({ phase: "deal_wait", turn: dealer }, { dealer, order: [] }));
    const act = show(wait(1), ID[0]);
    fireEvent.click(screen.getByRole("button", { name: "🃏 Chia bài" }));
    expect(act).toHaveBeenCalledWith({ kind: "cao_deal", seq: 5 });
    cleanup();
    show(wait(2), ID[0]);
    expect(screen.queryByRole("button", { name: "🃏 Chia bài" })).toBeNull();
    cleanup();
    show(parsed(caoRaw({}, { dealer: 1 })), ID[0], handOf("cao", 1, ["9S", "8C", "2H"]));
    expect(screen.getByRole("button", { name: /Đứng dậy/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Lật bài sau 15 giây");
    fireEvent.click(screen.getByRole("button", { name: "Nặn bài" }));
    fireEvent.click(screen.getByRole("button", { name: "Nặn bài" }));
    fireEvent.click(screen.getByRole("button", { name: "Nặn bài" }));
    expect(screen.getByText("9 nút")).toBeInTheDocument();
  });

  it("asks before standing up in a live hand; offers the empty seats to a spectator", () => {
    const act = show(parsed(tlRaw()), ID[0], handOf("tienlen", 1, ["3S"]));
    fireEvent.click(screen.getByRole("button", { name: "Đứng dậy" }));
    expect(screen.getByText(/Rời bàn giữa ván sẽ bị xử thua… Hết ván này bạn mới ngồi lại được\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(act).toHaveBeenCalledWith({ kind: "leave" });
    cleanup();
    show(parsed(tlRaw({ phase: "idle", turn: null, deadline: null, seats: [seatRaw(2)] }, {})), ID[0]);
    expect(screen.getAllByRole("button", { name: "Ngồi đây" })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Ngồi đây" })[0]);
    expect(screen.getByRole("dialog", { name: "🪑 Ngồi ghế 1 · Tiến lên" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mức cược" })).toBeNull();
  });

  it("shows the result: the places, the lines and the nets; a cancelled Cào hand", () => {
    show(parsed(tlRaw({ phase: "result", turn: null, last: {
      hand_no: 3, trang: null, places: [1, 2, 3, 4], out: { 1: "done", 2: "done", 3: "done" }, hands: { 4: cs("2S") },
      lines: [{ from: 4, to: 1, xu: 1000, paid: 1000, why: "bet" }, { from: 4, to: 3, xu: 500, paid: 500, why: "thoi" }],
      net: { 1: 1000, 2: 0, 3: 500, 4: -1500 },
    } })), ID[5]);
    const result = screen.getByLabelText("Kết quả ván");
    expect(within(result).getByText("Thối heo: Dũng trả Chi 500")).toBeInTheDocument();
    expect(within(result).getByText("An +1.000 · Bình 0 · Chi +500 · Dũng −1.500")).toBeInTheDocument();
    cleanup();
    show(parsed(caoRaw({ phase: "result", last: { hand_no: 3, dealer: 2, cancelled: true, hands: {}, lines: [], net: { 1: 0, 2: 0, 3: 0 } } })), ID[5]);
    expect(screen.getByText("Ván huỷ — đã trả lại tiền giữ")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm vitest run tests/unit/cards-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "@/components/game/cards/CardTablePanel"`.

- [ ] **Step 3: Write the boards and the panel**

Create `components/game/cards/TienLenBoard.tsx` with exactly:

```tsx
"use client";

import { useState } from "react";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { Card } from "@/lib/game/cards/deck";
import { cutBanner, mustText, signedXu, tlResultLines } from "@/lib/game/cards/messages";
import type { CardSeat, TlState } from "@/lib/game/cards/state";
import { tlArrange, tlBeats, tlCombo, tlLegalPlays, tlSlams, type TlCombo } from "@/lib/game/cards/tienlen";
import CardHand from "./CardHand";
import { CardRow } from "./PlayingCard";

/** "Rác", "Đôi", "Sám cô", "Tứ quý", "Sảnh 5 lá", "3 đôi thông". */
export function comboName(x: Pick<TlCombo, "type" | "len">): string {
  switch (x.type) {
    case "single": return "Rác";
    case "pair": return "Đôi";
    case "triple": return "Sám cô";
    case "quad": return "Tứ quý";
    case "straight": return `Sảnh ${x.len} lá`;
    case "pairs": return `${x.len} đôi thông`;
  }
}

/** Why "Đánh" cannot play this selection, or null when it can (§7.3; the server decides). */
export function playBlocker(s: TlState, mine: CardSeat | null, cards: readonly Card[], selection: readonly Card[]): string | null {
  const pub = s.pub;
  if (s.phase !== "playing" || !pub || !mine) return "Chưa tới lúc làm việc này.";
  const me = pub.players[mine.seat];
  if (!me || me.id !== mine.id || me.out !== null) return "Chưa tới lượt bạn.";
  if (selection.length === 0) return "Chọn bài để đánh.";
  const x = tlCombo(selection);
  if (!x || !selection.every((c) => cards.includes(c))) return "Bộ bài không hợp lệ.";
  if (s.turn === mine.seat) {
    if (!pub.top) return pub.must !== null && !selection.includes(pub.must) ? mustText(pub.must) : null;
    return tlBeats(pub.top, x) ? null : "Bài này không chặn được.";
  }
  // out of turn only a 4 đôi thông that beats the top (R9)
  if (x.type !== "pairs" || x.len !== 4 || !pub.top || pub.top.seat === mine.seat) return "Chưa tới lượt bạn.";
  return tlBeats(pub.top, x) ? null : "Bài này không chặn được.";
}

/** Tiến lên's centre, my hand and my buttons (spec §13.2): the round's pile, the top's name and a cut banner; Đánh,
 *  Bỏ lượt, Bỏ chọn, 💡 Gợi ý and 💣 Chặt!; the result with its lines. */
export default function TienLenBoard({ state, cards, mine, busy, act, name }: {
  state: TlState;
  /** My cards in this hand (none for a spectator). */
  cards: readonly Card[];
  mine: CardSeat | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const pub = state.pub;
  const [picked, setPicked] = useState<Card[]>([]);
  const [mode, setMode] = useState<"rank" | "group">("rank");
  const [hint, setHint] = useState(0);
  const selection = picked.filter((c) => cards.includes(c));
  const playing = state.phase === "playing" && pub !== null;
  const myTurn = playing && mine !== null && state.turn === mine.seat;
  const meP = pub && mine ? pub.players[mine.seat] : undefined;
  const active = playing && meP !== undefined && meP.id === mine?.id && meP.out === null;
  const blocker = playBlocker(state, mine, cards, selection);
  const top = pub?.top ?? null;
  const slams = active && !myTurn && top && top.seat !== mine?.seat ? tlSlams(cards, top) : [];
  const toggle = (c: Card) => setPicked((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const play = (sel: readonly Card[]) => {
    act({ kind: "tl_play", seq: state.seq, cards: [...sel] });
    setPicked([]);
  };
  const suggest = () => {
    const plays = tlLegalPlays(cards, top, pub?.must ?? null);
    if (plays.length === 0) return;
    setPicked(plays[hint % plays.length].cards);
    setHint(hint + 1);
  };
  const last = state.phase === "result" ? state.last : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-16 flex-col items-center gap-1 rounded-sm bg-[#1f5a3a]/10 p-1.5" aria-label="Giữa bàn">
        {pub?.chain && <p className="text-xl text-burgundy">{cutBanner(name(pub.chain.cutter), name(pub.chain.victim))}</p>}
        {top && <p>{`${name(top.seat)}: ${comboName(top)}`}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          {(pub?.pile ?? []).map((p, i) => (
            <span key={i} className="flex items-center gap-1 text-base"><span>{name(p.seat)}</span><CardRow cards={p.cards} /></span>
          ))}
        </div>
        {playing && pub.must !== null && !top && <p className="text-base">{mustText(pub.must)}</p>}
      </div>
      {last && (
        <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5" aria-label="Kết quả ván">
          {last.places.map((s, i) => <p key={s}>{`${i + 1}. ${name(s)}`}</p>)}
          {tlResultLines(last, name).map((l, i) => <p key={i} className="text-base">{l}</p>)}
          <p>{Object.entries(last.net).map(([s, xu]) => `${name(Number(s))} ${signedXu(xu)}`).join(" · ")}</p>
          {Object.entries(last.hands).map(([s, cs]) => (
            <span key={s} className="flex items-center gap-1 text-base"><span>{name(Number(s))}</span><CardRow cards={cs} /></span>
          ))}
        </div>
      )}
      {cards.length > 0 && (
        <>
          <CardHand cards={tlArrange(cards, mode)} selected={selection} onToggle={toggle} disabled={busy} />
          <div className="flex flex-wrap gap-1">
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy || blocker !== null} title={blocker ?? undefined}
              onClick={() => play(selection)}>
              Đánh
            </button>
            <button type="button" className="pch-btn" disabled={busy || !myTurn || !top}
              title={myTurn && !top ? "Bạn đang mở vòng — phải đánh." : undefined}
              onClick={() => act({ kind: "tl_pass", seq: state.seq })}>
              Bỏ lượt
            </button>
            <button type="button" className="pch-btn" disabled={selection.length === 0} onClick={() => setPicked([])}>Bỏ chọn</button>
            <button type="button" className="pch-btn" disabled={!myTurn} onClick={suggest}>💡 Gợi ý</button>
            <button type="button" className="pch-btn" onClick={() => setMode(mode === "rank" ? "group" : "rank")}>Xếp bài</button>
            {slams.length > 0 && (
              <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => play(slams[0].cards)}>💣 Chặt!</button>
            )}
          </div>
          {selection.length > 0 && blocker && <p className="text-base text-burgundy">{blocker}</p>}
        </>
      )}
    </div>
  );
}
```

Create `components/game/cards/CaoBoard.tsx` with exactly:

```tsx
"use client";

import { useState } from "react";
import type { Card } from "@/lib/game/cards/deck";
import { CANCELLED, caoHandName, NO_DEALER, signedXu, xuNum } from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { CaoState, CardSeat } from "@/lib/game/cards/state";
import CardHand from "./CardHand";
import { CardRow } from "./PlayingCard";

/** Cào's centre, my three cards and the dealer's button (spec §13.2): the dealer, nặn bài (local, one card at a time),
 *  then every hand with its nút. "Lật bài sau {n} giây" is the panel's status line. */
export default function CaoBoard({ state, cards, mine, busy, act, name }: {
  state: CaoState;
  cards: readonly Card[];
  mine: CardSeat | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const pub = state.pub;
  // nặn bài: how many of my cards I have turned, for this hand
  const [turned, setTurned] = useState<{ hand: number; n: number }>({ hand: -1, n: 0 });
  const shown = turned.hand === state.handNo ? turned.n : 0;
  const dealer = pub?.dealer ?? null;
  const iDeal = state.phase === "deal_wait" && mine !== null && dealer === mine.seat;
  const last = state.phase === "result" ? state.last : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-16 flex-col items-center gap-1 rounded-sm bg-[#1f5a3a]/10 p-1.5" aria-label="Giữa bàn">
        {dealer !== null && <p>{`Nhà cái: ${name(dealer)}`}</p>}
        {state.phase === "deal_wait" && pub?.note === "no_dealer" && <p className="text-burgundy">{NO_DEALER}</p>}
        {(pub?.left ?? []).length > 0 && state.phase === "peek" && (
          <p className="text-base">{`Rời bàn: ${pub!.left.map(name).join(", ")} — mỗi người mất ${xuNum(state.stake ?? 0)} cho cái`}</p>
        )}
      </div>
      {last && (
        <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5" aria-label="Kết quả ván">
          {last.cancelled && <p className="text-burgundy">{CANCELLED}</p>}
          {Object.entries(last.hands).map(([s, h]) => (
            <span key={s} className="flex flex-wrap items-center gap-1">
              <span>{`${name(Number(s))}${Number(s) === last.dealer ? " (cái)" : ""}`}</span>
              <CardRow cards={h.cards} />
              <span>{caoHandName(h.cards)}</span>
            </span>
          ))}
          <p>{Object.entries(last.net).map(([s, xu]) => `${name(Number(s))} ${signedXu(xu)}`).join(" · ")}</p>
        </div>
      )}
      {cards.length > 0 && state.phase === "peek" && (
        <>
          <CardHand cards={cards} hidden={cards.slice(shown)} label="Bài của bạn" />
          <div className="flex flex-wrap items-center gap-1">
            {shown < cards.length ? (
              <button type="button" className="pch-btn" onClick={() => setTurned({ hand: state.handNo, n: shown + 1 })}>Nặn bài</button>
            ) : (
              <span className="text-xl">{caoHandName(cards)}</span>
            )}
          </div>
        </>
      )}
      {iDeal && (
        <div className="flex gap-1">
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => act({ kind: "cao_deal", seq: state.seq })}>
            🃏 Chia bài
          </button>
        </div>
      )}
    </div>
  );
}
```

Create `components/game/cards/PokerBoard.tsx` with exactly:

```tsx
"use client";

import { useState } from "react";
import type { Card } from "@/lib/game/cards/deck";
import { signedXu, xuNum } from "@/lib/game/cards/messages";
import { pkEval, pkHandName, pkLegal, pkPots, pkPresets, pkTopUpRange, type PkOptions } from "@/lib/game/cards/poker";
import type { CardAction } from "@/lib/game/cards/rpc";
import type { CardSeat, PkState } from "@/lib/game/cards/state";
import CardHand from "./CardHand";
import { CardRow } from "./PlayingCard";

/** The bet or raise slider (§13.2): bounded by what the server takes, with Tối thiểu, ½ pot and Pot. */
function BetControls({ o, presets, busy, bet, onAct }: {
  o: PkOptions;
  presets: { min: number; half: number; pot: number };
  busy: boolean;
  /** The last amount chosen (null: the minimum). */
  bet: [number | null, (n: number) => void];
  onAct: (action: "bet" | "raise", to: number) => void;
}) {
  const [chosen, setChosen] = bet;
  const to = Math.min(o.max, Math.max(o.min, chosen ?? o.min));
  const action = o.canBet ? "bet" : "raise";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <input type="range" aria-label={o.canBet ? "Mức cược" : "Mức tố"} min={o.min} max={o.max} step={1} value={to}
        onChange={(e) => setChosen(Number(e.target.value))} />
      <button type="button" className="pch-btn" onClick={() => setChosen(presets.min)}>Tối thiểu</button>
      <button type="button" className="pch-btn" onClick={() => setChosen(presets.half)}>½ pot</button>
      <button type="button" className="pch-btn" onClick={() => setChosen(presets.pot)}>Pot</button>
      <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => onAct(action, to)}>
        {o.canBet ? `Cược ${xuNum(to)}` : `Tố lên ${xuNum(to)}`}
      </button>
    </div>
  );
}

/** Poker's centre, my two cards and my buttons (spec §13.2): the board, the pot and the side pots; Úp bài, Xem bài or
 *  Theo, Cược or Tố lên with its slider, Tất tay; a top-up between my hands; the showdown. */
export default function PokerBoard({ state, cards, mine, coins, busy, act, name }: {
  state: PkState;
  cards: readonly Card[];
  mine: CardSeat | null;
  coins: number | null;
  busy: boolean;
  act: (a: CardAction) => void;
  name: (seat: number) => string;
}) {
  const pub = state.pub;
  const stake = state.stake ?? 0;
  const [amount, setAmount] = useState<{ v: number; n: number | null }>({ v: -1, n: null });
  const chosen = amount.v === state.v ? amount.n : null;
  const [topup, setTopup] = useState<number | null>(null);
  const playing = state.phase === "playing" && pub !== null;
  const me = playing && mine ? pub.players[mine.seat] : undefined;
  const inHand = me !== undefined && me.id === mine?.id;
  const myTurn = playing && inHand && state.turn === mine?.seat && !me.fold && !me.allin;
  const spot = myTurn && mine && pub ? { cur: pub.cur, raise: pub.raise, bet: me.bet, acted: me.acted, chips: mine.chips, stake } : null;
  const o = spot ? pkLegal(spot) : null;
  const pots = playing ? pkPots({ players: pub.players, button: pub.button }) : [];
  const board = pub?.board ?? [];
  const made = cards.length > 0 ? pkHandName(pkEval([...cards, ...board])) : null;
  const room = mine && !inHand ? pkTopUpRange(stake, mine.chips, coins ?? Number.MAX_SAFE_INTEGER) : null;
  const top = room ? Math.min(room.max, Math.max(room.min, topup ?? room.max)) : 0;
  const last = state.phase === "result" ? state.last : null;
  const pk = (action: "fold" | "check" | "call" | "bet" | "raise" | "allin", to: number | null = null) =>
    act({ kind: "pk_act", seq: state.seq, action, amount: to });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-16 flex-col items-center gap-1 rounded-sm bg-[#1f5a3a]/10 p-1.5" aria-label="Giữa bàn">
        {board.length > 0 && <CardRow cards={board} size="normal" label="Bài chung" />}
        {playing && <p>{`Pot ${xuNum(pub.pot)}`}</p>}
        {pots.length > 1 && <p className="text-base">{pots.slice(1).map((p) => `Pot phụ ${xuNum(p.xu)}`).join(" · ")}</p>}
      </div>
      {last && (
        <div className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5" aria-label="Kết quả ván">
          {last.board.length > 0 && <CardRow cards={last.board} label="Bài chung" />}
          {Object.entries(last.shown).map(([s, cs]) => (
            <span key={s} className="flex flex-wrap items-center gap-1">
              <span>{name(Number(s))}</span><CardRow cards={cs} /><span>{pkHandName(pkEval([...cs, ...last.board]))}</span>
            </span>
          ))}
          {last.pots.map((p, i) => (
            <p key={i}>{`${i === 0 ? "Pot" : "Pot phụ"} ${xuNum(p.xu)}: ${p.winners.map(name).join(", ")}${p.hand ? ` — ${pkHandName(p.hand)}` : ""}`}</p>
          ))}
          <p>{Object.entries(last.net).map(([s, xu]) => `${name(Number(s))} ${signedXu(xu)}`).join(" · ")}</p>
        </div>
      )}
      {cards.length > 0 && inHand && (
        <>
          <CardHand cards={cards} label="Bài của bạn" />
          {made && <p>{`Bạn đang có: ${made}`}</p>}
        </>
      )}
      {o && (
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap gap-1">
            <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("fold")}>Úp bài</button>
            {o.canCheck ? (
              <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("check")}>Xem bài</button>
            ) : (
              <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("call")}>{`Theo ${xuNum(o.callCost)}`}</button>
            )}
            {o.canAllin && <button type="button" className="pch-btn" disabled={busy} onClick={() => pk("allin")}>Tất tay</button>}
          </div>
          {(o.canBet || o.canRaise) && spot && pub && (
            <BetControls o={o} presets={pkPresets(o, spot, pub.pot)} busy={busy}
              bet={[chosen, (n) => setAmount({ v: state.v, n })]} onAct={(action, to) => pk(action, to)} />
          )}
        </div>
      )}
      {room && (
        <div className="flex flex-wrap items-center gap-1">
          <input type="range" aria-label="Nạp thêm" min={room.min} max={room.max} step={1} value={top}
            onChange={(e) => setTopup(Number(e.target.value))} />
          <button type="button" className="pch-btn" disabled={busy} onClick={() => act({ kind: "topup", amount: top })}>
            {`Nạp thêm ${xuNum(top)}`}
          </button>
        </div>
      )}
    </div>
  );
}
```

Create `components/game/cards/CardTablePanel.tsx` with exactly:

```tsx
"use client";

import { useEffect, useState, type CSSProperties } from "react";
import ConfirmButton from "@/components/game/farm/ConfirmButton";
import { ParchmentModal } from "@/components/game/Parchment";
import type { CardTable } from "@/hooks/useCardTable";
import type { Card, CardGame } from "@/lib/game/cards/deck";
import {
  CARDS_FAILED, CARDS_LOADING, CARDS_NOT_OPEN, DEALER_WAIT, LEAVE_CONFIRM, placeBadge, SIT_HERE, STAND_UP, stakeLine,
  statusLine, TABLE_TITLE, WATCHING, xuNum,
} from "@/lib/game/cards/messages";
import type { CardAction } from "@/lib/game/cards/rpc";
import { inHand, mySeat, secondsLeft, type CardSeat, type CardState } from "@/lib/game/cards/state";
import { serverNow } from "@/lib/game/farm/clock";
import CaoBoard from "./CaoBoard";
import { CardRow } from "./PlayingCard";
import PokerBoard from "./PokerBoard";
import SitDialog from "./SitDialog";
import TienLenBoard from "./TienLenBoard";

/** A turn's length (§10), for the timer bar. */
const TURN_S: Record<CardGame, number> = { tienlen: 20, cao: 15, poker: 30 };

/** The seats in drawing order from the bottom (spec §7.3, §13.2): mine first (seat 1 for a spectator), then counter-clockwise. */
export function ringOrder(max: number, bottom: number): number[] {
  return Array.from({ length: max }, (_, k) => ((bottom - 1 + k) % max) + 1);
}

/** Where the k-th seat of the ring sits around the oval, as percentages of the felt. */
function ringSpot(k: number, max: number): CSSProperties {
  const a = Math.PI / 2 - (k * 2 * Math.PI) / max;
  return { "--x": `${50 + 40 * Math.cos(a)}%`, "--y": `${50 + 36 * Math.sin(a)}%` } as CSSProperties;
}

/** A seat's badges (§13.2): Bỏ lượt, Về nhất/nhì/ba/bét, Cóng, Xử thua; Cái; Úp bài, Tất tay, D. */
function badges(s: CardState, seat: CardSeat): string[] {
  const out: string[] = [];
  if (s.game === "tienlen" && s.pub) {
    const p = s.pub.players[seat.seat];
    if (!p || p.id !== seat.id) return out;
    if (s.phase === "playing" && s.pub.passed.includes(seat.seat)) out.push("Bỏ lượt");
    const placed = Object.values(s.pub.players).filter((q) => q.out !== "forfeit").length;
    if (p.place !== null) out.push(placeBadge(p.place, placed));
    if (p.out === "cong") out.push("Cóng");
    if (p.out === "forfeit") out.push("Xử thua");
  } else if (s.game === "cao" && s.pub) {
    if (s.pub.dealer === seat.seat) out.push("Cái");
  } else if (s.game === "poker" && s.pub) {
    if (s.pub.button === seat.seat) out.push("D");
    const p = s.pub.players[seat.seat];
    if (p && p.id === seat.id && s.phase === "playing") {
      if (p.fold) out.push("Úp bài");
      else if (p.allin) out.push("Tất tay");
    }
  }
  return out;
}

/** The cards a seat shows face down: Tiến lên's count, Cào's three, poker's two while in the hand. */
function backs(s: CardState, seat: CardSeat): { count: number | null; backs: number } {
  if (s.game === "tienlen" && s.pub && s.phase === "playing") {
    const p = s.pub.players[seat.seat];
    return p && p.id === seat.id && p.out === null ? { count: p.n, backs: 0 } : { count: null, backs: 0 };
  }
  if (s.game === "cao" && s.pub && s.phase === "peek") {
    return { count: null, backs: s.pub.order.includes(seat.seat) && !s.pub.left.includes(seat.seat) ? 3 : 0 };
  }
  if (s.game === "poker" && s.pub && s.phase === "playing") {
    const p = s.pub.players[seat.seat];
    return { count: null, backs: p && p.id === seat.id && !p.fold ? 2 : 0 };
  }
  return { count: null, backs: 0 };
}

/** A card table's panel (spec §13.2): the seats around the felt (mine at the bottom), the centre and my hand from the
 *  game's board, the status line and the timer; sitting and standing up. Esc closes it without standing up. */
export default function CardTablePanel({ game, table, me, coins, act, onOpenRules, onClose }: {
  game: CardGame;
  table: CardTable;
  me: string;
  coins: number | null;
  act: (a: CardAction) => Promise<unknown>;
  onOpenRules: () => void;
  onClose: () => void;
}) {
  const { state, hand, busy, failed, notOpen } = table;
  const [sitAt, setSitAt] = useState<number | null>(null);
  // the countdowns move every second (the server's clock)
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const run = (a: CardAction) => void act(a);

  let body;
  if (notOpen) body = <p>{CARDS_NOT_OPEN}</p>;
  else if (!state) body = <p>{failed ? CARDS_FAILED : CARDS_LOADING}</p>;
  else {
    const mine = mySeat(state, me);
    const sitting = mine !== null && !mine.leaving ? mine : null;
    const live = sitting !== null && inHand(state, hand);
    const cards: Card[] = live && hand ? hand.cards : [];
    const secs = secondsLeft(state, now);
    const name = (seat: number) => state.seats.find((x) => x.seat === seat)?.name ?? `Ghế ${seat}`;
    const dealerBusy = state.game === "cao" && state.phase === "peek" && sitting !== null && state.pub?.dealer === sitting.seat;
    const order = ringOrder(state.max, sitting?.seat ?? 1);
    const turn = state.turn !== null
      ? { mine: sitting !== null && state.turn === sitting.seat, name: name(state.turn) } : null;
    body = (
      <div className="flex flex-col gap-2">
        <div className="relative flex gap-1 overflow-x-auto sm:mb-3 sm:block sm:h-80 sm:overflow-visible" aria-label="Các ghế">
          <div className="hidden sm:absolute sm:inset-x-[16%] sm:inset-y-[18%] sm:block sm:rounded-[50%] sm:border-4 sm:border-[#6e4424] sm:bg-[#2f7d4f]" />
          {order.map((seatNo, k) => {
            const seat = state.seats.find((x) => x.seat === seatNo) ?? null;
            const b = seat ? backs(state, seat) : null;
            const isTurn = seat !== null && state.turn === seatNo && (state.phase === "playing" || state.phase === "deal_wait");
            return (
              <div key={seatNo} style={ringSpot(k, state.max)}
                className="pch flex min-w-24 shrink-0 flex-col items-center gap-0.5 p-1 text-base sm:absolute sm:left-[var(--x)] sm:top-[var(--y)] sm:-translate-x-1/2 sm:-translate-y-1/2"
                aria-label={`Ghế ${seatNo}`}>
                {seat ? (
                  <>
                    <span className="max-w-24 truncate text-lg">{seat.name}</span>
                    <span>{game === "poker" ? xuNum(seat.chips) : `giữ ${xuNum(seat.escrow)}`}</span>
                    <span className="flex flex-wrap items-center justify-center gap-1">
                      {b && b.count !== null && <span>{`${b.count} lá`}</span>}
                      {b && b.backs > 0 && <CardRow cards={Array.from({ length: b.backs }, () => null)} size="tiny" />}
                      {badges(state, seat).map((x) => <span key={x} className="rounded-sm bg-burgundy px-1 text-cream">{x}</span>)}
                    </span>
                    {seat.leaving && <span className="opacity-70">Đã rời</span>}
                    {isTurn && (
                      <div className="h-1.5 w-full overflow-hidden rounded-sm bg-ink/20" aria-hidden="true">
                        <div className="h-full bg-burgundy" style={{ width: `${Math.min(100, (secs / TURN_S[game]) * 100)}%` }} />
                      </div>
                    )}
                    {sitting && seat.id === me && (
                      dealerBusy ? (
                        <button type="button" className="pch-btn" disabled title={DEALER_WAIT}>{`${STAND_UP} · ${DEALER_WAIT}`}</button>
                      ) : (
                        <ConfirmButton warn={live ? LEAVE_CONFIRM : undefined} disabled={busy} onConfirm={() => run({ kind: "leave" })}>
                          {STAND_UP}
                        </ConfirmButton>
                      )
                    )}
                  </>
                ) : mine === null ? (
                  <button type="button" className="pch-btn" disabled={busy} onClick={() => setSitAt(seatNo)}>{SIT_HERE}</button>
                ) : (
                  <span className="opacity-60">{`Ghế ${seatNo}`}</span>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xl" role="status">{statusLine(state.phase, state.seats.filter((x) => !x.leaving).length, secs, turn)}</p>
        {!sitting && <p>{WATCHING}</p>}
        {state.game === "tienlen" && (
          <TienLenBoard state={state} cards={cards} mine={sitting} busy={busy} act={run} name={name} />
        )}
        {state.game === "cao" && (
          <CaoBoard state={state} cards={cards} mine={sitting} busy={busy} act={run} name={name} />
        )}
        {state.game === "poker" && (
          <PokerBoard state={state} cards={cards} mine={sitting} coins={coins} busy={busy} act={run} name={name} />
        )}
        {sitAt !== null && (
          <SitDialog game={game} seat={sitAt} stake={state.seats.length > 0 ? state.stake : null} coins={coins} busy={busy}
            onSit={(stake, buyin) => {
              setSitAt(null);
              run({ kind: "sit", seat: sitAt, stake, buyin });
            }}
            onClose={() => setSitAt(null)} />
        )}
      </div>
    );
  }

  return (
    // sm:, because ParchmentModal's own max-w-lg comes later in Tailwind's output than a plain max-w-3xl
    <ParchmentModal title={TABLE_TITLE[game]} onClose={sitAt === null ? onClose : undefined} className="sm:max-w-3xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div className="flex flex-wrap items-center gap-2">
          {state?.stake !== null && state?.stake !== undefined && <span>{stakeLine(game, state.stake)}</span>}
          <span>{`🪙 ${coins === null ? "—" : xuNum(coins)}`}</span>
          <button type="button" className="pch-btn ml-auto" onClick={onOpenRules}>📜 Sổ luật</button>
        </div>
        {body}
      </div>
    </ParchmentModal>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: the command of Step 2.
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint components/game/cards/TienLenBoard.tsx components/game/cards/CaoBoard.tsx components/game/cards/PokerBoard.tsx components/game/cards/CardTablePanel.tsx tests/unit/cards-panel.test.tsx` (clean).

- [ ] **Step 6: Commit**

Commit message:

```text
feat(cards): the table panel — the seats around the felt, the status line; the Tiến lên, Cào and poker boards

CardTablePanel: the title, the stake and my xu, the seats around the felt (a row on phones), the status line with its
countdown, sitting and standing up (confirmed in a live hand), and the game's board: TienLenBoard (the top, Đánh, Bỏ
lượt, 💡 Gợi ý, Xếp bài, 💣 Chặt!, the result), CaoBoard (the dealer, 🃏 Chia bài, nặn bài, the showdown) and PokerBoard
(the board and the pots, Úp bài, Xem bài or Theo, Cược or Tố lên with its slider, Tất tay, top-ups, the showdown).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/game/cards/CaoBoard.tsx components/game/cards/CardTablePanel.tsx components/game/cards/PokerBoard.tsx components/game/cards/TienLenBoard.tsx tests/unit/cards-panel.test.tsx
git commit -F <message file>
```

---

### Task 17: The card corner in the game shell — `overlayLocks`, the seat chip, the panel and the rules book; `WARN_LOCK` and the admin labels

**Files:**
- Create: `components/game/cards/CardSeatChip.tsx`, `components/game/cards/CardOverlays.tsx`
- Modify: `lib/game/overlays.ts`, `components/game/GameShell.tsx`, `lib/anticheat.ts` (`WARN_LOCK`), `lib/admin.ts` (`AnticheatHoldings.cards`), `components/admin/AnticheatTab.tsx` (the labels, the holdings line)
- Test: `tests/unit/cards-shell.test.tsx` (create), `tests/unit/game-overlays.test.ts`, `tests/unit/anticheat.test.ts` (modify)

**Interfaces:**
- Consumes: Tasks 13–16 (`useCardsController`, `CardTable`, `CardTablePanel`, `RulesBook`, `seatChipText`); `overlayLocks` / `OpenOverlays` (with v15.2's `farmRound`); `GameShell`'s `onInteract` chain (farm, then fishing), its toast, the player card, `fishing.data.state.coins` and `fishing.data.reload`.
- Produces: `OpenOverlays` gains `cardPanel` and `rulesBook` (both count as an open panel: `blocking` and `panelOpen`); `CardSeatChip({table, me, onOpen})` ("🃏 Tiến lên · Đến lượt bạn! 14s" pulsing on my turn, "· Đang chơi", "· Chờ ván mới"; nothing when I sit nowhere); `CardOverlays({cards, me, coins})` (the open table's panel, 📜 Sổ luật above it; while the book is open its Esc closes only the book); `GameShell` runs `useCardsController`, passes the card interactables to it (after the farm, before fishing), shows `CardSeatChip` under the anti-cheat chip and `CardOverlays` after `FarmOverlays`; `WARN_LOCK` names "đánh bài"; `AnticheatHoldings.cards?: Array<{room_id, game, seat, chips, escrow}>`; `AnticheatTab` exports `CODE_LABEL` (plus the six card codes of §11.5) and `holdingsLine` (plus "{n} ghế bàn bài ({xu})").

- [ ] **Step 1: Write the failing tests**

**tests/unit/game-overlays.test.ts — edit 1 of 2.** Replace:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
};
```

with:

```ts
  panel: false, fishingPanel: false, creating: false, anticheatModal: false, farmPanel: false, farmWork: false, farmRound: false,
  cardPanel: false, rulesBook: false,
};
```

**tests/unit/game-overlays.test.ts — edit 2 of 2.** Replace:

```ts

  it("takes both for a shell panel, a fishing panel or the character editor", () => {
    for (const open of ["panel", "fishingPanel", "creating"] as const) {
      expect(overlayLocks({ ...none, [open]: true })).toEqual({ blocking: true, panelOpen: true });
```

with:

```ts

  it("takes both for a shell panel, a fishing panel, the character editor, a card table or the rules book", () => {
    for (const open of ["panel", "fishingPanel", "creating", "cardPanel", "rulesBook"] as const) {
      expect(overlayLocks({ ...none, [open]: true })).toEqual({ blocking: true, panelOpen: true });
```

**tests/unit/anticheat.test.ts.** Replace:

```ts
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất và mua bán ở các tiệm trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
```

with:

```ts
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
```

Create `tests/unit/cards-shell.test.tsx` with exactly:

```tsx
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CODE_LABEL, holdingsLine } from "@/components/admin/AnticheatTab";
import CardOverlays from "@/components/game/cards/CardOverlays";
import CardSeatChip from "@/components/game/cards/CardSeatChip";
import type { CardsController } from "@/hooks/useCardsController";
import type { CardTable } from "@/hooks/useCardTable";
import type { AnticheatHoldings } from "@/lib/admin";
import type { CardHand, CardState } from "@/lib/game/cards/state";
import { syncClock } from "@/lib/game/farm/clock";
import { caoRaw, cs, ID, parsed, T0, tlRaw } from "./helpers/card-states";

beforeEach(() => syncClock(T0, Date.now()));
afterEach(cleanup);

const tableOf = (state: CardState | null, hand: CardHand | null = null): CardTable => ({
  game: state?.game ?? null, state, hand, failed: false, notOpen: false, busy: false,
  refetch: async () => {}, tick: async () => {}, act: async () => null,
});
const hand3 = (seat: number): CardHand => ({ serverNow: Date.parse(T0), game: "tienlen", handNo: 3, seat, cards: cs("3S") });

describe("CardSeatChip (spec §13.1)", () => {
  it("pulses on my turn with the seconds left, else says whether I play or wait; a tap opens the table", () => {
    const onOpen = vi.fn();
    render(<CardSeatChip table={tableOf(parsed(tlRaw()), hand3(1))} me={ID[0]} onOpen={onOpen} />);
    const chip = screen.getByRole("button", { name: "🃏 Tiến lên · Đến lượt bạn! 15s" });
    expect(chip.className).toContain("animate-pulse");
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalled();
    cleanup();
    render(<CardSeatChip table={tableOf(parsed(tlRaw()), hand3(2))} me={ID[1]} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "🃏 Tiến lên · Đang chơi" })).toBeInTheDocument();
    cleanup();
    render(<CardSeatChip table={tableOf(parsed(caoRaw({ phase: "result" })))} me={ID[1]} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "🃏 Cào · Chờ ván mới" })).toBeInTheDocument();
    cleanup();
    const { container } = render(<CardSeatChip table={tableOf(parsed(tlRaw()))} me={ID[5]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CardOverlays", () => {
  const controller = (over: Partial<CardsController>): CardsController => ({
    lobby: null, notOpen: false, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), rules: null, openRules: vi.fn(),
    closeRules: vi.fn(), table: tableOf(parsed(tlRaw())), seated: null, seatTable: tableOf(null), act: vi.fn(async () => null),
    interact: () => false, ...over,
  });

  it("shows the open table's panel, and the rules book above it; Esc closes the book first", () => {
    const cards = controller({ panel: "tienlen" });
    const { rerender } = render(<CardOverlays cards={cards} me={ID[5]} coins={1234} />);
    expect(screen.getByRole("dialog", { name: "🃏 Bàn Tiến lên" })).toHaveTextContent("🪙 1.234");
    fireEvent.click(screen.getByRole("button", { name: "📜 Sổ luật" }));
    expect(cards.openRules).toHaveBeenCalledWith("tienlen");
    const withBook = { ...cards, rules: { game: "tienlen" as const, stake: 1000 } };
    rerender(<CardOverlays cards={withBook} me={ID[5]} coins={1234} />);
    expect(screen.getByRole("dialog", { name: "📜 Sổ luật" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cards.closeRules).toHaveBeenCalled();
    expect(cards.closePanel).not.toHaveBeenCalled();
    rerender(<CardOverlays cards={cards} me={ID[5]} coins={1234} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cards.closePanel).toHaveBeenCalled();
  });
});

describe("the admin tab (spec §11.5)", () => {
  it("names the card signals", () => {
    expect([CODE_LABEL.bad_game, CODE_LABEL.bad_seat, CODE_LABEL.bad_stake, CODE_LABEL.bad_cards, CODE_LABEL.bad_bet, CODE_LABEL.bad_move])
      .toEqual(["Sai bàn bài", "Số ghế sai", "Mức cược sai", "Lá bài sai", "Tiền cược sai", "Nước đi sai"]);
  });

  it("counts the seats at the card tables in a wipe's preview", () => {
    const h: AnticheatHoldings = {
      wallet: { coins: 100 }, inventory: [], fish: [], personal_bests: [], rice: [], plots: [], leases: [], offers: [], crops: [],
      drying: [], announcements: 0,
    };
    expect(holdingsLine(h)).not.toContain("bàn bài");
    expect(holdingsLine({ ...h, cards: [{ room_id: "r", game: "poker", seat: 2, chips: 50_000, escrow: 0 },
      { room_id: "q", game: "tienlen", seat: 1, chips: 0, escrow: 10_000 }] })).toContain("2 ghế bàn bài (60.000 xu)");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm vitest run tests/unit/game-overlays.test.ts tests/unit/anticheat.test.ts tests/unit/cards-shell.test.tsx`
Expected: FAIL — `cards-shell.test.tsx` stops at `Failed to resolve import "@/components/game/cards/…"`; 2 tests fail (the card flags in `overlayLocks`, `WARN_LOCK`), 15 pass.

- [ ] **Step 3: The overlays, the chip and the shell**

**lib/game/overlays.ts — edit 1 of 2.** Replace:

```ts
  farmRound: boolean;
}
```

with:

```ts
  farmRound: boolean;
  /** A card table's panel (v16). */
  cardPanel: boolean;
  /** 📜 Sổ luật (v16). */
  rulesBook: boolean;
}
```

**lib/game/overlays.ts — edit 2 of 2.** Replace:

```ts
export function overlayLocks(o: OpenOverlays): { blocking: boolean; panelOpen: boolean } {
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound, panelOpen };
```

with:

```ts
export function overlayLocks(o: OpenOverlays): { blocking: boolean; panelOpen: boolean } {
  const panelOpen = o.panel || o.fishingPanel || o.creating || o.anticheatModal || o.cardPanel || o.rulesBook;
  return { blocking: panelOpen || o.farmPanel || o.farmWork || o.farmRound, panelOpen };
```

Create `components/game/cards/CardSeatChip.tsx` with exactly:

```tsx
"use client";

import { useEffect, useState } from "react";
import type { CardTable } from "@/hooks/useCardTable";
import { seatChipText } from "@/lib/game/cards/messages";
import { inHand, mySeat, secondsLeft } from "@/lib/game/cards/state";
import { serverNow } from "@/lib/game/farm/clock";

/** Under the player card while I sit at a table (spec §13.1, R29): "🃏 Tiến lên · Đến lượt bạn! 14s" (pulsing),
 *  "· Đang chơi" or "· Chờ ván mới". A tap opens the table. */
export default function CardSeatChip({ table, me, onOpen }: { table: CardTable; me: string; onOpen: () => void }) {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  const { game, state, hand } = table;
  const seat = state ? mySeat(state, me) : null;
  if (!game || !state || !seat || seat.leaving) return null;
  const turn = state.turn === seat.seat && (state.phase === "playing" || state.phase === "deal_wait");
  const what = turn ? "turn" : inHand(state, hand) ? "playing" : "waiting";
  return (
    <button type="button" onClick={onOpen}
      className={`pch-btn self-start text-base ${turn ? "pch-btn-primary motion-safe:animate-pulse" : ""}`}>
      {seatChipText(game, what, secondsLeft(state, now))}
    </button>
  );
}
```

Create `components/game/cards/CardOverlays.tsx` with exactly:

```tsx
"use client";

import type { CardsController } from "@/hooks/useCardsController";
import CardTablePanel from "./CardTablePanel";
import RulesBook from "./RulesBook";

/** The card corner on top of the world (spec §13): the open table's panel and 📜 Sổ luật above it. While the book is open
 *  its Esc is its own: the panel under it stays. */
export default function CardOverlays({ cards, me, coins }: { cards: CardsController; me: string; coins: number | null }) {
  const { panel, rules } = cards;
  return (
    <>
      {panel !== null && (
        <CardTablePanel game={panel} table={cards.table} me={me} coins={coins} act={cards.act}
          onOpenRules={() => cards.openRules(panel)} onClose={rules ? () => {} : cards.closePanel} />
      )}
      {rules && <RulesBook initial={rules.game} stake={rules.stake} onClose={cards.closeRules} />}
    </>
  );
}
```

**components/game/GameShell.tsx — edit 1 of 7.** Replace:

```tsx
import { useAnticheat } from "@/hooks/useAnticheat";
import { useChat } from "@/hooks/useChat";
```

with:

```tsx
import { useAnticheat } from "@/hooks/useAnticheat";
import { useCardsController } from "@/hooks/useCardsController";
import { useChat } from "@/hooks/useChat";
```

**components/game/GameShell.tsx — edit 2 of 7.** Replace:

```tsx
import AnticheatModal from "./AnticheatModal";
import CharacterEditor from "./CharacterEditor";
```

with:

```tsx
import AnticheatModal from "./AnticheatModal";
import CardOverlays from "./cards/CardOverlays";
import CardSeatChip from "./cards/CardSeatChip";
import CharacterEditor from "./CharacterEditor";
```

**components/game/GameShell.tsx — edit 3 of 7.** Replace:

```tsx

  // --- anti-cheat: the warning or the ban after a strike, and the lock's countdown (anti-cheat spec §12.1)
```

with:

```tsx

  // --- the card corner: the hall's labels, the table panels, the rules book, and the table I sit at (v16)
  const isMember = useCallback((id: string) => memberIds.has(id), [memberIds]);
  const cards = useCardsController({
    token, roomId: room.id, accountId, mapId: travel.mapId, canvas: getCanvas, toast: showToast, isMember,
    onCoinsChanged: () => void fishing.data.reload(),
  });
  const { interact: cardsInteract } = cards;

  // --- anti-cheat: the warning or the ban after a strike, and the lock's countdown (anti-cheat spec §12.1)
```

**components/game/GameShell.tsx — edit 4 of 7.** Replace:

```tsx
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null,
  });
```

with:

```tsx
    farmPanel: farm.panel !== null, farmWork: farm.work !== null, farmRound: farm.round !== null,
    cardPanel: cards.panel !== null, rulesBook: cards.rules !== null,
  });
```

**components/game/GameShell.tsx — edit 5 of 7.** Replace:

```tsx
      default:
        if (!farmInteract(it) && !fishingInteract(it)) showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast, fishingInteract, farmInteract, cancelCast]);
```

with:

```tsx
      default:
        if (!farmInteract(it) && !cardsInteract(it) && !fishingInteract(it)) showToast("Sắp mở — chờ chút nhé!");
    }
  }, [travelTo, showToast, fishingInteract, farmInteract, cardsInteract, cancelCast]);
```

**components/game/GameShell.tsx — edit 6 of 7.** Replace:

```tsx
            <AnticheatChip secondsLeft={anticheat.secondsLeft} />
          </div>
```

with:

```tsx
            <AnticheatChip secondsLeft={anticheat.secondsLeft} />
            {cards.seated && <CardSeatChip table={cards.seatTable} me={accountId} onOpen={() => cards.seated && cards.openPanel(cards.seated)} />}
          </div>
```

**components/game/GameShell.tsx — edit 7 of 7.** Replace:

```tsx
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} />
```

with:

```tsx
      <FarmOverlays farm={farm} me={accountId} onField={map.id === "field"} panelOpen={panelOpen} />
      <CardOverlays cards={cards} me={accountId} coins={fishing.data.state?.coins ?? null} />
```

- [ ] **Step 4: `WARN_LOCK` and the admin tab**

**lib/anticheat.ts.** Replace:

```ts
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất và mua bán ở các tiệm trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
```

with:

```ts
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
```

**lib/admin.ts.** Replace:

```ts
  announcements: number;
}
```

with:

```ts
  announcements: number;
  /** v16: the account's seats at the card tables, with their stacks and balances (absent before 0017). */
  cards?: Array<{ room_id: string; game: string; seat: number; chips: number; escrow: number }>;
}
```

**components/admin/AnticheatTab.tsx — edit 1 of 5.** Replace:

```tsx

const CODE_LABEL: Record<string, string> = {
  reel_too_fast: "Kéo cá quá nhanh",
```

with:

```tsx

export const CODE_LABEL: Record<string, string> = {
  reel_too_fast: "Kéo cá quá nhanh",
```

**components/admin/AnticheatTab.tsx — edit 2 of 5.** Replace:

```tsx
  cast_daily_cap: "Chạm 300 lần câu/ngày",
};
```

with:

```tsx
  cast_daily_cap: "Chạm 300 lần câu/ngày",
  bad_game: "Sai bàn bài",
  bad_seat: "Số ghế sai",
  bad_stake: "Mức cược sai",
  bad_cards: "Lá bài sai",
  bad_bet: "Tiền cược sai",
  bad_move: "Nước đi sai",
};
```

**components/admin/AnticheatTab.tsx — edit 3 of 5.** Replace:

```tsx

/** What a wipe would remove now; items count every piece. */
function holdingsLine(h: AnticheatHoldings): string {
  const items = h.inventory.reduce((a, i) => a + i.qty, 0);
```

with:

```tsx

/** What a wipe would remove now; items count every piece. Seats at the card tables (v16) are resolved first: their xu
 *  come back to the wallet before it is cleared. */
export function holdingsLine(h: AnticheatHoldings): string {
  const items = h.inventory.reduce((a, i) => a + i.qty, 0);
```

**components/admin/AnticheatTab.tsx — edit 4 of 5.** Replace:

```tsx
  const produce = (h.produce ?? []).reduce((a, p) => a + p.kg, 0);
  return [
```

with:

```tsx
  const produce = (h.produce ?? []).reduce((a, p) => a + p.kg, 0);
  const seats = h.cards ?? [];
  return [
```

**components/admin/AnticheatTab.tsx — edit 5 of 5.** Replace:

```tsx
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
  ].join(" · ");
```

with:

```tsx
    `${count(h.offers.length)} đề nghị mua`, `${count(h.drying.length)} ô phơi`, `${count(h.announcements)} tin khoe trong chat`,
    ...(seats.length > 0 ? [`${count(seats.length)} ghế bàn bài (${formatXu(seats.reduce((a, s) => a + s.chips + s.escrow, 0))})`] : []),
  ].join(" · ");
```

- [ ] **Step 5: Run them to verify they pass**

Run: the command of Step 2.
Expected: PASS (21 tests).

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit` (clean) and `npx eslint lib/game/overlays.ts components/game/cards/CardSeatChip.tsx components/game/cards/CardOverlays.tsx components/game/GameShell.tsx lib/anticheat.ts lib/admin.ts components/admin/AnticheatTab.tsx tests/unit/game-overlays.test.ts tests/unit/anticheat.test.ts tests/unit/cards-shell.test.tsx` (clean).

- [ ] **Step 7: Commit**

Commit message:

```text
feat(cards): the card corner in the game shell — overlayLocks, the seat chip, the panel and the rules book; WARN_LOCK

GameShell gains useCardsController: a card table's E opens its panel; the panel and the rules book join overlayLocks
next to HarvestGame; CardSeatChip shows the table and the turn under the player card; CardOverlays renders the panel with
📜 Sổ luật above it. WARN_LOCK names đánh bài; the admin tab labels the six card codes and counts the seats in a wipe's
preview.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add components/admin/AnticheatTab.tsx components/game/GameShell.tsx components/game/cards/CardOverlays.tsx components/game/cards/CardSeatChip.tsx lib/admin.ts lib/anticheat.ts lib/game/overlays.ts tests/unit/anticheat.test.ts tests/unit/cards-shell.test.tsx tests/unit/game-overlays.test.ts
git commit -F <message file>
```

---

### Task 18: The README section, the anti-cheat spec amendments and the integration test; the final checks

**Files:**
- Create: `tests/integration/v16.test.ts`
- Modify: `README.md` (the v16 section, after v15.2's), `docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md` (the card RPCs)

**Interfaces:**
- Consumes: the public RPCs of Tasks 3–6 (`register`, `login`, `create_room`, `join_room` and `fishing_state` from earlier migrations); the anti-cheat spec at `391eb7a`.
- Produces: `tests/integration/v16.test.ts` (skipped without `SUPABASE_TEST_URL` / `SUPABASE_TEST_ANON_KEY`): the lobby of a new room (three idle tables), outsiders refused by every RPC, `not enough coins` / `not seated` / an idle tick for a fresh account, and — only with `SUPABASE_TEST_CARD_PLAYER_A` and `_B` (`name:password` of two accounts with at least 1 000 xu) — a 2-player Tiến lên game at the 100 xu stake, driven by the public RPCs to its settlement, with the two wallets' total unchanged.

- [ ] **Step 1: Write the integration test**

Create `tests/integration/v16.test.ts` with exactly:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;
// The full game needs two accounts of the test project with at least 1 000 xu each (10 stakes at the lowest stake): a
// fresh account has none. "name:password" each.
const funded = [process.env.SUPABASE_TEST_CARD_PLAYER_A, process.env.SUPABASE_TEST_CARD_PLAYER_B];

type State = {
  v: number; seq: number; phase: string; turn: number | null; deadline: string | null; hand_no: number;
  seats: Array<{ seat: number; id: string; escrow: number }>;
  pub: { top?: unknown } | null;
  last: { places: number[]; net: Record<string, number> } | null;
};

// The card corner end to end with the public RPCs (spec §17): the lobby, membership, the refusals a fresh account meets,
// and — with two funded accounts — a 2-player Tiến lên game played to its settlement, the wallets' total unchanged.
run("v16 card tables", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async () => {
    const { data, error } = await db.rpc("register", { p_username: uniq("cb"), p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
  };
  const room = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: uniq("bai"), p_password: "pw", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { room_id: string; code: string };
  };

  it("reads the lobby: three idle tables, no seats", async () => {
    const me = await reg();
    const r = await room(me.token);
    const l = await db.rpc("card_lobby", { p_room_id: r.room_id, p_session_token: me.token });
    expect(l.error).toBeNull();
    expect((l.data as { tables: unknown[] }).tables).toEqual([
      { game: "tienlen", stake: null, phase: "idle", max: 4, seats: [] },
      { game: "cao", stake: null, phase: "idle", max: 6, seats: [] },
      { game: "poker", stake: null, phase: "idle", max: 6, seats: [] },
    ]);
    const s = await db.rpc("card_state", { p_room_id: r.room_id, p_session_token: me.token, p_game: "poker" });
    expect(s.data).toMatchObject({ game: "poker", phase: "idle", seats: [], pub: {}, last: null });
    const h = await db.rpc("card_hand", { p_room_id: r.room_id, p_session_token: me.token, p_game: "poker" });
    expect(h.data).toMatchObject({ seat: null, cards: [] });
  });

  it("keeps outsiders out of every table", async () => {
    const owner = await reg();
    const stranger = await reg();
    const r = await room(owner.token);
    for (const [fn, args] of [
      ["card_lobby", {}], ["card_state", { p_game: "tienlen" }], ["card_hand", { p_game: "cao" }], ["card_tick", { p_game: "poker" }],
      ["card_leave", { p_game: "tienlen" }], ["tl_pass", { p_seq: 0 }],
    ] as const) {
      const x = await db.rpc(fn, { p_room_id: r.room_id, p_session_token: stranger.token, ...args });
      expect(x.error?.message, fn).toBe("account is not a member of this room");
    }
  });

  it("refuses a seat the wallet cannot cover, and a stand-up without a seat", async () => {
    const me = await reg();
    const r = await room(me.token);
    const sit = await db.rpc("card_sit", { p_room_id: r.room_id, p_session_token: me.token, p_game: "tienlen", p_seat: 1, p_stake: 100,
      p_buyin: null });
    expect(sit.error?.message).toBe("not enough coins");
    const leave = await db.rpc("card_leave", { p_room_id: r.room_id, p_session_token: me.token, p_game: "tienlen" });
    expect(leave.error?.message).toBe("not seated");
    const tick = await db.rpc("card_tick", { p_room_id: r.room_id, p_session_token: me.token, p_game: "tienlen" });
    expect(tick.data).toMatchObject({ changed: false, state: { phase: "idle" } });
  });

  (funded.every(Boolean) ? it : it.skip)("plays a 2-player Tiến lên game to its settlement; the wallets' total never changes", async () => {
    const login = async (who: string) => {
      const [u, p] = who.split(":");
      const { data, error } = await db.rpc("login", { p_username: u, p_password: p });
      if (error) throw error;
      return (Array.isArray(data) ? data[0] : data) as { account_id: string; token: string };
    };
    const a = await login(funded[0]!);
    const b = await login(funded[1]!);
    const r = await room(a.token);
    expect((await db.rpc("join_room", { p_code: r.code, p_password: "pw", p_session_token: b.token })).error).toBeNull();
    const coins = async (t: string) => ((await db.rpc("fishing_state", { p_session_token: t })).data as { coins: number }).coins;
    const before = (await coins(a.token)) + (await coins(b.token));
    const call = async (t: string, fn: string, args: Record<string, unknown>) => {
      const x = await db.rpc(fn, { p_room_id: r.room_id, p_session_token: t, ...args });
      if (x.error) throw x.error;
      return x.data as { state: State };
    };
    await call(a.token, "card_sit", { p_game: "tienlen", p_seat: 1, p_stake: 100, p_buyin: null });
    let s = (await call(b.token, "card_sit", { p_game: "tienlen", p_seat: 2, p_stake: 100, p_buyin: null })).state;
    expect(s.phase).toBe("countdown");
    const token = (seat: number) => (s.seats.find((x) => x.seat === seat)!.id === a.account_id ? a.token : b.token);
    // the leader plays its lowest card each time it leads, the other passes: the leader goes out after 13 plays
    for (let step = 0; step < 100 && s.phase !== "result"; step++) {
      if (s.phase !== "playing") {
        await new Promise((res) => setTimeout(res, Math.max(0, Date.parse(s.deadline ?? "") - Date.now()) + 500));
        s = (await call(a.token, "card_tick", { p_game: "tienlen" })).state;
        continue;
      }
      const t = token(s.turn!);
      if (s.pub?.top) {
        s = (await call(t, "tl_pass", { p_seq: s.seq })).state;
      } else {
        const h = (await db.rpc("card_hand", { p_room_id: r.room_id, p_session_token: t, p_game: "tienlen" })).data as { cards: number[] };
        s = (await call(t, "tl_play", { p_seq: s.seq, p_cards: [Math.min(...h.cards)] })).state;
      }
    }
    expect(s.phase).toBe("result");
    expect(s.last!.places).toHaveLength(2);
    expect(Object.values(s.last!.net).reduce((x, y) => x + y, 0)).toBe(0);
    expect(s.seats.every((x) => x.escrow === 0)).toBe(true);
    await call(a.token, "card_leave", { p_game: "tienlen" });
    await call(b.token, "card_leave", { p_game: "tienlen" });
    expect((await coins(a.token)) + (await coins(b.token))).toBe(before);
  }, 60_000);
});
```

- [ ] **Step 2: Run it**

Run: `pnpm vitest run tests/integration/v16.test.ts`
Expected: skipped without `SUPABASE_TEST_URL` — `Test Files  1 skipped (1)`, `Tests  4 skipped (4)`. With a test project it passes (the full game only with the two funded accounts).

- [ ] **Step 3: The README section**

**README.md.** Append at the end of the file, after a blank line:

```markdown
## v16: Góc đánh bài — Tiến lên, Cào và Poker

### DB migration

`supabase/migrations/0017_v16_cards.sql` is **additive and re-runnable** (`create … if not exists`, `create or replace`, `drop trigger if exists` + `create trigger`, `drop constraint if exists` + `add constraint`): run it in the Supabase SQL Editor after `0016` (v15.2). The production order is `0012` → `0014` → `0013` → `0015` → `0016` → `0017`. It requires `0015` and `0016`: it re-creates `0016`'s `_ac_holdings` and `_ac_wipe` and keeps `0016`'s `coin_ledger` reasons. It adds the private tables `card_tables` (three per room, made the first time anyone ticks or sits), `card_seats`, `card_hands`, `card_secrets` and `card_log` (14 days), which only the RPCs touch; the `coin_ledger` reasons `card_hold`, `card_settle`, `card_buyin`, `card_cashout` and `card_refund`; the reads `card_lobby`, `card_state` and `card_hand`, `card_tick` and `card_leave` (all five on the anti-cheat allowlist), and the six guarded writes `card_sit`, `tl_play`, `tl_pass`, `cao_deal`, `pk_act` and `pk_topup`; the BEFORE DELETE triggers on `rooms` and `accounts` that settle every seat before a room or an account goes; and `_ac_holdings` / `_ac_wipe` re-created so a wipe resolves the account's seats first. `tests/sql/v16-smoke.sql` checks all of it on a throwaway PostgreSQL cluster (from the repo root, after the migrations in production order: it reads `tests/fixtures/card-cases.json` and ends with `tests/sql/anticheat-guards.sql`).

> **Deploy order:** `0017` first, then the v16 client. A v16 client against a database without it shows "Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017." at the tables; the rest of the game keeps working. Older clients draw the hall without the corner and never call the card RPCs.
>
> **Re-running earlier migrations after `0017`:** `0013`, `0015` and `0016` put back their own `coin_ledger` reason checks, and `0015` and `0016` their `_ac_holdings` and `_ac_wipe` without the card seats. Once a hand has been played, their reason lists also lack `card_hold`, `card_settle`, `card_buyin`, `card_cashout` and `card_refund`: add those (and the values the v15.2 note above names) first, then run them in order with `0017` last (anti-cheat §11.3 rule 7).

### What's new in v16

- **Góc đánh bài:** a plank deck in the hall's south-west, between the two palms, with three tables — **Bàn Tiến lên** (2–4 players), **Chiếu Cào** (ba cây, cào cái, 2–6) and **Bàn Poker** (Texas Hold'em no-limit, 2–6) — and a **📜 Sổ luật** sign. Walk to a table and press E: the panel shows the seats, the cards on the table and the timers; other members can watch (👀 Đang xem) and see only what is public.
- **Stakes:** the first to sit picks 100, 1 000 or 10 000 xu. Tiến lên holds 10 stakes per game and Cào one stake (the dealer one per player) while a hand runs, and gives back the rest at its end; poker takes a buy-in of 50–200 big blinds (blinds ½ and 1 stake) that goes back to the wallet on standing up, with top-ups between hands.
- **One variant per game:** Tiến lên miền Nam with nhất-nhì-ba-bét, chặt heo and chặt chồng, thối, cóng and tới trắng; Cào with sáp, ba tây and nút, a rotating dealer and "nặn bài"; poker by the TDA rules (min-raise, short all-ins, side pots, the odd chip). Every rule, with card examples and the money of each game at the table's stake, is in **📜 Sổ luật**.
- **Timers:** 20 s a turn in Tiến lên, 15 s to deal and to peek in Cào, 30 s a turn in poker; a missed turn plays the default move, two in a row stand the player up (a Tiến lên player "xử thua": 1 stake to each player still in the game plus the thối of their hand). A seat whose owner made no card call for a minute is not dealt in.
- **Sitting while walking around:** close the panel and the chip under the player card shows the table and the turn ("🃏 Tiến lên · Đến lượt bạn! 14s"); a toast calls you back once per turn.
- **The hall's labels** over each table show its players and stake, refreshed every 20 s.

### Play money (legal & product)

Xu is play money: it is earned only in the game (fishing, farming, check-in, songs), never sold and never cashed out, and the tables take no cut — the winners get exactly what the losers pay. Vietnam fines gambling for money or property (Decree 144/2021/NĐ-CP, art. 28, names "tiến lên 13 lá" and "3 cây"), so while the corner exists no feature may sell xu or let xu buy anything of monetary value, and trading xu or accounts for money is forbidden (the owner may ban for it). The sit dialog and the rules book say so. Colluding players can move xu between accounts, as land sales already allow; there is no detection beyond the owner's review of `card_log`. This note is not legal advice.

### Trust model (v16)

The server decides the shuffle (Fisher–Yates over `gen_random_bytes`, no seed kept), the deal, every legal move, the timers and every xu that moves, and keeps each hand private: `card_state` is the same for every viewer and a player's cards come only from `card_hand` and their own answers. A client only chooses its own moves. Malformed inputs are strikes (a wrong game, seat, stake, amount, card list or bet); a well-formed move the table refuses is only logged. Every action carries the table's `seq`, so a double click or a late request is refused as `stale`. A room deletion or an account deletion settles the seats first, and a wipe resolves the account's seats before the wallet is cleared: no other player's xu is ever lost.

### Realtime budget (v16)

Each table has its own channel `cards:{roomId}:{game}` carrying only a hint `cv {id, v}` from the client whose call changed the table; the others fetch `card_state` 150 ms later, at most every 500 ms, and poll every 15 s while nothing arrives. A spoofed hint can only cause refetches at that rate, and each sender has a budget of 5 hints a second. With all three tables full that is about 11 600 messages an hour (≈ 3 a second, peaks near 10), far below the free plan's 100 a second; 2 M messages a month cover about 170 hours of full tables. The hall's labels come from `card_lobby` every 20 s, with no realtime cost.
```

- [ ] **Step 4: The anti-cheat spec amendments**

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 1 of 13.** Replace:

```markdown
| `foreign_offer` | `decline_offer`, `accept_offer` | the id is an offer **of this room** on a plot the caller does not own | decline `offer not found`, accept `not your plot` | The panel offers these only for `mine.incoming_offers`. Every change of owner deletes the plot's offers in the same transaction: `_land_sale`, `_farm_do_buy_plot`, `_farm_do_sell_to_village`, the reclaim in the sweep and the release in §9.6. The check runs before the sweep, and a pending sweep still shows the old owner. |
```

with:

```markdown
| `foreign_offer` | `decline_offer`, `accept_offer` | the id is an offer **of this room** on a plot the caller does not own | decline `offer not found`, accept `not your plot` | The panel offers these only for `mine.incoming_offers`. Every change of owner deletes the plot's offers in the same transaction: `_land_sale`, `_farm_do_buy_plot`, `_farm_do_sell_to_village`, the reclaim in the sweep and the release in §9.6. The check runs before the sweep, and a pending sweep still shows the old owner. |
| `bad_game` | `card_sit` (`0017`) | `p_game` is not `tienlen`, `cao` or `poker` | `invalid game` | The game comes from the table's interactable (v16 §11.5). |
| `bad_seat` | `card_sit` (`0017`) | `p_seat` is null or outside 1 to the table's seats (4 or 6) | `invalid seat` | The panel sits only on the seats it draws. |
| `bad_stake` | `card_sit` (`0017`) | `p_stake` is not 100, 1 000 or 10 000 | `invalid stake` | `SitDialog` offers the three stakes, or the table's. |
| `bad_qty` | `card_sit`, `pk_topup` (`0017`) | a poker buy-in null or outside 50–200 big blinds; a buy-in at another table; a top-up null, < 1 or above 2 000 000 | `invalid quantity` | The sliders are bounded by `pkBuyInRange` and `pkTopUpRange`. |
| `bad_cards` | `tl_play` (`0017`) | null, empty, not one-dimensional, more than 13 cards, a card outside 0–51, or a duplicate | `invalid cards` | `CardHand` sends a set of the cards it shows. |
| `bad_bet` | `pk_act` (`0017`) | the action is not one of the six; a bet or raise whose amount is null, < 0 or above 2·10⁹ | `invalid bet` | The poker buttons send their enum and the slider's value. |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 2 of 13.** Replace:

```markdown
| `too many messages, slow down` | chat | fast typing |
| `invalid session`, `account is not a member of this room`, `account banned`, `account locked` | any | logged out elsewhere; kicked; calls already in flight when the lock landed |
```

with:

```markdown
| `too many messages, slow down` | chat | fast typing |
| `stale`, `not seated`, `already seated`, `still leaving`, `table full`, `seat taken`, `stake changed`, `not enough coins`, `hand running`, `too many chips`, `dealer busy` | the card RPCs (`0017`) | a double click; a late request; another player acted first (v16 §11.5) |
| `invalid session`, `account is not a member of this room`, `account banned`, `account locked` | any | logged out elsewhere; kicked; calls already in flight when the lock landed |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 3 of 13.** Replace:

```markdown
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |
```

with:

```markdown
| `kind_mismatch` | `apply_fertilizer`, `soak_seed`, `spray`, and from `0016` `plant_crop` and `load_sprayer` | an existing item of the wrong kind | as above |
| `bad_move` | `tl_play`, `tl_pass`, `cao_deal`, `pk_act` (`0017`) | a well-formed move the table refuses while `p_seq` matched: `invalid play`, `cannot beat`, `not your turn`, `must include`, `must play`, `invalid bet`, `cannot raise`, `not dealer`, `wrong phase` (v16 §11.5) | A bug in a client mirror must never strike an honest player (v16 R30). |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 4 of 13.** Replace:

```markdown
| `cast_daily_cap` | `day`, `casts` |
```

with:

```markdown
| `cast_daily_cap` | `day`, `casts` |
| `bad_game`, `bad_seat`, `bad_stake`, `bad_qty` (`0017`) | `game`, and `seat`, `stake` or `stake` and `buyin` (`card_sit`); `amount` (`pk_topup`) |
| `bad_cards`, `bad_bet` (`0017`) | `seq`, and `cards` or `action` and `amount` |
| `bad_move` (`0017`) | `game`, `seat`, `seq` and the move (`cards`, or `action` and `amount`) |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 5 of 13.** Replace:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 42 game RPCs (35 in `0015`, 7 more in `0016`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

with:

```markdown
|---|---|---|---|---|
| `account locked` | 42501 | whole seconds left | `anticheat` | `_ac_guard`, in the 48 game RPCs (35 in `0015`, 7 more in `0016`, 6 more in `0017`) |
| `account banned` | 42501 | — | — | `login` (new); `_auth_account` (existing) |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 6 of 13.** Replace:

```markdown
- **v15.2 (7, `0016`):** `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`, 42 in all. The gather RPCs come with v15.3's `0018` (§11.3).

**Still open:**
- the reads: `fishing_state`, `fishing_board`, `field_state`, `touch_room`;
- the account RPCs: `register`, `login`, `me`, `logout`;
```

with:

```markdown
- **v15.2 (7, `0016`):** `harvest_part`, `rent_harvester`, `prepare_beds`, `plant_crop`, `tend_crop`, `load_sprayer` and `sell_produce`, 42 in all. The gather RPCs come with v15.3's `0018` (§11.3).
- **v16 (6, `0017`):** `card_sit`, `pk_topup`, `tl_play`, `tl_pass`, `cao_deal` and `pk_act`, 48 in all.

**Still open:**
- the reads: `fishing_state`, `fishing_board`, `field_state`, `touch_room`, and from `0017` `card_lobby`, `card_state` and `card_hand`;
- `card_tick` and `card_leave` (`0017`): a tick applies only what is due, and standing up never helps a cheater (v16 R31);
- the account RPCs: `register`, `login`, `me`, `logout`;
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 7 of 13.** Replace:

```markdown
| The sprayer's tank (`0016`) | Emptied: `farm_profiles.tank_item` null and `tank_charges` 0. The profile stays, so the gift stays claimed. |
| Catch and land announcements (D6) | `delete from chat_messages where system and about_account_id = <account>`. Realtime DELETE events remove them from open chats. |
```

with:

```markdown
| The sprayer's tank (`0016`) | Emptied: `farm_profiles.tank_item` null and `tank_charges` 0. The profile stays, so the gift stays claimed. |
| Card seats (`0017`) | Resolved first, by `_card_forfeit_all` (v16 §6.3), as if the account stood up at each table: a live hand is forfeited by the leave rules, the rest of its escrow or stack comes back to the wallet, and the wipe then takes the whole balance. Nobody else's stake or pot changes, and the snapshot lists no seat. |
| Catch and land announcements (D6) | `delete from chat_messages where system and about_account_id = <account>`. Realtime DELETE events remove them from open chats. |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 8 of 13.** Replace:

```markdown
   - `_land_sale` and `finish_cast` keep `system` and `about_account_id`.
4. **A new `coin_ledger` reason check keeps `'wipe'`.** This applies to v15.2's `harvester` and `produce_sell`, then v15.3's `critter_sell`.
5. **Wider honest inputs widen the hard check.** A migration that widens the range of honest inputs widens the matching hard check in the same migration, and ships before its client.
6. **Every later smoke run ends with `tests/sql/anticheat-guards.sql`.** The dynamic loop in that file gains the new game RPCs, and a new RPC that is not a game action joins its allowlist by signature.
7. **Re-running `0013` after `0015` undoes the guards.** `0013` re-creates the game RPCs and the `coin_ledger` reason check without the anti-cheat parts. After any re-run of `0013`, run `0015` again right away. On a database that has already seen a wipe, `0013`'s reason check (without `'wipe'`) fails, so add `'wipe'` to its list first. Later migrations follow the same order: `0013` → `0015` → the rest. Once `0016` has run, re-running `0013` or `0015` also needs the checks they re-create to accept what later migrations wrote: `0013`'s `shop_items` kind check lacks `tool`, and the `coin_ledger` checks lack `harvester` and `produce_sell` (and `0013`'s also lacks `wipe`). Add those values to the file first, then run the whole chain in order with the latest migration last.
```

with:

```markdown
   - `_land_sale` and `finish_cast` keep `system` and `about_account_id`.
4. **A new `coin_ledger` reason check keeps `'wipe'`.** This applies to v15.2's `harvester` and `produce_sell`, v16's `card_hold`, `card_settle`, `card_buyin`, `card_cashout` and `card_refund`, then v15.3's `critter_sell`.
5. **Wider honest inputs widen the hard check.** A migration that widens the range of honest inputs widens the matching hard check in the same migration, and ships before its client.
6. **Every later smoke run ends with `tests/sql/anticheat-guards.sql`.** The dynamic loop in that file gains the new game RPCs, and a new RPC that is not a game action joins its allowlist by signature.
7. **Re-running `0013` after `0015` undoes the guards.** `0013` re-creates the game RPCs and the `coin_ledger` reason check without the anti-cheat parts. After any re-run of `0013`, run `0015` again right away. On a database that has already seen a wipe, `0013`'s reason check (without `'wipe'`) fails, so add `'wipe'` to its list first. Later migrations follow the same order: `0013` → `0015` → the rest. Once `0016` has run, re-running `0013` or `0015` also needs the checks they re-create to accept what later migrations wrote: `0013`'s `shop_items` kind check lacks `tool`, and the `coin_ledger` checks lack `harvester` and `produce_sell` (and `0013`'s also lacks `wipe`). Once `0017` has run, the `coin_ledger` checks of `0013`, `0015` and `0016` also lack its five card reasons, and `0015` and `0016` put back `_ac_holdings` and `_ac_wipe` without the card seats. Add those values to the file first, then run the whole chain in order with the latest migration last.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 9 of 13.** Replace:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `WARN_LOCK` | `Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất và mua bán ở các tiệm trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.` |
| `WARN_REPEAT` | `Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.` |
```

with:

```markdown
| reason line | `Lý do: {reasonText(code)}` |
| `WARN_LOCK` | `Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.` (v16 adds "đánh bài") |
| `WARN_REPEAT` | `Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 10 of 13.** Replace:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat` |
| events heading | `Ghi nhận ({n})` |
```

with:

```markdown
| holdings heading | `Dữ liệu hiện có` |
| holdings line | `{formatXu(coins)} · {n} món đồ · {n} con cá · {n} kỷ lục · {kg} kg lúa · {kg} kg hoa màu · {n} thửa sở hữu · {n} thửa đang thuê · {n} đề nghị mua · {n} ô phơi · {n} tin khoe trong chat`, then `· {n} ghế bàn bài ({formatXu(chips + escrow)})` when the account sits at card tables (`0017`) |
| events heading | `Ghi nhận ({n})` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 11 of 13.** Replace:

```markdown
| `cast_daily_cap` | `Chạm 300 lần câu/ngày` |
```

with:

```markdown
| `cast_daily_cap` | `Chạm 300 lần câu/ngày` |
| `bad_game` (`0017`) | `Sai bàn bài` |
| `bad_seat` (`0017`) | `Số ghế sai` |
| `bad_stake` (`0017`) | `Mức cược sai` |
| `bad_cards` (`0017`) | `Lá bài sai` |
| `bad_bet` (`0017`) | `Tiền cược sai` |
| `bad_move` (`0017`) | `Nước đi sai` |
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 12 of 13.** Replace:

```markdown
  - `save_character`, and `upsert_video_lyrics` and `update_video_lyric_offset` in both their `0011` and their `0014` signatures;
  - `fishing_state`, `fishing_board`, `field_state`.
- **The check checks itself:** in a transaction that is rolled back, an unguarded overload `login(text, text, integer)` must be reported.
```

with:

```markdown
  - `save_character`, and `upsert_video_lyrics` and `update_video_lyric_offset` in both their `0011` and their `0014` signatures;
  - `fishing_state`, `fishing_board`, `field_state`;
  - from `0017`: `card_lobby`, `card_state`, `card_hand`, `card_tick` and `card_leave`.
- **The check checks itself:** in a transaction that is rolled back, an unguarded overload `login(text, text, integer)` must be reported.
```

**docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md — edit 13 of 13.** Replace:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads; each must succeed.
```

with:

```markdown
  1. Register an account, create a room and set `locked_until` to now + 5 min.
  2. Call each of the guarded RPCs (35 in `0015`, 42 from `0016`, 48 from `0017`) with plausible arguments. Each must raise `account locked`.
  3. Then call the four reads (from `0017` also `card_lobby`, `card_state`, `card_hand` and `card_tick`); each must succeed.
```

- [ ] **Step 5: The final checks**

Run `pnpm test` (115 files passed / 13 skipped, 1 081 tests passed / 75 skipped), `npx tsc --noEmit` (clean), `npx eslint tests/integration/v16.test.ts` (clean), `pnpm lint` (the 33 baseline problems in the same 16 files, none in this plan's files) and `NEXT_PUBLIC_SUPABASE_URL=https://test.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_test_key pnpm build` (compiles; the static pages are generated). Run the SQL check once more: `bash "$SCRATCH/v16-sql.sh"` → `ALL OK`.

- [ ] **Step 6: Commit**

Commit message:

```text
docs(cards): the v16 README section, the anti-cheat spec amendments and the v16 integration test

README: the migration and the deploy order, re-running earlier migrations, what's new, play money, the trust model and
the realtime budget. The anti-cheat spec gains the card RPCs: the hard signals and bad_move, the lock list and the guard
file (48 RPCs), the wipe's card seats, WARN_LOCK, the admin labels, and rules 4 and 7. tests/integration/v16.test.ts
(skipped without SUPABASE_TEST_URL) reads the lobby, keeps outsiders out and, with two funded accounts, plays a 2-player
Tiến lên game to its settlement with the wallets' total unchanged.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
git add README.md docs/superpowers/specs/2026-09-25-music-together-anticheat-design.md tests/integration/v16.test.ts
git commit -F <message file>
```

After this commit the owner's steps remain: run `0017` in the SQL editor (after `0016`), deploy the client, and the manual pass of spec §17 with three accounts.
