import { togglesError } from "../farm/minigames";
import { rand32 } from "../fishing/reel";
import { minePos } from "../mining/game";

// v22 crafting minigames (0084), three 60 Hz integer sims on the server's seed. Each is mirrored statement for statement
// by a SQL replay in supabase/migrations/0084_craft_minigames.sql; tests/fixtures/craft-cases.json pins both
// (scripts/gen-craft-fixtures.ts). The result only moves an outcome inside the old bounds:
//  - brew  (bà Sáu's cauldron): keep the heat in the green band → potion quality 1–3 (+0 / +5 / +10 % effect).
//  - anvil (the anvil): strike when the glow peaks, 5 strikes → the server-rolled success chance ±10 pp.
//  - sort  (Máy chế biến, collecting): sort 12 grains into good / bad baskets → a 0 / 2 / 5 % bonus on the batch value.
// 0087: the server rolls each round itself and reveals it through mg_sync (lib/game/mglive.ts): the brew's drift 1 s
// ahead, the anvil's glow at a secret tick, each grain 1 s before it is in reach. The overlays build their rounds from
// those events (create*From / with*) and report scores replayed on them (*P); the seed functions stay as the fixtures'
// reference.

/* ---------------- brew ---------------- */

export const BREW = {
  ticks: 600,
  seg: 30,
  start: 200,
  fan: 7,
  cool: 4,
  half: 120,
  /** Toggles at most, and at most `rate` in any 60 ticks. */
  maxToggles: 120,
  rate: 10,
} as const;

/** [band centre, drift of segment 1 … 20] (public._brew_round): centre 400 + u mod 201, drift u mod 7 − 3. */
export function brewRound(seed: number): number[] {
  let st = seed >>> 0;
  let [u, next] = rand32(st);
  st = next;
  const out = [400 + (u % 201)];
  for (let i = 0; i < BREW.ticks / BREW.seg; i++) {
    [u, next] = rand32(st);
    st = next;
    out.push((u % 7) - 3);
  }
  return out;
}

/** One tick of the heat (public._brew_step). */
export const brewStep = (h: number, fanning: boolean, drift: number): number =>
  Math.min(1000, Math.max(0, h + (fanning ? BREW.fan : -BREW.cool) + drift));

/** Ticks in the band over the round, from the fan's press/release ticks (public._brew_replay). */
export function replayBrew(seed: number, toggles: readonly number[]): number {
  return replayBrewP(brewRound(seed), toggles);
}
/** The same from the round [centre, drift 1 … 20] (0087's _brew_replay_p). */
export function replayBrewP(rd: readonly number[], toggles: readonly number[]): number {
  let h: number = BREW.start, fan = false, k = 0, score = 0;
  for (let t = 0; t < BREW.ticks; t++) {
    if (k < toggles.length && toggles[k] === t) { fan = !fan; k++; }
    h = brewStep(h, fan, rd[1 + Math.floor(t / BREW.seg)]);
    if (Math.abs(h - rd[0]) <= BREW.half) score++;
  }
  return score;
}

export const brewInputError = (toggles: readonly number[]): string | null =>
  togglesError(toggles, BREW.ticks, BREW.ticks, BREW.maxToggles, BREW.rate);

/** Quality 1–3 from the score (public._brew_quality). */
export const brewQuality = (score: number): 1 | 2 | 3 => (score >= 420 ? 3 : score >= 270 ? 2 : 1);
/** The effect bonus in % of a quality (public._brew_bonus). */
export const BREW_BONUS = [0, 0, 5, 10] as const;
export const QUALITY_NAME = ["", "Thường", "Tốt", "Hoàn hảo"] as const;

export interface BrewRound { centre: number; drift: number[]; tick: number; heat: number; fan: boolean; score: number; toggles: number[]; done: boolean }
export function createBrew(seed: number): BrewRound {
  const rd = brewRound(seed);
  return { centre: rd[0], drift: rd.slice(1), tick: 0, heat: BREW.start, fan: false, score: 0, toggles: [], done: false };
}
/** 0087: a brew on the band's centre, its drift filled in as mg_sync reveals it (events 1–20: { drift }). */
export function createBrewFrom(centre: number): BrewRound {
  return { centre, drift: new Array<number>(BREW.ticks / BREW.seg).fill(0), tick: 0, heat: BREW.start, fan: false, score: 0, toggles: [], done: false };
}
export function withDrift(s: BrewRound, ev: Record<number, Record<string, number>>): BrewRound {
  let drift = s.drift;
  for (let i = 1; i <= drift.length; i++) {
    const d = ev[i]?.drift;
    if (d !== undefined && drift[i - 1] !== d) { if (drift === s.drift) drift = drift.slice(); drift[i - 1] = d; }
  }
  return drift === s.drift ? s : { ...s, drift };
}
/** Toggles allowed now (the server's rate rule). */
export function canToggle(s: BrewRound): boolean {
  const n = s.toggles.length;
  return !s.done && n < BREW.maxToggles && (n < BREW.rate || s.tick - s.toggles[n - BREW.rate] >= 60);
}
/** One tick with the fan wanted on/off (a change is dropped when the rate forbids it). */
export function stepBrew(s: BrewRound, want: boolean): BrewRound {
  if (s.done) return s;
  let { fan, toggles } = s;
  if (want !== fan && canToggle(s)) { fan = want; toggles = [...toggles, s.tick]; }
  const heat = brewStep(s.heat, fan, s.drift[Math.floor(s.tick / BREW.seg)]);
  const score = s.score + (Math.abs(heat - s.centre) <= BREW.half ? 1 : 0);
  const tick = s.tick + 1;
  return { ...s, fan, toggles, heat, score, tick, done: tick >= BREW.ticks };
}

