import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import WeatherLocationDialog from "@/components/game/WeatherLocationDialog";
import { loadLoc, LOC_KEY, saveLoc, type CityHit } from "@/lib/game/weather/openmeteo";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

function mount() {
  const onPick = vi.fn((l: CityHit) => saveLoc(l));
  const onClose = vi.fn();
  render(<WeatherLocationDialog current={null} onPick={onPick} onClose={onClose} />);
  return { onPick, onClose };
}

describe("WeatherLocationDialog", () => {
  it("searches a city and stores the chosen one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ results: [
        { name: "Huế", admin1: "Thừa Thiên Huế", country: "Việt Nam", latitude: 16.46190, longitude: 107.59546 },
        { name: "Huế", country: "Việt Nam", latitude: 16.5, longitude: 107.6 },
      ] }),
    })));
    const { onPick, onClose } = mount();
    fireEvent.change(screen.getByLabelText("Tên thành phố"), { target: { value: "Huế" } });
    fireEvent.click(screen.getByRole("button", { name: "Tìm" }));
    const hit = await screen.findByRole("button", { name: "Huế, Thừa Thiên Huế, Việt Nam" });
    fireEvent.click(hit);
    expect(onPick).toHaveBeenCalledWith({ lat: 16.4619, lon: 107.59546, label: "Huế, Thừa Thiên Huế, Việt Nam" });
    expect(onClose).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(LOC_KEY)!)).toEqual({ lat: 16.46, lon: 107.6, label: "Huế, Thừa Thiên Huế, Việt Nam" });
    expect(loadLoc()).toEqual({ lat: 16.46, lon: 107.6, label: "Huế, Thừa Thiên Huế, Việt Nam" });
  });

  it("uses the current position via geolocation", async () => {
    const getCurrentPosition = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 10.7769, longitude: 106.7009 } } as GeolocationPosition));
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition } });
    const { onPick } = mount();
    fireEvent.click(screen.getByRole("button", { name: "Dùng vị trí hiện tại" }));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    expect(loadLoc()).toEqual({ lat: 10.78, lon: 106.7, label: "Vị trí hiện tại" });
  });

  it("geolocation refused shows a hint", async () => {
    vi.stubGlobal("navigator", { ...navigator, geolocation: { getCurrentPosition: (_: unknown, err: () => void) => err() } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Dùng vị trí hiện tại" }));
    expect((await screen.findByRole("alert")).textContent).toContain("tìm theo tên");
  });
});
