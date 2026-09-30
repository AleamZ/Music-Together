// v19.3 Đất + xây nhà + cho thuê phòng: the rules of 0042_houses.sql (authoritative; the prices of econ v2 are
// 0105_econ_sinks.sql's; tests/unit/house-sql.test.ts pins the literals), the house designs (the same checks as
// _house_check), the furniture placement on a lot (as house_place), the walking grid of a house, the parsers and the
// RPCs. Plan: docs/superpowers/plans/2026-09-27-v19-3-land.md.
import { supabase } from "@/lib/supabase";
import type { Grid } from "@/lib/game/movement";
import type { Vec } from "@/lib/game/types";
import { footprint, furnitureOf, type Placed, type PlaceRefusal, type Visibility } from "./apartment";
import { CELL_COUNT, LOT_COLS, LOT_COUNT, LOT_ROWS, LOT_TILE, ROOFS, type Roof } from "./lot";
import { parseMotelState, type MotelState } from "./motel";

export { CELL_COUNT, LOT_COLS, LOT_COUNT, LOT_ROWS, LOT_TILE, ROOFS, type Roof };

// ---------------------------------------------------------------- rules

export const LAND_PRICE = 40000;
/** The city pays back this share of the land price when the lot is given back (lot_sell). */
export const LAND_REFUND_SHARE = 0.5;
/** econ v2 (0105): a repossession (the upkeep unpaid REPOSSESS_DAYS) pays back only this share (10 000; was 50 %). */
export const REPOSSESS_REFUND_SHARE = 0.25;
/** econ v2 (0105): per UPKEEP_DAYS (was 500). */
export const UPKEEP = 1500;
export const UPKEEP_DAYS = 30;
export const UPKEEP_MAX_AHEAD_DAYS = 60;
/** Upkeep unpaid this long after it ran out: the city takes the lot back. */
export const REPOSSESS_DAYS = 60;
export const HOUSE_MAX_ROOMS = 6;
export const ROOM_MIN_CELLS = 4;
export const HOUSE_MAX_ITEMS = 80;
export const ROOM_RENT_MIN = 300;
export const ROOM_RENT_MAX = 5000;
export const ROOM_RENT_DAYS = 30;
export const ROOM_MAX_AHEAD_DAYS = 60;
/** The owner's share of a room's rent (the rest is the fee, burned). */
export const RENT_OWNER_PERCENT = 95;

export type Cell = "." | "f" | "w" | "d" | "n";
export const CELLS: ReadonlyArray<{ id: Cell; name: string; icon: string }> = [
  { id: "f", name: "Sàn", icon: "▫️" },
  { id: "w", name: "Tường", icon: "🧱" },
  { id: "d", name: "Cửa", icon: "🚪" },
  { id: "n", name: "Cửa sổ", icon: "🪟" },
  { id: ".", name: "Xoá (sân)", icon: "🌱" },
];
export const TILE_PRICES: Record<Cell, number> = { ".": 0, f: 10, w: 20, d: 150, n: 100 };

const ROOF_IDS = new Set<string>(ROOFS.map((r) => r.id));

export const EMPTY_DESIGN = ".".repeat(CELL_COUNT);

/** A design from its rows (short rows and missing rows are yard; long rows are cut). */
export function designOf(rows: readonly string[]): string {
  let s = "";
  for (let r = 0; r < LOT_ROWS; r++) s += (rows[r] ?? "").slice(0, LOT_COLS).padEnd(LOT_COLS, ".");
  return s;
}

export const isEmptyDesign = (g: string): boolean => /^\.*$/.test(g);

/** Ready designs to start the builder from (each passes checkDesign). */
export const HOUSE_TEMPLATES: ReadonlyArray<{ id: string; name: string; design: string }> = [
  { id: "nho", name: "Nhà nhỏ 1 phòng", design: designOf(["", "", "......wwwwwww", "......wfffffw", "......nfffffn", "......wfffffw", "......wwwdwww"]) },
  {
    id: "hai", name: "Nhà 2 phòng", design: designOf([
      "", "..wwwwwwwwwwwww", "..wffffwffffffw", "..nffffdffffffn", "..wffffwffffffw", "..wffffwffffffw", "..wwwwwwwwdwwww",
    ]),
  },
  {
    id: "tro", name: "Nhà trọ 4 phòng + hành lang", design: designOf([
      "", "..wwwwwwwwwwwwwww", "..wffffwfffwffffw", "..nffffwfffwffffn", "..wffffdfffdffffw", "..wffffwfffwffffw", "..wwwwwwfffwwwwww",
      "..wffffwfffwffffw", "..nffffdfffdffffn", "..wffffwfffwffffw", "..wffffwfffwffffw", "..wwwwwwwdwwwwwww",
    ]),
  },
];

