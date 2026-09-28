"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnticheatError } from "@/lib/anticheat";
import { craftItem } from "@/lib/game/mining/catalog";
import {
  brewPotion, buyPickaxe, drinkPotion, gatherHerb, mineErrorMessage, mineFinish, mineStart, mineState, sellOre, upgradeItem,
  type DigResult, type MineDig, type MineState,
} from "@/lib/game/mining/rpc";
import { mineView } from "@/lib/game/maps/mo-da-art";
import type { Interactable, MapId } from "@/lib/game/maps/types";
import { rarityInfo } from "@/lib/game/rarity";

// Mỏ đá's controller (v21 #19, #26, #89): the mine state (polled while on the map), the dig, the herb patches, and the
// panels of chú Tám, the anvil, bà Sáu's cauldron and the potion bag. The server decides everything; this only shows it.

export type MinePanel = "shop" | "anvil" | "cauldron" | "bag";
export interface MineDigView { dig: MineDig; phase: "playing" | "sending" | "done"; message: string | null }

export interface UseMining {
  state: MineState | null;
  panel: MinePanel | null;
  dig: MineDigView | null;
  /** A panel or a dig holds the screen. */
  open: boolean;
  busy: boolean;
  interact: (it: Interactable) => boolean;
  promptText: (it: Interactable) => string | null;
  openPanel: (p: MinePanel | null) => void;
  finishDig: (strikes: readonly number[], ticks: number, pass: boolean) => void;
  closeDig: () => void;
  sell: (item: string, qty: number) => void;
  buy: (tool: string) => void;
  brew: (recipe: string, qty: number) => void;
  drink: (potion: string) => void;
  upgrade: (item: string) => void;
  /** The last upgrade's outcome line (the anvil panel shows it). */
  lastUpgrade: string | null;
  /** Client ms minus server ms at the last answer. */
  clockOffset: number;
}

const itemName = (id: string): string => craftItem(id)?.name ?? id;

function digText(o: DigResult): string {
  if (o.result === "mined") {
    const it = craftItem(o.item);
    const extra = [o.perfect ? "đào chuẩn +1" : null, o.buff ? "thuốc thợ mỏ +1" : null].filter(Boolean).join(", ");
    return `⛏️ Được ${o.qty} ${it?.name ?? o.item} (${rarityInfo(it?.rarity).label})${extra ? ` — ${extra}` : ""} · +${o.xp} XP`
      + (o.toolBroke ? " · Cuốc đã gãy!" : "");
  }
  const why = { expired: "Hết giờ.", refused: "Lượt đào không hợp lệ.", gave_up: "Bỏ dở — không được gì.", taken: "Có người đào mất rồi!" }[o.why];
  return why + (o.toolBroke ? " Cuốc đã gãy!" : "");
}

