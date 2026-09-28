import { APT_COLS, APT_ROWS, APT_TILE, APT_WALL_ROWS, footprint, furnitureOf, type FurnitureStyle, type Placed } from "@/lib/game/housing/apartment";
import { C, px, rect, type Ctx } from "@/lib/game/maps/scene-art";
import { FISH_ICONS } from "./fish";

// v19.2: the apartment interiors — the walls and floors (plain or the surfaces bought from cô Năm), and every piece of the
// furniture catalogue in its three styles, drawn top-down (¾ view) on the 16-px grid at any of the four rotations
// (rot 0 faces the room's front, 1 its west, 2 the wall, 3 its east). Browser only (canvas). Original art.

const S: Record<FurnitureStyle, { main: string; dark: string; light: string }> = {
  go: { main: "#8b5a33", dark: "#5a381e", light: "#a8743f" },
  hien_dai: { main: "#c8ccd4", dark: "#868b98", light: "#eef0f4" },
  may_tre: { main: "#d2a866", dark: "#9a7440", light: "#e8c890" },
};

export const ROOM_W = APT_COLS * APT_TILE;
export const ROOM_H = APT_ROWS * APT_TILE;

const WALLS: Record<string, { base: string; line: string; alt?: string }> = {
  plain: { base: "#e8e0cc", line: "#d4c9b0" },
  wall_kem: { base: "#f2e6c4", line: "#e2d2a4" },
  wall_xanh: { base: "#b8d8d0", line: "#98c0b6", alt: "#d4ece6" },
  wall_hong: { base: "#f0c8c8", line: "#dca8a8", alt: "#f8e0e0" },
  wall_go: { base: "#a8743f", line: "#8b5a33", alt: "#b8844c" },
};
const FLOORS: Record<string, { a: string; b: string; line?: string }> = {
  plain: { a: "#c9b48a", b: "#bba67c" },
  floor_gach: { a: "#e8dcc0", b: "#b04a3a", line: "#c9b48a" },
  floor_go: { a: "#b07a48", b: "#9a6a3a", line: "#7e5430" },
  floor_da: { a: "#eef0f2", b: "#d8dce2", line: "#c0c6ce" },
};

/** A wallpaper's colours (v19.3: the house walls use them too). */
export const wallColors = (wall: string | null): { base: string; line: string; alt?: string } => WALLS[wall ?? "plain"] ?? WALLS.plain;

/** One 16-px floor tile at tile (q, r) in the floor surface's pattern (v19.3: the houses' floors too). */
export function floorTile(c: Ctx, floor: string | null, q: number, r: number): void {
  const F = FLOORS[floor ?? "plain"] ?? FLOORS.plain;
  const x = q * APT_TILE, y = r * APT_TILE;
  if (floor === "floor_go") {
    rect(c, (r + (q >> 1)) % 2 ? F.a : F.b, x, y, APT_TILE, APT_TILE);
    rect(c, F.line!, x, y + 7, APT_TILE, 1); if ((q + r) % 3 === 0) rect(c, F.line!, x, y, 1, 7);
  } else if (floor === "floor_gach") {
    rect(c, F.a, x, y, APT_TILE, APT_TILE);
    rect(c, F.b, x + 5, y + 5, 6, 6); rect(c, F.a, x + 7, y + 7, 2, 2);
    px(c, F.b, x, y); px(c, F.b, x + 15, y); px(c, F.b, x, y + 15); px(c, F.b, x + 15, y + 15);
    rect(c, F.line!, x, y, APT_TILE, 1); rect(c, F.line!, x, y, 1, APT_TILE);
  } else {
    rect(c, (r + q) % 2 ? F.a : F.b, x, y, APT_TILE, APT_TILE);
    if (F.line) { rect(c, F.line, x, y, APT_TILE, 1); rect(c, F.line, x, y, 1, APT_TILE); px(c, "#ffffff", x + 4, y + 4); }
  }
}

