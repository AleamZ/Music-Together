import type { Vec } from "@/lib/game/types";

// Pure mapping between the 2D map (world px, y down) and the diorama's 3D space (x right, y up, z towards the viewer).
// The map stays the authority: gameplay, collision and the server only ever see px; the diorama is a view of them.

/** World px per 3D unit: one 3D unit is 16 px (two map cells), so a 48 px character stands 3 units tall. */
export const PX_PER_UNIT = 16;

export interface MapSize { width: number; height: number }

/** px on the map → 3D ground point (x, z), centred on the map's middle. */
export function pxToWorld(p: Vec, size: MapSize): { x: number; z: number } {
  return { x: (p.x - size.width / 2) / PX_PER_UNIT, z: (p.y - size.height / 2) / PX_PER_UNIT };
}

/** 3D ground point (x, z) → px on the map. */
export function worldToPx(x: number, z: number, size: MapSize): Vec {
  return { x: x * PX_PER_UNIT + size.width / 2, y: z * PX_PER_UNIT + size.height / 2 };
}

/** A length in px → 3D units. */
export const pxLen = (px: number): number => px / PX_PER_UNIT;

export interface Ray { origin: readonly [number, number, number]; dir: readonly [number, number, number] }

/** Where a ray meets the horizontal plane y = `planeY` (null when it runs parallel or points away). */
export function rayPlaneY(ray: Ray, planeY = 0): { x: number; z: number } | null {
  const dy = ray.dir[1];
  if (Math.abs(dy) < 1e-9) return null;
  const t = (planeY - ray.origin[1]) / dy;
  if (t <= 0) return null;
  return { x: ray.origin[0] + ray.dir[0] * t, z: ray.origin[2] + ray.dir[2] * t };
}

/** A click/tap ray → the map px it points at on the ground, or null when it misses the map (off its edge, the sky). */
export function rayToMapPx(ray: Ray, size: MapSize, planeY = 0): Vec | null {
  const hit = rayPlaneY(ray, planeY);
  if (!hit) return null;
  const p = worldToPx(hit.x, hit.z, size);
  if (p.x < 0 || p.y < 0 || p.x >= size.width || p.y >= size.height) return null;
  return p;
}
