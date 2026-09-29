"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isTyping } from "@/lib/game/keys";
import { GATE_GUARD_MS, liveSync, liveTick, useLive, type LiveSync } from "@/lib/game/mglive";
import { isPetSpecies } from "@/lib/game/pets/catalog";
import { PRESS, pressPos } from "@/lib/game/pets/minigames";
import type { PetLook } from "@/lib/game/pets/model";
import { battlePressOpen, errText, skillOf, type Battle, type Fighter, type LogLine } from "@/lib/game/pets/v2";
import ItemIcon from "../ItemIcon";
import { PET_ANIM_CSS, PetCanvas, useReducedMotion } from "./petArt";

// v22 pets (0085): the turn's animation (lunge, hit flash, knockback, the HP bar's tween, crit / miss text, the faint)
// replayed from the server's log, and the power press — a meter the server rolls when it opens (battle_press_open);
// its sweet spot shows through mg_sync('press') at a secret tick (0087); the press tick goes to battle_act_press, which
// replays it and scales my hits this turn by 85–115 %.

const lookOf = (f: Fighter | null): PetLook | null =>
  f && f.kind !== "fish" && isPetSpecies(f.species) ? { species: f.species, variant: f.variant, head: null, neck: null, body: null, happy: true, form: f.form } : null;

type Step = { who: 1 | 2; line: LogLine } | null;
const STEP_MS = 700;

/** The two fighters and the last turn played out. `hp` of each side is the server's after the turn. */
export function BattleStage({ b }: { b: Battle }) {
  const reduced = useReducedMotion();
  const key = `${b.id}:${b.turn}:${b.status}`;
  const [shown, setShown] = useState<{ key: string; hp: [number, number]; step: Step; i: number }>(() => ({ key, hp: [b.hp1, b.hp2], step: null, i: -1 }));
  const latest = useRef(b);
  useEffect(() => { latest.current = b; });
  // the HP shown when the last animation ended (the next turn starts from it), and which turn that was
  const lastHp = useRef<{ id: number; hp: [number, number]; key: string }>({ id: b.id, hp: [b.hp1, b.hp2], key });

  useEffect(() => {
    const cur = latest.current;
    if (lastHp.current.key === key) return;
    const from: [number, number] = lastHp.current.id === cur.id ? lastHp.current.hp : [cur.hp1, cur.hp2];
    const end = () => { lastHp.current = { id: cur.id, hp: [cur.hp1, cur.hp2], key }; setShown({ key, hp: [cur.hp1, cur.hp2], step: null, i: cur.log.length }); };
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (reduced || cur.log.length === 0) {
      timers.push(setTimeout(end, 0));
    } else {
      const hp: [number, number] = [...from];
      timers.push(setTimeout(() => setShown({ key, hp: [...from], step: null, i: -1 }), 0));
      cur.log.forEach((l, i) => {
        timers.push(setTimeout(() => {
          const foe = 3 - l.who;
          if (l.dmg) hp[foe - 1] = Math.max(0, hp[foe - 1] - l.dmg);
          if (l.heal) hp[l.who - 1] = hp[l.who - 1] + l.heal;
          setShown({ key, hp: [...hp], step: { who: l.who, line: l }, i });
        }, 60 + i * STEP_MS));
      });
      timers.push(setTimeout(end, 60 + cur.log.length * STEP_MS + 200));
    }
    return () => timers.forEach(clearTimeout);
  }, [key, reduced]);

  const mine = b.side, theirs = (3 - b.side) as 1 | 2;
  const f = (s: 1 | 2) => (s === 1 ? b.f1 : b.f2);
  const step = shown.step;
  const box = (s: 1 | 2, left: boolean) => {
    const fi = f(s);
    const hp = shown.hp[s - 1], max = Math.max(1, fi?.hp ?? 1);
    const attacking = step?.who === s && !step.line.guard && !step.line.heal && !step.line.fail;
    const hit = step && step.who !== s && (step.line.dmg ?? 0) > 0;
    const fainted = hp <= 0 && shown.step === null;
    const lunge = attacking ? (left ? 26 : -26) : hit ? (left ? -8 : 8) : 0;
    return (
      <div className="relative flex flex-col items-center gap-1" data-testid={`fighter-${s}`}>
        <div className="relative h-28 w-28">
          <div className="absolute inset-0 flex items-end justify-center transition-transform duration-200 ease-out"
            style={{ transform: `translateX(${lunge}px)`, animation: fainted ? "pmg-faint 0.7s ease-in forwards" : hit ? "pmg-flash 0.35s linear" : undefined }}>
            {fi?.kind === "fish" ? <ItemIcon id={fi.species} scale={6} /> : <PetCanvas look={lookOf(fi)} scale={4} flip={!left} />}
          </div>
          {step?.who === s && step.line.guard && <span className="absolute left-1/2 top-2 -translate-x-1/2 text-3xl" aria-hidden="true">🛡️</span>}
          {step && (step.line.heal ?? 0) > 0 && step.who === s && (
            <span key={`h${shown.i}`} className="absolute left-1/2 top-0 -translate-x-1/2 text-2xl font-bold text-emerald-600 motion-safe:animate-[pmg-float_0.7s_ease-out_forwards]">+{step.line.heal}</span>
          )}
          {hit && (
            <span key={`d${shown.i}`} className={`absolute left-1/2 top-0 -translate-x-1/2 whitespace-nowrap font-bold motion-safe:animate-[pmg-float_0.7s_ease-out_forwards] ${step.line.crit ? "text-3xl text-amber-500 [text-shadow:1px_1px_0_#7a2a1f]" : "text-2xl text-rose-600"}`}>
              −{step.line.dmg}{step.line.crit ? " CHÍ MẠNG!" : ""}
            </span>
          )}
          {step && step.who !== s && step.line.miss && (
            <span key={`m${shown.i}`} className="absolute left-1/2 top-2 -translate-x-1/2 text-xl font-bold text-slate-600 motion-safe:animate-[pmg-float_0.7s_ease-out_forwards]">Trượt!</span>
          )}
        </div>
        <span className="font-bold text-burgundy">{fi?.name} · Lv{fi?.level}</span>
        <span className="flex items-center gap-1 text-base">
          <span className="inline-block h-2.5 w-28 overflow-hidden rounded-sm border border-gold-300 bg-parchment align-middle">
            <span className={`block h-full transition-[width] duration-500 ease-out ${hp / max > 0.35 ? "bg-emerald-500" : "bg-rose-500"}`}
              style={{ width: `${Math.max(0, Math.min(100, (hp / max) * 100))}%` }} />
          </span>
          {hp}/{fi?.hp}
        </span>
      </div>
    );
  };
  const skill = step ? skillOf(step.line.skill)?.name ?? step.line.skill : null;
  return (
    <div className="flex flex-col items-center gap-1">
      <style>{PET_ANIM_CSS}</style>
      <div className="flex items-end justify-around gap-2 self-stretch rounded bg-gradient-to-b from-sky-100 to-lime-100 py-2">
        {box(mine, true)}
        <span className="text-2xl" aria-hidden="true">⚔️</span>
        {box(theirs, false)}
      </div>
      <p className="min-h-6 text-base" aria-live="polite">
        {step && skill ? <>{f(step.who)?.name} dùng <b>{skill}</b>{step.line.power && step.line.power !== 1000 ? ` (lực ${Math.round(step.line.power / 10)}%)` : ""}</> : " "}
      </p>
    </div>
  );
}

