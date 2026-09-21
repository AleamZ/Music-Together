import { describe, it, expect } from "vitest";
import {
  parseChatMessageBody,
  formatChatMessageBody,
  cleanNotificationText,
  extractMentions,
} from "@/lib/chat-helpers";

describe("chat-helpers", () => {
  describe("parseChatMessageBody", () => {
    it("parses standard message without reply", () => {
      const parsed = parseChatMessageBody("Xin chào cả nhà!");
      expect(parsed).toEqual({
        replyToId: null,
        replyToUsername: null,
        text: "Xin chào cả nhà!",
      });
    });

    it("parses message with reply prefix", () => {
      const raw = "[reply:123e4567-e89b-12d3-a456-426614174000|Alice] Đồng ý nhé bạn!";
      const parsed = parseChatMessageBody(raw);
      expect(parsed).toEqual({
        replyToId: "123e4567-e89b-12d3-a456-426614174000",
        replyToUsername: "Alice",
        text: "Đồng ý nhé bạn!",
      });
    });

    it("handles multiline message with reply", () => {
      const raw = "[reply:123e4567-e89b-12d3-a456-426614174000|Bảo] Dòng 1\nDòng 2";
      const parsed = parseChatMessageBody(raw);
      expect(parsed.replyToUsername).toBe("Bảo");
      expect(parsed.text).toBe("Dòng 1\nDòng 2");
    });
  });

  describe("formatChatMessageBody", () => {
    it("formats normal message without reply", () => {
      expect(formatChatMessageBody("Hello world")).toBe("Hello world");
    });

    it("formats message with reply", () => {
      const result = formatChatMessageBody("Tuyệt vời", {
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "Tuấn",
      });
      expect(result).toBe("[reply:123e4567-e89b-12d3-a456-426614174000|Tuấn] Tuyệt vời");
    });

    it("guarantees length <= 500 even with long text and reply", () => {
      const longText = "a".repeat(600);
      const result = formatChatMessageBody(longText, {
        id: "123e4567-e89b-12d3-a456-426614174000",
        username: "LongUsernameSuperVeryLongName",
      });
      expect(result.length).toBeLessThanOrEqual(500);
      expect(result.startsWith("[reply:123e4567-e89b-12d3-a456-426614174000|LongUsernameSuperVeryLongName] ")).toBe(true);
    });
  });

  describe("cleanNotificationText", () => {
    it("returns plain text if no reply", () => {
      expect(cleanNotificationText("Hôm nay nghe nhạc gì?")).toBe("Hôm nay nghe nhạc gì?");
    });

    it("formats notification with reply recipient", () => {
      const raw = "[reply:123e4567-e89b-12d3-a456-426614174000|Hương] Đúng vậy nè";
      expect(cleanNotificationText(raw)).toBe("[Trả lời @Hương] Đúng vậy nè");
    });
  });

  describe("extractMentions", () => {
    it("extracts mentions with ASCII and Vietnamese names", () => {
      const text = "Chào @alice và @hương_99 cùng @Đức!";
      const mentions = extractMentions(text);
      expect(mentions).toEqual(["alice", "hương_99", "Đức"]);
    });

    it("returns empty array when no mentions", () => {
      expect(extractMentions("Không có mention nào")).toEqual([]);
    });
  });
});
