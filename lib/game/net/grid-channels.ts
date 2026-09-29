import type { GameMessage } from "@/lib/game/net/protocol";
import { fromZoneMsg, nearestZone, toZoneMsg, zoneBounds } from "@/lib/game/world/aoi";
import {
  cellNeighbourhood, cellStep, cellTopicId, cellZones, CROWD_LIMIT, DEGRADED_RATE, plausibleInCell, type CellIndex,
} from "@/lib/game/world/grid";
import { isZone, WORLD_H, WORLD_W, type OutdoorMapId, type ZoneId } from "@/lib/game/world/zones";
import type { Vec } from "@/lib/game/types";
import { joinGameChannel, type GameChannelHandle } from "./channel";

// P4 world mode's realtime (spec §4): area-of-interest grid channels (lib/game/world/grid.ts) for 3D ↔ 3D, plus the zone
// topics for the 2D per-map clients — a permanent first-class mode in the same rooms, not a legacy one:
//   - cells: I broadcast on my own cell's topic (world px) and listen on it and its neighbours (≤ 9). A cell switch joins
//     the new cells first and leaves the old ones once the new ones are subscribed (or after a timeout); joinGameChannel
//     waits for a topic that is still leaving (whenTopicFree).
//   - zones: I listen on every zone topic my listened cells overlap (the 2D players there, zone-local → world px), and
//     publish on my "send zone" (the zone I am in; from the wild the nearest — the 2D clients see me at its edge):
//     movement as a zone-local copy flagged `fb: 1` at ZONE_COPY_RATE a second, everything else as it is.
//   - dedupe: a zone topic's `fb` copies are dropped (their 3D senders are heard on the cells), and so is anything from a
//     sender heard on a cell lately; a non-move message identical to one just taken in (it went out on a cell AND a
//     zone) is taken once.
// Browser only: `join` is the channel factory (an in-memory fake in tests and on /dev/world-game).

/** Who a channel's status is about: a cell (its index) or a zone topic (its id). */
export type GridKey = CellIndex | OutdoorMapId;

export interface GridChannelHandlers {
  /** A message in world px (from a cell, or a 2D client on a zone topic). */
  onMessage: (msg: GameMessage, from: GridKey) => void;
  onStatus: (key: GridKey, connected: boolean) => void;
}

export interface GridChannelOptions {
  /** Join the zone topics for the 2D clients (default true). */
  zones?: boolean;
  /** Leave the old cells after this long even if a new one never subscribed (ms). */
  switchTimeoutMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

/** What a step changed: `cell` my own cell; `added` / `addedZones` the topics joined by it (say hello there). */
export interface GridStep { cell: CellIndex; cellChanged: boolean; added: CellIndex[]; addedZones: OutdoorMapId[]; sendZoneChanged: boolean }

/** My movement's zone-local copy for the 2D clients goes out at most this often a second (the cell gets the gate's 3). */
export const ZONE_COPY_RATE = 2;
/** A sender heard on a cell this recently (ms) is a 3D client: its zone-topic messages are copies. */
const CELL_SENDER_MS = 5000;
/** An identical non-move message within this long (ms) is the same one on another topic. */
const DEDUPE_MS = 2000;

const isMove = (m: GameMessage): m is Extract<GameMessage, { t: "st" | "mv" | "pa" }> =>
  m.t === "st" || m.t === "mv" || m.t === "pa";

interface Open { ch: GameChannelHandle; connected: boolean }

/** A throttle for one kind of send: at most `rate` a second, the latest held one wins. */
class Throttle {
  private last = -Infinity;
  private held: GameMessage | null = null;
  private timer: unknown = null;
  constructor(private readonly o: Required<GridChannelOptions>, private readonly out: (m: GameMessage) => void) {}
  push(msg: GameMessage, rate: number): void {
    const wait = this.last + 1000 / rate - this.o.now();
    if (wait <= 0 && this.timer === null) { this.fire(msg); return; }
    this.held = msg;
    if (this.timer === null) {
      this.timer = this.o.setTimer(() => {
        this.timer = null;
        const m = this.held;
        this.held = null;
        if (m) this.fire(m);
      }, Math.max(0, wait));
    }
  }
  /** Sent now, unthrottled (it still counts). */
  fire(msg: GameMessage): void {
    this.last = this.o.now();
    this.out(msg);
  }
  cancel(): void {
    if (this.timer !== null) this.o.clearTimer(this.timer);
    this.timer = null;
    this.held = null;
  }
}

export class GridChannels {
  private readonly open = new Map<CellIndex, Open>();
  /** Cells to leave once every cell in `pending` has subscribed. */
  private retiring = new Set<CellIndex>();
  private pending = new Set<CellIndex>();
  private retireTimer: unknown = null;
  private own: CellIndex | null = null;
  private readonly zoneChs = new Map<OutdoorMapId, GameChannelHandle>();
  private sendZone: OutdoorMapId | null = null;
  private visible = 0;
  private readonly cellMoves: Throttle;
  private readonly zoneMoves: Throttle;
  private readonly cellSeen = new Map<string, number>();
  private readonly recent = new Map<string, number>();
  private readonly o: Required<GridChannelOptions>;

