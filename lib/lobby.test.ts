import { describe, it, expect } from "vitest";
import { aggregateActiveRooms, type LobbyPresence } from "@/lib/lobby";

type Entry = LobbyPresence & { presence_ref: string };
const e = (account_id: string, room_id: string | null, username = account_id): Entry =>
  ({ account_id, username, room_id, online_at: "t", presence_ref: Math.random().toString() });

describe("aggregateActiveRooms", () => {
  it("dedupes by account across tabs and excludes lobby browsers (room_id null)", () => {
    const state = {
      k1: [e("a1", "r1", "Alice")],
      k2: [e("a1", "r1", "Alice")], // same account, 2nd tab, same room -> counts once
      k3: [e("a2", "r1", "Bob")],
      k4: [e("a3", null)],          // browsing lobby -> excluded
      k5: [e("a4", "r2", "Dan")],
    };
    const m = aggregateActiveRooms(state);
    expect(m.get("r1")!.count).toBe(2);
    expect(new Set(m.get("r1")!.usernames)).toEqual(new Set(["Alice", "Bob"]));
    expect(m.get("r2")!.count).toBe(1);
    expect(m.has("__none__")).toBe(false);
  });
  it("empty state -> empty map", () => {
    expect(aggregateActiveRooms({}).size).toBe(0);
  });
});
