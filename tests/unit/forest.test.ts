// 0096: the forest's tables and minigame rules (lib/game/forest) are the SQL's. WRITE_FOREST_FIXTURES=1 rewrites
// tests/fixtures/forest-cases.json, which tests/sql/forest-professions-smoke.sql replays through _chop_hits / _cook_score /
// _tree_of.
import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COOKED_TOAST, cookPct, cookQuality, dishBuffMin, dishPrice, dishStamina, RECIPES, repairCost, RUNG_TRAM_ORIGIN, starterOf, TOOLS,
  TREES, treeKey, treeOf,
} from "@/lib/game/forest/catalog";
import {
  CHOP_WIN, chopBlows, chopHits, cookScore, heatAt, parseStep, stepsToParams, type CookStepEv,
} from "@/lib/game/forest/games";
import { parseForest } from "@/lib/game/forest/rpc";
import { PROFESSIONS } from "@/lib/game/professions/catalog";

const SQL = readFileSync("supabase/migrations/0096_forest_professions.sql", "utf8").replace(/\r\n/g, "\n");
/** 0097 re-made some of 0096's functions: the newest body wins. */
const SQL97 = readFileSync("supabase/migrations/0097_forest_complete.sql", "utf8").replace(/\r\n/g, "\n");
function body(name: string): string {
  for (const sql of [SQL97, SQL]) {
    const at = sql.indexOf(`function public.${name}(`);
    if (at < 0) continue;
    const start = sql.indexOf("$$", at);
    return sql.slice(start + 2, sql.indexOf("$$", start + 2));
  }
  throw new Error(`no ${name}`);
}
const FIXTURES = "tests/fixtures/forest-cases.json";

