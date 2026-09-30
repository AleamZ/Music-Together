// v21 economy (supabase/migrations/0073_player_economy.sql): player trading, the Chợ người chơi board, the auction
// house and the rented stalls at Chợ Lớn. Every price, fee, band and time is the server's; these are display copies
// pinned to the SQL by tests/unit/economy-sql.test.ts. Pure.

export type AssetKind = "fish" | "fashion" | "produce";

/** % of a sale burned (board, stall, auction). */
export const SALE_FEE_PERCENT = 5;
/** Kinh tế v2 (0106): the thương nhân perk market_sell_pct lowers that fee, to at least this. */
export const SALE_FEE_MIN_PERCENT = 2;
/** The price band, % of the NPC value. */
export const BAND_MIN_PERCENT = 50;
export const BAND_MAX_PERCENT = 300;
/** The board's listing fee: 2 % of the price, at least 5 xu; half back if the listing expires unsold. */
export const LIST_FEE_PERCENT = 2;
export const LIST_FEE_MIN = 5;
export const LIST_HOURS = 72;
export const MAX_OPEN = 20;
/** Auctions: the asset is worth at least this; raises of 5 % (≥ 10 xu); bids up to 500 % of the value; a bid in the
 *  last 2 minutes pushes the end to 2 minutes from then. */
export const AUCTION_MIN_VALUE = 300;
export const AUCTION_INC_PERCENT = 5;
export const AUCTION_INC_MIN = 10;
export const AUCTION_CAP_PERCENT = 500;
export const SNIPE_SECONDS = 120;
export const AUCTION_HOURS = [1, 6, 12, 24] as const;
/** Stalls: rent per day (Kinh tế v2, 0106: 200 → 500), at most 7 days ahead, 8 items, 6 stalls. */
export const STALL_DAY = 500;
export const STALL_MAX_DAYS = 7;
export const STALL_SLOTS = 8;
export const STALLS = 6;
/** Trading: partners within 320 px on the same map; an untouched window closes after 10 minutes; 8 assets a side. */
export const TRADE_PX = 320;
export const TRADE_IDLE_MIN = 10;
export const TRADE_ITEMS = 8;
/** Kinh tế v2 (0106): the xu of a trade burn TRADE_FEE_PERCENT % (the knob p2p_fee_pct; the window shows the live value);
 *  only an account at least RECV_MIN_DAYS days old at level RECV_MIN_LEVEL receives xu, at most TRADE_DAILY_IN a day
 *  (the knob trade_daily_in). Items stay free. */
export const TRADE_FEE_PERCENT = 5;
export const RECV_MIN_DAYS = 3;
export const RECV_MIN_LEVEL = 5;
export const TRADE_DAILY_IN = 50_000;

export const inBand = (price: number, value: number): boolean =>
  Number.isInteger(price) && value > 0 && price * 100 >= value * BAND_MIN_PERCENT && price * 100 <= value * BAND_MAX_PERCENT;

export const band = (value: number): { min: number; max: number } => ({
  min: Math.ceil((value * BAND_MIN_PERCENT) / 100),
  max: Math.floor((value * BAND_MAX_PERCENT) / 100),
});

export const listFee = (price: number): number => Math.max(LIST_FEE_MIN, Math.floor((price * LIST_FEE_PERCENT) / 100));

/** The sale fee of a seller with `perk` % of market_sell_pct (0106 _econ_fee_pct). */
export const saleFeePercent = (perk = 0): number => Math.max(SALE_FEE_MIN_PERCENT, SALE_FEE_PERCENT - Math.min(30, Math.max(0, perk)));

export const saleShare = (price: number, feePct = SALE_FEE_PERCENT): { seller: number; fee: number } => {
  const seller = Math.floor((price * (100 - feePct)) / 100);
  return { seller, fee: price - seller };
};

/** What the receiver of `gross` xu in a trade gets (0106 _econ_trade_got). */
export const tradeReceives = (gross: number, feePct = TRADE_FEE_PERCENT): number =>
  Math.floor((Math.max(0, gross) * (100 - feePct)) / 100);

