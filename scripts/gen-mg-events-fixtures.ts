import { rand32 } from "@/lib/game/fishing/reel";
import { anvilRound, brewRound, sortRound } from "@/lib/game/craftmg/games";
import { mineRound, minePos } from "@/lib/game/mining/game";
import { feedLanes, fetchFlights, pressRound, rubLikes } from "@/lib/game/pets/minigames";
import { draws, speedOf } from "@/lib/game/realm/minigames";
import { rowRound } from "@/lib/game/river/row";

// 0087's live events: what public._mg_events answers for a round's parameters, mirrored here statement for statement.
// tests/fixtures/mg-events-cases.json pins both: tests/sql/v22-fixes-smoke.sql checks _mg_events against it, and
// tests/unit/mg-live.test.ts checks that the overlays' *From functions rebuild the seed rounds from these events.
// WRITE_MG_EVENTS_FIXTURES=1 vitest tests/unit/mg-live.test.ts rewrites the fixture.

export interface MgEvent { i: number; at: number; d: Record<string, number> }
export interface MgEventCase {
  name: string; seed: number; game: string; kind: string; params: number[]; gate: number;
  meta: Record<string, string | number | boolean>; a: number[]; events: MgEvent[];
}

/** public._mg_events, for one live row. */
export function mgEvents(c: Omit<MgEventCase, "name" | "seed" | "events">): MgEvent[] {
  const u = c.params, o: MgEvent[] = [];
  const sp = String(c.meta.species ?? "");
  if (c.game === "world" && c.kind === "hunt") {
    const per = Math.floor(((150 + (u[0] % 91)) * 100) / speedOf(sp));
    o.push({ i: 1, at: c.gate, d: { period: per, phase: u[1] % per, wind: (u[2] % 121) - 60 } });
    if (c.meta.danger === true) { const chg = 150 + (u[4] % 151); o.push({ i: 2, at: chg - 60, d: { charge: chg } }); }
  } else if (c.game === "world" && c.kind === "trap") {
    const mul = speedOf(sp) >= 150 ? 3 : 2, tv = [-3, 0, 0, 4, 5, 6, 7, 8];
    let s = 0;
    for (let i = 0; i < 8; i++) {
      const len = 30 + (u[2 * i] % 41);
      o.push({ i: i + 1, at: s - 30, d: { len, v: Math.trunc((tv[u[2 * i + 1] % 8] * mul) / 2) } });
      s += len;
    }
  } else if (c.game === "world" && c.kind === "photo") {
    const per = Math.floor(((180 + (u[0] % 121)) * 100) / speedOf(sp)), pose = 150 + (u[2] % 91);
    o.push({ i: 1, at: c.gate, d: { period: per, phase: u[1] % per, pose, pose_at: u[3] % pose } });
  } else if (c.game === "world" && c.kind === "combo") {
    let b = 90 + (u[0] % 31);
    const beats: number[] = [];
    for (let j = 0; j < 6; j++) {
      if (j > 0) b += 54 + (u[2 * j] % 19);
      beats.push(b);
      o.push({ i: j + 1, at: b - 120, d: { beat: b, dir: u[2 * j + 1] % 4 } });
    }
    const slam = beats[1 + (u[12] % 3)] + 27;
    o.push({ i: 7, at: slam - 90, d: { slam } });
  } else if (c.game === "brew") {
    for (let i = 1; i <= 20; i++) o.push({ i, at: 30 * (i - 1) - 60, d: { drift: u[i] } });
  } else if (c.game === "anvil") {
    o.push({ i: 1, at: c.gate, d: { period: u[0], phase: u[1] } });
  } else if (c.game === "sort") {
    for (let i = 1; i <= 12; i++) o.push({ i, at: 40 + 45 * (i - 1) - 60, d: { kind: u[i - 1] } });
  } else if (c.game === "care") {
    const n = c.kind === "feed" ? 12 : c.kind === "pat" ? 5 : 8;
    const key = c.kind === "feed" ? "lane" : c.kind === "pat" ? "like" : "flight";
    const at = (i: number) => (c.kind === "feed" ? 30 + 40 * (i - 1) - 30 : c.kind === "pat" ? 30 + 100 * (i - 1) - 30 : 20 + 100 * (i - 1) - 30);
    for (let i = 1; i <= n; i++) o.push({ i, at: at(i), d: { [key]: u[i - 1] } });
  } else if (c.game === "row") {
    for (let i = 1; i <= 12; i++) o.push({ i, at: u[i - 1] - 90, d: { t: u[i - 1], side: u[i + 11] } });
  } else if (c.game === "press") {
    o.push({ i: 1, at: c.gate, d: { centre: u[1] } });
  } else if (c.game === "dig" || c.game === "mine") {
    const need = u.length - 1, win = Number(c.meta.win);
    let hits = 0;
    o.push({ i: 1, at: c.gate, d: { c: u[1] } });
    for (const t of c.a) {
      if (hits >= need) break;
      if (Math.abs(minePos(u[0], t) - u[hits + 1]) <= win) {
        hits++;
        if (hits < need) o.push({ i: hits + 1, at: Math.max(t, c.gate), d: { c: u[hits + 1] } });
      }
    }
  }
  return o;
}

