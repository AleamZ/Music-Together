"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { usePublicHalls } from "@/hooks/usePublicHalls";
import { createRoom } from "@/lib/supabase";
import FeedbackButton from "@/components/feedback/FeedbackButton";
import Logo from "@/components/brand/Logo";
import ThemeToggle from "@/components/brand/ThemeToggle";

export default function Lobby() {
  const { account, token, logout } = useAuth();
  const { halls, loading, error: hallsError } = usePublicHalls();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Rooms are no longer created at will (0093): only root keeps the form — the path the paid private rooms will use.
  async function doCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const r = await createRoom(roomName.trim() || "Phòng riêng", password, token!);
      router.push(`/room/${r.code}`);
    } catch (err) { setError((err as { message?: string }).message ?? "Không tạo được phòng"); }
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between border-b-2 border-gold pb-3">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <FeedbackButton />
          {account?.isRoot && <Link href="/admin" className="rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy">⚙️ Quản trị</Link>}
          <span className="flex items-center gap-2 rounded-full border border-gold bg-cream px-3 py-1 text-sm">
            👤 <b>{account?.username}</b> · <button onClick={() => logout()} className="text-burgundy-accent">Đăng xuất</button>
          </span>
        </div>
      </header>

      <h2 className="mb-2 font-cormorant text-xl text-burgundy">Sảnh chung</h2>
      {loading ? <p className="text-ink/60">Đang tải…</p>
        : hallsError || halls.length === 0 ? <p className="text-ink/60">Chưa tải được danh sách sảnh. Hãy thử lại sau.</p>
        : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {halls.map((h) => (
              <div key={h.id} data-testid="hall-card" className="flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream p-3 shadow">
                <div className="font-cormorant text-lg font-bold text-burgundy">{h.name}</div>
                <div className="text-sm text-ink">{h.is_playing ? "🎵 Đang phát nhạc" : "⏸ Tạm dừng"}</div>
                <div className="mt-auto flex items-center justify-between">
                  <span className="text-xs text-gold">👥 {h.online} đang ở đây</span>
                  <button onClick={() => router.push(`/room/${h.code}`)} className="rounded-lg bg-burgundy px-3 py-1 font-cormorant font-bold text-cream">Vào ▸</button>
                </div>
              </div>
            ))}
          </div>
        )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <button disabled title="Sắp ra mắt" className="cursor-not-allowed rounded-lg border border-gold bg-cream px-4 py-2 font-cormorant font-bold text-burgundy opacity-60">
          ＋ Tạo phòng riêng — sắp ra mắt
        </button>
        {account?.isRoot && (
          <button onClick={() => setCreating((v) => !v)} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream">⚙️ Tạo phòng (quản trị)</button>
        )}
      </div>

      {account?.isRoot && creating && (
        <form onSubmit={doCreate} className="mt-3 flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream/60 p-3">
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Tên phòng (tùy chọn)" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu phòng" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
          {error && <p className="text-sm text-burgundy-accent">{error}</p>}
          <button className="rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream">Tạo & vào phòng</button>
        </form>
      )}
    </main>
  );
}
