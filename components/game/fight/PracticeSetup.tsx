"use client";

import { LEGEND } from "@/lib/game/fight/input";
import { ParchmentModal } from "../Parchment";

export interface PracticeOptions {
  /** The bot's level, 1–5. */
  level: number;
  /** 1 round, or best of 3. */
  rounds: 1 | 3;
  /** "Bao cát đứng yên": a dummy that never acts. */
  dummy: boolean;
  /** The frame-data toggle: hurtboxes and hitboxes (a dev aid, allowed since practice pays nothing). */
  boxes: boolean;
}

export const DEFAULT_PRACTICE: PracticeOptions = { level: 2, rounds: 3, dummy: false, boxes: false };
export const PRACTICE_LEVELS = [1, 2, 3, 4, 5] as const;

/** The key legend (shared by the setup and the arena). */
export function KeyLegend({ className = "" }: { className?: string }) {
  return (
    <dl className={`grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-vt text-base leading-tight ${className}`} data-testid="fight-legend">
      {LEGEND.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="whitespace-nowrap font-bold">{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** v20.1 practice at the punching bag: the options before a fight (spec §v20.1 "Practice options"). */
export default function PracticeSetup({ value, onChange, onStart, onClose }: {
  value: PracticeOptions;
  onChange: (v: PracticeOptions) => void;
  onStart: () => void;
  onClose: () => void;
}) {
  const set = (more: Partial<PracticeOptions>) => onChange({ ...value, ...more });
  return (
    <ParchmentModal title="🥊 Bao cát · Luyện võ" onClose={onClose} className="sm:max-w-md">
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight">
        <p className="text-base opacity-80">
          Luyện tập miễn phí: không tốn xu, không có thưởng. Võ phái: <b>Tự do</b> (các võ đường mở ở bản sau).
        </p>
        <fieldset className="flex flex-col gap-1" disabled={value.dummy}>
          <legend className="mb-1 font-bold">Đối thủ</legend>
          <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Cấp độ đối thủ">
            {PRACTICE_LEVELS.map((l) => (
              <button
                key={l} type="button" role="radio" aria-checked={value.level === l}
                className={`pch-btn ${value.level === l && !value.dummy ? "pch-btn-primary" : ""}`}
                onClick={() => set({ level: l })}
              >
                Cấp {l}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.dummy} onChange={(e) => set({ dummy: e.target.checked })} />
          Bao cát đứng yên (không đánh trả)
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-bold">Số hiệp</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Số hiệp">
            {([1, 3] as const).map((r) => (
              <button
                key={r} type="button" role="radio" aria-checked={value.rounds === r}
                className={`pch-btn ${value.rounds === r ? "pch-btn-primary" : ""}`}
                onClick={() => set({ rounds: r })}
              >
                {r === 1 ? "1 hiệp" : "3 hiệp (thắng 2)"}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={value.boxes} onChange={(e) => set({ boxes: e.target.checked })} />
          Hiện khung đòn (hitbox)
        </label>
        <details className="text-base">
          <summary className="cursor-pointer">⌨️ Phím</summary>
          <KeyLegend className="mt-1" />
        </details>
        <div className="flex justify-end gap-2">
          <button type="button" className="pch-btn" onClick={onClose}>Để sau</button>
          <button type="button" className="pch-btn pch-btn-primary" onClick={onStart}>Vào đấu</button>
        </div>
      </div>
    </ParchmentModal>
  );
}
