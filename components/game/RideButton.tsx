"use client";

import { useEffect, useState } from "react";
import { isTyping } from "@/lib/game/keys";
import { ownedVehicles, pickMount, RIDE_KEY } from "@/lib/game/travel/ride";
import { VEHICLES, type VehicleId } from "@/lib/game/travel/vehicles";

export interface RideButtonProps {
  owned: readonly string[];
  riding: VehicleId | null;
  /** The vehicle the R key mounts first (the last one used). */
  last: VehicleId | null;
  /** The R key listens only while the world takes input. */
  keyEnabled: boolean;
  onMount: (v: VehicleId) => void;
  onDismount: () => void;
}

const info = (v: VehicleId) => VEHICLES.find((x) => x.id === v)!;
/** The R key's corner badge (the key itself is this button's own listener). */
const BADGE = <span aria-hidden="true" className="pointer-events-none absolute -bottom-1 -right-1 rounded-sm bg-black/70 px-0.5 font-vt text-[10px] leading-none text-white pointer-coarse:hidden">R</span>;

/** v18.7: the HUD's ride button (one vehicle mounts at once, more open a picker) and the R key. */
export default function RideButton({ owned, riding, last, keyEnabled, onMount, onDismount }: RideButtonProps) {
  const [picking, setPicking] = useState(false);
  const mine = ownedVehicles(owned);

  useEffect(() => {
    if (!keyEnabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== RIDE_KEY || e.repeat || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
      if (riding) {
        onDismount();
        return;
      }
      const v = pickMount(owned, last);
      if (v) onMount(v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyEnabled, riding, owned, last, onMount, onDismount]);

  if (mine.length === 0) return null;
  if (riding) {
    return <button type="button" className="pch-btn pch-btn-primary relative" title="Xuống xe (R)" onClick={onDismount}>{info(riding).icon}<span className="sr-only"> Xuống xe</span>{BADGE}</button>;
  }
  if (mine.length === 1) {
    return <button type="button" className="pch-btn relative" title={`Lên xe: ${info(mine[0]).name} (R)`} onClick={() => onMount(mine[0])}>{info(mine[0]).icon}<span className="sr-only"> Lên xe</span>{BADGE}</button>;
  }
  return (
    <span className="relative">
      <button type="button" className="pch-btn relative" title="Lên xe (R)" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
        {info(pickMount(owned, last) ?? mine[0]).icon}<span className="sr-only"> Lên xe</span>{BADGE}
      </button>
      {picking && (
        <span role="menu" className="pch absolute left-0 top-full z-30 mt-1 flex flex-col gap-1 p-1">
          {mine.map((v) => (
            <button
              key={v}
              type="button"
              role="menuitem"
              className="pch-btn whitespace-nowrap"
              onClick={() => {
                setPicking(false);
                onMount(v);
              }}
            >
              {info(v).icon} {info(v).name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}
