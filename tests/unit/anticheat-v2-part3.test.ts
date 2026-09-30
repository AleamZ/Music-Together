import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNumber, isOutdatedError, OUTDATED_EVENT, outdatedFetch } from "@/lib/client-build";
import { TICK_EVERY_MS } from "@/lib/game/vitals";
import { PET_TICK_MS } from "@/lib/game/pets/model";
import { MIN_DELAY, ROLLBACK_W } from "@/lib/game/fight/net";

// Part 3 re-creates functions from their newest bodies: every added line is marked "-- 00NN", an added block sits
// between "-- 00NN {" and "-- 00NN }", a changed line reads "… -- 00NN was: <old line>" (as in anticheat-v2-sql.test.ts).

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const M = (n: string) => read(`supabase/migrations/${n}.sql`);
const body = (s: string, sig: string) => {
  const from = s.indexOf(`create or replace function public.${sig}`);
  expect(from, sig).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
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
/** Every migration strictly between two. */
const between = (from: string, to: string) => readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql") && f.slice(0, 4) > from.slice(0, 4) && f.slice(0, 4) < to.slice(0, 4))
  .map((f) => f.slice(0, -4));

describe("0064–0067: every re-created function is its newest body plus the marked lines", () => {
  const cases: Array<[string, string, string, string]> = [
    ["_ac_guard(", "0015_anticheat", "0064_client_build", "0064"],
    ["finish_cast(", "0059_reel_hook", "0065_ac_stats", "0065"],
    ["net_haul(p_session_token text, p_throw_id uuid, p_press integer", "0056_net_replay", "0065_ac_stats", "0065"],
    ["harvest_part(p_room_id uuid, p_session_token text, p_plot integer, p_toggles integer[],", "0061_harvest_replay", "0065_ac_stats", "0065"],
    ["crab_finish(p_room_id uuid, p_session_token text, p_visit_id uuid, p_grabs integer[],", "0062_crab_replay", "0065_ac_stats", "0065"],
    ["sling_shoot(p_room_id uuid, p_session_token text, p_rat_id bigint, p_press integer,", "0063_sling_replay", "0065_ac_stats", "0065"],
    ["pet_tick(p_session_token text)", "0036_pets", "0066_pet_song", "0066"],
    ["_song_bonus(", "0015_anticheat", "0066_pet_song", "0066"],
    ["fight_push(", "0060_fight_secrets", "0067_pvp_lag", "0067"],
    ["_pvp_settle(", "0051_bai_dat", "0067_pvp_lag", "0067"],
  ];
  for (const [sig, src, dst, tag] of cases) {
    it(`${sig.slice(0, sig.indexOf("("))} (${dst.slice(0, 4)})`, () => {
      const name = sig.slice(0, sig.indexOf("("));
      for (const f of between(src, dst)) expect(M(f).includes(`function public.${name}(`), `${name} in ${f}`).toBe(false);
      expect(unmarked(body(M(dst), sig), tag)).toBe(body(M(src), sig));
      expect(body(M(dst), sig)).toContain(`-- ${tag}`);
    });
  }
  it("no later migration re-creates them again — but 0078, verbatim but for its marked lines", () => {
    const later = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql") && f.slice(0, 4) > "0067");
    for (const f of later) {
      for (const [sig, , dst] of cases) {
        if (!read(`supabase/migrations/${f}`).includes(`function public.${sig.slice(0, sig.indexOf("("))}(`)) continue;
        // economy v2 (0104) re-creates the 2-arg pet_tick (the sóc's forage; tests/unit/econ-rewards.test.ts), never the
        // 1-arg stub 0066 left
        if (f === "0104_econ_rewards.sql" && sig === "pet_tick(p_session_token text)") {
          expect(read(`supabase/migrations/${f}`)).not.toContain("function public.pet_tick(p_session_token text)");
          continue;
        }
        expect(f, sig).toBe("0078_v21_fixes.sql");                                   // v21 fixes: the catch flag (mt.catch)
        expect(unmarked(body(M(f.slice(0, -4)), sig), "0078")).toBe(body(M(dst), sig));
      }
    }
  });
});

describe("0064: the minimum build", () => {
  const M64 = M("0064_client_build");
  it("reads the build the client sends and refuses an older one from the lock gate", () => {
    expect(read("lib/supabase.ts")).toContain('"X-Client-Info": `music-together/${process.env.NEXT_PUBLIC_CLIENT_BUILD ?? "dev"}`');
    expect(M64).toContain("'^music-together/([0-9]{12})'");
    expect(body(M64, "_ac_guard(")).toContain("raise exception 'client outdated' using errcode = '22023', hint = 'build'");
    expect(read("lib/client-build.ts")).toContain('m === "client outdated"');
  });
  it("buildNumber mirrors _client_build()", () => {
    expect(buildNumber("202609281530-abc1234")).toBe(202609281530);
    expect(buildNumber("202609281530")).toBe(202609281530);
    expect(buildNumber("abc1234")).toBe(0);
    expect(buildNumber("dev")).toBe(0);
    expect(buildNumber(null)).toBe(0);
    expect(buildNumber("20260928")).toBe(0);
  });
});

describe("the outdated page", () => {
  afterEach(() => vi.restoreAllMocks());
  it("knows the refusal", () => {
    expect(isOutdatedError({ message: "client outdated", hint: "build" })).toBe(true);
    expect(isOutdatedError('{"code":"22023","message":"client outdated","hint":"build"}')).toBe(true);
    expect(isOutdatedError({ message: "account locked" })).toBe(false);
    expect(isOutdatedError(null)).toBe(false);
  });
  it("the supabase fetch raises the event on a refused answer only, and hands the answer on untouched", async () => {
    const seen = vi.fn();
    window.addEventListener(OUTDATED_EVENT, seen);
    const answer = (status: number, text: string) => vi.fn(async () => new Response(text, { status }));
    const refused = answer(400, '{"code":"22023","message":"client outdated","hint":"build","details":"202609290000"}');
    const res = await outdatedFetch(refused as unknown as typeof fetch)("https://x/rest/v1/rpc/claim_daily");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(await res.text()).toContain("client outdated");
    await outdatedFetch(answer(400, '{"message":"account locked"}') as unknown as typeof fetch)("https://x");
    await outdatedFetch(answer(200, '"client outdated"') as unknown as typeof fetch)("https://x");
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener(OUTDATED_EVENT, seen);
  });
  it("the root layout mounts the banner", () => {
    expect(read("app/layout.tsx")).toContain("<OutdatedBanner />");
  });
});

describe("0065: the statistics", () => {
  const M65 = M("0065_ac_stats");
  it("the auto-blacklist is on, with 8 hard events on 2 days, counted after a manual unblacklist", () => {
    const M64 = M("0064_client_build");
    expect(M64).toContain("add column if not exists auto_blacklist boolean not null default true");
    expect(M64).toContain("add column if not exists auto_blacklist_hard integer not null default 8");
    expect(M65).toContain("if v_n < c.auto_blacklist_hard or v_d < 2 then return false; end if;");
    expect(M65).toContain("for each row when (new.outcome in ('log_only', 'in_lock', 'strike_1', 'strike_2'))");
    expect(M65).toContain("coalesce((select blacklist_cleared_at from public.anticheat_status where account_id = p_account), '-infinity')");
  });
  it("the thresholds of the plan", () => {
    expect(M65).toContain("if z >= 4 and r.w::numeric / r.n >= p + 0.15 then");
    expect(M65).toContain("if z >= 4 and r.e::numeric / r.n >= greatest(p + 0.2, 2 * p) then");
    expect(M65).toContain("where o.others >= 5 and e.xu >= 5000 and e.xu >= 3 * o.p95 and e.xu >= 10 * o.med");
    expect(M65).toContain("having count(distinct date_trunc('hour', l.created_at)) >= 20");
    expect(M65).toContain("v_exact := (v_tm->>'cuts')::int = 8 and (v_tm->>'exact')::int >= 7;");
    expect(M65).toContain("v_exact := (v_tm->>'hits')::int = 3 and (v_tm->>'exact')::int = 3;");
    expect(M65).toContain("v_exact := v_mark = 'hit' and abs(v_rat[1] - p_aim) <= 1500;");
  });
  it("_harvest_timing and _crab_timing replay 0061's and 0062's loops statement for statement", () => {
    const strip = (s: string) => s.split("\n").map((l) => l.replace(/\s+--.*$/, "").trim()).filter((l) => l && !l.startsWith("--"));
    const loop = (b: string) => b.slice(b.indexOf("begin"), b.lastIndexOf("return"));
    const h61 = strip(loop(body(M("0061_harvest_replay"), "_harvest_replay(")));
    const h65 = strip(loop(body(M65, "_harvest_timing(")));
    expect(h65.filter((l) => !l.includes("v_exact"))).toEqual(h61);
    const c62 = strip(loop(body(M("0062_crab_replay"), "_crab_replay("))).join("\n");
    const c65 = strip(loop(body(M65, "_crab_timing("))).join("\n")
      .replace("x := (ph[tries + 1] + t) % p;\n", "")
      .replace("if 10 * x >= 6 * p then v_first := coalesce(v_first, tick); else v_first := null; end if;\n", "")
      .replace("10 * x >= 6 * p", "10 * ((ph[tries + 1] + t) % p) >= 6 * p")
      .replace("if mark = 'hit' then\nhits := hits + 1;\nif v_first = tick then v_exact := v_exact + 1; end if;\nend if;",
               "if mark = 'hit' then hits := hits + 1; end if;")
      .replace("\nv_first := null;", "");
    expect(c65).toBe(c62);
  });
});

describe("0066: the pet's heartbeat", () => {
  const M66 = M("0066_pet_song");
  it("90 s covers three vitals ticks, and the pet ticks once a minute", () => {
    expect(M66).toContain("v_beat < now() - interval '90 seconds'");
    expect(3 * TICK_EVERY_MS).toBeLessThanOrEqual(90_000);
    expect(PET_TICK_MS).toBeLessThanOrEqual(90_000);
  });
  it("the client sends its room", () => {
    expect(read("lib/game/pets/rpc.ts")).toContain('call("pet_tick", { p_session_token: token, p_room_id: roomId })');
    expect(read("components/game/GameShell.tsx")).toContain("usePets(token, room.id, onPetFound)");
  });
  it("the song's play time is the server's", () => {
    expect(body(M66, "_song_bonus(")).toContain("v_played := least(v_wall, v_line);");
    expect(body(M66, "_song_bonus(")).toContain("or v_played < greatest(60, 0.75 * greatest(q.duration_seconds, coalesce(v_peer, 0)))");
  });
});

describe("0067: PvP", () => {
  const M67 = M("0067_pvp_lag");
  it("the look-ahead rule is 0060's superhuman rule for either side", () => {
    expect(M("0060_fight_secrets")).toContain("v_ev[2] > 24 and v_ev[2] > 3 * coalesce(v_ev[5], 0) + 8");
    expect(M67).toContain("not (v_rx[2] > 24 and v_rx[2] > 3 * v_rx[3] + 8)");
    expect(M67).toContain("if p_frame - p_rx[1] between 1 and 4 then p_rx[2] := p_rx[2] + 1;");
    expect(M67).toContain("elsif p_frame - p_rx[1] between 5 and 8 then p_rx[3] := p_rx[3] + 1;");
  });
  it("an honest reaction cannot land in the fast window: the input delay plus a human's reaction exceed it", () => {
    expect(MIN_DELAY + 8).toBeGreaterThan(4);
    expect(ROLLBACK_W).toBeLessThan(30);   // late = 30 frames behind the clock: beyond the rollback window
  });
  it("the stall blame no longer reads the client's p_stall", () => {
    const b = body(M67, "_pvp_settle(");
    expect(b).toContain("if coalesce(v_late, 0) * 5 > greatest(mt.sim_frame, 600) and coalesce(v_late, 0) > coalesce(v_olate, 0) then");
    expect(unmarked(b, "0067")).toContain("if coalesce(v_opp_stall, 0) * 5 > greatest(mt.sim_frame, 600) then");
  });
});
