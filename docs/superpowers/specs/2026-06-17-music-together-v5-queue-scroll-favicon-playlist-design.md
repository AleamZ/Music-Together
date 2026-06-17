# Music Together v5 — Queue Scroll, Logo Favicon & Playlist Add (Design)

**Date:** 2026-06-17
**Builds on:** v4 (merged to `main`). Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth, SECURITY DEFINER RPCs.

## 1. Goal

Three updates to the room experience:

1. **Queue scroll** — the right-hand queue column grows without bound and pushes the page layout down. Cap its height and scroll inside it.
2. **Logo favicon** — use `public/logo.png` as the browser-tab icon instead of the default `app/favicon.ico`.
3. **Playlist add** — when the user adds a YouTube **playlist** link, enqueue all of the playlist's videos (not just one). Done with **no API key** (read the public playlist page server-side), capped at 50 videos, via a batch insert RPC.

## 2. Constraints (carried from v1–v4)

- **No YouTube Data API key** is configured, and none will be added — playlist enumeration must work key-free.
- **Public DB:** all writes go through SECURITY DEFINER RPCs authorized by `_auth(room, session, role)`; `'any'` = membership only. Data tables are public-SELECT; secrets are policy-less.
- **Client-heavy / "server just relays":** the playlist page fetch happens in a Next route handler (server-side) to dodge CORS and keep the YouTube request off the client.
- **Realtime is full-state refetch:** `subscribeRoom` refetches the whole room on every `queue_items`/`rooms`/`members` change. A batch insert of N rows fires N change events → N refetches; this design adds a small debounce so a burst collapses to ~1 refetch.
- **Additive migration** `0007_v5_batch_queue.sql` (`create or replace function` only — no table/column changes). No data drop.
- **Repo is public:** no secrets committed.

## 3. Feature A — Queue scroll

**File:** `components/room/Queue.tsx`. Today the list `<ul>` (the container holding `upcoming.map(...)`) has no height cap; in `RoomShell.tsx` the right `<section>` has no overflow styling, so a long queue stretches the page.

**Change:** wrap the scrolling list region in a fixed-max-height, vertically-scrolling container — `max-h-[65vh] overflow-y-auto` on the `<ul>` (keep the "Hàng đợi · N bài" header outside the scroll area so it stays visible). Drag-to-reorder, bump-to-top, and delete continue to work on the full list (scroll, not pagination, so cross-item drag is preserved). Add a thin scrollbar styling consistent with the salon look only if trivial; otherwise default scrollbar is fine.

No prop or logic changes — purely the list container's CSS.

## 4. Feature B — Logo favicon

**Files:** `app/layout.tsx` (modify), `app/favicon.ico` (delete).

`public/logo.png` exists (~3:2, ~2.5MB). Wire it as the tab icon via the Next.js Metadata API:

```ts
export const metadata: Metadata = {
  title: "Music Together — Phòng nghe nhạc",
  description: "Cùng nhau chọn và nghe nhạc YouTube trong một phòng nghe cổ điển.",
  icons: { icon: "/logo.png", shortcut: "/logo.png", apple: "/logo.png" },
};
```

Delete `app/favicon.ico` so the default Next favicon no longer competes; `/logo.png` (served from `public/`) becomes the only icon. 

**Known caveat (documented, not fixed now):** `logo.png` is ~2.5MB — heavier than a favicon should be. A follow-up could add a resized 64×64 `app/icon.png`. For v5 we honor the explicit request to use `logo.png`.

## 5. Feature C — Playlist add (key-free)

### 5.1 Playlist-id parsing
`lib/youtube/parse.ts` gains `parsePlaylistId(input: string): string | null` — extracts the `list` query param from a YouTube URL (any host variant). Returns the id, or `null` if absent. (The existing `parseYouTubeId` already strips `list=` and returns the `v` id; the two are used together to classify a pasted link.)

**Classification in `AddSong`:** for a pasted string, compute `videoId = parseYouTubeId(s)` and `playlistId = parsePlaylistId(s)`.
- `videoId` present → **single-video add** (existing behavior), even if `playlistId` is also present (a watch link copied mid-playlist). This avoids surprise bulk-adds.
- `videoId` absent **and** `playlistId` present → **playlist add**.
- neither → existing "invalid link" handling.

### 5.2 Server route — enumerate playlist items (no key)
New `app/api/playlist/route.ts`: `GET /api/playlist?list={playlistId}`.
- Fetches `https://www.youtube.com/playlist?list={playlistId}&hl=en` with a desktop `User-Agent` header (server-side; avoids CORS and the consent interstitial where possible).
- Extracts the `ytInitialData` JSON embedded in the HTML and maps each `playlistVideoRenderer` to `{ videoId, title, thumb }`.
- Returns `{ items: Array<{ videoId, title, thumb }> }` capped at **50**, or a non-200 `{ error }` on failure (empty/blocked/parse-fail).
- Short `Cache-Control` (e.g. 1h) like the oembed route.

**Pure, testable core:** the HTML→items logic lives in an exported pure function `extractPlaylistItems(html: string, cap = 50): Array<{ videoId: string; title: string; thumb: string }>` in `lib/youtube/playlist.ts` (the route imports it), so it can be unit-tested against a captured HTML fixture without network. It:
- locates `ytInitialData` (handles both `var ytInitialData = {...};` and `ytInitialData = {...};</script>` forms) and `JSON.parse`s the object;
- walks to the playlist video list, collects entries that have a `playlistVideoRenderer.videoId`, reading `title` from `title.runs[0].text` (fallback `title.simpleText`) and `thumb` from the largest `thumbnail.thumbnails[*].url` (fallback `https://i.ytimg.com/vi/{id}/hqdefault.jpg`);
- skips non-video entries (e.g. `continuationItemRenderer`) and stops at `cap`.

