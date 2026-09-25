# Music Together v17 — "Mùa chuột": field rats, the dog (chó cỏ) and the slingshot (ná) (Design)

**Date:** 2026-09-26
**Status:** decided. The owner said "chạy đến GOAL": the controller's ★ decisions stand as the owner's, as C1–C9 below (the controller's R1–R9, renumbered so they do not clash with this spec's rulings). Every other ruling (D1–D30) is the controller's recommendation, recorded as decided with its reason.

**Builds on:** `feat/v15-field` @ `de9ae10`, whose anti-cheat fix round makes `_room_wealth` leave banned accounts out, names the guard allowlist by signature and adds `lib/game/overlays.ts`. On top come `0016` (v15.2 tools and hoa màu), `0017` (v16 cards) and `0018` (v15.3 gather, whose `_critter_price` and `_critter_prices` v17 reuses). The stack is unchanged.
**Order:** `0013` → `0014` → `0015` → `0016` → `0017` → `0018` → **`0019_v17_rats.sql` (this doc)**. The v15 spec's roadmap called this release v16; v16 became the card corner.
**Amends:** the v15, v15.2, anti-cheat and economy specs (§16).

## 1. Goal

v17 turns the harvest into a small social event on the field.

1. **Rats (chuột đồng).** While a rice, khoai lang or bắp plot is ripe, rats come out of holes in the bunds and eat ripe plots, costing yield until someone catches them. Everyone on the field sees them, anyone may catch them, and cô Út buys them at a price that follows the room.
2. **The slingshot (ná).** A durable tool, clay pellets, and an aim-and-release minigame.
3. **The dog (chó cỏ).** Adopted from chú Tám, named by its owner and fed daily. It follows its owner on every map, everyone sees it, and on the field it pounces on a nearby rat every 5 minutes.

The server stays authoritative: spawns, damage, prices, caps, hunger and cooldowns live in SECURITY DEFINER RPCs with `p_now`. Clients report two things only: a slingshot shot's hit or miss, and when their dog pounces.

## 2. Decisions

### 2.1 Controller (★)

