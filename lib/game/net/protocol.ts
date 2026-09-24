import { MAX_PATH_POINTS } from "@/lib/game/pathfinding";
import type { Facing } from "@/lib/game/types";

/** Same cap as the path smoother: a `pa` message never carries more points. */
export { MAX_PATH_POINTS };

export type FacingCode = "u" | "d" | "l" | "r";
export type Unit = -1 | 0 | 1;

/** Broadcast messages on channel `game:{roomId}` (spec §8.2). `id` = sender account id. */
export type GameMessage =
  | { t: "hello"; id: string }
  | { t: "st" | "mv"; id: string; x: number; y: number; d: FacingCode; mv: boolean; vx: Unit; vy: Unit }
  | { t: "pa"; id: string; x: number; y: number; pts: Array<[number, number]> }
  | { t: "lk"; id: string }
  | { t: "bye"; id: string };
export type GameEvent = GameMessage["t"];

export const GAME_EVENTS: readonly GameEvent[] = ["hello", "st", "mv", "pa", "lk", "bye"];

const TO_CODE: Record<Facing, FacingCode> = { up: "u", down: "d", left: "l", right: "r" };
const FROM_CODE: Record<FacingCode, Facing> = { u: "up", d: "down", l: "left", r: "right" };
export function facingToCode(f: Facing): FacingCode { return TO_CODE[f]; }
export function codeToFacing(c: FacingCode): Facing { return FROM_CODE[c]; }

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const isUnit = (v: unknown): v is Unit => v === -1 || v === 0 || v === 1;
const isCode = (v: unknown): v is FacingCode => v === "u" || v === "d" || v === "l" || v === "r";

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
    case "mv":
      if (!inMap(p.x, p.y) || !isCode(p.d) || typeof p.mv !== "boolean" || !isUnit(p.vx) || !isUnit(p.vy)) return null;
      return { t: event, id: p.id, x: p.x as number, y: p.y as number, d: p.d, mv: p.mv, vx: p.vx, vy: p.vy };
    case "pa": {
      if (!inMap(p.x, p.y) || !Array.isArray(p.pts) || p.pts.length === 0 || p.pts.length > MAX_PATH_POINTS) return null;
      const pts: Array<[number, number]> = [];
      for (const q of p.pts as unknown[]) {
        if (!Array.isArray(q) || q.length !== 2 || !inMap(q[0], q[1])) return null;
        pts.push([q[0] as number, q[1] as number]);
      }
      return { t: "pa", id: p.id, x: p.x as number, y: p.y as number, pts };
    }
    default:
      return null;
  }
}

export function toPayload(msg: GameMessage): { event: GameEvent; payload: Record<string, unknown> } {
  const { t, ...rest } = msg;
  return { event: t, payload: rest };
}

export interface SendGate { push(msg: GameMessage): void; dispose(): void }
export interface SendGateOptions {
  ratePerSec?: number;
  burst?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Token bucket (default 3 msgs/s, burst 3). Movement messages (mv/pa/st) are coalesced to the latest one;
 *  control messages (hello/lk/bye) are queued FIFO and go first. */
export function createSendGate(send: (msg: GameMessage) => void, opts: SendGateOptions = {}): SendGate {
  const rate = opts.ratePerSec ?? 3;
  const burst = opts.burst ?? 3;
  const now = opts.now ?? (() => Date.now());
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let tokens = burst;
  let last = now();
  let timer: unknown = null;
  let disposed = false;
  let pendingMove: GameMessage | null = null;
  const queue: GameMessage[] = [];

  const refill = () => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate);
    last = t;
  };
  const flush = () => {
    timer = null;
    if (disposed) return;
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
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
      queue.length = 0;
      pendingMove = null;
    },
  };
}
