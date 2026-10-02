"use client";

import { useState } from "react";
import { ParchmentModal } from "@/components/game/Parchment";
import { BUFF_TEXT, MAX_LEVEL, PERK_TEXT, PROFESSIONS, type ProfId, type SkillNode } from "@/lib/game/professions/catalog";
import {
  levelProgress, nodeStatus, nodesOf, pointsLeft, professionErrorMessage, xpForLevel, type NodeStatus, type ProfState,
} from "@/lib/game/professions/model";
import { professionChoose, skillLearn, skillReset } from "@/lib/game/professions/rpc";

const STATUS_CLS: Record<NodeStatus, string> = {
  learned: "border-emerald-700 bg-emerald-100",
  open: "border-burgundy bg-parchment hover:bg-amber-100",
  poor: "border-ink/40 bg-parchment opacity-80",
  locked: "border-ink/30 bg-ink/10 opacity-60",
};

/** The tree's rows: roots, then their children, then grandchildren. */
function tiers(nodes: SkillNode[]): SkillNode[][] {
  const depth = new Map<string, number>();
  const d = (n: SkillNode): number => {
    if (depth.has(n.id)) return depth.get(n.id)!;
    const parent = n.req ? nodes.find((x) => x.id === n.req) : undefined;
    const v = parent ? d(parent) + 1 : 0;
    depth.set(n.id, v);
    return v;
  };
  const rows: SkillNode[][] = [];
  for (const n of nodes) (rows[d(n)] ??= []).push(n);
  return rows;
}

