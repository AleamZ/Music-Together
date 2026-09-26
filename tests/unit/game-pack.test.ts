import { describe, it, expect } from "vitest";
import { ratAt, ratHome, ratPos, type FieldRats, type RatLive, type RatRecent } from "@/lib/game/farm/rats";
import { DOG_END_MS, Pack, SLING_END_MS, type DogWalker } from "@/lib/game/pack";

const T = Date.parse("2026-09-26T08:00:00Z");
const free = () => false;
const rats = (live: RatLive[], recent: RatRecent[] = []): FieldRats => ({ nextAt: T + 600_000, price: 150, live, recent, plots: {} });
/** A rat of plot 5 (its hole at (172, 310)), out since T. */
const rat = (id: number, plot = 5): RatLive => ({ id, plot, since: T, seed: id });
const ended = (r: RatLive, how: RatRecent["how"], endedAt: number, by: string | null = null, dog: string | null = null): RatRecent =>
  ({ ...r, endedAt, how, by: by ? { id: by, name: by } : null, dog });
const walker = (id: string, x: number, y: number, over: Partial<DogWalker> = {}): DogWalker =>
  ({ id, x, y, facing: "down", dog: { name: "Mực", coat: "muc" }, hungry: false, petAt: null, ...over });

describe("Pack: the rats (§5.4)", () => {
  it("draws the live rats on their paths", () => {
    const p = new Pack(free, "me");
    expect(p.setRats(rats([rat(1), rat(2, 8)]), 0)).toEqual([]);
    const drawn = p.drawnRats(0, T + 30_000);
    expect(drawn.map((r) => r.key)).toEqual(["r1", "r2"]);
    expect(drawn[0]).toMatchObject({ ...ratAt(rat(1), T + 30_000), fallen: false });
    expect(p.liveRats.map((r) => r.id)).toEqual([1, 2]);
    p.setRats(null, 10);
    expect(p.drawnRats(10, T + 30_000)).toEqual([]);
  });
  it("plays a sling catch once: the rat lies fallen with a puff for 0.6 s", () => {
    const p = new Pack(free, "me");
    p.setRats(rats([rat(1)]), 0);
    const end = ended(rat(1), "sling", T + 20_000, "lan");
    const at = ratAt(rat(1), T + 20_000)!;
    expect(p.setRats(rats([], [end]), 1000)).toEqual([{ x: at.x, y: at.y }]);
    p.step([], 1000 + SLING_END_MS - 1);
    expect(p.drawnRats(1599, T + 25_000)).toEqual([{ key: "e1", x: at.x, y: at.y, dir: at.dir, moving: false, fallen: true }]);
    p.step([], 1000 + SLING_END_MS);
    expect(p.drawnRats(1600, T + 25_000)).toEqual([]);
    // the same entry in the next state is not played again
    expect(p.setRats(rats([], [end]), 2000)).toEqual([]);
    expect(p.drawnRats(2000, T + 25_000)).toEqual([]);
  });
  it("runs a fled rat home in 1.5 s from when this client first sees it", () => {
    const p = new Pack(free, "me");
    const r = rat(3);
    p.setRats(rats([], [ended(r, "fled", T + 20_000)]), 5000);
    const home = ratHome(5)!;
    const from = ratPos(r.seed, r.since, home.hole, home.rect, T + 20_000)!;
    const mid = p.drawnRats(5750, 0)[0];
    expect(mid).toMatchObject({ key: "e3", moving: true, fallen: false });
    expect(mid.x).toBeCloseTo((from.x + 172) / 2, 9);
    expect(mid.y).toBeCloseTo((from.y + 310) / 2, 9);
    p.step([], 6500);
    expect(p.drawnRats(6500, 0)).toEqual([]);
  });
  it("sends a dog's catcher's dog when it walks here; otherwise the catch plays as a sling one; mine is not replayed", () => {
    const r = rat(4);
    const at = ratAt(r, T + 20_000)!;
    const catchBy = (who: string) => rats([], [ended(r, "dog", T + 20_000, who, "Mực")]);
    const p = new Pack(free, "me");
    p.step([walker("dat", 150, 330)], 0);
    expect(p.setRats(catchBy("dat"), 10)).toEqual([]);
    expect(p.drawnDogs(10)[0].pose).toBe("run");
    // the rat lies where it was caught until the dog carries it off
    let t = 10;
    while (t < 5000 && p.drawnDogs(t)[0].pose !== "carry") {
      expect(p.drawnRats(t, 0)).toEqual([{ key: "e4", x: at.x, y: at.y, dir: at.dir, moving: false, fallen: true }]);
      t += 16;
      p.step([walker("dat", 150, 330)], t);
    }
    expect(p.drawnDogs(t)[0].pose).toBe("carry");
    expect(p.drawnRats(t, 0)).toEqual([]);
    const away = new Pack(free, "me");
    expect(away.setRats(catchBy("dat"), 0)).toEqual([{ x: at.x, y: at.y }]);
    expect(away.drawnRats(0, 0)[0]).toMatchObject({ key: "e4", fallen: true });
    const mine = new Pack(free, "me");
    mine.step([walker("me", 150, 330)], 0);
    expect(mine.setRats(catchBy("me"), 0)).toEqual([]);
    expect(mine.drawnRats(0, 0)).toEqual([]);
    expect(mine.drawnDogs(0)[0].pose).not.toBe("run");
  });
  it("gives a dog's catch up after 6 s if the dog never gets there", () => {
    // a frame steps the dog 0.1 s at most: one step across the whole wait leaves it short of the rat
    const p = new Pack(free, "me");
    p.step([walker("dat", 150, 330)], 0);
    p.setRats(rats([], [ended(rat(4), "dog", T + 20_000, "dat")]), 0);
    p.step([walker("dat", 150, 330)], DOG_END_MS - 1);
    expect(p.drawnRats(DOG_END_MS - 1, 0)).toHaveLength(1);
    p.step([walker("dat", 150, 330)], DOG_END_MS);
    expect(p.drawnRats(DOG_END_MS, 0)).toEqual([]);
  });
});

