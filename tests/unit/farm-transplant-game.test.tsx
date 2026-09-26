import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import TransplantGame, { transplantHelp } from "@/components/game/farm/TransplantGame";
import type { FarmRound } from "@/hooks/useFarmController";
import { createTransplantRound, TRANSPLANT } from "@/lib/game/farm/minigames";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const round = (over: Partial<FarmRound> = {}): FarmRound => ({
  game: "transplant", plot: 3, part: 0, ot: false, seed: 11, begunAt: 1, phase: "playing", score: null, result: null, message: null,
  slow: false, ...over,
});
function show(r: FarmRound, over: { panelOpen?: boolean; busy?: boolean } = {}) {
  const props = { onEnd: vi.fn(), onNext: vi.fn(), onClose: vi.fn() };
  render(<TransplantGame round={r} busy={over.busy ?? false} panelOpen={over.panelOpen ?? false} {...props} />);
  return props;
}
/** Frames of 16 ms for `ms`. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const space = (target: Window | Element = window) => fireEvent.keyDown(target, { code: "Space", key: " " });

describe("TransplantGame (v15.3 §13.3)", () => {
  it("names the round, rice or ớt, with its help and the hills so far", () => {
    show(round());
    expect(screen.getByRole("heading", { name: "🌱 Cấy lúa thửa 3" })).toBeInTheDocument();
    expect(screen.getByText(transplantHelp(false))).toBeInTheDocument();
    expect(transplantHelp(false)).toBe("Bấm Space (hoặc chạm, bấm chuột) khi bàn tay vào vùng xanh để cắm khóm mạ cho thẳng hàng.");
    expect(screen.getByText(/Khóm 1\/12 · 0 điểm/)).toBeInTheDocument();
    cleanup();
    show(round({ plot: 6, ot: true }));
    expect(screen.getByRole("heading", { name: "🌶\uFE0F Trồng cây ớt con thửa 6" })).toBeInTheDocument();
    expect(screen.getByText(transplantHelp(true))).toBeInTheDocument();
    expect(transplantHelp(true)).toBe("Bấm Space (hoặc chạm, bấm chuột) khi bàn tay vào vùng xanh để cắm cây ớt cho thẳng hàng.");
    expect(screen.getByText(/Cây 1\/12 · 0 điểm/)).toBeInTheDocument();
  });

  it("sets a hill with Space as the hand crosses the band: Thẳng hàng!", () => {
    show(round());
    const c = createTransplantRound(11).centres[0];
    run(16);
    run(TRANSPLANT.leadMs + Math.round(c * TRANSPLANT.sweepMs));
    space();
    run(32);
    expect(screen.getByText(/Khóm 2\/12 · 1 điểm/)).toBeInTheDocument();
    expect(screen.getByText(/Thẳng hàng!/)).toBeInTheDocument();
  });

  it("sets a hill with a tap or a click; one too early is Lệch hàng", () => {
    show(round());
    run(16);
    run(TRANSPLANT.leadMs + 32);
    fireEvent.pointerDown(screen.getByRole("group", { name: "Hàng mạ" }));
    run(32);
    expect(screen.getByText(/Khóm 2\/12 · 0 điểm/)).toBeInTheDocument();
    expect(screen.getByText(/Lệch hàng/)).toBeInTheDocument();
  });

  it("ignores Space typed into a text field, and a held key's repeats", () => {
    render(<input aria-label="Chat" />);
    show(round());
    run(16);
    run(TRANSPLANT.leadMs + 100);
    space(screen.getByRole("textbox", { name: "Chat" }));
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    run(32);
    expect(screen.getByText(/Khóm 1\/12 · 0 điểm/)).toBeInTheDocument();
  });

  it("reports the round's end once: twelve hills missed score 0 and fail", () => {
    const { onEnd } = show(round());
    run(22_000);
    expect(onEnd.mock.calls).toEqual([[false, 0]]);
    expect(screen.getByText(/Bỏ sót khóm/)).toBeInTheDocument();
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

  it("waits out the 9 s setting the last hills, without a way out", () => {
    const { onClose } = show(round({ phase: "waiting", score: 7 }));
    expect(screen.getByText("Đang cắm nốt hàng mạ…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    show(round({ phase: "waiting", score: 7, ot: true }));
    expect(screen.getByText("Đang cắm nốt hàng cây…")).toBeInTheDocument();
  });

  it("offers Nghỉ tay, and takes Esc, once the claim has been slow on its way", () => {
    const { onClose } = show(round({ phase: "waiting", score: 7, slow: true }));
    expect(screen.getByText("Đang cắm nốt hàng mạ…")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Nghỉ tay" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("says the rice transplanted or the ớt set out, with Đóng", () => {
    const { onClose } = show(round({ phase: "won", score: 9 }));
    expect(screen.getByText("✅ Cấy xong thửa 3 — giữ nước Nông, bón thúc đúng lúc nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    show(round({ plot: 6, ot: true, phase: "won", score: 9 }));
    expect(screen.getByText("✅ Trồng xong cây ớt con thửa 6.")).toBeInTheDocument();
  });

  it("says a failed round's score, printed with a comma, with Thử lại and Nghỉ tay", () => {
    const { onNext, onClose } = show(round({ phase: "lost", score: 5.5 }));
    expect(screen.getByText("❌ Được 5,5/12 điểm — cần 6. Thử lại ngay nhé!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
    fireEvent.click(screen.getByRole("button", { name: "Nghỉ tay" }));
    expect([onNext.mock.calls.length, onClose.mock.calls.length]).toEqual([1, 1]);
  });

  it("shows the server's refusals in the transplant's words, and waits while busy", () => {
    show(round({ phase: "refused", score: 7, message: "Chưa cấy xong hàng mạ — thử lại sau vài giây." }), { busy: true });
    expect(screen.getByText("Chưa cấy xong hàng mạ — thử lại sau vài giây.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thử lại" })).toBeDisabled();
  });
});
