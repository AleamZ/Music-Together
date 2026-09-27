// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { CatalogItem } from "@/lib/game/character";
import { DEFAULT_LOOK } from "@/lib/game/look";

const CATALOG: CatalogItem[] = [
  { id: "top_baba_yellow", slot: "top", name: "Áo bà ba vàng", price: 0, starter: true, sort_order: 0 },
  { id: "fm_kimono", slot: "outfit", name: "Áo kimono", price: 2200, starter: false, sort_order: 1, gender: "unisex" },
  { id: "fm_ao_dai", slot: "outfit", name: "Áo dài", price: 2500, starter: false, sort_order: 2, gender: "nu" },
  { id: "fm_hoodie", slot: "top", name: "Áo hoodie", price: 900, starter: false, sort_order: 3, gender: "unisex" },
];

vi.mock("@/lib/game/character", async (orig) => ({
  ...(await orig<typeof import("@/lib/game/character")>()),
  fetchCatalog: () => Promise.resolve(CATALOG),
}));
vi.mock("@/lib/game/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/game/store")>()),
  fetchMyWardrobe: () => Promise.resolve({ coins: 5000, items: [] }),
}));
vi.mock("@/components/game/SpritePreview", () => ({ default: () => null }));
vi.mock("@/components/game/ItemIcon", () => ({ default: () => null }));
vi.mock("@/components/game/ItemTransferDialog", () => ({ default: () => null }));

import FashionStoreModal from "@/components/game/FashionStoreModal";

afterEach(() => cleanup());

const renderModal = () => render(
  <FashionStoreModal token="t" myAccountId="a" initialLook={{ ...DEFAULT_LOOK, gender: "nam" }} members={[]} onlineIds={[]} onClose={() => {}} />,
);

describe("FashionStoreModal: outfits and gender", () => {
  it("shows the Bộ đồ chip, a ♀ tag, and hides nu-only items with Hợp với tôi", async () => {
    renderModal();
    expect(await screen.findByText("Áo dài")).toBeTruthy();
    expect(screen.getByText("♀")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "👘 Bộ đồ" }));
    expect(screen.queryByText("Áo hoodie")).toBeNull();
    expect(screen.getByText("Áo kimono")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Hợp với tôi"));
    expect(screen.queryByText("Áo dài")).toBeNull();
    expect(screen.getByText("Áo kimono")).toBeTruthy();
  });
});
