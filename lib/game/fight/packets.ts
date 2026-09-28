// v20.3 PvP packets on the fight topic `fight:{roomId}:r{ring}` (spec §v20.3 "The numbers", plan ruling P12). Every
// packet carries its sender's account id; anything malformed or oversized is dropped. Pure.

import { MAX_MASK } from "./log";

/** At most this many RLE runs in one `fi`. */
export const MAX_PACKET_RUNS = 200;
/** No frame number reaches this (the worst case is 30 900 frames; a stalled match is overtime-capped at 20 min). */
export const MAX_FRAME = 40_000;

/** `fi`: my inputs from frame `f` (RLE runs `r`), my ack `a` of the opponent's inputs (highest contiguous frame, −1 none),
 *  and `h = [frame, hash]` of the newest checkpoint I confirmed. */
export interface FiPacket { id: string; f: number; r: number[]; a: number; h?: [number, number] }
/** `fp` ping / `fq` pong (the ready screen): a sequence number and the pinger's clock (ms). */
export interface PingPacket { id: string; n: number; ms: number }
/** `fr`: "I resynced at frame f" — the opponent runs procedure R too. */
export interface FrPacket { id: string; f: number }

export type FightEvent = "fi" | "fp" | "fq" | "fr";
export const FIGHT_EVENTS: readonly FightEvent[] = ["fi", "fp", "fq", "fr"];

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function parseFi(v: unknown): FiPacket | null {
  const p = obj(v);
  if (!p || !isId(p.id) || !isInt(p.f) || p.f < 0 || p.f >= MAX_FRAME || !isInt(p.a) || p.a < -1 || p.a >= MAX_FRAME) return null;
  if (!Array.isArray(p.r) || p.r.length % 2 !== 0 || p.r.length > 2 * MAX_PACKET_RUNS) return null;
  let total = p.f;
  for (let i = 0; i < p.r.length; i += 2) {
    const m = p.r[i], c = p.r[i + 1];
    if (!isInt(m) || m < 0 || m > MAX_MASK || !isInt(c) || c < 1) return null;
    total += c;
    if (total > MAX_FRAME) return null;
  }
  const out: FiPacket = { id: p.id, f: p.f, r: p.r as number[], a: p.a };
  if (p.h !== undefined) {
    const h = p.h;
    if (!Array.isArray(h) || h.length !== 2 || !isInt(h[0]) || h[0] < 0 || h[0] >= MAX_FRAME || !isInt(h[1]) || h[1] < 0 || h[1] > 0xffffffff) return null;
    out.h = [h[0], h[1]];
  }
  return out;
}

export function parsePing(v: unknown): PingPacket | null {
  const p = obj(v);
  if (!p || !isId(p.id) || !isInt(p.n) || p.n < 0 || p.n > 1000 || typeof p.ms !== "number" || !Number.isFinite(p.ms)) return null;
  return { id: p.id, n: p.n, ms: p.ms };
}

export function parseFr(v: unknown): FrPacket | null {
  const p = obj(v);
  if (!p || !isId(p.id) || !isInt(p.f) || p.f < 0 || p.f >= MAX_FRAME) return null;
  return { id: p.id, f: p.f };
}
