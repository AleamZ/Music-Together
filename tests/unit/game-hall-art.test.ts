import { describe, it, expect } from "vitest";
import { buildHallMap, HALL_PROPS } from "@/lib/game/maps/hall";
import { propFrame } from "@/lib/game/maps/props";
import { rng } from "@/lib/game/maps/scene-art";
import type { PropPlacement, Rect } from "@/lib/game/maps/types";

const hall = buildHallMap();
const box = (p: PropPlacement): Rect => {
  const f = propFrame(p);
  return { x: p.x - f.ox, y: p.y - f.oy, w: f.w, h: f.h };
};
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
const prop = (kind: PropPlacement["kind"]) => HALL_PROPS.find((p) => p.kind === kind)!;
const target = (id: string) => hall.interactables.find((i) => i.id === id)!.rect;

describe("hall art (pure parts)", () => {
  it("rng is deterministic and stays in [0, 1)", () => {
    const a = rng(42), b = rng(42);
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(rng(1)()).not.toBe(rng(2)());
  });

  it("anchors every prop at the bottom of its sprite frame", () => {
    for (const p of HALL_PROPS) {
      const f = propFrame(p);
      expect(f.ox).toBeGreaterThanOrEqual(0);
      expect(f.ox).toBeLessThanOrEqual(f.w);
      expect(f.oy).toBeGreaterThan(f.h - 4);
      expect(f.oy).toBeLessThanOrEqual(f.h);
    }
  });

  it("draws the clickable things where their interaction rects are", () => {
    expect(contains(target("dj_booth"), box(prop("mixer")))).toBe(true);
    expect(box(prop("board"))).toEqual(target("notice_board"));
    expect(contains(box(prop("sign")), target("dock_sign"))).toBe(true);
  });

  it("draws the card tables and the corner's sign where their interaction rects are (v16 spec §5)", () => {
    const tables = HALL_PROPS.filter((p) => p.kind === "card_table");
    expect(tables.map(box)).toEqual(["cards_tienlen", "cards_cao", "cards_poker"].map(target));
    const sign = HALL_PROPS.find((p) => p.kind === "sign" && p.icon === "cards")!;
    expect(box(sign)).toEqual(target("cards_sign"));
  });

  it("sizes the hammock from its two anchors", () => {
    expect(propFrame({ kind: "hammock", x: 96, y: 202, x2: 170 })).toEqual({ w: 82, h: 34, ox: 4, oy: 32 });
  });
});
