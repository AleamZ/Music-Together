# v22 group "pets" — report

Migration: `supabase/migrations/0085_pet_minigames.sql` (additive, re-runnable).

## What was built

### Care minigames (replace the instant buttons)
Server-replayed, mining pattern: `pet_care_start(token, pet, kind)` rolls a seed and stores a pending round
(`pet_care_rounds`, one per account, 1 s start rate limit); the client plays 60 Hz ticks and sends only packed inputs;
`pet_care_finish(token, inputs[], ticks, score)` replays (`_pcare_feed` / `_pcare_rub` / `_pcare_fetch`, mirrored
statement for statement in `lib/game/pets/minigames.ts`).
- **FEED "hứng đồ ăn"** (551 ticks ≈ 9 s): 12 treats fall in 5 lanes; move the bowl (←/→, A/D, tap a lane). Score = catches.
- **PAT "gãi đúng chỗ"** (530 ticks): 5 spots on a big pet; the liked spot changes every 100 ticks; hearts show when
  you rub the right one (pointer drag / keys 1–5). Score = good ticks (400 = full).
- **PLAY "ném bóng"** (820 ticks): 8 throws; press Space/tap as the ball lands (≤ 6 ticks 2 pts, ≤ 13 ticks 1 pt —
  widened per the balance note to ~±100/±217 ms).
- Reward: `base × (0.4 + 0.6 × score‰)` in integers (`_pcare_gain`), where base is 0074's old amount (feed 3/5,
  pat 2/3, play 5/10 affection/XP) → never more than before; XP still through `_pet_care_xp` (300/day cap). Food
  eaten at the finish, fullness/happiness unchanged; pat (60 s) and play (10 min) cooldowns set at the start;
  PLAY spends 1 stamina (`_stamina_spend`). Round expires after 120 s.
- Anti-cheat: hard `pet_care_bad_input`, `pet_care_mismatch` (claimed score ≠ replay), `pet_care_too_fast`
  (< 0.9 × ticks/60 s); soft `pet_care_timing` (perfect + machine-quick reactions), 5 in 24 h → hard
  `pet_care_timing_repeat`. Refused rounds pay nothing.
- `pet_pat`, `pet_feed`, `pet_play` now refuse with `outdated` (still gated by `_ac_account`).
- Event: `pet_care` (qty 1, meta {kind, score, permille}); level-up events via `_pet_care_xp` as before.
- UI: `components/game/pets/CareGame.tsx` overlay (canvas, particles, "+1"/hearts/"Tuyệt!", reduced-motion,
  keyboard + touch, 1-line Vietnamese help, result copy adapted from minigame-copy.result.md). Opened from Trại thú
  (Vuốt ve / Cho ăn / Chơi bóng) and from the pet shop's Cho ăn / Chơi.

### Battle power press + animations
- `pet_battles` gains `ps1/ps2` (per-side seed, re-rolled by a BEFORE trigger whenever a battle goes active or a turn
  resolves), `pw1/pw2` (power ‰), `px1/px2` (exact presses). `battle_act_press(token, battle, skill, press, ticks)`
  replaces `battle_act` (now `outdated`): meter = `_ppress_round` (period 60–100, centre 200–800 ‰), power =
  1150 − 300·min(off,400)/400 (850 with no press) → only ±15 %. `_battle_turn` re-created from 0074 multiplies my hits
  by my power and logs `power`; NPC/opponent side keeps its server roll (1000 unless that player pressed).
  `_battle_json` re-created to expose only the viewer's own `press_seed`. Hard `battle_press_bad_input` /
  `battle_press_too_fast`; soft `battle_press_timing` at the 6th ≤ 3 ‰ press in a battle.
- UI: `BattleStage.tsx` replays each turn's log: lunge, hit flash, knockback, floating damage, "CHÍ MẠNG!", "Trượt!",
  shield/heal, HP bar tween, faint. `PowerPress` meter for hit skills (Space/E/tap, 5 s timeout); guard/heal go at once.

### Egg machine
`EggHatch.tsx`: machine shakes while the RPC runs, egg drops, wobbles, cracks, rarity-coloured burst, rays + pop reveal.
The result is the server's `pet_gacha_roll` roll (unchanged; no skill influence).

### Aquarium / house
- `AquariumTank.tsx` (in AquariumPanel per tank): fish wander with idle pauses/turns, bob, rare-fish sparkles, bubbles,
  swaying weed, the 5 decorations drawn; "🍤 Rắc thức ăn" drops flakes the fish chase and eat (client-only show).
- `HouseKnocks.tsx` KnockButton: door shake + fist + "Cốc! Cốc!" animation on knock.

## Tests
- `tests/unit/pet-minigames.test.ts` (fixtures = TS, lengths/bases pinned to the SQL, gain bounds, input rules, press
  bounds); fixtures `tests/fixtures/pet-care-cases.json` from `scripts/gen-pet-care-fixtures.ts`
  (`WRITE_PET_CARE_FIXTURES=1`).
- `tests/sql/v22-pets-smoke.sql`: fixture replays (60+ care, 24 press), outdated RPCs, pat/feed/play flows, cooldowns,
  expiry, hard/soft flags, press power in the log + NPC at 1000, fresh seed per turn, privileges, the wipe.
  Throwaway PG18 on 54385: chain 0004…0082, 0085 twice, the smoke twice, anticheat-guards, v21-pets-smoke then the v22
  smoke again — all pass. Cluster stopped and deleted.
- Vitest: pet-minigames, pets, pets-v2, apartment*, house*, mining — 92 pass. tsc: clean for my files (errors only in
  another agent's realm/useWorld.ts and city-map / game-hud-travel tests). eslint clean on touched files.

## Known gaps / concerns
- The client knows the seed (like the mine), so a bot could play perfectly; the soft timing flags + repeat escalation
  are the defence, and the payout is capped at 0074's old amounts anyway.
- Quitting a pat/play round mid-way still consumes the cooldown (set at start, by design against start-spam).
- Aquarium feeding is cosmetic only (no server state).
- The v21-pets smoke re-applies 0074 (old instant RPCs); re-apply 0085 after it (noted in tests/sql/README.md).
