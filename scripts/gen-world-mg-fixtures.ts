import {
  WG, comboParams, huntAim, huntAnimal, huntParams, photoParams, photoPose, photoX, replayCombo, replayWild,
  trapParams, trapPath, type ComboReplay, type WildGame, type WildReplay,
} from "@/lib/game/realm/minigames";
import { rand32 } from "@/lib/game/fishing/reel";

// The world minigames' fixtures (v22, 0083): generated from lib/game/realm/minigames.ts, replayed by public._wg_hunt /
// _wg_trap / _wg_photo / _wg_combo in tests/sql/v22-world-smoke.sql. WRITE_WORLD_MG_FIXTURES=1 vitest
// tests/unit/world-minigames.test.ts rewrites tests/fixtures/world-mg-cases.json.

export interface WildCase { name: string; game: WildGame; seed: number; species: string; danger: boolean; a: number[]; b: number[]; expected: WildReplay }
export interface ComboCase { name: string; seed: number; keys: number[]; dodges: number[]; ticks: number; expected: ComboReplay & { slam: number; end: number } }

/** A hunter: releases when the predicted landing is near the animal (sharp) or at random ticks (blind); dodges the
 *  charge (or not). */
function hunt(seed: number, species: string, sharp: boolean, dodge: boolean): { a: number[]; b: number[] } {
  const p = huntParams(seed, species);
  const a: number[] = [];
  const b = dodge ? [p.charge - 5] : [];
  let st = (seed ^ 0x5bd1e995) >>> 0;
  for (let t = 0; t < WG.maxTicks && a.length < WG.shots; t++) {
    if (a.length > 0 && t - a[a.length - 1] < 60) continue;
    const err = Math.abs(huntAim(p, t) + p.wind - huntAnimal(p, t + WG.flight));
    let want: boolean;
    if (sharp) want = err <= 30;
    else {
      const [u, n] = rand32(st);
      st = n;
      want = u % 50 === 0;
    }
    if (want) a.push(t);
  }
  return { a, b };
}

function trap(seed: number, species: string, style: "sharp" | "early" | "none"): number[] {
  if (style === "none") return [];
  if (style === "early") return [40];
  const path = trapPath(trapParams(seed, species), WG.maxTicks);
  const t = path.findIndex((x) => Math.abs(x - WG.trapAt) <= 10);
  return t >= 0 ? [t] : [];
}

function photo(seed: number, species: string, zoom: boolean): { a: number[]; b: number[] } {
  const p = photoParams(seed, species);
  const a: number[] = [];
  for (let t = 20; t < WG.maxTicks && a.length < WG.snaps; t++) {
    if (a.length > 0 && t - a[a.length - 1] < 60) continue;
    if (Math.abs(photoX(p, t) - 500) < 100 && (photoPose(p, t) || t > 600)) a.push(t);
  }
  return { a, b: zoom ? [10] : [] };
}

function combo(seed: number, style: "sharp" | "sloppy" | "wrong" | "quit"): { keys: number[]; dodges: number[]; ticks: number } {
  const p = comboParams(seed);
  let st = (seed ^ 0x27d4eb2d) >>> 0;
  const keys: number[] = [];
  p.beats.forEach((b, i) => {
    const [u, n] = rand32(st);
    st = n;
    const off = style === "sharp" ? (u % 3) - 1 : (u % 17) - 8;
    const dir = style === "wrong" && i % 2 === 1 ? (p.dirs[i] + 1) % 4 : p.dirs[i];
    keys.push((b + off) * 4 + dir);
  });
  const ticks = style === "quit" ? p.beats[2] + 2 : p.end;
  const dodges = style === "sloppy" ? [] : [p.slam - 6];
  return { keys: keys.filter((k) => Math.floor(k / 4) < ticks), dodges: dodges.filter((d) => d < ticks), ticks };
}

export function buildWorldMgCases(): { wild: WildCase[]; combo: ComboCase[] } {
  const wild: WildCase[] = [];
  const combos: ComboCase[] = [];
  let k = 0;
  const seedOf = () => (0x9e3779b1 * (++k + 11)) >>> 0;
  const styles = [[true, false, false], [false, false, false], [true, true, true], [false, true, false], [false, true, true]] as const;
  for (const species of ["rabbit", "bird", "deer", "wolf", "bear"]) {
    for (const [sharp, danger, dodge] of styles) {
      const seed = seedOf();
      const { a, b } = hunt(seed, species, sharp, dodge);
      wild.push({ name: `hunt-${species}-${sharp ? "sharp" : "blind"}${danger ? (dodge ? "-dodge" : "-nododge") : ""}`, game: "hunt", seed, species, danger, a, b,
        expected: replayWild("hunt", seed, species, danger, a, b) });
    }
  }
  for (const species of ["rabbit", "bird", "fox", "firefly"]) {
    for (const style of ["sharp", "early", "none"] as const) {
      const seed = seedOf();
      const a = trap(seed, species, style);
      wild.push({ name: `trap-${species}-${style}`, game: "trap", seed, species, danger: false, a, b: [], expected: replayWild("trap", seed, species, false, a, []) });
    }
  }
  for (const species of ["rabbit", "bird", "deer", "bear"]) {
    for (const zoom of [false, true]) {
      const seed = seedOf();
      const { a, b } = photo(seed, species, zoom);
      wild.push({ name: `photo-${species}-${zoom ? "zoom" : "wide"}`, game: "photo", seed, species, danger: false, a, b, expected: replayWild("photo", seed, species, false, a, b) });
    }
  }
  const comboCase = (name: string, seed: number, style: "sharp" | "sloppy" | "wrong" | "quit") => {
    const { keys, dodges, ticks } = combo(seed, style);
    const p = comboParams(seed);
    combos.push({ name, seed, keys, dodges, ticks, expected: { ...replayCombo(seed, keys, dodges, ticks), slam: p.slam, end: p.end } });
  };
  for (const style of ["sharp", "sloppy", "wrong", "quit"] as const) for (let i = 0; i < 4; i++) comboCase(`combo-${style}-${i}`, seedOf(), style);
  for (const seed of [0, 1, 4294967295]) comboCase(`combo-edge-${seed}`, seed, "sharp");
  return { wild, combo: combos };
}
