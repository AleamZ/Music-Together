"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { setLocalEmote } from "@/lib/game/diorama/character/emote";
import { ParchmentModal } from "@/components/game/Parchment";
import type { FarmController, FarmSession } from "@/hooks/useFarmController";
import { AnticheatError } from "@/lib/anticheat";
import { serverNow } from "@/lib/game/farm/clock";
import { harvestablePlots, waterPlans } from "@/lib/game/farm/machines";
import { BED_WATER_NAME, WATER_NAME } from "@/lib/game/farm/messages";
import { formatXu } from "@/lib/game/fishing/catalog";
import { clockText, MACHINES, type ExtrasState, type MachineId } from "@/lib/game/fishing/extras";
import {
  buyMachine, extrasErrorMessage, fetchExtras, machineHarvest, machineWater, processStart, sellGoods,
} from "@/lib/game/fishing/extras-rpc";
import { lostText, sortFinish, sortStart } from "@/lib/game/craftmg/rpc";
import { liveSync, type LiveSync } from "@/lib/game/mglive";
import SortGame from "@/components/game/craftmg/SortGame";
import { CraftFrame } from "@/components/game/craftmg/shared";

/** v22 (0084): the sort minigame at collecting, and the sprinkler's install / refill splash. */
interface SortView { key: number; live: LiveSync; phase: "playing" | "sending" | "done"; message: string | null; good: boolean | null }
const SPLASH_CSS = `
.mp-splash { position: relative; }
.mp-splash::after { content: ""; position: absolute; inset: -4px; border: 3px dashed #4aa3c8; border-radius: 6px;
  animation: mp-splash 700ms steps(4) 1 both; pointer-events: none; }
.mp-drop { display: inline-block; animation: mp-drop 600ms steps(4) 3; }
@keyframes mp-splash { from { opacity: 1; transform: scale(.9) } to { opacity: 0; transform: scale(1.12) } }
@keyframes mp-drop { from { transform: translateY(-6px); opacity: .3 } to { transform: translateY(4px); opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .mp-splash::after, .mp-drop { animation: none !important; } }
`;

const AUTO_KEY = "mt.sprinklerAuto";
/** The auto sprinkler looks at my plots this often, and touches one plot at most once in this long (watering allows 6 an hour). */
const AUTO_EVERY_MS = 20_000;
const AUTO_GAP_MS = 10 * 60_000;

export function readAuto(): boolean {
  try { return localStorage.getItem(AUTO_KEY) !== "0"; } catch { return true; }
}
function writeAuto(on: boolean): void {
  try { localStorage.setItem(AUTO_KEY, on ? "1" : "0"); } catch { /* this visit only */ }
}

/** v21 (0076) Máy tưới, tự động: while I am on the field with a sprinkler and the switch on, a plot of mine whose water is
 *  off what its crop wants is set right (one plot at most every 10 min; the server applies watering's caps). Renders
 *  nothing. */
export function SprinklerAuto({ farm, session, me }: { farm: FarmController; session: FarmSession; me: string }) {
  const [owned, setOwned] = useState(false);
  const touched = useRef(new Map<number, number>());
  const live = useRef({ farm, toast: session.toast });
  useEffect(() => {
    live.current = { farm, toast: session.toast };
  });
  const { token, roomId } = session;
  useEffect(() => {
    fetchExtras(token).then((s) => setOwned(s.machines.includes("sprinkler"))).catch(() => {});
  }, [token]);
  useEffect(() => {
    if (!owned) return;
    const tick = () => {
      if (!readAuto()) return;
      const f = live.current.farm, state = f.data.state, catalog = f.data.catalog;
      if (!state || !catalog) return;
      const now = serverNow();
      const due = waterPlans(state, catalog, me, now).find((p) => p.target !== null && now - (touched.current.get(p.plot) ?? -Infinity) > AUTO_GAP_MS);
      if (!due || due.target === null) return;
      touched.current.set(due.plot, now);
      machineWater(roomId, token, due.plot, due.target).then(() => {
        const names = due.kind === "upland" ? BED_WATER_NAME : WATER_NAME;
        live.current.toast(`💦 Máy tưới: thửa ${due.plot} → ${names[due.target ?? 0]}`);
        void f.data.reload();
      }).catch(() => {});
    };
    const t = setInterval(tick, AUTO_EVERY_MS);
    return () => clearInterval(t);
  }, [owned, me, roomId, token]);
  return null;
}

