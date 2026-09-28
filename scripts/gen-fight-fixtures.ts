// Builds tests/fixtures/fight-cases.json from the TS engine (ruling R1). Each case: the match params, both fighters'
// input logs as RLE runs, the frame count, and what the engine gives: the per-round results, the match result, the
// final hash and the hash at every 600th frame. tests/unit/fight-fixtures.test.ts checks the JSON equals this, and
// tests/sql/fight-engine-smoke.sql replays every case through 0048's _fx_run in 300-frame chunks.
//
// Rewrite the JSON (after an engine change, with the SQL changed in the same commit):
//   WRITE_FIGHT_FIXTURES=1 pnpm vitest run tests/unit/fight-fixtures.test.ts
//
// The inputs come from small scripted agents (a fighter walking in and doing each special, a blocker, a parrier …) and
// from bot matches, recorded frame by frame; the cases themselves have no bot sides (bots are 0049's).

import { absolute, motionScript, recordBots } from "@/lib/game/fight/bot";
import {
  A_ATTACK, A_JUMP, BOT_DUMMY, F_ACT, F_AF, F_FACE, F_VY, F_X, G_PHASE, IN_BL, IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LK, IN_LP,
  IN_RIGHT, IN_SK, IN_UP, PH_FIGHT, PH_OVER, SUB, createMatch, curMove, fb, fighterParams, hash, isAirborne, isFree, makeParams,
  roundResults, step, type FighterParams, type MatchParams, type State,
} from "@/lib/game/fight/engine";
import { encodeRuns } from "@/lib/game/fight/log";
import {
  H_LOW, K_GRAB, K_NONE, M_BTN, M_GMAX, M_GMIN, M_HEIGHT, M_KIND, M_MOTION, MOVES_PER_STYLE, mv,
} from "@/lib/game/fight/moves";

export interface FightCase {
  name: string;
  params: MatchParams;
  p1: number[];
  p2: number[];
  frames: number;
  expected: {
    rounds: { reason: number; winner: number; hp1: number; hp2: number; frame: number }[];
    result: number;
    hash: number;
    /** [frame, hash] at every 600th frame. */
    hashes: [number, number][];
  };
}

type Agent = (s: State) => number;
const P1 = fb(0), P2 = fb(1);
const idle: Agent = () => 0;
const INTRO = 90;

/** Plays `frames` frames with two agents, recording what they pressed. */
function record(params: MatchParams, a: Agent, b: Agent, frames: number): { m1: number[]; m2: number[] } {
  let s = createMatch(params);
  const m1: number[] = [], m2: number[] = [];
  for (let k = 0; k < frames && s[G_PHASE] !== PH_OVER; k++) {
    const x = a(s), y = b(s);
    m1.push(x);
    m2.push(y);
    s = step(s, x, y);
  }
  return { m1, m2 };
}

function finish(name: string, params: MatchParams, m1: number[], m2: number[], frames?: number): FightCase {
  const n = frames ?? Math.max(m1.length, m2.length);
  let s = createMatch(params);
  const hashes: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    s = step(s, m1[k] ?? 0, m2[k] ?? 0);
    if ((k + 1) % 600 === 0) hashes.push([k + 1, hash(s)]);
  }
  return {
    name, params, p1: encodeRuns(m1.slice(0, n)), p2: encodeRuns(m2.slice(0, n)), frames: n,
    expected: { rounds: roundResults(s), result: s[7], hash: hash(s), hashes },
  };
}

const dist = (s: State) => Math.trunc(Math.abs(s[P2 + F_X] - s[P1 + F_X]) / SUB);

/** Walks in and does each special in turn (by its motion), then idles. */
function specialsAgent(side: number, slots: number[], style: number): Agent {
  const queue = slots.slice();
  let script: number[] = [];
  let wait = 0;
  return (s) => {
    const b = fb(side), o = fb(1 - side), face = s[b + F_FACE];
    if (s[G_PHASE] !== PH_FIGHT) return 0;
    if (script.length > 0) return absolute(script.shift()!, face);
    if (wait > 0) { wait--; return 0; }
    if (!isFree(s, b) || (!isFree(s, o) && s[o + F_ACT] !== A_ATTACK)) return 0;
    const slot = queue[0];
    if (slot === undefined) return 0;
    const id = style * MOVES_PER_STYLE + 12 + slot;
    const grab = mv(id, M_KIND) === K_GRAB;
    const want = grab ? Math.max(20, Math.trunc((mv(id, M_GMIN) + mv(id, M_GMAX)) / 2)) : 20;
    const d = Math.trunc(Math.abs(s[o + F_X] - s[b + F_X]) / SUB);
    if (d > want) return absolute(IN_RIGHT, face);
    if (grab && d < mv(id, M_GMIN) + 2) return absolute(IN_LEFT, face);
    queue.shift();
    if (mv(id, M_KIND) === K_NONE) return 0;
    script = motionScript(mv(id, M_MOTION), mv(id, M_BTN));
    wait = 20;
    return absolute(script.shift()!, face);
  };
}

