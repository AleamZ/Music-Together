import { describe, it, expect } from "vitest";
import {
  COAT_NAME, DOG, DOG_COATS, dogNameRefusal, dogStatus, feedRefusal, followerPose, frontSpot, heelSpot, newFollower, normalizeDogName,
  parseDog, parseDogAnswer, pet, pounce, recall, stepFollower, type DogView, type Follower,
} from "@/lib/game/dog";
import type { Facing } from "@/lib/game/types";

const H = 3_600_000;
const free = () => false;

describe("the coats and the dog from the server (§7.1, §10.3)", () => {
  it("has four coats with their names", () => {
    expect(DOG_COATS).toEqual(["vang", "muc", "ven", "dom"]);
    expect(DOG_COATS.map((c) => COAT_NAME[c])).toEqual(["Vàng", "Mực", "Vện", "Đốm"]);
    expect(DOG.price).toBe(20_000);
  });
  it("parses a dog and a dog call's answer", () => {
    const raw = { name: "Mực", coat: "muc", adopted_at: "2026-09-26T01:00:00Z", fed_until: "2026-09-27T01:00:00Z", next_hunt_at: null, catches: 12 };
    const dog: DogView = {
      name: "Mực", coat: "muc", adoptedAt: Date.parse("2026-09-26T01:00:00Z"), fedUntil: Date.parse("2026-09-27T01:00:00Z"),
      nextHuntAt: null, catches: 12,
    };
    expect(parseDog(raw)).toEqual(dog);
    expect(parseDog(null)).toBeNull();
    expect(parseDog({ ...raw, coat: "xam" })).toBeNull();
    expect(parseDogAnswer({ server_now: "2026-09-26T02:00:00Z", dog: raw, food: 3, coins: 1500 }))
      .toEqual({ serverNow: Date.parse("2026-09-26T02:00:00Z"), dog, food: 3, coins: 1500 });
    expect(parseDogAnswer({ server_now: "2026-09-26T02:00:00Z", dog: null, food: 0, coins: 0 })?.dog).toBeNull();
    expect(parseDogAnswer({ dog: raw })).toBeNull();
  });
});

describe("the dog's name (the names the SQL smoke refuses and accepts)", () => {
  it("accepts 2–16 characters, stored NFC with single spaces", () => {
    expect(dogNameRefusal("Mực")).toBeNull();
    expect(dogNameRefusal("Ki")).toBeNull();
    expect(dogNameRefusal("  Ki   Ki  ")).toBeNull();
    expect(normalizeDogName("  Ki   Ki  ")).toBe("Ki Ki");
    expect(dogNameRefusal("Vàng Vện Đốm 16c")).toBeNull();
    expect(dogNameRefusal("Mu\u0301c")).toBeNull();
    expect(normalizeDogName("Mu\u0301c")).toBe("Múc");
  });
  it("refuses a name of 1 or 17 characters", () => {
    expect(dogNameRefusal("M")).toBe("length");
    expect(dogNameRefusal("Mười bảy ký tự nè")).toBe("length");
    expect(dogNameRefusal("")).toBe("length");
    expect(dogNameRefusal("   ")).toBe("length");
  });
  it("refuses hidden characters", () => {
    expect(dogNameRefusal("\u200b\u200b")).toBe("hidden");
    expect(dogNameRefusal("Ki\u200bki")).toBe("hidden");
    expect(dogNameRefusal("Ki\u00a0ki")).toBe("hidden");
    expect(dogNameRefusal("\tKiki")).toBe("hidden");
    expect(dogNameRefusal("Ki\u{e0041}ki")).toBe("hidden");
  });
  it("refuses the reserved names, however they are written", () => {
    expect(dogNameRefusal("Ao cá")).toBe("reserved");
    expect(dogNameRefusal("Hợp  tác  xã")).toBe("reserved");
    expect(dogNameRefusal("admin")).toBe("reserved");
    expect(dogNameRefusal("Hệ-thống")).toBe("reserved");
    expect(dogNameRefusal("Quản trị viên")).toBe("reserved");
  });
});

describe("food and the hunt (D17–D19)", () => {
  const now = Date.parse("2026-09-26T10:00:00Z");
  const dog = (fed: number | null, next: number | null): DogView => ({
    name: "Mực", coat: "muc", adoptedAt: now - 48 * H, fedUntil: fed, nextHuntAt: next, catches: 0,
  });
  it("dogStatus: fed and ready, resting, hungry", () => {
    expect(dogStatus(dog(now + 18 * H, null), now)).toEqual({ fed: true, foodLeftMs: 18 * H, hunt: "ready", restLeftMs: 0 });
    expect(dogStatus(dog(now + H, now + 192_000), now)).toEqual({ fed: true, foodLeftMs: H, hunt: "resting", restLeftMs: 192_000 });
    expect(dogStatus(dog(now, now + 192_000), now)).toMatchObject({ fed: false, hunt: "hungry" });
    expect(dogStatus(dog(null, null), now)).toMatchObject({ fed: false, foodLeftMs: 0, hunt: "hungry" });
  });
  it("feedRefusal: full above 12 h, then no food", () => {
    expect(feedRefusal(dog(now + 12 * H + 1000, null), 3, now)).toBe("full");
    expect(feedRefusal(dog(now + 12 * H, null), 3, now)).toBeNull();
    expect(feedRefusal(dog(now + 12 * H + 1000, null), 0, now)).toBe("full");
    expect(feedRefusal(dog(now - H, null), 0, now)).toBe("no_food");
    expect(feedRefusal(dog(null, null), 1, now)).toBeNull();
  });
});

