import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  auth: {
    signUp: vi.fn(), signInWithPassword: vi.fn(), verifyOtp: vi.fn(), exchangeCodeForSession: vi.fn(),
    getSession: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), signOut: vi.fn(),
  },
  authRpc: vi.fn(),
  gameRpc: vi.fn(),
}));
vi.mock("@/lib/supabase-auth", () => ({ authClient: { auth: m.auth, rpc: m.authRpc } }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: m.gameRpc } }));

import {
  changeEmail, changeEmailPassword, changeLegacyPassword, createAccountForAuth, emailAuthErrorText, fetchAuthState,
  gameSessionFromAuth, handleAuthRedirect, linkEmailStart, linkWithGameToken, loadPendingLink, markRecovery,
  requestPasswordReset, resumeEmailSession, savePendingLink, signInEmail, signOutEmail, signUpEmail, takeRecoveryMark,
} from "@/lib/email-auth";

beforeEach(() => {
  for (const f of Object.values(m.auth)) f.mockReset();
  m.authRpc.mockReset(); m.gameRpc.mockReset();
  localStorage.clear(); sessionStorage.clear();
});

const session = { data: { session: { user: { email: "a@b.vn", user_metadata: { username: "Dat" } } } } };

describe("sign-up and sign-in (0112)", () => {
  it("signs up with the callback redirect and the in-game name, lower-casing the email", async () => {
    m.auth.signUp.mockResolvedValue({ error: null });
    await signUpEmail(" Dat@Mail.VN ", "mat-khau-dai", " Dat ");
    expect(m.auth.signUp).toHaveBeenCalledWith({
      email: "dat@mail.vn", password: "mat-khau-dai",
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, data: { username: "Dat" } },
    });
  });

  it("answers a registered email like a new one (no enumeration)", async () => {
    m.auth.signUp.mockResolvedValue({ error: { message: "User already registered" } });
    await expect(signUpEmail("a@b.vn", "mat-khau-dai", "Dat")).resolves.toBeUndefined();
  });

  it("refuses a short password or a bad email before calling Supabase", async () => {
    await expect(signUpEmail("a@b.vn", "ngan", "Dat")).rejects.toThrow("weak password");
    await expect(signUpEmail("khong-phai-email", "mat-khau-dai", "Dat")).rejects.toThrow("invalid email");
    expect(m.auth.signUp).not.toHaveBeenCalled();
  });

  it("trades the Supabase session for a game session; null without a game account", async () => {
    m.authRpc.mockResolvedValueOnce({ data: [{ account_id: "a1", username: "Dat", token: "t1" }], error: null });
    expect(await gameSessionFromAuth()).toEqual({ accountId: "a1", username: "Dat", token: "t1" });
    expect(m.authRpc).toHaveBeenCalledWith("game_session_from_auth");
    m.authRpc.mockResolvedValueOnce({ data: null, error: { message: "no game account" } });
    expect(await gameSessionFromAuth()).toBeNull();
    m.authRpc.mockResolvedValueOnce({ data: null, error: { message: "account banned" } });
    await expect(gameSessionFromAuth()).rejects.toEqual({ message: "account banned" });
  });

  it("signs in by email, then gets the game session", async () => {
    m.auth.signInWithPassword.mockResolvedValue({ error: null });
    m.authRpc.mockResolvedValue({ data: { account_id: "a1", username: "Dat", token: "t1" }, error: null });
    expect(await signInEmail("A@B.vn", "pw")).toEqual({ accountId: "a1", username: "Dat", token: "t1" });
    expect(m.auth.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.vn", password: "pw" });
  });

  it("resumes only when a Supabase session exists (no request when signed out)", async () => {
    m.auth.getSession.mockResolvedValue({ data: { session: null } });
    expect(await resumeEmailSession()).toBeNull();
    expect(m.authRpc).not.toHaveBeenCalled();
  });

  it("creates the account, then its session; a refusal is thrown as its code", async () => {
    m.authRpc.mockResolvedValueOnce({ data: { ok: false, error: "username already taken" }, error: null });
    await expect(createAccountForAuth("Dat")).rejects.toThrow("username already taken");
    m.authRpc
      .mockResolvedValueOnce({ data: { ok: true, account_id: "a1", username: "Dat", created: true }, error: null })
      .mockResolvedValueOnce({ data: { account_id: "a1", username: "Dat", token: "t1" }, error: null });
    expect(await createAccountForAuth(" Dat ")).toEqual({ accountId: "a1", username: "Dat", token: "t1" });
    expect(m.authRpc).toHaveBeenCalledWith("account_create_for_auth", { p_username: "Dat" });
  });
});