/** v21 (0077): "Nghề nghiệp" — the main profession, each profession's level and its skill tree. */
export default function ProfessionModal({ token, state, nowMs, onState, onCoins, onClose }: {
  token: string; state: ProfState | null; nowMs: number;
  onState: (s: ProfState) => void; onCoins: () => void; onClose: () => void;
}) {
  const [tab, setTab] = useState<ProfId>(state?.main ?? "ngu_dan");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const run = async (f: () => Promise<ProfState>, coins = false) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      onState(await f());
      if (coins) onCoins();
    } catch (e) {
      setMsg(professionErrorMessage(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e)));
    } finally {
      setBusy(false);
    }
  };

  if (!state) {
    return <ParchmentModal title="Nghề nghiệp" onClose={onClose} className="sm:max-w-2xl"><p>Đang tải…</p></ParchmentModal>;
  }
  const prof = PROFESSIONS.find((p) => p.id === tab)!;
  const row = state.profs.find((p) => p.id === tab);
  const left = pointsLeft(row);
  const learned = new Set(state.skills);
  const isMain = state.main === tab;
  const canSwitchAt = state.switchAtMs ?? 0;
  const cooling = state.main !== null && !isMain && canSwitchAt > nowMs;
  const level = row?.level ?? 0;
  const hasSkills = nodesOf(tab).some((n) => learned.has(n.id));

  return (
    <ParchmentModal title="Nghề nghiệp" onClose={onClose} className="sm:max-w-2xl">
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight">
        <div role="tablist" aria-label="Các nghề" className="flex flex-wrap gap-1">
          {PROFESSIONS.map((p) => {
            const r = state.profs.find((x) => x.id === p.id);
            return (
              <button key={p.id} type="button" role="tab" aria-selected={tab === p.id} onClick={() => setTab(p.id)}
                className={`pch-btn px-2 py-0.5 text-base ${tab === p.id ? "bg-burgundy text-parchment" : ""}`}
                title={`${p.name} — cấp ${r?.level ?? 0}`} data-testid={`prof-tab-${p.id}`}>
                {p.icon}<span className="ml-1 hidden sm:inline">{p.name}</span>
                {state.main === p.id && <span aria-label="nghề chính"> ★</span>}
              </button>
            );
          })}
        </div>

        <section className="rounded-sm border border-ink/30 p-2">
          <h3 className="font-playfair text-xl font-bold">{prof.icon} {prof.name} — cấp {level}{level >= MAX_LEVEL ? " (tối đa)" : ""}</h3>
          <p className="text-base opacity-80">{prof.blurb}</p>
          <div className="mt-1 flex items-center gap-2 text-base">
            <span className="relative h-2.5 w-40 overflow-hidden rounded-sm border border-ink/40 bg-parchment">
              <span className="absolute inset-y-0 left-0 bg-amber-600" style={{ width: `${levelProgress(row?.xp ?? 0) * 100}%` }} />
            </span>
            <span className="tabular-nums">{row?.xp ?? 0}{level < MAX_LEVEL ? ` / ${xpForLevel(level + 1)}` : ""} xp</span>
            <span>· {left} điểm kỹ năng</span>
          </div>
          <p className="mt-1 text-base">
            {isMain
              ? "★ Nghề chính: kỹ năng đã học đang có hiệu lực, kinh nghiệm ×1,5."
              : "Chỉ kỹ năng của nghề chính mới có hiệu lực. Nghề nào cũng lên cấp khi bạn làm việc của nghề đó."}
          </p>
          {!isMain && (
            <button type="button" className="pch-btn mt-1" disabled={busy || cooling} data-testid="prof-choose"
              onClick={() => void run(() => professionChoose(token, tab), state.main !== null)}>
              {state.main === null ? "Chọn làm nghề chính (miễn phí)"
                : cooling ? `Đổi nghề sau ${Math.ceil((canSwitchAt - nowMs) / 3_600_000)} giờ nữa`
                  : `Đổi sang nghề này (${state.switchFee} xu)`}
            </button>
          )}
        </section>

        <section aria-label="Cây kỹ năng" className="flex flex-col gap-2">
          {tiers(nodesOf(tab)).map((tier, i) => (
            <div key={i} className="flex flex-wrap justify-center gap-2">
              {tier.map((n) => {
                const st = nodeStatus(n, learned, left);
                const req = n.req ? nodesOf(tab).find((x) => x.id === n.req) : null;
                return (
                  <button key={n.id} type="button" data-testid={`skill-${n.id}`} data-status={st}
                    disabled={busy || st !== "open"}
                    onClick={() => void run(() => skillLearn(token, n.id))}
                    className={`w-40 rounded-sm border-2 p-1.5 text-left text-base leading-tight ${STATUS_CLS[st]}`}
                    title={st === "locked" && req ? `Cần học "${req.name}" trước` : st === "poor" ? `Cần ${n.cost} điểm` : ""}>
                    <span className="block font-bold">{st === "learned" ? "✔ " : st === "locked" ? "🔒 " : ""}{n.name}</span>
                    <span className="block text-sm">{PERK_TEXT[n.perk].replace("{v}", String(n.value))}</span>
                    <span className="block text-sm opacity-70">{i > 0 ? "↳ " : ""}{n.cost} điểm</span>
                  </button>
                );
              })}
            </div>
          ))}
          {hasSkills && (
            <button type="button" className="pch-btn self-center text-base" disabled={busy} data-testid="skill-reset"
              onClick={() => { if (window.confirm(`Tẩy toàn bộ kỹ năng ${prof.name} với ${state.resetFee} xu?`)) void run(() => skillReset(token, tab), true); }}>
              ♻️ Tẩy điểm ({state.resetFee} xu)
            </button>
          )}
        </section>

        <section className="rounded-sm border border-ink/30 p-2 text-base">
          <h3 className="font-bold">⚡ Thể lực & buff</h3>
          <p>Giữ <kbd>Shift</kbd> để chạy (tốn 1 thể lực/giây). Câu cá 3, kéo lưới 5, đào mỏ 4, trận võ 8. Hồi đầy sau ~10 phút;
            nhanh gấp 3 khi nằm võng, ×1,2 khi “Ngủ ngon”; ngủ nhà nghỉ hồi đầy ngay.</p>
          <p className="mt-1">Món ăn ở Chợ Lớn cho buff: cơm tấm / bún bò 💪, phở / nước dừa / trà đá 🔋, bánh mì / nước mía / cà phê 💨,
            cá kho / canh chua / cá chiên / sinh tố 🍀.</p>
          {state.buffs.filter((b) => b.untilMs > nowMs).length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.buffs.filter((b) => b.untilMs > nowMs).map((b) => (
                <li key={b.key}>{BUFF_TEXT[b.key]?.icon} {BUFF_TEXT[b.key]?.name}: +{b.value}{BUFF_TEXT[b.key]?.unit} — còn {Math.ceil((b.untilMs - nowMs) / 60000)} phút</li>
              ))}
            </ul>
          )}
        </section>
        {msg && <p role="alert" className="text-red-700">{msg}</p>}
      </div>
    </ParchmentModal>
  );
}
