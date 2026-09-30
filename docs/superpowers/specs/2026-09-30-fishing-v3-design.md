# Câu cá v3 — modular gear (design)

Date: 2026-09-30 · Migration: `supabase/migrations/0110_fishing_v3.sql` · Smoke: `tests/sql/fishing-v3-smoke.sql` ·
Unit: `tests/unit/fishing-v3.test.tsx` · Client: `lib/game/fishing/gear.ts` (numbers + texts), `state.ts`, `rpc.ts`,
`messages.ts`, `components/game/fishing/BagPanel.tsx` (the rig), `ShopPanel.tsx`, `NotebookPanel.tsx`, `HeatHud.tsx`.

## 1. The owner's ask

A new player keeps the wooden rod and fishes as before, mostly small common fish. Rods are no longer bought whole:
each part is bought on its own, with its own stats — **cần** (a better rod lands heavier fish; a fish too heavy breaks
it), **lưỡi** (some species only take the right hook; 2- and 3-point hooks sometimes land 2–3 fish), **dây** (holds
heavier fish), **máy xoay** (reels faster), **phao** (a longer hook window; none → easy misses), **thính** (thrown on a
spot, the species that like it come), **mồi** (species preferences), more **xô** and **lưới**, and **Sổ tay câu cá**
(bought) with every species' habits and hours. Some species only bite at certain hours. Repair stays as it is.
Owner decisions: existing non-wood rods stay as bare rods (they cannot fish until their parts are bought); parts
mount and unmount freely; multi-hook extras are random from the normal roll.

The game is public: **the server decides everything**. The client only displays; every roll, limit and break is in
the cast RPCs, and a cast keeps what it was cast with.

## 2. The rig

`fishing_profiles` gets `hook`, `line`, `reel` slots; `bobber` may be null. `_fishing_rig(account)` adds them up:

| | Cần gỗ (kit) | bare rod (tre, sợi thủy tinh, carbon, cần thủ) |
|---|---|---|
| hook | its own: small, 1 point | the mounted hook (**required**) |
| line | its own 3 kg (never wears) | the mounted line (**required**) |
| breaks at | never (no durability) | `rating_g` → `rod_snap` |
| reel | none, ×1.00 | the mounted reel; none = min_reel_ms ×1.15, difficulty +5 |
| phao | the mounted one, else its own 1.5 s | the mounted one, else **0.7 s** to hook |

A bare rod without a hook or a line is refused by `start_cast` / `start_river_cast` / `start_river_cast_w` with
`'rod needs parts'` (22023, detail = the missing slots) before anything is spent; the client's `castBlocker` says so
first ("Cần này chưa đủ đồ — lắp lưỡi và dây câu…"). A newly bought bare rod is not auto-equipped until a hook and a
line are mounted; a part fills its empty slot when bought. `fishing_equip(token, slot, item | null)` mounts or
unmounts: slot ∈ rod / hook / line / reel / bobber / bait; the item must be of that kind and owned (a bait need only
exist, as `set_loadout` allowed); rod null = Cần gỗ; the bait is never empty; a broken rod is refused.

## 3. The stock (prices on the economy v2 scale)

