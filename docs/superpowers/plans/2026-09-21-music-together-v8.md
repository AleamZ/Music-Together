# Music Together v8 Implementation Plan — In-app YouTube Search

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the room's "add song" box into a smart box — paste a link to add it (unchanged), or type keywords to get YouTube's own suggestions while typing and a video search on Enter, with a results panel whose rows enqueue with one click.

**Architecture:** Two thin Next route handlers proxy YouTube's public keyless endpoints (`suggestqueries-clients6.youtube.com/complete/search` JSONP and InnerTube `POST youtubei/v1/search`) and hand the body to pure, unit-tested parsers in `lib/youtube/`. Client wrappers call the same-origin routes. `AddSong.tsx` classifies the input (link vs text), debounces suggestions, runs the search, and renders a new `SearchResults.tsx` panel that calls the existing `addQueueItem` RPC per row. No DB, migration, env var, or dependency changes.

**Tech Stack:** Next.js 16.2.9 (App Router route handlers), React 19, TS 5, Tailwind v4, Supabase RPC (`add_queue_item`), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-21-music-together-v8-youtube-search-design.md](../specs/2026-09-21-music-together-v8-youtube-search-design.md).

## Global Constraints

- **Key-free and credential-free.** No YouTube Data API key. Never send cookies, `authorization`, `tok`, `authuser`, `gs_id`, `cp`, `x-goog-visitor-id` or any value captured from a logged-in browser. Only the headers listed in each route task.
- **Server just relays; parsers are pure.** YouTube is fetched only inside route handlers. `parseSuggestJsonp`, `parseDurationText`, `extractSearchResults` take a string/JSON and return data — no `fetch`, no globals — so they are unit-testable.
- **Query cap:** `q` is trimmed; empty or > 100 chars is rejected (suggest → `200 {suggestions: []}`, search → `400`).
- **Caps:** suggestions ≤ 10, results ≤ 20. Thumbs are always `https://i.ytimg.com/vi/{id}/mqdefault.jpg`.
- **Locale fixed:** `hl=vi`, `gl=VN` (suggest uses lowercase `gl=vn`, as YouTube's own request does).
- **InnerTube constants:** `clientName: "WEB"`, `clientVersion: "2.20260918.00.00"` (one constant `INNERTUBE_CLIENT_VERSION`), `params: "EgIQAQ=="` (Type = Video filter).
- **Copy (Vietnamese, verbatim):** placeholder `Tìm bài hoặc dán link YouTube…`; button `+ Thêm` / `Tìm` / `…`; results header `Kết quả cho "{query}" · {N}`; `Không có kết quả.`; `Không tìm được, thử lại nhé.`; `✓ Đã thêm`; `Không thêm được.`; close button title `Đóng`.
- **Theme tokens only:** `cream`, `parchment-200`, `gold`, `gold-200`, `ink`, `burgundy`, `burgundy-accent`, `font-cormorant`. No new CSS in `globals.css`.
- **Next.js 16.2.9 is not the Next.js you know** — before writing a route handler or component, read the relevant guide under `node_modules/next/dist/docs/` (route handlers, `fetch` caching options) and heed deprecation notices. `node_modules` is **not** installed in a fresh checkout — Task 1 runs `npm install`.
- **Lint must stay clean** (`npm run lint`): `eslint-config-next` 16 enables the React-Compiler hook rules — never call a state setter synchronously in a `useEffect` body and never read `ref.current` during render. The code in this plan is written to satisfy that; keep it that way.
- **Branch:** `feat/v8-yt-search` (merge to `main` when done; auto-deploys — no Supabase step).

---

## File map (v8)

```
lib/youtube/search.ts              # CREATE: SearchResult, parseDurationText, extractSearchResults (pure), fetchSearchResults (client)  (Task 1)
tests/unit/search.test.ts          # CREATE: parseDurationText + extractSearchResults tests                                          (Task 1)
lib/youtube/suggest.ts             # CREATE: Suggestion, parseSuggestJsonp (pure), fetchSuggestions (client)                          (Task 2)
tests/unit/suggest.test.ts         # CREATE: parseSuggestJsonp tests                                                                 (Task 2)
app/api/yt/search/route.ts         # CREATE: GET ?q= → InnerTube search proxy, video filter, cap 20                                  (Task 3)
app/api/yt/suggest/route.ts        # CREATE: GET ?q= → suggest JSONP proxy, cap 10, soft-fail []                                     (Task 4)
components/room/SearchResults.tsx  # CREATE: results panel with per-row add state                                                    (Task 5)
components/room/AddSong.tsx        # MODIFY: smart input — link → add, text → suggest + search                                       (Task 6)
components/room/RoomShell.tsx      # MODIFY: remove "Phase 2" placeholder line                                                       (Task 6)
README.md                          # MODIFY: v8 section + fix the stale "needs a YOUTUBE_API_KEY" note                               (Task 7)
```

---

# Phase 1 — Pure parsers (TDD)

## Task 1: `lib/youtube/search.ts` — duration + InnerTube result extraction

**Files:**
- Create: `lib/youtube/search.ts`
- Test: `tests/unit/search.test.ts`

**Interfaces:**
- Consumes: nothing from this plan.
- Produces (used by Tasks 3, 5, 6):
  ```ts
  export interface SearchResult {
    videoId: string; title: string; channel: string;
    durationText: string | null; durationSeconds: number | null; thumb: string;
  }
  export function parseDurationText(s: string | null | undefined): number | null
  export function extractSearchResults(data: unknown, cap?: number): SearchResult[]   // cap default 20
  export async function fetchSearchResults(q: string, signal?: AbortSignal): Promise<SearchResult[]>
  ```

- [ ] **Step 1: Set up the workspace**

```bash
git checkout -b feat/v8-yt-search
npm install
npm test
```

Expected: install completes; the existing suite passes (integration tests skip without `SUPABASE_TEST_URL`).

- [ ] **Step 2: Write the failing tests** — create `tests/unit/search.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseDurationText, extractSearchResults } from "@/lib/youtube/search";

describe("parseDurationText", () => {
  it("parses m:ss and mm:ss", () => {
    expect(parseDurationText("4:32")).toBe(272);
    expect(parseDurationText("0:59")).toBe(59);
    expect(parseDurationText("12:05")).toBe(725);
  });
  it("parses h:mm:ss", () => {
    expect(parseDurationText("1:02:15")).toBe(3735);
  });
  it("returns null for anything that is not a clock string", () => {
    expect(parseDurationText("LIVE")).toBeNull();
    expect(parseDurationText("")).toBeNull();
    expect(parseDurationText(undefined)).toBeNull();
    expect(parseDurationText(null)).toBeNull();
    expect(parseDurationText("4")).toBeNull();
    expect(parseDurationText("4:5")).toBeNull();
  });
});

// Trimmed InnerTube search response: videoRenderers under itemSectionRenderer
// AND nested inside a shelfRenderer; a channelRenderer sibling; one live video
// (no lengthText, byline only in longBylineText); one entry without videoId;
// one duplicate id.
const FIXTURE = {
  contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
    { itemSectionRenderer: { contents: [
      { videoRenderer: {
          videoId: "jktURHt9O6Y",
          title: { runs: [{ text: "Nếu Như Ta Chẳng Còn" }] },
          ownerText: { runs: [{ text: "Kênh A" }] },
          lengthText: { simpleText: "4:32" },
          thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/jktURHt9O6Y/hq720.jpg?sqp=signed" }] },
      } },
      { channelRenderer: { channelId: "UCxxxxxxxxxxxxxxxxxxxxxx", title: { simpleText: "Kênh A" } } },
      { videoRenderer: {
          videoId: "live0000001",
          title: { simpleText: "Live radio" },
          longBylineText: { runs: [{ text: "Kênh B" }] },
      } },
      { videoRenderer: { title: { runs: [{ text: "no id — skipped" }] } } },
      { shelfRenderer: { content: { verticalListRenderer: { items: [
        { videoRenderer: {
            videoId: "hxTxROuUj4g",
            title: { runs: [{ text: "ICD" }] },
            ownerText: { runs: [{ text: "Kênh C" }] },
            lengthText: { simpleText: "1:02:15" },
        } },
        { videoRenderer: { videoId: "jktURHt9O6Y", title: { runs: [{ text: "duplicate — skipped" }] } } },
      ] } } } },
    ] } },
    { continuationItemRenderer: { token: "next-page" } },
  ] } } } },
};

describe("extractSearchResults", () => {
  it("collects videoRenderers in document order, derives mqdefault thumbs, skips non-video / id-less / duplicate entries", () => {
    expect(extractSearchResults(FIXTURE)).toEqual([
      { videoId: "jktURHt9O6Y", title: "Nếu Như Ta Chẳng Còn", channel: "Kênh A",
        durationText: "4:32", durationSeconds: 272, thumb: "https://i.ytimg.com/vi/jktURHt9O6Y/mqdefault.jpg" },
      { videoId: "live0000001", title: "Live radio", channel: "Kênh B",
        durationText: null, durationSeconds: null, thumb: "https://i.ytimg.com/vi/live0000001/mqdefault.jpg" },
      { videoId: "hxTxROuUj4g", title: "ICD", channel: "Kênh C",
        durationText: "1:02:15", durationSeconds: 3735, thumb: "https://i.ytimg.com/vi/hxTxROuUj4g/mqdefault.jpg" },
    ]);
  });
  it("respects the cap", () => {
    expect(extractSearchResults(FIXTURE, 2).map((r) => r.videoId)).toEqual(["jktURHt9O6Y", "live0000001"]);
  });
  it("returns [] for null / primitive / empty input", () => {
    expect(extractSearchResults(null)).toEqual([]);
    expect(extractSearchResults("not json")).toEqual([]);
    expect(extractSearchResults({})).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/search.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/youtube/search"`.

- [ ] **Step 4: Write the implementation** — create `lib/youtube/search.ts`:

```ts
export interface SearchResult {
  videoId: string;
  title: string;
  channel: string;
  durationText: string | null;
  durationSeconds: number | null;
  thumb: string;
}

/** "4:32" → 272, "1:02:15" → 3735; anything else (LIVE, "", undefined) → null. */
export function parseDurationText(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s.trim());
  if (!m) return null;
  const [, a, b, c] = m;
  return c === undefined ? +a * 60 + +b : +a * 3600 + +b * 60 + +c;
}

type Runs = { runs?: Array<{ text?: unknown }>; simpleText?: unknown };
type VideoRenderer = {
  videoId?: unknown;
  title?: Runs;
  ownerText?: Runs;
  longBylineText?: Runs;
  lengthText?: { simpleText?: unknown };
};

function firstRun(r: Runs | undefined): string {
  const t = r?.runs?.[0]?.text;
  if (typeof t === "string") return t;
  return typeof r?.simpleText === "string" ? r.simpleText : "";
}

/** Pure: walk an InnerTube search response and collect every `videoRenderer`
 *  (in document order, deduped, capped). Thumb is derived from the id so we never
 *  depend on YouTube's signed thumbnail URLs. Fails soft to []. */
export function extractSearchResults(data: unknown, cap = 20): SearchResult[] {
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (out.length >= cap || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) { if (out.length >= cap) return; walk(v); }
      return;
    }
    const obj = node as Record<string, unknown>;
    const vr = obj.videoRenderer as VideoRenderer | undefined;
    if (vr && typeof vr === "object") {
      const videoId = typeof vr.videoId === "string" ? vr.videoId : "";
      if (videoId && !seen.has(videoId)) {
        seen.add(videoId);
        const lt = vr.lengthText?.simpleText;
        const durationText = typeof lt === "string" && lt ? lt : null;
        out.push({
          videoId,
          title: firstRun(vr.title),
          channel: firstRun(vr.ownerText) || firstRun(vr.longBylineText),
          durationText,
          durationSeconds: parseDurationText(durationText),
          thumb: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        });
      }
      return; // a videoRenderer is a leaf for our purposes — don't descend
    }
    for (const v of Object.values(obj)) { if (out.length >= cap) return; walk(v); }
  };
  try { walk(data); } catch { return []; }
  return out;
}

/** Client: search via the same-origin route. Throws on failure (AbortError passes through). */
export async function fetchSearchResults(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const res = await fetch(`/api/yt/search?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error ?? "Không tìm được");
  }
  const d = (await res.json()) as { results?: SearchResult[] };
  return d.results ?? [];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/search.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/youtube/search.ts tests/unit/search.test.ts
