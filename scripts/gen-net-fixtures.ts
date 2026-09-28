// Builds tests/fixtures/net-cases.json from the TS net sim (lib/game/fishing/net.ts). Two kinds of case:
//   haul   — a school seed, the net's radius, the throw's input (press/release ticks, the aim in milli-px) and what
//            netHaulReplay gives (quality, landing tick, the shadows caught, hits, count);
//   arrows — an arrow seed, the haul's fish, the keys (tick·4 + code) and what netArrowReplay gives (mistakes, end tick).
// tests/unit/fishing-net-replay.test.ts checks the JSON equals this; tests/sql/anticheat-v2-net-smoke.sql replays every
// case through 0056's _net_haul_replay / _net_arrow_replay.
//
// Rewrite the JSON (after a sim change, with the SQL changed in the same commit):
//   WRITE_NET_FIXTURES=1 pnpm vitest run tests/unit/fishing-net-replay.test.ts

import {
  ARROWS, arrowAdvance, arrowGame, arrowPress, clampAimInt, netAimError, netArrowPlan, netArrowReplay, netHaulReplay, netSchool,
  netShadowsAt, type Arrow, type ArrowPlan, type HaulFish, type NetThrowInput,
} from "@/lib/game/fishing/net";
import { rand32 } from "@/lib/game/fishing/reel";

export type NetCase =
  | {
    kind: "haul"; name: string; seed: number; radiusPx: number; input: NetThrowInput;
    expected: { quality: number; landTick: number; caught: boolean[]; hits: number; count: number };
  }
  | {
    kind: "arrows"; name: string; seed: number; fish: HaulFish[]; plan: ArrowPlan; keys: number[];
    expected: { mistakes: number; ticks: number };
  };

function haul(name: string, seed: number, radiusPx: number, input: NetThrowInput): NetCase {
  const r = netHaulReplay(seed, radiusPx, input);
  return { kind: "haul", name, seed, radiusPx, input, expected: { quality: r.quality, landTick: r.landTick, caught: r.caught, hits: r.hits, count: r.count } };
}

/** The aim over the shadows' centroid at the landing tick (clamped the way the overlay clamps). */
function aimAtSchool(seed: number, release: number): { x: number; y: number } {
  const sh = netShadowsAt(netSchool(seed), release + 42);
  const cx = sh.reduce((a, s) => a + s.x, 0) / sh.length, cy = sh.reduce((a, s) => a + s.y, 0) / sh.length;
  return clampAimInt({ x: cx / 1000, y: cy / 1000 });
}

function buildHauls(): NetCase[] {
  const out: NetCase[] = [];
  // a full net: search seeds and release ticks for a tight school under a big net at full power
  let full = 0;
  for (let seed = 1; seed < 400 && full < 3; seed++) {
    const period = netSchool(seed).period;
    for (let release = 60; release <= 3000 && full < 3; release += 30) {
      const aim = aimAtSchool(seed, release);
      const input = { press: release - period / 2, release, aimX: aim.x, aimY: aim.y };
      if (netHaulReplay(seed, 36, input).count === 5) {
        out.push(haul(`full-${full}`, seed, 36, input));
        full++;
        break;
      }
    }
  }
  // the same throws with a small net and with a weak charge
  for (const c of out.slice(0, 3)) {
    if (c.kind !== "haul") continue;
    out.push(haul(`${c.name}-small-net`, c.seed, 24, c.input));
    out.push(haul(`${c.name}-weak`, c.seed, 36, { ...c.input, press: c.input.release - 9 }));
  }
  // assorted throws: seeds × release ticks × charges, aimed at the school or not
  let s = 20260928;
  const r = (): number => {
    const [u, next] = rand32(s);
    s = next;
    return u;
  };
  for (let i = 0; i < 16; i++) {
    const seed = r() >>> 1;
    const period = netSchool(seed).period;
    const charge = [period / 2, period / 2 - 3, 7, 0, period + 5, period * 3 + period / 2][i % 6];
    const release = charge + 20 + (r() % 3000);
    const aim = i % 3 === 2 ? clampAimInt({ x: 10 + (r() % 140), y: 10 + (r() % 60) }) : aimAtSchool(seed, release);
    out.push(haul(`mix-${i}`, seed, i % 2 ? 36 : 24, { press: release - charge, release, aimX: aim.x, aimY: aim.y }));
  }
  // the edges: a release at 0, at the last allowed tick, the aim at the range's rim
  out.push(haul("release-at-0", 5, 24, { press: 0, release: 0, aimX: 80_000, aimY: 40_000 }));
  const rim = clampAimInt({ x: 0, y: 0 });
  if (netAimError(rim.x, rim.y) === null) out.push(haul("aim-rim", 77, 36, { press: 3564, release: 3600, aimX: rim.x, aimY: rim.y }));
  return out;
}

