import type { Stall } from "@/lib/game/economy/model";
import { STALL_SLOTS } from "@/lib/game/economy/model";
import type { HouseDraw } from "@/lib/game/housing/lot";
import { RING_RECTS } from "@/lib/game/maps/bai-dat";
import type { MapId } from "@/lib/game/maps/types";
import { speciesOf, wildXY } from "@/lib/game/realm/model";
import type { BossFight, WildAnimal, WorldState } from "@/lib/game/realm/rpc";
import type { Vec } from "@/lib/game/types";
import { toWorld, type ZoneId } from "@/lib/game/world/zones";
import type { LiveAnimal, LiveBoss, LiveDig, LiveHouse, LiveRing, LiveStall, WorldLive } from "./live-plan";

// P4: the real game's state → the 3D world's live model (WorldView.setLive). Pure: the shell's hooks hand GameCanvas
// what the 2D game already has (zone-local, as the RPCs speak), and this turns it into world px. The static part
// (stalls, rings, houses, digs) is rebuilt on a state change only; the moving part (wild animals on their seeded paths,
// bosses' wind-ups) is a function of server time, evaluated when asked. Pets and fishing bobbers come with the engine's
// frame instead (DioramaFrame.gameplay: liveFromFrame).

/** A Khu nhà lot as the shell has it (house_list: `lot` 1-based like HouseDraw), with its owner's name. */
export interface LiveHouseIn extends HouseDraw { ownerName?: string | null; mine?: boolean }
/** A treasure dig in progress (zone-local, the zone it is in). */
export interface LiveDigIn { id: string; zone: MapId; x: number; y: number; state: LiveDig["state"] }
/** The realm's world_state and the zone it was asked for (wild animals are that zone's, zone-local). */
export interface LiveRealmIn { state: WorldState; zone: ZoneId; /** server − local clock, ms. */ offsetMs: number }   // 0096: "wild" = the forest's animals (world px)

/** Everything the shell feeds; each key is replaced as a whole (absent/null = none). */
export interface LiveInputs {
  houses?: ReadonlyArray<LiveHouseIn> | null;
  ringLabels?: ReadonlyArray<string | null> | null;
  stalls?: ReadonlyArray<Stall> | null;
  realm?: LiveRealmIn | null;
  digs?: ReadonlyArray<LiveDigIn> | null;
}

const W = (zone: ZoneId, p: Vec): Vec | null => toWorld(zone, p);

/** The rented player stalls' spots in Chợ Lớn (zone-local): along the north pavement, east of the lantern posts. */
export const PLAYER_STALL_SPOTS: readonly Vec[] = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 760 + i * 90, y: 226 }));

const AWNINGS = [0x2a7ab8, 0x3a9a5a, 0x9a4ab8, 0xd07a2a, 0x2a9a9a, 0xb83a5a];
const nameHash = (s: string): number => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** chú Bảy's rented stalls (econ_state's `stalls`, 1-based `no`): a rented one stands with its renter's name. */
export function stallsLive(stalls: ReadonlyArray<Stall>): LiveStall[] {
  const out: LiveStall[] = [];
  for (const s of stalls) {
    const spot = PLAYER_STALL_SPOTS[s.no - 1];
    if (!spot || !s.renterName) continue;
    const w = W("market", spot)!;
    out.push({ id: `pstall:${s.no}`, ...w, owner: "player", name: s.renterName, color: AWNINGS[nameHash(s.renterName) % AWNINGS.length], goods: Math.min(1, s.items.length / STALL_SLOTS) });
  }
  return out;
}

/** Bãi đất's rings with a label (someone in a corner, a match on: "⚔️ Hiệp …"), at the ring's centre. */
export function ringsLive(labels: ReadonlyArray<string | null>): LiveRing[] {
  const out: LiveRing[] = [];
  RING_RECTS.forEach((r, i) => {
    const label = labels[i];
    if (!label) return;
    const c = W("bai_dat", { x: r.x + r.w / 2, y: r.y + r.h / 2 })!;
    out.push({ id: `ring${i + 1}`, ...c, r: Math.min(r.w, r.h) / 2 - 6, label, active: label.startsWith("⚔") });
  });
  return out;
}

/** Khu nhà's lots (1-based → LOTS index); the view places them itself. */
export function housesLive(houses: ReadonlyArray<LiveHouseIn>): LiveHouse[] {
  return houses.filter((h) => h.lot >= 1).map((h) => ({
    lot: h.lot - 1, owned: h.owned, built: h.grid !== null, roof: h.roof, ownerName: h.ownerName ?? null, mine: !!h.mine,
  }));
}

