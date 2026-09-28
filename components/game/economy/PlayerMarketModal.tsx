"use client";

import { useEffect, useState } from "react";
import { formatXu } from "@/lib/game/fishing/catalog";
import {
  AUCTION_CAP_PERCENT, AUCTION_HOURS, AUCTION_MIN_VALUE, BAND_MAX_PERCENT, BAND_MIN_PERCENT, econErrText, kindIcon, kindName,
  leftText, LIST_FEE_PERCENT, LIST_HOURS, listFee, SALE_FEE_PERCENT, saleShare, SNIPE_SECONDS,
  type AssetKind, type Auction, type EconState, type Listing,
} from "@/lib/game/economy/model";
import { auctionBid, auctionCancel, auctionCreate, econState, marketBuy, marketCancel, marketList } from "@/lib/game/economy/rpc";
import { ParchmentModal } from "../Parchment";
import SellForm from "./SellForm";
import StallRowView from "./StallRowView";

type Tab = "browse" | "sell" | "mine" | "auction";
const TABS: ReadonlyArray<{ id: Tab; name: string }> = [
  { id: "browse", name: "🛒 Chợ" }, { id: "sell", name: "📝 Rao bán" }, { id: "mine", name: "📋 Tin của tôi" }, { id: "auction", name: "🔨 Đấu giá" },
];
const STATUS: Record<string, string> = { open: "đang rao", sold: "đã bán", expired: "hết hạn", cancelled: "đã gỡ", void: "bị huỷ (hết hàng)" };

/** 🏪 Chợ người chơi (v21 #41, #42): browse and search what players sell, list my fish, clothes and produce at my own
 *  price, my listings, and the auction house for rare things. Every price, fee and rule is the server's. */
