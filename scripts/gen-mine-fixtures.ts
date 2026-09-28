import { canStrike, createMineRound, MINE, mineRound, minePos, replayMine, stepMineRound, type MineReplay } from "@/lib/game/mining/game";
import { rand32 } from "@/lib/game/fishing/reel";

// Mỏ đá's dig fixtures (v21 #19): generated from lib/game/mining/game.ts, replayed by 0072's public._mine_replay in
// tests/sql/v21-crafting-smoke.sql. WRITE_MINE_FIXTURES=1 vitest tests/unit/mining.test.ts rewrites
// tests/fixtures/mine-cases.json.

export interface MineCase {
  name: string;
  seed: number;
  need: number;
  win: number;
  strikes: number[];
  expected: MineReplay & { round: number[] };
}

type Style = "sharp" | "sloppy" | "blind" | "late";

/** A player: strikes when the marker is in the vein (sharp), 1 tick in 3 of the time it is (sloppy), at fixed beats
 *  (blind), or not at all until the end (late). */
function play(seed: number, need: number, win: number, style: Style, noise: number): number[] {
  let s = createMineRound(seed, need, win);
  let rng = (noise >>> 0) || 1;
  while (s.outcome === "open" && s.tick < MINE.maxTicks) {
    const inVein = Math.abs(minePos(s.period, s.tick) - s.centres[s.hits]) <= win;
    let want = false;
    if (style === "sharp") want = inVein;
    else if (style === "sloppy") {
      const [u, n] = rand32(rng);
      rng = n;
      want = inVein ? u % 3 === 0 : u % 97 === 0;
    } else if (style === "blind") want = s.tick % 40 === 7;
    s = stepMineRound(s, want && canStrike(s));
  }
  return s.strikes;
}

export function buildMineCases(): MineCase[] {
  const out: MineCase[] = [];
  const styles: Style[] = ["sharp", "sloppy", "blind", "late"];
  let k = 0;
  for (const need of [2, 3, 4, 5]) {
    for (const win of [90, 130, 220]) {
      for (const style of styles) {
        const seed = (0x9e3779b1 * (++k + 7)) >>> 0;
        const strikes = style === "late" ? [] : play(seed, need, win, style, seed ^ 0x5bd1e995);
        out.push({ name: `${style}-n${need}-w${win}`, seed, need, win, strikes, expected: { ...replayMine(seed, need, win, strikes), round: mineRound(seed, need) } });
      }
    }
  }
  // edge seeds
  for (const seed of [0, 1, 4294967295]) {
    const strikes = play(seed, 3, 110, "sharp", 3);
    out.push({ name: `edge-${seed}`, seed, need: 3, win: 110, strikes, expected: { ...replayMine(seed, 3, 110, strikes), round: mineRound(seed, 3) } });
  }
  return out;
}
