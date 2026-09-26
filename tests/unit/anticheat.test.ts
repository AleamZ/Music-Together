import { afterEach, describe, it, expect, vi } from "vitest";
import { clockOffset, syncClock } from "@/lib/game/farm/clock";
import {
  AnticheatError, BAN_BODY, BAN_OK, BAN_TITLE, BAN_WIPE, chipLabel, chipText, durationVi, lockSeconds, lockText,
  parseAnticheat, reasonText, reportAnticheat, reportLock, screenAnswer, subscribeAnticheat, WARN_BODY, WARN_LOCK, WARN_OK,
  WARN_REPEAT, WARN_TITLE, type AnticheatEvent,
} from "@/lib/anticheat";

const ENVELOPE = {
  anticheat: {
    code: "bad_plot", strike: 1, error: "invalid plot", locked_until: "2026-10-02T10:20:00.000+00:00", banned: false,
    server_now: "2026-10-02T10:15:00.000+00:00",
  },
};

afterEach(() => {
  syncClock(0, 0);
  vi.useRealTimers();
});

describe("parseAnticheat", () => {
  it("reads the envelope of a flagged answer", () => {
    expect(parseAnticheat(ENVELOPE)).toEqual({
      code: "bad_plot", strike: 1, error: "invalid plot", lockedUntil: Date.parse("2026-10-02T10:20:00Z"), banned: false,
      serverNow: Date.parse("2026-10-02T10:15:00Z"),
    });
    const lost = {
      result: "lost", why: "too_early", state: {},
      anticheat: { code: "reel_too_fast", strike: 2, error: null, locked_until: null, banned: true, server_now: "2026-10-02T10:15:00.123456+00:00" },
    };
    expect(parseAnticheat(lost)).toEqual({
      code: "reel_too_fast", strike: 2, error: null, lockedUntil: null, banned: true, serverNow: Date.parse("2026-10-02T10:15:00.123Z"),
    });
  });

  it("fills what a strike-0 envelope leaves out", () => {
    expect(parseAnticheat({ anticheat: { code: "bad_qty", strike: 0 } })).toEqual({
      code: "bad_qty", strike: 0, error: null, lockedUntil: null, banned: false, serverNow: null,
    });
  });

  it("is null without an envelope, or with one it cannot read", () => {
    expect(parseAnticheat(null)).toBeNull();
    expect(parseAnticheat("anticheat")).toBeNull();
    expect(parseAnticheat({ state: {} })).toBeNull();
    expect(parseAnticheat({ anticheat: null })).toBeNull();
    expect(parseAnticheat({ anticheat: "bad_plot" })).toBeNull();
    expect(parseAnticheat({ anticheat: { code: "bad_plot", strike: 3 } })).toBeNull();
    expect(parseAnticheat({ anticheat: { code: "bad_plot", strike: "1" } })).toBeNull();
    expect(parseAnticheat({ anticheat: { code: 7, strike: 0 } })).toBeNull();
  });
});

describe("AnticheatError", () => {
  it("carries the envelope, with the refusal it stands for as its message", () => {
    const info = parseAnticheat(ENVELOPE)!;
    const e = new AnticheatError(info);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe("AnticheatError");
    expect(e.message).toBe("invalid plot");
    expect(e.info).toBe(info);
    expect(new AnticheatError({ ...info, error: null }).message).toBe("anticheat");
  });
});

describe("lockSeconds", () => {
  it("reads the seconds of an account locked refusal", () => {
    expect(lockSeconds({ message: "account locked", details: "125", hint: "anticheat" })).toBe(125);
    expect(lockSeconds({ message: "account locked", details: 7 })).toBe(7);
  });
  it("is null for any other error, or without readable seconds", () => {
    expect(lockSeconds({ message: "account locked", details: null })).toBeNull();
    expect(lockSeconds({ message: "account locked", details: "" })).toBeNull();
    expect(lockSeconds({ message: "account locked", details: "soon" })).toBeNull();
    expect(lockSeconds({ message: "cast limit", details: "300" })).toBeNull();
    expect(lockSeconds(new Error("account locked"))).toBeNull();
    expect(lockSeconds(null)).toBeNull();
  });
});

