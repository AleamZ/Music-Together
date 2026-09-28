// v20 Võ đài: the move tables (spec §v20.1 "Frame data", "Styles, stats and traits", "Specials per style").
// Flattened to MOVE_TABLE (plain ints) for the engine and for the SQL mirror: 0048_fight_engine.sql's _fx_moves() is the
// same literal, pinned by tests/unit/fight-sql-mirror.test.ts. Any change here is a change of the engine: regenerate
// tests/fixtures/fight-cases.json and re-create _fx_moves() in the same commit (ruling R1).

/** Ints per move record. */
export const REC = 32;
/** Moves per style: 13 normals (the throw included), S1–S4 and the Tuyệt kỹ. */
export const MOVES_PER_STYLE = 18;
export const STYLE_COUNT = 8;
/** Ints per style row (after the moves). */
export const STYLE_REC = 16;
export const STYLE_BASE = STYLE_COUNT * MOVES_PER_STYLE * REC;

// ---- move record fields ----
export const M_KIND = 0;
export const M_SLOT = 1;
export const M_MOTION = 2;
export const M_BTN = 3;
export const M_S = 4;
export const M_A = 5;
export const M_R = 6;
export const M_DMG = 7;
export const M_HITS = 8;
export const M_HITSTUN = 9;
export const M_BLOCKSTUN = 10;
export const M_REACH = 11;
export const M_NEAR = 12;
export const M_YLO = 13;
export const M_YHI = 14;
export const M_HEIGHT = 15;
export const M_FLAGS = 16;
export const M_INV_A = 17;
export const M_INV_B = 18;
export const M_TRAV = 19;
export const M_PB = 20;
export const M_CHIP = 21;
export const M_COST = 22;
export const M_GMIN = 23;
export const M_GMAX = 24;
export const M_WIN_A = 25;
export const M_WIN_B = 26;
export const M_FREE = 27;
export const M_TECH = 28;

// ---- style row fields ----
export const S_ATK = 0;
export const S_DEF = 1;
export const S_WALK = 2;
export const S_JUMP = 3;
export const S_ENERGY = 4;
export const S_CHAIN_FROM = 5;
export const S_CHAIN_TO = 6;
export const S_CHAIN_MAX = 7;

// ---- kinds ----
export const K_NONE = 0;
export const K_STAND = 1;
export const K_CROUCH = 2;
export const K_JUMP = 3;
export const K_THROW = 4;
export const K_STRIKE = 5;
export const K_GRAB = 6;
export const K_PARRY = 7;
export const K_DODGE = 8;

// ---- motions ----
export const MO_NONE = 0;
export const MO_QCF = 1;
export const MO_QCB = 2;
export const MO_DP = 3;
export const MO_DD = 4;
export const MO_QCF2 = 5;

// ---- button classes of a special ----
export const B_P = 1;
export const B_K = 2;
export const B_HP = 3;
export const B_HK = 4;

// ---- heights ----
export const H_MID = 0;
export const H_HIGH = 1;
export const H_LOW = 2;
export const H_OVERHEAD = 3;

// ---- flags ----
export const F_KD = 1;
export const F_CANCEL = 2;
/** Upper body invulnerable to air attacks in the window (cr.HP). */
export const F_AAINV = 4;
/** A grab that misses a crouching foe. */
export const F_NOCROUCH = 8;
/** Invulnerable to strikes (not throws) in the window. */
export const F_DODGE = 16;
/** Off the ground in the window: lows whiff. */
export const F_AIRBORNE = 32;
/** One hit of armour in the window. */
export const F_ARMOR = 64;
/** Render only: a bigger spark and a shake. */
export const F_HEAVY = 128;

// ---- move indexes within a style ----
export const MV_LP = 0;
export const MV_HP = 1;
export const MV_LK = 2;
export const MV_HK = 3;
export const MV_CLP = 4;
export const MV_CHP = 5;
export const MV_CLK = 6;
export const MV_CHK = 7;
export const MV_JLP = 8;
export const MV_JHP = 9;
export const MV_JLK = 10;
export const MV_JHK = 11;
export const MV_THROW = 12;
export const MV_S1 = 13;
export const MV_S2 = 14;
export const MV_S3 = 15;
export const MV_S4 = 16;
export const MV_TK = 17;

/** Energy cost per slot (1–4 = S1–S4, 5 = Tuyệt kỹ). */
export const SLOT_COST = [0, 0, 150, 200, 250, 1000] as const;
/** The shortcut's extra energy and startup. */
export const SHORTCUT_COST = 100;
export const SHORTCUT_STARTUP = 2;

