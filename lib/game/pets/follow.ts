// v18.12: the pets trailing their owners. Each client animates every pet itself from its owner's drawn position: the
// owner leaves a breadcrumb trail, and the pet walks to the point FOLLOW_GAP px back along it. Pure (no canvas).

import type { Facing, Vec } from "@/lib/game/types";
import { parsePetCode, type PetLook } from "./model";

export const FOLLOW_GAP = 14;
/** Faster than any walker, so the pet never falls behind for long. */
export const PET_SPEED = 160;
/** An owner who jumped farther than this (a portal, a respawn) has the pet appear at their heels. */
export const SNAP_DIST = 64;
const CRUMB = 2;
const TRAIL_MAX = 48;

export interface OwnerState { id: string; pos: Vec; hidden: boolean }
export interface DrawnPet { id: string; look: PetLook; x: number; y: number; facing: Facing; moving: boolean }

interface Follower { code: string; look: PetLook; trail: Vec[]; pos: Vec | null; facing: Facing; moving: boolean; hidden: boolean }

export class PetFollowers {
  private readonly m = new Map<string, Follower>();

  /** The owner's pet code (from a message or my own state); null or malformed removes the pet. */
  setCode(id: string, code: string | null | undefined): void {
    const look = code ? parsePetCode(code) : null;
    if (!look || !code) { this.m.delete(id); return; }
    const f = this.m.get(id);
    if (f) { f.code = code; f.look = look; return; }
    this.m.set(id, { code, look, trail: [], pos: null, facing: "down", moving: false, hidden: false });
  }

  code(id: string): string | null { return this.m.get(id)?.code ?? null; }
  look(id: string): PetLook | null { return this.m.get(id)?.look ?? null; }
  remove(id: string): void { this.m.delete(id); }

  /** Move every pet toward its owner. An owner not listed (gone, off screen state unknown) keeps the pet hidden. */
  step(owners: readonly OwnerState[], dt: number): void {
    const seen = new Set<string>();
    for (const o of owners) {
      const f = this.m.get(o.id);
      if (!f) continue;
      seen.add(o.id);
      f.hidden = o.hidden;
      const last = f.trail[f.trail.length - 1];
      if (!last || Math.hypot(o.pos.x - last.x, o.pos.y - last.y) > SNAP_DIST || o.hidden) {
        // a jump, a new owner, or riding/swimming: start over at the owner's heels
        f.trail = [{ x: o.pos.x, y: o.pos.y }];
        f.pos = { x: o.pos.x, y: o.pos.y };
        f.moving = false;
        continue;
      }
      if (Math.hypot(o.pos.x - last.x, o.pos.y - last.y) >= CRUMB) {
        f.trail.push({ x: o.pos.x, y: o.pos.y });
        if (f.trail.length > TRAIL_MAX) f.trail.shift();
      }
      const target = pointBack(f.trail, FOLLOW_GAP);
      const pos = f.pos ?? { ...target };
      const dx = target.x - pos.x, dy = target.y - pos.y, d = Math.hypot(dx, dy);
      const stepLen = Math.min(d, PET_SPEED * Math.max(0, dt));
      if (d > 0.5 && stepLen > 0) {
        pos.x += (dx / d) * stepLen;
        pos.y += (dy / d) * stepLen;
        f.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        f.moving = true;
      } else {
        f.moving = false;
      }
      f.pos = pos;
    }
    for (const [id, f] of this.m) if (!seen.has(id)) f.hidden = true;
  }

  /** Where the owner's pet stands (null when none or hidden). */
  pos(id: string): Vec | null {
    const f = this.m.get(id);
    return f && f.pos && !f.hidden ? f.pos : null;
  }

  drawn(): DrawnPet[] {
    const out: DrawnPet[] = [];
    for (const [id, f] of this.m) {
      if (!f.pos || f.hidden) continue;
      out.push({ id, look: f.look, x: f.pos.x, y: f.pos.y, facing: f.facing, moving: f.moving });
    }
    return out;
  }
}

/** The point `gap` px back along the trail from its newest end (its oldest point when the trail is shorter). */
export function pointBack(trail: readonly Vec[], gap: number): Vec {
  let left = gap;
  for (let i = trail.length - 1; i > 0; i--) {
    const a = trail[i], b = trail[i - 1];
    const seg = Math.hypot(a.x - b.x, a.y - b.y);
    if (seg >= left) {
      const k = left / seg;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    left -= seg;
  }
  const o = trail[0];
  return { x: o.x, y: o.y };
}

/** The walk cycle: poses 1-0-2-0 while moving, 0 standing (and under reduced motion). */
export function petPose(moving: boolean, t: number, reduced: boolean): 0 | 1 | 2 {
  if (!moving || reduced) return 0;
  return ([1, 0, 2, 0] as const)[Math.floor(t / 110) % 4];
}
