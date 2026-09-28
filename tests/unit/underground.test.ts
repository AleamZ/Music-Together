import { describe, expect, it } from "vitest";
import { createMatch, F_STYLE, fb } from "@/lib/game/fight/engine";
import { styleId } from "@/lib/game/fight/styles";
import {
  BOSSES, K_NEW, K_SETTLED, RATING_FLOOR, RATING_START, TIERS, bossMatchParams, cupPayout, eloDelta, kFor, ladderPrize,
  noShowPay, ratedWin, seasonOf, seasonTitle, seedBracket, softReset, tierOf, windowFor,
} from "@/lib/game/fight/underground";

describe("underground tiers (spec §v20.4 'Rating, tiers and seasons')", () => {
  it("has the five tiers at their boundaries", () => {
    expect(TIERS.map((t) => t.name)).toEqual(["Tép riu", "Cá rô", "Cá lóc", "Cá mập", "Thủy quái"]);
    expect(tierOf(800).key).toBe("tep_riu");
    expect(tierOf(1099).key).toBe("tep_riu");
    expect(tierOf(1100).key).toBe("ca_ro");
    expect(tierOf(1249).key).toBe("ca_ro");
    expect(tierOf(1250).key).toBe("ca_loc");
    expect(tierOf(1399).key).toBe("ca_loc");
    expect(tierOf(1400).key).toBe("ca_map");
    expect(tierOf(1549).key).toBe("ca_map");
    expect(tierOf(1550).key).toBe("thuy_quai");
    expect(tierOf(2400).key).toBe("thuy_quai");
  });
});

describe("seasons", () => {
  it("are 28 VN days from 2026-10-01 (season 0 before and through the first 28 days)", () => {
    expect(seasonOf("2026-09-28")).toBe(0);
    expect(seasonOf("2026-10-01")).toBe(0);
    expect(seasonOf("2026-10-28")).toBe(0);
    expect(seasonOf("2026-10-29")).toBe(1);
    expect(seasonOf("2026-11-26")).toBe(2);
    expect(seasonTitle("thuy_quai", 0)).toBe("Thủy quái mùa 1");
    expect(seasonTitle("trum_ham", 2)).toBe("Trùm hầm mùa 3");
  });
  it("soft-resets halfway to 1 000, never under the floor", () => {
    expect(RATING_START).toBe(1000);
    expect(RATING_FLOOR).toBe(800);
    expect(softReset(1600)).toBe(1300);
    expect(softReset(1001)).toBe(1000);
    expect(softReset(1000)).toBe(1000);
    expect(softReset(899)).toBe(950);
    expect(softReset(800)).toBe(900);
  });
});

describe("Elo (the TS copy of 0052's _ug_elo, for display)", () => {
  it("K is 40 for the first 10 rated matches, 24 after", () => {
    expect(kFor(0)).toBe(K_NEW);
    expect(kFor(9)).toBe(40);
    expect(kFor(10)).toBe(K_SETTLED);
    expect(K_SETTLED).toBe(24);
  });
  it("moves equal ratings by K/2, a draw by 0, and halves on the pair rule", () => {
    expect(eloDelta(1000, 1000, 1, 40)).toBe(20);
    expect(eloDelta(1000, 1000, 0, 40)).toBe(-20);
    expect(eloDelta(1000, 1000, 0.5, 24)).toBe(0);
    expect(eloDelta(1000, 1000, 1, 24, 0.5)).toBe(6);
    // an upset pays more than a favourite's win
    expect(eloDelta(1000, 1400, 1, 24)).toBe(22);
    expect(eloDelta(1400, 1000, 1, 24)).toBe(2);
    expect(eloDelta(1400, 1000, 0.5, 24)).toBe(-10);
  });
});

describe("the pots (the 5 % burned fee, plan ruling U1)", () => {
  it("rated: the winner takes 2 × entry − 5 %", () => {
    expect(ratedWin(500)).toEqual({ pot: 1000, fee: 50, won: 950 });
    expect(ratedWin(5000)).toEqual({ pot: 10000, fee: 500, won: 9500 });
  });
  it("cup: 4 × entry − 5 %, the champion 70 %, the runner-up the rest", () => {
    expect(cupPayout(1000)).toEqual({ pot: 4000, fee: 200, pool: 3800, champion: 2660, runnerUp: 1140 });
    expect(cupPayout(5000)).toEqual({ pot: 20000, fee: 1000, pool: 19000, champion: 13300, runnerUp: 5700 });
  });
  it("a no-show's entry goes to the present player less 5 %", () => {
    expect(noShowPay(2000)).toBe(1900);
  });
});

