import { CITY_PLACES } from "@/lib/game/maps/city";
import { RT_H, RT_ORIGIN, RT_W } from "@/lib/game/maps/rung-tram";
import type { MapId } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { FLOATING_MARKET, lotusPonds } from "./delta";
import { MINE } from "./mine";
import { CABLE, DI_LAC, GATE, LAKE, NUI, nuiHeight, TEMPLE } from "./nuicam";
import { SONG_CAI_ROUTE } from "./routes";
import { landUse, type LandUse } from "./scenery";
import { canalDist, CANAL_HALF_W, fbm, hashAt, riverAt, streamAt, STREAM_HALF_W, zoneUnder } from "./terrain";
import { isZone, toWorld, WORLD_H, WORLD_W, ZONES, type OutdoorMapId } from "./zones";

// P4: the world map, rendered from the same world data the 3D terrain is built from (not hand-drawn). A base image of
// the land (land use, water, the mountain's shading and contours) is computed once per session at 1 px per MAP_STEP
// world px (worldmap.worker.ts off the main thread; baseRGBA() here for the fallback and the tests); the overlays (labels,
// waypoints, people, me) are drawn per frame over it (components/game/worldmap/). Pure.

/** World px per base-image pixel. */
export const MAP_STEP = 4;
export const BASE_W = Math.ceil(WORLD_W / MAP_STEP);
export const BASE_H = Math.ceil(WORLD_H / MAP_STEP);

/** What the base image shows at a point. */
export type MapKind = "river" | "canal" | "stream" | "lake" | "pond" | "zone" | LandUse;

/** The colours of the land and water (the legend lists them). Paddies alternate green and gold by plot. */
export const KIND_COLOUR: Readonly<Record<Exclude<MapKind, "zone" | "paddy"> | "paddy_green" | "paddy_gold" | "mountain", string>> = {
  paddy_green: "#86b04e",
  paddy_gold: "#d2bd5c",
  orchard: "#5d8c3c",
  tram: "#2e5429",
  river: "#8a7f4f",        // phù sa: the delta's water, brown-green
  canal: "#7f7c50",
  stream: "#7c8a5a",
  lake: "#5f8f86",         // the mountain lake, clearer
  pond: "#6e8a62",
  mountain: "#a39c7e",
};

/** The zones' ground on the map (their plazas, the pond's bank, Sông Cái's reed bank). */
export const ZONE_TINT: Readonly<Record<OutdoorMapId, string>> = {
  field: "#c2b46a", hall: "#d8c08e", pond: "#a9bf8a", market: "#d4a47c", khu_nha: "#c9ad8f", bai_dat: "#bda98a", song_cai: "#a8b27a",
};

/** Paddy plots (world px): each is green or gold. */
const PLOT = 56;

/** What is at world (x, y) on the map: water first (the one river — through Sông Cái too — canals, stream, the
 *  mountain lake, the lotus ponds), then a zone, then the land's use. */
export function mapKindAt(x: number, y: number): { kind: MapKind; zone: OutdoorMapId | null } {
  const r = riverAt(x, y);
  if (r.d < r.hw) return { kind: "river", zone: null };
  if (Math.hypot(x - LAKE.x, y - LAKE.y) < LAKE.r) return { kind: "lake", zone: null };
  const z = zoneUnder(x, y);
  if (z) return { kind: "zone", zone: z };
  if (canalDist(x, y) < CANAL_HALF_W) return { kind: "canal", zone: null };
  if (streamAt(x, y).d < STREAM_HALF_W) return { kind: "stream", zone: null };
  if (pondAt(x, y)) return { kind: "pond", zone: null };
  return { kind: landUse(x, y), zone: null };
}

let pondList: ReturnType<typeof lotusPonds> | null = null;
function pondAt(x: number, y: number): boolean {
  pondList ??= lotusPonds();
  for (const p of pondList) if (Math.abs(p.x - x) < p.r && Math.abs(p.y - y) < p.r && Math.hypot(p.x - x, p.y - y) < p.r) return true;
  return false;
}

