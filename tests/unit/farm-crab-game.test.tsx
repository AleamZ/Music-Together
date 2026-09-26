import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import CrabGame, { CRAB_HELP } from "@/components/game/farm/CrabGame";
import type { FarmCrab } from "@/hooks/useFarmController";
import { CRAB, createCrabRound } from "@/lib/game/farm/minigames";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const crab = (over: Partial<FarmCrab> = {}): FarmCrab => ({
  hole: 3, visit: { id: "v1", hole: 3, startedAt: 1 }, seed: 5, begunAt: 1, phase: "playing", hits: null, message: null, ...over,
});
function show(c: FarmCrab, over: { panelOpen?: boolean } = {}) {
  const props = { onEnd: vi.fn(), onClose: vi.fn() };
  render(<CrabGame crab={c} panelOpen={over.panelOpen ?? false} {...props} />);
  return props;
}
/** Frames of 16 ms for `ms`. */
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const space = (target: Window | Element = window) => fireEvent.keyDown(target, { code: "Space", key: " " });
/** From the game's start: try 1's claws well inside a closed stretch, and well inside an open one (its period 1.2 s). */
const P = CRAB.periodsMs[0], p0 = createCrabRound(5).phases[0];
const CLOSED_AT = CRAB.leadMs + ((((CRAB.openShare * P - p0) % P) + P) % P) + 150;
const OPEN_AT = CRAB.leadMs + (((P - p0) % P) + P) % P + 150;

describe("CrabGame (v15.3 §13.2)", () => {
  it("names the hole, with the help, the try, the catch so far and the crab lurking", () => {
    show(crab());
    expect(screen.getByRole("heading", { name: "🦀 Bắt cua · hang 3" })).toBeInTheDocument();
    expect(screen.getByText(CRAB_HELP)).toBeInTheDocument();
    expect(CRAB_HELP).toBe("Cua giơ càng mở ra khép vào. Bấm Space (hoặc chạm, bấm chuột) lúc càng KHÉP để chộp — càng mở mà chộp là bị cua kẹp!");
    expect(screen.getByText(/Lần 1\/3 · bắt được 0/)).toBeInTheDocument();
    expect(screen.getByText(/Cua đang rình…/)).toBeInTheDocument();
  });

  it("writes the claws' state, and grabs with Space while they are closed: Bắt được!", () => {
    show(crab());
    run(16);
    run(CLOSED_AT - 16);
    expect(screen.getByText(/Càng khép — chộp!/)).toBeInTheDocument();
    space();
    run(32);
    expect(screen.getByText(/bắt được 1/)).toBeInTheDocument();
    expect(screen.getByText("Lần 1: Bắt được!")).toBeInTheDocument();
  });

  it("is pinched by a grab while the claws are open, by a click or a tap", () => {
    show(crab());
    run(16);
    run(OPEN_AT - 16);
    expect(screen.getByText(/Càng mở/)).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole("group", { name: "Hang cua" }));
    run(32);
    expect(screen.getByText(/bắt được 0/)).toBeInTheDocument();
    expect(screen.getByText("Lần 1: Á! Bị cua kẹp")).toBeInTheDocument();
  });

  it("ignores Space typed into a text field, and a held key's repeats", () => {
    render(<input aria-label="Chat" />);
    show(crab());
    run(16);
    run(CLOSED_AT - 16);
    space(screen.getByRole("textbox", { name: "Chat" }));
    fireEvent.keyDown(window, { code: "Space", key: " ", repeat: true });
    run(32);
    expect(screen.queryByText(/^Lần 1: /)).toBeNull();
  });

  it("reports the game's end once: three slips catch nothing", () => {
    const { onEnd, onClose } = show(crab());
    run(15_500);
    expect(onEnd.mock.calls).toEqual([[0]]);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Lần 3: Cua chui mất")).toBeInTheDocument();
  });

  it("Dừng before the first try ends sends nothing; after a try it reports the hits so far (R8)", () => {
    const early = show(crab());
    run(300);
    fireEvent.click(screen.getByRole("button", { name: "Dừng (Esc)" }));
    expect(early.onClose).toHaveBeenCalledTimes(1);
    expect(early.onEnd).not.toHaveBeenCalled();
    cleanup();
    const late = show(crab());
    run(16);
    run(CLOSED_AT - 16);
    space();
    run(32);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(late.onEnd.mock.calls).toEqual([[1]]);
    expect(late.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    run(20_000);
    expect(late.onEnd).toHaveBeenCalledTimes(1);
  });

  it("puts a catch in the bucket for its 4 s; Dừng closes it, and the catch still goes", () => {
    const { onClose } = show(crab({ phase: "waiting", hits: 2 }));
    expect(screen.getByText("Đang bỏ cua vào xô…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dừng (Esc)" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows the result or the refusal, with Đóng; an Esc for another overlay is not its own", () => {
    const done = show(crab({ phase: "done", hits: 2, message: "🦀 Bắt được 2 con: 2 cua đồng!" }));
    expect(screen.getByText("🦀 Bắt được 2 con: 2 cua đồng!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(done.onClose).toHaveBeenCalledTimes(1);
    cleanup();
    const refused = show(crab({ phase: "refused", hits: 3, message: "Lâu quá, cua chui mất rồi — lát nữa quay lại nhé." }), { panelOpen: true });
    expect(screen.getByText("Lâu quá, cua chui mất rồi — lát nữa quay lại nhé.")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(refused.onClose).not.toHaveBeenCalled();
  });
});
