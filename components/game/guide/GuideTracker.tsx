"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  GUIDE_START, GUIDE_STEPS, guideFinished, guideKey, parseGuide, stepDone, type GuideCtx, type GuideSave,
} from "@/lib/game/guide/model";
import { HudSlotted } from "../hud/HudSlot";

// "Hướng dẫn tân thủ" on the HUD (lib/game/guide/model.ts): the step I am on — what to do, how, where — in the HUD's
// chip slot. A step done shows ✅ for a moment, then the next one comes; the last one congratulates. It folds to one
// line, and ✕ hides it (a small 🧭 chip brings it back). Progress is kept per account in this browser.

const noSubscribe = () => () => {};
const DONE_MS = 1600;

/** The raw saved string ("" = none; a string, so the store's snapshot compares by value). */
function readRaw(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export default function GuideTracker({ accountId, ctx, onStepDone }: {
  accountId: string;
  ctx: GuideCtx;
  /** A step was done (the shell toasts it). */
  onStepDone?: (title: string) => void;
}) {
  const key = guideKey(accountId);
  const raw = useSyncExternalStore(noSubscribe, () => readRaw(key), () => null);
  const stored = useMemo(() => (raw === null ? null : parseGuide(raw)), [raw]);
  const [mine, setMine] = useState<GuideSave | null>(null);
  const save = mine ?? stored ?? GUIDE_START;
  const put = (s: GuideSave) => {
    setMine(s);
    try { window.localStorage.setItem(key, JSON.stringify(s)); } catch { /* storage blocked: this page only */ }
  };
  const [folded, setFolded] = useState(false);

  // the state when the current step began (numbers still loading are filled in as they arrive)
  const [base, setBase] = useState<{ step: number; ctx: GuideCtx } | null>(null);
  if (stored !== null && (!base || base.step !== save.step)) {
    setBase({ step: save.step, ctx });
  } else if (base && (["fish", "coins", "hunger", "thirst"] as const).some((f) => base.ctx[f] === null && ctx[f] !== null)) {
    setBase({ step: base.step, ctx: {
      ...base.ctx,
      fish: base.ctx.fish ?? ctx.fish, coins: base.ctx.coins ?? ctx.coins, hunger: base.ctx.hunger ?? ctx.hunger, thirst: base.ctx.thirst ?? ctx.thirst,
    } });
  }
  const finished = guideFinished(save);
  const done = !finished && !!base && base.step === save.step && stepDone(save.step, ctx, base.ctx);

  // a step done: ✅ for a moment, then the next step
  const step = save.step, title = GUIDE_STEPS[step]?.title ?? "";
  useEffect(() => {
    if (!done) return;
    onStepDone?.(title);
    const t = window.setTimeout(() => {
      const next = { ...save, step: step + 1 };
      setMine(next);
      try { window.localStorage.setItem(key, JSON.stringify(next)); } catch { /* storage blocked */ }
    }, DONE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, step]);

  if (stored === null) return null;                                               // the server render: nothing
  if (save.hidden) {
    if (finished) return null;
    return (
      <HudSlotted>
        <button type="button" className="pch-btn font-vt text-lg" data-testid="guide-show" title="Hiện hướng dẫn tân thủ"
          onClick={() => put({ ...save, hidden: false })}>
          🧭 Hướng dẫn {step + 1}/{GUIDE_STEPS.length}
        </button>
      </HudSlotted>
    );
  }
  if (finished) {
    return (
      <HudSlotted>
        <div className="pch flex w-full max-w-[20rem] flex-col gap-1.5 p-2 font-vt leading-tight" data-testid="guide" role="status">
          <p className="text-xl text-burgundy">🎉 Bạn đã nắm cách chơi!</p>
          <p className="text-base">Câu cá, bán cá, ăn uống, nhận nhiệm vụ — giờ thì tự do khám phá làng. Lên cấp để mở thêm khu mới nhé.</p>
          <button type="button" className="pch-btn self-end" onClick={() => put({ ...save, hidden: true })}>Đóng</button>
        </div>
      </HudSlotted>
    );
  }
  const s = GUIDE_STEPS[step];
  return (
    <HudSlotted>
      <section className={`pch flex w-full max-w-[20rem] flex-col gap-1 p-2 font-vt leading-tight ${done ? "ring-2 ring-emerald-600" : ""}`}
        data-testid="guide" aria-label="Hướng dẫn tân thủ" aria-live="polite">
        <header className="flex items-center gap-1.5 text-base">
          <span className="flex-1 truncate opacity-80">🧭 Hướng dẫn tân thủ · {step + 1}/{GUIDE_STEPS.length}</span>
          <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => setFolded((f) => !f)}
            aria-expanded={!folded} title={folded ? "Mở" : "Thu gọn"}>{folded ? "▾" : "▴"}</button>
          <button type="button" className="pch-btn px-1.5 py-0.5 text-sm" onClick={() => put({ ...save, hidden: true })}
            aria-label="Ẩn hướng dẫn" title="Ẩn hướng dẫn">✕</button>
        </header>
        <p className={`text-xl ${done ? "text-emerald-700" : "text-burgundy"}`}>{done ? "✅ " : "▸ "}{s.title}</p>
        {!folded && (
          <>
            <p className="text-base">{s.hint}</p>
            {s.where && <p className="text-sm opacity-80">📍 {s.where}</p>}
            <div className="mt-0.5 flex gap-0.5" aria-hidden="true">
              {GUIDE_STEPS.map((g, i) => (
                <span key={g.id} className={`h-1.5 flex-1 rounded-sm ${i < step || (i === step && done) ? "bg-emerald-600" : i === step ? "bg-burgundy" : "bg-parchment-300"}`} />
              ))}
            </div>
          </>
        )}
      </section>
    </HudSlotted>
  );
}
