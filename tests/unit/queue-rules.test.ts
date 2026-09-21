import { describe, it, expect } from "vitest";
import { checkQueueRules, normalizeForMatch, ruleMessage, violationFromRpcError } from "@/lib/queue-rules";

const rules = (max: number, kws: string[] = []) => ({ max_duration_seconds: max, banned_keywords: kws });

describe("normalizeForMatch", () => {
  it("lower-cases and strips Vietnamese diacritics, including đ", () => {
    expect(normalizeForMatch("Nhạc Chế")).toBe("nhac che");
    expect(normalizeForMatch("ĐÀM VĨNH HƯNG")).toBe("dam vinh hung");
    expect(normalizeForMatch("  Karaoke ")).toBe("  karaoke ");
  });
});

describe("checkQueueRules", () => {
  it("rejects videos over the limit, allows the boundary", () => {
    expect(checkQueueRules(rules(600), { title: "x", durationSeconds: 601 })).toEqual({ code: "too_long", maxSeconds: 600 });
    expect(checkQueueRules(rules(600), { title: "x", durationSeconds: 600 })).toBeNull();
  });
  it("rejects unknown durations only while a limit is set", () => {
    expect(checkQueueRules(rules(600), { title: "x", durationSeconds: null })).toEqual({ code: "unknown_duration", maxSeconds: 600 });
    expect(checkQueueRules(rules(0), { title: "x", durationSeconds: null })).toBeNull();
    expect(checkQueueRules(rules(0), { title: "x", durationSeconds: 99999 })).toBeNull();
  });
  it("matches banned keywords case- and accent-insensitively and reports the first configured match", () => {
    expect(checkQueueRules(rules(0, ["karaoke", "nhạc chế"]), { title: "NHAC CHE Karaoke 2026", durationSeconds: 10 }))
      .toEqual({ code: "banned", keyword: "karaoke" });
    expect(checkQueueRules(rules(0, ["Nhạc Chế"]), { title: "nhac che hay", durationSeconds: 10 })).toEqual({ code: "banned", keyword: "Nhạc Chế" });
    expect(checkQueueRules(rules(0, [" ", ""]), { title: "anything", durationSeconds: 10 })).toBeNull();
    expect(checkQueueRules(rules(0, ["remix"]), { title: "Original", durationSeconds: 10 })).toBeNull();
  });
  it("checks duration before keywords (same order as SQL)", () => {
    expect(checkQueueRules(rules(60, ["x"]), { title: "x", durationSeconds: 61 })?.code).toBe("too_long");
  });
});

describe("ruleMessage", () => {
  it("renders the Vietnamese copy with minutes", () => {
    expect(ruleMessage({ code: "too_long", maxSeconds: 600 })).toBe("Video dài hơn giới hạn 10 phút của phòng.");
    expect(ruleMessage({ code: "unknown_duration", maxSeconds: 90 })).toBe("Không xác định được thời lượng — phòng đang giới hạn 2 phút.");
    expect(ruleMessage({ code: "banned", keyword: "karaoke" })).toBe('Tiêu đề chứa từ khóa bị cấm: "karaoke".');
  });
});

describe("violationFromRpcError", () => {
  it("maps the three 23514 messages and ignores everything else", () => {
    expect(violationFromRpcError({ code: "23514", message: "video too long" }, rules(600))).toEqual({ code: "too_long", maxSeconds: 600 });
    expect(violationFromRpcError({ code: "23514", message: "duration unknown" }, rules(600))).toEqual({ code: "unknown_duration", maxSeconds: 600 });
    expect(violationFromRpcError({ code: "23514", message: "banned keyword: nhạc chế" }, rules(0))).toEqual({ code: "banned", keyword: "nhạc chế" });
    expect(violationFromRpcError({ code: "42501", message: "admin or dj role required" }, rules(0))).toBeNull();
    expect(violationFromRpcError(new Error("network"), rules(0))).toBeNull();
    expect(violationFromRpcError(null, rules(0))).toBeNull();
  });
});
