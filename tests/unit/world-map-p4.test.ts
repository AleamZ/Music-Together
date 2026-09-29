import { describe, expect, it } from "vitest";
import { HOTKEYS, hotkeyFor, type HotkeyEvent } from "@/lib/game/hotkeys";
import { RT_ORIGIN } from "@/lib/game/maps/rung-tram";
import { MINE } from "@/lib/game/world/mine";
import { LAKE } from "@/lib/game/world/nuicam";
import { landUse } from "@/lib/game/world/scenery";
import { CANALS, RIVER_PTS } from "@/lib/game/world/terrain";
import {
  BASE_H, BASE_W, baseRows, clampView, fitView, headingFrom, hexRGB, KIND_COLOUR, kindColour, labelAt, landPixel, MAP_LABELS, MAP_STEP,
  mapKindAt, mapPosToWorld, rungTramToWorld, toCanvas, toWorldPx, worldToRungTram, zoomAbout, ZONE_TINT,
} from "@/lib/game/world/worldmap";
import { toLocal, toWorld, WORLD_H, WORLD_W, ZONE_IDS, ZONES } from "@/lib/game/world/zones";

describe("world map: land use to colour", () => {
  it("each kind has its own colour; paddies are green or gold by plot, one colour per plot", () => {
    expect(kindColour("tram", 0, 0)).toBe(KIND_COLOUR.tram);
    expect(kindColour("orchard", 0, 0)).toBe(KIND_COLOUR.orchard);
    for (const k of ["river", "canal", "stream", "lake", "pond"] as const) expect(kindColour(k, 5, 5)).toBe(KIND_COLOUR[k]);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(kindColour("paddy", i * 56 + 3, 700));
    expect([...seen].sort()).toEqual([KIND_COLOUR.paddy_gold, KIND_COLOUR.paddy_green].sort());
    expect(kindColour("paddy", 3, 3)).toBe(kindColour("paddy", 50, 50));
    for (const id of ZONE_IDS) expect(kindColour("zone", 0, 0, id)).toBe(ZONE_TINT[id]);
    const colours = [KIND_COLOUR.paddy_green, KIND_COLOUR.paddy_gold, KIND_COLOUR.orchard, KIND_COLOUR.tram, KIND_COLOUR.river, KIND_COLOUR.mountain];
    expect(new Set(colours).size).toBe(colours.length);
  });
  it("the forest is darker than the paddies; the water is brown-green (red and green over blue)", () => {
    const lum = (h: string) => hexRGB(h).reduce((a, b) => a + b, 0);
    expect(lum(KIND_COLOUR.tram)).toBeLessThan(lum(KIND_COLOUR.paddy_green));
    const [r, g, b] = hexRGB(KIND_COLOUR.river);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });
  it("classifies from the world data: the river, a canal, the lake, a zone, the land's use", () => {
    expect(mapKindAt(RIVER_PTS[2].x, RIVER_PTS[2].y).kind).toBe("river");
    expect(mapKindAt(CANALS[0][2].x, CANALS[0][2].y).kind).toBe("canal");
    expect(mapKindAt(LAKE.x, LAKE.y).kind).toBe("lake");
    expect(mapKindAt(ZONES.market.ox + 20, ZONES.market.oy + 20)).toEqual({ kind: "zone", zone: "market" });
    let n = 0;
    for (let y = 40; y < WORLD_H; y += 173) for (let x = 40; x < WORLD_W; x += 211) {
      const k = mapKindAt(x, y);
      if (k.kind === "paddy" || k.kind === "orchard" || k.kind === "tram") { expect(k.kind).toBe(landUse(x, y)); n++; }
    }
    expect(n).toBeGreaterThan(50);
  });
  it("the base land pixels: the use's colour, RGBA rows covering the world", () => {
    expect(landPixel(200, 200, "tram")).not.toEqual(landPixel(200, 200, "paddy"));
    expect(landPixel(12, 12, "orchard").every((v) => v >= 0 && v <= 255)).toBe(true);
    const band = baseRows(10, 12);
    expect(band.length).toBe(2 * BASE_W * 4);
    expect(band[3]).toBe(255);
    expect(BASE_W * MAP_STEP).toBeGreaterThanOrEqual(WORLD_W);
    expect(BASE_H * MAP_STEP).toBeGreaterThanOrEqual(WORLD_H);
  });
});

