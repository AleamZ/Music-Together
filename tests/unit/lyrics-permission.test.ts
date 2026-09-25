import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

const db = vi.hoisted(() => ({ fetchVideoLyrics: vi.fn(), saveVideoLyrics: vi.fn(), updateVideoLyricOffset: vi.fn() }));
vi.mock("@/lib/lyrics/db", () => db);
const sync = vi.hoisted(() => ({ joinLyricSync: vi.fn(), send: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/lyrics/channel", () => ({ joinLyricSync: sync.joinLyricSync }));

import { useLyrics, type UseLyricsProps } from "@/hooks/useLyrics";

const ROOM = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "f3a1c2d4e5b6a7980f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2";
const VIDEO = "dQw4w9WgXcQ";
const API_LYRICS = { trackName: "API Track", artistName: "API Artist", syncedLyrics: "[00:01.00] From the API" };

let song = 0;
/** A fresh title per render: the hook's lyrics cache is module-wide. */
const props = (over: Partial<UseLyricsProps> = {}): UseLyricsProps => ({
  title: `Permission song ${++song}`,
  durationSeconds: 180,
  elapsedMs: 5000,
  roomId: ROOM,
  trackId: "track-123",
  youtubeVideoId: VIDEO,
  sessionToken: TOKEN,
  canControl: false,
  ...over,
});

/** Props are built once: a new title on every render would refetch forever. */
const mount = (p: UseLyricsProps) => renderHook(() => useLyrics(p));

beforeEach(() => {
  for (const f of [...Object.values(db), ...Object.values(sync)]) f.mockReset();
  db.fetchVideoLyrics.mockResolvedValue(null);
  db.saveVideoLyrics.mockResolvedValue(true);
  db.updateVideoLyricOffset.mockResolvedValue(true);
  sync.joinLyricSync.mockReturnValue({ send: sync.send, unsubscribe: sync.unsubscribe });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useLyrics permission gating (DJ vs listener)", () => {
  it("keeps a listener's offset change local: no cache write, no broadcast", async () => {
    const { result } = mount(props());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setOffsetMs(1500, true));
    expect(result.current.offsetMs).toBe(1500);
    await act(async () => {});
    expect(db.updateVideoLyricOffset).not.toHaveBeenCalled();
    expect(sync.send).not.toHaveBeenCalled();
  });

  it("keeps a listener's custom lyrics local: no cache write, no broadcast", async () => {
    const { result } = mount(props());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.applyCustomLyric({ trackName: "Custom", syncedLyrics: "[00:01.00] Line 1" }, true));
    expect(result.current.meta?.trackName).toBe("Custom");
    await act(async () => {});
    expect(db.saveVideoLyrics).not.toHaveBeenCalled();
    expect(sync.send).not.toHaveBeenCalled();
  });

  it("never lets a listener cache what the lyrics API found", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(API_LYRICS)));
    const { result } = mount(props());
    await waitFor(() => expect(result.current.meta?.trackName).toBe("API Track"));
    await act(async () => {});
    expect(db.saveVideoLyrics).not.toHaveBeenCalled();
  });

  it("writes the DJ's offset with the room and the session", async () => {
    const { result } = mount(props({ canControl: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.setOffsetMs(2500, true));
    expect(result.current.offsetMs).toBe(2500);
    await waitFor(() => expect(db.updateVideoLyricOffset).toHaveBeenCalledTimes(1));
    expect(db.updateVideoLyricOffset).toHaveBeenCalledWith(ROOM, TOKEN, VIDEO, 2500);
  });

  it("writes the DJ's custom lyrics with the room and the session, and no name", async () => {
    const { result } = mount(props({ canControl: true }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() =>
      result.current.applyCustomLyric(
        { trackName: "Official Track", artistName: "Official Artist", syncedLyrics: "[00:05.00] Chorus" },
        true
      )
    );
    expect(result.current.meta?.trackName).toBe("Official Track");
    await waitFor(() => expect(db.saveVideoLyrics).toHaveBeenCalledTimes(1));
    expect(db.saveVideoLyrics).toHaveBeenCalledWith(ROOM, TOKEN, {
      videoId: VIDEO,
      trackName: "Official Track",
      artistName: "Official Artist",
      syncedLyrics: "[00:05.00] Chorus",
      plainLyrics: undefined,
      offsetMs: 0,
      timingSource: "custom",
    });
  });

  it("caches what the lyrics API found for the DJ, with the room and the session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(API_LYRICS)));
    mount(props({ canControl: true }));
    await waitFor(() => expect(db.saveVideoLyrics).toHaveBeenCalledTimes(1));
    expect(db.saveVideoLyrics).toHaveBeenCalledWith(ROOM, TOKEN, {
      videoId: VIDEO,
      trackName: "API Track",
      artistName: "API Artist",
      syncedLyrics: "[00:01.00] From the API",
      plainLyrics: undefined,
      offsetMs: 0,
      timingSource: "auto",
    });
  });
});
