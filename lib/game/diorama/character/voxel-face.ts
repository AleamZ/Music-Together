import type { Gender } from "@/lib/game/types";

// Pure: the chibi's face as a transparent pixel decal (32×36 texels = the head's 8×9-unit face at 4 texels per unit),
// laid over the skin: brows, big anime eyes (lash line, sclera, a two-tone iris with a dark pupil and white glints),
// nose shading, blush, mouth. Expressions: open, blink (swapped in for a moment every few seconds), happy (waving),
// surprised.

export type FaceExpr = "open" | "blink" | "happy" | "surprised";
export const FACE_EXPRS: readonly FaceExpr[] = ["open", "blink", "happy", "surprised"];
export const FACE_W = 32;
export const FACE_H = 36;

type C = readonly [number, number, number, number];
const LASH: C = [40, 24, 22, 255];
const BROW: C = [74, 46, 36, 230];
const TOP: C = [52, 30, 24, 255];
const IRIS: C = [138, 78, 40, 255];
const IRIS2: C = [196, 126, 62, 255];
const PUPIL: C = [30, 16, 14, 255];
const HI: C = [255, 255, 255, 255];
const WHITE: C = [248, 243, 236, 255];
const LOWER: C = [120, 70, 60, 150];
const BLUSH: C = [238, 120, 116, 110];
const NOSE: C = [150, 80, 60, 70];
const MOUTH: C = [150, 70, 62, 255];
const MOUTH_IN: C = [112, 36, 42, 255];
const TONGUE: C = [226, 112, 112, 255];

/** RGBA bytes, row 0 = top of the face. */
export function facePixels(expr: FaceExpr, gender: Gender): Uint8Array {
  const px = new Uint8Array(FACE_W * FACE_H * 4);
  const put = (x: number, y: number, c: C) => {
    if (x < 0 || y < 0 || x >= FACE_W || y >= FACE_H) return;
    const i = (y * FACE_W + x) * 4;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = c[3];
  };
  const nu = gender === "nu";
  const E = 15;                                                              // the eyes' top row
  for (const side of [-1, 1] as const) {
    // columns counted from the outer corner (0) inward (5): the screen-left eye spans 6..11, the right one 20..25
    const at = (i: number) => (side < 0 ? 6 + i : 25 - i);
    const lr = (x: number) => (side < 0 ? 6 + x : 20 + x);                   // left-to-right within the eye
    // brows: a soft slant, higher at the outer end
    put(at(1), E - 3, BROW); put(at(2), E - 3, BROW); put(at(3), E - 3, BROW); put(at(4), E - 2, BROW);
    if (expr === "open" || expr === "surprised") {
      const s = expr === "surprised" ? 1 : 0;
      for (let i = 0; i < 6; i++) put(at(i), E - s, LASH);
      put(at(-1), E - 1 - s, LASH);
      if (nu) { put(at(-1), E - s, LASH); put(at(-2), E - 1 - s, LASH); }
      for (let y = E + 1; y <= E + 5; y++) put(at(0), y, WHITE);
      for (let y = E + 1; y <= E + 6; y++) for (let x = 1; x <= 5; x++) {
        const r = y - E;
        put(lr(side < 0 ? x : x - 1), y, r <= 2 ? TOP : r <= 4 ? IRIS : IRIS2);
      }
      if (s) for (let y = E + 1; y <= E + 6; y++) { put(lr(side < 0 ? 1 : 0), y, WHITE); put(lr(side < 0 ? 5 : 4), y, WHITE); }
      // pupil and glints (the big glint toward screen-left on both eyes)
      const c0 = side < 0 ? 8 : 21;
      put(c0 + 1, E + 3, PUPIL); put(c0 + 2, E + 3, PUPIL); put(c0 + 1, E + 4, PUPIL); put(c0 + 2, E + 4, PUPIL);
      put(c0 - 1, E + 2, HI); put(c0, E + 2, HI); put(c0 - 1, E + 3, HI); put(c0, E + 3, HI);
      put(c0 + 3, E + 5, HI);
      for (let i = 1; i < 5; i++) put(at(i), E + 7, LOWER);
    } else if (expr === "blink") {
      for (let i = 0; i < 6; i++) put(at(i), E + 4, LASH);
      put(at(-1), E + 3, LASH);
      for (let i = 1; i < 5; i++) put(at(i), E + 5, LOWER);
    } else {
      // happy: ^ ^
      put(at(2), E + 2, LASH); put(at(3), E + 2, LASH);
      put(at(1), E + 3, LASH); put(at(4), E + 3, LASH);
      put(at(0), E + 4, LASH); put(at(5), E + 4, LASH);
    }
    // blush under the outer eye
    for (let i = -1; i < 3; i++) { put(at(i), E + 9, BLUSH); put(at(i), E + 10, BLUSH); }
  }
  // nose: a soft shadow
  put(16, E + 9, NOSE); put(16, E + 10, NOSE);
  // mouth
  const M = E + 13;
  if (expr === "happy") {
    put(13, M - 1, MOUTH); put(18, M - 1, MOUTH);
    for (let x = 14; x <= 17; x++) put(x, M, MOUTH_IN);
    put(15, M + 1, TONGUE); put(16, M + 1, TONGUE); put(14, M + 1, MOUTH_IN); put(17, M + 1, MOUTH_IN);
  } else if (expr === "surprised") {
    put(15, M - 1, MOUTH_IN); put(16, M - 1, MOUTH_IN);
    put(14, M, MOUTH_IN); put(17, M, MOUTH_IN); put(15, M, MOUTH_IN); put(16, M, MOUTH_IN);
    put(15, M + 1, MOUTH_IN); put(16, M + 1, MOUTH_IN);
  } else {
    put(15, M, MOUTH); put(16, M, MOUTH);
    put(14, M - 1, [MOUTH[0], MOUTH[1], MOUTH[2], nu ? 150 : 90]); put(17, M - 1, [MOUTH[0], MOUTH[1], MOUTH[2], nu ? 150 : 90]);
  }
  return px;
}
