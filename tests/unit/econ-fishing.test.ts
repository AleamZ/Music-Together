import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOAT, extrasErrorText, TREASURE_PER_DAY } from "@/lib/game/fishing/extras";

// 0101_econ_fishing.sql (Kinh tế v2, fishing): every re-created function is its newest body plus the lines marked
// "-- econ v2" (an added line), "… -- econ v2 was: <old line>" (a changed one) — the convention of
// anticheat-v2-part3.test.ts — and the TS that mirrors it.

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SQL = read("supabase/migrations/0101_econ_fishing.sql");
/** The migrations before 0101 in the production order (0014 before 0013), newest last. */
const EARLIER = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql") && f.slice(0, 4) < "0101")
  .sort((a, b) => {
    const k = (f: string) => (f.slice(0, 4) === "0013" ? 14.5 : Number(f.slice(0, 4)));
    return k(a) - k(b) || a.localeCompare(b);
  });
const body = (s: string, sig: string) => {
  const from = s.indexOf(`create or replace function public.${sig}`);
  expect(from, sig).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
/** The newest body of `sig` before 0101, and where it is from. */
const newest = (sig: string): [string, string] => {
  const f = [...EARLIER].reverse().find((x) => read(`supabase/migrations/${x}`).includes(`create or replace function public.${sig}`));
  expect(f, sig).toBeDefined();
  return [f!, body(read(`supabase/migrations/${f}`), sig)];
};
const unmarked = (b: string, tag: string) => {
  const out: string[] = [];
  let skip = false;
  for (const l of b.split("\n")) {
    if (l.includes(`-- ${tag} {`)) { skip = true; continue; }
    if (l.includes(`-- ${tag} }`)) { skip = false; continue; }
    if (skip) continue;
    const was = l.indexOf(`-- ${tag} was: `);
    if (was >= 0) out.push(`${l.match(/^\s*/)![0]}${l.slice(was + `-- ${tag} was: `.length)}`);
    else if (!l.includes(`-- ${tag}`)) out.push(l);
  }
  return out.join("\n");
};

describe("0101: every re-created function is its newest body plus the econ v2 lines", () => {
  const cases: Array<[string, string]> = [
    ["start_cast(", "0059_reel_hook.sql"],
    ["start_river_cast(", "0086_explore_minigames.sql"],
    ["start_river_cast_w(", "0095_river_world.sql"],
    ["net_haul(p_session_token text, p_throw_id uuid, p_press integer", "0065_ac_stats.sql"],
    ["finish_net(p_session_token text, p_throw_id uuid, p_keys integer[]", "0078_v21_fixes.sql"],
    ["_overboard_outcome(", "0031_pond_life.sql"],
    ["finish_cast(", "0078_v21_fixes.sql"],
    ["_fx_on_fish(", "0078_v21_fixes.sql"],
    ["_fx_on_dig(", "0076_fishing_extras.sql"],
    ["_treasure_drop(", "0076_fishing_extras.sql"],
    ["treasure_dig_start(", "0087_v22_fixes.sql"],
    ["treasure_dig_finish(", "0087_v22_fixes.sql"],
    ["sell_fish(", "0015_anticheat.sql"],
    ["sell_fish_market(", "0057_server_position.sql"],
    ["fishing_board(", "0015_anticheat.sql"],
  ];
  for (const [sig, from] of cases) {
    it(sig.slice(0, sig.indexOf("(")), () => {
      const [f, prev] = newest(sig);
      expect(f).toBe(from);
      expect(unmarked(body(SQL, sig), "econ v2")).toBe(prev);
      expect(body(SQL, sig)).toContain("-- econ v2");
    });
  }
  it("the cast triggers no longer lift: casts_luck is a no-op, casts_prof spends the stamina only", () => {
    expect(body(SQL, "_cast_luck(")).not.toContain("fish_species");
    expect(body(SQL, "_cast_luck(")).toContain("return new;");
    const prof = body(SQL, "_prof_on_cast(");
    expect(prof).not.toContain("fish_species");
    expect(prof).toContain("perform public._stamina_spend(new.account_id, 3, 'fish');");
  });
  it("one lift, at most 20 %, before the reel: _cast_lift, private, called by the three start functions", () => {
    const lift = body(SQL, "_cast_lift(");
    expect(lift).toContain("least(0.20, 0.20 * public._buff_power(p_account, 'luck')");
    expect(lift).toContain("0.03 * public._upgrade_level(");
    expect(lift).toContain("public._perk(p_account, 'rare_fish_pct') + public._buff(p_account, 'rare_fish')");
    expect(SQL).toContain("revoke all on function public._cast_lift(uuid, text, text, integer, boolean) from public, anon, authenticated;");
    for (const sig of ["start_cast(", "start_river_cast(", "start_river_cast_w("]) {
      const b = body(SQL, sig);
      const at = b.indexOf("public._cast_lift(");
      expect(at, sig).toBeGreaterThan(0);
      expect(b.indexOf("v_min_reel := 2000 + 40 * sp.difficulty;"), sig).toBeGreaterThan(at);   // the reel from the cast fish
    }
    expect(body(SQL, "start_cast(")).toContain("where rarity = v_rarity and water = 'pond'");
  });
  it("the boat: 0076's geometry, 25 000 xu (lib/game/fishing/extras.ts BOAT)", () => {
    const [, prev] = newest("_boat_geo(");
    expect(body(SQL, "_boat_geo(")).toBe(prev.replace('"price": 4000}', `"price": ${BOAT.price}}`));
    expect(BOAT.price).toBe(25000);
  });
});

describe("0101's numbers", () => {
  const rows = [...SQL.matchAll(/^ {4}\('(\w+)',\s+(\d+),\s+(\d+),\s+(\d+)\)/gm)].map((m) => ({
    id: m[1], ppk: Number(m[2]), min: Number(m[3]), max: Number(m[4]),
  }));
  it("F1: all 23 species priced; the two heaviest deep species cut; nothing under 2 xu", () => {
    expect(rows).toHaveLength(23);
    expect(new Set(rows.map((r) => r.id)).size).toBe(23);
    expect(rows.find((r) => r.id === "ca_tra_dau")).toMatchObject({ min: 12000, max: 45000 });
    expect(rows.find((r) => r.id === "ca_vo_dem")).toMatchObject({ min: 10000, max: 35000 });
    // the lightest at the lowest season factor (×0.80), fish_mult 1.00, rounded like finish_cast
    for (const r of rows) expect(Math.round((r.ppk * r.min) / 1000 * 0.8), r.id).toBeGreaterThanOrEqual(2);
  });
  it("F2: the river's bump 0.05 (a shoal 0.10)", () => {
    for (const sig of ["start_river_cast(", "start_river_cast_w("]) {
      expect(body(SQL, sig)).toContain("(case when v_shoal then 0.10 else 0.05 end) then v_rarity := 3;");
    }
  });
  it("F3: the wild river needs Sông Cái unlocked", () => {
    expect(body(SQL, "start_river_cast_w(")).toContain("if not public._map_unlocked(v_account, 'song_cai') then raise exception 'map locked'");
    expect(extrasErrorText("map locked")).toMatch(/cấp 3/);
  });
  it("F4: the drops, the chest and the day's finds (TREASURE_PER_DAY)", () => {
    expect(body(SQL, "_fx_on_fish(")).toContain("case when v_boat then 0.02 else 0.01 end);");
    expect(body(SQL, "_fx_on_dig(")).toContain("_treasure_drop(new.account_id, 'dig', 0.005);");
    expect(body(SQL, "treasure_dig_start(")).toContain("case when random() < 0.02 then 3000 else 150 + floor(random() * 651)::int end");
    expect(body(SQL, "treasure_dig_finish(")).toContain("when v_clean then least(800, round(d.loot * 1.1)::int) else least(800, d.loot) end;");
    for (const sig of ["_treasure_drop(", "treasure_dig_start("]) {
      expect(body(SQL, sig)).toContain(`found_at >= public._vn_day_start()) >= ${TREASURE_PER_DAY} then`);
    }
    expect(body(SQL, "treasure_dig_start(")).toContain("raise exception 'treasure day cap' using errcode = '53400';");
    expect(extrasErrorText("treasure day cap")).toContain(`${TREASURE_PER_DAY} kho báu`);
  });
  it("F6: the effort of a cast, a net haul and an overboard", () => {
    for (const sig of ["start_cast(", "start_river_cast(", "start_river_cast_w("]) {
      expect(body(SQL, sig)).toContain("public._fishing_effort(v_account, 0.35, 0.45);");
    }
    expect(body(SQL, "net_haul(p_session_token text, p_throw_id uuid, p_press integer")).toContain("public._fishing_effort(v_account, 0.6, 0.7);");
    expect(body(SQL, "_overboard_outcome(")).toContain("'hunger', 5,");
  });
  it("F7: the sales go through the thương lái and answer npc_cut / npc; the board shows the day", () => {
    expect(body(SQL, "sell_fish(")).toContain("v_pay := public._npc_sale(v_account, v_sum);");
    expect(body(SQL, "sell_fish_market(")).toContain("v_pay := public._npc_sale(v_account, v_gross);");
    for (const sig of ["sell_fish(", "sell_fish_market("]) expect(body(SQL, sig)).toContain("'npc', public._npc_quota(v_account)");
    expect(body(SQL, "fishing_board(")).toContain("'npc', public._npc_quota(v_account));");
  });
});
