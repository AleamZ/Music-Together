"use client";

import { useState } from "react";
import type { RoomView } from "@/hooks/useRoom";
import Header from "./Header";
import MemberList from "./MemberList";
import ChatPanel from "./ChatPanel";
import ChatDrawer from "./ChatDrawer";
import NowPlaying from "./NowPlaying";
import Reactions from "./Reactions";
import AddSong from "./AddSong";
import Queue from "./Queue";
import PendingQueue from "./PendingQueue";
import MyPending from "./MyPending";
import { usePlayback } from "@/hooks/usePlayback";
import { countMyOrders } from "@/lib/queue-rules";

export default function RoomShell({ view }: { view: RoomView }) {
  const { state, role, onlineIds, token, myMemberId, accountId } = view;
  const room = state.room!;
  const current = state.queue.find((q) => q.id === room.current_item_id) ?? null;
  // Pending rows are requests awaiting Admin/DJ approval; only approved rows are the play queue.
  const approved = state.queue.filter((q) => q.status === "approved");
  const pending = state.queue.filter((q) => q.status === "pending");
  const myPending = pending.filter((q) => q.added_by_account_id === accountId);
  const rules = { max_duration_seconds: room.max_duration_seconds, banned_keywords: room.banned_keywords, max_orders_per_member: room.max_orders_per_member };
  const willPend = room.require_approval && !role.canManageQueue;
  // Per-member order limit (v11): rows I have waiting (pending + approved), excluding the one playing. Admin/DJ exempt.
  const orderLimit = { mine: countMyOrders(state.queue, accountId, room.current_item_id), exempt: role.canManageQueue };
  // onlineIds are ACCOUNT ids (presence is keyed by account id); dj_member_id is a MEMBER id,
  // so map it to its account id before checking presence.
  const djAccountId = state.members.find((m) => m.id === room.dj_member_id)?.account_id ?? null;
  const djOnline = !!djAccountId && onlineIds.includes(djAccountId);

  // Playback engine for everyone (DJ-only writes inside). Returns transport handlers + duration/volume/gate.
  const dj = usePlayback({ room, current, isDj: role.isDj, queueLen: approved.length, roomId: room.id, token });

  // Tab state for left column: "chat" | "members" | "split"
  const [leftTab, setLeftTab] = useState<"chat" | "members" | "split">("chat");
  // Drawer state for expanded chat
  const [isChatDrawerOpen, setIsChatDrawerOpen] = useState(false);

  return (
    <main className="mx-auto max-w-6xl p-3">
      <Header room={room} members={state.members} isAdmin={role.isAdmin} isDj={role.isDj} roomId={room.id} token={token} myMemberId={myMemberId} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[26%_1fr_33%] lg:items-start">
        <section className="flex flex-col rounded-xl border border-gold-200 bg-cream/50 p-3 lg:sticky lg:top-3 lg:h-[calc(100vh-90px)] lg:max-h-[850px] min-h-[520px] overflow-hidden">
          {/* Segmented Tab Switcher */}
          <div className="mb-3 flex shrink-0 rounded-lg border border-gold-200 bg-cream/80 p-0.5 text-xs font-medium">
            <button
              type="button"
              onClick={() => setLeftTab("chat")}
              className={`flex-1 rounded-md py-1.5 text-center transition-all ${
                leftTab === "chat"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              💬 Trò chuyện
            </button>
            <button
              type="button"
              onClick={() => setLeftTab("members")}
              className={`flex-1 rounded-md py-1.5 text-center transition-all ${
                leftTab === "members"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              👥 Thành viên ({onlineIds.length})
            </button>
            <button
              type="button"
              onClick={() => setLeftTab("split")}
              className={`rounded-md px-2 py-1.5 text-center transition-all ${
                leftTab === "split"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
              title="Xem cả hai cùng lúc"
            >
              ☷
            </button>
          </div>

          {/* Left Column Content */}
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {leftTab === "members" && (
              <MemberList
                members={state.members}
                room={room}
                onlineIds={onlineIds}
                isAdmin={role.isAdmin}
                token={token}
                myMemberId={myMemberId}
              />
            )}

            {leftTab === "chat" && (
              isChatDrawerOpen ? (
                <div className="flex flex-col items-center justify-center p-6 text-center border border-dashed border-gold-200 rounded-xl bg-cream/30 min-h-[300px]">
                  <span className="text-3xl mb-2">💬</span>
                  <p className="font-playfair text-sm font-semibold text-burgundy">Phòng chat đang mở rộng</p>
                  <p className="text-xs text-ink/60 mt-1">Đang hiển thị ở ngăn kéo bên phải</p>
                  <button
                    type="button"
                    onClick={() => setIsChatDrawerOpen(false)}
                    className="mt-3 rounded-lg border border-gold bg-cream px-3 py-1.5 text-xs text-burgundy hover:bg-gold-200/30 transition-colors"
                  >
                    Thu nhỏ về đây
                  </button>
                </div>
              ) : (
                <ChatPanel
                  roomId={room.id}
                  token={token}
                  accountId={accountId}
                  isAdmin={role.isAdmin}
                  members={state.members}
                  room={room}
                  onExpand={() => setIsChatDrawerOpen(true)}
                />
              )
            )}

            {leftTab === "split" && (
              <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
                <div className="max-h-44 shrink-0 overflow-y-auto pr-1 border-b border-gold-200/50 pb-2">
                  <MemberList
                    members={state.members}
                    room={room}
                    onlineIds={onlineIds}
                    isAdmin={role.isAdmin}
                    token={token}
                    myMemberId={myMemberId}
                  />
                </div>
                <div className="flex-1 min-h-0 flex flex-col overflow-hidden pt-1">
                  {isChatDrawerOpen ? (
                    <div className="flex flex-col items-center justify-center p-4 text-center border border-dashed border-gold-200 rounded-xl bg-cream/30">
                      <p className="text-xs text-ink/60">Phòng chat đang mở rộng ở bên phải</p>
                      <button
                        type="button"
                        onClick={() => setIsChatDrawerOpen(false)}
                        className="mt-2 rounded border border-gold bg-cream px-2 py-1 text-[11px] text-burgundy"
                      >
                        Thu nhỏ
                      </button>
                    </div>
                  ) : (
                    <ChatPanel
                      roomId={room.id}
                      token={token}
                      accountId={accountId}
                      isAdmin={role.isAdmin}
                      members={state.members}
                      room={room}
                      onExpand={() => setIsChatDrawerOpen(true)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <NowPlaying
            room={room} current={current} canControl={role.canControlPlayback}
            durationMs={dj.durationMs} volume={dj.volume} djOnline={djOnline}
            unlocked={dj.unlocked} onUnlock={dj.unlock} playError={dj.playError}
            onPlayPause={dj.togglePlay} onSkip={dj.skip} onSeekMs={dj.seekMs} onVolume={dj.setVolume}
          />
          <Reactions roomId={room.id} />
        </section>

        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <AddSong roomId={room.id} token={token} rules={rules} willPend={willPend} orderLimit={orderLimit} />
          <MyPending items={myPending} roomId={room.id} token={token} />
          {role.canManageQueue && (room.require_approval || pending.length > 0) && (
            <PendingQueue pending={pending} roomId={room.id} token={token} />
          )}
          <Queue queue={approved} currentId={room.current_item_id} canManage={role.canManageQueue} roomId={room.id} token={token} />
        </section>
      </div>

      {/* Floating Chat Trigger button */}
      {!isChatDrawerOpen && (
        <button
          type="button"
          onClick={() => setIsChatDrawerOpen(true)}
          className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-full border border-gold bg-burgundy px-4 py-2.5 text-xs font-semibold text-cream shadow-xl transition-all hover:bg-burgundy-accent hover:scale-105 active:scale-95"
          title="Mở rộng phòng trò chuyện"
        >
          <span className="text-sm">💬</span>
          <span>Phòng chat</span>
        </button>
      )}

      {/* Slide-over Full-Featured Chat Drawer */}
      <ChatDrawer
        isOpen={isChatDrawerOpen}
        onClose={() => setIsChatDrawerOpen(false)}
        roomId={room.id}
        token={token}
        accountId={accountId}
        isAdmin={role.isAdmin}
        members={state.members}
        room={room}
      />
    </main>
  );
}
