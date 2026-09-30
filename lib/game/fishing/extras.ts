// v21 fishing extras (0076): the boat and the deep water, fishing battles, treasure maps and the farming machines.
// Pure: constants mirrored from 0076_fishing_extras.sql (tests/unit/v21-fishing.test.ts pins them), the answer parsers
// and the small rules the panels show. Every outcome is decided by the server; these only describe it.

import type { Vec } from "@/lib/game/types";

/** 0076 _boat_geo(): where one stands to board (on Cầu ao), the boat's deck in the deep water, the price (econ v2, 0101: 25 000;
 *  was 4 000). */
export const BOAT = { pier: { x: 378, y: 206 }, deck: { x: 356, y: 116 }, price: 25000 } as const;

/** 0076's deep-water species (rarity 3–5; the dock never lands them). 0086 added five more: lib/game/river/species.ts. */
export const DEEP_SPECIES: readonly string[] = ["ca_leo", "ca_bong_tuong", "ca_chien", "ca_duoi_song", "ca_tra_dau", "rua_mai_vang"];

/** _machine_price() (0076; econ v2's 0102 re-prices the processor). */
export type MachineId = "sprinkler" | "harvester" | "processor";
export const MACHINES: ReadonlyArray<{ id: MachineId; name: string; price: number; blurb: string }> = [
  { id: "sprinkler", name: "Máy tưới", price: 6000, blurb: "Đưa mực nước thửa của bạn tới mức cần chỉ một lần bấm, ở đâu cũng được." },
  { id: "harvester", name: "Máy gặt riêng", price: 15000, blurb: "Gặt trọn thửa lúa chín trong 30 giây — không tốn tiền thuê." },
  { id: "processor", name: "Máy chế biến", price: 50000, blurb: "Biến lúa khô và hoa màu thành hàng giá trị cao hơn." },   // econ v2 (0102): was 10 000
];

/** Econ v2 (0101): at most this many chests found per account per Vietnam day; after that no map drops and no dig starts. */
export const TREASURE_PER_DAY = 3;

/** Fishing battle options (0076 fb_create). */
export const BATTLE_FEES: readonly number[] = [100, 300, 500, 1000, 2000];
export const BATTLE_DURATIONS: readonly number[] = [180, 300, 600];
export const BATTLE_BURN_PCT = 10;
export const BATTLE_MAX_PLAYERS = 8;

/** The prize of a pot for `winners` tied winners (0076 _fb_settle): 10 % burned, the rest split evenly (floor). */
export function battlePrize(pot: number, winners = 1): number {
  const burn = Math.floor(pot / 10);
  return Math.floor((pot - burn) / Math.max(1, winners));
}

/** Maps' sizes (0057 _pos_maps) — the treasure hint's grid is 4 × 3 cells of the map. */
export const MAP_SIZES: Readonly<Record<string, { w: number; h: number }>> = {
  hall: { w: 640, h: 400 }, pond: { w: 640, h: 400 }, field: { w: 800, h: 480 }, market: { w: 1280, h: 400 },
  khu_nha: { w: 800, h: 400 }, bai_dat: { w: 800, h: 400 }, ham_ngam: { w: 480, h: 320 },
};
export const MAP_NAMES: Readonly<Record<string, string>> = {
  hall: "Sảnh nhạc", pond: "Ao cá", field: "Cánh đồng", market: "Chợ Lớn", khu_nha: "Khu nhà", bai_dat: "Bãi đất trống",
  ham_ngam: "Hầm ngầm",
};

/** The rectangle (world px) of a hint's grid cell. */
export function hintRect(map: string, cell: { col: number; row: number }): { x: number; y: number; w: number; h: number } | null {
  const s = MAP_SIZES[map];
  if (!s) return null;
  const w = s.w / 4, h = s.h / 3;
  return { x: cell.col * w, y: cell.row * h, w, h };
}

