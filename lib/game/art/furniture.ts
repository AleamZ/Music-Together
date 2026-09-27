import { APT_COLS, APT_ROWS, APT_TILE, APT_WALL_ROWS, footprint, furnitureOf, type FurnitureStyle, type Placed } from "@/lib/game/housing/apartment";
import { C, px, rect, type Ctx } from "@/lib/game/maps/scene-art";

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
      if (p.item === "lamp_go") {
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
      if (p.item === "plant_mai") {
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
