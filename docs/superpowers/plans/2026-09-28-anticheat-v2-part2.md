# Anti-cheat v2, part 2: secret seeds (#4, #5, #7), the farm minigames (#8, #9, #10), one position follow-up

**Source:** `docs/superpowers/specs/2026-09-28-anticheat-v2-audit.md` rows 4, 5, 7, 8, 9, 10; part 1's report (residual
risk "two windows side by side"). Precedents: 0046 (the reel replay), 0056 (the net: seeds, 60 Hz integer sims mirrored
TS↔SQL, shared fixtures, hard flags on a bad input / a mismatch / too fast, `outdated` for an old page), 0057 (claims).

**Branch:** `feat/anticheat-v2`. **Migrations:** `0058_pos_tabs.sql`, `0059_reel_hook.sql`, `0060_fight_secrets.sql`
(#5 and #7 share `dojo_kata_submit`), `0061_harvest_replay.sql`, `0062_crab_replay.sql`, `0063_sling_replay.sql`. Every
re-created function is its newest body (grep of all migrations, 0056/0057 included) plus marked lines (`-- 00NN`,
`-- 00NN {` … `-- 00NN }`, `-- 00NN was: <old line>`); `tests/unit/anticheat-v2-sql.test.ts` strips the markers and
compares. No ledger reason is added (none of the items moves money in a new way).

## T. Two windows of one account (0058)

- **T1** Every request carries the page's tab id: `lib/supabase.ts` adds the global header `X-Tab-Id` (a random id per
  page load). `_pos_tab()` reads it from `request.headers` (≤ 64 chars; none = a legacy caller). No RPC signature changes:
  every claim (heartbeat, `pos_report`, casts, sales, the farm) goes through `_pos_claim`.
- **T2** `player_pos.tab` = the primary tab = the newest one; `player_pos.tabs` = each recent tab's own last accepted claim
  (at most 4, none older than 1 h).
- **T3** A claim from the primary tab, with no tab, or the first claim ever: 0057's rule. A claim from a tab never seen
  before: the newest tab — judged by 0057's rule against the account's position; accepted, it becomes the primary.
  A claim from an older known tab: judged against **that tab's own** last claim; accepted, only its track moves (the
  account's position — shade, rain, market — stays the primary's); refused, the caller gets the refusal envelope with
  strike 0 and **nothing is logged or counted** (no `pos_teleport`, no step towards the hard repeat).
- Residual: a script can keep two plausible tracks; each still has to respect VMAX on its own.

## A. The reel's secret seed (#4, 0059)

