import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import CoopPanel from "@/components/game/farm/CoopPanel";
import DryingPanel from "@/components/game/farm/DryingPanel";
import FarmShopPanel from "@/components/game/farm/FarmShopPanel";
import RiceDepotPanel from "@/components/game/farm/RiceDepotPanel";
import ShopPanel from "@/components/game/fishing/ShopPanel";
import { plotActions } from "@/lib/game/farm/actions";
import { DRYING_SLOTS, farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { HOUR_MS } from "@/lib/game/farm/crop";
import { parseFieldState, type CropView, type FarmMine, type FieldState, type PlotView } from "@/lib/game/farm/state";
import { canHook, type CastInfo } from "@/lib/game/fishing/cast";
import { shopItemFromRow, type FishingCatalog, type ShopItemRow } from "@/lib/game/fishing/catalog";
import { createReel, stepReel, zoneHeight, type ReelParams } from "@/lib/game/fishing/reel";
import { parseFishingState } from "@/lib/game/fishing/state";
import { FIELD_PLOTS } from "@/lib/game/maps/field";
import { getMap } from "@/lib/game/maps/registry";
import fixtures from "@/tests/fixtures/upland-cases.json";

// One test per hard signal of the anti-cheat layer (spec §7.2, §15.2). Each pins the client code that keeps an honest
// player from ever sending what the server strikes: if one fails, a player could be struck without cheating.

const rpc = vi.hoisted(() => ({
  fetchFieldState: vi.fn(), fetchFarmCatalog: vi.fn(), fieldAction: vi.fn(), sellRice: vi.fn(), buyFarmItem: vi.fn(),
  claimFarmGift: vi.fn(),
}));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import { useFarmController, WORK_MS } from "@/hooks/useFarmController";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * HOUR_MS).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const AN = { id: "an", name: "An" };
const noop = () => {};

// --- the fishing shop
const row = (id: string, kind: string, name: string, price: number | null, over: Partial<ShopItemRow> = {}): ShopItemRow => ({
  id, kind, name, price, starter: price === null && kind !== "bait", sort_order: 0, zone_pct: null, weight_k: null, rare_mult: 1,
  window_ms: null, bite_min_ms: null, bite_max_ms: null, shows_rarity: false, mult_hiem: 1, mult_quy: 1, mult_legend: 1, capacity: null,
  ...over,
});
const FISHING: FishingCatalog = {
  species: [],
  items: [
    row("rod_bamboo", "rod", "Cần tre", 300, { zone_pct: 30, weight_k: 1.5 }),
    row("bobber_foam", "bobber", "Phao xốp", 150, { window_ms: 2000, bite_max_ms: 10000, shows_rarity: true }),
    row("bait_shrimp", "bait", "Mồi tép", 5),
    row("bucket_small", "bucket", "Xô nhỏ", 200, { capacity: 5 }),
  ].map(shopItemFromRow),
};

