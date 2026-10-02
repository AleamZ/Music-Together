// Economy v2, the fixed faucets (0104_econ_rewards.sql): the client's mirrors carry the migration's numbers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { levelReward, MAX_LEVEL, TELEPORT_FEE, XP_CAPS, xpAt } from "@/lib/game/progression/model";
import { COMPANY_MIN_PCT, COMPANY_SHARE_MAX, companyShare } from "@/lib/game/quests/model";
import {
  BOSS_DEFS, BOSS_PAID_PER_DAY, bossPaidCapped, bossRewardNote, DUNGEON_BASE, DUNGEON_FEE, DUNGEON_PAID_PER_DAY, DUNGEON_POT,
  dungeonReward,
} from "@/lib/game/realm/model";
import { FORAGE_DAY_CAP, FORAGE_MOVE_S } from "@/lib/game/pets/model";
import { SPECIES } from "@/lib/game/pets/catalog";
import { NPCS, PVE_PAID_WINS, PVP_CUT } from "@/lib/game/pets/v2";
import { SKIP_COST } from "@/lib/game/travel/vehicles";

const SQL = readFileSync("supabase/migrations/0104_econ_rewards.sql", "utf8").replace(/\r\n/g, "\n");
const fnBody = (name: string) => {
  const from = SQL.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return SQL.slice(from, SQL.indexOf("$$;", from) + 3);
};

describe("0104: progression", () => {
  it("levels pay 20·L, 60·L every 5th: 136 980 from 1 to 99", () => {
    expect(fnBody("_pg_level_reward")).toContain("when p_level % 5 = 0 then 60 * p_level else 20 * p_level");
    let total = 0;
    for (let l = 2; l <= MAX_LEVEL; l++) total += levelReward(l);
    expect(total).toBe(136980);
    expect(xpAt(MAX_LEVEL)).toBe(247450);
    expect([levelReward(4), levelReward(5), levelReward(99)]).toEqual([80, 300, 1980]);
  });
  it("the grant bucket is 1 500 a day", () => {
    expect(XP_CAPS.grant).toBe(1500);
    expect(fnBody("_pg_cap")).toContain(`when 'grant' then ${XP_CAPS.grant} else 0`);
  });
  it("rewards and resales are not work", () => {
    const work = fnBody("_pg_work_reason");
    for (const r of ["'daily'", "'login_reward'", "'song'", "'pet_find'"]) expect(work, r).not.toContain(r);
    for (const r of ["'sell'", "'rice_sell'", "'produce_sell'", "'critter_sell'", "'ore_sell'", "'wild_sell'"]) expect(work, r).toContain(r);
    expect(fnBody("_pg_work_earn")).toContain("l.ref like 'vehicle:%' or l.ref like 'fashion:%'");
    expect(fnBody("_pg_on_event")).toContain("if not public._pg_work_earn(new.account_id, v_reason, new.qty) then return new; end if;");
    expect(fnBody("_quest_on_event")).toContain("not public._pg_work_earn(new.account_id, new.meta->>'reason', new.qty)");
  });
  it("only a win with something at stake counts", () => {
    expect(fnBody("_pg_counted_win")).toContain("m.kind <> 'pvp' or m.stake > 0");
    expect(fnBody("_pg_on_event")).toContain("if public._pg_counted_win(new.meta) then");
    expect(fnBody("_quest_on_event")).toContain("if new.kind = 'fight_win' and not public._pg_counted_win(new.meta) then return new; end if;");
  });
  it("the achievements that shrink", () => {
    for (const [id, reward] of [["level_30", 3000], ["earn_1m", 5000], ["win_500", 5000]] as const) {
      expect(SQL).toMatch(new RegExp(`\\('${id}',\\s+${reward},`));
    }
  });
});

describe("0104: quests", () => {
  it("the company pool is shared by contribution", () => {
    expect(SQL).toContain("update public.company_pool set reward_coins = 3000");
    const share = fnBody("_company_share");
    expect(share).toContain(`least(${COMPANY_SHARE_MAX}, floor(q.reward_coins::numeric * k.qty`);
    expect(share).toContain("k.qty * 100 < q.goal");
    expect(COMPANY_MIN_PCT).toBe(1);
    // the smoke's goal of 500 fish: 50 / 25 / 5 / 4 fish
    expect([companyShare(3000, 50, 500), companyShare(3000, 25, 500), companyShare(3000, 5, 500), companyShare(3000, 4, 500)])
      .toEqual([300, 150, 30, 0]);
    expect(companyShare(3000, 200, 500)).toBe(COMPANY_SHARE_MAX);
    expect(companyShare(3000, 10, 500, 1000)).toBe(30);
    expect(companyShare(3000, 1, 0)).toBe(0);
  });
  it("the farm dailies ask the farm's numbers", () => {
    for (const [id, goal] of [["d_rice", 5000], ["d_produce", 5000], ["d_critter", 300]] as const) {
      expect(SQL).toMatch(new RegExp(`\\('${id}',\\s+${goal},`));
    }
  });
});

