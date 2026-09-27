// v18.10 Sốc nhiệt & bơi chủ động (spec §18.10). The same rules as 0033_heat_swim.sql, which is authoritative
// (tests/unit/heat.test.ts pins the constants): the client only shows the state the server returned.

/** Hot: a clear day at this temperature or more (°C). */
export const HEAT_TEMP_C = 35;
/** Continuously outdoors this long in the heat → heat-shocked. */
export const HEAT_OUTDOOR_S = 600;
/** Thirst drains this many times faster while heat-shocked. */
export const HEAT_THIRST_MULT = 2;
/** Leaving the water gives this long of immunity. */
export const IMMUNE_MS = 600_000;
/** The warm-up takes this long… */
export const WARM_MS = 10_000;
/** …and lasts this long. */
export const WARM_VALID_MS = 300_000;
/** A cramping swimmer drowns after this long unless rescued. */
export const CRAMP_MS = 10_000;
/** How near (px) a rescuer must stand to a cramping swimmer (a client check; the server has no positions). */
export const RESCUE_RANGE = 28;

/** Is the room hot (clear, day, ≥ 35 °C)? Mirrors `_heat_hot`. */
export function heatHot(kind: string | null | undefined, isDay: boolean | null | undefined, tempC: number | null | undefined): boolean {
  return kind === "clear" && isDay === true && typeof tempC === "number" && tempC >= HEAT_TEMP_C;
}

/** The chance of a cramp when jumping in: warmed up 0.5%, else 20%, hot or not (0044). Mirrors `_cramp_chance`;
 *  `shocked` is kept for the call sites and no longer changes the odds. */
export function crampChance(_shocked: boolean, warmed: boolean): number {
  return warmed ? 0.005 : 0.2;
}

export interface HeatState {
  shocked: boolean;
  outdoorS: number;
  immuneUntilMs: number | null;
  warmUntilMs: number | null;
  swimming: boolean;
  crampUntilMs: number | null;
  serverNowMs: number;
}

/** The server's _heat_json → HeatState (null when malformed). */
export function parseHeat(raw: unknown): HeatState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const now = n(r.server_now_ms);
  if (now === null || typeof r.shocked !== "boolean" || typeof r.swimming !== "boolean") return null;
  return {
    shocked: r.shocked, outdoorS: n(r.outdoor_s) ?? 0,
    immuneUntilMs: n(r.immune_until_ms), warmUntilMs: n(r.warm_until_ms),
    swimming: r.swimming, crampUntilMs: n(r.cramp_until_ms), serverNowMs: now,
  };
}

/** "m:ss" for a positive number of ms (rounded up to the second). */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The HUD chips for a state at server time `nowMs`. */
export function heatChips(h: HeatState | null, nowMs: number): Array<{ key: "shock" | "immune" | "warm"; text: string }> {
  if (!h) return [];
  const out: Array<{ key: "shock" | "immune" | "warm"; text: string }> = [];
  if (h.shocked) out.push({ key: "shock", text: "🥵 Sốc nhiệt" });
  if (h.immuneUntilMs !== null && h.immuneUntilMs > nowMs) out.push({ key: "immune", text: `🏊 Miễn nhiệt ${mmss(h.immuneUntilMs - nowMs)}` });
  if (h.warmUntilMs !== null && h.warmUntilMs > nowMs) out.push({ key: "warm", text: "🧘 Đã khởi động" });
  return out;
}

/** The `hx` presence bits (v18.10): 1 heat-shocked (red face), 2 warming up (stretch), 4 cramping (with `cr`). */
export const HX = { shocked: 1, warming: 2, cramp: 4 } as const;
export const isHeatBits = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 7;
export const isCrampLeft = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= CRAMP_MS;

/** The text of a heat RPC refusal (null: nothing to show). */
export function heatErrorMessage(err: unknown): string | null {
  const msg = err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";
  if (msg.includes("bad spot")) return "Phải đứng sát mép ao mới được.";
  if (msg.includes("warm up")) return "Khởi động chưa xong — làm lại nhé.";
  if (msg.includes("not cramping")) return "Bạn ấy đã ổn rồi.";
  if (msg.includes("cramp")) return "Đang chuột rút, không bơi vào bờ được!";
  if (msg.includes("not swimming")) return null;
  if (msg.includes("fainted")) return "Bạn đang ngất, chờ hồi sinh…";
  if (msg.includes("too hungry") || msg.includes("too thirsty")) return "Đói khát thế này mà nhảy ao gì nữa!";
  return "Không làm được, thử lại sau nhé.";
}
