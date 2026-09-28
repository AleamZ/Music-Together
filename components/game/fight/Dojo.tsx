"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ParchmentModal } from "../Parchment";
import { beltOf, examFor, martialByKey, uniformStyle, unlockSlotOf, type MartialStyle } from "@/lib/game/fight/dojo";
import { enrollmentOf, waitText, type Gate } from "@/lib/game/fight/dojo-gates";
import { kataChart, type KataChart } from "@/lib/game/fight/kata";
import type { MatchParams } from "@/lib/game/fight/engine";
import { fightErrorMessage } from "@/lib/game/fight/messages";
import { STYLE_SPECIALS } from "@/lib/game/fight/moves";
import type { ServerClock } from "@/lib/game/fight/referee";
import {
  dojoEnroll, dojoExamStart, dojoKataSubmit, fightState, fightUnwearUniform, fightWearUniform, type DojoState, type KataResult,
  type MatchResult,
} from "@/lib/game/fight/rpc";
import { formatXu } from "@/lib/game/fishing/catalog";
import type { Look } from "@/lib/game/types";
import DojoPanel from "./DojoPanel";
import ExamFight from "./ExamFight";
import FightOverlay from "./FightOverlay";
import KataOverlay from "./KataOverlay";

type View =
  | { kind: "panel" }
  | { kind: "confirm"; style: MartialStyle; target: number }
  | { kind: "kata"; style: MartialStyle; examId: string; chart: KataChart; passPct: number }
  | { kind: "scoring"; style: MartialStyle }
  | { kind: "kataResult"; style: MartialStyle; res: KataResult }
  | { kind: "fight"; style: MartialStyle; match: { id: string; params: MatchParams; startedAtMs: number }; resume: number[] | null }
  | { kind: "result"; style: MartialStyle; result: MatchResult }
  | { kind: "practice"; style: MartialStyle };

interface DojoHook {
  state: DojoState | null;
  apply: (s: DojoState, sentAt?: number, receivedAt?: number) => void;
  reload: () => Promise<DojoState | null>;
  clock: ServerClock;
  error: unknown;
}

/** v20.2 the Võ đường (spec §v20.2 "UI flows"): the panel, then an exam — the confirm, the kata, its result, the
 *  sparring match against the master, the result card with the belt — and practice as a style. */
