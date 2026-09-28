import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FightOverlay from "@/components/game/fight/FightOverlay";
import { IN_BL, IN_DOWN, IN_HK, IN_HP, IN_LEFT, IN_LK, IN_LP, IN_RIGHT, IN_SK, IN_UP } from "@/lib/game/fight/engine";
import { KEY_BITS, maskFromKeys, padDirAt, padMask } from "@/lib/game/fight/input";
import { PUNCH_BAG, PUNCH_BAG_USE } from "@/lib/game/maps/market";
import { propFrame } from "@/lib/game/maps/props";
import { getMap } from "@/lib/game/maps/registry";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { DEFAULT_LOOK } from "@/lib/game/look";

afterEach(cleanup);

describe("fight input", () => {
  it("maps the spec's keys to the 10-bit mask", () => {
    expect(maskFromKeys(["KeyA", "ArrowRight", "KeyW", "KeyS"])).toBe(IN_LEFT | IN_RIGHT | IN_UP | IN_DOWN);
    expect(maskFromKeys(["KeyU", "KeyI", "KeyJ", "KeyK", "KeyL", "KeyO"])).toBe(IN_LP | IN_HP | IN_LK | IN_HK | IN_BL | IN_SK);
    expect(maskFromKeys(["KeyQ", "Space"])).toBe(0);
    expect(Object.keys(KEY_BITS)).toHaveLength(14);
  });

  it("reads the 8-way touch pad", () => {
    expect(padDirAt(0, 0, 10)).toBeNull();
    expect(padDirAt(40, 0, 10)).toBe("r");
    expect(padDirAt(0, -40, 10)).toBe("u");
    expect(padDirAt(-30, 30, 10)).toBe("dl");
    expect(padMask("dr")).toBe(IN_DOWN | IN_RIGHT);
    expect(padMask(null)).toBe(0);
  });
});

describe("the punching bag at Chợ Lớn", () => {
  it("stands on the south pavement with a reachable use spot facing down", () => {
    const market = getMap("market");
    const bag = market.interactables.find((i) => i.kind === "punch_bag")!;
    expect(bag).toMatchObject({ id: "punch_bag", label: "Bao cát · Luyện võ", use: { x: 1090, y: 318 }, face: "down" });
    expect(PUNCH_BAG).toEqual({ x: 1090, y: 336 });
    expect(PUNCH_BAG_USE).toEqual({ x: 1090, y: 318 });
    const prop = market.props.find((p) => p.kind === "punch_bag")!;
    const f = propFrame(prop);
    expect({ x: prop.x - f.ox, y: prop.y - f.oy, w: f.w, h: f.h }).toEqual(bag.rect);
    expect(isBlockedAt(market, prop.x, prop.y - 2)).toBe(true);
    expect(isBlockedAt(market, bag.use.x, bag.use.y)).toBe(false);
    expect(findPath(market, market.spawn, bag.use)).not.toBeNull();
  });

  it("GameShell opens the practice overlay and keeps every other case", () => {
    const src = readFileSync("components/game/GameShell.tsx", "utf8");
    const start = src.indexOf("const onInteract = useCallback(");
    const body = src.slice(start, src.indexOf("default:", start));
    expect(body).toContain('case "punch_bag":');
    expect(body.slice(body.indexOf('case "punch_bag":'))).toContain('setPanel("fight_practice")');
    expect(src).toContain('panel === "fight_practice" && <FightOverlay');
  });
});

describe("FightOverlay (practice)", () => {
  it("offers the practice options, then opens the arena", () => {
    render(<FightOverlay look={DEFAULT_LOOK} name="Tôi" onClose={() => {}} />);
    expect(screen.getByText("🥊 Bao cát · Luyện võ")).toBeTruthy();
    for (const l of [1, 2, 3, 4, 5]) expect(screen.getByRole("radio", { name: `Cấp ${l}` })).toBeTruthy();
    expect(screen.getByText("Bao cát đứng yên (không đánh trả)")).toBeTruthy();
    expect(screen.getByText("Hiện khung đòn (hitbox)")).toBeTruthy();
    expect(screen.getByTestId("fight-legend").textContent).toContain("quật");
    fireEvent.click(screen.getByRole("radio", { name: "Cấp 4" }));
    expect(screen.getByRole("radio", { name: "Cấp 4" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByText("Vào đấu"));
    expect(screen.getByRole("dialog", { name: "Sàn luyện tập" })).toBeTruthy();
    expect(screen.getByLabelText("Tôi đấu với Bạn tập cấp 4")).toBeTruthy();
    expect(screen.getByTestId("fight-touch")).toBeTruthy();
  });

  it("Esc asks before leaving; the fight's keys never reach the page", () => {
    const onClose = vi.fn();
    render(<FightOverlay look={DEFAULT_LOOK} name="Tôi" onClose={onClose} />);
    fireEvent.click(screen.getByText("Vào đấu"));
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    fireEvent.keyDown(window, { key: "u", code: "KeyU" });
    expect(outer).not.toHaveBeenCalled();
    document.removeEventListener("keydown", outer);
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    expect(screen.getByText("Thoát luyện tập?")).toBeTruthy();
    fireEvent.click(screen.getByText("Tập tiếp"));
    expect(screen.queryByText("Thoát luyện tập?")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape", code: "Escape" });
    fireEvent.click(screen.getByText("Thoát"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the setup's Để sau closes it", () => {
    const onClose = vi.fn();
    render(<FightOverlay look={DEFAULT_LOOK} name="Tôi" onClose={onClose} />);
    fireEvent.click(screen.getByText("Để sau"));
    expect(onClose).toHaveBeenCalled();
  });
});
