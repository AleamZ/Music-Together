import * as THREE from "three";
import { GEAR_ICONS } from "@/lib/game/art/gear";
import { fishSpeciesGeometry, ModelMats, Paint } from "../world/models";
import type { CharAct, Pose } from "./pose";

// The things a chibi holds (3D wave 1): the tool for each action (the 2D farm-anim.ts props as toon models — the
// sickle, the hoe, the shovel, the sprayer's wand, the pump, the baskets, the ná…), the woodcutter's axe and the chef's
// pan, the pickaxe, the umbrella, the camera, the bowl and cup, the fish in hand, and the rod's look from the fishing
// v3 loadout (the rod's colour, a reel or none, the bobber). Each is one outlined vertex-coloured mesh (one draw call
// while shown), built once and shared. Geometry frame: the fist at the origin, the handle along +z (out of the fist),
// a blade/head at the far end pointing −y; the rig turns it by `grip` about x.

export type ToolId = "axe" | "pan" | "pickaxe" | "sickle" | "sling" | "sprayer" | "pump" | "shovel" | "hoe" | "seedlings"
  | "crab_basket" | "snail_basket" | "fert_bag" | "pick_basket" | "umbrella" | "camera" | "bowl" | "chopsticks" | "cup";
export const TOOL_IDS: readonly ToolId[] = ["axe", "pan", "pickaxe", "sickle", "sling", "sprayer", "pump", "shovel", "hoe", "seedlings",
  "crab_basket", "snail_basket", "fert_bag", "pick_basket", "umbrella", "camera", "bowl", "chopsticks", "cup"];

/** What each action holds: the right hand's and the left hand's (absent = empty). */
export const ACT_TOOL: Readonly<Partial<Record<CharAct, { R?: ToolId; L?: ToolId }>>> = {
  chop: { R: "axe" }, cook: { R: "pan" }, mine: { R: "pickaxe" },
  transplant: { L: "seedlings" }, harvest: { R: "sickle" }, pump: { R: "pump" }, spray: { R: "sprayer" }, fertilize: { L: "fert_bag" },
  crab: { L: "crab_basket" }, snails: { L: "snail_basket" }, prepare: { R: "hoe" }, dig: { R: "shovel" }, pick: { L: "pick_basket" },
  aim: { L: "sling" }, photo: { R: "camera" }, eat: { R: "chopsticks", L: "bowl" }, drink: { R: "cup" },
};

/** Vietnamese labels for the wave-1 actions (the dev lab, the review sheet). */
export const WAVE1_LABEL: Readonly<Record<string, string>> = {
  transplant: "Cấy lúa", harvest: "Gặt lúa", pump: "Bơm nước", spray: "Phun thuốc", fertilize: "Bón phân", crab: "Bắt cua",
  snails: "Nhặt ốc", prepare: "Làm đất", dig: "Đào khoai", pick: "Hái/bẻ", pet: "Vuốt chó", aim: "Bắn ná", show_catch: "Khoe cá",
  faint: "Ngất", sleep: "Ngủ", exhausted: "Kiệt sức", hammock: "Nằm võng", eat: "Ăn", drink: "Uống", photo: "Chụp ảnh", mine: "Đào mỏ",
};

const WOOD = 0x8b5a33, WOOD_D = 0x6e4424, STEEL = 0x5a5f68, EDGE = 0xe8e8ee, BASKET = 0xc8a46a, BASKET_D = 0xa8844f;

/** A handle along +z from `z0` to `z1`. */
function handle(p: Paint, z0: number, z1: number, r = 0.035, hex = WOOD): void {
  p.add(new THREE.CylinderGeometry(r, r, z1 - z0, 6), hex, 0, 0, (z0 + z1) / 2, Math.PI / 2);
}