export default function Dojo({ token, look, name, coins, dojo, onLook, onCoins, onVitals, onToast, onClose }: {
  token: string;
  look: Look;
  name: string;
  coins: number | null;
  dojo: DojoHook;
  onLook: (look: Look) => void;
  onCoins: () => void;
  onVitals: () => void;
  onToast: (text: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>({ kind: "panel" });
  const [tab, setTab] = useState<number>(() => uniformStyle(look.outfit)?.id ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => dojo.clock.now(Date.now()));
  const { state, apply, reload, clock } = dojo;

  // the countdowns on the panel and the kata result tick once a second
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(clock.now(Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [clock]);

  const fail = useCallback((e: unknown) => {
    setError(fightErrorMessage(e));
    setBusy(false);
  }, []);

  const enroll = useCallback((key: string) => {
    setBusy(true);
    setError(null);
    dojoEnroll(token, key).then(({ value, sentAt, receivedAt }) => {
      apply(value, sentAt, receivedAt);
      onCoins();
      onToast(`Nhập môn ${martialByKey(key)?.name ?? ""}! Nhận võ phục 🥋`);
      setBusy(false);
    }, fail);
  }, [token, apply, onCoins, onToast, fail]);

  const wear = useCallback((key: string) => {
    setBusy(true);
    setError(null);
    fightWearUniform(token, key).then(({ value }) => {
      // v20.3: the chibi's belt shows my rank in that style (0051's characters.belt keeps it for the others)
      onLook({ ...look, outfit: value.outfit, belt: enrollmentOf(state, key)?.rank ?? null });
      void reload();
      setBusy(false);
    }, fail);
  }, [token, look, state, onLook, reload, fail]);

  const unwear = useCallback(() => {
    setBusy(true);
    setError(null);
    fightUnwearUniform(token).then(({ value }) => {
      onLook({ ...look, outfit: value.outfit, belt: null });
      void reload();
      setBusy(false);
    }, fail);
  }, [token, look, onLook, reload, fail]);

  const startFight = useCallback((style: MartialStyle, match: NonNullable<KataResult["match"]>, resume: number[] | null) => {
    setView({ kind: "fight", style, match, resume });
  }, []);

  const exam = useCallback((key: string, gate: Gate) => {
    const style = martialByKey(key);
    const e = enrollmentOf(state, key);
    if (!style || !e) return;
    setError(null);
    if (gate.resume === "spar" && state?.exam?.match) {
      const m = state.exam.match;
      setBusy(true);
      fightState(token, m.id).then(({ value, sentAt, receivedAt }) => {
        clock.sample(value.serverNowMs, sentAt, receivedAt);
        setBusy(false);
        if (value.status !== "live" && value.result) { setView({ kind: "result", style, result: value.result }); return; }
        startFight(style, { id: m.id, params: m.params, startedAtMs: m.startedAtMs }, value.runs);
      }, fail);
      return;
    }
    if (gate.resume === "kata" && state?.exam) {
      setView({ kind: "kata", style, examId: state.exam.id, chart: kataChart(state.exam.kataSeed, state.exam.targetRank), passPct: examFor(state.exam.targetRank)?.passPct ?? 60 });
      return;
    }
    setView({ kind: "confirm", style, target: e.rank + 1 });
  }, [state, token, clock, fail, startFight]);

  const beginExam = useCallback((style: MartialStyle) => {
    setBusy(true);
    setError(null);
    dojoExamStart(token, style.key).then(({ value, sentAt, receivedAt }) => {
      clock.sample(value.serverNowMs, sentAt, receivedAt);
      if (value.state) apply(value.state, sentAt, receivedAt);
      onCoins();
      const target = (enrollmentOf(value.state, style.key)?.rank ?? 0) + 1;
      setBusy(false);
      setView({ kind: "kata", style, examId: value.examId, chart: kataChart(value.kataSeed, target), passPct: value.passPct });
    }, (e: unknown) => {
      fail(e);
      setView({ kind: "panel" });
    });
  }, [token, clock, apply, onCoins, fail]);

  const submitKata = useCallback((style: MartialStyle, examId: string, presses: number[]) => {
    setView({ kind: "scoring", style });
    dojoKataSubmit(token, examId, presses).then(({ value, sentAt, receivedAt }) => {
      clock.sample(value.serverNowMs, sentAt, receivedAt);
      if (value.state) apply(value.state, sentAt, receivedAt);
      if (value.anticheat) onToast("Bài thi không hợp lệ — hệ thống đã ghi nhận.");
      setView({ kind: "kataResult", style, res: value });
    }, (e: unknown) => {
      fail(e);
      setView({ kind: "panel" });
    });
  }, [token, clock, apply, onToast, fail]);

  const fightDone = useCallback((style: MartialStyle, result: MatchResult) => {
    setView({ kind: "result", style, result });
    onVitals();
    void reload();
    // v20.3: a new belt shows on the chibi at once (the others see it at my next look refresh)
    if (result.exam?.passed && look.outfit === style.uniform) onLook({ ...look, belt: result.exam.rank });
  }, [onVitals, reload, look, onLook]);

  // the kata result: frame 0 of the sparring match comes 8 s after the pass; enter 3 s before it
  const pending = view.kind === "kataResult" && view.res.passed && view.res.match ? view : null;
  useEffect(() => {
    if (!pending || !pending.res.match) return;
    const left = pending.res.match.startedAtMs - clock.now(Date.now()) - 3000;
    const id = window.setTimeout(() => startFight(pending.style, pending.res.match!, null), Math.max(0, left));
    return () => window.clearTimeout(id);
  }, [pending, clock, startFight]);

  const myRank = useMemo(() => (view.kind === "fight" ? enrollmentOf(state, view.style.key)?.rank ?? 0 : 0), [view, state]);

  if (view.kind === "practice") {
    const e = enrollmentOf(state, view.style.key);
    return (
      <FightOverlay
        look={look} name={name} onClose={() => setView({ kind: "panel" })} arena="dojo"
        fighter={{ style: view.style.id, rank: e?.rank ?? 0 }} styleName={`${view.style.name} · ${beltOf(view.style.id, e?.rank ?? 0).name}`}
        title={`🥋 Luyện tập · ${view.style.name}`}
      />
    );
  }
  if (view.kind === "kata") {
    const v = view;
    return <KataOverlay style={v.style} chart={v.chart} passPct={v.passPct} onDone={(p) => submitKata(v.style, v.examId, p)} />;
  }
  if (view.kind === "fight") {
    const v = view;
    return (
      <ExamFight
        token={token} match={v.match} resume={v.resume} clock={clock} look={look} name={name} master={v.style} myRank={myRank}
        onResult={(r) => fightDone(v.style, r)} onFlag={() => onToast("Trận thi không hợp lệ — hệ thống đã ghi nhận.")}
      />
    );
  }
  if (view.kind === "confirm") {
    const v = view;
    const x = examFor(v.target)!;
    return (
      <ParchmentModal title={`Thi lên ${beltOf(v.style.id, v.target).name}`} onClose={() => setView({ kind: "panel" })} className="sm:max-w-md">
        <div className="flex flex-col gap-2 font-vt text-lg leading-tight">
          <p>Phí thi <b>{formatXu(x.fee)}</b> — <b>không hoàn phí</b> nếu trượt.</p>
          <p>1. Bài quyền <b>{v.style.kata}</b>: {x.notes} nhịp, cần đạt {x.passPct}%.</p>
          <p>2. Đấu 3 hiệp với {v.style.master} (máy cấp {x.botLevel}) — phải thắng.</p>
          <p className="text-base opacity-80">Mỗi hiệp tốn 2 no và 3 khát. Trượt thì nghỉ {waitText(x.cooldownMin * 60_000)} mới thi lại.</p>
          {error && <p className="text-burgundy" role="alert">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="pch-btn" onClick={() => setView({ kind: "panel" })}>Hủy</button>
            <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => beginExam(v.style)}>Bắt đầu thi</button>
          </div>
        </div>
      </ParchmentModal>
    );
  }
  if (view.kind === "scoring") {
    return (
      <ParchmentModal title="Bài quyền" className="sm:max-w-sm">
        <p className="font-vt text-xl" role="status">Thầy đang chấm bài quyền…</p>
      </ParchmentModal>
    );
  }
  if (view.kind === "kataResult") {
    const v = view;
    const r = v.res;
    const pct = r.score && r.max > 0 ? Math.trunc((r.score[0] * 100) / r.max) : 0;
    const left = r.match ? Math.max(0, Math.ceil((r.match.startedAtMs - nowMs) / 1000)) : 0;
    return (
      <ParchmentModal title={`Bài quyền ${v.style.kata}`} onClose={r.passed ? undefined : () => setView({ kind: "panel" })} className="sm:max-w-md">
        <div className="flex flex-col gap-2 font-vt text-lg leading-tight" data-testid="kata-result">
          <p className="text-3xl text-burgundy">{r.passed ? "✅ Đạt!" : "❌ Chưa đạt"}</p>
          {r.score && <p>Điểm: {pct}% (cần {r.passPct}%) · Hoàn hảo {r.score[1]} · Tốt {r.score[2]} · Trượt {r.score[3]}</p>}
          {!r.passed && r.cooldownUntilMs !== null && <p>Thi lại sau {waitText(r.cooldownUntilMs - nowMs)}.</p>}
          {r.passed && r.match && <p>Vào sàn tập với {v.style.master} sau {left} giây…</p>}
          <div className="flex justify-end gap-2">
            {r.passed && r.match
              ? <button type="button" className="pch-btn pch-btn-primary" onClick={() => startFight(v.style, r.match!, null)}>Vào sàn tập với thầy</button>
              : <button type="button" className="pch-btn" onClick={() => setView({ kind: "panel" })}>Về võ đường</button>}
          </div>
        </div>
      </ParchmentModal>
    );
  }
  if (view.kind === "result") {
    const v = view;
    const r = v.result;
    const passed = r.exam?.passed === true;
    const rank = r.exam?.rank ?? 0;
    const opened = passed ? STYLE_SPECIALS[v.style.id]?.find((s) => s.slot === unlockSlotOf(rank)) : null;
    return (
      <ParchmentModal title="Kết quả thi đai" onClose={() => setView({ kind: "panel" })} className="sm:max-w-md">
        <div className="flex flex-col gap-2 font-vt text-lg leading-tight" data-testid="exam-result">
          <p className="text-3xl text-burgundy">{passed ? `🥋 Lên ${beltOf(v.style.id, rank).name}!` : r.winner === 0 ? "🤝 Hòa — chưa đạt" : "😵 Thua thầy rồi"}</p>
          {passed && (
            <p className="flex items-center gap-2">
              <span className="inline-block h-3 w-16 border border-ink motion-safe:animate-pulse" style={{ background: beltOf(v.style.id, rank).color }} aria-hidden />
              {opened && <>Mở chiêu: <b>{opened.name}</b></>}
            </p>
          )}
          {!passed && r.exam?.cooldownUntilMs != null && <p>Thi lại sau {waitText(r.exam.cooldownUntilMs - nowMs)}.</p>}
          <p className="text-base">
            Các hiệp: {r.rounds.map((x) => (x.winner === 1 ? "thắng" : x.winner === 2 ? "thua" : "hòa")).join(" · ") || "—"}
            {r.endReason === "forfeit" ? " (đầu hàng)" : r.endReason === "abandon" ? " (bỏ trận)" : ""}
          </p>
          <p className="text-base opacity-80">Tốn {r.vitals.hunger} no · {r.vitals.thirst} khát.</p>
          <div className="flex justify-end gap-2">
            <button type="button" className="pch-btn" onClick={() => { unwear(); setView({ kind: "panel" }); }}>Cởi võ phục</button>
            <button type="button" className="pch-btn pch-btn-primary" onClick={() => setView({ kind: "panel" })}>Về võ đường</button>
          </div>
        </div>
      </ParchmentModal>
    );
  }
  return (
    <DojoPanel
      state={state}
      error={error ?? (dojo.error ? fightErrorMessage(dojo.error) : null)}
      coins={coins}
      tab={tab}
      nowMs={nowMs}
      busy={busy}
      onTab={setTab}
      onEnroll={enroll}
      onWear={wear}
      onUnwear={unwear}
      onPractice={(key) => { const s = martialByKey(key); if (s) setView({ kind: "practice", style: s }); }}
      onExam={exam}
      onClose={onClose}
    />
  );
}
