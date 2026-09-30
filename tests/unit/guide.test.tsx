import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import GuideTracker from "@/components/game/guide/GuideTracker";
import { GUIDE_STEPS, guideKey, parseGuide, stepDone, type GuideCtx } from "@/lib/game/guide/model";

const at = (o: Partial<GuideCtx> = {}): GuideCtx => ({ map: "hall", fish: 0, coins: 100, hunger: 50, thirst: 50, panel: null, ...o });
const idx = (id: string) => GUIDE_STEPS.findIndex((s) => s.id === id);

describe("guide model", () => {
  it("walks the village loop in order", () => {
    expect(GUIDE_STEPS.map((s) => s.id)).toEqual(["map", "to_pond", "catch", "to_market", "sell", "eat", "quests"]);
  });
  it("judges each step against the state when it began", () => {
    expect(stepDone(idx("map"), at({ panel: "city_map" }), at())).toBe(true);
    expect(stepDone(idx("to_pond"), at({ map: "pond" }), at())).toBe(true);
    expect(stepDone(idx("catch"), at({ fish: 3 }), at({ fish: 2 }))).toBe(true);
    expect(stepDone(idx("catch"), at({ fish: 2 }), at({ fish: 2 }))).toBe(false);
    expect(stepDone(idx("catch"), at({ fish: null }), at({ fish: 2 }))).toBe(false);
    expect(stepDone(idx("sell"), at({ fish: 0, coins: 180 }), at({ fish: 2, coins: 100 }))).toBe(true);
    expect(stepDone(idx("sell"), at({ fish: 0, coins: 100 }), at({ fish: 2, coins: 100 }))).toBe(false);   // dropped, not sold
    expect(stepDone(idx("eat"), at({ hunger: 80 }), at({ hunger: 20 }))).toBe(true);
    expect(stepDone(idx("eat"), at({ hunger: 21 }), at({ hunger: 20 }))).toBe(false);
    expect(stepDone(idx("quests"), at({ panel: "quests" }), at())).toBe(true);
  });
  it("reads a saved progress defensively", () => {
    expect(parseGuide(null)).toEqual({ step: 0, hidden: false });
    expect(parseGuide("{bad")).toEqual({ step: 0, hidden: false });
    expect(parseGuide(JSON.stringify({ step: 99, hidden: true }))).toEqual({ step: GUIDE_STEPS.length, hidden: true });
    expect(parseGuide(JSON.stringify({ step: 2.5 }))).toEqual({ step: 0, hidden: false });
  });
});

describe("GuideTracker", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });
  it("shows the step, marks it done, moves on and remembers", () => {
    vi.useFakeTimers();
    const onDone = vi.fn();
    const { rerender } = render(<GuideTracker accountId="a1" ctx={at()} onStepDone={onDone} />);
    expect(screen.getByText(/Xem bản đồ làng/)).toBeTruthy();
    rerender(<GuideTracker accountId="a1" ctx={at({ panel: "city_map" })} onStepDone={onDone} />);
    expect(screen.getByText(/✅/)).toBeTruthy();
    expect(onDone).toHaveBeenCalledWith("Xem bản đồ làng");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText(/Ra Ao cá/)).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(guideKey("a1"))!).step).toBe(1);
  });
  it("counts the catch from when the step began, even if the bag loaded late", () => {
    vi.useFakeTimers();
    window.localStorage.setItem(guideKey("a2"), JSON.stringify({ step: idx("catch"), hidden: false }));
    const { rerender } = render(<GuideTracker accountId="a2" ctx={at({ map: "pond", fish: null })} />);
    rerender(<GuideTracker accountId="a2" ctx={at({ map: "pond", fish: 4 })} />);
    expect(screen.queryByText(/✅/)).toBeNull();                        // 4 was already there
    rerender(<GuideTracker accountId="a2" ctx={at({ map: "pond", fish: 5 })} />);
    expect(screen.getByText(/✅/)).toBeTruthy();
  });
  it("hides behind a chip and comes back", () => {
    render(<GuideTracker accountId="a3" ctx={at()} />);
    fireEvent.click(screen.getByRole("button", { name: "Ẩn hướng dẫn" }));
    expect(screen.queryByTestId("guide")).toBeNull();
    fireEvent.click(screen.getByTestId("guide-show"));
    expect(screen.getByTestId("guide")).toBeTruthy();
  });
});
