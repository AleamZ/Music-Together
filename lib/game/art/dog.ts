import type { DogCoat, DogPose } from "@/lib/game/dog";
import type { Facing } from "@/lib/game/types";

// v17 (spec §14): the dog (chó cỏ), 20 × 16 px anchored at (10, 15), for down, up and right (left mirrors right): walk
// 0–3, idle, sit, hungry (ears and tail down), run 0/1, leap, wag 0/1 and carry (the fall-rat at its mouth). Frames
// are built from parts; letters: b body, B shade, w muzzle and belly, d detail, n nose, e eyes, t tongue, c collar,
// and S R P the carried rat. A vện coat puts stripes, a đốm coat spots, on its body pixels. Cached per coat, like
// getCharacterFrames. Original art.

export const DOG_W = 20;
export const DOG_H = 16;
/** The pixel drawn at the dog's feet. */
export const DOG_ANCHOR = { x: 10, y: 15 } as const;

export type DogFrame =
  | "walk0" | "walk1" | "walk2" | "walk3" | "idle" | "sit" | "hungry" | "run0" | "run1" | "leap" | "wag0" | "wag1" | "carry";
export const DOG_FRAMES: readonly DogFrame[] = [
  "walk0", "walk1", "walk2", "walk3", "idle", "sit", "hungry", "run0", "run1", "leap", "wag0", "wag1", "carry",
];

/** The coats' b, B, w and d (§14). */
export const COAT_PAL: Readonly<Record<DogCoat, { b: string; B: string; w: string; d: string }>> = {
  vang: { b: "#c8913f", B: "#9a6a2c", w: "#ecd3a2", d: "#9a6a2c" },
  muc: { b: "#2f2a28", B: "#1b1716", w: "#5a4f48", d: "#1b1716" },
  ven: { b: "#a8783e", B: "#7a5226", w: "#d8b88a", d: "#4a3018" },
  dom: { b: "#efe6d4", B: "#c9bca4", w: "#fbf6ea", d: "#4a3a2a" },
};
/** Every coat's nose and eyes, tongue and collar, and the carried rat's fur, shade and tail. */
export const DOG_FIXED: Readonly<Record<string, string>> = {
  n: "#1c1410", e: "#1c1410", t: "#d9776a", c: "#c0392b", S: "#5a4636", R: "#7a6450", P: "#c98f86",
};

interface Part { top: number; rows: readonly string[] }
const at = (top: number, rows: readonly string[]): Part => ({ top, rows });

/** Paints the parts in order over a blank frame; "." leaves what is under it. */
function compose(...parts: Part[]): string[] {
  const m = Array.from({ length: DOG_H }, () => new Array<string>(DOG_W).fill("."));
  for (const p of parts) {
    p.rows.forEach((row, i) => {
      const y = p.top + i;
      if (y < 0 || y >= DOG_H) return;
      for (let x = 0; x < DOG_W; x++) if (row[x] !== undefined && row[x] !== ".") m[y][x] = row[x];
    });
  }
  return m.map((r) => r.join(""));
}

// ---------------------------------------------------------------- side (facing right)

const HEAD_S = [
  "..............Bd....",
  ".............BbbB...",
  "............bbbebb..",
  "............bbbbbwwn",
  "............cbbbwww.",
  "............cbbbb...",
];
const HEAD_S_TONGUE = [...HEAD_S.slice(0, 4), "............cbbbw.tt", "............cbbbb.t."];
const HEAD_S_RAT = [...HEAD_S.slice(0, 4), "............cbbbwSRS", "............cbbbbRRR", ".................P.."];
const TORSO_S = [
  "...bbbbbbbbbbbbbb...",
  "...bbbbbbbbbbbbbb...",
  "...Bbbbbbbbbbbbbb...",
  "....wwwwwwwwwwwbB...",
];
const LEGS_S = {
  idle: ["....bb.......bb.....", "....bb.......bb.....", "....bB.......bB.....", "....bB.......bB.....", "....dd.......dd....."],
  walk0: ["....bb.......bb.....", "...bb.........bb....", "...bB.........bB....", "..bB...........bB...", "..dd...........dd..."],
  walk1: ["....bbb.....bbb.....", ".....bb.....bb......", ".....bB.....bB......", ".....bB.....bB......", ".....dd.....dd......"],
  walk2: ["....bb.......bb.....", ".....bb.....bb......", "......bB...bB.......", "......bB...bB.......", "......dd...dd......."],
  run0: ["..bb..........bb....", ".bB............bB...", "bB..............bB..", "d................d.."],
  run1: ["......bb...bb.......", ".......bB.bB........", ".......dd.dd........", "...................."],
  leap: ["..bb...........bbb..", ".bB..............bB.", "bB.................d", "d..................."],
};
const TAIL_S_UP = [".d..................", ".b..................", "..b.................", "..bb................"];
const TAIL_S_WAG = ["...d................", "...b................", "..bb................", "..bb................"];
const TAIL_S_BACK = ["dbb................."];
const SIT_S_BODY = [
  "...........bcbbb....",
  "..........bbbbbw....",
  ".........bbbbbbw....",
  "........bbbbbbbw....",
  ".......Bbbbbbbbw....",
  ".......Bbbbbbbb.bb..",
  "......Bbbbbbbbb.bb..",
  "......bbbbbbbbb.bB..",
  "..dbbbBBBBBBBBB.bB..",
  "......dddd......dd..",
];
const HEAD_S_DROOP = [
  ".............bbb....",
  "............Bbbebb..",
  "............Bbbbbwwn",
  "............dcbbwww.",
];

