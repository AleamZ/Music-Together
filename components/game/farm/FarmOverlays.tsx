"use client";

import { useEffect, useState } from "react";
import { WORK_MS, type FarmController } from "@/hooks/useFarmController";
import { BED_BAR_MS } from "@/lib/game/farm/gather";
import { AMMO_PELLET } from "@/lib/game/farm/catalog";
import { NOT_OPEN, ratGoneText } from "@/lib/game/farm/messages";
import { isTyping } from "@/lib/game/keys";
import CoopPanel, { type CoopDog } from "./CoopPanel";
import CrabGame from "./CrabGame";
import DryingPanel from "./DryingPanel";
import FarmShopPanel from "./FarmShopPanel";
import FarmTasksPanel from "./FarmTasks";
import Handbook from "./Handbook";
import HarvestGame from "./HarvestGame";
import PlotPanel from "./PlotPanel";
import RiceDepotPanel from "./RiceDepotPanel";
import SlingGame from "./SlingGame";
import TransplantGame from "./TransplantGame";

/** A 3-second job, a picking or a snail bed (v15.3 §7.3): its line, a bar that fills in `ms`, and "Huỷ" (or Esc) before
 *  it is sent. An Esc typed into a text field, or one that closes an open panel, is not for the job (v13/v14 input rules). */
function Progress({ text, ms, panelOpen, onCancel }: { text: string; ms: number; panelOpen: boolean; onCancel: () => void }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setFull(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  useEffect(() => {
    if (panelOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTyping(e.target)) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen, onCancel]);
  return (
    <div className="pch absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1.5 p-2 font-vt text-xl" role="status">
      <span>{text}</span>
      <div className="h-3 w-48 overflow-hidden rounded-sm bg-ink/20">
        <div
          className="h-full bg-burgundy motion-reduce:transition-none"
          style={{ width: full ? "100%" : "0%", transition: `width ${ms}ms linear` }}
        />
      </div>
      <button type="button" className="pch-btn" onClick={onCancel}>Huỷ <span className="pointer-coarse:hidden">(Esc)</span></button>
    </div>
  );
}

/** The field on top of the world (spec §13): the banner before the migration, the progress of a picking or a snail bed, a
 *  round (HarvestGame, v15.2 §13.2; TransplantGame, v15.3 §13.3), a crab visit (CrabGame, v15.3 §13.2) and the field's
 *  panels. */
export default function FarmOverlays({ farm, me, onField, panelOpen = false, dog = null }: {
  farm: FarmController;
  me: string;
  onField: boolean;
  /** v17: the CoopPanel's dog tab (null before 0019). */
  dog?: CoopDog | null;
  /** A panel or modal outside the field's own is open (the shell's, fishing's, the character editor or the anti-cheat
   *  modal): Esc is its. */
  panelOpen?: boolean;
}) {
  const { panel, closePanel, openPanel, busy, now } = farm;
  const { state, catalog, failed, notOpen, reload } = farm.data;
  const onReload = () => void reload();
  const act = (a: Parameters<FarmController["act"]>[0], done?: string) => void farm.act(a, done);
  const round = farm.round;
  const variety = round?.result?.variety ?? state?.plots.find((p) => p.no === round?.plot)?.crop?.variety ?? null;
  const varietyName = catalog?.varieties.find((v) => v.id === variety)?.name ?? variety ?? "";
  return (
    <>
      {onField && notOpen && (
        <p className="pch pointer-events-none absolute left-1/2 top-28 z-10 -translate-x-1/2 px-3 py-1.5 text-center font-vt text-xl">{NOT_OPEN}</p>
      )}
      {farm.work && (
        // the field's own tasks panel and handbook can open from the HUD while the work runs
        <Progress key={farm.work.startedAt} text={farm.work.text} ms={WORK_MS} panelOpen={panelOpen || panel !== null}
          onCancel={farm.cancelWork} />
      )}
      {farm.bed && (
        <Progress key={farm.bed.startedAt} text={farm.bed.text} ms={BED_BAR_MS} panelOpen={panelOpen || panel !== null}
          onCancel={farm.cancelBed} />
      )}
      {round?.game === "harvest" && (
        // a new round (Gặt tiếp, Thử lại) starts a new game
        <HarvestGame key={round.begunAt} round={round} busy={busy} panelOpen={panelOpen || panel !== null} varietyName={varietyName}
          onEnd={farm.endRound} onNext={farm.nextRound} onClose={farm.closeRound} />
      )}
      {round?.game === "transplant" && (
        <TransplantGame key={round.begunAt} round={round} busy={busy} panelOpen={panelOpen || panel !== null}
          onEnd={farm.endRound} onNext={farm.nextRound} onClose={farm.closeRound} />
      )}
      {farm.crab && (
        <CrabGame key={farm.crab.visit.id} crab={farm.crab} panelOpen={panelOpen || panel !== null} onEnd={farm.endCrab}
          onClose={farm.closeCrab} />
      )}
      {farm.sling && (
        <SlingGame key={farm.sling.begunAt} sling={farm.sling} pellets={state?.mine.items[AMMO_PELLET] ?? 0}
          message={farm.sling.gone ? ratGoneText(state?.rats?.recent.find((r) => r.id === farm.sling?.rat) ?? null) : farm.sling.message}
          panelOpen={panelOpen || panel !== null} onShot={(hit) => void farm.slingShot(hit)} onReaim={() => void farm.slingReaim()}
          onClose={farm.closeSling} />
      )}
      {panel?.kind === "plot" && (
        <PlotPanel no={panel.plot} state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act}
          onOpenHandbook={(tab) => openPanel({ kind: "handbook", tab })} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "coop" && (
        <CoopPanel state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload}
          onClose={closePanel} dog={state?.rats ? dog : null} />
      )}
      {panel?.kind === "shop" && (
        <FarmShopPanel mine={state?.mine ?? null} catalog={catalog} failed={failed} busy={busy}
          onBuy={(id, qty) => void farm.buy(id, qty)} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "depot" && (
        <RiceDepotPanel mine={state?.mine ?? null} catalog={catalog} failed={failed} busy={busy}
          onSell={(v, dry, kg) => void farm.sell(v, dry, kg)} onSellProduce={(u, kg) => void farm.sellProduce(u, kg)}
          critters={(catalog?.critters.length ?? 0) > 0
            ? { prices: state?.critterPrices ?? null, onSell: (k) => void farm.sellCritters(k) } : null}
          onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "drying" && (
        <DryingPanel state={state} catalog={catalog} failed={failed} me={me} busy={busy} now={now} onAct={act} onReload={onReload} onClose={closePanel} />
      )}
      {panel?.kind === "handbook" && (
        <Handbook varieties={catalog?.varieties ?? []} uplands={catalog?.uplands ?? []} items={catalog?.items ?? []}
          critters={catalog?.critters ?? []} initial={panel.tab} onClose={closePanel} />
      )}
      {panel?.kind === "tasks" && (
        <FarmTasksPanel tasks={farm.tasks} farming={(state?.mine.farming.length ?? 0) > 0}
          onOpenHandbook={() => openPanel({ kind: "handbook", tab: null })} onClose={closePanel} />
      )}
    </>
  );
}
