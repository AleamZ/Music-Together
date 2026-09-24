# Music Together v13 — Game Mode: "Sảnh phát nhạc" (Design)

**Date:** 2026-09-24
**Builds on:** v12 (`main` @ `c3b536e`). Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth, SECURITY DEFINER RPCs.
**Roadmap:** v13 = game mode + music hall + characters (this doc) → v14 = fishing pond, economy (xu), fish depot + gear shop → v15 = fashion shop, wardrobe purchases, pets.
**Revised during planning (2026-09-24):** module names, the feet box, the single hair layer, extra scarf codes, the camera rule, the `hello` answer window and the test list were synced with the implementation plan `docs/superpowers/plans/2026-09-24-music-together-v13.md`, whose prototypes were run in the browser.

## 1. Goal

Keep the app a **music room first**, and add an optional **2D pixel game view** of the same room. Anyone in a room can flip their own view between the current UI (**Giao diện cũ**) and **Chế độ game**. In game mode the room is a walkable pixel world: a riverside hammock café (*quán cà phê võng ven sông*) where every online member is a character. The music, queue, chat, reactions and roles are exactly the ones the room already has.

v13 delivers:

1. A per-user view toggle (classic ↔ game), music keeps playing across the switch.
2. A hand-drawn-in-code pixel world, **Miền Tây** style (inspired by the references the owner shared; all art is original, drawn in code — nothing is copied from *Miệt Thương Mến*).
3. One character per account, built from layers (skin, hair, hat, top, bottom, shoes, neck scarf), created on first entry and editable later (**Tủ đồ**) from free starter items. Slots `hand` and `pet` exist in the data model but have no items until v14/v15.
4. Movement with WASD/arrow keys and click/tap-to-move (A* pathfinding); everyone sees everyone move in real time.
5. Chat bubbles and emoji reactions above the sender's head, name tags with role badges.
6. A game HUD (now playing, DJ controls for the DJ, chat bar) and interactables: the DJ booth opens the queue, the notice board opens the charts, the dock sign teases v14.
7. Members who stay in classic mode still appear in the café, seated at tables with a 🖥️ tag.

## 2. Decisions (brainstorm 2026-09-24)

| # | Question | Ruling |
|---|---|---|
| 1 | Decomposition | v13 hall + characters → v14 fishing + economy → v15 fashion |
| 2 | What "game mode" is | Per-user view toggle inside a room; classic users appear seated with 🖥️ |
| 3 | World scope | One world per music room; character/items per account, shared across rooms |
| 4 | Controls | Keyboard (WASD/arrows) + click/tap-to-move with pathfinding, desktop and mobile |
| 5 | Art | Original pixel art drawn in code, Miền Tây style (nón lá, khăn rằn, áo bà ba, dép), 24×48 characters, parchment UI; art is decoupled so PNG sprites can replace it later |
| 6 | Engine | Custom Canvas 2D engine (no Phaser): one small map, few entities, code-drawn sprites; keeps the bundle small and the logic unit-testable |
| 7 | Networking | Supabase Realtime **Broadcast** with an event-driven movement protocol (no position streaming); Presence only carries the view mode |
| 8 | Positions | Ephemeral (never stored); character appearance is stored in Postgres |
| 9 | View-mode persistence | `localStorage["music-together:view-mode"]`, default `classic` |

## 3. Constraints

- **Supabase Realtime free plan:** 100 messages/s per project (an *event* is a message sent **or delivered**, so one broadcast to N listeners costs ≈ N), 2 M messages/month, 200 concurrent connections, Presence 20 messages/s and **5 presence calls per client per 30 s**. The movement protocol must stay near zero while idle and a few messages/s while walking (§8.6 budget).
- `lib/supabase.ts` passes `realtime.params.eventsPerSecond = 5`; realtime-js 2.116 only forwards it to the server as a connection param (there is no client-side throttle), so the game must rate-limit its own sends (§8.4).
- **Public GitHub repo:** only original or permissively licensed art may be committed. v13 art is 100 % code.
- **Themes:** app themes set CSS variables on `html[data-theme=…]`. The game UI uses its own parchment palette; reused room components (queue, chat) are wrapped in `.game-ui`, which re-declares the core color tokens (§10.4).
- **Repo conventions:** pure logic in `lib/` with Vitest unit tests; components verified manually in the browser; React-Compiler hook rules (no synchronous `setState` in effects, no `ref.current` during render). Read `node_modules/next/dist/docs/` before using Next APIs (`AGENTS.md`).
- All writes go through SECURITY DEFINER RPCs authenticated with the session token (`_auth_account`).