function side(frame: DogFrame): string[] {
  const stand = (head: readonly string[], legs: readonly string[], tail: readonly string[]) =>
    compose(at(3, tail), at(1, head), at(7, TORSO_S), at(11, legs));
  switch (frame) {
    case "walk0": case "walk1": case "walk2": return stand(HEAD_S, LEGS_S[frame], TAIL_S_UP);
    case "walk3": case "idle": return stand(HEAD_S, LEGS_S.idle, TAIL_S_UP);
    case "wag0": return stand(HEAD_S_TONGUE, LEGS_S.idle, TAIL_S_UP);
    case "wag1": return stand(HEAD_S_TONGUE, LEGS_S.idle, TAIL_S_WAG);
    case "carry": return stand(HEAD_S_RAT, LEGS_S.walk1, TAIL_S_UP);
    case "run0": case "run1": return compose(at(8, TAIL_S_BACK), at(2, HEAD_S), at(8, TORSO_S), at(12, LEGS_S[frame]));
    case "leap": return compose(at(6, TAIL_S_BACK), at(0, HEAD_S), at(6, TORSO_S), at(10, LEGS_S.leap));
    case "sit": return compose(at(1, HEAD_S.slice(0, 5)), at(6, SIT_S_BODY));
    case "hungry": return compose(at(2, HEAD_S_DROOP), at(6, SIT_S_BODY));
  }
}

// ---------------------------------------------------------------- front (facing down) and back (facing up)

const HEAD_F = [
  "......Bd....dB......",
  "......BbbbbbbB......",
  ".......bebbeb.......",
  ".......bbwwbb.......",
  "........wnnw........",
  "........cccc........",
];
const HEAD_F_TONGUE = [...HEAD_F.slice(0, 5), "........cttc........"];
const HEAD_F_RAT = [...HEAD_F.slice(0, 5), ".......SRRRRS.......", "......P............."];
const HEAD_F_DROOP = [
  "....................",
  ".......bbbbbb.......",
  "......BbebbebB......",
  "......BbbwwbbB......",
  "......d.wnnw.d......",
  "........cccc........",
];
const HEAD_U = [
  "......Bb....bB......",
  "......BbbbbbbB......",
  ".......bbbbbb.......",
  ".......bbbbbb.......",
  "........bbbb........",
  "........cccc........",
];
const HEAD_U_RAT = [...HEAD_U, ".............P......"];
const HEAD_U_DROOP = [
  "....................",
  ".......bbbbbb.......",
  "......BbbbbbbB......",
  "......BbbbbbbB......",
  "......d.bbbb.d......",
  "........cccc........",
];
const TORSO_F = [".......bbwwbb.......", "......bbbwwbbb......", "......bbbwwbbb......", "......bbbwwbbb......"];
const TORSO_U = [".......bbbbbb.......", "......bbbbbbbb......", "......bbbbbbbb......", "......bBbbbbBb......"];
const LEGS_F = {
  idle: ["......bb....bb......", "......bb....bb......", "......bB....bB......", "......bB....bB......", "......dd....dd......"],
  walk0: ["......bb....bb......", "......bb....bb......", "......dd....bB......", "............bB......", "............dd......"],
  walk2: ["......bb....bb......", "......bb....bb......", "......bB....dd......", "......bB............", "......dd............"],
  run0: [".....bb......bb.....", "....bb........bb....", "....bB........bB....", "...dd..........dd..."],
  run1: [".......bb..bb.......", ".......bB..bB.......", ".......dd..dd......."],
};
const SIT_F_BODY = [
  ".......bbwwbb.......",
  "......bbbwwbbb......",
  "......bbbwwbbb......",
  ".....bbbbwwbbbb.....",
  ".....bbb.bb.bbb.....",
  ".....bbb.bb.bbb.....",
  ".....BBb.bB.bBB.....",
  ".....BBB.bB.BBB.....",
  ".....ddd.dd.ddd.....",
];
const SIT_U_BODY = [
  ".......bbbbbb.......",
  "......bbbbbbbb......",
  "......bbbbbbbb......",
  ".....bbbbbbbbbb.....",
  ".....bbbbbbbbbb.....",
  ".....bbbbbbbbbb.....",
  ".....BBbbbbbbBB.....",
  ".....BBBbbbbBBB.....",
  ".....ddd.bb.ddd.....",
];
/** The tail seen past the body: from the front it sticks out at a side, from behind it rises over the rump. */
const TAIL_F = [["...............d....", "..............b....."], ["....d...............", ".....b.............."]];
const TAIL_U = [[".........d..........", ".........B..........", ".........B.........."], ["..........d.........", "..........B.........", ".........BB........."]];

