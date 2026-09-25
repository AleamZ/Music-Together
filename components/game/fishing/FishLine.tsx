"use client";

import type { ReactNode } from "react";
import ItemIcon from "@/components/game/ItemIcon";
import { formatWeight, formatXu, RARITY_COLOR, RARITY_NAME, type FishSpecies } from "@/lib/game/fishing/catalog";
import type { FishRow } from "@/lib/game/fishing/state";

/** One fish in a list: icon, name, weight, rarity (in its colour), price, then the row's buttons. */
export default function FishLine({ fish, species, children }: { fish: FishRow; species: FishSpecies | undefined; children?: ReactNode }) {
  const rarity = species?.rarity ?? 1;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5">
      <ItemIcon id={fish.speciesId} scale={2} />
      <span className="min-w-0 flex-1 truncate">{species?.name ?? fish.speciesId}</span>
      <span className="tabular-nums">{formatWeight(fish.weightG)}</span>
      <span style={{ color: RARITY_COLOR[rarity] }}>{RARITY_NAME[rarity]}</span>
      <span className="tabular-nums opacity-80">{formatXu(fish.price)}</span>
      {children}
    </li>
  );
}