/** Holds back (and down against a low). */
function blocker(side: number): Agent {
  return (s) => {
    const b = fb(side), o = fb(1 - side);
    const id = curMove(s, o);
    const low = s[o + F_ACT] === A_ATTACK && id >= 0 && mv(id, M_HEIGHT) === H_LOW;
    return absolute(IN_LEFT | (low ? IN_DOWN : 0), s[b + F_FACE]);
  };
}

/** Frame-indexed script: `at[k]` masks (relative to facing) from the first fight frame. */
function timed(side: number, at: Record<number, number>): Agent {
  return (s) => {
    const rel = at[s[0] - INTRO] ?? 0;
    return absolute(rel, s[fb(side) + F_FACE]);
  };
}

/** Walks to `gap` px, then runs `then`. */
function approach(side: number, gap: number, then: Agent): Agent {
  let there = false;
  return (s) => {
    if (s[G_PHASE] !== PH_FIGHT) return 0;
    if (!there && dist(s) > gap) return absolute(IN_RIGHT, s[fb(side) + F_FACE]);
    there = true;
    return then(s);
  };
}

/** Stays within `gap` px (walks back in whenever free and pushed out), else runs `then`. */
function closer(side: number, gap: number, then: Agent): Agent {
  return (s) => {
    if (s[G_PHASE] !== PH_FIGHT) return 0;
    if (isFree(s, fb(side)) && dist(s) > gap) return absolute(IN_RIGHT, s[fb(side) + F_FACE]);
    return then(s);
  };
}

/** Presses `rel` every `every` frames when free. */
function jabber(side: number, rel: number, every: number): Agent {
  let k = 0;
  return (s) => {
    k++;
    return k % every === 0 && isFree(s, fb(side)) ? absolute(rel, s[fb(side) + F_FACE]) : 0;
  };
}

/** Reacts to the foe's attack startup with a special (parry, dodge, armour). */
function reactor(side: number, style: number, slot: number, atFoeAf: number): Agent {
  let script: number[] = [];
  let used = 0;
  return (s) => {
    const b = fb(side), o = fb(1 - side), face = s[b + F_FACE];
    if (script.length > 0) return absolute(script.shift()!, face);
    if (used < 3 && s[o + F_ACT] === A_ATTACK && s[o + F_AF] === atFoeAf && isFree(s, b)) {
      const id = style * MOVES_PER_STYLE + 12 + slot;
      script = motionScript(mv(id, M_MOTION), mv(id, M_BTN));
      used++;
      return absolute(script.shift()!, face);
    }
    return 0;
  };
}

/** Jumps in toward the foe and kicks on the way down, again and again. */
function jumper(side: number): Agent {
  return (s) => {
    const b = fb(side);
    if (s[b + F_ACT] === A_JUMP && s[b + F_AF] >= 30 && s[b + F_AF] <= 31) return IN_HK;
    if (isFree(s, b) && dist(s) < 110) return absolute(IN_UP | IN_RIGHT, s[b + F_FACE]);
    if (isFree(s, b)) return absolute(IN_RIGHT, s[b + F_FACE]);
    return 0;
  };
}

/** Holds a relative mask. */
function hold(side: number, rel: number): Agent {
  return (s) => absolute(rel, s[fb(side) + F_FACE]);
}

/** cr.HP when the foe is airborne and close. */
function antiAir(side: number): Agent {
  return (s) => {
    const b = fb(side), o = fb(1 - side);
    if (isFree(s, b) && isAirborne(s, o) && s[o + F_VY] < 0 && dist(s) < 26) return IN_DOWN | IN_HP;
    return isFree(s, b) ? IN_DOWN : 0;
  };
}

