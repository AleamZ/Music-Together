# v20.4 plan: Khu bí mật + giải ngầm — the hatch, `ham_ngam`, rating and tiers, the rated queue, the bot ladder, the night cup, spectating

Spec: `docs/superpowers/specs/2026-09-28-v20-fight-design.md` (§v20.4, global rulings R1–R9, owner rulings at the end:
keep the realtime caps 2 live fights per room and 4 overall; **ladder first-clear prizes halved**; a **5 % burned fee** on
PvP money). Builds on v20.1–v20.3 (plans `2026-09-28-v20-{1-engine,2-dojo,3-arena}.md`, reports in `.superpowers/sdd/`).
Branch `feat/v20-fight`. Migration `0052_underground.sql` (0055 is the unrelated blacklist migration; untouched).

Also in scope, two v20.3 follow-ups:
1. **Lock order.** `admin_anticheat_resolve` locked the wallet and then `_ac_wipe` settled live matches (wallet → match);
   `fight_push` locks match → wallets. Everything now takes **match rows first** (`_fx_lock_live`), then the wallet.
2. **The committed smokes run on the full chain.** `fight-engine-smoke.sql`, `v20-2-smoke.sql` and `v20-3-smoke.sql` no
   longer `\i` their own migrations (re-applying 0048/0049/0050/0051 after a newer one reverted the newer bodies and the
   older ledger check failed on newer rows). Re-runnability moves to `tests/sql/v20-rerun.sql`, which re-applies
   0048 → 0052 twice on a fresh chain before any smoke writes rows. v20-2's "45 reasons" becomes "its reasons present".

## Rulings made in this plan

- **U1: the fee.** The 5 % burned fee applies to every pot moved between players underground: a rated win pays
  `2 × entry − 5 %`, the cup pool is `4 × entry − 5 %` (champion 70 % of that, the runner-up the rest), a no-show's entry
  goes to the present player less 5 %. Refunds (draws, voids, a cup that did not fill, the queue timeout) carry no fee.
  Every tier is a multiple of 100, so every fee is exact.
- **U2: a called match.** A rated pair (and each cup match when it is called) gets its `fight_matches` row at once, kind
  `ug_rated` / `ug_cup`, with new columns `entry`, `ready` (bit 1 = p1, bit 2 = p2) and `call_until` (30 s rated, 60 s
  cup). Until both are ready, `started_at` is a placeholder (`call_until + 3 s`), pushes answer `waiting` (never a
  flag), and the lazy rules below apply. `ug_ready(n)` sets my bit and my input delay; the second one sets
  `started_at = now() + 3 s` and `params.delay = greatest(n1, n2)`. The topic is `fight:{roomId}:m{first 8 hex}`.
- **U3: no-shows.** Rated: the absent player's entry goes to the present one (less 5 %), no rating moves, the present
  one returns to the queue at its old `joined_at` (the head) with its own entry still held; nobody ready → void, both
  refunded. Cup: the absent player loses that match (the other advances); nobody ready → the cup is void (U4).
- **U4: cup draws and voids.** A drawn cup match advances the higher seed. A voided cup match (both absent 120 s, a log
  conflict) voids the whole cup: every entry is refunded.
- **U5: Elo (SQL only).** `E = 1 / (1 + 10^((Rb − Ra) / 400))`, `Δ = round(K · f · (S − E))`, S = 1 / 0.5 / 0; K = 40
  for a player's first 10 rated matches (rated and cup), 24 after; f = 0.5 on a pair's 4th and later rated meetings in 7
  days (rated only; cup matches f = 1); the floor is 800. Each side uses its own K. The TS copy is for display only.
- **U6: the unlock** needs rank ≥ 2 in any style and 5 refereed wins, counted as passed exams + ring wins (fight rows
  are pruned after 90 days, exams are not). Set lazily by `ug_status` and `dojo_state`, permanent.
- **U7: thầy Lâm's hint** shows once: `dojo_state` answers `ug_hint: true` the first time it sees the unlock and stamps
  `ug_profiles.hint_at`.
- **U8: seasons.** `season = greatest(0, vn_today − 2026-10-01) / 28` (shown 1-based). A profile rolls lazily
  (`1000 + (r − 1000) / 2`, floor 800, the day counters kept). The first call in a new season closes the previous one
  once (`ug_seasons`): "Thủy quái mùa N" to everyone whose peak tier that season was Thủy quái, "Trùm hầm mùa N" to
  each room's no. 1 (the highest rating among the room's rated/cup fighters that season); the newest title is copied to
  `characters.ug_title` for the name tag. No xu is minted.