/* ---------------- anvil ---------------- */

export const ANVIL = { strikes: 5, maxTicks: 1800, rate: 2, great: 880, good: 700, step: 20 } as const;

/** [period, phase] (public._anvil_round): period 50 + u mod 31, phase u mod period. */
export function anvilRound(seed: number): [number, number] {
  const [u1, st] = rand32(seed >>> 0);
  const period = 50 + (u1 % 31);
  const [u2] = rand32(st);
  return [period, u2 % period];
}
/** The glow at tick t, 0 … 1000 (peak) (public._anvil_glow). */
export const anvilGlow = (period: number, phase: number, t: number): number => minePos(period, t + phase);
/** Points of one strike: 2 great, 1 good, 0 miss. */
export const anvilPoints = (g: number): number => (g >= ANVIL.great ? 2 : g >= ANVIL.good ? 1 : 0);

export interface AnvilReplay { score: number; ticks: number; exact: number }
/** The strikes' score, the round's end tick and the strikes on the best tick (public._anvil_replay). */
export function replayAnvil(seed: number, strikes: readonly number[]): AnvilReplay {
  return replayAnvilP(anvilRound(seed), strikes);
}
/** The same from the round [period, phase] (0087's _anvil_replay_p, less its 'spread'). */
export function replayAnvilP(rd: readonly number[], strikes: readonly number[]): AnvilReplay {
  const [p, ph] = rd;
  const tol = 1000 - Math.ceil(2000 / p);
  let score = 0, exact = 0;
  for (const s of strikes) {
    const g = anvilGlow(p, ph, s);
    score += anvilPoints(g);
    if (g >= tol) exact++;
  }
  const ticks = strikes.length >= ANVIL.strikes ? strikes[ANVIL.strikes - 1] + 1 : ANVIL.maxTicks;
  return { score, ticks, exact };
}
export const anvilInputError = (strikes: readonly number[], ticks: number): string | null =>
  togglesError(strikes, ticks, ANVIL.maxTicks, ANVIL.strikes, ANVIL.rate);
/** The chance nudge in ‰: (score − 5) × 20, so −100 … +100 (public._anvil_nudge). */
export const anvilNudge = (score: number): number => (Math.max(0, Math.min(10, score)) - 5) * ANVIL.step;

export interface AnvilRound { period: number; phase: number; tick: number; strikes: number[]; score: number; last: number | null; done: boolean }
export function createAnvil(seed: number): AnvilRound {
  const [period, phase] = anvilRound(seed);
  return { period, phase, tick: 0, strikes: [], score: 0, last: null, done: false };
}
/** 0087: the anvil before its glow shows (period 0: nothing to strike at yet); withGlow once mg_sync revealed it. */
export function createAnvilWaiting(): AnvilRound {
  return { period: 0, phase: 0, tick: 0, strikes: [], score: 0, last: null, done: false };
}
export const withGlow = (s: AnvilRound, period: number, phase: number): AnvilRound => (s.period === period && s.phase === phase ? s : { ...s, period, phase });
export function canHammer(s: AnvilRound): boolean {
  const n = s.strikes.length;
  return !s.done && s.period > 0 && n < ANVIL.strikes && (n < ANVIL.rate || s.tick - s.strikes[n - ANVIL.rate] >= 60);
}
export function stepAnvil(s: AnvilRound, strike: boolean): AnvilRound {
  if (s.done) return s;
  if (strike && canHammer(s)) {
    const pts = anvilPoints(anvilGlow(s.period, s.phase, s.tick));
    const strikes = [...s.strikes, s.tick];
    return { ...s, strikes, score: s.score + pts, last: pts, tick: s.tick + 1, done: strikes.length >= ANVIL.strikes };
  }
  const tick = s.tick + 1;
  return { ...s, tick, done: tick >= ANVIL.maxTicks };
}

