import { describe, expect, it } from "vitest";
import { ITEM_ART } from "@/lib/game/art/items";
import { BELT_COLORS } from "@/lib/game/art/uniforms";
import * as THREE from "three";
import { ChibiFactory, SEGS, buildChibi } from "@/lib/game/diorama/character/build";
import { FACE_H, FACE_W, facePixels } from "@/lib/game/diorama/character/voxel-face";
import { LOOK_SLOTS, wearableIds, wearing } from "@/lib/game/diorama/character/catalog";
import { CHAR_ACTS, FACING_YAW, REST, locomotion, poseAt, turnToward, wrapAngle, yawOf } from "@/lib/game/diorama/character/pose";
import { chibiSpec, hex, type ChibiSpec } from "@/lib/game/diorama/character/spec";
import { CO_BA_LOOK, DEFAULT_LOOK } from "@/lib/game/look";
import { GENDERS, HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Look } from "@/lib/game/types";

const HEX = /^#[0-9a-f]{6}$/;
const BARE: Look = { skin: "warm", hair: "short", hairColor: "black", hat: null, top: null, bottom: null, shoes: "shoes_dep_blue", neck: null };

function colours(s: ChibiSpec): string[] {
  const out = [s.skin, s.skinShade, s.blush, s.mouth, s.hair.main, s.hair.hi, s.hair.shade, s.torso, s.torsoShade, s.detail,
    s.sleeveColor, s.bottom, s.bottomShade, s.thigh, s.calf, s.shoe.main, s.shoe.sole];
  if (s.band) out.push(s.band);
  if (s.belt) out.push(s.belt);
  if (s.hat) out.push(s.hat.main, s.hat.shade, s.hat.brim, s.hat.accent);
  if (s.neck) out.push(s.neck.main, s.neck.shade, s.neck.accent);
  if (s.wrist) out.push(s.wrist.main, s.wrist.accent);
  if (s.hairpin) out.push(s.hairpin.main, s.hairpin.accent);
  return out;
}

describe("chibi spec: Look → 3D parts", () => {
  const ids = wearableIds();

  it("lists every drawable catalog id once per slot", () => {
    for (const [id, a] of Object.entries(ITEM_ART)) expect(ids[a.slot]).toContain(id);
    for (const slot of LOOK_SLOTS) expect(new Set(ids[slot]).size).toBe(ids[slot].length);
    expect(ids.outfit.some((id) => id.startsWith("vp_"))).toBe(true);
  });

  it("maps every catalog item in every slot to valid parts and colours", () => {
    for (const slot of LOOK_SLOTS) for (const id of ids[slot]) for (const gender of GENDERS) {
      const s = chibiSpec(wearing({ ...BARE, gender }, slot, id));
      for (const c of colours(s)) expect(c, `${slot}:${id}`).toMatch(HEX);
      if (slot === "hat") expect(s.hat, id).not.toBeNull();
      if (slot === "neck") expect(s.neck, id).not.toBeNull();
      if (slot === "wrist") expect(s.wrist, id).not.toBeNull();
      if (slot === "hairpin") expect(s.hairpin, id).not.toBeNull();
      if (slot === "top") expect(s.torso, id).not.toBe(s.skin);
    }
  });

  it("covers every skin, hair style, hair colour and body type", () => {
    for (const skin of SKIN_TONES) for (const hair of HAIR_STYLES) for (const hairColor of HAIR_COLORS) for (const gender of GENDERS) {
      const s = chibiSpec({ ...DEFAULT_LOOK, skin, hair, hairColor, gender });
      expect(s.hair.style).toBe(hair);
      expect(s.gender).toBe(gender);
      for (const c of colours(s)) expect(c).toMatch(HEX);
    }
  });

  it("falls back safely for unknown ids and styles", () => {
    const s = chibiSpec({ ...BARE, hat: "hat_nope", top: "top_nope", bottom: "bottom_nope", shoes: "shoes_nope", neck: "x", wrist: "y", hairpin: "z",
      outfit: "fm_nope", hair: "mohawk" as Look["hair"], hairColor: "green" as Look["hairColor"], skin: "blue" as Look["skin"] });
    expect(s.hat).toBeNull();
    expect(s.neck).toBeNull();
    expect(s.wrist).toBeNull();
    expect(s.hairpin).toBeNull();
    expect(s.hair.style).toBe("short");
    for (const c of colours(s)) expect(c).toMatch(HEX);
  });

  it("follows the 2D compositor: bare skin, underwear, long trousers, skirts, belts", () => {
    const bare = chibiSpec(BARE);
    expect(bare.torso).toBe(bare.skin);
    expect(bare.band).toBeNull();
    expect(chibiSpec({ ...BARE, gender: "nu" }).band).toMatch(HEX);
    const ba = chibiSpec(CO_BA_LOOK);
    expect(ba.calf).toBe(ba.bottom);                                          // long black trousers
    expect(ba.hair.style).toBe("long");
    const shorts = chibiSpec(DEFAULT_LOOK);
    expect(shorts.calf).toBe(shorts.skin);
    expect(shorts.hat?.shape).toBe("nonla");
    expect(shorts.neck?.kind).toBe("scarf");
    expect(chibiSpec({ ...BARE, gender: "nu", bottom: "fm_pleated_skirt" }).lower).toBe("pleated");
    const vp = chibiSpec({ ...BARE, outfit: "vp_vovinam", belt: 3 });
    expect(vp.belt).toBe(BELT_COLORS.vovinam[3]);
    expect(chibiSpec({ ...BARE, outfit: "vp_vovinam" }).belt).toBe(BELT_COLORS.vovinam[0]);
  });

  it("caches per look and normalises colours", () => {
    expect(chibiSpec(DEFAULT_LOOK)).toBe(chibiSpec({ ...DEFAULT_LOOK }));
    expect(hex("#ABC", "#000000")).toBe("#aabbcc");
    expect(hex("red", "#123456")).toBe("#123456");
    expect(hex(null, "#123456")).toBe("#123456");
  });
});

