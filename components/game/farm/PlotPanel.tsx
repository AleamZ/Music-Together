"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { plotActions, type PlotAction, type PlotRun } from "@/lib/game/farm/actions";
import { PLOT_PRICE, RENT_PRICE, type FarmCatalog } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, nextPhaseAt, waterAt, wantedWater, yieldEstimate } from "@/lib/game/farm/crop";
import { HANDBOOK_TABS, handbookTabFor, type HandbookTab } from "@/lib/game/farm/handbook";
import type { LandCtx } from "@/lib/game/farm/land";
import { durationText, PEST_NAME, PEST_REMEDY, PHASE_NAME, WATER_NAME } from "@/lib/game/farm/messages";
import type { FieldState, PlotView } from "@/lib/game/farm/state";
import { formatXu } from "@/lib/game/fishing/catalog";
import ConfirmButton from "./ConfirmButton";
import { BuyListedButton, BuyPlotButton, MyPlot, RentButton, RentSubleaseButton } from "./CoopPanel";
import FieldStatus from "./FieldStatus";

/** Toasts for the plot actions that do not show at once on the panel. */
const DONE: Record<string, string> = {
  prepare: "Đã làm đất — ruộng ngập nước.", soak: "Đang ngâm giống — 2 giờ nữa là nứt nanh.", sow: "Đã gieo mạ.",
  pick: "Đã bắt ốc bươu vàng.", abandon: "Đã bỏ vụ.",
};
const doneText = (a: PlotAction): string | undefined =>
  DONE[a.key.split(":")[0]] ?? (a.key.startsWith("fert:") || a.key.startsWith("spray:") ? `Đã ${a.label.toLowerCase()}.` : undefined);

function Status({ p, me, catalog, now }: { p: PlotView; me: string; catalog: FarmCatalog; now: number }) {
  const crop = p.crop;
  if (!crop) return <p>Ruộng còn gốc rạ — chưa làm đất.</p>;
  const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
  const c = cropModel(crop);
  const phase = cropPhase(c, v, now);
  const next = nextPhaseAt(c, v, now);
  const water = crop.log ? waterAt(c.water, now) : crop.water;
  const want = wantedWater(c, v, now);
  const farmer = p.farmer?.id === me;
  const estimate = farmer && v && crop.soakAt !== null ? yieldEstimate(c, v, p.kind === "private" ? 1.1 : 1, crop.pests, now).kg : null;
  const remedy = (id: string | null) => (id ? catalog.items.find((i) => i.id === id)?.name ?? id : "Bắt ốc bằng tay");
  return (
    <ul className="flex flex-col gap-0.5">
      <li>🌱 {v ? v.name : "Chưa ngâm giống"} · <b>{PHASE_NAME[phase]}</b>{next !== null && next > now ? ` — giai đoạn sau: còn ${durationText(next - now)}` : ""}</li>
      <li>💧 Nước: <b>{WATER_NAME[water]}</b>{want ? ` · cần ${want.label}` : ""}</li>
      {crop.pests.map((x) => (
        <li key={`${x.kind}:${x.since}`} className={x.treatedAt === null ? "text-burgundy" : "opacity-80"}>
          {x.treatedAt === null ? `❗ ${PEST_NAME[x.kind]} — ${remedy(PEST_REMEDY[x.kind])}` : `✓ Đã trị ${PEST_NAME[x.kind].toLowerCase()}`}
        </li>
      ))}
      {crop.excessN && <li className="text-burgundy">⚠️ Dư đạm — sâu bệnh dễ tới, lúa dễ đổ.</li>}
      {crop.rottedAt !== null && <li className="opacity-80">Lần trước hạt giống thối vì để quá lâu không gieo.</li>}
      {estimate !== null && <li>⚖️ Ước tính: ~{estimate} kg (chưa tính sâu bệnh chưa tới)</li>}
    </ul>
  );
}

