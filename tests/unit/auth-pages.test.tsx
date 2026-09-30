import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({
  account: { accountId: "acc-1", username: "Dat", isRoot: false }, token: "game-t", adoptSession: vi.fn(),
}));
const replace = vi.hoisted(() => vi.fn());
const ea = vi.hoisted(() => ({
  handleAuthRedirect: vi.fn(), currentAuthUser: vi.fn(), gameSessionFromAuth: vi.fn(), linkWithGameToken: vi.fn(),
  createAccountForAuth: vi.fn(), setNewPassword: vi.fn(), fetchAuthState: vi.fn(), linkEmailStart: vi.fn(),
  changeLegacyPassword: vi.fn(), changeEmailPassword: vi.fn(), changeEmail: vi.fn(),
}));
const legacy = vi.hoisted(() => ({ loginAccount: vi.fn(), logoutAccount: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock("@/lib/auth", () => legacy);
vi.mock("@/lib/email-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/email-auth")>()), ...ea }));

import AuthCallback from "@/components/auth/AuthCallback";
import ResetPassword from "@/components/auth/ResetPassword";
import AccountModal, { LINK_SENT } from "@/components/auth/AccountModal";
import LinkEmailBanner from "@/components/auth/LinkEmailBanner";
import { saveSession } from "@/lib/session";
import { markRecovery, savePendingLink } from "@/lib/email-auth";

const S = { accountId: "acc-2", username: "Dat", token: "t2" };

beforeEach(() => {
  for (const f of [...Object.values(ea), ...Object.values(legacy), auth.adoptSession, replace]) f.mockReset();
  legacy.logoutAccount.mockResolvedValue(undefined);
  localStorage.clear(); sessionStorage.clear();
});
afterEach(cleanup);

