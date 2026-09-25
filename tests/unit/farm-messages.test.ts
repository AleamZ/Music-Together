import { describe, it, expect } from "vitest";
import {
  boughtText, durationText, farmErrorMessage, harvestText, isMissingRpc, PEST_NAME, PEST_REMEDY, PHASE_NAME, riceSaleText, riceSummary,
} from "@/lib/game/farm/messages";
import { AnticheatError } from "@/lib/anticheat";

describe("farmErrorMessage", () => {
  it("maps the server's errors to the spec's Vietnamese (§11.7)", () => {
    const m = (message: string, item?: string) => farmErrorMessage({ message }, item);
    expect(m("not your plot")).toBe("Thửa này không phải của bạn.");
    expect(m("plot taken")).toBe("Thửa này đã có người canh tác.");
    expect(m("farm limit")).toBe("Bạn đang canh tác 2 thửa rồi.");
    expect(m("already own land")).toBe("Bạn đã có đất tư trong phòng này.");
    expect(m("not for sale")).toBe("Thửa này không rao bán.");
    expect(m("price changed")).toBe("Giá vừa đổi — xem lại nhé.");
    expect([m("offer expired"), m("offer not found")]).toEqual(["Đề nghị không còn nữa.", "Đề nghị không còn nữa."]);
    expect(m("crop exists")).toBe("Đang có lúa trên thửa — gặt hoặc bỏ vụ trước.");
    expect(m("leased")).toBe("Thửa đang cho thuê.");
    expect(m("wrong phase")).toBe("Chưa tới lúc làm việc này.");
    expect(m("not prepared")).toBe("Làm đất trước đã.");
    expect(m("need water")).toBe("Mực nước chưa đúng — xem Sổ tay.");
    expect(m("no item", "Phân kali")).toBe("Chưa có Phân kali — ghé tiệm anh Hai.");
    expect(m("drying full")).toBe("Sân phơi đã đầy.");
    expect(m("drying limit")).toBe("Bạn đang phơi 2 mẻ rồi — thu lúa trước nhé.");
    expect(m("not ready")).toBe("Chưa xong.");
    expect(m("not enough rice")).toBe("Không đủ lúa.");
    expect(m("not enough coins")).toBe("Không đủ xu.");
    expect([m("invalid quantity"), m("invalid price")]).toEqual(["Số không hợp lệ.", "Số không hợp lệ."]);
    expect(m("too fast")).toBe("Từ từ thôi…");
    expect(m("account is not a member of this room")).toBe("Bạn không còn ở trong phòng này.");
    expect(m("invalid session")).toBe("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
    expect(m("boom")).toBe("Có lỗi, thử lại nhé.");
    expect(farmErrorMessage(new TypeError("Failed to fetch"))).toBe("Có lỗi, thử lại nhé.");
  });
  it("tells a locked account how long the lock runs, and reads a strike-0 envelope as its refusal (anti-cheat §13)", () => {
    expect(farmErrorMessage({ message: "account locked", details: "125", hint: "anticheat" }))
      .toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 2 phút 5 giây.");
    const info = { code: "bad_price", strike: 0 as const, error: "invalid price", lockedUntil: null, banned: false, serverNow: null };
    expect(farmErrorMessage(new AnticheatError(info))).toBe("Số không hợp lệ.");
    expect(farmErrorMessage({ message: "account banned" })).toBe("Tài khoản đã bị khoá.");
  });
  it("recognises a database without the v15 functions", () => {
    expect(isMissingRpc({ code: "PGRST202", message: "Could not find the function public.field_state in the schema cache" })).toBe(true);
    expect(isMissingRpc({ code: "42883", message: "function public.field_state(uuid, text) does not exist" })).toBe(true);
    expect(isMissingRpc({ code: "22023", message: "farm limit" })).toBe(false);
  });
});

describe("names and texts", () => {
  it("names every phase and pest, and knows each pest's remedy", () => {
    expect(Object.keys(PHASE_NAME)).toHaveLength(10);
    expect(PEST_NAME.hopper).toBe("Rầy nâu");
    expect(PEST_REMEDY).toEqual({
      snail: null, leaf_folder: "spray_insect", hopper: "spray_hopper", leaf_blast: "spray_fungus", neck_blast: "spray_fungus",
    });
  });
  it("counts down in minutes, hours or days, rounding up", () => {
    expect(durationText(10_000)).toBe("1 phút");
    expect(durationText(45 * 60_000)).toBe("45 phút");
    expect(durationText(3 * 3_600_000)).toBe("3 giờ");
    expect(durationText(3.2 * 3_600_000)).toBe("4 giờ");
    expect(durationText(53 * 3_600_000)).toBe("2 ngày 5 giờ");
    expect(durationText(48 * 3_600_000)).toBe("2 ngày");
  });
  it("tells the harvest", () => {
    expect(harvestText(70, "Nếp")).toBe("🌾 Gặt được 70 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
  });
  it("tells a purchase and a rice sale", () => {
    expect(boughtText("Phân urê", 1)).toBe("🛒 Đã mua Phân urê.");
    expect(boughtText("Giống nếp", 3)).toBe("🛒 Đã mua Giống nếp × 3.");
    expect(riceSaleText(120, "Lúa thơm", true, 3120)).toBe("💰 Bán 120 kg lúa thơm khô được 3.120 xu.");
    expect(riceSaleText(10, "Nếp", false, 126)).toBe("💰 Bán 10 kg nếp ướt được 126 xu.");
  });
  it("sums the rice for the HUD", () => {
    expect(riceSummary({})).toBe("🌾 Chưa có lúa");
    expect(riceSummary({ nep: { wet: 30, dry: 50 }, thom: { wet: 0, dry: 12 } })).toBe("🌾 62 kg khô · 30 kg ướt");
  });
});
