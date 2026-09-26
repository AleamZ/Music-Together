import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import {
  COAT_PAL, DOG_ANCHOR, DOG_FIXED, DOG_FRAMES, DOG_H, DOG_W, dogArt, dogFrame, dogMatrix, drawDog, getDogFrames, type DogFrame,
} from "@/lib/game/art/dog";
import { drawFarmAnim } from "@/lib/game/art/farm-anim";
import { drawRat, RAT_ART, RAT_FRAMES, RAT_H, RAT_PAL, RAT_W, ratFrame, ratMatrix } from "@/lib/game/art/rats";
import { DOG_COATS } from "@/lib/game/dog";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import type { Facing } from "@/lib/game/types";

const FACINGS: Facing[] = ["down", "up", "left", "right"];

// jsdom has no 2D canvas: the sprite caches get blank canvases, quietly
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  vi.restoreAllMocks();
});

/** A 2D context that records the colour of every pixel filled, and the images drawn. */
function recorder() {
  const px: Array<{ col: string; x: number; y: number }> = [];
  const images: Array<[number, number, number?, number?]> = [];
  const c = {
    fillStyle: "",
    fillRect(x: number, y: number, w: number, h: number) {
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) px.push({ col: String(this.fillStyle), x: x + i, y: y + j });
    },
    drawImage: vi.fn((_img: unknown, x: number, y: number, w?: number, h?: number) => { images.push([x, y, w, h]); }),
  };
  return { c: c as unknown as CanvasRenderingContext2D, px, images };
}

describe("the rat's art (§14)", () => {
  it("has five 10 × 7 side frames in its palette", () => {
    expect(RAT_FRAMES).toEqual(["run0", "run1", "nibble0", "nibble1", "fall"]);
    expect(RAT_PAL).toEqual({
      f: "#7a6450", s: "#5a4636", b: "#b8a48a", p: "#c98f86", e: "#1c1410", o: "#2e2218", g: "#e0b33c",
    });
    for (const f of RAT_FRAMES) {
      expect(RAT_ART[f], f).toHaveLength(RAT_H);
      for (const row of RAT_ART[f]) {
        expect(row, f).toHaveLength(RAT_W);
        for (const ch of row) expect(ch === "." || ch in RAT_PAL, `${f}: ${ch}`).toBe(true);
      }
    }
    // a nibbling rat has its grain; a running one does not
    expect(ratMatrix("nibble0", 1).flat()).toContain("#e0b33c");
    expect(ratMatrix("run0", 1).flat()).not.toContain("#e0b33c");
  });
  it("mirrors for left, and picks run or nibble frames by time", () => {
    for (const f of RAT_FRAMES) expect(ratMatrix(f, -1), f).toEqual(ratMatrix(f, 1).map((row) => [...row].reverse()));
    expect([ratFrame(true, 0), ratFrame(true, 120), ratFrame(true, 240)]).toEqual(["run0", "run1", "run0"]);
    expect([ratFrame(false, 0), ratFrame(false, 400)]).toEqual(["nibble0", "nibble1"]);
  });
  it("draws with its feet's middle at the point, at × 1 or × 2", () => {
    const r = recorder();
    drawRat(r.c, "run0", 1, 100, 50);
    drawRat(r.c, "fall", -1, 160, 70, 2);
    expect(r.images).toEqual([[95, 43, 10, 7], [150, 56, 20, 14]]);
  });
});

