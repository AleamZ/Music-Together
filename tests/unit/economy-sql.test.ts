import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUCTION_CAP_PERCENT, AUCTION_INC_MIN, AUCTION_INC_PERCENT, AUCTION_MIN_VALUE, BAND_MAX_PERCENT, BAND_MIN_PERCENT, band,
  econErrorMessage, inBand, LIST_FEE_MIN, LIST_FEE_PERCENT, LIST_HOURS, listFee, MAX_OPEN, minBid, offerArg, parseEconState,
  parseTradeState, SALE_FEE_PERCENT, saleShare, SNIPE_SECONDS, STALL_DAY, STALL_MAX_DAYS, STALL_SLOTS, STALLS, TRADE_IDLE_MIN,
  TRADE_ITEMS, TRADE_PX,
} from "@/lib/game/economy/model";
import { buildMarketMap } from "@/lib/game/maps/market";
import { SHELL_PANEL_OF } from "@/lib/game/shell-kinds";

const SQL = readFileSync("supabase/migrations/0073_player_economy.sql", "utf8").replace(/\r\n/g, "\n");
const rule = (k: string): number => {
  const m = SQL.match(new RegExp(`when '${k}' then (\\d+)`));
  expect(m, k).not.toBeNull();
  return Number(m![1]);
};

describe("v21 economy: the TS rules mirror 0073", () => {
  it("fees, bands, auctions, stalls, trades", () => {
    expect(rule("fee")).toBe(SALE_FEE_PERCENT);
    expect(rule("min")).toBe(BAND_MIN_PERCENT);
    expect(rule("max")).toBe(BAND_MAX_PERCENT);
    expect(rule("list_fee")).toBe(LIST_FEE_PERCENT);
    expect(rule("list_fee_min")).toBe(LIST_FEE_MIN);
    expect(rule("list_hours")).toBe(LIST_HOURS);
    expect(rule("max_open")).toBe(MAX_OPEN);
    expect(rule("auc_value")).toBe(AUCTION_MIN_VALUE);
    expect(rule("auc_inc")).toBe(AUCTION_INC_PERCENT);
    expect(rule("auc_inc_min")).toBe(AUCTION_INC_MIN);
    expect(rule("auc_cap")).toBe(AUCTION_CAP_PERCENT);
    expect(rule("snipe_s")).toBe(SNIPE_SECONDS);
    expect(rule("stall_day")).toBe(STALL_DAY);
    expect(rule("stall_days")).toBe(STALL_MAX_DAYS);
    expect(rule("stall_slots")).toBe(STALL_SLOTS);
    expect(rule("stalls")).toBe(STALLS);
    expect(rule("trade_px")).toBe(TRADE_PX);
    expect(rule("trade_idle_min")).toBe(TRADE_IDLE_MIN);
    expect(rule("trade_items")).toBe(TRADE_ITEMS);
    expect(SQL).toContain("p_hours not in (1, 6, 12, 24)");
  });

  it("every RPC is guarded and granted; no coin_ledger check is re-created", () => {
    const rpcs = ["econ_state", "market_list", "market_cancel", "market_buy", "auction_create", "auction_bid", "auction_cancel",
      "shop_rent", "shop_stock", "shop_buy", "trade_state", "trade_offer", "trade_confirm", "trade_cancel"];
    for (const fn of rpcs) {
      const from = SQL.indexOf(`create or replace function public.${fn}(`);
      expect(from, fn).toBeGreaterThanOrEqual(0);
      expect(SQL.slice(from, SQL.indexOf("$$;", from)), fn).toContain("public._ac_account(p_session_token)");
      expect(SQL).toContain(`'${fn}(`);
    }
    expect(SQL).toContain("public._ac_play(p_room_id, p_session_token)");
    expect(SQL).not.toContain("add constraint coin_ledger_reason_check");
    for (const ev of ["'trade_done'", "'market_sold'", "'auction_won'"]) expect(SQL).toContain(ev);
  });

  it("the stall claim matches the map's desk", () => {
    const desk = buildMarketMap().interactables.find((i) => i.id === "player_stalls")!;
    expect(desk.kind).toBe("player_stalls");
    expect(SHELL_PANEL_OF.player_stalls).toBe("player_stalls");
    expect(SQL).toContain(`_pos_claim(v_account, 'market', ${desk.use!.x}, ${desk.use!.y}, 'shop_buy'`);
  });
});

