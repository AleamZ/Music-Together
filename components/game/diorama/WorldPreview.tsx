"use client";

import { useEffect, useRef, useState } from "react";
import { createActor, idleFrame, setPath, tickActor, walkFrame, type Actor } from "@/lib/game/actor";
import { lightingFor, type WeatherFx } from "@/lib/game/art/weather";
import { CAMERA_MODES } from "@/lib/game/diorama/camera";
import type { Billboard, CameraMode, Quality } from "@/lib/game/diorama/types";
import { demoFieldPlots } from "@/lib/game/diorama/zones/field";
import { demoLive, demoRower } from "@/lib/game/diorama/world/live-demo";
import type { WorldStats, WorldView } from "@/lib/game/diorama/world/view";
import { CHU_HAI_CA_LOOK, CHU_TAM_LOOK, DEFAULT_LOOK } from "@/lib/game/look";
import { getMap } from "@/lib/game/maps/registry";
import type { GameMap } from "@/lib/game/maps/types";
import { findPath, smoothPath } from "@/lib/game/pathfinding";
import type { Vec } from "@/lib/game/types";
import { buildWorld } from "@/lib/game/world/compose";
import { MINE } from "@/lib/game/world/mine";
import { TRAILS } from "@/lib/game/world/roads";
import { toWorld } from "@/lib/game/world/zones";
import { canalCrossings, FLOATING_MARKET, gardenSpots, lotusPonds, stiltHouses, villageShops } from "@/lib/game/world/delta";
import { heightAt } from "@/lib/game/world/terrain";
import type { WeatherKind } from "@/lib/game/weather/model";

// Dev only (/dev/world): the unified world in 3D — no login, no network. Overview orbits the whole world; follow rides
// behind a fake walker who tours the road network between the zones (and over a bridge to the south bank); free-fly.
// The panel sets the time of day, the weather, the camera and the quality. ?mode=follow&hour=17.8&q=high for shots.

const KINDS: ReadonlyArray<WeatherKind | "none"> = ["none", "clear", "cloudy", "fog", "rain", "thunder", "storm", "snow"];
const MODE_LABEL: Record<CameraMode, string> = { follow: "Theo người", overview: "Toàn cảnh", free: "Bay tự do" };

/** Dev camera presets (units, yaw, pitch) for the screenshots: the delta's landmarks up close. */
function camPresets(): Record<string, { pos: { x: number; y: number; z: number }; yaw: number; pitch: number }> {
  const look = (x: number, y: number, dist: number, height: number, yaw = 0.5) => ({
    pos: { x: x / 16 + Math.sin(yaw) * dist, y: heightAt(x, y) + height, z: y / 16 + Math.cos(yaw) * dist }, yaw, pitch: -Math.atan2(height, dist),
  });
  const cr = canalCrossings(), monkey = cr.find((c) => c.monkey) ?? cr[0], road = cr.find((c) => !c.monkey) ?? cr[0];
  const h = stiltHouses()[3] ?? stiltHouses()[0];
  return {
    overview: { pos: { x: 130, y: 120, z: 230 }, yaw: 0, pitch: -0.75 },
    caukhi: look(monkey.x, monkey.y, 9, 4),
    bridge: look(road.x, road.y, 11, 5, 1.1),
    market: look(FLOATING_MARKET.x, FLOATING_MARKET.y, 16, 7, 0.3),
    houses: look(h.x, h.y, 12, 6, 0.8),
    river: { pos: { x: 30, y: 45, z: 150 }, yaw: -Math.PI / 2 + 0.35, pitch: -0.5 },
    paddies: { pos: { x: 40, y: 30, z: 40 }, yaw: -2.4, pitch: -0.45 },
    tram: look(1700, 250, 20, 10),
    hill: look(3780, 1232, 60, 25, -0.9),
    pond: look(1260, 1260, 18, 11, 0.2),
    lotus: (() => { const p = lotusPonds()[0]; return look(p.x, p.y, 9, 5, 0.6); })(),
    garden: (() => { const g = gardenSpots()[0]; return look(g.x, g.y, 10, 5, 0.4); })(),
    shop: (() => { const s = villageShops()[0]; return look(s.x, s.y, 9, 3.5, s.yaw); })(),
    lua: { pos: { x: 20, y: 18, z: 130 }, yaw: -2.2, pitch: -0.3 },
    pondedge: look(1290, 1470, 16, 6, 0.1),
  };
}

function hourToMs(hour: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime() + hour * 3_600_000;
}

