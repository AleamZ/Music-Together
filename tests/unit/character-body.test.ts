import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

// v22 (0094): body proportions ride on the look (characters.body), are saved through save_character's p_body and read
// back for everyone through the characters select.
const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
const selects: string[] = [];
const ROW = { account_id: "a", skin: "warm", hair: "short", hair_color: "black", hat: null, top: null, bottom: null, shoes: "shoes_dep_blue",
  neck: null, gender: "nam", outfit: null, wrist: null, hairpin: null };
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: { ...ROW, gender: args.p_gender ?? "nam", body: args.p_body ?? null }, error: null };
    },
    from: () => ({
      select: (cols: string) => {
        selects.push(cols);
        return {
          in: async () => (cols.includes("body")
            ? { data: null, error: { code: "42703", message: "column characters.body does not exist" } }
            : { data: [{ ...ROW, pg_level: 3 }], error: null }),
        };
      },
    }),
  },
}));

import { BEARDS, BODY_SLIDERS, DEFAULT_BODY, FEMALE_DEFAULT_BODY, defaultBody, EYE_COLORS, GENDER_ONLY, bodyKey, isDefaultBody, normalizeBody, randomBody, slidersFor, switchGender } from "@/lib/game/body";
import { characterErrorMessage, fetchCharacters, lookFromRow, saveCharacter, validateLook } from "@/lib/game/character";
import { DEFAULT_LOOK } from "@/lib/game/look";

describe("body shape (pure)", () => {
  it("normalizes: clamps, rounds, drops unknown keys, fixes bad values", () => {
    const n = normalizeBody({ height: 2, legs: -3, head: 0.456, arms: "x", tail: 1, eyeColor: "red" });
    expect(n.height).toBe(1);
    expect(n.legs).toBe(-1);
    expect(n.head).toBe(0.46);
    expect(n.arms).toBe(0);
    expect(n).not.toHaveProperty("tail");
    expect(n.eyeColor).toBe("nau");
    expect(Object.keys(n).sort()).toEqual([...BODY_SLIDERS, "eyeColor", "beard"].sort());
    expect(normalizeBody(null)).toEqual(DEFAULT_BODY);
    expect(normalizeBody({ eyeColor: "tim" }).eyeColor).toBe("tim");
    expect(normalizeBody({ beard: "beard?" }).beard).toBe("none");
    expect(normalizeBody({ beard: "full" }).beard).toBe("full");
  });

  it("gender-only sliders and the beard follow the body type", () => {
    const nam = slidersFor("nam"), nu = slidersFor("nu");
    expect(nam).toEqual(expect.arrayContaining(["shoulders", "muscle"]));
    expect(nam).not.toEqual(expect.arrayContaining(["bust"]));
    for (const k of GENDER_ONLY.nu) expect(nam).not.toContain(k);
    for (const k of GENDER_ONLY.nam) expect(nu).not.toContain(k);
    expect(nu).toEqual(expect.arrayContaining(["bust", "waist", "hips"]));
    expect(nam.slice(0, 8)).toEqual(nu.slice(0, 8));                         // shared first
    const mixed = { height: 0.4, bust: 0.5, muscle: 0.7, beard: "goatee" };
    expect(normalizeBody(mixed, "nu")).toMatchObject({ height: 0.4, bust: 0.5, muscle: 0, beard: "none" });
    expect(normalizeBody(mixed, "nam")).toMatchObject({ height: 0.4, bust: 0, muscle: 0.7, beard: "goatee" });
    expect(isDefaultBody({ bust: 1 }, "nam")).toBe(true);
    expect(isDefaultBody({ bust: 1 }, "nu")).toBe(true);                      // a girl's default bust is 1
    expect(isDefaultBody({ bust: 0 }, "nu")).toBe(false);
    expect(isDefaultBody(null, "nu")).toBe(true);
    expect(isDefaultBody({ ...DEFAULT_BODY }, "nu")).toBe(false);             // an all-zero girl is not her default
    expect(isDefaultBody({ ...DEFAULT_BODY }, "nam")).toBe(true);
    expect(isDefaultBody({ ...FEMALE_DEFAULT_BODY }, "nam")).toBe(false);
    expect(normalizeBody(null, "nu")).toEqual(FEMALE_DEFAULT_BODY);
    expect(normalizeBody({ height: 0.5 }, "nu")).toEqual({ ...FEMALE_DEFAULT_BODY, height: 0.5 });
    expect(defaultBody("nam")).toEqual(DEFAULT_BODY);
    expect(bodyKey({ beard: "full" }, "nu")).toBe("");
    const sw = switchGender({ height: 0.3, shoulders: 1, beard: "full", eyeColor: "xam" }, "nu");
    expect(sw).toMatchObject({ height: 0.3, shoulders: 0, beard: "none", eyeColor: "xam" });
    expect(switchGender({ bust: 1, waist: -1 }, "nam")).toMatchObject({ bust: 0, waist: 0 });
    const toNu = switchGender({ height: 0.2, bust: 0, waist: -1, shoulders: 1 }, "nu");
    expect(toNu).toMatchObject({ height: 0.2, bust: 1, waist: 1, hips: 1, shoulders: 0 });   // the girl-only sliders take her defaults
    let s = 7;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < 20; i++) {
      const b = randomBody(rnd, "nu");
      expect(b.beard).toBe("none");
      for (const k of GENDER_ONLY.nam) expect(b[k]).toBe(0);
      expect(BEARDS).toContain(randomBody(rnd, "nam").beard);
    }
  });

  it("detects the default body and keys bodies", () => {
    expect(isDefaultBody(null)).toBe(true);
    expect(isDefaultBody({})).toBe(true);
    expect(isDefaultBody({ ...DEFAULT_BODY })).toBe(true);
    expect(isDefaultBody({ height: 0.1 })).toBe(false);
    expect(isDefaultBody({ eyeColor: "xam" })).toBe(false);
    expect(bodyKey(null)).toBe("");
    expect(bodyKey(DEFAULT_BODY)).toBe("");
    expect(bodyKey({ height: 0.5 })).toBe(bodyKey({ height: 0.5, eyeColor: "nau", junk: 3 }));
    expect(bodyKey({ height: 0.5 })).not.toBe(bodyKey({ height: 0.55 }));
  });

  it("random bodies stay within ±0.8 and use a real eye colour", () => {
    let s = 1;
    const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 0; i < 50; i++) {
      const b = randomBody(rnd);
      for (const k of BODY_SLIDERS) expect(Math.abs(b[k])).toBeLessThanOrEqual(0.8);
      expect(EYE_COLORS).toContain(b.eyeColor);
    }
    expect(randomBody(() => 0.999999).eyeColor).toBe("tim");
  });
});

