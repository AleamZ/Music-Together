"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createRoom, joinRoom } from "@/lib/supabase";
import { saveIdentity } from "@/lib/identity";

type Mode = "create" | "join";

export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("create");
  const [name, setName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (mode === "create") {
        const r = await createRoom(roomName.trim() || "Phòng nghe nhạc", password, name.trim());
        saveIdentity({ code: r.code, roomId: r.room_id, memberId: r.member_id, token: r.token });
        router.push(`/room/${r.code}`);
      } else {
        const c = code.trim();
        const r = await joinRoom(c, name.trim(), password);
        saveIdentity({ code: c, roomId: r.room_id, memberId: r.member_id, token: r.token });
        router.push(`/room/${c}`);
      }
    } catch (err) {
      const msg = (err as { message?: string }).message ?? "Có lỗi xảy ra";
      setError(msg.includes("invalid password") ? "Sai mật khẩu phòng." :
               msg.includes("room not found") ? "Không tìm thấy phòng." : msg);
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <header className="text-center">
        <div className="text-5xl">🎩🎶</div>
        <h1 className="font-playfair text-3xl font-bold text-burgundy">Music Together</h1>
        <p className="font-cormorant text-lg text-ink/80">Phòng nghe nhạc cổ điển</p>
      </header>

      <div className="flex rounded-full border border-gold text-sm">
        <button onClick={() => setMode("create")}
          className={`flex-1 rounded-full px-4 py-2 ${mode === "create" ? "bg-burgundy text-cream" : "text-burgundy"}`}>
          Tạo phòng
        </button>
        <button onClick={() => setMode("join")}
          className={`flex-1 rounded-full px-4 py-2 ${mode === "join" ? "bg-burgundy text-cream" : "text-burgundy"}`}>
          Vào phòng
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên của bạn"
          className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {mode === "create" ? (
          <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Tên phòng (tùy chọn)"
            className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        ) : (
          <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="Mã phòng (vd salon-xxxxxx)"
            className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        )}
        <input required type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Mật khẩu phòng"
          className="rounded-lg border border-gold bg-cream px-3 py-2 text-ink" />
        {error && <p className="text-sm text-burgundy-accent">{error}</p>}
        <button disabled={busy} type="submit"
          className="rounded-lg bg-burgundy px-4 py-2 font-cormorant text-lg font-bold text-cream disabled:opacity-60">
          {busy ? "Đang xử lý…" : mode === "create" ? "Tạo phòng" : "Vào phòng"}
        </button>
      </form>
    </main>
  );
}
