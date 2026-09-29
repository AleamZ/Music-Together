# v22 group "explore" — report (migration 0086_explore_minigames.sql)

## What was built

### Sông Cái (owner's scope change: the boat sails out to a new river map)
- **Map `song_cai`** (960 × 480, level 3, `lib/game/maps/song-cai.ts` + `song-cai-art.ts`): reedy banks, a wide river
  (deeper in the middle), four rocks, a small island with a palm, three named shoals (Bãi Lau, Ghềnh Đá Đỏ, Vũng Ngát),
  the west jetty (Bến sông, ông Năm đò, a lantern), animated current streaks, drifting lục bình, shoal bubbles. The
  walkable cells are the water. Registered everywhere a map is listed: MapId/MAP_IDS, registry, city overview
  (+ a `BOAT_ROADS` pond–song_cai road), MapCounts, MiniMap, presence, weather ripples, `MAP_MIN_LEVEL` (3), no vehicles
  (`canRide`), no heat (`BREEZY_MAPS`, matching 0051's `_in_shade`, which treats an unlisted map as shaded).
- **Server**: `_pos_maps` re-created (0072's newest + the song_cai row). There is deliberately **no portal**: only
  `river_row_finish` moves the server position between Cầu ao's pier and the river (`_river_move`, the same writes as
  `_pos_claim`'s accepted branch incl. 0058's tab track), so a walking claim onto the river is `no_path`. Boat ownership,
  the storm and the level are checked in `river_row_start`. `_river_water` (lenient by the 8 px hull) and `_river_shoal`
  mirror `lib/game/river/geometry.ts`.
- **In the boat**: on song_cai every actor on water is drawn in a ghe (engine `drawActor` → `lib/game/river/art.ts`:
  hull cut at the gunwale, bob on the swell, wake while moving, alternating paddle).
- **Fishing on the river**: E anywhere on the water (engine `riverInteractable`) → the usual cast session, routed by
  `useFishingController` to `start_river_cast(x, y)` (0076's start_boat_cast body from the boat's claimed spot; spot
  `'boat'` → 0076's `casts_zz_water` keeps rarity 3+ to the deep-water table; a shoal lifts a common roll to 3 one time in
  three instead of five). Hook/reel/finish are the unchanged verified chain. Five river species added (Cá lăng, Cá ngát,
  Cá dứa, Cá anh vũ, Cá vồ đém — rarity 3–5, priced like 0076's deep species).
- `start_boat_cast` / `board_boat` refuse `'outdated'` (the moored ghe is now the dock). `buy_boat`, `leave_boat` stay.

### Chèo ghe (the rowing rhythm minigame)
- `lib/game/river/row.ts` ⇄ `_row_round` / `_row_replay` / `_row_input_error`: 12 beats after a 90-tick lead-in, gaps
  34–54 ticks, sides alternate except 1 in 5; a stroke (tick·2 + side) hits within ±11 ticks on its side; pass = hits ≥
  need (8 out, 6 home) and ≤ 6 strays. Fixtures `tests/fixtures/row-cases.json` (33 cases, `scripts/gen-row-fixtures.ts`)
  checked by Vitest and the SQL smoke.
- `river_row_start(dir, x?, y?)` (pier claim / water claim, 4 stamina 'fish', secret seed) → `river_row_finish(strokes,
  ticks)`: hard `row_bad_input` / `row_mismatch` / `row_too_fast` (0.9 × ticks/60), soft `row_timing` (≥ 10 hits all
  within a tick; 5th in 24 h hard), `_ac_stat('row')`, event `river_row`. A missed row out drifts back (retry); the way
  home always arrives (nobody stranded).
- UI `components/game/river/RowGame.tsx`: pixel canvas scene (scrolling banks, bobbing ghe with wake, beats coming down
  two lanes, "Chuẩn!/Lệch!", 3-2-1 countdown), ← → / A D / two big touch buttons, reduced-motion still frame. The pond's
  Bến ghe panel has "🛶 Chèo ra Sông Cái"; on the river a "⚓ Chèo về bến" bar and the jetty (`river_dock`) row home.

### Treasure maps: detector + shovel + chest
- `treasure_ping(map_id, map, x, y)`: claims the position, answers only a distance band 0–7 (`_treasure_band`), ≥ 0.4 s
  apart, ≤ 800 pings a map. The client pings while walking (every 0.5 s after ≥ 6 px, or 2.5 s idle); `DetectorHud`
  shows signal bars, a pulsing ring and a beep that quickens (Web Audio, `lib/game/river/beep.ts`).
- `treasure_dig_start` on the spot (≤ 16 px; 4 s cooldown; 3 stamina 'mine'; else hot/warm/cold as before) rolls the
  loot within 0076's bounds and a seed; the shovel is 0072's dig sim reused (`_mine_replay` / `_mine_input_error` /
  `_mine_timing`, need 3, win 120) → `treasure_dig_finish` (hard `treasure_bad_input` / `treasure_mismatch` /
  `treasure_too_fast`, soft `treasure_timing`), pays `'treasure'`, a clean dig +10 % capped at 2 500, the 8 000 jackpot
  unchanged; `treasure_found` + `xp_grant` 50 as before. A failed dig keeps the map. `dig_treasure` refuses `'outdated'`.
- UI `ShovelGame` (a pit that deepens, the blade sweeping the dirt bar) and `ChestReveal` (shake, lid flips, glow,
  coin burst, the loot counts up, fanfare).

### Animations (no minigame)
- `components/game/celebrate/Fx.tsx`: Confetti, CoinBurst, CoinFly, BigPop, CountUp, FillBar, RewardPop, TradeDoneFx,
  `useBump` — CSS-only, reduced-motion safe.
- Fishing battle: 3-2-1-"Câu!" start countdown over the world, score rows flash + float "+N", crown bounce, winner
  fanfare with confetti and the prize counting up (`useFishingExtras.battleResult`).
- Quests / NPC hand-in / company claim and the login calendar: RewardPop chest with coin burst; progress bars and the
  company goal fill with a shine; today's calendar tile pulses.
- Player market: live auction clocks (red, pulsing in the anti-snipe minutes; the modal polls every 8 s), coins fly to the
  purse when my listing / auction sells, confetti when I win an auction; a finished trade celebrates (`useTrade.done`).
- Photo mode: shutter click + white flash, the shot slides in as a polaroid and "develops".
- Dev page `/dev/river-art` (404 in prod): the painted river with boats, and each minigame on a fixed seed.

## Tests
- SQL: throwaway PG18 on port 54386 — chain 0004…0082 (0014 before 0013), then 0086 twice; `tests/sql/v22-explore-smoke.sql`
  (geometry/gate, 33 row fixtures replayed, rowing flow incl. no-portal/lock/no-boat/too-fast/mismatch/bad-input/drift/
  expired/home, 30 river casts, detector bands/rate/wrong map, dig too-fast/pass/clean loot/ledger/event/fail keeps map/
  mismatch, outdated RPCs, privileges, wipe) passes twice; `anticheat-guards.sql` passes. README line added.
- Vitest: `tests/unit/river.test.ts` (17) + updated city-map, game-hud-travel, presence-mode, v21-progression,
  anticheat-v2-position; with heat, v21-fishing, mining, economy, quests, map tests: all pass. `tsc` clean, eslint clean.
- Browser: `/dev/river-art` checked visually (river, boats with hulls, row scene, chest).

## Known gaps / notes
- `v21-fishing-smoke.sql` expects 0076's boat/dig bodies: run it before 0086 (or re-apply 0086 after it) — noted in the
  README line.
- No river current pushing the boat (visual streaks only) — movement speed stays the walk speed so the server's
  position speed check is unchanged.
- The in-game flow (row → travel → cast on the river → row home; detector → dig → chest) was not played end to end in a
  logged-in room (the dev server talks to hosted Supabase); covered by the SQL smoke and unit tests.
- The end-on (up/down) hull is a simple boxy ghe; the side view is the nicer one.
