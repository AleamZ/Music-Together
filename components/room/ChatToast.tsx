"use client";

import { useEffect, useRef } from "react";

export interface ChatToastData {
  id: string;
  username: string;
  body: string;
  system: boolean;
}

interface ChatToastProps {
  toast: ChatToastData | null;
  onDismiss: () => void;
  onClick: () => void;
  durationMs?: number;
}

export default function ChatToast({
  toast,
  onDismiss,
  onClick,
  durationMs = 4500,
}: ChatToastProps) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!toast) return;

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }

    timerRef.current = window.setTimeout(() => {
      onDismiss();
    }, durationMs);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [toast, durationMs, onDismiss]);

  if (!toast) return null;

  function handleMouseEnter() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function handleMouseLeave() {
    timerRef.current = window.setTimeout(() => {
      onDismiss();
    }, durationMs);
  }

  return (
    <aside
      role="status"
      aria-live="polite"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onClick}
      className="fixed top-4 left-4 z-50 flex max-w-sm sm:max-w-md items-start gap-3 rounded-xl border-2 border-gold bg-parchment/95 p-3 shadow-2xl backdrop-blur-md transition-all duration-200 hover:shadow-[0_8px_25px_rgba(176,141,87,0.4)] hover:border-gold-200 cursor-pointer group animate-in fade-in slide-in-from-top-4"
    >
      {/* Icon badge */}
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base shadow-xs transition-transform group-hover:scale-110 ${
          toast.system
            ? "border border-amber-400 bg-amber-100 text-amber-800 shadow-amber-300/40"
            : "border border-gold bg-cream text-burgundy shadow-gold-200/40"
        }`}
      >
        <span>{toast.system ? "🔔" : "💬"}</span>
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0 pr-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-playfair text-xs sm:text-sm font-bold text-burgundy truncate">
              {toast.system ? "Hệ thống" : toast.username}
            </span>
            <span className="text-[10px] text-ink/50 shrink-0">vừa xong</span>
          </div>

          {/* Dismiss button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDismiss();
            }}
            className="rounded p-0.5 text-xs text-ink/40 hover:text-burgundy hover:bg-gold-200/30 transition-colors"
            title="Đóng thông báo"
            aria-label="Đóng thông báo"
          >
            ✕
          </button>
        </div>

        {/* Message body preview */}
        <p className="mt-0.5 text-xs text-ink/80 line-clamp-2 break-words font-serif leading-relaxed">
          {toast.body}
        </p>

        {/* Action callout always visible */}
        <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-burgundy-accent/90 transition-colors group-hover:text-burgundy">
          <span>Nhấp để mở khung chat</span>
          <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">→</span>
        </p>
      </div>
    </aside>
  );
}
