import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cellOf, isPondWater, nearestWater, pondSpotKind, pondWaterCells, shoreInteractable } from "@/lib/game/fishing/shore";
import { lostText, overboardText } from "@/lib/game/fishing/messages";
import { buildPondMap, POND_CELL, POND_CX, POND_CY, POND_FISH_SPOTS, POND_PLATFORM, POND_RX, POND_RY, POND_SOLIDS } from "@/lib/game/maps/pond";
import { buildHallMap } from "@/lib/game/maps/hall";
import { isBlockedAt } from "@/lib/game/movement";
import { parseGameMessage } from "@/lib/game/net/protocol";
import { buildSwimMap, inWater, SWIM_SPEED, swimSpeed, WET_MS } from "@/lib/game/swim";
import { RemoteWorld } from "@/lib/game/world";

const SQL = readFileSync("supabase/migrations/0031_pond_life.sql", "utf8");
const pond = buildPondMap();
const blocked = (c: number, r: number) => pond.blocked[r * pond.cols + c] === 1;

describe("the pond's cast spots (mirror of _pond_spot)", () => {
  it("water cells are blocked on the map, cast cells walkable, and every walkable cell by the water is a cast cell", () => {
    let shore = 0;
    for (let r = 0; r < pond.rows; r++) for (let c = 0; c < pond.cols; c++) {
      const kind = pondSpotKind(c, r);
      if (isPondWater(c, r)) expect(blocked(c, r)).toBe(true);
      if (kind) expect(blocked(c, r)).toBe(false);
      if (kind === "shore") shore++;
      const byWater = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => isPondWater(c + dc, r + dr));
      if (!blocked(c, r) && byWater) expect(kind).not.toBeNull();
    }
    expect(shore).toBeGreaterThan(40);
  });

  it("the six map fishing spots stand on dock cells", () => {
    for (const s of POND_FISH_SPOTS) {
      const { col, row } = cellOf(s);
      expect(pondSpotKind(col, row)).toBe("dock");
    }
    expect(pondSpotKind(-1, 0)).toBeNull();
    expect(pondSpotKind(37, 10)).toBeNull(); // water
    expect(pondSpotKind(2, 30)).toBeNull();  // grass far from the water
  });

  it("the SQL copies the pond's numbers: centre, radii, wobble, platform and solids", () => {
    expect(SQL).toContain(`(p_x - ${POND_CX}) / (${POND_RX} + p_grow)`);
    expect(SQL).toContain(`(p_y - ${POND_CY}) / (${POND_RY} + p_grow)`);
    expect(SQL).toContain("1 + 0.04 * sin(3 * atan2(q.dy, q.dx) + 0.6) + 0.025 * sin(5 * atan2(q.dy, q.dx) + 2.1)");
    const [bar, stem] = POND_PLATFORM;
    expect(SQL).toContain(`(x >= ${bar.x} and x < ${bar.x + bar.w} and y >= ${bar.y} and y < ${bar.y + bar.h})`);
    expect(SQL).toContain(`(x >= ${stem.x} and x < ${stem.x + stem.w} and y >= ${stem.y} and y < ${stem.y + stem.h})`);
    const values = [...SQL.matchAll(/\((\d+), (\d+), (\d+), (\d+)\)/g)].map((m) => m.slice(1).map(Number).join(","));
    for (const s of POND_SOLIDS) expect(values).toContain([s.x, s.y, s.w, s.h].join(","));
    expect(SQL).toContain(`p_col >= ${pond.cols} or p_row >= ${pond.rows}`);
    expect(POND_CELL).toBe(8);
  });

  it("offers a bank cast facing the water, only on the pond", () => {
    // walk the ring of shore cells: each prompt faces a water neighbour
    let seen = 0;
    for (let r = 0; r < pond.rows; r++) for (let c = 0; c < pond.cols; c++) {
      if (pondSpotKind(c, r) !== "shore") continue;
      const feet = { x: c * 8 + 4, y: r * 8 + 4 };
      const it = shoreInteractable(pond, feet, "down");
      expect(it).not.toBeNull();
      const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[it!.face!];
      expect(isPondWater(c + d[0], r + d[1])).toBe(true);
      expect(it).toMatchObject({ kind: "fish_spot", label: "Bờ ao", use: feet });
      seen++;
    }
    expect(seen).toBeGreaterThan(40);
    expect(shoreInteractable(buildHallMap(), { x: 516, y: 380 }, "down")).toBeNull();
    expect(shoreInteractable(pond, { x: 20, y: 244 }, "down")).toBeNull();
  });

  it("surfaces an angler on the nearest water cell", () => {
    const w = nearestWater({ x: 252, y: 150 })!;
    expect(isPondWater(Math.floor(w.x / 8), Math.floor(w.y / 8))).toBe(true);
    expect(Math.hypot(w.x - 252, w.y - 150)).toBeLessThan(6);
    expect(pondWaterCells().length).toBeGreaterThan(500);
  });
});

