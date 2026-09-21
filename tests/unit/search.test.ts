import { describe, it, expect } from "vitest";
import { parseDurationText, extractSearchResults } from "@/lib/youtube/search";

describe("parseDurationText", () => {
  it("parses m:ss and mm:ss", () => {
    expect(parseDurationText("4:32")).toBe(272);
    expect(parseDurationText("0:59")).toBe(59);
    expect(parseDurationText("12:05")).toBe(725);
  });
  it("parses h:mm:ss", () => {
    expect(parseDurationText("1:02:15")).toBe(3735);
  });
  it("returns null for anything that is not a clock string", () => {
    expect(parseDurationText("LIVE")).toBeNull();
    expect(parseDurationText("")).toBeNull();
    expect(parseDurationText(undefined)).toBeNull();
    expect(parseDurationText(null)).toBeNull();
    expect(parseDurationText("4")).toBeNull();
    expect(parseDurationText("4:5")).toBeNull();
  });
});

// Trimmed InnerTube search response: videoRenderers under itemSectionRenderer
// AND nested inside a shelfRenderer; a channelRenderer sibling; one live video
// (no lengthText, byline only in longBylineText); one entry without videoId;
// one duplicate id.
const FIXTURE = {
  contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [
    { itemSectionRenderer: { contents: [
      { videoRenderer: {
          videoId: "jktURHt9O6Y",
          title: { runs: [{ text: "Nếu Như Ta Chẳng Còn" }] },
          ownerText: { runs: [{ text: "Kênh A" }] },
          lengthText: { simpleText: "4:32" },
          thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/vi/jktURHt9O6Y/hq720.jpg?sqp=signed" }] },
      } },
      { channelRenderer: { channelId: "UCxxxxxxxxxxxxxxxxxxxxxx", title: { simpleText: "Kênh A" } } },
      { videoRenderer: {
          videoId: "live0000001",
          title: { simpleText: "Live radio" },
          longBylineText: { runs: [{ text: "Kênh B" }] },
      } },
      { videoRenderer: { title: { runs: [{ text: "no id — skipped" }] } } },
      { shelfRenderer: { content: { verticalListRenderer: { items: [
        { videoRenderer: {
            videoId: "hxTxROuUj4g",
            title: { runs: [{ text: "ICD" }] },
            ownerText: { runs: [{ text: "Kênh C" }] },
            lengthText: { simpleText: "1:02:15" },
        } },
        { videoRenderer: { videoId: "jktURHt9O6Y", title: { runs: [{ text: "duplicate — skipped" }] } } },
      ] } } } },
    ] } },
    { continuationItemRenderer: { token: "next-page" } },
  ] } } } },
};

describe("extractSearchResults", () => {
  it("collects videoRenderers in document order, derives mqdefault thumbs, skips non-video / id-less / duplicate entries", () => {
    expect(extractSearchResults(FIXTURE)).toEqual([
      { videoId: "jktURHt9O6Y", title: "Nếu Như Ta Chẳng Còn", channel: "Kênh A",
        durationText: "4:32", durationSeconds: 272, thumb: "https://i.ytimg.com/vi/jktURHt9O6Y/mqdefault.jpg" },
      { videoId: "live0000001", title: "Live radio", channel: "Kênh B",
        durationText: null, durationSeconds: null, thumb: "https://i.ytimg.com/vi/live0000001/mqdefault.jpg" },
      { videoId: "hxTxROuUj4g", title: "ICD", channel: "Kênh C",
        durationText: "1:02:15", durationSeconds: 3735, thumb: "https://i.ytimg.com/vi/hxTxROuUj4g/mqdefault.jpg" },
    ]);
  });
  it("respects the cap", () => {
    expect(extractSearchResults(FIXTURE, 2).map((r) => r.videoId)).toEqual(["jktURHt9O6Y", "live0000001"]);
  });
  it("returns [] for null / primitive / empty input", () => {
    expect(extractSearchResults(null)).toEqual([]);
    expect(extractSearchResults("not json")).toEqual([]);
    expect(extractSearchResults({})).toEqual([]);
  });
});
