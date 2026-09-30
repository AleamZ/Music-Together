# SQL smokes

Every file here is a psql script of `ASSERT`s (`\set ON_ERROR_STOP on`: the first failure stops it). They run as the
superuser on a **throwaway** PostgreSQL 18 cluster — never on the installed service (port 5432) and never on hosted
Supabase. Run them from the repo root (they `\i supabase/migrations/…` and read fixtures with `pg_read_file`, so fixture
paths are absolute), with `PGCLIENTENCODING=UTF8`, with plain `psql -f` — never `psql -1` (some open their own
`begin; … rollback;`).

## The cluster

```powershell
$PG = "C:\Program Files\PostgreSQL\18\bin"; $D = "<scratch>\pg"; $env:PGCLIENTENCODING = "UTF8"
& "$PG\initdb.exe" -D $D -U postgres --auth=trust -E UTF8 --no-locale
Start-Process "$PG\pg_ctl.exe" -ArgumentList "-D `"$D`" -o `"-p 54364`" -l `"$D\server.log`" start" -WindowStyle Hidden
psql -p 54364 -U postgres -c "create schema extensions; create role anon nologin; create role authenticated nologin;
  create publication supabase_realtime; grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on functions to anon, authenticated;"
```

The default privileges mirror Supabase (anon gets every new table and function unless a migration revokes it); without
them the privilege checks prove nothing. Afterwards: `pg_ctl -D $D stop -m fast`, then delete `$D`.

## The full chain

1. Apply every migration in file order, **except that `0014` runs before `0013`** (the production order).
2. `v20-rerun.sql` — the v20 migrations are re-runnable: it re-applies 0048 → 0052 twice and checks 0052's bodies. It
   must run before any smoke writes rows (0050's and 0051's ledger checks list fewer reasons than later rows use), and
   it puts 0052's `fight_push` & co. back, so **re-apply 0055 … newest right after it**.
3. The chain-level smokes (no `\i`), in any order:
   `fight-engine-smoke.sql` (`-v fixtures=…/fight-cases.json`),
   `v20-2-smoke.sql` (`-v kata=…/kata-cases.json -v bots=…/fight-bot-cases.json`),
   `v20-3-smoke.sql` (`-v cases=…/fight-cases.json`),
   `v20-4-smoke.sql` (`-v cases=…/fight-cases.json -v bosses=…/ug-boss-cases.json`),
   `reel-verify-smoke.sql` (`-v fixtures=…/reel-cases.json`), `salon-gender-smoke.sql`, `lyrics-lockdown-smoke.sql`,
   `anticheat-guards.sql`.
4. The anti-cheat v2 smokes, **in ascending order of their migrations**. Each re-applies its own migrations with `\i`
   (so it tests those bodies even when an earlier smoke left older ones), which puts an older body back over a later
   migration's — the next smoke in the order re-applies the later one, and the last leaves the newest chain:
   `anticheat-v2-net-smoke.sql` (0056; `-v fixtures=…/net-cases.json`), `anticheat-v2-position-smoke.sql` (0057),
   `anticheat-v2-tabs-smoke.sql` (0058), `anticheat-v2-reel-hook-smoke.sql` (0059; `-v fixtures=…/reel-cases.json`),
   `anticheat-v2-fight-smoke.sql` (0060; `-v secret=…/fight-secret-cases.json -v kata=…/kata-noise-cases.json`),
   `anticheat-v2-farm-smoke.sql` (0061–0063; `-v harvest=… -v crab=… -v sling=…`),
   `anticheat-v2-part3-smoke.sql` (0064–0067; `-v harvest=…/harvest-cases.json -v crab=…/crab-cases.json`), then
   **re-apply 0068 … newest** (later migrations re-create some of their functions), then `anticheat-guards.sql` again.
   Running one of them alone: re-apply its migration's successors afterwards.
5. The smokes that re-run one older migration and still pass on the full chain — `faint-ladder-smoke.sql` (0045),
   `fishing-hunger-smoke.sql` (0047), `v18-5-depots-smoke.sql` (0028): they put that migration's bodies back, so
   **re-apply 0056 … newest after each** (that restores everything they touch; step 4's last two smokes pass after
   them). `v18-3-smoke.sql` (0025), `v18-10-smoke.sql` (0033) and `v18-11-smoke.sql` (0032) pass too, but they also put
   back bodies that 0048–0055 re-created (0033's `_in_shade` over 0051's breaks `v20-3`), which only a fresh chain
   restores: run them last, in the order `v18-10`, `v18-11`, `v18-3` (0025 brings back the old `vitals_tick(text)`
   overload, and `v18-10` counts one `vitals_tick`).

