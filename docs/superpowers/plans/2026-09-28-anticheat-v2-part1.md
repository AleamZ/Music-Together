# Anti-cheat v2, part 1: the net replay (#1, #2) and the server-side position (#3, #11, #14, #15)

**Source:** `docs/superpowers/specs/2026-09-28-anticheat-v2-audit.md` (rows 1, 2, 3, 11, 14, 15), the anti-cheat spec
(`2026-09-25-music-together-anticheat-design.md`: hard vs soft signals, R1 "a flagged call returns", R16 lock order) and
the reel precedent (0046: seed on the row, integer 60 Hz sim mirrored TS↔SQL, shared fixtures, hard flags on a bad input
or a mismatch, "outdated" for an old page).

**Branch:** `feat/anticheat-v2`. **Migrations:** `0056_net_replay.sql`, `0057_server_position.sql` (0053/0054 do not
exist; 0055 is the newest). Every re-created function is copied from its newest body; added lines end in `-- 0056` /
`-- 0057`, added blocks sit between `-- 0056 {` and `-- 0056 }`, a changed line ends in `-- 0056 was: <old line>`.
`tests/unit/anticheat-v2-sql.test.ts` strips the markers and compares with the source body.

## A. The net (0056)

### A1. What the server derives (lib/game/fishing/net.ts ↔ 0056, integer math only)

All scene coordinates are milli-pixels (1 scene px = 1000). 60 Hz ticks. `rand32` = the reel's mulberry32 on u32s.

