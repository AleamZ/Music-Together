# Music Together v15.2 — "Nông cụ & hoa màu": farm tools and new crops (Design)

**Date:** 2026-09-25
**Status:** decided.
- The owner said "chạy … làm theo khuyến nghị", so the controller's ★ decisions S1–S15 stand as the owner's. The owner's later harvest change H1–H5 overrides S1, S3, S4 and S6 where they differ. The table shows the result: S3 and S4 are replaced by H1–H4.
- Every other ruling here (R1–R33) is the controller's recommendation, recorded as decided with its reason. The 2026-09-25 review's twelve fixes are folded in.

**Builds on:** `feat/v15-field` with v15.1 (`0013`, including the economy rebalance), `0014_lyrics_lockdown.sql` and the anti-cheat layer (`0015_anticheat.sql`). The stack is unchanged.
**Order:** `0013` → `0014` → `0015` → **`0016_v15_2_crops.sql` (this doc)** → v15.3 `0017_v15_3_gather.sql` → v16.
**Amends:** the v15 spec, the anti-cheat spec and the economy spec. §3 lists the lines.

## 1. Goal

v15.2 deepens the field in two ways.

1. **Farm tools.**
   - **Liềm** (sickle): a one-time purchase at anh Hai's. A rice plot is cut in **6 parts**, and each part is one successful round of the harvest minigame.
   - **Máy gặt** (harvester): rented at chú Tám's co-op. It cuts every remaining part in 30 seconds.
   - **Bình phun** (sprayer): a one-time purchase. One bottle of pesticide loaded into it gives 3 sprays.

   Rice can only be harvested with the sickle or the harvester.
2. **Hoa màu on the same plots** ("luân canh lúa – màu"). At làm đất the farmer chooses a rice paddy or raised beds. Beds grow **khoai lang**, **bắp** or **ớt**.
   - The three crops share one data-driven model, with one config row each.
   - Each has its own method, windows, pests and twist, and its own handbook tab.

The server stays authoritative. Every timer, yield, charge and roll lives in SECURITY DEFINER RPCs that follow the anti-cheat conventions. Clients report nothing that changes a yield. The one thing they report, a harvest round's success, only gates progress, behind an 8 s gate.

## 2. Decisions

### 2.1 Owner and controller

| # | Decision |
|---|---|
| S1 + H5 | **Scope.** v15.2 has two parts: the tools (sickle with the harvest minigame, harvester rental, sprayer) and three crops (khoai lang, bắp, ớt). Crabs, snails, containers, the transplant minigame and the crab minigame move to v15.3 (§3). |
| S2 | **Migration** `0016_v15_2_crops.sql`. It runs after 0013, 0014 and 0015, and it is additive and re-runnable. |
| H1 | **Hand harvest in 6 parts.** It needs a sickle. Each successful HarvestGame round (8 bundles, score ≥ 4 with chuẩn 1 / được 0.5 / lệch 0) cuts one part. A failed round cuts nothing, costs nothing and can be retried at once. The minigame never multiplies the yield (D1 continues). |
| H2 | **Server contract.** `begin_work(plot, 'harvest')`, then `harvest_part(plot, p_success)`. A part is accepted at least 8 s after that `begin_work`. `harvested_parts` counts 0..6. A part pays one sixth of Y(t), the whole plot's yield at the cut, split exactly (R5), so nothing locks the yield. Uncut parts are lost with the crop. Six parts complete the harvest and end a lease. While 0 < parts < 6, the plot shows "Đã gặt n/6 phần" and refuses care actions. |
| H3 | **Harvester.** A 30 s job that cuts every remaining part, with the grain computed at its end. It completes lazily and can finish a partly cut plot. The price is about 3 000 xu. |
| H4 | **No 60-min job.** The "one hand job at a time" rule and the idle animation are gone. The farmer's harvest animation plays during a round, through `fa`. |
| S5 | **Sprayer.** A durable tool at anh Hai's, about 5 000 xu, one per account. "Nạp thuốc" turns 1 bottle into 3 charges of that pesticide, and reloading replaces the contents (the client confirms first). A spray uses a charge when the tank holds the matching pesticide, otherwise a bottle. |
| S6 | **Rice harvest.** Rice is harvested only by sickle (in parts) or by the harvester. Transplanting (rice and ớt) and the quick hoa-màu harvests keep the 3 s action behind the 2 s gate. |
| S7 | **Where hoa màu grows.** On the same plots. Làm đất offers "làm ruộng lúa" (flooded) or "lên luống" (raised beds), and the choice sets the plot's crop kind for that season. |
| S8 | **One model.** A generic, data-driven hoa-màu model in SQL, mirrored in TS and pinned by a shared fixtures JSON. Each crop is a config row. |
| S9 | **Twists and targets.** Profit on a rented, well-cared plot: khoai ≈ 40 000, bắp ≈ 55 000, ớt ≈ 80 000. Seeds cost 600–1 500. The numbers live in config, with the arithmetic per crop (§10). |
| S10 | **Sellers.** anh Hai sells the three seeds, the sickle and the sprayer. Chú Tám rents the harvester. Cô Út buys hoa màu by the kg, with no drying. |
| S11 | **Handbook.** A tab per crop and a "Nông cụ" tab. |
| S12 | **UI.** Reuse the plot panel, the task list, the shop and the depot. Add the làm-đất choice, the harvest progress and countdowns, and the sprayer tank in the bag. |
| S13 | **Art.** New original pixel art: the crop stages, the sickle, the sprayer, and the harvester on its plot. |
| S14 | **Realtime.** Reuse `fa` and `fp`. No new channel. |
| S15 | **Anti-cheat.** Every new RPC is server-authoritative and follows the anti-cheat conventions. |

### 2.2 Rulings made while writing this spec

| # | Ruling | Why |
|---|---|---|
| R1 | The code name for hoa màu is `upland` (`upland_crops`, `lib/game/farm/upland.ts`, `_up_*`). | "Color" reads as a colour in English code. "Upland crop" is the agronomic term for the dry crop in a rice–upland rotation. |
| R2 | Both kinds share the one `crops` row per plot, with a new `kind` column. | The sweep, `_has_crop`, the land checks, abandon and the wipe keep working unchanged. |
| R3 | Prices: sickle 1 500, sprayer 5 000, harvester 500 per remaining part (3 000 a whole plot). Seeds: khoai 800, bắp 1 000, ớt 1 500. | See §10. |
| R4 | The newcomer gift adds a sickle for accounts that claim from `0016` on. | Rice now needs a tool, and a first-season player must not find that out at harvest. Existing players have xu. |
| R5 | Part i (1..6) pays `floor(i·Y/6) − floor((i−1)·Y/6)` kg of wet rice at once, where Y is `_crop_yield(…, t).kg` at that part's cut. The harvester pays each remaining i the same way at its end time. The crop keeps `harvested_parts` and `harvested_kg`. | At a constant Y the six parts sum to exactly Y, so splitting never inflates a harvest. Integer math keeps SQL and TS equal. |
| R6 | A `begin_work` replaces any earlier work record on the plot. `harvest_part(true)` accepts the record only while 8 s ≤ now − `work_started_at` ≤ 120 s: earlier is `too fast`, later is `work expired`. The client waits 9 s from the `begin_work` answer. | An honest round always passes, two tabs can reset the start, and an Esc or a disconnect never leaves a plot stuck. Accepted residual: a script can claim a part every 8 s (§11.5). |
| R7 | A failed round is reported (`p_success = false`) with no gate: it clears `work` and cuts nothing. A null `p_success` counts as false and is not flagged. | This is H1's "costs nothing, retry at once", and it matches `finish_cast`. |
| R8 | While 0 < parts < 6 the plot refuses care actions (`harvesting`). Rounds, the harvester and abandon remain; after an abandon the cut grain stays. | This is H2. Abandon is not care. |
| R9 | The harvester is pro-rated at 500 xu per remaining part. | It keeps the 3 000 headline for a whole plot and is fair for a half-cut plot. |
| R10 | Harvester completion is sweep step J. It runs after the anti-cheat step 0 and before step 1, and computes the grain at `harvester_until`. It pays only if the crop's farmer was still the plot's farmer at the job's start. | It runs before a lease can expire, and it never pays a wiped or reclaimed farmer. |
| R11 | Work must fit in the lease. `begin_work` needs 10 s left for a rice round and 5 s for a transplant or a picking (`lease ending`); a harvester needs 30 s (`lease ends`). | A crop never outlives its lease mid-job. If a lease still runs out mid-round, the sweep takes the crop and the part is refused. |
| R12 | Any number of harvesters may run at once. | A shared machine would add waiting for no gameplay gain. The fee is the sink. |
| R13 | The harvester is rented only in the co-op panel, in a new tab "Máy gặt". The plot panel points there. | S10 places it at chú Tám's. |
| R14 | A round sends `fa 2` at its start and every 2 s while it runs, then `fa 0`. | H4 asks for the existing hint, and an `fa` lasts 2.5 s. |
| R15 | The farmer's client refetches at `harvester_until + 1 s` and sends `fp`. Every client hides an ended job on its own clock. The completion toast uses the change in wet stock. | Completion shows at once without everyone polling. |
| R16 | D1 stays: no quality factor anywhere. `begin_work` keeps its two works. `harvest` means a rice round (sickle) or a hoa-màu picking. `harvest(quality)` now serves hoa màu only; on rice it raises `wrong crop`. | The hard checks `bad_work` and `quality_range` need no widening. |
| R17 | HarvestGame's numbers (§6.2) live in `lib/game/farm/minigames.ts`, a pure seeded state machine, with a thin overlay `HarvestGame.tsx`. | This is the v15 §15.1 design, turned from a quality into a pass/fail gate. |
| R18 | In `buy_farm_item`, a tool with a quantity other than 1 is a plain `invalid quantity`, not `bad_qty`. | Kept plain although no shipped client sends it: the cached v15.1 client reads only its own `shop_items` kinds, so tools never reach it, and the v15.2 shop sends 1. What does reach v15.1 is the three hoa-màu seeds (kind `seed`, no variety): its shop sells them and its plot panel offers to soak them, which is refused as `invalid item`, with no strike and no lasting loss (§4). |
| R19 | `tend_crop`'s act is checked by the existing hard code `bad_work`. | No new code, label or modal text. |
| R20 | Hoa-màu seeds are kind `seed` with a new `shop_items.upland` column. The sickle and the sprayer are a new kind `tool`. | Seeds stack like rice seeds; tools are one-time, like v14 gear. |
| R21 | The tank lives on `farm_profiles` (`tank_item`, `tank_charges`). A check keeps the pair consistent: empty is null and 0, loaded is an item and 1–3. The statement that uses the last charge also clears the item. A charge is used only while the account owns the sprayer, and the wipe empties the tank. | One sprayer per account, no new table, and no half-empty state. |
| R22 | Beds keep rice's water: the same `water_log`, the same 12 h one-level decay, and the same evaluator (`_water_at` / `waterAt`), which every sample and due-time check reads. Only the names differ: Khô / Ẩm / Đẫm / Ngập on beds, Khô / Ẩm / Nông / Sâu on paddies. | One water model, whose history is exact at any time. |
| R23 | Excess N on beds: an N bag (urê, NPK) outside every care region that takes it, or a second N inside one region. The effects are the same as rice: pest chances ×1.5 and −10 %. | One rule for three crops, and the same lesson as rice. |
| R24 | Pickings follow a fixed schedule from the first ripe time. A late picking can be followed at once by the next ripe one, and an unpicked one is lost after its window. | Deterministic, and realistic fruiting. |
| R25 | The twists are data: rot (khoai), and per-slot `dry_mult` / `wet_mult` on pests. | Twists without per-crop code. |
| R26 | Only a harvest ends a lease early: the sixth rice part, or the last picking. A crop lost to time keeps the lease, as fallen rice does. A lease that runs out takes its crop with it, uncut parts and untaken pickings included; the lease sweep runs before any action (steps 1 and 4). | This matches v15 §7.2 and §7.7. |
| R27 | New `fa` codes: 9 dig and 10 pick. The rest reuse existing codes (§12). | Two small drawings. Old clients drop codes above 8. |
| R28 | `0016` goes live before the v15.2 client, as close together as possible. The v15.2 client tolerates a database without `0016`. | The server goes first (anti-cheat §4). Under `0016` an old client cannot harvest rice. |
| R29 | The bag (🎒 Giỏ đồ) shows a "Nông cụ" section once the field state has loaded this session. "Nạp thuốc" lives there. | S12 puts the tank in the bag, and the field state carries it. |
| R30 | An ớt nursery never rots. Old seedlings cost 3 %/h, capped at 30 %. | Leases end anyway, and this saves a sweep rule. |
| R31 | `pct` is an integer percentage everywhere (40, 35, 25). A picking's floor is `ceil(base_kg · pct / 1000)`, which is 10 % of its share: `(base_kg * pct + 999) / 1000` in SQL and `Math.ceil(base_kg * pct / 1000)` in TS. | Integer arithmetic, so SQL and TS agree exactly. |
| R32 | Every path that pays parts or removes a partly cut crop locks the crop row and re-checks `harvester_until` and `harvested_parts` under the lock: `harvest_part`, the harvester's completion and the lease sweep. Payout, crop deletion and lease end are one transition (§6.5). A hand part during a harvester job is refused (`harvester busy`). | No double payout and no lost part, even if the room-wide plot locks of `_field_open` are relaxed later (anti-cheat R36). |
| R33 | The hoa-màu model follows the rice model's parity conventions (§8.7): epoch-ms times, 15-min samples while t < end, left-to-right products with explicit SQL parentheses, and `floor(x + 0.5)`. | Equal results on both sides, pinned by boundary fixtures (§16). |

