# Music Together v15 — "Đồng ruộng": rice farming, land and field gathering (Design)

**Date:** 2026-09-25
**Builds on:** `main` @ `cd32174`. That commit has v13 (game mode), v14 (fishing pond, xu economy) and the lyrics/karaoke line from PR #10. v15 is developed on `feat/v15-field`. The stack is unchanged: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth and SECURITY DEFINER RPCs.
**Roadmap:** v13 = game mode + hall → v14 = fishing pond + xu economy → **v15 = rice paddies, land, crabs and snails (this doc)** → v16 = the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná).

## 1. Goal

v15 adds a third map, **Đồng ruộng**, to the room world. On it players:

1. **Farm wet rice** through a realistic cycle:
   - prepare the field, apply base fertilizer, soak the seed, sow a seedbed;
   - transplant, top-dress twice with the right fertilizer, manage the water level stage by stage;
   - treat pests with the right remedy;
   - harvest, dry the rice and sell it.

   A cycle (vụ) takes about three real days. The **Sổ tay nhà nông** (farmer's handbook) teaches every step.
2. **Hold land**:
   - rent a village plot for one season;
   - buy a private plot;
   - lease a private plot to other players;
   - sell it to another player at a negotiated price, or back to the village.

   The village reclaims land from owners who stopped coming.
3. **Gather crabs and snails** in the canal by hand and carry more in a bucket or a basket. This comes in the second phase (§4).

It also includes three minigames: transplanting, harvesting and crab-grabbing (second phase). The server stays authoritative, as in v14: every timer, roll, price, balance and ownership change happens in SECURITY DEFINER RPCs.

## 2. Decisions (brainstorm 2026-09-25)

| # | Question | Ruling |
|---|---|---|
| 1 | Version split | v15 = rice + land + crabs/snails; v16 = rat hunt + dog + slingshot (B) |
| 2 | Where land lives | Each room has one shared field map with a fixed set of plots. A plot belongs to an account *in that room*, and everyone sees everyone's rice. Xu and items stay account-wide, as in v14 (A) |
| 3 | How to get land | Rent a village plot per season. Buy a private plot. Owners may lease their plot to others and sell it to another player at a negotiated price. Newcomers rent; wealthy players buy (B + negotiated sales) |
| 4 | Cycle length | About 3 real days per season. Each plot runs its own clock, rice grows while you are offline, care windows are hours wide, and a missed window costs yield, never the whole crop (B) |
| 5 | Realism | Full: soaking, a seedbed, transplanting, base fertilizer, two top-dressings with the right fertilizer types, water level per stage, several varieties, drying, and four pests each with its own remedy (C) |
| 6 | Crab/snail containers | Their own containers (hands 3, bucket 15, basket 30), separate from the v14 fish bucket. Sold at the rice depot (A) |
| 7 | Farm actions | Actions with an animation and a progress bar, plus three minigames: transplanting, harvesting and crab-grabbing (B) |
| 8 | Absent owners | Absent 14 days in a row (no visit to the room) → the village reclaims the plot and refunds 50 % of the list price. A plot on lease is reclaimed when the lease ends. The owner may sell back to the village for 50 % at any time, and may sell to another player at a negotiated price |
| 9 | Timing architecture | Lazy server evaluation: plots store timestamps and logs, pests are pre-rolled and hidden at sowing, and state is computed on read. No cron (A) |

Clarifications made while writing this spec. The owner should confirm them during the spec review:

- **a) "Visiting the room".** Returning members never call `join_room` (the join gate only shows for non-members). So v15 adds `touch_room(room)`, which the room page calls once when it opens; every farm RPC touches the row too. The 14-day rule uses `members.last_seen_at`.
- **b) Water is handled at the plot.** The pump house by the canal is decoration: you pump water in or drain it standing at your plot.
- **c) Pests.** Each crop has three pest *chances* (§8.5), so 0–3 outbreaks happen, about 1.2 on average.
- **d) When you can harvest.** Only once the rice is ripe (§8.2). Harvesting during ripening is refused.
- **e) Water scoring.** The water penalty is sampled every 15 minutes of crop time.
- **f) Minigame trust.** The 2-second work gate exists from `0013` on. v15.1 ignores the reported quality and uses 1.0 (anti-cheat decision D1); v15.2 decides how a minigame quality comes back, which needs an SQL change.
- **g) Drying keeps the weight.** Drying changes the price, not the kilograms.
- **h) Farming limit.** An account farms at most **2 plots at once per room**. An unleased private plot of your own counts; a plot you have leased out does not.
- **i) Newcomer gift.** Given once per account, not once per room.
- **j) Removed owners.** An owner who is no longer a member of the room loses the plot at once, under the same reclaim rules.

## 3. Constraints

- Everything in the v13 and v14 constraints still holds:
  - the free-plan Realtime limits;
  - the public repo, so art is original and drawn in code;
  - themes and `.game-ui`;
  - RPC-only writes;
  - Vietnamese UI with `vi-VN` numbers;
  - "per day" rules on the `Asia/Ho_Chi_Minh` calendar.
- **Migrations:** v15.1 is `0013_v15_field.sql` and v15.2 is `0016_v15_gather.sql` (`0014` is the lyrics hotfix and `0015` the anti-cheat layer, see the anti-cheat spec, D7). Each is additive and re-runnable: `if not exists`, `create or replace`, `drop … if exists`, and seeds use `on conflict do update`. The owner runs them in the Supabase SQL editor.
- **The field map is 800 × 480 world px** (cell 8). The v13 camera and view code (`computeView`, `cameraFor`) already scroll any map size. The first map task confirms this at 800 × 480 on desktop and phone view sizes.
- **Time:** every time rule lives in a private SQL function that takes `p_now`, and the public RPCs pass `now()`. Tests move time by calling the private functions. No client can set the time.
- **Test baseline** at `cd32174`: `pnpm test` → 70 files passed / 9 skipped, 502 tests passed / 54 skipped. `tsc` is clean. The plan records the lint baseline.

## 4. Phases

One spec, two plans, and the owner ships after each phase.

**v15.1 "Ruộng lúa"**
- The field map, the portals from the hall and the pond, and presence `field`.
- Land: rent, buy, sell back, list, offer, accept, sublease, lease expiry, reclaim.
- The full rice cycle (§8), with transplanting and harvesting as plain 3-second progress actions sent with quality 1.0.
- Farm shop, rice depot, drying yard, handbook, HUD task list, newcomer gift.
- The fishing clock fix (v14 M-3, §11.6).

