import { describe, it, expect } from "vitest";
import { extractVideoDetails } from "@/lib/youtube/video";

const page = (pr: unknown, marker = "var ytInitialPlayerResponse = ") =>
  `<!DOCTYPE html><html><head><script nonce="x">${marker}${JSON.stringify(pr)};var ytcfg = {};</script></head><body></body></html>`;

describe("extractVideoDetails", () => {
  it("reads id, title, author and lengthSeconds from ytInitialPlayerResponse", () => {
    expect(extractVideoDetails(page({ videoDetails: {
      videoId: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", author: "Rick Astley", lengthSeconds: "212", isLiveContent: false,
    } }))).toEqual({ id: "dQw4w9WgXcQ", title: "Never Gonna Give You Up", author: "Rick Astley", durationSeconds: 212, isLive: false });
  });
  it("a live stream has no duration", () => {
    expect(extractVideoDetails(page({ videoDetails: { videoId: "live0000001", title: "Radio", author: "X", lengthSeconds: "0", isLive: true } })))
      .toEqual({ id: "live0000001", title: "Radio", author: "X", durationSeconds: null, isLive: true });
  });
  it("a finished live stream (isLiveContent) keeps its real length", () => {
    expect(extractVideoDetails(page({ videoDetails: { videoId: "vodvodvodvo", title: "VOD", author: "X", lengthSeconds: "3600", isLiveContent: true } }))?.durationSeconds).toBe(3600);
  });
  it("accepts the bare `ytInitialPlayerResponse = ` marker", () => {
    expect(extractVideoDetails(page({ videoDetails: { videoId: "abcabcabcab", title: "T", author: "A", lengthSeconds: "5" } }, "ytInitialPlayerResponse = "))?.id).toBe("abcabcabcab");
  });
  it("returns null when videoDetails is missing or the page is garbage", () => {
    expect(extractVideoDetails(page({ playabilityStatus: { status: "ERROR" } }))).toBeNull();
    expect(extractVideoDetails("<html>nothing here</html>")).toBeNull();
    expect(extractVideoDetails("")).toBeNull();
  });
});