| Thing | Rule |
|---|---|
| School seed | `start_net` rolls a u31 `seed` (kept in `net_throws.seed`, sent at once: the shadows swim while aiming) |
| Arrow seed | `start_net` rolls a second u31 `arrow_seed`; **secret until `net_haul`** answers the haul |
| School | 4 + 5 × 8 draws of `rand32(seed)`: school centre, amplitudes, periods (multiples of 4 ticks), per fish offsets, radii, periods, phase, size |
| `isin(t, P)` | a parabola per half period: `±4000·u·(P/2 − u) / (P/2)²` ∈ [−1000, 1000] (≈ 1000·sin 2πt/P) |
| Shadow at tick t | school centre + `ax·isin/1000` …, clamped to x ∈ [6 000, 154 000], y ∈ [8 000, 74 000] |
| Power period | `P = 2·(33 + u % 7)` ticks (1.1–1.3 s) from the seed's first draw |
| Quality (‰) | `ph = charge mod P`, `q = 4000·ph·(P − ph) / P²` (0 … 1000); sweet ≥ 850 |
| Aim | integers, x ∈ [4 000, 156 000], y ∈ [8 000, 74 000], `(x−80 000)² + (y−84 000)² ≤ 70 000²` |
| Landing | `k = q ≥ 850 ? 1000 : 450 + 550·q/850`; `hands + (aim − hands)·k/1000`, y ≤ 76 000 |
| Radius | `full = 14 000 + (max(24, radius_px) − 24)·500`; `r = full·(4000 + 6q)/10 000` |
| Inside | `9·dx² + 25·dy² ≤ 9·r²` (the 0.6-deep ellipse) |
| Land tick | `release + 42` (the 700 ms flight); the net sinks 90 ticks |
| Catch | `base = min(5, 2 + (3q + 500)/1000 + big)`, `count = max(0, base − (5 − hits))` (0034's rule) |
| Arrow plan | `dg = Σ(rarity·1000 + weight_g)`: rounds `clamp((dg+1000)/2000 + 1, 2, 5)` (0037's), keys `clamp(4 + dg/3000, 4, 9)`, timer `clamp(252 − dg·48/10 000, 180, 252)` ticks |
| Sequences | round r: `rand32` from `(arrow_seed + 7919·r) mod 2³²`, arrow = `u >>> 30` (up, down, left, right) |
| Arrow replay | a round's deadline is `start + timer`; a press first times out every round whose deadline ≤ its tick (each +1 mistake + its wrong keys, the next round starts at the deadline); a right key advances (the last one ends the round at that tick), a wrong one is a mistake; more than 3 mistakes ends it (kéo hụt, 4); all rounds done ends it. The end tick is where it ended |

### A2. The client's inputs

- `net_haul(token, throw, p_press, p_release, p_aim_x, p_aim_y, p_hits)`: the ticks (from the moment the start_net
  answer arrived) of the press and the release, the aim at release (milli-px), and the client's hit count.
- `finish_net(token, throw, p_keys int[], p_ticks, p_mistakes)`: each press `tick·4 + arrow` (ticks from the moment the
  haul answer arrived), the end tick and the client's mistake count.

### A3. Server checks

| Check | Outcome |
|---|---|
| haul: press < 0, release < press, release > 3 600, aim out of bounds/range, a null | lost `net_invalid`, **hard** `net_bad_input` |
| haul: replay hits ≠ `p_hits` | lost `net_invalid`, **hard** `net_mismatch` (seed, inputs, replay) |
| haul: `now < started_at + 0.9·(release + 42 + 90)/60 s` | lost `too_early`, **hard** `net_too_fast` |
| haul: over 120 s after start | lost `expired` (as before) |
| finish: keys not ascending by tick, arrow code, > 64 keys, > 20 keys in 60 ticks, a key after the end, ticks ∉ 1…3 600 | lost `net_invalid`, **hard** `net_bad_input` |
| finish: replay mistakes/end ≠ claimed | lost `net_invalid`, **hard** `net_mismatch` |
| finish: `now < hauled_at + 0.9·ticks/60 s` (and 0037's 0.8 s × rounds) | lost `too_early`, **hard** `net_too_fast` |
| old signatures `net_haul(text, uuid, int, int[])`, `finish_net(text, uuid, int)`; a throw rolled before 0056 | lost `outdated`, message "Cập nhật trang để quăng lưới tiếp", no flag, nothing spent |

The mistakes then decide as in 0037 (0 all, 1–3 one random escape each, 4 overboard).

### A4. Flow change (rulings)

- **N1** `start_net` is called when the aim opens (the seed must exist while aiming). It checks what it checked (spot,
  storm, vitals, owned net, bucket) but **spends nothing**; Esc still costs nothing (the next `start_net` replaces the
  row). The net's use and the throw's hunger/thirst (0047: 3 / 3.5) are spent by `net_haul`, before it judges.
- **N2** The school clock starts when the `start_net` answer arrives; a release is allowed up to tick 3 600 (60 s). At
  3 000 ticks of aiming the overlay closes with "Lưới trôi mất rồi" (no throw spent).
- **N3** Re-rolling the school by reopening is possible and accepted: the catch is still capped at 5, and the real-time
  gates and vitals keep the pace human.

## B. The server-side position (0057)

### B1. Model (rulings)

- **P1** `player_pos(account_id, map, x, y, at, skip_at, bad_since, bad_count)`: the last **accepted** claim.
- **P2** Every place a client says where it is becomes a claim, checked against the last accepted one:
  `vitals_tick` (map, x, y), the new `pos_report(token, map, x, y)` (sent on every map arrival), `start_cast` /
  `start_net` (the cell centre on `pond`), `jump_in` / `rescue_swimmer` (the cell centre), `sell_*_market` (the depot's
  use point on `market`).
- **P3 Plausibility:** the least time to get there = the shortest path over the portal graph (≤ 3 hops; the portal's use
  point on one map → its arrive spot on the next), walking at **VMAX = 260 px/s** (walk 70 × car 2.8 × pet 1.2 ×
  rest 1.07 ≈ 252), minus **64 px + 40 px per hop** of slack, plus **1.8 s per road hop** (hall↔market,
  market↔khu_nha: 0.9 × the car's 2 s; 0 once `skip_trip` was paid since the last claim). Accepted when it is ≤ the
  seconds since the last claim **+ 2 s**. Always accepted: the first claim ever, and the hall's spawn (612, 300) ± 16 px
  (entering game mode and a faint both start there). An unknown map or a point off the map is refused.
- **P4 A refused claim** leaves the position as it was, logs the soft `pos_teleport` (from, to, seconds, need) and counts:
  the **30th refusal within an hour** is the hard `pos_teleport_repeat`. The caller returns the envelope (R1): a cast,
  throw or sale answers `too far` / `not at market`; the heartbeat carries on with the old position.
- **P5 Uses:** `vitals_tick` judges the shade, the rain and the swim from the server position (none known = outdoors);
  `sell_fish_market` / `sell_rice_market` / `sell_produce_market` claim the depot on `market`; `start_cast` /
  `start_net` claim their cell (a cast without a cell is refused `bad spot`: every client since v18.1 sends one);
  `rescue_swimmer` claims the rescuer's cell and needs the victim's server position on the pond within
  28 + 64 px + 35 px/s × its age (≤ 20 s).
- **P6 Lock order:** `player_pos` before the wallet, before `anticheat_status` (`skip_trip` marks `skip_at` before its
  wallet lock).
- **P7 Real-time drain:** `_vitals_apply` (all three overloads) credits the real seconds since the last tick up to
  **1 800 s** (was 120): ticks that stop no longer stop hunger; a longer gap is a logout and drains its first 30 min.
  The rain's wet clock keeps its 120 s.

### B2. Client

- `lib/game/position.ts`: `posReport` (the RPC) and the TS mirror of the portal graph constants the SQL uses, pinned
  against `getMap()` by `tests/unit/anticheat-v2-position.test.ts` (portals, arrive spots, the hall spawn, the depots).
- GameShell reports the arrive spot (or the hall spawn) whenever the map changes.
- Texts: `too far` (fishing, net, rescue), `not at market` (the market depots). The heat RPCs screen the envelope.
- `TICK_CAP_S` = 1 800.

## C. Tests

- `scripts/gen-net-fixtures.ts` → `tests/fixtures/net-cases.json` (hauls and arrow games; `WRITE_NET_FIXTURES=1`),
  `tests/unit/fishing-net-replay.test.ts`, updated `fishing-net.test.ts`, `use-fishing.test.tsx`.
- `tests/unit/anticheat-v2-sql.test.ts`: re-created bodies = source + markers; SQL constants = TS constants.
- `tests/sql/anticheat-v2-net-smoke.sql`: the fixtures through `_net_haul_replay` / `_net_arrow_replay`, the RPC flow
  (honest haul and finish, too fast, bad input, mismatch, outdated, spend at haul).
- `tests/sql/anticheat-v2-position-smoke.sql`: claims (walk, portal, road, skip, teleport, repeat → hard), shade from the
  server position, market sells, casts, rescue, the 30-min drain.
- Throwaway PG18 on :54356, all migrations in order, the two smokes, then the existing smokes that still apply.

## D. Tasks

1. TS net sim + fixtures + tests (red → green).
2. 0056 + net smoke.
3. Client net (rpc, controller, overlay) + tests.
4. 0057 + position smoke.
5. Client position (report, texts, tick cap) + tests.
6. Full vitest, `tsc --noEmit`, eslint on touched files, PG chain + smokes, report, commits.
