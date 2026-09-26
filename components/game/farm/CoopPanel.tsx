"use client";

import { useState, type ReactNode } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import {
  FARM_LIMIT, HARVEST_PARTS, harvesterPrice, LEASE_HOURS, PLOT_PRICE, RENT_PRICE, SALE_MAX, SELL_BACK_PRICE, SUBLEASE_MAX,
  type FarmCatalog, type Variety,
} from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, overripeAt } from "@/lib/game/farm/crop";
import {
  acceptRefusal, buyListedRefusal, buyPlotRefusal, farmingCount, harvesterRefusal, listRefusal, offerRefusal, reasonText, rentRefusal,
  rentSubleaseRefusal, sellBackRefusal, subleaseRefusal, type LandCtx,
} from "@/lib/game/farm/land";
import { COAT_NAME, DOG, DOG_COATS, dogNameRefusal, type DogCoat, type DogView } from "@/lib/game/dog";
import {
  ADOPT_BUTTON, ADOPT_INTRO, adoptConfirmText, DOG_NAME_HINT, DOG_NAME_PROBLEM, dogOwnedText, durationText, harvesterStartText,
  PHASE_NAME,
} from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import type { CropView, FieldState, PlotView } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import ConfirmButton from "./ConfirmButton";
import DogSprite from "./DogSprite";
import FieldStatus from "./FieldStatus";

type Tab = "village" | "private" | "market" | "harvester" | "dog" | "mine";
const TABS: ReadonlyArray<[Tab, string]> = [
  ["village", "Đất làng"], ["private", "Đất tư"], ["market", "Chợ đất"], ["harvester", "Máy gặt"], ["dog", "🐕 Chó cỏ"], ["mine", "Của tôi"],
];

/** The dog tab's part (v17 §12.3): my dog, and the adoption. Null before 0019 (the field has no rats): no tab. */
export interface CoopDog {
  dog: DogView | null;
  busy: boolean;
  onAdopt: (name: string, coat: DogCoat) => Promise<boolean>;
  onOpenDog: () => void;
}

/** 🐕 Chó cỏ: the four coats (sprites), the name (the coat's by default) and "Nhận nuôi", which asks first; with a dog
 *  owned, a line and "Mở bảng chó". */
