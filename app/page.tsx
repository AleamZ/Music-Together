"use client";

import { useAuth } from "@/hooks/useAuth";
import AuthScreen from "@/components/auth/AuthScreen";
import Lobby from "@/components/lobby/Lobby";

export default function Home() {
  const { account, loading } = useAuth();
  if (loading) return <main className="flex min-h-screen items-center justify-center font-cormorant text-burgundy">Đang tải…</main>;
  return account ? <Lobby /> : <AuthScreen />;
}
