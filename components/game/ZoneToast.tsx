"use client";

import { useEffect, useState } from "react";
import { zoneName } from "@/lib/game/world/minimap";
import type { ZoneId } from "@/lib/game/world/zones";
import { CITY_PLACES } from "@/lib/game/maps/city";

// P2 world mode: entering a district shows its name — a banner that slides in at the top and fades out (no layout shift,
// nothing to click). The first zone (arriving) shows too.

const SHOW_MS = 2200;

export default function ZoneToast({ zone }: { zone: ZoneId | null }) {
  const [shown, setShown] = useState<{ zone: ZoneId; seq: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const [last, setLast] = useState<ZoneId | null>(null);
  if (zone !== last) {                                                         // adjusted during render, not in an effect
    setLast(zone);
    if (zone) { setShown((s) => ({ zone, seq: (s?.seq ?? 0) + 1 })); setVisible(true); }
  }
  useEffect(() => {
    if (!shown) return;
    const id = window.setTimeout(() => setVisible(false), SHOW_MS);
    return () => window.clearTimeout(id);
  }, [shown]);
  if (!shown) return null;
  const icon = shown.zone === "wild" ? "🌲" : CITY_PLACES[shown.zone]?.icon ?? "📍";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="zone-toast"
      className={`pch pointer-events-none absolute left-1/2 top-16 z-30 -translate-x-1/2 px-4 py-2 font-vt text-2xl leading-none transition-all duration-500 motion-reduce:transition-none ${visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"}`}
    >
      {icon} {zoneName(shown.zone)}
    </div>
  );
}
