import type { GameMessage } from "@/lib/game/net/protocol";
import { fromZoneMsg, toZoneMsg, zoneBounds } from "@/lib/game/world/aoi";
import type { ZoneId } from "@/lib/game/world/zones";
import { joinGameChannel, type GameChannelHandle } from "./channel";

// P2 world mode's realtime (spec §4, cut down to zone channels): one game channel per zone in my area of interest
// (lib/game/world/aoi.ts aoiZones). Messages in are turned into world px by their topic's zone; messages out go to my own
// zone's topic, zone-local. Browser only.

export interface ZoneChannelHandlers {
  /** A message from any listened zone, in world px, and the zone whose topic carried it. */
  onMessage: (msg: GameMessage, zone: ZoneId) => void;
  /** A zone's channel (re)subscribed (true) or dropped (false). */
  onStatus: (zone: ZoneId, connected: boolean) => void;
}

export class ZoneChannels {
  private readonly roomId: string;
  private readonly h: ZoneChannelHandlers;
  private readonly open = new Map<ZoneId, GameChannelHandle>();
  private own: ZoneId | null = null;

  private readonly joinFn: typeof joinGameChannel;

  /** `join`: the channel factory (a local fake on the dev page; realtime otherwise). */
  constructor(roomId: string, handlers: ZoneChannelHandlers, join: typeof joinGameChannel = joinGameChannel) {
    this.roomId = roomId;
    this.h = handlers;
    this.joinFn = join;
  }

  /** Listen to exactly these zones (the first is mine: I broadcast there). New ones are joined, dropped ones left. */
  setZones(zones: readonly ZoneId[]): void {
    this.own = zones[0] ?? null;
    for (const [z, ch] of this.open) if (!zones.includes(z)) { ch.leave(); this.open.delete(z); }
    for (const z of zones) if (!this.open.has(z)) this.join(z);
  }

  zones(): ZoneId[] {
    return [...this.open.keys()];
  }

  private join(zone: ZoneId): void {
    const ch = this.joinFn(this.roomId, { id: zone, ...zoneBounds(zone) }, {
      onMessage: (msg) => this.h.onMessage(fromZoneMsg(msg, zone), zone),
      onStatus: (connected) => this.h.onStatus(zone, connected),
    });
    this.open.set(zone, ch);
  }

  /** Broadcast a world-px message on my zone's topic (zone-local), or on `zone`'s (a `hello` to a neighbour). */
  send(msg: GameMessage, zone: ZoneId | null = this.own): void {
    if (!zone) return;
    this.open.get(zone)?.send(toZoneMsg(msg, zone));
  }

  /** Leave every topic; `last` (a `bye`) goes to my own zone first. */
  leave(last?: GameMessage): void {
    for (const [z, ch] of this.open) ch.leave(z === this.own ? last : undefined);
    this.open.clear();
  }
}