It must fail soft: any parse error → return `[]` (the route then responds with an error status if empty).

### 5.3 Client helper
`lib/youtube/playlist.ts` exports `fetchPlaylistItems(listId: string): Promise<Array<{ videoId: string; title: string; thumb: string }>>` — calls `/api/playlist?list=…`, returns `items` (or throws on non-200 so the UI can show an error).

### 5.4 Batch insert RPC
`0007_v5_batch_queue.sql` adds:

```
add_queue_items(p_room_id uuid, p_session_token text, p_items jsonb) returns int
```
SECURITY DEFINER, `set search_path = public, extensions`:
- `perform public._auth(p_room_id, p_session_token, 'any')` (member-only); `v_account := public._auth_account(...)`; `v_name := accounts.username`.
- Compute starting position `coalesce(max(position),0)+1` for the room.
- Iterate `jsonb_array_elements(p_items)` (with `ordinality` to assign increasing positions), inserting `(room_id, youtube_video_id, title, thumbnail_url, duration_seconds=null, added_by_account_id, added_by_name, position)` for each element `{video_id, title, thumb}`. Skip elements missing `video_id`. Cap defensively at 50 inside the function too.
- Return the count inserted.
- Grant execute to `anon, authenticated`.

`lib/supabase.ts` adds `addQueueItems(roomId, token, items: Array<{ videoId; title; thumb }>)` → maps to `{ video_id, title, thumb }` JSON and calls the RPC; throws on error.

### 5.5 Realtime debounce
`lib/realtime.ts` `subscribeRoom`: wrap `refresh` in a trailing debounce (~150ms) so a burst of N inserts (or any rapid change burst) collapses into ~1 refetch. The debounce timer is cleared on unsubscribe. Behavior is otherwise unchanged (still full-state refetch, last-write-wins via the existing `cancelled` guard).

### 5.6 AddSong UX
`components/room/AddSong.tsx`: on submit, classify the input (5.1).
- Playlist → set a "busy" state, `fetchPlaylistItems`, then `addQueueItems`; on success show "Đã thêm N bài"; on failure show a friendly message ("Không đọc được playlist, thử lại hoặc dán từng video."). Disable the button while busy.
- Single video → unchanged path (`fetchVideoMeta` + `addQueueItem`).
- Keep the existing input + button; no layout overhaul.

## 6. Error handling
- Playlist route: network/parse/empty → non-200 `{ error }`; client surfaces a friendly VN message; no crash.
- `add_queue_items`: RPC throws on auth/validation; UI catches. Empty `p_items` → inserts 0, returns 0 (UI: "Không có bài nào để thêm").
- Favicon/queue-scroll: pure config/CSS, no runtime error surface.

## 7. Testing
- **Unit** (`tests/unit/`):
  - `parsePlaylistId`: extracts `list` from watch+list, pure playlist URL, `youtu.be?...&list=`; returns `null` when absent.
  - `extractPlaylistItems`: against a small captured `ytInitialData`-style HTML fixture → returns the expected `{videoId,title,thumb}[]`, respects `cap`, skips non-video entries, returns `[]` on garbage input.
- **Integration** (`tests/integration/`, skips without `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`):
  - `add_queue_items`: a member adds 3 items → returns 3, items appear with increasing positions after the room's existing max; a non-member is rejected ("not a member"); empty array → returns 0.
- The `/api/playlist` route's live network fetch is **not** unit-tested (covered by the pure `extractPlaylistItems` + manual testing).

## 8. File map (v5)
```
components/room/Queue.tsx        # MODIFY: max-h + overflow-y-auto on the list (A)
app/layout.tsx                   # MODIFY: metadata.icons → /logo.png (B)
app/favicon.ico                  # DELETE (B)
lib/youtube/parse.ts             # MODIFY: add parsePlaylistId (C)
lib/youtube/playlist.ts          # CREATE: extractPlaylistItems (pure) + fetchPlaylistItems (client) (C)
app/api/playlist/route.ts        # CREATE: GET ?list= → enumerate items, cap 50 (C)
supabase/migrations/0007_v5_batch_queue.sql  # CREATE: add_queue_items RPC + grant (C)
lib/supabase.ts                  # MODIFY: addQueueItems wrapper (C)
lib/realtime.ts                  # MODIFY: debounce subscribeRoom refresh (C)
components/room/AddSong.tsx      # MODIFY: detect playlist, batch-add (C)
tests/unit/playlist.test.ts      # CREATE: parsePlaylistId + extractPlaylistItems
tests/integration/v5.test.ts     # CREATE: add_queue_items
```

## 9. Phasing (for the plan)
1. **Phase 1 — small UI:** A (queue scroll) + B (favicon).
2. **Phase 2 — playlist:** parse + route + `extractPlaylistItems` + batch RPC migration + `addQueueItems` wrapper + realtime debounce + AddSong UI + tests.

## 10. Out of scope (YAGNI / future)
- YouTube Data API integration / search-in-app (still gated on a key).
- Per-video duration parsing for playlist items (stored NULL, like single-add today).
- Playlists beyond the first ~100 page items / >50 cap; private/Watch-Later/Mix (RD/LM/WL) lists.
- A choice UI for "add this video vs add whole playlist" on watch+list links (default: single video).
- A resized small favicon (`app/icon.png`).