describe("linking a legacy account", () => {
  it("starts with a sign-up marked as a link and a pending marker for this browser", async () => {
    m.auth.signUp.mockResolvedValue({ error: null });
    await linkEmailStart("acc-1", "Me@Mail.vn", "mat-khau-dai");
    expect(m.auth.signUp.mock.calls[0][0].options.data).toEqual({ link_intent: true });
    expect(loadPendingLink()).toMatchObject({ accountId: "acc-1", email: "me@mail.vn" });
  });

  it("forgets a pending marker after two days", () => {
    savePendingLink({ accountId: "a", email: "e@x.vn", at: 1000 });
    expect(loadPendingLink(1000 + 3600_000)).not.toBeNull();
    expect(loadPendingLink(1000 + 3 * 24 * 3600_000)).toBeNull();
  });

  it("links with the game token through the auth client", async () => {
    m.authRpc.mockResolvedValueOnce({ data: { ok: true, linked: true }, error: null });
    await linkWithGameToken("game-token");
    expect(m.authRpc).toHaveBeenCalledWith("account_link_auth", { p_session_token: "game-token" });
    m.authRpc.mockResolvedValueOnce({ data: { ok: false, error: "account already linked" }, error: null });
    await expect(linkWithGameToken("game-token")).rejects.toThrow("account already linked");
  });
});

describe("mail links", () => {
  it("verifies a token_hash link (any device)", async () => {
    m.auth.verifyOtp.mockResolvedValue({ error: null });
    expect(await handleAuthRedirect({ token_hash: "h", type: "email" })).toBe("email");
    expect(m.auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "h", type: "email" });
  });
  it("exchanges a PKCE code", async () => {
    m.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    expect(await handleAuthRedirect({ code: "c" })).toBe("code");
    m.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: "bad verifier" } });
    await expect(handleAuthRedirect({ code: "c" })).rejects.toThrow("link invalid");
  });
  it("refuses an error redirect or an empty one without a session", async () => {
    await expect(handleAuthRedirect({ error: "access_denied", error_description: "expired" })).rejects.toThrow("link invalid");
    m.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(handleAuthRedirect({})).rejects.toThrow("link invalid");
    m.auth.getSession.mockResolvedValue(session);
    expect(await handleAuthRedirect({})).toBe("session");
  });
  it("keeps a recovery mark for one read", () => {
    expect(takeRecoveryMark()).toBe(false);
    markRecovery();
    expect(takeRecoveryMark()).toBe(true);
    expect(takeRecoveryMark()).toBe(false);
  });
});

describe("passwords and email", () => {
  it("asks for a reset with the reset redirect and says nothing about an unknown email", async () => {
    m.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "User not found" } });
    await expect(requestPasswordReset("A@b.vn")).resolves.toBeUndefined();
    expect(m.auth.resetPasswordForEmail).toHaveBeenCalledWith("a@b.vn", { redirectTo: `${window.location.origin}/auth/reset` });
    m.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: "email rate limit exceeded" } });
    await expect(requestPasswordReset("a@b.vn")).rejects.toThrow("too many attempts");
  });

  it("checks the current password before changing an email account's", async () => {
    m.auth.signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid login credentials" } });
    await expect(changeEmailPassword("a@b.vn", "sai", "mat-khau-moi")).rejects.toThrow("wrong password");
    expect(m.auth.updateUser).not.toHaveBeenCalled();
    m.auth.signInWithPassword.mockResolvedValueOnce({ error: null });
    m.auth.updateUser.mockResolvedValueOnce({ error: null });
    await changeEmailPassword("a@b.vn", "dung", "mat-khau-moi");
    expect(m.auth.updateUser).toHaveBeenCalledWith({ password: "mat-khau-moi" });
  });

  it("changes the email with a confirmation mail back to the callback", async () => {
    m.auth.getSession.mockResolvedValue(session);
    m.auth.updateUser.mockResolvedValue({ error: null });
    await changeEmail("a@b.vn", "New@Mail.vn");
    expect(m.auth.updateUser).toHaveBeenCalledWith({ email: "new@mail.vn" }, { emailRedirectTo: `${window.location.origin}/auth/callback` });
    await expect(changeEmail("other@b.vn", "x@y.vn")).rejects.toThrow("auth session missing");
    m.auth.getSession.mockResolvedValue({ data: { session: null } });
    await expect(changeEmail("a@b.vn", "x@y.vn")).rejects.toThrow("auth session missing");
  });

  it("changes a legacy password through the game RPC", async () => {
    m.gameRpc.mockResolvedValueOnce({ data: { ok: false, error: "wrong password" }, error: null });
    await expect(changeLegacyPassword("t", "a", "b")).rejects.toThrow("wrong password");
    expect(m.gameRpc).toHaveBeenCalledWith("change_password", { p_session_token: "t", p_old: "a", p_new: "b" });
  });

  it("reads the link state", async () => {
    m.gameRpc.mockResolvedValueOnce({ data: { linked: false, email: null, legacy_password: true }, error: null });
    expect(await fetchAuthState("t")).toEqual({ linked: false, email: null, legacyPassword: true });
  });

  it("signs out of Supabase Auth without throwing offline", async () => {
    m.auth.signOut.mockRejectedValue(new Error("offline"));
    await expect(signOutEmail()).resolves.toBeUndefined();
    expect(m.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("speaks Vietnamese and never says an email is unknown", () => {
    expect(emailAuthErrorText("Invalid login credentials")).toBe("Sai email hoặc mật khẩu.");
    expect(emailAuthErrorText("too many attempts")).toContain("quá nhiều lần");
    expect(emailAuthErrorText("User not found")).toBe("Có lỗi xảy ra, hãy thử lại.");
    expect(emailAuthErrorText("invalid username")).toContain("2–24 ký tự");
  });
});
