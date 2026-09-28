"use client";

// v21 "world" (0075): the world HUD's state — one world_state poll (every 4 s, and on each map change), the extra sprites
// handed to the canvas (animals, bosses, the gate, the stall), the party dots for the minimap and the actions. Every
// outcome comes back from the server.
import { useCallback, useEffect, useRef, useState } from "react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { drawAnimal, drawBoss, drawBossBar, drawGate, drawStall } from "@/lib/game/realm/art";
import { GATE, STALL, speciesOf, wildXY, type WildAction, type WildItemId } from "@/lib/game/realm/model";
import { setPartyDots } from "@/lib/game/realm/party-dots";
import {
  bossAttack, bossSummon, dungeonAttack, dungeonJoin, dungeonStart, partyAccept, partyCreate, partyDecline, partyInvite,
  partyKick, partyLeave, partySay, snowStart, snowStop, wildAct, wildSell, worldErrorText, worldState,
  type BossFight, type WildAnimal, type WorldState,
} from "@/lib/game/realm/rpc";
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
  const { token, roomId, accountId, mapId, canvas, toast, onCoins, onWeather } = o;
  const [state, setState] = useState<WorldState | null>(null);
  const [offset, setOffset] = useState(0);
  const [here, setHere] = useState<{ now: number; pos: Vec | null }>({ now: 0, pos: null });
  const [busy, setBusy] = useState(false);
  const [lastHit, setLastHit] = useState<Hit | null>(null);
  const stateRef = useRef<WorldState | null>(null);
  const offsetRef = useRef(0);
  const hurtRef = useRef(-Infinity);

  const reload = useCallback(async () => {
    try {
      const s = await worldState(token, roomId, mapId);
      stateRef.current = s;
      offsetRef.current = s.serverNowMs - Date.now();
      setState(s);
      setOffset(s.serverNowMs - Date.now());
    } catch { /* offline or locked: keep the last state */ }
  }, [token, roomId, mapId]);

  useEffect(() => {
    const first = setTimeout(() => void reload(), 0);
    const id = setInterval(() => void reload(), 4000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [reload]);

  // where I stand, 4× a second (for the action bar and the arena check)
  useEffect(() => {
    const id = setInterval(() => setHere({ now: Date.now(), pos: canvas()?.localPos() ?? null }), 250);
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
          const step = reduced ? 0 : Math.floor(t / 200) % 2;
          out.push({ x: p.x, y: p.y, draw: (b, cx, cy) => drawAnimal(b, a.species, Math.round(p.x) - cx, Math.round(p.y) - cy, p.x < q.x, step, s.night, t) });
        }
      }
      for (const f of s.fights) {
        if (f.map !== map || f.status !== "up" || now < f.startsMs || now >= f.endsMs) continue;
        const p = bossSpot(f);
        out.push({
          x: p.x, y: p.y, draw: (b, cx, cy) => {
            drawBoss(b, f.boss, Math.round(p.x) - cx, Math.round(p.y) - cy, t, performance.now() - hurtRef.current < 150, f.phase, reduced);
            drawBossBar(b, f.name, Math.round(p.x) - cx, Math.round(p.y) - cy, f.hp, f.maxHp);
          },
        });
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

  const posNow = () => canvas()?.localPos() ?? null;

  const act = (a: WildAnimal, action: WildAction) => {
    const p = posNow();
    if (!p) return;
    const sp = speciesOf(a.species);
    void run(() => wildAct(token, a.id, action, mapId, p.x, p.y), (r) => {
      if (action === "photo") toast(`📷 Đã chụp ${sp?.name ?? "con vật"} — thêm vào album!`);
      else if (r.ok && r.item) toast(`🎯 Bắt được ${sp?.name}: +${r.qty} ${WILD_ITEMS[r.item].name}`);
      else if (r.fainted) toast(`💥 ${sp?.name} quật ngã bạn — bạn ngất đi!`);
      else if (r.knocked) toast(`💥 ${sp?.name} phản công! Bạn bị hất văng (đói, khát −8).`);
      else toast(action === "trap" ? "Bẫy trượt rồi…" : `${sp?.name} né được!`);
    });
  };
  const sell = (item: WildItemId, qty: number) =>
    void run(() => wildSell(token, item, qty), (r) => { toast(`💰 Bán được ${r.earned} xu`); onCoins(); });

  const attack = (f: BossFight) => {
    const p = posNow();
    if (!p || busy) return;
    hurtRef.current = performance.now();
    void run(() => bossAttack(token, f.id, mapId, p.x, p.y), (r) => {
      setLastHit({ dmg: r.dmg, combo: r.combo, at: Date.now() });
      if (r.slam) toast(`💢 ${f.name} phản đòn! (đói, khát −3)`);
      if (r.killed) { toast(`🏆 ${f.name} đã bị hạ! Phần thưởng chia theo công sức.`); onCoins(); }
    });
  };
  const summon = () => {
    const p = posNow();
    if (!p) return;
    void run(() => bossSummon(token, mapId, p.x, p.y), () => toast("📣 Vua Heo Rừng đang lao tới!"));
  };

  const dgStart = () => void run(() => dungeonStart(token), () => { toast(`🕳️ Vào hầm ngục!`); onCoins(); });
  const dgJoin = (id: number) => void run(() => dungeonJoin(token, id), () => onCoins());
  const dgAttack = (id: number, target: number) =>
    void run(() => dungeonAttack(token, id, target), (r) => {
      setLastHit({ dmg: r.dmg, combo: r.combo, at: Date.now() });
      if (r.bitten) toast("🦇 Bạn bị cắn! (đói, khát −3)");
      if (r.cleared) { toast("🏆 Hạ Dơi Chúa — hầm ngục đã được dọn sạch!"); onCoins(); }
    });

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

  return { state, offset, here, busy, lastHit, act, sell, attack, summon, dgStart, dgJoin, dgAttack, party, snow, reload };
}

export type World = ReturnType<typeof useWorld>;
