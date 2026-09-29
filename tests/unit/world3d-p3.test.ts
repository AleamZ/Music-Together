import * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  gait, hash01, leap, liveFromFrame, pushWake, SEAT_LIFT, stepMotion, telegraphLook, trailSpot, turnTo,
} from "@/lib/game/diorama/world/live-plan";
import { mergeKey, mergeStatic } from "@/lib/game/diorama/world/merge";
import { riverRibbonSpan, streamRunnel } from "@/lib/game/diorama/world/props";
import { chunkArrays, LOD_STEPS } from "@/lib/game/diorama/world/terrain-mesh";
import { CHUNK_PX, CHUNKS_X } from "@/lib/game/world/scenery";
import { LANDMARKS } from "@/lib/game/world/scenery";
import { RIVER_LEVEL, streamLevel, ZONE_ELEV } from "@/lib/game/world/terrain";
import { LANDMARK_SOLIDS, onRoad, wildBlocked } from "@/lib/game/world/wild";
import { ZONES } from "@/lib/game/world/zones";

describe("live-plan kinematics", () => {
  it("gaits speed up with speed and more when fleeing; none when still", () => {
    expect(gait(0)).toEqual({ freq: 0, amp: 0 });
    const walk = gait(40), run = gait(120), flee = gait(120, true);
    expect(run.freq).toBeGreaterThan(walk.freq);
    expect(flee.freq).toBeGreaterThan(run.freq);
  });

  it("turns the short way round and stops on target", () => {
    expect(turnTo(3, -3, 1, 10)).toBeCloseTo(-3);
    const t = turnTo(3.0, -3.0, 0.01, 6);                       // across ±π: goes up past π, not down through 0
    expect(t).toBeGreaterThan(3.0);
  });

  it("steps motion: speed from distance, a teleport resets it, heading follows the move", () => {
    let m = stepMotion(null, 0, 0, 1 / 60);
    for (let i = 1; i <= 30; i++) m = stepMotion(m, i, 0, 1 / 60);
    expect(m.speed).toBeGreaterThan(30);
    expect(m.yaw).toBeCloseTo(Math.PI / 2, 1);                  // +x = yaw π/2 (atan2(dx, dy))
    expect(stepMotion(m, 500, 0, 1 / 60).speed).toBe(0);
  });

  it("drops wake points every gap px, ages them out and caps the trail", () => {
    let w = pushWake([], 0, 0, 0, 0);
    w = pushWake(w, 4, 0, 0, 10);
    expect(w).toHaveLength(1);
    w = pushWake(w, 12, 0, 0, 20);
    expect(w).toHaveLength(2);
    expect(pushWake(w, 12, 0, 0, 10_000)).toHaveLength(1);
    let long: ReturnType<typeof pushWake> = [];
    for (let i = 0; i < 100; i++) long = pushWake(long, i * 20, 0, 0, i);
    expect(long.length).toBeLessThanOrEqual(40);
  });

  it("leaps are short arcs, deterministic per seed", () => {
    let seen = 0;
    for (let t = 0; t < 20_000; t += 50) {
      const l = leap(t, 17);
      if (!l) continue;
      seen++;
      expect(l.h).toBeGreaterThanOrEqual(0);
      expect(l.h).toBeLessThanOrEqual(1.11);
      expect(leap(t, 17)).toEqual(l);
    }
    expect(seen).toBeGreaterThan(10);
    expect(seen).toBeLessThan(200);
  });

  it("trails pets behind their owner, telegraphs fill with wind-up, hashes stay in 0…1", () => {
    const p = trailSpot({ x: 100, y: 100 }, 0);                 // yaw 0 faces +y: behind is -y
    expect(p.y).toBeLessThan(100);
    expect(telegraphLook(1, 0).fill).toBe(1);
    expect(telegraphLook(0, 0).opacity).toBeLessThan(telegraphLook(1, 0).opacity);
    for (let i = 0; i < 50; i++) { const h = hash01(3, i); expect(h).toBeGreaterThanOrEqual(0); expect(h).toBeLessThan(1); }
    expect(SEAT_LIFT.car).toBeLessThan(SEAT_LIFT.bike);
  });
});

describe("liveFromFrame", () => {
  const bb = (id: string, vehicle?: "bike" | "moto" | "car" | "boat") => ({ id, look: {} as never, x: 10, y: 20, facing: "down" as const, frame: 0 as const, name: null, vehicle });

  it("folds riders into vehicles and boats", () => {
    const live = liveFromFrame({ billboards: [bb("a", "moto"), bb("b", "boat"), bb("c")] });
    expect(live.vehicles).toEqual([{ riderId: "a", kind: "moto" }]);
    expect(live.boats).toEqual([{ id: "b", x: 10, y: 20, riderId: "b" }]);
  });

  it("maps the gameplay frame: rats, dogs, leaps, gate barriers across their long side", () => {
    const live = liveFromFrame({
      billboards: [],
      gameplay: {
        rats: [{ key: "r1", x: 1, y: 2, dir: 1, fallen: true }],
        dogs: [{ id: "d", x: 3, y: 4, facing: "left" }],
        leaps: [{ x: 5, y: 6, h: 0.5 }],
        gates: [{ id: "g1", at: { x: 0, y: 0 }, barrier: { x: 100, y: 200, w: 16, h: 80 } }, { id: "g2", at: { x: 50, y: 60 }, barrier: null }],
      },
    }, { stalls: [{ id: "s", x: 0, y: 0, owner: "npc" }] });
    expect(live.stalls).toHaveLength(1);
    expect(live.rats).toEqual([{ id: "r1", x: 1, y: 2, fallen: true }]);
    expect(live.dogs?.[0].id).toBe("d");
    expect(live.leaps).toHaveLength(1);
    expect(live.gates?.[0]).toMatchObject({ x: 108, y: 240, w: 80, dir: 0, open: false });
    expect(live.gates?.[1]).toMatchObject({ x: 50, w: 36 });
  });
});

