# v19 Nhà ở (housing): design

Date: 2026-09-27. Status: v19.1–v19.4 implemented (uncommitted); v19.4's rulings are in `docs/superpowers/plans/2026-09-27-v19-4-real-estate.md`. v19.2's final rulings
(access model, grid, TV, fridge) are in `docs/superpowers/plans/2026-09-27-v19-2-apartments.md`; v19.3's (rent per 30 days,
one home across flats, lots and rooms, the builder's checks, no build time) in `docs/superpowers/plans/2026-09-27-v19-3-land.md`.

## Owner's request (summary)

- Sleeping gives a buff for the next day: hunger and thirst drain −30 % and walking +7 %.
- A motel (nhà nghỉ) rented per night or per month.
- Apartments (chung cư) to rent or buy, with decorating.
- Land plots and a custom house builder, where you can rent rooms out to other players.
- A furniture store at Chợ Lớn:
  - a TV that plays YouTube, reusing the room's player and queue;
  - a fridge that stores fish, so they don't spoil or count against the bag.
- A real-estate market.

Everything is paid in xu through `coin_ledger`. Every money move is a SECURITY DEFINER RPC with the session token.

## Sub-versions

| # | Name | Contents | Depends on |
|---|------|----------|-----------|
| v19.1 | Nhà nghỉ + giấc ngủ | Motel at Chợ Lớn, night/month rent, private room view, sleep cutscene, "Ngủ ngon" buff (vitals_tick + walk) | 0038 |
| v19.2 | Khu nhà + chung cư + nội thất | New map "Khu nhà", apartment block, rent/buy apartments, furniture store at Chợ Lớn, walkable instanced interiors, decorating, TV (YouTube), fridge | v19.1 |
| v19.3 | Đất + xây nhà + cho thuê phòng | Land plots on Khu nhà, a tile-based house builder, rooms rented to other players, rent income | v19.2 |
| v19.4 | Sàn bất động sản | Listings, buy and sell between players (apartments, houses and land), escrow, fees, history | v19.2, v19.3 |

## Global rulings (every sub-version)

- **R1: Instanced interiors, one per owner.** An interior is not a shared map. The server knows only who owns or rents it and what is placed in it; the layout is data.
  - **v19.1:** the motel room is a private view (a modal with a canvas), not a walkable map. Nobody else sees it, and there is no networking.
  - **v19.2+:** interiors become walkable. They are keyed `interior:<kind>:<id>` and live outside `MapId`, so the city map, weather, heat and rain code is untouched. Their own layer in the canvas uses the normal movement and collision grid.
- **R2: Who sees whose interior.**
  - The owner, their current tenants (v19.3) and guests they invite are the only ones who can enter.
  - Presence inside an interior goes on its own realtime topic, `room:<roomId>:int:<id>`, so the street maps' traffic does not carry it.
  - Visitors see furniture as placed. Only the owner and co-owners edit it.
  - The interior's visibility is owner-set: private, friends of the room, or open house.
- **R3: Indoors is shade, rain-proof and heat-proof.** `_in_shade` returns true for any `interior:*` map. The v18.9 and v18.10 rules then need no change.
- **R4: Housing is per account, not per room.** Owning spans all music rooms, like the wallet and pets. Networking (who is present) stays per music room.
- **R5: Anti-abuse.**
  - Every price and every duration is server-side. Clients only display a copy, and a unit test pins the SQL literals against the TS mirror.
  - Prepaid rent is capped at 60 days ahead.
  - The sleep buff is limited to one sleep per Vietnam day (Asia/Ho_Chi_Minh). It cannot be banked.
  - Transfers between players (v19.3 rents, v19.4 sales) go through escrow RPCs with a 5 % fee sink.
  - Player sales have a price floor and ceiling of 0.5×–3× the list price, to stop coin laundering between alts.
  - A 24 h relist cooldown applies to sales.
  - One rental per tenant per house.
- **R6: The ledger.** Each sub-version re-creates `coin_ledger_reason_check` from the newest full list and adds its reasons. v19.1 adds `motel`.

## v19.1 Nhà nghỉ + giấc ngủ (implemented)

