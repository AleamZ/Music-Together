import { describe, it, expect } from "vitest";
import { ICON_SIZE, ITEM_ICONS, itemIconMatrix, type IconKind } from "@/lib/game/art/icons";
import { ITEM_ART } from "@/lib/game/art/items";
import { OUTLINE } from "@/lib/game/art/palettes";

const CODES: Record<IconKind, string> = {
  nonla: ".oyYZ", taibeo: ".oxX", baba: ".otTuK", tee: ".otTuK", shorts: ".opPl", long: ".opPl", dep: ".ofF", khanran: ".oqQ", skirt: ".opPl",
  chain: ".ocCD", pearls: ".ocCD", bracelet: ".ocCD", watch: ".ocCD", star: ".ocCD", bow: ".ocCD", headband: ".ocCD", flower: ".ocCD", tie: ".ocCD",
  cap: ".oxXbBg", beanie: ".oxXbBg", fedora: ".oxXbB", sunhat: ".oxXbBg", helmet: ".oxXg", coi: ".oxXbg", bucket: ".oxXbB",
  crown: ".oyYZgb", antlers: ".oxXb", cowboy: ".oyYZbB",
};
/** The icon kind an item should use (the spec for icons.ts's own mapping). */
const kindOf = (id: string): IconKind => {
  const a = ITEM_ART[id];
  if (a.slot === "bottom" && a.kind === "shorts" && id.includes("skirt")) return "skirt";
  if (a.slot === "neck" && a.style) return a.style === "pearl" ? "pearls" : "chain";
  if (a.slot === "wrist") return a.kind === "watch" ? "watch" : "bracelet";
  if (a.slot === "hairpin") return a.kind === "headband" || a.kind === "bandana" ? "headband" : a.kind;
  return a.slot === "hat" ? a.shape : a.slot === "top" || a.slot === "bottom" ? a.kind : a.slot === "shoes" ? "dep" : "khanran";
};

describe("item icon grids", () => {
  it("are 16×16 and use only their kind's colour codes", () => {
    for (const [kind, rows] of Object.entries(ITEM_ICONS) as Array<[IconKind, readonly string[]]>) {
      expect(rows, kind).toHaveLength(ICON_SIZE);
      for (const row of rows) {
        expect(row, kind).toHaveLength(ICON_SIZE);
        for (const ch of row) expect(CODES[kind], `${kind} "${ch}"`).toContain(ch);
      }
    }
  });
});

describe("itemIconMatrix", () => {
  it("colours exactly the drawn pixels of every catalog item", () => {
    for (const id of Object.keys(ITEM_ART)) {
      const m = itemIconMatrix(id);
      expect(m, id).not.toBeNull();
      const grid = ITEM_ICONS[kindOf(id)];
      m!.forEach((row, y) => row.forEach((c, x) => {
        if (grid[y][x] === ".") expect(c, `${id} ${x},${y}`).toBe("");
        else expect(c, `${id} ${x},${y}`).toMatch(/^#[0-9a-f]{6}$/);
      }));
      expect(m!.flat(), id).toContain(OUTLINE);
    }
  });
  it("uses the item's own colours", () => {
    expect(itemIconMatrix("top_baba_yellow")!.flat()).toContain("#f2c23c");
    expect(itemIconMatrix("top_baba_pink")!.flat()).toContain("#f19bb5");
    expect(itemIconMatrix("neck_khanran_red")!.flat()).toContain("#c0392b");
  });
  it("draws the same shape for items of the same kind", () => {
    const shape = (id: string) => itemIconMatrix(id)!.map((row) => row.map((c) => (c ? "#" : ".")).join(""));
    expect(shape("top_baba_yellow")).toEqual(shape("top_baba_white"));
    expect(shape("bottom_pants_black")).toEqual(shape("bottom_jeans"));
  });
  it("returns null for an unknown item", () => {
    expect(itemIconMatrix("nope")).toBeNull();
  });
});
