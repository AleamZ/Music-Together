"use client";

import { useEffect, useRef, useState } from "react";
import { addQueueItem } from "@/lib/supabase";
import { fetchSearchResults, type SearchResult } from "@/lib/youtube/search";
import {
  checkQueueRules,
  ordersRemaining,
  ruleMessage,
  violationFromRpcError,
  checkDuplicateTrack,
  duplicateMessage,
  type RoomRules,
  type RuleViolation,
} from "@/lib/queue-rules";
import ScrollTitle from "./ScrollTitle";

type AddState = { kind: "idle" } | { kind: "busy" } | { kind: "done" } | { kind: "error"; message: string };
const IDLE: AddState = { kind: "idle" };

const PAGE_SIZE = 5;

const REASON: Record<RuleViolation["code"], string> = {
  too_long: "quá dài",
  unknown_duration: "không rõ thời lượng",
  banned: "từ khóa cấm",
  order_limit: "đủ order",
};

function Spinner() {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle"
      aria-label="Đang xử lý"
    />
  );
}

/** Compute windowed pagination items with ellipsis to prevent layout overflow */
function getPaginationItems(currentPage: number, totalPages: number): (number | "...")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  if (currentPage <= 4) {
    return [1, 2, 3, 4, 5, "...", totalPages];
  }

  if (currentPage >= totalPages - 3) {
    return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }

  return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
}

