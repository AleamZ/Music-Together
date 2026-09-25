import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchVideoLyrics, saveVideoLyrics, updateVideoLyricOffset } from "@/lib/lyrics/db";
import { supabase } from "@/lib/supabase";

describe("lib/lyrics/db", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchVideoLyrics", () => {
    it("returns null when videoId is empty", async () => {
      const result = await fetchVideoLyrics("");
      expect(result).toBeNull();
    });

    it("fetches cached record from video_lyrics table", async () => {
      const mockRecord = {
        youtube_video_id: "abc-123",
        track_name: "Test Song",
        artist_name: "Test Artist",
        synced_lyrics: "[00:01.00] Line 1",
        offset_ms: 1200,
      };

      const maybeSingleMock = vi.fn().mockResolvedValue({ data: mockRecord, error: null });
      const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      vi.spyOn(supabase, "from").mockReturnValue({ select: selectMock } as any);

      const result = await fetchVideoLyrics("abc-123");

      expect(supabase.from).toHaveBeenCalledWith("video_lyrics");
      expect(selectMock).toHaveBeenCalledWith("*");
      expect(eqMock).toHaveBeenCalledWith("youtube_video_id", "abc-123");
      expect(result).toEqual(mockRecord);
    });

    it("returns null when query returns error", async () => {
      const maybeSingleMock = vi.fn().mockResolvedValue({ data: null, error: { message: "Error" } });
      const eqMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
      const selectMock = vi.fn().mockReturnValue({ eq: eqMock });
      vi.spyOn(supabase, "from").mockReturnValue({ select: selectMock } as any);

      const result = await fetchVideoLyrics("abc-123");
      expect(result).toBeNull();
    });
  });

  describe("saveVideoLyrics", () => {
    it("does nothing if videoId is missing", async () => {
      const rpcSpy = vi.spyOn(supabase, "rpc");
      await saveVideoLyrics({ videoId: "" });
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it("invokes upsert_video_lyrics RPC", async () => {
      const rpcSpy = vi.spyOn(supabase, "rpc").mockResolvedValue({ error: null } as any);

      await saveVideoLyrics({
        videoId: "vid-456",
        trackName: "Song A",
        artistName: "Artist B",
        syncedLyrics: "[00:02.00] Hi",
        offsetMs: 500,
        timingSource: "custom",
        updatedByName: "User 1",
      });

      expect(rpcSpy).toHaveBeenCalledWith("upsert_video_lyrics", {
        p_video_id: "vid-456",
        p_track_name: "Song A",
        p_artist_name: "Artist B",
        p_synced_lyrics: "[00:02.00] Hi",
        p_plain_lyrics: null,
        p_offset_ms: 500,
        p_timing_source: "custom",
        p_updated_by: "User 1",
      });
    });

    it("falls back to table upsert when RPC returns an error", async () => {
      vi.spyOn(supabase, "rpc").mockResolvedValue({ error: { message: "RPC not found" } } as any);
      const upsertMock = vi.fn().mockResolvedValue({ error: null });
      vi.spyOn(supabase, "from").mockReturnValue({ upsert: upsertMock } as any);

      await saveVideoLyrics({
        videoId: "vid-789",
        trackName: "Song B",
      });

      expect(supabase.from).toHaveBeenCalledWith("video_lyrics");
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          youtube_video_id: "vid-789",
          track_name: "Song B",
        })
      );
    });
  });

  describe("updateVideoLyricOffset", () => {
    it("does nothing if videoId is missing", async () => {
      const rpcSpy = vi.spyOn(supabase, "rpc");
      await updateVideoLyricOffset("", 1000);
      expect(rpcSpy).not.toHaveBeenCalled();
    });

    it("invokes update_video_lyric_offset RPC", async () => {
      const rpcSpy = vi.spyOn(supabase, "rpc").mockResolvedValue({ error: null } as any);

      await updateVideoLyricOffset("vid-456", -1500, "Alice");

      expect(rpcSpy).toHaveBeenCalledWith("update_video_lyric_offset", {
        p_video_id: "vid-456",
        p_offset_ms: -1500,
        p_updated_by: "Alice",
      });
    });

    it("falls back to table update when RPC returns an error", async () => {
      vi.spyOn(supabase, "rpc").mockResolvedValue({ error: { message: "RPC not found" } } as any);
      const eqMock = vi.fn().mockResolvedValue({ error: null });
      const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
      vi.spyOn(supabase, "from").mockReturnValue({ update: updateMock } as any);

      await updateVideoLyricOffset("vid-999", 800, "Bob");

      expect(supabase.from).toHaveBeenCalledWith("video_lyrics");
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          offset_ms: 800,
          updated_by_name: "Bob",
        })
      );
      expect(eqMock).toHaveBeenCalledWith("youtube_video_id", "vid-999");
    });
  });
});
