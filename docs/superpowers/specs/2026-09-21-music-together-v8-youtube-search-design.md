# Music Together v8 — In-app YouTube Search (Design)

**Date:** 2026-09-21
**Builds on:** v7 (merged to `main`). Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth, SECURITY DEFINER RPCs.

## 1. Goal

Let room members **search YouTube by keywords** from the existing "add song" box instead of having to paste a link:

- While typing, show YouTube's own **query suggestions** (the same suggest feed youtube.com uses; some entries carry a video thumbnail).
- On Enter, run a YouTube **video search** and show a result list (thumb · title · channel · duration) with a per-row "+ Thêm" button that enqueues the video.
- Pasting a link keeps working exactly as before (single video / playlist).

Done **key-free** (no YouTube Data API key), by proxying two public YouTube endpoints through Next route handlers — the same pattern as `/api/oembed` and `/api/playlist`.

## 2. Constraints (carried from v1–v7)

- **No YouTube Data API key** is configured and none will be added. Search must use YouTube's public, keyless endpoints.
- **Server just relays:** YouTube requests happen in Next route handlers (server-side) to avoid CORS and keep the YouTube request off the client. Parsing lives in **pure, unit-tested functions**; the route is a thin wrapper.
- **No user credentials:** the reference requests were captured from a logged-in browser and carried session cookies and `SAPISIDHASH` headers. These are **not needed** and **must not be used** — both endpoints work anonymously. No `tok`, `authuser`, `gs_id`, `cp`, cookies, or `authorization`.
- **Public DB / RPC auth unchanged:** enqueueing still goes through `add_queue_item` (member-only). No migration.
- **Theming:** UI uses existing color tokens only (`cream`, `gold`, `ink`, `burgundy` …) so both Salon and Pixel themes render correctly with no new CSS.
- **Repo is public:** no secrets committed.

## 3. Server — `GET /api/yt/suggest?q=…`

**File:** `app/api/yt/suggest/route.ts` (new).

- **Validate:** `q = (searchParams.get("q") ?? "").trim()`. If `q` is empty or longer than 100 chars → respond `200 { suggestions: [] }` without calling YouTube. (For an anonymous caller, an empty query only ever returns personal history, which we do not have.)
- **Upstream:** `GET https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&hl=vi&gl=vn&gs_ri=youtube&q={encoded q}`. Headers: desktop `User-Agent` (same constant as the playlist route), `Accept-Language: vi,en;q=0.8`. `signal: AbortSignal.timeout(5000)`, `next: { revalidate: 3600 }`.
- **Parse:** `parseSuggestJsonp(text)` (§5). Response `200 { suggestions: Suggestion[] }`.
- **Failure policy:** any network/timeout/parse failure → `200 { suggestions: [] }`. Suggestions are a convenience; the client never needs to show a suggest error.

## 4. Server — `GET /api/yt/search?q=…`

**File:** `app/api/yt/search/route.ts` (new).

- **Validate:** trim; empty or > 100 chars → `400 { error: "Invalid query" }`.
- **Upstream:** `POST https://www.youtube.com/youtubei/v1/search?prettyPrint=false` with body

  ```json
  {
    "context": { "client": { "hl": "vi", "gl": "VN", "clientName": "WEB", "clientVersion": "2.20260918.00.00" } },
    "query": "<q>",
    "params": "EgIQAQ=="
  }
  ```

  `params: "EgIQAQ=="` is YouTube's **Type = Video** filter, so the result set contains only videos (no channels / playlists / shelves of mixed content).
  Headers: `Content-Type: application/json`, desktop `User-Agent`, `Accept-Language: vi,en;q=0.8`, `X-YouTube-Client-Name: 1`, `X-YouTube-Client-Version: 2.20260918.00.00`, `Origin: https://www.youtube.com`, `Cookie: CONSENT=YES+1` (skips the consent interstitial a cookieless datacenter request may get — same trick as the playlist route). `signal: AbortSignal.timeout(8000)`, `next: { revalidate: 600 }`.
  No `key` query param (InnerTube accepts requests without it today). If YouTube starts requiring one, the public WEB client key that is embedded in every youtube.com page (not a secret) can be added as `?key=…` — noted here, **not** implemented now.
