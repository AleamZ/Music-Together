// v19.2 Chung cư Phú Mỹ + nội thất: the rules of 0041_apartments.sql (authoritative; the rent of econ v2 is
// 0105_econ_sinks.sql's; tests/unit/apartment-sql.test.ts pins the literals), the interior grid shared by the decorating
// mode and the walking, the parsers and the RPCs.
import { supabase } from "@/lib/supabase";
import type { Grid } from "@/lib/game/movement";
import type { Vec } from "@/lib/game/types";
import { parseYouTubeId } from "@/lib/youtube/parse";
import { parseMotelState, type MotelState } from "./motel";

// ---------------------------------------------------------------- rules

export const APT_COUNT = 12;
/** econ v2 (0105): per APT_RENT_DAYS (was 1 500). */
export const APT_RENT = 2000;
export const APT_RENT_DAYS = 30;
export const APT_BUY = 25000;
/** Selling a bought unit back to the city pays this share of the list price. */
export const APT_SELL_SHARE = 0.7;
export const APT_MAX_AHEAD_DAYS = 60;
export const APT_GRACE_DAYS = 7;
/** A guest let in after a knock may enter for this long. */
export const APT_GUEST_HOURS = 3;
export const APT_MAX_ITEMS = 60;
export const TV_MAX_QUEUE = 30;

export type Visibility = "private" | "room" | "open";
export const VISIBILITIES: ReadonlyArray<{ id: Visibility; name: string; note: string }> = [
  { id: "private", name: "🔒 Riêng tư", note: "Chỉ người bạn cho vào (gõ cửa)" },
  { id: "room", name: "🎵 Người cùng phòng", note: "Thành viên phòng nhạc của bạn vào thẳng" },
  { id: "open", name: "🚪 Mở cửa", note: "Ai cũng vào được" },
];

// ---------------------------------------------------------------- the catalogue (mirror of furniture_catalog)

export type FurnitureKind = "bed" | "table" | "chair" | "sofa" | "lamp" | "plant" | "rug" | "shelf" | "tv" | "fridge" | "wall" | "floor"
  | "aquarium" | "cabinet" | "painting";                                     // v21 (0074)
export type FurnitureStyle = "go" | "hien_dai" | "may_tre";
export interface Furniture {
  id: string; name: string; kind: FurnitureKind; style: FurnitureStyle; w: number; h: number; price: number; cap?: number;
  /** 0118: a "Kỷ niệm Beta" piece — granted by the end-of-Beta reset only, never sold, given or traded. */
  exclusive?: boolean;
}

export const STYLE_NAMES: Record<FurnitureStyle, string> = { go: "Gỗ truyền thống", hien_dai: "Hiện đại", may_tre: "Mây tre" };

