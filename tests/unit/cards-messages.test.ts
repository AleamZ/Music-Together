import { describe, it, expect } from "vitest";
import { AnticheatError } from "@/lib/anticheat";
import { cardsOf } from "@/lib/game/cards/deck";
import {
  CARDS_NOT_OPEN, cardErrorMessage, hallLabel, holdLine, placeBadge, seatChipText, signedXu, stakeLine, statusLine, thoiName,
  tlResultLines, turnToast,
} from "@/lib/game/cards/messages";

describe("cardErrorMessage (spec §11.5): every error in Vietnamese", () => {
  const TABLE: Array<[string, string]> = [
    ["invalid game", "Bàn bài không hợp lệ."],
    ["invalid seat", "Ghế không hợp lệ."],
    ["invalid stake", "Mức cược của bàn không hợp lệ."],
    ["invalid quantity", "Số xu không hợp lệ."],
    ["invalid cards", "Lá bài không hợp lệ."],
    ["invalid bet", "Số tiền cược không hợp lệ."],
    ["stale", "Bàn vừa thay đổi — xem lại nhé."],
    ["not seated", "Bạn chưa ngồi bàn này."],
    ["already seated", "Bạn đang ngồi một bàn khác trong phòng."],
    ["still leaving", "Ván bạn vừa rời chưa xong — hết ván đó bạn mới ngồi lại được."],
    ["table full", "Bàn đã đủ người."],
    ["seat taken", "Ghế này có người rồi."],
    ["stake changed", "Mức cược vừa đổi — xem lại nhé."],
    ["not enough coins", "Không đủ xu."],
    ["not your turn", "Chưa tới lượt bạn."],
    ["invalid play", "Bộ bài không hợp lệ."],
    ["cannot beat", "Bài này không chặn được."],
    ["must play", "Bạn đang mở vòng — phải đánh."],
    ["cannot raise", "Chưa được tố thêm — chỉ theo hoặc úp."],
    ["hand running", "Đang có ván — chờ hết ván nhé."],
    ["too many chips", "Trên bàn tối đa 200 lần mù lớn."],
    ["not dealer", "Chỉ nhà cái được chia bài."],
    ["dealer busy", "Nhà cái chờ lật bài xong rồi hãy rời bàn."],
    ["wrong phase", "Chưa tới lúc làm việc này."],
    ["invalid session", "Phiên đăng nhập đã hết hạn — hãy đăng nhập lại."],
    ["account banned", "Tài khoản đã bị khoá."],
    ["account is not a member of this room", "Bạn không còn ở trong phòng này."],
    ["something odd", "Có lỗi, thử lại nhé."],
  ];
  for (const [code, text] of TABLE) {
    it(code, () => expect(cardErrorMessage({ message: code })).toBe(text));
  }
  it("must include names the card", () => {
    expect(cardErrorMessage({ message: "must include" }, cardsOf(["3C"])[0])).toBe("Ván đầu phải đánh kèm lá 3♣.");
    expect(cardErrorMessage({ message: "must include" })).toBe("Ván đầu phải đánh kèm lá 3♠.");
  });
  it("the lock, a strike-0 envelope's refusal and a missing RPC", () => {
    expect(cardErrorMessage({ message: "account locked", details: "90" })).toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 1 phút 30 giây.");
    const env = new AnticheatError({ code: "bad_move", strike: 0, error: "cannot beat", lockedUntil: null, banned: false, serverNow: null });
    expect(cardErrorMessage(env)).toBe("Bài này không chặn được.");
    expect(cardErrorMessage({ code: "PGRST202", message: "Could not find the function public.card_state" })).toBe(CARDS_NOT_OPEN);
    expect(CARDS_NOT_OPEN).toBe("Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017.");
    expect(cardErrorMessage(null)).toBe("Có lỗi, thử lại nhé.");
  });
});