/** The room shell: the wall (with a window and a clock), the floor, the baseboard and the door with its mat. */
export function paintRoom(c: Ctx, wall: string | null, floor: string | null): void {
  const W = wallColors(wall);
  const wallH = APT_WALL_ROWS * APT_TILE;
  rect(c, W.base, 0, 0, ROOM_W, wallH);
  if (wall === "wall_go") for (let x = 0; x < ROOM_W; x += 8) rect(c, x % 16 ? W.line : W.alt!, x, 0, 1, wallH);
  else if (W.alt) for (let y = 3; y < wallH; y += 8) for (let x = (y % 16) - 3; x < ROOM_W; x += 12) { px(c, W.alt, x, y); px(c, W.line, x + 1, y + 1); }
  else for (let y = 6; y < wallH; y += 8) rect(c, W.line, 0, y, ROOM_W, 1);
  rect(c, "#6e4a28", 0, wallH - 3, ROOM_W, 3);                              // baseboard
  // a window with the evening outside and a wall clock
  rect(c, C.outline, 23, 4, 34, 22); rect(c, "#6e4a28", 24, 5, 32, 20);
  rect(c, "#f0b070", 26, 7, 28, 16); rect(c, "#c87858", 26, 16, 28, 7); rect(c, "#6e4a28", 39, 7, 2, 16);
  rect(c, C.outline, 176, 7, 13, 13); rect(c, C.paper, 177, 8, 11, 11); rect(c, C.outline, 182, 10, 1, 4); rect(c, C.outline, 182, 13, 3, 1);
  // the floor
  for (let r = APT_WALL_ROWS; r < APT_ROWS; r++) for (let q = 0; q < APT_COLS; q++) floorTile(c, floor, q, r);
  // the door in the front wall's gap and the mat
  rect(c, "#3a2418", 6 * APT_TILE, ROOM_H - 3, 2 * APT_TILE, 3);
  rect(c, C.outline, 6 * APT_TILE + 3, 9 * APT_TILE + 2, 2 * APT_TILE - 6, 11);
  rect(c, "#a8743f", 6 * APT_TILE + 4, 9 * APT_TILE + 3, 2 * APT_TILE - 8, 9);
  for (let x = 6 * APT_TILE + 6; x < 8 * APT_TILE - 6; x += 3) rect(c, "#8b5a33", x, 9 * APT_TILE + 4, 1, 7);
}

/** The side of an item's rect that is its back (headboard, backrest, screen's back): rot 0 → top, 1 → right, 2 → bottom,
 *  3 → left. */
function back(rot: number, x: number, y: number, w: number, h: number, d: number): { x: number; y: number; w: number; h: number } {
  switch (rot) {
    case 1: return { x: x + w - d, y, w: d, h };
    case 2: return { x, y: y + h - d, w, h: d };
    case 3: return { x, y, w: d, h };
    default: return { x, y, w, h: d };
  }
}

const box = (c: Ctx, col: string, r: { x: number; y: number; w: number; h: number }) => rect(c, col, r.x, r.y, r.w, r.h);
const outlined = (c: Ctx, col: string, x: number, y: number, w: number, h: number) => { rect(c, C.outline, x, y, w, h); rect(c, col, x + 1, y + 1, w - 2, h - 2); };

