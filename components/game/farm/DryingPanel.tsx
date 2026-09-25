"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { DRY_HOURS, DRYING_SLOTS, type FarmCatalog } from "@/lib/game/farm/catalog";
import { durationText } from "@/lib/game/farm/messages";
import type { FieldAction } from "@/lib/game/farm/rpc";
import type { FieldState } from "@/lib/game/farm/state";
import FieldStatus from "./FieldStatus";
import Stepper from "./Stepper";

/** ☀️ Sân phơi lúa (spec §8.7): the 4 slots for everyone to see, "Phơi lúa" (variety + kg) and "Lấy lúa". */
export default function DryingPanel({ state, catalog, failed, me, busy, now, onAct, onReload, onClose }: {
  state: FieldState | null;
  catalog: FarmCatalog | null;
  failed: boolean;
  me: string;
  busy: boolean;
  now: number;
  onAct: (a: FieldAction, done?: string) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const wet = (catalog?.varieties ?? []).filter((v) => (state?.mine.rice[v.id]?.wet ?? 0) > 0);
  const [variety, setVariety] = useState<string | null>(null);
  const chosen = wet.find((v) => v.id === variety) ?? wet[0] ?? null;
  const stock = chosen ? state?.mine.rice[chosen.id]?.wet ?? 0 : 0;
  const [kg, setKg] = useState<number | null>(null);
  const n = Math.min(Math.max(1, kg ?? stock), stock);
  const name = (id: string) => catalog?.varieties.find((v) => v.id === id)?.name ?? id;
  const full = (state?.drying.length ?? 0) >= DRYING_SLOTS;
  return (
    <ParchmentModal title="☀️ Sân phơi lúa" onClose={onClose}>
      <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
        {!state || !catalog ? (
          <FieldStatus failed={failed} onReload={onReload} />
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-2">
              {Array.from({ length: DRYING_SLOTS }, (_, i) => i + 1).map((slot) => {
                const d = state.drying.find((x) => x.slot === slot);
                const mineReady = d && d.owner?.id === me && d.readyAt <= now;
                return (
                  <li key={slot} className="pch flex flex-col gap-1 p-2">
                    <span className="text-xl">Ô {slot}</span>
                    {!d ? (
                      <span className="opacity-80">Trống</span>
                    ) : (
                      <span>
                        {d.owner?.id === me ? "Lúa của bạn" : `Lúa của ${d.owner?.name ?? "ai đó"}`}: {d.kg} kg {name(d.variety).toLowerCase()}
                        {" — "}{d.readyAt <= now ? "đã khô" : `còn ${durationText(d.readyAt - now)}`}
                      </span>
                    )}
                    {mineReady && (
                      <button type="button" className="pch-btn pch-btn-primary" disabled={busy}
                        onClick={() => onAct({ kind: "dry_collect", slot }, `Đã lấy ${d.kg} kg ${name(d.variety).toLowerCase()} khô.`)}>
                        Lấy lúa
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {wet.length === 0 ? (
              <p>Bạn chưa có lúa ướt để phơi — gặt lúa trước đã.</p>
            ) : (
              <section className="pch flex flex-col gap-1 p-2">
                <h3 className="text-xl text-burgundy">Phơi lúa ({DRY_HOURS} giờ là khô)</h3>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Giống lúa">
                  {wet.map((v) => (
                    <button key={v.id} type="button" className="pch-btn text-base" aria-pressed={chosen?.id === v.id} onClick={() => { setVariety(v.id); setKg(null); }}>
                      {v.name} ({state.mine.rice[v.id].wet} kg)
                    </button>
                  ))}
                </div>
                {chosen && (
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <Stepper value={n} max={stock} label={`Số kg ${chosen.name}`} unit=" kg" onChange={setKg} />
                    <button type="button" className="pch-btn pch-btn-primary" disabled={busy || full}
                      onClick={() => onAct({ kind: "dry_start", variety: chosen.id, kg: n }, `Đang phơi ${n} kg ${chosen.name.toLowerCase()} — ${DRY_HOURS} giờ nữa là khô.`)}>
                      {full ? "Sân phơi đã đầy" : "Phơi lúa"}
                    </button>
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </ParchmentModal>
  );
}
