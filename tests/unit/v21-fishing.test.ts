import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { nearestLevel } from "@/lib/game/farm/machines";
import {
  BATTLE_DURATIONS, BATTLE_FEES, BOAT, battlePhase, battlePrize, clockText, DEEP_SPECIES, extrasErrorText, hintRect, MACHINES,
  MAP_SIZES, myBattle, nearDeck, parseBattleBoard, parseExtrasState,
} from "@/lib/game/fishing/extras";
import { fishingErrorMessage } from "@/lib/game/fishing/rpc";
import { getMap } from "@/lib/game/maps/registry";
import { BOAT_DECK_SPOT, inPond, onPlatform } from "@/lib/game/maps/pond";
import { isBlockedAt } from "@/lib/game/movement";
import type { MapId } from "@/lib/game/maps/types";

// 0076_fishing_extras.sql against the TS that mirrors it (and 0101_econ_fishing.sql, which re-prices the boat).
const SQL = readFileSync("supabase/migrations/0076_fishing_extras.sql", "utf8").replace(/\r\n/g, "\n");
const SQL101 = readFileSync("supabase/migrations/0101_econ_fishing.sql", "utf8").replace(/\r\n/g, "\n");
const GEO = /'\{"pier_x": (\d+), "pier_y": (\d+), "deck_x": (\d+), "deck_y": (\d+), "price": (\d+)\}'/;

