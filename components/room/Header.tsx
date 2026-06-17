"use client";

import { useState } from "react";
import { setPlayMode, type Member, type Room } from "@/lib/supabase";
import SettingsDialog from "./SettingsDialog";
import ShareButtons from "./ShareButtons";
import FeedbackButton from "@/components/feedback/FeedbackButton";
import Logo from "@/components/brand/Logo";
import ThemeToggle from "@/components/brand/ThemeToggle";

export default function Header({ room, members, isAdmin, roomId, token, myMemberId }: {
  room: Room; members: Member[]; isAdmin: boolean; roomId: string; token: string; myMemberId: string | null;
}) {
  const [open, setOpen] = useState(false);

  return (
    <header className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b-2 border-gold pb-3">
      <div className="flex items-center gap-3">
        <Logo size={28} withWordmark={false} />
        <span className="font-playfair text-2xl font-bold text-burgundy">{room.name}</span>
        <ShareButtons code={room.code} title={room.name} />
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <div className="inline-flex overflow-hidden rounded-full border border-gold text-xs">
          {(["order", "shuffle"] as const).map((mode) => (
            <button key={mode} disabled={!isAdmin || room.play_mode === mode}
              onClick={() => setPlayMode(roomId, token, mode)}
              className={`px-3 py-1 ${room.play_mode === mode ? "bg-burgundy text-cream" : "text-burgundy"} ${!isAdmin ? "opacity-60" : ""}`}>
              {mode === "order" ? "Thứ tự" : "Trộn"}
            </button>
          ))}
        </div>
        {isAdmin && (
          <button onClick={() => setOpen(true)} className="rounded-lg border border-gold bg-cream px-3 py-1 text-sm text-burgundy">⚙️ Setting</button>
        )}
        <FeedbackButton />
      </div>
      {open && <SettingsDialog room={room} members={members} roomId={roomId} token={token} myMemberId={myMemberId} onClose={() => setOpen(false)} />}
    </header>
  );
}
