import { describe, it, expect } from "vitest";
import { parsePlaylistId } from "@/lib/youtube/parse";
import { extractPlaylistItems } from "@/lib/youtube/playlist";

describe("parsePlaylistId", () => {
  it("reads list= from a pure playlist URL", () => {
    expect(parsePlaylistId("https://www.youtube.com/playlist?list=PLabc123")).toBe("PLabc123");
  });
  it("reads list= from a watch URL that also has v=", () => {
    expect(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLxyz")).toBe("PLxyz");
  });
  it("reads list= from a youtu.be short link", () => {
    expect(parsePlaylistId("https://youtu.be/dQw4w9WgXcQ?list=PLqqq")).toBe("PLqqq");
  });
  it("returns null when there is no list", () => {
    expect(parsePlaylistId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
  });
  it("returns null for non-URLs / non-YouTube", () => {
    expect(parsePlaylistId("not a url")).toBeNull();
    expect(parsePlaylistId("https://vimeo.com/123?list=PLx")).toBeNull();
  });
});

const FIXTURE = `<!DOCTYPE html><html><body><script nonce="x">var ytInitialData = ${JSON.stringify({
  contents: { wrap: { contents: [
    { playlistVideoRenderer: { videoId: "aaaaaaaaaaa", title: { runs: [{ text: "Song A" }] },
      thumbnail: { thumbnails: [
        { url: "https://i.ytimg.com/vi/aaaaaaaaaaa/default.jpg" },
        { url: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" },
      ] } } },
    { playlistVideoRenderer: { videoId: "bbbbbbbbbbb", title: { simpleText: "Song B" },
      thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg" }] } } },
    { continuationItemRenderer: { trigger: "x" } },
  ] } },
})};</script></body></html>`;

// Current YouTube layout: each video is a `lockupViewModel` (the legacy
// `playlistVideoRenderer` no longer appears). videoId is `contentId`, title is
// `metadata.lockupMetadataViewModel.title.content`.
const LOCKUP_FIXTURE = `<!DOCTYPE html><html><body><script nonce="x">var ytInitialData = ${JSON.stringify({
  contents: { tabs: [{ contents: [
    { lockupViewModel: { contentId: "tNZegj60iLI", contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: { lockupMetadataViewModel: { title: { content: "01. Intro" } } } } },
    { lockupViewModel: { contentId: "xubKh9u0uDY", contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: { lockupMetadataViewModel: { title: { content: "02. Con Nít" } } } } },
    { lockupViewModel: { contentId: "tNZegj60iLI", contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
      metadata: { lockupMetadataViewModel: { title: { content: "dup of first" } } } } },
    { lockupViewModel: { contentId: "PLsomething", contentType: "LOCKUP_CONTENT_TYPE_PLAYLIST" } },
  ] }] },
})};</script></body></html>`;

describe("extractPlaylistItems", () => {
  it("parses playlistVideoRenderer entries in order, derives hqdefault thumb, skips non-video", () => {
    const items = extractPlaylistItems(FIXTURE);
    expect(items).toEqual([
      { videoId: "aaaaaaaaaaa", title: "Song A", thumb: "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg" },
      { videoId: "bbbbbbbbbbb", title: "Song B", thumb: "https://i.ytimg.com/vi/bbbbbbbbbbb/hqdefault.jpg" },
    ]);
  });
  it("parses the current lockupViewModel layout, dedupes, skips non-video lockups", () => {
    const items = extractPlaylistItems(LOCKUP_FIXTURE);
    expect(items).toEqual([
      { videoId: "tNZegj60iLI", title: "01. Intro", thumb: "https://i.ytimg.com/vi/tNZegj60iLI/hqdefault.jpg" },
      { videoId: "xubKh9u0uDY", title: "02. Con Nít", thumb: "https://i.ytimg.com/vi/xubKh9u0uDY/hqdefault.jpg" },
    ]);
  });
  it("respects the cap", () => {
    expect(extractPlaylistItems(FIXTURE, 1)).toHaveLength(1);
  });
  it("returns [] on garbage input", () => {
    expect(extractPlaylistItems("<html>no data here</html>")).toEqual([]);
  });
});
