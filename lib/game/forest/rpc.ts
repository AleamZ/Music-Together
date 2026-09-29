// The forest's RPCs (0096): chopping, logs, axes, cooking, dishes, and the state they share. Every outcome is the
// server's; the answers are parsed defensively (a malformed field becomes a safe default).
import { supabase } from "@/lib/supabase";

export interface ForestState {
  wood: Array<{ item: string; qty: number; half: number }>;
  logsToday: number;
  tools: Array<{ item: string; durability: number; max: number }>;
  dishes: Array<{ dish: string; quality: number; qty: number }>;
  meat: Record<string, number>;
  main: string | null;
  /** Felled trees until they respawn (server ms). */
  felled: Array<{ tree: string; respawnMs: number }>;
  serverNowMs: number;
}

const num = (x: unknown, d = 0): number => (typeof x === "number" && Number.isFinite(x) ? x : d);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
const arr = (x: unknown): Record<string, unknown>[] => (Array.isArray(x) ? x.map(obj) : []);

export function parseForest(raw: unknown): ForestState {
  const o = obj(raw);
  const meat: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(o.meat))) if (typeof v === "number") meat[k] = v;
  return {
    wood: arr(o.wood).flatMap((w) => (typeof w.item === "string" ? [{ item: w.item, qty: num(w.qty), half: num(w.half) }] : [])),
    logsToday: num(o.logs_today),
    tools: arr(o.tools).flatMap((t) => (typeof t.item === "string" ? [{ item: t.item, durability: num(t.durability), max: num(t.max, 1) }] : [])),
    dishes: arr(o.dishes).flatMap((d) => (typeof d.dish === "string" ? [{ dish: d.dish, quality: num(d.quality), qty: num(d.qty) }] : [])),
    meat,
    main: typeof o.main === "string" ? o.main : null,
    felled: arr(o.felled).flatMap((f) => (typeof f.tree === "string" ? [{ tree: f.tree, respawnMs: num(f.respawn_ms) }] : [])),
    serverNowMs: num(o.server_now_ms, Date.now()),
  };
}

async function call(fn: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const o = obj(data);
  if (o.anticheat) throw new Error(String(obj(o.anticheat).message ?? "refused"));
  return o;
}

export const forestState = async (token: string): Promise<ForestState> =>
  parseForest(await call("forest_state", { p_session_token: token }));

export interface ChopRound { tree: string; kind: string; need: number; have: number; axe: string; power: number; durability: number; win: number }

export async function chopStart(token: string, cx: number, cy: number, k: number, map: string, x: number, y: number): Promise<ChopRound> {
  const r = obj((await call("chop_start", {
    p_session_token: token, p_cx: cx, p_cy: cy, p_k: k, p_map: map, p_x: Math.round(x), p_y: Math.round(y),
  })).round);
  return {
    tree: String(r.tree ?? ""), kind: String(r.kind ?? ""), need: num(r.need, 1), have: num(r.have), axe: String(r.axe ?? ""),
    power: num(r.power, 1), durability: num(r.durability), win: num(r.win, 11),
  };
}

export interface ChopResult {
  result: "ok" | "felled" | "lost"; why: string | null; hits: number; blows: number; have: number; need: number;
  log: string | null; qty: number; full: number; xp: number; durability: number | null; forest: ForestState | null;
}

export async function chopFinish(token: string, presses: readonly number[]): Promise<ChopResult> {
  const o = await call("chop_finish", { p_session_token: token, p_presses: presses });
  const res = o.result === "felled" || o.result === "ok" ? o.result : "lost";
  return {
    result: res, why: typeof o.why === "string" ? o.why : null, hits: num(o.hits), blows: num(o.blows), have: num(o.have),
    need: num(o.need), log: typeof o.log === "string" ? o.log : null, qty: num(o.qty), full: num(o.full), xp: num(o.xp),
    durability: typeof o.durability === "number" ? o.durability : null, forest: o.forest ? parseForest(o.forest) : null,
  };
}

export const woodSell = async (token: string, item: string, qty: number) => {
  const o = await call("wood_sell", { p_session_token: token, p_item: item, p_qty: qty });
  return { earned: num(o.earned), forest: parseForest(o.forest) };
};
export const toolBuy = async (token: string, item: string) =>
  parseForest((await call("tool_buy", { p_session_token: token, p_item: item })).forest);

export async function cookStart(token: string, recipe: string): Promise<{ recipe: string; steps: string[] }> {
  const r = obj((await call("cook_start", { p_session_token: token, p_recipe: recipe })).round);
  return { recipe: String(r.recipe ?? recipe), steps: Array.isArray(r.steps) ? r.steps.map(String) : [] };
}

export interface CookResult { result: "ok" | "lost"; why: string | null; score: number; steps: number[]; quality: number; forest: ForestState | null }

export async function cookFinish(token: string, a: readonly number[], b: readonly number[]): Promise<CookResult> {
  const o = await call("cook_finish", { p_session_token: token, p_a: a, p_b: b });
  return {
    result: o.result === "ok" ? "ok" : "lost", why: typeof o.why === "string" ? o.why : null, score: num(o.score),
    steps: Array.isArray(o.steps) ? o.steps.map((x) => num(x)) : [], quality: num(o.quality),
    forest: o.forest ? parseForest(o.forest) : null,
  };
}

export const cookSell = async (token: string, dish: string, quality: number, qty: number) => {
  const o = await call("cook_sell", { p_session_token: token, p_dish: dish, p_quality: quality, p_qty: qty });
  return { earned: num(o.earned), forest: parseForest(o.forest) };
};
export const cookEat = async (token: string, dish: string, quality: number) => {
  const o = await call("cook_eat", { p_session_token: token, p_dish: dish, p_quality: quality });
  return { gained: num(o.gained), forest: parseForest(o.forest) };
};

/** A server refusal in words. */
export function forestErrorText(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (m.includes("not in forest")) return "Phải ở trong rừng tràm mới làm được việc này.";
  if (m.includes("no axe")) return "Bạn chưa có rìu (hoặc rìu đã mòn) — mua ở Sạp thợ săn.";
  if (m.includes("felled")) return "Cây này vừa bị đốn, chờ nó mọc lại nhé.";
  if (m.includes("not a chef")) return "Chỉ Đầu bếp mới nấu được — chọn nghề Đầu bếp (phím 3).";
  if (m.includes("no ingredients")) return "Thiếu nguyên liệu.";
  if (m.includes("too tired")) return "Hết thể lực — nghỉ một lát đã.";
  if (m.includes("cooldown")) return "Từ từ thôi…";
  if (m.includes("insufficient funds")) return "Không đủ xu.";
  if (m.includes("not at stall")) return "Hãy tới Sạp thợ săn ở Bãi đất trống.";
  if (m.includes("too far")) return "Đứng gần cây hơn.";
  if (m.includes("not enough")) return "Không đủ hàng.";
  if (m.includes("round not found")) return "Lượt này đã hết hạn.";
  return "Có lỗi, thử lại sau nhé.";
}
