"use client";

import { useAuth } from "@/hooks/useAuth";
import AuthScreen from "@/components/auth/AuthScreen";
import Lobby from "@/components/lobby/Lobby";
import BrandSpinner from "@/components/brand/BrandSpinner";

export default function Home() {
  const { account, loading } = useAuth();
  if (loading) return <BrandSpinner />;
  return account ? <Lobby /> : <AuthScreen />;
}
