"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import type { RoomView } from "@/hooks/useRoom";
import { useViewMode } from "@/hooks/useViewMode";
import { usePlayback } from "@/hooks/usePlayback";
import { useSponsorBlock } from "@/hooks/useSponsorBlock";
import { deriveRoom } from "@/lib/room-derived";
import BrandSpinner from "@/components/brand/BrandSpinner";
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

  const { setPresenceMode } = view;
  useEffect(() => { setPresenceMode(mode); }, [mode, setPresenceMode]);

  if (mode === "game") {
    return <GameShell view={view} derived={derived} playback={playback} sponsorBlock={sponsorBlock} onExitGame={() => setMode("classic")} />;
  }
  return <RoomShell view={view} derived={derived} playback={playback} sponsorBlock={sponsorBlock} onEnterGame={() => setMode("game")} />;
}
