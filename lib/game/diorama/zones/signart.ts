// Pure: painted signboards for the dioramas — a pixel font (5×7 capitals with the Vietnamese marks drawn above/below),
// a few 7×7 pictograms, a sign face rasterised to RGBA texels, and a shelf packer that puts every face of a zone into
// one atlas (one texture, one draw call for all its signs). No DOM, no WebGL: the same pixels in node and the browser.

export type SignIcon = "fish" | "note" | "rice" | "cards" | "market" | "home" | "cup" | "map" | "arrow" | "fist" | "star" | "paper";

export interface SignArt {
  lines: readonly string[];
  icon?: SignIcon;
  /** Board paint and letter paint (0xRRGGBB). */
  bg: number;
  fg: number;
  /** The painted rim (default: the bg darkened). */
  rim?: number;
}

export interface Raster { w: number; h: number; rgba: Uint8Array }

/** 5×7 capitals, row by row ("#" = ink). */
const R = (...rows: string[]) => rows.join("");
const G: Record<string, string> = {
  A: R(".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"), B: R("####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."),
  C: R(".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."), D: R("####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."),
  E: R("#####", "#....", "#....", "####.", "#....", "#....", "#####"), F: R("#####", "#....", "#....", "####.", "#....", "#....", "#...."),
  G: R(".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".####"), H: R("#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"),
  I: R(".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."), J: R("..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."),
  K: R("#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"), L: R("#....", "#....", "#....", "#....", "#....", "#....", "#####"),
  M: R("#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"), N: R("#...#", "#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#"),
  O: R(".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."), P: R("####.", "#...#", "#...#", "####.", "#....", "#....", "#...."),
  Q: R(".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"), R: R("####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"),
  S: R(".####", "#....", "#....", ".###.", "....#", "....#", "####."), T: R("#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."),
  U: R("#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."), V: R("#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."),
  W: R("#...#", "#...#", "#...#", "#.#.#", "#.#.#", "#.#.#", ".#.#."), X: R("#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"),
  Y: R("#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."), Z: R("#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"),
  "0": R(".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."), "1": R("..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."),
  "2": R(".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"), "3": R("####.", "....#", "....#", ".###.", "....#", "....#", "####."),
  "4": R("...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."), "5": R("#####", "#....", "####.", "....#", "....#", "#...#", ".###."),
  "6": R(".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."), "7": R("#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."),
  "8": R(".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."), "9": R(".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."),
  "-": R(".....", ".....", ".....", ".###.", ".....", ".....", "....."), ".": R(".....", ".....", ".....", ".....", ".....", ".##..", ".##.."),
  "!": R("..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."), ":": R(".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."),
  "/": R("....#", "...#.", "...#.", "..#..", ".#...", ".#...", "#...."), "+": R(".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."),
  ",": R(".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."), "·": R(".....", ".....", ".....", "..#..", ".....", ".....", "....."),
  " ": "",
};

/** 7×7 pictograms. */
const ICONS: Record<SignIcon, string> = {
  fish: R(".......", "...###.", "#.#####", "#######", "#.#####", "...###.", "......."),
  note: R("..#####", "..#...#", "..#...#", "..#...#", ".##..##", "###.###", ".#...#."),
  rice: R("#..#..#", ".#.#.#.", "..###..", "...#...", "...#...", "..###..", ".#####."),
  cards: R("####...", "#..#...", "#.####.", "#.#..#.", "###..#.", "..#..#.", "..####."),
  market: R("#######", "#.#.#.#", "#######", ".#...#.", ".#.#.#.", ".#.#.#.", ".#####."),
  home: R("...#...", "..###..", ".#####.", "#######", ".#...#.", ".#.#.#.", ".#.#.#."),
  cup: R(".#.#...", "..#.#..", ".......", "#####..", "######.", "#####..", ".###..."),
  map: R("##.##.#", "#.##.##", "##.#.##", "#.###.#", "##.#.##", "#.##.##", "##.##.#"),
  arrow: R("...#...", "...##..", "######.", "#######", "######.", "...##..", "...#..."),
  fist: R(".####..", "######.", "#######", "#######", ".######", "..####.", "..###.."),
  star: R("...#...", "..###..", "#######", ".#####.", "..###..", ".##.##.", ".#...#."),
  paper: R("#####..", "#...##.", "#.#.###", "#.....#", "#.###.#", "#.....#", "#######"),
};

const MARKS_ABOVE = new Set(["\u0302", "\u0306", "\u0301", "\u0300", "\u0309", "\u0303", "\u031b"]);

/** One capital with its marks: base glyph rows (7) plus the rows above (2) and the dot below. */
function glyph(ch: string): { base: string; marks: string[]; stroke: boolean } {
  if (ch === "Đ" || ch === "đ") return { base: "D", marks: [], stroke: true };
  const parts = ch.normalize("NFD").toUpperCase();
  const base = parts[0];
  return { base: G[base] !== undefined ? base : " ", marks: [...parts.slice(1)], stroke: false };
}

/** Split a string into Unicode letters (a base plus its combining marks count as one). */
function letters(s: string): string[] {
  const out: string[] = [];
  for (const ch of s.normalize("NFC")) out.push(ch);
  return out;
}

const ADV = 6, LINE = 11, PAD = 3, ICON = 7;

export function hexRGB(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}
const darker = (c: number, k: number) => { const [r, g, b] = hexRGB(c); return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k); };

