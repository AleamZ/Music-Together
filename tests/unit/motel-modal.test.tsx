import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MotelState } from "@/lib/game/housing/motel";
import { DEFAULT_LOOK } from "@/lib/game/look";

const rpc = vi.hoisted(() => ({ motelRent: vi.fn(), motelSleep: vi.fn() }));
vi.mock("@/lib/game/housing/motel", async (orig) => ({ ...(await orig<object>()), ...rpc }));
import MotelModal from "@/components/game/MotelModal";

afterEach(() => { cleanup(); vi.useRealTimers(); });

const st = (over: Partial<MotelState> = {}): MotelState => ({
  stay: null, rest: { buffUntilMs: null, sleptToday: false }, serverNowMs: 0, ...over,
});

describe("MotelModal", () => {
  it("rents a night, then lets me in", async () => {
    const onState = vi.fn();
    rpc.motelRent.mockResolvedValue(st({ stay: { plan: "night", untilMs: 86400_000 }, coins: 900 }));
    const { rerender } = render(<MotelModal token="t" state={st()} coins={1000} look={DEFAULT_LOOK} onState={onState} onClose={() => {}} />);
    expect((screen.getByRole("button", { name: "🚪 Vào phòng" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByRole("button", { name: "Thuê" })[1] as HTMLButtonElement).disabled).toBe(true);   // the month is too dear
    await act(async () => { fireEvent.click(screen.getAllByRole("button", { name: "Thuê" })[0]); });
    expect(rpc.motelRent).toHaveBeenCalledWith("t", "night");
    expect(onState).toHaveBeenCalled();
    rerender(<MotelModal token="t" state={st({ stay: { plan: "night", untilMs: 86400_000 } })} coins={900} look={DEFAULT_LOOK} onState={onState} onClose={() => {}} />);
    expect(screen.getByTestId("motel-stay").textContent).toContain("24 giờ 0 phút");
    fireEvent.click(screen.getByRole("button", { name: "🚪 Vào phòng" }));
    expect(screen.getByTestId("motel-room")).toBeTruthy();
  });

  it("sleeps: the cutscene holds the modal, then I wake with the buff", async () => {
    vi.useFakeTimers();
    rpc.motelSleep.mockResolvedValue(st({ stay: { plan: "month", untilMs: 1e9 }, rest: { buffUntilMs: 86400_000, sleptToday: true } }));
    const onClose = vi.fn();
    render(<MotelModal token="t" state={st({ stay: { plan: "month", untilMs: 1e9 } })} coins={0} look={DEFAULT_LOOK} onState={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "🚪 Vào phòng" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "🛏️ Ngủ" })); });
    expect(rpc.motelSleep).toHaveBeenCalledWith("t");
    expect(screen.getByTestId("motel-status").textContent).toContain("Zzz");
    expect(screen.queryByRole("button", { name: "Đóng" })).toBeNull();
    await act(async () => { vi.advanceTimersByTime(4300); });
    expect(screen.getByTestId("motel-status").textContent).toContain("Dậy rồi");
  });

  it("shows the server's refusal", async () => {
    rpc.motelSleep.mockRejectedValue(new Error("already slept"));
    render(<MotelModal token="t" state={st({ stay: { plan: "night", untilMs: 1e6 } })} coins={0} look={DEFAULT_LOOK} onState={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "🚪 Vào phòng" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "🛏️ Ngủ" })); });
    expect(screen.getByRole("alert").textContent).toContain("ngủ rồi");
  });
});
