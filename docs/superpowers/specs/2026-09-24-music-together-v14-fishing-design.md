# Music Together v14 — "Ao câu cá": fishing, xu and shops (Design)

**Date:** 2026-09-24
**Builds on:** v13 (`feat/v13-game-mode` @ `8ab2f22`, not merged yet). v14 is developed on `feat/v14-fishing`, branched from that commit. Same stack: Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth, SECURITY DEFINER RPCs.
**Roadmap:** v13 = game mode + music hall + characters → **v14 = fishing pond, economy (xu), fish depot, gear shop (this doc)** → v15 = fashion shop, pets.

## 1. Goal

The pond is a second map of the same room world. Players walk down the hall's dock to a Miền Tây fishing pond. They dig worms, fish with a Stardew-style hold-to-reel minigame and sell the catch for **xu**. Then they spend the xu on better gear. The music room is still the centre: the music keeps playing on every map, chat stays room-wide, and a song you queue earns xu when it plays through.

v14 delivers:

1. A second map, **Ao cá**. You reach it through the hall's dock sign (a fade transition), and a HUD counter shows who is on which map.
2. Digging worms, casting, the bite, a hold-to-reel minigame, and fish carried in your hand or in a bucket.
3. 12 Miền Tây fish/shrimp species in 5 rarities. You sell them by weight at **Vựa cá** (NPC cô Ba).
4. **Tiệm đồ câu** (NPC chú Tư) sells rods, bobbers, bait, a bait box and buckets.
5. A server-authoritative economy. The wallet, coin ledger, inventory, casts, caught fish and personal bests change only through SECURITY DEFINER RPCs.
6. Three ways to earn xu: selling fish, a daily check-in (+20 xu) and a song bonus (+10 xu when a song you queued plays through).
7. Social features for the members of the room: chat announcements for rare catches, and a records board with per-species records and the richest members.
8. Six v13 carry-overs that the new map needs (§14).

## 2. Decisions (brainstorm 2026-09-24)

| # | Question | Ruling |
|---|---|---|
| 1 | Where fishing happens | A separate map **Ao cá**, reached from the hall's dock sign. The HUD shows how many people are on each map (C) |
| 2 | Trust model | Server-authoritative. Every roll, price, balance and inventory change happens in RPCs, and casts are capped per hour (C) |
| 3 | Minigame | Stardew-style vertical bar: hold to lift the zone, keep the fish inside it (A) |
| 4 | Income | Fishing, song bonus and daily check-in (D) |
| 5 | Social | Chat announcements for rare+ catches, a records board and a richest-members board (C) |
| 6 | Scope of wallet, gear and boards | The wallet and gear belong to the account and are shared across rooms. The boards rank the members of the current room (C) |
| 7 | Approach | The server rolls the fish at cast time. The client plays the minigame and reports the result under a time gate. One broadcast channel per map, one additive migration |

Clarifications made while writing this spec. The owner should confirm them during the spec review:

- **a) Song bonus threshold.** The brainstorm said "≥ 90 % played". It is measured instead as *the song stayed current for ≥ 75 % of its length on the server clock*. The play clock (`started_at`) is written by the DJ's browser, so a DJ with a wrong clock or a seek could fake it. SponsorBlock auto-skips also shorten many music videos by 10–20 %, and a 90 % bar would never pay for those. Songs shorter than 60 s never pay (§8.4).
- **b) Starter bobber.** "Phao lông gà" (1.5 s bite window) is a real catalog row, so the loadout always points at an item.
- **c) The rod is drawn only while fishing.** `characters.hand` stays unused in v14. The v13 note "`_item_ok` widens to *or owned*" moves to v15, because v14 sells no clothes.
- **d) Hand and bucket.** The oldest fish you hold is the one in your hand; there is no separate "place" field.
- **e) Bait capacity** counts every bait kind together.
- **f) One open cast per account.** A new cast abandons the previous one (§8.3).

## 3. Constraints

- Everything in v13 spec §3 still holds: the Realtime free-plan limits, the public repo (original art only), themes and `.game-ui`, repo conventions, and RPC-only writes.
- **Presence** allows 5 calls per client per 30 s. Map changes share the v13 track budget: ≤ 4 calls per 30 s plus a reserve for reconnects.
- The owner runs migrations in the Supabase SQL editor, so `0012` must be additive and re-runnable:
  - `create … if not exists`, `create or replace`, `drop policy if exists`;
  - seeds with `insert … on conflict (id) do update`;
  - explicit grants.
- Xu are integers; weights are integer grams.
- UI text is in Vietnamese, with `vi-VN` number formatting (1.230 xu, 3,2 kg).
- Every "per day" rule uses the `Asia/Ho_Chi_Minh` calendar day.

## 4. Architecture

```
components/game/GameShell.tsx        mapId + arrival state, fade, fishing HUD, panels, useFishing
 ├─ <GameCanvas mapId arrive …>      one GameEngine + one channel game:{roomId}:{mapId} per map visit
 ├─ hooks/useFishing.ts              FishingState from the RPCs, actions, error → toast
 ├─ components/game/fishing/         BagPanel · DepotPanel · ShopPanel · RecordsPanel · ReelOverlay · CatchCard · MapCounts
 └─ (v13 panels unchanged)           QueuePanel · ChatDrawer · MemberList · RoomChartModal · SettingsDialog · CharacterEditor
lib/game/maps/{types,registry,hall,pond,hall-art,pond-art,scene-art}.ts
lib/game/fishing/{reel,cast,state,catalog,announce,rpc}.ts      pure except catalog fetch + rpc wrappers
lib/game/art/{fish,gear,fishing}.ts                             icons (pure) + rod/line/bobber/held-fish drawing (browser)
lib/game/look.ts                                                 pure DEFAULT_LOOK + NPC looks (carry-over, §14)
lib/game/{engine,world,actor,social}.ts, net/{protocol,channel}.ts, lib/{presence-modes,realtime}.ts, hooks/useRoom.ts   changed
components/room/ChatMessageItem.tsx                              system catch line (classic view)
supabase/migrations/0012_v14_fishing.sql
tests/sql/v14-smoke.sql, tests/integration/v14.test.ts
```

The data flows like this:

1. A portal switches `mapId` in `GameShell`.
2. `GameCanvas` tears down the engine and channel and starts new ones on the new map.
3. `useFishing` holds the account's `FishingState`. Every RPC returns the full state (§8.2), so the client never patches the state by itself.
4. The fishing visuals of the players on the same map travel as `fs` broadcasts (§9.3).

## 5. Maps and travel

### 5.1 Map types (changed) — `lib/game/maps/types.ts`

