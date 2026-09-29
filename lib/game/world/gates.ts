import { BOAT } from "@/lib/game/fishing/extras";
import type { MapId, Npc, Rect } from "@/lib/game/maps/types";
import type { Vec } from "@/lib/game/types";
import { MINE } from "./mine";
import { ZONES } from "./zones";

// P3 level gates (spec §1: "Level gates (song_cai lv3…) = bamboo barrier + guard at the zone border"): where a road
// reaches a map the account's level has not opened, a bamboo barrier and a guard stand in the way. The server refuses
// the claim as before (0078's map_locked); this is what the world shows and says ("Cần cấp N"). World px. Pure data;
// compose.ts stamps a locked gate's barrier into the collision grid and puts its guard among the NPCs, the engine says
// the toast when I walk up to it, lib/game/diorama/gameplay3d.ts draws the barrier.

export interface WorldGate {
  id: string;
  /** The map it keeps shut (its level: 0070's map_levels, lib/game/progression/model.ts mapMinLevel). */
  map: MapId;
  /** Where one walks up to it (the toast within GATE_NEAR px). */
  at: Vec;
  /** The bamboo barrier (blocked while shut); null: a barrier drawn beside the way, not across it. */
  barrier: Rect | null;
  /** Its guard (an NPC while the gate is shut). */
  guard: Npc;
}

/** How near (px) the gate says "Cần cấp N". */
export const GATE_NEAR = 44;

const GUARD_LOOK: Npc["look"] = {
  skin: "tan", hair: "short", hairColor: "black",
  hat: "hat_nonla", top: "top_baba_yellow", bottom: "bottom_pants_black", shoes: "shoes_dep_brown", neck: "neck_khanran", gender: "nam",
};

const pier = { x: ZONES.pond.ox + BOAT.pier.x, y: ZONES.pond.oy + BOAT.pier.y };

export const WORLD_GATES: readonly WorldGate[] = [
  // Sông Cái (lv3): the boat leaves from Cầu ao's pier — the barrier stands beside the pier (the pier's fishing stays)
  {
    id: "gate_song_cai", map: "song_cai", at: pier, barrier: null,
    guard: { id: "guard_song_cai", name: "Lính gác bến", look: GUARD_LOOK, spot: { x: pier.x - 22, y: pier.y + 6, dir: "right" } },
  },
  // Mỏ đá (lv5): across the apron before the mine mouth (the door itself is out of reach behind it)
  {
    id: "gate_mo_da", map: "mo_da", at: { x: MINE.use.x - 24, y: MINE.use.y }, barrier: { x: MINE.use.x - 16, y: MINE.use.y - 40, w: 16, h: 80 },
    guard: { id: "guard_mo_da", name: "Lính gác mỏ", look: GUARD_LOOK, spot: { x: MINE.use.x - 34, y: MINE.use.y - 34, dir: "down" } },
  },
];

/** The shut gate within GATE_NEAR px of p, or null. */
export function gateNear(gates: readonly WorldGate[], p: Vec, r = GATE_NEAR): WorldGate | null {
  let best: WorldGate | null = null, bestD = r;
  for (const g of gates) {
    const d = Math.hypot(g.at.x - p.x, g.at.y - p.y);
    if (d <= bestD) { best = g; bestD = d; }
  }
  return best;
}

/** The toast of a shut gate. */
export const gateText = (level: number): string => `🚧 Cần cấp ${level} mới qua được — lính gác không cho đi.`;
