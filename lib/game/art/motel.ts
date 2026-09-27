import { MOTEL_FRONT } from "@/lib/game/maps/market";
import { openFront, roof, text, textW } from "@/lib/game/maps/market-kit";
import { C, px, rect, type Ctx } from "@/lib/game/maps/scene-art";

// v19.1: cô Hồng's "Nhà nghỉ Hoa Sen" — since the market redo a two-storey building on Chợ Lớn's north row (pink front,
// neon board, curtained windows, the lobby desk below), painted into the market's background; and the private room
// (bed, fan, lamp, window), drawn in the room view. Original art.

const K = {
  wall: "#e8b4b0", wallDark: "#c88c8a", wallLight: "#f4ccc6",
  tile: "#8a3a2a", tileLight: "#b0503a", tileDark: "#5e2a20",
  glass: "#f6d890", glassDim: "#c9a860", frame: "#6e4a28",
  neon: "#ff5fa2", neonHot: "#ffd0e6", neonBox: "#2a1a2a",
  desk: "#9a6a3a", deskDark: "#6e4a28", deskLight: "#b8844c",
  rail: "#3a3a44", key: "#e8c040", lotus: "#f08ab0", leaf: "#3f8a5a",
};

/** 3×5 letters for the neon sign (no diacritics at this size). */
const FONT: Record<string, string[]> = {
  N: ["##.", "#.#", "#.#", "#.#", "#.#"], H: ["#.#", "#.#", "###", "#.#", "#.#"], A: [".#.", "#.#", "###", "#.#", "#.#"],
  G: ["###", "#..", "#.#", "#.#", "###"], I: ["###", ".#.", ".#.", ".#.", "###"],
};

function letter(c: Ctx, col: string, ch: string, x: number, y: number): void {
  const g = FONT[ch];
  if (!g) return;
  g.forEach((row, j) => { for (let i = 0; i < 3; i++) if (row.charAt(i) === "#") px(c, col, x + i, y + j); });
}

// ---------------------------------------------------------------- the building (market redo)

const MOTEL_SIGN = "NHA NGHI HOA SEN";
/** Where the neon board's letters start (world px), shared with the flicker. */
const SIGN_AT = { x: MOTEL_FRONT.x + Math.floor((MOTEL_FRONT.w - textW(MOTEL_SIGN) - 14) / 2) + 7, y: MOTEL_FRONT.y + 26 };

/** A window with pink curtains drawn to the sides, lit from inside. */
function curtainWindow(c: Ctx, x: number, y: number, w: number, h: number): void {
  rect(c, C.outline, x - 1, y - 1, w + 2, h + 2);
  rect(c, K.frame, x, y, w, h);
  rect(c, K.glass, x + 1, y + 1, w - 2, h - 2); rect(c, "#fff4d0", x + 3, y + 2, 2, h - 6);
  rect(c, K.glassDim, x + 1, y + h - 5, w - 2, 4);
  for (const cx of [x + 1, x + w - 6]) {
    rect(c, "#d4758f", cx, y + 1, 5, h - 2); rect(c, "#b0506e", cx + 2, y + 1, 1, h - 2);
    rect(c, K.key, cx, y + Math.floor(h / 2), 5, 1);                            // the tie-back
  }
  rect(c, "#b0506e", x + 1, y + 1, w - 2, 2);                                     // the valance
  rect(c, C.outline, x - 2, y + h + 1, w + 4, 2);
}

/** cô Hồng's "Nhà nghỉ Hoa Sen" as a two-storey building on the north row: a pink front under a tiled roof, the neon
 *  "NHA NGHI HOA SEN" board, four curtained windows over a balcony rail upstairs, a vertical neon blade, curtained
 *  windows either side of the small lobby where she stands behind the desk. World coordinates. */
