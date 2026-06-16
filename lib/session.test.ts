import { describe, it, expect, beforeEach } from "vitest";
import { saveSession, loadSession, clearSession } from "@/lib/session";

describe("session storage", () => {
  beforeEach(() => localStorage.clear());
  it("round-trips the session", () => {
    saveSession({ accountId: "a1", username: "Alice", token: "t1" });
    expect(loadSession()).toEqual({ accountId: "a1", username: "Alice", token: "t1" });
  });
  it("returns null when absent or malformed", () => {
    expect(loadSession()).toBeNull();
    localStorage.setItem("music-together:auth", "{not json");
    expect(loadSession()).toBeNull();
  });
  it("clears", () => {
    saveSession({ accountId: "a1", username: "Alice", token: "t1" });
    clearSession();
    expect(loadSession()).toBeNull();
  });
});
