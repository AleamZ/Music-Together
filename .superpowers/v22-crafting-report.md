# v22 "crafting" group — report

Migration `supabase/migrations/0084_craft_minigames.sql` (additive, re-runnable). Verified on a throwaway PG18 cluster
(port 54384): chain 0004…0082 (0014 before 0013), then 0084 twice, `tests/sql/v22-crafting-smoke.sql` twice,
`anticheat-guards.sql` — all pass. Cluster stopped and deleted.

## Pattern (same as 0072's dig)
`*_start` checks position / gate / costs (nothing taken), rolls a secret seed into `craft_rounds` (one per account and
game, 120 s expiry, single use). `*_finish` gets only the inputs + claimed score, replays them in SQL (≡
`lib/game/craftmg/games.ts`), hard-flags `<game>_bad_input` / `_mismatch` / `_too_fast` (0.9 × the round's length),
soft-flags `<game>_timing` (metronome-regular input) with the 5th in 24 h hard `_timing_repeat`, records
`ac_play_stats` ('brew', 'anvil', 'sort'), spends stamina (`_stamina_spend` 2 / 3 / 2), then runs the old action's body
(copied from its newest definition) and emits the same events. Costs are taken at the finish, so a round given up or
expired costs nothing.

## A. Potion brewing (bà Sáu's cauldron) — `brew_start(token, recipe, qty)` / `brew_finish(token, toggles[], score)`
10 s round: hold Space / the "Quạt lửa" button to fan the fire (+7 heat/tick), release to cool (−4), seeded drift per
0.5 s; keep the heat in the ±120 green band around a seeded centre. Ticks in band ≥ 270 → Tốt, ≥ 420 → Hoàn hảo.
Quality only strengthens the potion when drunk: +5 % / +10 % hunger/thirst points or buff duration (luck power unchanged).
`potion_quality(account, item, tier, qty)` counts the bag's tiered potions; `drink_potion` (re-created, 0072 verbatim +
marked lines) drinks the best tier first and clamps the tier counts to the bag. `_mine_state` re-created (+ `quality`).
UI: pixel cauldron SVG (liquid colour by heat: blue → green → orange → red, bubbles faster when hot, steam, fire size
with the fan, ingredient splashes), heat meter with the green band, live quality readout; puff on Tốt/Hoàn hảo, grey
puff + crack otherwise.

## B. Anvil — `upgrade_start(token, item)` / `upgrade_finish(token, strikes[], ticks, score)`
5 strikes (≤ 2 per second) timed to the bar's glow peak (seeded period 50–80 ticks + phase): glow ≥ 880 → 2 pts,
≥ 700 → 1. Score 0–10 → chance nudge (score − 5) × 20 ‰ = −10 … +10 pp on the server-rolled 0072 chance (clamped
0–100 %); the RNG roll happens after the replay. UI: pixel anvil, hammer drop + shake, spark burst sized by the strike's
quality, heat bar; result shows base ± nudge = final; glowing puff on success, crack on failure.

## C. Máy chế biến (0076) — `process_sort_start(token)` / `process_sort_finish(token, ticks[], dirs[], score)`
Collecting a finished job is a ~10 s sort: 12 grains fall one by one (40-tick window each); ← good basket, → pebble /
husk basket. ≥ 8 right → +2 %, ≥ 11 → +5 % of the batches' value paid at once (ledger `produce_sell`, ref
`sort bonus …`); the goods themselves are unchanged. `crop_processed` meta carries the sort score.
Sprinkler: install / refill splash animation only (dashed water ring + drops on buy and per-plot "Tưới").
Cooking: meals are restaurant purchases and no crafted food exists, so no cooking minigame (per brief).
Mining: cheap polish only — rock chips burst from each strike (ore-coloured on a hit, grey on a miss) and the bar shakes
on a hit.

## Old RPCs
`brew_potion`, `upgrade_item`, `process_collect` now `raise 'outdated'` (after `_ac_account`). The client no longer calls
them (`brewPotion` / `upgradeItem` / `processCollect` removed).

## Files
- SQL: `supabase/migrations/0084_craft_minigames.sql`, `tests/sql/v22-crafting-smoke.sql` (+ README line).
- Lib: `lib/game/craftmg/{games,rpc}.ts`; edits in `lib/game/mining/rpc.ts` (quality, error texts, removed old calls),
  `lib/game/fishing/extras-rpc.ts` (removed processCollect).
- UI: `components/game/craftmg/{shared,BrewGame,AnvilGame,SortGame}.tsx`; edits in `hooks/useMining.ts` (craft view,
  start/finish), `components/game/mining/{MiningOverlays,MineGame}.tsx`, `components/game/farm/MachinePanel.tsx`.
- Tests: `tests/unit/craftmg.test.ts` (5), fixtures `tests/fixtures/craft-cases.json` via `scripts/gen-craft-fixtures.ts`
  (`WRITE_CRAFT_FIXTURES=1`; 57 cases, SQL = TS).
- Copy from `.local-agent-tasks/minigame-copy.result.md` used for the result lines; the balance file's bounds adopted
  (anvil ±10 pp, sort ≤ +5 %, potency reduced to +5/+10 %).

## Tests
vitest craftmg + mining + v21-fishing: 30 pass. eslint clean on all touched files. tsc: only errors in other agents'
in-progress files (realm/useWorld.ts, city-map/game-hud-travel tests for `song_cai`).

## Known gaps / notes
- Not verified in the browser (needs a level-5 account in Mỏ đá / a processor job); covered by tsc, lint, unit and SQL.
- `v21-crafting-smoke` / `v21-fishing-smoke` / `v21-fixes-smoke` call the old RPCs after re-applying their own
  migration; re-apply 0084 after them (noted in the README line).
- `anticheat-guards.sql`'s dynamic list does not include the six new RPCs (they pass the static check).