- **Parse:** `extractSearchResults(json, 20)` (§5). Response `200 { results: SearchResult[] }` (an empty list is a valid 200).
- **Failure policy:** non-OK upstream / timeout / JSON parse error → `502 { error: "Search failed" }`.

The `clientVersion` string is a constant in the route file (`INNERTUBE_CLIENT_VERSION`) so it can be bumped in one place.

## 5. Pure parsers (unit-tested)

### 5.1 `lib/youtube/suggest.ts`

```ts
export interface Suggestion { text: string; videoId?: string; thumb?: string }
export function parseSuggestJsonp(text: string, cap = 10): Suggestion[]
```

The upstream body is JSONP: `window.google.ac.h(["<q>", [[text, type, flags, {zai, zaj, zak, zal, zam?}], …], {…}])`.

- Strip the callback wrapper: take the substring from the first `(` after `window.google.ac.h` to the last `)`; `JSON.parse` it. Wrapper missing / JSON invalid / shape unexpected → `[]`.
- `payload[1]` is the suggestion array. For each entry: `text = entry[0]` (must be a non-empty string, else skip); the optional 4th element may carry `zal` (video id) and `zai` (thumbnail URL). Emit `{ text, videoId?: zal, thumb?: zai }` — only include `videoId`/`thumb` when they are non-empty strings.
- Dedupe by `text` (case-insensitive, trimmed); stop at `cap`.

### 5.2 `lib/youtube/search.ts`

```ts
export interface SearchResult {
  videoId: string; title: string; channel: string;
  durationText: string | null; durationSeconds: number | null; thumb: string;
}
export function parseDurationText(s: string | null | undefined): number | null
export function extractSearchResults(data: unknown, cap = 20): SearchResult[]
```

- `parseDurationText`: accepts `"m:ss"`, `"mm:ss"`, `"h:mm:ss"` (digits and colons only, 2–3 groups). Returns total seconds; anything else (`"LIVE"`, `""`, `undefined`, non-numeric) → `null`.
- `extractSearchResults`: recursive walk of the InnerTube JSON (same style as `extractPlaylistItems`). Whenever a node has a `videoRenderer` object:
  - `videoId` = `videoRenderer.videoId` (string, else skip the node);
  - `title` = `title.runs[0].text` (fallback `title.simpleText`, fallback `""`);
  - `channel` = `ownerText.runs[0].text` (fallback `longBylineText.runs[0].text`, fallback `""`);
  - `durationText` = `lengthText.simpleText` or `null`; `durationSeconds = parseDurationText(durationText)`;
  - `thumb` = `https://i.ytimg.com/vi/{videoId}/mqdefault.jpg` (derived from the id — always exists, 320×180 suits a list row; avoids depending on the signed thumbnail URLs YouTube returns).
  Do **not** descend into a `videoRenderer` once handled. Skip `null`/non-object nodes. Dedupe by `videoId`, stop at `cap`. Any throw → `[]`.

### 5.3 Client wrappers (same files)

```ts
export async function fetchSuggestions(q: string, signal?: AbortSignal): Promise<Suggestion[]>   // lib/youtube/suggest.ts
export async function fetchSearchResults(q: string, signal?: AbortSignal): Promise<SearchResult[]> // lib/youtube/search.ts
```

Call the same-origin routes. `fetchSuggestions` resolves `[]` on any non-OK response (never throws except `AbortError`). `fetchSearchResults` throws `Error(body.error ?? "Không tìm được")` on non-OK, mirroring `fetchPlaylistItems`. Both re-throw `AbortError` so callers can ignore stale requests.

## 6. UI

### 6.1 `components/room/AddSong.tsx` (modify)

One input. On **submit**, classify the trimmed text with `parseYouTubeId` / `parsePlaylistId`:

- match → existing single-video / playlist add path, **unchanged**;
- no match → `runSearch(text)`.

**Bare-id refinement:** `parseYouTubeId` also accepts a bare 11-char id (`[A-Za-z0-9_-]{11}`), which now collides with ordinary 11-letter search words (`nhacsontung`). A *bare* string counts as a link only if it contains at least one non-lowercase-letter character (digit, uppercase, `_`, `-`); a purely lowercase 11-letter word is searched. Real URLs are always links. This lives in one helper, `isLink(s)`, used for both submit classification and the button label.

