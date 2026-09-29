import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { supabase } from "@/lib/supabase";
import { REST_WALK } from "@/lib/game/housing/motel";
import { HALL_SPAWN } from "@/lib/game/maps/hall";
import { getMap } from "@/lib/game/maps/registry";
import { MAP_IDS } from "@/lib/game/maps/types";
import { WALK_SPEED } from "@/lib/game/movement";
import { POS, posReport, positionErrorText } from "@/lib/game/position";
import { RIDE_SPEED } from "@/lib/game/travel/ride";
import { isRoadTrip, VEHICLES, WALK_TRIP_MS } from "@/lib/game/travel/vehicles";
import { TICK_CAP_S } from "@/lib/game/vitals";
import { fishingErrorMessage } from "@/lib/game/fishing/rpc";
import { heatErrorMessage } from "@/lib/game/heat/model";

// 0057_server_position.sql against the TS it mirrors: the maps, the portals, the spawn, the depots, the speeds.
const SQL = readFileSync("supabase/migrations/0057_server_position.sql", "utf8").replace(/\r\n/g, "\n");
// A function a later migration re-created (0072's _pos_maps / _pos_portals: Mỏ đá) is read from its newest definition.
const NEWER = ["0072_mining_crafting.sql", "0086_explore_minigames.sql"].map((f) => readFileSync(`supabase/migrations/${f}`, "utf8").replace(/\r\n/g, "\n"));
const fnBody = (name: string) => {
  const head = `create or replace function public.${name}(`;
  const newer = NEWER.filter((s) => s.includes(head)).pop();
  if (newer) {
    const at = newer.indexOf(head);
    return newer.slice(at, newer.indexOf("$$;", at) + 3);
  }
  const from = SQL.indexOf(head);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return SQL.slice(from, SQL.indexOf("$$;", from) + 3);
};

describe("0057's geometry is the town's", () => {
  it("the maps' sizes", () => {
    const rows = [...fnBody("_pos_maps").matchAll(/\('(\w+)', (\d+), (\d+)\)/g)].map((m) => [m[1], Number(m[2]), Number(m[3])]);
    expect(rows).toEqual(MAP_IDS.map((id) => [id, getMap(id).width, getMap(id).height]));
  });

  it("every way across (the portals, the roads and the hầm's hatch): the use point and the arrive spot", () => {
    const sql = [...fnBody("_pos_portals").matchAll(/\('(\w+)', '(\w+)', (\d+), (\d+), (\d+), (\d+), (true|false)\)/g)]
      .map((m) => `${m[1]}>${m[2]} ${m[3]},${m[4]} ${m[5]},${m[6]} ${m[7]}`).sort();
    const ts = MAP_IDS.flatMap((id) => getMap(id).interactables
      .filter((i) => (i.kind === "portal" || i.kind === "ug_hatch") && i.to)
      .map((i) => `${id}>${i.to!.map} ${i.use.x},${i.use.y} ${i.to!.arrive.x},${i.to!.arrive.y} ${isRoadTrip(id, i.to!.map)}`)).sort();
    expect(sql).toEqual(ts);
    expect(sql).toHaveLength(16);                                                  // + Mỏ đá's two (0072)
  });

  it("the hall's spawn (game mode starts there, a faint sends me there) is always accepted", () => {
    expect(getMap("hall").spawn).toMatchObject(POS.hallSpawn);
    expect(HALL_SPAWN).toMatchObject(POS.hallSpawn);
    expect(SQL).toContain(`p_map = 'hall' and abs(p_x - ${POS.hallSpawn.x}) <= ${POS.spawnTol} and abs(p_y - ${POS.hallSpawn.y}) <= ${POS.spawnTol}`);
  });

  it("the market sales claim their depot's counter", () => {
    const market = getMap("market");
    expect(market.interactables.find((i) => i.kind === "market_fish_depot")?.use).toEqual(POS.fishDepot);
    expect(market.interactables.find((i) => i.kind === "market_farm_depot")?.use).toEqual(POS.farmDepot);
    expect(fnBody("sell_fish_market")).toContain(`'market', ${POS.fishDepot.x}, ${POS.fishDepot.y}, 'sell_fish_market'`);
    expect(fnBody("sell_rice_market")).toContain(`'market', ${POS.farmDepot.x}, ${POS.farmDepot.y}, 'sell_rice_market'`);
    expect(fnBody("sell_produce_market")).toContain(`'market', ${POS.farmDepot.x}, ${POS.farmDepot.y}, 'sell_produce_market'`);
  });

  it("VMAX covers the fastest a client moves (walk × car × pet × rest), and the SQL uses POS's slack", () => {
    expect(WALK_SPEED * Math.max(...Object.values(RIDE_SPEED)) * 1.2 * REST_WALK).toBeLessThanOrEqual(POS.vmax);
    const need = fnBody("_pos_need_s");
    expect(need).toContain(`- ${POS.slackPx} - ${POS.hopSlackPx} * hops) / ${POS.vmax}.0`);
    expect(fnBody("_pos_claim")).toContain(`v_need > v_dt + ${POS.slackS} then`);
    expect(fnBody("_pos_claim")).toContain(`if v_n = ${POS.repeat} then`);
    expect(fnBody("_pos_road_s")).toContain(`${POS.roadFactor} * least(${WALK_TRIP_MS},`);
    expect(WALK_TRIP_MS).toBe(15000);
    expect(Math.min(...VEHICLES.map((v) => v.tripMs))).toBe(2000);
  });

  it("the drain's cap: TS and the three _vitals_apply", () => {
    expect(TICK_CAP_S).toBe(POS.drainCapS);
    expect(SQL.split(`dt := least(${POS.drainCapS}, greatest(0, extract(epoch from now() - v.last_tick)));`).length - 1).toBe(3);
  });
});

describe("the client side of the position", () => {
  it("reports an arrival as integers and swallows a failure", async () => {
    const rpc = vi.mocked(supabase.rpc);
    rpc.mockResolvedValueOnce({ data: { ok: true }, error: null } as never);
    await posReport("tok", "market", 72.4, 252.6);
    expect(rpc).toHaveBeenCalledWith("pos_report", { p_session_token: "tok", p_map: "market", p_x: 72, p_y: 253 });
    rpc.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(posReport("tok", "hall", 1, 1)).resolves.toBeUndefined();
  });

  it("says why a claim was refused", () => {
    expect(positionErrorText("too far")).toMatch(/xa/);
    expect(positionErrorText("not at market")).toMatch(/Chợ Lớn/);
    expect(positionErrorText("storm")).toBeNull();
    expect(fishingErrorMessage({ message: "not at market" })).toBe(positionErrorText("not at market"));
    expect(fishingErrorMessage({ message: "too far" })).toBe(positionErrorText("too far"));
    expect(heatErrorMessage({ message: "too far" })).toMatch(/xa/i);
  });
});
