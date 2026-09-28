// v21 #94/#95 photo mode: the game canvas → a small JPEG data URL that fits the album's server limit.
import { PHOTO_MAX_CHARS } from "./model";

export interface Shot { dataUrl: string; w: number; h: number }

/** Try widths and qualities (largest first) until `encode` gives a data URL under the limit; null when none fits. */
export function fitShot(srcW: number, srcH: number, encode: (w: number, h: number, q: number) => string,
                        limit = PHOTO_MAX_CHARS): Shot | null {
  if (srcW < 16 || srcH < 16) return null;
  for (const maxW of [640, 480, 360, 240]) {
    const w = Math.max(16, Math.min(maxW, Math.round(srcW)));
    const h = Math.max(16, Math.min(1280, Math.round((srcH * w) / srcW)));
    for (const q of [0.8, 0.65, 0.5, 0.35]) {
      const dataUrl = encode(w, h, q);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && dataUrl.length <= limit) return { dataUrl, w, h };
    }
  }
  return null;
}

/** The canvas of the game world, captured (the HUD is DOM, so it is never in the picture). */
export function captureCanvas(src: HTMLCanvasElement): Shot | null {
  const off = document.createElement("canvas");
  return fitShot(src.width, src.height, (w, h, q) => {
    off.width = w;
    off.height = h;
    const c = off.getContext("2d");
    if (!c) return "";
    c.imageSmoothingEnabled = false;
    c.drawImage(src, 0, 0, w, h);
    return off.toDataURL("image/jpeg", q);
  });
}

/** The world canvas on the page (GameCanvas labels it). */
export const findGameCanvas = (): HTMLCanvasElement | null =>
  document.querySelector<HTMLCanvasElement>('canvas[aria-label="Thế giới game"]');
