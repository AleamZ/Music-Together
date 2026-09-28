import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import KataOverlay from "@/components/game/fight/KataOverlay";
import { martialByKey } from "@/lib/game/fight/dojo";
import { kataChart, kataReveal, KATA_REVEAL } from "@/lib/game/fight/kata";

// 0060: the kata's chart is revealed as it plays (dojo_kata_notes); the overlay asks for more before its notes run out.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("KataOverlay with a progressive chart", () => {
  it("asks for more notes ahead of its clock, shows them, and ends at the chart's length", async () => {
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const c = kataChart(42, 1);
    const flat = c.notes.flatMap(([t, l]) => [t, l]);
    const asked: number[] = [];
    let tickNow = 0;
    const more = vi.fn(async () => {
      asked.push(tickNow);
      const upto = tickNow + KATA_REVEAL;
      return { chart: kataReveal(flat, upto), upto };
    });
    const onDone = vi.fn();
    render(
      <KataOverlay style={martialByKey("vovinam")!} first={kataReveal(flat, KATA_REVEAL)} upto={KATA_REVEAL} length={c.length}
        total={c.notes.length} more={more} passPct={60} onDone={onDone} />,
    );
    expect(screen.getByRole("meter", { name: "Điểm bài quyền" })).toHaveAttribute("aria-valuemax", String(2 * c.notes.length));
    for (let ms = 0; ms <= ((c.length + 2) * 1000) / 60 && onDone.mock.calls.length === 0; ms += 16) {
      tickNow = Math.floor((ms * 60) / 1000);
      const run = frames;
      frames = [];
      await act(async () => { run.forEach((cb) => cb(ms)); });
    }
    expect(asked.length).toBeGreaterThan(2);
    expect(asked[0]).toBeGreaterThanOrEqual(KATA_REVEAL - 150);                 // not before the known notes run low
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith([]);
  }, 30_000);                                                                     // a few thousand frames, each an act()
});
