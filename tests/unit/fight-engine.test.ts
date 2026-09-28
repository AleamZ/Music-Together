import { describe, expect, it } from "vitest";
import {
  A_BLOCKSTUN, A_HITSTUN, A_KNOCKDOWN, A_TECHED, A_THROWN, END_FRAMES, F_ACT, F_EN, F_FACE, F_HITF, F_HP,
  F_MOVE, F_STUN, F_X, G_FRAME, G_PHASE, G_RESULT, G_ROUND, IN_BL, IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LK, IN_LP, IN_RIGHT,
  IN_SK, INTRO_FRAMES, PH_END, PH_FIGHT, PH_INTRO, PH_OVER, RESULT_DRAW, ROUND_FRAMES, STATE_LEN, SUB, createMatch,
  fb, fighterParams, hash, isFree, makeParams, roundResults, runFrames, step, type FighterParams, type State,
  F_ATK, F_DEF, F_ENP, F_JUMP, F_STYLE, F_WALK, G_SBR, STAGE_MAX,
} from "@/lib/game/fight/engine";
import { styleStats } from "@/lib/game/fight/styles";
import { MV_HK, MV_HP, MV_LK, MV_LP, MV_S1, MV_S2, MV_S3, MV_TK, moveId } from "@/lib/game/fight/moves";
import { rand32 } from "@/lib/game/fishing/reel";

const P1 = fb(0), P2 = fb(1);
const tudo = (more: Partial<FighterParams> = {}) => fighterParams(0, 0, more);

/** A match at its first fight frame (the intro played out). */
function fightStart(p1 = tudo(), p2 = tudo(), rounds: 1 | 3 = 3): State {
  let s = createMatch(makeParams(p1, p2, { rounds }));
  for (let i = 0; i < INTRO_FRAMES; i++) s = step(s, 0, 0);
  expect(s[G_PHASE]).toBe(PH_FIGHT);
  return s;
}
/** Puts the fighters `gap` px apart around x = 192. */
function place(s: State, gap: number): State {
  const n = s.slice();
  n[P1 + F_X] = (192 - Math.floor(gap / 2)) * SUB;
  n[P2 + F_X] = n[P1 + F_X] + gap * SUB;
  return n;
}
/** Puts P2 against the right wall, `gap` px from P1: holding back blocks in place (the reaches are the chibi's
 *  short limbs since 0079 — a defender walking back from point blank outwalks a heavy's startup). */
function atWall(s: State, gap: number): State {
  const n = s.slice();
  n[P2 + F_X] = STAGE_MAX;
  n[P1 + F_X] = STAGE_MAX - gap * SUB;
  return n;
}
type Script = (k: number, s: State) => number;
const seq = (masks: number[], after = 0): Script => (k) => (k < masks.length ? masks[k] : after);
const hold = (m: number): Script => () => m;
/** Runs `n` frames with per-frame scripts (k counts from 0). */
function play(s: State, a: Script, b: Script, n: number, each?: (s: State, k: number) => void): State {
  for (let k = 0; k < n; k++) {
    s = step(s, a(k, s), b(k, s));
    each?.(s, k);
  }
  return s;
}
/** Advantage of a normal on hit or block: (defender's first free frame) − (attacker's). */
function advantage(btn: number, blocked: boolean): number {
  const s = blocked ? atWall(fightStart(), 20) : place(fightStart(), 20);
  let att = -1, def = -1, hit = false;
  play(s, seq([btn]), hold(blocked ? IN_RIGHT : 0), 80, (st, k) => {
    if (!hit && st[P2 + F_HITF] === st[G_FRAME]) hit = true;
    if (att < 0 && k > 0 && isFree(st, P1)) att = k;
    if (hit && def < 0 && isFree(st, P2)) def = k;
  });
  expect(hit).toBe(true);
  return def - att;
}

