import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Look } from "@/lib/game/types";

const { salonStyle } = vi.hoisted(() => ({ salonStyle: vi.fn() }));
vi.mock("@/lib/game/salon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/game/salon")>();
  return { ...actual, salonStyle };
});

import SalonModal from "@/components/game/SalonModal";

const LOOK: Look = {
  skin: "light", hair: "short", hairColor: "black", hat: null, top: "top_tee_blue", bottom: "bottom_jeans",
  shoes: "shoes_dep_blue", neck: null, gender: "nam",
};

function setup() {
  const onStyled = vi.fn();
  render(<SalonModal token="tok" look={LOOK} coins={1000} onStyled={onStyled} onClose={() => {}} />);
  return { onStyled };
}
const doBtn = () => screen.getByRole("button", { name: /Làm tóc/ });

beforeEach(() => salonStyle.mockReset());
afterEach(() => cleanup());

describe("SalonModal", () => {
  it("starts with no change and the button disabled", () => {
    setup();
    expect(screen.getByTestId("salon-price").textContent).toContain("Chọn kiểu");
    expect((doBtn() as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows 300 for a style, then 700 with a colour too", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Tóc xoăn/ }));
    expect(screen.getByTestId("salon-price").textContent).toContain("300");
    expect(doBtn().textContent).toContain("300 xu");
    fireEvent.click(screen.getByRole("button", { name: "Xanh dương" }));
    expect(screen.getByTestId("salon-price").textContent).toContain("700");
    expect(doBtn().textContent).toContain("700 xu");
  });

  it("calls the RPC once and hands the new look up", async () => {
    salonStyle.mockResolvedValue({ hair: "curly", hairColor: "blue", paid: 700, coins: 300 });
    const { onStyled } = setup();
    fireEvent.click(screen.getByRole("button", { name: /Tóc xoăn/ }));
    fireEvent.click(screen.getByRole("button", { name: "Xanh dương" }));
    fireEvent.click(doBtn());
    await waitFor(() => expect(onStyled).toHaveBeenCalledWith({ ...LOOK, hair: "curly", hairColor: "blue" }));
    expect(salonStyle).toHaveBeenCalledTimes(1);
    expect(salonStyle).toHaveBeenCalledWith("tok", "curly", "blue");
  });

  it("shows the server's rejection in Vietnamese", async () => {
    salonStyle.mockRejectedValueOnce({ message: "insufficient funds" });
    const { onStyled } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Đỏ" }));
    fireEvent.click(doBtn());
    expect((await screen.findByRole("alert")).textContent).toBe("Không đủ xu để làm tóc.");
    expect(onStyled).not.toHaveBeenCalled();
  });
});
