"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import GameCanvas, { type GameCanvasHandle } from "@/components/game/GameCanvas";
import Camera3dControl from "@/components/game/Camera3dControl";
import { addFelled, setFelled } from "@/lib/game/forest/felled-store";
import { cellTrees } from "@/lib/game/forest/near";
import { cyclePreset, getCam, setCam, toggleView } from "@/lib/game/diorama/world/game-camera";
import WorldMiniMap from "@/components/game/WorldMiniMap";
import ZoneToast from "@/components/game/ZoneToast";
import CityMapModal from "@/components/game/CityMapModal";
import { WAYPOINTS } from "@/lib/game/progression/model";
import { waypointMarks } from "@/lib/game/world/waypoints";
import { mapPosToWorld } from "@/lib/game/world/worldmap";
import { useDevLive } from "./useDevLive";
import { CO_BA_LOOK, CO_UT_LOOK, CHU_TU_LOOK, DEFAULT_LOOK } from "@/lib/game/look";
import { getMap } from "@/lib/game/maps/registry";
import type { Interactable, MapId, Spot } from "@/lib/game/maps/types";
import { FakeBus } from "@/lib/game/net/fake-bus";
import type { GameMessage } from "@/lib/game/net/protocol";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import type { RosterEntry } from "@/lib/game/engine";
import type { GameMap } from "@/lib/game/maps/types";
import type { Look, Vec } from "@/lib/game/types";
import { cellAt, cellTopicId } from "@/lib/game/world/grid";
import { buildWorld } from "@/lib/game/world/compose";
import { zoneName } from "@/lib/game/world/minimap";
import { MINE, worldArrival } from "@/lib/game/world/wild";
import { isZone, toWorld, zoneAt, ZONE_IDS, type ZoneId } from "@/lib/game/world/zones";

// Dev only (/dev/world-game): the REAL game engine in P2 world mode — GameCanvas, the engine, the zone channels, the
// WorldView with the chibi characters — with no login and no network: the realtime channels are a local in-page bus, and
// three fake players walk the roads on it (P4: their `pa`s in world px on their grid cell's topic, as the wire carries
// them; lib/game/net/fake-bus.ts). A mini shell handles the portals (the mine mouth down to the cave and back up), the rest just toasts. The
// window's __worldDev lets the screenshots jump: __worldDev.go("market") / .at(x, y).

interface Bot { id: string; name: string; look: Look; pos: Vec; path: Vec[]; nextAt: number }

const BOT_LOOKS: Array<[string, string, Look]> = [
  ["bot_lan", "Lv7 Lan", CO_UT_LOOK], ["bot_tuan", "Lv12 Tuấn", CHU_TU_LOOK], ["bot_mai", "Lv4 Mai", CO_BA_LOOK],
];

const ME = "dev-me";
const DEV_COUNTS: Readonly<Record<MapId, number>> = { hall: 1, pond: 0, field: 0, market: 1, khu_nha: 0, bai_dat: 1, ham_ngam: 0, mo_da: 0, song_cai: 0, rung_tram: 0 };

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
  // P4: the world map (M, the minimap): my spot (world px; in Rừng tràm / the mine mapped onto the world), the bots, waypoints
  const [mapOpen, setMapOpen] = useState(false);
  const getWorldPos = useCallback(() => canvasRef.current?.worldPos() ?? null, []);
  const getMarks = useCallback(() => canvasRef.current?.mapMarks() ?? { others: [], boat: false }, []);
  const mapRef = useRef<MapId>("hall");
  useEffect(() => {
    mapRef.current = travel.mapId;
  }, [travel.mapId]);
  const getMapPos = useCallback(() => {
    const w = canvasRef.current?.worldPos();
    if (w) return w;
    const p = canvasRef.current?.localPos();
    return p ? mapPosToWorld(mapRef.current, p) : null;
  }, []);
  const devWaypoints = useMemo(() => waypointMarks(new Set(WAYPOINTS.map((w) => w.id).slice(0, -1)), null), []);
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
            const cell = cellTopicId(cellAt(b.pos));
            const msg: GameMessage = { t: "pa", id: b.id, x: Math.round(b.pos.x), y: Math.round(b.pos.y), pts: b.path.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]), h: null };
            bus.emit(cell, msg);
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
        const cell = cellTopicId(cellAt(b.pos));
        const msg: GameMessage = b.path.length
          ? { t: "pa", id: b.id, x: Math.round(b.pos.x), y: Math.round(b.pos.y), pts: b.path.map((p) => [Math.round(p.x), Math.round(p.y)] as [number, number]), h: null }
          : { t: "st", id: b.id, x: Math.round(b.pos.x), y: Math.round(b.pos.y), d: "d", mv: false, vx: 0, vy: 0, h: null };
        bus.emit(cell, msg);
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
      // 0097 playtest: my chibi chops / cooks (the fa broadcast too); fell the tràm nearest (x, y) for 20 s, or clear
      work: (a: "chop" | "cook" | null) => canvasRef.current?.setWork?.(a),
      fell: (x: number, y: number) => {
        const cx = Math.floor(x / 64), cy = Math.floor(y / 64);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++)
          cellTrees(cx + dx, cy + dy).forEach((_t, k) => addFelled(`${cx + dx}:${cy + dy}:${k}`, Date.now() + 20_000));
      },
      unfell: () => setFelled([], Date.now()),
    };
  }, [travelTo, travel]);

  // the game's camera keys (the shell's hotkeys are not on this page): Z cycles the preset, 8 first / third person
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.code === "KeyZ") setCam(cyclePreset(getCam()));
      if (e.code === "KeyM" && !(e.target instanceof HTMLInputElement)) setMapOpen((o) => !o);   // P4: the world map
      if (e.code === "Digit8" || e.code === "Numpad8") setCam(toggleView(getCam()));
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

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
        <div className="pointer-events-auto"><Camera3dControl /></div>
        {isZone(travel.mapId) && <WorldMiniMap getWorldPos={getWorldPos} getMarks={getMarks} zone={zone} waypoints={devWaypoints} onOpenMap={() => setMapOpen(true)} />}
      </div>
      {prompt && (
        <button type="button" className="pch-btn absolute bottom-6 left-1/2 z-10 -translate-x-1/2 px-3 py-2 font-vt text-xl" onClick={() => canvasRef.current?.interact()}>
          E · {prompt.prompt}
        </button>
      )}
      {mapOpen && (
        <CityMapModal current={travel.mapId} counts={DEV_COUNTS} onClose={() => setMapOpen(false)} getWorldPos={getMapPos} getMarks={getMarks}
          waypoints={devWaypoints} onWaypoint={(m) => { setMapOpen(false); setTravel((t) => ({ mapId: isZone(zoneAt(m)) ? (zoneAt(m) as MapId) : "bai_dat", arrive: null, key: t.key + 1, world: { x: m.x, y: m.y + 24, dir: "down" } })); say(`(dev) 🌀 ${m.name}`); }} />
      )}
      {toast && <div className="pch absolute bottom-20 left-1/2 z-10 -translate-x-1/2 px-3 py-2 font-vt text-lg">{toast}</div>}
    </div>
  );
}
