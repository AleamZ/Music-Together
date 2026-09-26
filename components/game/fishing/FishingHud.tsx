"use client";

import { formatXu } from "@/lib/game/fishing/catalog";
import { baitTotal, type FishingState } from "@/lib/game/fishing/state";

/** The player card's fishing line: coins, bait and fish (spec §10.1); a reload button when the state failed (§13).
 *  On the field the rice summary replaces bait and fish (v15 §13.1). */
export default function FishingHud({ state, failed, onReload, riceLine = null }: {
  state: FishingState | null;
  failed: boolean;
  onReload: () => void;
  riceLine?: string | null;
}) {
  return (
    <div className="flex flex-col gap-1 text-base leading-none">
      <span className="text-lg">🪙 {state ? formatXu(state.coins) : "—"}</span>
      {riceLine ? <span>{riceLine}</span> : state && (
        <span title="Mồi · Cá">🪱 {baitTotal(state)}/{state.baitCap} · 🐟 {state.fish.length}/{state.fishCap}</span>
      )}
      {failed && (
        <button type="button" className="pch-btn self-start" onClick={onReload}>🔄 Tải lại giỏ đồ</button>
      )}
    </div>
  );
}
