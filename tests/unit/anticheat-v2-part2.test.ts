import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KATA_REVEAL, KATA_ROBOTIC_NOTES } from "@/lib/game/fight/kata";
import { CRAB, HARVEST } from "@/lib/game/farm/minigames";
import { SLING } from "@/lib/game/farm/sling";
import { REEL_TIMING, reelTiming, reelTimingSuspect } from "@/lib/game/fishing/reel";
import { CANAL, CRAB_HOLES, FIELD_INTERACTABLES, FIELD_PLOTS } from "@/lib/game/maps/field";

// Anti-cheat v2, part 2 (docs/superpowers/plans/2026-09-28-anticheat-v2-part2.md): the TS halves of 0058–0063 and their
// constants against the SQL. The SQL smokes (tests/sql/anticheat-v2-*-smoke.sql) check the same cases on the server.

const M = (n: string) => readFileSync(`supabase/migrations/${n}.sql`, "utf8").replace(/\r\n/g, "\n");

describe("0059: the reel's toggle timing", () => {
  it("the smoke's cases", () => {
    const metronome = Array.from({ length: 12 }, (_, g) => g * 10);
    expect(reelTiming(metronome)).toEqual({ n: 12, fast: 0, variance: 0 });
    expect(reelTimingSuspect(reelTiming(metronome))).toBe(true);
    const flicks = [0, 1, 30, 31, 60, 62, 90, 91, 120, 121];
    expect(reelTiming(flicks)).toMatchObject({ n: 10, fast: 5 });
    expect(reelTimingSuspect(reelTiming(flicks))).toBe(true);
    const hand = [0, 9, 21, 28, 43, 50, 66, 71, 90, 97, 113, 121];
    expect(reelTiming(hand)).toEqual({ n: 12, fast: 0, variance: 20.7273 });
    expect(reelTimingSuspect(reelTiming(hand))).toBe(false);
    expect(reelTiming([])).toEqual({ n: 0, fast: 0, variance: 0 });
    expect(reelTimingSuspect(reelTiming([5]))).toBe(false);
  });
  it("the thresholds are 0059's", () => {
    const m = M("0059_reel_hook");
    expect(m).toContain(`(p_t->>'n')::int >= ${REEL_TIMING.fastMin} and ${REEL_TIMING.fastShare} * (p_t->>'fast')::int >= (p_t->>'n')::int`);
    expect(m).toContain(`(p_t->>'n')::int >= ${REEL_TIMING.metronomeMin} and (p_t->>'var')::numeric < ${REEL_TIMING.metronomeVar}`);
    expect(m).toContain("count(*) filter (where g <= 2)");
  });
});

describe("0060: the kata's reveal and noise, the bots' secret", () => {
  const m = M("0060_fight_secrets");
  it("the constants are kata.ts's", () => {
    expect(m).toContain(`floor(extract(epoch from now() - ex.started_at) * 60)::integer + ${KATA_REVEAL};`);
    expect(m).toContain(`to_jsonb(public._kata_reveal(v_chart, ${KATA_REVEAL}))`);
    expect(m).toContain(`select n >= ${KATA_ROBOTIC_NOTES} and 16 * (n * sq - sm * sm) < 9 * n * n`);
  });
  it("the secret never reaches a client", () => {
    expect(m).toContain("revoke all on public.ac_secrets from anon, authenticated;");
    expect(m).toContain("revoke all on function public._fx_bot_seed(uuid, integer) from public, anon, authenticated;");
    expect(m).toContain("s[5 + 1] := 0;");
  });
});

