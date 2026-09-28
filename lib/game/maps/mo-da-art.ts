import { drawText } from "./khu-nha-art";
import { ANVIL, CAULDRON, MINE_NODES, MO_H, MO_W, MO_WALL_H, SHED } from "./mo-da";
import { propSprite } from "./props";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type SceneArt, type SceneLight } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painter for Mỏ đá (v21 #19): a packed gravel floor with cart rails, the layered rock face along the north
// with timber props, the ore rocks (their veins drawn live: the colour of what each node holds, rubble while it grows
// back), glowing herb patches, chú Tám's plank shed, the anvil on its stump and bà Sáu's bubbling cauldron. Browser only
// (canvas). Original art in the approved Miền Tây style.

const M = {
  floor: "#7a6a58", floorDark: "#665846", floorLight: "#8c7c68", gravel: "#9a8a74",
  rock: "#6d655c", rockDark: "#4f4841", rockLight: "#8a8178", rockHi: "#a39a8e", crack: "#3a342f",
  rail: "#5b636b", railHi: "#8a939c", tie: "#6e4424",
  moss: "#3f6e23", herbGlow: "#9fe8a0", mush: "#c0503a", mushCap: "#e6d2b0",
  iron: "#3b4148", ironLight: "#8a939c", stump: "#6e4424",
  pot: "#26282c", potRim: "#4a4e56", brew: "#6fc26a", brewHi: "#b8f0a8", fire: "#e0703c", fireHi: "#ffd07a",
  roof: "#8a5a33", roofDark: "#6e4424", plank: "#a8743f",
};

/** The colour of each item's vein / patch (live). */
const VEIN: Readonly<Record<string, string>> = {
  ore_da: "#b0a898", ore_than: "#2a2622", ore_dong: "#d07a3a", ore_sat: "#a9b2bb", ore_bac: "#e8eef4",
  ore_vang: "#f2c93a", ore_ngoc: "#3ccf7a", ore_kimcuong: "#9be8ff", ore_tinhthe: "#ff5a3a",
  herb_nam: "#c0503a", herb_reu: "#9fe8a0", herb_linhchi: "#b8661c",
};

/** What the mine's nodes hold now: set by the mining hook from the server's state (item, ready time in client ms). */
export const mineView: { nodes: Map<number, { item: string; readyAtMs: number }> } = { nodes: new Map() };

function paintFloor(c: Ctx): void {
  const r = rng(7201);
  rect(c, M.floor, 0, 0, MO_W, MO_H);
  for (let k = 0; k < 2600; k++) px(c, r() < 0.5 ? M.floorDark : M.floorLight, Math.floor(r() * MO_W), Math.floor(r() * MO_H));
  for (let k = 0; k < 220; k++) {
    const x = Math.floor(r() * MO_W), y = MO_WALL_H + Math.floor(r() * (MO_H - MO_WALL_H));
    rect(c, M.gravel, x, y, 2, 1); px(c, M.floorDark, x, y + 1);
  }
  // the cart rails from the gate into the deep end
  for (let x = 12; x < 470; x += 6) rect(c, M.tie, x, 194, 3, 14);
  rect(c, M.rail, 12, 196, 458, 2); rect(c, M.rail, 12, 204, 458, 2);
  rect(c, M.railHi, 12, 196, 458, 1); rect(c, M.railHi, 12, 204, 458, 1);
}

function paintWalls(c: Ctx): void {
  const r = rng(7202);
  // the rock face in strata
  rect(c, M.rock, 0, 0, MO_W, MO_WALL_H);
  for (let y = 6; y < MO_WALL_H; y += 9) {
    for (let x = 0; x < MO_W; x++) px(c, M.rockDark, x, y + Math.round(Math.sin(x / 23 + y) * 2));
  }
  for (let k = 0; k < 900; k++) px(c, r() < 0.5 ? M.rockLight : M.rockDark, Math.floor(r() * MO_W), Math.floor(r() * MO_WALL_H));
  for (let k = 0; k < 10; k++) {
    let x = 20 + Math.floor(r() * 600), y = 4;
    for (let s = 0; s < 18; s++) { px(c, M.crack, x, y); y += 1; x += r() < 0.5 ? -1 : 1; }
  }
  // timber props every 96 px
  for (let x = 40; x < MO_W; x += 96) {
    rect(c, C.outline, x - 1, 8, 8, MO_WALL_H - 8); rect(c, C.woodDark, x, 8, 6, MO_WALL_H - 8); rect(c, C.woodLight, x, 8, 2, MO_WALL_H - 8);
  }
  rect(c, C.outline, 0, MO_WALL_H - 1, MO_W, 1);
  // west, east, south walls
  rect(c, M.rockDark, 0, MO_WALL_H, 12, MO_H - MO_WALL_H); rect(c, M.rock, 2, MO_WALL_H, 8, MO_H - MO_WALL_H);
  rect(c, M.floorDark, 0, 184, 12, 32);                                  // the gate's opening
  rect(c, C.woodDark, 0, 180, 14, 4); rect(c, C.woodDark, 10, 180, 4, 40);
  rect(c, M.rockDark, MO_W - 16, 0, 16, MO_H); rect(c, M.rock, MO_W - 14, MO_WALL_H, 12, MO_H - MO_WALL_H);
  rect(c, M.rockDark, 0, MO_H - 16, MO_W, 16); rect(c, M.rock, 0, MO_H - 14, MO_W, 12);
  for (let x = 0; x < MO_W; x += 20) rect(c, M.rockDark, x, MO_H - 14, 1, 12);
}

function paintRocks(c: Ctx): void {
  for (const n of MINE_NODES) {
    if (n.kind === "ore") {
      const { x, y, w, h } = n.rect;
      rect(c, C.outline, x - 1, y - 3, w + 2, h + 4);
      rect(c, M.rockDark, x, y - 2, w, h + 2);
      rect(c, M.rock, x + 1, y - 2, w - 4, h - 2);
      rect(c, M.rockLight, x + 3, y - 1, w - 10, 3);
      rect(c, M.rockHi, x + 4, y - 1, 3, 1);
      px(c, M.crack, x + w - 7, y + 4); px(c, M.crack, x + w - 6, y + 5); px(c, M.crack, x + w - 6, y + 6);
    } else {
      // a mossy patch; the growth on it is drawn live
      const { x, y, w, h } = n.rect;
      rect(c, M.moss, x + 2, y + 2, w - 4, h - 4);
      rect(c, M.moss, x, y + 4, w, h - 8);
      for (let k = 0; k < 12; k++) px(c, "#5a8f32", x + 2 + ((k * 7) % (w - 4)), y + 3 + ((k * 5) % (h - 6)));
    }
  }
}

function paintShed(c: Ctx): void {
  const x = SHED.x - 28, y = 200;
  // plank walls, the roof, the counter with a pickaxe on it and an ore scale
  rect(c, C.outline, x - 1, y - 1, 58, 60);
  rect(c, M.plank, x, y, 56, 58);
  for (let k = 0; k < 56; k += 7) rect(c, C.woodDark, x + k, y, 1, 58);
  rect(c, C.outline, x - 4, y - 8, 64, 10); rect(c, M.roof, x - 3, y - 7, 62, 8);
  for (let k = 0; k < 62; k += 4) rect(c, M.roofDark, x - 3 + k, y - 7, 1, 8);
  rect(c, "#2a2622", x + 12, y + 10, 32, 22);                            // the doorway, dark
  rect(c, C.outline, x - 1, y + 56, 58, 12); rect(c, C.woodLight, x, y + 57, 56, 10); rect(c, C.woodDark, x, y + 64, 56, 3);
  rect(c, C.woodDark, x + 8, y + 52, 12, 2); rect(c, M.ironLight, x + 18, y + 50, 6, 3);   // a pickaxe on the counter
  rect(c, M.iron, x + 38, y + 50, 10, 2); rect(c, M.ironLight, x + 42, y + 46, 2, 4);     // the scale
  drawText(c, C.paper, "MO DA", x + 18, y + 1);
}

function paintAnvil(c: Ctx): void {
  const { x, y } = ANVIL;
  rect(c, C.outline, x - 9, y - 9, 18, 10); rect(c, M.stump, x - 8, y - 8, 16, 9); rect(c, C.woodLight, x - 8, y - 8, 16, 2);
  rect(c, C.outline, x - 10, y - 17, 20, 9); rect(c, M.iron, x - 9, y - 16, 18, 4); rect(c, M.iron, x - 4, y - 12, 8, 4);
  rect(c, M.ironLight, x - 9, y - 16, 18, 1); rect(c, M.iron, x + 9, y - 15, 4, 2);
  rect(c, C.woodDark, x - 16, y - 4, 2, 8); rect(c, M.ironLight, x - 18, y - 6, 6, 3);        // the hammer beside it
}

function paintCauldron(c: Ctx): void {
  const { x, y } = CAULDRON;
  rect(c, C.outline, x - 13, y - 13, 26, 16); rect(c, M.pot, x - 12, y - 12, 24, 14); rect(c, M.potRim, x - 13, y - 14, 26, 3);
  rect(c, M.pot, x - 10, y + 2, 3, 3); rect(c, M.pot, x + 7, y + 2, 3, 3);
  // shelves of jars behind bà Sáu
  const sx = x + 22, sy = y - 44;
  rect(c, C.outline, sx - 1, sy - 1, 30, 26); rect(c, C.wood, sx, sy, 28, 24); rect(c, C.woodDark, sx, sy + 11, 28, 2);
  const jars = ["#6fc26a", "#c0503a", "#3d6fd1", "#e0b33c", "#9fe8a0", "#b8661c"];
  jars.forEach((col, k) => { const jx = sx + 2 + (k % 3) * 9, jy = sy + 3 + Math.floor(k / 3) * 12; rect(c, C.outline, jx, jy, 6, 8); rect(c, col, jx + 1, jy + 1, 4, 6); });
}

export function paintMoDa(map: GameMap): SceneArt {
  const background = makeCanvas(MO_W, MO_H);
  const g = ctx2d(background);
  paintFloor(g);
  paintWalls(g);
  paintRocks(g);
  paintShed(g);
  paintAnvil(g);
  paintCauldron(g);
  const props = map.props.map(propSprite);
  const drawAnimated = (c: Ctx, t: number, camX: number, camY: number, reducedMotion: boolean) => {
    const now = Date.now();
    for (const n of MINE_NODES) {
      const v = mineView.nodes.get(n.no);
      const ready = v !== undefined && v.readyAtMs <= now;
      const col = v ? VEIN[v.item] ?? "#ffffff" : null;
      const { x, y, w } = n.rect;
      if (n.kind === "ore") {
        if (ready && col) {
          // the vein: three nuggets, the rarer ones twinkle
          for (const [dx, dy] of [[5, 2], [11, 6], [15, 1]] as const) {
            rect(c, C.outline, x + dx - 1 - camX, y + dy - 1 - camY, 4, 4);
            rect(c, col, x + dx - camX, y + dy - camY, 2, 2);
          }
          if (!reducedMotion && Math.sin(t / 260 + n.no * 1.7) > 0.6) px(c, "#ffffff", x + 12 - camX, y + 2 - camY);
        } else if (v) {
          // rubble while it grows back
          for (let k = 0; k < 4; k++) rect(c, M.rockDark, x + 3 + k * 5 - camX, y + 10 - camY, 3, 2);
        }
      } else if (ready && col) {
        for (let k = 0; k < 3; k++) {
          const hx = x + 5 + k * 6 - camX, hy = n.rect.y + 3 + (k % 2) * 3 - camY;
          rect(c, M.mushCap, hx + 1, hy + 3, 1, 3);
          rect(c, col, hx, hy, 4, 3);
        }
        if (!reducedMotion && Math.sin(t / 400 + n.no) > 0.3) px(c, M.herbGlow, x + w / 2 - camX, n.rect.y - 2 - camY);
      }
    }
    // the cauldron bubbles over its fire
    const { x, y } = CAULDRON;
    const f = reducedMotion ? 0 : Math.floor(t / 140) % 3;
    rect(c, M.brew, x - 11 - camX, y - 12 - camY, 22, 3);
    rect(c, M.brewHi, x - 6 + f * 4 - camX, y - 13 - camY, 2, 2);
    rect(c, M.fire, x - 6 - camX, y + 2 - camY, 12, 3);
    rect(c, M.fireHi, x - 3 + f - camX, y + 1 - camY, 4, 2);
  };
  const drawOverhead = () => {};
  return { background, props, edge: M.rockDark, drawAnimated, drawOverhead, lights: MO_LIGHTS };
}

/** Oil lamps on the timber props, the shed's lamp and the cauldron's fire. */
const MO_LIGHTS: ReadonlyArray<SceneLight> = [
  ...[40, 232, 424, 616].map((x): SceneLight => ({ x: x + 3, y: MO_WALL_H + 6, r: 80, hue: "warm" })),
  { x: SHED.x, y: 270, r: 70, hue: "warm" },
  { x: CAULDRON.x, y: CAULDRON.y, r: 60, hue: "lantern" },
];