## 3. What moved, and the lines other specs change

**Moved to v15.3 "Đồng vui"** (`0017_v15_3_gather.sql`):
- crab holes and snail beds;
- the critter containers (`box_bucket`, `box_basket`) and selling crabs and snails;
- pest snails going into the container;
- the **transplant minigame** (transplanting stays behind the 2 s gate) and the **crab minigame**;
- the question of how a transplant quality returns (D1), with its soft signal.

The **harvest minigame stays in v15.2**, but it gates progress (6 parts) and never sets a quality.

**v15 spec** (`2026-09-25-music-together-v15-field-design.md`):

| § | Change |
|---|---|
| Header, Roadmap | v15 = rice and land (15.1), tools and hoa màu (15.2), crabs and snails (15.3). |
| §1 | Goal 3 (crabs, snails) → v15.3. "Three minigames … (second phase)" → the harvest minigame gates rice parts (v15.2); transplanting and crab-grabbing come in v15.3. |
| §2 | Row 7 → "plus the harvest minigame (v15.2) and two more (v15.3)". Clarification f → the transplant quality is v15.3's question. |
| §3 | "v15.2 is `0016_v15_gather.sql`" → v15.2 is `0016_v15_2_crops.sql` and v15.3 is `0017_v15_3_gather.sql`. |
| §4 | Replace the v15.2 block with a pointer to this spec, and add a v15.3 block with the moved list above. |
| §5 | "v15.2: TransplantGame, HarvestGame, CrabGame" → v15.2: HarvestGame; v15.3: TransplantGame, CrabGame. Migrations: `0016_v15_2_crops.sql`, `0017_v15_3_gather.sql`. |
| §6.2 | "v15.2 gathering spots" → v15.3. |
| §8.2 | Row `ripe`: "harvest" → harvest by sickle in 6 parts or by harvester (v15.2 §6). |
| §8.6 | `qT, qH` → qT is 1.0 until v15.3 (D1); qH is removed, since the harvest minigame gates parts and multiplies nothing. |
| §8.7 | Harvest → the 6 parts and the harvester (v15.2 §6). Grain still goes to wet rice, and a lease still ends. |
| §9 | `box_bucket`, `box_basket` → v15.3. Add a pointer to v15.2 §9 (tools, hoa-màu seeds, kind `tool`). |
| §10 | "Crabs and snails (v15.2)" → v15.3. |
| §11.1 | "(v15.2 adds critter_sell)" → v15.2 adds `harvester` and `produce_sell`; v15.3 adds `critter_sell`. |
| §11.4 | Work gate → 2 s for transplanting and hoa-màu pickings; rice parts use `harvest_part` behind 8 s. |
| §11.8 | Clients also report a harvest round's success (8 s gate, no yield effect). "(v15.2) crab hits" → v15.3. |
| §12 | `fa` codes: add 9 dig and 10 pick. |
| §13.3 | Shop: tools and hoa-màu seeds (v15.2), containers (v15.3). Depot: hoa màu (v15.2), crabs and snails (v15.3). Co-op: the "Máy gặt" tab. |
| §15 | Retitle to "v15.3 — gathering and minigames (`0017_v15_3_gather.sql`)". HarvestGame moves to v15.2 §6.2. "All three are pure state machines" → both. |
| §17 | Minigame tests: HarvestGame is v15.2, the others v15.3. "v15.2 adds v15-gather-smoke.sql" → v15.2 adds `v15-2-smoke.sql`, v15.3 adds `v15-gather-smoke.sql`. |

**Anti-cheat spec:**
- **Migration names.** The header order, D7 and §11.5 name `0016_v15_2_crops.sql`, then `0017_v15_3_gather.sql`.
- **Moved to v15.3.** In §6.4 and the §7.2 `quality_range` row, "v15.2 brings a real quality back" becomes v15.3. The "quality always 1.1" soft signal in §7.4 and §16 moves to `0017`.
- **§7.2 and §7.3.** `bad_plot` covers 24 plot RPCs, `bad_work` also covers `tend_crop`, and `bad_qty` also covers `sell_produce`. §7.3 gains the new honest refusals (§11.5).
- **§9.3 and §11.3.** Add the 7 v15.2 RPCs (42 in all); the gather RPCs belong to `0017`. Rule 4 adds `harvester` and `produce_sell` (v15.2), then `critter_sell` (v15.3).
- **§9.6, §12.5 and §1.5.** The wipe clears `produce_stock` and the tank, the holdings line gains `· {kg} kg hoa màu`, and §1.5 gains the harvest-part residual (§11.5).

**Economy spec §4:** add a pointer to v15.2 §10, which restates the rice table (a hand harvest adds no per-season cost; the harvester adds 3 000) and adds the hoa-màu seasons.

## 4. Constraints

- **Earlier constraints still hold:** everything in the v13–v15 and anti-cheat constraints. That includes RPC-only writes, the Vietnamese UI with `vi-VN` numbers, original art drawn in code, time rules in private functions that take `p_now`, and no cron.
- **Migration `0016`.** It is additive and re-runnable (`if not exists`, `create or replace`, `drop constraint if exists` + `add`, seeds with `on conflict do update`), and the owner runs it in the Supabase SQL editor. It requires `0013` and `0015`, because it re-creates guarded RPCs and anti-cheat helpers and keeps their parts (anti-cheat §11.3). It does not depend on `0014`.
- **Deploy order (R28).** `0016` goes live first and the v15.2 client right after, ideally at a quiet hour.
  - Under `0016`, a cached v15.1 client cannot harvest rice: it has no sickle round, and `harvest` on rice answers `wrong crop`.
  - It never sees the tools: it reads only its own `shop_items` kinds. It does see the three hoa-màu seeds (kind `seed`, no variety): its shop sells them and its plot panel offers to soak them, which `soak_seed` refuses as `invalid item`. That is no strike and no lasting loss: the seeds keep for the v15.2 client.
  - A v15.2 client against a database without `0016` treats a missing `upland_crops` (PGRST205/42P01) as an empty catalog, and shows its new RPCs' PGRST202 as `NOT_OPEN_152` (§13.6). With no tools in its catalog it cannot cut rice either: "Gặt bằng liềm" is disabled with `NOT_OPEN_152`.
- **Tests and shipping.** The plan's first task records the test baseline. One plan; the owner ships after it and does the manual pass. The README gains a v15.2 section: what's new, the deploy order and the trust-model line.

## 5. Architecture

```
supabase/migrations/0016_v15_2_crops.sql  A config+catalog · B tables · C model · D field · E actions+RPCs · F anti-cheat touch points
lib/game/farm/upland.ts         NEW  pure: the hoa-màu interpreter (mirror of 0016 §C)
lib/game/farm/minigames.ts      NEW  pure: the HarvestGame round (seeded)
lib/game/farm/crop.ts                partKg(i, y)
lib/game/farm/catalog.ts             UplandCrop parse, kind "tool", HARVESTER_PART_PRICE…, describeFarmItem
lib/game/farm/state.ts               kind/upland/plantAt/picking/parts/harvester, logs, produce, tank
lib/game/farm/actions.ts             plot actions + due tasks for beds, parts, tools
lib/game/farm/land.ts                harvesterRefusal
lib/game/farm/rpc.ts                 5 new room actions, loadSprayer, sellProduce, harvest answers
lib/game/farm/messages.ts, handbook.ts   texts; 4 new handbook tabs
lib/game/art/crops.ts, farm-icons.ts, farm-anim.ts   beds and crop stages, cut strips, the harvester; 8 icons; dig/pick
lib/game/net/protocol.ts             FarmAnim 0–10
lib/game/engine.ts                   the harvester sprite and the plot label countdown
hooks/useField.ts, hooks/useFarmController.ts   new calls; rounds; job-end refetch; harvest toasts
components/game/farm/*               PlotPanel, CoopPanel (Máy gặt), FarmShopPanel, RiceDepotPanel, FarmTasks, Handbook,
                                     FarmOverlays, HarvestGame (NEW)
components/game/fishing/BagPanel.tsx, components/game/GameShell.tsx   the Nông cụ section; the HUD produce line
tests/fixtures/upland-cases.json (NEW), tests/fixtures/crop-cases.json (+parts), tests/sql/v15-2-smoke.sql (NEW)
```

## 6. Rice harvest: sickle and harvester

### 6.1 Parts

A ripe rice plot is harvested in **6 parts**. The crop row gains `harvested_parts` (0–6), `harvested_kg` (the running total), and `harvester_at` / `harvester_until` (the harvester job, null when none).

**Grain per part** (H2, R5). Part i (1..6), cut at time t:

```
Y(t)      = _crop_yield(c, v, land, 1.0, t).kg          -- the whole plot's yield now: overripe penalty at t, no quality
part_kg_i = (i * Y(t)) / 6 - ((i - 1) * Y(t)) / 6       -- SQL integer division; TS Math.floor(i*Y/6) - Math.floor((i-1)*Y/6)
```

- Each accepted part adds `part_kg_i` to the farmer's **wet** rice at once, sets `harvested_parts = i` and adds the kg to `harvested_kg`.
- At a constant Y the six parts sum to exactly Y. Nếp at full care, Y = 75, pays 12, 13, 12, 13, 12, 13 = 75 kg.
- Nothing locks the yield. Parts cut later in the overripe window give less, and each part is within 1 kg of Y(t)/6. Uncut parts are lost when the crop falls (48 h after the ripe window, sweep step 6) or when its lease runs out (R26).
- **The sixth part completes the harvest.** The crop is deleted, a lease ends, and the plot is bare.
- **While 0 < parts < 6,** fertilizing, watering, spraying and picking snails raise `harvesting`. A round, the harvester and `abandon_crop` still work; after an abandon the grain already cut stays.

### 6.2 Hand harvest: the sickle and HarvestGame

**The flow:**
1. **"Gặt bằng liềm"** calls `begin_work(plot, 'harvest')` on a rice crop. It needs the plot's farmer and no harvester job (`harvester busy`), phase `ripe` or `overripe` (`wrong phase`), water ≤ 1 (`need water`), `tool_sickle` in the inventory (`no sickle`), and at least 10 s left on the lease (`lease ending`). It writes `work = 'harvest'` and `work_started_at = p_now`, replacing any earlier record (R6).
2. The client plants the avatar at the plot's use spot, facing the plot, and opens the round overlay.
3. **The round** (`lib/game/farm/minigames.ts`, R17). It starts when the `begin_work` answer arrives, and has 8 bundles.
   - **Hold** (Space, the mouse button or a finger) raises the sickle's power bar from 0 to 1 in **1.2 s**. The bar auto-releases at 1.
   - **Each bundle's sweet band** is 0.14 wide, centred at c ∈ [0.62, 0.78] (seeded per bundle).
   - **Scoring the release** at level L:

     | Release | Score |
     |---|---|
     | \|L − c\| ≤ 0.07 | **chuẩn** 1 |
     | \|L − c\| ≤ 0.17 | **được** 0.5 |
     | otherwise, L < c | **lệch** 0, "sót hạt" |
     | otherwise, L > c or auto-released | **lệch** 0, "rụng hạt" |
   - After each release, a 0.35 s cut beat ignores input.
   - **Success** is a score ≥ 4 of 8. A typical round takes 10–14 s.
4. **Success.** The client waits until **9 s** after the `begin_work` answer (it shows "Đang bó lúa…"), then calls `harvest_part(plot, true)`. The server accepts the part only if `work = 'harvest'` and 8 s ≤ `p_now − work_started_at` ≤ 120 s. Otherwise it raises `too fast` (no record, or too early) or `work expired` (R6). An accepted part clears `work`, so every part needs its own `begin_work`.
5. **Failure.** The client calls `harvest_part(plot, false)` at once, with no gate. The server clears `work` and cuts nothing. "Thử lại" starts a new round with a new `begin_work`.

