import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NETX } from "@/lib/game/fishing/net";

// 0056/0057 re-create functions from their newest bodies: every added line is marked "-- 0056"/"-- 0057", an added
// block sits between "-- 0057 {" and "-- 0057 }", a changed or removed line reads "… -- 0056 was: <old line>".

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const M = (n: string) => read(`supabase/migrations/${n}.sql`);
const M27 = M("0027_vehicles"), M28 = M("0028_market_depots"), M33 = M("0033_heat_swim"), M45 = M("0045_faint_ladder");
const M47 = M("0047_fishing_hunger"), M56 = M("0056_net_replay"), M57 = M("0057_server_position");
const BETWEEN = ["0048_fight_engine", "0049_fight_matches", "0050_dojo", "0051_bai_dat", "0052_underground", "0055_blacklist"];

/** A function's text from `create or replace function public.<sig>` to its `$$;`. */
const body = (s: string, sig: string) => {
  const from = s.indexOf(`create or replace function public.${sig}`);
  expect(from, sig).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
/** The body without `tag`'s lines and blocks, changed lines put back. */
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

describe("0056: start_net is 0047's plus the marked lines", () => {
  it("0048–0055 do not re-create it", () => {
    for (const f of BETWEEN) expect(M(f).includes("function public.start_net("), f).toBe(false);
  });
  it("verbatim but for the 0056 lines", () => {
    expect(unmarked(body(M56, "start_net("), "0056")).toBe(body(M47, "start_net("));
    expect(body(M56, "start_net(")).toContain("-- 0056");
  });
});

describe("0057: every re-created function is its newest body plus the marked lines", () => {
  const cases: Array<[string, string, string[]]> = [
    ["start_net(", M56, ["0056"]],
    ["start_cast(", M47, ["0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["skip_trip(", M27, ["0028", "0033", "0045", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["sell_fish_market(", M28, ["0033", "0045", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["sell_rice_market(", M28, ["0033", "0045", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["sell_produce_market(", M28, ["0033", "0045", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["jump_in(", M33, ["0045", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["rescue_swimmer(", M33, ["0045", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["vitals_tick(", M45, ["0046", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["_vitals_apply(p_account uuid) returns", M45, ["0046", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["_vitals_apply(p_account uuid, p_thirst numeric) returns", M45, ["0046", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
    ["_vitals_apply(p_account uuid, p_thirst numeric, p_hunger numeric) returns", M45, ["0046", "0047", "0048", "0049", "0050", "0051", "0052", "0055", "0056"]],
  ];
  const file = (n: string) => {
    const f = ["0028_market_depots", "0033_heat_swim", "0045_faint_ladder", "0046_reel_verify", "0047_fishing_hunger",
      "0048_fight_engine", "0049_fight_matches", "0050_dojo", "0051_bai_dat", "0052_underground", "0055_blacklist",
      "0056_net_replay"].find((x) => x.startsWith(n));
    return M(f!);
  };
  for (const [sig, src, later] of cases) {
    it(sig, () => {
      const name = sig.slice(0, sig.indexOf("("));
      for (const n of later) {
        if (src === M56 && n === "0056") continue;
        expect(file(n).includes(`function public.${name}(`) && file(n) !== src, `${name} in ${n}`).toBe(false);
      }
      expect(unmarked(body(M57, sig), "0057")).toBe(body(src, sig));
      expect(body(M57, sig)).toContain("-- 0057");
    });
  }
});

describe("0058: _pos_claim is 0057's plus the marked lines", () => {
  const M58 = M("0058_pos_tabs");
  it("verbatim but for the 0058 lines", () => {
    expect(unmarked(body(M58, "_pos_claim("), "0058")).toBe(body(M57, "_pos_claim("));
    expect(body(M58, "_pos_claim(")).toContain("-- 0058");
  });
  it("reads the tab from the header lib/supabase.ts sends", () => {
    expect(read("lib/supabase.ts")).toContain('"X-Tab-Id": TAB_ID');
    expect(M58).toContain("->>'x-tab-id'");
  });
});

describe("0059: start_cast, start_net and finish_cast are their newest bodies plus the marked lines", () => {
  const M59 = M("0059_reel_hook");
  const M46 = M("0046_reel_verify");
  for (const [sig, src] of [["start_cast(", M57], ["start_net(", M57], ["finish_cast(", M46]] as const) {
    it(sig, () => {
      expect(unmarked(body(M59, sig), "0059")).toBe(body(src, sig));
      expect(body(M59, sig)).toContain("-- 0059");
    });
  }
  it("0047–0058 do not re-create finish_cast", () => {
    for (const f of ["0047_fishing_hunger", ...BETWEEN, "0056_net_replay", "0057_server_position", "0058_pos_tabs"]) {
      expect(M(f).includes("function public.finish_cast("), f).toBe(false);
    }
  });
  it("the seed is no longer answered by start_cast, only by hook_cast", () => {
    expect(unmarked(body(M59, "start_cast("), "0059")).toContain("'reel_seed', v_seed");
    expect(body(M59, "start_cast(").split("\n").filter((l) => l.includes("'reel_seed'") && !l.includes("-- 0059 was:"))).toEqual([]);
    expect(body(M59, "hook_cast(")).toContain("'reel_seed', c.reel_seed");
  });
});

describe("0056 mirrors lib/game/fishing/net.ts's constants", () => {
  it("the throw: the flight, the sink, the release limit, the aim and the ellipse", () => {
    expect(M56).toContain(`lt bigint := p_release + ${NETX.flightTicks}`);
    expect(M56).toContain(`0.9 * (p_release + ${NETX.flightTicks} + ${NETX.sinkTicks}) / 60.0`);
    expect(M56).toContain(`p_release < p_press or p_release > ${NETX.maxRelease} then 'range'`);
    expect(M56).toContain(`p_x < ${NETX.aimMinX} or p_x > ${NETX.aimMaxX} or p_y < ${NETX.aimMinY} or p_y > ${NETX.aimMaxY}`);
    expect(M56).toContain(`(p_x - ${NETX.handsX})::bigint * (p_x - ${NETX.handsX}) + (p_y - ${NETX.handsY})::bigint * (p_y - ${NETX.handsY}) > ${NETX.range}::bigint * ${NETX.range}`);
    expect(M56).toContain(`k := case when q >= ${NETX.sweet} then 1000 else 450 + (550 * q) / ${NETX.sweet} end;`);
    expect(M56).toContain(`ly := least(${NETX.landMaxY}, ${NETX.handsY} + ((p_y - ${NETX.handsY}) * k) / 1000);`);
    expect(M56).toContain("v_in := 9 * dx * dx + 25 * dy * dy <= 9 * r * r;");
  });
  it("kéo lưới: the keys' limits", () => {
    expect(M56).toContain(`if p_ticks is null or p_ticks < 0 or p_ticks > ${NETX.maxArrowTicks} then return 'ticks'; end if;`);
    expect(M56).toContain(`if n > ${NETX.maxKeys} then return 'too_many'; end if;`);
    expect(M56).toContain(`if i > ${NETX.keyRate} and p_keys[i] / 4 - p_keys[i - ${NETX.keyRate}] / 4 < 60 then return 'rate'; end if;`);
  });
});
