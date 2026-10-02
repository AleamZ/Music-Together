import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMineCases, type MineCase } from "@/scripts/gen-mine-fixtures";
import {
  CRAFT_ITEMS, NODE_POOLS, nodeZone, PICKAXES, RECIPES, UPGRADE_CHANCE, UPGRADE_MATS, upgradeCoins, upgradeMax,
} from "@/lib/game/mining/catalog";
import { canStrike, createMineRound, MINE, mineInputError, minePos, mineWin, replayMine, stepMineRound } from "@/lib/game/mining/game";
import { getMap } from "@/lib/game/maps/registry";
import { ANVIL_USE, CAULDRON_USE, MINE_NODES, SHOP_USE } from "@/lib/game/maps/mo-da";
import { MAP_MIN_LEVEL } from "@/lib/game/progression/model";
import { fishRarity, RARITY_INFO, rarityInfo, rarityOfTier } from "@/lib/game/rarity";
import { parseMineState } from "@/lib/game/mining/rpc";

const SQL = readFileSync("supabase/migrations/0072_mining_crafting.sql", "utf8");
/** Econ v2 (0103): the ore prices, the potion fees and the upgrade floor — the newest values win over 0072's seed. */
const SQL103 = readFileSync("supabase/migrations/0103_econ_crafts.sql", "utf8");
const FIXTURE = "tests/fixtures/mine-cases.json";

/** `(id, value)` pairs of 0103's `update public.<table> … from (values …)`. */
function updates(table: string): Map<string, number> {
  const at = SQL103.indexOf(`update public.${table} `);
  expect(at, table).toBeGreaterThan(-1);
  const list = SQL103.slice(SQL103.indexOf("(values", at), SQL103.indexOf(" v(id,", at));
  return new Map([...list.matchAll(/\('(\w+)', (\d+)\)/g)].map((m) => [m[1], +m[2]]));
}

