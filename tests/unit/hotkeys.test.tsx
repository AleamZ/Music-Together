import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HOTKEYS, hotkeyFor, withKey, type HotkeyContext, type HotkeyEvent } from "@/lib/game/hotkeys";
import { runHotkey, useHotkeys } from "@/hooks/useHotkeys";
import { HeatActions } from "@/components/game/HeatHud";
import type { HeatView } from "@/hooks/useHeat";

afterEach(cleanup);

const ON: HotkeyContext = { enabled: true, helpOpen: false, offer: false };
const ev = (code: string, p: Partial<HotkeyEvent> = {}): HotkeyEvent =>
  ({ code, ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: document.body, ...p });

describe("hotkeyFor", () => {
  it("maps the HUD keys", () => {
    expect(hotkeyFor(ev("KeyB"), ON)).toBe("bag");
    expect(hotkeyFor(ev("KeyI"), ON)).toBe("wardrobe");
    expect(hotkeyFor(ev("KeyJ"), ON)).toBe("jump");
    expect(hotkeyFor(ev("KeyH"), ON)).toBe("help");
    expect(hotkeyFor(ev("Slash"), ON)).toBe("help");
  });
  it("leaves movement, E, R and Space to their own listeners (P4: M is the world map)", () => {
    for (const c of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyE", "KeyR", "Space", "Escape", "ArrowUp"]) expect(hotkeyFor(ev(c), ON)).toBeNull();
  });
  it("ignores typing, modifiers and held keys", () => {
    const input = document.createElement("input");
    expect(hotkeyFor(ev("KeyB", { target: input }), ON)).toBeNull();
    expect(hotkeyFor(ev("KeyB", { ctrlKey: true }), ON)).toBeNull();
    expect(hotkeyFor(ev("KeyB", { altKey: true }), ON)).toBeNull();
    expect(hotkeyFor(ev("KeyB", { metaKey: true }), ON)).toBeNull();
    expect(hotkeyFor(ev("KeyB", { repeat: true }), ON)).toBeNull();
  });
  it("is off while a panel or minigame holds the screen", () => {
    expect(hotkeyFor(ev("KeyB"), { ...ON, enabled: false })).toBeNull();
  });
  it("with the help open only H / ? answer (to close it)", () => {
    const ctx = { ...ON, enabled: false, helpOpen: true };
    expect(hotkeyFor(ev("KeyH"), ctx)).toBe("help");
    expect(hotkeyFor(ev("KeyB"), ctx)).toBeNull();
    expect(hotkeyFor(ev("Escape"), ctx)).toBeNull();
  });
  it("Y / N answer a lift ask; N is the board otherwise", () => {
    expect(hotkeyFor(ev("KeyN"), ON)).toBe("board");
    expect(hotkeyFor(ev("KeyY"), ON)).toBeNull();
    expect(hotkeyFor(ev("KeyN"), { ...ON, offer: true })).toBe("liftDecline");
    expect(hotkeyFor(ev("KeyY"), { ...ON, offer: true })).toBe("liftAccept");
  });
  it("has no clashing keys among the resolved actions", () => {
    const seen = new Map<string, string>();
    for (const h of HOTKEYS) {
      if (h.external || !h.id || h.id === "liftDecline" || h.id === "liftAccept") continue;
      for (const c of h.codes) {
        expect(seen.get(c), `${c} used twice`).toBeUndefined();
        seen.set(c, h.id);
      }
    }
    expect(withKey("Giỏ đồ", "bag")).toBe("Giỏ đồ (B)");
  });
});

describe("runHotkey / useHotkeys", () => {
  it("clicks the marked button, skips a disabled one, focuses a text field", () => {
    const click = vi.fn();
    render(
      <div>
        <button type="button" data-hotkey="bag" onClick={click}>b</button>
        <button type="button" data-hotkey="wardrobe" disabled onClick={click}>w</button>
        <input data-hotkey="chatFocus" aria-label="msg" />
      </div>,
    );
    expect(runHotkey("bag", () => {})).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
    expect(runHotkey("wardrobe", () => {})).toBe(false);
    expect(runHotkey("queue", () => {})).toBe(false);
    runHotkey("chatFocus", () => {});
    expect(document.activeElement).toBe(screen.getByLabelText("msg"));
  });

  function Harness({ ctx, onHelp, onBag }: { ctx: HotkeyContext; onHelp: () => void; onBag: () => void }) {
    useHotkeys(ctx, onHelp);
    return <button type="button" data-hotkey="bag" onClick={onBag}>bag</button>;
  }
  it("one window listener runs the keys (and not while typing or disabled)", () => {
    const onHelp = vi.fn(), onBag = vi.fn();
    const { rerender } = render(<Harness ctx={ON} onHelp={onHelp} onBag={onBag} />);
    fireEvent.keyDown(window, { code: "KeyB" });
    fireEvent.keyDown(window, { code: "KeyH" });
    expect(onBag).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
    rerender(<Harness ctx={{ ...ON, enabled: false }} onHelp={onHelp} onBag={onBag} />);
    fireEvent.keyDown(window, { code: "KeyB" });
    expect(onBag).toHaveBeenCalledTimes(1);
  });
});

describe("pond-edge buttons", () => {
  it("J / K / L click jump, warm-up and the net", () => {
    const heat = {
      probe: { edge: { col: 1, row: 2 }, rescue: null }, busy: false, jump: vi.fn(), warmUp: vi.fn(), rescue: vi.fn(), chips: [],
    } as unknown as HeatView;
    const onNet = vi.fn();
    render(<HeatActions heat={heat} hidden={false} onNet={onNet} />);
    expect(screen.getByTitle("Nhảy xuống ao (J)").textContent).toContain("J · ");
    runHotkey("jump", () => {});
    runHotkey("warmUp", () => {});
    runHotkey("net", () => {});
    expect(heat.jump).toHaveBeenCalled();
    expect(heat.warmUp).toHaveBeenCalled();
    expect(onNet).toHaveBeenCalledWith({ col: 1, row: 2 });
  });
});
