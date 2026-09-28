import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BOT_LEVELS, motionScript } from "@/lib/game/fight/bot";
import {
  EXAMS, EXAM_MINUTES, FIGHT_MIN_VITALS, HUNGER_PER_ROUND, MARTIAL, THIRST_PER_ROUND, TUITION, UNIFORM_IDS,
} from "@/lib/game/fight/dojo";
import { KATA_GOOD, KATA_HALF_PCT, KATA_LANES, KATA_PACE_PERMILLE, KATA_PERFECT, KATA_START, KATA_TAIL } from "@/lib/game/fight/kata";
import { RATE_CHANGES } from "@/lib/game/fight/log";
import { styleStats } from "@/lib/game/fight/styles";
import { EXAM_START_DELAY_S, NO_PUSH_LOSS_S, PACE_SLACK_FRAMES, PUSH_MAX_FRAMES } from "@/lib/game/fight/referee";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const M49 = read("supabase/migrations/0049_fight_matches.sql");
const M50 = read("supabase/migrations/0050_dojo.sql");

const body = (s: string, name: string) => {
  const from = s.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
const unmarked = (b: string) => b.split("\n").filter((l) => !l.includes("-- v20.2")).join("\n");

describe("0050: the seeds equal lib/game/fight/dojo.ts", () => {
  it("martial_styles: stats, uniform, engine id", () => {
    const rows = [...M50.matchAll(/\('(\w+)',\s+'([^']+)',\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+), '(vp_\w+)',\s+(\d)\)/g)]
      .map((m) => ({ key: m[1], name: m[2], stats: m.slice(3, 8).map(Number), uniform: m[8], id: Number(m[9]) }));
    expect(rows).toEqual(MARTIAL.map((s) => {
      const st = styleStats(s.id);
      return { key: s.key, name: s.name, stats: [st.atk, st.def, st.walk, st.jump, st.energy], uniform: s.uniform, id: s.id };
    }));
  });

  it("martial_belts: names and colours per style and rank, and the exam rows", () => {
    const belts = [...M50.matchAll(/\('(\w+)',\s+(\d), '([^']+)',\s+'(#[0-9a-f]{6})'\)/g)].map((m) => [m[1], Number(m[2]), m[3], m[4]]);
    expect(belts).toEqual(MARTIAL.flatMap((s) => s.belts.map((b) => [s.key, b.rank, b.name, b.color])));
    const exams = [...M50.matchAll(/\((\d),\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+),\s+(\d+), (\d)\)/g)].map((m) => m.slice(1).map(Number));
    expect(exams).toEqual([[0, 0, 0, 0, 0, 0, 0, 0],
      ...EXAMS.map((e) => [e.rank, e.fee, e.minHours, e.cooldownMin, e.notes, e.tpb, e.passPct, e.botLevel])]);
  });

  it("the uniforms: outfit slot, unisex, price 0, not starters", () => {
    const rows = [...M50.matchAll(/\('(vp_\w+)',\s+'outfit', '([^']+)',\s+0, false, (\d+), 'unisex'\)/g)].map((m) => [m[1], m[2]]);
    expect(rows).toEqual(MARTIAL.map((s) => [s.uniform, s.uniformName]));
    expect(rows.map((r) => r[0])).toEqual([...UNIFORM_IDS]);
  });
});

describe("0050: the rules equal the TS", () => {
  it("tuition, the exam clock, the kata windows and pacing", () => {
    expect(M50).toContain(`coalesce(v_coins, 0) < ${TUITION}`);
    expect(M50).toContain(`public._pay(v_account, -${TUITION}, 'dojo_tuition'`);
    expect(M50).toContain(`'tuition', ${TUITION},`);
    expect(M50).toContain(`now() + interval '${EXAM_MINUTES} minutes'`);
    expect(M50).toContain(`now() + interval '${EXAM_START_DELAY_S} seconds'`);
    const kata = body(M50, "_kata_chart");
    expect(kata).toContain(`tick integer := ${KATA_START}`);
    expect(kata).toContain(`r[1] % 100 < ${KATA_HALF_PCT}`);
    expect(kata).toContain(`(r[1] % ${KATA_LANES})::integer`);
    const score = body(M50, "_kata_score");
    expect(score).toContain(`best_d := ${KATA_GOOD + 1}`);
    expect(score).toContain(`best_d <= ${KATA_PERFECT}`);
    expect(body(M50, "_kata_input_error")).toContain(`else 180 end + ${KATA_TAIL}`);
    expect(body(M50, "dojo_kata_submit")).toContain(`make_interval(secs => ${KATA_PACE_PERMILLE / 1000} * v_len / 60.0)`);
    expect(body(M50, "dojo_kata_submit")).toContain(`v_chart[2 * v_notes - 1] + ${KATA_TAIL}`);
  });

  it("the ledger keeps 0043's reasons and adds the dojo's two (45)", () => {
    const reasons = (s: string) => {
      const from = s.lastIndexOf("check (reason in (");
      return [...s.slice(from, s.indexOf("));", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    const prev = reasons(read("supabase/migrations/0043_real_estate.sql"));
    expect(prev).toHaveLength(43);
    expect(reasons(M50)).toEqual([...prev, "dojo_tuition", "dojo_exam"]);
  });

  it("_in_shade is 0041's plus the dojo awning", () => {
    const old = body(read("supabase/migrations/0041_apartments.sql"), "_in_shade").split("\n");
    const neu = body(M50, "_in_shade").split("\n");
    const added = neu.filter((l) => !old.includes(l));
    expect(added.map((l) => l.trim())).toEqual([
      "('market', 640, 130, 80, 60), ('market', 40, 304, 80, 70), ('market', 680, 304, 80, 70),",
      "('market', 860, 248, 120, 36)",
    ]);
    expect(old.filter((l) => !neu.includes(l)).map((l) => l.trim())).toEqual([
      "('market', 640, 130, 80, 60), ('market', 40, 304, 80, 70), ('market', 680, 304, 80, 70)",
    ]);
  });

  it("the fashion RPCs are their latest bodies plus the uniform guard", () => {
    const latest: [string, string][] = [
      ["buy_fashion_item", "supabase/migrations/0022_fashion_store.sql"],
      ["sell_fashion_item", "supabase/migrations/0029_fashion2.sql"],
      ["transfer_fashion_item", "supabase/migrations/0029_fashion2.sql"],
    ];
    for (const [fn, file] of latest) {
      expect(unmarked(body(M50, fn)), fn).toBe(body(read(file), fn));
      expect(body(M50, fn).split("\n").filter((l) => l.includes("-- v20.2")).map((l) => l.trim()), fn).toEqual([
        "if p_item_id like 'vp\\_%' then raise exception 'uniform' using errcode = '22023'; end if;          -- v20.2",
      ]);
    }
  });

  it("every RPC is granted and takes the session token; the helpers are private", () => {
    for (const sig of ["dojo_state(text)", "dojo_enroll(text, text)", "dojo_exam_start(text, text)", "dojo_kata_submit(text, uuid, integer[])"]) {
      expect(M50).toContain(`grant execute on function public.${sig} to anon, authenticated;`);
    }
    for (const fn of ["dojo_state", "dojo_enroll"]) expect(body(M50, fn)).toContain("public._auth_account(p_session_token)");
    for (const fn of ["dojo_exam_start", "dojo_kata_submit"]) expect(body(M50, fn)).toContain("public._ac_account(p_session_token)");
    for (const m of M50.matchAll(/create or replace function public\.(_(?:kata|dojo)_\w+)\(/g)) {
      expect(M50, m[1]).toMatch(new RegExp(`revoke all on function public\\.${m[1]}\\([^)]*\\) from public, anon, authenticated;`));
    }
  });
});

describe("0049: the pipeline", () => {
  it("the bot mirror's tables equal bot.ts", () => {
    const lv = body(M49, "_fx_bot_level");
    BOT_LEVELS.forEach((l, i) => {
      if (l) expect(lv).toContain(`when ${i} then array[${[l.d, l.block, l.aa, l.special, l.tech, l.combo].join(", ")}]`);
    });
    // motion scripts: QCF+P, QCB+K, DP+P, ↓↓+P, QCF×2+HK (relative masks)
    const sc = body(M49, "_fx_bot_script");
    expect(motionScript(1, 1)).toEqual([8, 10, 18]);
    expect(sc).toContain("when 1 then array[8, 10, 2 | k]");
    expect(motionScript(2, 2)).toEqual([8, 9, 65]);
    expect(sc).toContain("when 2 then array[8, 9, 1 | k]");
    expect(motionScript(3, 1)).toEqual([2, 8, 10, 26]);
    expect(motionScript(4, 1)).toEqual([8, 0, 24]);
    expect(motionScript(5, 4)).toEqual([8, 10, 2, 8, 10, 130]);
  });

  it("pacing, push size, the abandon rule and the vitals cost", () => {
    const push = body(M49, "fight_push");
    expect(push).toContain(`public._fx_runs_error(p_runs, ${PUSH_MAX_FRAMES})`);
    expect(push).toContain(`* 60)::integer + ${PACE_SLACK_FRAMES}`);
    expect(push).toContain(`least(v_target, mt.sim_frame + ${PUSH_MAX_FRAMES})`);
    expect(body(M49, "_fx_sweep")).toContain(`< now() - interval '${NO_PUSH_LOSS_S} seconds'`);
    const settle = body(M49, "_fx_settle");
    expect(settle).toContain(`hunger = greatest(0, hunger - ${HUNGER_PER_ROUND} * n), thirst = greatest(0, thirst - ${THIRST_PER_ROUND} * n)`);
    const vit = body(M49, "_fx_vitals_ok");
    expect(vit).toContain(`coalesce(v.hunger, 0) < ${FIGHT_MIN_VITALS}`);
    expect(vit).toContain(`coalesce(v.thirst, 0) < ${FIGHT_MIN_VITALS}`);
    expect(RATE_CHANGES).toBe(20);
  });

  it("keeps the helpers private, grants the RPCs, and creates no engine function again", () => {
    for (const m of M49.matchAll(/create or replace function public\.(_fx_\w+)\(/g)) {
      expect(M49, m[1]).toMatch(new RegExp(`revoke all on function public\\.${m[1]}\\([^)]*\\) from public, anon, authenticated;`));
    }
    const m48 = read("supabase/migrations/0048_fight_engine.sql");
    for (const m of M49.matchAll(/create or replace function public\.(\w+)\(/g)) expect(m48, m[1]).not.toContain(`function public.${m[1]}(`);
    for (const sig of ["fight_push(text, uuid, integer, integer[], integer, integer[], integer, bigint, integer)", "fight_state(text, uuid)",
      "fight_forfeit(text, uuid)", "fight_wear_uniform(text, text)", "fight_unwear_uniform(text)"]) {
      expect(M49).toContain(`grant execute on function public.${sig} to anon, authenticated;`);
    }
    for (const t of ["fight_matches", "fight_logs", "fight_profiles"]) expect(M49).toContain(`revoke all on public.${t} from anon, authenticated;`);
  });
});