describe("fight engine: layout and determinism", () => {
  it("is a fixed-length int state", () => {
    const s = createMatch(makeParams(tudo(), tudo()));
    expect(s).toHaveLength(STATE_LEN);
    expect(s.every((v) => Number.isInteger(v) && Math.abs(v) < 2 ** 31)).toBe(true);
    expect(s[G_PHASE]).toBe(PH_INTRO);
  });

  it("the same logs give the same hash, twice; a snapshot resumes identically", () => {
    const mk = () => {
      let r = 7, s = createMatch(makeParams(fighterParams(3, 4, { en0: 500 }), fighterParams(7, 4)));
      const snaps: State[] = [];
      for (let k = 0; k < 4000; k++) {
        let a: number, b: number;
        [a, r] = rand32(r);
        [b, r] = rand32(r);
        s = step(s, a & 1023 & (k % 3 ? 0x3ff : 0x0f), b & 1023 & (k % 5 ? 0x3ff : 0x0f));
        if (k === 1500) snaps.push(s.slice());
      }
      return { s, snap: snaps[0] };
    };
    const x = mk(), y = mk();
    expect(hash(x.s)).toBe(hash(y.s));
    expect(x.s).toEqual(y.s);
    expect(x.s.every((v) => Number.isInteger(v) && Math.abs(v) < 2 ** 31)).toBe(true);
  });

  it("step is pure", () => {
    const s = fightStart();
    const copy = s.slice();
    step(s, IN_LP, IN_RIGHT);
    expect(s).toEqual(copy);
  });

  it("runFrames replays RLE runs like stepping mask by mask", () => {
    const s0 = fightStart();
    const a = [IN_RIGHT, 20, 0, 3, IN_LP, 1, 0, 30];
    const b = [IN_LEFT, 10, IN_DOWN, 44];
    let s = s0;
    const ma = [...Array(20).fill(IN_RIGHT), 0, 0, 0, IN_LP, ...Array(30).fill(0)];
    const mb = [...Array(10).fill(IN_LEFT), ...Array(44).fill(IN_DOWN)];
    for (let k = 0; k < 60; k++) s = step(s, ma[k] ?? 0, mb[k] ?? 0);
    expect(runFrames(s0, a, b, 60)).toEqual(s);
  });
});

describe("fight engine: frame data", () => {
  it("LP is active on its 6th frame (startup 5)", () => {
    const s = place(fightStart(), 20);
    const t0 = s[G_FRAME] + 1;
    const end = play(s, seq([IN_LP]), hold(0), 10);
    expect(end[P2 + F_HITF]).toBe(t0 + 5);
  });

  it("advantage on hit: LP +4, HP +1, LK +3, HK 0", () => {
    expect(advantage(IN_LP, false)).toBe(4);
    expect(advantage(IN_HP, false)).toBe(1);
    expect(advantage(IN_LK, false)).toBe(3);
    expect(advantage(IN_HK, false)).toBe(0);
  });

  it("advantage on block: LP 0, HP −5, LK −1, HK −7", () => {
    expect(advantage(IN_LP, true)).toBe(0);
    expect(advantage(IN_HP, true)).toBe(-5);
    expect(advantage(IN_LK, true)).toBe(-1);
    expect(advantage(IN_HK, true)).toBe(-7);
  });

  it("blocked normals chip nothing; blocked specials chip 1/8; chip never KOs", () => {
    let s = atWall(fightStart(), 20);
    s = play(s, seq([IN_HP]), hold(IN_RIGHT), 40);
    expect(s[P2 + F_HP]).toBe(1000);
    // Tự do S1 (90) by the shortcut: chip 11
    s = atWall(fightStart(tudo({ en0: 1000 })), 20);
    s = play(s, seq([IN_SK]), hold(IN_RIGHT), 40);
    expect(s[P2 + F_HP]).toBe(1000 - 11);
    s = atWall(fightStart(tudo({ en0: 1000 }), tudo({ hpPct: 1 })), 20);
    s[P2 + F_HP] = 5;
    s = play(s, seq([IN_SK]), hold(IN_RIGHT), 40);
    expect(s[P2 + F_HP]).toBe(1);
  });

  it("damage is base × ATK / DEF with combo scaling", () => {
    // Muay Thai (ATK 110) LP on Judo (DEF 110): 30
    let s = place(fightStart(fighterParams(2, 0), fighterParams(6, 0)), 20);
    s = play(s, seq([IN_LP]), hold(0), 30);
    expect(s[P2 + F_HP]).toBe(1000 - 30);
    // LP, then S1 cancelled on contact: 30 + 90 × 90 %
    s = place(fightStart(), 20);
    s = play(s, seq([IN_LP, 0, 0, 0, 0, IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT | IN_HP]), hold(0), 60);
    expect(s[P2 + F_HP]).toBe(1000 - 30 - 81);
  });

  it("a crouching block stops lows; a standing one does not", () => {
    let s = place(fightStart(), 20);
    s = play(s, seq([IN_DOWN | IN_LK, IN_DOWN, IN_DOWN, IN_DOWN, IN_DOWN, IN_DOWN, IN_DOWN]), hold(IN_RIGHT | IN_DOWN), 30);
    expect(s[P2 + F_HP]).toBe(1000);
    s = place(fightStart(), 20);
    s = play(s, seq([IN_DOWN | IN_LK, IN_DOWN, IN_DOWN, IN_DOWN, IN_DOWN, IN_DOWN, IN_DOWN]), hold(IN_RIGHT), 30);
    expect(s[P2 + F_HP]).toBe(1000 - 30);
  });
});

