import { describe, it, expect } from "vitest";
import { FIELD_EAST_ARRIVE, FIELD_WEST_ARRIVE, HALL_FIELD_ARRIVE, POND_FIELD_ARRIVE } from "@/lib/game/maps/arrivals";
import { BRIDGES, buildFieldMap, CANAL, DRYING_SQUARES, DRYING_YARD, FIELD_PLOTS, FIELD_SOLIDS } from "@/lib/game/maps/field";
import { propFrame } from "@/lib/game/maps/props";
import { overlaps } from "@/lib/game/maps/rect";
import type { InteractKind, Rect } from "@/lib/game/maps/types";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { cameraFor, computeView } from "@/lib/game/scene";

const field = buildFieldMap();
const ofKind = (k: InteractKind) => field.interactables.filter((i) => i.kind === k);
const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;
/** Distance from a point to a rect's edge (0 inside). */
const gap = (p: { x: number; y: number }, r: Rect) =>
  Math.hypot(Math.max(r.x - p.x, 0, p.x - (r.x + r.w)), Math.max(r.y - p.y, 0, p.y - (r.y + r.h)));

describe("field map", () => {
  it("has the documented size, grid and interactables", () => {
    expect(field.id).toBe("field");
    expect([field.width, field.height, field.cell, field.cols, field.rows]).toEqual([800, 480, 8, 100, 60]);
    expect(field.blocked).toHaveLength(100 * 60);
    expect(field.seating).toBeNull();
    expect(field.spawn).toEqual(FIELD_WEST_ARRIVE);
    expect(field.interactables.map((i) => i.id).sort()).toEqual([
      "coop", "drying", "farm_shop", "field_to_hall", "field_to_pond",
      "plot_1", "plot_10", "plot_2", "plot_3", "plot_4", "plot_5", "plot_6", "plot_7", "plot_8", "plot_9", "rice_depot",
    ]);
  });
  it("uses the spec's prompts", () => {
    const prompt = (id: string) => field.interactables.find((i) => i.id === id)?.prompt;
    expect(prompt("field_to_hall")).toBe("Về sảnh nhạc");
    expect(prompt("field_to_pond")).toBe("Qua cầu khỉ về ao cá");
    expect(prompt("coop")).toBe("Hợp tác xã · chú Tám");
    expect(prompt("farm_shop")).toBe("Tiệm vật tư · anh Hai");
    expect(prompt("rice_depot")).toBe("Vựa lúa · cô Út");
    expect(prompt("drying")).toBe("Sân phơi lúa");
    expect(prompt("plot_3")).toBe("Xem thửa 3");
  });
  it("keeps every use spot walkable and reachable from both entrances", () => {
    for (const from of [FIELD_WEST_ARRIVE, FIELD_EAST_ARRIVE]) {
      for (const s of [FIELD_WEST_ARRIVE, FIELD_EAST_ARRIVE, ...field.interactables.map((i) => i.use)]) {
        expect(isBlockedAt(field, s.x, s.y), JSON.stringify(s)).toBe(false);
        expect(findPath(field, from, s), `${JSON.stringify(from)} → ${JSON.stringify(s)}`).not.toBeNull();
      }
    }
  });
  it("leads to the hall and the pond, each exit at its entrance", () => {
    expect(ofKind("portal")).toEqual([
      expect.objectContaining({ id: "field_to_hall", use: { x: FIELD_WEST_ARRIVE.x, y: FIELD_WEST_ARRIVE.y }, to: { map: "hall", arrive: HALL_FIELD_ARRIVE } }),
      expect.objectContaining({ id: "field_to_pond", use: { x: FIELD_EAST_ARRIVE.x, y: FIELD_EAST_ARRIVE.y }, to: { map: "pond", arrive: POND_FIELD_ARRIVE } }),
    ]);
  });
  it("lays out ten plots: 1–4 private north of the canal, 5–10 village south of it, walkable and apart", () => {
    expect(field.plots).toBe(FIELD_PLOTS);
    expect(FIELD_PLOTS.map((p) => [p.no, p.kind])).toEqual([
      [1, "private"], [2, "private"], [3, "private"], [4, "private"],
      [5, "village"], [6, "village"], [7, "village"], [8, "village"], [9, "village"], [10, "village"],
    ]);
    for (const p of FIELD_PLOTS) {
      if (p.kind === "private") expect(p.rect.y + p.rect.h, `plot ${p.no}`).toBeLessThanOrEqual(CANAL.y);
      else expect(p.rect.y, `plot ${p.no}`).toBeGreaterThanOrEqual(CANAL.y + CANAL.h);
      for (const s of [...FIELD_SOLIDS, CANAL, DRYING_YARD]) expect(overlaps(p.rect, s), `plot ${p.no}`).toBe(false);
      for (const q of FIELD_PLOTS) if (q !== p) expect(overlaps(p.rect, q.rect), `${p.no}/${q.no}`).toBe(false);
      expect(isBlockedAt(field, p.rect.x + p.rect.w / 2, p.rect.y + p.rect.h / 2), `plot ${p.no}`).toBe(false);
    }
  });
  it("puts each plot's use spot on its dike, facing it, and its click rect on the plot", () => {
    for (const it of ofKind("plot")) {
      const p = FIELD_PLOTS.find((q) => q.no === it.plot)!;
      expect(it.rect).toEqual(p.rect);
      expect(inside(it.use, p.rect), it.id).toBe(false);
      expect(gap(it.use, p.rect), it.id).toBeLessThanOrEqual(18);
      expect(it.face, it.id).toBe(it.use.y > p.rect.y ? "up" : "down");
      for (const o of ofKind("plot")) if (o !== it) expect(Math.hypot(o.use.x - it.use.x, o.use.y - it.use.y)).toBeGreaterThan(52);
    }
  });
  it("blocks the canal but not its bridges, the buildings, and not the drying yard", () => {
    expect(isBlockedAt(field, 300, 192)).toBe(true);
    for (const b of BRIDGES) expect(isBlockedAt(field, b.x + b.w / 2, CANAL.y + CANAL.h / 2)).toBe(false);
    expect(isBlockedAt(field, 736, 80)).toBe(true);
    expect(isBlockedAt(field, 630, 290)).toBe(true);
    expect(isBlockedAt(field, 744, 290)).toBe(true);
    for (const s of DRYING_SQUARES) expect(isBlockedAt(field, s.x + s.w / 2, s.y + s.h / 2)).toBe(false);
  });
  it("puts chú Tám, anh Hai and cô Út behind their counters, facing down", () => {
    expect(field.npcs.map((n) => n.name)).toEqual(["chú Tám", "anh Hai", "cô Út"]);
    for (const n of field.npcs) {
      expect(n.spot.dir).toBe("down");
      expect(isBlockedAt(field, n.spot.x, n.spot.y), n.name).toBe(true);
    }
  });
  it("gives every prop a sprite frame and every plot a name post", () => {
    for (const p of field.props) expect(propFrame(p).w, p.kind).toBeGreaterThan(0);
    expect(field.props.filter((p) => p.kind === "namepost")).toHaveLength(10);
  });
  it("scrolls at 800 × 480 on a desktop and a phone view", () => {
    for (const [w, h] of [[1920, 1080], [1280, 720], [780, 1688], [1170, 2532]]) {
      const v = computeView(w, h, 800, 480);
      expect(v.vw, `${w}×${h}`).toBeLessThanOrEqual(800);
      expect(v.vh, `${w}×${h}`).toBeLessThanOrEqual(480);
      for (const feet of [FIELD_WEST_ARRIVE, FIELD_EAST_ARRIVE, { x: 400, y: 470 }]) {
        const cam = cameraFor(feet, v.vw, v.vh, 800, 480);
        expect(cam.x).toBeGreaterThanOrEqual(0);
        expect(cam.x + v.vw).toBeLessThanOrEqual(800);
        expect(cam.y).toBeGreaterThanOrEqual(0);
        expect(cam.y + v.vh).toBeLessThanOrEqual(480);
      }
    }
  });
});
