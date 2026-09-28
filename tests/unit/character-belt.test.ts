import { describe, expect, it, vi } from "vitest";

// v20.3 (plan ruling P23): looks carry the worn uniform's rank from characters.belt; a database without 0051 yet is
// read without the column (once), so looks never break before the migration runs.
const calls: string[] = [];
const ROW = { account_id: "a", skin: "warm", hair: "short", hair_color: "black", hat: null, top: null, bottom: null, shoes: "shoes_dep_blue",
  neck: null, gender: "nam", outfit: "vp_karate", wrist: null, hairpin: null };
let hasBelt = false;
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: (cols: string) => {
        calls.push(cols);
        return {
          in: async () => (cols.includes("belt") && !hasBelt
            ? { data: null, error: { code: "42703", message: "column characters.belt does not exist" } }
            : { data: [{ ...ROW, ...(cols.includes("belt") ? { belt: 3 } : {}) }], error: null }),
        };
      },
    }),
  },
}));

import { fetchCharacters, lookFromRow } from "@/lib/game/character";

describe("the belt on the look", () => {
  it("reads characters.belt (0–4 only)", () => {
    expect(lookFromRow({ ...ROW, belt: 2 }).belt).toBe(2);
    expect(lookFromRow({ ...ROW, belt: 9 })).not.toHaveProperty("belt");
    expect(lookFromRow({ ...ROW })).not.toHaveProperty("belt");
  });

  it("falls back to the old columns once when the database has no belt yet", async () => {
    const first = await fetchCharacters(["a"]);
    expect(first.get("a")?.outfit).toBe("vp_karate");
    expect(first.get("a")).not.toHaveProperty("belt");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("belt");
    expect(calls[1]).not.toContain("belt");
    hasBelt = true;
    await fetchCharacters(["a"]);
    expect(calls[2]).not.toContain("belt");                // remembered for the page
  });
});
