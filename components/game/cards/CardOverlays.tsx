"use client";

import type { CardsController } from "@/hooks/useCardsController";
import type { Look } from "@/lib/game/types";
import CardTablePanel from "./CardTablePanel";
import RulesBook from "./RulesBook";

/** The card corner on top of the world (spec §13): the open table's panel and 📜 Sổ luật above it. While the book is open
 *  its Esc is its own: the panel under it stays. */
export default function CardOverlays({ cards, me, coins, looks }: { cards: CardsController; me: string; coins: number | null; looks?: Map<string, Look> }) {
  const { panel, rules } = cards;
  return (
    <>
      {panel !== null && (
        <CardTablePanel game={panel} table={cards.table} me={me} coins={coins} act={cards.act} looks={looks}
          onOpenRules={() => cards.openRules(panel)} onClose={rules ? () => {} : cards.closePanel} />
      )}
      {rules && <RulesBook initial={rules.game} stake={rules.stake} onClose={cards.closeRules} />}
    </>
  );
}