**Input and leaving.** The v14 input rules apply (the typing guard, pointer, touch, Space). Movement is locked while the overlay is open. Under reduced motion the bar still moves, without shake effects.
- **Esc, "Huỷ" or a disconnect** sends nothing. The leftover record expires after 120 s, and the next `begin_work` replaces it anyway, so a plot is never stuck.
- **A lease that runs out mid-round.** The sweep of the `harvest_part` call ends the lease and deletes the crop first (R26), so the part is refused (`not your plot`), as any rice action after expiry is. The overlay then shows "Hết hạn thuê — phần lúa chưa gặt đã mất."

**Animation (R14).** The client sends `fa 2` when the round starts and every 2 s while it runs, and `fa 0` when it ends. Its own character plays the same animation.

### 6.3 Harvester

`rent_harvester(plot)` at chú Tám's (R13).
- **It checks, in order,** on the locked crop row (§6.5): the plot's farmer, no running harvester (`harvester busy`), a rice crop (`wrong crop`); phase `ripe` or `overripe` (`wrong phase`) and water ≤ 1 (`need water`); at least 30 s left on the lease (`lease ends`, R11); and `500 × (6 − harvested_parts)` xu (`not enough coins`).
- **It then** pays with ledger reason `harvester` (ref `plot N`), sets `harvester_at = p_now` and `harvester_until = p_now + 30 s`, and clears `work`.
- It works on a partly cut plot (H3) and needs no sickle. There is no cancel and no refund, and any number may run at once (R12).
- While it runs, every action on the plot raises `harvester busy`: rounds, a hand part, care and abandon.

### 6.4 Completion (sweep step J)

`_field_sweep` gains step J, after the anti-cheat step 0 and before step 1:

```sql
-- J. finished harvester jobs: lock the crop row, re-check it, pay the parts still uncut at the job's end, end the lease
for c in select * from public.crops cr
          where cr.room_id = p_room and cr.harvester_until is not null and cr.harvester_until <= p_now
          order by cr.plot_no for update loop                -- locked; the where is re-checked on the locked row
  if c.farmer_id = public._farmer(p_room, c.plot_no, c.harvester_at) then
    v_y := (public._crop_yield(c, public._variety(c.variety), <1.1 private | 1.0 village>, 1.0, c.harvester_until)->>'kg')::int;
    perform public._rice_add(c.farmer_id, c.variety, v_y - (c.harvested_parts * v_y) / 6, 0);  -- = the sum of parts harvested_parts+1..6
    delete from public.plot_leases where room_id = p_room and plot_no = c.plot_no;
  end if;
  delete from public.crops where room_id = p_room and plot_no = c.plot_no;
end loop;
```

- **An unpaid job.** If the farmer no longer farms the plot (a wipe released the lease or the plot), the job is not paid and the crop row goes.
- **Step 6** (fallen rice) skips crops with a harvester job.
- **When the rice arrives.** It lands when anyone next opens that room's field, which is normally the farmer (R15). A farmer elsewhere sees it on their next visit.

### 6.5 Locks and races (R32)

- **The sweep comes first.** Every field call runs `_field_open` first. It locks the room's plot rows and runs the sweep (step 0, J, then 1–7), so the lease sweep and the harvester's completion happen before any action on a plot.
- **Each paying path also locks its crop row** and re-checks it under the lock:
  - `harvest_part`: `_farm_crop` selects the row `for update` (it becomes `volatile`), refuses `harvester busy` while `harvester_until` is set, and takes i = `harvested_parts + 1` from the locked row. The payout, the new count and, on the sixth part, the crop and lease deletion are one transition.
  - the harvester's completion: step J above;
  - the lease sweep: steps 1 and 4 run after J, and R11 keeps `harvester_until` at or before the lease end, so a finished job is paid before its lease is checked. Step 4's `delete` locks each row it removes, and a part claimed after it finds no crop (`not your plot`);
  - `rent_harvester`: it re-checks `harvester_until is null` and `harvested_parts < 6` before charging.
- **The result.** A hand part never lands during a harvester job, the harvester cuts only the parts left when it completes, and no part is paid twice. The row locks keep this true even if the room-wide plot locks are relaxed later (anti-cheat R36).

## 7. Sprayer (`tool_sprayer`)

- **Buying.** It is bought once at anh Hai's for 5 000 xu. One per account (`already owned`).
- **The tank.** `farm_profiles.tank_item` holds a pesticide id or null, and `tank_charges` holds 0–3. A check (§11.2, R21) allows only an empty tank (null, 0) or a loaded one (an item, 1–3).
- **`load_sprayer(token, item)`.** The item must be a pesticide (`invalid item`) and the account must own the sprayer (`no sprayer`). One bottle leaves the bag (`no item`), and the tank becomes `item` with 3 charges. Any charges left over are discarded; the client confirms before this (§13.5).
- **`spray(plot, item)`**, through a re-created `_farm_do_spray`:
  - It uses one charge when the account owns the sprayer and `tank_item = item` with at least 1 charge. One statement both uses the charge and clears the item at the last one: `set tank_charges = tank_charges − 1, tank_item = case when tank_charges = 1 then null else tank_item end`.
  - Otherwise it uses a bottle from the bag, as today (`no item`).
  - The spray log and the pest models are unchanged. The tank holds one pesticide, so a different pest still needs its bottle.

## 8. Hoa màu

### 8.1 Rotation