/** A move id: the record's index in MOVE_TABLE (style × 18 + index). The state stores id + 1 (0 = none). */
export const moveId = (style: number, idx: number): number => style * MOVES_PER_STYLE + idx;

interface Move {
  kind: number; slot?: number; motion?: number; btn?: number;
  s: number; a: number; r: number; dmg: number; hits?: number;
  hitstun: number; blockstun: number; reach: number; near?: number; ylo: number; yhi: number;
  height?: number; flags?: number; inv?: [number, number]; trav?: number; pb: number; chip?: number; cost?: number;
  grab?: [number, number]; win?: [number, number]; free?: number; tech?: number;
}

/** Display data of a special (UI and legend). */
export interface SpecialInfo { slot: number; name: string; input: string }

// Tự do's normals (every style starts from these; traits adjust them).
const NORMALS: readonly Move[] = [
  { kind: K_STAND, s: 5, a: 3, r: 8, dmg: 30, hitstun: 14, blockstun: 10, reach: 34, ylo: 40, yhi: 50, height: H_HIGH, flags: F_CANCEL, pb: 6 },
  { kind: K_STAND, s: 9, a: 4, r: 16, dmg: 70, hitstun: 20, blockstun: 14, reach: 40, ylo: 38, yhi: 50, height: H_HIGH, flags: F_CANCEL | F_HEAVY, pb: 10 },
  { kind: K_STAND, s: 6, a: 3, r: 10, dmg: 40, hitstun: 15, blockstun: 11, reach: 38, ylo: 20, yhi: 32, flags: F_CANCEL, pb: 6 },
  { kind: K_STAND, s: 11, a: 4, r: 19, dmg: 80, hitstun: 22, blockstun: 15, reach: 46, ylo: 28, yhi: 44, flags: F_HEAVY, pb: 10 },
  { kind: K_CROUCH, s: 4, a: 3, r: 7, dmg: 25, hitstun: 13, blockstun: 9, reach: 32, ylo: 22, yhi: 32, flags: F_CANCEL, pb: 6 },
  { kind: K_CROUCH, s: 8, a: 4, r: 18, dmg: 65, hitstun: 20, blockstun: 14, reach: 30, ylo: 30, yhi: 58, flags: F_CANCEL | F_AAINV | F_HEAVY, win: [4, 10], pb: 10 },
  { kind: K_CROUCH, s: 5, a: 3, r: 9, dmg: 30, hitstun: 13, blockstun: 10, reach: 38, ylo: 0, yhi: 10, height: H_LOW, flags: F_CANCEL, pb: 6 },
  { kind: K_CROUCH, s: 10, a: 3, r: 24, dmg: 70, hitstun: 0, blockstun: 14, reach: 48, ylo: 0, yhi: 10, height: H_LOW, flags: F_KD | F_HEAVY, pb: 10 },
  { kind: K_JUMP, s: 5, a: 8, r: 0, dmg: 35, hitstun: 16, blockstun: 10, reach: 30, ylo: 30, yhi: 44, height: H_OVERHEAD, pb: 4 },
  { kind: K_JUMP, s: 8, a: 6, r: 0, dmg: 70, hitstun: 20, blockstun: 13, reach: 36, ylo: 24, yhi: 44, height: H_OVERHEAD, flags: F_HEAVY, pb: 4 },
  { kind: K_JUMP, s: 6, a: 10, r: 0, dmg: 40, hitstun: 16, blockstun: 10, reach: 34, ylo: 14, yhi: 30, height: H_OVERHEAD, pb: 4 },
  { kind: K_JUMP, s: 9, a: 6, r: 0, dmg: 80, hitstun: 21, blockstun: 13, reach: 40, ylo: 14, yhi: 34, height: H_OVERHEAD, flags: F_HEAVY, pb: 4 },
  { kind: K_THROW, s: 5, a: 2, r: 20, dmg: 110, hitstun: 0, blockstun: 0, reach: 28, ylo: 0, yhi: 0, flags: F_KD | F_HEAVY, pb: 30, tech: 8 },
];

