import { togglesError } from "../farm/minigames";
import { rand32 } from "../fishing/reel";
import { minePos } from "../mining/game";

// v22 pets (0085): the care minigames and the battle's power press. 60 Hz integer sims on the server's seed; 0085's
// public._pcare_* / _ppress_* replay the client's inputs statement for statement (tests/fixtures/pet-care-cases.json
// pins both). The score only scales affection / XP inside today's amounts (care) or the damage within ±15 % (press).

export type CareKind = "feed" | "pat" | "play";

/** FEED — "hứng đồ ăn": 12 treats fall in 5 lanes; the bowl must sit in a treat's lane when it lands. */
export const FEED = { lanes: 5, foods: 12, first: 30, gap: 40, fall: 80, ticks: 551, maxInputs: 60, rate: 10 } as const;
/** PAT — "gãi đúng chỗ": 5 spots; the liked one changes every 100 ticks (after a 30-tick lead-in); hearts show it. */
export const RUB = { spots: 5, segs: 5, seg: 100, lead: 30, ticks: 530, maxInputs: 80, rate: 12, full: 400 } as const;
/** PLAY — "ném bóng": 8 throws, one every 100 ticks; jump (press) when the ball lands. */
export const FETCH = { throws: 8, first: 20, gap: 100, ticks: 820, maxInputs: 24, rate: 4 } as const;

export const CARE_TICKS: Record<CareKind, number> = { feed: FEED.ticks, pat: RUB.ticks, play: FETCH.ticks };
/** Today's amounts at a full score (0074's instant buttons gave exactly these). */
export const CARE_BASE: Record<CareKind, { affection: number; xp: number }> = {
  feed: { affection: 3, xp: 5 }, pat: { affection: 2, xp: 3 }, play: { affection: 5, xp: 10 },
};

/** A value v = tick × 8 + lane/zone (public._pcare_split). */
export const pack = (tick: number, v: number): number => tick * 8 + v;

// ---------------------------------------------------------------- the rounds

/** The lane (0–4) of each of the 12 treats (public._pcare_feed_lanes). */
export function feedLanes(seed: number): number[] {
  let st = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < FEED.foods; i++) {
    const [u, n] = rand32(st);
    st = n;
    out.push(u % FEED.lanes);
  }
  return out;
}
export const feedSpawn = (i: number): number => FEED.first + i * FEED.gap;
export const feedLand = (i: number): number => feedSpawn(i) + FEED.fall;

/** The liked spot (0–4) of each segment, never twice in a row (public._pcare_rub_likes). */
export function rubLikes(seed: number): number[] {
  let st = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < RUB.segs; i++) {
    const [u, n] = rand32(st);
    st = n;
    let x = u % RUB.spots;
    if (i > 0 && x === out[i - 1]) x = (x + 1) % RUB.spots;
    out.push(x);
  }
  return out;
}
export const rubSegStart = (k: number): number => RUB.lead + k * RUB.seg;

/** Each throw's flight in ticks, 45–85 (public._pcare_fetch_flights). */
export function fetchFlights(seed: number): number[] {
  let st = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < FETCH.throws; i++) {
    const [u, n] = rand32(st);
    st = n;
    out.push(45 + (u % 41));
  }
  return out;
}
export const fetchStart = (i: number): number => FETCH.first + i * FETCH.gap;

// ---------------------------------------------------------------- input rules

/** Why an input list is one no round makes (public._pcare_input_error; null = fine). */
export function careInputError(kind: CareKind, inputs: readonly number[], ticks: number): string | null {
  if (ticks !== CARE_TICKS[kind]) return "ticks";
  if (kind === "play") return togglesError(inputs, ticks, FETCH.ticks, FETCH.maxInputs, FETCH.rate);
  const hi = kind === "feed" ? FEED.lanes - 1 : RUB.spots;
  const at: number[] = [];
  for (const v of inputs) {
    if (!Number.isInteger(v) || v < 0) return "range";
    if (v % 8 > hi) return "value";
    at.push(Math.floor(v / 8));
  }
  const max = kind === "feed" ? FEED.maxInputs : RUB.maxInputs;
  const rate = kind === "feed" ? FEED.rate : RUB.rate;
  return togglesError(at, ticks, ticks, max, rate);
}

// ---------------------------------------------------------------- the replays

export interface CareResult {
  /** feed: treats caught 0–12; pat: ticks on the liked spot 0–500; play: points 0–16. */
  score: number;
  /** The score in ‰ of a full round. */
  permille: number;
  /** Inputs that no hand makes this fast (the soft timing statistic). */
  quick: number;
  /** A round a hand makes rarely: perfect and machine-quick (a soft flag). */
  suspicious: boolean;
}

/** FEED from its packed moves (the bowl starts in the middle lane; a move at tick t counts from tick t). */
export function replayFeed(seed: number, inputs: readonly number[]): CareResult {
  return replayFeedP(feedLanes(seed), inputs);
}
/** The same from the lanes (0087's _pcare_feed_p). */
export function replayFeedP(lanes: readonly number[], inputs: readonly number[]): CareResult {
  let bowl = 2, j = 0, caught = 0, quick = 0;
  for (let i = 0; i < FEED.foods; i++) {
    const land = feedLand(i);
    while (j < inputs.length && Math.floor(inputs[j] / 8) <= land) {
      bowl = inputs[j] % 8;
      j++;
    }
    if (bowl === lanes[i]) caught++;
  }
  for (const v of inputs) {
    const t = Math.floor(v / 8);
    if (t >= FEED.first) {
      const since = (t - FEED.first) % FEED.gap;
      if (since < 4 && t - since < FEED.first + FEED.foods * FEED.gap) quick++;
    }
  }
  const permille = Math.floor((caught * 1000) / FEED.foods);
  return { score: caught, permille, quick, suspicious: caught === FEED.foods && inputs.length >= 6 && quick * 10 >= inputs.length * 8 };
}

