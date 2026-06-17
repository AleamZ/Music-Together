# Music Together v5 Implementation Plan — Queue Scroll, Logo Favicon & Playlist Add

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cap the queue column with an internal scroll, use `public/logo.png` as the browser-tab favicon, and let a pasted YouTube **playlist** link enqueue all its videos (key-free, capped at 50) via a batch RPC.

**Architecture:** Two CSS/config tweaks (queue `max-height`+scroll; `metadata.icons`→logo). For playlists: a pure `extractPlaylistItems(html)` parser + a server route `/api/playlist` that reads the public playlist page (no API key), a batch `add_queue_items` SECURITY DEFINER RPC (migration `0007`), a debounced realtime refresh so a burst of inserts collapses to ~1 refetch, and `AddSong` classifying playlist-vs-video links.

**Tech Stack:** Next.js 16.2.9, React 19, TS 5, Tailwind v4, `@supabase/supabase-js` (Postgres + Realtime), Vitest.

## Global Constraints
- **Next.js 16.2.9** — heed deprecation notices (e.g. `next/image` `priority`→`preload`); Tailwind v4 canonical classes.
- **No YouTube Data API key** — playlist enumeration must be key-free (read the public playlist page server-side).
- **Additive migration only** (`0007`): `create or replace function` — no table/column changes, no data drop.
- **Public repo** — never commit secrets.
- **Room write RPCs** authorize via `public._auth(p_room_id, p_session_token, 'any')` (membership) + `public._auth_account(token)`; SECURITY DEFINER, `set search_path = public, extensions`; grant to `anon, authenticated`.
- **Playlist cap = 50** videos. **Branch:** `feat/v5-playlist` (merge to `main` when done; then run `0007` in Supabase SQL Editor).
- Vitest: `@`→project root, glob `**/*.test.{ts,tsx}`, jsdom, env stubs for `NEXT_PUBLIC_SUPABASE_*` already set.
- Salon tokens (in `app/globals.css`): `burgundy`, `burgundy-accent`, `gold`, `gold-200`, `cream`, `ink`.

**Spec:** [docs/superpowers/specs/2026-06-17-music-together-v5-queue-scroll-favicon-playlist-design.md](../specs/2026-06-17-music-together-v5-queue-scroll-favicon-playlist-design.md).

---

## File map (v5)
```
components/room/Queue.tsx        # MODIFY: max-h + overflow-y-auto on the list <ul> (Task 1)
app/layout.tsx                   # MODIFY: metadata.icons → /logo.png (Task 1)
app/favicon.ico                  # DELETE (Task 1)
lib/youtube/parse.ts             # MODIFY: add parsePlaylistId (Task 2)
lib/youtube/playlist.ts          # CREATE: extractPlaylistItems (Task 2) + fetchPlaylistItems (Task 3)
tests/unit/playlist.test.ts      # CREATE: parsePlaylistId + extractPlaylistItems (Task 2)
app/api/playlist/route.ts        # CREATE: GET ?list= → items, cap 50 (Task 3)
supabase/migrations/0007_v5_batch_queue.sql  # CREATE: add_queue_items RPC + grant (Task 4)
lib/supabase.ts                  # MODIFY: addQueueItems wrapper (Task 4)
tests/integration/v5.test.ts     # CREATE: add_queue_items (Task 5)
lib/realtime.ts                  # MODIFY: debounce subscribeRoom refresh (Task 6)
components/room/AddSong.tsx      # MODIFY: detect playlist → batch add (Task 6)
README.md                        # MODIFY: v5 notes (Task 7)
```

---

# Phase 1 — Small UI

## Task 1: Queue scroll + logo favicon

**Files:**
- Modify: `components/room/Queue.tsx`
- Modify: `app/layout.tsx`
- Delete: `app/favicon.ico`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing other tasks depend on (pure UI/config).

- [ ] **Step 1: Cap the queue list height** — in `components/room/Queue.tsx`, change the list container from `<ul>` to a scrolling box. Replace the exact line:

```tsx
      <ul>
```
with:
```tsx
      <ul className="max-h-[65vh] overflow-y-auto pr-1">
```
(The "Hàng đợi · N bài" header and the empty-state `<p>` stay outside the scroll area. Drag/bump/delete are unchanged.)

- [ ] **Step 2: Point the favicon at the logo** — in `app/layout.tsx`, replace the `metadata` export:

