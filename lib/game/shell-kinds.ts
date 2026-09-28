import type { InteractKind } from "./maps/types";

// The interactables GameShell handles itself (before the farm, cards and fishing controllers get the rest), and the panel
// each one opens. Pinned by tests/unit/game-shell-kinds.test.ts: concurrent edits have lost cases before.

export type ShellPanel = "queue" | "board" | "restaurant" | "vehicle_shop" | "fashion_store" | "salon" | "city_map" | "news" | "pet_shop" | "motel" | "apartment" | "furniture_shop" | "lot" | "estate" | "fight_practice" | "dojo";

/** kind → the GameShell panel it opens (the portal travels instead, so it has none). */
export const SHELL_PANEL_OF = {
  dj_booth: "queue",
  notice_board: "board",
  restaurant: "restaurant",
  vehicle_shop: "vehicle_shop",
  clothes_shop: "fashion_store",
  salon: "salon",
  city_map: "city_map",
  news_stand: "news",
  pet_shop: "pet_shop",
  motel: "motel",                                   // v19.1
  apartment: "apartment",                           // v19.2
  furniture_shop: "furniture_shop",                 // v19.2
  lot: "lot",                                       // v19.3
  estate: "estate",                                 // v19.4
  punch_bag: "fight_practice",                      // v20.1
  dojo: "dojo",                                      // v20.2
} as const satisfies Partial<Record<InteractKind, ShellPanel>>;

/** Every kind with its own `case` in GameShell's onInteract. */
export const SHELL_KINDS: readonly InteractKind[] = ["portal", ...(Object.keys(SHELL_PANEL_OF) as InteractKind[])];