export type Heat = "hot" | "warm" | "cold" | "wrong_map";
export const HEAT_TEXT: Readonly<Record<Heat, string>> = {
  hot: "🔥 Nóng lắm! Kho báu ở ngay gần đây.",
  warm: "🌤️ Âm ấm… đi thêm chút nữa.",
  cold: "❄️ Lạnh ngắt — không phải chỗ này.",
  wrong_map: "🧭 Bản đồ này không vẽ nơi đây.",
};

export interface TreasureMap { id: string; map: string; landmark: string; source: "fishing" | "boat" | "dig"; cell: { col: number; row: number }; digs: number }
export interface Recipe { id: string; name: string; inputKind: "rice" | "upland"; inputId: string; inputKg: number; value: number; minutes: number }
export interface ExtrasState {
  serverNow: number;
  coins: number;
  boat: { owned: boolean; aboard: boolean; price: number };
  maps: TreasureMap[];
  found: number;
  machines: MachineId[];
  job: { recipe: string; batches: number; startedAt: number; readyAt: number } | null;
  goods: Record<string, number>;
  recipes: Recipe[];
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : d);
const time = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function parseMap(v: unknown): TreasureMap | null {
  const o = obj(v), c = obj(o.cell);
  if (typeof o.id !== "string" || typeof o.map !== "string") return null;
  const source = o.source === "boat" || o.source === "dig" ? o.source : "fishing";
  return { id: o.id, map: o.map, landmark: str(o.landmark), source, cell: { col: num(c.col), row: num(c.row) }, digs: num(o.digs) };
}

export function parseExtrasState(raw: unknown): ExtrasState | null {
  const o = obj(raw);
  if (!("boat" in o)) return null;
  const b = obj(o.boat), j = o.job ? obj(o.job) : null;
  const goods: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(o.goods))) if (num(v) > 0) goods[k] = num(v);
  return {
    serverNow: time(o.server_now),
    coins: num(o.coins),
    boat: { owned: b.owned === true, aboard: b.aboard === true, price: num(b.price, BOAT.price) },
    maps: arr(o.maps).map(parseMap).filter((m): m is TreasureMap => m !== null),
    found: num(o.found),
    machines: arr(o.machines).filter((m): m is MachineId => m === "sprinkler" || m === "harvester" || m === "processor"),
    job: j ? { recipe: str(j.recipe), batches: num(j.batches, 1), startedAt: time(j.started_at), readyAt: time(j.ready_at) } : null,
    goods,
    recipes: arr(o.recipes).map((r) => {
      const x = obj(r);
      return {
        id: str(x.id), name: str(x.name), inputKind: x.input_kind === "upland" ? "upland" as const : "rice" as const,
        inputId: str(x.input_id), inputKg: num(x.input_kg), value: num(x.value), minutes: num(x.minutes),
      };
    }),
  };
}

export type BattleStatus = "open" | "live" | "done" | "cancelled";
export interface BattlePlayer { accountId: string; username: string; score: number; catches: number; best: string | null }
export interface Battle {
  id: string; host: string; fee: number; durationS: number; status: BattleStatus;
  startsAt: number | null; endsAt: number | null; pot: number; burned: number; winners: string[]; prize: number;
  players: BattlePlayer[];
}
export interface BattleBoard { serverNow: number; me: string; battles: Battle[] }

export function parseBattleBoard(raw: unknown): BattleBoard | null {
  const o = obj(raw);
  if (!Array.isArray(o.battles)) return null;
  return {
    serverNow: time(o.server_now),
    me: str(o.me),
    battles: o.battles.map((v) => {
      const b = obj(v);
      const status: BattleStatus = b.status === "live" || b.status === "done" || b.status === "cancelled" ? b.status : "open";
      const st = time(b.starts_at), en = time(b.ends_at);
      return {
        id: str(b.id), host: str(b.host), fee: num(b.fee), durationS: num(b.duration_s), status,
        startsAt: Number.isNaN(st) ? null : st, endsAt: Number.isNaN(en) ? null : en,
        pot: num(b.pot), burned: num(b.burned), winners: arr(b.winners).map((w) => str(w)), prize: num(b.prize),
        players: arr(b.players).map((p) => {
          const x = obj(p);
          return { accountId: str(x.account_id), username: str(x.username), score: num(x.score), catches: num(x.catches), best: typeof x.best === "string" ? x.best : null };
        }),
      };
    }),
  };
}

