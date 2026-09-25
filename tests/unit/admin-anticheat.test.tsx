import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc } }));

import AnticheatTab from "@/components/admin/AnticheatTab";

const T = "2026-10-02T10:00:00+00:00";
const at = (x: string) => new Date(x).toLocaleString("vi-VN");
const base = {
  is_root: false, is_banned: false, strikes: 0, active_strikes: 0, last_strike_at: null, last_strike_code: null, locked_until: null,
  ban_state: null, banned_at: null, wiped_at: null, pardoned_at: null, hard_events: 0, soft_events: 0, last_event_at: T,
};
const CASES = [
  { ...base, account_id: "a1", username: "Lan", is_banned: true, strikes: 2, active_strikes: 2, ban_state: "pending_wipe", banned_at: T,
    hard_events: 2, soft_events: 1 },
  { ...base, account_id: "a2", username: "Minh", strikes: 1, active_strikes: 1, locked_until: "2026-10-02T10:05:00+00:00", hard_events: 1 },
  { ...base, account_id: "a3", username: "Hoa", strikes: 1, active_strikes: 1, hard_events: 1 },
  { ...base, account_id: "a4", username: "Tú", is_banned: true, strikes: 2, active_strikes: 2, ban_state: "wiped", wiped_at: T, hard_events: 2 },
  { ...base, account_id: "a5", username: "Bảo", pardoned_at: T, soft_events: 3 },
  { ...base, account_id: "a6", username: "root", is_root: true, soft_events: 1 },
  { ...base, account_id: "a7", username: "Khang", is_banned: true, strikes: 1, active_strikes: 1, hard_events: 1 },
];
const HOLDINGS = {
  wallet: { coins: 1230, daily_on: null, bonus_on: null, bonus_count: 0 },
  inventory: [{ item_id: "bait_worm", qty: 3 }, { item_id: "rod_bamboo", qty: 1 }],
  fishing_profile: { rod: "rod_bamboo", bobber: "bobber_feather", bait: "bait_worm" },
  fish: [{ species_id: "ca_ro", weight_g: 120, price: 5, caught_at: T }],
  personal_bests: [{ species_id: "ca_ro", weight_g: 120, caught_at: T }, { species_id: "ca_loc", weight_g: 900, caught_at: T }],
  rice: [{ variety: "nep", wet_kg: 1200, dry_kg: 300 }],
  plots: [{ room_id: "r", plot_no: 1, kind: "private", owned_at: T, sale_price: null, sublease_price: null }],
  leases: [],
  offers: [{ room_id: "r", plot_no: 2, price: 5000, created_at: T }],
  crops: [],
  drying: [{ room_id: "r", slot: 1, variety: "nep", kg: 70, ready_at: T }],
  announcements: 2,
};
const ACCOUNT = {
  case: CASES[0],
  holdings: HOLDINGS,
  events: [
    { id: 2, created_at: T, code: "bad_qty", outcome: "strike_2", rpc: "buy_item", room_id: null, detail: { item_id: "bait_shrimp", qty: 500 },
      client: "music-together/abc1234", user_agent: "Mozilla/5.0" },
    { id: 1, created_at: T, code: "reel_gate_hug", outcome: "soft", rpc: "finish_cast", room_id: "r", detail: { ratio: 1.01 },
      client: null, user_agent: null },
  ],
  wipes: [{ id: 7, wiped_at: T, wiped_by: "root", snapshot: { wallet: { coins: 99 } } }],
};

