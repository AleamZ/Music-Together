import * as THREE from "three";
import { footprint, type Placed } from "@/lib/game/housing/apartment";
import { furnitureModel, SURFACE_COLORS } from "./furniture3d";
import { ModelMats, Paint } from "./models";

// Browser only (three): an interior (the v19.2 apartments, the v19.3 houses — InteriorStage's spaces) as a 3D cutaway
// room for the 3D mode: the floor in the floor surface's pattern, the back wall (the 2D room's wall rows) in its
// wallpaper with the window and the clock, low side walls, the front open (a dollhouse) with the door's mat, and every
// placed item as its 3D model (furniture3d.ts) at its tile and rotation. The room's px map 1:1 onto the people layer
// (coords.ts pxToWorld with the room's size): tile (q, r) is centred at x = q + ½ − cols/2, z = r + ½ − rows/2.

export interface RoomSpec {
  /** Size in tiles and the first floor row (the rows above are the back wall, as in 2D). */
  cols: number;
  rows: number;
  wallRows: number;
  wall: string | null;
  floor: string | null;
  items: readonly Placed[];
  /** The door's tile columns on the front edge (the apartments' 6–7). */
  door?: readonly number[];
}

export const WALL_H = 2.8;

const FLOOR_PATTERN: Record<string, (q: number, r: number) => 0 | 1> = {
  floor_go: (q, r) => ((r + (q >> 1)) % 2 ? 0 : 1),
  floor_gach: (q, r) => ((q + r) % 2 ? 0 : 1),
  floor_da: (q, r) => ((q + r) % 2 ? 0 : 1),
};

/** The shell (floor, walls, window, clock, mat) as one outlined mesh plus the items. */
export function buildRoom(mats: ModelMats, spec: RoomSpec): THREE.Group {
  const g = new THREE.Group();
  const { cols, rows, wallRows } = spec;
  const ox = -cols / 2, oz = -rows / 2, backZ = oz + wallRows;
  const [fa, fb] = SURFACE_COLORS[spec.floor ?? "plain_floor"] ?? SURFACE_COLORS.plain_floor;
  const [wa, wb] = SURFACE_COLORS[spec.wall ?? "plain_wall"] ?? SURFACE_COLORS.plain_wall;
  // the floor: one tile per cell (pattern from the surface), on a slab — not outlined (it is the ground)
  const fl = new Paint(0.04);
  fl.box(cols + 0.3, 0.2, rows - wallRows + 0.3, 0x6e4a28, 0, -0.1, backZ + (rows - wallRows) / 2);
  const pat = FLOOR_PATTERN[spec.floor ?? ""] ?? ((q: number, r: number) => ((q + r) % 2 ? 0 : 1));
  for (let r = wallRows; r < rows; r++) for (let q = 0; q < cols; q++) {
    fl.box(0.98, 0.02, 0.98, pat(q, r) ? fa : fb, ox + q + 0.5, 0.01, oz + r + 0.5);
    if (spec.floor === "floor_gach") fl.box(0.4, 0.024, 0.4, (q + r) % 2 ? fb : fa, ox + q + 0.5, 0.012, oz + r + 0.5, 0, Math.PI / 4);
  }
  const floor = mats.baked1(fl, false)!;
  floor.receiveShadow = true;
  g.add(floor);
  // the walls: the back wall (with a wainscot line and a baseboard), the two side walls; outlined
  const w = new Paint(0.03);
  w.box(cols + 0.3, WALL_H, 0.2, wa, 0, WALL_H / 2, backZ - 0.1)
    .box(cols + 0.3, 0.16, 0.24, 0x6e4a28, 0, 0.08, backZ - 0.08);
  if (spec.wall === "wall_go") for (let x = -cols / 2 + 0.5; x < cols / 2; x += 0.5) w.box(0.03, WALL_H - 0.2, 0.03, wb, x, WALL_H / 2, backZ + 0.01);
  else for (let y = 0.6; y < WALL_H; y += 0.5) w.box(cols + 0.28, 0.02, 0.03, wb, 0, y, backZ + 0.01);
  for (const sx of [-1, 1]) w.box(0.2, WALL_H * 0.55, rows - wallRows + 0.3, wa, sx * (cols / 2 + 0.05), WALL_H * 0.275, backZ + (rows - wallRows) / 2 - 0.15)
    .box(0.24, 0.16, rows - wallRows + 0.3, 0x6e4a28, sx * (cols / 2 + 0.05), 0.08, backZ + (rows - wallRows) / 2 - 0.15);
  // the window (the evening outside) and the wall clock, as in the 2D room
  const wx = ox + 2.5;
  w.box(2.1, 1.4, 0.06, 0x6e4a28, wx, 1.7, backZ + 0.03).box(1.8, 0.6, 0.07, 0xf0b070, wx, 1.95, backZ + 0.04)
    .box(1.8, 0.5, 0.07, 0xc87858, wx, 1.4, backZ + 0.04).box(0.1, 1.15, 0.08, 0x6e4a28, wx, 1.7, backZ + 0.05);
  w.add(new THREE.CylinderGeometry(0.35, 0.35, 0.06, 16), 0xf4f1ea, cols / 2 - 2.3, 2.0, backZ + 0.05, Math.PI / 2)
    .box(0.04, 0.22, 0.02, 0x2a1c18, cols / 2 - 2.3, 2.07, backZ + 0.09).box(0.16, 0.04, 0.02, 0x2a1c18, cols / 2 - 2.24, 2.0, backZ + 0.09);
  // the door's mat at the front edge
  const door = spec.door ?? [Math.floor(cols / 2) - 1, Math.floor(cols / 2)];
  const dx = ox + (door[0] + door[door.length - 1] + 1) / 2;
  w.box(door.length - 0.4, 0.03, 0.65, 0xa8743f, dx, 0.03, rows / 2 - 0.5);
  g.add(mats.creature1(w)!);
  // the items
  for (const p of spec.items) {
    const m = furnitureModel(mats, p.item, p.rot);
    const fp = footprint(p.item, p.rot);
    if (!m || !fp) continue;
    m.position.set(ox + p.x + fp.w / 2, 0, oz + p.y + fp.h / 2);
    g.add(m);
  }
  return g;
}

/** cô Hồng's motel room (lib/game/art/motel.ts paintMotelRoom: 10 × 6.5 tiles) as a 3D room: the bed, the bedside
 *  lamp, the standing fan, a rug, the window — the 2D room's pieces mapped onto the catalogue's models. */
export function motelRoomSpec(): RoomSpec {
  return {
    cols: 10, rows: 7, wallRows: 2, wall: "wall_hong", floor: "floor_gach", door: [6, 7],
    items: [
      { id: 1, item: "bed_hiendai", x: 1, y: 3, rot: 0 }, { id: 2, item: "lamp_ban", x: 3, y: 2, rot: 0 },
      { id: 3, item: "rug_tron", x: 4, y: 4, rot: 0 }, { id: 4, item: "plant_trau", x: 9, y: 2, rot: 0 },
      { id: 5, item: "chair_maytre", x: 8, y: 3, rot: 1 },
    ],
  };
}
