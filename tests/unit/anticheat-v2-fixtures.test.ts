import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildKataNoiseCases, buildSecretCases, type KataNoiseCase, type SecretCase } from "@/scripts/gen-anticheat-v2-fixtures";

// Anti-cheat v2 part 2's shared fixtures: generated from the TS by scripts/gen-anticheat-v2-fixtures.ts and replayed by
// the SQL smokes (tests/sql/anticheat-v2-*-smoke.sql). WRITE_AV2_FIXTURES=1 rewrites them.
const FILES = {
  secret: "tests/fixtures/fight-secret-cases.json",
  kata: "tests/fixtures/kata-noise-cases.json",
} as const;
const read = <T,>(f: string): T[] => (existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as T[]) : []);
const write = process.env.WRITE_AV2_FIXTURES === "1";

describe("anti-cheat v2 part 2 fixtures", () => {
  it("fight-secret-cases.json: secret-bot matches won, lost and idle", () => {
    const cases = buildSecretCases();
    if (write) writeFileSync(FILES.secret, `${JSON.stringify(cases)}\n`);
    const got = read<SecretCase>(FILES.secret);
    expect(got).toEqual(cases);
    expect(got.every((c) => c.params.seed === 0 && c.params.secretBot === true)).toBe(true);
    expect(got.some((c) => c.expected.result === 1)).toBe(true);
    expect(got.some((c) => c.expected.result === 2)).toBe(true);
    expect(got.some((c) => c.expected.rounds.length >= 2)).toBe(true);           // a re-seed at a new round
  });

  it("kata-noise-cases.json: the reveal, the offsets, robotic and not", () => {
    const cases = buildKataNoiseCases();
    if (write) writeFileSync(FILES.kata, `${JSON.stringify(cases)}\n`);
    const got = read<KataNoiseCase>(FILES.kata);
    expect(got).toEqual(cases);
    expect(got.filter((c) => c.expected.robotic).length).toBeGreaterThanOrEqual(3);
    expect(got.filter((c) => !c.expected.robotic).length).toBeGreaterThanOrEqual(3);
    expect(got.find((c) => c.name.startsWith("hand-") && c.rank === 4)?.expected.robotic).toBe(false);
  });
});
