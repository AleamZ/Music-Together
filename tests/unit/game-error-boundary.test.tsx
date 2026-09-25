import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import GameErrorBoundary from "@/components/game/GameErrorBoundary";

function Boom(): never {
  throw new Error("boom");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GameErrorBoundary", () => {
  it("renders its children while nothing throws", () => {
    const onError = vi.fn();
    render(<GameErrorBoundary onError={onError}><p>hall</p></GameErrorBoundary>);
    expect(screen.getByText("hall")).toBeInTheDocument();
    expect(onError).not.toHaveBeenCalled();
  });
  it("renders nothing and reports once when the game shell throws", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onError = vi.fn();
    const { container } = render(<GameErrorBoundary onError={onError}><Boom /></GameErrorBoundary>);
    expect(container).toBeEmptyDOMElement();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
