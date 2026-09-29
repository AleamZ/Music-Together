import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WildGame from "@/components/game/realm/WildGame";
import ComboGame from "@/components/game/realm/ComboGame";
import { localLive } from "@/lib/game/mglive";

describe("world minigame overlays (0083)", () => {
  afterEach(cleanup);
  it("the hunt renders, and Esc gives up with the inputs so far", () => {
    const onEnd = vi.fn();
    render(<WildGame view={{ round: { game: "hunt", spawn: 1, species: "wolf", danger: true, reticle: 120, nonce: 42 }, phase: "playing", message: "", night: true, live: null }}
      onEnd={onEnd} onClose={() => {}} />);
    expect(screen.getByRole("dialog").textContent).toContain("Sói xám");
    expect(screen.getByText(/Né \(E\)/)).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: "Escape", code: "Escape" }); });
    expect(onEnd).toHaveBeenCalledTimes(1);
    const [a, b, ticks] = onEnd.mock.calls[0];
    expect(a).toEqual([]);
    expect(b).toEqual([]);
    expect(ticks).toBeGreaterThanOrEqual(1);
  });

  it("the trap for a bird is a net; the result shows", () => {
    const { rerender } = render(<WildGame view={{ round: { game: "trap", spawn: 1, species: "bird", danger: false, reticle: 120, nonce: 7 }, phase: "playing", message: "", night: false, live: null }}
      onEnd={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("dialog").textContent).toContain("lưới");
    rerender(<WildGame view={{ round: { game: "trap", spawn: 1, species: "bird", danger: false, reticle: 120, nonce: 7 }, phase: "done", message: "Vào lưới rồi!", night: false, live: null }}
      onEnd={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Vào lưới rồi!");
  });

  it("the combo waits for its live chart, then renders the dodge button; Esc gives it up (nothing sent)", async () => {
    const onEnd = vi.fn();
    const live = localLive({ 1: { beat: 100, dir: 0 }, 2: { beat: 160, dir: 1 } });
    render(<ComboGame view={{ round: { kind: "boss", ref: 1, target: 0, nonce: 9 }, name: "Trâu Tinh", boss: "trau_tinh", icon: "👹", phase: "playing", message: "", dmg: null, live }}
      onEnd={onEnd} onClose={() => {}} />);
    expect(await screen.findByText("🤸 Né")).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: "Escape", code: "Escape" }); });
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd.mock.calls[0][2]).toBe(-1);
  });
});
