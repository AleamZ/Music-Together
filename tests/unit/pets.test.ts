import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_PETS, PET_ITEMS, PET_SPECIES, SPECIES, fashionFor, foodOf, toyOf } from "@/lib/game/pets/catalog";
import { FOLLOW_GAP, PetFollowers, petPose, pointBack, SNAP_DIST } from "@/lib/game/pets/follow";
import {
  buffActive, decay, encodePet, NO_PER_S, parrotEchoes, parsePetCode, petErrorMessage, petSpeed, sanitizePetName, sulking,
  VUI_PER_S, type PetLook,
} from "@/lib/game/pets/model";
import { parseGameMessage } from "@/lib/game/net/protocol";
import { petPixels, PET_W } from "@/lib/game/art/pets";

describe("pet art", () => {
  it("draws every species, variant, facing and pose 16 px wide in known colours", () => {
    for (const sp of PET_SPECIES) for (const v of SPECIES[sp].variants) for (const f of ["down", "up", "left", "right"] as const) for (const pose of [0, 1, 2] as const) {
      const px = petPixels({ species: sp, variant: v.id, head: null, neck: null, body: null, happy: true }, f, pose);
      expect(px.length, `${sp}/${f}`).toBeLessThanOrEqual(16);
      for (const row of px) {
        expect(row.length, `${sp}/${f}/${pose}`).toBe(PET_W);
        for (const c of row) if (c !== null) expect(c, `${sp}/${v.id}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
  it("paints each fashion item on its species", () => {
    for (const it of PET_ITEMS.filter((i) => i.kind === "head" || i.kind === "neck" || i.kind === "body")) {
      const base = { species: it.species, variant: SPECIES[it.species].variants[0].id, head: null, neck: null, body: null, happy: true };
      const plain = JSON.stringify(petPixels(base, "down", 0));
      expect(JSON.stringify(petPixels({ ...base, [it.kind]: it.id }, "down", 0)), it.id).not.toBe(plain);
    }
  });
});

const SQL = readFileSync("supabase/migrations/0036_pets.sql", "utf8");
const cat: PetLook = { species: "meo", variant: "cam", head: "meo_bow", neck: null, body: "meo_sweater", happy: true };

describe("the pet catalog (mirror of 0036)", () => {
  it("lists exactly the TS items with the same kind, species and price", () => {
    const rows = [...SQL.matchAll(/\('([a-z_]+)', '[^']+', '(food|toy|head|neck|body)', '([a-z]+)', (\d+), \d+\)/g)]
      .map((m) => [m[1], m[2], m[3], Number(m[4])].join(","));
    expect(rows.sort()).toEqual(PET_ITEMS.map((i) => [i.id, i.kind, i.species, i.price].join(",")).sort());
  });
  it("prices the species and their variants as the server", () => {
    for (const sp of PET_SPECIES) {
      expect(SQL, sp).toContain(`when '${sp}' then ${SPECIES[sp].price}`);
      expect(SQL, sp).toContain(`when '${sp}' then p_variant in (${SPECIES[sp].variants.map((v) => `'${v.id}'`).join(",")})`);
    }
    expect(SQL).toContain(">= 6 then");
    expect(MAX_PETS).toBe(6);
  });
  it("has a food and a toy for every species, fashion restricted to one species", () => {
    for (const sp of PET_SPECIES) {
      expect(foodOf(sp).id).toBe(`food_${sp}`);
      expect(toyOf(sp).species).toBe(sp);
      expect(["head", "neck", "body"].some((s) => fashionFor(sp, s as "head").length > 0), sp).toBe(true);
    }
    expect(PET_ITEMS.filter((i) => ["head", "neck", "body"].includes(i.kind))).toHaveLength(15);
  });
  it("keeps the rates and rules equal to the SQL", () => {
    expect(SQL).toContain("100.0 / 172800, 100.0 / 129600 * case when p_species = 'hamster' then 0.5 else 1 end");
    expect(NO_PER_S).toBe(100 / 172800);
    expect(VUI_PER_S).toBe(100 / 129600);
    expect(SQL).toContain("least(100, p.fullness + 40), happy = least(100, p.happy + 5)");
    expect(SQL).toContain("least(100, p.happy + 25)");
    expect(SQL).toContain("'pet_buy','pet_find'");
    expect(SQL).toContain("then 0.9 else 1");
  });
});

describe("pet care rules", () => {
  it("decays no in 48 h and vui in 36 h (a hamster's vui in 72 h)", () => {
    expect(decay("meo", { no: 100, vui: 100 }, 86400)).toEqual({ no: 50, vui: expect.closeTo(33.33, 2) });
    expect(decay("hamster", { no: 100, vui: 100 }, 129600).vui).toBeCloseTo(50, 5);
    expect(decay("cho", { no: 10, vui: 10 }, 1e7)).toEqual({ no: 0, vui: 0 });
  });
  it("sulks at 0 no; buffs only above 50 vui", () => {
    expect(sulking({ no: 0 })).toBe(true);
    expect(buffActive({ no: 1, vui: 51 })).toBe(true);
    expect(buffActive({ no: 1, vui: 50 })).toBe(false);
    expect(buffActive({ no: 0, vui: 90 })).toBe(false);
  });
  it("speeds up with a happy dog or rabbit only", () => {
    expect(petSpeed({ species: "cho", happy: true })).toBe(1.05);
    expect(petSpeed({ species: "tho", happy: true })).toBe(1.03);
    expect(petSpeed({ species: "cho", happy: false })).toBe(1);
    expect(petSpeed({ species: "meo", happy: true })).toBe(1);
    expect(petSpeed(null)).toBe(1);
  });
  it("sanitises names like _pet_name", () => {
    expect(sanitizePetName("  Bé\t<b>Hạt</b>  Dẻ ")).toBe("BébHạt/b Dẻ");
    expect(sanitizePetName(" <> ")).toBeNull();
    expect(sanitizePetName("a".repeat(16))).toBe("a".repeat(16));
    expect(sanitizePetName("a".repeat(17))).toBeNull();
    expect(sanitizePetName("Mướp")).toBe("Mướp");
  });
  it("maps server errors to Vietnamese", () => {
    expect(petErrorMessage("sulking")).toContain("dỗi");
    expect(petErrorMessage("no food")).toContain("đồ ăn");
    expect(petErrorMessage("???")).toBe("Không được, thử lại nhé.");
  });
});

describe("the pt code", () => {
  it("round-trips", () => {
    const code = encodePet(cat);
    expect(code).toBe("meo.cam.meo_bow.0.meo_sweater.1");
    expect(parsePetCode(code)).toEqual(cat);
  });
  it("drops other species' or unknown items, rejects malformed codes", () => {
    expect(parsePetCode("meo.cam.cho_party.0.0.0")).toMatchObject({ head: null, happy: false });
    expect(parsePetCode("meo.cam.future_hat.0.0.1")).toMatchObject({ head: null });
    expect(parsePetCode("meo.tim.0.0.0.1")).toBeNull();
    expect(parsePetCode("rong.vang.0.0.0.1")).toBeNull();
    expect(parsePetCode("meo.cam.0.0.0")).toBeNull();
    expect(parsePetCode("meo.cam.BAD!.0.0.1")).toBeNull();
    expect(parsePetCode(42)).toBeNull();
  });
  it("rides on st/mv/pa and is dropped when malformed", () => {
    const b = { width: 800, height: 400 };
    const st = parseGameMessage("st", { id: "a", x: 1, y: 1, d: "d", mv: false, vx: 0, vy: 0, pt: "cho.vang.0.0.0.1" }, b);
    expect(st).toMatchObject({ pt: "cho.vang.0.0.0.1" });
    const bad = parseGameMessage("mv", { id: "a", x: 1, y: 1, d: "d", mv: true, vx: 1, vy: 0, pt: "x" }, b);
    expect(bad).not.toBeNull();
    expect(bad).not.toHaveProperty("pt");
    const pa = parseGameMessage("pa", { id: "a", x: 1, y: 1, pts: [[2, 2]], pt: "vet.lam.vet_tophat.vet_bowtie.0.1" }, b);
    expect(pa).toMatchObject({ pt: "vet.lam.vet_tophat.vet_bowtie.0.1" });
  });
  it("lets a third of the lines be echoed by a parrot, the same everywhere", () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line ${i}`);
    const n = lines.filter((l) => parrotEchoes("acc", l)).length;
    expect(n).toBeGreaterThan(60);
    expect(n).toBeLessThan(140);
    expect(parrotEchoes("acc", "xin chào")).toBe(parrotEchoes("acc", "xin chào"));
  });
});

describe("following", () => {
  it("finds the point a gap back along the trail", () => {
    expect(pointBack([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 30, y: 0 }], 14)).toEqual({ x: 16, y: 0 });
    expect(pointBack([{ x: 5, y: 5 }, { x: 8, y: 5 }], 14)).toEqual({ x: 5, y: 5 });
  });
  it("trails its owner, faces where it walks, hides while riding, snaps after a jump", () => {
    const f = new PetFollowers();
    f.setCode("a", "cho.vang.0.0.0.1");
    f.step([{ id: "a", pos: { x: 100, y: 100 }, hidden: false }], 0.016);
    expect(f.pos("a")).toEqual({ x: 100, y: 100 });
    for (let x = 102; x <= 160; x += 2) f.step([{ id: "a", pos: { x, y: 100 }, hidden: false }], 0.016);
    for (let k = 0; k < 30; k++) f.step([{ id: "a", pos: { x: 160, y: 100 }, hidden: false }], 0.016);
    expect(f.pos("a")!.x).toBeCloseTo(160 - FOLLOW_GAP, 0);
    expect(f.drawn()[0]).toMatchObject({ facing: "right", moving: false });
    f.step([{ id: "a", pos: { x: 160, y: 100 }, hidden: true }], 0.016);
    expect(f.pos("a")).toBeNull();
    f.step([{ id: "a", pos: { x: 160 + SNAP_DIST + 50, y: 300 }, hidden: false }], 0.016);
    expect(f.pos("a")).toEqual({ x: 160 + SNAP_DIST + 50, y: 300 });
    f.step([], 0.016);
    expect(f.drawn()).toEqual([]);
    f.setCode("a", null);
    expect(f.code("a")).toBeNull();
  });
  it("walks in a 1-0-2-0 cycle, standing still under reduced motion", () => {
    expect([0, 110, 220, 330].map((t) => petPose(true, t, false))).toEqual([1, 0, 2, 0]);
    expect(petPose(true, 110 * 2, true)).toBe(0);
    expect(petPose(false, 0, false)).toBe(0);
  });
});