**v15.2 "Đồng vui"**
- The three minigames. Transplanting and harvesting then send a real quality score.
- Crab holes and snail beds, the critter containers, and selling crabs and snails.
- Pest snails picked from plots now land in your container.

## 5. Architecture

```
components/game/GameShell.tsx          + useFarmController; field panels; HUD "🌾 Việc đồng áng"
 ├─ <GameCanvas mapId="field" …>       engine.setPlots(views) draws each plot's rice, water and pests
 ├─ hooks/useField.ts                  field_state for this room, actions, refetch on `fp`, server clock
 ├─ hooks/useFarmController.ts         prompts, panels, due tasks, gift, animations (`fa`)
 └─ components/game/farm/*             CoopPanel, FarmShopPanel, RiceDepotPanel, PlotPanel, DryingPanel,
                                       Handbook, FarmTasks; v15.2: TransplantGame, HarvestGame, CrabGame
lib/game/farm/                         pure: catalog, crop (schedule, water, pests-visible, yield preview, due tasks),
                                       land (rules), state (parse field_state), messages (Vietnamese), rpc, clock
lib/game/maps/field.ts, field-art.ts   the map (collision, plots, spots, NPCs) and its painter
lib/game/art/crops.ts, farm-icons.ts   crop stage painters, pest overlays; icons for seeds, fertilizers, pesticides,
                                       rice, containers, crabs, snails
supabase/migrations/0013_v15_field.sql, 0016_v15_gather.sql
```

The data flow is the v14 shape. The client calls an RPC, and every RPC answers with the full state it touched: `field_state` for the room, including "mine". Local visuals update at once. Other players get an `fp` message and refetch.

## 6. Maps and travel

### 6.1 Map id

- `MapId` becomes `"hall" | "pond" | "field"`.
- The registry builds and paints the field (`buildFieldMap`, `paintField`).
- Presence `map` accepts `"field"`.
- `mapCounts` and the `MapCounts` chip gain "🌾 Đồng".
- Unknown map values from old clients still count as the hall.
- `aggregatePresenceModes` and the registry become exhaustive switches over `MapId` (v14 deferred T9/T10), so a missing case is a type error.

### 6.2 Field map — `lib/game/maps/field.ts` (800 × 480, cell 8)

The layout is approximate. The map tests pin the invariants (§17), and the plan fixes the exact numbers.

- **North band** (y 0–40): bamboo and coconut palms, blocked.
- **West entrance, "Đường làng":** a dirt road from the hall. The portal sign **"Về sảnh"** stands near (40, 96). You arrive here from the hall facing right.
- **East entrance, "Cầu khỉ":** a monkey bridge to the pond. The portal sign **"Về ao cá"** stands near (776, 250). You arrive here from the pond facing left.
- **Mương (canal):** runs across the map at y ≈ 176–208, from x 60 to x 760. It is water, so blocked, except two plank bridges at x ≈ 200 and x ≈ 560. A decorative pump house (cống) sits at its west end.
- **Private plots 1–4** ("Đất tư"): one row north of the canal, each ≈ 128 × 96, separated by 24-px dikes. Each has a name post that shows the owner.
- **Village plots 5–10** ("Đất làng"): two rows of three south of the canal, each ≈ 128 × 76.
- **Buildings and NPCs:**

  | Building | Where | NPC | Look |
  |---|---|---|---|
  | **Hợp tác xã** office | north-east (≈ 690–790 × 50–150) | **chú Tám** | brown shirt, nón lá |
  | **Tiệm vật tư nông nghiệp** | south-east | **anh Hai** | blue shirt, cap |
  | **Vựa lúa** | south-east | **cô Út** | áo bà ba, khăn rằn |

  The three new looks go in `lib/game/look.ts`.
- **Sân phơi** (drying yard): south-east, with 4 marked drying slots.
- **Where you stand to act:** every plot has a use spot on an adjacent dike, facing the plot. Each NPC, the drying yard and each portal has one use spot.
- **v15.2 gathering spots:** 6 crab holes along the canal banks, at least 40 px apart and each with a use spot on the bank, and 4 snail beds at the canal's shallow edges.
- **Walkability:** dikes, bridges, roads and yards are walkable. Plot interiors are **walkable**, so you can step into your paddy, and the collision grid does not block them. Water in the canal is blocked.

### 6.3 New portals on the existing maps

- **Hall:** a new sign **"Ra đồng"** on the west edge, near (40, 250), between palm A and palm B, with `kind: "portal"` and `to: field/west`. Coming back you stand at its use spot, facing left.
- **Pond:** a new sign **"Cầu khỉ ra đồng"** at the south-west, near (190, 370), with `to: field/east`. Coming back you stand at its use spot, facing down.
- **Placement:** the plan picks exact coordinates. Both signs must be clear of the existing solids and props, and the v13/v14 tests plus new travel tests pin them.
- **Arrival spots:** the new ones join `lib/game/maps/arrivals.ts`, so maps still never import each other.

### 6.4 Travel

Travel is unchanged from v14 §5.4 (fade, presence map, the cast is cancelled before travelling). The field adds only new portal targets.

## 7. Land

### 7.1 Plots

- Each room has 10 rows in `field_plots`, created lazily the first time anyone calls `field_state` for the room:
  - numbers 1–4 are `private`;
  - numbers 5–10 are `village`.
- **The farmer of a plot** is decided in this order:
  1. The holder of an active lease, if there is one.
  2. Otherwise, for a private plot, its owner.
  3. Otherwise nobody.

  Only the farmer may do farm actions on the plot. The one exception is picking snails (§8.5).
- **Farming limit:** at most **2** plots per account per room where the account is the farmer. Renting, subleasing, buying from the village and buying a listed plot all check it (`farm limit`).

### 7.2 Village plots (rent)

- **Rent:** `rent_plot(room, plot)` rents a village plot with no active lease for **10 000 xu**. The lease lasts **96 hours** (`lease_until = now + 96 h`) with `source = 'village'`, and the rent goes to the village (a sink).
- **Harvest ends the lease early**, and the plot is free for the next renter.
- **Lease expiry** is checked lazily (§7.7). An unharvested crop of the leaseholder is lost, and the HUD warns 12 h and 3 h before.

### 7.3 Private plots