/** The xu a save costs: every cell that changes to a built type pays that type's price (clearing is free). */
export function buildCost(old: string | null, next: string): number {
  const o = old ?? EMPTY_DESIGN;
  let sum = 0;
  for (let i = 0; i < next.length; i++) {
    const c = next.charAt(i) as Cell;
    if (c !== o.charAt(i) && c !== ".") sum += TILE_PRICES[c] ?? 0;
  }
  return sum;
}

export const rentShare = (price: number): { owner: number; fee: number } => {
  const owner = Math.floor((price * RENT_OWNER_PERCENT) / 100);
  return { owner, fee: price - owner };
};

// ---------------------------------------------------------------- the design checks (as _house_check)

/** The cell at (row, col); "" outside the lot. */
const at = (g: string, r: number, c: number): string => (r < 0 || r >= LOT_ROWS || c < 0 || c >= LOT_COLS ? "" : g.charAt(r * LOT_COLS + c));
const isOpen = (ch: string) => ch === "f" || ch === ".";
const isSolid = (ch: string) => ch === "" || ch === "w" || ch === "n" || ch === "d";
const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]] as const;

/** The rooms: each floor cell's room number (1…, by the first cell, row-major; 0 for the rest) and how many. */
export function roomsOf(g: string): { cells: number[]; count: number } {
  const cells = new Array<number>(CELL_COUNT).fill(0);
  let count = 0;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (g.charAt(i) !== "f" || cells[i] !== 0) continue;
    count++;
    cells[i] = count;
    const stack = [i];
    while (stack.length) {
      const j = stack.pop()!;
      const r = Math.floor(j / LOT_COLS), c = j % LOT_COLS;
      for (const [dr, dc] of N4) {
        const rr = r + dr, cc = c + dc;
        if (at(g, rr, cc) !== "f") continue;
        const k = rr * LOT_COLS + cc;
        if (cells[k] === 0) { cells[k] = count; stack.push(k); }
      }
    }
  }
  return { cells, count };
}

/** A door's open axis ("v" or "h") and whether it is a front door (yard on one side); null when it is not a valid door. */
function doorAxis(g: string, r: number, c: number): { axis: "v" | "h"; front: boolean } | null {
  const up = at(g, r - 1, c), down = at(g, r + 1, c), left = at(g, r, c - 1), right = at(g, r, c + 1);
  const ok = (a: string, b: string, s1: string, s2: string) => isOpen(a) && isOpen(b) && (a === "f" || b === "f") && isSolid(s1) && isSolid(s2);
  if (ok(up, down, left, right)) return { axis: "v", front: up === "." || down === "." };
  if (ok(left, right, up, down)) return { axis: "h", front: left === "." || right === "." };
  return null;
}

export type DesignRefusal =
  | "bad grid" | "open floor" | "bad door" | "bad window" | "no room" | "too many rooms" | "small room" | "no front door" | "unreachable";

