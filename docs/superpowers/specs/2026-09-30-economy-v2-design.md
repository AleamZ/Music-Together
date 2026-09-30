# Music Together — Economy v2: one scale, daily limits, no money printers

**Date:** 2026-09-30
**Status:** decided and implemented. The owner asked: "nghiên cứu lại hệ thống kinh tế và vật phẩm về giá cả của toàn bộ
hệ thống … đặt lại các logic về kinh tế để game có thể duy trì dài hạn." Every choice below is the controller's
recommendation, recorded as decided.

**Migrations:**
- `0099_economy_watch` — measurement only. Safe to run on production first.
- `0100_econ_core` — the knobs, the server-wide fish multiplier, the daily NPC buyer, the Chợ Lớn premium, the perk cap.
- `0101`–`0106` — one area each: fishing, farm, crafts, rewards, sinks, players.

Run them in order, after 0098.

**Evidence:** six audits of the effective SQL, with Monte-Carlo and bit-exact reel simulations, in the session scratchpad
(`econ/1-fishing.md` … `econ/6-p2p.md`). Section 2 keeps their headline numbers.

---------------------------------------------------------------------------------------------------------------------------

## 1. The problem in one paragraph

The economy grew one feature at a time, and each feature priced its own faucet. The result:

- **Faucets span four orders of magnitude.** Earning rates at the room multiplier M = 1, before M multiplies fish by up to
  10:
  - a daily check-in pays 20 xu;
  - a starter angler earns 6 400 xu/h;
  - cooking earns 14 000–40 000 xu/h;
  - mining earns 15 000–52 000 xu/h;
  - a river angler earns 79 500 xu/h (326 000 xu/h buffed).
- **Several loops have no daily bound**, and two exploits mint xu without limit (Xì dách debt, raid chaining).
- **Sinks are shallow and fixed-price.** One of every consumer item costs ≈ 394 000 xu net. That is 5 hours of river
  fishing.
- **The room price multiplier amplifies all of it.** M follows the members' average wealth, so a rich room gets
  richer faster (×10 at an average of 2 M xu). Every other faucet feeds it.

Left alone, wallets inflate without bound, prices stop meaning anything, and a newcomer can never catch up with a room
that got rich first.

## 2. Findings (headline numbers, per active hour, skilled player, M = 1 unless noted)

| Area | Faucet today | Design intent | Worst problem |
|---|---|---|---|
| Fishing, pond starter | 6 400 gross (+7 100 treasure) | 1 000–1 800 (README v14) | 0047 removed the 40 casts/h cap. Only stamina limits casting now: 200 casts/h |
| Fishing, pond master | 27 000 | — | ×10 at M = 10 |
| Fishing, river master | 79 500; 326 000 buffed; ×10 at M = 10 | — | Deep species are worth 3× the pond; the boat costs 4 000; rarity lifts skip the reel difficulty (bug) |
| Treasure maps | +4 500–15 000 | a bonus | No daily cap. Worth more per cast than the fish at M = 1 |
| Cooking | 14 000–40 000 | — | Fee-only dishes sell for 1.4–2.2× their fee. No stamina, no cap |
| Mining | 15 000–52 000 (3 halls) | — | 400 digs/day is the only bound |
| Woodcutting | 4 000–32 000 | — | The half price after 40 logs does not bite |
| Farm | 25 000–49 000 per plot per day, 6 plots per account | 28 000/day for 2 plots | Plot caps count per room, so 3 halls = 6 plots. Chợ Lớn +20 %, processor ×1.5 |
| Rewards | levels 1→99 pay 342 450 xu; raid 5 000–6 300/h unlimited | small | Raid cooldown is per party id (disband and re-form). Solo dungeon beats a party 5× |
| Pets | PvE 4 500/day in 10 min; the squirrel pays 300/day AFK | — | — |
| Players | Xì dách: 50 000–90 000 minted per hand | zero-sum | A loss beyond the escrow becomes wallet debt. Trades move 100 M at 0 %, with no gates |
| Sinks | one of everything ≈ 394 000 net | — | Food costs 68 % of a starter's income and ~0 % of a rich player's. Buffs return 3–125× their price |

## 3. Principles

