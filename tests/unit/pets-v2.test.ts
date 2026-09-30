import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { petPixels } from "@/lib/game/art/pets";
import { FURNITURE } from "@/lib/game/housing/apartment";
import { encodePet, parsePetCode, type PetLook } from "@/lib/game/pets/model";
import { parsePetsState } from "@/lib/game/pets/rpc";
import {
  AQUA_DECOR, battleDmg, DAY_XP, evolveNeeds, FISH_FIGHTER_RARITY, GACHA_PITY, GACHA_POOLS, GACHA_PRICE, logText, MAX_DECOR,
  MAX_FISH_FIGHTERS, MAX_LEVEL, MAX_PETS_V2, MAX_STAKE, MAX_TURNS, NPCS, parseAquaView, parseBattleState, PVE_PAID_WINS, PVE_PER_DAY,
  RARITIES, SKILLS, trainCap, trainCost, v2ErrorMessage, xpNeed,
} from "@/lib/game/pets/v2";

const SQL = readFileSync("supabase/migrations/0074_pets_aquarium.sql", "utf8").replace(/\r\n/g, "\n");
/** Economy v2 re-made _pv2 (5 paid PvE wins) and the NPCs' prizes (× 0.6): the newest copies. */
const SQL104 = readFileSync("supabase/migrations/0104_econ_rewards.sql", "utf8").replace(/\r\n/g, "\n");

describe("v21 pets: the TS rules mirror 0074", () => {
  it("the _pv2 literals", () => {
    const pv2 = (k: string) => Number(new RegExp(`when '${k}' then (\\d+)`).exec(SQL104)?.[1]);
    expect(pv2("gacha_price")).toBe(GACHA_PRICE);
    expect(pv2("pity")).toBe(GACHA_PITY);
    expect(pv2("max_pets")).toBe(MAX_PETS_V2);
    expect(pv2("max_level")).toBe(MAX_LEVEL);
    expect(pv2("day_xp")).toBe(DAY_XP);
    expect(pv2("max_fish")).toBe(MAX_FISH_FIGHTERS);
    expect(pv2("fish_rarity")).toBe(FISH_FIGHTER_RARITY);
    expect(pv2("pve_day")).toBe(PVE_PER_DAY);
    expect(pv2("pve_paid")).toBe(PVE_PAID_WINS);
    expect(pv2("max_stake")).toBe(MAX_STAKE);
    expect(pv2("max_decor")).toBe(MAX_DECOR);
    expect(pv2("max_turns")).toBe(MAX_TURNS);
  });
  it("xp, training, evolution and the odds", () => {
    expect(SQL).toContain("select 20 * p_level");
    expect(xpNeed(7)).toBe(140);
    expect(SQL).toContain("v_cost := 100 + 50 * v_pts;");
    expect(trainCost(3)).toBe(250);
    expect(SQL).toContain("v_pts >= least(30, 5 + v_lv)");
    expect(trainCap(30)).toBe(30);
    expect(SQL).toContain("p.level < (case p.form when 0 then 10 else 25 end)");
    expect(SQL).toContain("p.affection < (case p.form when 0 then 40 else 80 end)");
    expect(evolveNeeds(0)).toEqual({ level: 10, affection: 40 });
    expect(evolveNeeds(1)).toEqual({ level: 25, affection: 80 });
    expect(evolveNeeds(2)).toBeNull();
    expect(SQL).toContain("when p_r < 0.005 then 5 when p_r < 0.03 then 4 when p_r < 0.13 then 3 when p_r < 0.40 then 2 else 1");
    let acc = 0;
    const edges = [...RARITIES].reverse().map((r) => (acc += r.odds));
    expect(edges.map((e) => Math.round(e * 1000) / 1000)).toEqual([0.005, 0.03, 0.13, 0.4, 1]);
    expect(SQL).toContain("v_pool := case v_tier when 1 then array['hamster','tho'] when 2 then array['soc','meo'] when 3 then array['cho','vet']");
    expect([GACHA_POOLS[1], GACHA_POOLS[2], GACHA_POOLS[3]]).toEqual([["hamster", "tho"], ["soc", "meo"], ["cho", "vet"]]);
  });
  it("the skill, NPC and decor catalogs are the SQL rows", () => {
    const skills = [...SQL.matchAll(/\('([a-z]+)', '([^']+)', '(hit|guard|heal)', (\d+), (\d+), (\d+), (\d+), (\d+), '(pet|fish|both)', \d+\)/g)]
      .map((m) => ({ id: m[1], name: m[2], kind: m[3], power: +m[4], acc: +m[5], minLevel: +m[6], minForm: +m[7], price: +m[8], who: m[9] }));
    expect(skills).toEqual(SKILLS);
    const npcs = [...SQL104.matchAll(/\('([a-z_]+)', '([^']+)', '(wild|trainer)', '([a-z]+)', '([a-z]+)', (\d+), (\d+), (\d+), (\d+), (\d+), '\{([a-z,]+)\}', (\d+), \d+\)/g)]
      .map((m) => ({ id: m[1], name: m[2], kind: m[3], species: m[4], variant: m[5], level: +m[6], hp: +m[7], atk: +m[8], def: +m[9], spd: +m[10], skills: m[11].split(","), reward: +m[12] }));
    expect(npcs).toEqual(NPCS);
    for (const d of AQUA_DECOR) expect(SQL).toContain(`when '${d.id}' then ${d.price}`);
  });
  it("the damage formula is _battle_dmg's", () => {
    expect(battleDmg(10, 10, 10, 0.5, false, false)).toBe(11);
    expect(battleDmg(10, 10, 10, 0.5, true, false)).toBe(17);
    expect(battleDmg(10, 10, 10, 0.5, false, true)).toBe(4);
    expect(battleDmg(1, 1, 1000, 0, false, true)).toBe(1);
  });
  it("the new furniture rows are the TS catalogue's tail", () => {
    const from = SQL.indexOf("insert into public.furniture_catalog");
    const block = SQL.slice(from, SQL.indexOf("on conflict", from));
    const rows = [...block.matchAll(/\('([a-z_]+)', '([^']+)', '([a-z]+)', '([a-z_]+)', (\d), (\d), (\d+), (\d+)\)/g)].map((m) => ({
      id: m[1], name: m[2], kind: m[3], style: m[4], w: Number(m[5]), h: Number(m[6]), price: Number(m[7]), cap: Number(m[8]),
    }));
    expect(rows.length).toBe(17);
    expect(rows).toEqual(FURNITURE.slice(-rows.length).map((f) => ({ ...f, cap: f.cap ?? 0 })));
  });
});

