import type { PixelIcon } from "./icons";

// 0123: 16×16 icons for the forest (original art, drawn from a few primitives): logs by tree kind, the wild goods,
// the ten dishes, the bows / pans / axes / saw by tier, the traps and the charcoal. Each icon is painted into a 16×16
// letter grid with its own palette, then outlined ("o" around every painted cell), like the farm's and the fish's
// hand-made rows. Pure.

type Grid = string[][];
const N = 16;
const blank = (): Grid => Array.from({ length: N }, () => new Array<string>(N).fill("."));
const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
function set(g: Grid, x: number, y: number, ch: string): void { if (inb(Math.round(x), Math.round(y))) g[Math.round(y)][Math.round(x)] = ch; }
function rect(g: Grid, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(g, x, y, ch);
}
function disc(g: Grid, cx: number, cy: number, r: number, ch: string, sy = 1): void {
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + (y * y) / (sy * sy) <= r * r + r * 0.6) set(g, cx + x, cy + y, ch);
}
function line(g: Grid, x0: number, y0: number, x1: number, y1: number, ch: string): void {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let k = 0; k <= n; k++) set(g, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, ch);
}
/** The painted cells' outline: every empty cell next to a painted one (4-neighbours) becomes "o". */
function outline(g: Grid): string[] {
  const out = g.map((r) => [...r]);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (g[y][x] !== ".") continue;
    if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => inb(x + dx, y + dy) && g[y + dy][x + dx] !== "." && g[y + dy][x + dx] !== "o")) out[y][x] = "o";
  }
  return out.map((r) => r.join(""));
}
const icon = (paint: (g: Grid) => void, pal: Record<string, string>): PixelIcon => {
  const g = blank();
  paint(g);
  return { rows: outline(g), pal };
};

// ---------- logs ----------
const log = (bark: string, dark: string, ring: string, core: string): PixelIcon => icon((g) => {
  rect(g, 5, 5, 13, 11, "b");
  line(g, 6, 7, 12, 7, "B"); line(g, 8, 9, 13, 9, "B"); line(g, 6, 11, 10, 11, "B");
  disc(g, 4, 8, 3, "r");
  disc(g, 4, 8, 1, "c");
  set(g, 4, 8, "B");
}, { b: bark, B: dark, r: ring, c: core });

// ---------- wild goods ----------
const meat = (m: string, light: string): PixelIcon => icon((g) => {
  disc(g, 6, 6, 4, "m");
  set(g, 4, 4, "M"); set(g, 5, 4, "M"); set(g, 4, 5, "M");
  line(g, 9, 9, 12, 12, "w"); disc(g, 13, 13, 1, "w"); set(g, 12, 14, "w"); set(g, 14, 12, "w");
}, { m, M: light, w: "#f4efe0" });
const pelt = (fur: string, belly: string): PixelIcon => icon((g) => {
  disc(g, 8, 8, 4, "f", 1.3);
  for (const [x, y] of [[3, 4], [13, 4], [3, 12], [13, 12]]) line(g, 8 + (x - 8) * 0.5, 8 + (y - 8) * 0.5, x, y, "f");
  line(g, 8, 3, 8, 1, "f");
  disc(g, 8, 8, 1, "l");
}, { f: fur, l: belly });

