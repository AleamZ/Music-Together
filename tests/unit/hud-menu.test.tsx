import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HUD_GROUP_KEY, HudMenu, HudTabs, useHudGroup, type HudGroup } from "@/components/game/hud/HudMenu";
import { RotateOverlay, TouchControls } from "@/components/game/hud/TouchHud";
import { HotkeysList } from "@/components/game/HotkeysHelp";
import { runHotkey } from "@/hooks/useHotkeys";
import { clampStick, joystickKeys, keyDiff } from "@/lib/game/touch";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  try { window.localStorage.clear(); } catch { /* none */ }
});

function Menu({ groups }: { groups: HudGroup[] }) {
  const [open, setOpen] = useHudGroup();
  return <HudMenu groups={groups} open={open} onOpen={setOpen} />;
}

const bagGroup = (onBag = () => {}, onWardrobe = () => {}): HudGroup => ({
  id: "bag", icon: "🎒", label: "Túi đồ", badge: 3,
  content: (
    <>
      <button type="button" data-hotkey="bag" onClick={onBag}>Giỏ đồ</button>
      <button type="button" data-hotkey="wardrobe" onClick={onWardrobe}>Tủ đồ</button>
    </>
  ),
});
const settingsGroup: HudGroup = {
  id: "settings", icon: "⚙️", label: "Cài đặt", hotkey: "settings",
  content: (
    <HudTabs tabs={[
      { id: "general", label: "Chung", content: <p>chung</p> },
      { id: "camera", label: "Camera & zoom", reveal: true, content: <button type="button" data-hotkey="zoom">zoom</button> },
      { id: "hotkeys", label: "Phím tắt", content: <HotkeysList /> },
    ]} />
  ),
};

describe("HUD menu (grouped entry points)", () => {
  it("starts with every group closed for a newcomer, the buttons still in the DOM", () => {
    render(<Menu groups={[settingsGroup, bagGroup()]} />);
    expect(screen.getByTestId("hud-group-settings")).not.toBeVisible();
    expect(screen.getByTestId("hud-group-bag")).not.toBeVisible();
    expect(screen.getByTestId("hud-open-bag")).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector('[data-hotkey="bag"]')).not.toBeNull();
    expect(screen.getByTestId("hud-open-bag").textContent).toContain("3");
  });

  it("groups the bag and the wardrobe under 🎒 Túi đồ; one group open at a time, remembered", () => {
    const { unmount } = render(<Menu groups={[settingsGroup, bagGroup()]} />);
    fireEvent.click(screen.getByTestId("hud-open-bag"));
    const bag = screen.getByTestId("hud-group-bag");
    expect(bag).toBeVisible();
    expect(bag).toHaveTextContent("Giỏ đồ");
    expect(bag).toHaveTextContent("Tủ đồ");
    expect(window.localStorage.getItem(HUD_GROUP_KEY)).toBe("bag");
    fireEvent.click(screen.getByTestId("hud-open-settings"));
    expect(screen.getByTestId("hud-group-bag")).not.toBeVisible();
    expect(screen.getByTestId("hud-group-settings")).toBeVisible();
    unmount();
    render(<Menu groups={[settingsGroup, bagGroup()]} />);
    expect(screen.getByTestId("hud-group-settings")).toBeVisible();   // remembered
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(window.localStorage.getItem(HUD_GROUP_KEY)).toBeNull();
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<Menu groups={[bagGroup()]} />);
    fireEvent.click(screen.getByTestId("hud-open-bag"));
    expect(screen.getByTestId("hud-group-bag")).toBeVisible();
    vi.restoreAllMocks();
  });

  it("settings holds Chung, Camera & zoom and the hotkeys list as tabs", () => {
    render(<Menu groups={[settingsGroup]} />);
    fireEvent.click(screen.getByTestId("hud-open-settings"));
    expect(screen.getByTestId("hud-tabpanel-general")).toBeVisible();
    fireEvent.click(screen.getByTestId("hud-tab-hotkeys"));
    expect(screen.getByTestId("hud-tabpanel-hotkeys")).toBeVisible();
    expect(screen.getByTestId("hotkeys-list")).toHaveTextContent("Giỏ đồ");
    expect(screen.getByTestId("hud-tabpanel-general")).not.toBeVisible();
  });

  it("keeps hotkeys working inside closed groups; the zoom key opens Cài đặt → Camera", () => {
    const onBag = vi.fn();
    render(<Menu groups={[settingsGroup, bagGroup(onBag)]} />);
    act(() => { runHotkey("bag", () => {}); });
    expect(onBag).toHaveBeenCalled();
    act(() => { runHotkey("zoom", () => {}); });
    expect(screen.getByTestId("hud-group-settings")).toBeVisible();
    expect(screen.getByTestId("hud-tabpanel-camera")).toBeVisible();
    act(() => { runHotkey("settings", () => {}); });                   // O toggles the group closed again
    expect(screen.getByTestId("hud-group-settings")).not.toBeVisible();
  });
});

