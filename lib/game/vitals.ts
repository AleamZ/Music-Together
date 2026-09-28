// Hunger and thirst (v18.3, spec §18.3): the same rules as 0025_vitals.sql, which is authoritative. The client
// uses them only to show the bars and to apply the speed factor of the state the server returned.

export const HUNGER_PER_S = 100 / 86400; // 0 after 24 h online
export const THIRST_PER_S = 100 / 57600; // 0 after 16 h online
/** 0057: the real seconds of a gap are drained, up to 30 min (a longer gap is a logout); was 120 s per heartbeat. */
export const TICK_CAP_S = 1800;
export const STARVE_FAINT_S = 600;
export const FAINT_MS = 10000;
export const REVIVE_VALUE = 30;
export const LOW_WARN = 25;
export const STARVING_SPEED = 0.6;
export const TICK_EVERY_MS = 30000;

export interface Vitals { hunger: number; thirst: number; starveS: number; faintedUntil: number | null }

/** Seconds of `dt` spent at 0 for a value `v` draining at `rate`. */
function zeroPart(v: number, rate: number, dt: number): number {
  if (v <= 0) return dt;
  return Math.max(0, dt - v / rate);
}

/** One heartbeat: `dtSec` seconds since the last (capped at TICK_CAP_S); no drain while fainted. */
export function drainVitals(v: Vitals, dtSec: number): Vitals {
  if (v.faintedUntil !== null) return v;
  const dt = Math.min(TICK_CAP_S, Math.max(0, dtSec));
  if (dt === 0) return v;
  const hunger = Math.max(0, v.hunger - dt * HUNGER_PER_S);
  const thirst = Math.max(0, v.thirst - dt * THIRST_PER_S);
  const zero = Math.max(zeroPart(v.hunger, HUNGER_PER_S, dt), zeroPart(v.thirst, THIRST_PER_S, dt));
  const starveS = hunger > 0 && thirst > 0 ? 0 : v.starveS + zero;
  return { hunger, thirst, starveS, faintedUntil: null };
}

export const isStarving = (v: Pick<Vitals, "hunger" | "thirst">): boolean => v.hunger <= 0 || v.thirst <= 0;
export const speedFactor = (v: Pick<Vitals, "hunger" | "thirst">): number => (isStarving(v) ? STARVING_SPEED : 1);
/** Why I fainted, for the faint screen: the server only says "fainted", so the client tells the causes apart. */
export type FaintCause = "lightning" | "drown" | "cold" | "starve";
export const FAINT_TEXT: Readonly<Record<FaintCause, string>> = {
  lightning: "⚡ Bạn bị sét đánh ngất xỉu",
  drown: "🌊 Bạn bị đuối nước",
  cold: "🤧 Bạn ngất vì cảm lạnh dầm mưa",
  starve: "😵 Bạn đã ngất vì quá đói / khát",
};
/** A lightning strike in the last minute wins, then a cramp seen in the last minute (the drowning), then being cold
 *  and wet, else hunger or thirst. */
export function faintCause(o: { struckAgoMs: number; crampAgoMs: number; cold: boolean; wet: boolean }): FaintCause {
  if (o.struckAgoMs < 60000) return "lightning";
  if (o.crampAgoMs < 60000) return "drown";
  if (o.cold && o.wet) return "cold";
  return "starve";
}

/** The faint ladder (0045_faint_ladder.sql, authoritative): per Vietnam day the Nth faint lasts 10 s, 5 min, 15 min,
 *  1 h; the EXHAUST_AT-th lasts until VN midnight and locks game mode. */
export const FAINT_LADDER_MS: readonly number[] = [10_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
export const EXHAUST_AT = 5;
export const EXHAUSTED_TEXT = "Bạn đã kiệt sức 5 lần hôm nay — nghỉ ngơi, mai quay lại nhé. Vẫn nghe nhạc được.";
/** How long the Nth faint of the day lasts (null: until midnight). */
export const faintLadderMs = (n: number): number | null => (n >= EXHAUST_AT ? null : FAINT_LADDER_MS[Math.max(1, n) - 1]);
/** "10 giây" / "5 phút" / "1 giờ" / "cả ngày". */
export function ladderText(ms: number | null): string {
  if (ms === null) return "kiệt sức cả ngày";
  if (ms < 60_000) return `${Math.round(ms / 1000)} giây`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} phút`;
  return `${Math.round(ms / 3_600_000)} giờ`;
}
/** A countdown: "8" (seconds) under a minute, else "m:ss", else "h:mm:ss". */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} giây`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

export const lowWarn =(v: Pick<Vitals, "hunger" | "thirst">) => ({ hunger: v.hunger < LOW_WARN, thirst: v.thirst < LOW_WARN });
