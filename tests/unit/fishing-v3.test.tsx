import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import BagPanel from "@/components/game/fishing/BagPanel";
import NotebookPanel from "@/components/game/fishing/NotebookPanel";
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { HeatActions } from "@/components/game/HeatHud";
import type { HeatView } from "@/hooks/useHeat";
import { describeItem, shopItemFromRow, speciesFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
import {
  BAIT_WEIGHT, EXTRA_CHANCE, expectedExtras, GROUNDBAIT_MINUTES, GROUNDBAIT_RADIUS_PX, GROUNDBAIT_WEIGHT, hoursText, KIT_WINDOW_MS,
  missingText, NO_BOBBER_WINDOW_MS, NO_REEL, ownedOfSlot, rigLines,
} from "@/lib/game/fishing/gear";
import { blockerText, extraText, lostText, NEEDS_PARTS, snapText } from "@/lib/game/fishing/messages";
import {
  finishCast, fishingEquip, fishingErrorMessage, parseNotebook, throwGroundbait, type Notebook,
} from "@/lib/game/fishing/rpc";
import { castBlocker, maxBuyQty, parseFishingState, rigOf } from "@/lib/game/fishing/state";

afterEach(cleanup);
beforeEach(() => {
  h.rpc.mockReset();
});

// 0110_fishing_v3.sql (Câu cá v3): every re-created function is its newest body plus the lines marked "-- 0110" (an added
// line), "-- 0110 {" … "-- 0110 }" (an added block), "… -- 0110 was: <old line>" (a changed one) — the convention of
// anticheat-v2-part3.test.ts and econ-fishing.test.ts — and the TS that mirrors its numbers.

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SQL = read("supabase/migrations/0110_fishing_v3.sql");
/** The migrations before 0110 in the production order (0014 before 0013), newest last. */
const EARLIER = readdirSync("supabase/migrations")
  .filter((f) => f.endsWith(".sql") && f.slice(0, 4) < "0110")
  .sort((a, b) => {
    const k = (f: string) => (f.slice(0, 4) === "0013" ? 14.5 : Number(f.slice(0, 4)));
    return k(a) - k(b) || a.localeCompare(b);
  });
const body = (s: string, sig: string) => {
  const from = s.indexOf(`create or replace function public.${sig}`);
  expect(from, sig).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};
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
const FINISH6 = "finish_cast(p_session_token text, p_cast_id uuid, p_success boolean,\n                                              p_hooked boolean default false";

describe("0110: every re-created function is its newest body plus the 0110 lines", () => {
  const cases: Array<[string, string]> = [
    ["_fishing_state(", "0034_rods_nets.sql"],
    ["buy_item(", "0098_fishing_kit.sql"],
    ["_cast_lift(", "0101_econ_fishing.sql"],
    ["start_cast(", "0101_econ_fishing.sql"],
    ["start_river_cast(", "0101_econ_fishing.sql"],
    ["start_river_cast_w(", "0101_econ_fishing.sql"],
    [FINISH6, "0101_econ_fishing.sql"],
    ["start_net(", "0059_reel_hook.sql"],
    ["net_haul(p_session_token text, p_throw_id uuid, p_press integer", "0101_econ_fishing.sql"],
  ];
  for (const [sig, from] of cases) {
    it(sig.slice(0, sig.indexOf("(")), () => {
      const [f, prev] = newest(sig);
      expect(f).toBe(from);
      expect(unmarked(body(SQL, sig), "0110")).toBe(prev);
      expect(body(SQL, sig)).toContain("-- 0110");
    });
  }
  it("the 6-argument finish_cast is the only one re-created (0108's 7-argument form calls it)", () => {
    expect(SQL.match(/create or replace function public\.finish_cast\(/g)).toHaveLength(1);
    expect(SQL).toContain(FINISH6);
  });
});

describe("0110: the casts", () => {
  for (const sig of ["start_cast(", "start_river_cast(", "start_river_cast_w("]) {
    it(`${sig.slice(0, -1)}: the parts' gate before anything is spent, the pick, the reel, the phao, the extras`, () => {
      const b = body(SQL, sig);
      const gate = b.indexOf("raise exception 'rod needs parts'");
      expect(gate).toBeGreaterThan(0);
      expect(gate).toBeLessThan(b.indexOf("update public.inventory set qty = qty - 1"));   // the bait
      expect(b).toContain("sp := public._species_pick(v_rarity, ");
      expect(b.indexOf("public._cast_lift(")).toBeGreaterThan(b.indexOf("public._species_pick("));
      expect(b).toContain("v_diff := greatest(1, least(100, sp.difficulty + (v_rig->>'reel_ease')::int));");
      expect(b).toContain("v_min_reel := round((2000 + 40 * v_diff) * (v_rig->>'reel_speed')::numeric)::int;");
      expect(b).toContain("'difficulty', v_diff, 'min_reel_ms', v_min_reel),");                // what the reel is replayed with
      expect(b).toContain("v_window := (v_rig->>'window_ms')::int;");
      expect(b).toContain("v_extra := public._cast_extras(");
      expect(b).toContain("public._groundbait_at(v_account, ");
    });
  }
  it("the extra hooks' odds, the reel and the phao without parts, the weights, the groundbait (lib/game/fishing/gear.ts)", () => {
    const extras = body(SQL, "_cast_extras(");
    expect(extras).toContain(`v_p := case when i = 2 then ${EXTRA_CHANCE[3][1]} when v_n >= 3 then ${EXTRA_CHANCE[3][0]} else ${EXTRA_CHANCE[2][0]} end;`);
    expect(EXTRA_CHANCE[1]).toEqual([]);
    expect(expectedExtras(3)).toBeCloseTo(0.21);
    const rig = body(SQL, "_fishing_rig(");
    expect(rig).toContain(`round(coalesce(r.reel_speed, ${NO_REEL.speed})::numeric, 2)`);
    expect(rig).toContain(`coalesce(r.reel_ease, ${NO_REEL.ease})`);
    expect(rig).toContain(`coalesce(b.window_ms, case when v_kit then ${KIT_WINDOW_MS} else ${NO_BOBBER_WINDOW_MS} end)`);
    const pick = body(SQL, "_species_pick(");
    expect(pick).toContain(`case when p_bait = any(h.baits) then ${BAIT_WEIGHT} else 1 end`);
    expect(pick).toContain(`case when p_gb = any(h.groundbaits) then ${GROUNDBAIT_WEIGHT} else 1 end`);
    expect(body(SQL, "_groundbait_at(")).toContain(`<= ${GROUNDBAIT_RADIUS_PX} * ${GROUNDBAIT_RADIUS_PX}`);
    expect(body(SQL, "throw_groundbait(")).toContain(`now() + interval '${GROUNDBAIT_MINUTES} minutes'`);
  });
  it("finish_cast: a won reel past the weakest part snaps it; the extras land within the rig and the bucket", () => {
    const b = body(SQL, FINISH6);
    expect(b).toContain("v_limit := least(coalesce(c.line_g, 2147483647), coalesce(c.rod_g, 2147483647));");
    expect(b).toContain("then 'line_snap' else 'rod_snap' end;");
    expect(b).toContain("perform public._rod_wear(v_account, v_rod, 1000000);");
    expect(b).toContain("v_line_gone := public._line_wear(v_account, c.line);");
    expect(b).toContain("exit when (select count(*) from public.fish where account_id = v_account) >= 1 + public._bucket_cap(v_account);");
    expect(b).toContain("continue when not found or (e->>'weight_g')::int > v_limit;");
    // the snap comes after every anti-cheat check (a snapped reel was an honest, won one)
    expect(b.indexOf("then 'line_snap' else 'rod_snap' end;")).toBeGreaterThan(b.indexOf("-- 0065 }"));
  });
  it("the new RPCs are guarded and the helpers private", () => {
    for (const sig of ["fishing_equip(", "throw_groundbait(", "fishing_notebook("]) expect(body(SQL, sig)).toContain("public._ac_account(");
    for (const f of ["_vn_hour()", "_fishing_rig(uuid)", "_fish_ok(text, text)", "_species_pick(integer, boolean, text, text, text, boolean)",
      "_net_pick(text, text)", "_groundbait_at(uuid, text, integer, integer)", "_line_wear(uuid, text)"]) {
      expect(SQL).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    }
    expect(SQL).toContain("revoke all on public.fish_habits from anon, authenticated;");
    expect(read("tests/sql/anticheat-guards.sql")).toContain("public.fishing_equip(");
  });
});

// ---------- the client ----------
const row = (id: string, kind: string, name: string, price: number | null, over: Partial<ShopItemRow> = {}): ShopItemRow => ({
  id, kind, name, price, starter: price === null && kind !== "bait", sort_order: 0, zone_pct: null, weight_k: null, rare_mult: 1,
  window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
  ...over,
});
const CATALOG: FishingCatalog = {
  species: [
    speciesFromRow({ id: "ca_ro", name: "Cá rô đồng", rarity: 1, min_g: 50, max_g: 300, price_per_kg: 40, difficulty: 15, sort_order: 10 }),
    speciesFromRow({ id: "tom_cang", name: "Tôm càng xanh", rarity: 3, min_g: 50, max_g: 300, price_per_kg: 129, difficulty: 62, sort_order: 90 }),
  ],
  items: [
    row("rod_wood", "rod", "Cần gỗ", null, { zone_pct: 25, weight_k: 2, sort_order: 10, rating_g: 1500, hook_class: "small", hook_count: 1, line_g: 3000 }),
    row("rod_carbon", "rod", "Cần carbon", 1500, { zone_pct: 36, weight_k: 1.5, rare_mult: 1.2, sort_order: 30, rating_g: 30000, durability: 300 }),
    row("hook_small", "hook", "Lưỡi đơn nhỏ", 20, { hook_class: "small", hook_count: 1, sort_order: 10 }),
    row("hook_triple", "hook", "Lưỡi ba", 1500, { hook_class: "large", hook_count: 3, sort_order: 60 }),
    row("line_03", "line", "Dây cước 0.3", 150, { line_g: 12000, durability: 3, sort_order: 20 }),
    row("reel_3000", "reel", "Máy xoay 3000", 400, { reel_speed: 0.9, reel_ease: -5, sort_order: 20 }),
    row("bobber_feather", "bobber", "Phao lông gà", null, { window_ms: 1500, bite_max_ms: 10000, sort_order: 10 }),
    row("bait_worm", "bait", "Trùn đất", null, { sort_order: 10 }),
    row("bait_bloodworm", "bait", "Mồi trùn chỉ", 3, { mult_hiem: 2, mult_quy: 2, mult_legend: 3, sort_order: 30 }),
    row("gb_tom", "groundbait", "Thính tôm khô", 15, { sort_order: 20 }),
    row("fishbook", "fishbook", "Sổ tay câu cá", 500, { sort_order: 10 }),
    row("net_cast", "net", "Lưới chài cước", 800, { durability: 40, radius_px: 36, rare_mult: 2 }),
  ].map(shopItemFromRow),
};
const RIG_BARE = { rod: "rod_carbon", kit: false, ready: false, missing: ["line"], hook: "hook_triple", hook_class: "large", hooks: 3,
  line: null, line_g: null, rod_g: 30000, reel: "reel_3000", reel_speed: 0.9, reel_ease: -5, bobber: null, window_ms: 700,
  bite_min_ms: 3000, bite_max_ms: 10000, shows_rarity: false };
const RAW = {
  coins: 2000,
  loadout: { rod: "rod_carbon", bobber: null, bait: "bait_worm", hook: "hook_triple", line: null, reel: "reel_3000" },
  owned: ["rod_carbon", "hook_triple", "hook_small", "line_03", "reel_3000"],
  bait: { bait_worm: 5, bait_bloodworm: 0 }, bait_cap: 20, fish: [], fish_cap: 1,
  wear: { rod_carbon: [300, 300], line_03: [2, 3] },
  groundbait: { gb_tom: 4 }, groundbait_on: { item: "gb_tom", map: "pond", x: 300, y: 204, until: "2026-09-30T07:10:00Z" },
  notebook: true, rig: RIG_BARE,
};
const STATE = parseFishingState(RAW)!;

describe("0110: the state and its rules", () => {
  it("parses the slots, an empty phao, the groundbait, the notebook and the rig", () => {
    expect(STATE.loadout).toEqual({ rod: "rod_carbon", bobber: null, bait: "bait_worm", hook: "hook_triple", line: null, reel: "reel_3000" });
    expect(STATE.groundbait).toEqual({ gb_tom: 4 });
    expect(STATE.groundbaitOn).toEqual({ item: "gb_tom", map: "pond", x: 300, y: 204, until: "2026-09-30T07:10:00Z" });
    expect(STATE.notebook).toBe(true);
    expect(STATE.rig).toMatchObject({ kit: false, ready: false, missing: ["line"], hookClass: "large", hooks: 3, lineG: null, rodG: 30000,
      reelSpeed: 0.9, reelEase: -5, windowMs: 700 });
    // a server before 0110: the old defaults
    const old = parseFishingState({ ...RAW, loadout: { rod: "rod_wood", bait: "bait_worm" }, rig: undefined, groundbait: undefined })!;
    expect(old.loadout.bobber).toBe("bobber_feather");
    expect(old.rig).toBeNull();
    expect(rigOf("x")).toBeNull();
  });
  it("a bare rod without its parts cannot cast, before anything else", () => {
    expect(castBlocker(STATE)).toBe("needs_parts");
    expect(blockerText("needs_parts", 0)).toBe(NEEDS_PARTS);
    expect(castBlocker({ ...STATE, rig: { ...STATE.rig!, ready: true, missing: [] } })).toBeNull();
    expect(missingText(STATE.rig)).toBe("Cần này còn thiếu dây câu — chưa quăng được.");
    expect(missingText({ ...STATE.rig!, missing: ["hook", "line"] })).toBe("Cần này còn thiếu lưỡi và dây câu — chưa quăng được.");
    expect(missingText({ ...STATE.rig!, ready: true })).toBeNull();
  });
  it("the rig in the bag's words", () => {
    expect(rigLines({ ...STATE.rig!, lineG: 12000 })).toEqual(["Lưỡi lớn · 3 mũi", "Dây chịu 12,0 kg", "Cần chịu 30,0 kg", "Thu cá nhanh hơn 10%", "Giật cần trong 0,7 giây"]);
    expect(rigLines({ ...STATE.rig!, kit: true, hookClass: "small", hooks: 1, lineG: 3000, rodG: null, reelSpeed: 1, windowMs: 1500 }))
      .toEqual(["Lưỡi nhỏ", "Dây chịu 3,0 kg", "Cần không gãy", "Giật cần trong 1,5 giây"]);
    expect(rigLines({ ...STATE.rig!, reelSpeed: 1.15 })).toContain("Không máy xoay: thu chậm hơn 15%");
  });
  it("groundbait comes by the bag, at most 99 of a kind", () => {
    const gb = CATALOG.items.find((i) => i.id === "gb_tom")!;
    expect(maxBuyQty(STATE, gb)).toBe(95);
    expect(maxBuyQty({ ...STATE, coins: 30 }, gb)).toBe(2);
  });
  it("the owned parts of a slot, cheapest first", () => {
    expect(ownedOfSlot("hook", CATALOG.items, STATE.owned).map((i) => i.id)).toEqual(["hook_small", "hook_triple"]);
    expect(ownedOfSlot("rod", CATALOG.items, STATE.owned).map((i) => i.id)).toEqual(["rod_wood", "rod_carbon"]);
  });
  it("the hours in words", () => {
    expect(hoursText(null)).toBe("cả ngày");
    expect(hoursText([5, 6, 7, 8, 9])).toBe("5h–10h");
    expect(hoursText([18, 19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5])).toBe("18h–6h");
    expect(hoursText([1, 2, 10])).toBe("1h–3h, 10h–11h");
  });
  it("the shop's lines for the parts", () => {
    const d = (id: string) => describeItem(CATALOG.items.find((i) => i.id === id)!);
    expect(d("rod_wood")).toContain("đủ bộ: Lưỡi nhỏ, dây 3,0 kg");
    expect(d("rod_carbon")).toContain("chịu 30,0 kg");
    expect(d("hook_triple")).toBe("Lưỡi lớn · 3 mũi — có khi dính 3 con");
    expect(d("line_03")).toBe("Chịu cá tới 12,0 kg · đứt 3 lần là hỏng");
    expect(d("reel_3000")).toBe("Thu cá nhanh hơn 10% · cá dễ kéo hơn 5 bậc");
    expect(d("gb_tom")).toContain("gấp 3");
    expect(d("fishbook")).toContain("giờ cắn câu");
    expect(d("net_cast")).toContain("dễ dính cá hiếm (12%)");
  });
});

describe("0110: the RPCs", () => {
  it("fishing_equip and throw_groundbait send their arguments", async () => {
    h.rpc.mockResolvedValue({ data: { state: RAW }, error: null });
    await fishingEquip("tok", "line", "line_03");
    expect(h.rpc).toHaveBeenLastCalledWith("fishing_equip", { p_session_token: "tok", p_slot: "line", p_item: "line_03" });
    await fishingEquip("tok", "bobber", null);
    expect(h.rpc).toHaveBeenLastCalledWith("fishing_equip", { p_session_token: "tok", p_slot: "bobber", p_item: null });
    await throwGroundbait("room", "tok", "gb_tom", { map: "pond", col: 37, row: 25 });
    expect(h.rpc).toHaveBeenLastCalledWith("throw_groundbait",
      { p_room_id: "room", p_session_token: "tok", p_item: "gb_tom", p_map: "pond", p_x: 37, p_y: 25 });
    await throwGroundbait("room", "tok", "gb_tom", { map: "wild", x: 424, y: 1900 });
    expect(h.rpc).toHaveBeenLastCalledWith("throw_groundbait",
      { p_room_id: "room", p_session_token: "tok", p_item: "gb_tom", p_map: "wild", p_x: 424, p_y: 1900 });
  });
  it("finish_cast: the extra fish and the snaps", async () => {
    h.rpc.mockResolvedValueOnce({ data: { result: "caught", record: false, state: RAW,
      fish: { id: "f1", species_id: "ca_ro", weight_g: 200, price: 8, rarity: 1 },
      extra: [{ id: "f2", species_id: "tom_cang", weight_g: 100, price: 13, rarity: 3 }] }, error: null });
    const a = await finishCast("tok", "c1", true);
    expect(a.result === "caught" && a.extra).toEqual([{ id: "f2", speciesId: "tom_cang", weightG: 100, price: 13, rarity: 3 }]);
    h.rpc.mockResolvedValueOnce({ data: { result: "lost", why: "line_snap", rod_broke: false, state: RAW,
      snap: { species_id: "ca_ro", weight_g: 3500, limit_g: 3000, line_gone: true } }, error: null });
    const b = await finishCast("tok", "c1", true);
    expect(b).toMatchObject({ result: "lost", why: "line_snap", snap: { speciesId: "ca_ro", weightG: 3500, limitG: 3000, lineGone: true } });
    h.rpc.mockResolvedValueOnce({ data: { result: "lost", why: "rod_snap", rod_broke: true, state: RAW,
      snap: { species_id: "ca_ro", weight_g: 40000, limit_g: 30000, line_gone: false } }, error: null });
    expect(await finishCast("tok", "c1", true)).toMatchObject({ result: "lost", why: "rod_snap", rodBroke: true });
  });
  it("the notebook's answer", () => {
    const n = parseNotebook({ hour: 21, species: [{ id: "tom_cang", hook: "shrimp", baits: ["bait_bloodworm"], groundbaits: ["gb_tom"],
      hours: null, note: "Tôm càng chỉ mắc lưỡi tôm." }, { id: "x", hook: null, baits: "bad", hours: [1, "2"] }] });
    expect(n).toEqual({ hour: 21, species: [
      { id: "tom_cang", hook: "shrimp", baits: ["bait_bloodworm"], groundbaits: ["gb_tom"], hours: null, note: "Tôm càng chỉ mắc lưỡi tôm." },
      { id: "x", hook: null, baits: [], groundbaits: [], hours: [1], note: "" }] });
  });
  it("Vietnamese texts for the new refusals, snaps and extras", () => {
    expect(fishingErrorMessage({ message: "rod needs parts" })).toBe(NEEDS_PARTS);
    expect(fishingErrorMessage({ message: "no notebook" })).toContain("Sổ tay câu cá");
    expect(fishingErrorMessage({ message: "no groundbait" })).toContain("Hết thính");
    expect(fishingErrorMessage({ message: "groundbait full" })).toContain("99");
    const snap = { speciesId: "ca_ro", weightG: 3500, limitG: 3000, lineGone: false };
    expect(snapText("line_snap", snap, "Cá rô")).toBe("🧵 Cá rô nặng 3,5 kg làm đứt dây (dây chịu 3,0 kg) — cá thoát mất!");
    expect(snapText("line_snap", { ...snap, lineGone: true }, "Cá rô")).toContain("dây câu hỏng hẳn");
    expect(snapText("rod_snap", snap, "Cá rô")).toContain("bẻ gãy cần");
    expect(lostText("reel", "rod_snap", 1, snap, "Cá rô")).toContain("bẻ gãy cần");
    expect(lostText("reel", "line_snap", 1)).toContain("Con cá quá nặng");
    expect(extraText(["Cá rô", "Tôm càng xanh"])).toBe("🎣 Lưỡi nhiều mũi dính thêm 2 con: Cá rô, Tôm càng xanh!");
  });
});

describe("0110: the panels", () => {
  it("the bag mounts and unmounts the parts, warns of the missing line, throws and picks groundbait, opens the notebook", () => {
    const onEquip = vi.fn(), onGroundbait = vi.fn(), onPick = vi.fn(), onNotebook = vi.fn();
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={onEquip} onRelease={() => {}} onClose={() => {}}
      groundbaitPick={null} onPickGroundbait={onPick} onGroundbait={onGroundbait} onNotebook={onNotebook} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Cần này còn thiếu dây câu — chưa quăng được.");
    expect(screen.getByTestId("rig-summary")).toHaveTextContent("Lưỡi lớn · 3 mũi");
    const li = (name: string) => screen.getByText(name).closest("li")!;
    fireEvent.click(within(li("Dây cước 0.3")).getByRole("button", { name: "Lắp" }));
    expect(onEquip).toHaveBeenLastCalledWith("line", "line_03");
    fireEvent.click(within(li("Lưỡi ba")).getByRole("button", { name: "Tháo" }));
    expect(onEquip).toHaveBeenLastCalledWith("hook", null);
    fireEvent.click(within(li("Lưỡi đơn nhỏ")).getByRole("button", { name: "Lắp" }));
    expect(onEquip).toHaveBeenLastCalledWith("hook", "hook_small");
    fireEvent.click(within(li("Cần gỗ")).getByRole("button", { name: "Dùng" }));
    expect(onEquip).toHaveBeenLastCalledWith("rod", "rod_wood");
    // no phao mounted: the feather is offered
    fireEvent.click(within(li("Phao lông gà")).getByRole("button", { name: "Lắp" }));
    expect(onEquip).toHaveBeenLastCalledWith("bobber", "bobber_feather");
    fireEvent.click(within(li("Thính tôm khô × 4")).getByRole("button", { name: "Rải" }));
    expect(onGroundbait).toHaveBeenCalledWith("gb_tom");
    fireEvent.click(within(li("Thính tôm khô × 4")).getByRole("button", { name: "Chọn" }));
    expect(onPick).toHaveBeenCalledWith("gb_tom");
    expect(screen.getByText(/Thính tôm khô đang tỏa mùi · tới 14:10/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Mở sổ tay" }));
    expect(onNotebook).toHaveBeenCalled();
  });
  it("the shop sells the parts under their headings, groundbait by the bag", () => {
    const onBuy = vi.fn();
    render(<ShopPanel state={STATE} catalog={CATALOG} busy={false} onBuy={onBuy} onClose={() => {}} />);
    for (const t of ["Cần câu", "Lưỡi câu", "Dây câu", "Máy xoay", "Thính", "Lưới", "Sổ tay"]) expect(screen.getByText(t)).toBeInTheDocument();
    const tile = (name: string) => screen.getByText(name).closest("li")!;
    expect(within(tile("Lưỡi ba")).getByRole("button", { name: "Đã có" })).toBeDisabled();
    fireEvent.click(within(tile("Sổ tay câu cá")).getByRole("button", { name: "Mua" }));
    expect(onBuy).toHaveBeenLastCalledWith("fishbook", 1);
    const gb = tile("Thính tôm khô");
    fireEvent.click(within(gb).getByRole("button", { name: "5" }));
    fireEvent.click(within(gb).getByRole("button", { name: "Mua 5 · 75 xu" }));
    expect(onBuy).toHaveBeenLastCalledWith("gb_tom", 5);
    expect(screen.getByText(/Cần bán trơn/)).toBeInTheDocument();
  });
  it("the notebook shows the habits, or names and prices alone without it", async () => {
    const book: Notebook = { hour: 21, species: [
      { id: "ca_ro", hook: null, baits: ["bait_worm"], groundbaits: [], hours: null, note: "Rô đồng háu ăn." },
      { id: "tom_cang", hook: "shrimp", baits: ["bait_bloodworm"], groundbaits: ["gb_tom"], hours: [5, 6], note: "" },
    ] };
    render(<NotebookPanel catalog={CATALOG} load={() => Promise.resolve(book)} onClose={() => {}} />);
    const tom = await screen.findByTestId("habit-tom_cang");
    expect(tom).toHaveTextContent("Cần lưỡi tôm · Mồi: Mồi trùn chỉ · Thính: Thính tôm khô · Giờ cắn: 5h–7h");
    expect(within(tom).queryByTitle("Đang cắn câu")).toBeNull();
    const ro = screen.getByTestId("habit-ca_ro");
    expect(ro).toHaveTextContent("Lưỡi nào cũng được · Mồi: Trùn đất · Thính: — · Giờ cắn: cả ngày");
    expect(within(ro).getByTitle("Đang cắn câu")).toBeInTheDocument();
    cleanup();
    render(<NotebookPanel catalog={CATALOG} load={() => Promise.resolve(null)} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/Chưa có sổ tay/)).toBeInTheDocument());
    expect(screen.getByTestId("habit-tom_cang")).not.toHaveTextContent("Giờ cắn");
  });
  it("the pond edge offers 🌾 Rải thính at its cell", () => {
    const onGroundbait = vi.fn();
    const heat = { probe: { edge: { col: 37, row: 25 }, rescue: null }, busy: false, jump: () => {}, warmUp: () => {}, rescue: () => {},
      chips: [] } as unknown as HeatView;
    render(<HeatActions heat={heat} hidden={false} onGroundbait={onGroundbait} />);
    fireEvent.click(screen.getByRole("button", { name: /Rải thính/ }));
    expect(onGroundbait).toHaveBeenCalledWith({ col: 37, row: 25 });
  });
});
