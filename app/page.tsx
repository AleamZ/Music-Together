"use client";

import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import AuthScreen from "@/components/auth/AuthScreen";
import Lobby from "@/components/lobby/Lobby";
import BrandSpinner from "@/components/brand/BrandSpinner";

export default function Home() {
  const { account, loading } = useAuth();
  // a mail link that fell back to the Site URL (a redirect not on the project's list) still lands on /auth/callback
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("token_hash") || q.has("code")) window.location.replace(`/auth/callback${window.location.search}`);
  }, []);
  if (loading) return <BrandSpinner />;
  return account ? <Lobby /> : <AuthScreen />;
}