const WILD: Record<string, PixelIcon> = {
  thit_tho: meat("#d8746a", "#f0a898"),
  thit_chuot_dong: meat("#c46a5a", "#e09888"),
  thit_ga_rung: meat("#e0a060", "#f6cc90"),
  thit_ran_ri_ca: meat("#b85a4a", "#d88a7a"),
  long_vu: icon((g) => {
    line(g, 3, 13, 12, 3, "q");
    for (let k = 0; k < 7; k++) { set(g, 5 + k, 10 - k, "f"); set(g, 6 + k, 11 - k, "F"); set(g, 4 + k, 10 - k, "f"); }
  }, { q: "#f4efe0", f: "#c8b48a", F: "#a8946a" }),
  sung_huou: icon((g) => {
    line(g, 4, 14, 8, 4, "a"); line(g, 8, 4, 12, 2, "a"); line(g, 7, 7, 3, 4, "a"); line(g, 8, 4, 7, 1, "a"); line(g, 6, 10, 11, 8, "a");
  }, { a: "#d8c8a0" }),
  da_cao: pelt("#d8742a", "#f4d0a0"),
  da_soi: pelt("#8a8a92", "#d8d8dc"),
  vuot_gau: icon((g) => {
    rect(g, 4, 9, 11, 13, "p");
    for (const x of [4, 7, 10]) { line(g, x, 8, x + 1, 4, "c"); set(g, x + 2, 3, "c"); }
  }, { p: "#4a3424", c: "#f4efe0" }),
  dom_dom: icon((g) => {
    rect(g, 5, 4, 10, 13, "j"); rect(g, 5, 2, 10, 3, "k");
    for (const [x, y] of [[6, 6], [9, 8], [7, 11], [8, 5]]) set(g, x, y, "y");
  }, { j: "#cfe3e8", k: "#8b5a33", y: "#f6e86a" }),
};

// ---------- dishes ----------
const bowl = (food: string, top: string, bowlCol = "#e8e4d8"): PixelIcon => icon((g) => {
  disc(g, 8, 8, 5, "c", 0.6);
  for (const [x, y] of [[6, 7], [9, 6], [10, 8], [7, 9]]) set(g, x, y, "t");
  rect(g, 3, 9, 13, 10, "k"); rect(g, 4, 11, 12, 12, "k"); rect(g, 6, 13, 10, 13, "K");
}, { c: food, t: top, k: bowlCol, K: "#b8b0a0" });
const plate = (food: string, top: string): PixelIcon => icon((g) => {
  rect(g, 2, 11, 13, 12, "k");
  disc(g, 8, 8, 4, "c", 0.7);
  for (const [x, y] of [[6, 7], [9, 7], [8, 9]]) set(g, x, y, "t");
}, { c: food, t: top, k: "#e8e4d8" });

const DISHES: Record<string, PixelIcon> = {
  ca_loc_nuong_trui: plate("#6a5a3a", "#d8a050"),
  canh_chua_ca_loc: bowl("#e08a3a", "#6fbf4a"),
  ca_ro_kho_tieu: bowl("#8a4a2a", "#2e2a2a", "#c87a4a"),
  bong_sung_xao_toi: plate("#7ab84a", "#f4efe0"),
  goi_bong_dien_dien: plate("#f0c840", "#e0526a"),
  chuot_dong_nuong_sa: plate("#a85a3a", "#c8d070"),
  com_tam_suon: plate("#f4efe0", "#b8602a"),
  lau_mam_ca_linh: bowl("#a07040", "#6fbf4a", "#5a5f68"),
  chao_ga_rung: bowl("#f0e8d0", "#e0a060"),
  chao_ran_dau_xanh: bowl("#d8d0a0", "#6a9a3a"),
};

// ---------- tools ----------
const bow = (wood: string, dark: string): PixelIcon => icon((g) => {
  for (let a = -70; a <= 70; a += 6) { const r = (a * Math.PI) / 180; set(g, 3 + Math.cos(r) * 7, 8 + Math.sin(r) * 7, "w"); }
  line(g, 5, 2, 5, 14, "s");
  rect(g, 9, 7, 10, 9, "d");
}, { w: wood, d: dark, s: "#eeeadf" });
const pan = (body: string, inner: string): PixelIcon => icon((g) => {
  disc(g, 6, 9, 4, "p"); disc(g, 6, 9, 2, "P");
  line(g, 10, 9, 14, 9, "h"); line(g, 10, 10, 14, 10, "h");
}, { p: body, P: inner, h: "#2a2420" });
const pot = (body: string, lid: string): PixelIcon => icon((g) => {
  rect(g, 3, 6, 12, 12, "p"); rect(g, 4, 13, 11, 13, "p"); rect(g, 3, 5, 12, 5, "l"); set(g, 8, 4, "l");
  set(g, 2, 7, "p"); set(g, 13, 7, "p"); line(g, 4, 8, 11, 8, "P");
}, { p: body, P: lid, l: lid });
const axe = (head: string, edge: string): PixelIcon => icon((g) => {
  line(g, 4, 14, 11, 3, "h"); line(g, 5, 14, 12, 3, "h");
  rect(g, 8, 2, 12, 6, "x"); line(g, 13, 2, 13, 7, "e");
}, { h: "#8b5a33", x: head, e: edge });

