# Music Together v10 — Listen-Along Playback for Every Member (Design)

**Date:** 2026-09-21
**Builds on:** v9 (merged to `main`). Next.js 16.2.9, React 19, TS 5, Tailwind v4, Supabase (Postgres + Realtime), custom account/session auth, SECURITY DEFINER RPCs.

## 1. Goal

Today only the **DJ's browser** loads the YouTube player and produces sound (`useDjController` is a no-op for everyone else); other members see the turntable and a clock but hear nothing. v10 makes **every member's device play the current song in sync** with the room, while **control stays with the DJ**:

- Everyone hears the current track at the room's position; play/pause follows the DJ; a listener who joins mid-track hears it from the right spot.
- Only the DJ has ▶/⏸, ⏭ and the seek bar. Listeners get **no transport control** — they can only listen.
- Each member has a **local** volume slider (affects only their own device) and must press **"🔈 Bật âm thanh"** once so the browser allows audio (autoplay policy).

No DB, RPC or migration changes: the write RPCs (`set_playback`, `seek_playback`, `advance_queue`) keep `_auth(... 'dj')`, so a listener cannot alter room playback even by calling the API directly.

## 2. Constraints (carried from v1–v9)

- **Room state is the single source of truth:** `rooms.is_playing`, `started_at`, `paused_elapsed_ms`, `current_item_id`; elapsed time = `computeElapsedMs(room)` (wall clock from `started_at`), not anyone's player.
- **Realtime full-state refetch** already delivers every `rooms` change to every member; no new channel.
- **Browser autoplay policy:** audio playback requires a user gesture on the page. A player's `playVideo()` must be called inside a click handler the first time.
- **Theme tokens only;** no new CSS; React-Compiler hook rules (no synchronous setState in effects; no `ref.current` during render).
- **Repo conventions:** pure logic in `lib/` with unit tests; hooks/components verified manually.

## 3. Playback engine — `hooks/usePlayback.ts` (replaces `hooks/useDjController.ts`)

Same inputs as today (`{ room, current, isDj, queueLen, roomId, token }`); the returned controller gains three fields:

```ts
export interface PlaybackController {
  durationMs: number;
  volume: number;
  unlocked: boolean;              // audio gate passed on this device
  unlock: () => void;             // call from a click handler
  playError: string | null;       // this device could not play the current video
  togglePlay: () => void;         // DJ only (no-op otherwise)
  skip: () => void;               // DJ only
  seekMs: (ms: number) => void;   // DJ only
  setVolume: (v: number) => void; // everyone (local)
}
```

### 3.1 Everyone

- Creates the hidden player via `useYouTubePlayer(onEnded, onError)`.
- **Load:** when `current?.id` changes (or the player becomes ready with a current track): `yt.load(videoId, targetSeconds(room))`; then `yt.play()` if `shouldPlay(room, unlocked, !!current)` else `yt.pause()`. `durationMs` captured ~1.2 s after load (as today).
- **Play/pause follow:** when `room.is_playing` changes: `shouldPlay(room, unlocked, !!current) ? yt.play() : yt.pause()`.
- **Seek follow:** when `room.started_at` / `paused_elapsed_ms` change while the same track is loaded (a DJ seek or pause/resume), `yt.seekTo(targetSeconds(room))`.
- **Drift correction:** every 5 s while `room.is_playing && current && unlocked`: if `needsResync(yt.getCurrentTime(), room)` → `yt.seekTo(targetSeconds(room))`. Applies to the DJ too (the DB clock is the truth).
- **Audio gate:** `unlocked` starts `false`. While `false` the engine never calls `yt.play()`. `unlock()` sets it `true` and, if `room.is_playing && current`, calls `yt.seekTo(targetSeconds(room)); yt.play()` synchronously in the same call so the gesture is honored. `unlocked` is React state only (a page reload needs a new gesture; that is how browsers work).
- **Volume:** local, persisted in `localStorage["music-together:volume"]` (existing key), applied to the player for everyone (today only for the DJ).
- **Errors:** `onError(code)` → `playError = "Video này không phát được trên thiết bị của bạn."`; cleared when `current?.id` changes. A listener's error never touches room state.

### 3.2 DJ only (unchanged behavior, now guarded by `isDj`)

- `onEnded` → `advance()` (single-flight guard as today). Listeners' `onEnded` does nothing — they wait for the DJ's `advance_queue` to change `current_item_id` via realtime.
- Auto-advance when nothing is playing and the queue has items.
- `togglePlay`, `skip`, `seekMs` write through the existing RPCs; for non-DJ they are no-ops (the RPCs also refuse them).

