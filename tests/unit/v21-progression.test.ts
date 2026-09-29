import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { getMap } from "@/lib/game/maps/registry";
import { HALL_SPAWN } from "@/lib/game/maps/hall";
import { MAP_IDS } from "@/lib/game/maps/types";
import {
  levelFor, levelProgress, levelReward, MAP_MIN_LEVEL, mapUnlocked, progressionErrorText, TELEPORT_FEE, WAYPOINT_RADIUS,
  WAYPOINTS, XP_CAPS, xpAt,
} from "@/lib/game/progression/model";
import { parseBoard, parseProgress, parseTeleport, titleText } from "@/lib/game/progression/rpc";
import { nameTag } from "@/lib/game/social";
import { lookFromRow } from "@/lib/game/character";

const SQL = readFileSync("supabase/migrations/0070_progression.sql", "utf8").replace(/\r\n/g, "\n");
const fnBody = (name: string) => {
  const from = SQL.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return SQL.slice(from, SQL.indexOf("$$;", from) + 3);
};

describe("0070's numbers are the client's", () => {
  it("the level curve and rewards", () => {
    expect(fnBody("_pg_xp_at")).toContain("100 * (p_level - 1) + 25 * (p_level - 1) * (p_level - 2)");
    expect(fnBody("_pg_level_reward")).toContain("when p_level % 5 = 0 then 150 * p_level else 50 * p_level");
    expect([xpAt(1), xpAt(2), xpAt(3), xpAt(10)]).toEqual([0, 100, 250, 2700]);
    expect([levelFor(0), levelFor(99), levelFor(100), levelFor(2699), levelFor(2700), levelFor(1e9)]).toEqual([1, 1, 2, 9, 10, 99]);
    expect([levelReward(2), levelReward(5)]).toEqual([100, 750]);
    expect(levelProgress(175)).toEqual({ level: 2, into: 75, span: 150, frac: 0.5 });
  });

  it("the daily caps", () => {
    const m = fnBody("_pg_cap").match(/'fish' then (\d+) when 'earn' then (\d+) when 'fight' then (\d+) when 'grant' then (\d+)/)!;
    expect(m.slice(1).map(Number)).toEqual([XP_CAPS.fish, XP_CAPS.earn, XP_CAPS.fight, XP_CAPS.grant]);
  });

  it("the map levels: every map is seeded, existing ones open at 1", () => {
    const from = SQL.indexOf("insert into public.map_levels (map, min_level) values\n");
    const seed = SQL.slice(from, SQL.indexOf("on conflict (map)", from));
    const rows = Object.fromEntries([...seed.matchAll(/\('(\w+)', (\d+)\)/g)].map((m) => [m[1], Number(m[2])]));
    // a map added later seeds its own level (0072: Mỏ đá)
    const mine = readFileSync("supabase/migrations/0072_mining_crafting.sql", "utf8")
      .match(/insert into public\.map_levels \(map, min_level\) values \('(\w+)', (\d+)\)/);
    if (mine) rows[mine[1]] = Number(mine[2]);
    const river = readFileSync("supabase/migrations/0086_explore_minigames.sql", "utf8")                     // v22: Sông Cái
      .match(/insert into public\.map_levels \(map, min_level\) values \('(\w+)', (\d+)\)/);
    if (river) rows[river[1]] = Number(river[2]);
    expect(rows).toEqual(MAP_MIN_LEVEL);
    for (const id of ["hall", "pond", "field", "market", "khu_nha", "bai_dat", "ham_ngam"]) expect(MAP_MIN_LEVEL[id], id).toBe(1);
    expect(mapUnlocked("hall", 1)).toBe(true);
    expect(mapUnlocked("mo_da", 1, { mo_da: 10 })).toBe(false);
    expect(mapUnlocked("nowhere", 1)).toBe(true);
  });

  it("the waypoints sit on real arrival spots of real maps", () => {
    const seed = SQL.slice(SQL.indexOf("insert into public.waypoints"), SQL.indexOf("on conflict (id) do update set name = excluded.name, map"));
    const rows = [...seed.matchAll(/\('(\w+)',\s+'([^']+)',\s+'(\w+)',\s+(\d+),\s+(\d+),\s+'(\w+)',\s+(\d+),/g)]
      .map((m) => ({ id: m[1], name: m[2], map: m[3], x: Number(m[4]), y: Number(m[5]), dir: m[6], minLevel: Number(m[7]) }));
    expect(rows).toEqual(WAYPOINTS);
    for (const w of WAYPOINTS) {
      const arrivals = MAP_IDS.flatMap((id) => getMap(id).interactables.filter((i) => i.to?.map === w.map).map((i) => i.to!.arrive));
      const spots = w.map === "hall" ? [...arrivals, HALL_SPAWN] : arrivals;
      expect(spots.some((s) => s.x === w.x && s.y === w.y), w.id).toBe(true);
    }
    expect(SQL).toContain(`${WAYPOINT_RADIUS} ^ 2`);
    expect(SQL).toContain(`c_fee constant integer := ${TELEPORT_FEE}`);
  });

  it("every refusal has a text", () => {
    for (const m of SQL.matchAll(/raise exception '([^']+)'/g)) expect(progressionErrorText(m[1]), m[1]).not.toBeNull();
  });
});

describe("parsing", () => {
  it("progress_state", () => {
    const s = parseProgress({
      level: 3, xp: 300, title: "fish_100", today: { fish: 10 }, stats: { fish_total: 100, species: 4 },
      achievements: [{ id: "fish_100", name: "Tay câu khá", descr: "", stat: "fish_total", goal: 100, reward: 500, title: "Thợ câu", at: "2026-01-01" }],
      fishdex: [{ species: "ca_ro", name: "Cá rô", rarity: 1, caught: 2, best_g: 200 }],
      collections: [], other: { pets: { have: 1, total: 6 } }, waypoints: [{ id: "wp_hall", name: "Sảnh", map: "hall", min_level: 1, found: true }],
      at_waypoint: "wp_hall", teleport_fee: 20, map_levels: { hall: 1 },
    });
    expect(s.level).toBe(3);
    expect(titleText(s)).toBe("Thợ câu");
    expect(s.fishdex[0].bestG).toBe(200);
    expect(s.other.pets).toEqual({ have: 1, total: 6 });
    expect(s.other.crops).toEqual({ have: 0, total: 0 });
    expect(s.atWaypoint).toBe("wp_hall");
    expect(parseProgress(null).level).toBe(1);
  });

  it("a board and a teleport", () => {
    expect(parseBoard({ rows: [{ id: "a", name: "Lan", value: "12", level: 4 }], me: "a" }).rows[0]).toEqual({ id: "a", name: "Lan", value: 12, level: 4, extra: null });
    expect(parseTeleport({ ok: true, coins: 5, to: { id: "wp_pond", map: "pond", x: 300, y: 356, dir: "up" } })?.to.map).toBe("pond");
    expect(parseTeleport({ ok: true, to: { map: "moon" } })).toBeNull();
  });
});

describe("the name tag", () => {
  it("level first, the worn title over the season one", () => {
    expect(nameTag("Tèo", { pgLevel: 12, pgTitle: "Lão ngư", ugTitle: "Cá Lóc mùa 1" })).toBe("Lv12 Tèo «Lão ngư»");
    expect(nameTag("Tèo", { pgLevel: 3 })).toBe("Lv3 Tèo");
    expect(nameTag("Tèo", { ugTitle: "Cá Lóc mùa 1" })).toBe("Tèo «Cá Lóc mùa 1»");
  });

  it("reads the server's columns", () => {
    const base = { account_id: "a", skin: "s1", hair: "short", hair_color: "black", hat: null, top: null, bottom: null, shoes: "x", neck: null };
    expect(lookFromRow({ ...base, pg_level: 7, pg_title: "Võ sĩ" })).toMatchObject({ pgLevel: 7, pgTitle: "Võ sĩ" });
    expect(lookFromRow({ ...base, pg_level: 500 }).pgLevel).toBeUndefined();
  });
});