## 4. Architecture

```
app/room/[code]/RoomClient.tsx      auth → join gate → <RoomSession>
components/room/RoomSession.tsx     NEW: useRoom view + usePlayback + useSponsorBlock + view mode
 ├─ viewMode === "classic" → <RoomShell view playback sponsor onEnterGame>   (existing UI, playback lifted out)
 └─ viewMode === "game"    → <GameShell  view playback sponsor onExitGame>   (lazy-loaded)
      ├─ <GameCanvas>            canvas + lib/game/engine (loop, input, camera, render)
      │                          + lib/game/net/channel (Broadcast game:{roomId}, handshake)
      ├─ useMyCharacter/useLooks my character / other members' looks (Postgres)
      ├─ HUD (React, parchment)  portrait · now playing/DJ controls · chat bar · buttons
      └─ Panels                  QueuePanel · ChatDrawer · MemberList · RoomChartModal · SettingsDialog · CharacterEditor
lib/game/                         pure logic + art (unit-tested) — see §5–§9
supabase/migrations/0011_v13_game_mode.sql
```

**Why `RoomSession`:** today `usePlayback` lives inside `RoomShell`, so unmounting the shell would destroy the hidden YouTube player and force a new audio-unlock gesture. Lifting `usePlayback` + `useSponsorBlock` one level up keeps one player alive across view switches. `RoomShell` receives the controller as props; its markup is otherwise unchanged.

`GameShell` is loaded with `next/dynamic` (`ssr: false`) so classic-mode users never download game code.

## 5. View mode

- `lib/view-mode.ts` (pure): `type ViewMode = "classic" | "game"`, `parseViewMode(raw): ViewMode` (anything else → `"classic"`), `VIEW_MODE_KEY = "music-together:view-mode"`.
- `hooks/useViewMode.ts`: reads the key after mount, `setViewMode(mode)` persists (try/catch around storage).
- Classic `Header` gets a **🎮 Chế độ game** button; the game HUD has **🖥️ Giao diện cũ**.
- The view mode is also published in room Presence (§8.1) so other members know how to render you.

## 6. Game world model

### 6.1 Units

- World unit = 1 art pixel. Map **hall** = 640 × 400 px. Collision grid cell = 8 px (80 × 50 cells).
- Character sprite 24 × 48 px, anchored at the **feet** (sprite drawn at `x-12, y-46`). Collision box = 6 × 4 px around the feet (`x-3…x+3`, `y-3…y+1`) — small enough to pass between the café tables.
- Walk speed 70 px/s; walk animation 4 frames at 8 fps (`idle, stepA, idle, stepB`).
- Facing: `down | up | left | right` (`right` = mirrored `left`). With diagonal input the horizontal component decides the facing.

### 6.2 Map definition — `lib/game/maps/hall.ts`

```ts
// lib/game/maps/types.ts
export interface Rect { x: number; y: number; w: number; h: number }
export interface Spot { x: number; y: number; dir: Facing }
export type InteractId = "dj_booth" | "notice_board" | "dock_sign";
export interface Interactable { id: InteractId; label: string; rect: Rect; use: Vec }   // rect = click target
export interface GameMap {
  id: string; width: number; height: number; cell: number; cols: number; rows: number;
  blocked: Uint8Array;        // cols*rows, 1 = blocked (built from solids + water − walkable overrides)
  spawn: Vec;
  djSpot: Spot;               // where a classic-mode DJ is shown (behind the mixer)
  seats: Spot[];              // classic-mode members (behind café tables)
  standSpots: Spot[];         // overflow for classic members
  interactables: Interactable[];
  props: PropPlacement[];     // depth-sorted sprites: palm, hammock, post, table, mixer, board, sign, banana, lightpole
}
// lib/game/maps/hall.ts
export function buildHallMap(): GameMap
```

Layout (640 × 400):

