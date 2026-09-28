// v20 Võ đài: the bot (spec §v20.1 "Bot"). It reads the match state and writes its memory (6 ints per side) and the
// match PRNG into it, so a replay reproduces it exactly. v20.1 runs it on the client only (practice); v20.2's 0049
// mirrors it in SQL as _fx_bot and re-creates _fx_step to call it for a bot side, like stepWithBots below.
// Integer-only, like the engine.

import { rand32 } from "@/lib/game/fishing/reel";
import {
  A_ATTACK, A_BLOCKSTUN, A_JATTACK, A_JUMP, A_THROWN, BOT_DUMMY, ENERGY_MAX, F_ACT, F_AF, F_BOT, F_BOTMEM, F_EN, F_FACE,
  F_HITS, F_MASK, F_STYLE, F_X, G_FRAME, G_PHASE, G_RNG, G_ROUND, IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LK, IN_LP, IN_RIGHT, IN_UP,
  PH_FIGHT, PH_OVER, SUB, curMove, fb, isAirborne, isFree, step, type State,
} from "./engine";
import {
  B_HK, B_HP, B_K, B_P, H_LOW, K_NONE, M_A, M_BTN, M_COST, M_HEIGHT, M_KIND, M_MOTION, M_S, M_SLOT, MO_DD, MO_DP,
  MO_QCB, MO_QCF, MO_QCF2, MOVES_PER_STYLE, mv,
} from "./moves";

export interface BotLevel {
  /** Frames between decisions (the reaction time). */
  d: number;
  block: number;
  aa: number;
  special: number;
  tech: number;
  /** 0 none · 1 poke → S1 · 2 LP, LP → S1 · 3 2-hit → special · 4 + supers at full energy · 5 + punishes whiffed specials. */
  combo: number;
}

/** Index = level (1–8). */
export const BOT_LEVELS: readonly (BotLevel | null)[] = [
  null,
  { d: 24, block: 15, aa: 10, special: 10, tech: 0, combo: 0 },
  { d: 20, block: 30, aa: 25, special: 15, tech: 10, combo: 1 },
  { d: 16, block: 45, aa: 40, special: 20, tech: 20, combo: 2 },
  { d: 13, block: 55, aa: 55, special: 25, tech: 30, combo: 3 },
  { d: 11, block: 62, aa: 65, special: 30, tech: 40, combo: 4 },
  { d: 9, block: 70, aa: 72, special: 35, tech: 50, combo: 4 },
  { d: 8, block: 76, aa: 80, special: 40, tech: 60, combo: 5 },
  { d: 7, block: 82, aa: 88, special: 45, tech: 70, combo: 5 },
];

// memory slots
const M_SEQ = 0;
const M_STEP = 1;
const M_NEXT = 2;
const M_HOLD = 3;
const M_LEFT = 4;
const M_FLAGS = 5;
const FL_COMBO = 1;
const FL_TECHED = 2;

// relative input bits: back / forward instead of left / right
const RB = IN_LEFT;
const RF = IN_RIGHT;
const U = IN_UP;
const D = IN_DOWN;

/** Fixed scripts (id → masks, relative). Specials are 100 + motion × 8 + button class. */
const SCRIPTS: Readonly<Record<number, readonly number[]>> = {
  1: [IN_LP | IN_LK],                                              // throw / tech
  2: [D | IN_HP, D, D, D],                                         // cr.HP (anti-air)
  3: [IN_LK],                                                      // poke
  4: [D | IN_LK, D, D],                                            // cr.LK
  5: [IN_LP],                                                      // jab
  6: [IN_HP],
  7: [D | IN_HK, D, D],                                            // sweep
  // jump-in: the kick on the way down (a jump is 4 frames of prejump and about 40 in the air)
  8: [U | RF, U | RF, U | RF, U | RF, ...Array<number>(29).fill(0), IN_HK],
};
const POKES = [3, 4, 5, 6, 7];

/** A special's motion as relative masks, the button on the last frame. */
export function motionScript(motion: number, btn: number): number[] {
  const b = btn === B_P ? IN_LP : btn === B_K ? IN_LK : btn === B_HP ? IN_HP : btn === B_HK ? IN_HK : IN_LP;
  if (motion === MO_QCF) return [D, D | RF, RF | b];
  if (motion === MO_QCB) return [D, D | RB, RB | b];
  if (motion === MO_DP) return [RF, D, D | RF, D | RF | b];
  if (motion === MO_DD) return [D, 0, D | b];
  if (motion === MO_QCF2) return [D, D | RF, RF, D, D | RF, RF | b];
  return [b];
}

function scriptOf(id: number): readonly number[] {
  if (id >= 100) return motionScript((id - 100) >> 3, (id - 100) & 7);
  return SCRIPTS[id] ?? [];
}