export function paintMotelFront(c: Ctx): void {
  const { x, y, w, h } = MOTEL_FRONT, b = y + h;
  roof(c, x - 4, y, w + 8, 18, K.tile, K.tileDark, K.tileLight);
  rect(c, C.outline, x, y + 19, w, h - 19);
  rect(c, K.wall, x + 1, y + 19, w - 2, h - 20);
  rect(c, K.wallLight, x + 1, y + 19, w - 2, 2);
  rect(c, K.wallDark, x + 1, b - 6, w - 2, 5);
  // the neon board
  const tw = textW(MOTEL_SIGN) + 14, sx = SIGN_AT.x - 7, sy = SIGN_AT.y - 4;
  rect(c, C.outline, sx, sy, tw, 13); rect(c, K.neonBox, sx + 1, sy + 1, tw - 2, 11);
  neonText(c, SIGN_AT.x, SIGN_AT.y, MOTEL_SIGN, K.neon);
  // upstairs: four curtained windows over a balcony rail with potted lotus
  for (let k = 0; k < 4; k++) curtainWindow(c, x + 12 + k * 38, y + 42, 22, 16);
  rect(c, K.rail, x + 4, y + 62, w - 8, 1); rect(c, K.rail, x + 4, y + 68, w - 8, 1);
  for (let i = x + 4; i < x + w - 3; i += 4) rect(c, K.rail, i, y + 62, 1, 7);
  for (const px0 of [x + 40, x + 116]) { rect(c, K.deskDark, px0, y + 65, 6, 4); rect(c, K.leaf, px0 - 1, y + 62, 8, 3); rect(c, K.lotus, px0 + 2, y + 60, 2, 3); }
  rect(c, K.wallDark, x + 1, y + 70, w - 2, 3);                                  // the floor line
  // the lobby: a lintel, the key board, a corridor, a clock
  rect(c, C.outline, x + 42, y + 74, 76, 4); rect(c, K.deskDark, x + 43, y + 75, 74, 2);
  openFront(c, x + 44, y + 78, 72, b);
  rect(c, C.outline, x + 47, y + 82, 20, 14); rect(c, K.deskLight, x + 48, y + 83, 18, 12);
  for (let k = 0; k < 6; k++) rect(c, K.key, x + 50 + (k % 3) * 6, y + 85 + Math.floor(k / 3) * 5, 1, 2);
  rect(c, "#2e1e18", x + 96, y + 82, 16, b - y - 88); rect(c, K.glassDim, x + 98, y + 84, 12, 2);
  rect(c, C.outline, x + 84, y + 80, 7, 7); rect(c, C.white, x + 85, y + 81, 5, 5); px(c, C.outline, x + 87, y + 82); px(c, C.outline, x + 88, y + 83);
  for (let i = 0; i < 72; i += 4) rect(c, (i / 4) % 2 ? "#e8d8c8" : "#c8a8a0", x + 44 + i, b - 6, 4, 6);
  // ground-floor windows either side, curtained
  curtainWindow(c, x + 8, y + 84, 28, 22); curtainWindow(c, x + 122, y + 84, 22, 22);
  // a potted lotus by the lobby
  rect(c, C.outline, x + 37, b - 14, 6, 8); rect(c, "#3d6fd1", x + 38, b - 13, 4, 7); rect(c, K.leaf, x + 37, b - 17, 6, 3); rect(c, K.lotus, x + 39, b - 19, 2, 2);
  // the vertical neon blade on the east corner
  const bx = x + w - 10, by = y + 76;
  rect(c, C.outline, bx - 1, by - 1, 9, 46); rect(c, K.neonBox, bx, by, 7, 44);
  "NGHI".split("").forEach((ch, i) => letter(c, K.neon, ch, bx + 2, by + 3 + i * 10));
  for (let k = 0; k < 4; k++) px(c, K.neonHot, bx + 3, by + 9 + k * 10);
}

function neonText(c: Ctx, x: number, y: number, s: string, col: string): void {
  text(c, "#7a2a50", s, x + 1, y + 1);                                            // the glow under the tubes
  text(c, col, s, x, y);
}

/** The neon board flickering now and then: "HOA SEN" drops out for a blink (animated layer). */
export function drawMotelNeon(c: Ctx, t: number, camX: number, camY: number): void {
  const ph = t % 5200;
  if (!(ph < 90 || (ph > 180 && ph < 260))) return;
  const off = textW("NHA NGHI ") + 1;
  const x = SIGN_AT.x + off - camX, y = SIGN_AT.y - camY;
  rect(c, K.neonBox, x - 1, y - 1, textW("HOA SEN") + 3, 7);
  text(c, "#5a2040", "HOA SEN", x, y);
}

// ---------------------------------------------------------------- the room (a private view, not a map)

export const ROOM_W = 160;
export const ROOM_H = 104;
/** Where the guest stands in the room view (feet), and where the bed's pillow is. */
export const ROOM_STAND = { x: 104, y: 92 };
export const ROOM_BED = { x: 16, y: 52, w: 56, h: 36 };

export interface RoomLookColors { skin: string; hair: string }

/** The room: tiled floor, wall with a window (night outside), ceiling fan, a lamp, the bed, and — while asleep — me under
 *  the blanket with drifting Zzz. `t` (ms) animates the fan and the Zzz; `dark` 0…1 dims the lights for the cutscene. */