const full = (style: number, more: Partial<FighterParams> = {}) => fighterParams(style, 4, { en0: 1000, ...more });
const STYLES = [0, 1, 2, 3, 4, 5, 6, 7];
const NAMES = ["tudo", "vovinam", "muaythai", "karate", "taekwondo", "boxing", "judo", "vinhxuan"];

export function buildFightCases(): FightCase[] {
  const out: FightCase[] = [];
  const add = (name: string, params: MatchParams, a: Agent, b: Agent, frames: number, n?: number) => {
    const r = record(params, a, b, frames);
    out.push(finish(name, params, r.m1, r.m2, n));
  };

  // every style's specials, hitting a standing fighter and blocked
  for (const st of STYLES) {
    const slots = st === 0 ? [1] : [5, 1, 2, 3, 4];
    add(`specials-hit-${NAMES[st]}`, makeParams(full(st), fighterParams(st, 0), { seed: 100 + st }), specialsAgent(0, slots, st), idle, 1500);
    add(`specials-blocked-${NAMES[st]}`, makeParams(full(st), fighterParams((st + 3) % 8, 0), { seed: 200 + st }), specialsAgent(0, slots, st), blocker(1), 1500);
  }
  // the P2 side doing them (mirrored facing)
  add("specials-hit-p2-karate", makeParams(fighterParams(0, 0), full(3), { seed: 301 }), idle, specialsAgent(1, [5, 1, 2, 3, 4], 3), 1500);

  // throws: walk in for 80 frames (the pushboxes stop at 20 px), then LP+LK
  const walkThen = (walk: number, at: Record<number, number>): Record<number, number> => {
    const r: Record<number, number> = {};
    for (let k = 0; k < walk; k++) r[k] = IN_RIGHT;
    return Object.assign(r, at);
  };
  add("throw-whiff", makeParams(fighterParams(0, 0), fighterParams(0, 0)), timed(0, { 60: IN_LP | IN_LK }), idle, 400);
  add("throw-hit", makeParams(fighterParams(6, 0), fighterParams(2, 0)), timed(0, walkThen(80, { 90: IN_LP | IN_LK })), idle, 400);
  add("throw-tudo", makeParams(fighterParams(0, 0), fighterParams(0, 0)), timed(0, walkThen(80, { 90: IN_LP | IN_LK })), idle, 400);
  add("throw-tech", makeParams(fighterParams(0, 0), fighterParams(0, 0)), timed(0, walkThen(80, { 90: IN_LP | IN_LK })),
    timed(1, { 98: IN_LP | IN_LK }), 400);
  add("throw-both", makeParams(fighterParams(2, 0), fighterParams(6, 0)), timed(0, walkThen(80, { 90: IN_LP | IN_LK })),
    timed(1, { 90: IN_LP | IN_LK }), 400);

  // defence specials
  add("parry-judo", makeParams(fighterParams(0, 0), full(6), { seed: 7 }), approach(0, 22, jabber(0, IN_LP, 40)), reactor(1, 6, 3, 1), 900);
  add("parry-vinhxuan", makeParams(fighterParams(3, 0), full(7), { seed: 8 }), closer(0, 20, jabber(0, IN_HP, 50)), reactor(1, 7, 3, 3), 900);
  add("armour-karate", makeParams(fighterParams(0, 0), full(3), { seed: 9 }), approach(0, 20, jabber(0, IN_LP, 18)), reactor(1, 3, 4, 1), 900);
  add("armour-muaythai-hk", makeParams(fighterParams(0, 0), fighterParams(2, 0)), closer(0, 20, jabber(0, IN_LP, 20)),
    (s) => (s[P1 + F_ACT] === A_ATTACK && s[P1 + F_AF] === 1 && isFree(s, P2) ? IN_HK : 0), 900);
  add("dodge-boxing", makeParams(fighterParams(0, 0), full(5), { seed: 10 }), closer(0, 20, jabber(0, IN_HP, 45)), reactor(1, 5, 2, 1), 900);

  // air
  add("anti-air", makeParams(fighterParams(4, 0), fighterParams(0, 0)), jumper(0), antiAir(1), 1500);
  add("jump-ins", makeParams(fighterParams(1, 0), fighterParams(5, 0)), jumper(0), idle, 1500);
  add("jump-ins-blocked", makeParams(fighterParams(0, 0), fighterParams(4, 0)), jumper(0), blocker(1), 1500);
  add("jump-ins-crouch-block", makeParams(fighterParams(0, 0), fighterParams(0, 0)), jumper(0), hold(1, IN_LEFT | IN_DOWN), 1500);

  // cancels, chains and the shortcut: walk 72 frames (90 px), then the buttons
  add("cancel-lp-s1", makeParams(fighterParams(0, 0), fighterParams(0, 0)), timed(0, walkThen(72, {
    74: IN_LP, 78: IN_DOWN, 79: IN_DOWN | IN_RIGHT, 80: IN_RIGHT | IN_HP,
    ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [122 + i, IN_RIGHT])),
    162: IN_DOWN | IN_LP, 163: IN_DOWN, 164: IN_DOWN, 165: IN_DOWN, 166: IN_DOWN | IN_RIGHT, 167: IN_RIGHT | IN_LP,
  })), idle, 500);
  add("chain-karate", makeParams(fighterParams(3, 0), fighterParams(0, 0)), timed(0, walkThen(72, { 74: IN_LP, 78: IN_HP })), idle, 300);
  add("chain-vinhxuan", makeParams(fighterParams(7, 0), fighterParams(0, 0)), timed(0, walkThen(72, { 74: IN_LP, 78: IN_LP, 83: IN_LP, 88: IN_LP })), idle, 300);
  const sc = walkThen(68, { 72: IN_SK, 172: IN_SK | IN_DOWN, 173: IN_DOWN, 272: IN_SK | IN_LEFT, 372: IN_SK | IN_RIGHT, 472: IN_SK | IN_BL, 572: IN_SK });
  add("shortcuts-taekwondo", makeParams(full(4), fighterParams(0, 0)), timed(0, sc), idle, 700);
  add("shortcuts-poor", makeParams(fighterParams(1, 4, { en0: 120 }), fighterParams(0, 0)), timed(0, sc), idle, 700);

  // round and match rules
  add("double-ko", makeParams(fighterParams(0, 0, { hpPct: 2 }), fighterParams(0, 0, { hpPct: 2 }), { rounds: 1, maxRounds: 1 }),
    approach(0, 22, timed(0, { 80: IN_LP })), timed(1, { 80: IN_LP }), 400);
  add("time-up-draw", makeParams(fighterParams(0, 0), fighterParams(0, 0), { rounds: 1, maxRounds: 1 }), idle, idle, 6180);
  add("time-up-win", makeParams(fighterParams(0, 0), fighterParams(3, 0), { rounds: 1, maxRounds: 1 }),
    approach(0, 24, timed(0, { 80: IN_LK })), idle, 6180);
  add("chip-survives", makeParams(full(3), fighterParams(0, 0, { hpPct: 1 }), { rounds: 1, maxRounds: 1 }),
    specialsAgent(0, [1, 4, 2, 1, 1], 3), blocker(1), 900);
  add("five-round-draw-worst-case", makeParams(fighterParams(0, 0), fighterParams(0, 0)), idle, idle, 30_900, 30_900);

  // bot matches, recorded (the seeds keep what the SQL smokes lean on — karate beats taekwondo and judo beats boxing,
  // each in three rounds — and every log within the rate rule)
  const bots: [string, FighterParams, FighterParams, number][] = [
    ["bots-tudo-1-vs-2", fighterParams(0, 0, { bot: 1 }), fighterParams(0, 0, { bot: 2 }), 21],
    ["bots-vovinam-3-vs-muaythai-4", fighterParams(1, 2, { bot: 3 }), fighterParams(2, 3, { bot: 4 }), 22],
    ["bots-karate-5-vs-taekwondo-5", fighterParams(3, 4, { bot: 5 }), fighterParams(4, 4, { bot: 5 }), 28],
    ["bots-boxing-6-vs-judo-7", fighterParams(5, 4, { bot: 6 }), fighterParams(6, 4, { bot: 7 }), 32],
    ["bots-vinhxuan-8-vs-karate-8", fighterParams(7, 4, { bot: 8 }), fighterParams(3, 4, { bot: 8 }), 27],
    ["bots-judo-8-vs-dummy", fighterParams(6, 4, { bot: 8 }), fighterParams(0, 0, { bot: BOT_DUMMY }), 26],
  ];
  for (const [name, a, b, seed] of bots) {
    const p = makeParams(a, b, { seed });
    const rec = recordBots(createMatch(p), 30_900);
    const plain = makeParams({ ...a, bot: 0 }, { ...b, bot: 0 }, { seed });
    out.push(finish(name, plain, rec.masks[0], rec.masks[1]));
  }
  return out;
}