describe("/auth/callback", () => {
  it("signs a confirmed email with an account straight into the game", async () => {
    ea.handleAuthRedirect.mockResolvedValue("email");
    ea.currentAuthUser.mockResolvedValue({ email: "dat@mail.vn", username: "Dat", linkIntent: false });
    ea.gameSessionFromAuth.mockResolvedValue(S);
    render(<AuthCallback params={{ token_hash: "h", type: "email" }} />);
    await waitFor(() => expect(auth.adoptSession).toHaveBeenCalledWith(S));
    expect(replace).toHaveBeenCalledWith("/");
    expect(ea.linkWithGameToken).not.toHaveBeenCalled();
  });

  it("prefills the link of this browser's game account when the pending link matches, and still asks the old password", async () => {
    saveSession({ accountId: "acc-1", username: "Dat", token: "game-t" });
    savePendingLink({ accountId: "acc-1", email: "dat@mail.vn", at: Date.now() });
    ea.handleAuthRedirect.mockResolvedValue("email");
    ea.currentAuthUser.mockResolvedValue({ email: "Dat@Mail.vn", username: null, linkIntent: true });
    ea.gameSessionFromAuth.mockResolvedValueOnce(null).mockResolvedValueOnce(S);
    legacy.loginAccount.mockResolvedValue({ accountId: "acc-1", username: "Dat", token: "legacy-t" });
    render(<AuthCallback params={{ code: "c" }} />);
    expect(await screen.findByPlaceholderText("Tên đăng nhập cũ")).toHaveValue("Dat");
    expect(ea.linkWithGameToken).not.toHaveBeenCalled();   // a game token alone never links (0113)
    fireEvent.change(screen.getByPlaceholderText("Mật khẩu cũ"), { target: { value: "cu" } });
    fireEvent.submit(screen.getByPlaceholderText("Mật khẩu cũ").closest("form")!);
    await waitFor(() => expect(auth.adoptSession).toHaveBeenCalledWith(S));
    expect(ea.linkWithGameToken).toHaveBeenCalledWith("legacy-t", "cu");
  });

  it("never links on its own without this browser's pending link (another email or account)", async () => {
    saveSession({ accountId: "acc-1", username: "Dat", token: "game-t" });
    savePendingLink({ accountId: "acc-1", email: "other@mail.vn", at: Date.now() });
    ea.handleAuthRedirect.mockResolvedValue("email");
    ea.currentAuthUser.mockResolvedValue({ email: "attacker@mail.vn", username: "Hacker", linkIntent: true });
    ea.gameSessionFromAuth.mockResolvedValue(null);
    render(<AuthCallback params={{ token_hash: "h", type: "email" }} />);
    expect(await screen.findByText("Tạo nhân vật mới")).toBeInTheDocument();
    expect(ea.linkWithGameToken).not.toHaveBeenCalled();
  });

  it("asks for the name when the email has no account yet, prefilled from the sign-up", async () => {
    ea.handleAuthRedirect.mockResolvedValue("email");
    ea.currentAuthUser.mockResolvedValue({ email: "dat@mail.vn", username: "Dat", linkIntent: false });
    ea.gameSessionFromAuth.mockResolvedValue(null);
    ea.createAccountForAuth.mockRejectedValueOnce(new Error("username already taken")).mockResolvedValueOnce(S);
    render(<AuthCallback params={{ token_hash: "h", type: "email" }} />);
    const name = await screen.findByPlaceholderText("Tên nhân vật (hiện trong game)");
    expect(name).toHaveValue("Dat");
    fireEvent.submit(name.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Tên nhân vật đã có người dùng");
    fireEvent.change(name, { target: { value: "Dat2" } });
    fireEvent.submit(name.closest("form")!);
    await waitFor(() => expect(auth.adoptSession).toHaveBeenCalledWith(S));
    expect(ea.createAccountForAuth).toHaveBeenLastCalledWith("Dat2");
  });

  it("links an old account by its username and password (another device)", async () => {
    ea.handleAuthRedirect.mockResolvedValue("email");
    ea.currentAuthUser.mockResolvedValue({ email: "dat@mail.vn", username: null, linkIntent: true });
    ea.gameSessionFromAuth.mockResolvedValueOnce(null).mockResolvedValueOnce(S);
    legacy.loginAccount.mockResolvedValue({ accountId: "acc-1", username: "Dat", token: "legacy-t" });
    render(<AuthCallback params={{ token_hash: "h", type: "email" }} />);
    fireEvent.change(await screen.findByPlaceholderText("Tên đăng nhập cũ"), { target: { value: "Dat" } });
    fireEvent.change(screen.getByPlaceholderText("Mật khẩu cũ"), { target: { value: "cu" } });
    fireEvent.submit(screen.getByPlaceholderText("Mật khẩu cũ").closest("form")!);
    await waitFor(() => expect(auth.adoptSession).toHaveBeenCalledWith(S));
    expect(ea.linkWithGameToken).toHaveBeenCalledWith("legacy-t", "cu");
    expect(legacy.logoutAccount).toHaveBeenCalledWith("legacy-t");
  });

  it("sends a recovery link to the reset page, and shows a dead link", async () => {
    ea.handleAuthRedirect.mockResolvedValueOnce("recovery");
    render(<AuthCallback params={{ token_hash: "h", type: "recovery" }} />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/auth/reset"));
    cleanup();
    ea.handleAuthRedirect.mockRejectedValueOnce(new Error("link invalid"));
    render(<AuthCallback params={{ code: "old" }} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Liên kết không hợp lệ hoặc đã hết hạn.");
  });
});

describe("/auth/reset", () => {
  it("sets the new password from a mail link, then logs in", async () => {
    ea.handleAuthRedirect.mockResolvedValue("recovery");
    ea.setNewPassword.mockResolvedValue(undefined);
    ea.gameSessionFromAuth.mockResolvedValue(S);
    render(<ResetPassword params={{ token_hash: "h", type: "recovery" }} />);
    const pw = await screen.findByPlaceholderText(/Mật khẩu mới/);
    fireEvent.change(pw, { target: { value: "mat-khau-moi" } });
    fireEvent.change(screen.getByPlaceholderText("Nhập lại mật khẩu mới"), { target: { value: "khac" } });
    fireEvent.submit(pw.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Hai mật khẩu không khớp.");
    fireEvent.change(screen.getByPlaceholderText("Nhập lại mật khẩu mới"), { target: { value: "mat-khau-moi" } });
    fireEvent.submit(pw.closest("form")!);
    await waitFor(() => expect(ea.setNewPassword).toHaveBeenCalledWith("mat-khau-moi"));
    await waitFor(() => expect(auth.adoptSession).toHaveBeenCalledWith(S));
  });

  it("refuses without a link or a fresh recovery (a signed-in session alone is no proof)", async () => {
    render(<ResetPassword params={{}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Liên kết không hợp lệ hoặc đã hết hạn.");
    expect(ea.handleAuthRedirect).not.toHaveBeenCalled();
    cleanup();
    markRecovery();
    ea.handleAuthRedirect.mockResolvedValue("session");
    render(<ResetPassword params={{}} />);
    expect(await screen.findByPlaceholderText(/Mật khẩu mới/)).toBeInTheDocument();
  });
});

describe("Tài khoản and the banner", () => {
  it("a legacy account links an email and changes its game password", async () => {
    ea.fetchAuthState.mockResolvedValue({ linked: false, email: null, legacyPassword: true });
    ea.linkEmailStart.mockResolvedValue(undefined);
    ea.changeLegacyPassword.mockResolvedValue(undefined);
    render(<AccountModal onClose={() => {}} />);
    fireEvent.change(await screen.findByPlaceholderText("Email"), { target: { value: "dat@mail.vn" } });
    fireEvent.change(screen.getByPlaceholderText(/Mật khẩu cho email/), { target: { value: "mat-khau-dai" } });
    fireEvent.change(screen.getByPlaceholderText("Nhập lại mật khẩu"), { target: { value: "mat-khau-dai" } });
    fireEvent.submit(screen.getByPlaceholderText("Email").closest("form")!);
    expect(await screen.findByText(LINK_SENT)).toBeInTheDocument();
    expect(ea.linkEmailStart).toHaveBeenCalledWith("acc-1", "dat@mail.vn", "mat-khau-dai");

    fireEvent.change(screen.getByPlaceholderText("Mật khẩu hiện tại"), { target: { value: "cu" } });
    fireEvent.change(screen.getByPlaceholderText(/^Mật khẩu mới/), { target: { value: "mat-khau-moi" } });
    fireEvent.change(screen.getByPlaceholderText("Nhập lại mật khẩu mới"), { target: { value: "mat-khau-moi" } });
    fireEvent.submit(screen.getByPlaceholderText("Mật khẩu hiện tại").closest("form")!);
    expect(await screen.findByText("Đã đổi mật khẩu.")).toBeInTheDocument();
    expect(ea.changeLegacyPassword).toHaveBeenCalledWith("game-t", "cu", "mat-khau-moi");
    expect(screen.queryByPlaceholderText("Email mới")).toBeNull();
  });

  it("an email account changes its password through Supabase and can change its email", async () => {
    ea.fetchAuthState.mockResolvedValue({ linked: true, email: "dat@mail.vn", legacyPassword: false });
    ea.changeEmailPassword.mockRejectedValueOnce(new Error("wrong password"));
    render(<AccountModal onClose={() => {}} />);
    expect(await screen.findByText("dat@mail.vn")).toBeInTheDocument();
    expect(screen.queryByText("Liên kết email")).toBeNull();
    fireEvent.change(screen.getByPlaceholderText("Mật khẩu hiện tại"), { target: { value: "sai" } });
    fireEvent.change(screen.getByPlaceholderText(/^Mật khẩu mới/), { target: { value: "mat-khau-moi" } });
    fireEvent.change(screen.getByPlaceholderText("Nhập lại mật khẩu mới"), { target: { value: "mat-khau-moi" } });
    fireEvent.submit(screen.getByPlaceholderText("Mật khẩu hiện tại").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Mật khẩu hiện tại không đúng.");
    expect(ea.changeEmailPassword).toHaveBeenCalledWith("dat@mail.vn", "sai", "mat-khau-moi");
    expect(screen.getByPlaceholderText("Email mới")).toBeInTheDocument();
  });

  it("the banner nudges an unlinked account and stays dismissed", async () => {
    ea.fetchAuthState.mockResolvedValue({ linked: false, email: null, legacyPassword: true });
    const onLink = vi.fn();
    render(<LinkEmailBanner onLink={onLink} />);
    fireEvent.click(await screen.findByRole("button", { name: "Liên kết ngay" }));
    expect(onLink).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ẩn thông báo" }));
    expect(screen.queryByRole("note")).toBeNull();
    cleanup();
    render(<LinkEmailBanner onLink={onLink} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("no banner for a linked account", async () => {
    ea.fetchAuthState.mockResolvedValue({ linked: true, email: "dat@mail.vn", legacyPassword: false });
    render(<LinkEmailBanner onLink={() => {}} />);
    await waitFor(() => expect(ea.fetchAuthState).toHaveBeenCalled());
    expect(screen.queryByRole("note")).toBeNull();
  });
});