/** A woven basket (open top, rim, a handle loop) hanging from the fist. */
function basket(p: Paint, w: number, h: number, inside?: (p: Paint, top: number) => void): void {
  const y = -0.06 - h / 2;
  p.add(new THREE.CylinderGeometry(w / 2, w * 0.38, h, 9, 1, true), BASKET, 0, y, 0.04);
  p.add(new THREE.CylinderGeometry(w * 0.38, w * 0.38, 0.02, 9), BASKET_D, 0, y - h / 2, 0.04);
  p.add(new THREE.TorusGeometry(w / 2, 0.018, 4, 10), BASKET_D, 0, y + h / 2, 0.04, Math.PI / 2);
  p.add(new THREE.TorusGeometry(w * 0.42, 0.014, 4, 8, Math.PI), BASKET_D, 0, y + h / 2, 0.04);
  for (let i = 0; i < 3; i++) p.add(new THREE.TorusGeometry(w * (0.47 - i * 0.04), 0.008, 3, 10), BASKET_D, 0, y + h * (0.25 - i * 0.25), 0.04, Math.PI / 2);
  inside?.(p, y + h / 2);
}

/** The tools' paint jobs and their grips (radians about x: 0 = across the fist pointing forward when the arm hangs). */
const TOOLS: Readonly<Record<ToolId, { grip: number; paint: (p: Paint) => void }>> = {
  axe: { grip: 0.2, paint: (p) => {
    handle(p, -0.08, 0.62);
    p.box(0.05, 0.2, 0.14, STEEL, 0, -0.06, 0.56).box(0.052, 0.05, 0.15, EDGE, 0, -0.17, 0.56);
  } },
  pan: { grip: 0.35, paint: (p) => {
    handle(p, -0.05, 0.28, 0.025, 0x2a2420);
    p.add(new THREE.CylinderGeometry(0.2, 0.17, 0.06, 12), 0x3a3a40, 0, 0, 0.47);
    p.add(new THREE.CylinderGeometry(0.17, 0.17, 0.01, 12), 0xd8a050, 0, 0.03, 0.47);       // something frying
  } },
  pickaxe: { grip: 0.2, paint: (p) => {
    handle(p, -0.08, 0.62);
    p.add(new THREE.ConeGeometry(0.035, 0.26, 5), STEEL, 0, -0.13, 0.58, Math.PI);
    p.add(new THREE.ConeGeometry(0.035, 0.22, 5), STEEL, 0, 0.11, 0.58);
  } },
  sickle: { grip: 0.3, paint: (p) => {
    handle(p, -0.05, 0.16, 0.03);
    p.add(new THREE.TorusGeometry(0.13, 0.016, 3, 10, Math.PI * 1.1), STEEL, 0, -0.1, 0.24, 0, Math.PI / 2, Math.PI * 0.45);
  } },
  sling: { grip: 1.2, paint: (p) => {
    handle(p, -0.02, 0.12, 0.022);
    for (const sd of [-1, 1]) p.add(new THREE.CylinderGeometry(0.018, 0.018, 0.14, 5), WOOD, sd * 0.05, 0, 0.18, Math.PI / 2, 0, -sd * 0.4);
    p.box(0.11, 0.012, 0.012, 0x2e2a2a, 0, 0, 0.25);
  } },
  sprayer: { grip: 0.25, paint: (p) => {
    p.add(new THREE.CylinderGeometry(0.1, 0.1, 0.26, 8), 0xe0b33c, 0.02, -0.22, -0.02);    // the tank hanging off the hand
    handle(p, 0, 0.62, 0.014, 0x3a3a3a);                                                        // the wand
    p.add(new THREE.ConeGeometry(0.03, 0.06, 6), 0x2a2420, 0, 0, 0.65, Math.PI / 2);
  } },
  pump: { grip: 1.35, paint: (p) => {
    p.box(0.2, 0.025, 0.025, WOOD_D, 0, 0, 0);                                                   // the T handle in the fist
    handle(p, 0, 0.26, 0.012, 0xb8bcc2);
    p.add(new THREE.CylinderGeometry(0.05, 0.05, 0.42, 8), 0x3a6a9a, 0, 0, 0.45, Math.PI / 2);
    p.box(0.18, 0.02, 0.1, 0x3a6a9a, 0, 0, 0.66);
  } },
  shovel: { grip: 0.25, paint: (p) => {
    handle(p, -0.1, 0.62);
    p.box(0.14, 0.035, 0.03, WOOD_D, 0, 0, -0.1);
    p.add(new THREE.BoxGeometry(0.16, 0.012, 0.2), STEEL, 0, 0, 0.72, 0, 0, 0);
  } },
  hoe: { grip: 0.2, paint: (p) => {
    handle(p, -0.08, 0.66);
    p.box(0.16, 0.18, 0.02, STEEL, 0, -0.08, 0.64).box(0.162, 0.03, 0.022, EDGE, 0, -0.16, 0.64);
  } },
  seedlings: { grip: 1.4, paint: (p) => {
    for (let i = 0; i < 7; i++) p.add(new THREE.ConeGeometry(0.014, 0.26, 3), i % 2 ? 0x6fbf4a : 0x4f9a38, (i - 3) * 0.012, 0.1, (i % 3) * 0.01, 0, 0, (i - 3) * 0.06);
    p.add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 6), 0x8b5a33, 0, 0, 0);
    p.add(new THREE.SphereGeometry(0.04, 6, 4), 0x5a3f20, 0, -0.06, 0);                         // the mud on the roots
  } },
  crab_basket: { grip: 0, paint: (p) => basket(p, 0.2, 0.16, (q, top) => {
    q.add(new THREE.SphereGeometry(0.05, 6, 4), 0xb8432f, 0, top + 0.01, 0.04, 0, 0, 0, 1.3, 0.6, 1);
    for (const sd of [-1, 1]) q.add(new THREE.SphereGeometry(0.022, 5, 3), 0xd9776a, sd * 0.07, top + 0.02, 0.07);
  }) },
  snail_basket: { grip: 0, paint: (p) => basket(p, 0.18, 0.14, (q, top) => {
    for (let i = 0; i < 3; i++) q.add(new THREE.ConeGeometry(0.03, 0.06, 6), i ? 0x8a5a2b : 0xc9955a, (i - 1) * 0.05, top + 0.01, 0.04 + (i % 2) * 0.02);
  }) },
  fert_bag: { grip: 0, paint: (p) => {
    p.add(new THREE.BoxGeometry(0.2, 0.24, 0.12), 0xf4efe0, 0, -0.18, 0.04);
    p.box(0.202, 0.05, 0.122, 0x3a7a3a, 0, -0.16, 0.04);
  } },
  pick_basket: { grip: 0, paint: (p) => basket(p, 0.22, 0.16, (q, top) => {
    q.add(new THREE.CylinderGeometry(0.03, 0.025, 0.12, 6), 0xf6c945, -0.04, top, 0.04, 0, 0, 0.9);
    q.add(new THREE.ConeGeometry(0.02, 0.09, 5), 0xd8342a, 0.05, top + 0.01, 0.05, 0, 0, -1.2);
  }) },
  umbrella: { grip: 1.45, paint: (p) => {
    handle(p, -0.08, 0.9, 0.015, 0x2a2420);
    p.add(new THREE.ConeGeometry(0.62, 0.26, 10, 1, true), 0x3a6aa8, 0, 0, 0.92, Math.PI / 2);
    p.add(new THREE.ConeGeometry(0.64, 0.02, 10, 1, true), 0xf4f1ea, 0, 0, 0.79, Math.PI / 2);
    p.add(new THREE.TorusGeometry(0.05, 0.012, 4, 6, Math.PI), 0x2a2420, 0, -0.05, -0.08, 0, Math.PI / 2);
  } },
  camera: { grip: 1.3, paint: (p) => {
    p.box(0.22, 0.14, 0.08, 0x2a2a30, 0.08, 0, 0.06);
    p.add(new THREE.CylinderGeometry(0.045, 0.05, 0.07, 10), 0x5a5f68, 0.08, 0, 0.13, Math.PI / 2);
    p.box(0.04, 0.03, 0.02, 0xf4f1ea, 0.15, 0.08, 0.06);
  } },
  bowl: { grip: 1.5, paint: (p) => {
    p.add(new THREE.SphereGeometry(0.11, 10, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xf4f1ea, 0, 0.06, 0.06);
    p.add(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 10), 0xe8d8a8, 0, 0.055, 0.06);
    p.add(new THREE.TorusGeometry(0.105, 0.008, 3, 12), 0x3a6aa8, 0, 0.055, 0.06, Math.PI / 2);
  } },
  chopsticks: { grip: 0.4, paint: (p) => {
    for (const sd of [-1, 1]) p.add(new THREE.CylinderGeometry(0.007, 0.005, 0.26, 4), 0xc89a62, sd * 0.012, 0, 0.11, Math.PI / 2);
  } },
  cup: { grip: 0.3, paint: (p) => {
    p.add(new THREE.CylinderGeometry(0.06, 0.05, 0.13, 10, 1, true), 0xb8d8e8, 0, 0, 0.06, Math.PI / 2);
    p.add(new THREE.CylinderGeometry(0.055, 0.055, 0.01, 10), 0xc8742a, 0, 0, 0.1, Math.PI / 2);       // trà đá
  } },
};

