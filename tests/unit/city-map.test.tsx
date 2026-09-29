import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CityMapModal from "@/components/game/CityMapModal";
import { CITY_PLACES, cityRoads } from "@/lib/game/maps/city";
import { propFrame } from "@/lib/game/maps/props";
import { overlaps } from "@/lib/game/maps/rect";
import { getMap } from "@/lib/game/maps/registry";
import { MAP_IDS } from "@/lib/game/maps/types";
import { isBlockedAt } from "@/lib/game/movement";
import { findPath } from "@/lib/game/pathfinding";
import { PROMPT_RANGE } from "@/lib/game/scene";
import { SHELL_KINDS, SHELL_PANEL_OF } from "@/lib/game/shell-kinds";

afterEach(cleanup);

describe("city-map signposts", () => {
  it("stand on every map: walkable, reachable use spot, drawn where they are clicked, off the other interactables", () => {
    for (const id of MAP_IDS) {
      const map = getMap(id);
      const posts = map.interactables.filter((i) => i.kind === "city_map");
      expect(posts, id).toHaveLength(1);
      const post = posts[0];
      expect(post).toMatchObject({ id: "city_map", label: "Bản đồ thành phố", prompt: "Xem bản đồ thành phố" });
      expect(isBlockedAt(map, post.use.x, post.use.y), id).toBe(false);
      expect(findPath(map, map.spawn, post.use), id).not.toBeNull();
      // its base is solid, and the sprite covers the click rect
      const prop = map.props.find((p) => p.kind === "city_map_post")!;
      expect(isBlockedAt(map, prop.x, prop.y - 2), id).toBe(true);
      const f = propFrame(prop);
      expect({ x: prop.x - f.ox, y: prop.y - f.oy, w: f.w, h: f.h }).toEqual(post.rect);
      for (const other of map.interactables) {
        if (other === post) continue;
        expect(overlaps(other.rect, post.rect), `${id}/${other.id}`).toBe(false);
      }
      // near the way in, but arriving does not show its prompt at once
      expect(Math.hypot(post.use.x - map.spawn.x, post.use.y - map.spawn.y), id).toBeGreaterThan(PROMPT_RANGE);
      expect(Math.hypot(post.use.x - map.spawn.x, post.use.y - map.spawn.y), id).toBeLessThan(160);
    }
  });
});

describe("city overview", () => {
  it("has a road for every pair of maps a portal links, both ways once", () => {
    expect(cityRoads().map(([a, b]) => `${a}-${b}`).sort()).toEqual(["bai_dat-mo_da", "hall-field", "hall-market", "hall-pond", "market-bai_dat", "market-khu_nha", "pond-field", "pond-song_cai", "bai_dat-rung_tram"].sort());
  });
  it("shows every map with its count, marks where I am, lists the key places, Khu nhà included (v19.2)", () => {
    const onClose = vi.fn();
    render(<CityMapModal current="market" counts={{ hall: 3, pond: 1, field: 0, market: 2, khu_nha: 4, bai_dat: 2, ham_ngam: 1, mo_da: 0, song_cai: 0, rung_tram: 0 }} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "🗺️ Bản đồ thế giới" });
    for (const id of MAP_IDS.filter((m) => !CITY_PLACES[m].hidden)) expect(within(dialog).getByTestId(`city-map-${id}`)).toHaveTextContent(CITY_PLACES[id].name);
    // v20.4: the hầm is a secret
    expect(within(dialog).queryByTestId("city-map-ham_ngam")).toBeNull();
    expect(dialog.textContent).not.toContain("Hầm");
    expect(screen.getByTestId("city-map-hall")).toHaveTextContent("👥 3");
    expect(screen.getByTestId("city-map-market")).toHaveTextContent("📍 Bạn đang ở đây");
    expect(screen.getByTestId("city-map-hall")).not.toHaveTextContent("Bạn đang ở đây");
    expect(screen.getByTestId("city-map-khu_nha")).toHaveTextContent("👥 4");
    expect(screen.queryByTestId("city-map-soon")).toBeNull();
    for (const place of ["Nhà hàng", "Xe cộ", "Tiệm quần áo", "Salon tóc", "Vựa cá Chợ Lớn", "Vựa nông sản", "Nội thất cô Năm", "Chung cư Phú Mỹ · chú Sáu"]) {
      expect(dialog.textContent).toContain(place);
    }
    expect(within(dialog).getByTestId("world-map")).toBeTruthy();
    expect(within(dialog).getByTestId("world-map-legend")).toHaveTextContent("Rừng tràm");
    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("GameShell's own interactables", () => {
  it("maps each panel kind to its panel", () => {
    expect(SHELL_PANEL_OF).toEqual({
      dj_booth: "queue", notice_board: "board", restaurant: "restaurant", vehicle_shop: "vehicle_shop",
      clothes_shop: "fashion_store", salon: "salon", city_map: "city_map", news_stand: "news", pet_shop: "pet_shop",
      motel: "motel",                                                                      // v19.1
      apartment: "apartment", furniture_shop: "furniture_shop",                            // v19.2
      lot: "lot",                                                                          // v19.3
      estate: "estate",                                                                    // v19.4
      punch_bag: "fight_practice",                                                         // v20.1
      dojo: "dojo",                                                                        // v20.2
      ring_corner: "ring", ring_board: "ring_board",                                       // v20.3
      ug_organizer: "underground", ug_board: "underground", ug_door: "underground", cage_watch: "ug_watch", // v20.4
      quest_giver: "quests",                                                              // v21
      player_stalls: "player_stalls",                                                     // v21 economy
    });
  });
  it("keeps a case for every one of them in onInteract, before the default", () => {
    const src = readFileSync(join(process.cwd(), "components/game/GameShell.tsx"), "utf8");
    const start = src.indexOf("const onInteract = useCallback(");
    const def = src.indexOf("default:", start);
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, def);
    for (const kind of SHELL_KINDS) expect(body, kind).toContain(`case "${kind}":`);
    for (const [kind, panel] of Object.entries(SHELL_PANEL_OF)) {
      const at = body.indexOf(`case "${kind}":`);
      expect(body.slice(at, body.indexOf("break;", at)), kind).toContain(`setPanel("${panel}")`);
    }
  });
});
