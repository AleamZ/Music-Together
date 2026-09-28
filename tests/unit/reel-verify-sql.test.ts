import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REEL } from "@/lib/game/fishing/reel";

const SQL = readFileSync("supabase/migrations/0046_reel_verify.sql", "utf8").replace(/\r\n/g, "\n");

// The SQL replay is checked against tests/fixtures/reel-cases.json by tests/sql/reel-verify-smoke.sql; these pins keep
// the constants of the two sims side by side.
describe("0046_reel_verify.sql", () => {
  it("replays with reel.ts's constants", () => {
    expect(SQL).toContain(`prog bigint := ${REEL.start}`);
    expect(SQL).toContain(`case when hold then ${REEL.lift} else -${REEL.gravity} end`);
    expect(SQL).toContain(`greatest(-${REEL.maxV}, least(${REEL.maxV},`);
    expect(SQL).toContain(`(-v * ${REEL.bouncePct}) / 100`);
    expect(SQL).toContain(`fish := greatest(${REEL.fishStart}, fl)`);
    expect(SQL).toContain(`fl := least(500000, h + ${REEL.floorGap})`);
    expect(SQL).toContain(`abs(target - fish) < ${REEL.close}`);
    expect(SQL).toContain(`tick >= ${REEL.maxTicks}`);
  });

  it("gives finish_cast the input and replaces the 4-arg one", () => {
    expect(SQL).toContain("drop function if exists public.finish_cast(text, uuid, boolean, boolean);");
    expect(SQL).toContain("grant execute on function public.finish_cast(text, uuid, boolean, boolean, integer[], integer) to anon, authenticated;");
    expect(SQL).toContain("jsonb_build_object('message', 'Cập nhật trang để câu tiếp')");
    for (const code of ["reel_bad_input", "reel_mismatch", "reel_too_fast"]) expect(SQL).toContain(`'${code}', 'finish_cast'`);
  });

  it("keeps the replay helpers private", () => {
    for (const f of ["_reel_imul(bigint, bigint)", "_reel_rand(bigint)", "_reel_replay(jsonb, bigint, integer[])", "_reel_input_error(integer[], integer)"]) {
      expect(SQL).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    }
  });
});
