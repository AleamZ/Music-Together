"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createActor, setKeyboard, setPath, tickActor, walkFrame, idleFrame, type Actor } from "@/lib/game/actor";
import { lightingFor, type WeatherFx } from "@/lib/game/art/weather";
import { CAMERA_MODES } from "@/lib/game/diorama/camera";
import type { Billboard, CameraMode, Quality } from "@/lib/game/diorama/types";
import { cardSeatMap, seatPeople, type CardSeatIn } from "@/lib/game/diorama/zones/seats";
import { DioramaView, type DioramaStats } from "@/lib/game/diorama/view";
import { CHU_TAM_LOOK, DEFAULT_LOOK } from "@/lib/game/look";
import { DIORAMA_MAPS } from "@/lib/game/diorama/flag";
import { demoFieldPlots } from "@/lib/game/diorama/zones/field";
import { getMap } from "@/lib/game/maps/registry";
import type { MapId } from "@/lib/game/maps/types";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import type { Vec } from "@/lib/game/types";
import type { WeatherKind } from "@/lib/game/weather/model";

// Dev only (/dev/diorama): the pond as a 3D diorama with a fake player and a fake second walker — no login, no
// network. Arrow keys / WASD walk (outside free-fly), a click walks there; the panel sets the time of day, the
// weather, the camera and the quality.

const KINDS: ReadonlyArray<WeatherKind | "none"> = ["none", "clear", "cloudy", "fog", "rain", "thunder", "storm", "snow"];
const MODE_LABEL: Record<CameraMode, string> = { follow: "Theo người", overview: "Toàn cảnh", free: "Bay tự do" };
const MAP_LABEL: Partial<Record<MapId, string>> = { pond: "Ao cá", hall: "Sảnh", market: "Chợ Lớn", khu_nha: "Khu nhà",
  field: "Đồng lúa", bai_dat: "Bãi đất", mo_da: "Mỏ đá", song_cai: "Sông Cái",
};
/** The map in the URL (?map=hall); the pond by default (and on the server). */
function mapFromUrl(search: string): MapId {
  const m = new URLSearchParams(search).get("map") as MapId | null;
  return m && DIORAMA_MAPS.has(m) ? m : "pond";
}
const noSubscribe = () => () => {};
/** A tour of the pond's walkable places (the fake players stroll between them). */
const TOUR: readonly Vec[] = [
  { x: 300, y: 330 }, { x: 300, y: 212 }, { x: 380, y: 210 }, { x: 220, y: 212 }, { x: 300, y: 300 },
  { x: 498, y: 300 }, { x: 570, y: 145 }, { x: 498, y: 180 }, { x: 576, y: 312 }, { x: 150, y: 306 }, { x: 80, y: 240 },
];
const KEYS: Record<string, "up" | "down" | "left" | "right"> = {
  ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
};

function hourToMs(hour: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + hour * 3_600_000;
}

