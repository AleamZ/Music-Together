import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { parseNpcQuota, type NpcQuota } from "@/lib/game/economy/npc";
import { DAILY_DIGS } from "@/lib/game/mining/catalog";
import { supabase } from "@/lib/supabase";

// Supabase calls for Mỏ đá (0072): the mine's state, the dig (replayed strikes; since 0087 played live — the veins come
// through mg_sync('mine'), the start answers the bar's period), herbs, chú Tám's counter,
// bà Sáu's cauldron and the anvil. Every answer carries the whole mine state.

export interface MineNode { no: number; item: string; readyAt: number }
export interface MineTool { id: string; durability: number; max: number | null; level: number }
export interface MineGear { id: string; kind: "rod" | "net"; name: string; price: number | null; durability: number | null; max: number | null; level: number }
export interface MineBuff { kind: "luck" | "miner"; power: number; until: number }
export interface MineDig { node: number; item: string; tool: string; period: number; need: number; win: number; startedAt: number }
export interface MineState {
  serverNow: number;
  coins: number;
  nodes: MineNode[];
  bag: Record<string, number>;
  fish: number;
  tools: MineTool[];
  gear: MineGear[];
  buffs: MineBuff[];
  dig: MineDig | null;
  /** v22 (0084): how many of the bag's potions are Tốt (2) / Hoàn hảo (3). */
  quality: MineQuality[];
}
export interface MineQuality { item: string; tier: 2 | 3; qty: number }

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const time = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : NaN);

export function parseDig(raw: unknown): MineDig | null {
  if (!raw || typeof raw !== "object") return null;
  const d = obj(raw);
  const startedAt = time(d.started_at);
  if (!Number.isFinite(startedAt) || typeof d.period !== "number") return null;
  return { node: num(d.node), item: str(d.item), tool: str(d.tool), period: d.period, need: num(d.need, 3), win: num(d.win, 90), startedAt };
}

/** The mine state (0072 _mine_state); null when malformed. */
export function parseMineState(raw: unknown): MineState | null {
  if (!raw || typeof raw !== "object") return null;
  const s = obj(raw);
  const serverNow = time(s.server_now);
  if (!Number.isFinite(serverNow)) return null;
  const bag: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(s.bag))) if (typeof v === "number" && v > 0) bag[k] = v;
  return {
    serverNow,
    coins: num(s.coins),
    nodes: arr(s.nodes).map((n) => { const o = obj(n); return { no: num(o.no), item: str(o.item), readyAt: time(o.ready_at) }; }),
    bag,
    fish: num(s.fish),
    tools: arr(s.tools).map((t) => { const o = obj(t); return { id: str(o.id), durability: num(o.durability), max: numOrNull(o.max), level: num(o.level) }; }),
    gear: arr(s.gear).map((g) => {
      const o = obj(g);
      return { id: str(o.id), kind: o.kind === "net" ? "net" : "rod", name: str(o.name), price: numOrNull(o.price), durability: numOrNull(o.durability), max: numOrNull(o.max), level: num(o.level) };
    }),
    // the shared player_buffs also hold 0077's food buffs: only the mine's own are shown here
    buffs: arr(s.buffs).map(obj).filter((o) => o.kind === "luck" || o.kind === "miner")
      .map((o) => ({ kind: o.kind === "miner" ? "miner" as const : "luck" as const, power: num(o.power, 1), until: time(o.until) })),
    dig: parseDig(s.dig),
    quality: arr(s.quality).map(obj).map((o) => ({ item: str(o.item), tier: o.tier === 3 ? 3 as const : 2 as const, qty: num(o.qty) }))
      .filter((q) => q.qty > 0),
  };
}

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  const flagged = screenAnswer(data, error);
  if (error) throw error;
  if (flagged) throw new AnticheatError(flagged);
  return (data ?? {}) as Record<string, unknown>;
}

function stateOf(r: Record<string, unknown>): MineState {
  const s = parseMineState(r.state);
  if (!s) throw new Error("bad mine state");
  return s;
}

export async function mineState(roomId: string, token: string): Promise<MineState> {
  return stateOf(await call("mine_state", { p_room_id: roomId, p_session_token: token }));
}

