"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import ChatDrawer from "@/components/room/ChatDrawer";
import MemberList from "@/components/room/MemberList";
import RoomChartModal from "@/components/room/RoomChartModal";
import SettingsDialog from "@/components/room/SettingsDialog";
import { useChat } from "@/hooks/useChat";
import { useLooks } from "@/hooks/useLooks";
import { useMyCharacter } from "@/hooks/useMyCharacter";
import type { PlaybackController } from "@/hooks/usePlayback";
import { useReactions } from "@/hooks/useReactions";
import type { RoomView } from "@/hooks/useRoom";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import { formatChatMessageBody, parseChatMessageBody } from "@/lib/chat-helpers";
import { formatClock } from "@/lib/format";
import { DEFAULT_LOOK } from "@/lib/game/character";
import { HALL_SEATING } from "@/lib/game/maps/hall";
import type { Interactable } from "@/lib/game/maps/types";
import { badgesFor, buildRoster, freshChatBubbles, roleAccounts } from "@/lib/game/social";
import type { Look } from "@/lib/game/types";
import type { RoomDerived } from "@/lib/room-derived";
import { getCategoryLabel } from "@/lib/sponsorblock";
import CharacterEditor from "./CharacterEditor";
import GameCanvas, { type GameCanvasHandle } from "./GameCanvas";
import HudChatBar from "./HudChatBar";
import HudNowPlaying from "./HudNowPlaying";
import { ParchmentModal } from "./Parchment";
import QueuePanel from "./QueuePanel";
import SpritePreview from "./SpritePreview";

export interface GameShellProps {
  view: RoomView;
  derived: RoomDerived;
  playback: PlaybackController;
  sponsorBlock: UseSponsorBlockResult;
  onExitGame: () => void;
}

type Panel = "queue" | "board" | "settings" | "members" | "chat" | "wardrobe" | null;

