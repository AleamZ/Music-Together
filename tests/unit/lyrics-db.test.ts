import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { fetchVideoLyrics, saveVideoLyrics, updateVideoLyricOffset, type VideoLyricsWrite } from "@/lib/lyrics/db";

const ROOM = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TOKEN = "f3a1c2d4e5b6a7980f1e2d3c4b5a69788796a5b4c3d2e1f0a9b8c7d6e5f4a3b2";
/** A full record, as the hook sends it. */
const record = (over: Partial<VideoLyricsWrite> = {}): VideoLyricsWrite => ({
  videoId: "dQw4w9WgXcQ",
  trackName: "Song A",
  artistName: "Artist B",
  syncedLyrics: "[00:01.00]x",
  plainLyrics: null,
  offsetMs: 0,
  timingSource: "custom",
  ...over,
});
/** What supabase-js resolves for a `returns void` RPC. */
const OK = { data: null, error: null, count: null, status: 204, statusText: "No Content" };
/** What an old client gets once 0014 has dropped the signature it calls. */
const PGRST202 = {
  data: null,
  error: {
    code: "PGRST202",
    message: "Could not find the function public.upsert_video_lyrics(p_artist_name, …) in the schema cache",
    details: "Searched for the function public.upsert_video_lyrics with parameters …",
    hint: null,
  },
  count: null,
  status: 404,
  statusText: "Not Found",
};
const DENIED = {
  data: null,
  error: { code: "42501", message: "dj role required", details: null, hint: null },
  count: null,
  status: 403,
  statusText: "Forbidden",
};

let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  h.rpc.mockReset();
  h.from.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
});

describe("fetchVideoLyrics (read path, unchanged)", () => {
  const query = (result: { data: unknown; error: unknown }) => {
    const maybeSingle = vi.fn().mockResolvedValue(result);
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    h.from.mockReturnValue({ select });
    return { select, eq, maybeSingle };
  };

  it("returns null when videoId is empty", async () => {
    expect(await fetchVideoLyrics("")).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
  });

  it("reads the row of that video from video_lyrics", async () => {
    const row = {
      youtube_video_id: "dQw4w9WgXcQ", track_name: "Test Song", artist_name: "Test Artist",
      synced_lyrics: "[00:01.00] Line 1", plain_lyrics: null, offset_ms: 1200, timing_source: "auto",
      updated_by_name: "dj", updated_at: "2026-09-25T10:00:00Z",
    };
    const q = query({ data: row, error: null });
    expect(await fetchVideoLyrics("dQw4w9WgXcQ")).toEqual(row);
    expect(h.from).toHaveBeenCalledWith("video_lyrics");
    expect(q.select).toHaveBeenCalledWith("*");
    expect(q.eq).toHaveBeenCalledWith("youtube_video_id", "dQw4w9WgXcQ");
  });

  it("returns null when the query returns an error", async () => {
    query({ data: null, error: { message: "Error" } });
    expect(await fetchVideoLyrics("dQw4w9WgXcQ")).toBeNull();
  });
});

describe("saveVideoLyrics", () => {
  it("calls upsert_video_lyrics with the room and the session, and no updated-by name", async () => {
    h.rpc.mockResolvedValue(OK);
    const saved = await saveVideoLyrics(ROOM, TOKEN, record({ syncedLyrics: "[00:02.00] Hi", offsetMs: 500 }));
    expect(saved).toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("upsert_video_lyrics", {
      p_room_id: ROOM,
      p_session_token: TOKEN,
      p_video_id: "dQw4w9WgXcQ",
      p_track_name: "Song A",
      p_artist_name: "Artist B",
      p_synced_lyrics: "[00:02.00] Hi",
      p_plain_lyrics: null,
      p_offset_ms: 500,
      p_timing_source: "custom",
    });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("sends absent text as null, so every argument reaches the RPC (JSON drops undefined)", async () => {
    h.rpc.mockResolvedValue(OK);
    await saveVideoLyrics(
      ROOM,
      TOKEN,
      record({ trackName: undefined, artistName: undefined, syncedLyrics: undefined, plainLyrics: "la la", timingSource: "auto" })
    );
    expect(h.rpc).toHaveBeenCalledWith("upsert_video_lyrics", {
      p_room_id: ROOM,
      p_session_token: TOKEN,
      p_video_id: "dQw4w9WgXcQ",
      p_track_name: null,
      p_artist_name: null,
      p_synced_lyrics: null,
      p_plain_lyrics: "la la",
      p_offset_ms: 0,
      p_timing_source: "auto",
    });
  });

  it("does nothing without a video, a room or a session", async () => {
    expect(await saveVideoLyrics(ROOM, TOKEN, record({ videoId: "" }))).toBe(false);
    expect(await saveVideoLyrics("", TOKEN, record())).toBe(false);
    expect(await saveVideoLyrics(ROOM, "", record())).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.from).not.toHaveBeenCalled();
  });

  it.each([
    ["an RPC error (old signature gone)", () => h.rpc.mockResolvedValue(PGRST202)],
    ["a refusal (not the DJ)", () => h.rpc.mockResolvedValue(DENIED)],
    ["a network failure", () => h.rpc.mockRejectedValue(new TypeError("Failed to fetch"))],
  ])("resolves false on %s, warns once and never writes the table directly", async (_case, arrange) => {
    arrange();
    await expect(saveVideoLyrics(ROOM, TOKEN, record())).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.from).not.toHaveBeenCalled();
  });
});

describe("updateVideoLyricOffset", () => {
  it("calls update_video_lyric_offset with the room and the session, and no updated-by name", async () => {
    h.rpc.mockResolvedValue(OK);
    await expect(updateVideoLyricOffset(ROOM, TOKEN, "dQw4w9WgXcQ", -1500)).resolves.toBe(true);
    expect(h.rpc).toHaveBeenCalledTimes(1);
    expect(h.rpc).toHaveBeenCalledWith("update_video_lyric_offset", {
      p_room_id: ROOM,
      p_session_token: TOKEN,
      p_video_id: "dQw4w9WgXcQ",
      p_offset_ms: -1500,
    });
    expect(h.from).not.toHaveBeenCalled();
  });

  it("does nothing without a video, a room or a session", async () => {
    expect(await updateVideoLyricOffset(ROOM, TOKEN, "", 1000)).toBe(false);
    expect(await updateVideoLyricOffset("", TOKEN, "dQw4w9WgXcQ", 1000)).toBe(false);
    expect(await updateVideoLyricOffset(ROOM, "", "dQw4w9WgXcQ", 1000)).toBe(false);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["an RPC error (old signature gone)", () => h.rpc.mockResolvedValue(PGRST202)],
    ["a refusal (not the DJ)", () => h.rpc.mockResolvedValue(DENIED)],
    ["a network failure", () => h.rpc.mockRejectedValue(new TypeError("Failed to fetch"))],
  ])("resolves false on %s, warns once and never writes the table directly", async (_case, arrange) => {
    arrange();
    await expect(updateVideoLyricOffset(ROOM, TOKEN, "dQw4w9WgXcQ", 800)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.from).not.toHaveBeenCalled();
  });
});
