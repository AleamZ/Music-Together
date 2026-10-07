import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ChopGame from "@/components/game/forest/ChopGame";
import { bowBonus, panBonus, SELL_MAX, TOOLS } from "@/lib/game/forest/catalog";
import { cellTrees, nearestTree } from "@/lib/game/forest/near";
import { forestErrorText } from "@/lib/game/forest/rpc";
import { leaseTooShort } from "@/lib/game/farm/actions";
import type { PlotView } from "@/lib/game/farm/state";
import { hotkeyFor, hotkeyLabel, hotkeyTargets } from "@/lib/game/hotkeys";
import { newTools, parseProfState } from "@/lib/game/professions/model";
import { parseWild, worldErrorText } from "@/lib/game/realm/rpc";
import { FOREST_COLS, FOREST_ROWS, forestCore } from "@/lib/game/world/forest-grid";
import { runHotkey } from "@/hooks/useHotkeys";

// 0121: the unfinished parts of Săn bắt / Tiều phu (supabase/migrations/0121_forest_finish.sql; the SQL side is pinned by
// tests/sql/forest-finish-smoke.sql), and 0120's lease warning.
afterEach(cleanup);

describe("tool tiers (0121 _bow_bonus / _pan_bonus)", () => {
  it("give 5 hunt points / 4 dish points a tier above the first", () => {
    expect([1, 2, 3].map(bowBonus)).toEqual([0, 5, 10]);
    expect([1, 2, 3].map(panBonus)).toEqual([0, 4, 8]);
    const bows = TOOLS.filter((t) => t.kind === "bow").map((t) => [t.id, bowBonus(t.power)]);
    expect(bows).toEqual([["cung_tap_su", 0], ["cung_tre", 0], ["cung_go_tram", 5], ["cung_go_cung", 10]]);
    expect(SELL_MAX).toBe(999);
  });
});

describe("the tree I would chop (0121)", () => {
  it("skips a stump for a standing tree in reach, and falls back to the stump when none stands", () => {
    let done = false;
    for (let cy = 1; cy < FOREST_ROWS - 1 && !done; cy++) for (let cx = 1; cx < FOREST_COLS - 1 && !done; cx++) {
      if (!forestCore(cx, cy)) continue;
      const trees = cellTrees(cx, cy);
      if (trees.length < 2) continue;
      const [a, b] = trees;
      if (Math.hypot(a.x - b.x, a.y - b.y) > 40) continue;
      const x = a.x + (b.x - a.x) * 0.25, y = a.y + (b.y - a.y) * 0.25;           // nearer to a than to b
      const first = nearestTree(x, y, 44, () => false)!;
      expect(`${first.cx}:${first.cy}:${first.k}`).toBe(`${cx}:${cy}:0`);
      const felledA = (key: string) => key === `${cx}:${cy}:0`;
      const next = nearestTree(x, y, 44, felledA)!;
      expect(`${next.cx}:${next.cy}:${next.k}`).not.toBe(`${cx}:${cy}:0`);       // the standing one behind it
      const stump = nearestTree(a.x, a.y, 1, felledA)!;                            // only the stump in reach
      expect(`${stump.cx}:${stump.cy}:${stump.k}`).toBe(`${cx}:${cy}:0`);
      done = true;
    }
    expect(done).toBe(true);
  }, 30_000);
});

describe("the chopping overlay's next round (0121)", () => {
  const round = { tree: "1:2:3", kind: "cay_tre", need: 3, have: 1, axe: "riu_tap_su", power: 1, durability: 60, win: 11 };
  it("offers Chặt tiếp while the tree stands, on the button and on Space", () => {
    const again = vi.fn();
    render(<ChopGame view={{ round, phase: "done", message: "1/3 nhịp → 2 nhát (3/3)", live: null }} onEnd={vi.fn()} onClose={vi.fn()} onAgain={again} />);
    fireEvent.click(screen.getByRole("button", { name: /Chặt tiếp/ }));
    fireEvent.keyDown(window, { code: "Space" });
    expect(again).toHaveBeenCalledTimes(2);
  });
  it("has no Chặt tiếp once the tree is down", () => {
    render(<ChopGame view={{ round, phase: "done", message: "🌲 Cây đổ!", live: null }} onEnd={vi.fn()} onClose={vi.fn()} onAgain={null} />);
    expect(screen.queryByRole("button", { name: /Chặt tiếp/ })).toBeNull();
  });
});

describe("G chops at the forest (0121)", () => {
  it("falls back to the chop button when the farm tasks are not on screen", () => {
    expect(hotkeyFor({ code: "KeyG", ctrlKey: false, metaKey: false, altKey: false, repeat: false, target: null },
      { enabled: true, helpOpen: false, offer: false })).toBe("farmTasks");
    expect(hotkeyTargets("farmTasks")).toEqual(["farmTasks", "chop"]);
    expect(hotkeyLabel("chop")).toBe("G");
    const root = document.createElement("div");
    const chop = document.createElement("button");
    chop.setAttribute("data-hotkey", "chop");
    const onClick = vi.fn();
    chop.addEventListener("click", onClick);
    root.appendChild(chop);
    expect(runHotkey("farmTasks", () => {}, root)).toBe(true);
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe("texts (0121)", () => {
  it("say where to get a bow or an axe", () => {
    expect(worldErrorText({ message: "no bow" })).toMatch(/Sạp thợ săn \(Bãi đất trống\)/);
    expect(forestErrorText({ message: "no axe" })).toMatch(/mua hoặc sửa rìu ở Sạp thợ săn/);
    expect(forestErrorText({ message: "not in forest" })).toMatch(/đốn cây/);
    expect(forestErrorText({ message: "rate limited" })).toMatch(/quá nhanh/);
  });
});

describe("parsers (0121)", () => {
  it("read the bow at hand from _wild_json, unknown before 0121", () => {
    const base = { animals: [], bag: {}, album: {}, kills_today: 0 };
    expect(parseWild(base)?.bow).toBeUndefined();
    expect(parseWild({ ...base, bow: null })?.bow).toBeNull();
    expect(parseWild({ ...base, bow: { item: "cung_go_tram", durability: 9, max: 110, power: 2, bonus: 5 } })?.bow)
      .toEqual({ item: "cung_go_tram", durability: 9, max: 110, power: 2, bonus: 5 });
  });
  it("tell the starter tool that came with a profession", () => {
    const s = (tools: unknown[]) => parseProfState({ profs: [], skills: [], tools })!;
    expect(newTools(s([]), s([{ item: "riu_tap_su", durability: 60, max: 60 }]))).toEqual(["riu_tap_su"]);
    expect(newTools(s([{ item: "riu_tap_su", durability: 3, max: 60 }]), s([{ item: "riu_tap_su", durability: 3, max: 60 }]))).toEqual([]);
  });
});

describe("the lease warning (0120: a lease runs 96 h through several crops)", () => {
  const H = 3_600_000;
  const p = (until: number | null): PlotView => ({
    no: 5, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: { id: "me", name: "me" },
    lease: until === null ? null : { source: "village", until, price: 10000 }, offers: 0, crop: null,
  }) as unknown as PlotView;
  it("warns only when the crop would not be in before the lease ends", () => {
    expect(leaseTooShort(p(30 * H), 24, 0)).toBeUndefined();
    expect(leaseTooShort(p(null), 24, 0)).toBeUndefined();
    expect(leaseTooShort(p(10 * H), 16, 0)).toBe("Còn 10 giờ hạn thuê mà vụ này cần ~16 giờ mới chín — hết hạn thuê là mất cả vụ.");
  });
});