/** One placed item at its tile position. `t` (ms) animates the lamps' flicker and the TV; `tvOn` lights the screen. */
export function drawItem(c: Ctx, p: Placed, t = 0, tvOn = false): void {
  const f = furnitureOf(p.item), fp = footprint(p.item, p.rot);
  if (!f || !fp) return;
  const x = p.x * APT_TILE, y = p.y * APT_TILE, w = fp.w * APT_TILE, h = fp.h * APT_TILE;
  const s = S[f.style];
  switch (f.kind) {
    case "rug": {
      if (p.item === "rug_tron" || p.item === "rug_batu") { drawRugV21(c, p.item, x, y, w, h); return; }
      const [a, b] = p.item === "rug_do" ? ["#b03a3a", "#e0b040"] : p.item === "rug_xanh" ? ["#2e6a9a", "#d8e4f0"] : ["#d8c080", "#a88a50"];
      outlined(c, a, x + 1, y + 1, w - 2, h - 2);
      rect(c, b, x + 3, y + 3, w - 6, 1); rect(c, b, x + 3, y + h - 4, w - 6, 1); rect(c, b, x + 3, y + 3, 1, h - 6); rect(c, b, x + w - 4, y + 3, 1, h - 6);
      if (p.item === "rug_chieu") for (let k = y + 5; k < y + h - 4; k += 2) rect(c, b, x + 5, k, w - 10, 1);
      else { rect(c, b, x + w / 2 - 4, y + h / 2 - 4, 8, 8); rect(c, a, x + w / 2 - 2, y + h / 2 - 2, 4, 4); }
      return;
    }
    case "bed": {
      outlined(c, s.main, x, y, w, h);
      const inner = { x: x + 2, y: y + 2, w: w - 4, h: h - 4 };
      rect(c, "#f4f1ea", inner.x, inner.y, inner.w, inner.h);
      const head = back(p.rot, x, y, w, h, 6);
      box(c, s.dark, head);
      if (p.item === "bed_maytre") for (let k = 0; k < Math.max(head.w, head.h); k += 3) px(c, s.light, head.x + (head.w > head.h ? k : 2), head.y + (head.w > head.h ? 2 : k));
      // pillow next to the head, the blanket over the rest
      const pil = back(p.rot, x + 5, y + 5, w - 10, h - 10, 7);
      box(c, "#ffffff", pil);
      const blanket = p.item === "bed_go" ? "#3d6fd1" : p.item === "bed_hiendai" ? "#6a6e7a" : "#5caa4a";
      const half = p.rot % 2 === 0 ? { x: x + 3, y: p.rot === 0 ? y + h / 2 - 2 : y + 3, w: w - 6, h: h / 2 - 1 } : { x: p.rot === 3 ? x + w / 2 - 2 : x + 3, y: y + 3, w: w / 2 - 1, h: h - 6 };
      box(c, blanket, half);
      rect(c, C.outline, half.x, half.y, half.w, 1);
      if (p.item === "bed_tang" || p.item === "bed_doi") bedExtrasV21(c, p, x, y, w, h, s);
      return;
    }
    case "table": {
      if (p.item === "table_hiendai") {
        outlined(c, "#a8d0e0", x + 1, y + 3, w - 2, h - 5); rect(c, "#d8f0f8", x + 3, y + 4, 6, 1);
        rect(c, s.dark, x + 3, y + h - 3, 2, 3); rect(c, s.dark, x + w - 5, y + h - 3, 2, 3);
      } else {
        outlined(c, s.main, x + 1, y + 2, w - 2, h - 4); rect(c, s.light, x + 2, y + 3, w - 4, 2);
        if (p.item === "table_maytre") for (let k = x + 4; k < x + w - 3; k += 3) rect(c, s.dark, k, y + 6, 1, h - 10);
        rect(c, s.dark, x + 2, y + h - 3, 2, 3); rect(c, s.dark, x + w - 4, y + h - 3, 2, 3);
        // a teapot on the traditional ones
        if (p.item === "table_go") { rect(c, C.outline, x + w / 2 - 3, y + h / 2 - 4, 7, 6); rect(c, "#f4f1ea", x + w / 2 - 2, y + h / 2 - 3, 5, 4); }
      }
      return;
    }
    case "chair": {
      outlined(c, s.main, x + 3, y + 4, w - 6, h - 7);
      box(c, s.dark, back(p.rot, x + 3, y + 1, w - 6, h - 4, 4));
      if (p.item === "chair_hiendai") rect(c, "#b04a4a", x + 5, y + 7, w - 10, h - 11);
      rect(c, s.dark, x + 4, y + h - 3, 2, 2); rect(c, s.dark, x + w - 6, y + h - 3, 2, 2);
      return;
    }
    case "sofa": {
      const cloth = p.item === "sofa_hiendai" ? "#6a7fa8" : s.main;
      outlined(c, cloth, x + 1, y + 2, w - 2, h - 3);
      box(c, p.item === "sofa_hiendai" ? "#4a5f88" : s.dark, back(p.rot, x + 1, y + 2, w - 2, h - 3, 5));
      if (p.rot % 2 === 0) for (let k = x + APT_TILE; k < x + w - 2; k += APT_TILE) rect(c, C.outline, k, y + 7, 1, h - 10);
      else for (let k = y + APT_TILE; k < y + h - 2; k += APT_TILE) rect(c, C.outline, x + 4, k, w - 8, 1);
      return;
    }
    case "lamp": {
      const flick = Math.sin(t / 180) > 0.6 ? 1 : 0;
      c.save(); c.globalAlpha = 0.18; rect(c, "#ffe08a", x - 6, y - 6, w + 12, h + 12); c.restore();
      if (p.item === "lamp_ban") {
        rect(c, C.outline, x + 4, y + 11, 8, 3); rect(c, "#3a3438", x + 5, y + 12, 6, 1);
        rect(c, C.outline, x + 7, y + 5, 2, 7); rect(c, C.outline, x + 5, y + 2, 7, 4); rect(c, "#3d6fd1", x + 6, y + 3, 5, 2);
        rect(c, "#ffe08a", x + 6, y + 6, 5, 1);
      } else if (p.item === "lamp_hoian") {
        rect(c, C.outline, x + 7, y, 2, 2);
        rect(c, C.outline, x + 3, y + 2, 10, 11); rect(c, "#e0a020", x + 4, y + 3, 8, 9);
        rect(c, "#d9362b", x + 4, y + 5, 8, 1); rect(c, "#d9362b", x + 4, y + 9, 8, 1);
        rect(c, "#fff0a0", x + 6, y + 6 + flick, 4, 2); rect(c, "#d9362b", x + 7, y + 13, 2, 3);
      } else if (p.item === "lamp_go") {
        rect(c, C.outline, x + 4, y + 9, 8, 5); rect(c, "#8b5a33", x + 5, y + 10, 6, 3);
        rect(c, C.outline, x + 5, y + 3, 6, 7); rect(c, "#f6e8b0", x + 6, y + 4, 4, 5); rect(c, "#ff9a3a", x + 7, y + 6 - flick, 2, 3);
      } else if (p.item === "lamp_hiendai") {
        rect(c, C.outline, x + 5, y + 11, 6, 3); rect(c, s.dark, x + 7, y + 3, 2, 9);
        rect(c, C.outline, x + 3, y, 10, 6); rect(c, "#ffe08a", x + 4, y + 1, 8, 4);
      } else {
        rect(c, C.outline, x + 3, y + 2, 10, 11); rect(c, C.red, x + 4, y + 3, 8, 9); rect(c, C.gold, x + 4, y + 3, 8, 1); rect(c, C.gold, x + 4, y + 11, 8, 1);
        rect(c, "#ffd070", x + 6, y + 6 + flick, 4, 3); rect(c, C.gold, x + 7, y + 13, 2, 2);
      }
      return;
    }
    case "plant": {
      rect(c, C.outline, x + 4, y + 9, 8, 6); rect(c, p.item === "plant_trau" ? "#e8e0d0" : C.redDark, x + 5, y + 10, 6, 4);
      if (p.item === "plant_lan") {
        rect(c, C.leafDark, x + 5, y + 5, 1, 5); rect(c, C.leafDark, x + 10, y + 4, 1, 6); rect(c, C.leafDark, x + 7, y + 2, 1, 8);
        for (const [dx, dy] of [[3, 3], [7, 1], [10, 2], [12, 4]] as const) { rect(c, "#e8a0d8", x + dx, y + dy, 2, 2); px(c, "#8a3a8a", x + dx, y + dy); }
      } else if (p.item === "plant_xuongrong") {
        rect(c, C.outline, x + 6, y + 1, 4, 9); rect(c, "#4a9a4a", x + 7, y + 2, 2, 8);
        rect(c, C.outline, x + 3, y + 4, 3, 4); rect(c, "#4a9a4a", x + 4, y + 5, 1, 2); rect(c, C.outline, x + 10, y + 3, 3, 4); rect(c, "#4a9a4a", x + 11, y + 4, 1, 2);
        px(c, "#f07aa6", x + 7, y + 1); px(c, "#ffffff", x + 8, y + 4); px(c, "#ffffff", x + 7, y + 7);
      } else if (p.item === "plant_cau") {
        rect(c, C.trunkDark, x + 7, y + 2, 2, 8);
        for (const [dx, dy, dw] of [[2, 1, 5], [9, 1, 5], [3, 3, 4], [9, 3, 4], [6, 0, 4]] as const) rect(c, C.leafDark, x + dx, y + dy, dw, 1);
        px(c, C.leafHi, x + 4, y + 1); px(c, C.leafHi, x + 11, y + 1); px(c, C.gold, x + 7, y + 4); px(c, C.gold, x + 8, y + 5);
      } else if (p.item === "plant_mai") {
        rect(c, C.trunkDark, x + 7, y + 3, 2, 7); rect(c, C.trunkDark, x + 4, y + 4, 4, 1); rect(c, C.trunkDark, x + 9, y + 2, 4, 1);
        for (const [dx, dy] of [[3, 3], [5, 1], [10, 1], [12, 3], [8, 0], [2, 5], [13, 5]] as const) { px(c, C.gold, x + dx, y + dy); px(c, C.goldLight, x + dx + 1, y + dy); }
      } else if (p.item === "plant_trau") {
        for (const [dx, dy] of [[3, 3], [8, 1], [11, 4], [5, 6], [9, 6]] as const) { rect(c, C.leafDark, x + dx, y + dy, 4, 3); px(c, C.leafHi, x + dx + 1, y + dy); }
      } else {
        for (const dx of [5, 8, 11]) { rect(c, C.bamboo, x + dx - 1, y + 1, 2, 9); px(c, C.bambooNode, x + dx - 1, y + 4); rect(c, C.leafLight, x + dx, y, 3, 1); }
      }
      return;
    }
    case "shelf": {
      outlined(c, s.main, x, y + 1, w, h - 2);
      const books = ["#b03a3a", "#3d6fd1", "#e0b040", "#3f8a5a", "#8a4ab0"];
      if (p.rot % 2 === 0) for (let k = 0; k < (w - 6) / 3; k++) rect(c, books[k % books.length], x + 3 + k * 3, y + 4, 2, h - 8);
      else for (let k = 0; k < (h - 6) / 3; k++) rect(c, books[k % books.length], x + 4, y + 3 + k * 3, w - 8, 2);
      return;
    }
    case "tv": {
      // the low cabinet and the screen standing on its back side
      outlined(c, "#5a381e", x + 1, y + 5, w - 2, h - 6);
      // facing the room (rot 0) the set stands up against the wall, taller than the cabinet; turned, it is seen edge-on
      const scr = p.rot === 0 ? { x: x + 3, y: y - 7, w: w - 6, h: 13 } : back(p.rot, x + 2, y + 1, w - 4, h - 3, 6);
      rect(c, C.outline, scr.x, scr.y, scr.w, scr.h);
      const lit = tvOn ? ["#3d86a8", "#e0b040", "#b03a3a", "#5caa4a"][Math.floor(t / 400) % 4] : "#20242c";
      rect(c, lit, scr.x + 1, scr.y + 1, scr.w - 2, scr.h - 2);
      if (tvOn) px(c, "#ffffff", scr.x + 2, scr.y + 2);
      return;
    }
    case "cabinet": { drawCabinetV21(c, p, x, y, w, h, s); return; }
    case "painting": { drawPaintingV21(c, p.item, x, y, w, h, t); return; }
    case "aquarium": { drawAquariumV21(c, p, x, y, w, h, t); return; }
    case "fridge": {
      outlined(c, "#f4f6f8", x + 1, y, w - 2, h - 1);
      rect(c, "#d8dce2", x + 2, y + h - 4, w - 4, 2);
      if (fp.w * fp.h > 1) { if (p.rot % 2 === 0) rect(c, "#c0c6ce", x + w / 2, y + 1, 1, h - 3); else rect(c, "#c0c6ce", x + 2, y + h / 2, w - 4, 1); }
      rect(c, "#868b98", x + (p.rot % 2 === 0 ? 4 : w / 2 - 2), y + (p.rot % 2 === 0 ? h / 2 - 3 : 4), p.rot % 2 === 0 ? 1 : 4, p.rot % 2 === 0 ? 5 : 1);
      rect(c, "#8ac4e0", x + w - 6, y + 3, 3, 2);                                // a magnet
      return;
    }
    default:
  }
}