// --- the field: plot 2 mine, 3 An's (listed and subleased), 4 Lan's, 5 Lan rents, 6 I rent, the rest free
const item = (id: string, kind: string, name: string, price: number, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const FARM: FarmCatalog = {
  varieties: [nep],
  uplands: [],
  items: [
    item("seed_nep", "seed", "Giống nếp", 90, { variety: "nep" }),
    item("fert_urea", "fertilizer", "Phân urê", 60, { fert: "urea" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", 40, { fert: "manure" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", 80, { pest_target: "hopper" }),
  ],
};
const bare = (no: number, kind: "private" | "village", over: Record<string, unknown> = {}) => ({
  no, kind, owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});
const lease = (h: number) => ({ source: "village", until: iso(h), price: 250 });
const STATE: FieldState = parseFieldState({
  server_now: iso(0),
  plots: [
    bare(1, "private"),
    bare(2, "private", { owner: ME, farmer: ME }),
    bare(3, "private", { owner: AN, farmer: AN, sale_price: 8000, sublease_price: 300 }),
    bare(4, "private", { owner: LAN, farmer: LAN }),
    bare(5, "village", { farmer: LAN, lease: lease(30) }),
    bare(6, "village", { farmer: ME, lease: lease(5) }),
    bare(7, "village"), bare(8, "village"), bare(9, "village"), bare(10, "village"),
  ],
  drying: [],
  mine: {
    items: {}, rice: { nep: { wet: 30, dry: 50 } }, coins: 1000, gift_claimed: true, owned_plot: 2, farming: [2, 6],
    my_offers: [{ id: "o1", plot: 4, price: 5000, expires_at: iso(20) }, { id: "o3", plot: 3, price: 7000, expires_at: iso(21) }],
    incoming_offers: [
      { id: "o2", plot: 2, buyer: LAN, price: 9000, expires_at: iso(10) },
      { id: "o4", plot: 2, buyer: AN, price: 9500, expires_at: iso(11) },
    ],
  },
})!;

describe("reel_too_fast", () => {
  it("never lands a fish before minReelMs, at 16 ms and 50 ms frames, for difficulties 12–90", () => {
    // holding all the time with a 90 % zone keeps the fish inside it: the fastest reel there is
    const players: Array<(fish: number, zone: number, h: number) => boolean> = [
      () => true,
      () => false,
      (fish, zone, h) => fish > zone + h / 2,
    ];
    let caught = 0;
    for (let difficulty = 12; difficulty <= 90; difficulty += 13) {
      const minReelMs = 2000 + 40 * difficulty;
      for (const zonePct of [25, 40, 90]) {
        for (const dt of [0.016, 0.05]) {
          for (let seed = 1; seed <= 5; seed++) {
            for (const hold of players) {
              const p: ReelParams = { zonePct, difficulty, minReelMs, seed };
              let s = createReel(p);
              while (!s.outcome) s = stepReel(s, p, dt, hold(s.fish, s.zone, zoneHeight(p)));
              if (s.outcome !== "caught") continue;
              caught++;
              expect(s.elapsedMs).toBeGreaterThanOrEqual(minReelMs - 1e-6);
            }
          }
        }
      }
    }
    expect(caught).toBeGreaterThan(0);
  });

  it("never hooks before the bite", () => {
    const info: CastInfo = { castId: "c1", biteMs: 4000, windowMs: 1500, difficulty: 38, minReelMs: 3520, zonePct: 25, rarity: null };
    for (const t of [0, 1000, 3999, 3999.9]) expect(canHook(info, t)).toBe(false);
    expect(canHook(info, 4000)).toBe(true);
    expect(canHook(info, 5499)).toBe(true);
    expect(canHook(info, 5500)).toBe(false);
  });
});

describe("bad_qty", () => {
  it("the fishing shop offers bait by 1–99 and sends gear one at a time", () => {
    const onBuy = vi.fn();
    const rich = parseFishingState({ coins: 1_000_000, bait: {}, bait_cap: 500 })!;
    render(<ShopPanel state={rich} catalog={FISHING} busy={false} onBuy={onBuy} onClose={noop} />);
    const shrimp = screen.getByText("Mồi tép").closest("li")!;
    for (const choice of within(within(shrimp).getByRole("group", { name: "Số lượng Mồi tép" })).getAllByRole("button")) {
      fireEvent.click(choice);
      fireEvent.click(within(shrimp).getByRole("button", { name: /^Mua / }));
    }
    for (const name of ["Cần tre", "Phao xốp", "Xô nhỏ"]) {
      fireEvent.click(within(screen.getByText(name).closest("li")!).getByRole("button", { name: "Mua" }));
    }
    expect(onBuy.mock.calls).toEqual([
      ["bait_shrimp", 1], ["bait_shrimp", 5], ["bait_shrimp", 10], ["bait_shrimp", 99],
      ["rod_bamboo", 1], ["bobber_foam", 1], ["bucket_small", 1],
    ]);
  });

  it("the farm shop sends 1–99", () => {
    const onBuy = vi.fn();
    const { unmount } = render(<FarmShopPanel mine={{ ...STATE.mine, coins: 1_000_000, items: {} }} catalog={FARM} failed={false} busy={false}
      onBuy={onBuy} onReload={noop} onClose={noop} />);
    const urea = () => screen.getByText("Phân urê").closest("li")!;
    fireEvent.click(within(urea()).getByRole("button", { name: "Tối đa" }));
    fireEvent.click(within(urea()).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(urea()).getByRole("button", { name: /^Mua / }));
    // one lookup: the stepper keeps its button, and 120 role queries would take seconds
    const less = within(urea()).getByRole("button", { name: "Bớt" });
    for (let i = 0; i < 120; i++) fireEvent.click(less);
    fireEvent.click(within(urea()).getByRole("button", { name: /^Mua / }));
    unmount();
    render(<FarmShopPanel mine={{ ...STATE.mine, coins: 1_000_000, items: { fert_urea: 98 } }} catalog={FARM} failed={false} busy={false}
      onBuy={onBuy} onReload={noop} onClose={noop} />);
    fireEvent.click(within(urea()).getByRole("button", { name: "Thêm" }));
    fireEvent.click(within(urea()).getByRole("button", { name: /^Mua / }));
    expect(onBuy.mock.calls).toEqual([["fert_urea", 99], ["fert_urea", 1], ["fert_urea", 1]]);
  });

  it("the rice depot and the drying yard send whole kg of at least 1, and a boolean dry", () => {
    const onSell = vi.fn();
    const onAct = vi.fn();
    const mine = { ...STATE.mine, rice: { nep: { wet: 1, dry: 3 } } };
    render(<RiceDepotPanel mine={mine} catalog={FARM} failed={false} busy={false} onSell={onSell} onReload={noop} onClose={noop} />);
    for (const line of screen.getAllByRole("listitem")) {
      for (let i = 0; i < 5; i++) fireEvent.click(within(line).getByRole("button", { name: "Bớt" }));
      for (const b of within(line).getAllByRole("button", { name: /^Bán/ })) fireEvent.click(b);
    }
    expect(onSell.mock.calls).toEqual([["nep", true, 1], ["nep", true, 3], ["nep", false, 1], ["nep", false, 1]]);
    cleanup();
    render(<DryingPanel state={{ ...STATE, mine }} catalog={FARM} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
      onReload={noop} onClose={noop} />);
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Bớt" }));
    fireEvent.click(screen.getByRole("button", { name: "Phơi lúa" }));
    expect(onAct.mock.calls.map(([a]) => a)).toEqual([{ kind: "dry_start", variety: "nep", kg: 1 }]);
  });
});

describe("bad_price", () => {
  const BAD = ["", "0", "1.5", "-3", "5000001"];
  const coop = (state: FieldState, tab: string) => {
    render(<CoopPanel state={state} failed={false} me="me" busy={false} now={NOW} onAct={noop} onReload={noop} onClose={noop} />);
    fireEvent.click(screen.getByRole("tab", { name: tab }));
  };

  it("keeps Gửi đề nghị disabled for a price the server refuses", () => {
    const free = { ...STATE, plots: STATE.plots.map((p) => (p.no === 2 ? { ...p, owner: null, farmer: null } : p.no === 6 ? { ...p, farmer: null, lease: null } : p)) };
    coop({ ...free, mine: { ...free.mine, coins: 9000 } }, "Chợ đất");
    // the plot first: until one is picked the button is off whatever the price
    fireEvent.click(within(screen.getByRole("group", { name: "Thửa muốn mua" })).getAllByRole("button")[0]);
    const send = () => screen.getByRole("button", { name: "Gửi đề nghị" });
    for (const v of BAD) {
      fireEvent.change(screen.getByLabelText("Giá"), { target: { value: v } });
      expect(send()).toBeDisabled();
    }
    fireEvent.change(screen.getByLabelText("Giá"), { target: { value: "6000" } });
    expect(send()).toBeEnabled();
  });

  it("keeps Rao bán and Cho thuê disabled for a price the server refuses", () => {
    coop(STATE, "Của tôi");
    for (const [label, good] of [["Rao bán", "12000"], ["Cho thuê một vụ", "3000"]] as const) {
      const button = () => screen.getByRole("button", { name: label === "Rao bán" ? "Rao bán" : "Cho thuê" });
      for (const v of [...BAD, ...(label === "Cho thuê một vụ" ? ["100001"] : [])]) {
        fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
        expect(button()).toBeDisabled();
      }
      fireEvent.change(screen.getByLabelText(label), { target: { value: good } });
      expect(button()).toBeEnabled();
    }
  });
});

describe("bad_plot, bad_water and bad_work", () => {
  const at = (h: number) => NOW + h * HOUR_MS;
  const crop = (over: Partial<CropView>, water: Array<[number, number]>): CropView => ({
    kind: "rice", variety: "nep", upland: null, phase: "prepared", preparedAt: at(0), soakAt: at(0), sowAt: null, transplantAt: null,
    plantAt: null, water: 0, waterSetAt: null, pests: [], excessN: false, ripe: false, rottedAt: null, picking: null, pickings: 1,
    parts: 0, harvester: null,
    log: {
      water: water.map(([h, l]) => ({ t: at(h), l })), fert: [], spray: [], picks: [], qTransplant: 1, work: [], harvests: [],
      harvestedKg: 0,
    },
    ...over,
  });
  const plot = (no: number, c: CropView | null): PlotView => ({
    no, kind: "village", owner: null, salePrice: null, subleasePrice: null, farmer: ME, lease: { source: "village", until: at(96), price: 250 },
    offers: 0, crop: c,
  });

  it("the field has plots 1–10, and every plot spot is one of them", () => {
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(FIELD_PLOTS.map((p) => p.no).sort((a, b) => a - b)).toEqual(ten);
    expect(getMap("field").interactables.filter((i) => i.kind === "plot").map((i) => i.plot).sort((a, b) => a! - b!)).toEqual(ten);
  });

  it("the plot panel sends its plot's number, pumps or drains one level, works only at transplanting and harvesting, and tends only with the config's acts", () => {
    const rows = (fixtures as unknown as { crops: UplandCropRow[] }).crops;
    const beds: FarmCatalog = {
      ...FARM,
      uplands: rows.map(uplandFromRow),
      items: [...FARM.items, ...rows.map((r) => item(`seed_${r.id}`, "seed", r.name, 800, { upland: r.id }))],
    };
    const mine: FarmMine = {
      items: { seed_nep: 1, fert_urea: 1, fert_manure: 1, spray_hopper: 1, tool_sickle: 1, seed_khoai: 1, seed_bap: 1, seed_ot: 1 },
      rice: {}, coins: 0, giftClaimed: true, produce: {}, tank: null,
    };
    const upland = (id: string | null, over: Partial<CropView> = {}) =>
      crop({ kind: "upland", variety: null, upland: id, soakAt: null, plantAt: id === null ? null : at(0), ...over }, [[0, 1], [40, 1], [80, 1]]);
    const plots = [
      plot(1, null),
      plot(5, crop({ sowAt: at(3) }, [[0, 1], [11, 2]])),
      plot(10, crop({ sowAt: at(3), transplantAt: at(12) }, [[0, 3], [55, 1]])),
      plot(2, upland(null)),
      plot(3, upland("khoai")),
      plot(4, upland("bap")),
      plot(6, upland("ot", { sowAt: at(0), plantAt: null })),
      plot(7, upland("ot", { sowAt: at(0), plantAt: at(12) })),
    ];
    const deltas = new Set<number>();
    const works = new Set<string>();
    const rounds = new Set<number>();
    const acts = new Set<string>();
    for (const p of plots) {
      for (let h = 0; h <= 100; h++) {
        for (const a of plotActions(p, "me", nep, beds, mine, at(h))) {
          const run = a.run;
          expect("plot" in run && run.plot).toBe(p.no);
          expect(["transplant", "harvest"]).not.toContain(run.kind);
          if (run.kind === "water") deltas.add(run.delta);
          if (run.kind === "work") works.add(run.work);
          if (run.kind === "round") rounds.add(run.plot);
          if (run.kind === "tend") acts.add(run.act);
        }
      }
    }
    expect([...deltas].sort()).toEqual([-1, 1]);
    expect([...works].sort()).toEqual(["harvest", "transplant"]);
    expect([...rounds]).toEqual([10]);
    expect([...acts].sort()).toEqual(["lat_day", "vun_goc"]);
  });
});

describe("bad_slot", () => {
  it("the drying yard shows slots 1–4 and collects only those", () => {
    const onAct = vi.fn();
    const drying = [1, 2, 3, 4, 7].map((slot) => ({ slot, owner: ME, variety: "nep", kg: 10, readyAt: NOW - 1 }));
    render(<DryingPanel state={{ ...STATE, drying }} catalog={FARM} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
      onReload={noop} onClose={noop} />);
    for (const b of screen.getAllByRole("button", { name: "Lấy lúa" })) fireEvent.click(b);
    expect(DRYING_SLOTS).toBe(4);
    expect(onAct.mock.calls.map(([a]) => a)).toEqual([1, 2, 3, 4].map((slot) => ({ kind: "dry_collect", slot })));
  });
});

describe("foreign_offer", () => {
  it("withdraws only my offers, and accepts or declines only the offers made to me", () => {
    const onAct = vi.fn();
    render(<CoopPanel state={STATE} failed={false} me="me" busy={false} now={NOW} onAct={onAct} onReload={noop} onClose={noop} />);
    fireEvent.click(screen.getByRole("tab", { name: "Của tôi" }));
    for (const b of screen.getAllByRole("button", { name: "Rút" })) fireEvent.click(b);
    for (const b of screen.getAllByRole("button", { name: "Từ chối" })) fireEvent.click(b);
    for (const b of screen.getAllByRole("button", { name: "Đồng ý" })) {
      fireEvent.click(b);
      fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    }
    const sent = onAct.mock.calls.map(([a]) => a as { kind: string; offer: string });
    expect(sent.filter((a) => a.kind === "withdraw_offer").map((a) => a.offer)).toEqual(["o1", "o3"]);
    expect(sent.filter((a) => a.kind === "decline_offer").map((a) => a.offer)).toEqual(["o2", "o4"]);
    expect(sent.filter((a) => a.kind === "accept_offer").map((a) => a.offer)).toEqual(["o2", "o4"]);
  });
});

describe("quality_range", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const f of Object.values(rpc)) f.mockReset();
    rpc.fetchFieldState.mockResolvedValue(STATE);
    rpc.fetchFarmCatalog.mockResolvedValue(FARM);
    rpc.fieldAction.mockResolvedValue({ state: STATE, harvest: null });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("transplants and harvests with quality 1", async () => {
    const canvas = { setPlots: vi.fn(), farmAnim: vi.fn(), plotChanged: vi.fn(), plant: vi.fn() } as unknown as GameCanvasHandle;
    const { result } = renderHook(() => useFarmController({
      token: "tok", roomId: "r", accountId: "me", mapId: "field", canvas: () => canvas, toast: noop, onCoinsChanged: noop,
    }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    for (const work of ["transplant", "harvest"] as const) {
      await act(async () => { await result.current.act({ kind: "work", plot: 6, work }); });
      await act(async () => { await vi.advanceTimersByTimeAsync(WORK_MS); });
      expect(rpc.fieldAction).toHaveBeenLastCalledWith("r", "tok", { kind: work, plot: 6, quality: 1 });
    }
  });
});
