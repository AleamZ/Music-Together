"use client";

import { useEffect } from "react";
import ChatPanel from "./ChatPanel";
import type { Member, Room } from "@/lib/supabase";
import type { ChatMessage } from "@/lib/chat";

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  roomId: string;
  token: string;
  accountId: string;
  isAdmin: boolean;
  members: Member[];
  room: Room;
  onUnreadChange?: (unread: number, hasServerNotice: boolean) => void;
  onNewMessageToast?: (msg: ChatMessage) => void;
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
  onUnreadChange,
  onNewMessageToast,
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

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-start transition-opacity duration-300 ${
        isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
      }`}
      aria-hidden={!isOpen}
    >
      {/* Dimmed backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-ink/40 backdrop-blur-xs transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* Drawer content anchored to the LEFT with smooth slide transition */}
      <aside
        className={`relative z-10 flex h-full w-full max-w-md sm:max-w-lg flex-col border-r-2 border-gold bg-parchment p-3.5 sm:p-5 shadow-2xl transition-transform duration-300 ease-out transform ${
          isOpen ? "translate-x-0" : "-translate-x-full"
        }`}
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
          isOpen={isOpen}
          onCloseDrawer={onClose}
          onUnreadChange={onUnreadChange}
          onNewMessageToast={onNewMessageToast}
        />
      </aside>
    </div>
  );
}
