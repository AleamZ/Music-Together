import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { GameMessage } from "@/lib/game/net/protocol";
import { RemoteWorld, type RosterEntry } from "@/lib/game/world";
import { mapFromAscii } from "./helpers/ascii-map";

const map = mapFromAscii(Array(20).fill(".".repeat(40)));
const walking = (id: string): RosterEntry => ({ id, name: id, badges: "", look: DEFAULT_LOOK, spot: null });
const st = (id: string, x: number, y: number, extra: object = {}): GameMessage =>
  ({ t: "st", id, x, y, d: "r", mv: false, vx: 0, vy: 0, ...extra }) as GameMessage;

describe("RemoteWorld: lifts (v18.13)", () => {
  it("pairs a driver and a passenger only while both tags agree, and forgets them on bye", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("dan"), walking("pia")], 0);
    w.applyMessage(st("dan", 100, 60, { v: "moto", ps: "pia" }), 0);
    expect(w.passengerOf("dan")).toBeNull();
    expect(w.carrier("pia")).toBeNull();
    w.applyMessage(st("pia", 40, 40, { lf: "dan" }), 10);
    expect(w.passengerOf("dan")).toBe("pia");
    expect(w.carrier("pia")).toBe("dan");
    expect(w.liftTag("dan")).toEqual({ ps: "pia" });
    // a message without the tag ends it
    w.applyMessage(st("dan", 100, 60, { v: "moto" }), 20);
    expect(w.carrier("pia")).toBeNull();
    w.applyMessage(st("dan", 100, 60, { v: "moto", ps: "pia" }), 30);
    w.remove("dan");
    expect(w.carrier("pia")).toBeNull();
  });
  it("keeps the carried passenger on the driver's vehicle as the driver moves", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("dan"), walking("pia")], 0);
    w.applyMessage(st("pia", 40, 40, { lf: "dan" }), 0);
    w.applyMessage({ t: "mv", id: "dan", x: 100, y: 60, d: "r", mv: true, vx: 1, vy: 0, v: "car", ps: "pia" }, 0);
    w.tick(0.5, 500);
    const d = w.actors.get("dan")!, p = w.actors.get("pia")!;
    expect(d.pos.x).toBeGreaterThan(100);
    expect(p.pos).toEqual(d.pos);
    expect(p.display).toEqual(d.display);
    expect(p.facing).toBe("right");
    expect(p.moving).toBe(false);
  });
  it("pins an actor where I say (my own passenger rides on me)", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("pia")], 0);
    w.applyMessage(st("pia", 40, 40, { lf: "me" }), 0);
    w.pin("pia", { x: 70, y: 80 }, { x: 71, y: 80 }, "up");
    expect(w.actors.get("pia")).toMatchObject({ pos: { x: 70, y: 80 }, display: { x: 71, y: 80 }, facing: "up" });
    w.pin("nobody", { x: 1, y: 1 }, { x: 1, y: 1 }, "up");
  });
});
