import { describe, it, expect } from "vitest";
import { cleanYouTubeTitle } from "@/lib/lyrics/clean-title";

describe("cleanYouTubeTitle", () => {
  it("cleans standard YouTube music video qualifiers", () => {
    const input = "Sơn Tùng M-TP - ĐỪNG LÀM TRÁI TIM ANH ĐAU | OFFICIAL MUSIC VIDEO";
    const res = cleanYouTubeTitle(input);
    expect(res.artistName).toBe("Sơn Tùng M-TP");
    expect(res.trackName).toBe("ĐỪNG LÀM TRÁI TIM ANH ĐAU");
    expect(res.cleanQuery).toBe("Sơn Tùng M-TP ĐỪNG LÀM TRÁI TIM ANH ĐAU");
  });

  it("handles bracketed MV, 4K, Lyric Video tags", () => {
    const input = "Đức Phúc x 911 - Em Đồng Ý (I Do) [Official MV] [4K]";
    const res = cleanYouTubeTitle(input);
    expect(res.artistName).toBe("Đức Phúc x 911");
    expect(res.trackName).toBe("Em Đồng Ý (I Do)");
  });

  it("handles en-dash and em-dash delimiters", () => {
    const input = "Vũ. – Lạ Lùng (Official Audio)";
    const res = cleanYouTubeTitle(input);
    expect(res.artistName).toBe("Vũ.");
    expect(res.trackName).toBe("Lạ Lùng");
  });

  it("handles colon delimiters", () => {
    const input = "Taylor Swift: Blank Space";
    const res = cleanYouTubeTitle(input);
    expect(res.artistName).toBe("Taylor Swift");
    expect(res.trackName).toBe("Blank Space");
  });

  it("returns cleanQuery for titles without standard artist delimiter", () => {
    const input = "Gặp Lại Nhau Khi Hoa Nở (Official Lyric Video)";
    const res = cleanYouTubeTitle(input);
    expect(res.artistName).toBeUndefined();
    expect(res.trackName).toBe("Gặp Lại Nhau Khi Hoa Nở");
    expect(res.cleanQuery).toBe("Gặp Lại Nhau Khi Hoa Nở");
  });

  it("handles empty or falsy inputs gracefully", () => {
    expect(cleanYouTubeTitle("")).toEqual({ trackName: "", cleanQuery: "" });
    // @ts-expect-error test invalid type
    expect(cleanYouTubeTitle(null)).toEqual({ trackName: "", cleanQuery: "" });
  });
});
