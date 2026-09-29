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

// Absolute mode (the unified world, spec §2 "3D: absolute coords (px/16)"): no centring — world px (0, 0) is the 3D
// origin, so chunks of one big world line up. `origin` is a zone's offset in the world (lib/game/world/zones.ts) when
// the px are zone-local. Nothing renders with it yet (P2); the centred pxToWorld above stays the renderer's.

/** px (zone-local with the zone's `origin`, or world px) → 3D ground point (x, z), absolute. */
export function pxToWorldAbs(p: Vec, origin: Vec = { x: 0, y: 0 }): { x: number; z: number } {
  return { x: (p.x + origin.x) / PX_PER_UNIT, z: (p.y + origin.y) / PX_PER_UNIT };
}

/** Absolute 3D ground point (x, z) → px (world px, or zone-local with the zone's `origin`). */
export function worldAbsToPx(x: number, z: number, origin: Vec = { x: 0, y: 0 }): Vec {
  return { x: x * PX_PER_UNIT - origin.x, y: z * PX_PER_UNIT - origin.y };
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
