import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRowCases, type RowCase } from "@/scripts/gen-row-fixtures";
import { getMap } from "@/lib/game/maps/registry";
import { SONG_CAI_ARRIVE, POND_PIER_ARRIVE } from "@/lib/game/maps/arrivals";
import { BOAT } from "@/lib/game/fishing/extras";
import { MAP_MIN_LEVEL } from "@/lib/game/progression/model";
import { canRide } from "@/lib/game/travel/ride";
import { inShade } from "@/lib/game/heat/shade";
import { RIVER, RIVER_H, RIVER_W, riverInteractable, riverWater, shoalAt } from "@/lib/game/river/geometry";
import { canStroke, createRow, encodeStroke, replayRow, ROW, rowEnd, rowInputError, rowRound, stepRow } from "@/lib/game/river/row";
import { parseDigFinish, parseDigStart, parsePing, parseRowFinish, parseRowStart } from "@/lib/game/river/rpc";
import { RIVER_SPECIES } from "@/lib/game/river/species";
import { beepMs, DETECTOR_BANDS, signalBars, SHOVEL, treasureBand } from "@/lib/game/river/treasure";

const SQL = readFileSync("supabase/migrations/0086_explore_minigames.sql", "utf8").replace(/\r\n/g, "\n");
const FIXTURE = "tests/fixtures/row-cases.json";

/** The body of `create or replace function public.<name>(` up to its closing `$$;`. */
function body(name: string): string {
  const at = SQL.indexOf(`create or replace function public.${name}(`);
  expect(at, name).toBeGreaterThan(-1);
  return SQL.slice(at, SQL.indexOf("$$;", at) + 3);
}

describe("chèo ghe (lib/game/river/row.ts = 0086's _row_replay)", () => {
  it("row-cases.json is what the TS makes (WRITE_ROW_FIXTURES=1 rewrites it)", () => {
    const cases = buildRowCases();
    if (process.env.WRITE_ROW_FIXTURES === "1") writeFileSync(FIXTURE, `${JSON.stringify(cases)}\n`);
    const got = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as RowCase[]) : [];
    expect(got).toEqual(cases);
    expect(got.filter((c) => c.expected.outcome === "pass").length).toBeGreaterThanOrEqual(8);
    expect(got.filter((c) => c.expected.outcome === "fail").length).toBeGreaterThanOrEqual(8);
    for (const c of got) expect(rowInputError(c.strokes, c.expected.ticks), c.name).toBeNull();
  });

  it("twelve beats after the lead-in, gaps of 34–54 ticks, sides mostly alternating", () => {
    const r = rowRound(12345);
    expect(r.targets).toHaveLength(ROW.beats);
    expect(r.targets[0]).toBe(ROW.lead);
    for (let b = 1; b < ROW.beats; b++) {
      const gap = r.targets[b] - r.targets[b - 1];
      expect(gap).toBeGreaterThanOrEqual(34);
      expect(gap).toBeLessThanOrEqual(54);
    }
    expect(rowEnd(r)).toBe(r.targets[11] + ROW.win + 1);
  });

  it("the stepped row and the replay agree", () => {
    for (const seed of [1, 99, 123456789]) {
      let s = createRow(seed, 8);
      while (s.outcome === "open") {
        const b = s.beat;
        const want = b < ROW.beats && s.tick === s.beats.targets[b] + (b % 3) - 1 ? s.beats.sides[b] : null;
        s = stepRow(s, want !== null && canStroke(s) ? want : null);
      }
      const r = replayRow(seed, 8, s.strokes);
      expect(r.outcome).toBe(s.outcome);
      expect(r.hits).toBe(s.hits);
      expect(r.stray).toBe(s.stray);
      expect(r.ticks).toBe(s.tick);
      expect(r.hits).toBe(12);
    }
  });

  it("the wrong side is stray; too many strays fail even with the hits", () => {
    const r = rowRound(7);
    const wrong = r.targets.map((t, b) => encodeStroke(t, (1 - r.sides[b]) as 0 | 1));
    expect(replayRow(7, 6, wrong)).toMatchObject({ outcome: "fail", hits: 0, stray: 12 });
  });

  it("the input rules: ≤ 40 strokes, increasing, ≤ 3 in 12 ticks, inside the row", () => {
    expect(rowInputError([], 600)).toBeNull();
    expect(rowInputError([200, 201, 240], 600)).toBeNull();
    expect(rowInputError([200, 210, 220, 222], 600)).toBe("rate");
    expect(rowInputError([200, 190], 600)).toBe("order");
    expect(rowInputError([1300], 600)).toBe("range");
    expect(rowInputError([1], 0)).toBe("ticks");
    expect(rowInputError(Array.from({ length: 41 }, (_, i) => i * 30), 1200)).toBe("too_many");
  });

  it("0086 mirrors the constants", () => {
    const round = body("_row_round");
    expect(round).toContain("for b in 0 .. 11 loop");
    expect(round).toContain(`t := ${ROW.lead};`);
    expect(round).toContain("t := t + 34 + (u % 21)::int;");
    const rep = body("_row_replay");
    expect(rep).toContain(`rd[b + 1] + ${ROW.win} < t`);
    expect(rep).toContain(`abs(t - rd[b + 1]) <= ${ROW.win} and sd = rd[b + 13]`);
    expect(rep).toContain(`'ticks', rd[12] + ${ROW.win + 1}`);
    expect(rep).toContain(`stray <= ${ROW.maxStray}`);
    const err = body("_row_input_error");
    expect(err).toContain(`p_ticks > ${ROW.maxTicks}`);
    expect(err).toContain(`n > ${ROW.maxStrokes}`);
    expect(err).toContain(`< ${ROW.rateTicks} then return 'rate'`);
  });
});

