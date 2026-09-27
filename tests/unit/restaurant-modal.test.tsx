import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MENU, mealPrice } from "@/lib/game/market/menu";
import type { FishRow } from "@/lib/game/fishing/state";

const { eatMeal } = vi.hoisted(() => ({ eatMeal: vi.fn() }));
vi.mock("@/lib/game/market/rpc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/market/rpc")>();
  return { ...actual, eatMeal };
});

import RestaurantModal from "@/components/game/RestaurantModal";

const FISH: FishRow[] = [
  { id: "f1", speciesId: "ca_ro", weightG: 400, price: 10, caughtAt: "2026-09-01" },
  { id: "f2", speciesId: "ca_loc", weightG: 2600, price: 90, caughtAt: "2026-09-02" },
];
const RARITY: Record<string, number> = { ca_ro: 1, ca_loc: 3 };
const NAMES: Record<string, string> = { ca_ro: "Cá rô", ca_loc: "Cá lóc" };

function setup() {
  const onAte = vi.fn();
  render(
    <RestaurantModal token="tok" fish={FISH} rarityOf={(id) => RARITY[id] ?? 1} speciesName={(id) => NAMES[id] ?? id}
      onAte={onAte} onClose={() => {}} />,
  );
  return { onAte };
}

beforeEach(() => eatMeal.mockReset());
afterEach(() => cleanup());

describe("RestaurantModal", () => {
  it("lists the foods and drinks by tab with prices", () => {
    setup();
    const foods = MENU.filter((m) => m.kind === "food");
    expect(foods).toHaveLength(7);
    for (const f of foods) {
      const card = screen.getByRole("button", { name: new RegExp(f.name) });
      expect(card.textContent).toContain(`${f.price} xu`);
    }
    fireEvent.click(screen.getByRole("button", { name: /🥤 Uống/ }));
    const drinks = MENU.filter((m) => m.kind === "drink");
    expect(drinks).toHaveLength(5);
    for (const d of drinks) expect(screen.getByRole("button", { name: new RegExp(d.name) })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Phở bò/ })).toBeNull();
  });

  it("offers the bag's fish on a fish dish and discounts the price", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Cá kho tộ/ }));
    const select = screen.getByLabelText("Chọn cá") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.options[0].textContent).toBe("Không dùng cá");
    // the rarer, heavier fish ranks first
    expect(select.options[1].textContent).toMatch(/Cá lóc · 2\.6 kg · −54%/);
    expect(select.options[2].textContent).toMatch(/Cá rô · 0\.4 kg · −21%/);
    const item = MENU.find((m) => m.id === "ca_kho_to")!;
    fireEvent.change(select, { target: { value: "f2" } });
    const expected = mealPrice(item, { rarity: 3, weightG: 2600 });
    expect(screen.getByTestId("final-price").textContent).toBe(`${expected} xu`);
    expect(screen.getAllByText("−54%").length).toBeGreaterThan(0);
  });

  it("orders once and reports the result", async () => {
    const res = { paid: 276, discountPct: 54, coins: 1000, vitals: null };
    eatMeal.mockResolvedValue(res);
    const { onAte } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Cá kho tộ/ }));
    fireEvent.change(screen.getByLabelText("Chọn cá"), { target: { value: "f2" } });
    fireEvent.click(screen.getByRole("button", { name: "Gọi món" }));
    await waitFor(() => expect(onAte).toHaveBeenCalledWith(res));
    expect(eatMeal).toHaveBeenCalledTimes(1);
    expect(eatMeal).toHaveBeenCalledWith("tok", "ca_kho_to", "f2");
  });

  it("orders without a fish by default", async () => {
    eatMeal.mockResolvedValue({ paid: 300, discountPct: 0, coins: 5, vitals: null });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Gọi món" }));
    await waitFor(() => expect(eatMeal).toHaveBeenCalledWith("tok", "com_tam", null));
  });

  it("shows the Vietnamese error when the coins run short", async () => {
    eatMeal.mockRejectedValueOnce({ message: "insufficient funds" });
    const { onAte } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Gọi món" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Không đủ xu để gọi món này.");
    expect(onAte).not.toHaveBeenCalled();
  });
});
