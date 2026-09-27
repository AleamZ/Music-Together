import { MAX_PATH_POINTS } from "@/lib/game/pathfinding";
import { isCrampLeft, isHeatBits } from "@/lib/game/heat/model";
import { isRainBits } from "@/lib/game/rain/model";
import { isSwimCode, type SwimCode } from "@/lib/game/swim";
import { isVehicleId } from "@/lib/game/travel/ride";
import { parsePetCode } from "@/lib/game/pets/model";
import type { VehicleId } from "@/lib/game/travel/vehicles";
import { MAP_IDS, type MapId } from "@/lib/game/maps/types";
import type { Facing } from "@/lib/game/types";

/** Same cap as the path smoother: a `pa` message never carries more points. */
export { MAX_PATH_POINTS };

export type FacingCode = "u" | "d" | "l" | "r";
export type Unit = -1 | 0 | 1;
/** Fishing phase (v14): 0 idle, 1 line out, 2 bite, 3 reeling. */
export type FishPhase = 0 | 1 | 2 | 3;
/** Farm animation (v15 spec §12), played for 2.5 s; 0 stops it. */
export type FarmAnim = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
/** v15.2 adds dig (đào khoai) and pick (bẻ bắp, hái ớt), v17 pet (a dog) and aim (a ná); older clients drop codes they
 *  do not know. */
export const FARM_ANIM = {
  stop: 0, transplant: 1, harvest: 2, pump: 3, spray: 4, fertilize: 5, crab: 6, snails: 7, prepare: 8, dig: 9, pick: 10, pet: 11, aim: 12,
} as const satisfies Record<string, FarmAnim>;
/** The highest plot number on the field; `fp` with p = 0 means the drying yard or the offers. */
export const MAX_PLOT = 10;

/** Broadcast messages on channel `game:{roomId}:{mapId}` (v13 spec §8.2, v14 spec §9.3, v15 spec §12). `id` = sender
 *  account id. `h` = the species id of the fish in the sender's hand (null = none; absent = unchanged); `st` may carry
 *  `f`. `v` (v18.7) = the vehicle the sender rides on st/mv/pa (absent = on foot; an unknown id reads as null). `sw` (v18.1) =
 *  1 swimming in the pond, 2 wet after climbing out (absent = dry; anything else is dropped). `hx` (v18.10) = heat bits
 *  (1 heat-shocked, 2 warming up, 4 cramping); `pt` (v18.12) = the sender's following pet (lib/game/pets/model.ts encodePet;
 *  absent = none; malformed = dropped); `rn` (v18.9) = rain bits (lib/game/rain/model.ts RN; absent = dry) and `cr` = the cramp's ms left (0..10000); anything else is dropped. `fp` = "plot p changed, fetch the field again"; `fa` = the sender's farm animation. */
export type GameMessage =
  | { t: "hello"; id: string }
  | { t: "st" | "mv"; id: string; x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit; h?: string | null; f?: FishPhase; v?: VehicleId | null; sw?: SwimCode; hx?: number; cr?: number; pt?: string; rn?: number; hm?: 1 } & LiftTags
  | { t: "pa"; id: string; x: number; y: number; pts: Array<[number, number]>; h?: string | null; v?: VehicleId | null; sw?: SwimCode; hx?: number; cr?: number; pt?: string; rn?: number; hm?: 1 } & LiftTags
  | { t: "fs"; id: string; f: FishPhase; h: string | null; c?: [string, number]; n?: NetCast }
  | { t: "fp"; id: string; p: number }
  | { t: "fa"; id: string; a: FarmAnim }
  | { t: "lk"; id: string }
  | { t: "bye"; id: string }
  | LiftMessage;
export type GameEvent = GameMessage["t"];

/** v18.2 Quăng lưới on `fs` (f 0 only; absent = no throw): [phase 1 aim / 2 charge / 3 throw / 4 sunk / 5 pull / 6 won,
 *  the net's dx, dy from the feet (±120 px), its radius (0..40), the fish held up (0..9)] (lib/game/fishing/netcast.ts). */
export type NetCode = 1 | 2 | 3 | 4 | 5 | 6;
export type NetCast = [NetCode, number, number, number, number];
const isNetCast = (v: unknown): v is NetCast =>
  Array.isArray(v) && v.length === 5 && v.every((x) => Number.isInteger(x)) && v[0] >= 1 && v[0] <= 6
  && Math.abs(v[1]) <= 120 && Math.abs(v[2]) <= 120 && v[3] >= 0 && v[3] <= 40 && v[4] >= 0 && v[4] <= 9;

