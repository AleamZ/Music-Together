import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import BagPanel from "@/components/game/fishing/BagPanel";
import RodBuilds, { partsFor, rodName } from "@/components/game/fishing/RodBuilds";
import ShopPanel from "@/components/game/fishing/ShopPanel";
import type { RodActions } from "@/hooks/useFishingController";
import { rodLookOf } from "@/lib/game/diorama/character/held";
import { shopItemFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
import { mountWarning, rigLimitG, rodSummary } from "@/lib/game/fishing/gear";
import { fishingErrorMessage, rodEquip, rodMount, rodRepair, rodUnmount } from "@/lib/game/fishing/rpc";
import {
  equippedRod, maxBuyQty, ownsItem, parseFishingState, partCount, rodOf, ROD_MAX, wornRods,
} from "@/lib/game/fishing/state";

// 0115_rod_builds.sql: rods are instances with their own bound parts. The parsers, the RPCs' arguments, the bag's
// Cần câu builder, chú Tư's per-rod repair, the 3D rod's look, and the migration's pins.

afterEach(cleanup);
beforeEach(() => h.rpc.mockReset());

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SQL = read("supabase/migrations/0115_rod_builds.sql");
const body = (s: string, sig: string) => {
  const from = s.indexOf(`create or replace function public.${sig}`);
  expect(from, sig).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", from) + 3);
};

const row = (id: string, kind: string, name: string, price: number | null, over: Partial<ShopItemRow> = {}): ShopItemRow => ({
  id, kind, name, price, starter: price === null && kind !== "bait", sort_order: 0, zone_pct: null, weight_k: null, rare_mult: 1,
  window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
  ...over,
});
const CATALOG: FishingCatalog = {
  species: [],
  items: [
    row("rod_wood", "rod", "Cần gỗ", null, { sort_order: 10, hook_class: "small", hook_count: 1, line_g: 3000 }),
    row("rod_bamboo", "rod", "Cần tre", 300, { sort_order: 20, rating_g: 6000, durability: 120 }),
    row("hook_small", "hook", "Lưỡi đơn nhỏ", 20, { hook_class: "small", hook_count: 1 }),
    row("hook_large", "hook", "Lưỡi đơn lớn", 100, { hook_class: "large", hook_count: 1 }),
    row("line_02", "line", "Dây cước 0.2", 40, { line_g: 4000, durability: 3 }),
    row("reel_3000", "reel", "Máy xoay 3000", 400, { reel_speed: 0.9, reel_ease: -5 }),
    row("bobber_feather", "bobber", "Phao lông gà", null, { window_ms: 1500 }),
    row("bait_worm", "bait", "Trùn đất", null),
  ].map(shopItemFromRow),
};
const RIG = (over: Record<string, unknown> = {}) => ({ rod: "rod_bamboo", kit: false, ready: true, missing: [], hook_class: "small",
  hooks: 1, line_g: 4000, rod_g: 6000, reel_speed: 0.9, reel_ease: -5, window_ms: 1500, shows_rarity: false, ...over });
const RODS = [
  { id: 1, item: "rod_wood", name: null, durability: null, max_durability: null, kit: true, equipped: false,
    parts: { bobber: { item: "bobber_feather", durability: null, max_durability: null } },
    rig: RIG({ rod: "rod_wood", kit: true, line_g: 3000, rod_g: null, reel_speed: 1 }) },
  { id: 7, item: "rod_bamboo", name: "Cần săn lóc", durability: 80, max_durability: 120, kit: false, equipped: true,
    parts: { hook: { item: "hook_small", durability: null, max_durability: null }, line: { item: "line_02", durability: 2, max_durability: 3 },
             reel: { item: "reel_3000", durability: null, max_durability: null } },
    rig: RIG() },
  { id: 9, item: "rod_bamboo", name: null, durability: 120, max_durability: 120, kit: false, equipped: false, parts: {},
    rig: RIG({ ready: false, missing: ["hook", "line"], line_g: null, reel_speed: 1.15, window_ms: 700 }) },
];
const RAW = {
  coins: 1000, loadout: { rod: "rod_bamboo", bobber: null, bait: "bait_worm", hook: "hook_small", line: "line_02", reel: "reel_3000" },
  owned: ["hook_large", "line_02"], bait: { bait_worm: 3 }, bait_cap: 20, fish: [], fish_cap: 1, wear: {},
  rig: RODS[1].rig, rod_id: 7, rods: RODS, parts: { hook_large: 2, line_02: 1 },
};
const STATE = parseFishingState(RAW)!;
const actions = (): RodActions & { [k: string]: ReturnType<typeof vi.fn> } => ({
  mount: vi.fn(), unmount: vi.fn(), equip: vi.fn(), rename: vi.fn(), scrap: vi.fn(), repair: vi.fn(),
});

describe("0115: the state", () => {
  it("parses the rods, the equipped one and the bag's parts", () => {
    expect(STATE.rodId).toBe(7);
    expect(STATE.rods).toHaveLength(3);
    expect(equippedRod(STATE)).toMatchObject({ id: 7, name: "Cần săn lóc", durability: 80, maxDurability: 120,
      parts: { line: { item: "line_02", durability: 2, maxDurability: 3 } } });
    expect(STATE.rods![0]).toMatchObject({ kit: true, parts: { bobber: { item: "bobber_feather" } } });
    expect(partCount(STATE, "hook_large")).toBe(2);
    expect(rodOf({ id: "x" })).toBeNull();
    expect(rodOf({ id: 3, item: "rod_bamboo", parts: { hook: { item: 5 } } })).toMatchObject({ parts: {}, rig: null });
    // a server before 0115: no rods (the old bag stays)
    expect(parseFishingState({ ...RAW, rods: undefined })!.rods).toBeUndefined();
  });
  it("rods and parts are bought again and again (instances, stacks)", () => {
    const bamboo = CATALOG.items.find((i) => i.id === "rod_bamboo")!, hook = CATALOG.items.find((i) => i.id === "hook_large")!;
    expect(ownsItem(STATE, bamboo)).toBe(false);
    expect(maxBuyQty(STATE, bamboo)).toBe(1);
    expect(maxBuyQty({ ...STATE, rods: Array(ROD_MAX).fill(STATE.rods![2]) }, bamboo)).toBe(0);
    expect(maxBuyQty(STATE, hook)).toBe(1);
    expect(maxBuyQty({ ...STATE, parts: { hook_large: 99 } }, hook)).toBe(0);
    expect(wornRods(STATE).map((r) => r.id)).toEqual([7]);
  });
  it("the card's texts", () => {
    const rig = equippedRod(STATE)!.rig!;
    expect(rigLimitG(rig)).toBe(4000);
    expect(rodSummary(rig)).toBe("Chịu tối đa 4,0 kg · Lưỡi nhỏ · Kéo nhanh hơn 10% · Giật cần trong 1,5 giây");
    expect(rodSummary(STATE.rods![2].rig!)).toContain("Kéo chậm hơn 15%");
    expect(mountWarning("Lưỡi đơn lớn", "Cần tre", "Lưỡi đơn nhỏ")).toBe(
      "Lưỡi đơn lớn sẽ gắn chặt vào Cần tre, không tháo sang cần khác được. Lưỡi đơn nhỏ cũ sẽ bị bỏ.");
    expect(rodName(STATE.rods![2], CATALOG.items)).toBe("Cần tre");
    expect(partsFor("bobber", STATE, CATALOG.items).map((i) => i.id)).toEqual(["bobber_feather"]);
    expect(partsFor("hook", STATE, CATALOG.items).map((i) => i.id)).toEqual(["hook_large"]);
  });
  it("the 3D rod reads the equipped instance", () => {
    expect(rodLookOf(equippedRod(STATE))).toEqual({ rod: "rod_bamboo", reel: "reel_3000", bobber: null });
    expect(rodLookOf(null)).toBeNull();
  });
});

describe("0115: the RPCs", () => {
  it("send their arguments and parse the answer", async () => {
    h.rpc.mockResolvedValue({ data: { rods: RODS, state: RAW, destroyed: "hook_small" }, error: null });
    const r = await rodMount("tok", 7, "hook", "hook_large");
    expect(h.rpc).toHaveBeenLastCalledWith("rod_mount", { p_session_token: "tok", p_rod: 7, p_slot: "hook", p_item: "hook_large" });
    expect(r.destroyed).toBe("hook_small");
    expect(r.rods).toHaveLength(3);
    await rodUnmount("tok", 7, "reel");
    expect(h.rpc).toHaveBeenLastCalledWith("rod_unmount", { p_session_token: "tok", p_rod: 7, p_slot: "reel" });
    await rodEquip("tok", null);
    expect(h.rpc).toHaveBeenLastCalledWith("rod_equip", { p_session_token: "tok", p_rod: null });
    h.rpc.mockResolvedValue({ data: { rods: RODS, state: RAW, cost: 90 }, error: null });
    expect((await rodRepair("tok", 7)).cost).toBe(90);
  });
  it("Vietnamese refusals", () => {
    expect(fishingErrorMessage({ message: "rod fixed" })).toContain("Cần gỗ");
    expect(fishingErrorMessage({ message: "rod build" })).toContain("từng cây cần");
    expect(fishingErrorMessage({ message: "rod not found" })).toContain("cây cần");
    expect(fishingErrorMessage({ message: "bag full" })).toContain("20 cần");
  });
});

describe("0115: the panels", () => {
  it("the bag: a card per rod, a slot picks a part from the bag, binding and replacing ask first", () => {
    const a = actions();
    render(<BagPanel state={STATE} catalog={CATALOG} busy={false} onEquip={() => {}} onRelease={() => {}} onClose={() => {}} rods={a} />);
    const eq = screen.getByTestId("rod-7");
    expect(within(eq).getByText("✓ Đang dùng")).toBeInTheDocument();
    expect(within(eq).getByTestId("rod-summary")).toHaveTextContent("Chịu tối đa 4,0 kg");
    // replace the hook: the picker, then the warning (bound, the old one thrown away), then the mount
    fireEvent.click(within(eq).getByRole("button", { name: /^Lưỡi: Lưỡi đơn nhỏ/ }));
    fireEvent.click(within(eq).getByRole("button", { name: /Lưỡi đơn lớn × 2/ }));
    expect(a.mount).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Lưỡi đơn nhỏ cũ sẽ bị bỏ");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Lắp" }));
    expect(a.mount).toHaveBeenCalledWith(7, "hook", "hook_large");
    // take the reel off: destroyed, asks first
    fireEvent.click(within(eq).getByRole("button", { name: /^Máy xoay: Máy xoay 3000/ }));
    fireEvent.click(within(eq).getByRole("button", { name: "Tháo (bỏ đi)" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("sẽ bị bỏ, không về giỏ");
    fireEvent.click(screen.getByRole("button", { name: "Tháo và bỏ" }));
    expect(a.unmount).toHaveBeenCalledWith(7, "reel");
    // the kit: hook / line / reel fixed; another rod is equipped by its button
    const kit = screen.getByTestId("rod-1");
    expect(within(kit).getByRole("button", { name: /^Lưỡi: có sẵn/ })).toBeDisabled();
    fireEvent.click(within(screen.getByTestId("rod-9")).getByRole("button", { name: "Dùng cây này" }));
    expect(a.equip).toHaveBeenCalledWith(9);
    expect(within(screen.getByTestId("rod-9")).getByRole("alert")).toHaveTextContent("còn thiếu lưỡi và dây câu");
  });
  it("a part dropped on a slot asks to bind it", () => {
    const a = actions();
    render(<RodBuilds state={STATE} items={CATALOG.items} busy={false} actions={a} />);
    const slot = within(screen.getByTestId("rod-9")).getByRole("button", { name: /^Lưỡi: — trống —/ }).closest("li")!;
    const data = { getData: () => "hook_large", setData: () => {} };
    fireEvent.drop(slot, { dataTransfer: data });
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Lưỡi đơn lớn sẽ gắn chặt vào Cần tre");
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Lắp" }));
    expect(a.mount).toHaveBeenCalledWith(9, "hook", "hook_large");
  });
  it("chú Tư repairs one rod instance", () => {
    const onRepairRod = vi.fn();
    render(<ShopPanel state={STATE} catalog={CATALOG} busy={false} onBuy={() => {}} onRepairRod={onRepairRod} onClose={() => {}} />);
    const btn = screen.getByRole("button", { name: /Sửa · 90/ });
    fireEvent.click(btn);
    expect(onRepairRod).toHaveBeenCalledWith(7, "Cần săn lóc");
    expect(screen.getAllByText(/Trong giỏ: 2 cây/).length).toBeGreaterThan(0);
  });
});

describe("0115: the migration", () => {
  it("every player RPC is rate-guarded, granted, and in the guards' loop", () => {
    const guards = read("tests/sql/anticheat-guards.sql");
    for (const sig of ["rod_list(", "rod_mount(", "rod_unmount(", "rod_equip(", "rod_rename(", "rod_scrap(", "rod_repair("]) {
      expect(body(SQL, sig)).toContain("public._ac_account(p_session_token)");
      expect(guards).toContain(`public.${sig}`);
    }
    expect(guards).toContain("assert n = 104");
    for (const t of ["rods", "rod_parts"]) {
      expect(SQL).toContain(`alter table public.${t} enable row level security;`);
      expect(SQL).toContain(`revoke all on public.${t} from anon, authenticated;`);
    }
  });
  it("binds under the account's and the rod's row locks; repair pays via _pay", () => {
    expect(body(SQL, "rod_mount(")).toContain("p := public._fishing_profile(v_account);");
    expect(body(SQL, "_rod_mine(")).toContain("for update");
    expect(body(SQL, "_rod_repair(")).toContain("perform public._pay(p_account, -v_cost, 'repair'");
    expect(SQL).not.toMatch(/insert into public\.coin_ledger/);
  });
  it("the mailbox makes rods instances", () => {
    expect(body(SQL, "_mail_claim_one(")).toContain("perform public._rod_add(p_account, r.ref) from generate_series(1, r.qty);");
  });
});
