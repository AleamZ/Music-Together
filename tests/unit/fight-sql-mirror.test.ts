import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  END_FRAMES, ENERGY_MAX, GRAVITY, HURT_AIR, HURT_CROUCH, HURT_STAND, INTRO_FRAMES, JUMP_VX, JUMP_VY, KD_FRAMES, PUSH_W,
  ROUND_FRAMES, STAGE_MAX, STAGE_MIN, START_X1, START_X2, STATE_LEN, TECH_PUSH, WALK_B, WALK_F, fb,
} from "@/lib/game/fight/engine";
import { MOVE_TABLE, MOVE_TABLE_LEN, REC, STYLE_BASE, STYLE_REC } from "@/lib/game/fight/moves";

const SQL = readFileSync("supabase/migrations/0048_fight_engine.sql", "utf8").replace(/\r\n/g, "\n");
// 0079 re-creates _fx_moves(), _fx_contact() and _fx_bot() (the boxes fit the chibi fighter): the newest definitions.
const M79 = readFileSync("supabase/migrations/0079_chibi_boxes.sql", "utf8").replace(/\r\n/g, "\n");

// The replay itself is pinned by tests/fixtures/fight-cases.json (Vitest here, tests/sql/fight-engine-smoke.sql there);
// these pins keep the table and the constants of the two engines side by side.
describe("0048_fight_engine.sql", () => {
  it("_fx_moves() (newest: 0079) is MOVE_TABLE", () => {
    const m = /create or replace function public\._fx_moves\(\) returns integer\[\]\s*language sql immutable parallel safe\s*as \$\$ select '\{([^}]*)\}'::integer\[\] \$\$;/.exec(M79);
    expect(m).not.toBeNull();
    const nums = m![1].split(",").map((x) => Number(x.trim()));
    expect(nums).toHaveLength(MOVE_TABLE_LEN);
    expect(nums).toEqual([...MOVE_TABLE]);
  });

  it("uses the engine's layout and constants", () => {
    expect(STATE_LEN).toBe(176);
    expect(fb(0) + 1).toBe(49);
    expect(fb(1) + 1).toBe(113);
    expect(STYLE_BASE).toBe(4608);
    expect(REC).toBe(32);
    expect(STYLE_REC).toBe(16);
    expect(SQL).toContain("array_fill(0, array[176])");
    expect(SQL).toContain(`m[id * ${REC} + f + 1]`);
    expect(SQL).toContain(`m[${STYLE_BASE} + style * ${STYLE_REC} + f + 1]`);
    expect(SQL).toContain(`then ${START_X1} else ${START_X2} end`);
    expect(SQL).toContain(`least(${STAGE_MAX}, greatest(${STAGE_MIN},`);
    expect(SQL).toContain(`(${WALK_F} * s[b + 54]) / 100`);
    expect(SQL).toContain(`(${WALK_B} * s[b + 54]) / 100`);
    expect(SQL).toContain(`(${JUMP_VY} * s[b + 55]) / 100`);
    expect(SQL).toContain(`(${JUMP_VX} * s[b + 55]) / 100`);
    expect(SQL).toContain(`s[b + 3] - ${GRAVITY}`);
    expect(SQL).toContain(`if dist < ${PUSH_W} then`);
    expect(SQL).toContain(`dir * ${TECH_PUSH}`);
    expect(SQL).toContain(`s[2 + 1] := ${INTRO_FRAMES};`);
    expect(SQL).toContain(`s[4 + 1] := ${ROUND_FRAMES};`);
    expect(SQL).toContain(`s[2 + 1] := ${END_FRAMES};`);
    expect(SQL).toContain(`s[b + 14] := ${KD_FRAMES};`);
    expect(SQL).toContain(`least(${ENERGY_MAX}, s[b + 6] + (50 * s[b + 56]) / 100)`);
  });

  it("0079 has the hurtboxes and the bot's spacing", () => {
    expect(M79).toContain(`if public._fx_air(s, o) then hw := ${HURT_AIR[0]}; hh := ${HURT_AIR[1]}; -- 0079`);
    expect(M79).toContain(`elsif public._fx_crouch(s, o, m) then hw := ${HURT_CROUCH[0]}; hh := ${HURT_CROUCH[1]}; -- 0079`);
    expect(M79).toContain(`else hw := ${HURT_STAND[0]}; hh := ${HURT_STAND[1]}; -- 0079`);
    expect(M79).toContain("if dist > 30 then -- 0079");
    expect(M79).toContain("dist < 26 and r2 < 15");
    expect(readFileSync("lib/game/fight/bot.ts", "utf8")).toMatch(/dist > 30\)[\s\S]*dist < 26 && r2 < 15/);
    expect(M79).not.toMatch(/grant execute/i);
  });

  it("keeps every function private", () => {
    const defs = [...SQL.matchAll(/create or replace function public\.(_fx_\w+)\(/g)].map((x) => x[1]);
    expect(defs.length).toBeGreaterThanOrEqual(30);
    for (const f of defs) expect(SQL, f).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated;`));
    expect(SQL).not.toMatch(/grant execute/i);
    expect(SQL).not.toMatch(/create table/i);
  });
});
