import { describe, it, expect, vi } from "vitest";
import { drawTraveller, paintRoad, riderFrame, ROAD_GROUND_Y } from "@/lib/game/art/road";
import type { VehicleId } from "@/lib/game/travel/vehicles";

function fakeCtx() {
  const calls: string[] = [];
  const rec = (name: string) => vi.fn((...a: unknown[]) => { calls.push(`${name}(${a.map((x) => (typeof x === "number" ? x : "o")).join(",")})`); });
  const c = {
    _fill: "",
    get fillStyle() { return this._fill; },
    set fillStyle(v: string) { this._fill = v; calls.push(`fs=${v}`); },
    fillRect: rec("fillRect"), drawImage: rec("drawImage"), beginPath: rec("beginPath"), arc: rec("arc"), fill: rec("fill"),
    fillText: rec("fillText"), save: rec("save"), restore: rec("restore"), translate: rec("translate"), scale: rec("scale"),
  };
  return { c: c as unknown as CanvasRenderingContext2D, calls, raw: c };
}
const RIDER = {} as HTMLCanvasElement;
const MODES: (VehicleId | null)[] = [null, "bike", "moto", "car"];

function frame(v: VehicleId | null, t: number, reduced: boolean): string[] {
  const { c, calls } = fakeCtx();
  paintRoad(c, 320, 180, t, 60, reduced);
  drawTraveller(c, 120, ROAD_GROUND_Y, t, v, RIDER, reduced);
  return calls;
}

describe("road art", () => {
  it("paints the road and every traveller at t=0 and t=1234", () => {
    for (const v of MODES) for (const t of [0, 1234]) {
      const { c, raw } = fakeCtx();
      paintRoad(c, 320, 180, t, 60, false);
      expect(raw.fillRect.mock.calls.length).toBeGreaterThan(0);
      const tr = fakeCtx();
      drawTraveller(tr.c, 120, ROAD_GROUND_Y, t, v, RIDER, false);
      expect(tr.raw.fillRect.mock.calls.length, String(v)).toBeGreaterThan(0);
      expect(tr.raw.drawImage).toHaveBeenCalled();
    }
  });
  it("draws the car differently from the bike", () => {
    expect(frame("car", 1234, false)).not.toEqual(frame("bike", 1234, false));
  });
  it("animates over time, but reduced motion paints one fixed frame", () => {
    for (const v of MODES) {
      expect(frame(v, 0, false)).not.toEqual(frame(v, 5000, false));
      expect(frame(v, 0, true)).toEqual(frame(v, 5000, true));
    }
  });
  it("mirrors the traveller for the trip home", () => {
    const { c, raw } = fakeCtx();
    drawTraveller(c, 200, ROAD_GROUND_Y, 0, "moto", RIDER, false, true);
    expect(raw.scale).toHaveBeenCalledWith(-1, 1);
  });
  it("walks frames 1-4 at 8 fps, pedals 1/3, rides still otherwise", () => {
    expect([0, 125, 250, 375, 500].map((t) => riderFrame(null, t, false))).toEqual([1, 2, 3, 4, 1]);
    expect(new Set([0, 220, 440].map((t) => riderFrame("bike", t, false)))).toEqual(new Set([1, 3]));
    expect(riderFrame("car", 999, false)).toBe(0);
    expect(riderFrame(null, 999, true)).toBe(1);
  });
});
