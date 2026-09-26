"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import type { CritterKind, FarmItem, UplandCrop, Variety } from "@/lib/game/farm/catalog";
import { handbookPage, handbookTabs, type HandbookTab } from "@/lib/game/farm/handbook";

/** 📖 Sổ tay nhà nông (spec §8.9, v15.2 §14, v15.3 §14): the six rice tabs, a tab per hoa-màu crop, Nông cụ, and Cua & ốc
 *  once there are critters; `initial` opens one (e.g. the plot panel's links). The crops' tabs are worked out from their
 *  config; `items` name the fertilizers, pesticides and containers there. */
export default function Handbook({ varieties, uplands = [], items = [], critters = [], initial, onClose }: {
  varieties: readonly Variety[];
  uplands?: readonly UplandCrop[];
  items?: readonly FarmItem[];
  critters?: readonly CritterKind[];
  initial: string | null;
  onClose: () => void;
}) {
  const tabs = handbookTabs(uplands, critters, items);
  const [tab, setTab] = useState<HandbookTab>(tabs.some(([id]) => id === initial) ? initial! : "process");
  return (
    // sm:, because ParchmentModal's own max-w-lg comes later in Tailwind's output than a plain max-w-2xl
    <ParchmentModal title="📖 Sổ tay nhà nông" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Sổ tay nhà nông" className="flex flex-wrap gap-1">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={`pch-btn ${tab === id ? "pch-btn-primary" : ""}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="flex flex-col gap-2">
          {handbookPage(tab, varieties, uplands, items, critters).map((sec) => (
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