- **Buy from the village:** `buy_plot(room, plot)` buys an ownerless private plot for the **list price of 800 000 xu**. You may own at most **1 private plot per room**. Private land gives **+10 % yield** and costs no rent.
- **Sell back to the village:** `sell_plot_to_village(room, plot)` pays the owner **400 000 xu**, 50 % of the list price, whatever the owner paid.
  - It is refused while the owner is the farmer of a live crop on the plot: harvest or abandon first.
  - If the plot is on lease, the village pays now and takes the plot when the lease ends. The rent already paid stays with the old owner.
- **Sublease:**
  - `set_sublease(room, plot, price | null)` lets the owner offer the plot for one season at **1–100 000 xu**. It is only allowed while the plot has no crop and no active lease; `null` withdraws the offer.
  - `rent_sublease(room, plot, expected_price)`:
    - the renter pays the owner (`lease_pay` / `lease_income`);
    - the lease runs 96 h with `source = 'owner'`;
    - the sublease price is cleared, and the owner re-offers after the season.
  - `expected_price` must equal the current price, so a price change between showing and clicking cannot catch the renter out.
- **Sale listing:** `list_plot(room, plot, price | null)` lets the owner list the plot at **1–5 000 000 xu**, visible to every member. It is only allowed while the plot has no crop and no lease.
- **Farming withdraws the offers.** When the owner prepares their own plot, any sale listing and sublease price on it are withdrawn. Pending purchase offers stay, but `accept_offer` is refused while a crop exists.
- **Buy a listed plot:** `buy_listed_plot(room, plot, expected_price)`. The buyer must:
  - not be the owner;
  - own no private plot in the room;
  - have enough xu;
  - offer exactly the listed price.

  The plot must have no crop and no lease.
- **Offers:**
  - `offer_plot(room, plot, price)`: any member except the owner may offer **1–5 000 000 xu**. There is one offer per buyer per plot (a new offer replaces the old one), and it expires after **24 h**.
  - `withdraw_offer` belongs to the buyer; `decline_offer` belongs to the owner.
  - `accept_offer(room, offer)` is the owner's, and it checks the buyer's funds and plot limit *at acceptance*. Offers do not reserve xu.
- **A completed sale runs in one transaction**, with the plot row locked `for update` so concurrent buyers cannot both succeed:
  1. the buyer pays and the seller receives (`land_buy` / `land_sell`);
  2. the owner changes;
  3. the listing and sublease price are cleared;
  4. all offers on the plot are deleted;
  5. a chat announcement is posted (§7.8).

### 7.4 Abandoning

`abandon_crop(room, plot)` lets the farmer delete the crop and leave the plot bare. Rent is not refunded, and a leaseholder may prepare and plant again while the lease lasts.

### 7.5 Last seen

- `members.last_seen_at timestamptz`: when it is null, `joined_at` counts instead.
- `touch_room(room)` sets it to `now()` for a member. The room page calls it once on open, in classic and game mode alike.
- `_farm_auth`, used by every farm RPC, also touches it.

### 7.6 Reclaim

A private plot is reclaimed when its owner O **is no longer a member of the room** or has **`last_seen_at` older than 14 days**:

- If a lease with `source = 'owner'` is active, the reclaim waits for it to end.
- Otherwise:
  1. O's crop on the plot is deleted;
  2. the sale listing and sublease price are cleared;
  3. all offers on the plot are deleted;
  4. the owner is cleared;
  5. O is paid **400 000 xu** (`land_refund`).

### 7.7 The sweep

`_field_sweep(room, p_now)` runs at the start of `field_state` and of every land and farm RPC for the room:

- ends expired leases and deletes the leaseholder's crop;
- expires offers older than 24 h;
- runs reclaims (§7.6);
- rots unsown sprouted seed older than 24 h (§8.2);
- clears crops whose ripe window ended more than 48 h ago (the grain has all fallen);
- auto-collects drying batches ready more than 24 h ago.

The sweep is idempotent and cheap: 10 plots and 4 drying slots per room.

### 7.8 Announcements

A completed player-to-player sale posts one chat message in the room:
- author: `account_id = null`, username **"Hợp tác xã"**;
- body: `[land:<plot>] 🏡 {buyer} đã mua thửa {n} của {seller} với giá {1.230 xu}.`

The classic chat renders it as a system line, like the v14 catch line. The announcement parser generalises to both prefixes, each with its own author name. It stays spoof-safe: a null author plus the reserved name plus the prefix.

## 8. Rice

### 8.1 Varieties (seed of `rice_varieties`)

| id | Name | Scale `s` | Ripe after ≈ | Base yield | xu/kg (dry) | Blast factor |
|---|---|---|---|---|---|---|
| `short` | Lúa ngắn ngày | 0.9 | 52 h | 90 kg | 710 | 1.0 |
| `nep` | Nếp | 1.0 | 58 h | 75 kg | 950 | 1.0 |
| `thom` | Lúa thơm | 1.15 | 66 h | 60 kg | 1 350 | 1.3 |

"Ripe after" counts from soaking with prompt actions: 2 h + 56 h × `s`.

### 8.2 Phases and timings

A crop row starts when the farmer **prepares** the plot (làm đất). Times below are in hours. `s` is the variety scale, and `T` is the time since transplanting.

| Phase | Starts | Ends | Farmer can |
|---|---|---|---|
| `prepared` | `prepare` | soaking starts | base-fertilize, soak |
| `soaking` | `soak` | +2 h (sprouted) | base-fertilize |
| `sprouted` | soak + 2 h | `sow`, or rots at +24 h | sow (no penalty until +6 h; −3 %/h after, cap −30 %) |
| `seedling` | `sow` | `transplant` | transplant once the seedlings are ≥ 8·s old; after 14·s they are old, −3 %/h, cap −30 % |
| `tillering` | T = 0 | T = 18·s | top-dress 1 on time at T ∈ [2·s, 10·s]; phơi ruộng in the last 4·s |
| `panicle` | 18·s | 30·s | top-dress 2 on time at T ∈ [18·s, 24·s] |
| `heading` | 30·s | 40·s | — |
| `ripening` | 40·s | 48·s | drain |
| `ripe` | 48·s | 48·s + 12 h | harvest, no penalty |
| overripe | 48·s + 12 h | +48 h after ripe → lost | harvest at −2 %/h, cap −60 % |

- Soaking may begin before or after preparing, but **sowing needs a prepared plot**.
- Pumping, draining, spraying and picking snails are allowed in any phase from `prepared` to overripe.
- Harvesting is only allowed from `ripe` on.
- If sprouted seed is not sown within 24 h, it rots: the crop goes back to `prepared`, the seed is lost, and the handbook explains why.