```ts
export const metadata: Metadata = {
  title: "Music Together — Phòng nghe nhạc",
  description: "Cùng nhau chọn và nghe nhạc YouTube trong một phòng nghe cổ điển.",
};
```
with:
```ts
export const metadata: Metadata = {
  title: "Music Together — Phòng nghe nhạc",
  description: "Cùng nhau chọn và nghe nhạc YouTube trong một phòng nghe cổ điển.",
  icons: { icon: "/logo.png", shortcut: "/logo.png", apple: "/logo.png" },
};
```

- [ ] **Step 3: Delete the default favicon** so the logo is the only tab icon:

```bash
git rm app/favicon.ico
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds). In the build output the app compiles; the `/logo.png` icon link is emitted in `<head>` (Next Metadata).

- [ ] **Step 5: Commit**

```bash
git add components/room/Queue.tsx app/layout.tsx
git commit -m "feat: queue column internal scroll + logo.png favicon"
```
(`git rm` already staged the favicon deletion.)

---

# Phase 2 — Playlist add (key-free)

## Task 2: `parsePlaylistId` + `extractPlaylistItems` (pure) + unit tests

**Files:**
- Modify: `lib/youtube/parse.ts`
- Create: `lib/youtube/playlist.ts`
- Test: `tests/unit/playlist.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `parsePlaylistId(input: string): string | null` (in `lib/youtube/parse.ts`)
  - `interface PlaylistItem { videoId: string; title: string; thumb: string; }` and `extractPlaylistItems(html: string, cap?: number): PlaylistItem[]` (in `lib/youtube/playlist.ts`)

