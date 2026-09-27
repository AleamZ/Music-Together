import { describe, expect, it } from "vitest";
import { drawRide, type Pillion } from "@/lib/game/art/ride";
import { drawTraveller } from "@/lib/game/art/road";
import type { Facing } from "@/lib/game/types";
import type { VehicleId } from "@/lib/game/travel/vehicles";

/** Records which image each blit came from and its lowest device row. */
function recorder() {
  const blits: Array<{ img: unknown; bottom: number }> = [];
  let t = { a: 1, d: 1, e: 0, f: 0 };
  const stack: (typeof t)[] = [];
  const ctx = {
    fillStyle: "#000",
    globalAlpha: 1,
    save: () => stack.push({ ...t }),
    restore: () => { t = stack.pop() ?? t; },
    translate: (x: number, y: number) => { t.e += t.a * x; t.f += t.d * y; },
    scale: (x: number, y: number) => { t.a *= x; t.d *= y; },
    fillRect() {},
    drawImage(img: unknown, ...a: number[]) {
      const [dy, dh] = a.length === 8 ? [a[5], a[7]] : [a[1], 48];
      blits.push({ img, bottom: t.f + t.d * (dy + dh) });
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, blits };
}

const frame = (name: string) => ({ name, width: 24, height: 48, getContext: () => null }) as unknown as HTMLCanvasElement;
const rider = frame("rider");
const P: Pillion = { right: frame("p-right"), down: frame("p-down"), up: frame("p-up") };
const mine = new Set<unknown>([P.right, P.down, P.up]);
const VS: VehicleId[] = ["bike", "moto", "car"];
const FS: Facing[] = ["down", "up", "left", "right"];
const FEET = { x: 100, y: 80 };

describe("the passenger on a vehicle (v18.13)", () => {
  it("every vehicle × facing seats the passenger with the driver, above the ground", () => {
    for (const v of VS) for (const f of FS) for (const moving of [false, true]) {
      const r = recorder();
      drawRide(r.ctx, FEET, f, v, rider, 400, moving, false, P);
      const theirs = r.blits.filter((b) => mine.has(b.img));
      expect(theirs.length, `${v} ${f}`).toBeGreaterThan(0);
      expect(r.blits.some((b) => b.img === rider), `${v} ${f}`).toBe(true);
      for (const b of theirs) expect(b.bottom, `${v} ${f}`).toBeLessThanOrEqual(FEET.y + 1);
    }
  });
  it("nobody is drawn behind the driver without a passenger", () => {
    for (const v of VS) for (const f of FS) {
      const r = recorder();
      drawRide(r.ctx, FEET, f, v, rider, 400, true, false);
      expect(r.blits.some((b) => mine.has(b.img))).toBe(false);
    }
  });
  it("the road cutscene carries both, either way", () => {
    for (const v of VS) for (const flip of [false, true]) {
      const r = recorder();
      drawTraveller(r.ctx, 120, 150, 330, v, rider, false, flip, P);
      expect(r.blits.some((b) => mine.has(b.img)), `${v}`).toBe(true);
      expect(r.blits.some((b) => b.img === rider)).toBe(true);
    }
    const walk = recorder();
    drawTraveller(walk.ctx, 120, 150, 330, null, rider, false, false, P);
    expect(walk.blits.some((b) => mine.has(b.img))).toBe(false);
  });
});