/** A relative mask (left = back, right = forward) → left/right for a fighter's facing. */
export function absolute(rel: number, face: number): number {
  const back = (rel & RB) !== 0, fwd = (rel & RF) !== 0;
  let m = rel & ~(IN_LEFT | IN_RIGHT);
  if (back) m |= face > 0 ? IN_LEFT : IN_RIGHT;
  if (fwd) m |= face > 0 ? IN_RIGHT : IN_LEFT;
  return m;
}

function roll(s: State): number {
  const [u, next] = rand32(s[G_RNG] >>> 0);
  s[G_RNG] = next | 0;
  return u % 100;
}

/** The script of special `slot` if the bot has it unlocked and affordable (0: none). */
function specialScript(s: State, b: number, slot: number): number {
  const id = s[b + F_STYLE] * MOVES_PER_STYLE + 12 + slot;
  if (mv(id, M_KIND) === K_NONE || (s[b + F_MASK] & (1 << (slot - 1))) === 0) return 0;
  if (s[b + F_EN] < mv(id, M_COST)) return 0;
  return 100 + mv(id, M_MOTION) * 8 + mv(id, M_BTN);
}

function startScript(s: State, b: number, id: number): void {
  s[b + F_BOTMEM + M_SEQ] = id;
  s[b + F_BOTMEM + M_STEP] = 0;
  s[b + F_BOTMEM + M_LEFT] = 0;
}
function startHold(s: State, b: number, rel: number, n: number): void {
  s[b + F_BOTMEM + M_SEQ] = 0;
  s[b + F_BOTMEM + M_HOLD] = rel;
  s[b + F_BOTMEM + M_LEFT] = n;
}

function decide(s: State, b: number, o: number, lv: BotLevel, level: number, f: number): void {
  const dist = Math.trunc(Math.abs(s[o + F_X] - s[b + F_X]) / SUB);
  const foeAir = isAirborne(s, o);
  const oa = s[o + F_ACT];
  let foeStartup = false, foeRecovery = false, foeLow = false, foeSpecial = false;
  if (oa === A_ATTACK || oa === A_JATTACK) {
    const id = curMove(s, o), af = s[o + F_AF], active = mv(id, M_S) + mv(id, M_A);
    foeStartup = af <= active;
    foeRecovery = af > active;
    foeLow = mv(id, M_HEIGHT) === H_LOW;
    foeSpecial = mv(id, M_SLOT) > 0;
  }
  s[b + F_BOTMEM + M_NEXT] = f + lv.d;
  const r = roll(s);
  if (foeAir && dist < 100 && r < lv.aa) {
    const dp = level >= 3 ? specialScript(s, b, 3) : 0;
    startScript(s, b, dp !== 0 && (dp - 100) >> 3 === MO_DP ? dp : 2);
    return;
  }
  if (foeStartup && dist < 80 && r < lv.block) {
    startHold(s, b, foeLow ? RB | D : RB, lv.d);
    return;
  }
  if (lv.combo >= 4 && s[b + F_EN] >= ENERGY_MAX && dist < 70) {
    const tk = specialScript(s, b, 5);
    if (tk !== 0) {
      startScript(s, b, tk);
      return;
    }
  }
  if (lv.combo >= 5 && foeRecovery && foeSpecial && dist < 90) {
    const s1 = specialScript(s, b, 1);
    startScript(s, b, s1 !== 0 ? s1 : 6);
    return;
  }
  const r2 = roll(s);
  if (dist > 44) {
    const s1 = specialScript(s, b, 1);
    if (r2 < lv.special && s1 !== 0) startScript(s, b, s1);
    else if (r2 < lv.special + 20 && level >= 2) startScript(s, b, 8);
    else startHold(s, b, RF, lv.d);
    return;
  }
  if (dist < 30 && r2 < 15 && level >= 2) {
    startScript(s, b, 1);
    return;
  }
  if (r2 < lv.special) {
    const slot = 1 + (roll(s) % 4);
    const sp = specialScript(s, b, slot) || specialScript(s, b, 1);
    if (sp !== 0) {
      startScript(s, b, sp);
      return;
    }
  }
  if (r2 < lv.special + 45) {
    startScript(s, b, POKES[roll(s) % POKES.length]);
    if (lv.combo >= 1) s[b + F_BOTMEM + M_FLAGS] |= FL_COMBO;
    return;
  }
  if (r2 < lv.special + 55) {
    startHold(s, b, RB, lv.d >> 1);
    return;
  }
  startHold(s, b, RF, lv.d >> 1);
}