describe("the table's texts (spec §5, §13)", () => {
  it("stakes, labels and lines", () => {
    expect(stakeLine("tienlen", 1000)).toBe("Mức cược 1.000 xu");
    expect(stakeLine("poker", 1000)).toBe("Mù 500/1.000");
    expect(hallLabel({ game: "tienlen", stake: 1000, phase: "playing", max: 4, seats: [{ seat: 1, id: "a", name: "A" }, { seat: 2, id: "b", name: "B" }] }))
      .toBe("Tiến lên · 2/4 · 1.000");
    expect(hallLabel({ game: "poker", stake: 1000, phase: "playing", max: 6,
      seats: [1, 2, 3, 4, 5].map((s) => ({ seat: s, id: String(s), name: String(s) })) })).toBe("Poker · 5/6 · 500/1.000");
    expect(hallLabel({ game: "cao", stake: null, phase: "idle", max: 6, seats: [] })).toBe("Trống");
    expect(holdLine("tienlen", 1000)).toBe("Mỗi ván giữ tạm 10.000 để trả thua — hết ván trả lại phần dư.");
    expect(holdLine("cao", 1000)).toBe("Mỗi ván giữ tạm 1.000; khi làm cái giữ 1.000 × số nhà con.");
    expect([signedXu(1000), signedXu(-2500), signedXu(0)]).toEqual(["+1.000", "−2.500", "0"]);
  });

  it("the status line and the HUD chip", () => {
    expect(statusLine("idle", 1, 0, null)).toBe("Chờ người chơi (cần ít nhất 2)");
    expect(statusLine("countdown", 2, 7, null)).toBe("Ván mới sau 7 giây");
    expect(statusLine("playing", 3, 14, { mine: true, name: "An" })).toBe("Đến lượt bạn! 14s");
    expect(statusLine("playing", 3, 9, { mine: false, name: "Bình" })).toBe("Lượt Bình · 9s");
    expect(statusLine("peek", 3, 4, null)).toBe("Lật bài sau 4 giây");
    expect(seatChipText("tienlen", "turn", 14)).toBe("🃏 Tiến lên · Đến lượt bạn! 14s");
    expect(seatChipText("poker", "playing", 0)).toBe("🃏 Poker · Đang chơi");
    expect(seatChipText("cao", "waiting", 0)).toBe("🃏 Cào · Chờ ván mới");
    expect(turnToast("cao")).toBe("🃏 Đến lượt bạn ở bàn Cào!");
  });

  it("places and the result lines", () => {
    expect([placeBadge(1, 4), placeBadge(2, 4), placeBadge(3, 4), placeBadge(4, 4), placeBadge(3, 3), placeBadge(2, 2)])
      .toEqual(["Về nhất", "Về nhì", "Về ba", "Về bét", "Về bét", "Về bét"]);
    expect(thoiName(cardsOf(["2S", "5D"]))).toBe("Thối heo");
    expect(thoiName(cardsOf(["9S", "9C", "9D", "9H"]))).toBe("Thối hàng");
    const name = (s: number) => "ABCD"[s - 1];
    expect(tlResultLines({ trang: null, hands: { 4: cardsOf(["2S"]) }, lines: [
      { from: 4, to: 2, xu: 1000, paid: 1000, why: "forfeit" }, { from: 4, to: 3, xu: 1000, paid: 1000, why: "forfeit" },
      { from: 4, to: 2, xu: 500, paid: 500, why: "thoi" }, { from: 4, to: 1, xu: 5000, paid: 5000, why: "cong" },
    ] }, name)).toEqual(["Xử thua: D trả mỗi người 1.000", "Thối heo: D trả B 500", "Cóng: D trả A 5.000"]);
    expect(tlResultLines({ trang: { pattern: "sau_doi" }, hands: {}, lines: [{ from: 1, to: 3, xu: 2000, paid: 2000, why: "trang" }] }, name))
      .toEqual(["Tới trắng: 6 đôi", "Tới trắng: A trả C 2.000"]);
  });
});
