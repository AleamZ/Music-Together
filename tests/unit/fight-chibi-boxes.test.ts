import { describe, expect, it } from "vitest";
import { MARTIAL } from "@/lib/game/fight/dojo";
import { HURT_AIR, HURT_CROUCH, HURT_STAND } from "@/lib/game/fight/engine";
import { K_CROUCH, K_JUMP, K_STAND, K_STRIKE, M_KIND, M_REACH, M_SLOT, MOVES_PER_STYLE, STYLE_COUNT, mv } from "@/lib/game/fight/moves";
import { chibiMatrix, chibiPoseOf } from "@/lib/game/fight/render/chibi";
import { RIG_H, RIG_W, moveKeys, stancePoseIds, type PoseId } from "@/lib/game/fight/render/poses";
import { STYLE_ART, styleRef } from "@/lib/game/fight/render/style-poses";
import { DEFAULT_LOOK } from "@/lib/game/look";

// 0079: the engine's boxes fit the chibi fighter (render/chibi.ts, the default painter). Measured on the painter's own
// matrix (the speed streaks left out): the opaque pixels' extent from the fighter's x (the box's centre column) and
// their height over the feet row.

const STREAK = /^#ffffff[0-9a-f]{2}$/;
function bounds(pose: PoseId, style: number): { front: number; height: number } {
  const look = MARTIAL.find((m) => m.id === style)?.masterLook ?? { ...DEFAULT_LOOK, hat: null };
  const mat = chibiMatrix(chibiPoseOf(pose, style), { look, style, rank: 2 });
  let front = -RIG_W, top = RIG_H;
  mat.forEach((row, y) => row.forEach((c, x) => {
    if (!c || STREAK.test(c)) return;
    front = Math.max(front, x - RIG_W / 2);
    top = Math.min(top, y);
  }));
  return { front, height: RIG_H - top };
}

/** The poses shown on move `id`'s active frames. */
function activePoses(style: number, id: number): PoseId[] {
  const slot = mv(id, M_SLOT);
  const own = slot > 0 ? STYLE_ART[style]?.specials[slot] : null;
  return own ? own.a.map((n) => styleRef(style, n)) : [moveKeys(id)[1]];
}

describe("the boxes fit the chibi (0079)", () => {
  it("every strike reaches its limb on the active frame, ±2 px", () => {
    for (let st = 0; st < STYLE_COUNT; st++) {
      for (let i = 0; i < MOVES_PER_STYLE; i++) {
        const id = st * MOVES_PER_STYLE + i, kind = mv(id, M_KIND);
        if (kind !== K_STAND && kind !== K_CROUCH && kind !== K_JUMP && kind !== K_STRIKE) continue;
        const limb = Math.max(...activePoses(st, id).map((p) => bounds(p, st).front));
        const reach = mv(id, M_REACH);
        expect(Math.abs(reach - limb), `style ${st} move ${i}: reach ${reach}, limb ${limb}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("the hurtboxes hug the body, the head included", () => {
    for (let st = 0; st < STYLE_COUNT; st++) {
      const stand = [...stancePoseIds(st), "guard", "walk0", "walk1", "walk2", "walk3"].map((p) => bounds(p, st));
      // the tallest standing frame (a boxer's bob dips lower; nothing stands above the box by more than 3 px)
      expect(Math.abs(Math.max(...stand.map((b) => b.height)) - HURT_STAND[1]), `style ${st} stand`).toBeLessThanOrEqual(3);
      for (const b of stand) expect(b.front, `style ${st} stand front`).toBeLessThanOrEqual(HURT_STAND[0] / 2 + 4);
      for (const p of ["crouch", "cguard"]) expect(Math.abs(bounds(p, st).height - HURT_CROUCH[1]), `style ${st} ${p}`).toBeLessThanOrEqual(3);
      for (const p of ["jump0", "jump1", "jump2"]) expect(Math.abs(bounds(p, st).height - HURT_AIR[1]), `style ${st} ${p}`).toBeLessThanOrEqual(4);
    }
  });
});
