"use client";

import { useState } from "react";
import { setPlayMode, type Member, type Room, type QueueItem } from "@/lib/supabase";
import SettingsDialog from "./SettingsDialog";
import RoomChartModal from "./RoomChartModal";
import ShareButtons from "./ShareButtons";
import FeedbackButton from "@/components/feedback/FeedbackButton";
import Logo from "@/components/brand/Logo";
import ThemeToggle from "@/components/brand/ThemeToggle";

export default function Header({
  room,
  members,
  isAdmin,
  isDj,
  roomId,
  token,
  myMemberId,
  queue = [],
  current = null,
  onEnterGame,
  onResetLayout,
  onToggleChat,
  chatUnreadCount = 0,
  chatHasServerNotice = false,
}: {
  room: Room;
  members: Member[];
  isAdmin: boolean;
  isDj: boolean;
  roomId: string;
  token: string;
  myMemberId: string | null;
  queue?: QueueItem[];
  current?: QueueItem | null;
  onEnterGame?: () => void;
  onResetLayout?: () => void;
  onToggleChat?: () => void;
  chatUnreadCount?: number;
  chatHasServerNotice?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);

  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b-2 border-gold pb-3">
      <div className="flex items-center gap-3">
        <Logo size={28} withWordmark={false} />
        <span className="font-playfair text-2xl font-bold text-burgundy">{room.name}</span>
        <ShareButtons code={room.code} title={room.name} />
        {onToggleChat && (
          <button
            type="button"
            onClick={onToggleChat}
            className="relative flex items-center gap-1.5 rounded-lg border border-gold bg-cream px-2.5 py-1 text-xs font-semibold text-burgundy shadow-xs transition hover:bg-gold-200/30 active:scale-95 ml-1"
            title="Mở ngăn kéo trò chuyện bên trái"
            aria-label="Phòng trò chuyện"
          >
            <span>💬</span>
            <span className="hidden sm:inline">Trò chuyện</span>
            {chatUnreadCount > 0 && (
              <span
                className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-xs ${
                  chatHasServerNotice ? "bg-amber-600 ring-2 ring-amber-300 animate-pulse" : "bg-red-600"
                }`}
              >
                {chatHasServerNotice ? "🔔 " : ""}
                {chatUnreadCount > 99 ? "99+" : chatUnreadCount}
              </span>
            )}
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onEnterGame && (
          <button
            type="button"
            onClick={onEnterGame}
            className="flex items-center gap-1.5 rounded-lg border border-gold bg-cream px-3 py-1 text-sm font-medium text-burgundy shadow-xs transition hover:bg-gold-200/30 active:scale-95"
            title="Chuyển sang chế độ game 2D"
            aria-label="Chế độ game"
          >
            <span>🎮</span>
            <span className="hidden sm:inline">Chế độ game</span>
          </button>
        )}
        <ThemeToggle />
        {onResetLayout && (
          <button
            type="button"
            onClick={onResetLayout}
            className="hidden lg:flex items-center gap-1.5 rounded-lg border border-gold bg-cream px-2.5 py-1 text-sm font-medium text-burgundy shadow-xs transition hover:bg-gold-200/30 active:scale-95"
            title="Khôi phục kích thước các khung về tỉ lệ mặc định"
            aria-label="Đặt lại bố cục"
          >
            <span>📐</span>
            <span className="hidden xl:inline">Đặt lại bố cục</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setChartOpen(true)}
          className="flex items-center gap-1.5 rounded-lg border border-gold bg-cream px-3 py-1 text-sm font-medium text-burgundy shadow-xs transition hover:bg-gold-200/30 active:scale-95"
          title="Xem bảng xếp hạng và thống kê âm nhạc"
        >
          <span>🏆</span>
          <span>Bảng xếp hạng</span>
        </button>
        <div className="inline-flex overflow-hidden rounded-full border border-gold text-xs">
          {(["order", "shuffle"] as const).map((mode) => (
            <button
              key={mode}
              disabled={!isAdmin || room.play_mode === mode}
              onClick={() => setPlayMode(roomId, token, mode)}
              className={`px-3 py-1 ${room.play_mode === mode ? "bg-burgundy text-cream" : "text-burgundy"} ${!isAdmin ? "opacity-60" : ""}`}
            >
              {mode === "order" ? "Thứ tự" : "Trộn"}
            </button>
          ))}
        </div>
        {(isAdmin || isDj) && (
          <button
            onClick={() => setOpen(true)}
            className="rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy"
          >
            ⚙️ Setting
          </button>
        )}
        <FeedbackButton />
      </div>
      {open && (
        <SettingsDialog
          room={room}
          members={members}
          roomId={roomId}
          token={token}
          myMemberId={myMemberId}
          isAdmin={isAdmin}
          onClose={() => setOpen(false)}
        />
      )}
      {chartOpen && (
        <RoomChartModal
          room={room}
          queue={queue}
          current={current}
          roomId={roomId}
          token={token}
          onClose={() => setChartOpen(false)}
        />
      )}
    </header>
  );
}
