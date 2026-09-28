"use client";

import { useEffect, useRef } from "react";
import { loginState } from "@/lib/game/quests/rpc";
import AlbumModal from "./AlbumModal";
import ArenaTeamModal from "./ArenaTeamModal";
import LoginCalendarModal from "./LoginCalendarModal";
import PhotoMode from "./PhotoMode";
import QuestLogModal from "./QuestLogModal";

/** The v21 quests group's panels in GameShell's `panel` slot. */
export type QuestPanel = "quests" | "login_calendar" | "album" | "photo" | "arena_team";
export const QUEST_PANELS: readonly QuestPanel[] = ["quests", "login_calendar", "album", "photo", "arena_team"];
export const isQuestPanel = (p: unknown): p is QuestPanel => QUEST_PANELS.includes(p as QuestPanel);

/** 📜 and 📷 on the HUD's icon row; once per page, the login calendar pops up when today's gift is waiting. */
export function QuestHudButtons({ token, canPopup, onOpen }: {
  token: string; canPopup: boolean; onOpen: (p: QuestPanel) => void;
}) {
  const checked = useRef(false);
  useEffect(() => {
    if (!canPopup || checked.current) return;
    checked.current = true;
    loginState(token).then((s) => { if (!s.claimedToday) onOpen("login_calendar"); }, () => {});
  }, [token, canPopup, onOpen]);
  return (
    <>
      <button type="button" className="pch-btn relative" title="Nhiệm vụ" data-testid="quests-hud" onClick={() => onOpen("quests")}>
        📜<span className="sr-only"> Nhiệm vụ</span>
      </button>
      <button type="button" className="pch-btn relative" title="Chụp ảnh" data-testid="photo-hud" onClick={() => onOpen("photo")}>
        📷<span className="sr-only"> Chụp ảnh</span>
      </button>
    </>
  );
}

export function QuestPanels({ panel, token, mapId, at, onOpen, onCoins, onClose }: {
  panel: unknown;
  token: string;
  mapId: string;
  /** The quest giver's use point when the log was opened at him, else null. */
  at: { x: number; y: number } | null;
  onOpen: (p: QuestPanel) => void;
  onCoins: () => void;
  onClose: () => void;
}) {
  if (!isQuestPanel(panel)) return null;
  switch (panel) {
    case "quests":
      return (
        <QuestLogModal token={token} at={at} onCoins={onCoins} onClose={onClose}
          onOpenLogin={() => onOpen("login_calendar")} onOpenAlbum={() => onOpen("album")} onOpenArena={() => onOpen("arena_team")} />
      );
    case "login_calendar":
      return <LoginCalendarModal token={token} onCoins={onCoins} onClose={onClose} />;
    case "album":
      return <AlbumModal token={token} onClose={onClose} />;
    case "photo":
      return <PhotoMode token={token} mapId={mapId} onClose={onClose} />;
    case "arena_team":
      return <ArenaTeamModal token={token} onCoins={onCoins} onClose={onClose} />;
  }
}