git commit -m "feat: InnerTube search result parser + duration parser (pure, tested)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `lib/youtube/suggest.ts` — suggest JSONP parser

**Files:**
- Create: `lib/youtube/suggest.ts`
- Test: `tests/unit/suggest.test.ts`

**Interfaces:**
- Consumes: nothing from this plan.
- Produces (used by Tasks 4, 6):
  ```ts
  export interface Suggestion { text: string; videoId?: string; thumb?: string }
  export function parseSuggestJsonp(text: string, cap?: number): Suggestion[]   // cap default 10
  export async function fetchSuggestions(q: string, signal?: AbortSignal): Promise<Suggestion[]>
  ```

- [ ] **Step 1: Write the failing tests** — create `tests/unit/suggest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseSuggestJsonp } from "@/lib/youtube/suggest";

// Shape of https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&...:
// window.google.ac.h(["<q>", [[text, type, flags, {zai, zaj, zak, zal}], ...], {...}])
const JSONP = `window.google.ac.h(${JSON.stringify(["neu", [
  ["neu nhu ta chang con karaoke", 35, [39, 362],
    { zai: "https://i.ytimg.com/vi/jktURHt9O6Y/mqdefault.jpg", zaj: 320, zak: 180, zal: "jktURHt9O6Y" }],
  ["neu nhu ta chang con", 0, [512]],
  ["  Neu Nhu Ta Chang Con  ", 0, [512]],   // duplicate (case/whitespace) — skipped
  ["", 0, [512]],                            // empty text — skipped
  [42, 0, [512]],                            // non-string text — skipped
  ["neu anh", 0, [512], { zam: true }],      // meta without zal/zai → plain text entry
], { j: "0", k: 1 }])})`;

describe("parseSuggestJsonp", () => {
  it("unwraps the JSONP callback and maps entries, keeping videoId/thumb only when present", () => {
    expect(parseSuggestJsonp(JSONP)).toEqual([
      { text: "neu nhu ta chang con karaoke", videoId: "jktURHt9O6Y", thumb: "https://i.ytimg.com/vi/jktURHt9O6Y/mqdefault.jpg" },
      { text: "neu nhu ta chang con" },
      { text: "neu anh" },
    ]);
  });
  it("respects the cap", () => {
    expect(parseSuggestJsonp(JSONP, 1)).toEqual([
      { text: "neu nhu ta chang con karaoke", videoId: "jktURHt9O6Y", thumb: "https://i.ytimg.com/vi/jktURHt9O6Y/mqdefault.jpg" },
    ]);
  });
  it("returns [] when the wrapper is missing, the JSON is invalid, or the payload has the wrong shape", () => {
    expect(parseSuggestJsonp("<html>oops</html>")).toEqual([]);
    expect(parseSuggestJsonp("window.google.ac.h({not json)")).toEqual([]);
    expect(parseSuggestJsonp('window.google.ac.h(["q", "not-an-array"])')).toEqual([]);
    expect(parseSuggestJsonp("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run tests/unit/suggest.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/youtube/suggest"`.

