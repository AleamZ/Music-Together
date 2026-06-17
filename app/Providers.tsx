"use client";
import { AuthProvider } from "@/hooks/useAuth";
import NotifyOnLoad from "@/components/NotifyOnLoad";
export default function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider><NotifyOnLoad />{children}</AuthProvider>;
}
