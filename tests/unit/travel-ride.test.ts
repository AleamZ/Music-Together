import { describe, it, expect } from "vitest";
import { createActor, setKeyboard, tickActor } from "@/lib/game/actor";
import { WALK_SPEED } from "@/lib/game/movement";
import { RIDE_KEY, RIDE_SPEED, canRide, interactBlocked, isVehicleId, rideSpeed } from "@/lib/game/travel/ride";
import { mapFromAscii } from "./helpers/ascii-map";

describe("ride rules", () => {
  it("speeds", () => {
    expect(RIDE_SPEED).toEqual({ bike: 1.6, moto: 2.2, car: 2.8 });
    expect(rideSpeed(null)).toBe(1);
    expect(rideSpeed("moto")).toBe(2.2);
    expect(RIDE_KEY).toBe("r");
  });
  it("no car at the pond; everything else anywhere", () => {
    expect(canRide("pond", "car")).toBe(false);
    expect(canRide("pond", "bike")).toBe(true);
    expect(canRide("hall", "car")).toBe(true);
    expect(canRide("market", "car")).toBe(true);
    expect(canRide("field", "car")).toBe(true);
  });
  it("riding blocks every interaction but portals", () => {
    expect(interactBlocked("bike", "shop")).toBe(true);
    expect(interactBlocked("car", "restaurant")).toBe(true);
    expect(interactBlocked("moto", "portal")).toBe(false);
    expect(interactBlocked(null, "shop")).toBe(false);
  });
  it("knows the vehicle ids", () => {
    expect(["bike", "moto", "car"].every(isVehicleId)).toBe(true);
    expect(isVehicleId("plane")).toBe(false);
    expect(isVehicleId(null)).toBe(false);
  });
  it("an actor at the car's speed covers 2.8× the walking distance in the same dt (the engine's speed)", () => {
    const map = mapFromAscii(Array(20).fill(".".repeat(60)));
    const walker = createActor("w", { x: 20, y: 40 });
    const rider = createActor("r", { x: 20, y: 80 });
    setKeyboard(walker, { x: 1, y: 0 });
    setKeyboard(rider, { x: 1, y: 0 });
    tickActor(map, walker, 0.5, 0, false, WALK_SPEED);
    tickActor(map, rider, 0.5, 0, false, WALK_SPEED * 1 * rideSpeed("car"));
    expect((rider.pos.x - 20) / (walker.pos.x - 20)).toBeCloseTo(2.8, 5);
  });
});
