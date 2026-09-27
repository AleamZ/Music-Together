import type { MapId } from "@/lib/game/maps/types";
import type { LiftMessage } from "@/lib/game/net/protocol";
import type { VehicleId } from "@/lib/game/travel/vehicles";
import type { Facing, Vec } from "@/lib/game/types";

// v18.13 Đi nhờ xe: one passenger on a rider's vehicle. Client only: the handshake goes over the map's game channel,
// the pair is tagged on the movement messages (`ps` / `lf`). Pure.

/** How close (px, feet to feet) I must stand to a rider to ask for a lift, and they to accept. */
export const LIFT_RANGE = 24;
/** A request (the asker's wait, the driver's prompt) lapses after this long. */
export const LIFT_ASK_MS = 15_000;
/** After linking (or arriving on a map) the partner has this long to show the matching tag. */
export const LIFT_SYNC_MS = 3_000;
/** A partner unseen for this long ends the lift. */
export const LIFT_LOST_MS = 15_000;

export type LiftState =
  | { kind: "none" }
  | { kind: "asking"; driver: string; until: number }
  | { kind: "passenger"; driver: string; v: VehicleId }
  | { kind: "driver"; passenger: string };

/** A request shown to me, the driver, until `until`. */
export interface LiftOffer { from: string; until: number }
export interface LiftModel { state: LiftState; offer: LiftOffer | null }
export const LIFT_IDLE: LiftModel = { state: { kind: "none" }, offer: null };

/** A lift message as I send it (the canvas adds my id). */
export type LiftSend = LiftMessage extends infer M ? (M extends { id: string } ? Omit<M, "id"> : never) : never;

export type LiftEvent =
  | { e: "ask"; driver: string; now: number }
  | { e: "accept"; riding: VehicleId | null }
  | { e: "decline" }
  /** The passenger's "Xuống xe". */
  | { e: "leave" }
  /** The driver's "Cho xuống". */
  | { e: "drop" }
  /** I got off my vehicle. */
  | { e: "dismounted" }
  /** The engine lost my partner (a `bye`, unseen, no matching tag). */
  | { e: "lost" }
  /** I (the driver) take a portal to map `m`. */
  | { e: "portal"; m: MapId }
  | { e: "tick"; now: number }
  /** A lift message addressed to me; `free` = I may carry now (riding, nothing holds me), `near` = the sender is in range. */
  | { e: "msg"; msg: LiftMessage; now: number; riding: VehicleId | null; free: boolean; near: boolean };

/** What the shell shows once: a toast about `who`. */
export type LiftNote = "accepted" | "declined" | "expired" | "dropped" | "left" | "lost" | "carrying";

export interface LiftStep {
  model: LiftModel;
  send: LiftSend[];
  note?: { kind: LiftNote; who: string };
  /** The driver took a portal to this map: follow them. */
  follow?: MapId;
}

const NONE: LiftState = { kind: "none" };

/** The lift state machine (spec §18.13). */
export function liftReduce(m: LiftModel, ev: LiftEvent): LiftStep {
  const s = m.state;
  const out = (model: LiftModel, send: LiftSend[] = [], note?: LiftStep["note"], follow?: MapId): LiftStep =>
    ({ model, send, ...(note ? { note } : {}), ...(follow ? { follow } : {}) });
  switch (ev.e) {
    case "ask":
      if (s.kind !== "none") return out(m);
      return out({ ...m, state: { kind: "asking", driver: ev.driver, until: ev.now + LIFT_ASK_MS } }, [{ t: "rq", to: ev.driver }]);
    case "accept": {
      const o = m.offer;
      if (!o) return out(m);
      if (!ev.riding || s.kind !== "none") return out({ ...m, offer: null }, [{ t: "ra", to: o.from, ok: false }]);
      return out({ state: { kind: "driver", passenger: o.from }, offer: null }, [{ t: "ra", to: o.from, ok: true, v: ev.riding }], { kind: "carrying", who: o.from });
    }
    case "decline":
      return m.offer ? out({ ...m, offer: null }, [{ t: "ra", to: m.offer.from, ok: false }]) : out(m);
    case "leave":
      return s.kind === "passenger" ? out({ ...m, state: NONE }, [{ t: "rx", to: s.driver }]) : out(m);
    case "drop":
      return s.kind === "driver" ? out({ ...m, state: NONE }, [{ t: "rx", to: s.passenger }]) : out(m);
    case "dismounted": {
      const send: LiftSend[] = [];
      if (m.offer) send.push({ t: "ra", to: m.offer.from, ok: false });
      if (s.kind === "driver") send.push({ t: "rx", to: s.passenger });
      return send.length ? out({ state: s.kind === "driver" ? NONE : s, offer: null }, send) : out(m);
    }
    case "lost":
      if (s.kind === "driver") return out({ ...m, state: NONE }, [{ t: "rx", to: s.passenger }], { kind: "lost", who: s.passenger });
      if (s.kind === "passenger") return out({ ...m, state: NONE }, [{ t: "rx", to: s.driver }], { kind: "lost", who: s.driver });
      return out(m);
    case "portal":
      return s.kind === "driver" ? out(m, [{ t: "lg", to: s.passenger, m: ev.m }]) : out(m);
    case "tick": {
      let model = m;
      const send: LiftSend[] = [];
      let note: LiftStep["note"];
      if (s.kind === "asking" && ev.now >= s.until) {
        model = { ...model, state: NONE };
        note = { kind: "expired", who: s.driver };
      }
      if (m.offer && ev.now >= m.offer.until) {
        send.push({ t: "ra", to: m.offer.from, ok: false });
        model = { ...model, offer: null };
      }
      return model === m ? out(m) : out(model, send, note);
    }
    case "msg":
      return onMessage(m, ev);
  }
}

