import { supabase } from "@/lib/supabase";

/** The admin "Kinh tế" tab (0099_economy_watch.sql, admin_economy): the money supply, who holds it, and every xu that
 *  entered or left the game by coin_ledger reason. */
export interface EconFlow { reason: string; in: number; out: number; n: number; accounts: number }
export interface EconDay { day: string; in: number; out: number; net: number; accounts: number; supply: number }
export interface EconomyReport {
  serverNow: string;
  supply: { total: number; frozen: number; wallets: number; holders: number };
  /** Over the accounts that moved xu in the last 30 days. */
  dist: { n: number; p50: number; p90: number; p99: number; max: number; top10Share: number };
  top: Array<{ username: string; isRoot: boolean; coins: number }>;
  active: { d1: number; d7: number; d30: number };
  flows: Record<EconWindow, EconFlow[]>;
  daily: EconDay[];
  rooms: Array<{ name: string; mult: number; wealth: number }>;
  /** 0100: today's thương lái — goods sold to NPCs (catalog value), what they paid, accounts past the full-price mark. */
  npcToday: { gross: number; paid: number; accounts: number; overFull: number } | null;
}
/** 0100 econ_params: a knob root can change without a migration. */
export interface EconParam { key: string; value: number; min: number; max: number; note: string; updatedAt: string | null; updatedBy: string | null }
export type EconWindow = "d1" | "d7" | "d30";
export const ECON_WINDOWS: { id: EconWindow; label: string; days: number }[] = [
  { id: "d1", label: "24 giờ", days: 1 }, { id: "d7", label: "7 ngày", days: 7 }, { id: "d30", label: "30 ngày", days: 30 },
];

/** Where a ledger reason sits: a faucet (xu created by the game), a sink (xu destroyed by the game), a transfer between
 *  players (its net is the fees that leave, or the PvE prizes that enter), or an admin action. */
export type EconGroup = "faucet" | "sink" | "p2p" | "admin";
export const GROUP_LABEL: Record<EconGroup, string> = {
  faucet: "Nguồn xu (game trả)", sink: "Chi tiêu (game thu)", p2p: "Giữa người chơi (net = phí / thưởng PvE)",
  admin: "Quản trị",
};