/* ---------------- sort ---------------- */

export const SORT = { items: 12, lead: 40, gap: 45, window: 40, maxInputs: 24, rate: 4 } as const;
export const SORT_TICKS = SORT.lead + SORT.items * SORT.gap; // 580

/** The 12 grains, 0 good / 1 bad (u mod 3 = 0) (public._sort_round). */
export function sortRound(seed: number): number[] {
  let st = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < SORT.items; i++) {
    const [u, next] = rand32(st);
    st = next;
    out.push(u % 3 === 0 ? 1 : 0);
  }
  return out;
}
export const sortArrive = (i: number): number => SORT.lead + i * SORT.gap;
/** The grain in reach at tick t, or −1. */
export function sortItemAt(t: number): number {
  if (t < SORT.lead) return -1;
  const i = Math.floor((t - SORT.lead) / SORT.gap);
  return i < SORT.items && t - sortArrive(i) < SORT.window ? i : -1;
}

export interface SortReplay { score: number; reactions: number[] }
/** Correct sorts: an input decides the grain in reach if it is still undecided (public._sort_replay). dir 0 = good
 *  basket (left), 1 = bad (right). */
export function replaySort(seed: number, ticks: readonly number[], dirs: readonly number[]): SortReplay {
  return replaySortP(sortRound(seed), ticks, dirs);
}
/** The same from the grains (0087's _sort_replay_p). */
export function replaySortP(kinds: readonly number[], ticks: readonly number[], dirs: readonly number[]): SortReplay {
  const done = new Array<boolean>(SORT.items).fill(false);
  let score = 0;
  const reactions: number[] = [];
  for (let k = 0; k < ticks.length; k++) {
    const i = sortItemAt(ticks[k]);
    if (i < 0 || done[i]) continue;
    done[i] = true;
    if (dirs[k] === kinds[i]) { score++; reactions.push(ticks[k] - sortArrive(i)); }
  }
  return { score, reactions };
}
export function sortInputError(ticks: readonly number[], dirs: readonly number[]): string | null {
  if (dirs.length !== ticks.length) return "shape";
  if (dirs.some((d) => d !== 0 && d !== 1)) return "dir";
  return togglesError(ticks, SORT_TICKS, SORT_TICKS, SORT.maxInputs, SORT.rate);
}
/** The bonus % of the batch value (public._sort_bonus; econ v2, 0102: 1 / 2 %, was 2 / 5 %). */
export const sortBonus = (score: number): number => (score >= 11 ? 2 : score >= 8 ? 1 : 0);

export interface SortRound { kinds: number[]; tick: number; ticks: number[]; dirs: number[]; decided: (boolean | null)[]; score: number; done: boolean }
export function createSort(seed: number): SortRound {
  return { kinds: sortRound(seed), tick: 0, ticks: [], dirs: [], decided: new Array(SORT.items).fill(null), score: 0, done: false };
}
/** 0087: the grains not revealed yet are −1 (mg_sync reveals each 1 s before it is in reach: events 1–12, { kind }). */
export function createSortFrom(): SortRound {
  return { kinds: new Array<number>(SORT.items).fill(-1), tick: 0, ticks: [], dirs: [], decided: new Array(SORT.items).fill(null), score: 0, done: false };
}
export function withKinds(s: SortRound, ev: Record<number, Record<string, number>>): SortRound {
  let kinds = s.kinds;
  for (let i = 1; i <= kinds.length; i++) {
    const k = ev[i]?.kind;
    if (k !== undefined && kinds[i - 1] !== k) { if (kinds === s.kinds) kinds = kinds.slice(); kinds[i - 1] = k; }
  }
  return kinds === s.kinds ? s : { ...s, kinds };
}
export function canSort(s: SortRound): boolean {
  const n = s.ticks.length;
  return !s.done && n < SORT.maxInputs && (n < SORT.rate || s.tick - s.ticks[n - SORT.rate] >= 60);
}
export function stepSort(s: SortRound, dir: 0 | 1 | null): SortRound {
  if (s.done) return s;
  let next = s;
  if (dir !== null && canSort(s)) {
    const i = sortItemAt(s.tick);
    const decided = s.decided.slice();
    let score = s.score;
    if (i >= 0 && decided[i] === null) {
      decided[i] = dir === s.kinds[i];
      if (decided[i]) score++;
    }
    next = { ...s, ticks: [...s.ticks, s.tick], dirs: [...s.dirs, dir], decided, score };
  }
  const tick = s.tick + 1;
  return { ...next, tick, done: tick >= SORT_TICKS };
}
