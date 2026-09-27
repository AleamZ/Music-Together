import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clockText, EXHAUST_AT, FAINT_LADDER_MS, faintLadderMs, ladderText } from "@/lib/game/vitals";
import { parseVitals, vitalsErrorMessage } from "@/lib/game/vitals-rpc";

const SQL = readFileSync("supabase/migrations/0045_faint_ladder.sql", "utf8").replace(/\r\n/g, "\n");
const VT40 = readFileSync("supabase/migrations/0040_rest_vitals.sql", "utf8").replace(/\r\n/g, "\n");

describe("faint ladder mirrors 0045", () => {
  it("the durations", () => {
    expect(SQL).toContain("when p_n <= 1 then interval '10 seconds'");
    expect(SQL).toContain("when p_n = 2 then interval '5 minutes'");
    expect(SQL).toContain("when p_n = 3 then interval '15 minutes'");
    expect(SQL).toContain("when p_n = 4 then interval '1 hour'");
    expect(SQL).toContain(`_faint_today(v) >= ${EXHAUST_AT}`);
    expect(FAINT_LADDER_MS).toEqual([10_000, 300_000, 900_000, 3_600_000]);
  });
  it("no faint is set outside _faint", () => {
    expect(SQL).not.toMatch(/fainted_until\s*:?=\s*now\(\)\s*\+\s*interval/);
    expect(SQL.match(/public\._faint\(/g)!.length).toBe(7); // 3 applies, heat, tick, the definition, the revoke
  });
  it("the lockout guards", () => {
    const guard = SQL.slice(SQL.indexOf("function public._vitals_guard"), SQL.indexOf("end; $$;", SQL.indexOf("function public._vitals_guard")));
    expect(guard).toContain("perform public._not_exhausted(p_account);");
    const sit = SQL.slice(SQL.indexOf("function public.card_sit"));
    expect(sit.slice(0, sit.indexOf("if p_game"))).toContain("perform public._not_exhausted(v_account);");
  });
  it("0045's vitals_tick is 0040's plus the faint-ladder lines", () => {
    const body = (s: string) => {
      const from = s.indexOf("create or replace function public.vitals_tick");
      return s.slice(from, s.indexOf("\nend; $$;", from));
    };
    const norm = (s: string) => s.split("\n")
      .filter((l) => !l.includes("faint ladder") && !l.includes("fainted_until = now() + interval '10 seconds'"))
      .map((l) => l.replace(/--.*$/, "")).join("").replace(/[\s,();]/g, "");
    expect(norm(body(SQL)).length).toBeGreaterThan(1000);
    expect(norm(body(SQL))).toBe(norm(body(VT40)));
  });
});

describe("faint ladder client", () => {
  it("ladder and texts", () => {
    expect([1, 2, 3, 4, 5, 9].map(faintLadderMs)).toEqual([10_000, 300_000, 900_000, 3_600_000, null, null]);
    expect([10_000, 300_000, 900_000, 3_600_000, null].map(ladderText)).toEqual(["10 giây", "5 phút", "15 phút", "1 giờ", "kiệt sức cả ngày"]);
    expect(clockText(8_200)).toBe("9 giây");
    expect(clockText(299_000)).toBe("4:59");
    expect(clockText(3_600_000)).toBe("1:00:00");
    expect(vitalsErrorMessage("exhausted")).toContain("kiệt sức");
  });
  it("parses the ladder fields", () => {
    expect(parseVitals({ hunger: 1, thirst: 2, server_now_ms: 3, faint_count: 2, next_faint_s: 900, locked_until_ms: null }))
      .toEqual({ hunger: 1, thirst: 2, faintedUntilMs: null, serverNowMs: 3, faintCount: 2, nextFaintS: 900, lockedUntilMs: null });
    expect(parseVitals({ hunger: 1, thirst: 2, server_now_ms: 3, faint_count: 5, next_faint_s: null, locked_until_ms: 99 })?.lockedUntilMs).toBe(99);
    expect(parseVitals({ hunger: 1, thirst: 2, server_now_ms: 3 })).not.toHaveProperty("faintCount");
  });
});
