"use client";

import { useTheme } from "@/hooks/useTheme";
import type { ThemeName } from "@/lib/theme";

const OPTIONS: { id: ThemeName; label: string }[] = [
  { id: "salon", label: "🎩 Salon" },
  { id: "cozy", label: "🎮 Pixel" },
];

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <span className="inline-flex overflow-hidden rounded-full border border-gold text-xs">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" onClick={() => setTheme(o.id)}
          className={`px-2.5 py-1 ${theme === o.id ? "bg-burgundy text-cream" : "text-burgundy"}`}
          aria-pressed={theme === o.id}>
          {o.label}
        </button>
      ))}
    </span>
  );
}
