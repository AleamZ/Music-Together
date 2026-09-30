import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { npcCutNote, npcPay, npcQuotaLine, npcRate, parseNpcQuota } from "@/lib/game/economy/npc";

const Q = { gross: 0, full: 20000, half: 40000, tailPct: 20 };

describe("thương lái (econ v2, 0100)", () => {
  it("pays like _npc_sale: full, then 50 %, then the tail", () => {
    expect(npcPay(Q, 15000)).toBe(15000);
    expect(npcPay({ ...Q, gross: 15000 }, 10000)).toBe(7500);
    expect(npcPay({ ...Q, gross: 25000 }, 30000)).toBe(10500);
    expect(npcPay(Q, 0)).toBe(0);
    expect(npcRate({ ...Q, gross: 19999 })).toBe(100);
    expect(npcRate({ ...Q, gross: 20000 })).toBe(50);
    expect(npcRate({ ...Q, gross: 40000 })).toBe(20);
  });

  it("parses the answer and words it", () => {
    expect(parseNpcQuota({ gross: 1200, full: 20000, half: 40000, tail_pct: 20 })).toEqual({ ...Q, gross: 1200 });
    expect(parseNpcQuota({ gross: "x" })).toBeNull();
    expect(parseNpcQuota(null)).toBeNull();
    expect(npcQuotaLine({ ...Q, gross: 12300 })).toBe("Thương lái hôm nay: đã mua 12.300 / 20.000 xu đủ giá");
    expect(npcQuotaLine({ ...Q, gross: 25000 })).toBe("Thương lái hôm nay đã mua 25.000 xu hàng: giờ chỉ trả 50% giá");
    expect(npcCutNote(0)).toBeNull();
    expect(npcCutNote(1200)).toBe("Thương lái đã mua nhiều hôm nay nên bớt 1.200 xu.");
  });

  it("the defaults match the knobs seeded by 0100", () => {
    const sql = readFileSync("supabase/migrations/0100_econ_core.sql", "utf8");
    expect(sql).toMatch(/\('npc_full', 20000,/);
    expect(sql).toMatch(/\('npc_half', 40000,/);
    expect(sql).toMatch(/\('npc_tail_pct', 20,/);
    expect(sql).toContain("v_paid := floor(v_a + v_b * 0.5 + v_c * v_tail / 100)::integer;");
  });
});
