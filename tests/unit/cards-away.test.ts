import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() } }));
import { nearCardCorner } from "@/hooks/useCardsController";
import { CARD_DECK } from "@/lib/game/maps/hall";

describe("nearCardCorner (auto stand-up after walking away)", () => {
  it("on the deck and just around it counts as at the table", () => {
    expect(nearCardCorner({ x: CARD_DECK.x + 10, y: CARD_DECK.y + 10 })).toBe(true);
    expect(nearCardCorner({ x: CARD_DECK.x - 30, y: CARD_DECK.y })).toBe(true);
  });
  it("across the yard is away", () => {
    expect(nearCardCorner({ x: 600, y: 300 })).toBe(false);
    expect(nearCardCorner({ x: CARD_DECK.x + CARD_DECK.w + 60, y: CARD_DECK.y })).toBe(false);
  });
});
