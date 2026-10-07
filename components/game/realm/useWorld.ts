"use client";

// v21 "world" (0075): the world HUD's state — one world_state poll (every 4 s, and on each map change), the extra sprites
// handed to the canvas (animals, bosses, the gate, the stall), the party dots for the minimap and the actions. Every
// outcome comes back from the server.
import { useCallback, useEffect, useRef, useState } from "react";
import { npcCutNote, type NpcQuota } from "@/lib/game/economy/npc";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { drawAnimal, drawBoss, drawBossBar, drawGate, drawStall } from "@/lib/game/realm/art";
import { GATE, STALL, bossRewardNote, speciesOf, wildXY, type WildAction, type WildItemId } from "@/lib/game/realm/model";
import { setPartyDots } from "@/lib/game/realm/party-dots";
import {
  bossSummon, comboFinish, comboStart, dungeonJoin, dungeonStart, partyAccept, partyCreate, partyDecline, partyInvite,
  partyKick, partyLeave, partySay, snowStart, snowStop, wildFinish, wildSell, wildStart, worldErrorText, worldState,
  type BossFight, type WildAnimal, type WorldState,
} from "@/lib/game/realm/rpc";
import { noLine, okLine } from "@/lib/game/realm/mg-copy";
import { liveSync } from "@/lib/game/mglive";
import { isFelled } from "@/lib/game/forest/felled-store";
import { SELL_MAX, treeOf } from "@/lib/game/forest/catalog";
import { drawStump, drawTram, rungTramTrees } from "@/lib/game/forest/trees2d";
import type { WildView } from "./WildGame";
import type { ComboView } from "./ComboGame";
import { WILD_ITEMS } from "@/lib/game/realm/model";
import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";

export interface WorldOpts {
  token: string;
  roomId: string;
  accountId: string;
  mapId: MapId;
  canvas: () => GameCanvasHandle | null;
  toast: (text: string) => void;
  onCoins: () => void;
  onWeather: () => void;
}

export interface Hit { dmg: number; combo: number; at: number }

/** Where an animal is at server time `nowMs`. */
export function animalAt(a: WildAnimal, nowMs: number): Vec {
  const sp = speciesOf(a.species);
  return wildXY(a.hx, a.hy, a.seed, sp?.radius ?? 40, (nowMs - a.bornMs) / 1000);
}

export const bossSpot = (f: BossFight): Vec => ({ x: f.arena.x + f.arena.w / 2, y: f.arena.y + f.arena.h / 2 + 24 });

