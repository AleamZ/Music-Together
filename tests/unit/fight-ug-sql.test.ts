import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { fightErrorMessage } from "@/lib/game/fight/messages";
import { styleId } from "@/lib/game/fight/styles";
import {
  BOSSES, CUP_FILL_MS, CUP_READY_MS, CUP_TIERS, CUPS_DAY, K_NEW, K_NEW_MATCHES, K_SETTLED, LADDER_DAY, LADDER_START_DELAY_S,
  PAIR_DAY, PAIR_HALF_AFTER, QUEUE_TIERS, QUEUE_TIMEOUT_MS, RATED_DAY, RATING_FLOOR, READY_MS, SEASON_DAYS, SEASON_EPOCH, TIERS,
  UG_FEE_PCT, UG_START_DELAY_S,
} from "@/lib/game/fight/underground";

// v20.4: 0052 against the TS it mirrors, and its re-created functions against their newest versions (every added line
// marked "-- v20.4", added blocks between "-- v20.4 {" and "-- v20.4 }", a changed line "… -- v20.4 was: <old line>").

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const M = (n: string) => read(`supabase/migrations/${n}.sql`);
const M15 = M("0015_anticheat"), M48 = M("0048_fight_engine"), M50 = M("0050_dojo"), M51 = M("0051_bai_dat"), M52 = M("0052_underground");
const LATER = ["0049_fight_matches", "0050_dojo", "0051_bai_dat", "0055_blacklist"];

