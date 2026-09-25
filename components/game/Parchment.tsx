"use client";

import { useEffect, type ReactNode } from "react";

/** Parchment dialog for the game HUD. Esc and the backdrop close it when `onClose` is given. */
export function ParchmentModal({ title, onClose, children, className = "" }: {
  title: string;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <section className={`pch relative flex max-h-[90vh] w-full max-w-lg flex-col p-3 ${className}`}>
        <header className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-vt text-2xl leading-none text-burgundy">{title}</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="pch-btn" aria-label="Đóng">
              ✕
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </div>
  );
}
