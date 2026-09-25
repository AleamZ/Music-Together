# Music Together v15.3 — "Đồng vui": crabs, snails and the transplant minigame (Design)

**Date:** 2026-09-26
**Status:** decided.
- The owner said "chạy đến GOAL", so the controller's ★ decisions V1–V9 stand as the owner's.
- Every other ruling here (R1–R24) is the controller's recommendation, recorded as decided with its reason.

**Builds on:** `feat/v15-field` @ `de9ae10` (v15.1 `0013`, `0014`, the anti-cheat `0015` with its fix round), plus two specified migrations that land first: v15.2 `0016_v15_2_crops.sql` and v16 `0017_v16_cards.sql`. The stack is unchanged: Next.js 16, React 19, TS, Supabase (Postgres SECURITY DEFINER RPCs + Realtime).
**Order:** `0013` → `0014` → `0015` → `0016` (v15.2) → `0017` (v16 cards) → **`0018_v15_3_gather.sql` (this doc)** → v17.
**Amends:** the v15, v15.2, anti-cheat and economy specs. §3 lists the lines.

## 1. Goal

v15.3 ships what v15.2 deferred:

1. **Gathering by the canal.** 6 crab holes with a crab-grabbing minigame (**CrabGame**) and 4 snail beds. Crabs and snails ("critters") go into your hands (3) or a container (xô nhựa, giỏ tre), and cô Út buys them at the room's price multiplier M. Pest snails picked off rice plots now land in the container too.
2. **Transplanting by minigame.** "Cấy lúa" and "Trồng cây ớt con" become **TransplantGame** rounds. Like v15.2's rice-harvest rounds, they gate progress and change no yield.

The server stays authoritative: cooldowns, the daily limit, rolls, prices and capacity live in SECURITY DEFINER RPCs that follow the anti-cheat conventions. Clients report two bounded things: crab hits (0–3 per visit, behind a 3 s gate) and a transplant round's success (behind an 8 s gate).

## 2. Decisions

### 2.1 Controller (★)

| # | Decision |
|---|---|
| V1 | **Migration** `0018_v15_3_gather.sql`, after `0016` and `0017`. Its `coin_ledger` reason check is the list in force after `0017` plus `critter_sell` (§11.2). |
| V2 | **Crab holes.** 6 on the field, each with a per-account 20-minute cooldown. CrabGame is the old v15 §15.1 game: the claws open and close on a speeding rhythm, 3 tries, and the result is hits 0..3. The server has a 3 s gate and the hits cap. The catch is a cua đồng, or a cua gạch 10 % of the time. Base prices are cua đồng 12 and cua gạch 45, × M fixed at the catch, like fish. |
| V3 | **Snail beds** are a side activity: ốc đồng 8, ốc bươu vàng 2, both × M. v15.1's `pick_snails` (the pest action on rice plots) stays. Both exist, and §7.4 says how they differ. |
| V4 | **Containers.** Xô nhựa (capacity 15) for 1 500 xu and giỏ tre (capacity 30) for 6 000 xu. Critters are sold at cô Út with `sell_critters`. |
| V5 | **TransplantGame** gates progress only. A success (≥ 6 of 12) transplants. A failure retries at no cost. There is no yield multiplier (anti-cheat D1 stays). The server gate is ≥ 8 s after `begin_work`, with v15.2's stale-work, replace and lease-gate rules. It covers rice and ớt. |
| V6 | **Economy.** Critter income per hour at M = 1 and M = 5 stays below fishing at the same M (§10). |
| V7 | **UI.** A handbook tab "Cua & ốc", the plot panel's transplant opens the game, crab-hole and snail-bed prompts, the containers in the bag, Vietnamese throughout. |
| V8 | **Art.** Original pixel art for the holes, the beds, the crabs, the snails and the containers. |
| V9 | **Realtime.** Reuse `fa` and `fp`. No new channel. |

### 2.2 Rulings made while writing this spec

