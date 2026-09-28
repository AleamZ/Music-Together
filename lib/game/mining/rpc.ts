import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";

// Supabase calls for Mỏ đá (0072): the mine's state, the dig (server seed → replayed strikes), herbs, chú Tám's counter,
// bà Sáu's cauldron and the anvil. Every answer carries the whole mine state.

export interface MineNode { no: number; item: string; readyAt: number }
export interface MineTool { id: string; durability: number; max: number | null; level: number }
export interface MineGear { id: string; kind: "rod" | "net"; name: string; price: number | null; durability: number | null; max: number | null; level: number }
export interface MineBuff { kind: "luck" | "miner"; power: number; until: number }
export interface MineDig { node: number; item: string; tool: string; seed: number; need: number; win: number; startedAt: number }
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
}

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
  if (!Number.isFinite(startedAt) || typeof d.seed !== "number") return null;
  return { node: num(d.node), item: str(d.item), tool: str(d.tool), seed: d.seed >>> 0, need: num(d.need, 3), win: num(d.win, 90), startedAt };
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
  | { result: "lost"; why: "expired" | "refused" | "gave_up" | "taken" | "no_pickaxe"; toolBroke: boolean };

export async function mineFinish(roomId: string, token: string, strikes: readonly number[], ticks: number, pass: boolean)
  : Promise<{ outcome: DigResult; state: MineState }> {
  const r = await call("mine_finish", { p_room_id: roomId, p_session_token: token, p_strikes: strikes, p_ticks: ticks, p_pass: pass });
  const toolBroke = r.tool_broke === true;
  const outcome: DigResult = r.result === "mined"
    ? { result: "mined", item: str(r.item), qty: num(r.qty, 1), perfect: r.perfect === true, buff: r.buff === true, xp: num(r.xp), toolBroke }
    : { result: "lost", why: (["expired", "refused", "gave_up", "taken", "no_pickaxe"] as const).find((w) => w === r.why) ?? "refused", toolBroke };
  return { outcome, state: stateOf(r) };
}

export async function gatherHerb(roomId: string, token: string, node: number): Promise<{ item: string; qty: number; state: MineState }> {
  const r = await call("gather_herb", { p_room_id: roomId, p_session_token: token, p_node: node });
  return { item: str(r.item), qty: num(r.qty, 1), state: stateOf(r) };
}

export async function sellOre(token: string, item: string, qty: number): Promise<{ xu: number; state: MineState }> {
  const r = await call("sell_ore", { p_session_token: token, p_item: item, p_qty: qty });
  return { xu: num(obj(r.sold).xu), state: stateOf(r) };
}

export async function buyPickaxe(token: string, tool: string): Promise<MineState> {
  return stateOf(await call("buy_pickaxe", { p_session_token: token, p_tool: tool }));
}

export async function brewPotion(token: string, recipe: string, qty: number): Promise<MineState> {
  return stateOf(await call("brew_potion", { p_session_token: token, p_recipe: recipe, p_qty: qty }));
}

export async function drinkPotion(token: string, potion: string): Promise<{ effect: string; state: MineState }> {
  const r = await call("drink_potion", { p_session_token: token, p_potion: potion });
  return { effect: str(r.effect), state: stateOf(r) };
}

export interface UpgradeAnswer { item: string; ok: boolean; level: number; cost: number; chance: number }
export async function upgradeItem(token: string, item: string): Promise<{ upgrade: UpgradeAnswer; state: MineState }> {
  const r = await call("upgrade_item", { p_session_token: token, p_item: item });
  const u = obj(r.upgrade);
  return { upgrade: { item: str(u.item), ok: u.ok === true, level: num(u.level), cost: num(u.cost), chance: num(u.chance) }, state: stateOf(r) };
}

/** A refusal in Vietnamese. */
export function mineErrorMessage(err: unknown): string {
  const m = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : "";
  const map: Record<string, string> = {
    "node empty": "Chỗ này vừa bị đào hết — chờ mọc lại nhé.",
    "no pickaxe": "Cần một cây cuốc chim — mua ở lán chú Tám.",
    "pickaxe too weak": "Cuốc của bạn không đủ cứng cho loại quặng này.",
    "daily dig limit": "Hôm nay đào đủ rồi — mai quay lại nhé.",
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
  };
  for (const [k, v] of Object.entries(map)) if (m.includes(k)) return v;
  return "Có lỗi, thử lại sau.";
}