### 8.3 Water

- **Levels:** `0` khô, `1` ẩm, `2` nông, `3` sâu.
- **Storage:** the crop keeps a `water_log` of `[t, level]` entries.
- **Level at time t:** `max(0, L − floor((t − t_L) / 12 h))`, where `(t_L, L)` is the last entry at or before t. Water drops one level every 12 h through evaporation and seepage.
- **Actions:**
  - `prepare` sets 3 (flooded).
  - `water(+1)` pumps in, up to 3; `water(−1)` drains, down to 0.
  - Both act on the *current* level and append an entry.
- **Accepted levels per phase:**

| Phase | Accepted | Shown as |
|---|---|---|
| seedling | 1 | "Ẩm" |
| tillering, T < 14·s | 2 | "Nông" |
| tillering, last 4·s | 0–2 | "Phơi ruộng (rút cạn tốt hơn)" |
| panicle, heading | 2–3 | "Nông–Sâu (tốt nhất Sâu)" |
| ripening, ripe, overripe | 0–1 | "Rút nước" |

- **Off-target hours:** from sowing to harvest, or to now for a preview, the level is sampled every 15 min. Each sample outside the accepted set adds 0.25 h.
- **Phơi ruộng bonus:** earned if the level at the end of tillering (T = 18·s) is ≤ 1.

### 8.4 Fertilizers

| Item | Kind | Correct use |
|---|---|---|
| `fert_manure` Phân chuồng hoai | base | any time from `prepared` to before transplanting |
| `fert_phosphate` Phân lân | base | same |
| `fert_urea` Phân urê | N | top-dress 1 (tillering) |
| `fert_potash` Phân kali | K | top-dress 2 (panicle) |
| `fert_npk` Phân NPK 20-20-15 | N + K | either top-dress |

- **Base fertilizer:** each one applied before transplanting removes its −5 % penalty. After transplanting a base fertilizer is wasted.
- **Top-dress 1** (during tillering) scores:
  - *on time*: urea or NPK at T ∈ [2·s, 10·s];
  - *half*: urea or NPK elsewhere in tillering, or potash at any time in tillering;
  - *missing*: nothing applied.
- **Top-dress 2** (during panicle) scores:
  - *on time*: potash or NPK at T ∈ [18·s, 24·s];
  - *half*: potash or NPK later in panicle, or urea at any time in panicle;
  - *missing*: nothing applied.
- **Repeats:** only the best application of each top-dress counts.
- **Excess nitrogen (dư đạm)** is set by any of:
  - urea during panicle;
  - a second N application (urea or NPK) inside tillering or inside panicle;
  - any N from heading on.

  Its effects:
  - **pest chances due after it** are ×1.5;
  - **lodging** costs −10 % at harvest.
- **Any other fertilizer use** (outside these windows) is wasted, and the plot panel says so before you confirm.

### 8.5 Pests

At sowing the server stores three hidden rolls, `pest_rolls: [{slot, u_time, u_kind, u_hit}]`, each drawn uniform from [0, 1).

**Slots:**

- **S1: golden apple snail** (ốc bươu vàng).
  - Due at transplant + `u_time` · 8·s.
  - Hit chance: 0.35, ×2 if the water at the due time is 3, ×0 if it is ≤ 1. Capped at 0.7.
- **S2:** window T ∈ [6·s, 26·s], due at its start + `u_time` × the window length.
  - Hit chance: 0.45, ×1.5 with excess N. Capped at 0.9.
  - Kind: **đạo ôn lá** (leaf blast) if `u_kind` < 0.4 × the variety's blast factor, otherwise **sâu cuốn lá** (leaf folder).
- **S3:** window T ∈ [20·s, 38·s], due the same way as S2.
  - Hit chance: 0.40, ×1.5 with excess N.
  - Kind: **đạo ôn cổ bông** (neck blast) if `u_kind` < 0.4 × the blast factor, otherwise **rầy nâu** (brown planthopper).

**When a slot fires:** a slot is evaluated only once `p_now` passes its due time. It *hits* if `u_hit` < its chance at the due time. A hit becomes an **active pest** from the due time until it is treated or the crop is harvested. Hidden rolls are never sent to clients. Only hits whose due time has passed appear in `field_state`.

**Remedies:**

| Pest | Remedy |
|---|---|
| Ốc bươu vàng | `pick_snails`, which **anyone** may do on any plot. While the water is ≤ 1 the snails do no damage. |
| Sâu cuốn lá | `spray_insect` Thuốc trừ sâu |
| Rầy nâu | `spray_hopper` Thuốc trừ rầy |
| Đạo ôn lá, đạo ôn cổ bông | `spray_fungus` Thuốc trừ bệnh |

- A spray with the right remedy while the pest is active treats it at that time.
- A wrong spray, or a spray with no active pest, is wasted. The plot panel warns first.

**Damage:** each active pest costs 1.5 % per active hour, capped at 30 % per pest. For snails, only hours with water ≥ 2 count.

### 8.6 Yield

```
kg = max(ceil(0.1 · base), round(base · land · Mcare · Mseed · Mwater · Mpest · Mlate · qT · qH))
```

| Factor | Value |
|---|---|
| `land` | 1.10 on a private plot, 1.00 on a village plot |
| `Mcare` | 1 − (manure missing 0.05 + phosphate missing 0.05 + top-dress 1 [0 / 0.10 half / 0.20 missing] + top-dress 2 [same] + phơi ruộng missing 0.05 + lodging 0.10 if excess N) |
| `Mseed` | 1 − min(0.3, 0.03 · hours sown late) − min(0.3, 0.03 · hours transplanted with old seedlings) |
| `Mwater` | 1 − min(0.2, 0.01 · off-target hours) |
| `Mpest` | Π over pests of (1 − min(0.3, 0.015 · active hours)) |
| `Mlate` | 1 − min(0.6, 0.02 · hours after the ripe window) |
| `qT`, `qH` | transplant and harvest quality; always 1.0 in v15.1 (the server ignores the reported value, D1) |

**Two implementations of one formula:**
- The server computes the yield at harvest (`_crop_yield(crop, p_now)`).
- `lib/game/farm/crop.ts` implements the same formula for the plot panel's **estimate**. The estimate cannot count hidden pests; the panel labels it "ước tính".
- A shared fixture set (§17) pins both implementations to the same numbers.

### 8.7 Harvest, drying and selling

