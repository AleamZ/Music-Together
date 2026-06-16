"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRooms } from "@/hooks/useActiveRooms";
import { createRoom } from "@/lib/supabase";
import RoomCard from "./RoomCard";
import FeedbackButton from "@/components/feedback/FeedbackButton";

export default function Lobby() {
  const { account, token, logout } = useAuth();
  const { rooms, loading } = useActiveRooms();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function doCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      const r = await createRoom(roomName.trim() || "Phòng nghe nhạc", password, token!);
      router.push(`/room/${r.code}`);
    } catch (err) { setError((err as { message?: string }).message ?? "Không tạo được phòng"); }
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center justify-between border-b-2 border-gold pb-3">
        <span className="font-playfair text-2xl font-bold text-burgundy">🎩 Music Together</span>
        <div className="flex items-center gap-2">
          <FeedbackButton />
          {account?.isRoot && <Link href="/admin" className="rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy">⚙️ Quản trị</Link>}
          <span className="flex items-center gap-2 rounded-full border border-gold bg-cream px-3 py-1 text-sm">
            👤 <b>{account?.username}</b> · <button onClick={() => logout()} className="text-burgundy-accent">Đăng xuất</button>
          </span>
        </div>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button onClick={() => setCreating((v) => !v)} className="rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream">＋ Tạo phòng</button>
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) router.push(`/room/${code.trim()}`); }} className="ml-auto flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Nhập mã phòng…" className="rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
          <button className="rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-burgundy">Vào bằng mã</button>
        </form>
      </div>

      {creating && (
        <form onSubmit={doCreate} className="mb-5 flex flex-col gap-2 rounded-xl border border-gold-200 bg-cream/60 p-3">
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Tên phòng (tùy chọn)" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
          <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu phòng" className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
          {error && <p className="text-sm text-burgundy-accent">{error}</p>}
          <button className="rounded-lg bg-burgundy px-4 py-2 font-cormorant font-bold text-cream">Tạo & vào phòng</button>
        </form>
      )}

      <h2 className="mb-2 font-cormorant text-xl text-burgundy">Phòng đang mở · {rooms.length}</h2>
      {loading ? <p className="text-ink/60">Đang tải…</p>
        : rooms.length === 0 ? <p className="text-ink/60">Chưa có phòng nào đang mở. Hãy tạo một phòng!</p>
        : <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{rooms.map((r) => <RoomCard key={r.id} room={r} />)}</div>}
    </main>
  );
}
