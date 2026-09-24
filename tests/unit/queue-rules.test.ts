import { describe, it, expect } from "vitest";
import {
  checkQueueRules,
  countMyOrders,
  normalizeForMatch,
  orderLimitViolation,
  ordersRemaining,
  ruleMessage,
  violationFromRpcError,
  isDuplicateInQueue,
  getEffectiveHistoryCooldown,
  findRecentInHistory,
  checkDuplicateTrack,
  duplicateMessage,
  deduplicatePlaylistItems,
} from "@/lib/queue-rules";

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

describe("duplicate checking and deduplication", () => {
  const queue = [
    { youtube_video_id: "vid-1" },
    { youtube_video_id: "vid-2" },
  ];
  // 10 items in history
  const history10 = Array.from({ length: 10 }, (_, i) => ({ youtube_video_id: `vid-hist-${i}` }));

  it("calculates adaptive history cooldown based on history size", () => {
    expect(getEffectiveHistoryCooldown(0)).toBe(0);
    expect(getEffectiveHistoryCooldown(1)).toBe(1);
    expect(getEffectiveHistoryCooldown(2)).toBe(1);
    expect(getEffectiveHistoryCooldown(3)).toBe(1);
    expect(getEffectiveHistoryCooldown(4)).toBe(2);
    expect(getEffectiveHistoryCooldown(10)).toBe(5);
    expect(getEffectiveHistoryCooldown(20)).toBe(10);
    expect(getEffectiveHistoryCooldown(30)).toBe(15);
    expect(getEffectiveHistoryCooldown(40)).toBe(20);
    expect(getEffectiveHistoryCooldown(100)).toBe(20);
  });

  it("identifies duplicate in queue or currently playing", () => {
    expect(isDuplicateInQueue(queue, "vid-playing", "vid-1")).toBe(true);
    expect(isDuplicateInQueue(queue, "vid-playing", "vid-playing")).toBe(true);
    expect(isDuplicateInQueue(queue, "vid-playing", "vid-other")).toBe(false);
  });

  it("handles small history gracefully (only blocks track just finished)", () => {
    const smallHistory = [
      { youtube_video_id: "vid-recent-0" },
      { youtube_video_id: "vid-older-1" },
    ];
    // With 2 items, only index 0 is blocked
    expect(findRecentInHistory(smallHistory, "vid-recent-0")).toEqual({
      isRecent: true,
      index: 0,
      effectiveLimit: 1,
    });
    // Older item can be replayed!
    expect(findRecentInHistory(smallHistory, "vid-older-1")).toEqual({
      isRecent: false,
      index: -1,
      effectiveLimit: 1,
    });
  });

  it("finds recent track in 10-item history (blocks 5 recent, allows 5 older)", () => {
    // index 0..4 are recent
    expect(findRecentInHistory(history10, "vid-hist-0")).toEqual({ isRecent: true, index: 0, effectiveLimit: 5 });
    expect(findRecentInHistory(history10, "vid-hist-4")).toEqual({ isRecent: true, index: 4, effectiveLimit: 5 });
    // index 5..9 are older -> allowed to replay!
    expect(findRecentInHistory(history10, "vid-hist-5")).toEqual({ isRecent: false, index: -1, effectiveLimit: 5 });
  });

  it("checks duplicate track across queue, current track, and history", () => {
    expect(checkDuplicateTrack("vid-playing", queue, "vid-playing", history10, 20)).toEqual({
      duplicate: "queue",
      isCurrent: true,
    });
    expect(checkDuplicateTrack("vid-2", queue, "vid-playing", history10, 20)).toEqual({
      duplicate: "queue",
      isCurrent: false,
    });
    expect(checkDuplicateTrack("vid-hist-2", queue, "vid-playing", history10, 20)).toEqual({
      duplicate: "history",
      index: 2,
    });
    // index 8 is beyond the 5-item adaptive limit for 10 songs -> allowed
    expect(checkDuplicateTrack("vid-hist-8", queue, "vid-playing", history10, 20)).toBeNull();
    expect(checkDuplicateTrack("vid-fresh", queue, "vid-playing", history10, 20)).toBeNull();
  });

  it("generates user-friendly duplicate messages", () => {
    expect(duplicateMessage({ duplicate: "queue", isCurrent: true })).toBe("Bài này đang được phát trong phòng.");
    expect(duplicateMessage({ duplicate: "queue", isCurrent: false })).toBe("Bài này đã có trong hàng chờ.");
    expect(duplicateMessage({ duplicate: "history", index: 0 })).toContain("vừa phát xong");
    expect(duplicateMessage({ duplicate: "history", index: 2 })).toContain("3 bài trước");
  });

  it("deduplicates playlist items against itself, queue, and recent history", () => {
    const playlist = [
      { videoId: "v1", title: "Track 1" },
      { videoId: "v1", title: "Track 1 repeat" }, // internal duplicate
      { videoId: "vid-1", title: "Track in queue" }, // queue duplicate
      { videoId: "vid-playing", title: "Current track" }, // current playing duplicate
      { videoId: "vid-hist-1", title: "Recently played (< 5)" }, // history duplicate (index 1 of 10)
      { videoId: "vid-hist-7", title: "Older played (>= 5)" }, // older history item -> allowed!
      { videoId: "v2", title: "Track 2" }, // valid!
    ];

    const res = deduplicatePlaylistItems(playlist, queue, "vid-playing", history10, 20);
    expect(res.internalDuplicates).toBe(1);
    expect(res.queueDuplicates).toBe(2);
    expect(res.historyDuplicates).toBe(1); // only vid-hist-1 is in recent 5
    expect(res.validItems).toEqual([
      { videoId: "v1", title: "Track 1" },
      { videoId: "vid-hist-7", title: "Older played (>= 5)" },
      { videoId: "v2", title: "Track 2" },
    ]);
  });
});