/** Is the design a house the server will take? null: yes (or it is bare land). */
export function checkDesign(g: string): DesignRefusal | null {
  if (g.length !== CELL_COUNT || !/^[.fwdn]*$/.test(g)) return "bad grid";
  if (isEmptyDesign(g)) return null;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (g.charAt(i) !== "f") continue;
    const r = Math.floor(i / LOT_COLS), c = i % LOT_COLS;
    if (N4.some(([dr, dc]) => { const n = at(g, r + dr, c + dc); return n === "" || n === "."; })) return "open floor";
  }
  for (let i = 0; i < CELL_COUNT; i++) {
    if (g.charAt(i) === "d" && !doorAxis(g, Math.floor(i / LOT_COLS), i % LOT_COLS)) return "bad door";
  }
  for (let i = 0; i < CELL_COUNT; i++) {
    if (g.charAt(i) !== "n") continue;
    const r = Math.floor(i / LOT_COLS), c = i % LOT_COLS;
    if (!N4.some(([dr, dc]) => { const n = at(g, r + dr, c + dc); return n === "" || n === "."; })) return "bad window";
  }
  const { cells, count } = roomsOf(g);
  if (count === 0) return "no room";
  if (count > HOUSE_MAX_ROOMS) return "too many rooms";
  const size = new Array<number>(count + 1).fill(0);
  for (const k of cells) if (k) size[k]++;
  if (size.some((s, k) => k > 0 && s < ROOM_MIN_CELLS)) return "small room";
  // the rooms reached from the front doors, through the inner doors
  const reached = new Array<boolean>(count + 1).fill(false);
  const links: Array<[number, number]> = [];
  let front = false;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (g.charAt(i) !== "d") continue;
    const r = Math.floor(i / LOT_COLS), c = i % LOT_COLS;
    const d = doorAxis(g, r, c)!;
    const [a, b] = d.axis === "v" ? [[r - 1, c], [r + 1, c]] : [[r, c - 1], [r, c + 1]];
    const ra = at(g, a[0], a[1]) === "f" ? cells[a[0] * LOT_COLS + a[1]] : 0;
    const rb = at(g, b[0], b[1]) === "f" ? cells[b[0] * LOT_COLS + b[1]] : 0;
    if (d.front) { front = true; reached[ra || rb] = true; } else links.push([ra, rb]);
  }
  if (!front) return "no front door";
  for (let pass = 0; pass < count; pass++) for (const [a, b] of links) if (reached[a] !== reached[b]) { reached[a] = true; reached[b] = true; }
  for (let k = 1; k <= count; k++) if (!reached[k]) return "unreachable";
  return null;
}

/** The front doors' cells (row-major). */
export function frontDoors(g: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.length; i++) {
    if (g.charAt(i) !== "d") continue;
    const d = doorAxis(g, Math.floor(i / LOT_COLS), i % LOT_COLS);
    if (d?.front) out.push(i);
  }
  return out;
}

/** Where one appears inside (feet, world px): on the yard cell outside the first front door (else the lot's gate). */
export function entryOf(g: string | null): Vec {
  const fd = g ? frontDoors(g)[0] : undefined;
  if (g && fd !== undefined) {
    const r = Math.floor(fd / LOT_COLS), c = fd % LOT_COLS;
    for (const [dr, dc] of N4) {
      if (at(g, r + dr, c + dc) === ".") return { x: (c + dc) * LOT_TILE + 8, y: (r + dr) * LOT_TILE + 12 };
    }
  }
  return { x: (LOT_COLS / 2) * LOT_TILE, y: LOT_ROWS * LOT_TILE - 4 };
}

/** The floor cells just inside a door: they stay clear of furniture. */
export function doorFronts(g: string): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < g.length; i++) {
    if (g.charAt(i) !== "d") continue;
    const r = Math.floor(i / LOT_COLS), c = i % LOT_COLS;
    for (const [dr, dc] of N4) if (at(g, r + dr, c + dc) === "f") out.add((r + dr) * LOT_COLS + c + dc);
  }
  return out;
}

// ---------------------------------------------------------------- furniture on a lot (as house_place)

export interface HousePlaced extends Placed { mine: boolean }
export type HousePlaceRefusal = PlaceRefusal | "not floor" | "two rooms" | "not your room";

/** The room an item would stand in, or why it cannot stand there (no overlap check). */
export function roomAt(g: string, rooms: readonly number[], item: string, x: number, y: number, rot: number): number | HousePlaceRefusal {
  const fp = footprint(item, rot);
  if (!fp) return "not placeable";
  if (!Number.isInteger(rot) || rot < 0 || rot > 3) return "bounds";
  if (x < 0 || y < 0 || x + fp.w > LOT_COLS || y + fp.h > LOT_ROWS) return "bounds";
  const fronts = doorFronts(g);
  let room = 0;
  for (let yy = y; yy < y + fp.h; yy++) for (let xx = x; xx < x + fp.w; xx++) {
    const i = yy * LOT_COLS + xx;
    if (g.charAt(i) !== "f") return "not floor";
    if (room === 0) room = rooms[i];
    else if (rooms[i] !== room) return "two rooms";
    if (fronts.has(i)) return "door";
  }
  return room;
}

