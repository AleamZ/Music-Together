import { describe, it, expect } from "vitest";
import {
  bedLevelsText, bedResultText, boughtText, CRAB_GAVE_UP, crabResultText, critterSaleText, crittersFullText, durationText, farmErrorMessage,
  GATHER_LIMIT_TEXT, GIFT_TEXT, harvesterDoneText, harvesterStartText, harvestText, isMissingRpc, loadedText, NOT_OPEN_152, NOT_OPEN_153,
  partsDoneText, partText, PEST_NAME, PEST_REMEDY, pestSnailText, PHASE_NAME, pickingText, produceSaleText, produceSummary, riceSaleText,
  riceSummary, uplandPhaseName,
} from "@/lib/game/farm/messages";
import { critterFromRow, uplandFromRow, type UplandCropRow } from "@/lib/game/farm/catalog";
import fixtures from "@/tests/fixtures/upland-cases.json";
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
    expect(m("crop exists")).toBe("Đang có vụ trên thửa — thu hoạch hoặc bỏ vụ trước.");
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
  it("maps the v15.2 refusals (§11.7), and reads a harvest round's in its context", () => {
    const m = (message: string, action?: string) => farmErrorMessage({ message }, undefined, action);
    expect(m("no sickle")).toBe("Chưa có liềm — mua ở tiệm anh Hai (hoặc thuê máy gặt ở Hợp tác xã).");
    expect(m("no sprayer")).toBe("Chưa có bình phun — mua ở tiệm anh Hai.");
    expect(m("harvesting")).toBe("Đang gặt dở — gặt cho xong đã.");
    expect(m("harvester busy")).toBe("Máy gặt đang gặt thửa này.");
    expect(m("work expired")).toBe("Lượt gặt đã quá lâu — bắt đầu lại nhé.");
    expect(m("lease ending")).toBe("Sắp hết hạn thuê — không kịp gặt phần này.");
    expect(m("lease ends")).toBe("Không kịp gặt xong trước khi hết hạn thuê.");
    expect(m("wrong crop")).toBe("Việc này không hợp với cây trên thửa.");
    expect(m("already owned")).toBe("Bạn đã có món này rồi.");
    expect(m("not enough crop")).toBe("Không đủ hàng để bán.");
    expect([m("invalid crop"), m("invalid act")]).toEqual(["Có lỗi, thử lại nhé.", "Có lỗi, thử lại nhé."]);
    expect([m("too fast", "harvest_part"), m("too fast")]).toEqual(["Chưa xong bó lúa — thử lại sau vài giây.", "Từ từ thôi…"]);
    expect([m("not your plot", "harvest_part"), m("not your plot")])
      .toEqual(["Hết hạn thuê — phần lúa chưa gặt đã mất.", "Thửa này không phải của bạn."]);
    expect(NOT_OPEN_152).toBe("Nông cụ và hoa màu chưa mở — chủ phòng cần chạy migration 0016.");
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
      weevil: "spray_insect", armyworm: "spray_insect", thrips: "spray_insect", anthracnose: "spray_fungus",
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

describe("v15.2 texts (§9, §13)", () => {
  const [khoai, , ot] = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  it("names the beds' water and the hoa-màu phases", () => {
    expect([bedLevelsText([1]), bedLevelsText([0, 1]), bedLevelsText([1, 2]), bedLevelsText([3])]).toEqual(["Ẩm", "Khô–Ẩm", "Ẩm–Đẫm", "Ngập"]);
    expect(["prepared", "nursery", "grow", "waiting", "ripe", "overripe"].map((p) => uplandPhaseName(ot, p))).toEqual([
      "Đã lên luống", "Đang ươm cây con", "Phát triển thân lá", "Chờ lứa sau", "Chín", "Chín quá",
    ]);
    expect(uplandPhaseName(khoai, "tuber")).toBe("Tượng củ");
  });
  it("tells the gift, the parts, the harvester, the pickings, the sale and the tank", () => {
    expect(GIFT_TEXT).toBe("🌾 Chú Tám tặng bạn 1 bao giống lúa ngắn ngày, 1 bao urê và 1 cây liềm — xem Sổ tay nhà nông nhé!");
    expect(partText(2, 13)).toBe("✅ Xong phần 2/6: 13 kg lúa.");
    expect(partsDoneText(3, 75, "Nếp")).toBe("🌾 Gặt xong thửa 3: tổng 75 kg nếp (lúa ướt) — đem phơi rồi bán cho cô Út nhé!");
    expect(harvesterStartText(3)).toBe("🚜 Máy gặt đang vào thửa 3 — 30 giây nữa xong.");
    expect(harvesterDoneText(3, 50, "Nếp")).toBe("🚜 Máy gặt gặt xong thửa 3: 50 kg nếp (lúa ướt).");
    expect(pickingText(24, "Ớt", 1, 3)).toBe("🧺 Thu hoạch 24 kg ớt (lứa 1/3) — đem bán cho cô Út nhé!");
    expect(pickingText(197, "Khoai lang", 1, 1)).toBe("🧺 Thu hoạch 197 kg khoai lang — đem bán cho cô Út nhé!");
    expect(produceSaleText(180, "Khoai lang", 47_700)).toBe("💰 Bán 180 kg khoai lang được 47.700 xu.");
    expect(loadedText("Thuốc trừ sâu")).toBe("🧴 Đã nạp thuốc trừ sâu vào bình phun — 3 lần xịt.");
  });
  it("adds the hoa màu to the HUD's line when there is any", () => {
    expect(produceSummary({ nep: { wet: 0, dry: 70 } }, {})).toBe("🌾 70 kg khô · 0 kg ướt");
    expect(produceSummary({ nep: { wet: 0, dry: 70 } }, { khoai: 180 })).toBe("🌾 70 kg khô · 0 kg ướt · 🧺 180 kg màu");
    expect(produceSummary({}, { ot: 22, bap: 8 })).toBe("🌾 Chưa có lúa · 🧺 30 kg màu");
  });
});

describe("v15.3 texts (§11.8, §13.2, §13.4)", () => {
  const KINDS = [
    critterFromRow({ id: "cua_dong", name: "Cua đồng", grp: "crab", base_price: 12, sort_order: 10 }),
    critterFromRow({ id: "cua_gach", name: "Cua gạch", grp: "crab", base_price: 45, sort_order: 20 }),
    critterFromRow({ id: "oc_dong", name: "Ốc đồng", grp: "snail", base_price: 8, sort_order: 30 }),
    critterFromRow({ id: "oc_buou_vang", name: "Ốc bươu vàng", grp: "snail", base_price: 2, sort_order: 40 }),
  ];
  const c = (kind: string, price = 1) => ({ kind, price });
  it("maps the gathering refusals, with the minutes from the details", () => {
    const m = (message: string, extra: Record<string, unknown> = {}, item?: string) => farmErrorMessage({ message, ...extra }, item);
    expect(m("hole empty", { details: "720" })).toBe("Cua chưa ra — quay lại sau 12 phút.");
    expect(m("hole empty", { details: "690" })).toBe("Cua chưa ra — quay lại sau 12 phút.");
    expect(m("bed empty", { details: "420" })).toBe("Bãi này vừa mò rồi — quay lại sau 7 phút.");
    expect(m("hole empty")).toBe("Cua chưa ra — quay lại sau ít phút.");
    expect(m("critters full", {}, "Giỏ tre")).toBe("Giỏ tre đầy rồi — ra vựa cô Út bán bớt nhé.");
    expect(m("critters full")).toBe("Tay đầy rồi — ra vựa cô Út bán hoặc sắm xô ở tiệm anh Hai.");
    expect(m("gather daily limit", { details: "3600" })).toBe("Hôm nay bạn bắt cua, mò ốc đủ 200 lượt rồi — mai quay lại nhé!");
    expect(m("visit not found")).toBe("Lượt bắt cua này đã xong.");
    expect(m("visit expired")).toBe("Lâu quá, cua chui mất rồi — lát nữa quay lại nhé.");
    expect(m("no critters")).toBe("Không có cua ốc để bán.");
    expect([m("invalid spot"), m("invalid kind")]).toEqual(["Có lỗi, thử lại nhé.", "Có lỗi, thử lại nhé."]);
    expect([crittersFullText("Xô nhựa"), GATHER_LIMIT_TEXT]).toEqual([
      "Xô nhựa đầy rồi — ra vựa cô Út bán bớt nhé.", "Hôm nay bạn bắt cua, mò ốc đủ 200 lượt rồi — mai quay lại nhé!",
    ]);
    expect(NOT_OPEN_153).toBe("Bắt cua, mò ốc chưa mở — chủ phòng cần chạy migration 0018.");
  });
  it("reads a crab finish's and a transplant's refusals in their context, and keeps the others", () => {
    const m = (message: string, action?: string) => farmErrorMessage({ message }, undefined, action);
    expect(m("too fast", "crab_finish")).toBe("Chưa bắt xong — thử lại sau vài giây.");
    expect(m("too fast", "transplant")).toBe("Chưa cấy xong hàng mạ — thử lại sau vài giây.");
    expect(m("work expired", "transplant")).toBe("Lượt cấy đã quá lâu — bắt đầu lại nhé.");
    expect(m("lease ending", "transplant")).toBe("Sắp hết hạn thuê — không kịp cấy.");
    expect(m("not your plot", "transplant")).toBe("Hết hạn thuê — mạ trên thửa đã mất.");
    expect([m("too fast"), m("work expired"), m("lease ending"), m("not your plot")]).toEqual([
      "Từ từ thôi…", "Lượt gặt đã quá lâu — bắt đầu lại nhé.", "Sắp hết hạn thuê — không kịp gặt phần này.", "Thửa này không phải của bạn.",
    ]);
  });
  it("tells a crab visit's result (§13.2)", () => {
    expect(crabResultText({ hits: 2, caught: [c("cua_dong"), c("cua_gach")], escaped: 0 }, KINDS, null))
      .toBe("🦀 Bắt được 2 con: 1 cua đồng, 1 cua gạch!");
    expect(crabResultText({ hits: 3, caught: [c("cua_dong"), c("cua_dong")], escaped: 1 }, KINDS, "Xô nhựa"))
      .toBe("🦀 Bắt được 2 con: 2 cua đồng! 1 con chạy mất vì xô nhựa đầy.");
    expect(crabResultText({ hits: 2, caught: [], escaped: 2 }, KINDS, null)).toBe("🦀 2 con chạy mất vì tay đầy.");
    expect(crabResultText({ hits: 0, caught: [], escaped: 0 }, KINDS, null)).toBe("🦀 Cua chui hết vào hang rồi — 20 phút nữa quay lại nhé.");
    expect(CRAB_GAVE_UP).toBe("Đã rút tay — hang này 20 phút nữa mới có cua lại.");
  });
  it("tells a bed, a pest-snail pick and a sale (§13.4)", () => {
    expect(bedResultText({ caught: [c("oc_dong"), c("oc_buou_vang"), c("oc_dong")], escaped: 0 }, KINDS, null))
      .toBe("🐌 Mò được 3 con ốc: 2 ốc đồng, 1 ốc bươu vàng.");
    expect(bedResultText({ caught: [c("oc_dong")], escaped: 1 }, KINDS, "Xô nhựa")).toBe("🐌 Mò được 1 con ốc: 1 ốc đồng. Thả lại 1 con vì xô nhựa đầy.");
    expect(pestSnailText(5, { caught: [c("oc_buou_vang"), c("oc_buou_vang")], escaped: 0 }, null))
      .toBe("🐌 Bắt ốc thửa 5: được 2 con ốc bươu vàng.");
    expect(pestSnailText(5, { caught: [c("oc_buou_vang")], escaped: 1 }, "Xô nhựa"))
      .toBe("🐌 Bắt ốc thửa 5: được 1 con, thả 1 con xuống mương vì xô nhựa đầy.");
    expect(pestSnailText(5, { caught: [], escaped: 2 }, "Xô nhựa")).toBe("🐌 Bắt ốc thửa 5 — xô nhựa đầy, thả 2 con xuống mương.");
    expect(pestSnailText(5, { caught: [], escaped: 2 }, null)).toBe("🐌 Bắt ốc thửa 5 — tay đầy, thả 2 con xuống mương.");
    expect(pestSnailText(5, null, null)).toBe("Đã bắt ốc bươu vàng.");
    expect(critterSaleText(6, 230)).toBe("💰 Bán 6 con cua ốc được 230 xu.");
    expect(critterSaleText(40, 1250)).toBe("💰 Bán 40 con cua ốc được 1.250 xu.");
  });
  it("adds the critters held to the HUD's line", () => {
    expect(produceSummary({ nep: { wet: 0, dry: 70 } }, { khoai: 180 }, 12)).toBe("🌾 70 kg khô · 0 kg ướt · 🧺 180 kg màu · 🦀 12");
    expect(produceSummary({}, {}, 3)).toBe("🌾 Chưa có lúa · 🦀 3");
    expect(produceSummary({}, {}, 0)).toBe("🌾 Chưa có lúa");
  });
});