/** An item alone on a small canvas-sized cell (the shop and the storage list): `size` tiles square. */
export function drawItemIcon(c: Ctx, item: string, size: number): void {
  const f = furnitureOf(item);
  if (!f) return;
  if (f.kind === "wall" || f.kind === "floor") {
    c.save();
    c.scale(size * APT_TILE / ROOM_W, size * APT_TILE / (APT_TILE * 4));
    c.translate(0, f.kind === "floor" ? -APT_TILE * 3 : 0);
    paintRoom(c, f.kind === "wall" ? item : null, f.kind === "floor" ? item : null);
    c.restore();
    return;
  }
  const fp = footprint(item, 0)!;
  const k = size / Math.max(fp.w, fp.h);
  c.save();
  c.translate(((size - fp.w * k) * APT_TILE) / 2, ((size - fp.h * k) * APT_TILE) / 2);
  c.scale(k, k);
  drawItem(c, { id: 0, item, x: 0, y: 0, rot: 0 }, 0, item === "tv");
  c.restore();
}

// ---------------------------------------------------------------- v21 (0074): more furniture and the aquariums

type Box = { main: string; dark: string; light: string };

function drawRugV21(c: Ctx, item: string, x: number, y: number, w: number, h: number): void {
  if (item === "rug_tron") {
    // a round braided rug: rings of colour, corners left bare
    const cx = x + w / 2, cy = y + h / 2, R = Math.min(w, h) / 2 - 1;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const d = Math.hypot(x + i + 0.5 - cx, y + j + 0.5 - cy);
      if (d > R) continue;
      const ring = Math.floor((R - d) / 3);
      px(c, d > R - 1 ? C.outline : ["#c0603a", "#e8c070", "#6a9a8a", "#f4e8d0"][ring % 4], x + i, y + j);
    }
    return;
  }
  // rug_batu: a deep red field, a navy border with a gold line, a medallion and corner motifs
  outlined(c, "#8a1f28", x + 1, y + 1, w - 2, h - 2);
  rect(c, "#1f2a5a", x + 2, y + 2, w - 4, 3); rect(c, "#1f2a5a", x + 2, y + h - 5, w - 4, 3);
  rect(c, "#1f2a5a", x + 2, y + 2, 3, h - 4); rect(c, "#1f2a5a", x + w - 5, y + 2, 3, h - 4);
  rect(c, "#e0b040", x + 5, y + 5, w - 10, 1); rect(c, "#e0b040", x + 5, y + h - 6, w - 10, 1);
  rect(c, "#e0b040", x + 5, y + 5, 1, h - 10); rect(c, "#e0b040", x + w - 6, y + 5, 1, h - 10);
  const mx = x + w / 2, my = y + h / 2;
  for (let k = 0; k < 7; k++) { rect(c, "#e0b040", mx - k, my - 6 + k, 2 * k, 1); rect(c, "#e0b040", mx - k, my + 6 - k, 2 * k, 1); }
  rect(c, "#1f2a5a", mx - 3, my - 2, 6, 4); px(c, "#f4e8d0", mx - 1, my - 1); px(c, "#f4e8d0", mx, my);
  for (const [dx, dy] of [[8, 8], [w - 10, 8], [8, h - 10], [w - 10, h - 10]] as const) { rect(c, "#e0b040", x + dx, y + dy, 2, 2); }
  for (let k = x + 2; k < x + w - 2; k += 2) { px(c, "#f4e8d0", k, y); px(c, "#f4e8d0", k, y + h - 1); }   // the fringe
}

