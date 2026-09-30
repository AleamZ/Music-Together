// econ v2, the sinks (0105_econ_sinks.sql, spec 2026-09-30-economy-v2-design.md §8): the migration's re-created
// functions are their newest bodies but for the lines marked "econ v2", the numbers are the spec's, and the housing and
// motel panels say them.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MotelModal from "@/components/game/MotelModal";
import LotModal from "@/components/game/housing/LotModal";
import ApartmentModal from "@/components/game/housing/ApartmentModal";
import { APT_RENT, type AptList } from "@/lib/game/housing/apartment";
import { LAND_PRICE, LAND_REFUND_SHARE, REPOSSESS_REFUND_SHARE, UPKEEP, type HouseList, type StreetLot } from "@/lib/game/housing/house";
import { MOTEL_PLANS, REST_EFFECT_TEXT, REST_STAMINA, type MotelState } from "@/lib/game/housing/motel";
import { MEAL_BUFFS } from "@/lib/game/professions/catalog";
import { DEFAULT_LOOK } from "@/lib/game/look";

const read = (f: string) => readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SINKS = read("supabase/migrations/0105_econ_sinks.sql");

/** A function's statement, from its `create or replace` to the `$$;` that closes its body. */
const fn = (s: string, name: string) => {
  const from = s.indexOf(`create or replace function public.${name}(`);
  expect(from, name).toBeGreaterThanOrEqual(0);
  return s.slice(from, s.indexOf("$$;", s.indexOf("as $$", from) + 5) + 3);
};

describe("0105: the migration", () => {
  it("runs after 0104 and is re-runnable", () => {
    expect(SINKS).toContain("ADDITIVE and re-runnable. Run after 0104");
    expect(SINKS).toContain("on conflict (meal_id, key) do update set value = excluded.value, minutes = excluded.minutes;");
    expect(SINKS).not.toMatch(/\bdrop\s+(table|function)\b/i);
  });

  it("re-creates _stamina_rate (0077) and _house_sweep (0042) verbatim but for the econ v2 lines", () => {
    const cases: Array<[string, string, string]> = [
      ["_stamina_rate", "supabase/migrations/0077_professions.sql", "_rest_factor(p_account) < 1 then 1.5"],
      ["_house_sweep", "supabase/migrations/0042_houses.sql", "public._house_price('refund')"],
    ];
    for (const [name, file, replaced] of cases) {
      const mine = fn(SINKS, name).split("\n"), old = fn(read(file), name).split("\n");
      expect(mine.filter((l) => l.includes("econ v2")), name).toHaveLength(1);
      expect(mine.filter((l) => !l.includes("econ v2")), name).toEqual(old.filter((l) => !l.includes(replaced)));
      expect(old.filter((l) => l.includes(replaced)), name).toHaveLength(1);
    }
  });

  it("the new numbers are the spec's", () => {
    const buff = (meal: string, key: string) => MEAL_BUFFS.find((b) => b.meal === meal && b.key === key)?.value;
    expect(["ca_kho_to", "canh_chua", "ca_chien", "sinh_to"].map((m) => buff(m, "rare_fish"))).toEqual([4, 6, 5, 2]);
    expect(["pho_bo", "nuoc_dua", "cafe_sua", "tra_da"].map((m) => buff(m, "stamina_regen"))).toEqual([30, 25, 20, 10]);
    expect(REST_STAMINA).toBe(1.2);
    expect([UPKEEP, LAND_PRICE * LAND_REFUND_SHARE, LAND_PRICE * REPOSSESS_REFUND_SHARE, APT_RENT]).toEqual([1500, 20000, 10000, 2000]);
    // the motel (the controller's addition to §8): a night 300, a month 6 000 — still a third cheaper than 30 nights
    const night = MOTEL_PLANS.find((p) => p.id === "night")!, month = MOTEL_PLANS.find((p) => p.id === "month")!;
    expect([night.price, month.price]).toEqual([300, 6000]);
    expect(month.price * 3).toBe(night.price * (month.hours / night.hours) * 2);
    expect(fn(SINKS, "_motel_price")).toContain(`when 'night' then ${night.price} when 'month' then ${month.price} end`);
  });
});

describe("0105: the panels", () => {
  beforeEach(() => { vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it("the motel says what Ngủ ngon does, stamina included", () => {
    const st: MotelState = { stay: null, rest: { buffUntilMs: null, sleptToday: false }, serverNowMs: 0 };
    render(<MotelModal token="t" state={st} coins={0} look={DEFAULT_LOOK} onState={() => {}} onClose={() => {}} />);
    const text = screen.getByTestId("motel-rest").textContent ?? "";
    expect(text).toContain(REST_EFFECT_TEXT);
    expect(text).toContain("thể lực hồi nhanh hơn 20 %");
    const plans = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(plans[0]).toContain("300 xu · 24 giờ");
    expect(plans[1]).toContain("6.000 xu · 30 ngày (rẻ hơn ⅓)");
  });

  it("a lot: 1 500 upkeep, 20 000 back when given back, 10 000 when repossessed", () => {
    const lot = (no: number, over: Partial<StreetLot> = {}): StreetLot => ({
      no, owned: false, ownerName: null, mine: false, grid: null, roof: "ngoi", visibility: "private", rooms: [], ...over,
    });
    const free: HouseList = { lots: Array.from({ length: 8 }, (_, i) => lot(i + 1)), mine: null, tenancy: null, serverNowMs: 0 };
    const props = { token: "t", roomId: "r", coins: 50000, hasFlat: false, onState: () => {}, onBuild: () => {}, onEnter: () => {}, onClose: () => {} };
    const { unmount } = render(<LotModal {...props} lot={3} state={free} />);
    const text = screen.getByTestId("lot-free").textContent ?? "";
    expect(text).toContain("1.500 xu mỗi 30 ngày");
    expect(text).toContain("hoàn 20.000 xu");
    expect(text).toContain("chỉ được hoàn 10.000 xu");
    unmount();
    // in arrears
    const s: HouseList = {
      ...free, serverNowMs: 10 * 86_400_000,
      mine: { no: 2, paidUntilMs: 86_400_000, repossessMs: 61 * 86_400_000, buildCost: 0, visibility: "private", wall: null, floor: null, rooms: [] },
    };
    s.lots[1] = lot(2, { owned: true, ownerName: "Tôi", mine: true });
    render(<LotModal {...props} lot={2} state={s} />);
    const mine = screen.getByTestId("lot-mine").textContent ?? "";
    expect(mine).toContain("chỉ hoàn 10.000 xu");
    expect(screen.getByRole("button", { name: /Đóng phí 30 ngày · 1\.500 xu/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Trả đất cho thành phố/ }));
    expect(screen.getByRole("button", { name: "Đồng ý" })).toBeTruthy();
  });

  it("the flats rent for 2 000", () => {
    const list: AptList = {
      units: Array.from({ length: 12 }, (_, i) => ({ no: i + 1, status: "free" as const, ownerName: null, visibility: "private" as const, mine: false })),
      mine: null, storage: [], knocks: [], serverNowMs: 0,
    };
    render(<ApartmentModal token="t" roomId="r" state={list} coins={1999} onState={() => {}} onEnter={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Thuê 2\.000 xu mỗi 30 ngày/)).toBeTruthy();
  });
});
