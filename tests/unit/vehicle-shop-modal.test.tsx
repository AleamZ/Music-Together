import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { buyVehicle, sellVehicle } = vi.hoisted(() => ({ buyVehicle: vi.fn(), sellVehicle: vi.fn() }));
vi.mock("@/lib/game/travel/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/travel/rpc")>();
  return { ...actual, buyVehicle, sellVehicle };
});

import VehicleShopModal from "@/components/game/VehicleShopModal";

function setup(owned: string[] = []) {
  const onBought = vi.fn(), onSold = vi.fn();
  render(<VehicleShopModal token="tok" owned={owned} coins={200000} onBought={onBought} onSold={onSold} onClose={() => {}} />);
  return { onBought, onSold };
}

beforeEach(() => { buyVehicle.mockReset(); sellVehicle.mockReset(); });
afterEach(() => cleanup());

describe("VehicleShopModal", () => {
  it("shows the three vehicles with their prices and trip times", () => {
    setup();
    const cards = [["bike", "5.000", "10 giây"], ["moto", "30.000", "5 giây"], ["car", "150.000", "2 giây"]] as const;
    for (const [id, price, time] of cards) {
      const card = screen.getByTestId(`vehicle-${id}`);
      expect(card.textContent).toContain(price);
      expect(card.textContent).toContain(time);
    }
  });

  it("marks an owned vehicle Đã có, with no Mua button", () => {
    setup(["moto"]);
    const moto = within(screen.getByTestId("vehicle-moto"));
    expect(moto.getByText("Đã có")).toBeTruthy();
    expect(moto.queryByRole("button", { name: "Mua" })).toBeNull();
    expect(within(screen.getByTestId("vehicle-bike")).getByRole("button", { name: "Mua" })).toBeTruthy();
  });

  it("buys a vehicle and hands the new owned list up", async () => {
    buyVehicle.mockResolvedValue({ owned: ["bike"], coins: 195000 });
    const { onBought } = setup();
    fireEvent.click(within(screen.getByTestId("vehicle-bike")).getByRole("button", { name: "Mua" }));
    await waitFor(() => expect(onBought).toHaveBeenCalledWith(["bike"]));
    expect(buyVehicle).toHaveBeenCalledWith("tok", "bike");
  });

  it("sells an owned vehicle back at half price after a confirm", async () => {
    sellVehicle.mockResolvedValue({ owned: [], coins: 202500 });
    const { onSold, onBought } = setup(["bike"]);
    const bike = within(screen.getByTestId("vehicle-bike"));
    fireEvent.click(bike.getByRole("button", { name: "Bán lại (2.500 xu)" }));
    expect(bike.getByText("Bán xe đạp lấy 2.500 xu?")).toBeTruthy();
    expect(sellVehicle).not.toHaveBeenCalled();
    fireEvent.click(bike.getByRole("button", { name: "Thôi" }));
    expect(bike.queryByText("Bán xe đạp lấy 2.500 xu?")).toBeNull();
    fireEvent.click(bike.getByRole("button", { name: "Bán lại (2.500 xu)" }));
    fireEvent.click(bike.getByRole("button", { name: "Bán" }));
    await waitFor(() => expect(onSold).toHaveBeenCalledWith([]));
    expect(sellVehicle).toHaveBeenCalledWith("tok", "bike");
    expect(onBought).not.toHaveBeenCalled();
  });

  it("shows the sell refusal in Vietnamese", async () => {
    sellVehicle.mockRejectedValueOnce({ message: "not owned" });
    setup(["car"]);
    const car = within(screen.getByTestId("vehicle-car"));
    fireEvent.click(car.getByRole("button", { name: "Bán lại (75.000 xu)" }));
    fireEvent.click(car.getByRole("button", { name: "Bán" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Bạn không có xe này để bán.");
  });

  it("shows the Vietnamese refusal", async () => {
    buyVehicle.mockRejectedValueOnce({ message: "insufficient funds" });
    const { onBought } = setup();
    fireEvent.click(within(screen.getByTestId("vehicle-car")).getByRole("button", { name: "Mua" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Không đủ xu");
    expect(onBought).not.toHaveBeenCalled();
  });
});
