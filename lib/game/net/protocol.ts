import { MAX_PATH_POINTS } from "@/lib/game/pathfinding";
import type { Facing } from "@/lib/game/types";

/** Same cap as the path smoother: a `pa` message never carries more points. */
export { MAX_PATH_POINTS };

export type FacingCode = "u" | "d" | "l" | "r";
export type Unit = -1 | 0 | 1;
/** Fishing phase (v14): 0 idle, 1 line out, 2 bite, 3 reeling. */
export type FishPhase = 0 | 1 | 2 | 3;

/** Broadcast messages on channel `game:{roomId}:{mapId}` (v13 spec §8.2, v14 spec §9.3). `id` = sender account id.
 *  `h` = the species id of the fish in the sender's hand (null = none; absent = unchanged); `st` may carry `f`. */
export type GameMessage =
  | { t: "hello"; id: string }
  | { t: "st" | "mv"; id: string; x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit; h?: string | null; f?: FishPhase }
  | { t: "pa"; id: string; x: number; y: number; pts: Array<[number, number]>; h?: string | null }
  | { t: "fs"; id: string; f: FishPhase; h: string | null; c?: [string, number] }
  | { t: "lk"; id: string }
  | { t: "bye"; id: string };
export type GameEvent = GameMessage["t"];

export const GAME_EVENTS: readonly GameEvent[] = ["hello", "st", "mv", "pa", "fs", "lk", "bye"];

const TO_CODE: Record<Facing, FacingCode> = { up: "u", down: "d", left: "l", right: "r" };
const FROM_CODE: Record<FacingCode, Facing> = { u: "up", d: "down", l: "left", r: "right" };
export function facingToCode(f: Facing): FacingCode { return TO_CODE[f]; }
export function codeToFacing(c: FacingCode): Facing { return FROM_CODE[c]; }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isUnit = (v: unknown): v is Unit => v === -1 || v === 0 || v === 1;
const isCode = (v: unknown): v is FacingCode => v === "u" || v === "d" || v === "l" || v === "r";
const isPhase = (v: unknown): v is FishPhase => v === 0 || v === 1 || v === 2 || v === 3;
const isSpecies = (v: unknown): v is string => typeof v === "string" && /^[a-z_]{1,32}$/.test(v);
/** Optional hand fish: absent → undefined (unchanged), else null or a species id; anything else is malformed. */
const handOf = (v: unknown): string | null | undefined | false => (v === undefined || v === null || isSpecies(v) ? v : false);

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
      return h === undefined ? { t: "pa", id: p.id, x: p.x as number, y: p.y as number, pts } : { t: "pa", id: p.id, x: p.x as number, y: p.y as number, pts, h };
    }
    case "fs": {
      const h = handOf(p.h);
      if (!isPhase(p.f) || h === false || h === undefined) return null;
      if (p.c === undefined) return { t: "fs", id: p.id, f: p.f, h };
      const c = p.c;
      if (!Array.isArray(c) || c.length !== 2 || !isSpecies(c[0]) || !isInt(c[1]) || c[1] < 1 || c[1] > 100_000) return null;
      // a catch label only comes with the end of a cast
      return p.f === 0 ? { t: "fs", id: p.id, f: 0, h, c: [c[0], c[1]] } : { t: "fs", id: p.id, f: p.f, h };
    }
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
 *  control messages (hello/fs/lk/bye) are queued FIFO, never dropped, and go first. */
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
