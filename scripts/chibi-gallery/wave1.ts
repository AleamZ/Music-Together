import { ACT_TOOL, heldFor, WAVE1_LABEL } from "@/lib/game/diorama/character/held";
import type { CharAct } from "@/lib/game/diorama/character/pose";
import { FISH_SPECIES_3D, fishParams } from "@/lib/game/diorama/world/fish3d";
import type { Look } from "@/lib/game/types";
import type { Sheet, Tile } from "./sheets";

// 3D wave 1's review sheets (docs/superpowers/specs/3d-wave1/): every farm animation with its tool, the other tool
// actions, the vital poses, the rod looks per loadout, and every fish species' 3D model.

const NAM: Look = { skin: "warm", hair: "short", hairColor: "black", hat: "hat_nonla", top: "top_tee_white", bottom: "bottom_pants_navy", shoes: "shoes_sneaker_white", neck: null, gender: "nam" };
const NU: Look = { skin: "light", hair: "long", hairColor: "brown", hat: null, top: "top_tee_white", bottom: "bottom_skirt_pleated", shoes: "shoes_sandal_brown", neck: null, gender: "nu" };
const TQ = -0.75;

function actTile(act: CharAct, i: number, label: string, time = 0.55, extra: Partial<Tile> = {}): Tile {
  const h = heldFor(act, { fish: act === "show_catch" ? "ca_loc" : null });
  const tools = [h.R, h.L].filter(Boolean).join(" + ");
  return { look: i % 2 ? NU : NAM, act, time, yaw: TQ, label: `${label} (${act})${tools ? ` — ${tools}` : ""}`, held: h, zoom: 0.9, focusY: 0.85, ...extra };
}

const FARM: CharAct[] = ["transplant", "harvest", "pump", "spray", "fertilize", "crab", "snails", "prepare", "dig", "pick", "pet", "aim"];

export function wave1Sheets(): Sheet[] {
  const farm = FARM.map((a, i) => actTile(a, i, WAVE1_LABEL[a]));
  const tools = (["chop", "cook", "mine", "photo", "eat", "drink"] as CharAct[]).map((a, i) =>
    actTile(a, i, WAVE1_LABEL[a] ?? (a === "chop" ? "Chặt cây" : "Nấu ăn"), a === "chop" || a === "mine" ? 0.45 : 0.55));
  tools.push({ ...actTile("idle", 1, "Che dù"), held: heldFor("idle", { umbrella: true }), label: "Che dù (umbrella up) — umbrella" });
  tools.push({ ...actTile("walk", 0, "Cầm cá"), held: heldFor("walk", { fish: "ca_chep" }), label: "Cầm cá (fish in hand) — fish:ca_chep" });
  tools.push(actTile("show_catch", 1, WAVE1_LABEL.show_catch, 0.3));
  const vital = (["faint", "sleep", "hammock", "exhausted", "eat", "drink"] as CharAct[]).map((a, i) => actTile(a, i, WAVE1_LABEL[a], a === "drink" ? 0.15 : 0.9,
    a === "faint" || a === "sleep" || a === "hammock" ? { yaw: -Math.PI / 2 + 0.35, zoom: 0.8, focusY: 0.5 } : {}));
  const rods: Tile[] = [
    { rod: "rod_wood", reel: null, bobber: null }, { rod: "rod_bamboo", reel: null, bobber: "bobber_feather" },
    { rod: "rod_fiber", reel: "reel_1000", bobber: "bobber_foam" }, { rod: "rod_carbon", reel: "reel_3000", bobber: "bobber_lamp" },
    { rod: "rod_master", reel: "reel_5000", bobber: "bobber_foam" },
  ].map((r, i) => ({ look: i % 2 ? NU : NAM, act: "cast", time: 2, yaw: -1.2, zoom: 0.62, focusY: 1.3, rodLook: r,
    label: `${r.rod} · ${r.reel ?? "no reel"} · ${r.bobber ?? "no bobber"}` }));
  const fish: Tile[] = FISH_SPECIES_3D.map((id) => {
    const f = fishParams(id);
    return { look: NAM, yaw: 0, fish: id, label: `${id} (${f.kind}, ${f.pattern}, ${f.tail})` };
  });
  void ACT_TOOL;
  return [
    { name: "w1-farm-actions", title: "3D wave 1 — the 12 farm animations (FARM_ANIM) with their tools", cols: 4, tw: 300, th: 320, tiles: farm },
    { name: "w1-tool-actions", title: "3D wave 1 — axe, pan, pickaxe, camera, bowl/cup, umbrella, fish in hand, show catch", cols: 3, tw: 300, th: 320, tiles: tools },
    { name: "w1-vital-poses", title: "3D wave 1 — vital states: faint, sleep, hammock, exhausted, eat, drink", cols: 3, tw: 300, th: 320, tiles: vital },
    { name: "w1-rod-looks", title: "3D wave 1 — rod looks per loadout (rod colour, reel, bobber)", cols: 5, tw: 300, th: 340, tiles: rods },
    { name: "w1-prawn-closeup", title: "3D wave 1 — tôm càng xanh (tom_cang), close-up", cols: 2, tw: 480, th: 340,
      tiles: [{ look: NAM, yaw: 0, fish: "tom_cang", zoom: 1.1, label: "tom_cang — side on" }, { look: NAM, yaw: 0, fish: "tom_cang", zoom: 0.7, label: "tom_cang — as in the grid" }] },
    { name: "w1-fish-species", title: "3D wave 1 — every fish species (from the 2D icons)", cols: 5, tw: 240, th: 170, tiles: fish },
  ];
}
