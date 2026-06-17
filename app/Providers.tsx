"use client";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import NotifyOnLoad from "@/components/NotifyOnLoad";
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <AuthProvider><NotifyOnLoad />{children}</AuthProvider>
    </ThemeProvider>
  );
}