- [ ] **Step 3: Write the implementation** — create `lib/youtube/suggest.ts`:

```ts
export interface Suggestion {
  text: string;
  videoId?: string;
  thumb?: string;
}

const CALLBACK = "window.google.ac.h";

/** Pure: parse YouTube's suggest JSONP (`window.google.ac.h([q, [[text, type, flags, meta?], …], …])`)
 *  into deduped, capped suggestions. `meta.zal` = video id, `meta.zai` = thumbnail. Fails soft to []. */
export function parseSuggestJsonp(text: string, cap = 10): Suggestion[] {
  const at = text.indexOf(CALLBACK);
  if (at === -1) return [];
  const open = text.indexOf("(", at + CALLBACK.length);
  const close = text.lastIndexOf(")");
  if (open === -1 || close <= open) return [];
  let payload: unknown;
  try { payload = JSON.parse(text.slice(open + 1, close)); } catch { return []; }
  if (!Array.isArray(payload) || !Array.isArray(payload[1])) return [];

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const entry of payload[1] as unknown[]) {
    if (out.length >= cap) break;
    if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
    const t = entry[0].trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const s: Suggestion = { text: t };
    const meta = entry[3];
    if (meta && typeof meta === "object") {
      const { zal, zai } = meta as { zal?: unknown; zai?: unknown };
      if (typeof zal === "string" && zal) s.videoId = zal;
      if (typeof zai === "string" && zai) s.thumb = zai;
    }
    out.push(s);
  }
  return out;
}

/** Client: suggestions via the same-origin route. Never throws except AbortError; failures → []. */
export async function fetchSuggestions(q: string, signal?: AbortSignal): Promise<Suggestion[]> {
  try {
    const res = await fetch(`/api/yt/suggest?q=${encodeURIComponent(q)}`, { signal });
    if (!res.ok) return [];
    const d = (await res.json()) as { suggestions?: Suggestion[] };
    return d.suggestions ?? [];
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return [];
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run tests/unit/suggest.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/youtube/suggest.ts tests/unit/suggest.test.ts
git commit -m "feat: YouTube suggest JSONP parser (pure, tested)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 2 — Route handlers

## Task 3: `GET /api/yt/search` — InnerTube search proxy

**Files:**
- Create: `app/api/yt/search/route.ts`

**Interfaces:**
- Consumes: `extractSearchResults(data, 20)` from Task 1.
- Produces: `GET /api/yt/search?q=…` → `200 { results: SearchResult[] }` | `400 { error }` | `502 { error }`. Consumed by `fetchSearchResults` (Task 1) — already written against this contract.

- [ ] **Step 1: Read the Next.js docs for this version**

Open `node_modules/next/dist/docs/` and read the guide on **Route Handlers** and the **`fetch` options** (`next.revalidate`, `signal`). Confirm `Response.json(...)` and `next: { revalidate }` are still the documented forms (they are what `app/api/playlist/route.ts` uses). If the docs say `next.revalidate` is ignored for `POST` fetches, keep the option anyway — caching is a nice-to-have, correctness does not depend on it.

- [ ] **Step 2: Create `app/api/yt/search/route.ts`**

```ts
import { extractSearchResults } from "@/lib/youtube/search";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
// Bump here if YouTube starts rejecting the version.
const INNERTUBE_CLIENT_VERSION = "2.20260918.00.00";
// YouTube's "Type: Video" search filter — no channels / playlists / mixed shelves.
const VIDEO_FILTER = "EgIQAQ==";
const MAX_Q = 100;
const CAP = 20;

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q || q.length > MAX_Q) return Response.json({ error: "Invalid query" }, { status: 400 });
  try {
    const res = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": UA,
        "Accept-Language": "vi,en;q=0.8",
        "X-YouTube-Client-Name": "1",
        "X-YouTube-Client-Version": INNERTUBE_CLIENT_VERSION,
        Origin: "https://www.youtube.com",
        // CONSENT cookie skips YouTube's consent interstitial that a cookieless
        // datacenter (e.g. Vercel) request may otherwise get. Not a user credential.
        Cookie: "CONSENT=YES+1",
      },
      body: JSON.stringify({
        context: { client: { hl: "vi", gl: "VN", clientName: "WEB", clientVersion: INNERTUBE_CLIENT_VERSION } },
        query: q,
        params: VIDEO_FILTER,
      }),
      next: { revalidate: 600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return Response.json({ error: "Search failed" }, { status: 502 });
    const data: unknown = await res.json();
    return Response.json({ results: extractSearchResults(data, CAP) });
  } catch {
    return Response.json({ error: "Search failed" }, { status: 502 });
  }
}
```

- [ ] **Step 3: Verify against live YouTube**

Start the dev server in the background, then hit the route:

```bash
npm run dev
```

```bash
curl -s "http://localhost:3000/api/yt/search?q=n%E1%BA%BFu%20nh%C6%B0%20ta%20ch%E1%BA%B3ng%20c%C3%B2n" | head -c 800
```

Expected: `{"results":[{"videoId":"…","title":"…","channel":"…","durationText":"4:32","durationSeconds":272,"thumb":"https://i.ytimg.com/vi/…/mqdefault.jpg"},…]}` with up to 20 entries, all videos.

Also check the guards:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/yt/search?q="
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:3000/api/yt/search?q=$(python -c 'print("a"*101)')"
```

