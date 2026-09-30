import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mail, MailBox } from "@/lib/game/mail/model";

const rpc = vi.hoisted(() => ({
  mailList: vi.fn(), mailRead: vi.fn(), mailClaim: vi.fn(), mailClaimAll: vi.fn(), mailDelete: vi.fn(), redeemCode: vi.fn(),
  adminMailSend: vi.fn(), adminCodeList: vi.fn(), adminCodeCreate: vi.fn(), adminCodeDisable: vi.fn(),
}));
vi.mock("@/lib/game/mail/rpc", () => rpc);
const econ = vi.hoisted(() => ({
  econState: vi.fn(), tradeCancel: vi.fn(), tradeConfirm: vi.fn(), tradeOffer: vi.fn(),
}));
vi.mock("@/lib/game/economy/rpc", () => econ);
import MailboxModal from "@/components/game/mail/MailboxModal";
import MailTab, { localToIso } from "@/components/admin/MailTab";
import TradeWindow from "@/components/game/economy/TradeWindow";

const mail = (over: Partial<Mail> = {}): Mail => ({
  id: 1, kind: "trade", senderKind: "player", senderName: "An", title: "🤝 Giao dịch với An", body: "Đồ nhận được.", xu: 950,
  items: [{ kind: "fish", ref: "f", qty: 1, name: "Cá rô 0.8 kg", value: 400, rarity: 1 }], read: false, claimed: false,
  createdMs: 0, expiresMs: 30 * 86_400_000, ...over,
});
const box = (mails: Mail[], over: Partial<MailBox> = {}): MailBox => ({
  unread: mails.filter((m) => !m.read).length, claimable: mails.filter((m) => !m.claimed && (m.xu > 0 || m.items.length > 0)).length,
  mails, serverNowMs: 0, coins: null, ...over,
});

beforeEach(() => { for (const f of [...Object.values(rpc), ...Object.values(econ)]) f.mockReset(); });
afterEach(() => cleanup());