describe("swim mode", () => {
  it("swims on the water, stays blocked by solids, and only on the pond", () => {
    const swim = buildSwimMap(pond)!;
    expect(isBlockedAt(pond, 300, 120)).toBe(true);
    expect(isBlockedAt(swim, 300, 120)).toBe(false);
    expect(isBlockedAt(swim, 570, 80)).toBe(true); // Vựa cá stall
    expect(buildSwimMap(buildHallMap())).toBeNull();
    expect(inWater({ x: 300, y: 120 })).toBe(true);
    expect(inWater({ x: 300, y: 212 })).toBe(false); // the platform ends it
    expect(inWater({ x: 20, y: 244 })).toBe(false);
    expect(swimSpeed(true)).toBe(SWIM_SPEED);
    expect(swimSpeed(false)).toBe(1);
    expect(WET_MS).toBe(4000);
  });

  it("carries the swim flag on movement messages, dropping anything but 1 and 2", () => {
    const b = { width: 640, height: 400 };
    const st = { id: "a", x: 300, y: 120, d: "u", mv: true, vx: 0, vy: -1 };
    expect(parseGameMessage("mv", { ...st, sw: 1 }, b)).toMatchObject({ sw: 1 });
    expect(parseGameMessage("st", { ...st, sw: 2 }, b)).toMatchObject({ sw: 2 });
    expect(parseGameMessage("mv", { ...st, sw: 3 }, b)).not.toHaveProperty("sw");
    expect(parseGameMessage("pa", { id: "a", x: 300, y: 120, pts: [[300, 110]], sw: 1 }, b)).toMatchObject({ sw: 1 });
  });

  it("simulates another swimmer on the water at half speed, then drips for 4 s", () => {
    const w = new RemoteWorld(pond, "me");
    w.setRoster([{ id: "a", name: "A", badges: "", look: {} as never, spot: null }], 0);
    w.applyMessage({ t: "mv", id: "a", x: 300, y: 120, d: "u", mv: true, vx: 0, vy: -1, sw: 1 }, 0);
    expect(w.swim("a", 0)).toBe("swim");
    w.tick(1, 500);
    const a = w.actors.get("a")!;
    expect(a.pos.y).toBeCloseTo(120 - 35, 0); // 70 px/s × 0.5
    w.applyMessage({ t: "st", id: "a", x: 300, y: 212, d: "d", mv: false, vx: 0, vy: 0, sw: 2 }, 1000);
    expect(w.swim("a", 1000)).toBe("wet");
    w.applyMessage({ t: "st", id: "a", x: 300, y: 212, d: "d", mv: false, vx: 0, vy: 0, sw: 2 }, 3000); // no reset
    expect(w.swim("a", 4999)).toBe("wet");
    expect(w.swim("a", 5000)).toBeNull();
    w.applyMessage({ t: "st", id: "a", x: 300, y: 212, d: "d", mv: false, vx: 0, vy: 0 }, 5100);
    expect(w.swim("a", 5100)).toBeNull();
  });
});

describe("texts and the overboard table", () => {
  it("says why a cast ended", () => {
    expect(lostText("nobite", null, 1)).toBe("Chẳng có cá nào cắn câu… ra cầu ao câu dễ hơn đó.");
    expect(overboardText(10, null)).toBe("🌊 Cá lớn kéo bạn xuống ao! Mất cá, đói thêm 10. Bơi vào bờ nhé!");
    expect(overboardText(10, "Cần tre")).toContain("Cần tre trôi mất rồi");
  });

  it("the SQL outcome: wear 3 (seam), hunger 10, rod lost under 0.1 and never rod_wood", () => {
    expect(SQL).toContain("jsonb_build_object('wear', 3, 'hunger', 10,");
    expect(SQL).toContain("coalesce(p_rod, 'rod_wood') <> 'rod_wood' and coalesce(p_roll, 1) < 0.1");
    expect(SQL).toMatch(/create or replace function public\._rod_wear\(p_account uuid, p_rod text, p_amount integer\)/);
    expect(SQL).toContain("v_bite := least(60000, round(v_bite * 1.5)::int);");
    expect(SQL).toContain("v_bites := random() < 0.4;");
  });
});
