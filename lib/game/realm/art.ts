// v21 "world" (0075): original pixel art for the wild animals, the bosses, the dungeon gate and the hunter's stall.
// Everything is drawn with fillRect at the feet (x, y) in screen px, in the chibi world's palette; nothing is cached.
import type { BossId, WildSpeciesId } from "./model";

type Ctx = CanvasRenderingContext2D;

function px(b: Ctx, x: number, y: number, w: number, h: number, c: string): void {
  b.fillStyle = c;
  b.fillRect(Math.round(x), Math.round(y), w, h);
}

function shadow(b: Ctx, x: number, y: number, w: number): void {
  b.globalAlpha = 0.25;
  px(b, x - w / 2, y - 1, w, 2, "#1d1a14");
  px(b, x - w / 2 + 1, y - 2, w - 2, 1, "#1d1a14");
  b.globalAlpha = 1;
}

/** A wild animal standing at (x, y); `left` flips it, `step` (0/1) alternates the legs, `night` lights the eyes. */
export function drawAnimal(b: Ctx, sp: WildSpeciesId, x: number, y: number, left: boolean, step: number, night: boolean, t: number): void {
  // mirror around x: a rect at dx (from the feet, facing right) of width w
  const r = (dx: number, dy: number, w: number, h: number, c: string) => px(b, left ? x - dx - w : x + dx, y + dy, w, h, c);
  switch (sp) {
    case "rabbit": {
      shadow(b, x, y, 10);
      const hop = step ? -1 : 0;
      r(-5, -6 + hop, 9, 5, "#9c8a78"); r(-4, -3 + hop, 7, 2, "#e8ddd0");
      r(2, -9 + hop, 5, 5, "#a8957f"); r(3, -13 + hop, 1, 4, "#a8957f"); r(5, -13 + hop, 1, 4, "#c9a9a0");
      r(5, -7 + hop, 1, 1, "#1d1a14"); r(-6, -6 + hop, 2, 2, "#f4efe8");
      break;
    }
    case "bird": {
      const fy = y - 14 + Math.round(Math.sin(t / 300) * 2);
      shadow(b, x, y, 6);
      const wing = Math.floor(t / 120) % 2;
      const q = (dx: number, dy: number, w: number, h: number, c: string) => px(b, left ? x - dx - w : x + dx, fy + dy, w, h, c);
      q(-3, -2, 6, 3, "#8a5a36"); q(2, -3, 3, 3, "#7a4a2a"); q(5, -2, 1, 1, "#e0a030"); q(3, -2, 1, 1, "#111");
      q(-2, wing ? -5 : 0, 4, 2, "#6a4026"); q(-5, -1, 2, 1, "#6a4026");
      break;
    }
    case "deer": {
      shadow(b, x, y, 16);
      r(-7, -12, 13, 6, "#b07a44"); r(-6, -8, 11, 2, "#e8cfa4");
      for (const [dx, k] of [[-6, 0], [-3, 1], [2, 0], [4, 1]] as const) r(dx, -6, 1, step === k ? 6 : 5, "#6e4a28");
      r(5, -17, 3, 6, "#b07a44"); r(6, -20, 5, 4, "#b07a44"); r(10, -18, 1, 1, "#1d1a14"); r(9, -19, 1, 1, "#1d1a14");
      r(6, -24, 1, 4, "#e4d6b4"); r(8, -25, 1, 5, "#e4d6b4"); r(5, -23, 1, 1, "#e4d6b4"); r(9, -24, 1, 1, "#e4d6b4");
      r(-8, -12, 2, 2, "#f4efe8");
      for (const [dx, dy] of [[-4, -11], [0, -10], [2, -12]] as const) r(dx, dy, 1, 1, "#f4efe8");
      break;
    }
    case "fox": {
      shadow(b, x, y, 14);
      r(-6, -7, 10, 4, "#d8702a"); r(-5, -4, 8, 1, "#f2e6d6");
      r(3, -10, 5, 5, "#d8702a"); r(7, -8, 2, 2, "#f2e6d6"); r(3, -12, 1, 2, "#d8702a"); r(6, -12, 1, 2, "#d8702a");
      r(6, -9, 1, 1, night ? "#ffe066" : "#1d1a14");
      r(-11, -9 - step, 5, 3, "#d8702a"); r(-12, -9 - step, 2, 2, "#f4efe8");
      for (const [dx, k] of [[-5, 0], [2, 1]] as const) r(dx, -3, 1, step === k ? 3 : 2, "#3a2418");
      break;
    }
    case "wolf": {
      shadow(b, x, y, 18);
      r(-8, -10, 14, 6, "#6f7580"); r(-7, -5, 12, 1, "#9aa0aa");
      r(5, -14, 6, 6, "#6f7580"); r(10, -11, 3, 3, "#585d66"); r(5, -16, 2, 2, "#585d66"); r(8, -16, 2, 2, "#585d66");
      r(8, -12, 1, 1, night ? "#ff4040" : "#1d1a14");
      r(-13, -11 + step, 5, 2, "#585d66");
      for (const [dx, k] of [[-7, 0], [-4, 1], [1, 0], [4, 1]] as const) r(dx, -4, 2, step === k ? 4 : 3, "#484c54");
      if (night) { b.globalAlpha = 0.35; r(7, -13, 3, 3, "#ff4040"); b.globalAlpha = 1; }
      break;
    }
    case "bear": {
      shadow(b, x, y, 22);
      r(-10, -15, 19, 11, "#3b2a20"); r(-8, -6, 15, 2, "#2c1f18");
      r(7, -18, 8, 8, "#3b2a20"); r(7, -20, 2, 2, "#3b2a20"); r(13, -20, 2, 2, "#3b2a20"); r(12, -14, 3, 3, "#8a6a4a");
      r(11, -16, 1, 1, night ? "#ffb040" : "#0d0906");
      for (const [dx, k] of [[-9, 0], [-5, 1], [2, 0], [6, 1]] as const) r(dx, -4, 3, step === k ? 4 : 3, "#2c1f18");
      break;
    }
    // 0097 (forest-content): the rừng tràm's own
    case "chuot_dong": {
      shadow(b, x, y, 8);
      r(-4, -5, 8, 4, "#8a6a4a"); r(-3, -2, 6, 1, "#d8c4a8"); r(3, -6, 3, 3, "#8a6a4a"); r(4, -7, 1, 1, "#e0a8a0");
      r(5, -5, 1, 1, "#1d1a14"); r(-8, -3 - step, 4, 1, "#c8a090");
      break;
    }
    case "ga_rung": {
      shadow(b, x, y, 10);
      r(-4, -9, 8, 5, "#b8402a"); r(-3, -5, 6, 1, "#5a3a20"); r(3, -12, 3, 4, "#d84a2a"); r(4, -13, 1, 1, "#e02a2a");
      r(6, -11, 1, 1, "#e0c070"); r(4, -11, 1, 1, "#1d1a14"); r(-8, -12, 4, 4, "#2a4a3a");
      r(-1, -4, 1, step ? 4 : 3, "#c8a050"); r(2, -4, 1, step ? 3 : 4, "#c8a050");
      break;
    }
    case "ran_ri_ca": {
      shadow(b, x, y, 14);
      const w = step ? 1 : -1;
      r(-8, -2, 4, 2, "#4a5a2a"); r(-4, -3 + w, 4, 2, "#4a5a2a"); r(0, -2, 4, 2, "#4a5a2a"); r(4, -3 - w, 3, 2, "#4a5a2a");
      r(6, -4, 3, 3, "#3a4a20"); r(8, -3, 1, 1, "#1d1a14"); r(-6, -2, 1, 1, "#2e3a1a"); r(2, -2, 1, 1, "#2e3a1a");
      break;
    }
    case "cay_huong": {
      shadow(b, x, y, 12);
      r(-6, -7, 11, 4, "#8a7a5a"); for (const dx of [-4, -1, 2]) r(dx, -7, 1, 3, "#3a3020");
      r(4, -9, 4, 4, "#8a7a5a"); r(7, -7, 2, 2, "#f0e8d8"); r(6, -8, 1, 1, night ? "#ffe066" : "#1d1a14");
      r(-12, -6 - step, 6, 2, "#3a3020"); r(-4, -3, 1, step ? 3 : 2, "#2a2418"); r(3, -3, 1, step ? 2 : 3, "#2a2418");
      break;
    }
    case "co_trang": {
      shadow(b, x, y, 8);
      r(-3, -14, 6, 5, "#f4f2ea"); r(2, -19, 2, 6, "#f4f2ea"); r(3, -20, 3, 2, "#f8f6ee"); r(6, -19, 3, 1, "#e0b030");
      r(4, -20, 1, 1, "#1d1a14"); r(-4, -12, 2, 2, "#e8e6de"); r(-1, -9, 1, 9, "#3a3a30"); r(1, -9, 1, step ? 9 : 8, "#3a3a30");
      break;
    }
    case "rua_hop_lung_den": {
      shadow(b, x, y, 10);
      r(-5, -6, 10, 4, "#2a2a22"); r(-4, -7, 8, 1, "#3a3428"); r(-5, -2, 10, 1, "#c8b070");
      r(5, -5 + (step ? 0 : 1), 3, 2, "#8a7a4a"); r(7, -5, 1, 1, "#1d1a14"); r(-4, -2, 2, 2, "#8a7a4a"); r(3, -2, 2, 2, "#8a7a4a");
      break;
    }
    case "firefly": {
      const fy = y - 10 + Math.round(Math.sin(t / 400 + x) * 4);
      const on = 0.5 + 0.5 * Math.sin(t / 220 + y);
      const prev = b.globalCompositeOperation;
      b.globalCompositeOperation = "lighter";
      b.globalAlpha = 0.25 * on;
      px(b, x - 3, fy - 3, 7, 7, "#d8ff70");
      b.globalAlpha = 0.9 * on + 0.1;
      px(b, x - 1, fy - 1, 2, 2, "#f4ffb0");
      b.globalAlpha = 1;
      b.globalCompositeOperation = prev;
      break;
    }
  }
}