function bedExtrasV21(c: Ctx, p: Placed, x: number, y: number, w: number, h: number, s: Box): void {
  if (p.item === "bed_tang") {
    // the upper bunk's rails (two long sides) and a ladder at the foot
    const vert = p.rot % 2 === 0;
    if (vert) { rect(c, s.dark, x + 1, y + 7, 2, h - 9); rect(c, s.dark, x + w - 3, y + 7, 2, h - 9); }
    else { rect(c, s.dark, x + 7, y + 1, w - 9, 2); rect(c, s.dark, x + 7, y + h - 3, w - 9, 2); }
    const lx = vert ? x + w - 7 : x + (p.rot === 1 ? 2 : w - 7), ly = vert ? y + (p.rot === 0 ? h - 9 : 3) : y + 4;
    rect(c, C.outline, lx, ly, 5, 7); rect(c, s.light, lx + 1, ly + 1, 3, 1); rect(c, s.light, lx + 1, ly + 3, 3, 1); rect(c, s.light, lx + 1, ly + 5, 3, 1);
    return;
  }
  // bed_doi: a second pillow and a flowered blanket
  const pil = p.rot % 2 === 0 ? { x: x + w / 2 + 1, y: p.rot === 0 ? y + 5 : y + h - 12, w: w / 2 - 6, h: 7 } : { x: p.rot === 1 ? x + w - 12 : x + 5, y: y + h / 2 + 1, w: 7, h: h / 2 - 6 };
  rect(c, "#ffffff", pil.x, pil.y, pil.w, pil.h);
  for (let k = 0; k < 6; k++) {
    const fx = x + 6 + ((k * 13) % Math.max(1, w - 12)), fy = y + 8 + ((k * 7) % Math.max(1, h - 16));
    px(c, "#f07aa6", fx, fy); px(c, "#f6d24a", fx + 1, fy); px(c, "#f07aa6", fx, fy + 1);
  }
}

