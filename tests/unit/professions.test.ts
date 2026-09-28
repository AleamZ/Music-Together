import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MEAL_BUFFS, PERK_TEXT, PROFESSIONS, RESET_FEE, SKILL_NODES, SWITCH_FEE } from "@/lib/game/professions/catalog";
import {
  levelOf, levelProgress, nodeStatus, parseProfState, pointsLeft, speedBuffFactor, staminaNow, xpForLevel,
} from "@/lib/game/professions/model";

const SQL = readFileSync("supabase/migrations/0077_professions.sql", "utf8").replace(/\r\n/g, "\n");

/** The rows of the seed `insert into public.<table> … values … on conflict`. */
function seedRows(table: string): string[] {
  const from = SQL.indexOf(`insert into public.${table} (`);
  const body = SQL.slice(SQL.indexOf("values", from), SQL.indexOf("on conflict", from));
  return [...body.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
}
const q = (s: string | null) => (s === null ? "null" : `'${s}'`);

describe("professions catalog = the 0077 seed", () => {
  it("professions", () => {
    expect(seedRows("profession_catalog").map((r) => r.replace(/\s+/g, " ").trim()))
      .toEqual(PROFESSIONS.map((p, i) => `'${p.id}', '${p.name}', '${p.icon}', ${i + 1}`));
  });
  it("skill nodes", () => {
    const rows = seedRows("skill_nodes").map((r) => r.split(",").map((x) => x.trim()));
    expect(rows).toHaveLength(SKILL_NODES.length);
    SKILL_NODES.forEach((n, i) => {
      expect(rows[i].slice(0, 7)).toEqual([q(n.id), q(n.prof), q(n.name), q(n.perk), String(n.value), String(n.cost), q(n.req)]);
    });
  });
  it("meal buffs", () => {
    expect(seedRows("meal_buffs").map((r) => r.replace(/\s+/g, " ").trim()))
      .toEqual(MEAL_BUFFS.map((b) => `'${b.meal}', '${b.key}', ${b.value}, ${b.minutes}`));
  });
  it("fees and a text for every perk", () => {
    expect(SQL).toContain(`'switch_fee', ${SWITCH_FEE}, 'reset_fee', ${RESET_FEE}`);
    for (const n of SKILL_NODES) expect(PERK_TEXT[n.perk]).toContain("{v}");
    for (const p of PROFESSIONS) expect(SKILL_NODES.filter((n) => n.prof === p.id)).toHaveLength(6);
  });
});

describe("levels, points, stamina", () => {
  it("levels as _prof_level", () => {
    expect([0, 99, 100, 299, 300, 1500, 5500, 21000, 1e7].map(levelOf)).toEqual([0, 0, 1, 1, 2, 5, 10, 20, 20]);
    expect(xpForLevel(10)).toBe(5500);
    expect(levelProgress(200)).toBeCloseTo(0.5);
  });
  it("node status", () => {
    const eye = SKILL_NODES.find((n) => n.id === "f_eye")!;
    expect(nodeStatus(eye, new Set(), 5)).toBe("locked");
    expect(nodeStatus(eye, new Set(["f_hand"]), 1)).toBe("poor");
    expect(nodeStatus(eye, new Set(["f_hand"]), 2)).toBe("open");
    expect(nodeStatus(eye, new Set(["f_hand", "f_eye"]), 0)).toBe("learned");
    expect(pointsLeft({ id: "ngu_dan", xp: 0, level: 3, spent: 2 })).toBe(1);
  });
  it("stamina extrapolation and speed buff", () => {
    const s = { value: 50, max: 100, ratePerS: 100 / 600, resting: false, serverNowMs: 0 };
    expect(staminaNow(s, 60_000)).toBeCloseTo(60);
    expect(staminaNow(s, 3_600_000)).toBe(100);
    expect(speedBuffFactor([{ key: "speed", value: 50, untilMs: 10 }], 5)).toBeCloseTo(1.1);
    expect(speedBuffFactor([{ key: "speed", value: 5, untilMs: 10 }], 11)).toBe(1);
  });
  it("parses the state", () => {
    const s = parseProfState({
      main: "vo_si", switch_at_ms: 5, switch_fee: 500, reset_fee: 300, skills: ["v_wind"], server_now_ms: 1,
      profs: [{ id: "vo_si", xp: 300, level: 2, spent: 1 }], buffs: [{ key: "strength", value: 20, until_ms: 9 }],
      stamina: { value: 3, max: 100, rate_per_s: 0.2, resting: true, server_now_ms: 1 },
    });
    expect(s?.main).toBe("vo_si");
    expect(s?.stamina?.resting).toBe(true);
    expect(s?.buffs[0]).toEqual({ key: "strength", value: 20, untilMs: 9 });
    expect(parseProfState(null)).toBeNull();
  });
});
