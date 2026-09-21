import { describe, it, expect } from "vitest";
import { checkQueueRules, countMyOrders, normalizeForMatch, orderLimitViolation, ordersRemaining, ruleMessage, violationFromRpcError } from "@/lib/queue-rules";

const rules = (max: number, kws: string[] = [], maxOrders = 5) => ({ max_duration_seconds: max, banned_keywords: kws, max_orders_per_member: maxOrders });

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

describe("countMyOrders", () => {
  const q = [
    { id: "a", added_by_account_id: "me" },
    { id: "b", added_by_account_id: "me" },
    { id: "c", added_by_account_id: "other" },
    { id: "d", added_by_account_id: null },
    { id: "e", added_by_account_id: "me" },
  ];
  it("counts my rows regardless of status and excludes the playing one", () => {
    expect(countMyOrders(q, "me", null)).toBe(3);
    expect(countMyOrders(q, "me", "a")).toBe(2);
    expect(countMyOrders(q, "me", "c")).toBe(3);
  });
  it("returns 0 for an unknown or null account", () => {
    expect(countMyOrders(q, "nobody", null)).toBe(0);
    expect(countMyOrders(q, null, null)).toBe(0);
  });
});

describe("ordersRemaining / orderLimitViolation", () => {
  it("null when unlimited (0) or exempt; otherwise limit - mine clamped at 0", () => {
    expect(ordersRemaining(rules(0, [], 0), 3, false)).toBeNull();
    expect(ordersRemaining(rules(0, [], 5), 99, true)).toBeNull();
    expect(ordersRemaining(rules(0, [], 5), 3, false)).toBe(2);
    expect(ordersRemaining(rules(0, [], 5), 5, false)).toBe(0);
    expect(ordersRemaining(rules(0, [], 5), 7, false)).toBe(0);
  });
  it("violates only when no slot is left", () => {
    expect(orderLimitViolation(rules(0, [], 5), 4, false)).toBeNull();
    expect(orderLimitViolation(rules(0, [], 5), 5, false)).toEqual({ code: "order_limit", max: 5 });
    expect(orderLimitViolation(rules(0, [], 5), 5, true)).toBeNull();
    expect(orderLimitViolation(rules(0, [], 0), 50, false)).toBeNull();
  });
});

describe("order limit copy + RPC mapping", () => {
  it("renders the message and maps 'order limit reached'", () => {
    expect(ruleMessage({ code: "order_limit", max: 5 })).toBe("Bạn đã đặt đủ 5 bài — chờ bài phát xong rồi đặt tiếp.");
    expect(violationFromRpcError({ code: "23514", message: "order limit reached" }, rules(0, [], 3))).toEqual({ code: "order_limit", max: 3 });
  });
});
