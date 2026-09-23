"use client";

import { useEffect, useState } from "react";
import type { LyricSearchItem } from "@/app/api/lyrics/search/route";
import type { LyricsData } from "@/hooks/useLyrics";
import { formatClock } from "@/lib/format";
import { cleanYouTubeTitle } from "@/lib/lyrics/clean-title";
import { parseLrc } from "@/lib/lyrics/parse-lrc";
import { useTheme } from "@/hooks/useTheme";

export interface LyricSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTitle?: string | null;
  targetDurationSeconds?: number | null;
  canSyncToRoom?: boolean;
  onSelectLyric: (data: LyricsData, syncToRoom: boolean) => void;
}

export default function LyricSearchModal({
  isOpen,
  onClose,
  defaultTitle = "",
  targetDurationSeconds = 0,
  canSyncToRoom = true,
  onSelectLyric,
}: LyricSearchModalProps) {
  const { theme } = useTheme();

  const [activeTab, setActiveTab] = useState<"search" | "paste">("search");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<LyricSearchItem[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [previewId, setPreviewId] = useState<number | null>(null);

  // Sync to whole room preference
  const [syncToRoom, setSyncToRoom] = useState(true);

  // Manual paste state
  const [customText, setCustomText] = useState("");
  const [customArtist, setCustomArtist] = useState("");
  const [customTrack, setCustomTrack] = useState("");
  const [customPreviewLines, setCustomPreviewLines] = useState<ReturnType<typeof parseLrc>>([]);

  // Prefill search query on open
  useEffect(() => {
    if (isOpen && defaultTitle) {
      const cleaned = cleanYouTubeTitle(defaultTitle);
      const initial = cleaned.cleanQuery || defaultTitle;
      setQuery(initial);
      setCustomTrack(cleaned.trackName || defaultTitle);
      setCustomArtist(cleaned.artistName || "");
      // Auto-trigger first search
      void handleSearch(initial);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultTitle]);

  // ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleSearch = async (searchQuery: string) => {
    const q = searchQuery.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    setHasSearched(true);
    setPreviewId(null);

    try {
      let url = `/api/lyrics/search?q=${encodeURIComponent(q)}`;
      if (targetDurationSeconds && targetDurationSeconds > 0) {
        url += `&duration=${Math.round(targetDurationSeconds)}`;
      }

      const res = await fetch(url);
      if (!res.ok) {
        setError("Không thể tìm kiếm lời bài hát vào lúc này.");
        setResults([]);
        return;
      }

      const data = (await res.json()) as { items?: LyricSearchItem[] };
      setResults(data.items || []);
    } catch {
      setError("Lỗi kết nối khi tìm kiếm.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleApplySearchResult = (item: LyricSearchItem) => {
    onSelectLyric(
      {
        trackName: item.trackName,
        artistName: item.artistName,
        syncedLyrics: item.syncedLyrics,
        plainLyrics: item.plainLyrics,
      },
      syncToRoom
    );
    onClose();
  };

  const handleParseCustomText = (text: string) => {
    setCustomText(text);
    if (!text.trim()) {
      setCustomPreviewLines([]);
      return;
    }
    const parsed = parseLrc(text);
    setCustomPreviewLines(parsed);
  };

  const handleApplyCustomPaste = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customText.trim()) return;

    const hasTimestamp = /\[\d{1,2}:\d{2}/.test(customText);
    onSelectLyric(
      {
        trackName: customTrack.trim() || undefined,
        artistName: customArtist.trim() || undefined,
        syncedLyrics: hasTimestamp ? customText.trim() : undefined,
        plainLyrics: !hasTimestamp ? customText.trim() : undefined,
      },
      syncToRoom
    );
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className="relative flex flex-col w-full max-w-2xl max-h-[85vh] rounded-2xl border border-white/20 bg-[#120d0a] text-cream shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-white/10 shrink-0 bg-white/5">
          <div className="flex items-center gap-2">
            <span className="text-xl">🔍</span>
            <h3 className="font-bold text-base sm:text-lg text-white">Tìm & Chọn Lời Bài Hát</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-white/20 bg-white/10 hover:bg-white/20 text-white font-bold flex items-center justify-center transition-all cursor-pointer"
            title="Đóng (ESC)"
          >
            ✕
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center border-b border-white/10 px-4 sm:px-6 py-2 shrink-0 bg-black/40 gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("search")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "search"
                ? "bg-gold text-burgundy shadow-sm"
                : "text-white/60 hover:text-white"
            }`}
          >
            🔍 Thư viện LRCLIB
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("paste")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              activeTab === "paste"
                ? "bg-gold text-burgundy shadow-sm"
                : "text-white/60 hover:text-white"
            }`}
          >
            📋 Tự dán lời thủ công (.LRC)
          </button>
        </div>

        {/* Tab 1: LRCLIB Search */}
        {activeTab === "search" && (
          <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6 overflow-hidden">
            {/* Search Input Box */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSearch(query);
              }}
              className="flex items-center gap-2 mb-3 shrink-0"
            >
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Nhập tên bài hát hoặc ca sĩ chính xác..."
                className="flex-1 rounded-xl border border-white/20 bg-black/60 px-3.5 py-2 text-sm text-white placeholder-white/40 focus:border-gold focus:outline-none"
                autoFocus
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="rounded-xl bg-burgundy px-4 py-2 text-xs sm:text-sm font-semibold text-cream hover:bg-burgundy-accent transition-all cursor-pointer disabled:opacity-50"
              >
                {loading ? "Đang tìm..." : "Tìm kiếm"}
              </button>
            </form>

            {/* Target Duration Hint */}
            {targetDurationSeconds && targetDurationSeconds > 0 && (
              <div className="text-[11px] text-white/50 mb-3 shrink-0 flex items-center gap-1.5">
                <span>⏱ Thời lượng video YouTube:</span>
                <span className="font-mono text-gold font-bold">
                  {formatClock(targetDurationSeconds * 1000)}
                </span>
                <span>(kết quả có thời lượng tương đương sẽ được ưu tiên)</span>
              </div>
            )}

            {/* Results List */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-2 min-h-0">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-white/60">
                  <span className="text-2xl animate-spin">⏳</span>
                  <span className="text-xs">Đang tìm các bản lời phù hợp trên LRCLIB...</span>
                </div>
              )}

              {!loading && error && (
                <div className="py-10 text-center text-xs text-red-300">
                  <p>{error}</p>
                </div>
              )}

              {!loading && !error && hasSearched && results.length === 0 && (
                <div className="py-12 text-center text-white/60 text-xs">
                  <p className="mb-2">Không tìm thấy bản lời nào khớp với từ khoá này.</p>
                  <p className="text-[11px] text-white/40">
                    Bạn hãy thử gõ chỉ tên bài hát (hoặc chuyển sang tab &quot;Tự dán lời thủ công&quot;).
                  </p>
                </div>
              )}

              {!loading &&
                !error &&
                results.map((item) => {
                  const isPreview = previewId === item.id;
                  const delta = item.durationDelta;
                  const previewLines = item.syncedLyrics ? parseLrc(item.syncedLyrics).slice(0, 8) : [];

                  return (
                    <div
                      key={item.id}
                      className="rounded-xl border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition-colors flex flex-col gap-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-white truncate">
                              {item.trackName}
                            </span>
                            {item.hasSynced ? (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                                🎤 Lời chạy đồng bộ (LRC)
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/10 text-white/60">
                                📄 Lời văn bản
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-white/70 truncate mt-0.5">
                            {item.artistName} {item.albumName ? `• ${item.albumName}` : ""}
                          </p>
                          {item.duration && (
                            <div className="flex items-center gap-2 text-[11px] mt-1 font-mono">
                              <span className="text-white/50">
                                {formatClock(item.duration * 1000)}
                              </span>
                              {typeof delta === "number" && (
                                <span
                                  className={
                                    Math.abs(delta) <= 3
                                      ? "text-emerald-400 font-bold"
                                      : "text-amber-400"
                                  }
                                >
                                  {delta === 0 ? "✓ Khớp chuẩn video" : `(${delta > 0 ? "+" : ""}${delta}s)`}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {item.syncedLyrics && (
                            <button
                              type="button"
                              onClick={() => setPreviewId(isPreview ? null : item.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-white/20 bg-white/5 hover:bg-white/15 text-[11px] text-white/80 transition-colors cursor-pointer"
                            >
                              {isPreview ? "Đóng xem" : "👁 Xem trước"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleApplySearchResult(item)}
                            className="px-3 py-1.5 rounded-lg bg-burgundy hover:bg-burgundy-accent text-xs font-bold text-cream transition-all cursor-pointer shadow-xs"
                          >
                            Áp dụng
                          </button>
                        </div>
                      </div>

                      {/* Preview Drawer */}
                      {isPreview && (
                        <div className="mt-1 rounded-lg border border-white/10 bg-black/60 p-2.5 text-xs font-mono space-y-1 max-h-36 overflow-y-auto">
                          <p className="text-[10px] text-white/40 pb-1 border-b border-white/10">
                            Xem trước 8 câu hát đầu:
                          </p>
                          {previewLines.map((line, lIdx) => (
                            <div key={lIdx} className="flex items-start gap-2 text-white/80">
                              <span className="text-[10px] text-gold shrink-0">
                                {formatClock(line.timeMs)}
                              </span>
                              <span className="truncate">{line.text || "♪ ♪ ♪"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Tab 2: Manual Paste LRC */}
        {activeTab === "paste" && (
          <form
            onSubmit={handleApplyCustomPaste}
            className="flex-1 min-h-0 flex flex-col p-4 sm:p-6 overflow-hidden gap-3"
          >
            <div className="grid grid-cols-2 gap-2 shrink-0">
              <input
                type="text"
                placeholder="Tên bài hát (tùy chọn)..."
                value={customTrack}
                onChange={(e) => setCustomTrack(e.target.value)}
                className="rounded-xl border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white placeholder-white/40 focus:border-gold focus:outline-none"
              />
              <input
                type="text"
                placeholder="Ca sĩ (tùy chọn)..."
                value={customArtist}
                onChange={(e) => setCustomArtist(e.target.value)}
                className="rounded-xl border border-white/20 bg-black/60 px-3 py-1.5 text-xs text-white placeholder-white/40 focus:border-gold focus:outline-none"
              />
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <label className="text-[11px] text-white/60 mb-1 flex items-center justify-between">
                <span>Dán nội dung LRC hoặc lời bài hát:</span>
                <span className="text-[10px] text-gold">Hỗ trợ timestamp [mm:ss.xx]</span>
              </label>
              <textarea
                value={customText}
                onChange={(e) => handleParseCustomText(e.target.value)}
                placeholder="Ví dụ:&#10;[00:12.50] Câu hát đầu tiên&#10;[00:18.20] Câu hát thứ hai&#10;[00:24.00] ..."
                className="flex-1 rounded-xl border border-white/20 bg-black/60 p-3 text-xs font-mono text-white placeholder-white/30 focus:border-gold focus:outline-none resize-none overflow-y-auto"
              />
            </div>

            {customPreviewLines.length > 0 && (
              <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-emerald-400 shrink-0 flex items-center justify-between">
                <span>✓ Đã nhận diện: {customPreviewLines.length} câu hát</span>
                <span className="text-[10px] text-white/50">
                  {customPreviewLines[0].timeMs >= 0 ? "Đồng bộ LRC thành công" : "Lời thường không mốc giờ"}
                </span>
              </div>
            )}

            <button
              type="submit"
              disabled={!customText.trim()}
              className="rounded-xl bg-burgundy hover:bg-burgundy-accent px-4 py-2.5 text-xs sm:text-sm font-bold text-cream transition-all cursor-pointer disabled:opacity-50 shrink-0"
            >
              Áp dụng lời dán này
            </button>
          </form>
        )}

        {/* Modal Footer with Sync-to-Room Checkbox */}
        <div className="px-4 sm:px-6 py-3 border-t border-white/10 bg-white/5 flex items-center justify-between shrink-0">
          <label className="flex items-center gap-2 text-xs text-white/80 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={syncToRoom}
              onChange={(e) => setSyncToRoom(e.target.checked)}
              className="accent-gold w-4 h-4 rounded cursor-pointer"
            />
            <span>Đồng bộ ngay cho toàn bộ thành viên trong phòng (Realtime)</span>
          </label>

          <span className="text-[10px] text-white/40 hidden sm:inline">ESC để đóng</span>
        </div>
      </div>
    </div>
  );
}
