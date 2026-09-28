import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { fightErrorMessage } from "@/lib/game/fight/messages";
import { MAX_DELAY, MIN_DELAY } from "@/lib/game/fight/net";
import { CLAIM_AFTER_MS, FRESH_MS, PUSH_MAX, PVP_START_DELAY_S } from "@/lib/game/fight/pvp";
import {
  CORNER_HOLD_MS, DEFAULT_CAPS, FEE_PCT, NEWS_STAKE, OFFER_LAPSE_MS, OVERTIME_MS, STAKES, VOID_ABSENT_MS,
} from "@/lib/game/fight/rings";

// v20.3: 0051 against the TS it mirrors, and its re-created functions against their newest versions (every added line
// marked "-- v20.3", added blocks between "-- v20.3 {" and "-- v20.3 }").

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const M43 = read("supabase/migrations/0043_real_estate.sql");
const M49 = read("supabase/migrations/0049_fight_matches.sql");
const M50 = read("supabase/migrations/0050_dojo.sql");
const M51 = read("supabase/migrations/0051_bai_dat.sql");

const body = (s: string, name: string) => {
  const from = s.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
/** The body without the v20.3 lines and blocks. */
const unmarked = (b: string) => {
  const out: string[] = [];
  let skip = false;
  for (const l of b.split("\n")) {
    if (l.includes("-- v20.3 {")) { skip = true; continue; }
    if (l.includes("-- v20.3 }")) { skip = false; continue; }
    if (!skip && !l.includes("-- v20.3")) out.push(l);
  }
  return out.join("\n");
};

describe("0051: re-created functions are their newest bodies plus the marked v20.3 lines", () => {
  it("_fx_settle, _fx_answer, fight_push, fight_state (0049)", () => {
    for (const fn of ["_fx_settle", "_fx_answer", "fight_push", "fight_state"]) {
      expect(M50.includes(`function public.${fn}(`), `${fn} not re-created by 0050`).toBe(false);
      expect(unmarked(body(M51, fn)), fn).toBe(body(M49, fn));
      expect(body(M51, fn).length, fn).toBeGreaterThan(body(M49, fn).length);
    }
    expect(body(M51, "_fx_settle").split("\n").filter((l) => l.includes("-- v20.3")).map((l) => l.trim())).toEqual([
      "if mt.kind = 'pvp' then v_extra := coalesce(public._pvp_settle(p_match, p_winner, p_reason), '{}'::jsonb); end if;   -- v20.3",
    ]);
  });

  it("_ac_wipe (0043's, the newest: 0044–0050 do not re-create it)", () => {
    for (const f of ["0044_cramp_odds", "0045_faint_ladder", "0046_reel_verify", "0047_fishing_hunger", "0048_fight_engine", "0049_fight_matches", "0050_dojo"]) {
      expect(read(`supabase/migrations/${f}.sql`).includes("function public._ac_wipe("), f).toBe(false);
    }
    expect(unmarked(body(M51, "_ac_wipe"))).toBe(body(M43, "_ac_wipe"));
    expect(body(M51, "_ac_wipe").split("\n").filter((l) => l.includes("-- v20.3")).map((l) => l.trim().replace(/\s+-- v20\.3$/, ""))).toEqual([
      "perform public._fx_forfeit_all(p_account);",
      "delete from public.martial_exams where account_id = p_account;",
      "delete from public.martial_enrollments where account_id = p_account;",
      "delete from public.fight_profiles where account_id = p_account;",
      "update public.characters set outfit = null where account_id = p_account and outfit like 'vp\\_%';",
      "delete from public.account_items where account_id = p_account and item_id like 'vp\\_%';",
    ]);
  });

  it("_in_shade is 0050's plus bai_dat and its four ring roofs", () => {
    const old = body(M50, "_in_shade").split("\n");
    const neu = body(M51, "_in_shade").split("\n");
    expect(neu.filter((l) => !old.includes(l)).map((l) => l.trim())).toEqual([
      "select p_map is null or p_x is null or p_y is null or p_map not in ('hall', 'pond', 'field', 'market', 'khu_nha', 'bai_dat')",
      "('market', 860, 248, 120, 36),",
      "('bai_dat', 100, 100, 200, 100), ('bai_dat', 500, 100, 200, 100),",
      "('bai_dat', 100, 260, 200, 100), ('bai_dat', 500, 260, 200, 100)",
    ]);
    expect(old.filter((l) => !neu.includes(l)).map((l) => l.trim())).toEqual([
      "select p_map is null or p_x is null or p_y is null or p_map not in ('hall', 'pond', 'field', 'market', 'khu_nha')",
      "('market', 860, 248, 120, 36)",
    ]);
  });

  it("the ledger: 0050's 45 reasons plus the rings' three", () => {
    const reasons = (s: string) => {
      const from = s.lastIndexOf("add constraint coin_ledger_reason_check");
      return [...s.slice(from, s.indexOf("));", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(reasons(M50)).toHaveLength(45);
    expect(reasons(M51)).toEqual([...reasons(M50), "fight_stake", "fight_win", "fight_refund"]);
  });
});

describe("0051 against lib/game/fight", () => {
  it("the config defaults, the fee and the stake presets", () => {
    expect(M51).toContain(`max_live_room integer not null default ${DEFAULT_CAPS.maxLiveRoom}`);
    expect(M51).toContain(`max_live_all integer not null default ${DEFAULT_CAPS.maxLiveAll}`);
    expect(M51).toContain(`max_staked_day integer not null default ${DEFAULT_CAPS.maxStakedDay}`);
    expect(M51).toContain(`max_pair_day integer not null default ${DEFAULT_CAPS.maxPairDay}`);
    expect(M51).toContain(`max_friendly_pair_day integer not null default ${DEFAULT_CAPS.maxFriendlyPairDay}`);
    expect(M51).toContain(`fee_pct integer not null default ${FEE_PCT} `);
    expect(body(M51, "ring_offer")).toContain(`p_stake not in (${STAKES.join(", ")})`);
    expect(body(M51, "ring_offer")).toContain(`p_n not between ${MIN_DELAY} and ${MAX_DELAY}`);
    expect(body(M51, "_pvp_settle")).toContain(`mt.stake >= ${NEWS_STAKE}`);
  });

  it("the clocks: corners, offers, claims, voids, overtime, frame 0, the push size", () => {
    expect(body(M51, "_ring_sweep")).toContain(`interval '${CORNER_HOLD_MS / 60_000} minutes'`);
    expect(body(M51, "_ring_sweep")).toContain(`interval '${OFFER_LAPSE_MS / 1000} seconds'`);
    expect(body(M51, "fight_claim")).toContain(`v_theirs < now() - interval '${CLAIM_AFTER_MS / 1000} seconds' and v_mine > now() - interval '${FRESH_MS / 1000} seconds'`);
    expect(body(M51, "_pvp_sweep")).toContain(`interval '${VOID_ABSENT_MS / 1000} seconds'`);
    expect(body(M51, "_pvp_sweep")).toContain(`interval '${OVERTIME_MS / 60_000} minutes'`);
    expect(body(M51, "ring_accept")).toContain(`now() + interval '${PVP_START_DELAY_S} seconds'`);
    expect(body(M51, "fight_push")).toContain(`_fx_runs_error(p_seen_runs, ${PUSH_MAX})`);
  });

  it("every new function is private or granted; every refusal and raise has Vietnamese copy", () => {
    const created = [...M51.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    for (const fn of created) {
      if (fn.startsWith("_")) expect(M51, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      else expect(M51, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated;`));
    }
    const codes = new Set([
      ...[...M51.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]),
      ...[...M51.matchAll(/'refused', '([^']+)'/g)].map((m) => m[1]),
      "not enough xu", "pvp locked", "daily fight limit", "ring busy",
    ]);
    expect(codes.size).toBeGreaterThanOrEqual(12);
    for (const c of codes) expect(fightErrorMessage(c), c).not.toBe("Có lỗi, thử lại sau nhé.");
  });

  it("wallets are locked in account-id order wherever two are touched", () => {
    for (const fn of ["_pvp_settle", "_pvp_void"]) {
      const b = body(M51, fn);
      expect(b.indexOf("_wallet_lock(least(mt.p1, mt.p2))"), fn).toBeGreaterThan(0);
      expect(b.indexOf("_wallet_lock(greatest(mt.p1, mt.p2))"), fn).toBeGreaterThan(b.indexOf("_wallet_lock(least(mt.p1, mt.p2))"));
      // the ring before the wallets (plan ruling P19)
      expect(b.indexOf("update public.fight_rings"), fn).toBeLessThan(b.indexOf("_wallet_lock("));
    }
    const acc = body(M51, "ring_accept");
    expect(acc.indexOf("_wallet_lock(greatest(r.red, r.blue))")).toBeGreaterThan(acc.indexOf("_wallet_lock(least(r.red, r.blue))"));
    // sweeps come before a ring row is locked
    for (const fn of ["ring_take", "ring_leave", "ring_offer", "ring_accept"]) {
      const b = body(M51, fn);
      expect(b.indexOf("_pvp_sweep_room("), fn).toBeLessThan(b.indexOf("for update"));
    }
  });
});
