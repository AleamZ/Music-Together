import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FOREST_ICONS } from "@/lib/game/art/forest-icons";
import { iconMatrixFor } from "@/lib/game/art/icons";
import { arrowAt } from "@/lib/game/diorama/character/layer";
import { ACT_TOOL } from "@/lib/game/diorama/character/held";
import { CHAR_ACTS, huntPhase, poseAt } from "@/lib/game/diorama/character/pose";
import { assetValue, isStackable, lotName, offerArg, parseAsset, qtyUnit, type Asset } from "@/lib/game/economy/model";
import {
  CARPENTRY, COAL_BONUS, FOREST_ITEMS, LOG_NAME, RECIPES, recipeLogValue, TOOLS, TRAP_LIMIT, trapOdds, trapTau,
} from "@/lib/game/forest/catalog";
import { nearestTrap, setTraps, trapList } from "@/lib/game/forest/trap-store";
import { WILD_ITEMS } from "@/lib/game/realm/model";
import { FARM_ANIM } from "@/lib/game/net/protocol";

// 0123 / 0124: the forest's second round — carpentry, traps, charcoal, the tools' prices (pinned to the SQL), the
// bow's 3D draw, the icons, and the goods between players.
const SQL123 = readFileSync("supabase/migrations/0123_forest_crafts_traps.sql", "utf8").replace(/\r\n/g, "\n");
const SQL124 = readFileSync("supabase/migrations/0124_forest_trade.sql", "utf8").replace(/\r\n/g, "\n");
const body = (sql: string, name: string): string => {
  const at = sql.indexOf(`function public.${name}(`);
  const start = sql.indexOf("$$", at);
  return sql.slice(start + 2, sql.indexOf("$$", start + 2));
};

describe("0123 = lib/game/forest/catalog.ts", () => {
  it("carpentry recipes", () => {
    const rows = [...body(SQL123, "_carpentry_recipes").matchAll(/\('(\w+)',\s+'([^']+)',\s+'(\w+)',\s+'(\w+)',\s+(\d+), '([^']+)'::jsonb,\s+(\d+)\)/g)];
    expect(rows.map((m) => ({ id: m[1], name: m[2], outKind: m[3], outId: m[4], outQty: +m[5], logs: JSON.parse(m[6]), fee: +m[7] })))
      .toEqual(CARPENTRY.map((r) => ({ id: r.id, name: r.name, outKind: r.outKind, outId: r.outId, outQty: r.outQty, logs: r.logs, fee: r.fee })));
    // every recipe is cheaper than the shop's piece (logs at their NPC price + the fee), and every log is a real one
    for (const r of CARPENTRY) {
      expect(recipeLogValue(r) + r.fee, r.id).toBeLessThan(r.shopPrice);
      for (const log of Object.keys(r.logs)) expect(LOG_NAME[log as keyof typeof LOG_NAME], log).toBeTruthy();
    }
  });
  it("forest items, traps, charcoal", () => {
    for (const i of FOREST_ITEMS) {
      expect(SQL123, i.id).toContain(`('${i.id}',`);
      expect(SQL123).toMatch(new RegExp(`\\('${i.id}',\\s+'forest', '${i.name}',\\s+${i.price}, false, \\d+, ${i.durability ?? "null"}\\)`));
    }
    expect(body(SQL123, "_forest_shop")).toContain("array['bay_go', 'bay_sat']");
    expect(body(SQL123, "_coal_bonus")).toContain(`select ${COAL_BONUS}`);
    expect(body(SQL123, "trap_place")).toContain(`if v_n >= ${TRAP_LIMIT} then`);
    expect(body(SQL123, "_trap_tau")).toContain("when 'bay_sat' then 18 else 30");
    expect([trapTau("bay_go"), trapTau("bay_sat")]).toEqual([30, 18]);
    expect(trapOdds("bay_go", 4)).toBe(0);
    expect(trapOdds("bay_go", 30)).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(trapOdds("bay_go", 1000)).toBe(trapOdds("bay_go", 240));
    expect(trapOdds("bay_sat", 30)).toBeGreaterThan(trapOdds("bay_go", 30));
  });
  it("tools rebalanced: bows, pans and axes pay back in a few sessions", () => {
    const t = (id: string) => TOOLS.find((x) => x.id === id)!;
    expect([t("riu_sat").price, t("riu_thep").price, t("riu_thep_toi").price, t("riu_tinh_luyen").price]).toEqual([450, 900, 1300, 2000]);
    expect([t("cung_go_tram").price, t("cung_go_cung").price, t("chao_gang").price, t("noi_gang").price]).toEqual([700, 1500, 600, 1200]);
    // a higher tier lasts at least as long as the one below it and never costs more a point to repair than 2
    for (const kind of ["axe", "bow", "pan"]) {
      const rows = TOOLS.filter((x) => x.kind === kind).sort((a, b) => a.power - b.power || a.price - b.price);
      for (let i = 1; i < rows.length; i++) expect(rows[i].durability, rows[i].id).toBeGreaterThanOrEqual(rows[i - 1].durability);
      for (const r of rows) expect(r.repairPp, r.id).toBeLessThanOrEqual(2);
    }
  });
});

