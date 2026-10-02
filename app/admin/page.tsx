"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import AuthScreen from "@/components/auth/AuthScreen";
import FeedbackTab from "@/components/admin/FeedbackTab";
import RoomsTab from "@/components/admin/RoomsTab";
import AccountsTab from "@/components/admin/AccountsTab";
import StatsTab from "@/components/admin/StatsTab";
import AnticheatTab from "@/components/admin/AnticheatTab";
import NewsTab from "@/components/admin/NewsTab";
import EconomyTab from "@/components/admin/EconomyTab";
import MailTab from "@/components/admin/MailTab";
import BetaResetTab from "@/components/admin/BetaResetTab";
import Logo from "@/components/brand/Logo";
import BrandSpinner from "@/components/brand/BrandSpinner";

type Tab = "feedback" | "rooms" | "accounts" | "stats" | "economy" | "anticheat" | "news" | "gifts" | "beta";
const TABS: { id: Tab; label: string }[] = [
  { id: "feedback", label: "Hòm thư" }, { id: "rooms", label: "Phòng" },
  { id: "accounts", label: "Tài khoản" }, { id: "stats", label: "Thống kê" }, { id: "economy", label: "Kinh tế" },
  { id: "anticheat", label: "Chống gian lận" }, { id: "news", label: "Bản tin" }, { id: "gifts", label: "Quà & code" },
  { id: "beta", label: "Reset Beta" },
];

export default function AdminPage() {
  const { account, token, loading } = useAuth();
  const [tab, setTab] = useState<Tab>("feedback");

  if (loading) return <BrandSpinner />;
  if (!account) return <AuthScreen />;
  if (!account.isRoot) return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
      <p className="font-playfair text-2xl text-burgundy">Bạn không có quyền truy cập.</p>
      <Link href="/" className="text-burgundy-accent underline">Về trang chủ</Link>
    </main>
  );

  return (
    <main className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex items-center justify-between border-b-2 border-gold pb-3">
        <span className="flex items-center gap-2 font-playfair text-2xl font-bold text-burgundy"><Logo size={28} withWordmark={false} /> Quản trị hệ thống</span>
        <Link href="/" className="text-sm text-burgundy-accent underline">Về trang chủ</Link>
      </header>
      <div className="mb-4 flex gap-1 rounded-full border border-gold p-1 text-sm">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex-1 rounded-full px-3 py-1 ${tab === t.id ? "bg-burgundy text-cream" : "text-burgundy"}`}>{t.label}</button>
        ))}
      </div>
      {token && tab === "feedback" && <FeedbackTab token={token} />}
      {token && tab === "rooms" && <RoomsTab token={token} />}
      {token && tab === "accounts" && <AccountsTab token={token} />}
      {token && tab === "stats" && <StatsTab token={token} />}
      {token && tab === "economy" && <EconomyTab token={token} />}
      {token && tab === "anticheat" && <AnticheatTab token={token} />}
      {token && tab === "news" && <NewsTab token={token} />}
      {token && tab === "gifts" && <MailTab token={token} />}
      {token && tab === "beta" && <BetaResetTab token={token} />}
    </main>
  );
}