Expected: `400` and `400`.

**If YouTube answers non-200 (route returns 502):** print the upstream status/body temporarily (`console.error(res.status, await res.text())`) to see why. Known fallbacks, in order: (a) append `&key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8` to the InnerTube URL — this is the public WEB client key embedded in every youtube.com page, not a secret; (b) bump `INNERTUBE_CLIENT_VERSION` to the value in a fresh `youtube.com` page source (`"INNERTUBE_CLIENT_VERSION":"…"`). Remove the debug log before committing.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/yt/search/route.ts
git commit -m "feat: /api/yt/search — keyless InnerTube video search proxy

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: `GET /api/yt/suggest` — suggest JSONP proxy

**Files:**
- Create: `app/api/yt/suggest/route.ts`

**Interfaces:**
- Consumes: `parseSuggestJsonp(text, 10)` from Task 2.
- Produces: `GET /api/yt/suggest?q=…` → always `200 { suggestions: Suggestion[] }`. Consumed by `fetchSuggestions` (Task 2).

- [ ] **Step 1: Create `app/api/yt/suggest/route.ts`**

```ts
import { parseSuggestJsonp } from "@/lib/youtube/suggest";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_Q = 100;
const CAP = 10;

/** Suggestions are a convenience: every failure path answers 200 with an empty list. */
export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (!q || q.length > MAX_Q) return Response.json({ suggestions: [] });
  const url =
    "https://suggestqueries-clients6.youtube.com/complete/search" +
    `?client=youtube&ds=yt&hl=vi&gl=vn&gs_ri=youtube&q=${encodeURIComponent(q)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept-Language": "vi,en;q=0.8" },
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return Response.json({ suggestions: [] });
    return Response.json({ suggestions: parseSuggestJsonp(await res.text(), CAP) });
  } catch {
    return Response.json({ suggestions: [] });
  }
}
```

- [ ] **Step 2: Verify against live YouTube** (dev server still running from Task 3, else `npm run dev`)

```bash
curl -s "http://localhost:3000/api/yt/suggest?q=n%E1%BA%BFu%20nh%C6%B0"
curl -s "http://localhost:3000/api/yt/suggest?q="
```

Expected: first → `{"suggestions":[{"text":"nếu như ta chẳng còn",…},…]}` (≤ 10; some entries may carry `videoId`/`thumb`); second → `{"suggestions":[]}`.

**If the first is empty:** `curl -s "https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&ds=yt&hl=vi&gl=vn&gs_ri=youtube&q=nhac"` directly to see the raw body. If the host is unreachable from your network, switch the URL host to `https://suggestqueries.google.com` (same path and params) — it serves the identical JSONP.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/yt/suggest/route.ts
git commit -m "feat: /api/yt/suggest — YouTube suggest proxy (soft-fail)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 3 — UI

