"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { findActiveLyricIndex, type LyricLine } from "@/lib/lyrics/parse-lrc";
import { formatClock } from "@/lib/format";
import { useTheme } from "@/hooks/useTheme";
import {
  estimateSongProfile,
  buildEstimatedLineTiming,
  computeTokenFill,
  type KaraokeLineTiming,
  type SongTimingProfile,
} from "@/lib/lyrics/timing/index";

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

  // Smooth local clock interpolator for 60 FPS karaoke highlight
  const lastSyncElapsedRef = useRef(elapsedMs);
  const lastSyncTimeRef = useRef(performance.now());

  useEffect(() => {
    lastSyncElapsedRef.current = elapsedMs;
    lastSyncTimeRef.current = performance.now();
  }, [elapsedMs, isPlaying]);

  // Color schemes based on active theme
  const getThemeStyles = useCallback(() => {
    switch (theme) {
      case "miku":
        return {
          activeClass: "text-white font-black",
          highlightColor: "#00f0ff",
          dimColor: "rgba(255, 255, 255, 0.35)",
          glowColor: "rgba(0, 240, 255, 0.9)",
          activeTimestamp: "text-[#00f0ff] font-bold font-mono",
          inactiveClass: "text-[#a5f3fc]/35 hover:text-[#a5f3fc]/70",
          badgeBg: "bg-[#00f0ff]/15 text-[#00f0ff] border border-[#00f0ff]/30",
          snapBtn: "bg-[#00f0ff] text-black font-bold shadow-[0_0_16px_#00f0ff]",
          activeIndicator: "bg-[#00f0ff]",
        };
      case "cyberpunk":
        return {
          activeClass: "text-white font-black",
          highlightColor: "#00ff88",
          dimColor: "rgba(255, 255, 255, 0.35)",
          glowColor: "rgba(0, 255, 136, 0.9)",
          activeTimestamp: "text-[#00ff88] font-bold font-mono",
          inactiveClass: "text-cyan-200/35 hover:text-cyan-200/70",
          badgeBg: "bg-cyan-900/30 text-cyan-300 border border-cyan-500/30",
          snapBtn: "bg-[#ff0055] text-white font-bold shadow-[0_0_16px_#ff0055]",
          activeIndicator: "bg-[#00ff88]",
        };
      case "itv":
        return {
          activeClass: "text-white font-black",
          highlightColor: "#ffde00",
          dimColor: "rgba(255, 255, 255, 0.35)",
          glowColor: "rgba(255, 222, 0, 0.85)",
          activeTimestamp: "text-[#ffde00] font-bold font-mono",
          inactiveClass: "text-white/35 hover:text-white/70",
          badgeBg: "bg-[#76cb00]/15 text-[#84e800] border border-[#76cb00]/30",
          snapBtn: "bg-[#76cb00] text-black font-bold shadow-[0_0_12px_#76cb00]",
          activeIndicator: "bg-[#ffde00]",
        };
      case "lofi":
        return {
          activeClass: "text-[#fef3c7] font-black",
          highlightColor: "#fbbf24",
          dimColor: "rgba(223, 204, 169, 0.35)",
          glowColor: "rgba(251, 191, 36, 0.85)",
          activeTimestamp: "text-[#fbbf24] font-bold font-mono",
          inactiveClass: "text-[#dfcca9]/35 hover:text-[#dfcca9]/70",
          badgeBg: "bg-amber-900/20 text-amber-300 border border-amber-700/30",
          snapBtn: "bg-amber-600 text-cream font-bold shadow-md",
          activeIndicator: "bg-[#fbbf24]",
        };
      default:
        // Salon / Cozy / Dragon
        return {
          activeClass: "text-white font-black",
          highlightColor: "#facc15",
          dimColor: "rgba(255, 255, 255, 0.35)",
          glowColor: "rgba(250, 204, 21, 0.85)",
          activeTimestamp: "text-gold font-bold font-mono",
          inactiveClass: "text-cream/35 hover:text-cream/70",
          badgeBg: "bg-gold-200/10 text-gold-200 border border-gold-200/30",
          snapBtn: "bg-gold text-burgundy font-bold shadow-lg",
          activeIndicator: "bg-gold",
        };
    }
  }, [theme]);

  const themeStyles = getThemeStyles();

  // Effective active line index: tracks line transitions with millisecond precision
  // based on continuous playback time, avoiding the 500ms polling latency from parent.
  const [effectiveLineIndex, setEffectiveLineIndex] = useState(activeLineIndex);
  const effectiveLineIndexRef = useRef(activeLineIndex);

  // Sync immediately when parent activeLineIndex changes (e.g. seek, skip, manual navigation)
  useEffect(() => {
    setEffectiveLineIndex(activeLineIndex);
    effectiveLineIndexRef.current = activeLineIndex;
  }, [activeLineIndex]);

  // Adaptive song profile — computed once per lyrics load, drives all timing heuristics
  const songProfile = useMemo<SongTimingProfile>(() => {
    return estimateSongProfile(lines);
  }, [lines]);

  // Per-line timing — computed whenever active line changes (NOT in rAF)
  const activeLineTiming = useMemo<KaraokeLineTiming | null>(() => {
    if (effectiveLineIndex < 0 || effectiveLineIndex >= lines.length) return null;
    return buildEstimatedLineTiming(
      lines[effectiveLineIndex],
      lines[effectiveLineIndex + 1],
      songProfile
    );
  }, [effectiveLineIndex, lines, songProfile]);

  // --- Refs so rAF loop reads latest values without closure capture ---
  const activeLineTimingRef = useRef<KaraokeLineTiming | null>(null);
  const themeStylesRef = useRef(themeStyles);

  // Sync themeStyles ref on every render (safe: no DOM involvement)
  themeStylesRef.current = themeStyles;

  // Sync timing ref AFTER DOM has been committed (useLayoutEffect).
  // Also reset word fills to 0% so line transitions always start cleanly.
  useLayoutEffect(() => {
    activeLineTimingRef.current = activeLineTiming;
    if (charContainerRef.current) {
      const els = charContainerRef.current.querySelectorAll<HTMLSpanElement>(".karaoke-word");
      els.forEach((el) => {
        el.style.setProperty("--fill", "0%");
        el.style.filter = "none";
        el.style.transform = "scale(1) translateY(0px)";
      });
    }
  }, [activeLineTiming]);

  // RequestAnimationFrame loop — runs CONTINUOUSLY; never restarted on line change.
  // Reads timing and styles via refs; switches lines immediately when boundary is crossed.
  useEffect(() => {
    let animId: number;

    const frame = () => {
      const now = performance.now();
      const rawCurrentMs = isPlaying
        ? lastSyncElapsedRef.current + (now - lastSyncTimeRef.current)
        : lastSyncElapsedRef.current;
      const currentMs = Math.max(0, rawCurrentMs + offsetMs);

      // High-precision active line detection: switch lines the instant currentMs crosses the line boundary
      if (hasSynced && lines.length > 0 && isPlaying) {
        const targetIndex = findActiveLyricIndex(lines, currentMs);
        if (targetIndex >= 0 && targetIndex !== effectiveLineIndexRef.current) {
          effectiveLineIndexRef.current = targetIndex;
          setEffectiveLineIndex(targetIndex);
        }
      }

      const timing = activeLineTimingRef.current;
      const styles = themeStylesRef.current;
      const container = charContainerRef.current;

      if (container && hasSynced && timing && timing.tokens.length > 0) {
        const nonSpaceTokens = timing.tokens.filter((t) => !t.isSpace);
        const wordEls = container.querySelectorAll<HTMLSpanElement>(".karaoke-word");

        // Safety: if token count doesn't match DOM, wait for next commit
        if (nonSpaceTokens.length !== wordEls.length) {
          animId = requestAnimationFrame(frame);
          return;
        }

        for (let i = 0; i < nonSpaceTokens.length; i++) {
          const tok = nonSpaceTokens[i];
          const el = wordEls[i];
          if (!el) continue;

          const fill = computeTokenFill(tok, currentMs);
          el.style.setProperty("--fill", `${fill}%`);

          if (fill > 0 && fill < 100) {
            el.style.filter = `drop-shadow(0 0 12px ${styles.glowColor})`;
            el.style.transform = "scale(1.06) translateY(-1px)";
          } else {
            el.style.filter = "none";
            el.style.transform = "scale(1) translateY(0px)";
          }
        }
      }

      animId = requestAnimationFrame(frame);
    };

    animId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animId);
  // Only restart rAF when fundamental playback state changes — NOT on line change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSynced, isPlaying, offsetMs, lines]);

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
  }, [effectiveLineIndex, userScrolled, scrollToActive]);

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
    if (!hasSynced || effectiveLineIndex < 0) {
      return {
        className: `${themeStyles.inactiveClass} opacity-80 scale-100 blur-none`,
        isActive: false,
      };
    }

    const dist = Math.abs(idx - effectiveLineIndex);
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

                  {/* Lyric text with progressive rhythm-aware gradient sweep */}
                  {isActive && activeLineTiming && activeLineTiming.tokens.length > 0 ? (
                    <div
                      ref={charContainerRef}
                      className={`font-sans leading-relaxed sm:leading-loose tracking-normal ${
                        fullscreen
                          ? "text-2xl sm:text-4xl lg:text-5xl font-black"
                          : "text-base sm:text-lg font-bold"
                      }`}
                    >
                      {activeLineTiming.tokens.map((token, tIdx) => {
                        if (token.isSpace) {
                          return (
                            <span
                              key={tIdx}
                              className="inline-block whitespace-pre text-white/30"
                            >
                              {token.text}
                            </span>
                          );
                        }
                        return (
                          <span
                            key={tIdx}
                            className="karaoke-word inline-block whitespace-nowrap transition-transform duration-100 ease-out origin-bottom select-none"
                            style={{
                              backgroundImage: `linear-gradient(to right, ${themeStyles.highlightColor} 0%, ${themeStyles.highlightColor} var(--fill, 0%), ${themeStyles.dimColor} var(--fill, 0%), ${themeStyles.dimColor} 100%)`,
                              WebkitBackgroundClip: "text",
                              WebkitTextFillColor: "transparent",
                              willChange: "transform, filter",
                            }}
                          >
                            {token.text}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span
                      className={`leading-relaxed sm:leading-loose tracking-normal transition-colors font-sans ${
                        fullscreen
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
      {userScrolled && hasSynced && effectiveLineIndex >= 0 && (
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
