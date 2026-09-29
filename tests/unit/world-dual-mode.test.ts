import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { GFX_KEY } from "@/lib/game/diorama/flag";
import { resetAppFlags, worldModeFor, worldModeOn } from "@/lib/game/world/flag";

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
