import type { CardGame } from "@/lib/game/cards/deck";
import type { Facing, Look, Vec } from "@/lib/game/types";

export interface Rect { x: number; y: number; w: number; h: number }
export interface Spot { x: number; y: number; dir: Facing }

export type MapId = "hall" | "pond" | "field" | "market" | "khu_nha";
export const MAP_IDS: readonly MapId[] = ["hall", "pond", "field", "market", "khu_nha"];

export type InteractKind =
  | "dj_booth" | "notice_board" | "portal" | "fish_spot" | "dig_spot" | "depot" | "shop" | "records"
  | "plot" | "coop" | "farm_shop" | "rice_depot" | "drying"
  | "card_table" | "card_rules" | "crab_hole" | "snail_bed"
  // v18.4: Chợ Lớn's restaurant counter and clothes shop counter
  | "restaurant" | "clothes_shop"
  // v18.5: Chợ Lớn's vehicle stall, and its fish and produce depots (they pay +20%)
  | "vehicle_shop" | "market_fish_depot" | "market_farm_depot"
  // v18.6: anh Ba's salon at Chợ Lớn
  | "salon"
  // v18.12: cô Mười's pet shop at Chợ Lớn
  | "pet_shop"
  // v18.9: cô Chín's umbrella stall at Chợ Lớn
  | "umbrella_stall"
  // v19.1: cô Hồng's Nhà nghỉ Hoa Sen at Chợ Lớn (rent a room, sleep)
  | "motel"
  // v19.2: the Khu nhà apartment block's lobby door, and cô Năm's furniture store at Chợ Lớn
  | "apartment" | "furniture_shop"
  // v19.3: the gate of a Khu nhà lot (buy it, build, rent rooms, go in)
  | "lot"
  // v19.4: the Sàn bất động sản office on Khu nhà (players sell flats and lots to each other)
  | "estate"
  // every map: the city-map signpost (a view-only overview of the town)
  | "city_map"
  // v18.11: the hall's Báo Làng news stand (dev blog + village news)
  | "news_stand"
  // the hall's hammock: lie down in it (handled by the engine itself, never reaches the shell)
  | "hammock"
  // v17: a live rat, offered by the engine when no map interactable is in range (never in a map's list)
  | "rat";

export interface Interactable {
  /** Unique per map: "dock_sign", "fish_3", … */
  id: string;
  kind: InteractKind;
  /** What it is ("Bến câu cá"). */
  label: string;
  /** The action, shown as "E · {prompt}". */
  prompt: string;
  /** Click target. */
  rect: Rect;
  /** Where the character stands to use it. */
  use: Vec;
  /** fish_spot, crab_hole, snail_bed: the direction of the water. */
  face?: Facing;
  /** portal: where it leads. */
  to?: { map: MapId; arrive: Spot };
  /** plot: its number (1–10). */
  plot?: number;
  /** card_table: its game (v16). */
  game?: CardGame;
  /** crab_hole: its number (1–6); snail_bed: its number (1–4). */
  spot?: number;
  /** rat (v17): the live rat's id. */
  rat?: number;
  /** lot (v19.3): its number (1–8). */
  lot?: number;
}

/** A rice plot on the field (v15): its number, its land and where its name post stands. */
export interface PlotGeom { no: number; kind: "private" | "village"; rect: Rect; post: Vec }

/** A shopkeeper: a static character with a name tag. */
export interface Npc { id: string; name: string; look: Look; spot: Spot }

/** Things that are drawn as depth-sorted sprites (anchor = base point, sort by y). */
export type PropPlacement =
  | { kind: "palm"; x: number; y: number; h: number; lean: number; seed: number }
  | { kind: "hammock"; x: number; y: number; x2: number }
  | { kind: "post"; x: number; y: number }
  | { kind: "table"; x: number; y: number }
  | { kind: "mixer"; x: number; y: number }
  | { kind: "board"; x: number; y: number }
  | { kind: "news_stand"; x: number; y: number }
  | { kind: "sign"; x: number; y: number; icon?: SignIcon }
  | { kind: "banana"; x: number; y: number }
  | { kind: "lightpole"; x: number; y: number }
  | { kind: "stall_front"; x: number; y: number }
  | { kind: "hut_front"; x: number; y: number }
  | { kind: "records"; x: number; y: number }
  | { kind: "namepost"; x: number; y: number }
  | { kind: "coop_front"; x: number; y: number }
  | { kind: "farmshop_front"; x: number; y: number }
  | { kind: "ricedepot_front"; x: number; y: number }
  | { kind: "pump"; x: number; y: number }
  | { kind: "haystack"; x: number; y: number }
  | { kind: "scarecrow"; x: number; y: number }
  | { kind: "card_table"; x: number; y: number; game: CardGame }
  // v18.4 (Chợ Lớn): a market stall with its goods, an outdoor table with stools, a street lantern post, a shop's counter
  | { kind: "market_stall"; x: number; y: number; goods: StallGoods }
  | { kind: "eat_table"; x: number; y: number }
  | { kind: "lantern_post"; x: number; y: number }
  | { kind: "shop_counter"; x: number; y: number }
  // every map: a wooden post carrying a small painted map of the town
  | { kind: "city_map_post"; x: number; y: number };

/** What a Chợ Lớn stall sells: fruit, flowers and lanterns are decoration; the fish depot and the produce depot are
 *  served (v18.5). */
export type StallGoods = "fruit" | "flower" | "lantern" | "fish" | "produce" | "umbrella";

/** A signpost's pixel icon: a fish (to the pond), a music note (to the hall), a rice panicle (to the field) or ♠♥ (the
 *  card corner's rules). */
export type SignIcon = "fish" | "note" | "rice" | "cards" | "market" | "home";

/** Where classic-mode members are shown (the hall only). */
export interface Seating {
  /** A classic-mode DJ stands behind the mixer. */
  djSpot: Spot;
  /** Other classic-mode members, behind the café tables. */
  seats: Spot[];
  /** Overflow when every seat is taken. */
  standSpots: Spot[];
}

export interface GameMap {
  id: MapId;
  width: number;
  height: number;
  cell: number;
  cols: number;
  rows: number;
  /** cols × rows, 1 = blocked. */
  blocked: Uint8Array;
  /** Where you appear when nothing else says so (entering game mode, a lost arrival). */
  spawn: Spot;
  seating: Seating | null;
  interactables: Interactable[];
  props: PropPlacement[];
  npcs: Npc[];
  /** Rice plots (the field only). */
  plots: PlotGeom[];
}