1. **One scale.** H = one active hour of an engaged player with mid-tier gear ≈ **3 000 xu**:
   - a newcomer earns ≈ 1 500–2 000 xu/h;
   - the best gear, skilled, earns ≈ 5 000–7 000 xu/h.

   Progression is ≈ 4× from starter to endgame, not 25×. The existing consumer prices fit this scale, so they stay:
   - a bánh mì costs 150 (3 minutes of play);
   - a car costs 150 000 (≈ 50 h);
   - a private plot costs 800 000 (≈ 250 h).
2. **No multiplier grows with wealth.** Fish, crabs, snails and rats use one server-wide knob (default ×1.00).
3. **Every grind loop is bounded per day.** The thương lái (§3.2) buys only so much at full price; loops that already
   have caps keep them (tightened).
4. **Crafting adds 15–30 % value, never ×2–×10.**
5. **Xu that pass between players burn 5 %.** Nobody can end a hand in debt, and fresh accounts cannot receive xu.
6. **A buff is priced by what it earns.** A buff should return about 1–2× its price, not 35×.
7. **Measure, then tune in small steps.** The admin "Kinh tế" tab (0099) shows the money supply and every faucet and
   sink by reason. The knobs (§3.1) change without a migration.

### 3.1 Knobs (`econ_params`, 0100; edited in /admin → Kinh tế)

| key | default | range | what it does |
|---|---|---|---|
| `fish_mult` | 1.00 | 0.20–3.00 | Server-wide multiplier on every fish (rod and net), crab, snail and rat price at the catch. It replaces the wealth-based M. Setting it re-prices every room's current snapshot at once |
| `npc_full` | 20 000 | 0–10 M | Thương lái: xu of goods per account per VN day bought at full price |
| `npc_half` | 40 000 | 0–10 M | Thương lái: up to this mark, the NPC pays 50 % |
| `npc_tail_pct` | 20 | 0–100 | Thương lái: the rate beyond `npc_half` |
| `p2p_fee_pct` | 5 | 0–50 | The burn on xu between players: trades, plot sales, subleases |
| `trade_daily_in` (0106) | 50 000 | 0–10 M | Most xu an account may receive through trades per VN day |

### 3.2 Thương lái — the daily NPC buyer (0100 `_npc_sale`)

Each account's **grind goods** sold to NPCs in a Vietnam day are counted at catalog/catch value ("gross"). The goods are
fish, crabs, snails, rats, ores, logs, wild goods and dishes.

The NPC pays:
- 100 % of the gross up to `npc_full`;
- 50 % from `npc_full` to `npc_half`;
- `npc_tail_pct` % beyond `npc_half`.

The sale RPCs answer:
- `earned`: what was paid;
- `npc_cut`: the xu kept back;
- `npc`: the day's totals.

The client shows the day's progress and the cut (`lib/game/economy/npc.ts`).

- **What is not counted.** Farm harvests (rice, hoa màu, processed goods) are bounded by the plots. Treasure is capped by
  maps per day.
- **Why a day and not a per-loop rule.** One daily budget, whatever the activity, bounds any loop, including ones nobody
  has found yet. At the targets in §3, 20 000 xu is 3–10 hours of play, so normal players never see it. A 24/7 script
  earns ≈ 3× less.

### 3.3 Chợ Lớn premium

`_market_depot_pay` drops from ×1.20 to **×1.10** (fish, rice, hoa màu). The trip is ~10 s in the unified world, so the
premium was a free +20 % on everything.

### 3.4 Perks

- `_perk_ledger` no longer pays `market_sell_pct` on player sales. 0106 turns it into a fee cut, because a bonus paid on
  top of a 5 % fee created xu.
- All perk payouts share a cap of **1 500 xu per account per day** (was 3 000).

## 4. Fishing (0101)

Target, at M = 1, skilled, gross fish per active hour:

| setup | target |
|---|---|
| pond starter | ≈ 1 800 |
| pond fiber + shrimp | ≈ 2 800 |
| pond master + bloodworm | ≈ 4 500 |
| river master + bloodworm | ≈ 6 500 |

The river is worth ≈ 1.5× the pond with the same gear. Treasure adds ≈ 10 %.