describe("terrain LOD rims", () => {
  it("neighbouring chunks at different levels share their edge heights exactly", () => {
    const c = CHUNKS_X + 2;                                     // an inner chunk
    const fine = chunkArrays(c, LOD_STEPS[0]), coarse = chunkArrays(c + 1, LOD_STEPS[2]);
    const nF = CHUNK_PX / LOD_STEPS[0], nC = CHUNK_PX / LOD_STEPS[2];
    // the fine chunk's east edge (i = n) vs the coarse one's west edge (i = 0), at the coarse samples
    for (let j = 0; j <= nC; j++) {
      const jf = j * (nF / nC);
      const hf = fine.pos[(jf * (nF + 1) + nF) * 3 + 1], hc = coarse.pos[(j * (nC + 1)) * 3 + 1];
      expect(hf).toBeCloseTo(hc, 5);
    }
    // and in between the fine rim lies on the coarse edge's straight line (no T-junction crack)
    const a = fine.pos[(0 * (nF + 1) + nF) * 3 + 1], b = fine.pos[(4 * (nF + 1) + nF) * 3 + 1], mid = fine.pos[(2 * (nF + 1) + nF) * 3 + 1];
    expect(mid).toBeCloseTo((a + b) / 2, 5);
  });
});

describe("water ends", () => {
  it("the river ribbon stops a few px inside Sông Cái at both ends", () => {
    const [sIn, sOut] = riverRibbonSpan();
    expect(sIn).toBeGreaterThan(0);
    expect(sOut).toBeGreaterThan(sIn);
    expect(RIVER_LEVEL).toBeCloseTo(ZONE_ELEV.song_cai - 0.22);
  });

  it("the stream starts inside the pond, over its grass, and reaches its own slope past the zone", () => {
    const r = streamRunnel();
    const pond = ZONES.pond;
    expect(r.pts[0].y).toBeLessThan(pond.oy + pond.h);
    expect(r.level(0)).toBeGreaterThan(ZONE_ELEV.pond);
    expect(r.level(r.lip + 200)).toBeCloseTo(streamLevel(200) + 0.02, 5);
    expect(r.level(r.length)).toBeCloseTo(RIVER_LEVEL + 0.02, 5);
  });
});

describe("landmark footprints", () => {
  it("every windmill and landmark but the mine has a solid footprint; their centres are blocked off the roads", () => {
    const windmills = LANDMARKS.filter((l) => l.kind === "windmill");
    expect(LANDMARK_SOLIDS.length).toBeGreaterThanOrEqual(windmills.length + 4);
    for (const w of windmills) expect(wildBlocked(w.x, w.y)).toBe(true);
    for (const s of LANDMARK_SOLIDS) if (!onRoad(s.x, s.y)) expect(wildBlocked(s.x, s.y)).toBe(true);
  });
});

describe("mergeStatic", () => {
  it("merges still meshes into one per material family, keeps what the probe moves", () => {
    const root = new THREE.Group();
    const matA = new THREE.MeshLambertMaterial({ color: 0xff0000 }), matB = new THREE.MeshLambertMaterial({ color: 0x00ff00 });
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const still = [0, 1, 2].map((i) => { const m = new THREE.Mesh(geo, i ? matA : matB); m.position.x = i * 2; root.add(m); return m; });
    const moving = new THREE.Mesh(geo, matA);
    root.add(moving);
    const glow = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
    root.add(glow);
    expect(mergeKey(still[1])).toBe(mergeKey(still[0]));      // same family: colour is baked
    const r = mergeStatic(root, { probe: () => { moving.position.y = 3; }, keepMats: [glow.material] });
    expect(r.before).toBe(5);
    expect(r.after).toBe(3);                                    // one merged + the mover + the glow
    expect(moving.parent).toBe(root);
    expect(glow.parent).toBe(root);
    for (const m of still) expect(m.parent).toBeNull();
    const merged = root.children.find((c) => c.name === "merged") as THREE.Mesh;
    expect(merged.geometry.getAttribute("color")).toBeTruthy();
    expect((merged.material as THREE.MeshLambertMaterial).vertexColors).toBe(true);
    r.geos.forEach((g) => g.dispose());
  });
});
