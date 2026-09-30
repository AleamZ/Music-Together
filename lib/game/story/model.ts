// Pure: the story chain's state (0114 story_state) and what an NPC says given it. The server owns the progress and the
// rewards; this only picks the dialogue and the tracker's target.
import type { MapId } from "@/lib/game/maps/types";
import { MAP_NAMES, STORY_NPCS, routeHint, type StoryNpcId } from "./npcs";
import { IDLE, STEP_BY_ID, type DialogueLine } from "./scripts";

export type StoryStatus = "locked" | "available" | "active" | "done" | "claimed";

export interface StoryQuest {
  id: string; chapter: number; title: string; objective: string;
  giver: StoryNpcId; turnin: StoryNpcId; kind: string;
  goal: number; progress: number; status: StoryStatus;
  coins: number; xp: number; item: string | null; itemQty: number;
}

export interface StoryState {
  quests: StoryQuest[];
  current: string | null;
  finished: boolean;
  veteran: boolean;
  paid?: number;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const STATUSES: readonly StoryStatus[] = ["locked", "available", "active", "done", "claimed"];
const isNpc = (v: unknown): v is StoryNpcId => typeof v === "string" && v in STORY_NPCS;

/** null when the answer is not a story state (an anti-cheat envelope, an old server). */
export function parseStoryState(data: unknown): StoryState | null {
  const r = obj(data);
  if (!Array.isArray(r.quests)) return null;
  const quests: StoryQuest[] = [];
  for (const raw of r.quests) {
    const q = obj(raw);
    const status = STATUSES.find((s) => s === q.status);
    if (!status || !isNpc(q.giver) || !isNpc(q.turnin)) continue;
    quests.push({
      id: str(q.id), chapter: num(q.chapter, 1), title: str(q.title), objective: str(q.objective),
      giver: q.giver, turnin: q.turnin, kind: str(q.kind), goal: num(q.goal, 1), progress: num(q.progress), status,
      coins: num(q.coins), xp: num(q.xp), item: typeof q.item === "string" ? q.item : null, itemQty: num(q.item_qty),
    });
  }
  const out: StoryState = {
    quests, current: typeof r.current === "string" ? r.current : null, finished: r.finished === true, veteran: r.veteran === true,
  };
  if (r.paid !== undefined) out.paid = num(r.paid);
  return out;
}

export function currentQuest(s: StoryState | null): StoryQuest | null {
  if (!s?.current) return null;
  return s.quests.find((q) => q.id === s.current) ?? null;
}

/** What talking to an NPC does: offer the next step, hand one in, give a hint, or just chat. */
export type Talk =
  | { mode: "offer"; quest: StoryQuest; lines: DialogueLine[] }
  | { mode: "turnin"; quest: StoryQuest; lines: DialogueLine[] }
  | { mode: "progress"; quest: StoryQuest; lines: DialogueLine[] }
  | { mode: "idle"; quest: null; lines: DialogueLine[] };

export function talkTo(s: StoryState | null, npc: StoryNpcId): Talk | null {
  const q = currentQuest(s);
  if (q) {
    const def = STEP_BY_ID.get(q.id);
    if (def) {
      if (q.status === "available" && q.giver === npc) return { mode: "offer", quest: q, lines: def.offer };
      if (q.status === "done" && q.turnin === npc) return { mode: "turnin", quest: q, lines: def.turnIn };
      if (q.status === "active" && (q.turnin === npc || q.giver === npc)) return { mode: "progress", quest: q, lines: def.progress };
    }
  }
  if (!s) return null;
  return { mode: "idle", quest: null, lines: IDLE[npc] };
}

/** Where the tracker points: the NPC to see next (the giver to accept, the turn-in NPC otherwise). */
export function targetOf(q: StoryQuest): StoryNpcId {
  return q.status === "available" ? q.giver : q.turnin;
}

export type Arrow = "↑" | "↗" | "→" | "↘" | "↓" | "↙" | "←" | "↖";
const ARROWS: readonly Arrow[] = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

/** The direction and distance (map px) from me to the target on the same map, or the route to its map. */
export function guidance(q: StoryQuest, map: MapId, me: { x: number; y: number } | null):
  { npc: StoryNpcId; arrow: Arrow | null; dist: number | null; here: boolean; route: string; place: string } {
  const npc = targetOf(q);
  const n = STORY_NPCS[npc];
  const place = `${n.name} · ${n.place}`;
  if (n.map !== map) {
    return { npc, arrow: null, dist: null, here: false, route: routeHint(map, n.map) || `Đi tới ${MAP_NAMES[n.map] ?? n.map}`, place };
  }
  if (!me) return { npc, arrow: null, dist: null, here: false, route: "", place };
  const dx = n.x - me.x, dy = n.y - me.y;
  const dist = Math.round(Math.hypot(dx, dy));
  const here = dist <= n.reach;
  const idx = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
  return { npc, arrow: here ? null : ARROWS[idx], dist, here, route: "", place };
}

/** The tracker's action line: what to do now. */
export function actionLine(q: StoryQuest): string {
  const n = STORY_NPCS[targetOf(q)].name;
  if (q.status === "available") return `Gặp ${n} để nhận việc`;
  if (q.status === "done") return `Quay lại ${n} để báo xong`;
  return q.objective;
}

const ERRORS: Record<string, string> = {
  "too far": "Hãy đứng sát người đó rồi nói chuyện lại.",
  "not done": "Chưa xong việc đâu.",
  "already claimed": "Việc này đã xong rồi.",
  "already accepted": "Bạn đã nhận việc này rồi.",
  "story busy": "Làm xong việc đang dở đã.",
  "quest locked": "Làm xong việc trước đã.",
  "account locked": "Tài khoản đang bị khoá tạm thời.",
  "client outdated": "Trang đã cũ — hãy tải lại.",
};
export function storyErrorMessage(msg: string): string {
  for (const [k, v] of Object.entries(ERRORS)) if (msg.includes(k)) return v;
  return "Có lỗi, thử lại sau.";
}
