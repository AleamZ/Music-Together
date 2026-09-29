import { togglesError } from "../farm/minigames";
import { rand32 } from "../fishing/reel";

// v22 "world" minigames (0083): the hunt (aim and release at a moving animal, lead it and mind the wind; a wolf or a
// bear at night charges — dodge it), the trap (pull the cord when the animal steps on the trap; a net sweep for birds
// and fireflies), the photo (frame and snap, zoom for a better shot, the best pose) and the combo strike of the bosses
// and the dungeon (rhythm arrows + a telegraphed slam to dodge). 60 Hz integer sims on the server's seed; the SQL
// replays them statement for statement (public._wg_*, 0083) — tests/fixtures/world-mg-cases.json pins both. The client
// sends only its input ticks; the server derives the outcome.
// 0087: the server rolls the round itself (the draws, one by one) and reveals it through mg_sync (lib/game/mglive.ts);
// the overlays build the parameters from those events (*From) and replay with the *P functions; the seed functions stay
// as the fixtures' reference.

export const WG = {
  hz: 60,
  /** Every wild round times out after this many ticks. */
  maxTicks: 900,
  /** Arrow flight (ticks) from the release to the landing. */
  flight: 20,
  /** A hunt hits when the landing is within this many ‰ of the animal. */
  hitWin: 70,
  /** Shots, dodges, snaps at most; shots/dodges/snaps are ≥ 60 ticks apart (rate 1). */
  shots: 3,
  dodges: 3,
  snaps: 3,
  zooms: 6,
  /** The dodge counts when pressed within [charge − dodgeWin, charge]. */
  dodgeWin: 24,
  /** Where the trap sits on the trail (‰). */
  trapAt: 500,
} as const;

export type WildGame = "hunt" | "trap" | "photo";

/** A triangle 0 → 1000 → 0 ‰ over `period` ticks (public._wg_tri). */
export function tri(period: number, t: number): number {
  const x = Math.floor(((t % period) * 2000) / period);
  return x <= 1000 ? x : 2000 - x;
}

/** n draws from the seed (public._wg_draws). */
export function draws(seed: number, n: number): number[] {
  let st = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [u, next] = rand32(st);
    st = next;
    out.push(u);
  }
  return out;
}

/** Species speed in % (the SQL's _wg_speed): the quick ones move faster in every game. */
export const speedOf = (species: string): number =>
  species === "bird" || species === "firefly" ? 150 : species === "deer" || species === "fox" ? 130 : 100;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** The server's success chance (%) for a skill score 0 … 1000 around the species' base (±20; 0 without a catch). */
export const skillChance = (base: number, score: number, caught: boolean): number =>
  caught ? clamp(base - 20 + Math.floor((score * 40) / 1000), 5, 95) : 0;

// ---------------------------------------------------------------- the hunt
export interface HuntParams { period: number; phase: number; wind: number; reticle: number; charge: number }
export function huntParams(seed: number, species: string): HuntParams {
  const u = draws(seed, 5);
  const period = Math.floor(((150 + (u[0] % 91)) * 100) / speedOf(species));
  return { period, phase: u[1] % period, wind: (u[2] % 121) - 60, reticle: 100 + (u[3] % 41), charge: 150 + (u[4] % 151) };
}
/** The animal across the clearing (100 … 900 ‰). */
export const huntAnimal = (p: HuntParams, t: number): number => 100 + Math.floor((tri(p.period, t + p.phase) * 8) / 10);
/** The aim, sweeping 0 … 1000 ‰. */
export const huntAim = (p: HuntParams, t: number): number => tri(p.reticle, t);

export type WildOutcome = "hit" | "miss" | "charged" | "caught" | "escaped" | "done" | "open";
export interface WildReplay { outcome: WildOutcome; ticks: number | null; score: number; used: number; dodged: boolean }

/** The dodge of the charge at tick c: a press in [c − dodgeWin, c]. */
const dodgedAt = (c: number, dodges: readonly number[]) => dodges.some((d) => d >= c - WG.dodgeWin && d <= c);

/** The hunt from its release ticks and dodge ticks (public._wg_hunt). A dangerous animal charges at `charge` unless
 *  dodged; an arrow still in flight then is lost. */
