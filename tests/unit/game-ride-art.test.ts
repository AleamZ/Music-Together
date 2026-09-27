import { describe, it, expect } from "vitest";
import { drawRide } from "@/lib/game/art/ride";
import type { Facing } from "@/lib/game/types";
import type { VehicleId } from "@/lib/game/travel/vehicles";

type Call = string;

/** A 2D context that records every fill and image blit in device coordinates (translate + scale tracked). */
function recorder() {
  const calls: Call[] = [];
  let t = { a: 1, d: 1, e: 0, f: 0 };
  const stack: (typeof t)[] = [];
  const box = (x: number, y: number, w: number, h: number) => {
    let x0 = t.e + t.a * x, x1 = t.e + t.a * (x + w);
    if (x0 > x1) [x0, x1] = [x1, x0];
    return { x0, x1, y0: t.f + t.d * y, y1: t.f + t.d * (y + h) };
  };
  const ctx = {
    fillStyle: "#000",
    globalAlpha: 1,
    save: () => stack.push({ ...t }),
    restore: () => { t = stack.pop() ?? t; },
    translate: (x: number, y: number) => { t.e += t.a * x; t.f += t.d * y; },
    scale: (x: number, y: number) => { t.a *= x; t.d *= y; },
    fillRect(x: number, y: number, w: number, h: number) { const b = box(x, y, w, h); calls.push(`f|${ctx.fillStyle}|${b.x0}|${b.x1}|${b.y0}|${b.y1}`); },
    drawImage(_img: unknown, ...a: number[]) {
      const [dx, dy, dw, dh] = a.length === 8 ? a.slice(4) : [a[0], a[1], 24, 48];
      const b = box(dx, dy, dw, dh);
      calls.push(`i|${a.length === 8 ? a.slice(0, 4).join(",") : "all"}|${b.x0}|${b.x1}|${b.y0}|${b.y1}`);
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

const rider = { width: 24, height: 48, getContext: () => null } as unknown as HTMLCanvasElement;
const VS: VehicleId[] = ["bike", "moto", "car"];
const FS: Facing[] = ["down", "up", "left", "right"];
const FEET = { x: 100, y: 80 };

function run(v: VehicleId, f: Facing, t: number, moving: boolean, reduced: boolean): Call[] {
  const r = recorder();
  drawRide(r.ctx, FEET, f, v, rider, t, moving, reduced);
  return r.calls;
}

describe("drawRide", () => {
  it("every vehicle × facing × moving draws the vehicle and the rider", () => {
    for (const v of VS) for (const f of FS) for (const m of [false, true]) {
      const calls = run(v, f, 400, m, false);
      expect(calls.filter((c) => c.startsWith("f")).length).toBeGreaterThan(15);
      expect(calls.some((c) => c.startsWith("i"))).toBe(true);
    }
  });

  it("sits on the feet: nothing is drawn far below the ground contact", () => {
    for (const v of VS) for (const f of FS) {
      for (const c of run(v, f, 400, true, false)) expect(Number(c.split("|").pop())).toBeLessThanOrEqual(FEET.y + 3);
    }
  });

  it("reduced motion and standing still are frozen", () => {
    for (const v of VS) for (const f of FS) {
      expect(run(v, f, 5000, true, true)).toEqual(run(v, f, 0, true, true));
      expect(run(v, f, 5000, false, false)).toEqual(run(v, f, 0, false, false));
    }
  });

  it("moving animates", () => {
    for (const v of VS) expect(run(v, "right", 130, true, false)).not.toEqual(run(v, "right", 0, true, false));
  });

  it("left is the mirror image of right around feet.x", () => {
    const mirror = (c: Call) => {
      const p = c.split("|");
      const [x0, x1] = [Number(p[2]), Number(p[3])];
      return [p[0], p[1], 2 * FEET.x - x1, 2 * FEET.x - x0, p[4], p[5]].join("|");
    };
    for (const v of VS) for (const m of [false, true]) {
      const right = run(v, "right", 330, m, false);
      const left = run(v, "left", 330, m, false);
      expect(left).toEqual(right.map(mirror));
    }
  });
});