/** The body of `create or replace function public.<name>` up to its closing `$$`. */
function body(name: string): string {
  const start = SQL.indexOf(`function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const open = SQL.indexOf("$$", start);
  return SQL.slice(open, SQL.indexOf("$$", open + 2));
}

describe("the dig (lib/game/mining/game.ts = 0072's _mine_replay)", () => {
  it("mine-cases.json is what the TS makes (WRITE_MINE_FIXTURES=1 rewrites it)", () => {
    const cases = buildMineCases();
    if (process.env.WRITE_MINE_FIXTURES === "1") writeFileSync(FIXTURE, `${JSON.stringify(cases)}\n`);
    const got = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as MineCase[]) : [];
    expect(got).toEqual(cases);
    expect(got.filter((c) => c.expected.outcome === "pass").length).toBeGreaterThanOrEqual(10);
    expect(got.filter((c) => c.expected.outcome === "fail").length).toBeGreaterThanOrEqual(3);
    expect(got.filter((c) => c.expected.outcome === "open").length).toBeGreaterThanOrEqual(3);
    for (const c of got) {
      if (c.expected.ticks !== null) expect(mineInputError(c.strikes, c.expected.ticks), c.name).toBeNull();
    }
  });

  it("the marker sweeps 0 → 1000 → 0 over its period", () => {
    expect(minePos(100, 0)).toBe(0);
    expect(minePos(100, 50)).toBe(1000);
    expect(minePos(100, 25)).toBe(500);
    expect(minePos(100, 75)).toBe(500);
    expect(minePos(100, 100)).toBe(0);
  });

  it("the stepped round and the replay agree; a pass ends at the deciding strike + 1", () => {
    let s = createMineRound(12345, 3, 150);
    while (s.outcome === "open") {
      const inVein = Math.abs(minePos(s.period, s.tick) - s.centres[s.hits]) <= s.win;
      s = stepMineRound(s, inVein && canStrike(s));
    }
    expect(s.outcome).toBe("pass");
    const r = replayMine(12345, 3, 150, s.strikes);
    expect(r).toEqual({ outcome: "pass", ticks: s.tick, hits: 3, used: s.strikes.length });
  });

  it("the input rules: ≤ 12 strikes, ≤ 4 in 60 ticks, inside the dig", () => {
    expect(mineInputError([10, 20, 30, 40, 50], 100)).toBe("rate");
    expect(mineInputError([10, 20, 30, 40, 75], 100)).toBeNull();
    expect(mineInputError([5], 5)).toBe("range");
    expect(mineInputError([], MINE.maxTicks + 1)).toBe("ticks");
    expect(mineInputError(Array.from({ length: 13 }, (_, i) => i * 20), 400)).toBe("too_many");
  });

  it("the window widens with the tier and the level, capped", () => {
    expect(mineWin(1, 0)).toBe(90);
    expect(mineWin(4, 0)).toBe(150);
    expect(mineWin(4, 5)).toBe(210);
    expect(mineWin(4, 9)).toBe(220);
    expect(body("_mine_win")).toContain("least(220, 70 + 20 * p_tier + 12 * coalesce(p_level, 0))");
  });
});

describe("the catalogs are 0072's rows (with 0103's prices and fees)", () => {
  it("craft_items", () => {
    const prices = updates("craft_items");
    expect([...prices.keys()]).toEqual(CRAFT_ITEMS.filter((i) => i.kind === "ore").map((i) => i.id));
    for (const it of CRAFT_ITEMS) {
      const q = (v: string | number | null) => (v === null ? "null" : typeof v === "string" ? `'${v}'` : String(v));
      const seeded = prices.has(it.id) ? "\\d+" : q(it.price);
      const re = new RegExp(`\\(${q(it.id)},\\s*${q(it.kind)},\\s*${q(it.name)},\\s*${it.rarity},\\s*${seeded},\\s*${q(it.hardness)},\\s*${q(it.minTier)},\\s*${q(it.respawnS)},\\s*${it.xp},`);
      expect(SQL, it.id).toMatch(re);
      if (prices.has(it.id)) expect(it.price, it.id).toBe(prices.get(it.id));
    }
    expect(CRAFT_ITEMS.map((i) => i.rarity)).toContain(6);
    // ores ÷ 4 (econ v2)
    expect(CRAFT_ITEMS.filter((i) => i.kind === "ore").map((i) => i.price)).toEqual([1, 3, 6, 10, 20, 40, 80, 175, 500]);
  });

  it("pickaxes and recipes", () => {
    for (const p of PICKAXES) {
      expect(SQL).toMatch(new RegExp(`\\('${p.id}',\\s*'${p.name}',\\s*${p.tier},\\s*${p.price},\\s*${p.durability},\\s*${p.rarity},`));
    }
    const fees = updates("potion_recipes");
    for (const r of RECIPES) {
      const json = JSON.stringify(r.ingredients).replace(/:/g, ": ").replace(/,/g, ", ");
      const fee = fees.has(r.id) ? "\\d+" : String(r.fee);
      expect(SQL).toMatch(new RegExp(`\\('${r.id}',\\s*'${r.effect}',\\s*${r.amount},\\s*${r.durationS},\\s*${fee},\\s*'${json.replace(/[{}]/g, "\\$&")}'\\)`));
      if (fees.has(r.id)) expect(r.fee, r.id).toBe(fees.get(r.id));
    }
    expect(Object.fromEntries(RECIPES.map((r) => [r.id, r.fee]))).toEqual({
      pot_hunger: 60, pot_thirst: 25, pot_canh: 120, pot_cure: 30, pot_miner: 300, pot_luck: 150, pot_luck2: 600,
    });
  });

  it("the node pools and the upgrade rules", () => {
    for (const [zone, pool] of Object.entries(NODE_POOLS)) {
      pool.forEach(([item, w], k) => expect(SQL).toContain(`(${zone}, ${k + 1}, '${item}', ${w})`));
    }
    expect([1, 4, 5, 8, 9, 10, 11, 13, 14].map(nodeZone)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5]);
    expect(body("_upgrade_chance")).toContain(`array[${UPGRADE_CHANCE.join(", ")}]`);
    for (const m of UPGRADE_MATS) expect(body("_upgrade_mats")).toContain(`'${JSON.stringify(m).replace(/:/g, ": ").replace(/,/g, ", ")}'`);
    expect(SQL103).toContain("select greatest(200 * (p_level + 1), (coalesce(p_price, 0) * (p_level + 1)) / 4)");
    expect(upgradeCoins(null, 0)).toBe(200);
    expect(upgradeCoins(null, 4)).toBe(1000);
    expect(upgradeCoins(150, 2)).toBe(600);
    expect(upgradeCoins(5000, 1)).toBe(2500);
    expect(upgradeMax(300, 5)).toBe(600);
    expect(upgradeMax(null, 3)).toBeNull();
  });
});

describe("the map Mỏ đá", () => {
  const map = getMap("mo_da");

  it("its use spots are 0072's", () => {
    const xs = MINE_NODES.map((n) => n.use.x), ys = MINE_NODES.map((n) => n.use.y);
    expect(body("_mine_node_use")).toContain(`array[${xs.join(", ")}]`);
    expect(body("_mine_node_use")).toContain(`array[${ys.join(", ")}]`);
    expect(body("_mine_spot")).toContain(`'shop' then array[${SHOP_USE.x}, ${SHOP_USE.y}]`);
    expect(body("_mine_spot")).toContain(`'anvil' then array[${ANVIL_USE.x}, ${ANVIL_USE.y}]`);
    expect(body("_mine_spot")).toContain(`'cauldron' then array[${CAULDRON_USE.x}, ${CAULDRON_USE.y}]`);
  });

  it("every use spot and the arrival are walkable; the gate links both ways (0072's portals)", () => {
    const free = (x: number, y: number) => map.blocked[Math.floor(y / map.cell) * map.cols + Math.floor(x / map.cell)] === 0;
    for (const it of map.interactables) expect(free(it.use.x, it.use.y), it.id).toBe(true);
    expect(free(map.spawn.x, map.spawn.y)).toBe(true);
    const gate = getMap("bai_dat").interactables.find((i) => i.id === "mo_da_gate");
    expect(gate?.to?.map).toBe("mo_da");
    const exit = map.interactables.find((i) => i.id === "mo_da_exit");
    expect(exit?.to?.map).toBe("bai_dat");
    expect(body("_pos_portals")).toContain(`('bai_dat', 'mo_da', ${gate!.use.x}, ${gate!.use.y}, ${map.spawn.x}, ${map.spawn.y}, false)`);
    expect(body("_pos_portals")).toContain(`('mo_da', 'bai_dat', ${exit!.use.x}, ${exit!.use.y}, ${exit!.to!.arrive.x}, ${exit!.to!.arrive.y}, false)`);
    const bai = getMap("bai_dat");
    const bfree = (x: number, y: number) => bai.blocked[Math.floor(y / bai.cell) * bai.cols + Math.floor(x / bai.cell)] === 0;
    expect(bfree(gate!.use.x, gate!.use.y)).toBe(true);
    expect(bfree(exit!.to!.arrive.x, exit!.to!.arrive.y)).toBe(true);
    expect(body("_pos_maps")).toContain("('mo_da', 640, 400)");
  });

  it("its level gate matches the server's row", () => {
    expect(SQL).toContain(`values ('mo_da', ${MAP_MIN_LEVEL.mo_da})`);
  });
});

describe("rarity tiers (#88)", () => {
  it("maps stored tiers and fish rarities", () => {
    expect(rarityOfTier(1)).toBe("common");
    expect(rarityOfTier(6)).toBe("mythic");
    expect(rarityOfTier(9)).toBe("mythic");
    expect(rarityOfTier(null)).toBe("common");
    expect(fishRarity(5)).toBe("legendary");
    expect(fishRarity(3)).toBe("rare");
    expect(rarityInfo(4).label).toBe("Quý");
    expect(Object.values(RARITY_INFO).map((r) => r.tier)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("the mine state parser", () => {
  it("reads 0072's _mine_state", () => {
    const s = parseMineState({
      server_now: "2026-09-29T10:00:00Z", coins: 120, fish: 2,
      nodes: [{ no: 1, item: "ore_da", ready_at: "2026-09-29T09:59:00Z" }],
      bag: { ore_da: 3, herb_nam: 0 }, tools: [{ id: "pick_da", durability: 59, max: 60, level: 0 }],
      gear: [{ id: "rod_wood", kind: "rod", name: "Cần tre", price: null, durability: null, max: null, level: 1 }],
      buffs: [{ kind: "luck", power: 1, until: "2026-09-29T10:10:00Z" }], dig: null,
    });
    expect(s?.bag).toEqual({ ore_da: 3 });
    expect(s?.tools[0].max).toBe(60);
    expect(s?.gear[0].level).toBe(1);
    expect(s?.dig).toBeNull();
    expect(parseMineState({})).toBeNull();
  });
});
