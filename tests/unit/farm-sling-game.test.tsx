import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import SlingGame from "@/components/game/farm/SlingGame";
import type { FarmSling } from "@/hooks/useFarmController";
import { drawSlingScene } from "@/lib/game/art/sling-art";
import { SLING_HELP } from "@/lib/game/farm/messages";
import { createSling, SLING, stepSling } from "@/lib/game/farm/sling";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sling = (over: Partial<FarmSling> = {}): FarmSling => ({
  rat: 7, plot: 3, seed: 11, begunAt: 1, answers: 0, phase: "playing", message: null, gone: false, ...over,
});
function show(s: FarmSling, over: { panelOpen?: boolean; pellets?: number } = {}) {
  const props = { onShot: vi.fn(), onReaim: vi.fn(), onClose: vi.fn() };
  const ui = (x: FarmSling) => (
    <SlingGame sling={x} pellets={over.pellets ?? 12} message={x.message} panelOpen={over.panelOpen ?? false} {...props} />
  );
  const { rerender } = render(ui(s));
  return { ...props, rerender: (x: FarmSling) => rerender(ui(x)) };
}
const run = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const hold = (target: Window | Element = window) => fireEvent.keyDown(target, { code: "Space", key: " " });
const release = () => fireEvent.keyUp(window, { code: "Space", key: " " });

describe("drawSlingScene (v17 §12.2)", () => {
  it("paints inside the 320 × 180 scene at every stage, the power bar filling while drawing", () => {
    const rects: Array<[number, number, number, number]> = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const c = {
      imageSmoothingEnabled: true, fillStyle: "", fillRect: (...r: [number, number, number, number]) => rects.push(r),
      drawImage: (_img: unknown, ...r: [number, number, number, number]) => rects.push(r),
    };
    let s = createSling(4);
    for (let i = 0; i < 200; i++) {
      s = stepSling(s, 0.03, { holding: i > 80, aimTo: null, left: false, right: i % 2 === 0 });
      drawSlingScene(c as unknown as CanvasRenderingContext2D, s, i * 30, i % 2 === 0);
    }
    const bad = rects.filter(([x, y, w, h]) => x < 0 || y < 0 || x + w > SLING.width || y + h > SLING.height);
    expect(bad).toEqual([]);
    expect(c.imageSmoothingEnabled).toBe(false);
    vi.restoreAllMocks();
  });
});

describe("SlingGame (v17 §12.2)", () => {
  it("names the plot, with the help, the pellets and the reload after the start answer", () => {
    show(sling());
    expect(screen.getByRole("heading", { name: "🎯 Bắn chuột · thửa 3" })).toBeInTheDocument();
    expect(screen.getByText(SLING_HELP)).toBeInTheDocument();
    run(16);
    expect(screen.getByText("Đạn: 12 viên · Nạp đạn…")).toBeInTheDocument();
    run(2300);
    expect(screen.getByText("Đạn: 12 viên")).toBeInTheDocument();
  });

  it("sends no shot before 2.2 s of reload, the draw and the 0.3 s flight: a full draw flies over", () => {
    const p = show(sling());
    hold();
    run(2200 + 1000 + 250);
    expect(p.onShot).not.toHaveBeenCalled();
    run(150);
    expect(p.onShot).toHaveBeenCalledTimes(1);
    expect(p.onShot).toHaveBeenCalledWith(false);
    expect(screen.getByText("Hụt — căng quá, đạn bay qua.")).toBeInTheDocument();
    // the answer came: the reload starts again
    release();
    p.rerender(sling({ answers: 1 }));
    run(16);
    expect(screen.getByText("Đạn: 12 viên · Nạp đạn…")).toBeInTheDocument();
  });

  it("draws with a pointer held on the scene: let go early and the pellet falls short", () => {
    const p = show(sling());
    run(2300);
    fireEvent.pointerDown(screen.getByRole("group", { name: "Ná" }), { clientX: 0 });
    run(300);
    fireEvent.pointerUp(screen.getByRole("group", { name: "Ná" }));
    run(400);
    expect(p.onShot).toHaveBeenCalledWith(false);
    expect(screen.getByText("Hụt — đạn rơi trước.")).toBeInTheDocument();
  });

  it("ignores Space typed into a text field", () => {
    render(<input aria-label="Chat" />);
    const p = show(sling());
    run(2300);
    hold(screen.getByRole("textbox", { name: "Chat" }));
    run(2000);
    expect(p.onShot).not.toHaveBeenCalled();
  });

  it("closes on Thôi or Esc and sends nothing; an Esc for another open panel is not its own", () => {
    const p = show(sling(), { panelOpen: true });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(p.onClose).not.toHaveBeenCalled();
    cleanup();
    const q = show(sling());
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Thôi (Esc)" }));
    expect(q.onClose).toHaveBeenCalledTimes(2);
    expect(q.onShot).not.toHaveBeenCalled();
  });

  it("drops a shot ready 55 s or more after the last answer, and aims again instead", () => {
    const p = show(sling());
    run(55_000);
    hold();
    run(1400);
    expect(p.onShot).not.toHaveBeenCalled();
    expect(p.onReaim).toHaveBeenCalledTimes(1);
  }, 60_000);

  it("shows the hit or the refusal, closed by Đóng or Esc", () => {
    const p = show(sling({ phase: "done", message: "🎯 Trúng! Bắt được chuột đồng — 336 xu, đem bán ở vựa cô Út." }));
    expect(screen.getByRole("status")).toHaveTextContent("🎯 Trúng! Bắt được chuột đồng — 336 xu, đem bán ở vựa cô Út.");
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(p.onClose).toHaveBeenCalledTimes(2);
  });
});
