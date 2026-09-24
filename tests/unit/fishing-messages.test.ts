import { describe, it, expect } from "vitest";
import { blockerText, dailyText, digText, digWaitText, promptText, saleText } from "@/lib/game/fishing/messages";
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
    expect(blockerText("cast_limit", 25)).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 25 phút).");
    expect(blockerText("cast_limit", 0)).toBe("Câu nhiều quá rồi, nghỉ tay chút nhé (còn 1 phút).");
  });
});

describe("promptText", () => {
  it("counts down the dig cooldown on dig spots", () => {
    const dig = it_("dig_spot", "Đào trùn");
    expect(promptText(dig, S, NOW)).toBe("Đào trùn");
    expect(promptText(dig, withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), NOW)).toBe("Đào trùn (còn 13 giây)");
    expect(promptText(dig, withS({ digReadyAt: "2026-09-24T10:30:12.200Z" }), null)).toBe("Đào trùn");
  });
  it("tells a capped angler how long to rest", () => {
    const spot = it_("fish_spot", "Quăng cần");
    expect(promptText(spot, S, NOW)).toBe("Quăng cần");
    expect(promptText(spot, withS({ castsLeft: 0 }), NOW)).toBe("Nghỉ tay — còn 30 phút");
  });
  it("leaves other prompts and an unknown state alone", () => {
    expect(promptText(it_("depot", "Bán cá · cô Ba"), S, NOW)).toBe("Bán cá · cô Ba");
    expect(promptText(it_("dig_spot", "Đào trùn"), null, NOW)).toBe("Đào trùn");
  });
});
