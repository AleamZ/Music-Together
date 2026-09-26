"use client";

import { ParchmentModal } from "@/components/game/Parchment";
import { lower, plotActions, uplandOf, type PlotAction, type PlotRun } from "@/lib/game/farm/actions";
import { HARVEST_PARTS, PLOT_PRICE, RENT_PRICE, type FarmCatalog } from "@/lib/game/farm/catalog";
import { cropModel, cropPhase, nextPhaseAt, waterAt, wantedWater, yieldEstimate } from "@/lib/game/farm/crop";
import { handbookTabFor, handbookTabs, type HandbookTab } from "@/lib/game/farm/handbook";
import type { LandCtx } from "@/lib/game/farm/land";
import {
  BED_WATER_NAME, bedLevelsText, durationText, PEST_NAME, PEST_REMEDY, PHASE_NAME, ratPlotText, uplandPhaseName, WATER_NAME,
} from "@/lib/game/farm/messages";
import { ratFactor, ratHours } from "@/lib/game/farm/rats";
import type { CropView, FieldState, PlotView } from "@/lib/game/farm/state";
import {
  rotFromAt, upEstimate, uplandModel, upNext, upNextPhaseAt, upPhase, upSeasonEstimate, upWantedWater,
} from "@/lib/game/farm/upland";
import { formatXu } from "@/lib/game/fishing/catalog";
import ConfirmButton from "./ConfirmButton";
import { BuyListedButton, BuyPlotButton, MyPlot, RentButton, RentSubleaseButton } from "./CoopPanel";
import FieldStatus from "./FieldStatus";

/** Toasts for the plot actions that do not show at once on the panel. */
const DONE: Record<string, string> = {
  prepare: "Đã làm đất — ruộng ngập nước.", prepare_beds: "Đã lên luống — đất Ẩm, sẵn sàng trồng.",
  soak: "Đang ngâm giống — 2 giờ nữa là nứt nanh.", sow: "Đã gieo mạ.", pick: "Đã bắt ốc bươu vàng.", abandon: "Đã bỏ vụ.",
};
/** The actions toasted by their own button: "Đã bón phân urê.", "Đã trồng dây khoai.", "Đã lật dây." (v15.2 §13.6). A
 *  round's game says its own end. */
const BY_LABEL: ReadonlySet<string> = new Set(["fert", "spray", "plant", "tend"]);
const doneText = (a: PlotAction): string | undefined => {
  const key = a.key.split(":")[0];
  return DONE[key] ?? (BY_LABEL.has(key) ? `Đã ${lower(a.label)}.` : undefined);
};

function Pests({ crop, catalog }: { crop: CropView; catalog: FarmCatalog }) {
  const remedy = (id: string | null) => (id ? catalog.items.find((i) => i.id === id)?.name ?? id : "Bắt ốc bằng tay");
  return crop.pests.map((x) => (
    <li key={`${x.kind}:${x.since}`} className={x.treatedAt === null ? "text-burgundy" : "opacity-80"}>
      {x.treatedAt === null ? `❗ ${PEST_NAME[x.kind]} — ${remedy(PEST_REMEDY[x.kind])}` : `✓ Đã trị ${PEST_NAME[x.kind].toLowerCase()}`}
    </li>
  ));
}

/** A running harvester's countdown (the panel's clock ticks every second meanwhile). */
const harvesterLine = (crop: CropView, now: number): string | null =>
  crop.harvester && now < crop.harvester.endsAt ? `🚜 Máy gặt đang gặt — còn ${Math.ceil((crop.harvester.endsAt - now) / 1000)} giây` : null;

function RiceStatus({ p, me, catalog, now }: { p: PlotView; me: string; catalog: FarmCatalog; now: number }) {
  const crop = p.crop!;
  const v = catalog.varieties.find((x) => x.id === crop.variety) ?? null;
  const c = cropModel(crop);
  const phase = cropPhase(c, v, now);
  const next = nextPhaseAt(c, v, now);
  const water = crop.log ? waterAt(c.water, now) : crop.water;
  const want = wantedWater(c, v, now);
  const farmer = p.farmer?.id === me;
  const estimate = farmer && v && crop.soakAt !== null ? yieldEstimate(c, v, p.kind === "private" ? 1.1 : 1, crop.pests, now).kg : null;
  const machine = harvesterLine(crop, now);
  const cut = crop.parts > 0 && crop.parts < HARVEST_PARTS;
  return (
    <ul className="flex flex-col gap-0.5">
      {machine && <li><b>{machine}</b></li>}
      {cut && !machine && <li>🌾 Đã gặt {crop.parts}/{HARVEST_PARTS} phần{crop.log ? ` (${crop.log.harvestedKg} kg)` : ""}</li>}
      <li>🌱 {v ? v.name : "Chưa ngâm giống"} · <b>{PHASE_NAME[phase]}</b>{next !== null && next > now ? ` — giai đoạn sau: còn ${durationText(next - now)}` : ""}</li>
      <li>💧 Nước: <b>{WATER_NAME[water]}</b>{want ? ` · cần ${want.label}` : ""}</li>
      <Pests crop={crop} catalog={catalog} />
      {crop.excessN && <li className="text-burgundy">⚠️ Dư đạm — sâu bệnh dễ tới, lúa dễ đổ.</li>}
      {crop.rottedAt !== null && <li className="opacity-80">Lần trước hạt giống thối vì để quá lâu không gieo.</li>}
      {estimate !== null && <li>⚖️ Ước tính: ~{estimate} kg (chưa tính sâu bệnh chưa tới)</li>}
      {farmer && !machine && (phase === "ripe" || phase === "overripe") && (
        <li className="opacity-80">🚜 Hoặc thuê máy gặt ở Hợp tác xã: 30 giây, 500 xu mỗi phần còn lại.</li>
      )}
    </ul>
  );
}

