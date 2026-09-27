import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { boltOn, boltPath, drawCold, drawSoaked, drawStrike, drawUmbrella, sneezePhase, strikeFlashK } from "@/lib/game/art/rain";
import { inShade } from "@/lib/game/heat/shade";
import { MARKET_INTERACTABLES, MARKET_NPCS, STALLS } from "@/lib/game/maps/market";
import { getMap } from "@/lib/game/maps/registry";
import { parseGameMessage } from "@/lib/game/net/protocol";
import {
  COLD_FAINT_WET_S, COLD_MS, COLD_NO_BITE, decodeRain, DRY_S, encodeRain, HOT_DISHES, isRainBits, isRainy, MAX_UMBRELLAS,
  parseRain, RAINY_KINDS, rainChips, rainErrorMessage, RN, STORM_WEAR, STRIKE_COOLDOWN_MS, strikeChance, UMBRELLAS, WET_HUNGER_MULT,
  WET_HUNGRY_S,
} from "@/lib/game/rain/model";
import { parseVitals } from "@/lib/game/vitals-rpc";
import { RemoteWorld } from "@/lib/game/world";

const SQL = readFileSync("supabase/migrations/0038_rain.sql", "utf8");

describe("the rain rules (mirror of 0038)", () => {
  it("pins the umbrellas and the constants", () => {
    for (const u of UMBRELLAS) {
      expect(SQL).toContain(`when '${u.kind}' then ${u.price}`);
      expect(SQL).toContain(`when '${u.kind}' then ${u.minutes * 60}`);
    }
    expect(SQL).toContain(`>= ${MAX_UMBRELLAS} then`);
    expect(SQL).toContain(`case when w.kind = 'storm' then ${STORM_WEAR} else 1 end`);
    expect(SQL).toContain(`p_kind in (${RAINY_KINDS.map((k) => `'${k}'`).join(", ")})`);
    expect(SQL).toContain(`v_fast := rs.wet_s >= ${WET_HUNGRY_S};`);
    expect(SQL).toContain(`case when v_fast then ${WET_HUNGER_MULT} else 1 end`);
    expect(SQL).toContain(`if rs.dry_s >= ${DRY_S} then`);
    expect(SQL).toContain(`rs.cold_until := now() + interval '${COLD_MS / 60000} minutes'`);
    expect(SQL).toContain(`rs.cold_wet_s >= ${COLD_FAINT_WET_S}`);
    expect(SQL).toContain(`random() < ${COLD_NO_BITE} then`);
    expect(SQL).toContain(`p_item in (${HOT_DISHES.map((k) => `'${k}'`).join(", ")})`);
    expect(SQL).toContain(`rs.strike_cd_until := now() + interval '${STRIKE_COOLDOWN_MS / 60000} minutes'`);
    expect(SQL).toContain("1 - power(0.99::double precision");
  });

  it("re-creates vitals_tick from 0036 (the cat and the heat stay)", () => {
    const body = SQL.slice(SQL.indexOf("create or replace function public.vitals_tick"));
    expect(body).toContain("public._pet_cat_factor(v_account)");
    expect(body).toContain("* case when h.shocked then 2 else 1 end");
    expect(body).toContain("public._heat_resolve(v_account)");
    expect(body).toContain("'rain', public._rain_json(v_account, v_exposed)");
  });

  it("the ledger keeps 0036's reasons and adds umbrella", () => {
    const prev = readFileSync("supabase/migrations/0036_pets.sql", "utf8");
    const reasons = (s: string) => {
      const from = s.lastIndexOf("check (reason in (");
      return [...s.slice(from, s.indexOf("))", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(reasons(SQL)).toEqual([...reasons(prev), "umbrella"]);
  });

  it("the strike chance is 1 % a minute", () => {
    expect(strikeChance(60)).toBeCloseTo(0.01, 9);
    expect(strikeChance(0)).toBe(0);
    expect(strikeChance(120)).toBeCloseTo(1 - 0.99 * 0.99, 9);
    expect(isRainy("thunder")).toBe(true);
    expect(isRainy("fog")).toBe(false);
    expect(isRainy(null)).toBe(false);
  });
});

describe("the state", () => {
  const raw = {
    wet: true, wet_s: 320, drying: false, cold_until_ms: 1_000_000 + 125_000, struck_at_ms: null, broke_at_ms: 999_000, exposed: true,
    umbrellas: [{ id: 3, kind: "o_vai", left_s: 5000, held: true }, { id: 4, kind: "o_bad", left_s: 1, held: false }],
    server_now_ms: 1_000_000,
  };

  it("parses (dropping unknown umbrellas) and makes the chips", () => {
    const s = parseRain(raw)!;
    expect(s).toMatchObject({ wet: true, wetS: 320, coldUntilMs: 1_125_000, brokeAtMs: 999_000, exposed: true, serverNowMs: 1_000_000 });
    expect(s.umbrellas).toEqual([{ id: 3, kind: "o_vai", leftS: 5000, held: true }]);
    expect(rainChips(s, 1_000_000, true).map((c) => c.text)).toEqual(["💦 Ướt sũng", "🤧 Cảm lạnh 2:05", "☂️ 84 phút mưa"]);
    expect(rainChips(s, 1_200_000, false).map((c) => c.key)).toEqual(["wet"]);
    expect(rainChips({ ...s, drying: true }, 1_200_000, false)[0].text).toBe("💧 Đang khô");
    expect(parseRain({ wet: "x" })).toBeNull();
    expect(rainErrorMessage({ message: "too many umbrellas" })).toContain(`${MAX_UMBRELLAS}`);
  });

  it("the heartbeat answer carries the rain", () => {
    const v = parseVitals({ hunger: 50, thirst: 40, fainted_until_ms: null, server_now_ms: 5, rain: { ...raw, server_now_ms: 5 } });
    expect(v?.rain?.wet).toBe(true);
    expect(parseVitals({ hunger: 50, thirst: 40, server_now_ms: 5 })).not.toHaveProperty("rain");
  });
});

describe("rn on the wire", () => {
  const bounds = { width: 800, height: 400 };

  it("encodes and decodes the look", () => {
    const l = { wet: true, cold: true, umbrella: "o_gap" as const, struck: true };
    const bits = encodeRain(l);
    expect(bits).toBe(RN.wet | RN.cold | (3 << RN.umbrellaShift) | RN.struck);
    expect(decodeRain(bits)).toEqual(l);
    expect(decodeRain(encodeRain({ wet: false, cold: false, umbrella: "o_giay", struck: false }))).toMatchObject({ umbrella: "o_giay", wet: false });
    expect(encodeRain({ wet: false, cold: false, umbrella: null, struck: false })).toBe(0);
    expect(isRainBits(31)).toBe(true);
    expect(isRainBits(32)).toBe(false);
    expect(isRainBits(0)).toBe(false);
  });

  it("st/mv/pa carry rn; anything else is dropped", () => {
    expect(parseGameMessage("st", { id: "a", x: 1, y: 1, d: "d", mv: false, vx: 0, vy: 0, rn: 5 }, bounds)).toMatchObject({ rn: 5 });
    expect(parseGameMessage("mv", { id: "a", x: 1, y: 1, d: "d", mv: false, vx: 0, vy: 0, rn: 99 }, bounds)).not.toHaveProperty("rn");
    expect(parseGameMessage("pa", { id: "a", x: 1, y: 1, pts: [[2, 2]], rn: 16 }, bounds)).toMatchObject({ rn: 16 });
  });

  it("the world remembers each member's rain and when their strike began", () => {
    const w = new RemoteWorld(getMap("market"), "me");
    w.applyMessage({ t: "st", id: "a", x: 300, y: 250, d: "d", mv: false, vx: 0, vy: 0, rn: RN.wet | (2 << RN.umbrellaShift) }, 1000);
    expect(w.rain("a", 1000)).toEqual({ wet: true, cold: false, umbrella: "o_vai", struck: false, struckAge: null });
    w.applyMessage({ t: "st", id: "a", x: 300, y: 250, d: "d", mv: false, vx: 0, vy: 0, rn: RN.struck }, 2000);
    w.applyMessage({ t: "st", id: "a", x: 300, y: 250, d: "d", mv: false, vx: 0, vy: 0, rn: RN.struck | RN.wet }, 2500);
    expect(w.rain("a", 2600).struckAge).toBe(600);
    w.applyMessage({ t: "st", id: "a", x: 300, y: 250, d: "d", mv: false, vx: 0, vy: 0 }, 3000);
    expect(w.rain("a", 3000)).toEqual({ wet: false, cold: false, umbrella: null, struck: false, struckAge: null });
  });
});

describe("cô Chín's umbrella stall", () => {
  it("replaces the flower stall, with its vendor and a counter out in the street", () => {
    expect(STALLS.map((s) => s.goods)).toContain("umbrella");
    expect(STALLS.map((s) => s.goods)).not.toContain("flower");
    const it = MARKET_INTERACTABLES.find((i) => i.kind === "umbrella_stall")!;
    expect(it).toBeDefined();
    expect(inShade("market", it.use)).toBe(false);
    const m = getMap("market");
    expect(m.blocked[Math.floor(it.use.y / m.cell) * m.cols + Math.floor(it.use.x / m.cell)]).toBe(0);
    expect(MARKET_NPCS.some((n) => n.id === "co_chin")).toBe(true);
  });
});

/** A 2D context that only counts what is drawn. */
function countingCtx() {
  const calls: Array<[number, number, number, number]> = [];
  const c = {
    fillStyle: "", globalAlpha: 1,
    fillRect: (x: number, y: number, w: number, h: number) => { calls.push([x, y, w, h]); },
  };
  return { c: c as unknown as CanvasRenderingContext2D, calls };
}

describe("the rain's art", () => {
  it("draws every umbrella in every facing, both layers, and on a scooter a pixel higher", () => {
    for (const u of UMBRELLAS) {
      for (const f of ["down", "up", "left", "right"] as const) {
        const front = countingCtx(), back = countingCtx();
        drawUmbrella(front.c, { x: 50, y: 80 }, f, u.kind, 0, true, "front");
        drawUmbrella(back.c, { x: 50, y: 80 }, f, u.kind, 0, true, "back");
        expect(front.calls.length).toBeGreaterThan(20);
        expect(back.calls.length).toBeGreaterThan(10);
        // the canopy is above the head (feet − 46)
        expect(Math.min(...front.calls.map((k) => k[1]))).toBeLessThan(80 - 46);
      }
    }
    const a = countingCtx(), b = countingCtx();
    drawUmbrella(a.c, { x: 50, y: 80 }, "down", "o_vai", 0, true, "front");
    drawUmbrella(b.c, { x: 50, y: 80 }, "down", "o_vai", 0, true, "front", 1);
    expect(Math.min(...b.calls.map((k) => k[1]))).toBe(Math.min(...a.calls.map((k) => k[1])) - 1);
  });

  it("soaked, cold, the strike and the flash levels", () => {
    const s = countingCtx();
    drawSoaked(s.c, { x: 50, y: 80 }, 100, false);
    expect(s.calls.length).toBeGreaterThan(10);
    const k = countingCtx();
    drawCold(k.c, { x: 50, y: 80 }, 34, "down", 500, false);
    expect(k.calls.length).toBeGreaterThan(6);
    expect(sneezePhase(500, false)).toBe(2);
    expect(sneezePhase(500, true)).toBe(0);
    const bolt = countingCtx(), after = countingCtx();
    drawStrike(bolt.c, { x: 50, y: 200 }, 50, 7, false);
    drawStrike(after.c, { x: 50, y: 200 }, 900, 7, false);
    expect(bolt.calls.length).toBeGreaterThan(after.calls.length + 100);
    expect(boltOn(50) && !boltOn(150) && boltOn(200)).toBe(true);
    const p = boltPath({ x: 50, y: 200 }, 7);
    expect(p[p.length - 1]).toEqual({ x: 50, y: 156 });
    expect([0, 1, 2, 3, 4].map((l) => strikeFlashK(l as 0 | 1 | 2 | 3 | 4))).toEqual([0, 0, 0, 0.4, 1]);
  });
});
