import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PeelCard } from "@/components/game/cards/XidachBoard";
import type { Card } from "@/lib/game/cards/deck";

const CARD = { rank: 1, suit: "h" } as unknown as Card;

describe("PeelCard (nặn bài by dragging)", () => {
  it("a long drag opens the card; a short one springs back", () => {
    const onOpen = vi.fn();
    render(<PeelCard card={CARD} index={0} open={false} onOpen={onOpen} />);
    const back = screen.getByRole("button", { name: /Nặn lá 1/ });
    fireEvent.pointerDown(back, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(back, { clientX: 20, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(back, { clientX: 20, clientY: 10, pointerId: 1 });
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.pointerDown(back, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(back, { clientX: 60, clientY: 30, pointerId: 1 });
    fireEvent.pointerUp(back, { clientX: 60, clientY: 30, pointerId: 1 });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
  it("the keyboard opens it too, and an open card has no back", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<PeelCard card={CARD} index={1} open={false} onOpen={onOpen} />);
    fireEvent.keyDown(screen.getByRole("button", { name: /Nặn lá 2/ }), { key: "Enter" });
    expect(onOpen).toHaveBeenCalled();
    rerender(<PeelCard card={CARD} index={1} open onOpen={onOpen} />);
    expect(screen.queryByRole("button", { name: /Nặn lá 2/ })).toBeNull();
  });
});
