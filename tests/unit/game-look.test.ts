import { describe, it, expect } from "vitest";
import { DEFAULT_LOOK, lookFromRow, validateLook, characterErrorMessage, type CatalogItem } from "@/lib/game/character";

const item = (id: string, slot: CatalogItem["slot"], starter = true): CatalogItem => ({ id, slot, name: id, price: 0, starter, sort_order: 0 });
const catalog: CatalogItem[] = [
  item("hat_nonla", "hat"), item("top_baba_yellow", "top"), item("top_tee_blue", "top"),
  item("bottom_shorts_red", "bottom"), item("shoes_dep_blue", "shoes"), item("neck_khanran", "neck"),
  item("top_gold", "top", false),
];

describe("validateLook", () => {
  it("accepts the default look", () => {
    expect(validateLook(DEFAULT_LOOK, catalog)).toBeNull();
  });
  it("allows no hat and no scarf", () => {
    expect(validateLook({ ...DEFAULT_LOOK, hat: null, neck: null }, catalog)).toBeNull();
  });
  it("rejects unknown body options", () => {
    expect(validateLook({ ...DEFAULT_LOOK, hair: "mohawk" as never }, catalog)).toBe("option");
    expect(validateLook({ ...DEFAULT_LOOK, skin: "green" as never }, catalog)).toBe("option");
  });
  it("rejects wrong-slot, unknown and non-starter items", () => {
    expect(validateLook({ ...DEFAULT_LOOK, hat: "top_tee_blue" }, catalog)).toBe("slot");
    expect(validateLook({ ...DEFAULT_LOOK, top: "nope" }, catalog)).toBe("slot");
    expect(validateLook({ ...DEFAULT_LOOK, top: "top_gold" }, catalog)).toBe("slot");
  });
  it("requires top, bottom and shoes", () => {
    expect(validateLook({ ...DEFAULT_LOOK, top: null as never }, catalog)).toBe("missing");
  });
});

describe("lookFromRow", () => {
  it("maps snake_case columns", () => {
    expect(lookFromRow({ account_id: "a", skin: "tan", hair: "bob", hair_color: "pink", hat: null, top: "t", bottom: "b", shoes: "s", neck: null }))
      .toEqual({ skin: "tan", hair: "bob", hairColor: "pink", hat: null, top: "t", bottom: "b", shoes: "s", neck: null });
  });
  it("falls back to defaults for unknown body options", () => {
    const look = lookFromRow({ account_id: "a", skin: "x", hair: "y", hair_color: "z", hat: null, top: "t", bottom: "b", shoes: "s", neck: null });
    expect([look.skin, look.hair, look.hairColor]).toEqual([DEFAULT_LOOK.skin, DEFAULT_LOOK.hair, DEFAULT_LOOK.hairColor]);
  });
});

describe("characterErrorMessage", () => {
  it("maps RPC errors to Vietnamese copy", () => {
    expect(characterErrorMessage({ message: "invalid session" })).toBe("Phiên đăng nhập đã hết hạn — hãy đăng nhập lại.");
    expect(characterErrorMessage({ message: "item not available" })).toBe("Món đồ này chưa dùng được.");
    expect(characterErrorMessage({ message: "invalid character option" })).toBe("Lựa chọn ngoại hình không hợp lệ.");
    expect(characterErrorMessage(new Error("boom"))).toBe("Không lưu được nhân vật — thử lại nhé.");
  });
});