/** Land on a plot that is not mine: rent it, buy it, or take a listing or a sublease. */
function Land({ p, ctx, busy, onAct }: { p: PlotView; ctx: LandCtx; busy: boolean; onAct: (a: PlotRun, done?: string) => void }) {
  if (p.owner?.id === ctx.me) return <MyPlot p={p} ctx={ctx} busy={busy} onAct={onAct} />;
  const buttons = [
    p.kind === "village" && !p.lease && (
      <RentButton key="rent" p={p} ctx={ctx} busy={busy} onAct={onAct}>Thuê · {formatXu(RENT_PRICE)}</RentButton>
    ),
    p.kind === "private" && !p.owner && (
      <BuyPlotButton key="buy" p={p} ctx={ctx} busy={busy} onAct={onAct}>Mua · {formatXu(PLOT_PRICE)}</BuyPlotButton>
    ),
    p.owner && p.salePrice !== null && (
      <BuyListedButton key="listed" p={p} ctx={ctx} busy={busy} onAct={onAct}>Mua · {formatXu(p.salePrice)}</BuyListedButton>
    ),
    p.owner && p.subleasePrice !== null && (
      <RentSubleaseButton key="sublease" p={p} ctx={ctx} busy={busy} onAct={onAct}>Thuê một vụ · {formatXu(p.subleasePrice)}</RentSubleaseButton>
    ),
  ].filter(Boolean);
  return buttons.length > 0 ? <div className="flex flex-wrap justify-end gap-2">{buttons}</div> : null;
}

/** 🌾 Thửa N (spec §13.2): the crop's status, what I can do on it now (disabled buttons say why), the land actions,
 *  and a link to the handbook tab that matters. */
export default function PlotPanel({ no, state, catalog, failed, me, busy, now, onAct, onOpenHandbook, onReload, onClose }: {
  no: number;
  state: FieldState | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  me: string;
  busy: boolean;
  now: number;
  onAct: (a: PlotRun, done?: string) => void;
  onOpenHandbook: (tab: HandbookTab) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const p = state?.plots.find((x) => x.no === no) ?? null;
  const v = p?.crop ? catalog?.varieties.find((x) => x.id === p.crop!.variety) ?? null : null;
  const tab = handbookTabFor(p?.crop ?? null, v, now);
  const ctx: LandCtx | null = state ? { me, plots: state.plots, mine: state.mine } : null;
  return (
    <ParchmentModal title={`🌾 Thửa ${no} · ${no <= 4 ? "đất tư" : "đất làng"}`} onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!p || !state || !catalog || !ctx ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            <p className="opacity-80">
              {p.owner ? `Chủ đất: ${p.owner.id === me ? "bạn" : p.owner.name}` : p.kind === "private" ? "Làng đang bán thửa này" : "Đất làng"}
              {p.farmer ? ` · người làm: ${p.farmer.id === me ? "bạn" : p.farmer.name}` : " · chưa ai làm"}
              {p.lease ? ` (thuê — còn ${durationText(p.lease.until - now)})` : ""}
            </p>
            <Status p={p} me={me} catalog={catalog} now={now} />
            <ul className="flex flex-col gap-1">
              {plotActions(p, me, v, catalog, state.mine, now).map((a) => (
                <li key={a.key} className="flex flex-wrap items-center gap-2">
                  <ConfirmButton warn={a.warn} disabled={busy || !a.enabled} primary={a.enabled && !a.warn} onConfirm={() => onAct(a.run, doneText(a))}>
                    {a.label}
                  </ConfirmButton>
                  {(a.why ?? a.hint) && <span className="min-w-0 flex-1 text-base opacity-80">{a.why ?? a.hint}</span>}
                </li>
              ))}
            </ul>
            <Land p={p} ctx={ctx} busy={busy} onAct={onAct} />
            <button type="button" className="pch-btn self-start" onClick={() => onOpenHandbook(tab)}>
              📖 Sổ tay: {HANDBOOK_TABS.find(([id]) => id === tab)?.[1]}
            </button>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
