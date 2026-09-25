import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ channel: vi.fn(), removeChannel: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { channel: h.channel, removeChannel: h.removeChannel } }));

import { joinLyricSync, type LyricHint } from "@/lib/lyrics/channel";

/** A realtime channel double: `deliver` plays a broadcast message into the handler the helper registered. */
function fakeChannel() {
  let handler: ((msg: unknown) => void) | null = null;
  const ch = {
    on: vi.fn((_type: string, _filter: unknown, cb: (msg: unknown) => void) => {
      handler = cb;
      return ch;
    }),
    subscribe: vi.fn(() => ch),
    send: vi.fn().mockResolvedValue("ok"),
    deliver: (payload: unknown) => handler?.({ type: "broadcast", event: "lyric_change", payload }),
  };
  return ch;
}

let ch: ReturnType<typeof fakeChannel>;
beforeEach(() => {
  h.channel.mockReset();
  h.removeChannel.mockReset().mockResolvedValue("ok");
  ch = fakeChannel();
  h.channel.mockReturnValue(ch);
});

describe("joinLyricSync", () => {
  it("joins the room's lyrics topic without an echo to the sender", () => {
    joinLyricSync("room-123", vi.fn());
    expect(h.channel).toHaveBeenCalledWith("lyrics:room-123", { config: { broadcast: { ack: true, self: false } } });
    expect(ch.on).toHaveBeenCalledWith("broadcast", { event: "lyric_change" }, expect.any(Function));
    expect(ch.subscribe).toHaveBeenCalledTimes(1);
  });

  it("hands receivers the track and video ids only: lyrics, names and an offset in a payload are dropped", () => {
    const onHint = vi.fn();
    joinLyricSync("room-123", onHint);
    ch.deliver({
      trackId: "track-abc",
      videoId: "dQw4w9WgXcQ",
      syncedLyrics: "[00:01.00] injected",
      plainLyrics: "injected",
      trackName: "Evil",
      artistName: "Evil",
      appliedByName: "Evil",
      offsetMs: 59000,
      timestamp: 1,
    });
    expect(onHint).toHaveBeenCalledTimes(1);
    expect(onHint).toHaveBeenCalledWith({ trackId: "track-abc", videoId: "dQw4w9WgXcQ" });
  });

  it("ignores a message without a string track id and video id (an older client's full payload included)", () => {
    const onHint = vi.fn();
    joinLyricSync("room-123", onHint);
    ch.deliver({ trackId: "track-abc", syncedLyrics: "[00:01.00] old client", offsetMs: 1500 });
    ch.deliver({ trackId: "track-abc", videoId: 42 });
    ch.deliver({ trackId: null, videoId: "dQw4w9WgXcQ" });
    ch.deliver("track-abc");
    ch.deliver(null);
    expect(onHint).not.toHaveBeenCalled();
  });

  it("sends the track and video ids only", () => {
    const handle = joinLyricSync("room-123", vi.fn());
    const withExtras = { trackId: "track-abc", videoId: "dQw4w9WgXcQ", syncedLyrics: "x", offsetMs: 5 } as LyricHint;
    handle.send(withExtras);
    expect(ch.send).toHaveBeenCalledTimes(1);
    expect(ch.send).toHaveBeenCalledWith({
      type: "broadcast",
      event: "lyric_change",
      payload: { trackId: "track-abc", videoId: "dQw4w9WgXcQ" },
    });
  });

  it("leaves the topic on unsubscribe", () => {
    const handle = joinLyricSync("room-123", vi.fn());
    handle.unsubscribe();
    expect(h.removeChannel).toHaveBeenCalledWith(ch);
  });
});
