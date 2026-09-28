import type { StepScene } from "@/lib/game/farm/handbook-pics";
import { CO_UT_LOOK, DEFAULT_LOOK } from "@/lib/game/look";
import { FARM_ANIM } from "@/lib/game/net/protocol";
import { drawHarvester, paintPlot } from "./crops";
import { drawDog } from "./dog";
import { drawFarmAnim } from "./farm-anim";
import { iconMatrixFor } from "./icons";
import { drawRat } from "./rats";
import { getCharacterFrames } from "./raster";

// A Sổ tay step card's picture (📖 🖼️ Hình): the game's own plot art, the farmer (or cô Út) doing the step with the
// farm animation over them, the step's items and now and then a rat, the dog, the harvester or the sun — all at 1 px a
// pixel on a small canvas the card scales up by an integer. Browser only (canvas). Original art.

export const STEP_W = 64;
export const STEP_H = 56;
const PLOT_Y = 24;
const SKY = "#f3e6c4";
const GROUND = "#a8844f";

const iconCache = new Map<string, HTMLCanvasElement | null>();

function iconCanvas(id: string): HTMLCanvasElement | null {
  if (iconCache.has(id)) return iconCache.get(id)!;
  const m = iconMatrixFor(id);
  let cv: HTMLCanvasElement | null = null;
  if (m) {
    cv = document.createElement("canvas");
    cv.width = 16;
    cv.height = 16;
    const c = cv.getContext("2d");
    if (c) m.forEach((row, y) => row.forEach((col, x) => { if (col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); } }));
  }
  iconCache.set(id, cv);
  return cv;
}

function sun(c: CanvasRenderingContext2D, x: number, y: number): void {
  c.fillStyle = "#f6c945";
  c.fillRect(x - 3, y - 2, 7, 5);
  c.fillRect(x - 2, y - 3, 5, 7);
  c.fillStyle = "#e0b33c";
  for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [-5, -5], [5, -5], [-5, 5], [5, 5]]) c.fillRect(x + dx, y + dy, 1, 1);
}

/** Paints `s` on a STEP_W × STEP_H context. */
export function drawStepScene(c: CanvasRenderingContext2D, s: StepScene): void {
  c.imageSmoothingEnabled = false;
  c.fillStyle = SKY;
  c.fillRect(0, 0, STEP_W, STEP_H);
  if (s.plot) {
    const look = {
      crop: s.plot.crop, stage: s.plot.stage, progress: 0.6, water: s.plot.water, pests: s.plot.pests, wobble: false,
      cut: 0, picked: 0, pickings: 1, seed: 4242,
    };
    c.drawImage(paintPlot(look, STEP_W, STEP_H - PLOT_Y), 0, PLOT_Y);
  } else {
    c.fillStyle = GROUND;
    c.fillRect(0, PLOT_Y + 8, STEP_W, STEP_H - PLOT_Y - 8);
    c.fillStyle = "#8fbf5a";
    c.fillRect(0, PLOT_Y + 8, STEP_W, 2);
  }
  if (s.extra === "sun") sun(c, 54, 9);
  if (s.extra === "harvester") drawHarvester(c, { x: 26, y: 30 }, 0, true);
  // the farmer (or cô Út) facing right with their feet low on the left
  const feet = { x: 16, y: 53 };
  const who = getCharacterFrames(s.who === "coUt" ? CO_UT_LOOK : DEFAULT_LOOK).right[0];
  c.drawImage(who, feet.x - 12, feet.y - 48);
  if (s.anim !== FARM_ANIM.stop) drawFarmAnim(c, feet, "right", s.anim, 0, true);
  if (s.extra === "rat") drawRat(c, "nibble0", -1, 50, 50);
  if (s.extra === "dog") drawDog(c, "vang", "left", "sit", 44, 54);
  // the items, top right
  s.icons.slice(0, 2).forEach((id, i) => {
    const ic = iconCanvas(id);
    if (ic) c.drawImage(ic, STEP_W - 18 - i * 17, s.extra === "sun" ? 18 : 2);
  });
}