let shared: ModelMats | null = null;
/** The one outlined vertex-colour toon material every held thing shares. */
export function heldMaterial(): THREE.Material {
  return (shared ??= new ModelMats()).creature;
}

const geos = new Map<string, THREE.BufferGeometry>();
function cached(key: string, build: () => Paint): THREE.BufferGeometry {
  let g = geos.get(key);
  if (!g) geos.set(key, (g = build().geometry(true)));
  return g;
}

/** A tool's outlined geometry and grip. */
export function toolGeometry(id: ToolId): { geo: THREE.BufferGeometry; grip: number } {
  const t = TOOLS[id];
  return { geo: cached(`tool:${id}`, () => { const p = new Paint(0.03); t.paint(p); return p; }), grip: t.grip };
}

/** A fish held in the fist by the body (the species' own model, fish3d.ts), crosswise. */
export function heldFishGeometry(speciesId: string): { geo: THREE.BufferGeometry; grip: number } {
  return { geo: fishSpeciesGeometry(speciesId), grip: 0 };
}

// ---- the rod's look: fishing v3 (rod item → colour, reel present/size, the bobber clipped to the butt guide) ----

/** What the angler has on the rod: the rod item, the reel item (null = none) and the bobber item (null = none). */
export interface RodLook { rod: string; reel: string | null; bobber: string | null }

