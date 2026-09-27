// v19.4 Sàn bất động sản (spec §19.4; rulings in docs/superpowers/plans/2026-09-27-v19-4-real-estate.md): players sell
// their bought flat or their lot (with its house) to each other at Khu nhà's office. Every price, fee and time is the
// server's (supabase/migrations/0043_real_estate.sql); these are display copies pinned by tests/unit/estate-sql.test.ts.

import { supabase } from "@/lib/supabase";
import { APT_BUY, furnitureOf } from "./apartment";
import { LAND_PRICE } from "./house";
import type { Roof } from "./lot";

export type EstateKind = "apt" | "lot";
/** The seller gets 95 %; 5 % is burned. */
export const ESTATE_FEE_PERCENT = 5;
export const ESTATE_SELLER_PERCENT = 100 - ESTATE_FEE_PERCENT;
/** The price band, in % of the appraisal. */
export const ESTATE_MIN_PERCENT = 50;
export const ESTATE_MAX_PERCENT = 300;
/** A house counts 80 % of what its builder was paid. */
export const BUILD_APPRAISE_PERCENT = 80;
export const LISTING_DAYS = 14;
export const RELIST_COOLDOWN_HOURS = 24;
/** The same two accounts cannot trade again within 7 days; within 30 days the sale is flagged for the admin. */
export const ROUND_TRIP_DAYS = 7;
export const FLAG_DAYS = 30;
/** A sale this big makes the Báo Làng. */
export const BIG_SALE = 50000;
export const SALES_SHOWN = 30;

/** The appraisal: a flat's list price, or the land + 80 % of the build cost; plus the furniture left in. */
export function appraise(kind: EstateKind, buildCost: number, furniture: readonly string[]): number {
  const base = kind === "apt" ? APT_BUY : LAND_PRICE + Math.floor((buildCost * BUILD_APPRAISE_PERCENT) / 100);
  return base + furniture.reduce((a, id) => a + (furnitureOf(id)?.price ?? 0), 0);
}

export const priceBand = (appraisal: number): { min: number; max: number } => ({
  min: Math.floor((appraisal * ESTATE_MIN_PERCENT + 99) / 100),
  max: Math.floor((appraisal * ESTATE_MAX_PERCENT) / 100),
});

export const saleShare = (price: number): { seller: number; fee: number } => {
  const seller = Math.floor((price * ESTATE_SELLER_PERCENT) / 100);
  return { seller, fee: price - seller };
};

export const kindName = (k: EstateKind): string => (k === "apt" ? "Căn hộ" : "Lô đất");
export const propertyName = (k: EstateKind, no: number): string => `${kindName(k)} ${no}`;

// ---------------------------------------------------------------- parsers