export const FURNITURE: readonly Furniture[] = [
  { id: "bed_go", name: "Giường gỗ", kind: "bed", style: "go", w: 2, h: 3, price: 1200 },
  { id: "bed_hiendai", name: "Giường hiện đại", kind: "bed", style: "hien_dai", w: 2, h: 3, price: 1800 },
  { id: "bed_maytre", name: "Giường mây", kind: "bed", style: "may_tre", w: 2, h: 3, price: 1000 },
  { id: "table_go", name: "Bàn gỗ", kind: "table", style: "go", w: 2, h: 2, price: 400 },
  { id: "table_hiendai", name: "Bàn kính", kind: "table", style: "hien_dai", w: 2, h: 1, price: 500 },
  { id: "table_maytre", name: "Bàn trà mây", kind: "table", style: "may_tre", w: 2, h: 2, price: 350 },
  { id: "chair_go", name: "Ghế gỗ", kind: "chair", style: "go", w: 1, h: 1, price: 150 },
  { id: "chair_hiendai", name: "Ghế bành", kind: "chair", style: "hien_dai", w: 1, h: 1, price: 220 },
  { id: "chair_maytre", name: "Ghế mây", kind: "chair", style: "may_tre", w: 1, h: 1, price: 120 },
  { id: "sofa_go", name: "Trường kỷ", kind: "sofa", style: "go", w: 3, h: 1, price: 800 },
  { id: "sofa_hiendai", name: "Sofa nỉ", kind: "sofa", style: "hien_dai", w: 3, h: 1, price: 950 },
  { id: "lamp_go", name: "Đèn dầu", kind: "lamp", style: "go", w: 1, h: 1, price: 150 },
  { id: "lamp_hiendai", name: "Đèn cây", kind: "lamp", style: "hien_dai", w: 1, h: 1, price: 250 },
  { id: "lamp_maytre", name: "Đèn lồng tre", kind: "lamp", style: "may_tre", w: 1, h: 1, price: 180 },
  { id: "plant_mai", name: "Chậu mai", kind: "plant", style: "go", w: 1, h: 1, price: 300 },
  { id: "plant_trau", name: "Cây trầu bà", kind: "plant", style: "hien_dai", w: 1, h: 1, price: 200 },
  { id: "plant_tre", name: "Tre cảnh", kind: "plant", style: "may_tre", w: 1, h: 1, price: 200 },
  { id: "rug_do", name: "Thảm đỏ", kind: "rug", style: "hien_dai", w: 3, h: 2, price: 250 },
  { id: "rug_xanh", name: "Thảm xanh", kind: "rug", style: "hien_dai", w: 3, h: 2, price: 250 },
  { id: "rug_chieu", name: "Chiếu cói", kind: "rug", style: "may_tre", w: 3, h: 2, price: 150 },
  { id: "shelf_go", name: "Kệ sách gỗ", kind: "shelf", style: "go", w: 2, h: 1, price: 350 },
  { id: "shelf_hiendai", name: "Kệ trắng", kind: "shelf", style: "hien_dai", w: 2, h: 1, price: 450 },
  { id: "tv", name: "Tivi", kind: "tv", style: "hien_dai", w: 2, h: 1, price: 3000 },
  { id: "fridge", name: "Tủ lạnh nhỏ", kind: "fridge", style: "hien_dai", w: 1, h: 1, price: 2500, cap: 20 },
  { id: "fridge_big", name: "Tủ lạnh lớn", kind: "fridge", style: "hien_dai", w: 2, h: 1, price: 6000, cap: 50 },
  { id: "wall_kem", name: "Sơn tường kem", kind: "wall", style: "hien_dai", w: 0, h: 0, price: 300 },
  { id: "wall_xanh", name: "Giấy dán tường xanh", kind: "wall", style: "hien_dai", w: 0, h: 0, price: 300 },
  { id: "wall_hong", name: "Giấy dán tường hồng", kind: "wall", style: "hien_dai", w: 0, h: 0, price: 300 },
  { id: "wall_go", name: "Ốp tường gỗ", kind: "wall", style: "go", w: 0, h: 0, price: 400 },
  { id: "floor_gach", name: "Sàn gạch bông", kind: "floor", style: "go", w: 0, h: 0, price: 300 },
  { id: "floor_go", name: "Sàn gỗ", kind: "floor", style: "go", w: 0, h: 0, price: 400 },
  { id: "floor_da", name: "Sàn đá hoa", kind: "floor", style: "hien_dai", w: 0, h: 0, price: 400 },
  // v21 (0074_pets_aquarium.sql): more furniture and the aquariums (cap: fish slots)
  { id: "bed_tang", name: "Giường tầng", kind: "bed", style: "go", w: 2, h: 3, price: 1600 },
  { id: "bed_doi", name: "Giường đôi hoa", kind: "bed", style: "hien_dai", w: 3, h: 3, price: 2600 },
  { id: "cabinet_go", name: "Tủ áo gỗ", kind: "cabinet", style: "go", w: 2, h: 1, price: 900 },
  { id: "cabinet_hiendai", name: "Tủ kính", kind: "cabinet", style: "hien_dai", w: 2, h: 1, price: 1100 },
  { id: "cabinet_maytre", name: "Tủ mây", kind: "cabinet", style: "may_tre", w: 1, h: 1, price: 500 },
  { id: "painting_sen", name: "Tranh hoa sen", kind: "painting", style: "go", w: 2, h: 1, price: 600 },
  { id: "painting_pho", name: "Tranh phố cổ", kind: "painting", style: "hien_dai", w: 2, h: 1, price: 800 },
  { id: "painting_bien", name: "Tranh biển", kind: "painting", style: "may_tre", w: 1, h: 1, price: 400 },
  { id: "plant_lan", name: "Chậu lan", kind: "plant", style: "hien_dai", w: 1, h: 1, price: 450 },
  { id: "plant_xuongrong", name: "Xương rồng", kind: "plant", style: "may_tre", w: 1, h: 1, price: 150 },
  { id: "plant_cau", name: "Cây cau cảnh", kind: "plant", style: "go", w: 1, h: 1, price: 350 },
  { id: "lamp_ban", name: "Đèn bàn", kind: "lamp", style: "hien_dai", w: 1, h: 1, price: 200 },
  { id: "lamp_hoian", name: "Đèn lồng Hội An", kind: "lamp", style: "go", w: 1, h: 1, price: 300 },
  { id: "rug_tron", name: "Thảm tròn", kind: "rug", style: "hien_dai", w: 2, h: 2, price: 300 },
  { id: "rug_batu", name: "Thảm Ba Tư", kind: "rug", style: "go", w: 4, h: 3, price: 900 },
  { id: "aquarium", name: "Bể cá nhỏ", kind: "aquarium", style: "hien_dai", w: 2, h: 1, price: 3000, cap: 4 },
  { id: "aquarium_big", name: "Bể cá lớn", kind: "aquarium", style: "hien_dai", w: 3, h: 1, price: 7000, cap: 8 },
  // 0118: the end-of-Beta mascot (exclusive)
  { id: "beta_mascot", name: "Linh vật Kỷ niệm Beta", kind: "plant", style: "hien_dai", w: 1, h: 1, price: 1, exclusive: true },
];

const BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));
export const furnitureOf = (id: string): Furniture | null => BY_ID.get(id) ?? null;
export const fridgeCapOf = (id: string): number => (furnitureOf(id)?.kind === "fridge" ? furnitureOf(id)?.cap ?? 0 : 0);
export const isSurface = (f: Furniture | null): boolean => f?.kind === "wall" || f?.kind === "floor";

// ---------------------------------------------------------------- the interior grid

export const APT_COLS = 14;
export const APT_ROWS = 10;
export const APT_TILE = 16;
/** The top rows are the wall. */
export const APT_WALL_ROWS = 2;
/** The door (bottom row) and the cells above it stay clear. */
export const APT_DOOR: readonly Vec[] = [{ x: 6, y: 9 }, { x: 7, y: 9 }];
export const APT_CLEAR: readonly Vec[] = [{ x: 6, y: 8 }, { x: 7, y: 8 }, ...APT_DOOR];
/** Where a visitor appears (feet, world px): on the door mat. */
export const APT_ENTRY: Vec = { x: 7 * APT_TILE, y: 9 * APT_TILE + 8 };
/** Standing within this many px of a bed, TV or fridge offers it. */
export const USE_REACH = 12;

export interface Placed { id: number; item: string; x: number; y: number; rot: number }

/** An item's footprint in tiles at a rotation (odd turns swap w and h); null for surfaces and unknown items. */
export function footprint(item: string, rot: number): { w: number; h: number } | null {
  const f = furnitureOf(item);
  if (!f || isSurface(f)) return null;
  return rot % 2 === 0 ? { w: f.w, h: f.h } : { w: f.h, h: f.w };
}

export type PlaceRefusal = "not placeable" | "bounds" | "door" | "overlap" | "too many";

const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** May `p` go there (p.id: the row being moved, or one not placed yet)? Mirrors furniture_place's checks. */
export function canPlace(placed: readonly Placed[], p: Placed): PlaceRefusal | null {
  const fp = footprint(p.item, p.rot);
  if (!fp) return "not placeable";
  if (!Number.isInteger(p.rot) || p.rot < 0 || p.rot > 3) return "bounds";
  const r = { x: p.x, y: p.y, w: fp.w, h: fp.h };
  if (r.x < 0 || r.y < APT_WALL_ROWS || r.x + r.w > APT_COLS || r.y + r.h > APT_ROWS) return "bounds";
  if (APT_CLEAR.some((c) => hit(r, { x: c.x, y: c.y, w: 1, h: 1 }))) return "door";
  const others = placed.filter((o) => o.id !== p.id);
  if (!placed.some((o) => o.id === p.id) && others.length >= APT_MAX_ITEMS) return "too many";
  const rug = furnitureOf(p.item)?.kind === "rug";
  for (const o of others) {
    const ofp = footprint(o.item, o.rot);
    if (!ofp || (furnitureOf(o.item)?.kind === "rug") !== rug) continue;
    if (hit(r, { x: o.x, y: o.y, w: ofp.w, h: ofp.h })) return "overlap";
  }
  return null;
}

/** An item's rect in world px. */
export function itemRect(p: Placed): { x: number; y: number; w: number; h: number } | null {
  const fp = footprint(p.item, p.rot);
  return fp ? { x: p.x * APT_TILE, y: p.y * APT_TILE, w: fp.w * APT_TILE, h: fp.h * APT_TILE } : null;
}

