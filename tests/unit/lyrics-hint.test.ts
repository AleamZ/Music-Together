import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { LyricHint } from "@/lib/lyrics/channel";
import type { VideoLyricsRecord } from "@/lib/lyrics/db";

const db = vi.hoisted(() => ({ fetchVideoLyrics: vi.fn(), saveVideoLyrics: vi.fn(), updateVideoLyricOffset: vi.fn() }));
vi.mock("@/lib/lyrics/db", () => db);
const sync = vi.hoisted(() => ({ joinLyricSync: vi.fn(), send: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/lib/lyrics/channel", () => ({ joinLyricSync: sync.joinLyricSync }));

import { useLyrics, type UseLyricsProps } from "@/hooks/useLyrics";

const ROOM = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "f3a1c2d4e5b6a7980f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2";
const TRACK = "track-1";
const VIDEO = "dQw4w9WgXcQ";
const OFFSET_KEY = `music-together:lyric-offset:${VIDEO}`;

/** A complete video_lyrics row, as fetchVideoLyrics returns it. */
const row = (over: Partial<VideoLyricsRecord> = {}): VideoLyricsRecord => ({
  youtube_video_id: VIDEO,
  track_name: "DB Track",
  artist_name: "DB Artist",
  synced_lyrics: "[00:01.00] From the database",
  plain_lyrics: null,
  offset_ms: 0,
  timing_source: "auto",
  updated_by_name: "dj",
  updated_at: "2026-09-25T10:00:00Z",
  ...over,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let song = 0;
/** A fresh title per test: the hook's lyrics cache is module-wide. */
const props = (over: Partial<UseLyricsProps> = {}): UseLyricsProps => ({
  title: `Hint song ${++song}`,
  durationSeconds: 200,
  elapsedMs: 0,
  roomId: ROOM,
  trackId: TRACK,
  youtubeVideoId: VIDEO,
  sessionToken: TOKEN,
  canControl: false,
  ...over,
});
const mount = (p: UseLyricsProps) => renderHook((q: UseLyricsProps) => useLyrics(q), { initialProps: p });
/** A message on the room's lyrics topic, as the channel helper hands it over (extra fields included). */
const receive = (payload: Record<string, unknown>) =>
  act(async () => {
    const onHint = sync.joinLyricSync.mock.calls.at(-1)![1] as (hint: LyricHint) => void;
    onHint(payload as unknown as LyricHint);
  });
const texts = (lines: { text: string }[]) => lines.map((l) => l.text);

beforeEach(() => {
  for (const f of [...Object.values(db), ...Object.values(sync)]) f.mockReset();
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

describe("useLyrics: the lyrics broadcast is only a hint", () => {
  it("ignores lyrics and an offset carried in a payload: lines, offset and localStorage come from the database", async () => {
    db.fetchVideoLyrics.mockResolvedValue(row({ offset_ms: 1200 }));
    const { result } = mount(props());
    await waitFor(() => expect(result.current.meta?.trackName).toBe("DB Track"));
    expect(result.current.offsetMs).toBe(1200);

    const refetch = deferred<VideoLyricsRecord | null>();
    db.fetchVideoLyrics.mockReturnValueOnce(refetch.promise); // the row did not change
    await receive({
      trackId: TRACK, videoId: VIDEO,
      syncedLyrics: "[00:01.00] INJECTED", plainLyrics: "INJECTED", trackName: "Evil", artistName: "Evil", offsetMs: 59000,
    });
    await receive({ trackId: TRACK, syncedLyrics: "[00:01.00] INJECTED", offsetMs: -59000 }); // an older client's payload
    await act(async () => {
      refetch.resolve(row({ offset_ms: 1200 }));
      await refetch.promise;
    });

    expect(texts(result.current.lines)).toEqual(["From the database"]);
    expect(result.current.meta).toEqual({
      trackName: "DB Track", artistName: "DB Artist", syncedLyrics: "[00:01.00] From the database", plainLyrics: undefined,
    });
    expect(result.current.offsetMs).toBe(1200);
    expect(localStorage.getItem(OFFSET_KEY)).toBe("1200");
    expect(db.fetchVideoLyrics).toHaveBeenCalledTimes(2); // the initial load + the one hint with a video id
  });

  it("refetches the row once on a hint for the current track, bypassing the lyrics cache, and applies it like the first load", async () => {
    db.fetchVideoLyrics.mockResolvedValueOnce(row());
    const p = props();
    const { result } = mount(p);
    await waitFor(() => expect(texts(result.current.lines)).toEqual(["From the database"]));
    expect(result.current.offsetMs).toBe(0);

    db.fetchVideoLyrics.mockResolvedValueOnce(
      row({ track_name: "New Track", synced_lyrics: "[00:02.00] Chosen by the DJ", offset_ms: -2500, timing_source: "custom" })
    );
    await receive({ trackId: TRACK, videoId: VIDEO });

    await waitFor(() => expect(texts(result.current.lines)).toEqual(["Chosen by the DJ"]));
    expect(db.fetchVideoLyrics).toHaveBeenCalledTimes(2);
    expect(db.fetchVideoLyrics).toHaveBeenLastCalledWith(VIDEO);
    expect(result.current.meta?.trackName).toBe("New Track");
    expect(result.current.offsetMs).toBe(-2500);
    expect(localStorage.getItem(OFFSET_KEY)).toBe("-2500");

    // the in-memory cache now holds the new row: the view mounting again shows it without another fetch
    cleanup();
    const again = mount(p);
    expect(texts(again.result.current.lines)).toEqual(["Chosen by the DJ"]);
    expect(again.result.current.offsetMs).toBe(-2500);
    expect(db.fetchVideoLyrics).toHaveBeenCalledTimes(2);
  });

  it("applies a DB offset of 0 from a hint: the DJ's reset reaches the viewer and clears the remembered offset", async () => {
    db.fetchVideoLyrics.mockResolvedValueOnce(row({ offset_ms: 1200 }));
    const { result } = mount(props());
    await waitFor(() => expect(result.current.offsetMs).toBe(1200));
    expect(localStorage.getItem(OFFSET_KEY)).toBe("1200");

    db.fetchVideoLyrics.mockResolvedValueOnce(row({ offset_ms: 0 }));
    await receive({ trackId: TRACK, videoId: VIDEO });

    await waitFor(() => expect(result.current.offsetMs).toBe(0));
    expect(localStorage.getItem(OFFSET_KEY)).toBeNull();
    expect(db.fetchVideoLyrics).toHaveBeenCalledTimes(2);
  });

  it("keeps the first load as it was: a DB offset of 0 leaves the viewer's own remembered offset", async () => {
    localStorage.setItem(OFFSET_KEY, "900");
    db.fetchVideoLyrics.mockResolvedValueOnce(row({ offset_ms: 0 }));
    const { result } = mount(props());
    await waitFor(() => expect(result.current.meta?.trackName).toBe("DB Track"));
    expect(result.current.offsetMs).toBe(900);
    expect(localStorage.getItem(OFFSET_KEY)).toBe("900");
  });

  it("ignores a hint for another track or another video", async () => {
    db.fetchVideoLyrics.mockResolvedValue(row());
    const { result } = mount(props());
    await waitFor(() => expect(result.current.meta?.trackName).toBe("DB Track"));

    await receive({ trackId: "another-track", videoId: VIDEO });
    await receive({ trackId: TRACK, videoId: "kJQP7kiw5Fk" });

    expect(db.fetchVideoLyrics).toHaveBeenCalledTimes(1);
    expect(texts(result.current.lines)).toEqual(["From the database"]);
  });

  it("keeps the newest hint's row when two refetches finish out of order", async () => {
    db.fetchVideoLyrics.mockResolvedValueOnce(row());
    const { result } = mount(props());
    await waitFor(() => expect(result.current.meta?.trackName).toBe("DB Track"));

    const first = deferred<VideoLyricsRecord | null>();
    const second = deferred<VideoLyricsRecord | null>();
    db.fetchVideoLyrics.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    await receive({ trackId: TRACK, videoId: VIDEO });
    await receive({ trackId: TRACK, videoId: VIDEO });
    await act(async () => {
      second.resolve(row({ synced_lyrics: "[00:01.00] Second", offset_ms: 2000 }));
      await second.promise;
    });
    await act(async () => {
      first.resolve(row({ synced_lyrics: "[00:01.00] First", offset_ms: 1000 }));
      await first.promise;
    });

    expect(texts(result.current.lines)).toEqual(["Second"]);
    expect(result.current.offsetMs).toBe(2000);
    expect(localStorage.getItem(OFFSET_KEY)).toBe("2000");
  });

  it("drops a refetched row when the room has moved on to another song", async () => {
    db.fetchVideoLyrics.mockResolvedValueOnce(row());
    const { result, rerender } = mount(props());
    await waitFor(() => expect(result.current.meta?.trackName).toBe("DB Track"));

    const pending = deferred<VideoLyricsRecord | null>();
    db.fetchVideoLyrics.mockReturnValueOnce(pending.promise);
    await receive({ trackId: TRACK, videoId: VIDEO });
    db.fetchVideoLyrics.mockResolvedValueOnce(
      row({ youtube_video_id: "kJQP7kiw5Fk", track_name: "Next Song", synced_lyrics: "[00:01.00] Next song" })
    );
    rerender(props({ trackId: "track-2", youtubeVideoId: "kJQP7kiw5Fk" }));
    await waitFor(() => expect(result.current.meta?.trackName).toBe("Next Song"));

    await act(async () => {
      pending.resolve(row({ synced_lyrics: "[00:01.00] Late row of the old song", offset_ms: 3000 }));
      await pending.promise;
    });

    expect(texts(result.current.lines)).toEqual(["Next song"]);
    expect(result.current.offsetMs).toBe(0);
    expect(localStorage.getItem(OFFSET_KEY)).toBeNull();
  });
});

describe("useLyrics: the DJ hints the room only after a successful save", () => {
  const djMount = async () => {
    db.fetchVideoLyrics.mockResolvedValue(row());
    const hook = mount(props({ canControl: true }));
    await waitFor(() => expect(hook.result.current.meta?.trackName).toBe("DB Track"));
    return hook;
  };

  it("custom lyrics: saved first, then a hint with the track and video ids only", async () => {
    const { result } = await djMount();
    const save = deferred<boolean>();
    db.saveVideoLyrics.mockReturnValueOnce(save.promise);

    act(() => result.current.applyCustomLyric({ trackName: "Mine", syncedLyrics: "[00:01.00] Mine" }, true));
    expect(db.saveVideoLyrics).toHaveBeenCalledTimes(1);
    expect(sync.send).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve(true);
      await save.promise;
    });
    expect(sync.send).toHaveBeenCalledTimes(1);
    expect(sync.send).toHaveBeenCalledWith({ trackId: TRACK, videoId: VIDEO });
  });

  it("offset: saved first, then a hint with the track and video ids only", async () => {
    const { result } = await djMount();
    const save = deferred<boolean>();
    db.updateVideoLyricOffset.mockReturnValueOnce(save.promise);

    act(() => result.current.setOffsetMs(-1500, true));
    expect(db.updateVideoLyricOffset).toHaveBeenCalledWith(ROOM, TOKEN, VIDEO, -1500);
    expect(sync.send).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve(true);
      await save.promise;
    });
    expect(sync.send).toHaveBeenCalledTimes(1);
    expect(sync.send).toHaveBeenCalledWith({ trackId: TRACK, videoId: VIDEO });
  });

  it("a refused or failed save hints nobody", async () => {
    const { result } = await djMount();
    db.saveVideoLyrics.mockResolvedValueOnce(false);
    db.updateVideoLyricOffset.mockResolvedValueOnce(false);

    act(() => result.current.applyCustomLyric({ trackName: "Mine", syncedLyrics: "[00:01.00] Mine" }, true));
    act(() => result.current.setOffsetMs(700, true));
    await waitFor(() => expect(db.updateVideoLyricOffset).toHaveBeenCalledTimes(1));
    await act(async () => {});

    expect(db.saveVideoLyrics).toHaveBeenCalledTimes(1);
    expect(sync.send).not.toHaveBeenCalled();
  });

  it("a listener never saves or hints, whatever it asks for", async () => {
    db.fetchVideoLyrics.mockResolvedValue(row());
    const { result } = mount(props({ canControl: false }));
    await waitFor(() => expect(result.current.meta?.trackName).toBe("DB Track"));

    act(() => result.current.applyCustomLyric({ trackName: "Mine", syncedLyrics: "[00:01.00] Mine" }, true));
    act(() => result.current.setOffsetMs(700, true));
    await act(async () => {});

    expect(db.saveVideoLyrics).not.toHaveBeenCalled();
    expect(db.updateVideoLyricOffset).not.toHaveBeenCalled();
    expect(sync.send).not.toHaveBeenCalled();
  });
});
