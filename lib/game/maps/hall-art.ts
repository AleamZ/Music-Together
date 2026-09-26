import { CARD_DECK, HALL_H, HALL_W, LIGHT_STRINGS, hallShoreY } from "./hall";
import { propSprite } from "./props";
import { C, ctx2d, hexToRgb, makeCanvas, px, rect, rng, type Ctx, type SceneArt } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painters for the hall ("quán cà phê võng ven sông"). Browser only (canvas). Props live in props.ts,
// shared helpers in scene-art.ts. Original art in the approved Miền Tây style — no copied images.

// ---------------------------------------------------------------- ground

function inYard(x: number, y: number): boolean {
  const dx = (x - 330) / 245, dy = (y - 238) / 98;
  const n = Math.sin(x * 0.11) * 0.05 + Math.sin(y * 0.17 + x * 0.05) * 0.05;
  return dx * dx + dy * dy < 1 + n;
}

function onPath(x: number, y: number): boolean {
  if (x < 470) return false;
  const mid = 300 + Math.sin(x * 0.05) * 4;
  return Math.abs(y - mid) < 15 + Math.sin(x * 0.3) * 1.5;
}

function paintGround(c: Ctx): void {
  const R = rng(11);
  const img = c.createImageData(HALL_W, HALL_H);
  const d = img.data;
  const pal = {
    grass: hexToRgb(C.grass), grassLight: hexToRgb(C.grassLight), grassDark: hexToRgb(C.grassDark),
    dirt: hexToRgb(C.dirt), dirtDark: hexToRgb(C.dirtDark), dirtLight: hexToRgb(C.dirtLight),
    water: hexToRgb(C.water), waterDeep: hexToRgb(C.waterDeep), waterLight: hexToRgb(C.waterLight),
    sand: hexToRgb(C.sand), bank: hexToRgb(C.bank), mud: hexToRgb(C.mud),
  };
  for (let y = 0; y < HALL_H; y++) {
    for (let x = 0; x < HALL_W; x++) {
      const r = R();
      const sy = Math.round(hallShoreY(x));
      let col: [number, number, number];
      if (y >= sy) col = r < 0.04 ? pal.waterLight : y > sy + 24 ? pal.waterDeep : pal.water;
      else if (y === sy - 1) col = pal.mud;
      else if (y === sy - 2) col = pal.bank;
      else if (y === sy - 3) col = pal.sand;
      else if (inYard(x, y) || onPath(x, y)) col = r < 0.12 ? pal.dirtDark : r < 0.2 ? pal.dirtLight : pal.dirt;
      else col = r < 0.1 ? pal.grassLight : r < 0.17 ? pal.grassDark : pal.grass;
      const i = (y * HALL_W + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // grass tufts + flowers
  for (let i = 0; i < 520; i++) {
    const x = Math.floor(R() * HALL_W), y = Math.floor(R() * HALL_H);
    if (inYard(x, y) || onPath(x, y) || y > hallShoreY(x) - 6) continue;
    px(c, C.grassDeep, x, y); px(c, C.grassDeep, x - 1, y - 1); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x, y - 1);
    if (R() < 0.16) px(c, R() < 0.5 ? "#f6c945" : "#f29bb5", x + 2, y - 2);
  }
  // pebbles in the yard
  for (let i = 0; i < 90; i++) {
    const x = Math.floor(R() * HALL_W), y = Math.floor(R() * HALL_H);
    if (!inYard(x, y)) continue;
    px(c, "#a07a4a", x, y); px(c, "#e2c290", x, y - 1);
  }
}

function paintRiverDetails(c: Ctx): void {
  const R = rng(23);
  // water hyacinth (lục bình) clumps
  const clumps: Array<[number, number]> = [[40, 372], [150, 385], [262, 360], [330, 390], [420, 370], [585, 382], [622, 358]];
  for (const [cx, cy] of clumps) {
    for (let k = 0; k < 22; k++) {
      const a = R() * Math.PI * 2, dist = R() * 6;
      px(c, R() < 0.5 ? C.leaf : C.leafLight, cx + Math.cos(a) * dist * 1.5, cy + Math.sin(a) * dist * 0.7);
    }
    px(c, "#b58ad8", cx, cy - 3); px(c, "#d6b3ef", cx + 1, cy - 3); px(c, "#b58ad8", cx + 1, cy - 4); px(c, "#d6b3ef", cx - 2, cy - 2);
  }
  // dock (walkable, x 500–532)
  rect(c, C.outline, 499, 318, 34, 82);
  for (let y = 319; y < 400; y += 3) { rect(c, C.woodLight, 500, y, 32, 2); rect(c, C.wood, 500, y + 2, 32, 1); }
  rect(c, C.woodDeep, 500, 318, 2, 82); rect(c, C.woodDeep, 530, 318, 2, 82);
  // moored boat (xuồng ba lá)
  for (let by = 0; by < 8; by++) {
    const inset = Math.abs(3.5 - by) * 3;
    rect(c, by === 0 || by === 7 ? C.outline : C.woodDark, 540 + inset, 352 + by, 40 - inset * 2, 1);
  }
  rect(c, C.woodLight, 550, 355, 20, 2);
  rect(c, C.outline, 560, 342, 1, 11); rect(c, C.wood, 561, 342, 4, 2);
}

// ---------------------------------------------------------------- scenery painted into the background

function paintBamboo(c: Ctx): void {
  const R = rng(5);
  rect(c, "#4f8a30", 0, 0, 72, 150);
  // ragged leafy edge instead of a hard rectangle
  for (let y = 0; y < 158; y++) {
    const edge = 72 + Math.round(3 * Math.sin(y * 0.35) + 2 * Math.sin(y * 0.9));
    for (let x = 66; x < edge; x++) px(c, x > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let x = 0; x < 78; x++) {
    const edge = 150 + Math.round(3 * Math.sin(x * 0.4) + 2 * Math.sin(x * 1.1));
    for (let y = 146; y < edge; y++) px(c, y > edge - 2 ? C.leafDark : "#4f8a30", x, y);
  }
  for (let y = 0; y < 150; y++) for (let x = 0; x < 72; x++) if (R() < 0.08) px(c, "#44792a", x, y);
  for (let i = 0; i < 18; i++) {
    const x = 2 + i * 4 + Math.floor(R() * 2), top = Math.floor(R() * 20), bot = 142 + Math.floor(R() * 10);
    for (let y = top; y < bot; y++) {
      px(c, C.bamboo, x, y); px(c, C.bambooDark, x + 1, y);
      if ((y - top) % 9 === 0) { px(c, C.bambooNode, x, y); px(c, C.bambooNode, x + 1, y); }
    }
    for (let l = 0; l < 10; l++) {
      const ly = top + Math.floor(R() * (bot - top - 10)), dir = R() < 0.5 ? -1 : 1;
      for (let k = 0; k < 6; k++) px(c, k < 2 ? C.leafLight : C.leaf, x + dir * (k + 1), ly + Math.floor(k / 2));
    }
  }
}

function drawNote(c: Ctx, x: number, y: number, col: string): void {
  ["..##.", "..#.#", "..#..", "..#..", ".##..", "###..", ".#..."].forEach((r, j) => {
    for (let i = 0; i < r.length; i++) if (r.charAt(i) === "#") px(c, col, x + i, y + j);
  });
}

function paintStage(c: Ctx): void {
  // poles + banner
  rect(c, C.woodDeep, 243, 4, 3, 92); rect(c, C.woodDeep, 393, 4, 3, 92);
  rect(c, C.redDark, 246, 8, 148, 48); rect(c, C.red, 248, 10, 144, 44);
  rect(c, C.gold, 248, 50, 144, 2);
  for (let x = 250; x < 392; x += 8) { rect(c, C.redDark, x, 56, 4, 2); px(c, C.redDark, x + 1, 58); }
  drawNote(c, 262, 18, C.goldLight); drawNote(c, 272, 26, C.gold); drawNote(c, 364, 26, C.gold); drawNote(c, 374, 18, C.goldLight);
  // platform
  rect(c, C.outline, 231, 95, 178, 46);
  for (let x = 232; x < 408; x += 6) { rect(c, C.woodLight, x, 96, 5, 34); rect(c, C.wood, x + 5, 96, 1, 34); }
  rect(c, C.woodDark, 232, 130, 176, 10);
  for (let x = 236; x < 408; x += 12) rect(c, C.woodDeep, x, 131, 1, 9);
  rect(c, C.outline, 231, 140, 178, 1);
  // speaker cabinets (the cones are animated in drawAnimated)
  for (const sx of [250, 374]) {
    rect(c, C.speaker, sx, 58, 16, 38);
    rect(c, C.speakerFace, sx + 1, 59, 14, 36);
    rect(c, C.gold, sx + 1, 92, 14, 1);
  }
}

function paintCounter(c: Ctx): void {
  // striped awning
  rect(c, C.outline, 464, 34, 142, 16);
  for (let x = 465; x < 605; x += 6) rect(c, ((x - 465) / 6) % 2 === 0 ? C.red : C.white, x, 35, 6, 13);
  for (let x = 466; x < 604; x += 6) rect(c, ((x - 466) / 6) % 2 === 0 ? C.red : C.white, x, 48, 4, 2);
  // back wall + shelves with jars
  rect(c, C.woodDark, 466, 50, 138, 28);
  rect(c, C.woodDeep, 466, 60, 138, 1); rect(c, C.woodDeep, 466, 70, 138, 1);
  const R = rng(31);
  const jar = ["#e0b33c", "#d9534f", "#5fae6e", "#f4f1ea", "#3d86a8", "#f29bb5"];
  for (let x = 470; x < 600; x += 7) {
    rect(c, jar[Math.floor(R() * jar.length)], x, 55, 4, 5); px(c, C.outline, x + 1, 54);
    rect(c, jar[Math.floor(R() * jar.length)], x + 2, 65, 3, 5);
  }
  // counter top + front
  rect(c, C.outline, 464, 77, 142, 30);
  rect(c, C.woodPale, 465, 78, 140, 7);
  rect(c, "#e0b27a", 465, 78, 140, 1);
  for (let x = 465; x < 605; x += 8) { rect(c, C.woodLight, x, 85, 7, 20); rect(c, C.wood, x + 7, 85, 1, 20); }
  rect(c, C.woodDark, 465, 104, 140, 2);
  // glasses of cà phê sữa đá on the counter
  for (const gx of [482, 520, 566]) { rect(c, "#f4f1ea", gx, 74, 4, 5); rect(c, "#7a4a2a", gx + 1, 76, 2, 3); }
}

/** Góc đánh bài (v16 spec §15): a plank deck with a rope edge, a few floor lanterns and grass tufts at the edge. */
function paintCardCorner(c: Ctx): void {
  const R = rng(37);
  const { x: x0, y: y0, w, h } = CARD_DECK;
  const bottom = (x: number) => Math.min(y0 + h, Math.floor(hallShoreY(x)) - 5);
  const planks = ["#a8743f", "#b07c46", "#9c6c3a"];
  for (let x = x0; x < x0 + w; x++) {
    for (let y = y0; y < bottom(x); y++) {
      const row = Math.floor((y - y0) / 5);
      const joint = (x - x0 + row * 23) % 46 === 0;
      const seam = (y - y0) % 5 === 4;
      px(c, seam || joint ? C.woodDark : planks[row % 3], x, y);
    }
  }
  for (let i = 0; i < 140; i++) {
    const x = x0 + Math.floor(R() * w), y = y0 + Math.floor(R() * h);
    if (y < bottom(x) - 1 && (y - y0) % 5 !== 4) px(c, R() < 0.5 ? C.woodLight : "#8e5e32", x, y);
  }
  // the rope edge: a twisted rope along the deck, two tones
  const rope = (x: number, y: number, k: number) => px(c, k % 3 === 0 ? "#8a6a3f" : "#e0c27a", x, y);
  for (let x = x0; x < x0 + w; x++) {
    rope(x, y0, x);
    rope(x, bottom(x) - 1, x + 1);
  }
  for (let y = y0; y < bottom(x0); y++) rope(x0, y, y);
  for (let y = y0; y < bottom(x0 + w - 1); y++) rope(x0 + w - 1, y, y);
  // floor lanterns (đèn lồng) at the corners
  for (const [lx, ly] of [[68, 246], [237, 246], [70, 312]] as const) {
    rect(c, C.outline, lx - 2, ly - 5, 5, 7);
    rect(c, C.red, lx - 1, ly - 4, 3, 5); rect(c, C.goldLight, lx, ly - 3, 1, 3);
    rect(c, C.gold, lx - 1, ly - 6, 3, 1); rect(c, C.gold, lx - 1, ly + 2, 3, 1);
  }
  // grass tufts at the edge
  for (let i = 0; i < 40; i++) {
    const top = R() < 0.5;
    const x = x0 + Math.floor(R() * w), y = top ? y0 - 1 : bottom(x);
    px(c, C.grassDeep, x, y); px(c, C.grassTip, x + 1, y - 1); px(c, C.grassDark, x - 1, y - 1);
  }
}

// ---------------------------------------------------------------- public

/** Paint the hall once. Throws "canvas-2d-unavailable" when the browser has no 2D canvas. */
export function paintHall(map: GameMap): SceneArt {
  const background = makeCanvas(HALL_W, HALL_H);
  const g = ctx2d(background);
  paintGround(g);
  paintCardCorner(g);
  paintRiverDetails(g);
  paintBamboo(g);
  paintStage(g);
  paintCounter(g);
  const props = map.props.map(propSprite);

  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    const pulse = reducedMotion ? 0 : Math.sin(t / 110) > 0.2 ? 1 : 0;
    for (const sx of [250, 374]) {
      const x = sx - camX, y = 58 - camY;
      rect(c, C.cone, x + 5, y + 4, 6, 5); rect(c, C.coneCenter, x + 7, y + 6, 2, 2);
      rect(c, C.speakerFace, x + 2, y + 13, 12, 12);
      rect(c, C.cone, x + 3 - pulse, y + 14 - pulse, 10 + pulse * 2, 10 + pulse * 2);
      rect(c, C.coneCenter, x + 6, y + 17, 4, 4);
    }
    if (reducedMotion) return;
    for (let i = 0; i < 70; i++) {
      const sx = (i * 37 + Math.floor(t / 45)) % HALL_W;
      const sy = Math.round(hallShoreY(sx)) + 4 + ((i * 7) % 56);
      if (sy >= HALL_H) continue;
      px(c, C.sparkle, sx - camX, sy - camY);
      px(c, C.sparkle2, sx + 1 - camX, sy - camY);
    }
  };

  const drawOverhead = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    const bulbs = ["#ff6f91", "#ffd166", "#06d6a0", "#4cc9f0"];
    LIGHT_STRINGS.forEach(([x1, y1, x2, y2, sag], si) => {
      const n = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f + sag * Math.sin(Math.PI * f);
        px(c, C.outline, x - camX, y - camY);
        if (i % 7 === 3) {
          const k = Math.floor(i / 7);
          const on = reducedMotion || (k + Math.floor(t / 380) + si) % 3 !== 0;
          const col = on ? bulbs[k % 4] : "#8a7a6a";
          px(c, col, x - camX, y + 1 - camY);
          px(c, col, x - camX, y + 2 - camY);
        }
      }
    });
  };

  return { background, props, edge: C.waterDeep, drawAnimated, drawOverhead };
}