Placeholder becomes `"Tìm bài hoặc dán link YouTube…"`. The submit button's label follows the same classification of the *current* input: link → `+ Thêm`, anything else → `Tìm`; while `busy || searching` → `…` (disabled).

**State:** `input`, `suggestions: Suggestion[]`, `activeIdx: number` (-1 = none), `showSuggest: boolean`, `search: { query: string; results: SearchResult[] } | null`, `searching: boolean`, plus the existing `busy` / `error` / `notice`.

**Suggest-as-you-type:**
- `useEffect` on `input`: if the input looks like a link (`parseYouTubeId || parsePlaylistId`) or is empty → clear suggestions and return. Otherwise debounce **250 ms**, then `fetchSuggestions(input, controller.signal)`; the effect's cleanup clears the timer and aborts the in-flight request, so fast typing never shows stale lists. Result → `setSuggestions`, `setShowSuggest(true)`, `activeIdx = -1`.
- Dropdown: `absolute left-0 right-0 top-full z-20 mt-1` inside a `relative` wrapper around the input; `rounded-lg border border-gold bg-cream shadow`; up to 10 rows, each `flex items-center gap-2 px-3 py-1.5 text-sm text-ink`; active row `bg-parchment-200`. A row shows a `h-6 w-8 rounded object-cover` thumb when `thumb` is set, then the text. Rendered only when `showSuggest && suggestions.length > 0`.
- Keyboard (on the input): `ArrowDown`/`ArrowUp` move `activeIdx` (wrapping, `preventDefault`); `Enter` with `activeIdx >= 0` → set input to that suggestion's text and search it (else the form submits normally); `Escape` → close dropdown; if none open, close the results panel.
- Mouse: `onMouseDown` on a row (`preventDefault` so the input keeps focus) → set input + `runSearch(text)`. `onBlur` on the input → `setShowSuggest(false)` after a 150 ms timeout (cleared on unmount) so a click on a row still lands. `onFocus` → re-open if suggestions exist.
- Clicking a suggestion **always searches**, even when it carries a `videoId` — predictable, mirrors youtube.com.

**`runSearch(query)`:** close the dropdown, `setSearching(true)`, `setError(null)`; abort any previous search; `fetchSearchResults` → `setSearch({ query, results })`. Errors → `setError("Không tìm được, thử lại nhé.")`. `finally` → `setSearching(false)`.

**Results panel:** rendered below the form when `search !== null` — `<SearchResults …>` (§6.2). Closed by its ✕ button, by `Escape` (when no dropdown is open), or automatically when the input is cleared to empty. A new search replaces the previous results.

### 6.2 `components/room/SearchResults.tsx` (new)

```ts
export default function SearchResults({ query, results, roomId, token, onClose }: {
  query: string; results: SearchResult[]; roomId: string; token: string; onClose: () => void;
})
```

- Header: `Kết quả cho "{query}" · {results.length}` (font-cormorant, `text-burgundy`) + a ✕ button (`title="Đóng"`).
- `results.length === 0` → `"Không có kết quả."`.
- List `max-h-[40vh] overflow-y-auto pr-1`; rows `flex items-center gap-2 border-b border-dotted border-gold-200 py-2`: thumb `h-9 w-12 rounded object-cover` (matches queue rows) · `min-w-0 flex-1` with `truncate text-sm text-ink` title and `text-[11px] text-gold` `{channel} · {durationText}` (omit the ` · …` when `durationText` is null) · action button.
- **Per-row add state** (`Record<videoId, "idle" | "busy" | "done" | "error">`): idle → button `+ Thêm` (`rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy`, same as queue buttons); busy → `Spinner` (copy the tiny spinner from `Queue.tsx` into this file — two-line component, not worth a shared module yet) and the row `opacity-60`; done → button text `✓ Đã thêm`, disabled; error → button back to `+ Thêm` and a `text-[11px] text-burgundy-accent` message under the row (`"Không thêm được."`).
- Add = `addQueueItem(roomId, token, { videoId, title: title || videoId, thumb, duration: durationSeconds })`. The panel **stays open** after an add so several songs can be queued in a row. When the `results` prop changes (new search) the add-state map resets.

### 6.3 `components/room/RoomShell.tsx` (modify)

Delete the placeholder line `🔎 Ô tìm kiếm trong app: bật khi cấu hình API key (Phase 2)` (line 45). Nothing else changes; `AddSong` keeps its props.

