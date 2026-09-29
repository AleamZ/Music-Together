"use client";

// 0096 the forest's HUD: "🪓 Đốn cây" next to a tree of the rừng tràm (the 3D world; the server checks I stand at the
// forest and the tree is on its grid), "🍳 Nấu ăn" for a Đầu bếp (the server refuses anyone else), and at the hunter's
// stall on Bãi đất trống the log / dish / axe counter. Every outcome is the server's; the chibi chops or stirs while a
// round runs (GameCanvas setWork).
import { useCallback, useEffect, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import {
  DAILY_FULL_LOGS, LOG_NAME, QUALITY_NAME, RECIPES, TOOLS, dishPrice, logPrice, recipeById, toolById, treeKey, treeOf,
  type LogId,
} from "@/lib/game/forest/catalog";
import { nearestTree, type NearTree } from "@/lib/game/forest/near";
import {
  chopFinish, chopStart, cookEat, cookFinish, cookSell, cookStart, forestErrorText, forestState, toolBuy, woodSell,
  type ForestState,
} from "@/lib/game/forest/rpc";
import { liveSync } from "@/lib/game/mglive";
import { near, STALL } from "@/lib/game/realm/model";
import { nearForest } from "@/lib/game/world/forest-grid";
import type { MapId } from "@/lib/game/maps/types";
import ChopGame, { type ChopView } from "./ChopGame";
import CookGame, { type CookView } from "./CookGame";

export default function ForestHud(props: {
  token: string;
  mapId: MapId;
  canvas: () => GameCanvasHandle | null;
  blocked: boolean;
  toast: (text: string) => void;
  onCoins: () => void;
  /** A panel or a minigame holds the input. */
  onPanel: (open: boolean) => void;
}) {
  const { token, mapId, canvas, blocked, toast, onCoins, onPanel } = props;
  const [state, setState] = useState<ForestState | null>(null);
  const [tree, setTree] = useState<NearTree | null>(null);
  const [atStall, setAtStall] = useState(false);
  const [chop, setChop] = useState<ChopView | null>(null);
  const [cook, setCook] = useState<CookView | null>(null);
  const [panel, setPanel] = useState<"cook" | "stall" | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try { setState(await forestState(token)); } catch { /* offline: keep the last */ }
  }, [token]);
  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const id = setInterval(() => void reload(), 15000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [reload]);

  // where I stand, 4× a second: the tree in reach (in the wild, at the forest) and the stall
  useEffect(() => {
    const id = setInterval(() => {
      const c = canvas();
      const w = c?.zone?.() === "wild" ? c.worldPos() : null;
      setTree(w && nearForest(w.x, w.y) ? nearestTree(w.x, w.y) : null);
      setAtStall(near(mapId, c?.localPos() ?? null, STALL, 56));
    }, 250);
    return () => clearInterval(id);
  }, [canvas, mapId]);

  const gameOpen = chop !== null || cook !== null;
  useEffect(() => { onPanel(gameOpen || panel !== null); }, [gameOpen, panel, onPanel]);
  useEffect(() => { canvas()?.setWork?.(chop?.phase === "playing" ? "chop" : cook?.phase === "playing" ? "cook" : null); }, [chop, cook, canvas]);
  useEffect(() => () => canvas()?.setWork?.(null), [canvas]);

  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setBusy(true);
    try { return await fn(); } catch (e) { toast(forestErrorText(e)); return null; } finally { setBusy(false); }
  };

  const felled = (t: NearTree) => {
    const f = state?.felled.find((x) => x.tree === treeKey(t.cx, t.cy, t.k));
    return f && state ? Math.max(0, f.respawnMs - state.serverNowMs) : 0;             // as of the last poll
  };

  const startChop = async () => {
    const c = canvas(), w = c?.worldPos();
    if (!tree || !w || busy || gameOpen) return;
    const round = await run(() => chopStart(token, tree.cx, tree.cy, tree.k, "wild", w.x, w.y));
    if (round) setChop({ round, phase: "playing", message: "", live: liveSync(token, "chop") });
  };
  const endChop = (presses: number[] | null) => {
    const v = chop;
    if (!v || v.phase !== "playing") return;
    if (presses === null) { setChop(null); return; }
    setChop({ ...v, phase: "sending" });
    void (async () => {
      let message: string;
      try {
        const r = await chopFinish(token, presses);
        if (r.forest) setState(r.forest);
        if (r.result === "lost") {
          message = r.why === "felled" ? "Có người đốn mất cây này rồi." : r.why === "late" ? "Mạng chập chờn — lượt này không được tính."
            : r.why === "not played" ? "Lượt này chưa chơi." : "Lượt này không được tính.";
        } else if (r.result === "felled") {
          const name = r.log ? LOG_NAME[r.log as LogId] ?? r.log : "gỗ";
          message = `🌲 Cây đổ! +${r.qty} ${name}${r.qty > r.full ? ` (${r.qty - r.full} khúc nửa giá — quá ${DAILY_FULL_LOGS} khúc/ngày)` : ""} · ${r.hits}/3 nhịp`;
        } else {
          message = `${r.hits}/3 nhịp → ${r.blows} nhát (${r.have}/${r.need})`;
        }
        if (r.durability === 0) message += "\n⚠️ Rìu đã mòn hết — mua rìu mới ở Sạp thợ săn.";
      } catch (e) {
        message = forestErrorText(e);
      }
      setChop((cur) => (cur ? { ...cur, phase: "done", message } : cur));
    })();
  };

  const startCook = async (recipe: string) => {
    if (busy || gameOpen) return;
    const r = await run(() => cookStart(token, recipe));
    if (r) {
      setPanel(null);
      onCoins();
      setCook({ recipe: r.recipe, steps: r.steps, phase: "playing", message: "", live: liveSync(token, "cook") });
    }
  };
  const endCook = (a: number[] | null, b: number[]) => {
    const v = cook;
    if (!v || v.phase !== "playing") return;
    if (a === null) { setCook({ ...v, phase: "done", message: "Bỏ dở — nguyên liệu đã dùng mất." }); return; }
    setCook({ ...v, phase: "sending" });
    void (async () => {
      let message: string;
      try {
        const r = await cookFinish(token, a, b);
        if (r.forest) setState(r.forest);
        message = r.result === "ok"
          ? `${QUALITY_NAME[r.quality]} (${r.score} điểm: ${r.steps.join(" · ")}) — ${recipeById(v.recipe)?.name}`
          : r.why === "late" ? "Mạng chập chờn — món này không được tính." : "Món này không được tính.";
      } catch (e) {
        message = forestErrorText(e);
      }
      setCook((cur) => (cur ? { ...cur, phase: "done", message } : cur));
    })();
  };

  const chef = state?.main === "dau_bep";
  const axe = state?.tools.filter((t) => toolById(t.item)?.kind === "axe" && t.durability > 0)
    .sort((x, y) => (toolById(y.item)?.power ?? 0) - (toolById(x.item)?.power ?? 0))[0] ?? null;
  const waitMs = tree ? felled(tree) : 0;

  return (
    <>
      {!blocked && !gameOpen && (tree || chef || atStall) && (
        <div className="pch pointer-events-auto absolute bottom-48 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 px-2 py-1 font-vt text-base">
          {tree && (
            <button type="button" className="pch-btn px-2 py-0.5" disabled={busy || waitMs > 0 || !axe} onClick={() => void startChop()}
              title={axe ? `${toolById(axe.item)?.name} (${axe.durability})` : "Chưa có rìu"}>
              🪓 Đốn {treeOf(tree.cx, tree.cy, tree.k).name}{waitMs > 0 ? ` (mọc lại sau ${Math.ceil(waitMs / 60000)}′)` : ""}
            </button>
          )}
          {chef && <button type="button" className="pch-btn px-2 py-0.5" onClick={() => setPanel("cook")}>🍳 Nấu ăn</button>}
          {atStall && <button type="button" className="pch-btn px-2 py-0.5" onClick={() => setPanel("stall")}>🪵 Gỗ · món · rìu</button>}
        </div>
      )}

      {chop && <ChopGame view={chop} onEnd={endChop} onClose={() => setChop(null)} />}
      {cook && <CookGame view={cook} onEnd={endCook} onClose={() => { setCook(null); void reload(); }} />}

      {panel && state && (
        <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-black/30 font-vt" onClick={() => setPanel(null)}>
          <div className="pch max-h-[80vh] w-[min(92vw,380px)] overflow-y-auto p-3 text-base" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="mb-2 flex items-center justify-between">
              <b>{panel === "cook" ? "🍳 Bếp của Đầu bếp" : "🪵 Sạp thợ săn — gỗ, món ăn, rìu"}</b>
              <button type="button" className="pch-btn px-2" onClick={() => setPanel(null)} aria-label="Đóng">✕</button>
            </div>
            {panel === "cook" ? (
              <ul className="flex flex-col gap-1">
                {RECIPES.map((r) => {
                  const have = r.meat ? state.meat[r.meat] ?? 0 : Infinity;
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span>{r.name}<br /><small>{r.meat ? `1 thịt thỏ (có ${have}) + ` : ""}{r.fee} xu · {r.steps.length} bước · {r.stamina} thể lực</small></span>
                      <button type="button" className="pch-btn px-2" disabled={busy || have < r.meatQty} onClick={() => void startCook(r.id)}>Nấu</button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col gap-2">
                <section>
                  <b className="text-sm">Gỗ ({state.logsToday}/{DAILY_FULL_LOGS} khúc hôm nay giá đủ)</b>
                  {state.wood.length === 0 ? <p className="text-sm">Chưa có gỗ.</p> : state.wood.map((w) => (
                    <div key={w.item} className="flex items-center justify-between text-sm">
                      <span>{LOG_NAME[w.item as LogId] ?? w.item}: {w.qty}{w.half > 0 ? ` + ${w.half} nửa giá` : ""} · {logPrice(w.item)} xu</span>
                      <button type="button" className="pch-btn px-2" disabled={busy} onClick={() => void run(() => woodSell(token, w.item, w.qty + w.half)).then((r) => { if (r) { setState(r.forest); toast(`💰 +${r.earned} xu`); onCoins(); } })}>Bán hết</button>
                    </div>
                  ))}
                </section>
                <section>
                  <b className="text-sm">Món ăn</b>
                  {state.dishes.length === 0 ? <p className="text-sm">Chưa có món.</p> : state.dishes.map((d) => {
                    const r = recipeById(d.dish);
                    return (
                      <div key={`${d.dish}${d.quality}`} className="flex items-center justify-between gap-1 text-sm">
                        <span>{r?.name ?? d.dish} ({QUALITY_NAME[d.quality]}) ×{d.qty}</span>
                        <span className="flex gap-1">
                          <button type="button" className="pch-btn px-1" disabled={busy} onClick={() => void run(() => cookEat(token, d.dish, d.quality)).then((x) => { if (x) { setState(x.forest); toast(`😋 +${x.gained} thể lực`); } })}>Ăn</button>
                          <button type="button" className="pch-btn px-1" disabled={busy || !r} onClick={() => void run(() => cookSell(token, d.dish, d.quality, 1)).then((x) => { if (x) { setState(x.forest); toast(`💰 +${x.earned} xu`); onCoins(); } })}>Bán {r ? dishPrice(r, d.quality) : ""}</button>
                        </span>
                      </div>
                    );
                  })}
                </section>
                <section>
                  <b className="text-sm">Rìu</b>
                  {TOOLS.filter((t) => t.kind === "axe" && t.price > 0).map((t) => {
                    const mine = state.tools.find((x) => x.item === t.id);
                    return (
                      <div key={t.id} className="flex items-center justify-between text-sm">
                        <span>{t.name} · sức chặt {t.power} · bền {mine ? `${mine.durability}/` : ""}{t.durability}</span>
                        <button type="button" className="pch-btn px-2" disabled={busy} onClick={() => void run(() => toolBuy(token, t.id)).then((f) => { if (f) { setState(f); onCoins(); toast(`🪓 ${t.name}`); } })}>{t.price} xu</button>
                      </div>
                    );
                  })}
                </section>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
