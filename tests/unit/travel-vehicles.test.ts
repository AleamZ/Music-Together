import { describe, it, expect } from "vitest";
import { VEHICLES, WALK_TRIP_MS, SKIP_COST, tripVehicle, tripMs, isRoadTrip } from "@/lib/game/travel/vehicles";

describe("vehicles", () => {
  it("lists bike, moto, car with the approved prices and times", () => {
    expect(VEHICLES.map((v) => [v.id, v.price, v.tripMs])).toEqual([["bike", 5000, 10000], ["moto", 30000, 5000], ["car", 150000, 2000]]);
    expect(WALK_TRIP_MS).toBe(15000);
    expect(SKIP_COST).toBe(20);
  });
  it("uses the fastest owned vehicle, ignores unknown ids", () => {
    expect(tripVehicle([])).toBeNull();
    expect(tripMs([])).toBe(15000);
    expect(tripVehicle(["bike", "moto"])?.id).toBe("moto");
    expect(tripMs(["car", "bike"])).toBe(2000);
    expect(tripMs(["plane"])).toBe(15000);
  });
  it("only hall <-> market is a road trip", () => {
    expect(isRoadTrip("hall", "market")).toBe(true);
    expect(isRoadTrip("market", "hall")).toBe(true);
    expect(isRoadTrip("hall", "pond")).toBe(false);
    expect(isRoadTrip("pond", "hall")).toBe(false);
  });
});
