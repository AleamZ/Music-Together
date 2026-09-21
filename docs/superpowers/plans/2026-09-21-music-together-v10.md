# Music Together v10 Implementation Plan — Listen-Along Playback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every member's device plays the current track in sync with the room; the DJ keeps the only transport controls (▶/⏸, ⏭, seek); everyone gets a local volume slider and a one-time "🔈 Bật âm thanh" gate for the browser's autoplay policy.

**Architecture:** `hooks/useDjController.ts` is replaced by `hooks/usePlayback.ts`, one engine for everyone: the hidden YouTube player loads/positions/plays/pauses from the room row (`current_item_id`, `is_playing`, `started_at`, `paused_elapsed_ms`) and corrects drift against that clock every 5 s; the DJ-only branches (advance on ended / auto-advance, `set_playback`, `seek_playback`) are unchanged and still `isDj`-gated (and RPC-enforced). Pure timing helpers live in `lib/playback-sync.ts` with unit tests. `NowPlaying` gains the gate button, a volume slider for all, captions and a per-device error line. No DB/RPC change.

**Tech Stack:** Next.js 16.2.9, React 19, TS 5, Tailwind v4, YouTube IFrame API (existing `useYouTubePlayer`), Supabase Realtime (existing), Vitest.

**Spec:** [docs/superpowers/specs/2026-09-21-music-together-v10-listen-along-design.md](../specs/2026-09-21-music-together-v10-listen-along-design.md).

## Global Constraints

- **Room row is the clock.** Position = `computeElapsedMs(room)` (wall clock from `started_at`, or `paused_elapsed_ms` when paused). Nobody's player is a source of truth — the DJ's player is drift-corrected too.
- **No DB / RPC / migration changes.** `set_playback`, `seek_playback`, `advance_queue` keep `_auth(... 'dj')`; listeners' controller methods are no-ops.
- **Autoplay policy:** never call `yt.play()` while `unlocked === false`; `unlock()` must call `seekTo` + `play()` synchronously inside the click handler. `unlocked` becomes `true` automatically when `navigator.userActivation?.hasBeenActive` is already true (the document already had a gesture, e.g. the click that entered the room).
- **Constants:** drift tick `1000` ms, drift check every 5 ticks, tolerance `2` s, duration capture from the tick (no 1.2 s timer any more), volume key `music-together:volume` (existing).
- **Copy (Vietnamese, verbatim):** `🔈 Bật âm thanh` · `Điều khiển phát / tua — chỉ DJ` (DJ caption) · `Đang nghe cùng phòng · DJ điều khiển` (listener caption) · `Video này không phát được trên thiết bị của bạn.` · existing `DJ đang offline — chờ DJ` / `Hàng đợi trống` unchanged.
- **Theme tokens only** (`burgundy`, `burgundy-accent`, `cream`, `gold`, `ink`, `green-vintage`, `font-cormorant`); no new CSS.
- **React-Compiler hook rules are on:** never assign `ref.current` during render (sync refs inside a `useEffect` with no deps, as `useYouTubePlayer` does); a synchronous setState inside an effect needs the repo's existing `// eslint-disable-next-line react-hooks/set-state-in-effect` precedent and a one-line reason; never read `ref.current` during render.
- **Lint gate:** `npm run lint` = 0 errors and exactly the 3 pre-existing warnings (NowPlaying.tsx `exhaustive-deps` at the clock effect, Queue.tsx `no-img-element`, useDjController.ts `exhaustive-deps`) — **note:** deleting `useDjController.ts` removes one of them, so after Task 2 the baseline is **2 warnings**; do not "fix" the other two. `npx tsc --noEmit` clean; `npm test` green.
- **Commits** end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Branch:** `feat/v10-listen-along` from `main` (v9 merged, spec committed at `aa2a72f`).

---

## File map (v10)

