"use client";

// 0096 the forest's HUD: "🪓 Đốn cây" next to a tree of the rừng tràm (the 3D world's wild, or 0097's Rừng tràm map in
// 2D — a window of the same forest; the server checks I stand at the forest and the tree is on its grid), "🍳 Nấu ăn"
// for a Đầu bếp (the server refuses anyone else; a pan needed), and at the hunter's stall on Bãi đất trống the log /
// dish / tool counter (buy, repair). Every outcome is the server's; the chibi chops or stirs while a round runs
// (GameCanvas setWork, broadcast to the others). The felled trees (forest_state) go to the shared felled store, which
// hides them in 2D and 3D; it is polled every 5 s near the forest so a tree falls for everyone.
import { useCallback, useEffect, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import {
  COOK_STAMINA, COOKED_TOAST, DAILY_FULL_LOGS, DAILY_MAX_LOGS, DISH_BUFF_TEXT, FISH_NAME, LOG_NAME, QUALITY_NAME, RECIPES,
  RUNG_TRAM_ORIGIN, TOOLS, dishBuffMin, dishPrice, dishStamina, logPrice, recipeById, repairCost, toolById, treeById, treeKey,
  treeOf, type LogId, type Recipe,
} from "@/lib/game/forest/catalog";
import { npcCutNote, npcQuotaLine, type NpcQuota } from "@/lib/game/economy/npc";
import { nearestTree, type NearTree } from "@/lib/game/forest/near";
import {
  chopFinish, chopStart, cookEat, cookFinish, cookSell, cookStart, forestErrorText, forestState, toolBuy, toolRepair, woodSell,
  type ForestState, type StallSale,
} from "@/lib/game/forest/rpc";
import { liveSync } from "@/lib/game/mglive";
import { near, STALL, WILD_ITEMS, isWildItem } from "@/lib/game/realm/model";
import { addFelled, setFelled } from "@/lib/game/forest/felled-store";
import { nearForest } from "@/lib/game/world/forest-grid";
import { waterAt } from "@/lib/game/world/terrain";
import type { MapId } from "@/lib/game/maps/types";
import ChopGame, { type ChopView } from "./ChopGame";
import KeyBadge from "../KeyBadge";
import {
  bowBonus, CARPENTRY, CARPENTRY_STAMINA, COAL_BONUS, FOREST_ITEMS, forestItemById, panBonus, recipeLogValue, SELL_MAX, TRAP_LIMIT, TRAP_REACH,
  trapOdds, type CarpentryRecipe,
} from "@/lib/game/forest/catalog";
import { carpenterCraft, forestBuy, trapCheck, trapPlace, trapTake } from "@/lib/game/forest/rpc";
import { nearestTrap, setTraps } from "@/lib/game/forest/trap-store";
import ItemIcon from "../ItemIcon";
import FurnitureIcon from "../housing/FurnitureIcon";
import CookGame, { type CookView } from "./CookGame";

/** 0121: what a tool's tier does, for the stall's list. */
function toolPerk(t: { kind: string; power: number }): string {
  if (t.kind === "axe") return ` · sức chặt ${t.power}`;
  if (t.kind === "bow" && bowBonus(t.power) > 0) return ` · săn trúng +${bowBonus(t.power)}%`;
  if (t.kind === "pan" && panBonus(t.power) > 0) return ` · món +${panBonus(t.power)} điểm`;
  return "";
}

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
  const [panel, setPanel] = useState<"cook" | "stall" | "craft" | null>(null);
  /** 0123: where I stand in the forest (world px) and how the server knows me there (the map and its px). */
  const [here, setHere] = useState<{ wx: number; wy: number; map: string; x: number; y: number; wet: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  /** 0121: the last round left the tree standing — "Chặt tiếp" starts the next one on it. */
  const [canAgain, setCanAgain] = useState(false);
  /** Each round gets a fresh minigame (its presses and its clock start over): the overlay's key. */
  const [roundNo, setRoundNo] = useState(0);
  /** Econ v2: the thương lái's day after my last sale at the stall (null until I sell). */
  const [npc, setNpc] = useState<NpcQuota | null>(null);

  const [inForest, setInForest] = useState(false);
  const take = useCallback((s: ForestState) => {
    setState(s);
    setFelled(s.felled, s.serverNowMs);
    setTraps(s.traps, s.serverNowMs);                                        // 0123: the 2D map draws them
    canvas()?.setLiveInputs?.({ traps: s.traps.map((t) => ({ id: String(t.id), x: t.x, y: t.y, iron: t.item === "bay_sat",
      ready: trapOdds(t.item, (s.serverNowMs - t.sinceMs) / 60_000) >= 0.5 })) });   // 0123: and the 3D world
  }, [canvas]);
  const reload = useCallback(async () => {
    try { take(await forestState(token)); } catch { /* offline: keep the last */ }
  }, [token, take]);
  // every 5 s at the forest (a tree falls for everyone within seconds), else every 30 s
  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const id = setInterval(() => void reload(), inForest ? 5000 : 30000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [reload, inForest]);

  // where I stand, 4× a second: the tree in reach (in the wild, at the forest) and the stall
  useEffect(() => {
    const id = setInterval(() => {
      const c = canvas();
      // the forest's world px: the wild (3D) or Rừng tràm's window (2D, 0097)
      const l = mapId === "rung_tram" ? c?.localPos() ?? null : null;
      const w = c?.zone?.() === "wild" ? c.worldPos() : l ? { x: l.x + RUNG_TRAM_ORIGIN.x, y: l.y + RUNG_TRAM_ORIGIN.y } : null;
      const f = w !== null && nearForest(w.x, w.y);
      setInForest(f);
      setTree(f && w ? nearestTree(w.x, w.y) : null);
      const twoD = mapId === "rung_tram", pos = twoD ? l : w;
      setHere(f && w && pos ? { wx: w.x, wy: w.y, map: twoD ? "rung_tram" : "wild", x: pos.x, y: pos.y,
        wet: waterAt(w.x, w.y) !== null } : null);                              // no traps in the river through the forest
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
  // a sale at the stall (econ v2: through the thương lái — the toast says what it kept back)
  const sold = (r: StallSale | null) => {
    if (!r) return;
    take(r.forest);
    if (r.npc) setNpc(r.npc);
    const cut = npcCutNote(r.cut);
    toast(`💰 +${r.earned} xu${cut ? ` · ${cut}` : ""}`);
    onCoins();
  };

  const felled = (t: NearTree) => {
    const f = state?.felled.find((x) => x.tree === treeKey(t.cx, t.cy, t.k));
    return f && state ? Math.max(0, f.respawnMs - state.serverNowMs) : 0;             // as of the last poll
  };

  // again: from a finished round's "Chặt tiếp" (its overlay stays up until the next round starts)
  const startChop = async (again = false) => {
    const c = canvas(), twoD = mapId === "rung_tram";
    const w = twoD ? c?.localPos() : c?.worldPos();
    if (!tree || !w || busy || (gameOpen && !again)) return;
    const round = await run(() => chopStart(token, tree.cx, tree.cy, tree.k, twoD ? "rung_tram" : "wild", w.x, w.y));
    if (round) {
      setCanAgain(false);
      setRoundNo((n) => n + 1);
      setChop({ round, phase: "playing", message: "", live: liveSync(token, "chop") });
    }
  };
  /** Sell a whole stack: the stall takes at most SELL_MAX a call (more is refused as a bad quantity). */
  const sellAll = async (sell: (qty: number) => Promise<StallSale>, total: number): Promise<StallSale | null> => {
    let left = total, last: StallSale | null = null, earned = 0, cut = 0;
    while (left > 0) {
      const n = Math.min(SELL_MAX, left);
      const r = await sell(n);
      earned += r.earned; cut += r.cut; last = r; left -= n;
    }
    return last ? { ...last, earned, cut } : null;
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
        if (r.forest) take(r.forest);
        setCanAgain(r.result === "ok");
        if (r.result === "felled") addFelled(v.round.tree, Date.now() + (treeById(v.round.kind)?.respawnMin ?? 2) * 60_000);
        if (r.result === "lost") {
          message = r.why === "felled" ? "Có người đốn mất cây này rồi." : r.why === "late" ? "Mạng chập chờn — lượt này không được tính."
            : r.why === "not played" ? "Lượt này chưa chơi." : "Lượt này không được tính.";
        } else if (r.result === "felled") {
          const name = r.log ? LOG_NAME[r.log as LogId] ?? r.log : "gỗ";
          message = `🌲 Cây đổ! +${r.qty} ${name}${r.qty > r.full ? ` (${r.qty - r.full} khúc nửa giá — quá ${DAILY_FULL_LOGS} khúc/ngày)` : ""} · ${r.hits}/3 nhịp`;
        } else {
          message = `${r.hits}/3 nhịp → ${r.blows} nhát (${r.have}/${r.need})`;
        }
        if (r.durability === 0) message += "\n⚠️ Rìu đã mòn hết — sửa hoặc mua rìu mới ở Sạp thợ săn (Bãi đất trống).";
        else if (r.durability !== null && r.durability <= 5) message += `\n⚠️ Rìu còn ${r.durability} độ bền — nhớ ghé Sạp thợ săn sửa.`;
      } catch (e) {
        message = forestErrorText(e);
        setCanAgain(false);
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
      if (r.coal) toast(`🔥 Đốt 1 bao than củi — món này thêm ${COAL_BONUS} điểm.`);
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
        if (r.forest) take(r.forest);
        const rc = recipeById(v.recipe);
        message = r.result === "ok"
          ? `${rc ? COOKED_TOAST[rc.id] : ""}\n${QUALITY_NAME[r.quality]} (${r.score} điểm: ${r.steps.join(" · ")})`
          : r.why === "late" ? "Mạng chập chờn — món này không được tính." : "Món này không được tính.";
      } catch (e) {
        message = forestErrorText(e);
      }
      setCook((cur) => (cur ? { ...cur, phase: "done", message } : cur));
    })();
  };

  const chef = state?.main === "dau_bep";
  const carpenter = state?.main === "tho_moc";
  // 0123: traps — mine in reach, and the ones I can set
  const trapHere = here ? nearestTrap(here.wx, here.wy, TRAP_REACH) : null;
  const trapItems = FOREST_ITEMS.filter((i) => i.durability !== null && (state?.items[i.id] ?? 0) > 0);
  const placeTrap = (item: string) => {
    if (!here || busy) return;
    void run(() => trapPlace(token, item, here.map, here.x, here.y)).then((f) => {
      if (f) { take(f); toast(`🪤 Đã đặt ${forestItemById(item)?.name.toLowerCase() ?? "bẫy"} — lát quay lại thăm nha.`); }
    });
  };
  const checkTrap = () => {
    if (!here || !trapHere || busy) return;
    void run(() => trapCheck(token, trapHere.id, here.map, here.x, here.y)).then((r) => {
      if (!r) return;
      take(r.forest);
      if (r.result === "caught" && r.item) {
        toast(`🪤 Dính rồi! +${r.qty} ${isWildItem(r.item) ? WILD_ITEMS[r.item].name : r.item} (+${r.xp} XP)${r.broken ? " · bẫy đã hư" : ""}`);
      } else toast(r.why === "daily cap" ? "Hôm nay săn bẫy đủ rồi (40 con) — mai quay lại nghen." : `Bẫy còn trống (khả năng lúc này ${r.odds}%) — chờ thêm chút.`);
    });
  };
  const takeTrap = () => {
    if (!here || !trapHere || busy) return;
    void run(() => trapTake(token, trapHere.id, here.map, here.x, here.y)).then((r) => {
      if (r) { take(r.forest); toast(r.returned ? "Đã thu bẫy về túi." : "Đã gỡ bẫy (bẫy đã dùng nên bỏ luôn)."); }
    });
  };
  const craft = (r: CarpentryRecipe) => {
    if (busy) return;
    void run(() => carpenterCraft(token, r.id)).then((x) => {
      if (!x) return;
      take(x.forest);
      onCoins();
      toast(`🪚 Đóng xong ${r.name.toLowerCase()}${r.outQty > 1 ? ` ×${r.outQty}` : ""}${r.outKind === "furniture" ? " — đã cất vào kho đồ nội thất" : ""}.`);
    });
  };
  /** What a carpentry recipe needs, and whether I have it (half-price logs count). */
  const craftNeeds = (r: CarpentryRecipe): { text: string; ok: boolean } => {
    let ok = true;
    const parts = Object.entries(r.logs).map(([log, n]) => {
      const w = state?.wood.find((x) => x.item === log), have = (w?.qty ?? 0) + (w?.half ?? 0);
      ok &&= have >= (n ?? 0);
      return `${n} ${(LOG_NAME[log as LogId] ?? log).toLowerCase()} (có ${have})`;
    });
    if (r.fee > 0) parts.push(`${r.fee} xu công`);
    return { text: parts.join(" + "), ok };
  };
  /** What a dish needs, and whether I have it. */
  const needs = (r: Recipe): { text: string; ok: boolean } => {
    const parts: string[] = [];
    let ok = true;
    if (r.meat) {
      const have = state?.meat[r.meat] ?? 0;
      parts.push(`${r.meatQty} ${isWildItem(r.meat) ? WILD_ITEMS[r.meat].name.toLowerCase() : r.meat} (có ${have})`);
      ok &&= have >= r.meatQty;
    }
    if (r.fish) {
      const have = state?.fish[r.fish] ?? 0;
      parts.push(`${r.fishQty} ${(FISH_NAME[r.fish] ?? r.fish).toLowerCase()} (có ${have})`);
      ok &&= have >= r.fishQty;
    }
    parts.push(`${r.fee} xu đồ chợ`);
    return { text: parts.join(" + "), ok };
  };
  const pan = state?.tools.some((t) => toolById(t.item)?.kind === "pan" && t.durability > 0) ?? false;
  const axe = state?.tools.filter((t) => toolById(t.item)?.kind === "axe" && t.durability > 0)
    .sort((x, y) => (toolById(y.item)?.power ?? 0) - (toolById(x.item)?.power ?? 0))[0] ?? null;
  const waitMs = tree ? felled(tree) : 0;

  return (
    <>
      {!blocked && !gameOpen && (tree || chef || carpenter || atStall || trapHere || (here && !here.wet && trapItems.length > 0)) && (
        <div className="pch pointer-events-auto absolute bottom-48 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 px-2 py-1 font-vt text-base">
          {tree && (
            <button type="button" className="pch-btn relative px-2 py-0.5" disabled={busy || waitMs > 0 || !axe} onClick={() => void startChop()}
              data-hotkey="chop" title={axe ? `${toolById(axe.item)?.name} (${axe.durability}) (G)` : "Chưa có rìu"}>
              🪓 Đốn {treeOf(tree.cx, tree.cy, tree.k).name}{waitMs > 0 ? ` (mọc lại sau ${Math.ceil(waitMs / 60000)}′)` : ""}
              {axe && waitMs === 0 && <KeyBadge id="chop" />}
            </button>
          )}
          {tree && !axe && state && <span className="text-sm">Chưa có rìu — mua ở 🪵 Sạp thợ săn (Bãi đất trống)</span>}
          {chef && <button type="button" className="pch-btn px-2 py-0.5" onClick={() => setPanel("cook")}>🍳 Nấu ăn</button>}
          {carpenter && <button type="button" className="pch-btn px-2 py-0.5" onClick={() => setPanel("craft")}>🪚 Đóng đồ gỗ</button>}
          {trapHere && (
            <>
              <button type="button" className="pch-btn px-2 py-0.5" disabled={busy} onClick={checkTrap}
                title={`${forestItemById(trapHere.item)?.name} · bền ${trapHere.durability}/${trapHere.max}`}>
                🪤 Thăm bẫy ({Math.round(trapHere.odds * 100)}%)
              </button>
              <button type="button" className="pch-btn px-2 py-0.5" disabled={busy} onClick={takeTrap}>Thu bẫy</button>
            </>
          )}
          {!trapHere && here && !here.wet && trapItems.length > 0 && (state?.traps.length ?? 0) < TRAP_LIMIT && trapItems.map((i) => (
            <button key={i.id} type="button" className="pch-btn px-2 py-0.5" disabled={busy} onClick={() => placeTrap(i.id)}>
              🪤 Đặt {i.name.toLowerCase()} ({state?.items[i.id]})
            </button>
          ))}
          {atStall && <button type="button" className="pch-btn px-2 py-0.5" onClick={() => setPanel("stall")}>🪵 Gỗ · món · đồ nghề</button>}
        </div>
      )}

      {chop && <ChopGame key={roundNo} view={chop} onEnd={endChop} onClose={() => { setChop(null); setCanAgain(false); }}
        onAgain={canAgain && !busy && tree !== null && treeKey(tree.cx, tree.cy, tree.k) === chop.round.tree ? () => void startChop(true) : null} />}
      {cook && <CookGame view={cook} onEnd={endCook} onClose={() => { setCook(null); void reload(); }} />}

      {panel && state && (
        <div className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-black/30 font-vt" onClick={() => setPanel(null)}>
          <div className="pch max-h-[80vh] w-[min(92vw,380px)] overflow-y-auto p-3 text-base" onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="mb-2 flex items-center justify-between">
              <b>{panel === "cook" ? "🍳 Bếp của Đầu bếp" : panel === "craft" ? "🪚 Xưởng mộc" : "🪵 Sạp thợ săn — gỗ, món ăn, đồ nghề"}</b>
              <button type="button" className="pch-btn px-2" onClick={() => setPanel(null)} aria-label="Đóng">✕</button>
            </div>
            {panel === "craft" ? (
              <ul className="flex flex-col gap-1">
                <li className="text-sm opacity-80">Thợ mộc đóng đồ từ gỗ đốn được (gỗ nửa giá dùng trước). Mỗi món tốn {CARPENTRY_STAMINA} thể lực và 1 độ bền cưa; đồ nội thất vào kho nhà, rẻ hơn mua ở tiệm.</li>
                {CARPENTRY.map((r) => {
                  const n = craftNeeds(r);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        {r.outKind === "furniture" ? <FurnitureIcon item={r.outId} tiles={2} scale={1} /> : <ItemIcon id={r.outId} scale={2} />}
                        <span>{r.name}{r.outQty > 1 ? ` ×${r.outQty}` : ""}<br /><small>{n.text} · gỗ ≈ {recipeLogValue(r)} xu · {r.outKind === "furniture" ? "tiệm bán" : "giá"} {r.shopPrice} xu</small></span>
                      </span>
                      <button type="button" className="pch-btn px-2" disabled={busy || !n.ok} onClick={() => craft(r)}>Đóng</button>
                    </li>
                  );
                })}
              </ul>
            ) : panel === "cook" ? (
              <ul className="flex flex-col gap-1">
                {!pan && <li className="text-sm text-red-800">Cần có nồi hoặc chảo mới nấu được nghen! (mua ở Sạp thợ săn)</li>}
                <li className="flex items-center gap-1 text-sm opacity-80"><ItemIcon id="than_cui" scale={1.5} /> Than củi: {state.items.than_cui ?? 0} bao — mỗi món dùng 1 bao, món ngon thêm {COAL_BONUS} điểm (Thợ mộc đốt từ gỗ tre).</li>
                {RECIPES.map((r) => {
                  const n = needs(r);
                  return (
                    <li key={r.id} className="flex items-center justify-between gap-2">
                      <span>{r.name}<br /><small>{n.text} · {r.steps.length} bước · tốn {COOK_STAMINA} thể lực{dishStamina(r, 1) > 0 ? ` · ăn +${dishStamina(r, 1)} thể lực` : ""}{r.buff ? ` · ${DISH_BUFF_TEXT[r.buff](r.buffValue)} ${r.buffMin}′` : ""}</small></span>
                      <button type="button" className="pch-btn px-2" disabled={busy || !n.ok || !pan} onClick={() => void startCook(r.id)}>Nấu</button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex flex-col gap-2">
                <section>
                  {npc && <p className="text-sm opacity-80">{npcQuotaLine(npc)}</p>}
                  <b className="text-sm">Gỗ ({state.logsToday}/{DAILY_FULL_LOGS} khúc hôm nay giá đủ · tối đa {DAILY_MAX_LOGS} khúc/ngày)</b>
                  {state.wood.length === 0 ? <p className="text-sm">Chưa có gỗ.</p> : state.wood.map((w) => (
                    <div key={w.item} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1"><ItemIcon id={w.item} scale={1.5} />{LOG_NAME[w.item as LogId] ?? w.item}: {w.qty}{w.half > 0 ? ` + ${w.half} nửa giá` : ""} · {logPrice(w.item)} xu</span>
                      <button type="button" className="pch-btn px-2" disabled={busy} onClick={() => void run(() => sellAll((n) => woodSell(token, w.item, n), w.qty + w.half)).then(sold)}>Bán hết</button>
                    </div>
                  ))}
                </section>
                {Object.values(state.meat).some((n) => n > 0) && (
                  <p className="text-sm opacity-80">🍖 Thịt, lông, da… bán ở tab 🏹 Săn bắt (phím 6) của sạp này.</p>
                )}
                <section>
                  <b className="text-sm">Món ăn</b>
                  {state.dishes.length === 0 ? <p className="text-sm">Chưa có món.</p> : state.dishes.map((d) => {
                    const r = recipeById(d.dish);
                    return (
                      <div key={`${d.dish}${d.quality}`} className="flex items-center justify-between gap-1 text-sm">
                        <span className="flex items-center gap-1"><ItemIcon id={d.dish} scale={1.5} />{r?.name ?? d.dish} ({QUALITY_NAME[d.quality]}) ×{d.qty}</span>
                        <span className="flex gap-1">
                          <button type="button" className="pch-btn px-1" disabled={busy} onClick={() => void run(() => cookEat(token, d.dish, d.quality)).then((x) => { if (x) { take(x.forest); toast(`😋 +${x.gained} thể lực${r?.buff && d.quality > 0 ? ` · ${DISH_BUFF_TEXT[r.buff](r.buffValue)} ${dishBuffMin(r, d.quality)}′` : ""}`); } })}>Ăn</button>
                          <button type="button" className="pch-btn px-1" disabled={busy || !r} onClick={() => void run(() => cookSell(token, d.dish, d.quality, 1)).then(sold)}>Bán {r ? dishPrice(r, d.quality) : ""}</button>
                          {d.qty > 1 && <button type="button" className="pch-btn px-1" disabled={busy || !r} onClick={() => void run(() => sellAll((n) => cookSell(token, d.dish, d.quality, n), d.qty)).then(sold)}>Bán hết</button>}
                        </span>
                      </div>
                    );
                  })}
                </section>
                <section>
                  <b className="text-sm">Bẫy (đặt trong rừng tràm, tối đa {TRAP_LIMIT} cái)</b>
                  {FOREST_ITEMS.filter((i) => i.sold).map((i) => (
                    <div key={i.id} className="flex items-center justify-between gap-1 text-sm">
                      <span className="flex items-center gap-1"><ItemIcon id={i.id} scale={1.5} />{i.name} · bắt được {i.durability} lần · có {state.items[i.id] ?? 0}</span>
                      <span className="flex gap-1">
                        <button type="button" className="pch-btn px-1" disabled={busy} onClick={() => void run(() => forestBuy(token, i.id, 1)).then((f) => { if (f) { take(f); onCoins(); toast(`${i.name} ✓`); } })}>{i.price} xu</button>
                        <button type="button" className="pch-btn px-1" disabled={busy} onClick={() => void run(() => forestBuy(token, i.id, 5)).then((f) => { if (f) { take(f); onCoins(); toast(`${i.name} ×5 ✓`); } })}>×5</button>
                      </span>
                    </div>
                  ))}
                </section>
                <section>
                  <b className="text-sm">Đồ nghề: rìu, cung, nồi chảo (Độ bền)</b>
                  {TOOLS.filter((t) => (t.kind === "axe" || t.kind === "bow" || t.kind === "pan") && t.price > 0).map((t) => {
                    const mine = state.tools.find((x) => x.item === t.id);
                    const worn = mine && mine.durability < mine.max;
                    return (
                      <div key={t.id} className="flex items-center justify-between gap-1 text-sm">
                        <span className="flex items-center gap-1"><ItemIcon id={t.id} scale={1.5} /> {t.name}{toolPerk(t)} · bền {mine ? `${mine.durability}/${mine.max}` : t.durability}{mine ? " ✓" : ""}</span>
                        <span className="flex gap-1">
                          {worn && mine && <button type="button" className="pch-btn px-1" disabled={busy} onClick={() => void run(() => toolRepair(token, t.id)).then((x) => { if (x) { take(x.forest); onCoins(); toast(`🔧 Sửa xong rồi, xài tiếp thôi! (−${x.cost} xu)`); } })}>Sửa {repairCost(t, mine.durability, mine.max)}</button>}
                          <button type="button" className="pch-btn px-1" disabled={busy} onClick={() => void run(() => toolBuy(token, t.id)).then((f) => { if (f) { take(f); onCoins(); toast(`${t.name} ✓`); } })}>{t.price} xu</button>
                        </span>
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
