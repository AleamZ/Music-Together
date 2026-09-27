// v18.9 Ô và ướt sũng + sét đánh (spec §18.9). The same rules as 0038_rain.sql, which is authoritative
// (tests/unit/rain.test.ts pins the constants against it): the client only shows the state the server returned, slows
// my walk while cảm lạnh, and draws the umbrella, the wet, the cold and the lightning.

export type UmbrellaKind = "o_giay" | "o_vai" | "o_gap";

export interface UmbrellaSpec { kind: UmbrellaKind; name: string; price: number; minutes: number; blurb: string }

/** The umbrellas sold by chú Tư, anh Hai, cô Sáu and cô Chín's stall (`_umbrella_price`, `_umbrella_life_s`). */
export const UMBRELLAS: readonly UmbrellaSpec[] = [
  { kind: "o_giay", name: "Ô giấy", price: 300, minutes: 30, blurb: "Rẻ, nhẹ, che được một cơn mưa ngắn." },
  { kind: "o_vai", name: "Ô vải", price: 800, minutes: 90, blurb: "Vải dù chắc tay, đi chợ cả buổi." },
  { kind: "o_gap", name: "Ô gập cao cấp", price: 2000, minutes: 240, blurb: "Khung thép, gập gọn, bền bỉ mùa mưa." },
];
export const UMBRELLA_KINDS: readonly UmbrellaKind[] = UMBRELLAS.map((u) => u.kind);
export const MAX_UMBRELLAS = 6;
/** A storm wears an umbrella this many times faster. */
export const STORM_WEAR = 3;
/** The weather kinds it rains in. */
export const RAINY_KINDS: readonly string[] = ["rain", "thunder", "storm"];
/** Wet this long in a row → hunger drains WET_HUNGER_MULT times faster. */
export const WET_HUNGRY_S = 300;
export const WET_HUNGER_MULT = 24;
/** Out of the rain this long → dry. */
export const DRY_S = 120;
/** Cảm lạnh lasts this long (or until a hot dish), slows the walk and takes some bites. */
export const COLD_MS = 30 * 60_000;
export const COLD_SPEED = 0.5;
export const COLD_NO_BITE = 0.3;
/** Wet this long more while cảm lạnh → the faint. */
export const COLD_FAINT_WET_S = 300;
/** The restaurant's hot dishes that cure cảm lạnh. */
export const HOT_DISHES: readonly string[] = ["pho_bo", "bun_bo", "canh_chua"];
/** Lightning: 1 % a minute outdoors in the rain; then this long of cooldown. */
export const STRIKE_PER_MIN = 0.01;
export const STRIKE_COOLDOWN_MS = 30 * 60_000;
/** The bolt plays this long on the struck player before the faint takes them to the hall. */
export const STRIKE_MS = 1200;

export const umbrellaSpec = (k: UmbrellaKind): UmbrellaSpec => UMBRELLAS.find((u) => u.kind === k)!;
export const isUmbrellaKind = (v: unknown): v is UmbrellaKind => typeof v === "string" && (UMBRELLA_KINDS as readonly string[]).includes(v);
export const isRainy = (kind: string | null | undefined): boolean => !!kind && RAINY_KINDS.includes(kind);

/** The chance of a strike over `dtSec` credited seconds. Mirrors `_strike_chance`. */
export function strikeChance(dtSec: number): number {
  return 1 - Math.pow(1 - STRIKE_PER_MIN, Math.max(0, dtSec) / 60);
}

export interface Umbrella { id: number; kind: UmbrellaKind; leftS: number; held: boolean }

export interface RainState {
  wet: boolean;
  wetS: number;
  drying: boolean;
  coldUntilMs: number | null;
  struckAtMs: number | null;
  brokeAtMs: number | null;
  /** This heartbeat found me in the rain without a working umbrella (null: not from a heartbeat). */
  exposed: boolean | null;
  umbrellas: Umbrella[];
  serverNowMs: number;
}

