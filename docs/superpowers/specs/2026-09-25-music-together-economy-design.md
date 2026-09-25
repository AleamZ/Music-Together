# Music Together — Economy rebalance: farm prices and the fish price index

**Date:** 2026-09-25
**Status:** decided.
- The owner set the land numbers and the profit target.
- On 2026-09-25 the owner said "chạy đến Goal … làm theo khuyến nghị", meaning run to the goal and follow the ★ recommendations. Every other choice below is therefore the controller's recommendation, recorded as decided.

**Builds on:** `feat/v15-field` after v15.1 Tasks 1–19, and the v15 spec `2026-09-25-music-together-v15-field-design.md`.
**Lands in:** v15.1, plan Tasks 20–21, inside `supabase/migrations/0013_v15_field.sql`. 0013 is not in production yet. If the owner already ran it for a demo, running the edited 0013 again brings that database to the new state.

## 1. Why

- **Farming is too cheap.** In v15.1 as planned, a rented plot costs 250 xu, which is about 10 minutes of fishing. A season earns about 700 xu.
- **What the owner wants:**
  - farming should be an investment: rent 10 000, land 800 000;
  - a well-cared season should pay at least **50 000 xu**, so it is worth the effort.
- **Fishing must keep pace.** When farming pays that much, fish at today's prices stop mattering once a room gets rich. So fish prices rise with the room's wealth, and they vary by season every 3 hours.

## 2. Decisions

| # | Decision | Source |
|---|---|---|
| E1 | Village rent 10 000 xu per 96 h lease | owner |
| E2 | Private plot 800 000 xu; sell-back to the village 400 000 (half, as before) | owner, ★ |
| E3 | Sale-listing and offer cap 5 000 000; sublease cap 100 000 | ★ |
| E4 | Seeds, fertilizers and sprays cost 10× their v15.1 price | ★ (owner: "cũng cần tăng lên") |
| E5 | Dry rice per kg: short 710, nếp 950, thơm 1 350. Wet rice still pays 70 % | owner target ≥ 50 000 per season, ★ split |
| E6 | The newcomer gift is unchanged (1 seed_short + 1 fert_urea); its value scales with E4 | ★ |
| F1 | A fish's price is base × the room's multiplier × the species' season factor. It is fixed at the catch | owner, ★ |
| F2 | The room's multiplier follows the average assets of its active members: a square-root law, bounded to [1, 10], reference 20 000 xu | owner, ★ |
| F3 | The multiplier and the factors change every 3 hours (Vietnam time 00:00, 03:00, …, 21:00). Each room keeps one snapshot per period | owner |
| F4 | Season factor: per room, species and period, in [0.80, 1.39] (two decimals, truncated), from a hash | owner ("random"), ★ |
| F5 | Players see the prices in a third tab of the records panel, "Giá cá" | ★ |

## 3. Farm prices (Task 20)

### 3.1 Land constants

In 0013 these are literals in the `_farm_do_*` functions. They are mirrored in `lib/game/farm/catalog.ts`.

| What | Old | New | SQL | TS constant |
|---|---|---|---|---|
| Village rent (96 h) | 250 | **10 000** | `_farm_do_rent`: the balance check, `_pay`, the lease `price` | `RENT_PRICE` |
| Private plot | 4 000 | **800 000** | `_farm_do_buy`: balance check, `_pay` | `PLOT_PRICE` |
| Sell-back to the village, and the reclaim refund | 2 000 | **400 000** | `_farm_do_sell_to_village`; the reclaim refund in `_field_open` | `SELL_BACK_PRICE` |
| Sublease price | 1–5 000 | **1–100 000** | `_farm_do_set_sublease`, the `field_plots.sublease_price` check | `SUBLEASE_MAX` |
| Sale listing and offer price | 1–1 000 000 | **1–5 000 000** | `_farm_do_list`, `_farm_do_offer`, the checks on `field_plots.sale_price` and `land_offers.price` | `SALE_MAX` |

**Re-runs.** `create table if not exists` keeps a table's old inline checks. 0013 therefore also drops these three checks by their generated names and adds them back with the new bounds, so a second run of 0013 brings an existing database to the new state:
- `field_plots_sale_price_check`
- `field_plots_sublease_price_check`
- `land_offers_price_check`

The v14 constraint changes already follow this pattern.

### 3.2 Shop items (`shop_items`, data)

