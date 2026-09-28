"use client";

import SpritePreview from "../SpritePreview";
import { ParchmentModal } from "../Parchment";
import { MARTIAL, beltOf, martialById, movesMaskForRank, statsOf } from "@/lib/game/fight/dojo";
import { enrollGate, enrollmentOf, examGate, practiceGate, type Gate } from "@/lib/game/fight/dojo-gates";
import { STYLE_SPECIALS } from "@/lib/game/fight/moves";
import { specialPoseIds, stancePoseIds } from "@/lib/game/fight/render/poses";
import type { DojoState } from "@/lib/game/fight/rpc";
import RigPreview from "./RigPreview";

const STATS: readonly [keyof ReturnType<typeof statsOf>, string][] = [
  ["atk", "Công"], ["def", "Thủ"], ["walk", "Di chuyển"], ["jump", "Bật nhảy"], ["energy", "Nội lực"],
];

function GateButton({ gate, primary = false, onClick }: { gate: Gate; primary?: boolean; onClick: () => void }) {
  return (
    <span className="flex flex-col items-stretch">
      <button type="button" className={`pch-btn ${primary ? "pch-btn-primary" : ""}`} disabled={!gate.enabled} onClick={onClick}>
        {gate.label}
      </button>
      {gate.reason && <span className="text-center text-sm opacity-75" data-testid="gate-reason">{gate.reason}</span>}
    </span>
  );
}

/** v20.2 the dojo panel (spec §v20.2 "UI flows"): a tab per style — its master, lore, stats, trait, belt ladder and
 *  specials (a looping preview on the rig, locked ones greyed) — and the buttons: Nhập môn, Mặc/Cởi võ phục, Luyện tập,
 *  Thi lên đai (disabled with the reason and a countdown). */
/** v20.4 thầy Lâm's line to a student who has earned the underground (spec §v20.4 "Unlock and entrance"). */
export const UG_HINT_LINE = "Con khá rồi đấy. Muốn thử sức thật thì tìm cái nắp cống giữa sạp đèn lồng và vựa nông sản… gõ ba dài hai ngắn.";

export default function DojoPanel({ state, error, coins, tab, nowMs, busy, onTab, onEnroll, onWear, onUnwear, onPractice, onExam, onClose, ugHint = false }: {
  state: DojoState | null;
  error: string | null;
  coins: number | null;
  tab: number;
  nowMs: number;
  busy: boolean;
  onTab: (id: number) => void;
  onEnroll: (key: string) => void;
  onWear: (key: string) => void;
  onUnwear: () => void;
  onPractice: (key: string) => void;
  onExam: (key: string, gate: Gate) => void;
  onClose: () => void;
  ugHint?: boolean;
}) {
  const m = martialById(tab) ?? MARTIAL[0];
  const e = enrollmentOf(state, m.key);
  const rank = e?.rank ?? -1;
  const wearing = state?.wearing === m.uniform;
  const stats = statsOf(m.id);
  const lookOf = m.masterLook;
  const enroll = enrollGate(state, m.key, coins);
  const exam = examGate(state, m.key, coins, nowMs);
  const practice = practiceGate(state, m.key);
  const off = (g: Gate): Gate => (busy ? { ...g, enabled: false } : g);
  return (
    <ParchmentModal title="🥋 Võ đường · thầy Lâm" onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight">
        {ugHint && <p className="rounded border border-burgundy/50 bg-ink/5 p-2 italic" data-testid="ug-hint">thầy Lâm (ghé tai): “{UG_HINT_LINE}”</p>}
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Võ phái">
          {MARTIAL.map((s) => {
            const r = enrollmentOf(state, s.key)?.rank;
            return (
              <button
                key={s.id} type="button" role="tab" aria-selected={s.id === m.id}
                className={`pch-btn px-2 ${s.id === m.id ? "pch-btn-primary" : ""}`}
                onClick={() => onTab(s.id)}
              >
                {s.name}{r !== undefined && <span className="ml-1 inline-block h-2 w-3 align-middle" style={{ background: beltOf(s.id, r).color }} aria-hidden />}
              </button>
            );
          })}
        </div>
        {error && <p className="text-base text-burgundy" role="alert">{error}</p>}
        <section className="grid gap-3 sm:grid-cols-[auto_1fr]" role="tabpanel" aria-label={m.name}>
          <div className="flex flex-col items-center gap-1">
            <SpritePreview look={lookOf} scale={3} className="rounded-sm bg-parchment" />
            <b>{m.master}</b>
            <RigPreview look={lookOf} style={m.id} rank={4} poses={stancePoseIds(m.id)} ms={420} label={`Thế đứng ${m.name}`} />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <p className="text-base italic">“{m.lore}”</p>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-0.5 text-base" aria-label="Chỉ số">
              {STATS.map(([k, label]) => (
                <div key={k} className="contents">
                  <dt>{label}</dt>
                  <dd className="flex items-center gap-1">
                    <span className="h-2 rounded-sm bg-burgundy" style={{ width: `${Math.round(stats[k] * 0.9)}px` }} />
                    <span className="text-sm opacity-70">{stats[k]}</span>
                  </dd>
                </div>
              ))}
            </dl>
            <p className="text-base">✦ {m.trait}</p>
            <ol className="flex flex-wrap gap-1 text-sm" aria-label="Các đai">
              {m.belts.map((b) => (
                <li
                  key={b.rank}
                  className={`flex items-center gap-1 rounded-sm border px-1 ${b.rank === rank ? "border-burgundy bg-parchment-200 font-bold" : "border-transparent opacity-80"}`}
                  aria-current={b.rank === rank ? "step" : undefined}
                >
                  <span className="inline-block h-2 w-4 border border-ink/40" style={{ background: b.color }} aria-hidden />
                  {b.name}
                </li>
              ))}
            </ol>
          </div>
        </section>
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Chiêu thức">
          {(STYLE_SPECIALS[m.id] ?? []).map((s) => {
            const open = rank >= 0 && (movesMaskForRank(rank) & (1 << (s.slot - 1))) !== 0;
            return (
              <li key={s.slot} className={`flex items-center gap-2 rounded-sm border border-gold-200 p-1 ${open ? "" : "opacity-60"}`}>
                <RigPreview look={lookOf} style={m.id} rank={4} poses={specialPoseIds(m.id, s.slot)} scale={1} dim={!open} label={s.name} />
                <span className="flex min-w-0 flex-col">
                  <b className="truncate">{s.slot === 5 ? "Tuyệt kỹ · " : ""}{s.name}</b>
                  <span className="text-base">{s.input}</span>
                  {!open && <span className="text-sm">🔒 Mở ở {beltOf(m.id, s.slot - 1).name}</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-wrap items-start justify-end gap-2 border-t-2 border-gold-200 pt-2">
          {!e && <GateButton gate={off(enroll)} primary onClick={() => onEnroll(m.key)} />}
          {e && (
            wearing
              ? <button type="button" className="pch-btn" disabled={busy} onClick={onUnwear}>Cởi võ phục</button>
              : <button type="button" className="pch-btn" disabled={busy} onClick={() => onWear(m.key)}>Mặc võ phục</button>
          )}
          {e && <GateButton gate={off(practice)} onClick={() => onPractice(m.key)} />}
          {e && <GateButton gate={off(exam)} primary onClick={() => onExam(m.key, exam)} />}
        </div>
      </div>
    </ParchmentModal>
  );
}
