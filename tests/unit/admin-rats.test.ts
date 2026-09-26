import { describe, it, expect } from "vitest";
import { CODE_LABEL, holdingsLine } from "@/components/admin/AnticheatTab";
import { reasonText } from "@/lib/anticheat";
import type { AnticheatHoldings } from "@/lib/admin";

describe("the admin tab, v17 (anti-cheat §12.5)", () => {
  it("names rat_daily_cap, which the player sees as the generic reason", () => {
    expect(CODE_LABEL.rat_daily_cap).toBe("Chạm 24 con chuột/ngày");
    expect(reasonText("rat_daily_cap")).toBe("Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.");
  });

  it("counts the rat bag and names the dog in a wipe's preview", () => {
    const h: AnticheatHoldings = {
      wallet: { coins: 100 }, inventory: [], fish: [], personal_bests: [], rice: [], plots: [], leases: [], offers: [], crops: [],
      drying: [], announcements: 0,
    };
    // before 0019: neither
    expect(holdingsLine(h)).not.toMatch(/chuột|chó/);
    const line = holdingsLine({ ...h, critters: [], rats: { count: 3, value: 486 }, dog: { name: "Mực" } });
    expect(line).toContain("0 con cua ốc · 3 con chuột · chó Mực · 0 thửa sở hữu");
    expect(holdingsLine({ ...h, rats: { count: 0, value: 0 }, dog: null })).toContain("0 con chuột · 0 thửa sở hữu");
  });
});
