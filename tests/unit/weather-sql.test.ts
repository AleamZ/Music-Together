import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effects, kindOf, type WeatherKind } from "@/lib/game/weather/model";

const SQL = readFileSync("supabase/migrations/0030_weather.sql", "utf8");
const KINDS: WeatherKind[] = ["clear", "cloudy", "fog", "rain", "thunder", "storm"];

// The jsonb_build_object(...) row of a kind in _weather_effects (cloudy is the else branch).
function sqlRow(kind: WeatherKind): Record<string, number | boolean> {
  const re =
    kind === "cloudy"
      ? /else\s+jsonb_build_object\(([^)]*)\)\s+--\s*cloudy/
      : new RegExp(`when '${kind}'\\s+then jsonb_build_object\\(([^)]*)\\)`);
  const m = SQL.match(re);
  if (!m) throw new Error(`no SQL row for ${kind}`);
  const parts = m[1].split(",").map((s) => s.trim());
  const row: Record<string, number | boolean> = {};
  for (let i = 0; i < parts.length; i += 2) {
    const key = parts[i].replace(/'/g, "");
    const raw = parts[i + 1];
    row[key] = raw === "true" ? true : raw === "false" ? false : Number(raw);
  }
  return row;
}

describe("_weather_effects matches effects()", () => {
  it.each(KINDS)("%s (day)", (kind) => {
    expect(sqlRow(kind)).toEqual({ ...effects(kind, true) });
  });
  it("night stops growth in both", () => {
    expect(SQL).toMatch(/else jsonb_build_object\('growth', 0\)/);
    for (const k of KINDS) expect(effects(k, false).growth).toBe(0);
  });
});

describe("_weather_kind matches kindOf()", () => {
  it("uses the same storm wind threshold", () => {
    expect(SQL).toContain("coalesce(p_wind, 0) >= 60");
    expect(kindOf(61, 60)).toBe("storm");
    expect(kindOf(61, 59)).toBe("rain");
  });
});