describe("chibi factory", () => {
  it("builds every hair style and hat shape at both detail levels: sculpted pieces on one pixel atlas", () => {
    const f = new ChibiFactory(1000);
    const hats = [...new Set(Object.entries(ITEM_ART).filter(([, a]) => a.slot === "hat").map(([id]) => id))];
    for (const detail of ["high", "low"] as const) {
      for (const hair of HAIR_STYLES) {
        const { parts } = f.acquire(chibiSpec({ ...DEFAULT_LOOK, hair, hat: null }), detail);
        expect(parts.head.getAttribute("uv").count).toBe(parts.head.getAttribute("position").count);
        for (const v of parts.head.getAttribute("uv").array as Float32Array) expect(v >= 0 && v <= 1).toBe(true);
      }
      for (const hat of hats) f.acquire(chibiSpec({ ...DEFAULT_LOOK, hat }), detail);
    }
    const { parts } = f.acquire(chibiSpec(DEFAULT_LOOK), "high");
    const tris = SEGS.reduce((n, s) => n + parts[s].getAttribute("position").count / 3, 0);
    expect(tris).toBeLessThan(16000);                                          // smoothed pieces, skinned cloth rings + the ink hull
    const tex = (p: typeof parts) => (p.material as THREE.MeshLambertMaterial).map as THREE.DataTexture;
    const low = f.acquire(chibiSpec(DEFAULT_LOOK), "low").parts;
    expect(tex(low).image.width * tex(low).image.height).toBeLessThan(tex(parts).image.width * tex(parts).image.height);
    expect(tex(parts).magFilter).toBe(THREE.LinearFilter);                    // flat colours, smooth edges
    for (const e of ["open", "blink", "happy"] as const) expect(parts.faces[e]).toBeTruthy();
    f.dispose();
  }, 30_000);                                                                   // every look twice: slow under a full parallel run

  it("paints the look's own colours into the atlas", () => {
    const spec = chibiSpec({ ...BARE, top: "top_baba_yellow" });
    const b = buildChibi(spec, "high");
    const seen = new Set<string>();
    for (let i = 0; i < b.pixels.length; i += 4) if (b.pixels[i + 3]) seen.add(`${b.pixels[i] >> 4},${b.pixels[i + 1] >> 4},${b.pixels[i + 2] >> 4}`);
    const near = (hexc: string) => {
      const n = parseInt(hexc.slice(1), 16);
      return seen.has(`${(n >> 16) >> 4},${((n >> 8) & 255) >> 4},${(n & 255) >> 4}`);
    };
    expect(near(spec.skin) || near(spec.skinShade)).toBe(true);
    expect(near(spec.torso)).toBe(true);
  });

  it("faces: open eyes differ from the blink and the smile", () => {
    const open = facePixels("open", "nam"), blink = facePixels("blink", "nam"), happy = facePixels("happy", "nu");
    expect(open.length).toBe(FACE_W * FACE_H * 4);
    expect(open).not.toEqual(blink);
    expect(open).not.toEqual(happy);
    expect(poseAt("wave", 0.3).face).toBe("happy");
    expect([0, 1, 2, 3, 3.5].some((t) => poseAt("idle", t).face === "blink")).toBe(true);
    expect(poseAt("idle", 3.5, 0, true).face).toBe("open");
  });

  it("shares parts per look and evicts only released ones", () => {
    const f = new ChibiFactory(2);
    const a = f.acquire(chibiSpec(DEFAULT_LOOK), "high");
    expect(f.acquire(chibiSpec({ ...DEFAULT_LOOK }), "high").parts).toBe(a.parts);
    f.acquire(chibiSpec(CO_BA_LOOK), "high");
    f.acquire(chibiSpec(BARE), "high");
    expect(f.size()).toBe(3);                                                  // all in use: nothing evicted
    f.release(a.key); f.release(a.key);
    expect(f.size()).toBe(2);
    f.dispose();
  });
});

