import { LOTS } from "@/lib/game/maps/khu-nha";
import { RIVER } from "@/lib/game/river/geometry";
import { WILD_AREAS, wildXY, type WildSpeciesId } from "@/lib/game/realm/model";
import { ZONES, type OutdoorMapId } from "@/lib/game/world/zones";
import type { Billboard } from "../types";
import type { WorldLive } from "./live-plan";

// Dev only (/dev/world): a made-up WorldLive so the live layer can be seen without a server — player stalls in the
// market, two rings on Bãi đất (one fight on), Trâu Tinh in its arena winding up a stomp and a charge, wild animals on
// their areas (a fox bolting), Khu nhà's lots in every state, a ghe rowing down Sông Cái, dig spots, a bobber with a
// fish on, pets at heel, a dog, rats in the field, a gate with its guard. `t` in ms.

const Z = (id: OutdoorMapId, x: number, y: number) => ({ x: ZONES[id].ox + x, y: ZONES[id].oy + y });

const ROOFS = ["ngoi", "tole", "la", "bang"] as const;

export function demoLive(t: number, riders: { moto?: string; bike?: string; car?: string } = {}): WorldLive {
  const s = t / 1000;
  const animals: NonNullable<WorldLive["animals"]> = [];
  const kinds: WildSpeciesId[] = ["rabbit", "deer", "fox", "wolf", "bird", "bear", "rabbit", "firefly"];
  WILD_AREAS.forEach((a, i) => {
    const zone = a.map as OutdoorMapId;
    for (let k = 0; k < 2; k++) {
      const seed = i * 97 + k * 31, sp = kinds[(i * 2 + k) % kinds.length];
      const fleeing = sp === "fox" && Math.floor(s / 6) % 2 === 1;
      const p = wildXY(a.x + a.w / 2, a.y + a.h / 2, seed, Math.min(80, Math.max(a.w, a.h) / 2), s * (fleeing ? 4 : 1));
      animals.push({ id: `${zone}:${i}:${k}`, species: sp, fleeing, ...Z(zone, p.x, p.y) });
    }
  });
  // a herd on the open meadow between the market and Bãi đất (the wild areas above sit among the zones' props)
  const herd: Array<[WildSpeciesId, number, number]> = [["deer", 2420, 950], ["deer", 2480, 970], ["rabbit", 2380, 985], ["rabbit", 2440, 1000], ["fox", 2530, 945], ["bear", 2580, 990], ["bird", 2350, 960]];
  herd.forEach(([sp, hx, hy], i) => {
    const fleeing = sp === "fox" || (sp === "rabbit" && Math.floor(s / 5) % 2 === 1);
    const p = wildXY(hx, hy, 400 + i * 53, sp === "bear" ? 30 : 50, s * (fleeing ? 3 : 1));
    animals.push({ id: `herd:${i}`, species: sp, fleeing, ...p });
  });
  const arena = { ...Z("bai_dat", 316, 60), w: 168, h: 316 };
  const bx = arena.x + arena.w / 2 + Math.sin(s / 3) * 30, by = arena.y + arena.h / 2 + Math.cos(s / 4) * 60;
  const wind = (s % 3) / 3;
  const river = Z("song_cai", 0, 0);
  const lane = (RIVER.y0 + RIVER.y1) / 2 - 60;
  const boatX = river.x + RIVER.x0 + ((s * 40) % (RIVER.x1 - RIVER.x0 - 80)) + 40;
  const live: WorldLive = {
    stalls: [
      { id: "p1", ...Z("market", 860, 226), owner: "player", name: "Sạp Bé Na", color: 0x2a7ab8, goods: 0.9 },
      { id: "p2", ...Z("market", 960, 226), owner: "player", name: "Tiệm Anh Tú", color: 0x3a9a5a, goods: 0.5 },
      { id: "p3", ...Z("market", 1060, 226), owner: "player", name: "Hàng Cô Lan", color: 0x9a4ab8, goods: 0.2 },
      { id: "n1", ...Z("market", 1160, 226), owner: "npc", color: 0xc0392b, goods: 1 },
    ],
    rings: [
      { id: "r1", ...Z("bai_dat", 160, 300), r: 44, label: "Võ đài 1 · Tú vs Lan", active: true },
      { id: "r2", ...Z("bai_dat", 620, 130), r: 40, label: "Võ đài 2", active: false },
    ],
    bosses: [{
      id: "trau", kind: "trau_tinh", name: "Trâu Tinh", hp: 0.62, ...{ x: bx, y: by }, arena,
      telegraphs: [
        { shape: "circle", x: bx, y: by + 40, r: 70, k: wind },
        { shape: "line", x: bx, y: by, r: 18, len: 150, dir: -Math.PI / 2 + Math.sin(s / 2) * 0.6, k: ((s + 1.5) % 3) / 3 },
      ],
    }],
    animals,
    houses: LOTS.map((_, i) => ({
      lot: i, owned: i !== 3 && i !== 6, built: i % 4 !== 1 && i !== 3 && i !== 6, roof: ROOFS[i % 4],
      ownerName: i === 3 || i === 6 ? null : ["Bé Na", "Anh Tú", "Cô Lan", "", "Chú Tư", "Bạn", "", "Bà Sáu"][i], mine: i === 5,
    })),
    boats: [{ id: "ghe1", x: boatX, y: river.y + lane, riderId: "ghe" }],
    digs: [
      { id: "d1", ...Z("bai_dat", 520, 330), state: "hint" }, { id: "d2", ...Z("bai_dat", 560, 350), state: "dug" },
      { id: "d3", ...Z("field", 700, 420), state: "hint" },
    ],
    fishing: [{ id: "f1", ...Z("song_cai", 120, 250), tension: 0.5 + 0.5 * Math.sin(s * 2), hooked: Math.floor(s / 4) % 2 === 0 }],
    pets: [
      { id: "pet_me", ownerId: "me", species: "cho", x: NaN, y: NaN },
      { id: "pet_me2", ownerId: "me", species: "meo", x: NaN, y: NaN },
      { id: "pet_ba", ownerId: "ba", species: "vet", x: NaN, y: NaN },
    ],
    vehicles: [
      ...(riders.moto ? [{ riderId: riders.moto, kind: "moto" as const, color: 0xc0392b }] : []),
      ...(riders.bike ? [{ riderId: riders.bike, kind: "bike" as const, color: 0x2a7ab8 }] : []),
      ...(riders.car ? [{ riderId: riders.car, kind: "car" as const, color: 0xf2c240 }] : []),
    ],
    gates: [{ id: "g_demo", ...Z("bai_dat", 60, 120), dir: 0, w: 40, open: Math.floor(s / 5) % 2 === 1, guard: true }],
    dogs: [{ id: "vang", ...Z("khu_nha", 400 + Math.sin(s / 2) * 60, 300 + Math.cos(s / 2) * 30), coat: "vang" }],
    rats: [0, 1, 2].map((i) => ({ id: `rat${i}`, ...Z("field", 300 + i * 90 + Math.sin(s * 1.5 + i) * 30, 250 + Math.cos(s + i) * 20), fallen: i === 2 && Math.floor(s / 3) % 2 === 1 })),
  };
  return live;
}

/** The ghe's rower (a billboard at the boat). */
export function demoRower(live: WorldLive, look: Billboard["look"]): Billboard | null {
  const b = live.boats?.[0];
  return b ? { id: "ghe", look, x: b.x, y: b.y, facing: "right", frame: 0, name: "Chú lái ghe" } : null;
}
