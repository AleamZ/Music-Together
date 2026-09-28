import { C, rect, type Ctx } from "@/lib/game/maps/scene-art";

// v21 economy: the header art of the Chợ người chơi panel and of chú Bảy's row of rented stalls — six little stalls
// under striped awnings (a rented one shows its goods, a free one a "CHO THUÊ" board), string lights and a sale board
// with pinned notes (one per listing, up to 8). Original pixel art in the chibi world's palette.

export const ECON_W = 200;
export const ECON_H = 64;

const K = {
  sky: "#f6e2b8", skyDark: "#ecd09a", ground: "#b89a6a", groundDark: "#9a7e52",
  wood: "#8a5a34", woodDark: "#6a4224", woodLight: "#a8743e", cloth: "#f6ecd0",
  bulbOn: "#ffd86a", bulbOff: "#b89a5a", wire: "#4a3a2a", note: "#fbf3dc", pin: "#d8403a",
  fish: "#6aa0c8", shirt: "#d86a8a", potato: "#b88a4a", sign: "#e8d6b0",
};
const AWNINGS: ReadonlyArray<[string, string]> = [
  ["#d8403a", "#f6ecd0"], ["#2e9a94", "#f6ecd0"], ["#e0a030", "#f6ecd0"],
  ["#6a5aa8", "#f6ecd0"], ["#3f8a5a", "#f6ecd0"], ["#b0503a", "#f6ecd0"],
];

/** Paint the stall row at time `t` (ms; 0 is still). `rented[i]` says whether stall i+1 is taken; `notes` pins notes. */
export function paintStallRow(c: Ctx, t: number, rented: readonly boolean[], notes: number): void {
  rect(c, K.sky, 0, 0, ECON_W, 40);
  rect(c, K.skyDark, 0, 30, ECON_W, 10);
  rect(c, K.ground, 0, 40, ECON_W, ECON_H - 40);
  for (let x = 0; x < ECON_W; x += 16) rect(c, K.groundDark, x, 40, 1, ECON_H - 40);

  // string lights overhead, twinkling in turn
  rect(c, K.wire, 0, 4, ECON_W, 1);
  for (let i = 0; i < 20; i++) {
    const on = t === 0 || Math.floor(t / 400 + i) % 3 !== 0;
    rect(c, on ? K.bulbOn : K.bulbOff, 4 + i * 10, 5, 2, 2);
  }

  // the sale board on the left: notes pinned on cork
  rect(c, C.outline, 3, 12, 30, 26); rect(c, K.woodLight, 4, 13, 28, 24);
  for (let i = 0; i < Math.min(8, notes); i++) {
    const x = 6 + (i % 4) * 6, y = 15 + Math.floor(i / 4) * 10;
    rect(c, K.note, x, y, 5, 7); rect(c, K.pin, x + 2, y, 1, 1);
  }
  rect(c, K.wood, 8, 38, 2, 10); rect(c, K.wood, 26, 38, 2, 10);

  // six stalls
  for (let i = 0; i < 6; i++) {
    const x = 38 + i * 27;
    const [a, b] = AWNINGS[i];
    // awning stripes and scallops
    for (let s = 0; s < 24; s += 4) rect(c, s % 8 === 0 ? a : b, x + s, 14, 4, 6);
    for (let s = 0; s < 24; s += 4) rect(c, s % 8 === 0 ? a : b, x + s + 1, 20, 2, 1);
    rect(c, C.outline, x, 13, 24, 1);
    // posts and counter
    rect(c, K.woodDark, x + 1, 20, 1, 24); rect(c, K.woodDark, x + 22, 20, 1, 24);
    rect(c, K.wood, x, 36, 24, 8); rect(c, K.woodLight, x, 36, 24, 1); rect(c, K.woodDark, x, 43, 24, 1);
    if (rented[i]) {
      // goods on the counter: a fish, a folded shirt, a sack of potatoes
      rect(c, K.fish, x + 3, 33, 5, 2); rect(c, K.fish, x + 8, 32, 1, 4);
      rect(c, K.shirt, x + 10, 32, 5, 4); rect(c, K.cloth, x + 12, 32, 1, 1);
      rect(c, K.potato, x + 17, 31, 4, 5); rect(c, K.woodDark, x + 18, 31, 2, 1);
    } else {
      // the "CHO THUÊ" board
      rect(c, C.outline, x + 5, 25, 14, 9); rect(c, K.sign, x + 6, 26, 12, 7);
      rect(c, K.woodDark, x + 8, 28, 8, 1); rect(c, K.woodDark, x + 8, 30, 6, 1);
    }
    // the stall's number plate
    rect(c, K.cloth, x + 10, 45, 4, 4);
    for (let k = 0; k <= i; k++) rect(c, C.outline, x + 10 + (k % 3), 46 + Math.floor(k / 3) * 2, 1, 1);
  }
}