describe("body on the character (client)", () => {
  it("reads body from the row; a default or missing body is absent", () => {
    expect(lookFromRow({ ...ROW }).body).toBeUndefined();
    expect(lookFromRow({ ...ROW, body: null }).body).toBeUndefined();
    expect(lookFromRow({ ...ROW, body: { height: 0 } }).body).toBeUndefined();
    expect(lookFromRow({ ...ROW, body: { height: 0.3, tail: 1 } }).body).toEqual({ ...DEFAULT_BODY, height: 0.3 });
  });

  it("validateLook accepts a missing or any body (normalized on save)", () => {
    const catalog = [{ id: DEFAULT_LOOK.shoes, slot: "shoes" as const, name: "Dép", price: 0, starter: true, sort_order: 0 }];
    const base = { ...DEFAULT_LOOK, hat: null, top: null, bottom: null, neck: null, gender: "nam" as const };
    expect(validateLook(base, catalog)).toBeNull();
    expect(validateLook({ ...base, body: { height: 0.4 } }, catalog)).toBeNull();
  });

  it("saveCharacter sends p_body: null for a default body, the normalized body otherwise", async () => {
    await saveCharacter("tok", { ...DEFAULT_LOOK });
    expect(rpcCalls[0].fn).toBe("save_character");
    // a boy's body saved as a girl drops the boys-only keys (and the beard)
    expect(rpcCalls[0].args.p_body).toBeNull();
    await saveCharacter("tok", { ...DEFAULT_LOOK, body: { ...DEFAULT_BODY } });
    expect(rpcCalls[1].args.p_body).toBeNull();
    const saved = await saveCharacter("tok", { ...DEFAULT_LOOK, body: { legs: 1.7, eyeColor: "xanh" } });
    expect(rpcCalls[2].args.p_body).toEqual({ ...DEFAULT_BODY, legs: 1, eyeColor: "xanh" });
    expect(saved.body).toEqual({ ...DEFAULT_BODY, legs: 1, eyeColor: "xanh" });
    await saveCharacter("tok", { ...DEFAULT_LOOK, gender: "nu", body: { muscle: 1, beard: "full" } });
    expect(rpcCalls[3].args.p_body).toBeNull();
    await saveCharacter("tok", { ...DEFAULT_LOOK, gender: "nu", body: { bust: 0.5, muscle: 1 } });
    expect(rpcCalls[4].args.p_body).toEqual({ ...FEMALE_DEFAULT_BODY, bust: 0.5 });
    // a girl's default round-trips as null; an explicit all-zero girl is kept
    const girl = await saveCharacter("tok", { ...DEFAULT_LOOK, gender: "nu", body: { ...FEMALE_DEFAULT_BODY } });
    expect(rpcCalls[5].args.p_body).toBeNull();
    expect(girl.body).toBeUndefined();
    const zero = await saveCharacter("tok", { ...DEFAULT_LOOK, gender: "nu", body: { ...DEFAULT_BODY } });
    expect(rpcCalls[6].args.p_body).toEqual({ ...DEFAULT_BODY });
    expect(normalizeBody(zero.body, "nu")).toEqual(DEFAULT_BODY);
    expect(characterErrorMessage({ message: "invalid body shape" })).toBe("Dáng người không hợp lệ.");
  });

  it("fetchCharacters asks for body and falls back without it on an older database", async () => {
    const m = await fetchCharacters(["a"]);
    expect(selects[0]).toContain("body");
    expect(selects[1]).toContain("pg_title");
    expect(selects[1]).not.toContain("body");
    expect(m.get("a")?.pgLevel).toBe(3);
  });
});

