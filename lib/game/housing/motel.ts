// v19.1 Nhà nghỉ + giấc ngủ: the rules of 0039_motel.sql (authoritative; the prices and the rest's stamina factor are
// 0105's, econ v2) and its RPCs. The client uses the rules only to show prices and to apply the walk buff of the state
// the server returned.
import { supabase } from "@/lib/supabase";

export type MotelPlan = "night" | "month";

/** econ v2 (0105): a night 300 (was 100), a month 6 000 (was 2 000) — still a third cheaper than 30 nights. */
export const MOTEL_PLANS: ReadonlyArray<{ id: MotelPlan; name: string; price: number; hours: number }> = [
  { id: "night", name: "Một đêm", price: 300, hours: 24 },
  { id: "month", name: "Một tháng", price: 6000, hours: 30 * 24 },
];
/** Prepaid at most this far ahead. */
export const MOTEL_MAX_AHEAD_DAYS = 60;
/** "Ngủ ngon", for 24 h after a sleep (one sleep per Vietnam day): hunger and thirst drain ×0.7 (0040), walking ×1.07
 *  and stamina regen ×REST_STAMINA (the server's _stamina_rate). */
export const REST_DRAIN = 0.7;
export const REST_WALK = 1.07;
/** econ v2 (0105_econ_sinks.sql): the rested stamina regen factor, ×1.5 before. */
export const REST_STAMINA = 1.2;
export const REST_HOURS = 24;
const pct = (f: number): number => Math.round(Math.abs(f - 1) * 100);
/** The buff in words (the motel panel, the rest chip): "đói và khát chậm hơn 30 %, đi nhanh hơn 7 %, thể lực hồi nhanh hơn 20 %". */
export const REST_EFFECT_TEXT =
  `đói và khát chậm hơn ${pct(REST_DRAIN)} %, đi nhanh hơn ${pct(REST_WALK)} %, thể lực hồi nhanh hơn ${pct(REST_STAMINA)} %`;
/** The sleep cutscene. */
export const SLEEP_MS = 4200;

export interface MotelState {
  stay: { plan: MotelPlan; untilMs: number } | null;
  rest: { buffUntilMs: number | null; sleptToday: boolean };
  serverNowMs: number;
  coins?: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function parseMotelState(data: unknown): MotelState | null {
  if (!data || typeof data !== "object") return null;
  const r = data as Record<string, unknown>;
  const now = num(r.server_now_ms);
  if (now === null) return null;
  const s = r.stay && typeof r.stay === "object" ? (r.stay as Record<string, unknown>) : null;
  const until = s ? num(s.until_ms) : null;
  const plan = s?.plan === "night" || s?.plan === "month" ? (s.plan as MotelPlan) : null;
  const stay = plan !== null && until !== null ? { plan, untilMs: until } : null;
  const rest = (r.rest && typeof r.rest === "object" ? r.rest : {}) as Record<string, unknown>;
  const out: MotelState = { stay, rest: { buffUntilMs: num(rest.buff_until_ms), sleptToday: rest.slept_today === true }, serverNowMs: now };
  const coins = num(r.coins);
  if (coins !== null) out.coins = coins;
  return out;
}

/** Is "Ngủ ngon" running at client time `nowMs`? (`offsetMs` = server − client clock.) */
export const restActive = (s: MotelState | null, nowMs: number, offsetMs = 0): boolean =>
  s?.rest.buffUntilMs != null && s.rest.buffUntilMs > nowMs + offsetMs;

/** The walk factor from the buff. */
export const restWalk = (active: boolean): number => (active ? REST_WALK : 1);

/** "3 giờ 5 phút" / "12 ngày" for a duration. */
export function durationText(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m >= 48 * 60) return `${Math.floor(m / 1440)} ngày`;
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} giờ ${m % 60} phút` : `${m} phút`;
}

export function motelErrorMessage(msg: string): string {
  if (msg.includes("insufficient funds")) return "Không đủ xu để thuê phòng.";
  if (msg.includes("too far ahead")) return `Chỉ trả trước tối đa ${MOTEL_MAX_AHEAD_DAYS} ngày.`;
  if (msg.includes("no room")) return "Bạn chưa thuê phòng — ghé quầy cô Hồng nhé.";
  if (msg.includes("already slept")) return "Hôm nay bạn ngủ rồi — mai ngủ tiếp nhé!";
  if (msg.includes("fainted")) return "Bạn đang ngất, chờ hồi sinh…";
  return "Có lỗi, thử lại sau nhé.";
}

async function call(fn: string, args: Record<string, unknown>): Promise<MotelState> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const s = parseMotelState(data);
  if (!s) throw new Error("bad answer");
  return s;
}

export const motelState = (token: string) => call("motel_state", { p_session_token: token });
export const motelRent = (token: string, plan: MotelPlan) => call("motel_rent", { p_session_token: token, p_plan: plan });
export const motelSleep = (token: string) => call("motel_sleep", { p_session_token: token });
