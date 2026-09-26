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
      qTransplant: 1.05, work: [], harvests: [], harvestedKg: 0,
    });
  });
  it("reads the drying yard and mine", () => {
    expect(s.drying).toEqual([{ slot: 2, owner: LAN, variety: "nep", kg: 70, readyAt: ms("2026-09-25T11:00:00Z") }]);
    expect(s.mine).toEqual({
      items: { seed_nep: 2 }, rice: { nep: { wet: 0, dry: 70 } }, coins: 1230, giftClaimed: true, produce: {}, tank: null,
      critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null },
      rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null,
      ownedPlot: 3, farming: [7],
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

describe("v15.2 (§11.6)", () => {
  const plot = (crop: Record<string, unknown>) => ({
    no: 6, kind: "village", owner: null, sale_price: null, sublease_price: null, farmer: DAT, lease: null, offers: 0, crop,
  });
  const answer = (crop: Record<string, unknown>, mine: Record<string, unknown> = {}) => ({
    ...ANSWER, plots: [plot(crop)], mine: { ...ANSWER.mine, ...mine },
  });
  it("reads a rice crop from before 0016 as a whole, uncut plot", () => {
    const c = parseFieldState(answer({ variety: "nep", phase: "ripe", water: 1 }))!.plots[0].crop!;
    expect(c).toMatchObject({ kind: "rice", upland: null, plantAt: null, picking: null, pickings: 1, parts: 0, harvester: null });
  });
  it("reads the cut parts and a running harvester", () => {
    const c = parseFieldState(answer({
      kind: "rice", variety: "nep", phase: "ripe", water: 1, parts: 2, picking: null, pickings: 1,
      harvester: { started_at: "2026-09-25T09:59:50+00:00", ends_at: "2026-09-25T10:00:20+00:00" },
      log: { water: [], fert: [], spray: [], picks: [], q_transplant: 1, work: [], harvests: [], harvested_kg: 25 },
    }))!.plots[0].crop!;
    expect(c).toMatchObject({ parts: 2, harvester: { startedAt: ms("2026-09-25T09:59:50Z"), endsAt: ms("2026-09-25T10:00:20Z") } });
    expect(c.log?.harvestedKg).toBe(25);
  });
  it("reads beds, their crop, P, the pickings and the hoa-màu logs", () => {
    const c = parseFieldState(answer({
      kind: "upland", variety: null, upland: "ot", phase: "flower", prepared_at: "2026-09-24T00:00:00+00:00",
      sow_at: "2026-09-24T01:00:00+00:00", plant_at: "2026-09-24T12:00:00+00:00", water: 1, picking: 1, pickings: 3, parts: 0,
      harvester: null, pests: [{ kind: "thrips", since: "2026-09-24T20:00:00+00:00", treated_at: null }],
      log: {
        water: [], fert: [], spray: [], picks: [], q_transplant: 1, harvested_kg: 0,
        work: [{ t: "2026-09-24T20:00:00+00:00", act: "vun_goc" }, { t: "2026-09-24T21:00:00+00:00" }],
        harvests: [{ t: "2026-09-25T09:00:00+00:00", k: 1, kg: 24 }],
      },
    }))!.plots[0].crop!;
    expect(c).toMatchObject({
      kind: "upland", upland: "ot", phase: "flower", plantAt: ms("2026-09-24T12:00:00Z"), picking: 1, pickings: 3,
      pests: [{ kind: "thrips", since: ms("2026-09-24T20:00:00Z"), treatedAt: null }],
    });
    expect(c.log?.work).toEqual([{ t: ms("2026-09-24T20:00:00Z"), act: "vun_goc" }]);
    expect(c.log?.harvests).toEqual([{ t: ms("2026-09-25T09:00:00Z"), k: 1, kg: 24 }]);
    // bare beds: nothing planted, no pickings yet
    const bare = parseFieldState(answer({ kind: "upland", upland: null, phase: "prepared", water: 1, picking: null, pickings: 0 }))!;
    expect(bare.plots[0].crop).toMatchObject({ kind: "upland", upland: null, picking: null, pickings: 0 });
  });
  it("reads the hoa màu in stock and the sprayer's tank", () => {
    const m = (tank: unknown) => parseFieldState(answer({ variety: "nep" }, { produce: { khoai: 180, bap: 0 }, tank }))!.mine;
    expect(m({ item: "spray_insect", charges: 2 })).toMatchObject({ produce: { khoai: 180 }, tank: { item: "spray_insect", charges: 2 } });
    expect(m({ item: null, charges: 0 }).tank).toEqual({ item: null, charges: 0 });
    expect(m(null).tank).toBeNull();
    expect(parseFarmMine({ items: {}, rice: {}, coins: 0, gift_claimed: true })).toMatchObject({ produce: {}, tank: null });
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

describe("v15.3 (§11.7)", () => {
  const MINE = {
    ...ANSWER.mine,
    critters: { cua_dong: { n: 5, xu: 130 }, cua_gach: { n: 1, xu: 100 }, oc_dong: { n: 0, xu: 0 } },
    critter_cap: 33,
    gather: { ready_at: { crab3: "2026-09-25T10:12:00+00:00", bed1: "2026-09-25T10:07:00+00:00", bed2: "soon" }, left_today: 187,
              day_resets_at: null },
  };
  it("reads the critters held, the capacity and the gathering", () => {
    const m = parseFieldState({ ...ANSWER, mine: MINE })!.mine;
    expect(m.critters).toEqual({ cua_dong: { n: 5, xu: 130 }, cua_gach: { n: 1, xu: 100 } });
    expect(m.critterCap).toBe(33);
    expect(m.gather).toEqual({
      readyAt: { crab3: ms("2026-09-25T10:12:00Z"), bed1: ms("2026-09-25T10:07:00Z") }, leftToday: 187, dayResetsAt: null,
    });
    const done = parseFarmMine({ ...MINE, gather: { ready_at: {}, left_today: 0, day_resets_at: "2026-09-25T17:00:00+00:00" } })!;
    expect(done.gather).toEqual({ readyAt: {}, leftToday: 0, dayResetsAt: ms("2026-09-25T17:00:00Z") });
  });
  it("reads the prices the field shows", () => {
    const s = parseFieldState({ ...ANSWER, critter_prices: { mult: 2.24, ends_at: "2026-09-25T11:00:00+00:00" } })!;
    expect(s.critterPrices).toEqual({ mult: 2.24, endsAt: ms("2026-09-25T11:00:00Z") });
  });
  it("reads a database before 0018 as: no prices, no critters, cap 3, every spot ready, 200 left", () => {
    const s = parseFieldState(ANSWER)!;
    expect(s.critterPrices).toBeNull();
    expect(s.mine).toMatchObject({ critters: {}, critterCap: 3, gather: { readyAt: {}, leftToday: 200, dayResetsAt: null } });
    expect(parseFarmMine({ items: {}, rice: {}, coins: 0, gift_claimed: true })).toMatchObject({ critters: {}, critterCap: 3 });
  });
  it("keeps the newer account part's critters when it merges", () => {
    const next = withMine(parseFieldState(ANSWER)!, parseFarmMine(MINE)!);
    expect(next.mine).toMatchObject({ critterCap: 33, gather: { leftToday: 187 }, ownedPlot: 3 });
  });
});

describe("v17 (§10.5)", () => {
  const RATS = {
    next_at: "2026-09-25T10:14:00+00:00", price: 336,
    live: [{ id: 812, plot: 3, since: "2026-09-25T09:58:00+00:00", seed: 1234567 }], recent: [],
    plots: { 3: [{ r: 812, from: "2026-09-25T09:59:00+00:00", to: null }] },
  };
  const DOG = {
    name: "Mực", coat: "muc", adopted_at: "2026-09-24T08:00:00+00:00", fed_until: "2026-09-26T08:00:00+00:00", next_hunt_at: null,
    catches: 12,
  };
  it("reads the field's rats", () => {
    expect(parseFieldState({ ...ANSWER, rats: RATS })!.rats).toEqual({
      nextAt: ms("2026-09-25T10:14:00Z"), price: 336, live: [{ id: 812, plot: 3, since: ms("2026-09-25T09:58:00Z"), seed: 1234567 }],
      recent: [], plots: { 3: [{ r: 812, from: ms("2026-09-25T09:59:00Z"), to: null }] },
    });
  });
  it("reads the bag, the caps and the dog in the account part", () => {
    const m = parseFarmMine({
      ...ANSWER.mine, rats: { count: 2, value: 486 }, dog: DOG,
      rat_caps: { hour_left: 4, hour_resets_at: "2026-09-25T10:40:00+00:00", day_left: 21 },
    })!;
    expect(m.rats).toEqual({ count: 2, value: 486 });
    expect(m.ratCaps).toEqual({ hourLeft: 4, hourResetsAt: ms("2026-09-25T10:40:00Z"), dayLeft: 21 });
    expect(m.dog).toEqual({
      name: "Mực", coat: "muc", adoptedAt: ms("2026-09-24T08:00:00Z"), fedUntil: ms("2026-09-26T08:00:00Z"), nextHuntAt: null,
      catches: 12,
    });
  });
  it("reads a database before 0019 as: no rats, an empty bag, full caps, no dog", () => {
    const s = parseFieldState(ANSWER)!;
    expect(s.rats).toBeNull();
    expect(s.mine).toMatchObject({ rats: { count: 0, value: 0 }, ratCaps: { hourLeft: 6, hourResetsAt: null, dayLeft: 24 }, dog: null });
  });
  it("keeps the newer account part's bag, caps and dog when it merges", () => {
    const s = parseFieldState({ ...ANSWER, rats: RATS, mine: { ...ANSWER.mine, rats: { count: 2, value: 486 }, dog: DOG } })!;
    const next = withMine(s, parseFarmMine({ ...ANSWER.mine, rats: { count: 0, value: 0 }, dog: DOG })!);
    expect(next.mine.rats).toEqual({ count: 0, value: 0 });
    expect(next.mine.dog?.name).toBe("Mực");
    expect(next.rats?.price).toBe(336);
  });
});
