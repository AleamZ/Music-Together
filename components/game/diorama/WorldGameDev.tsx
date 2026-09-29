"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GameCanvas, { type GameCanvasHandle } from "@/components/game/GameCanvas";
import WorldMiniMap from "@/components/game/WorldMiniMap";
import ZoneToast from "@/components/game/ZoneToast";
import { useDevLive } from "./useDevLive";
import { CO_BA_LOOK, CO_UT_LOOK, CHU_TU_LOOK, DEFAULT_LOOK } from "@/lib/game/look";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import type { GameChannelHandlers, GameChannelHandle } from "@/lib/game/net/channel";
import type { GameMessage } from "@/lib/game/net/protocol";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import type { RosterEntry } from "@/lib/game/engine";
import type { GameMap } from "@/lib/game/maps/types";
import type { Look, Vec } from "@/lib/game/types";
import { toZoneMsg } from "@/lib/game/world/aoi";
import { buildWorld } from "@/lib/game/world/compose";
import { zoneName } from "@/lib/game/world/minimap";
import { MINE, worldArrival } from "@/lib/game/world/wild";
import { isZone, toWorld, zoneAt, ZONE_IDS, type ZoneId } from "@/lib/game/world/zones";

// Dev only (/dev/world-game): the REAL game engine in P2 world mode — GameCanvas, the engine, the zone channels, the
// WorldView with the chibi characters — with no login and no network: the realtime channels are a local in-page bus, and
// three fake players walk the roads on it (their `pa`s zone-local on their zone's topic, exactly as the wire carries
// them). A mini shell handles the portals (the mine mouth down to the cave and back up), the rest just toasts. The
// window's __worldDev lets the screenshots jump: __worldDev.go("market") / .at(x, y).

type Handlers = GameChannelHandlers & { zone: string };

/** The in-page realtime: topics by zone; a send reaches every other listener of that topic (never the sender). */
class FakeBus {
  private subs = new Set<Handlers>();
  join = (_room: string, map: { id: string; width: number; height: number }, h: GameChannelHandlers): GameChannelHandle => {
    const me: Handlers = { ...h, zone: map.id };
    this.subs.add(me);
    const t = window.setTimeout(() => h.onStatus(true), 40);
    return {
      send: (msg) => { for (const s of this.subs) if (s !== me && s.zone === map.id) s.onMessage(msg); },
      leave: (last) => {
        window.clearTimeout(t);
        this.subs.delete(me);
        if (last) for (const s of this.subs) if (s.zone === map.id) s.onMessage(last);
      },
    };
  };
  /** A bot's broadcast on its zone's topic (already zone-local). */
  emit(zone: string, msg: GameMessage): void {
    for (const s of this.subs) if (s.zone === zone) s.onMessage(msg);
  }
}

interface Bot { id: string; name: string; look: Look; pos: Vec; path: Vec[]; nextAt: number }

const BOT_LOOKS: Array<[string, string, Look]> = [
  ["bot_lan", "Lv7 Lan", CO_UT_LOOK], ["bot_tuan", "Lv12 Tuấn", CHU_TU_LOOK], ["bot_mai", "Lv4 Mai", CO_BA_LOOK],
];

const ME = "dev-me";

