import { describe, it, expect } from "vitest";
import { POND_PROPS } from "@/lib/game/maps/pond";
import { propFrame } from "@/lib/game/maps/props";
import { getMap } from "@/lib/game/maps/registry";
import { MAP_IDS, type PropPlacement, type Rect } from "@/lib/game/maps/types";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { PROMPT_RANGE } from "@/lib/game/scene";

const box = (p: PropPlacement): Rect => {
  const f = propFrame(p);
  return { x: p.x - f.ox, y: p.y - f.oy, w: f.w, h: f.h };
};
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

describe("map registry", () => {
  it("builds each map once, under its own id", () => {
    for (const id of MAP_IDS) {
      expect(getMap(id).id).toBe(id);
      expect(getMap(id)).toBe(getMap(id));
    }
  });
  it("lands every portal on a walkable spot that is reachable from the target map's spawn", () => {
    for (const id of MAP_IDS) {
      for (const it of getMap(id).interactables.filter((i) => i.kind === "portal")) {
        const target = getMap(it.to!.map);
        const a = it.to!.arrive;
        expect(isBlockedAt(target, a.x, a.y), it.id).toBe(false);
        expect(findPath(target, target.spawn, a), it.id).not.toBeNull();
      }
    }
  });
  it("links the hall's dock sign and the pond's exit both ways, arriving next to the way back", () => {
    const dock = getMap("hall").interactables.find((i) => i.id === "dock_sign")!;
    const exit = getMap("pond").interactables.find((i) => i.id === "pond_exit")!;
    expect(dock).toMatchObject({ kind: "portal", to: { map: "pond" } });
    expect(exit).toMatchObject({ kind: "portal", to: { map: "hall" } });
    expect(Math.hypot(exit.to!.arrive.x - dock.use.x, exit.to!.arrive.y - dock.use.y)).toBeLessThanOrEqual(PROMPT_RANGE);
    // arriving at the pond does not show the exit prompt at once
    expect(Math.hypot(dock.to!.arrive.x - exit.use.x, dock.to!.arrive.y - exit.use.y)).toBeGreaterThan(PROMPT_RANGE);
  });
});

describe("pond art (pure parts)", () => {
  const pond = getMap("pond");
  const prop = (kind: PropPlacement["kind"]) => POND_PROPS.find((p) => p.kind === kind)!;
  const target = (id: string) => pond.interactables.find((i) => i.id === id)!.rect;
  it("anchors every pond prop at the bottom of its sprite frame", () => {
    for (const p of POND_PROPS) {
      const f = propFrame(p);
      expect(f.ox).toBeGreaterThanOrEqual(0);
      expect(f.ox).toBeLessThanOrEqual(f.w);
      expect(f.oy).toBeGreaterThan(f.h - 4);
      expect(f.oy).toBeLessThanOrEqual(f.h);
    }
  });
  it("draws the clickable things where their interaction rects are", () => {
    expect(box(prop("records"))).toEqual(target("records"));
    expect(contains(box(prop("sign")), target("pond_exit"))).toBe(true);
  });
});
