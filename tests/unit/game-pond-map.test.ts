import { describe, it, expect } from "vitest";
import { bobberPoint } from "@/lib/game/fishing/geometry";
import { HALL_DOCK_ARRIVE, POND_ARRIVE } from "@/lib/game/maps/arrivals";
import { buildPondMap, DIG_MOUNDS, inDirtPatch, inPond, onPlatform, pondEdge } from "@/lib/game/maps/pond";
import { propFrame } from "@/lib/game/maps/props";
import type { InteractKind } from "@/lib/game/maps/types";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";

const pond = buildPondMap();
const ofKind = (k: InteractKind) => pond.interactables.filter((i) => i.kind === k);
const within = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) =>
  p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

describe("pond map", () => {
  it("has the documented size, grid and interactables", () => {
    expect(pond.id).toBe("pond");
    expect([pond.width, pond.height, pond.cell, pond.cols, pond.rows]).toEqual([640, 400, 8, 80, 50]);
    expect(pond.blocked).toHaveLength(80 * 50);
    expect(pond.seating).toBeNull();
    expect(pond.spawn).toEqual(POND_ARRIVE);
    expect(pond.interactables.map((i) => i.id).sort()).toEqual([
      "depot", "dig_1", "dig_2", "dig_3", "dig_4", "fish_1", "fish_2", "fish_3", "fish_4", "fish_5", "fish_6",
      "pond_exit", "records", "shop",
    ]);
  });
  it("uses the spec's prompts", () => {
    const prompt = (id: string) => pond.interactables.find((i) => i.id === id)?.prompt;
    expect(prompt("pond_exit")).toBe("Về sảnh nhạc");
    expect(prompt("fish_1")).toBe("Quăng cần");
    expect(prompt("dig_1")).toBe("Đào trùn");
    expect(prompt("depot")).toBe("Bán cá · cô Ba");
    expect(prompt("shop")).toBe("Tiệm đồ câu · chú Tư");
    expect(prompt("records")).toBe("Xem bảng kỷ lục");
  });
  it("keeps the arrival spot and every use spot walkable and reachable from the arrival", () => {
    for (const s of [POND_ARRIVE, ...pond.interactables.map((i) => i.use)]) {
      expect(isBlockedAt(pond, s.x, s.y), JSON.stringify(s)).toBe(false);
      expect(findPath(pond, POND_ARRIVE, s), JSON.stringify(s)).not.toBeNull();
    }
  });
  it("leads back to the hall's dock", () => {
    expect(ofKind("portal")).toEqual([expect.objectContaining({ id: "pond_exit", to: { map: "hall", arrive: HALL_DOCK_ARRIVE } })]);
  });
  it("puts six fishing spots on the platform, ≥ 40 px apart, each casting into open water it can be clicked on", () => {
    const spots = ofKind("fish_spot");
    expect(spots).toHaveLength(6);
    for (const s of spots) {
      expect(s.face, s.id).toBeDefined();
      expect(onPlatform(s.use.x, s.use.y), s.id).toBe(true);
      const b = bobberPoint(s.use, s.face!);
      expect(inPond(b.x, b.y), s.id).toBe(true);
      expect(onPlatform(b.x, b.y), s.id).toBe(false);
      expect(isBlockedAt(pond, b.x, b.y), s.id).toBe(true);
      expect(within(b, s.rect), s.id).toBe(true);
      for (const o of spots) {
        if (o !== s) expect(Math.hypot(o.use.x - s.use.x, o.use.y - s.use.y), `${s.id}/${o.id}`).toBeGreaterThanOrEqual(40);
      }
    }
  });
  it("keeps the four dig spots on the dirt patch, ≥ 32 px apart", () => {
    const digs = ofKind("dig_spot");
    expect(digs).toHaveLength(4);
    for (const m of DIG_MOUNDS) {
      expect(inDirtPatch(m.x, m.y)).toBe(true);
      for (const o of DIG_MOUNDS) if (o !== m) expect(Math.hypot(o.x - m.x, o.y - m.y)).toBeGreaterThanOrEqual(32);
    }
    for (const d of digs) expect(inDirtPatch(d.use.x, d.use.y - 12), d.id).toBe(true);
  });
  it("blocks the water but not the platform, and blocks the stall, the hut and the records board", () => {
    expect(isBlockedAt(pond, 300, 120)).toBe(true);
    expect(isBlockedAt(pond, 300, 212)).toBe(false);
    expect(isBlockedAt(pond, 300, 280)).toBe(false);
    expect(isBlockedAt(pond, 560, 80)).toBe(true);
    expect(isBlockedAt(pond, 570, 250)).toBe(true);
    expect(isBlockedAt(pond, 508, 162)).toBe(true);
  });
  it("puts cô Ba and chú Tư behind their counters, facing down", () => {
    expect(pond.npcs.map((n) => n.name)).toEqual(["cô Ba", "chú Tư"]);
    for (const n of pond.npcs) {
      expect(n.spot.dir).toBe("down");
      expect(isBlockedAt(pond, n.spot.x, n.spot.y), n.name).toBe(true);
    }
  });
  it("keeps the shore within 7 % of the oval and gives every prop a sprite frame", () => {
    for (let a = 0; a < Math.PI * 2; a += 0.05) {
      expect(pondEdge(a)).toBeGreaterThan(0.93);
      expect(pondEdge(a)).toBeLessThan(1.07);
    }
    for (const p of pond.props) expect(propFrame(p).w, p.kind).toBeGreaterThan(0);
  });
});