## Task 5: `components/room/SearchResults.tsx` — results panel

**Files:**
- Create: `components/room/SearchResults.tsx`

**Interfaces:**
- Consumes: `SearchResult` (Task 1); `addQueueItem(roomId, token, { videoId, title, thumb, duration })` from `lib/supabase.ts` (existing).
- Produces (used by Task 6):
  ```ts
  export default function SearchResults(props: {
    query: string; results: SearchResult[]; roomId: string; token: string; onClose: () => void;
  }): JSX.Element
  ```
  The parent remounts it with a fresh `key` per search, which is what resets the per-row add state.

- [ ] **Step 1: Create `components/room/SearchResults.tsx`**

```tsx
"use client";

import { useState } from "react";
import { addQueueItem } from "@/lib/supabase";
import type { SearchResult } from "@/lib/youtube/search";

type AddState = "idle" | "busy" | "done" | "error";

function Spinner() {
  return <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-burgundy border-t-transparent align-middle" />;
}

/** Search results panel. Mount with a fresh `key` per search — that is what resets the add state. */
export default function SearchResults({ query, results, roomId, token, onClose }: {
  query: string; results: SearchResult[]; roomId: string; token: string; onClose: () => void;
}) {
  const [state, setState] = useState<Record<string, AddState>>({});

  async function add(r: SearchResult) {
    setState((s) => ({ ...s, [r.videoId]: "busy" }));
    try {
      await addQueueItem(roomId, token, {
        videoId: r.videoId, title: r.title || r.videoId, thumb: r.thumb, duration: r.durationSeconds,
      });
      setState((s) => ({ ...s, [r.videoId]: "done" }));
    } catch {
      setState((s) => ({ ...s, [r.videoId]: "error" }));
    }
  }

  return (
    <div className="mt-2 mb-3 rounded-lg border border-gold-200 bg-cream/60 p-2">
      <div className="mb-1 flex items-center justify-between gap-2 font-cormorant text-burgundy">
        <span className="truncate">
          Kết quả cho &ldquo;{query}&rdquo; <span className="text-xs text-ink/60">· {results.length}</span>
        </span>
        <button type="button" title="Đóng" onClick={onClose}
          className="rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy">✕</button>
      </div>
      {results.length === 0 && <p className="text-sm text-ink/60">Không có kết quả.</p>}
      <ul className="max-h-[40vh] overflow-y-auto pr-1">
        {results.map((r) => {
          const st = state[r.videoId] ?? "idle";
          return (
            <li key={r.videoId} className={`border-b border-dotted border-gold-200 py-2 ${st === "busy" ? "opacity-60" : ""}`}>
              <div className="flex items-center gap-2">
                <img src={r.thumb} alt="" className="h-9 w-12 rounded object-cover" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{r.title || r.videoId}</div>
                  <div className="truncate text-[11px] text-gold">
                    {r.channel}{r.durationText ? ` · ${r.durationText}` : ""}
                  </div>
                </div>
                {st === "busy" ? <Spinner /> : (
                  <button type="button" disabled={st === "done"} onClick={() => add(r)}
                    className="whitespace-nowrap rounded border border-gold-200 bg-cream px-1.5 text-sm text-burgundy disabled:opacity-60">
                    {st === "done" ? "✓ Đã thêm" : "+ Thêm"}
                  </button>
                )}
              </div>
              {st === "error" && <p className="mt-1 text-[11px] text-burgundy-accent">Không thêm được.</p>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Type-check and lint**

```bash
npx tsc --noEmit
npm run lint
```

Expected: no errors. (`<img>` is used the same way as in `Queue.tsx`; if `@next/next/no-img-element` complains, it is a warning there too — keep parity, do not switch to `next/image`.)

- [ ] **Step 3: Commit**

```bash
git add components/room/SearchResults.tsx
git commit -m "feat: SearchResults panel with per-row add state

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: `AddSong.tsx` smart box + `RoomShell.tsx` cleanup