```
lib/playback-sync.ts                 # CREATE: targetSeconds, needsResync, shouldPlay (pure)              (Task 1)
tests/unit/playback-sync.test.ts     # CREATE                                                                (Task 1)
hooks/usePlayback.ts                 # CREATE: engine for everyone + DJ-only writes                          (Task 2)
hooks/useDjController.ts             # DELETE                                                                (Task 2)
components/room/RoomShell.tsx        # MODIFY: usePlayback (Task 2); pass unlocked/onUnlock/playError (Task 3)
components/room/NowPlaying.tsx       # MODIFY: gate button, volume for all, captions, playError            (Task 3)
README.md                            # MODIFY: v10 section                                                   (Task 3)
```

---

## Task 1: `lib/playback-sync.ts` — pure timing helpers (TDD)

**Files:**
- Create: `lib/playback-sync.ts`
- Test: `tests/unit/playback-sync.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used by Task 2):
  ```ts
  export type PlaybackClock = { is_playing: boolean; started_at: string | null; paused_elapsed_ms: number };
  export function targetSeconds(room: PlaybackClock, now?: number): number
  export function needsResync(playerSec: number, room: PlaybackClock, now?: number, toleranceSec?: number): boolean  // tolerance default 2
  export function shouldPlay(room: { is_playing: boolean }, unlocked: boolean, hasCurrent: boolean): boolean
  ```

- [ ] **Step 1: Branch**

```bash
git checkout main && git pull && git checkout -b feat/v10-listen-along
```

- [ ] **Step 2: Write the failing tests** — create `tests/unit/playback-sync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { needsResync, shouldPlay, targetSeconds } from "@/lib/playback-sync";

const NOW = 1_700_000_000_000;
const playing = (startedAgoMs: number) => ({ is_playing: true, started_at: new Date(NOW - startedAgoMs).toISOString(), paused_elapsed_ms: 0 });
const paused = (elapsedMs: number) => ({ is_playing: false, started_at: null, paused_elapsed_ms: elapsedMs });

describe("targetSeconds", () => {
  it("is the wall-clock elapsed time while playing, floored to seconds", () => {
    expect(targetSeconds(playing(65_400), NOW)).toBe(65);
    expect(targetSeconds(playing(999), NOW)).toBe(0);
  });
  it("is the frozen paused position while paused", () => {
    expect(targetSeconds(paused(12_999), NOW)).toBe(12);
    expect(targetSeconds(paused(0), NOW)).toBe(0);
  });
  it("never goes negative (started_at slightly in the future from clock skew)", () => {
    expect(targetSeconds(playing(-5_000), NOW)).toBe(0);
  });
  it("treats a playing room without started_at as paused at paused_elapsed_ms", () => {
    expect(targetSeconds({ is_playing: true, started_at: null, paused_elapsed_ms: 30_000 }, NOW)).toBe(30);
  });
});

describe("needsResync", () => {
  it("is false within the 2 s default tolerance (inclusive) and true beyond it", () => {
    expect(needsResync(65, playing(65_400), NOW)).toBe(false);
    expect(needsResync(63, playing(65_400), NOW)).toBe(false);
    expect(needsResync(67, playing(65_400), NOW)).toBe(false);
    expect(needsResync(62, playing(65_400), NOW)).toBe(true);
    expect(needsResync(70, playing(65_400), NOW)).toBe(true);
  });
  it("honours a custom tolerance", () => {
    expect(needsResync(64, playing(65_400), NOW, 0.5)).toBe(true);
    expect(needsResync(64, playing(65_400), NOW, 5)).toBe(false);
  });
  it("compares against the paused position while paused", () => {
    expect(needsResync(12, paused(12_000), NOW)).toBe(false);
    expect(needsResync(30, paused(12_000), NOW)).toBe(true);
  });
});

