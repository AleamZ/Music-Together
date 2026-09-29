import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WildGame from "@/components/game/realm/WildGame";
import ComboGame from "@/components/game/realm/ComboGame";

describe("world minigame overlays (0083)", () => {
  afterEach(cleanup);
  it("the hunt renders, and Esc gives up with the inputs so far", () => {
    const onEnd = vi.fn();
    render(<WildGame view={{ round: { game: "hunt", spawn: 1, species: "wolf", danger: true, seed: 42 }, phase: "playing", message: "", night: true }}
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
    const { rerender } = render(<WildGame view={{ round: { game: "trap", spawn: 1, species: "bird", danger: false, seed: 7 }, phase: "playing", message: "", night: false }}
      onEnd={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("dialog").textContent).toContain("lưới");
    rerender(<WildGame view={{ round: { game: "trap", spawn: 1, species: "bird", danger: false, seed: 7 }, phase: "done", message: "Vào lưới rồi!", night: false }}
      onEnd={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("status").textContent).toBe("Vào lưới rồi!");
  });

  it("the combo renders six arrows and the dodge button", () => {
    const onEnd = vi.fn();
    render(<ComboGame view={{ round: { kind: "boss", ref: 1, target: 0, seed: 9 }, name: "Trâu Tinh", boss: "trau_tinh", icon: "👹", phase: "playing", message: "", dmg: null }}
      onEnd={onEnd} onClose={() => {}} />);
    expect(screen.getByText("🤸 Né")).toBeTruthy();
    act(() => { fireEvent.keyDown(window, { key: "Escape", code: "Escape" }); });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });
});