| # | Decision |
|---|---|
| C1 | **Migration** `0019_v17_rats.sql`, after `0018`. Its `coin_ledger` check is the list in force after `0018` plus v17's reasons. |
| C2 | **Rats.** Lazy server spawns around ripe or overripe plots (rice; the upland crops where it makes sense); holes at the field edges and bunds; about one every 10–20 minutes while ripe plots exist, a small number alive at once; each rat on a ripe plot costs a small yield share per hour until caught, never more than about 10 %; shared, first come first served, seen through `field_state` and `fp`; sold to cô Út at base × M, fixed at the catch. |
| C3 | **Slingshot.** A durable tool at anh Hai's (≈ 3 000 xu); clay pellets ≈ 100 xu for 10; aim at a running rat and release; each shot costs a pellet; the client reports hit or miss; the server gate is at least 2 s per shot, bound to that rat; the first valid hit wins. |
| C4 | **Dog.** From chú Tám, ≈ 20 000 xu, one per account; the player names it (username rules); it follows its owner on every map and others see it through presence; once per 5 minutes it pounces on a rat while its owner is on the field (a server-side cooldown; the owner's position is not verified); it eats 1 dog food a day and a hungry dog only follows; petting is cosmetic. |
| C5 | **Economy check.** Rat income per hour on a busy field at M = 1 and 5, and the dog's payback; below farming and fishing; a harvest-season bonus. |
| C6 | **UI.** A "Mùa chuột" chip, the slingshot overlay, the dog panel, the handbook tab "Chuột, chó & ná"; Vietnamese throughout. |
| C7 | **Art.** Original pixel sprites: animated rats, holes, slingshot, pellets, dog (walk, idle, pounce), bowl and food. |
| C8 | **Realtime.** Rats through the field state and hints; the dog as a small presence field; its movement derived from the owner's, with no extra messages. |
| C9 | **Anti-cheat.** Hit or miss only, behind a time gate; a per-account hourly catch cap; every new RPC guarded. |

### 2.2 Rulings made while writing

| # | Ruling | Why |
|---|---|---|
| D1 | **The spawn clock.** Candidate k of a room is due at `t(k) = k·900 s + floor(u·300) s`, u from md5(room:k), so two candidates are 601–1 199 s apart, 4 an hour on average. | "Every 10–20 minutes", deterministic and testable. |
| D2 | A candidate spawns a rat only if, at t(k), some plot is rat food and fewer than **3** rats are alive. | C2's cap; no rats without ripe crops. |
| D3 | Only candidates of the **last 30 minutes** are evaluated (the lookback), and a rat found late eats only from the sweep that shows it. A field nobody opens gets no rats. | At most 3 candidates per sweep, and nobody loses grain to rats nobody could hunt. |
| D4 | **Rat food:** rice ripe or overripe (no harvester job started), khoai and bắp ripe or overripe; ớt never. `upland_crops.rat_food` holds it. | "Where it makes sense"; data, not code. |
| D5 | A rat stays until it is caught or its crop stops being food (harvest done, harvester, abandon, loss); then it **flees**. No timer. | C2's "until it is caught"; the 10 % cap bounds the cost. |
| D6 | **Damage:** `Mrat = 1 − min(0.10, 0.02 · rat-hours)`, the last factor of the yield product for rice and hoa màu; rat-hours come from the crop's own `rat_log`. | Pest-like and capped; the log dies with the crop; TS reads the same log. |
| D7 | A crop draws at most **20** rats in its life. | Bounds the log and "rat farming" an unharvested plot. |
| D8 | Rat paths are client visuals from a seed; the server never uses positions. | No movement messages, nothing to trust. |
| D9 | **Holes:** one per plot, on the plot's outer bund, none on the canal banks. | "Edges and banks"; the canal banks hold v15.3's crab holes. |
| D10 | Clients on the field refetch `field_state` at `rats.next_at` + 0–10 s, only in rat season (§11); spawns send no message. | Spawns are time-driven: at most about 4 reads an hour per client, and none out of season. |
| D11 | **Price** `max(1, floor(150 × M))` (v15.3's `_critter_price`), M from `_fish_index` at the catch, after the wallet lock. `rats.price` comes from v15.3's non-writing `_critter_prices`. The client never computes a price. | C2; one M for fish, critters and rats; floor keeps every price ≤ 150 × M; no read or sweep writes the index (v15.3 R12). |
| D12 | Caught rats go to a per-account bag and sell all at once to cô Út (`rat_sell`). | Like fish; the daily cap bounds the bag. |
| D13 | **Caps** per account, slingshot and dog together: **6** catches per hourly window, **24** per Vietnam day; soft `rat_daily_cap` at the 24th. | C9; 24 keeps rats below farming per day even at M = 10 (§9). |
| D14 | **Slingshot contract:** `sling_start(rat)`, then `sling_shoot(rat, hit)`; each shot ≥ 2 s and ≤ 60 s after the start or the previous shot; one aim per account; a hit catches. | C3, with v15.2's work-gate pattern. |
| D15 | A shot that is refused (`rat gone`, a cap, `no aim`, the gate) changes nothing, pellet included. A miss uses a pellet. | Refusals raise and roll back. |
| D16 | **Client timing:** 2.2 s "Nạp đạn…" after every sling answer; the earliest miss goes 2.5 s after it, the earliest hit 3.1 s. | Honest shots always clear the 2 s gate. |
| D17 | **The pounce** is the owner's client calling `dog_hunt(rat)` while on the field, with the dog fed and rested, a rat within **96 px** of the owner and the owner active in the last **3 min**. The server checks food, cooldown and caps. | The server cannot see maps (C4); the client rules keep it near and non-AFK. |
| D18 | A pounce always catches; the cooldown runs 5 minutes from the catch. | Cooldown, caps and the room's supply bound it. |
| D19 | **Food:** 1 bịch feeds 24 h from max(now, fed_until); refused while more than 12 h remain; a new dog comes fed for 24 h. | "1 a day" without waste; a new dog works at once. |
| D20 | **Dog names:** the username rules with 2–16 characters; not unique; renaming is free. | C4; short enough for a label. |
| D21 | **Coats:** vàng, mực, vện, đốm, chosen at adoption and fixed. | The traditional names, variety for free. |
| D22 | The dog lives in a new `dogs` table; `characters.pet` stays unused. | The dog has state (food, cooldown); `pet` is a wearable slot. |
| D23 | Presence carries `dog: {n, c}` only in game mode; classic-view members show no dog. | It follows `map`; the classic view is unchanged. |
| D24 | Each client derives every dog's movement from its owner's drawn position; a pounce is drawn from `rats.recent`. | C8: no messages. |
| D25 | `fa` 11 (petting) and 12 (aiming a slingshot, re-sent every 2 s). | Poses others see, inside the `fa` budget; old clients drop them. |
| D26 | New RPCs: 3 room RPCs (`_ac_play`), 4 account RPCs (`_ac_account`) and 1 allowlisted read (`dog_state`). No new hard signal. | C9. Honest inputs are ids from the state and typed names; a bad coat is a plain refusal. |
| D27 | Petting is owner-only, from the dog panel. | Cosmetic; no targeting of other people's dogs. |
| D28 | Fewest re-created functions: the rat step joins `_field_open` (not `_field_sweep`), and rat data rides in a new top-level `rats` key (not `_plot_view`). | Fewer copies of `0016`–`0018` bodies. |
| D29 | **Prices:** ná 3 000, đạn đất 10 a pellet (sold in tens), thức ăn chó 150 a bịch, the dog 20 000. | C3 and C4; a day's food equals one rat at ×1. |
| D30 | The auto-hunt pauses while the slingshot overlay is open, while locked, and for 10 s after any refusal. | No self-competition, no retry loops. |

## 3. Constraints

- **Earlier constraints hold:** RPC-only writes, time rules in private functions with `p_now`, no cron, `vi-VN` numbers, original art in code, the free-plan Realtime limits, the anti-cheat rules for later migrations (anti-cheat §11.3).
- **`0019`** is additive and re-runnable (`if not exists`, `create or replace`, `drop constraint if exists` + `add`, seeds `on conflict do update`). It requires `0013`, `0015`, `0016`, `0017` and `0018`. It re-creates functions whose latest body lives in `0013`–`0018` (§10.3); the plan copies each latest body verbatim and changes only what §10 names.
- **Server first.** `0019` goes live, then the v17 client right after.
  - A v17 client without `0019`: `rats` is absent (no rats, no chip), and `dog_state` answers PGRST202 → `NOT_OPEN_17`.
  - Old clients against `0019`: rats eat their ripe crops but they neither see nor hunt them until they reload; they drop `fa` 11/12 and ignore presence `dog`. Their shop query filters by kind: pellets and food stay hidden, but `tool` is in v15.2's `FARM_KINDS`, so cached tabs list the Ná. Buying it there works and is harmless; it is usable after a reload.
- **Tests and README.** The plan's first task records the test baseline. The README gains a v17 section: what's new, the deploy order, the trust model and the realtime budget (§11).

## 4. Architecture

```
supabase/migrations/0019_v17_rats.sql  A catalog · B tables · C model · D field · E RPCs · F anti-cheat
lib/game/farm/rats.ts        NEW pure: constants, ratHours / ratFactor (SQL mirror), ratPos, nearestRat, RatView parse
lib/game/farm/sling.ts       NEW pure: the SlingGame state machine (seeded)
lib/game/dog.ts              NEW pure: coats, dogNameRefusal (mirror), dogStatus, feedRefusal, the follower
lib/game/farm/crop.ts, upland.ts        Mrat in the yield and the estimate
lib/game/farm/state.ts, rpc.ts, messages.ts, catalog.ts, handbook.ts, actions.ts   rats, dog, calls, texts, kinds, tab, tasks
lib/game/maps/field.ts, field-art.ts    RAT_HOLES and their painting
lib/game/art/rats.ts, dog.ts (NEW); farm-icons.ts (+5); farm-anim.ts (fa 11, 12)
lib/game/net/protocol.ts                FarmAnim 0–12
lib/presence-modes.ts, lib/realtime.ts, lib/game/social.ts, lib/game/world.ts   presence `dog`, setDog, roster dog
lib/game/engine.ts, components/game/GameCanvas.tsx   dogs, rats, the rat prompt; handle + setRats, dogPounce, dogRecall,
                                        petDog, localPos, lastInputAt
hooks/useDog.ts (NEW); hooks/useField.ts (the 4 new calls, the next_at refetch); hooks/useFarmController.ts (auto-hunt)
components/game/DogPanel.tsx (NEW), farm/SlingGame.tsx (NEW), farm/RatChip.tsx (NEW); CoopPanel, FarmShopPanel,
  RiceDepotPanel, PlotPanel, FarmTasks, Handbook, fishing/BagPanel, farm/Stepper, GameShell
lib/game/overlays.ts         OpenOverlays + dogPanel (in panelOpen) and slingGame (in blocking only, like farmWork)
tests/fixtures/crop-cases.json, upland-cases.json (+ rat cases); tests/sql/v17-smoke.sql (NEW)
```

## 5. Rats

### 5.1 Constants (SQL literals; `rats.ts` mirrors the ones the client shows)

| Name | Value | Name | Value |
|---|---|---|---|
| `RAT_SLOT` / `RAT_JITTER` | 900 s / 300 s | `RAT_RATE` / `RAT_LOSS_CAP` | 0.02 per rat-hour / 0.10 |
| `RAT_LOOKBACK` | 1 800 s | `RAT_BASE_PRICE` | 150 xu |
| `RAT_ALIVE_CAP` / `RAT_PER_CROP` | 3 / 20 | `RAT_HOUR_CAP` / `RAT_DAY_CAP` | 6 / 24 |
| `RAT_RECENT` / `RAT_PURGE` | 10 s / 1 h | `RAT_SPEED` (client) | 48 px/s |

### 5.2 Rat food — `_rat_food(c crops, t) → boolean`

- **Rice** (`c.kind = 'rice'`): `_crop_phase(c, v, t)` in (`ripe`, `overripe`), and not (`c.harvester_at is not null and t ≥ c.harvester_at`).
- **Hoa màu:** `u.rat_food` and `_up_phase(c, u, t)` in (`ripe`, `overripe`). Seeds: khoai and bắp true, ớt false.
- A partly cut rice plot is still food. Every rice variety is food.

### 5.3 The spawn clock — `_rat_sweep(p_room, p_now)`, run by `_field_open` after `_field_sweep`

```
u(k, s)  = ('x' || left(md5(room::text || ':' || k || ':' || s), 8))::bit(32)::bigint / 4294967296.0   -- in [0, 1)
t(k)     = to_timestamp(k * 900 + floor(u(k, 't') * 300))                                            -- whole seconds
k(t)     = k0 when t(k0) ≤ t else k0 − 1, with k0 = floor(epoch(t) / 900)                            -- last candidate ≤ t
```

1. **R1 — flee.** Each live rat (`ended_at is null`) whose plot has no crop carrying its `rat_log` entry (`rat_log @> [{"r": id}]`), or whose crop is not `_rat_food` at `p_now`, ends with `ended_at = p_now, how = 'fled'`; that crop's entry closes (`to = p_now`).
2. **R2 — purge.** Rats with `ended_at < p_now − 1 h` are deleted.
3. **R3 — spawn.** For each k with `k > coalesce(last_k, −∞)` and `k(p_now − 1 800 s) < k ≤ k(p_now)`, in order:
   - `alive` = rats of the room with `spawned_at ≤ t(k)` and (`ended_at is null or ended_at > t(k)`); skip when ≥ 3;
   - the eligible crops: `_rat_food(c, t(k))` and `jsonb_array_length(rat_log) < 20`, ordered by plot; skip when none;
   - plot = eligible[1 + floor(u(k, 'p') · n)]; seed = floor(u(k, 's') · 2 147 483 647);
   - insert the rat with `spawned_at = t(k)`, which drives its path (unique per `(room_id, k)`);
   - append `{"r": id, "from": p_now, "to": null}` to that crop's `rat_log`: a rat found late eats only from this sweep on (D3).

   Then `last_k := greatest(last_k, k(p_now))`, so a far-future `last_k` switches a room's rats off (the earlier smokes use this, §15).
- The sweep never writes `fish_price_index`: at a period change that would lock the index row under the plot locks and before the wallet, which deadlocks against wallet-first callers such as `finish_cast` (v15.3 R12).
- `rats.next_at` in the view is `t(k(p_now) + 1)`, always in the future.
- **Cost.** At most 3 candidates per sweep, each a phase check of ≤ 10 crops. R1 touches ≤ 3 rats.

### 5.4 A rat's life on screen (`ratPos`, pure, identical on every client)

- **Holes** (`RAT_HOLES` in `field.ts`): plots 1–4 at (x + 100, 46) on the bund under the bamboo; plots 5–7 at (x + 100, 310) on the bund between the village rows; plots 8–10 at (x + 100, 412) on the south edge. So 1: (172, 46), 2: (324, 46), 3: (476, 46), 4: (628, 46); 5 and 8: x 172; 6 and 9: x 324; 7 and 10: x 476.
- **Entry.** R is the plot rect inset by 8 px. The rat runs from its hole to E, the point of R nearest the hole, at 48 px/s.
- **Legs.** From arrival time T0, leg i lasts 6 s: a run from P(i − 1) to P(i) (P(−1) = E) lasting min(1.5 s, distance / 48), then nibbling. P(i) = (R.x + a·R.w, R.y + b·R.h), where a and b are the first two draws of mulberry32(seed + 7 919·i). O(1) per frame. Time is `serverNow()`.
- **Endings** (from `rats.recent`, each played once): `fled` runs to its hole in 1.5 s; `sling` shows the "fall" frame and a puff for 0.6 s; `dog` freezes the rat in "fall" while the catcher's dog runs, leaps and carries it back (§7.3). If the catcher is not on this map, a `dog` ending plays as a `sling` ending.

### 5.5 Damage

```
ratHours(log, t) = Σ over entries in log order with from < t of hrs(from, min(to ?? t, t))
Mrat             = 1 − min(0.10, 0.02 · ratHours)
```

- **SQL** `_rat_hours(p_log, p_t)` loops the array with ordinality and adds left to right, so SQL and TS add in the same order (v15.2 R33). `_rat_factor(h)` is the second line.
- **Rice** `_crop_yield` and **hoa màu** `_up_yield` multiply by `Mrat` as the last factor of the product (rice: after every existing factor; hoa màu: right after `Mlate`, before `· pct_k / 100`). Their JSON gains `mrat`. Rice parts, the harvester's step J and pickings use them unchanged, so a part cut while rats eat pays less.
- **TS** `cropYield` and `uplandYield` do the same from `rats.plots[plot]` at `serverNow()`. The estimate counts no future rats, like pests.
- **Scale.** One rat-hour costs 2 %; a rat caught within 15 minutes costs 0.5 %, which usually rounds away (short: 90 × 0.995 → 90 kg). The cap is 5 rat-hours: 3 rats reach it in 1 h 40 min.

### 5.6 Catching, caps and the bag

- **`_rat_caps(account, p_now, p_take)`** locks `farm_profiles` (created if missing):
  - the hourly window is empty once `p_now ≥ rat_win_start + 1 h`; a counted catch then starts a new window at `p_now`;
  - the day is the Vietnam date of `p_now`;
  - it raises `rat limit` (53400, detail = seconds to the window's end) at 6, and `rat daily limit` (53400, detail = seconds to the next Vietnam midnight) at 24;
  - with `p_take` it counts the catch; the catch that makes the day's count 24 logs soft `rat_daily_cap` (`{day, count}`, `rpc` = `sling_shoot` or `dog_hunt` by `how`) once.
- **Room binding.** Every rat lookup (in `sling_start`, `sling_shoot`, `dog_hunt` and `_rat_catch`) is `where id = p_rat and room_id = p_room`; anything else is `rat gone`.
- **`_rat_catch(room, account, rat, how, p_now) → price`**, run after `_wallet_lock`:
  1. lock the rat row (room-bound); missing or ended → `rat gone`;
  2. lock the crop row carrying its entry, if any;
  3. `_rat_caps(…, true)`;
  4. price = `_critter_price(150, (_fish_index(room, p_now)).mult)` = `greatest(1, floor(150 × M))`, which may write the period's index row. That row is the last lock taken;
  5. the rat ends (`how`, `caught_by`, `price`), its crop entry closes, and a `rat_bag` row is added.
- **First valid catch wins.** Every field call of a room runs under `_field_open`'s plot locks, so two catches serialize and the second sees `rat gone`.
- **Selling.** `sell_rats` pays the sum of the bag's stored prices (`rat_sell`, ref `'<n> con'`) and empties it.

## 6. Slingshot

### 6.1 Server

1. **`sling_start(room, rat)`.** Refusals in order: `no sling` (no `tool_sling`), `no pellets`, `rat gone` (no live rat with this id in this room), `rat limit`, `rat daily limit` (a check, no count). It upserts `sling_aims` (one row per account: room, rat, `started_at = p_now`, `last_shot_at = null`, `shots = 0`).
2. **`sling_shoot(room, rat, hit)`.** Refusals in order: `no aim` (no row, or another room or rat), `rat gone`, `too fast` when `p_now < prev + 2 s`, `aim expired` when `p_now > prev + 60 s` (prev = `coalesce(last_shot_at, started_at)`), `no pellets`.
   Then 1 `ammo_pellet` is used and `last_shot_at = p_now`, `shots + 1`. With `coalesce(hit, false)`, `_rat_catch(…, 'sling')` runs (it may raise a cap, which also returns the pellet, D15) and the aim row is deleted.
3. A null `hit` is a miss and is not flagged (v15.2 R7). Two tabs replacing each other's aim get `no aim`.

### 6.2 SlingGame (`lib/game/farm/sling.ts`, overlay `components/game/farm/SlingGame.tsx`)

| Part | Rule |
|---|---|
| Scene | 320 × 180 logical px; the rat runs along a lane at y = 70, x ∈ [16, 304] |
| Rat | seeded by `seed + 7 919 · shot`: runs of 0.5–1.2 s at 60–110 px/s (direction flips at the ends and at random), stops of 0.2–0.6 s |
| Aim | pointer x sets `aimX`; ←/→ move it 180 px/s; touch: drag while holding |
| Draw | hold (Space, mouse button, finger) raises the power 0 → 1 in 1.0 s; release shoots; power 1 releases by itself |
| Result | power < 0.60 "rơi trước"; > 0.85 "bay qua"; otherwise the pellet lands 0.3 s after the release and hits if the lane rat is within ±9 px of `aimX` then |
| Timing | every result waits out the 0.3 s flight, then `sling_shoot` is sent; 2.2 s "Nạp đạn…" follows every answer (and the start answer) |
| Re-aim | measured at the moment a shot would be sent: at 55 s or more after the last sling answer, the shot is dropped (no pellet) and the client re-aims with a new `sling_start`, then reloads 2.2 s. The round trip fits in the last 5 s, so an honest shot never meets the server's 60 s bound. |
| End | a hit, no pellets, `rat gone`, a cap, Esc / "Thôi" (sends nothing) |

- **Honest timing (D16).** After an answer at T, the earliest miss is sent at T + 2.2 + 0 + 0.3 = T + 2.5 s, and the earliest hit at T + 2.2 + 0.6 + 0.3 = T + 3.1 s. The server's `prev` is the earlier transaction time, so its gap is larger still.
- **Animation (D25).** `fa 12` at the start and every 2 s while the overlay is open, then `fa 0`. After a hit: `fp {plot}`.
- **Input.** The v14 rules: the typing guard, pointer, touch, Space. Movement is locked while the overlay is open.

## 7. Dog (chó cỏ)

### 7.1 Adopt, name, feed, pet

- **`adopt_dog(name, coat)`** at chú Tám's. Refusals in order: `invalid name`, `invalid coat` (not `vang` / `muc` / `ven` / `dom`), `already own dog`, `not enough coins`. It pays 20 000 (`dog_adopt`, ref `'dog <coat>'`) and inserts the dog with `fed_until = p_now + 24 h`.
- **`_pet_name(p_name)`:** `v = regexp_replace(btrim(normalize(coalesce(p_name, ''), NFC)), ' {2,}', ' ', 'g')`. It raises `invalid name` unless `char_length(v)` is 2–16, `v` has no character of classes C, S, Z or M (the `register` regex of `0015`), and `_name_key(v)` is not a reserved key. It returns v. `dogNameRefusal` mirrors it for UI hints and counts code points.
- **`rename_dog(name)`:** `invalid name`, `no dog`. Free, any time.
- **`feed_dog()`:** `no dog`, `dog full` (while `fed_until > p_now + 12 h`), `no item` (no `food_dog`). It uses 1 bịch and sets `fed_until = greatest(fed_until, p_now) + 24 h`.
- **Petting** (D27): "🤚 Vuốt ve" in the dog panel. My dog comes to my front and wags, hearts rise, and `fa 11` goes out; the client allows one every 3 s. No RPC.

### 7.2 Hunting

- **`dog_hunt(room, rat)`.** Refusals in order: `no dog`, `dog hungry` (`fed_until` null or ≤ `p_now`), `dog resting` (`next_hunt_at > p_now`, detail = seconds), then `_rat_catch(…, 'dog')`'s `rat gone`, `rat limit`, `rat daily limit`. On success: `next_hunt_at = p_now + 5 min`, `catches + 1`.
- **The client's auto-hunt** (`useFarmController`, every 1 s, D17 and D30) calls it when all hold:
  - I am on the field and my `field_state` is loaded;
  - the dog is fed and rested on `serverNow()`, and my caps have room (`mine.rat_caps`);
  - my last key or pointer input was within 3 minutes (`lastInputAt`);
  - the SlingGame overlay is closed, and I am not locked;
  - no refusal came in the last 10 s;
  - `nearestRat(live, localPos(), serverNow(), 96)` finds a rat.

  The dog starts running at the call (`dogPounce`). On success the client sends `fp {plot}` and toasts; on a refusal the dog comes back (`dogRecall`) and nothing is toasted.

### 7.3 Following and presence

- **Presence (D23):** the payload becomes `{name, online_at, mode, map, dog}` with `dog = {n: name, c: coat}` in game mode and null otherwise. `trackPresence` gains `setDog(dog | null)`. It is merged and budgeted with mode and map (≤ 4 tracks per 30 s), and `published` compares it too.
- **Parsing:** `presenceDog(v)` accepts `n` as a string of 1–16 code points with no C/S/Z character and `c` as a known coat; anything else is null. `PresenceEntry.dog` and `RosterEntry.dog` carry `{name, coat}`, taken from the same meta as `map`.
- **My dog:** `useDog` (GameShell) calls `dog_state` on entering game mode, then applies every dog answer and `mine.dog` from field answers. It passes `{name, coat}` to `setLocal` and to `setPresenceDog`.
- **The follower (`lib/game/dog.ts`, per walking actor with a dog, me included):**
  - it keeps the owner's drawn positions for the last 1 s;
  - while the owner moves (or moved within 0.3 s), it targets the owner's position 450 ms ago;
  - otherwise it targets the heel spot: the owner + HEEL[facing] (down (+10, −2), up (−10, +2), left (+8, +3), right (−8, +3)), else the mirrored spot, else the owner, whichever `isBlockedAt` allows first;
  - it moves at up to 84 px/s and snaps beyond 64 px (portals, restores);
  - poses: walk, idle, and sit after 3 s idle (my own dog sits drooping while hungry).
- **The pounce, derived (D24):**
  - a `rats.recent` entry with `how = 'dog'` whose catcher is on this map sends that owner's dog running at 120 px/s to the rat's `ratPos` at `ended_at`;
  - the dog leaps for 350 ms, then carries the rat back to the heel spot;
  - my own pounce starts at the `dog_hunt` call, and its `recent` entry is not replayed.
- **The rest:** `fa 11` from an owner brings their dog to their front for 2.5 s with hearts. Seated classic members show no dog.

## 8. Items (`shop_items`, anh Hai)

| id | kind | Name | Price | Notes |
|---|---|---|---|---|
| `tool_sling` | tool | Ná | 3 000 | one-time, qty 1 (`already owned`), sort 30 |
| `ammo_pellet` | ammo | Đạn đất | 10 | stacks to 99; the shop sells steps of 10 |
| `food_dog` | pet_food | Thức ăn chó | 150 | stacks to 99; 1 bịch = 24 h |

- **Catalog changes.** `shop_items_kind_check` = the list in force after `0018` + `ammo`, `pet_food`. `FARM_KINDS` gains both.
- **`buy_farm_item`** is re-created: it sells them, and its soft `kind_mismatch` allows them. `bad_qty` stays 1–99.
- **The dog** is not an item: `adopt_dog` charges `DOG_PRICE = 20 000`.
- **`describeFarmItem`:** "Bắn chuột đồng — mua một lần" · "Đạn cho ná · 10 viên 100 xu" · "Cho chó ăn · no 24 giờ".

## 9. Economy check

**Assumptions.**
- Rat season means at least one rat-food plot. The room then gets 4 candidates an hour, and all become rats while fewer than 3 are alive.
- Hunters catch every rat soon after it appears. A catch costs about 2 pellets (a 50 % hit rate), i.e. 20 xu.
- A rat pays floor(150 × M): 150 at M = 1, 750 at M = 5.
- References: fishing earns 1 000–1 800 xu per active hour at M = 1, and 5 000–9 000 at M = 5 (fish follow M); farming nets 20 000–24 182 xu per day per rented plot (v15.2 §10), 40 000–48 364 with the 2-plot limit, for under an hour of actions per season.

| Hunter on a busy field | Rats/h | Net xu/h at M = 1 | Net xu/h at M = 5 |
|---|---|---|---|
| The whole room, all hunters | 4 | 600 (gross, shared) | 3 000 (gross, shared) |
| Solo with a slingshot | 4 | 4 × 150 − 80 = **520** | 4 × 750 − 80 = **2 920** |
| One of 3 sharing | ≈ 1.33 | ≈ 200 − 27 = **173** | ≈ 1 000 − 27 = **973** |
| The hourly cap, several rooms | 6 | 900 − 120 = 780 | 4 500 − 120 = 4 380 |

- **Against fishing.** A solo hunter makes 29–52 % of fishing's hour at M = 1 (520 / 1 800 to 520 / 1 000) and 32–58 % at M = 5. The cap hour (780 / 4 380) stays under fishing at every M, since both scale with M.
- **Against farming.** Per active hour farming is far ahead. Per day the cap allows 24 × 150 × M: 3 600 at M = 1, 18 000 at M = 5, and 36 000 at M = 10, still below two rented plots (≥ 40 000). Reaching 24 takes just over 3 hours at the hourly cap: 6 catches at the start of each of four back-to-back windows. In one room it takes about 6 hours.
- **The damage** (full care, village plot, uncaught rats until the cap):
  - short 90 → 81 kg (−6 390 xu), nếp 75 → 68 kg (−6 650), thơm 60 → 54 kg (−8 100);
  - khoai 200 → 180 kg (−5 300), bắp 150 → 135 kg (−6 900).

  That is 12–13 % of a season's profit (v15.2 §10 headlines: 50 300 / 57 350 / 66 500 / 40 000 / 55 200). One rat-hour costs 2 % (1–4 kg). A rat caught within 15 minutes costs rice nothing after rounding, and hoa màu about 1 kg.
- **The slingshot** pays back after 3 000 / 130 = 23.1, so 24 rats at M = 1 (about 6 h of solo hunting), and 3 000 / 730 = 4.1, so 5 rats at M = 5.
- **The dog** costs 20 000 plus 150 a day of use. The table assumes it takes the rats near its owner:

| Player (field time per day, in season) | Dog's rats/day | Net/day at M = 1 → payback | Net/day at M = 5 → payback |
|---|---|---|---|
| Casual (≈ 1 h) | 2 | 300 − 150 = 150 → 134 days | 1 500 − 150 = 1 350 → 15 days |
| Regular (≈ 2–3 h) | 6 | 900 − 150 = 750 → 27 days | 4 500 − 150 = 4 350 → 5 days |
| Dedicated (≈ 3 h, dog wins every rat) | 12 | 1 800 − 150 = 1 650 → 13 days | 9 000 − 150 = 8 850 → 3 days |

  At M = 1 the dog is a companion first, and pays back within a month only for regular and dedicated players. In rich rooms it pays back within a week or two. Like any hunter it is bound by the caps (6 an hour, 24 a day) and by the room's ≈ 4 rats an hour.
- **The protection value** (up to 5 300–8 100 xu per unattended plot) goes to whoever hunts, and neighbours help. That is the social point.
- **Tuning.** Prices are in `shop_items` and SQL constants (`RAT_BASE_PRICE`, `DOG_PRICE`), so tuning is a data change plus one literal each.

## 10. Server — `0019_v17_rats.sql`

### 10.1 Sections (in order; `language sql` bodies are checked at creation)

| Section | Contents |
|---|---|
| **A** Catalog | `upland_crops.rat_food` (update khoai, bắp true); the kind check; the 3 items; the `coin_ledger` check = the list in force after `0018` (`daily`, `song`, `sell`, `buy`, `rent`, `land_buy`, `land_sell`, `land_refund`, `lease_pay`, `lease_income`, `farm_buy`, `rice_sell`, `wipe`, `harvester`, `produce_sell`, `card_hold`, `card_settle`, `card_buyin`, `card_cashout`, `card_refund`, `critter_sell`) + `rat_sell`, `dog_adopt` |
| **B** Tables | §10.2, with RLS on, no policies, and `revoke all … from anon, authenticated` |
| **C** Model | `_rat_u`, `_rat_t`, `_rat_factor` (immutable); `_rat_k`, `_rat_hours`, `_rat_close`, `_rat_food`, `_pet_name` (stable: they cast text to `timestamptz` or use `unaccent`, like `_water_at`); `_crop_yield` and `_up_yield` re-created with Mrat. Prices reuse `0018`'s `_critter_price` and `_critter_prices`. |
| **D** Field | `_rat_sweep`, `_rat_caps`, `_rat_catch`, `_dog_view`, `_rats_view`; re-created: `_field_open` (+ `_rat_sweep` after `_field_sweep`), `_field_view` (+ `'rats', _rats_view(room, p_now)`), `_farm_mine` (the kinds `ammo`, `pet_food`; + `rats`, `rat_caps`, `dog`) |
| **E** RPCs | the 7 guarded RPCs and `dog_state`, with grants; `buy_farm_item` re-created, keeping its guard |
| **F** Anti-cheat | `_ac_holdings` and `_ac_wipe` re-created (§10.7) |

Every helper is revoked from `public`, `anon` and `authenticated`.

### 10.2 Tables and columns

```sql
alter table public.upland_crops add column if not exists rat_food boolean not null default false;
alter table public.crops add column if not exists rat_log jsonb not null default '[]'::jsonb;  -- [{r, from, to}]
create table if not exists public.field_rats (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  plot_no smallint not null check (plot_no between 1 and 10),
  k bigint not null, seed integer not null, spawned_at timestamptz not null,
  ended_at timestamptz, how text check (how in ('sling','dog','fled')),
  caught_by uuid references public.accounts(id) on delete set null, price integer check (price > 0),
  unique (room_id, k));
create index if not exists idx_field_rats_room on public.field_rats (room_id, ended_at);
create table if not exists public.rat_clocks (room_id uuid primary key references public.rooms(id) on delete cascade,
  last_k bigint not null);
create table if not exists public.rat_bag (id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  price integer not null check (price > 0), caught_at timestamptz not null, how text not null check (how in ('sling','dog')));
create index if not exists idx_rat_bag_account on public.rat_bag (account_id);
create table if not exists public.dogs (account_id uuid primary key references public.accounts(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 16), coat text not null check (coat in ('vang','muc','ven','dom')),
  adopted_at timestamptz not null, fed_until timestamptz, next_hunt_at timestamptz,
  catches integer not null default 0 check (catches >= 0));
create table if not exists public.sling_aims (account_id uuid primary key references public.accounts(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade, rat_id bigint not null,
  started_at timestamptz not null, last_shot_at timestamptz, shots smallint not null default 0);
alter table public.farm_profiles add column if not exists rat_win_start timestamptz;
alter table public.farm_profiles add column if not exists rat_win_count smallint not null default 0;
alter table public.farm_profiles add column if not exists rat_day_on date;
alter table public.farm_profiles add column if not exists rat_day_count smallint not null default 0;
```

### 10.3 Private functions

- **The model:** §5.2–§5.5. `_rat_close(log, rat, t)` sets `to = t` on the entry with `r = rat` and `to` null, and leaves the rest.
- **The field:** §5.3 (`_rat_sweep`), §5.6 (`_rat_caps`, `_rat_catch`).
- **`_dog_view(account)`:** null, or `{name, coat, adopted_at, fed_until, next_hunt_at, catches}`.
- **`_rats_view(room, p_now)`:** §10.5.
- **Re-created from their latest bodies (`0013`–`0018`):**
  - `_crop_yield` and `_up_yield` gain the Mrat factor and `mrat`;
  - `_field_open` gains `perform _rat_sweep(p_room, p_now)` last;
  - `_field_view` gains the `rats` key;
  - `_farm_mine` gains the two kinds in `items`, plus `rats`, `rat_caps` (computed at `now()`, as the function takes no `p_now`) and `dog`;
  - `buy_farm_item`, `_ac_holdings` and `_ac_wipe` (§10.7, §16). Nothing else in them changes; `_field_sweep` and `_plot_view` are untouched (D28).
- **Lock order.** The room's plot rows (`_field_open`; the sweep locks only crop and rat rows under them, never the index) → the wallet (`_wallet_lock`) → the dog row (`dog_hunt`) → the rat row → the crop row → `farm_profiles` → `anticheat_status` (a soft flag) → the room's `fish_price_index` row, last and only in a catch.
  - The plot locks serialize every field call of the room, and the wallet serializes the account's own rows across rooms and tabs.
  - The index row always comes after the caller's wallet, as in `finish_cast` and v15.3's `_critter_add`, so no path holds the index row while waiting for a wallet.
  - The status row comes after the wallet (anti-cheat R16).

### 10.4 Public RPCs

All are SECURITY DEFINER with `set search_path = public, extensions` and an explicit `grant execute … to anon, authenticated`. Each public RPC runs its guard (`_ac_play` or `_ac_account`), then its private twin `_rat_do_*` / `_dog_do_*` with `now()`. The twin takes `p_now`, so tests move time, and starts with `_field_open(room, p_now)` then `_wallet_lock` (room RPCs) or `_wallet_lock` alone (account RPCs).

| RPC | Returns | Refusals |
|---|---|---|
| `sling_start(p_room_id uuid, p_session_token text, p_rat_id bigint)` | `field_state ‖ {aim: {rat, started_at}}` | §6.1 |
| `sling_shoot(p_room_id uuid, p_session_token text, p_rat_id bigint, p_hit boolean)` | `field_state ‖ {shot: {hit, price \| null, pellets}}` | §6.1 |
| `dog_hunt(p_room_id uuid, p_session_token text, p_rat_id bigint)` | `field_state ‖ {dog_hunt: {price}}` | §7.2 |
| `adopt_dog(p_session_token text, p_name text, p_coat text)` | `{server_now, dog, food, coins}` | §7.1 |
| `rename_dog(p_session_token text, p_name text)` | `{server_now, dog, food, coins}` | §7.1 |
| `feed_dog(p_session_token text)` | `{server_now, dog, food, coins}` | §7.1 |
| `sell_rats(p_session_token text)` | `{server_now, mine, sold: {count, xu}}` | `nothing to sell` |
| `dog_state(p_session_token text)` — a read, `_auth_account`, allowlisted | `{server_now, dog, food, coins}` | — |

`food` is the `food_dog` count and `coins` the wallet.

### 10.5 JSON

```jsonc
"rats": {                                        // in every field_state answer
  "next_at": "…", "price": 336,                  // t(k(now)+1); _critter_price(150, _critter_prices(room, now).mult)
  "live":   [{ "id": 812, "plot": 3, "since": "…", "seed": 1234567 }],
  "recent": [{ "id": 811, "plot": 3, "since": "…", "seed": 99, "ended_at": "…", "how": "sling" | "dog" | "fled",
               "by": { "id": "…", "name": "Lan" } | null, "dog": "Mực" | null }],   // ended in the last 10 s
  "plots":  { "3": [{ "r": 811, "from": "…", "to": "…" }, { "r": 812, "from": "…", "to": null }] }  // non-empty rat_logs
},
"mine": { …, "items": { "tool_sling": 1, "ammo_pellet": 40, "food_dog": 3, … },
  "rats": { "count": 2, "value": 486 },
  "rat_caps": { "hour_left": 4, "hour_resets_at": "…" | null, "day_left": 21 },
  "dog": null | { "name": "Mực", "coat": "muc", "adopted_at": "…", "fed_until": "…", "next_hunt_at": "…" | null, "catches": 12 } }
```

- **`_rats_view` never writes.** `price` comes from v15.3's `_critter_prices`: the period's snapshot, or the `_fish_mult(_room_wealth(…))` preview.
- **The view judges each live rat itself.** A rat whose crop entry is gone, or whose crop is no longer food at `p_now`, is listed in `recent` as `fled` (`ended_at = p_now`, `by` null) even before a sweep ends its row. So the acting client's own answer never shows a rat on a bare plot, e.g. after the sixth part.
- **TS.** `FieldState.rats: FieldRats | null`; an answer without `rats` gives null. `FieldMine` gains `rats`, `ratCaps` and `dog`, defaulting to 0 / full caps / null. The client only displays `rats.price` and `shot.price`.

### 10.6 Errors → Vietnamese (`farmErrorMessage`; the dog calls share it)

| Server | Vietnamese |
|---|---|
| `no sling` | Chưa có ná — mua ở tiệm anh Hai. |
| `no pellets` | Hết đạn đất — mua ở tiệm anh Hai. |
| `rat gone` | Con chuột này không còn nữa. |
| `rat limit` (details = s) | Bạn bắt đủ 6 con chuột trong giờ này rồi — nghỉ {durationVi(s)} nhé. |
| `rat daily limit` | Hôm nay bạn bắt đủ 24 con chuột rồi — mai nhé! |
| `no aim` | Ná chưa giương — thử lại nhé. |
| `aim expired` | Giương ná lâu quá — ngắm lại nhé. |
| `too fast` (SlingGame context, `farmErrorMessage(err, item?, "sling")`) | Đang nạp đạn… |
| `no dog` | Bạn chưa nuôi chó. |
| `dog hungry` | Chó đói rồi — cho ăn trước đã. |
| `dog resting` (details = s) | Chó đang nghỉ — {durationVi(s)} nữa mới vồ tiếp. |
| `dog full` | Chó còn no — chưa ăn thêm được. |
| `already own dog` | Bạn đã nuôi một con rồi — mỗi người một con thôi. |
| `invalid name` | Tên chó cần 2–16 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã…) hoặc ký tự ẩn. |
| `nothing to sell` | Chưa có con chuột nào để bán. |
| `no item` with "thức ăn chó" | Chưa có thức ăn chó — ghé tiệm anh Hai. (the existing text) |
| a missing v17 RPC (`NOT_OPEN_17`) | Mùa chuột chưa mở — chủ phòng cần chạy migration 0019. |
| `invalid coat` | not mapped: "Có lỗi, thử lại nhé." |

### 10.7 Anti-cheat

| RPC | Guard | Checks after the guard |
|---|---|---|
| `sling_start`, `sling_shoot`, `dog_hunt` | `_ac_play` | none: rat ids come from the state, and a null id is `rat gone` |
| `adopt_dog`, `rename_dog`, `feed_dog`, `sell_rats` | `_ac_account` | none: names are typed and refused plainly; a bad coat is a plain refusal (D26) |
| `buy_farm_item` (re-created) | `_ac_account` | as before; `kind_mismatch` allows `ammo` and `pet_food` |

- **The lock (D2 of the anti-cheat).** The 7 join the locked list, 59 in all. `WARN_LOCK` and `BAN_WIPE` take the final texts in §16.
- **The guard file.** `anticheat-guards.sql` adds `'dog_state(text)'` to its allowlist, which names signatures since `de9ae10`, and the 7 to its dynamic loop.
- **Soft signal `rat_daily_cap`** (§5.6), labelled "Chạm 24 con chuột/ngày" in /admin. `reasonText` keeps its generic fallback.
- **Refusals that never count:** every §10.6 error, including `too fast` and `aim expired`. The honest causes are two tabs, a stale state, a background tab, and another hunter or dog first.
- **The wipe.**
  - `_ac_wipe` deletes `dogs`, `rat_bag` and `sling_aims` rows; the wipe's existing inventory delete takes pellets, food and the ná.
  - `_ac_holdings` gains `"dog": _dog_view(account)` and `"rats": {count, value}`.
  - The admin holdings line gains `· {n} con chuột` and, with a dog, `· chó {tên}`.
- **Accepted residuals** (README trust model):
  - a script can report a hit on every shot at the 2 s gate, and call `dog_hunt` from any map at the cooldown;
  - either way it catches only rats that exist (≈ 4 an hour per room), at most 6 an hour and 24 a day, at the normal price;
  - a soft counter for hits under 3 s (no honest client can send one, D16) is left to later, as v15.2 left its part counter.

## 11. Realtime, presence and budget

- **Rats.**
  - Spawns send nothing. A client on the field refetches at `rats.next_at` plus a random 0–10 s, at most once per 60 s, and only in rat season. The timer resets with each newer state.
  - Rat season is `ratSeason(state, catalog, next_at)`: `rats.live` is non-empty, or some plot's crop is rat food at `next_at` by the client's phase models (rice ripe or overripe with no harvester job; khoai or bắp ripe or overripe, from `upland_crops.rat_food`, which the TS catalog parses as `ratFood`).
  - A catch sends one `fp {plot}`, and a flee shows at the next fetch. The existing `fp` gather (400 ms) and the 2 s refetch gap apply.
- **The slingshot:** `fa 12` at the start and every 2 s, then `fa 0`; a 12 s session sends 7.
- **Petting:** one `fa 11` per pet, at most one every 3 s.
- **`FarmAnim`** becomes 0–12, and the parser accepts ≤ 12. v15.2 took 9 and 10; v15.3's crab and snail work reuses 6 and 7. The plan checks `FARM_ANIM` first and shifts to the next free codes if `0018`'s client took 11.
- **The dog** sends 0 messages. Presence re-tracks when the dog is learned on game entry, adopted or renamed (+≈ 30 bytes), inside the ≤ 4 per 30 s budget.
- **Cost.** 10 players on a busy field with 4 catches and 6 sling sessions an hour:
  - Broadcast: `fp` 4 × 10 = 40 deliveries and `fa` ≈ 6 × 7 × 10 = 420, against ≈ 110 k an hour for 10 walking players (README v13);
  - Postgres: ≈ 40 scheduled (in season only) plus ≈ 40 `fp` refetches of `field_state` an hour.
- **Receive budgets.** `fa 12` at 0.5/s stays inside `fs`/`fa`'s 2/s. The presence filter (`isHere`) already covers `fa`.
- **Trust model (README).**
  - The server decides the spawns, which plots rats eat, the damage, the prices, the caps, and the dog's hunger and cooldown.
  - Clients report a shot's hit or miss and when their dog pounces.
  - Rat and dog positions, the minigame and presence's `dog` are client-side and spoofable, and cosmetic.

## 12. Game UI

### 12.1 On the field

- **RatChip**, under `MapCounts` on the field while `rats.live` is not empty: "🐀 Mùa chuột · {2} con". Its `aria-label` is "Mùa chuột: {2} con chuột đang phá đồng — mở Sổ tay". It opens the handbook at "Chuột, chó & ná".
- **The rat prompt.** When no map interactable is within `PROMPT_RANGE` (26 px, `nearestInteractable`), the engine offers the nearest live rat within 40 px as a synthetic interactable (`kind: "rat"`, `rat: id`). A plot, an NPC or a portal always wins E, and a test pins that. `InteractKind` gains `"rat"` and `Interactable` gains `rat?: number`. A tap on a rat walks toward it.
  - The prompt reads "E · Bắn chuột", "E · Chuột đồng (cần ná)" or "E · Chuột đồng (hết đạn)".
  - Without gear, E toasts the §10.6 text.
  - With gear, E calls `sling_start` and opens the overlay.
- **PlotPanel** (a plot with a rat log or live rats): the status line "🐀 {2} con chuột đang ăn · đã mất ~{3}% (tối đa 10%)" ("dưới 1%" below 1), and the handbook link goes to "Chuột, chó & ná". The farmer's estimate includes Mrat.
- **FarmTasks:**
  - "Thửa {3} · 🐀 Chuột đang phá ({2} con) — bắn ná, dẫn chó tới hoặc thu hoạch cho xong", urgent;
  - an account line without a plot, "🐕 {Mực} đói — cho ăn để nó săn chuột", not urgent.
- **Toasts:** "🐀 Chuột mò ra phá thửa {3} của bạn!" (the farmer, once per rat) · "🐕 {Mực} vồ được một con chuột! Đem bán cho cô Út nhé." · "💰 Bán {3} con chuột được {450} xu.".

### 12.2 SlingGame overlay

| Moment | Text |
|---|---|
| Title / help | 🎯 Bắn chuột · thửa {3} — "Rê chuột hoặc bấm ←/→ để ngắm. Giữ Space (hoặc giữ chuột, giữ ngón tay) cho dây căng tới vùng xanh rồi thả." |
| Status | Đạn: {12} viên · Nạp đạn… |
| Hit | 🎯 Trúng! Bắt được chuột đồng — {336} xu, đem bán ở vựa cô Út. |
| Misses | Hụt — đạn rơi trước. · Hụt — căng quá, đạn bay qua. · Hụt — lệch rồi. |
| Gone | Chuột bị {Lan} bắt mất rồi! · Chuột bị {Mực} của {Dat} vồ mất rồi! · Chuột chạy về hang rồi. |
| Out, cancel | Hết đạn đất — mua ở tiệm anh Hai. · Thôi (Esc) |

The canvas holds a golden paddy lane, the rat at ×2, a crosshair, the ná at the bottom with its pulled band, and a vertical power bar with the green band. Under reduced motion there is no shake and the pellet flies without a trail. The overlay registers `slingGame` in `overlayLocks` (§4), and DogPanel registers `dogPanel`.

### 12.3 Dog panel and adoption

- **The HUD.** The player card gains "🐕 {Mực}" (with "!" while hungry), opening **DogPanel**, a parchment modal:
  - "Chó cỏ lông {mực} · nuôi từ {26/9}";
  - "🍖 No — còn {18 giờ}" or "🍖 Đói — cho ăn để nó đi săn";
  - "🐀 Sẵn sàng — ra đồng, đứng gần chuột là nó vồ", "🐀 Nghỉ — vồ tiếp sau {3:12}" or "🐀 Đói nên không săn";
  - "🏅 Đã bắt {12} con chuột".
- **Its buttons:**
  - "🦴 Cho ăn ({3} bịch)", disabled with "Còn no hơn 12 giờ — chưa ăn thêm được." or "Hết thức ăn chó — mua ở tiệm anh Hai.";
  - "✏️ Đổi tên", with an input, "Lưu" and "Huỷ", and the `dogNameRefusal` hint;
  - "🤚 Vuốt ve".
- **Its toasts:** "🦴 {Mực} ăn ngon lành — no 24 giờ." · "✏️ Đã đổi tên thành {Ki}.".
- **CoopPanel tab "🐕 Chó cỏ"**, placed before "Của tôi":
  - the intro "“Chó cỏ nhà chú mới đẻ một bầy, con nào cũng khôn. 20.000 xu con mang về nuôi — nhớ cho ăn mỗi ngày, mùa lúa chín nó bắt chuột giỏi lắm!”";
  - four coat buttons (sprites, `aria-pressed`): Vàng, Mực, Vện, Đốm;
  - "Tên" (defaulting to the coat's name, hint "2–16 ký tự");
  - "Nhận nuôi · 20.000 xu", which confirms "Nhận nuôi {Mực} (lông {mực}) với giá 20.000 xu? Mỗi người chỉ nuôi một con.";
  - when a dog is owned: "Bạn đã nuôi {Mực} rồi — mỗi người một con thôi." and "Mở bảng chó";
  - the toast "🐕 Chào mừng {Mực} về nhà! Nó sẽ theo bạn khắp nơi.".

### 12.4 Shop, depot and bag

- **FarmShopPanel.** "🛠️ Nông cụ" gains the Ná row ("Mua · 3.000 xu" / "✓ Đã có"). A new section "🐾 Đạn & thức ăn chó" holds:
  - Đạn đất ("10 xu/viên"), with `Stepper by={10}`, max = min(99 − held, floor(coins / 10)) and a start of min(10, max); the button reads "Mua {10} viên · {100} xu";
  - Thức ăn chó ("150 xu/bịch · no 24 giờ"), with the plain stepper.

  `Stepper` gains `by` (default 1).
- **RiceDepotPanel.**
  - The row "🐀 Chuột đồng · {2} con" / "{486} xu (giá chốt lúc bắt)" with "Bán hết · {486}", and under it "Giá chuột bây giờ: {336} xu một con" (`rats.price`).
  - The intro when only rats are in stock: "“Chuột đồng béo vậy, cô lấy hết — đem nướng lu là ngon số một!”".
  - The empty text adds "hay chuột".
- **BagPanel "🌾 Nông cụ":** "Ná — còn {12} viên đạn đất" or "Chưa có ná — tiệm anh Hai bán 3.000 xu"; "Thức ăn chó — {3} bịch".

## 13. Handbook — tab "Chuột, chó & ná" (`HandbookTab` `"rats"`, verbatim, one line each)

- **Mùa chuột**
  - "Lúa, khoai lang, bắp chín là mùa chuột đồng. Chuột đào hang dưới bờ ruộng, cứ 10–20 phút lại có một con mò ra ăn một thửa đang chín; cả đồng cùng lúc tối đa 3 con. Ớt cay, chuột chê."
  - "Mỗi con chuột ngồi trên thửa ăn mất 2% sản lượng mỗi giờ; cộng lại chuột lấy tối đa 10% một vụ. Bắt được trong 15 phút thì gần như không mất gì."
  - "Chuột chỉ chịu đi khi bị bắt, hoặc khi thửa đó gặt xong cả 6 phần (hay đào, bẻ xong), thuê máy gặt, bỏ vụ hoặc bị mất. Gặt dở chừng thì chuột vẫn ăn phần còn lại."
  - "Chuột là của chung cả đồng: ai bắt trước thì được, kể cả chuột trên ruộng người khác. Mỗi người bắt tối đa 6 con mỗi giờ, 24 con mỗi ngày."
  - "Chuột bắt được bán cho cô Út: 150 xu × hệ số phòng (như giá cá), chốt giá lúc bắt."
- **Ná**
  - "Ná 3.000 xu, mua một lần ở tiệm anh Hai. Đạn đất 10 xu một viên — 10 viên 100 xu."
  - "Lại gần con chuột, bấm E (hoặc chạm vào nó) để giương ná. Rê chuột hoặc bấm ←/→ để ngắm; giữ Space (hoặc giữ chuột, giữ ngón tay) cho dây căng tới vùng xanh rồi thả."
  - "Căng chưa tới vùng xanh là đạn rơi trước, căng quá là đạn bay qua. Đạn bay mất một chút: chuột đang chạy thì ngắm đón đầu, hoặc chờ nó dừng lại gặm lúa."
  - "Mỗi phát tốn 1 viên, trúng là bắt được. Bắn xong phải nạp đạn 2 giây."
- **Chó cỏ**
  - "Nhận nuôi ở Hợp tác xã (chú Tám): 20.000 xu, mỗi người một con. Chọn màu lông vàng, mực, vện hay đốm, rồi đặt tên."
  - "Chó theo bạn khắp nơi: sảnh, ao cá, đồng ruộng. Ai trong phòng cũng thấy nó."
  - "Mỗi ngày cho ăn 1 bịch thức ăn chó (150 xu, tiệm anh Hai): no 24 giờ; còn no hơn 12 giờ thì chưa ăn thêm. Chú Tám cho ăn bữa đầu."
  - "Chó no, bạn ở ngoài đồng và đứng gần con chuột (cỡ một thửa ruộng) là nó tự vồ — 5 phút một lần, vồ là trúng. Chó đói chỉ đi theo; bạn ngồi im quá 3 phút thì nó cũng thôi săn."
  - "Vuốt ve cho vui — không tốn gì."
- **"Mẹo"** gains: "Lúa chín là mùa chuột — thu hoạch cho xong sớm (hoặc thuê máy gặt), hay rủ hàng xóm ra bắn chuột giùm."

## 14. Art (original, drawn in code)

- **`art/rats.ts`.** Frames are 10 × 7 px, side view, mirrored for left: run 0/1, nibble 0/1 (head down, a grain `#e0b33c`) and fall (on its back).
  - Fur `#7a6450`, shade `#5a4636`, belly `#b8a48a`, ears and tail `#c98f86`, eye `#1c1410`, partial outline `#2e2218`. The SlingGame rat is the same art at ×2; rats are depth-sorted with props and people.
- **Holes** (`field-art.ts`): a 7 × 4 ellipse `#24190f`, a south rim `#6e5230` and three crumbs `#8a6a3f`, one per `RAT_HOLES` point. The map test pins that they avoid solids, the canal, use spots (≥ 16 px) and name posts.
- **`art/dog.ts`.** Frames are 20 × 16 px, anchored at (10, 15), for down, up and right (left mirrored):
  - walk 0–3, idle, sit, hungry-sit (ears and tail down), run 0/1, leap, wag 0/1 and carry (walk with the fall-rat at the mouth);
  - palette letters: b body, B shade, w muzzle and belly, d detail, n nose and e eyes `#1c1410`, t tongue `#d9776a`, c collar `#c0392b`.

  | Coat | b | B | w | d |
  |---|---|---|---|---|
  | vàng | `#c8913f` | `#9a6a2c` | `#ecd3a2` | = B |
  | mực | `#2f2a28` | `#1b1716` | `#5a4f48` | = B |
  | vện | `#a8783e` | `#7a5226` | `#d8b88a` | `#4a3018` stripes |
  | đốm | `#efe6d4` | `#c9bca4` | `#fbf6ea` | `#4a3a2a` spots |

  Frames are cached per coat, like `getCharacterFrames`.
- **`farm-icons.ts`** (16 × 16, `iconMatrixFor`):
  - `tool_sling`: a Y fork `#8b5a33` / `#6e4424`, band `#2e2a2a`, pouch `#b0643a`;
  - `ammo_pellet`: three clay balls `#a0522d`, lit `#c9784a`, on cloth `#d9c9a0`;
  - `food_dog`: a sack `#d9c27a` / `#b8a05a` with a bone `#f4efe0`;
  - `rat` (the depot row): the map rat's run frame, scaled up and outlined;
  - `dog_bowl` (the dog panel): a clay bowl `#b0643a` / `#8a4a26` with kibble `#8b5a33`.
- **`farm-anim.ts`:** 11 petting, the hand lowered in front and three hearts `#e0526a` rising; 12 aiming, the fork at the hand with the band `#2e2a2a` drawn back to the chest and a pellet `#a0522d`, trembling every other beat. Under reduced motion each holds one pose.

## 15. Testing

- **Shared fixtures.**
  - `crop-cases.json` gains, on a village plot with full care, harvested inside the ripe window:
    - R1, short with one rat for 2 h → Mrat 0.96, 86 kg;
    - R2, nếp with three rats summing exactly 5 h → Mrat 0.90 (the cap), 68 kg;
    - R3, thơm with a live rat (`to` null) for 3 h at the cut → 0.94, 56 kg;
    - R4, rice parts cut while a rat eats (`partKg` at each Y(t)).
  - `upland-cases.json` gains U1, khoai textbook with a 1 h rat → 0.98, 196 kg, and U2, bắp textbook with a 1 h rat → 0.98, 147 kg.
  - `edges`: an entry with `from = t` counts 0, and one with `to = t` counts fully; entries are summed in log order. The plan computes every kg once and checks two by hand.
- **Pure TS (Vitest).**
  - `rats.ts`:
    - `ratHours` and `ratFactor` against the fixtures;
    - `ratPos` is deterministic, inside the inset after entry, and follows the hole → E run and the 6 s legs;
    - `nearestRat` by distance and radius; the `rats` parse, and old answers giving null.
  - `sling.ts` (seeded): the band edges 0.60 and 0.85, and the auto-release at 1.0 as "bay qua"; ±9 px at landing; the 2.2 s reload; no hit result before T + 3.1 s and no result before T + 2.5 s, over 1 000 random inputs.
  - `dog.ts`:
    - `dogNameRefusal` on the names the SQL smoke refuses and accepts;
    - `dogStatus` (fed, hungry, ready, resting) and `feedRefusal` (12 h, no food);
    - the follower: heel spots on free cells (a blocked side falls back), a snap beyond 64 px, the lag, sitting after 3 s.
  - The rest:
    - `presence-modes` (`presenceDog`, aggregation) and `realtime` (`setDog` re-tracks inside the budget; classic publishes null);
    - `protocol` (`fa` 11 and 12 accepted, 13 refused);
    - `messages` (every §10.6 row, and `too fast` with and without the sling context);
    - `catalog` (kinds, items, descriptions), `handbook` (the tab), `actions` (the rat and dog tasks);
    - `game-field-map` (10 holes, one per plot, clear of solids, the canal, use spots and posts);
    - the rat prompt's precedence: a rat within 40 px never takes E from a plot, NPC or portal within `PROMPT_RANGE`;
    - `overlayLocks`: `slingGame` blocks the canvas but leaves `panelOpen` false; `dogPanel` sets both;
    - `ratSeason` (live rats; a ripe rice, khoai or bắp plot at `next_at`; not ớt, and not a harvester job);
    - the art tests (every coat, facing and frame; icons 16 × 16 with complete palettes).
- **SQL smoke** (`tests/sql/v17-smoke.sql`). Replay `0004`…`0019`, run the earlier smokes with the edits below, then replay `0019` and run it again.
  - **Earlier smokes on a `0019` database (rats off in their rooms).**
    - `v15-smoke.sql`, `anticheat-smoke.sql`, `v15-2-smoke.sql` and `v15-gather-smoke.sql` each gain one setup block at the top. It defines `pg_temp.no_rats(p_key text)`, which does nothing while `to_regclass('public.rat_clocks')` is null. Otherwise it runs, through `execute`, `insert into public.rat_clocks (room_id, last_k) select v::uuid, 9000000000000000000 from smoke where k = p_key on conflict (room_id) do update set last_k = excluded.last_k`.
    - Each smoke then calls it right after it creates a room: `select pg_temp.no_rats('room')` and `'room2'` in `v15-smoke.sql`; `'room'`, `'froom'`, `'sroom'`, `'aroom'` and `'aroom2'` in `anticheat-smoke.sql`; `'room'` and `'room3'` in `v15-2-smoke.sql`; every room key of `v15-gather-smoke.sql`. The v14 and v16 smokes grow no crops and need nothing.
    - **Fallback:** the SQL check runs those four smokes before replaying `0019`.
  - **Clock:** t(k) is whole seconds and 601–1 199 s apart over 1 000 k; `k(t(k)) = k` and `k(t(k) − 1 s) = k − 1`.
  - **Spawning:**
    - a room with a ripe plot spawns at t(k) when `_field_open` runs after it;
    - a sweep 3 h after the last one evaluates only the last 30 min, and a rat found late has `spawned_at = t(k)` but its log entry opens at that sweep's `p_now`;
    - `last_k` stops re-evaluation, and a re-run keeps one rat per `(room, k)`;
    - a far-future `last_k` spawns nothing and survives the sweep (`greatest`);
    - the 3-alive cap, and 20 per crop;
    - no rat for ớt, an unripe crop or a started harvester;
    - khoai and bắp do get rats.
  - **Life:**
    - in the same `_field_open`, a lease end (step 4) and fallen rice (step 6) make R1 flee the rat;
    - after the sixth rice part, a khoai or bắp picking or `abandon_crop`, the acting call's answer lists the rat in `recent` as `fled` (not in `live`), and the next sweep ends its row;
    - `rent_harvester` on a plot with a live rat: the answer lists it as fled. A `_field_open` 10 s later ends the rat and closes its log entry at its `p_now`, while the crop row remains. Step J at `harvester_until` then counts the rat only up to that `to`;
    - the purge after 1 h.
  - **Damage:** the fixture cases replay through `_crop_yield` / `_up_yield`; a part cut with a rat pays `partKg(i, Y(t))` with Mrat.
  - **Room binding:** a live rat of room B, called through room A with `sling_start`, `sling_shoot` or `dog_hunt`, is `rat gone`. The rat, the pellets, the aim, the dog and the bag are unchanged.
  - **Slingshot:**
    - `no sling`, `no pellets`, `rat gone`;
    - a shot at 1.9 s is `too fast` and at 2.0 s is accepted;
    - 61 s idle is `aim expired`; another rat or room is `no aim`;
    - a miss uses 1 pellet; a refused hit uses none;
    - a hit prices at `floor(150 × M)`: M 2.24 → 336, and M 1.13 → 169 (round would give 170). It ends the rat and adds the bag row;
    - two accounts hitting one rat: the first wins, the second gets `rat gone`.
  - **Prices:** in a new period, `field_state` shows `rats.price` from the `_critter_prices` preview and writes no `fish_price_index` row. The next catch writes the row, after its wallet.
  - **Caps:** the 7th catch in a window is `rat limit` with a numeric detail, and a catch after the window works; the 25th of a day is `rat daily limit`; `rat_daily_cap` is logged once, soft.
  - **Dog:**
    - `adopt_dog` refusals (a name of 1 and of 17 characters, `Ao cá`, a zero-width name, coat `x`, a second dog, 19 999 xu), the `dog_adopt` row and 24 h fed;
    - `feed_dog` (`dog full` above 12 h, and the extension from max(now, fed_until));
    - `dog_hunt` (`dog hungry`, `dog resting` with a detail, the cooldown, `catches`); `rename_dog`.
  - **Selling:** the sum of stored prices, a `rat_sell` row, and `nothing to sell`.
  - **Items:** `buy_farm_item` sells the 3 items (the ná once), and the ledger check accepts every listed reason.
  - **Anti-cheat:** a wipe clears `dogs`, `rat_bag`, `sling_aims`, pellets and food, and the snapshot has them; anon cannot select the 5 tables. It ends with `\i tests/sql/anticheat-guards.sql` (allowlist + loop).
- **Components and hooks** (RTL, `afterEach(cleanup)`).
  - **SlingGame:**
    - Space, pointer and touch; the typing guard;
    - Esc sends nothing;
    - with fake timers, no `sling_shoot` earlier than 2.2 s + draw + 0.3 s after an answer;
    - a shot ready 55 s or more after the last answer is dropped and a new `sling_start` goes out instead;
    - `rat gone` and a cap close with their texts;
    - `fa 12` every 2 s.
  - **Panels:** DogPanel (feed reasons, rename hints, "Vuốt ve" sends `fa 11`), the CoopPanel dog tab (coats, confirm), FarmShopPanel (pellets step by 10, max 99 − held), RiceDepotPanel (Bán hết), RatChip.
  - **Hooks:** `useFarmController`'s auto-hunt (each §7.2 condition, and `fp` after a success); `useField`'s `next_at` refetch (0–10 s jitter, only in rat season, the 60 s floor); `useDog` (learns the dog and calls `setPresenceDog`).
- **Integration** (skipped without `SUPABASE_TEST_URL`): `dog_state` of a fresh account gives `dog: null`; `field_state` carries `rats.next_at`.
- **Manual pass** (the owner, after `0019`, two accounts):
  - a ripe plot draws rats; A shoots one and B's dog takes the next, and both see the chip, the pounce and the catch;
  - selling at cô Út; hunger after moving `fed_until` back; the dog on all three maps;
  - the phone layout of the overlay and the panels.

## 16. Lines other specs change

- **v15 spec:** the roadmap (header, §2 row 1, §18), "v16 = rat hunt + dog + slingshot" → v17 (this doc); the `ripe` hook (§11.5, §18) is now `_rat_food`.
- **v15.2 spec:**
  - **§8.7 and R33.** The hoa-màu product becomes `x = (((((((((base_kg · land) · Mcare) · Mplant) · Mwater) · Mrot) · Mpest) · Mlate) · Mrat) · pct_k) / 100`. The rice product (v15 §8.6, as v15.2 §3 leaves it) gains `· Mrat` after `qT`, as its last factor. R33's conventions (left to right, explicit SQL parentheses) cover Mrat in both products, taken at the cut's or the picking's time.
  - **§6.1.** "At a constant Y the six parts sum to exactly Y" stays. "Parts cut later in the overripe window give less" becomes "… in the overripe window, or while rats eat, give less": Y(t) includes Mrat.
- **Anti-cheat spec:**
  - **§7.3** gains the v17 refusals, whose honest causes are two tabs, a stale state, a background tab, another hunter or dog first, and typing: `rat gone`, `rat limit`, `rat daily limit`, `no aim`, `aim expired`, `too fast` (`sling_shoot`), `no sling`, `no pellets`, `no dog`, `dog hungry`, `dog resting`, `dog full`, `already own dog`, `invalid name`, `invalid coat`, `nothing to sell`.
  - **§7.4** gains `rat_daily_cap` (`sling_shoot`, `dog_hunt`): the catch that brings the day's count to 24. A long honest session can reach it.
  - **§9.3.** The locked list gains the 7 v17 RPCs: 59 in all (52 after `0018`).
  - **§11.3.**
    - Rule 2 gains the 7 RPCs and the allowlisted `dog_state(text)`.
    - Rule 4 gains `rat_sell` and `dog_adopt`.
    - Rule 7 gains: "Re-running `0013`, `0015`, `0016`, `0017` or `0018` after `0019` undoes `0019`'s re-created parts, and their ledger checks lack `rat_sell` and `dog_adopt`, so they fail once a rat is sold or a dog adopted. Re-run them in order with `0019` last."
  - **§12.2's final texts:**
    - `WARN_LOCK` reads "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, săn chuột, đánh bài, mua bán đất và mua bán ở các tiệm trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường." v16 names no place for "đánh bài", so it follows the field work; v15.3 puts "bắt cua mò ốc" right after "làm ruộng", and v17 puts "săn chuột" right after that. If v16 shipped "đánh bài" elsewhere, the plan keeps that place and still inserts "săn chuột" after "bắt cua mò ốc".
    - `BAN_WIPE`'s list becomes "(xu, đồ câu, cá, kỷ lục, lúa, đất, chó)".
  - **§12.5** gains the `rat_daily_cap` label, and the holdings line gains `· {n} con chuột` and `· chó {tên}`.
- **The kind check** after `0019`: `shop_items_kind_check` = `('rod','bobber','bait','bait_box','bucket','seed','fertilizer','pesticide','critter_box','tool','ammo','pet_food')`.
- **The re-created `_ac_wipe` and `_ac_holdings`** keep every earlier part:
  - `0015`'s snapshot row, the `wipe` ledger row, its deletes and `ban_state`;
  - `0016`'s `produce_stock` delete, the emptied tank, and the holdings' `produce`, `tank` and crop fields (`kind`, `upland`, `plant_at`, `parts`, `harvester_until`);
  - `0017`'s first step, `_card_forfeit_all(p_account)`, and the holdings' `cards`;
  - `0018`'s `critters` and `gather_cooldowns` deletes and the holdings' `critters`.

  They then add `dogs`, `rat_bag` and `sling_aims`, and the holdings' `dog` and `rats`.
- **Economy spec:** §5.9 gains "rats are priced with the same M: floor(150 × M), no season factor (v17 §9)".

## 17. Out of scope

- Rats on other maps; traps (bẫy), rat poison, cats; rat sizes or kinds; rats stealing from stock or drying batches.
- More than one dog; other pets; dog breeding, tricks, levels, illness or death; walking other people's dogs; petting them; dog names in map labels.
- Pouncing on crabs (v15.3); a dog that guards plots or chases people.
- A server-driven minigame; a soft counter for hits under 3 s (§10.7).
- Rats in the classic view; a room-wide rat announcement in chat.