/** The texel size of a sign face. */
export function signSize(art: SignArt): { w: number; h: number } {
  const text = Math.max(0, ...art.lines.map((l) => letters(l).length * ADV - 1));
  const iconW = art.icon ? ICON + (text > 0 ? 3 : 0) : 0;
  const w = Math.max(14, text + iconW + PAD * 2 + 2);
  const h = Math.max(ICON + PAD * 2 + 2, art.lines.length * LINE + PAD * 2);
  return { w, h };
}

/** Paint a sign face (row 0 = the top). */
export function rasterSign(art: SignArt): Raster {
  const { w, h } = signSize(art);
  const rgba = new Uint8Array(w * h * 4);
  const put = (x: number, y: number, c: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const [r, g, b] = hexRGB(c), i = (y * w + x) * 4;
    rgba[i] = r; rgba[i + 1] = g; rgba[i + 2] = b; rgba[i + 3] = 255;
  };
  const rim = art.rim ?? darker(art.bg, 0.6);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    // a faint wood grain / weathering so a plain board is not a flat slab
    const grain = (Math.sin(y * 1.7 + Math.sin(x * 0.21) * 2) > 0.85) ? 0.93 : 1;
    put(x, y, edge ? rim : grain === 1 ? art.bg : darker(art.bg, grain));
  }
  const textW = Math.max(0, ...art.lines.map((l) => letters(l).length * ADV - 1));
  const iconW = art.icon ? ICON + (textW > 0 ? 3 : 0) : 0;
  let x0 = Math.floor((w - textW - iconW) / 2);
  if (art.icon) {
    const src = ICONS[art.icon], iy = Math.floor((h - ICON) / 2);
    for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) if (src[y * ICON + x] === "#") put(x0 + x, iy + y, art.fg);
    x0 += iconW;
  }
  const top = Math.floor((h - art.lines.length * LINE) / 2);
  art.lines.forEach((line, li) => {
    const ls = letters(line), lw = ls.length * ADV - 1;
    let cx = x0 + Math.floor((textW - lw) / 2);
    const by = top + li * LINE + 2;                                  // the base glyph's top row (2 rows of marks above)
    for (const ch of ls) {
      const g = glyph(ch), rows = G[g.base];
      for (let i = 0; i < rows.length; i++) if (rows[i] === "#") put(cx + (i % 5), by + Math.floor(i / 5), art.fg);
      if (g.stroke) { put(cx, by + 3, art.fg); put(cx + 1, by + 3, art.fg); }
      const above = g.marks.filter((m) => MARKS_ABOVE.has(m) && m !== "\u031b");
      const vowel = above.find((m) => m === "\u0302" || m === "\u0306");
      const tone = above.find((m) => m !== "\u0302" && m !== "\u0306");
      if (vowel === "\u0302") { put(cx + 1, by - 1, art.fg); put(cx + 3, by - 1, art.fg); if (!tone) put(cx + 2, by - 2, art.fg); else put(cx + 2, by - 2, art.fg); }
      if (vowel === "\u0306") { put(cx + 1, by - 2, art.fg); put(cx + 3, by - 2, art.fg); put(cx + 2, by - 1, art.fg); }
      if (tone) {
        const tx = vowel ? cx + 4 : cx + 2, ty = vowel ? by - 2 : by - 1;
        if (tone === "\u0301") { put(tx, ty, art.fg); put(tx + 1, ty - 1, art.fg); }
        if (tone === "\u0300") { put(tx, ty, art.fg); put(tx - 1, ty - 1, art.fg); }
        if (tone === "\u0309") { put(tx, ty, art.fg); put(tx, ty - 1, art.fg); put(tx - 1, ty - 1, art.fg); }
        if (tone === "\u0303") { put(tx - 1, ty, art.fg); put(tx, ty - 1, art.fg); put(tx + 1, ty, art.fg); put(tx + 2, ty - 1, art.fg); }
      }
      if (g.marks.includes("\u031b")) { put(cx + 5, by - 1, art.fg); put(cx + 5, by, art.fg); }
      if (g.marks.includes("\u0323")) put(cx + 2, by + 8, art.fg);
      cx += ADV;
    }
  });
  return { w, h, rgba };
}

/** Every face of a zone in one texture: where each landed (UV rect, v up) and the atlas's RGBA rows (row 0 = v 0). */
export interface Atlas { width: number; height: number; data: Uint8Array; uv: Array<{ u0: number; v0: number; u1: number; v1: number }> }

export function packAtlas(faces: readonly Raster[], width = 256): Atlas {
  const W = Math.max(width, ...faces.map((f) => f.w + 2));
  const at: Array<{ x: number; y: number }> = [];
  let x = 1, y = 1, row = 0;
  for (const f of faces) {
    if (x + f.w + 1 > W) { x = 1; y += row + 2; row = 0; }
    at.push({ x, y });
    x += f.w + 2;
    row = Math.max(row, f.h);
  }
  let H = 4;
  while (H < y + row + 1) H *= 2;
  const data = new Uint8Array(W * H * 4);
  const uv: Atlas["uv"] = [];
  faces.forEach((f, k) => {
    const p = at[k];
    for (let r = 0; r < f.h; r++) {
      const dst = ((H - 1 - (p.y + r)) * W + p.x) * 4;           // image row r (from the top) → atlas row from the bottom
      data.set(f.rgba.subarray(r * f.w * 4, (r + 1) * f.w * 4), dst);
    }
    // a half-texel inset keeps nearest sampling inside the face
    uv.push({ u0: (p.x + 0.02) / W, u1: (p.x + f.w - 0.02) / W, v0: (H - p.y - f.h + 0.02) / H, v1: (H - p.y - 0.02) / H });
  });
  return { width: W, height: H, data, uv };
}