export default function DioramaPreview() {
  const mapId = useSyncExternalStore(noSubscribe, () => mapFromUrl(window.location.search), (): MapId | null => null);   // null until hydrated: no throwaway pond view
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<DioramaView | null>(null);
  const [hour, setHour] = useState(10);
  const [kind, setKind] = useState<WeatherKind | "none">("clear");
  const [wind, setWind] = useState(10);
  const [fx, setFx] = useState<WeatherFx>(3);
  const [mode, setMode] = useState<CameraMode>("follow");
  const [quality, setQuality] = useState<Quality | "auto">("auto");
  const [auto, setAuto] = useState(true);
  const [stats, setStats] = useState<DioramaStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const envRef = useRef({ hour, kind, wind, fx, auto });
  useEffect(() => {
    envRef.current = { hour, kind, wind, fx, auto };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mapId) return;
    const map = getMap(mapId);
    // the pond's hand-picked tour; elsewhere every interactable's use spot (all walkable)
    const tour: readonly Vec[] = mapId === "pond" ? TOUR : map.interactables.map((i) => i.use);
    const now0 = performance.now();
    const me: Actor = createActor("me", { ...map.spawn }, map.spawn.dir, now0);
    const other: Actor = createActor("ba", mapId === "pond" ? { x: 498, y: 300 } : { ...tour[0] }, "left", now0);
    const keys = { up: false, down: false, left: false, right: false };
    let tourI = 1 % tour.length, otherI = 6 % tour.length, lastInput = -Infinity;
    const walkTo = (a: Actor, to: Vec) => {
      const cells = findPath(map, a.pos, to);
      if (cells) setPath(a, smoothPath(map, a.pos, cells));
    };
    let view: DioramaView;
    try {
      view = new DioramaView(canvas, map, {
        allowFree: true,
        onTap: (p) => { lastInput = performance.now(); walkTo(me, p); },
      });
    } catch (e) {
      queueMicrotask(() => setError(e instanceof Error ? e.message : "WebGL không dùng được"));
      return;
    }
    viewRef.current = view;
    if (mapId === "field") view.setPlots(demoFieldPlots());                          // the crops at their stages
    // dev page only: a handle for benchmarking from the console (window.__diorama.bench())
    (window as unknown as { __diorama?: unknown }).__diorama = {
      view,
      bench: (n = 120) => {
        const t0 = performance.now();
        const f = { t: t0, focus: me.display, billboards: [], night: 0, warm: 0, weather: null, windKmh: 10, fx: 3 as WeatherFx, reduced: false };
        for (let i = 0; i < n; i++) view.render({ ...f, t: t0 + i * 16.7 });
        view.finish();
        return (performance.now() - t0) / n;
      },
    };
    const onKey = (e: KeyboardEvent) => {
      const k = KEYS[e.code];
      if (!k || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      keys[k] = e.type === "keydown";
      lastInput = performance.now();
      setKeyboard(me, { x: +keys.right - +keys.left, y: +keys.down - +keys.up });
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    const demoSeats = mapId === "hall" && new URLSearchParams(window.location.search).has("seated") ? (() => {
      const looks = [DEFAULT_LOOK, CHU_TAM_LOOK];
      const at: CardSeatIn[] = [
        ...[1, 2, 3, 4, 5, 6].map((s) => ({ game: "poker" as const, seat: s, id: `pk${s}` })),
        ...[1, 2, 3, 4].map((s) => ({ game: "tienlen" as const, seat: s, id: `tl${s}` })),
        ...[1, 3, 5, 7].map((s) => ({ game: "xidach" as const, seat: s, id: `xd${s}` })),
        ...[1, 4, 7, 10, 13].map((s) => ({ game: "cao" as const, seat: s, id: `ca${s}` })),
      ];
      const cards = cardSeatMap(at);
      const people: Billboard[] = at.map((s, i) => { const a = cards.get(s.id)!; return { id: s.id, look: looks[i % 2], x: a.x, y: a.y + 4, facing: "down", frame: 0, name: s.id }; });
      people.push({ id: "h1", look: DEFAULT_LOOK, x: 128, y: 212, facing: "down", frame: 0, name: "võng" });
      return { cards, people };
    })() : null;
    if (demoSeats) { me.pos = { x: 190, y: 262 }; me.display = { ...me.pos }; }
    let raf = 0, last = now0, statsAt = 0;
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const env = envRef.current;
      // the fake players: me strolls the tour while left alone; the other always does
      if (env.auto && t - lastInput > 4000 && !me.path && !me.moving) { walkTo(me, tour[tourI]); tourI = (tourI + 1) % tour.length; }
      if (!other.path && !other.moving) { walkTo(other, tour[otherI]); otherI = (otherI + 3) % tour.length; }
      tickActor(map, me, dt, t, false);
      tickActor(map, other, dt, t, false);
      const frameOf = (a: Actor) => { const f = walkFrame(a); return f === 0 ? idleFrame(t, a.id.length * 300) : f; };
      const billboards: Billboard[] = [
        { id: "ba", look: CHU_TAM_LOOK, x: other.display.x, y: other.display.y, facing: other.facing, frame: frameOf(other), name: "Bạn đi dạo" },
        ...map.npcs.map((n): Billboard => ({ id: n.id, look: n.look, x: n.spot.x, y: n.spot.y, facing: n.spot.dir, frame: idleFrame(t, n.id.length * 200), name: n.name })),
        { id: "me", look: DEFAULT_LOOK, x: me.display.x, y: me.display.y, facing: me.facing, frame: frameOf(me), name: "Bạn", me: true },
      ];
      // ?seated=1 (the hall): demo players seated at the card tables and in the café (zones/seats.ts), as real players are
      if (demoSeats) billboards.push(...seatPeople(demoSeats.people, { cards: demoSeats.cards, hammock: new Set(["h1"]), origin: { x: 0, y: 0 } }));
      const w = env.kind === "none" ? null : { kind: env.kind, code: 0, isDay: true, sunriseMs: hourToMs(6), sunsetMs: hourToMs(18), rainMm: 0, windKmh: env.wind, updatedAtMs: 0 };
      const light = lightingFor(hourToMs(env.hour), w, env.fx);
      const night = light.night;
      view.render({
        t, focus: me.display, billboards, night, warm: night > 0 && night < 1 ? Math.max(0, 1 - Math.abs(night - 0.5) * 2) : 0,
        weather: w?.kind ?? null, windKmh: env.wind, fx: env.fx, reduced: false,
      });
      if (t - statsAt > 500) { statsAt = t; setStats(view.stats()); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      viewRef.current = null;
      delete (window as unknown as { __diorama?: unknown }).__diorama;
      view.dispose();
    };
  }, [mapId]);

  const pickMode = (m: CameraMode) => { setMode(m); viewRef.current?.setCameraMode(m); };
  const pickQuality = (q: Quality | "auto") => { setQuality(q); viewRef.current?.setQuality(q); };
  const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);

  return (
    <main className="fixed inset-0 bg-[#1b1410] text-[#f4ead8]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" aria-label={`${mapId ? MAP_LABEL[mapId] ?? mapId : ""} 3D`} />
      {error && <div className="absolute inset-0 grid place-items-center text-lg">Không mở được WebGL: {error}</div>}
      <div className="absolute top-2 left-2 flex max-w-[calc(100%-16px)] flex-col gap-2 rounded bg-black/55 p-3 text-sm backdrop-blur-sm sm:w-72">
        <div className="font-bold">{mapId ? MAP_LABEL[mapId] ?? mapId : "…"} — diorama 3D (thử)</div>
        <label className="flex items-center justify-between gap-2">
          <span>Bản đồ</span>
          <select className="rounded bg-white/15 px-1 py-0.5" value={mapId ?? "pond"} onChange={(e) => { window.location.search = `?map=${e.target.value}`; }}>
            {[...DIORAMA_MAPS].map((m) => <option key={m} value={m} className="text-black">{MAP_LABEL[m] ?? m}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Giờ: {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}</span>
          <input type="range" min={0} max={24} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
        </label>
        <div className="flex flex-wrap gap-1">
          {[["Sáng", 8], ["Trưa", 12.5], ["Chiều tà", 17.9], ["Đêm", 22]].map(([l, h]) => (
            <button key={l} type="button" className="rounded bg-white/15 px-2 py-0.5 hover:bg-white/25" onClick={() => setHour(h as number)}>{l}</button>
          ))}
        </div>
        <label className="flex items-center justify-between gap-2">
          <span>Thời tiết</span>
          <select className="rounded bg-white/15 px-1 py-0.5" value={kind} onChange={(e) => setKind(e.target.value as WeatherKind | "none")}>
            {KINDS.map((k) => <option key={k} value={k} className="text-black">{k}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span>Gió: {wind} km/h</span>
          <input type="range" min={0} max={90} value={wind} onChange={(e) => setWind(Number(e.target.value))} />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Hiệu ứng</span>
          <select className="rounded bg-white/15 px-1 py-0.5" value={fx} onChange={(e) => setFx(Number(e.target.value) as WeatherFx)}>
            {[0, 1, 2, 3, 4].map((l) => <option key={l} value={l} className="text-black">{l}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Camera">
          {CAMERA_MODES.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m}
              className={`rounded px-2 py-0.5 ${mode === m ? "bg-amber-500 text-black" : "bg-white/15 hover:bg-white/25"}`} onClick={() => pickMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Chất lượng">
          {(["auto", "high", "low"] as const).map((q) => (
            <button key={q} type="button" role="radio" aria-checked={quality === q}
              className={`rounded px-2 py-0.5 ${quality === q ? "bg-amber-500 text-black" : "bg-white/15 hover:bg-white/25"}`} onClick={() => pickQuality(q)}>
              {q}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          <span>Tự đi dạo khi rảnh</span>
        </label>
        {stats && (
          <div className="font-mono text-xs opacity-80" data-testid="diorama-stats">
            {stats.fps} fps · {stats.cpuMs} ms CPU · {stats.quality} · {stats.calls} draw calls · {Math.round(stats.triangles / 1000)}k tris
          </div>
        )}
        <div className="text-xs opacity-70">
          Mũi tên/WASD: đi · bấm đất: đi tới · kéo: xoay · lăn chuột: gần/xa. Bay tự do: WASD, kéo để nhìn, Space/C lên/xuống, Shift nhanh.
        </div>
      </div>
    </main>
  );
}
