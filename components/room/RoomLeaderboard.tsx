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
import { checkQueueRules, ruleMessage, violationFromRpcError } from "@/lib/queue-rules";
import RoomChartModal from "./RoomChartModal";

interface RoomLeaderboardProps {
  room: Room;
  queue: QueueItem[];
  current: QueueItem | null;
  roomId: string;
  token: string;
  onOpenModal?: () => void;
}

export default function RoomLeaderboard({
  room,
  queue,
  current,
  roomId,
  token,
  onOpenModal,
}: RoomLeaderboardProps) {
  const [activeTab, setActiveTab] = useState<"ranking" | "shuffle" | "history">("ranking");
  const [history, setHistory] = useState<PlayHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [readdingId, setReaddingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Fetch play history on mount or whenever current song changes
  useEffect(() => {
    let active = true;
    fetchPlayHistory(roomId)
      .then((data) => {
        if (active) {
          setHistory(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [roomId, current?.id]);

  const rankings = useMemo(
    () => computeContributorRanking(history, queue, current),
    [history, queue, current],
  );
  const shuffleLuck = useMemo(() => computeShuffleLuck(history), [history]);

  const handleReadd = async (item: PlayHistoryItem) => {
    if (!token) return;
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

  // Render Full Expanded Card - flex-1 stretches all the way to bottom edge (bám mép)
  return (
    <section aria-label="Bảng xếp hạng âm nhạc" className="relative flex-1 min-h-0 flex flex-col rounded-xl border border-gold-200 bg-cream/70 p-2 sm:p-2.5 shadow-xs transition w-full min-w-0 max-w-full">
      {/* Header Bar */}
      <div className="mb-1.5 flex shrink-0 flex-wrap items-center justify-between gap-1.5 border-b border-gold-200/50 pb-1.5">
        <div className="flex items-center gap-1.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gold-200/40 text-xs shadow-2xs">
            🏆
          </span>
          <div>
            <div className="flex items-center gap-1">
              <h3 className="font-playfair text-xs sm:text-sm font-bold text-burgundy">
                Bảng Vàng Âm Nhạc
              </h3>
            </div>
            <p className="text-[10px] text-ink/60 leading-none">
              Đã phát <span className="font-semibold text-burgundy">{history.length}</span> bài
              {room.play_mode === "shuffle" ? " • 🎲 Trộn ngẫu nhiên" : " • 🎵 Theo thứ tự"}
            </p>
          </div>
        </div>

        {/* Tab Switcher & Action buttons */}
        <div className="flex items-center gap-1">
          <div className="flex rounded-md border border-gold-200 bg-cream/90 p-0.5 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setActiveTab("ranking")}
              className={`rounded px-2 py-0.5 transition ${
                activeTab === "ranking"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              🏆 Top
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("shuffle")}
              className={`rounded px-2 py-0.5 transition ${
                activeTab === "shuffle"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              🎲 Random
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`rounded px-2 py-0.5 transition ${
                activeTab === "history"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              📜 Vừa Phát
            </button>
          </div>

          <button
            type="button"
            onClick={handleOpenDetailedModal}
            className="flex h-6 w-6 items-center justify-center rounded border border-gold-200 bg-cream text-[11px] text-burgundy hover:bg-gold-200/30 transition shadow-2xs"
            title="Mở toàn màn hình xem chi tiết"
          >
            ⛶
          </button>
          <button
            type="button"
            onClick={() => setIsCollapsed(true)}
            className="flex h-6 w-6 items-center justify-center rounded border border-gold-200 bg-cream text-[11px] text-ink/60 hover:text-burgundy transition shadow-2xs"
            title="Thu gọn bảng xếp hạng"
          >
            —
          </button>
        </div>
      </div>

      {/* Temporary Feedback Message */}
      {feedbackMsg && (
        <div className="animate-fade-in mb-1.5 shrink-0 rounded border border-gold bg-gold-200/30 px-2.5 py-1 text-xs font-medium text-burgundy shadow-2xs">
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
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* TAB 1: RANKING */}
          {activeTab === "ranking" && (
            <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
              {/* Compact Trio Showcase (Top 3) */}
              {rankings.length > 0 && (
                <div className="podium-container shrink-0 flex items-center justify-center gap-1.5 sm:gap-2 rounded-lg border border-gold-200/50 bg-gold-200/10 p-1.5 sm:p-2">
                  {/* Rank 2 (Silver) */}
                  {top2 ? (
                    <div className="podium-card podium-card-2 flex flex-1 min-w-0 items-center gap-1.5 rounded-md border border-slate-300/70 bg-cream/80 px-2 py-1 shadow-2xs">
                      <span className="text-xs sm:text-sm shrink-0">🥈</span>
                      <div className="podium-avatar flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[10px] font-bold text-slate-700">
                        {top2.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="podium-name truncate text-[11px] font-semibold text-ink leading-tight">
                          {top2.name}
                        </p>
                        <p className="podium-stat text-[9px] text-ink/60 leading-tight">
                          {top2.percentage}% ({top2.playedCount} bài)
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 opacity-0" />
                  )}

                  {/* Rank 1 (Gold - Center - Elevated) */}
                  {top1 && (
                    <div className="podium-card podium-card-1 relative flex flex-1 min-w-0 items-center gap-1.5 rounded-md border border-gold bg-amber-50 px-2 py-1 shadow-xs ring-1 ring-gold-200/60">
                      <span className="text-xs sm:text-sm shrink-0">👑</span>
                      <div className="podium-avatar flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-gold bg-amber-200 text-xs font-bold text-burgundy shadow-2xs">
                        {top1.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <span className="podium-rank-tag text-[9px] font-bold text-amber-900">#1</span>
                          <p className="podium-name truncate text-xs font-bold text-burgundy leading-tight">
                            {top1.name}
                          </p>
                        </div>
                        <p className="podium-stat text-[9px] font-bold text-burgundy/90 leading-tight">
                          {top1.percentage}% ({top1.playedCount} bài)
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Rank 3 (Bronze) */}
                  {top3 ? (
                    <div className="podium-card podium-card-3 flex flex-1 min-w-0 items-center gap-1.5 rounded-md border border-amber-600/30 bg-cream/80 px-2 py-1 shadow-2xs">
                      <span className="text-xs sm:text-sm shrink-0">🥉</span>
                      <div className="podium-avatar flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-amber-600/40 bg-amber-50 text-[10px] font-bold text-amber-900">
                        {top3.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="podium-name truncate text-[11px] font-semibold text-ink leading-tight">
                          {top3.name}
                        </p>
                        <p className="podium-stat text-[9px] text-ink/60 leading-tight">
                          {top3.percentage}% ({top3.playedCount} bài)
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 opacity-0" />
                  )}
                </div>
              )}

              {/* Progress Bars Leaderboard List - Fills all remaining height */}
              <div className="flex-1 min-h-0 space-y-1 overflow-y-auto pr-1">
                {rankings.map((curator, idx) => (
                  <div
                    key={curator.name}
                    className="flex flex-col rounded-md border border-gold-200/40 bg-cream/60 px-2 py-1 text-xs shadow-2xs transition hover:border-gold"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-bold text-[9px] ${
                            idx === 0
                              ? "bg-amber-400 text-burgundy"
                              : idx === 1
                              ? "bg-slate-300 text-slate-800"
                              : idx === 2
                              ? "bg-amber-600 text-cream"
                              : "bg-gold-200/40 text-ink"
                          }`}
                        >
                          {idx + 1}
                        </span>
                        <span className="truncate font-semibold text-burgundy text-[11px]">
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
                          ({curator.playedCount} phát
                          {curator.queuedCount > 0 ? ` + ${curator.queuedCount} chờ` : ""})
                        </span>
                      </div>
                    </div>
                    {/* Progress Bar */}
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-gold-200/30">
                      <div
                        className="h-full rounded-full bg-burgundy transition-all duration-500"
                        style={{ width: `${Math.max(curator.percentage, 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* TAB 2: SHUFFLE LUCK */}
          {activeTab === "shuffle" && (
            <div className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-hidden">
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
                <div className="flex-1 min-h-0 space-y-1 overflow-y-auto pr-1">
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
            <div className="flex-1 min-h-0 flex flex-col gap-1 overflow-hidden">
              <div className="shrink-0 flex items-center justify-between text-[10px] text-ink/60 px-0.5 pb-0.5">
                <span>Vừa lên sóng gần đây</span>
                <span>Bấm &ldquo;+ Thêm&rdquo; để replay</span>
              </div>

              {history.length === 0 ? (
                <div className="p-3 text-center text-xs text-ink/60">
                  Chưa có lịch sử bài hát đã phát.
                </div>
              ) : (
                <div className="flex-1 min-h-0 space-y-1 overflow-y-auto pr-1">
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
