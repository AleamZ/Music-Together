"use client";

import { BUFF_TEXT, PROFESSIONS } from "@/lib/game/professions/catalog";
import type { BuffRow, ProfState, StaminaState } from "@/lib/game/professions/model";
import KeyBadge from "../KeyBadge";

const LOW = 20;

/** v21 (0077): the stamina bar beside hunger and thirst, the active food/potion buffs, and the "Nghề nghiệp" button. */
export default function StaminaHud({ stamina, value, state, nowMs, onOpen }: {
  stamina: StaminaState | null; value: number | null; state: ProfState | null; nowMs: number; onOpen: () => void;
}) {
  const max = stamina?.max ?? 100;
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const low = value !== null && value < LOW;
  const text = value === null ? "—" : String(Math.floor(value));
  const main = state?.main ? PROFESSIONS.find((p) => p.id === state.main) : null;
  const buffs: BuffRow[] = (state?.buffs ?? []).filter((b) => b.untilMs > nowMs);
  return (
    <div className="flex items-center gap-1.5 font-vt text-base leading-none">
      <div
        aria-label="Thể lực"
        data-testid="stamina-bar"
        title={`Thể lực: ${text}/${max}${stamina?.resting ? " — đang nghỉ, hồi nhanh ×3" : ""}. Giữ Shift để chạy; câu cá, kéo lưới, đào mỏ, đấu võ đều tốn thể lực.`}
        className={`flex items-center gap-0.5 ${low ? "text-red-700 motion-safe:animate-pulse" : ""}`}
      >
        <span aria-hidden="true">{stamina?.resting ? "😌" : "⚡"}</span>
        <span className="relative h-2.5 w-12 overflow-hidden rounded-sm border border-ink/40 bg-parchment">
          <span className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: low ? "#c0392b" : "#5aa845" }} />
        </span>
        <span className="text-sm tabular-nums">{text}</span>
      </div>
      {buffs.map((b) => {
        const t = BUFF_TEXT[b.key];
        const mins = Math.max(1, Math.ceil((b.untilMs - nowMs) / 60000));
        return t ? (
          <span key={b.key} data-testid={`buff-${b.key}`} className="whitespace-nowrap text-sm"
            title={`${t.name}: +${b.value}${t.unit} — còn ${mins} phút`}>{t.icon}</span>
        ) : null;
      })}
      <button type="button" className="pch-btn relative px-1 py-0 text-sm leading-none" onClick={onOpen} data-hotkey="profession"
        title={main ? `Nghề nghiệp: ${main.name} (3)` : "Nghề nghiệp — chọn nghề chính (3)"} data-testid="profession-open">
        {main ? main.icon : "🛠️"}<span className="sr-only"> Nghề nghiệp</span><KeyBadge id="profession" />
      </button>
    </div>
  );
}
