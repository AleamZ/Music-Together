import { describe, it, expect } from "vitest";
import { itemCount, parseFarmMine, parseFieldState, withMine } from "@/lib/game/farm/state";

const T = "2026-09-25T10:00:00+00:00";
const ms = (iso: string) => Date.parse(iso);
const DAT = { id: "a1", name: "Dat" };
const LAN = { id: "a2", name: "Lan" };

/** The shape _field_view builds (0013). */
const ANSWER = {
  server_now: T,
  plots: [
    {
      no: 3, kind: "private", owner: DAT, sale_price: null, sublease_price: 300, farmer: LAN,
      lease: { source: "owner", until: "2026-09-29T10:00:00+00:00", price: 300 }, offers: 2,
      crop: {
        variety: "nep", phase: "tillering", prepared_at: "2026-09-24T00:00:00+00:00", soak_at: "2026-09-24T00:00:00+00:00",
        sow_at: "2026-09-24T03:00:00+00:00", transplant_at: "2026-09-24T12:00:00+00:00", water: 2,
        water_set_at: "2026-09-24T12:00:00+00:00",
        pests: [
          { kind: "hopper", since: "2026-09-25T09:00:00+00:00", treated_at: null },
          { kind: "locust", since: "2026-09-25T09:00:00+00:00", treated_at: null },
        ],
        excess_n: false, ripe: false, rotted_at: null,
        log: {
          water: [{ t: "2026-09-24T00:00:00+00:00", l: 3 }, { t: "2026-09-24T12:00:00+00:00", l: 2 }],
          fert: [{ t: "2026-09-24T17:00:00+00:00", item: "fert_urea" }], spray: [], picks: [{ t: "2026-09-25T09:30:00+00:00" }],
          q_transplant: 1.05,
        },
      },
    },
    { no: 1, kind: "private", owner: null, sale_price: null, sublease_price: null, farmer: null, lease: null, offers: 0, crop: null },
    { no: 42, kind: "village" },
  ],
  drying: [{ slot: 2, owner: LAN, variety: "nep", kg: 70, ready_at: "2026-09-25T11:00:00+00:00" }],
  mine: {
    items: { seed_nep: 2, fert_urea: 0 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, gift_claimed: true,
    owned_plot: 3, farming: [7],
    my_offers: [{ id: "o1", plot: 2, price: 8000, expires_at: "2026-09-26T10:00:00+00:00" }],
    incoming_offers: [{ id: "o2", plot: 3, buyer: LAN, price: 8500, expires_at: "2026-09-26T09:00:00+00:00" }],
  },
};

describe("parseFieldState", () => {
  const s = parseFieldState(ANSWER)!;
  it("reads the plots in order, skipping bad ones", () => {
    expect(s.serverNow).toBe(ms(T));
    expect(s.plots.map((p) => p.no)).toEqual([1, 3]);
    expect(s.plots[0]).toEqual({
      no: 1, kind: "private", owner: null, salePrice: null, subleasePrice: null, farmer: null, lease: null, offers: 0, crop: null,
    });
    expect(s.plots[1]).toMatchObject({
      owner: DAT, farmer: LAN, subleasePrice: 300, offers: 2,
      lease: { source: "owner", until: ms("2026-09-29T10:00:00Z"), price: 300 },
    });
  });
  it("reads the crop, its known pests and the farmer's logs", () => {
    const c = s.plots[1].crop!;
    expect(c).toMatchObject({
      variety: "nep", phase: "tillering", water: 2, transplantAt: ms("2026-09-24T12:00:00Z"), excessN: false, ripe: false,
      rottedAt: null,
    });
    expect(c.pests).toEqual([{ kind: "hopper", since: ms("2026-09-25T09:00:00Z"), treatedAt: null }]);
    expect(c.log).toEqual({
      water: [{ t: ms("2026-09-24T00:00:00Z"), l: 3 }, { t: ms("2026-09-24T12:00:00Z"), l: 2 }],
      fert: [{ t: ms("2026-09-24T17:00:00Z"), item: "fert_urea" }], spray: [], picks: [ms("2026-09-25T09:30:00Z")],
      qTransplant: 1.05,
    });
  });
  it("reads the drying yard and mine", () => {
    expect(s.drying).toEqual([{ slot: 2, owner: LAN, variety: "nep", kg: 70, readyAt: ms("2026-09-25T11:00:00Z") }]);
    expect(s.mine).toEqual({
      items: { seed_nep: 2 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, giftClaimed: true, ownedPlot: 3, farming: [7],
      myOffers: [{ id: "o1", plot: 2, price: 8000, expiresAt: ms("2026-09-26T10:00:00Z"), buyer: null }],
      incomingOffers: [{ id: "o2", plot: 3, price: 8500, expiresAt: ms("2026-09-26T09:00:00Z"), buyer: LAN }],
    });
  });
  it("refuses what is not a field state", () => {
    expect(parseFieldState(null)).toBeNull();
    expect(parseFieldState({ plots: [] })).toBeNull();
    expect(parseFieldState({ server_now: T, plots: [] })).toBeNull();
  });
});

describe("the account part", () => {
  it("merges a newer mine into the field state", () => {
    const s = parseFieldState(ANSWER)!;
    const m = parseFarmMine({ items: { fert_npk: 3 }, rice: {}, coins: 99, gift_claimed: true })!;
    const next = withMine(s, m);
    expect(next.mine).toMatchObject({ items: { fert_npk: 3 }, rice: {}, coins: 99, ownedPlot: 3, farming: [7] });
    expect(itemCount(next.mine, "fert_npk")).toBe(3);
    expect(itemCount(next.mine, "seed_nep")).toBe(0);
    expect(parseFarmMine("x")).toBeNull();
  });
});