const SEEDS = [1788458060, 978983017, 2445500225, 12345, 4055616904, 1192066308, 777, 3141592653];

/** Strikes that hit every vein in turn (the sharpest dig), after the gate. */
function digStrikes(rd: number[], win: number, gate: number): number[] {
  const out: number[] = [];
  let t = gate + 10;
  for (let k = 1; k < rd.length; k++) {
    while (Math.abs(minePos(rd[0], t) - rd[k]) > win / 2) t++;
    out.push(t);
    t += 20;
  }
  return out;
}

export function buildMgEventCases(): MgEventCase[] {
  const cases: MgEventCase[] = [];
  const add = (name: string, seed: number, c: Omit<MgEventCase, "name" | "seed" | "events">) => cases.push({ name, seed, ...c, events: mgEvents(c) });
  SEEDS.forEach((seed, n) => {
    const gate = 30 + (rand32(seed)[0] % 31);
    const sp = ["rabbit", "bird", "wolf", "deer"][n % 4];
    add(`hunt-${n}`, seed, { game: "world", kind: "hunt", params: draws(seed, 5), gate, meta: { species: sp, danger: n % 2 === 0 }, a: [] });
    add(`trap-${n}`, seed, { game: "world", kind: "trap", params: draws(seed, 16), gate: 0, meta: { species: sp, danger: false }, a: [] });
    add(`photo-${n}`, seed, { game: "world", kind: "photo", params: draws(seed, 4), gate, meta: { species: sp, danger: false }, a: [] });
    add(`combo-${n}`, seed, { game: "world", kind: "combo", params: draws(seed, 13), gate: 0, meta: { kind: "boss" }, a: [] });
    add(`brew-${n}`, seed, { game: "brew", kind: "brew", params: brewRound(seed), gate: 0, meta: {}, a: [] });
    add(`anvil-${n}`, seed, { game: "anvil", kind: "anvil", params: anvilRound(seed), gate, meta: {}, a: [] });
    add(`sort-${n}`, seed, { game: "sort", kind: "sort", params: sortRound(seed), gate: 0, meta: {}, a: [] });
    add(`feed-${n}`, seed, { game: "care", kind: "feed", params: feedLanes(seed), gate: 0, meta: {}, a: [] });
    add(`pat-${n}`, seed, { game: "care", kind: "pat", params: rubLikes(seed), gate: 0, meta: {}, a: [] });
    add(`play-${n}`, seed, { game: "care", kind: "play", params: fetchFlights(seed), gate: 0, meta: {}, a: [] });
    const rr = rowRound(seed);
    add(`row-${n}`, seed, { game: "row", kind: n % 2 ? "home" : "out", params: [...rr.targets, ...rr.sides], gate: 0, meta: {}, a: [] });
    add(`press-${n}`, seed, { game: "press", kind: "press", params: pressRound(seed), gate, meta: { battle: 1, turn: 1 }, a: [] });
    const need = 1 + (n % 4), win = 90 + 10 * (n % 3), rd = mineRound(seed, need);
    const game = n % 2 ? "mine" : "dig";
    add(`${game}-${n}`, seed, { game, kind: game, params: rd, gate, meta: { win }, a: digStrikes(rd, win, gate) });
  });
  return cases;
}
