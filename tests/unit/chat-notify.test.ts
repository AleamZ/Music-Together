import { describe, it, expect } from "vitest";
import { newFromOthers, notificationText } from "@/lib/chat-notify";
import type { ChatMessage } from "@/lib/chat";
import { ANNOUNCER_NAME } from "@/lib/game/fishing/announce";

const msg = (id: string, account_id: string | null): ChatMessage =>
  ({ id, room_id: "r", account_id, username: "u" + id, body: "b" + id, created_at: id, system: false });
// a server catch announcement (v14): no author, the announcer's name, the catcher's account in the prefix
const ME = "0b6a4c3e-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
const OTHER = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";
const catchMsg = (id: string, catcher: string): ChatMessage =>
  ({ id, room_id: "r", account_id: null, username: ANNOUNCER_NAME, body: `[catch:${catcher}|ca_tra|3150] 🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!`, created_at: id, system: true });

describe("newFromOthers", () => {
  it("returns unseen messages from others, in order", () => {
    const msgs = [msg("1", "me"), msg("2", "other"), msg("3", "other2")];
    expect(newFromOthers(msgs, new Set(["1"]), "me").map((m) => m.id)).toEqual(["2", "3"]);
  });
  it("excludes your own messages", () => {
    expect(newFromOthers([msg("1", "me")], new Set(), "me")).toEqual([]);
  });
  it("excludes already-seen messages", () => {
    expect(newFromOthers([msg("1", "other")], new Set(["1"]), "me")).toEqual([]);
  });
  it("treats null-author messages as from others", () => {
    expect(newFromOthers([msg("1", null)], new Set(), "me").map((m) => m.id)).toEqual(["1"]);
  });
  it("excludes a catch announcement about your own catch", () => {
    expect(newFromOthers([catchMsg("1", ME)], new Set(), ME)).toEqual([]);
  });
  it("treats a catch announcement about someone else as from others", () => {
    expect(newFromOthers([catchMsg("1", OTHER)], new Set(), ME).map((m) => m.id)).toEqual(["1"]);
  });
  it("returns [] when there is nothing new", () => {
    expect(newFromOthers([], new Set(), "me")).toEqual([]);
  });
});

describe("notificationText", () => {
  it("shows the readable part of a land sale", () => {
    const sale: ChatMessage = { id: "l", room_id: "r", account_id: null, username: "Hợp tác xã", body: "[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.", created_at: "l", system: true };
    expect(notificationText(sale)).toBe("🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.");
    expect(newFromOthers([sale], new Set(), ME).map((m) => m.id)).toEqual(["l"]);
  });
  it("shows the readable part of a catch announcement", () => {
    expect(notificationText(catchMsg("1", OTHER))).toBe("🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!");
  });
  it("shows the cleaned body of a normal message", () => {
    const reply = { ...msg("1", "other"), body: "[reply:123e4567-e89b-12d3-a456-426614174000|Hương] Đúng vậy nè" };
    expect(notificationText(reply)).toBe("[Trả lời @Hương] Đúng vậy nè");
    expect(notificationText(msg("2", "other"))).toBe("b2");
  });
});
