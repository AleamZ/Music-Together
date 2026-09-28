import { describe, expect, it } from "vitest";
import {
  ACTION_COUNT, A_ATTACK, A_JATTACK, F_ACT, F_AF, F_HITMV, F_KDOWN, F_MOVE, F_STUNK, F_X, G_FRAME, G_LAST, G_LEFT,
  G_PHASE, IN_HP, IN_LP, INTRO_FRAMES, PH_END, SUB, createMatch, fb, fighterParams, makeParams, step, type State,
} from "@/lib/game/fight/engine";
import { K_NONE, M_KIND, MOVES_PER_STYLE, STYLE_COUNT, mv } from "@/lib/game/fight/moves";
import { EffectTracker, effectsOf, isFlashing } from "@/lib/game/fight/render/fx";
import { hudText, paintHud, TrailTracker } from "@/lib/game/fight/render/hud";
import { JOINTS, POSES, POSE_IDS, RIG_H, RIG_W, poseFor } from "@/lib/game/fight/render/poses";
import { paintFighter, type PixelCtx } from "@/lib/game/fight/render/rig";
import { paintScene } from "@/lib/game/fight/render/scene";
import { DEFAULT_LOOK } from "@/lib/game/look";

/** A fake 2D context that records the painted pixels. */
function fakeCtx(w: number, h: number) {
  const px = new Map<string, string>();
  let outside = 0;
  const ctx: PixelCtx = {
    fillStyle: "#000",
    fillRect(x: number, y: number, rw: number, rh: number) {
      for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) outside++;
        else px.set(`${Math.floor(xx)},${Math.floor(yy)}`, String(this.fillStyle));
      }
    },
  };
  return { ctx, px, outside: () => outside };
}

const start = (): State => {
  let s = createMatch(makeParams(fighterParams(0, 0), fighterParams(0, 0)));
  for (let k = 0; k < INTRO_FRAMES; k++) s = step(s, 0, 0);
  return s;
};

describe("fight poses", () => {
  it("has about 40 shared poses of 14 joints inside the 48 × 64 box", () => {
    expect(POSE_IDS.length).toBeGreaterThanOrEqual(40);
    for (const id of POSE_IDS) {
      expect(POSES[id], id).toHaveLength(JOINTS);
      for (const [x, y] of POSES[id]) {
        expect(x >= 1 && x < RIG_W - 1 && y >= 1 && y < RIG_H, `${id} ${x},${y}`).toBe(true);
      }
    }
  });

  it("maps every (action, move, action frame) to a defined pose", () => {
    const s = start();
    const b = fb(0);
    for (let a = 0; a < ACTION_COUNT; a++) {
      const moves = a === A_ATTACK || a === A_JATTACK
        ? Array.from({ length: STYLE_COUNT * MOVES_PER_STYLE }, (_, i) => i).filter((i) => mv(i, M_KIND) !== K_NONE)
        : [-1];
      for (const id of moves) {
        for (let af = 1; af <= 60; af += 1) {
          const t = s.slice();
          t[b + F_ACT] = a;
          t[b + F_AF] = af;
          t[b + F_MOVE] = id + 1;
          t[b + F_STUNK] = af % 2 + 1;
          t[b + F_KDOWN] = af;
          t[b + F_HITMV] = 1;
          const p = poseFor(t, 0);
          expect(POSES[p], `action ${a} move ${id} af ${af}`).toBeDefined();
        }
      }
    }
  });

  it("paints a fighter inside its box, mirrored when facing left", () => {
    const look = { ...DEFAULT_LOOK };
    for (const style of [0, 2, 5]) {
      const a = fakeCtx(RIG_W, RIG_H), bb = fakeCtx(RIG_W, RIG_H);
      paintFighter(a.ctx, POSES.hk1, { look, style, rank: 2 }, 0, 0, false);
      paintFighter(bb.ctx, POSES.hk1, { look, style, rank: 2 }, 0, 0, true);
      expect(a.outside()).toBe(0);
      expect(a.px.size).toBeGreaterThan(300);
      for (const [k, v] of a.px) {
        const [x, y] = k.split(",").map(Number);
        expect(bb.px.get(`${RIG_W - 1 - x},${y}`), k).toBe(v);
      }
    }
  });
});