| # | Change | From → to |
|---|---|---|
| F1 | `fish_species.price_per_kg` (and the heaviest deep weights), calibrated with the audit simulator to the targets | 23 species; table in the migration |
| F2 | River rarity bump (a rarity 1–2 roll becomes 3) | 0.20 / 0.33 (shoal) → **0.05 / 0.10** |
| F3 | Boat price; the wild river needs level 3 (`song_cai` unlocked), like Sông Cái | 4 000 → **25 000** |
| F4 | Treasure map drops: pond or net catch / deep catch / worm dig | 2 / 5 / 3 % → **1 / 2 / 0.5 %** |
| F4 | Treasure loot | 400–2 500, 5 % × 8 000 → **150–800 (clean ×1.1, ≤ 800), 2 % × 3 000** |
| F4 | Maps found per account per VN day | unlimited → **3** (no drop after the 3rd find; a 4th dig is refused) |
| F5 | Rarity lifts (luck, perk, meal) change the fish after the reel difficulty is set | one lift per cast (≤ 20 % combined), rolled in the start functions (`_cast_lift`) **before** the reel's difficulty and minimum time are set; the insert triggers no longer lift; pond casts pick a pond species directly |
| F6 | Hunger / thirst per cast | 1.8 / 2.2 → **0.35 / 0.45** |
| F6 | Hunger / thirst per net haul | 3 / 3.5 → **0.6 / 0.7** |
| F6 | Overboard hunger | 10 → **5** |
| F7 | `sell_fish`, `sell_fish_market` pay through the thương lái (§3.2); the depot panel shows the day's line and the cut | — |
| F8 | Bait and nets, so better gear is never a loss after the price cut | shrimp / bloodworm / gold 5 / 12 / 25 → **1 / 3 / 4** (gold: bloodworm rarity, faster bite); nets 250 / 600 → **50 / 120**, net haul hunger / thirst 0.35 / 0.45 |
| F9 | Fishing battles | score only catches made in the battle's room |

- **Food.** At the cheapest restaurant mix a cast now costs ≈ 3 xu of food, ≈ 33 % of a starter's income per cast
  (was ≈ 15 xu, 47–95 %) and ≈ 10 % for top gear. Potions (level 5+) make it cheaper still.
- **Gear prices stay:** rods 300–5 000, lamp 800, bait 5–25, kit 50 000. At the new scale a master rod is ≈ 2 hours
  of mid-tier fishing instead of 11 minutes of river fishing.

## 5. Farm (0102)

The owner's intent stays: a well-cared village season nets ≈ 50 000 at the field depot, and land is a long-term
investment. What goes are the stacked multipliers and the per-room plot caps.

| # | Change | From → to |
|---|---|---|
| A1 | Plot caps count **per account across all rooms** | 2 farmed + 1 private **per room** (6 + 3 across the halls) → **2 farmed + 1 private in total** |
| A2 | Processor price | 10 000 → **50 000** |
| A2 | Processor recipe values | ≈ 1.35–1.50× → **≈ 1.15×** the field price of the input |
| A2 | Sort bonus | +2 / +5 % → **+1 / +2 %** |
| A3 | Player plot sales and offers | 1–5 000 000, 0 % → band **400 000–2 400 000**; the seller receives (100 − `p2p_fee_pct`) % |
| A3 | Subleases | ≤ 100 000, 0 % → **≤ 50 000**; the owner receives (100 − `p2p_fee_pct`) % |
| A4 | Emit `crop_harvest` when a plot's crop is finished | this unblocks the "Nghề mới" quest chain and the nông dân harvest XP |
| A5 | `sell_critters`, `sell_rats` pay through the thương lái | — |

- Village rent (10 000), seeds, fertilisers and sprays keep their prices.
- The Chợ Lớn premium falls to +10 % (§3.3).

## 6. Mining, forest, cooking, crafting (0103)

Target: a mid-tier tool earns ≈ 2 000–3 000/h, the best ≈ 4 500/h. Crafting adds ≈ 15–30 % value.