describe("fight engine: motions, buffer and the shortcut", () => {
  const qcf = (btn: number) => [IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT | btn];
  const s1 = moveId(0, MV_S1) + 1;

  it("QCF+P is S1; the window is 12 frames and the press must follow within 6", () => {
    let s = place(fightStart(), 40);
    s = play(s, seq(qcf(IN_LP)), hold(0), 3);
    expect(s[P1 + F_MOVE]).toBe(s1);
    // 13 frames from ↓ to →: too slow, the LP normal comes out
    s = place(fightStart(), 40);
    s = play(s, seq([IN_DOWN, IN_DOWN | IN_RIGHT, ...Array(11).fill(IN_DOWN | IN_RIGHT), IN_RIGHT, IN_RIGHT | IN_LP]), hold(0), 15);
    expect(s[P1 + F_MOVE]).toBe(moveId(0, MV_LP) + 1);
    // the press 6 frames after → still counts, 7 does not
    s = place(fightStart(), 40);
    s = play(s, seq([IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT, 0, 0, 0, 0, 0, IN_LP]), hold(0), 9);
    expect(s[P1 + F_MOVE]).toBe(s1);
    s = place(fightStart(), 40);
    s = play(s, seq([IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT, 0, 0, 0, 0, 0, 0, IN_LP]), hold(0), 10);
    expect(s[P1 + F_MOVE]).toBe(moveId(0, MV_LP) + 1);
  });

  it("no diagonal needed: ↓→ is QCF, →↓ is DP, ↓→↓→ is QCF×2, ↓← is QCB", () => {
    let s = place(fightStart(), 40);
    s = play(s, seq([IN_DOWN, IN_RIGHT | IN_LP]), hold(0), 2);
    expect(s[P1 + F_MOVE]).toBe(s1);
    const karate = fighterParams(3, 4, { en0: 1000 });
    s = play(place(fightStart(karate), 40), seq([IN_RIGHT, IN_DOWN, IN_DOWN | IN_LP]), hold(0), 3);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, MV_S3) + 1);
    s = play(place(fightStart(karate), 40), seq([IN_DOWN, IN_RIGHT, IN_DOWN, IN_RIGHT | IN_HP]), hold(0), 4);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, MV_TK) + 1);
    s = play(place(fightStart(karate), 40), seq([IN_DOWN, IN_LEFT | IN_LK]), hold(0), 2);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, MV_S2) + 1);
    // holding ↓ long before the punch is a crouching punch, not a DP
    s = play(place(fightStart(karate), 40), seq([IN_RIGHT, ...Array(10).fill(IN_DOWN), IN_DOWN | IN_LP]), hold(0), 12);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, 4) + 1);
  });

  it("priority: QCF×2 over QCF, DP over QCF; an unaffordable special gives the normal", () => {
    const karate = (en0: number) => fighterParams(3, 4, { en0 });
    let s = place(fightStart(karate(1000)), 40);
    s = play(s, seq([IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT, IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT | IN_HP]), hold(0), 6);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, MV_TK) + 1);
    expect(s[P1 + F_EN]).toBe(0);
    s = place(fightStart(karate(200)), 40);
    s = play(s, seq([IN_RIGHT, IN_DOWN, IN_DOWN | IN_RIGHT, IN_DOWN | IN_RIGHT | IN_LP]), hold(0), 4);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, MV_S3) + 1);
    // Karate S2 (QCB+K) costs 150: with 100 energy the LK normal comes out
    s = place(fightStart(karate(100)), 40);
    s = play(s, seq([IN_DOWN, IN_DOWN | IN_LEFT, IN_LEFT | IN_LK]), hold(0), 3);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, MV_LK) + 1);
    s = place(fightStart(karate(150)), 40);
    s = play(s, seq([IN_DOWN, IN_DOWN | IN_LEFT, IN_LEFT | IN_LK]), hold(0), 3);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, MV_S2) + 1);
    expect(s[P1 + F_EN]).toBe(0);
  });

  it("a locked special is the normal (rank 0 has S1 only)", () => {
    const s = play(place(fightStart(fighterParams(3, 0, { en0: 1000 })), 40), seq([IN_RIGHT, IN_DOWN, IN_DOWN | IN_RIGHT, IN_DOWN | IN_RIGHT | IN_LP]), hold(0), 4);
    expect(s[P1 + F_MOVE]).toBe(moveId(3, 4) + 1);          // cr.LP
  });

  it("buffers a press for 4 frames", () => {
    // HK recovers 34 frames after its first; a press 4 frames before the end comes out, 5 does not
    for (const [lead, out] of [[4, true], [5, false]] as const) {
      let s = place(fightStart(), 80);
      const free = 11 + 4 + 19;                               // the frame (k) HK ends
      s = play(s, (k) => (k === 0 ? IN_HK : k === free - lead ? IN_LP : 0), hold(0), free + 1);
      expect(s[P1 + F_MOVE] === moveId(0, MV_LP) + 1, `lead ${lead}`).toBe(out);
    }
  });

  it("the shortcut costs +100 energy and +2 startup, even for S1", () => {
    let s = place(fightStart(fighterParams(3, 4, { en0: 300 })), 20);
    const t0 = s[G_FRAME] + 1;
    s = play(s, seq([IN_SK | IN_DOWN, IN_DOWN]), hold(0), 12);
    expect(s[P1 + F_EN]).toBe(0 + 50);                       // spent 300, then +50 for the hit
    expect(s[P2 + F_HITF]).toBe(t0 + 4 + 2);                  // Karate S3: startup 4 (+2)
    s = place(fightStart(tudo({ en0: 99 })), 20);
    s = play(s, seq([IN_SK]), hold(0), 3);
    expect(s[P1 + F_MOVE]).toBe(0);
    s = place(fightStart(tudo({ en0: 100 })), 20);
    s = play(s, seq([IN_SK]), hold(0), 3);
    expect(s[P1 + F_MOVE]).toBe(s1);
    expect(s[P1 + F_EN]).toBe(0);
    // O + Đỡ is the Tuyệt kỹ: 1000 + 100
    s = place(fightStart(fighterParams(3, 4, { en0: 1000 })), 20);
    s = play(s, seq([IN_SK | IN_BL]), hold(0), 2);
    expect(s[P1 + F_MOVE]).not.toBe(moveId(3, MV_TK) + 1);
  });

  it("LP cancels into a special on contact but HK does not", () => {
    let s = place(fightStart(), 40);
    s = play(s, seq([IN_HK, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, IN_DOWN, IN_DOWN | IN_RIGHT, IN_RIGHT | IN_LP]), hold(0), 16);
    expect(s[P1 + F_MOVE]).toBe(moveId(0, MV_HK) + 1);
    expect(moveId(0, MV_HP) + 1).not.toBe(s1);
  });
});

