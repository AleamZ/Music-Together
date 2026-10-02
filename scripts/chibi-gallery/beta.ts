import * as THREE from "three";
import { getCharacterFrames } from "@/lib/game/art/raster";
import { drawItem } from "@/lib/game/art/furniture";
import { APT_TILE } from "@/lib/game/housing/apartment";
import { BETA_GOLD, BETA_TITLE, isBetaTag } from "@/lib/game/beta/frame";
import { nameTagCanvas } from "@/lib/game/diorama/character/layer";
import { furnitureModel, FURNITURE3D_DESC } from "@/lib/game/diorama/world/furniture3d";
import { ModelMats } from "@/lib/game/diorama/world/models";
import { nameTag } from "@/lib/game/social";
import type { Look } from "@/lib/game/types";
import type { Sheet, Tile } from "./sheets";

// 0118 "Kỷ niệm Beta": the five keepsakes, the full set, the mascot and the β name frame, in 3D (betaSheets) and 2D
// (beta2dSheets: the sprites, the 2D furniture and the 2D / 3D name plates, drawn on a canvas).

const NAM: Look = { skin: "warm", hair: "short", hairColor: "black", hat: null, top: "top_tee_white", bottom: "bottom_pants_navy", shoes: "shoes_sneaker_white", neck: null, gender: "nam" };
const NU: Look = { skin: "light", hair: "long", hairColor: "brown", hat: null, top: "top_tee_white", bottom: "bottom_skirt_pleated", shoes: "shoes_sandal_brown", neck: null, gender: "nu" };
const TQ = -0.62;
const mats = new ModelMats();

const LOOKS: Array<{ look: Look; label: string }> = [
  { look: { ...NAM, shoes: "beta_dep" }, label: "Dép kỷ niệm Beta [beta_dep] (bậc 1)" },
  { look: { ...NAM, shoes: "beta_dep", hat: "beta_non" }, label: "+ Nón kỷ niệm Beta [beta_non] (bậc 2)" },
  { look: { ...NAM, shoes: "beta_dep", hat: "beta_non", bottom: "beta_quan" }, label: "+ Quần kỷ niệm Beta [beta_quan] (bậc 3)" },
  { look: { ...NAM, shoes: "beta_dep", hat: "beta_non", bottom: "beta_quan", top: "beta_ao" }, label: "+ Áo kỷ niệm Beta [beta_ao] (bậc 4) — huy hiệu β" },
  { look: { ...NAM, shoes: "beta_dep", hat: "beta_non", outfit: "beta_set" }, label: "Set đồ kỷ niệm Beta [beta_set] (bậc 5)" },
  { look: { ...NU, shoes: "beta_dep", hat: "beta_non", bottom: "beta_quan", top: "beta_ao" }, label: "nữ — Nón + Áo + Quần + Dép Beta" },
  { look: { ...NU, shoes: "beta_dep", hat: "beta_non", outfit: "beta_set" }, label: "nữ — Set đồ kỷ niệm Beta" },
];

/** A name plate as the 3D chibis carry it, as a sprite over the head. */
function plate(text: string, me: boolean): THREE.Object3D {
  const cv = nameTagCanvas(text, me);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  const h = 0.14;
  s.scale.set(h * (cv.width / cv.height), h, 1);
  s.position.set(0, 2.25, 0);
  return s;
}

export function betaSheets(): Sheet[] {
  const tiles: Tile[] = [];
  for (const { look, label } of LOOKS) {
    tiles.push({ look, yaw: 0, label: `${label} · trước`, zoom: 0.95, focusY: 0.95 });
    tiles.push({ look, yaw: TQ, label: `${label} · ¾`, zoom: 0.95, focusY: 0.95 });
  }
  tiles.push({ look: { ...NAM, top: "beta_ao", bottom: "beta_quan", shoes: "beta_dep", hat: "beta_non" }, yaw: 0, zoom: 2.2, focusY: 1.35, label: "cận cảnh — huy hiệu β vàng trên ngực, cổ áo vàng" });
  tiles.push({ look: { ...NAM, outfit: "beta_set", shoes: "beta_dep" }, yaw: Math.PI, zoom: 0.95, focusY: 0.95, label: "Set đồ Beta · sau lưng" });
  const framed = nameTag("Lan", { beta: 5, pgLevel: 3, pgTitle: BETA_TITLE });
  tiles.push({
    look: { ...NU, outfit: "beta_set", hat: "beta_non", shoes: "beta_dep" }, yaw: 0, label: `bảng tên 3D có khung β: "${framed}"`,
    noChibi: true, more: [{ look: { ...NU, outfit: "beta_set", hat: "beta_non", shoes: "beta_dep" }, x: 0, z: 0, yaw: 0 }],
    extra: () => plate(framed, false), cam: { eye: [0, 1.6, 4.4], at: [0, 1.25, 0] },
  });
  tiles.push({
    look: NAM, yaw: 0, label: `Linh vật Kỷ niệm Beta [beta_mascot] — ${FURNITURE3D_DESC.beta_mascot ?? "?"}`, noChibi: true,
    extra: () => furnitureModel(mats, "beta_mascot", 0) ?? new THREE.Group(), cam: { eye: [1.3, 1.5, 1.9], at: [0, 0.5, 0] },
  });
  return [{ name: "beta-3d", title: "0118 Kỷ niệm Beta — 3D: 5 món theo bậc, set đồ, huy hiệu β, bảng tên khung β, linh vật", cols: 4, tw: 300, th: 340, tiles }];
}