/** Game mode: the hall canvas + parchment HUD. Music, queue, chat and roles are the same as the classic view. */
export default function GameShell({ view, derived, playback, sponsorBlock, onExitGame }: GameShellProps) {
  const { state, role, presence, onlineIds, token, accountId, username, myMemberId } = view;
  const room = state.room!;
  const { members } = state;
  const { admin_member_id, dj_member_id } = room;
  const canvasRef = useRef<GameCanvasHandle | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [prompt, setPrompt] = useState<Interactable | null>(null);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [card, setCard] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const close = useCallback(() => setPanel(null), []);

  // The game has its own parchment look: portals (RoomChartModal renders into <body>) get the palette too, and the app
  // theme is switched off while the shell is mounted — some theme rules use !important and would restyle the game UI.
  // A layout effect runs before the first paint, so no frame is drawn in the app theme.
  useLayoutEffect(() => {
    const html = document.documentElement;
    const theme = html.getAttribute("data-theme");
    html.removeAttribute("data-theme");
    document.body.classList.add("game-ui");
    return () => {
      document.body.classList.remove("game-ui");
      if (theme !== null && !html.hasAttribute("data-theme")) html.setAttribute("data-theme", theme);
    };
  }, []);

  // --- me
  const { look: savedLook, exists, setSaved } = useMyCharacter(accountId);
  const myLook = savedLook ?? DEFAULT_LOOK;
  const roles = roleAccounts({ admin_member_id, dj_member_id }, members);
  const myBadges = badgesFor(accountId, roles, false);
  const myName = username || members.find((m) => m.account_id === accountId)?.username || "Bạn";
  const creating = savedLook !== null && !exists;
  useEffect(() => {
    canvasRef.current?.setLocal({ name: myName, badges: myBadges, look: myLook });
  }, [myName, myBadges, myLook]);

  // --- everyone else (room members only: presence keys and game messages from anyone else are ignored)
  const memberIds = useMemo(() => new Set(members.map((m) => m.account_id)), [members]);
  const { looks, refresh } = useLooks(presence.map((p) => p.accountId).filter((id) => id !== accountId && memberIds.has(id)));
  useEffect(() => {
    canvasRef.current?.setRoster(buildRoster({
      presence, members, room: { admin_member_id, dj_member_id }, localId: accountId, looks, map: HALL_SEATING,
    }));
  }, [presence, members, admin_member_id, dj_member_id, accountId, looks]);

  // --- chat bubbles (this shell owns one useChat; the drawer has its own)
  const { messages, send } = useChat(room.id, token, { accountId, isAdmin: role.isAdmin });
  const shownRef = useRef(new Set<string>());
  useEffect(() => {
    for (const m of freshChatBubbles(messages, shownRef.current, Date.now())) {
      shownRef.current.add(m.id);
      if (m.account_id) canvasRef.current?.showBubble(m.account_id, parseChatMessageBody(m.body).text);
    }
  }, [messages]);

  // --- reactions float from the sender's character
  const { react } = useReactions(room.id, myName, {
    onEvent: (data) => canvasRef.current?.showReaction(data.accountId ?? null, data.emoji),
  });

  // --- input is off while any panel or the create editor is open
  const blocking = panel !== null || creating;
  useEffect(() => {
    canvasRef.current?.setInputEnabled(!blocking);
  }, [blocking]);

  const showToast = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const onInteract = useCallback((it: Interactable) => {
    if (it.kind === "dj_booth") setPanel("queue");
    else if (it.kind === "notice_board") setPanel("board");
    else showToast("Ao câu cá sắp mở — hẹn bản sau!");
  }, [showToast]);

  const onUnsupported = useCallback(() => {
    window.alert("Trình duyệt này không vẽ được thế giới game — quay về giao diện cũ.");
    onExitGame();
  }, [onExitGame]);

  const onSaved = useCallback((look: Look) => {
    setSaved(look);
    setPanel(null);
    canvasRef.current?.announceLook();
  }, [setSaved]);

  const djName = members.find((m) => m.account_id === derived.djAccountId)?.username ?? null;
  const skipped = sponsorBlock.lastSkippedToast;
  const cardMember = card ? members.find((m) => m.account_id === card) : undefined;
  const cardPresence = card ? presence.find((p) => p.accountId === card) : undefined;

  return (
    <div className="game-ui fixed inset-0 overflow-hidden bg-[#2f6e8f] text-ink">
      <GameCanvas
        ref={canvasRef}
        roomId={room.id}
        localId={accountId}
        initial={{ name: myName, badges: myBadges, look: myLook }}
        isMember={(id) => memberIds.has(id)}
        onInteract={onInteract}
        onPromptChange={setPrompt}
        onActorClick={setCard}
        onConnectionChange={setConnected}
        onLookChanged={refresh}
        onUnsupported={onUnsupported}
      />

      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-wrap items-start justify-between gap-2">
        <div className="pch pointer-events-auto flex items-center gap-2 p-1.5 font-vt text-lg leading-none">
          <SpritePreview look={myLook} scale={2} className="rounded-sm bg-parchment" />
          <div className="flex flex-col gap-1">
            <span className="max-w-44 truncate text-xl">{myBadges ? `${myBadges} ` : ""}{myName}</span>
            {!connected && <span className="text-base opacity-80">Đang kết nối thế giới…</span>}
            <button type="button" className="pch-btn self-start" onClick={() => setPanel("wardrobe")} disabled={savedLook === null}>
              👕 Tủ đồ
            </button>
          </div>
        </div>
        <HudNowPlaying
          room={room}
          current={derived.current}
          djName={djName}
          canControl={role.canControlPlayback}
          playback={playback}
          canOpenSettings={role.isAdmin || role.isDj}
          onOpenQueue={() => setPanel("queue")}
          onOpenBoard={() => setPanel("board")}
          onOpenSettings={() => setPanel("settings")}
        />
      </div>

      <div className="pointer-events-none absolute left-1/2 top-1/3 z-20 flex -translate-x-1/2 flex-col items-center gap-2" role="status">
        {toast && <p className="pch px-3 py-1.5 font-vt text-xl">{toast}</p>}
        {skipped && (
          <p className="pch px-3 py-1 font-vt text-lg">
            ⚡ Đã bỏ qua: {getCategoryLabel(skipped.category)} ({formatClock(skipped.start * 1000)} - {formatClock(skipped.end * 1000)})
          </p>
        )}
      </div>

      {card && (
        <div className="pch absolute left-1/2 top-1/4 z-20 flex -translate-x-1/2 items-center gap-2 p-2 font-vt text-lg leading-tight">
          <SpritePreview look={looks.get(card) ?? DEFAULT_LOOK} scale={2} className="rounded-sm bg-parchment" />
          <div className="flex flex-col">
            <span className="text-xl">{cardMember?.username ?? cardPresence?.name ?? "Khách"}</span>
            {card === roles.adminAccountId && <span>👑 Chủ phòng</span>}
            {card === roles.djAccountId && <span>🎧 DJ</span>}
            <span className="opacity-80">{cardPresence?.mode === "classic" ? "🖥️ Đang ở giao diện cũ" : "🎮 Đang dạo quanh sảnh"}</span>
          </div>
          <button type="button" className="pch-btn self-start" onClick={() => setCard(null)} aria-label="Đóng">✕</button>
        </div>
      )}

      {prompt && !blocking && (
        <button
          type="button"
          onClick={() => canvasRef.current?.interact()}
          className="pch-btn pch-btn-primary absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-xl"
        >
          <span className="pointer-coarse:hidden">E · </span>
          {prompt.prompt}
        </button>
      )}

      <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
        <HudChatBar
          onSend={(text) => send(formatChatMessageBody(text))}
          onReact={react}
          onOpenChat={() => setPanel("chat")}
          onOpenMembers={() => setPanel("members")}
          onlineCount={onlineIds.length}
          onExitGame={onExitGame}
        />
      </div>

      {panel === "queue" && <QueuePanel room={room} derived={derived} role={role} token={token} onClose={close} />}
      {panel === "board" && (
        <RoomChartModal room={room} queue={state.queue} current={derived.current} roomId={room.id} token={token} onClose={close} />
      )}
      {panel === "settings" && (
        <SettingsDialog room={room} members={members} roomId={room.id} token={token} myMemberId={myMemberId} isAdmin={role.isAdmin} onClose={close} />
      )}
      {panel === "members" && (
        <ParchmentModal title={`👥 Thành viên (${onlineIds.length})`} onClose={close}>
          <MemberList members={members} room={room} onlineIds={onlineIds} isAdmin={role.isAdmin} token={token} myMemberId={myMemberId} />
        </ParchmentModal>
      )}
      <ChatDrawer
        isOpen={panel === "chat"}
        onClose={close}
        roomId={room.id}
        token={token}
        accountId={accountId}
        isAdmin={role.isAdmin}
        members={members}
        room={room}
      />
      {panel === "wardrobe" && savedLook && (
        <CharacterEditor mode="edit" initial={savedLook} token={token} onSaved={onSaved} onClose={close} onBackToClassic={onExitGame} />
      )}
      {creating && (
        <CharacterEditor mode="create" initial={DEFAULT_LOOK} token={token} onSaved={onSaved} onClose={onExitGame} onBackToClassic={onExitGame} />
      )}
    </div>
  );
}