/** The bot's input for this frame (absolute mask). Mutates `s`: the bot's memory and the match PRNG. */
export function botInput(s: State, side: number): number {
  const b = fb(side), o = fb(1 - side);
  const level = s[b + F_BOT];
  if (level <= 0 || level === BOT_DUMMY || s[G_PHASE] !== PH_FIGHT) return 0;
  const lv = BOT_LEVELS[level];
  if (!lv) return 0;
  const f = s[G_FRAME] + 1;
  const mem = b + F_BOTMEM;
  const a = s[b + F_ACT];
  // thrown: one tech roll per throw
  if (a === A_THROWN) {
    if ((s[mem + M_FLAGS] & FL_TECHED) === 0) {
      s[mem + M_FLAGS] |= FL_TECHED;
      if (roll(s) < lv.tech) startScript(s, b, 1);
    }
  } else s[mem + M_FLAGS] &= ~FL_TECHED;
  // a poke that connected cancels into a special
  if ((s[mem + M_FLAGS] & FL_COMBO) !== 0 && a === A_ATTACK && s[b + F_HITS] > 0 && s[mem + M_SEQ] === 0) {
    s[mem + M_FLAGS] &= ~FL_COMBO;
    const sp = specialScript(s, b, 1);
    if (sp !== 0) startScript(s, b, sp);
  }
  let rel = 0;
  if (s[mem + M_SEQ] !== 0) {
    const sc = scriptOf(s[mem + M_SEQ]);
    rel = sc[s[mem + M_STEP]] ?? 0;
    s[mem + M_STEP] += 1;
    if (s[mem + M_STEP] >= sc.length) s[mem + M_SEQ] = 0;
  } else if (s[mem + M_LEFT] > 0) {
    rel = s[mem + M_HOLD];
    s[mem + M_LEFT] -= 1;
  } else if (f >= s[mem + M_NEXT] && (isFree(s, b) || a === A_BLOCKSTUN || a === A_JUMP)) {
    if (a !== A_JUMP) {
      decide(s, b, o, lv, level, f);
      if (s[mem + M_SEQ] !== 0) {
        const sc = scriptOf(s[mem + M_SEQ]);
        rel = sc[0] ?? 0;
        s[mem + M_STEP] = 1;
        if (sc.length <= 1) s[mem + M_SEQ] = 0;
      } else if (s[mem + M_LEFT] > 0) {
        rel = s[mem + M_HOLD];
        s[mem + M_LEFT] -= 1;
      }
    }
  }
  return absolute(rel, s[b + F_FACE]);
}

/** One frame with the bot sides' inputs computed from the state (a player side keeps its mask). */
export function stepWithBots(s0: State, a: number, b: number): State {
  const s = s0.slice();
  const ma = s[fb(0) + F_BOT] > 0 ? botInput(s, 0) : a;
  const mb = s[fb(1) + F_BOT] > 0 ? botInput(s, 1) : b;
  return step(s, ma, mb);
}

/** 0060 a secret-bot match (`params.secretBot`): the bots' rolls come from a stream outside the state, which stays on
 *  the server (public._fx_step_secret); G_RNG is 0 in every state. One frame: the stream goes into G_RNG for the bots'
 *  decisions and comes out again. */
export function stepWithSecretBots(s0: State, a: number, b: number, rng: number): { state: State; rng: number } {
  const s = s0.slice();
  s[G_RNG] = rng | 0;
  const ma = s[fb(0) + F_BOT] > 0 ? botInput(s, 0) : a;
  const mb = s[fb(1) + F_BOT] > 0 ? botInput(s, 1) : b;
  const out = s[G_RNG] | 0;
  s[G_RNG] = 0;
  return { state: step(s, ma, mb), rng: out };
}

/** The stream of a secret-bot match: re-seeded with `seedOf(round)` whenever the round changes (the server's
 *  _fx_bot_seed; a client, which never learns it, plays a decoy stream for the display only). */
export class SecretBotStream {
  private round = 0;
  private rng = 0;
  constructor(private readonly seedOf: (round: number) => number) {}
  step(s: State, a: number, b: number): State {
    if (s[G_ROUND] !== this.round) {
      this.round = s[G_ROUND];
      this.rng = this.seedOf(this.round) | 0;
    }
    const r = stepWithSecretBots(s, a, b, this.rng);
    this.rng = r.rng;
    return r.state;
  }
}

/** The masks a bot match produced, frame by frame (fixtures record bots as plain logs). */
export function recordBots(s0: State, n: number): { masks: [number[], number[]]; state: State } {
  let s = s0;
  const m1: number[] = [], m2: number[] = [];
  for (let k = 0; k < n && s[G_PHASE] !== PH_OVER; k++) {
    const t = s.slice();
    const a = t[fb(0) + F_BOT] > 0 ? botInput(t, 0) : 0;
    const b = t[fb(1) + F_BOT] > 0 ? botInput(t, 1) : 0;
    m1.push(a);
    m2.push(b);
    s = step(t, a, b);
  }
  return { masks: [m1, m2], state: s };
}
