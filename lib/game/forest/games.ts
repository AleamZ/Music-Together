// The chopping and cooking minigames' pure rules (0096 _chop_hits, _cook_score, statement for statement; the fixtures in
// tests/fixtures/forest-cases.json are replayed by tests/sql/forest-professions-smoke.sql). The round itself never
// leaves the server: mg_sync reveals its events a bounded time ahead (a beat 1 s, a cooking step 0.5 s), and the
// overlays only ever read those.

/** A beat is hit by a press within this many ticks (±180 ms at 60 Hz; ±220 ms with Mắt nhìn thớ gỗ). */
export const CHOP_WIN = 11;
export const CHOP_WIN_SKILL = 13;
/** The round ends this many ticks after the third beat. */
export const CHOP_TAIL = 45;
export const MAX_CHOP_PRESSES = 6;

export interface ChopPair { beat: number; press: number; off: number }

/** 0096 _chop_hits: beat by beat, the first unused press within ±win (beat / press are 1-based). */
export function chopHits(beats: readonly number[], win: number, presses: readonly number[]): { hits: number; pairs: ChopPair[] } {
  const used = presses.map(() => false);
  const pairs: ChopPair[] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < presses.length; j++) {
      if (!used[j] && Math.abs(presses[j] - beats[i]) <= win) {
        used[j] = true;
        pairs.push({ beat: i + 1, press: j + 1, off: presses[j] - beats[i] });
        break;
      }
    }
  }
  return { hits: pairs.length, pairs };
}

/** The strikes of a round: a hit strikes with the axe's power, a miss 1 (+1 once with Chặt đều tay). */
export const chopBlows = (hits: number, power: number, missBonus: boolean): number =>
  hits * power + (3 - hits) + (hits < 3 && missBonus ? 1 : 0);

/** A cooking step as mg_sync reveals it. kind 1 thái (p1, p2 the beats), 2 khuấy (p1 the hold), 3 canh lửa (p1 the
 *  period, p2 the phase, p3 the band's centre). */
export interface CookStepEv { kind: 1 | 2 | 3; start: number; end: number; p1: number; p2: number; p3: number }

export function parseStep(d: Record<string, number> | undefined): CookStepEv | null {
  if (!d || ![1, 2, 3].includes(d.kind)) return null;
  const n = (k: string) => (Number.isFinite(d[k]) ? d[k] : 0);
  return { kind: d.kind as 1 | 2 | 3, start: n("start"), end: n("end"), p1: n("p1"), p2: n("p2"), p3: n("p3") };
}

/** The heat 0…100…0 of a canh-lửa step at tick t (integer, as the SQL). */
export function heatAt(s: CookStepEv, t: number): number {
  const x = (((t - s.start) + s.p2) % s.p1 + s.p1) % s.p1;
  return 2 * x < s.p1 ? Math.floor((200 * x) / s.p1) : 200 - Math.floor((200 * x) / s.p1);
}

/** 0096 _cook_score: each step 0–100 from the presses (a) and releases (b) inside it; the dish = the steps' mean. */
export function cookScore(steps: readonly CookStepEv[], a: readonly number[], b: readonly number[]): { steps: number[]; score: number } {
  const out: number[] = [];
  let tot = 0;
  for (const s of steps) {
    let sc = 0;
    const inStep = (t: number) => t >= s.start && t < s.end;
    if (s.kind === 1) {
      for (const bt of [s.p1, s.p2]) {
        let best: number | null = null;
        for (const t of a) if (inStep(t)) best = Math.min(best ?? Math.abs(t - bt), Math.abs(t - bt));
        sc += Math.max(0, 100 - 4 * (best ?? 1000));
      }
      sc = Math.floor(sc / 2);
    } else if (s.kind === 2) {
      const p = a.find(inStep);
      const r = p === undefined ? undefined : b.find((t) => t > p && t <= s.end);
      if (p !== undefined && r !== undefined) sc = Math.max(0, 100 - 2 * Math.abs((r - p) - s.p1));
    } else {
      const p = a.find(inStep);
      if (p !== undefined) sc = Math.max(0, 100 - 3 * Math.abs(heatAt(s, p) - s.p3));
    }
    out.push(sc);
    tot += sc;
  }
  return { steps: out, score: steps.length > 0 ? Math.floor(tot / steps.length) : 0 };
}

/** Steps as the server stores them (6 params each), for the fixtures and the SQL replay. */
export const stepsToParams = (steps: readonly CookStepEv[]): number[] => steps.flatMap((s) => [s.kind, s.start, s.end, s.p1, s.p2, s.p3]);
