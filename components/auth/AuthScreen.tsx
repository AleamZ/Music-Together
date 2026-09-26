"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import Logo from "@/components/brand/Logo";

/** The Vietnamese text of a login or register refusal (anti-cheat spec §12.3); anything else shows as the server sent it. */
function authErrorText(msg: string): string {
  if (msg.includes("already taken")) return "Tên đăng nhập đã tồn tại.";
  if (msg.includes("invalid username or password")) return "Sai tên đăng nhập hoặc mật khẩu.";
  if (msg === "invalid username") {
    return "Tên đăng nhập cần 2–24 ký tự, không dùng tên dành riêng (Ao cá, Hợp tác xã, root…) hoặc ký tự ẩn.";
  }
  if (msg.includes("account banned")) return "🚫 Tài khoản này đã bị khoá. Nếu bạn nghĩ đây là nhầm lẫn, hãy liên hệ quản trị viên.";
  return msg;
}

export default function AuthScreen() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
    } catch (err) {
      setError(authErrorText((err as { message?: string }).message ?? "Có lỗi xảy ra"));
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-6">
      <header className="flex justify-center text-center">
        <h1 className="sr-only">Music Together</h1>
        <Logo size={56} />
      </header>
      <div className="flex rounded-full border border-gold text-sm">
        <button type="button" onClick={() => setMode("login")} className={`flex-1 rounded-full px-4 py-2 ${mode === "login" ? "bg-burgundy text-cream" : "text-burgundy"}`}>Đăng nhập</button>
        <button type="button" onClick={() => setMode("register")} className={`flex-1 rounded-full px-4 py-2 ${mode === "register" ? "bg-burgundy text-cream" : "text-burgundy"}`}>Đăng ký</button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập (username)" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p role="alert" className="text-sm text-burgundy-accent">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">
          {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Đăng ký"}
        </button>
      </form>
    </main>
  );
}