| # | Change | From → to |
|---|---|---|
| K1 | Cooking: fee-only dishes (cơm tấm sườn, gỏi, bông súng) | a profit loop → sell for ≈ 0.8× their fee; they are for buffs and stamina |
| K1 | Cooking: ingredient dishes | ×2–×11 → value ≈ fee + 1.3 × the ingredients' NPC value (at 0101's fish prices) + 20 |
| K1 | Cooking: quality | 20 / 100 / 125 / 150 % → **20 / 100 / 110 / 125 %** |
| K1 | Cooking: stamina and sales | 0 stamina → **2 stamina** per cook; `cook_eat` restores half; `cook_sell` pays through the thương lái |
| K2 | Mining: ore prices | ÷ **4** (đá 1 … tinh thể 500) |
| K2 | Mining: daily digs | 400 → **200** |
| K2 | Mining: sales | `sell_ore` pays through the thương lái |
| K3 | Woodcutting: log prices | ÷ **3** |
| K3 | Woodcutting: full-price logs | 40 → **30** a day, then half price, hard cap **150** logs a day |
| K3 | Woodcutting: sales | `wood_sell` pays through the thương lái |
| K4 | Hunting and trapping: kill cap | 60 → **40** a day |
| K4 | Hunting and trapping: night market | +30 % → **+10 %** |
| K4 | Hunting and trapping: sales | `wild_sell` pays through the thương lái |
| K5 | Herb gathering | 0 → **1** stamina per gather |
| K6 | Upgrade coin floor | 50 → **200 × (level + 1)** (a starter rod or stone pick no longer upgrades for pocket change) |
| K7 | Emit `item_crafted` from brewing, upgrading and cooking | this unblocks quest n_nghe_3 |
| K8 | Profession switch / skill reset | 500 / 300 → **2 000 / 1 000** |
| K9 | Hunger / thirst per dig | ÷ 3, like fishing (chopping never cost hunger or thirst) |
| S3 | Potion fees (moved here from §8): pot_hunger / pot_thirst / pot_canh | 10 / 10 / 20 → **60 / 25 / 120** (self-brewed food ≈ 25–50 % of the restaurant per point) |
| S3 | Potion fees: pot_luck / pot_luck2 / pot_miner | 80 / 300 / 60 → **150 / 600 / 300** (pot_miner returned 3.2× its cost after ores ÷ 4) |

## 7. Rewards and fixed faucets (0104)

Target:
- casual (15 min/day): ≈ 400 xu/day;
- hardcore: ≈ 3 000–4 000 xu/day;
- levels 1→99: ≈ 137 000 xu once, down from 342 450.

| # | Change | From → to |
|---|---|---|
| R1 | Raid (Vua Heo Rừng): paid kills per account per VN day | unlimited (the cooldown was per party id) → **2** |
| R1 | Raid pool | 1 600 → **1 200** |
| R2 | Weather bosses: paid kills per account per VN day | unlimited → **2** |
| R3 | Dungeon: reward per paid member | 120 + 380 × share → **50 + 250 × paid members × share** (a party is now as good as solo per head) |
| R3 | Dungeon: fee | 150 → **100** |
| R3 | Dungeon: paid clears a day | 5 → **3** |
| R4 | Level reward | 50·L (150·L every 5th) → **20·L (60·L every 5th)** |
| R4 | Daily grant-XP cap | 3 000 → **1 500** |
| R5 | Achievements | level_30 10 000 → 3 000; earn_1m 20 000 → 5 000; win_500 20 000 → 5 000. Only staked or rated fights count as wins |
| R6 | Company quest | 150 to every contributor → a **3 000** pool per completion, split by contribution (≥ 1 % of the goal, ≤ 300 each) |
| R7 | Squirrel forage | 300/day, AFK → **150/day**, only while the owner moved in the last 5 minutes |
| R8 | Pet and fish PvE | 10 paid wins/day → **5**; prizes × 0.6 |
| R8 | Pet and fish PvP fee | 10 % → **5 %** of the pot |
| R9 | "Earned by work" (earn XP, earn_* achievements, quests) | no longer counts 'daily', 'login_reward', 'song', 'pet_find' or resale of vehicles and fashion |
| R10 | Teleport, xe ôm | 20 → **50** |
| R11 | Farm daily quests | goals rescaled to the farm's real numbers (d_rice 100 xu → 5 000 …) |

As built (0104):
- The raid's 1-hour summon cooldown now applies **per member** (`boss_fights.crew`), so disbanding and re-forming a
  party no longer skips it. Thủy Quái and Người Tuyết share one cap of 2 paid kills a day; the scheduled bosses are not
  capped (they need 4–5 players anyway).
- **Counted wins:** exams, underground rated / ladder / cup, PvP with a stake and bouts of a staked 2v2 series. A
  friendly 0-stake bout still gives fight XP.
- The company quest's XP also goes only to contributors with ≥ 1 % of the goal.
- The dungeon's n counts the members this clear pays (paid, did damage, under the daily cap).

## 8. Sinks (0105)

