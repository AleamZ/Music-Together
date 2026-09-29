import {
  anvilGlow, anvilRound, brewRound, canHammer, canSort, createAnvil, createBrew, createSort, replayAnvil,
  replayBrew, replaySort, sortItemAt, sortRound, stepAnvil, stepBrew, stepSort, type AnvilReplay, type SortReplay,
} from "@/lib/game/craftmg/games";
import { rand32 } from "@/lib/game/fishing/reel";

// v22 crafting minigame fixtures (0084): generated from lib/game/craftmg/games.ts, replayed by 0084's SQL in
// tests/sql/v22-crafting-smoke.sql. WRITE_CRAFT_FIXTURES=1 vitest tests/unit/craftmg.test.ts rewrites
// tests/fixtures/craft-cases.json.

export interface BrewCase { name: string; seed: number; toggles: number[]; expected: { score: number; round: number[] } }
export interface AnvilCase { name: string; seed: number; strikes: number[]; expected: AnvilReplay & { round: [number, number] } }
export interface SortCase { name: string; seed: number; ticks: number[]; dirs: number[]; expected: SortReplay & { round: number[] } }
export interface CraftCases { brew: BrewCase[]; anvil: AnvilCase[]; sort: SortCase[] }

type Style = "sharp" | "sloppy" | "idle";

function noise(st: number): [number, number] {
  return rand32(st);
}

function playBrew(seed: number, style: Style): number[] {
  let s = createBrew(seed);
  let rng = (seed ^ 0x5bd1e995) >>> 0 || 1;
  while (!s.done) {
    let want = false;
    if (style === "sharp") want = s.heat < s.centre - 40 ? true : s.heat > s.centre + 40 ? false : s.fan;
    else if (style === "sloppy") {
      const [u, n] = noise(rng);
      rng = n;
      want = u % 5 === 0 ? !s.fan : s.heat < s.centre - 60 ? true : s.heat > s.centre + 60 ? false : s.fan;
    }
    s = stepBrew(s, want);
  }
  return s.toggles;
}

function playAnvil(seed: number, style: Style): number[] {
  let s = createAnvil(seed);
  let rng = (seed ^ 0x1b873593) >>> 0 || 1;
  while (!s.done) {
    const g = anvilGlow(s.period, s.phase, s.tick);
    let want = false;
    if (style === "sharp") want = g >= 960;
    else if (style === "sloppy") {
      const [u, n] = noise(rng);
      rng = n;
      want = g >= 600 && u % 9 === 0;
    }
    s = stepAnvil(s, want && canHammer(s));
  }
  return s.strikes;
}

function playSort(seed: number, style: Style): { ticks: number[]; dirs: number[] } {
  let s = createSort(seed);
  let rng = (seed ^ 0xcc9e2d51) >>> 0 || 1;
  while (!s.done) {
    const i = sortItemAt(s.tick);
    let dir: 0 | 1 | null = null;
    if (i >= 0 && s.decided[i] === null) {
      const [u, n] = noise(rng);
      rng = n;
      if (style === "sharp" && s.tick % 45 === 50 % 45) dir = s.kinds[i] as 0 | 1;
      else if (style === "sloppy" && u % 11 === 0) dir = (u % 4 === 0 ? 1 - s.kinds[i] : s.kinds[i]) as 0 | 1;
    }
    s = stepSort(s, dir !== null && canSort(s) ? dir : null);
  }
  return { ticks: s.ticks, dirs: s.dirs };
}

export function buildCraftCases(): CraftCases {
  const styles: Style[] = ["sharp", "sloppy", "idle"];
  const out: CraftCases = { brew: [], anvil: [], sort: [] };
  let k = 0;
  for (let rep = 0; rep < 5; rep++) {
    for (const style of styles) {
      const seed = (0x9e3779b1 * (++k + 11)) >>> 0;
      const toggles = playBrew(seed, style);
      out.brew.push({ name: `brew-${style}-${rep}`, seed, toggles, expected: { score: replayBrew(seed, toggles), round: brewRound(seed) } });
      const strikes = playAnvil(seed, style);
      out.anvil.push({ name: `anvil-${style}-${rep}`, seed, strikes, expected: { ...replayAnvil(seed, strikes), round: anvilRound(seed) } });
      const sp = playSort(seed, style);
      out.sort.push({ name: `sort-${style}-${rep}`, seed, ...sp, expected: { ...replaySort(seed, sp.ticks, sp.dirs), round: sortRound(seed) } });
    }
  }
  for (const seed of [0, 1, 4294967295]) {
    const toggles = playBrew(seed, "sharp");
    out.brew.push({ name: `brew-edge-${seed}`, seed, toggles, expected: { score: replayBrew(seed, toggles), round: brewRound(seed) } });
    const strikes = playAnvil(seed, "sharp");
    out.anvil.push({ name: `anvil-edge-${seed}`, seed, strikes, expected: { ...replayAnvil(seed, strikes), round: anvilRound(seed) } });
    const sp = playSort(seed, "sharp");
    out.sort.push({ name: `sort-edge-${seed}`, seed, ...sp, expected: { ...replaySort(seed, sp.ticks, sp.dirs), round: sortRound(seed) } });
  }
  // stray inputs: a toggle list that stops early, strikes off the peak, sorts outside any window
  out.brew.push({ name: "brew-hold", seed: 77, toggles: [0], expected: { score: replayBrew(77, [0]), round: brewRound(77) } });
  out.anvil.push({ name: "anvil-two", seed: 78, strikes: [5, 200], expected: { ...replayAnvil(78, [5, 200]), round: anvilRound(78) } });
  out.sort.push({ name: "sort-stray", seed: 79, ticks: [3, 41, 60, 85, 579], dirs: [0, 1, 0, 1, 1],
    expected: { ...replaySort(79, [3, 41, 60, 85, 579], [0, 1, 0, 1, 1]), round: sortRound(79) } });
  return out;
}
