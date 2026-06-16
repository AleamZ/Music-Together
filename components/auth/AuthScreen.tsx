"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";

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
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("already taken") ? "Tên đăng nhập đã tồn tại."
        : msg.includes("invalid username or password") ? "Sai tên đăng nhập hoặc mật khẩu." : msg);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-5 px-6">
      <header className="text-center">
        <div className="text-5xl">🎩🎶</div>
        <h1 className="font-playfair text-3xl font-bold text-burgundy">Music Together</h1>
      </header>
      <div className="flex rounded-full border border-gold text-sm">
        <button type="button" onClick={() => setMode("login")} className={`flex-1 rounded-full px-4 py-2 ${mode === "login" ? "bg-burgundy text-cream" : "text-burgundy"}`}>Đăng nhập</button>
        <button type="button" onClick={() => setMode("register")} className={`flex-1 rounded-full px-4 py-2 ${mode === "register" ? "bg-burgundy text-cream" : "text-burgundy"}`}>Đăng ký</button>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Tên đăng nhập (username)" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p className="text-sm text-burgundy-accent">{error}</p>}
        <button type="submit" disabled={busy} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">
          {busy ? "Đang xử lý…" : mode === "login" ? "Đăng nhập" : "Đăng ký"}
        </button>
      </form>
    </main>
  );
}
