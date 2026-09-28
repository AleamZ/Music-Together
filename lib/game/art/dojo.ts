import { VO_DUONG_AWNING, VO_DUONG_FRONT } from "@/lib/game/maps/market";
import { roof, text, textW } from "@/lib/game/maps/market-kit";
import { C, px, rect, type Ctx } from "@/lib/game/maps/scene-art";

// v20.2: "Võ đường Chợ Lớn" on the market's south side (spec §v20.2 "Placement"), painted into the market background:
// a tiled gate roof on red posts over the pavement (the awning — shade), the red board "VÕ ĐƯỜNG" in gold, two stone
// lions guarding the gate, whitewashed compound walls under a long tiled roof, and through the open gate a glimpse of
// the wood-floored hall with a drum and a weapon rack. Original pixel art.

const K = {
  tile: "#6e2f24", tileDark: "#4a1e18", tileLight: "#8e4332",
  wall: "#efe6d2", wallDark: "#d2c6ac", trim: "#a8281e", trimDark: "#78180f",
  post: "#b3261c", postDark: "#7c1812", board: "#9e1f18", gold: "#f2c84a", goldDark: "#b88a22",
  floor: "#b27a45", floorDark: "#8e5c32", floorLight: "#c8904f", inside: "#3a2418",
  stone: "#a7a39b", stoneDark: "#7b776f", stoneLight: "#c9c5bc",
};

/** A stone lion on its plinth, facing the street (x = its centre, y = the plinth's foot). */
function lion(c: Ctx, x: number, y: number, flip: boolean): void {
  const s = flip ? -1 : 1;
  rect(c, C.outline, x - 7, y - 5, 14, 5); rect(c, K.stoneDark, x - 6, y - 4, 12, 3);
  // body and haunch
  rect(c, C.outline, x - 6, y - 14, 12, 10); rect(c, K.stone, x - 5, y - 13, 10, 8);
  rect(c, K.stoneDark, x - 5 + (flip ? 6 : 0), y - 12, 4, 7);
  // the head with its curly mane
  rect(c, C.outline, x - 5 + s, y - 22, 10, 9); rect(c, K.stone, x - 4 + s, y - 21, 8, 7);
  for (let k = 0; k < 4; k++) px(c, K.stoneLight, x - 4 + s + k * 2, y - 21);
  px(c, C.outline, x - 2 + s, y - 18); px(c, C.outline, x + 1 + s, y - 18);
  rect(c, K.stoneDark, x - 2 + s, y - 16, 4, 1);
  // a paw on the ball
  rect(c, C.outline, x + 2 * s - 2, y - 9, 5, 5); rect(c, K.stoneLight, x + 2 * s - 1, y - 8, 3, 3);
}

/** The board's text with its diacritics drawn in (the market font has none). */
function boardText(c: Ctx, x: number, y: number): void {
  text(c, K.gold, "VO DUONG", x, y);
  // Õ: a tilde over the O; Đ: the bar; Ư, Ờ: the horns; Ờ: the grave accent
  px(c, K.gold, x + 4, y - 2); px(c, K.gold, x + 5, y - 3); px(c, K.gold, x + 6, y - 2);
  px(c, K.gold, x + 11, y + 2);
  px(c, K.gold, x + 19, y - 1);
  px(c, K.gold, x + 23, y - 1);
  px(c, K.gold, x + 21, y - 3);
}

export function paintDojoFront(c: Ctx): void {
  const { x, y, w, h } = VO_DUONG_FRONT, b = y + h;
  const gate = { x: x + 96, w: 48 };
  // the long roof of the compound, behind the gate
  roof(c, x - 4, y, w + 8, 20, K.tile, K.tileDark, K.tileLight);
  // the whitewashed walls with a red trim and small round windows
  rect(c, C.outline, x, y + 20, w, h - 20);
  rect(c, K.wall, x + 1, y + 21, w - 2, h - 22);
  rect(c, K.wallDark, x + 1, b - 8, w - 2, 7);
  rect(c, K.trim, x + 1, y + 21, w - 2, 3);
  rect(c, K.trimDark, x + 1, y + 24, w - 2, 1);
  for (const wx of [x + 26, x + 62, x + w - 76, x + w - 40]) {
    rect(c, C.outline, wx - 1, y + 38, 16, 16); rect(c, K.trimDark, wx, y + 39, 14, 14);
    for (let k = 0; k < 3; k++) rect(c, K.wallDark, wx + 2 + k * 4, y + 41, 2, 10);
    rect(c, K.gold, wx + 5, y + 45, 4, 2);
  }
  // the open gate: a glimpse of the hall's wood floor, a drum and a rack of staffs
  rect(c, C.outline, gate.x - 1, y + 18, gate.w + 2, b - y - 18);
  rect(c, K.inside, gate.x, y + 19, gate.w, 26);
  for (let yy = y + 45; yy < b - 1; yy++) rect(c, (yy - y) % 6 === 0 ? K.floorDark : (yy - y) % 12 < 6 ? K.floor : K.floorLight, gate.x, yy, gate.w, 1);
  rect(c, "#8a1e18", gate.x + 30, y + 30, 12, 12); rect(c, "#e8d8b0", gate.x + 33, y + 34, 6, 4);
  rect(c, K.floorDark, gate.x + 32, y + 42, 2, 4); rect(c, K.floorDark, gate.x + 38, y + 42, 2, 4);
  for (let k = 0; k < 4; k++) rect(c, k % 2 ? "#c8a36a" : "#a8834a", gate.x + 5 + k * 4, y + 22, 2, 22);
  // the gate roof on its red posts, reaching over the pavement (the awning in _in_shade)
  const a = VO_DUONG_AWNING;
  for (const px0 of [a.x + 8, a.x + a.w - 12]) {
    rect(c, C.outline, px0 - 1, a.y + 14, 6, y + 30 - a.y - 14);
    rect(c, K.post, px0, a.y + 14, 4, y + 29 - a.y - 14);
    rect(c, K.postDark, px0 + 3, a.y + 14, 1, y + 29 - a.y - 14);
    rect(c, C.outline, px0 - 2, y + 26, 8, 4); rect(c, K.stoneDark, px0 - 1, y + 27, 6, 2);
  }
  roof(c, a.x - 6, a.y - 4, a.w + 12, 18, K.tile, K.tileDark, K.tileLight);
  // upturned eaves
  for (const [ex, dir] of [[a.x - 6, -1], [a.x + a.w + 5, 1]] as const) {
    px(c, C.outline, ex, a.y - 5); px(c, C.outline, ex + dir, a.y - 6); px(c, K.tileLight, ex, a.y - 4);
  }
  // the board "VÕ ĐƯỜNG"
  const tw = textW("VO DUONG") + 12, bx = a.x + Math.floor((a.w - tw) / 2), by = a.y + 16;
  rect(c, C.outline, bx, by, tw, 13); rect(c, K.board, bx + 1, by + 1, tw - 2, 11);
  rect(c, K.goldDark, bx + 2, by + 2, tw - 4, 1); rect(c, K.goldDark, bx + 2, by + 10, tw - 4, 1);
  boardText(c, bx + 6, by + 5);
  // the lions either side of the gate
  lion(c, gate.x - 16, y + 30, false);
  lion(c, gate.x + gate.w + 16, y + 30, true);
}
