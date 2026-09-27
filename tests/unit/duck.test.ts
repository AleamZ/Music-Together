import { afterEach, describe, expect, it } from "vitest";
import { clearDucked, DUCK_KEY, markDucked, takeDucked } from "@/lib/game/housing/duck";

afterEach(() => localStorage.clear());

describe("v19.3: the TV's duck survives a closed tab", () => {
  it("marks, clears and takes the marker", () => {
    markDucked(55);
    expect(localStorage.getItem(DUCK_KEY)).toBe("55");
    clearDucked();
    expect(localStorage.getItem(DUCK_KEY)).toBeNull();
    markDucked(30);
    expect(takeDucked()).toBe(30);
    expect(localStorage.getItem(DUCK_KEY)).toBeNull();
    expect(takeDucked()).toBeNull();
  });
});
