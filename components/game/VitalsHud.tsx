"use client";

import { EXHAUST_AT, lowWarn } from "@/lib/game/vitals";
import type { VitalsState } from "@/lib/game/vitals-rpc";

function Bar({ label, icon, value, low, color }: { label: string; icon: string; value: number | null; low: boolean; color: string }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, value));
  const text = value === null ? "—" : String(Math.round(pct));
  return (
    <div
      aria-label={label}
      data-low={low ? "true" : "false"}
      title={`${label}: ${text}/100`}
      className={`flex items-center gap-0.5 ${low ? "text-red-700 motion-safe:animate-pulse" : ""}`}
    >
      <span aria-hidden="true">{icon}</span>
      <span className="relative h-2 w-9 overflow-hidden rounded-sm border border-ink/40 bg-parchment">
        <span className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: low ? "#c0392b" : color }} />
      </span>
      <span className="text-sm tabular-nums">{text}</span>
    </div>
  );
}

/** Hunger and thirst mini bars for the HUD card (v18.3); the exact values are in each bar's tooltip too. */
export default function VitalsHud({ state }: { state: VitalsState | null }) {
  const low = state ? lowWarn(state) : { hunger: false, thirst: false };
  const faints = state?.faintCount ?? 0;                                                // faint ladder
  return (
    <div className="flex items-center gap-2 font-vt text-base leading-none">
      <Bar label="Đói" icon="🍚" value={state?.hunger ?? null} low={low.hunger} color="#d9a441" />
      <Bar label="Khát" icon="💧" value={state?.thirst ?? null} low={low.thirst} color="#3d8fd1" />
      {faints >= 1 && (
        <span
          aria-label="Số lần ngất hôm nay"
          title={`Đã ngất ${faints} lần hôm nay — lần thứ ${EXHAUST_AT} sẽ kiệt sức cả ngày`}
          className={`text-sm tabular-nums ${faints >= EXHAUST_AT - 1 ? "text-red-700" : ""}`}
        >
          😵{faints}/{EXHAUST_AT}
        </span>
      )}
    </div>
  );
}
