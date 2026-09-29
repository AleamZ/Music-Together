import { describe, expect, it } from "vitest";
import { appMode } from "@/lib/app-mode";
import { devtoolsDocked, isDevtoolsShortcut, nextFloor, type Gaps } from "@/components/DevtoolsGuard";

describe("devtoolsDocked", () => {
  /** Feeds a sequence of window strips the way the guard does; returns whether each reading counts as open. */
  const run = (seq: Gaps[]) => {
    let floor: Gaps | null = null;
    return seq.map((g) => { floor = nextFloor(floor, g); return devtoolsDocked(floor, g); });
  };
  it("a wide browser sidebar or tall chrome is not DevTools", () => {
    expect(run([{ w: 300, h: 90 }, { w: 300, h: 90 }])).toEqual([false, false]);
    expect(run([{ w: 16, h: 140 }])).toEqual([false]);
  });
  it("a panel opening beside or under the page is caught", () => {
    expect(run([{ w: 16, h: 90 }, { w: 516, h: 90 }])).toEqual([false, true]);
    expect(run([{ w: 16, h: 90 }, { w: 16, h: 390 }])).toEqual([false, true]);
  });
  it("DevTools already open at load is caught, and closing then reopening is caught again", () => {
    expect(run([{ w: 16, h: 480 }, { w: 16, h: 90 }, { w: 16, h: 480 }])).toEqual([true, false, true]);
    expect(run([{ w: 520, h: 90 }, { w: 16, h: 90 }, { w: 16, h: 90 }, { w: 400, h: 90 }])).toEqual([true, false, false, true]);
  });
  it("chrome shrinking (fullscreen exit, a bar closing) never counts", () => {
    expect(run([{ w: 16, h: 130 }, { w: 16, h: 90 }, { w: 16, h: 130 }])).toEqual([false, false, false]);
  });
});

describe("appMode", () => {
  it("follows NEXT_PUBLIC_APP_MODE, else the build", () => {
    expect(appMode("dev", "production")).toBe("dev");
    expect(appMode("prod", "development")).toBe("prod");
    expect(appMode(undefined, "production")).toBe("prod");
    expect(appMode(undefined, "development")).toBe("dev");
    expect(appMode("weird", "test")).toBe("dev");
  });
});

describe("isDevtoolsShortcut", () => {
  const k = (key: string, m: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
    ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...m });
  it("catches F12, Ctrl+Shift+I/J/C, Cmd+Opt+I and view-source", () => {
    expect(isDevtoolsShortcut(k("F12"))).toBe(true);
    expect(isDevtoolsShortcut(k("I", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(k("j", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(k("i", { metaKey: true, altKey: true }))).toBe(true);
    expect(isDevtoolsShortcut(k("u", { ctrlKey: true }))).toBe(true);
  });
  it("leaves the game's own keys alone", () => {
    for (const key of ["i", "b", "e", "F5", "ArrowUp", " "]) expect(isDevtoolsShortcut(k(key))).toBe(false);
    expect(isDevtoolsShortcut(k("c", { ctrlKey: true }))).toBe(false); // copy
  });
});
