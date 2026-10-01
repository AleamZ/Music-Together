"use client";

import { useCallback, useEffect, useState } from "react";
import { Group, Panel, useDefaultLayout, useGroupRef } from "react-resizable-panels";
import type { RoomView } from "@/hooks/useRoom";
import Header from "./Header";
import MemberList from "./MemberList";
import ChatPanel from "./ChatPanel";
import ChatDrawer from "./ChatDrawer";
import ChatToast, { type ChatToastData } from "./ChatToast";
import NowPlaying from "./NowPlaying";
import Reactions from "./Reactions";
import RoomLeaderboard from "./RoomLeaderboard";
import AddSong from "./AddSong";
import Queue from "./Queue";
import PendingQueue from "./PendingQueue";
import MyPending from "./MyPending";
import RoomResizeHandle from "./RoomResizeHandle";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { fetchPlayHistory, type PlayHistoryItem } from "@/lib/room-stats";
import { notificationText } from "@/lib/chat-notify";
import type { ChatMessage } from "@/lib/chat";
import type { PlaybackController } from "@/hooks/usePlayback";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import type { RoomDerived } from "@/lib/room-derived";
import { DragonCorners, DragonHeaderBanner } from "./DragonDecorations";
import { CyberpunkCorners, CyberpunkHeaderBanner } from "./CyberpunkDecorations";
import { ITVHeaderBanner } from "./ITVDecorations";
import { LofiHeaderBanner } from "./LofiDecorations";
import { MikuHeaderBanner } from "./MikuDecorations";

const safeLayoutStorage = {
  getItem: (key: string) => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string) => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  },
};

