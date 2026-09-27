import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DEFAULT_HAIR, hairForBody } from "@/lib/game/character";
import { salonErrorMessage } from "@/lib/game/salon";
import { HAIR_STYLES, HAIR_STYLES_BY_GENDER, hairFitsGender, type Look } from "@/lib/game/types";
import SalonModal from "@/components/game/SalonModal";

afterEach(() => cleanup());

describe("hair styles per body", () => {
  it("follows the owner's ruling", () => {
    expect(HAIR_STYLES_BY_GENDER.nam).toEqual(["short", "buzz", "undercut", "curly", "bangs"]);
    expect(HAIR_STYLES_BY_GENDER.nu).toEqual(["long", "bob", "ponytail", "twin_braids", "bun", "bangs", "curly", "short"]);
    for (const h of HAIR_STYLES) expect(hairFitsGender(h, "nam") || hairFitsGender(h, "nu")).toBe(true);
    for (const g of ["nam", "nu"] as const) expect(hairFitsGender(DEFAULT_HAIR[g].hair, g)).toBe(true);
  });

  it("equals 0035_salon_gender.sql _hair_gender_ok", () => {
    const sql = readFileSync("supabase/migrations/0035_salon_gender.sql", "utf8");
    const list = (g: string) => {
      const m = sql.match(new RegExp(`when '${g}'\\s+then p_hair in \\(([^)]*)\\)`));
      expect(m).not.toBeNull();
      return m![1].split(",").map((s) => s.trim().replace(/'/g, ""));
    };
    expect(list("nam")).toEqual([...HAIR_STYLES_BY_GENDER.nam]);
    expect(list("nu")).toEqual([...HAIR_STYLES_BY_GENDER.nu]);
  });

  it("hairForBody resets only a style the new body is not offered", () => {
    expect(hairForBody("buzz", "nam", "nu")).toBe("long");
    expect(hairForBody("bun", "nu", "nam")).toBe("short");
    expect(hairForBody("curly", "nam", "nu")).toBe("curly");
    expect(hairForBody("ponytail", "nam", "nam")).toBe("ponytail"); // legacy style kept on the same body
  });

  it("maps the gender refusal to Vietnamese", () => {
    expect(salonErrorMessage({ message: "hair not for this gender" })).toMatch(/dáng người/);
  });
});

describe("SalonModal per body", () => {
  const LOOK: Look = {
    skin: "light", hair: "short", hairColor: "black", hat: null, top: null, bottom: null,
    shoes: "shoes_dep_blue", neck: null, gender: "nam",
  };
  const show = (look: Look) => render(<SalonModal token="t" look={look} coins={1000} onStyled={vi.fn()} onClose={() => {}} />);

  it("offers only nam styles to a nam", () => {
    show(LOOK);
    expect(screen.getByRole("heading", { name: /Kiểu tóc nam/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Đầu đinh/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Búi củ tỏi/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Tóc dài/ })).toBeNull();
  });

  it("offers only nữ styles to a nữ", () => {
    show({ ...LOOK, gender: "nu", hair: "long" });
    expect(screen.getByRole("heading", { name: /Kiểu tóc nữ/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Tết hai bên/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Undercut/ })).toBeNull();
  });

  it("keeps a legacy style listed as the current one", () => {
    show({ ...LOOK, hair: "ponytail" });
    expect(screen.getByRole("button", { name: /Đuôi ngựa/ }).textContent).toContain("đang để");
    expect(screen.queryByRole("button", { name: /Búi củ tỏi/ })).toBeNull();
  });
});