const CELL = 8;
/** The collision grid of an interior: the wall and every piece of furniture but rugs are solid. */
export function interiorGrid(placed: readonly Placed[]): Grid {
  const cols = (APT_COLS * APT_TILE) / CELL, rows = (APT_ROWS * APT_TILE) / CELL;
  const blocked = new Uint8Array(cols * rows);
  const k = APT_TILE / CELL;
  for (let r = 0; r < APT_WALL_ROWS * k; r++) for (let c = 0; c < cols; c++) blocked[r * cols + c] = 1;
  for (const p of placed) {
    const fp = footprint(p.item, p.rot);
    if (!fp || furnitureOf(p.item)?.kind === "rug") continue;
    for (let r = p.y * k; r < (p.y + fp.h) * k; r++) for (let c = p.x * k; c < (p.x + fp.w) * k; c++) {
      if (r >= 0 && r < rows && c >= 0 && c < cols) blocked[r * cols + c] = 1;
    }
  }
  return { width: APT_COLS * APT_TILE, height: APT_ROWS * APT_TILE, cell: CELL, cols, rows, blocked };
}

/** The bed, TV or fridge nearest to `pos` within USE_REACH px (null: none). */
export function nearestUsable(placed: readonly Placed[], pos: Vec): Placed | null {
  let best: Placed | null = null, bestD = Infinity;
  for (const p of placed) {
    const k = furnitureOf(p.item)?.kind;
    if (k !== "bed" && k !== "tv" && k !== "fridge") continue;
    const r = itemRect(p)!;
    const dx = Math.max(r.x - pos.x, 0, pos.x - (r.x + r.w)), dy = Math.max(r.y - pos.y, 0, pos.y - (r.y + r.h));
    const d = Math.hypot(dx, dy);
    if (d <= USE_REACH && d < bestD) { best = p; bestD = d; }
  }
  return best;
}

export const onDoorMat = (pos: Vec): boolean => pos.y >= 8.5 * APT_TILE && pos.x >= 5.5 * APT_TILE && pos.x <= 8.5 * APT_TILE;

// ---------------------------------------------------------------- parsing

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const vis = (v: unknown): Visibility => (v === "room" || v === "open" ? v : "private");

export type UnitStatus = "free" | "rent" | "own";
export interface AptUnit { no: number; status: UnitStatus; ownerName: string | null; visibility: Visibility; mine: boolean }
export interface MyHome { no: number; tenure: "rent" | "own"; paidUntilMs: number | null; graceUntilMs: number | null; visibility: Visibility; wall: string | null; floor: string | null }
export interface Knock { accountId: string; name: string; atMs: number }
export interface AptList {
  units: AptUnit[]; mine: MyHome | null; storage: Array<{ id: number; item: string }>; knocks: Knock[]; serverNowMs: number; coins?: number;
}

export function parseAptList(data: unknown): AptList | null {
  const r = obj(data);
  const now = r ? num(r.server_now_ms) : null;
  if (!r || now === null) return null;
  const units: AptUnit[] = [];
  for (const u of arr(r.units)) {
    const o = obj(u);
    const no = o ? num(o.no) : null;
    if (!o || no === null || no < 1 || no > APT_COUNT) continue;
    const status: UnitStatus = o.status === "rent" || o.status === "own" ? o.status : "free";
    units.push({ no, status, ownerName: str(o.owner_name), visibility: vis(o.visibility), mine: o.mine === true });
  }
  const m = obj(r.mine);
  const mno = m ? num(m.no) : null;
  const mine: MyHome | null = m && mno !== null && (m.tenure === "rent" || m.tenure === "own")
    ? { no: mno, tenure: m.tenure, paidUntilMs: num(m.paid_until_ms), graceUntilMs: num(m.grace_until_ms), visibility: vis(m.visibility), wall: str(m.wall), floor: str(m.floor) }
    : null;
  const storage = arr(r.storage).flatMap((s) => {
    const o = obj(s);
    return o && typeof o.id === "number" && typeof o.item === "string" ? [{ id: o.id, item: o.item }] : [];
  });
  const knocks = arr(r.knocks).flatMap((k) => {
    const o = obj(k);
    const at = o ? num(o.at_ms) : null;
    return o && typeof o.account_id === "string" && at !== null ? [{ accountId: o.account_id, name: str(o.name) ?? "Ai đó", atMs: at }] : [];
  });
  const out: AptList = { units, mine, storage, knocks, serverNowMs: now };
  const coins = num(r.coins);
  if (coins !== null) out.coins = coins;
  return out;
}