describe("fight engine: throws, knockdowns, energy", () => {
  it("LP+LK within 23 px throws: 110 damage after the tech window, then a knockdown", () => {
    let s = place(fightStart(), 20);
    s = play(s, seq([IN_LP | IN_LK]), hold(0), 7);
    expect(s[P2 + F_ACT]).toBe(A_THROWN);
    s = play(s, hold(0), hold(0), 8);
    expect(s[P2 + F_HP]).toBe(1000 - 110);
    expect(s[P2 + F_ACT]).toBe(A_KNOCKDOWN);
  });

  it("the defender techs with LP+LK within 8 frames: pushed 40 px apart, no damage", () => {
    let s = place(fightStart(), 20);
    s = play(s, seq([IN_LP | IN_LK]), seq([0, 0, 0, 0, 0, 0, 0, 0, IN_LP | IN_LK]), 12);
    expect(s[P1 + F_ACT]).toBe(A_TECHED);
    expect(s[P2 + F_ACT]).toBe(A_TECHED);
    expect(s[P2 + F_HP]).toBe(1000);
    expect((s[P2 + F_X] - s[P1 + F_X]) / SUB).toBeGreaterThanOrEqual(20 + 40 - 1);
  });

  it("a throw cannot grab a fighter in hitstun, blockstun or the air", () => {
    let s = place(fightStart(), 20);
    s[P2 + F_ACT] = A_BLOCKSTUN;
    s[P2 + F_STUN] = 30;
    s = play(s, seq([IN_LP | IN_LK]), hold(IN_RIGHT), 8);
    expect(s[P2 + F_ACT]).not.toBe(A_THROWN);
    s = place(fightStart(), 20);
    s[P2 + F_ACT] = A_HITSTUN;
    s[P2 + F_STUN] = 30;
    s = play(s, seq([IN_LP | IN_LK]), hold(0), 8);
    expect(s[P2 + F_ACT]).not.toBe(A_THROWN);
  });

  it("a knocked-down fighter is invulnerable until it is up", () => {
    let s = place(fightStart(), 20);
    s = play(s, seq([IN_DOWN | IN_HK, IN_DOWN]), hold(0), 30);
    expect(s[P2 + F_ACT]).toBe(A_KNOCKDOWN);
    const hp = s[P2 + F_HP];
    s = play(s, (k) => (k % 12 === 0 ? IN_LP : 0), hold(0), 30);
    expect(s[P2 + F_HP]).toBe(hp);
  });

  it("energy: +50 / +30 on a hit, +25 / +10 on a block, scaled by the style", () => {
    let s = place(fightStart(), 20);
    s = play(s, seq([IN_LP]), hold(0), 20);
    expect([s[P1 + F_EN], s[P2 + F_EN]]).toEqual([50, 30]);
    s = place(fightStart(), 20);
    s = play(s, seq([IN_LP]), hold(IN_RIGHT), 20);
    expect([s[P1 + F_EN], s[P2 + F_EN]]).toEqual([25, 10]);
    s = place(fightStart(fighterParams(7, 0)), 20);   // Vịnh Xuân 115 %
    s = play(s, seq([IN_LP]), hold(0), 20);
    expect(s[P1 + F_EN]).toBe(57);
  });
});