export default function WorldGameDev() {
  const canvasRef = useRef<GameCanvasHandle | null>(null);
  const bus = useMemo(() => new FakeBus(), []);
  const [travel, setTravel] = useState<{ mapId: MapId; arrive: Spot | null; key: number; world: Spot | null }>({ mapId: "hall", arrive: null, key: 0, world: null });
  const [zone, setZone] = useState<ZoneId | null>(null);
  const [prompt, setPrompt] = useState<Interactable | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);
  const say = useCallback((t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);
  const unlocked = useMemo(() => ({ unlocked: ZONE_IDS }), []);
  const travelTo = useCallback((to: { map: MapId; arrive: Spot }) => {
    setTravel((t) => ({ mapId: to.map, arrive: to.arrive, key: t.key + 1, world: worldArrival(t.mapId, to.map) }));
  }, []);
  const onInteract = useCallback((it: Interactable) => {
    if ((it.kind === "portal" || it.kind === "ug_hatch") && it.to) { travelTo(it.to); return; }
    say(`(dev) ${it.label} — ${it.prompt}`);
  }, [travelTo, say]);
  const onZoneChange = useCallback((z: ZoneId) => {
    setZone(z);
    if (isZone(z)) setTravel((t) => (t.mapId === z ? t : { ...t, mapId: z, arrive: null }));
  }, []);

  // the fake players: each walks from road point to road point on the world grid, announced on its zone's topic
  const bots = useRef<Bot[]>([]);
  useEffect(() => {
    const world = buildWorld() as unknown as GameMap;
    const starts = [toWorld("market", { x: 300, y: 250 })!, toWorld("hall", { x: 400, y: 330 })!, { x: 3300, y: 1300 }];
    bots.current = BOT_LOOKS.map(([id, name, look], i) => ({ id, name, look, pos: { ...starts[i] }, path: [], nextAt: 0 }));
    const goals: Vec[] = [
      toWorld("hall", getMap("hall").spawn)!, toWorld("market", { x: 640, y: 250 })!, toWorld("pond", { x: 300, y: 356 })!,
      toWorld("bai_dat", { x: 400, y: 60 })!, { ...MINE.exit }, toWorld("field", { x: 400, y: 200 })!, toWorld("khu_nha", { x: 300, y: 208 })!,
    ];
    const id = window.setInterval(() => {
      const now = performance.now();
      for (const b of bots.current) {
        // walk along (70 px/s) and pick a new goal when done
        let step = 70 * 0.25;
        while (step > 0 && b.path.length > 0) {
          const q = b.path[0], d = Math.hypot(q.x - b.pos.x, q.y - b.pos.y);
          if (d <= step) { b.pos = { ...q }; b.path.shift(); step -= d; } else { b.pos = { x: b.pos.x + ((q.x - b.pos.x) / d) * step, y: b.pos.y + ((q.y - b.pos.y) / d) * step }; step = 0; }
        }
        if (b.path.length === 0 && now > b.nextAt) {
          const goal = goals[Math.floor(Math.random() * goals.length)];
          const cells = findPath(world, b.pos, goal);
          if (cells) {
            b.path = smoothPath(world, b.pos, cells).slice(0, 24);
            const z = zoneAt(b.pos);
            const msg: GameMessage = { t: "pa", id: b.id, x: Math.round(b.pos.x), y: Math.round(b.pos.y), pts: b.path.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]), h: null };
            bus.emit(z, toZoneMsg(msg, z));
          }
          b.nextAt = now + 3000 + Math.random() * 4000;
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [bus]);
  useEffect(() => {
    const roster: RosterEntry[] = BOT_LOOKS.map(([id, name, look]) => ({ id, name, badges: "", look, spot: null }));
    const t = window.setTimeout(() => canvasRef.current?.setRoster(roster), 300);
    return () => window.clearTimeout(t);
  }, [travel.mapId]);
  // bots answer hellos: re-announce their walks every 2 s (a newcomer sees them within 2 s)
  useEffect(() => {
    const id = window.setInterval(() => {
      for (const b of bots.current) {
        const z = zoneAt(b.pos);
        const msg: GameMessage = b.path.length
          ? { t: "pa", id: b.id, x: Math.round(b.pos.x), y: Math.round(b.pos.y), pts: b.path.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]), h: null }
          : { t: "st", id: b.id, x: Math.round(b.pos.x), y: Math.round(b.pos.y), d: "d", mv: false, vx: 0, vy: 0, h: null };
        bus.emit(z, toZoneMsg(msg, z));
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [bus]);

  // P4: a fake game state through the real live feed (stalls, animals, a boss, houses, rings, my pet)
  useDevLive(canvasRef, isZone(travel.mapId) ? travel.mapId : "hall");

  // screenshots: jump anywhere
  useEffect(() => {
    const w = window as unknown as { __worldDev?: unknown };
    w.__worldDev = {
      go: (z: MapId) => travelTo({ map: z, arrive: getMap(z).spawn }),
      at: (x: number, y: number) => setTravel((t) => ({ mapId: isZone(zoneAt({ x, y })) ? (zoneAt({ x, y }) as MapId) : "bai_dat", arrive: null, key: t.key + 1, world: { x, y, dir: "down" } })),
      mine: () => setTravel((t) => ({ mapId: "bai_dat", arrive: null, key: t.key + 1, world: { ...MINE.exit, dir: "right" } })),
      interact: () => canvasRef.current?.interact(),
      fish: (phase: "idle" | "waiting" | "bite" | "reeling") => canvasRef.current?.setFishing({ phase }),
      pos: () => canvasRef.current?.worldPos() ?? canvasRef.current?.localPos(),
      zone: () => canvasRef.current?.zone(),
      travel: () => travel,
    };
  }, [travelTo, travel]);

  return (
    <div className="game-ui fixed inset-0 overflow-hidden bg-[#2f6e8f] text-ink">
      <GameCanvas
        ref={canvasRef}
        roomId="dev"
        localId={ME}
        mapId={travel.mapId}
        arrive={travel.arrive}
        world={unlocked}
        travelKey={travel.key}
        arriveWorld={travel.world}
        initial={{ name: "Lv9 Bạn (dev)", badges: "", look: DEFAULT_LOOK }}
        isMember={() => true}
        isHere={() => true}
        onInteract={onInteract}
        onPromptChange={setPrompt}
        onActorClick={(id) => say(`(dev) ${id}`)}
        onConnectionChange={() => {}}
        onLookChanged={() => {}}
        onFishingInput={() => {}}
        onFirstFrame={() => {}}
        onUnsupported={() => say("Không có canvas")}
        onFatal={() => say("Engine lỗi")}
        onZoneChange={onZoneChange}
        joinChannel={bus.join}
        force3d
      />
      <ZoneToast zone={isZone(travel.mapId) ? zone : null} />
      <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-2">
        <div className="pch pointer-events-auto p-2 font-vt text-lg leading-tight" data-testid="dev-hud">
          <p>🧪 /dev/world-game — engine thật, P2 world mode (không mạng)</p>
          <p>Đang ở: {isZone(travel.mapId) ? (zone ? zoneName(zone) : "…") : `${travel.mapId} (bên trong)`}</p>
          <p className="opacity-70">WASD/chạm để đi · E tương tác · cửa hầm mỏ trên đồi phía đông</p>
        </div>
        {isZone(travel.mapId) && <WorldMiniMap getWorldPos={() => canvasRef.current?.worldPos() ?? null} zone={zone} />}
      </div>
      {prompt && (
        <button type="button" className="pch-btn absolute bottom-6 left-1/2 z-10 -translate-x-1/2 px-3 py-2 font-vt text-xl" onClick={() => canvasRef.current?.interact()}>
          E · {prompt.prompt}
        </button>
      )}
      {toast && <div className="pch absolute bottom-20 left-1/2 z-10 -translate-x-1/2 px-3 py-2 font-vt text-lg">{toast}</div>}
    </div>
  );
}
