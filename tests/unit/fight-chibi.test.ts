import { afterEach, describe, expect, it } from "vitest";
import { composeHeadMatrix } from "@/lib/game/art/compose";
import { HAIR_COLOR, SKIN } from "@/lib/game/art/palettes";
import { BELT_COLORS } from "@/lib/game/art/uniforms";
import { createMatch, fighterParams, INTRO_FRAMES, makeParams, step, type State } from "@/lib/game/fight/engine";
import {
  K_ARM, K_LEG, STRIKE_POSES, chibiMatrix, chibiPose, chibiPoseOf, paintChibiFighter,
} from "@/lib/game/fight/render/chibi";
import { FIGHTER_ART_KEY, parseFighterArt, readFighterArt, writeFighterArt } from "@/lib/game/fight/render/fighter-art";
import { ARENA_H, ARENA_W, TrailTracker } from "@/lib/game/fight/render/hud";
import { EffectTracker } from "@/lib/game/fight/render/fx";
import { J, JOINTS, POSES, POSE_IDS, RIG_H, RIG_W } from "@/lib/game/fight/render/poses";
import type { PixelCtx } from "@/lib/game/fight/render/rig";
import { paintScene } from "@/lib/game/fight/render/scene";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Look } from "@/lib/game/types";

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

const LOOK: Look = { ...DEFAULT_LOOK, hat: null, neck: null, hair: "short", hairColor: "brown", skin: "tan" };
const armLen = (p: readonly (readonly [number, number])[], sh: number, hn: number) => Math.hypot(p[hn][0] - p[sh][0], p[hn][1] - p[sh][1]);

describe("fighter art flag", () => {
  afterEach(() => window.localStorage.clear());

  it("parses only 'rig' as the rig painter; everything else is the chibi (the default)", () => {
    expect(parseFighterArt("rig")).toBe("rig");
    expect(parseFighterArt(" Rig ")).toBe("rig");
    for (const v of ["chibi", "", "rigs", "1", null, undefined]) expect(parseFighterArt(v)).toBe("chibi");
  });

  it("reads and writes the browser's choice (chibi clears the key)", () => {
    expect(readFighterArt()).toBe("chibi");
    writeFighterArt("rig");
    expect(window.localStorage.getItem(FIGHTER_ART_KEY)).toBe("rig");
    expect(readFighterArt()).toBe("rig");
    writeFighterArt("chibi");
    expect(window.localStorage.getItem(FIGHTER_ART_KEY)).toBeNull();
    expect(readFighterArt()).toBe("chibi");
  });
});

describe("chibi pose mapping", () => {
  it("maps every rig pose to 14 joints inside the 48 × 64 box", () => {
    for (const id of POSE_IDS) {
      const cp = chibiPoseOf(id);
      expect(cp.joints, id).toHaveLength(JOINTS);
      for (const [x, y] of cp.joints) expect(x >= 1 && x < RIG_W - 1 && y >= 1 && y < RIG_H, `${id} ${x},${y}`).toBe(true);
    }
  });

  it("keeps the feet on the ground and shortens the body to chibi proportions", () => {
    const cp = chibiPose(POSES.idle0);
    expect(cp.joints[J.ftF][1]).toBe(RIG_H - 1);
    expect(cp.joints[J.ftB][1]).toBe(RIG_H - 1);
    const rigHip = RIG_H - 1 - POSES.idle0[J.hip][1];
    expect(RIG_H - 1 - cp.joints[J.hip][1]).toBe(Math.round(rigHip * K_LEG));
    // the chin sits above the shoulders, the head upright
    expect(cp.joints[J.neck][1]).toBeLessThan(cp.joints[J.chest][1]);
    expect(cp.turn).toBe(0);
    expect(cp.reach).toBe(-1);
    expect(cp.strike).toBe(false);
    const rest = armLen(POSES.idle0, J.shF, J.hnF) * K_ARM;
    expect(Math.abs(armLen(cp.joints, J.shF, J.hnF) - rest)).toBeLessThan(2);
  });

  it("a punch or a kick reaches further than a resting limb, and strikes on its active frame", () => {
    const lp = chibiPose(POSES.lp1, true);
    expect(lp.reach).toBe(J.hnF);
    expect(lp.strike).toBe(true);
    expect(armLen(lp.joints, J.shF, J.hnF)).toBeGreaterThan(armLen(POSES.lp1, J.shF, J.hnF) * K_ARM + 1);
    const hk = chibiPose(POSES.hk1, true);
    expect(hk.reach).toBe(J.ftF);
    expect(hk.joints[J.ftF][0] - hk.joints[J.hip][0]).toBeGreaterThanOrEqual(14);
    // the same pose off its active frame reaches but draws no streaks
    expect(chibiPose(POSES.lp1, false).strike).toBe(false);
  });

  it("turns the head when the fighter lies down", () => {
    for (const id of ["down0", "down1", "fall"]) expect(chibiPoseOf(id).turn, id).not.toBe(0);
    for (const id of ["idle0", "guard", "crouch", "hit_high", "getup0"]) expect(chibiPoseOf(id).turn, id).toBe(0);
  });

  it("knows the strike frames: every normal's active key, not the stances", () => {
    for (const id of ["lp1", "hp1", "lk1", "hk1", "clk1", "jhk"]) expect(STRIKE_POSES.has(id), id).toBe(true);
    for (const id of ["idle0", "guard", "walk0", "block", "hit_mid", "down0"]) expect(STRIKE_POSES.has(id), id).toBe(false);
  });
});