| Area | Content | Collision |
|---|---|---|
| North-centre | Stage: red banner with pixel notes, two loa thùng speakers, wooden platform, DJ booth (mixer) | blocked; DJ booth interactable, use spot in front of the stage |
| West | Bamboo grove, two coconut palms with a striped hammock between them and a post | bamboo and trunks blocked |
| East | Café counter "Quầy nước" and 3 round tables with stools; seats behind the tables | counter/tables blocked |
| Centre | Packed-dirt yard (dance floor) under string lights | walkable |
| South | River with water hyacinth, a moored xuồng ba lá, a wooden dock | water blocked, dock walkable |
| South-east | Dirt path to the map edge = spawn/entrance; notice board "Bảng tin" beside the path | board blocked |

Interactables:

- **dj_booth** — "Quầy DJ": opens the Queue panel (§10.2).
- **notice_board** — "Bảng tin": opens `RoomChartModal` (rankings/history).
- **dock_sign** — "Bến câu cá": toast *"Ao câu cá sắp mở — hẹn bản sau!"* (v14 hook).

Seats: 6 (3 tables × 2). Classic-mode members are assigned seats deterministically (online classic account ids sorted ascending → seats in order; overflow → `standSpots`), so every client shows the same arrangement; a classic-mode DJ stands at `djSpot` behind the mixer instead. A seated character is drawn **behind** its table so the table top hides the legs.

### 6.3 Movement — `lib/game/movement.ts` (pure)

```ts
export function isBlockedAt(map: GameMap, x: number, y: number): boolean                  // collision box vs grid
export function stepMove(map: GameMap, pos: Vec, dir: Vec, dtSec: number, speed = 70): Vec // normalized dir, ≤ 4 px substeps, x then y → slides along walls
export function inputDir(keys: KeyState): Vec                                            // -1/0/1 per axis
export function facingFor(dir: Vec, prev: Facing): Facing                                // keyboard: horizontal wins
export function facingForVector(v: Vec, prev: Facing): Facing                            // paths: dominant axis
```

### 6.4 Pathfinding — `lib/game/pathfinding.ts` (pure)

- `findPath(map, from: Vec, to: Vec, maxNodes = 5000): Vec[] | null` — A* on the 8-px grid, 8-neighbour moves with **no corner cutting**, octile heuristic. If the target cell is blocked, the nearest walkable cell within 3 cells is used; otherwise `null`.
- `smoothPath(map, from, points): Vec[]` — string-pulling with a line-of-sight test that uses the collision box; returns pixel waypoints (≤ 32 = `MAX_PATH_POINTS`).
- Keyboard input cancels an active path. Clicking an interactable paths to its `use` spot and triggers it on arrival.

### 6.5 Camera & scaling

- The canvas backing store = container CSS size × `min(devicePixelRatio, 2)`.
- Integer scale `s = max(1, floor(min(devW / 300, devH / 180)))`, then raised until the view is no larger than the map (portrait phones would otherwise see empty bands); logical viewport = `ceil(devW / s) × ceil(devH / s)` (`lib/game/scene.ts`).
- The camera centres on the local player, clamped to the map; if the map is smaller than the viewport it is centred.
- The world renders into a low-res buffer, then is blitted with `imageSmoothingEnabled = false`. Text overlays (names, bubbles, prompts) are drawn afterwards at device resolution.

## 7. Art — `lib/game/art/`

All sprites are string grids (one character per pixel), exactly like `components/brand/PixelLogo.tsx`. The brainstorm mockup (`.superpowers/brainstorm/1961-1790232701/content/style-mientay-v2.html`) is the visual reference and already contains the body, hat and scene drawing code to port.

### 7.1 Layers and draw order

body (legs, bottom, torso, head) → hair → hat — one hair layer per direction; every style covers the whole scalp. (`hand` and `pet` layers are reserved for v14/v15.)

### 7.2 Region codes in body templates

| Code | Meaning | Colour source |
|---|---|---|
| `.` | transparent | — |
| `o` | outline | `#3a2418` |
| `s` `S` | skin / skin shade | skin tone |
| `e` `b` `m` | eyes+brows / blush / mouth | skin tone |
| `t` `T` `u` `K` | top main / shade / highlight / detail (pockets, buttons) | top item (`K` = main for plain tees) |
| `q` `Q` | neck scarf band light / dark | neck item; without scarf → top main / highlight (reads as a collar) |
| `r` `R` | front scarf tails light / dark | neck item; without scarf → top main / highlight |
| `v` `V` `n` | side-view scarf tails light / dark / outline | neck item + outline; transparent without a scarf |
| `p` `P` `l` | bottom main / shade / side stripe | bottom item |
| `j` | hem | outline for shorts, bottom shade for long pants |
| `g` `G` | lower leg / shade | skin for shorts, bottom colours for long pants |
| `f` `F` | sandal strap / sole | shoes item |
| `h` `H` | hair / hair highlight (hair layers only) | hair colour |