```ts
export type MapId = "hall" | "pond";
export type InteractKind = "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records";
export interface Interactable {
  id: string;                          // unique per map: "dock_sign", "fish_3", …
  kind: InteractKind;
  label: string;                       // "Bến câu cá"
  prompt: string;                      // shown as "E · {prompt}" — "Xuống ao câu cá"
  rect: Rect; use: Vec;
  face?: Facing;                       // fish_spot: towards the water
  to?: { map: MapId; arrive: Spot };   // portal
}
export interface Npc { id: string; name: string; look: Look; spot: Spot }
export interface GameMap {
  id: MapId; width: number; height: number; cell: number; cols: number; rows: number;
  blocked: Uint8Array;
  spawn: Spot;                                                            // now with a facing
  seating: { djSpot: Spot; seats: Spot[]; standSpots: Spot[] } | null;   // hall only (classic-mode members)
  interactables: Interactable[];
  props: PropPlacement[];
  npcs: Npc[];
}
```

- `lib/game/maps/registry.ts`:
  - `getMap(id: MapId): GameMap` builds each map once and caches it.
  - `paintMap(map): SceneArt` runs in the browser: the hall uses `paintHall`, the pond uses `paintPond`.
- `SceneArt` (`scene-art.ts`) is the v13 `HallArt` shape (`background`, `props`, `drawAnimated`, `drawOverhead`), renamed so both maps share it.
- Engine callbacks now receive the whole `Interactable`: `onInteract(it)` and `onPromptChange(it | null)`. The HUD prompt reads `E · {it.prompt}`.

### 5.2 Hall changes

- `dock_sign` becomes `kind: "portal"`, prompt **"Xuống ao câu cá"**, `to: { map: "pond", arrive: <pond arrival spot> }`. This replaces the v13 teaser toast.
- Coming back from the pond, you arrive at the dock sign's use spot (516, 334), facing up.
- The v13 interactables keep their behaviour. They get `kind`s `dj_booth` ("Mở hàng đợi") and `notice_board` ("Xem bảng tin").

### 5.3 Pond map — `lib/game/maps/pond.ts` (640 × 400, cell 8)

| Area | Content | Collision |
|---|---|---|
| Centre | The pond: an irregular oval, about 380 × 210 px, with bông súng (water lilies), reeds along the edge and a moored xuồng ba lá | water blocked |
| Centre-south | **Cầu ao**: a T-shaped plank platform running from the south bank into the pond | walkable over water; 6 fishing spots on its edges, each facing open water |
| West | **Bãi trùn**: a dark dirt patch with 4 mounds (dig spots) and banana plants | mounds walkable (dig from the use spot) |
| North-east | **Vựa cá**: a stall with an awning, fish baskets and a scale; cô Ba behind the counter. The **Bảng kỷ lục** board stands next to it | stall and board blocked |
| South-east | **Tiệm đồ câu**: a chòi lá (thatched hut) with a rod rack; chú Tư behind the counter | hut blocked |
| South | A dirt path to the map edge and the sign **"Bến vào · Về sảnh"** (portal to the hall). The arrival spot is next to it, facing up | sign blocked |
| Corners | Coconut palms, bamboo | trunks blocked |

Pond interactables:

- `pond_exit`: portal to the hall, prompt "Về sảnh nhạc".
- `fish_1` … `fish_6`: fishing spots, prompt "Quăng cần".
- `dig_1` … `dig_4`: dig spots, prompt "Đào trùn".
- `depot`: prompt "Bán cá · cô Ba".
- `shop`: prompt "Tiệm đồ câu · chú Tư".
- `records`: prompt "Xem bảng kỷ lục".

A fishing spot's click rect covers the water in front of it, so tapping near a spot walks there and casts.

Rules, all checked by tests:

- `pondEdge(angle)` is shared by the art and the collision grid, like `hallShoreY`.
- The 6 fishing spots are ≥ 40 px apart on the platform edges. Each use spot is walkable and reachable. Its **bobber point** (the use spot + 36 px along `face`) is open water: blocked, inside the pond and not under the platform.
- The 4 dig spots are on the dirt patch, ≥ 32 px apart.
- NPCs stand behind their counters, inside blocked cells, facing down. They are drawn like seated classic members (a static frame) with a name tag.
- The arrival spot and every use spot are walkable and reachable from the arrival spot.

The exact coordinates are fixed in the plan after a browser prototype, as in v13.

### 5.4 Travel

1. The player triggers a portal (E, click or tap).
2. `GameShell` does four things:
   - fades to dark (250 ms);
   - cancels an open cast (`finish_cast(false)`, fire-and-forget);
   - calls `setPresenceMap(to)`;
   - switches `mapId` and `arrive`.
3. `GameCanvas` tears down the old engine and channel, which sends `bye` on the old map's channel. It then:
   - starts a new engine on the new map at `arrive`;
   - joins `game:{roomId}:{to}`;
   - sends `hello` and a snapshot.
4. The screen fades back in (250 ms) after the new engine has drawn its first frame.

Other rules:

- Entering game mode always starts in the hall at the hall spawn. The current map is never persisted.
- Leaving game mode from the pond sends `bye` on the pond channel. The presence `map` becomes `null`.
- `GameShell` rebuilds the roster for the new map (`mapId` is in the roster effect's deps). `GameCanvas` re-applies the local player info to each new engine.

## 6. Fishing loop

### 6.1 Flow

| Phase | Starts when | Ends when | I see | Others see (`fs`, §9.3) |
|---|---|---|---|---|
| idle | — | E at a fishing spot passes the checks below | prompt "E · Quăng cần" | — |
| casting | `engine.plant(spot)` (snap to the use spot, face the water) + `start_cast` | the 600 ms swing is over **and** the RPC has answered | the rod swings out | — |
| waiting | the RPC answered | `bite_ms` later | line, bobber, ripples; **🎣 Thu cần** button / Esc | line + bobber (`f=1`) |
| bite | `bite_ms` | `window_ms` later | ❗ above the head, the bobber dips; **❗ Giật cần!** button; Space / click / tap hooks | ❗ (`f=2`) |
| reeling | a hook inside the window | the minigame ends | `ReelOverlay` (§6.2) | the rod bends, splashes (`f=3`) |
| result | caught or escaped → `finish_cast` | the RPC answers | catch card, or toast "Cá đã thoát!" | `f=0`, plus a catch label (`c`) on a catch |

Before `start_cast`, the client checks two things; the server re-checks the first:

- `castBlocker(state)` (§8.2) must be clear. Its reasons are no bait, hands full, bucket full and the hourly cap.
- The spot must be free. If another visible player with `f ≠ 0` stands within 12 px of the use spot, the toast is "Chỗ này có người câu rồi."

The timeline is pure (`lib/game/fishing/cast.ts`):

```ts
export interface CastInfo {                 // the start_cast answer, camelCase
  castId: string; biteMs: number; windowMs: number; difficulty: number;
  minReelMs: number; zonePct: number; rarity: Rarity | null;
}
export type CastPhase = "waiting" | "bite" | "missed";
export function castPhase(info: CastInfo, sinceAnswerMs: number): CastPhase; // < biteMs waiting · < biteMs + windowMs bite · else missed
export function canHook(info: CastInfo, sinceAnswerMs: number): boolean;     // castPhase === "bite"
```

What ends a cast early:

- A missed bite → `finish_cast(false)` → "Cá ăn mồi rồi chạy mất!"
- **Thu cần** while waiting → `finish_cast(false)`. The bait is lost.
- Leaving the map, leaving game mode or unmounting during a cast → `finish_cast(false)`, fire-and-forget.
- A `start_cast` error → the rod retracts and an error toast shows (§8.6).
- A network error on `finish_cast` → "Mất kết nối — cá đã thoát."

Input during a cast:

- From casting until the result, movement input (keys and click-to-move) and interactables are ignored.
- Panels can still open. The cast goes on, and a bite may be missed.

### 6.2 Minigame — `lib/game/fishing/reel.ts` (pure)

```ts
export interface ReelParams { zonePct: number; difficulty: number; minReelMs: number; seed: number }
export interface ReelState {
  zone: number; zoneV: number;          // bottom of the catch zone (0…1−zone height) and its speed (bar/s)
  fish: number; target: number;         // fish position and where it is heading (0…1)
  progress: number; elapsedMs: number; rng: number;
  outcome: "caught" | "escaped" | null; // sticky once set
}
export function createReel(p: ReelParams): ReelState;
export function stepReel(s: ReelState, p: ReelParams, dtSec: number, holding: boolean): ReelState; // dt clamped to 0.05 s
export function inZone(s: ReelState, p: ReelParams): boolean;
```

The bar runs from 0 (bottom) to 1 (top). The zone height is `h = zonePct / 100`. The randomness is seeded (`mulberry32(seed)`, seed from `crypto.getRandomValues` in the browser, fixed in tests).

| Rule | Value |
|---|---|
| Start | `progress 0.3`, `zone 0`, `zoneV 0`, `fish h/2`, `target` random |
| Zone | holding → `zoneV += 3.2·dt`, otherwise `zoneV −= 2.4·dt`; `|zoneV| ≤ 1.6`; `zone += zoneV·dt`. At the bottom it bounces (`zoneV = −0.35·zoneV`); at the top it stops (`zoneV = 0`) |
| Fish speed | `0.25 + 1.1·d` bar/s towards `target` (`d = difficulty/100`), with no overshoot |
| New target | when the fish reaches it, or with a chance of `(0.4 + 2.2·d)·dt` per step; `target = clamp(fish + (u − 0.5)·(0.35 + 0.9·d), 0, 1)` |
| Progress | fish in the zone → `+ 0.7 / (minReelMs/1000)` per s; outside → `− (0.12 + 0.1·d)` per s |
| End | `progress ≥ 1` → caught; `progress ≤ 0` → escaped; `elapsedMs ≥ 60 000` → escaped |

A perfect reel (the fish always in the zone) takes exactly `minReelMs`, because the progress fills from 0.3 to 1. This matches the server's time gate (§8.3).

The motion constants (lift, gravity, fish speed, retarget, drain) may be tuned in the plan's browser prototype; the unit tests pin the final values. The fill rule and the start at 0.3 are fixed, because the server's time gate depends on them.

### 6.3 Hand and bucket

- **Capacity** = 1 (hand) + the capacity of the largest bucket you own (0, 5 or 15).
- The oldest fish you hold is "in hand". Other players see it carried (§11). The panels list it under **Trên tay** and the rest under **Trong xô**.
- `start_cast` refuses when you already hold as many fish as the capacity:
  - with no bucket: "Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!"
  - with a full bucket: "Xô đầy rồi — ra vựa bán bớt nhé!"
- Selling or releasing a fish frees space. The new hand fish is announced with `fs`.

### 6.4 Digging worms

- Pressing E at a dig spot plays a 1 s dig animation (dust puff, local only) and then calls `dig_worms`. You gain 1–3 **Trùn đất**, clamped to the bait capacity.
- The cooldown is 45 s per account and applies to every dig spot. While it runs, the prompt reads "Đào trùn (còn N giây)".
- With a full bait box, the toast is "Hộp mồi đầy rồi." No cooldown is used.

## 7. Fish and gear data

### 7.1 Species (seed of `fish_species`)

| id | Name | Rarity | Weight (g) | xu/kg | Difficulty |
|---|---|---|---|---|---|
| `ca_ro` | Cá rô đồng | 1 Thường | 50–300 | 45 | 15 |
| `ca_sac` | Cá sặc rằn | 1 Thường | 50–250 | 40 | 12 |
| `ca_me_vinh` | Cá mè vinh | 1 Thường | 100–500 | 35 | 20 |
| `ca_loc` | Cá lóc | 2 Khá | 300–2 500 | 60 | 38 |
| `ca_tre` | Cá trê vàng | 2 Khá | 200–1 200 | 50 | 32 |
| `ca_chep` | Cá chép | 2 Khá | 500–3 000 | 55 | 42 |
| `ca_tra` | Cá tra | 3 Hiếm | 1 000–6 000 | 70 | 52 |
| `ca_that_lat` | Cá thát lát | 3 Hiếm | 300–1 500 | 120 | 58 |
| `tom_cang` | Tôm càng xanh | 3 Hiếm | 50–300 | 400 | 62 |
| `ca_bong_lau` | Cá bông lau | 4 Quý | 1 000–5 000 | 120 | 70 |
| `ca_he_vang` | Cá he vàng | 4 Quý | 300–1 500 | 150 | 75 |
| `ca_ho` | Cá hô | 5 Huyền thoại | 10 000–40 000 | 200 | 90 |

- Rarity names: 1 Thường, 2 Khá, 3 Hiếm, 4 Quý, 5 Huyền thoại.
- Rarity colours: `#9aa0a6`, `#4caf50`, `#2f80ed`, `#9b51e0`, `#f2994a`.

### 7.2 Rolls (server, at `start_cast`)

**Rarity.** Each rarity has a weight in percent:

- Khá: fixed at 28.
- Hiếm: 9 × bait `mult_hiem` × rod `rare_mult`.
- Quý: 2.7 × bait `mult_quy` × rod `rare_mult`.
- Huyền thoại: 0.3 × bait `mult_legend` × rod `rare_mult`.
- Thường: 100 minus the others.

| Loadout | Thường | Khá | Hiếm | Quý | Huyền thoại |
|---|---|---|---|---|---|
| Trùn đất, cần gỗ / tre | 60 | 28 | 9 | 2.7 | 0.3 |
| Trùn đất, cần carbon | 57.6 | 28 | 10.8 | 3.24 | 0.36 |
| Mồi tép, cần gỗ / tre | 54 | 28 | 13.5 | 4.05 | 0.45 |
| Mồi trùn chỉ, cần gỗ / tre | 47.7 | 28 | 18 | 5.4 | 0.9 |
| Mồi trùn chỉ, cần carbon | 42.84 | 28 | 21.6 | 6.48 | 1.08 |

**The rest of the roll:**

- **Species:** uniform among the species of the rolled rarity.
- **Weight:** `min_g + floor((max_g − min_g + 1) · u^k)`, where `u ∈ [0, 1)` and `k` is the rod's `weight_k`. With the wooden rod (`k = 2.0`) the mean sits at ⅓ of the range; with bamboo and carbon (`k = 1.5`) at ⅖.
- **Bite delay:** a uniform integer in the bobber's `[bite_min_ms, bite_max_ms]`.
- **Minimum reel time:** `min_reel_ms = 2000 + 40 · difficulty`, from 2 480 ms for cá sặc up to 5 600 ms for cá hô.

### 7.3 Price and number formats

`lib/game/fishing/catalog.ts` holds the client side of this data: `type Rarity = 1 | 2 | 3 | 4 | 5`, `fetchFishingCatalog()` (both config tables, cached), `formatWeight`, `formatXu`, `RARITY_NAME`, `RARITY_COLOR` and `describeItem`.

- **Price** = `max(1, round(price_per_kg × weight_g / 1000))`. It is fixed at catch time and stored on the fish row.
- **Weight text:**
  - under 1 000 g → `"{g} g"`;
  - otherwise `t = round(g / 100)` (half up) → `"{t div 10},{t mod 10} kg"`, e.g. 1 150 g → "1,2 kg" and 12 000 g → "12,0 kg".
  - SQL (announcements) and TS (`formatWeight`) use this same rule.
- **Xu text:** `n.toLocaleString("vi-VN") + " xu"` → "1.230 xu".
- **Economy check** (worms, wooden rod, every reel won): about 46 xu per cast on average, 12 of it from the rare cá hô. With the cap of 40 casts per hour, a skilled player earns about 1 000–1 800 xu per hour. Cần tre takes about 20 minutes of fishing, Cần carbon 1–2 hours.

### 7.4 Shop items (seed of `shop_items`)

| id | kind | Name | Price (xu) | Effect |
|---|---|---|---|---|
| `rod_wood` | rod | Cần gỗ | starter | zone 25 %, `weight_k 2.0` |
| `rod_bamboo` | rod | Cần tre | 300 | zone 30 %, `weight_k 1.5` (heavier fish) |
| `rod_carbon` | rod | Cần carbon | 1 500 | zone 36 %, `weight_k 1.5`, `rare_mult 1.2` |
| `bobber_feather` | bobber | Phao lông gà | starter | window 1.5 s, bite 3–10 s |
| `bobber_foam` | bobber | Phao xốp | 150 | window 2 s, bite 3–10 s, shows the rarity colour at the bite |
| `bobber_lamp` | bobber | Phao đèn | 800 | window 2.5 s, bite 2–7 s, shows the rarity colour |
| `bait_worm` | bait | Trùn đất | not sold (dig) | ×1 |
| `bait_shrimp` | bait | Mồi tép | 5 each | Hiếm / Quý / Huyền thoại ×1.5 |
| `bait_bloodworm` | bait | Mồi trùn chỉ | 12 each | Hiếm ×2, Quý ×2, Huyền thoại ×3 |
| `bait_box` | bait_box | Hộp mồi | 250 | bait capacity 20 → 60 |
| `bucket_small` | bucket | Xô nhỏ | 200 | 5 fish |
| `bucket_large` | bucket | Xô lớn | 800 | 15 fish |

`describeItem(item)` (TS) builds the effect line that the shop and the bag show, e.g. "Vùng giữ cá 30% · cá nặng hơn" or "Giật cần trong 2 giây · báo độ hiếm".

## 8. Economy — `supabase/migrations/0012_v14_fishing.sql`

### 8.1 Tables

```sql
-- config, public read (RLS on + select policy to anon, explicit grant select to anon, authenticated)
create table if not exists public.fish_species (
  id text primary key, name text not null,
  rarity smallint not null check (rarity between 1 and 5),
  min_g integer not null check (min_g > 0), max_g integer not null check (max_g >= min_g),
  price_per_kg integer not null check (price_per_kg > 0),
  difficulty smallint not null check (difficulty between 1 and 100),
  sort_order integer not null default 0
);
create table if not exists public.shop_items (
  id text primary key,
  kind text not null check (kind in ('rod','bobber','bait','bait_box','bucket')),
  name text not null,
  price integer check (price > 0),                  -- null = not sold (starter gear, dug worms)
  starter boolean not null default false,           -- everyone owns it
  sort_order integer not null default 0,
  zone_pct smallint, weight_k real, rare_mult real not null default 1,                                        -- rod
  window_ms integer, bite_min_ms integer, bite_max_ms integer, shows_rarity boolean not null default false,  -- bobber
  mult_hiem real not null default 1, mult_quy real not null default 1, mult_legend real not null default 1,  -- bait
  capacity integer                                                                                             -- bait_box, bucket
);

-- per account, private (RLS on, no policies, revoke all from anon/authenticated; only the RPCs touch them)
create table if not exists public.wallets (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  coins integer not null default 0 check (coins >= 0),
  daily_on date,                                   -- VN day of the last check-in
  bonus_on date, bonus_count smallint not null default 0   -- song bonuses paid on bonus_on
);
create table if not exists public.coin_ledger (      -- append-only
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  delta integer not null, balance integer not null,
  reason text not null check (reason in ('daily','song','sell','buy')),
  ref text, created_at timestamptz not null default now()
);
create table if not exists public.inventory (
  account_id uuid not null references public.accounts(id) on delete cascade,
  item_id text not null references public.shop_items(id),
  qty integer not null check (qty >= 0),
  primary key (account_id, item_id)
);
create table if not exists public.fishing_profiles (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  rod text not null default 'rod_wood' references public.shop_items(id),
  bobber text not null default 'bobber_feather' references public.shop_items(id),
  bait text not null default 'bait_worm' references public.shop_items(id),
  window_start timestamptz, window_casts smallint not null default 0,   -- hourly cast cap
  last_dig_at timestamptz
);
create table if not exists public.casts (             -- at most one open cast per account
  account_id uuid primary key references public.accounts(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete set null,
  species_id text not null references public.fish_species(id),
  weight_g integer not null, min_reel_ms integer not null,
  bite_at timestamptz not null, expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table if not exists public.fish (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null check (weight_g > 0), price integer not null check (price > 0),
  caught_at timestamptz not null default now()
);
create index if not exists idx_fish_account on public.fish (account_id, caught_at);
create table if not exists public.personal_bests (
  account_id uuid not null references public.accounts(id) on delete cascade,
  species_id text not null references public.fish_species(id),
  weight_g integer not null, caught_at timestamptz not null default now(),
  primary key (account_id, species_id)
);
alter table public.rooms add column if not exists item_began_at timestamptz;   -- §8.4
```

Private helpers (`_wallet_lock`, `_fishing_profile`, `_fishing_state`, `_roll_rarity`, `_weight_text`, `_song_bonus`, `_item_clock`) have `revoke all … from public, anon, authenticated`. Each public RPC has `grant execute … to anon, authenticated`.

Every mutating RPC starts with `_wallet_lock(account)`. It inserts the wallet row if missing and then locks it with `select … for update`. This serializes one account's operations across tabs. Every balance change also inserts a `coin_ledger` row holding the balance afterwards.

### 8.2 State JSON

`_fishing_state(account)` returns the account's state; every RPC below returns it as `state`:

```json
{
  "coins": 1230,
  "daily_claimed": true,
  "loadout": { "rod": "rod_wood", "bobber": "bobber_feather", "bait": "bait_worm" },
  "owned": ["rod_bamboo", "bucket_small"],
  "bait": { "bait_worm": 12, "bait_shrimp": 0, "bait_bloodworm": 5 },
  "bait_cap": 20,
  "fish": [{ "id": "…", "species_id": "ca_loc", "weight_g": 1200, "price": 72, "caught_at": "…" }],
  "fish_cap": 6,
  "casts_left": 37,
  "window_resets_at": "2026-09-24T10:31:00Z",
  "dig_ready_at": null
}
```

Field notes:

- `owned` lists non-starter gear. Starter items are always owned.
- `fish` is oldest first; `fish[0]` is the one in hand.
- `window_resets_at` is `null` when no hourly window is running.
- `dig_ready_at` is `null` when you can dig now.

`lib/game/fishing/state.ts` (pure) holds the client side:

- `FishingState` (camelCase) and `parseFishingState(json)`.
- `handFish(s)`, `baitTotal(s)`, `ownsItem(s, item)`, `maxBuyQty(s, item)`.
- `castBlocker(s, now)` → `"no_bait" | "hands_full" | "bucket_full" | "cast_limit" | null`. The `no_bait` check follows the worm fallback of `start_cast`: the selected bait, then worms.

### 8.3 RPCs (SECURITY DEFINER, `set search_path = public, extensions`)

**Account RPCs** (authenticated with `_auth_account(p_session_token)`):

| RPC | Rules | Returns |
|---|---|---|
| `fishing_state(p_session_token text)` | read only | `jsonb` state |
| `claim_daily(p_session_token text)` | if `daily_on` ≠ today (VN) → +20 xu, `daily_on = today`, ledger `daily`; otherwise nothing | `{ claimed, amount, state }` |
| `dig_worms(p_session_token text)` | `now() < last_dig_at + 45 s` → `dig cooldown` (53400, `detail` = seconds left). Bait total ≥ cap → `bait full`. Otherwise gain `least(1 + floor(random()·3), cap − total)` worms and set `last_dig_at = now()` | `{ gained, state }` |
| `buy_item(p_session_token text, p_item_id text, p_qty integer default 1)` | See **buy_item rules** below | `{ state }` |
| `set_loadout(p_session_token text, p_rod text, p_bobber text, p_bait text)` | Each id must exist with the right kind. The rod and bobber must be starter or owned; any bait id may be selected, even with 0 left → otherwise `item not available` | `{ state }` |
| `finish_cast(p_session_token text, p_cast_id uuid, p_success boolean)` | See **finish_cast rules** below | `{ result: "caught" \| "lost", why?, fish?, record?, state }` |
| `sell_fish(p_session_token text, p_fish_ids uuid[])` | Deletes my fish among the ids. None deleted → `fish not found`. Otherwise +sum of prices, one ledger `sell` row (`ref` = count) | `{ sold, earned, state }` |
| `release_fish(p_session_token text, p_fish_id uuid)` | Deletes the fish; not mine or missing → `fish not found` | `{ state }` |

**Room RPCs** (`_auth(p_room_id, p_session_token, 'any')`):

| RPC | Rules | Returns |
|---|---|---|
| `start_cast(p_room_id uuid, p_session_token text)` | See **start_cast rules** below | `{ cast_id, bite_ms, window_ms, difficulty, min_reel_ms, zone_pct, rarity, bait_switched, state }` |
| `fishing_board(p_room_id uuid, p_session_token text)` | See **fishing_board** below | `jsonb` |

**buy_item rules.** An unknown item or `price is null` → `item not available`.

- **Gear** (rod, bobber, bait_box, bucket):
  - `p_qty` must be 1 → otherwise `invalid quantity`.
  - Already owned → `already owned`. This also covers a second bait box, and a bucket that is not bigger than the best bucket you own.
  - Coins < price → `not enough coins`.
  - Otherwise: pay, inventory `qty 1`, ledger `buy` (`ref` = item id).
  - A rod or bobber priced above the equipped one is equipped automatically ("the best").
- **Bait:**
  - `p_qty` must be 1–99 → otherwise `invalid quantity`.
  - Bait total + qty > cap → `bait full`.
  - Coins < price × qty → `not enough coins`.
  - Otherwise pay and add to the inventory. If the selected bait has none left, the bought bait becomes the selection.

**start_cast rules.**

1. Lock the profile.
2. Roll the hourly window: if `window_start` is null or older than 1 h, then `window_start = now()` and `window_casts = 0`. If `window_casts ≥ 40` → `cast limit` (53400, `detail` = seconds until the window resets).
3. Delete my previous cast. This **abandons** it; its bait is already spent.
4. `count(fish) ≥ fish_cap` → `hands full` without a bucket, `bucket full` with one.
5. Take one bait of the selected kind. If there is none, switch the loadout to `bait_worm` and take a worm (`bait_switched = true`). If there are no worms either → `no bait`.
6. Roll the fish (§7.2).
7. Insert the cast:
   - `bite_at = now() + bite_ms`;
   - `expires_at = bite_at + window_ms + 90 s`;
   - `window_casts += 1`.
8. Return the answer. `rarity` is filled only when the bobber has `shows_rarity`; otherwise it is `null`.

**finish_cast rules.**

1. Select my cast with `id = p_cast_id` → not found → `cast not found`.
2. **Delete it.** This makes every cast single-use.
3. Decide the outcome. The checks below **return** `lost` instead of raising, so the delete is kept:
   - `now() > expires_at` → `why: "expired"`;
   - `not p_success` → `"gave_up"`;
   - `now() < bite_at + 0.9 · min_reel_ms` → `"too_early"`;
   - no capacity left → `"full"`.
4. Otherwise:
   - insert the fish with its price;
   - upsert `personal_bests` when the fish is heavier (`record: true`);
   - if the rarity is ≥ 3 and the cast's room still exists, post the announcement (§8.5).
5. Return `caught` with `fish { id, species_id, weight_g, price, rarity }`.

**fishing_board.** It returns:

- `records`: for each species, the heaviest personal best among the **members of the room** (`username`, `weight_g`; ties go to the earliest catch);
- `mine`: my bests;
- `richest`: the top 10 members by coins, excluding 0;
- `my_rank`: 1 + the number of members with more coins;
- `my_coins`.

### 8.4 Song bonus (triggers on `rooms`)

- **`_item_clock`** runs `before update of current_item_id`. When `new.current_item_id` differs from the old value, it sets `new.item_began_at` (`now()`, or `null` when the new value is null).
- **`_song_bonus`** runs `after update of current_item_id`, `for each row`, `when (old.current_item_id is not null and old.current_item_id is distinct from new.current_item_id)`.
  - `advance_queue` clears `current_item_id` **before** it deletes the old queue row, so the row is still readable at that moment.
  - The bonus is paid when **all** of these hold:
    - `added_by_account_id` is not null (replays have none);
    - `duration_seconds ≥ 60`;
    - `old.item_began_at` is not null;
    - `now() − old.item_began_at ≥ 0.75 × duration`.
  - It pays **+10 xu** to the requester, at most 10 times per VN day (`bonus_on` / `bonus_count` reset daily). The ledger row is `song`, with `ref` = the first 80 characters of the title.
  - The trigger never raises. Missing data means no bonus. An unexpected error is caught and logged as `raise warning`, so `advance_queue` can never fail because of it.
- A song that was current when `0012` ran has no `item_began_at`, so it earns nothing.

### 8.5 Catch announcements

For rarity ≥ 3, `finish_cast` inserts a chat message into the cast's room:

- `account_id null`
- `username 'Ao cá'`
- body: `[catch:{account_id}|{species_id}|{weight_g}] 🎣 {username} vừa câu được {species name} {weight text} ({rarity name})!`

It then trims the room to its newest 200 messages, as `send_chat_message` does.

`lib/game/fishing/announce.ts` (pure):

- `parseCatchAnnouncement(message)` returns `{ accountId, speciesId, weightG, text }`, or `null`.
- It matches `^\[catch:([0-9a-f-]{36})\|([a-z_]{1,32})\|(\d{1,6})\] (.+)$`, and only on messages with `account_id === null` and `username === "Ao cá"`. A member typing the prefix cannot fake an announcement.

### 8.6 Errors → Vietnamese (`fishingErrorMessage`, `lib/game/fishing/rpc.ts`)

| Server message (code) | Toast |
|---|---|
| `not enough coins` (22023) | Không đủ xu. |
| `already owned` (22023) | Bạn có món này rồi. |
| `item not available` / `invalid quantity` (22023) | Món này không mua được. |
| `bait full` (22023) | Hộp mồi đầy rồi. |
| `no bait` (22023) | Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé. |
| `hands full` (22023) | Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé! |
| `bucket full` (22023) | Xô đầy rồi — ra vựa bán bớt nhé! |
| `cast limit` (53400, detail s) | Câu nhiều quá rồi, nghỉ tay chút nhé (còn N phút). |
| `dig cooldown` (53400, detail s) | Đất còn cứng, chờ N giây nữa nhé. |
| `cast not found` (22023) | Cá đã thoát mất rồi. |
| `fish not found` (22023) | Con cá này không còn nữa. |
| session / ban errors | the existing auth messages |
| network / unknown | Có lỗi, thử lại nhé. |

After every error the client re-fetches the state.

### 8.7 Trust model (written into the README)

**The server decides:**

- species, weight, rarity and bite delay;
- prices, capacities and balances;
- the hourly cap, the dig cooldown, the reel time gate and single-use casts.

**The server does not verify three things:**

- **Whether the minigame was really won.** A modified client can report success, but no faster than the time gate and no more than 40 fish per hour.
- **Where the player stands.** Selling, buying and digging work from anywhere.
- **The visuals.** `fs` states and the catch labels over heads are reported by the client. Only the chat announcement comes from the server.

## 9. Networking

### 9.1 Per-map channel

- The topic becomes `game:{roomId}:{mapId}`.
- `hello`/`st`/`mv`/`pa`/`lk`/`bye` behave as in v13, within one map. Messages outside that map's bounds are rejected.
- Joining still waits for the previous leave of the same topic (`channel-lifecycle`).
- Sends wait for `SUBSCRIBED` (§14). There is no REST fallback.

### 9.2 Presence map

- The payload grows to `{ name, online_at, mode, map }`, where `map` is `"hall" | "pond"` in game mode and `null` in classic mode.
- `trackPresence` gets `setMap(map)`. The mode and the map form one wanted state for the scheduler: same 1 s merge, same budget, and a state the server has already acknowledged is never re-sent.
- `aggregatePresenceModes` gains a `map` field. It is taken from the game-mode tab with the latest `online_at`. A game-mode entry without `map` (an old client) counts as `"hall"`.
- `useRoom` exposes `setPresenceMap`.
- **Roster per map** (`buildRoster({ …, mapId })`):
  - hall: classic members are seated (`seating`); game members whose presence map is `"hall"` walk;
  - pond: only game members whose presence map is `"pond"`.
  - Members on the other map are not drawn, and their chat bubbles and floating reactions are not shown. A reaction from someone not on this map rises from the top of the screen (v13 rule).
- **Map counts:** `mapCounts(presence)` (pure, `lib/presence-modes.ts`) returns `{ hall, pond }`, each a list of `{ accountId, name, classic }`. Presence includes me. Classic members count in the hall.
- **Timing:** after a map switch, the presence update reaches others after about 1 s. Until then, the arriving player's `hello`/`st` on the new channel are kept (`RemoteWorld.last`), so they appear in the right place as soon as the roster includes them.

### 9.3 Messages

| Event | Payload | When |
|---|---|---|
| `fs` (new) | `{ id, f, h, c? }` | my fishing phase or my hand fish changed |
| `st`, `mv`, `pa` | v13 payload + optional `h`; `st` also optional `f` | as in v13 |

- `f`: `0` idle, `1` line out, `2` bite, `3` reeling.
- `h`: the species id of my hand fish, or `null`.
- `c`: `[species_id, weight_g]` of a fish just landed (sent only with `f = 0`).
- Validation:
  - `f ∈ {0,1,2,3}`;
  - `h` is `null` or matches `/^[a-z_]{1,32}$/`;
  - `c` is a pair of that id and an integer 1…100 000.
- Receivers draw the bobber at the sender's feet + 36 px along their facing, since the sender stands still at a spot while fishing. A catch label shows for 3 s. A remote player with `f ≠ 0` whose last message is more than 90 s old falls back to idle. This covers a lost `fs`.
- The send gate treats `fs` as a **control** message: FIFO, never dropped or coalesced. `st`/`mv`/`pa` stay coalesced; the newest one carries the newest `h`/`f`.

### 9.4 Budget

- **`fs` messages.** A cast sends at most 4 of them (cast, bite, reel, end). Casts are ≥ 6 s apart and capped at 40 per hour, so an angler sends ≤ 0.7 `fs` per second, typically about 0.1. A sale or a release adds one.
- **Two channels.** Splitting the room across two map channels lowers deliveries: `N_hall² + N_pond² < N²`.
- **Presence and chat.** A map switch costs one presence track. A rare+ catch costs one chat insert (a `postgres_changes` event per listener).

## 10. Game UI

### 10.1 HUD

- **Player card:** portrait, name, badges, then:
  - **🪙 1.230 xu**;
  - **🪱 12/20 · 🐟 2/6** (bait total/capacity, fish/capacity);
  - buttons **👕 Tủ đồ** and **🎒 Giỏ đồ**.
- **Map counts chip** (`MapCounts`, top centre): **🎵 Sảnh 3 · 🎣 Ao cá 2**. Tapping it lists the names per map, with classic members marked 🖥️.
- **While fishing:** **🎣 Thu cần** (waiting), and a large **❗ Giật cần!** button (bite). Space or a click on the canvas also hooks.
- **Toasts:**
  - daily check-in "🪙 Điểm danh hôm nay: +20 xu";
  - song bonus "🎵 Bài bạn gọi đã phát xong: +10 xu";
  - other players' rare catches (the announcement text; my own catch shows the catch card instead);
  - sales "Bán 3 con · +245 xu";
  - errors (§8.6).
- **Daily check-in:** `GameShell` calls `claim_daily` once per mount and shows the toast only when `claimed` is true.
- **Song bonus detection:** when the current queue item changes and the previous one was queued by me, `GameShell` re-fetches the state after 1.5 s. It shows the toast if the coins went up by at least 10.

### 10.2 Panels (parchment modals; game input is off while one is open, as in v13)

- **🎒 Giỏ đồ (`BagPanel`)** has five sections:
  - **Cá**: hand fish, then the bucket, each row with an icon, name, weight, rarity colour and price, plus a **Thả** button;
  - **Cần câu** and **Phao**: owned items with **Dùng** (the equipped one is marked);
  - **Mồi**: the three baits with counts and a selection;
  - **Đồ nghề**: the bait box and bucket with their capacities.
  - Changes call `set_loadout`.
- **Vựa cá · cô Ba (`DepotPanel`)**:
  - opens only from the `depot` interactable;
  - lists the fish with price, a **Bán** button on each row and **Bán hết (N con · X xu)**;
  - after a sale, an `fs` with the new hand fish.
- **Tiệm đồ câu · chú Tư (`ShopPanel`)**:
  - a grid of item tiles: 16×16 icon, name, price, `describeItem` line;
  - each tile shows **Mua**, **Đã có**, or a disabled **Không đủ xu**;
  - bait tiles add a quantity picker (1 / 5 / 10 / max within the capacity).
- **Bảng kỷ lục (`RecordsPanel`)** has two tabs:
  - **Kỷ lục câu cá**: 12 rows; per species the room record (name + weight, or "—") and my best;
  - **Đại gia**: the top 10 by coins and a line "Bạn: hạng 7 · 1.230 xu".
  - It loads `fishing_board` when opened.

### 10.3 Reel overlay and catch card

- **`ReelOverlay`**:
  - a parchment frame next to the player, with a vertical water bar (the catch zone in green and the fish icon) and a progress meter;
  - the fish icon is a silhouette in the rarity colour when the bobber reveals the rarity, and grey otherwise;
  - hold the mouse button, a touch or Space to lift the zone;
  - driven by `stepReel` inside a `requestAnimationFrame` loop.
- **`CatchCard`**: a large fish icon, the name, weight, rarity (in its colour), "≈ 72 xu", and **"🏆 Kỷ lục mới!"** when it is a personal best. An **OK** button closes it; it also closes by itself after 5 s.

### 10.4 Classic view

`ChatMessageItem` renders a message that `parseCatchAnnouncement` accepts as a centred system line ("🎣 Dat vừa câu được …"). It has no avatar and no reply or mention actions; the room admin can still delete it. Chat bubbles in the game still come only from people (`account_id` not null).

## 11. Art

Everything is original and drawn in code, as in v13.

- **Pond scene** (`pond-art.ts`, seeded RNG):
  - painters for grass, the pond water (gradient + sparkles), lilies, reeds, the platform planks, the dirt patch and mounds, the depot stall (awning, baskets, scale), the shop hut (chòi lá, rod rack), the records board, the sign, palms, bamboo, banana plants and the boat;
  - output: one background canvas, depth-sorted props, and animated overlays (water sparkles, lily bob) that honour reduced motion.
- **Fish icons** (`fish.ts`, 16×16 grids + palettes), with distinct silhouettes:
  - Thường: cá rô (olive, spiny back), cá sặc (olive with dark stripes), cá mè vinh (tall silver);
  - Khá: cá lóc (long, dark snakehead), cá trê (yellow-brown catfish with whiskers), cá chép (golden carp);
  - Hiếm: cá tra (grey catfish), cá thát lát (humped silver knifefish), tôm càng xanh (prawn with blue claws);
  - Quý: cá bông lau (silver catfish, forked tail), cá he vàng (gold with red fins);
  - Huyền thoại: cá hô (big grey-silver barb).
- **Gear icons** (`gear.ts`, 16×16): 3 rods, 3 bobbers, 3 baits, bait box, 2 buckets.
- **`ItemIcon`** draws any id from clothing, fish or gear (`iconMatrixFor(id)`).
- **Fishing drawing** (`art/fishing.ts`, world pixels):
  - rod: 2 px from the hand, 14 px long, pointing along the facing with the tip raised; it bends while reeling;
  - line: 1 px, from the tip to the bobber;
  - bobber: 3×4 px, red over white. Phao xốp tints to the rarity colour at the bite; Phao đèn glows;
  - ripples while waiting, a dip at the bite, splashes while reeling;
  - ❗ and the catch label ("🐟 Cá lóc 1,2 kg", in the rarity colour, 3 s) are text overlays at device resolution.
- **Held fish:** the species icon at 1:1 near the hands. Facing down, in front of the belly; left or right, at the side (mirrored for right); facing up, hidden. It is not drawn while fishing (`f ≠ 0`).
- **NPCs** (`lib/game/look.ts`), static characters with name tags:
  - **cô Ba**: warm skin, long black hair, nón lá, áo bà ba hồng, quần dài đen, dép nâu;
  - **chú Tư**: tan skin, short black hair, mũ tai bèo xanh, áo bà ba trắng, quần đùi đỏ, dép xanh, khăn rằn.

## 12. Input rules (additions to v13 §11)

- **Space:** at the bite, hooks; while reeling, holds.
- **Mouse / touch:** at the bite, a click or tap on the canvas or on **❗ Giật cần!** hooks; while reeling, hold anywhere on the overlay.
- **Esc:** while waiting, **Thu cần**; otherwise it closes the top panel (v13).
- From casting until the result, WASD/arrows, click-to-move and E do nothing.
- Every game key is ignored while typing (v13).

## 13. Error handling and edge cases

- **`fishing_state` fails:** coins show "—", and the fishing actions are replaced by **Tải lại giỏ đồ**.
- **Page reloaded or closed during a cast:** the cast stays open until the next `start_cast` abandons it (the bait is lost) or it expires.
- **Two tabs of one account:** the newer `start_cast` abandons the older cast; the older tab's `finish_cast` then shows "Cá đã thoát mất rồi." Wallet operations are serialized by `_wallet_lock`.
- **Hourly cap reached:** the fishing prompt reads "Nghỉ tay — còn N phút".
- **Room deleted during a cast:** `casts.room_id` becomes null, so there is no announcement.
- **Account deleted:** its wallet, ledger, inventory, fish, bests, profile and cast are removed by cascade.
- **Time:** the server rules use `now()`; the client only uses the durations returned by the RPCs.
- **Reduced motion:** no ripples or sparkles. The minigame stays, because it is gameplay.

## 14. v13 carry-overs in scope

Each item comes from the v13 manual pass or the final triage and touches code that v14 changes anyway.

1. **Camera bottom inset.** At the far end of the hall's dock the character was hidden behind the chat bar, and the pond's "Bến vào" sits at the bottom edge as well. `GameShell` passes the height of the bottom HUD, and the camera may scroll past the map bottom by that much. The extra band is painted in the edge colour.
2. **Collapsible now-playing card.** Under 640 px width it collapses to a one-line chip (title + ▶/⏸ for the DJ) and expands on tap.
3. **Frame-loop guard (M3).** `update`/`render` run inside `try`/`catch`. After 3 failing frames in a row, the engine calls `onFatal(err)` and the shell falls back to classic with a message.
4. **Grapheme-safe `wrapBubble`.** NFC plus `Intl.Segmenter` (fallback `Array.from`), so emoji and Vietnamese accents are never cut in half.
5. **Pure `DEFAULT_LOOK` (M9).** `lib/game/look.ts` holds `DEFAULT_LOOK` and the NPC looks without importing Supabase; `lib/game/character.ts` re-exports it.
6. **Game channel sends wait for `SUBSCRIBED`.** Control messages are held and movement is coalesced until then, with no per-call REST fallback warnings. `joinGameChannel` gets unit tests (M8, the channel part).

The other v13 minors stay deferred, as recorded in the v13 final triage.

## 15. Testing

**Unit tests (Vitest):**

- `tests/unit/game-maps-registry.test.ts` — registry ids and caching; each portal's `arrive` spot is walkable and reachable on its target map; the hall's `dock_sign` is a portal to the pond.
- `tests/unit/game-pond-map.test.ts` — the arrival spot and every use spot are walkable and reachable; fishing spots face open water and their bobber points are water inside the pond; spot spacing; the dig spots lie on the dirt patch; the stalls and the board are blocked.
- `tests/unit/game-reel.test.ts` — defaults; holding lifts, releasing falls and bounces, clamps; the fish stays in [0, 1]; a seeded tracker catches an easy fish and never before `minReelMs`; an idle player loses; the 60 s limit; `dt` clamp; determinism.
- `tests/unit/game-cast.test.ts` — phases by time (waiting → bite → missed); hooking inside and outside the window; cancel while waiting.
- `tests/unit/fishing-state.test.ts` — `parseFishingState`, `castBlocker` (every reason, worm fallback), capacities, `maxBuyQty`, `ownsItem`, `handFish`.
- `tests/unit/fishing-catalog.test.ts` — `formatWeight` (350 g, 1 150 g → 1,2 kg, 12 000 g → 12,0 kg), `formatXu`, rarity names/colours, `describeItem` for each kind, `fishingErrorMessage` (with `detail` → minutes/seconds).
- `tests/unit/fishing-announce.test.ts` — valid and invalid bodies; only null-account "Ao cá" messages; fixtures copied from the SQL `format(...)`.
- `tests/unit/game-protocol.test.ts` (extended) — `fs` validation; optional `f`/`h`; the gate treats `fs` as control.
- `tests/unit/presence-mode.test.ts` and `tests/unit/presence-scheduler.test.ts` (extended) — the `map` field (latest game tab, old clients → hall); `mapCounts`; `setMap` merged with `setMode` under one budget.
- `tests/unit/game-social.test.ts` (extended) — roster per map.
- `tests/unit/game-world.test.ts` (extended) — remote fishing phase, hand fish, catch label, stale-`fs` fallback.
- `tests/unit/game-fish-art.test.ts` — 12 fish and 12 gear icons are 16×16 with known codes only; every seeded species and shop item id has an icon (reads the `0012` seed).
- `tests/unit/game-channel.test.ts` (new, M8) — per-map topic; sends wait for `SUBSCRIBED`; leave sends `bye`.
- `tests/unit/game-scene.test.ts` (extended) — camera bottom inset.
- `tests/unit/game-seating-text.test.ts` (extended) — grapheme-safe wrapping.

**Integration** (`tests/integration/v14.test.ts`, runs when `SUPABASE_TEST_URL` is set): every RPC's happy path and errors — claim twice, dig cooldown, buy without coins, buy owned gear, cast → finish too early (`lost`), finish twice (`cast not found`), sell someone else's fish, and the board limited to room members.

**SQL smoke test** (`tests/sql/v14-smoke.sql`, on the throwaway PostgreSQL 18 cluster, using the v13 plan's replay procedure: port 5499, trust auth, stub roles/schema):

- replay `0004`–`0012`, then `0012` again (it must be idempotent);
- run every RPC as a test account;
- move `casts.bite_at` back to pass the time gate;
- drive the song bonus with direct `rooms` updates: under 75 % → no bonus; over → +10; the 11th bonus in a day → none; a replay → none;
- roll 20 000 times with `_roll_rarity` for worms + wooden rod: Thường and Khá within ±1.5 points, Huyền thoại < 1 %;
- check that `advance_queue` still works with the triggers.

**Manual test** (in-app browser, two accounts; the owner logs in):

1. Hall ↔ pond both ways; the map counts update on both clients.
2. The daily toast appears once.
3. Dig: gain, cooldown, bait full.
4. Cast → bite → reel → catch card; the other account sees the line, bobber, ❗, reel, catch label and the fish in hand.
5. A missed bite; **Thu cần**; "hands full" without a bucket.
6. Shop: bait quantity, bobber rarity colour, a bucket, "not enough coins".
7. Depot: sell one and sell all; the hand fish disappears for the other account.
8. A rare+ catch shows the system line in the classic view and a toast in game mode.
9. The records board, both tabs.
10. A ≥ 60 s song queued by account B plays through → B gets +10 xu.
11. Phone viewport: tap to cast, the hook button, hold-to-reel, panels, the collapsed now-playing chip.
12. A classic member is seated in the hall and absent from the pond.

**README:** a v14 section covering how to fish, the economy numbers, the trust model (§8.7), the realtime budget (§9.4) and "run `0012` in the SQL editor".

## 16. Out of scope

- **v15:** fashion shop and buying clothes (`_item_ok` "or owned"), `characters.hand` items, pets, NPC dialogue, emotes and sit poses.
- **Not planned:** a server-verified minigame, trading or gifting xu, cooking or eating fish, weather and time of day, sound effects, persistent positions or map.