describe("v21 economy model", () => {
  it("band, fee, share, min bid", () => {
    expect(band(100)).toEqual({ min: 50, max: 300 });
    expect(inBand(50, 100) && inBand(300, 100) && !inBand(49, 100) && !inBand(301, 100)).toBe(true);
    expect(band(101).min).toBe(51);
    expect(inBand(51, 101) && !inBand(50, 101)).toBe(true);
    expect(listFee(100)).toBe(5);
    expect(listFee(1000)).toBe(20);
    expect(saleShare(600)).toEqual({ seller: 570, fee: 30 });
    expect(minBid(400, null)).toBe(400);
    expect(minBid(400, 400)).toBe(420);
    expect(minBid(100, 100)).toBe(110);
    expect(minBid(1000, 1050)).toBe(1103);
  });

  it("parses the state and the trade", () => {
    const s = parseEconState({
      coins: 90, server_now_ms: 5,
      assets: [{ kind: "produce", ref: "khoai", qty: 20, value: 265, name: "Khoai", reserved: 5 }, { kind: "bad" }],
      listings: [{ kind: "fish", ref: "x", qty: 1, value: 400, name: "Cá rô", id: 3, price: 600, seller_name: "An", mine: false, stall: null }],
      mine: [], auctions: [{ kind: "fish", ref: "y", qty: 1, value: 1000, name: "Cá", id: 9, start: 1000, top: null, min_bid: 1000, max_bid: 5000 }],
      stalls: [{ no: 1, mine: true, renter_name: "Bạn", paid_ms: 99, items: [] }],
    })!;
    expect(s.assets).toHaveLength(1);
    expect(s.listings[0]).toMatchObject({ id: 3, price: 600, stall: null, sellerName: "An" });
    expect(s.auctions[0]).toMatchObject({ id: 9, top: null, minBid: 1000, maxBid: 5000 });
    expect(s.stalls[0]).toMatchObject({ no: 1, mine: true, paidMs: 99 });
    expect(parseEconState({})).toBeNull();
    const t = parseTradeState({
      server_now_ms: 1, coins: 5, last_done: null,
      trade: { id: 4, rev: 2, opener: true, partner_id: "p", partner_name: "Bình", mine: { coins: 10, items: [] },
        theirs: { coins: 0, items: [{ kind: "fashion", ref: "hat", qty: 1, value: 60, name: "Mũ" }] }, my_ok: true, their_ok: false },
    })!;
    expect(t.trade).toMatchObject({ id: 4, rev: 2, partnerName: "Bình", myOk: true, theirOk: false });
    expect(t.trade!.theirs.items[0].ref).toBe("hat");
    expect(parseTradeState({ server_now_ms: 1, trade: null })!.trade).toBeNull();
  });

  it("the offer argument keeps only kind, ref and the produce qty", () => {
    expect(offerArg({ coins: 3, items: [
      { kind: "fish", ref: "a", qty: 1, value: 1, name: "", rarity: null, reserved: 0 },
      { kind: "produce", ref: "khoai", qty: 4, value: 1, name: "", rarity: null, reserved: 0 },
    ] })).toEqual({ coins: 3, items: [{ kind: "fish", ref: "a" }, { kind: "produce", ref: "khoai", qty: 4 }] });
  });

  it("refusal texts", () => {
    expect(econErrorMessage("too far")).toMatch(/đứng gần/);
    expect(econErrorMessage("bad price")).toMatch(/50 %–300 %/);
    expect(econErrorMessage("zzz")).toBe("Có lỗi, thử lại sau nhé.");
  });
});