describe("shouldPlay", () => {
  it("plays only when the room plays, the device is unlocked and there is a track", () => {
    expect(shouldPlay({ is_playing: true }, true, true)).toBe(true);
    expect(shouldPlay({ is_playing: false }, true, true)).toBe(false);
    expect(shouldPlay({ is_playing: true }, false, true)).toBe(false);
    expect(shouldPlay({ is_playing: true }, true, false)).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npx vitest run tests/unit/playback-sync.test.ts
```

Expected: FAIL — `Failed to resolve import "@/lib/playback-sync"`.

- [ ] **Step 4: Create `lib/playback-sync.ts`**

```ts
/** Pure timing helpers for listen-along playback. The room row is the clock; players follow it. */
export type PlaybackClock = { is_playing: boolean; started_at: string | null; paused_elapsed_ms: number };

/** Where the room is right now, in whole seconds (never negative). */
export function targetSeconds(room: PlaybackClock, now: number = Date.now()): number {
  const elapsedMs = room.is_playing && room.started_at
    ? now - new Date(room.started_at).getTime()
    : room.paused_elapsed_ms;
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/** True when a player has drifted more than `toleranceSec` from the room clock. */
export function needsResync(playerSec: number, room: PlaybackClock, now: number = Date.now(), toleranceSec = 2): boolean {
  return Math.abs(playerSec - targetSeconds(room, now)) > toleranceSec;
}

/** A device may produce sound only when the room plays, the autoplay gate is open and a track is loaded. */
export function shouldPlay(room: { is_playing: boolean }, unlocked: boolean, hasCurrent: boolean): boolean {
  return room.is_playing && unlocked && hasCurrent;
}
```

- [ ] **Step 5: Run to verify it passes, gates, commit**

```bash
npx vitest run tests/unit/playback-sync.test.ts
npx tsc --noEmit && npm run lint && npm test
git add lib/playback-sync.ts tests/unit/playback-sync.test.ts
git commit -m "feat: playback-sync — room-clock timing helpers for listen-along (pure, tested)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: `hooks/usePlayback.ts` — one engine for everyone

**Files:**
- Create: `hooks/usePlayback.ts`
- Delete: `hooks/useDjController.ts`
- Modify: `components/room/RoomShell.tsx` (import + hook call only)

**Interfaces:**
- Consumes: Task 1 helpers; `useYouTubePlayer(onEnded?, onError?)` (`hooks/useYouTubePlayer.ts`); `advanceQueue`, `setPlayback`, `seekPlayback` (`lib/supabase.ts`); `computeElapsedMs` (`lib/identity.ts`).
- Produces (used by Task 3):
  ```ts
  export interface PlaybackController {
    durationMs: number; volume: number; unlocked: boolean; unlock: () => void; playError: string | null;
    togglePlay: () => void; skip: () => void; seekMs: (ms: number) => void; setVolume: (v: number) => void;
  }
  export function usePlayback(args: { room: Room; current: QueueItem | null; isDj: boolean; queueLen: number; roomId: string; token: string }): PlaybackController
  ```

- [ ] **Step 1: Create `hooks/usePlayback.ts`**

```ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { computeElapsedMs } from "@/lib/identity";
import { needsResync, shouldPlay, targetSeconds } from "@/lib/playback-sync";
import { advanceQueue, seekPlayback, setPlayback, type QueueItem, type Room } from "@/lib/supabase";

const VOL_KEY = "music-together:volume";
const TICK_MS = 1000;
const DRIFT_EVERY_TICKS = 5;
const PLAY_ERROR = "Video này không phát được trên thiết bị của bạn.";

export interface PlaybackController {
  durationMs: number;
  volume: number;
  unlocked: boolean;              // autoplay gate passed on this device
  unlock: () => void;             // call from a click handler
  playError: string | null;       // this device could not play the current track
  togglePlay: () => void;         // DJ only (no-op otherwise)
  skip: () => void;               // DJ only
  seekMs: (ms: number) => void;   // DJ only
  setVolume: (v: number) => void; // everyone (local)
}

/** Playback engine for EVERY member. The hidden player follows the room row (track, play/pause,
 *  position, drift); only the DJ branches write room state (advance, play/pause, seek).
 *  Effects depend on primitives (ids, flags) and on the player hook's stable callbacks — never on the
 *  `room`/`current` objects, which are re-created on every realtime refetch and would re-seek the player. */
export function usePlayback({ room, current, isDj, queueLen, roomId, token }: {
  room: Room; current: QueueItem | null; isDj: boolean; queueLen: number; roomId: string; token: string;
}): PlaybackController {
  const [durationMs, setDurationMs] = useState(0);
  const [volume, setVol] = useState(100);
  const [unlocked, setUnlocked] = useState(false);
  const [playErr, setPlayErr] = useState<{ trackId: string; message: string } | null>(null);
  const loadedRef = useRef<string | null>(null); // currently loaded queue item id

  const currentId = current?.id ?? null;
  const currentVideoId = current?.youtube_video_id ?? null;
  const playing = room.is_playing;
  const startedAt = room.started_at;
  const pausedElapsed = room.paused_elapsed_ms;

  // Latest room row for timers/handlers (synced after render — never assigned during render).
  const roomRef = useRef(room);
  useEffect(() => { roomRef.current = room; });

  // DJ only — single-flight guard: onEnded / auto-advance / skip must never advance twice for one slot.
  const advancingRef = useRef(false);
  const advance = useCallback(() => {
    if (!isDj || advancingRef.current) return;
    advancingRef.current = true;
    void advanceQueue(roomId, token).catch(() => { advancingRef.current = false; });
  }, [isDj, roomId, token]);
  useEffect(() => {
    if (room.current_item_id || queueLen === 0) advancingRef.current = false;
  }, [room.current_item_id, queueLen]);

  // Listeners do nothing on ended: the DJ's advance changes current_item_id and realtime delivers it.
  const { ready, load, play, pause, seekTo, setVolume: setPlayerVolume, getDuration, getCurrentTime } = useYouTubePlayer(
    () => advance(),
    () => setPlayErr(currentId ? { trackId: currentId, message: PLAY_ERROR } : null),
  );

  // Restore saved volume once.
  useEffect(() => {
    const v = Number(localStorage.getItem(VOL_KEY));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from localStorage
    if (!Number.isNaN(v) && v > 0) setVol(v);
  }, []);
  // A document that already had a user gesture (e.g. the click that entered the room) may play with sound.
  useEffect(() => {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of browser activation state
    if (ua?.hasBeenActive) setUnlocked(true);
  }, []);
  // Apply volume for everyone whenever it changes / the player becomes ready.
  useEffect(() => { if (ready) setPlayerVolume(volume); }, [ready, volume, setPlayerVolume]);

  // Load + position the current track whenever it changes (everyone).
  useEffect(() => {
    if (!ready) return;
    if (!currentId || !currentVideoId) { loadedRef.current = null; return; }
    if (loadedRef.current === currentId) return;
    loadedRef.current = currentId;
    const r = roomRef.current;
    load(currentVideoId, targetSeconds(r));
    if (shouldPlay(r, unlocked, true)) play(); else pause();
  }, [ready, currentId, currentVideoId, unlocked, load, play, pause]);

  // Follow play/pause (everyone). playVideo() on a playing player is a no-op, so re-runs are harmless.
  useEffect(() => {
    if (!ready || !currentId) return;
    if (shouldPlay({ is_playing: playing }, unlocked, true)) play(); else pause();
  }, [ready, playing, unlocked, currentId, play, pause]);

  // Follow seeks / pause-resume (everyone): a changed clock origin means "jump to the room position".
  useEffect(() => {
    if (!ready || !currentId || loadedRef.current !== currentId) return;
    seekTo(targetSeconds(roomRef.current));
  }, [ready, currentId, startedAt, pausedElapsed, seekTo]);

  // Tick (everyone): capture the duration once known; every 5 s correct drift against the room clock.
  useEffect(() => {
    if (!ready || !currentId) return;
    let n = 0;
    const id = setInterval(() => {
      n += 1;
      const d = getDuration();
      if (d > 0) setDurationMs((prev) => (prev === d * 1000 ? prev : d * 1000));
      const r = roomRef.current;
      if (n % DRIFT_EVERY_TICKS === 0 && r.is_playing && unlocked && needsResync(getCurrentTime(), r)) {
        seekTo(targetSeconds(r));
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [ready, currentId, unlocked, getDuration, getCurrentTime, seekTo]);

  // DJ only — auto-advance: nothing playing and the queue has items -> start the next track.
  useEffect(() => {
    if (!isDj || !ready) return;
    if (!room.current_item_id && !room.is_playing && queueLen > 0) advance();
  }, [isDj, ready, room.current_item_id, room.is_playing, queueLen, advance]);

  /** Autoplay gate: must run inside a click handler so the browser honours play(). */
  const unlock = useCallback(() => {
    setUnlocked(true);
    const r = roomRef.current;
    if (r.is_playing && currentId) { seekTo(targetSeconds(r)); play(); }
  }, [currentId, seekTo, play]);

  const togglePlay = useCallback(() => {
    if (!isDj) return;
    const nowPlaying = !room.is_playing;
    if (nowPlaying) {
      // resume: started_at = now - paused_elapsed
      const startedAtIso = new Date(Date.now() - room.paused_elapsed_ms).toISOString();
      void setPlayback(roomId, token, { isPlaying: true, startedAt: startedAtIso, pausedElapsedMs: room.paused_elapsed_ms });
    } else {
      const elapsed = computeElapsedMs(room);
      void setPlayback(roomId, token, { isPlaying: false, startedAt: null, pausedElapsedMs: elapsed });
    }
  }, [isDj, room, roomId, token]);

  const skip = useCallback(() => advance(), [advance]);

  const seekMs = useCallback((ms: number) => {
    if (!isDj) return;
    seekTo(ms / 1000);
    void seekPlayback(roomId, token, Math.floor(ms));
  }, [isDj, roomId, token, seekTo]);

  const setVolume = useCallback((v: number) => {
    setVol(v);
    localStorage.setItem(VOL_KEY, String(v));
    setPlayerVolume(v);
  }, [setPlayerVolume]);

  const playError = playErr && playErr.trackId === currentId ? playErr.message : null;

  return { durationMs, volume, unlocked, unlock, playError, togglePlay, skip, seekMs, setVolume };
}
```

- [ ] **Step 2: Delete `hooks/useDjController.ts`** (`git rm hooks/useDjController.ts`).

- [ ] **Step 3: `components/room/RoomShell.tsx`** — replace the import and the hook call:

```tsx
import { usePlayback } from "@/hooks/usePlayback";
```

```tsx
  // Playback engine for everyone (DJ-only writes inside). Returns transport handlers + duration/volume/gate.
  const dj = usePlayback({ room, current, isDj: role.isDj, queueLen: approved.length, roomId: room.id, token });
```

(keep the variable name `dj` in this task so the `NowPlaying` props below it compile unchanged; Task 3 renames nothing either.)

- [ ] **Step 4: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
```

Expected: tsc clean; lint 0 errors / **2** warnings (NowPlaying.tsx, Queue.tsx — the useDjController one is gone with the file); `npm test` unchanged.

```bash
git add hooks/usePlayback.ts hooks/useDjController.ts components/room/RoomShell.tsx
git commit -m "feat: usePlayback — every member's player follows the room clock; DJ keeps the writes

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: `NowPlaying` gate / volume / captions + `RoomShell` props + README

**Files:**
- Modify: `components/room/NowPlaying.tsx`
- Modify: `components/room/RoomShell.tsx` (the `<NowPlaying …>` element)
- Modify: `README.md`

**Interfaces:**
- Consumes: `PlaybackController` (Task 2).
- Produces: `NowPlayingProps` gains `unlocked: boolean; onUnlock: () => void; playError: string | null`.

- [ ] **Step 1: `components/room/NowPlaying.tsx`** — apply these edits:

Props interface — add three fields after `djOnline`:

```ts
  unlocked: boolean;            // autoplay gate passed on this device
  onUnlock: () => void;         // 🔈 button
  playError: string | null;     // this device could not play the current track
```

Replace the whole `{p.canControl && ( … )}` block (from `{p.canControl && (` through its closing `)}`) with:

```tsx
      {!p.unlocked && (
        <button onClick={p.onUnlock} className="rounded-full bg-burgundy px-4 py-2 text-cream">🔈 Bật âm thanh</button>
      )}

      <div className="flex items-center gap-3">
        {p.canControl && (
          <>
            <button onClick={p.onPlayPause} className="h-13 w-13 rounded-full bg-burgundy px-4 py-2 text-cream">
              {room.is_playing ? "⏸" : "▶"}
            </button>
            <button onClick={p.onSkip} className="rounded-full border border-gold bg-cream px-4 py-2 text-burgundy">⏭</button>
          </>
        )}
        <label className="flex items-center gap-1 text-xs text-ink/80">🔊
          <input type="range" min={0} max={100} value={p.volume}
            onChange={(e) => p.onVolume(Number(e.target.value))} className="w-20 accent-burgundy" aria-label="volume" />
        </label>
      </div>
      <p className="text-[11px] text-green-vintage">
        {p.canControl ? "Điều khiển phát / tua — chỉ DJ" : "Đang nghe cùng phòng · DJ điều khiển"}
      </p>
      {p.playError && <p className="text-[11px] text-burgundy-accent">{p.playError}</p>}
```

Everything above it (turntable, title, clock + seek bar with `disabled={!p.canControl || dur === 0}`) stays as is.

- [ ] **Step 2: `components/room/RoomShell.tsx`** — the `<NowPlaying …>` element becomes:

```tsx
          <NowPlaying
            room={room} current={current} canControl={role.canControlPlayback}
            durationMs={dj.durationMs} volume={dj.volume} djOnline={djOnline}
            unlocked={dj.unlocked} onUnlock={dj.unlock} playError={dj.playError}
            onPlayPause={dj.togglePlay} onSkip={dj.skip} onSeekMs={dj.seekMs} onVolume={dj.setVolume}
          />
```

- [ ] **Step 3: README** — append after the v9 section (CRLF preserved):

```md
## v10: Nghe cùng phòng (listen-along)

**No migration, no config.** Every member's device now plays the current track **in sync** with the room:

- Playback follows the room clock (`started_at` / paused position): a listener who joins mid-song hears it from the right spot; DJ pause/resume/seek/skip propagate to everyone within a second or two (drift is corrected every 5 s).
- **Only the DJ** has ▶/⏸, ⏭ and the seek bar — the playback RPCs still require the DJ role, so listeners cannot change the room's playback even by calling the API. Listeners see "Đang nghe cùng phòng · DJ điều khiển".
- Everyone has a **local** 🔊 volume slider (their own device only).
- **🔈 Bật âm thanh:** browsers refuse to start audio without a user gesture, so a member who opened the room URL directly sees this button once; members who clicked their way in from the lobby usually don't.
- A video that cannot be played on a particular device (embedding disabled, region) shows a small notice on that device only; the room is unaffected.
```

- [ ] **Step 4: Gates + commit**

```bash
npx tsc --noEmit && npm run lint && npm test
git add components/room/NowPlaying.tsx components/room/RoomShell.tsx README.md
git commit -m "feat: listen-along UI — audio gate, volume for everyone, DJ-only transport captions

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Manual check (controller + user, two browsers / two accounts)**

| Action | Expected |
|---|---|
| Listener opens the room URL directly while a track plays | 🔈 button shown; nothing audible; clock ticks |
| Listener presses 🔈 | audio starts at the room position (± 2 s); button disappears |
| Listener enters from the lobby by clicking "Vào" | audio starts without the button (document already active) |
| DJ ⏸ / ▶ | listener pauses / resumes within ~1 s |
| DJ drags the seek bar | listener jumps to the same position |
| DJ ⏭ | listener switches to the next track |
| Listener moves 🔊 | only their device changes; DJ unaffected |
| Listener UI | no ▶/⏸/⏭; seek bar disabled; caption "Đang nghe cùng phòng · DJ điều khiển" |
| DJ UI | ▶/⏸ ⏭ + 🔊; caption "Điều khiển phát / tua — chỉ DJ" |
| DJ closes the tab mid-track | listener keeps hearing to the end; then "DJ đang offline — chờ DJ" |
| Listener's device can't play a video | "Video này không phát được trên thiết bị của bạn." only there |
| Both themes | gate button/captions render with theme colors |

---

## Done criteria

- `npm test`, `npm run lint` (0 errors, 2 baseline warnings), `npx tsc --noEmit` clean on `feat/v10-listen-along`.
- Manual table passes with two accounts.
- `git diff main --stat` touches only the seven files in the file map.