/** My open or live battle on the board, or null. */
export function myBattle(board: BattleBoard | null): Battle | null {
  if (!board) return null;
  return board.battles.find((b) => (b.status === "open" || b.status === "live") && b.players.some((p) => p.accountId === board.me)) ?? null;
}

/** The live battle's phase at `now` (server ms). */
export function battlePhase(b: Battle, now: number): "waiting" | "countdown" | "fishing" | "over" {
  if (b.status === "open") return "waiting";
  if (b.status !== "live" || b.startsAt === null || b.endsAt === null) return "over";
  if (now < b.startsAt) return "countdown";
  return now < b.endsAt ? "fishing" : "over";
}

/** "3:05" */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Is `p` within `r` px of the boat's deck (the local check before asking the server)? */
export function nearDeck(p: Vec | null, r = 24): boolean {
  return !!p && Math.abs(p.x - BOAT.deck.x) <= r && Math.abs(p.y - BOAT.deck.y) <= r;
}

/** Vietnamese text for the extras' errors; null for the ones the fishing messages already cover. */
export function extrasErrorText(msg: string): string | null {
  switch (msg) {
    case "no boat": return "Bạn chưa có ghe — mua ở Bến ghe trên cầu ao.";
    case "not aboard": return "Bạn chưa lên ghe.";
    case "not at pond": return "Phải đứng ở ao cá mới vào được trận câu.";
    case "in battle": return "Bạn đang ở trong một trận câu rồi.";
    case "too many battles": return "Ao đang có đủ trận chờ — vào một trận có sẵn nhé.";
    case "battle closed": return "Trận này đã đóng.";
    case "battle full": return "Trận đã đủ người.";
    case "not host": return "Chỉ chủ trận mới bắt đầu được.";
    case "need players": return "Cần ít nhất 2 người mới đấu được.";
    case "no map": return "Tấm bản đồ này không còn nữa.";
    case "not at field": return "Phải ở ngoài đồng (hoặc Chợ Lớn) mới làm được.";
    case "no machine": return "Bạn chưa có máy này.";
    case "machine busy": return "Máy đang chạy — chờ xong mẻ trước.";
    case "not ready": return "Mẻ hàng chưa xong.";
    case "no job": return "Máy đang trống.";
    case "not enough crop": return "Không đủ nông sản.";
    case "not your plot": return "Thửa này không phải của bạn.";
    case "not prepared": return "Thửa chưa làm đất.";
    case "too fast": return "Tưới nhiều quá — chờ chút nhé.";
    case "harvester busy": return "Máy gặt đang chạy trên thửa này.";
    case "harvesting": return "Lúa đang gặt dở.";
    case "wrong crop": return "Máy gặt chỉ gặt lúa.";
    case "wrong phase": return "Lúa chưa chín.";
    case "need water": return "Rút nước trước khi gặt.";
    case "lease ends": return "Hợp đồng thuê sắp hết — không kịp gặt.";
    // v22 (0086): Sông Cái and the treasure dig
    case "outdated": return "Trò chơi đã cập nhật — tải lại trang để chơi cách mới nhé.";
    case "map locked": return "Chưa đủ cấp để ra Sông Cái (cần cấp 3).";
    case "row not found": return "Chuyến chèo đã hết hạn — chèo lại nhé.";
    case "dig not found": return "Lượt đào đã hết hạn — đào lại nhé.";
    case "detector tired": return "Máy dò đã hết pin cho tấm bản đồ này.";
    // econ v2 (0101): three chests a day
    case "treasure day cap": return `Hôm nay đã đào đủ ${TREASURE_PER_DAY} kho báu — bản đồ vẫn giữ, mai đào tiếp nhé.`;
    case "too tired": return "Mệt quá rồi — nghỉ chút cho lại sức nhé.";
    default: return null;
  }
}
