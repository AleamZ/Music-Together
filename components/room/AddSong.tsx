"use client";

import { useEffect, useRef, useState } from "react";
import { addQueueItem, addQueueItems } from "@/lib/supabase";
import { parseYouTubeId, parsePlaylistId, isYouTubeLinkInput } from "@/lib/youtube/parse";
import { fetchVideoMeta } from "@/lib/youtube/meta";
import { fetchVideoDetails } from "@/lib/youtube/video";
import { fetchPlaylistItems } from "@/lib/youtube/playlist";
import { fetchSuggestions, type Suggestion } from "@/lib/youtube/suggest";
import { fetchSearchResults, type SearchResult } from "@/lib/youtube/search";
import {
  checkQueueRules,
  orderLimitViolation,
  ordersRemaining,
  ruleMessage,
  violationFromRpcError,
  checkDuplicateTrack,
  duplicateMessage,
  deduplicatePlaylistItems,
  type RoomRules,
} from "@/lib/queue-rules";
import SearchResults from "./SearchResults";

const SUGGEST_DEBOUNCE_MS = 250;
const BLUR_CLOSE_MS = 150;

type Search = { id: number; query: string; results: SearchResult[]; continuation: string | null };

export default function AddSong({
  roomId,
  token,
  rules,
  willPend,
  orderLimit,
  queue = [],
  currentVideoId = null,
  history = [],
}: {
  roomId: string;
  token: string;
  rules: RoomRules;
  willPend: boolean;
  orderLimit: { mine: number; exempt: boolean };
  queue?: Array<{ youtube_video_id: string }>;
  currentVideoId?: string | null;
  history?: Array<{ youtube_video_id: string }>;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [search, setSearch] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);

  const searchCtrl = useRef<AbortController | null>(null);
  const searchSeq = useRef(0);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // After a search is launched for X, don't re-open suggestions for X (they'd pop back
  // up 250ms after picking one). Typing anything else resumes suggestions.
  const skipSuggestFor = useRef<string | null>(null);

  const trimmed = input.trim();
  const link = trimmed !== "" && isYouTubeLinkInput(trimmed);
  // null = unlimited / exempt (no counter); 0 = at the limit.
  const remaining = ordersRemaining(rules, orderLimit.mine, orderLimit.exempt);

  // Suggest-as-you-type: debounced; the cleanup aborts the in-flight request on every keystroke.
  useEffect(() => {
    if (!trimmed || isYouTubeLinkInput(trimmed) || skipSuggestFor.current === trimmed) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      fetchSuggestions(trimmed, ctrl.signal)
        .then((list) => { setSuggestions(list); setShowSuggest(list.length > 0); setActiveIdx(-1); })
        .catch(() => { /* aborted by a newer keystroke */ });
    }, SUGGEST_DEBOUNCE_MS);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [trimmed]);

  useEffect(() => () => {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    searchCtrl.current?.abort();
  }, []);

  function closeSuggest() { setShowSuggest(false); setActiveIdx(-1); }

  function onInputChange(value: string) {
    setInput(value);
    setError(null);
    const t = value.trim();
    if (!t) setSearch(null);                         // clearing the box closes the results panel
    if (!t || isYouTubeLinkInput(t)) { setSuggestions([]); closeSuggest(); }
  }

  async function runSearch(query: string) {
    skipSuggestFor.current = query;
    setSuggestions([]); closeSuggest();
    setError(null); setNotice(null);
    searchCtrl.current?.abort();
    const ctrl = new AbortController();
    searchCtrl.current = ctrl;
    setSearching(true);
    try {
      const res = await fetchSearchResults(query, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setSearch({ id: ++searchSeq.current, query, results: res.results, continuation: res.continuation });
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError("Không tìm được, thử lại nhé.");
    } finally {
      if (searchCtrl.current === ctrl) setSearching(false);
    }
  }

  function pick(text: string) { setInput(text); void runSearch(text); }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (showSuggest) closeSuggest(); else setSearch(null);
      return;
    }
    if (!showSuggest || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx((i) => (i + 1) % suggestions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx((i) => (i <= 0 ? suggestions.length - 1 : i - 1)); }
    else if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); pick(suggestions[activeIdx].text); }
  }

  function onBlur() { blurTimer.current = setTimeout(() => closeSuggest(), BLUR_CLOSE_MS); }
  function onFocus() {
    if (blurTimer.current) clearTimeout(blurTimer.current);
    if (suggestions.length > 0) setShowSuggest(true);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = trimmed;
    if (!text) return;
    if (!isYouTubeLinkInput(text)) { await runSearch(text); return; }

    // Link path — unchanged from v5.
    setError(null);
    setNotice(null);
    const videoId = parseYouTubeId(text);
    const playlistId = parsePlaylistId(text);
    if (!videoId && !playlistId) { setError("Link YouTube không hợp lệ."); return; }
    const limitViolation = orderLimitViolation(rules, orderLimit.mine, orderLimit.exempt);
    if (limitViolation) { setError(ruleMessage(limitViolation)); return; }
    setBusy(true);
    try {
      if (!videoId && playlistId) {
        const items = await fetchPlaylistItems(playlistId);
        if (items.length === 0) { setError("Playlist trống hoặc không đọc được."); return; }

        const dedupe = deduplicatePlaylistItems(items, queue, currentVideoId, history, 20);
        const totalDuplicates = dedupe.internalDuplicates + dedupe.queueDuplicates + dedupe.historyDuplicates;

        if (dedupe.validItems.length === 0) {
          if (dedupe.queueDuplicates > 0 && dedupe.historyDuplicates === 0) {
            setError("Tất cả bài trong playlist đều đã có trong hàng chờ hoặc đang phát.");
          } else if (dedupe.historyDuplicates > 0 && dedupe.queueDuplicates === 0) {
            setError("Tất cả bài trong playlist đều vừa mới phát gần đây.");
          } else {
            setError("Tất cả bài trong playlist đều đã có trong hàng chờ hoặc vừa mới phát.");
          }
          return;
        }

        const validCandidates = dedupe.validItems;
        const added = await addQueueItems(
          roomId,
          token,
          validCandidates.map((it) => ({
            videoId: it.videoId,
            title: it.title,
            thumb: it.thumb,
            duration: it.durationSeconds,
          })),
        );
        // The RPC skips the same rule violators the client mirror would; inserting FEWER than the rule-valid items
        // means the order limit stopped it (the DB count is fresher than `remaining` — e.g. another tab added meanwhile).
        const validAfterRules = validCandidates.filter((it) => !checkQueueRules(rules, { title: it.title, durationSeconds: it.durationSeconds })).length;
        const hitLimit = remaining !== null && added < validAfterRules;
        const skippedRules = hitLimit ? validCandidates.length - validAfterRules : validCandidates.length - added;

        const noticeParts: string[] = [];
        if (hitLimit) {
          noticeParts.push(`Đã thêm ${added}/${items.length} bài — đạt giới hạn ${rules.max_orders_per_member} order.`);
        } else {
          noticeParts.push(`Đã thêm ${added} bài từ playlist.`);
        }

        const skipReasons: string[] = [];
        if (totalDuplicates > 0) {
          skipReasons.push(`${totalDuplicates} bài trùng lặp`);
        }
        if (skippedRules > 0) {
          skipReasons.push(`${skippedRules} bài quá dài/từ khóa cấm`);
        }
        if (skipReasons.length > 0) {
          noticeParts.push(`Bỏ qua ${skipReasons.join(", ")}.`);
        }
        if (willPend && added > 0) {
          noticeParts.push("Đã gửi, chờ Admin/DJ duyệt.");
        }

        setNotice(noticeParts.join(" "));
        setInput("");
      } else if (videoId) {
        const dup = checkDuplicateTrack(videoId, queue, currentVideoId, history, 20);
        if (dup) {
          setError(duplicateMessage(dup));
          return;
        }

        // Watch page first (has the duration); oEmbed fallback keeps title/thumb but no duration.
        const details = await fetchVideoDetails(videoId);
        const meta = details ? null : await fetchVideoMeta(videoId);
        const title = details?.title || meta?.title || videoId;
        const thumb = details ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : (meta?.thumbnail ?? null);
        const duration = details?.durationSeconds ?? null;
        const violation = checkQueueRules(rules, { title, durationSeconds: duration });
        if (violation) { setError(ruleMessage(violation)); return; }
        await addQueueItem(roomId, token, { videoId, title, thumb, duration });
        if (willPend) setNotice("Đã gửi, chờ Admin/DJ duyệt.");
        setInput("");
      }
    } catch (err) {
      const violation = violationFromRpcError(err, rules);
      setError(violation ? ruleMessage(violation) : ((err as { message?: string }).message ?? "Không thêm được bài."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative mb-1">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          {/* Prefix icon: Link or Search */}
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink/40">
            {link ? "🔗" : "🔍"}
          </span>

          <input
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={onBlur}
            onFocus={onFocus}
            placeholder="Tìm bài hát hoặc dán link YouTube…"
            autoComplete="off"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showSuggest && suggestions.length > 0}
            aria-controls="addsong-suggest-list"
            aria-activedescendant={showSuggest && activeIdx >= 0 ? `addsong-suggest-${activeIdx}` : undefined}
            className="w-full rounded-lg border border-gold/70 bg-cream pl-8 pr-8 py-2 text-sm text-ink shadow-2xs transition-all placeholder:text-ink/40 focus:border-burgundy focus:ring-1 focus:ring-burgundy/30 outline-none"
          />

          {/* Clear input button */}
          {input.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setInput("");
                setSearch(null);
                setSuggestions([]);
                closeSuggest();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-xs text-ink/40 hover:text-burgundy hover:bg-gold-200/30 transition-colors"
              title="Xóa nội dung"
              aria-label="Xóa nội dung tìm kiếm"
            >
              ✕
            </button>
          )}

          {/* Autocomplete Suggestions Dropdown */}
          {showSuggest && suggestions.length > 0 && (
            <ul
              role="listbox"
              id="addsong-suggest-list"
              className="absolute left-0 right-0 top-full z-40 mt-1.5 overflow-hidden rounded-xl border-2 border-gold bg-cream/95 shadow-xl backdrop-blur-md divide-y divide-gold-200/40"
            >
              {suggestions.map((s, i) => (
                <li
                  key={s.text}
                  role="option"
                  id={`addsong-suggest-${i}`}
                  aria-selected={i === activeIdx}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(s.text);
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-ink transition-colors ${
                    i === activeIdx ? "bg-gold-200/40 text-burgundy font-medium" : "hover:bg-gold-200/20"
                  }`}
                >
                  <span className="text-xs text-gold-600">🔍</span>
                  {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb */}
                  {s.thumb && <img src={s.thumb} alt="" className="h-6 w-9 rounded object-cover shadow-2xs shrink-0" />}
                  <span className="truncate flex-1">{s.text}</span>
                  <span className="text-[10px] text-ink/40">↵</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          disabled={busy || searching || (link && remaining === 0)}
          title={
            link && remaining === 0
              ? ruleMessage({ code: "order_limit", max: rules.max_orders_per_member })
              : undefined
          }
          className="flex items-center gap-1.5 rounded-lg border border-gold bg-burgundy px-3.5 py-2 font-cormorant text-sm font-bold text-cream shadow-xs transition-all hover:bg-burgundy-accent hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:scale-100"
        >
          {busy || searching ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-cream border-t-transparent" />
          ) : link ? (
            <span>+ Thêm</span>
          ) : (
            <span>Tìm</span>
          )}
        </button>

        {remaining !== null && (
          <span
            className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-semibold tracking-wide transition-colors ${
              remaining === 0
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-gold-200/80 bg-cream/70 text-ink/70"
            }`}
            title="Số bài bạn đang đặt / giới hạn của phòng"
          >
            Order: {orderLimit.mine}/{rules.max_orders_per_member}
          </span>
        )}

        {error && (
          <p className="w-full text-xs font-medium text-burgundy-accent bg-red-50/80 border border-red-200/60 rounded-md px-2.5 py-1 flex items-center gap-1">
            <span>⚠️</span>
            <span>{error}</span>
          </p>
        )}
        {notice && (
          <p className="w-full text-xs font-medium text-green-800 bg-green-50/80 border border-green-200/60 rounded-md px-2.5 py-1 flex items-center gap-1">
            <span>✓</span>
            <span>{notice}</span>
          </p>
        )}
      </form>

      {/* Floating Overlay Search Results */}
      {search && (
        <SearchResults
          key={search.id}
          query={search.query}
          results={search.results}
          continuation={search.continuation}
          roomId={roomId}
          token={token}
          rules={rules}
          willPend={willPend}
          orderLimit={orderLimit}
          queue={queue}
          currentVideoId={currentVideoId}
          history={history}
          onClose={() => setSearch(null)}
        />
      )}
    </div>
  );
}
