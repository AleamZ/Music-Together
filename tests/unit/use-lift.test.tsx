import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import LiftHud from "@/components/game/LiftHud";
import { useLift, type LiftView } from "@/hooks/useLift";
import { LIFT_ASK_MS } from "@/lib/game/travel/lift";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function fakeCanvas() {
  const sent: unknown[] = [];
  const lifts: unknown[] = [];
  const canvas = {
    sendLift: (m: unknown) => sent.push(m),
    setLift: (l: unknown) => lifts.push(l),
    liftCandidate: () => ({ id: "dan", name: "Dan" }),
    nearForLift: (id: string) => id !== "far",
  } as unknown as GameCanvasHandle;
  return { ref: { current: canvas }, sent, lifts };
}

type Opts = Parameters<typeof useLift>[0];
function setup(over: Partial<Opts> = {}) {
  const c = fakeCanvas();
  const toast = vi.fn();
  const follow = vi.fn(() => true);
  const base: Opts = {
    canvasRef: c.ref, riding: null, canAsk: true, canCarry: false, fainted: false, inTransit: () => false,
    nameOf: (id) => id.toUpperCase(), toast, follow, ...over,
  };
  const h = renderHook((p: Opts) => useLift(p), { initialProps: base });
  return { ...c, toast, follow, h, base };
}

describe("useLift (v18.13)", () => {
  it("asks, gets on with a yes, follows the driver's portal, and gets off", async () => {
    const { h, sent, lifts, toast, follow } = setup();
    act(() => h.result.current.ask());
    expect(sent).toEqual([{ t: "rq", to: "dan" }]);
    expect(h.result.current.state.kind).toBe("asking");
    act(() => h.result.current.onMessage({ t: "ra", id: "dan", to: "me", ok: true, v: "moto" }));
    expect(lifts.at(-1)).toEqual({ role: "passenger", peer: "dan" });
    expect(h.result.current.aboard).toBe(true);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("DAN"));
    act(() => h.result.current.onMessage({ t: "lg", id: "dan", to: "me", m: "market" }));
    expect(follow).toHaveBeenCalledWith("market", "moto");
    act(() => h.result.current.leave());
    expect(sent.at(-1)).toEqual({ t: "rx", to: "dan" });
    expect(lifts.at(-1)).toBeNull();
  });
  it("keeps the lift through a trip (a partner's bye then is the road) and ends it otherwise", () => {
    let transit = true;
    const { h, lifts, toast } = setup({ inTransit: () => transit });
    act(() => h.result.current.ask());
    act(() => h.result.current.onMessage({ t: "ra", id: "dan", to: "me", ok: true, v: "car" }));
    act(() => h.result.current.onLost());
    expect(h.result.current.aboard).toBe(true);
    expect(lifts.at(-1)).toEqual({ role: "passenger", peer: "dan" });
    transit = false;
    act(() => h.result.current.onLost());
    expect(h.result.current.state.kind).toBe("none");
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining("Mất liên lạc"));
  });
  it("a driver accepts a near asker, declines a far one, and drops the passenger on getting off", async () => {
    const { h, sent, lifts, base } = setup({ riding: "bike", canCarry: true, canAsk: false });
    act(() => h.result.current.onMessage({ t: "rq", id: "far", to: "me" }));
    expect(sent).toEqual([{ t: "ra", to: "far", ok: false }]);
    act(() => h.result.current.onMessage({ t: "rq", id: "pia", to: "me" }));
    expect(h.result.current.offer).toEqual({ from: "pia", name: "PIA" });
    act(() => h.result.current.accept());
    expect(sent.at(-1)).toEqual({ t: "ra", to: "pia", ok: true, v: "bike" });
    expect(lifts.at(-1)).toEqual({ role: "driver", peer: "pia" });
    h.rerender({ ...base, riding: null, canCarry: false, canAsk: false });
    await act(async () => { await Promise.resolve(); });
    expect(sent.at(-1)).toEqual({ t: "rx", to: "pia" });
    expect(h.result.current.state.kind).toBe("none");
  });
  it("lets the wait lapse", () => {
    vi.useFakeTimers();
    const { h, toast } = setup();
    act(() => h.result.current.ask());
    act(() => { vi.advanceTimersByTime(LIFT_ASK_MS + 600); });
    expect(h.result.current.state.kind).toBe("none");
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("chưa trả lời"));
  });
});

const view = (over: Partial<LiftView>): LiftView => ({
  state: { kind: "none" }, offer: null, candidate: null, partner: null, aboard: false,
  ask: vi.fn(), accept: vi.fn(), decline: vi.fn(), leave: vi.fn(), drop: vi.fn(), portal: vi.fn(), onMessage: vi.fn(), onLost: vi.fn(),
  ...over,
});

describe("LiftHud", () => {
  it("offers Xin đi nhờ by button and E, unless a map prompt holds E", () => {
    const v = view({ candidate: { id: "dan", name: "Dan" } });
    const { rerender } = render(<LiftHud lift={v} keyEnabled promptShown={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Xin đi nhờ Dan/ }));
    fireEvent.keyDown(window, { code: "KeyE" });
    expect(v.ask).toHaveBeenCalledTimes(2);
    rerender(<LiftHud lift={v} keyEnabled promptShown />);
    fireEvent.keyDown(window, { code: "KeyE" });
    expect(v.ask).toHaveBeenCalledTimes(2);
  });
  it("a passenger gets off with the button or E; a driver answers and drops", () => {
    const p = view({ state: { kind: "passenger", driver: "dan", v: "moto" }, aboard: true, partner: "Dan" });
    const { rerender } = render(<LiftHud lift={p} keyEnabled promptShown={false} />);
    fireEvent.keyDown(window, { code: "KeyE" });
    fireEvent.click(screen.getByRole("button", { name: /Xuống xe/ }));
    expect(p.leave).toHaveBeenCalledTimes(2);
    const d = view({ state: { kind: "driver", passenger: "pia" }, partner: "Pia", offer: { from: "bo", name: "Bo" } });
    rerender(<LiftHud lift={d} keyEnabled promptShown={false} />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Bo muốn đi nhờ");
    fireEvent.click(screen.getByRole("button", { name: "Đồng ý" }));
    fireEvent.click(screen.getByRole("button", { name: "Từ chối" }));
    fireEvent.click(screen.getByRole("button", { name: "Cho Pia xuống" }));
    expect([d.accept, d.decline, d.drop].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)).toEqual([1, 1, 1]);
  });
});