| # | Change | From → to |
|---|---|---|
| S1 | Meal buffs: rare-fish lift | 10 / 15 / 12 / 5 % → **4 / 6 / 5 / 2 %** |
| S1 | Meal buffs: stamina regen | +50 / 40 / 30 / 20 % → **+30 / 25 / 20 / 10 %** |
| S2 | "Ngủ ngon" stamina regen | ×1.5 → **×1.2** (the motel panel now says so) |
| S4 | Housing: house lot upkeep | 500 → **1 500** per 30 days |
| S4 | Housing: repossession refund | 20 000 → **10 000** (a voluntary sale still returns 20 000) |
| S4 | Housing: apartment rent | 1 500 → **2 000** per 30 days |
| S5 | Motel (the right to "Ngủ ngon") | night 100 / month 2 000 → **300 / 6 000** |
| S6 | Paying for a fish dish with a fish (`eat_meal`) | 20–80 % off → still 20–80 %, but **at most 3 × the fish's price** |

The potion fees (S3) moved to §6 (0103).

Restaurant, fashion, furniture, salon, vehicle, dojo and pet prices stay. They already fit the §3 scale once the faucets
are back on it.

## 9. Between players (0106)

| # | Change | From → to |
|---|---|---|
| P1 | Xì dách: a seat never loses more than its escrow | A loss past the escrow became wallet debt → losses are capped at the escrow, and what that seat owes others is scaled pro rata. `mt.allow_debt` is gone |
| P2 | Trade, xu leg | 0 % → the receiver gets **95 %** |
| P2 | Trade, receiving xu | anyone → only accounts **≥ 3 days old and level ≥ 5**, at most **50 000** a day |
| P3 | Trader perk (`market_sell_pct`) | +6 % paid on top of the share → lowers the 5 % sale fee, to at least 2 % |
| P4 | Fashion gift | any account, unlimited → a member of a room the giver is in; **5** gifts a day |
| P5 | Stall rent | 200 → **500** a day |

As built (0106):
- **Xì dách.** The lines between each pair of seats are netted first, then a short seat pays everything it has on the
  table (escrow + what it receives) pro rata, floor, the remainder burned. The replayed 8-seat hand that minted 90 000
  now sums to 0 with every wallet ≥ 0, and a debit below 0 is refused outright.
- **Trades.** The receive gate is enforced at the final confirm; the trade window warns earlier and shows the partner's
  daily allowance.
- **Negative wallets.** Wallets already negative from past Xì dách debt stay as debt: future credits repay them.
  Find them with `select account_id, coins from wallets where coins < 0`.

## 10. Expected result

- **Income.** A newcomer earns ≈ 1 500–2 000 xu/h, a geared player ≈ 4 000–7 000 xu/h. The farm adds ≈ 20 000–25 000 per
  plot per day for the 2-plot farmers.
- **Fixed rewards.** Casual ≈ 400 xu/day, hardcore ≈ 3 000–4 000.
- **Daily bound.** Any grind loop pays at most ≈ 20 000 xu/day at full price. A script, or anyone past that point,
  earns ≈ 3× less.
- **Sinks.** Food ≈ 10–35 % of income, P2P burns 5 %, housing upkeep, buffs priced by value.
- **Stored wealth.** It keeps its value: nobody's xu are taken away. It now buys hundreds of hours of new-scale goods,
  so the luxury tiers of phase 2 target it.

## 11. Rollout

1. **Measure first.** Run `0099` on production and look at the Kinh tế tab for a few days. Note the money supply, the
   daily net and the top faucets.
2. **Deploy v2.** Run `0100`–`0106` together, then deploy the client. The changelog entry "Kinh tế v2" tells players
   what changed and why.
3. **Watch the first week.**
   - The daily net flow should fall toward 0–1 % of the money supply per day.
   - If a normal player's day drops too far, raise `fish_mult` or `npc_full` by 10–20 %.
   - If supply still climbs faster than 2 % a day, lower them.

## 12. Phase 2 (not in this change)

- **Wealth-proportional sinks** for the existing rich:
  - a luxury furniture and fashion tier (10 000–100 000), which needs art;
  - private-plot upkeep (5 000 per 96 h, reclaim when no crop for 14 days);
  - vehicle running costs;
  - a "quỹ làng" donation sink with a village-wide reward.
- **Position checks** on the remote-callable farm, fishing and shop RPCs (the audits list them).
- **Crop growth.** The weather growth pause moves the crop's anchors but not its care logs (`_weather_sweep`), and leases
  do not extend.
- **Weather bosses** trust the room owner's reported weather.
- **Account creation.** Registration rate limit at the edge. Card stake gates by level and a daily loss limit.
- **A pooled index.** One fish index for all public halls (M-shopping is moot while `fish_mult` is global).
