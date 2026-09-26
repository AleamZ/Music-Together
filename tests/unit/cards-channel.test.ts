import { describe, it, expect } from "vitest";
import { cardTopic, parseCardHint } from "@/lib/game/cards/channel";

describe("the card table's channel (spec §12)", () => {
  it("is one topic per table", () => {
    expect(cardTopic("room-1", "poker")).toBe("cards:room-1:poker");
  });

  it("reads a cv hint {id, v} and nothing else", () => {
    expect(parseCardHint({ id: "a1", v: 812 })).toEqual({ id: "a1", v: 812 });
    expect(parseCardHint({ id: "a1", v: 812, state: { phase: "idle" } })).toEqual({ id: "a1", v: 812 });
    for (const bad of [null, "cv", { id: "a1" }, { v: 3 }, { id: "", v: 3 }, { id: "a1", v: -1 }, { id: "a1", v: 1.5 },
      { id: "x".repeat(65), v: 3 }, { id: 7, v: 3 }]) {
      expect(parseCardHint(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