/** The server's _rain_json → RainState (null when malformed). */
export function parseRain(raw: unknown): RainState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const now = n(r.server_now_ms);
  if (now === null || typeof r.wet !== "boolean" || !Array.isArray(r.umbrellas)) return null;
  const umbrellas: Umbrella[] = [];
  for (const u of r.umbrellas as unknown[]) {
    if (!u || typeof u !== "object") continue;
    const o = u as Record<string, unknown>;
    const id = n(o.id), left = n(o.left_s);
    if (id === null || left === null || !isUmbrellaKind(o.kind)) continue;
    umbrellas.push({ id, kind: o.kind, leftS: left, held: o.held === true });
  }
  return {
    wet: r.wet, wetS: n(r.wet_s) ?? 0, drying: r.drying === true,
    coldUntilMs: n(r.cold_until_ms), struckAtMs: n(r.struck_at_ms), brokeAtMs: n(r.broke_at_ms),
    exposed: typeof r.exposed === "boolean" ? r.exposed : null,
    umbrellas, serverNowMs: now,
  };
}

export const heldUmbrella = (s: RainState | null): Umbrella | null => s?.umbrellas.find((u) => u.held) ?? null;
export const isCold = (s: RainState | null, nowMs: number): boolean => s?.coldUntilMs != null && s.coldUntilMs > nowMs;

/** "m:ss" for a positive number of ms (rounded up). */
function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Minutes of rain left on an umbrella, for its label. */
export const leftText = (leftS: number): string => `${Math.max(0, Math.ceil(leftS / 60))} phút mưa`;

export type RainChipKey = "wet" | "cold" | "umbrella";

/** The HUD chips at server time `nowMs`; `raining` shows the held umbrella's minutes left. */
export function rainChips(s: RainState | null, nowMs: number, raining: boolean): Array<{ key: RainChipKey; text: string; title: string }> {
  if (!s) return [];
  const out: Array<{ key: RainChipKey; text: string; title: string }> = [];
  if (s.wet) {
    out.push({
      key: "wet", text: s.drying ? "💧 Đang khô" : "💦 Ướt sũng",
      title: s.drying ? "Đang khô dần — 2 phút nữa là khô ráo." : "Mắc mưa không ô! Ướt lâu sẽ đói nhanh rồi cảm lạnh.",
    });
  }
  if (isCold(s, nowMs)) {
    out.push({ key: "cold", text: `🤧 Cảm lạnh ${mmss(s.coldUntilMs! - nowMs)}`, title: "Đi chậm, câu ít cắn. Ăn phở, bún bò hay canh chua ở nhà hàng cho mau khỏi." });
  }
  const u = heldUmbrella(s);
  if (u && raining) out.push({ key: "umbrella", text: `☂️ ${leftText(u.leftS)}`, title: `${umbrellaSpec(u.kind).name} đang che mưa cho bạn.` });
  return out;
}

/** The `rn` presence bits: 1 wet, 2 cảm lạnh, 4·k the umbrella held open (k: 1 giấy, 2 vải, 3 gập), 16 struck by lightning. */
export const RN = { wet: 1, cold: 2, umbrellaShift: 2, umbrellaMask: 12, struck: 16 } as const;
export const isRainBits = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 31;

export interface RainLook { wet: boolean; cold: boolean; umbrella: UmbrellaKind | null; struck: boolean }
export const DRY_LOOK: RainLook = { wet: false, cold: false, umbrella: null, struck: false };

export function encodeRain(l: RainLook): number {
  const k = l.umbrella ? UMBRELLA_KINDS.indexOf(l.umbrella) + 1 : 0;
  return (l.wet ? RN.wet : 0) | (l.cold ? RN.cold : 0) | (k << RN.umbrellaShift) | (l.struck ? RN.struck : 0);
}

export function decodeRain(bits: number | undefined): RainLook {
  if (!bits) return DRY_LOOK;
  const k = (bits & RN.umbrellaMask) >> RN.umbrellaShift;
  return { wet: (bits & RN.wet) !== 0, cold: (bits & RN.cold) !== 0, umbrella: k > 0 ? UMBRELLA_KINDS[k - 1] : null, struck: (bits & RN.struck) !== 0 };
}

/** The text of an umbrella RPC refusal. */
export function rainErrorMessage(err: unknown): string {
  const msg = err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";
  if (msg.includes("insufficient funds")) return "Không đủ xu mua ô rồi.";
  if (msg.includes("too many umbrellas")) return `Bạn đã có ${MAX_UMBRELLAS} cây ô — đủ che cả nhà rồi!`;
  if (msg.includes("umbrella not found")) return "Không thấy cây ô đó.";
  return "Không làm được, thử lại sau nhé.";
}