export function replayHunt(seed: number, species: string, danger: boolean, shots: readonly number[], dodges: readonly number[]): WildReplay {
  return replayHuntP(huntParams(seed, species), danger, shots, dodges);
}
/** The hunt from its parameters (0087's _wg_hunt_u). */
export function replayHuntP(p: HuntParams, danger: boolean, shots: readonly number[], dodges: readonly number[]): WildReplay {
  const dodged = !danger || dodgedAt(p.charge, dodges);
  const cend = dodged ? Infinity : p.charge;
  let used = 0;
  for (const s of shots) {
    if (s >= cend) break;
    used++;
    const land = s + WG.flight;
    if (land > cend) break;
    const err = Math.abs(huntAim(p, s) + p.wind - huntAnimal(p, land));
    if (err <= WG.hitWin) return { outcome: "hit", ticks: land + 1, score: 1000 - Math.floor((err * 600) / WG.hitWin), used, dodged: danger && dodged };
    if (used >= WG.shots) return { outcome: "miss", ticks: land + 1, score: 0, used, dodged: danger && dodged };
  }
  if (cend !== Infinity) return { outcome: "charged", ticks: cend + 1, score: 0, used, dodged: false };
  return { outcome: "open", ticks: null, score: 0, used, dodged: danger };
}

// ---------------------------------------------------------------- the trap
const TRAP_V = [-3, 0, 0, 4, 5, 6, 7, 8];
export interface TrapParams { segs: Array<{ len: number; v: number }>; tail: number; zone: number }
export function trapParams(seed: number, species: string): TrapParams {
  const mul = speedOf(species) >= 150 ? 3 : 2;
  const u = draws(seed, 16);
  const segs = [];
  for (let i = 0; i < 8; i++) segs.push({ len: 30 + (u[2 * i] % 41), v: Math.trunc((TRAP_V[u[2 * i + 1] % 8] * mul) / 2) });
  return { segs, tail: 3 * mul, zone: mul === 3 ? 60 : 40 };
}
/** The animal along the trail at every tick 0 … n (0 … 1000 ‰; 1000 = gone past). */
export function trapPath(p: TrapParams, n: number): number[] {
  const out = [0];
  let x = 0, seg = 0, left = p.segs[0].len;
  for (let t = 1; t <= n; t++) {
    while (seg < p.segs.length && left <= 0) { seg++; left = seg < p.segs.length ? p.segs[seg].len : 0; }
    const v = seg < p.segs.length ? p.segs[seg].v : p.tail;
    left--;
    x = clamp(x + v, 0, 1000);
    out.push(x);
  }
  return out;
}
/** The trap from its pull tick (public._wg_trap): at most one pull; the animal past the trail's end escapes. */
export function replayTrap(seed: number, species: string, pulls: readonly number[]): WildReplay {
  return replayTrapP(trapParams(seed, species), pulls);
}
/** The trap from its parameters (0087's _wg_trap_u). */
export function replayTrapP(p: TrapParams, pulls: readonly number[]): WildReplay {
  const path = trapPath(p, WG.maxTicks);
  const esc = path.indexOf(1000);
  const pull = pulls.length > 0 ? pulls[0] : null;
  if (pull !== null && (esc < 0 || pull < esc)) {
    const d = Math.abs(path[pull] - WG.trapAt);
    return d <= p.zone
      ? { outcome: "caught", ticks: pull + 1, score: 1000 - Math.floor((d * 600) / p.zone), used: 1, dodged: false }
      : { outcome: "miss", ticks: pull + 1, score: 0, used: 1, dodged: false };
  }
  if (esc >= 0) return { outcome: "escaped", ticks: esc + 1, score: 0, used: 0, dodged: false };
  return { outcome: "open", ticks: null, score: 0, used: 0, dodged: false };
}

