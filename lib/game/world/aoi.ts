import type { GameMessage } from "@/lib/game/net/protocol";
import type { Vec } from "@/lib/game/types";
import { LINKS, ROADS } from "./wild";
import { WORLD_H, WORLD_W, ZONE_IDS, ZONES, zoneRect, type ZoneId } from "./zones";

// P2's realtime area of interest (spec §4, the cut-down "zone channels instead of grid cells"): a world-mode client
// listens on its zone's topic (game:{room}:{zone}, the same topic the per-map clients use) and on its neighbours', and
// broadcasts to its own zone only. The wire stays ZONE-LOCAL (the per-map clients on that zone read it unchanged): a
// world client converts on the way out (toZoneMsg) and in (fromZoneMsg, by the topic's zone). Pure.

/** How far (px) around me the wild listens to the zones (the wild has no neighbours of its own). */
export const WILD_REACH = 480;

/** Zones joined by a road or the boat (the old portal pairs). */
function joined(): Map<ZoneId, Set<ZoneId>> {
  const m = new Map<ZoneId, Set<ZoneId>>();
  const link = (a: ZoneId, b: ZoneId) => {
    if (a === b) return;
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  };
  for (const r of ROADS) link(r.a.split(":")[0] as ZoneId, r.b.split(":")[0] as ZoneId);
  for (const l of LINKS) link(l.from.zone, l.to.zone);
  return m;
}
const JOINED = joined();

/** The zones a world client listens to at `pos` in `zone`: its own, the ones a road joins to it and the wild (from the
 *  wild: every zone within WILD_REACH of me). Sorted, own zone first. */
export function aoiZones(zone: ZoneId, pos: Vec): ZoneId[] {
  const out = new Set<ZoneId>([zone]);
  if (zone === "wild") {
    for (const id of ZONE_IDS) {
      const z = ZONES[id];
      const dx = Math.max(z.ox - pos.x, 0, pos.x - (z.ox + z.w)), dy = Math.max(z.oy - pos.y, 0, pos.y - (z.oy + z.h));
      if (Math.hypot(dx, dy) <= WILD_REACH) out.add(id);
    }
  } else {
    for (const n of JOINED.get(zone) ?? []) if (n === "wild" || (ZONE_IDS as readonly string[]).includes(n)) out.add(n);
    out.add("wild");
  }
  return [zone, ...[...out].filter((z) => z !== zone).sort()];
}

/** A topic's bounds (what parseGameMessage accepts): the zone's size; the wild's is the world. */
export function zoneBounds(zone: ZoneId): { width: number; height: number } {
  const r = zoneRect(zone);
  return r ? { width: r.w, height: r.h } : { width: WORLD_W, height: WORLD_H };
}

const clampTo = (v: number, hi: number) => Math.max(0, Math.min(hi, Math.round(v)));

/**
 * A world-px message as zone `zone`'s topic carries it (zone-local). Positions are clamped into the zone; a path that
 * leaves the zone is cut where it does (one more point, clamped on the edge): the per-map clients drop a message with a
 * point outside their map, and the rest of the walk is announced on the next zone's topic when I get there.
 */
export function toZoneMsg(msg: GameMessage, zone: ZoneId): GameMessage {
  if (msg.t !== "st" && msg.t !== "mv" && msg.t !== "pa") return msg;
  const r = zoneRect(zone);
  if (!r) return msg;
  const w = r.w, h = r.h;
  if (msg.t !== "pa") return { ...msg, x: clampTo(msg.x - r.ox, w), y: clampTo(msg.y - r.oy, h) };
  const pts: Array<[number, number]> = [];
  for (const [px, py] of msg.pts) {
    const lx = px - r.ox, ly = py - r.oy;
    if (lx < 0 || ly < 0 || lx > w || ly > h) { pts.push([clampTo(lx, w), clampTo(ly, h)]); break; }
    pts.push([Math.round(lx), Math.round(ly)]);
  }
  return { ...msg, x: clampTo(msg.x - r.ox, w), y: clampTo(msg.y - r.oy, h), pts };
}

/** A message from zone `zone`'s topic (zone-local) in world px. */
export function fromZoneMsg(msg: GameMessage, zone: ZoneId): GameMessage {
  if (msg.t !== "st" && msg.t !== "mv" && msg.t !== "pa") return msg;
  const r = zoneRect(zone);
  if (!r || (r.ox === 0 && r.oy === 0 && zone === "wild")) return msg;
  if (msg.t !== "pa") return { ...msg, x: msg.x + r.ox, y: msg.y + r.oy };
  return { ...msg, x: msg.x + r.ox, y: msg.y + r.oy, pts: msg.pts.map(([x, y]) => [x + r.ox, y + r.oy] as [number, number]) };
}