export interface Layout { no: number; ownerId: string; ownerName: string; canEdit: boolean; visibility: Visibility; wall: string | null; floor: string | null; items: Placed[] }

export function parsePlaced(v: unknown): Placed | null {
  const o = obj(v);
  if (!o) return null;
  const id = num(o.id), x = num(o.x), y = num(o.y), rot = num(o.rot);
  return id !== null && typeof o.item === "string" && x !== null && y !== null && rot !== null ? { id, item: o.item, x, y, rot } : null;
}

export function parseLayout(data: unknown): Layout | null {
  const r = obj(data);
  const no = r ? num(r.no) : null;
  if (!r || no === null || typeof r.owner_id !== "string") return null;
  return {
    no, ownerId: r.owner_id, ownerName: str(r.owner_name) ?? "", canEdit: r.can_edit === true, visibility: vis(r.visibility),
    wall: str(r.wall), floor: str(r.floor), items: arr(r.items).map(parsePlaced).filter((p): p is Placed => p !== null),
  };
}

export interface FridgeFish { id: string; speciesId: string; weightG: number; price: number }
export interface Fridge { cap: number; bag: number; bagCap: number; fish: FridgeFish[] }

export function parseFridge(data: unknown): Fridge | null {
  const r = obj(data);
  if (!r) return null;
  const cap = num(r.cap), bag = num(r.bag), bagCap = num(r.bag_cap);
  if (cap === null || bag === null || bagCap === null) return null;
  const fish = arr(r.fish).flatMap((f) => {
    const o = obj(f);
    const w = o ? num(o.weight_g) : null, p = o ? num(o.price) : null;
    return o && typeof o.id === "string" && typeof o.species_id === "string" && w !== null && p !== null
      ? [{ id: o.id, speciesId: o.species_id, weightG: w, price: p }] : [];
  });
  return { cap, bag, bagCap, fish };
}

export interface TvItem { id: string; videoId: string; title: string; by: string; durationS: number | null }
export interface TvState { current: TvItem | null; queue: TvItem[]; startedAtMs: number | null; serverNowMs: number }

function tvItem(v: unknown): TvItem | null {
  const o = obj(v);
  if (!o || typeof o.id !== "string" || typeof o.v !== "string") return null;
  return { id: o.id, videoId: o.v, title: str(o.t) ?? o.v, by: str(o.by) ?? "", durationS: num(o.d) };
}

export function parseTv(data: unknown): TvState | null {
  const r = obj(data);
  const now = r ? num(r.server_now_ms) : null;
  if (!r || now === null) return null;
  return { current: tvItem(r.current), queue: arr(r.queue).map(tvItem).filter((i): i is TvItem => i !== null), startedAtMs: num(r.started_at_ms), serverNowMs: now };
}

/** Where the TV is (whole seconds) at client time `nowMs` (`offsetMs` = server − client). */
export function tvPosition(tv: TvState, nowMs: number, offsetMs: number): number {
  if (!tv.current || tv.startedAtMs === null) return 0;
  return Math.max(0, Math.floor((nowMs + offsetMs - tv.startedAtMs) / 1000));
}

/** A YouTube link or a bare 11-character id → the id. */
export function youTubeIdOf(input: string): string | null {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  return parseYouTubeId(s);
}

export function aptErrorMessage(msg: string): string {
  if (msg.includes("insufficient funds")) return "Không đủ xu.";
  if (msg.includes("too far ahead")) return `Chỉ trả trước tối đa ${APT_MAX_AHEAD_DAYS} ngày.`;
  if (msg.includes("already have a home")) return "Bạn đã có nhà rồi (căn hộ, lô đất hoặc phòng thuê).";
  if (msg.includes("taken")) return "Căn này đã có người ở.";
  if (msg.includes("no home")) return "Bạn chưa có căn hộ.";
  if (msg.includes("rent due")) return "Tiền thuê đã hết hạn — gia hạn ở sảnh chung cư nhé.";
  if (msg.includes("no access")) return "Cửa đang khoá — gõ cửa để chủ nhà mở cho bạn.";
  if (msg.includes("vacant")) return "Căn này đang trống.";
  if (msg.includes("overlap")) return "Chỗ đó bị chồng lên đồ khác.";
  if (msg.includes("door")) return "Đừng chắn cửa ra vào nhé.";
  if (msg.includes("bounds")) return "Đồ phải nằm trong phòng, không đè lên tường.";
  if (msg.includes("too many")) return "Phòng đầy đồ rồi.";
  if (msg.includes("not placeable")) return "Món này không đặt được.";
  if (msg.includes("fridge full")) return "Tủ lạnh đầy rồi.";
  if (msg.includes("bag full")) return "Giỏ đầy rồi.";
  if (msg.includes("no fridge")) return "Chưa có tủ lạnh trong nhà.";
  if (msg.includes("no bed")) return "Chưa có giường để ngủ.";
  if (msg.includes("no tv")) return "Chưa có tivi.";
  if (msg.includes("already slept")) return "Hôm nay bạn ngủ rồi — mai ngủ tiếp nhé!";
  if (msg.includes("fainted")) return "Bạn đang ngất, chờ hồi sinh…";
  if (msg.includes("queue full")) return "Hàng chờ tivi đầy rồi.";
  if (msg.includes("bad video")) return "Link YouTube không hợp lệ.";
  if (msg.includes("not yours")) return "Bạn không làm vậy được.";
  if (msg.includes("not owned")) return "Bạn chưa có món này.";
  return "Có lỗi, thử lại sau nhé.";
}

