import { describe, it, expect } from "vitest";
import { DEFAULT_LOOK } from "@/lib/game/look";
import type { Spot } from "@/lib/game/maps/types";
import type { GameMessage } from "@/lib/game/net/protocol";
import { RemoteWorld, type RosterEntry } from "@/lib/game/world";
import { mapFromAscii } from "./helpers/ascii-map";

const map = mapFromAscii(Array(20).fill(".".repeat(40))); // open 320 × 160 px, spawn (4, 4)
const GRACE = 2000;
const SEAT: Spot = { x: 100, y: 100, dir: "down" };
const walking = (id: string): RosterEntry => ({ id, name: id, badges: "", look: DEFAULT_LOOK, spot: null });
const seated = (id: string): RosterEntry => ({ id, name: id, badges: "🖥️", look: DEFAULT_LOOK, spot: SEAT });
const st = (id: string, x: number, y: number): GameMessage => ({ t: "st", id, x, y, d: "r", mv: false, vx: 0, vy: 0 });
const mv = (id: string, x: number, y: number): GameMessage => ({ t: "mv", id, x, y, d: "r", mv: true, vx: 1, vy: 0 });
const pa = (id: string, x: number, y: number, pts: Array<[number, number]>): GameMessage => ({ t: "pa", id, x, y, pts });

/** "me" sees Ann walking at (100, 60); then her `bye` arrives but presence still lists her as walking. */
function afterBye(): RemoteWorld {
  const w = new RemoteWorld(map, "me");
  w.setRoster([walking("ann")], 0);
  w.applyMessage(st("ann", 100, 60), 0);
  w.remove("ann");
  expect(w.actors.has("ann")).toBe(false);
  return w;
}

describe("RemoteWorld: re-entering the world after a bye", () => {
  it("hello re-creates the walker at the spawn, hidden until the grace passes", () => {
    const w = afterBye();
    w.hello("ann", 2000);
    expect(w.actors.get("ann")?.pos).toEqual({ x: map.spawn.x, y: map.spawn.y });
    expect(w.visible("ann", 2000 + GRACE - 1, GRACE)).toBe(false);
    expect(w.visible("ann", 2000 + GRACE, GRACE)).toBe(true);
  });

  it("hello, then their state: shown at once, where the state says", () => {
    const w = afterBye();
    w.hello("ann", 2000);
    w.applyMessage(st("ann", 120, 60), 2300);
    expect(w.visible("ann", 2300, GRACE)).toBe(true);
    expect(w.actors.get("ann")?.pos).toEqual({ x: 120, y: 60 });
  });

  it("a movement message without a hello re-creates the walker where the message says", () => {
    // e.g. Ann's other game tab re-announcing itself after the tab she closed said bye
    const w = afterBye();
    w.applyMessage(mv("ann", 40, 80), 2000);
    expect(w.actors.get("ann")).toMatchObject({ pos: { x: 40, y: 80 }, display: { x: 40, y: 80 }, moving: true });
    expect(w.visible("ann", 2000, GRACE)).toBe(true);
    w.tick(0.1, 2100);
    expect(w.actors.get("ann")?.pos.x).toBeGreaterThan(40); // walks on to the right
  });

  it("a roster update that seats them removes the walker; walking again brings it back", () => {
    const w = afterBye();
    w.setRoster([seated("ann")], 2000); // Ann switched to the classic view
    expect(w.actors.has("ann")).toBe(false);
    w.setRoster([walking("ann")], 3000); // …and back to the game
    expect(w.actors.get("ann")?.pos).toEqual({ x: map.spawn.x, y: map.spawn.y });
    expect(w.visible("ann", 3000, GRACE)).toBe(false);
  });
});

describe("RemoteWorld: who gets an actor", () => {
  it("hello from a seated member, an unknown id or my own id creates nothing; an existing walker keeps its place", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann"), seated("sam"), walking("me")], 0); // my own id is never one of the others
    w.applyMessage(st("ann", 100, 60), 0);
    for (const id of ["sam", "zed", "me"]) w.hello(id, 500);
    expect([...w.actors.keys()]).toEqual(["ann"]);
    w.hello("ann", 600);
    expect(w.actors.get("ann")?.pos).toEqual({ x: 100, y: 60 });
    expect(w.visible("ann", 600, GRACE)).toBe(true);
  });

  it("movement from a seated member, an unknown id or my own id creates no actor", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([seated("sam")], 0);
    for (const id of ["sam", "zed", "me"]) w.applyMessage(st(id, 100, 60), 500);
    expect(w.actors.size).toBe(0);
  });

  it("lists the others and counts the walking ones", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann"), walking("bob"), seated("sam"), walking("me")], 0);
    expect([...w.roster.keys()]).toEqual(["ann", "bob", "sam"]);
    expect(w.walkers()).toBe(2);
  });
});

describe("RemoteWorld: restoring a remembered message", () => {
  // Ann's messages arrive before presence lists her as walking (e.g. she has just switched to the game).
  it("a path remembered 10 s ago is restored at its end, not at its start", () => {
    const w = new RemoteWorld(map, "me");
    w.applyMessage(pa("ann", 20, 40, [[80, 40], [80, 100]]), 0); // 120 px ≈ 1.7 s of walking
    w.setRoster([walking("ann")], 10_000);
    expect(w.actors.get("ann")).toMatchObject({ pos: { x: 80, y: 100 }, display: { x: 80, y: 100 }, path: null, moving: false });
  });

  it("a path remembered 1 s ago goes on from where she is by now", () => {
    const w = new RemoteWorld(map, "me");
    w.applyMessage(pa("ann", 20, 40, [[80, 40], [80, 100]]), 9_000);
    w.setRoster([walking("ann")], 10_000); // 70 px along: 60 east, then 10 south
    expect(w.actors.get("ann")).toMatchObject({ pos: { x: 80, y: 50 }, display: { x: 80, y: 50 }, path: [{ x: 80, y: 100 }], moving: true });
  });

  it("a moving state remembered 10 s ago is restored at its x/y, not moving", () => {
    const w = new RemoteWorld(map, "me");
    w.applyMessage(mv("ann", 40, 80), 0);
    w.setRoster([walking("ann")], 10_000);
    w.tick(0.5, 10_500);
    expect(w.actors.get("ann")).toMatchObject({ pos: { x: 40, y: 80 }, moving: false });
  });

  it("a moving state remembered 1 s ago has walked on for that second", () => {
    const w = new RemoteWorld(map, "me");
    w.applyMessage(mv("ann", 40, 80), 9_000);
    w.setRoster([walking("ann")], 10_000);
    const a = w.actors.get("ann");
    expect(a?.pos.x).toBeCloseTo(110); // 70 px/s
    expect(a?.display).toEqual(a?.pos);
    expect(a?.moving).toBe(true);
  });
});

describe("RemoteWorld: visibility", () => {
  it("a walker with no state yet is hidden until the caller's grace passes", () => {
    const w = new RemoteWorld(map, "me");
    w.setRoster([walking("ann")], 1000);
    expect(w.actors.get("ann")?.pos).toEqual({ x: map.spawn.x, y: map.spawn.y });
    expect(w.visible("ann", 1000, GRACE)).toBe(false);
    expect(w.visible("ann", 1000 + GRACE - 1, GRACE)).toBe(false);
    expect(w.visible("ann", 1000 + GRACE, GRACE)).toBe(true);
    expect(w.visible("ann", 1500, 500)).toBe(true);
  });
});
