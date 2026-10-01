import { describe, expect, it } from "vitest";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import { FISH_ICONS } from "@/lib/game/art/fish";
import { ChibiFactory } from "@/lib/game/diorama/character/build";
import { ACT_TOOL, heldFor, rodLookGeometry, TOOL_IDS, toolGeometry, WAVE1_LABEL } from "@/lib/game/diorama/character/held";
import { CHAR_ACTS, farmAct, JOINT_LIMITS, poseAt, REST, WAVE1_ACTS } from "@/lib/game/diorama/character/pose";
import { ChibiRig } from "@/lib/game/diorama/character/rig";
import { chibiSpec } from "@/lib/game/diorama/character/spec";
import { FISH_SPECIES_3D, fishParams } from "@/lib/game/diorama/world/fish3d";
import { fishSpeciesGeometry } from "@/lib/game/diorama/world/models";
import { DEFAULT_LOOK } from "@/lib/game/look";

const tris = (g: { getAttribute(n: string): { count: number } }) => g.getAttribute("position").count / 3;

describe("3D wave 1: farm animations", () => {
  it("every FARM_ANIM value (but stop) maps to a 3D pose", () => {
    for (const [name, code] of Object.entries(FARM_ANIM)) {
      if (code === 0) { expect(farmAct(name)).toBeUndefined(); continue; }
      const act = farmAct(name);
      expect(act, name).toBeDefined();
      expect(CHAR_ACTS).toContain(act);
      const p = poseAt(act!, 0.7);
      const moved = (["armR", "armL", "legL", "legR"] as const).some((k) => p[k].x !== REST[k].x || p[k].z !== REST[k].z) || p.lean !== 0;
      expect(moved, name).toBe(true);
    }
  });

  it("every wave-1 action stays within the joint limits and has a label", () => {
    for (const act of WAVE1_ACTS) {
      expect(WAVE1_LABEL[act], act).toBeTruthy();
      for (const t of [0, 0.3, 0.9, 2.1]) {
        const p = poseAt(act, t, 0.4);
        for (const [k, lim] of [["elbowL", JOINT_LIMITS.elbow], ["elbowR", JOINT_LIMITS.elbow], ["kneeL", JOINT_LIMITS.knee], ["kneeR", JOINT_LIMITS.knee]] as const) {
          expect(p[k]).toBeGreaterThanOrEqual(lim[0]);
          expect(p[k]).toBeLessThanOrEqual(lim[1]);
        }
        expect(Number.isFinite(p.lean + p.drop + p.bob)).toBe(true);
      }
    }
  });

  it("the lying poses lie flat; exhausted slumps forward", () => {
    for (const a of ["faint", "sleep", "hammock"] as const) expect(Math.abs(poseAt(a, 1).lean)).toBeCloseTo(Math.PI / 2, 3);
    expect(poseAt("exhausted", 1).lean).toBeGreaterThan(0.3);
  });
});

describe("3D wave 1: held tools", () => {
  it("every tool action has a mesh within a small budget (one draw call)", () => {
    for (const [act, hands] of Object.entries(ACT_TOOL)) {
      for (const id of [hands!.R, hands!.L]) {
        if (!id) continue;
        const { geo } = toolGeometry(id);
        expect(tris(geo), `${act}:${id}`).toBeGreaterThan(4);
        expect(tris(geo), `${act}:${id}`).toBeLessThan(2500);
        expect(geo.getAttribute("outline"), id).toBeTruthy();
      }
    }
    for (const id of TOOL_IDS) expect(tris(toolGeometry(id).geo), id).toBeGreaterThan(0);
  });

  it("the axe, pan, pickaxe, sickle, sling, sprayer, pump, shovel, baskets, umbrella and camera are held by their actions", () => {
    const want: Record<string, string> = { chop: "axe", cook: "pan", mine: "pickaxe", harvest: "sickle", spray: "sprayer", pump: "pump", dig: "shovel", prepare: "hoe", photo: "camera", drink: "cup" };
    for (const [act, tool] of Object.entries(want)) expect(heldFor(act as never).R, act).toBe(tool);
    expect(heldFor("aim").L).toBe("sling");
    expect(heldFor("crab").L).toBe("crab_basket");
    expect(heldFor("snails").L).toBe("snail_basket");
    expect(heldFor("idle", { umbrella: true }).L).toBe("umbrella");
    expect(heldFor("cast", { umbrella: true, fish: "ca_ro" })).toEqual({ R: null, L: null });   // the rod needs both hands
    expect(heldFor("show_catch", { fish: "ca_loc" }).R).toBe("fish:ca_loc");
    expect(heldFor("walk", { fish: "ca_loc" }).R).toBe("fish:ca_loc");
  });

  it("the rig shows the held meshes and the rod looks per loadout", () => {
    const f = new ChibiFactory(), rig = new ChibiRig();
    rig.setParts(f.acquire(chibiSpec(DEFAULT_LOOK), "low").parts);
    rig.setHeld("axe", "bowl");
    expect(rig.heldIds()).toEqual({ R: "axe", L: "bowl" });
    rig.setHeld(null, null);
    expect(rig.heldIds()).toEqual({ R: "", L: "" });
    const a = rodLookGeometry({ rod: "rod_bamboo", reel: "reel_5000", bobber: "bobber_foam" });
    const b = rodLookGeometry({ rod: "rod_carbon", reel: null, bobber: null });
    expect(a).not.toBe(b);
    expect(tris(a)).toBeGreaterThan(tris(b));                                       // the reel and bobber add parts
    expect(tris(a)).toBeLessThan(3000);
    f.dispose();
  });
});

describe("3D wave 1: fish species", () => {
  it("every fish species with 2D art has 3D params and a model within budget", () => {
    expect(FISH_SPECIES_3D.length).toBe(Object.keys(FISH_ICONS).length);
    expect(FISH_SPECIES_3D.length).toBeGreaterThanOrEqual(20);
    for (const id of FISH_SPECIES_3D) {
      const f = fishParams(id);
      expect(f.len, id).toBeGreaterThan(0.2);
      expect(f.depth, id).toBeGreaterThan(0.05);
      expect(f.body, id).not.toBe(f.belly);
      expect(tris(fishSpeciesGeometry(id)), id).toBeLessThan(6000);
    }
    expect(fishParams("luon_dong").kind).toBe("eel");
    expect(fishParams("tom_cang").kind).toBe("shrimp");
    expect(fishParams("ba_ba").kind).toBe("turtle");
    // species differ: not one generic fish
    const looks = new Set(FISH_SPECIES_3D.map((id) => JSON.stringify(fishParams(id))));
    expect(looks.size).toBe(FISH_SPECIES_3D.length);
  });
});