describe("the Vietnamese texts (spec §12.2)", () => {
  it("says a duration in minutes and seconds, at least one second", () => {
    expect(durationVi(0.2)).toBe("1 giây");
    expect(durationVi(0)).toBe("1 giây");
    expect(durationVi(59)).toBe("59 giây");
    expect(durationVi(59.5)).toBe("1 phút");
    expect(durationVi(60)).toBe("1 phút");
    expect(durationVi(125)).toBe("2 phút 5 giây");
    expect(durationVi(300)).toBe("5 phút");
  });

  it("builds the lock toast, the chip and its label", () => {
    expect(lockText(125)).toBe("🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn 2 phút 5 giây.");
    expect(chipText(247)).toBe("🔒 4:07");
    expect(chipText(300)).toBe("🔒 5:00");
    expect(chipText(4.2)).toBe("🔒 0:05");
    expect(chipLabel(247)).toBe("Tạm khoá trò chơi — còn 4 phút 7 giây");
    expect(chipLabel(60)).toBe("Tạm khoá trò chơi — còn 1 phút");
  });

  it("gives a reason for every signal", () => {
    expect(reasonText("reel_too_fast")).toBe("Báo kéo được cá nhanh hơn mức trò chơi cho phép.");
    expect(reasonText("quality_range")).toBe("Gửi điểm cấy/gặt ngoài phạm vi của trò chơi.");
    for (const code of ["bad_plot", "bad_slot", "bad_water", "bad_work", "bad_qty", "bad_price", "foreign_offer",
      "kind_mismatch", "reel_gate_hug", "cast_daily_cap", "bad_spot", "gather_daily_cap", "something_new"]) {
      expect(reasonText(code)).toBe("Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.");
    }
  });

  it("keeps the modal texts verbatim", () => {
    expect(WARN_TITLE).toBe("⚠️ Cảnh báo gian lận");
    expect(WARN_BODY).toBe("Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).");
    expect(WARN_LOCK).toBe("Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.");
    expect(WARN_REPEAT).toBe("Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.");
    expect(WARN_OK).toBe("Tôi đã hiểu");
    expect(BAN_TITLE).toBe("🚫 Tài khoản bị khoá vĩnh viễn");
    expect(BAN_BODY).toBe("Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.");
    expect(BAN_WIPE).toBe("Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất).");
    expect(BAN_OK).toBe("Đăng xuất");
  });
});

describe("the event hub", () => {
  it("tells every listener about strikes and locks until it unsubscribes", () => {
    const a: AnticheatEvent[] = [];
    const b: AnticheatEvent[] = [];
    const offA = subscribeAnticheat((e) => a.push(e));
    const offB = subscribeAnticheat((e) => b.push(e));
    const info = parseAnticheat(ENVELOPE)!;
    reportAnticheat(info);
    reportLock(1234, "reel_too_fast");
    offA();
    reportLock(5678, null);
    offB();
    reportLock(9, null);
    expect(a).toEqual([{ kind: "strike", info }, { kind: "lock", until: 1234, code: "reel_too_fast" }]);
    expect(b).toEqual([...a, { kind: "lock", until: 5678, code: null }]);
  });
});

describe("screenAnswer", () => {
  it("sets the server clock from an envelope and reports a strike", () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T10:14:00Z")); // this client runs a minute behind the server
    const info = screenAnswer(ENVELOPE, null);
    expect(info).toMatchObject({ code: "bad_plot", strike: 1, error: "invalid plot" });
    expect(clockOffset()).toBe(60_000);
    expect(events).toEqual([{ kind: "strike", info }]);
    // a strike-0 envelope sets the clock but reports nothing
    expect(screenAnswer({ anticheat: { ...ENVELOPE.anticheat, strike: 0, locked_until: null } }, null)).toMatchObject({ strike: 0 });
    expect(events).toHaveLength(1);
    expect(screenAnswer({ state: {} }, null)).toBeNull();
    off();
  });

  it("reports the lock of an account locked refusal on the server clock", () => {
    const events: AnticheatEvent[] = [];
    const off = subscribeAnticheat((e) => events.push(e));
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T10:14:00Z"));
    syncClock("2026-10-02T10:15:00Z");
    expect(screenAnswer(null, { message: "account locked", details: "125", hint: "anticheat" })).toBeNull();
    expect(events).toEqual([{ kind: "lock", until: Date.parse("2026-10-02T10:17:05Z"), code: null }]);
    expect(screenAnswer(null, { message: "not enough coins" })).toBeNull();
    expect(events).toHaveLength(1);
    off();
  });
});