describe("fight effects and HUD", () => {
  /** A jab on a standing fighter; returns every state. */
  function jab(): State[] {
    let s = start();
    s[fb(0) + F_X] = 182 * SUB;
    s[fb(1) + F_X] = 202 * SUB;
    const out = [s];
    for (let k = 0; k < 20; k++) {
      s = step(s, k === 0 ? IN_LP : 0, 0);
      out.push(s);
    }
    return out;
  }

  it("an effect starts on the hit frame, keyed by frame, fighter and move", () => {
    const states = jab();
    const hit = states.find((s) => effectsOf(s).some((e) => e.kind === "spark"))!;
    expect(hit).toBeDefined();
    const e = effectsOf(hit).find((x) => x.kind === "spark")!;
    expect(e.key).toBe(`${hit[G_FRAME]}:1:1`);
    expect(isFlashing(hit, 1, false)).toBe(true);
    expect(isFlashing(hit, 1, true)).toBe(false);
  });

  it("dedupes effect keys across a rollback, and drops a rolled-back hit", () => {
    const all = jab();
    const at = all.findIndex((s) => effectsOf(s).some((e) => e.kind === "spark"));
    const states = all.slice(0, at + 8);
    const fx = new EffectTracker();
    for (const s of states) fx.observe(s);
    const once = fx.keys().filter((k) => !k.endsWith("dust"));
    expect(once).toHaveLength(1);
    // roll back 12 frames and re-simulate the same inputs: the spark is not doubled
    for (const s of states.slice(states.length - 13)) fx.observe(s);
    expect(fx.keys().filter((k) => !k.endsWith("dust"))).toEqual(once);
    // roll back before the hit and predict a different input: the spark is dropped
    const fx2 = new EffectTracker();
    for (const s of states) fx2.observe(s);
    expect(fx2.keys().filter((k) => !k.endsWith("dust"))).toHaveLength(1);
    let alt = states[2];
    fx2.observe(alt);
    for (let k = 0; k < 3; k++) {
      alt = step(alt, 0, 0);
      fx2.observe(alt);
    }
    expect(fx2.keys()).toHaveLength(0);
  });

  it("hudText: the intro, the KO and the time-up copy", () => {
    let s = createMatch(makeParams(fighterParams(0, 0), fighterParams(0, 0)));
    s = step(s, 0, 0);
    expect(hudText(s, ["A", "B"]).banner).toBe("Hiệp 1");
    for (let k = 0; k < 70; k++) s = step(s, 0, 0);
    expect(hudText(s, ["A", "B"]).banner).toBe("Đấu!");
    const ko = s.slice();
    ko[G_PHASE] = PH_END;
    ko[G_LEFT] = 100;
    ko[G_LAST] = 1 * 4 + 2;
    expect(hudText(ko, ["A", "B"]).sub).toBe("Hạ đo ván!");
    ko[G_LAST] = 2 * 4 + 1;
    expect(hudText(ko, ["An", "Bình"])).toMatchObject({ banner: "Hết giờ!", sub: "An thắng hiệp này" });
    ko[G_LAST] = 2 * 4 + 0;
    expect(hudText(ko, ["A", "B"]).sub).toBe("Hòa!");
  });

  it("shows the combo counter on the attacker's side", () => {
    let s = start();
    s[fb(0) + F_X] = 182 * SUB;
    s[fb(1) + F_X] = 202 * SUB;
    const masks = [IN_LP, 0, 0, 0, 0, 8, 8 | 2, 2 | IN_HP];
    let seen: string | null = null;
    for (let k = 0; k < 30; k++) {
      s = step(s, masks[k] ?? 0, 0);
      seen = hudText(s, ["A", "B"]).combo[0] ?? seen;
    }
    expect(seen).toBe("2 đòn!");
  });

  it("paints a whole frame inside the 384 × 216 canvas", () => {
    const s = jab()[8];
    const f = fakeCtx(384, 216);
    paintScene(f.ctx, s, {
      arena: "practice", fighters: [{ look: DEFAULT_LOOK, style: 0, rank: 0 }, { look: DEFAULT_LOOK, style: 3, rank: 4 }],
      fx: new EffectTracker(), trail: new TrailTracker(), reduced: false, boxes: true,
    });
    expect(f.px.size).toBe(384 * 216);
    const h = fakeCtx(384, 216);
    paintHud(h.ctx, s, [1000, 1000], true);
    expect(h.outside()).toBe(0);
  });
});