const R: Record<string, [EconGroup, string]> = {
  // faucets
  daily: ["faucet", "Điểm danh"], song: ["faucet", "Thưởng bài hát"], sell: ["faucet", "Bán cho NPC (cá, xe, đồ…)"],
  rice_sell: ["faucet", "Bán lúa"], produce_sell: ["faucet", "Bán nông sản, hàng chế biến"], critter_sell: ["faucet", "Bán cua, ốc"],
  rat_sell: ["faucet", "Bán chuột"], ore_sell: ["faucet", "Bán quặng"], gem_sell: ["faucet", "Bán đá quý"],
  wild_sell: ["faucet", "Bán đồ rừng"], wood_sell: ["faucet", "Bán gỗ"], dish_sell: ["faucet", "Bán món ăn"],
  treasure: ["faucet", "Kho báu"], pet_find: ["faucet", "Thú cưng nhặt được"], login_reward: ["faucet", "Quà đăng nhập"],
  level_reward: ["faucet", "Thưởng lên cấp"], quest_reward: ["faucet", "Thưởng nhiệm vụ"],
  achievement_reward: ["faucet", "Thưởng thành tựu"], collection_reward: ["faucet", "Thưởng bộ sưu tập"],
  boss_reward: ["faucet", "Thưởng boss"], dungeon_reward: ["faucet", "Thưởng hầm ngục"],
  land_refund: ["faucet", "Hoàn tiền ruộng bị thu hồi"], house_refund: ["faucet", "Hoàn tiền nhà"],
  apartment_sell: ["faucet", "Bán lại căn hộ"],
  admin_gift: ["faucet", "Quà admin (hòm thư)"], gift_code: ["faucet", "Code quà tặng (hòm thư)"],
  // sinks
  buy: ["sink", "Mua ở tiệm (đồ câu, bộ câu…)"], rent: ["sink", "Thuê ruộng"], farm_buy: ["sink", "Mua đồ nông trại"],
  harvester: ["sink", "Thuê máy gặt"], meal: ["sink", "Ăn uống"], vehicle: ["sink", "Mua xe"], skip: ["sink", "Xe ôm"],
  salon: ["sink", "Tiệm tóc"], repair: ["sink", "Sửa đồ"], pet_buy: ["sink", "Mua thú cưng, đồ thú"], umbrella: ["sink", "Mua ô"],
  motel: ["sink", "Nhà nghỉ"], apartment: ["sink", "Căn hộ (thuê, mua)"], furniture: ["sink", "Nội thất"],
  house_land: ["sink", "Mua đất xây nhà"], house_upkeep: ["sink", "Phí duy trì nhà"], house_build: ["sink", "Xây nhà"],
  dog_adopt: ["sink", "Nhận nuôi chó"], dojo_tuition: ["sink", "Học phí võ đường"], dojo_exam: ["sink", "Thi lên đai"],
  mine_tool: ["sink", "Mua cuốc"], potion: ["sink", "Pha thuốc"], upgrade: ["sink", "Nâng cấp đồ"],
  market_list: ["sink", "Phí đăng bán ở chợ"], shop_rent: ["sink", "Thuê sạp"], pet_gacha: ["sink", "Trứng thú cưng"],
  pet_train: ["sink", "Huấn luyện thú"], aquarium: ["sink", "Trang trí bể cá"], dungeon_entry: ["sink", "Vé hầm ngục"],
  boat: ["sink", "Mua ghe"], machine: ["sink", "Mua máy chế biến"], profession: ["sink", "Đổi nghề"],
  skill_reset: ["sink", "Tẩy điểm kỹ năng"], buff_food: ["sink", "Món tăng lực"], teleport: ["sink", "Dịch chuyển"],
  photo: ["sink", "Chụp ảnh"], tool_buy: ["sink", "Mua dụng cụ"], cook_fee: ["sink", "Phí nấu ăn"],
  // between players
  trade: ["p2p", "Giao dịch trực tiếp"], market_sell: ["p2p", "Chợ: người bán nhận"], market_buy: ["p2p", "Chợ: người mua trả"],
  market_refund: ["p2p", "Chợ: hoàn nửa phí khi hết hạn"], auction_bid: ["p2p", "Đấu giá: đặt giá"],
  auction_refund: ["p2p", "Đấu giá: trả lại"], auction_sell: ["p2p", "Đấu giá: người bán nhận"],
  shop_sell: ["p2p", "Sạp: người bán nhận"], shop_buy: ["p2p", "Sạp: người mua trả"], card_hold: ["p2p", "Bài: giữ tiền cược"],
  card_settle: ["p2p", "Bài: chia tiền"], card_buyin: ["p2p", "Bài: mua chip"], card_cashout: ["p2p", "Bài: đổi chip"],
  card_refund: ["p2p", "Bài: hoàn tiền"], fight_stake: ["p2p", "Đấu võ: tiền cược"], fight_win: ["p2p", "Đấu võ: thắng"],
  fight_refund: ["p2p", "Đấu võ: hoàn cược"], ug_entry: ["p2p", "Hầm đấu: phí vào"], ug_prize: ["p2p", "Hầm đấu: thưởng"],
  ug_refund: ["p2p", "Hầm đấu: hoàn phí"], arena_team_stake: ["p2p", "Đấu đội: cược"], arena_team_win: ["p2p", "Đấu đội: thắng"],
  arena_team_refund: ["p2p", "Đấu đội: hoàn cược"], fish_battle: ["p2p", "Đấu cá"], pet_battle: ["p2p", "Đấu thú"],
  fishing_battle_entry: ["p2p", "Thi câu: phí"], fishing_battle_prize: ["p2p", "Thi câu: thưởng"],
  fishing_battle_refund: ["p2p", "Thi câu: hoàn phí"], lease_pay: ["p2p", "Thuê lại ruộng: trả"],
  lease_income: ["p2p", "Thuê lại ruộng: nhận"], estate_buy: ["p2p", "Nhà đất: mua"], estate_sale: ["p2p", "Nhà đất: bán"],
  house_rent_pay: ["p2p", "Thuê phòng: trả"], house_rent_income: ["p2p", "Thuê phòng: chủ nhận"],
  land_buy: ["p2p", "Mua ruộng (làng hoặc người chơi)"], land_sell: ["p2p", "Bán ruộng (làng hoặc người chơi)"],
  // admin
  wipe: ["admin", "Xoá dữ liệu (chống gian lận)"],
};

/** A reason's group; an unknown reason (a newer server) is judged by its sign. */
export function reasonGroup(reason: string, net = 0): EconGroup {
  return R[reason]?.[0] ?? (net >= 0 ? "faucet" : "sink");
}
export function reasonLabel(reason: string): string {
  return R[reason]?.[1] ?? reason;
}

