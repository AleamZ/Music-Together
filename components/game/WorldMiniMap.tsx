"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from "react";
import type { Vec } from "@/lib/game/types";
import { allPartyDots } from "@/lib/game/realm/party-dots";
import { zoneName } from "@/lib/game/world/minimap";
import { waypointAt, type WaypointMark } from "@/lib/game/world/waypoints";
import {
  clampView, FACING_HEADING, fitView, headingFrom, KIND_COLOUR, labelAt, MAP_LABELS, mapPosToWorld, zoomAbout, ZONE_TINT, type MapView,
} from "@/lib/game/world/worldmap";
import { drawWorldMapFrame, worldMapBase, type MapPerson } from "@/lib/game/world/worldmap-canvas";
import type { ZoneId } from "@/lib/game/world/zones";

// P4: the world map from the world's own data (lib/game/world/worldmap*.ts). The base image is built once per session
// and shared; each frame only draws the part in view and the overlays (labels, waypoints, people, me with my heading,
// my boat). WorldMiniMap: the HUD corner, centred on me, zoom − / +, a click opens the full map. WorldMapView: the full
// map's pannable, zoomable canvas (drag, wheel, pinch, buttons), hover labels, a click on a waypoint travels.

/** What the map shows of the live game (all world px). */
export interface MapFeed {
  getMe: () => Vec | null;
  /** The others in sight and my boat (world mode's engine); absent in 2D. */
  getMarks?: () => { others: ReadonlyArray<{ id: string; x: number; y: number }>; boat: boolean; baits?: ReadonlyArray<{ x: number; y: number; color: string }> };
}

/** The party (their server positions, any map) and the others in sight, as dots. */
function peopleOf(feed: MapFeed): { people: MapPerson[]; boat: boolean; baits: ReadonlyArray<{ x: number; y: number; color: string }> } {
  const people: MapPerson[] = [];
  for (const d of allPartyDots()) {
    const w = mapPosToWorld(d.map, d);
    if (w) people.push({ id: `party:${d.name}`, x: w.x, y: w.y, kind: "party", name: d.name });
  }
  const m = feed.getMarks?.();
  for (const o of m?.others ?? []) people.push({ id: o.id, x: o.x, y: o.y, kind: "other" });
  return { people, boat: m?.boat ?? false, baits: m?.baits ?? [] };   // 0117: the ổ thính
}

/** My heading, from how I moved (kept while I stand). */
function useHeading() {
  const last = useRef<{ p: Vec | null; h: number }>({ p: null, h: FACING_HEADING.down });
  return (p: Vec | null): number => {
    if (!p) return last.current.h;
    last.current.h = headingFrom(last.current.p, p, last.current.h);
    last.current.p = p;
    return last.current.h;
  };
}

const MINI_W = 240, MINI_H = 160;
const MINI_ZOOMS = [0.04, 0.06, 0.09, 0.14, 0.2] as const;