export default function PlayerMarketModal({ token, onChanged, onClose }: {
  token: string;
  /** Coins changed: the shell reloads the wallet. */
  onChanged: () => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<EconState | null>(null);
  const [tab, setTab] = useState<Tab>("browse");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AssetKind | "">("");
  const [confirm, setConfirm] = useState<number | null>(null);
  const [bids, setBids] = useState<Record<number, string>>({});
  const [hours, setHours] = useState<number>(6);

  useEffect(() => {
    let live = true;
    econState(token).then((s) => { if (live) setState(s); }, (e: unknown) => { if (live) setError(econErrText(e)); });
    return () => { live = false; };
  }, [token]);

  const act = async (fn: () => Promise<EconState>, done: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setState(await fn());
      setNotice(done);
      onChanged();
    } catch (e) {
      setError(econErrText(e));
      econState(token).then(setState, () => {});
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const now = state?.serverNowMs ?? 0;
  const q = query.trim().toLowerCase();
  const shown = (state?.listings ?? []).filter((l) => (!kind || l.kind === kind) && (!q || l.name.toLowerCase().includes(q) || l.sellerName.toLowerCase().includes(q)));

  const listingRow = (l: Listing) => (
    <li key={l.id} className="flex flex-col gap-1 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid={`econ-listing-${l.id}`}>
      <p className="font-bold text-burgundy">{kindIcon(l.kind)} {l.name} · {formatXu(l.price)}</p>
      <p className="text-base">
        Người bán: <b>{l.sellerName}</b> · giá trị {formatXu(l.value)}
        {l.status === "open" ? ` · còn ${leftText(l.expiresMs - now)}` : ` · ${STATUS[l.status] ?? l.status}`}
        {l.stall !== null && ` · sạp ${l.stall}`}
      </p>
      {l.status === "open" && (l.mine ? (
        <div><button type="button" className="pch-btn" disabled={busy} onClick={() => void act(() => marketCancel(token, l.id), "Đã gỡ tin.")}>Gỡ tin</button></div>
      ) : l.stall === null && (confirm === l.id ? (
        <span className="flex flex-wrap items-center gap-2">
          <span>Mua {l.name} với giá {formatXu(l.price)}?</span>
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void act(() => marketBuy(token, l.id, l.price), `Đã mua ${l.name}!`)}>Đồng ý mua</button>
          <button type="button" className="pch-btn" onClick={() => setConfirm(null)}>Thôi</button>
        </span>
      ) : (
        <div>
          <button type="button" className="pch-btn pch-btn-primary" disabled={busy || (state?.coins ?? 0) < l.price} onClick={() => setConfirm(l.id)}>
            Mua · {formatXu(l.price)}
          </button>
        </div>
      )))}
    </li>
  );

  const auctionRow = (a: Auction) => {
    const text = bids[a.id] ?? "";
    const amount = Number(text || a.minBid);
    const open = a.status === "open" && a.endsMs > now;
    return (
      <li key={a.id} className="flex flex-col gap-1 rounded-sm border-2 border-gold-300 bg-cream p-2" data-testid={`econ-auction-${a.id}`}>
        <p className="font-bold text-burgundy">🔨 {kindIcon(a.kind)} {a.name}</p>
        <p className="text-base">
          Người bán: <b>{a.sellerName}</b> · giá trị {formatXu(a.value)} · khởi điểm {formatXu(a.start)}
          {a.top !== null ? ` · cao nhất ${formatXu(a.top)} (${a.leading ? "bạn" : a.topName ?? "ai đó"}, ${a.bids} lượt)` : " · chưa ai đặt"}
          {open ? ` · còn ${leftText(a.endsMs - now)}` : ` · ${a.status === "sold" ? (a.leading ? "🏆 bạn thắng" : "đã bán") : STATUS[a.status] ?? a.status}`}
        </p>
        {open && !a.mine && (
          <span className="flex flex-wrap items-center gap-2">
            <input type="number" inputMode="numeric" min={a.minBid} max={a.maxBid} aria-label={`Giá đặt ${a.id}`}
              className="w-28 rounded border border-gold-300 bg-cream px-1" placeholder={String(a.minBid)} value={text}
              onChange={(e) => setBids((b) => ({ ...b, [a.id]: e.target.value }))} />
            <button type="button" className="pch-btn pch-btn-primary"
              disabled={busy || !Number.isInteger(amount) || amount < a.minBid || amount > a.maxBid}
              onClick={() => void act(() => auctionBid(token, a.id, amount), `Đã đặt ${formatXu(amount)}.`)}>
              Đặt giá {Number.isInteger(amount) ? formatXu(amount) : ""}
            </button>
            <span className="text-sm opacity-80">tối thiểu {formatXu(a.minBid)}</span>
          </span>
        )}
        {open && a.mine && a.top === null && (
          <div><button type="button" className="pch-btn" disabled={busy} onClick={() => void act(() => auctionCancel(token, a.id), "Đã rút phiên đấu giá.")}>Rút</button></div>
        )}
      </li>
    );
  };

  return (
    <ParchmentModal title="🏪 Chợ người chơi" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-3 overflow-y-auto font-vt text-lg leading-tight" data-testid="player-market">
        <StallRowView rented={(state?.stalls ?? []).map((s) => s.renterName !== null)} notes={state?.listings.length ?? 0} />
        <p className="text-base">
          Mua bán cá, đồ thời trang và nông sản giữa bà con. Giá trong khoảng {BAND_MIN_PERCENT} %–{BAND_MAX_PERCENT} % giá trị,
          phí đăng tin {LIST_FEE_PERCENT} % (hết hạn không ai mua thì hoàn một nửa), chợ thu {SALE_FEE_PERCENT} % khi bán được.
        </p>
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pch-btn px-2 py-0.5 ${tab === t.id ? "pch-btn-primary" : ""}`}
              onClick={() => { setTab(t.id); setError(null); setNotice(null); }}>{t.name}</button>
          ))}
          {state && <span className="ml-auto self-center text-base">💰 {formatXu(state.coins)}</span>}
        </div>
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {notice && <p className="text-emerald-800">{notice}</p>}
        {state === null && !error && <p>Đang mở chợ…</p>}

        {state && tab === "browse" && (
          <section className="flex flex-col gap-2" data-testid="econ-browse">
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" aria-label="Tìm" placeholder="Tìm món hoặc người bán…" value={query} onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 rounded border border-gold-300 bg-cream px-1" />
              <select aria-label="Loại" className="rounded border border-gold-300 bg-cream px-1" value={kind} onChange={(e) => setKind(e.target.value as AssetKind | "")}>
                <option value="">Tất cả</option>
                {(["fish", "fashion", "produce"] as const).map((k) => <option key={k} value={k}>{kindIcon(k)} {kindName(k)}</option>)}
              </select>
            </div>
            {shown.length === 0 ? <p>Chưa có món nào{q || kind ? " khớp" : ""}.</p> : <ul className="flex flex-col gap-2">{shown.map(listingRow)}</ul>}
          </section>
        )}

        {state && tab === "sell" && (
          <section className="flex flex-col gap-2" data-testid="econ-sell">
            <SellForm assets={state.assets} busy={busy}
              note={(p) => `Phí đăng ${formatXu(listFee(p.price))} · bán được bạn nhận ${formatXu(saleShare(p.price).seller)} · tin rao ${LIST_HOURS / 24} ngày.`}
              submit={{
                label: (p) => `Đăng bán · ${formatXu(p.price)}`,
                onSubmit: (p) => void act(() => marketList(token, p.asset.kind, p.asset.ref, p.qty, p.price), "Đã đăng tin!"),
              }} />
            <p className="text-sm opacity-80">Món đang rao vẫn nằm trong giỏ của bạn; nếu bạn bán hay dùng nó ở chỗ khác, tin rao tự huỷ.</p>
          </section>
        )}

        {state && tab === "mine" && (
          <section className="flex flex-col gap-2" data-testid="econ-mine">
            {state.mine.length === 0 ? <p>Bạn chưa rao bán gì.</p> : <ul className="flex flex-col gap-2">{state.mine.map(listingRow)}</ul>}
          </section>
        )}

        {state && tab === "auction" && (
          <section className="flex flex-col gap-2" data-testid="econ-auction">
            {state.auctions.length === 0 ? <p>Chưa có phiên đấu giá nào.</p> : <ul className="flex flex-col gap-2">{state.auctions.map(auctionRow)}</ul>}
            <details className="rounded-sm border-2 border-gold-300 p-2">
              <summary className="cursor-pointer">➕ Mở phiên đấu giá (hàng hiếm từ {formatXu(AUCTION_MIN_VALUE)})</summary>
              <label className="mt-2 flex flex-wrap items-center gap-2">
                <span>Thời lượng:</span>
                <select aria-label="Thời lượng" className="rounded border border-gold-300 bg-cream px-1" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                  {AUCTION_HOURS.map((h) => <option key={h} value={h}>{h} giờ</option>)}
                </select>
              </label>
              <SellForm assets={state.assets} minValue={AUCTION_MIN_VALUE} busy={busy}
                note={(p) => `Giá khởi điểm ${formatXu(p.price)} · bán được bạn nhận ${100 - SALE_FEE_PERCENT} % giá cuối.`}
                submit={{
                  label: (p) => `Mở phiên ${hours} giờ · từ ${formatXu(p.price)}`,
                  onSubmit: (p) => void act(() => auctionCreate(token, p.asset.kind, p.asset.ref, p.qty, p.price, hours), "Đã mở phiên đấu giá!"),
                }} />
            </details>
            <p className="text-sm opacity-80">
              Tiền đặt giá được giữ lại; ai trả cao hơn thì bạn được hoàn ngay. Đặt giá trong {SNIPE_SECONDS / 60} phút cuối sẽ kéo dài phiên thêm {SNIPE_SECONDS / 60} phút.
              Giá đặt tối đa {AUCTION_CAP_PERCENT} % giá trị.
            </p>
          </section>
        )}
      </div>
    </ParchmentModal>
  );
}