| id | kind | name | price | stats |
|---|---|---|---:|---|
| rod_wood | rod | Cần gỗ | starter | kit: small hook ×1, line 3 kg, zone 25 %, k 2.0 |
| rod_bamboo | rod | Cần tre | 300 | breaks at 6 kg, zone 30 %, k 1.5, 120 uses |
| rod_fiber | rod | Cần sợi thủy tinh | 700 | 12 kg, zone 33 %, rare ×1.1, 200 |
| rod_carbon | rod | Cần carbon | 1 500 | 30 kg, zone 36 %, rare ×1.2, 300 |
| rod_master | rod | Cần thủ | 5 000 | 60 kg, zone 40 %, rare ×1.4, k 1.3, 600 |
| hook_small | hook | Lưỡi đơn nhỏ | 20 | small ×1 |
| hook_large | hook | Lưỡi đơn lớn | 100 | large ×1 |
| hook_shrimp | hook | Lưỡi tôm | 60 | shrimp ×1 |
| hook_eel | hook | Lưỡi câu lươn | 80 | eel ×1 |
| hook_double | hook | Lưỡi đôi | 400 | small ×2 (one extra 12 %) |
| hook_triple | hook | Lưỡi ba | 1 500 | large ×3 (extras 15 % + 6 %) |
| line_02 | line | Dây cước 0.2 | 40 | 4 kg, 3 snaps |
| line_03 | line | Dây cước 0.3 | 150 | 12 kg, 3 snaps |
| line_braid | line | Dây dù bện | 400 | 30 kg, 3 snaps |
| line_pe | line | Dây PE siêu bền | 1 200 | 60 kg, 3 snaps |
| reel_1000 | reel | Máy xoay 1000 | 150 | ×1.00, ±0 |
| reel_3000 | reel | Máy xoay 3000 | 400 | min_reel ×0.90, difficulty −5 |
| reel_5000 | reel | Máy xoay 5000 | 1 200 | ×0.80, −10 |
| bobber_feather / foam / lamp | bobber | (unchanged) | starter / 150 / 800 | 1.5 / 2.0 / 2.5 s |
| gb_cam / gb_tom / gb_thom / gb_tanh | groundbait | Thính cám gạo / tôm khô / thơm / tanh | 10 / 15 / 20 / 30 a bag | 10 min, 48 px, ×3 |
| fishbook | fishbook | Sổ tay câu cá | 500 | unlocks `fishing_notebook` |
| bucket_medium / bucket_foam / bucket_ice | bucket | Xô vừa / Thùng xốp / Thùng đá | 450 / 2 000 / 5 000 | 10 / 30 / 50 fish |
| net_gill / net_cast | net | Lưới rê / Lưới chài cước | 300 / 800 | 30 / 40 throws, r 30 / 36, rare ×1.5 / ×2 |

Old items keep their prices (0101). **A full mid kit** — Cần carbon + Lưỡi đơn lớn + Dây dù bện + Máy xoay 3000 +
Phao xốp — costs 2 550 xu, about what Cần carbon + Phao đèn cost before (2 300). Repair is unchanged: rods only, 30 % of
the rod's price. Lines do not repair: a snap spends one of their 3, the last one leaves them in pieces (gone from the
bag, unmounted). Hooks, reels and the notebook never wear. Groundbait is bought by the bag (1–99 a buy, at most 99 of a
kind; the bait box does not hold it).

## 4. The roll