function DogTab({ coins, part }: { coins: number; part: CoopDog }) {
  const [coat, setCoat] = useState<DogCoat>("vang");
  const [typed, setTyped] = useState<string | null>(null);
  if (part.dog) {
    return (
      <>
        <p>{dogOwnedText(part.dog.name)}</p>
        <button type="button" className="pch-btn self-start" onClick={part.onOpenDog}>Mở bảng chó</button>
      </>
    );
  }
  const name = typed ?? COAT_NAME[coat];
  const problem = dogNameRefusal(name);
  return (
    <>
      <p className="italic">{ADOPT_INTRO}</p>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Màu lông">
        {DOG_COATS.map((c) => (
          <button key={c} type="button" aria-pressed={coat === c} className={`pch-btn flex flex-col items-center ${coat === c ? "pch-btn-primary" : ""}`}
            onClick={() => setCoat(c)}>
            <DogSprite coat={c} />
            {COAT_NAME[c]}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        Tên
        <input className="flex-1 rounded-sm border border-ink/40 bg-parchment px-1" value={name} maxLength={32}
          onChange={(e) => setTyped(e.target.value)} />
      </label>
      <span className={`text-base ${problem ? "text-burgundy" : "opacity-80"}`}>{problem ? DOG_NAME_PROBLEM[problem] : DOG_NAME_HINT}</span>
      <div className="self-start">
        <ConfirmButton primary warn={adoptConfirmText(name, coat)} disabled={part.busy || problem !== null || coins < DOG.price}
          onConfirm={() => void part.onAdopt(name, coat)}>
          {ADOPT_BUTTON}
        </ConfirmButton>
      </div>
    </>
  );
}

type Act = (a: FieldAction, done?: string) => void;

/** A land button: disabled with the reason when the rules refuse it ("" = disabled, nothing to say yet); `warn` asks
 *  first. */
export function LandButton({ refusal, busy, warn, primary, onClick, children }: {
  refusal: string | null;
  busy: boolean;
  warn?: string;
  primary?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <ConfirmButton warn={warn} primary={primary} disabled={busy || refusal !== null} onConfirm={onClick}>{children}</ConfirmButton>
      {refusal && <span className="text-sm opacity-80">{reasonText(refusal)}</span>}
    </div>
  );
}

// The land buttons the co-op and the plot panel share: each keeps its rule, its warning, its RPC and its toast in one
// place; the label comes as children.
interface PlotButtonProps { p: PlotView; ctx: LandCtx; busy: boolean; onAct: Act; children: ReactNode }

/** Rents a free village plot for one lease. */
export function RentButton({ p, ctx, busy, onAct, children }: PlotButtonProps) {
  return (
    <LandButton refusal={rentRefusal(p, ctx)} busy={busy} primary
      onClick={() => onAct({ kind: "rent", plot: p.no }, `Đã thuê thửa ${p.no} trong ${LEASE_HOURS / 24} ngày.`)}>
      {children}
    </LandButton>
  );
}

/** Buys an ownerless private plot from the village, after asking. */
export function BuyPlotButton({ p, ctx, busy, onAct, children }: PlotButtonProps) {
  return (
    <LandButton refusal={buyPlotRefusal(p, ctx)} busy={busy} primary
      warn={`Mua thửa ${p.no} với giá ${formatXu(PLOT_PRICE)}?`}
      onClick={() => onAct({ kind: "buy_plot", plot: p.no }, `🏡 Đã mua thửa ${p.no}.`)}>
      {children}
    </LandButton>
  );
}

/** Buys another owner's listed plot at the price shown (the server refuses if it changed), after asking. For a plot with
 *  an owner and a sale price only. */
export function BuyListedButton({ p, ctx, busy, onAct, children }: PlotButtonProps) {
  return (
    <LandButton refusal={buyListedRefusal(p, ctx)} busy={busy} primary
      warn={`Mua thửa ${p.no} của ${p.owner!.name} với giá ${formatXu(p.salePrice!)}?`}
      onClick={() => onAct({ kind: "buy_listed", plot: p.no, expected: p.salePrice! }, `🏡 Đã mua thửa ${p.no}.`)}>
      {children}
    </LandButton>
  );
}

/** Rents another owner's plot for one season at the price shown (the server refuses if it changed). For a plot with an
 *  owner and a sublease price only. */
export function RentSubleaseButton({ p, ctx, busy, onAct, children }: PlotButtonProps) {
  return (
    <LandButton refusal={rentSubleaseRefusal(p, ctx)} busy={busy} primary
      onClick={() => onAct({ kind: "rent_sublease", plot: p.no, expected: p.subleasePrice! }, `Đã thuê thửa ${p.no} của ${p.owner!.name} một vụ.`)}>
      {children}
    </LandButton>
  );
}

function Line({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-ink/20 py-1.5 last:border-b-0">
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </li>
  );
}

/** A whole-xu price field. */
function PriceInput({ label, max, value, onChange }: { label: string; max: number; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-1">
      <span>{label}</span>
      <input
        type="number" inputMode="numeric" min={1} max={max} step={1} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded-sm border border-ink/40 bg-parchment px-1 text-right"
      />
      <span>xu</span>
    </label>
  );
}
const toPrice = (s: string): number => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
/** A price field's refusal: nothing typed yet → "" (quietly disabled), not a whole number → invalid price. */
const priceRefusal = (s: string, check: (price: number) => string | null): string | null =>
  s.trim() === "" ? "" : Number.isNaN(toPrice(s)) ? "invalid price" : check(toPrice(s));

const who = (p: PlotView, me: string) => (p.farmer?.id === me ? "Bạn" : p.farmer?.name ?? "Có người");

function VillageTab({ ctx, busy, now, onAct }: { ctx: LandCtx; busy: boolean; now: number; onAct: Act }) {
  return (
    <>
      <p className="opacity-80">Thuê {formatXu(RENT_PRICE)} một vụ {LEASE_HOURS / 24} ngày — gặt xong là trả ruộng.</p>
      <ul>
        {ctx.plots.filter((p) => p.kind === "village").map((p) => (
          <Line key={p.no} action={!p.lease && (
            <RentButton p={p} ctx={ctx} busy={busy} onAct={onAct}>Thuê · {formatXu(RENT_PRICE)}</RentButton>
          )}>
            Thửa {p.no} · {p.lease ? `${who(p, ctx.me)} đang thuê — còn ${durationText(p.lease.until - now)}` : "Trống"}
          </Line>
        ))}
      </ul>
    </>
  );
}

function PrivateTab({ ctx, busy, onAct }: { ctx: LandCtx; busy: boolean; onAct: Act }) {
  return (
    <>
      <p className="opacity-80">Đất tư được thêm 10% lúa, không tốn tiền thuê; mỗi người một thửa trong phòng.</p>
      <ul>
        {ctx.plots.filter((p) => p.kind === "private").map((p) => (
          <Line key={p.no} action={!p.owner && (
            <BuyPlotButton p={p} ctx={ctx} busy={busy} onAct={onAct}>Mua · {formatXu(PLOT_PRICE)}</BuyPlotButton>
          )}>
            Thửa {p.no} · {p.owner ? (
              <>
                của {p.owner.id === ctx.me ? "bạn" : p.owner.name}
                {p.salePrice !== null && ` · rao bán ${formatXu(p.salePrice)}`}
                {p.subleasePrice !== null && ` · cho thuê ${formatXu(p.subleasePrice)}/vụ`}
                {p.lease && ` · ${who(p, ctx.me)} đang thuê`}
              </>
            ) : "làng bán"}
          </Line>
        ))}
      </ul>
    </>
  );
}

function MarketTab({ ctx, busy, onAct }: { ctx: LandCtx; busy: boolean; onAct: Act }) {
  const others = ctx.plots.filter((p) => p.owner && p.owner.id !== ctx.me);
  const listed = others.filter((p) => p.salePrice !== null);
  const subleased = others.filter((p) => p.subleasePrice !== null);
  const [target, setTarget] = useState<number | null>(null);
  const [price, setPrice] = useState("");
  const offerPlot = others.find((p) => p.no === target) ?? null;
  // The chosen plot left the market (sold, reclaimed, or now mine): nothing is chosen, and the typed price goes with it.
  if (target !== null && !offerPlot) {
    setTarget(null);
    setPrice("");
  }
  const choose = (no: number) => {
    if (no === target) return;
    setTarget(no);
    setPrice("");
  };
  const offer = toPrice(price);
  return (
    <>
      {listed.length + subleased.length === 0 && <p className="opacity-80">Chưa ai rao bán hay cho thuê đất.</p>}
      <ul>
        {listed.map((p) => (
          <Line key={`sale:${p.no}`} action={<BuyListedButton p={p} ctx={ctx} busy={busy} onAct={onAct}>Mua</BuyListedButton>}>
            Thửa {p.no} của {p.owner!.name} — bán {formatXu(p.salePrice!)}
          </Line>
        ))}
        {subleased.map((p) => (
          <Line key={`lease:${p.no}`} action={<RentSubleaseButton p={p} ctx={ctx} busy={busy} onAct={onAct}>Thuê</RentSubleaseButton>}>
            Thửa {p.no} của {p.owner!.name} — cho thuê một vụ {formatXu(p.subleasePrice!)}
          </Line>
        ))}
      </ul>
      {others.length > 0 && (
        <section className="pch flex flex-col gap-1 p-2">
          <h3 className="text-xl text-burgundy">Đề nghị mua</h3>
          <p className="text-base opacity-80">Trả giá đất tư của người khác; chủ đất đồng ý thì mới thành. Đề nghị có hạn 24 giờ.</p>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Thửa muốn mua">
            {others.map((p) => (
              <button key={p.no} type="button" className="pch-btn text-base" aria-pressed={offerPlot?.no === p.no} onClick={() => choose(p.no)}>
                Thửa {p.no} ({p.owner!.name})
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-1">
            <PriceInput label="Giá" max={SALE_MAX} value={price} onChange={setPrice} />
            {/* keyed by the plot and the price: a change drops an open question, so it always names what is sent */}
            <LandButton key={`${offerPlot?.no ?? ""}:${price}`} busy={busy} primary
              refusal={offerPlot ? priceRefusal(price, (x) => offerRefusal(offerPlot, ctx, x)) : ""}
              warn={offerPlot ? `Trả giá thửa ${offerPlot.no} với ${formatXu(offer)}?` : undefined}
              onClick={() => offerPlot && onAct({ kind: "offer", plot: offerPlot.no, price: offer }, `Đã gửi đề nghị mua thửa ${offerPlot.no} giá ${formatXu(offer)}.`)}>
              Gửi đề nghị
            </LandButton>
          </div>
        </section>
      )}
    </>
  );
}

/** The owner's land actions on their plot: list it for sale, sublease it, sell it back (also on the plot panel). */
export function MyPlot({ p, ctx, busy, onAct }: { p: PlotView; ctx: LandCtx; busy: boolean; onAct: Act }) {
  const [sale, setSale] = useState("");
  const [lease, setLease] = useState("");
  const salePrice = toPrice(sale), leasePrice = toPrice(lease);
  return (
    <section className="pch flex flex-col gap-2 p-2">
      <h3 className="text-xl text-burgundy">Thửa {p.no} — đất tư của bạn</h3>
      {p.salePrice !== null ? (
        <Line action={
          <LandButton refusal={listRefusal(p, ctx, null)} busy={busy} onClick={() => onAct({ kind: "list", plot: p.no, price: null }, "Đã thôi rao bán.")}>
            Thôi rao bán
          </LandButton>
        }>Đang rao bán {formatXu(p.salePrice)}</Line>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <PriceInput label="Rao bán" max={SALE_MAX} value={sale} onChange={setSale} />
          <LandButton refusal={priceRefusal(sale, (x) => listRefusal(p, ctx, x))} busy={busy}
            onClick={() => onAct({ kind: "list", plot: p.no, price: salePrice }, `Đã rao bán thửa ${p.no} giá ${formatXu(salePrice)}.`)}>
            Rao bán
          </LandButton>
        </div>
      )}
      {p.subleasePrice !== null ? (
        <Line action={
          <LandButton refusal={subleaseRefusal(p, ctx, null)} busy={busy} onClick={() => onAct({ kind: "set_sublease", plot: p.no, price: null }, "Đã thôi cho thuê.")}>
            Thôi cho thuê
          </LandButton>
        }>Đang cho thuê một vụ {formatXu(p.subleasePrice)}</Line>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-1">
          <PriceInput label="Cho thuê một vụ" max={SUBLEASE_MAX} value={lease} onChange={setLease} />
          <LandButton refusal={priceRefusal(lease, (x) => subleaseRefusal(p, ctx, x))} busy={busy}
            onClick={() => onAct({ kind: "set_sublease", plot: p.no, price: leasePrice }, `Đã cho thuê thửa ${p.no} giá ${formatXu(leasePrice)} một vụ.`)}>
            Cho thuê
          </LandButton>
        </div>
      )}
      {p.lease && p.farmer && p.farmer.id !== ctx.me && <p>{p.farmer.name} đang thuê thửa này.</p>}
      <LandButton refusal={sellBackRefusal(p, ctx)} busy={busy}
        warn={`Làng chỉ trả ${formatXu(SELL_BACK_PRICE)} (một nửa giá) — bán lại thửa ${p.no}?`}
        onClick={() => onAct({ kind: "sell_back", plot: p.no }, `Đã bán lại thửa ${p.no} cho làng — nhận ${formatXu(SELL_BACK_PRICE)}.`)}>
        Bán lại cho làng · {formatXu(SELL_BACK_PRICE)}
      </LandButton>
    </section>
  );
}

function MineTab({ ctx, state, busy, now, onAct }: { ctx: LandCtx; state: FieldState; busy: boolean; now: number; onAct: Act }) {
  const owned = ctx.plots.find((p) => p.owner?.id === ctx.me) ?? null;
  const leases = ctx.plots.filter((p) => p.lease && p.farmer?.id === ctx.me);
  const { incomingOffers, myOffers } = state.mine;
  return (
    <>
      {owned ? <MyPlot p={owned} ctx={ctx} busy={busy} onAct={onAct} /> : <p className="opacity-80">Bạn chưa có đất tư — mua ở thẻ Đất tư hoặc Chợ đất.</p>}
      {leases.length > 0 && (
        <ul>
          {leases.map((p) => <Line key={p.no}>Thửa {p.no} · bạn thuê — còn {durationText(p.lease!.until - now)}</Line>)}
        </ul>
      )}
      {incomingOffers.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xl text-burgundy">Người muốn mua đất của bạn</h3>
          <ul>
            {incomingOffers.map((o) => (
              <Line key={o.id} action={
                <div className="flex flex-wrap items-start gap-1">
                  <LandButton refusal={acceptRefusal(o, ctx)} busy={busy} primary
                    warn={`Bán thửa ${o.plot} cho ${o.buyer?.name ?? "người này"} lấy ${formatXu(o.price)}?`}
                    onClick={() => onAct({ kind: "accept_offer", offer: o.id }, `Đã bán thửa ${o.plot} — nhận ${formatXu(o.price)}.`)}>
                    Đồng ý
                  </LandButton>
                  <LandButton refusal={null} busy={busy} onClick={() => onAct({ kind: "decline_offer", offer: o.id }, "Đã từ chối đề nghị.")}>
                    Từ chối
                  </LandButton>
                </div>
              }>
                {o.buyer?.name ?? "Ai đó"} trả {formatXu(o.price)} cho thửa {o.plot} — còn {durationText(o.expiresAt - now)}
              </Line>
            ))}
          </ul>
        </section>
      )}
      {myOffers.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className="text-xl text-burgundy">Đề nghị của bạn</h3>
          <ul>
            {myOffers.map((o) => (
              <Line key={o.id} action={
                <LandButton refusal={null} busy={busy} onClick={() => onAct({ kind: "withdraw_offer", offer: o.id }, "Đã rút đề nghị.")}>Rút</LandButton>
              }>
                Thửa {o.plot} giá {formatXu(o.price)} — còn {durationText(o.expiresAt - now)}
              </Line>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** The rice plots I farm here. */
const myRice = (ctx: LandCtx): PlotView[] => ctx.plots.filter((p) => p.farmer?.id === ctx.me && p.crop?.kind === "rice");

/** "Chín", "Chín quá 2 giờ", or the phase's name. */
function riceState(crop: CropView, v: Variety | null, now: number): string {
  const c = cropModel(crop);
  const ph = cropPhase(c, v, now);
  const over = v ? overripeAt(c, v) : null;
  return ph === "overripe" && over !== null ? `Chín quá ${durationText(now - over)}` : PHASE_NAME[ph];
}

/** A rice plot of mine is ripe here (a harvester may be at work on it): the panel opens on Máy gặt. */
function riceReady(ctx: LandCtx, varieties: readonly Variety[], now: number): boolean {
  return myRice(ctx).some((p) => {
    const crop = p.crop!;
    const ph = cropPhase(cropModel(crop), varieties.find((v) => v.id === crop.variety) ?? null, now);
    return crop.parts < HARVEST_PARTS && (ph === "ripe" || ph === "overripe");
  });
}

/** Máy gặt (v15.2 §13.4): the co-op's harvester for my rice plots here, 500 xu a part left, 30 seconds, no refund. */
function HarvesterTab({ ctx, varieties, busy, now, onAct }: {
  ctx: LandCtx;
  varieties: readonly Variety[];
  busy: boolean;
  now: number;
  onAct: Act;
}) {
  const plots = myRice(ctx);
  return (
    <>
      <p className="opacity-80">
        “Máy gặt của hợp tác xã: 500 xu mỗi phần, cả thửa 3.000 xu, 30 giây là xong, khỏi cầm liềm. Nhớ rút nước trước nghen!”
      </p>
      {plots.length === 0 ? (
        <p>Bạn chưa làm ruộng lúa nào trong phòng này.</p>
      ) : (
        <ul>
          {plots.map((p) => {
            const crop = p.crop!;
            const v = varieties.find((x) => x.id === crop.variety) ?? null;
            const left = HARVEST_PARTS - crop.parts, price = harvesterPrice(crop.parts);
            const job = crop.harvester && now < crop.harvester.endsAt ? crop.harvester : null;
            return (
              <Line key={p.no} action={job ? (
                <span>🚜 Máy gặt đang gặt — còn {Math.ceil((job.endsAt - now) / 1000)} giây</span>
              ) : (
                <LandButton refusal={harvesterRefusal(p, ctx, v, now)} busy={busy} primary
                  warn={`Thuê máy gặt cho thửa ${p.no}, ${left} phần còn lại, giá ${formatXu(price)}? Không huỷ được.`}
                  onClick={() => onAct({ kind: "rent_harvester", plot: p.no }, harvesterStartText(p.no))}>
                  Thuê máy gặt · {left} phần · {formatXu(price)}
                </LandButton>
              )}>
                Thửa {p.no} · {v?.name ?? "Chưa ngâm giống"} · {riceState(crop, v, now)}
                {crop.parts > 0 ? ` · đã gặt ${crop.parts}/${HARVEST_PARTS} phần` : ""}
              </Line>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** 🏛️ Hợp tác xã · chú Tám (spec §7, §13.3; v15.2 §13.4): rent village plots, buy private ones, the land market, the
 *  harvester and my land. It opens on Máy gặt while a rice plot of mine is ripe. */
export default function CoopPanel({ state, catalog = null, failed, me, busy, now, onAct, onReload, onClose, dog = null }: {
  state: FieldState | null;
  /** v17: the dog tab's part; null hides the tab. */
  dog?: CoopDog | null;
  /** The varieties, for the rice's phases (without it every variety ripens as nếp does). */
  catalog?: FarmCatalog | null;
  failed: boolean;
  me: string;
  busy: boolean;
  now: number;
  onAct: Act;
  onReload: () => void;
  onClose: () => void;
}) {
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
  const varieties = catalog?.varieties ?? [];
  const [tab, setTab] = useState<Tab>(() => (ctx && riceReady(ctx, varieties, now) ? "harvester" : "village"));
  return (
    <ParchmentModal title="🏛️ Hợp tác xã · chú Tám" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Hợp tác xã" className="flex flex-wrap gap-1">
          {TABS.filter(([id]) => id !== "dog" || dog !== null).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {!state || !ctx ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <div role="tabpanel" className="flex flex-col gap-2">
            <p>Bạn có <b>{formatXu(state.mine.coins)}</b> · đang canh tác {farmingCount(ctx)}/{FARM_LIMIT} thửa.</p>
            {tab === "village" && <VillageTab ctx={ctx} busy={busy} now={now} onAct={onAct} />}
            {tab === "private" && <PrivateTab ctx={ctx} busy={busy} onAct={onAct} />}
            {tab === "market" && <MarketTab ctx={ctx} busy={busy} onAct={onAct} />}
            {tab === "harvester" && <HarvesterTab ctx={ctx} varieties={varieties} busy={busy} now={now} onAct={onAct} />}
            {tab === "dog" && dog && <DogTab coins={state.mine.coins} part={dog} />}
            {tab === "mine" && <MineTab ctx={ctx} state={state} busy={busy} now={now} onAct={onAct} />}
          </div>
        )}
      </div>
    </ParchmentModal>
  );
}
