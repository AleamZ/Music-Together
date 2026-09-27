"use client";

import { formatXu } from "@/lib/game/fishing/catalog";
import { baitTotal, type FishingState } from "@/lib/game/fishing/state";

/** The player card's wallet (spec §10.1), shown on the card's first row. */
export function CoinsChip({ state }: { state: FishingState | null }) {
  const text = state ? formatXu(state.coins) : "—";
  return (
    <span className="whitespace-nowrap tabular-nums" title={`Xu: ${text}`} data-testid="hud-coins">🪙 {text}</span>
  );
}

/** The player card's status chip: bait and fish (spec §10.1), or on the field the rice summary (v15 §13.1), with the full
 *  text in the tooltip; a reload button when the state failed (§13). */
export default function FishingHud({ state, failed, onReload, riceLine = null }: {
  state: FishingState | null;
  failed: boolean;
  onReload: () => void;
  riceLine?: string | null;
}) {
  const status = riceLine
    ? { text: riceLine, tip: riceLine }
    : state
      ? {
        text: `🪱 ${baitTotal(state)}/${state.baitCap} · 🐟 ${state.fish.length}/${state.fishCap}`,
        tip: `Mồi: ${baitTotal(state)}/${state.baitCap} · Cá: ${state.fish.length}/${state.fishCap}`,
      }
      : null;
  return (
    <>
      {status && (
        <span
          className="min-w-0 max-w-40 truncate rounded-sm border border-ink/30 bg-parchment/70 px-1 leading-5"
          title={status.tip}
          data-testid="hud-status"
        >
          {status.text}
        </span>
      )}
      {failed && (
        <button type="button" className="pch-btn" onClick={onReload} title="Tải lại giỏ đồ">🔄 Tải lại giỏ đồ</button>
      )}
    </>
  );
}