describe("the follower (§7.3)", () => {
  const walls = (bad: Array<[number, number]>) => (x: number, y: number) => bad.some(([bx, by]) => bx === x && by === y);
  const run = (f: Follower, o: { x: number; y: number; facing: Facing }, from: number, to: number, blocked = free) => {
    let g = f;
    for (let t = from; t <= to; t += 16) g = stepFollower(g, o, t, blocked);
    return g;
  };

  it("sits at the heel spot, or its mirror when that side is blocked, or on the owner", () => {
    const o = { x: 100, y: 100 };
    expect(heelSpot(o, "down", free)).toEqual({ x: 110, y: 98 });
    expect(heelSpot(o, "up", free)).toEqual({ x: 90, y: 102 });
    expect(heelSpot(o, "left", free)).toEqual({ x: 108, y: 103 });
    expect(heelSpot(o, "right", free)).toEqual({ x: 92, y: 103 });
    expect(heelSpot(o, "down", walls([[110, 98]]))).toEqual({ x: 90, y: 98 });
    expect(heelSpot(o, "down", walls([[110, 98], [90, 98]]))).toEqual({ x: 100, y: 100 });
    expect(frontSpot(o, "down", free)).toEqual({ x: 100, y: 109 });
    const f = newFollower(o, "left", 0, free);
    expect([f.x, f.y, f.mode]).toEqual([108, 103, "follow"]);
    const g = run(f, { ...o, facing: "down" }, 16, 1000);
    expect([g.x, g.y]).toEqual([110, 98]);
  });
  it("follows where the owner was 450 ms ago while the owner walks, at up to 84 px/s", () => {
    let f = newFollower({ x: 100, y: 100 }, "right", 0, free);
    let x = 100;
    for (let t = 16; t <= 3000; t += 16) {
      x += (70 * 16) / 1000;
      f = stepFollower(f, { x, y: 100, facing: "right" }, t, free);
    }
    // 70 px/s × 0.45 s behind the owner
    expect(x - f.x).toBeGreaterThan(29);
    expect(x - f.x).toBeLessThan(34);
    expect(f.y).toBeCloseTo(100, 6);
    expect(f.moving).toBe(true);
    expect(f.facing).toBe("right");
    const slow = stepFollower({ ...f, x: f.x - 40 }, { x: x + 1, y: 100, facing: "right" }, f.at + 16, free);
    expect(slow.x - (f.x - 40)).toBeCloseTo((84 * 16) / 1000, 6);
  });
  it("snaps beyond 64 px (a portal, a restore)", () => {
    const f = run(newFollower({ x: 100, y: 100 }, "down", 0, free), { x: 100, y: 100, facing: "down" }, 16, 1000);
    const far = run(f, { x: 400, y: 300, facing: "down" }, 1016, 1600);
    expect([far.x, far.y]).toEqual([410, 298]);
  });
  it("stands, then sits 3 s after it stopped; its owner's hungry dog droops", () => {
    const f = run(newFollower({ x: 100, y: 100 }, "down", 0, free), { x: 100, y: 100, facing: "down" }, 16, 500);
    expect(followerPose(f, 500)).toBe("idle");
    expect(followerPose(f, 2999)).toBe("idle");
    expect(followerPose(f, 3000)).toBe("sit");
    expect(followerPose(f, 3000, true)).toBe("hungry");
    const moved = stepFollower(f, { x: 130, y: 100, facing: "right" }, 516, free);
    expect(followerPose(moved, 516)).toBe("walk");
  });
  it("pounces at 120 px/s, leaps 350 ms, carries the rat back to the heel; a recall ends it", () => {
    const o = { x: 100, y: 100, facing: "down" as Facing };
    const f0 = run(newFollower(o, "down", 0, free), o, 16, 500);
    let f = pounce(f0, { x: 170, y: 98 });
    f = stepFollower(f, o, f0.at + 16, free);
    expect(f.x - f0.x).toBeCloseTo((120 * 16) / 1000, 6);
    expect(followerPose(f, f.at)).toBe("run");
    for (let t = f.at + 16; t <= 1100 && f.mode === "pounce"; t += 16) f = stepFollower(f, o, t, free);
    expect(f.mode).toBe("leap");
    expect([f.x, f.y]).toEqual([170, 98]);
    const leapEnds = f.until;
    expect(followerPose(f, leapEnds - 1)).toBe("leap");
    f = stepFollower(f, o, leapEnds, free);
    expect(f.mode).toBe("carry");
    expect(followerPose(f, leapEnds)).toBe("carry");
    f = run(f, o, leapEnds + 16, leapEnds + 2000);
    expect(f.mode).toBe("follow");
    expect([f.x, f.y]).toEqual([110, 98]);
    const back = recall(pounce(f0, { x: 170, y: 98 }));
    expect(back.mode).toBe("follow");
    expect(back.goal).toBeNull();
  });
  it("a pet brings it to its owner's front for 2.5 s, wagging", () => {
    const o = { x: 100, y: 100, facing: "down" as Facing };
    let f = pet(run(newFollower(o, "down", 0, free), o, 16, 500), 500);
    f = run(f, o, 516, 1500);
    expect([f.x, f.y]).toEqual([100, 109]);
    expect(followerPose(f, 1500)).toBe("wag");
    f = run(f, o, 1516, 3200);
    expect(f.mode).toBe("follow");
    expect([f.x, f.y]).toEqual([110, 98]);
  });
});