describe("chibi poses", () => {
  it("every action gives finite joints; reduced motion is still", () => {
    for (const act of CHAR_ACTS) for (const t of [0, 0.3, 1.1, 7.7]) {
      const p = poseAt(act, t, 0.4);
      for (const v of [p.bob, p.lean, p.drop, p.headX, p.headZ, p.armL.x, p.armL.z, p.armR.x, p.armR.z, p.elbowL, p.elbowR, p.legL.x, p.legR.x, p.kneeL, p.kneeR]) {
        expect(Number.isFinite(v)).toBe(true);
      }
      expect(poseAt(act, t, 0, true)).toEqual(poseAt(act, 0, 0, true));
    }
    expect(poseAt("idle", 0, 0, true).drop).toBe(REST.drop);
  });

  it("walking swings the legs in opposition and the arms against the legs", () => {
    for (const t of [0.1, 0.2, 0.5]) {
      const p = poseAt("walk", t);
      expect(p.legL.x).toBeCloseTo(-p.legR.x);
      expect(Math.sign(p.armL.x) === Math.sign(p.legL.x) && p.legL.x !== 0).toBe(false);
    }
    const walk = Math.max(...[0.05, 0.1, 0.15, 0.2].map((t) => Math.abs(poseAt("walk", t).legL.x)));
    const run = Math.max(...[0.05, 0.1, 0.15, 0.2].map((t) => Math.abs(poseAt("run", t).legL.x)));
    expect(run).toBeGreaterThan(walk);
  });

  it("sits low with the thighs forward and the calves down; casts hold a rod", () => {
    const s = poseAt("sit", 0);
    expect(s.drop).toBeGreaterThan(0.3);
    expect(s.legL.x - s.kneeL).toBeCloseTo(0.1, 1);
    expect(poseAt("cast", 0.2).rod).toBe(1);
    expect(poseAt("reel", 0).rod).toBe(1);
    expect(poseAt("walk", 0).rod).toBe(0);
    expect(poseAt("wave", 0).armR.z).toBeGreaterThan(2);
  });

  it("picks idle/walk/run from speed", () => {
    expect(locomotion(0)).toBe("idle");
    expect(locomotion(70)).toBe("walk");
    expect(locomotion(160)).toBe("run");
  });

  it("faces the way it moves and turns the short way round", () => {
    expect(yawOf(0, 1)).toBeCloseTo(FACING_YAW.down);
    expect(yawOf(1, 0)).toBeCloseTo(FACING_YAW.right);
    expect(Math.abs(yawOf(0, -1))).toBeCloseTo(Math.PI);
    expect(yawOf(-1, 0)).toBeCloseTo(FACING_YAW.left);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(wrapAngle(-Math.PI / 2 - 2 * Math.PI)).toBeCloseTo(-Math.PI / 2);
    // from 170° to -170°: 20° through ±180°, not 340° back
    const from = (170 * Math.PI) / 180, to = (-170 * Math.PI) / 180;
    const step = turnToward(from, to, 0.01, 10);
    expect(Math.abs(wrapAngle(step - from))).toBeCloseTo(0.1);
    expect(wrapAngle(step - from)).toBeGreaterThan(0);
    expect(turnToward(0, 0.05, 1, 12)).toBeCloseTo(0.05);
    let y = 0;
    for (let i = 0; i < 60; i++) y = turnToward(y, Math.PI / 2, 1 / 60, 12);
    expect(y).toBeCloseTo(Math.PI / 2);
  });
});
