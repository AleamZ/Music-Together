import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cellOf, isPondWater, pondSpotKind } from "@/lib/game/fishing/shore";
import {
  CRAMP_MS, crampChance, HEAT_OUTDOOR_S, HEAT_TEMP_C, HEAT_THIRST_MULT, heatChips, heatErrorMessage, heatHot, HX, IMMUNE_MS,
  mmss, parseHeat, WARM_MS, WARM_VALID_MS,
} from "@/lib/game/heat/model";
import { edgeCell, jumpTarget, nearestEdge } from "@/lib/game/heat/pond";
import { inShade, SHADE_RECTS } from "@/lib/game/heat/shade";
import { getMap } from "@/lib/game/maps/registry";
import { MAP_IDS } from "@/lib/game/maps/types";
import { parseGameMessage } from "@/lib/game/net/protocol";
import { parseVitals } from "@/lib/game/vitals-rpc";
import { RemoteWorld } from "@/lib/game/world";

const SQL = readFileSync("supabase/migrations/0033_heat_swim.sql", "utf8");
// v19.2: 0041 re-creates _in_shade with the Khu nhà map known (no porches there); v20.2: 0050 adds the dojo gate;
// v20.3: 0051 adds Bãi đất trống and its four ring roofs
const SHADE_SQL = readFileSync("supabase/migrations/0051_bai_dat.sql", "utf8");
const SHADE_KINDS = new Set([
  "shop", "depot", "farm_shop", "rice_depot", "restaurant", "clothes_shop", "vehicle_shop", "salon", "market_fish_depot", "market_farm_depot",
  "dojo",                                        // v20.2
  "ring_corner",                                 // v20.3: two corners under each ring's roof
]);

describe("the shade (mirror of _in_shade)", () => {
  it("the SQL lists exactly the TS rects", () => {
    const rows = [...SHADE_SQL.matchAll(/\('(hall|pond|field|market|khu_nha|bai_dat)', (\d+), (\d+), (\d+), (\d+)\)/g)].map((m) => m.slice(1).join(","));
    const ts = MAP_IDS.flatMap((m) => SHADE_RECTS[m].map((r) => [m, r.x, r.y, r.w, r.h].join(",")));
    expect(rows.sort()).toEqual(ts.sort());
    expect(SHADE_SQL).toContain("p_map not in ('hall', 'pond', 'field', 'market', 'khu_nha', 'bai_dat')");
  });

  it("every shop, depot and the restaurant has a porch over its use point, and nothing else is shaded", () => {
    let n = 0;
    for (const id of MAP_IDS) {
      for (const it of getMap(id).interactables) {
        if (!SHADE_KINDS.has(it.kind)) continue;
        n++;
        expect(inShade(id, it.use), `${id}/${it.id}`).toBe(true);
      }
    }
    // one porch per shop; a ring's roof covers both its corners
    expect(n).toBe(MAP_IDS.reduce((s, m) => s + SHADE_RECTS[m].length, 0) + SHADE_RECTS.bai_dat.length);
    expect(inShade("pond", { x: 100, y: 300 })).toBe(false);
    expect(inShade("hall", { x: 320, y: 200 })).toBe(false);
  });
});

describe("the heat rules (mirror of 0033)", () => {
  it("pins the constants", () => {
    expect(SQL).toContain(`p_temp_c >= ${HEAT_TEMP_C}`);
    expect(SQL).toContain(`interval '${HEAT_OUTDOOR_S / 60} minutes'`);
    expect(SQL).toContain(`case when h.shocked then ${HEAT_THIRST_MULT} else 1 end`);
    expect(SQL).toContain(`immune_until = now() + interval '${IMMUNE_MS / 60000} minutes'`);
    expect(SQL).toContain(`warm_until = now() + interval '${WARM_VALID_MS / 60000} minutes'`);
    expect(SQL).toContain(`now() + interval '${CRAMP_MS / 1000} seconds' end`);
    expect(SQL).toContain(`interval '${(WARM_MS - 500) / 1000} seconds'`);
    expect(SQL).toContain("when coalesce(p_warmed, false) then 0.005 else 0.10 end");
  });

  it("hot, the cramp chance", () => {
    expect(heatHot("clear", true, 35)).toBe(true);
    expect(heatHot("clear", true, 34.9)).toBe(false);
    expect(heatHot("clear", false, 40)).toBe(false);
    expect(heatHot("cloudy", true, 40)).toBe(false);
    expect(heatHot("clear", true, null)).toBe(false);
    expect(crampChance(true, false)).toBe(0.2);
    expect(crampChance(true, true)).toBe(0.005);
    expect(crampChance(false, false)).toBe(0.2); // 0044: the heat no longer matters
  });

  it("parses the state and makes the chips", () => {
    const h = parseHeat({ shocked: true, outdoor_s: 700, immune_until_ms: 1_000_000 + 125_000, warm_until_ms: 1_000_000 + 60_000, swimming: false, cramp_until_ms: null, server_now_ms: 1_000_000 });
    expect(h).toEqual({ shocked: true, outdoorS: 700, immuneUntilMs: 1_125_000, warmUntilMs: 1_060_000, swimming: false, crampUntilMs: null, serverNowMs: 1_000_000 });
    expect(heatChips(h, 1_000_000).map((c) => c.text)).toEqual(["🥵 Sốc nhiệt", "🏊 Miễn nhiệt 2:05", "🧘 Đã khởi động"]);
    expect(heatChips(h, 1_200_000).map((c) => c.key)).toEqual(["shock"]);
    expect(parseHeat({ shocked: "x" })).toBeNull();
    expect(mmss(599_001)).toBe("10:00");
    expect(heatErrorMessage({ message: "not cramping" })).toBe("Bạn ấy đã ổn rồi.");
    expect(heatErrorMessage({ message: "not swimming" })).toBeNull();
  });

  it("the heartbeat answer carries the heat", () => {
    const v = parseVitals({ hunger: 50, thirst: 40, fainted_until_ms: null, server_now_ms: 5, heat: { shocked: false, swimming: true, server_now_ms: 5 } });
    expect(v?.heat?.swimming).toBe(true);
    expect(parseVitals({ hunger: 50, thirst: 40, server_now_ms: 5 })).not.toHaveProperty("heat");
  });
});

