// v21 "world" (0075): the client's tables (lib/game/realm/model.ts, lib/game/weather/model.ts) are the SQL's.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BOSS_DEFS, BOSS_SCHEDULE, DUNGEON_FEE, DUNGEON_ROOMS, WILD_AREAS, WILD_CAP, WILD_ITEMS, WILD_SPECIES, beat, inArena,
  isNightVN, sellPrice, wildXY, GATE, STALL,
} from "@/lib/game/realm/model";
import { effects, kindOf } from "@/lib/game/weather/model";

const SQL = readFileSync("supabase/migrations/0075_world_bosses.sql", "utf8");
/** 0097 re-made _wild_species / _wild_items (the forest's animals and meats): the newest body wins. */
const SQL97 = readFileSync("supabase/migrations/0097_forest_complete.sql", "utf8");
/** The body of a function (up to its closing $$). */
function body(name: string): string {
  for (const sql of [SQL97, SQL]) {
    const at = sql.indexOf(`function public.${name}(`);
    if (at < 0) continue;
    const start = sql.indexOf("$$", at);
    return sql.slice(start + 2, sql.indexOf("$$", start + 2));
  }
  throw new Error(`no ${name}`);
}
const all = (re: RegExp, s: string) => [...s.matchAll(re)];

describe("0075 tables = model", () => {
  it("wild species", () => {
    const rows = all(/\('(\w+)',\s*'(\w+)',\s*array\[([^\]]*)\],\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(null|'\w+'),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g, body("_wild_species"));
    expect(rows.map((m) => ({
      id: m[1], active: m[2], maps: m[3].split(",").map((x) => x.trim().replace(/'/g, "")), weight: +m[4], hunt: +m[5], trap: +m[6],
      danger: +m[7], drop: m[8] === "null" ? null : m[8].replace(/'/g, ""), dropMin: +m[9], dropMax: +m[10], radius: +m[11], xp: +m[12],
    }))).toEqual(WILD_SPECIES.map((sp) => Object.fromEntries(Object.entries(sp).filter(([k]) => k !== "name"))));
  });
  it("items and prices", () => {
    const rows = all(/\('(\w+)',\s*(\d+)\)/g, body("_wild_items"));
    expect(Object.fromEntries(rows.map((m) => [m[1], +m[2]]))).toEqual(Object.fromEntries(Object.entries(WILD_ITEMS).map(([k, v]) => [k, v.price])));
  });
  it("areas and caps", () => {
    const rows = all(/\('(\w+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g, body("_wild_areas"));
    expect(rows.map((m) => ({ map: m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5] }))).toEqual(WILD_AREAS);
    const caps = all(/when '(\w+)' then (\d+)/g, body("_wild_cap"));
    expect(Object.fromEntries(caps.map((m) => [m[1], +m[2]]))).toEqual(WILD_CAP);
  });
  it("bosses and the schedule", () => {
    // economy v2 (0104) re-made _boss_defs (the raid's pool): its body is the newest
    const sql104 = readFileSync("supabase/migrations/0104_econ_rewards.sql", "utf8");
    const at104 = sql104.indexOf("function public._boss_defs(");
    const defs = sql104.slice(sql104.indexOf("$$", at104) + 2, sql104.indexOf("$$", sql104.indexOf("$$", at104) + 2));
    const rows = all(/\('(\w+)',\s*'([^']+)',\s*'(\w+)',\s*'(\w+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g, defs);
    expect(rows.map((m) => ({
      id: m[1], name: m[2], kind: m[3], map: m[4], arena: { x: +m[5], y: +m[6], w: +m[7], h: +m[8] }, hp: +m[9], capPct: +m[10],
      pool: +m[11], durMin: +m[12], xp: +m[13],
    }))).toEqual(BOSS_DEFS);
    const sch = all(/\('(\w+)',\s*time '(\d\d:\d\d)'\)/g, body("_boss_schedule"));
    expect(sch.map((m) => ({ boss: m[1], at: m[2] }))).toEqual(BOSS_SCHEDULE);
  });
  it("dungeon rooms, fee, gate and stall", () => {
    const rows = all(/\((\d+),\s*'(\w+)',\s*'([^']+)',\s*(\d+),\s*(\d+)\)/g, body("_dg_rooms"));
    expect(rows.map((m) => ({ room: +m[1], mob: m[2], name: m[3], hp: +m[4], n: +m[5] }))).toEqual(DUNGEON_ROOMS);
    expect(readFileSync("supabase/migrations/0104_econ_rewards.sql", "utf8")).toContain(`< ${DUNGEON_FEE} then raise exception 'insufficient funds'`);   // economy v2
    expect(SQL).toContain(`'${GATE.map}', ${GATE.x}, ${GATE.y}, 'dungeon_start'`);
    expect(SQL).toContain(`'${STALL.map}', ${STALL.x}, ${STALL.y}, 'wild_sell'`);
  });
  it("the wander path", () => {
    expect(body("_wild_xy")).toContain("p_hx + p_radius * sin(p_t * 2 * pi() / (20 + (p_seed % 13)) + (p_seed % 628) / 100.0)");
    expect(body("_wild_xy")).toContain("p_hy + p_radius * 0.6 * sin(p_t * 2 * pi() / (27 + (p_seed % 11)) + (p_seed % 314) / 50.0)");
    const p = wildXY(300, 60, 12345, 40, 10);
    expect(p.x).toBeCloseTo(300 + 40 * Math.sin((10 * 2 * Math.PI) / (20 + (12345 % 13)) + (12345 % 628) / 100), 9);
  });
  it("snow: the codes and the effects row", () => {
    for (const c of [71, 73, 75, 77, 85, 86]) expect(kindOf(c, 80)).toBe("snow");
    expect(body("_weather_kind")).toMatch(/p_code between 71 and 77 or p_code in \(85, 86\) then 'snow'/);
    const m = body("_weather_effects").match(/when 'snow'\s+then jsonb_build_object\(([^)]*)\)/);
    const parts = m![1].split(",").map((s) => s.trim());
    const row: Record<string, number | boolean> = {};
    for (let i = 0; i < parts.length; i += 2) row[parts[i].replace(/'/g, "")] = parts[i + 1] === "true" ? true : parts[i + 1] === "false" ? false : Number(parts[i + 1]);
    expect(row).toEqual({ ...effects("snow", true) });
  });
});

describe("realm model", () => {
  it("VN night is 18:00–06:00", () => {
    const at = (h: number) => Date.UTC(2026, 8, 29, (h - 7 + 24) % 24, 30);
    expect(isNightVN(at(17))).toBe(false);
    expect(isNightVN(at(18))).toBe(true);
    expect(isNightVN(at(2))).toBe(true);
    expect(isNightVN(at(6))).toBe(false);
  });
  it("the beat", () => {
    expect(beat(500)).toBe("wait");
    expect(beat(1200)).toBe("beat");
    expect(beat(2500)).toBe("late");
  });
  it("night market prices", () => {
    expect(sellPrice("da_soi", 3, false)).toBe(360);
    expect(sellPrice("long_vu", 3, true)).toBe(46);
  });
  it("the arena margin", () => {
    const a = { map: "bai_dat" as const, x: 316, y: 60, w: 168, h: 316 };
    expect(inArena("bai_dat", { x: 300, y: 100 }, a)).toBe(true);
    expect(inArena("bai_dat", { x: 299, y: 100 }, a)).toBe(false);
    expect(inArena("pond", { x: 400, y: 100 }, a)).toBe(false);
  });
});