// A special's defaults: reach 40, hitbox y 20–50, hitstun 20, blockstun 14, pushback 12, chip 1/8.
const sp = (slot: number, motion: number, btn: number, s: number, a: number, r: number, dmg: number, more: Partial<Move> = {}): Move => ({
  kind: K_STRIKE, slot, motion, btn, s, a, r, dmg, hits: 1, hitstun: 20, blockstun: 14, reach: 40, ylo: 20, yhi: 50,
  pb: (more.hits ?? 1) > 1 ? 2 : 12, chip: 1, cost: SLOT_COST[slot],
  ...more,
  flags: (slot === 5 || dmg >= 100 ? F_HEAVY : 0) | (more.flags ?? 0),
});
const grab = (slot: number, motion: number, btn: number, s: number, a: number, r: number, dmg: number, range: [number, number], more: Partial<Move> = {}): Move =>
  sp(slot, motion, btn, s, a, r, dmg, { kind: K_GRAB, grab: range, reach: range[1], ylo: 0, yhi: 0, pb: 30, chip: 0, ...more });
const parry = (slot: number, motion: number, btn: number, win: [number, number], r: number, dmg: number, hits: number, more: Partial<Move> = {}): Move =>
  sp(slot, motion, btn, win[1], 0, r, dmg, { kind: K_PARRY, hits, win, reach: 0, ylo: 0, yhi: 0, pb: 20, chip: 0, ...more });
// the anti-air specials reach high
const AA = { ylo: 20, yhi: 80, reach: 36 };

interface StyleDef {
  atk: number; def: number; walk: number; jump: number; energy: number;
  chain?: [number, number, number];
  normals: (n: Move[]) => void;
  specials: Move[];
  names: string[];
}