export const minBid = (start: number, top: number | null): number =>
  top === null ? start : top + Math.max(AUCTION_INC_MIN, Math.floor((top * AUCTION_INC_PERCENT + 99) / 100));

export const kindIcon = (k: AssetKind): string => (k === "fish" ? "🐟" : k === "fashion" ? "👕" : "🥔");
export const kindName = (k: AssetKind): string => (k === "fish" ? "Cá" : k === "fashion" ? "Thời trang" : "Nông sản");

// ---------------------------------------------------------------- parsers

export interface Asset {
  kind: AssetKind; ref: string; qty: number;
  /** The NPC value: of the whole lot for a listing or an offer; per kg for my produce in `assets`. */
  value: number;
  name: string; rarity: number | null;
  /** How much of it my open listings and auctions hold (kg for produce). */
  reserved: number;
}
export interface Listing extends Asset {
  id: number; price: number; fee: number; status: string; stall: number | null; sellerName: string; mine: boolean;
  createdMs: number; expiresMs: number;
}
export interface Auction extends Asset {
  id: number; start: number; top: number | null; bids: number; status: string; minBid: number; maxBid: number;
  sellerName: string; mine: boolean; leading: boolean; topName: string | null; endsMs: number;
}
export interface Stall { no: number; mine: boolean; renterName: string | null; paidMs: number | null; items: Listing[] }
export interface EconState {
  coins: number; assets: Asset[]; listings: Listing[]; mine: Listing[]; auctions: Auction[]; stalls: Stall[]; serverNowMs: number;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const kind = (v: unknown): AssetKind | null => (v === "fish" || v === "fashion" || v === "produce" ? v : null);

export function parseAsset(v: unknown): Asset | null {
  const o = obj(v);
  const k = o ? kind(o.kind) : null, ref = o ? str(o.ref) : null;
  if (!o || !k || ref === null) return null;
  return {
    kind: k, ref, qty: num(o.qty) ?? 1, value: num(o.value) ?? 0, name: str(o.name) ?? ref, rarity: num(o.rarity),
    reserved: num(o.reserved) ?? 0,
  };
}

function parseListing(v: unknown): Listing | null {
  const a = parseAsset(v), o = obj(v);
  const id = o ? num(o.id) : null, price = o ? num(o.price) : null;
  if (!a || !o || id === null || price === null) return null;
  return {
    ...a, id, price, fee: num(o.fee) ?? 0, status: str(o.status) ?? "open", stall: num(o.stall), sellerName: str(o.seller_name) ?? "Ai đó",
    mine: o.mine === true, createdMs: num(o.created_ms) ?? 0, expiresMs: num(o.expires_ms) ?? 0,
  };
}

function parseAuction(v: unknown): Auction | null {
  const a = parseAsset(v), o = obj(v);
  const id = o ? num(o.id) : null, start = o ? num(o.start) : null;
  if (!a || !o || id === null || start === null) return null;
  const top = num(o.top);
  return {
    ...a, id, start, top, bids: num(o.bids) ?? 0, status: str(o.status) ?? "open", minBid: num(o.min_bid) ?? minBid(start, top),
    maxBid: num(o.max_bid) ?? 0, sellerName: str(o.seller_name) ?? "Ai đó", mine: o.mine === true, leading: o.leading === true,
    topName: str(o.top_name), endsMs: num(o.ends_ms) ?? 0,
  };
}

const some = <T,>(xs: unknown, f: (v: unknown) => T | null): T[] => arr(xs).flatMap((x) => { const r = f(x); return r ? [r] : []; });

export function parseEconState(data: unknown): EconState | null {
  const r = obj(data);
  const now = r ? num(r.server_now_ms) : null;
  if (!r || now === null) return null;
  return {
    coins: num(r.coins) ?? 0,
    assets: some(r.assets, parseAsset),
    listings: some(r.listings, parseListing),
    mine: some(r.mine, parseListing),
    auctions: some(r.auctions, parseAuction),
    stalls: some(r.stalls, (v) => {
      const o = obj(v);
      const no = o ? num(o.no) : null;
      if (!o || no === null) return null;
      return { no, mine: o.mine === true, renterName: str(o.renter_name), paidMs: num(o.paid_ms), items: some(o.items, parseListing) };
    }),
    serverNowMs: now,
  };
}

export interface Offer { coins: number; items: Asset[] }
/** 0106: may this side receive xu (account age and level), and how much more today. */
export interface Recv { ok: boolean; left: number }
export interface Trade {
  id: number; rev: number; opener: boolean; partnerId: string; partnerName: string; mine: Offer; theirs: Offer; myOk: boolean; theirOk: boolean;
  /** 0106: the burn on the xu leg, in %; who may receive (null from an older server). */
  feePct: number; myRecv: Recv | null; theirRecv: Recv | null;
}
export interface TradeState { trade: Trade | null; lastDone: { id: number; partnerName: string; status: string } | null; coins: number; serverNowMs: number }

const offer = (v: unknown): Offer => {
  const o = obj(v);
  return { coins: num(o?.coins) ?? 0, items: some(o?.items, parseAsset) };
};

const recv = (v: unknown): Recv | null => {
  const o = obj(v);
  const left = o ? num(o.left) : null;
  return o && typeof o.ok === "boolean" && left !== null ? { ok: o.ok, left } : null;
};

export function parseTradeState(data: unknown): TradeState | null {
  const r = obj(data);
  const now = r ? num(r.server_now_ms) : null;
  if (!r || now === null) return null;
  const t = obj(r.trade);
  const id = t ? num(t.id) : null, rev = t ? num(t.rev) : null;
  const trade: Trade | null = t && id !== null && rev !== null ? {
    id, rev, opener: t.opener === true, partnerId: str(t.partner_id) ?? "", partnerName: str(t.partner_name) ?? "Ai đó",
    mine: offer(t.mine), theirs: offer(t.theirs), myOk: t.my_ok === true, theirOk: t.their_ok === true,
    feePct: num(t.fee_pct) ?? TRADE_FEE_PERCENT, myRecv: recv(t.my_recv), theirRecv: recv(t.their_recv),
  } : null;
  const d = obj(r.last_done);
  const did = d ? num(d.id) : null;
  return {
    trade,
    lastDone: d && did !== null ? { id: did, partnerName: str(d.partner_name) ?? "Ai đó", status: str(d.status) ?? "" } : null,
    coins: num(r.coins) ?? 0,
    serverNowMs: now,
  };
}

/** The xu leg of a trade as it stands (0106): who receives the net, what they get after the burn, and what would make
 *  the server refuse it — 'age' (account too new or level too low) or 'limit' (over today's allowance). Null: no xu move. */
export interface XuLeg { toMe: boolean; gross: number; got: number; blocked: "age" | "limit" | null; left: number | null }
export function tradeXuLeg(t: Trade): XuLeg | null {
  const net = t.theirs.coins - t.mine.coins;                  // what I gain
  if (net === 0) return null;
  const toMe = net > 0, gross = Math.abs(net), got = tradeReceives(gross, t.feePct);
  const r = toMe ? t.myRecv : t.theirRecv;
  const blocked = r === null ? null : !r.ok ? "age" : got > r.left ? "limit" : null;
  return { toMe, gross, got, blocked, left: r?.left ?? null };
}

/** What the server takes as an offer. */
export const offerArg = (o: Offer) => ({
  coins: o.coins,
  items: o.items.map((a) => (a.kind === "produce" ? { kind: a.kind, ref: a.ref, qty: a.qty } : { kind: a.kind, ref: a.ref })),
});

/** How much of an asset is free to list or offer (kg for produce, else 0 or 1). */
export const freeQty = (a: Asset): number => Math.max(0, a.qty - a.reserved);

/** The NPC value of `qty` of my asset (produce is priced per kg in `assets`). */
export const assetValue = (a: Asset, qty: number): number => (a.kind === "produce" ? a.value * qty : a.value);

// ---------------------------------------------------------------- texts

const REFUSALS: ReadonlyArray<[string, string]> = [
  ["insufficient funds", "Không đủ xu."],
  ["bad price", `Giá phải trong khoảng ${BAND_MIN_PERCENT} %–${BAND_MAX_PERCENT} % giá trị (giá thu mua của NPC).`],
  ["not owned", "Bạn không còn món này (hoặc nó đang được rao bán ở chỗ khác)."],
  ["own listing", "Đây là hàng của bạn mà!"],
  ["no listing", "Món hàng không còn nữa."],
  ["price changed", "Giá đã thay đổi — xem lại nhé."],
  ["asset gone", "Người bán không còn món này — tin rao đã bị gỡ."],
  ["bucket full", "Giỏ cá đã đầy — bán bớt cá hoặc mua giỏ lớn hơn."],
  ["already owned", "Bạn đã có món đồ này rồi."],
  ["too many listings", `Tối đa ${MAX_OPEN} món đang rao cùng lúc.`],
  ["slow down", "Rao bán nhiều quá — nghỉ tay một chút nhé."],
  ["not rare", `Chỉ đấu giá được hàng hiếm (giá trị từ ${AUCTION_MIN_VALUE} xu).`],
  ["bid too low", "Giá đặt thấp hơn mức tối thiểu."],
  ["bid too high", `Giá đặt vượt ${AUCTION_CAP_PERCENT} % giá trị món hàng.`],
  ["auction closed", "Phiên đấu giá đã kết thúc."],
  ["cannot cancel", "Đã có người đặt giá — không rút được nữa."],
  ["bad hours", "Thời lượng không hợp lệ."],
  ["not at market", "Hãy đứng ở dãy sạp cho thuê (chú Bảy) ở Chợ Lớn."],
  ["stall taken", "Sạp này đã có người thuê."],
  ["already renting", "Bạn đang thuê một sạp khác rồi."],
  ["no stall", "Bạn chưa thuê sạp (hoặc sạp đã hết hạn)."],
  ["stall full", `Sạp chỉ bày được ${STALL_SLOTS} món.`],
  ["bad days", `Thuê tối đa ${STALL_MAX_DAYS} ngày trước.`],
  ["too far", "Hai người phải đứng gần nhau (cùng khu vực) mới giao dịch được."],
  ["partner busy", "Người kia đang giao dịch với người khác."],
  ["already trading", "Bạn đang có một giao dịch chưa xong."],
  ["bad partner", "Không giao dịch được với người này."],
  ["no trade", "Giao dịch đã đóng."],
  ["offer changed", "Đề nghị vừa thay đổi — xem lại rồi xác nhận lần nữa."],
  ["empty trade", "Chưa ai đưa gì vào giao dịch."],
  ["cannot receive xu", `Người nhận xu phải có tài khoản từ ${RECV_MIN_DAYS} ngày tuổi và đạt cấp ${RECV_MIN_LEVEL} trở lên (đồ vật thì đổi thoải mái).`],
  ["receive limit", "Số xu này vượt mức người nhận còn được nhận qua giao dịch hôm nay — bớt xu lại hoặc mai đổi tiếp nhé."],
  ["account locked", "Tài khoản đang bị tạm khoá."],
  ["rate limited", "Thao tác quá nhanh — chờ một chút rồi thử lại nhé."],
  ["client outdated", "Trang đã cũ — tải lại trang nhé."],
];

export function econErrorMessage(msg: string): string {
  for (const [k, text] of REFUSALS) if (msg.includes(k)) return text;
  return "Có lỗi, thử lại sau nhé.";
}

export const econErrText = (e: unknown): string =>
  econErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

/** "2 giờ 5 phút" / "45 giây". */
export function leftText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} giây`;
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d} ngày ${h % 24} giờ`;
  if (h > 0) return `${h} giờ ${m % 60} phút`;
  return `${m} phút`;
}
