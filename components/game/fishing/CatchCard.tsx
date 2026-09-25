"use client";

import { useEffect } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { formatWeight, formatXu, RARITY_COLOR, RARITY_NAME } from "@/lib/game/fishing/catalog";
import type { CaughtFish } from "@/lib/game/fishing/rpc";

/** The catch card (spec §10.3): the fish, its weight, rarity and price; "🏆 Kỷ lục mới!" for a personal best.
 *  OK closes it, and it closes by itself after 5 s. */
export default function CatchCard({ fish, name, record, onClose }: {
  fish: CaughtFish;
  name: string;
  record: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="pch fixed left-1/2 top-1/4 z-40 flex -translate-x-1/2 flex-col items-center gap-1 p-3 font-vt text-xl leading-tight" role="dialog" aria-label="Câu được cá">
      <ItemIcon id={fish.speciesId} scale={5} />
      <p className="text-2xl">{name}</p>
      <p>
        {formatWeight(fish.weightG)} · <span style={{ color: RARITY_COLOR[fish.rarity] }}>{RARITY_NAME[fish.rarity]}</span>
      </p>
      <p className="opacity-80">≈ {formatXu(fish.price)}</p>
      {record && <p className="text-burgundy">🏆 Kỷ lục mới!</p>}
      <button type="button" className="pch-btn pch-btn-primary mt-1" onClick={onClose} autoFocus>OK</button>
    </div>
  );
}