let mode = "log";
let resolveError: { message: string } | null = null;
let listError: { message: string } | null = null;
beforeEach(() => {
  mode = "log";
  resolveError = null;
  listError = null;
  h.rpc.mockReset();
  h.rpc.mockImplementation(async (fn: string) => {
    switch (fn) {
      case "admin_anticheat_list":
        return listError ? { data: null, error: listError } : { data: { mode, mode_changed_at: T, server_now: T, cases: CASES }, error: null };
      case "admin_anticheat_account": return { data: ACCOUNT, error: null };
      case "admin_anticheat_resolve": return resolveError ? { data: null, error: resolveError } : { data: CASES[0], error: null };
      case "admin_anticheat_set_mode": return { data: { mode, mode_changed_at: T }, error: null };
      default: return { data: null, error: { message: "unknown" } };
    }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const card = async (username: string) => (await screen.findByText(username)).closest("li")!;
const calls = (fn: string) => h.rpc.mock.calls.filter((c) => c[0] === fn);

describe("AnticheatTab (anti-cheat spec §12.5)", () => {
  it("shows the mode and every case with its status and counts", async () => {
    render(<AnticheatTab token="tok" />);
    expect(screen.getByText("Đang tải…")).toBeInTheDocument();
    expect(await screen.findByText(`Chế độ: Chỉ ghi nhận · từ ${at(T)}`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "🛡️ Chống gian lận" })).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_list", { p_session_token: "tok" });
    expect(screen.getByRole("button", { name: "Chỉ ghi nhận" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Thi hành" })).toHaveAttribute("aria-pressed", "false");
    const status = async (username: string) => within(await card(username));
    expect((await status("Lan")).getByText("🚫 Đã cấm — chờ xoá dữ liệu")).toBeInTheDocument();
    expect((await status("Lan")).getByText(`Vi phạm 2/2 · 2 cứng · 1 mềm · lần cuối ${at(T)}`)).toBeInTheDocument();
    expect((await status("Minh")).getByText(`🔒 Đang khoá đến ${at("2026-10-02T10:05:00+00:00")}`)).toBeInTheDocument();
    expect((await status("Hoa")).getByText("⚠️ Cảnh cáo (1/2)")).toBeInTheDocument();
    expect((await status("Tú")).getByText("🚫 Đã cấm — đã xoá dữ liệu")).toBeInTheDocument();
    expect((await status("Bảo")).getByText("🕊️ Đã ân xá")).toBeInTheDocument();
    expect((await status("root 👑")).getByText("Chỉ có ghi nhận")).toBeInTheDocument();
    // a ban root set by hand in the Accounts tab, whatever strike the account also has
    expect((await status("Khang")).getByText("Khoá tay")).toBeInTheDocument();
    // "Xoá dữ liệu" only while a wipe is pending; "Ân xá" for any active strike, lock or ban
    expect(screen.getAllByRole("button", { name: "Xoá dữ liệu" })).toHaveLength(1);
    expect((await status("Lan")).getByRole("button", { name: "Xoá dữ liệu" })).toBeInTheDocument();
    for (const name of ["Lan", "Minh", "Hoa", "Tú", "Khang"]) {
      expect((await status(name)).getByRole("button", { name: "Ân xá" })).toBeInTheDocument();
    }
    for (const name of ["Bảo", "root 👑"]) expect((await status(name)).queryByRole("button", { name: "Ân xá" })).toBeNull();
    expect(screen.getByText(/^Ghi nhận mềm, ghi nhận lúc chỉ ghi nhận/)).toBeInTheDocument();
  });

  it("says when there is nothing yet", async () => {
    h.rpc.mockImplementation(async () => ({ data: { mode: "enforce", mode_changed_at: T, server_now: T, cases: [] }, error: null }));
    render(<AnticheatTab token="tok" />);
    expect(await screen.findByText("Chưa có ghi nhận nào.")).toBeInTheDocument();
    expect(screen.getByText(`Chế độ: Thi hành · từ ${at(T)}`)).toBeInTheDocument();
  });

  it("wipes a pending account only after the confirm, then reloads the list and the open evidence", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AnticheatTab token="tok" />);
    const lan = within(await card("Lan"));
    fireEvent.click(lan.getByRole("button", { name: "Bằng chứng" }));
    await screen.findByText("Dữ liệu hiện có");
    fireEvent.click(lan.getByRole("button", { name: "Xoá dữ liệu" }));
    expect(confirm).toHaveBeenLastCalledWith(
      "Xoá toàn bộ dữ liệu trò chơi của Lan? Xu, đồ, cá, kỷ lục và lúa bị xoá ngay; đất được trả về làng ở lần mở ruộng kế tiếp. Không hoàn tác được.",
    );
    expect(calls("admin_anticheat_resolve")).toHaveLength(0);
    fireEvent.click(lan.getByRole("button", { name: "Xoá dữ liệu" }));
    await waitFor(() => expect(calls("admin_anticheat_list")).toHaveLength(2));
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_resolve", { p_session_token: "tok", p_account_id: "a1", p_action: "wipe" });
    await waitFor(() => expect(calls("admin_anticheat_account")).toHaveLength(2));
  });

  it("pardons after the confirm, which warns that wiped data stays gone", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnticheatTab token="tok" />);
    fireEvent.click(within(await card("Tú")).getByRole("button", { name: "Ân xá" }));
    expect(confirm).toHaveBeenLastCalledWith("Ân xá Tú? Tài khoản được mở khoá và xoá vi phạm. Dữ liệu đã xoá không được khôi phục.");
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith(
      "admin_anticheat_resolve", { p_session_token: "tok", p_account_id: "a4", p_action: "pardon" },
    ));
    fireEvent.click(within(await card("Minh")).getByRole("button", { name: "Ân xá" }));
    expect(confirm).toHaveBeenLastCalledWith("Ân xá Minh? Tài khoản được mở khoá và xoá vi phạm.");
    fireEvent.click(within(await card("Khang")).getByRole("button", { name: "Ân xá" }));
    expect(confirm).toHaveBeenLastCalledWith("Ân xá Khang? Vi phạm được xoá, nhưng tài khoản vẫn bị khoá tay.");
    await waitFor(() => expect(calls("admin_anticheat_resolve")).toHaveLength(3));
  });

  it("explains a refused wipe or pardon", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnticheatTab token="tok" />);
    resolveError = { message: "not pending" };
    fireEvent.click(within(await card("Lan")).getByRole("button", { name: "Xoá dữ liệu" }));
    expect(await screen.findByText("Tài khoản này không còn chờ xoá dữ liệu.")).toBeInTheDocument();
    resolveError = { message: "nothing to pardon" };
    fireEvent.click(within(await card("Hoa")).getByRole("button", { name: "Ân xá" }));
    expect(await screen.findByText("Tài khoản này không có gì để ân xá.")).toBeInTheDocument();
    resolveError = { message: "boom" };
    fireEvent.click(within(await card("Hoa")).getByRole("button", { name: "Ân xá" }));
    expect(await screen.findByText("Có lỗi, thử lại nhé.")).toBeInTheDocument();
  });

  it("says the action went through when only the reload after it fails, and keeps a refusal's reason", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AnticheatTab token="tok" />);
    const hoa = within(await card("Hoa"));
    listError = { message: "Failed to fetch" };
    fireEvent.click(hoa.getByRole("button", { name: "Ân xá" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Đã xong — tải lại danh sách không được, thử lại.");
    expect(calls("admin_anticheat_resolve")).toHaveLength(1);
    resolveError = { message: "nothing to pardon" };
    fireEvent.click(hoa.getByRole("button", { name: "Ân xá" }));
    await waitFor(() => expect(calls("admin_anticheat_list")).toHaveLength(3));
    expect(screen.getByRole("alert")).toHaveTextContent("Tài khoản này không có gì để ân xá.");
  });

  it("switches the mode only after its confirm", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    render(<AnticheatTab token="tok" />);
    await screen.findByText(`Chế độ: Chỉ ghi nhận · từ ${at(T)}`);
    fireEvent.click(screen.getByRole("button", { name: "Thi hành" }));
    expect(confirm).toHaveBeenLastCalledWith("Bật chế độ Thi hành? Từ giờ vi phạm lần 1 bị khoá trò chơi 5 phút, lần 2 bị cấm tài khoản.");
    expect(calls("admin_anticheat_set_mode")).toHaveLength(0);
    mode = "enforce";
    fireEvent.click(screen.getByRole("button", { name: "Thi hành" }));
    expect(await screen.findByText(`Chế độ: Thi hành · từ ${at(T)}`)).toBeInTheDocument();
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_set_mode", { p_session_token: "tok", p_mode: "enforce" });
    // the current mode's button does nothing
    fireEvent.click(screen.getByRole("button", { name: "Thi hành" }));
    expect(confirm).toHaveBeenCalledTimes(2);
    mode = "log";
    fireEvent.click(screen.getByRole("button", { name: "Chỉ ghi nhận" }));
    expect(confirm).toHaveBeenLastCalledWith("Chuyển về Chỉ ghi nhận? Các lượt khoá 5 phút đang chạy sẽ được gỡ; tài khoản đã bị cấm vẫn bị cấm.");
    expect(await screen.findByText(`Chế độ: Chỉ ghi nhận · từ ${at(T)}`)).toBeInTheDocument();
  });

  it("opens and closes the evidence: holdings, events and wipes", async () => {
    render(<AnticheatTab token="tok" />);
    const lan = within(await card("Lan"));
    expect(lan.getByRole("button", { name: "Bằng chứng" })).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(lan.getByRole("button", { name: "Bằng chứng" }));
    expect(await lan.findByText("Dữ liệu hiện có")).toBeInTheDocument();
    expect(lan.getByRole("button", { name: "Ẩn bằng chứng" })).toHaveAttribute("aria-expanded", "true");
    expect(h.rpc).toHaveBeenCalledWith("admin_anticheat_account", { p_session_token: "tok", p_account_id: "a1" });
    expect(lan.getByText(
      "1.230 xu · 4 món đồ · 1 con cá · 2 kỷ lục · 1.500 kg lúa · 1 thửa sở hữu · 0 thửa đang thuê · 1 đề nghị mua · 1 ô phơi · 2 tin khoe trong chat",
    )).toBeInTheDocument();
    expect(lan.getByText("Ghi nhận (2)")).toBeInTheDocument();
    expect(lan.getByText(`${at(T)} · Số lượng sai · Vi phạm 2 → cấm · buy_item`)).toBeInTheDocument();
    expect(lan.getByText(`${at(T)} · Kéo cá sát ngưỡng (20 lần/ngày) · Tín hiệu mềm · finish_cast`)).toBeInTheDocument();
    expect(lan.getByText("Client: music-together/abc1234 · Trình duyệt: Mozilla/5.0")).toBeInTheDocument();
    expect(lan.getByText("Client: — · Trình duyệt: —")).toBeInTheDocument();
    expect(lan.getByText((_, el) => el?.tagName === "PRE" && el.textContent === JSON.stringify({ item_id: "bait_shrimp", qty: 500 }, null, 2)))
      .toBeInTheDocument();
    expect(lan.getByText("Đã xoá dữ liệu")).toBeInTheDocument();
    expect(lan.getByText(`${at(T)} · bởi root`)).toBeInTheDocument();
    fireEvent.click(lan.getByRole("button", { name: "Xem dữ liệu đã xoá" }));
    expect(lan.getByText((_, el) => el?.tagName === "PRE" && el.textContent === JSON.stringify({ wallet: { coins: 99 } }, null, 2)))
      .toBeInTheDocument();
    fireEvent.click(lan.getByRole("button", { name: "Ẩn" }));
    expect(lan.queryByRole("button", { name: "Ẩn" })).toBeNull();
    fireEvent.click(lan.getByRole("button", { name: "Ẩn bằng chứng" }));
    expect(lan.queryByText("Dữ liệu hiện có")).toBeNull();
    expect(lan.getByRole("button", { name: "Bằng chứng" })).toBeInTheDocument();
  });
});