export interface EconGroupTotal { group: EconGroup; in: number; out: number; net: number; flows: EconFlow[] }
/** The flows by group (faucet, sink, p2p, admin), each sorted by |net|, and the totals. */
export function groupFlows(flows: EconFlow[]): { groups: EconGroupTotal[]; in: number; out: number; net: number } {
  const order: EconGroup[] = ["faucet", "sink", "p2p", "admin"];
  const groups = order.map((group) => {
    const fl = flows.filter((f) => reasonGroup(f.reason, f.in + f.out) === group)
      .sort((a, b) => Math.abs(b.in + b.out) - Math.abs(a.in + a.out));
    const xin = fl.reduce((s, f) => s + f.in, 0), xout = fl.reduce((s, f) => s + f.out, 0);
    return { group, in: xin, out: xout, net: xin + xout, flows: fl };
  }).filter((g) => g.flows.length > 0);
  const xin = flows.reduce((s, f) => s + f.in, 0), xout = flows.reduce((s, f) => s + f.out, 0);
  return { groups, in: xin, out: xout, net: xin + xout };
}

/** The daily growth of the money supply over the window (net ÷ days ÷ supply at the window's start), in percent. */
export function inflationPerDay(net: number, supplyNow: number, days: number): number | null {
  const start = supplyNow - net;
  if (start <= 0 || days <= 0) return null;
  return (net / days / start) * 100;
}

/** "12,9 N", "4,2 Tr", "1,1 Tỷ" — compact xu for tiles and axes; below 10 000 the full number. */
export function compactXu(n: number): string {
  const a = Math.abs(n), sign = n < 0 ? "−" : "";
  const f = (v: number, u: string) => `${sign}${v.toLocaleString("vi-VN", { maximumFractionDigits: v < 100 ? 1 : 0 })} ${u}`;
  if (a >= 1e9) return f(a / 1e9, "Tỷ");
  if (a >= 1e6) return f(a / 1e6, "Tr");
  if (a >= 1e4) return f(a / 1e3, "N");
  return `${sign}${a.toLocaleString("vi-VN")}`;
}

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? v as Record<string, unknown> : {});

function parseFlows(v: unknown): EconFlow[] {
  return arr(v).map((x) => { const o = obj(x); return { reason: String(o.reason ?? ""), in: num(o.in), out: num(o.out), n: num(o.n), accounts: num(o.accounts) }; })
    .filter((f) => f.reason !== "");
}

/** admin_economy's answer, read defensively (a missing part is empty, never a crash). */
export function parseEconomy(data: unknown): EconomyReport {
  const o = obj(data), s = obj(o.supply), d = obj(o.dist), a = obj(o.active), f = obj(o.flows);
  return {
    serverNow: String(o.server_now ?? ""),
    supply: { total: num(s.total), frozen: num(s.frozen), wallets: num(s.wallets), holders: num(s.holders) },
    dist: { n: num(d.n), p50: num(d.p50), p90: num(d.p90), p99: num(d.p99), max: num(d.max), top10Share: num(d.top10_share) },
    top: arr(o.top).map((x) => { const t = obj(x); return { username: String(t.username ?? ""), isRoot: t.is_root === true, coins: num(t.coins) }; }),
    active: { d1: num(a.d1), d7: num(a.d7), d30: num(a.d30) },
    flows: { d1: parseFlows(f.d1), d7: parseFlows(f.d7), d30: parseFlows(f.d30) },
    daily: arr(o.daily).map((x) => {
      const t = obj(x);
      return { day: String(t.day ?? ""), in: num(t.in), out: num(t.out), net: num(t.net), accounts: num(t.accounts), supply: num(t.supply) };
    }),
    rooms: arr(o.rooms).map((x) => { const t = obj(x); return { name: String(t.name ?? ""), mult: num(t.mult), wealth: num(t.wealth) }; }),
    npcToday: o.npc_today && typeof o.npc_today === "object"
      ? (() => { const t = obj(o.npc_today); return { gross: num(t.gross), paid: num(t.paid), accounts: num(t.accounts), overFull: num(t.over_full) }; })()
      : null,
  };
}

export function parseEconParams(data: unknown): EconParam[] {
  return arr(data).map((x) => {
    const t = obj(x);
    return {
      key: String(t.key ?? ""), value: num(t.value), min: num(t.min), max: num(t.max), note: String(t.note ?? ""),
      updatedAt: typeof t.updated_at === "string" ? t.updated_at : null, updatedBy: typeof t.updated_by === "string" ? t.updated_by : null,
    };
  }).filter((p) => p.key !== "");
}

export async function adminEconParams(token: string): Promise<EconParam[]> {
  const { data, error } = await supabase.rpc("admin_econ_params", { p_session_token: token });
  if (error) throw error;
  return parseEconParams(data);
}

export async function adminEconSet(token: string, key: string, value: number): Promise<EconParam[]> {
  const { data, error } = await supabase.rpc("admin_econ_set", { p_session_token: token, p_key: key, p_value: value });
  if (error) throw error;
  return parseEconParams(data);
}

export async function adminEconomy(token: string): Promise<EconomyReport> {
  const { data, error } = await supabase.rpc("admin_economy", { p_session_token: token });
  if (error) throw error;
  return parseEconomy(data);
}
