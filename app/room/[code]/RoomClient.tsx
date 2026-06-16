"use client";

import { useState } from "react";
import Link from "next/link";
import { useRoom } from "@/hooks/useRoom";
import { clearIdentity } from "@/lib/identity";
import JoinGate from "@/components/room/JoinGate";
import RoomShell from "@/components/room/RoomShell";

export default function RoomClient({ code }: { code: string }) {
  const [joinNonce, setJoinNonce] = useState(0);
  const view = useRoom(code);

  if (view.loading) {
    return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải phòng…</main>;
  }
  if (!view.state.room) {
    return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Không tìm thấy phòng &ldquo;{code}&rdquo;.</main>;
  }
  if (view.kicked) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-playfair text-2xl text-burgundy">Bạn đã bị mời khỏi phòng.</p>
        <Link href="/" onClick={() => clearIdentity(code)} className="text-burgundy-accent underline">Về trang chủ</Link>
      </main>
    );
  }
  if (!view.identity) {
    return <JoinGate code={code} onJoined={() => setJoinNonce((n) => n + 1)} key={joinNonce} />;
  }
  return <RoomShell code={code} view={view} />;
}