describe("the pond's edge", () => {
  const shore = (() => {
    for (let r = 0; r < 50; r++) for (let c = 0; c < 80; c++) if (pondSpotKind(c, r) === "shore") return { x: c * 8 + 4, y: r * 8 + 4 };
    throw new Error("no shore");
  })();

  it("a jump from a shore cell lands in the water next to it; nowhere else", () => {
    expect(edgeCell(shore)).not.toBeNull();
    const at = jumpTarget(shore, "down")!;
    const { col, row } = cellOf(at);
    expect(isPondWater(col, row)).toBe(true);
    expect(Math.abs(col - cellOf(shore).col) + Math.abs(row - cellOf(shore).row)).toBe(1);
    expect(jumpTarget({ x: 20, y: 300 }, "up")).toBeNull();
    expect(edgeCell({ x: 20, y: 300 })).toBeNull();
  });

  it("a rescued swimmer is set down on an edge cell", () => {
    const p = nearestEdge({ x: 300, y: 100 })!;
    const { col, row } = cellOf(p);
    expect(pondSpotKind(col, row)).not.toBeNull();
  });
});

describe("hx / cr on the wire", () => {
  const bounds = { width: 640, height: 400 };
  it("keeps valid heat bits and a cramp's ms, drops the rest", () => {
    const m = parseGameMessage("st", { id: "a", x: 1, y: 1, d: "d", mv: false, vx: 0, vy: 0, sw: 1, hx: HX.cramp, cr: 7000 }, bounds);
    expect(m).toMatchObject({ hx: 4, cr: 7000, sw: 1 });
    const bad = parseGameMessage("mv", { id: "a", x: 1, y: 1, d: "d", mv: false, vx: 0, vy: 0, hx: 9, cr: 99999 }, bounds);
    expect(bad).not.toHaveProperty("hx");
    expect(bad).not.toHaveProperty("cr");
    const pa = parseGameMessage("pa", { id: "a", x: 1, y: 1, pts: [[2, 2]], hx: 3 }, bounds);
    expect(pa).toMatchObject({ hx: 3 });
    expect(pa).not.toHaveProperty("cr");
  });

  it("the world reads a member's heat and the cramp countdown on its own clock", () => {
    const w = new RemoteWorld(getMap("pond"), "me");
    w.applyMessage({ t: "st", id: "a", x: 300, y: 100, d: "d", mv: false, vx: 0, vy: 0, sw: 1, hx: HX.cramp | HX.shocked, cr: 8000 }, 1000);
    expect(w.heat("a", 3000)).toEqual({ shocked: true, warming: false, crampLeft: 6000 });
    expect(w.heat("a", 9500).crampLeft).toBeNull();
    w.applyMessage({ t: "st", id: "a", x: 300, y: 100, d: "d", mv: false, vx: 0, vy: 0, hx: HX.warming }, 4000);
    expect(w.heat("a", 4000)).toEqual({ shocked: false, warming: true, crampLeft: null });
    w.applyMessage({ t: "st", id: "a", x: 300, y: 100, d: "d", mv: false, vx: 0, vy: 0 }, 5000);
    expect(w.heat("a", 5000)).toEqual({ shocked: false, warming: false, crampLeft: null });
  });
});
