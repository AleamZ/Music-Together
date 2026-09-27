import { describe, it, expect } from "vitest";
import { DEFAULT_LOOK, validateLook, type CatalogItem } from "@/lib/game/character";
import { storeErrorMessage } from "@/lib/game/store";
import { ITEM_ART } from "@/lib/game/art/items";

const mockItem = (id: string, slot: CatalogItem["slot"], starter = true, price = 0): CatalogItem => ({
  id, slot, name: id, price, starter, sort_order: 0,
});

const sampleCatalog: CatalogItem[] = [
  mockItem("hat_nonla", "hat"),
  mockItem("top_baba_yellow", "top"),
  mockItem("top_tee_blue", "top"),
  mockItem("bottom_shorts_red", "bottom"),
  mockItem("shoes_dep_blue", "shoes"),
  mockItem("neck_khanran", "neck"),
  // Store items (non-starter)
  mockItem("hat_crown_gold", "hat", false, 1000),
  mockItem("top_vest_tuxedo", "top", false, 500),
  mockItem("bottom_pants_royal", "bottom", false, 500),
  mockItem("shoes_boots_combat", "shoes", false, 280),
  mockItem("neck_gold_chain", "neck", false, 888),
];

describe("validateLook with wardrobe ownership", () => {
  it("rejects non-starter items when unowned", () => {
    const look = { ...DEFAULT_LOOK, top: "top_vest_tuxedo" };
    expect(validateLook(look, sampleCatalog)).toBe("slot");
  });

  it("permits non-starter items when user owns them in wardrobe", () => {
    const look = {
      ...DEFAULT_LOOK,
      hat: "hat_crown_gold",
      top: "top_vest_tuxedo",
      bottom: "bottom_pants_royal",
      shoes: "shoes_boots_combat",
      neck: "neck_gold_chain",
    };
    const owned = new Set([
      "hat_crown_gold",
      "top_vest_tuxedo",
      "bottom_pants_royal",
      "shoes_boots_combat",
      "neck_gold_chain",
    ]);
    expect(validateLook(look, sampleCatalog, owned)).toBeNull();
  });

  it("permits starter items even if not in owned set", () => {
    const look = { ...DEFAULT_LOOK, top: "top_baba_yellow" };
    const emptyOwned = new Set<string>();
    expect(validateLook(look, sampleCatalog, emptyOwned)).toBeNull();
  });

  it("rejects if any worn non-starter item is not owned", () => {
    const look = {
      ...DEFAULT_LOOK,
      top: "top_vest_tuxedo",
      bottom: "bottom_pants_royal",
    };
    // User only owns the top, not the bottom
    const partialOwned = new Set(["top_vest_tuxedo"]);
    expect(validateLook(look, sampleCatalog, partialOwned)).toBe("slot");
  });
});

describe("storeErrorMessage", () => {
  it("translates database errors into friendly Vietnamese notices", () => {
    expect(storeErrorMessage({ message: "insufficient funds" })).toBe("Bạn không đủ xu để mua món này!");
    expect(storeErrorMessage({ message: "already owned" })).toBe("Bạn đã sở hữu món đồ này rồi!");
    expect(storeErrorMessage({ message: "recipient already owns item" })).toBe("Người nhận đã có món đồ này rồi!");
    expect(storeErrorMessage({ message: "not owned" })).toBe("Bạn chưa sở hữu món đồ này.");
    expect(storeErrorMessage(new Error("network failure"))).toBe("Giao dịch không thành công — vui lòng thử lại!");
  });
});

describe("100 fashion catalog items integrity", () => {
  it("defines exactly 140 total items in ITEM_ART (15 starters + 100 store fashion items + 15 accessories + 10 hats)", () => {
    expect(Object.keys(ITEM_ART)).toHaveLength(140);
  });

  it("ensures each fashion slot has substantial variety", () => {
    const hats = Object.values(ITEM_ART).filter((a) => a.slot === "hat");
    const tops = Object.values(ITEM_ART).filter((a) => a.slot === "top");
    const bottoms = Object.values(ITEM_ART).filter((a) => a.slot === "bottom");
    const shoes = Object.values(ITEM_ART).filter((a) => a.slot === "shoes");
    const neck = Object.values(ITEM_ART).filter((a) => a.slot === "neck");

    // 2 starter hats + 20 store hats + 10 hats (0029) = 32
    expect(hats.length).toBe(32);
    // 5 starter tops + 25 store tops = 30
    expect(tops.length).toBe(30);
    // 3 starter bottoms + 25 store bottoms = 28
    expect(bottoms.length).toBe(28);
    // 3 starter shoes + 15 store shoes = 18
    expect(shoes.length).toBe(18);
    // 2 starter neck + 15 store neck + 4 necklaces (0029) = 21
    expect(neck.length).toBe(21);
    expect(Object.values(ITEM_ART).filter((a) => a.slot === "wrist")).toHaveLength(5);
    expect(Object.values(ITEM_ART).filter((a) => a.slot === "hairpin")).toHaveLength(6);
  });
});
