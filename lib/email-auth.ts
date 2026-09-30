// Email accounts (0112, docs/superpowers/specs/2026-09-30-email-auth-design.md): Supabase Auth holds the email and its
// password; the game keeps its own session tokens. A confirmed Supabase session is traded for a game session by
// game_session_from_auth, so no game RPC changes. Supabase Auth calls and the auth-only RPCs go through authClient;
// the game-token RPCs (change_password, account_auth_state) through the anon game client.
import { authClient } from "@/lib/supabase-auth";
import { supabase } from "@/lib/supabase";
import type { AuthResult } from "@/lib/auth";

export const MIN_PASSWORD = 8;

/** A pending "link this email" started in this browser: the callback links on its own only when it matches. */
const LINK_KEY = "music-together:link-pending";
const LINK_TTL_MS = 2 * 24 * 3600 * 1000;
export interface PendingLink { accountId: string; email: string; at: number; }

function origin(): string {
  return typeof window !== "undefined" ? window.location.origin : "";
}
export function callbackUrl(): string { return `${origin()}/auth/callback`; }
export function resetUrl(): string { return `${origin()}/auth/reset`; }

function row<T>(data: unknown): T {
  return (Array.isArray(data) ? data[0] : data) as T;
}
function fail(message: string): Error { return new Error(message); }

export function normEmail(email: string): string { return email.trim().toLowerCase(); }
export function isEmail(email: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()); }

/** A registered email answers like a new one (no email enumeration): the page says "if the email exists…" either way. */
function isAlreadyRegistered(e: { message?: string }): boolean {
  return /already (been )?registered|already exists/i.test(e.message ?? "");
}

// ---------- sign-up, sign-in ----------
/** Sign-up: Supabase sends the confirmation mail; no game account exists until the email is confirmed. */
export async function signUpEmail(email: string, password: string, username: string): Promise<void> {
  if (!isEmail(email)) throw fail("invalid email");
  if (password.length < MIN_PASSWORD) throw fail("weak password");
  const { error } = await authClient.auth.signUp({
    email: normEmail(email), password,
    options: { emailRedirectTo: callbackUrl(), data: { username: username.trim() } },
  });
  if (error && !isAlreadyRegistered(error)) throw error;
}

/** The game session of the signed-in Supabase user; null when that user has no game account yet. */
export async function gameSessionFromAuth(): Promise<AuthResult | null> {
  const { data, error } = await authClient.rpc("game_session_from_auth");
  if (error) {
    if (error.message === "no game account") return null;
    throw error;
  }
  const r = row<{ account_id: string; username: string; token: string }>(data);
  return { accountId: r.account_id, username: r.username, token: r.token };
}

/** A page load without a game session: a still signed-in email user gets a fresh one (no request when signed out). */
export async function resumeEmailSession(): Promise<AuthResult | null> {
  const { data } = await authClient.auth.getSession();
  if (!data.session) return null;
  return gameSessionFromAuth();
}

export async function signInEmail(email: string, password: string): Promise<AuthResult | null> {
  const { error } = await authClient.auth.signInWithPassword({ email: normEmail(email), password });
  if (error) throw error;
  return gameSessionFromAuth();
}

/** The confirmed user's game account (one per user; an existing one is reused), then its game session. */
export async function createAccountForAuth(username: string): Promise<AuthResult> {
  const { data, error } = await authClient.rpc("account_create_for_auth", { p_username: username.trim() });
  if (error) throw error;
  const r = data as { ok: boolean; error?: string };
  if (!r?.ok) throw fail(r?.error ?? "unknown");
  const s = await gameSessionFromAuth();
  if (!s) throw fail("no game account");
  return s;
}

/** The signed-in Supabase user's username wish (sign-up metadata) and email. */
export async function currentAuthUser(): Promise<{ email: string; username: string | null; linkIntent: boolean } | null> {
  const { data } = await authClient.auth.getSession();
  const u = data.session?.user;
  if (!u) return null;
  const meta = (u.user_metadata ?? {}) as { username?: unknown; link_intent?: unknown };
  return {
    email: u.email ?? "",
    username: typeof meta.username === "string" && meta.username ? meta.username : null,
    linkIntent: meta.link_intent === true,
  };
}