describe("Pack: the dogs (§7.3)", () => {
  it("follows each walker, starting at the heel; a walker gone loses the dog, a new coat is a new dog", () => {
    const p = new Pack(free, "me");
    p.step([walker("ann", 100, 100)], 0);
    expect(p.drawnDogs(0)).toEqual([{ id: "ann", x: 110, y: 98, facing: "down", coat: "muc", pose: "idle" }]);
    p.step([walker("ann", 100, 100, { dog: { name: "Mực", coat: "dom" } })], 16);
    expect(p.drawnDogs(16)).toMatchObject([{ id: "ann", x: 110, y: 98, coat: "dom" }]);
    p.step([], 32);
    expect(p.drawnDogs(32)).toEqual([]);
  });
  it("pets a remote walker's dog once per new fa 11, and mine when I pet it", () => {
    const p = new Pack(free, "me");
    let t = 0;
    /** Steps `ms` in 16 ms frames, Ann's latest fa 11 starting at `petAt`. */
    const run = (ms: number, petAt: number | null) => {
      for (const end = t + ms; t < end;) {
        t += 16;
        p.step([walker("ann", 100, 100, { petAt }), walker("me", 200, 100)], t);
      }
    };
    const dog = (id: string) => p.drawnDogs(t).find((d) => d.id === id)!;
    run(400, null);
    expect(dog("ann")).toMatchObject({ x: 110, y: 98, pose: "idle" });
    const petAt = t;
    run(1000, petAt);
    expect(dog("ann")).toMatchObject({ x: 100, y: 109, pose: "wag" });
    expect(dog("me")).toMatchObject({ x: 210, y: 98 });
    // once its 2.5 s are over, the same animation does not pet it again
    run(2000, petAt);
    expect(dog("ann")).toMatchObject({ x: 110, y: 98 });
    expect(dog("ann").pose).not.toBe("wag");
    p.pet(t);
    run(500, petAt);
    expect(dog("me")).toMatchObject({ x: 200, y: 109, pose: "wag" });
    expect(dog("ann")).toMatchObject({ x: 110, y: 98 });
  });
  it("droops my own hungry dog once it sits", () => {
    const p = new Pack(free, "me");
    p.step([walker("me", 100, 100, { hungry: true })], 0);
    p.step([walker("me", 100, 100, { hungry: true })], 3000);
    expect(p.drawnDogs(3000)[0].pose).toBe("hungry");
    p.step([walker("me", 100, 100)], 3016);
    expect(p.drawnDogs(3016)[0].pose).toBe("sit");
  });
  it("sends my dog for a live rat: the rat lies fallen until carried; a recall brings the dog back and the rat runs on", () => {
    const p = new Pack(free, "me");
    p.setRats(rats([rat(1)]), 0);
    expect(p.pounce(1, 0, T + 20_000)).toBe(false); // no dog of mine yet
    p.step([walker("me", 150, 330)], 0);
    expect(p.pounce(9, 0, T + 20_000)).toBe(false); // no such rat
    expect(p.pounce(1, 0, T + 20_000)).toBe(true);
    const at = ratAt(rat(1), T + 20_000)!;
    expect(p.liveRats).toEqual([]);
    expect(p.drawnRats(0, T + 25_000)).toEqual([{ key: "p1", x: at.x, y: at.y, dir: at.dir, moving: false, fallen: true }]);
    expect(p.drawnDogs(0)[0].pose).toBe("run");
    p.recall();
    expect(p.liveRats.map((r) => r.id)).toEqual([1]);
    expect(p.drawnRats(0, T + 25_000).map((r) => r.key)).toEqual(["r1"]);
    p.step([walker("me", 150, 330)], 16);
    expect(p.drawnDogs(16)[0].pose).not.toBe("run");
  });
  it("keeps my pounce playing when the hunt's answer removes the rat (its recent entry is mine, not replayed)", () => {
    const p = new Pack(free, "me");
    p.setRats(rats([rat(1)]), 0);
    p.step([walker("me", 150, 330)], 0);
    p.pounce(1, 0, T + 20_000);
    expect(p.setRats(rats([], [ended(rat(1), "dog", T + 20_000, "me", "Ki")]), 100)).toEqual([]);
    expect(p.drawnRats(100, T + 25_000).map((r) => r.key)).toEqual(["p1"]);
  });
});