/** The walker's tour (world px): the hall, the market, Khu nhà, Bãi đất, Mỏ đá, back, the pond, the field, a bridge. */
function tourStops(): Vec[] {
  const spot = (zone: Parameters<typeof toWorld>[0], id: string) => toWorld(zone, getMap(zone as never).interactables.find((i) => i.id === id)!.use)!;
  const b1 = TRAILS[0].pts, b2 = TRAILS[1].pts;
  return [
    toWorld("hall", getMap("hall").spawn)!, spot("hall", "market_sign"), spot("market", "market_to_khu_nha"), spot("khu_nha", "khu_nha_exit"),
    spot("market", "market_to_bai_dat"), spot("bai_dat", "mo_da_gate"), MINE.use, b2[b2.length - 1], spot("bai_dat", "bai_dat_exit"),
    spot("market", "market_exit"), spot("hall", "dock_sign"), spot("pond", "pond_exit"), spot("pond", "field_bridge"), b1[b1.length - 1],
    spot("field", "field_to_pond"), spot("field", "field_to_hall"), spot("hall", "field_sign"),
  ];
}

/** The page's query (?mode=follow&hour=17.8&weather=rain&q=high&speed=3&panel=0), read on the server. */
export type WorldPreviewInit = Partial<Record<"mode" | "hour" | "weather" | "q" | "speed" | "panel" | "live", string>>;

