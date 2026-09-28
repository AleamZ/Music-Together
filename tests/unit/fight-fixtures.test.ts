import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMatch, hash, roundResults, runFrames, step } from "@/lib/game/fight/engine";
import { decodeRuns, runsError } from "@/lib/game/fight/log";
import { buildFightCases, type FightCase } from "@/scripts/gen-fight-fixtures";

const FILE = "tests/fixtures/fight-cases.json";

// The shared fixtures (ruling R1): generated from the TS engine by scripts/gen-fight-fixtures.ts, replayed by the SQL
// mirror in tests/sql/fight-engine-smoke.sql. WRITE_FIGHT_FIXTURES=1 rewrites the file.
describe("fight fixtures", () => {
  const built = buildFightCases();
  if (process.env.WRITE_FIGHT_FIXTURES === "1") writeFileSync(FILE, `${JSON.stringify(built)}\n`);
  const cases = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, "utf8")) as FightCase[]) : [];

  it("are the generator's output", () => {
    expect(cases).toEqual(built);
  });

  it("cover what the spec asks", () => {
    expect(cases.length).toBeGreaterThanOrEqual(40);
    const names = cases.map((c) => c.name);
    for (const style of ["tudo", "vovinam", "muaythai", "karate", "taekwondo", "boxing", "judo", "vinhxuan"]) {
      expect(names).toContain(`specials-hit-${style}`);
      expect(names).toContain(`specials-blocked-${style}`);
    }
    for (const n of ["throw-hit", "throw-tech", "double-ko", "time-up-draw", "five-round-draw-worst-case"]) expect(names).toContain(n);
    const worst = cases.find((c) => c.name === "five-round-draw-worst-case")!;
    expect(worst.frames).toBe(30_900);
    expect(worst.expected.result).toBe(3);
    expect(cases.find((c) => c.name === "double-ko")!.expected.rounds[0]).toMatchObject({ reason: 1, winner: 0 });
    expect(cases.find((c) => c.name === "throw-tech")!.expected.rounds).toEqual([]);
    // bot matches end in a result
    for (const c of cases.filter((x) => x.name.startsWith("bots-"))) expect(c.expected.result, c.name).toBeGreaterThan(0);
  });

  it("replay through runFrames to the expected hashes, and their logs are honest", () => {
    for (const c of cases) {
      const end = runFrames(createMatch(c.params), c.p1, c.p2, c.frames);
      expect(hash(end), c.name).toBe(c.expected.hash);
      expect(roundResults(end), c.name).toEqual(c.expected.rounds);
      expect(runsError(c.p1, 30_900), c.name).toBeNull();
      expect(runsError(c.p2, 30_900), c.name).toBeNull();
    }
  });

  it("hash every 600th frame as recorded (the streamed replay's checkpoints)", () => {
    for (const c of cases.slice(0, 12)) {
      const a = decodeRuns(c.p1, c.frames)!, b = decodeRuns(c.p2, c.frames)!;
      let s = createMatch(c.params);
      const got: [number, number][] = [];
      for (let k = 0; k < c.frames; k++) {
        s = step(s, a[k] ?? 0, b[k] ?? 0);
        if ((k + 1) % 600 === 0) got.push([k + 1, hash(s)]);
      }
      expect(got, c.name).toEqual(c.expected.hashes);
    }
  });
});