/** May `p` go there? `allowed`: the rooms I may furnish (null: any). Mirrors house_place's checks. */
export function canPlaceHouse(g: string, placed: readonly Placed[], p: Placed, allowed: readonly number[] | null): HousePlaceRefusal | null {
  const { cells } = roomsOf(g);
  const room = roomAt(g, cells, p.item, p.x, p.y, p.rot);
  if (typeof room === "string") return room;
  if (allowed && !allowed.includes(room)) return "not your room";
  const others = placed.filter((o) => o.id !== p.id);
  if (!placed.some((o) => o.id === p.id) && others.length >= HOUSE_MAX_ITEMS) return "too many";
  const fp = footprint(p.item, p.rot)!;
  const rug = furnitureOf(p.item)?.kind === "rug";
  for (const o of others) {
    const ofp = footprint(o.item, o.rot);
    if (!ofp || (furnitureOf(o.item)?.kind === "rug") !== rug) continue;
    if (o.x < p.x + fp.w && p.x < o.x + ofp.w && o.y < p.y + fp.h && p.y < o.y + ofp.h) return "overlap";
  }
  return null;
}

const CELL = 8;
/** The collision grid of a house: walls, windows and furniture (not rugs) are solid; yard, floors and doors are not. */
export function houseGrid(g: string | null, placed: readonly Placed[]): Grid {
  const k = LOT_TILE / CELL;
  const cols = LOT_COLS * k, rows = LOT_ROWS * k;
  const blocked = new Uint8Array(cols * rows);
  const fill = (x: number, y: number, w: number, h: number) => {
    for (let r = y * k; r < (y + h) * k; r++) for (let c = x * k; c < (x + w) * k; c++) if (r >= 0 && r < rows && c >= 0 && c < cols) blocked[r * cols + c] = 1;
  };
  if (g) for (let i = 0; i < CELL_COUNT; i++) {
    const ch = g.charAt(i);
    if (ch === "w" || ch === "n") fill(i % LOT_COLS, Math.floor(i / LOT_COLS), 1, 1);
  }
  for (const p of placed) {
    const fp = footprint(p.item, p.rot);
    if (fp && furnitureOf(p.item)?.kind !== "rug") fill(p.x, p.y, fp.w, fp.h);
  }
  return { width: LOT_COLS * LOT_TILE, height: LOT_ROWS * LOT_TILE, cell: CELL, cols, rows, blocked };
}

/** Standing on the yard (outside the house): the way out is near. */
export function onYard(g: string | null, pos: Vec): boolean {
  if (!g) return true;
  const c = Math.floor(pos.x / LOT_TILE), r = Math.floor(pos.y / LOT_TILE);
  return at(g, r, c) === ".";
}

// ---------------------------------------------------------------- parsing

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const vis = (v: unknown): Visibility => (v === "room" || v === "open" ? v : "private");
const roof = (v: unknown): Roof => (typeof v === "string" && ROOF_IDS.has(v) ? (v as Roof) : "ngoi");
const grid = (v: unknown): string | null => (typeof v === "string" && v.length === CELL_COUNT && /^[.fwdn]*$/.test(v) ? v : null);

export interface StreetRoom { no: number; cells: number; price: number | null; taken: boolean; mine: boolean }
export interface StreetLot { no: number; owned: boolean; ownerName: string | null; mine: boolean; grid: string | null; roof: Roof; visibility: Visibility; rooms: StreetRoom[] }
export interface MyRoom { no: number; cells: number; price: number | null; tenantName: string | null; untilMs: number | null }
export interface MyLot {
  no: number; paidUntilMs: number | null; repossessMs: number | null; buildCost: number; visibility: Visibility;
  wall: string | null; floor: string | null; rooms: MyRoom[];
}
export interface MyTenancy { lot: number; room: number; paidUntilMs: number; price: number; ownerName: string | null; listed: boolean }
export interface HouseList { lots: StreetLot[]; mine: MyLot | null; tenancy: MyTenancy | null; serverNowMs: number; coins?: number }