/** Raised beds (v15.2 §13.1): the crop and its stage, the soil's water, the pests, excess N, rot, and my estimate. */
function BedStatus({ p, me, catalog, now }: { p: PlotView; me: string; catalog: FarmCatalog; now: number }) {
  const crop = p.crop!;
  const u = uplandOf(crop, catalog);
  const c = uplandModel(crop);
  const water = crop.log ? waterAt(c.water, now) : crop.water;
  if (!u) {
    return (
      <ul className="flex flex-col gap-0.5">
        <li>🌱 Luống đã lên — chưa trồng gì.</li>
        <li>💧 Đất: <b>{BED_WATER_NAME[water]}</b></li>
      </ul>
    );
  }
  const phase = upPhase(c, u, now);
  const next = upNextPhaseAt(c, u, now);
  const want = upWantedWater(c, u, now);
  const rotFrom = rotFromAt(c, u);
  const land = p.kind === "private" ? 1.1 : 1;
  const k = c.plantAt === null ? 1 : upNext(c, u, now);
  const farmer = p.farmer?.id === me && crop.log !== null;
  const one = farmer && k > 0 ? upEstimate(c, u, land, k, crop.pests, now).kg : null;
  const season = farmer && k > 0 ? upSeasonEstimate(c, u, land, crop.pests, now) : null;
  return (
    <ul className="flex flex-col gap-0.5">
      <li>🌱 {u.name} · <b>{uplandPhaseName(u, phase)}</b>{next !== null && next > now ? ` — giai đoạn sau: còn ${durationText(next - now)}` : ""}</li>
      <li>💧 Đất: <b>{BED_WATER_NAME[water]}</b>{want ? ` · cần ${bedLevelsText(want)}` : ""}</li>
      <Pests crop={crop} catalog={catalog} />
      {crop.excessN && <li className="text-burgundy">⚠️ Dư đạm — mất 10%, sâu bệnh dễ tới.</li>}
      {rotFrom !== null && now >= rotFrom && water >= 2 && <li className="text-burgundy">⚠️ Đất úng — củ đang thối!</li>}
      {one !== null && season !== null && (
        <li>
          ⚖️ Ước tính: {u.pickings.length > 1 ? `lứa này ~${one} kg · cả vụ ~${season} kg` : `~${season} kg`} (chưa tính sâu bệnh chưa tới)
        </li>
      )}
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

/** 🌾 Thửa N (spec §13.2, v15.2 §13.1): the crop's status (rice or beds, the parts cut, a harvester at work), what I can
 *  do on it now (disabled buttons say why), the land actions, and a link to the handbook tab that matters. */
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
  // v17 §12.1: a plot with a rat log or live rats says so, and its handbook link goes to the rats' tab
  const ratLog = state?.rats?.plots[no] ?? null;
  const ratsHere = state?.rats?.live.filter((r) => r.plot === no).length ?? 0;
  const ratted = ratLog !== null || ratsHere > 0;
  const tab = handbookTabFor(p?.crop ?? null, v, now, ratted);
  const tabs = catalog ? handbookTabs(catalog.uplands, catalog.critters, catalog.items) : [];
  const tabName = (id: string) => tabs.find(([t]) => t === id)?.[1];
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
            {!p.crop ? (
              <p>Ruộng còn gốc rạ — chưa làm đất.</p>
            ) : p.crop.kind === "upland" ? (
              <BedStatus p={p} me={me} catalog={catalog} now={now} />
            ) : (
              <RiceStatus p={p} me={me} catalog={catalog} now={now} />
            )}
            {ratted && <p>{ratPlotText(ratsHere, (1 - ratFactor(ratHours(ratLog ?? [], now))) * 100)}</p>}
            <ul className="flex flex-col gap-1">
              {plotActions(p, me, v, catalog, state.mine, now).map((a) => (
                <li key={a.key} className="flex flex-wrap items-center gap-2">
                  <ConfirmButton warn={a.warn} disabled={busy || !a.enabled} primary={a.enabled && !a.warn} onConfirm={() => onAct(a.run, doneText(a))}>
                    {a.label}
                  </ConfirmButton>
                  {(a.why ?? a.hint) && <span className="min-w-0 flex-1 text-base opacity-80">{a.why ?? a.hint}</span>}
                  {!a.why && a.hint && a.handbook && tabName(a.handbook) && (
                    <button type="button" className="pch-btn" onClick={() => onOpenHandbook(a.handbook!)}>📖 {tabName(a.handbook)}</button>
                  )}
                </li>
              ))}
            </ul>
            <Land p={p} ctx={ctx} busy={busy} onAct={onAct} />
            <button type="button" className="pch-btn self-start" onClick={() => onOpenHandbook(tab)}>
              📖 Sổ tay: {tabName(tab)}
            </button>
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
