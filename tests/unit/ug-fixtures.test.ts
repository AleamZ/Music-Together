import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stepWithBots } from "@/lib/game/fight/bot";
import { F_STYLE, G_ROUND, createMatch, fb, hash, roundResults } from "@/lib/game/fight/engine";
import { decodeRuns, runsError } from "@/lib/game/fight/log";
import { styleId } from "@/lib/game/fight/styles";
import type { BotCase } from "@/scripts/gen-dojo-fixtures";
import { buildBossCases } from "@/scripts/gen-ug-fixtures";

const FILE = "tests/fixtures/ug-boss-cases.json";

// v20.4 the bot ladder's shared fixtures (ruling R1): generated from the TS by scripts/gen-ug-fixtures.ts, replayed by
// 0052's engine in tests/sql/v20-4-smoke.sql. WRITE_UG_FIXTURES=1 rewrites the file.
describe("ug-boss-cases.json", () => {
  const built = buildBossCases();
  if (process.env.WRITE_UG_FIXTURES === "1") writeFileSync(FILE, `${JSON.stringify(built)}\n`);
  const cases = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as BotCase[]) : [];

  it("is the generator's output", () => {
    expect(cases).toEqual(built);
    expect(cases.map((c) => c.name)).toEqual(["floor1-strong", "floor5-middling", "floor10-strong", "floor10-idle"]);
  });

  it("replays with stepWithBots to the expected hashes; Trùm Hầm fights round 2 as Judo", () => {
    for (const c of cases) {
      const m = decodeRuns(c.runs, c.frames)!;
      expect(runsError(c.runs, 30_900), c.name).toBeNull();
      let s = createMatch(c.params);
      let sawJudo = false;
      for (const x of m) {
        s = stepWithBots(s, x, 0);
        if (s[G_ROUND] === 2 && s[fb(1) + F_STYLE] === styleId("judo")) sawJudo = true;
      }
      expect(hash(s), c.name).toBe(c.expected.hash);
      expect(roundResults(s), c.name).toEqual(c.expected.rounds);
      if (c.name.startsWith("floor10")) expect(sawJudo, c.name).toBe(true);
      expect(c.expected.result, c.name).toBeGreaterThan(0);
    }
  });
});