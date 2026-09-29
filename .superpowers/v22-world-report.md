# v22 group "world": report

Migration: `supabase/migrations/0083_world_minigames.sql` (re-runnable). I verified it on a throwaway PG18 cluster on port 54383.
The chain was 0004 … 0083, plus other agents' 0084/0085. 0086 failed with a syntax error in another agent's file, so it is not mine.
`tests/sql/v22-world-smoke.sql` applies 0083 twice and passes, with 64 fixture cases replayed plus the RPC flows. `anticheat-guards.sql` also passes.
The cluster has been stopped and deleted.

## What was built

### Wild animals (they replace `wild_act`)
- **`wild_start(token, spawn, action, map, x, y)`**
  - Keeps the same gates as before: server position, range 64/140 px, gone, cooldowns (hunt 4 s, trap 20 s, photo 2 s), 60 catches a day, one photo per animal, and "cannot".
  - Spends stamina through `_stamina_spend`: hunt 1, trap 1, photo 0.5.
  - Rolls the seed and stores one open round in `world_mg`. It returns `{game, spawn, species, danger, seed}`.
- **`wild_finish(token, a[], b[], ticks)`**
  - The server replays the inputs: `a` is shots, pulls or snaps; `b` is dodges or zoom toggles.
  - Hard flags: `wild_bad_input`, `wild_mismatch` (the end tick or input count differs from the replay) and `wild_too_fast` (< 0.9 × ticks).
  - An exact hunt shot raises the soft flag `wild_timing`.
  - If the round ends before the replay's end, it counts as given up (no reward).
- **Hunt**
  - The animal crosses a clearing on a seeded triangle path; faster species move faster.
  - An aim sweeps back and forth, and the wind shifts the landing point. Arrows fly for 20 ticks, so you must lead the target.
  - You get 3 arrows, at least 1 s apart. A hit scores 400–1000 by how close it lands.
- **Wolf/bear at night (dodge)**
  - The animal charges at a seeded tick, with a warning. Press E within 24 ticks before the charge to dodge.
  - If the hunt neither hit first nor dodged, you take the old penalty: hunger and thirst −8 plus the species' faint chance.
  - An abandoned or replaced dangerous round counts as taking the charge (`_wg_row`).
- **Trap ("đặt bẫy")**
  - The animal walks a trail in seeded segments: walk, pause/sniff, step back.
  - You pull the cord once. It catches when the animal is within ±40‰ of the trap.
  - Birds and fireflies use a faster net sweep with a ±60‰ zone. The animal escapes at the end of the trail.
- **Photo**
  - The animal moves across a viewfinder. E toggles zoom: the frame is tighter but scores more.
  - The animal looks at the camera for 30 of every 150–240 ticks, which adds a pose bonus.
  - You take up to 3 snaps and the best one counts. A photo is kept from 250. It earns the full old XP (xp/2) from 700, otherwise xp/4.
- **Economy stays within the old bounds**
  - A hit or catch gives a success chance of the species' base −20 + score × 40/1000, clamped to 5–95. That is ±20 around the old chance.
  - A miss catches nothing. A missed hunt still makes the animal bolt 50 % of the time.
  - Drops, XP and the daily cap are unchanged.
- Events are unchanged: `wild_hunt`, `wild_trap`, `wild_photo` (meta now includes `score`), and `xp_grant` with source `wild`.

### Boss and dungeon (they replace `boss_attack` and `dungeon_attack`)
- **`combo_start(token, 'boss'|'dungeon', ref, target, map, x, y)`**
  - Keeps the old gates: the arena and server position, boss up, room membership, the per-account cap; for the dungeon, the gate, the open run, joined and party.
  - New: a 2 s start cooldown and the stun check. Spends 2 stamina (`'fight'`). Returns the seed.
- **`combo_finish(token, keys[], dodges[], ticks)`**
  - Six rhythm arrows, each encoded as tick·4 + direction. The beats are 54–72 ticks apart (≥ the old 0.9 s cooldown).
  - Judging: ±10 ticks, "perfect" within ±3. A wrong direction misses and breaks the streak.
  - Damage per arrow is the old strike: 40–60 from server RNG × (1 + 0.15 × streak), up to ×1.75. A "good" arrow deals 75 %.
  - The existing caps, the phase-3 armour, boss HP locking, `_boss_payout` and `_dg_payout` all still apply.
  - The boss telegraphs a slam between arrows 2–4 (50-tick warning). Not pressing Space within 20 ticks gives the old strike-back (hunger/thirst −3) plus a 3 s stun.
  - Flags: `combo_bad_input` and `combo_too_fast` are hard. Every arrow on its exact beat raises the soft `combo_timing`; the 5th in 24 h becomes the hard `combo_timing_repeat` and the round deals nothing.