export function parseHouseList(data: unknown): HouseList | null {
  const r = obj(data);
  const now = r ? num(r.server_now_ms) : null;
  if (!r || now === null) return null;
  const lots: StreetLot[] = arr(r.lots).flatMap((l) => {
    const o = obj(l);
    const no = o ? num(o.no) : null;
    if (!o || no === null || no < 1 || no > LOT_COUNT) return [];
    const rooms = arr(o.rooms).flatMap((x) => {
      const q = obj(x);
      const rn = q ? num(q.no) : null;
      return q && rn !== null ? [{ no: rn, cells: num(q.cells) ?? 0, price: num(q.price), taken: q.taken === true, mine: q.mine === true }] : [];
    });
    return [{ no, owned: o.owned === true, ownerName: str(o.owner_name), mine: o.mine === true, grid: grid(o.grid), roof: roof(o.roof), visibility: vis(o.visibility), rooms }];
  });
  const m = obj(r.mine);
  const mno = m ? num(m.no) : null;
  const mine: MyLot | null = m && mno !== null ? {
    no: mno, paidUntilMs: num(m.paid_until_ms), repossessMs: num(m.repossess_ms), buildCost: num(m.build_cost) ?? 0, visibility: vis(m.visibility),
    wall: str(m.wall), floor: str(m.floor),
    rooms: arr(m.rooms).flatMap((x) => {
      const q = obj(x);
      const rn = q ? num(q.no) : null;
      return q && rn !== null ? [{ no: rn, cells: num(q.cells) ?? 0, price: num(q.price), tenantName: str(q.tenant_name), untilMs: num(q.until_ms) }] : [];
    }),
  } : null;
  const t = obj(r.tenancy);
  const tl = t ? num(t.lot) : null, tr = t ? num(t.room) : null, tu = t ? num(t.paid_until_ms) : null;
  const tenancy: MyTenancy | null = t && tl !== null && tr !== null && tu !== null
    ? { lot: tl, room: tr, paidUntilMs: tu, price: num(t.price) ?? 0, ownerName: str(t.owner_name), listed: t.listed === true } : null;
  const out: HouseList = { lots, mine, tenancy, serverNowMs: now };
  const coins = num(r.coins);
  if (coins !== null) out.coins = coins;
  return out;
}

export interface HouseRoom { no: number; price: number | null; tenantName: string | null; untilMs: number | null }
export interface HouseLayout {
  lot: number; ownerId: string; ownerName: string; canEdit: boolean; myRoom: number | null; visibility: Visibility;
  grid: string; roof: Roof; wall: string | null; floor: string | null; rooms: HouseRoom[]; items: HousePlaced[];
}

export function parseHouseLayout(data: unknown): HouseLayout | null {
  const r = obj(data);
  const lot = r ? num(r.lot) : null;
  const g = r ? grid(r.grid) : null;
  if (!r || lot === null || typeof r.owner_id !== "string" || g === null) return null;
  return {
    lot, ownerId: r.owner_id, ownerName: str(r.owner_name) ?? "", canEdit: r.can_edit === true, myRoom: num(r.my_room), visibility: vis(r.visibility),
    grid: g, roof: roof(r.roof), wall: str(r.wall), floor: str(r.floor),
    rooms: arr(r.rooms).flatMap((x) => {
      const q = obj(x);
      const rn = q ? num(q.no) : null;
      return q && rn !== null ? [{ no: rn, price: num(q.price), tenantName: str(q.tenant_name), untilMs: num(q.until_ms) }] : [];
    }),
    items: arr(r.items).flatMap((x) => {
      const q = obj(x);
      const id = q ? num(q.id) : null, px = q ? num(q.x) : null, py = q ? num(q.y) : null, rot = q ? num(q.rot) : null;
      return q && id !== null && typeof q.item === "string" && px !== null && py !== null && rot !== null
        ? [{ id, item: q.item, x: px, y: py, rot, mine: q.mine === true }] : [];
    }),
  };
}

// ---------------------------------------------------------------- texts