// ---------------------------------------------------------------- the photo
export interface PhotoParams { period: number; phase: number; pose: number; poseAt: number }
export function photoParams(seed: number, species: string): PhotoParams {
  const u = draws(seed, 4);
  const period = Math.floor(((180 + (u[0] % 121)) * 100) / speedOf(species));
  const pose = 150 + (u[2] % 91);
  return { period, phase: u[1] % period, pose, poseAt: u[3] % pose };
}
export const photoX = (p: PhotoParams, t: number): number => tri(p.period, t + p.phase);
/** The animal looks at the camera for 30 ticks of every pose period. */
export const photoPose = (p: PhotoParams, t: number): boolean => (t + p.poseAt) % p.pose < 30;
export const zoomAt = (zooms: readonly number[], t: number): boolean => zooms.filter((z) => z <= t).length % 2 === 1;
/** One snap's score 0 … 1000. */
export function snapScore(p: PhotoParams, zooms: readonly number[], t: number): number {
  const zoom = zoomAt(zooms, t);
  const tol = zoom ? 180 : 360;
  const c = Math.abs(photoX(p, t) - 500);
  if (c > tol) return 0;
  const frame = 600 - Math.floor((c * 600) / tol);
  const pose = photoPose(p, t) ? (zoom ? 400 : 280) : 0;
  return Math.floor((frame * (zoom ? 100 : 70)) / 100) + pose;
}
/** The best of the snaps (public._wg_photo); the third snap ends the round. */
export function replayPhoto(seed: number, species: string, snaps: readonly number[], zooms: readonly number[]): WildReplay {
  return replayPhotoP(photoParams(seed, species), snaps, zooms);
}
/** The photo from its parameters (0087's _wg_photo_u). */
export function replayPhotoP(p: PhotoParams, snaps: readonly number[], zooms: readonly number[]): WildReplay {
  let best = 0, used = 0;
  for (const s of snaps) {
    used++;
    best = Math.max(best, snapScore(p, zooms, s));
    if (used >= WG.snaps) return { outcome: "done", ticks: s + 1, score: best, used, dodged: false };
  }
  return { outcome: "open", ticks: null, score: best, used, dodged: false };
}
/** A photo is kept from 250; a great one (≥ 700) earns the full photo XP. */
export const PHOTO_KEEP = 250;
export const PHOTO_GREAT = 700;

/** The replay of any wild game; `a` = shots | pulls | snaps, `b` = dodges | — | zoom toggles. */
export function replayWild(game: WildGame, seed: number, species: string, danger: boolean, a: readonly number[], b: readonly number[]): WildReplay {
  return game === "hunt" ? replayHunt(seed, species, danger, a, b) : game === "trap" ? replayTrap(seed, species, a) : replayPhoto(seed, species, a, b);
}

export type WildParams = HuntParams | TrapParams | PhotoParams;
/** The replay of any wild game from its parameters. */
export function replayWildP(game: WildGame, p: WildParams, danger: boolean, a: readonly number[], b: readonly number[]): WildReplay {
  return game === "hunt" ? replayHuntP(p as HuntParams, danger, a, b) : game === "trap" ? replayTrapP(p as TrapParams, a) : replayPhotoP(p as PhotoParams, a, b);
}

// ---------------------------------------------------------------- 0087: the parameters from mg_sync's events
type Ev = Record<number, Record<string, number>>;
/** The hunt once the animal showed (event 1: period, phase, wind; event 2: the charge, a dangerous animal only). The
 *  charge not yet revealed is far away. */
export function huntParamsFrom(reticle: number, ev: Ev): HuntParams | null {
  const g = ev[1];
  if (!g) return null;
  return { period: g.period, phase: g.phase, wind: g.wind, reticle, charge: ev[2]?.charge ?? 100_000 };
}
/** The trail: events 1–8 are the segments (len, v); one not revealed yet stands still (it is revealed 0.5 s early). */
export function trapParamsFrom(species: string, ev: Ev): TrapParams {
  const mul = speedOf(species) >= 150 ? 3 : 2;
  const segs = [];
  for (let i = 1; i <= 8; i++) segs.push(ev[i] ? { len: ev[i].len, v: ev[i].v } : { len: 100_000, v: 0 });
  return { segs, tail: 3 * mul, zone: mul === 3 ? 60 : 40 };
}
/** The photo once the animal showed (event 1). */
export function photoParamsFrom(ev: Ev): PhotoParams | null {
  const g = ev[1];
  return g ? { period: g.period, phase: g.phase, pose: g.pose, poseAt: g.pose_at } : null;
}
/** The combo so far: events 1–6 the arrows (beat, dir), 7 the slam; the ones not revealed yet are far away. */
export function comboParamsFrom(ev: Ev): ComboParams & { known: number } {
  const beats: number[] = [], dirs: Dir[] = [];
  let known = 0;
  for (let i = 1; i <= COMBO.arrows; i++) {
    if (ev[i]) { beats.push(ev[i].beat); dirs.push((ev[i].dir % 4) as Dir); known = i; }
    else { beats.push(100_000 + i * 100); dirs.push(0); }
  }
  const last = ev[COMBO.arrows]?.beat;
  return { beats, dirs, slam: ev[7]?.slam ?? 100_000, end: last === undefined ? 100_000 : last + COMBO.win + 1, known };
}