export default function WorldPreview({ init = {} }: { init?: WorldPreviewInit }) {
  const param = (name: keyof WorldPreviewInit): string | null => init[name] ?? null;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<WorldView | null>(null);
  const [hour, setHour] = useState(() => Number(param("hour") ?? 10));
  const [kind, setKind] = useState<WeatherKind | "none">(() => (param("weather") as WeatherKind | null) ?? "clear");
  const [wind, setWind] = useState(12);
  const [fx, setFx] = useState<WeatherFx>(3);
  const [mode, setMode] = useState<CameraMode>(() => (param("mode") as CameraMode | null) ?? "overview");
  const [quality, setQuality] = useState<Quality | "auto">(() => (param("q") as Quality | null) ?? "auto");
  const [speed, setSpeed] = useState(() => Number(param("speed") ?? 3));
  const [stats, setStats] = useState<WorldStats | null>(null);
  const [status, setStatus] = useState<string | null>("Đang dựng thế giới…");
  const envRef = useRef({ hour, kind, wind, fx, speed });
  useEffect(() => {
    envRef.current = { hour, kind, wind, fx, speed };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let raf = 0, view: WorldView | null = null, cancelled = false;
    const start = async () => {
      await new Promise((r) => setTimeout(r, 30));                        // let the "building…" note paint
      const { WorldView } = await import("@/lib/game/diorama/world/view");
      if (cancelled) return;
      const world = buildWorld();
      const map = world as unknown as GameMap;
      const stops = tourStops();
      const now0 = performance.now();
      const me: Actor = createActor("me", { ...stops[0] }, "down", now0);
      const pal: Actor = createActor("ba", { ...stops[1] }, "left", now0);
      let meI = 1, palI = 4;
      const walkTo = (a: Actor, to: Vec) => {
        const cells = findPath(map, a.pos, to, 400_000);
        if (cells) setPath(a, smoothPath(map, a.pos, cells));
      };
      try {
        const t0 = performance.now();
        view = new WorldView(canvas, {
          allowFree: true,
          quality: (param("q") as Quality | null) ?? "auto",
          onTap: (p) => walkTo(me, p),
        });
        console.info(`world built in ${Math.round(performance.now() - t0)} ms`);
      } catch (e) {
        setStatus(`Không mở được WebGL: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      if (cancelled) { view.dispose(); return; }
      viewRef.current = view;
      setStatus(null);
      view.setPlots(demoFieldPlots());
      view.setCameraMode((param("mode") as CameraMode | null) ?? "overview");
      const v = view;
      (window as unknown as { __world?: unknown }).__world = {
        view: v, me,
        teleport: (i: number) => { me.pos = { ...stops[i % stops.length] }; me.display = { ...me.pos }; me.path = null; meI = (i + 1) % stops.length; },
        /** The canvas as a PNG data URL, drawn now (dev screenshots). */
        snap: () => { if (lastFrame) v.render({ ...lastFrame, t: performance.now() }); return canvas.toDataURL("image/png"); },
        /** A shot from a named camera (camPresets) drawn and read back in one go — nothing else can move the camera
         *  in between (other sessions driving the browser). JPEG data URL, small enough to hand back. */
        snapAt: (name: string, quality = 0.85) => {
          const p = camPresets()[name];
          if (!p) return `unknown preset; try ${Object.keys(camPresets()).join(", ")}`;
          v.setFly(p.pos, p.yaw, p.pitch);
          for (let i = 0; i < 3; i++) if (lastFrame) v.render({ ...lastFrame, t: performance.now() + i * 16 });
          return canvas.toDataURL("image/jpeg", quality);
        },
        /** snapAt, saved by the dev route to <os tmp>/world-snaps/<file>.jpg; resolves to where. */
        saveSnap: async (name: string, file = name) => {
          const w = (window as unknown as { __world: { snapAt: (n: string) => string } }).__world;
          const r = await fetch("/dev/world/snap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: file, data: w.snapAt(name) }) });
          return r.ok ? ((await r.json()) as { file: string }).file : `failed ${r.status}`;
        },
        bench: (n = 120) => {
          const t = performance.now();
          const f = { t, focus: me.display, billboards: [], night: 0, warm: 0, weather: null, windKmh: 10, fx: 3 as WeatherFx, reduced: false };
          for (let i = 0; i < n; i++) v.render({ ...f, t: t + i * 16.7 });
          v.finish();
          return (performance.now() - t) / n;
        },
      };
      const showLive = param("live") !== "0";
      let last = now0, statsAt = 0, lastFrame: Parameters<WorldView["render"]>[0] | null = null;
      const loop = (t: number) => {
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        const env = envRef.current;
        if (!me.path && !me.moving) { walkTo(me, stops[meI]); meI = (meI + 1) % stops.length; }
        if (!pal.path && !pal.moving) { walkTo(pal, stops[palI]); palI = (palI + 5) % stops.length; }
        tickActor(map, me, dt, t, false, 70 * env.speed);
        tickActor(map, pal, dt, t, false, 70 * env.speed);
        const frameOf = (a: Actor) => { const f = walkFrame(a); return f === 0 ? idleFrame(t, a.id.length * 300) : f; };
        const billboards: Billboard[] = [
          { id: "ba", look: CHU_TAM_LOOK, x: pal.display.x, y: pal.display.y, facing: pal.facing, frame: frameOf(pal), name: "Bạn đi dạo" },
          ...world.npcs.map((n): Billboard => ({ id: `${n.zone}:${n.id}`, look: n.look, x: n.spot.x, y: n.spot.y, facing: n.spot.dir, frame: idleFrame(t, n.id.length * 200), name: null })),
          { id: "me", look: DEFAULT_LOOK, x: me.display.x, y: me.display.y, facing: me.facing, frame: frameOf(me), name: "Bạn", me: true },
        ];
        const w = env.kind === "none" ? null : { kind: env.kind, code: 0, isDay: true, sunriseMs: hourToMs(6), sunsetMs: hourToMs(18), rainMm: 0, windKmh: env.wind, updatedAtMs: 0 };
        const light = lightingFor(hourToMs(env.hour), w, env.fx);
        const night = light.night;
        lastFrame = {
          t, focus: me.display, billboards, night, warm: Math.max(0, 1 - Math.min(Math.abs(env.hour - 18), Math.abs(env.hour - 6)) / 1.1),
          weather: w?.kind ?? null, windKmh: env.wind, fx: env.fx, reduced: false,
        };
        if (showLive) {
          const live = demoLive(t, { moto: "ba" });
          v.setLive(live);
          const rower = demoRower(live, CHU_HAI_CA_LOOK);
          if (rower) billboards.push(rower);
        }
        v.render(lastFrame);
        if (t - statsAt > 500) { statsAt = t; setStats(v.stats()); }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    };
    void start();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      viewRef.current = null;
      delete (window as unknown as { __world?: unknown }).__world;
      view?.dispose();
    };
  }, []);             // eslint-disable-line react-hooks/exhaustive-deps -- built once; the query only seeds it

  const pickMode = (m: CameraMode) => { setMode(m); viewRef.current?.setCameraMode(m); };
  const pickQuality = (q: Quality | "auto") => { setQuality(q); viewRef.current?.setQuality(q); };
  const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60);
  const hidePanel = param("panel") === "0";

  return (
    <main className="fixed inset-0 bg-[#1b1410] text-[#f4ead8]">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full touch-none select-none" aria-label="Thế giới 3D" />
      {status && <div className="absolute inset-0 grid place-items-center text-lg">{status}</div>}
      {!hidePanel && (
        <div className="absolute top-2 left-2 flex max-w-[calc(100%-16px)] flex-col gap-2 rounded bg-black/55 p-3 text-sm backdrop-blur-sm sm:w-72">
          <div className="font-bold">Thế giới — 3D (thử)</div>
          <label className="flex flex-col gap-1">
            <span>Giờ: {String(hh).padStart(2, "0")}:{String(mm).padStart(2, "0")}</span>
            <input type="range" min={0} max={24} step={0.25} value={hour} onChange={(e) => setHour(Number(e.target.value))} />
          </label>
          <div className="flex flex-wrap gap-1">
            {[["Sáng", 8], ["Trưa", 12.5], ["Chiều tà", 17.8], ["Đêm", 22]].map(([l, h]) => (
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
          <label className="flex flex-col gap-1">
            <span>Tốc độ người đi: ×{speed}</span>
            <input type="range" min={1} max={8} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
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
          {stats && (
            <div className="font-mono text-xs opacity-80" data-testid="world-stats">
              {stats.fps} fps · {stats.cpuMs} ms CPU · {stats.quality} · {stats.calls} calls · {Math.round(stats.triangles / 1000)}k tris · LOD {stats.chunks} · {stats.trees} cây · {stats.live} live
            </div>
          )}
          <div className="text-xs opacity-70">
            Kéo: xoay · lăn chuột: gần/xa · bấm đất: người đi tới. Bay tự do: WASD, kéo để nhìn, Space/C lên/xuống, Shift nhanh.
          </div>
        </div>
      )}
    </main>
  );
}
