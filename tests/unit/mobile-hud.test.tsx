import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import MobileHudDemo from "@/components/game/hud/MobileHudDemo";
import { shortXu, useCompactHud } from "@/components/game/hud/MobileHud";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function media(matches: (q: string) => boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: matches(q), media: q, addEventListener: () => {}, removeEventListener: () => {},
  }));
}
const phone = () => media((q) => q.includes("coarse") || q.includes("max-width"));

describe("compact phone HUD", () => {
  it("applies on a coarse pointer or a small landscape viewport, not on a desktop", () => {
    media(() => false);
    expect(renderHook(() => useCompactHud()).result.current).toBe(false);
    media((q) => q.includes("max-width: 900px"));
    expect(renderHook(() => useCompactHud()).result.current).toBe(true);
    media((q) => q.includes("coarse"));
    expect(renderHook(() => useCompactHud()).result.current).toBe(true);
  });

  it("abbreviates coins", () => {
    expect(shortXu(99_800_000)).toBe("99,8Tr");
    expect(shortXu(12_500)).toBe("12,5N");
    expect(shortXu(1_200_000_000)).toBe("1,2Tỷ");
    expect(shortXu(950)).toBe("950");
    expect(shortXu(null)).toBe("—");
  });

  it("starts collapsed: only ☰, the micro vitals, the pill, the stick, the actions and 💬", () => {
    phone();
    render(<MobileHudDemo />);
    expect(screen.getByTestId("mobile-menu-button")).toBeVisible();
    expect(screen.getByTestId("mobile-coins")).toHaveTextContent("99,8Tr");
    expect(screen.getByTestId("story-pill")).toHaveTextContent("Gặp bác Ba Làng");
    expect(screen.getByTestId("joystick")).toBeInTheDocument();
    expect(screen.getByTestId("touch-interact")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-chat-button")).toBeInTheDocument();
    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
    expect(screen.getByTestId("mobile-sheet-status")).not.toBeVisible();
  });

  it("☰ opens the drawer; tapping outside closes it; the stick hides meanwhile", () => {
    phone();
    render(<MobileHudDemo />);
    fireEvent.click(screen.getByTestId("mobile-menu-button"));
    expect(screen.getByTestId("mobile-drawer")).toHaveTextContent("Túi đồ");
    expect(screen.getByTestId("mobile-drawer")).toHaveTextContent("Giao diện cũ");
    expect(screen.queryByTestId("joystick")).toBeNull();
    fireEvent.click(screen.getByTestId("mobile-drawer-backdrop"));
    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
    expect(screen.getByTestId("joystick")).toBeInTheDocument();
  });

  it("opens one sheet at a time; ✕ closes it; the stick hides while a sheet is open", () => {
    phone();
    render(<MobileHudDemo />);
    fireEvent.click(screen.getByTestId("mobile-menu-button"));
    fireEvent.click(screen.getByTestId("mobile-item-status"));
    expect(screen.queryByTestId("mobile-drawer")).toBeNull();
    expect(screen.getByTestId("mobile-sheet-status")).toBeVisible();
    expect(screen.queryByTestId("joystick")).toBeNull();
    expect(screen.queryByTestId("mobile-chat-button")).toBeNull();
    fireEvent.click(screen.getByTestId("mobile-menu-button"));
    fireEvent.click(screen.getByTestId("mobile-item-bag"));
    expect(screen.getByTestId("mobile-sheet-bag")).toBeVisible();
    expect(screen.getByTestId("mobile-sheet-status")).not.toBeVisible();
    fireEvent.click(screen.getByTestId("mobile-sheet-close-bag"));
    expect(screen.getByTestId("mobile-sheet-bag")).not.toBeVisible();
    expect(screen.getByTestId("joystick")).toBeInTheDocument();
  });

  it("💬 opens the chat sheet with the input; the story pill opens the quest sheet", () => {
    phone();
    render(<MobileHudDemo />);
    fireEvent.click(screen.getByTestId("mobile-chat-button"));
    expect(screen.getByTestId("mobile-sheet-chat")).toBeVisible();
    expect(screen.getByLabelText("Tin nhắn")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mobile-sheet-backdrop-chat"));
    expect(screen.getByTestId("mobile-sheet-chat")).not.toBeVisible();
    fireEvent.click(screen.getByTestId("story-pill-open"));
    expect(screen.getByTestId("mobile-sheet-quests")).toBeVisible();
  });
});