/** "#rrggbb" → [r, g, b]. */
export function hexRGB(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The colour (hex) of a map kind at (x, y), before the mountain's shading. */
export function kindColour(kind: MapKind, x: number, y: number, zone: OutdoorMapId | null = null): string {
  if (kind === "zone") return zone ? ZONE_TINT[zone] : KIND_COLOUR.paddy_green;
  if (kind === "paddy") return hashAt(Math.floor(x / PLOT), Math.floor(y / PLOT), 77) < 0.62 ? KIND_COLOUR.paddy_green : KIND_COLOUR.paddy_gold;
  return KIND_COLOUR[kind];
}

/** The mountain's wooded foot (its crown is KIND_COLOUR.mountain). */
const MOUNTAIN_FOOT = "#4d6e3a";
const mountainH = (x: number, y: number): number => nuiHeight(x, y, (a, b) => fbm(a, b, 2));

/** The base pixel of open land at world (x, y) with its use: the use's colour, orchard rows and forest texture, the
 *  mountain (rock toward the crown, lit from the north-west) and its contour lines every 2.5 units. The water, the
 *  zones and the roads are drawn over it as shapes from the same data (drawBaseShapes). */
export function landPixel(x: number, y: number, use: LandUse): [number, number, number] {
  let [r, g, b] = hexRGB(kindColour(use, x, y));
  if (use === "orchard" && hashAt(Math.floor(x / 12), Math.floor(y / 12), 31) < 0.35) { r -= 22; g -= 18; b -= 14; }
  if (use === "tram") { const n = hashAt(Math.floor(x / 8), Math.floor(y / 8), 41) * 22 - 11; r += n; g += n; b += n * 0.5; }
  if (Math.abs(x - NUI.x) < NUI.r && Math.abs(y - NUI.y) < NUI.r) {
    const h = mountainH(x, y);
    if (h > 0.4) {
      // the slopes wooded low, bare rock toward the crown; blended in over the foot so the land runs up into it
      const f = Math.min(1, h / NUI.h), t = Math.min(1, (h - 0.4) / 1.2);
      const [lr, lg, lb] = hexRGB(MOUNTAIN_FOOT), [mr, mg, mb] = hexRGB(KIND_COLOUR.mountain);
      const cr = lr + (mr - lr) * f, cg = lg + (mg - lg) * f, cb = lb + (mb - lb) * f;
      r += (cr - r) * t; g += (cg - g) * t; b += (cb - b) * t;
      const shade = (h - mountainH(x - MAP_STEP * 2, y - MAP_STEP * 2)) * 26;   // + faces the light (NW), − away
      r -= shade; g -= shade; b -= shade;
      const band = Math.floor(h / 2.5), bandE = Math.floor(mountainH(x + MAP_STEP, y) / 2.5), bandS = Math.floor(mountainH(x, y + MAP_STEP) / 2.5);
      if (band !== bandE || band !== bandS) { r *= 0.72; g *= 0.72; b *= 0.72; }
    }
  }
  return [clamp8(r), clamp8(g), clamp8(b)];
}

const clamp8 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/** Rows [row0, row1) of the base image's land as RGBA (the worker builds it in bands). The land use is smooth (fbm at
 *  300–430 px), so it is sampled once per 2 × 2 pixels. */
export function baseRows(row0: number, row1: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray((row1 - row0) * BASE_W * 4);
  let use: LandUse[] = [];
  for (let r = row0; r < row1; r++) {
    const y = (r + 0.5) * MAP_STEP;
    if (r === row0 || (r & 1) === 0) {
      use = [];
      for (let c = 0; c < BASE_W; c += 2) use.push(landUse((c + 1) * MAP_STEP, y + MAP_STEP / 2));
    }
    let i = (r - row0) * BASE_W * 4;
    for (let c = 0; c < BASE_W; c++) {
      const p = landPixel((c + 0.5) * MAP_STEP, y, use[c >> 1]);
      out[i++] = p[0]; out[i++] = p[1]; out[i++] = p[2]; out[i++] = 255;
    }
  }
  return out;
}

// ------------------------------------------------------------------ positions

/** Rừng tràm (2D) px → world px (its map is a window of the world's forest: 0097 _forest_origin). */
export const rungTramToWorld = (p: Vec): Vec => ({ x: p.x + RT_ORIGIN.x, y: p.y + RT_ORIGIN.y });
/** World px → Rừng tràm (2D) px, or null outside its window. */
export function worldToRungTram(w: Vec): Vec | null {
  const x = w.x - RT_ORIGIN.x, y = w.y - RT_ORIGIN.y;
  return x >= 0 && y >= 0 && x < RT_W && y < RT_H ? { x, y } : null;
}

/** Where a player on map `map` at its local px `p` is on the world map (world px): a zone's offset, Rừng tràm's window,
 *  Mỏ đá at the mine mouth (underground); null for the secret hầm (not on the map). */
export function mapPosToWorld(map: MapId, p: Vec): Vec | null {
  if (map === "rung_tram") return rungTramToWorld(p);
  if (map === "mo_da") return { x: MINE.mouth.x, y: MINE.mouth.y };
  if (map === "ham_ngam") return null;
  return isZone(map) ? toWorld(map, p) : null;
}

// ------------------------------------------------------------------ labels

export interface MapLabel { id: string; icon: string; name: string; x: number; y: number; major: boolean }

const zc = (id: OutdoorMapId): Vec => ({ x: ZONES[id].ox + ZONES[id].w / 2, y: ZONES[id].oy + ZONES[id].h / 2 });
const icon = (id: MapId): string => CITY_PLACES[id]?.icon ?? "";

/** The places named on the map: the zones (major) and the landmarks. */
export const MAP_LABELS: readonly MapLabel[] = [
  { id: "hall", icon: icon("hall"), name: "Sảnh", ...zc("hall"), major: true },
  { id: "pond", icon: icon("pond"), name: "Ao cá", ...zc("pond"), major: true },
  { id: "field", icon: icon("field"), name: "Đồng", ...zc("field"), major: true },
  { id: "market", icon: icon("market"), name: "Chợ Lớn", ...zc("market"), major: true },
  { id: "khu_nha", icon: icon("khu_nha"), name: "Khu nhà", ...zc("khu_nha"), major: true },
  { id: "bai_dat", icon: icon("bai_dat"), name: "Bãi đất", ...zc("bai_dat"), major: true },
  { id: "song_cai", icon: icon("song_cai"), name: "Sông Cái", ...zc("song_cai"), major: true },
  // 0116: the road out to Sông Cái (routes.ts): its signpost at the junction and Bến đò at its end
  { id: "sign_song_cai", icon: "🪧", name: SONG_CAI_ROUTE.sign.text, x: SONG_CAI_ROUTE.sign.x + 70, y: SONG_CAI_ROUTE.sign.y, major: false },
  { id: "ben_do", icon: "🛶", name: "Bến đò Sông Cái", x: SONG_CAI_ROUTE.landing.x + 78, y: SONG_CAI_ROUTE.landing.y + 14, major: false },
  { id: "mo_da", icon: icon("mo_da"), name: "Mỏ đá", x: MINE.mouth.x, y: MINE.mouth.y, major: true },
  { id: "rung_tram", icon: "🌲", name: "Rừng tràm", x: RT_ORIGIN.x + RT_W / 2, y: RT_ORIGIN.y + 70, major: true },
  { id: "nui", icon: "⛰️", name: "Núi Mây Xanh", x: NUI.x, y: NUI.y - NUI.r + 50, major: true },
  { id: "cho_noi", icon: "🛶", name: "Chợ nổi", x: FLOATING_MARKET.x, y: FLOATING_MARKET.y, major: false },
  { id: "di_lac", icon: "🗿", name: "Tượng Di Lặc", x: DI_LAC.x, y: DI_LAC.y, major: false },
  { id: "chua", icon: "🛕", name: "Chùa", x: TEMPLE.x, y: TEMPLE.y, major: false },
  { id: "cap_treo", icon: "🚡", name: "Cáp treo", x: CABLE.a.x, y: CABLE.a.y, major: false },
  { id: "cong_nui", icon: "⛩️", name: "Cổng Núi Mây Xanh", x: GATE.x, y: GATE.y, major: false },
  { id: "ho", icon: "💧", name: "Hồ trên núi", x: LAKE.x, y: LAKE.y, major: false },
];

// ------------------------------------------------------------------ views

export interface MapView { x0: number; y0: number; scale: number }

/** The whole world in a w × h canvas (letterboxed). */
export function fitView(w: number, h: number): MapView {
  const scale = Math.min(w / WORLD_W, h / WORLD_H);
  return { x0: -(w / scale - WORLD_W) / 2, y0: -(h / scale - WORLD_H) / 2, scale };
}

/** Zoom `v` by `f` about the canvas point `c` (the world point under it stays put), within [min, max] scale. */
export function zoomAbout(v: MapView, c: Vec, f: number, min: number, max: number): MapView {
  const scale = Math.max(min, Math.min(max, v.scale * f));
  const wx = v.x0 + c.x / v.scale, wy = v.y0 + c.y / v.scale;
  return { x0: wx - c.x / scale, y0: wy - c.y / scale, scale };
}

/** Keep a view over the world: its centre may not leave the world. */
export function clampView(v: MapView, w: number, h: number): MapView {
  const cx = Math.max(0, Math.min(WORLD_W, v.x0 + w / v.scale / 2)), cy = Math.max(0, Math.min(WORLD_H, v.y0 + h / v.scale / 2));
  return { x0: cx - w / v.scale / 2, y0: cy - h / v.scale / 2, scale: v.scale };
}

export const toCanvas = (v: MapView, p: Vec): Vec => ({ x: (p.x - v.x0) * v.scale, y: (p.y - v.y0) * v.scale });
export const toWorldPx = (v: MapView, c: Vec): Vec => ({ x: v.x0 + c.x / v.scale, y: v.y0 + c.y / v.scale });

/** The label nearest the canvas point `c` within `r` px (for the hover tooltip), or null. */
export function labelAt(labels: readonly { name: string; x: number; y: number }[], v: MapView, c: Vec, r = 16): string | null {
  let best: string | null = null, bestD = r;
  for (const l of labels) {
    const q = toCanvas(v, l);
    const d = Math.hypot(q.x - c.x, q.y - c.y);
    if (d <= bestD) { best = l.name; bestD = d; }
  }
  return best;
}

/** My heading (radians, 0 = east, +y down) from my last two positions, or `prev` while I stand still. */
export function headingFrom(a: Vec | null, b: Vec, prev: number): number {
  if (!a) return prev;
  const dx = b.x - a.x, dy = b.y - a.y;
  return Math.hypot(dx, dy) > 0.5 ? Math.atan2(dy, dx) : prev;
}

/** The heading a facing stands for. */
export const FACING_HEADING = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 } as const;
