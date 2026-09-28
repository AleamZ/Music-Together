// v20 Võ đài: the deterministic fight engine (spec §v20.1 "Engine"). The source of truth: 0048_fight_engine.sql's _fx_*
// functions mirror it statement for statement, and tests/fixtures/fight-cases.json pins the two together (Vitest and
// tests/sql/fight-engine-smoke.sql). Rules for any change (ruling R1):
//   - integers only, every value below 2^31 (the u32 seed and PRNG are stored as signed int32);
//   - divisions are truncating (Math.trunc here, int `/` in SQL) and only ever of non-negative numbers;
//   - no Math.random, no floats, no Date; the state is a flat number[] (a copy is a rollback snapshot);
//   - change the SQL and regenerate the fixtures in the same commit.

import {
  F_AAINV, F_AIRBORNE, F_ARMOR as FL_ARMOR, F_CANCEL, F_DODGE, F_HEAVY, F_KD, F_NOCROUCH, H_LOW, H_OVERHEAD,
  B_HP, B_HK, B_K, B_P, K_CROUCH, K_DODGE, K_GRAB, K_JUMP, K_NONE, K_PARRY, K_THROW,
  M_A, M_BLOCKSTUN, M_BTN, M_CHIP, M_COST, M_DMG, M_FLAGS, M_FREE, M_GMAX, M_GMIN, M_HEIGHT, M_HITS, M_HITSTUN,
  M_INV_A, M_INV_B, M_KIND, M_MOTION, M_NEAR, M_PB, M_R, M_REACH, M_S, M_SLOT, M_TECH, M_TRAV, M_WIN_A, M_WIN_B,
  M_YHI, M_YLO, MO_DD, MO_DP, MO_QCB, MO_QCF, MO_QCF2, MOVES_PER_STYLE, MV_CHK, MV_CHP, MV_CLK, MV_CLP, MV_HK, MV_HP,
  MV_JHK, MV_JHP, MV_JLK, MV_JLP, MV_LK, MV_LP, MV_THROW, S_CHAIN_FROM, S_CHAIN_MAX, S_CHAIN_TO, SHORTCUT_COST,
  SHORTCUT_STARTUP, S_ATK, S_DEF, S_ENERGY, S_JUMP, S_WALK, mv, styleField,
} from "./moves";
import { movesMaskForRank, styleStats } from "./styles";

export type State = number[];

// ---------- input bits ----------
export const IN_LEFT = 1;
export const IN_RIGHT = 2;
export const IN_UP = 4;
export const IN_DOWN = 8;
export const IN_LP = 16;
export const IN_HP = 32;
export const IN_LK = 64;
export const IN_HK = 128;
export const IN_BL = 256;
export const IN_SK = 512;
export const IN_BUTTONS = IN_LP | IN_HP | IN_LK | IN_HK | IN_SK;
export const IN_ALL = 1023;

// ---------- constants ----------
export const SUB = 256;
export const STAGE_W = 384;
export const STAGE_MIN = 16 * SUB;
export const STAGE_MAX = 368 * SUB;
export const START_X1 = 136 * SUB;
export const START_X2 = 248 * SUB;
export const INTRO_FRAMES = 90;
export const ROUND_FRAMES = 5940;
export const END_FRAMES = 150;
export const WALK_F = 320;
export const WALK_B = 256;
export const JUMP_VY = 1792;
export const JUMP_VX = 384;
export const GRAVITY = 90;
export const PREJUMP_FRAMES = 4;
export const LANDING_FRAMES = 3;
export const PUSH_W = 20 * SUB;
export const HITSTOP_HIT = 5;
export const HITSTOP_BLOCK = 3;
/** 36 frames down + 20 of getup. */
export const KD_FRAMES = 56;
export const GETUP_FRAMES = 20;
/** A KO'd fighter stays down. */
export const KO_FRAMES = 999;
export const TECH_PUSH = 20 * SUB;
export const TECHED_FRAMES = 12;
/** The thrower recovers this long after its throw's tech window. */
export const THROW_TAIL = 16;
export const ENERGY_MAX = 1000;
export const EN_HIT = 50;
export const EN_BLOCKED = 25;
export const EN_TAKEN = 30;
export const EN_BLOCK = 10;
export const BUFFER_FRAMES = 4;
export const PRESS_WINDOW = 6;
export const THROW_GAP = 2;
export const NEVER = -1000;
export const HURT_STAND: readonly [number, number] = [22, 60];
export const HURT_CROUCH: readonly [number, number] = [24, 38];
export const HURT_AIR: readonly [number, number] = [20, 50];
export const ENGINE_VERSION = 1;

// ---------- phases, actions, results ----------
export const PH_INTRO = 0;
export const PH_FIGHT = 1;
export const PH_END = 2;
export const PH_OVER = 3;

export const A_IDLE = 0;
export const A_WALKF = 1;
export const A_WALKB = 2;
export const A_CROUCH = 3;
export const A_GUARD = 4;
export const A_CGUARD = 5;
export const A_PREJUMP = 6;
export const A_JUMP = 7;
export const A_LAND = 8;
export const A_ATTACK = 9;
export const A_JATTACK = 10;
export const A_HITSTUN = 11;
export const A_BLOCKSTUN = 12;
export const A_FALL = 13;
export const A_KNOCKDOWN = 14;
export const A_THROW = 15;
export const A_THROWN = 16;
export const A_TECHED = 17;
export const ACTION_COUNT = 18;

/** Contact results (internal, and HITK for the renderer). */
export const R_NONE = 0;
export const R_HIT = 1;
export const R_BLOCK = 2;
export const R_PARRY = 3;
export const R_ARMOR = 4;
export const R_THROW = 5;
export const R_GRAB = 6;

/** HITK: what the fighter last took (render keys). */
export const HK_HIT = 1;
export const HK_HEAVY = 2;
export const HK_BLOCK = 3;
export const HK_THROW = 4;
export const HK_ARMOR = 5;
export const HK_COUNTER = 6;

/** A round result code is reason × 4 + winner (winner 0 = draw); 0 = not played. */
export const REASON_KO = 1;
export const REASON_TIME = 2;
/** G_RESULT: 0 undecided, 1 / 2 the winner, 3 a draw. */
export const RESULT_DRAW = 3;

// ---------- the state layout ----------
export const G_FRAME = 0;
export const G_PHASE = 1;
export const G_LEFT = 2;
export const G_ROUND = 3;
export const G_TIMER = 4;
export const G_RNG = 5;
export const G_LAST = 6;
export const G_RESULT = 7;
export const G_NEED = 8;
export const G_MAXR = 9;
export const G_SEED = 10;
export const G_VER = 11;
/** 5 rounds × (code, hp1, hp2, frame). */
export const G_ROUNDS = 12;
/** v20.4 styleByRound: per side, 5 rounds × (style + 1; 0 = unchanged), P1 at 32–36, P2 at 37–41. */
export const G_SBR = 32;
export const G_LEN = 48;

