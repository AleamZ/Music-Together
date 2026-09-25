import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/components/brand/Logo", () => ({ default: () => null }));

import AuthScreen from "@/components/auth/AuthScreen";

beforeEach(() => {
  auth.login.mockReset();
  auth.register.mockReset();
});
afterEach(cleanup);

function submit(username: string) {
  fireEvent.change(screen.getByPlaceholderText("Tên đăng nhập (username)"), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText("Mật khẩu"), { target: { value: "mat-khau-thu" } });
  fireEvent.submit(screen.getByPlaceholderText("Mật khẩu").closest("form")!);
}

describe("AuthScreen — anti-cheat refusals (spec §12.3)", () => {
  it("tells a banned account at login, without saying for how long", async () => {
    auth.login.mockRejectedValueOnce({ message: "account banned" });
    render(<AuthScreen />);
    submit("Dat");
    // an alert, so a screen reader reads it out when it appears
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên.");
    expect(auth.login).toHaveBeenCalledWith("Dat", "mat-khau-thu");
  });

  it("explains the username rules when register refuses a name", async () => {
    auth.register.mockRejectedValueOnce({ message: "invalid username" });
    render(<AuthScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Đăng ký" }));
    submit("Ao cá");
    expect(await screen.findByText(
      "Tên đăng nhập cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn.",
    )).toBeInTheDocument();
  });

  it("keeps the old texts", async () => {
    auth.login.mockRejectedValueOnce({ message: "invalid username or password" });
    render(<AuthScreen />);
    submit("Dat");
    expect(await screen.findByText("Sai tên đăng nhập hoặc mật khẩu.")).toBeInTheDocument();
    auth.login.mockRejectedValueOnce({ message: "username already taken" });
    submit("Dat");
    expect(await screen.findByText("Tên đăng nhập đã tồn tại.")).toBeInTheDocument();
  });
});
