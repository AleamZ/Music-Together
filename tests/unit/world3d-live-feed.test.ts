import { describe, expect, it } from "vitest";
import type { Stall } from "@/lib/game/economy/model";
import { castLive, liveFromFrame } from "@/lib/game/diorama/world/live-plan";
import {
  animalAt, animalsLive, bossesLive, digsLive, housesLive, LiveFeed, PLAYER_STALL_SPOTS, ringsLive, stallsLive, worldLive,
} from "@/lib/game/diorama/world/live-feed";
import { RING_RECTS } from "@/lib/game/maps/bai-dat";
import type { BossFight, WildAnimal, WorldState } from "@/lib/game/realm/rpc";
import { toWorld, ZONES } from "@/lib/game/world/zones";

// P4: the real game's state → the 3D world's live model (world px).

const stall = (no: number, renterName: string | null, items = 0): Stall => ({ no, mine: false, renterName, paidMs: null, items: Array.from({ length: items }, () => ({}) as Stall["items"][number]) });
const animal = (id: number, over: Partial<WildAnimal> = {}): WildAnimal => ({ id, species: "rabbit", hx: 300, hy: 200, seed: id * 7, bornMs: 0, expiresMs: 1e12, photographed: false, ...over });
const fight = (over: Partial<BossFight> = {}): BossFight => ({
  id: 1, boss: "trau_tinh", name: "Trâu Tinh", kind: "world", map: "bai_dat", arena: { x: 316, y: 60, w: 168, h: 316 },
  hp: 300, maxHp: 1000, phase: 1, status: "up", cap: 0, startsMs: 0, endsMs: 1e12, killer: null, myDmg: 0, myCombo: 0, fighters: 0, top: [], ...over,
});
const realm = (over: Partial<WorldState> = {}): WorldState => ({
  serverNowMs: 0, night: false, snowUntilMs: null, wild: { animals: [animal(1)], bag: {}, album: {}, killsToday: 0 },
  fights: [fight()], next: [], party: null, invites: [], dungeon: null, clearsToday: 0, ...over,
});

describe("world coordinates", () => {
  it("toWorld adds the zone offset; the wild is world px already; an interior has none", () => {
    expect(toWorld("market", { x: 10, y: 20 })).toEqual({ x: ZONES.market.ox + 10, y: ZONES.market.oy + 20 });
    expect(toWorld("wild", { x: 1, y: 1 })).toEqual({ x: 1, y: 1 });
    expect(toWorld("mo_da", { x: 1, y: 1 })).toBeNull();
  });
});

describe("live feed mapping", () => {
  it("rented stalls stand at their market spot (world px) with the renter's name; empty ones are not drawn", () => {
    const s = stallsLive([stall(1, "Bé Na", 4), stall(2, null), stall(3, "Tú")]);
    expect(s.map((x) => x.id)).toEqual(["pstall:1", "pstall:3"]);
    expect(s[0]).toMatchObject({ owner: "player", name: "Bé Na", goods: 0.5, ...toWorld("market", PLAYER_STALL_SPOTS[0]) });
  });

  it("rings with a label, at the ring's centre on Bãi đất; a match on is active", () => {
    const r = ringsLive([null, "⚔️ Hiệp 2 · 1–0", "Góc Đỏ: Lan · chờ đối thủ"]);
    expect(r.map((x) => [x.id, x.active])).toEqual([["ring2", true], ["ring3", false]]);
    const c = RING_RECTS[1];
    expect(r[0]).toMatchObject(toWorld("bai_dat", { x: c.x + c.w / 2, y: c.y + c.h / 2 })!);
  });

  it("houses: house_list's 1-based lots → LOTS index, built by the grid, the owner's name", () => {
    expect(housesLive([{ lot: 3, owned: true, grid: "abc", roof: "la", ownerName: "Tư", mine: true }, { lot: 1, owned: false, grid: null, roof: "ngoi" }]))
      .toEqual([{ lot: 2, owned: true, built: true, roof: "la", ownerName: "Tư", mine: true }, { lot: 0, owned: false, built: false, roof: "ngoi", ownerName: null, mine: false }]);
  });

  it("wild animals move on their seeded path in the zone, in world px; expired ones are gone", () => {
    const a = animalsLive([animal(1), animal(2, { expiresMs: 10 })], "field", 5000);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: "wild:1", species: "rabbit", ...toWorld("field", animalAt(animal(1), 5000)) });
    expect(animalsLive([animal(1)], "field", 9000)[0].x).not.toBe(a[0].x);
  });

  it("bosses that are up: at their spot, hp 0…1, the arena in world px, a wind-up from phase 2", () => {
    const [b] = bossesLive([fight(), fight({ id: 2, status: "dead" })], 1500);
    const o = toWorld("bai_dat", { x: 0, y: 0 })!;
    expect(b).toMatchObject({ id: "boss:1", kind: "trau_tinh", hp: 0.3, x: o.x + 316 + 84, y: o.y + 60 + 158 + 24, arena: { x: o.x + 316, y: o.y + 60, w: 168, h: 316 } });
    expect(b.telegraphs).toEqual([]);
    expect(bossesLive([fight({ phase: 2 })], 1500)[0].telegraphs![0].k).toBeCloseTo(0.5);
  });

  it("digs in their zone → world px", () => {
    expect(digsLive([{ id: "me", zone: "song_cai", x: 5, y: 6, state: "hint" }])).toEqual([{ id: "me", ...toWorld("song_cai", { x: 5, y: 6 })!, state: "hint" }]);
  });

  it("an angler's bobber: in front of the feet, hooked from the bite", () => {
    expect(castLive({ id: "a", x: 100, y: 100, facing: "down", phase: 1 })).toMatchObject({ id: "cast:a", hooked: false, tension: 0 });
    const c = castLive({ id: "a", x: 100, y: 100, facing: "down", phase: 3 });
    expect(c.hooked).toBe(true);
    expect(c.y).toBeGreaterThan(100);
  });

  it("liveFromFrame folds the engine's pets and anglers over the fed state", () => {
    const l = liveFromFrame({ billboards: [], gameplay: { rats: [], dogs: [], leaps: [], gates: [], pets: [{ ownerId: "bo", species: "meo", x: 1, y: 2 }], anglers: [{ id: "bo", x: 0, y: 0, facing: "up", phase: 2 }] } },
      { stalls: stallsLive([stall(1, "Na")]) });
    expect(l.pets).toEqual([{ id: "pet:bo", ownerId: "bo", species: "meo", x: 1, y: 2 }]);
    expect(l.fishing?.[0]).toMatchObject({ id: "cast:bo", hooked: true });
    expect(l.stalls).toHaveLength(1);
  });

  it("LiveFeed: patches replace per key; the realm's clock offset moves the animals; moving() while something is up", () => {
    const f = new LiveFeed();
    expect(f.moving()).toBe(false);
    f.set({ stalls: [stall(1, "Na")], ringLabels: ["x"] });
    f.set({ realm: { state: realm(), zone: "field", offsetMs: 2000 } });
    expect(f.moving()).toBe(true);
    const l = f.at(3000);
    expect(l.stalls).toHaveLength(1);
    expect(l.rings).toHaveLength(1);
    expect(l.animals).toEqual(animalsLive(realm().wild!.animals, "field", 5000));
    expect(l).toEqual(worldLive(f.inputs(), 5000));
    f.set({ realm: null });
    expect(f.at(0).animals).toEqual([]);
  });
});
