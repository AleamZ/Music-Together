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
}) {
  const [open, setOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);

  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b-2 border-gold pb-3">
      <div className="flex items-center gap-3">
        <Logo size={28} withWordmark={false} />
        <span className="font-playfair text-2xl font-bold text-burgundy">{room.name}</span>
        <ShareButtons code={room.code} title={room.name} />
      </div>
      <div className="flex items-center gap-2">
        {onEnterGame && (
          <button
            type="button"
            onClick={onEnterGame}
            className="flex items-center gap-1.5 rounded-lg border border-gold bg-cream px-3 py-1 text-sm font-medium text-burgundy shadow-xs transition hover:bg-gold-200/30 active:scale-95"
            title="Chuyển sang chế độ game 2D"
          >
            <span>🎮</span>
            <span>Chế độ game</span>
          </button>
        )}
        <ThemeToggle />
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