export default function RoomShell({ view, derived, playback: dj, sponsorBlock, onEnterGame }: {
  view: RoomView;
  derived: RoomDerived;
  playback: PlaybackController;
  sponsorBlock: UseSponsorBlockResult;
  onEnterGame: () => void;
}) {
  const { state, role, onlineIds, token, myMemberId, accountId, username } = view;
  const room = state.room!;
  const { current, approved, pending, myPending, rules, willPend, orderLimit, djOnline } = derived;
  const myUsername =
    username || state.members.find((m) => m.account_id === accountId)?.username;

  // Drawer state for expanded left chat
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);
  const [chatUnread, setChatUnread] = useState(0);
  const [hasServerNotice, setHasServerNotice] = useState(false);
  const [activeToast, setActiveToast] = useState<ChatToastData | null>(null);

  const handleUnreadChange = useCallback((unread: number, serverNotice: boolean) => {
    setChatUnread(unread);
    setHasServerNotice(serverNotice);
  }, []);

  const handleNewMessageToast = useCallback((msg: ChatMessage) => {
    setActiveToast({
      id: msg.id,
      username: msg.username,
      body: notificationText(msg),
      system: msg.system === true || !msg.account_id,
    });
  }, []);

  useEffect(() => {
    if (isChatDrawerOpen) {
      setActiveToast(null);
    }
  }, [isChatDrawerOpen]);

  // Recent play history for leaderboard & duplicate prevention
  const [history, setHistory] = useState<PlayHistoryItem[]>([]);

  const isDesktop = useIsDesktop();
  const groupRef = useGroupRef();
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "music-together-room-layout-v2",
    storage: safeLayoutStorage,
  });

  const handleResetLayout = useCallback(() => {
    if (groupRef.current) {
      groupRef.current.setLayout({
        "left-col": 28.5,
        "center-col": 49,
        "right-col": 22.5,
      });
    }
  }, [groupRef]);

  useEffect(() => {
    let active = true;
    fetchPlayHistory(room.id)
      .then((data) => {
        if (active) setHistory(data);
      })
      .catch(() => { });
    return () => {
      active = false;
    };
  }, [room.id, current?.id]);

  const renderLeftSection = () => (
    <section className="relative flex flex-col rounded-xl border border-gold-200 bg-cream/70 p-2.5 sm:p-3 pt-3.5 h-full max-h-full min-h-0 min-w-0 shadow-xs">
      <DragonCorners size={60} />
      <CyberpunkCorners size={36} />

      {/* Left Column Content: Member List */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <MemberList
          members={state.members}
          room={room}
          onlineIds={onlineIds}
          isAdmin={role.isAdmin}
          token={token}
          myMemberId={myMemberId}
        />
      </div>
    </section>
  );

  const renderCenterSection = () => (
    <div
      id="center-scroll-container"
      className="flex flex-col gap-2.5 h-full max-h-full overflow-y-auto pr-1 min-w-0 pb-6"
    >
      <div className="shrink-0">
        <NowPlaying
          room={room}
          current={current}
          canControl={role.canControlPlayback}
          durationMs={dj.durationMs}
          volume={dj.volume}
          djOnline={djOnline}
          unlocked={dj.unlocked}
          onUnlock={dj.unlock}
          playError={dj.playError}
          onPlayPause={dj.togglePlay}
          onSkip={dj.skip}
          onSeekMs={dj.seekMs}
          onVolume={dj.setVolume}
          sponsorSegments={sponsorBlock.segments}
          sponsorBlockEnabled={sponsorBlock.enabled}
          onToggleSponsorBlock={sponsorBlock.toggleEnabled}
          lastSkippedToast={sponsorBlock.lastSkippedToast}
          onClearSkippedToast={sponsorBlock.clearSkipToast}
          token={token}
        >
          <Reactions roomId={room.id} username={myUsername} />
        </NowPlaying>
      </div>

      {/* Leaderboard, Shuffle Luck, & Recent Play History right on the main screen */}
      <div className="shrink-0">
        <RoomLeaderboard
          room={room}
          queue={state.queue}
          current={current}
          roomId={room.id}
          token={token}
          history={history}
        />
      </div>
    </div>
  );

  const renderRightSection = () => (
    <section className="relative flex flex-col rounded-xl border border-gold-200 bg-cream/70 p-2.5 sm:p-3 pt-3.5 h-full max-h-full min-h-0 min-w-0 shadow-xs">
      <DragonCorners size={60} />
      <CyberpunkCorners size={36} />
      <div className="mt-1 sm:mt-1.5 mx-0.5 shrink-0">
        <AddSong
          roomId={room.id}
          token={token}
          rules={rules}
          willPend={willPend}
          orderLimit={orderLimit}
          queue={state.queue}
          currentVideoId={current?.youtube_video_id}
          history={history}
        />
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-y-auto pr-0.5 mt-2">
        <MyPending items={myPending} roomId={room.id} token={token} />
        {role.canManageQueue &&
          (room.require_approval || pending.length > 0) && (
            <PendingQueue
              pending={pending}
              roomId={room.id}
              token={token}
            />
          )}
        <Queue
          queue={approved}
          currentId={room.current_item_id}
          canManage={role.canManageQueue}
          roomId={room.id}
          token={token}
        />
      </div>
    </section>
  );

  return (
    <main className="w-full max-w-[1500px] mx-auto px-3 sm:px-5 lg:px-6 py-1 sm:py-1.5 h-screen max-h-screen flex flex-col overflow-hidden">
      <Header
        room={room}
        members={state.members}
        isAdmin={role.isAdmin}
        isDj={role.isDj}
        roomId={room.id}
        token={token}
        myMemberId={myMemberId}
        queue={state.queue}
        current={current}
        onEnterGame={onEnterGame}
        onResetLayout={handleResetLayout}
        onToggleChat={() => setIsChatDrawerOpen((prev) => !prev)}
        chatUnreadCount={chatUnread}
        chatHasServerNotice={hasServerNotice}
      />
      <DragonHeaderBanner />
      <CyberpunkHeaderBanner />
      <ITVHeaderBanner />
      <LofiHeaderBanner />
      <MikuHeaderBanner />

      {!isDesktop ? (
        <div className="flex flex-col gap-4 sm:gap-5 flex-1 min-h-0 min-w-0 overflow-y-auto pb-6">
          {renderCenterSection()}
          {renderRightSection()}
          {renderLeftSection()}
        </div>
      ) : (
        <Group
          groupRef={groupRef}
          orientation="horizontal"
          id="music-together-room-layout-v2"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
          className="flex-1 min-h-0 min-w-0 items-stretch pb-1"
        >
          <Panel
            id="left-col"
            defaultSize="28.5%"
            minSize="18%"
            maxSize="45%"
            className="h-full flex flex-col min-h-0 min-w-0"
          >
            {renderLeftSection()}
          </Panel>

          <RoomResizeHandle
            id="handle-left-center"
            title="Kéo để chỉnh tỉ lệ giữa Thành viên và Trình phát nhạc"
          />

          <Panel
            id="center-col"
            defaultSize="49%"
            minSize="30%"
            maxSize="68%"
            className="h-full flex flex-col min-h-0 min-w-0"
          >
            {renderCenterSection()}
          </Panel>

          <RoomResizeHandle
            id="handle-center-right"
            title="Kéo để chỉnh tỉ lệ giữa Trình phát nhạc và Danh sách chờ"
          />

          <Panel
            id="right-col"
            defaultSize="22.5%"
            minSize="16%"
            maxSize="40%"
            className="h-full flex flex-col min-h-0 min-w-0"
          >
            {renderRightSection()}
          </Panel>
        </Group>
      )}

      {/* Floating Chat Trigger button at BOTTOM RIGHT */}
      {!isChatDrawerOpen && (
        <button
          type="button"
          onClick={() => setIsChatDrawerOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-gold bg-burgundy px-4 py-2.5 text-xs font-semibold text-cream shadow-2xl transition-all hover:bg-burgundy-accent hover:scale-105 active:scale-95 group"
          title="Mở phòng trò chuyện"
        >
          <span className="text-base group-hover:scale-110 transition-transform">💬</span>
          <span>Phòng chat</span>
          {chatUnread > 0 && (
            <span className="relative flex items-center">
              <span
                className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold text-white shadow-md ${hasServerNotice ? "bg-amber-600 ring-2 ring-amber-300" : "bg-red-600"
                  }`}
              >
                {hasServerNotice ? "🔔 " : ""}
                {chatUnread > 99 ? "99+" : chatUnread}
              </span>
              <span
                className={`absolute -inset-0.5 rounded-full opacity-70 animate-ping pointer-events-none ${hasServerNotice ? "bg-amber-400" : "bg-red-500"
                  }`}
              />
            </span>
          )}
        </button>
      )}

      {/* Top-Left Chat Toast Notification */}
      {!isChatDrawerOpen && activeToast && (
        <ChatToast
          toast={activeToast}
          onDismiss={() => setActiveToast(null)}
          onClick={() => {
            setActiveToast(null);
            setIsChatDrawerOpen(true);
          }}
        />
      )}

      {/* Slide-over Full-Featured Chat Drawer on the LEFT */}
      <ChatDrawer
        isOpen={isChatDrawerOpen}
        onClose={() => setIsChatDrawerOpen(false)}
        roomId={room.id}
        token={token}
        accountId={accountId}
        isAdmin={role.isAdmin}
        members={state.members}
        room={room}
        onUnreadChange={handleUnreadChange}
        onNewMessageToast={handleNewMessageToast}
      />
    </main>
  );
}