**Files:**
- Modify: `components/room/AddSong.tsx` (replace whole file)
- Modify: `components/room/RoomShell.tsx:45` (delete one line)

**Interfaces:**
- Consumes: `fetchSuggestions`, `Suggestion` (Task 2); `fetchSearchResults`, `SearchResult` (Task 1); `SearchResults` (Task 5); existing `parseYouTubeId`, `parsePlaylistId`, `fetchVideoMeta`, `fetchPlaylistItems`, `addQueueItem`, `addQueueItems`.
- Produces: nothing other tasks depend on. `AddSong`'s props (`roomId`, `token`) are unchanged.

- [ ] **Step 1: Replace `components/room/AddSong.tsx` entirely with:**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { addQueueItem, addQueueItems } from "@/lib/supabase";
import { parseYouTubeId, parsePlaylistId } from "@/lib/youtube/parse";
import { fetchVideoMeta } from "@/lib/youtube/meta";
import { fetchPlaylistItems } from "@/lib/youtube/playlist";
import { fetchSuggestions, type Suggestion } from "@/lib/youtube/suggest";
import { fetchSearchResults, type SearchResult } from "@/lib/youtube/search";
import SearchResults from "./SearchResults";

const SUGGEST_DEBOUNCE_MS = 250;
const BLUR_CLOSE_MS = 150;