export const F_X = 0;
export const F_Y = 1;
export const F_VX = 2;
export const F_VY = 3;
export const F_FACE = 4;
export const F_HP = 5;
export const F_EN = 6;
export const F_ACT = 7;
export const F_AF = 8;
export const F_MOVE = 9;
export const F_HITS = 10;
export const F_STUN = 11;
export const F_STUNK = 12;
export const F_HSTOP = 13;
export const F_KDOWN = 14;
export const F_INV = 15;
export const F_ARMOR = 16;
export const F_CHITS = 17;
export const F_CSCALE = 18;
export const F_PREV = 19;
export const F_BUF = 20;
export const F_BUFF = 21;
/** lastDir[1..9]: F_LD + d − 1. */
export const F_LD = 22;
export const F_PD2 = 31;
export const F_PD3 = 32;
export const F_PD6 = 33;
export const F_CURDIR = 34;
export const F_TECH = 35;
export const F_WINS = 36;
export const F_SC = 37;
export const F_LPF = 38;
export const F_LKF = 39;
export const F_CHAIN = 40;
export const F_HITF = 41;
export const F_HITK = 42;
export const F_HITMV = 43;
export const F_HITX = 44;
export const F_HITY = 45;
export const F_KDF = 46;
export const F_STYLE = 48;
export const F_RANK = 49;
export const F_MASK = 50;
export const F_HPMAX = 51;
export const F_ATK = 52;
export const F_DEF = 53;
export const F_WALK = 54;
export const F_JUMP = 55;
export const F_ENP = 56;
export const F_BOT = 57;
/** 6 ints of bot memory (bot.ts). */
export const F_BOTMEM = 58;
export const F_LEN = 64;
export const STATE_LEN = G_LEN + 2 * F_LEN;

/** The first index of a fighter's block (side 0 = P1, red; 1 = P2, blue). */
export const fb = (side: number): number => G_LEN + side * F_LEN;

// ---------- params ----------
export interface FighterParams {
  style: number;
  rank: number;
  /** The unlocked specials: bit 0 = S1 … bit 4 = the Tuyệt kỹ. */
  movesMask: number;
  hpPct: number;
  /** 0 = a player; 1–8 a bot level; 9 = the dummy that never acts. */
  bot: number;
  /** Starting energy (fixtures, training, bosses). */
  en0: number;
  /** v20.4: the style of each round (≤ 5; a boss that changes style), with that style's stats; rounds past the list keep
   *  the last one it set. Absent: the style above for every round. */
  styleByRound?: number[];
  atk: number;
  def: number;
  walk: number;
  jump: number;
  energy: number;
}
export interface MatchParams {
  /** u32; drives the bots only. */
  seed: number;
  /** Rounds to win: 1 (one round) or 3 (best of 3). */
  rounds: 1 | 3;
  maxRounds: number;
  p1: FighterParams;
  p2: FighterParams;
  /** v20.3 PvP: the input delay N both clients use (2–6); not part of the sim. */
  delay?: number;
  /** 0060: a bot match whose bots roll from the server's secret stream (seed 0; bot.ts stepWithSecretBots). */
  secretBot?: boolean;
}

export const BOT_DUMMY = 9;