function frontBack(facing: "down" | "up", frame: DogFrame): string[] {
  const down = facing === "down";
  const head = down ? HEAD_F : HEAD_U, torso = down ? TORSO_F : TORSO_U;
  const tail = (k: number): Part => (down ? at(5, TAIL_F[k]) : at(8, TAIL_U[k]));
  const stand = (h: readonly string[], legs: readonly string[], t: Part | null) =>
    compose(...(t && down ? [t] : []), at(1, h), at(7, torso), at(11, legs), ...(t && !down ? [t] : []));
  switch (frame) {
    case "walk0": case "walk2": return stand(head, LEGS_F[frame], down ? null : tail(0));
    case "walk1": case "walk3": case "idle": return stand(head, LEGS_F.idle, down ? null : tail(0));
    case "wag0": return stand(down ? HEAD_F_TONGUE : head, LEGS_F.idle, tail(0));
    case "wag1": return stand(down ? HEAD_F_TONGUE : head, LEGS_F.idle, tail(1));
    case "carry": return stand(down ? HEAD_F_RAT : HEAD_U_RAT, LEGS_F.idle, down ? null : tail(0));
    case "run0": case "run1": return compose(at(1, head), at(7, torso), at(11, LEGS_F[frame]));
    case "leap": return compose(at(0, head), at(6, torso), at(10, LEGS_F.run1));
    case "sit": return compose(at(1, head), at(7, down ? SIT_F_BODY : SIT_U_BODY));
    case "hungry": return compose(at(1, down ? HEAD_F_DROOP : HEAD_U_DROOP), at(7, down ? SIT_F_BODY : SIT_U_BODY));
  }
}

/** The letters of a frame, facing right for "left" too (the matrix mirrors it). */
export function dogArt(facing: Facing, frame: DogFrame): string[] {
  return facing === "down" || facing === "up" ? frontBack(facing, frame) : side(frame);
}

/** A coat's pattern on a body pixel: vện's stripes below the head, đốm's 2 × 2 spots. */
function marked(coat: DogCoat, x: number, y: number): boolean {
  if (coat === "ven") return y >= 7 && (x + (y >> 2)) % 3 === 0;
  if (coat === "dom") return ((x >> 1) * 3 + (y >> 1) * 5) % 7 === 2;
  return false;
}

/** A frame's colours by row ("" = transparent) for a coat and a facing; "left" mirrors "right". */
export function dogMatrix(coat: DogCoat, facing: Facing, frame: DogFrame): string[][] {
  const pal = COAT_PAL[coat];
  const colours: Record<string, string> = { ...DOG_FIXED, b: pal.b, B: pal.B, w: pal.w, d: pal.d };
  const m = dogArt(facing, frame).map((row, y) => [...row].map((ch, x) => {
    if (ch === ".") return "";
    return ch === "b" && marked(coat, x, y) ? pal.d : colours[ch] ?? "";
  }));
  if (facing === "left") for (const row of m) row.reverse();
  return m;
}

/** What a dog shows (DogPose from the follower): walking legs every 150 ms, running every 100 ms, a wag every 150 ms. */
export function dogFrame(pose: DogPose, t: number): DogFrame {
  switch (pose) {
    case "walk": return (["walk0", "walk1", "walk2", "walk3"] as const)[Math.floor(t / 150) % 4];
    case "run": return Math.floor(t / 100) % 2 ? "run1" : "run0";
    case "wag": return Math.floor(t / 150) % 2 ? "wag1" : "wag0";
    default: return pose;
  }
}

const FACINGS: readonly Facing[] = ["down", "up", "left", "right"];
type DogSprites = Record<Facing, Record<DogFrame, HTMLCanvasElement>>;
const cache = new Map<DogCoat, DogSprites>();

function toCanvas(m: string[][]): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = DOG_W;
  cv.height = DOG_H;
  const ctx = cv.getContext("2d");
  if (!ctx) return cv;
  m.forEach((row, y) => row.forEach((col, x) => {
    if (!col) return;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }));
  return cv;
}

/** Every facing × frame of a coat, rendered once. */
export function getDogFrames(coat: DogCoat): DogSprites {
  const hit = cache.get(coat);
  if (hit) return hit;
  const sprites = {} as DogSprites;
  for (const f of FACINGS) {
    sprites[f] = {} as Record<DogFrame, HTMLCanvasElement>;
    for (const fr of DOG_FRAMES) sprites[f][fr] = toCanvas(dogMatrix(coat, f, fr));
  }
  cache.set(coat, sprites);
  return sprites;
}

/** Draws a dog with its anchor at (x, y) (world px minus the camera). Browser only. */
export function drawDog(c: CanvasRenderingContext2D, coat: DogCoat, facing: Facing, frame: DogFrame, x: number, y: number): void {
  c.drawImage(getDogFrames(coat)[facing][frame], Math.round(x) - DOG_ANCHOR.x, Math.round(y) - DOG_ANCHOR.y);
}
