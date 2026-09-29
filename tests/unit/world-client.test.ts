import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { pxToWorld, pxToWorldAbs, worldAbsToPx } from "@/lib/game/diorama/coords";
import { posReport } from "@/lib/game/position";
import { resetAppFlags } from "@/lib/game/world/flag";
import { ZONES } from "@/lib/game/world/zones";

const rpc = vi.mocked(supabase.rpc);

function serve(flags: Record<string, boolean> | Error) {
  rpc.mockImplementation(((name: string) => {
    if (name === "app_flags") return Promise.resolve(flags instanceof Error ? { data: null, error: flags } : { data: flags, error: null });
    return Promise.resolve({ data: { ok: true }, error: null });
  }) as never);
}

describe("posReport and the unified_world flag (0088)", () => {
  beforeEach(() => { rpc.mockReset(); resetAppFlags(); });

  it("flag off: the old zone-local pos_report", async () => {
    serve({ unified_world: false });
    await posReport("tok", "pond", 300.4, 356.6);
    expect(rpc).toHaveBeenLastCalledWith("pos_report", { p_session_token: "tok", p_map: "pond", p_x: 300, p_y: 357 });
  });

  it("no flags (a server before 0088): the old path", async () => {
    serve(new Error("function app_flags() does not exist"));
    await posReport("tok", "hall", 612, 300);
    expect(rpc).toHaveBeenLastCalledWith("pos_report", { p_session_token: "tok", p_map: "hall", p_x: 612, p_y: 300 });
  });

  it("flag on: world px through pos_report_w; an interior keeps pos_report; the flag is read once", async () => {
    serve({ unified_world: true });
    await posReport("tok", "pond", 300, 356);
    expect(rpc).toHaveBeenLastCalledWith("pos_report_w", { p_session_token: "tok", p_wx: 300 + ZONES.pond.ox, p_wy: 356 + ZONES.pond.oy });
    await posReport("tok", "ham_ngam", 48, 84);
    expect(rpc).toHaveBeenLastCalledWith("pos_report", { p_session_token: "tok", p_map: "ham_ngam", p_x: 48, p_y: 84 });
    expect(rpc.mock.calls.filter((c) => c[0] === "app_flags")).toHaveLength(1);
  });
});

describe("diorama absolute coords", () => {
  it("world px / 16 with no centring; a zone's origin shifts local px; round-trips", () => {
    expect(pxToWorldAbs({ x: 160, y: 32 })).toEqual({ x: 10, z: 2 });
    const o = { x: ZONES.market.ox, y: ZONES.market.oy };
    const a = pxToWorldAbs({ x: 72, y: 252 }, o);
    expect(a).toEqual({ x: (72 + 1760) / 16, z: (252 + 480) / 16 });
    expect(worldAbsToPx(a.x, a.z, o)).toEqual({ x: 72, y: 252 });
    // the centred mode is untouched
    expect(pxToWorld({ x: 320, y: 200 }, { width: 640, height: 400 })).toEqual({ x: 0, z: 0 });
  });
});