export default function WorldMiniMap({ getWorldPos, getMarks, zone, waypoints = [], onOpenMap }: {
  getWorldPos: () => Vec | null;
  getMarks?: MapFeed["getMarks"];
  zone: ZoneId | null;
  waypoints?: readonly WaypointMark[];
  onOpenMap?: () => void;
}) {
  const [minimized, setMinimized] = useState(false);
  const [zi, setZi] = useState(2);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const live = useRef({ waypoints, getMarks, zi });
  useEffect(() => {
    live.current = { waypoints, getMarks, zi };
  });
  const heading = useHeading();
  useEffect(() => {
    if (minimized) return;
    let raf = 0;
    worldMapBase(() => {});
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const draw = () => {
      const c = canvasRef.current, ctx = c?.getContext("2d");
      if (c && ctx) {
        if (c.width !== MINI_W * dpr) { c.width = MINI_W * dpr; c.height = MINI_H * dpr; }
        const me = getWorldPos();
        const s = MINI_ZOOMS[live.current.zi] * dpr;
        const v: MapView = me ? { x0: me.x - c.width / s / 2, y0: me.y - c.height / s / 2, scale: s } : fitView(c.width, c.height);
        const { people, boat, baits } = peopleOf({ getMe: getWorldPos, getMarks: live.current.getMarks });
        drawWorldMapFrame(ctx, c.width, c.height, v, { labels: live.current.zi >= 2 ? "major" : "none", me, heading: heading(me), boat, people, waypoints: live.current.waypoints, dpr, baits });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimized, getWorldPos]);
  return (
    <div className="pch pointer-events-auto flex flex-col gap-1 p-1 font-vt text-base leading-none" data-testid="world-minimap">
      <div className="flex items-center justify-between gap-2 px-1">
        <button type="button" className="flex items-center gap-1" onClick={() => setMinimized((m) => !m)} aria-expanded={!minimized}>
          <span>🧭 {zone ? zoneName(zone) : "Thế giới"}</span>
          <span aria-hidden="true">{minimized ? "▸" : "▾"}</span>
        </button>
        {onOpenMap && (
          <button type="button" className="pch-btn px-1 text-sm" data-hotkey="cityMap" onClick={onOpenMap} title="Bản đồ thế giới (M)" aria-label="Mở bản đồ thế giới">🗺️ M</button>
        )}
      </div>
      {!minimized && (
        <div className="relative">
          <canvas ref={canvasRef} width={MINI_W} height={MINI_H} style={{ width: MINI_W, height: MINI_H }}
            className="block cursor-pointer rounded-sm border border-ink/50" aria-label="Bản đồ nhỏ thế giới" onClick={onOpenMap} />
          <div className="absolute right-1 top-1 flex flex-col gap-1">
            <button type="button" className="pch-btn h-6 w-6 p-0 text-sm leading-none" aria-label="Phóng to bản đồ nhỏ" disabled={zi >= MINI_ZOOMS.length - 1}
              onClick={() => setZi((z) => Math.min(MINI_ZOOMS.length - 1, z + 1))}>+</button>
            <button type="button" className="pch-btn h-6 w-6 p-0 text-sm leading-none" aria-label="Thu nhỏ bản đồ nhỏ" disabled={zi <= 0}
              onClick={() => setZi((z) => Math.max(0, z - 1))}>−</button>
          </div>
        </div>
      )}
    </div>
  );
}

const LEGEND: ReadonlyArray<[string, string]> = [
  [KIND_COLOUR.paddy_green, "Ruộng lúa"], [KIND_COLOUR.paddy_gold, "Lúa chín"], [KIND_COLOUR.orchard, "Vườn cây"], [KIND_COLOUR.tram, "Rừng tràm"],
  [KIND_COLOUR.river, "Sông, kênh"], [KIND_COLOUR.mountain, "Núi"], ["#e2cfa4", "Đường"], ["#8a5a33", "Cầu"], [ZONE_TINT.market, "Khu"],
];
const DOTS: ReadonlyArray<[string, string]> = [["#e0402a", "Bạn"], ["#22c55e", "Tổ đội"], ["#f5f5f4", "Người chơi"], ["#f2c14e", "Trạm dịch chuyển"]];

const MIN_SCALE = 0.08, MAX_SCALE = 1.6;

/** The full world map: fills its box, drag / wheel / pinch / buttons to pan and zoom, hover names, click a waypoint. */
export function WorldMapView({ feed, waypoints = [], onWaypoint }: {
  feed: MapFeed;
  waypoints?: readonly WaypointMark[];
  onWaypoint?: (m: WaypointMark) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<MapView | null>(null);
  const live = useRef({ feed, waypoints });
  useEffect(() => {
    live.current = { feed, waypoints };
  });
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const heading = useHeading();
  const dprRef = useRef(1);

  useEffect(() => {
    let raf = 0;
    worldMapBase(() => {});
    const draw = () => {
      const c = canvasRef.current, box = boxRef.current, ctx = c?.getContext("2d");
      if (c && box && ctx) {
        const dpr = (dprRef.current = Math.min(2, window.devicePixelRatio || 1));
        const w = Math.max(1, Math.round(box.clientWidth * dpr)), h = Math.max(1, Math.round(box.clientHeight * dpr));
        if (c.width !== w || c.height !== h) {
          const old = view.current, ow = c.width, oh = c.height;
          c.width = w; c.height = h;
          if (!old) {
            const me = live.current.feed.getMe();
            const fit = fitView(w, h);
            view.current = me ? clampView({ x0: me.x - w / (fit.scale * 2.2) / 2, y0: me.y - h / (fit.scale * 2.2) / 2, scale: fit.scale * 2.2 }, w, h) : fit;
          } else {
            view.current = { ...old, x0: old.x0 + (ow - w) / old.scale / 2, y0: old.y0 + (oh - h) / old.scale / 2 };
          }
        }
        const me = live.current.feed.getMe();
        const { people, boat } = peopleOf(live.current.feed);
        drawWorldMapFrame(ctx, w, h, view.current!, { labels: "all", me, heading: heading(me), boat, people, waypoints: live.current.waypoints, dpr });
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canvasPt = (e: { clientX: number; clientY: number }): Vec => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) * dprRef.current, y: (e.clientY - r.top) * dprRef.current };
  };
  const setView = (v: MapView) => {
    const c = canvasRef.current;
    if (c) view.current = clampView(v, c.width, c.height);
  };
  const zoomBy = (f: number, at?: Vec) => {
    const c = canvasRef.current, v = view.current;
    if (!c || !v) return;
    const d = dprRef.current;
    setView(zoomAbout(v, at ?? { x: c.width / 2, y: c.height / 2 }, f, MIN_SCALE * d, MAX_SCALE * d));
  };

  // drag to pan, two fingers to pinch, a short tap clicks
  const pointers = useRef(new Map<number, Vec>());
  const gesture = useRef<{ moved: number; pinch: number | null }>({ moved: 0, pinch: null });
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, canvasPt(e));
    gesture.current = { moved: pointers.current.size > 1 ? 99 : 0, pinch: null };
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const p = canvasPt(e), prev = pointers.current.get(e.pointerId), v = view.current;
    if (!prev || !v) {
      if (v) {
        const all = [...MAP_LABELS, ...live.current.waypoints.map((m) => ({ name: `🌀 ${m.name}${m.found ? "" : " (chưa khám phá)"}`, x: m.x, y: m.y }))];
        const t = labelAt(all, v, p, 18 * dprRef.current);
        const r = canvasRef.current!.getBoundingClientRect();
        setHover(t ? { x: e.clientX - r.left, y: e.clientY - r.top, text: t } : null);
      }
      return;
    }
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.current.pinch) zoomBy(d / gesture.current.pinch, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      gesture.current.pinch = d;
      return;
    }
    const dx = p.x - prev.x, dy = p.y - prev.y;
    gesture.current.moved += Math.abs(dx) + Math.abs(dy);
    setView({ ...v, x0: v.x0 - dx / v.scale, y0: v.y0 - dy / v.scale });
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const had = pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.pinch = null;
    if (!had || gesture.current.moved > 6 * dprRef.current || pointers.current.size > 0) return;
    const v = view.current;
    const m = v ? waypointAt(live.current.waypoints, v, canvasPt(e), 14 * dprRef.current) : null;
    if (m) onWaypoint?.(m);
  };
  const onWheel = (e: RWheelEvent<HTMLCanvasElement>) => zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2, canvasPt(e));
  const centreMe = () => {
    const me = live.current.feed.getMe(), c = canvasRef.current, v = view.current;
    if (me && c && v) setView({ ...v, x0: me.x - c.width / v.scale / 2, y0: me.y - c.height / v.scale / 2 });
  };
  const fitAll = () => {
    const c = canvasRef.current;
    if (c) view.current = fitView(c.width, c.height);
  };
  // the page must not scroll under the wheel
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    c.addEventListener("wheel", stop, { passive: false });
    return () => c.removeEventListener("wheel", stop);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <div ref={boxRef} className="relative h-[58vh] min-h-[240px] w-full overflow-hidden rounded-sm border-2 border-ink/60 bg-[#6d6a45] sm:h-[62vh]">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full cursor-grab touch-none select-none active:cursor-grabbing" aria-label="Bản đồ thế giới"
          data-testid="world-map" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)} onWheel={onWheel} />
        {hover && (
          <span className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-sm bg-ink/85 px-1.5 py-0.5 text-sm text-parchment"
            style={{ left: hover.x, top: hover.y - 10 }} data-testid="world-map-hover">{hover.text}</span>
        )}
        <div className="absolute right-2 top-2 flex flex-col gap-1">
          <button type="button" className="pch-btn h-8 w-8 p-0 text-lg leading-none" aria-label="Phóng to" onClick={() => zoomBy(1.4)}>+</button>
          <button type="button" className="pch-btn h-8 w-8 p-0 text-lg leading-none" aria-label="Thu nhỏ" onClick={() => zoomBy(1 / 1.4)}>−</button>
          <button type="button" className="pch-btn h-8 w-8 p-0 text-base leading-none" aria-label="Về chỗ tôi" title="Về chỗ tôi" onClick={centreMe}>📍</button>
          <button type="button" className="pch-btn h-8 w-8 p-0 text-base leading-none" aria-label="Xem cả thế giới" title="Xem cả thế giới" onClick={fitAll}>⤢</button>
        </div>
        <span className="pointer-events-none absolute left-2 top-2 rounded-sm bg-parchment/80 px-1 text-sm text-ink" aria-hidden="true">⬆ B</span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-sm" data-testid="world-map-legend" aria-label="Chú giải">
        {LEGEND.map(([c, t]) => (
          <li key={t} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-sm border border-ink/50" style={{ background: c }} />{t}</li>
        ))}
        {DOTS.map(([c, t]) => (
          <li key={t} className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded-full border border-ink/60" style={{ background: c }} />{t}</li>
        ))}
      </ul>
    </div>
  );
}