// ---------- linking a legacy account ----------
export function savePendingLink(p: PendingLink): void {
  try { localStorage.setItem(LINK_KEY, JSON.stringify(p)); } catch { /* private mode */ }
}
export function loadPendingLink(now = Date.now()): PendingLink | null {
  try {
    const p = JSON.parse(localStorage.getItem(LINK_KEY) ?? "null") as PendingLink | null;
    if (!p || typeof p.accountId !== "string" || typeof p.email !== "string" || now - p.at > LINK_TTL_MS) return null;
    return p;
  } catch { return null; }
}
export function clearPendingLink(): void {
  try { localStorage.removeItem(LINK_KEY); } catch { /* private mode */ }
}

/** "Liên kết email", step 1: the logged-in legacy player creates the Supabase user; the link happens after the
 *  confirmation (the callback, in this browser, with the pending marker). */
export async function linkEmailStart(accountId: string, email: string, password: string): Promise<void> {
  if (!isEmail(email)) throw fail("invalid email");
  if (password.length < MIN_PASSWORD) throw fail("weak password");
  const { error } = await authClient.auth.signUp({
    email: normEmail(email), password,
    options: { emailRedirectTo: callbackUrl(), data: { link_intent: true } },
  });
  if (error && !isAlreadyRegistered(error)) throw error;
  savePendingLink({ accountId, email: normEmail(email), at: Date.now() });
}

/** Step 2: the proofs — the game token and the legacy password (the account; 0113: a token alone may have leaked)
 *  and the Supabase JWT (the confirmed email). */
export async function linkWithGameToken(gameToken: string, legacyPassword: string): Promise<void> {
  const { data, error } = await authClient.rpc("account_link_auth", { p_session_token: gameToken, p_password: legacyPassword });
  if (error) throw error;
  const r = data as { ok: boolean; error?: string };
  if (!r?.ok) throw fail(r?.error ?? "unknown");
}

// ---------- the redirect of a mail ----------
export type RedirectParams = Record<string, string | string[] | undefined>;
function one(p: RedirectParams, k: string): string | null {
  const v = p[k];
  return typeof v === "string" && v ? v : null;
}

/** Signs in from a mail's link: `token_hash` + `type` (the templates of deploy/HUONG-DAN-EMAIL.md, any device) or a
 *  PKCE `code` (Supabase's default link, the browser that asked). Returns the link's type. */
export async function handleAuthRedirect(p: RedirectParams): Promise<string> {
  const err = one(p, "error_description") ?? one(p, "error");
  if (err) throw fail("link invalid");
  const tokenHash = one(p, "token_hash");
  const type = one(p, "type");
  if (tokenHash && type) {
    const { error } = await authClient.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" });
    if (error) throw fail("link invalid");
    return type;
  }
  const code = one(p, "code");
  if (code) {
    const { error } = await authClient.auth.exchangeCodeForSession(code);
    if (error) throw fail("link invalid");
    return type ?? "code";
  }
  const { data } = await authClient.auth.getSession();
  if (data.session) return "session";
  throw fail("link invalid");
}

/** A recovery link the callback handled, for /auth/reset (this tab only, read once). */
const RECOVERY_KEY = "music-together:recovery";
export function markRecovery(): void {
  try { sessionStorage.setItem(RECOVERY_KEY, String(Date.now())); } catch { /* private mode */ }
}
export function takeRecoveryMark(now = Date.now()): boolean {
  try {
    const at = Number(sessionStorage.getItem(RECOVERY_KEY));
    sessionStorage.removeItem(RECOVERY_KEY);
    return at > 0 && now - at < 10 * 60 * 1000;
  } catch { return false; }
}

// ---------- passwords and email ----------
/** Never says whether the email exists: the same answer either way. */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!isEmail(email)) throw fail("invalid email");
  const { error } = await authClient.auth.resetPasswordForEmail(normEmail(email), { redirectTo: resetUrl() });
  if (error && /rate limit|too many/i.test(error.message)) throw fail("too many attempts");
}