- **U9: limits.** 10 rated matches per account per VN day and 2 per pair (counted at pairing); 6 ladder attempts per
  day; 3 cups per day (counted at sign-up, given back if the cup never starts). The queue refunds after 5 minutes.
  Refusals are answers (`'daily ug limit'`, `'pair limit'`), never flags.
- **U10: the realtime caps** of v20.3 (`fight_config.max_live_room` / `max_live_all`) count live `pvp`, `ug_rated` and
  `ug_cup` matches alike (`_pvp_caps` re-created). A full cap delays pairing and cup calls; the queue timeout still
  runs.
- **U11: bosses** are a seeded table `ug_bosses` pinned against `lib/game/fight/underground.ts`: rank 4, all specials,
  HP % and level from the spec, **prizes halved** (200 … 7 500; 21 750 per season), repeats pay 10 %. Floor 10 fights
  as Muay Thai → Judo → Vịnh Xuân (rounds 4–5 repeat Muay Thai, Judo).
- **U12: `styleByRound` in the engine.** `FighterParams.styleByRound?: number[]` (≤ 5). The state stores `style + 1` per
  round and side in the unused global slots 32–41 (0 = unchanged); `resetFighter` (TS) / `_fx_reset` (SQL, re-created in
  0052 from 0048's body plus marked lines) switches the fighter's style and the style row's stats at the start of each
  round. `_fx_new` writes the slots. Existing fixtures keep their hashes (the slots stay 0). New fixtures
  `tests/fixtures/ug-boss-cases.json` (bot matches against floors 1, 5 and 10) pin TS and SQL.
- **U13: spectating.** `fight_state` answers a non-fighter for a live `ug_rated` / `ug_cup` match when the caller has
  the unlock: side 0, the params, the sim at `min(frontiers)`, both runs up to it. The spectator's client
  (`SpectatorFeed`) runs the engine on confirmed inputs only, 30 frames behind the newest frame both logs cover, never
  rolls back, takes `fi` packets from both fighters receive-only, and re-reads `fight_state` every 5 s as a backstop. A
  presence count ≥ 6 spectators on the topic makes a new spectator stay out ("Lồng đông quá").
- **U14: lock order** everywhere: match rows → cup row → queue rows → wallets (account-id order). Pairing moves no
  money. A wipe or a deletion locks the account's live matches first (`_fx_lock_live`): `admin_anticheat_resolve`
  (0015's body plus one marked line) and the account trigger renamed `accounts_bd_fight` (fires before
  `card_accounts_bd`, which locks the wallet).
- **U15: the map is indoors.** `ham_ngam` is not in `_in_shade`'s outdoor list (no change to it); TS `INDOOR_MAPS`
  makes `inShade` true there, and the world draws no weather and a fixed cellar light there.
- **U16: hidden.** `CITY_PLACES.ham_ngam.hidden = true`: the city overview, `cityRoads`, the map-count chip and the
  minimap name skip it; the member card shows someone there as "Đang đi Chợ Lớn". The hatch (`ug_hatch`) is hidden from
  prompts and clicks unless `ug_status` says unlocked (`GameEngine.setHidden`). E plays the knock (3 long, 2 short,
  cosmetic, skipped under reduced motion), then `ug_enter`, then the travel.
- **U17: news.** A cup champion goes to Tin làng: "🏆 {name} vừa vô địch một giải đấu kín, ẵm {xu} xu."
- **U18: the ladder match** is a bot match through the v20.2 pipeline (kind `ug_ladder`, frame 0 in 8 s, 3 rounds), shown
  in the hầm arena (concrete, chain-link, bulbs, a crowd in silhouette).

## Interfaces

```ts
// lib/game/fight/engine.ts       FighterParams.styleByRound?; G_SBR = 32 (10 slots)
// lib/game/fight/underground.ts  UG_TIERS {queue: [500,2000,5000], cup: [1000,5000]}, BOSSES, TIERS, tierOf(r),
//                                seasonOf(vnDay), softReset(r), eloDelta(...), seedBracket(ratings), cupPayout(entry),
//                                ratedWin(entry), bossParams(floor, seed), limits and clocks (pinned vs 0052)
// lib/game/fight/spectate.ts     SpectatorFeed(params): seed(sim, frame, runs1, runs2) / onPacket(side, fi) / tick(due)
// lib/game/fight/ug-rpc.ts       ugStatus/ugEnter/ugQueueJoin/ugQueueLeave/ugReady/ugLadderStart/ugCupJoin/ugCupLeave/
//                                ugCupState/ugBoard + parsers
// lib/game/fight/transport.ts    matchTopic(roomId, matchId); broadcastTransport(topic…); spectatorTransport(topic, ids)
// lib/game/maps/ham-ngam.ts, ham-ngam-art.ts; MapId "ham_ngam"; InteractKind "ug_hatch" | "ug_boss" | "ug_board" |
//                                "ug_door" | "cage_watch"
// hooks/useUnderground.ts        ug_status polling (5 s queued, 1 s called), the hatch's visibility, the actions
// components/game/fight/UndergroundPanel.tsx (tabs Kèo ngầm, Tầng hầm, Giải đêm, Bảng xếp hạng), UgCall.tsx (the called
//                                match's ready screen), SpectatorView.tsx; PvpFight takes a topic; ResultCard shows ug
```

SQL (0052): tables `ug_profiles`, `ug_seasons`, `ug_ladder`, `ug_queue`, `ug_cups`, `ug_cup_entries`, `ug_bosses`;
columns `fight_matches.entry`, `ready`, `call_until`, `characters.ug_title`; private `_ug_*` helpers; re-created from
their newest versions with marked lines ("-- v20.4"): `_fx_reset`, `_fx_new` (0048), `_fx_settle`, `_pvp_void`,
`_pvp_sweep`, `_pvp_caps`, `fight_push`, `fight_state`, `fight_claim`, `_ac_wipe` (0051), `dojo_state` (0050),
`admin_anticheat_resolve` (0015); RPCs `ug_status`, `ug_enter`, `ug_queue_join`, `ug_queue_leave`, `ug_ready`,
`ug_ladder_start`, `ug_cup_join`, `ug_cup_leave`, `ug_cup_state`, `ug_board`; the ledger (0051's 48 + `ug_entry`,
`ug_prize`, `ug_refund` = 51).

## Tasks

1. **Engine** (TDD) — `styleByRound` in TS; `tests/unit/fight-engine.test.ts` cases (the style and stats switch per round,
   no change without it); `ug-boss-cases.json` from `scripts/gen-fight-fixtures.ts` (bot matches on floors 1, 5, 10).
2. **Underground rules** (TDD) — `underground.ts` + `tests/unit/underground.test.ts`: tier boundaries, the season number
   and soft reset, Elo examples, bracket seeding, payouts, boss params.
3. **Spectator** (TDD) — `spectate.ts` + `tests/unit/spectate.test.ts`: fed by the harness's packets in chunks (dropped
   and duplicated ones included) the confirmed-only sim ends on the players' final hash, and never shows a frame
   within 30 of the newest both logs cover.