/** A boss at (x, y) (its feet), `hurt` flashes it, `phase` 3 enrages it (red eyes, a wider stance). */
export function drawBoss(b: Ctx, id: BossId, x: number, y: number, t: number, hurt: boolean, phase: number, reduced: boolean): void {
  const bob = reduced ? 0 : Math.round(Math.sin(t / 380) * 1.5);
  const rage = phase >= 3;
  const r = (dx: number, dy: number, w: number, h: number, c: string) => px(b, x + dx, y + dy + bob, w, h, c);
  b.globalAlpha = 0.3;
  px(b, x - 22, y - 2, 44, 4, "#14110c");
  b.globalAlpha = 1;
  switch (id) {
    case "trau_tinh": {
      r(-20, -30, 40, 22, "#3e3a3c"); r(-18, -9, 36, 3, "#2a2729");
      for (const dx of [-17, -8, 5, 13]) r(dx, -8, 5, 8, "#2a2729");
      r(14, -38, 16, 16, "#4a4547"); r(20, -26, 10, 5, "#6e6668"); r(21, -25, 2, 2, "#1a1718"); r(26, -25, 2, 2, "#1a1718");
      r(12, -44, 4, 6, "#e8dcc0"); r(8, -46, 6, 3, "#e8dcc0"); r(28, -44, 4, 6, "#e8dcc0"); r(30, -46, 6, 3, "#e8dcc0");
      r(17, -34, 3, 2, rage ? "#ff3030" : "#ffd040"); r(25, -34, 3, 2, rage ? "#ff3030" : "#ffd040");
      r(-24, -28, 4, 12, "#2a2729");
      break;
    }
    case "soi_ma": {
      b.globalAlpha = 0.8;
      r(-20, -26, 36, 16, "#5a6fa0"); r(-18, -11, 32, 2, "#8aa4d8");
      r(12, -34, 16, 14, "#6a80b4"); r(24, -28, 7, 5, "#5a6fa0"); r(12, -38, 4, 5, "#6a80b4"); r(22, -38, 4, 5, "#6a80b4");
      r(-30, -30 + Math.round(Math.sin(t / 200) * 2), 11, 5, "#8aa4d8");
      for (const dx of [-17, -9, 4, 11]) r(dx, -10, 4, 10, "#4a5a88");
      b.globalAlpha = 1;
      r(18, -30, 3, 2, "#a0f0ff"); r(24, -30, 3, 2, "#a0f0ff");
      if (!reduced) { b.globalAlpha = 0.35; r(-22, -40 + Math.round((t / 30) % 20), 2, 2, "#c0e0ff"); r(6, -44 + Math.round((t / 40) % 24), 2, 2, "#c0e0ff"); b.globalAlpha = 1; }
      break;
    }
    case "heo_rung": {
      r(-22, -26, 42, 20, "#5a3a24"); r(-20, -30, 30, 5, "#3a2416");
      for (let k = 0; k < 7; k++) r(-18 + k * 4, -33 - (k % 2), 2, 4, "#2a1a10");
      r(18, -26, 12, 14, "#6a4630"); r(28, -20, 5, 6, "#c49070"); r(29, -18, 1, 1, "#3a2416"); r(31, -18, 1, 1, "#3a2416");
      r(24, -15, 2, 6, "#f4ecd8"); r(20, -15, 2, 5, "#f4ecd8");
      r(22, -23, 2, 2, rage ? "#ff3030" : "#1a0f08");
      for (const dx of [-19, -10, 5, 13]) r(dx, -7, 5, 7, "#3a2416");
      break;
    }
    case "thuy_quai": {
      const wave = reduced ? 0 : t / 260;
      for (let k = 0; k < 6; k++) {
        const dy = Math.round(Math.sin(wave + k) * 3);
        r(-26 + k * 8, -14 + dy, 9, 9, k % 2 ? "#2f7a6a" : "#3a8e7a");
        r(-25 + k * 8, -6 + dy, 7, 2, "#a8e0c8");
      }
      r(20, -34, 14, 18, "#3a8e7a"); r(22, -38, 4, 5, "#2f7a6a"); r(28, -40, 4, 7, "#2f7a6a");
      r(23, -28, 3, 3, rage ? "#ff3030" : "#f0f060"); r(29, -28, 3, 3, rage ? "#ff3030" : "#f0f060");
      r(24, -21, 8, 2, "#1a3a34");
      b.globalAlpha = 0.5; r(-30, -3, 64, 3, "#b6dcee"); b.globalAlpha = 1;
      break;
    }
    case "nguoi_tuyet": {
      r(-14, -22, 28, 22, "#f4f8ff"); r(-12, -2, 24, 2, "#d8e4f4");
      r(-10, -40, 20, 18, "#ffffff"); r(-8, -24, 16, 2, "#d8e4f4");
      r(-10, -26, 20, 4, "#c83a3a"); r(6, -26, 4, 10, "#c83a3a");
      r(-4, -34, 2, 2, rage ? "#ff3030" : "#1d1a14"); r(3, -34, 2, 2, rage ? "#ff3030" : "#1d1a14"); r(0, -31, 6, 2, "#f08a2a");
      r(-8, -46, 16, 6, "#2a2a34"); r(-11, -41, 22, 2, "#2a2a34");
      r(-24, -18, 10, 2, "#6a4a2a"); r(14, -18, 10, 2, "#6a4a2a"); r(-26, -21, 2, 3, "#6a4a2a"); r(24, -21, 2, 3, "#6a4a2a");
      for (const dy of [-18, -12, -6]) r(-1, dy, 2, 2, "#2a2a34");
      break;
    }
  }
  if (hurt) {
    b.globalAlpha = 0.5;
    px(b, x - 24, y - 48 + bob, 48, 48, "#ffffff");
    b.globalAlpha = 1;
  }
}