- Events are unchanged: `boss_hit` (qty = the round's damage, meta.combo = best streak), `boss_kill`, `dungeon_clear`, `xp_grant`.
- **Animation**
  - In the world, the boss sprite and HP bar shake on a hit, and red damage numbers rise and fade over the boss.
  - In the overlay, the boss sprite flashes and shakes and shows "Hoàn hảo!/Tốt/Trượt ×streak". The slam shows a red warning, then "Né được!" or "Choáng!". The final damage appears as a large number.
  - Dungeon monsters use their emoji icons, as the panel does.

### Old RPCs
`wild_act`, `boss_attack` and `dungeon_attack` keep their signatures and still check the session, but now raise `'outdated'`. The UI shows "Trò chơi đã cập nhật — tải lại trang nhé."

### Party and night market
No changes (no minigame was needed). In the world, wild animals now stand still when they barely move instead of stepping in place.

## Client
- **Pure sim:** `lib/game/realm/minigames.ts`, mirrored statement for statement by the `_wg_*` functions. Copy lines are in `lib/game/realm/mg-copy.ts`, adapted from the coordinator's `minigame-copy.result.md`.
- **Overlays**
  - `components/game/realm/WildGame.tsx`: a 320×160 pixel canvas that reuses `drawAnimal` scaled up. It covers idle, walk, sniff, flee and the caught pose (flipped or lifted, with stars), plus arrows in flight, the reticle and landing ghost, the wind, the snare or net, and the viewfinder with its flash.
  - `components/game/realm/ComboGame.tsx`: a lane of arrows sliding into a ring, the boss sprite, and on-screen arrow and Né buttons.
  - Both run on a 60 Hz `TickClock`, with keyboard, touch/click and Esc, a reduced-motion fallback, and a one-line Vietnamese instruction.
- **`useWorld.ts`:** `act` now starts a wild round, and `attack`/`dgAttack` start a combo. It adds `wildEnd`/`comboEnd` (the finish, with the result lines), the damage floats and the shake.
- **`WorldHud.tsx`:** renders the overlays and holds the input while one is open (through `onPanel`). K still starts the strike.
- **`rpc.ts`:** adds `wildStart`, `wildFinish`, `comboStart` and `comboFinish`, removes the three old calls, and adds new error texts.

## Tests
- `tests/unit/world-minigames.test.ts`: fixture parity (`WRITE_WORLD_MG_FIXTURES=1` rewrites `tests/fixtures/world-mg-cases.json`), outcome coverage, bounds and the input-shape rules. The generator is `scripts/gen-world-mg-fixtures.ts`.
- `tests/unit/world-minigame-ui.test.tsx`: render and Esc smoke tests for both overlays.
- `world-rpc` and `world-sql` still pass: 26 tests in total. eslint on the touched files is clean.
- `tsc` shows errors only in other agents' in-progress `song_cai` tests (`city-map.test.tsx`, `game-hud-travel.test.tsx`).
- `tests/sql/v22-world-smoke.sql` covers: the fixtures; the hunt paying within base ±20; single use; mismatch, too-fast and bad-input flags; the cooldown; the trap; the photo and album; an abandoned wolf hunt charging; the boss combo (damage range, HP, `boss_hit`, the soft timing flag, the stun, "good" arrows, too-fast, the cap, the arena); the dungeon combo on a chosen mob; not joined; and privileges. A line was added to `tests/sql/README.md`.

## Known gaps / notes
- `v21-world-smoke.sql` and `v21-fixes-smoke.sql` re-apply 0075/0078, which puts the old strike bodies back. Re-apply 0083 after them (noted in the README).
- If a dangerous hunt is abandoned and the player never starts another round, the charge is never settled. Old rounds are only settled on the next start or finish.
- The wolf/bear dodge could not be exercised end to end through `wild_start` in the smoke, because it depends on VN night time. The replay (fixtures) and the charge settlement are tested.
- Not verified in the browser: the dev server talks to hosted Supabase. The overlays are checked by the jsdom smoke, tsc and eslint.