/** Link = a YouTube URL, or a bare 11-char id that doesn't look like a plain lowercase word
 *  (`nhacsontung` is a search, `dQw4w9WgXcQ` is an id). */
function isLink(s: string): boolean {
  if (parsePlaylistId(s)) return true;
  const id = parseYouTubeId(s);
  if (!id) return false;
  return id !== s || /[^a-z]/.test(s);
}

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
  const link = trimmed !== "" && isLink(trimmed);

  // Suggest-as-you-type: debounced; the cleanup aborts the in-flight request on every keystroke.
  useEffect(() => {
    if (!trimmed || isLink(trimmed) || skipSuggestFor.current === trimmed) return;
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
    if (!t || isLink(t)) { setSuggestions([]); closeSuggest(); }
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
    if (!isLink(text)) { await runSearch(text); return; }

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
            className="w-full rounded-lg border border-gold bg-cream px-3 py-2 text-sm text-ink" />
          {showSuggest && suggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-gold bg-cream shadow">
              {suggestions.map((s, i) => (
                <li key={s.text}
                  onMouseDown={(e) => { e.preventDefault(); pick(s.text); }}
                  onMouseEnter={() => setActiveIdx(i)}
                  className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink ${i === activeIdx ? "bg-parchment-200" : ""}`}>
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
```

- [ ] **Step 2: Remove the placeholder line in `components/room/RoomShell.tsx`**

Delete exactly this line (currently line 45):

```tsx
          <p className="mb-2 text-[11px] text-ink/60">🔎 Ô tìm kiếm trong app: bật khi cấu hình API key (Phase 2)</p>
```

so the section reads:

```tsx
        <section className="rounded-xl border border-gold-200 bg-cream/50 p-3">
          <AddSong roomId={room.id} token={token} />
          <Queue queue={state.queue} currentId={room.current_item_id} canManage={role.canManageQueue} roomId={room.id} token={token} />
        </section>
```

- [ ] **Step 3: Type-check, lint, unit tests**

```bash
npx tsc --noEmit
npm run lint
npm test
```

Expected: all clean; unit suite passes (existing + 9 new tests).

- [ ] **Step 4: Manual check in the browser** (dev server: `npm run dev`, open a room)

Walk through every row; each must hold in **both** themes (toggle 🎩/🎮 in the header):

| Action | Expected |
|---|---|
| Type `nếu như` | ≤ 10 suggestions drop down under the box after ~250 ms; button reads **Tìm** |
| Keep typing quickly | list updates, never flickers back to an older list |
| ↓ ↓ ↑ | highlight moves (wraps), row turns `parchment-200` |
| Enter on a highlighted row | box fills with that text, dropdown closes and **stays closed**, results panel appears above "Hàng đợi" |
| Click a suggestion with the mouse | same as Enter on it |
| Enter with nothing highlighted | searches the typed text |
| Results panel | header `Kết quả cho "…" · N`, rows thumb·title·channel·duration, scrolls inside at ~40vh |
| **+ Thêm** on a row | spinner → `✓ Đã thêm` (disabled); the song appears in "Hàng đợi" with a duration; panel stays open; a second row can be added |
| ✕ / Esc (dropdown closed) | panel closes |
| Clear the box | panel closes |
| Search gibberish `zzqqxxvv1234zz` | `Không có kết quả.` |
| Paste `https://youtu.be/dQw4w9WgXcQ` | button reads **+ Thêm**, no suggestions, Enter adds the video as before |
| Paste a `…/playlist?list=…` link | adds the playlist as before (`Đã thêm N bài từ playlist.`) |
| Type `nhacsontung` (11 lowercase letters) | treated as a **search**, not an id |

- [ ] **Step 5: Commit**

```bash
git add components/room/AddSong.tsx components/room/RoomShell.tsx
git commit -m "feat: smart add-song box — YouTube suggestions while typing, video search on Enter

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

# Phase 4 — Docs

## Task 7: README v8 notes

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Fix the stale Phase-2 note**

In the `### Notes` list near the top, replace

```md
- Phase 2 (deferred): chat, emoji reactions, song likes (UI placeholders already present); optional in-app YouTube search (needs a `YOUTUBE_API_KEY`).
```

with

```md
- Song likes are still a UI placeholder. Chat, emoji reactions (v4) and in-app YouTube search (v8, key-free) are done.
```

- [ ] **Step 2: Append the v8 section** at the end of `README.md` (after the v7 section):

```md
## v8: Tìm bài trực tiếp từ YouTube (in-app search)

**No migration, no config, no API key.** The room's "add song" box is now a smart box:

- **Paste a link** (video or playlist) → adds it, exactly as before.
- **Type keywords** → YouTube's own suggestions appear under the box as you type (↑/↓ to pick, Enter to search, Esc to close). Enter — or the **Tìm** button — runs a YouTube *video* search; results (thumb · title · channel · duration) show above the queue with a **+ Thêm** button per row. The panel stays open so you can queue several songs in a row; added rows turn into "✓ Đã thêm".
- Songs added from search carry their **duration** (`duration_seconds`), which pasted links never had.

How it works: two tiny same-origin proxies — `/api/yt/suggest` (YouTube's suggest feed) and `/api/yt/search` (YouTube's InnerTube search with the video-only filter) — called anonymously: no cookies, no login, no key. Both fail soft (empty list / a friendly message). Language and region are fixed to `vi` / `VN`.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: v8 notes — in-app YouTube search

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Done criteria

- `npm test`, `npm run lint`, `npx tsc --noEmit` all clean on `feat/v8-yt-search`.
- The Task 6 manual table passes in both themes.
- Pasting video / playlist links behaves exactly as on `main`.
- No cookie, `authorization`, `key`, or visitor-id value from the captured browser requests appears anywhere in the diff (`git diff main --stat` then `git diff main | grep -iE "SAPISID|LOGIN_INFO|visitor|authuser"` → no matches).