### 3.3 Pure helpers — `lib/playback-sync.ts` (unit-tested)

```ts
export function targetSeconds(room: Pick<Room, "is_playing" | "started_at" | "paused_elapsed_ms">, now = Date.now()): number
  // Math.max(0, Math.floor(elapsedMs / 1000)) where elapsedMs = paused_elapsed_ms when paused, else now - started_at
export function needsResync(playerSec: number, room: …, now = Date.now(), toleranceSec = 2): boolean
  // Math.abs(playerSec - targetSeconds(room, now)) > toleranceSec
export function shouldPlay(room: Pick<Room, "is_playing">, unlocked: boolean, hasCurrent: boolean): boolean
  // room.is_playing && unlocked && hasCurrent
```

`computeElapsedMs` (lib/identity.ts) stays the elapsed-clock primitive; `targetSeconds` wraps it with an injectable `now` for tests.

## 4. UI — `components/room/NowPlaying.tsx`

- New props: `unlocked: boolean`, `onUnlock: () => void`, `playError: string | null`. `canControl` keeps meaning "is DJ".
- **Audio gate button** (everyone, until `unlocked`): `🔈 Bật âm thanh` — a burgundy pill under the clock; `onClick={p.onUnlock}`. After unlocking it disappears.
- **Volume** (everyone): the existing 🔊 slider moves out of the DJ-only block and renders for all members.
- **Transport** (DJ only, unchanged): ▶/⏸ and ⏭. Seek bar stays `disabled` for non-DJ (already the case).
- **Captions:** DJ → `Điều khiển phát / tua — chỉ DJ`; listener → `Đang nghe cùng phòng · DJ điều khiển`.
- **Errors:** `playError` renders as `text-[11px] text-burgundy-accent` under the controls.
- "DJ đang offline — chờ DJ" stays when there is no current track; with a current track, everyone keeps hearing it to the end even if the DJ dropped.

`RoomShell.tsx`: `useDjController(...)` → `usePlayback(...)`; pass the three new props to `NowPlaying`.

## 5. Error handling

| Situation | Behaviour |
|---|---|
| Listener has not pressed the gate | player loaded and cued at the room position, silent; gate button visible |
| Browser blocks play despite the gate (rare) | player stays paused; next room change retries; no error text |
| Video not embeddable / region-locked on a device | `playError` message on that device only |
| DJ offline mid-track | everyone plays to the end; queue does not advance until a DJ is online (existing) |
| Drift > 2 s (tab throttling, buffering) | corrected on the next 5 s tick |
| Listener calls a playback RPC | `42501` from `_auth('dj')` (unchanged) |

## 6. Testing

- **Unit** (`tests/unit/playback-sync.test.ts`): `targetSeconds` while playing (now − started_at), while paused (paused_elapsed_ms), never negative, floors; `needsResync` inside/outside tolerance, custom tolerance; `shouldPlay` truth table (playing × unlocked × hasCurrent).
- **Manual (two browsers / two accounts):** listener joins while a track plays → presses 🔈 → hears it at the right position; DJ pauses → listener pauses; DJ resumes → listener resumes; DJ seeks → listener follows within a tick; DJ skips → listener switches; listener changes volume → only their device; listener has no ▶/⏸/⏭ and a disabled seek bar; DJ closes tab mid-track → listener keeps hearing to the end, then "DJ đang offline — chờ DJ"; both themes.

## 7. File map (v10)

```
lib/playback-sync.ts                 # CREATE: targetSeconds, needsResync, shouldPlay (pure)
tests/unit/playback-sync.test.ts     # CREATE
hooks/usePlayback.ts                 # CREATE: engine for everyone + DJ-only writes (from useDjController)
hooks/useDjController.ts             # DELETE (superseded)
components/room/NowPlaying.tsx       # MODIFY: gate button, volume for all, captions, playError
components/room/RoomShell.tsx        # MODIFY: usePlayback + new NowPlaying props
README.md                            # MODIFY: v10 section
```

## 8. Out of scope (YAGNI / future)

- Listeners advancing the queue when the DJ is offline (would need `advance_queue` for non-DJ).
- Background playback on mobile with the screen off; picture/video view (turntable stays).
- Per-room "listen-along on/off" toggle.
- Sub-second sync (WebRTC audio streaming).
