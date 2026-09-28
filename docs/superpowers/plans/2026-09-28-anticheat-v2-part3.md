# Anti-cheat v2, part 3: the minimum build, the statistics, the pet and the song (#12, #13), PvP lag and look-ahead (#6)

**Source:** `docs/superpowers/specs/2026-09-28-anticheat-v2-audit.md` rows 6, 12, 13 and its cross-cutting additions
(earnings-rate and win-rate statistics, the optional auto-blacklist on 0055, minimum client build); part 2's report
(residual risk: the farm minigames have no timing statistics; the stale smokes).

**Branch:** `feat/anticheat-v2`. **Migrations** (each ADDITIVE and re-runnable, each run after the previous one):
`0064_client_build.sql`, `0065_ac_stats.sql`, `0066_pet_song.sql`, `0067_pvp_lag.sql`. Every re-created function is its
newest body (a grep over all migrations) plus marked lines (`-- 00NN`, `-- 00NN {` … `-- 00NN }`, `-- 00NN was: <old>`);
`tests/unit/anticheat-v2-part3.test.ts` strips the markers and compares, as the part 1–2 tests do. No ledger reason is
added (nothing moves money in a new way).

## M. The minimum client build (0064)

- **M1** The build id becomes orderable: `next.config.ts` makes it `YYYYMMDDHHmm` (UTC build time) followed by `-<sha7>`
  when the host gives a commit. `X-Client-Info` stays `music-together/<build>`.
- **M2** `anticheat_config` gets `min_client_build bigint default 0` (0 = off). `_client_build()` reads the 12 leading
  digits after `music-together/` in `request.headers`' `x-client-info` (none, `dev` or a bare sha = 0).
- **M3** `_ac_guard` (0015's): after the lock, `min_client_build > 0 and _client_build() < min_client_build` raises
  `client outdated` (22023, hint `build`, detail = the minimum). Every guarded game RPC (`_ac_account` / `_ac_play`:
  sales, casts, nets, the farm, crabs, rats, cards, the daily gift, dojo exams, the ring) inherits it; so does `pet_tick`
  (N below). The song bonus checks the build stamped on the queue row (S below).
- **M4** `admin_anticheat_config(token, patch)` (root): `min_client_build`, `auto_blacklist`, `auto_blacklist_hard`,
  `stats_enabled`; answers the config. The admin panel offers "đặt bằng bản đang chạy".
- **M5** Client: `lib/client-build.ts` (the build id, its number, `isOutdated(err)`); the supabase client's `fetch`
  notices a `client outdated` answer and raises the `mt:outdated` event; `components/OutdatedBanner.tsx` (mounted in the
  root layout) shows "Trang đã cũ — Cập nhật trang" with a reload button.

## A. Statistics and the auto-blacklist (0065)

- **A1** `ac_play_stats(account, vn day, game, plays, wins, exact)`; `_ac_stat(account, game, plays, wins, exact)`.
  Recorded by the replayed RPCs (re-created with one marked block each):
  | game | RPC (newest) | play | win | exact (perfect input) |
  |---|---|---|---|---|
  | reel | `finish_cast` 0059 | a hooked reel | caught | caught in ≤ ⌈0.06·min_reel_ms⌉ + 2 ticks (never out of the zone) |
  | net | `net_haul` 0056 | a replayed throw | ≥ 3 shadows | all 5 shadows |
  | harvest | `harvest_part` (6 args) 0061 | a replayed round | pass | ≥ 7 of 8 cuts within 14 ‰ of the band's centre |
  | crab | `crab_finish` (6 args) 0062 | a replayed game | 3 hits | 3 hits, each on the first open tick |
  | sling | `sling_shoot` (7 args) 0063 | a replayed shot | hit | the rat within 1 500 mpx of the aim at landing |
  Kata and fights need no recording: `martial_exams.kata_score` and `fight_matches` hold them.
- **A2** The farm's timing statistics (the missing ones): `_harvest_timing(seed, toggles)` = {cuts, exact};
  `_crab_timing(seed, grabs, ticks)` = {hits, exact}. Soft `harvest_timing` (8 cuts, ≥ 7 exact) / `crab_timing` (3
  hits, 3 exact) / `sling_timing` (≥ 20 shots today, ≥ 70 % exact; once a day). Hard: the 5th `harvest_timing` or
  `crab_timing` in 24 h (`*_timing_repeat`, that round is voided: no cut / no crab), the 3rd `sling_timing` in 7 days
  (`sling_timing_repeat`, that shot is a miss).
- **A3** `_ac_stats_run()` (the job) writes `ac_stat_flags(account, kind, key, value, baseline, n, detail, first_at,
  last_at, hits, reviewed_at)` and one soft `stat_outlier` event per flag and day:
  - **win / exact rates, 7 days**, per game (the five above + `kata` from `martial_exams` + `pvp`, `ladder`, `exam` from
    `fight_matches`): the population's rate without the account (leave-one-out). `stat_win_rate`: n ≥ 40 (kata 5,
    fights 20), binomial z ≥ 4 and rate ≥ p + 0.15. `stat_exact_rate`: n ≥ 30 (kata 5), z ≥ 4 and ratio ≥ max(q + 0.2,
    2q).
  - **earnings, 24 h**, per source (`sell`, `rice_sell`, `produce_sell`, `critter_sell`, `rat_sell`, `pet_find`, `song`,
    `fight_win`, `ug_prize`): `stat_earnings` when ≥ 5 000 xu, ≥ 3 × the others' p95, ≥ 10 × their median, with ≥ 5
    other earners. The detail carries xu/hour over the account's active hours.
  - **marathon**: ≥ 20 distinct hours of the last 24 with game income (not `pet_find` / `song`) → `stat_marathon`.
  - It runs lazily: `_ac_stats_maybe()` from the pet heartbeat (N) at most every `stats_every_min` (15) minutes, one
    caller at a time (`ac_stats_state` row, `for update skip locked`); root runs it on demand.