describe("the dog's art (§14)", () => {
  it("has every coat's colours", () => {
    expect(DOG_COATS.map((c) => COAT_PAL[c])).toEqual([
      { b: "#c8913f", B: "#9a6a2c", w: "#ecd3a2", d: "#9a6a2c" },
      { b: "#2f2a28", B: "#1b1716", w: "#5a4f48", d: "#1b1716" },
      { b: "#a8783e", B: "#7a5226", w: "#d8b88a", d: "#4a3018" },
      { b: "#efe6d4", B: "#c9bca4", w: "#fbf6ea", d: "#4a3a2a" },
    ]);
    expect(DOG_FIXED).toMatchObject({ n: "#1c1410", e: "#1c1410", t: "#d9776a", c: "#c0392b" });
  });
  it("draws every coat, facing and frame at 20 × 16 in the coat's palette, standing on its anchor", () => {
    expect(DOG_FRAMES).toHaveLength(13);
    const bad: string[] = [];
    for (const coat of DOG_COATS) {
      const allowed = new Set(["", ...Object.values(COAT_PAL[coat]), ...Object.values(DOG_FIXED)]);
      for (const facing of FACINGS) for (const frame of DOG_FRAMES) {
        const m = dogMatrix(coat, facing, frame), id = `${coat} ${facing} ${frame}`;
        if (m.length !== DOG_H || m.some((row) => row.length !== DOG_W)) bad.push(`${id}: size`);
        for (const col of m.flat()) if (!allowed.has(col)) bad.push(`${id}: ${col}`);
        // feet on the anchor's row, within 6 px of it, unless the dog runs or leaps
        if (!["run0", "run1", "leap"].includes(frame)) {
          const feet = m[DOG_ANCHOR.y].map((col, x) => (col ? Math.abs(x - DOG_ANCHOR.x) : 99));
          if (Math.min(...feet) > 6) bad.push(`${id}: feet`);
        }
      }
    }
    expect(bad).toEqual([]);
  }, 30_000);
  it("mirrors right for left, and moves between its frames", () => {
    for (const frame of DOG_FRAMES) {
      expect(dogMatrix("vang", "left", frame), frame).toEqual(dogMatrix("vang", "right", frame).map((row) => [...row].reverse()));
    }
    const pairs: Array<[DogFrame, DogFrame]> = [
      ["walk0", "walk2"], ["walk0", "idle"], ["walk2", "idle"], ["wag0", "wag1"], ["run0", "run1"], ["sit", "hungry"],
      ["sit", "idle"], ["carry", "idle"], ["leap", "idle"],
    ];
    for (const facing of ["down", "up", "right"] as const) {
      for (const [a, b] of pairs) expect(dogArt(facing, a).join("|"), `${facing} ${a}/${b}`).not.toBe(dogArt(facing, b).join("|"));
    }
  });
  it("puts vện's stripes and đốm's spots on the body, the others plain", () => {
    const count = (coat: "vang" | "muc" | "ven" | "dom") =>
      dogMatrix(coat, "right", "idle").flat().filter((c) => c === COAT_PAL[coat].d).length;
    const paws = dogArt("right", "idle").join("").split("").filter((ch) => ch === "d").length;
    expect(count("ven")).toBeGreaterThan(paws + 4);
    expect(count("dom")).toBeGreaterThan(paws + 4);
    // vàng and mực draw d as their shade: only the paws, the ear tip and the shaded pixels
    expect(dogMatrix("vang", "right", "idle").flat()).not.toContain("#4a3018");
  });
  it("hangs its ears and tail when hungry, shows the tongue when wagging, and carries the rat at its mouth", () => {
    expect(dogArt("right", "hungry")).not.toEqual(dogArt("right", "sit"));
    expect(dogArt("down", "wag0").join("")).toContain("t");
    expect(dogArt("right", "carry").join("")).toMatch(/R/);
    expect(dogArt("down", "carry").join("")).toMatch(/R/);
  });
  it("picks frames from the follower's pose and the time", () => {
    expect([0, 150, 300, 450, 600].map((t) => dogFrame("walk", t))).toEqual(["walk0", "walk1", "walk2", "walk3", "walk0"]);
    expect([dogFrame("run", 0), dogFrame("run", 100)]).toEqual(["run0", "run1"]);
    expect([dogFrame("wag", 0), dogFrame("wag", 150)]).toEqual(["wag0", "wag1"]);
    expect(["idle", "sit", "hungry", "leap", "carry"].map((p) => dogFrame(p as "idle", 777))).toEqual(["idle", "sit", "hungry", "leap", "carry"]);
  });
  it("caches the sprites per coat and draws the anchor at the point", () => {
    expect(getDogFrames("muc")).toBe(getDogFrames("muc"));
    expect(getDogFrames("muc").left.sit).toBeDefined();
    const r = recorder();
    drawDog(r.c, "ven", "down", "idle", 200, 120);
    expect(r.images).toEqual([[190, 105, undefined, undefined]]);
  });
});

describe("the v17 farm animations (§14)", () => {
  const feet = { x: 100, y: 100 };
  const colours = (a: 11 | 12, t: number, reduced = false, facing: Facing = "down") => {
    const r = recorder();
    drawFarmAnim(r.c, feet, facing, a, t, reduced);
    return r.px;
  };
  it("pets with the hand lowered in front and three rising hearts", () => {
    const px = colours(FARM_ANIM.pet, 0);
    expect(px.filter((p) => p.col === "#e0526a")).toHaveLength(3 * 6);
    expect(px.some((p) => p.col === "#e8b890")).toBe(true);
    const later = colours(FARM_ANIM.pet, 300);
    expect(later).not.toEqual(px);
    // reduced motion holds one pose
    expect(colours(FARM_ANIM.pet, 0, true)).toEqual(colours(FARM_ANIM.pet, 500, true));
  });
  it("aims with the fork, the band drawn back to the chest and a pellet, trembling every other beat", () => {
    const px = colours(FARM_ANIM.aim, 0);
    for (const col of ["#8b5a33", "#2e2a2a", "#a0522d"]) expect(px.some((p) => p.col === col), col).toBe(true);
    expect(colours(FARM_ANIM.aim, 180)).not.toEqual(px);
    expect(colours(FARM_ANIM.aim, 360)).toEqual(px);
    expect(colours(FARM_ANIM.aim, 180, true)).toEqual(colours(FARM_ANIM.aim, 0, true));
    for (const facing of FACINGS) expect(colours(FARM_ANIM.aim, 0, false, facing).length, facing).toBeGreaterThan(10);
  });
});
