import { describe, expect, it } from "vitest";
import { A_ATTACK, A_IDLE, F_ACT, F_AF, F_MOVE, F_STYLE, INTRO_FRAMES, createMatch, fb, fighterParams, makeParams, step } from "@/lib/game/fight/engine";
import { K_NONE, M_KIND, MOVES_PER_STYLE, MV_HK, MV_LK, mv } from "@/lib/game/fight/moves";
import { POSES, poseFor, specialPoseIds, stancePoseIds } from "@/lib/game/fight/render/poses";
import { STYLE_ART } from "@/lib/game/fight/render/style-poses";
import { paintFighter, type PixelCtx } from "@/lib/game/fight/render/rig";
import { DEFAULT_LOOK } from "@/lib/game/look";

const at = (style: number) => {
  let s = createMatch(makeParams(fighterParams(style, 4), fighterParams(0, 0)));
  for (let k = 0; k < INTRO_FRAMES; k++) s = step(s, 0, 0);
  return s;
};

describe("each style's own keyframes on the rig (plan ruling P20)", () => {
  it("every style 1–7 has 2 stance frames and 3–5 keyframes per special, all defined", () => {
    for (let style = 1; style <= 7; style++) {
      const art = STYLE_ART[style]!;
      expect(art.stance).toHaveLength(2);
      expect(stancePoseIds(style).every((id) => POSES[id])).toBe(true);
      for (let slot = 1; slot <= 5; slot++) {
        const ids = specialPoseIds(style, slot);
        expect(ids.length, `${style}/${slot}`).toBeGreaterThanOrEqual(3);
        for (const id of ids) expect(POSES[id], `${style}/${slot} ${id}`).toBeDefined();
      }
    }
  });

  it("maps every frame of every special of every style to a defined pose, and uses the style's own", () => {
    for (let style = 1; style <= 7; style++) {
      const s = at(style);
      const b = fb(0);
      const own = new Set<string>();
      for (let idx = 12; idx < MOVES_PER_STYLE; idx++) {
        const id = style * MOVES_PER_STYLE + idx;
        if (mv(id, M_KIND) === K_NONE) continue;
        for (let af = 1; af <= 80; af++) {
          const t = s.slice();
          t[b + F_ACT] = A_ATTACK;
          t[b + F_AF] = af;
          t[b + F_MOVE] = id + 1;
          const p = poseFor(t, 0);
          expect(POSES[p], `${style} ${idx} ${af}`).toBeDefined();
          if (p.startsWith(`s${style}.`)) own.add(p);
        }
      }
      expect(own.size, `style ${style}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("idles in the style's stance, and the stances differ between styles", () => {
    const stances = new Set<string>();
    for (let style = 1; style <= 7; style++) {
      const s = at(style);
      s[fb(0) + F_ACT] = A_IDLE;
      expect(s[fb(0) + F_STYLE]).toBe(style);
      expect(poseFor(s, 0)).toMatch(new RegExp(`^s${style}\\.st[01]$`));
      stances.add(JSON.stringify(POSES[stancePoseIds(style)[0]]));
    }
    expect(stances.size).toBe(7);
    // Tự do keeps the shared idle
    const t = at(0);
    t[fb(0) + F_ACT] = A_IDLE;
    expect(poseFor(t, 0)).toMatch(/^idle[0-3]$/);
  });

  it("draws Quyền Anh's kicks as body punches", () => {
    const s = at(5);
    const b = fb(0);
    for (const idx of [MV_LK, MV_HK]) {
      const t = s.slice();
      t[b + F_ACT] = A_ATTACK;
      t[b + F_MOVE] = 5 * MOVES_PER_STYLE + idx + 1;
      t[b + F_AF] = mv(5 * MOVES_PER_STYLE + idx, 4) + 1;
      expect(poseFor(t, 0)).toMatch(/^s5\.(jab1|bhook1)$/);
    }
  });

  it("the mongkol and the champion's buckle appear at rank 4", () => {
    const count = (style: number, rank: number) => {
      const seen = new Map<string, string>();
      const c: PixelCtx = { fillStyle: "", fillRect(x, y) { seen.set(`${x},${y}`, String(this.fillStyle)); } };
      paintFighter(c, POSES.idle0, { look: DEFAULT_LOOK, style, rank }, 0, 0, false);
      return [...seen.values()];
    };
    expect(count(2, 4).filter((v) => v === "#f2efe6").length).toBeGreaterThan(count(2, 3).filter((v) => v === "#f2efe6").length);
    expect(count(5, 4)).toContain("#f6d26a");
    expect(count(5, 3)).not.toContain("#f6d26a");
  });
});
