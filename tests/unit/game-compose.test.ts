import { describe, it, expect } from "vitest";
import { bodyPalette, composeMatrix, lookKey } from "@/lib/game/art/compose";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { OUTLINE, SKIN } from "@/lib/game/art/palettes";

describe("composeMatrix", () => {
  it("returns a 48×24 colour matrix", () => {
    const m = composeMatrix(DEFAULT_LOOK, "down", 0);
    expect(m).toHaveLength(48);
    for (const row of m) expect(row).toHaveLength(24);
  });
  it("mirrors left into right", () => {
    const l = composeMatrix(DEFAULT_LOOK, "left", 2);
    const r = composeMatrix(DEFAULT_LOOK, "right", 2);
    expect(r.map((row) => [...row].reverse())).toEqual(l);
  });
  it("draws the nón lá tip on row 0, and nothing there without a hat", () => {
    expect(composeMatrix(DEFAULT_LOOK, "down", 0)[0][11]).toBe(OUTLINE);
    expect(composeMatrix({ ...DEFAULT_LOOK, hat: null }, "down", 0)[0][11]).toBe("");
  });
  it("draws hair over the bald head", () => {
    const m = composeMatrix({ ...DEFAULT_LOOK, hat: null, hairColor: "pink" }, "down", 0);
    expect(m[6][11]).toBe("#e889b5");
  });
  it("renders unknown items with placeholders instead of throwing", () => {
    expect(() => composeMatrix({ ...DEFAULT_LOOK, hat: "nope", top: "nope", bottom: "nope", shoes: "nope" }, "up", 1)).not.toThrow();
  });
});

describe("bodyPalette", () => {
  it("hides pocket details on tees and shows them on áo bà ba", () => {
    const tee = bodyPalette({ ...DEFAULT_LOOK, top: "top_tee_blue" });
    expect(tee.K).toBe(tee.t);
    const baba = bodyPalette(DEFAULT_LOOK);
    expect(baba.K).not.toBe(baba.t);
  });
  it("shows skin below shorts and fabric below long pants", () => {
    const shorts = bodyPalette(DEFAULT_LOOK);
    expect(shorts.g).toBe(SKIN.warm.s);
    expect(shorts.j).toBe(OUTLINE);
    const jeans = bodyPalette({ ...DEFAULT_LOOK, bottom: "bottom_jeans" });
    expect(jeans.g).toBe(jeans.p);
    expect(jeans.j).toBe(jeans.P);
  });
  it("without a scarf: side tails vanish, band and front tails read as the shirt", () => {
    const p = bodyPalette({ ...DEFAULT_LOOK, neck: null });
    expect([p.v, p.V, p.n]).toEqual([null, null, null]);
    expect([p.q, p.Q, p.r, p.R]).toEqual([p.t, p.t, p.t, p.t]);
  });
});

describe("lookKey", () => {
  it("is stable and changes with any part", () => {
    expect(lookKey({ ...DEFAULT_LOOK })).toBe(lookKey(DEFAULT_LOOK));
    expect(lookKey({ ...DEFAULT_LOOK, neck: null })).not.toBe(lookKey(DEFAULT_LOOK));
  });
});