### 7.3 Grids

- **Body** (`body.ts`): head (bald + face, 17 rows), torso (13 rows), bottom (6 rows), legs (10 rows, built from one-leg templates so a lifted leg is the same template shifted up one row), 2 empty rows → 24 × 48, for `down`, `up`, `left`. `buildBody(dir, frame): string[]`.
- **Hair** (`hair.ts`): styles `short`, `bob`, `long`, one layer per direction (`down`, `up`, `left`; 24 wide, placed from its top row); every style must fully cover the bald scalp.
- **Hats** (`hats.ts`): `hat_nonla` (wide conical hat, rows 0–8), `hat_taibeo_green` (bucket hat, rows 2–9); symmetric, so one grid serves every direction.
- **Palettes** (`palettes.ts`): skin tones `light | warm | tan | deep`; hair colours `black | darkbrown | brown | pink`.
- **Item render data** (`items.ts`): `Record<ItemId, ItemArt>` keyed by catalog id, e.g. `top_baba_yellow: { slot: "top", kind: "baba", colors: [...] }`, `bottom_shorts_red: { slot: "bottom", kind: "shorts", colors: [...] }`.

### 7.4 Composition — `compose.ts` (pure) + `raster.ts` (browser)

- `compose.ts`: `lookKey(look)` → stable string; `composeMatrix(look, facing, frame)` → 48 × 24 colour matrix (unit-tested).
- `raster.ts`: `getCharacterFrames(look)` → cached `HTMLCanvasElement`s per `(dir, frame)`; `getPortrait(look)` → 24 × 24 head crop for the HUD and panels.
- Mirroring for `right` happens at composition time. The cache is bounded (LRU, 64 looks).

### 7.5 Scene art — `lib/game/maps/hall-art.ts` (browser only)

Procedural painters ported from the mockup, with a seeded RNG so the scene is identical on every client: grass/dirt noise, river and shore, water hyacinth, dock, boat, bamboo, palms, banana plants, stage (banner, speakers, platform, mixer), hammock, tables, stools, counter, notice board, dock sign, string lights. Output:

- one pre-rendered **background** canvas (640 × 400) for everything flat;
- **prop sprites** with an anchor and sort-y for everything that must depth-sort with characters (palms, tables, counter, hammock, posts, board);
- per-frame **animated overlays**: water sparkles, blinking lights, speaker pulse.

## 8. Networking

### 8.1 Presence (room channel `presence:{roomId}`, existing)

Payload grows from `{ name, online_at }` to `{ name, online_at, mode: "classic" | "game" }`. `trackPresence` returns a handle with `setMode(mode)`. Because Presence allows 5 calls per client per 30 s, re-`track()`s are budgeted: changes within 1 s are merged, mode changes use at most 4 calls per 30 s (the pure helper `presenceDelay` computes the wait), a mode the server already acknowledged is never re-sent, a failed or timed-out `track()` is retried, and the re-track after a reconnect may use the reserved 5th call without waiting behind a pending timer. The first track already carries the stored view mode. `useRoom` exposes `presence: Array<{ accountId, name, mode }>` alongside `onlineIds`. Pure helper `aggregatePresenceModes(state)` (unit-tested): an account is `game` if **any** of its tabs reports `game`.

### 8.2 Broadcast channel `game:{roomId}` (new, `self: false`)

| Event | Payload | When |
|---|---|---|
| `hello` | `{ id }` | I entered the world (again after a reconnect). Every other player answers with their state (`st`, or `pa` while walking a path) after a random 0–1500 ms delay. |
| `st` | `{ id, x, y, d, mv, vx, vy }` | full state (answer to `hello`) |
| `mv` | `{ id, x, y, d, mv, vx, vy }` | keyboard movement changed (start, stop, direction); keep-alive every 3 s while moving |
| `pa` | `{ id, x, y, pts: [[x,y],…] }` | click/tap path started (≤ 32 waypoints) |
| `lk` | `{ id }` | my look changed → receivers refetch that character |
| `bye` | `{ id }` | I left the world (switched to classic / unmounted) |

