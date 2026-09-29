import type { CardGame } from "@/lib/game/cards/deck";
import { HALL_SEATS } from "@/lib/game/maps/hall";
import type { MapId } from "@/lib/game/maps/types";
import { yawOf } from "../character/pose";
import type { Billboard } from "../types";

// Pure: the real seats of the 3D zones — one per place the game seats someone — and where a seated person's 3D chibi
// goes. The zone builders put a chair/stool/cushion under every anchor (so the furniture and the sitters always agree),
// and the engine snaps whoever sits (at a card table, on a café chair, in the hammock) to its anchor with the sit pose,
// facing the table. Map px; `top` is the seat's height (px) above the zone's ground, `ground` the floor under it.

export interface SeatAnchor {
  /** "cards_poker:3" (the table's game and its 1-based seat), "cafe:0" … (HALL_SEATS order), "hammock". */
  key: string;
  x: number;
  y: number;
  /** The seat surface's height above the zone's ground (px) and the floor's under it (a deck's top). */
  top: number;
  ground: number;
  /** The model's yaw (character/pose.ts yawOf): toward the table. */
  yaw: number;
  kind: "stool" | "chair" | "cushion" | "hammock";
}

/** The seat count of each card game (supabase _card_max). */
export const CARD_MAX: Readonly<Record<CardGame, number>> = { tienlen: 4, cao: 17, poker: 6, xidach: 8 };
/** The card deck's walkable top (hall.ts pushes this deck; the tables stand on it). */
export const CARD_DECK_TOP = 1.5;
/** The height of the sit pose's hips over the feet (units): character/pose.ts "sit" drops the hips to ≈ 0.28. */
export const SIT_HIPS = 0.28;

/** The card tables' centres and shapes (the props' spots, hall.ts HALL_PROPS: the table stands 13 px north of it). */
export const CARD_TABLES: Readonly<Record<CardGame, { x: number; y: number; rx: number; ry: number; shape: "square" | "round" | "oval" | "mat" }>> = {
  tienlen: { x: 98, y: 285, rx: 14, ry: 11, shape: "square" },
  cao: { x: 156, y: 309, rx: 25, ry: 12, shape: "mat" },
  poker: { x: 214, y: 286, rx: 22, ry: 11.5, shape: "round" },
  xidach: { x: 270, y: 285, rx: 22, ry: 11.5, shape: "oval" },
};

const SEAT_TOP: Record<SeatAnchor["kind"], number> = { stool: 8, chair: 8, cushion: 4.5, hammock: 11 };

function around(game: CardGame): SeatAnchor[] {
  const t = CARD_TABLES[game], n = CARD_MAX[game];
  const kind: SeatAnchor["kind"] = game === "cao" ? "cushion" : game === "tienlen" ? "chair" : "stool";
  const out: SeatAnchor[] = [];
  for (let i = 0; i < n; i++) {
    let x: number, y: number;
    if (game === "tienlen") {                                      // one chair on each side: south, west, north, east
      const side = [[0, 1], [-1, 0], [0, -1], [1, 0]][i];
      x = t.x + side[0] * t.rx; y = t.y + side[1] * t.ry;
    } else {                                                       // round the table, the first seat south (nearest you)
      const a = Math.PI / 2 + (i / n) * Math.PI * 2;
      x = t.x + Math.cos(a) * t.rx; y = t.y + Math.sin(a) * t.ry;
    }
    out.push({ key: `cards_${game}:${i + 1}`, x, y, top: CARD_DECK_TOP + SEAT_TOP[kind], ground: CARD_DECK_TOP, yaw: yawOf(t.x - x, t.y - y), kind });
  }
  return out;
}

/** The café chairs (classic mode's seats, behind the tables, facing south over them). */
function cafe(): SeatAnchor[] {
  return HALL_SEATS.map((s, i) => ({ key: `cafe:${i}`, x: s.x, y: s.y, top: SEAT_TOP.chair, ground: 0, yaw: 0, kind: "chair" as const }));
}

/** The hammock (palm A → the west light pole): lying along it, head west. */
export const HAMMOCK_SEAT: SeatAnchor = { key: "hammock", x: 128, y: 195, top: SEAT_TOP.hammock, ground: 0, yaw: Math.PI / 2, kind: "hammock" };

/** Every seat of a zone (zone-local px). */
export function seatAnchors(map: MapId): SeatAnchor[] {
  if (map !== "hall") return [];
  return [...(Object.keys(CARD_MAX) as CardGame[]).flatMap(around), ...cafe(), HAMMOCK_SEAT];
}

let hallIndex: Map<string, SeatAnchor> | null = null;
/** The hall's seat by key. */
export function hallSeat(key: string): SeatAnchor | null {
  hallIndex ??= new Map(seatAnchors("hall").map((s) => [s.key, s]));
  return hallIndex.get(key) ?? null;
}

/** How far above the ground under the anchor the sitter's feet go (units, CharacterLayer's lift). */
export function seatLift(s: SeatAnchor): number {
  return (s.top - s.ground) / 16 - SIT_HIPS;
}

/** Someone seated at a card table: which table, which seat (1-based), as the card lobby lists them. */
export interface CardSeatIn { game: CardGame; seat: number; id: string }

/** The seat each seated person takes (id → anchor): the card tables (from the lobby) — hall-local px. */
export function cardSeatMap(seats: readonly CardSeatIn[]): Map<string, SeatAnchor> {
  const out = new Map<string, SeatAnchor>();
  for (const s of seats) {
    const a = hallSeat(`cards_${s.game}:${s.seat}`);
    if (a) out.set(s.id, a);
  }
  return out;
}

/** How far (px) from its seat a card player still counts as at the table (walked off = drawn walking, not sitting). */
export const SEAT_REACH = 90;

/**
 * The frame's people with everyone seated put on their seat: the card players (the lobby's seats, while they are near
 * their table), whoever lies in the hammock, and the café sitters (classic mode's seat spots). Each gets the seat's
 * spot, the sit pose, its yaw (facing the table) and the lift that puts the hips on the seat. `origin`: where the hall's
 * px (0, 0) is in the frame's px (the world: the hall zone's corner). Pure.
 */
export function seatPeople(list: readonly Billboard[], o: { cards: ReadonlyMap<string, SeatAnchor>; hammock: ReadonlySet<string>; origin: { x: number; y: number } }): Billboard[] {
  const cafeSeats = seatAnchors("hall").filter((s) => s.key.startsWith("cafe:"));
  return list.map((b): Billboard => {
    const lx = b.x - o.origin.x, ly = b.y - o.origin.y;
    let a: SeatAnchor | null = null;
    const card = o.cards.get(b.id);
    if (card && Math.hypot(card.x - lx, card.y - ly) <= SEAT_REACH && b.act !== "ride" && b.act !== "swim") a = card;
    else if (o.hammock.has(b.id)) a = HAMMOCK_SEAT;
    else if (b.act === "sit") a = cafeSeats.find((s) => Math.abs(s.x - lx) < 0.5 && Math.abs(s.y - ly) < 0.5) ?? null;
    if (!a) return b;
    return { ...b, x: a.x + o.origin.x, y: a.y + o.origin.y, act: "sit", yaw: a.yaw, lift: seatLift(a), vehicle: undefined };
  });
}

