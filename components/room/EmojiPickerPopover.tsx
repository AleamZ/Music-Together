"use client";

import { useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { EmojiClickData } from "emoji-picker-react";

// Lazy-load EmojiPicker to keep initial page bundle ultra-light & SSR-safe
const EmojiPicker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-80 w-72 items-center justify-center text-xs text-ink/60 bg-cream">
      Đang tải emoji…
    </div>
  ),
});

const QUICK_EMOJIS = ["❤️", "🔥", "🎵", "👏", "🤣", "🎉", "👍", "✨", "☕", "🌸"];

interface EmojiPickerPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectEmoji: (emoji: string) => void;
}

export default function EmojiPickerPopover({
  isOpen,
  onClose,
  onSelectEmoji,
}: EmojiPickerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  function handleEmojiClick(data: EmojiClickData) {
    onSelectEmoji(data.emoji);
  }

  return (
    <div
      ref={popoverRef}
      className="absolute bottom-full right-0 z-50 mb-2 flex flex-col overflow-hidden rounded-xl border border-gold-200 bg-cream shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      style={{ width: "min(340px, 90vw)" }}
    >
      {/* Quick Emojis Bar */}
      <div className="flex items-center gap-1 border-b border-gold-200/50 bg-parchment/40 px-2 py-1.5 overflow-x-auto">
        <span className="text-[11px] font-semibold text-burgundy/80 shrink-0 mr-1">Nhanh:</span>
        {QUICK_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onSelectEmoji(emoji)}
            className="rounded p-1 text-base leading-none transition-transform hover:scale-125 hover:bg-gold-200/30 active:scale-95"
            title={`Chèn ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Full Picker */}
      <div className="overflow-hidden">
        <EmojiPicker
          onEmojiClick={handleEmojiClick}
          width="100%"
          height={350}
          previewConfig={{ showPreview: false }}
          skinTonesDisabled
          searchPlaceHolder="Tìm biểu cảm…"
          lazyLoadEmojis
        />
      </div>
    </div>
  );
}