`id` = account id, `x,y` integers, `d` ∈ `u|d|l|r`, `mv` boolean, `vx,vy` ∈ `{-1,0,1}` (direction of travel; speed is a constant).

### 8.3 Validation — `lib/game/net/protocol.ts` (pure)

`parseGameMessage(event, payload): GameMessage | null` rejects wrong types, non-integers, coordinates outside the map, unknown facings, `pts` longer than 32. Receivers also drop messages whose `id` is their own or is not a current room member.

### 8.4 Send gate (pure)

`createSendGate({ ratePerSec: 3, burst: 3 })` — token bucket; `mv` is **coalesced** (only the latest pending state is flushed when a token frees up), `pa`/`hello`/`st`/`lk`/`bye` take a token or wait. Worst case ~3 game messages/s per client, which keeps a client's total (game + reactions, reactions already throttled to 4/s) near the 5/s the app declares.

### 8.5 Remote players — `lib/game/actor.ts` (pure, shared with the local player)

State per remote: position, facing, velocity, optional path, `lastMsgAt`, and a display position.

- `mv`/`st`: if the display position is > 48 px away → snap; else the display position blends exponentially (12 /s) towards the simulated one, which extrapolates along `(vx,vy)` at 70 px/s through `stepMove` (same collision as the sender, so walls stop both sides alike).
- `pa`: start from `(x,y)` and walk the waypoints at 70 px/s.
- Moving with no message for 4 s → stop (lost `stop` guard).
- A game-mode member with no state yet is hidden for up to 2 s (answers to `hello` arrive within 1.5 s), then shown at the spawn until the first `st`/`mv`.

### 8.6 Budget (documented in README)

One walking player sends ≈ 1–2 msgs/s, an idle player 0. With N players in the world each message is delivered N−1 times. Example: 10 players, each walking ~25 % of the time → ≈ 3 sends/s × 10 ≈ 30 events/s (limit 100) ≈ 110 k/hour → the free 2 M/month covers ~18 hours of a 10-person session (≈ 100 hours for 4 people). Joins cost O(N²) once (`hello` + N answers, spread over 1.5 s).

**Re-joining a topic:** realtime-js returns the existing channel for a topic while it is still leaving, and a leaving channel never re-joins; on a classic ↔ game switch one component leaves `reactions:{roomId}` while another joins it in the same commit. `lib/channel-lifecycle.ts` makes a join wait for the previous leave of the same topic (used by the game and reactions channels).

## 9. Characters & catalog (Postgres)

### 9.1 Migration `supabase/migrations/0011_v13_game_mode.sql` (additive, re-runnable)

```sql
create table if not exists public.item_catalog (
  id text primary key,
  slot text not null check (slot in ('hat','top','bottom','shoes','neck','hand','pet')),
  name text not null,
  price integer not null default 0 check (price >= 0),
  starter boolean not null default false,
  sort_order integer not null default 0
);
create table if not exists public.characters (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  skin text not null, hair text not null, hair_color text not null,
  hat text references public.item_catalog(id),
  top text not null references public.item_catalog(id),
  bottom text not null references public.item_catalog(id),
  shoes text not null references public.item_catalog(id),
  neck text references public.item_catalog(id),
  hand text references public.item_catalog(id),
  pet text references public.item_catalog(id),
  updated_at timestamptz not null default now()
);
-- RLS on; anon SELECT on both (appearance is public, like accounts.username)
-- seed starter items with `insert … on conflict (id) do update`
```

Starter items (all `price 0`, `starter true`):

| Slot | Ids (Vietnamese name) |
|---|---|
| hat | `hat_nonla` (Nón lá), `hat_taibeo_green` (Mũ tai bèo xanh) |
| top | `top_baba_yellow` (Áo bà ba vàng), `top_baba_white` (Áo bà ba trắng), `top_baba_pink` (Áo bà ba hồng), `top_tee_blue` (Áo thun xanh dương), `top_tee_green` (Áo thun xanh lá) |
| bottom | `bottom_shorts_red` (Quần đùi đỏ), `bottom_pants_black` (Quần dài đen), `bottom_jeans` (Quần jean) |
| shoes | `shoes_dep_blue` (Dép xanh), `shoes_dep_brown` (Dép nâu), `shoes_dep_red` (Dép đỏ) |
| neck | `neck_khanran` (Khăn rằn), `neck_khanran_red` (Khăn rằn đỏ) |