function onMessage(m: LiftModel, ev: Extract<LiftEvent, { e: "msg" }>): LiftStep {
  const s = m.state, msg = ev.msg, from = msg.id;
  const same = (model: LiftModel, send: LiftSend[] = [], note?: LiftStep["note"], follow?: MapId): LiftStep =>
    ({ model, send, ...(note ? { note } : {}), ...(follow ? { follow } : {}) });
  switch (msg.t) {
    case "rq": {
      // one prompt at a time; a refresh from the same asker keeps it
      if (m.offer?.from === from) return same({ ...m, offer: { from, until: ev.now + LIFT_ASK_MS } });
      if (s.kind !== "none" || !ev.riding || !ev.free || !ev.near || m.offer) return same(m, [{ t: "ra", to: from, ok: false }]);
      return same({ ...m, offer: { from, until: ev.now + LIFT_ASK_MS } });
    }
    case "ra":
      if (s.kind === "asking" && s.driver === from) {
        if (msg.ok && msg.v) return same({ ...m, state: { kind: "passenger", driver: from, v: msg.v } }, [], { kind: "accepted", who: from });
        return same({ ...m, state: NONE }, [], { kind: "declined", who: from });
      }
      // a late yes (I stopped waiting): take it back
      return msg.ok ? same(m, [{ t: "rx", to: from }]) : same(m);
    case "rx": {
      let model = m.offer?.from === from ? { ...m, offer: null } : m;
      if (s.kind === "passenger" && s.driver === from) return same({ ...model, state: NONE }, [], { kind: "dropped", who: from });
      if (s.kind === "driver" && s.passenger === from) return same({ ...model, state: NONE }, [], { kind: "left", who: from });
      if (s.kind === "asking" && s.driver === from) model = { ...model, state: NONE };
      return same(model);
    }
    case "lg":
      return s.kind === "passenger" && s.driver === from ? same(m, [], undefined, msg.m) : same(m);
  }
}

/** Where a passenger gets off: beside the vehicle (either side), else behind it, else right where it stands. */
export function dropSpot(blocked: (x: number, y: number) => boolean, pos: Vec, facing: Facing): Vec {
  const side = facing === "left" || facing === "right" ? [{ x: 0, y: 10 }, { x: 0, y: -10 }] : [{ x: -14, y: 0 }, { x: 14, y: 0 }];
  const back = facing === "right" ? { x: -20, y: 0 } : facing === "left" ? { x: 20, y: 0 } : facing === "down" ? { x: 0, y: -12 } : { x: 0, y: 12 };
  for (const d of [...side, back]) {
    const p = { x: Math.round(pos.x + d.x), y: Math.round(pos.y + d.y) };
    if (!blocked(p.x, p.y)) return p;
  }
  return { x: Math.round(pos.x), y: Math.round(pos.y) };
}

/** Is the lift still sound? `seenAt` = when the partner was last seen on this map (or when the lift began here),
 *  `agrees` = the partner's tag names me (and, for my driver, they still ride). */
export function liftSound(o: { now: number; since: number; seenAt: number; seen: boolean; agrees: boolean }): boolean {
  if (o.now - o.seenAt > LIFT_LOST_MS) return false;
  if (o.seen && !o.agrees && o.now - o.since > LIFT_SYNC_MS) return false;
  return true;
}

/** The Vietnamese toast for a note (`name` = the partner's name). */
export function liftNoteText(kind: LiftNote, name: string): string {
  switch (kind) {
    case "accepted": return `${name} cho bạn đi nhờ — lên xe! 🛵`;
    case "declined": return `${name} không cho đi nhờ.`;
    case "expired": return `${name} chưa trả lời — thôi đi bộ vậy.`;
    case "dropped": return `${name} cho bạn xuống xe.`;
    case "left": return `${name} đã xuống xe.`;
    case "lost": return `Mất liên lạc với ${name} — đã xuống xe.`;
    case "carrying": return `Đang chở ${name}.`;
  }
}
