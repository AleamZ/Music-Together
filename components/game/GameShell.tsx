"use client";

import type { RoomView } from "@/hooks/useRoom";
import type { PlaybackController } from "@/hooks/usePlayback";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import type { RoomDerived } from "@/lib/room-derived";

export interface GameShellProps {
  view: RoomView;
  derived: RoomDerived;
  playback: PlaybackController;
  sponsorBlock: UseSponsorBlockResult;
  onExitGame: () => void;
}

/** Temporary stub (Task 3) — replaced by the real game shell in Task 16. */
export default function GameShell({ derived, playback, onExitGame }: GameShellProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-playfair text-2xl text-burgundy">🎮 Chế độ game đang được xây dựng…</p>
      <p className="text-sm text-ink/70">Đang phát: {derived.current?.title ?? "—"}</p>
      {!playback.unlocked && (
        <button type="button" onClick={playback.unlock} className="rounded-full bg-burgundy px-4 py-1.5 text-sm text-cream">
          🔈 Bật âm thanh
        </button>
      )}
      <button type="button" onClick={onExitGame} className="rounded-lg border border-gold bg-cream px-4 py-2 text-burgundy">
        🖥️ Giao diện cũ
      </button>
    </main>
  );
}
