"use client";

import { useEffect, useRef, useState } from "react";
import { addQueueItem, addQueueItems } from "@/lib/supabase";
import { parseYouTubeId, parsePlaylistId, isYouTubeLinkInput } from "@/lib/youtube/parse";
import { fetchVideoMeta } from "@/lib/youtube/meta";
import { fetchPlaylistItems } from "@/lib/youtube/playlist";
import { fetchSuggestions, type Suggestion } from "@/lib/youtube/suggest";
import { fetchSearchResults, type SearchResult } from "@/lib/youtube/search";
import SearchResults from "./SearchResults";

const SUGGEST_DEBOUNCE_MS = 250;
const BLUR_CLOSE_MS = 150;

type Search = { id: number; query: string; results: SearchResult[] };

export default function AddSong({ roomId, token }: { roomId: string; token: string }) {
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
      const results = await fetchSearchResults(query, ctrl.signal);
      if (ctrl.signal.aborted) return;
      setSearch({ id: ++searchSeq.current, query, results });
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
    setBusy(true);
    try {
      if (!videoId && playlistId) {
        const items = await fetchPlaylistItems(playlistId);
        if (items.length === 0) { setError("Playlist trống hoặc không đọc được."); return; }
        const added = await addQueueItems(roomId, token, items);
        setNotice(`Đã thêm ${added} bài từ playlist.`);
        setInput("");
      } else if (videoId) {
        const meta = await fetchVideoMeta(videoId);
        await addQueueItem(roomId, token, {
          videoId,
          title: meta?.title || videoId,
          thumb: meta?.thumbnail ?? null,
          duration: null,
        });
        setInput("");
      }
    } catch (err) {
      setError((err as { message?: string }).message ?? "Không thêm được bài.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-1">
      <form onSubmit={onSubmit} className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <input value={input} onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown} onBlur={onBlur} onFocus={onFocus}
            placeholder="Tìm bài hoặc dán link YouTube…" autoComplete="off"
            role="combobox" aria-autocomplete="list"
            aria-expanded={showSuggest && suggestions.length > 0}
            aria-controls="addsong-suggest-list"
            aria-activedescendant={showSuggest && activeIdx >= 0 ? `addsong-suggest-${activeIdx}` : undefined}
            className="w-full rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
          {showSuggest && suggestions.length > 0 && (
            <ul role="listbox" id="addsong-suggest-list"
              className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-gold bg-cream shadow">
              {suggestions.map((s, i) => (
                <li key={s.text} role="option" id={`addsong-suggest-${i}`} aria-selected={i === activeIdx}
                  onMouseDown={(e) => { e.preventDefault(); pick(s.text); }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink ${i === activeIdx ? "bg-parchment-200" : ""}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- YouTube CDN thumb; next/image optimization isn't worth its cost here */}
                  {s.thumb && <img src={s.thumb} alt="" className="h-6 w-8 rounded object-cover" />}
                  <span className="truncate">{s.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button disabled={busy || searching}
          className="rounded-lg bg-burgundy px-3 py-2 font-cormorant font-bold text-cream disabled:opacity-60">
          {busy || searching ? "…" : link ? "+ Thêm" : "Tìm"}
        </button>
        {error && <p className="w-full text-xs text-burgundy-accent">{error}</p>}
        {notice && <p className="w-full text-xs text-burgundy">{notice}</p>}
      </form>
      {search && (
        <SearchResults key={search.id} query={search.query} results={search.results}
          roomId={roomId} token={token} onClose={() => setSearch(null)} />
      )}
    </div>
  );
}