const body = (s: string, name: string) => {
  const from = s.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
/** The body without the v20.4 lines and blocks, changed lines put back. */
const unmarked = (b: string) => {
  const out: string[] = [];
  let skip = false;
  for (const l of b.split("\n")) {
    if (l.includes("-- v20.4 {")) { skip = true; continue; }
    if (l.includes("-- v20.4 }")) { skip = false; continue; }
    if (skip) continue;
    const was = l.indexOf("-- v20.4 was: ");
    if (was >= 0) out.push(`${l.match(/^\s*/)![0]}${l.slice(was + "-- v20.4 was: ".length)}`);
    else if (!l.includes("-- v20.4")) out.push(l);
  }
  return out.join("\n");
};

describe("0052: re-created functions are their newest bodies plus the marked v20.4 lines", () => {
  it("_fx_reset and _fx_new (0048's; 0049–0051 and 0055 do not re-create them)", () => {
    for (const fn of ["_fx_reset", "_fx_new"]) {
      for (const f of LATER) expect(M(f).includes(`function public.${fn}(`), `${fn} in ${f}`).toBe(false);
      expect(unmarked(body(M52, fn)), fn).toBe(body(M48, fn));
      expect(body(M52, fn), fn).toContain("-- v20.4");
    }
  });

  it("the pipeline and the rings' rules (0051's, the newest)", () => {
    for (const fn of ["_fx_settle", "_pvp_void", "_pvp_sweep", "_pvp_caps", "fight_push", "fight_state", "fight_claim", "_fight_accounts_bd", "_ac_wipe"]) {
      expect(M("0055_blacklist").includes(`function public.${fn}(`), fn).toBe(false);
      expect(unmarked(body(M52, fn)), fn).toBe(body(M51, fn));
      expect(body(M52, fn), fn).toContain("-- v20.4");
    }
    expect(body(M52, "_fx_settle").split("\n").filter((l) => l.includes("-- v20.4")).map((l) => l.trim())).toEqual([
      "if mt.kind like 'ug\\_%' then v_extra := coalesce(public._ug_settle(p_match, p_winner, p_reason), '{}'::jsonb); end if;   -- v20.4",
    ]);
  });

  it("dojo_state (0050's) and admin_anticheat_resolve (0015's, the newest)", () => {
    expect(M51.includes("function public.dojo_state(")).toBe(false);
    expect(unmarked(body(M52, "dojo_state"))).toBe(body(M50, "dojo_state"));
    for (const f of ["0016_v15_2_crops", "0017_v16_cards", "0019_v17_rats", "0041_apartments", "0043_real_estate", "0051_bai_dat"]) {
      expect(M(f).includes("function public.admin_anticheat_resolve("), f).toBe(false);
    }
    expect(unmarked(body(M52, "admin_anticheat_resolve"))).toBe(body(M15, "admin_anticheat_resolve"));
  });

  it("the lock order: an account's live matches before its wallet (the v20.3 follow-up)", () => {
    const res = body(M52, "admin_anticheat_resolve");
    expect(res.indexOf("_fx_lock_live(p_account_id)")).toBeGreaterThan(0);
    expect(res.indexOf("_fx_lock_live(p_account_id)")).toBeLessThan(res.indexOf("_wallet_lock(p_account_id)"));
    const del = body(M52, "_fight_accounts_bd");
    expect(del.indexOf("_fx_lock_live(old.id)")).toBeLessThan(del.indexOf("_wallet_lock(old.id)"));
    // the fight trigger fires before card_accounts_bd (which locks the wallet): triggers fire in name order
    expect(M52).toContain("create trigger accounts_bd_fight before delete on public.accounts");
    expect("accounts_bd_fight" < "card_accounts_bd").toBe(true);
    expect(M52).toContain("drop trigger if exists fight_accounts_bd on public.accounts;");
    // settlement: the cup row before the profiles, the profiles before the wallets
    const s = body(M52, "_ug_settle");
    expect(s.indexOf("from public.ug_cups where id = mt.ref::uuid for update")).toBeLessThan(s.indexOf("_ug_rate(p_match, p_winner, 1)"));
    expect(s.indexOf("_ug_rate(p_match, p_winner, v_f)")).toBeLessThan(s.indexOf("_wallet_lock(least(mt.p1, mt.p2))"));
    expect(s.indexOf("_wallet_lock(least(mt.p1, mt.p2))")).toBeLessThan(s.indexOf("_wallet_lock(greatest(mt.p1, mt.p2))"));
  });

  it("the ledger: 0051's 48 reasons plus the underground's three", () => {
    const reasons = (s: string) => {
      const from = s.lastIndexOf("add constraint coin_ledger_reason_check");
      return [...s.slice(from, s.indexOf("));", from)).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    };
    expect(reasons(M51)).toHaveLength(48);
    expect(reasons(M52)).toEqual([...reasons(M51), "ug_entry", "ug_prize", "ug_refund"]);
  });
});

describe("0052 against lib/game/fight/underground.ts", () => {
  it("the bosses (halved first-clear prizes, the owner's ruling)", () => {
    const rows = [...M52.matchAll(/^\s+\((\d+), '([^']+)', '(\w+)', (\d+), (\d+), (\d+), (\d+), (null|array\[[^\]]*\])\)/gm)].map((m) => ({
      floor: Number(m[1]), name: m[2], style: m[3], level: Number(m[4]), hpPct: Number(m[5]), entry: Number(m[6]), prize: Number(m[7]),
      styleByRound: m[8] === "null" ? undefined : [...m[8].matchAll(/'(\w+)'/g)].map((x) => x[1]),
    }));
    expect(rows).toEqual(BOSSES.map((b) => ({
      floor: b.floor, name: b.name, style: b.style, level: b.level, hpPct: b.hpPct, entry: b.entry, prize: b.prize,
      styleByRound: b.styleByRound ? [...b.styleByRound] : undefined,
    })));
    for (const b of BOSSES) expect(styleId(b.style), b.style).toBeGreaterThan(0);
  });

  it("the tiers, the rating floor, K and the season", () => {
    const t = body(M52, "_ug_tier");
    for (const x of TIERS.slice(1)) expect(t).toContain(`when r >= ${x.min} then '${x.key}'`);
    expect(t).toContain(`else '${TIERS[0].key}'`);
    expect(body(M52, "_ug_profile")).toContain(`greatest(${RATING_FLOOR}, 1000 + (p.rating - 1000) / 2)`);
    expect(body(M52, "_ug_rate")).toContain(`case when a.rated < ${K_NEW_MATCHES} then ${K_NEW} else ${K_SETTLED} end`);
    expect(body(M52, "_ug_season")).toContain(`greatest(0, public._vn_today() - date '${SEASON_EPOCH}') / ${SEASON_DAYS}`);
  });

  it("the entries, limits, clocks and the fee", () => {
    expect(body(M52, "ug_queue_join")).toContain(`p_tier not in (${QUEUE_TIERS.join(", ")})`);
    expect(body(M52, "ug_cup_join")).toContain(`p_tier not in (${CUP_TIERS.join(", ")})`);
    expect(body(M52, "ug_queue_join")).toContain(`p.rated_today >= ${RATED_DAY}`);
    expect(body(M52, "ug_ladder_start")).toContain(`p.ladder_today >= ${LADDER_DAY}`);
    expect(body(M52, "ug_cup_join")).toContain(`p.cups_today >= ${CUPS_DAY}`);
    const pair = body(M52, "_ug_pair");
    expect(pair).toContain(`interval '${QUEUE_TIMEOUT_MS / 1000} seconds'`);
    expect(pair).toContain("least(400, 150 + 50 * floor(extract(epoch from now() - q.joined_at) / 15)::integer)");
    expect(pair).toContain(`< ${PAIR_DAY}`);
    expect(pair).toContain(`'ug_rated', v_a.account_id, v_b.account_id, v_a.style, v_b.style, v_a.tier, null, ${READY_MS / 1000})`);
    expect(body(M52, "_ug_cup_tick")).toContain(`sa, sb, 0, p_cup::text, ${CUP_READY_MS / 1000})`);
    expect(body(M52, "_ug_sweep_room")).toContain(`interval '${CUP_FILL_MS / 60_000} minutes'`);
    expect(body(M52, "_ug_settle")).toContain(`if v_meet >= ${PAIR_HALF_AFTER} then v_f := 0.5; end if;`);
    expect(body(M52, "ug_ready")).toContain(`now() + interval '${UG_START_DELAY_S} seconds'`);
    expect(body(M52, "ug_ladder_start")).toContain(`now() + interval '${LADDER_START_DELAY_S} seconds'`);
    // the fee is fight_config's (5 %), and the cup pays 70 % of the pool
    expect(UG_FEE_PCT).toBe(5);
    expect(body(M52, "_ug_cup_advance")).toContain("v_champ := v_pool * 70 / 100;");
  });

  it("every new function is private or granted; every refusal and raise has Vietnamese copy", () => {
    const created = [...M52.matchAll(/create or replace function public\.(\w+)\(/g)].map((m) => m[1]);
    expect(created.length).toBeGreaterThan(40);
    for (const fn of created) {
      if (fn.startsWith("_")) expect(M52, fn).toMatch(new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`));
      else expect(M52, fn).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to anon, authenticated;`));
    }
    // (the admin's resolve keeps its own English codes: the admin tab shows them)
    const player = M52.replace(body(M52, "admin_anticheat_resolve"), "");
    const codes = new Set([
      ...[...player.matchAll(/raise exception '([^']+)'/g)].map((m) => m[1]),
      ...[...player.matchAll(/'refused', '([^']+)'/g)].map((m) => m[1]),
      "in a match", "already queued", "already in a cup",
    ]);
    expect(codes.size).toBeGreaterThanOrEqual(12);
    for (const c of codes) expect(fightErrorMessage(c), c).not.toBe("Có lỗi, thử lại sau nhé.");
  });

  it("_in_shade is untouched: ham_ngam is indoors because it is not an outdoor map (R7)", () => {
    expect(M52.includes("function public._in_shade(")).toBe(false);
    expect(body(M51, "_in_shade")).not.toContain("ham_ngam");
  });
});