const TOOLS: Record<string, PixelIcon> = {
  cung_tap_su: bow("#a8743f", "#6e4424"), cung_tre: bow("#b8c060", "#7a8a30"),
  cung_go_tram: bow("#d8d0bc", "#8a8270"), cung_go_cung: bow("#7a3a2a", "#4a2018"),
  chao_tap_su: pan("#5a5f68", "#8a8f98"), noi_dat: pot("#b8603a", "#8a4428"),
  chao_gang: pan("#2e2e34", "#4a4a52"), noi_gang: pot("#2e2e34", "#5a5a62"),
  riu_tap_su: axe("#8a8f98", "#d8d8dc"), riu_sat: axe("#5a5f68", "#c8ccd4"), riu_thep: axe("#7a8aa8", "#e8eef8"),
  riu_thep_toi: axe("#4a5a88", "#c8d8ff"), riu_tinh_luyen: axe("#5a5f68", "#f6c945"),
  cua_tap_su: icon((g) => {
    rect(g, 2, 7, 11, 9, "b");
    for (let x = 2; x <= 11; x += 2) set(g, x, 10, "b");
    rect(g, 12, 6, 14, 10, "h");
  }, { b: "#a8acb4", h: "#8b5a33" }),
};

// ---------- forest items ----------
const ITEMS: Record<string, PixelIcon> = {
  bay_go: icon((g) => {
    rect(g, 2, 12, 13, 13, "d");
    for (const x of [2, 13]) line(g, x, 5, x, 12, "w");
    for (const y of [5, 8, 11]) line(g, 2, y, 13, y, "w");
    line(g, 14, 2, 11, 8, "d");
  }, { w: "#8b5a33", d: "#6e4424" }),
  bay_sat: icon((g) => {
    rect(g, 2, 11, 13, 12, "i");
    for (let x = 3; x <= 12; x += 3) { line(g, x, 10, x, 6, "t"); }
    line(g, 2, 10, 2, 7, "i"); line(g, 13, 10, 13, 7, "i"); line(g, 1, 13, 14, 13, "c");
  }, { i: "#4a4c54", t: "#c8ccd4", c: "#2e2a2a" }),
  than_cui: icon((g) => {
    disc(g, 5, 10, 3, "c"); disc(g, 10, 11, 3, "C"); disc(g, 8, 6, 3, "c");
    set(g, 7, 5, "h"); set(g, 4, 9, "h"); set(g, 10, 10, "h"); set(g, 11, 12, "e");
  }, { c: "#2e2e34", C: "#3a3a42", h: "#6a6a72", e: "#e0702a" }),
};

const LOGS: Record<string, PixelIcon> = {
  go_tre: log("#b8c060", "#8a9a40", "#e8e0a0", "#c8b870"),
  go_keo: log("#a8743f", "#7a4e2c", "#e8c890", "#c89a60"),
  go_thong: log("#8a6a4a", "#5a4430", "#f0d8a8", "#d8b078"),
  go_soi: log("#6e4424", "#4a2c18", "#d8a870", "#a87848"),
  go_do: log("#8a3a2a", "#5a2018", "#e08a6a", "#b85a40"),
  go_tram_huong: log("#5a4a2a", "#3a2e18", "#d8c088", "#b89850"),
  go_than_moc: log("#3a5a4a", "#24382e", "#e8d070", "#c8a840"),
};

/** Every forest icon by item id. */
export const FOREST_ICONS: Readonly<Record<string, PixelIcon>> = { ...LOGS, ...WILD, ...DISHES, ...TOOLS, ...ITEMS };