/** A scripted player typing kéo lưới: `gap` ticks between keys, a wrong key before key `wrongAt` of each round (−1:
 *  never), and stopping after `stopAfter` keys (a time-out). Records only the keys the game takes. */
function play(seed: number, plan: ArrowPlan, opt: { gap: number; first: number; wrongAt: number; stopAfter: number }): number[] {
  let g = arrowGame(seed, plan);
  const keys: number[] = [];
  let t = opt.first, n = 0, roundSeen = -1, wrongDone = false;
  const press = (a: Arrow) => {
    const before = arrowAdvance(g, t);
    if (before.done) return;
    keys.push(t * 4 + ARROWS.indexOf(a));
    g = arrowPress(g, t, a);
  };
  while (!g.done && n < opt.stopAfter && t < 3000) {
    g = arrowAdvance(g, t);
    if (g.done) break;
    if (g.round !== roundSeen) {
      roundSeen = g.round;
      wrongDone = false;
    }
    if (!wrongDone && g.at === opt.wrongAt) {
      press(ARROWS[(ARROWS.indexOf(g.seq[g.at]) + 1) % 4]);
      wrongDone = true;
    } else press(g.seq[g.at]);
    n++;
    t += opt.gap;
  }
  return keys;
}

function buildArrows(): NetCase[] {
  const out: NetCase[] = [];
  const fishSets: HaulFish[][] = [
    [{ weightG: 300, rarity: 1 }],
    [{ weightG: 300, rarity: 1 }, { weightG: 820, rarity: 2 }],
    [{ weightG: 1500, rarity: 2 }, { weightG: 1500, rarity: 2 }, { weightG: 1500, rarity: 2 }, { weightG: 1500, rarity: 2 }, { weightG: 1500, rarity: 2 }],
    [{ weightG: 450, rarity: 1 }, { weightG: 600, rarity: 1 }, { weightG: 999, rarity: 2 }],
  ];
  const styles = [
    { name: "clean", gap: 11, first: 25, wrongAt: -1, stopAfter: 999 },
    { name: "fast", gap: 4, first: 12, wrongAt: -1, stopAfter: 999 },
    { name: "one-wrong", gap: 14, first: 30, wrongAt: 2, stopAfter: 999 },
    { name: "slow", gap: 70, first: 40, wrongAt: -1, stopAfter: 999 },
    { name: "gives-up", gap: 12, first: 20, wrongAt: -1, stopAfter: 5 },
    { name: "sloppy", gap: 9, first: 18, wrongAt: 0, stopAfter: 999 },
  ];
  let seed = 1234567;
  for (let i = 0; i < fishSets.length; i++) {
    for (const st of styles) {
      seed = rand32(seed)[0] >>> 1;
      const fish = fishSets[i];
      const plan = netArrowPlan(fish);
      const keys = play(seed, plan, st);
      const r = netArrowReplay(seed, plan, keys);
      if ("error" in r) throw new Error(`fixture ${st.name}: ${r.error}`);
      out.push({ kind: "arrows", name: `${st.name}-${i}`, seed, fish, plan, keys, expected: r });
    }
  }
  // no keys at all, and four wrong keys in a row (kéo hụt at once)
  const plan = netArrowPlan(fishSets[1]);
  out.push({ kind: "arrows", name: "no-keys", seed: 42, fish: fishSets[1], plan, keys: [], expected: netArrowReplay(42, plan, []) as { mistakes: number; ticks: number } });
  const g = arrowGame(42, plan);
  const wrong = ARROWS.indexOf(ARROWS.find((a) => a !== g.seq[0])!);
  const four = [30, 31, 32, 33].map((t) => t * 4 + wrong);
  out.push({ kind: "arrows", name: "four-wrong", seed: 42, fish: fishSets[1], plan, keys: four, expected: netArrowReplay(42, plan, four) as { mistakes: number; ticks: number } });
  return out;
}

export function buildNetCases(): NetCase[] {
  return [...buildHauls(), ...buildArrows()];
}
