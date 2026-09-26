import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));

import AnticheatChip from "@/components/game/AnticheatChip";
import AnticheatModal from "@/components/game/AnticheatModal";
import { useAnticheat } from "@/hooks/useAnticheat";
import {
  BAN_BODY, BAN_WIPE, reportAnticheat, reportLock, reportNoLock, WARN_BODY, WARN_LOCK, WARN_REPEAT, type AnticheatInfo,
} from "@/lib/anticheat";
import { serverNow, syncClock } from "@/lib/game/farm/clock";

const REEL = "Báo kéo được cá nhanh hơn mức trò chơi cho phép.";
const OTHER = "Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.";
const strike = (over: Partial<AnticheatInfo>): AnticheatInfo => ({
  code: "reel_too_fast", strike: 1, error: null, lockedUntil: null, banned: false, serverNow: null, ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse("2026-10-02T10:00:00Z"));
  auth.logout.mockReset();
  auth.logout.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  syncClock(0, 0);
  vi.useRealTimers();
});

describe("useAnticheat", () => {
  it("warns once per lock for a strike 1, and counts the lock down on the server clock", async () => {
    syncClock(Date.now() + 60_000); // the server runs a minute ahead of this client
    const until = serverNow() + 125_000;
    const { result } = renderHook(() => useAnticheat());
    expect(result.current).toMatchObject({ modal: null, secondsLeft: 0 });
    act(() => reportAnticheat(strike({ lockedUntil: until })));
    expect(result.current).toMatchObject({ modal: "warn", reason: REEL });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.secondsLeft).toBe(125);
    act(() => result.current.dismiss());
    expect(result.current.modal).toBeNull();
    // the same lock again, from the fishing state of a refetch: no second warning
    act(() => reportLock(until, "reel_too_fast"));
    expect(result.current.modal).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(result.current.secondsLeft).toBe(120);
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(result.current.secondsLeft).toBe(0);
  });

  it("warns for a lock the fishing state reports, and only counts down one an account locked refusal reports", async () => {
    const { result } = renderHook(() => useAnticheat());
    act(() => reportLock(serverNow() + 60_000, null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current).toMatchObject({ modal: null, secondsLeft: 60 });
    act(() => reportLock(serverNow() + 290_000, "bad_plot"));
    expect(result.current).toMatchObject({ modal: "warn", reason: OTHER });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(result.current.secondsLeft).toBe(289);
  });

  it("shows the ban for a strike 2, and no warning replaces it", () => {
    const { result } = renderHook(() => useAnticheat());
    act(() => reportAnticheat(strike({ code: "bad_qty", strike: 2, banned: true })));
    expect(result.current).toMatchObject({ modal: "ban", reason: OTHER });
    act(() => reportLock(serverNow() + 1_000_000, "quality_range"));
    expect(result.current).toMatchObject({ modal: "ban", reason: OTHER });
  });
});

describe("AnticheatModal", () => {
  it("warns with the reason, and closes with its button or Esc", () => {
    const onClose = vi.fn();
    render(<AnticheatModal kind="warn" reason={REEL} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "⚠️ Cảnh báo gian lận" })).toBeInTheDocument();
    for (const text of [WARN_BODY, `Lý do: ${REEL}`, WARN_LOCK, WARN_REPEAT]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tôi đã hiểu" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Tôi đã hiểu" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("logs out from the ban however it is closed (R15)", () => {
    const onClose = vi.fn();
    render(<AnticheatModal kind="ban" reason={OTHER} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "🚫 Tài khoản bị khoá vĩnh viễn" })).toBeInTheDocument();
    for (const text of [BAN_BODY, `Lý do: ${OTHER}`, BAN_WIPE]) expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Đăng xuất" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Đăng xuất" }));
    expect(auth.logout).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(auth.logout).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(auth.logout).toHaveBeenCalledTimes(3);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe("AnticheatChip", () => {
  function Chip() {
    const { secondsLeft } = useAnticheat();
    return <AnticheatChip secondsLeft={secondsLeft} />;
  }

  it("counts the lock down in the player card and goes when it ends", async () => {
    render(<Chip />);
    expect(screen.queryByRole("timer")).toBeNull();
    act(() => reportLock(serverNow() + 247_000, null));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const chip = screen.getByRole("timer");
    expect(chip).toHaveTextContent("🔒 4:07");
    expect(chip).toHaveAttribute("title", "Tạm khoá trò chơi — còn 4 phút 7 giây");
    expect(chip).toHaveAccessibleName("Tạm khoá trò chơi — còn 4 phút 7 giây");
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(screen.getByRole("timer")).toHaveTextContent("🔒 4:00");
    await act(async () => { await vi.advanceTimersByTimeAsync(240_000); });
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("goes at once when a fishing state says no lock runs (a pardon, or a switch to log mode)", async () => {
    render(<Chip />);
    act(() => reportLock(serverNow() + 247_000, "bad_plot"));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole("timer")).toHaveTextContent("🔒 4:07");
    act(() => reportNoLock());
    expect(screen.queryByRole("timer")).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByRole("timer")).toBeNull();
  });
});
