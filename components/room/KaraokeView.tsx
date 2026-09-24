"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LyricLine } from "@/lib/lyrics/parse-lrc";
import { formatClock } from "@/lib/format";
import { useTheme } from "@/hooks/useTheme";

export interface KaraokeViewProps {
  lines: LyricLine[];
  activeLineIndex: number;
  loading: boolean;
  error: string | null;
  hasSynced: boolean;
  canSeek?: boolean;
  onSeekMs?: (ms: number) => void;
  onSearchManual?: (query: string) => void;
  onOpenSearchModal?: () => void;
  fullscreen?: boolean;
  onCloseFullscreen?: () => void;
  elapsedMs?: number;
  isPlaying?: boolean;
  offsetMs?: number;
  onChangeOffset?: (offset: number) => void;
  suggestedIntroOffsetMs?: number | null;
}

interface CharWord {
  isSpace: boolean;
  text: string;
}

function parseTextIntoWords(text: string): CharWord[] {
  const normalized = (text || "").normalize("NFC");
  const parts = normalized.split(/(\s+)/);
  return parts.filter(Boolean).map((part) => ({
    isSpace: /^\s+$/.test(part),
    text: part,
  }));
}

export default function KaraokeView({
  lines,
  activeLineIndex,
  loading,
  error,
  hasSynced,
  canSeek,
  onSeekMs,
  onSearchManual,
  onOpenSearchModal,
  fullscreen = false,
  onCloseFullscreen,
  elapsedMs = 0,
  isPlaying = false,
  offsetMs = 0,
  onChangeOffset,
  suggestedIntroOffsetMs,
}: KaraokeViewProps) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const charContainerRef = useRef<HTMLDivElement | null>(null);

  const [align, setAlign] = useState<"left" | "center">("left");
  const [userScrolled, setUserScrolled] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const userScrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 2500);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const [manualQuery, setManualQuery] = useState("");
  const [showSearchBox, setShowSearchBox] = useState(false);

  // Smooth local clock interpolator for 60 FPS karaoke letter-by-letter highlight
  const lastSyncElapsedRef = useRef(elapsedMs);
  const lastSyncTimeRef = useRef(performance.now());
  const lastHighlightedCountRef = useRef(-1);

  useEffect(() => {
    lastSyncElapsedRef.current = elapsedMs;
    lastSyncTimeRef.current = performance.now();
  }, [elapsedMs, isPlaying]);

  useEffect(() => {
    lastHighlightedCountRef.current = -1;
  }, [activeLineIndex, theme]);

  // Color schemes based on active theme
  const getThemeStyles = useCallback(() => {
    switch (theme) {
      case "miku":
        return {
          activeClass: "text-white font-black",
          highlightCharClass:
            "text-[#00f0ff] font-black drop-shadow-[0_0_14px_rgba(0,240,255,1)] transition-colors duration-75",
          dimCharClass: "text-white/30 font-bold transition-colors duration-75",
          activeTimestamp: "text-[#00f0ff] font-bold font-mono",
          inactiveClass: "text-[#a5f3fc]/35 hover:text-[#a5f3fc]/70",
          badgeBg: "bg-[#00f0ff]/15 text-[#00f0ff] border border-[#00f0ff]/30",
          snapBtn: "bg-[#00f0ff] text-black font-bold shadow-[0_0_16px_#00f0ff]",
          activeIndicator: "bg-[#00f0ff]",
        };
      case "cyberpunk":
        return {
          activeClass: "text-white font-black",
          highlightCharClass:
            "text-[#00ff88] font-black drop-shadow-[0_0_14px_rgba(0,255,136,1)] transition-colors duration-75",
          dimCharClass: "text-white/30 font-bold transition-colors duration-75",
          activeTimestamp: "text-[#00ff88] font-bold font-mono",
          inactiveClass: "text-cyan-200/35 hover:text-cyan-200/70",
          badgeBg: "bg-cyan-900/30 text-cyan-300 border border-cyan-500/30",
          snapBtn: "bg-[#ff0055] text-white font-bold shadow-[0_0_16px_#ff0055]",
          activeIndicator: "bg-[#00ff88]",
        };
      case "itv":
        return {
          activeClass: "text-white font-black",
          highlightCharClass:
            "text-[#ffde00] font-black drop-shadow-[0_0_12px_rgba(255,222,0,1)] transition-colors duration-75",
          dimCharClass: "text-white/30 font-bold transition-colors duration-75",
          activeTimestamp: "text-[#ffde00] font-bold font-mono",
          inactiveClass: "text-white/35 hover:text-white/70",
          badgeBg: "bg-[#76cb00]/15 text-[#84e800] border border-[#76cb00]/30",
          snapBtn: "bg-[#76cb00] text-black font-bold shadow-[0_0_12px_#76cb00]",
          activeIndicator: "bg-[#ffde00]",
        };
      case "lofi":
        return {
          activeClass: "text-[#fef3c7] font-black",
          highlightCharClass:
            "text-[#fbbf24] font-black drop-shadow-[0_0_12px_rgba(251,191,36,0.95)] transition-colors duration-75",
          dimCharClass: "text-[#dfcca9]/30 font-bold transition-colors duration-75",
          activeTimestamp: "text-[#fbbf24] font-bold font-mono",
          inactiveClass: "text-[#dfcca9]/35 hover:text-[#dfcca9]/70",
          badgeBg: "bg-amber-900/20 text-amber-300 border border-amber-700/30",
          snapBtn: "bg-amber-600 text-cream font-bold shadow-md",
          activeIndicator: "bg-[#fbbf24]",
        };
      default:
        // Salon / Cozy
        return {
          activeClass: "text-white font-black",
          highlightCharClass:
            "text-[#fef08a] font-black drop-shadow-[0_0_14px_rgba(254,240,138,1)] transition-colors duration-75",
          dimCharClass: "text-white/30 font-bold transition-colors duration-75",
          activeTimestamp: "text-gold font-bold font-mono",
          inactiveClass: "text-cream/35 hover:text-cream/70",
          badgeBg: "bg-gold-200/10 text-gold-200 border border-gold-200/30",
          snapBtn: "bg-gold text-burgundy font-bold shadow-lg",
          activeIndicator: "bg-gold",
        };
    }
  }, [theme]);

  const themeStyles = getThemeStyles();

  // RequestAnimationFrame loop for real-time progressive letter-by-letter highlight
  useEffect(() => {
    let animId: number;

    const frame = () => {
      if (
        charContainerRef.current &&
        hasSynced &&
        activeLineIndex >= 0 &&
        activeLineIndex < lines.length
      ) {
        const curLine = lines[activeLineIndex];
        const nextLine = lines[activeLineIndex + 1];
        const startTime = curLine.timeMs;

        const now = performance.now();
        const rawCurrentMs = isPlaying
          ? lastSyncElapsedRef.current + (now - lastSyncTimeRef.current)
          : lastSyncElapsedRef.current;
        const currentMs = Math.max(0, rawCurrentMs + offsetMs);

        const rawDuration =
          nextLine && nextLine.timeMs > startTime ? nextLine.timeMs - startTime : 4500;
        const lineTextLength = (curLine.text || "").trim().length;
        const estimatedMaxSingMs = Math.max(1600, lineTextLength * 280);
        const duration = Math.min(rawDuration, estimatedMaxSingMs);

        let progress = 0;
        if (currentMs <= startTime) {
          progress = 0;
        } else if (duration > 0) {
          progress = Math.min(1, Math.max(0, (currentMs - startTime) / duration));
        } else {
          progress = 1;
        }

        const spans = charContainerRef.current.querySelectorAll<HTMLSpanElement>(".char-span");
        const total = spans.length;
        const count = Math.min(total, Math.floor(progress * total));

        if (count !== lastHighlightedCountRef.current) {
          lastHighlightedCountRef.current = count;
          const { highlightCharClass, dimCharClass } = themeStyles;
          for (let i = 0; i < total; i++) {
            const el = spans[i];
            const isSpace = el.getAttribute("data-space") === "true";
            if (isSpace) {
              el.className = `char-span inline-block whitespace-pre ${i < count ? "text-white/60" : "text-white/20"}`;
            } else {
              el.className = `char-span ${i < count ? highlightCharClass : dimCharClass}`;
            }
          }
        }
      }

      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  }, [hasSynced, activeLineIndex, lines, isPlaying, offsetMs, themeStyles]);

  // Smooth scroll active line into center of container
  const scrollToActive = useCallback((smooth = true) => {
    const container = containerRef.current;
    const activeEl = activeLineRef.current;
    if (!container || !activeEl) return;

    const containerRect = container.getBoundingClientRect();
    const activeRect = activeEl.getBoundingClientRect();
    const relativeTop = activeRect.top - containerRect.top + container.scrollTop;
    const targetScrollTop = relativeTop - container.clientHeight / 2 + activeEl.clientHeight / 2;

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: smooth ? "smooth" : "instant",
    });
  }, []);

  // Auto-scroll to active line unless user is manually inspecting other lines
  useEffect(() => {
    if (userScrolled) return;
    scrollToActive(true);
  }, [activeLineIndex, userScrolled, scrollToActive]);

  // Initial positioning on mount or lines changed
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollToActive(false);
    }, 60);
    return () => clearTimeout(timer);
  }, [lines, scrollToActive]);

  const handleUserScroll = () => {
    setUserScrolled(true);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      setUserScrolled(false);
    }, 4000);
  };

  const snapBackToActive = () => {
    setUserScrolled(false);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    scrollToActive(true);
  };

  const handleManualSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    onSearchManual?.(manualQuery.trim());
    setShowSearchBox(false);
  };

  // Apple Music-inspired depth of field styling per line
  const getLineStyle = (idx: number) => {
    if (!hasSynced || activeLineIndex < 0) {
      return {
        className: `${themeStyles.inactiveClass} opacity-80 scale-100 blur-none`,
        isActive: false,
      };
    }

    const dist = Math.abs(idx - activeLineIndex);
    const isActive = dist === 0;

    if (isActive) {
      return {
        className: `${themeStyles.activeClass} opacity-100 scale-100 blur-none z-10`,
        isActive: true,
      };
    }

    if (dist === 1) {
      return {
        className: `${themeStyles.inactiveClass} opacity-45 hover:!opacity-100 scale-[0.98] hover:!scale-100 blur-[0.4px] hover:!blur-none`,
        isActive: false,
      };
    }

    if (dist === 2) {
      return {
        className: `${themeStyles.inactiveClass} opacity-25 hover:!opacity-100 scale-[0.95] hover:!scale-100 blur-[0.8px] hover:!blur-none`,
        isActive: false,
      };
    }

    return {
      className: `${themeStyles.inactiveClass} opacity-15 hover:!opacity-100 scale-[0.92] hover:!scale-100 blur-[1px] hover:!blur-none`,
      isActive: false,
    };
  };

  return (
    <div
      className={`relative flex flex-col w-full h-full select-none ${
        fullscreen ? "p-4 sm:p-8" : "p-2 sm:p-3"
      }`}
    >
      {/* Top Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 pb-2 mb-1.5 border-b border-white/10 shrink-0">
        {/* Left: Badge & Fullscreen Hint */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider whitespace-nowrap shrink-0 shadow-sm ${themeStyles.badgeBg}`}
          >
            {hasSynced ? "🎤 KARAOKE SYNC" : "📄 LỜI BÀI HÁT"}
          </span>
          {canSeek && hasSynced && fullscreen && (
            <span className="text-[10px] text-white/40 whitespace-nowrap hidden lg:inline">
              (Bấm vào câu hát để tua)
            </span>
          )}
        </div>

        {/* Right: Controls & Adjusters */}
        <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 shrink-0">
          {/* Sync Offset Adjuster */}
          {hasSynced && onChangeOffset && (
            <div
              className="inline-flex items-center gap-0.5 bg-white/10 hover:bg-white/15 border border-white/15 rounded-lg px-1.5 py-0.5 text-[10px] sm:text-[11px] font-mono text-white/90 whitespace-nowrap shrink-0 transition-colors"
              title="Căn chỉnh độ lệch thời gian (Offset) nếu lời chạy nhanh/chậm hơn video"
            >
              <span className="text-[9px] text-white/40 hidden sm:inline mr-0.5">Lệch:</span>
              <button
                type="button"
                onClick={() => onChangeOffset(offsetMs - 500)}
                className="px-1 py-0.2 hover:text-gold hover:bg-white/10 rounded font-bold transition-all cursor-pointer"
                title="Lùi lời 0.5s (-0.5s) khi lời hát bị nhanh hơn ca sĩ"
              >
                -0.5s
              </button>
              <span
                className={`px-1 font-bold ${
                  offsetMs !== 0 ? "text-gold" : "text-white/50"
                }`}
              >
                {offsetMs > 0
                  ? `+${(offsetMs / 1000).toFixed(1)}s`
                  : `${(offsetMs / 1000).toFixed(1)}s`}
              </span>
              <button
                type="button"
                onClick={() => onChangeOffset(offsetMs + 500)}
                className="px-1 py-0.2 hover:text-gold hover:bg-white/10 rounded font-bold transition-all cursor-pointer"
                title="Tiến lời 0.5s (+0.5s) khi lời hát bị chậm hơn ca sĩ"
              >
                +0.5s
              </button>
              {offsetMs !== 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onChangeOffset(0);
                    setToastMessage("Đã đặt lại độ lệch (0.0s)");
                  }}
                  className="text-[9px] text-white/40 hover:text-white px-1 py-0.2 hover:bg-white/10 rounded cursor-pointer font-bold"
                  title="Đặt lại độ lệch về 0.0s"
                >
                  ↺
                </button>
              )}
            </div>
          )}

          {/* Quick Intro Offset Suggestion from SponsorBlock */}
          {hasSynced && onChangeOffset && suggestedIntroOffsetMs && (
            offsetMs !== suggestedIntroOffsetMs ? (
              <button
                type="button"
                onClick={() => {
                  onChangeOffset(suggestedIntroOffsetMs);
                  const sec = (suggestedIntroOffsetMs / 1000).toFixed(1);
                  setToastMessage(`💡 Đã bù intro MV (${suggestedIntroOffsetMs >= 0 ? `+${sec}s` : `${sec}s`})`);
                }}
                className="inline-flex items-center gap-1 bg-gradient-to-r from-amber-500/25 to-yellow-500/25 hover:from-amber-400 hover:to-yellow-400 text-amber-200 hover:text-black border border-amber-400/60 rounded-lg px-2 py-0.5 text-[10px] sm:text-[11px] font-bold shadow-md hover:scale-105 transition-all cursor-pointer whitespace-nowrap shrink-0"
                title="Phát hiện đoạn intro/thoại đầu MV từ SponsorBlock. Bấm để tự động bù lệch cho bài hát"
              >
                <span className="animate-pulse">💡</span>
                <span>Intro</span>
                <span className="font-mono text-[9px] sm:text-[10px]">({(suggestedIntroOffsetMs / 1000).toFixed(1)}s)</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onChangeOffset(0);
                  setToastMessage("Đã huỷ bù intro (0.0s)");
                }}
                className="inline-flex items-center gap-1 bg-emerald-500/25 hover:bg-emerald-500/35 text-emerald-200 border border-emerald-400/50 rounded-lg px-2 py-0.5 text-[10px] sm:text-[11px] font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0"
                title="Đang áp dụng mốc bù intro SponsorBlock. Bấm để huỷ bỏ"
              >
                <span>✓ Intro</span>
                <span className="font-mono text-[9px] sm:text-[10px] text-emerald-300">({(suggestedIntroOffsetMs / 1000).toFixed(1)}s)</span>
                <span className="text-[9px] text-white/50 hover:text-white ml-0.5 font-bold">✕</span>
              </button>
            )
          )}

          {/* Alignment Switcher (Left vs Center) */}
          <button
            type="button"
            onClick={() => setAlign((prev) => (prev === "left" ? "center" : "left"))}
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-lg border border-white/15 bg-white/5 hover:bg-white/15 text-white/80 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title={align === "left" ? "Đổi sang căn giữa" : "Đổi sang căn lề trái (chuẩn Apple Music)"}
          >
            <span>{align === "left" ? "⇤" : "≡"}</span>
            <span className="hidden sm:inline">{align === "left" ? "Trái" : "Giữa"}</span>
          </button>

          {/* Search Button */}
          <button
            type="button"
            onClick={() => {
              if (onOpenSearchModal) {
                onOpenSearchModal();
              } else {
                setShowSearchBox((prev) => !prev);
              }
            }}
            className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] px-1.5 sm:px-2 py-0.5 rounded-lg border border-white/20 bg-white/5 hover:bg-white/15 text-white/80 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            title="Tìm kiếm & chọn bản lời bài hát phù hợp"
          >
            <span>🔍</span>
            <span className="hidden sm:inline">{onOpenSearchModal ? "Tìm lời" : showSearchBox ? "Đóng" : "Tìm lời"}</span>
          </button>

          {fullscreen && onCloseFullscreen && (
            <button
              type="button"
              onClick={onCloseFullscreen}
              className="text-sm px-2.5 py-0.5 rounded-lg border border-white/30 bg-black/40 hover:bg-white/20 text-white font-bold transition-all cursor-pointer whitespace-nowrap shrink-0"
              title="Đóng chế độ toàn màn hình"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Floating toast notification for sync feedback */}
      {toastMessage && (
        <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-full bg-gold text-burgundy font-bold text-xs shadow-xl backdrop-blur-md flex items-center gap-1.5 pointer-events-none transition-all">
          {toastMessage}
        </div>
      )}

      {/* Manual Search Drawer */}
      {showSearchBox && (
        <form onSubmit={handleManualSearch} className="mb-3 flex items-center gap-2 shrink-0">
          <input
            type="text"
            placeholder="Nhập tên bài hát hoặc ca sĩ chính xác..."
            value={manualQuery}
            onChange={(e) => setManualQuery(e.target.value)}
            className="flex-1 rounded-lg border border-white/20 bg-black/50 px-3 py-1.5 text-xs text-white placeholder-white/40 focus:border-gold focus:outline-none"
            autoFocus
          />
          <button
            type="submit"
            className="rounded-lg bg-burgundy px-3 py-1.5 text-xs font-semibold text-cream hover:bg-burgundy-accent transition-all cursor-pointer"
          >
            Tìm lời
          </button>
        </form>
      )}

      {/* Main Lyrics Body with Top/Bottom Fade Mask & Hidden Scrollbars */}
      <div
        ref={containerRef}
        onWheel={handleUserScroll}
        onTouchMove={handleUserScroll}
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          maskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
        }}
        className={`relative flex-1 overflow-y-auto overflow-x-hidden min-h-0 space-y-4 sm:space-y-6 no-scrollbar ${
          align === "left"
            ? "text-left max-w-2xl mx-auto px-3 sm:px-6"
            : "text-center px-3 sm:px-6"
        } ${fullscreen ? "py-[30vh]" : "py-8 sm:py-12"}`}
      >
        {loading && (
          <div className="flex flex-col items-center justify-center h-48 gap-2 text-white/70">
            <span className="text-2xl animate-spin">⏳</span>
            <span className="text-xs font-mono">Đang tìm lời bài hát đồng bộ...</span>
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-center px-4">
            <span className="text-3xl opacity-70">🎶</span>
            <p className="text-xs sm:text-sm text-white/80 font-medium">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (onOpenSearchModal) {
                  onOpenSearchModal();
                } else {
                  setShowSearchBox(true);
                }
              }}
              className="rounded-lg border border-white/30 bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20 transition-all cursor-pointer"
            >
              🔍 Tìm & chọn bản lời khác
            </button>
          </div>
        )}

        {!loading && !error && lines.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-white/50 text-xs">
            Chưa có bài hát nào đang phát.
          </div>
        )}

        {!loading &&
          !error &&
          lines.map((line, idx) => {
            const { className, isActive } = getLineStyle(idx);
            const words = isActive ? parseTextIntoWords(line.text || "♪ ♪ ♪") : null;

            return (
              <div
                key={idx}
                ref={isActive ? activeLineRef : null}
                onClick={() => {
                  if (canSeek && line.timeMs >= 0) {
                    onSeekMs?.(line.timeMs);
                  }
                }}
                style={{
                  transition:
                    "transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 300ms cubic-bezier(0.2, 0.8, 0.2, 1), filter 300ms cubic-bezier(0.2, 0.8, 0.2, 1)",
                  transformOrigin: align === "left" ? "left center" : "center center",
                  willChange: "transform, opacity, filter",
                }}
                className={`group py-1.5 sm:py-2.5 px-2 rounded-xl w-full select-none transition-all ${!isActive ? "hover:bg-white/[0.06] hover:!opacity-100 hover:!blur-none hover:!scale-100" : ""
                  } ${canSeek && line.timeMs >= 0 ? "cursor-pointer" : ""} ${className}`}
              >
                <div
                  className={`flex flex-col gap-1 w-full ${align === "left" ? "items-start" : "items-center"
                    }`}
                >
                  {/* Timestamp clearly displayed on the line ABOVE the lyrics */}
                  {hasSynced && line.timeMs >= 0 && (
                    <div
                      className={`flex items-center gap-1.5 font-mono text-[11px] sm:text-xs select-none transition-colors ${isActive
                          ? themeStyles.activeTimestamp
                          : "text-white/40 group-hover:text-white/80"
                        }`}
                    >
                      <span>⏱ {formatClock(line.timeMs)}</span>
                      {isActive && isPlaying && (
                        <span
                          className={`inline-block w-1.5 h-1.5 rounded-full ${themeStyles.activeIndicator} animate-pulse`}
                        />
                      )}
                      {/* Tap-to-Align 1-Chạm Khớp Lời */}
                      {onChangeOffset && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const targetOffset = line.timeMs - elapsedMs;
                            onChangeOffset(targetOffset);
                            const sec = (targetOffset / 1000).toFixed(1);
                            setToastMessage(
                              `🎯 Đã khớp câu này với nhạc (${targetOffset >= 0 ? `+${sec}s` : `${sec}s`})`
                            );
                          }}
                          className={
                            !isActive
                              ? "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all duration-200 ml-2 px-2.5 py-0.5 rounded-full text-[11px] font-bold tracking-wide cursor-pointer flex items-center gap-1.5 shadow-lg bg-gradient-to-r from-amber-500/30 to-yellow-500/30 text-amber-200 border border-amber-400/70 hover:from-amber-400 hover:to-yellow-400 hover:text-black hover:border-amber-300 hover:scale-105 hover:shadow-[0_0_16px_rgba(251,191,36,0.7)]"
                              : "opacity-0 group-hover:opacity-40 hover:!opacity-90 transition-opacity ml-2 px-1.5 py-0.5 rounded text-[10px] text-white/40 hover:text-white bg-white/10 hover:bg-white/20 border border-white/15 flex items-center gap-1 cursor-pointer font-sans"
                          }
                          title="Bấm để đặt câu này khớp với thời điểm ca sĩ đang hát (Tự động căn chỉnh toàn bộ bài)"
                        >
                          <span className={!isActive ? "animate-pulse" : ""}>🎯</span>
                          <span>Khớp câu này</span>
                        </button>
                      )}
                    </div>
                  )}

                  {/* Lyric text with sequential letter-by-letter highlight */}
                  {isActive && words ? (
                    <div
                      ref={charContainerRef}
                      className={`font-sans leading-relaxed sm:leading-loose tracking-normal ${fullscreen
                          ? "text-2xl sm:text-4xl lg:text-5xl font-black"
                          : "text-base sm:text-lg font-bold"
                        }`}
                    >
                      {words.map((word, wIdx) => {
                        if (word.isSpace) {
                          return (
                            <span
                              key={wIdx}
                              data-space="true"
                              className="char-span inline-block whitespace-pre text-white/30"
                            >
                              {word.text}
                            </span>
                          );
                        }
                        return (
                          <span key={wIdx} className="inline-block whitespace-nowrap">
                            {Array.from(word.text).map((char, cIdx) => (
                              <span
                                key={cIdx}
                                className={`char-span ${themeStyles.dimCharClass}`}
                              >
                                {char}
                              </span>
                            ))}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span
                      className={`leading-relaxed sm:leading-loose tracking-normal transition-colors font-sans ${fullscreen
                          ? "text-2xl sm:text-4xl lg:text-5xl font-bold"
                          : "text-base sm:text-lg font-medium"
                        }`}
                    >
                      {line.text || "♪ ♪ ♪"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
      </div>

      {/* Snap Back Floating Button */}
      {userScrolled && hasSynced && activeLineIndex >= 0 && (
        <button
          type="button"
          onClick={snapBackToActive}
          className={`absolute bottom-3 right-4 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all hover:scale-105 active:scale-95 cursor-pointer flex items-center gap-1.5 ${themeStyles.snapBtn}`}
        >
          <span>🎯</span>
          <span>Về câu đang hát</span>
        </button>
      )}
    </div>
  );
}