describe("v21 pets: parsing and the pt code", () => {
  it("the evolved form travels in the pt code (and the old 6-part code still parses)", () => {
    const look: PetLook = { species: "cho", variant: "vang", head: null, neck: null, body: null, happy: true, form: 2 };
    expect(encodePet(look)).toBe("cho.vang.0.0.0.1.2");
    expect(parsePetCode("cho.vang.0.0.0.1.2")).toEqual(look);
    expect(parsePetCode("cho.vang.0.0.0.1")?.form).toBeUndefined();
    expect(parsePetCode("cho.vang.0.0.0.1.3")).toBeNull();
    expect(encodePet({ ...look, form: 0 })).toBe("cho.vang.0.0.0.1");
  });
  it("each form draws differently", () => {
    const base: PetLook = { species: "meo", variant: "cam", head: null, neck: null, body: null, happy: true };
    const a = JSON.stringify(petPixels(base, "down", 0));
    const b = JSON.stringify(petPixels({ ...base, form: 1 }, "down", 0));
    const c = JSON.stringify(petPixels({ ...base, form: 2 }, "down", 0));
    expect(new Set([a, b, c]).size).toBe(3);
  });
  it("the v2 pet fields and the battle state", () => {
    const s = parsePetsState({ pets: [{ id: 1, species: "tho", variant: "nau", name: "Bé", fullness: 50, happy: 60, rarity: 4, level: 7, xp: 3, xp_need: 140,
      affection: 22, form: 1, skills: ["tackle", "bite"], trn: { hp: 1, atk: 2, def: 0, spd: 0 }, stats: { hp: 70, atk: 20, def: 12, spd: 22 } }], pity: 5, xp_today: 12 });
    expect(s.pets[0]).toMatchObject({ rarity: 4, level: 7, xpNeed: 140, affection: 22, form: 1, skills: ["tackle", "bite"], stats: { hp: 70 } });
    expect([s.pity, s.xpToday]).toEqual([5, 12]);
    const b = parseBattleState({
      battle: null,
      battle_now: { id: 9, mode: "pve", status: "done", side: 1, turn: 4, winner: 1, reward: 40, f1: { kind: "pet", id: 1, name: "Bé", species: "tho", hp: 70 },
        f2: { kind: "npc", id: "meo_hoang", name: "Mèo hoang", species: "meo", hp: 60 }, hp1: 30, hp2: 0,
        log: [{ who: 1, skill: "bite", dmg: 17, crit: true }, { who: 2, skill: "tackle", miss: true }] },
      incoming: [{ id: 3, from: "an", stake: 100 }], fish: [], rivals: [{ id: "u", name: "an" }],
    });
    expect(b.battle).toBeNull();
    expect(b.last?.winner).toBe(1);
    expect(logText(b.last!.log[0], ["Bé", "Mèo hoang"])).toBe("Bé dùng Cắn: −17 (chí mạng!)");
    expect(logText(b.last!.log[1], ["Bé", "Mèo hoang"])).toBe("Mèo hoang dùng Húc — trượt!");
    expect(b.incoming).toEqual([{ id: 3, from: "an", stake: 100 }]);
    const v = parseAquaView({ tanks: [{ tank: 5, item: "aquarium", cap: 4, placed: true, decor: ["rong"], fish: [{ id: null, species_id: "ca_ho", weight_g: 9000, rarity: 5 }] }], showcase: [] });
    expect(v.tanks[0]).toMatchObject({ tank: 5, cap: 4, decor: ["rong"], fish: [{ id: null, speciesId: "ca_ho", rarity: 5 }] });
  });
  it("Vietnamese errors", () => {
    expect(v2ErrorMessage("not rare")).toContain("cá hiếm");
    expect(v2ErrorMessage("affection too low")).toContain("thân thiết");
    expect(v2ErrorMessage("tank full")).toBe("Bể đầy rồi.");
  });
});
