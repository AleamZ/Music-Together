import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  durationText, MOTEL_MAX_AHEAD_DAYS, MOTEL_PLANS, motelErrorMessage, parseMotelState, REST_DRAIN, REST_EFFECT_TEXT, REST_HOURS, REST_STAMINA,
  REST_WALK, restActive, restWalk,
} from "@/lib/game/housing/motel";

const SQL = readFileSync("supabase/migrations/0039_motel.sql", "utf8");
const VT = readFileSync("supabase/migrations/0040_rest_vitals.sql", "utf8");
const RAIN = readFileSync("supabase/migrations/0038_rain.sql", "utf8");
/** econ v2: 0105 re-creates 0077's _stamina_rate with the rested factor ×1.2 (was ×1.5). */
const SINKS = readFileSync("supabase/migrations/0105_econ_sinks.sql", "utf8");
const PROF = readFileSync("supabase/migrations/0077_professions.sql", "utf8");

describe("v19.1 motel rules mirror 0039", () => {
  it("prices, lengths, the cap and the buff", () => {
    const night = MOTEL_PLANS.find((p) => p.id === "night")!, month = MOTEL_PLANS.find((p) => p.id === "month")!;
    expect(SINKS).toContain(`when 'night' then ${night.price} when 'month' then ${month.price} end`);   // econ v2 (0105)
    expect(SQL).toContain("when 'night' then 100 when 'month' then 2000 end");                          // v19.1's
    expect(SQL).toContain(`when 'night' then interval '${night.hours} hours' when 'month' then interval '${month.hours / 24} days'`);
    expect(SQL).toContain(`now() + interval '${MOTEL_MAX_AHEAD_DAYS} days'`);
    expect(SQL).toContain(`then ${REST_DRAIN} else 1 end`);
    expect(SQL).toContain(`buff_until = now() + interval '${REST_HOURS} hours'`);
    expect(REST_WALK).toBe(1.07);
  });
  it("the rested stamina regen is 0105's ×1.2", () => {
    const rest = (s: string) => {
      const from = s.lastIndexOf("create or replace function public._stamina_rate(");
      return s.slice(from, s.indexOf("$$;", s.indexOf("as $$", from) + 5));
    };
    expect(rest(SINKS)).toContain(`when public._rest_factor(p_account) < 1 then ${REST_STAMINA} else 1 end`);
    expect(rest(PROF)).toContain("when public._rest_factor(p_account) < 1 then 1.5 else 1 end");
    expect(REST_EFFECT_TEXT).toBe("đói và khát chậm hơn 30 %, đi nhanh hơn 7 %, thể lực hồi nhanh hơn 20 %");
  });
  it("the ledger keeps 0038's reasons and adds motel", () => {
    const reasons = (s: string) => {
      const from = s.lastIndexOf("check (reason in (");
      return [...s.slice(from, s.indexOf("));", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(reasons(SQL)).toEqual([...reasons(RAIN), "motel"]);
  });
  it("0040's vitals_tick is 0038's plus the v19.1 lines", () => {
    const body = (s: string) => s.slice(s.indexOf("create or replace function public.vitals_tick"), s.indexOf("grant execute on function public.vitals_tick"));
    const norm = (s: string) => s.split("\n").filter((l) => !l.includes("v19.1")).map((l) => l.replace(/--.*$/, "")).join("").replace(/[\s,();]/g, "");
    expect(norm(body(VT))).toBe(norm(body(RAIN)));
    expect(VT).toContain("v_rest numeric := public._rest_factor(v_account);");
    expect(VT.match(/\* v_rest[,)]/g)).toHaveLength(2);
  });
});

describe("motel client", () => {
  it("parses the state", () => {
    expect(parseMotelState(null)).toBeNull();
    expect(parseMotelState({ stay: { plan: "month", until_ms: 5000 }, rest: { buff_until_ms: 9000, slept_today: true }, server_now_ms: 1000, coins: 12 }))
      .toEqual({ stay: { plan: "month", untilMs: 5000 }, rest: { buffUntilMs: 9000, sleptToday: true }, serverNowMs: 1000, coins: 12 });
    expect(parseMotelState({ stay: { plan: "week", until_ms: 5 }, rest: null, server_now_ms: 1 }))
      .toEqual({ stay: null, rest: { buffUntilMs: null, sleptToday: false }, serverNowMs: 1 });
  });
  it("the buff and its walk factor", () => {
    const s = parseMotelState({ stay: null, rest: { buff_until_ms: 10_000 }, server_now_ms: 0 })!;
    expect(restActive(s, 9_000)).toBe(true);
    expect(restActive(s, 9_000, 2_000)).toBe(false);
    expect(restActive(null, 0)).toBe(false);
    expect([restWalk(true), restWalk(false)]).toEqual([1.07, 1]);
  });
  it("texts", () => {
    expect(durationText(3 * 3600_000 + 5 * 60_000)).toBe("3 giờ 5 phút");
    expect(durationText(12 * 86400_000)).toBe("12 ngày");
    expect(durationText(-5)).toBe("0 phút");
    expect(motelErrorMessage("already slept")).toContain("ngủ rồi");
    expect(motelErrorMessage("insufficient funds")).toContain("Không đủ xu");
  });
});