### 9.2 RPC `save_character`

```sql
save_character(p_session_token text, p_skin text, p_hair text, p_hair_color text,
               p_hat text, p_top text, p_bottom text, p_shoes text, p_neck text)
returns public.characters
```

- `_auth_account(p_session_token)`.
- `skin ∈ {light,warm,tan,deep}`, `hair ∈ {short,bob,long}`, `hair_color ∈ {black,darkbrown,brown,pink}` — else `invalid character option` (22023).
- Each item: `hat`/`neck` nullable, `top`/`bottom`/`shoes` required; the id must exist with the **matching slot** and be `starter = true` (v14 widens this to "or owned") — else `item not available` (22023).
- Upsert on `account_id`, `updated_at = now()`, return the row.

### 9.3 Client — `lib/game/character.ts`

`Look` type (camelCase mirror of the row), `DEFAULT_LOOK` (warm skin, short black hair, nón lá, áo bà ba vàng, quần đùi đỏ, dép xanh, khăn rằn), `lookFromRow`, `validateLook(look, catalog)` (same rules as the RPC, for the editor), `fetchCatalog()` (cached), `fetchCharacters(accountIds)`, `saveCharacter(token, look)`, `characterErrorMessage(err)`. Hooks: `useMyCharacter(accountId)` (my look + whether a row exists) and `useLooks(accountIds)` (other members, refreshed on `lk`). An unknown item id renders with a placeholder palette, never crashes.

## 10. Game UI

### 10.1 GameShell layout

Full-viewport canvas with parchment overlays (cream `#fbf3dc`, brown border `#8b5a2b`, pixel font **VT323** — covers Vietnamese — loaded with `next/font/google`):

- **Top-left:** portrait + name + role badge (👑 admin, 🎧 DJ), **👕 Tủ đồ**.
- **Top-right:** now playing (title, DJ name, progress). DJ: ▶/⏸, ⏭, seek. Everyone: volume, **🔈 Bật âm thanh** when audio is locked, play-error notice. Buttons **📜 Hàng đợi**, **🏆 Bảng tin**, **⚙️** (admin/DJ → `SettingsDialog`).
- **Bottom:** chat input (Enter sends via `useChat().send`), reaction picker (existing 5 emojis), **💬** (full chat drawer), **👥** members, **🖥️ Giao diện cũ**.
- **Prompt** near the player when an interactable is in range: *"E · Mở hàng đợi"* (desktop) / a tap button (touch).
- **Toasts** for transient messages.

### 10.2 Panels (reuse)

- **QueuePanel** = parchment modal around the existing `AddSong`, `MyPending`, `PendingQueue` (Admin/DJ), `Queue` with the same props and rule logic that `RoomShell` computes (extract that computation into a shared `lib/room-derived.ts` helper so both shells stay identical).
- **ChatDrawer**, **MemberList**, **RoomChartModal**, **SettingsDialog** reused as-is.

### 10.3 Character editor — `components/game/CharacterEditor.tsx`

- Opens automatically on first entry when `characters` has no row for me (mode *create*, no cancel except back to classic), and from **👕 Tủ đồ** (mode *edit*).
- Left: animated preview (walks, turns every 1.2 s). Right: swatches for Da, Kiểu tóc, Màu tóc and item pickers for Mũ (incl. "Không"), Áo, Quần, Dép, Khăn (incl. "Không"), listing starter items from the catalog.
- **Lưu** → `saveCharacter` → broadcast `lk`; errors show inline.

### 10.4 `.game-ui` token scope

`app/globals.css` gains `.game-ui { --color-cream: …; --color-parchment: …; --color-ink: …; --color-burgundy: …; --color-gold: …; … }` with the parchment palette, so reused components inside the game look the same whatever app theme is selected. Theme rules that target elements directly (e.g. `html[data-theme="cozy"] button`) may still leak; accepted.

### 10.5 Social overlays (canvas)

- **Name tag** under the feet; badges 👑/🎧; classic members get 🖥️.
- **Chat bubble:** new chat messages (from the single `useChat` instance the shell owns) show above the author's character for 6 s, max 2 lines × 28 chars with "…". A newer message replaces the previous bubble.
- **Reactions:** the reactions payload gains an optional `accountId` (backward compatible). In game mode the emoji floats up from the sender's head for 1.5 s; unknown sender → floats from the top of the screen.