/** 2D: every keepsake on the sprite (4 facings, 6× scale), the 2D mascot, and the β name plates (2D engine and 3D). */
export function beta2dSheets(): Record<string, () => string> {
  return {
    "beta-2d": () => {
      const S = 6, cellH = 48 * S + 40, top = 56;
      const rows = LOOKS.length + 2;
      const out = document.createElement("canvas");
      out.width = 1300; out.height = top + rows * cellH;
      const g = out.getContext("2d") as CanvasRenderingContext2D;
      g.imageSmoothingEnabled = false;
      g.fillStyle = "#f4efe6"; g.fillRect(0, 0, out.width, out.height);
      g.fillStyle = "#2a1c18"; g.font = "bold 26px sans-serif";
      g.fillText("0118 Kỷ niệm Beta — 2D: sprite 4 hướng, linh vật, bảng tên khung β", 16, 38);
      LOOKS.forEach(({ look, label }, i) => {
        const y = top + i * cellH;
        const fr = getCharacterFrames(look);
        (["down", "left", "right", "up"] as const).forEach((f, k) => g.drawImage(fr[f][0], 16 + k * (24 * S + 8), y + 30, 24 * S, 48 * S));
        g.fillStyle = "#2a1c18"; g.font = "16px sans-serif"; g.fillText(label, 16, y + 20);
      });
      // the mascot, 2D (one tile, 10×)
      let y = top + LOOKS.length * cellH;
      g.fillStyle = "#2a1c18"; g.font = "16px sans-serif"; g.fillText("Linh vật Kỷ niệm Beta [beta_mascot] — 2D (căn hộ / nhà)", 16, y + 20);
      const t = document.createElement("canvas"); t.width = APT_TILE; t.height = APT_TILE;
      const tc = t.getContext("2d") as CanvasRenderingContext2D;
      tc.fillStyle = "#d8c8a8"; tc.fillRect(0, 0, APT_TILE, APT_TILE);
      drawItem(tc, { id: 1, item: "beta_mascot", x: 0, y: 0, rot: 0 }, 0);
      g.drawImage(t, 16, y + 30, APT_TILE * 14, APT_TILE * 14);
      // the name plates
      y = top + (LOOKS.length + 1) * cellH;
      g.fillStyle = "#2a1c18"; g.fillText("Bảng tên: 2D (bản đồ) và 3D, người chơi Beta (viền vàng) và người thường", 16, y + 20);
      const framed = nameTag("Lan", { beta: 5, pgLevel: 3, pgTitle: BETA_TITLE }), plain = nameTag("Tèo", { pgLevel: 3 });
      // the 2D engine's plate (engine.ts), at 4× its map scale
      [framed, plain].forEach((label, k) => {
        const s = 2.5, px = 16, py = y + 40 + k * 60;
        g.font = `${Math.round(4.4 * s * 2)}px monospace`;
        const w = Math.round(g.measureText(label).width + 3 * s * 2), h = Math.round(5.2 * s * 2);
        g.fillStyle = "rgba(58, 36, 24, 0.78)"; g.fillRect(px, py, w, h);
        if (isBetaTag(label)) { g.strokeStyle = BETA_GOLD; g.lineWidth = 3; g.strokeRect(px + 1.5, py + 1.5, w - 3, h - 3); }
        g.fillStyle = "#fbf3dc"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(label, px + w / 2, py + h / 2 + 1);
        g.textAlign = "start"; g.textBaseline = "alphabetic";
      });
      [framed, plain].forEach((label, k) => {
        const cv = nameTagCanvas(label, k === 0);
        g.drawImage(cv, 16, y + 170 + k * 50, cv.width * 0.5, cv.height * 0.5);
      });
      return out.toDataURL("image/png");
    },
  };
}