describe("fight engine: rounds, the timer and the draw rules", () => {
  it("time-up with equal HP is a draw round; after 5 draws the match is a draw at frame 30 900", () => {
    let s = createMatch(makeParams(tudo(), tudo()));
    for (let k = 0; k < 30_900; k++) s = step(s, 0, 0);
    expect(s[G_PHASE]).toBe(PH_OVER);
    expect(s[G_RESULT]).toBe(RESULT_DRAW);
    expect(s[G_FRAME]).toBe(30_900);
    expect(roundResults(s)).toHaveLength(5);
    expect(roundResults(s).every((r) => r.reason === 2 && r.winner === 0)).toBe(true);
    const again = step(s, IN_LP, IN_LP);
    expect(again).toEqual(s);
  });

  it("time-up goes to the higher HP‰; the next round starts after the pause", () => {
    let s = place(fightStart(), 20);
    s = play(s, seq([IN_LP]), hold(0), ROUND_FRAMES);
    expect(s[G_PHASE]).toBe(PH_END);
    expect(roundResults(s)[0]).toMatchObject({ reason: 2, winner: 1, hp2: 970 });
    s = play(s, hold(0), hold(0), END_FRAMES);
    expect(s[G_PHASE]).toBe(PH_INTRO);
    expect(s[G_ROUND]).toBe(2);
    expect(s[P2 + F_HP]).toBe(1000);
    expect(s[P1 + F_EN]).toBe(50);                            // energy carries over
  });

  it("a double KO is a draw round", () => {
    let s = place(fightStart(tudo({ hpPct: 2 }), tudo({ hpPct: 2 })), 20);
    s = play(s, seq([IN_LP]), seq([IN_LP]), 8);
    expect(s[G_PHASE]).toBe(PH_END);
    expect(roundResults(s)[0]).toMatchObject({ reason: 1, winner: 0 });
    expect(s[P1 + F_ACT]).toBe(A_KNOCKDOWN);
    expect(s[P2 + F_ACT]).toBe(A_KNOCKDOWN);
  });

  it("two KO wins take a best-of-3; one takes a 1-round match", () => {
    const koRound = (s: State) => {
      s = place(s, 20);
      s = play(s, seq([IN_LP]), hold(0), 30);
      return play(s, hold(0), hold(0), END_FRAMES + INTRO_FRAMES);
    };
    let s = fightStart(tudo(), tudo({ hpPct: 3 }));
    s = koRound(s);
    expect(s[G_PHASE]).toBe(PH_FIGHT);
    s = koRound(s);
    expect(s[G_PHASE]).toBe(PH_OVER);
    expect(s[G_RESULT]).toBe(1);
    s = koRound(fightStart(tudo(), tudo({ hpPct: 3 }), 1));
    expect(s[G_RESULT]).toBe(1);
  });

  it("faces the foe after crossing", () => {
    let s = fightStart();
    s = place(s, 40);
    s[P1 + F_X] = 300 * SUB;
    s = play(s, hold(0), hold(0), 2);
    expect(s[P1 + F_FACE]).toBe(-1);
    expect(s[P2 + F_FACE]).toBe(1);
  });
});