describe("0104: bosses and the dungeon", () => {
  it("a raid or a weather boss pays 2 kills a day", () => {
    expect(fnBody("_boss_payout")).toContain(`public._boss_paid_today(r.account_id, v_grp) < ${BOSS_PAID_PER_DAY} then`);
    expect(fnBody("_boss_paid_group")).toContain("when 'raid' then 'raid' when 'weather' then 'weather' when 'snow' then 'weather'");
    expect(BOSS_DEFS.filter((b) => bossPaidCapped(b.kind)).map((b) => b.id)).toEqual(["heo_rung", "thuy_quai", "nguoi_tuyet"]);
    expect(BOSS_DEFS.find((b) => b.id === "heo_rung")?.pool).toBe(1200);
    expect(bossRewardNote("heo_rung")).toContain(`${BOSS_PAID_PER_DAY} trận boss tổ đội`);
    expect(bossRewardNote("nguoi_tuyet")).toContain("boss mưa/tuyết");
    expect(bossRewardNote("trau_tinh")).toBe("Phần thưởng chia theo công sức.");
  });
  it("the raid's cooldown is per member", () => {
    expect(fnBody("boss_summon")).toContain("and (party_id = v_party or crew && v_crew)) then");
  });
  it("the dungeon pays 50 + 250 × n × share, 3 clears a day, for a fee of 100", () => {
    expect(fnBody("_dg_pay_fee")).toContain(`< ${DUNGEON_FEE} then raise exception 'insufficient funds'`);
    expect(fnBody("_dg_pay_fee")).toContain(`-${DUNGEON_FEE}, 'dungeon_entry'`);
    expect(fnBody("_dg_payout")).toContain(`v_done < ${DUNGEON_PAID_PER_DAY} then`);
    expect(fnBody("_dg_payout")).toContain(`v_coins := ${DUNGEON_BASE} + floor(${DUNGEON_POT} * v_paid * v_share)::int;`);
    expect(fnBody("_dg_payout")).toContain(`public._dg_clears_today(dm.account_id, p_run) < ${DUNGEON_PAID_PER_DAY}`);
    expect([dungeonReward(1, 1), dungeonReward(2, 0.5), dungeonReward(4, 0.25)]).toEqual([300, 300, 300]);
    expect([dungeonReward(2, 0.75), dungeonReward(2, 0.25), dungeonReward(1, 0.5)]).toEqual([425, 175, 175]);
  });
});

describe("0104: pets", () => {
  it("the sóc forages 150 a day while its owner moves", () => {
    expect(fnBody("pet_tick")).toContain(`v_done < ${FORAGE_DAY_CAP} then`);
    expect(fnBody("pet_tick")).toContain(`v_moved < now() - interval '${FORAGE_MOVE_S / 60} minutes'`);
    expect(SPECIES.soc.buff).toContain(`tối đa ${FORAGE_DAY_CAP} xu/ngày`);
  });
  it("PvE pays 5 wins at 60 %, PvP keeps 5 % of the pot", () => {
    expect(fnBody("_pv2")).toContain(`when 'pve_paid' then ${PVE_PAID_WINS} when`);
    expect(fnBody("_battle_finish")).toContain(`v_reward := 2 * b.stake - (2 * b.stake) / ${Math.round(1 / PVP_CUT)};`);
    expect(NPCS.map((n) => n.reward)).toEqual([24, 42, 54, 90, 150, 270]);
  });
});

describe("0104: travel", () => {
  it("teleport and xe ôm cost 50", () => {
    expect(fnBody("waypoint_travel")).toContain(`c_fee constant integer := ${TELEPORT_FEE};`);
    expect(fnBody("progress_state")).toContain(`'teleport_fee', ${TELEPORT_FEE},`);
    expect(fnBody("skip_trip")).toContain(`< ${SKIP_COST} then raise exception 'insufficient funds'`);
    expect(fnBody("skip_trip")).toContain(`-${SKIP_COST}, 'skip', 'xe om'`);
  });
});
