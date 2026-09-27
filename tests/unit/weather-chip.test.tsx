import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WeatherChip, { chipLabel, effectsText } from "@/components/game/WeatherChip";
import { effects, type RoomWeather } from "@/lib/game/weather/model";
import { fishingErrorMessage } from "@/lib/game/fishing/rpc";
import { farmErrorMessage } from "@/lib/game/farm/messages";
import { STORM_TEXT } from "@/lib/game/weather/rpc";

afterEach(cleanup);

const W = (kind: RoomWeather["kind"], isDay = true): RoomWeather => ({
  kind, code: 61, isDay, sunriseMs: null, sunsetMs: null, rainMm: 2, windKmh: 10, updatedAtMs: 1,
});

describe("WeatherChip", () => {
  it("label with icon and temperature", () => {
    expect(chipLabel(W("rain"), 24.3)).toBe("\u{1F327}️ Mưa · 24°C");
    expect(chipLabel(W("clear", false), null)).toBe("☀️ Nắng đêm");
  });

  it("effects text", () => {
    expect(effectsText(effects("rain", true))).toContain("Cá cắn ít hơn, cá lớn nhiều hơn");
    expect(effectsText(effects("rain", true))).toContain("Không phơi lúa được");
    expect(effectsText(effects("storm", true))).toContain("Cầu câu đóng cửa");
    expect(effectsText(effects("storm", true))).toContain("Xe chạy chậm hơn");
    expect(effectsText(effects("cloudy", false))).toContain("Lúa ngừng lớn ban đêm");
  });

  it("renders the chip with a tooltip; the owner can open the location dialog", () => {
    const open = vi.fn();
    render(<WeatherChip weather={W("rain")} tempC={24} isOwner needsLocation={false} onOpenLocation={open} />);
    const chip = screen.getByTestId("weather-chip");
    expect(chip.textContent).toContain("Mưa · 24°C");
    expect(chip.getAttribute("title")).toContain("Không phơi lúa được");
    fireEvent.click(chip);
    expect(open).toHaveBeenCalled();
  });

  it("no weather: nothing for members, a location prompt for the owner", () => {
    const { container } = render(<WeatherChip weather={null} tempC={null} isOwner={false} needsLocation onOpenLocation={() => {}} />);
    expect(container.textContent).toBe("");
    cleanup();
    render(<WeatherChip weather={null} tempC={null} isOwner needsLocation onOpenLocation={() => {}} />);
    expect(screen.getByRole("button").textContent).toContain("Chọn vị trí");
  });
});

it("maps the storm refusal", () => {
  expect(fishingErrorMessage({ message: "storm" })).toBe(STORM_TEXT);
  expect(farmErrorMessage({ message: "storm" })).toBe(STORM_TEXT);
  expect(STORM_TEXT).toBe("Bão lớn — cầu câu tạm đóng, đợi trời yên nhé!");
});
