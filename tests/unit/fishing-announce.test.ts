import { describe, it, expect } from "vitest";
import type { ChatMessage } from "@/lib/chat";
import { ANNOUNCER_NAME, freshAnnouncements, parseCatchAnnouncement } from "@/lib/game/fishing/announce";

const ACC = "0b6a4c3e-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
// the exact text finish_cast builds: format('[catch:%s|%s|%s] 🎣 %s vừa câu được %s %s (%s)!', ...)
const BODY = `[catch:${ACC}|ca_tra|3150] 🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!`;
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: ANNOUNCER_NAME, body: BODY, created_at: "2026-09-24T10:00:00Z", ...over,
});

describe("parseCatchAnnouncement", () => {
  it("reads the server's catch message", () => {
    expect(parseCatchAnnouncement(msg({}))).toEqual({
      accountId: ACC, speciesId: "ca_tra", weightG: 3150, text: "🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!",
    });
  });
  it("ignores members typing the prefix and malformed bodies", () => {
    expect(parseCatchAnnouncement(msg({ account_id: ACC }))).toBeNull();
    expect(parseCatchAnnouncement(msg({ username: "Dat" }))).toBeNull();
    expect(parseCatchAnnouncement(msg({ body: "hello" }))).toBeNull();
    expect(parseCatchAnnouncement(msg({ body: `[catch:${ACC}|CA TRA|3150] x` }))).toBeNull();
  });
});

describe("freshAnnouncements", () => {
  it("returns only unseen, recent announcements", () => {
    const now = Date.parse("2026-09-24T10:00:10Z");
    const out = freshAnnouncements([
      msg({ id: "a" }), msg({ id: "b" }), msg({ id: "c", created_at: "2026-09-24T09:00:00Z" }), msg({ id: "d", username: "x" }),
    ], new Set(["b"]), now);
    expect(out.map((o) => o.id)).toEqual(["a"]);
    expect(out[0].announcement.speciesId).toBe("ca_tra");
  });
});
