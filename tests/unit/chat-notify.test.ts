import { describe, it, expect } from "vitest";
import { newFromOthers } from "@/lib/chat-notify";
import type { ChatMessage } from "@/lib/chat";

const msg = (id: string, account_id: string | null): ChatMessage =>
  ({ id, room_id: "r", account_id, username: "u" + id, body: "b" + id, created_at: id });

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
  it("returns [] when there is nothing new", () => {
    expect(newFromOthers([], new Set(), "me")).toEqual([]);
  });
});