- **Harvest:**
  - `harvest(room, plot, quality)` needs `ripe` or later, plus the work gate (§11.4).
  - It adds the yield as **wet** rice of the variety to the farmer's `rice_stock`, deletes the crop, leaves the plot bare, and ends a lease.
- **Drying:**
  - `dry_start(room, variety, kg)` moves wet rice to a free drying slot. There is one batch per slot, of any positive kg up to the wet stock.
  - The batch is ready after **3 h**, and `dry_collect(room, slot)` moves it to dry stock.
  - Everyone sees the slots ("Lúa của A đang phơi — còn 1 giờ").
  - The sweep auto-collects a batch 24 h after it is ready.
- **Selling:**
  - `sell_rice(variety, dry, kg)` at cô Út pays `floor(kg · price_per_kg · (dry ? 1 : 0.7))` (`rice_sell`).
  - The panel offers "Bán hết" per variety and state.

### 8.8 Newcomer gift

`claim_farm_gift()` gives 1 `seed_short` and 1 `fert_urea` once per account (`farm_profiles.gift_at`). The client calls it on the first field visit and shows chú Tám's greeting toast: "🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày và 1 bao urê — xem Sổ tay nhà nông nhé!"

### 8.9 Handbook — Sổ tay nhà nông

A parchment modal with six tabs, all static Vietnamese text in `lib/game/farm/messages.ts`:

1. **Quy trình**: the 11 steps with times per variety.
2. **Phân bón**: the §8.4 table in plain words.
3. **Sâu bệnh**: each pest, its sign on the plot and its remedy.
4. **Nước**: the §8.3 table and the 12 h drop.
5. **Giống lúa**: §8.1.
6. **Mẹo**: e.g. drain to stop snails, NPK is the safe choice, don't over-fertilize with nitrogen.

The plot panel links to the relevant tab.

## 9. Items (seed rows in `shop_items`)

- **New columns on `shop_items`** (all nullable):
  - `variety` (seed);
  - `fert` in (`manure`, `phosphate`, `urea`, `potash`, `npk`);
  - `pest_target` in (`insect`, `hopper`, `fungus`).
- **The `kind` check** is replaced to also allow `seed`, `fertilizer`, `pesticide` and `critter_box`.
- **Farm consumables** stack in `inventory` up to **99** each. A purchase that would go past 99 is refused (`invalid quantity`).

| id | kind | Name | Price |
|---|---|---|---|
| `seed_short` | seed | Giống lúa ngắn ngày | 600 |
| `seed_nep` | seed | Giống nếp | 900 |
| `seed_thom` | seed | Giống lúa thơm | 1 500 |
| `fert_manure` | fertilizer | Phân chuồng hoai | 400 |
| `fert_phosphate` | fertilizer | Phân lân | 500 |
| `fert_urea` | fertilizer | Phân urê | 600 |
| `fert_potash` | fertilizer | Phân kali | 600 |
| `fert_npk` | fertilizer | Phân NPK | 900 |
| `spray_insect` | pesticide | Thuốc trừ sâu | 700 |
| `spray_hopper` | pesticide | Thuốc trừ rầy | 800 |
| `spray_fungus` | pesticide | Thuốc trừ bệnh | 900 |
| `box_bucket` (v15.2) | critter_box | Xô nhựa | 150, capacity 15 |
| `box_basket` (v15.2) | critter_box | Giỏ tre | 600, capacity 30 |

**Buying:**
- Farm items are bought with `buy_farm_item(item, qty)` at anh Hai: consumables take qty 1–99; containers are bought once, like v14 gear.
- v14's `buy_item` is redefined to refuse every non-fishing kind with `item not available`.
- v14's `_fishing_state.owned` is filtered to fishing kinds, so farm items never show in the fishing bag.

## 10. Economy check

Reference point: in v14 a skilled angler earns about 1 000–1 800 xu per active hour.

The farm numbers changed on 2026-09-25 (rent 10 000, plot 800 000, inputs ×10, rice 710 / 950 / 1 350 xu/kg). The per-variety profits, the poor-care and lost-crop cases and the time to buy land are in `2026-09-25-music-together-economy-design.md` §4.

**Crabs and snails (v15.2):**

| Item | Price |
|---|---|
| Cua đồng | 12 |
| Cua gạch (10 %) | 45 |
| Ốc đồng | 8 |
| Ốc bươu vàng | 2 |

- A full round of 6 crab holes every 20 min earns ≈ 800 xu/h, below fishing and without gear.
- Snails are a side activity, ≈ 240 xu/h.

All prices live in config tables, so tuning is a data change.

## 11. Server — `0013_v15_field.sql`

### 11.1 Tables

All new tables have RLS on and no policies, except the config tables, which get a `select` policy for anon. Private tables get `revoke all from anon, authenticated`.

| Table | Key columns |
|---|---|
| `rice_varieties` (config) | `id`, `name`, `scale`, `base_kg`, `price_per_kg`, `blast_mult`, `sort_order` |
| `field_plots` | `room_id`, `plot_no` (1–10) PK; `kind` (`private`/`village`); `owner_id`; `owned_at`; `sale_price`; `sublease_price` |
| `plot_leases` | `room_id`, `plot_no` PK (≤ 1 active); `farmer_id`; `source` (`village`/`owner`); `price`; `starts_at`; `until` |
| `land_offers` | `id`; `room_id`, `plot_no`; `buyer_id`; `price`; `created_at`; unique (`room_id`, `plot_no`, `buyer_id`) |
| `crops` | `room_id`, `plot_no` PK; `farmer_id`; `variety`; `prepared_at`; `soak_at`; `sow_at`; `transplant_at`; `water_log jsonb`; `fert_log jsonb`; `spray_log jsonb`; `picks jsonb`; `pest_rolls jsonb` (secret); `work` + `work_started_at`; `q_transplant` |
| `drying_slots` | `room_id`, `slot` (1–4) PK; `account_id`; `variety`; `kg`; `ready_at` |
| `rice_stock` | `account_id`, `variety` PK; `wet_kg`; `dry_kg` (≥ 0) |
| `farm_profiles` | `account_id` PK; `gift_at` |
| `members` (altered) | `add column if not exists last_seen_at timestamptz` |
| `coin_ledger` (altered) | the `reason` check is replaced to add `rent`, `land_buy`, `land_sell`, `land_refund`, `lease_pay`, `lease_income`, `farm_buy`, `rice_sell` (v15.2 adds `critter_sell`) |

### 11.2 Private helpers (all revoked from `public`, `anon`, `authenticated`)