/** v18.13 Đi nhờ xe: on st/mv/pa, `ps` = my passenger (I drive), `lf` = my driver (I ride along); absent = none. */
export interface LiftTags { ps?: string; lf?: string }
/** v18.13: `rq` asks driver `to` for a lift; `ra` answers asker `to` (`v` = the vehicle when `ok`); `rx` ends the lift
 *  with `to` (either side); `lg` tells passenger `to` that I take the portal to map `m`. */
export type LiftMessage =
  | { t: "rq"; id: string; to: string }
  | { t: "ra"; id: string; to: string; ok: boolean; v?: VehicleId }
  | { t: "rx"; id: string; to: string }
  | { t: "lg"; id: string; to: string; m: MapId };

export const GAME_EVENTS: readonly GameEvent[] = ["hello", "st", "mv", "pa", "fs", "fp", "fa", "lk", "bye", "rq", "ra", "rx", "lg"];

const TO_CODE: Record<Facing, FacingCode> = { up: "u", down: "d", left: "l", right: "r" };
const FROM_CODE: Record<FacingCode, Facing> = { u: "up", d: "down", l: "left", r: "right" };
export function facingToCode(f: Facing): FacingCode { return TO_CODE[f]; }
export function codeToFacing(c: FacingCode): Facing { return FROM_CODE[c]; }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isUnit = (v: unknown): v is Unit => v === -1 || v === 0 || v === 1;
const isCode = (v: unknown): v is FacingCode => v === "u" || v === "d" || v === "l" || v === "r";
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isFarmAnim = (v: unknown): v is FarmAnim => isInt(v) && v >= 0 && v <= 12;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
/** Optional hand fish: absent → undefined (unchanged), else null or a species id; anything else is malformed. */
const handOf = (v: unknown): string | null | undefined | false => (v === undefined || v === null || isSpecies(v) ? v : false);

/** Optional ridden vehicle (v18.7): a known id, else null (a newer client's vehicle is drawn on foot). */
const rideOf = (v: unknown): VehicleId | null => (isVehicleId(v) ? v : null);

/** v18.13: copy valid `ps` / `lf` ids (never both, never my own id) onto a movement message; others are dropped. */
function liftTags(p: Record<string, unknown>, msg: LiftTags): void {
  if (isId(p.ps) && p.ps !== p.id) msg.ps = p.ps;
  else if (isId(p.lf) && p.lf !== p.id) msg.lf = p.lf;
}

/** Validate an incoming broadcast; anything malformed or outside the map → null. */
export function parseGameMessage(event: string, payload: unknown, bounds: { width: number; height: number }): GameMessage | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (!isId(p.id)) return null;
  const inMap = (x: unknown, y: unknown): boolean =>
    isInt(x) && isInt(y) && x >= 0 && y >= 0 && x <= bounds.width && y <= bounds.height;
  switch (event) {
    case "hello":
    case "lk":
    case "bye":
      return { t: event, id: p.id };
    case "st":
    case "mv": {
      if (!inMap(p.x, p.y) || !isCode(p.d) || typeof p.mv !== "boolean" || !isUnit(p.vx) || !isUnit(p.vy)) return null;
      const h = handOf(p.h);
      if (h === false || (event === "st" && p.f !== undefined && !isPhase(p.f))) return null;
      const msg: Extract<GameMessage, { t: "st" | "mv" }> = { t: event, id: p.id, x: p.x as number, y: p.y as number, d: p.d, mv: p.mv, vx: p.vx, vy: p.vy };
      if (h !== undefined) msg.h = h;
      if (event === "st" && isPhase(p.f)) msg.f = p.f;
      if (p.v !== undefined) msg.v = rideOf(p.v);
      if (isSwimCode(p.sw)) msg.sw = p.sw;
      if (isHeatBits(p.hx)) msg.hx = p.hx;
      if (isHeatBits(p.hx) && isCrampLeft(p.cr)) msg.cr = p.cr;
      if (parsePetCode(p.pt)) msg.pt = p.pt as string;
      if (isRainBits(p.rn)) msg.rn = p.rn;                                  // v18.9
      if (p.hm === 1) msg.hm = 1;                                            // lying in the hall's hammock
      liftTags(p, msg);
      return msg;
    }
    case "pa": {
      if (!inMap(p.x, p.y) || !Array.isArray(p.pts) || p.pts.length === 0 || p.pts.length > MAX_PATH_POINTS) return null;
      const h = handOf(p.h);
      if (h === false) return null;
      const pts: Array<[number, number]> = [];
      for (const q of p.pts as unknown[]) {
        if (!Array.isArray(q) || q.length !== 2 || !inMap(q[0], q[1])) return null;
        pts.push([q[0] as number, q[1] as number]);
      }
      const msg: Extract<GameMessage, { t: "pa" }> = { t: "pa", id: p.id, x: p.x as number, y: p.y as number, pts };
      if (h !== undefined) msg.h = h;
      if (p.v !== undefined) msg.v = rideOf(p.v);
      if (isSwimCode(p.sw)) msg.sw = p.sw;
      if (isHeatBits(p.hx)) msg.hx = p.hx;
      if (isHeatBits(p.hx) && isCrampLeft(p.cr)) msg.cr = p.cr;
      if (parsePetCode(p.pt)) msg.pt = p.pt as string;
      if (isRainBits(p.rn)) msg.rn = p.rn;                                  // v18.9
      if (p.hm === 1) msg.hm = 1;                                            // lying in the hall's hammock
      liftTags(p, msg);
      return msg;
    }
    case "rq":
    case "rx":
      return isId(p.to) ? { t: event, id: p.id, to: p.to } : null;
    case "ra":
      if (!isId(p.to) || typeof p.ok !== "boolean") return null;
      return p.ok && isVehicleId(p.v) ? { t: "ra", id: p.id, to: p.to, ok: true, v: p.v } : { t: "ra", id: p.id, to: p.to, ok: false };
    case "lg":
      return isId(p.to) && (MAP_IDS as readonly unknown[]).includes(p.m) ? { t: "lg", id: p.id, to: p.to, m: p.m as MapId } : null;
    case "fs": {
      const h = handOf(p.h);
      if (!isPhase(p.f) || h === false || h === undefined) return null;
      if (p.n !== undefined) {
        // a throw is only shown with the rod in, and never with a catch label
        if (p.f !== 0 || p.c !== undefined || !isNetCast(p.n)) return null;
        const n = p.n;
        return { t: "fs", id: p.id, f: 0, h, n: [n[0], n[1], n[2], n[3], n[4]] };
      }
      if (p.c === undefined) return { t: "fs", id: p.id, f: p.f, h };
      const c = p.c;
      if (!Array.isArray(c) || c.length !== 2 || !isSpecies(c[0]) || !isInt(c[1]) || c[1] < 1 || c[1] > 100_000) return null;
      // a catch label only comes with the end of a cast
      return p.f === 0 ? { t: "fs", id: p.id, f: 0, h, c: [c[0], c[1]] } : { t: "fs", id: p.id, f: p.f, h };
    }
    case "fp":
      return isInt(p.p) && p.p >= 0 && p.p <= MAX_PLOT ? { t: "fp", id: p.id, p: p.p } : null;
    case "fa":
      return isFarmAnim(p.a) ? { t: "fa", id: p.id, a: p.a } : null;
    default:
      return null;
  }
}