function drawCabinetV21(c: Ctx, p: Placed, x: number, y: number, w: number, h: number, s: Box): void {
  // a tall wardrobe seen from the front: it rises above its tile against the wall behind it
  const up = p.rot === 0 ? 10 : 0;
  outlined(c, p.item === "cabinet_hiendai" ? "#eef0f4" : s.main, x + 1, y - up, w - 2, h + up - 1);
  if (p.item === "cabinet_hiendai") {
    rect(c, "#a8d0e0", x + 3, y - up + 2, w / 2 - 4, h + up - 6); rect(c, "#a8d0e0", x + w / 2 + 1, y - up + 2, w / 2 - 4, h + up - 6);
    rect(c, "#d8f0f8", x + 4, y - up + 3, 1, 5); rect(c, "#868b98", x + w / 2 - 1, y - up + 4, 2, 3);
  } else if (p.item === "cabinet_maytre") {
    for (let k = y - up + 2; k < y + h - 3; k += 2) rect(c, s.dark, x + 3, k, w - 6, 1);
    rect(c, "#5a381e", x + w / 2 - 1, y + 1, 2, 2);
  } else {
    rect(c, s.dark, x + w / 2, y - up + 1, 1, h + up - 3);
    rect(c, s.light, x + 3, y - up + 3, w / 2 - 5, 2); rect(c, s.light, x + w / 2 + 2, y - up + 3, w / 2 - 5, 2);
    rect(c, C.gold, x + w / 2 - 2, y - up + (h + up) / 2, 1, 2); rect(c, C.gold, x + w / 2 + 2, y - up + (h + up) / 2, 1, 2);
  }
  rect(c, s.dark, x + 2, y + h - 2, 2, 2); rect(c, s.dark, x + w - 4, y + h - 2, 2, 2);
}