export async function mineStart(roomId: string, token: string, node: number): Promise<{ dig: MineDig; state: MineState }> {
  const r = await call("mine_start", { p_room_id: roomId, p_session_token: token, p_node: node });
  const dig = parseDig(r.dig);
  if (!dig) throw new Error("bad dig");
  return { dig, state: stateOf(r) };
}

export type DigResult =
  | { result: "mined"; item: string; qty: number; perfect: boolean; buff: boolean; xp: number; toolBroke: boolean }
  | { result: "lost"; why: "expired" | "refused" | "gave_up" | "taken" | "no_pickaxe" | "late" | "outdated"; toolBroke: boolean };

export async function mineFinish(roomId: string, token: string, strikes: readonly number[], ticks: number, pass: boolean)
  : Promise<{ outcome: DigResult; state: MineState }> {
  const r = await call("mine_finish", { p_room_id: roomId, p_session_token: token, p_strikes: strikes, p_ticks: ticks, p_pass: pass });
  const toolBroke = r.tool_broke === true;
  const outcome: DigResult = r.result === "mined"
    ? { result: "mined", item: str(r.item), qty: num(r.qty, 1), perfect: r.perfect === true, buff: r.buff === true, xp: num(r.xp), toolBroke }
    : { result: "lost", why: (["expired", "refused", "gave_up", "taken", "no_pickaxe", "late", "outdated"] as const).find((w) => w === r.why) ?? "refused", toolBroke };
  return { outcome, state: stateOf(r) };
}

export async function gatherHerb(roomId: string, token: string, node: number): Promise<{ item: string; qty: number; state: MineState }> {
  const r = await call("gather_herb", { p_room_id: roomId, p_session_token: token, p_node: node });
  return { item: str(r.item), qty: num(r.qty, 1), state: stateOf(r) };
}

/** Sell at chú Tám's counter (0103: through the thương lái — `xu` is what was paid, `cut` what it kept back, `npc` the day). */
export async function sellOre(token: string, item: string, qty: number)
  : Promise<{ xu: number; cut: number; npc: NpcQuota | null; state: MineState }> {
  const r = await call("sell_ore", { p_session_token: token, p_item: item, p_qty: qty });
  return { xu: num(obj(r.sold).xu), cut: num(r.npc_cut), npc: parseNpcQuota(r.npc), state: stateOf(r) };
}

export async function buyPickaxe(token: string, tool: string): Promise<MineState> {
  return stateOf(await call("buy_pickaxe", { p_session_token: token, p_tool: tool }));
}

export async function drinkPotion(token: string, potion: string): Promise<{ effect: string; quality: number; state: MineState }> {
  const r = await call("drink_potion", { p_session_token: token, p_potion: potion });
  return { effect: str(r.effect), quality: num(r.quality, 1), state: stateOf(r) };
}

/** A refusal in Vietnamese. */
export function mineErrorMessage(err: unknown): string {
  const m = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  const map: Record<string, string> = {
    "node empty": "Chỗ này vừa bị đào hết — chờ mọc lại nhé.",
    "no pickaxe": "Cần một cây cuốc chim — mua ở lán chú Tám.",
    "pickaxe too weak": "Cuốc của bạn không đủ cứng cho loại quặng này.",
    "daily dig limit": `Hôm nay đào đủ ${DAILY_DIGS} lượt rồi — mai quay lại nhé.`,
    "dig not found": "Lượt đào đã hết hạn.",
    "not enough coins": "Không đủ xu.",
    "not enough items": "Không đủ nguyên liệu.",
    "already owned": "Bạn đã có cây cuốc này.",
    "item not available": "Món này không có.",
    "max level": "Đã nâng cấp tối đa (+5).",
    "too fast": "Chậm lại một chút…",
    "too far": "Lại gần hơn đã.",
    "too hungry": "Đói quá, ăn gì đã!",
    "too thirsty": "Khát quá, uống gì đã!",
    fainted: "Bạn đang ngất.",
    "map locked": "Mỏ đá mở từ cấp 5 — luyện thêm đã nhé.",
    "too tired": "Mệt quá — nghỉ lấy sức đã.",
    "round not found": "Lượt này đã hết hạn.",
    outdated: "Cập nhật trang để dùng bản mới.",
  };
  for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
  return "Có lỗi, thử lại sau.";
}
