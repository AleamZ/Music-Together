import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLyrics } from "@/hooks/useLyrics";
import * as dbModule from "@/lib/lyrics/db";
import * as channelModule from "@/lib/lyrics/channel";

describe("useLyrics permission gating (DJ vs Guest)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("prevents guest (canControl=false) from broadcasting or saving offset to database", () => {
    const updateSpy = vi.spyOn(dbModule, "updateVideoLyricOffset").mockResolvedValue();
    const sendMock = vi.fn();
    vi.spyOn(channelModule, "joinLyricSync").mockReturnValue({
      send: sendMock,
      unsubscribe: vi.fn(),
    });

    const { result } = renderHook(() =>
      useLyrics({
        title: "Test Song",
        durationSeconds: 180,
        elapsedMs: 5000,
        roomId: "room-abc",
        trackId: "track-123",
        youtubeVideoId: "yt-video-1",
        username: "GuestBob",
        canControl: false,
      })
    );

    // Guest tries to adjust offset with syncToRoom = true
    act(() => {
      result.current.setOffsetMs(1500, true);
    });

    // Local offset updates for the guest
    expect(result.current.offsetMs).toBe(1500);

    // But DB update and room broadcast are NOT called
    expect(updateSpy).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("prevents guest (canControl=false) from saving custom lyrics to database or broadcasting", () => {
    const saveSpy = vi.spyOn(dbModule, "saveVideoLyrics").mockResolvedValue();
    const sendMock = vi.fn();
    vi.spyOn(channelModule, "joinLyricSync").mockReturnValue({
      send: sendMock,
      unsubscribe: vi.fn(),
    });

    const { result } = renderHook(() =>
      useLyrics({
        title: "Test Song",
        durationSeconds: 180,
        elapsedMs: 5000,
        roomId: "room-abc",
        trackId: "track-123",
        youtubeVideoId: "yt-video-1",
        username: "GuestBob",
        canControl: false,
      })
    );

    act(() => {
      result.current.applyCustomLyric(
        {
          trackName: "Custom",
          syncedLyrics: "[00:01.00] Line 1",
        },
        true // Guest tries to sync to room
      );
    });

    // Local lyrics updated for the guest
    expect(result.current.meta?.trackName).toBe("Custom");

    // DB save and room broadcast are NOT called
    expect(saveSpy).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("allows DJ (canControl=true) to update offset in database and broadcast to room", () => {
    const updateSpy = vi.spyOn(dbModule, "updateVideoLyricOffset").mockResolvedValue();
    const sendMock = vi.fn();
    vi.spyOn(channelModule, "joinLyricSync").mockReturnValue({
      send: sendMock,
      unsubscribe: vi.fn(),
    });

    const { result } = renderHook(() =>
      useLyrics({
        title: "Test Song",
        durationSeconds: 180,
        elapsedMs: 5000,
        roomId: "room-abc",
        trackId: "track-123",
        youtubeVideoId: "yt-video-1",
        username: "DjAlice",
        canControl: true,
      })
    );

    act(() => {
      result.current.setOffsetMs(2500, true);
    });

    expect(result.current.offsetMs).toBe(2500);
    expect(updateSpy).toHaveBeenCalledWith("yt-video-1", 2500, "DjAlice");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: "track-123",
        offsetMs: 2500,
        appliedByName: "DjAlice",
      })
    );
  });

  it("allows DJ (canControl=true) to save custom lyrics to database and broadcast to room", () => {
    const saveSpy = vi.spyOn(dbModule, "saveVideoLyrics").mockResolvedValue();
    const sendMock = vi.fn();
    vi.spyOn(channelModule, "joinLyricSync").mockReturnValue({
      send: sendMock,
      unsubscribe: vi.fn(),
    });

    const { result } = renderHook(() =>
      useLyrics({
        title: "Test Song",
        durationSeconds: 180,
        elapsedMs: 5000,
        roomId: "room-abc",
        trackId: "track-123",
        youtubeVideoId: "yt-video-1",
        username: "DjAlice",
        canControl: true,
      })
    );

    act(() => {
      result.current.applyCustomLyric(
        {
          trackName: "Official Track",
          artistName: "Official Artist",
          syncedLyrics: "[00:05.00] Chorus",
        },
        true
      );
    });

    expect(result.current.meta?.trackName).toBe("Official Track");
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        videoId: "yt-video-1",
        trackName: "Official Track",
        artistName: "Official Artist",
        timingSource: "custom",
        updatedByName: "DjAlice",
      })
    );
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        trackId: "track-123",
        trackName: "Official Track",
        syncedLyrics: "[00:05.00] Chorus",
        appliedByName: "DjAlice",
      })
    );
  });
});
