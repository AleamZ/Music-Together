"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import type { Variety } from "@/lib/game/farm/catalog";
import { HANDBOOK_TABS, handbookPage, type HandbookTab } from "@/lib/game/farm/handbook";

const isTab = (t: string | null): t is HandbookTab => HANDBOOK_TABS.some(([id]) => id === t);

/** 📖 Sổ tay nhà nông (spec §8.9): six tabs; `initial` opens one (e.g. the plot panel's link). */
export default function Handbook({ varieties, initial, onClose }: { varieties: readonly Variety[]; initial: string | null; onClose: () => void }) {
  const [tab, setTab] = useState<HandbookTab>(isTab(initial) ? initial : "process");
  return (
    <ParchmentModal title="📖 Sổ tay nhà nông" onClose={onClose} className="max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Sổ tay nhà nông" className="flex flex-wrap gap-1">
          {HANDBOOK_TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-2">
          {handbookPage(tab, varieties).map((sec) => (
            <section key={sec.title} className="flex flex-col gap-1">
              <h3 className="text-xl text-burgundy">{sec.title}</h3>
              <ul className="flex flex-col gap-1">
                {sec.lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </ParchmentModal>
  );
}
