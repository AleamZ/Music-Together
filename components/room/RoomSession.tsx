"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import type { RoomView } from "@/hooks/useRoom";
import { useViewMode } from "@/hooks/useViewMode";
import { usePlayback } from "@/hooks/usePlayback";
import { useSponsorBlock } from "@/hooks/useSponsorBlock";
import { deriveRoom } from "@/lib/room-derived";
import { touchRoom } from "@/lib/supabase";
import BrandSpinner from "@/components/brand/BrandSpinner";
import GameErrorBoundary from "@/components/game/GameErrorBoundary";
import ExhaustedNotice from "@/components/game/ExhaustedNotice";
import { readExhaustLock, saveExhaustLock } from "@/lib/game/exhaust-lock";
import RoomShell from "./RoomShell";

// Game code is only downloaded by members who switch to game mode.
const GameShell = dynamic(() => import("@/components/game/GameShell"), {
  ssr: false,
  loading: () => <BrandSpinner label="Đang vào thế giới…" />,
});

/** Owns everything that must survive a classic ↔ game switch — above all the hidden YouTube player. */
export default function RoomSession({ view }: { view: RoomView }) {
  const { mode, setMode } = useViewMode();
  const room = view.state.room!;
  const derived = deriveRoom({ room, members: view.state.members, queue: view.state.queue }, view.accountId, view.role, view.onlineIds);
  const sponsorBlock = useSponsorBlock(derived.current?.youtube_video_id);
  const playback = usePlayback({
    room,
    current: derived.current,
    isDj: view.role.isDj,
    queueLen: derived.approved.length,
    roomId: room.id,
    token: view.token,
    sponsorSegments: sponsorBlock.segments,
    sponsorBlockEnabled: sponsorBlock.enabled,
    onSponsorSkipped: sponsorBlock.triggerSkipToast,
  });

  const [exhausted, setExhausted] = useState<number | null>(null);                   // faint ladder: the lock's end
  const { setPresenceMode } = view;
  useEffect(() => { setPresenceMode(mode); }, [mode, setPresenceMode]);
  // "last seen" for the land rules, once per room visit (before migration 0013 the RPC is missing: ignored)
  useEffect(() => { touchRoom(room.id, view.token).catch(() => {}); }, [room.id, view.token]);

  // the faint ladder (0045): after the 5th faint today, game mode is closed until VN midnight — back to the classic view
  const onExhausted = useCallback((untilMs: number) => {
    saveExhaustLock(view.accountId, untilMs);
    setExhausted(untilMs);
    setMode("classic");
  }, [setMode, view.accountId]);
  const enterGame = useCallback(() => {
    const lock = readExhaustLock(view.accountId);
    if (lock !== null) setExhausted(lock);
    else setMode("game");
  }, [setMode, view.accountId]);
  const closeExhausted = useCallback(() => setExhausted(null), []);

  if (mode === "game") {
    return (
      <GameErrorBoundary
        onError={() => {
          window.alert("Chế độ game gặp lỗi — đã quay về giao diện cũ.");
          setMode("classic");
        }}
      >
        <GameShell view={view} derived={derived} playback={playback} sponsorBlock={sponsorBlock} onExitGame={() => setMode("classic")} onExhausted={onExhausted} />
      </GameErrorBoundary>
    );
  }
  return (
    <>
      <RoomShell view={view} derived={derived} playback={playback} sponsorBlock={sponsorBlock} onEnterGame={enterGame} />
      {exhausted !== null && <ExhaustedNotice untilMs={exhausted} onClose={closeExhausted} />}
    </>
  );
}
