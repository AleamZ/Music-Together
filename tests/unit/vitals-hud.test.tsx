import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import VitalsHud from "@/components/game/VitalsHud";

afterEach(cleanup);

describe("VitalsHud", () => {
  it("shows both values rounded, and flags low ones", () => {
    render(<VitalsHud state={{ hunger: 24.4, thirst: 80.6, faintedUntilMs: null, serverNowMs: 0 }} />);
    expect(screen.getByLabelText("Đói").textContent).toContain("24");
    expect(screen.getByLabelText("Khát").textContent).toContain("81");
    expect(screen.getByLabelText("Đói").getAttribute("data-low")).toBe("true");
    expect(screen.getByLabelText("Khát").getAttribute("data-low")).toBe("false");
  });

  it("renders a placeholder before the first tick", () => {
    render(<VitalsHud state={null} />);
    expect(screen.getByLabelText("Đói").textContent).toContain("—");
  });
});