## 11. Input rules

- Keyboard events are ignored while an input/textarea/contenteditable has focus or a modal is open.
- `E` / `Enter` (without a focused input) triggers the interactable in range; `Esc` closes the top panel.
- Pointer: click/tap on the ground → path; on an interactable → path + use; on a character → show a small card (name, role).
- Touch devices get the same HUD with larger hit targets; the chat bar collapses to a 💬 button under 640 px width.

## 12. Error handling & edge cases

- Broadcast channel not `SUBSCRIBED` → HUD shows *"Đang kết nối thế giới…"*; local movement still works; retry on the next status change (supabase-js reconnects).
- Character fetch fails → `DEFAULT_LOOK`. Save fails → inline error, editor stays open.
- Same account in two game tabs → both drive the same character (documented, not prevented).
- Canvas 2D unavailable → an alert, then back to the classic view.
- Reduced motion (`prefers-reduced-motion`): no floating notes, no blinking lights.

## 13. Testing

Unit (Vitest):

- `tests/unit/view-mode.test.ts` — parse/persist fallback.
- `tests/unit/game-art.test.ts` — every grid is 24 wide (hats included), bodies/hair 48 tall, only known codes; every starter catalog id has art; every hair style covers the scalp rows in every direction.
- `tests/unit/game-look.test.ts` — default look valid; `validateLook` rejects wrong slot / unknown option / missing required slot; `lookFromRow`.
- `tests/unit/game-movement.test.ts` — collision box, axis-separated sliding, diagonal normalization, facing.
- `tests/unit/game-pathfinding.test.ts` — path around obstacles, no corner cutting, blocked-target fallback, unreachable → null, smoothing keeps line of sight and ≤ 32 points.
- `tests/unit/game-hall-map.test.ts` — spawn, seats, stand spots and every `use` spot are walkable and reachable from the spawn; the dock is walkable, the water is not.
- `tests/unit/game-protocol.test.ts` — message validation, send gate (rate, burst, `mv` coalescing).
- `tests/unit/game-actor.test.ts` — snap vs blend, extrapolation with collision, path following, stale stop.
- `tests/unit/game-compose.test.ts` — palette mapping (scarf / no scarf, shorts / long pants), mirroring, hat placement.
- `tests/unit/game-hall-art.test.ts` — seeded RNG; prop frames line up with the interaction rects.
- `tests/unit/game-scene.test.ts` — view scale (incl. portrait phones), camera clamp, hit tests, overlay stacking.
- `tests/unit/game-seating-text.test.ts` — seat assignment, bubble wrapping.
- `tests/unit/game-social.test.ts` — roster (seats, DJ spot, badges, non-members ignored), fresh chat bubbles.
- `tests/unit/game-character-hooks.test.ts` — `useMyCharacter` / `useLooks`.
- `tests/unit/channel-lifecycle.test.ts` — joins wait for the previous leave of the same topic.
- `tests/unit/reactions.test.ts` — `parseReaction` (old and new payloads).
- `tests/unit/presence-mode.test.ts` — `aggregatePresenceModes`, `presenceDelay`.
- `tests/unit/presence-scheduler.test.ts` — `trackPresence` budget, merge, retry, reconnect reserve, unsubscribe (fake channel + fake timers).
- `tests/unit/room-derived.test.ts` — shared queue/rules derivation.

Integration (`tests/integration/v13.test.ts`, runs when `SUPABASE_TEST_URL` is set): `save_character` happy path + upsert, invalid option, wrong-slot item, non-starter item, bad session. The migration is replayed on a throwaway local PostgreSQL 18 cluster before handing it to the owner.

Manual (in-app browser, the owner logs in): toggle both ways with music uninterrupted; create/edit character; two accounts see each other walk, chat bubbles, reactions; DJ controls from the HUD; queue panel add/approve; classic member seated with 🖥️; mobile viewport tap-to-move.

## 14. Out of scope (later versions)

- v14: pond map + transition via the dock, worm digging, fishing minigame, fish in hand / bucket, fish depot (sell by weight × rarity), coins, gear shop (rods, bobbers, bait, bucket), inventory table + purchase RPCs, `hand` items.
- v15: fashion shop, buying clothes, pets that follow, emotes/sit poses, NPC dialogue.
- Not planned: server-authoritative movement, persistent positions, sound effects.