| id | Old | New |
|---|---|---|
| seed_short / seed_nep / seed_thom | 60 / 90 / 150 | **600 / 900 / 1 500** |
| fert_manure / fert_phosphate / fert_urea / fert_potash / fert_npk | 40 / 50 / 60 / 60 / 90 | **400 / 500 / 600 / 600 / 900** |
| spray_insect / spray_hopper / spray_fungus | 70 / 80 / 90 | **700 / 800 / 900** |

### 3.3 Rice (`rice_varieties.price_per_kg`, data)

| id | Old | New |
|---|---|---|
| short | 12 | **710** |
| nep | 18 | **950** |
| thom | 26 | **1 350** |

Everything the client shows (shop, depot, handbook, toasts) reads these from the catalog. Only tests and docs that print the old literals change with them.

## 4. Economy check (replaces v15 spec §10 for farming)

A rented plot, full care (4 fertilizers, 1–2 sprays), one season per 96 h lease:

| Variety | Costs | Revenue (dry) | Profit | Poor care (−30 % kg) |
|---|---|---|---|---|
| short (90 kg, ≈54 h) | 10 000 + 600 + 2 100 + ≈1 200 = **≈13 900** | 90 × 710 = **63 900** | **≈50 000** | ≈30 800 |
| nếp (75 kg, ≈60 h) | 10 000 + 900 + 2 100 + ≈1 200 = **≈14 200** | 75 × 950 = **71 250** | **≈57 000** | ≈35 700 |
| thơm (60 kg, ≈69 h, blast ×1.3) | 10 000 + 1 500 + 2 100 + ≈1 600 = **≈15 200** | 60 × 1 350 = **81 000** | **≈65 800** | ≈41 500 |

- A lost crop costs about 14 000.
- A player with 2 rented plots earns about 28 000 xu a day, so buying land (800 000) takes about **1 month**.
- A private plot saves the rent and adds 10 % yield, about 17 000 per season. Subleasing can earn up to 100 000 per season.
- A newcomer still needs about 6–10 hours of fishing at the room's multiplier for the first rent. After one season they can pay for everything.
- One season's profit equals 30–60 hours of fishing at multiplier 1. The fish price index (§5) narrows that gap as rooms get richer.

## 5. Fish price index (Task 21)

### 5.1 Formula

```
price = max(1, round(price_per_kg × weight_g / 1000 × M(room, period) × S(room, species, period)))
```

- `price_per_kg` is the v14 base (`fish_species`), unchanged.
- The price is computed once, in `finish_cast`, when the fish is caught, and stored in `fish.price` as in v14.
- Selling later pays the stored price, and `sell_fish` is unchanged. Prices moving later never change fish already caught.

### 5.2 The room's wealth

- An **active member** of room `r` is a `members` row of `r` with `coalesce(last_seen_at, joined_at) > now − 14 days`. This is the same rule as land reclaim (v15 spec §7.6).
- An account's **assets** are `wallets.coins + 800 000 × (private plots it owns, in any room)`. Land counts at the village price. Rice, fish and items are left out: they are small and change often.
- `W(r)` is the floor of the average assets over r's active members. It is 0 when there are none.

### 5.3 The multiplier

```
M = round(least(10, greatest(1, sqrt(W / 20000))), 2)
```

| W (average assets) | M |
|---|---|
| ≤ 20 000 (a new room) | 1.00, today's prices |
| 100 000 | 2.24 |
| 500 000 | 5.00 |
| 1 000 000 | 7.07 |
| ≥ 2 000 000 | 10.00 |

- **Why a square root:** fishing income then grows much more slowly than wealth. A plain proportional law would make prices chase wealth and wealth chase prices.
- **Why a cap:** it bounds the worst case. The highest possible price is cá hô: 40 kg × 200 × 10 × 1.39 ≈ 111 000 xu.

### 5.4 Periods

- `period = floor((epoch(now) + 25 200) / 10 800)`: 3-hour periods aligned to Vietnam time (UTC+7). Boundaries fall at 00:00, 03:00, …, 21:00 VN.
- A period ends at `to_timestamp((period + 1) × 10 800 − 25 200)`.

### 5.5 The snapshot