export async function setNewPassword(password: string): Promise<void> {
  if (password.length < MIN_PASSWORD) throw fail("weak password");
  const { error } = await authClient.auth.updateUser({ password });
  if (error) throw error;
}

/** An email account's password: the current one is checked first (signInWithPassword). */
export async function changeEmailPassword(email: string, current: string, next: string): Promise<void> {
  if (next.length < MIN_PASSWORD) throw fail("weak password");
  const { error: e1 } = await authClient.auth.signInWithPassword({ email: normEmail(email), password: current });
  if (e1) throw fail("wrong password");
  await setNewPassword(next);
}

/** Supabase mails a confirmation; the game's copy of the email follows at the next game_session_from_auth. */
export async function changeEmail(currentEmail: string, newEmail: string): Promise<void> {
  if (!isEmail(newEmail)) throw fail("invalid email");
  const { data } = await authClient.auth.getSession();
  // the signed-in Supabase user must be this game account's (never another email user's stale session)
  if (!data.session || normEmail(data.session.user.email ?? "") !== normEmail(currentEmail)) throw fail("auth session missing");
  const { error } = await authClient.auth.updateUser({ email: normEmail(newEmail) }, { emailRedirectTo: callbackUrl() });
  if (error) throw error;
}

/** A legacy (username) account's password, the game's bcrypt (0112 change_password). */
export async function changeLegacyPassword(gameToken: string, oldPw: string, newPw: string): Promise<void> {
  const { data, error } = await supabase.rpc("change_password", { p_session_token: gameToken, p_old: oldPw, p_new: newPw });
  if (error) throw error;
  const r = data as { ok: boolean; error?: string };
  if (!r?.ok) throw fail(r?.error ?? "unknown");
}

export interface AuthState { linked: boolean; email: string | null; legacyPassword: boolean; }
export async function fetchAuthState(gameToken: string): Promise<AuthState | null> {
  const { data, error } = await supabase.rpc("account_auth_state", { p_session_token: gameToken });
  if (error || !data) return null;
  const r = data as { linked?: boolean; email?: string | null; legacy_password?: boolean };
  return { linked: !!r.linked, email: r.email ?? null, legacyPassword: !!r.legacy_password };
}

export async function signOutEmail(): Promise<void> {
  try { await authClient.auth.signOut({ scope: "local" }); } catch { /* offline: the local session is dropped anyway */ }
}

// ---------- the Vietnamese texts ----------
/** The text of an auth refusal. Never says whether an email is registered. */
export function emailAuthErrorText(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid email") || m.includes("unable to validate email")) return "Email không hợp lệ.";
  if (m.includes("weak password") || m.includes("password should be")) return `Mật khẩu cần ít nhất ${MIN_PASSWORD} ký tự.`;
  if (m.includes("invalid login credentials")) return "Sai email hoặc mật khẩu.";
  if (m.includes("email not confirmed")) return "Email chưa được xác nhận. Hãy mở thư xác nhận trong hộp thư của bạn.";
  if (m.includes("wrong password")) return "Mật khẩu hiện tại không đúng.";
  if (m.includes("too many attempts") || m.includes("rate limit")) return "Bạn thử quá nhiều lần. Hãy đợi một lúc rồi thử lại.";
  if (m.includes("already taken")) return "Tên nhân vật đã có người dùng. Hãy chọn tên khác.";
  if (m === "invalid username") {
    return "Tên nhân vật cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn.";
  }
  if (m.includes("account banned")) return "🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên.";
  if (m.includes("account already linked")) return "Tài khoản này đã được liên kết với một email khác.";
  if (m.includes("email already linked")) return "Email này đã được liên kết với một tài khoản khác.";
  if (m.includes("invalid session")) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.";
  if (m.includes("no legacy password")) return "Tài khoản này đăng nhập bằng email — hãy đổi mật khẩu email.";
  if (m.includes("link invalid")) return "Liên kết không hợp lệ hoặc đã hết hạn.";
  if (m.includes("auth session missing")) return "Hãy đăng nhập lại bằng email rồi thử lại.";
  if (m.includes("same_password") || m.includes("should be different")) return "Mật khẩu mới phải khác mật khẩu cũ.";
  return "Có lỗi xảy ra, hãy thử lại.";
}