| Helper | Purpose |
|---|---|
| `_farm_auth(room, token)` | runs `_auth(room, token, 'any')`, touches `last_seen_at`, returns the account |
| `_field_init(room)` | inserts the 10 plots if missing |
| `_field_sweep(room, p_now)` | §7.7 |
| `_farmer(room, plot, p_now)` | the farmer (§7.1) |
| `_farm_count(room, account, p_now)` | the farming limit |
| `_water_at(log, t)` | the water level at time t |
| `_phase(crop, variety, p_now)` | the phase (§8.2) |
| `_pests(crop, variety, p_now)` | revealed pests with their active hours |
| `_care(crop, variety)` | the top-dress scores and the excess-N flag |
| `_crop_yield(crop, variety, land_mult, p_now)` | §8.6 |
| `_plot_view(room, plot, viewer, p_now)` | the public JSON of one plot, plus the private log when the viewer is its farmer |
| `_field_view(room, viewer, p_now)` | the full `field_state` JSON (§11.5) |
| `_farm_do_*(…, p_now)` | one per action: the logic, with `p_now` injected |

Every public RPC is a thin wrapper that passes `now()`.

### 11.3 Public RPCs

All are SECURITY DEFINER with `grant execute … to anon, authenticated`. Every mutating RPC takes the wallet lock first (v14 `_wallet_lock`) and locks the plot row `for update`. Each returns `field_state` JSON unless noted.

**Room and field:**
- `touch_room(p_room_id, p_session_token)` → void.
- `field_state(p_room_id, p_session_token)`.

**Land:**
- `rent_plot(room, token, plot)`
- `buy_plot(room, token, plot)`
- `sell_plot_to_village(room, token, plot)`
- `list_plot(room, token, plot, price)`
- `buy_listed_plot(room, token, plot, expected_price)`
- `offer_plot(room, token, plot, price)`
- `withdraw_offer(room, token, offer_id)`
- `decline_offer(room, token, offer_id)`
- `accept_offer(room, token, offer_id)`
- `set_sublease(room, token, plot, price)`
- `rent_sublease(room, token, plot, expected_price)`
- `abandon_crop(room, token, plot)`

**Farming:**
- `prepare_plot(room, token, plot)`
- `apply_fertilizer(room, token, plot, item)`
- `soak_seed(room, token, plot, item)`
- `sow_seed(room, token, plot)`
- `begin_work(room, token, plot, work)`, where `work` is `transplant` or `harvest`
- `transplant(room, token, plot, quality)`
- `water(room, token, plot, delta)`, where `delta` is +1 or −1
- `spray(room, token, plot, item)`
- `pick_snails(room, token, plot)`
- `harvest(room, token, plot, quality)`

**Drying and trade:**
- `dry_start(room, token, variety, kg)`
- `dry_collect(room, token, slot)`
- `sell_rice(token, variety, dry, kg)` → the account part of `field_state` (`mine`)
- `buy_farm_item(token, item, qty)` → `mine`
- `claim_farm_gift(token)` → `{ gifted, mine }`

### 11.4 Work gate (transplant and harvest)

1. `begin_work(plot, w)` records `work = w` and `work_started_at = now()` on the crop.
2. `transplant(…, q)` and `harvest(…, q)` require `work = w` and `now() − work_started_at ≥ 2 s`.
3. They use `q` = 1.0 whatever the client sends (v15.1, D1) and clear `work`.

v15.1 ignores the reported quality (D1), so a modified client gains nothing from it and can never work faster than the gate.

### 11.5 `field_state` JSON

```jsonc
{
  "server_now": "…",                       // every answer carries it (§11.6)
  "plots": [{
    "no": 3, "kind": "private",
    "owner": { "id": "…", "name": "Dat" } | null,
    "sale_price": 9000 | null, "sublease_price": 300 | null,
    "farmer": { "id": "…", "name": "Dat" } | null,
    "lease": { "source": "owner", "until": "…", "price": 300 } | null,
    "offers": 2,                           // count (details only in "mine")
    "crop": null | {
      "variety": "nep", "phase": "tillering",
      "prepared_at": "…", "soak_at": "…", "sow_at": "…", "transplant_at": "…",
      "water": 2, "water_set_at": "…",     // current level and when it last changed (for the 12 h drop)
      "pests": [{ "kind": "hopper", "since": "…" }],
      "excess_n": false, "ripe": false,    // "ripe" is the v16 rat hook
      "log": { … } | absent                // fert/spray/water logs, only for the farmer
    }
  }],
  "drying": [{ "slot": 1, "owner": { "id": "…", "name": "…" }, "variety": "nep", "kg": 70, "ready_at": "…" }],
  "mine": {
    "owned_plot": 3 | null, "farming": [3, 7],
    "my_offers": [{ "id": "…", "plot": 2, "price": 8000, "expires_at": "…" }],
    "incoming_offers": [{ "id": "…", "plot": 3, "buyer": { "id": "…", "name": "…" }, "price": 8500, "expires_at": "…" }],
    "items": { "seed_nep": 2, "fert_urea": 1 },   // farm consumables and owned containers
    "rice": { "nep": { "wet": 0, "dry": 70 } },
    "coins": 1230, "gift_claimed": true
  }
}
```

### 11.6 Server clock (v14 M-3)

- `field_state` and every farm answer include `server_now`. `0013` also redefines `_fishing_state` to include it.
- `lib/game/farm/clock.ts` (shared; fishing uses it too) keeps `offset = server_now − client_now_at_receipt`.
- Every countdown and window check on the client uses `Date.now() + offset`. The fishing prompts (`castBlocker`, `digWaitSec`, `castWaitMin`) switch to it.

### 11.7 Errors → Vietnamese (`farmErrorMessage`, `lib/game/farm/rpc.ts`)

| Server message | Vietnamese |
|---|---|
| `not a member` / auth | the v14 texts |
| `not your plot` | "Thửa này không phải của bạn." |
| `plot taken` | "Thửa này đã có người canh tác." |
| `farm limit` | "Bạn đang canh tác 2 thửa rồi." |
| `already own land` | "Bạn đã có đất tư trong phòng này." |
| `not for sale` | "Thửa này không rao bán." |
| `price changed` | "Giá vừa đổi — xem lại nhé." |
| `offer expired` / `offer not found` | "Đề nghị không còn nữa." |
| `crop exists` | "Đang có lúa trên thửa — gặt hoặc bỏ vụ trước." |
| `leased` | "Thửa đang cho thuê." |
| `wrong phase` | "Chưa tới lúc làm việc này." |
| `not prepared` | "Làm đất trước đã." |
| `need water` | "Mực nước chưa đúng — xem Sổ tay." (the panel names the level) |
| `no item` | "Chưa có {tên} — ghé tiệm anh Hai." |
| `drying full` | "Sân phơi đã đầy." |
| `not ready` | "Chưa xong." |
| `not enough rice` | "Không đủ lúa." |
| `not enough coins` | "Không đủ xu." |
| `invalid quantity` / `invalid price` | "Số không hợp lệ." |
| `too fast` | "Từ từ thôi…" |
| anything else | "Có lỗi, thử lại nhé." |