/** Why an input pair is one no round makes (public._wg_input_error; null = fine). */
export function wildInputError(game: WildGame, a: readonly number[], b: readonly number[], ticks: number): string | null {
  const maxA = game === "trap" ? 1 : game === "hunt" ? WG.shots : WG.snaps;
  const e = togglesError(a, ticks, WG.maxTicks, maxA, 1);
  if (e) return e;
  if (game === "trap") return b.length > 0 ? "too_many" : null;
  return game === "hunt" ? togglesError(b, ticks, WG.maxTicks, WG.dodges, 1) : togglesError(b, ticks, WG.maxTicks, WG.zooms, 2);
}

// ---------------------------------------------------------------- the combo strike (bosses and the dungeon)
export const COMBO = {
  arrows: 6,
  /** An arrow is judged within ± this many ticks of its beat; perfect within ± perfect. */
  win: 10,
  perfect: 3,
  /** The slam's dodge window [slam − dodgeWin, slam]; its warning shows from slam − warn. */
  dodgeWin: 20,
  warn: 50,
  maxKeys: 12,
  maxTicks: 900,
} as const;
export type Dir = 0 | 1 | 2 | 3;
export const DIR_KEYS = ["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"] as const;
export const DIR_ICON = ["⬆️", "➡️", "⬇️", "⬅️"] as const;

export interface ComboParams { beats: number[]; dirs: Dir[]; slam: number; end: number }
export function comboParams(seed: number): ComboParams {
  const u = draws(seed, 2 * COMBO.arrows + 1);
  const beats: number[] = [], dirs: Dir[] = [];
  let b = 90 + (u[0] % 31);
  for (let i = 0; i < COMBO.arrows; i++) {
    if (i > 0) b += 54 + (u[2 * i] % 19);
    beats.push(b);
    dirs.push((u[2 * i + 1] % 4) as Dir);
  }
  const k = 1 + (u[2 * COMBO.arrows] % 3);          // the slam falls between arrow k+1 and k+2 (0-based k, k+1)
  return { beats, dirs, slam: beats[k] + 27, end: beats[COMBO.arrows - 1] + COMBO.win + 1 };
}
export type Judge = "perfect" | "good" | "miss";
export interface ComboReplay { judges: Judge[]; streaks: number[]; perfect: number; good: number; best: number; dodged: boolean; exact: number }

/** Judge the key presses (tick·4 + dir) and dodges up to `ticks` (public._wg_combo). A press inside an unjudged arrow's
 *  window judges it (the right direction: perfect/good, a wrong one: miss); a press outside any window breaks the
 *  streak. `best` is the longest streak. */
export function replayCombo(seed: number, keys: readonly number[], dodges: readonly number[], ticks: number): ComboReplay {
  return replayComboP(comboParams(seed), keys, dodges, ticks);
}
/** The combo from its parameters (0087's _wg_combo_u). */
export function replayComboP(p: ComboParams, keys: readonly number[], dodges: readonly number[], ticks: number): ComboReplay {
  const judges: Judge[] = p.beats.map(() => "miss");
  const done = p.beats.map(() => false);
  const streaks = p.beats.map(() => 0);
  let streak = 0, best = 0, perfect = 0, good = 0, exact = 0;
  for (const k of keys) {
    const t = Math.floor(k / 4), dir = k % 4;
    if (t >= ticks) break;
    let i = -1;
    for (let j = 0; j < p.beats.length; j++) if (!done[j] && Math.abs(t - p.beats[j]) <= COMBO.win) { i = j; break; }
    if (i < 0) { streak = 0; continue; }
    done[i] = true;
    const dt = Math.abs(t - p.beats[i]);
    if (dir !== p.dirs[i]) { streak = 0; continue; }
    if (dt <= 1) exact++;
    if (dt <= COMBO.perfect) { judges[i] = "perfect"; perfect++; } else { judges[i] = "good"; good++; }
    streak++;
    streaks[i] = streak;
    best = Math.max(best, streak);
  }
  const dodged = p.slam >= ticks || dodges.some((d) => d >= p.slam - COMBO.dodgeWin && d <= p.slam && d < ticks);
  return { judges, streaks, perfect, good, best, dodged, exact };
}

/** Why a combo's inputs are ones no round makes (public._wg_combo_error). */
export function comboInputError(keys: readonly number[], dodges: readonly number[], ticks: number): string | null {
  if (keys.some((k) => !Number.isInteger(k) || k < 0)) return "range";
  const e = togglesError(keys.map((k) => Math.floor(k / 4)), ticks, COMBO.maxTicks, COMBO.maxKeys, 2);
  return e ?? togglesError(dodges, ticks, COMBO.maxTicks, WG.dodges, 1);
}