describe("chibi painter", () => {
  it("draws the world chibi's head: its hair and skin, the face toward the facing", () => {
    const right = composeHeadMatrix(LOOK, "right"), left = composeHeadMatrix(LOOK, "left");
    const flat = right.flat();
    expect(flat).toContain(HAIR_COLOR.brown.h);
    expect(flat).toContain(SKIN.tan.s);
    // nothing of the torso: the chin line is the lowest skin row
    expect(right.slice(21).flat()).not.toContain(SKIN.tan.s);
    right.forEach((row, y) => expect([...row].reverse(), `row ${y}`).toEqual(left[y]));
  });

  it("paints inside its box, mirrored when facing left, all white when flashing", () => {
    for (const style of [0, 1, 2, 5]) for (const pose of ["guard", "hp1", "hk1", "down0", "s1.s1b"]) {
      const fl = { look: LOOK, style, rank: 2 };
      const a = fakeCtx(RIG_W, RIG_H), b = fakeCtx(RIG_W, RIG_H), w = fakeCtx(RIG_W, RIG_H);
      paintChibiFighter(a.ctx, pose, fl, 0, 0, false);
      paintChibiFighter(b.ctx, pose, fl, 0, 0, true);
      paintChibiFighter(w.ctx, pose, fl, 0, 0, false, true);
      expect(a.outside()).toBe(0);
      expect(a.px.size, `${style} ${pose}`).toBeGreaterThan(300);
      for (const [k, v] of a.px) {
        const [x, y] = k.split(",").map(Number);
        expect(b.px.get(`${RIG_W - 1 - x},${y}`), k).toBe(v);
      }
      expect(new Set(w.px.values())).toEqual(new Set(["#ffffff"]));
      expect(w.px.size).toBe(a.px.size);
    }
  });

  it("wears the style's võ phục with the rank's belt, and the player's skin", () => {
    const colours = (style: number, rank: number) => new Set(chibiMatrix(chibiPoseOf("guard"), { look: LOOK, style, rank }).flat());
    const vovinam = colours(1, 3);
    expect(vovinam.has("#2f5fb8")).toBe(true);
    expect(vovinam.has(BELT_COLORS.vovinam[3])).toBe(true);
    expect(vovinam.has(SKIN.tan.s)).toBe(true);
    expect(colours(3, 0).has("#f3f0e7")).toBe(true); // karate's white gi
    expect(colours(5, 1).has("#e0504a")).toBe(true); // boxing gloves
  });

  it("draws speed streaks only on a strike frame", () => {
    const fl = { look: LOOK, style: 0, rank: 0 };
    const streak = (m: string[][]) => m.flat().some((c) => c.startsWith("#ffffff") && c.length === 9);
    expect(streak(chibiMatrix(chibiPose(POSES.hp1, true), fl))).toBe(true);
    expect(streak(chibiMatrix(chibiPose(POSES.hp1, false), fl))).toBe(false);
    expect(streak(chibiMatrix(chibiPoseOf("guard"), fl))).toBe(false);
  });
});

describe("scene with the chibi painter", () => {
  it("draws the same arena, with different fighters, when asked for the chibi", () => {
    let s: State = createMatch(makeParams(fighterParams(1, 2), fighterParams(2, 1)));
    for (let k = 0; k < INTRO_FRAMES; k++) s = step(s, 0, 0);
    const view = (art?: "rig" | "chibi") => ({
      arena: "dojo" as const, fighters: [{ look: LOOK, style: 1, rank: 2 }, { look: DEFAULT_LOOK, style: 2, rank: 1 }] as const,
      fx: new EffectTracker(), trail: new TrailTracker(), reduced: true, boxes: false, art,
    });
    const rig = fakeCtx(ARENA_W, ARENA_H), dflt = fakeCtx(ARENA_W, ARENA_H), chibi = fakeCtx(ARENA_W, ARENA_H);
    paintScene(rig.ctx, s, view("rig"));
    paintScene(dflt.ctx, s, view());
    paintScene(chibi.ctx, s, view("chibi"));
    expect([...dflt.px]).toEqual([...rig.px]);
    const diff = [...chibi.px].filter(([k, v]) => rig.px.get(k) !== v).length;
    expect(diff).toBeGreaterThan(200);
  });
});
