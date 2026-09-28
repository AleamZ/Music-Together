import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

import FightReplays from "@/components/admin/FightReplays";
import { fighterParams, makeParams } from "@/lib/game/fight/engine";

afterEach(cleanup);

const T = "2026-09-28T10:00:00+00:00";
const PARAMS = makeParams(fighterParams(1, 2), fighterParams(2, 2), { seed: 7 });

describe("admin FightReplays (v20.3)", () => {
  it("lists ring matches and conflicts and opens a replay of both logs", async () => {
    h.rpc.mockImplementation((name: string) => Promise.resolve(name === "admin_fight_list"
      ? { data: {
        matches: [{ id: "m1", status: "disputed", end_reason: "conflict", winner: null, stake: 1000, ring: 2, p1: "Lan", p2: "Minh",
          created_at: T, ended_at: T, resyncs: 1, sim_frame: 600 }],
        conflicts: [{ id: 1, match_id: "m1", reporter: "Lan", reported: "Minh", from_frame: 120, to_frame: 180, created_at: T }],
      }, error: null }
      : { data: {
        id: "m1", status: "disputed", params: PARAMS, p1: "Lan", p2: "Minh", sim_frame: 600, result: null,
        logs: [
          { side: 1, runs: [0, 300, 16, 300], frontier: 599, seen_runs: [], seen_frontier: 599, stall_frames: 12, bad_hashes: 0 },
          { side: 2, runs: [2, 600], frontier: 599, seen_runs: [], seen_frontier: 599, stall_frames: 0, bad_hashes: 1 },
        ],
        conflicts: [{ reporter: "Lan", reported: "Minh", from_frame: 120, to_frame: 180 }],
      }, error: null }));
    render(<FightReplays token="tok" />);
    expect(await screen.findByText(/Sàn 2 · Lan vs Minh/)).toBeTruthy();
    expect(screen.getByText(/Lan báo Minh · khung 120–180/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Xem lại trận" }));
    await waitFor(() => expect(screen.getByTestId("replay-controls")).toBeTruthy());
    expect(screen.getByText("Khung 0 / 600")).toBeTruthy();
    expect(screen.getByText(/Bên 2 \(Minh\).*băm sai 1/)).toBeTruthy();
    expect(h.rpc).toHaveBeenCalledWith("admin_fight_log", { p_session_token: "tok", p_match: "m1" });
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(screen.queryByTestId("replay-controls")).toBeNull();
  });
});
