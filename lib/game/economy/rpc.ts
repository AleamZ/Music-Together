// v21 economy RPCs (0073). Every call goes through the anti-cheat screen: a lock is reported, and a refused position
// claim (the stalls) comes back as an envelope whose refusal is thrown.

import { AnticheatError, screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { offerArg, parseEconState, parseTradeState, type AssetKind, type EconState, type Offer, type TradeState } from "./model";

async function call<T>(fn: string, args: Record<string, unknown>, parse: (d: unknown) => T | null): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  const ac = screenAnswer(data, error);
  if (error) throw error;
  if (ac) throw new AnticheatError(ac);
  const out = parse(data);
  if (out === null) throw new Error("bad answer");
  return out;
}

const T = (token: string) => ({ p_session_token: token });
const econ = (fn: string, args: Record<string, unknown>) => call<EconState>(fn, args, parseEconState);
const trade = (fn: string, args: Record<string, unknown>) => call<TradeState>(fn, args, parseTradeState);

export const econState = (token: string) => econ("econ_state", T(token));
export const marketList = (token: string, kind: AssetKind, ref: string, qty: number, price: number) =>
  econ("market_list", { ...T(token), p_kind: kind, p_ref: ref, p_qty: qty, p_price: price });
export const marketCancel = (token: string, id: number) => econ("market_cancel", { ...T(token), p_listing: id });
export const marketBuy = (token: string, id: number, price: number) => econ("market_buy", { ...T(token), p_listing: id, p_price: price });
export const auctionCreate = (token: string, kind: AssetKind, ref: string, qty: number, start: number, hours: number) =>
  econ("auction_create", { ...T(token), p_kind: kind, p_ref: ref, p_qty: qty, p_start: start, p_hours: hours });
export const auctionBid = (token: string, id: number, amount: number) => econ("auction_bid", { ...T(token), p_auction: id, p_amount: amount });
export const auctionCancel = (token: string, id: number) => econ("auction_cancel", { ...T(token), p_auction: id });
export const shopRent = (token: string, stall: number, days: number) => econ("shop_rent", { ...T(token), p_stall: stall, p_days: days });
export const shopStock = (token: string, kind: AssetKind, ref: string, qty: number, price: number) =>
  econ("shop_stock", { ...T(token), p_kind: kind, p_ref: ref, p_qty: qty, p_price: price });
export const shopBuy = (token: string, id: number, price: number) => econ("shop_buy", { ...T(token), p_listing: id, p_price: price });

export const tradeState = (token: string) => trade("trade_state", T(token));
export const tradeOpen = (roomId: string, token: string, partner: string) =>
  trade("trade_open", { p_room_id: roomId, ...T(token), p_partner: partner });
export const tradeOffer = (token: string, id: number, o: Offer) => trade("trade_offer", { ...T(token), p_trade: id, p_offer: offerArg(o) });
export const tradeConfirm = (token: string, id: number, rev: number) => trade("trade_confirm", { ...T(token), p_trade: id, p_rev: rev });
export const tradeCancel = (token: string, id: number) => trade("trade_cancel", { ...T(token), p_trade: id });
