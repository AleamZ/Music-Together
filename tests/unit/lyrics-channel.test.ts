import { describe, it, expect, vi } from "vitest";
import { joinLyricSync, type LyricBroadcastPayload } from "@/lib/lyrics/channel";
import { supabase } from "@/lib/supabase";

describe("joinLyricSync", () => {
  it("subscribes to room broadcast channel and sends formatted payload", () => {
    const mockChannel = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
      send: vi.fn().mockResolvedValue({}),
    };

    const channelSpy = vi.spyOn(supabase, "channel").mockReturnValue(mockChannel as any);
    const removeSpy = vi.spyOn(supabase, "removeChannel").mockReturnValue(Promise.resolve() as any);

    const onLyricChange = vi.fn();
    const handle = joinLyricSync("room-123", onLyricChange);

    expect(channelSpy).toHaveBeenCalledWith("lyrics:room-123", {
      config: { broadcast: { ack: true, self: false } },
    });
    expect(mockChannel.on).toHaveBeenCalledWith("broadcast", { event: "lyric_change" }, expect.any(Function));

    const payload: LyricBroadcastPayload = {
      trackId: "track-abc",
      trackName: "Hello",
      artistName: "Adele",
      syncedLyrics: "[00:01.00] Hello from the other side",
      appliedByName: "Alice",
    };

    handle.send(payload);
    expect(mockChannel.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "lyric_change",
      payload: expect.objectContaining({
        trackId: "track-abc",
        trackName: "Hello",
      }),
    });

    handle.unsubscribe();
    expect(removeSpy).toHaveBeenCalledWith(mockChannel);

    channelSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