describe("the bracket", () => {
  it("seeds by rating (ties by account id): 1 v 4, 2 v 3", () => {
    const b = seedBracket([
      { id: "d", rating: 1000 }, { id: "a", rating: 1300 }, { id: "c", rating: 1000 }, { id: "b", rating: 1200 },
    ]);
    expect(b.seeds).toEqual(["a", "b", "c", "d"]);
    expect(b.semis).toEqual([["a", "d"], ["b", "c"]]);
  });
});

describe("the queue window", () => {
  it("is ±150, widening by 50 every 15 s up to ±400", () => {
    expect(windowFor(0)).toBe(150);
    expect(windowFor(14_999)).toBe(150);
    expect(windowFor(15_000)).toBe(200);
    expect(windowFor(60_000)).toBe(350);
    expect(windowFor(75_000)).toBe(400);
    expect(windowFor(300_000)).toBe(400);
  });
});

describe("the bot ladder (owner ruling: first-clear prizes halved)", () => {
  it("has ten named bosses in order with the spec's styles, levels, HP and entries", () => {
    expect(BOSSES.map((b) => b.floor)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(BOSSES.map((b) => b.name)).toEqual([
      "Cu Tí Lì Lợm", "Bảy Chợ Cá", "Mèo Muay", "Hắc Đai Lùn", "Cước Phong", "Găng Đồng", "Gấu Quật", "Mộc Nhân", "Ba Mù", "Trùm Hầm",
    ]);
    expect(BOSSES.map((b) => b.level)).toEqual([1, 2, 3, 4, 5, 5, 6, 7, 7, 8]);
    expect(BOSSES.map((b) => b.hpPct)).toEqual([100, 100, 100, 105, 105, 110, 115, 115, 125, 130]);
    expect(BOSSES.map((b) => b.entry)).toEqual([100, 200, 300, 500, 800, 1000, 1500, 2000, 3000, 5000]);
    expect(BOSSES.map((b) => b.style)).toEqual(["boxing", "vovinam", "muaythai", "karate", "taekwondo", "boxing", "judo", "vinhxuan", "karate", "muaythai"]);
    expect(BOSSES[9].styleByRound).toEqual(["muaythai", "judo", "vinhxuan", "muaythai", "judo"]);
  });
  it("pays half the spec's first-clear prizes (21 750 a season), 10 % on repeats — never worth farming", () => {
    expect(BOSSES.map((b) => b.prize)).toEqual([200, 350, 500, 750, 1200, 1500, 2250, 3000, 4500, 7500]);
    expect(BOSSES.reduce((a, b) => a + b.prize, 0)).toBe(21_750);
    for (const b of BOSSES) {
      expect(ladderPrize(b.floor, true)).toBe(b.prize);
      expect(ladderPrize(b.floor, false)).toBe(Math.floor(b.prize / 10));
      expect(ladderPrize(b.floor, false)).toBeLessThan(b.entry);
    }
  });
  it("builds the boss's params: rank 4, every special, its HP and level; floor 10 changes style", () => {
    const me = { style: 1, rank: 2 };
    const p = bossMatchParams(10, me, 77);
    expect(p.p2).toMatchObject({ rank: 4, movesMask: 31, hpPct: 130, bot: 8, style: styleId("muaythai") });
    expect(p.p2.styleByRound).toEqual([2, 6, 7, 2, 6]);
    expect(p.p1).toMatchObject({ style: 1, rank: 2, movesMask: 7, bot: 0 });
    expect(p.rounds).toBe(3);
    const s = createMatch(p);
    expect(s[fb(1) + F_STYLE]).toBe(styleId("muaythai"));
    expect(bossMatchParams(1, me, 1).p2.styleByRound).toBeUndefined();
  });
});
