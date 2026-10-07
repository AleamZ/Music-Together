"use client";

import { useCallback } from "react";
import type { FishingController } from "@/hooks/useFishingController";
import BagPanel, { type BagFarm } from "./BagPanel";
import BattlePanel, { BattleChip, BattleResult } from "./BattlePanel";
import BoatPanel from "./BoatPanel";
import TreasurePanel from "./TreasurePanel";
import CatchCard from "./CatchCard";
import DepotPanel from "./DepotPanel";
import NetOverlay from "./NetOverlay";
import NotebookPanel from "./NotebookPanel";
import RecordsPanel from "./RecordsPanel";
import ReelOverlay from "./ReelOverlay";
import ShopPanel from "./ShopPanel";


/** Fishing on top of the world (spec §6.1, §10): "🎣 Thu cần" while waiting, "❗ Giật cần!" at the bite, the reel, the
 *  catch card and the four fishing panels; the bag shows the farm tools once the field has loaded (v15.2 R29). */
export default function FishingOverlays({ fishing, farm = null, onSail = null, onDetect = null, forestToken = null }: {
  fishing: FishingController;
  farm?: BagFarm | null;
  /** 0121: the session, for the bag's forest section. */
  forestToken?: string | null;
  /** v22 (0086): row out to Sông Cái (the shell's explore minigames). */
  onSail?: (() => void) | null;
  /** v22 (0086): switch the metal detector on for a treasure map. */
  onDetect?: ((id: string, map: string) => void) | null;
}) {
  const { cast, caught, panel, busy, closePanel } = fishing;
  const { state, catalog } = fishing.data;
  const name = caught ? catalog?.species.find((s) => s.id === caught.fish.speciesId)?.name ?? caught.fish.speciesId : "";
  const x = fishing.extras;                                                          // v21 (0076)
  const speciesName = (id: string) => catalog?.species.find((s) => s.id === id)?.name ?? id;
  // econ v2 (0101): the depot shows the thương lái's day; before the first sale it is read from the records board
  const { npc, lastSale, learnNpc } = fishing.data;
  const loadBoard = fishing.loadBoard;
  const needNpc = useCallback(() => { loadBoard().then((b) => learnNpc(b.npc), () => {}); }, [loadBoard, learnNpc]);
  return (
    <>
      {cast.phase === "waiting" && (
        <button type="button" onClick={fishing.reelIn} className="pch-btn absolute bottom-24 left-1/2 z-10 -translate-x-1/2 text-xl">
          🎣 Thu cần <span className="pointer-coarse:hidden">(Esc)</span>
        </button>
      )}
      {cast.phase === "bite" && (
        <button
          type="button"
          onClick={fishing.hook}
          className="pch-btn pch-btn-primary absolute bottom-24 left-1/2 z-10 -translate-x-1/2 animate-pulse px-6 py-3 text-3xl motion-reduce:animate-none"
        >
          ❗ Giật cần! <span className="pointer-coarse:hidden text-xl">(Space)</span>
        </button>
      )}
      {cast.phase === "reeling" && <ReelOverlay params={cast.params} rarity={cast.info.rarity} onDone={fishing.reelDone} />}
      {fishing.net && (
        <NetOverlay
          view={fishing.net}
          speciesName={(id) => catalog?.species.find((s) => s.id === id)?.name ?? id}
          onHaul={fishing.netHaul}
          onFinish={fishing.netFinish}
          onClose={fishing.netClose}
          onExpire={fishing.netLapse}
          onPhase={fishing.netPhase}
        />
      )}
      {caught && <CatchCard fish={caught.fish} name={name} record={caught.record} onClose={fishing.dismissCatch} />}
      {panel === "bag" && (
        <BagPanel state={state} catalog={catalog} busy={busy} onEquip={fishing.equipSlot} onRelease={fishing.release} onClose={closePanel}
          farm={farm} groundbaitPick={fishing.groundbaitReady} onPickGroundbait={fishing.pickGroundbait}
          onGroundbait={(item) => fishing.throwGroundbait(item)} onNotebook={() => fishing.openPanel("notebook")} rods={fishing.rods}
          forestToken={forestToken} />
      )}
      {panel === "depot" && (
        <DepotPanel state={state} catalog={catalog} busy={busy} onSell={(ids) => fishing.sell(ids)} onClose={closePanel}
          npc={npc} lastSale={lastSale} onNeedNpc={needNpc} />
      )}
      {panel === "market_depot" && (
        <DepotPanel market state={state} catalog={catalog} busy={busy} onSell={(ids) => fishing.sell(ids, true)} onClose={closePanel}
          npc={npc} lastSale={lastSale} onNeedNpc={needNpc} />
      )}
      {panel === "shop" && <ShopPanel state={state} catalog={catalog} busy={busy} onBuy={fishing.buy} onRepair={fishing.repair} onRepairRod={fishing.rods.repair} onClose={closePanel} />}
      {panel === "records" && <RecordsPanel catalog={catalog} load={fishing.loadBoard} onClose={closePanel} />}
      {panel === "notebook" && <NotebookPanel catalog={catalog} load={fishing.loadNotebook} onClose={closePanel} />}{/* 0110 */}
      {/* v21 (0076): the boat, the battles, the treasure maps */}
      <BattleChip board={x.board} speciesName={speciesName} onOpen={() => fishing.openPanel("battle")} />
      {x.battleResult && <BattleResult won={x.battleResult.won} prize={x.battleResult.prize} onClose={x.dismissBattleResult} />}
      {(x.state?.maps.length ?? 0) > 0 && panel === null && (
        <button type="button" className="pch-btn absolute right-2 top-28 z-10 text-lg" title="Bản đồ kho báu"
          onClick={() => { x.syncMap(); fishing.openPanel("treasure"); }}>
          🗺️ {x.state?.maps.length}
        </button>
      )}
      {x.state?.boat.aboard && panel === null && cast.phase === "idle" && (
        <div className="absolute bottom-24 left-1/2 z-10 flex -translate-x-1/2 gap-2">
          <button type="button" className="pch-btn pch-btn-primary text-xl" onClick={fishing.boatCast}>🎣 Quăng cần (E)</button>
          <button type="button" className="pch-btn text-xl" disabled={x.busy} onClick={x.leave}>⚓ Về bến</button>
        </div>
      )}
      {panel === "boat" && (
        <BoatPanel state={x.state} catalog={catalog} coins={state?.coins ?? null} busy={x.busy} onBuy={x.buyBoat}
          onSail={onSail && (() => { closePanel(); onSail(); })} onClose={closePanel} />
      )}
      {panel === "battle" && (
        <BattlePanel board={x.board} busy={x.busy} speciesName={speciesName} onCreate={x.createBattle} onJoin={x.joinBattle}
          onLeave={x.leaveBattle} onStart={x.startBattle} onClose={closePanel} />
      )}
      {panel === "treasure" && (
        <TreasurePanel state={x.state} mapId={x.mapNow} busy={x.busy} notes={x.digNote}
          onDig={(id) => {
            const m = x.state?.maps.find((t) => t.id === id);
            if (onDetect && m) { closePanel(); onDetect(id, m.map); } else x.dig(id);
          }}
          onClose={closePanel} />
      )}
    </>
  );
}