After an error the client refetches `field_state`, as in v14.

### 11.8 Trust model (added to the README)

**The server decides:**
- all times and phases, water levels and penalties;
- pest rolls, which stay hidden until they fire;
- prices, yields, land ownership, leases and reclaims.

**Clients only report two things:** the transplant and harvest quality, which v15.1 ignores (always 1.0, D1) behind a 2 s gate, and (v15.2) crab hits, bounded to 3 per hole visit.

## 12. Networking

- **Channel:** `game:{roomId}:field`, one channel per map, as in v14.
- **`fp` {t, id, p}:** "plot p changed", with `p = 0` meaning the drying yard or offers.
  - Sent after every successful land or farm action.
  - Receivers debounce it by 400 ms, then refetch `field_state`.
  - Rendered state always comes from the server.
- **`fa` {t, id, a}:** a farm animation code, played for 2.5 s. `a = 0` stops it.
  - Codes: 1 transplant, 2 harvest, 3 pump, 4 spray, 5 fertilize, 6 grab a crab, 7 pick snails, 8 prepare.
  - It is a control message (FIFO), and an action sends at most one.
- **Budget:**
  - Farm actions are minutes apart, and each sends ≤ 2 messages.
  - Every listener on the field refetches once per `fp`, which with 10 people is < 1 RPC/min per person in practice.
  - `touch_room` is one call per room open.

## 13. Game UI

### 13.1 HUD

- **"🌾 Việc đồng áng"** opens a list of due tasks for every plot you farm. `dueTasks(views, me, now)` is pure. Examples:
  - "Thửa 3 · Gieo mạ — còn 4 giờ"
  - "Thửa 7 · Bơm nước (đang Ẩm, cần Nông)"
  - "Thửa 7 · Rầy nâu! Xịt thuốc trừ rầy"
  - "Thửa 3 · Gặt — còn 9 giờ"
  - "Thửa 7 · Hết hạn thuê sau 5 giờ"

  A dot on the button counts urgent tasks.
- The v14 coins and bait HUD stays. While on the field it shows the rice summary instead of bait.

### 13.2 Prompts

A plot's prompt names its next action ("E · Gieo mạ thửa 3", "E · Xem thửa 5 (của Lan)"). E opens the **PlotPanel**:

- **Status:** variety, phase, time to the next phase, water now vs wanted, pests, and the yield estimate for the farmer.
- **The valid actions as buttons.** `plotActions(view, me, now)` is pure. Disabled buttons say why.
- **A link to the handbook tab.**
- For owners and renters: land actions (list, sublease, sell back, abandon).

### 13.3 Panels

All panels are parchment modals, and game input is off while one is open (v14).

- **CoopPanel (chú Tám)**, with four tabs:
  - **Đất làng**: free plots, rent 10 000 xu.
  - **Đất tư**: plots for sale by the village, 800 000 xu.
  - **Chợ đất**: player listings, subleases, and the "Đề nghị mua" form.
  - **Của tôi**: my plot, my offers, incoming offers with Đồng ý / Từ chối, sell back.
- **FarmShopPanel (anh Hai):** seeds, fertilizers, pesticides with quantity steppers; containers in v15.2. Each row shows its use in one line ("Bón thúc đẻ nhánh").
- **RiceDepotPanel (cô Út):** rice per variety, wet and dry, with "Bán" / "Bán hết" and the price; crabs and snails in v15.2.
- **DryingPanel:** the 4 slots, "Phơi lúa" (variety + kg), "Lấy lúa".
- **Handbook** (§8.9).

### 13.4 Plot visuals

`engine.setPlots(views)` draws each plot between the background and the depth-sorted props:

- the crop stage (§14);
- the water shimmer by level;
- a pest overlay;
- the owner's name post, as a text label at device resolution like name tags;
- a pulsing ring on plots with an urgent task, for the farmer only.

### 13.5 Classic view

Nothing new, apart from the land-sale system line in chat (§7.8).

## 14. Art

Everything is original and drawn in code.

- **`field-art.ts`** paints the background from a seeded RNG:
  - dikes, and the canal with a water gradient;
  - plank bridges and the monkey bridge;
  - the pump house, the HTX office, the farm shop, the rice depot and the drying yard (concrete squares);
  - bamboo, coconut, banana and grass tufts.

  The animated overlays (canal sparkles) honour reduced motion.
- **`crops.ts`** holds a procedural painter per phase. Each takes the plot rect, the phase progress in [0, 1] and a seed:

  | Phase | Drawing |
  |---|---|
  | bare stubble | brown soil with rows of short yellow stubs |
  | prepared | brown mud with a water sheen |
  | seedbed | a bright green corner patch that grows with age |
  | transplanted | a grid of small green tufts; rows wobble when qT < 1 |
  | tillering | fuller tufts |
  | panicle | taller, darker green |
  | heading | pale green panicles |
  | ripening → ripe | yellow-green to golden |
  | overripe | golden, lodged |

  **Pests:**
  - ốc bươu vàng: pink egg clusters on the tufts plus a snail;
  - sâu cuốn lá: rolled white leaves;
  - rầy nâu: brown dots at the base;
  - đạo ôn: brown diamond spots, or white necks for neck blast.
- **`farm-icons.ts`:** 16 × 16 icons, reachable through `iconMatrixFor`:
  - seed sacks (3 colours), fertilizer sacks, pesticide bottles;
  - rice sacks (wet/dry);
  - the containers, cua đồng, cua gạch, ốc đồng, ốc bươu vàng.
- **NPC looks:** chú Tám, anh Hai and cô Út use existing clothing layers and palettes, plus a khăn rằn neck item if the catalog has none.

## 15. v15.2 — gathering and minigames (`0016_v15_gather.sql`)

### 15.1 Minigames

Each returns a quality `q` in [0.9, 1.1]; how the server accepts it after D1 is decided in the v15.2 plan.

