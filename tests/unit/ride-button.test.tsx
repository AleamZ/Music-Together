import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RideButton from "@/components/game/RideButton";
import {
  CAR_POND_TEXT, dismountText, interactBlocked, mountRefusal, ownedVehicles, pickMount, STARVING_RIDE_TEXT,
} from "@/lib/game/travel/ride";

afterEach(cleanup);

const setup = (p: Partial<React.ComponentProps<typeof RideButton>> = {}) => {
  const onMount = vi.fn(), onDismount = vi.fn();
  render(<RideButton owned={[]} riding={null} last={null} keyEnabled onMount={onMount} onDismount={onDismount} {...p} />);
  return { onMount, onDismount };
};

describe("RideButton", () => {
  it("hides with no vehicle", () => {
    const { container } = render(
      <RideButton owned={[]} riding={null} last={null} keyEnabled onMount={() => {}} onDismount={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });
  it("one vehicle mounts at once", () => {
    const { onMount } = setup({ owned: ["bike"] });
    fireEvent.click(screen.getByRole("button", { name: /Lên xe/ }));
    expect(onMount).toHaveBeenCalledWith("bike");
  });
  it("riding shows Xuống xe", () => {
    const { onDismount } = setup({ owned: ["bike"], riding: "bike" });
    fireEvent.click(screen.getByRole("button", { name: /Xuống xe/ }));
    expect(onDismount).toHaveBeenCalled();
  });
  it("several vehicles open a picker", () => {
    const { onMount } = setup({ owned: ["bike", "car"] });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Lên xe/ }));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((b) => b.textContent)).toEqual(["🚗 Xe hơi", "🚲 Xe đạp"]);
    fireEvent.click(items[1]);
    expect(onMount).toHaveBeenCalledWith("bike");
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("R toggles: the last vehicle, else the fastest; off while typing or disabled", () => {
    const a = setup({ owned: ["bike", "moto"] });
    fireEvent.keyDown(window, { key: "r" });
    expect(a.onMount).toHaveBeenCalledWith("moto");
    cleanup();
    const b = setup({ owned: ["bike", "moto"], last: "bike" });
    fireEvent.keyDown(window, { key: "R" });
    expect(b.onMount).toHaveBeenCalledWith("bike");
    cleanup();
    const c = setup({ owned: ["bike"], riding: "bike" });
    fireEvent.keyDown(window, { key: "r" });
    expect(c.onDismount).toHaveBeenCalled();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "r" });
    expect(c.onDismount).toHaveBeenCalledTimes(1);
    input.remove();
    cleanup();
    const d = setup({ owned: ["bike"], keyEnabled: false });
    fireEvent.keyDown(window, { key: "r" });
    expect(d.onMount).not.toHaveBeenCalled();
  });
});

describe("ride gates", () => {
  it("picks", () => {
    expect(ownedVehicles(["bike", "car"])).toEqual(["car", "bike"]);
    expect(pickMount([], null)).toBeNull();
    expect(pickMount(["bike", "car"], "bike")).toBe("bike");
    expect(pickMount(["car"], "bike")).toBe("car");
  });
  it("refuses the car at the pond, starving, and silently while busy", () => {
    expect(mountRefusal({ map: "pond", v: "car", starving: false, busy: false })).toBe(CAR_POND_TEXT);
    expect(mountRefusal({ map: "pond", v: "bike", starving: false, busy: false })).toBeNull();
    expect(mountRefusal({ map: "hall", v: "car", starving: true, busy: false })).toBe(STARVING_RIDE_TEXT);
    expect(mountRefusal({ map: "hall", v: "car", starving: false, busy: true })).toBe("");
  });
  it("an interaction while riding is refused with the toast", () => {
    expect(interactBlocked("bike", "restaurant")).toBe(true);
    expect(dismountText("Câu cá")).toBe("Xuống xe để câu cá nhé!");
  });
});