describe("world map: positions", () => {
  it("zone local and world px, and a 2D player's map onto the world", () => {
    for (const id of ZONE_IDS) {
      const p = { x: 17, y: 23 };
      expect(mapPosToWorld(id, p)).toEqual(toWorld(id, p));
      expect(toLocal(mapPosToWorld(id, p)!)).toEqual({ zone: id, p });
    }
  });
  it("Rừng tràm (2D) is a window of the world's forest; Mỏ đá at the mine mouth; the secret hầm not on the map", () => {
    expect(mapPosToWorld("rung_tram", { x: 10, y: 20 })).toEqual({ x: RT_ORIGIN.x + 10, y: RT_ORIGIN.y + 20 });
    expect(worldToRungTram(rungTramToWorld({ x: 100, y: 50 }))).toEqual({ x: 100, y: 50 });
    expect(worldToRungTram({ x: 0, y: 0 })).toBeNull();
    expect(mapPosToWorld("mo_da", { x: 5, y: 5 })).toEqual(MINE.mouth);
    expect(mapPosToWorld("ham_ngam", { x: 5, y: 5 })).toBeNull();
    const rt = MAP_LABELS.find((l) => l.id === "rung_tram")!;
    expect(worldToRungTram(rt)).not.toBeNull();
  });
  it("views: fit the world, zoom about a point keeps it put, clamp keeps the centre in the world", () => {
    const v = fitView(800, 400);
    const a = toCanvas(v, { x: 0, y: 0 }), b = toCanvas(v, { x: WORLD_W, y: WORLD_H });
    expect(b.x - a.x).toBeLessThanOrEqual(800.001);
    expect(b.y - a.y).toBeLessThanOrEqual(400.001);
    const c = { x: 300, y: 120 };
    const before = toWorldPx(v, c), after = toWorldPx(zoomAbout(v, c, 2, 0.01, 5), c);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(zoomAbout(v, c, 1e6, 0.01, 5).scale).toBe(5);
    const far = clampView({ x0: -99999, y0: 99999, scale: 1 }, 100, 100);
    expect(far.x0 + 50).toBe(0);
    expect(far.y0 + 50).toBe(WORLD_H);
  });
  it("labels: every zone and landmark named, inside the world; hover finds the nearest within reach", () => {
    for (const n of ["Sảnh", "Ao cá", "Đồng", "Chợ Lớn", "Khu nhà", "Bãi đất", "Mỏ đá", "Sông Cái", "Chợ nổi", "Núi Mây Xanh", "Tượng Di Lặc", "Cáp treo", "Rừng tràm"])
      expect(MAP_LABELS.map((l) => l.name)).toContain(n);
    for (const l of MAP_LABELS) expect(l.x >= 0 && l.y >= 0 && l.x < WORLD_W && l.y < WORLD_H, l.id).toBe(true);
    const v = { x0: 0, y0: 0, scale: 0.5 };
    const m = MAP_LABELS.find((l) => l.id === "market")!;
    expect(labelAt(MAP_LABELS, v, { x: m.x * 0.5 + 4, y: m.y * 0.5 - 3 })).toBe("Chợ Lớn");
    expect(labelAt(MAP_LABELS, v, { x: -500, y: -500 })).toBeNull();
  });
  it("heading follows the move and is kept while standing", () => {
    expect(headingFrom({ x: 0, y: 0 }, { x: 10, y: 0 }, 1)).toBeCloseTo(0);
    expect(headingFrom({ x: 0, y: 0 }, { x: 0, y: 10 }, 0)).toBeCloseTo(Math.PI / 2);
    expect(headingFrom({ x: 0, y: 0 }, { x: 0.1, y: 0 }, 2)).toBe(2);
    expect(headingFrom(null, { x: 5, y: 5 }, 3)).toBe(3);
  });
});

describe("hotkey M: the world map", () => {
  const ev = (code: string): HotkeyEvent => ({ code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: document.body });
  const ON = { enabled: true, helpOpen: false, offer: false };
  it("M opens the world map; nothing else is on M", () => {
    expect(hotkeyFor(ev("KeyM"), ON)).toBe("cityMap");
    expect(HOTKEYS.filter((h) => h.codes.includes("KeyM"))).toHaveLength(1);
    expect(hotkeyFor(ev("KeyM"), { ...ON, enabled: false })).toBeNull();
  });
  it("no two actions share a key (N's two are the lift offer's switch)", () => {
    const seen = new Map<string, number>();
    for (const h of HOTKEYS) for (const c of h.codes) seen.set(c, (seen.get(c) ?? 0) + 1);
    expect([...seen].filter(([, k]) => k > 1).map(([c]) => c)).toEqual(["KeyN"]);
  });
});