1. Rarity: `_roll_rarity(rod, bait, weather, night)` as before; the river's bump as before (0.05, a shoal 0.10).
2. Species (`_species_pick`): of that rarity and water (the river's deep water from Hiếm up), only those the mounted
   hook takes (`fish_habits.hook` null = any) and that bite at this Vietnam hour (`hours` null = always), weighted
   **×2** for a liked bait and **×3** for a liked groundbait working on this spot (weighted random: least −ln(u)/w).
   None left at that rarity → the rarity below (Thường always has one: no Thường is gated).
3. Weight: `min + (max − min + 1) · u^weight_k` with the rod's `weight_k` (unchanged).
4. `_cast_lift` (luck, rod level, perk, meal; ≤ 20 %) now only lifts to a species the hook takes and that bites now.
5. The reel: difficulty = species + reel_ease (1…100), min_reel_ms = round((2000 + 40·difficulty) × reel_speed); both
   are stored in `casts.reel_params` and answered, so 0108's client check and 0046's replay use them. The replay engine
   (`_reel_replay` / `lib/game/fishing/reel.ts`) is untouched; `tests/fixtures/reel-cases.json` still pins it.
6. The phao: bite times as before; the window from the rig (none on a bare rod: 0.7 s).
7. The extras (`_cast_extras`): a 2-point hook one more fish with 12 %; a 3-point hook one with 15 % and another with
   6 %; each rolled by steps 1–3 (no lift), stored in `casts.extra`.

The cast also keeps `line`, `line_g` and `rod_g` (a part unmounted mid-cast changes nothing).

## 5. The catch (`finish_cast`, 6-argument; 0108's 7-argument form calls it)

After every anti-cheat check (replay, hook, time gate, timing) a **won** reel whose fish is heavier than the rig's
weakest part breaks that part: the line (`line_snap`, one snap spent — the kit's own line never wears) or the rod
(`rod_snap`: durability → 0, unequipped back to Cần gỗ, `rod_broke`, repairable at chú Tư's). The answer carries
`snap {species_id, weight_g, limit_g, line_gone}`. A caught fish lands as before, then each extra that the rig holds
lands while the bucket has room — priced like the first (room index, season factor), battle-scored (`mt.catch`),
personal bests updated — answered as `extra: [{id, species_id, weight_g, price, rarity}]`. A cast from before 0110
(no limits) never snaps.

## 6. Thính and the nets

`throw_groundbait(room, token, item, map, x, y)`: map `pond` with the cell (col, row) as `start_cast` takes it, or
`song_cai` / `wild` in world px as the river casts (boat, level 3). The spot is claimed like a cast (`_pos_claim`), one
bag is spent, and the account's single `fishing_groundbait` row is replaced: **account- and spot-scoped** — only the
thrower's own casts and nets within 48 px of it, on the same map, for 10 minutes, feel it. (Scoped to the thrower so
nobody can grief or farm another player's spot; the effect only reshuffles species within a rarity.)

Nets (`net_haul`, `_net_pick`): each fish is Quý with 2 %·(rare_mult − 1), Hiếm with 10 %·(rare_mult − 1), else a Thường
or Khá as before; never a hook-gated species; only those biting now; the thrower's groundbait (at the throw's cell,
stored by `start_net` in `net_throws.x / y`) ×3. The old nets (rare ×1) are unchanged.

## 7. The species

The habits live in **`fish_habits`** (not columns of `fish_species`: that table is readable by anon through PostgREST,
and the notebook is a paid item — the habits are only served by `fishing_notebook` to an account that owns
`fishbook`). Columns: `hook`, `baits text[]`, `groundbaits text[]`, `hours smallint[]` (Vietnam clock), `note`.

| species | rarity | water | hook | likes (bait · thính) | hours |
|---|---|---|---|---|---|
| cá rô, cá sặc, cá mè vinh | 1 | ao | — | trùn / trùn chỉ · cám | always |
| cá lóc · cá trê · cá chép | 2 | ao | — | tép, vàng · tôm / trùn · tanh / trùn, vàng · cám, thơm | always |
| **lươn đồng** (new, 100–600 g, 35/kg) | 2 | ao | eel | trùn · tanh | 18–6 h |
| cá tra · cá thát lát | 3 | ao | — | tép · tanh, thơm / tôm | always |
| tôm càng xanh | 3 | ao | shrimp | trùn chỉ · tôm | always |
| cá bông lau | 4 | ao | — | tép, vàng · tanh | always |
| cá he vàng | 4 | ao | — | vàng · thơm | 6–18 h |
| **cá tai tượng** (new, 0.8–4 kg, 18/kg) | 4 | ao | — | tép · thơm | 5–10 h |
| cá hô | 5 | ao | large | vàng · thơm | always |
| **ba ba gai** (new, 3–15 kg, 60/kg) | 5 | ao | large | vàng · tôm | 20–4 h |
| cá leo | 3 | sông | large | tép · tanh | always |
| cá bống tượng, cá lăng | 3 | sông | — | trùn chỉ · tôm / trùn · tanh | always |
| cá ngát | 3 | sông | — | trùn · tanh | 18–7 h |
| cá chiên, cá đuối sông | 4 | sông | large | tép / trùn chỉ · tanh | always |
| cá dứa, cá anh vũ | 4 | sông | — | tép · tôm / vàng · thơm | always |
| **cá chình** (new, 1–8 kg, 16/kg) | 4 | sông | eel | trùn chỉ · tanh | 19–5 h |
| cá tra dầu, rùa mai vàng, cá vồ đém | 5 | sông | large | vàng / trùn chỉ · thơm / tanh | always |

The new species' mean fish sit inside their rarity's band of 0101 (each rarity's cheapest mean above the dearest of the
rarity below; no fish under 2 xu) — checked by the smoke.

## 8. Balance

Mean xu per landed reel (the audit's formula: rarity roll × species × weight, prices ×1.00, before the reel's win rate),
Monte-Carlo 20 000 casts, at a day hour / a night hour:

| setup | before (0101) | 0110 | |
|---|---:|---:|---|
| pond: Cần gỗ + trùn | 10.0–10.2 | 8.0–8.1 | −20 %: the wooden rod's 3 kg line and small hook keep it to small, common fish (the ask) |
| pond: tre + lưỡi nhỏ + cước 0.2 + tép | 12.8–13.6 | 10.3 | the starter upgrade |
| pond: sợi thủy tinh + lưỡi lớn + cước 0.3 + tép | 13.5–14.1 | 11.8–12.7 | |
| pond: carbon + lưỡi lớn + dây dù + trùn chỉ (mid kit) | 17.8–17.9 | 15.8–16.9 | −5…−11 %, before the reel's −5 difficulty / ×0.9 time |
| pond: cần thủ + lưỡi lớn + PE + trùn chỉ | 20.7–20.9 | 20.7–21.1 | unchanged |
| pond: cần thủ + lưỡi ba + PE + trùn chỉ | 20.3–21.0 | 26.7–27.6 | +30 % for the 1 500-xu triple hook (+0.21 fish a cast) |
| river: carbon + lưỡi lớn + dây dù + trùn chỉ | 25.1–25.5 | 22.8–23.6 | |
| river: cần thủ + lưỡi lớn + PE + trùn chỉ | 29.5–30.2 | 29.2–29.6 | unchanged |

Income per hour stays on 0101's scale for matched gear (casts are bound by stamina, ≤ 200 an hour); the wooden rod is
lower by design, and a mismatched rig (a heavy fish on a light line) loses fish to snaps. Groundbait and bait
preferences move the mix within a rarity (towards the pricier species of the player's choosing), not the rarity. The
thương lái cap and 0101's prices are untouched.

## 9. Client

- **Giỏ đồ:** the rig summary (hook, line, rod limit, reel, hook window) and a warning when a bare rod lacks parts; a
  section per part (Lưỡi câu, Dây câu, Máy xoay) and the phao with **Lắp / Tháo**; the baits; **Thính** (bags, pick the
  one the HUD throws, **Rải** where I last fished, the one working and until when); **📖 Mở sổ tay** once bought.
- **Tiệm chú Tư:** a heading per kind (cần, lưỡi, dây, máy xoay, phao, mồi, thính, lưới, hộp mồi, xô, sổ tay), a stat
  line per item (`describeItem`), groundbait by the bag, a line that rods are sold bare.
- **Mép ao:** "🌾 Rải thính" beside "Quăng lưới" (the edge cell).
- **Sổ tay câu cá:** every species with its hook, liked baits and groundbaits, hours (🟢 biting now) and a note.
- **Messages:** `rod needs parts`, `line_snap` / `rod_snap` (the fish, its weight, the line's limit, a line in pieces),
  extra fish ("Lưỡi nhiều mũi dính thêm 2 con: …"), `no groundbait`, `groundbait full`, `no notebook`, `bad slot`.

## 10. Not in this change

A news post for the players (the owner asked for none now). Repairing lines. Shared (room-wide) groundbait spots.