describe("styleByRound (v20.4: Trùm Hầm changes style each round)", () => {
  const koRound = (s: State) => {
    s = place(s, 20);
    s = play(s, seq([IN_LP]), hold(0), 30);
    return play(s, hold(0), hold(0), END_FRAMES + INTRO_FRAMES);
  };
  it("switches the fighter's style and the style row's stats at the start of each round", () => {
    const boss = fighterParams(2, 4, { hpPct: 3, styleByRound: [2, 6, 7] });
    let s = createMatch(makeParams(tudo(), boss));
    expect(s[P2 + F_STYLE]).toBe(2);
    expect(s[P2 + F_ATK]).toBe(styleStats(2).atk);
    for (let i = 0; i < INTRO_FRAMES; i++) s = step(s, 0, 0);
    s = koRound(s);
    expect(s[G_ROUND]).toBe(2);
    expect(s[P2 + F_STYLE]).toBe(6);
    expect([s[P2 + F_ATK], s[P2 + F_DEF], s[P2 + F_WALK], s[P2 + F_JUMP], s[P2 + F_ENP]])
      .toEqual([styleStats(6).atk, styleStats(6).def, styleStats(6).walk, styleStats(6).jump, styleStats(6).energy]);
    expect(s[P1 + F_STYLE]).toBe(0);
  });
  it("round 1 takes the list's first style; rounds past the list keep the last one", () => {
    let s = createMatch(makeParams(tudo(), fighterParams(1, 4, { hpPct: 3, styleByRound: [5] })));
    expect(s[P2 + F_STYLE]).toBe(5);
    expect(s[P2 + F_ATK]).toBe(styleStats(5).atk);
    for (let i = 0; i < INTRO_FRAMES; i++) s = step(s, 0, 0);
    s = koRound(s);
    expect(s[P2 + F_STYLE]).toBe(5);
  });
  it("leaves a match without it untouched (its slots stay 0: the old hashes hold)", () => {
    const a = createMatch(makeParams(tudo(), fighterParams(3, 2)));
    const b = createMatch(makeParams(tudo(), fighterParams(3, 2, { styleByRound: [] })));
    expect(b).toEqual(a);
    expect(a.slice(G_SBR, G_SBR + 10).every((v) => v === 0)).toBe(true);
    const c = createMatch(makeParams(tudo(), fighterParams(3, 2, { styleByRound: [3, 3] })));
    expect(c.slice(G_SBR + 5, G_SBR + 7)).toEqual([4, 4]);
  });
});