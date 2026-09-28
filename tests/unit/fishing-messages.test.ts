import { describe, it, expect } from "vitest";
import {
  blockerText, castRefusal, DAILY_LIMIT_TEXT, dailyText, digText, digWaitText, lostText, promptText, saleText,
} from "@/lib/game/fishing/messages";
import { parseFishingState, type FishingState } from "@/lib/game/fishing/state";
import type { Interactable } from "@/lib/game/maps/types";

const S = parseFishingState({ coins: 10, casts_left: 5, window_resets_at: "2026-09-24T11:00:00Z", dig_ready_at: null })!;
const withS = (over: Partial<FishingState>): FishingState => ({ ...S, ...over });
const it_ = (kind: Interactable["kind"], prompt: string): Interactable =>
  ({ id: "x", kind, label: "x", prompt, rect: { x: 0, y: 0, w: 1, h: 1 }, use: { x: 0, y: 0 } });
const NOW = Date.parse("2026-09-24T10:30:00Z");

describe("fishing texts", () => {
  it("words the toasts", () => {
    expect(dailyText(20)).toBe("🪙 Điểm danh hôm nay: +20 xu");
    expect(digText(3)).toBe("🪱 Đào được 3 trùn đất!");
    expect(digWaitText(32)).toBe("Đất còn cứng, chờ 32 giây nữa nhé.");
    expect(saleText(3, 1245)).toBe("Bán 3 con · +1.245 xu");
  });
  it("says why a cast cannot start, like the server does", () => {
    expect(blockerText("no_bait", 0)).toBe("Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.");
    expect(blockerText("hands_full", 0)).toBe("Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!");
    expect(blockerText("bucket_full", 0)).toBe("Xô đầy rồi — ra vựa bán bớt nhé!");
    // 0047: the caps are gone; an old server's cap errors still read harmlessly
    expect(blockerText("cast_limit", 25)).toBe("Câu mệt rồi — nghỉ chút nhé (còn 25 phút).");
    expect(blockerText("cast_limit", 0)).toBe("Câu mệt rồi — nghỉ chút rồi câu tiếp nhé!");
    expect(blockerText("daily_limit", 0)).toBe("Câu mệt rồi — nghỉ chút rồi câu tiếp nhé!");
    expect(DAILY_LIMIT_TEXT).not.toMatch(/300/);
  });
});

describe("promptText", () => {
  it("counts down the dig cooldown on dig spots", () => {
    const dig = it_("dig_spot", "Đào trùn");
    expect(promptText(dig, S, NOW)).toBe("Đào trùn");
    expect(promptText(dig, withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), NOW)).toBe("Đào trùn (còn 13 giây)");
    expect(promptText(dig, withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), null)).toBe("Đào trùn");
  });
  it("0047: shows no cap countdown on fishing spots", () => {
    const spot = it_("fish_spot", "Quăng cần");
    const capped = withS({ castsLeft: 0, castsTodayLeft: 0, dayResetsAt: "2026-09-24T17:00:00Z" });
    expect(promptText(spot, S, NOW)).toBe("Quăng cần");
    expect(promptText(spot, capped, NOW)).toBe("Quăng cần");
    expect(castRefusal({ ...capped, bait: { bait_worm: 1 } }, false, false)).toBeNull();
  });
  it("leaves other prompts and an unknown state alone", () => {
    expect(promptText(it_("depot", "Bán cá · cô Ba"), S, NOW)).toBe("Bán cá · cô Ba");
    expect(promptText(it_("dig_spot", "Đào trùn"), null, NOW)).toBe("Đào trùn");
  });
});

describe("cast texts", () => {
  it("refuses a cast in the order of the checks: state, server rules, the spot", () => {
    expect(castRefusal(null, false, false)).toBe("Đang tải giỏ đồ…");
    expect(castRefusal(null, true, false)).toBe("Chưa tải được giỏ đồ — bấm “Tải lại giỏ đồ” nhé.");
    expect(castRefusal(withS({ bait: { bait_worm: 1 } }), false, false)).toBeNull();
    expect(castRefusal(withS({ bait: {} }), false, true)).toBe("Hết mồi — đào trùn hoặc mua mồi ở tiệm nhé.");
    expect(castRefusal(withS({ bait: { bait_worm: 1 }, castsLeft: 0 }), false, false)).toBeNull();
    expect(castRefusal(withS({ bait: { bait_worm: 1 } }), false, true)).toBe("Chỗ này có người câu rồi.");
  });
  it("says why a cast ended empty", () => {
    expect(lostText("missed", "gave_up", 1)).toBe("Cá ăn mồi rồi chạy mất!");
    expect(lostText("reeled_in", "gave_up", 1)).toBe("Đã thu cần.");
    expect(lostText("reel", null, 1)).toBe("Cá đã thoát!");
    expect(lostText("reel", "too_early", 1)).toBe("Cá đã thoát!");
    expect(lostText("reel", "full", 1)).toBe("Tay đang cầm cá — ra vựa bán hoặc sắm xô nhé!");
    expect(lostText("reel", "full", 6)).toBe("Xô đầy rồi — ra vựa bán bớt nhé!");
  });
});
