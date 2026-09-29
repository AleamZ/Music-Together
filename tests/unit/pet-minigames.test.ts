import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildCareCases, buildPressCases, type CareCase, type PressCase } from "@/scripts/gen-pet-care-fixtures";
import {
  CARE_BASE, CARE_TICKS, careGain, careInputError, FEED, feedLand, FETCH, pack, PRESS, pressInputError, pressPower, pressRound,
  replayFeed, replayFetch, replayRub, RUB, rubLikes,
} from "@/lib/game/pets/minigames";

const SQL = readFileSync("supabase/migrations/0085_pet_minigames.sql", "utf8");
const FIXTURE = "tests/fixtures/pet-care-cases.json";

describe("pet care minigames (lib/game/pets/minigames.ts = 0085's _pcare_*)", () => {
  it("pet-care-cases.json is what the TS makes (WRITE_PET_CARE_FIXTURES=1 rewrites it)", () => {
    const data = { care: buildCareCases(), press: buildPressCases() };
    if (process.env.WRITE_PET_CARE_FIXTURES === "1") writeFileSync(FIXTURE, `${JSON.stringify(data)}\n`);
    const got = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as { care: CareCase[]; press: PressCase[] }) : null;
    expect(got).toEqual(data);
    const care = data.care.filter((c) => c.expected.error === null);
    expect(care.length).toBeGreaterThanOrEqual(50);
    expect(care.filter((c) => c.expected.suspicious).length).toBeGreaterThanOrEqual(6);
    expect(care.filter((c) => c.expected.permille === 1000 && !c.expected.suspicious).length).toBeGreaterThanOrEqual(3);
    expect(data.care.filter((c) => c.expected.error !== null).length).toBe(7);
  });

  it("the lengths and bases are the SQL's", () => {
    expect(CARE_TICKS).toEqual({ feed: 551, pat: 530, play: 820 });
    expect(SQL).toContain("when 'feed' then 551 when 'pat' then 530 when 'play' then 820");
    expect(feedLand(FEED.foods - 1)).toBe(FEED.ticks - 1);
    expect(RUB.lead + RUB.segs * RUB.seg).toBe(RUB.ticks);
    expect(FETCH.first + FETCH.throws * FETCH.gap).toBe(FETCH.ticks);
    expect(CARE_BASE).toEqual({ feed: { affection: 3, xp: 5 }, pat: { affection: 2, xp: 3 }, play: { affection: 5, xp: 10 } });
    expect(SQL).toContain("when 'feed' then 3 when 'pat' then 2 else 5");
    expect(SQL).toContain("when 'feed' then 5 when 'pat' then 3 else 10");
  });

  it("the gain scales 40 %…100 % of today's amount, never more", () => {
    expect(careGain(10, 0)).toBe(4);
    expect(careGain(10, 1000)).toBe(10);
    expect(careGain(3, 500)).toBe(2);
    for (let p = 0; p <= 1000; p += 7) for (const b of [2, 3, 5, 10]) expect(careGain(b, p)).toBeLessThanOrEqual(b);
  });

  it("FEED catches a treat only with the bowl in its lane at landing", () => {
    const seed = 1234;
    const r0 = replayFeed(seed, []);
    expect(r0.score).toBeGreaterThanOrEqual(0);
    const lanes = [0, 1, 2, 3, 4];
    for (const l of lanes) {
      const r = replayFeed(seed, [pack(0, l)]);
      expect(r.score).toBeLessThanOrEqual(FEED.foods);
    }
  });

  it("PAT counts only ticks on the liked spot; spots never repeat back to back", () => {
    const likes = rubLikes(99);
    for (let i = 1; i < likes.length; i++) expect(likes[i]).not.toBe(likes[i - 1]);
    const perfect = likes.map((l, k) => pack(RUB.lead + k * RUB.seg, l + 1));
    expect(replayRub(99, perfect).score).toBe(500);
    expect(replayRub(99, perfect).suspicious).toBe(true);
    expect(replayRub(99, []).score).toBe(0);
  });

  it("PLAY takes the first press of each throw", () => {
    const a = replayFetch(5, [25]);
    const b = replayFetch(5, [25, 60]);
    expect(b.score).toBe(a.score);
  });

  it("input rules", () => {
    expect(careInputError("feed", [], 550)).toBe("ticks");
    expect(careInputError("feed", [pack(3, 4)], FEED.ticks)).toBeNull();
    expect(careInputError("feed", [pack(3, 5)], FEED.ticks)).toBe("value");
    expect(careInputError("pat", [pack(3, 5)], RUB.ticks)).toBeNull();
    expect(careInputError("play", [819], FETCH.ticks)).toBeNull();
    expect(careInputError("play", [820], FETCH.ticks)).toBe("range");
  });
});

describe("the power press (0085's _ppress_*)", () => {
  it("stays inside ±15 %, best at the sweet spot, 850 without a press", () => {
    for (let s = 0; s < 200; s++) {
      const [period, centre] = pressRound(s * 7919);
      expect(period).toBeGreaterThanOrEqual(60);
      expect(period).toBeLessThanOrEqual(100);
      expect(centre).toBeGreaterThanOrEqual(200);
      expect(centre).toBeLessThanOrEqual(800);
      for (let t = 0; t < 120; t += 13) {
        const p = pressPower(s * 7919, t);
        expect(p).toBeGreaterThanOrEqual(PRESS.lo);
        expect(p).toBeLessThanOrEqual(PRESS.hi);
      }
    }
    expect(pressPower(1, null)).toBe(850);
    expect(pressInputError(null, 1)).toBeNull();
    expect(pressInputError(5, 5)).toBe("range");
    expect(pressInputError(0, 301)).toBe("ticks");
  });

  it("the SQL multiplies the side's hits by its power", () => {
    expect(SQL).toContain("v_dmg := greatest(1, round(v_dmg * pw[me] / 1000.0))::int;");
    expect(SQL).toContain("1150 - (300 * least(public._ppress_off(p_seed, p_press), 400)) / 400");
  });
});