/** The most painted colour of an item's 2D icon (gear.ts / gear-v3.ts), or `fallback`. */
export function iconColor(id: string | null, fallback: number): number {
  const ic = id ? GEAR_ICONS[id] : undefined;
  if (!ic) return fallback;
  const n = new Map<string, number>();
  for (const r of ic.rows) for (const c of r) if (c !== "." && c !== "o" && ic.pal[c]) n.set(c, (n.get(c) ?? 0) + 1);
  let best = "", bn = 0;
  for (const [c, k] of n) if (k > bn) { best = c; bn = k; }
  return best ? parseInt(ic.pal[best].replace("#", "").slice(0, 6), 16) : fallback;
}

/** The reel's size by item (reel_1000 small … reel_5000 big); 0 = no reel. */
export function reelSize(id: string | null): number {
  if (!id) return 0;
  const m = /reel_(\d+)/.exec(id);
  return m ? 0.75 + Number(m[1]) / 10000 : 1;
}

/** The rod's geometry for a look, in the chibi rod's own frame (build.ts buildRod: the fist at 0, the blank along +z,
 *  the reel hanging under it; units = world). The tip stays the farthest +z point (rig.rodTip). */
export function rodLookGeometry(l: RodLook): THREE.BufferGeometry {
  return cached(`rod:${l.rod}|${l.reel ?? "-"}|${l.bobber ?? "-"}`, () => {
    const p = new Paint(0.02);
    const V = 0.06, blank = iconColor(l.rod, 0x23313d);
    const bamboo = l.rod.includes("bamboo"), master = l.rod.includes("master");
    p.add(new THREE.CylinderGeometry(0.028, 0.028, 0.22, 7), 0xc89a62, 0, 0, -1.2 * V, Math.PI / 2);          // cork grip
    p.add(new THREE.SphereGeometry(0.032, 6, 4), 0x2a2420, 0, 0, -4.4 * V);
    // the blank: tapering segments that droop a little, alternating shade (bamboo: node rings; master: gold wraps)
    const n = 8, len = 3.3;
    for (let i = 0; i < n; i++) {
      const z0 = 0.13 + (i / n) * len, z1 = 0.13 + ((i + 1) / n) * len, r0 = 0.022 - i * 0.0022, droop = -(((i + 0.5) / n) ** 2) * 0.18;
      const shade = i % 2 ? blank : new THREE.Color(blank).multiplyScalar(0.85).getHex();
      p.add(new THREE.CylinderGeometry(Math.max(0.005, r0 - 0.002), r0, z1 - z0, 6), shade, 0, droop, (z0 + z1) / 2, Math.PI / 2 + 0.05 * (i / n));
      if (bamboo || master) p.add(new THREE.CylinderGeometry(r0 + 0.004, r0 + 0.004, 0.012, 6), master ? 0xe0b33c : 0x8a7a40, 0, droop, z1, Math.PI / 2);
    }
    const rs = reelSize(l.reel);
    if (rs > 0) {
      p.box(0.012, 0.045, 0.012, 0x3a3a3a, 0, -0.045, 2.6 * V);
      p.add(new THREE.CylinderGeometry(0.035 * rs, 0.035 * rs, 0.035 * rs, 10), iconColor(l.reel, 0xb8bcc2), 0, -0.09 * rs, 2.6 * V, 0, 0, Math.PI / 2);
      p.box(0.05 * rs, 0.008, 0.008, 0x2a2420, 0.035 * rs, -0.09 * rs, 2.6 * V);
    }
    for (const z of [0.85, 1.7, 2.65]) p.add(new THREE.TorusGeometry(0.012, 0.004, 3, 6), 0xc8ccd2, 0, -0.03 - (z / 3.4) ** 2 * 0.18, z);
    if (l.bobber) {                                                                                                // parked on the first guide
      const c = iconColor(l.bobber, 0xe0342a);
      p.add(new THREE.SphereGeometry(0.03, 6, 4), c, 0, -0.07, 0.85);
      p.add(new THREE.SphereGeometry(0.03, 6, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xf6f6f0, 0, -0.072, 0.85);
    }
    return p;
  });
}

/** The umbrella held up in the left fist (the 2D umbrella over the head): the upper arm forward, the forearm up. */
export function umbrellaArm(p: Pose): Pose {
  p.armL.x = 0.45; p.armL.z = 0.12; p.elbowL = 2.35;
  return p;
}

const NO_HANDS: ReadonlySet<CharAct> = new Set<CharAct>(["cast", "bite", "reel", "swim", "net_hold", "net_throw", "net_pull", "net_won",
  "faint", "sleep", "hammock", "stretch", "exhausted"]);

/** What the fists hold for an action, like the 2D drawGear: the rod's actions hold the rod only; a farm animation its
 *  tool; the catch held up (show_catch) or carried (a fish in hand, as 2D drawHeldFish) in the right fist; the umbrella
 *  (when the 2D one is up) in a free left fist. */
export function heldFor(act: CharAct, o: { fish?: string | null; umbrella?: boolean } = {}): { R: string | null; L: string | null } {
  if (NO_HANDS.has(act)) return { R: null, L: null };
  const t = ACT_TOOL[act];
  let R: string | null = t?.R ?? null, L: string | null = t?.L ?? null;
  if (act === "show_catch") R = o.fish ? `fish:${o.fish}` : null;
  else if (!t && o.fish) R = `fish:${o.fish}`;
  if (o.umbrella && !L && act !== "aim" && act !== "photo" && act !== "pump") L = "umbrella";
  return { R, L };
}