/** The boss's HP bar and name over it. */
export function drawBossBar(b: Ctx, name: string, x: number, y: number, hp: number, max: number): void {
  const w = 64, f = Math.max(0, Math.min(1, hp / Math.max(1, max)));
  px(b, x - w / 2 - 1, y - 61, w + 2, 6, "#1d1a14");
  px(b, x - w / 2, y - 60, Math.round(w * f), 4, f > 0.66 ? "#58b04a" : f > 0.33 ? "#e0a030" : "#d83a3a");
  b.font = "8px monospace";
  b.textAlign = "center";
  b.fillStyle = "#1d1a14";
  b.fillText(name, Math.round(x) + 1, Math.round(y) - 64);
  b.fillStyle = "#fff4d0";
  b.fillText(name, Math.round(x), Math.round(y) - 65);
}

/** The dungeon gate: a stone arch into the dark, two torches. */
export function drawGate(b: Ctx, x: number, y: number, t: number, reduced: boolean): void {
  px(b, x - 18, y - 30, 36, 30, "#6e6a64"); px(b, x - 16, y - 28, 32, 2, "#8a857e");
  px(b, x - 10, y - 22, 20, 22, "#14110f"); px(b, x - 8, y - 24, 16, 2, "#14110f");
  for (const dx of [-16, 10]) for (let k = 0; k < 4; k++) px(b, x + dx, y - 26 + k * 7, 6, 1, "#56524c");
  for (const dx of [-22, 19]) {
    px(b, x + dx, y - 22, 3, 8, "#5a3a24");
    const fl = reduced ? 0 : Math.floor(t / 140) % 2;
    px(b, x + dx, y - 26 - fl, 3, 4, "#ffb030"); px(b, x + dx + 1, y - 27 - fl, 1, 2, "#fff0a0");
  }
}

