"use client";

import type { Card } from "@/lib/game/cards/deck";
import PlayingCard from "./PlayingCard";

/** My hand (spec §13.2): the cards in a row that scrolls sideways on phones. With `onToggle` each card is a toggle and
 *  the selection is always a set of the cards shown; `hidden` keeps some face down (Cào's nặn bài). */
export default function CardHand({ cards, selected = [], onToggle, hidden = [], disabled, label = "Bài của bạn" }: {
  cards: readonly Card[];
  selected?: readonly Card[];
  onToggle?: (card: Card) => void;
  hidden?: readonly Card[];
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="flex max-w-full gap-1 overflow-x-auto px-1 pb-1 pt-3" role="group" aria-label={label}>
      {cards.map((c) => (
        <PlayingCard
          key={c}
          card={c}
          faceDown={hidden.includes(c)}
          selected={selected.includes(c)}
          disabled={disabled}
          onClick={onToggle ? () => onToggle(c) : undefined}
        />
      ))}
    </div>
  );
}