Every smoke above is re-runnable on the same cluster.

6. v21, after steps 1–5 on the same cluster: each group smoke re-applies its own migration with `\i` (putting that
   migration's bodies back over 0078's), so run them **in migration order** — `v21-progression-smoke.sql` (0070),
   `v21-quests-smoke.sql` (0071), `v21-crafting-smoke.sql` (0072; `-v mine=…/mine-cases.json`), `v21-economy-smoke.sql`
   (0073), `v21-pets-smoke.sql` (0074), `v21-world-smoke.sql` (0075), `v21-fishing-smoke.sql` (0076),
   `v21-professions-smoke.sql` (0077) — then **re-apply 0078, 0079 and 0081**, then `v21-fixes-smoke.sql` (0078, re-applies it itself;
   `-v fixtures=…/reel-cases.json`) and `anticheat-guards.sql` once more. The group smokes are listed below too.
7. 0079 (the chibi's boxes) re-creates 0048's `_fx_moves` / `_fx_contact` and 0049's `_fx_bot`: `v20-rerun.sql` puts the
   old bodies back, so the re-apply of 0055 … newest after it (step 2) must include 0079 — `fight-engine-smoke.sql`,
   `v20-2`, `v20-3`, `v20-4` and `anticheat-v2-fight-smoke.sql` replay fixtures generated with its numbers.
   0081 (the attack boxes' heights) re-creates `_fx_moves` once more, over 0079's: re-apply it after 0079 every time
   (0080 is news data only and needs no re-apply); the fight fixtures carry 0081's table.
8. v22, after step 6 on the same cluster: `v22-world-smoke.sql` (0083), `v22-crafting-smoke.sql` (0084),
   `v22-pets-smoke.sql` (0085), `v22-explore-smoke.sql` (0086) — each re-applies its own migration with `\i` (the
   bodies that still answered a seed) — then `v22-fixes-smoke.sql` (0087, re-applies it itself: it re-creates bodies of
   0072, 0078 and 0083–0086, so it must come after all of them) and `anticheat-guards.sql` once more. **Re-apply 0087
   after any smoke that re-runs 0072, 0078 or 0083–0086** (the v21 crafting / fishing / fixes smokes, the v22 group
   smokes). Then the three of step 5 that only a fresh chain undoes.

## The staged smokes

The version smokes `v14`, `v15`, `v15-2`, `v15-gather`, `v16`, `v17`, `v18-1`, `v18-2`, `v18-2b`, `v18-4`, `v18-5`,
`v18-6`, `v18-8`, `v18-9`, `v18-12`, `v19-1` … `v19-4` and `anticheat-smoke.sql` check their version right after its
migration: build the chain up to it, run the smoke, go on (for example `v14-smoke.sql` right after 0012: from 0013 on a
catch is priced by the room's index). On the full chain they fail by design: they re-apply an old migration whose
ledger reasons, shop kinds or function overloads predate later rows and migrations (`coin_ledger_reason_check`,
`shop_items_kind_check`, "finish_cast … is not unique"), or they test a client-trusted RPC a later migration replaced
(`v18-2`, `v18-2b`: the net before 0056). `v15-2`, `v15-gather`, `v16`, `v17` and `anticheat-smoke` end with
`\i tests/sql/anticheat-guards.sql`, which checks the newest chain's list; at their own stage the list is older.

- `v21-fishing-smoke.sql` (0076: boat + deep water, fishing battles, treasure maps, farm machines): chain-level, re-runs 0076 with `\i`; run after the full chain.
- `v21-pets-smoke.sql` (0074: pet gacha, care/levels/evolution, fighter training, PvE/PvP pet & fish battles, the aquarium, house knocks): chain-level, re-runs 0074 with `\i`; run after the full chain.
- `v22-pets-smoke.sql` (0085: the replayed care minigames feed/pat/play, the battle's power press; `-v fixtures=…/pet-care-cases.json`): chain-level, re-runs 0085 with `\i` twice; run after `v21-pets-smoke.sql` (which puts 0074's pet_pat / pet_feed / pet_play / battle_act / _battle_turn / _battle_json back) — re-apply 0085 after any re-run of 0074.
- `v21-professions-smoke.sql` (0077: professions, skill trees, perks via the ledger, stamina, food buffs; needs 0072's `player_buffs` shape): chain-level, re-runs 0077 with `\i`; run after the full chain.
- `v21-quests-smoke.sql` (0071: daily/weekly/NPC/explore quests from game_events, the company quest, the login calendar, the photo album, the 2v2 tag team series): chain-level, re-runs 0071 with `\i`; run after the full chain.
- `v21-economy-smoke.sql` (0073: player trading, the Chợ người chơi board, the auction house, rented stalls, the collusion guard): chain-level, re-runs 0073 with `\i`; run after the full chain.
- `v21-crafting-smoke.sql` (0072: Mỏ đá mining with the replayed dig, herbs, ore selling, pickaxes, potions and buffs, item upgrades; `-v mine=…/mine-cases.json`): chain-level, re-runs 0072 with `\i`; run after the full chain.
- `v21-world-smoke.sql` (0075, v21 world: snow, wild animals, party, bosses, dungeon): re-runs 0075 twice, owns its rows (truncates them first); run after the chain 0004 … 0069 + 0075.
- `v21-fixes-smoke.sql` (0078: only finish_cast / finish_net emit 'fish_catch' and score a fishing battle; the locked map on ordinary travel; the leaderboard; the company quest's daily cap, arena membership, the photo log and the quest wipe; the dig's timing flag and the pickaxe at the finish; PvP pet XP caps and the knock; the fishing-battle wipe; boss room / dungeon party checks; stamina-short fights and the hammock; `-v fixtures=…/reel-cases.json`): chain-level, re-runs 0078 with `\i`; run after the v21 group smokes and a re-apply of 0078 (step 6).
- `v22-world-smoke.sql` (0083: the wild hunt / trap / photo minigames and the boss / dungeon combo strike, replayed from `-v cases=…/world-mg-cases.json`; wild_act / boss_attack / dungeon_attack refuse 'outdated'): chain-level, re-runs 0083 twice with `\i`; run after the full chain — and re-apply 0083 after `v21-world-smoke.sql` / `v21-fixes-smoke.sql` (they put 0075's / 0078's strike bodies back).
- `v22-crafting-smoke.sql` (0084: the cauldron's heat minigame + potion quality, the anvil's hammer timing ±10 pp, the processor's grain sort bonus; the old brew_potion / upgrade_item / process_collect refuse 'outdated'; `-v craft=…/craft-cases.json`): chain-level, re-runs 0084 with `\i`; run after the full chain — and re-apply 0084 after `v21-crafting-smoke` / `v21-fishing-smoke` / `v21-fixes-smoke` (they put 0072's / 0076's / 0078's old bodies back).
- `v22-fixes-smoke.sql` (0087, the v22 review fixes: no minigame round leaves the server — the parameter sims = the seed sims on every fixture, `_mg_events` = `-v events=…/mg-events-cases.json`; the honest live client (mg_sync reveals, stamped inputs) for the combo, hunt, trap, brew, anvil, sort, feed, the power press, the row, the treasure dig and the mine; the attacks — perfect inputs known in full but not played live (void, `<x>_late`), a peek at the end, a look-back before a gate (hard `<x>_bad_input` 'early'), a key ahead of the server's clock, a rewritten list; the combo's end tick and steady offsets, the anvil's steady offset, the sort flag at 11, the row home's falling need, one chest per treasure map, the no-press pick; `-v world=… -v craft=… -v care=… -v rows=… -v mine=… -v events=…`): chain-level, re-runs 0087 twice with `\i`; run after the v22 group smokes (step 8).
- `v22-explore-smoke.sql` (0086: Sông Cái — the map, the boat-only trip, the rowing replay from `-v rows=…/row-cases.json`, river casts; the treasure detector bands and the replayed shovel dig; start_boat_cast / board_boat / dig_treasure refuse 'outdated'): chain-level, re-runs 0086 twice with `\i`; run after the full chain — and re-apply 0086 after `v21-fishing-smoke.sql` (it puts 0076's boat / dig bodies back; that smoke also expects them, so run it before 0086).
- `unified-world-smoke.sql` (0088: the unified world P1 — world coords under the portals, the `unified_world` flag off by default; flag off `_pos_need_s` is compared value for value with a verbatim copy of 0057's, flag on the world speed check, the detour factor, the wild, the waypoint exemption and the zone gate; it sets the flag back off; P2: Mỏ đá underground — seven zones, the mine mouth ↔ cave edge in `_world_portals` with `_pos_portals` untouched, the interior ↔ world need, the level gate at the mouth, and the waypoint exemption only right after a paid `waypoint_travel`): chain-level, re-runs 0088 twice with `\i`; run after the full chain — and re-apply 0088 after any smoke that re-runs 0057 / 0058 / 0072 / 0078 / 0086 (they put the older `_pos_claim` / `_pos_need_s` / `_pos_maps` back). `anticheat-guards.sql` lists `pos_report_w` and `app_flags`.
- `world-p3-smoke.sql` (0089: the unified world P3 — vehicles ride the world's roads: `vehicle_catalog.speed_mul` derived from `trip_ms` (≤ 3), `player_pos.ride`; flag off `_pos_road_s` / `skip_trip` as before; flag on a claim is judged at 260 × the ride's multiplier (owned vehicles only; a lift near a fresh driver), a ride stored from the last `pos_report_w` covers later claims, `skip_trip` refused; it sets the flag back off): chain-level, re-runs 0089 twice with `\i`; run after `unified-world-smoke.sql` — and re-apply 0089 after any smoke that re-runs 0057 / 0088 (they put the older `_pos_road_s` / `_pos_need_s` / `pos_report_w` / `skip_trip` back). `anticheat-guards.sql` lists `pos_report_w(text,integer,integer,text)`.
- `dual-mode-smoke.sql` (0090: 2D and 3D side by side — each claim judged by its client's model: `pos_report_w` = the world, `pos_report` on a zone = the portal graph, any other RPC = its tab's last mode (`player_pos.tabs` → `w`, else `player_pos.mode`); the `unified_world` flag = world mode available, turned ON by the first run; with the flag on, 2D `_pos_need_s` / `_pos_road_s` = 0057's verbatim copies over 0088's 6075 cases and 780 2D claims = 0057's verdicts; a 2D and a 3D account side by side (portal hops vs world walks, the wild, RPC claims by tab, vehicles at speed_mul vs road trips, `skip_trip` refused only for a world tab), a graphics switch mid-session (the first claim judged by both models), gates, waypoints and real teleports in both modes; it drops and re-adds `player_pos.mode` to test the first run and leaves the flag on): chain-level, re-runs 0090 with `\i`; run after `world-p3-smoke.sql` — and re-apply 0090 **and then 0091** after any smoke that re-runs 0057 / 0058 / 0078 / 0088 / 0089 (they put the older `_pos_claim` / `_pos_need_s` / `_pos_road_s` / `skip_trip` back). Its section 7 re-runs 0091 twice with `\i` (0091: the lenient graphics switch at most once per 5 minutes per account via `player_pos.switch_at`; a faster switch is judged by its new mode only and logged as a soft `pos_mode_switch` event), so it leaves the newest `_pos_claim`. With 0090 applied, `anticheat-v2-position-smoke.sql` / `anticheat-v2-tabs-smoke.sql` also pass with their `\i` lines removed (the 0090 bodies, flag on; drop position's count-of-tables line, which predates later maps, and `set app.pos_world = '0'` for its direct `_pos_need_s` calls).
- `river-world-smoke.sql` (0095: the seamless river — `_river_world_water` in world px: Sông Cái's water and its short ends, the wild river band, the canals; `start_river_cast_w` from the boat on the wild's water in the world model, map `song_cai` = 0086's cast): chain-level, re-runs 0095 twice with `\i`; run after the full chain (it sets the `unified_world` flag on for its checks and puts it back).
- `forest-professions-smoke.sql` (0096: the rừng tràm grid `world_forest` = `lib/game/world/forest-grid.data.ts`; wild animals only on core forest cells (`_wild_cap` 0 on the zone maps), `wild_start` / `wild_finish` refuse 'not in forest'; Thợ săn and Tiều phu with their nodes; the starter tool once per account per nghề (`profession_choose`, the backfill); chopping — `_chop_hits` / `_cook_score` / `_tree_of` = `-v forest=…/forest-cases.json`, the honest live client on mg_sync, the peek (hard `chop_bad_input`), `chop_too_fast`, `chop_timing`, felling, the 40-log day, logs and axes at the stall; cooking — Đầu bếp only, the ingredients and fee at the start, the honest cook, the peek (`cook_bad_input`), eating and selling; the wipe): chain-level, re-runs 0096 twice with `\i`; run after the full chain — and **re-apply 0096 after any smoke that re-runs 0075 / 0077 / 0078 / 0083 / 0087** (they put the older `_wild_cap` / `_wild_fill` / `wild_start` / `wild_finish` / `profession_choose` / `_prof_json` / `_mg_events` back). `v21-professions-smoke.sql` counts 0077's eight nghề among the catalog (0096 adds two).
- `forest-complete-smoke.sql` (0097: Rừng tràm, the 2D map that is a window of the world's forest — `_pos_maps` / `_pos_portals` / `_world_portals`, `_forest_xy`, the window's animals in the map's px; a 2D hunt (the bow wears) and a 2D chop in it; forest-content's six animals (three photo only), meats, ten dishes (the pan, the catch's fish by species, the buffs replaced, × the quality's %), the bow / pot / axe tiers; `tool_repair` by the point; Thợ săn xp for hunters only): chain-level, re-runs 0097 twice with `\i`; run after the full chain. `forest-professions-smoke.sql` drops `_cook_recipes` and `_prof_tools_catalog` before re-running 0096 (0097 re-made them with more columns) and `v21-professions-smoke.sql` deletes 0097's dish buffs before re-running 0077 — **re-apply 0096 (after dropping those two functions) and then 0097 after either**, and after any smoke that re-runs 0072 / 0075 / 0077 / 0078 / 0083 / 0087 / 0088.
- `public-rooms-smoke.sql` (0093: three public halls `salon-592539` Sảnh Chính / `salon-cho-dem` Sảnh Chợ Đêm / `salon-song-que` Sảnh Sông Quê joined without a password; `create_room` refused but for root while `app_flags.room_creation_open` is off; older rooms kept but closed ('room closed') to all but their admin and root, in `join_room` and `_auth`; the first root in an ownerless hall becomes its admin): chain-level, re-runs 0093 twice with `\i`, rolls back its rows. **From 0093 on, the other smokes create rooms as ordinary accounts and have members join them: run them with the flag on** (`update public.app_flags set enabled = true where key = 'room_creation_open'` right after applying 0093 — on, the pre-0093 rules apply whole); this smoke switches it off inside its own transaction.

## Economy v2 (0099–0106)

Spec: `docs/superpowers/specs/2026-09-30-economy-v2-design.md`. These migrations re-create bodies from many earlier
ones (0013 … 0098), so **re-apply 0099 … 0106 in order after any smoke that `\i`s an older migration** (the v21/v22 group
smokes, `forest-*`, `anticheat-v2-*`, `faint-ladder`, `fishing-hunger`, `v18-*`, `v19-*`, `v20-rerun` …). Each econ
smoke re-runs its own migration with `\i` (0101 and 0106 twice) and is re-runnable; all of them need
`app_flags.room_creation_open` on (they turn it on and restore it, or expect it on — see 0093 above). They pass on the
full chain in any order, except as noted.

- `econ-core-smoke.sql` (0099 + 0100: the knobs and `admin_econ_set` (root, range, the fish snapshots re-priced at once);
  the fish multiplier = the knob, not the room's wealth; the thương lái's 100 / 50 / 20 % marks, the day's totals and
  `_npc_quota`; Chợ Lớn ×1.10; no `market_sell_pct` payout and the 1 500 xu perk day; `admin_economy`): chain-level; it
  deletes its accounts and room at the end.
- `econ-fishing-smoke.sql` (0101: the 23 species' prices and the lighter deep weights; the river bump 0.05 / 0.10; the
  boat at 25 000 and the level gate on the wild river; one rarity lift ≤ 20 % rolled before the reel's difficulty; the
  per-cast / net / overboard hunger and thirst; treasure drops, loot and 3 finds a day; `sell_fish` / `sell_fish_market`
  through the thương lái; fishing battles scored in their own room; `-v fixtures=…/reel-cases.json`): chain-level. With
  0101, `anticheat-v2-reel-hook-smoke.sql` expects the new overboard hunger (5).
- `econ-farm-smoke.sql` (0102: plot caps across rooms (2 farmed + 1 private; over-cap accounts keep theirs); the
  processor at 50 000, recipes ≈ 1.15×, the sort bonus +1 / +2 %; land sales and offers in 400 000–2 400 000 and
  subleases ≤ 50 000, the seller / owner paid (100 − `p2p_fee_pct`) %; `crop_harvest` events; crabs, snails and rats
  through the thương lái): chain-level. `v22-crafting-smoke.sql` and `v22-fixes-smoke.sql` now read the recipe value and
  `_sort_bonus` instead of pinning 0076 / 0084's numbers.
- `econ-crafts-smoke.sql` (0103: dish prices, quality 20 / 100 / 110 / 125 %, 2 stamina to cook, half back when eaten;
  ores ÷ 4 and 200 digs a day; logs ÷ 3, 30 full-price logs and 150 a day; 40 kills and the +10 % night market; herbs
  cost 1 stamina; the upgrade coin floor; `item_crafted` events; potion fees; switch 2 000 / reset 1 000; every sale
  through the thương lái): chain-level. `forest-complete-smoke.sql` reads `_cook_pct(3)` and `v22-crafting-smoke.sql`
  reads the fee from `potion_recipes`.
- `econ-rewards-smoke.sql` (0104: raid pool 1 200 and 2 paid raid / weather-boss kills a day, the summon cooldown per
  member; the dungeon's 50 + 250 × n × share, fee 100, 3 paid clears; level rewards 20·L / 60·L and the 1 500 grant cap;
  the three smaller achievements and staked-only fight wins; the company pool of 3 000 by contribution; the squirrel's
  150 a day while moving; pet / fish PvE 5 paid wins at × 0.6, PvP 5 %; "earned by work" without rewards and resales;
  teleport / xe ôm 50; the farm dailies): chain-level.
- `econ-sinks-smoke.sql` (0105: meal buffs; "Ngủ ngon" stamina × 1.2; lot upkeep 1 500 and the 10 000 repossession
  refund (a sale still 20 000); apartment rent 2 000; motel 300 / 6 000): chain-level.
- `econ-p2p-smoke.sql` (0106: Xì dách never goes below the escrow — the 8-seat, 3-bust hand sums to 0, no wallet < 0,
  `_xd_cap` = `-v cap=…/xidach-cap-cases.json`; a debit below 0 refused even with `mt.allow_debt`; trades burn
  `p2p_fee_pct` of the xu leg, receivers ≥ 3 days old and level ≥ 5, `trade_daily_in` a day; the trader perk as a fee
  cut to ≥ 2 %; fashion gifts to roommates, 5 a day; stalls 500 a day): chain-level. Re-apply 0106 after
  `v21-economy-smoke.sql` (it puts 0073's bodies back).

Known, not caused by economy v2: `v22-fixes-smoke.sql`'s pet "a good press" check is timing-sensitive under heavy load
(`battle_press_too_fast`), and `unified-world-smoke.sql` / `dual-mode-smoke.sql` count `app_flags` rows without the
`room_creation_open` flag that 0093 added.

## Anti-cheat v3 (0108)

- `anticheat-v3-smoke.sql` (0108: `_reel_claim_diff`; the 7-argument `finish_cast` — an honest claim lands the fish, a
  widened zone (won or lost) is lost, spent and flagged `client_tamper`, strike 1 then 2; the 6-argument form unchanged;
  the call budget in `_ac_guard` (`rate_high`, `rate_block`, `rate limited`, a new minute); `market_list` /
  `auction_create` lock the wallet before the reserved sum). Needs `-v fixtures=<abs>/tests/fixtures/reel-cases.json`;
  it switches the mode to `enforce` and back, and deletes its accounts and room. Re-apply 0108 after any smoke that
  `\i`s 0064 or 0073 (they put the old `_ac_guard` / `market_list` back).

## Hòm thư (0111)

- `mailbox-smoke.sql` (0111: the mailbox and gift codes — a trade delivers into both mailboxes (the payer pays at once,
  the receiver's xu less the burn and its items wait; the escrowed fish is not sellable or listable; one claim, a second
  and another account's refused; `trade_daily_in` counts the mail); a fish to a full bucket and a stack over 99 are
  refused and the mail stays, `mail_claim_all` lists the refusal; the board purchase and an auction deliver by mail;
  admin gifts to usernames / to all, root only, `admin_gift` on the claim; codes case-insensitive, once per account,
  `max_uses`, expired / not started / disabled, the 10-failure lock and the soft `code_bruteforce`; an expired trade mail
  returns to its giver, a market mail is dropped with its escrow; delete only claimed or empty mail; the wipe): chain-level,
  re-runs 0111 twice with `\i`; it turns `room_creation_open` on and the mode to `log`, restores both, and deletes its
  accounts, room, codes and gift batches. **Re-apply 0111 after `econ-p2p-smoke.sql` or `v21-economy-smoke.sql`** (they put
  0106's / 0073's `trade_confirm`, `_econ_buy`, `_econ_settle` and `_econ_trade_left` back, which deliver directly).
  `anticheat-guards.sql` lists the four admin RPCs and calls the six player RPCs in its lock / build loops (91 calls), so
  it needs 0111.

## Email accounts (0112)

- `email-auth-smoke.sql` (0112: `account_auth` / `auth_rate` private to the definer, no email on `accounts`; the
  auth-only RPCs `game_session_from_auth` / `account_create_for_auth` / `account_link_auth` are not anon's; no JWT,
  an unknown or an unconfirmed auth user refused; register()'s name rules and one account per auth user; the session
  works with `_auth_account`; a confirmed email change synced; the link needs the game token AND the JWT, is
  idempotent, refuses a taken account or email, removes the legacy password (`login` → 'email login required');
  banned accounts refused; legacy `change_password` (8–72, other sessions end); the rate limits; the
  `legacy_register_open` switch; a deleted auth user drops the link): chain-level. A plain PostgreSQL has no Supabase
  `auth` schema: it `\i`s `tests/sql/auth-stub.sql` first (auth.users, auth.uid() from `request.jwt.claim.sub`, the
  roles — each only when missing), re-runs 0112 twice with `\i`, and rolls back its rows. For a **fresh chain** load
  `auth-stub.sql` before `scripts/db/migrate-all.sh` (0112 references auth.users). Never on hosted Supabase.

## Câu cá v3 (0110)

- `fishing-v3-smoke.sql` (0110: the parts, the rods' and lines' limits, Cần gỗ the kit, `fish_habits` not readable by
  anon, the 27 species on 0101's scale; a bare rod refused (`rod needs parts`, nothing spent), parts filling their
  slots, a bought rod waiting for them; `fishing_equip` (slot, kind, ownership, unmounting, a broken rod, the bait);
  hook-gated species, hours, ×2 bait / ×3 groundbait (statistical, generous bounds) and the lift; `throw_groundbait`
  (a bag spent, 48 px, 10 minutes, mine only, the cast answers it); `line_snap` (3 snaps, then gone) and `rod_snap`
  (the rod to 0, unequipped, repairable); the extra hooks' odds and landing within the rig and the bucket; the reel's
  and the phao's params; the notebook's gate; the new nets' rarity and the throw's spot; the new buckets; the river
  casts): chain-level, re-runs 0110 twice with `\i`, needs `-v fixtures=<abs>/tests/fixtures/reel-cases.json`; it
  switches the `unified_world` flag and Sông Cái's level for its river checks and restores them, and deletes its
  accounts and room. **Re-apply 0110 after any smoke that `\i`s 0034, 0059, 0098 or 0101** (they put the older
  `start_cast` / `finish_cast` / `buy_item` / `start_net` / `net_haul` / `_fishing_state` back).
- With 0110: `econ-fishing-smoke.sql` counts 0101's 23 species among the 27; `fishing-kit-smoke.sql` sets 0110's new
  kinds aside while it re-runs 0098 (whose kind check does not know them) and re-applies 0110 after;
  `anticheat-guards.sql` calls `fishing_equip`, `throw_groundbait` and `fishing_notebook` (88 guarded calls).


## Chuyện làng (0114)

- `story-quests-smoke.sql` (0114: the story chain end to end — one open step at a time and in order, progress read only
  from records made after the accept (a bait buy, a sale at cô Ba vs at Vựa cá Chợ Lớn, catches, the story letter, the
  farm gift), the hand-in beside the turn-in NPC ('too far'), paid once ('quest_reward' ref `story:<id>`, 330 xu in all),
  a locked account refused, veterans closed unpaid and a re-run sparing a chain begun). Re-runs 0114 with `\i` and
  deletes its accounts.