/** The hunter's stall by day (pelts, a bow), the night market after dark (a lantern, a red awning). */
export function drawStall(b: Ctx, x: number, y: number, night: boolean, t: number, reduced: boolean): void {
  const awn = night ? "#b8322a" : "#5c8a3a", awn2 = night ? "#e8c040" : "#e8dcc0";
  for (const dx of [-18, 16]) px(b, x + dx, y - 26, 2, 26, "#5a3a24");
  for (let k = 0; k < 6; k++) px(b, x - 20 + k * 7, y - 30, 7, 5, k % 2 ? awn2 : awn);
  px(b, x - 18, y - 12, 36, 6, "#8a5a34"); px(b, x - 18, y - 6, 36, 2, "#5a3a24");
  px(b, x - 14, y - 15, 6, 3, "#d8702a"); px(b, x - 6, y - 16, 7, 4, "#6f7580"); px(b, x + 4, y - 15, 5, 3, "#9c8a78");
  if (night) {
    const on = reduced ? 1 : 0.85 + 0.15 * Math.sin(t / 200);
    px(b, x + 12, y - 25, 4, 5, "#e84a2a");
    b.globalAlpha = 0.25 * on; px(b, x + 6, y - 30, 16, 14, "#ffc060"); b.globalAlpha = 1;
  } else {
    px(b, x + 10, y - 24, 1, 10, "#6a4a2a"); px(b, x + 11, y - 25, 1, 1, "#6a4a2a"); px(b, x + 11, y - 14, 1, 1, "#6a4a2a");
  }
}