describe("0094_body_shape.sql", () => {
  const sql = readFileSync("supabase/migrations/0094_body_shape.sql", "utf8").replace(/\r\n/g, "\n");
  it("adds the column and the p_body parameter with its checks", () => {
    expect(sql).toContain("add column if not exists body jsonb");
    expect(sql).toContain("p_body jsonb default null");
    expect(sql).toContain("greatest(-1, least(1,");
    expect(sql).toContain("v_boys constant text[] := array['shoulders','muscle']");
    expect(sql).toContain("v_girls constant text[] := array['bust','waist','hips']");
    expect(sql).toContain(`array[${BEARDS.map((c) => `'${c}'`).join(",")}]`);
    expect(sql).toContain("public._body_normalize(p_body, p_gender)");
    const fem = JSON.parse(/v_female constant jsonb := '(\{[^']*\})'/.exec(sql)?.[1] ?? "null") as Record<string, number>;
    for (const [k, v] of Object.entries(fem)) expect(FEMALE_DEFAULT_BODY[k as keyof typeof FEMALE_DEFAULT_BODY]).toBe(v);
    for (const k of BODY_SLIDERS) if (FEMALE_DEFAULT_BODY[k] !== 0) expect(fem[k]).toBe(FEMALE_DEFAULT_BODY[k]);
    expect(sql).toContain("if v_num <> v_def then v_default := false; end if;");
    expect(sql).toContain("'invalid body shape'");
    for (const k of BODY_SLIDERS) expect(sql).toContain(`'${k}'`);
    expect(sql).toContain(`array[${EYE_COLORS.map((c) => `'${c}'`).join(",")}]`);
    expect(sql).toContain("drop function if exists public.save_character(text,text,text,text,text,text,text,text,text,text,text,text,text)");
    expect(sql).toContain("grant execute on function public.save_character(text,text,text,text,text,text,text,text,text,text,text,text,text,jsonb) to anon, authenticated");
  });
});
