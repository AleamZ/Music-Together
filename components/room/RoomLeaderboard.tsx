"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import type { Room, QueueItem } from "@/lib/supabase";
import { addQueueItem } from "@/lib/supabase";
import {
  fetchPlayHistory,
  computeContributorRanking,
  computeShuffleLuck,
  formatRelativeTime,
  type PlayHistoryItem,
} from "@/lib/room-stats";
import { fetchVideoDetails } from "@/lib/youtube/video";
import { checkQueueRules, ruleMessage, violationFromRpcError, isDuplicateInQueue } from "@/lib/queue-rules";
import RoomChartModal from "./RoomChartModal";

interface RoomLeaderboardProps {
  room: Room;
  queue: QueueItem[];
  current: QueueItem | null;
  roomId: string;
  token: string;
  onOpenModal?: () => void;
  history?: PlayHistoryItem[];
}

export default function RoomLeaderboard({
  room,
  queue,
  current,
  roomId,
  token,
  onOpenModal,
  history: propHistory,
}: RoomLeaderboardProps) {
  const [activeTab, setActiveTab] = useState<"ranking" | "shuffle" | "history">("ranking");
  const [internalHistory, setInternalHistory] = useState<PlayHistoryItem[]>([]);
  const [loading, setLoading] = useState(!propHistory);
  const [readdingId, setReaddingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const history = propHistory ?? internalHistory;

  // Fetch play history on mount or whenever current song changes
  useEffect(() => {
    if (propHistory) {
      setLoading(false);
      return;
    }
    let active = true;
    fetchPlayHistory(roomId)
      .then((data) => {
        if (active) {
          setInternalHistory(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roomId, current?.id, propHistory]);

  const rankings = useMemo(
    () => computeContributorRanking(history, queue, current),
    [history, queue, current],
  );
  const shuffleLuck = useMemo(() => computeShuffleLuck(history), [history]);

  const handleReadd = async (item: PlayHistoryItem) => {
    if (!token) return;
    if (isDuplicateInQueue(queue, current?.youtube_video_id, item.youtube_video_id)) {
      setFeedbackMsg("Bài này đã có trong hàng chờ hoặc đang phát! ⚠️");
      setTimeout(() => setFeedbackMsg(null), 3000);
      return;
    }
    setReaddingId(item.id);
    try {
      // 1. Fetch video duration first (required for rooms with max_duration_seconds limit)
      const details = await fetchVideoDetails(item.youtube_video_id);
      const duration = details?.durationSeconds ?? null;

      // 2. Pre-check room rules
      const violation = checkQueueRules(room, {
        title: item.title,
        durationSeconds: duration,
      });
      if (violation) {
        setFeedbackMsg(ruleMessage(violation));
        setTimeout(() => setFeedbackMsg(null), 3500);
        return;
      }

      await addQueueItem(roomId, token, {
        videoId: item.youtube_video_id,
        title: item.title,
        thumb: `https://i.ytimg.com/vi/${item.youtube_video_id}/hqdefault.jpg`,
        duration,
      });
      setFeedbackMsg(`Đã thêm lại "${item.title}"! 🎵`);
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err) {
      const v = violationFromRpcError(err, room);
      setFeedbackMsg(v ? ruleMessage(v) : "Không thể thêm lại (có thể chạm giới hạn phòng).");
      setTimeout(() => setFeedbackMsg(null), 3500);
    } finally {
      setReaddingId(null);
    }
  };

  const top1 = rankings[0];
  const top2 = rankings[1];
  const top3 = rankings[2];
  const topLucky = shuffleLuck[0];

  const handleOpenDetailedModal = () => {
    if (onOpenModal) {
      onOpenModal();
    } else {
      setIsModalOpen(true);
    }
  };

  // Render Collapsed Mini-Ribbon
  if (isCollapsed) {
    return (
      <aside aria-label="Bảng xếp hạng rút gọn" className="shrink-0 flex items-center justify-between gap-2 rounded-xl border border-gold-200 bg-cream/70 px-3 py-2 text-xs shadow-xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gold-200/40 text-xs">
            🏆
          </span>
          <p className="truncate text-ink font-medium">
            <span className="font-bold text-burgundy">#1 {top1 ? top1.name : "Chưa có"}</span>
            {top1 ? ` (${top1.percentage}%)` : ""}
            {top2 ? <span className="text-ink/60"> • #2 {top2.name}</span> : null}
            {topLucky ? (
              <span className="text-amber-800 font-semibold"> • 🎲 Tổ độ: {topLucky.name}</span>
            ) : null}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={handleOpenDetailedModal}
            className="rounded border border-gold/70 bg-cream px-2 py-0.5 text-[11px] font-medium text-burgundy hover:bg-gold-200/30 transition"
            title="Mở chi tiết bảng xếp hạng"
          >
            ⛶ Chi tiết
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="rounded border border-gold-200 bg-cream px-2 py-0.5 text-[11px] text-ink/70 hover:text-burgundy transition"
            title="Mở rộng bảng xếp hạng"
          >
            ▲ Mở rộng
          </button>
        </div>

        {/* Modal Dialog */}
        {isModalOpen && (
          <RoomChartModal
            onClose={() => setIsModalOpen(false)}
            room={room}
            queue={queue}
            current={current}
            roomId={roomId}
            token={token}
          />
        )}
      </aside>
    );
  }

  // Render Full Expanded Card - shrink-0 so it expands naturally and center section can scroll
  return (
    <section aria-label="Bảng xếp hạng âm nhạc" className="relative shrink-0 flex flex-col rounded-xl border border-gold-200 bg-cream/70 p-2 sm:p-2.5 shadow-xs transition w-full min-w-0 max-w-full">
      {/* Header Bar */}
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gold-200/60 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-gold/70 bg-gradient-to-br from-amber-100 to-amber-200 text-sm shadow-2xs">
            🏆
          </div>
          <div className="min-w-0">
            <h3 className="font-playfair text-xs sm:text-sm font-bold text-burgundy truncate">
              Bảng Vàng Âm Nhạc
            </h3>
            <div className="flex items-center gap-1.5 text-[10px] text-ink/60 leading-none mt-0.5">
              <span className="rounded-full bg-gold-200/40 px-1.5 py-0.2 font-medium text-burgundy">
                Đã phát <b>{history.length}</b> bài
              </span>
              <span>•</span>
              <span className="truncate">
                {room.play_mode === "shuffle" ? "🎲 Trộn ngẫu nhiên" : "🎵 Theo thứ tự"}
              </span>
            </div>
          </div>
        </div>

        {/* Tab Switcher & Action buttons */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex rounded-lg border border-gold-200/80 bg-cream/90 p-0.5 text-xs font-medium shadow-2xs">
            <button
              type="button"
              onClick={() => setActiveTab("ranking")}
              className={`rounded-md px-2.5 py-1 text-xs transition-all ${
                activeTab === "ranking"
                  ? "bg-burgundy text-cream shadow-2xs font-semibold"
                  : "text-ink/70 hover:text-burgundy hover:bg-gold-200/30"
              }`}
            >
              🏆 Top
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("shuffle")}
              className={`rounded-md px-2.5 py-1 text-xs transition-all ${
                activeTab === "shuffle"
                  ? "bg-burgundy text-cream shadow-2xs font-semibold"
                  : "text-ink/70 hover:text-burgundy hover:bg-gold-200/30"
              }`}
            >
              🎲 Random
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`rounded-md px-2.5 py-1 text-xs transition-all ${
                activeTab === "history"
                  ? "bg-burgundy text-cream shadow-2xs font-semibold"
                  : "text-ink/70 hover:text-burgundy hover:bg-gold-200/30"
              }`}
            >
              📜 Vừa Phát
            </button>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleOpenDetailedModal}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-gold-200 bg-cream text-xs text-burgundy shadow-2xs transition-all hover:bg-burgundy hover:text-cream hover:border-burgundy active:scale-95"
              title="Mở toàn màn hình xem chi tiết"
              aria-label="Xem chi tiết bảng xếp hạng"
            >
              ⛶
            </button>
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-gold-200 bg-cream text-xs text-ink/60 shadow-2xs transition-all hover:bg-burgundy hover:text-cream hover:border-burgundy active:scale-95"
              title="Thu gọn bảng xếp hạng"
              aria-label="Thu gọn bảng xếp hạng"
            >
              —
            </button>
          </div>
        </div>
      </div>

      {/* Temporary Feedback Message */}
      {feedbackMsg && (
        <div className="animate-fade-in mb-1.5 shrink-0 rounded-lg border border-gold bg-gold-200/40 px-2.5 py-1 text-xs font-medium text-burgundy shadow-2xs">
          {feedbackMsg}
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-xs text-ink/60">
          <span className="animate-spin mr-1.5">⏳</span> Đang nạp số liệu…
        </div>
      ) : history.length === 0 && queue.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center p-4 text-center text-xs text-ink/60">
          <span className="mb-1 text-xl">📻</span>
          <p className="font-playfair font-semibold text-burgundy text-xs">Chưa có bài hát nào</p>
          <p className="mt-0.5 text-[10px]">Thêm bài và phát nhạc để vinh danh bảng vàng nhé!</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {/* TAB 1: RANKING */}
          {activeTab === "ranking" && (
            <div className="flex flex-col gap-2">
              {/* Top 3 Olympic Style Showcase Podium */}
              {rankings.length > 0 && (
                <div className="podium-container shrink-0 pt-1 pb-1">
                  <div
                    className={`items-end ${
                      rankings.length === 1
                        ? "flex justify-center max-w-[260px] mx-auto"
                        : rankings.length === 2
                        ? "grid grid-cols-2 gap-2 sm:gap-3 max-w-[480px] mx-auto"
                        : "grid grid-cols-3 gap-2 sm:gap-3"
                    }`}
                  >
                    {/* Rank 2 (Silver - Left) */}
                    {top2 && (
                      <div className="relative flex flex-col items-center rounded-xl border border-slate-300/80 bg-gradient-to-b from-slate-100/90 via-cream to-slate-50/70 p-2 sm:p-2.5 shadow-2xs hover:shadow-xs transition-all hover:scale-[1.01]">
                        {/* Top Medal Tag */}
                        <div className="flex items-center gap-1 rounded-full bg-slate-200/90 border border-slate-300 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-slate-800 shadow-2xs mb-1.5">
                          <span>🥈</span>
                          <span>#2 Á Quân</span>
                        </div>

                        {/* Avatar */}
                        <div className="relative mb-1">
                          <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border-2 border-slate-300 bg-gradient-to-br from-slate-200 to-slate-400 text-xs sm:text-sm font-bold text-slate-800 shadow-xs ring-1 ring-slate-200">
                            {top2.name.charAt(0).toUpperCase()}
                          </div>
                        </div>

                        {/* Name & Title */}
                        <p className="w-full truncate text-center font-playfair text-xs sm:text-sm font-bold text-ink leading-tight" title={top2.name}>
                          {top2.name}
                        </p>
                        {top2.badge && (
                          <span className="text-[9px] text-slate-600 font-medium truncate max-w-full text-center mt-0.5">
                            {top2.badge.title}
                          </span>
                        )}

                        {/* Stats Pill & Percentage */}
                        <div className="mt-1 flex items-baseline justify-center gap-1 text-[11px] text-ink/70">
                          <span className="font-bold text-slate-800">{top2.playedCount} bài</span>
                          <span className="text-[10px] text-ink/50">({top2.percentage}%)</span>
                        </div>

                        {/* Progress Bar */}
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70">
                          <div
                            className="h-full rounded-full bg-slate-500 transition-all duration-500"
                            style={{ width: `${Math.max(top2.percentage, 8)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Rank 1 (Gold - Center - Elevated Champion) */}
                    {top1 && (
                      <div className="relative -translate-y-1 sm:-translate-y-1.5 z-10 flex flex-col items-center rounded-xl border-2 border-gold bg-gradient-to-b from-amber-100/95 via-cream to-amber-50/90 p-2.5 sm:p-3 shadow-md ring-1 ring-gold/40 hover:shadow-lg transition-all hover:scale-[1.02]">
                        {/* Crown Badge */}
                        <div className="flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 border border-amber-400 px-2 sm:px-2.5 py-0.5 text-[9px] sm:text-[10px] font-extrabold text-white shadow-xs mb-1.5">
                          <span>👑</span>
                          <span>#1 Quán Quân</span>
                        </div>

                        {/* Champion Avatar with Crown Ring */}
                        <div className="relative mb-1">
                          <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-full border-2 border-gold bg-gradient-to-br from-amber-300 via-amber-400 to-amber-600 text-sm sm:text-base font-black text-burgundy shadow-sm ring-2 ring-amber-300/80">
                            {top1.name.charAt(0).toUpperCase()}
                          </div>
                          <span className="absolute -top-1.5 -right-1 text-xs select-none filter drop-shadow">✨</span>
                        </div>

                        {/* Champion Name & Title */}
                        <p className="w-full truncate text-center font-playfair text-xs sm:text-sm font-bold text-burgundy leading-tight" title={top1.name}>
                          {top1.name}
                        </p>
                        {top1.badge && (
                          <span className="text-[9px] text-amber-900 font-medium truncate max-w-full text-center mt-0.5">
                            {top1.badge.title}
                          </span>
                        )}

                        {/* Stats Pill & Percentage */}
                        <div className="mt-1 flex items-baseline justify-center gap-1 text-[11px] font-bold text-burgundy">
                          <span className="text-xs sm:text-sm font-black text-burgundy">{top1.playedCount} bài</span>
                          <span className="text-[10px] text-amber-800">({top1.percentage}%)</span>
                        </div>

                        {/* Progress Bar */}
                        <div className="mt-1.5 h-1.5 sm:h-2 w-full overflow-hidden rounded-full bg-amber-200/60 ring-1 ring-gold/30">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-amber-600 to-burgundy transition-all duration-500"
                            style={{ width: `${Math.max(top1.percentage, 8)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Rank 3 (Bronze - Right) */}
                    {top3 && (
                      <div className="relative flex flex-col items-center rounded-xl border border-amber-600/30 bg-gradient-to-b from-amber-100/50 via-cream to-orange-50/50 p-2 sm:p-2.5 shadow-2xs hover:shadow-xs transition-all hover:scale-[1.01]">
                        {/* Top Medal Tag */}
                        <div className="flex items-center gap-1 rounded-full bg-amber-100/90 border border-amber-400/50 px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-amber-900 shadow-2xs mb-1.5">
                          <span>🥉</span>
                          <span>#3 Hạng Ba</span>
                        </div>

                        {/* Avatar */}
                        <div className="relative mb-1">
                          <div className="flex h-9 w-9 sm:h-10 sm:w-10 items-center justify-center rounded-full border-2 border-amber-600/40 bg-gradient-to-br from-amber-200 to-orange-300 text-xs sm:text-sm font-bold text-amber-900 shadow-xs ring-1 ring-amber-300/60">
                            {top3.name.charAt(0).toUpperCase()}
                          </div>
                        </div>

                        {/* Name & Title */}
                        <p className="w-full truncate text-center font-playfair text-xs sm:text-sm font-bold text-ink leading-tight" title={top3.name}>
                          {top3.name}
                        </p>
                        {top3.badge && (
                          <span className="text-[9px] text-amber-800/80 font-medium truncate max-w-full text-center mt-0.5">
                            {top3.badge.title}
                          </span>
                        )}

                        {/* Stats Pill & Percentage */}
                        <div className="mt-1 flex items-baseline justify-center gap-1 text-[11px] text-ink/70">
                          <span className="font-bold text-amber-950">{top3.playedCount} bài</span>
                          <span className="text-[10px] text-ink/50">({top3.percentage}%)</span>
                        </div>

                        {/* Progress Bar */}
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-200/50">
                          <div
                            className="h-full rounded-full bg-amber-700 transition-all duration-500"
                            style={{ width: `${Math.max(top3.percentage, 8)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Leaderboard List for Subsequent Ranks (Rank 4+) */}
              {rankings.length > 3 && (
                <div className="flex flex-col border-t border-gold-200/40 pt-1.5 mt-0.5">
                  <div className="shrink-0 flex items-center justify-between text-[10px] font-semibold text-ink/50 px-1 mb-1">
                    <span>Thứ hạng tiếp theo</span>
                    <span>Số bài &amp; Tỷ lệ</span>
                  </div>
                  <div className="space-y-1">
                    {rankings.slice(3).map((curator, idx) => {
                      const rank = idx + 4;
                      return (
                        <div
                          key={curator.name}
                          className="flex flex-col rounded-lg border border-gold-200/40 bg-cream/70 px-2.5 py-1 text-xs shadow-2xs transition hover:border-gold hover:bg-cream"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-gold-200/50 font-bold text-[9px] text-ink/70">
                                {rank}
                              </span>
                              <span className="truncate font-semibold text-ink text-[11px]" title={curator.name}>
                                {curator.name}
                              </span>
                              {curator.badge && (
                                <span className="hidden sm:inline-block rounded-full bg-gold-200/30 px-1.5 py-0.2 text-[8px] font-medium text-burgundy shrink-0">
                                  {curator.badge.icon} {curator.badge.title}
                                </span>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="font-bold text-burgundy text-[11px]">
                                {curator.percentage}%
                              </span>
                              <span className="ml-1 text-[9px] text-ink/60">
                                ({curator.playedCount} bài)
                              </span>
                            </div>
                          </div>
                          {/* Progress Bar */}
                          <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gold-200/30">
                            <div
                              className="h-full rounded-full bg-gold-500 transition-all duration-500"
                              style={{ width: `${Math.max(curator.percentage, 4)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SHUFFLE LUCK */}
          {activeTab === "shuffle" && (
            <div className="flex flex-col gap-1.5">
              <div className="shrink-0 flex items-center justify-between rounded-md border border-gold-200/50 bg-gold-200/15 px-2.5 py-1 text-xs">
                <span className="flex items-center gap-1 font-medium text-burgundy text-[11px]">
                  <span>🎲</span> <span>Vận may Random</span>
                </span>
                {topLucky && (
                  <span className="rounded-full bg-amber-100 border border-amber-300 px-1.5 py-0.2 text-[9px] font-bold text-amber-800">
                    🌟 Tổ độ 🎯: {topLucky.name} ({topLucky.percentage}%)
                  </span>
                )}
              </div>

              {shuffleLuck.length === 0 ? (
                <div className="p-3 text-center text-xs text-ink/60">
                  Chưa có dữ liệu bài hát đã phát để tính vận may.
                </div>
              ) : (
                <div className="space-y-1">
                  {shuffleLuck.map((item, idx) => (
                    <div
                      key={item.name}
                      className="flex flex-col rounded-md border border-gold-200/40 bg-cream/60 px-2 py-1 text-xs shadow-2xs"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs">
                            {idx === 0 ? "🌟" : idx === 1 ? "✨" : "🎵"}
                          </span>
                          <span className="truncate font-semibold text-burgundy text-[11px]">
                            {item.name}
                          </span>
                          {idx === 0 && (
                            <span className="rounded-full bg-amber-100 border border-amber-300 px-1 py-0.2 text-[8px] font-bold text-amber-800">
                              Tổ độ 🎯
                            </span>
                          )}
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-bold text-burgundy text-[11px]">
                            {item.percentage}%
                          </span>
                          <span className="ml-1 text-[9px] text-ink/60">
                            ({item.pickedCount} lần)
                          </span>
                        </div>
                      </div>
                      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gold-200/30">
                        <div
                          className="h-full rounded-full bg-emerald-700 transition-all duration-500"
                          style={{ width: `${Math.max(item.percentage, 5)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: PLAY HISTORY */}
          {activeTab === "history" && (
            <div className="flex flex-col gap-1">
              <div className="shrink-0 flex items-center justify-between text-[10px] text-ink/60 px-0.5 pb-0.5">
                <span>Vừa lên sóng gần đây</span>
                <span>Bấm &ldquo;+ Thêm&rdquo; để replay</span>
              </div>

              {history.length === 0 ? (
                <div className="p-3 text-center text-xs text-ink/60">
                  Chưa có lịch sử bài hát đã phát.
                </div>
              ) : (
                <div className="space-y-1">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-1.5 rounded-md border border-gold-200/40 bg-cream/60 p-1.5 text-xs shadow-2xs transition hover:border-gold"
                    >
                      <div className="relative h-7 w-10 shrink-0 overflow-hidden rounded bg-gold-200/40">
                        <Image
                          src={`https://i.ytimg.com/vi/${item.youtube_video_id}/hqdefault.jpg`}
                          alt={item.title}
                          fill
                          sizes="40px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="truncate font-medium text-ink text-[11px] leading-tight"
                          title={item.title}
                        >
                          {item.title}
                        </p>
                        <p className="text-[9px] text-ink/60 leading-tight">
                          {item.added_by_name || "Ẩn danh"} • {formatRelativeTime(item.played_at)}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={readdingId === item.id}
                        onClick={() => handleReadd(item)}
                        className="shrink-0 rounded border border-gold bg-cream px-1.5 py-0.5 text-[10px] font-medium text-burgundy shadow-2xs transition hover:bg-gold-200/30 active:scale-95 disabled:opacity-50"
                        title="Thêm lại bài này vào hàng chờ"
                      >
                        {readdingId === item.id ? "…" : "+ Thêm"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Modal Dialog */}
      {isModalOpen && (
        <RoomChartModal
          onClose={() => setIsModalOpen(false)}
          room={room}
          queue={queue}
          current={current}
          roomId={roomId}
          token={token}
        />
      )}
    </section>
  );
}