export function useMining({ token, roomId, mapId, toast, onCoins, onVitals }: {
  token: string;
  roomId: string;
  mapId: MapId;
  toast: (text: string) => void;
  onCoins: () => void;
  onVitals: () => void;
}): UseMining {
  const [state, setState] = useState<MineState | null>(null);
  const [panel, setPanel] = useState<MinePanel | null>(null);
  const [dig, setDig] = useState<MineDigView | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastUpgrade, setLastUpgrade] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const live = useRef({ toast, onCoins, onVitals });
  useEffect(() => {
    live.current = { toast, onCoins, onVitals };
  });

  const apply = useCallback((s: MineState) => {
    const offset = Date.now() - s.serverNow;
    setClockOffset(offset);
    setState(s);
    if (s.nodes.length > 0) {
      mineView.nodes = new Map(s.nodes.map((n) => [n.no, { item: n.item, readyAtMs: n.readyAt + offset }]));
    }
  }, []);

  const fail = useCallback((err: unknown) => {
    if (!(err instanceof AnticheatError && err.info.strike >= 1)) live.current.toast(mineErrorMessage(err));
  }, []);

  const reload = useCallback(async () => {
    try {
      apply(await mineState(roomId, token));
    } catch {
      // the mine's tables are not there yet (before 0072) or the network dropped: try on the next poll
    }
  }, [apply, roomId, token]);

  // the state once (the bag's chip anywhere), then while on the mine (nodes grow back): on arrival and every 15 s
  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0);
    if (mapId !== "mo_da") return () => window.clearTimeout(first);
    const id = window.setInterval(() => void reload(), 15000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [mapId, reload]);

  const run = useCallback(async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  }, [fail]);

  const interact = useCallback((it: Interactable): boolean => {
    switch (it.kind) {
      case "mine_node": {
        const node = it.spot ?? 0;
        const n = state?.nodes.find((x) => x.no === node);
        if (n && n.readyAt + clockOffset > Date.now()) {
          live.current.toast(`Mỏ này đang mọc lại — còn ${Math.ceil((n.readyAt + clockOffset - Date.now()) / 1000)} giây.`);
          return true;
        }
        void run(async () => {
          const r = await mineStart(roomId, token, node);
          apply(r.state);
          setDig({ dig: r.dig, phase: "playing", message: null });
        });
        return true;
      }
      case "herb_node":
        void run(async () => {
          const r = await gatherHerb(roomId, token, it.spot ?? 0);
          apply(r.state);
          live.current.toast(`🌿 Hái được ${r.qty} ${itemName(r.item)}.`);
          live.current.onVitals();
        });
        return true;
      case "mine_shop":
        setPanel("shop");
        void reload();
        return true;
      case "anvil":
        setLastUpgrade(null);
        setPanel("anvil");
        void reload();
        return true;
      case "cauldron":
        setPanel("cauldron");
        void reload();
        return true;
      default:
        return false;
    }
  }, [apply, clockOffset, reload, roomId, run, state, token]);

  const promptText = useCallback((it: Interactable): string | null => {
    if (it.kind !== "mine_node" && it.kind !== "herb_node") return null;
    const n = state?.nodes.find((x) => x.no === it.spot);
    if (!n) return null;
    if (n.readyAt + clockOffset > Date.now()) return "Đang mọc lại…";
    const c = craftItem(n.item);
    return `${it.kind === "mine_node" ? "Đào" : "Hái"} ${c?.name ?? n.item} (${rarityInfo(c?.rarity).label})`;
  }, [clockOffset, state]);

  const finishDig = useCallback((strikes: readonly number[], ticks: number, pass: boolean) => {
    setDig((d) => (d ? { ...d, phase: "sending" } : d));
    void (async () => {
      try {
        const r = await mineFinish(roomId, token, strikes, Math.max(1, ticks), pass);
        apply(r.state);
        setDig((d) => (d ? { ...d, phase: "done", message: digText(r.outcome) } : d));
        live.current.onVitals();
      } catch (err) {
        fail(err);
        setDig(null);
      }
    })();
  }, [apply, fail, roomId, token]);

  const closeDig = useCallback(() => setDig(null), []);

  const sell = useCallback((item: string, qty: number) => void run(async () => {
    const r = await sellOre(token, item, qty);
    apply(r.state);
    live.current.toast(`💰 Bán ${qty} ${itemName(item)}: +${r.xu} xu`);
    live.current.onCoins();
  }), [apply, run, token]);

  const buy = useCallback((tool: string) => void run(async () => {
    apply(await buyPickaxe(token, tool));
    live.current.toast("⛏️ Đã mua cuốc chim.");
    live.current.onCoins();
  }), [apply, run, token]);

  const brew = useCallback((recipe: string, qty: number) => void run(async () => {
    apply(await brewPotion(token, recipe, qty));
    live.current.toast(`🧪 Nấu xong ${qty} ${itemName(recipe)}.`);
    live.current.onCoins();
  }), [apply, run, token]);

  const drink = useCallback((potion: string) => void run(async () => {
    const r = await drinkPotion(token, potion);
    apply(r.state);
    live.current.toast(`🧪 Đã uống ${itemName(potion)}.`);
    live.current.onVitals();
  }), [apply, run, token]);

  const upgrade = useCallback((item: string) => void run(async () => {
    const r = await upgradeItem(token, item);
    apply(r.state);
    setLastUpgrade(r.upgrade.ok ? `✨ Thành công! Lên +${r.upgrade.level}.` : `💥 Thất bại (tỉ lệ ${r.upgrade.chance / 10}%) — mất nguyên liệu.`);
    live.current.onCoins();
  }), [apply, run, token]);

  const openPanel = useCallback((p: MinePanel | null) => {
    setPanel(p);
    if (p) void reload();
  }, [reload]);

  return {
    state, panel, dig, open: panel !== null || dig !== null, busy, interact, promptText, openPanel, finishDig, closeDig,
    sell, buy, brew, drink, upgrade, lastUpgrade, clockOffset,
  };
}
