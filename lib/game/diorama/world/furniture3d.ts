import * as THREE from "three";
import { FURNITURE, furnitureOf, type FurnitureStyle } from "@/lib/game/housing/apartment";
import { ModelMats, Paint } from "./models";

// Browser only (three, no DOM): a 3D toon model for every piece of the furniture catalogue (lib/game/housing/
// apartment.ts FURNITURE, drawn in 2D by lib/game/art/furniture.ts) in the chibis' style — chunky rounded-ish blocks,
// flat vertex colours and the black ink outline (the creatures' one-draw-call hull). Each item is ONE mesh; the
// wallpapers and floors are a small sample swatch (the interior builder lays them as the room's surfaces).
// Units: 1 = one 16-px tile; the model sits centred on its footprint (w × h tiles at rot 0), its back toward −z (the
// room's wall, as rot 0 in 2D), the floor at y = 0.

/** The style palettes (the 2D art's, as hex numbers). */
const S: Record<FurnitureStyle, { main: number; dark: number; light: number }> = {
  go: { main: 0x8b5a33, dark: 0x5a381e, light: 0xa8743f },
  hien_dai: { main: 0xc8ccd4, dark: 0x868b98, light: 0xeef0f4 },
  may_tre: { main: 0xd2a866, dark: 0x9a7440, light: 0xe8c890 },
};

/** The wallpapers' and floors' colours (furniture.ts WALLS / FLOORS). */
export const SURFACE_COLORS: Record<string, [number, number]> = {
  plain_wall: [0xe8e0cc, 0xd4c9b0], wall_kem: [0xf2e6c4, 0xe2d2a4], wall_xanh: [0xb8d8d0, 0x98c0b6], wall_hong: [0xf0c8c8, 0xdca8a8],
  wall_go: [0xa8743f, 0x8b5a33], plain_floor: [0xc9b48a, 0xbba67c], floor_gach: [0xe8dcc0, 0xb04a3a], floor_go: [0xb07a48, 0x9a6a3a],
  floor_da: [0xeef0f2, 0xd8dce2],
};

/** One line per id: what the 3D model is (the coverage table, the review sheet). */
export const FURNITURE3D_DESC: Record<string, string> = {
  bed_go: "wooden bed: carved headboard, white pillow, blue blanket", bed_hiendai: "modern bed: low grey frame, padded headboard",
  bed_maytre: "rattan bed: woven headboard, green blanket", table_go: "wooden table with a teapot and cups",
  table_hiendai: "glass-top table on a steel frame", table_maytre: "rattan tea table with a woven top",
  chair_go: "wooden chair", chair_hiendai: "armchair with a red cushion", chair_maytre: "rattan chair",
  sofa_go: "trường kỷ: carved wooden settee", sofa_hiendai: "felt sofa with cushions", lamp_go: "oil lamp on a stand",
  lamp_hiendai: "floor lamp", lamp_maytre: "red bamboo lantern on a stand", plant_mai: "yellow mai blossom in a pot",
  plant_trau: "pothos in a white pot", plant_tre: "potted bamboo", rug_do: "red rug with a gold border",
  rug_xanh: "blue rug", rug_chieu: "sedge mat (chiếu cói)", shelf_go: "wooden bookshelf with books",
  shelf_hiendai: "white bookshelf with books", tv: "TV on a low cabinet", fridge: "small fridge", fridge_big: "double-door fridge",
  wall_kem: "cream wall paint (swatch)", wall_xanh: "blue wallpaper (swatch)", wall_hong: "pink wallpaper (swatch)",
  wall_go: "wood panelling (swatch)", floor_gach: "patterned tiles (swatch)", floor_go: "wooden floor (swatch)",
  floor_da: "marble floor (swatch)", bed_tang: "bunk bed with a ladder", bed_doi: "double bed with a flowered quilt",
  cabinet_go: "wooden wardrobe", cabinet_hiendai: "glass-door cabinet", cabinet_maytre: "rattan cabinet",
  painting_sen: "lotus painting on an easel", painting_pho: "old-quarter painting on an easel", painting_bien: "sea painting on an easel",
  plant_lan: "orchid in a pot", plant_xuongrong: "cactus in a pot", plant_cau: "areca palm in a pot",
  beta_mascot: "Kỷ niệm Beta mascot: a cream chibi spirit with a gold β medallion on a gold-rimmed round pedestal",
  lamp_ban: "desk lamp", lamp_hoian: "Hội An silk lantern on a stand", rug_tron: "round rug with rings",
  rug_batu: "Persian rug", aquarium: "small fish tank on a cabinet", aquarium_big: "big fish tank on a cabinet",
};

