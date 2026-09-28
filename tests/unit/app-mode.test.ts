import { describe, expect, it } from "vitest";
import { appMode } from "@/lib/app-mode";
import { devtoolsDocked, isDevtoolsShortcut } from "@/components/DevtoolsGuard";

describe("devtoolsDocked", () => {
  it("a wide browser sidebar at load is the baseline, not DevTools", () => {
    expect(devtoolsDocked({ w: 320, h: 90 }, { w: 320, h: 90 })).toBe(false);
  });
  it("a panel opening beside or under the page is caught", () => {
    expect(devtoolsDocked({ w: 16, h: 90 }, { w: 516, h: 90 })).toBe(true);
    expect(devtoolsDocked({ w: 16, h: 90 }, { w: 16, h: 390 })).toBe(true);
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