- **Table:** `fish_price_index`.
  - `room_id`: primary key, referencing `rooms`, `on delete cascade`.
  - `period` bigint, `wealth` bigint, `mult` numeric(5,2), `computed_at` timestamptz.
  - It is private: RLS on, no policies, revoked from `anon` and `authenticated`.
- **`_fish_index(p_room, p_now)`** returns the row for the current period. If the stored period is older, or no row exists, it computes W and M and upserts them. The upsert guards with `where fish_price_index.period < excluded.period`, then re-reads, so concurrent callers in a new period all use the first snapshot written.
- The snapshot fixes M for the whole period: xu earned mid-period do not move prices until the next one.

### 5.6 Season factor

```
S = trunc(0.80 + 0.60 × h, 2),   h = ('x' || left(md5(room_id || ':' || species_id || ':' || period), 8))::bit(32)::bigint / 4294967296.0
```

- The factor is deterministic, so nothing needs storing, and the board shows exactly the factors the catch uses.
- Its range is [0.80, 1.39] (truncated to two decimals) with a mean of about 1.10. Prices rise "theo mùa" on average and sometimes dip.
- Because the code is public, the factors can be predicted. That is acceptable: the board shows them anyway.

### 5.7 SQL changes (in 0013)

- **`finish_cast`** is re-created from 0012, with one change: the price line uses M and S for the cast's room at `now()`. A cast whose room is gone uses M = S = 1. Every other line stays byte-identical to 0012.
- **`fishing_board`** is re-created from 0012 and returns one more key, `prices`:

  ```json
  { "mult": 2.24, "wealth": 100000, "ends_at": "…", "factors": { "ca_ro": 1.12, "…": 0.93 } }
  ```

  The factors cover every species.
- **New private helpers:** `_fish_period`, `_room_wealth`, `_fish_mult`, `_fish_index`, `_fish_factor`, `_fish_prices`. Each is revoked from `public`, `anon` and `authenticated`.

### 5.8 Client

- **`lib/game/fishing/rpc.ts`:** `FishingBoard` gains `prices: FishPrices | null`, which is `{ mult, wealth, endsAt, factors }`. It is parsed defensively: a board without `prices` gives `null`.
- **`lib/game/fishing/prices.ts`** (new):
  - `nowPricePerKg(species, prices)`: `round(pricePerKg × mult × factor)`;
  - `trend(factor)`: ▲ above 1, ▼ below 1, blank at 1.00;
  - `formatMult(m)`: "×2,24".
- **`RecordsPanel`** gets a third tab, "Giá cá". It shows:
  - a header line: "Hệ số phòng ×2,24 · tài sản trung bình 100.000 xu · giá đổi lúc 15:00";
  - a table with the columns Loài | Gốc (xu/kg) | Bây giờ (xu/kg) and the trend arrow;
  - a footnote: "Giá chốt lúc câu được cá; bán sau vẫn giữ giá đó."
- **No HUD change:** the catch card already shows the locked price.

### 5.9 Interactions

- **Anti-cheat `0015`** re-creates `finish_cast` (H2). Its plan is refreshed after v15.1 so that it keeps the index pricing.
- **v15 spec §10** points here for the farm numbers. Task 20 also changes the v15 spec §7 land numbers, the §8.1 table and the §9 prices. Its v14 reference, "a skilled angler earns about 1 000–1 800 xu per active hour", holds at M = 1.

## 6. Testing

- **SQL smoke** (`tests/sql/v15-smoke.sql`):
  - the new farm prices: rent charged, plot price, sell-back, caps;
  - the re-created checks reject 5 000 001 and 100 001;
  - `_fish_mult` at the table's reference points;
  - a room's snapshot is stable inside a period and recomputed in the next one;
  - `_fish_factor` falls in [0.80, 1.39];
  - a successful `finish_cast` stores the expected price for a known room, species, weight and period.
- **Unit tests:**
  - `prices.ts`: rounding, the trend and the mult format;
  - the `fishing_board` parse, with and without `prices`;
  - the land pre-checks with the new constants.
- **Component test:** the "Giá cá" tab renders the header, one row per species with the computed price, and the footnote.
- **Integration test** (`tests/integration/v15.test.ts`): `fishing_board` returns `prices` with a numeric `mult` ≥ 1 and a factor for every species.

## 7. Out of scope

- Dynamic rice prices.
- Re-pricing fish that were already caught.
- Chat announcements of "đang mùa" species.
- Tuning the v14 fishing gear prices.