export function useWorld(o: WorldOpts) {
  const { token, roomId, accountId, mapId: zoneMap, canvas, toast, onCoins, onWeather } = o;
  // 0096: the wild animals live in the rừng tràm only — out in the 3D world ("wild", world px) the realm is the wild's
  const [inWild, setInWild] = useState(false);
  const mapId: MapId | "wild" = inWild ? "wild" : zoneMap;
  const [state, setState] = useState<WorldState | null>(null);
  const [offset, setOffset] = useState(0);
  const [here, setHere] = useState<{ now: number; pos: Vec | null }>({ now: 0, pos: null });   // pos: the realm map's px
  const [busy, setBusy] = useState(false);
  const [lastHit, setLastHit] = useState<Hit | null>(null);
  const stateRef = useRef<WorldState | null>(null);
  const offsetRef = useRef(0);
  const hurtRef = useRef(-Infinity);
  /** v22: the damage numbers floating over the boss (performance ms). */
  const floatsRef = useRef<Array<{ dmg: number; at: number }>>([]);
  const [wild, setWild] = useState<WildView | null>(null);
  const [combo, setCombo] = useState<ComboView | null>(null);
  /** Econ v2: the thương lái's day after my last sale at the stall (null until I sell). */
  const [npc, setNpc] = useState<NpcQuota | null>(null);

  const reload = useCallback(async () => {
    try {
      const s = await worldState(token, roomId, mapId);
      stateRef.current = s;
      offsetRef.current = s.serverNowMs - Date.now();
      setState(s);
      setOffset(s.serverNowMs - Date.now());
      canvas()?.setLiveInputs?.({ realm: { state: s, zone: mapId, offsetMs: s.serverNowMs - Date.now() } });   // P4: the 3D world
    } catch { /* offline or locked: keep the last state */ }
  }, [token, roomId, mapId, canvas]);
  useEffect(() => () => canvas()?.setLiveInputs?.({ realm: null }), [canvas]);

  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const id = setInterval(() => void reload(), 4000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [reload]);

  // where I stand, 4× a second (for the action bar and the arena check)
  useEffect(() => {
    const id = setInterval(() => {
      const c = canvas(), wild = c?.zone?.() === "wild";                                  // 0096: world px in the wild
      setInWild(wild);
      setHere({ now: Date.now(), pos: (wild ? c?.worldPos() : c?.localPos()) ?? null });
    }, 250);
    return () => clearInterval(id);
  }, [canvas]);

  // the extra sprites: read through refs, so the canvas keeps one function
  useEffect(() => {
    const c = canvas();
    if (!c) return;
    c.setExtras((map, t, reduced) => {
      const s = stateRef.current;
      if (!s) return [];
      const now = Date.now() + offsetRef.current;
      const out: Array<{ x: number; y: number; draw: (b: CanvasRenderingContext2D, camX: number, camY: number) => void }> = [];
      if (s.wild) {
        for (const a of s.wild.animals) {
          if (now >= a.expiresMs) continue;
          const p = animalAt(a, now), q = animalAt(a, now - 120);
          const moving = Math.hypot(p.x - q.x, p.y - q.y) > 0.6;                          // v22: idle when it barely moves
          const step = reduced || !moving ? 0 : Math.floor(t / 200) % 2;
          out.push({ x: p.x, y: p.y, draw: (b, cx, cy) => drawAnimal(b, a.species, Math.round(p.x) - cx, Math.round(p.y) - cy, p.x < q.x, step, s.night, t) });
        }
      }
      for (const f of s.fights) {
        if (f.map !== map || f.status !== "up" || now < f.startsMs || now >= f.endsMs) continue;
        const p = bossSpot(f);
        out.push({
          x: p.x, y: p.y, draw: (b, cx, cy) => {
            const since = performance.now() - hurtRef.current;
            const shake = !reduced && since < 300 ? Math.round(Math.sin(since / 20) * 2) : 0;   // v22: the hit shakes it
            drawBoss(b, f.boss, Math.round(p.x) - cx + shake, Math.round(p.y) - cy, t, since < 150, f.phase, reduced);
            drawBossBar(b, f.name, Math.round(p.x) - cx + shake, Math.round(p.y) - cy, f.hp, f.maxHp);
            // v22: damage numbers rise and fade
            for (const fl of floatsRef.current) {
              const age = performance.now() - fl.at;
              if (age > 1400) continue;
              const fy = Math.round(p.y) - cy - 70 - (reduced ? 0 : Math.round(age / 40));
              b.globalAlpha = Math.max(0, 1 - age / 1400);
              b.font = "bold 10px monospace";
              b.textAlign = "center";
              b.fillStyle = "#1d1a14";
              b.fillText(`-${fl.dmg}`, Math.round(p.x) - cx + 1, fy + 1);
              b.fillStyle = "#ff5040";
              b.fillText(`-${fl.dmg}`, Math.round(p.x) - cx, fy);
              b.globalAlpha = 1;
            }
          },
        });
      }
      // 0097: Rừng tràm's trees (2D), a stump where one was felled (the shared felled store: everyone's)
      if (map === "rung_tram") {
        for (const tr of rungTramTrees()) {
          const down = isFelled(tr.key);
          out.push({ x: tr.x, y: tr.y, draw: (b, cx, cy) => (down ? drawStump(b, Math.round(tr.x) - cx, Math.round(tr.y) - cy)
            : drawTram(b, Math.round(tr.x) - cx, Math.round(tr.y) - cy, tr.cx * 7 + tr.k, reduced ? 0 : (Math.sin(t / 900 + tr.x) + 1) / 2,
              treeOf(tr.cx, tr.cy, tr.k).id)) });   // 0121: a rarer kind's crown tint
        }
      }
      if (map === GATE.map) {
        out.push({ x: GATE.x, y: GATE.y - 8, draw: (b, cx, cy) => drawGate(b, GATE.x - cx, GATE.y - 8 - cy, t, reduced) });
        out.push({ x: STALL.x, y: STALL.y - 6, draw: (b, cx, cy) => drawStall(b, STALL.x - cx, STALL.y - 6 - cy, s.night, t, reduced) });
      }
      return out;
    });
    return () => c.setExtras(null);
  }, [canvas]);

  // my party on the minimap (server positions of the last 2 min)
  useEffect(() => {
    const members = state?.party?.members ?? [];
    setPartyDots(members.flatMap((m) => (m.id !== accountId && m.map ? [{ name: m.name, map: m.map, x: m.x, y: m.y }] : [])));
  }, [state, accountId]);
  useEffect(() => () => setPartyDots([]), []);

  const run = useCallback(async <T,>(fn: () => Promise<T>, after?: (r: T) => void) => {
    setBusy(true);
    try {
      const r = await fn();
      after?.(r);
      await reload();
    } catch (e) {
      toast(worldErrorText(e));
    } finally {
      setBusy(false);
    }
  }, [reload, toast]);

  const posNow = () => (canvas()?.zone?.() === "wild" ? canvas()?.worldPos() : canvas()?.localPos()) ?? null;   // 0096

  // v22 (0083): the wild minigames — start, play (WildGame, live via mg_sync since 0087), finish (the inputs only)
  const act = (a: WildAnimal, action: WildAction) => {
    const p = posNow();
    if (!p || busy || wild || combo) return;
    void run(() => wildStart(token, a.id, action, mapId, p.x, p.y), (round) => {
      setWild({ round, phase: "playing", message: "", night: stateRef.current?.night ?? false, live: liveSync(token, "world") });
    });
  };
  const wildEnd = (a: number[], b: number[], ticks: number) => {
    const v = wild;
    if (!v || v.phase !== "playing") return;
    setWild({ ...v, phase: "sending" });
    const sp = speciesOf(v.round.species);
    const net = v.round.game === "trap" && (v.round.species === "bird" || v.round.species === "firefly");
    const key = net ? "net" : v.round.game;
    void (async () => {
      let message: string;
      try {
        const r = await wildFinish(token, a, b, ticks);
        const lines: string[] = [];
        if (v.round.game === "photo") {
          lines.push(r.saved ? `${okLine("photo", v.round.nonce)} 📷 ${sp?.name} vào album (${r.score} điểm, +${r.xp} XP)`
            : r.result === "lost" ? "Lượt này không được tính." : `${noLine("photo", v.round.nonce)} (${r.score} điểm — cần 250)`);
        } else if (r.result === "ok" && r.item) {
          lines.push(`${okLine(key, v.round.nonce)} +${r.qty} ${WILD_ITEMS[r.item].name} (+${r.xp} XP)`);
        } else if (r.result === "lost") {
          lines.push(r.why === "gone" ? "Con vật đã chạy mất." : r.why === "not in forest" ? "Bạn đã ra khỏi rừng." : r.why === "expired" ? "Hết giờ rồi."
            : r.why === "late" ? "Mạng chập chờn — lượt này không được tính." : "Lượt này không được tính.");
        } else if (r.outcome === "hit" || r.outcome === "caught") {
          lines.push(`Trúng ${r.score} điểm nhưng ${sp?.name} vùng thoát được (${r.chance}%)…`);
        } else {
          lines.push(noLine(key, v.round.nonce));
        }
        if (v.round.danger) lines.push(r.knocked ? `${noLine("dodge", v.round.nonce)} 💥 Đói, khát −8${r.fainted ? " — bạn ngất đi!" : ""}` : okLine("dodge", v.round.nonce));
        message = lines.join("\n");
      } catch (e) {
        message = worldErrorText(e);
      }
      setWild((cur) => (cur ? { ...cur, phase: "done", message } : cur));
      void reload();
    })();
  };
  const wildClose = () => setWild(null);

  const sell = (item: WildItemId, qty: number) =>
    void run(() => wildSell(token, item, qty), (r) => {
      if (r.npc) setNpc(r.npc);
      const cut = npcCutNote(r.cut);
      toast(`💰 Bán được ${r.earned} xu${cut ? ` · ${cut}` : ""}`);
      onCoins();
    });
  // 0121: a whole stack, SELL_MAX at a time (the stall refuses more in one sale as a bad quantity)
  const sellAll = (item: WildItemId, total: number) =>
    void run(async () => {
      let left = total, earned = 0, cut = 0;
      let last: Awaited<ReturnType<typeof wildSell>> | null = null;
      while (left > 0) {
        const n = Math.min(SELL_MAX, left);
        last = await wildSell(token, item, n);
        earned += last.earned; cut += last.cut; left -= n;
      }
      return last ? { ...last, earned, cut } : null;
    }, (r) => {
      if (!r) return;
      if (r.npc) setNpc(r.npc);
      const c = npcCutNote(r.cut);
      toast(`💰 Bán được ${r.earned} xu${c ? ` · ${c}` : ""}`);
      onCoins();
    });

  // v22 (0083): the combo strike (bosses and the dungeon)
  const startCombo = (kind: "boss" | "dungeon", ref: number, target: number, view: Pick<ComboView, "name" | "boss" | "icon">) => {
    const p = canvas()?.localPos() ?? null;                                                    // the bosses are the zones'
    if (!p || busy || wild || combo) return;
    void run(() => comboStart(token, kind, ref, target, zoneMap, p.x, p.y), (round) => setCombo({ ...view, round, phase: "playing", message: "", dmg: null, live: liveSync(token, "world") }));
  };
  const attack = (f: BossFight) => startCombo("boss", f.id, 0, { name: f.name, boss: f.boss, icon: "👹" });
  const comboEnd = (keys: number[], dodges: number[], ticks: number) => {
    const v = combo;
    if (!v || v.phase !== "playing") return;
    if (ticks < 0) {                     // given up (Esc) or the live channel lost: nothing is sent (0087)
      setCombo(null);
      return;
    }
    setCombo({ ...v, phase: "sending" });
    void (async () => {
      let message: string, dmg: number | null = null;
      try {
        const r = await comboFinish(token, keys, dodges, ticks);
        dmg = r.dmg;
        const hits = r.judges.filter((j) => j !== "miss").length;
        const lines = [r.result === "ok"
          ? `${hits >= 4 ? okLine("combo", v.round.nonce) : noLine("combo", v.round.nonce)} ${hits}/6 nhịp, chuỗi ×${r.best} → ${r.dmg} sát thương`
          : r.why === "expired" ? "Hết giờ rồi." : r.why === "late" ? "Mạng chập chờn — lượt này không được tính." : r.why === "boss not up" ? "Boss đã đi." : r.why === "run over" ? "Lượt hầm ngục đã kết thúc." : "Lượt này không được tính."];
        if (r.stunned) lines.push(`💢 ${noLine("dodge", v.round.nonce + 1)} Choáng 3 giây (đói, khát −3)`);
        if (r.killed) { lines.push(`🏆 ${v.name} đã bị hạ! ${bossRewardNote(v.boss ?? "")}`); onCoins(); }
        if (r.cleared) { lines.push("🏆 Hạ Dơi Chúa — hầm ngục đã được dọn sạch!"); onCoins(); }
        if (r.dmg > 0) {
          const now = performance.now();
          hurtRef.current = now;
          floatsRef.current = [...floatsRef.current.filter((x) => now - x.at < 1400), { dmg: r.dmg, at: now }];
          setLastHit({ dmg: r.dmg, combo: r.best, at: Date.now() });
        }
        message = lines.join("\n");
      } catch (e) {
        message = worldErrorText(e);
      }
      setCombo((cur) => (cur ? { ...cur, phase: "done", message, dmg } : cur));
      void reload();
    })();
  };
  const comboClose = () => setCombo(null);
  const summon = () => {
    const p = canvas()?.localPos() ?? null;
    if (!p) return;
    void run(() => bossSummon(token, zoneMap, p.x, p.y), () => toast("📣 Vua Heo Rừng đang lao tới!"));
  };

  const dgStart = () => void run(() => dungeonStart(token), () => { toast(`🕳️ Vào hầm ngục!`); onCoins(); });
  const dgJoin = (id: number) => void run(() => dungeonJoin(token, id), () => onCoins());
  const dgAttack = (id: number, target: number) => {
    const room = stateRef.current?.dungeon?.room ?? 1;
    const icon = room === 3 ? "🕷️" : room === 2 ? "🐍" : "🦇";
    startCombo("dungeon", id, target, { name: room === 4 ? "Dơi Chúa" : `Quái hầm ngục #${target}`, boss: null, icon });
  };

  const party = {
    create: () => void run(() => partyCreate(token)),
    invite: (name: string) => void run(() => partyInvite(token, name), () => toast(`✉️ Đã mời ${name}`)),
    accept: (id: number) => void run(() => partyAccept(token, id)),
    decline: (id: number) => void run(() => partyDecline(token, id)),
    leave: () => void run(() => partyLeave(token)),
    kick: (id: string) => void run(() => partyKick(token, id)),
    say: (body: string) => void run(() => partySay(token, body)),
  };

  const snow = {
    start: (minutes: number) => void run(() => snowStart(token, roomId, minutes), () => { toast("❄️ Tuyết bắt đầu rơi!"); onWeather(); }),
    stop: () => void run(() => snowStop(token, roomId), () => onWeather()),
  };

  return { state, offset, here, inWild, busy, lastHit, act, sell, sellAll, npc, attack, summon, dgStart, dgJoin, dgAttack, party, snow, reload, wild, wildEnd, wildClose, combo, comboEnd, comboClose };
}

export type World = ReturnType<typeof useWorld>;