const cyl = (r0: number, r1: number, h: number, n = 10) => new THREE.CylinderGeometry(r0, r1, h, n);

/** Legs at the four corners of a w × d top at height h. */
function legs(p: Paint, w: number, d: number, h: number, col: number, t = 0.07): void {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(t, h, t, col, sx * (w / 2 - t), h / 2, sz * (d / 2 - t));
}

/** A potted plant's pot. */
function pot(p: Paint, col: number): void {
  p.add(cyl(0.2, 0.15, 0.3, 10), col, 0, 0.15, 0).add(cyl(0.21, 0.21, 0.04, 10), col, 0, 0.3, 0).add(cyl(0.18, 0.18, 0.02, 10), 0x4a3020, 0, 0.31, 0);
}

/** Paints item `id`'s model into `p` (footprint w × d units at rot 0). False: unknown id. */
function paintItem(p: Paint, id: string): boolean {
  const f = furnitureOf(id);
  if (!f) return false;
  const s = S[f.style], w = Math.max(1, f.w), d = Math.max(1, f.h);
  switch (f.kind) {
    case "bed": {
      const blanket = id === "bed_go" ? 0x3d6fd1 : id === "bed_hiendai" ? 0x6a6e7a : id === "bed_doi" ? 0xf0a8b8 : id === "bed_tang" ? 0xd08a3a : 0x5caa4a;
      const fw = w - 0.2, fd = d - 0.15, fh = id === "bed_hiendai" ? 0.22 : 0.32;
      p.box(fw, fh, fd, s.main, 0, fh / 2, 0.05);
      p.box(fw - 0.1, 0.16, fd - 0.2, 0xf4f1ea, 0, fh + 0.08, 0.05);                            // the mattress
      p.box(fw, id === "bed_hiendai" ? 0.8 : 0.95, 0.12, s.dark, 0, 0.45, -d / 2 + 0.1);          // the headboard
      if (id === "bed_maytre") for (let i = -3; i <= 3; i++) p.box(0.04, 0.6, 0.03, s.light, (i / 7) * fw, 0.5, -d / 2 + 0.17);
      if (id === "bed_go") p.box(fw * 0.6, 0.12, 0.13, s.light, 0, 0.88, -d / 2 + 0.1);
      const pillows = id === "bed_doi" ? [-0.6, 0.6] : [0];
      for (const x of pillows) p.box(id === "bed_doi" ? 0.9 : 0.9, 0.14, 0.45, 0xffffff, x, fh + 0.22, -d / 2 + 0.5);
      p.box(fw - 0.06, 0.1, fd * 0.55, blanket, 0, fh + 0.2, d / 2 - fd * 0.3);
      if (id === "bed_doi") for (let i = 0; i < 6; i++) p.box(0.1, 0.02, 0.1, i % 2 ? 0xf6d24a : 0xd04a6a, -1 + i * 0.4, fh + 0.26, 0.4 + (i % 3) * 0.25);
      if (id === "bed_tang") {
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.box(0.1, 2.0, 0.1, s.dark, sx * (fw / 2 - 0.05), 1.0, sz * (fd / 2 - 0.05) + 0.05);
        p.box(fw, 0.14, fd, s.main, 0, 1.3, 0.05).box(fw - 0.1, 0.14, fd - 0.2, 0xf4f1ea, 0, 1.43, 0.05)
          .box(fw - 0.06, 0.08, fd * 0.55, 0x3d6fd1, 0, 1.52, d / 2 - fd * 0.3).box(0.8, 0.12, 0.4, 0xffffff, 0, 1.55, -d / 2 + 0.45);
        for (let y = 0.4; y < 1.4; y += 0.3) p.box(0.05, 0.05, 0.4, s.light, fw / 2 + 0.02, y, d / 2 - 0.4);   // the ladder's rungs
        p.box(0.05, 1.5, 0.05, s.light, fw / 2 + 0.02, 0.75, d / 2 - 0.2).box(0.05, 1.5, 0.05, s.light, fw / 2 + 0.02, 0.75, d / 2 - 0.6);
      }
      return true;
    }
    case "table": {
      const h = id === "table_maytre" ? 0.45 : 0.6, tw = w - 0.2, td = d - 0.25;
      if (id === "table_hiendai") {
        p.box(tw, 0.05, td, 0xa8d0e0, 0, h, 0).box(tw - 0.4, 0.02, 0.05, 0xd8f0f8, 0, h + 0.03, -td / 4);
        legs(p, tw, td, h, s.dark, 0.05);
      } else {
        p.box(tw, 0.08, td, s.main, 0, h, 0).box(tw - 0.1, 0.02, td - 0.1, s.light, 0, h + 0.05, 0);
        legs(p, tw, td, h, s.dark, 0.09);
        if (id === "table_maytre") { p.box(tw - 0.2, 0.04, td - 0.2, s.dark, 0, h * 0.35, 0); for (let i = -2; i <= 2; i++) p.box(0.03, 0.01, td - 0.15, s.dark, i * 0.3, h + 0.065, 0); }
        if (id === "table_go") {
          p.add(new THREE.SphereGeometry(0.13, 10, 7), 0xf4f1ea, 0, h + 0.15, 0, 0, 0, 0, 1, 0.85, 1).box(0.1, 0.04, 0.04, 0xf4f1ea, 0.15, h + 0.16, 0)
            .add(cyl(0.035, 0.035, 0.04, 8), 0x3d6fd1, 0, h + 0.27, 0);
          for (const x of [-0.35, 0.35]) p.add(cyl(0.05, 0.04, 0.07, 8), 0xf4f1ea, x, h + 0.09, 0.25);
        }
      }
      return true;
    }
    case "chair": {
      const seat = 0.45;
      if (id === "chair_hiendai") {
        p.box(0.75, 0.3, 0.7, 0x8a3434, 0, 0.3, 0.02).box(0.6, 0.12, 0.55, 0xb04a4a, 0, 0.5, 0.08)
          .box(0.75, 0.55, 0.16, 0x8a3434, 0, 0.6, -0.27).box(0.13, 0.25, 0.6, 0x8a3434, -0.33, 0.55, 0.02).box(0.13, 0.25, 0.6, 0x8a3434, 0.33, 0.55, 0.02);
        legs(p, 0.7, 0.62, 0.15, s.dark, 0.05);
      } else {
        p.box(0.62, 0.07, 0.6, s.main, 0, seat, 0.02);
        legs(p, 0.6, 0.58, seat, s.dark, 0.07);
        p.box(0.62, 0.55, 0.07, s.dark, 0, seat + 0.3, -0.28);
        if (id === "chair_maytre") for (let i = -2; i <= 2; i++) p.box(0.03, 0.45, 0.02, s.light, i * 0.11, seat + 0.3, -0.24);
        else p.box(0.5, 0.08, 0.04, s.light, 0, seat + 0.5, -0.25);
      }
      return true;
    }
    case "sofa": {
      const cloth = id === "sofa_hiendai" ? 0x6a7fa8 : s.main, back = id === "sofa_hiendai" ? 0x4a5f88 : s.dark;
      p.box(w - 0.1, 0.35, d - 0.1, cloth, 0, 0.3, 0.02).box(w - 0.1, 0.6, 0.2, back, 0, 0.6, -d / 2 + 0.15)
        .box(0.18, 0.3, d - 0.1, back, -w / 2 + 0.14, 0.6, 0.02).box(0.18, 0.3, d - 0.1, back, w / 2 - 0.14, 0.6, 0.02);
      legs(p, w - 0.2, d - 0.2, 0.12, s.dark, 0.06);
      if (id === "sofa_hiendai") for (const x of [-0.85, 0, 0.85]) p.box(0.78, 0.12, 0.6, 0x7a8fb8, x, 0.53, 0.08);
      else p.box(w * 0.5, 0.1, 0.12, s.light, 0, 0.95, -d / 2 + 0.15);
      return true;
    }
    case "lamp": {
      if (id === "lamp_ban") {
        p.box(0.4, 0.5, 0.4, 0x5a381e, 0, 0.25, 0).add(cyl(0.1, 0.12, 0.05, 10), 0x3a3438, 0, 0.53, 0)
          .add(cyl(0.02, 0.02, 0.35, 6), 0x3a3438, 0, 0.72, 0).add(cyl(0.08, 0.16, 0.16, 10), 0x3d6fd1, 0, 0.92, 0.04, 0.3)
          .add(new THREE.SphereGeometry(0.05, 6, 4), 0xffe08a, 0, 0.86, 0.06);
      } else if (id === "lamp_hiendai") {
        p.add(cyl(0.16, 0.18, 0.05, 12), s.dark, 0, 0.03, 0).add(cyl(0.025, 0.025, 1.5, 6), s.dark, 0, 0.78, 0)
          .add(cyl(0.16, 0.26, 0.3, 12), 0xffe08a, 0, 1.6, 0);
      } else if (id === "lamp_go") {
        p.box(0.4, 0.5, 0.4, 0x8b5a33, 0, 0.25, 0).add(cyl(0.1, 0.13, 0.12, 10), 0x8b5a33, 0, 0.56, 0)
          .add(new THREE.SphereGeometry(0.11, 10, 7), 0xf6e8b0, 0, 0.74, 0, 0, 0, 0, 0.9, 1.2, 0.9).add(new THREE.ConeGeometry(0.04, 0.1, 6), 0xff9a3a, 0, 0.75, 0);
      } else {
        // lamp_maytre (red, gold bands) / lamp_hoian (yellow silk, red bands) hanging from a bamboo stand
        const silk = id === "lamp_hoian" ? 0xe0a020 : 0xc8282a, band = id === "lamp_hoian" ? 0xd9362b : 0xe0b040;
        p.add(cyl(0.18, 0.2, 0.05, 10), 0x6e4a28, 0, 0.03, 0).add(cyl(0.025, 0.025, 1.5, 6), 0xb8a050, 0, 0.75, -0.1)
          .box(0.04, 0.04, 0.3, 0xb8a050, 0, 1.48, 0.03)
          .add(new THREE.SphereGeometry(0.2, 12, 8), silk, 0, 1.15, 0.15, 0, 0, 0, 1, 1.25, 1)
          .add(cyl(0.12, 0.12, 0.04, 10), band, 0, 1.39, 0.15).add(cyl(0.12, 0.12, 0.04, 10), band, 0, 0.91, 0.15)
          .add(cyl(0.02, 0.0, 0.18, 5), band, 0, 0.8, 0.15);
      }
      return true;
    }
    case "plant": {
      if (id === "beta_mascot") {
        // 0118: a round pedestal, a cream chibi spirit (body, head, ears) holding a gold β medallion
        p.add(cyl(0.34, 0.38, 0.16, 16), 0xd4a72c, 0, 0.08, 0).add(cyl(0.3, 0.3, 0.06, 16), 0xf6ecd2, 0, 0.19, 0)
          .add(new THREE.SphereGeometry(0.22, 12, 8), 0xf6ecd2, 0, 0.42, 0, 0, 0, 0, 1, 1.1, 0.9)
          .add(new THREE.SphereGeometry(0.2, 12, 8), 0xfffaf0, 0, 0.78, 0)
          .add(new THREE.ConeGeometry(0.06, 0.14, 6), 0xf6ecd2, -0.12, 0.98, 0, 0, 0, 0.35)
          .add(new THREE.ConeGeometry(0.06, 0.14, 6), 0xf6ecd2, 0.12, 0.98, 0, 0, 0, -0.35)
          .add(new THREE.SphereGeometry(0.025, 6, 4), 0x2a1e1c, -0.07, 0.8, 0.18).add(new THREE.SphereGeometry(0.025, 6, 4), 0x2a1e1c, 0.07, 0.8, 0.18)
          .add(cyl(0.11, 0.11, 0.03, 14), 0xd4a72c, 0, 0.44, 0.2, Math.PI / 2, 0, 0)
          .box(0.025, 0.12, 0.012, 0x7a5a10, -0.025, 0.44, 0.22).box(0.04, 0.025, 0.012, 0x7a5a10, 0.01, 0.48, 0.22)
          .box(0.04, 0.025, 0.012, 0x7a5a10, 0.01, 0.43, 0.22).box(0.02, 0.05, 0.012, 0x7a5a10, 0.035, 0.455, 0.22);
        return true;
      }
      pot(p, id === "plant_trau" ? 0xe8e0d0 : 0xb0503a);
      if (id === "plant_mai") {
        p.add(cyl(0.03, 0.05, 0.7, 6), 0x5a381e, 0, 0.65, 0).add(cyl(0.02, 0.03, 0.4, 5), 0x5a381e, 0.12, 0.8, 0, 0, 0, -0.7)
          .add(cyl(0.02, 0.03, 0.35, 5), 0x5a381e, -0.1, 0.75, 0.05, 0.3, 0, 0.8);
        for (let i = 0; i < 14; i++) { const a = i * 2.1; p.add(new THREE.OctahedronGeometry(0.05), i % 3 ? 0xf6d24a : 0xffe880, Math.cos(a) * (0.1 + (i % 4) * 0.06), 0.8 + (i % 5) * 0.08, Math.sin(a) * 0.15); }
      } else if (id === "plant_trau") {
        for (let i = 0; i < 9; i++) { const a = i * 0.7; p.add(new THREE.SphereGeometry(0.1, 6, 4), i % 2 ? 0x3f8a3a : 0x5caa4a, Math.cos(a) * 0.18, 0.42 + (i % 3) * 0.12, Math.sin(a) * 0.18, 0, a, 0, 1, 0.35, 1.4); }
      } else if (id === "plant_tre") {
        for (const [x, z, h] of [[-0.08, 0, 1.1], [0.07, 0.05, 0.9], [0, -0.07, 1.25]] as const) {
          p.add(cyl(0.03, 0.03, h, 6), 0x9ab83a, x, 0.3 + h / 2, z);
          for (let y = 0.5; y < h; y += 0.3) p.add(cyl(0.035, 0.035, 0.03, 6), 0x6a8a2a, x, 0.3 + y, z);
          p.box(0.2, 0.02, 0.06, 0x5caa4a, x + 0.1, 0.3 + h, z, 0, 0, 0.4);
        }
      } else if (id === "plant_lan") {
        for (const [x, h] of [[-0.06, 0.45], [0.06, 0.55]] as const) p.add(cyl(0.012, 0.012, h, 4), 0x2c6a42, x, 0.3 + h / 2, 0);
        for (let i = 0; i < 5; i++) p.add(new THREE.SphereGeometry(0.06, 6, 4), 0xe8a0d8, -0.12 + i * 0.07, 0.68 + (i % 2) * 0.12, 0.04, 0, 0, 0, 1.2, 0.8, 0.5);
        p.box(0.4, 0.03, 0.1, 0x3f8a5a, 0, 0.34, 0, 0, 0.5);
      } else if (id === "plant_xuongrong") {
        p.add(cyl(0.11, 0.12, 0.6, 8), 0x4a9a4a, 0, 0.6, 0).add(new THREE.SphereGeometry(0.11, 8, 5), 0x4a9a4a, 0, 0.9, 0)
          .add(cyl(0.06, 0.06, 0.25, 6), 0x4a9a4a, 0.18, 0.62, 0).add(cyl(0.06, 0.06, 0.12, 6), 0x4a9a4a, 0.12, 0.5, 0, 0, 0, Math.PI / 2)
          .add(new THREE.SphereGeometry(0.05, 6, 4), 0xf07aa6, 0, 1.01, 0);
      } else {
        // plant_cau: the areca palm, a trunk and arching fronds
        p.add(cyl(0.04, 0.06, 0.9, 6), 0x7a5a3a, 0, 0.75, 0);
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; p.box(0.5, 0.02, 0.12, 0x2e7a3a, Math.cos(a) * 0.22, 1.18, Math.sin(a) * 0.22, 0, -a, -0.45); }
        p.add(new THREE.SphereGeometry(0.04, 5, 4), 0xe0b040, 0.05, 1.12, 0.05);
      }
      return true;
    }
    case "rug": {
      if (id === "rug_tron") {
        ["#c0603a", "#e8c070", "#6a9a8a", "#f4e8d0"].forEach((c, i) => p.add(cyl(0.95 - i * 0.22, 0.95 - i * 0.22, 0.02, 24), Number.parseInt(c.slice(1), 16), 0, 0.01 + i * 0.004, 0));
        return true;
      }
      const [a, b] = id === "rug_do" ? [0xb03a3a, 0xe0b040] : id === "rug_xanh" ? [0x2e6a9a, 0xd8e4f0] : id === "rug_batu" ? [0x8a1f28, 0xe0b040] : [0xd8c080, 0xa88a50];
      const rw = w - 0.1, rd = d - 0.1;
      p.box(rw, 0.02, rd, a, 0, 0.01, 0);
      if (id === "rug_batu") p.box(rw - 0.15, 0.022, rd - 0.15, 0x1f2a5a, 0, 0.012, 0).box(rw - 0.4, 0.024, rd - 0.4, 0x8a1f28, 0, 0.013, 0)
        .box(0.9, 0.026, 0.9, 0xe0b040, 0, 0.014, 0, 0, Math.PI / 4).box(0.4, 0.028, 0.4, 0x1f2a5a, 0, 0.015, 0, 0, Math.PI / 4);
      else if (id === "rug_chieu") for (let z = -rd / 2 + 0.15; z < rd / 2; z += 0.15) p.box(rw - 0.2, 0.022, 0.03, b, 0, 0.012, z);
      else {
        for (const z of [-rd / 2 + 0.15, rd / 2 - 0.15]) p.box(rw - 0.2, 0.022, 0.05, b, 0, 0.012, z);
        for (const x of [-rw / 2 + 0.15, rw / 2 - 0.15]) p.box(0.05, 0.022, rd - 0.2, b, x, 0.012, 0);
        p.box(0.5, 0.024, 0.5, b, 0, 0.013, 0).box(0.25, 0.026, 0.25, a, 0, 0.014, 0);
      }
      return true;
    }
    case "shelf": {
      const h = 1.6, sw = w - 0.1, sd = 0.45, z = -d / 2 + sd / 2 + 0.05;
      p.box(sw, h, 0.05, s.dark, 0, h / 2, z - sd / 2 + 0.03).box(0.06, h, sd, s.main, -sw / 2, h / 2, z).box(0.06, h, sd, s.main, sw / 2, h / 2, z);
      const books = [0xb03a3a, 0x3d6fd1, 0xe0b040, 0x3f8a5a, 0x8a4ab0];
      for (let r = 0; r < 4; r++) {
        const y = 0.04 + r * 0.4;
        p.box(sw, 0.05, sd, s.main, 0, y, z);
        if (r < 3) for (let k = 0; k < 9; k++) p.box(0.12, 0.26 + (k % 3) * 0.03, 0.3, books[(k + r) % 5], -sw / 2 + 0.15 + k * 0.19, y + 0.17, z);
      }
      p.box(sw, 0.05, sd, s.main, 0, h, z);
      return true;
    }
    case "tv": {
      p.box(w - 0.1, 0.45, 0.6, 0x5a381e, 0, 0.225, -0.15).box(w - 0.3, 0.05, 0.02, 0x8b5a33, 0, 0.3, 0.16)
        .box(1.5, 0.9, 0.08, 0x1a1a20, 0, 0.95, -0.3).box(1.38, 0.78, 0.02, 0x20242c, 0, 0.95, -0.25)
        .box(0.3, 0.08, 0.2, 0x1a1a20, 0, 0.49, -0.3).box(0.08, 0.06, 0.02, 0x3d86a8, 0.6, 0.6, -0.25);
      return true;
    }
    case "fridge": {
      const big = id === "fridge_big", fw = w - 0.15, h = big ? 1.75 : 1.2;
      p.box(fw, h, 0.75, 0xf4f6f8, 0, h / 2, -0.05).box(fw - 0.02, 0.02, 0.76, 0xd8dce2, 0, h * 0.62, -0.05);
      if (big) p.box(0.02, h - 0.1, 0.76, 0xc0c6ce, 0, h / 2, -0.05);
      for (const x of big ? [-0.12, 0.12] : [fw / 2 - 0.12]) p.box(0.04, 0.35, 0.05, 0x868b98, x, h * 0.78, 0.35).box(0.04, 0.25, 0.05, 0x868b98, x, h * 0.4, 0.35);
      p.box(0.1, 0.07, 0.02, 0x8ac4e0, -fw / 4, h * 0.85, 0.33);
      return true;
    }
    case "cabinet": {
      const h = id === "cabinet_maytre" ? 1.2 : 1.8, cw = w - 0.15, cz = -0.1;
      if (id === "cabinet_hiendai") {
        p.box(cw, h, 0.6, 0xeef0f4, 0, h / 2, cz).box(cw / 2 - 0.12, h - 0.25, 0.02, 0xa8d0e0, -cw / 4, h / 2, cz + 0.3).box(cw / 2 - 0.12, h - 0.25, 0.02, 0xa8d0e0, cw / 4, h / 2, cz + 0.3);
        for (let y = 0.5; y < h - 0.2; y += 0.45) p.box(cw - 0.2, 0.03, 0.4, 0xd8dce2, 0, y, cz);
        p.box(0.04, 0.2, 0.04, 0x868b98, -0.05, h / 2, cz + 0.32).box(0.04, 0.2, 0.04, 0x868b98, 0.05, h / 2, cz + 0.32);
      } else {
        p.box(cw, h, 0.6, s.main, 0, h / 2, cz).box(cw + 0.06, 0.08, 0.66, s.dark, 0, h + 0.04, cz).box(cw + 0.04, 0.1, 0.64, s.dark, 0, 0.05, cz);
        if (id === "cabinet_maytre") for (let y = 0.2; y < h - 0.1; y += 0.12) p.box(cw - 0.1, 0.03, 0.02, s.light, 0, y, cz + 0.31);
        else { p.box(0.02, h - 0.2, 0.02, s.dark, 0, h / 2, cz + 0.31); for (const x of [-cw / 4, cw / 4]) p.box(cw / 2 - 0.2, h - 0.5, 0.02, s.light, x, h / 2, cz + 0.305); }
        p.box(0.05, 0.12, 0.04, 0x5a381e, -0.07, h / 2, cz + 0.33).box(0.05, 0.12, 0.04, 0x5a381e, 0.07, h / 2, cz + 0.33);
      }
      return true;
    }
    case "painting": {
      // on an easel (as the 2D art stands it): the frame and its picture
      const pw = id === "painting_bien" ? 0.75 : 1.4, ph = 0.75, y = 1.05;
      p.box(0.06, 1.5, 0.06, 0x5a381e, -pw / 2 + 0.1, 0.72, -0.05, -0.15).box(0.06, 1.5, 0.06, 0x5a381e, pw / 2 - 0.1, 0.72, -0.05, -0.15)
        .box(0.06, 1.3, 0.06, 0x5a381e, 0, 0.62, -0.32, 0.28).box(pw + 0.1, 0.06, 0.12, 0x5a381e, 0, y - ph / 2 - 0.04, 0.05);
      p.box(pw + 0.08, ph + 0.08, 0.06, id === "painting_pho" ? 0x3a3438 : 0xc09040, 0, y, 0.02, -0.15);
      const front = (hex: number, x: number, yy: number, ww: number, hh: number) => p.box(ww, hh, 0.02, hex, x, y + yy, 0.07 - yy * 0.15, -0.15);
      if (id === "painting_sen") {
        front(0xe8dcb8, 0, 0, pw - 0.04, ph - 0.04); front(0x3f8a5a, 0, -0.22, pw - 0.2, 0.08);
        for (const x of [-0.4, 0, 0.4]) { front(0x2e6a44, x, -0.05, 0.03, 0.35); front(0xf07aa6, x, 0.15, 0.12, 0.1); }
      } else if (id === "painting_pho") {
        front(0xf0b070, 0, ph / 4, pw - 0.04, ph / 2 - 0.02); front(0xc87858, 0, -ph / 4, pw - 0.04, ph / 2 - 0.02);
        for (let k = 0; k < 4; k++) front([0xe0b040, 0xd9362b, 0x3d6fd1][k % 3], -0.5 + k * 0.33, -0.05, 0.25, 0.45);
      } else {
        front(0x8ac4e0, 0, ph / 4, pw - 0.04, ph / 2 - 0.02); front(0x2f86d6, 0, -ph / 4 + 0.05, pw - 0.04, ph / 2 - 0.12);
        front(0xe8d8a8, 0, -ph / 2 + 0.06, pw - 0.04, 0.08); front(0xf6d24a, 0.22, 0.22, 0.1, 0.1);
      }
      return true;
    }
    case "aquarium": {
      const aw = w - 0.15;
      p.box(aw, 0.6, 0.6, 0x5a381e, 0, 0.3, -0.1).box(aw - 0.06, 0.55, 0.5, 0x5aa8c8, 0, 0.88, -0.1)
        .box(aw, 0.06, 0.56, 0x3a3438, 0, 1.18, -0.1).box(aw - 0.1, 0.08, 0.46, 0xe8d8a8, 0, 0.64, -0.1);
      for (let i = 0; i < (w > 2 ? 4 : 2); i++) p.box(0.14, 0.07, 0.03, [0xe0a040, 0xf07a6a, 0xf4e8d0, 0x5caa4a][i], -aw / 2 + 0.35 + i * 0.6, 0.8 + (i % 2) * 0.15, 0.16);
      p.box(0.03, 0.3, 0.03, 0x2e8a4a, aw / 2 - 0.2, 0.8, -0.1).box(0.03, 0.22, 0.03, 0x2e8a4a, aw / 2 - 0.28, 0.76, -0.05);
      return true;
    }
    case "wall":
    case "floor": {
      // a swatch: a little sample board on a stand (the room builder paints the real surfaces)
      const [a, b] = SURFACE_COLORS[id] ?? [0xcccccc, 0x999999];
      if (f.kind === "wall") {
        p.box(0.9, 0.9, 0.06, a, 0, 0.55, 0).box(0.9, 0.06, 0.07, b, 0, 0.35, 0).box(0.9, 0.06, 0.07, b, 0, 0.75, 0).box(0.5, 0.1, 0.3, 0x6e4a28, 0, 0.05, 0);
      } else {
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) p.box(0.44, 0.06, 0.44, (i + j) % 2 ? a : b, -0.23 + i * 0.46, 0.03, -0.23 + j * 0.46);
      }
      return true;
    }
    default:
      return false;
  }
}

const cache = new Map<string, THREE.BufferGeometry>();

/** The shared (cached) outlined geometry of item `id`, or null (no such item). */
export function furnitureGeometry(id: string): THREE.BufferGeometry | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const p = new Paint(0.06);
  if (!paintItem(p, id)) return null;
  const g = p.geometry(true);
  cache.set(id, g);
  return g;
}

/** Every catalogue id that has a 3D model (the unit test checks it is all of them). */
export const furniture3dIds = (): string[] => FURNITURE.map((f) => f.id).filter((id) => furnitureGeometry(id) !== null);

/** The 2D rotation (0 front, 1 west, 2 the wall, 3 east) as a yaw. */
export const ROT_YAW = [0, -Math.PI / 2, Math.PI, Math.PI / 2] as const;

/** One item as a mesh, centred on its footprint at rot `rot`. */
export function furnitureModel(mats: ModelMats, id: string, rot = 0): THREE.Mesh | null {
  const g = furnitureGeometry(id);
  if (!g) return null;
  const m = new THREE.Mesh(g, mats.creature);
  m.castShadow = true;
  m.receiveShadow = true;
  m.rotation.y = ROT_YAW[((rot % 4) + 4) % 4];
  m.name = `furn:${id}`;
  return m;
}
