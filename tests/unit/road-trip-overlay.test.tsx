import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import RoadTripOverlay from "@/components/game/RoadTripOverlay";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { VEHICLES } from "@/lib/game/travel/vehicles";

const noop = () => {};
function fakeCtx() {
  return new Proxy({ fillStyle: "" } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : noop),
    set: (o, k, v) => { o[k as string] = v; return true; },
  });
}

const BIKE = VEHICLES[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance", "Date"] });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => fakeCtx() as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function setup(over: Partial<Parameters<typeof RoadTripOverlay>[0]> = {}) {
  const onArrive = vi.fn();
  const onSkip = vi.fn(async () => true);
  render(<RoadTripOverlay look={DEFAULT_LOOK} toMarket vehicle={BIKE} durationMs={10000} onArrive={onArrive} onSkip={onSkip} coins={100} {...over} />);
  return { onArrive, onSkip };
}

describe("RoadTripOverlay", () => {
  it("shows where it goes and by what", () => {
    setup();
    expect(screen.getByText("Đang ra Chợ Lớn…")).toBeInTheDocument();
    expect(screen.getByText(/🚲 Xe đạp · 10 giây/)).toBeInTheDocument();
    cleanup();
    setup({ toMarket: false, vehicle: null, durationMs: 15000 });
    expect(screen.getByText("Đang về Sảnh…")).toBeInTheDocument();
    expect(screen.getByText("🚶 Đi bộ · 15 giây")).toBeInTheDocument();
  });
  it("arrives once after durationMs", async () => {
    const { onArrive } = setup();
    await act(async () => { vi.advanceTimersByTime(9000); });
    expect(onArrive).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(onArrive).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(onArrive).toHaveBeenCalledTimes(1);
  });
  it("skipping with enough coins arrives at once", async () => {
    const { onArrive, onSkip } = setup();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Bỏ qua (50 xu)" })); });
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onArrive).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(12000); });
    expect(onArrive).toHaveBeenCalledTimes(1);
  });
  it("a refused skip says so and keeps going", async () => {
    const { onArrive } = setup({ onSkip: vi.fn(async () => false) });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Bỏ qua (50 xu)" })); });
    expect(screen.getByText("Không đủ xu")).toBeInTheDocument();
    expect(onArrive).not.toHaveBeenCalled();
  });
  it("disables skip when coins are short", () => {
    setup({ coins: 10 });
    expect(screen.getByRole("button", { name: "Bỏ qua (50 xu)" })).toBeDisabled();
  });
});