- **The choice.** A bare plot offers `prepare_plot` "Làm ruộng lúa" (today's flow, flooded, water 3) or `prepare_beds` "Lên luống" (a crop row with `kind = 'upland'`, `prepared_at = p_now` and water 1, Ẩm). Both withdraw the owner's listing and sublease price.
- **How long it holds.** The kind lasts until the crop row goes (harvest, abandon or loss), and the next season chooses again. The rice path "ngâm giống before làm đất" stays and makes a rice row.
- **Wrong-kind actions.** `soak_seed` and `sow_seed` on beds, `harvest` / `harvest_part` / `rent_harvester` on the wrong kind, and bed actions on a paddy all raise `wrong crop`.

### 8.2 The config row (`upland_crops`)

One row per crop, publicly readable like `rice_varieties`. Hours count from **P** = `plant_at`: planting for khoai and bắp, transplanting for ớt.

| Column | Meaning |
|---|---|
| `id`, `name`, `sort_order` | `khoai` Khoai lang, `bap` Bắp, `ot` Ớt |
| `method` | `cutting` (trồng dây), `direct` (gieo thẳng) or `nursery` (ươm, then trồng cây con) |
| `plant_label`, `transplant_label`, `harvest_label`, `harvest_anim` | button words; `harvest_anim` is `dig` or `pick` |
| `base_kg`, `price_per_kg` | a season's kg at full care; cô Út's price per kg |
| `nursery_ready_h`, `nursery_old_h` | nursery only, in hours from sowing: transplant allowed from; seedlings old after |
| `stages` | `[{id, name, until_h, water: [levels]}]` in order; the last `until_h` is **ripe_h** |
| `ripe_water` | the levels accepted from ripe_h on |
| `ripe_window_h`, `over_rate`, `lost_after_h` | each picking's penalty-free window; the loss per hour after it (cap 0.6); a picking is lost this long after its window |
| `pickings`, `pick_gap_h` | the percent per picking, e.g. `[40, 35, 25]`; the hours between pickings |
| `rot_from_h`, `rot_rate`, `rot_cap` | rot while water ≥ 2 from `rot_from_h` (null means no rot) |
| `cares` | `[{id, kind, name, items, half_items, from_h, to_h, half_from_h, half_to_h, pen_half, pen_missing}]`, `kind` = `fert` or `act` |
| `pests` | `[{slot, kind, name, from_h, to_h, chance, dry_mult, wet_mult, remedy}]` |

**Seed checks** (the smoke asserts each one): stage `until_h` values strictly increase; no stage id is `prepared`, `nursery`, `waiting`, `ripe`, `overripe` or `done`; the pickings sum to 100; a fert care's on-time window lies inside its half region, and fert half regions do not overlap; an act care's half region starts at its `to_h`; act care ids are within {`lat_day`, `vun_goc`} (R19).

### 8.3 Phases (hours)

**Notation:** `T = hrs(P, t)`. Picking k is ready at `R_k = P + ripe_h + pick_gap_h·(k − 1)`, overripe from `O_k = R_k + ripe_window_h`, and lost at `L_k = O_k + lost_after_h`. Every `P + h` is computed with `_plus_h` (whole seconds).

| Phase | When | The farmer can |
|---|---|---|
| `prepared` | beds made, nothing planted | base-fertilize, water, plant (the bed must be Ẩm) |
| `nursery` (ớt) | sow ≤ t < P | base-fertilize, water; transplant from sow + `nursery_ready_h` (Ẩm) |
| stage `id` | 0 ≤ T < ripe_h, the first stage with T < `until_h` | water, fertilize, tend, spray |
| `waiting` | between pickings, while t < R_k | the same |
| `ripe` | R_k ≤ t < O_k | pick (water ≤ 1), no penalty |
| `overripe` | O_k ≤ t < L_k | pick at −`over_rate` per hour, cap 60 % |

- **The next picking** k is the lowest in 1..n that is not yet picked and has t < L_k. When none is left, the crop is finished.
- **A picking** is the 3 s `harvest` work. Earlier unpicked pickings are lost.
- **After the last picking** the crop is deleted and a lease ends.
- **When every remaining picking is lost** (t ≥ L_n), sweep step 6 deletes the crop, and the lease stays (R26).
- **When the lease runs out,** the crop is lost with every picking not yet taken, as rice is. The lease sweep (steps 1 and 4) runs in `_field_open`, before any action on the plot. `begin_work` for a picking or a transplant needs at least 5 s left on the lease (`lease ending`); a 3 s action that still loses the race is refused (`not your plot`).

### 8.4 Water and rot

- **One water model (R22).** Beds use rice's representation and evaluator unchanged:
  - the history is `crops.water_log`, entries `{t, l}` meaning "level l set at t", appended by `prepare_beds` (level 1) and by every `water` action (the current level ± 1, clamped to 0–3);
  - the evaluator is `_water_at(log, t)` in SQL and `waterAt(log, t)` in TS. It takes the last entry at or before t (the later one when two share a t), subtracts one level per full 12 h since, and never goes below 0;
  - every off-target sample, rot sample, pest due-time check and action check calls that evaluator at its own time. Nothing reads a cached current level.

  Khô, Ẩm, Đẫm and Ngập name the same levels 0–3 on beds. `water(+1)` is "Tưới" and `water(−1)` is "Tháo".
- **Accepted levels at t:** {1} in the nursery, the stage's `water` in a stage, `ripe_water` from ripe_h on, and anything before planting.
- **Off-target hours.** 15-min samples run from the first planting action (`coalesce(sow_at, plant_at)`) until t; each wrong sample adds 0.25 h. `Mwater = 1 − min(0.2, 0.01 · off-target hours)`.
- **Rot** (khoai). 15-min samples run from `P + rot_from_h` until t; each sample with level ≥ 2 adds 0.25 rot hours. `Mrot = 1 − min(rot_cap, rot_rate · rot hours)`. Such a sample is also off-target.

### 8.5 Care

- **Base fertilizers.** Manure and phosphate before P, −5 % each if missing, as for rice. After P they are wasted.
- **Care rows,** in config order, scored from the fert log (fert) or the work log (act):
  - **on time** (score 0): an `items` bag (fert) or the act, at T ∈ [`from_h`, `to_h`];
  - **half** (`pen_half`): an `items` or `half_items` bag (fert), or the act, at T ∈ [`half_from_h`, `half_to_h`);
  - **otherwise** `pen_missing`.

  Only the best entry counts.
- **Excess N** (R23). Walk the fert log after P, in time order. It is excess when an N bag (urê, NPK) lands at a T where no fert care has T ∈ [`half_from_h`, `half_to_h`) with that bag in its `items ∪ half_items`. A second N inside one care's half region is excess too. The effects: pest chances due after it are ×1.5, and −10 %.
- `Mcare = 1 − (manure 0.05 + phosphate 0.05 + the care scores summed in config order + excess 0.10)`.

### 8.6 Pests

- **Rolls.** At the first planting action the server stores one hidden roll per slot, `[{slot, u_time, u_hit}]`. The rolls never leave the server, and only fired hits show.
- **Due time.** A slot is due at `P + from_h + u_time · (to_h − from_h)`. It is evaluated only once P exists and `p_now` ≥ due.
- **Chance at the due time.** Start with `chance`, then, in this order, ×1.5 with excess N by due, × `dry_mult` if `_water_at(log, due)` = 0, and × `wet_mult` if it is ≥ 2; cap at 0.9. The slot hits if `u_hit < chance`.
- **Treatment.** The first spray of its `remedy` at or after due treats it.
- **Damage.** 1.5 % per active hour, capped at 30 % per pest. `Mpest` is the product over pests, in slot order.

### 8.7 Yield per picking

```
Mplant = 1 − min(0.3, 0.03 · max(0, hrs(sow_at, P) − nursery_old_h))       (nursery; otherwise 1)
Mlate  = 1 − min(0.6, over_rate · max(0, hrs(O_k, t)))
x      = ((((((((base_kg · land) · Mcare) · Mplant) · Mwater) · Mrot) · Mpest) · Mlate) · pct_k) / 100
kg_k   = max(ceil(base_kg · pct_k / 1000), floor(x + 0.5))
```

- **Terms.** `land` is 1.10 on a private plot and 1.00 on a village plot. Every factor is evaluated at the picking time t.
- **`pct_k`** is the picking's integer percentage (40, 35, 25; 100 for one picking). The floor `ceil(base_kg · pct_k / 1000)` is 10 % of that picking's share. SQL computes it as `(base_kg * pct_k + 999) / 1000` (integer division), TS as `Math.ceil(base_kg * pct_k / 1000)` (R31). ớt picking 1: `ceil(60 · 40 / 1000)` = 3 kg.
- **Parity conventions** (R33). These are the rice model's (0013 §D, `crop.ts`), named here so both sides stay bit-equal:
  1. **Times.** TS holds epoch milliseconds as doubles; SQL holds timestamptz. Hours are `(b − a) / 3 600 000` in TS and `extract(epoch from (b − a))::double precision / 3600` (`_hrs`) in SQL. Offsets go through `plusH` / `_plus_h`, which cut to whole seconds. Every fixture time is a whole second, so both sides divide the same integers and get the same double.
  2. **Samples.** They run from the start, while t < end, in steps of 900 000 ms (SQL: `generate_series(start, end − interval '1 microsecond', interval '15 minutes')`). Each reads `_water_at` / `waterAt`.
  3. **Products.** They run left to right in the order written above; SQL writes the parentheses out. Literals and config numbers become doubles on both sides (`::double precision` casts; `JSON.parse`).
  4. **Results.** A yield is `floor(x + 0.5)`. Integer steps (floors, rice parts) use integer division in SQL and `Math.floor` / `Math.ceil` of exact integer quotients in TS.
- **Two implementations of one formula.** SQL `_up_yield(c, u, land, k, p_now)` pays the picking. TS `uplandYield(…)` gives the plot panel's estimate ("ước tính"), which is hopeful like rice's: care windows still open count as on time, and future pickings have Mlate 1. `tests/fixtures/upland-cases.json` pins both.

### 8.8 The three crops

| | khoai `khoai` | bắp `bap` | ớt `ot` |
|---|---|---|---|
| Name | Khoai lang | Bắp | Ớt |
| method · labels · anim | cutting · "Trồng dây khoai" · — · "Đào khoai" · dig | direct · "Gieo hạt bắp" · — · "Bẻ bắp" · pick | nursery · "Ươm hạt ớt" · "Trồng cây ớt con" · "Hái ớt" · pick |
| nursery ready / old | — | — | 10 h / 18 h from sowing |
| base_kg · price | 200 kg · 265 xu | 150 kg · 460 xu | 60 kg · 1 590 xu |
| ripe_h · window · over · lost | 48 · 12 h · 2 %/h · 48 h | 60 · 12 h · 2 %/h · 48 h | 46 · 8 h · 3 %/h · 24 h |
| pickings · gap | [100] | [100] | [40, 35, 25] · 12 h |
| rot | from 22 h · 3 %/h · cap 50 % | — | — |
| ripe_water | {0, 1} | {0, 1} | {0, 1} |

**Stages** (`until_h` · accepted water):

| khoai | bắp | ớt |
|---|---|---|
| `root` Bén rễ 6 · {1} | `sprout` Nảy mầm 6 · {1} | `root` Bén rễ 8 · {1} |
| `vine` Bò dây 22 · {0, 1} | `leaf` Ra lá 24 · {1, 2} | `grow` Phát triển thân lá 22 · {1, 2} |
| `tuber` Tượng củ 36 · {0, 1} | `knee` Xoáy nõn 40 · {1, 2} | `flower` Ra hoa 34 · {1, 2} |
| `bulk` Củ lớn 48 · {0, 1} | `tassel` Trổ cờ, phun râu 50 · {1, 2} | `fruit` Đậu trái 46 · {1, 2} |
| | `fill` Chắc hạt 60 · {0, 1} | |

**Cares** (hours after P):

| Crop | Care | Kind: items (half items) | On time | Half region | Half / missing |
|---|---|---|---|---|---|
| khoai | `td` Bón thúc nuôi củ | fert: kali, NPK (urê) | 16–26 | 6–36 | 0.10 / 0.20 |
| khoai | `lat_day` Lật dây | act | 24–32 | 32–40 | 0.05 / 0.10 |
| bắp | `td1` Bón thúc lần 1 (3–5 lá) | fert: urê, NPK (kali) | 8–16 | 6–24 | 0.10 / 0.20 |
| bắp | `vun_goc` Vun gốc | act | 16–28 | 28–40 | 0.05 / 0.10 |
| bắp | `td2` Bón thúc lần 2 (trổ cờ) | fert: NPK, kali (urê) | 38–46 | 30–50 | 0.10 / 0.20 |
| ớt | `td1` Bón thúc bén rễ | fert: urê, NPK (kali) | 4–12 | 0–20 | 0.08 / 0.15 |
| ớt | `td2` Bón thúc ra hoa | fert: NPK, kali (urê) | 22–30 | 20–40 | 0.08 / 0.15 |
| ớt | `td3` Bón nuôi trái | fert: NPK, kali (urê) | 46–56 | 40–64 | 0.08 / 0.15 |

**Pests:**

| Crop | Slot | Kind (name) | Window | Chance | Multiplier | Remedy |
|---|---|---|---|---|---|---|
| khoai | 1 | `weevil` Sùng khoai | 24–40 | 0.40 | dry ×2 | spray_insect |
| bắp | 1, 2 | `armyworm` Sâu keo mùa thu | 8–24; 26–44 | 0.35 each | — | spray_insect |
| ớt | 1 | `thrips` Bọ trĩ | 6–24 | 0.40 | dry ×1.5 | spray_insect |
| ớt | 2 | `anthracnose` Thán thư | 40–64 | 0.40 | wet ×2 | spray_fungus |

**The khoai row's JSON columns**, the shape every row follows:

```json
{ "stages": [{"id": "root", "name": "Bén rễ", "until_h": 6, "water": [1]}, {"id": "vine", "name": "Bò dây", "until_h": 22, "water": [0, 1]},
             {"id": "tuber", "name": "Tượng củ", "until_h": 36, "water": [0, 1]}, {"id": "bulk", "name": "Củ lớn", "until_h": 48, "water": [0, 1]}],
  "cares": [{"id": "td", "kind": "fert", "name": "Bón thúc nuôi củ", "items": ["fert_potash", "fert_npk"], "half_items": ["fert_urea"],
             "from_h": 16, "to_h": 26, "half_from_h": 6, "half_to_h": 36, "pen_half": 0.10, "pen_missing": 0.20},
            {"id": "lat_day", "kind": "act", "name": "Lật dây", "items": [], "half_items": [],
             "from_h": 24, "to_h": 32, "half_from_h": 32, "half_to_h": 40, "pen_half": 0.05, "pen_missing": 0.10}],
  "pests": [{"slot": 1, "kind": "weevil", "name": "Sùng khoai", "from_h": 24, "to_h": 40, "chance": 0.40, "dry_mult": 2, "wet_mult": 1,
             "remedy": "spray_insect"}] }
```

**The twists:**
- **khoai:** never let the bed reach Đẫm after 22 h (rot), but keep it Ẩm around 24–40 h, because weevils love dry soil. Lift the vines once.
- **bắp:** no nursery. Two top-dresses around vun gốc. It wants Ẩm–Đẫm until grain fill, and armyworms come in two waves.
- **ớt:** a nursery and a transplant, three top-dresses, three pickings 12 h apart, thrips then anthracnose. Drain before each picking.

**Season lengths** from lên luống, with prompt actions: khoai ≈ 48 h, bắp ≈ 60 h, ớt ≈ 10 + 46 + 24 = 80 h to the third picking. All fit the 96 h lease.

### 8.9 Actions

| Action | RPC | Rules |
|---|---|---|
| Lên luống | `prepare_beds` | A bare plot; water 1. |
| Trồng / gieo / ươm | `plant_crop(item)` | Beds with nothing planted; the bed must be Ẩm. Uses one bag of a seed with `upland` set. Sets `upland` and P (cutting, direct) or `sow_at` (nursery), and rolls the pests. |
| Trồng cây con (ớt) | `begin_work('transplant')` + `transplant` | The nursery is ≥ `nursery_ready_h` old, the bed is Ẩm, and at least 5 s are left on the lease (`lease ending`). Sets P. The 2 s gate; quality ignored (D1). |
| Lật dây, vun gốc | `tend_crop(act)` | After P. The act must be one of this crop's `act` cares (`wrong crop`). Recorded in `work_log` whenever it is done; the panel warns outside the windows. |
| Tưới/tháo, bón, xịt | `water`, `apply_fertilizer`, `spray` | Unchanged RPCs. The panel's advice follows §8.5. |
| Đào / bẻ / hái | `begin_work('harvest')` + `harvest` | The next picking is ready (R_k ≤ t < L_k), water ≤ 1, and at least 5 s are left on the lease (`lease ending`). The kg go to `produce_stock`, and `harvests` gains `{t, k, kg}`. The last picking deletes the crop and ends a lease. |
| Bỏ vụ | `abandon_crop` | As today. |

## 9. Items

| id | kind | Name | Price | Notes |
|---|---|---|---|---|
| `seed_khoai` | seed | Dây khoai giống | 800 | `upland = 'khoai'`, sort 40 |
| `seed_bap` | seed | Hạt bắp giống | 1 000 | `upland = 'bap'`, sort 50 |
| `seed_ot` | seed | Hạt ớt giống | 1 500 | `upland = 'ot'`, sort 60 |
| `tool_sickle` | tool | Liềm | 1 500 | one-time, sort 10 |
| `tool_sprayer` | tool | Bình phun | 5 000 | one-time, sort 20 |

- **Buying.** Seeds stack to 99. A tool is bought once, with qty 1: a second one raises `already owned`, and a quantity other than 1 raises `invalid quantity` (R18). `buy_farm_item` sells `seed`, `fertilizer`, `pesticide` and `tool`; `critter_box` waits for v15.3.
- **The harvester** is not an item. It costs `HARVESTER_PART_PRICE = 500` xu per remaining part, a constant like the rent.
- **The gift** (R4). `claim_farm_gift` also gives `tool_sickle` on a first claim (`on conflict do nothing`). The toast reads: "🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày, 1 bao urê và 1 cây liềm — xem Sổ tay nhà nông nhé!"
- **Shop descriptions** (`describeFarmItem`), built from the config:
  - seeds: "Trồng dây · chín ~48 giờ · 200 kg/thửa · 265 xu/kg"; "Gieo thẳng · chín ~60 giờ · 150 kg/thửa · 460 xu/kg"; "Ươm 10 giờ rồi trồng · lứa đầu ~46 giờ, 3 lứa · 60 kg/thửa · 1.590 xu/kg";
  - tools: "Gặt lúa tay, 6 phần — mua một lần"; "Nạp 1 chai thuốc được 3 lần xịt — mua một lần";
  - sprays, reworded: insect "Trị sâu cuốn lá, sùng khoai, sâu keo, bọ trĩ"; fungus "Trị đạo ôn lá, đạo ôn cổ bông, thán thư".

## 10. Economy check

**The assumptions:**
- A rented plot with full care, one season per 96 h lease. The costs include the 10 000 rent.
- Fertilizers are the cheapest on-time bags. NPK in place of kali or urê adds 300 a bag.
- **Sprays:** one bottle per pest slot that hits, none for a slot that misses. Thuốc trừ sâu costs 700 (sâu cuốn lá, sùng khoai, sâu keo, bọ trĩ), thuốc trừ rầy 800, and thuốc trừ bệnh 900 (đạo ôn, thán thư). Snails are picked by hand for free.
- **The headline uses 1 spray.** Where the bottle can differ, it takes the dearer one.

**Rice under v15.2.** The kg are unchanged. A hand harvest adds no cost, since the sickle is a one-time tool and is left out of per-season net. Rice has two sprayable pest slots (v15 §8.5's slots 2 and 3), priced here at 900 a bottle, the dearest remedy.

| Variety | kg | Revenue (dry) | Rent + seed + 4 fertilizers | Net: 0 / **1** / 2 sprays | With the harvester (1 spray) |
|---|---|---|---|---|---|
| short | 90 | 90 × 710 = 63 900 | 10 000 + 600 + 2 100 = 12 700 | 51 200 / **50 300** / 49 400 | 47 300 |
| nếp | 75 | 75 × 950 = 71 250 | 10 000 + 900 + 2 100 = 13 000 | 58 250 / **57 350** / 56 450 | 54 350 |
| thơm | 60 | 60 × 1 350 = 81 000 | 10 000 + 1 500 + 2 100 = 13 600 | 67 400 / **66 500** / 65 600 | 63 500 |

- **With a hand harvest** every variety nets at least 50 000 at the headline. Short dips below 50 000 only when both slots hit: 49 400 to 49 700, depending on the bottles (700 + 800 to 900 + 900).
- **The harvester** takes 3 000 off a whole plot (500 a part). Short then nets 47 300, under 50 000: that is the price of skipping the rounds.

**Hoa màu.** The spray count depends on which pest slots hit.

| Crop | Revenue | Rent + seed + fertilizers | Sprays | Net: 0 / **1** / 2 sprays | Poor care (1 spray) |
|---|---|---|---|---|---|
| khoai (≈ 48 h) | 200 × 265 = 53 000 | 10 000 + 800 + 1 500 (chuồng, lân, kali) = 12 300 | sùng khoai: 0 or 1 × 700 | 40 700 / **40 000** / — | 140 kg: 24 100 |
| bắp (≈ 60 h) | 150 × 460 = 69 000 | 10 000 + 1 000 + 2 100 (chuồng, lân, urê, kali) = 13 100 | 1 × 700 per armyworm wave that hits: 0, 1 or 2 | 55 900 / **55 200** / 54 500 | 105 kg: 34 500 |
| ớt (≈ 80 h) | (24 + 21 + 15) × 1 590 = 95 400 | 10 000 + 1 500 + 2 700 (chuồng, lân, urê, kali, kali) = 14 200 | bọ trĩ 700, thán thư 900 | 81 200 / **80 300** (80 500 if it is the thrips) / 79 600 | 17 + 15 + 11 = 43 kg: 53 270 |

- **Poor care** multiplies each picking's x by 0.7 before it is rounded (§8.7), so ớt keeps 43 kg, not 42.

**No crop dominates.** Per day is the headline net × 24 / the season's hours, farming again right after each harvest. Rice ripens 2 + 56·s hours after soaking, with prompt actions (v15 §8.1): short 52 h, nếp 58 h, thơm 66 h. A private plot has no rent and land 1.1, with each picking rounded as in §8.7, and its costs are the seed, the fertilizers and 1 spray.

| Crop | Rented: net / hours = per day | Private: kg → net → per day |
|---|---|---|
| khoai | 40 000 / 48 h = 20 000 | 220 kg → 55 300 → 27 650 |
| bắp | 55 200 / 60 h = 22 080 | 165 kg → 72 100 → 28 840 |
| short | 50 300 / 52 h ≈ 23 215 | 99 kg → 66 690 → 30 780 |
| nếp | 57 350 / 58 h ≈ 23 731 | 83 kg → 74 950 → ≈ 31 014 |
| ớt | 80 300 / 80 h = 24 090 | 26 + 23 + 17 = 66 kg → 99 840 → 29 952 |
| thơm | 66 500 / 66 h ≈ 24 182 | 66 kg → 84 600 → ≈ 30 764 |

- **Per day,** every crop is within 18 % of the best on a rented plot (20 000–24 182) and within 11 % on a private one (27 650–31 014). Thơm and ớt lead when renting; rice leads on owned land.
- **The trade-off:** khoai, the lowest per day, is the quickest and the most forgiving, at about 11 actions. Ớt pays the most per lease (80 300 rented, 99 840 private) for the most work, about 19 actions.

**Tools:**

| Tool | Price | What it buys |
|---|---|---|
| Liềm | 1 500 once | hand harvesting forever: 6 successful rounds, 1–3 min per plot |
| Máy gặt | 500 per remaining part (3 000 a whole plot) | the rest of the plot in 30 s, with no sickle and no rounds |
| Bình phun | 5 000 once | 3 sprays per bottle |

**Why the harvester still costs about 3 000 at 30 s:**
- **The price follows the harvest's value, not the time saved.** 3 000 is 4.7 % / 4.2 % / 3.7 % of a short / nếp / thơm season's revenue (63 900 / 71 250 / 81 000): a few percent of the crop, like real machine hire.
- **It sells convenience, not yield.** A sickle harvest takes 1–3 minutes, so the machine saves only minutes. Those minutes cost at most 0.1 % of the crop (2 % an hour, and only once it is overripe), and the minigame multiplies nothing. What it sells is skipping the rounds (on a phone, or in a hurry) and not needing a sickle.
- **So it is a deliberate xu sink.** A whole-plot rental costs two sickles. A regular buys the sickle once and rents to finish quickly; the pro-rating (R9) keeps finishing a half-cut plot fair.

**The sprayer:**
- A full load saves 2 bottles: 1 400 xu of insect spray, 1 600 of hopper spray or 1 800 of fungus spray. The 5 000 pays back after 2.8 (fungus) to 3.6 (insect) full loads; with insect spray alone that is about 11 sprays.
- Insect spray treats sâu cuốn lá, sùng khoai, sâu keo and bọ trĩ. At the base chances that is 0.22 outbreaks per plot-season for thơm, 0.27 for short and nếp, 0.40 for khoai and ớt, and 0.70 for bắp (two waves). Two plots farmed back to back see 1.1–3.9 a week, so the sprayer pays back in about 3–10 weeks. It is a long-term convenience, like land.

All prices live in `shop_items`, `upland_crops` and one constant, so tuning is a data change.

## 11. Server — `0016_v15_2_crops.sql`

### 11.1 Sections (in order; `language sql` bodies are checked at creation)

| Section | Contents |
|---|---|
| **A** Config and catalog | `upland_crops`, its seed rows and select policy; `shop_items.upland`; the kind check with `tool`; the 5 items; the `coin_ledger` reason check = `0015`'s list + `harvester`, `produce_sell` |
| **B** Tables | the new `crops` columns and checks; `produce_stock`; the tank columns on `farm_profiles`; RLS and revokes |
| **C** Model | `_upland`, `_up_ready`, `_up_next`, `_up_phase`, `_up_water_ok`, `_up_off_hours`, `_up_rot_hours`, `_up_excess_n`, `_up_care`, `_up_pests`, `_up_yield`, `_part_kg`, `_produce_add` |
| **D** Field | `_farm_crop`, `_care_crop`, `_work_check`, `_plot_view`, `_farm_mine`, `_field_sweep` (step 0 kept, J added, 6 changed) |
| **E** Actions and RPCs | the re-created private bodies, the new `_farm_do_*`, the 7 new guarded RPCs, and `buy_farm_item` and `claim_farm_gift` re-created with their guards |
| **F** Anti-cheat | `_ac_holdings` and `_ac_wipe` re-created with produce and the tank |

### 11.2 Tables and columns

```sql
create table if not exists public.upland_crops (…);             -- §8.2; RLS on, select policy to anon, grant select
alter table public.shop_items add column if not exists upland text references public.upland_crops(id);
alter table public.crops add column if not exists kind text not null default 'rice';          -- crops_kind_check: rice|upland
alter table public.crops add column if not exists upland text references public.upland_crops(id);
alter table public.crops add column if not exists plant_at timestamptz;
alter table public.crops add column if not exists work_log jsonb not null default '[]'::jsonb;  -- [{t, act}]
alter table public.crops add column if not exists harvests jsonb not null default '[]'::jsonb;  -- [{t, k, kg}] pickings
alter table public.crops add column if not exists harvested_parts smallint not null default 0; -- crops_parts_check: 0–6
alter table public.crops add column if not exists harvested_kg integer not null default 0;
alter table public.crops add column if not exists harvester_at timestamptz;
alter table public.crops add column if not exists harvester_until timestamptz;
create table if not exists public.produce_stock (
  account_id uuid not null references public.accounts(id) on delete cascade,
  upland text not null references public.upland_crops(id),
  kg integer not null default 0 check (kg >= 0),
  primary key (account_id, upland));                             -- RLS on, no policies, revoked
alter table public.farm_profiles add column if not exists tank_item text references public.shop_items(id);
alter table public.farm_profiles add column if not exists tank_charges smallint not null default 0;
update public.farm_profiles set tank_item = null, tank_charges = 0        -- normalize before the check (R21)
 where not ((tank_item is null and tank_charges = 0) or (tank_item is not null and tank_charges between 1 and 3));
alter table public.farm_profiles drop constraint if exists farm_profiles_tank_check;
alter table public.farm_profiles add constraint farm_profiles_tank_check
  check ((tank_item is null and tank_charges = 0) or (tank_item is not null and tank_charges between 1 and 3));
```

The other checks are also added with `drop constraint if exists` + `add`, so a re-run is safe.

### 11.3 Private functions

**New:**
- **The hoa-màu model** (§8), each a mirror of `upland.ts`: `_up_phase(c, u, t)`; `_up_next(c, u, t)` (0 = none left); `_up_ready(c, u, k)` → R_k; `_up_water_ok`, `_up_off_hours`, `_up_rot_hours`, `_up_excess_n`; `_up_care(c, u)` → `{manure, phosphate, scores[], excess}`; `_up_pests(c, u, p_now)` → `[{slot, kind, since, treated_at}]`; `_up_yield(c, u, land, k, p_now)` → `{kg, mcare, mplant, mwater, mrot, mpest, mlate}`.
- `_part_kg(i, y)` = `(i * y) / 6 - ((i - 1) * y) / 6`, and `_produce_add(account, upland, kg)`.
- `_care_crop(room, plot, account, p_now)`: `_farm_crop`, plus `harvesting` when `harvested_parts > 0`.
- `_farm_do_prepare_beds`, `_farm_do_plant`, `_farm_do_tend`, `_farm_do_harvest_part` and `_farm_do_rent_harvester`, each taking `p_now`.

**Re-created:**
- `_farm_crop` now selects the crop `for update` and becomes `volatile` (§6.5), and it raises `harvester busy` while a harvester runs. `_work_check` handles the rice round (sickle, phase, water), the ớt transplant and hoa-màu pickings.
- `_farm_do_begin_work` replaces any earlier work record and applies the lease gates: 10 s left for a rice round, 5 s for a transplant or a picking (`lease ending`, R11).
- `_farm_do_soak` and `_farm_do_sow` raise `wrong crop` on beds. `_farm_do_fertilize`, `_farm_do_water` and `_farm_do_spray` use `_care_crop`, and spray also uses the tank.
- `_farm_do_transplant` sets P for ớt. `_farm_do_harvest` does hoa-màu pickings only. `_farm_do_pick_snails` adds `harvester busy` and `harvesting`; `_farm_do_abandon` adds `harvester busy`.
- `_plot_view`, `_farm_mine`, `_field_sweep`.

Each is revoked from `public`, `anon` and `authenticated`.

### 11.4 Public RPCs

Every RPC is SECURITY DEFINER with an explicit `grant execute … to anon, authenticated`. Every mutating RPC takes the wallet lock and runs `_field_open` first.

**New room RPCs.** Each takes `(p_room_id uuid, p_session_token text, p_plot integer, …)` and returns `field_state`:

| RPC | Extra argument | Refusals, in order (after the guard and the hard checks) |
|---|---|---|
| `prepare_beds` | — | `invalid plot`, `not your plot`, `crop exists` |
| `plant_crop` | `p_item_id text` | `invalid item`, `invalid plot`, `not your plot`, `not prepared`, `wrong crop`, `crop exists` (already planted), `need water`, `no item` |
| `tend_crop` | `p_act text` | `invalid plot`, `not your plot`, `not prepared`, `wrong crop`, `wrong phase` (before P) |
| `harvest_part` | `p_success boolean` | `invalid plot`, `not your plot`, `not prepared`, `harvester busy`, `wrong crop`, then for a success: `too fast`, `work expired`, `wrong phase`, `need water`, `no sickle` |
| `rent_harvester` | — | `invalid plot`, `not your plot`, `not prepared`, `harvester busy`, `wrong crop`, `wrong phase`, `need water`, `lease ends`, `not enough coins` |

A successful `harvest_part` answers `field_state || {"harvest_part": {"variety", "kg", "parts", "total", "done"}}`, where `total` is `harvested_kg` and `done` is true on the sixth part. A failure answers `field_state`.

**New account RPCs.** Each returns `{server_now, mine}`:

| RPC | Refusals |
|---|---|
| `load_sprayer(p_session_token text, p_item_id text)` | `invalid item`, `no sprayer`, `no item` |
| `sell_produce(p_session_token text, p_upland text, p_kg integer)` | `invalid quantity`, `invalid crop`, `not enough crop`. Pays `kg · price_per_kg` (`produce_sell`, ref `'<upland> <kg> kg'`). |

**Changed behaviour, with the same signatures:**
- `begin_work` replaces any earlier record. On rice, `'harvest'` starts a round (§6.2). It raises `lease ending` with under 10 s (round) or 5 s (transplant, picking) left on the lease.
- `harvest(…, quality)` on rice raises `wrong crop`. `transplant` sets P on ớt. `spray` uses the tank. `buy_farm_item` sells tools (§9). `claim_farm_gift` adds the sickle.
- Every action on a plot with a running harvester raises `harvester busy`, and every care action on a partly cut plot raises `harvesting`.

### 11.5 Anti-cheat

| RPC | Guard | Checks after the guard |
|---|---|---|
| `prepare_beds`, `harvest_part`, `rent_harvester` | `_ac_play` | `bad_plot` |
| `plant_crop` | `_ac_play` | `bad_plot`, then soft `kind_mismatch` (`invalid item`) when the item exists with a kind other than `seed` |
| `tend_crop` | `_ac_play` | `bad_plot`, then `bad_work` (`invalid act`) when `p_act` is null or not `lat_day` / `vun_goc` |
| `load_sprayer` | `_ac_account` | soft `kind_mismatch` (`invalid item`) when the item exists with a kind other than `pesticide` |
| `sell_produce` | `_ac_account` | after `_wallet_lock`: `bad_qty` (`invalid quantity`) when `p_kg` is null or < 1 |
| `buy_farm_item` (re-created) | `_ac_account` | `kind_mismatch` now allows `tool`; `bad_qty` stays null or outside 1–99 (R18) |

**Why an honest client never sends these:** plot numbers come from the state (1–10); `plotActions` emits acts only from the crop config, whose act ids the smoke pins to {`lat_day`, `vun_goc`}; the depot's produce rows send kg ∈ [1, stock].

**The rest of the layer:**
- **Lock (D2).** The 7 new RPCs join the locked list, 42 in all. `anticheat-guards.sql` adds them to its dynamic loop.
- **Envelope.** Flagged calls return the envelope alone, as other room and account RPCs do.
- **Refusals that never count:** `too fast` (the part gate), `work expired`, `harvesting`, `harvester busy`, `no sickle`, `no sprayer`, `lease ending`, `lease ends`, `wrong crop`, `already owned`, `invalid crop`, `not enough crop`, and a tool with quantity ≠ 1. The honest causes are two tabs, a stale state, a disconnect, a lease or harvester running out, and a cached v15.1 shop.
- **Accepted residual.** `harvest_part(p_success = true)` is client-declared, like v14's reel. A script can cut one part per 8 s, a whole plot in 48 s against about 1–3 min by hand. It gains only time, never kg: no quality factor, and the grain follows Y(t). The README trust model says so. A soft counter for successes claimed under 9 s is left to later.
- **Wipe.** `_ac_wipe` deletes `produce_stock` and empties the tank. `_ac_holdings` gains `produce: [{upland, kg}]` and `tank`, and its `crops` entries gain `kind`, `upland`, `plant_at`, `parts` and `harvester_until`. A wiped farmer's harvester job is never paid (R10).

### 11.6 `field_state` changes

```jsonc
"crop": null | {
  "kind": "rice" | "upland", "variety": "nep" | null, "upland": "ot" | null,
  "phase": "tillering" | "flower" | "waiting" | …,        // rice phases, or §8.3's
  "prepared_at", "soak_at", "sow_at", "transplant_at", "plant_at",
  "water": 1, "water_set_at": "…", "pests": [{ "kind": "thrips", "since": "…", "treated_at": null }],
  "excess_n": false, "ripe": false, "rotted_at": null,
  "picking": 2, "pickings": 3,                              // upland: the next picking (0 = none left) and how many; rice: null, 1
  "parts": 2,                                               // rice: harvested_parts (public: "Đã gặt 2/6 phần")
  "harvester": null | { "started_at": "…", "ends_at": "…" },
  "log": { "water", "fert", "spray", "picks", "q_transplant",   // farmer only, as before, plus:
           "work": [{ "t", "act" }], "harvests": [{ "t", "k", "kg" }], "harvested_kg": 25 }
}
"mine": { …, "items": { "tool_sickle": 1, … },              // tools listed too
          "produce": { "khoai": 180 }, "tank": null | { "item": "spray_insect" | null, "charges": 2 } }
```

`tank` is null when the account owns no sprayer.

### 11.7 Errors → Vietnamese (`farmErrorMessage`)

| Server message | Vietnamese |
|---|---|
| `no sickle` | "Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã)." |
| `no sprayer` | "Chưa có bình phun — mua ở tiệm anh Hai." |
| `harvesting` | "Đang gặt dở — gặt cho xong đã." |
| `harvester busy` | "Máy gặt đang gặt thửa này." |
| `too fast` from `harvest_part` | "Chưa xong bó lúa — thử lại sau vài giây." (other actions keep "Từ từ thôi…") |
| `not your plot` from `harvest_part` (the lease ran out mid-round) | "Hết hạn thuê — phần lúa chưa gặt đã mất." (other actions keep "Thửa này không phải của bạn.") |
| `work expired` | "Lượt gặt đã quá lâu — bắt đầu lại nhé." |
| `lease ending` | "Sắp hết hạn thuê — không kịp gặt phần này." |
| `lease ends` | "Không kịp gặt xong trước khi hết hạn thuê." |
| `wrong crop` | "Việc này không hợp với cây trên thửa." |
| `already owned` | "Bạn đã có món này rồi." |
| `not enough crop` | "Không đủ hàng để bán." |
| `crop exists` (reworded) | "Đang có vụ trên thửa — thu hoạch hoặc bỏ vụ trước." |
| `invalid crop`, `invalid act` | not mapped, since only a catalog change or a tampered call produces them: "Có lỗi, thử lại nhé." |

The two `harvest_part` rows need the call's context: `farmErrorMessage(err, itemName?, action?)` gains a third argument, and the HarvestGame overlay passes `"harvest_part"`.

## 12. Networking

- **`fp`** follows every successful new action, as today. At a harvester's end, the farmer's client (while on the field) refetches at `harvester_until + 1 s` and sends `fp {p}` once the job is gone. Other clients hide the job at `ends_at` on their own clock (R15).
- **`fa`:** `FarmAnim` becomes 0–10, and the parser accepts values up to 10.

  | Action | Code |
  |---|---|
  | lên luống, lật dây, vun gốc | 8 (hoe) |
  | trồng dây, trồng cây ớt con | 1 |
  | gieo bắp, ươm ớt | 5 |
  | đào khoai | **9** (new) |
  | bẻ bắp, hái ớt | **10** (new) |
  | a harvest round | 2, re-sent every 2 s (R14) |
  | rent_harvester | none (the machine is drawn from the state) |
- **Budget:** a whole hand harvest sends about 6 rounds × 6 `fa`, plus 6 `fp`. A harvester sends 2 `fp`. Both stay far inside the anti-cheat receive budgets (`fa` 2/s, burst 3) and the free-plan quota.

## 13. Game UI

### 13.1 Plot panel

- **A bare plot (mine):** "Làm ruộng lúa" (hint "Cày bừa, cho nước ngập ruộng — để cấy lúa."), "Lên luống trồng màu" (hint "Đắp luống cao, đất Ẩm — trồng khoai, bắp, ớt."), and the rice soak buttons as today.
- **Beds, status lines:**
  - "🌱 Luống đã lên — chưa trồng gì.", or "🌱 {Khoai lang} · **{stage name}** — giai đoạn sau: còn {d}";
  - "💧 Đất: {Ẩm} · cần {Khô–Ẩm}", then the pests;
  - "⚠️ Dư đạm — mất 10%, sâu bệnh dễ tới.", and "⚠️ Đất úng — củ đang thối!" (khoai, level ≥ 2 after `rot_from_h`);
  - "⚖️ Ước tính: lứa này ~24 kg · cả vụ ~60 kg (chưa tính sâu bệnh chưa tới)".

  Phase names: prepared "Đã lên luống", nursery "Đang ươm cây con", waiting "Chờ lứa sau", ripe "Chín", overripe "Chín quá". Stages use their config names.
- **Beds, buttons** (a disabled button says why; a warning asks before a wasted action):

  | Button | Reasons and advice |
  |---|---|
  | `plant_label`, one per owned hoa-màu seed | "Cần đất Ẩm (đang {Khô})." With no seed, a disabled "Trồng hoa màu": "Chưa có giống hoa màu — ghé tiệm anh Hai." |
  | `transplant_label` (ớt) | "Cây con chưa đủ tuổi — trồng được sau {d}." · "Cần đất Ẩm (đang {Đẫm})." |
  | each act care ("Lật dây", "Vun gốc") | done on time: disabled "Đã {lật dây} rồi." · on time: hint "Đúng lúc {lật dây}." · early: "Chưa tới lúc — {lật dây} lúc {24}–{32} giờ sau trồng." · half region: "Trễ rồi — chỉ được nửa công." · later: "Quá muộn — làm bây giờ là phí công." |
  | "Bón {phân …}" | before P: "Bón lót trước khi trồng." · "Đã bón lót loại này — bón thêm là phí." · "Chưa trồng — bón thúc bây giờ là phí." After P: "Đã trồng — bón lót bây giờ là phí." · "Đúng lúc {bón thúc nuôi củ}." · "Hơi sớm — chỉ được nửa công (đúng lúc sau {d})." · "Trễ rồi — chỉ được nửa công." · "{Phân urê} lúc này chỉ được nửa công." · "Đã bón đạm đợt này — bón nữa sẽ dư đạm!" · "Bón đạm lúc này gây dư đạm!" · "Lúc này bón là phí." |
  | "Tưới nước (lên {Ẩm})" or "Tưới thêm (giữ Ngập)"; "Tháo nước (xuống {Ẩm})" | at 0: disabled "Luống đã khô." On khoai past 22 h, watering to ≥ 2 warns "Đất Đẫm làm thối củ khoai!" |
  | `harvest_label`, plus " (lứa {k}/{n})" when n > 1 | "Chưa chín — {đào khoai} được sau {d}." · "Tháo bớt nước trước khi {đào khoai} (đang {Đẫm})." |
- **Rice, ripe:** "Gặt bằng liềm", then "Gặt tiếp (phần {n+1}/6)".
  - Hint: "Mỗi phần là một lượt 8 bó — đạt 4 điểm là xong phần."
  - Reasons: "Chưa có liềm — mua ở tiệm anh Hai.", "Rút nước trước khi gặt (đang {Nông}).", "Máy gặt đang gặt thửa này.", and while ripening "Lúa chưa chín — gặt được sau {d}."
  - A note line: "🚜 Hoặc thuê máy gặt ở Hợp tác xã: 30 giây, 500 xu mỗi phần còn lại."
- **Rice, partly cut:** status "🌾 Đã gặt {2}/6 phần ({25} kg)". Only "Gặt tiếp" and "Bỏ vụ" are offered; Bỏ vụ warns "Bỏ vụ là mất phần lúa chưa gặt."
- **A running harvester:** "🚜 Máy gặt đang gặt — còn {25} giây", counting down in a 1 s local tick while the panel is open. No buttons.
- **Spray buttons:** "Xịt {thuốc trừ sâu}", with " (bình phun)" when the tank matches; the hint adds " Bình còn {2} lần."
- **Handbook link** (`handbookTabFor`): the crop's tab for beds; "Nông cụ" for ripe or partly cut rice; otherwise as today.

### 13.2 HarvestGame overlay (`components/game/farm/HarvestGame.tsx`)

- **Title and help:** "🌾 Gặt thửa {3} · phần {k}/6" and "Giữ Space (hoặc giữ chuột, giữ ngón tay) cho lực liềm lên — thả khi vạch nằm trong vùng xanh."
- **During the round:** "Bó {i}/8 · {3,5} điểm"; the marks "Chuẩn!", "Được", "Lệch — sót hạt", "Lệch — rụng hạt"; and "Đang bó lúa…" while a success waits out the 9 s.
- **Success:** "✅ Xong phần {k}/6: {13} kg lúa.", with "Gặt tiếp phần {k+1}" and "Nghỉ tay". After the sixth part: "🌾 Gặt xong thửa {3}: tổng {75} kg {nếp} (lúa ướt) — đem phơi rồi bán cho cô Út nhé!", with "Đóng".
- **Refusals:** the §11.7 text with the `harvest_part` context: `too fast` reads "Chưa xong bó lúa — thử lại sau vài giây.", and `not your plot` (the lease ran out mid-round) reads "Hết hạn thuê — phần lúa chưa gặt đã mất."
- **Failure:** "❌ Được {3,5}/8 điểm — cần 4. Thử lại ngay nhé!", with "Thử lại" and "Nghỉ tay". **Cancel:** "Huỷ (Esc)".

### 13.3 Task list (`dueTasks`)

Each line reads "Thửa {n} · …". The panel ticks every second while a harvester runs.

| Case | Text | Urgent |
|---|---|---|
| bare plot | "Làm đất (ruộng lúa hoặc lên luống)" | no |
| rice, partly cut | "Gặt tiếp — đã gặt {2}/6 phần" | when overripe |
| harvester running | "Máy gặt đang gặt — còn {25} giây" | no |
| rice from heading on, no sickle | "Chưa có liềm — mua ở tiệm anh Hai hoặc thuê máy gặt" | once ripe |
| beds, nothing planted | "Trồng hoa màu" | no |
| ớt nursery | "Cây ớt con đang lớn — trồng được sau {d}", then "Trồng cây ớt con" | once old |
| an open care window | "{Lật dây} — còn {d}" | yes |
| picking | "{Đào khoai} — còn {d}" · "{Hái ớt} ngay — đang hư!" · "{Hái ớt} lứa {2} — chín sau {d}" | last 3 h · yes · no |
| water | "Tưới nước (đang Khô, cần Ẩm)" · "Tháo nước ngay — khoai đang thối củ!" | yes |
| pests | "{Sùng khoai}! Xịt thuốc trừ sâu" | yes |

### 13.4 Co-op tab "Máy gặt" (CoopPanel)

- **Tabs:** Đất làng, Đất tư, Chợ đất, **Máy gặt**, Của tôi. The panel opens on "Máy gặt" when one of my rice plots here is ripe.
- **Intro:** "“Máy gặt của hợp tác xã: 500 xu mỗi phần, cả thửa 3.000 xu, 30 giây là xong, khỏi cầm liềm. Nhớ rút nước trước nghen!”"
- **Rows,** one per rice plot of mine: "Thửa {3} · {Nếp} · {Chín quá 2 giờ} · đã gặt {2}/6 phần", with "Thuê máy gặt · {4} phần · {2.000} xu".
  - The button confirms: "Thuê máy gặt cho thửa {3}, {4} phần còn lại, giá {2.000} xu? Không huỷ được."
  - Disabled reasons come from `harvesterRefusal` through `reasonText`.
  - Empty: "Bạn chưa làm ruộng lúa nào trong phòng này."
- **Toasts:** "🚜 Máy gặt đang vào thửa {3} — 30 giây nữa xong."; at completion "🚜 Máy gặt gặt xong thửa {3}: {50} kg {nếp} (lúa ướt)." (the wet-stock change, R15).

### 13.5 Shop, depot and bag

- **Shop:** the sections are "🌾 Giống lúa", "🥔 Giống hoa màu", "🧺 Phân bón", "🧴 Thuốc" and "🛠️ Nông cụ". A tool row has no stepper: "Mua · {1.500 xu}", or disabled "✓ Đã có".
- **Depot:**
  - hoa-màu rows: "{Khoai lang} · {180} kg" / "{265} xu/kg · bán tươi", with "Bán · {x}" and "Bán hết · {x}";
  - intro when only hoa màu is in stock: "“Hoa màu bán tươi, khỏi phơi — cô lấy hết!”";
  - empty: "“Chưa có lúa hay hoa màu hả con? Thu hoạch xong mang qua, cô trả giá cao!”";
  - toast: "💰 Bán {180} kg {khoai lang} được {47.700} xu."
- **Bag, "🌾 Nông cụ" (R29):**
  - "Liềm — gặt lúa 6 phần", or "Chưa có liềm — tiệm anh Hai bán 1.500 xu";
  - "Bình phun — {Thuốc trừ sâu} · còn {2}/3 lần", "Bình phun — trống", or "Chưa có bình phun — tiệm anh Hai bán 5.000 xu";
  - one "Nạp {thuốc trừ sâu} ({n} chai)" per pesticide held. It is disabled with "Bình đang đầy thuốc này." when the tank is full of the same. When other charges remain it confirms: "Bình còn {2} lần {thuốc trừ bệnh}. Nạp {thuốc trừ sâu} sẽ đổ bỏ phần còn lại — nạp chứ?";
  - toast: "🧴 Đã nạp {thuốc trừ sâu} vào bình phun — 3 lần xịt."

### 13.6 Labels, prompts, HUD and toasts

- **Name-post label** (`plotLabel`, per frame): "3 · Dat · gặt {2}/6" while partly cut; "3 · Dat · máy gặt {25}s" while a harvester runs (seconds from `serverNow()`).
- **Prompt:** the first enabled job, by its button label: "Gặt tiếp thửa 3", "Trồng dây khoai thửa 5", "Hái ớt thửa 6".
- **HUD:** `produceSummary` gives "🌾 {70} kg khô · {0} kg ướt", plus " · 🧺 {180} kg màu" when there is any.
- **Toasts:** "Đã lên luống — đất Ẩm, sẵn sàng trồng." · "Đã {trồng dây khoai}." · "Đã {lật dây}." · "🧺 Thu hoạch {24} kg {ớt} (lứa {1}/{3}) — đem bán cho cô Út nhé!" The 3 s bar reads "🧺 Đang {hái ớt} thửa {6}…" or "🌱 Đang trồng cây ớt con thửa {6}…".
- **Before `0016`:** the field shows no hoa-màu seeds, and the new RPCs toast `NOT_OPEN_152`: "Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016."

## 14. Handbook — Sổ tay nhà nông

The tabs are Quy trình, Phân bón, Sâu bệnh, Nước, Giống lúa, Mẹo, **Khoai lang**, **Bắp**, **Ớt** and **Nông cụ**; they wrap.

**Rice edits:**
- **Quy trình, step 11:** "11. Gặt: lúa chín và đã rút nước thì gặt bằng liềm hoặc thuê máy gặt. Ruộng chia 6 phần; mỗi lượt gặt tay có 8 bó — được từ 4 điểm trở lên (chuẩn 1, được nửa điểm, lệch 0) là xong 1 phần. Lúa chín quá vẫn mất 2% mỗi giờ tới lúc cắt từng phần; để 2 ngày thì rụng hết. Gặt xong phơi 3 giờ rồi bán cô Út."
- **Sâu bệnh** gains "Hoa màu có sâu bệnh riêng — xem tab từng cây."
- **Mẹo** gains "Làm đất có hai cách: làm ruộng lúa hoặc lên luống trồng màu — xen vụ lúa với vụ màu cho đỡ nhàm." and "Nạp thuốc trừ sâu vào bình phun là lợi nhất: nó trị sâu cuốn lá, sùng khoai, sâu keo và bọ trĩ."

**Crop tabs** are generated by `uplandHandbook(u)` from the config. A start rounds up and an end rounds down (all integers today). The section "Cách trồng {name} (~{total} giờ{, hái n lứa})" has these lines:
1. "1. Lên luống: đắp luống cao cho ráo nước; đất sẵn Ẩm."
2. "2. Bón lót: phân chuồng hoai và phân lân trước khi trồng. Thiếu mỗi loại mất 5%."
3. By method:
   - cutting: "3. {plant_label} khi đất Ẩm."
   - direct: "3. {plant_label} thẳng xuống luống khi đất Ẩm — không cần ươm."
   - nursery: "3. {plant_label} ở góc luống khi đất Ẩm, giữ Ẩm. {transplant_label} khi cây {ready}–{old} giờ tuổi, đất Ẩm; cây già quá mất 3% mỗi giờ (tối đa 30%)."
4. One line per care, numbered on:
   - fert: "{name}: {phân kali hoặc phân NPK}, {from}–{to} giờ sau trồng. Sai lúc hoặc sai loại được nửa công (mất {half}%); bỏ trống mất {missing}%."
   - act: "{name}: {from}–{to} giờ sau trồng; trễ tới {half_to} giờ được nửa công (mất {half}%); không làm mất {missing}%."
5. "Nước: {Bén rễ Ẩm; Bò dây, Tượng củ, Củ lớn Khô–Ẩm}; từ lúc chín {Khô–Ẩm}. Cứ 12 giờ nước tự rút một mức; mỗi giờ sai mức mất 1% (tối đa 20%)." Stages with the same levels are grouped.
6. "{harvest_label}: chín {ripe_h} giờ sau trồng{, rồi cứ {gap} giờ một lứa (40% – 35% – 25%)}. Đất phải Khô–Ẩm. Chín quá {window} giờ mất {over}% mỗi giờ; để thêm {lost} giờ là {cả vụ | lứa đó} hư."

The section "Sâu bệnh và lưu ý" has:
- one line per pest: "{name}: hay tới {from}–{to} giờ sau trồng{; đất Khô dễ bị gấp {2} | ; đất Đẫm dễ bị gấp {2}}. Xịt {thuốc trừ sâu}.";
- the rot line: "Từ {22} giờ sau trồng, đất Đẫm hay Ngập là úng, thối củ: mất {3}% mỗi giờ (tối đa {50}%).";
- the excess-N line: "Bón đạm (urê, NPK) ngoài các đợt bón thúc, hoặc hai lần trong một đợt, là dư đạm: mất 10%, sâu bệnh dễ tới gấp rưỡi.";
- the crop's tip, in TS by crop id:
  - khoai: "Mẹo: tưới cho Ẩm lúc tượng củ để sùng khỏi chui vào củ, nhưng đừng tưới tới Đẫm."
  - bắp: "Mẹo: bắp ưa nước — tưới lên Đẫm là giữ được cả ngày; lúc chắc hạt thì cho ráo."
  - ớt: "Mẹo: ớt nhiều việc nhất mà lời nhất; tháo nước về Ẩm trước mỗi lứa hái."

**The Nông cụ tab** (verbatim, one line each):
- **Liềm và gặt lúa**
  - "Lúa chín phải gặt bằng liềm hoặc máy gặt, và phải rút nước (Khô–Ẩm) trước."
  - "Liềm (1.500 xu, mua một lần ở tiệm anh Hai). Ruộng lúa chia 6 phần; mỗi phần gặt bằng một lượt tay."
  - "Mỗi lượt có 8 bó: giữ cho lực liềm lên, thả khi vạch nằm trong vùng xanh. Chuẩn được 1 điểm, được nửa điểm, lệch 0 điểm. Từ 4 điểm trở lên là xong 1 phần; hụt thì thử lại ngay, không mất gì."
  - "Mỗi phần cho 1/6 sản lượng lúc cắt: lúa chín quá thì phần cắt sau ít hơn. Điểm cao không làm tăng sản lượng — chỉ cần đạt."
  - "Đang gặt dở thì chưa bón, tưới hay xịt được — gặt cho xong."
- **Máy gặt**
  - "Thuê ở Hợp tác xã (chú Tám): 500 xu mỗi phần còn lại, cả thửa 3.000 xu. Gặt hết trong 30 giây, không cần liềm, không huỷ được."
  - "Thuê được cả khi đã gặt tay dở. Ruộng thuê phải gặt xong trước khi hết hạn."
- **Bình phun**
  - "Bình phun (5.000 xu, mua một lần): nạp 1 chai thuốc được 3 lần xịt."
  - "Xịt đúng loại thuốc trong bình thì dùng bình; loại khác thì lấy chai trong giỏ."
  - "Nạp loại khác là đổ bỏ phần thuốc còn lại trong bình."
- **Hoa màu**
  - "Khoai, bắp, ớt không cần liềm: đào, bẻ, hái bằng tay trong 3 giây."

## 15. Art

Everything is original and drawn in code, in the module palettes (`K` in `crops.ts`, `COL` in `farm-anim.ts`).

- **`crops.ts`.** `PlotLook` gains `crop` (`rice` or an upland id), `cut` (0–1) and `picked`. Bed stages are `beds`, `nursery`, `g0`–`g4` (the config stage index), `waiting`, `ripe` and `overripe`. `lookKey` adds `crop`, `floor(cut · 12)` and `picked`.
  - **Beds:** east–west ridges 8 px wide with 4 px furrows. Khô is light cracked soil (`#a8875a`, `#7a5c38`); Ẩm is dark (`#8a6a3f`); Đẫm puts water in the furrows (`#5d93ad`, with sheen); Ngập covers all but the ridge tops.
  - **Khoai** (stems `#8e4a8a`, leaves `#6fbf4a` / `#4f9a38`, tubers `#b0486e` / `#7e2f4e`): cuttings with two leaves → vines creeping → vines covering the ridges → a dense mat with a few yellow leaves → ripe, yellow-green with tubers peeking at the ridge sides → overripe, drooping, the tubers dark-spotted.
  - **Bắp:** 2-px sprouts → four-leaf plants (`#6fbf4a`, `#3f7f2e`) → knee-high → tall stalks with tassels `#d9c27a` and silks `#c9607a` → green husked ears `#8fbf5a` → ripe, tan `#e0c56a` → overripe, dry `#b8902a`, some stalks lodged.
  - **Ớt:** a corner nursery patch → bushes (`#3f7f2e`, `#5caa4a`) → white flowers `#f4f1ea` → green chilies `#6fbf4a` → ripe, red `#d8342a`, thinned by `picked / n` → waiting, green with a few red → overripe, shrivelled `#8e1f1a` with fallen fruit.
  - **Pests:** weevil, tiny dark-blue ants with an orange waist (`#2f3a6e`, `#e0662f`); armyworm, brown caterpillars with pale frass (`#8a6a3f`, `#d9c9a0`); thrips, silvery streaks and curled tips (`#c9a23a`); anthracnose, dark sunken rings on fruit (`#3a2a1a`).
  - **Rice parts:** 6 vertical strips, cut from the left. Cut strips show stubble `#b8902a` and a tied sheaf (`#e0b33c`, tie `#8b5a33`) every third hill.
- **The harvester** (engine, drawn after the plot art, under props and people): a 32 × 20 px combine.
  - Body `#d9532b` shaded `#a83a1c`, cab glass `#9fc3cf`, tracks `#2a2f3a` with `#5a5f68` highlights, a front reel `#f6c945`, outlined.
  - It crosses the uncut strips left to right over the 30 s (x from `serverNow()`), bobbing 1 px, with straw puffs `#e0b33c` behind. `cut = (parts + progress · (6 − parts)) / 6`.
  - Under reduced motion it is static, with no puffs.
- **`farm-icons.ts`** (16 × 16): `seed_khoai`, a tied bundle of three cuttings; `seed_bap` and `seed_ot`, paper packets with a yellow cob and a red chili; `tool_sickle`, a crescent blade `#5a5f68` with edge `#e8e8ee` on a handle `#6e4424`; `tool_sprayer`, a blue backpack tank `#3d6fd1` / `#2f56a6` with a lever and a wand; `produce_khoai`, `produce_bap`, `produce_ot`: two tubers, a husked cob, three chilies.
- **`farm-anim.ts`:** 9 dig brings the hoe down and pops three tubers up in front; 10 pick shows a reaching hand and a woven basket `#c8a46a` at the feet filling with yellow and red dots. Each holds one pose under reduced motion.

## 16. Testing

**Pure TS (Vitest):**
- **`farm-upland.test.ts`:** the shared fixtures (kg and factors per case, and every `edges` entry); phases, including nursery, waiting, ripe, overripe and done per picking; accepted water, off-target samples and rot hours, all read through `waterAt`; care scoring (on time / half / missing, best of repeats) and excess N (outside the regions, a second N); `nextPicking`, lost pickings, Mplant and the hopeful estimate; `PEST_NAME` and `PEST_REMEDY` against the fixture configs.
- **`farm-minigames.test.ts`** (seeded): the bar reaches 1 in 1.2 s and auto-releases as "rụng hạt"; the band edges at 0.07 and 0.17, and an early release as "sót hạt"; the 0.35 s beat; 3.5 fails and 4 passes, printed "3,5".
- **Existing test files:**
  - `farm-crop`: `partKg(i, y)`. Y = 75 gives 12, 13, 12, 13, 12, 13; Y = 99 gives 16, 17, 16, 17, 16, 17; Y = 7 gives 1, 1, 1, 1, 1, 2. For every Y from 6 to 200 the six sum to Y, and after n parts the harvester's `Y − floor(n·Y/6)` equals parts n+1..6.
  - `farm-messages`: the §11.7 rows. With the `"harvest_part"` context, `too fast` gives "Chưa xong bó lúa — thử lại sau vài giây." and `not your plot` gives "Hết hạn thuê — phần lúa chưa gặt đã mất."; without it they stay "Từ từ thôi…" and "Thửa này không phải của bạn."
  - `farm-actions`: the actions for every bed phase, part state and harvester state; tend and fertilizer advice; the due tasks.
  - `farm-state`: the new fields, with defaults for old answers. `farm-rpc`: the new RPC names and arguments; the `harvest_part` and picking answers; `loadSprayer`, `sellProduce`.
  - `farm-catalog`: upland rows, tools, descriptions. `farm-handbook`: the new tabs; every printed hour lies in its window. `farm-land`: `harvesterRefusal` and the pro-rated price.
  - `game-crop-art`: the looks, `cut`, `lookKey`. `game-farm-icons`: 8 icons, each 16 × 16 with a complete palette. `game-protocol`: `fa` 9 and 10 accepted, 11 refused.
- **Hard-signal pins** (anti-cheat §15.2): `plotActions` emits acts only from the config, within {`lat_day`, `vun_goc`}; produce rows send kg ∈ [1, stock]; `FarmShopPanel` sends 1 for a tool; new plot actions carry state plot numbers.

**Shared fixtures:**
- **`tests/fixtures/upland-cases.json`:** `t0`, `crops` (the three config rows, verbatim), about 11 `cases` and the `edges`. Each case has `upland`, `land`, `sow`, `plant`, `pick`, `k`, the `water` / `fert` / `work` / `spray` / `harvests` logs, `pest_rolls`, and `expect` (`kg`, the six factors, `pests`). The cases:
  1. khoai, textbook: 200 kg.
  2. khoai left Đẫm for 6 h in `tuber`.
  3. khoai dry at the weevil's due time: a ×2 hit, sprayed 4 h late.
  4. khoai with no lật dây and late kali, on a private plot.
  5. bắp, textbook: 150 kg.
  6. bắp with urê at T = 26: excess N, and an armyworm it invited, untreated.
  7. bắp picked 10 h overripe.
  8. ớt picking 1, textbook: 24 kg.
  9. ớt picking 2, thrips treated late.
  10. ớt with old seedlings (transplanted at 24 h), picking 3.
  11. ớt with anthracnose in a Đẫm bed, untreated at picking 3.
- **`edges`** (R33): small cases, each taken at the edge and 1 s before it (1 h after it for a rate):
  - **care:** a bag at T = `from_h` and at T = `to_h` is on time, at `half_from_h` half, at `half_to_h` missing (the half region is half-open); the same for an act; an N bag at its care's `half_to_h` is excess;
  - **water:** a level read exactly 12 h after it was set is one lower; an entry exactly on a sample is read by that sample; a picking at start + n · 15 min counts n samples; the first rot sample is at P + `rot_from_h`;
  - **pests:** at due − 1 s a slot is not yet evaluated, at due it is; the water at due sets the multiplier, including a 12 h drop landing on due; a spray at due treats, one at due − 1 s does not;
  - **pickings and the nursery:** R_k − 1 s is `wrong phase` and R_k is ripe; O_k gives Mlate 1 and O_k + 1 h gives 1 − `over_rate`; L_k − 1 s is still pickable and L_k is lost; the transplant check refuses sow + `nursery_ready_h` − 1 s and allows sow + `nursery_ready_h`; a transplant at exactly `nursery_old_h` gives Mplant 1, an hour later 0.97;
  - **caps:** 0.2 (water), 0.3 (each pest, Mplant), 0.6 (Mlate) and `rot_cap`, each reached exactly;
  - **rounding:** x on an exact half (khoai on a village plot, full care, 25 off-target samples: Mwater = 0.9375 exactly, x = 187.5 → 188); the floor binding (ớt picking 3 with every factor at its cap: x ≈ 0.6, kg = 2); the floors 20 (khoai), 15 (bắp) and 3 / 3 / 2 (ớt's 40 / 35 / 25).
- **`crop-cases.json`** gains two rice cases with `parts: [[h, kg], …]`: six cuts across an overripe stretch, part i paying `partKg(i, Y(h))`.
- **The expectations:** the plan computes each once and checks two by hand; after that both sides must agree.

**SQL smoke** (`tests/sql/v15-2-smoke.sql`, on the throwaway PostgreSQL 18 cluster):
- **Run order:** replay `0004`…`0016`; run the v14, v15, anti-cheat and v15.2 smokes; replay `0016` and re-run `v15-2-smoke.sql`.
- **Edits to the earlier smokes:** `v15-smoke.sql` and `anticheat-smoke.sql` harvest rice with 6 `harvest_part` rounds.
- **Config:** the seeded rows equal the fixtures' `crops`, and the §8.2 checks hold. The upland `cases` and `edges` replay through `_up_phase`, `_up_pests` and `_up_yield`, and the rice parts through `_part_kg`.
- **Beds:**
  - every method, from `prepare_beds` to planting; water, fertilizer, tend; a pest fired and treated; three ớt pickings with time travel; `sell_produce` and its ledger row;
  - `wrong crop` (soak on beds, `harvest_part` on beds), `need water`, `crop exists`, `wrong phase`;
  - the lease end (R26): with picking 1 taken, `_field_open` after the end removes the crop and the lease, pickings 2 and 3 with them, and `produce_stock` keeps picking 1;
  - `begin_work` for a picking or a transplant with 4 s left → `lease ending`, with 5 s allowed; a picking claimed after the end → `not your plot`, nothing added.
- **Parts:**
  - no sickle → `no sickle`; care while partly cut → `harvesting`;
  - `harvest_part(true)` at 7.9 s → `too fast`; at 8 s part 1 pays `Y / 6` kg of wet rice (integer division); six parts at a constant Y sum to Y; a later overripe part is smaller;
  - the 120 s window (R6): a claim at 120 s is accepted, at 121 s it is `work expired`, and with no record it is `too fast`;
  - replacement: a second `begin_work` 5 s after the first restarts the gate, so a claim 9 s after the first is `too fast` and 13 s after is accepted;
  - recovery after Esc or a disconnect: an unclaimed record blocks nothing; 200 s later a new `begin_work` succeeds and its part is accepted 8 s on;
  - the lease gate (R11): `begin_work` with 9 s left → `lease ending`, with 10 s allowed; that round's claim after the lease runs out → `not your plot`, with the crop and the lease gone and no rice added;
  - `false` and null cut nothing, clear `work` and skip the gate;
  - the sixth part deletes the crop and the lease; the fallen-rice sweep drops the uncut parts.
- **Harvester:**
  - 500 × the remaining parts, with a `harvester` ledger row; `lease ends` in the lease's last 30 s;
  - `harvester busy` (R32) on `begin_work`, care and abandon, and on a hand part whose round began before the rent (no rice added);
  - `_field_open` at +30 s pays only the remaining parts, `Y − floor(n·Y/6)` at Y(`harvester_until`), and ends the lease; after 2 hand parts at a constant Y, hand plus machine is exactly Y; a second `_field_open` pays nothing;
  - a partly cut plot works; a wiped farmer is not paid.
- **Tools:**
  - `buy_farm_item('tool_sickle', 2)` → a plain `invalid quantity`; a second sickle → `already owned`; the gift gives the sickle once;
  - `load_sprayer` without a sprayer → `no sprayer`; a load takes 1 bottle for 3 charges; a matching spray uses a charge and leaves the bag alone; a mismatched spray uses a bottle; a reload replaces;
  - the tank check (R21): the third charge leaves (null, 0) and the next spray uses a bottle; writing (item, 0) or (null, 2) raises `check_violation`; with the check dropped, such rows written and `0016` replayed, they read (null, 0) and the check is back.
- **Anti-cheat:** envelopes for `tend_crop('x')` and `sell_produce` with kg 0; the guard file with the 7 new RPCs, each refused while locked; a wipe clears `produce_stock` and the tank.

**Components and hooks** (RTL, `afterEach(cleanup)`):
- **PlotPanel:** the two làm-đất buttons; bed actions and their reasons; "Đã gặt 2/6 phần" with only Gặt tiếp and Bỏ vụ; the harvester countdown.
- **HarvestGame:** Space and pointer; the typing guard; Esc sends nothing, and the next round calls `begin_work` again; a success calls `harvest_part(true)` no earlier than 9 s (fake timers); a failure calls `false` at once and shows "Thử lại"; the `too fast` and `not your plot` refusals show the §13.2 texts.
- **Panels:** the CoopPanel "Máy gặt" tab (pro-rated price, confirm, refusals); FarmShopPanel tools; RiceDepotPanel produce rows; the BagPanel tank ("Bình phun — trống" after the last charge) and reload confirm; FarmTasks countdowns; the Handbook tabs.
- **Hooks:** `useFarmController` (a round re-sends `fa` every 2 s; the harvester refetch at +1 s sends `fp`; the completion toast shows the wet-stock change) and `useField` (the new calls).

**Integration** (skipped without `SUPABASE_TEST_URL`): anon can read `upland_crops`; in log mode, `sell_produce` with kg 0 returns an envelope with `strike: 0`.

**Manual pass** (the owner, after `0016`, with two accounts): a khoai, a bắp and an ớt season (three pickings); a rice plot cut 3 parts by hand, then finished by the harvester; a failed round, then a retry; the sprayer load, reload and spray; the phone layout of the overlay and the bag.

## 17. Out of scope

- **v15.3:** crabs, snails, containers, the transplant and crab minigames, and the transplant-quality question.
- **Later:** a soft counter for parts claimed under 9 s (§11.5); more crops such as đậu, mè and dưa hấu, each a config row.
- **Not in v15.2:** machine transplanting or planting, a harvester for hoa màu, a limited machine pool; tool wear, upgrades or resale, a bigger tank; rotation bonuses, soil fertility, drying or price changes for hoa màu; telling an absent farmer that a harvester finished.