describe("0076 is the client's", () => {
  it("the boat's geometry (0076) and price (econ v2: 0101's _boat_geo, 25 000)", () => {
    const m = SQL.match(GEO), m101 = SQL101.slice(SQL101.indexOf("function public._boat_geo(")).match(GEO);
    expect(m).not.toBeNull();
    expect(m101).not.toBeNull();
    expect(m!.slice(1, 5).map(Number)).toEqual([BOAT.pier.x, BOAT.pier.y, BOAT.deck.x, BOAT.deck.y]);
    expect(m101!.slice(1).map(Number)).toEqual([BOAT.pier.x, BOAT.pier.y, BOAT.deck.x, BOAT.deck.y, BOAT.price]);
    expect(BOAT.price).toBe(25000);
  });
  it("the deep species", () => {
    const ids = [...SQL.matchAll(/\('(\w+)',\s+'[^']+',\s+(\d), .*'deep'\)/g)].map((x) => x[1]);
    expect(ids).toEqual(DEEP_SPECIES);
    for (const x of SQL.matchAll(/\('\w+',\s+'[^']+',\s+(\d), .*'deep'\)/g)) expect(Number(x[1])).toBeGreaterThanOrEqual(3);
  });
  it("the machines' prices", () => {
    const body = SQL.slice(SQL.indexOf("function public._machine_price("));
    for (const m of MACHINES) expect(body).toContain(`when '${m.id}' then ${m.price}`);
  });
  it("the battle options", () => {
    expect(SQL).toContain("fee between 100 and 10000");
    expect(SQL).toContain("duration_s in (180, 300, 600)");
    expect(BATTLE_DURATIONS).toEqual([180, 300, 600]);
    for (const f of BATTLE_FEES) expect(f >= 100 && f <= 10000).toBe(true);
  });
});

describe("the places", () => {
  it("the boat's deck is in the deep water, the pier on Cầu ao", () => {
    expect(inPond(BOAT.deck.x, BOAT.deck.y, -20)).toBe(true);
    expect(onPlatform(BOAT.pier.x, BOAT.pier.y)).toBe(true);
    expect(isBlockedAt(getMap("pond"), BOAT.pier.x, BOAT.pier.y)).toBe(false);
    const ids = getMap("pond").interactables.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["boat_pier", "boat_deck", "fish_battle"]));
    expect(BOAT_DECK_SPOT.use).toEqual(BOAT.deck);
    expect(getMap("field").interactables.some((i) => i.kind === "machine_shed")).toBe(true);
    expect(isBlockedAt(getMap("field"), 432, 468)).toBe(false);
  });
  it("every treasure spot stands on walkable ground of its map", () => {
    const spots = [...SQL.matchAll(/\((\d+), '(\w+)', (\d+), (\d+), '[^']+'\)/g)].map((m) => ({ map: m[2] as MapId, x: Number(m[3]), y: Number(m[4]) }));
    expect(spots.length).toBe(10);
    for (const s of spots) expect(isBlockedAt(getMap(s.map), s.x, s.y), `${s.map} ${s.x},${s.y}`).toBe(false);
    for (const s of spots) expect(MAP_SIZES[s.map]).toEqual({ w: getMap(s.map).width, h: getMap(s.map).height });
  });
});

describe("the rules the panels show", () => {
  it("the prize: 10 % burned, ties split", () => {
    expect(battlePrize(1000)).toBe(900);
    expect(battlePrize(1000, 2)).toBe(450);
    expect(battlePrize(1500, 4)).toBe(337);
  });
  it("the hint's quarter", () => {
    expect(hintRect("pond", { col: 1, row: 2 })).toEqual({ x: 160, y: 800 / 3, w: 160, h: 400 / 3 });
    expect(hintRect("nowhere", { col: 0, row: 0 })).toBeNull();
  });
  it("clocks, the deck, the water level", () => {
    expect(clockText(65_000)).toBe("1:05");
    expect(clockText(-5)).toBe("0:00");
    expect(nearDeck({ x: BOAT.deck.x + 10, y: BOAT.deck.y - 10 })).toBe(true);
    expect(nearDeck({ x: 0, y: 0 })).toBe(false);
    expect(nearestLevel(0, [2, 3])).toBe(2);
    expect(nearestLevel(3, [1])).toBe(1);
    expect(nearestLevel(2, [1, 3])).toBe(1);
  });
  it("the errors read in Vietnamese, through the fishing messages too", () => {
    expect(extrasErrorText("not aboard")).toMatch(/ghe/);
    expect(fishingErrorMessage({ message: "need players" })).toMatch(/2 người/);
    expect(extrasErrorText("anything else")).toBeNull();
  });
});

describe("the parsers", () => {
  it("the extras state (no treasure coordinates anywhere)", () => {
    const s = parseExtrasState({
      server_now: "2026-09-29T00:00:00Z", coins: 5000, boat: { owned: true, aboard: false, price: 25000 },
      maps: [{ id: "m1", map: "pond", landmark: "Bụi tre", source: "boat", cell: { col: 1, row: 0 }, digs: 2 }], found: 1, found_today: 1,
      machines: ["processor", "nope"], job: { recipe: "gao_thom", batches: 2, started_at: "2026-09-29T00:00:00Z", ready_at: "2026-09-29T00:12:00Z" },
      goods: { banh_tet: 3, bot_bap: 0 }, recipes: [{ id: "gao_thom", name: "Gạo thơm", input_kind: "rice", input_id: "thom", input_kg: 10, value: 19600, minutes: 6 }],
    });
    expect(s).not.toBeNull();
    expect(s!.boat).toEqual({ owned: true, aboard: false, price: 25000 });
    expect(s!.maps).toEqual([{ id: "m1", map: "pond", landmark: "Bụi tre", source: "boat", cell: { col: 1, row: 0 }, digs: 2 }]);
    expect(s!.machines).toEqual(["processor"]);
    expect([s!.found, s!.foundToday]).toEqual([1, 1]);                          // econ v2 (0101): found_today
    expect(s!.goods).toEqual({ banh_tet: 3 });
    expect(s!.job!.readyAt - s!.job!.startedAt).toBe(12 * 60_000);
    expect(parseExtrasState({})).toBeNull();
  });
  it("the battles' board, my battle and its phase", () => {
    const b = parseBattleBoard({
      server_now: "2026-09-29T00:00:00Z", me: "a",
      battles: [
        { id: "x", host: "b", fee: 500, duration_s: 300, status: "done", pot: 1000, burned: 100, winners: ["b"], prize: 900, players: [] },
        {
          id: "y", host: "a", fee: 300, duration_s: 180, status: "live", starts_at: "2026-09-29T00:00:05Z", ends_at: "2026-09-29T00:03:05Z",
          pot: 600, burned: 0, winners: [], prize: 0,
          players: [{ account_id: "a", username: "An", score: 700, catches: 2, best: "ca_tra" }, { account_id: "c", username: "Cư", score: 0, catches: 0, best: null }],
        },
      ],
    })!;
    const mine = myBattle(b)!;
    expect(mine.id).toBe("y");
    expect(mine.players[0]).toEqual({ accountId: "a", username: "An", score: 700, catches: 2, best: "ca_tra" });
    const t0 = Date.parse("2026-09-29T00:00:00Z");
    expect(battlePhase(mine, t0)).toBe("countdown");
    expect(battlePhase(mine, t0 + 60_000)).toBe("fishing");
    expect(battlePhase(mine, t0 + 200_000)).toBe("over");
    expect(parseBattleBoard({})).toBeNull();
  });
});