export function paintMotelRoom(c: Ctx, t: number, sleeper: RoomLookColors | null, dark = 0): void {
  // wall and floor
  rect(c, "#d9c6a8", 0, 0, ROOM_W, 60);
  rect(c, "#c4ae8c", 0, 56, ROOM_W, 4);
  for (let yy = 60; yy < ROOM_H; yy += 8) for (let xx = (yy / 8) % 2 ? 0 : 8; xx < ROOM_W; xx += 16) {
    rect(c, "#b88a64", xx, yy, 8, 8); rect(c, "#a47a58", xx + 8, yy, 8, 8);
  }
  // window with the night and a moon
  rect(c, C.outline, 99, 11, 42, 30); rect(c, K.frame, 100, 12, 40, 28);
  rect(c, "#1e2a4a", 102, 14, 36, 24); rect(c, "#2a3a60", 102, 30, 36, 8);
  rect(c, "#f4ecc0", 128, 17, 5, 5); px(c, "#1e2a4a", 131, 17);
  for (const [sx, sy] of [[106, 18], [114, 22], [122, 16], [110, 28]] as const) px(c, "#f4ecc0", sx, sy);
  rect(c, K.frame, 119, 14, 2, 24);
  rect(c, "#d4758f", 96, 10, 4, 34); rect(c, "#d4758f", 140, 10, 4, 34);          // curtains
  // a framed lotus picture
  rect(c, C.outline, 36, 12, 22, 16); rect(c, "#f4ead0", 37, 13, 20, 14);
  rect(c, K.leaf, 40, 21, 14, 3); rect(c, K.lotus, 45, 16, 4, 5);
  // ceiling fan
  const a = Math.floor(t / 90) % 2;
  rect(c, "#6a6e7a", 79, 0, 2, 5); rect(c, "#50545e", 77, 5, 6, 2);
  if (a) { rect(c, "#868b98", 64, 5, 13, 2); rect(c, "#868b98", 83, 5, 13, 2); }
  else { rect(c, "#868b98", 68, 4, 9, 2); rect(c, "#868b98", 83, 6, 9, 2); }
  // bedside table and lamp
  rect(c, C.outline, 75, 60, 16, 16); rect(c, K.desk, 76, 61, 14, 14); rect(c, K.deskDark, 76, 67, 14, 1);
  rect(c, C.outline, 80, 50, 6, 10); rect(c, "#f6c36a", 81, 51, 4, 6); rect(c, K.deskDark, 82, 57, 2, 3);
  // the bed: headboard, mattress, pillow, blanket
  const b = ROOM_BED;
  rect(c, C.outline, b.x - 1, b.y - 12, 8, b.h + 13); rect(c, K.deskDark, b.x, b.y - 11, 6, b.h + 11);
  rect(c, C.outline, b.x + 5, b.y - 1, b.w - 4, b.h + 2);
  rect(c, "#f4f1ea", b.x + 6, b.y, b.w - 6, b.h);
  rect(c, "#ffffff", b.x + 8, b.y + 8, 12, 18);                                    // pillow
  rect(c, "#d8d4c8", b.x + 8, b.y + 24, 12, 2);
  rect(c, "#3d6fd1", b.x + 24, b.y + 2, b.w - 26, b.h - 4);                        // blanket
  rect(c, "#2e58a8", b.x + 24, b.y + 2, 3, b.h - 4);
  for (let k = b.x + 30; k < b.x + b.w - 4; k += 7) rect(c, "#5a8ae0", k, b.y + 4, 1, b.h - 8);
  if (sleeper) {
    // my head on the pillow, the blanket pulled up
    rect(c, C.outline, b.x + 10, b.y + 11, 12, 11);
    rect(c, sleeper.skin, b.x + 11, b.y + 12, 10, 9);
    rect(c, sleeper.hair, b.x + 11, b.y + 12, 4, 9);
    rect(c, C.outline, b.x + 17, b.y + 15, 2, 1); rect(c, C.outline, b.x + 17, b.y + 18, 2, 1);   // closed eyes
    rect(c, "#2e58a8", b.x + 22, b.y + 6, 6, b.h - 12);                                            // the lump
    rect(c, "#3d6fd1", b.x + 28, b.y + 8, 18, b.h - 16);
  }
  if (dark > 0) {
    c.save();
    c.globalAlpha = Math.min(1, dark) * 0.78;
    rect(c, "#0a0c1e", 0, 0, ROOM_W, ROOM_H);
    c.restore();
    if (dark > 0.4) { rect(c, "#f4ecc0", 128, 17, 5, 5); }                         // the moon stays bright
  }
  if (sleeper) for (let k = 0; k < 3; k++) {                                       // Zzz over the dark
    const ph = ((t / 1400 + k / 3) % 1);
    const zx = b.x + 20 + Math.round(ph * 22 + k * 2), zy = b.y + 6 - Math.round(ph * 22);
    if (ph < 0.9) zed(c, zx, zy, ph < 0.5 ? 3 : 4);
  }
}

function zed(c: Ctx, x: number, y: number, s: number): void {
  rect(c, "#ffffff", x, y, s, 1); rect(c, "#ffffff", x, y + s - 1, s, 1);
  for (let i = 1; i < s - 1; i++) px(c, "#ffffff", x + s - 1 - i, y + i);
}