- [ ] **Step 1: Write the failing tests** — create `tests/unit/playlist.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePlaylistId } from "@/lib/youtube/parse";
import { extractPlaylistItems } from "@/lib/youtube/playlist";

describe("parsePlaylistId", () => {
  it("reads list= from a pure playlist URL", () => {
    expect(parsePlaylistId("https://www.youtube.com/playlist?list=PLabc123")).toBe("PLabc123");
  });
  it("reads list= from a watch URL that also has v=", () => {
    expect(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz")).toBe("PLxyz");
  });
  it("reads list= from a youtu.be short link", () => {
    expect(parsePlaylistId("https://youtu.be/dQw4w9WgXcQ?list=PLqqq")).toBe("PLqqq");
  });
  it("returns null when there is no list", () => {
    expect(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("returns null for non-URLs / non-YouTube", () => {
    expect(parsePlaylistId("not a url")).toBeNull();
    expect(parsePlaylistId("https://vimeo.com/123?list=PLx")).toBeNull();
  });
});

const FIXTURE = `<!DOCTYPE html><html><body><script nonce="x">var ytInitialData = ${JSON.stringify({
  contents: { wrap: { contents: [
    { playlistVideoRenderer: { videoId: "aaaaaaaaaaa", title: { runs: [{ text: "Song A" }] },
      thumbnail: { thumbnails: [
        { url: "https://i.ytimg.com/vi/aaaaaaaaaaa/default.jpg" },
        { url: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" },
      ] } } },
    { playlistVideoRenderer: { videoId: "bbbbbbbbbbb", title: { simpleText: "Song B" },
      thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg" }] } } },
    { continuationItemRenderer: { trigger: "x" } },
  ] } },
})};</script></body></html>`;

describe("extractPlaylistItems", () => {
  it("parses playlistVideoRenderer entries in order, largest thumb, skips non-video", () => {
    const items = extractPlaylistItems(FIXTURE);
    expect(items).toEqual([
      { videoId: "aaaaaaaaaaa", title: "Song A", thumb: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" },
      { videoId: "bbbbbbbbbbb", title: "Song B", thumb: "https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg" },
    ]);
  });
  it("respects the cap", () => {
    expect(extractPlaylistItems(FIXTURE, 1)).toHaveLength(1);
  });
  it("returns [] on garbage input", () => {
    expect(extractPlaylistItems("<html>no data here</html>")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/unit/playlist.test.ts`
Expected: FAIL (cannot resolve `parsePlaylistId` / `@/lib/youtube/playlist`).

- [ ] **Step 3: Add `parsePlaylistId` to `lib/youtube/parse.ts`** — append at the end of the file:

```ts
const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]+$/;

/** Extract the `list` playlist id from any common YouTube URL form, or null. */
export function parsePlaylistId(input: string): string | null {
  if (!input) return null;
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  const isYouTube =
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com" ||
    host === "youtu.be";
  if (!isYouTube) return null;
  const list = url.searchParams.get("list");
  return list && PLAYLIST_ID_RE.test(list) ? list : null;
}
```

- [ ] **Step 4: Create `lib/youtube/playlist.ts`** with the pure parser (the client helper is added in Task 3):

```ts
export interface PlaylistItem { videoId: string; title: string; thumb: string; }

function sliceBalancedJson(s: string, start: number): string | null {
  if (s[start] !== "{") return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return s.slice(start, i + 1); }
  }
  return null;
}

function extractYtInitialData(html: string): unknown {
  const markers = ['var ytInitialData = ', 'window["ytInitialData"] = ', "ytInitialData = "];
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i === -1) continue;
    const json = sliceBalancedJson(html, i + marker.length);
    if (!json) continue;
    try { return JSON.parse(json); } catch { /* try next marker */ }
  }
  return null;
}

type Renderer = {
  videoId?: unknown;
  title?: { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
  thumbnail?: { thumbnails?: Array<{ url?: unknown }> };
};

function collectRenderers(node: unknown, out: Renderer[]): void {
  if (Array.isArray(node)) { for (const v of node) collectRenderers(v, out); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === "playlistVideoRenderer" && v && typeof v === "object") out.push(v as Renderer);
      else collectRenderers(v, out);
    }
  }
}

/** Pure: parse a YouTube playlist page's HTML into queue items (in order, capped). Fails soft to []. */
export function extractPlaylistItems(html: string, cap = 50): PlaylistItem[] {
  const data = extractYtInitialData(html);
  if (!data) return [];
  const renderers: Renderer[] = [];
  collectRenderers(data, renderers);
  const out: PlaylistItem[] = [];
  for (const r of renderers) {
    const videoId = typeof r.videoId === "string" ? r.videoId : "";
    if (!videoId) continue;
    const runText = r.title?.runs?.[0]?.text;
    const title = typeof runText === "string" ? runText
      : typeof r.title?.simpleText === "string" ? r.title.simpleText : "";
    const thumbs = r.thumbnail?.thumbnails;
    const lastUrl = Array.isArray(thumbs) && thumbs.length ? thumbs[thumbs.length - 1]?.url : undefined;
    const thumb = typeof lastUrl === "string" ? lastUrl : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    out.push({ videoId, title, thumb });
    if (out.length >= cap) break;
  }
  return out;
}
```

- [ ] **Step 5: Run to verify it passes** — `npm test -- tests/unit/playlist.test.ts`
Expected: PASS (8 tests). Confirm `npx tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add lib/youtube/parse.ts lib/youtube/playlist.ts tests/unit/playlist.test.ts
git commit -m "feat: parsePlaylistId + extractPlaylistItems (pure, tested)"
```

---

## Task 3: `/api/playlist` route + `fetchPlaylistItems` client helper

**Files:**
- Create: `app/api/playlist/route.ts`
- Modify: `lib/youtube/playlist.ts`

**Interfaces:**
- Consumes: `extractPlaylistItems(html, cap)`, `PlaylistItem` (Task 2).
- Produces: `fetchPlaylistItems(listId: string): Promise<PlaylistItem[]>` (in `lib/youtube/playlist.ts`); the route `GET /api/playlist?list=` returning `{ items: PlaylistItem[] }` or `{ error }`.

- [ ] **Step 1: Create `app/api/playlist/route.ts`** (mirrors `app/api/oembed/route.ts` style):

```ts
import { extractPlaylistItems } from "@/lib/youtube/playlist";

const PLAYLIST_ID_RE = /^[A-Za-z0-9_-]+$/;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const list = (searchParams.get("list") ?? "").trim();
  if (!list || !PLAYLIST_ID_RE.test(list)) {
    return Response.json({ error: "Invalid playlist id" }, { status: 400 });
  }
  const url = `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}&hl=en`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return Response.json({ error: "Playlist fetch failed" }, { status: 502 });
    const html = await res.text();
    const items = extractPlaylistItems(html, 50);
    if (items.length === 0) return Response.json({ error: "Playlist trống hoặc không đọc được" }, { status: 404 });
    return Response.json({ items });
  } catch {
    return Response.json({ error: "Playlist request error" }, { status: 502 });
  }
}
```

- [ ] **Step 2: Append `fetchPlaylistItems` to `lib/youtube/playlist.ts`** (after `extractPlaylistItems`):

```ts
/** Client: fetch + enumerate a playlist via the same-origin route. Throws on failure. */
export async function fetchPlaylistItems(listId: string): Promise<PlaylistItem[]> {
  const res = await fetch(`/api/playlist?list=${encodeURIComponent(listId)}`);
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? "Không đọc được playlist");
  }
  const d = (await res.json()) as { items?: PlaylistItem[] };
  return d.items ?? [];
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds; the route `/api/playlist` appears as a dynamic route `ƒ /api/playlist`).

- [ ] **Step 4: Commit**

```bash
git add app/api/playlist/route.ts lib/youtube/playlist.ts
git commit -m "feat: /api/playlist route (key-free) + fetchPlaylistItems client helper"
```

---

## Task 4: batch `add_queue_items` RPC (migration `0007`) + wrapper

**Files:**
- Create: `supabase/migrations/0007_v5_batch_queue.sql`
- Modify: `lib/supabase.ts`

**Interfaces:**
- Consumes: existing `_auth(uuid,text,text)`, `_auth_account(text)`, `queue_items`, `accounts` (from 0004).
- Produces: RPC `add_queue_items(p_room_id uuid, p_session_token text, p_items jsonb) returns int`; wrapper `addQueueItems(roomId, token, items: Array<{ videoId: string; title: string; thumb: string | null }>): Promise<number>`.

- [ ] **Step 1: Create `supabase/migrations/0007_v5_batch_queue.sql`**:

```sql
-- =========================================================
-- 0007_v5_batch_queue.sql — v5: batch add queue items (playlist add). ADDITIVE (no data drop).
-- =========================================================

-- Insert many queue items in one call (member-only). p_items: jsonb array of
-- { video_id, title, thumb }. Skips elements without video_id; caps at 50.
-- Returns the number of rows inserted. Positions continue after the room's current max.
create or replace function public.add_queue_items(
  p_room_id uuid, p_session_token text, p_items jsonb
) returns int
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_account uuid; v_name text; v_base double precision; v_idx int := 0; v_count int := 0; v_item jsonb;
begin
  perform public._auth(p_room_id, p_session_token, 'any');   -- must be a member
  v_account := public._auth_account(p_session_token);
  select username into v_name from public.accounts where id = v_account;
  select coalesce(max(position), 0) into v_base from public.queue_items where room_id = p_room_id;
  for v_item in select value from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) limit 50
  loop
    if coalesce(v_item->>'video_id', '') = '' then continue; end if;
    v_idx := v_idx + 1;
    insert into public.queue_items
      (room_id, youtube_video_id, title, thumbnail_url, duration_seconds, added_by_account_id, added_by_name, position)
    values (
      p_room_id,
      v_item->>'video_id',
      coalesce(nullif(v_item->>'title', ''), v_item->>'video_id'),
      nullif(v_item->>'thumb', ''),
      null,
      v_account, v_name,
      v_base + v_idx
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.add_queue_items(uuid,text,jsonb) to anon, authenticated;
```

- [ ] **Step 2: Sanity-check** — balanced `$$`; `set search_path = public, extensions`; member auth via `_auth(...,'any')` BEFORE any insert; positions `v_base + v_idx` continue after the room's max; skips empty `video_id`; `limit 50`; grant present; no `drop`/`alter table`. Cross-check `queue_items` columns against `0004_v2_rebuild.sql` (`youtube_video_id`, `title`, `thumbnail_url`, `duration_seconds`, `added_by_account_id`, `added_by_name`, `position double precision`).

- [ ] **Step 3: Add `addQueueItems` to `lib/supabase.ts`** — append after the existing `addQueueItem` function (around line 39):

```ts
export async function addQueueItems(
  roomId: string, token: string,
  items: Array<{ videoId: string; title: string; thumb: string | null }>,
): Promise<number> {
  const payload = items.map((it) => ({ video_id: it.videoId, title: it.title, thumb: it.thumb }));
  const { data, error } = await supabase.rpc("add_queue_items", { p_room_id: roomId, p_session_token: token, p_items: payload });
  if (error) throw error;
  return typeof data === "number" ? data : Number(data ?? 0);
}
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (clean).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0007_v5_batch_queue.sql lib/supabase.ts
git commit -m "feat(db): add_queue_items batch RPC + client wrapper"
```

---

## Task 5: integration test for `add_queue_items`

**Files:**
- Create: `tests/integration/v5.test.ts`

**Interfaces:**
- Consumes: RPCs `register`, `create_room`, `join_room`, `add_queue_items`; table `queue_items` (public SELECT).
- Produces: nothing.

- [ ] **Step 1: Write the test file** (skips without env; mirrors `tests/integration/v4.test.ts`):

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
const run = url && key ? describe : describe.skip;

run("v5 batch queue add", () => {
  let db: SupabaseClient;
  beforeAll(() => { db = createClient(url!, key!, { auth: { persistSession: false } }); });

  let n = 0;
  const uniq = (p: string) => `${p}_${Date.now()}_${n++}`;
  const reg = async (username: string) => {
    const { data, error } = await db.rpc("register", { p_username: username, p_password: "pw123456" });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { account_id: string; username: string; token: string };
  };
  const createRoom = async (token: string) => {
    const { data, error } = await db.rpc("create_room", { p_room_name: "R", p_password: "secret", p_session_token: token });
    if (error) throw error;
    return (Array.isArray(data) ? data[0] : data) as { code: string; room_id: string; member_id: string };
  };
  const items = [
    { video_id: "aaaaaaaaaaa", title: "A", thumb: "ta" },
    { video_id: "bbbbbbbbbbb", title: "B", thumb: "tb" },
    { video_id: "ccccccccccc", title: "C", thumb: null },
  ];

  it("a member batch-adds items with increasing positions", async () => {
    const owner = await reg(uniq("own"));
    const room = await createRoom(owner.token);
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: owner.token, p_items: items });
    expect(error).toBeNull();
    expect(data).toBe(3);
    const { data: rows } = await db.from("queue_items").select("youtube_video_id, position").eq("room_id", room.room_id).order("position");
    const r = (rows ?? []) as { youtube_video_id: string; position: number }[];
    expect(r.map((x) => x.youtube_video_id)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"]);
    expect(r[0].position).toBeLessThan(r[1].position);
    expect(r[1].position).toBeLessThan(r[2].position);
  });

  it("empty array inserts nothing and returns 0", async () => {
    const owner = await reg(uniq("empty"));
    const room = await createRoom(owner.token);
    const { data, error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: owner.token, p_items: [] });
    expect(error).toBeNull();
    expect(data).toBe(0);
  });

  it("a non-member cannot batch-add", async () => {
    const owner = await reg(uniq("o2"));
    const room = await createRoom(owner.token);
    const outsider = await reg(uniq("out"));
    const { error } = await db.rpc("add_queue_items", { p_room_id: room.room_id, p_session_token: outsider.token, p_items: items });
    expect(error?.message).toContain("not a member");
  });
});
```

- [ ] **Step 2: Run (skips without DB env)** — `npm test -- tests/integration/v5.test.ts` → SKIPPED without env; with a v5-migrated DB → PASS. Confirm `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/v5.test.ts
git commit -m "test(db): add_queue_items batch insert / positions / non-member"
```

---

## Task 6: realtime debounce + AddSong playlist wiring

**Files:**
- Modify: `lib/realtime.ts`
- Modify: `components/room/AddSong.tsx`

**Interfaces:**
- Consumes: `parseYouTubeId`, `parsePlaylistId` (parse.ts), `fetchVideoMeta` (meta.ts), `fetchPlaylistItems` (playlist.ts), `addQueueItem`, `addQueueItems` (supabase.ts).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Debounce `subscribeRoom`'s refresh in `lib/realtime.ts`** — replace the whole `subscribeRoom` function (currently lines ~23-36) with:

```ts
/** Subscribe to room-scoped changes; re-fetch + push fresh state on any change.
 *  Refresh is trailing-debounced so a burst of postgres_changes (e.g. a 50-row
 *  batch insert) collapses into ~1 refetch instead of one per row. */
export function subscribeRoom(roomId: string, onState: (s: RoomState) => void): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const doRefresh = async () => {
    const state = await fetchRoomState(roomId);
    if (!cancelled) onState(state);
  };
  const refresh = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void doRefresh(); }, 150);
  };
  const channel: RealtimeChannel = supabase
    .channel(`room:${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "queue_items", filter: `room_id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "members", filter: `room_id=eq.${roomId}` }, refresh)
    .subscribe((status) => { if (status === "SUBSCRIBED") void doRefresh(); });
  return () => { cancelled = true; if (timer) clearTimeout(timer); void supabase.removeChannel(channel); };
}
```
(The initial load on `SUBSCRIBED` calls `doRefresh` immediately — only the change-driven `refresh` is debounced.)

- [ ] **Step 2: Replace `components/room/AddSong.tsx`** entirely to classify playlist vs video:

```tsx
"use client";

import { useState } from "react";
import { addQueueItem, addQueueItems } from "@/lib/supabase";
import { parseYouTubeId, parsePlaylistId } from "@/lib/youtube/parse";
import { fetchVideoMeta } from "@/lib/youtube/meta";
import { fetchPlaylistItems } from "@/lib/youtube/playlist";

export default function AddSong({ roomId, token }: { roomId: string; token: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const videoId = parseYouTubeId(url);
    const playlistId = parsePlaylistId(url);
    if (!videoId && !playlistId) { setError("Link YouTube không hợp lệ."); return; }
    setBusy(true);
    try {
      if (!videoId && playlistId) {
        const items = await fetchPlaylistItems(playlistId);
        if (items.length === 0) { setError("Playlist trống hoặc không đọc được."); return; }
        const added = await addQueueItems(roomId, token, items);
        setNotice(`Đã thêm ${added} bài từ playlist.`);
        setUrl("");
      } else if (videoId) {
        const meta = await fetchVideoMeta(videoId);
        await addQueueItem(roomId, token, {
          videoId,
          title: meta?.title || videoId,
          thumb: meta?.thumbnail ?? null,
          duration: null,
        });
        setUrl("");
      }
    } catch (err) {
      setError((err as { message?: string }).message ?? "Không thêm được bài.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={add} className="mb-1 flex flex-wrap gap-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Dán link YouTube (video hoặc playlist)…"
        className="flex-1 rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
      <button disabled={busy} className="rounded-lg bg-burgundy px-3 py-2 font-cormorant font-bold text-cream disabled:opacity-60">
        {busy ? "…" : "+ Thêm"}
      </button>
      {error && <p className="w-full text-xs text-burgundy-accent">{error}</p>}
      {notice && <p className="w-full text-xs text-burgundy">{notice}</p>}
    </form>
  );
}
```

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (clean), `npm run lint` (0 errors), `npm run build` (succeeds).

- [ ] **Step 4: Commit**

```bash
git add lib/realtime.ts components/room/AddSong.tsx
git commit -m "feat: debounce room refresh + add full playlist from a YouTube link"
```

---

## Task 7: README v5 notes + full build gate

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Append a `## v5: Queue Scroll, Logo Favicon & Playlist Add` section to `README.md`** (match the existing v3/v4 section style) noting: run the additive migration `supabase/migrations/0007_v5_batch_queue.sql` in the Supabase SQL Editor (no data loss); new features — the queue column now scrolls internally instead of stretching the page; the browser tab uses `logo.png`; pasting a **YouTube playlist link** enqueues all its videos (key-free, up to 50; a normal video link — even with `&list=` — still adds one). Note reactions/playlist need no API key.

- [ ] **Step 2: Full gate** — `npm test` (unit pass incl. `tests/unit/playlist.test.ts`; integration suites skip without env) + `npm run build` (succeeds; routes include `ƒ /api/playlist`). Also `npx tsc --noEmit` clean and `npm run lint` 0 errors. Capture summaries.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v5 notes — queue scroll, logo favicon, playlist add"
```

---

## Self-review (completed during planning)
- **Spec coverage:** A queue scroll → Task 1 ✓; B logo favicon (+delete favicon.ico) → Task 1 ✓; C playlist: parse (Task 2), key-free route + `extractPlaylistItems` (Tasks 2-3), batch RPC (Task 4) + integration test (Task 5), debounce + AddSong UX (Task 6) ✓; D tests → Tasks 2 (unit) + 5 (integration) ✓; additive migration → Task 4 ✓; docs/gate → Task 7 ✓.
- **Placeholder scan:** all code complete; commands have expected outcomes; fixture is concrete.
- **Type consistency:** `PlaylistItem {videoId,title,thumb}` defined in `lib/youtube/playlist.ts` (Task 2) and consumed by the route (Task 3), `fetchPlaylistItems` (Task 3), and `AddSong` (Task 6). `addQueueItems(roomId, token, items: {videoId,title,thumb}[])` (Task 4) maps to RPC `add_queue_items(p_room_id,p_session_token,p_items jsonb)` with element keys `{video_id,title,thumb}` matching the SQL `->>'video_id'/'title'/'thumb'`. `parsePlaylistId`/`parseYouTubeId` both in `lib/youtube/parse.ts`. `subscribeRoom` signature unchanged (Task 6 only changes its body) so `useRoom` is unaffected.
- **Known/accepted:** the `/api/playlist` live fetch isn't unit-tested (pure `extractPlaylistItems` + manual); playlist scraping is best-effort (YouTube markup can change) — fails soft to a friendly error; `logo.png` is a heavy favicon (follow-up: resized `app/icon.png`); duration stored NULL for playlist items (parity with single-add).
