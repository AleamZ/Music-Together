// The story chain's characters (0114_story_quests.sql `story_npcs`). The givers stand where the map's interactable is
// used (its `use` point); tests/unit/story-scripts.test.ts checks these numbers against the maps and the migration.
import type { InteractKind, MapId } from "@/lib/game/maps/types";

export type StoryNpcId = "bac_ba_lang" | "co_ba" | "chu_tu" | "anh_hai" | "chu_hai_ca";
/** Who can speak in a dialogue: a giver, chị Hoa (the guide who walks with the newcomer) or the player. */
export type SpeakerId = StoryNpcId | "hoa" | "me";

export interface StoryNpc {
  id: StoryNpcId;
  name: string;
  map: MapId;
  x: number;
  y: number;
  reach: number;
  /** The interactable that talks to them. */
  kind: InteractKind;
  /** Where they are, for the tracker ("Vựa cá · Ao cá"). */
  place: string;
}

export const STORY_NPCS: Readonly<Record<StoryNpcId, StoryNpc>> = {
  bac_ba_lang: { id: "bac_ba_lang", name: "bác Ba Làng", map: "hall", x: 368, y: 222, reach: 72, kind: "quest_giver", place: "Sảnh chính" },
  co_ba: { id: "co_ba", name: "cô Ba", map: "pond", x: 570, y: 140, reach: 72, kind: "depot", place: "Vựa cá · Ao cá" },
  chu_tu: { id: "chu_tu", name: "chú Tư", map: "pond", x: 576, y: 308, reach: 72, kind: "shop", place: "Tiệm đồ câu · Ao cá" },
  anh_hai: { id: "anh_hai", name: "anh Hai", map: "field", x: 630, y: 344, reach: 72, kind: "farm_shop", place: "Tiệm vật tư · Đồng ruộng" },
  chu_hai_ca: { id: "chu_hai_ca", name: "chú Hai", map: "market", x: 80, y: 360, reach: 72, kind: "market_fish_depot", place: "Vựa cá Chợ Lớn" },
};

export const SPEAKERS: Readonly<Record<SpeakerId, { name: string; portrait: string }>> = {
  bac_ba_lang: { name: "Bác Ba Làng", portrait: "👴" },
  co_ba: { name: "Cô Ba", portrait: "👩‍🌾" },
  chu_tu: { name: "Chú Tư", portrait: "🎣" },
  anh_hai: { name: "Anh Hai", portrait: "🧑‍🌾" },
  chu_hai_ca: { name: "Chú Hai", portrait: "🐟" },
  hoa: { name: "Chị Hoa", portrait: "🌸" },
  me: { name: "Bạn", portrait: "🙂" },
};

/** The giver an interactable kind talks to (null: none of the story's). */
export function npcOfKind(kind: InteractKind): StoryNpcId | null {
  for (const n of Object.values(STORY_NPCS)) if (n.kind === kind) return n.id;
  return null;
}

export const MAP_NAMES: Readonly<Partial<Record<MapId, string>>> = {
  hall: "Sảnh chính", pond: "Ao cá", field: "Đồng ruộng", market: "Chợ Lớn",
};

/** How to walk from one map to another (the portals of lib/game/maps/*). */
export function routeHint(from: MapId, to: MapId): string {
  if (from === to) return "";
  const hop: Partial<Record<MapId, Partial<Record<MapId, string>>>> = {
    hall: { pond: "Đi xuống biển \"Bến câu cá\" ở phía nam Sảnh", field: "Đi theo biển \"Ra đồng\" ở mép tây Sảnh", market: "Đi theo biển \"Chợ Lớn\" ở phía đông Sảnh" },
    pond: { hall: "Ra \"Bến vào\" ở bờ nam ao để về Sảnh", field: "Qua \"Cầu khỉ\" ở góc tây nam ao", market: "Về Sảnh trước, rồi đi sang Chợ Lớn" },
    field: { hall: "Đi biển \"Về sảnh\" ở góc tây bắc đồng", pond: "Qua cầu khỉ ở mép đông đồng", market: "Về Sảnh trước, rồi đi sang Chợ Lớn" },
    market: { hall: "Đi biển \"Về sảnh\" ở mép tây chợ", pond: "Về Sảnh trước, rồi xuống Bến câu cá", field: "Về Sảnh trước, rồi ra đồng" },
  };
  return hop[from]?.[to] ?? `Mở bản đồ (M) và đi tới ${MAP_NAMES[to] ?? to}`;
}
