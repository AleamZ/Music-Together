# Anti-cheat v2 — audit of client-trusted outcomes (2026-09-28)

Owner direction: keep Supabase (no VPS move), make **every economy-affecting outcome server-derived or
server-verified**, maximum anti-cheat. Classes: S = server-derived, R = replay-validated, B = bounded-but-trusted,
T = fully trusted. Newest definitions as of migration 0052 (+0055).

| # | RPC (newest) file:line | Client controls | Worst case | Current bound | Fix |
|---|---|---|---|---|---|
| 1 | `net_haul` 0034_rods_nets.sql:590 (`_net_catch` :507) | T `p_charge_ms`, T `p_offsets` | always the max 5 fish per throw | 4.5 s gate, net durability, bucket cap, vitals cost | server rolls shadow positions/paths from a seed at `start_net`; client sends release tick + aim; server recomputes quality + hits |
| 2 | `finish_net` 0037_net_arrows.sql:25 | B `p_mistakes` 0–4 | always 0 mistakes | 0.8 s per round | server-derived arrow sequence; client sends key presses + ticks; replay counts mistakes |
| 3 | `vitals_tick` 0045:224, `_in_shade` 0051:1053 | T `p_map/p_x/p_y`, T room, T whether it ticks | permanent shade (no heat/rain/lightning); idle drain capped at 120 s per call | none | server-tracked position from the movement stream (speed/teleport sanity); drain from real elapsed time |
| 4 | `finish_cast` 0046:261 | R inputs; T `p_hooked` (false only) | bot solves reel from the seed; hiding hooked avoids rod loss | real-time gate, hard flags, hunger cost | keep the seed secret until the bite / commit-reveal; derive hooked server-side from the bite window; toggle-timing statistics |
| 5 | `fight_push` 0052:955 (bot/ladder/dojo) | R inputs; bot RNG seed sent to client | offline solver clears ladder + exams | pace cap, soft `fight_superhuman` | bot RNG seeded server-side per round from `hash(server_secret, …)` never sent; superhuman → hard flag / void prize |
| 6 | `fight_push` PvP/rated/cup | R own inputs; T `p_stall`, T push timing | rollback look-ahead 12–18 frames; stall blame abuse | soft flags | derive stall from server push times; commit-then-reveal input batches (hash first) so look-ahead is detectable |
| 7 | `dojo_kata_submit` 0050:381 | R presses; `kata_seed` known | scripted near-perfect score | 0.95× chart length gate | progressive chart reveal or timing-noise statistics |
| 8 | `harvest_part` 0016:948 | T `p_success` | always succeed, skip harvester fee | 8–120 s gate | server-seeded harvest minigame + input replay |
| 9 | `crab_finish` 0018:341 | B `p_hits` 0–3; T position | always 3 crabs | 20 min/hole, 200/day, cap, 3 s gate | seeded crab replay + server position check |
| 10 | `sling_shoot` 0019:728 | T `p_hit` | every shot hits | 2 s gate, rat caps | server-rolled rat path; replay aim + release |
| 11 | `sell_*_market` 0028:11/29/58 | T location | 120 % payout from anywhere | none | server-kept current map (set by travel RPCs); require market map |
| 12 | `pet_tick` 0036:372 | T "in game"; uses `_auth_account` not `_ac_account` | idle script farms 300 xu/day | 10 min, 300/day | `_ac_account`; require live presence/heartbeat |
| 13 | `add_queue_item` 0015:126 → `_song_bonus` | T `p_duration` | 10 xu × 10/day with fake durations | 10/day, 75 % gate | server-side duration (tracked playtime) |
| 14 | `start_cast`/`start_net` 0047:34/129 | B cell (position unchecked) | fish from anywhere | `_pond_spot` cell only | server position check (#3) |
| 15 | `rescue_swimmer` 0033:316 | T distance to victim | remote rescue | rescuer on a pond cell | distance vs server-tracked positions |

Accepted as-is: crop quality (ignored), `water`, `tend_crop`, `dig_worms`, gifts, sleep, `estate_buy`, cards
(server-authoritative), `ug_*` Elo. Collusion channels (not client-trust): poker chip-dumping, `transfer_fashion_item`,
alt estate sales inside the band → statistical flags.

Cross-cutting additions (owner: "tăng tối đa"): server-side position/speed tracking; per-account earnings-rate and
win-rate statistical flags feeding the anti-cheat tab and optional auto-blacklist (0055); minimum client build
enforcement; secrets (seeds) never sent before the outcome window; hard flags on replay mismatches everywhere.

Order: #1–#2 → #3/#11/#14/#15 (server position) → #4/#5/#7 (secret seeds) → #8–#10 → #12–#13 → #6 → statistics.
