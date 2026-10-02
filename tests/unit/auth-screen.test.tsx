import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn(), loginWithEmail: vi.fn() }));
const email = vi.hoisted(() => ({ signUpEmail: vi.fn(), requestPasswordReset: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/components/brand/Logo", () => ({ default: () => null }));
vi.mock("@/lib/email-auth", async (orig) => ({ ...(await orig<typeof import("@/lib/email-auth")>()), ...email }));

import AuthScreen, { RESET_SENT, SIGNUP_SENT } from "@/components/auth/AuthScreen";

beforeEach(() => {
  for (const f of [...Object.values(auth), ...Object.values(email)]) f.mockReset();
});
afterEach(cleanup);

function legacyTab() { fireEvent.click(screen.getByRole("tab", { name: "Tên đăng nhập cũ" })); }
function submitLegacy(username: string) {
  fireEvent.change(screen.getByPlaceholderText("Tên đăng nhập (username)"), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), { target: { value: "mat-khau-thu" } });
  fireEvent.submit(screen.getByPlaceholderText("Mật khẩu").closest("form")!);
}
function type(placeholder: string | RegExp, value: string) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

describe("AuthScreen — the legacy tab (anti-cheat spec §12.3)", () => {
  it("tells a banned account at login, without saying for how long", async () => {
    auth.login.mockRejectedValueOnce({ message: "account banned" });
    render(<AuthScreen />);
    legacyTab();
    submitLegacy("Dat");
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên.");
    expect(auth.login).toHaveBeenCalledWith("Dat", "mat-khau-thu");
  });

  it("keeps the old texts, and sends a linked account to the Email tab", async () => {
    auth.login.mockRejectedValueOnce({ message: "invalid username or password" });
    render(<AuthScreen />);
    legacyTab();
    submitLegacy("Dat");
    expect(await screen.findByText("Sai tên đăng nhập hoặc mật khẩu.")).toBeInTheDocument();
    auth.login.mockRejectedValueOnce({ message: "email login required" });
    submitLegacy("Dat");
    expect(await screen.findByText("Tài khoản này đã liên kết email — hãy đăng nhập ở thẻ Email.")).toBeInTheDocument();
  });

  it("offers no username sign-up any more", () => {
    render(<AuthScreen />);
    legacyTab();
    expect(screen.queryByRole("button", { name: "Đăng ký" })).toBeNull();
  });
});

describe("AuthScreen — the Email tab (0112)", () => {
  it("is the default tab and logs in by email", async () => {
    auth.loginWithEmail.mockResolvedValueOnce(true);
    render(<AuthScreen />);
    type("Email", "dat@mail.vn");
    type("Mật khẩu", "mat-khau-dai");
    fireEvent.submit(screen.getByPlaceholderText("Email").closest("form")!);
    await vi.waitFor(() => expect(auth.loginWithEmail).toHaveBeenCalledWith("dat@mail.vn", "mat-khau-dai"));
  });

  it("shows a wrong email or password in Vietnamese", async () => {
    auth.loginWithEmail.mockRejectedValueOnce({ message: "Invalid login credentials" });
    render(<AuthScreen />);
    type("Email", "dat@mail.vn");
    type("Mật khẩu", "sai-mat-khau");
    fireEvent.submit(screen.getByPlaceholderText("Email").closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Sai email hoặc mật khẩu.");
  });

  it("signs up with email, password and the in-game name, then says to check the mail", async () => {
    email.signUpEmail.mockResolvedValueOnce(undefined);
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Đăng ký" }));
    type("Email", "dat@mail.vn");
    type("Tên nhân vật (hiện trong game)", "Dat");
    type(/Mật khẩu \(ít nhất 8 ký tự\)/, "mat-khau-dai");
    fireEvent.submit(screen.getByPlaceholderText("Email").closest("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent(SIGNUP_SENT);
    expect(email.signUpEmail).toHaveBeenCalledWith("dat@mail.vn", "mat-khau-dai", "Dat");
  });

  it("sends a reset mail with the same answer for any email, and explains legacy accounts", async () => {
    email.requestPasswordReset.mockResolvedValueOnce(undefined);
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Quên mật khẩu?" }));
    expect(screen.getByText(/Tài khoản cũ .* không thể lấy lại mật khẩu/)).toBeInTheDocument();
    type("Email", "ai-do@mail.vn");
    fireEvent.submit(screen.getByPlaceholderText("Email").closest("form")!);
    expect(await screen.findByRole("status")).toHaveTextContent(RESET_SENT);
    expect(RESET_SENT).toBe("Nếu email tồn tại, bạn sẽ nhận được thư hướng dẫn đặt lại mật khẩu.");
  });
});
