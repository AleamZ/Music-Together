import { rand32 } from "@/lib/game/fishing/reel";
import { canStroke, createRow, replayRow, rowRound, stepRow, type RowReplay, type Side } from "@/lib/game/river/row";

// Chèo ghe's fixtures (v22, 0086): generated from lib/game/river/row.ts, replayed by 0086's public._row_replay in
// tests/sql/v22-explore-smoke.sql. WRITE_ROW_FIXTURES=1 vitest tests/unit/river.test.ts rewrites tests/fixtures/row-cases.json.

export interface RowCase {
  name: string;
  seed: number;
  need: number;
  strokes: number[];
  expected: RowReplay & { round: number[] };
}

type Style = "sharp" | "sloppy" | "wrong" | "masher" | "idle";

/** A rower: on every beat (sharp), off by a few ticks and missing some (sloppy), on the beat but the other side
 *  (wrong), both sides every 12 ticks (masher), or never (idle). */
function play(seed: number, need: number, style: Style, noise: number): number[] {
  let s = createRow(seed, need);
  let rng = (noise >>> 0) || 1;
  const offs = new Map<number, number>();
  while (s.outcome === "open") {
    let want: Side | null = null;
    const b = s.beat;
    if (b < s.beats.targets.length) {
      const target = s.beats.targets[b], side = s.beats.sides[b];
      if (style === "sharp" && s.tick === target) want = side;
      else if (style === "sloppy") {
        if (!offs.has(b)) {
          const [u, n] = rand32(rng);
          rng = n;
          offs.set(b, u % 4 === 0 ? 99 : (u % 15) - 7);
        }
        if (s.tick === target + offs.get(b)!) want = side;
      } else if (style === "wrong" && s.tick === target) want = (1 - side) as Side;
    }
    if (style === "masher" && s.tick % 12 === 5) want = ((s.tick / 12) & 1) as Side;
    s = stepRow(s, want !== null && canStroke(s) ? want : null);
  }
  return s.strokes;
}

export function buildRowCases(): RowCase[] {
  const out: RowCase[] = [];
  const styles: Style[] = ["sharp", "sloppy", "wrong", "masher", "idle"];
  let k = 0;
  for (const need of [6, 8]) {
    for (let rep = 0; rep < 3; rep++) {
      for (const style of styles) {
        const seed = (0x85ebca6b * (++k + 11)) >>> 0;
        const strokes = play(seed, need, style, seed ^ 0x27d4eb2d);
        const r = rowRound(seed);
        out.push({ name: `${style}-n${need}-${rep}`, seed, need, strokes, expected: { ...replayRow(seed, need, strokes), round: [...r.targets, ...r.sides] } });
      }
    }
  }
  for (const seed of [0, 1, 4294967295]) {
    const strokes = play(seed, 8, "sharp", 5);
    const r = rowRound(seed);
    out.push({ name: `edge-${seed}`, seed, need: 8, strokes, expected: { ...replayRow(seed, 8, strokes), round: [...r.targets, ...r.sides] } });
  }
  return out;
}