describe("0123 traps on the map", () => {
  it("keeps my traps with their odds as of the poll, and finds the nearest", () => {
    setTraps([{ id: 1, item: "bay_go", x: 100, y: 100, durability: 6, max: 6, sinceMs: 0 },
      { id: 2, item: "bay_sat", x: 300, y: 100, durability: 3, max: 15, sinceMs: 0 }], 60 * 60_000);
    expect(trapList().map((t) => [t.id, Math.round(t.odds * 100)])).toEqual([[1, 86], [2, 96]]);
    expect(nearestTrap(120, 110, 64)?.id).toBe(1);
    expect(nearestTrap(200, 100, 64)).toBeNull();
    setTraps([], 0);
  });
});

describe("0123 the bow in 3D", () => {
  it("draws, aims, looses, and the arrow flies out", () => {
    expect(CHAR_ACTS).toContain("hunt");
    expect(ACT_TOOL.hunt).toEqual({ L: "bow" });
    expect(FARM_ANIM.hunt).toBe(15);
    expect(huntPhase(0).arrow).toBe("none");
    expect(huntPhase(1.0)).toMatchObject({ draw: 1, arrow: "nocked" });
    const f = huntPhase(1.5);
    expect(f.arrow).toBe("flying");
    expect(f.flight).toBeGreaterThan(0.5);
    expect(arrowAt(1).out).toBeGreaterThan(arrowAt(0).out + 5);
    // the drawing arm bends as the string comes back
    expect(poseAt("hunt", 0.85, 0, false).elbowR).toBeGreaterThan(poseAt("hunt", 0, 0, false).elbowR);
  });
});

describe("0123 icons", () => {
  const ids = [
    ...Object.keys(LOG_NAME), ...Object.keys(WILD_ITEMS), ...RECIPES.map((r) => r.id), ...FOREST_ITEMS.map((i) => i.id),
    ...TOOLS.filter((t) => ["bow", "pan", "axe", "saw"].includes(t.kind)).map((t) => t.id),
  ];
  it("has a 16×16 icon for every forest item, each its own", () => {
    for (const id of ids) {
      const m = iconMatrixFor(id);
      expect(m, id).not.toBeNull();
      expect(m!.length, id).toBe(16);
      expect(m!.every((r) => r.length === 16), id).toBe(true);
      expect(m!.flat().filter(Boolean).length, id).toBeGreaterThan(20);
      // every letter is in the icon's palette (or the outline)
      const icon = FOREST_ICONS[id];
      for (const ch of icon.rows.join("")) if (ch !== "." && ch !== "o") expect(icon.pal[ch], `${id} ${ch}`).toBeTruthy();
    }
    const looks = ids.map((id) => JSON.stringify(iconMatrixFor(id)));
    expect(new Set(looks).size).toBe(ids.length);
  });
});

describe("0124 goods between players", () => {
  const SQL_KINDS = ["wood", "wild", "dish", "item"];
  it("the client knows the server's kinds", () => {
    for (const k of SQL_KINDS) {
      expect(SQL124, k).toContain(`'${k}'`);
      expect(parseAsset({ kind: k, ref: "x", qty: 3, value: 7, name: "X", reserved: 1 })?.kind).toBe(k);
      expect(isStackable(k as Asset["kind"])).toBe(true);
    }
    expect(SQL124).toContain("check (asset_kind in ('fish', 'fashion', 'produce', 'wood', 'wild', 'dish', 'item'))");
    expect(SQL124).toContain("check (kind in ('item', 'fashion', 'fish', 'produce', 'wood', 'wild', 'dish'))");
  });
  it("prices and offers a lot of them like produce", () => {
    const a = parseAsset({ kind: "wood", ref: "go_soi", qty: 10, value: 15, name: "Gỗ sồi", reserved: 2 })!;
    expect(assetValue(a, 4)).toBe(60);
    expect(lotName("wood", "Gỗ sồi", 4)).toBe("Gỗ sồi ×4");
    expect(lotName("produce", "Khoai lang", 5)).toBe("Khoai lang 5 kg");
    expect([qtyUnit("produce"), qtyUnit("dish")]).toEqual(["kg", "cái"]);
    expect(offerArg({ coins: 0, items: [{ ...a, qty: 4 }] }).items).toEqual([{ kind: "wood", ref: "go_soi", qty: 4 }]);
  });
});
