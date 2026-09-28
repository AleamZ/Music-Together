import { describe, expect, it, vi } from "vitest";

// v20.4: a season title rides on the look (characters.ug_title, 0052) and shows in the name tag; a database with 0051
// but not 0052 yet is read with the belt and without the title (once).
const calls: string[] = [];
const ROW = { account_id: "a", skin: "warm", hair: "short", hair_color: "black", hat: null, top: null, bottom: null, shoes: "shoes_dep_blue",
  neck: null, gender: "nam", outfit: "vp_karate", wrist: null, hairpin: null, belt: 2 };
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        calls.push(cols);
        return {
          in: async () => (cols.includes("ug_title")
            ? { data: null, error: { code: "42703", message: "column characters.ug_title does not exist" } }
            : { data: [ROW], error: null }),
        };
      },
    }),
  },
}));

import { fetchCharacters, lookFromRow } from "@/lib/game/character";
import { nameTag } from "@/lib/game/social";

describe("the season title on the look", () => {
  it("reads it from the row and tags the name", () => {
    const look = lookFromRow({ ...ROW, ug_title: "Cá Lóc mùa 1" });
    expect(look.ugTitle).toBe("Cá Lóc mùa 1");
    expect(nameTag("Tèo", look)).toBe("Tèo «Cá Lóc mùa 1»");
    expect(lookFromRow({ ...ROW, ug_title: "" })).not.toHaveProperty("ugTitle");
    expect(lookFromRow({ ...ROW, ug_title: "x".repeat(41) })).not.toHaveProperty("ugTitle");
    expect(nameTag("Tèo", null)).toBe("Tèo");
  });

  it("drops only the title when the database has the belt but not the title", async () => {
    const first = await fetchCharacters(["a"]);
    expect(first.get("a")?.belt).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("ug_title");
    expect(calls[1]).toContain("belt");
    expect(calls[1]).not.toContain("ug_title");
    await fetchCharacters(["a"]);
    expect(calls[2]).not.toContain("ug_title");            // remembered for the page
  });
});