const STYLE_DEFS: readonly StyleDef[] = [
  // 0 Tự do (practice only): the normals, the throw and one special
  {
    atk: 100, def: 100, walk: 100, jump: 100, energy: 100, normals: () => {},
    specials: [sp(1, MO_QCF, B_P, 10, 4, 18, 90)],
    names: ["Cú đấm bụi đời"],
  },
  // 1 Vovinam: j.HK reach +10 (flying kick)
  {
    atk: 100, def: 100, walk: 105, jump: 110, energy: 100,
    normals: (n) => { n[MV_JHK].reach += 10; },
    specials: [
      sp(1, MO_QCF, B_P, 10, 4, 16, 90, { trav: 48 }),
      sp(2, MO_QCB, B_K, 13, 5, 18, 100, { trav: 24 }),
      sp(3, MO_DP, B_P, 5, 6, 24, 110, { inv: [1, 7], flags: F_KD, ...AA }),
      grab(4, MO_QCF, B_K, 16, 3, 28, 160, [40, 90], { flags: F_KD | F_NOCROUCH }),
      sp(5, MO_QCF2, B_HK, 8, 12, 30, 60, { hits: 5, inv: [1, 8], flags: F_KD, reach: 50 }),
    ],
    names: ["Đấm thẳng lao", "Đá lái xoay", "Chém tay đỡ trời", "Đòn chân kẹp cổ", "Song phi cước"],
  },
  // 2 Muay Thai: clinch throw range +6; HK has one hit of armour on frames 4–10
  {
    atk: 110, def: 95, walk: 95, jump: 95, energy: 100,
    normals: (n) => {
      n[MV_THROW].reach += 6;
      n[MV_HK].flags = (n[MV_HK].flags ?? 0) | F_ARMOR;
      n[MV_HK].win = [4, 10];
    },
    specials: [
      sp(1, MO_QCF, B_P, 14, 3, 18, 110, { height: H_OVERHEAD }),
      sp(2, MO_QCB, B_K, 12, 6, 20, 120, { trav: 56, flags: F_AIRBORNE, win: [6, 18] }),
      sp(3, MO_DP, B_P, 5, 5, 26, 120, { inv: [1, 6], flags: F_KD, ...AA }),
      grab(4, MO_QCF, B_K, 6, 2, 30, 60, [0, 32], { hits: 3 }),
      sp(5, MO_QCF2, B_HP, 7, 6, 34, 55, { hits: 6, inv: [1, 7], flags: F_KD, reach: 50 }),
    ],
    names: ["Chỏ bổ", "Gối bay", "Chỏ ngược", "Ôm ghì gối", "Mưa chỏ gối"],
  },
  // 3 Karate: LP → HP chain
  {
    atk: 105, def: 100, walk: 100, jump: 100, energy: 100, chain: [MV_LP, MV_HP, 1], normals: () => {},
    specials: [
      sp(1, MO_QCF, B_P, 11, 4, 17, 100, { trav: 64 }),
      sp(2, MO_QCB, B_K, 12, 4, 20, 110, { flags: F_KD }),
      sp(3, MO_DP, B_P, 4, 6, 25, 110, { inv: [1, 6], flags: F_KD, ...AA }),
      sp(4, MO_DD, B_P, 18, 3, 20, 140, { flags: F_ARMOR, win: [6, 17], blockstun: 26, chip: 2 }),
      sp(5, MO_QCF2, B_HP, 6, 3, 40, 350, { inv: [1, 6], flags: F_KD, reach: 44 }),
    ],
    names: ["Tsuki trượt", "Mawashi xoay", "Chưởng thượng", "Chặt gạch", "Nhất kích"],
  },
  // 4 Taekwondo: every kick reaches 8 px further
  {
    atk: 100, def: 95, walk: 105, jump: 105, energy: 100,
    normals: (n) => { for (const i of [MV_LK, MV_HK, MV_CLK, MV_CHK, MV_JLK, MV_JHK]) n[i].reach += 8; },
    specials: [
      sp(1, MO_QCF, B_K, 9, 4, 16, 90, { pb: 60 }),
      sp(2, MO_QCB, B_K, 13, 5, 20, 120, { trav: 32, flags: F_KD }),
      sp(3, MO_DP, B_K, 5, 7, 24, 110, { inv: [1, 6], flags: F_KD, ...AA }),
      sp(4, MO_DD, B_K, 10, 12, 20, 45, { hits: 3, trav: 40 }),
      sp(5, MO_QCF2, B_HK, 7, 20, 30, 55, { hits: 6, inv: [1, 7], flags: F_KD, reach: 50 }),
    ],
    names: ["Đá tống trước", "Đá xoay 360", "Đá móc lên", "Đá liên hoàn", "Phi long cước"],
  },
  // 5 Quyền Anh: LK and HK are body punches (mid, same frames); no jump kicks; jump punches ×1.2
  {
    atk: 108, def: 100, walk: 110, jump: 85, energy: 110,
    normals: (n) => {
      n[MV_JLP].dmg = 42;
      n[MV_JHP].dmg = 84;
      n[MV_JLK] = { ...n[MV_JLP] };
      n[MV_JHK] = { ...n[MV_JHP] };
    },
    specials: [
      sp(1, MO_QCF, B_P, 9, 4, 16, 100, { trav: 56 }),
      { kind: K_DODGE, slot: 2, motion: MO_QCB, btn: B_P, s: 1, a: 0, r: 20, dmg: 0, hitstun: 0, blockstun: 0, reach: 0, ylo: 0, yhi: 0,
        flags: F_DODGE, win: [1, 14], free: 10, pb: 0, cost: SLOT_COST[2] },
      sp(3, MO_DP, B_P, 4, 5, 26, 120, { inv: [1, 5], flags: F_KD, ...AA }),
      sp(4, MO_DD, B_P, 8, 14, 18, 50, { hits: 3 }),
      sp(5, MO_QCF2, B_HP, 10, 4, 36, 380, { flags: F_KD | F_ARMOR, win: [1, 10], reach: 44 }),
    ],
    names: ["Đấm lao", "Lách né", "Móc ngược", "Móc liên hoàn", "Cú đấm định mệnh"],
  },
  // 6 Judo: throw damage ×1.3, range +6, tech window +3
  {
    atk: 95, def: 110, walk: 90, jump: 90, energy: 100,
    normals: (n) => {
      n[MV_THROW].dmg = 143;
      n[MV_THROW].reach += 6;
      n[MV_THROW].tech = (n[MV_THROW].tech ?? 0) + 3;
    },
    specials: [
      grab(1, MO_QCF, B_P, 5, 2, 26, 150, [0, 34], { flags: F_KD }),
      sp(2, MO_QCB, B_K, 8, 4, 20, 80, { height: H_LOW, flags: F_KD, ylo: 0, yhi: 12 }),
      parry(3, MO_DP, B_P, [2, 14], 22, 130, 1, { flags: F_KD }),
      grab(4, MO_DD, B_K, 12, 3, 28, 180, [0, 50], { flags: F_KD }),
      grab(5, MO_QCF2, B_HP, 3, 2, 40, 120, [0, 40], { hits: 3, flags: F_KD }),
    ],
    names: ["Quật vai", "Gạt chân", "Phản đòn", "Quật ngược", "Liên hoàn quật"],
  },
  // 7 Vịnh Xuân: LP startup 4; LP → LP → LP chain
  {
    atk: 95, def: 105, walk: 100, jump: 95, energy: 115, chain: [MV_LP, MV_LP, 2],
    normals: (n) => { n[MV_LP].s = 4; },
    specials: [
      sp(1, MO_QCF, B_P, 7, 15, 16, 22, { hits: 5, trav: 30 }),
      sp(2, MO_QCB, B_K, 6, 3, 16, 70, { height: H_LOW, pb: 50, ylo: 0, yhi: 12 }),
      parry(3, MO_DP, B_P, [1, 12], 20, 40, 3),
      sp(4, MO_DD, B_P, 14, 3, 22, 130, { flags: F_KD, pb: 80 }),
      sp(5, MO_QCF2, B_HP, 6, 30, 30, 32, { hits: 10, inv: [1, 6], reach: 50 }),
    ],
    names: ["Liên hoàn quyền", "Đá trụ", "Phục thủ", "Thốn quyền", "Mộc nhân trận"],
  },
];

