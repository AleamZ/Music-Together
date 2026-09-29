import { beforeEach, describe, expect, it } from "vitest";
import {
  CAM_PRESETS, CAM_STORAGE_KEY, CAM_ZOOM, cyclePreset, DEFAULT_CAM, getCam, loadCam, parseCam, pickPreset, pinchBy,
  resetCamForTests, saveCam, CAM_FIXED_YAW, dragLook, FP_PITCH, thirdPersonOrbit, setCam, subscribeCam, toggleView, zoomBy, type GameCam,
} from "@/lib/game/diorama/world/game-camera";
import { HOTKEYS } from "@/lib/game/hotkeys";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe("game camera (3D)", () => {
  beforeEach(() => {
    resetCamForTests();
    try { localStorage.clear(); } catch { /* none */ }
  });

  it("starts third-person at the mid preset", () => {
    expect(DEFAULT_CAM).toEqual({ view: "third", preset: "mid", distance: CAM_PRESETS.mid });
    expect(CAM_PRESETS.near).toBeLessThan(CAM_PRESETS.mid);
    expect(CAM_PRESETS.mid).toBeLessThan(CAM_PRESETS.far);
    for (const d of Object.values(CAM_PRESETS)) expect(d >= CAM_ZOOM.min && d <= CAM_ZOOM.max).toBe(true);
  });

  it("cycles near → mid → far → near and snaps the distance; a preset leaves first person", () => {
    let c: GameCam = { ...DEFAULT_CAM, preset: "near", distance: 12 };
    c = cyclePreset(c);
    expect(c).toMatchObject({ preset: "mid", distance: CAM_PRESETS.mid });
    c = cyclePreset(c);
    expect(c).toMatchObject({ preset: "far", distance: CAM_PRESETS.far });
    c = cyclePreset(c);
    expect(c.preset).toBe("near");
    expect(pickPreset({ ...DEFAULT_CAM, view: "first" }, "far")).toEqual({ view: "third", preset: "far", distance: CAM_PRESETS.far });
  });

  it("zooms with the wheel and a pinch, within the limits; not in first person", () => {
    const c = DEFAULT_CAM;
    expect(zoomBy(c, 100).distance).toBeGreaterThan(c.distance);
    expect(zoomBy(c, -100).distance).toBeLessThan(c.distance);
    let far = c;
    for (let i = 0; i < 50; i++) far = zoomBy(far, 500);
    expect(far.distance).toBe(CAM_ZOOM.max);
    let near = c;
    for (let i = 0; i < 50; i++) near = pinchBy(near, 2);
    expect(near.distance).toBe(CAM_ZOOM.min);
    expect(pinchBy(c, 0.5).distance).toBe(Math.min(CAM_ZOOM.max, c.distance * 2));
    expect(pinchBy(c, 0)).toBe(c);
    expect(zoomBy(c, Number.NaN)).toBe(c);
    const fp = toggleView(c);
    expect(fp.view).toBe("first");
    expect(zoomBy(fp, 300)).toBe(fp);
    expect(pinchBy(fp, 2)).toBe(fp);
    expect(toggleView(fp).view).toBe("third");
  });

  it("parses what it stores and refuses junk", () => {
    const s = mem();
    const c: GameCam = { view: "first", preset: "far", distance: 44 };
    saveCam(c, s);
    expect(s.m.get(CAM_STORAGE_KEY)).toBeTruthy();
    expect(loadCam(s)).toEqual(c);
    expect(parseCam(null)).toEqual(DEFAULT_CAM);
    expect(parseCam("{oops")).toEqual(DEFAULT_CAM);
    expect(parseCam("42")).toEqual(DEFAULT_CAM);
    expect(parseCam(JSON.stringify({ view: "free", preset: "zzz", distance: 9999 }))).toEqual({ view: "third", preset: "mid", distance: CAM_ZOOM.max });
    expect(parseCam(JSON.stringify({ preset: "near" }))).toEqual({ view: "third", preset: "near", distance: CAM_PRESETS.near });
  });

  it("survives a storage that throws", () => {
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadCam(bad)).toEqual(DEFAULT_CAM);
    expect(() => saveCam(DEFAULT_CAM, bad)).not.toThrow();
    expect(loadCam(null)).toEqual(DEFAULT_CAM);
  });

  it("shares one state: setCam persists and notifies (not for a no-op)", () => {
    const seen: GameCam[] = [];
    const off = subscribeCam((c) => seen.push(c));
    setCam(toggleView(getCam()));
    expect(seen).toHaveLength(1);
    expect(getCam().view).toBe("first");
    setCam(getCam());
    expect(seen).toHaveLength(1);
    off();
    setCam(cyclePreset(getCam()));
    expect(seen).toHaveLength(1);
    resetCamForTests();
    expect(getCam().preset).toBe("far");                                // read back from localStorage
  });

  it("has a key for first person and no free camera mode", () => {
    const k = HOTKEYS.find((h) => h.id === "camView");
    expect(k?.codes).toContain("Digit8");
    const all = HOTKEYS.flatMap((h) => h.codes.map((c) => `${h.group}:${c}:${h.id}`));
    expect(all.filter((x) => x.includes(":Digit8:"))).toHaveLength(1);
  });

  it("third person is FIXED: a drag changes neither yaw nor pitch", () => {
    const c: GameCam = { ...DEFAULT_CAM };
    const s0 = { yaw: CAM_FIXED_YAW, fpPitch: -0.1 };
    expect(dragLook(c, s0, 300, -200)).toEqual(s0);
    const o = thirdPersonOrbit(c);
    expect(o.yaw).toBe(CAM_FIXED_YAW);
    expect(thirdPersonOrbit({ ...c, distance: 999 }).pitch).toBeGreaterThan(thirdPersonOrbit({ ...c, distance: 1 }).pitch);
  });

  it("zoom stays between the near and far presets", () => {
    expect(CAM_ZOOM).toEqual({ min: CAM_PRESETS.near, max: CAM_PRESETS.far });
    let c: GameCam = { ...DEFAULT_CAM };
    for (let i = 0; i < 50; i++) c = zoomBy(c, 500);
    expect(c).toMatchObject({ distance: CAM_PRESETS.far, preset: "far" });
    for (let i = 0; i < 50; i++) c = pinchBy(c, 3);
    expect(c.distance).toBe(CAM_PRESETS.near);
    expect(thirdPersonOrbit({ ...c, distance: 5 }).distance).toBe(CAM_PRESETS.near);
  });

  it("first person looks around with the pitch clamped", () => {
    const c: GameCam = { ...DEFAULT_CAM, view: "first" };
    const up = dragLook(c, { yaw: 0, fpPitch: 0 }, 100, -100000);
    expect(up.fpPitch).toBe(FP_PITCH.max);
    expect(up.yaw).not.toBe(0);
    expect(dragLook(c, { yaw: 0, fpPitch: 0 }, 0, 100000).fpPitch).toBe(FP_PITCH.min);
  });

  it("persists the mode; blocked storage falls back safely", () => {
    const m = mem();
    saveCam({ view: "first", preset: "far", distance: CAM_PRESETS.far }, m);
    expect(loadCam(m)).toEqual({ view: "first", preset: "far", distance: CAM_PRESETS.far });
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => saveCam(DEFAULT_CAM, bad)).not.toThrow();
    expect(loadCam(bad)).toEqual(DEFAULT_CAM);
  });
});
