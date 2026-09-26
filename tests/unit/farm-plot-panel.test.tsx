import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FarmTasksPanel, { FarmTasksButton } from "@/components/game/farm/FarmTasks";
import Handbook from "@/components/game/farm/Handbook";
import PlotPanel from "@/components/game/farm/PlotPanel";
import { farmItemFromRow, uplandFromRow, varietyFromRow, type FarmCatalog, type UplandCropRow } from "@/lib/game/farm/catalog";
import { parseFieldState, type FieldState } from "@/lib/game/farm/state";
import fixtures from "@/tests/fixtures/upland-cases.json";

afterEach(cleanup);

const NOW = Date.parse("2026-09-25T10:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const ME = { id: "me", name: "Me" };
const LAN = { id: "lan", name: "Lan" };
const item = (id: string, kind: string, name: string, over: Record<string, unknown> = {}) => farmItemFromRow({
  id, kind, name, price: 50, sort_order: 0, variety: null, fert: null, pest_target: null, capacity: null, ...over,
});
const nep = varietyFromRow({ id: "nep", name: "Nếp", scale: 1, base_kg: 75, price_per_kg: 18, blast_mult: 1, sort_order: 20 });
const CATALOG: FarmCatalog = {
  uplands: [],
  varieties: [nep],
  items: [
    item("seed_nep", "seed", "Giống nếp", { variety: "nep" }),
    item("fert_manure", "fertilizer", "Phân chuồng hoai", { fert: "manure" }),
    item("fert_urea", "fertilizer", "Phân urê", { fert: "urea" }),
    item("fert_npk", "fertilizer", "Phân NPK", { fert: "npk" }),
    item("spray_hopper", "pesticide", "Thuốc trừ rầy", { pest_target: "hopper" }),
    item("tool_sickle", "tool", "Liềm"),
  ],
};
const bare = (no: number, kind: "private" | "village", over: Record<string, unknown> = {}) => ({
  no, kind, owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null, ...over,
});
/** Plot 5: my nếp, transplanted 8 h ago, shallow water, planthoppers; 6: Lan's with snails; 7: free; 2: mine, bare. */
const STATE: FieldState = parseFieldState({
  server_now: iso(0),
  plots: [
    bare(1, "private"),
    bare(2, "private", { owner: ME, farmer: ME }),
    bare(5, "village", {
      farmer: ME, lease: { source: "village", until: iso(80), price: 250 },
      crop: {
        variety: "nep", phase: "tillering", prepared_at: iso(-20), soak_at: iso(-20), sow_at: iso(-17), transplant_at: iso(-8),
        water: 2, water_set_at: iso(-8), pests: [{ kind: "hopper", since: iso(-1), treated_at: null }], excess_n: false, ripe: false,
        rotted_at: null,
        log: { water: [{ t: iso(-20), l: 3 }, { t: iso(-8), l: 2 }], fert: [], spray: [], picks: [], q_transplant: 1 },
      },
    }),
    bare(6, "village", {
      farmer: LAN, lease: { source: "village", until: iso(50), price: 250 },
      crop: {
        variety: "nep", phase: "tillering", prepared_at: iso(-20), soak_at: iso(-20), sow_at: iso(-17), transplant_at: iso(-8),
        water: 3, water_set_at: iso(-8), pests: [{ kind: "snail", since: iso(-2), treated_at: null }], excess_n: false, ripe: false, rotted_at: null,
      },
    }),
    bare(7, "village"),
  ],
  drying: [],
  mine: {
    items: { spray_hopper: 1, fert_urea: 1, fert_manure: 1, seed_nep: 1 }, rice: {}, coins: 1000, gift_claimed: true, owned_plot: 2,
    farming: [2, 5], my_offers: [], incoming_offers: [],
  },
})!;

function renderPlot(no: number, state: FieldState = STATE) {
  const onAct = vi.fn(), onOpenHandbook = vi.fn();
  render(<PlotPanel no={no} state={state} catalog={CATALOG} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
    onOpenHandbook={onOpenHandbook} onReload={() => {}} onClose={() => {}} />);
  return { onAct, onOpenHandbook };
}

describe("PlotPanel", () => {
  it("shows my crop's status and estimate, and the jobs with their hints", () => {
    const { onAct, onOpenHandbook } = renderPlot(5);
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "🌱 Nếp · Đẻ nhánh — giai đoạn sau: còn 10 giờ")).toBeInTheDocument();
    expect(screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === "💧 Nước: Nông · cần Nông")).toBeInTheDocument();
    expect(screen.getByText("❗ Rầy nâu — Thuốc trừ rầy")).toBeInTheDocument();
    expect(screen.getByText(/^⚖️ Ước tính: ~\d+ kg/)).toBeInTheDocument();
    expect(screen.getByText("Trị rầy nâu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Xịt thuốc trừ rầy" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "spray", plot: 5, item: "spray_hopper" }, "Đã xịt thuốc trừ rầy.");
    expect(screen.getByText("Đúng lúc bón thúc đẻ nhánh.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Bơm nước (lên Sâu)" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "water", plot: 5, delta: 1 }, undefined);
    // manure after transplanting is wasted: asked first
    fireEvent.click(screen.getByRole("button", { name: "Bón phân chuồng hoai" }));
    expect(screen.getByText("⚠️ Đã cấy — bón lót bây giờ là phí.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "fertilize", plot: 5, item: "fert_manure" }, "Đã bón phân chuồng hoai.");
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Sâu bệnh" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("pests");
  });

  it("lets a neighbour only pick the snails, with no estimate", () => {
    const { onAct } = renderPlot(6);
    expect(screen.getByText("Đất làng · người làm: Lan (thuê — còn 2 ngày 2 giờ)")).toBeInTheDocument();
    expect(screen.queryByText(/Ước tính/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Bắt ốc bươu vàng" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "pick_snails", plot: 6 }, "Đã bắt ốc bươu vàng.");
    expect(screen.queryByRole("button", { name: /Bơm nước/ })).toBeNull();
  });

  it("offers a free plot's land and my own plot's land actions", () => {
    const { onAct } = renderPlot(7);
    expect(screen.getByText("Ruộng còn gốc rạ — chưa làm đất.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thuê · 10.000 xu" })).toBeDisabled();
    expect(screen.getByText("Bạn đang canh tác 2 thửa rồi.")).toBeInTheDocument();
    cleanup();
    renderPlot(2);
    expect(screen.getByRole("button", { name: "Làm ruộng lúa" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Lên luống trồng màu" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Rao bán" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bán lại cho làng · 400.000 xu" })).toBeEnabled();
    expect(onAct).not.toHaveBeenCalled();
  });

  it("keeps an item's capitals in the toast", () => {
    const { onAct } = renderPlot(5, { ...STATE, mine: { ...STATE.mine, items: { fert_npk: 1 } } });
    // NPK at 8 h after transplanting is on time: no warning, straight to the toast
    fireEvent.click(screen.getByRole("button", { name: "Bón phân NPK" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "fertilize", plot: 5, item: "fert_npk" }, "Đã bón phân NPK.");
  });
});

describe("Handbook", () => {
  it("opens at the tab asked for and switches tabs", () => {
    render(<Handbook varieties={[nep]} initial="pests" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Sâu bệnh" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Sâu cuốn lá: lá cuộn trắng. Xịt thuốc trừ sâu.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Quy trình" }));
    expect(screen.getByText(/^Nếp: cấy khi mạ 8–14 giờ tuổi/)).toBeInTheDocument();
    cleanup();
    render(<Handbook varieties={[nep]} initial="nope" onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Quy trình" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("FarmTasks", () => {
  it("counts the urgent tasks on the HUD button", () => {
    const onClick = vi.fn();
    render(<FarmTasksButton urgent={2} onClick={onClick} />);
    fireEvent.click(screen.getByRole("button", { name: "🌾 Việc đồng áng (2 việc gấp)" }));
    expect(onClick).toHaveBeenCalled();
    cleanup();
    render(<FarmTasksButton urgent={0} onClick={onClick} />);
    expect(screen.getByRole("button", { name: "🌾 Việc đồng áng" })).toBeInTheDocument();
  });
  it("lists the tasks, urgent first as given, or says there is nothing to do", () => {
    const onOpenHandbook = vi.fn();
    render(<FarmTasksPanel farming tasks={[{ plot: 5, text: "Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy", urgent: true }, { plot: 5, text: "Thửa 5 · Gặt — còn 3 giờ", urgent: false }]}
      onOpenHandbook={onOpenHandbook} onClose={() => {}} />);
    expect(screen.getByText("❗ Thửa 5 · Rầy nâu! Xịt thuốc trừ rầy")).toBeInTheDocument();
    expect(screen.getByText("• Thửa 5 · Gặt — còn 3 giờ")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay nhà nông" }));
    expect(onOpenHandbook).toHaveBeenCalled();
    cleanup();
    render(<FarmTasksPanel farming={false} tasks={[]} onOpenHandbook={() => {}} onClose={() => {}} />);
    expect(screen.getByText("Bạn chưa có ruộng — ghé chú Tám ở Hợp tác xã thuê một thửa nhé.")).toBeInTheDocument();
  });
  it("keys the lines by their place in the list, not by their text", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const twice = { plot: 5, text: "Thửa 5 · Sâu keo mùa thu! Xịt thuốc trừ sâu", urgent: true };
    render(<FarmTasksPanel farming tasks={[twice, twice]} onOpenHandbook={() => {}} onClose={() => {}} />);
    expect(screen.getAllByText(`❗ ${twice.text}`)).toHaveLength(2);
    expect(error.mock.calls.filter(([m]) => String(m).includes("same key"))).toEqual([]);
    error.mockRestore();
  });
});

describe("PlotPanel, v15.2", () => {
  const UPLANDS = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
  const BEDS: FarmCatalog = {
    ...CATALOG, uplands: UPLANDS,
    items: [
      ...CATALOG.items, item("seed_khoai", "seed", "Dây khoai giống", { upland: "khoai" }),
      item("spray_insect", "pesticide", "Thuốc trừ sâu", { pest_target: "insect" }), item("fert_potash", "fertilizer", "Phân kali", { fert: "potash" }),
    ],
  };
  const LOG = { fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [] };
  /** Plot 5, mine, with `crop`; the rest as STATE has them. */
  const withCrop = (crop: Record<string, unknown> | null, items: Record<string, number> = {}): FieldState => parseFieldState({
    server_now: iso(0),
    plots: [bare(5, "village", { farmer: ME, lease: { source: "village", until: iso(80), price: 250 }, crop })],
    drying: [],
    mine: { items, rice: {}, coins: 10_000, gift_claimed: true, owned_plot: null, farming: [5], my_offers: [], incoming_offers: [] },
  })!;
  const beds = (over: Record<string, unknown>) => ({
    kind: "upland", variety: null, upland: null, phase: "prepared", prepared_at: iso(-30), water: 1, water_set_at: iso(-1), pests: [],
    excess_n: false, ripe: false, rotted_at: null, picking: 0, pickings: 0, log: { ...LOG, water: [{ t: iso(-1), l: 1 }] }, ...over,
  });
  function show(state: FieldState, catalog: FarmCatalog = BEDS) {
    const onAct = vi.fn(), onOpenHandbook = vi.fn();
    render(<PlotPanel no={5} state={state} catalog={catalog} failed={false} me="me" busy={false} now={NOW} onAct={onAct}
      onOpenHandbook={onOpenHandbook} onReload={() => {}} onClose={() => {}} />);
    return { onAct, onOpenHandbook };
  }
  const li = (text: string) => screen.getByText((_, el) => el?.tagName === "LI" && el.textContent === text);

  it("offers the two ways to làm đất on a bare plot, with their toasts", () => {
    const { onAct } = show(withCrop(null));
    expect(screen.getByText("Cày bừa, cho nước ngập ruộng — để cấy lúa.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lên luống trồng màu" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "prepare_beds", plot: 5 }, "Đã lên luống — đất Ẩm, sẵn sàng trồng.");
    fireEvent.click(screen.getByRole("button", { name: "Làm ruộng lúa" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "prepare", plot: 5 }, "Đã làm đất — ruộng ngập nước.");
  });

  it("shows bare beds and plants a seed I hold", () => {
    const { onAct } = show(withCrop(beds({}), { seed_khoai: 1 }));
    expect(li("🌱 Luống đã lên — chưa trồng gì.")).toBeInTheDocument();
    expect(li("💧 Đất: Ẩm")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Trồng dây khoai" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "plant", plot: 5, item: "seed_khoai" }, "Đã trồng dây khoai.");
  });

  it("shows khoai's stage, the soil, the rot and the estimate; lật dây is toasted; the handbook opens at Khoai lang", () => {
    // planted 25 h ago; Đẫm since an hour ago (rot from 22 h)
    const crop = beds({
      upland: "khoai", phase: "tuber", plant_at: iso(-25), picking: 1, pickings: 1, water: 2,
      log: { ...LOG, water: [{ t: iso(-25), l: 1 }, { t: iso(-1), l: 2 }] },
    });
    const { onAct, onOpenHandbook } = show(withCrop(crop));
    expect(li("🌱 Khoai lang · Tượng củ — giai đoạn sau: còn 11 giờ")).toBeInTheDocument();
    expect(li("💧 Đất: Đẫm · cần Khô–Ẩm")).toBeInTheDocument();
    expect(li("⚠️ Đất úng — củ đang thối!")).toBeInTheDocument();
    expect(screen.getByText(/^⚖️ Ước tính: ~\d+ kg \(chưa tính sâu bệnh chưa tới\)$/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Lật dây" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "tend", plot: 5, act: "lat_day" }, "Đã lật dây.");
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Khoai lang" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("khoai");
  });

  it("gives ớt's estimate per picking and for the season", () => {
    const crop = beds({
      upland: "ot", phase: "ripe", sow_at: iso(-60), plant_at: iso(-48), picking: 1, pickings: 3, log: { ...LOG, water: [{ t: iso(-2), l: 1 }] },
    });
    show(withCrop(crop));
    expect(screen.getByText(/^⚖️ Ước tính: lứa này ~\d+ kg · cả vụ ~\d+ kg \(chưa tính sâu bệnh chưa tới\)$/)).toBeInTheDocument();
  });

  const RIPE = {
    variety: "nep", phase: "ripe", prepared_at: iso(-64), soak_at: iso(-63), sow_at: iso(-60), transplant_at: iso(-50), water: 1,
    water_set_at: iso(-3), pests: [], excess_n: false, ripe: true, rotted_at: null,
    log: { water: [{ t: iso(-64), l: 3 }, { t: iso(-3), l: 1 }], fert: [], spray: [], picks: [], q_transplant: 1, harvested_kg: 25 },
  };

  it("points ripe rice to the sickle and the co-op's harvester", () => {
    const { onAct, onOpenHandbook } = show(withCrop(RIPE, { tool_sickle: 1 }));
    expect(li("🚜 Hoặc thuê máy gặt ở Hợp tác xã: 30 giây, 500 xu mỗi phần còn lại.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Gặt bằng liềm" }));
    expect(onAct).toHaveBeenLastCalledWith({ kind: "round", plot: 5 }, undefined);
    fireEvent.click(screen.getByRole("button", { name: "📖 Sổ tay: Nông cụ" }));
    expect(onOpenHandbook).toHaveBeenCalledWith("tools");
  });

  it("shows a partly cut plot with only Gặt tiếp and Bỏ vụ", () => {
    show(withCrop({ ...RIPE, parts: 2 }, { tool_sickle: 1 }));
    expect(li("🌾 Đã gặt 2/6 phần (25 kg)")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^(Gặt|Bỏ)/ }).map((b) => b.textContent)).toEqual(["Gặt tiếp (phần 3/6)", "Bỏ vụ"]);
  });

  it("counts a running harvester down, with no buttons", () => {
    show(withCrop({ ...RIPE, parts: 2, harvester: { started_at: iso(0), ends_at: new Date(NOW + 25_000).toISOString() } }, { tool_sickle: 1 }));
    expect(li("🚜 Máy gặt đang gặt — còn 25 giây")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(Gặt|Bỏ vụ|Bơm|Tháo)/ })).toBeNull();
  });
});

describe("Handbook, v15.2", () => {
  it("adds a tab per hoa-màu crop and Nông cụ", () => {
    const uplands = (fixtures as unknown as { crops: UplandCropRow[] }).crops.map(uplandFromRow);
    render(<Handbook varieties={[nep]} uplands={uplands} items={CATALOG.items} initial="khoai" onClose={() => {}} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(
      ["Quy trình", "Phân bón", "Sâu bệnh", "Nước", "Giống lúa", "Mẹo", "Khoai lang", "Bắp", "Ớt", "Nông cụ"]);
    expect(screen.getByRole("tab", { name: "Khoai lang" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/^Cách trồng khoai lang/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Nông cụ" }));
    expect(screen.getByRole("tab", { name: "Nông cụ" })).toHaveAttribute("aria-selected", "true");
  });
});
