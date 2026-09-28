"use client";

import { useEffect, useState } from "react";
import { OUTDATED_BUTTON, OUTDATED_EVENT, OUTDATED_TEXT, OUTDATED_TITLE } from "@/lib/client-build";

/** Anti-cheat v2 part 3: the server refused this page as older than its minimum build — ask for a reload. */
export default function OutdatedBanner() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const on = () => setShown(true);
    window.addEventListener(OUTDATED_EVENT, on);
    return () => window.removeEventListener(OUTDATED_EVENT, on);
  }, []);
  if (!shown) return null;
  return (
    <div role="alert" className="fixed inset-x-0 top-0 z-[1000] flex justify-center p-3">
      <div className="flex max-w-lg flex-col gap-2 rounded-xl border border-gold-200 bg-cream p-3 text-sm text-ink shadow-lg">
        <p className="font-bold text-burgundy">{`⚠️ ${OUTDATED_TITLE}`}</p>
        <p>{OUTDATED_TEXT}</p>
        <button type="button" onClick={() => window.location.reload()}
          className="self-end rounded border border-gold-200 bg-burgundy px-3 py-1 text-cream">
          {OUTDATED_BUTTON}
        </button>
      </div>
    </div>
  );
}