export function toPayload(msg: GameMessage): { event: GameEvent; payload: Record<string, unknown> } {
  const { t, ...rest } = msg;
  return { event: t, payload: rest };
}

export interface SendGate {
  push(msg: GameMessage): void;
  /** Send what is waiting now that `ready()` may have turned true (e.g. the channel subscribed). */
  kick(): void;
  dispose(): void;
}
export interface SendGateOptions {
  ratePerSec?: number;
  burst?: number;
  /** While false, messages wait in the gate (control FIFO, movement coalesced); call kick() when it turns true. */
  ready?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Token bucket (default 3 msgs/s, burst 3). Movement messages (mv/pa/st) are coalesced to the latest one;
 *  control messages (hello/fs/fp/fa/lk/bye) are queued FIFO, never dropped, and go first. */
export function createSendGate(send: (msg: GameMessage) => void, opts: SendGateOptions = {}): SendGate {
  const rate = opts.ratePerSec ?? 3;
  const burst = opts.burst ?? 3;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const ready = opts.ready ?? (() => true);
  let tokens = burst;
  let last = now();
  let timer: unknown = null;
  let disposed = false;
  let pendingMove: GameMessage | null = null;
  const queue: GameMessage[] = [];

  const refill = () => {
    const t = now();
    // a backwards clock step must not drive the bucket negative (that would stall hello/movement for as long)
    tokens = Math.min(burst, tokens + (Math.max(0, t - last) / 1000) * rate);
    last = t;
  };
  const flush = () => {
    timer = null;
    if (disposed || !ready()) return;
    refill();
    while (tokens >= 1) {
      const next = queue.length > 0 ? queue.shift()! : pendingMove;
      if (!next) break;
      if (next === pendingMove) pendingMove = null;
      tokens -= 1;
      send(next);
    }
    if (queue.length > 0 || pendingMove) {
      const wait = Math.max(10, Math.ceil(((1 - tokens) / rate) * 1000));
      timer = setTimer(flush, wait);
    }
  };
  return {
    push(msg) {
      if (disposed) return;
      if (msg.t === "mv" || msg.t === "pa" || msg.t === "st") pendingMove = msg;
      else queue.push(msg);
      if (timer === null) flush();
    },
    kick() {
      if (!disposed && timer === null) flush();
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      queue.length = 0;
      pendingMove = null;
    },
  };
}
