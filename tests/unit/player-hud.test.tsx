import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FishingHud, { CoinsChip } from "@/components/game/fishing/FishingHud";
import PersonalSettings from "@/components/game/PersonalSettings";
import type { FishingState } from "@/lib/game/fishing/state";

afterEach(cleanup);

const state = { coins: 1234, bait: {}, baitCap: 20, fish: [], fishCap: 30 } as unknown as FishingState;

describe("player HUD pieces", () => {
  it("shows the coins, with a dash before the state loads", () => {
    const { rerender } = render(<CoinsChip state={null} />);
    expect(screen.getByTestId("hud-coins")).toHaveTextContent("🪙 —");
    rerender(<CoinsChip state={state} />);
    expect(screen.getByTestId("hud-coins").textContent).toContain("1.234");
  });
  it("shows bait and fish as a compact chip with the long text in its tooltip; the field's rice line replaces it", () => {
    const { rerender } = render(<FishingHud state={state} failed={false} onReload={() => {}} />);
    const chip = screen.getByTestId("hud-status");
    expect(chip.textContent).toContain("🐟 0/30");
    expect(chip.getAttribute("title")).toContain("Cá: 0/30");
    rerender(<FishingHud state={state} failed={false} onReload={() => {}} riceLine="🌾 Chưa có lúa" />);
    expect(screen.getByTestId("hud-status")).toHaveTextContent("🌾 Chưa có lúa");
    expect(screen.getByTestId("hud-status").getAttribute("title")).toBe("🌾 Chưa có lúa");
  });
  it("offers a reload when the state failed", () => {
    const onReload = vi.fn();
    render(<FishingHud state={null} failed onReload={onReload} />);
    expect(screen.queryByTestId("hud-status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "🔄 Tải lại giỏ đồ" }));
    expect(onReload).toHaveBeenCalled();
  });
  it("keeps the settings button's name while showing only its icon", () => {
    render(<PersonalSettings weatherFx={2 as never} onWeatherFx={() => {}} />);
    const btn = screen.getByRole("button", { name: "Cài đặt cá nhân" });
    expect(btn.textContent?.trim()).toBe("⚙️O"); // the icon and its hotkey badge
    expect(btn.getAttribute("title")).toBe("Cài đặt cá nhân (O)");
  });
});
