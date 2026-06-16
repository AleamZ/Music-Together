"use client";

import { useState } from "react";
import { joinRoom } from "@/lib/supabase";

export default function JoinGate({ code, token, onJoined }: { code: string; token: string; onJoined: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try { await joinRoom(code, password, token); onJoined(); }
    catch (err) {
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("invalid password") ? "Sai mật khẩu phòng." : msg.includes("room not found") ? "Không tìm thấy phòng." : msg);
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-center font-playfair text-2xl font-bold text-burgundy">Vào phòng {code}</h1>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu phòng" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p className="text-sm text-burgundy-accent">{error}</p>}
        <button disabled={busy} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">{busy ? "Đang vào…" : "Vào phòng"}</button>
      </form>
    </main>
  );
}
