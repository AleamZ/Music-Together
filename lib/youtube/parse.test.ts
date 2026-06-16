import { describe, it, expect } from "vitest";
import { parseYouTubeId, parseYouTubeStart } from "@/lib/youtube/parse";

describe("parseYouTubeId", () => {
  it("parses standard watch URLs", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("parses youtu.be short links", () => {
    expect(parseYouTubeId("https://youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
  });
  it("parses music.youtube.com and extra params", () => {
    expect(parseYouTubeId("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=abc")).toBe("dQw4w9WgXcQ");
  });
  it("parses /shorts/ and /embed/", () => {
    expect(parseYouTubeId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(parseYouTubeId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("accepts a bare 11-char id", () => {
    expect(parseYouTubeId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("accepts scheme-less host", () => {
    expect(parseYouTubeId("youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
  it("rejects non-YouTube and garbage", () => {
    expect(parseYouTubeId("https://vimeo.com/12345")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
    expect(parseYouTubeId("")).toBeNull();
  });
});

describe("parseYouTubeStart", () => {
  it("reads ?t= seconds and 1h2m3s", () => {
    expect(parseYouTubeStart("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe(90);
    expect(parseYouTubeStart("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")).toBe(90);
  });
  it("defaults to 0", () => {
    expect(parseYouTubeStart("https://youtu.be/dQw4w9WgXcQ")).toBe(0);
  });
});
