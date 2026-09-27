import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { UmbrellaContext, UmbrellaModal, UmbrellaShelf } from "@/components/game/rain/UmbrellaShelf";
import type { RainView } from "@/hooks/useRain";
import type { RainState } from "@/lib/game/rain/model";

afterEach(cleanup);

const state = (umbrellas: RainState["umbrellas"]): RainState => ({
  wet: false, wetS: 0, drying: false, coldUntilMs: null, struckAtMs: null, brokeAtMs: null, exposed: null, umbrellas, serverNowMs: 1,
});
const view = (s: RainState | null, over: Partial<RainView> = {}): RainView => ({
  state: s, chips: [], cold: false, busy: false, buy: vi.fn(async () => true), hold: vi.fn(), ...over,
});

describe("UmbrellaShelf", () => {
  it("shows nothing outside the game shell", () => {
    const { container } = render(<UmbrellaShelf />);
    expect(container.innerHTML).toBe("");
  });

  it("sells the three umbrellas (too dear ones off) and holds or puts away mine", () => {
    const rain = view(state([{ id: 1, kind: "o_giay", leftS: 1500, held: true }, { id: 2, kind: "o_gap", leftS: 14400, held: false }]));
    render(<UmbrellaContext.Provider value={{ rain, coins: 900 }}><UmbrellaShelf /></UmbrellaContext.Provider>);
    fireEvent.click(screen.getByRole("button", { name: "Mua Ô vải" }));
    expect(rain.buy).toHaveBeenCalledWith("o_vai");
    expect((screen.getByRole("button", { name: "Mua Ô gập cao cấp" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Ô giấy · còn 25 phút mưa")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cất ô" }));
    expect(rain.hold).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole("button", { name: "Cầm" }));
    expect(rain.hold).toHaveBeenCalledWith(2);
  });

  it("the HUD's modal lists only mine", () => {
    const rain = view(state([]));
    render(<UmbrellaContext.Provider value={{ rain, coins: 5 }}><UmbrellaModal shop={false} onClose={() => {}} /></UmbrellaContext.Provider>);
    expect(screen.getByText("Bạn chưa có cây ô nào.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Mua/ })).toBeNull();
  });
});