  constructor(
    private readonly roomId: string,
    private readonly h: GridChannelHandlers,
    private readonly joinFn: typeof joinGameChannel = joinGameChannel,
    opts: GridChannelOptions = {},
  ) {
    this.o = {
      zones: opts.zones ?? true,
      switchTimeoutMs: opts.switchTimeoutMs ?? 3000,
      now: opts.now ?? (() => Date.now()),
      setTimer: opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
      clearTimer: opts.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>)),
    };
    this.cellMoves = new Throttle(this.o, (m) => { if (this.own !== null) this.open.get(this.own)?.ch.send(m); });
    this.zoneMoves = new Throttle(this.o, (m) => {
      const z = this.sendZone;
      if (z) this.zoneChs.get(z)?.send(toZoneMsg(m, z, true));
    });
  }

  /** My position (world px) and zone: moves my own cell (with hysteresis), the listened cells and the zone topics. */
  update(pos: Vec, zone: ZoneId): GridStep {
    const cell = cellStep(this.own, pos);
    const cellChanged = cell !== this.own;
    const added: CellIndex[] = [];
    if (cellChanged) {
      this.own = cell;
      const want = cellNeighbourhood(cell);
      for (const c of want) {
        if (this.retiring.delete(c)) continue;                      // wanted again before it was left: keep it
        if (!this.open.has(c)) { this.joinCell(c); added.push(c); }
      }
      for (const c of this.open.keys()) if (!want.includes(c)) this.retiring.add(c);
      for (const c of added) this.pending.add(c);
      for (const c of [...this.pending]) if (!want.includes(c)) this.pending.delete(c);
      this.maybeRetire();
    }
    const addedZones: OutdoorMapId[] = [];
    let sendZoneChanged = false;
    if (this.o.zones) {
      const sz: OutdoorMapId = isZone(zone) ? zone : nearestZone(pos);
      sendZoneChanged = sz !== this.sendZone;
      this.sendZone = sz;
      const want = new Set<OutdoorMapId>([sz]);
      for (const z of cellZones(cellNeighbourhood(cell))) if (z !== "wild" && isZone(z)) want.add(z);
      for (const z of want) if (!this.zoneChs.has(z)) { this.zoneChs.set(z, this.joinZone(z)); addedZones.push(z); }
      for (const [z, ch] of this.zoneChs) if (!want.has(z)) { ch.leave(); this.zoneChs.delete(z); }
    }
    return { cell, cellChanged, added, addedZones, sendZoneChanged };
  }

  /** My own cell (null before the first update). */
  cell(): CellIndex | null {
    return this.own;
  }

  /** The cells whose channels are open now (retiring ones included), own first. */
  cells(): CellIndex[] {
    const all = [...this.open.keys()].sort((a, b) => a - b);
    return this.own === null ? all : [this.own, ...all.filter((c) => c !== this.own)];
  }

  /** The cells I listen to once a switch settles (own + neighbours). */
  wanted(): CellIndex[] {
    return this.own === null ? [] : cellNeighbourhood(this.own);
  }

  /** The zone topics open now (the send zone first). */
  zones(): OutdoorMapId[] {
    const all = [...this.zoneChs.keys()].sort();
    return this.sendZone ? [this.sendZone, ...all.filter((z) => z !== this.sendZone)] : all;
  }

  /** The zone my copies go to (null with zones off). */
  zoneOut(): OutdoorMapId | null {
    return this.sendZone;
  }

  /** How many players I see: past CROWD_LIMIT my movement goes out at DEGRADED_RATE a second. */
  setVisible(n: number): void {
    this.visible = n;
  }

  degraded(): boolean {
    return this.visible > CROWD_LIMIT;
  }

  /** Broadcast a world-px message: on my own cell and my send zone (movement there as a flagged zone-local copy), or
   *  only on `to` (a hello to a newly joined cell or zone topic). */
  send(msg: GameMessage, to: GridKey | null = null): void {
    if (typeof to === "number" && to !== this.own) { this.open.get(to)?.ch.send(msg); return; }
    if (typeof to === "string") { this.zoneChs.get(to)?.send(isMove(msg) ? toZoneMsg(msg, to, true) : msg); return; }
    if (this.own === null) return;
    if (isMove(msg)) {
      if (this.degraded()) this.cellMoves.push(msg, DEGRADED_RATE);
      else this.cellMoves.fire(msg);                                             // the channel's gate paces it (3/s)
      this.zoneMoves.push(msg, ZONE_COPY_RATE);
      return;
    }
    this.open.get(this.own)?.ch.send(msg);
    if (this.sendZone) this.zoneChs.get(this.sendZone)?.send(msg);
  }

  /** Leave every topic; `last` (a `bye`) goes to my own cell and my send zone. */
  leave(last?: GameMessage): void {
    this.cellMoves.cancel();
    this.zoneMoves.cancel();
    if (this.retireTimer !== null) this.o.clearTimer(this.retireTimer);
    this.retireTimer = null;
    for (const [c, { ch }] of this.open) ch.leave(c === this.own ? last : undefined);
    for (const [z, ch] of this.zoneChs) ch.leave(z === this.sendZone ? last : undefined);
    this.open.clear();
    this.zoneChs.clear();
    this.retiring.clear();
    this.pending.clear();
    this.own = null;
    this.sendZone = null;
  }

  /** Take a message in once (a non-move one may come on a cell and a zone topic both). */
  private take(msg: GameMessage, from: GridKey): void {
    if (!isMove(msg)) {
      const now = this.o.now();
      const key = JSON.stringify(msg);
      const at = this.recent.get(key);
      if (at !== undefined && now - at < DEDUPE_MS) return;
      this.recent.set(key, now);
      if (this.recent.size > 256) for (const [k, t] of this.recent) if (now - t >= DEDUPE_MS) this.recent.delete(k);
    }
    this.h.onMessage(msg, from);
  }

  private joinCell(c: CellIndex): void {
    const entry: Open = { ch: null as unknown as GameChannelHandle, connected: false };
    entry.ch = this.joinFn(this.roomId, { id: cellTopicId(c), width: WORLD_W, height: WORLD_H }, {
      onMessage: (msg) => {
        if ("fb" in msg && msg.fb === 1) return;                               // a copy meant for the 2D clients
        if (isMove(msg) && !plausibleInCell(c, msg)) return;                    // not where that topic's senders can be
        this.cellSeen.set(msg.id, this.o.now());
        if (this.cellSeen.size > 512) {
          const now = this.o.now();
          for (const [id, t] of this.cellSeen) if (now - t > CELL_SENDER_MS) this.cellSeen.delete(id);
        }
        this.take(msg, c);
      },
      onStatus: (connected) => {
        entry.connected = connected;
        if (connected && this.pending.delete(c)) this.maybeRetire();
        this.h.onStatus(c, connected);
      },
    });
    this.open.set(c, entry);
  }

  private joinZone(zone: OutdoorMapId): GameChannelHandle {
    return this.joinFn(this.roomId, { id: zone, ...zoneBounds(zone) }, {
      onMessage: (msg) => {
        if ("fb" in msg && msg.fb === 1) return;                               // a 3D client's copy: heard on the cells
        const seen = this.cellSeen.get(msg.id);
        if (seen !== undefined && this.o.now() - seen < CELL_SENDER_MS) {
          if (isMove(msg)) return;                                             // (an older world client's zone copy)
        }
        this.take(fromZoneMsg(msg, zone), zone);
      },
      onStatus: (connected) => this.h.onStatus(zone, connected),
    });
  }

  /** Leave the retiring cells once the new ones are subscribed (subscribe-new-before-unsubscribe-old). */
  private maybeRetire(): void {
    if (this.retiring.size === 0) return;
    if (this.pending.size === 0) { this.retireNow(); return; }
    if (this.retireTimer === null) {
      this.retireTimer = this.o.setTimer(() => { this.retireTimer = null; this.retireNow(); }, this.o.switchTimeoutMs);
    }
  }

  private retireNow(): void {
    if (this.retireTimer !== null) this.o.clearTimer(this.retireTimer);
    this.retireTimer = null;
    for (const c of this.retiring) {
      this.open.get(c)?.ch.leave();
      this.open.delete(c);
    }
    this.retiring.clear();
    this.pending.clear();
  }
}