### Rulings

- **Placement.** "Nhà nghỉ Hoa Sen" goes mid-street at Chợ Lớn: `MOTEL_FRONT = {x:520, y:208, w:72, h:36}`, west of the pet kiosk.
  - The front is a narrow two-storey building with a tiled roof, lit windows, a balcony with a potted lotus and a vertical neon "NHA NGHI" sign.
  - The front desk is on the ground floor. cô Hồng stands at (556, 228) behind it.
  - The guest's use spot is the street south of the desk, (556, 264), facing up.
  - Why here: Chợ Lớn's north row is full, and "Khu dân cư" (the city map's greyed "sắp mở") is v19.2's map. So v19.1 adds no `MapId` and does not touch the maps, weather or presence code.
- **Rent.**
  - Một đêm costs 100 xu for 24 h.
  - Một tháng costs 2000 xu for 30 days (≈ 33 % cheaper than 30 nights).
  - Renting while a stay is active extends it: the new time is added after the current end.
  - A stay may run at most 60 days ahead (`too far ahead`).
  - There are no refunds. The ledger reason is `motel`.
  - There is one room per account. Room numbers are cosmetic, so none are stored.
- **The room.** A private view reached from the desk with "Vào phòng" (needs an active stay). It has a bed, a ceiling fan, a lamp, a window at night and a lotus picture. Nobody else sees it.
- **Sleep.**
  - "🛏️ Ngủ" calls `motel_sleep`. The server refuses when there is no active stay, when you are fainted, or when you already slept that Vietnam day.
  - On success a 4.2 s cutscene runs: the lights dim, you lie under the blanket, and Zzz drift up. The modal cannot be closed while it runs. Then "☀️ Dậy rồi!".
  - Only the server's success starts the cutscene, so it is cosmetic. Game time does not skip.
- **Buff "Ngủ ngon".**
  - It lasts 24 h from the sleep. This is the owner's "next day", ruled as a rolling 24 h rather than until the end of the next calendar day: it is simpler, fair across time zones, and a daily sleeper keeps it continuously.
  - Effects: hunger and thirst drain ×0.7 in `vitals_tick`, applied to both drains and multiplying the pet, heat and rain factors. Walking is ×1.07 on the client.
  - Sleeping again the next day resets the end to now + 24 h. It does not stack.
- **Walk speed is client-side,** as all movement is; there is no server speed check.
  - The ×1.07 rides on the engine's pet walk factor. `setPet(code, pet × rest)` has its cap raised from 1.1 to 1.2, which covers a dog's 1.05 × 1.07.
  - A HUD chip "😴 Ngủ ngon" shows while the buff runs.
- **Migrations.**
  - `0039_motel.sql`: tables, rules, RPCs and the ledger.
  - `0040_rest_vitals.sql`: `vitals_tick` copied verbatim from 0038 (v18.9 rain) plus the lines marked `v19.1`. A unit test checks that the body equals 0038's apart from those lines.

## v19.2 Khu nhà + chung cư + nội thất (implemented)

> **Owner decisions (2026-09-27):** sleep gives only the buff; motel prices stay; **the TV plays the apartment's own
> YouTube queue**, shared by the owner and the guests inside (this replaces the "mirror the room's queue" ruling below).
> Access: owner-set door (private / room members / open) plus knock → owner accepts (a 3 h pass).

### Map
- A new `MapId` "khu_nha" ("Khu nhà"), 800×400.
  - It is reached by a portal from Chợ Lớn's east alley (a road trip like hall ↔ market, so vehicles matter) and appears on the city map at "Khu dân cư" (50, 14).
  - Streets hold:
    - the chung cư block, "Chung cư Phú Mỹ", with 12 apartments over 3 floors × 4;
    - v19.3's land plots, 8 lots;
    - a "Sàn bất động sản" office (v19.4);
    - a city-map post.
  - The motel stays at Chợ Lớn.
- Interiors follow R1–R3. The apartment door is an interactable. Entering loads the interior map `interior:apt:<no>`, whose layout is built from the furniture rows. A door mat leads back out.