| # | Ruling | Why |
|---|---|---|
| R1 | A cooldown is keyed by (account, spot) across **all rooms**: hole 3 used in room A is cooling in room B too. The daily limit is per account too. | Rooms are free to create. A per-room key would multiply the hourly cap by the number of rooms an account joins. |
| R2 | **Snail beds:** 4 beds, a per-account **20-minute** cooldown (old spec: 15), **1–3** snails per pick (old: 1–4), each 70 % ốc đồng and 30 % ốc bươu vàng. | The old numbers put crabs + snails at 1 074·M xu/h on average, above fishing's 1 000·M floor (V6). These give 975·M on average, and holes and beds share one 20-minute rhythm. |
| R3 | **Daily limit:** 200 gathering visits (`crab_start` + `pick_snail_bed`) per Vietnam day. The 200th logs the soft signal `gather_daily_cap`; later visits raise `gather daily limit`. | Without it, a script running 24 h takes ≈ 23 400·M a day on average, above fishing's daily cap (300 casts ≈ 13 800·M). With it the most is 9 180·M on average. |
| R4 | **Price** = `max(1, floor(base × M))`, M being the room's fish multiplier at the catch (no season factor). It is stored per critter, one row each, like `fish`. | Floor keeps every price ≤ base × M, so the V6 bound holds at every M; with round the cap would reach 99.6 % of fishing's floor at M = 1.46. M changes every 3 h, so the price must be stored. |
| R5 | **Capacity** = 3 by hand + the largest owned container. A visit is refused (`critters full`) only when nothing fits. A catch beyond the free space escapes and is reported. | A cooldown is never spent on a full container, and a partial fit still pays. |
| R6 | **The crab cooldown starts at `crab_start`**, which records the visit (id, time, room) on the cooldown row. `crab_finish` consumes it. | This is the old §15.2 flow: one write per visit, no replacement rule. A disturbed hole stays empty. |
| R7 | **Crab gate.** Hits ≥ 1 need 3 s ≤ now − `visit_at`. Any finish after 120 s is `visit expired`. Hits 0 has no lower gate. `too fast` leaves the visit open. With hits ≥ 1 the client calls `crab_finish` no earlier than 4 s after the `crab_start` answer; hits 0 goes at once. | This has the shape of v15.2 R6/R7. An honest game always passes, and giving up needs no wait. |
| R8 | **"Dừng (Esc)"** before the first try ends sends nothing: the visit expires unused and the hole keeps its cooldown. After a try it ends the game and reports the hits so far (R7's timing). During the 4 s wait it keeps what was caught: the finish is still sent. A disconnect loses the visit. | Esc never takes a caught crab. The cooldown already runs (R6), so an unused visit costs only that hole's 20 minutes. |
| R9 | **Snail beds** use a 3 s client progress bar and no server gate. | The cooldown bounds the yield, so a skipped bar gains nothing. |
| R10 | **Pest snails.** `pick_snails` also gives the *picker* 1–3 ốc bươu vàng within free space. A full container never blocks it: the extra snails go back into the canal. It needs no cooldown and counts no visit. | The pest remedy must always work. Outbreaks bound the yield (≤ 1 per rice season per plot, ≤ 6·M xu). |
| R11 | Gathering RPCs answer `{server_now, mine, …}`. They take the wallet lock but no plot locks, and send no `fp`. Only `pick_snails` changes a plot. | Holes and beds are per account, so nobody else needs a refetch. |
| R12 | **The displayed price.** `field_state.critter_prices` carries the snapshot's M, or a preview `_fish_mult(_room_wealth(room, now))` while no snapshot exists for this period. Reads never write the index. A catch takes `_fish_index` after the wallet lock, as `finish_cast` does. Both read the fish index's wealth, which leaves banned accounts out (anti-cheat R30; `_room_wealth` in `0015` section F), and `0018` does not re-create it. | The index row is then only ever locked after the caller's wallet. Had `_field_open` written it, a `_farm_do_*` call would lock it before its own wallet and could deadlock with `finish_cast` at a period change. |
| R13 | `critter_kinds` (config, anon-readable) holds names and base prices. The odds, the gates, the limits and the spot keys are constants in SQL and in `lib/game/farm/gather.ts`, pinned by `tests/fixtures/gather-cases.json`. | Prices are data you can tune. The fixture keeps the client's waits and prompts equal to the server's rules. |
| R14 | New rolling functions take `p_u double precision[] default null` (null = `random()`). The re-created `_farm_do_pick_snails` keeps its signature. | Deterministic smoke tests (v16's `p_deck` pattern). An added default argument would make the old wrappers' calls ambiguous. |
| R15 | `sell_critters(p_kind)` sells every critter of a kind at its stored price (null = all) and answers `sold: {n, xu}`. | This is the old §15.2 signature, and the toast shows exactly what was paid. |
| R16 | **Containers** are one-time buys through `buy_farm_item` with quantity 1. A container no larger than the one you hold raises `already owned` (v14's bucket rule). A quantity ≠ 1 is a plain `invalid quantity`, as v15.2 R18. | One rule for tools and containers. A second, smaller box would add nothing. |
| R17 | **CrabGame numbers** (§7.2): claw cycles of 1.2 / 0.95 / 0.75 s, closed for 40 % of each, a 0.6 s lead-in, a slip after 4 cycles without a grab, and a 0.5 s beat. | The old design made concrete: 5–10 s per hole. |
| R18 | **TransplantGame numbers** (§8.2): 12 beats, a 1.4 s sweep, bands ±0.08 / ±0.18 around c ∈ [0.35, 0.65], a 1 s lead-in, a 0.25 s beat, and a pass at ≥ 6. | The old design made concrete: about 12 s. |
| R19 | **Transplant contract.** `begin_work('transplant')` needs 10 s left on the lease (v15.2 R11: 5 s). Then `transplant(p_quality)`, with the quality still ignored; the client sends 1. A failure sends nothing: "Thử lại" calls `begin_work` again, which replaces the record. There is no new RPC. | V5 with the fewest changes; an honest round needs ≥ 9 s. The `quality_range` pin stays valid. |
| R20 | **D1 is permanent.** `q_transplant` stays 1.0, and the anti-cheat's planned soft signal "quality always 1.1" is dropped. | The quality is never used, and the client always sends 1. |
| R21 | New hard signal `bad_spot` (`invalid spot`): a hole outside 1–6 or a bed outside 1–4. | Spots come only from the map's interactables, on the same basis as `bad_plot` and `bad_slot`. |
| R22 | No soft counter for crab finishes claimed right at the gate. | As for v15.2's parts, it is left to later. The hourly and daily caps bound a script. |
| R23 | **Deploy order: the v15.3 client first, then `0018`** (the reverse of v15.2 R28). | The 8 s gate would strand cached v15.2 clients (3 s bar, 2 s gate). The v15.3 client works on `0017`: its 9 s wait passes the old gate and gathering shows "chưa mở". No existing RPC's honest range changes, and the new hard checks sit on new RPCs. |
| R24 | Gathering adds no HUD task lines. The field prompts and a per-viewer "ready" cue on each spot show readiness. | The task list is per plot. |

## 3. Lines other specs change

| Spec | § | Change |
|---|---|---|
| v15 | §2 f, §8.6 | The transplant quality never comes back: qT is 1.0 for good (R20). |
| v15 | §4, §6.2 | The v15.3 block and the gathering spots point here (§6). |
| v15 | §10 | Crabs and snails → this spec's §10: × M, snail beds 20 min and 1–3 snails. |
| v15 | §11.1 | `critter_sell` comes in `0018`. |
| v15 | §11.4 | The 2 s gate stays for hoa-màu pickings only. Transplanting is `begin_work`, then `transplant` 8–120 s later (§8.3); rice parts keep `harvest_part`'s gate. |
| v15 | §11.8 | Trust model: clients report a transplant round's success (8 s gate, no yield effect) and crab hits (0–3 a visit, 3 s gate), in §11.6's income wording. |
| v15 | §15 | Superseded by this spec: the cooldown across rooms (R1), the snail beds (R2), the daily limit (R3). |
| v15.2 | Header, §3 | v15.3 is `0018_v15_3_gather.sql` (`0017` is v16). "Transplanting stays behind the 2 s gate" and the open transplant-quality question end here (§8, R20). |
| v15.2 | S6, R11, §8.3, §8.9, §11.3, §11.4 | Transplanting (rice and ớt) is a TransplantGame round: `begin_work` needs 10 s left on the lease (was 5 s) and `transplant` is gated at 8–120 s (was 2 s). Pickings keep the 3 s action, the 2 s gate and 5 s. |
| v15.2 | §13.1, §13.6, §16 | "Trồng cây ớt con" opens TransplantGame, and its 3 s bar and text go. The smoke's transplant lease case becomes 9 s → `lease ending`, 10 s → allowed. |
| anti-cheat | Header, D7, §9.3, §11.3 rules 2 and 4, §11.5 step 7 | The gather migration is `0018`, after `0016` and `0017`. |
| anti-cheat | D1, §6.4, §7.2 `quality_range` row, §7.4, §11.5 README line, §16 | D1 is permanent: no quality comes back, `quality_range` stays with the client sending exactly 1, and there is no "quality always 1.1" signal. |
| anti-cheat | §7.2, §7.3, §7.4 | §7.2 gains `bad_qty` on `crab_finish` and `bad_spot`. §7.3 gains the refusals in §11.6. §7.4 gains `gather_daily_cap`. |
| anti-cheat | §9.3 | The lock list gains the 4 gathering RPCs: 52 in all (48 after `0017`). |
| anti-cheat | §12.5 | Two labels (§11.6). The holdings line gains `· {n} con cua ốc`. |
| economy | §5 | Critters follow M (banned accounts left out, anti-cheat R30) with floor pricing and no season factor. This spec's §10 has the arithmetic. |

## 4. Constraints

- **Earlier constraints still hold.** Everything in v13–v15.2, v16 and the anti-cheat spec: RPC-only writes, the Vietnamese UI with `vi-VN` numbers, original art drawn in code, time rules in private functions that take `p_now`, and no cron.
- **The anti-cheat fix round (`de9ae10`).** `_room_wealth` leaves banned accounts out of M, and critters read the same M (R12). The guard allowlist matches signatures: the 4 new RPCs are guarded and `0018` adds no overload of an allowlisted name, so the allowlist is unchanged. `fs` and `fa` get 3 per s with a burst of 5.
- **Migration `0018`.** It is additive and re-runnable (`if not exists`, `create or replace`, `drop constraint if exists` + `add`, seeds `on conflict do update`), and the owner runs it in the SQL editor.
  - It requires `0015`, `0016` and `0017`, because it re-creates functions they last defined and keeps their parts (anti-cheat §11.3 rules 1 and 3).
  - The plan copies each re-created body from the latest migration verbatim and adds only what §11.3 lists.
  - Re-running `0013`, `0015`, `0016` or `0017` after `0018` undoes its re-created parts, and their ledger checks lack `critter_sell`, so they fail once a critter has been sold. Re-run them in order with `0018` last (anti-cheat §11.3 rule 7).
- **Deploy order (R23).** First the v15.3 client, then `0018` as soon as possible after.
  - Before `0018` the v15.3 client treats a missing `critter_kinds` (PGRST205/42P01) as an empty catalog and shows the gathering RPCs' PGRST202 as `NOT_OPEN_153`. TransplantGame works: its 9 s wait passes `0016`'s 2 s gate.
  - If `0018` runs first, cached v15.2 tabs get `too fast` ("Từ từ thôi…") on transplanting until they reload.
- **Tests and shipping.** The plan's first task records the test baseline. There is one plan; the owner ships after it and does the manual pass. The README gains a v15.3 section: what's new, the deploy order and the trust-model lines (§11.6).

## 5. Architecture

```
supabase/migrations/0018_v15_3_gather.sql   A config+catalog · B tables · C helpers+views · D gathering RPCs · E farm changes · F anti-cheat
lib/game/farm/gather.ts        NEW  pure: rules, odds and spot keys (mirror of 0018), critterPrice, critterCap, spot readiness, prompts
lib/game/farm/minigames.ts          + TransplantRound, CrabRound (seeded state machines, next to v15.2's HarvestGame round)
lib/game/farm/catalog.ts            + CritterKind parse; containers in describeFarmItem
lib/game/farm/state.ts              + mine.critters / critterCap / gather; critterPrices
lib/game/farm/rpc.ts                + crabStart, crabFinish, pickSnailBed, sellCritters; pick_snails `snails`
lib/game/farm/messages.ts, handbook.ts   texts; the tab "Cua & ốc"
lib/game/farm/actions.ts            the transplant button opens the game; pest-snail hints
lib/game/maps/types.ts, field.ts    InteractKind crab_hole | snail_bed with `spot`; 6 holes, 4 beds
lib/game/maps/field-art.ts          the holes and beds in the background
lib/game/art/farm-icons.ts          6 icons; lib/game/art/gather-art.ts NEW: the two overlays' drawings
lib/game/engine.ts                  setGatherSpots(ready cues)
hooks/useField.ts, hooks/useFarmController.ts   new calls; prompts; the crab, bed and transplant flows; fa re-sends
components/game/farm/*              CrabGame (NEW), TransplantGame (NEW), PlotPanel, FarmShopPanel, RiceDepotPanel, Handbook, FarmOverlays
components/game/fishing/BagPanel.tsx, components/game/GameShell.tsx   the "Cua & ốc" section; the HUD count
tests/fixtures/gather-cases.json (NEW), tests/sql/v15-gather-smoke.sql (NEW)
```

## 6. Map (`lib/game/maps/field.ts`)

The canal runs at y 176–208, x 56–764, with bridges at x 196–228 and 548–580. The plots' use spots sit on its banks at x 136, 288, 440 and 592 (north, y 164) and at x 136, 288 and 440 (south, y 218); the "Về ao cá" portal's is (760, 244).

| Spot | Bank | x ≈ | Label | Prompt |
|---|---|---|---|---|
| holes 1, 3, 5 | north (use y ≈ 166, facing down) | 96, 364, 700 | "Hang cua {n}" | "Bắt cua hang {n}" |
| holes 2, 4, 6 | south (use y ≈ 218, facing up) | 250, 500, 640 | "Hang cua {n}" | "Bắt cua hang {n}" |
| beds 1, 2 | south: the west end by the pump house, the foot of bridge 1 | 80, 180 | "Bãi ốc {n}" | "Mò ốc bãi {n}" |
| beds 3, 4 | north, east of plot 4; south, near the east end | 640, 712 | "Bãi ốc {n}" | "Mò ốc bãi {n}" |

- **Interactables.** The ids are `crab_1`…`crab_6` and `bed_1`…`bed_4`, with the kinds `crab_hole` and `snail_bed`. A new field `spot` holds the number, and `face` points at the water.
- **Spot keys.** The server keys a spot `"crab" + spot` or `"bed" + spot` (`crab1`…`crab6`, `bed1`…`bed4`: `gather_cooldowns.spot`, `mine.gather.ready_at`). `gather.ts` names the mapping (`spotKey(it)`: `crab_1` → `crab1`; `spotId(key)`: `crab1` → `crab_1`), and the fixture lists all 10 pairs.
- **The plan fixes the pixels. The map tests pin these invariants:** each hole's rect touches the canal edge and each bed lies on the water's edge; no hole or bed overlaps a plot, a solid or another spot; holes are ≥ 40 px apart; every gathering use spot is ≥ 32 px from every other use spot on the map; every use spot is reachable from both arrivals; the spot numbers are exactly 1–6 and 1–4.

## 7. Gathering

### 7.1 Critters, prices and capacity

`critter_kinds` (config):

| id | Name | Group | Base | Odds |
|---|---|---|---|---|
| `cua_dong` | Cua đồng | crab | 12 | 90 % of crabs |
| `cua_gach` | Cua gạch | crab | 45 | 10 % of crabs |
| `oc_dong` | Ốc đồng | snail | 8 | 70 % of bed snails |
| `oc_buou_vang` | Ốc bươu vàng | snail | 2 | 30 % of bed snails; every pest snail |

- **Price at the catch (R4).** `price = max(1, floor(base × M))`, where M = `_fish_index(room, now).mult`, `numeric(5,2)` in [1, 10]: the fish index, whose wealth leaves banned accounts out (R12). The price is stored on the critter row and paid at the sale, whatever M is then.
  - SQL: `greatest(1, floor(p_base * p_mult))::int`.
  - TS `critterPrice(base, mult)` works in integer hundredths: `Math.max(1, Math.floor(base * Math.round(mult * 100) / 100))`. The naive `45 * 1.4` gives 62.99… in JS, and the fixture pins 63.
- **Capacity (R5).** `critter_cap = 3 + max(capacity of owned critter_box)`: 3 by hand, 18 with a xô nhựa, 33 with a giỏ tre. Crabs and snails share it.

### 7.2 Crab holes and CrabGame

**The flow:**
1. At a ready hole, E calls `crab_start(hole)`. It checks, in order, the daily limit (`gather daily limit`), at least one free place (`critters full`) and the hole's cooldown for this account (`hole empty`, with `details` = the seconds left).
2. It then sets `ready_at = now + 20 min`, records the visit (`visit_id`, `visit_at`, `visit_room`) and counts a visit (§7.5). It answers `visit: {id, hole, started_at}`.
3. The client plants the avatar at the hole's use spot, facing the water, and opens CrabGame. It sends `fa 6` at the start and every 2 s, then `fa 0` at the end.
4. **When the game ends:**
   - with hits ≥ 1, the client waits until 4 s after the `crab_start` answer ("Đang bỏ cua vào xô…") and calls `crab_finish(visit, hits)`;
   - with hits 0 it calls at once. "Dừng (Esc)" follows R8 (§13.2).
5. **`crab_finish`** (R7) consumes the visit. The server rolls each hit (cua gạch when u < 0.1) and adds up to the free space, at the room's M. It answers `crab: {hits, caught: [{kind, price}], escaped}`.

**CrabRound** (`lib/game/farm/minigames.ts`, seeded):
- There are 3 tries. Each opens with a **0.6 s lead-in** ("Cua đang rình…") that ignores input. The claws then cycle with period P = **1.2 s, 0.95 s, 0.75 s** for tries 1–3: open for the first 60 % of each cycle, **closed for the last 40 %**, from a seeded phase in [0, P).
- **A grab** (Space, the mouse button or a finger) ends the try: while closed it is a **hit** ("Bắt được!"); while open a **pinch** ("Á! Bị cua kẹp"), and that crab is lost. **No grab** within 4 cycles is a **slip** ("Cua chui mất").
- A **0.5 s beat** follows each try. The result is `hits` ∈ 0..3, the count of hits by construction. A game takes 3.3 s at the least and 14.9 s at the most (3 × 1.1 s + 4 × (1.2 + 0.95 + 0.75) s).

**Input.** The v14 rules apply (the typing guard, pointer, touch, Space), and movement is locked while the overlay is open. The claw state is also written ("Càng mở" / "Càng khép — chộp!"). Under reduced motion the claws still open and close, without shake or splash.

### 7.3 Snail beds

- **The flow.** At a ready bed, E starts a **3 s bar** ("🐌 Đang mò ốc bãi {2}…") with `fa 7` at the start and at 2 s. Moving cancels it before anything is sent.
- **Then `pick_snail_bed(bed)`** checks the same three refusals as a hole (`bed empty` for the cooldown). It sets `ready_at = now + 20 min` and counts a visit.
- **The roll.** `n = 1 + floor(u₁ · 3)` snails (1–3), each an ốc đồng when uᵢ < 0.7, otherwise an ốc bươu vàng. As many as fit are kept, at M.
- **The answer** is `snails: {caught, escaped}`.

### 7.4 Pest snails vs snail beds (V3)

| | Bắt ốc trên ruộng (`pick_snails`, v15.1) | Mò ốc ở bãi (`pick_snail_bed`, new) |
|---|---|---|
| Where | a rice plot with an active ốc bươu vàng outbreak; anyone may pick on any plot | the 4 beds at the canal's shallow edges |
| When | only while the outbreak is active (a hidden roll fired), once per outbreak | any time, 20 min per bed per account |
| What it is for | pest control: it stops the damage (up to 30 % of the crop) | income, as a side activity |
| Yield | 1–3 ốc bươu vàng (2·M xu each) for the picker, as a bonus | 1–3 snails, 70 % ốc đồng (8·M), 30 % ốc bươu vàng (2·M) |
| Full container | the pick still works and the plot is saved; the snails go back into the canal | refused beforehand (`critters full`) |
| Limits | none beyond outbreaks; no visit counted | the cooldown and the daily limit |
| Changes | the plot (`fp`), `picks` log | only the picker's belongings (no `fp`) |

The re-created `_farm_do_pick_snails` keeps every `0016` check (`no snails`, `harvester busy`, `harvesting`) and the `picks` log. It then adds the snails through `_critter_add`.

### 7.5 Daily limit (R3)

- `farm_profiles` gains `gather_on date` and `gather_count smallint` (≥ 0). Days are Vietnam days of `p_now`.
- **The check** comes first in both visit RPCs: with `gather_on` = today and `gather_count` ≥ 200, it raises `gather daily limit` (SQLSTATE 53400, `details` = the seconds until the next Vietnam midnight).
- **The count** happens after the other checks pass: `gather_count` + 1, or 1 on a new day. When the count reaches exactly 200, the RPC performs `_ac_flag(…, 'gather_daily_cap', rpc, {day, visits: 200}, room, null, false)` (soft) and continues.
- **What counts.** A hits-0 visit counts. `pick_snails` does not.

### 7.6 Selling

`sell_critters(kind | null)` at cô Út deletes the matching critters and pays the sum of their stored prices (`critter_sell`, ref `'<kind|all> x<n>'`).

## 8. Transplant minigame (TransplantGame)

### 8.1 The flow

1. "Cấy lúa" (rice, seedlings ≥ 8·s h old, water Nông) or "Trồng cây ớt con" (ớt, nursery ≥ `nursery_ready_h`, Ẩm) calls `begin_work(plot, 'transplant')`. It needs **10 s** left on the lease (`lease ending`, R19) and replaces any earlier record (v15.2 R6).
2. The client plants the avatar and opens the overlay when the answer arrives. It sends `fa 1` at the start and every 2 s, then `fa 0` at the end (v15.2 R14).
3. **Success (score ≥ 6).** The client waits until **9 s** after the `begin_work` answer ("Đang cắm nốt hàng mạ…"), then calls `transplant(plot, 1)`.
4. **Failure.** "❌ … Thử lại" starts a new round with a new `begin_work`. Nothing is reported. Esc, "Huỷ" or a disconnect sends nothing either; the leftover record expires after 120 s or is replaced.

### 8.2 TransplantRound (`minigames.ts`, seeded)

- **The round.** A 1 s lead-in ("Sẵn sàng…"), then 12 beats, one hill each.
- **Each beat.** A hand holding seedlings sweeps x from 0 to 1 in **1.4 s**. The beat's band is centred at c ∈ [0.35, 0.65] (seeded).
- **Scoring a press** at x:

  | Press | Score | Mark |
  |---|---|---|
  | \|x − c\| ≤ 0.08 | chuẩn 1 | "Thẳng hàng!" |
  | \|x − c\| ≤ 0.18 | được 0.5 | "Được" |
  | otherwise | lệch 0 | "Lệch hàng" |
  | no press by x = 1 | 0 | "Bỏ sót khóm" |

- A **0.25 s beat** after each hill ignores input.
- **Pass** at a score ≥ 6 of 12. A typical round takes about 12 s (4–21 s).
- **Input** follows the v14 rules, as for CrabGame. Reduced motion keeps the sweep, without particles. The ớt round draws chili seedlings and says "cây" instead of "khóm".

### 8.3 Server (R19)

- **`_work_gate` and `_farm_do_transplant`, each re-created from its latest definition** (`0016` may have changed the gate for `harvest_part`). For `transplant` the gate accepts only while `work = 'transplant'` and 8 s ≤ `p_now − work_started_at` ≤ 120 s: earlier, or with no record, is `too fast`; later is `work expired`. Every other work keeps its latest rule: a hoa-màu picking needs 2 s with no upper bound, and `harvest_part` keeps its 8–120 s. `_farm_do_transplant` applies that gate, sets `transplant_at` (rice) or P (ớt), and keeps `q_transplant = 1.0`.
- **`_farm_do_begin_work`, re-created from `0016`.** The lease gate is 10 s for a rice round or any transplant, and 5 s for a picking.
- **The wrapper** `transplant` keeps `bad_plot` and `quality_range`. The gather smoke pins all three gates (§16).
- **A lease that runs out mid-round.** The call's sweep deletes the crop, and `transplant` raises `not your plot`, shown with the transplant context (§11.8).

## 9. Items

| id | kind | Name | Price | capacity | sort |
|---|---|---|---|---|---|
| `box_bucket` | critter_box | Xô nhựa | 1 500 | 15 | 10 |
| `box_basket` | critter_box | Giỏ tre | 6 000 | 30 | 20 |

- **Buying.** They are sold by `buy_farm_item` at anh Hai's (R16), with the ledger reason `farm_buy`. After the guard and the kind check: a quantity ≠ 1 raises `invalid quantity`; a container whose capacity is ≤ the one you hold raises `already owned`; then `not enough coins`.
- **Descriptions** (`describeFarmItem`): "Đựng thêm 15 con cua, ốc (tay cầm được 3 con)" and "Đựng thêm 30 con cua, ốc (tay cầm được 3 con)".

## 10. Economy check (V6)

**Prices and expectations.** E[crab] = 0.9 × cua đồng + 0.1 × cua gạch. E[snail] = 0.7 × ốc đồng + 0.3 × ốc bươu vàng.

| M | cua đồng | cua gạch | ốc đồng | ốc bươu vàng | E[crab] | E[snail] |
|---|---|---|---|---|---|---|
| 1 | 12 | 45 | 8 | 2 | 15.3 | 6.2 |
| 5 | 60 | 225 | 40 | 10 | 76.5 | 31.0 |

**Per hour, per account** (the cooldowns bind, in every room together, R1):

| Source | Per hour | M = 1 | M = 5 |
|---|---|---|---|
| Crabs, cap: 6 holes × 3 visits × 3 hits = 54 | 54 × E[crab] | 826.2 | 4 131.0 |
| Snail beds: 4 beds × 3 visits × 2 (mean of 1–3) = 24 | 24 × E[snail] | 148.8 | 744.0 |
| **Critters, cap, on average** (a script claiming 3 hits every visit) | | **975.0** | **4 875.0** |
| Critters, worst case (every crab a cua gạch, every bed 3 ốc đồng) | 54 × 45 + 36 × 8 | 2 718 | 13 590 |
| Critters, honest (2.4 hits a hole on average) | 43.2 crabs + 24 snails | ≈ 810 | ≈ 4 049 |
| Fishing, v14 reference × M (skilled, worms, wooden rod; S = 1) | 40 casts max | 1 000–1 800 | 5 000–9 000 |
| Fishing at its cap (40 × 46 xu on average) | | 1 840 | 9 200 |

- **The result.** On average the critter cap is 97.5 % of fishing's low end and 53 % of fishing's cap, at both M. The season factor S (mean ≈ 1.10) raises fishing further.
- **The worst case** is 2 718·M an hour. Each crab is a cua gạch with p = 0.1 on its own, so an hour near it is vanishingly rare, and fishing's own worst case (a record cá hô every cast) is far higher. Both sides are compared on average.
- **Floor pricing (R4)** keeps every price ≤ base × M, so the average ratio never exceeds 97.5 % at any M from 1.00 to 10.00 (checked at every hundredth). With round, it would reach 99.6 % at M = 1.46.
- **Why R2 was needed.** The old beds (15 min, 1–4 snails) paid 248·M on average, which puts the cap at 1 074·M, above 1 000·M.
- **Pest snails** are left out: ≤ 3 × 2·M xu per outbreak, and outbreaks are rare.
- **Per day.**
  - With the 200-visit limit, the most is 200 × 3 × 15.3 = **9 180·M on average** (every visit a crab visit, about 11 h of rounds); the worst case is 600 × 45 = 27 000·M.
  - Fishing's daily cap is 300 × 46 = **13 800·M on average**.
  - With no limit, a 24 h script would take 24 × 975 = 23 400·M on average.
- **Per minute of play.** A full round (6 holes, 4 beds) is ≈ 2 min of walking and games for ≤ 350·M xu (≈ 325·M on average with 3 hits a hole). That beats a fishing minute, but only three rounds fit in an hour: critters are a side income between casts, not a replacement.
- **Containers** buy convenience, not critters per hour. Hands (3) mean a walk to cô Út after every hole; a xô (18) carries a round's 6 holes; a giỏ (33) carries a whole round (≤ 30). At M = 1 the xô costs ≈ 1.5 h of the cap and the giỏ ≈ 6 h; at M = 5, ≈ 18 and 74 minutes. They are a one-time sink of at most 7 500 xu (a xô, then a giỏ).
- **Room wealth.** Critters stay out of W, as fish do (economy §5.2).

## 11. Server — `0018_v15_3_gather.sql`

### 11.1 Sections (in order; `language sql` bodies are checked at creation)

| Section | Contents |
|---|---|
| **A** Config and catalog | `critter_kinds` + seeds (`on conflict do update`) + select policy for anon + `grant select`, `revoke insert, update, delete, truncate`; the two `critter_box` items; the `coin_ledger` check |
| **B** Tables | `critters`, `gather_cooldowns`, the `farm_profiles` columns; RLS on, no policies, revoked |
| **C** Helpers and views | `_critter_price`, `_critter_prices`, `_critter_cap`, `_critter_add`, `_gather_check`, `_gather_count`; `_farm_mine` and `_field_view` re-created |
| **D** Gathering | `_gather_do_crab_start`, `_gather_do_crab_finish`, `_gather_do_bed`; the 4 guarded RPCs |
| **E** Farm changes | `_work_gate`, `_farm_do_transplant`, `_farm_do_begin_work`, `_farm_do_pick_snails`, `buy_farm_item` (guard kept) |
| **F** Anti-cheat | `_ac_holdings` and `_ac_wipe` re-created from `0017` |

### 11.2 Tables, columns and the ledger

```sql
create table if not exists public.critter_kinds (id text primary key, name text not null,
  grp text not null check (grp in ('crab','snail')), base_price integer not null check (base_price > 0),
  sort_order integer not null default 0);                          -- seeds: §7.1, sort 10/20/30/40
create table if not exists public.critters (                       -- one row per critter held (≤ 33 per account)
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null references public.critter_kinds(id),
  price integer not null check (price >= 1),                       -- base × M at the catch (floor), what cô Út pays
  caught_at timestamptz not null);
create index if not exists idx_critters_account on public.critters (account_id, kind);
create table if not exists public.gather_cooldowns (               -- per account and spot, across rooms (R1)
  account_id uuid not null references public.accounts(id) on delete cascade,
  spot text not null check (spot ~ '^(crab[1-6]|bed[1-4])$'),
  ready_at timestamptz not null,
  visit_id uuid, visit_at timestamptz, visit_room uuid,            -- an open crab visit, else all null
  primary key (account_id, spot),
  check ((visit_id is null) = (visit_at is null) and (visit_id is null) = (visit_room is null)));
alter table public.farm_profiles add column if not exists gather_on date;
alter table public.farm_profiles add column if not exists gather_count smallint not null default 0;  -- check ≥ 0 (drop/add)
alter table public.coin_ledger drop constraint if exists coin_ledger_reason_check;
alter table public.coin_ledger add constraint coin_ledger_reason_check
  check (reason in ('daily','song','sell','buy','rent','land_buy','land_sell','land_refund','lease_pay','lease_income',
                    'farm_buy','rice_sell','wipe','harvester','produce_sell',
                    'card_hold','card_settle','card_buyin','card_cashout','card_refund','critter_sell'));
```

The list is `0015`'s list, then `0016`'s additions, then `0017`'s, then `critter_sell`: 21 reasons. The plan diffs it against `0017`'s check.

### 11.3 Private functions (each `revoke all … from public, anon, authenticated`)

**New:**

| Function | Does |
|---|---|
| `_critter_price(p_base integer, p_mult numeric) → integer` | `greatest(1, floor(p_base * p_mult))::int`, immutable |
| `_critter_prices(p_room, p_now) → jsonb` | `{mult, ends_at}` from the room's `fish_price_index` row when its period is current, else the preview `_fish_mult(_room_wealth(room, p_now))` (R12); stable, never writes |
| `_critter_cap(p_account) → integer` | 3 + the largest owned `critter_box` capacity |
| `_critter_add(p_account, p_room, p_kinds text[], p_now) → jsonb` | computes the free space, takes M from `_fish_index(p_room, p_now)` (this may write the snapshot), inserts the first `free` kinds at `_critter_price`, and returns `{caught: [{kind, price}], escaped}` |
| `_gather_check(p_account, p_now)` | ensures the `farm_profiles` row and raises `gather daily limit` (§7.5) |
| `_gather_count(p_account, p_room, p_rpc, p_now)` | counts the visit and flags `gather_daily_cap` at 200 |
| `_gather_do_crab_start(p_room, p_account, p_hole, p_now)` | §7.2 |
| `_gather_do_crab_finish(p_room, p_account, p_visit, p_hits, p_now, p_u double precision[] default null)` | §11.5 |
| `_gather_do_bed(p_room, p_account, p_bed, p_now, p_u double precision[] default null)` | §7.3 |

- **Order inside each `_gather_do_*`:** `_wallet_lock(account)`, then the checks, then the writes; the index row comes last (R12).
- **`critters full`** is `_critter_cap − count(critters) < 1`.

**Re-created, each from its latest version, adding only this:**
- **`_farm_mine`** (`0016`) gains `critters`, `critter_cap` and `gather` (§11.7). It stays `(p_account)`, `language sql stable`, and uses `now()` for `left_today`, as `_fishing_state` does.
- **`_field_view`** (`0013`) gains `critter_prices = _critter_prices(p_room, p_now)`.
- **`_work_gate`**, **`_farm_do_transplant`** (each from its latest definition) and **`_farm_do_begin_work`** (`0016`): §8.3.
- **`_farm_do_pick_snails`** (`0016`) keeps its signature (R14). After the `picks` append it calls `_critter_add(p_account, p_room, array_fill('oc_buou_vang'::text, array[1 + floor(random() * 3)::int]), p_now)` and returns `_field_view(…) || {snails}`.
- **`buy_farm_item`** (`0016`, public, `_ac_account`) handles `critter_box`:
  - `kind_mismatch` allows `seed`, `fertilizer`, `pesticide`, `tool` and `critter_box`;
  - `bad_qty` stays null or outside 1–99;
  - then R16's refusals.
- **`_ac_holdings`** and **`_ac_wipe`** (`0017`): §11.6.

### 11.4 Public RPCs

Each is SECURITY DEFINER with `set search_path = public, extensions` and an explicit `grant execute … to anon, authenticated`. The hard checks run right after the guard, before any lock.

| RPC | Guard; hard check | Refusals, in order | Answer |
|---|---|---|---|
| `crab_start(p_room_id uuid, p_session_token text, p_hole integer)` | `_ac_play`; `bad_spot` (null or outside 1–6) | `gather daily limit`, `critters full`, `hole empty` | `{server_now, mine, visit: {id, hole, started_at}}` |
| `crab_finish(p_room_id uuid, p_session_token text, p_visit_id uuid, p_hits integer)` | `_ac_play`; `bad_qty` (null or outside 0–3) | `visit not found` (no open visit with this id, account and room), `too fast` (hits ≥ 1 under 3 s), `visit expired` (over 120 s) | `{server_now, mine, crab: {hits, caught, escaped}}` |
| `pick_snail_bed(p_room_id uuid, p_session_token text, p_bed integer)` | `_ac_play`; `bad_spot` (null or outside 1–4) | `gather daily limit`, `critters full`, `bed empty` | `{server_now, mine, snails: {caught, escaped}}` |
| `sell_critters(p_session_token text, p_kind text)` | `_ac_account` | `invalid kind` (not null and not in `critter_kinds`), `no critters` | `{server_now, mine, sold: {n, xu}}` |

- **`hole empty` and `bed empty`** carry `details` = the whole seconds left. All refusals are 22023, except `gather daily limit` (53400).
- **Changed, with the same signatures:**
  - `begin_work(…, 'transplant')` has the 10 s lease gate;
  - `transplant` has the 8–120 s gate;
  - `pick_snails` adds `snails`;
  - `buy_farm_item` sells containers;
  - `field_state` and every field answer carry `critter_prices`, `mine.critters`, `critter_cap` and `gather`.

### 11.5 `crab_finish`'s body

```sql
perform public._wallet_lock(p_account);
select * into g from public.gather_cooldowns
 where account_id = p_account and visit_id = p_visit and visit_room = p_room for update;
if not found then raise exception 'visit not found' using errcode = '22023'; end if;
if p_hits >= 1 and p_now < g.visit_at + interval '3 seconds' then raise exception 'too fast' using errcode = '22023'; end if;
if p_now > g.visit_at + interval '120 seconds' then raise exception 'visit expired' using errcode = '22023'; end if;
update public.gather_cooldowns set visit_id = null, visit_at = null, visit_room = null
 where account_id = p_account and spot = g.spot;                                  -- single use
for k in 1 .. p_hits loop
  v_kinds := v_kinds || case when coalesce(p_u[k], random()) < 0.1 then 'cua_gach' else 'cua_dong' end;
end loop;
v_res := public._critter_add(p_account, p_room, v_kinds, p_now);
return jsonb_build_object('server_now', p_now, 'mine', public._farm_mine(p_account),
                          'crab', v_res || jsonb_build_object('hits', p_hits));
```

- A raised `too fast` or `visit expired` rolls nothing back that matters: the visit stays, open or inert. An expired visit is overwritten by the next `crab_start` on that hole.
- **The crab wrapper** follows anti-cheat §10.3's shape: `declare v_account uuid := public._ac_play(…)`. When `p_hits is null or p_hits not between 0 and 3` it returns `_ac_flag(v_account, 'bad_qty', 'crab_finish', {visit, hits}, p_room_id, 'invalid quantity')`. Otherwise it returns `_gather_do_crab_finish(…, now())`.

### 11.6 Anti-cheat

| Item | Rule |
|---|---|
| Guards | `crab_start`, `crab_finish` and `pick_snail_bed` use `_ac_play`; `sell_critters` uses `_ac_account`. They join the D2 lock list (52 in all) and the dynamic loop in `anticheat-guards.sql`. The allowlist, which matches signatures since `de9ae10`, is unchanged: `0018` adds no overload of an allowlisted name. `WARN_LOCK` gains "bắt cua mò ốc" after "làm ruộng". |
| Hard `bad_qty` | `crab_finish` with `p_hits` null or outside 0–3 (anti-cheat §11.3). Honest source: `CrabRound.hits` counts hit tries (`CRAB_TRIES = 3`), and the controller sends it unchanged. |
| Hard `bad_spot` (new, R21) | `crab_start` hole null or outside 1–6; `pick_snail_bed` bed null or outside 1–4. Error `invalid spot`, detail `{spot}`. Honest source: the `spot` of the map's `crab_hole` / `snail_bed` interactables. |
| Soft | `gather_daily_cap` (§7.5). `kind_mismatch` in `buy_farm_item` now allows `critter_box`. |
| Never counted (anti-cheat §7.3) | `hole empty`, `bed empty`, `critters full`, `gather daily limit`, `visit not found`, `visit expired`, `too fast` (`crab_finish`, `transplant`), `work expired`, `lease ending`, `no critters`, `invalid kind`, `already owned`, and a container with quantity ≠ 1. The honest causes are two tabs, a double finish, a lost answer, a backgrounded tab, a room switch, a stale state, and a cached v15.2 client after `0018`. |
| Labels (anti-cheat §12.5) | `bad_spot` "Số hang cua/bãi ốc sai"; `gather_daily_cap` "Chạm 200 lượt bắt cua, mò ốc/ngày". `reasonText` falls back to the generic text. |
| Wipe | `_ac_holdings` gains `"critters": [{kind, n, xu}]`. `_ac_wipe` also deletes `critters` and `gather_cooldowns`. Everything `0015`–`0017` put in both stays, including the first-step `_card_forfeit_all` and the produce and tank deletes. |
| Accepted residual | The hits are client-declared, like the reel. The README trust model uses this wording: "A script that claims 3 hits at every visit earns no more than a perfect player: on average 975·M xu an hour and 9 180·M a day, and at worst 2 718·M an hour." |

### 11.7 `field_state` changes

```jsonc
"critter_prices": { "mult": 2.24, "ends_at": "…" },         // the client prices each kind with critterPrice(base, mult)
"mine": { …,                                                 // also in every {server_now, mine} answer
  "items": { "box_basket": 1, … },                           // containers, as before
  "critters": { "cua_dong": { "n": 5, "xu": 130 }, "cua_gach": { "n": 1, "xu": 100 } },   // held: count, what cô Út pays
  "critter_cap": 33,
  "gather": { "ready_at": { "crab3": "…", "bed1": "…" },      // spots still cooling for me (any room)
              "left_today": 187, "day_resets_at": null } }   // resets_at only while left_today = 0
```

A v15.3 client parses the missing keys (a database before `0018`) as: no prices, no critters, cap 3, everything ready, 200 left.

### 11.8 Errors → Vietnamese (`farmErrorMessage(err, itemName?, action?)`)

| Server message | Vietnamese |
|---|---|
| `hole empty` | "Cua chưa ra — quay lại sau {12 phút}." (the minutes come from `details`) |
| `bed empty` | "Bãi này vừa mò rồi — quay lại sau {7 phút}." |
| `critters full` | with `itemName` (the container): "{Giỏ tre} đầy rồi — ra vựa cô Út bán bớt nhé."; without: "Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai." |
| `gather daily limit` | "Hôm nay bạn bắt cua, mò ốc đủ 200 lượt rồi — mai quay lại nhé!" |
| `visit not found` | "Lượt bắt cua này đã xong." |
| `visit expired` | "Lâu quá, cua chui mất rồi — lát nữa quay lại nhé." |
| `too fast`, `"crab_finish"` context | "Chưa bắt xong — thử lại sau vài giây." |
| `too fast`, `"transplant"` context | "Chưa cấy xong hàng mạ — thử lại sau vài giây." |
| `work expired`, `"transplant"` context | "Lượt cấy đã quá lâu — bắt đầu lại nhé." |
| `lease ending`, `"transplant"` context | "Sắp hết hạn thuê — không kịp cấy." |
| `not your plot`, `"transplant"` context | "Hết hạn thuê — mạ trên thửa đã mất." |
| `no critters` | "Không có cua ốc để bán." |
| `invalid spot`, `invalid kind` | not mapped (only a tampered call or a catalog change): "Có lỗi, thử lại nhé." |

- Without a context, `too fast` stays "Từ từ thôi…", and `work expired` and `lease ending` keep v15.2's texts.
- `NOT_OPEN_153` = "Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018."

## 12. Networking (V9)

- **`fa`** uses existing codes, each ended by `fa 0`: 6 (crab) during CrabGame and 1 (transplant) during a TransplantGame round, both re-sent every 2 s; 7 (snails) at the start and at 2 s of a bed's 3 s bar, and after `pick_snails`. No new code, so the v15.2 parser (0–10) is unchanged.
- **`fp`** follows `pick_snails` and a successful `transplant`, as today. Gathering sends none (R11).
- **Budget.** A round of 6 holes and 4 beds sends ≈ 40 `fa` over ≈ 2 min; a transplant round ≈ 8. Both are far inside the per-sender `fa` budget (3 per s, burst 5, since `de9ae10`) and the free-plan quota.

## 13. Game UI

### 13.1 Field prompts and cues

`gatherPrompt(it, mine, now)` in `gather.ts` is pure and uses the server clock. When several states apply, the first row wins, in the server's refusal order (§7.2): daily limit → full → cooling → ready. A test pins the order.

| State | Prompt | E does |
|---|---|---|
| daily limit | "Hết lượt bắt cua, mò ốc hôm nay" | toasts the limit text |
| full | "Hang {3} · {giỏ tre \| tay} đầy — bán ở vựa cô Út" | toasts the `critters full` text |
| cooling | "Hang {3} · cua chưa ra (còn {12} phút)" / "Bãi {2} · còn {7} phút" | toasts the `hole empty` / `bed empty` text |
| ready | "E · Bắt cua hang {3}" / "E · Mò ốc bãi {2}" | opens CrabGame / starts the 3 s bar |

Before `0018` (the catalog has no critter kinds) every spot shows its ready prompt, and E toasts `NOT_OPEN_153`.

**The cue.** `engine.setGatherSpots([{id, ready}])` draws a "ready for me" cue on each hole and bed (§15). It updates on every answer and on the 30 s field tick.

### 13.2 CrabGame overlay (`components/game/farm/CrabGame.tsx`)

- **Title and help.** "🦀 Bắt cua · hang {3}" and "Cua giơ càng mở ra khép vào. Bấm Space (hoặc chạm, bấm chuột) lúc càng KHÉP để chộp — càng mở mà chộp là bị cua kẹp!"
- **During the game:** "Lần {2}/3 · bắt được {1}", the state line, and the marks from §7.2.
- **The result:**
  - with a catch: "🦀 Bắt được {2} con: {1} cua đồng, {1} cua gạch!", plus " {1} con chạy mất vì {xô nhựa} đầy." when some escaped;
  - with none: "🦀 Cua chui hết vào hang rồi — 20 phút nữa quay lại nhé."
  - The button is "Đóng".
- **"Dừng (Esc)"** (R8), shown until the result:
  - before the first try ends it closes the overlay and sends nothing; the toast reads "Đã rút tay — hang này 20 phút nữa mới có cua lại.";
  - after a try it ends the game and reports the hits so far;
  - during the 4 s wait it closes the overlay, and the finish is still sent: the result comes as a toast.
- **Refusals** show the §11.8 text with the `"crab_finish"` context.
- **Accessibility.** An `aria-live="polite"` line reads each mark.

### 13.3 TransplantGame overlay (`components/game/farm/TransplantGame.tsx`)

- **Title and help.** "🌱 Cấy lúa thửa {3}" or "🌶️ Trồng cây ớt con thửa {6}", and "Bấm Space (hoặc chạm, bấm chuột) khi bàn tay vào vùng xanh để cắm {khóm mạ | cây ớt} cho thẳng hàng."
- **During the round:** "{Khóm} {5}/12 · {3,5} điểm", the §8.2 marks, and "Đang cắm nốt hàng mạ…" while a success waits out the 9 s.
- **Success:**
  - rice: "✅ Cấy xong thửa {3} — giữ nước Nông, bón thúc đúng lúc nhé!";
  - ớt: "✅ Trồng xong cây ớt con thửa {6}.";
  - the button is "Đóng".
- **Failure:** "❌ Được {5,5}/12 điểm — cần 6. Thử lại ngay nhé!", with "Thử lại" and "Nghỉ tay". Cancel is "Huỷ (Esc)".

### 13.4 Plot panel, shop, depot, bag, HUD

- **Plot panel.**
  - "Cấy lúa" and "Trồng cây ớt con" open TransplantGame. Their hint: "Mỗi lượt cắm 12 {khóm | cây} — được từ 6 điểm là xong; hụt thì làm lại, không mất gì."
  - A disabled reason is added: "Sắp hết hạn thuê — không kịp cấy." (under 10 s).
  - The pest button "Bắt ốc bươu vàng" gains the hint "Bắt ốc cứu lúa — được thêm 1–3 con ốc bươu vàng bỏ xô." When full, it reads "{Xô nhựa | Giỏ tre | Tay} đầy — ốc bắt được thả xuống mương, lúa vẫn được cứu." Before `0018` (no critter kinds in the catalog) it keeps v15.2's button with no hint, so nothing promises snails. The button stays enabled.
- **Shop (anh Hai).** A new section "🪣 Đồ đựng cua ốc", after "🛠️ Nông cụ". A row has no stepper: "Mua · {1.500 xu}", or disabled "✓ Đã có" / "Đã có {giỏ tre} lớn hơn".
- **Depot (cô Út).** A new section "🦀 Cua & ốc":
  - the price line: "Giá hôm nay ×{2,24}: cua đồng {26} · cua gạch {100} · ốc đồng {17} · ốc bươu vàng {4} xu/con";
  - a row per kind held: "{Cua đồng} × {5} · {130} xu", with "Bán {5} con · {130} xu";
  - "Bán hết cua ốc · {230} xu";
  - the footnote "Giá chốt lúc bắt được; bán sau vẫn giữ giá đó.";
  - the toast, from `sold`: "💰 Bán {6} con cua ốc được {230} xu.";
  - the empty text, extended: "“Chưa có lúa, hoa màu hay cua ốc hả con? Có hàng mang qua, cô trả giá cao!”".
- **Bag, "🦀 Cua & ốc":**
  - "{Giỏ tre} · {12}/{33} con", or "Tay không · {2}/3 con — tiệm anh Hai bán xô nhựa 1.500 xu, giỏ tre 6.000 xu";
  - a line per kind: "{Cua gạch} × {1} · {100} xu";
  - "Bán ở vựa cô Út · hôm nay còn {187} lượt bắt cua, mò ốc."
- **HUD.** `produceSummary` adds " · 🦀 {12}" while any critter is held.
- **Toasts:**
  - a bed: "🐌 Mò được {3} con ốc: {2} ốc đồng, {1} ốc bươu vàng.", plus " Thả lại {1} con vì {xô nhựa} đầy." when some escaped;
  - `pick_snails`, all kept: "🐌 Bắt ốc thửa {5}: được {2} con ốc bươu vàng.";
  - `pick_snails`, some kept: "🐌 Bắt ốc thửa {5}: được {1} con, thả {1} con xuống mương vì {xô nhựa} đầy.";
  - `pick_snails`, none kept: "🐌 Bắt ốc thửa {5} — {xô nhựa | tay} đầy, thả {2} con xuống mương.";
  - `pick_snails` with no `snails` key in the answer (a database before `0018`): v15.2's "Đã bắt ốc bươu vàng.";
  - a container: the existing `boughtText`.

## 14. Handbook — tab "Cua & ốc" (id `critters`)

The tabs become Quy trình, Phân bón, Sâu bệnh, Nước, Giống lúa, Mẹo, Khoai lang, Bắp, Ớt, Nông cụ, **Cua & ốc**; they wrap. `critterHandbook(kinds, boxes)` builds the lines from the config and `gather.ts`. The lines below are verbatim, one per line:

- **Bắt cua ở hang**
  - "Dọc bờ mương có 6 hang cua. Đứng trên bờ, bấm E để thò tay vào hang."
  - "Cua giơ càng mở ra khép vào, lần sau nhanh hơn lần trước. Chộp lúc càng khép là bắt được; chộp lúc càng mở là bị kẹp, con đó chạy mất. Mỗi hang thử 3 lần."
  - "Thò tay vào rồi thì hang phải 20 phút sau mới có cua lại — tính riêng cho bạn, ở phòng nào cũng vậy."
  - "Chừng mười con có một con cua gạch, giá gần gấp 4 cua đồng."
- **Mò ốc ở bãi**
  - "4 bãi ốc nằm chỗ nước cạn ven mương. Mò 3 giây được 1–3 con, phần nhiều là ốc đồng."
  - "Mỗi bãi mò xong 20 phút sau mới có ốc lại."
- **Ốc bươu vàng trên ruộng — khác bãi ốc**
  - "Ốc bươu vàng trên ruộng là sâu hại: thấy trứng hồng ở thửa nào thì bắt giúp, ruộng ai cũng được."
  - "Bắt ốc là cứu lúa, còn được thêm 1–3 con ốc bươu vàng bỏ xô. Xô đầy vẫn bắt được — ốc thả xuống mương."
  - "Bắt ốc trên ruộng không phải chờ và không tính vào lượt mò ốc."
- **Đồ đựng**
  - "Tay cầm được 3 con. Xô nhựa (1.500 xu) đựng thêm 15 con, giỏ tre (6.000 xu) thêm 30 — mua ở tiệm anh Hai; có giỏ thì khỏi cần xô."
  - "Cua và ốc đựng chung. Đầy rồi thì phải bán bớt mới bắt, mò tiếp được."
- **Giá và bán**
  - "Bán cho cô Út ở vựa lúa. Giá gốc một con: cua đồng {12}, cua gạch {45}, ốc đồng {8}, ốc bươu vàng {2} xu."
  - "Giá nhân hệ số phòng như giá cá, chốt lúc bắt được — bán sau vẫn giữ giá đó."
  - "Mỗi ngày bắt cua, mò ốc tối đa 200 lượt."

**Edits to the existing tabs:**
- **Quy trình, step 6:** "6. Cấy lúa: mạ đủ tuổi, nước Nông. Mỗi lượt cắm 12 khóm — thẳng hàng được từ 6 điểm là cấy xong; hụt thì cấy lại, không mất gì. Mạ già quá mất 3% mỗi giờ."
- **Ớt tab, nursery line:** it gains "— mỗi lượt trồng 12 cây, được từ 6 điểm là xong."
- **Mẹo** gains: "Trong lúc chờ lúa, cứ 20 phút ghé bờ mương bắt cua, mò ốc — thêm tiền mà không tốn giống, phân."
- **The plot panel's handbook link** opens "Cua & ốc" from the pest-snail hint.

## 15. Art (V8)

Everything is original and drawn in code.

- **`field-art.ts` (background):**
  - **each hole:** a 10 × 6 px burrow `#3a2a1a` with a rim `#5a4128` in the bank mud `#6e5230`, and 2–3 mud pellets `#7a5c38` beside it;
  - **each bed:** a 20 × 10 px shallow patch, sand `#c9b58a` under light water `#8cc3d6`, with water-hyacinth leaves `#4f9a38` / `#6fbf4a` and two pale stones `#d9d2c0`.
- **The engine's per-viewer cue** is drawn over the background, under props and people. Nothing shows while a spot cools.
  - **A ready hole:** two eye stalks `#2a2f3a` and a claw tip `#b8432f` peek out, and a bubble `#e8f4f8` rises every 1.5 s.
  - **A ready bed:** 2–3 shells glint (`#4a3a22` ốc đồng, `#c9955a` ốc bươu vàng).
  - Under reduced motion the cues are static.
- **`farm-icons.ts` (16 × 16, `iconMatrixFor`):**
  - `box_bucket`: a blue plastic bucket `#3d6fd1` / `#2f56a6` with a grey handle `#d9d9e0`;
  - `box_basket`: a woven bamboo basket `#c8a46a` with a darker weave `#9a7a44`;
  - `cua_dong`: an olive-brown field crab `#6b5a2e` / `#8e7a44` with red claw tips `#b8432f`;
  - `cua_gach`: the same crab, belly-up to show the orange roe `#e0662f` / `#f29b4a`;
  - `oc_dong`: a round dark snail `#4a3a22` with a spiral `#8a6a3f`;
  - `oc_buou_vang`: a larger golden-brown shell `#c9955a` / `#8a5a2b` with a pink egg dot `#f29bb5`.
- **`gather-art.ts` (NEW; the overlay canvases, drawn at an integer scale):**
  - **CrabGame (96 × 64):** the bank in cross-section and the hole mouth; the crab's carapace `#6b5a2e` and two claws, spread wide with a red outline `#d8342a` when open and together with a green outline `#4caf50` when closed; a neutral hand `#e0b089` that hovers, dips on a grab, and jerks back with "!" marks on a pinch.
  - **TransplantGame (160 × 48):** mud `#6e5230` with a sheen, a guide line and 12 hill slots; set hills as tufts `#6fbf4a` / `#4f9a38`, a "lệch" hill 2 px off the line; the band `#6fbf4a` at 35 % alpha with its chuẩn core at 55 %; the sweeping hand with a seedling bunch tied `#8b5a33`. The ớt variant draws rounder leaves `#5caa4a`.
- **`farm-anim.ts`:** codes 6 (crab) and 7 (snail) already exist.

## 16. Testing

**Shared fixture `tests/fixtures/gather-cases.json`:**
- `rules`: hand 3; boxes 15 and 30; cooldown 1 200 s; 200 visits a day; crab gate 3 s; visit window 120 s; transplant gate 8 s; work window 120 s; odds 0.1 and 0.7; bed snails 1–3.
- `prices`: `[base, mult, price]` rows: 12·1.00 → 12, 45·1.00 → 45, 12·1.46 → 17, 45·1.46 → 65, 8·1.46 → 11, 2·1.46 → 2, **45·1.40 → 63**, 12·2.24 → 26, 45·2.24 → 100, 8·2.24 → 17, 2·2.24 → 4, 12·5.00 → 60, 45·5.00 → 225, 2·10.00 → 20.
- `spots`: the 10 `[interactable id, server key]` pairs, `["crab_1", "crab1"]` … `["bed_4", "bed4"]`.
- The TS tests assert `gather.ts`, `critterPrice`, `spotKey` and `spotId` against it. The SQL smoke loads it with `\copy` (as `v15-smoke.sql` does) and asserts `_critter_price`, the rules, and the key each `crab_start(n)` / `pick_snail_bed(n)` writes.

**Pure TS (Vitest):**
- **`farm-minigames.test.ts`** (seeded):
  - CrabRound: the periods 1.2 / 0.95 / 0.75 s; closed exactly in the last 40 %; the lead-in and the beat ignore input; a grab at the open/closed edges; a slip after 4 cycles; hits always in 0–3 under random inputs; the shortest game 3.3 s.
  - TransplantRound: bands at 0.08 and 0.18; no press → "Bỏ sót khóm"; the 0.25 s beat; 5.5 fails and 6 passes, printed "5,5"; the sweep 1.4 s.
- **`farm-gather.test.ts`:**
  - the rules against the fixture, and `critterCap` (none 3, bucket 18, basket 33, both 33);
  - spot readiness on the server clock; `gatherPrompt` for each state and before `0018`, and its precedence: a spot at the daily limit, full and cooling shows the limit, and one full and cooling shows full;
  - `CRAB_FINISH_WAIT_MS` (4 000) > the crab gate, and `TRANSPLANT_WAIT_MS` (9 000) > 8 000.
- **The existing files:**
  - `farm-state`: the new keys, and the defaults without them;
  - `farm-rpc`: the 4 new calls and their answers, and `pick_snails`'s `snails`;
  - `farm-messages`: §11.8 with and without contexts;
  - `farm-catalog`: `critter_kinds`, the container descriptions, the "lớn hơn" rule;
  - `farm-handbook`: the tab, with prices from the config;
  - `farm-actions`: the transplant hint and reasons; the pest-snail hints, with none before `0018`;
  - `farm-messages` also covers the four `pick_snails` toasts: all kept, some kept, none kept, and v15.2's text when the answer has no `snails`;
  - `game-farm-icons`: 6 icons, 16 × 16, complete palettes;
  - the field map tests: §6.
- **Hard-signal pins** (`anticheat-pins.test.tsx`):
  - `crab_finish` sends `round.hits` ∈ 0..3;
  - `crab_start` and `pick_snail_bed` send the interactable's `spot`, and the map has exactly 1–6 and 1–4;
  - `transplant` still sends quality 1.

**SQL smoke `tests/sql/v15-gather-smoke.sql`** (the throwaway PostgreSQL 18 cluster):
- **Run order.** Replay `0004`…`0018`; run the v15, anti-cheat, v15.2, v16 and gather smokes; replay `0018` and re-run the gather smoke. Every run ends with `\i tests/sql/anticheat-guards.sql`.
- **Edits to the earlier smokes.**
  - `v15-smoke.sql`, `anticheat-smoke.sql` and `v15-2-smoke.sql` claim transplants 8 s after `begin_work`, not 2 s.
  - `v15-2-smoke.sql`'s transplant lease case becomes 9 s → `lease ending` and 10 s → allowed.
- **Config:** anon can select `critter_kinds`, and the rows equal §7.1. The fixture's prices and rules hold.
- **Crab starts:** `crab_start` writes the cooldown and the visit; `hole empty` at 19:59, allowed at exactly 20:00; the same hole in a second room is `hole empty` too (R1); `critters full` at 0 free, with no cooldown written.
- **Crab finishes:** hits 3 at 2.9 s → `too fast`, visit kept; at 3 s with `p_u = {0.05, 0.5, 0.95}` → 1 cua gạch and 2 cua đồng at base × M; hits 0 at 0.5 s → consumed, nothing added; a second finish, or another room → `visit not found`; at 121 s → `visit expired`; 1 free place with hits 3 → 1 caught, 2 escaped.
- **Prices:** with the room's index row at M = 2.24, a cua đồng is stored at 26. After the row changes to 5.00, `sell_critters` still pays 26 and writes a `critter_sell` ledger row. `_critter_prices` previews M when the row is from an older period, and writes nothing.
- **Beds:** `p_u = {0.99, 0.1, 0.8, 0.5}` → 3 snails (ốc đồng, ốc bươu vàng, ốc đồng); `bed empty`; `critters full`.
- **Daily limit:** at `gather_count` 199, one more visit works and logs one soft `gather_daily_cap`; the next raises `gather daily limit` with numeric details; with `gather_on` = yesterday it works again.
- **Pest snails:** on a plot with an active snail pest, `pick_snails` by a non-farmer treats it and gives the picker 1–3 ốc bươu vàng; with a full container it still treats, with the escaped count; no visit is counted.
- **Containers:** a bucket → cap 18; a second bucket → `already owned`; a basket → cap 33, then a bucket → `already owned`; quantity 2 → a plain `invalid quantity` with no event row; a `farm_buy` ledger row.
- **The three gates:**
  - transplant (rice and ớt): 7.9 s → `too fast`; 8 s and 120 s → transplanted with `q_transplant` = 1; 121 s → `work expired`. A second `begin_work` 5 s after the first restarts the gate. `lease ending` with 9 s left, allowed with 10 s. A claim after the lease ran out → `not your plot`.
  - a hoa-màu picking: 1.9 s → `too fast`; 2 s → picked; and no upper bound (a picking 10 minutes after its `begin_work` is accepted).
  - `harvest_part`: unchanged from v15.2 (7.9 s → `too fast`, 8 s and 120 s accepted, 121 s → `work expired`).
- **Anti-cheat:** envelopes for `crab_finish` hits 4, −1 and null (`bad_qty`) and for `crab_start` hole 7 and `pick_snail_bed` bed 0 (`bad_spot`), with the state unchanged; the guard loop refuses the 4 new RPCs while locked; a wipe deletes critters and cooldowns, and the snapshot has `critters`; the ledger check accepts all 21 reasons and refuses `'foo'`.

**Components and hooks** (RTL, `afterEach(cleanup)`):
- **CrabGame:** Space, pointer and touch; the typing guard; a pinch; with fake timers a catch calls `crab_finish` no earlier than 4 s and hits 0 at once. "Dừng (Esc)": before the first try ends it sends nothing; after a try it reports the hits so far; during the 4 s wait the finish is still sent. The refusal texts.
- **TransplantGame:** the HarvestGame pattern: the 9 s wait; a failure's "Thử lại" calls `begin_work` again; Esc sends nothing; the §11.8 transplant texts.
- **The panels:** PlotPanel (the game button, the snail hints); FarmShopPanel (the containers, "✓ Đã có", "lớn hơn"); RiceDepotPanel (the price line, selling per kind and all, the toast from `sold`); BagPanel (the section); Handbook (the tab).
- **`useFarmController`:** the gathering prompts; the crab flow with `fa 6` every 2 s; the bed bar cancelled by movement; the transplant round with `fa 1`.

**Integration** (skipped without `SUPABASE_TEST_URL`): anon reads `critter_kinds`. In log mode, `crab_finish` with hits 5 returns an envelope with `strike: 0`.

**Manual pass** (the owner, after the client and `0018`, with two accounts): a round with hands only, then with a bucket and a basket, including a pinch, an Esc and a full container; selling at two different M; a pest-snail pick on the other account's plot; transplanting rice and ớt through the game, with a failed round first; the phone layout of both overlays and the bag.

## 17. Out of scope

- **Later:**
  - a soft counter for crab finishes at the gate (R22);
  - more critters (lươn, ếch, tôm càng), each a config row with its art;
  - traps (lờ, lợp) and nets;
  - HUD tasks for gathering.
- **Not in v15.3:**
  - a season factor or separate market for critters;
  - trading critters between players;
  - cooking, raising crabs, or records and leaderboards for critters;
  - shared or room-scoped holes;
  - any quality or yield effect from the transplant game (D1 is permanent);
  - machine transplanting.
