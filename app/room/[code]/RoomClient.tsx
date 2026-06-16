"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { useRoom } from "@/hooks/useRoom";
import AuthScreen from "@/components/auth/AuthScreen";
import JoinGate from "@/components/room/JoinGate";
import RoomShell from "@/components/room/RoomShell";

export default function RoomClient({ code }: { code: string }) {
  const { account, loading: authLoading } = useAuth();
  const view = useRoom(code);
  const [, force] = useState(0);

  if (authLoading) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải…</main>;
  if (!account) return <AuthScreen />;
  if (view.loading) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải phòng…</main>;
  if (!view.state.room) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Không tìm thấy phòng &ldquo;{code}&rdquo;.</main>;
  if (view.kicked) return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-playfair text-2xl text-burgundy">Bạn đã bị mời khỏi phòng.</p>
      <Link href="/" className="text-burgundy-accent underline">Về trang chủ</Link>
    </main>
  );
  if (!view.myMemberId) return <JoinGate code={code} token={view.token} onJoined={() => force((n) => n + 1)} />;
  return <RoomShell view={view} />;
}