export function digsLive(digs: ReadonlyArray<LiveDigIn>): LiveDig[] {
  return digs.flatMap((d) => {
    const w = W(d.zone, d);
    return w ? [{ id: d.id, ...w, state: d.state }] : [];
  });
}

/** Where a wild animal is at server time `nowMs` (zone-local; realm/useWorld's animalAt). */
export function animalAt(a: WildAnimal, nowMs: number): Vec {
  return wildXY(a.hx, a.hy, a.seed, speciesOf(a.species)?.radius ?? 40, (nowMs - a.bornMs) / 1000);
}

/** The zone's wild animals at `nowMs` in world px; one moving fast (a bolt) is fleeing. */
export function animalsLive(animals: ReadonlyArray<WildAnimal>, zone: ZoneId, nowMs: number): LiveAnimal[] {
  const out: LiveAnimal[] = [];
  for (const a of animals) {
    if (nowMs >= a.expiresMs) continue;
    const r = animalAt(a, nowMs), q = animalAt(a, nowMs - 250), p = W(zone, r);
    if (!p) continue;
    out.push({ id: `wild:${a.id}`, species: a.species, x: p.x, y: p.y, fleeing: Math.hypot(r.x - q.x, r.y - q.y) / 0.25 > 90 });
  }
  return out;
}

const WIND_MS = 3000;

/** The bosses that are up now: at their spot in the arena (useWorld's bossSpot), hp 0…1, the arena, and from phase 2 a
 *  stomp's wind-up around them (the server has no telegraph geometry: a cosmetic 3 s cycle). */
export function bossesLive(fights: ReadonlyArray<BossFight>, nowMs: number): LiveBoss[] {
  const out: LiveBoss[] = [];
  for (const f of fights) {
    if (f.status !== "up" || nowMs < f.startsMs || nowMs >= f.endsMs) continue;
    const spot = W(f.map, { x: f.arena.x + f.arena.w / 2, y: f.arena.y + f.arena.h / 2 + 24 });
    const a = W(f.map, f.arena);
    if (!spot || !a) continue;
    const k = ((nowMs - f.startsMs) % WIND_MS) / WIND_MS;
    out.push({
      id: `boss:${f.id}`, kind: f.boss, name: f.name, ...spot, hp: f.maxHp > 0 ? Math.max(0, Math.min(1, f.hp / f.maxHp)) : 0,
      arena: { ...a, w: f.arena.w, h: f.arena.h },
      telegraphs: f.phase >= 2 ? [{ shape: "circle", x: spot.x, y: spot.y + 30, r: 70, k }] : [],
    });
  }
  return out;
}

/** All of it at server time `nowMs`. */
export function worldLive(inp: LiveInputs, nowMs: number): WorldLive {
  return { ...stillLive(inp), ...movingLive(inp, nowMs) };
}

function stillLive(inp: LiveInputs): WorldLive {
  return {
    stalls: stallsLive(inp.stalls ?? []), rings: ringsLive(inp.ringLabels ?? []),
    houses: housesLive(inp.houses ?? []), digs: digsLive(inp.digs ?? []),
  };
}

function movingLive(inp: LiveInputs, nowMs: number): Pick<WorldLive, "animals" | "bosses"> {
  const r = inp.realm;
  if (!r) return { animals: [], bosses: [] };
  return { animals: animalsLive(r.state.wild?.animals ?? [], r.zone, nowMs), bosses: bossesLive(r.state.fights, nowMs) };
}

/** The feed GameCanvas keeps across worlds: patches in, a WorldLive out (the still part cached until the next patch). */
export class LiveFeed {
  private inp: LiveInputs = {};
  private still: WorldLive | null = null;

  set(patch: LiveInputs): void {
    this.inp = { ...this.inp, ...patch };
    this.still = null;
  }

  inputs(): LiveInputs {
    return this.inp;
  }

  /** Something moves by itself (animals walking, a boss winding up): the view wants it each frame. */
  moving(): boolean {
    const s = this.inp.realm?.state;
    return !!s && ((s.wild?.animals.length ?? 0) > 0 || s.fights.some((f) => f.status === "up"));
  }

  /** The live model at local wall time `localNowMs` (the realm's clock offset applied). */
  at(localNowMs: number): WorldLive {
    this.still ??= stillLive(this.inp);
    return { ...this.still, ...movingLive(this.inp, localNowMs + (this.inp.realm?.offsetMs ?? 0)) };
  }
}