export interface Listing {
  id: number; kind: EstateKind; no: number; price: number; withFurniture: boolean; appraisal: number; items: number; tenants: number;
  sellerName: string | null; mine: boolean; listedMs: number; expiresMs: number; grid: string | null; roof: Roof | null;
}
export interface OwnProperty { kind: EstateKind; no: number; bare: number; full: number; items: number; listed: boolean }
export interface Sale {
  id: number; kind: EstateKind; no: number; price: number; withFurniture: boolean; sellerName: string | null; buyerName: string | null;
  soldMs: number; flagged: boolean;
}
export interface EstateState {
  listings: Listing[]; own: OwnProperty | null; cooldownMs: number | null; sales: Sale[]; serverNowMs: number; coins?: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const kind = (v: unknown): EstateKind | null => (v === "apt" || v === "lot" ? v : null);
const roof = (v: unknown): Roof | null => (v === "ngoi" || v === "tole" || v === "la" || v === "bang" ? v : null);

export function parseEstateState(data: unknown): EstateState | null {
  const r = obj(data);
  const now = r ? num(r.server_now_ms) : null;
  if (!r || now === null) return null;
  const listings = arr(r.listings).flatMap((x): Listing[] => {
    const o = obj(x);
    const id = o ? num(o.id) : null, k = o ? kind(o.kind) : null, no = o ? num(o.no) : null, price = o ? num(o.price) : null;
    if (!o || id === null || k === null || no === null || price === null) return [];
    return [{
      id, kind: k, no, price, withFurniture: o.with_furniture === true, appraisal: num(o.appraisal) ?? 0, items: num(o.items) ?? 0,
      tenants: num(o.tenants) ?? 0, sellerName: str(o.seller_name), mine: o.mine === true, listedMs: num(o.listed_ms) ?? 0,
      expiresMs: num(o.expires_ms) ?? 0, grid: str(o.grid), roof: roof(o.roof),
    }];
  });
  const w = obj(r.own);
  const wk = w ? kind(w.kind) : null, wn = w ? num(w.no) : null;
  const own: OwnProperty | null = w && wk && wn !== null
    ? { kind: wk, no: wn, bare: num(w.bare) ?? 0, full: num(w.full) ?? 0, items: num(w.items) ?? 0, listed: w.listed === true } : null;
  const sales = arr(r.sales).flatMap((x): Sale[] => {
    const o = obj(x);
    const id = o ? num(o.id) : null, k = o ? kind(o.kind) : null, no = o ? num(o.no) : null, price = o ? num(o.price) : null;
    if (!o || id === null || k === null || no === null || price === null) return [];
    return [{
      id, kind: k, no, price, withFurniture: o.with_furniture === true, sellerName: str(o.seller_name), buyerName: str(o.buyer_name),
      soldMs: num(o.sold_ms) ?? 0, flagged: o.flagged === true,
    }];
  });
  const out: EstateState = { listings, own, cooldownMs: num(r.cooldown_ms), sales, serverNowMs: now };
  const coins = num(r.coins);
  if (coins !== null) out.coins = coins;
  return out;
}

// ---------------------------------------------------------------- texts

const REFUSALS: ReadonlyArray<[string, string]> = [
  ["insufficient funds", "Không đủ xu."],
  ["already have a home", "Bạn đã có nhà rồi (căn hộ, lô đất hoặc phòng thuê) — mỗi người một nhà thôi."],
  ["suspicious trade", `Hai người vừa mua bán nhà với nhau trong ${ROUND_TRIP_DAYS} ngày qua — sàn không nhận giao dịch qua lại.`],
  ["listing stale", "Tin rao đã cũ (tài sản hoặc nội thất đã đổi) — tin đã được gỡ."],
  ["price changed", "Giá đã thay đổi — xem lại tin rao nhé."],
  ["own listing", "Đây là tin rao của bạn mà!"],
  ["no listing", "Tin rao không còn nữa."],
  ["already listed", "Bạn đang rao bán rồi — gỡ tin cũ trước đã."],
  ["cooldown", `Vừa gỡ tin, hết hạn hoặc vừa mua — chờ ${RELIST_COOLDOWN_HOURS} giờ rồi hãy rao lại.`],
  ["bad price", `Giá phải trong khoảng ${ESTATE_MIN_PERCENT} %–${ESTATE_MAX_PERCENT} % giá thẩm định.`],
  ["not owned", "Bạn không sở hữu tài sản này (căn hộ phải mua đứt, không phải thuê)."],
  ["upkeep due", "Lô đất đang nợ phí giữ đất — đóng phí trước đã."],
  ["bad kind", "Có lỗi, thử lại sau nhé."],
];

export function estateErrorMessage(msg: string): string {
  for (const [k, text] of REFUSALS) if (msg.includes(k)) return text;
  return "Có lỗi, thử lại sau nhé.";
}

export const estateErrText = (e: unknown): string =>
  estateErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

// ---------------------------------------------------------------- RPCs

async function rpc(fn: string, args: Record<string, unknown>): Promise<EstateState> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const out = parseEstateState(data);
  if (out === null) throw new Error("bad answer");
  return out;
}

const T = (token: string) => ({ p_session_token: token });
export const estateState = (token: string) => rpc("estate_state", T(token));
export const estateList = (token: string, k: EstateKind, price: number, withFurniture: boolean) =>
  rpc("estate_list", { ...T(token), p_kind: k, p_price: price, p_with_furniture: withFurniture });
export const estateCancel = (token: string) => rpc("estate_cancel", T(token));
export const estateBuy = (token: string, listing: number, price: number) => rpc("estate_buy", { ...T(token), p_listing: listing, p_price: price });
