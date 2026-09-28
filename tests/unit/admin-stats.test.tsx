import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

import StatsPanel, { flagText } from "@/components/admin/StatsPanel";
import OutdatedBanner from "@/components/OutdatedBanner";
import { OUTDATED_EVENT } from "@/lib/client-build";
import { parsePetsState, petTick } from "@/lib/game/pets/rpc";

const T = "2026-10-02T10:00:00+00:00";
const CONFIG = { mode: "log", min_client_build: 0, auto_blacklist: true, auto_blacklist_hard: 8, stats_enabled: true,
  stats_every_min: 15, server_build: 0 };
const CHEAT = {
  account_id: "c1", username: "Bot", is_root: false, is_banned: false, blacklisted: false, blacklist_note: null, blacklisted_at: null,
  flags: [
    { kind: "stat_win_rate", key: "harvest", value: 1, baseline: 0.3, n: 60, detail: {}, first_at: T, last_at: T, hits: 2 },
    { kind: "stat_earnings", key: "sell", value: 60000, baseline: 1000, n: 7, detail: {}, first_at: T, last_at: T, hits: 1 },
    { kind: "stat_marathon", key: "", value: 21, baseline: null, n: 21, detail: {}, first_at: T, last_at: T, hits: 1 },
  ],
  games: [{ game: "harvest", plays: 60, wins: 60, exact: 60 }],
  income: { sell: 60000 },
  hard_30d: 3,
};
const LISTED = { ...CHEAT, account_id: "c2", username: "Lan", blacklisted: true, blacklist_note: "auto 2026-10-01: 8 vi phạm", flags: [], games: [], income: {} };
let config = { ...CONFIG };
beforeEach(() => {
  config = { ...CONFIG };
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    switch (fn) {
      case "admin_anticheat_stats":
      case "admin_anticheat_stats_run":
        return { data: { config, run_at: T, took_ms: 12, server_now: T, accounts: [CHEAT, LISTED] }, error: null };
      case "admin_anticheat_config":
        config = { ...config, ...(args.p_patch as object) };
        return { data: config, error: null };
      case "admin_blacklist_set": return { data: { account_id: args.p_account_id, blacklisted: args.p_on }, error: null };
      case "admin_stat_review": return { data: { account_id: args.p_account_id, reviewed: 3 }, error: null };
      default: return { data: null, error: { message: "unknown" } };
    }
  });
  vi.stubEnv("NEXT_PUBLIC_CLIENT_BUILD", "202610020900-abc1234");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const calls = (fn: string) => h.rpc.mock.calls.filter((c) => c[0] === fn);

describe("StatsPanel (anti-cheat v2 part 3)", () => {
  it("lists the flagged and blacklisted accounts with their statistics", async () => {
    render(<StatsPanel token="tok" />);
    const bot = (await screen.findByText("Bot")).closest("li")!;
    expect(within(bot).getByText("• Tỉ lệ thắng cao bất thường (gặt lúa): 100% trên 60 lượt — người khác 30%")).toBeInTheDocument();
    expect(within(bot).getByText(/Thu nhập 24 giờ bất thường \(bán cá\): 60[.,]000 xu/)).toBeInTheDocument();
    expect(within(bot).getByText("• Kiếm xu liên tục nhiều giờ: 21 giờ trong 24 giờ")).toBeInTheDocument();
    expect(within(bot).getByText("gặt lúa: 60/60 thắng, 60 hoàn hảo")).toBeInTheDocument();
    const lan = (await screen.findByText("Lan")).closest("li")!;
    expect(within(lan).getByText(/Danh sách đen \(auto 2026-10-01/)).toBeInTheDocument();
    expect(within(lan).queryByRole("button", { name: "Đã xem" })).toBeNull();
  });

  it("blacklists and unblacklists in one click, and marks a case reviewed", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<StatsPanel token="tok" />);
    const bot = (await screen.findByText("Bot")).closest("li")!;
    fireEvent.click(within(bot).getByRole("button", { name: "Đưa vào danh sách đen" }));
    await waitFor(() => expect(calls("admin_blacklist_set")).toHaveLength(1));
    expect(calls("admin_blacklist_set")[0][1]).toMatchObject({ p_session_token: "tok", p_account_id: "c1", p_on: true });
    const lan = (await screen.findByText("Lan")).closest("li")!;
    fireEvent.click(within(lan).getByRole("button", { name: "Bỏ khỏi danh sách đen" }));
    await waitFor(() => expect(calls("admin_blacklist_set")).toHaveLength(2));
    expect(calls("admin_blacklist_set")[1][1]).toMatchObject({ p_account_id: "c2", p_on: false });
    fireEvent.click(within((await screen.findByText("Bot")).closest("li")!).getByRole("button", { name: "Đã xem" }));
    await waitFor(() => expect(calls("admin_stat_review")).toHaveLength(1));
  });

  it("sets the minimum build to this page's and saves the switches", async () => {
    render(<StatsPanel token="tok" />);
    await screen.findByText("Bot");
    fireEvent.click(screen.getByRole("button", { name: /Bằng bản của trang này/ }));
    fireEvent.click(screen.getAllByRole("button", { name: "Lưu" })[0]);
    await waitFor(() => expect(calls("admin_anticheat_config")).toHaveLength(1));
    expect(calls("admin_anticheat_config")[0][1]).toEqual({ p_session_token: "tok", p_patch: { min_client_build: expect.any(Number) } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Tự động đưa vào danh sách đen/ }));
    await waitFor(() => expect(calls("admin_anticheat_config")).toHaveLength(2));
    expect(calls("admin_anticheat_config")[1][1]).toEqual({ p_session_token: "tok", p_patch: { auto_blacklist: false } });
    fireEvent.click(screen.getByRole("button", { name: "Chạy ngay" }));
    await waitFor(() => expect(calls("admin_anticheat_stats_run")).toHaveLength(1));
  });

  it("words a flag", () => {
    expect(flagText({ kind: "stat_exact_rate", key: "sling", value: 0.9, baseline: 0.2, n: 40, detail: {}, first_at: T, last_at: T, hits: 1 }))
      .toBe("Thao tác hoàn hảo bất thường (ná chuột): 90% trên 40 lượt — người khác 20%");
  });
});

describe("OutdatedBanner", () => {
  it("appears when the server refuses the page's build", () => {
    render(<OutdatedBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent(OUTDATED_EVENT)); });
    expect(screen.getByRole("alert")).toHaveTextContent("Trang đã cũ");
    expect(screen.getByRole("button", { name: "Cập nhật trang" })).toBeInTheDocument();
  });
});

describe("pet_tick (0066)", () => {
  it("sends the room and reads why the sóc did not forage", async () => {
    h.rpc.mockResolvedValueOnce({ data: { pets: [], active: null, items: {}, forage_today: 0, server_now_ms: 1, found: 0, idle: "no_heartbeat" }, error: null });
    const s = await petTick("tok", "room-1");
    expect(h.rpc).toHaveBeenCalledWith("pet_tick", { p_session_token: "tok", p_room_id: "room-1" });
    expect(s.idle).toBe("no_heartbeat");
    expect(parsePetsState({ idle: "bogus" }).idle).toBeUndefined();
  });
});
