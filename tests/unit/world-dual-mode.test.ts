import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { GFX_KEY } from "@/lib/game/diorama/flag";
import { markWorldFailed, resetAppFlags, worldModeFor, worldModeOn } from "@/lib/game/world/flag";
import { posReport } from "@/lib/game/position";

const rpc = vi.mocked(supabase.rpc);

// 0090 (dual mode): the client plays the world only with the 3D graphics AND the server's unified_world flag.
describe("world mode selection (0090)", () => {
  beforeEach(() => { rpc.mockReset(); resetAppFlags(); window.localStorage.removeItem(GFX_KEY); });

  it("is 3D and the flag, nothing else", () => {
    expect(worldModeFor("3d", true)).toBe(true);
    expect(worldModeFor("3d", false)).toBe(false);
    expect(worldModeFor("2d", true)).toBe(false);
    expect(worldModeFor("2d", false)).toBe(false);
  });

  it("reads this browser's graphics and the server's flag", async () => {
    rpc.mockResolvedValue({ data: { unified_world: true }, error: null } as never);
    expect(await worldModeOn()).toBe(false);                 // 2D by default
    window.localStorage.setItem(GFX_KEY, "3d");
    expect(await worldModeOn()).toBe(true);
    window.localStorage.setItem(GFX_KEY, "2d");
    expect(await worldModeOn()).toBe(false);                 // switching back to 2D leaves world mode
  });

  it("a server without the flag (or failing) is 2D even with 3D graphics", async () => {
    window.localStorage.setItem(GFX_KEY, "3d");
    rpc.mockResolvedValue({ data: null, error: new Error("no app_flags") } as never);
    expect(await worldModeOn()).toBe(false);
    resetAppFlags();
    rpc.mockResolvedValue({ data: { unified_world: false }, error: null } as never);
    expect(await worldModeOn()).toBe(false);
  });
});

// A 3D world that fails to load (GameShell's worldFailed) falls back to 2D entirely, the claims included.
describe("world load failure → 2D (fix pass)", () => {
  beforeEach(() => { rpc.mockReset(); resetAppFlags(); window.localStorage.setItem(GFX_KEY, "3d"); });

  const calls = () => rpc.mock.calls.map((c) => c[0]).filter((n) => n !== "app_flags");

  it("posReport claims pos_report_w in world mode, pos_report once the world failed", async () => {
    rpc.mockImplementation(((name: string) =>
      Promise.resolve(name === "app_flags" ? { data: { unified_world: true }, error: null } : { data: { ok: true }, error: null })) as never);
    expect(await worldModeOn()).toBe(true);
    await posReport("tok", "hall", 516, 334);
    expect(calls()).toEqual(["pos_report_w"]);
    markWorldFailed();
    expect(await worldModeOn()).toBe(false);
    rpc.mockClear();
    await posReport("tok", "hall", 516, 334);
    expect(calls()).toEqual(["pos_report"]);
    expect(rpc).toHaveBeenCalledWith("pos_report", { p_session_token: "tok", p_map: "hall", p_x: 516, p_y: 334 });
  });

  it("a failure while the flags are still loading wins too", async () => {
    let done: (v: unknown) => void = () => {};
    rpc.mockImplementation(((name: string) =>
      name === "app_flags" ? new Promise((r) => { done = r; }) : Promise.resolve({ data: { ok: true }, error: null })) as never);
    const p = worldModeOn();
    markWorldFailed();
    done({ data: { unified_world: true }, error: null });
    expect(await p).toBe(false);
  });
});