function stubMedia(matches: (q: string) => boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: matches(q), media: q, addEventListener: () => {}, removeEventListener: () => {},
  }));
}

describe("phone HUD", () => {
  it("asks a phone held upright to rotate", () => {
    stubMedia(() => true);
    render(<RotateOverlay />);
    expect(screen.getByTestId("rotate-overlay")).toHaveTextContent("Xoay ngang màn hình để chơi");
  });
  it("shows no rotate wall in landscape or on a desktop", () => {
    stubMedia((q) => q.includes("coarse"));
    const { unmount } = render(<RotateOverlay />);
    expect(screen.queryByTestId("rotate-overlay")).toBeNull();
    unmount();
    stubMedia((q) => q.includes("portrait"));
    render(<RotateOverlay />);
    expect(screen.queryByTestId("rotate-overlay")).toBeNull();
  });
  it("shows the touch controls only on a touch screen and not while blocked", () => {
    stubMedia(() => false);
    const { rerender } = render(<TouchControls />);
    expect(screen.queryByTestId("touch-controls")).toBeNull();
    stubMedia((q) => q.includes("coarse"));
    rerender(<TouchControls key="t" />);
    expect(screen.getByTestId("joystick")).toBeInTheDocument();
    rerender(<TouchControls key="t" disabled />);
    expect(screen.queryByTestId("touch-controls")).toBeNull();
  });
  it("the action button presses and releases E as the keyboard would", () => {
    stubMedia((q) => q.includes("coarse"));
    const seen: string[] = [];
    const on = (e: KeyboardEvent) => seen.push(`${e.type}:${e.code}`);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    render(<TouchControls />);
    fireEvent.pointerDown(screen.getByTestId("touch-interact"));
    fireEvent.pointerUp(screen.getByTestId("touch-interact"));
    window.removeEventListener("keydown", on);
    window.removeEventListener("keyup", on);
    expect(seen).toEqual(["keydown:KeyE", "keyup:KeyE"]);
  });
});

describe("joystick → keys", () => {
  const k = (dx: number, dy: number) => [...joystickKeys(dx, dy, 50)].sort();
  it("does nothing inside the dead zone", () => {
    expect(k(0, 0)).toEqual([]);
    expect(k(10, -5)).toEqual([]);
  });
  it("maps the four directions to WASD", () => {
    expect(k(0, -50)).toEqual(["KeyW"]);
    expect(k(0, 50)).toEqual(["KeyS"]);
    expect(k(-50, 0)).toEqual(["KeyA"]);
    expect(k(50, 0)).toEqual(["KeyD"]);
    expect(k(50, -8)).toEqual(["KeyD"]);          // a slight tilt is still straight
  });
  it("presses two keys on a diagonal", () => {
    expect(k(35, -35)).toEqual(["KeyD", "KeyW"]);
    expect(k(-35, 35)).toEqual(["KeyA", "KeyS"]);
  });
  it("diffs the held keys and clamps the knob to the ring", () => {
    expect(keyDiff(new Set(["KeyW"]), new Set(["KeyW", "KeyD"]))).toEqual({ up: [], down: ["KeyD"] });
    expect(keyDiff(new Set(["KeyW", "KeyD"]), new Set())).toEqual({ up: ["KeyW", "KeyD"], down: [] });
    expect(clampStick(100, 0, 50)).toEqual({ x: 50, y: 0 });
    expect(clampStick(10, 10, 50)).toEqual({ x: 10, y: 10 });
  });
});