### 6.4 Permissions

Unchanged: `AddSong` is rendered for every member, and `add_queue_item` enforces membership server-side. Search is available to everyone who can add.

## 7. Error handling

| Where | Failure | Behaviour |
|---|---|---|
| `/api/yt/suggest` | bad/empty `q`, upstream error, parse error | `200 { suggestions: [] }` — silent |
| `/api/yt/search` | bad `q` | `400 { error }` → client message |
| `/api/yt/search` | upstream non-OK / timeout / bad JSON | `502 { error }` → `"Không tìm được, thử lại nhé."` |
| `/api/yt/search` | 0 videos | `200 { results: [] }` → `"Không có kết quả."` in the panel |
| suggest fetch (client) | aborted by newer keystroke | ignored (AbortError) |
| add from results | RPC error | row state `error`, message under the row, button re-enabled |

Both routes are unauthenticated like `/api/playlist`; abuse surface is limited by the 100-char query cap and `revalidate` caching. No extra rate limiting in v8.

## 8. Testing

- **Unit** (`tests/unit/`, vitest, no network):
  - `suggest.test.ts` — `parseSuggestJsonp`: real-shaped JSONP with the `window.google.ac.h(` wrapper → texts in order, `videoId`/`thumb` present only for entries with `zal`/`zai`; entries missing text skipped; duplicate texts collapsed; `cap` respected; garbage / missing wrapper / non-array payload → `[]`.
  - `search.test.ts` — `parseDurationText`: `"4:32"`→272, `"1:02:15"`→3735, `"0:59"`→59, `"LIVE"`/`""`/`undefined`/`"4"`→`null`. `extractSearchResults`: a trimmed InnerTube-shaped fixture with `videoRenderer`s under `itemSectionRenderer` **and** inside a `shelfRenderer`, one with no `lengthText` (→ `durationSeconds: null`), one with no `videoId` (skipped), a duplicate id (collapsed), a `channelRenderer` sibling (ignored); `cap` respected; `null`/string input → `[]`.
- **Manual** (dev server): type "nếu như ta chẳng còn" → suggestions appear, ↑/↓/Enter/Esc work, click adds a row to the queue in both themes; paste a video link and a playlist link → old behaviour intact.
- Routes' live fetches are not unit-tested (covered by the pure parsers + manual run), matching the v5 precedent.

## 9. File map (v8)

```
app/api/yt/suggest/route.ts        # CREATE: GET ?q= → suggest JSONP proxy, cap 10, soft-fail []
app/api/yt/search/route.ts         # CREATE: GET ?q= → InnerTube search proxy (video filter), cap 20
lib/youtube/suggest.ts             # CREATE: Suggestion, parseSuggestJsonp (pure), fetchSuggestions (client)
lib/youtube/search.ts              # CREATE: SearchResult, parseDurationText, extractSearchResults (pure), fetchSearchResults (client)
components/room/SearchResults.tsx  # CREATE: results panel with per-row add state
components/room/AddSong.tsx        # MODIFY: smart input — link → add, text → suggest + search
components/room/RoomShell.tsx      # MODIFY: remove "Phase 2" placeholder line
tests/unit/suggest.test.ts         # CREATE
tests/unit/search.test.ts          # CREATE
README.md                          # MODIFY: v8 section
```

## 10. Phasing (for the plan)

1. **Parsers + tests:** `parseDurationText`, `extractSearchResults`, `parseSuggestJsonp` (TDD).
2. **Routes + client wrappers:** `/api/yt/search`, `/api/yt/suggest`, `fetchSearchResults`, `fetchSuggestions`; verify against live YouTube from the dev server.
3. **UI:** `SearchResults`, `AddSong` suggest dropdown + search flow, `RoomShell` cleanup; manual check in both themes.
4. **Docs:** README v8 section.

## 11. Out of scope (YAGNI / future)

- Pagination / "load more" (InnerTube continuation tokens) — 20 results is enough for a music room.
- Searching playlists or channels; adding a whole playlist from search results.
- Quick-add straight from a suggestion that carries a `videoId` (suggestion click always searches).
- Rate limiting or auth on the two proxy routes.
- Locale selection (`hl`/`gl` are fixed to `vi`/`VN`).
- Persisting recent searches.