/** PAT from its packed zone changes (0 = the hand lifted, 1–5 = a spot). */
export function replayRub(seed: number, inputs: readonly number[]): CareResult {
  return replayRubP(rubLikes(seed), inputs);
}
/** The same from the liked spots (0087's _pcare_rub_p). */
export function replayRubP(likes: readonly number[], inputs: readonly number[]): CareResult {
  let zone = 0, j = 0, good = 0;
  for (let t = 0; t < RUB.ticks; t++) {
    while (j < inputs.length && Math.floor(inputs[j] / 8) <= t) {
      zone = inputs[j] % 8;
      j++;
    }
    if (t >= RUB.lead && zone === likes[Math.floor((t - RUB.lead) / RUB.seg)] + 1) good++;
  }
  let quick = 0;
  for (let k = 0; k < RUB.segs; k++) {
    const s = rubSegStart(k);
    if (inputs.some((v) => { const t = Math.floor(v / 8); return t >= s && t <= s + 3 && v % 8 === likes[k] + 1; })) quick++;
  }
  const permille = Math.min(1000, Math.floor((good * 1000) / RUB.full));
  return { score: good, permille, quick, suspicious: quick >= 4 };
}

/** PLAY from its press ticks: each throw takes the first press in its 100 ticks; ≤ 6 ticks off 2 points, ≤ 13 1. */
export function replayFetch(seed: number, presses: readonly number[]): CareResult {
  return replayFetchP(fetchFlights(seed), presses);
}
/** The same from the flights (0087's _pcare_fetch_p). */
export function replayFetchP(fl: readonly number[], presses: readonly number[]): CareResult {
  let pts = 0, exact = 0;
  for (let i = 0; i < FETCH.throws; i++) {
    const s = fetchStart(i);
    const p = presses.find((t) => t >= s && t < s + FETCH.gap);
    if (p === undefined) continue;
    const d = Math.abs(p - (s + fl[i]));
    pts += d <= 6 ? 2 : d <= 13 ? 1 : 0;
    if (d === 0) exact++;
  }
  const permille = Math.floor((pts * 1000) / (2 * FETCH.throws));
  return { score: pts, permille, quick: exact, suspicious: exact >= FETCH.throws };
}

/** 0087: a care round's parameters from mg_sync('care') — events 1… are { lane } (feed), { like } (pat), { flight }
 *  (play), each revealed 0.5 s before it shows; the ones not revealed yet are −1. */
export function careRoundFrom(kind: CareKind, ev: Record<number, Record<string, number>>): number[] {
  const n = kind === "feed" ? FEED.foods : kind === "pat" ? RUB.segs : FETCH.throws;
  const key = kind === "feed" ? "lane" : kind === "pat" ? "like" : "flight";
  return Array.from({ length: n }, (_, i) => ev[i + 1]?.[key] ?? -1);
}
export const careEvents = (kind: CareKind): number => (kind === "feed" ? FEED.foods : kind === "pat" ? RUB.segs : FETCH.throws);
export function replayCareP(kind: CareKind, round: readonly number[], inputs: readonly number[]): CareResult {
  return kind === "feed" ? replayFeedP(round, inputs) : kind === "pat" ? replayRubP(round, inputs) : replayFetchP(round, inputs);
}
export function replayCare(kind: CareKind, seed: number, inputs: readonly number[]): CareResult {
  return kind === "feed" ? replayFeed(seed, inputs) : kind === "pat" ? replayRub(seed, inputs) : replayFetch(seed, inputs);
}

/** base × (0.4 + 0.6 × permille / 1000), rounded half up in integers (public._pcare_gain). */
export const careGain = (base: number, permille: number): number => Math.floor((base * (400_000 + 600 * permille) + 500_000) / 1_000_000);

// ---------------------------------------------------------------- the battle's power press

export const PRESS = { maxTicks: 300, lo: 850, hi: 1150, span: 400 } as const;

/** [period 60–100 ticks, centre 200–800 ‰] of the power meter (public._ppress_round). */
export function pressRound(seed: number): [number, number] {
  const [u1, s1] = rand32(seed >>> 0);
  const [u2] = rand32(s1);
  return [60 + (u1 % 41), 200 + (u2 % 601)];
}
export const pressPos = minePos;

/** The damage factor in ‰ (850–1150) of a press at tick `press` (null: no press — 850) (public._ppress_power). */
export function pressPower(seed: number, press: number | null): number {
  if (press === null) return PRESS.lo;
  const [period, centre] = pressRound(seed);
  const d = Math.abs(minePos(period, press) - centre);
  return PRESS.hi - Math.floor((300 * Math.min(d, PRESS.span)) / PRESS.span);
}
/** Distance of a press from the sweet spot, ‰ (the soft timing statistic counts ≤ 3). */
export function pressOff(seed: number, press: number): number {
  const [period, centre] = pressRound(seed);
  return Math.abs(minePos(period, press) - centre);
}
export function pressInputError(press: number | null, ticks: number): string | null {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > PRESS.maxTicks) return "ticks";
  if (press !== null && (!Number.isInteger(press) || press < 0 || press >= ticks)) return "range";
  return null;
}
