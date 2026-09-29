# Unified world ("Thế giới liền mạch") — design (2026-09-29, proposal, branch feat/diorama)

Owner: "Các map đang quá nhỏ và không connect với nhau — muốn toàn bộ map liên kết bởi 1 map to thống nhất."

## Key idea
Every gameplay RPC already says "on map X at local (x, y)". Make each old map a **zone** = a rectangle at a fixed offset in
one world. `(zone, localX, localY)` and `(worldX, worldY)` are the same position written two ways, so the 60+ proximity
RPCs (fishing, field, market, mine, bosses, quests, treasure…) stay unchanged; only the position core, client engine,
renderer and realtime change.

## 1. Layout — world 4160 × 2240 px (520 × 280 cells of 8 px; ~16 s to cross on foot)
| Zone | Origin (ox, oy) | Size |
|---|---|---|
| field (Đồng lúa) | (0, 560) | 800×480 |
| hall (Đình làng, spawn) | (960, 480) | 640×400 |
| pond (Ao làng) | (960, 1040) | 640×400 |
| market (Chợ Lớn) | (1760, 480) | 1280×400 |
| khu_nha | (3200, 480) | 800×400 |
| bai_dat (dojo, rings, bosses) | (2400, 1040) | 800×400 |
| mo_da (hills) | (3360, 1040) | 640×400 |
| song_cai (boat reach of the river) | (960, 1600) | 960×480 |
| wild (new filler: roads, forest belt north, hills, river band) | rest | – |
| ham_ngam, houses/apartments | interiors (instanced, entered by door/hatch) | – |

```
x→ 0        800 960      1600 1760            3040 3200     4000 4160
0   ~~~~~~~~ forest belt (scenery) ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
480 .        . +--------+ .   +--------------------+ .  +--------+   .
560 +--------+ |  HALL  |=====|   MARKET  Chợ Lớn  |====| KHU NHÀ|   .
    | FIELD  |=|  Đình  | road|  [hatch→Hầm ngầm]  |road| houses |   .
    |        | +---||---+     +---------||---------+    +--------+  /\ hills
1040+--------+ +---||---+          +----||------+ road +--------+  /\
       \\=====|  POND  |          |  BÃI ĐẤT   |======| MỎ ĐÁ  |
               +---||---+          +------------+      +--------+
1440             [pier]
1560 ~~~~~~~~~~~~~+====SÔNG CÁI (boat reach)====+~~~~ river band, bridges B1/B2 ~~~~
2240
```
Old portal pairs become the two ends of road segments (world coords). Landmarks visible from afar: đình roof, market arch,
dojo tower, mine headframe, river island. Level gates (song_cai lv3…) = bamboo barrier + guard at the zone border.

## 2. Coordinates
- `lib/game/world/zones.ts`: `ZONES`, `toWorld(zone, p)`, `toLocal(w) → {zone, p}`, `zoneAt(w)`; `ZoneId = MapId | "wild"`.
- `lib/game/world/compose.ts` `buildWorld(unlocked)`: stamps each zone's `blocked` grid and maps interactables/npcs/props/
  plots/spawn through `toWorld` (tag `zone`); `openings` per zone replace portals; filler from `lib/game/world/wild.ts`.
- Client RPC call sites send `serverPos(world) = toLocal(world)` — payloads unchanged. Geometry helpers keep local coords.
- 3D: absolute coords (`px/16`), chunked build.

## 3. Server — one migration (next free number, e.g. 0088_unified_world.sql)
- `player_pos` + `wx, wy` (backfill; interiors null); keep `map/x/y` maintained as zone-local (`map` may be `'wild'`).
- New: `_world_zones()`, `_zone_to_world`, `_world_to_zone`, `_pos_on_zone(account, zone, x, y, r)`.
- Re-create (from newest): `_pos_maps` (+ wild), `_pos_portals` (interiors only), `_pos_need_s` (world distance ×
  detour factor 1.35 across non-adjacent zones, slack 64), `_pos_road_s` → vehicle speed multiplier
  (`vehicle_catalog.speed_mul`, ≤3.0), `_pos_claim` (same signature = compatibility shim; world speed check; spawn +
  discovered waypoints exempt; level gate by zone at the new point), `pos_report` + `pos_report_w(token, wx, wy)`,
  `_river_move`, `waypoint_travel`, `skip_trip`.
- `map_levels` + ('wild', 1); `world_waypoints` table seeded from old spawns; flag `unified_world` so both clients work
  during rollout. Audit the 5 hard-coded `map = '…'` branches in vitals/stamina/pet ticks (treat `wild` as outdoors).

## 4. Realtime
- Area-of-interest grid cells 640×560 (7×4 = 28): topic `game:{room}:c{cx}_{cy}`; subscribe own + 8 neighbours (≤9
  channels), broadcast to own cell, 64 px hysteresis, `whenTopicFree` switch. Interiors keep their own topics.
- Presence stays room-wide; `map` = zone (incl. `wild` → "Ngoài đồng" in MapCounts), `c` = cell; update on zone change.
- Degrade: >30 visible players → 2 msg/s snapshots.

## 5. Client
- Engine uses one world `GameMap` (blocked grid ~145 KB); portals only for interiors; `currentZone` per frame drives HUD,
  music, weather; spatial hash (128 px) for interactables/NPCs.
- 3D chunks 320×320 (13×7), build within 2 / dispose beyond 3; instancing per chunk; LOD skyline + landmarks; quality tiers.
- 2D fallback: per-zone offscreen canvases blitted at (ox, oy); filler chunks on demand.
- Minimap = player-centred window over a prebuilt 1/16 world image; city map modal = true world map (zones, waypoints,
  locks, party dots). Vehicles drive on roads at speed_mul; road-trip hops removed; lifts = follow a driver.

## 6. Phases (~33 dev-days)
| Phase | Scope | Test | Effort |
|---|---|---|---|
| P0 | zones.ts, toWorld/toLocal, headless compose | every spawn/interactable/portal end on a free world cell; round-trip | 3 d |
| P1 | server world coords under portals (flag off), pos_report_w, diorama absolute coords | no behaviour change; no rise in pos_teleport | 4 d |
| P2 | stitch hall + market + pond, roads, chunked 3D | walk hall→market→pond without loading; RPCs pass; mobile ≥30 fps | 7 d |
| P3 | whole world, river, bridges, gates, vehicles, waypoints, world map/minimap, flag on | full RPC regression | 10 d |
| P4 | AOI realtime cells | 40 simulated clients; deliveries/s, channel counts | 5 d |
| P5 | LOD, 2D fallback chunks, remove old portal code | – | 4 d |

Risks: corner-cutting (detour factor, watch ac_stats), mobile perf (chunks/instancing/tiers), realtime quota, hard-coded
map literals, rideshare semantics change. Cut first if needed: 2D fallback, river band beyond song_cai, LOD, grid AOI
(zone channels instead), server grid collision.