function drawPaintingV21(c: Ctx, item: string, x: number, y: number, w: number, h: number, t: number): void {
  // a framed canvas on a small easel
  rect(c, "#5a381e", x + 3, y + h - 6, 2, 6); rect(c, "#5a381e", x + w - 5, y + h - 6, 2, 6); rect(c, "#5a381e", x + w / 2 - 1, y + h - 4, 2, 4);
  const fx = x + 1, fy = y - 8, fw = w - 2, fh = h + 1;
  rect(c, C.outline, fx, fy, fw, fh); rect(c, item === "painting_pho" ? "#3a3438" : "#c09040", fx + 1, fy + 1, fw - 2, fh - 2);
  const ix = fx + 2, iy = fy + 2, iw = fw - 4, ih = fh - 4;
  if (item === "painting_sen") {
    rect(c, "#e8dcb8", ix, iy, iw, ih);
    rect(c, "#3f8a5a", ix + 2, iy + ih - 5, iw - 4, 2);
    for (const dx of [4, iw / 2, iw - 6]) { rect(c, "#2e6a44", ix + dx, iy + 5, 1, ih - 8); rect(c, "#f07aa6", ix + dx - 1, iy + 3, 3, 3); px(c, "#ffffff", ix + dx, iy + 3); }
  } else if (item === "painting_pho") {
    rect(c, "#f0b070", ix, iy, iw, ih / 2); rect(c, "#c87858", ix, iy + ih / 2, iw, ih - ih / 2);
    for (let k = 0; k < iw - 2; k += 5) { rect(c, ["#e0b040", "#d9362b", "#3d6fd1"][(k / 5) % 3], ix + k + 1, iy + 4, 4, ih - 5); rect(c, "#5a381e", ix + k + 1, iy + 3, 4, 1); }
    const glow = Math.floor(t / 500) % 2;
    for (let k = 2; k < iw - 2; k += 4) px(c, glow ? "#ffe08a" : "#f6d24a", ix + k, iy + 1);
  } else {
    rect(c, "#8ac4e0", ix, iy, iw, ih / 2); rect(c, "#2f86d6", ix, iy + ih / 2, iw, ih - ih / 2);
    rect(c, "#f6d24a", ix + iw - 5, iy + 1, 3, 3); rect(c, "#ffffff", ix + 2, iy + ih / 2, 4, 1);
    rect(c, "#e8d8a8", ix, iy + ih - 2, iw, 2);
  }
}

/** What swims in each tank (furniture_items id → the fish and the decorations), set by the interior from aquarium_view. */
export interface TankLook { decor: readonly string[]; fish: ReadonlyArray<{ speciesId: string; rarity: number }> }
const TANKS = new Map<number, TankLook>();
export function setTankContents(m: ReadonlyMap<number, TankLook> | null): void {
  TANKS.clear();
  if (m) for (const [k, v] of m) TANKS.set(k, v);
}