describe("0096 tables = lib/game/forest/catalog.ts", () => {
  it("trees", () => {
    const rows = [...body("_forest_trees").matchAll(/\('(\w+)', '([^']+)', (\d+), (\d+), '(\w+)', (\d+), (\d+), (true|false), (\d+)\)/g)];
    expect(rows.map((m) => ({
      id: m[1], name: m[2], need: +m[3], respawnMin: +m[4], log: m[5], logs: +m[6], price: +m[7], rare: m[8] === "true", upto: +m[9],
    }))).toEqual(TREES);
    expect(body("_tree_of")).toContain("((p_cx::bigint * 7919 + p_cy::bigint * 104729 + p_k::bigint * 1543) % 1000) < t.upto");
  });
  it("tools: a starter for every nghề, the bow / pot / axe tiers (0097)", () => {
    const rows = [...body("_prof_tools_catalog").matchAll(/\('(\w+)', '(\w+)', '([^']+)', '(\w+)', (\d+), (\d+), (\d+), (true|false), (\d+)\)/g)];
    expect(rows.map((m) => ({
      id: m[1], prof: m[2], name: m[3], kind: m[4], durability: +m[5], power: +m[6], price: +m[7], starter: m[8] === "true", repairPp: +m[9],
    }))).toEqual(TOOLS);
    for (const p of PROFESSIONS) expect(starterOf(p.id)?.durability).toBe(60);
    expect(repairCost(TOOLS.find((t) => t.id === "riu_tap_su")!, 30, 60)).toBe(30);
    expect(repairCost(TOOLS.find((t) => t.id === "riu_thep")!, 100, 140)).toBe(120);
    expect(body("_forest_origin")).toContain(`select ${RUNG_TRAM_ORIGIN.x}, ${RUNG_TRAM_ORIGIN.y}`);
  });
  it("recipes (0097: forest-content's ten dishes) and qualities", () => {
    const q = (x: string) => (x === "null" ? null : x.replace(/'/g, ""));
    const rows = [...body("_cook_recipes").matchAll(/\('(\w+)', '([^']+)', (null|'\w+'), (\d+), (null|'\w+'), (\d+), (\d+), array\[([^\]]*)\], (\d+), (\d+), (null|'\w+'), (\d+), (\d+)\)/g)];
    expect(rows.map((m) => ({
      id: m[1], name: m[2], meat: q(m[3]), meatQty: +m[4], fish: q(m[5]), fishQty: +m[6], fee: +m[7],
      steps: m[8].split(",").map((x) => x.trim().replace(/'/g, "")), price: +m[9], stamina: +m[10],
      buff: q(m[11]), buffValue: +m[12], buffMin: +m[13],
    }))).toEqual(RECIPES);
    expect(body("_cook_quality")).toContain("when p_score >= 90 then 3 when p_score >= 70 then 2 when p_score >= 40 then 1 else 0");
    expect(body("_cook_pct")).toContain("when 3 then 150 when 2 then 125 when 1 then 100 else 20");
    expect([0, 39, 40, 69, 70, 89, 90, 100].map(cookQuality)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect([0, 1, 2, 3].map(cookPct)).toEqual([20, 100, 125, 150]);
    const r = RECIPES.find((x) => x.id === "chao_ga_rung")!;
    expect(dishPrice(r, 3)).toBe(330);
    expect(dishStamina(r, 0)).toBe(0);
    expect(dishStamina(r, 2)).toBe(25);
    const snake = RECIPES.find((x) => x.id === "chao_ran_dau_xanh")!;
    expect(dishBuffMin(snake, 3)).toBe(22);
    expect(dishBuffMin(snake, 0)).toBe(0);
    for (const x of RECIPES) expect(COOKED_TOAST[x.id]).toBeTruthy();
  });
  it("the xp rules and the Thợ săn / Tiều phu nodes are seeded", () => {
    expect(SQL).toContain("('wild_hunt', '', 'tho_san', 10)");
    expect(SQL).toContain("('wood_chopped', '', 'tieu_phu', 8)");
    expect(SQL).toContain("'wood_sell','tool_buy','cook_fee','dish_sell'");
  });
});

describe("trees", () => {
  it("every kind occurs, the common ones most", () => {
    const n = new Map<string, number>();
    for (let cx = 0; cx < 65; cx++) for (let cy = 0; cy < 35; cy++) for (let k = 0; k < 8; k++) {
      const t = treeOf(cx, cy, k).id;
      n.set(t, (n.get(t) ?? 0) + 1);
    }
    for (const t of TREES) expect(n.get(t.id) ?? 0).toBeGreaterThan(0);
    expect(n.get("cay_tre")!).toBeGreaterThan(n.get("cay_than_moc")!);
    expect(treeKey(3, 4, 5)).toBe("3:4:5");
  });
});

describe("chopping", () => {
  it("matches each beat with the first unused press in the window", () => {
    expect(chopHits([100, 160, 220], CHOP_WIN, [101, 158, 231])).toEqual({
      hits: 3, pairs: [{ beat: 1, press: 1, off: 1 }, { beat: 2, press: 2, off: -2 }, { beat: 3, press: 3, off: 11 }],
    });
    expect(chopHits([100, 160, 220], CHOP_WIN, [112, 150]).hits).toBe(1);
    expect(chopHits([100, 160, 220], CHOP_WIN, []).hits).toBe(0);
    expect(chopHits([100, 105, 220], CHOP_WIN, [103]).hits).toBe(1);        // one press, one beat
  });
  it("strikes: power per hit, 1 per miss, the skill's one more", () => {
    expect(chopBlows(3, 2, false)).toBe(6);
    expect(chopBlows(1, 3, false)).toBe(5);
    expect(chopBlows(1, 3, true)).toBe(6);
    expect(chopBlows(3, 1, true)).toBe(3);
  });
});

describe("cooking", () => {
  const slice: CookStepEv = { kind: 1, start: 60, end: 200, p1: 110, p2: 170, p3: 0 };
  const stir: CookStepEv = { kind: 2, start: 230, end: 440, p1: 90, p2: 0, p3: 0 };
  const fire: CookStepEv = { kind: 3, start: 470, end: 710, p1: 100, p2: 30, p3: 50 };
  it("the heat is a triangle", () => {
    expect(heatAt(fire, 470)).toBe(60);                               // x = 30 → 60
    expect(heatAt(fire, 490)).toBe(100);                              // x = 50 → the top
    expect(heatAt(fire, 540)).toBe(0);                                // x = 0 again
  });
  it("scores each step and the mean", () => {
    const r = cookScore([slice, stir, fire], [110, 172, 240, 515], [330]);
    expect(r.steps).toEqual([96, 100, 100]);
    expect(r.score).toBe(98);
    expect(cookScore([slice], [], []).score).toBe(0);
    expect(cookScore([stir], [240], []).steps).toEqual([0]);            // never released
    expect(cookScore([slice], [50, 110, 170], []).steps).toEqual([100]); // a press before the step does not count
  });
  it("parses a revealed step", () => {
    expect(parseStep({ kind: 3, start: 1, end: 2, p1: 3, p2: 4, p3: 5 })).toEqual({ kind: 3, start: 1, end: 2, p1: 3, p2: 4, p3: 5 });
    expect(parseStep({ kind: 9 })).toBeNull();
    expect(parseStep(undefined)).toBeNull();
  });
});

describe("the state", () => {
  it("parses defensively", () => {
    const s = parseForest({ wood: [{ item: "go_tre", qty: 2, half: 1 }, { qty: 3 }], logs_today: 5, tools: [{ item: "riu_sat", durability: 3, max: 120 }],
      dishes: [{ dish: "com_thit_tho", quality: 2, qty: 1 }], meat: { thit_tho: 4, x: "y" }, main: "tieu_phu", felled: [{ tree: "1:2:3", respawn_ms: 9 }], server_now_ms: 7 });
    expect(s.wood).toEqual([{ item: "go_tre", qty: 2, half: 1 }]);
    expect(s.meat).toEqual({ thit_tho: 4 });
    expect(s.felled).toEqual([{ tree: "1:2:3", respawnMs: 9 }]);
    expect(parseForest(null).wood).toEqual([]);
  });
});

// ---------------------------------------------------------------- the fixtures the SQL smoke replays
interface Rng { next(): number }
const rng = (seed: number): Rng => {
  let s = seed >>> 0 || 1;
  return { next: () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; } };
};
function makeCases() {
  const r = rng(96);
  const int = (a: number, b: number) => a + Math.floor(r.next() * (b - a + 1));
  const chop = [];
  for (let i = 0; i < 40; i++) {
    const b1 = int(80, 129), b2 = b1 + int(50, 99), b3 = b2 + int(50, 99);
    const win = i % 3 === 0 ? 13 : 11;
    const presses = Array.from({ length: int(0, 6) }, () => int(40, b3 + 40)).sort((x, y) => x - y);
    chop.push({ beats: [b1, b2, b3], win, presses, expected: chopHits([b1, b2, b3], win, presses) });
  }
  const cook = [];
  for (let i = 0; i < 40; i++) {
    const kinds = i % 2 === 0 ? [1, 3] : [1, 2, 3];
    let t = 60;
    const steps: CookStepEv[] = [];
    for (const k of kinds) {
      if (k === 1) { const b1 = t + int(40, 70), b2 = b1 + int(35, 65); steps.push({ kind: 1, start: t, end: b2 + 30, p1: b1, p2: b2, p3: 0 }); t = b2 + 60; }
      else if (k === 2) { const h = int(60, 120); steps.push({ kind: 2, start: t, end: t + h + 120, p1: h, p2: 0, p3: 0 }); t += h + 150; }
      else { const per = int(80, 140); steps.push({ kind: 3, start: t, end: t + 240, p1: per, p2: int(0, per - 1), p3: int(25, 75) }); t += 270; }
    }
    const a = Array.from({ length: int(0, 8) }, () => int(40, t)).sort((x, y) => x - y);
    const b = Array.from({ length: int(0, 3) }, () => int(40, t)).sort((x, y) => x - y);
    cook.push({ params: stepsToParams(steps), a, b, expected: cookScore(steps, a, b) });
  }
  const trees = [];
  for (let i = 0; i < 60; i++) { const cx = int(0, 64), cy = int(0, 34), k = int(0, 7); trees.push({ cx, cy, k, id: treeOf(cx, cy, k).id }); }
  return { chop, cook, trees };
}

describe("the SQL fixtures", () => {
  it("are what the TS rules compute", () => {
    const cases = makeCases();
    if (process.env.WRITE_FOREST_FIXTURES === "1") writeFileSync(FIXTURES, JSON.stringify(cases, null, 1) + "\n");
    expect(JSON.parse(readFileSync(FIXTURES, "utf8"))).toEqual(JSON.parse(JSON.stringify(cases)));
    expect(cases.chop.some((c) => c.expected.hits === 3) && cases.chop.some((c) => c.expected.hits === 0)).toBe(true);
    expect(cases.cook.some((c) => c.expected.score > 0)).toBe(true);
  });
});