/** v21 (0076) 🔧 Kho máy · anh Hai: buy the machines; Máy tưới sets a plot's water, Máy gặt riêng harvests a ripe paddy for
 *  free, Máy chế biến turns dry rice and hoa màu into goods worth more (a timed batch, then sold here or at Chợ Lớn). */
export default function MachinePanel({ farm, session, me, onClose }: { farm: FarmController; session: FarmSession; me: string; onClose: () => void }) {
  const { token, roomId, toast, onCoinsChanged } = session;
  const [x, setX] = useState<ExtrasState | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(readAuto);
  const [now, setNow] = useState(() => serverNow());
  const [sort, setSort] = useState<SortView | null>(null);
  // wave 3: my 3D chibi sorts the grain on a nia while the sorting mini-game is open
  const sorting = sort !== null;
  useEffect(() => { if (!sorting) return; setLocalEmote("sort"); return () => setLocalEmote(null); }, [sorting]);
  const [splash, setSplash] = useState<string | null>(null);
  const splashAt = useCallback((key: string) => {
    setSplash(key);
    window.setTimeout(() => setSplash((k) => (k === key ? null : k)), 1800);
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    fetchExtras(token).then(setX).catch(() => {});
  }, [token]);
  const run = useCallback(async (job: () => Promise<ExtrasState | void>, done?: string) => {
    setBusy(true);
    try {
      const r = await job();
      if (r) setX(r);
      if (done) toast(done);
      onCoinsChanged();
      void farm.data.reload();
    } catch (err) {
      if (!(err instanceof AnticheatError && err.info.strike >= 1)) toast(extrasErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [toast, onCoinsChanged, farm.data]);

  const startSort = useCallback(() => void run(async () => {
    const r = await sortStart(token);
    setSort({ key: Date.now(), live: liveSync(token, "sort"), phase: "playing", message: null, good: null });
    return r.state;
  }), [run, token]);
  const endSort = useCallback((ticks: readonly number[], dirs: readonly number[], score: number) => {
    setSort((v) => (v ? { ...v, phase: "sending" } : v));
    void (async () => {
      try {
        const r = await sortFinish(token, ticks, dirs, score);
        setX(r.state);
        const a = r.answer;
        const message = a.result === "collected"
          ? `${a.score >= 8 ? "Phân loại chuẩn rồi!" : "Nhìn kỹ nguyên liệu nhé!"} Đúng ${a.score}/12 — đã lấy hàng ra${a.bonus > 0 ? `, thưởng +${a.pct}% (${formatXu(a.bonus)})` : ""}.`
          : lostText(a.why, "Hết giờ — hàng vẫn nằm trong máy.");
        setSort((v) => (v ? { ...v, phase: "done", message, good: a.result === "collected" && a.score >= 8 } : v));
        onCoinsChanged();
      } catch (err) {
        if (!(err instanceof AnticheatError && err.info.strike >= 1)) toast(extrasErrorMessage(err));
        setSort(null);
      }
    })();
  }, [token, toast, onCoinsChanged]);

  const has = (m: MachineId) => x?.machines.includes(m) ?? false;
  const state = farm.data.state, catalog = farm.data.catalog;
  const plans = state && catalog ? waterPlans(state, catalog, me, now) : [];
  const ripe = state ? harvestablePlots(state, me) : [];
  const stock = (kind: "rice" | "upland", id: string) => kind === "rice"
    ? state?.mine.rice[id]?.dry ?? 0
    : state?.mine.produce[id] ?? 0;

  return (
    <ParchmentModal title="🔧 Kho máy nông nghiệp · anh Hai" onClose={onClose} className="sm:max-w-3xl">
      <div className="flex flex-col gap-3 font-vt text-lg leading-tight">
        {!x ? <p>Đang tải…</p> : (
          <>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {MACHINES.map((m) => (
                <li key={m.id} className="pch flex flex-col gap-1 p-2">
                  <span className="text-xl text-burgundy">{m.name}</span>
                  <span className="text-base">{m.blurb}</span>
                  {has(m.id)
                    ? <button type="button" className="pch-btn" disabled>Đã có</button>
                    : <button type="button" className="pch-btn pch-btn-primary" disabled={busy || x.coins < m.price} onClick={() => { if (m.id === "sprinkler") splashAt("buy"); void run(() => buyMachine(token, m.id), `Đã mua ${m.name}!`); }}>
                      {x.coins < m.price ? `Thiếu xu · ${formatXu(m.price)}` : `Mua · ${formatXu(m.price)}`}
                    </button>}
                </li>
              ))}
            </ul>

            {has("sprinkler") && (
              <section className="flex flex-col gap-1">
                <h3 className={`text-xl text-burgundy ${splash === "buy" ? "mp-splash" : ""}`}>💦 Máy tưới{splash !== null && <span className="mp-drop" aria-hidden="true"> 💧</span>}</h3>
                <label className="flex items-center gap-2 text-base">
                  <input type="checkbox" checked={auto} onChange={(e) => { setAuto(e.target.checked); writeAuto(e.target.checked); }} />
                  Tự động tưới khi tôi ở ngoài đồng
                </label>
                {plans.length === 0 ? <p className="text-base opacity-80">Bạn chưa có thửa nào đang trồng.</p> : (
                  <ul className="flex flex-col gap-1">
                    {plans.map((p) => {
                      const names = p.kind === "upland" ? BED_WATER_NAME : WATER_NAME;
                      return (
                        <li key={p.plot} className={`flex flex-wrap items-center gap-2 ${splash === `plot${p.plot}` ? "mp-splash" : ""}`}>
                          <span className="flex-1">Thửa {p.plot}: {names[p.level]}{p.want ? ` · cần ${p.want.map((l) => names[l]).join("/")}` : ""}</span>
                          {p.target !== null
                            ? <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => { splashAt(`plot${p.plot}`); void run(() => machineWater(roomId, token, p.plot, p.target ?? 0), `Thửa ${p.plot}: ${names[p.target ?? 0]}`); }}>Tưới → {names[p.target]}</button>
                            : <span className="text-base opacity-80">Vừa đủ</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {has("harvester") && (
              <section className="flex flex-col gap-1">
                <h3 className="text-xl text-burgundy">🌾 Máy gặt riêng</h3>
                {ripe.length === 0 ? <p className="text-base opacity-80">Chưa có thửa lúa nào chín.</p> : (
                  <div className="flex flex-wrap gap-2">
                    {ripe.map((n) => (
                      <button key={n} type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void run(() => machineHarvest(roomId, token, n), `Máy gặt đang chạy trên thửa ${n}…`)}>
                        Gặt thửa {n}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            {has("processor") && (
              <section className="flex flex-col gap-1">
                <h3 className="text-xl text-burgundy">🏭 Máy chế biến</h3>
                {x.job ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex-1">Đang làm {x.job.batches} mẻ {x.recipes.find((r) => r.id === x.job?.recipe)?.name ?? x.job.recipe}</span>
                    {now < x.job.readyAt ? <span>⏳ {clockText(x.job.readyAt - now)}</span>
                      : <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={startSort}>Lấy hàng (phân loại)</button>}
                  </div>
                ) : (
                  <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    {x.recipes.map((r) => {
                      const have = stock(r.inputKind, r.inputId);
                      const n = Math.min(5, Math.floor(have / r.inputKg));
                      return (
                        <li key={r.id} className="pch flex flex-col gap-1 p-2 text-base">
                          <span className="text-lg">{r.name} · {formatXu(r.value)}/mẻ</span>
                          <span>{r.inputKg} kg {r.inputKind === "rice" ? "lúa khô" : ""} {catalog?.varieties.find((v) => v.id === r.inputId)?.name ?? catalog?.uplands.find((u) => u.id === r.inputId)?.name ?? r.inputId} · {r.minutes} phút/mẻ · có {have} kg</span>
                          <button type="button" className="pch-btn pch-btn-primary self-start" disabled={busy || n < 1} onClick={() => void run(() => processStart(token, r.id, n), `Máy đang chạy ${n} mẻ.`)}>
                            {n < 1 ? "Chưa đủ nông sản" : `Chạy ${n} mẻ`}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {Object.keys(x.goods).length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {Object.entries(x.goods).map(([id, q]) => {
                      const r = x.recipes.find((y) => y.id === id);
                      return (
                        <li key={id} className="flex flex-wrap items-center gap-2">
                          <span className="flex-1">{r?.name ?? id} × {q}</span>
                          <button type="button" className="pch-btn pch-btn-primary" disabled={busy} onClick={() => void run(() => sellGoods(token, id, q), `Đã bán ${q} ${r?.name ?? id}.`)}>
                            Bán · {formatXu((r?.value ?? 0) * q)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </div>
      {sort && (
        <CraftFrame title="🏭 Phân loại mẻ hàng" label="Phân loại" phase={sort.phase} message={sort.message} good={sort.good} onClose={() => setSort(null)}>
          <SortGame key={sort.key} live={sort.live} onEnd={endSort} />
        </CraftFrame>
      )}
      <style>{SPLASH_CSS}</style>
    </ParchmentModal>
  );
}