- **A4** Auto-blacklist (config `auto_blacklist` default **on**, `auto_blacklist_hard` default **8**): an AFTER INSERT
  trigger on `anticheat_events` for a hard outcome (`log_only`, `in_lock`, `strike_1`, `strike_2`) blacklists (0055) a
  non-root account with ≥ 8 hard events in 30 days on ≥ 2 Vietnam days, counted after the last manual unblacklist
  (`anticheat_status.blacklist_cleared_at`); it logs the soft `auto_blacklist`. Statistics never count toward it.
- **A5** Admin (root): `admin_anticheat_stats(token)` (config, last run, every account with an open stat flag or on the
  blacklist: its flags, its 7-day games, its 24-h income), `admin_anticheat_stats_run(token)`,
  `admin_blacklist_set(token, account, on, note)`, `admin_stat_review(token, account)`. UI: `StatsPanel` in the
  anti-cheat tab.

## N. The pet (#12) and S. the song (#13) (0066)

- **N1** `pet_tick(token, room)` (new; 0036's body): `_ac_account`; the sóc forages only with a live heartbeat — the
  last accepted position claim or `vitals_tick` (`heat_state.last_seen`) within **90 s** — and a membership of that room;
  otherwise the answer says `idle` (`no_heartbeat` / `not_member`). It calls `_ac_stats_maybe()`. The old
  `pet_tick(token)`: `_ac_account`, never pays, answers `outdated`. Client: `usePets(token, roomId, …)`.
- **S1** `queue_items.client_build` and `video_durations(video, account, seconds)`: a BEFORE INSERT trigger stamps the
  adder's build and records the claimed duration (one per account and video).
- **S2** `_song_bonus` (0015's): the play time is the server's — `least(now − item_began_at, the room's timeline
  position)` (a seek forward or a forged `started_at` is capped by the wall clock; a pause stops it). Paid when that is
  ≥ 60 s and ≥ 0.75 × max(claimed, the other accounts' median claim when ≥ 2 others claimed it). No pay and a soft flag
  when the claim differs from the others' median by > max(15 s, 10 %) (`song_duration_mismatch`) or the timeline ran
  > 30 s past the claim (`song_duration_short`). No pay under the minimum build.

## P. PvP (#6, 0067)

- **P1** Server lag: `fight_logs.lag_n, lag_sum, lag_max, late_frames`. Each ring push that advances the frontier
  records lag = server frames since `started_at` − the new frontier; `late_frames += min(new frames, lag − 30)` when
  lag > 30 (0.5 s beyond the clock: latency, the input delay and the 1-s push batching fit inside).
- **P2** `_pvp_settle` (0051's): the stall blame is the server's — a side is blamed when its `late_frames` × 5 >
  max(frames, 600) and it is later than the other side (the laggard, not the stalled victim). `p_stall` stays in
  `stall_frames` as the client's claim (evidence only).
- **P3** Look-ahead (instead of commit-reveal: the opponent's inputs travel peer to peer every 100 ms, so a commit only
  binds after they are seen, and withholding my inputs until the peer commits would add a batch of latency to every
  frame): in `fight_push` (0060's) each ring frame stepped counts, per side, a new button / block 1–4 frames after the
  opponent's attack start (fast) and 5–8 frames after it (control) — `fight_logs.rx`. With rollback and an input delay
  of 2–6 frames an honest reaction lands ≥ 10 frames after the start, so both windows fill only by chance and alike; a
  side that sees the opponent's inputs early fills the fast one. Hard `fight_lookahead` when fast > 24 and fast > 3 ×
  control + 8; the match is settled as that side's loss (`forfeit`). The evidence carries the counts and the lag.

## T. Stale smokes

- `v20-2`: the kata presses get ±3-tick noise (`kata_robotic` since 0060); the 300-frame chunk limit 150 → 300 ms.
- `reel-verify`: no `\i 0046` (it put 0046's `finish_cast` back on the full chain); `start_cast` claims a cell and no
  longer answers the seed — `hook_cast` does; the fixture casts are hooked.
- `anticheat-guards`: the allowlist and the dynamic list refreshed for 0016–0067.
- `tests/sql/README.md`: how to run the smokes on a full chain, in which order, and why.

## V. Verification

Vitest (marker tests, client build, fetch hook, banner, pets hook, admin panel, fight constants), `tsc --noEmit`,
eslint on touched files; throwaway PG18 on :54364 (initdb --auth=trust), all migrations, every smoke that should pass
on the full chain, stop and delete.
