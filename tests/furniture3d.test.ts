import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { FURNITURE } from "@/lib/game/housing/apartment";
import { furniture3dIds, furnitureGeometry, FURNITURE3D_DESC } from "@/lib/game/diorama/world/furniture3d";
import { CHAR_ACTS, poseAt, JOINT_LIMITS } from "@/lib/game/diorama/character/pose";
import { EXTRA_ACTS } from "@/lib/game/diorama/character/pose-extra";
import { cardAct, reactionAct } from "@/lib/game/diorama/character/emote";

describe("3D wave 3", () => {
  it("every furniture id has a 3D model and a description", () => {
    expect(furniture3dIds()).toEqual(FURNITURE.map((f) => f.id));
    for (const f of FURNITURE) {
      expect(furnitureGeometry(f.id)!.getAttribute("position").count).toBeGreaterThan(0);
      expect(FURNITURE3D_DESC[f.id]).toBeTruthy();
    }
    expect(furnitureGeometry("nope")).toBeNull();
  });
  it("the extra acts are chibi acts and keep the joint limits", () => {
    for (const a of EXTRA_ACTS) {
      expect(CHAR_ACTS).toContain(a);
      for (const t of [0, 0.3, 1.1]) {
        const p = poseAt(a, t);
        expect(p.elbowR).toBeGreaterThanOrEqual(JOINT_LIMITS.elbow[0]);
        expect(p.kneeL).toBeLessThanOrEqual(JOINT_LIMITS.knee[1]);
      }
    }
  });
  it("reactions and card tables pick their emotes", () => {
    expect(reactionAct("🎉")).toBe("dance");
    expect(reactionAct("👏")).toBe("clap");
    expect(reactionAct("❤️")).toBe("wave");
    expect(cardAct(0, 0, true)).toBe("card_win");
    expect(["card_hold", "card_play"]).toContain(cardAct(3000, 0, false));
  });
});