function drawAquariumV21(c: Ctx, p: Placed, x: number, y: number, w: number, h: number, t: number): void {
  // a glass tank on a low cabinet; the glass rises above the tile like the TV's screen
  outlined(c, "#5a381e", x + 1, y + 6, w - 2, h - 6);
  const gx = x + 2, gy = y - 10, gw = w - 4, gh = 17;
  rect(c, C.outline, gx - 1, gy - 1, gw + 2, gh + 2);
  rect(c, "#3d86a8", gx, gy, gw, gh);
  rect(c, "#5aa8c8", gx, gy, gw, 3);                                              // lit surface
  rect(c, "#e8d8a8", gx, gy + gh - 3, gw, 3);                                     // sand
  const look = TANKS.get(p.id);
  const decor = look?.decor ?? [];
  // decorations stand on the sand
  let dx = gx + 2;
  for (const d of decor) {
    if (d === "rong") { for (let k = 0; k < 3; k++) { const sway = Math.round(Math.sin(t / 400 + k) * 1); rect(c, "#2e8a4a", dx + k * 2 + sway, gy + gh - 9 + k, 1, 7 - k); } dx += 7; }
    else if (d === "da") { rect(c, "#8a8a8a", dx, gy + gh - 5, 4, 2); rect(c, "#b0b0b0", dx + 1, gy + gh - 6, 2, 1); dx += 6; }
    else if (d === "san_ho") { rect(c, "#f07a6a", dx + 1, gy + gh - 8, 1, 5); rect(c, "#f07a6a", dx, gy + gh - 6, 3, 1); rect(c, "#f07a6a", dx + 3, gy + gh - 7, 1, 3); dx += 6; }
    else if (d === "ruong") { rect(c, C.outline, dx, gy + gh - 6, 6, 4); rect(c, "#a8743f", dx + 1, gy + gh - 5, 4, 2); px(c, C.gold, dx + 3, gy + gh - 5); if (Math.floor(t / 900) % 3 === 0) px(c, "#ffffff", dx + 2, gy + gh - 8 - Math.floor(t / 300) % 4); dx += 8; }
    else if (d === "lau_dai") { rect(c, "#c8a878", dx, gy + gh - 9, 7, 7); rect(c, "#c8a878", dx, gy + gh - 11, 2, 2); rect(c, "#c8a878", dx + 5, gy + gh - 11, 2, 2); rect(c, "#5a381e", dx + 3, gy + gh - 6, 1, 3); dx += 9; }
    if (dx > gx + gw - 6) break;
  }
  // the fish swim back and forth, each on its own lane and speed; rare ones sparkle
  const fish = look?.fish ?? [];
  fish.forEach((f, i) => {
    const lane = gy + 4 + ((i * 5) % Math.max(1, gh - 9));
    const speed = 0.012 + (i % 3) * 0.006;
    const span = Math.max(1, gw - 6);
    const ph = (t * speed + i * 17) % (2 * span);
    const right = ph < span;
    const fx = gx + 1 + Math.round(right ? ph : 2 * span - ph);
    const bob = Math.round(Math.sin(t / 300 + i) * 1);
    const pal = FISH_ICONS[f.speciesId]?.pal ?? {};
    const body = pal.b ?? "#e0a040", belly = pal.w ?? "#f4e8d0";
    rect(c, body, fx, lane + bob, 4, 2); px(c, belly, fx + 1, lane + bob + 1);
    px(c, body, right ? fx - 1 : fx + 4, lane + bob - (Math.floor(t / 150) % 2)); px(c, body, right ? fx - 1 : fx + 4, lane + bob + 1);
    px(c, "#1a1410", right ? fx + 3 : fx, lane + bob);
    if (f.rarity >= 4 && Math.floor(t / 250 + i) % 4 === 0) px(c, "#ffffff", fx + 2, lane + bob - 2);
  });
  // bubbles and the glass's shine
  for (let k = 0; k < 3; k++) { const by = gy + gh - 4 - Math.floor((t / 90 + k * 6) % (gh - 4)); px(c, "#d8f0f8", gx + gw - 3 - (k % 2), by); }
  rect(c, "#d8f0f8", gx + 1, gy + 4, 1, 4);
}