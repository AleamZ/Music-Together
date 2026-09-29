import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMgEventCases, type MgEventCase } from "@/scripts/gen-mg-events-fixtures";
import { liveTick, parseSync } from "@/lib/game/mglive";
import {
  anvilRound, brewRound, createAnvilWaiting, createBrewFrom, createSortFrom, replayAnvil, replayAnvilP, replayBrew, replayBrewP,
  replaySort, replaySortP, sortRound, withDrift, withGlow, withKinds,
} from "@/lib/game/craftmg/games";
import { createMineRoundFrom, mineRound, replayMine, replayMineP, withVeins } from "@/lib/game/mining/game";
import { careRoundFrom, feedLanes, fetchFlights, pressRound, replayCare, replayCareP, rubLikes } from "@/lib/game/pets/minigames";
import {
  comboParams, comboParamsFrom, huntParams, huntParamsFrom, photoParams, photoParamsFrom, replayCombo, replayComboP, replayWild,
  replayWildP, trapParams, trapParamsFrom,
} from "@/lib/game/realm/minigames";
import { createRowFrom, replayRow, replayRowP, rowRound, withBeats } from "@/lib/game/river/row";

// 0087: the live channel. The fixture pins public._mg_events (the SQL smoke checks it); here the overlays' *From
// functions must rebuild, from exactly those events, the round the seed functions (the fixtures' reference) make.

const FIXTURE = "tests/fixtures/mg-events-cases.json";
type Ev = Record<number, Record<string, number>>;
const evOf = (c: MgEventCase): Ev => Object.fromEntries(c.events.map((e) => [e.i, e.d]));

describe("0087 live minigame events", () => {
  const cases = buildMgEventCases();

  it("mg-events-cases.json is what the TS makes (WRITE_MG_EVENTS_FIXTURES=1 rewrites it)", () => {
    if (process.env.WRITE_MG_EVENTS_FIXTURES === "1") writeFileSync(FIXTURE, `${JSON.stringify(cases)}\n`);
    const got = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;
    expect(got).toEqual(cases);
    expect(cases.length).toBeGreaterThanOrEqual(100);
  });

  it("the overlays rebuild every round from its events", () => {
    for (const c of cases) {
      const ev = evOf(c), sp = String(c.meta.species ?? "");
      switch (c.kind) {
        case "hunt": {
          const p = huntParamsFrom(100, ev)!;
          const want = huntParams(c.seed, sp);
          expect([p.period, p.phase, p.wind], c.name).toEqual([want.period, want.phase, want.wind]);
          if (c.meta.danger) expect(p.charge, c.name).toBe(want.charge);
          break;
        }
        case "trap": expect(trapParamsFrom(sp, ev), c.name).toEqual(trapParams(c.seed, sp)); break;
        case "photo": expect(photoParamsFrom(ev), c.name).toEqual(photoParams(c.seed, sp)); break;
        case "combo": {
          const p = comboParamsFrom(ev);
          expect(p.known).toBe(6);
          expect({ beats: p.beats, dirs: p.dirs, slam: p.slam, end: p.end }, c.name).toEqual(comboParams(c.seed));
          break;
        }
        case "brew": expect(withDrift(createBrewFrom(c.params[0]), ev).drift, c.name).toEqual(brewRound(c.seed).slice(1)); break;
        case "anvil": {
          const a = withGlow(createAnvilWaiting(), ev[1].period, ev[1].phase);
          expect([a.period, a.phase], c.name).toEqual(anvilRound(c.seed));
          break;
        }
        case "sort": expect(withKinds(createSortFrom(), ev).kinds, c.name).toEqual(sortRound(c.seed)); break;
        case "feed": expect(careRoundFrom("feed", ev), c.name).toEqual(feedLanes(c.seed)); break;
        case "pat": expect(careRoundFrom("pat", ev), c.name).toEqual(rubLikes(c.seed)); break;
        case "play": expect(careRoundFrom("play", ev), c.name).toEqual(fetchFlights(c.seed)); break;
        case "out": case "home": expect(withBeats(createRowFrom(6), ev).beats, c.name).toEqual(rowRound(c.seed)); break;
        case "press": expect(ev[1].centre, c.name).toBe(pressRound(c.seed)[1]); break;
        case "dig": case "mine": {
          const need = c.params.length - 1;
          const s = withVeins(createMineRoundFrom(c.params[0], need, Number(c.meta.win)), ev);
          expect(s.centres, c.name).toEqual(mineRound(c.seed, need).slice(1));
          break;
        }
        default: throw new Error(c.kind);
      }
    }
  });

  it("a vein is revealed only once the strike that found the last one exists", () => {
    const c = buildMgEventCases().find((x) => x.game === "dig" && x.params.length === 4)!;
    expect(c.events.map((e) => e.i)).toEqual([1, 2, 3]);
    expect(c.events[1].at).toBeGreaterThanOrEqual(c.a[0]);
    expect(c.events[2].at).toBeGreaterThanOrEqual(c.a[1]);
  });

  it("the parameter replays are the seed replays", () => {
    for (const seed of [1, 42, 777, 123456789, 4000000000]) {
      expect(replayBrewP(brewRound(seed), [5, 90, 200, 333])).toBe(replayBrew(seed, [5, 90, 200, 333]));
      expect(replayAnvilP(anvilRound(seed), [70, 140, 200, 280, 350])).toEqual(replayAnvil(seed, [70, 140, 200, 280, 350]));
      expect(replaySortP(sortRound(seed), [50, 95, 150], [0, 1, 0])).toEqual(replaySort(seed, [50, 95, 150], [0, 1, 0]));
      expect(replayCareP("feed", feedLanes(seed), [400, 800])).toEqual(replayCare("feed", seed, [400, 800]));
      expect(replayCareP("pat", rubLikes(seed), [241, 1042])).toEqual(replayCare("pat", seed, [241, 1042]));
      expect(replayCareP("play", fetchFlights(seed), [80, 170])).toEqual(replayCare("play", seed, [80, 170]));
      expect(replayRowP(rowRound(seed), 6, [181, 272, 341])).toEqual(replayRow(seed, 6, [181, 272, 341]));
      expect(replayMineP(mineRound(seed, 3), 3, 120, [30, 60, 90, 120])).toEqual(replayMine(seed, 3, 120, [30, 60, 90, 120]));
      expect(replayComboP(comboParams(seed), [480, 720], [300], 600)).toEqual(replayCombo(seed, [480, 720], [300], 600));
      expect(replayWildP("hunt", huntParams(seed, "wolf"), true, [100, 200], [220])).toEqual(replayWild("hunt", seed, "wolf", true, [100, 200], [220]));
      expect(replayWildP("trap", trapParams(seed, "bird"), false, [150], [])).toEqual(replayWild("trap", seed, "bird", false, [150], []));
      expect(replayWildP("photo", photoParams(seed, "deer"), false, [60, 130], [10])).toEqual(replayWild("photo", seed, "deer", false, [60, 130], [10]));
    }
  });

  it("parses a sync answer and counts ticks on wall time", () => {
    expect(parseSync({ t: 12, ev: [{ i: 1, d: { beat: 100, dir: 2 } }, { i: "x", d: {} }, { i: 3, d: { c: 500, junk: "no" } }] }))
      .toEqual({ t: 12, ev: { 1: { beat: 100, dir: 2 }, 3: { c: 500 } } });
    expect(parseSync(null)).toEqual({ t: 0, ev: {} });
    expect(liveTick(1000, 1000)).toBe(0);
    expect(liveTick(1000, 2000)).toBe(60);
    expect(liveTick(1000, 900)).toBe(0);
  });
});