### Apartments
- 12 units. A unit is **rented** (1500 xu per 30 days, extendable, cap 60 days) or **bought** (25 000 xu list price).
- An owner can move out: selling back to the city pays 70 % of list, or they sell on v19.4's market.
- When the rent lapses, a 7-day grace period applies. After it, the furniture goes to your storage (`furniture_items`, never lost) and the unit frees up.
- Sleeping at home gives the same buff as the motel. `motel_sleep` generalises to `home_sleep(kind, id)` and the one-per-day rule is shared.

### Furniture store at Chợ Lớn ("Nội thất cô Năm")
- A catalog table (`furniture_catalog`: id, name, size w×h in tiles, price, tags) mirrored in TS.
- Items include beds, sofas, tables, lamps, plants, rugs, wallpaper and floor colours, the TV and the fridge.
- Buying puts the item in storage. Decorating places it on the interior's grid at an x, y and rotation. The server validates bounds and overlaps (`furniture_place`).
- **TV** (3000 xu): interacting shows the music room's current YouTube player, the existing `QueuePanel`/player, in a TV frame.
  - It does not start a separate player. It is a view of the room's shared queue, so the synchronised playback and the DJ rules still apply.
  - Ruling: TV audio is the room's own music. No private YouTube, to keep the one-player invariant.
- **Fridge** (2500 xu, 20 slots; the big fridge is 6000 xu with 50 slots):
  - `fish_move_to_fridge` and `fish_move_to_bag` RPCs move a caught fish row into `fridge_fish`.
  - Fish there don't count against the bag capacity and don't spoil. If spoilage/freshness exists, the timer freezes; otherwise the fridge is only extra storage.
  - Selling happens only from the bag, at the depots.

### Networking
- `room:<roomId>:int:<id>` presence topic. The street maps don't carry interior players.
- The owner's `visibility` setting (private, room or open) gates `interior_enter`, which returns the layout and a short-lived entry grant.

## v19.3 Đất + xây nhà + cho thuê phòng (design)

- **Land.** 8 lots on Khu nhà, 20×14 tiles each.
  - Each costs 40 000 xu, bought from the city. There is a yearly-style upkeep of 500 xu per 30 days, and 60 days unpaid means repossession with 50 % back.
- **Builder.** A tile editor inside the lot: walls, doors, floors and up to 6 rooms. Each tile type has a price (wall 20 xu, door 150, window 100, floor 10).
  - It is saved as a compact grid (`house_tiles`, ≤ 280 cells), and the server re-prices and validates connectivity (every room reachable from the front door).
  - The exterior sprite is generated from the grid on the Khu nhà map.
- **Renting rooms to players.**
  - The owner marks a room "cho thuê" at a nightly price of 50–500 xu.
  - A tenant pays the owner through escrow: 95 % to the owner and a 5 % fee (reason `house_rent_pay` / `house_rent_income`).
  - A tenant can sleep in the room (the buff) and store items in a small chest.
  - The owner can evict at the end of the paid period, not before.
  - Limits: one tenant per room and one rental per tenant per house.

## v19.4 Sàn bất động sản (implemented)

- **Listings:** an apartment (bought), a house with its land, or bare land, each with a price inside 0.5×–3× the list or appraisal.
  - The appraisal is land + builder cost × 0.8 + furniture left in.
  - A listing expires after 14 days, and relisting has a 24 h cooldown.
- **Buying:** buy-it-now through escrow.
  - The seller gets 95 % and 5 % is burned (reason `estate_sale` / `estate_buy`).
  - Title moves atomically. Existing tenants' paid periods are honoured.
  - The seller's furniture moves to their storage unless listed "kèm nội thất".
- **History:** a public price history per property. The admin page flags round-trip trades between the same two accounts within 7 days.

## Open questions for the owner

1. Should sleeping also refill a little hunger or thirst? v19.1 does not.
2. The rent levels relative to income: 100 xu a night and 20 xu daily login. Is fishing and farming income enough?
3. Is a TV that only mirrors the room's queue acceptable, or does the owner want a private per-house YouTube? The latter breaks the shared-player model.
