"use client";

import { cardAria, isRed, RANK_NAMES, rankOf, SUIT_GLYPHS, suitOf, type Card } from "@/lib/game/cards/deck";

/** The card sizes (spec §13.2): 40 × 56 (32 × 46 on phones), a mini size for the rules book and the pile, and a tiny
 *  one for the backs at the seats. */
const SIZE = {
  normal: "h-[46px] w-8 text-base sm:h-14 sm:w-10 sm:text-lg",
  mini: "h-[34px] w-6 text-sm",
  tiny: "h-[22px] w-4 text-[10px]",
} as const;

/** The back: burgundy with a gold lattice (CSS gradients). */
const BACK = {
  backgroundColor: "#6e2233",
  backgroundImage: "repeating-linear-gradient(45deg, rgb(224 179 60 / 0.55) 0 1px, transparent 1px 5px), "
    + "repeating-linear-gradient(-45deg, rgb(224 179 60 / 0.55) 0 1px, transparent 1px 5px)",
} as const;

/** A playing card in the pixel font: parchment face, red for ♥ ♦, the rank over the suit; or its back. As a button
 *  (`onClick`) it is a toggle: a selected card lifts 8 px. */
export default function PlayingCard({ card, faceDown = false, selected = false, size = "normal", onClick, disabled }: {
  card: Card | null;
  faceDown?: boolean;
  selected?: boolean;
  size?: keyof typeof SIZE;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const hidden = faceDown || card === null;
  const face = hidden ? null : (
    <>
      <span className="leading-none">{RANK_NAMES[rankOf(card)]}</span>
      <span className="leading-none">{SUIT_GLYPHS[suitOf(card)]}</span>
    </>
  );
  const look = `${SIZE[size]} inline-flex shrink-0 select-none flex-col items-center justify-center rounded-[3px] border-2 border-ink/70 font-vt `
    + `shadow-[1px_1px_0_rgb(58_36_24_/_0.35)] motion-safe:transition-transform motion-safe:duration-150 `
    + `${hidden ? "" : `bg-cream ${isRed(card) ? "text-[#c0392b]" : "text-ink"}`} ${selected ? "-translate-y-2" : ""}`;
  const label = hidden ? "Lá úp" : cardAria(card);
  if (onClick) {
    return (
      <button type="button" className={look} style={hidden ? BACK : undefined} aria-label={label} aria-pressed={selected}
        disabled={disabled} onClick={onClick}>
        {face}
      </button>
    );
  }
  return (
    <span className={look} style={hidden ? BACK : undefined} role="img" aria-label={label}>
      {face}
    </span>
  );
}

/** Cards in a row (a pile, a board, a shown hand). */
export function CardRow({ cards, size = "mini", label }: { cards: readonly (Card | null)[]; size?: keyof typeof SIZE; label?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5" aria-label={label}>
      {cards.map((c, i) => <PlayingCard key={c ?? `back${i}`} card={c} size={size} />)}
    </span>
  );
}