/** Search results floating overlay card with pagination and load-more. Mount with a fresh `key` per search. */
export default function SearchResults({
  query,
  results: initialResults,
  continuation: initialContinuation = null,
  roomId,
  token,
  rules,
  willPend,
  orderLimit,
  queue = [],
  currentVideoId = null,
  history = [],
  onClose,
}: {
  query: string;
  results: SearchResult[];
  continuation?: string | null;
  roomId: string;
  token: string;
  rules: RoomRules;
  willPend: boolean;
  orderLimit: { mine: number; exempt: boolean };
  queue?: Array<{ youtube_video_id: string }>;
  currentVideoId?: string | null;
  history?: Array<{ youtube_video_id: string }>;
  onClose: () => void;
}) {
  const [results, setResults] = useState<SearchResult[]>(initialResults);
  const [continuation, setContinuation] = useState<string | null>(initialContinuation ?? null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const [state, setState] = useState<Record<string, AddState>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);

  const cardRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Synchronous guard against double-clicks
  const inFlight = useRef(new Set<string>());

  const atLimit = ordersRemaining(rules, orderLimit.mine, orderLimit.exempt) === 0;
  const limitViolation: RuleViolation | null = atLimit
    ? { code: "order_limit", max: rules.max_orders_per_member }
    : null;

  // Sync state if query or initialResults changes
  useEffect(() => {
    setResults(initialResults);
    setContinuation(initialContinuation ?? null);
    setCurrentPage(1);
    setLoadMoreError(null);
  }, [initialResults, initialContinuation, query]);

  // Pagination calculations
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const startIndex = (currentPage - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, results.length);
  const currentResults = results.slice(startIndex, endIndex);
  const paginationItems = getPaginationItems(currentPage, totalPages);

  // Safely scroll list to top across browsers and test environments
  function scrollListToTop() {
    const list = listRef.current;
    if (!list) return;
    if (typeof list.scrollTo === "function") {
      list.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      list.scrollTop = 0;
    }
  }

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Keyboard pagination: ArrowLeft/ArrowRight to switch pages when not in an input
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") {
        setCurrentPage((p) => Math.max(1, p - 1));
        scrollListToTop();
      } else if (e.key === "ArrowRight") {
        setCurrentPage((p) => Math.min(totalPages, p + 1));
        scrollListToTop();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [totalPages]);

  // Auto-close on click or tap outside the dialog
  useEffect(() => {
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      const target = e.target as Node | null;
      if (cardRef.current && target && !cardRef.current.contains(target)) {
        onClose();
      }
    }

    // Attach listeners after current call stack to avoid immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("touchstart", handleClickOutside);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [onClose]);

  async function handleLoadMore() {
    if (!continuation || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetchSearchResults(query, undefined, continuation);
      if (res.results.length > 0) {
        const existingIds = new Set(results.map((r) => r.videoId));
        const fresh = res.results.filter((r) => !existingIds.has(r.videoId));

        const nextResults = [...results, ...fresh];
        setResults(nextResults);
        setContinuation(res.continuation);

        // Advance to the new page where newly loaded items start
        const nextTargetPage = Math.floor(results.length / PAGE_SIZE) + 1;
        setCurrentPage(nextTargetPage);
        scrollListToTop();
      } else {
        setContinuation(null);
      }
    } catch {
      setLoadMoreError("Không tải thêm được, thử lại sau nhé.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function add(r: SearchResult) {
    if (atLimit) return;
    if (checkDuplicateTrack(r.videoId, queue, currentVideoId, history, 20)) return;
    if ((state[r.videoId] ?? IDLE).kind === "done") return;
    if (inFlight.current.has(r.videoId)) return;

    inFlight.current.add(r.videoId);
    setState((s) => ({ ...s, [r.videoId]: { kind: "busy" } }));
    try {
      await addQueueItem(roomId, token, {
        videoId: r.videoId,
        title: r.title || r.videoId,
        thumb: r.thumb,
        duration: r.durationSeconds,
      });
      setState((s) => ({ ...s, [r.videoId]: { kind: "done" } }));
    } catch (err) {
      const v = violationFromRpcError(err, rules);
      setState((s) => ({
        ...s,
        [r.videoId]: { kind: "error", message: v ? ruleMessage(v) : "Không thêm được bài." },
      }));
    } finally {
      inFlight.current.delete(r.videoId);
    }
  }

  return (
    <aside
      ref={cardRef}
      role="dialog"
      aria-label={`Kết quả tìm kiếm cho ${query}`}
      className="absolute left-0 right-0 top-full mt-2 z-30 flex max-h-[75vh] sm:max-h-[540px] flex-col rounded-xl border-2 border-gold bg-parchment/95 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-2"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between border-b border-gold-200/80 px-3.5 py-2.5 bg-cream/70 rounded-t-[10px]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base text-burgundy">🔍</span>
          <div className="min-w-0">
            <span className="font-playfair text-sm font-bold text-burgundy truncate block">
              Kết quả: &ldquo;{query}&rdquo;
            </span>
          </div>
          <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[10px] font-semibold text-burgundy shrink-0">
            {results.length} bài {totalPages > 1 ? `· Trang ${currentPage}/${totalPages}` : ""}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          title="Đóng kết quả tìm kiếm (Esc)"
          aria-label="Đóng kết quả tìm kiếm"
          className="rounded-lg border border-gold-200 bg-cream p-1 text-xs text-burgundy transition-all hover:bg-burgundy hover:text-cream hover:border-burgundy active:scale-95 shadow-2xs"
        >
          ✕
        </button>
      </div>

      {/* Empty state */}
      {results.length === 0 && (
        <div className="p-6 text-center text-sm text-ink/70 flex flex-col items-center gap-2">
          <span className="text-3xl">🎶</span>
          <p className="font-serif">Không tìm thấy bài hát phù hợp với từ khóa này.</p>
          <p className="text-xs text-ink/50">Thử tìm theo tên ca sĩ, tựa đề khác hoặc dán link YouTube trực tiếp nhé!</p>
        </div>
      )}

      {/* Results list (paginated) */}
      <ul ref={listRef} className="flex-1 overflow-y-auto px-2 py-1.5 divide-y divide-gold-200/40">
        {currentResults.map((r) => {
          const st = state[r.videoId] ?? IDLE;
          const dup = checkDuplicateTrack(r.videoId, queue, currentVideoId, history, 20);
          const violation =
            checkQueueRules(rules, { title: r.title, durationSeconds: r.durationSeconds }) ??
            (st.kind === "done" ? null : limitViolation);
          const isRowHovered = hoveredId === r.videoId;

          return (
            <li
              key={r.videoId}
              onMouseEnter={() => setHoveredId(r.videoId)}
              onMouseLeave={() => setHoveredId((id) => (id === r.videoId ? null : id))}
              className={`group flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-gold-200/25 ${
                st.kind === "busy" ? "opacity-60" : ""
              }`}
            >
              {/* Thumbnail with duration overlay */}
              <div className="relative h-11 w-16 shrink-0 overflow-hidden rounded-md border border-gold-200/60 bg-burgundy/10 shadow-2xs">
                {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb */}
                <img src={r.thumb} alt="" className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105" />
                {r.durationText && (
                  <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 py-0.2 text-[9px] font-mono text-white leading-tight">
                    {r.durationText}
                  </span>
                )}
              </div>

              {/* Title and Channel info */}
              <div className="min-w-0 flex-1">
                {/* ScrollTitle component with hover-scroll effect */}
                <ScrollTitle
                  text={r.title || r.videoId}
                  isHovered={isRowHovered}
                  className="text-xs sm:text-sm font-semibold text-ink leading-snug"
                />

                <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gold-700">
                  <span className="truncate flex items-center gap-1 text-ink/70">
                    <span>🎵</span>
                    <span className="truncate">{r.channel || "YouTube"}</span>
                  </span>
                </div>
              </div>

              {/* Action buttons & Status badges */}
              <div className="shrink-0 flex items-center justify-end pl-1 min-w-[76px]">
                {st.kind === "busy" ? (
                  <Spinner />
                ) : dup && st.kind !== "done" ? (
                  <span
                    title={duplicateMessage(dup)}
                    className="whitespace-nowrap rounded-md border border-gold/40 bg-parchment-200 px-2 py-0.5 text-[11px] font-medium text-ink/70"
                  >
                    {dup.duplicate === "queue"
                      ? dup.isCurrent
                        ? "Đang phát"
                        : "Trong hàng chờ"
                      : "Vừa phát"}
                  </span>
                ) : violation ? (
                  <span
                    title={ruleMessage(violation)}
                    className="whitespace-nowrap rounded-md border border-gold-200/80 bg-cream px-2 py-0.5 text-[11px] font-medium text-ink/60"
                  >
                    {REASON[violation.code]}
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={st.kind === "done"}
                    onClick={() => add(r)}
                    className={`whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold shadow-2xs transition-all active:scale-95 ${
                      st.kind === "done"
                        ? "border border-green-600/40 bg-green-50 text-green-800"
                        : "border border-gold bg-cream text-burgundy hover:bg-burgundy hover:text-cream hover:border-burgundy"
                    }`}
                  >
                    {st.kind === "done" ? (willPend ? "✓ Chờ duyệt" : "✓ Đã thêm") : "+ Thêm"}
                  </button>
                )}
              </div>
            </li>
          );
        })}

        {/* Results list items */}
      </ul>

      {/* Pagination Controls */}
      {(totalPages > 1 || continuation) && (
        <nav
          aria-label="Phân trang kết quả tìm kiếm"
          className="flex flex-col gap-2 border-t border-gold-200/60 bg-cream/75 px-3 sm:px-4 py-2 text-xs"
        >
          {/* Top row: Summary count + Load More action button */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-[11px] text-ink/70 font-medium truncate">
              Hiển thị <b className="font-semibold text-burgundy">{startIndex + 1}–{endIndex}</b> / <b className="font-semibold text-burgundy">{results.length}</b> bài
            </span>

            {continuation && (
              <button
                type="button"
                disabled={loadingMore}
                onClick={handleLoadMore}
                className="flex items-center gap-1.5 shrink-0 whitespace-nowrap rounded-lg border border-gold bg-cream px-2.5 py-1 text-xs font-semibold text-burgundy shadow-2xs transition-all hover:bg-burgundy hover:text-cream hover:border-burgundy active:scale-95 disabled:opacity-50"
                title="Tải thêm các bài tiếp theo từ YouTube"
                aria-label="Tải thêm từ YouTube"
              >
                {loadingMore ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border border-burgundy border-t-transparent" />
                    <span className="text-[11px]">Đang tải...</span>
                  </>
                ) : (
                  <>
                    <span className="text-xs">📥</span>
                    <span className="text-[11px] font-bold">Tải thêm (+20 bài)</span>
                  </>
                )}
              </button>
            )}
          </div>

          {loadMoreError && (
            <p className="text-right text-[11px] font-medium text-burgundy-accent">{loadMoreError}</p>
          )}

          {/* Bottom row: Centered windowed page numbers */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 sm:gap-1.5 pt-0.5">
              <button
                type="button"
                disabled={currentPage <= 1}
                onClick={() => {
                  setCurrentPage((p) => Math.max(1, p - 1));
                  scrollListToTop();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-gold-200/80 bg-cream text-xs font-bold text-burgundy shadow-2xs transition-all hover:bg-gold-200/40 disabled:opacity-30 disabled:pointer-events-none active:scale-95 shrink-0"
                title="Trang trước (Phím ◀)"
                aria-label="Trang trước"
              >
                ◀
              </button>

              {paginationItems.map((item, idx) => {
                if (item === "...") {
                  return (
                    <span
                      key={`ellipsis-${idx}`}
                      className="flex h-7 min-w-[20px] items-center justify-center text-xs font-bold text-ink/40 select-none px-0.5"
                    >
                      …
                    </span>
                  );
                }

                const page = item as number;
                const isActive = page === currentPage;

                return (
                  <button
                    key={page}
                    type="button"
                    onClick={() => {
                      setCurrentPage(page);
                      scrollListToTop();
                    }}
                    className={`flex h-7 min-w-[28px] px-1.5 items-center justify-center rounded-lg text-xs font-bold transition-all shadow-2xs shrink-0 ${
                      isActive
                        ? "bg-burgundy text-cream shadow-xs scale-105"
                        : "border border-gold-200/60 bg-cream text-burgundy hover:bg-gold-200/40 active:scale-95"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={`Trang ${page}`}
                  >
                    {page}
                  </button>
                );
              })}

              <button
                type="button"
                disabled={currentPage >= totalPages}
                onClick={() => {
                  setCurrentPage((p) => Math.min(totalPages, p + 1));
                  scrollListToTop();
                }}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-gold-200/80 bg-cream text-xs font-bold text-burgundy shadow-2xs transition-all hover:bg-gold-200/40 disabled:opacity-30 disabled:pointer-events-none active:scale-95 shrink-0"
                title="Trang sau (Phím ▶)"
                aria-label="Trang sau"
              >
                ▶
              </button>
            </div>
          )}
        </nav>
      )}

      {/* Footer hint */}
      <div className="border-t border-gold-200/60 px-3 py-1.5 text-center text-[10px] text-ink/50 bg-cream/40 rounded-b-[10px]">
        💡 Rê chuột để cuộn tựa đề dài · Dùng ◀ ▶ chuyển trang · Nhấp ra ngoài hoặc bấm <kbd className="font-mono bg-cream px-1 rounded border border-gold/30">ESC</kbd> để đóng
      </div>
    </aside>
  );
}