/** A fighter's params from its style and rank, with the style's stats copied in. */
export function fighterParams(style: number, rank: number, more: Partial<FighterParams> = {}): FighterParams {
  return { style, rank, movesMask: movesMaskForRank(rank), hpPct: 100, bot: 0, en0: 0, ...styleStats(style), ...more };
}
export function makeParams(p1: FighterParams, p2: FighterParams, more: Partial<Omit<MatchParams, "p1" | "p2">> = {}): MatchParams {
  return { seed: 1, rounds: 3, maxRounds: 5, p1, p2, ...more };
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const T = Math.trunc;

function resetFighter(s: State, side: number): void {
  const b = fb(side);
  s[b + F_X] = side === 0 ? START_X1 : START_X2;
  s[b + F_Y] = 0;
  s[b + F_VX] = 0;
  s[b + F_VY] = 0;
  s[b + F_FACE] = side === 0 ? 1 : -1;
  s[b + F_HP] = s[b + F_HPMAX];
  s[b + F_ACT] = A_IDLE;
  s[b + F_AF] = 0;
  s[b + F_MOVE] = 0;
  s[b + F_HITS] = 0;
  s[b + F_STUN] = 0;
  s[b + F_STUNK] = 0;
  s[b + F_HSTOP] = 0;
  s[b + F_KDOWN] = 0;
  s[b + F_INV] = 0;
  s[b + F_ARMOR] = 0;
  s[b + F_CHITS] = 0;
  s[b + F_CSCALE] = 100;
  s[b + F_BUF] = 0;
  s[b + F_BUFF] = NEVER;
  for (let d = 0; d < 9; d++) s[b + F_LD + d] = NEVER;
  s[b + F_PD2] = NEVER;
  s[b + F_PD3] = NEVER;
  s[b + F_PD6] = NEVER;
  s[b + F_CURDIR] = 5;
  s[b + F_TECH] = 0;
  s[b + F_SC] = 0;
  s[b + F_LPF] = NEVER;
  s[b + F_LKF] = NEVER;
  s[b + F_CHAIN] = 0;
  s[b + F_HITF] = NEVER;
  s[b + F_HITK] = 0;
  s[b + F_HITMV] = 0;
  s[b + F_HITX] = 0;
  s[b + F_HITY] = 0;
  s[b + F_KDF] = 0;
  // v20.4: a style change at the round's start (styleByRound), with the style row's stats
  const sbr = s[G_SBR + side * 5 + s[G_ROUND] - 1];
  if (sbr > 0) {
    const st = sbr - 1;
    s[b + F_STYLE] = st;
    s[b + F_ATK] = styleField(st, S_ATK);
    s[b + F_DEF] = styleField(st, S_DEF);
    s[b + F_WALK] = styleField(st, S_WALK);
    s[b + F_JUMP] = styleField(st, S_JUMP);
    s[b + F_ENP] = styleField(st, S_ENERGY);
  }
}

export function createMatch(p: MatchParams): State {
  const s: State = new Array<number>(STATE_LEN).fill(0);
  const seed = p.seed | 0;
  s[G_PHASE] = PH_INTRO;
  s[G_LEFT] = INTRO_FRAMES;
  s[G_ROUND] = 1;
  s[G_TIMER] = ROUND_FRAMES;
  s[G_RNG] = seed;
  s[G_NEED] = p.rounds === 1 ? 1 : 2;
  s[G_MAXR] = clamp(T(p.maxRounds), 1, 5);
  s[G_SEED] = seed;
  s[G_VER] = ENGINE_VERSION;
  const fs = [p.p1, p.p2];
  for (let side = 0; side < 2; side++) {
    const b = fb(side), f = fs[side];
    s[b + F_STYLE] = clamp(T(f.style), 0, 7);
    s[b + F_RANK] = clamp(T(f.rank), 0, 4);
    s[b + F_MASK] = clamp(T(f.movesMask), 0, 31);
    s[b + F_HPMAX] = T((1000 * clamp(T(f.hpPct), 1, 300)) / 100);
    s[b + F_ATK] = clamp(T(f.atk), 50, 200);
    s[b + F_DEF] = clamp(T(f.def), 50, 200);
    s[b + F_WALK] = clamp(T(f.walk), 50, 200);
    s[b + F_JUMP] = clamp(T(f.jump), 50, 200);
    s[b + F_ENP] = clamp(T(f.energy), 50, 200);
    s[b + F_BOT] = clamp(T(f.bot), 0, 9);
    s[b + F_EN] = clamp(T(f.en0), 0, ENERGY_MAX);
    s[b + F_PREV] = 0;
    const sbr = f.styleByRound ?? [];
    for (let k = 0; k < 5 && k < sbr.length; k++) s[G_SBR + side * 5 + k] = clamp(T(sbr[k]), 0, 7) + 1;
    resetFighter(s, side);
  }
  return s;
}

// ---------- small helpers (each mirrored in SQL) ----------

/** Numpad direction (1–9, 5 = neutral) of a mask, relative to facing (6 = forward). */
export function dirOf(mask: number, face: number): number {
  const l = mask & 1, r = (mask >> 1) & 1, u = (mask >> 2) & 1, d = (mask >> 3) & 1;
  let h = 0;
  if (l !== r) h = r === 1 ? face : -face;
  let v = 0;
  if (u !== d) v = u === 1 ? 1 : -1;
  return 5 + h + 3 * v;
}

/** The move record id a fighter is doing (−1: none). */
export const curMove = (s: State, b: number): number => s[b + F_MOVE] - 1;

export function isAirborne(s: State, b: number): boolean {
  const a = s[b + F_ACT];
  return s[b + F_Y] > 0 || a === A_JUMP || a === A_JATTACK || a === A_FALL;
}

export function isCrouching(s: State, b: number): boolean {
  const a = s[b + F_ACT];
  if (a === A_CROUCH || a === A_CGUARD) return true;
  if ((a === A_HITSTUN || a === A_BLOCKSTUN) && s[b + F_STUNK] === 2) return true;
  return a === A_ATTACK && mv(curMove(s, b), M_KIND) === K_CROUCH;
}

/** Free to act: idle, walking, crouching, guarding, or past a dodge's "may act" frame. */
export function isFree(s: State, b: number): boolean {
  const a = s[b + F_ACT];
  if (a <= A_CGUARD) return true;
  if (a === A_ATTACK) {
    const fr = mv(curMove(s, b), M_FREE);
    return fr > 0 && s[b + F_AF] >= fr;
  }
  return false;
}

/** The startup a fighter's current move really has (the shortcut adds 2). */
const startupOf = (s: State, b: number, id: number): number => mv(id, M_S) + SHORTCUT_STARTUP * s[b + F_SC];

function hurtbox(s: State, b: number): readonly [number, number] {
  if (isAirborne(s, b)) return HURT_AIR;
  if (isCrouching(s, b)) return HURT_CROUCH;
  return HURT_STAND;
}

function invulnerable(s: State, b: number, f: number, isThrow: boolean): boolean {
  const a = s[b + F_ACT];
  if (a === A_FALL || a === A_KNOCKDOWN || a === A_THROW || a === A_THROWN || a === A_TECHED) return true;
  if (f <= s[b + F_INV]) return true;
  if (a === A_ATTACK) {
    const id = curMove(s, b), af = s[b + F_AF];
    const ib = mv(id, M_INV_B);
    if (ib > 0 && af >= mv(id, M_INV_A) && af <= ib) return true;
    if (!isThrow && (mv(id, M_FLAGS) & F_DODGE) !== 0 && af >= mv(id, M_WIN_A) && af <= mv(id, M_WIN_B)) return true;
  }
  return false;
}

function grabbable(s: State, b: number): boolean {
  if (s[b + F_Y] !== 0) return false;
  const a = s[b + F_ACT];
  return !(a === A_HITSTUN || a === A_BLOCKSTUN || a === A_FALL || a === A_KNOCKDOWN || a === A_THROW
    || a === A_THROWN || a === A_TECHED || a === A_JUMP || a === A_JATTACK);
}

/** Whether the defender blocks an attack of this height (air = a jump attack). */
function blocks(s: State, o: number, height: number, air: boolean): boolean {
  const a = s[o + F_ACT];
  if (!(a <= A_CGUARD || a === A_BLOCKSTUN) || s[o + F_Y] !== 0) return false;
  const m = s[o + F_PREV];
  const d = dirOf(m, s[o + F_FACE]);
  const back = d === 1 || d === 4 || d === 7;
  if (!back && (m & IN_BL) === 0) return false;
  const crouch = d <= 3;
  if ((height === H_OVERHEAD || air) && crouch) return false;
  if (height === H_LOW && !crouch) return false;
  return true;
}

function motionDone(s: State, b: number, mo: number, pf: number): boolean {
  const l1 = s[b + F_LD], l2 = s[b + F_LD + 1], l3 = s[b + F_LD + 2], l4 = s[b + F_LD + 3], l6 = s[b + F_LD + 5];
  let t: number;
  if (mo === MO_QCF) {
    if (!(l2 < l3 && l3 < l6 && l6 - l2 <= 12)) return false;
    t = l6;
  } else if (mo === MO_QCB) {
    if (!(l2 < l1 && l1 < l4 && l4 - l2 <= 12)) return false;
    t = l4;
  } else if (mo === MO_DP) {
    if (!(l6 < l2 && l2 < l3 && l3 - l6 <= 14)) return false;
    t = l3;
  } else if (mo === MO_DD) {
    const p2 = s[b + F_PD2];
    if (!(p2 < l2 && l2 - p2 <= 14)) return false;
    t = l2;
  } else {
    const p2 = s[b + F_PD2], p3 = s[b + F_PD3], p6 = s[b + F_PD6];
    if (!(p2 < p3 && p3 < p6 && p6 < l2 && l2 < l3 && l3 < l6 && l6 - p2 <= 24)) return false;
    t = l6;
  }
  return pf >= t && pf - t <= PRESS_WINDOW;
}

function btnMatch(btn: number, bits: number): boolean {
  if (btn === B_P) return (bits & (IN_LP | IN_HP)) !== 0;
  if (btn === B_K) return (bits & (IN_LK | IN_HK)) !== 0;
  if (btn === B_HP) return (bits & IN_HP) !== 0;
  if (btn === B_HK) return (bits & IN_HK) !== 0;
  return false;
}

const MOTION_ORDER = [MO_QCF2, MO_DP, MO_QCF, MO_QCB, MO_DD];

/** A special this fighter can do now (unlocked, affordable): its record id, else −1. */
function specialOk(s: State, b: number, slot: number, extra: number): number {
  const id = s[b + F_STYLE] * MOVES_PER_STYLE + 12 + slot;
  if (mv(id, M_KIND) === K_NONE) return -1;
  if ((s[b + F_MASK] & (1 << (slot - 1))) === 0) return -1;
  if (s[b + F_EN] < mv(id, M_COST) + extra) return -1;
  return id;
}

/** What a buffered press does: move index (0–17) × 2 + shortcut flag, else −1. `cancel`: only specials and chains. */
function resolve(s: State, b: number, mask: number, cancel: boolean): number {
  const bits = s[b + F_BUF], pf = s[b + F_BUFF], style = s[b + F_STYLE];
  const d = dirOf(mask, s[b + F_FACE]);
  if (s[b + F_ACT] === A_JUMP) {
    if ((bits & IN_HK) !== 0) return MV_JHK * 2;
    if ((bits & IN_HP) !== 0) return MV_JHP * 2;
    if ((bits & IN_LK) !== 0) return MV_JLK * 2;
    if ((bits & IN_LP) !== 0) return MV_JLP * 2;
    return -1;
  }
  // the Chiêu shortcut: O, O+back, O+down, O+forward, O+Đỡ
  if ((bits & IN_SK) !== 0) {
    let slot = 1;
    if ((mask & IN_BL) !== 0) slot = 5;
    else if (d <= 3) slot = 3;
    else if (d === 4 || d === 7) slot = 2;
    else if (d === 6 || d === 9) slot = 4;
    if (specialOk(s, b, slot, SHORTCUT_COST) >= 0) return (12 + slot) * 2 + 1;
  }
  for (const mo of MOTION_ORDER) {
    if (!motionDone(s, b, mo, pf)) continue;
    for (let slot = 1; slot <= 5; slot++) {
      const id = style * MOVES_PER_STYLE + 12 + slot;
      if (mv(id, M_MOTION) !== mo || !btnMatch(mv(id, M_BTN), bits)) continue;
      if (specialOk(s, b, slot, 0) >= 0) return (12 + slot) * 2;
    }
  }
  const crouch = d <= 3;
  if (cancel) {
    // a style's chain (Karate LP → HP, Vịnh Xuân LP → LP → LP)
    const cur = curMove(s, b) - style * MOVES_PER_STYLE;
    const to = styleField(style, S_CHAIN_TO);
    if (!crouch && to >= 0 && cur === styleField(style, S_CHAIN_FROM) && s[b + F_CHAIN] < styleField(style, S_CHAIN_MAX)) {
      if ((to === MV_LP && (bits & IN_LP) !== 0) || (to === MV_HP && (bits & IN_HP) !== 0)) return to * 2;
    }
    return -1;
  }
  if ((bits & (IN_LP | IN_LK)) !== 0 && s[b + F_LPF] >= pf - THROW_GAP && s[b + F_LKF] >= pf - THROW_GAP) return MV_THROW * 2;
  if ((bits & IN_HK) !== 0) return (crouch ? MV_CHK : MV_HK) * 2;
  if ((bits & IN_HP) !== 0) return (crouch ? MV_CHP : MV_HP) * 2;
  if ((bits & IN_LK) !== 0) return (crouch ? MV_CLK : MV_LK) * 2;
  if ((bits & IN_LP) !== 0) return (crouch ? MV_CLP : MV_LP) * 2;
  return -1;
}

function startMove(s: State, b: number, code: number): void {
  const idx = code >> 1, sc = code & 1, style = s[b + F_STYLE];
  const id = style * MOVES_PER_STYLE + idx;
  const slot = mv(id, M_SLOT);
  if (slot > 0) s[b + F_EN] -= mv(id, M_COST) + sc * SHORTCUT_COST;
  const chained = s[b + F_ACT] === A_ATTACK && idx === styleField(style, S_CHAIN_TO)
    && curMove(s, b) - style * MOVES_PER_STYLE === styleField(style, S_CHAIN_FROM);
  s[b + F_CHAIN] = chained ? s[b + F_CHAIN] + 1 : 0;
  s[b + F_ACT] = mv(id, M_KIND) === K_JUMP ? A_JATTACK : A_ATTACK;
  s[b + F_AF] = 1;
  s[b + F_MOVE] = id + 1;
  s[b + F_HITS] = 0;
  s[b + F_SC] = sc;
  s[b + F_ARMOR] = (mv(id, M_FLAGS) & FL_ARMOR) !== 0 ? 1 : 0;
  s[b + F_HSTOP] = 0;
  if (s[b + F_ACT] === A_ATTACK) s[b + F_VX] = 0;
  s[b + F_BUF] = 0;
}

function setAction(s: State, b: number, act: number): void {
  if (s[b + F_ACT] !== act) {
    s[b + F_ACT] = act;
    s[b + F_AF] = 1;
  }
  s[b + F_MOVE] = 0;
  s[b + F_SC] = 0;
}

/** Advances the current action by one frame: timers and the transitions they end in. */
function advance(s: State, b: number, o: number, f: number): void {
  s[b + F_AF] += 1;
  const a = s[b + F_ACT], af = s[b + F_AF];
  if (a === A_ATTACK) {
    const id = curMove(s, b);
    if (af > startupOf(s, b, id) + mv(id, M_A) + mv(id, M_R)) setAction(s, b, A_IDLE);
  } else if (a === A_PREJUMP) {
    if (af > PREJUMP_FRAMES) {
      s[b + F_ACT] = A_JUMP;
      s[b + F_AF] = 1;
      s[b + F_VY] = T((JUMP_VY * s[b + F_JUMP]) / 100);
    }
  } else if (a === A_LAND) {
    if (af > LANDING_FRAMES) setAction(s, b, A_IDLE);
  } else if (a === A_HITSTUN || a === A_BLOCKSTUN || a === A_TECHED) {
    if (s[b + F_STUN] > 0) s[b + F_STUN] -= 1;
    else setAction(s, b, A_IDLE);
  } else if (a === A_KNOCKDOWN) {
    if (s[b + F_KDOWN] > 0) s[b + F_KDOWN] -= 1;
    else setAction(s, b, A_IDLE);
  } else if (a === A_THROW) {
    if (af > mv(curMove(s, b), M_TECH) + THROW_TAIL) setAction(s, b, A_IDLE);
  } else if (a === A_THROWN) {
    // a tech: LP and LK within 2 frames of each other, no sooner than 2 frames before the throw connected
    const since = f - af + 1 - THROW_GAP;
    const lp = s[b + F_LPF], lk = s[b + F_LKF];
    if (lp >= since && lk >= since && (lp - lk <= THROW_GAP && lk - lp <= THROW_GAP)) {
      const dir = s[o + F_FACE];
      s[o + F_ACT] = A_TECHED;
      s[o + F_AF] = 1;
      s[o + F_STUN] = TECHED_FRAMES;
      s[o + F_MOVE] = 0;
      s[b + F_ACT] = A_TECHED;
      s[b + F_AF] = 1;
      s[b + F_STUN] = TECHED_FRAMES;
      s[o + F_X] = clamp(s[o + F_X] - dir * TECH_PUSH, STAGE_MIN, STAGE_MAX);
      s[b + F_X] = clamp(s[b + F_X] + dir * TECH_PUSH, STAGE_MIN, STAGE_MAX);
      s[b + F_HITF] = f;
      s[b + F_HITK] = HK_BLOCK;
      s[b + F_HITMV] = s[o + F_MOVE];
      return;
    }
    s[b + F_TECH] -= 1;
    if (s[b + F_TECH] <= 0) {
      // the throw lands
      const id = curMove(s, o);
      const face = s[o + F_FACE];
      comboHit(s, b);
      const dmg = T((T((mv(id, M_DMG) * s[o + F_ATK]) / s[b + F_DEF]) * s[b + F_CSCALE]) / 100);
      s[b + F_HP] = Math.max(0, s[b + F_HP] - dmg);
      gain(s, o, EN_HIT);
      gain(s, b, EN_TAKEN);
      s[b + F_ACT] = A_KNOCKDOWN;
      s[b + F_AF] = 1;
      s[b + F_KDOWN] = KD_FRAMES;
      push(s, b, o, face, mv(id, M_PB));
      mark(s, b, f, HK_THROW, id, face, 30);
    }
  }
}

function gain(s: State, b: number, base: number): void {
  s[b + F_EN] = Math.min(ENERGY_MAX, s[b + F_EN] + T((base * s[b + F_ENP]) / 100));
}

/** A new hit of a combo on this fighter: count it and set the scale. */
function comboHit(s: State, b: number): void {
  s[b + F_CHITS] += 1;
  s[b + F_CSCALE] = Math.max(40, 100 - 10 * (s[b + F_CHITS] - 1));
}

/** Pushes the defender `pb` px away from the attacker; what a wall stops moves the attacker back. */
function push(s: State, o: number, b: number, face: number, pb: number): void {
  const want = s[o + F_X] + face * pb * SUB;
  const nx = clamp(want, STAGE_MIN, STAGE_MAX);
  s[o + F_X] = nx;
  const rest = want - nx;
  if (rest !== 0) s[b + F_X] = clamp(s[b + F_X] - rest, STAGE_MIN, STAGE_MAX);
}

/** Render keys: what the fighter took, when, from which move, and where the spark goes (px). */
function mark(s: State, o: number, f: number, kind: number, id: number, face: number, yPx: number): void {
  s[o + F_HITF] = f;
  s[o + F_HITK] = kind;
  s[o + F_HITMV] = id + 1;
  s[o + F_HITX] = T(s[o + F_X] / SUB) - face * 6;
  s[o + F_HITY] = yPx;
}

/** The free fighter's turn: face the foe, then a buffered command, else movement from the held directions. */
function act(s: State, b: number, o: number, mask: number, fight: boolean): void {
  s[b + F_CHITS] = 0;
  if (s[b + F_Y] === 0) {
    const dx = s[o + F_X] - s[b + F_X];
    if (dx > 0) s[b + F_FACE] = 1;
    else if (dx < 0) s[b + F_FACE] = -1;
  }
  const dodging = s[b + F_ACT] === A_ATTACK;
  if (!fight) {
    if (!dodging) setAction(s, b, A_IDLE);
    return;
  }
  if (s[b + F_BUF] !== 0) {
    const code = resolve(s, b, mask, false);
    s[b + F_BUF] = 0;
    if (code >= 0) {
      startMove(s, b, code);
      return;
    }
  }
  const face = s[b + F_FACE];
  const d = dirOf(mask, face);
  const bl = (mask & IN_BL) !== 0;
  let next: number;
  if (d >= 7) next = A_PREJUMP;
  else if (d <= 3) next = bl || d === 1 ? A_CGUARD : A_CROUCH;
  else if (bl) next = A_GUARD;
  else if (d === 6) next = A_WALKF;
  else if (d === 4) next = A_WALKB;
  else next = A_IDLE;
  if (dodging && next === A_IDLE) return;
  if (next === A_PREJUMP) {
    const vx = T((JUMP_VX * s[b + F_JUMP]) / 100);
    s[b + F_VX] = d === 9 ? vx * face : d === 7 ? -vx * face : 0;
    s[b + F_ACT] = A_PREJUMP;
    s[b + F_AF] = 1;
    s[b + F_MOVE] = 0;
    s[b + F_SC] = 0;
    return;
  }
  setAction(s, b, next);
}

function canCancel(s: State, b: number): boolean {
  if (s[b + F_ACT] !== A_ATTACK || s[b + F_HITS] === 0) return false;
  const id = curMove(s, b), style = s[b + F_STYLE];
  const idx = id - style * MOVES_PER_STYLE;
  if ((mv(id, M_FLAGS) & F_CANCEL) === 0 && idx !== styleField(style, S_CHAIN_FROM)) return false;
  return s[b + F_AF] <= startupOf(s, b, id) + mv(id, M_A);
}

function tryCancel(s: State, b: number, mask: number): boolean {
  if (s[b + F_BUF] === 0 || !canCancel(s, b)) return false;
  const code = resolve(s, b, mask, true);
  if (code < 0) return false;
  startMove(s, b, code);
  return true;
}

function physics(s: State, b: number, f: number): void {
  const a = s[b + F_ACT], face = s[b + F_FACE];
  if (a === A_WALKF) {
    s[b + F_X] = clamp(s[b + F_X] + face * T((WALK_F * s[b + F_WALK]) / 100), STAGE_MIN, STAGE_MAX);
  } else if (a === A_WALKB) {
    s[b + F_X] = clamp(s[b + F_X] - face * T((WALK_B * s[b + F_WALK]) / 100), STAGE_MIN, STAGE_MAX);
  } else if (a === A_ATTACK) {
    const id = curMove(s, b), tr = mv(id, M_TRAV), st = startupOf(s, b, id), af = s[b + F_AF];
    if (tr > 0 && af <= st) {
      const dx = T((tr * SUB * af) / st) - T((tr * SUB * (af - 1)) / st);
      s[b + F_X] = clamp(s[b + F_X] + face * dx, STAGE_MIN, STAGE_MAX);
    }
  } else if (a === A_JUMP || a === A_JATTACK || a === A_FALL) {
    s[b + F_X] = clamp(s[b + F_X] + s[b + F_VX], STAGE_MIN, STAGE_MAX);
    s[b + F_Y] += s[b + F_VY];
    s[b + F_VY] -= GRAVITY;
    if (s[b + F_Y] <= 0) {
      s[b + F_Y] = 0;
      s[b + F_VY] = 0;
      s[b + F_VX] = 0;
      if (a === A_FALL && s[b + F_KDF] === 1) {
        s[b + F_ACT] = A_KNOCKDOWN;
        s[b + F_AF] = 1;
        s[b + F_KDOWN] = s[b + F_HP] <= 0 ? KO_FRAMES : KD_FRAMES;
      } else {
        if (a === A_FALL) s[b + F_INV] = f + LANDING_FRAMES;
        s[b + F_ACT] = A_LAND;
        s[b + F_AF] = 1;
        s[b + F_MOVE] = 0;
        s[b + F_SC] = 0;
      }
      s[b + F_KDF] = 0;
    }
  }
}

function fighterFrame(s: State, side: number, mask: number, f: number, fight: boolean): void {
  const b = fb(side), o = fb(1 - side);
  if (fight) {
    const dir = dirOf(mask, s[b + F_FACE]);
    if (dir !== s[b + F_CURDIR]) {
      if (dir === 2) s[b + F_PD2] = s[b + F_LD + 1];
      else if (dir === 3) s[b + F_PD3] = s[b + F_LD + 2];
      else if (dir === 6) s[b + F_PD6] = s[b + F_LD + 5];
      s[b + F_LD + dir - 1] = f;
      s[b + F_CURDIR] = dir;
    }
    const press = mask & ~s[b + F_PREV] & IN_BUTTONS;
    if (press !== 0) {
      if ((press & IN_LP) !== 0) s[b + F_LPF] = f;
      if ((press & IN_LK) !== 0) s[b + F_LKF] = f;
      s[b + F_BUF] = press;
      s[b + F_BUFF] = f;
    }
  }
  s[b + F_PREV] = mask;
  if (s[b + F_BUF] !== 0 && f - s[b + F_BUFF] > BUFFER_FRAMES) s[b + F_BUF] = 0;
  if (!fight) s[b + F_BUF] = 0;

  if (s[b + F_HSTOP] > 0) {
    s[b + F_HSTOP] -= 1;
    if (fight) tryCancel(s, b, mask);
    return;
  }
  advance(s, b, o, f);
  const a = s[b + F_ACT];
  if (isFree(s, b)) act(s, b, o, mask, fight);
  else if (fight && a === A_JUMP && s[b + F_BUF] !== 0) {
    const code = resolve(s, b, mask, false);
    s[b + F_BUF] = 0;
    if (code >= 0) startMove(s, b, code);
  } else if (fight && a === A_ATTACK) tryCancel(s, b, mask);
  physics(s, b, f);
}

/** Keeps the pushboxes apart (fighters never overlap). */
function separate(s: State): void {
  const b1 = fb(0), b2 = fb(1);
  let x1 = s[b1 + F_X], x2 = s[b2 + F_X];
  const dist = x1 < x2 ? x2 - x1 : x1 - x2;
  if (dist >= PUSH_W) return;
  const over = PUSH_W - dist, h1 = T(over / 2), h2 = over - h1;
  const leftFirst = x1 < x2 || (x1 === x2 && s[b1 + F_FACE] > 0);
  if (leftFirst) {
    x1 -= h1;
    x2 += h2;
    if (x1 < STAGE_MIN) { x1 = STAGE_MIN; x2 = STAGE_MIN + PUSH_W; }
    if (x2 > STAGE_MAX) { x2 = STAGE_MAX; x1 = STAGE_MAX - PUSH_W; }
  } else {
    x1 += h1;
    x2 -= h2;
    if (x2 < STAGE_MIN) { x2 = STAGE_MIN; x1 = STAGE_MIN + PUSH_W; }
    if (x1 > STAGE_MAX) { x1 = STAGE_MAX; x2 = STAGE_MAX - PUSH_W; }
  }
  s[b1 + F_X] = x1;
  s[b2 + F_X] = x2;
}

/** What the attacker's move does to the defender this frame (from the frame's state, before anything applies). */
function contact(s: State, side: number, f: number): number {
  const b = fb(side), o = fb(1 - side);
  if (s[b + F_HSTOP] > 0) return R_NONE;
  const a = s[b + F_ACT];
  if (a !== A_ATTACK && a !== A_JATTACK) return R_NONE;
  const id = curMove(s, b), kind = mv(id, M_KIND);
  if (kind === K_PARRY || kind === K_DODGE) return R_NONE;
  const act = mv(id, M_A), i = s[b + F_AF] - startupOf(s, b, id) - 1;
  if (i < 0 || i >= act) return R_NONE;
  const grabby = kind === K_THROW || kind === K_GRAB;
  const hitsMax = grabby ? 1 : mv(id, M_HITS);
  const done = s[b + F_HITS];
  if (done >= hitsMax || done * act >= (i + 1) * hitsMax) return R_NONE;
  const face = s[b + F_FACE];
  if (grabby) {
    if (!grabbable(s, o) || invulnerable(s, o, f, true)) return R_NONE;
    const dx = (s[o + F_X] - s[b + F_X]) * face;
    if (kind === K_THROW) {
      const dist = dx < 0 ? -dx : dx;
      return dist <= mv(id, M_REACH) * SUB ? R_THROW : R_NONE;
    }
    if (dx < mv(id, M_GMIN) * SUB || dx > mv(id, M_GMAX) * SUB) return R_NONE;
    if ((mv(id, M_FLAGS) & F_NOCROUCH) !== 0 && isCrouching(s, o)) return R_NONE;
    return R_GRAB;
  }
  if (invulnerable(s, o, f, false)) return R_NONE;
  const ax = s[b + F_X], ay = s[b + F_Y];
  const lo = face > 0 ? ax + mv(id, M_NEAR) * SUB : ax - mv(id, M_REACH) * SUB;
  const hi = face > 0 ? ax + mv(id, M_REACH) * SUB : ax - mv(id, M_NEAR) * SUB;
  const ylo = ay + mv(id, M_YLO) * SUB, yhi = ay + mv(id, M_YHI) * SUB;
  const hb = hurtbox(s, o);
  const hx0 = s[o + F_X] - hb[0] * 128, hx1 = s[o + F_X] + hb[0] * 128;
  const hy0 = s[o + F_Y], hy1 = s[o + F_Y] + hb[1] * SUB;
  if (!(lo < hx1 && hx0 < hi && ylo < hy1 && hy0 < yhi)) return R_NONE;
  const air = kind === K_JUMP, height = mv(id, M_HEIGHT);
  if (s[o + F_ACT] === A_ATTACK) {
    const did = curMove(s, o), daf = s[o + F_AF], dfl = mv(did, M_FLAGS);
    const inWin = daf >= mv(did, M_WIN_A) && daf <= mv(did, M_WIN_B);
    if (air && (dfl & F_AAINV) !== 0 && inWin) return R_NONE;
    if (height === H_LOW && (dfl & F_AIRBORNE) !== 0 && inWin) return R_NONE;
    if (mv(did, M_KIND) === K_PARRY && inWin) return R_PARRY;
    if ((dfl & FL_ARMOR) !== 0 && inWin && s[o + F_ARMOR] > 0) return R_ARMOR;
  }
  if (blocks(s, o, height, air)) return R_BLOCK;
  return R_HIT;
}

/** The hit reaction: fall if airborne, knockdown, or hitstun. */
function react(s: State, o: number, b: number, kd: boolean, hitstun: number): void {
  const face = s[b + F_FACE];
  const air = isAirborne(s, o), crouch = isCrouching(s, o);
  s[o + F_MOVE] = 0;
  s[o + F_SC] = 0;
  s[o + F_ARMOR] = 0;
  s[o + F_STUN] = 0;
  if (air) {
    s[o + F_ACT] = A_FALL;
    s[o + F_AF] = 1;
    s[o + F_VX] = face * SUB;
    if (s[o + F_VY] > 0) s[o + F_VY] = 0;
    s[o + F_KDF] = kd ? 1 : 0;
  } else if (kd) {
    s[o + F_ACT] = A_KNOCKDOWN;
    s[o + F_AF] = 1;
    s[o + F_KDOWN] = KD_FRAMES;
  } else {
    s[o + F_STUNK] = crouch ? 2 : 1;
    s[o + F_ACT] = A_HITSTUN;
    s[o + F_AF] = 1;
    s[o + F_STUN] = hitstun;
  }
}

function apply(s: State, side: number, code: number, f: number, id: number): void {
  const b = fb(side), o = fb(1 - side);
  const face = s[b + F_FACE];
  const yPx = T(s[b + F_Y] / SUB) + T((mv(id, M_YLO) + mv(id, M_YHI)) / 2);
  const heavy = (mv(id, M_FLAGS) & F_HEAVY) !== 0;
  if (code === R_HIT) {
    const first = s[b + F_HITS] === 0;
    s[b + F_HITS] += 1;
    const last = s[b + F_HITS] >= mv(id, M_HITS);
    if (first || s[o + F_CHITS] === 0) comboHit(s, o);
    const dmg = T((T((mv(id, M_DMG) * s[b + F_ATK]) / s[o + F_DEF]) * s[o + F_CSCALE]) / 100);
    s[o + F_HP] = Math.max(0, s[o + F_HP] - dmg);
    gain(s, b, EN_HIT);
    gain(s, o, EN_TAKEN);
    s[b + F_HSTOP] = HITSTOP_HIT;
    s[o + F_HSTOP] = HITSTOP_HIT;
    const grounded = !isAirborne(s, o);
    react(s, o, b, (mv(id, M_FLAGS) & F_KD) !== 0 && last, mv(id, M_HITSTUN));
    if (grounded) push(s, o, b, face, mv(id, M_PB));
    mark(s, o, f, heavy ? HK_HEAVY : HK_HIT, id, face, yPx);
  } else if (code === R_BLOCK) {
    s[b + F_HITS] += 1;
    if (mv(id, M_SLOT) > 0) {
      const chip = T((T((mv(id, M_DMG) * s[b + F_ATK]) / s[o + F_DEF]) * mv(id, M_CHIP)) / 8);
      if (chip > 0) s[o + F_HP] = Math.max(1, s[o + F_HP] - chip);
    }
    gain(s, b, EN_BLOCKED);
    gain(s, o, EN_BLOCK);
    s[b + F_HSTOP] = HITSTOP_BLOCK;
    s[o + F_HSTOP] = HITSTOP_BLOCK;
    s[o + F_STUNK] = dirOf(s[o + F_PREV], s[o + F_FACE]) <= 3 ? 2 : 1;
    s[o + F_ACT] = A_BLOCKSTUN;
    s[o + F_AF] = 1;
    s[o + F_STUN] = mv(id, M_BLOCKSTUN);
    s[o + F_CHITS] = 0;
    push(s, o, b, face, mv(id, M_PB));
    mark(s, o, f, HK_BLOCK, id, face, yPx);
  } else if (code === R_PARRY) {
    // the defender's parry catches the strike and counters at once
    const pid = curMove(s, o);
    s[b + F_HITS] = mv(id, M_HITS);
    comboHit(s, b);
    const dmg = T((T((mv(pid, M_DMG) * mv(pid, M_HITS) * s[o + F_ATK]) / s[b + F_DEF]) * s[b + F_CSCALE]) / 100);
    s[b + F_HP] = Math.max(0, s[b + F_HP] - dmg);
    gain(s, o, EN_HIT);
    gain(s, b, EN_TAKEN);
    s[b + F_HSTOP] = HITSTOP_HIT;
    s[o + F_HSTOP] = HITSTOP_HIT;
    s[o + F_HITS] = 1;
    s[o + F_AF] = mv(pid, M_WIN_B);
    const grounded = !isAirborne(s, b);
    react(s, b, o, (mv(pid, M_FLAGS) & F_KD) !== 0, 20);
    if (grounded) push(s, b, o, s[o + F_FACE], mv(pid, M_PB));
    mark(s, b, f, HK_COUNTER, pid, s[o + F_FACE], 36);
  } else if (code === R_ARMOR) {
    s[b + F_HITS] += 1;
    s[o + F_ARMOR] -= 1;
    const dmg = T((mv(id, M_DMG) * s[b + F_ATK]) / s[o + F_DEF]);
    s[o + F_HP] = Math.max(0, s[o + F_HP] - dmg);
    gain(s, b, EN_HIT);
    gain(s, o, EN_TAKEN);
    s[b + F_HSTOP] = HITSTOP_HIT;
    s[o + F_HSTOP] = HITSTOP_HIT;
    mark(s, o, f, HK_ARMOR, id, face, yPx);
  } else if (code === R_THROW) {
    s[b + F_HITS] = 1;
    s[b + F_ACT] = A_THROW;
    s[b + F_AF] = 1;
    s[o + F_ACT] = A_THROWN;
    s[o + F_AF] = 1;
    s[o + F_TECH] = mv(id, M_TECH);
    s[o + F_MOVE] = 0;
    s[o + F_SC] = 0;
    s[o + F_STUN] = 0;
    s[o + F_BUF] = 0;
  } else if (code === R_GRAB) {
    s[b + F_HITS] = 1;
    comboHit(s, o);
    const dmg = T((T((mv(id, M_DMG) * mv(id, M_HITS) * s[b + F_ATK]) / s[o + F_DEF]) * s[o + F_CSCALE]) / 100);
    s[o + F_HP] = Math.max(0, s[o + F_HP] - dmg);
    gain(s, b, EN_HIT);
    gain(s, o, EN_TAKEN);
    s[b + F_HSTOP] = HITSTOP_HIT;
    s[o + F_HSTOP] = HITSTOP_HIT;
    react(s, o, b, (mv(id, M_FLAGS) & F_KD) !== 0, 20);
    push(s, o, b, face, mv(id, M_PB));
    mark(s, o, f, HK_THROW, id, face, 30);
  }
}

function hits(s: State, f: number): void {
  let r0 = contact(s, 0, f), r1 = contact(s, 1, f);
  // strikes beat throws; two throws tech each other
  if ((r0 === R_THROW || r0 === R_GRAB) && r1 === R_HIT) r0 = R_NONE;
  if ((r1 === R_THROW || r1 === R_GRAB) && r0 === R_HIT) r1 = R_NONE;
  if ((r0 === R_THROW || r0 === R_GRAB) && (r1 === R_THROW || r1 === R_GRAB)) {
    const b1 = fb(0), b2 = fb(1);
    for (const b of [b1, b2]) {
      s[b + F_ACT] = A_TECHED;
      s[b + F_AF] = 1;
      s[b + F_STUN] = TECHED_FRAMES;
      s[b + F_MOVE] = 0;
      s[b + F_SC] = 0;
    }
    const dir = s[b1 + F_X] <= s[b2 + F_X] ? 1 : -1;
    s[b1 + F_X] = clamp(s[b1 + F_X] - dir * TECH_PUSH, STAGE_MIN, STAGE_MAX);
    s[b2 + F_X] = clamp(s[b2 + F_X] + dir * TECH_PUSH, STAGE_MIN, STAGE_MAX);
    return;
  }
  // both moves as they were before either applies (a hit clears the victim's move)
  const id0 = curMove(s, fb(0)), id1 = curMove(s, fb(1));
  if (r0 !== R_NONE) apply(s, 0, r0, f, id0);
  if (r1 !== R_NONE) apply(s, 1, r1, f, id1);
}

function knockOut(s: State, b: number): void {
  if (isAirborne(s, b)) {
    if (s[b + F_ACT] !== A_FALL) {
      s[b + F_ACT] = A_FALL;
      s[b + F_AF] = 1;
      if (s[b + F_VY] > 0) s[b + F_VY] = 0;
    }
    s[b + F_KDF] = 1;
  } else {
    s[b + F_ACT] = A_KNOCKDOWN;
    s[b + F_AF] = 1;
    s[b + F_KDOWN] = KO_FRAMES;
  }
  s[b + F_MOVE] = 0;
  s[b + F_SC] = 0;
}

function roundCheck(s: State, f: number): void {
  const b1 = fb(0), b2 = fb(1);
  const hp1 = s[b1 + F_HP], hp2 = s[b2 + F_HP];
  let reason: number, winner: number;
  if (hp1 <= 0 || hp2 <= 0) {
    reason = REASON_KO;
    winner = hp1 <= 0 && hp2 <= 0 ? 0 : hp1 <= 0 ? 2 : 1;
    if (hp1 <= 0) knockOut(s, b1);
    if (hp2 <= 0) knockOut(s, b2);
  } else if (s[G_TIMER] <= 0) {
    reason = REASON_TIME;
    const p1 = T((hp1 * 1000) / s[b1 + F_HPMAX]), p2 = T((hp2 * 1000) / s[b2 + F_HPMAX]);
    winner = p1 > p2 ? 1 : p2 > p1 ? 2 : 0;
  } else return;
  const r = G_ROUNDS + (s[G_ROUND] - 1) * 4;
  s[r] = reason * 4 + winner;
  s[r + 1] = hp1;
  s[r + 2] = hp2;
  s[r + 3] = f;
  s[G_LAST] = reason * 4 + winner;
  if (winner > 0) s[fb(winner - 1) + F_WINS] += 1;
  s[G_PHASE] = PH_END;
  s[G_LEFT] = END_FRAMES;
}

function endRound(s: State): void {
  const w1 = s[fb(0) + F_WINS], w2 = s[fb(1) + F_WINS], need = s[G_NEED];
  if (w1 >= need || w2 >= need) {
    s[G_PHASE] = PH_OVER;
    s[G_RESULT] = w1 >= need ? 1 : 2;
  } else if (s[G_ROUND] >= s[G_MAXR]) {
    s[G_PHASE] = PH_OVER;
    s[G_RESULT] = w1 > w2 ? 1 : w2 > w1 ? 2 : RESULT_DRAW;
  } else {
    s[G_ROUND] += 1;
    s[G_PHASE] = PH_INTRO;
    s[G_LEFT] = INTRO_FRAMES;
    s[G_TIMER] = ROUND_FRAMES;
    resetFighter(s, 0);
    resetFighter(s, 1);
  }
}

/** One 1/60 s frame. Pure: returns a new state. `a` and `b` are the two fighters' 10-bit input masks. */
export function step(s0: State, a: number, b: number): State {
  const s = s0.slice();
  const ph = s[G_PHASE];
  if (ph === PH_OVER) return s;
  s[G_FRAME] += 1;
  const f = s[G_FRAME];
  const ma = a & IN_ALL, mb = b & IN_ALL;
  if (ph === PH_INTRO) {
    s[fb(0) + F_PREV] = ma;
    s[fb(1) + F_PREV] = mb;
    s[G_LEFT] -= 1;
    if (s[G_LEFT] <= 0) s[G_PHASE] = PH_FIGHT;
    return s;
  }
  const fight = ph === PH_FIGHT;
  if (fight) s[G_TIMER] -= 1;
  fighterFrame(s, 0, ma, f, fight);
  fighterFrame(s, 1, mb, f, fight);
  separate(s);
  if (fight) {
    hits(s, f);
    roundCheck(s, f);
  } else {
    s[G_LEFT] -= 1;
    if (s[G_LEFT] <= 0) endRound(s);
  }
  return s;
}

/** FNV-1a (u32) over the state's ints, 4 bytes each, little-endian. */
export function hash(s: readonly number[]): number {
  let h = 0x811c9dc5;
  for (const v of s) {
    const u = v >>> 0;
    for (let k = 0; k < 32; k += 8) {
      h = (h ^ ((u >>> k) & 255)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
  }
  return h >>> 0;
}

/** Steps `n` frames from RLE runs `[mask, count, …]` (past a log's end the mask is 0). */
export function runFrames(s0: State, runsP1: readonly number[], runsP2: readonly number[], n: number): State {
  let s = s0;
  let i1 = 0, c1 = 0, i2 = 0, c2 = 0;
  for (let k = 0; k < n; k++) {
    while (i1 < runsP1.length && c1 >= runsP1[i1 + 1]) { i1 += 2; c1 = 0; }
    while (i2 < runsP2.length && c2 >= runsP2[i2 + 1]) { i2 += 2; c2 = 0; }
    const a = i1 < runsP1.length ? runsP1[i1] : 0;
    const b = i2 < runsP2.length ? runsP2[i2] : 0;
    c1++;
    c2++;
    s = step(s, a, b);
  }
  return s;
}

// ---------- read-outs for the renderer and the UI ----------
export const phaseOf = (s: State): number => s[G_PHASE];
export const isOver = (s: State): boolean => s[G_PHASE] === PH_OVER;
/** The round result codes played so far. */
export function roundResults(s: State): { reason: number; winner: number; hp1: number; hp2: number; frame: number }[] {
  const out = [];
  for (let r = 0; r < 5; r++) {
    const c = s[G_ROUNDS + r * 4];
    if (c === 0) break;
    out.push({ reason: c >> 2, winner: c & 3, hp1: s[G_ROUNDS + r * 4 + 1], hp2: s[G_ROUNDS + r * 4 + 2], frame: s[G_ROUNDS + r * 4 + 3] });
  }
  return out;
}
/** The special slot (1–5) of the fighter's current move, 0 for a normal or none. */
export function currentSlot(s: State, side: number): number {
  const b = fb(side);
  const id = curMove(s, b);
  return id >= 0 ? mv(id, M_SLOT) : 0;
}