describe("0061–0063: the field's spots and the minigames' constants", () => {
  const m61 = M("0061_harvest_replay"), m62 = M("0062_crab_replay"), m63 = M("0063_sling_replay");
  const use = (id: string) => FIELD_INTERACTABLES.find((i) => i.id === id)!.use;
  it("the plots' rects and use spots are field.ts's", () => {
    const north = FIELD_PLOTS.filter((g) => g.no <= 4), south = FIELD_PLOTS.filter((g) => g.no >= 5);
    const [n1, s5, s8] = [north[0].rect, south[0].rect, south[3].rect];
    const xs = north.map((g) => g.rect.x).join(", "), vxs = south.slice(0, 3).map((g) => g.rect.x).join(", ");
    expect(m61).toContain(`array[(array[${xs}])[p_plot] + ${n1.w / 2}, ${n1.y} + ${n1.h} + 16]`);
    expect(m61).toContain(`array[(array[${vxs}])[(p_plot - 5) % 3 + 1] + ${s5.w / 2},`);
    expect(m61).toContain(`(array[${s5.y}, ${s8.y}])[(p_plot - 5) / 3 + 1] - 10] end`);
    expect(m61).toContain(`array[(array[${xs}])[p_plot], ${n1.y}, ${n1.w}, ${n1.h}]`);
    expect(m61).toContain(`(array[${s5.y}, ${s8.y}])[(p_plot - 5) / 3 + 1], ${s5.w}, ${s5.h}] end`);
    expect(FIELD_PLOTS.every((g) => (g.no <= 4 ? north : south).includes(g))).toBe(true);
    // the smoke's values
    expect([use("plot_1"), use("plot_5"), use("plot_10")]).toEqual([{ x: 136, y: 164 }, { x: 136, y: 218 }, { x: 440, y: 318 }]);
  });
  it("the crab holes' use spots are field.ts's", () => {
    const holes = CRAB_HOLES.map((_, i) => use(`crab_${i + 1}`));
    expect(m61).toContain(`array[${holes.map((h) => h.x).join(", ")}])[p_hole]`);
    expect(m61).toContain(`case when p_hole % 2 = 1 then ${CANAL.y} - 12 else ${CANAL.y} + ${CANAL.h} + 12 end`);
    expect(holes.map((h, i) => h.y === (i % 2 === 0 ? CANAL.y - 12 : CANAL.y + CANAL.h + 12))).toEqual(Array(6).fill(true));
  });
  it("the harvest's constants are minigames.ts's", () => {
    expect(m61).toContain(`o := o || (${HARVEST.centreMin} + r[1] % ${HARVEST.centreSpan})::integer;`);
    expect(m61).toContain(`if charge >= ${HARVEST.fillTicks} then`);
    expect(m61).toContain(`lv := (charge * 1000) / ${HARVEST.fillTicks};`);
    expect(m61).toContain(`case when d <= ${HARVEST.exact} then 2 when d <= ${HARVEST.near} then 1 else 0 end`);
    expect(m61).toContain(`beat := ${HARVEST.beatTicks};`);
    expect(m61).toContain(`bundle >= ${HARVEST.bundles} then outcome := case when score2 >= ${HARVEST.pass2}`);
    expect(m61).toContain(`tick >= ${HARVEST.maxTicks} then outcome := 'fail'`);
    expect(m61).toContain(`public._toggles_error(p_toggles, p_ticks, ${HARVEST.maxTicks}, ${HARVEST.maxToggles}, ${HARVEST.rate})`);
  });
  it("the crab's constants are minigames.ts's", () => {
    expect(m62).toContain(`array[${CRAB.periods.join(", ")}]`);
    expect(m62).toContain(`if t >= ${CRAB.leadTicks} then stage := 1; t := t - ${CRAB.leadTicks}; end if;`);
    expect(m62).toContain(`10 * ((ph[tries + 1] + t) % p) >= ${CRAB.openTenths} * p`);
    expect(m62).toContain(`when t >= ${CRAB.cycles} * p then 'slip'`);
    expect(m62).toContain(`elsif t >= ${CRAB.beatTicks} then`);
    expect(m62).toContain(`if tries >= ${CRAB.tries} then done := true;`);
    expect(m62).toContain(`public._toggles_error(p_grabs, p_ticks, ${CRAB.maxTicks}, ${CRAB.maxGrabs}, ${CRAB.rate})`);
  });
  it("the sling's constants are sling.ts's", () => {
    expect(m63).toContain(`${SLING.stopMin} + a[1] % ${SLING.stopSpan}`);
    expect(m63).toContain(`c[1] % 100 < ${SLING.turnPct}`);
    expect(m63).toContain(`${SLING.speedMin} + b[1] % ${SLING.speedSpan}, ${SLING.runMin} + a[1] % ${SLING.runSpan}`);
    expect(m63).toContain(`array[${SLING.startXM}, 1, 0, 0, 0, p_seed & 4294967295]`);
    expect(m63).toContain(`if r[1] <= ${SLING.laneMinM} or r[1] >= ${SLING.laneMaxM} then`);
    expect(m63).toContain(`least(1000, (p_held * 1000) / ${SLING.fillTicks})`);
    expect(m63).toContain(`< ${SLING.bandLowM} then 'short'`);
    expect(m63).toContain(`> ${SLING.bandHighM} then 'over'`);
    expect(m63).toContain(`abs(p_rat[1] - p_aim) <= ${SLING.hitM} then 'hit'`);
    expect(m63).toContain(`p_release > p_press + ${SLING.fillTicks} then 'draw'`);
    expect(m63).toContain(`p_aim < ${SLING.laneMinM} or p_aim > ${SLING.laneMaxM} then 'aim'`);
    expect(m63).toContain(`p_release + ${SLING.flightTicks} - a.last_tick`);
  });
});