describe("Sông Cái's geometry (lib/game/river/geometry.ts = 0086's _river_geo)", () => {
  it("the SQL's JSON is the TS", () => {
    const m = body("_river_geo").match(/select '([\s\S]*?)'::jsonb/);
    const g = JSON.parse(m![1]);
    expect(g).toEqual({
      x0: RIVER.x0, y0: RIVER.y0, x1: RIVER.x1, y1: RIVER.y1, rocks: RIVER.rocks, shoals: RIVER.shoals,
      arrive_x: RIVER.arrive.x, arrive_y: RIVER.arrive.y, pier_x: RIVER.pier.x, pier_y: RIVER.pier.y,
    });
    expect(RIVER.pier).toEqual(BOAT.pier);
    expect(SONG_CAI_ARRIVE).toMatchObject(RIVER.arrive);
    expect(POND_PIER_ARRIVE).toMatchObject(RIVER.pier);
    expect(body("_pos_maps")).toContain(`('song_cai', ${RIVER_W}, ${RIVER_H})`);
    expect(SQL).toContain(`values ('song_cai', ${MAP_MIN_LEVEL.song_cai})`);
    expect(MAP_MIN_LEVEL.song_cai).toBe(3);
  });

  it("every walkable cell floats (the server's lenient check passes wherever the client stands)", () => {
    const map = getMap("song_cai");
    expect(map.width).toBe(RIVER_W);
    let open = 0;
    for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) {
      if (map.blocked[r * map.cols + c]) continue;
      open++;
      for (const [dx, dy] of [[0, 0], [7, 0], [0, 7], [7, 7], [4, 4]]) {
        expect(riverWater(c * 8 + dx, r * 8 + dy, 8), `${c},${r}`).toBe(true);
      }
    }
    expect(open).toBeGreaterThan(2000);
    const at = (p: { x: number; y: number }) => map.blocked[Math.floor(p.y / 8) * map.cols + Math.floor(p.x / 8)];
    expect(at(SONG_CAI_ARRIVE)).toBe(0);
    expect(at(map.interactables.find((i) => i.kind === "river_dock")!.use)).toBe(0);
    expect(at(map.interactables.find((i) => i.kind === "city_map")!.use)).toBe(0);
    for (const [x, y] of RIVER.shoals) expect(at({ x, y }), `${x},${y}`).toBe(0);
    // no portal: only the boat links it (so walking there is no_path on the server)
    expect(map.interactables.some((i) => i.kind === "portal")).toBe(false);
  });

  it("the river cast prompt: anywhere on the water, named on a shoal", () => {
    expect(riverInteractable({ x: 20, y: 20 }, "up")).toBeNull();
    const open = riverInteractable({ x: 150, y: 200 }, "right")!;
    expect(open).toMatchObject({ kind: "fish_spot", use: { x: 150, y: 200 }, face: "right", label: "Sông Cái" });
    const shoal = riverInteractable({ x: RIVER.shoals[1][0], y: RIVER.shoals[1][1] }, "up")!;
    expect(shoal.prompt).toContain(RIVER.shoalNames[1]);
    expect(shoalAt(RIVER.shoals[2][0], RIVER.shoals[2][1])).toBe(2);
  });

  it("no vehicles on the river, and no heat (the server's _in_shade does not list it)", () => {
    expect(canRide("song_cai", "bike")).toBe(false);
    expect(inShade("song_cai", { x: 400, y: 200 })).toBe(true);
  });

  it("the river species are 0086's (deep water, rarity 3–5)", () => {
    const ids = [...SQL.matchAll(/\('(ca_\w+)',\s+'[^']+',\s+(\d)/g)].map((m) => [m[1], Number(m[2])] as const);
    expect(ids.map(([id]) => id)).toEqual([...RIVER_SPECIES]);
    for (const [, r] of ids) expect(r).toBeGreaterThanOrEqual(3);
  });
});

describe("the treasure detector and dig", () => {
  it("the bands are 0086's _treasure_band", () => {
    const b = body("_treasure_band");
    DETECTOR_BANDS.forEach((d, k) => expect(b).toContain(`when p_d <= ${d} then ${k}`));
    expect(treasureBand(0)).toBe(0);
    expect(treasureBand(16)).toBe(0);
    expect(treasureBand(17)).toBe(1);
    expect(treasureBand(500)).toBe(7);
    expect(body("treasure_dig_start")).toContain(`v_seed, ${SHOVEL.need}, ${SHOVEL.win}, v_loot`);
  });

  it("the beep quickens as the band shrinks; cold is silent", () => {
    expect(beepMs(7)).toBeNull();
    expect(beepMs(null)).toBeNull();
    expect(beepMs(1)!).toBeLessThan(beepMs(5)!);
    expect(signalBars(0)).toBe(7);
    expect(signalBars(7)).toBe(0);
  });

  it("the loot stays within 0076's bounds (400–2 500, the 8 000 jackpot)", () => {
    const b = body("treasure_dig_finish");
    expect(b).toContain("least(2500, round(d.loot * 1.1)::int)");
    expect(body("treasure_dig_start")).toContain("400 + floor(random() * 2101)::int");
  });

  it("the old one-shot RPCs refuse 'outdated'", () => {
    for (const f of ["dig_treasure", "start_boat_cast", "board_boat"]) expect(body(f)).toContain("raise exception 'outdated'");
  });
});

describe("the parsers", () => {
  it("row start / finish", () => {
    expect(parseRowStart({ row: { dir: "out", seed: 5, need: 8 } })).toEqual({ dir: "out", seed: 5, need: 8 });
    expect(parseRowStart({})).toBeNull();
    expect(parseRowFinish({ result: "arrived", hits: 9, need: 8, pass: true, to: { map: "song_cai", x: 80, y: 240, dir: "right" } }))
      .toEqual({ result: "arrived", hits: 9, need: 8, pass: true, to: { map: "song_cai", x: 80, y: 240, dir: "right" } });
    expect(parseRowFinish({ result: "drift", why: "missed", hits: 3, need: 8 })).toEqual({ result: "drift", why: "missed", hits: 3, need: 8 });
  });
  it("ping / dig", () => {
    expect(parsePing({ band: 3 })).toEqual({ band: 3 });
    expect(parsePing({ band: null, wait: true })).toEqual({ wait: true });
    expect(parsePing({ band: null, heat: "wrong_map" })).toEqual({ wrongMap: true });
    expect(parseDigStart({ result: "dig", dig: { seed: 9, need: 3, win: 120 } })).toEqual({ result: "dig", seed: 9, need: 3, win: 120 });
    expect(parseDigStart({ result: "miss", heat: "warm" })).toEqual({ result: "miss", heat: "warm" });
    expect(parseDigFinish({ result: "found", loot: 900, jackpot: false, clean: true })).toEqual({ result: "found", loot: 900, jackpot: false, clean: true });
    expect(parseDigFinish({ result: "lost", why: "gave_up" })).toEqual({ result: "lost", why: "gave_up" });
  });
});
