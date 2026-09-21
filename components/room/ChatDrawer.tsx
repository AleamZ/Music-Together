"use client";

import { useEffect } from "react";
import ChatPanel from "./ChatPanel";
import type { Member, Room } from "@/lib/supabase";

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  token: string;
  accountId: string;
  isAdmin: boolean;
  members: Member[];
  room: Room;
}

export default function ChatDrawer({
  isOpen,
  onClose,
  roomId,
  token,
  accountId,
  isAdmin,
  members,
  room,
}: ChatDrawerProps) {
  // Close drawer on Escape key
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Dimmed backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-ink/30 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
      />

      {/* Drawer content */}
      <aside
        className="relative z-10 flex h-full w-full max-w-md flex-col border-l border-gold bg-parchment p-4 shadow-2xl animate-in slide-in-from-right duration-250 sm:p-5"
        role="dialog"
        aria-label="Phòng trò chuyện"
      >
        <ChatPanel
          roomId={roomId}
          token={token}
          accountId={accountId}
          isAdmin={isAdmin}
          members={members}
          room={room}
          isDrawer={true}
          onCloseDrawer={onClose}
        />
      </aside>
    </div>
  );
}
