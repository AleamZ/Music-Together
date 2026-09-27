import type { RealtimeChannel } from "@supabase/supabase-js";
import { markLeaving, whenTopicFree } from "@/lib/channel-lifecycle";
import { supabase } from "@/lib/supabase";
import type { Facing, Look } from "@/lib/game/types";
import { APT_COLS, APT_ROWS, APT_TILE } from "./apartment";

// v19.2 R2: who is inside an apartment travels on its own realtime topic, never on the street maps' channels. Presence
// (keyed by account) carries the name and the look; broadcasts carry positions and "the layout / the TV changed".

/** An interior on the realtime side: its topic key ("apt:3", v19.3 "house:2") and its size in world px. */
export interface InteriorSpaceRef { key: string; w: number; h: number }
const APT_BOUNDS = { w: APT_COLS * APT_TILE, h: APT_ROWS * APT_TILE };
const refOf = (s: number | InteriorSpaceRef): InteriorSpaceRef => (typeof s === "number" ? { key: `apt:${s}`, ...APT_BOUNDS } : s);

export const interiorTopic = (roomId: string, space: number | InteriorSpaceRef): string => `room:${roomId}:int:${refOf(space).key}`;

export interface InteriorPos { id: string; x: number; y: number; f: Facing; m: boolean }
export interface InteriorMember { id: string; name: string; look: Look | null }
export type InteriorEvent = { kind: "pos"; pos: InteriorPos } | { kind: "layout" } | { kind: "tv" } | { kind: "members"; members: InteriorMember[] };

const FACINGS: readonly Facing[] = ["up", "down", "left", "right"];

/** A position broadcast, checked (inside the room, a known facing); anything else is dropped. */
export function parsePos(v: unknown, bounds: { w: number; h: number } = APT_BOUNDS): InteriorPos | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.x !== "number" || typeof o.y !== "number" || !FACINGS.includes(o.f as Facing)) return null;
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y) || o.x < 0 || o.y < 0 || o.x > bounds.w || o.y > bounds.h) return null;
  return { id: o.id, x: o.x, y: o.y, f: o.f as Facing, m: o.m === true };
}

function looksLikeLook(v: unknown): v is Look {
  return !!v && typeof v === "object" && typeof (v as Record<string, unknown>).skin === "string" && typeof (v as Record<string, unknown>).top === "string";
}

export interface InteriorHandle {
  sendPos: (p: Omit<InteriorPos, "id">) => void;
  notify: (kind: "layout" | "tv") => void;
  close: () => void;
}

/** Join an interior's topic (a number: that apartment) as `me`; `onEvent` gets the others' positions, the member list and change hints. */
export function joinInterior(roomId: string, space: number | InteriorSpaceRef, me: InteriorMember, onEvent: (e: InteriorEvent) => void): InteriorHandle {
  const ref = refOf(space);
  const topic = interiorTopic(roomId, ref);
  let ch: RealtimeChannel | null = null;
  let closed = false;
  const joined = whenTopicFree(topic).then(() => {
    if (closed) return;
    const c = supabase.channel(topic, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    ch = c;
    const members = () => {
      const state = c.presenceState<{ name?: unknown; look?: unknown }>();
      const out: InteriorMember[] = [];
      for (const [id, metas] of Object.entries(state)) {
        if (id === me.id || !metas?.length) continue;
        const m = metas[metas.length - 1];
        out.push({ id, name: typeof m.name === "string" ? m.name : "Khách", look: looksLikeLook(m.look) ? m.look : null });
      }
      onEvent({ kind: "members", members: out });
    };
    c.on("presence", { event: "sync" }, members)
      .on("broadcast", { event: "pos" }, ({ payload }) => {
        const p = parsePos(payload, ref);
        if (p && p.id !== me.id) onEvent({ kind: "pos", pos: p });
      })
      .on("broadcast", { event: "layout" }, () => onEvent({ kind: "layout" }))
      .on("broadcast", { event: "tv" }, () => onEvent({ kind: "tv" }))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void c.track({ name: me.name, look: me.look });
      });
  });
  return {
    sendPos: (p) => { if (ch && !closed) void ch.send({ type: "broadcast", event: "pos", payload: { id: me.id, ...p } }); },
    notify: (kind) => { if (ch && !closed) void ch.send({ type: "broadcast", event: kind, payload: {} }); },
    close: () => {
      closed = true;
      markLeaving(topic, joined.then(() => (ch ? supabase.removeChannel(ch) : undefined)));
    },
  };
}