describe("MailboxModal", () => {
  it("lists, opens (marks read), claims and reloads the wallet", async () => {
    const b = box([mail(), mail({ id: 2, kind: "admin", senderKind: "admin", title: "Thông báo", xu: 0, items: [], read: true })]);
    rpc.mailList.mockResolvedValue(b);
    rpc.mailRead.mockResolvedValue(b);
    rpc.mailClaim.mockResolvedValue(box([mail({ claimed: true, read: true })]));
    const onBox = vi.fn(), onChanged = vi.fn();
    render(<MailboxModal token="t" box={b} onBox={onBox} onChanged={onChanged} onClose={() => {}} />);
    expect(screen.getByText("1 thư chưa đọc · 1 thư có quà")).toBeInTheDocument();
    expect(screen.getByTestId("mail-2")).toHaveTextContent("Ban quản trị");
    fireEvent.click(screen.getByText("🤝 Giao dịch với An"));
    await waitFor(() => expect(rpc.mailRead).toHaveBeenCalledWith("t", 1));
    expect(screen.getByText("Đồ nhận được.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Xoá thư" })).toBeNull();          // not claimed yet
    fireEvent.click(screen.getByRole("button", { name: "Nhận" }));
    await waitFor(() => expect(rpc.mailClaim).toHaveBeenCalledWith("t", 1));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText(/Đã nhận: /)).toBeInTheDocument();
  });

  it("shows a refused claim (the mail stays)", async () => {
    const b = box([mail()]);
    rpc.mailList.mockResolvedValue(b);
    rpc.mailRead.mockResolvedValue(b);
    rpc.mailClaim.mockRejectedValue({ message: "bucket full" });
    const onChanged = vi.fn();
    render(<MailboxModal token="t" box={b} onBox={() => {}} onChanged={onChanged} onClose={() => {}} />);
    fireEvent.click(screen.getByText("🤝 Giao dịch với An"));
    fireEvent.click(screen.getByRole("button", { name: "Nhận" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Giỏ cá đã đầy");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("claims all and lists what could not be claimed", async () => {
    const b = box([mail(), mail({ id: 2 })]);
    rpc.mailList.mockResolvedValue(b);
    rpc.mailClaimAll.mockResolvedValue({ box: box([]), all: { n: 1, xu: 950, failed: [{ id: 2, error: "bucket full" }] } });
    const onChanged = vi.fn();
    render(<MailboxModal token="t" box={b} onBox={() => {}} onChanged={onChanged} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Nhận tất cả" }));
    expect(await screen.findByText(/Đã nhận 1 thư .* 1 thư chưa nhận được: Giỏ cá đã đầy/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it("deletes a claimed mail", async () => {
    const b = box([mail({ claimed: true, read: true })]);
    rpc.mailList.mockResolvedValue(b);
    rpc.mailDelete.mockResolvedValue(box([]));
    const onBox = vi.fn();
    render(<MailboxModal token="t" box={b} onBox={onBox} onChanged={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByText("🤝 Giao dịch với An"));
    expect(rpc.mailRead).not.toHaveBeenCalled();                                   // already read
    fireEvent.click(screen.getByRole("button", { name: "Xoá thư" }));
    await waitFor(() => expect(rpc.mailDelete).toHaveBeenCalledWith("t", 1));
  });

  it("redeems a code, and explains a refusal", async () => {
    rpc.mailList.mockResolvedValue(box([]));
    rpc.redeemCode.mockResolvedValueOnce({ ok: false, error: "invalid code", left: 1, retryS: null, title: null, box: null });
    rpc.redeemCode.mockResolvedValueOnce({ ok: true, error: null, left: null, retryS: null, title: "🎁 Tết", box: box([mail({ kind: "code" })]) });
    const onBox = vi.fn();
    render(<MailboxModal token="t" box={box([])} onBox={onBox} onChanged={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Hòm thư trống.")).toBeInTheDocument();
    const input = screen.getByLabelText("Nhập code");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi quà" }));
    expect(screen.getByTestId("code-msg")).toHaveTextContent("3–32 ký tự");
    expect(rpc.redeemCode).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: " sai-roi " } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi quà" }));
    await waitFor(() => expect(rpc.redeemCode).toHaveBeenCalledWith("t", "SAI-ROI"));
    expect(await screen.findByText("Code không đúng. Còn 1 lần thử.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "tet2026" } });
    fireEvent.click(screen.getByRole("button", { name: "Đổi quà" }));
    expect(await screen.findByText(/Đã nhận "🎁 Tết"/)).toBeInTheDocument();
    expect(onBox).toHaveBeenLastCalledWith(expect.objectContaining({ mails: [expect.objectContaining({ kind: "code" })] }));
  });
});

describe("TradeWindow", () => {
  it("tells both sides the goods arrive in the mailbox", async () => {
    econ.econState.mockResolvedValue({ coins: 0, assets: [], listings: [], mine: [], auctions: [], stalls: [], serverNowMs: 0 });
    render(<TradeWindow token="t" onState={() => {}} onChanged={() => {}} trade={{
      id: 1, rev: 0, opener: true, partnerId: "p", partnerName: "Bình", mine: { coins: 0, items: [] }, theirs: { coins: 0, items: [] },
      myOk: false, theirOk: false, feePct: 5, myRecv: null, theirRecv: null,
    }} />);
    expect(screen.getByTestId("trade-mail-note")).toHaveTextContent("Hòm thư");
    await waitFor(() => expect(econ.econState).toHaveBeenCalled());
  });
});

describe("MailTab (admin)", () => {
  const empty = { codes: [], gifts: [] };
  it("sends a gift to named players", async () => {
    rpc.adminCodeList.mockResolvedValue(empty);
    rpc.adminMailSend.mockResolvedValue({ sent: 2, missing: ["ma"] });
    render(<MailTab token="r" />);
    fireEvent.change(screen.getByLabelText("Tên người nhận"), { target: { value: "an, binh ma" } });
    fireEvent.change(screen.getByLabelText("Tiêu đề thư"), { target: { value: "Quà" } });
    fireEvent.change(screen.getByLabelText("Xu quà"), { target: { value: "500" } });
    fireEvent.change(screen.getByLabelText("Món quà"), { target: { value: "bait_worm x20, fashion:hat_red" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi cho 3 người" }));
    await waitFor(() => expect(rpc.adminMailSend).toHaveBeenCalledWith("r", { usernames: ["an", "binh", "ma"] }, "Quà", "", 500,
      [{ kind: "item", ref: "bait_worm", qty: 20 }, { kind: "fashion", ref: "hat_red", qty: 1 }]));
    expect(await screen.findByText("Đã gửi 2 thư. Không tìm thấy: ma.")).toBeInTheDocument();
  });

  it("asks before sending to everyone", async () => {
    rpc.adminCodeList.mockResolvedValue(empty);
    rpc.adminMailSend.mockResolvedValue({ sent: 40, missing: [] });
    const ask = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<MailTab token="r" />);
    fireEvent.click(screen.getByLabelText("Tất cả người chơi"));
    fireEvent.change(screen.getByLabelText("Tiêu đề thư"), { target: { value: "Cả làng" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi cho tất cả" }));
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1));
    expect(rpc.adminMailSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Gửi cho tất cả" }));
    await waitFor(() => expect(rpc.adminMailSend).toHaveBeenCalledWith("r", { all: true }, "Cả làng", "", 0, []));
    ask.mockRestore();
  });

  it("creates and disables a code", async () => {
    const listed = { codes: [{ id: 5, code: "TET2026", title: "Tết", xu: 100, items: [], maxUses: 10, uses: 0, startsAt: "", expiresAt: "",
      enabled: true, createdBy: "root" }], gifts: [] };
    rpc.adminCodeList.mockResolvedValue(empty);
    rpc.adminCodeCreate.mockResolvedValue(listed);
    rpc.adminCodeDisable.mockResolvedValue({ ...listed, codes: [{ ...listed.codes[0], enabled: false }] });
    const ask = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<MailTab token="r" />);
    fireEvent.change(screen.getByLabelText("Code"), { target: { value: "tet2026" } });
    fireEvent.change(screen.getByLabelText("Tiêu đề code"), { target: { value: "Tết" } });
    fireEvent.change(screen.getByLabelText("Xu code"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Số lượt"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Hết hạn"), { target: { value: "2026-12-31T23:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo code" }));
    await waitFor(() => expect(rpc.adminCodeCreate).toHaveBeenCalledWith("r", expect.objectContaining({
      code: "TET2026", title: "Tết", xu: 100, items: [], maxUses: 10, startsAt: null, expiresAt: localToIso("2026-12-31T23:00"),
    })));
    fireEvent.click(await screen.findByRole("button", { name: "Tắt" }));
    await waitFor(() => expect(rpc.adminCodeDisable).toHaveBeenCalledWith("r", 5));
    expect(await screen.findByText("đã tắt")).toBeInTheDocument();
    ask.mockRestore();
  });

  it("localToIso", () => {
    expect(localToIso("")).toBeNull();
    expect(localToIso("nope")).toBeNull();
    expect(localToIso("2026-10-01T08:00")).toBe(new Date("2026-10-01T08:00").toISOString());
  });
});