const REFUSALS: ReadonlyArray<[string, string]> = [
  ["insufficient funds", "Không đủ xu."],
  ["too far ahead", "Chỉ trả trước tối đa 60 ngày."],
  ["already have a home", "Bạn đã có nhà rồi (căn hộ, lô đất hoặc phòng thuê) — mỗi người một nhà thôi."],
  ["upkeep due", "Lô đất đang nợ phí giữ đất — đóng phí trước đã."],
  ["has tenants", "Nhà đang có người thuê — chờ hết hạn thuê đã."],
  ["taken", "Chỗ này đã có người."],
  ["own house", "Đây là nhà bạn mà!"],
  ["not for rent", "Phòng này không cho thuê."],
  ["unknown room", "Không có phòng này."],
  ["bad price", `Giá thuê từ ${ROOM_RENT_MIN} đến ${ROOM_RENT_MAX} xu mỗi ${ROOM_RENT_DAYS} ngày.`],
  ["bad roof", "Kiểu mái không hợp lệ."],
  ["bad grid", "Bản vẽ không hợp lệ."],
  ["open floor", "Sàn nhà phải được bao kín bằng tường, cửa hoặc cửa sổ."],
  ["bad door", "Cửa phải nằm trong tường, nối hai bên là sàn (hoặc sân)."],
  ["bad window", "Cửa sổ phải nằm ở tường ngoài."],
  ["no room", "Nhà cần ít nhất một phòng có sàn."],
  ["too many rooms", `Tối đa ${HOUSE_MAX_ROOMS} phòng.`],
  ["small room", `Mỗi phòng ít nhất ${ROOM_MIN_CELLS} ô sàn.`],
  ["no front door", "Nhà cần một cửa chính mở ra sân."],
  ["unreachable", "Có phòng không có cửa đi tới từ cửa chính."],
  ["no lot", "Bạn chưa có lô đất."],
  ["no tenancy", "Bạn không thuê phòng nào."],
  ["not your room", "Bạn chỉ trang trí được phòng của mình (phòng đang cho thuê thì để người thuê)."],
  ["not floor", "Đồ phải đặt trên sàn trong nhà."],
  ["two rooms", "Đồ không được nằm vắt qua hai phòng."],
  ["door", "Đừng chắn cửa nhé."],
  ["overlap", "Chỗ đó bị chồng lên đồ khác."],
  ["bounds", "Đồ phải nằm trong lô đất."],
  ["too many", "Nhà đầy đồ rồi."],
  ["not placeable", "Món này không đặt được."],
  ["no access", "Cửa đang khoá — chỉ chủ nhà và người thuê vào được."],
  ["vacant", "Lô này chưa có nhà."],
  ["no bed", "Chưa có giường để ngủ."],
  ["already slept", "Hôm nay bạn ngủ rồi — mai ngủ tiếp nhé!"],
  ["fainted", "Bạn đang ngất, chờ hồi sinh…"],
  ["no home", "Bạn chưa có nhà."],
  ["not owned", "Bạn chưa có món này."],
  ["bad visibility", "Có lỗi, thử lại sau nhé."],
];

export function houseErrorMessage(msg: string): string {
  for (const [k, text] of REFUSALS) if (msg.includes(k)) return text;
  return "Có lỗi, thử lại sau nhé.";
}

export const houseErrText = (e: unknown): string =>
  houseErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

// ---------------------------------------------------------------- RPCs

async function rpc<T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T | null): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const out = parse(data);
  if (out === null) throw new Error("bad answer");
  return out;
}

const T = (token: string) => ({ p_session_token: token });
export const houseList = (token: string) => rpc("house_list", T(token), parseHouseList);
export const lotBuy = (token: string, lot: number) => rpc("lot_buy", { ...T(token), p_lot: lot }, parseHouseList);
export const lotUpkeep = (token: string) => rpc("lot_upkeep", T(token), parseHouseList);
export const lotSell = (token: string) => rpc("lot_sell", T(token), parseHouseList);
export const houseBuild = (token: string, design: string, roofStyle: Roof) =>
  rpc("house_build", { ...T(token), p_grid: design, p_roof: roofStyle }, parseHouseList);
export const houseSetVisibility = (token: string, v: Visibility) => rpc("house_set_visibility", { ...T(token), p_visibility: v }, parseHouseList);
export const houseRoomPrice = (token: string, room: number, price: number | null) =>
  rpc("house_room_price", { ...T(token), p_room: room, p_price: price }, parseHouseList);
export const houseRoomRent = (token: string, lot: number, room: number) => rpc("house_room_rent", { ...T(token), p_lot: lot, p_room: room }, parseHouseList);
export const houseRoomLeave = (token: string) => rpc("house_room_leave", T(token), parseHouseList);
export const houseEnter = (token: string, roomId: string, lot: number) =>
  rpc("house_enter", { ...T(token), p_room_id: roomId, p_lot: lot }, parseHouseLayout);
export const housePlace = (token: string, lot: number, id: number, x: number, y: number, rot: number) =>
  rpc("house_place", { ...T(token), p_lot: lot, p_id: id, p_x: x, p_y: y, p_rot: rot }, parseHouseLayout);
export const housePickup = (token: string, lot: number, id: number) => rpc("house_pickup", { ...T(token), p_lot: lot, p_id: id }, parseHouseLayout);
export const houseSetSurface = (token: string, kind: "wall" | "floor", item: string | null) =>
  rpc("house_set_surface", { ...T(token), p_kind: kind, p_item: item }, parseHouseLayout);
export const houseSleep = (token: string, lot: number): Promise<MotelState> =>
  rpc("home_sleep", { ...T(token), p_kind: "house", p_id: lot }, parseMotelState);
