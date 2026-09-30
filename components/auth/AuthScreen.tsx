"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Logo from "@/components/brand/Logo";
import { emailAuthErrorText, requestPasswordReset, signUpEmail, MIN_PASSWORD } from "@/lib/email-auth";

/** The Vietnamese text of a legacy login refusal (anti-cheat spec §12.3); anything else shows as the server sent it. */
function authErrorText(msg: string): string {
  if (msg.includes("already taken")) return "Tên đăng nhập đã tồn tại.";
  if (msg.includes("invalid username or password")) return "Sai tên đăng nhập hoặc mật khẩu.";
  if (msg.includes("email login required")) return "Tài khoản này đã liên kết email — hãy đăng nhập ở thẻ Email.";
  if (msg === "invalid username") {
    return "Tên đăng nhập cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn.";
  }
  if (msg.includes("account banned")) return "🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên.";
  return msg;
}

/** The mail-sent answer: the same whether or not the email is registered (no enumeration). */
export const SIGNUP_SENT = "Nếu email hợp lệ, bạn sẽ nhận được thư xác nhận. Hãy mở thư và bấm vào liên kết để hoàn tất đăng ký.";
export const RESET_SENT = "Nếu email tồn tại, bạn sẽ nhận được thư hướng dẫn đặt lại mật khẩu.";

type Tab = "email" | "legacy";
type EmailMode = "login" | "register" | "forgot";

const input = "rounded-lg border border-gold bg-cream px-3 py-2 text-ink";
const primary = "rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60";
const pill = (on: boolean) => `flex-1 rounded-full px-4 py-2 ${on ? "bg-burgundy text-cream" : "text-burgundy"}`;

export default function AuthScreen() {
  const { login, loginWithEmail } = useAuth();
  const [tab, setTab] = useState<Tab>("email");
  const [mode, setMode] = useState<EmailMode>("login");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function switchTo(t: Tab, m: EmailMode = "login") {
    setTab(t); setMode(m); setError(null); setNotice(null);
  }

  async function submitLegacy(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try { await login(username.trim(), password); }
    catch (err) {
      setError(authErrorText((err as { message?: string }).message ?? "Có lỗi xảy ra"));
      setBusy(false);
    }
  }

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setNotice(null); setBusy(true);
    try {
      if (mode === "login") {
        const ok = await loginWithEmail(email, password);
        // a confirmed email without a game account yet: the callback page asks for the name
        if (!ok) { window.location.assign("/auth/callback"); return; }
        return;
      }
      if (mode === "register") {
        await signUpEmail(email, password, username);
        setNotice(SIGNUP_SENT); setPassword("");
      } else {
        await requestPasswordReset(email);
        setNotice(RESET_SENT);
      }
    } catch (err) {
      setError(emailAuthErrorText((err as { message?: string }).message ?? ""));
    }
    setBusy(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-6">
      <header className="flex justify-center text-center">
        <h1 className="sr-only">Music Together</h1>
        <Logo size={56} />
      </header>
      <div className="flex rounded-full border border-gold text-sm" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "email"} onClick={() => switchTo("email")} className={pill(tab === "email")}>Email</button>
        <button type="button" role="tab" aria-selected={tab === "legacy"} onClick={() => switchTo("legacy")} className={pill(tab === "legacy")}>Tên đăng nhập cũ</button>
      </div>

      {tab === "email" ? (
        <>
          {mode !== "forgot" && (
            <div className="flex rounded-full border border-gold-200 text-sm">
              <button type="button" onClick={() => switchTo("email", "login")} className={pill(mode === "login")}>Đăng nhập</button>
              <button type="button" onClick={() => switchTo("email", "register")} className={pill(mode === "register")}>Đăng ký</button>
            </div>
          )}
          {mode === "forgot" && <h2 className="text-center font-cormorant text-xl text-burgundy">Quên mật khẩu</h2>}
          <form onSubmit={submitEmail} className="flex flex-col gap-3">
            <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className={input} />
            {mode === "register" && (
              <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên nhân vật (hiện trong game)" className={input} />
            )}
            {mode !== "forgot" && (
              <input required type="password" minLength={mode === "register" ? MIN_PASSWORD : undefined}
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "register" ? `Mật khẩu (ít nhất ${MIN_PASSWORD} ký tự)` : "Mật khẩu"} className={input} />
            )}
            {error && <p role="alert" className="text-sm text-burgundy-accent">{error}</p>}
            {notice && <p role="status" className="text-sm text-ink">{notice}</p>}
            <button type="submit" disabled={busy} className={primary}>
              {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : mode === "register" ? "Đăng ký" : "Gửi thư đặt lại mật khẩu"}
            </button>
          </form>
          {mode === "forgot" ? (
            <div className="flex flex-col gap-2 text-center text-sm">
              <p className="text-ink/70">Tài khoản cũ (chỉ có tên đăng nhập, chưa liên kết email) không thể lấy lại mật khẩu — hãy liên kết email trong phần Tài khoản khi còn đăng nhập được.</p>
              <button type="button" onClick={() => switchTo("email", "login")} className="text-burgundy-accent underline">Quay lại đăng nhập</button>
            </div>
          ) : (
            <button type="button" onClick={() => switchTo("email", "forgot")} className="text-sm text-burgundy-accent underline">Quên mật khẩu?</button>
          )}
        </>
      ) : (
        <>
          <form onSubmit={submitLegacy} className="flex flex-col gap-3">
            <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập (username)" className={input} />
            <input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu" className={input} />
            {error && <p role="alert" className="text-sm text-burgundy-accent">{error}</p>}
            <button type="submit" disabled={busy} className={primary}>{busy ? "Đang xử lý…" : "Đăng nhập"}</button>
          </form>
          <p className="text-center text-xs text-ink/70">
            Dành cho tài khoản tạo trước khi có đăng ký bằng email. Sau khi đăng nhập, hãy liên kết email để có thể lấy lại mật khẩu.
          </p>
        </>
      )}
    </main>
  );
}
