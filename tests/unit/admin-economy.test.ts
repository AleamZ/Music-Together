import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compactXu, groupFlows, inflationPerDay, parseEconomy, reasonGroup, reasonLabel, type EconFlow,
} from "@/lib/admin-economy";

// The newest coin_ledger reason check (the last migration that adds it back).
function ledgerReasons(): string[] {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  for (const f of files) {
    const sql = readFileSync(`${dir}/${f}`, "utf8");
    const at = sql.lastIndexOf("add constraint coin_ledger_reason_check");
    if (at >= 0) body = sql.slice(at, sql.indexOf(";", at));
  }
  return [...body.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

describe("admin economy (0099)", () => {
  it("every ledger reason has a group and a Vietnamese label", () => {
    const reasons = ledgerReasons();
    expect(reasons.length).toBeGreaterThan(90);
    for (const r of reasons) expect(reasonLabel(r), r).not.toBe(r);
  });

  it("groups flows: faucets, sinks, transfers; totals add up", () => {
    const flows: EconFlow[] = [
      { reason: "sell", in: 12000, out: 0, n: 3, accounts: 1 },
      { reason: "meal", in: 0, out: -3000, n: 2, accounts: 1 },
      { reason: "market_buy", in: 0, out: -1000, n: 1, accounts: 1 },
      { reason: "market_sell", in: 950, out: 0, n: 1, accounts: 1 },
      { reason: "something_new", in: 10, out: 0, n: 1, accounts: 1 },
    ];
    const g = groupFlows(flows);
    expect(g.groups.map((x) => x.group)).toEqual(["faucet", "sink", "p2p"]);
    expect(g.groups[0].in).toBe(12010);
    expect(g.groups[2].net).toBe(-50);
    expect(g.net).toBe(12000 - 3000 - 1000 + 950 + 10);
    expect(reasonGroup("something_old", -5)).toBe("sink");
  });

  it("inflation per day is measured against the supply at the window's start", () => {
    expect(inflationPerDay(700, 10700, 7)).toBeCloseTo(1, 5);
    expect(inflationPerDay(100, 100, 1)).toBeNull();
  });

  it("compact xu", () => {
    expect(compactXu(9300)).toBe("9.300");
    expect(compactXu(12900)).toBe("12,9 N");
    expect(compactXu(4_200_000)).toBe("4,2 Tr");
    expect(compactXu(-1_100_000_000)).toBe("−1,1 Tỷ");
  });

  it("parses admin_economy defensively", () => {
    const r = parseEconomy({
      server_now: "2026-09-30T11:00:00Z",
      supply: { total: 14300, frozen: 0, wallets: 3, holders: 2 },
      dist: { n: 2, p50: 5000, p90: 9300, p99: 9300, max: 9300, top10_share: 100 },
      top: [{ username: "cat", is_root: false, coins: 9300 }],
      active: { d1: 1, d7: 2, d30: 2 },
      flows: { d1: [{ reason: "sell", in: 12000, out: 0, n: 1, accounts: 1 }], d7: [], d30: null },
      daily: [{ day: "2026-09-30", in: 12300, out: -3000, net: 9300, accounts: 1, supply: 14300 }],
      rooms: [{ name: "Phòng A", mult: "2.24", wealth: 100000 }],
    });
    expect(r.supply.total).toBe(14300);
    expect(r.flows.d1[0].in).toBe(12000);
    expect(r.flows.d30).toEqual([]);
    expect(r.rooms[0].mult).toBe(2.24);
    expect(parseEconomy(null).daily).toEqual([]);
  });
});
