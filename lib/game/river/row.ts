import { rand32 } from "../fishing/reel";

// Chèo ghe (v22, 0086): the rowing rhythm. Twelve beats come down two lanes (trái / phải); a stroke (← / →, A / D, or a
// tap on a lane) on the beat's side inside its window hits it. The sides alternate, except one beat in five repeats the
// last side. A 60 Hz integer sim on the server's seed: public._row_replay replays the strokes (tick * 2 + side) and
// decides; any change here must be mirrored there — tests/fixtures/row-cases.json pins both.

export const ROW = {
  hz: 60,
  beats: 12,
  /** The lead-in before beat 1 (the countdown). */
  lead: 90,
  /** A stroke hits within ± win ticks of its beat. */
  win: 11,
  /** Strays allowed in a pass. */
  maxStray: 6,
  maxStrokes: 40,
  maxTicks: 1200,
  /** At most 3 strokes in any `rateTicks`. */
  rateTicks: 12,
} as const;

export type Side = 0 | 1;
export interface RowBeats { targets: number[]; sides: Side[] }

/** The beats (public._row_round). */
export function rowRound(seed: number): RowBeats {
  let st = seed >>> 0;
  let t = 0;
  let side: Side = 0;
  const targets: number[] = [], sides: Side[] = [];
  for (let b = 0; b < ROW.beats; b++) {
    const [u, next] = rand32(st);
    st = next;
    if (b === 0) {
      t = ROW.lead;
      side = ((u >>> 8) & 1) as Side;
    } else {
      t += 34 + (u % 21);
      if ((u >>> 8) % 5 !== 0) side = (1 - side) as Side;
    }
    targets.push(t);
    sides.push(side);
  }
  return { targets, sides };
}

/** The row's length in ticks: the last beat's window + 1. */
export const rowEnd = (b: RowBeats): number => b.targets[ROW.beats - 1] + ROW.win + 1;

export const encodeStroke = (tick: number, side: Side): number => tick * 2 + side;

export interface RowReplay { outcome: "pass" | "fail"; ticks: number; hits: number; stray: number; exact: number }

/** The row from its strokes (public._row_replay). */
export function replayRow(seed: number, need: number, strokes: readonly number[]): RowReplay {
  const rd = rowRound(seed);
  let b = 0, hits = 0, stray = 0, exact = 0;
  for (const s of strokes) {
    const t = Math.floor(s / 2), sd = s % 2;
    while (b < ROW.beats && rd.targets[b] + ROW.win < t) b++;
    if (b < ROW.beats && Math.abs(t - rd.targets[b]) <= ROW.win && sd === rd.sides[b]) {
      if (Math.abs(t - rd.targets[b]) <= 1) exact++;
      hits++;
      b++;
    } else stray++;
  }
  return { outcome: hits >= need && stray <= ROW.maxStray ? "pass" : "fail", ticks: rowEnd(rd), hits, stray, exact };
}

/** Why a stroke list is one no row makes (public._row_input_error; null = fine). */
export function rowInputError(strokes: readonly number[], ticks: number): string | null {
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > ROW.maxTicks) return "ticks";
  if (strokes.length > ROW.maxStrokes) return "too_many";
  for (let i = 0; i < strokes.length; i++) {
    const s = strokes[i];
    if (!Number.isInteger(s) || s < 0 || s >= ticks * 2) return "range";
    if (i > 0 && s <= strokes[i - 1]) return "order";
    if (i >= 3 && Math.floor(s / 2) - Math.floor(strokes[i - 3] / 2) < ROW.rateTicks) return "rate";
  }
  return null;
}

/** A row in progress, stepped once per tick on the client. */
export interface RowState {
  beats: RowBeats;
  need: number;
  end: number;
  tick: number;
  /** The next beat not yet hit or passed. */
  beat: number;
  hits: number;
  stray: number;
  strokes: number[];
  /** Per beat: hit, missed (its window passed), or pending. */
  marks: Array<"hit" | "miss" | null>;
  /** The last stroke's mark and when (tick), for the feedback. */
  last: { kind: "hit" | "stray"; side: Side; at: number } | null;
  outcome: "pass" | "fail" | "open";
}

export function createRow(seed: number, need: number): RowState {
  const beats = rowRound(seed);
  return {
    beats, need, end: rowEnd(beats), tick: 0, beat: 0, hits: 0, stray: 0, strokes: [],
    marks: beats.targets.map(() => null), last: null, outcome: "open",
  };
}

/** May a stroke go in now (the server's rate and count rules)? */
export function canStroke(s: RowState): boolean {
  const n = s.strokes.length;
  return s.outcome === "open" && n < ROW.maxStrokes && (n < 3 || s.tick - Math.floor(s.strokes[n - 3] / 2) >= ROW.rateTicks);
}

/** One tick; `stroke` is a stroke at this tick (the caller checks canStroke). */
export function stepRow(s: RowState, stroke: Side | null): RowState {
  if (s.outcome !== "open") return s;
  let { beat, hits, stray, last } = s;
  const marks = s.marks.slice();
  const strokes = stroke === null ? s.strokes : [...s.strokes, encodeStroke(s.tick, stroke)];
  // beats whose window has passed (the replay does this at the next stroke; the display now)
  while (beat < ROW.beats && s.beats.targets[beat] + ROW.win < s.tick) {
    marks[beat] = "miss";
    beat++;
  }
  if (stroke !== null) {
    if (beat < ROW.beats && Math.abs(s.tick - s.beats.targets[beat]) <= ROW.win && stroke === s.beats.sides[beat]) {
      marks[beat] = "hit";
      beat++;
      hits++;
      last = { kind: "hit", side: stroke, at: s.tick };
    } else {
      stray++;
      last = { kind: "stray", side: stroke, at: s.tick };
    }
  }
  const tick = s.tick + 1;
  const outcome = tick >= s.end ? (hits >= s.need && stray <= ROW.maxStray ? "pass" : "fail") : "open";
  return { ...s, tick, beat, hits, stray, strokes, marks, last, outcome };
}
