import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import HarvestGame, { HARVEST_HELP } from "@/components/game/farm/HarvestGame";
import type { FarmRound } from "@/hooks/useFarmController";
import { createHarvestRound } from "@/lib/game/farm/minigames";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const round = (over: Partial<FarmRound> = {}): FarmRound => ({
  plot: 3, part: 2, seed: 11, begunAt: 1, phase: "playing", score: null, result: null, message: null, ...over,
});
function show(r: FarmRound, over: { panelOpen?: boolean; busy?: boolean } = {}) {
  const props = { onEnd: vi.fn(), onNext: vi.fn(), onClose: vi.fn() };
  render(<HarvestGame round={r} busy={over.busy ?? false} panelOpen={over.panelOpen ?? false} varietyName="Nếp" {...props} />);
  return props;
}
/** Frames of 16 ms for `ms`. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const space = (type: "keyDown" | "keyUp", target: Window | Element = window) => fireEvent[type](target, { code: "Space", key: " " });

describe("HarvestGame", () => {
  it("shows the part, the help, the bundle and the points", () => {
    show(round());
    expect(screen.getByRole("heading", { name: "🌾 Gặt thửa 3 · phần 2/6" })).toBeInTheDocument();
    expect(screen.getByText(HARVEST_HELP)).toBeInTheDocument();
    expect(screen.getByText(/Bó 1\/8 · 0 điểm/)).toBeInTheDocument();
  });

  it("cuts with Space: let go in the green band for Chuẩn", () => {
    show(round());
    const c = createHarvestRound(11).centres[0];
    run(16);
    space("keyDown");
    run(16 + Math.round(c * 1200));
    space("keyUp");
    run(32);
    expect(screen.getByText(/Bó 2\/8 · 1 điểm/)).toBeInTheDocument();
    expect(screen.getByText(/Chuẩn!/)).toBeInTheDocument();
  });

  it("cuts with a held mouse button or finger; a tap cuts too early (sót hạt)", () => {
    show(round());
    const bar = screen.getByRole("progressbar", { name: "Lực liềm" });
    run(16);
    fireEvent.pointerDown(bar);
    run(48);
    fireEvent.pointerUp(bar);
    run(32);
    expect(screen.getByText(/Lệch — sót hạt/)).toBeInTheDocument();
  });

  it("ignores Space typed into a text field", () => {
    render(<input aria-label="Chat" />);
    show(round());
    run(16);
    space("keyDown", screen.getByRole("textbox", { name: "Chat" }));
    run(2000);
    expect(screen.getByText(/Bó 1\/8 · 0 điểm/)).toBeInTheDocument();
  });

  it("reports the round's end once: eight taps score 0 and fail", () => {
    const { onEnd } = show(round());
    for (let i = 0; i < 8; i++) {
      run(16);
      space("keyDown");
      run(32);
      space("keyUp");
      run(400);
    }
    run(400);
    expect(onEnd.mock.calls).toEqual([[false, 0]]);
  });

  it("closes on Esc or Huỷ and sends nothing; an Esc for another overlay is not its own", () => {
    const { onClose, onEnd } = show(round());
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Huỷ (Esc)" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onEnd).not.toHaveBeenCalled();
    cleanup();
    const other = show(round(), { panelOpen: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(other.onClose).not.toHaveBeenCalled();
  });

  it("waits out the 9 s bundling the rice, without a way out", () => {
    const { onClose } = show(round({ phase: "waiting", score: 5 }));
    expect(screen.getByText("Đang bó lúa…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says the part won, with Gặt tiếp and Nghỉ tay", () => {
    const { onNext, onClose } = show(round({ phase: "won", score: 6, result: { variety: "nep", kg: 13, parts: 2, total: 25, done: false } }));
    expect(screen.getByText("✅ Xong phần 2/6: 13 kg lúa.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gặt tiếp phần 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Nghỉ tay" }));
    expect([onNext.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 1]);
  });

  it("says a failed round's score, printed with a comma, with Thử lại", () => {
    const { onNext } = show(round({ phase: "lost", score: 3.5 }));
    expect(screen.getByText("❌ Được 3,5/8 điểm — cần 4. Thử lại ngay nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("shows the server's refusals in the round's words, and waits while busy", () => {
    show(round({ phase: "refused", score: 5, message: "Chưa xong bó lúa — thử lại sau vài giây." }), { busy: true });
    expect(screen.getByText("Chưa xong bó lúa — thử lại sau vài giây.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeDisabled();
    cleanup();
    show(round({ phase: "refused", score: 5, message: "Hết hạn thuê — phần lúa chưa gặt đã mất." }));
    expect(screen.getByText("Hết hạn thuê — phần lúa chưa gặt đã mất.")).toBeInTheDocument();
  });
});