const MOTION_TEXT = ["", "↓→", "↓←", "→↓", "↓↓", "↓→↓→"];
const BTN_TEXT = ["", "P", "K", "HP", "HK"];

function flatten(m: Move | null): number[] {
  const r = new Array<number>(REC).fill(0);
  if (!m) return r;
  r[M_KIND] = m.kind;
  r[M_SLOT] = m.slot ?? 0;
  r[M_MOTION] = m.motion ?? 0;
  r[M_BTN] = m.btn ?? 0;
  r[M_S] = m.s;
  r[M_A] = m.a;
  r[M_R] = m.r;
  r[M_DMG] = m.dmg;
  r[M_HITS] = m.hits ?? 1;
  r[M_HITSTUN] = m.hitstun;
  r[M_BLOCKSTUN] = m.blockstun;
  r[M_REACH] = m.reach;
  r[M_NEAR] = m.near ?? 0;
  r[M_YLO] = m.ylo;
  r[M_YHI] = m.yhi;
  r[M_HEIGHT] = m.height ?? H_MID;
  r[M_FLAGS] = m.flags ?? 0;
  r[M_INV_A] = m.inv?.[0] ?? 0;
  r[M_INV_B] = m.inv?.[1] ?? 0;
  r[M_TRAV] = m.trav ?? 0;
  r[M_PB] = m.pb;
  r[M_CHIP] = m.chip ?? 0;
  r[M_COST] = m.cost ?? 0;
  r[M_GMIN] = m.grab?.[0] ?? 0;
  r[M_GMAX] = m.grab?.[1] ?? 0;
  r[M_WIN_A] = m.win?.[0] ?? 0;
  r[M_WIN_B] = m.win?.[1] ?? 0;
  r[M_FREE] = m.free ?? 0;
  r[M_TECH] = m.tech ?? 0;
  return r;
}

function buildTable(): { table: number[]; specials: SpecialInfo[][] } {
  const table: number[] = [];
  const specials: SpecialInfo[][] = [];
  const rows: number[] = [];
  for (const def of STYLE_DEFS) {
    const n = NORMALS.map((m) => ({ ...m }));
    def.normals(n);
    for (const m of n) table.push(...flatten(m));
    const bySlot: (Move | null)[] = [null, null, null, null, null];
    for (const m of def.specials) bySlot[(m.slot ?? 1) - 1] = m;
    for (const m of bySlot) table.push(...flatten(m));
    specials.push(def.specials.map((m, i) => ({
      slot: m.slot ?? 1, name: def.names[i] ?? "", input: `${MOTION_TEXT[m.motion ?? 0]} ${BTN_TEXT[m.btn ?? 0]}`,
    })));
    const row = new Array<number>(STYLE_REC).fill(0);
    row[S_ATK] = def.atk;
    row[S_DEF] = def.def;
    row[S_WALK] = def.walk;
    row[S_JUMP] = def.jump;
    row[S_ENERGY] = def.energy;
    row[S_CHAIN_FROM] = def.chain ? def.chain[0] : -1;
    row[S_CHAIN_TO] = def.chain ? def.chain[1] : -1;
    row[S_CHAIN_MAX] = def.chain ? def.chain[2] : 0;
    rows.push(...row);
  }
  return { table: [...table, ...rows], specials };
}

const BUILT = buildTable();

/** Every move of every style, then the style rows: the engine's only data (and _fx_moves()'s literal). */
export const MOVE_TABLE: readonly number[] = Object.freeze(BUILT.table);
export const MOVE_TABLE_LEN = STYLE_BASE + STYLE_COUNT * STYLE_REC;

/** The specials each style has, for the UI (slot order). */
export const STYLE_SPECIALS: readonly (readonly SpecialInfo[])[] = BUILT.specials;

/** A field of move `id` (a MOVE_TABLE record index). */
export const mv = (id: number, field: number): number => MOVE_TABLE[id * REC + field];
/** A field of a style row. */
export const styleField = (style: number, field: number): number => MOVE_TABLE[STYLE_BASE + style * STYLE_REC + field];
