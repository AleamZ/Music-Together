import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { fightErrorMessage } from "@/lib/game/fight/messages";
import { parseDojoState, parseExamStart, parseFightState, parseKataNotes, parseKataResult, parsePushAnswer } from "@/lib/game/fight/rpc";

// the pipeline and the dojo (0050 up to its re-created fashion RPCs, whose refusals keep their own copy)
const M50 = readFileSync("supabase/migrations/0050_dojo.sql", "utf8");
const SQL = readFileSync("supabase/migrations/0049_fight_matches.sql", "utf8") + M50.slice(0, M50.indexOf("---------- E. "));

describe("fight and dojo errors in Vietnamese", () => {
  it("maps every refusal the two migrations raise", () => {
    const raised = new Set([...SQL.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]));
    expect(raised.size).toBeGreaterThanOrEqual(15);
    for (const code of raised) expect(fightErrorMessage({ message: code }), code).not.toBe("Có lỗi, thử lại sau nhé.");
    for (const code of ["too hungry", "too thirsty", "fainted", "exhausted"]) expect(fightErrorMessage(code)).not.toBe("Có lỗi, thử lại sau nhé.");
  });
  it("keeps the specific lines apart", () => {
    expect(fightErrorMessage("too hungry to fight")).toContain("≥ 10");
    expect(fightErrorMessage("too hungry")).not.toContain("≥ 10");
    expect(fightErrorMessage("no uniform")).toContain("mặc võ phục");
    expect(fightErrorMessage("uniform")).toContain("không mua");
    expect(fightErrorMessage(new Error("boom"))).toBe("Có lỗi, thử lại sau nhé.");
  });
});

describe("answers", () => {
  it("dojo_state", () => {
    const s = parseDojoState({
      styles: [], tuition: 2000, server_now_ms: 1000, wearing: "vp_judo", prev_outfit: null, uniforms: ["vp_judo", 3],
      enrollments: [{ style: "judo", rank: 2, rank_at_ms: 5, enrolled_at_ms: 1, cooldown_until_ms: null, next_exam_ms: 99 }, { bad: 1 }],
      exam: { id: "e", style: "judo", target_rank: 3, fee: 5000, kata_length: 900, status: "spar", started_at_ms: 1, expires_at_ms: 2,
        match: { id: "m", status: "live", params: { seed: 1 }, started_at_ms: 10, sim_frame: 60 } },
    });
    expect(s).toMatchObject({ wearing: "vp_judo", uniforms: ["vp_judo"], serverNowMs: 1000 });
    expect(s!.enrollments).toEqual([{ style: "judo", rank: 2, rankAtMs: 5, enrolledAtMs: 1, cooldownUntilMs: null, nextExamMs: 99 }]);
    expect(s!.exam).toMatchObject({ targetRank: 3, kataLength: 900, status: "spar", match: { id: "m", startedAtMs: 10, simFrame: 60 } });
    expect(parseDojoState({})).toBeNull();
  });
  it("exam start, kata, push and state", () => {
    expect(parseExamStart({ exam_id: "e", kata_length: "990", chart: [180, 3, 220, 5], notes: 18, ticks_per_beat: 40, half: false,
      pass_pct: 60, server_now_ms: 1 }))
      .toMatchObject({ examId: "e", kataLength: 990, chart: [180, 3, 220, 5], notes: 18, tpb: 40, passPct: 60 });
    expect(parseExamStart({ exam_id: "e", kata_seed: 1, server_now_ms: 1 })).toBeNull();          // 0060: no seed, no length
    expect(parseKataNotes({ status: "kata", chart: [180, 3], upto: 420, length: 990, total: 18, server_now_ms: 2 }))
      .toEqual({ status: "kata", chart: [180, 3], upto: 420, length: 990, total: 18, serverNowMs: 2 });
    expect(parseKataNotes({ status: "failed", server_now_ms: 2 })).toMatchObject({ status: "failed", chart: [] });
    const k = parseKataResult({ passed: true, score: [36, 18, 0, 0, 0, 0], max: 36, pass_pct: 60, server_now_ms: 5,
      match: { id: "m", params: { seed: 1 }, started_at_ms: 8005 } });
    expect(k).toMatchObject({ passed: true, match: { id: "m", startedAtMs: 8005 }, anticheat: null });
    expect(parseKataResult({ passed: false, server_now_ms: 5, anticheat: { code: "kata_too_fast", strike: 0 } })!.anticheat)
      .toEqual({ code: "kata_too_fast", strike: 0, banned: false });
    const p = parsePushAnswer({ status: "done", side: 1, sim_frame: 1818, frontiers: [1817, null], resync: false, server_now_ms: 9,
      result: { winner: 1, end_reason: "ko", rounds: [{ reason: 1, winner: 1, hp1: 500, hp2: 0, frame: 900 }], rounds_played: 2,
        vitals: { hunger: 4, thirst: 6 }, exam: { passed: true, style: "vovinam", rank: 1, belt: "Lam đai" } } });
    expect(p!.sim).toBeUndefined();
    expect(parsePushAnswer({ status: "live", side: 1, sim_frame: 60, frontiers: [59, null], server_now_ms: 9, sim: [0, 1, 2] })!.sim)
      .toEqual([0, 1, 2]);                                                                         // 0060: a secret match's sim
    expect(p).toMatchObject({ status: "done", frontier: 1817, result: { winner: 1, vitals: { hunger: 4, thirst: 6 }, exam: { belt: "Lam đai" } } });
    const st = parseFightState({ status: "live", side: 1, sim_frame: 60, frontiers: [59, null], server_now_ms: 1, params: { seed: 1 },
      started_at_ms: 100, runs: [0, 60], sim: [1, 2] });
    expect(st).toMatchObject({ startedAtMs: 100, runs: [0, 60], sim: [1, 2], simFrame: 60 });
  });
});
