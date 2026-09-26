"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import type { CardGame } from "@/lib/game/cards/deck";
import { signedXu } from "@/lib/game/cards/messages";
import { RULES_TABS, rulesPage, type RuleLine } from "@/lib/game/cards/rules";
import { CardRow } from "./PlayingCard";

function Line({ line }: { line: RuleLine }) {
  return (
    <>
      {line.map((seg, i) => (typeof seg === "string" ? <span key={i}>{seg}</span> : <CardRow key={i} cards={seg.cards} />))}
    </>
  );
}

/** 📜 Sổ luật (spec §14): a tab per game, opened on the current table's, its money examples at that table's stake. */
export default function RulesBook({ initial, stake, onClose }: { initial: CardGame; stake: number; onClose: () => void }) {
  const [tab, setTab] = useState<CardGame>(initial);
  const page = rulesPage(tab, stake);
  return (
    // sm:, because ParchmentModal's own max-w-lg comes later in Tailwind's output than a plain max-w-2xl
    <ParchmentModal title="📜 Sổ luật" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Sổ luật" className="flex flex-wrap gap-1">
          {RULES_TABS.map((t) => (
            <button key={t.game} type="button" role="tab" aria-selected={tab === t.game}
              className={`pch-btn ${tab === t.game ? "pch-btn-primary" : ""}`} onClick={() => setTab(t.game)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 rounded-sm bg-parchment-200 p-1.5 text-base">
          {page.header.map((h) => <p key={h}>{h}</p>)}
        </div>
        <div role="tabpanel" className="flex flex-col gap-2">
          {page.sections.map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
              <h3 className="text-xl text-burgundy">{sec.title}</h3>
              <ul className="flex flex-col gap-1">
                {sec.lines.map((l, i) => <li key={i} className="flex flex-wrap items-center gap-x-1"><Line line={l} /></li>)}
              </ul>
              {sec.examples.map((e) => (
                <div key={e.title} className="flex flex-col gap-1 rounded-sm border-2 border-gold-200 p-1.5">
                  <h4 className="text-burgundy">{e.title}</h4>
                  {e.lines.map((l, i) => <p key={i} className="flex flex-wrap items-center gap-x-1"><Line line={l} /></p>)}
                  <p aria-label="Kết quả">{e.net.map((n) => `${n.who} ${signedXu(n.xu)}`).join(" · ")}</p>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </ParchmentModal>
  );
}
