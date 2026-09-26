"use client";

import { chipLabel, chipText } from "@/lib/anticheat";

/** The running anti-cheat lock in the player card, "🔒 4:07" (spec §12.1); nothing when no lock runs. */
export default function AnticheatChip({ secondsLeft }: { secondsLeft: number }) {
  if (secondsLeft <= 0) return null;
  const label = chipLabel(secondsLeft);
  return (
    <span role="timer" title={label} aria-label={label} className="self-start rounded-sm bg-burgundy px-1.5 py-0.5 text-lg leading-none text-parchment">
      {chipText(secondsLeft)}
    </span>
  );
}
