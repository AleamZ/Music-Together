import { describe, it, expect } from "vitest";
import { parseSuggestJsonp } from "@/lib/youtube/suggest";

// Shape of https://suggestqueries-clients6.youtube.com/complete/search?client=youtube&...:
// window.google.ac.h(["<q>", [[text, type, flags, {zai, zaj, zak, zal}], ...], {...}])
const JSONP = `window.google.ac.h(${JSON.stringify(["neu", [
  ["neu nhu ta chang con karaoke", 35, [39, 362],
    { zai: "https://evil.example/x.jpg", zaj: 320, zak: 180, zal: "jktURHt9O6Y" }],  // zai ignored; thumb derived from zal
  ["neu nhu ta chang con", 0, [512]],
  ["  Neu Nhu Ta Chang Con  ", 0, [512]],   // duplicate (case/whitespace) — skipped
  ["", 0, [512]],                            // empty text — skipped
  [42, 0, [512]],                            // non-string text — skipped
  ["neu anh", 0, [512], { zam: true }],      // meta without zal → plain text entry
  ["neu em", 0, [512], { zai: "https://i.ytimg.com/vi/xyz/mqdefault.jpg" }],  // zai but no zal → plain text entry
], { j: "0", k: 1 }])})`;

describe("parseSuggestJsonp", () => {
  it("unwraps the JSONP callback and maps entries, deriving videoId/thumb from zal only (zai ignored)", () => {
    expect(parseSuggestJsonp(JSONP)).toEqual([
      { text: "neu nhu ta chang con karaoke", videoId: "jktURHt9O6Y", thumb: "https://i.ytimg.com/vi/jktURHt9O6Y/mqdefault.jpg" },
      { text: "neu nhu ta chang con" },
      { text: "neu anh" },
      { text: "neu em" },
    ]);
  });
  it("respects the cap", () => {
    expect(parseSuggestJsonp(JSONP, 1)).toEqual([
      { text: "neu nhu ta chang con karaoke", videoId: "jktURHt9O6Y", thumb: "https://i.ytimg.com/vi/jktURHt9O6Y/mqdefault.jpg" },
    ]);
  });
  it("returns [] when the wrapper is missing, the JSON is invalid, or the payload has the wrong shape", () => {
    expect(parseSuggestJsonp("<html>oops</html>")).toEqual([]);
    expect(parseSuggestJsonp("window.google.ac.h({not json)")).toEqual([]);
    expect(parseSuggestJsonp('window.google.ac.h(["q", "not-an-array"])')).toEqual([]);
    expect(parseSuggestJsonp("")).toEqual([]);
  });
});