- **R1** `start_cast` (0057's) keeps `reel_seed` on the row and no longer answers it. A page before 0059 therefore sends
  no reel input and gets 0046's `outdated` (no flag).
- **R2** `hook_cast(token, cast)` (new): the server-timed hook. Refused: no bite (`no_bite`), before `bite_at`
  (`too_early`, soft `reel_early_hook`; an honest client's timer starts after the answer, so it is always later), after
  `bite_at + window + 3 s` (`missed`). A refusal ends the cast (the bait is gone, as a miss). Accepted: `hooked_at = now()`
  and the answer carries `reel_seed`. The reel's tick 0 is the answer's arrival.
- **R3** `finish_cast` (0046's): `hooked` is derived: `hooked_at is not null` (`p_hooked` is ignored). A won reel needs the
  hook (else `reel_invalid`, hard `reel_unhooked`); the real-time gate counts from `hooked_at` (was `bite_at`).
- **R4** Abandoning a hooked cast (a new `start_cast` / `start_net` replaces it): `_cast_settle_hooked` charges it as a
  reel given up — the hook's wear and, for a big fish, 0034's overboard cost (rod wear or loss, hunger) without the fall.
  The answers carry `abandoned`.
- **R5** Toggle statistics on a replay-won reel: `n` flips, `fast` = gaps ≤ 2 ticks, the gaps' spread. Soft `reel_timing`
  when `n ≥ 10 and 4·fast ≥ n` (flips faster than a finger) or `n ≥ 12 and sd(gaps) < 0.5 tick` (a metronome). The 5th
  soft one within 24 h is the hard `reel_timing_repeat` and that catch is voided (`reel_invalid`).
- Client: `hookCast` (rpc, `useFishing`), `useCastSession.hook` waits for the answer (phase "bite" until then) and starts
  the reel with the answered seed; a refusal ends the cast with its text.

## B. The bots' secret RNG (#5, 0060)

- **B1** Bot matches (`exam`, `ug_ladder`) are made with `seed: 0` and `secretBot: true` in their params: the canonical
  state's `G_RNG` / `G_SEED` are 0 and stay 0. The bot's rolls come from a stream outside the state:
  `_fx_bot_seed(match, round)` = the first 32 bits of `md5(secret ‖ match ‖ round)` (`ac_secrets`, one random row, no
  grants), re-seeded whenever the round changes, carried between pushes in `fight_matches.bot_rng` / `bot_round`, never
  answered. `_fx_step_secret(s, a, b, m, rng)`: puts the stream into `G_RNG`, steps `_fx_step_bots`, takes it out
  (`G_RNG := 0`) and returns `s ‖ rng'` — mirrored by `stepWithSecretBots` in `lib/game/fight/bot.ts`
  (`tests/fixtures/fight-secret-cases.json`).
- **B2** `fight_push` (0052's): for a secret match the hash is not compared (no `fight_hash_mismatch`), and every answer
  carries the public `sim` so the client resyncs on each push. A match started before 0060 (no `secretBot`) is unchanged.
- **B3** Superhuman: besides the fast reactions (a new button / block 1–4 frames after the bot's move start) the push counts
  a control window (5–8 frames; `ac[5]`). A random masher hits both alike; a foresight/auto-reaction bot hits 1–4. Hard
  `fight_superhuman` when `fast > 24 and fast > 3·control + 8` (once, `ac[6]`); the match is settled as the player's loss
  (`forfeit`): no belt, no floor.
- **B4** Client: `RefereedMatch` for a secret match runs the local bot on a decoy stream (display only), sends no hash and
  resyncs from every push answer's `sim`. The outcome is the server's.

## C. The kata's progressive chart (#7, 0060)

- **K1** The seed never leaves the server: `dojo_exam_start` and `_dojo_json` answer `kata_length` (the chart's end tick)
  instead of `kata_seed`. `dojo_kata_notes(token, exam)` answers the notes whose tick ≤ the server's elapsed ticks since
  the exam started + **240** (4 s ahead; the lanes show 2 s). The client asks whenever its known notes end within 150
  ticks of its clock (about once a second); the start answer carries the first ones.
- **K2** Timing noise: `_kata_offsets` = the signed Δ of every judged press (the scorer's matching). Soft `kata_robotic`
  with ≥ 24 judged and `sd < 0.75` tick (integers: `16·(n·Σd² − (Σd)²) < 9·n²`); the 3rd within 30 days is the hard
  `kata_robotic_repeat`, which fails the attempt. The soft `kata_perfect` stays.

## D. The farm minigames (#8 0061, #9 0062, #10 0063)

All three: the server rolls the seed; 60 Hz integer sims (`lib/game/farm/minigames.ts`, `sling.ts`) mirrored in SQL,
pinned by `tests/fixtures/{harvest,crab,sling}-cases.json` (`scripts/gen-farm-fixtures.ts`); the client's claim
(`success`, `hits`, `hit`) must equal the replay (else hard `*_mismatch`, no reward); malformed input → hard
`*_bad_input`; sooner in real time than 0.9 × the replayed ticks → hard `*_too_fast`. Old signatures: a failure/0/miss
is still accepted as before, a success raises `outdated` ("Cập nhật trang…").

- **H (harvest)** `begin_work` (0018's `_farm_do_begin_work`) stores `crops.work_seed` and answers `work_seed`. Sim:
  8 centres `620 + u % 161` ‰; the bar fills in 72 ticks (level ‰ = charge·1000/72), auto-cut at 72 (then let go to arm),
  beat 21 ticks; score in half points (Δ ≤ 70 → 2, ≤ 170 → 1), pass ≥ 8; toggles as the reel's (flip before stepping that
  tick); ≤ 7 200 ticks. `harvest_part(room, token, plot, toggles, ticks, pass)`; a pass is also a claim at the plot's use
  spot (`_field_plot_use`, pinned against `lib/game/maps/field.ts`); a fail clears the record as before.
- **C (crab)** `crab_start` answers `visit.seed` (`gather_cooldowns.visit_seed`) and claims the hole's use spot. Sim:
  periods 72/57/45 ticks, phase `u % P`, lead 36, beat 30, closed when `10·((ph + t) mod P) ≥ 6P`, a slip after 4 P;
  grabs are the step indices of the presses. `crab_finish(room, token, visit, grabs, ticks, hits)` replays up to `ticks`
  (Dừng after a try ends early) and claims the hole again.
- **S (sling)** `sling_start(room, token, rat, x, y)`: a claim where I stand, within 96 px of the rat's plot; the aim gets
  a seed (answered), `last_tick` 0 and the rat's lane state. The rat runs one continuous path from the seed (ticks since
  the start answer): stops 12–36 ticks, runs 30–72 ticks at 1 000–1 833 mpx/tick, turning back 35 %, bouncing at
  16 000 / 304 000. A shot: press `p` > the last shot's landing, release `r` ∈ (p, p + 60], aim `a` ∈ the lane (mpx);
  power ‰ = min(1000, (r − p)·1000/60); it lands at `f = r + 18`: short < 600, over > 850, else a hit when
  |rat(f) − a| ≤ 9 000. `sling_shoot(room, token, rat, press, release, aim, hit)` replays from the cached state to f.
  0019's 2 s / 60 s gates stay.

## E. Tests and verification

- Vitest: the sims against the fixtures, the rpc parsers, the controllers/overlays, the SQL marker test for every
  re-created body, the TS↔SQL constants (plot/hole use spots, reveal window, thresholds).
- SQL smokes (throwaway PG18 :54358, all migrations in order): `anticheat-v2-tabs`, `-reel-hook`, `-fight-secrets`,
  `-farm` (fixtures through the SQL sims + the RPC flows: honest, bad input, mismatch, too fast, outdated, position);
  part 1's two smokes again; the existing smokes that still apply.
- Full vitest, `tsc --noEmit`, eslint on touched files.

## F. Tasks (each commit compiles and passes)

1. T: 0058 + client header + smoke. 2. A: 0059 + fishing client. 3. B + C: 0060 + fight/kata client. 4. H. 5. C. 6. S.
7. Full verification, report.
