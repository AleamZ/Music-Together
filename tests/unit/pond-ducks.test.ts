import { describe, expect, it } from "vitest";
import { POND_PLATFORM } from "@/lib/game/maps/pond";
import { DUCK_MARGIN, duckClear, pondDuckAt } from "@/lib/game/world/pond-life";

describe("the pond's ducks", () => {
  it("never paddle under or through the jetty (cầu ao), and stay on the water", () => {
    for (const r of [0, 0.5, 1]) for (let a = 0; a < Math.PI * 2; a += 0.02) {
      const p = pondDuckAt(r, a);
      expect(duckClear(p.x, p.y), `ring ${r} at ${a.toFixed(2)}: (${p.x | 0}, ${p.y | 0})`).toBe(true);
      for (const d of POND_PLATFORM) {
        const inside = p.x > d.x - DUCK_MARGIN && p.x < d.x + d.w + DUCK_MARGIN && p.y > d.y - DUCK_MARGIN && p.y < d.y + d.h + DUCK_MARGIN;
        expect(inside).toBe(false);
      }
    }
  });
});
