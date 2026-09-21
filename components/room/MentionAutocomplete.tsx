"use client";

import { useEffect, useRef } from "react";
import type { Member, Room } from "@/lib/supabase";

interface MentionAutocompleteProps {
  query: string;
  members: Member[];
  room?: Room | null;
  onlineIds?: string[];
  selectedIndex: number;
  onSelect: (username: string) => void;
  onClose: () => void;
}

export default function MentionAutocomplete({
  query,
  members,
  room,
  onlineIds = [],
  selectedIndex,
  onSelect,
  onClose,
}: MentionAutocompleteProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onlineSet = new Set(onlineIds);

  // Filter members by query (case-insensitive substring match on username)
  const lowerQuery = query.toLowerCase();
  const filtered = members
    .filter((m) => m.username && m.username.toLowerCase().includes(lowerQuery))
    .slice(0, 6);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full left-2 z-50 mb-1.5 w-64 overflow-hidden rounded-xl border border-gold-200 bg-cream/95 p-1 text-xs shadow-xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100"
    >
      <div className="px-2 py-1 font-semibold text-[10px] uppercase tracking-wider text-burgundy/70 border-b border-gold-200/40">
        Nhắc tên thành viên
      </div>
      <div className="max-h-48 overflow-y-auto py-1">
        {filtered.map((m, idx) => {
          const isSelected = idx === selectedIndex;
          const isOnline = onlineSet.has(m.account_id);
          const isAdmin = room?.admin_member_id === m.id;
          const isDj = room?.dj_member_id === m.id;
          const name = m.username ?? "Unknown";

          return (
            <button
              key={m.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault(); // prevent losing textarea focus
                onSelect(name);
              }}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                isSelected ? "bg-gold-200/50 text-burgundy font-semibold" : "text-ink hover:bg-gold-200/30"
              }`}
            >
              {/* Online status indicator */}
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  isOnline ? "bg-green-vintage ring-2 ring-green-vintage/30" : "bg-gold-200"
                }`}
              />

              {/* Avatar circle with initial */}
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-burgundy/15 text-[10px] font-bold text-burgundy">
                {name.charAt(0).toUpperCase()}
              </span>

              {/* Username */}
              <span className="truncate flex-1 font-medium">{name}</span>

              {/* Roles */}
              {isAdmin && (
                <span className="shrink-0 rounded bg-burgundy px-1.5 py-0.2 text-[9px] text-cream">
                  Admin
                </span>
              )}
              {isDj && (
                <span className="shrink-0 rounded bg-green-vintage px-1.5 py-0.2 text-[9px] text-cream">
                  DJ
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
