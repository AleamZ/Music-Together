import { CITY_PLACES } from "@/lib/game/maps/city";
import type { Vec } from "@/lib/game/types";
import { MINE } from "./mine";
import { ROADS, TRAILS } from "./roads";
import { RIVER_PTS, STREAM_PTS } from "./terrain";
import { WORLD_H, WORLD_W, ZONE_IDS, ZONES, type OutdoorMapId, type ZoneId } from "./zones";
import type { WaypointMark } from "./waypoints";

// P2: the world as a map (the minimap's player-centred window and the city map's whole world): the land, the river and
// the stream, the roads and trails, each zone as a labelled block, the mine mouth, and me. Drawn with plain 2D canvas
// calls from the world data (no prebuilt image); `view` maps world px to canvas px.

export interface MapView { x0: number; y0: number; scale: number }

const ZONE_FILL: Readonly<Record<OutdoorMapId, string>> = {
  field: "#c9c46a", hall: "#d9b77a", pond: "#7fb3c9", market: "#d98f6a", khu_nha: "#c7a88a", bai_dat: "#b8a58a", song_cai: "#5f9fbf",
};

/** The name a zone is shown under ("Ngoài đồng" for the wild). */
export function zoneName(z: ZoneId): string {
  return z === "wild" ? "Ngoài đồng" : CITY_PLACES[z]?.name ?? z;
}

/** A view that shows the whole world in a w × h canvas. */
export function fitWorld(w: number, h: number): MapView {
  const scale = Math.min(w / WORLD_W, h / WORLD_H);
  return { x0: -(w / scale - WORLD_W) / 2, y0: -(h / scale - WORLD_H) / 2, scale };
}

/** A view centred on `p` at `scale` canvas px per world px, kept inside the world. */
export function centreOn(p: Vec, w: number, h: number, scale: number): MapView {
  const vw = w / scale, vh = h / scale;
  const x0 = Math.max(0, Math.min(WORLD_W - vw, p.x - vw / 2)), y0 = Math.max(0, Math.min(WORLD_H - vh, p.y - vh / 2));
  return { x0, y0, scale };
}

export function drawWorldMap(ctx: CanvasRenderingContext2D, w: number, h: number, v: MapView, me: Vec | null,
  opts: { labels?: boolean; locked?: ReadonlySet<ZoneId>; waypoints?: readonly WaypointMark[] } = {}): void {
  const X = (x: number) => (x - v.x0) * v.scale, Y = (y: number) => (y - v.y0) * v.scale;
  ctx.fillStyle = "#6f8f4a";
  ctx.fillRect(0, 0, w, h);
  // the forest belt north, the rim
  ctx.fillStyle = "#4f6e33";
  ctx.fillRect(X(0), Y(0), WORLD_W * v.scale, 400 * v.scale);
  const line = (pts: readonly Vec[], width: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, width * v.scale);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))));
    ctx.stroke();
  };
  line(RIVER_PTS, 220, "#5f9fbf");
  line(STREAM_PTS, 22, "#5f9fbf");
  for (const t of TRAILS) line(t.pts, t.w, "#b8955e");
  for (const r of ROADS) line(r.pts, r.w + 8, "#d9c29a");
  for (const id of ZONE_IDS) {
    const z = ZONES[id];
    ctx.fillStyle = opts.locked?.has(id) ? "#7a7066" : ZONE_FILL[id];
    ctx.fillRect(X(z.ox), Y(z.oy), z.w * v.scale, z.h * v.scale);
    ctx.strokeStyle = "#3b2a1a";
    ctx.lineWidth = 1;
    ctx.strokeRect(X(z.ox) + 0.5, Y(z.oy) + 0.5, z.w * v.scale - 1, z.h * v.scale - 1);
    if (opts.labels) {
      ctx.fillStyle = "#2a1d12";
      ctx.font = `${Math.max(10, Math.round(90 * v.scale))}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${CITY_PLACES[id]?.icon ?? ""} ${zoneName(id)}`, X(z.ox + z.w / 2), Y(z.oy + z.h / 2));
    }
  }
  // the mine mouth (Mỏ đá, underground)
  ctx.fillStyle = "#2a2320";
  const mr = Math.max(3, 34 * v.scale);
  ctx.beginPath();
  ctx.arc(X(MINE.mouth.x), Y(MINE.mouth.y), mr, 0, Math.PI * 2);
  ctx.fill();
  if (opts.labels) {
    ctx.fillStyle = "#2a1d12";
    ctx.fillText("⛏️ Mỏ đá", X(MINE.mouth.x), Y(MINE.mouth.y) - mr - 8);
  }
  // P3: the fast-travel waypoints — gold when discovered (click to travel), grey when not, a green ring where I stand
  for (const m of opts.waypoints ?? []) {
    const x = X(m.x), y = Y(m.y), s = Math.max(4, 60 * v.scale);
    ctx.fillStyle = m.found ? "#f2c14e" : "#9a9086";
    ctx.strokeStyle = "#2a1d12";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s, y);
    ctx.lineTo(x, y + s);
    ctx.lineTo(x - s, y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (m.here) {
      ctx.strokeStyle = "#2f9e44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, s + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (opts.labels) {
      ctx.fillStyle = "#2a1d12";
      ctx.font = `${Math.max(10, Math.round(70 * v.scale))}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(`🌀 ${m.name}`, x, y + s + 2);
    }
  }
  if (me) {
    ctx.fillStyle = "#e0402a";
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(X(me.x), Y(me.y), Math.max(4, 40 * v.scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
