import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stepWithBots } from "@/lib/game/fight/bot";
import { createMatch, hash, roundResults } from "@/lib/game/fight/engine";
import { RateLimiter, decodeRuns, runsError } from "@/lib/game/fight/log";
import { buildBotCases, buildKataCases, type BotCase, type KataCase } from "@/scripts/gen-dojo-fixtures";

const KATA = "tests/fixtures/kata-cases.json";
const BOTS = "tests/fixtures/fight-bot-cases.json";

// The shared fixtures of v20.2 (ruling R1): generated from the TS by scripts/gen-dojo-fixtures.ts, replayed by 0049/0050
// in tests/sql/v20-2-smoke.sql. WRITE_DOJO_FIXTURES=1 rewrites them.
describe("v20.2 fixtures", () => {
  const kata = buildKataCases();
  const bots = buildBotCases();
  if (process.env.WRITE_DOJO_FIXTURES === "1") {
    writeFileSync(KATA, `${JSON.stringify(kata)}\n`);
    writeFileSync(BOTS, `${JSON.stringify(bots)}\n`);
  }
  const read = <T,>(f: string): T[] => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T[]) : []);

  it("kata-cases.json is the generator's output and covers the error codes", () => {
    const got = read<KataCase>(KATA);
    expect(got).toEqual(kata);
    expect(got.length).toBeGreaterThanOrEqual(100);
    const errors = new Set(got.map((c) => c.expected.error));
    for (const e of [null, "order", "lane", "crowd", "late", "count"]) expect(errors).toContain(e);
    expect(got.some((c) => c.expected.score && c.expected.score[4] > 0)).toBe(true);   // extra presses
  });

  it("fight-bot-cases.json is the generator's output: exams won and lost, every level, the dummy, a red bot", () => {
    const got = read<BotCase>(BOTS);
    expect(got).toEqual(bots);
    const by = (n: string) => got.find((c) => c.name.startsWith(n))!;
    expect(got.filter((c) => c.name.startsWith("exam-strong")).every((c) => c.expected.result === 1)).toBe(true);
    expect(got.filter((c) => c.name.startsWith("exam-idle")).every((c) => c.expected.result === 2)).toBe(true);
    for (let l = 1; l <= 8; l++) expect(by(`level${l}-`)).toBeDefined();
    expect(by("dummy").expected.result).toBe(1);
    expect(by("bot-as-red").player).toBe("p2");
  });

  it("replay with stepWithBots to the expected hashes; the player logs are honest", () => {
    for (const c of bots) {
      const m = decodeRuns(c.runs, c.frames)!;
      expect(m, c.name).toHaveLength(c.frames);
      expect(runsError(c.runs, 30_900), c.name).toBeNull();
      let s = createMatch(c.params);
      for (const x of m) s = c.player === "p1" ? stepWithBots(s, x, 0) : stepWithBots(s, 0, x);
      expect(hash(s), c.name).toBe(c.expected.hash);
      expect(roundResults(s), c.name).toEqual(c.expected.rounds);
      expect(s[7], c.name).toBe(c.expected.result);
      // every 300-frame chunk (a push) passes the server's check on its own
      for (let k = 0; k < m.length; k += 300) {
        const chunk: number[] = [];
        for (const x of m.slice(k, k + 300)) {
          const n = chunk.length;
          if (n > 0 && chunk[n - 2] === x) chunk[n - 1] += 1;
          else chunk.push(x, 1);
        }
        expect(runsError(chunk, 300), `${c.name} @${k}`).toBeNull();
      }
    }
  });
});

describe("RateLimiter (plan ruling P11)", () => {
  it("holds back the 21st change inside 60 frames and lets it through later", () => {
    const lim = new RateLimiter();
    const out: number[] = [];
    for (let k = 0; k < 200; k++) out.push(lim.limit(k % 2 === 0 ? 16 : 0));
    const runs: number[] = [];
    for (const x of out) {
      const n = runs.length;
      if (n > 0 && runs[n - 2] === x) runs[n - 1] += 1;
      else runs.push(x, 1);
    }
    expect(runsError(runs, 1000)).toBeNull();
    // the first 20 frames alternate, then it stalls until the window frees up
    expect(out.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, k) => (k % 2 === 0 ? 16 : 0)));
    expect(new Set(out.slice(20, 60)).size).toBe(1);
  });
  it("passes steady play untouched", () => {
    const lim = new RateLimiter();
    const want = Array.from({ length: 600 }, (_, k) => (Math.trunc(k / 4) % 2 ? 64 : 1));
    expect(want.map((m) => lim.limit(m))).toEqual(want);
  });
});