- **Transplanting (`TransplantGame`):** a marker sweeps across a row.
  - 12 beats; tap or press Space when the marker is inside the green band.
  - Each beat scores *chuẩn* 1, *được* 0.5 or *lệch* 0.
  - `q = 0.9 + 0.2 · score / 12`.
  - About 12–15 s.
- **Harvesting (`HarvestGame`):** hold to raise the sickle's power bar and release inside the sweet band to cut a bundle.
  - Releasing early leaves grain; releasing late shatters it.
  - 8 bundles, scored the same way.
  - About 10–14 s.
- **Crab grabbing (`CrabGame`):** a hand hovers over the hole while the crab's claws open and close on a rhythm that speeds up with each grab.
  - Grab while the claws are closed; grabbing while they are open means "Á! Bị cua kẹp", and that crab is lost.
  - Three tries per hole, and the result is `hits` ∈ 0..3.

All three are pure state machines in `lib/game/farm/minigames.ts`, with seeded tests, plus thin overlay components. They follow the v14 input rules: typing guard, pointer, touch, Space.

### 15.2 Crabs and snails

- **Crab holes:** 6 on the field, each with a per-account 20-minute cooldown.
  1. `crab_start(room, spot)` checks the cooldown, starts it, and records a hole visit with a token.
  2. `crab_finish(room, token, hits)` requires ≥ 3 s since the start and `hits` ≤ 3. It grants `min(hits, free capacity)` crabs; each is a **cua gạch** with probability 0.1, rolled by the server, otherwise a **cua đồng**.
- **Snail beds:** 4 on the field, each with a per-account 15-minute cooldown. `pick_snail_bed(room, spot)` gives 1–4 snails, each 70 % ốc đồng and 30 % ốc bươu vàng. It takes a 3-second progress action.
- **Pest snails:** `pick_snails(plot)` also yields 1–3 ốc bươu vàng into your container, within free capacity.
- **Capacity:** 3 by hand, plus the largest owned container (15 or 30). Crabs and snails share it.
  - When full: "Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai."
- **Selling:** `sell_critters(token, kind | null)` at cô Út; `null` sells all.
- **New tables:** `critters` (`account_id`, `kind`, `qty`) and `gather_cooldowns` (`account_id`, `room_id`, `spot`, `ready_at`), plus the crab-visit token on the cooldown row.
- **Changes to `field_state.mine`:** it gains `critters` and `critter_cap`.

## 16. Input rules, errors and edge cases

- **Input:** the v13/v14 input rules apply. Panels block game input. Farm actions lock movement while their 2–3 s progress bar runs, like the rod. Moving cancels a progress action before it is sent.
- **Two tabs of one account:** the wallet lock and the plot row locks serialise them.
- **Concurrent sales:** two buyers of one listing, or acceptance racing withdrawal. The row lock plus `expected_price` means exactly one succeeds; the other gets `price changed` or `offer expired`.
- **Leases while you're away:** a lease can expire while its holder is offline. The crop is lost, and the next `field_state` shows the plot free.
- **The owner leaves the room:** the plot is reclaimed at the next sweep.
- **Reclaimed or ex-owners:** a reclaimed ex-owner still gets the refund even if they no longer have a room in common with anyone.
- **Old clients:** a pre-v15 client never sees the field. Its presence map is `hall`/`pond`, and it ignores `fp`/`fa`, since unknown message types are dropped by the v14 parser.
- **Before the migration runs:** a v15 client against a database without `0013` shows the field with a banner, "Đồng ruộng chưa mở — chủ phòng cần chạy migration 0013." The fishing flows keep working.

## 17. Testing

- **Pure TS (Vitest):**
  - `crop.ts`: phases for all varieties, the water-at-time function, accepted levels, off-target sampling, top-dress scoring, excess N, pest visibility from revealed data, the yield formula, due tasks, plot actions.
  - `land.ts`: the farmer and limit rules, and which land actions are allowed.
  - `clock.ts`, `state.ts` (parsers), `messages.ts`, `rpc.ts` (mocked Supabase).
  - v15.2: the minigame state machines with seeded inputs.
- **Shared fixtures:** `tests/fixtures/crop-cases.json`, about 12 crop timelines (actions with times) with their expected yields. The TS tests assert them, and the SQL smoke replays the same cases through the private functions and asserts the same kilograms.
- **SQL smoke** (`tests/sql/v15-smoke.sql`, on the throwaway PostgreSQL 18 cluster):
  - a full season with simulated time;
  - every land flow: rent, expiry, buy, list, buy listed, offers (accept, decline, withdraw, expire), sublease, sell back, reclaim by absence and by leaving the room;
  - the concurrent-sale guard;
  - drying and selling;
  - the gift once;
  - the `buy_item` kind guard;
  - the `_fishing_state` owned filter and `server_now`;
  - re-running `0013` twice.

  v15.2 adds its own smoke (`v15-gather-smoke.sql`).
- **Maps:**
  - field collision and reachability of every use spot from both arrivals;
  - plots do not overlap each other or any solid;
  - the portals are reachable from both sides;
  - hall and pond regressions: the existing tests plus the new signs.
- **Components and hooks** (RTL, `afterEach(cleanup)`): `useField` (refetch on `fp`, errors → toast + refetch), `useFarmController` (prompts, tasks), and the panels (Coop tabs, shop steppers, depot selling, plot panel actions).
- **Integration** (skipped without `SUPABASE_TEST_URL`): land and farm RPCs end to end, with the time-dependent parts covered by the smoke test.
- **Manual pass** (owner, after running `0013`, two accounts):
  - travel between the three maps;
  - rent, then a whole season, including pests and water;
  - harvest, dry, sell;
  - buy a private plot, sublease it to account B, sell it to B via an offer;
  - phone layout.

## 18. Out of scope

- **v16:** the harvest-season rat hunt, the dog pet (chó cỏ) and the slingshot (ná). The `ripe` flag in `field_state` is its hook.
- **Not in v15:**
  - weather, real seasons (vụ Đông Xuân …) and festivals;
  - milling, cooking and crafting;
  - hired help, shared labour and theft (the only help is picking a neighbour's snails);
  - more than one private plot per room, auctions, soil fertility over time;
  - market prices (all prices are fixed config);
  - desktop notifications for farm tasks (the HUD list only).
- **Deferred v14 review items:** they stay deferred except M-3, which is done in §11.6. The others are listed in the owner's memory notes and remain open.
