"use client";

import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import type { Room, QueueItem } from "@/lib/supabase";
import { addQueueItem } from "@/lib/supabase";
import {
  fetchPlayHistory,
  computeContributorRanking,
  computeTopTracks,
  computeShuffleLuck,
  formatRelativeTime,
  type PlayHistoryItem,
} from "@/lib/room-stats";
import { fetchVideoDetails } from "@/lib/youtube/video";
import { checkQueueRules, ruleMessage, violationFromRpcError, isDuplicateInQueue } from "@/lib/queue-rules";
import { DragonCorners } from "./DragonDecorations";

interface RoomChartModalProps {
  room: Room;
  queue: QueueItem[];
  current: QueueItem | null;
  roomId: string;
  token: string;
  onClose: () => void;
}

export default function RoomChartModal({
  room,
  queue,
  current,
  roomId,
  token,
  onClose,
}: RoomChartModalProps) {
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<"ranking" | "shuffle" | "history">("ranking");
  const [history, setHistory] = useState<PlayHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [readdingId, setReaddingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Mount check for Portal + Body scroll lock
  useEffect(() => {
    setMounted(true);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
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
  }, [roomId]);

  const rankings = useMemo(
    () => computeContributorRanking(history, queue, current),
    [history, queue, current],
  );
  const topTracks = useMemo(() => computeTopTracks(history), [history]);
  const shuffleLuck = useMemo(() => computeShuffleLuck(history), [history]);

  const handleReadd = async (item: PlayHistoryItem) => {
    if (!token) return;
    if (isDuplicateInQueue(queue, current?.youtube_video_id, item.youtube_video_id)) {
      setToast("Bài này đã có trong hàng chờ hoặc đang phát! ⚠️");
      setTimeout(() => setToast(null), 3500);
      return;
    }
    setReaddingId(item.id);
    try {
      // Fetch duration first (required if room has max_duration_seconds rule)
      const details = await fetchVideoDetails(item.youtube_video_id);
      const duration = details?.durationSeconds ?? null;

      // Pre-check rules
      const violation = checkQueueRules(room, {
        title: item.title,
        durationSeconds: duration,
      });
      if (violation) {
        setToast(ruleMessage(violation));
        setTimeout(() => setToast(null), 3500);
        return;
      }

      await addQueueItem(roomId, token, {
        videoId: item.youtube_video_id,
        title: item.title,
        thumb: `https://i.ytimg.com/vi/${item.youtube_video_id}/hqdefault.jpg`,
        duration,
      });
      setToast(`Đã thêm lại "${item.title}" vào hàng chờ! 🎵`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      const v = violationFromRpcError(err, room);
      setToast(v ? ruleMessage(v) : "Không thể thêm lại bài hát (có thể do giới hạn phòng).");
      setTimeout(() => setToast(null), 3500);
    } finally {
      setReaddingId(null);
    }
  };

  const top1 = rankings[0];
  const top2 = rankings[1];
  const top3 = rankings[2];

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/60 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      {/* Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bảng xếp hạng và thống kê âm nhạc"
        className="relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border-2 border-gold bg-cream shadow-2xl animate-in fade-in zoom-in-95 duration-150"
      >
        <DragonCorners size={56} allFour />
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gold-200 bg-cream px-5 py-3.5 rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-200/30 text-xl shadow-xs">
              🏆
            </span>
            <div>
              <h2 className="font-playfair text-lg font-bold text-burgundy sm:text-xl">
                Bảng Vàng Âm Nhạc & Thống Kê
              </h2>
              <p className="text-xs text-ink/60">
                Phòng <span className="font-semibold text-burgundy">{room.name}</span> • Dữ liệu phòng nghe trực tiếp
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="relative z-50 flex h-8 w-8 items-center justify-center rounded-full border border-gold-200 bg-cream text-ink/60 transition hover:border-gold hover:text-burgundy"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Toast alert */}
        {toast && (
          <div className="animate-fade-in mx-5 mt-3 rounded-lg border border-gold bg-gold-200/40 px-3.5 py-2 text-xs font-semibold text-burgundy shadow-xs">
            {toast}
          </div>
        )}

        {/* Top Key Metrics Banner - Solid Vintage Styling */}
        <div className="grid shrink-0 grid-cols-3 gap-2.5 border-b border-gold-200/50 bg-gold-200/10 px-5 py-3 text-center">
          <div className="rounded-xl border border-gold-200/70 bg-cream p-2.5 shadow-2xs">
            <p className="text-[10px] uppercase tracking-wider text-ink/60">Tổng bài đã phát</p>
            <p className="font-playfair text-lg font-bold text-burgundy sm:text-xl">
              {history.length} <span className="text-xs font-normal text-ink/60">bài</span>
            </p>
          </div>
          <div className="rounded-xl border border-gold-200/70 bg-cream p-2.5 shadow-2xs">
            <p className="text-[10px] uppercase tracking-wider text-ink/60">Bá chủ âm nhạc</p>
            <p className="truncate font-playfair text-lg font-bold text-burgundy sm:text-xl" title={top1?.name || "Chưa có"}>
              {top1 ? `${top1.name}` : "—"}
            </p>
          </div>
          <div className="rounded-xl border border-gold-200/70 bg-cream p-2.5 shadow-2xs">
            <p className="text-[10px] uppercase tracking-wider text-ink/60">Chế độ phòng</p>
            <p className="font-playfair text-lg font-bold text-burgundy sm:text-xl">
              {room.play_mode === "shuffle" ? "🎲 Trộn ngẫu nhiên" : "🎵 Theo thứ tự"}
            </p>
          </div>
        </div>

        {/* Segmented Tab Switcher */}
        <div className="flex shrink-0 border-b border-gold-200 bg-cream px-5 pt-2.5 pb-2">
          <div className="flex w-full gap-1 rounded-lg border border-gold-200 bg-cream/80 p-1 text-xs">
            <button
              type="button"
              onClick={() => setTab("ranking")}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                tab === "ranking"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              🏆 Top Đóng Góp
            </button>
            <button
              type="button"
              onClick={() => setTab("shuffle")}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                tab === "shuffle"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              🎲 Vận May Random
            </button>
            <button
              type="button"
              onClick={() => setTab("history")}
              className={`flex-1 rounded-md py-1.5 font-medium transition ${
                tab === "history"
                  ? "bg-burgundy text-cream shadow-xs font-semibold"
                  : "text-ink/70 hover:text-burgundy"
              }`}
            >
              📜 Lịch Sử Phát ({history.length})
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 rounded-b-2xl">
          {loading ? (
            <div className="flex h-48 flex-col items-center justify-center gap-2 text-ink/60">
              <span className="animate-spin text-2xl">⏳</span>
              <p className="text-xs">Đang tải dữ liệu âm nhạc…</p>
            </div>
          ) : history.length === 0 && queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <span className="mb-2 text-4xl">📻</span>
              <p className="font-playfair text-base font-semibold text-burgundy">Chưa có bài hát nào được phát</p>
              <p className="mt-1 text-xs text-ink/60">
                Hãy thêm nhạc và thưởng thức vài bài để hệ thống bắt đầu xếp hạng bảng vàng nhé!
              </p>
            </div>
          ) : (
            <>
              {/* TAB 1: RANKING */}
              {tab === "ranking" && (
                <div className="space-y-5">
                  {/* Top 3 Trio Showcase - Clean solid elegance */}
                  {rankings.length > 0 && (
                    <div className="podium-container rounded-xl border border-gold-200 bg-gold-200/10 p-4 shadow-2xs">
                      <h3 className="mb-3 text-center font-playfair text-sm font-bold tracking-wide text-burgundy uppercase">
                        Bục Vinh Danh Gout Âm Nhạc
                      </h3>
                      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
                        {/* Rank 2 (Silver) */}
                        {top2 ? (
                          <div className="podium-card podium-card-2 flex flex-col items-center justify-center rounded-xl border border-slate-300 bg-cream p-3 text-center shadow-xs">
                            <span className="text-xl">🥈</span>
                            <div className="podium-avatar my-1.5 flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-slate-100 font-serif text-sm font-bold text-slate-800">
                              {top2.name.charAt(0).toUpperCase()}
                            </div>
                            <p className="podium-name max-w-[120px] truncate text-xs font-bold text-ink sm:max-w-[150px]">
                              {top2.name}
                            </p>
                            <span className="podium-stat mt-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                              {top2.playedCount} bài ({top2.percentage}%)
                            </span>
                          </div>
                        ) : (
                          <div className="opacity-0" />
                        )}

                        {/* Rank 1 (Gold - Center) */}
                        {top1 && (
                          <div className="podium-card podium-card-1 relative flex flex-col items-center justify-center rounded-xl border-2 border-gold bg-amber-50/70 p-3 text-center shadow-xs ring-1 ring-gold-200">
                            <span className="text-2xl">👑</span>
                            <div className="podium-avatar my-1.5 flex h-12 w-12 items-center justify-center rounded-full border-2 border-gold bg-amber-200 font-serif text-base font-bold text-burgundy shadow-2xs">
                              {top1.name.charAt(0).toUpperCase()}
                            </div>
                            <p className="podium-name max-w-[130px] truncate text-sm font-bold text-burgundy sm:max-w-[160px]">
                              {top1.name}
                            </p>
                            {top1.badge && (
                              <span className="podium-badge mt-0.5 text-[10px] font-semibold text-burgundy">
                                {top1.badge.icon} {top1.badge.title}
                              </span>
                            )}
                            <span className="podium-stat mt-1 rounded-full bg-gold/25 px-2.5 py-0.5 text-[10px] font-bold text-burgundy">
                              {top1.playedCount} bài ({top1.percentage}%)
                            </span>
                          </div>
                        )}

                        {/* Rank 3 (Bronze) */}
                        {top3 ? (
                          <div className="podium-card podium-card-3 flex flex-col items-center justify-center rounded-xl border border-amber-600/40 bg-cream p-3 text-center shadow-xs">
                            <span className="text-xl">🥉</span>
                            <div className="podium-avatar my-1.5 flex h-10 w-10 items-center justify-center rounded-full border border-amber-600/40 bg-amber-50 font-serif text-sm font-bold text-amber-900">
                              {top3.name.charAt(0).toUpperCase()}
                            </div>
                            <p className="podium-name max-w-[120px] truncate text-xs font-bold text-ink sm:max-w-[150px]">
                              {top3.name}
                            </p>
                            <span className="podium-stat mt-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                              {top3.playedCount} bài ({top3.percentage}%)
                            </span>
                          </div>
                        ) : (
                          <div className="opacity-0" />
                        )}
                      </div>
                    </div>
                  )}

                  {/* Leaderboard Table - Spacious, Clean, No Gradients */}
                  <div className="space-y-2">
                    <h3 className="font-playfair text-sm font-bold text-burgundy">
                      Bảng Chi Tiết Tỷ Lệ Đóng Góp
                    </h3>
                    <div className="overflow-hidden rounded-xl border border-gold-200 bg-cream shadow-xs">
                      <table className="w-full text-left text-xs border-collapse">
                        <thead>
                          <tr className="border-b border-gold-200 bg-gold-200/20 text-ink/70 font-semibold">
                            <th className="py-2.5 px-3 w-14 text-center">HẠNG</th>
                            <th className="py-2.5 px-3">NGƯỜI ĐÓNG GÓP</th>
                            <th className="py-2.5 px-3 hidden sm:table-cell">DANH HIỆU</th>
                            <th className="py-2.5 px-3 w-40">TỶ LỆ</th>
                            <th className="py-2.5 px-3 text-right">ĐÃ PHÁT</th>
                            <th className="py-2.5 px-3 text-right hidden sm:table-cell">CHỜ</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gold-200/40">
                          {rankings.map((curator, idx) => (
                            <tr key={curator.name} className="hover:bg-gold-200/10 transition">
                              <td className="py-2.5 px-3 text-center">
                                <span
                                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full font-bold text-[10px] ${
                                    idx === 0
                                      ? "bg-amber-300 text-burgundy"
                                      : idx === 1
                                      ? "bg-slate-200 text-slate-800"
                                      : idx === 2
                                      ? "bg-amber-600 text-cream"
                                      : "bg-gold-200/40 text-ink"
                                  }`}
                                >
                                  {idx + 1}
                                </span>
                              </td>
                              <td className="py-2.5 px-3 font-semibold text-burgundy">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-gold-200 bg-cream text-[10px] font-bold text-ink">
                                    {curator.name.charAt(0).toUpperCase()}
                                  </span>
                                  <span className="truncate max-w-[140px] sm:max-w-[200px]">{curator.name}</span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 hidden sm:table-cell">
                                {curator.badge ? (
                                  <span className="inline-flex rounded-full bg-gold-200/30 px-2 py-0.5 text-[10px] font-medium text-burgundy">
                                    {curator.badge.icon} {curator.badge.title}
                                  </span>
                                ) : (
                                  <span className="text-ink/40 text-[11px]">—</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="flex items-center gap-2">
                                  <div className="h-2 flex-1 rounded-full bg-gold-200/30 overflow-hidden">
                                    <div
                                      className="h-full rounded-full bg-burgundy transition-all duration-500"
                                      style={{ width: `${Math.max(curator.percentage, 4)}%` }}
                                    />
                                  </div>
                                  <span className="font-bold text-burgundy w-9 text-right shrink-0">
                                    {curator.percentage}%
                                  </span>
                                </div>
                              </td>
                              <td className="py-2.5 px-3 text-right font-medium text-ink">
                                {curator.playedCount} bài
                              </td>
                              <td className="py-2.5 px-3 text-right text-ink/60 hidden sm:table-cell">
                                {curator.queuedCount > 0 ? `+${curator.queuedCount}` : "0"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Top Tracks List */}
                  {topTracks.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <h3 className="font-playfair text-sm font-bold text-burgundy">
                        🔥 Ca Khúc Được Nghe Nhiều Nhất
                      </h3>
                      <div className="divide-y divide-gold-200/40 rounded-xl border border-gold-200 bg-cream">
                        {topTracks.slice(0, 5).map((track, i) => (
                          <div key={track.videoId} className="flex items-center justify-between p-2.5 text-xs hover:bg-gold-200/10 transition">
                            <div className="flex items-center gap-2.5 min-w-0 pr-2">
                              <span className="font-serif font-bold text-gold text-sm w-5 text-center">#{i + 1}</span>
                              <p className="truncate font-medium text-ink" title={track.title}>
                                {track.title}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full border border-gold-200 bg-cream px-2 py-0.5 text-[11px] font-semibold text-burgundy shadow-2xs">
                              {track.playCount} lần phát
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: SHUFFLE LUCK */}
              {tab === "shuffle" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-gold-200 bg-gold-200/15 p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="text-2xl">🎲</span>
                      <div>
                        <h4 className="font-playfair text-sm font-bold text-burgundy">
                          Chỉ Số May Mắn Khi Trộn Bài
                        </h4>
                        <p className="text-xs text-ink/70">
                          Thống kê xem thuật toán Trộn ngẫu nhiên (Shuffle) đã ưu ái phát bài của ai nhiều nhất trong phòng!
                        </p>
                      </div>
                    </div>
                  </div>

                  {shuffleLuck.length === 0 ? (
                    <div className="p-8 text-center text-xs text-ink/60">
                      Chưa có dữ liệu bài hát đã phát để phân tích vận may.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {shuffleLuck.map((item, idx) => (
                        <div
                          key={item.name}
                          className="rounded-xl border border-gold-200 bg-cream p-3 shadow-2xs"
                        >
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center gap-2">
                              <span className="text-base">
                                {idx === 0 ? "🌟" : idx === 1 ? "✨" : "🎵"}
                              </span>
                              <span className="font-semibold text-burgundy">{item.name}</span>
                              {idx === 0 && (
                                <span className="rounded-full bg-amber-100 border border-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                  Tổ độ chọn bài 🎯
                                </span>
                              )}
                            </div>
                            <div className="text-right">
                              <span className="font-bold text-burgundy">{item.percentage}%</span>
                              <span className="ml-1 text-[11px] text-ink/60">
                                ({item.pickedCount} lần được chọn)
                              </span>
                            </div>
                          </div>
                          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gold-200/30">
                            <div
                              className="h-full rounded-full bg-emerald-700 transition-all duration-500"
                              style={{ width: `${Math.max(item.percentage, 5)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl border border-dashed border-gold-200 p-3 text-center text-xs text-ink/60">
                    💡 <span className="font-medium text-burgundy">Mẹo:</span> Hãy thêm đa dạng bài hát vào danh sách chờ và bật chế độ <strong>Trộn (Shuffle)</strong> để xem ai là người đỏ nhất hôm nay!
                  </div>
                </div>
              )}

              {/* TAB 3: PLAY HISTORY */}
              {tab === "history" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-ink/60 pb-1">
                    <span>Các ca khúc vừa lên sóng gần đây</span>
                    <span>Bấm &ldquo;+ Thêm lại&rdquo; để replay</span>
                  </div>

                  {history.length === 0 ? (
                    <div className="p-8 text-center text-xs text-ink/60">
                      Chưa có lịch sử phát nhạc.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {history.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-3 rounded-xl border border-gold-200 bg-cream p-2.5 shadow-2xs transition hover:border-gold"
                        >
                          {/* Thumbnail */}
                          <div className="relative h-11 w-14 shrink-0 overflow-hidden rounded-lg bg-gold-200/40">
                            <Image
                              src={`https://i.ytimg.com/vi/${item.youtube_video_id}/hqdefault.jpg`}
                              alt={item.title}
                              fill
                              sizes="56px"
                              className="object-cover"
                              unoptimized
                            />
                          </div>
                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink text-xs sm:text-sm" title={item.title}>
                              {item.title}
                            </p>
                            <p className="text-[11px] text-ink/60">
                              Người thêm: <span className="font-medium text-burgundy">{item.added_by_name || "Ẩn danh"}</span> • {formatRelativeTime(item.played_at)}
                            </p>
                          </div>
                          {/* Re-add button */}
                          <button
                            type="button"
                            disabled={readdingId === item.id}
                            onClick={() => handleReadd(item)}
                            className="shrink-0 rounded-lg border border-gold bg-cream px-3 py-1.5 text-xs font-semibold text-burgundy shadow-2xs transition hover:bg-gold-200/30 hover:scale-105 active:scale-95 disabled:opacity-50"
                            title="Thêm lại bài này vào hàng chờ"
                          >
                            {readdingId === item.id ? "Đang thêm…" : "+ Thêm lại"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