4. **0052** — tables, seeds, rules, RPCs, re-created bodies; `tests/unit/fight-ug-sql.test.ts` (bodies = newest +
   marked lines, 51 reasons, privileges, bosses = TS, clocks and limits = TS, every refusal has Vietnamese copy).
5. **SQL smokes** — `tests/sql/v20-4-smoke.sql` (the unlock and the gate on every `ug_*` RPC; pairing, widening, the
   timeout refund; the no-show; the rating maths and the pair ×0.5; the daily limits; the ladder order, first clear vs
   repeat at 10 %, the season reset and the titles; a cup: fill, bracket, a no-show, the 70/30 pool with the fee, the
   refund when not filled; spectator `fight_state`; the lock order; the ledger); the smoke fixes and
   `tests/sql/v20-rerun.sql`. Throwaway PG18 on :54352 with every migration in order, every v20 smoke, then deleted.
6. **Map** — `ham_ngam` (480 × 320): the ladder up to the hatch, anh Tư Sẹo, the board, the cage with its watch spots,
   the ladder door; the hatch in Chợ Lớn at (640, 368); registry, `MAP_IDS`, `CITY_PLACES` (hidden), presence, counts,
   minimap, weather, shade; tests.
7. **Client RPC + UI** — `ug-rpc.ts`, messages; `useUnderground`; `UndergroundPanel`; `UgCall`; `SpectatorView`; the hầm
   arena art; the knock; GameShell cases (every existing case kept); the name tag title; `dojo` hint line.
8. **Preview** — scratchpad `fight-v20-4.png`: the hầm map, the panel, the spectator view.
9. **Finish** — full Vitest, `tsc --noEmit`, eslint on touched files; `.superpowers/sdd/v20-4-report.md`; commits on
   `feat/v20-fight` (no push).
