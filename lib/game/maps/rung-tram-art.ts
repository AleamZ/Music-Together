import { RT_EXIT, RT_H, RT_W, rtForest } from "./rung-tram";
import { C, ctx2d, makeCanvas, px, rect, rng, type Ctx, type SceneArt } from "./scene-art";
import type { GameMap } from "./types";

// Procedural painter for Rừng tràm (0097): the melaleuca forest's floor — dark peaty ground with leaf litter and ferns
// on the forest cells, reedy water-logged ground (lung) where the forest ends (solid), the trodden path out on the
// west. The trees themselves are drawn live (lib/game/forest/trees2d.ts). Browser only (canvas). Original pixel art.

const F = { floor: "#4f6a36", floorDark: "#3f5a2c", floorLight: "#6a8a44", litter: "#8a7a4a", fern: "#5a8a3a",
  lung: "#5a7a6a", lungDark: "#46665a", reed: "#9aa84a", path: "#a88a5a", pathDark: "#8a6e44" };

function paintGround(c: Ctx): void {
  const r = rng(9701);
  for (let y = 0; y < RT_H; y += 4) for (let x = 0; x < RT_W; x += 4) {
    const f = rtForest(x + 2, y + 2);
    rect(c, f ? (r() < 0.5 ? F.floor : F.floorDark) : (r() < 0.5 ? F.lung : F.lungDark), x, y, 4, 4);
  }
  for (let k = 0; k < 2600; k++) {
    const x = Math.floor(r() * RT_W), y = Math.floor(r() * RT_H);
    if (rtForest(x, y)) px(c, r() < 0.6 ? F.litter : F.floorLight, x, y);
    else if (r() < 0.5) { px(c, F.reed, x, y); px(c, F.reed, x, y - 1); }
  }
  for (let k = 0; k < 160; k++) {
    const x = Math.floor(r() * RT_W), y = Math.floor(r() * RT_H);
    if (!rtForest(x, y)) continue;
    for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-2, -2], [2, -2]] as const) px(c, F.fern, x + dx, y + dy);
  }
  // the trodden path out (west)
  for (let x = 0; x < 64; x++) {
    const w = x < RT_EXIT.w ? RT_EXIT.h : Math.max(8, RT_EXIT.h - (x - RT_EXIT.w));
    rect(c, F.path, x, RT_EXIT.y + (RT_EXIT.h - w) / 2, 1, w);
    if (x % 5 === 0) px(c, F.pathDark, x, RT_EXIT.y + RT_EXIT.h / 2);
  }
}

export function paintRungTram(map: GameMap): SceneArt {
  void map;
  const background = makeCanvas(RT_W, RT_H);
  paintGround(ctx2d(background));
  return {
    background, props: [], edge: C.grassDeep,
    drawAnimated() { /* the trees are live sprites (trees2d.ts) */ },
    drawOverhead() { /* no roofs in the forest */ },
    lights: [],
  };
}