/** The power press for a chosen skill: a marker sweeps the bar; press when it sits on the gold mark (it shows a moment
 *  after the meter starts). Space / E / a tap; no press within 5 s is a weak (85 %) hit. `onPress(press tick | null,
 *  ticks)` is called once. */
export function PowerPress({ token, battle, skill, onPress, onCancel }: {
  token: string; battle: number; skill: string; onPress: (press: number | null, ticks: number) => void; onCancel: () => void;
}) {
  const [period, setPeriod] = useState<number | null>(null);
  const [sync, setSync] = useState<LiveSync | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const want = useRef(false);
  const over = useRef(false);
  const cb = useRef(onPress);
  useEffect(() => { cb.current = onPress; });
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    battlePressOpen(token, battle).then((r) => { setPeriod(r.period); setSync(() => liveSync(token, "press")); }, (e) => setErr(errText(e)));
  }, [token, battle]);
  const live = useLive(sync, () => [null, null]);
  const liveRef = useRef(live);
  useEffect(() => { liveRef.current = live; });
  const fire = useCallback((p: number | null, t: number) => {
    if (over.current) return;
    over.current = true;
    liveRef.current.stop();
    cb.current(p, t);
  }, []);
  useEffect(() => {
    if (!live.ready || period === null) return;
    const t0 = live.t0;
    let t = 0;
    let raf = requestAnimationFrame(function loop(now: number) {
      const due = Math.min(liveTick(t0, now), PRESS.maxTicks);
      const seenAt = liveRef.current.at.current?.[1];
      const canPress = seenAt !== undefined && now - seenAt >= GATE_GUARD_MS;
      while (t < due) {
        if (want.current) {
          want.current = false;
          if (canPress) { setTick(t); fire(t, t + 1); return; }
        }
        t++;
      }
      setTick(t);
      if (t >= PRESS.maxTicks) { fire(null, PRESS.maxTicks); return; }
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, [live.ready, live.t0, period, fire]);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      if (e.code === "Space" || e.key === "e" || e.key === "E") { e.preventDefault(); if (!e.repeat) want.current = true; }
      else if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onCancel]);
  if (err) return <p role="alert" className="text-burgundy">{err}</p>;
  if (period === null || !live.ready) return <p role="status">Chuẩn bị…</p>;
  const centre = live.events[1]?.centre;
  const pos = pressPos(period, tick) / 10;
  const band = (w: number) => (centre === undefined ? { display: "none" }
    : { left: `${Math.max(0, centre - w) / 10}%`, width: `${(Math.min(1000, centre + w) - Math.max(0, centre - w)) / 10}%` });
  return (
    <div className="flex w-full max-w-md flex-col items-center gap-1" role="group" aria-label="Lực đánh">
      <p className="text-base">Dồn lực cho <b>{skill}</b>: nhấn Space (hoặc chạm) khi vạch vào ô vàng!</p>
      <div className="relative h-8 w-full touch-none select-none overflow-hidden rounded border-2 border-[#3a2418] bg-[#5b4a3a]"
        onPointerDown={() => { want.current = true; }}>
        <div className="absolute inset-y-0 bg-amber-200/40" style={band(200)} />
        <div className="absolute inset-y-0 bg-amber-300/70" style={band(90)} />
        <div className="absolute inset-y-0 bg-[#f2c93a]" style={band(25)} />
        <div className="absolute inset-y-0 w-1 -translate-x-1/2 bg-white shadow-[0_0_0_1px_#3a2418]" style={{ left: `${pos}%` }} />
      </div>
      <p className="text-sm opacity-80">Còn {Math.max(0, Math.ceil((PRESS.maxTicks - tick) / 60))}s · lực 85–115%</p>
    </div>
  );
}