export const errText = (e: unknown): string =>
  aptErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

// ---------------------------------------------------------------- RPCs

async function rpc<T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T | null): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const out = parse(data);
  if (out === null) throw new Error("bad answer");
  return out;
}

const T = (token: string) => ({ p_session_token: token });
export const aptList = (token: string) => rpc("apt_list", T(token), parseAptList);
export const aptRent = (token: string, no: number) => rpc("apt_rent", { ...T(token), p_no: no }, parseAptList);
export const aptBuy = (token: string, no: number) => rpc("apt_buy", { ...T(token), p_no: no }, parseAptList);
export const aptMoveOut = (token: string) => rpc("apt_move_out", T(token), parseAptList);
export const aptSetVisibility = (token: string, v: Visibility) => rpc("apt_set_visibility", { ...T(token), p_visibility: v }, parseAptList);
export const aptAdmit = (token: string, account: string, accept: boolean) => rpc("apt_admit", { ...T(token), p_account: account, p_accept: accept }, parseAptList);
export const aptKnock = (token: string, roomId: string, no: number) => rpc("apt_knock", { ...T(token), p_room_id: roomId, p_no: no }, (d) => (d === true ? true : null));
export const aptEnter = (token: string, roomId: string, no: number) => rpc("apt_enter", { ...T(token), p_room_id: roomId, p_no: no }, parseLayout);
export const furnitureBuy = (token: string, item: string) => rpc("furniture_buy", { ...T(token), p_item: item }, parseAptList);
export const furniturePlace = (token: string, id: number, x: number, y: number, rot: number) =>
  rpc("furniture_place", { ...T(token), p_id: id, p_x: x, p_y: y, p_rot: rot }, parseLayout);
export const furniturePickup = (token: string, id: number) => rpc("furniture_pickup", { ...T(token), p_id: id }, parseLayout);
export const aptSetSurface = (token: string, item: string | null, kind: "wall" | "floor") =>
  rpc("apt_set_surface", { ...T(token), p_kind: kind, p_item: item }, parseLayout);
export const fridgeState = (token: string) => rpc("fridge_state", T(token), parseFridge);
export const fishToFridge = (token: string, fishId: string) => rpc("fish_move_to_fridge", { ...T(token), p_fish_id: fishId }, parseFridge);
export const fishToBag = (token: string, fishId: string) => rpc("fish_move_to_bag", { ...T(token), p_fish_id: fishId }, parseFridge);
export const homeSleep = (token: string, no: number): Promise<MotelState> =>
  rpc("home_sleep", { ...T(token), p_kind: "apt", p_id: no }, parseMotelState);
export const tvState = (token: string, roomId: string, no: number) => rpc("tv_state", { ...T(token), p_room_id: roomId, p_no: no }, parseTv);
export const tvAdd = (token: string, roomId: string, no: number, videoId: string, title: string, durationS: number | null) =>
  rpc("tv_add", { ...T(token), p_room_id: roomId, p_no: no, p_video: videoId, p_title: title, p_duration: durationS }, parseTv);
export const tvNext = (token: string, roomId: string, no: number, expectId: string) =>
  rpc("tv_next", { ...T(token), p_room_id: roomId, p_no: no, p_expect: expectId }, parseTv);
export const tvSkip = (token: string, roomId: string, no: number) => rpc("tv_skip", { ...T(token), p_room_id: roomId, p_no: no }, parseTv);
