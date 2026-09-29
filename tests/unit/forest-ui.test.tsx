import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ChopGame from "@/components/game/forest/ChopGame";
import CookGame from "@/components/game/forest/CookGame";
import { cellTrees, nearestTree, TREES_PER_CELL } from "@/lib/game/forest/near";
import { FOREST_COLS, FOREST_ROWS, forestAt, forestCore } from "@/lib/game/world/forest-grid";
import { localLive } from "@/lib/game/mglive";

describe("the tree I would chop", () => {
  it("is a drawn tràm on a forest cell, numbered within its cell", () => {
    let found = 0;
    for (let cy = 1; cy < FOREST_ROWS - 1 && found < 5; cy++) for (let cx = 1; cx < FOREST_COLS - 1 && found < 5; cx++) {
      if (!forestCore(cx, cy)) continue;
      const trees = cellTrees(cx, cy);
      if (trees.length === 0) continue;
      expect(trees.length).toBeLessThanOrEqual(TREES_PER_CELL);
      const t = nearestTree(trees[0].x + 1, trees[0].y);
      expect(t).not.toBeNull();
      expect(forestAt(t!.cx, t!.cy)).toBe(true);
      expect(t!.k).toBeLessThan(TREES_PER_CELL);
      expect(Math.abs(Math.floor((trees[0].x + 1) / 64) - t!.cx)).toBeLessThanOrEqual(1);   // the server's reach
      found++;
    }
    expect(found).toBeGreaterThan(0);
    expect(nearestTree(-500, -500)).toBeNull();
  }, 30_000);                                                          // the world's scatter is built once: slow under a full run
});

describe("the overlays", () => {
  const round = { tree: "1:2:3", kind: "cay_tre", need: 3, have: 0, axe: "riu_tap_su", power: 1, durability: 60, win: 11 };

  it("the chopping overlay shows the tree and the axe", () => {
    render(<ChopGame view={{ round, phase: "playing", message: "", live: localLive({ 1: { beat: 100 }, 2: { beat: 160 }, 3: { beat: 220 } }) }}
      onEnd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Tre/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Chặt!/ })).toBeTruthy();
    expect(screen.getByText(/0\/3 nhát · rìu 60/)).toBeTruthy();
  });

  it("the chopping overlay's result", () => {
    const onClose = vi.fn();
    render(<ChopGame view={{ round, phase: "done", message: "🌲 Cây đổ!", live: null }} onEnd={vi.fn()} onClose={onClose} />);
    expect(screen.getByText(/Cây đổ/)).toBeTruthy();
    screen.getByRole("button", { name: "Đóng" }).click();
    expect(onClose).toHaveBeenCalled();
  });

  it("the cooking overlay names the dish and its steps", () => {
    render(<CookGame view={{ recipe: "com_tam_suon", steps: ["slice", "fire", "stir"], phase: "playing", message: "", live: localLive({}) }}
      onEnd={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/Cơm tấm sườn/)).toBeTruthy();
    expect(screen.getByText("Bước 1/3")).toBeTruthy();
  });
});
