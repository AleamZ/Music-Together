import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { getMap } from "@/lib/game/maps/registry";
import { SPEAKERS, STORY_NPCS, npcOfKind, routeHint, type StoryNpcId } from "@/lib/game/story/npcs";
import { CHAPTERS, IDLE, STORY_STEPS } from "@/lib/game/story/scripts";
import { guidance, parseStoryState, talkTo, type StoryState } from "@/lib/game/story/model";

const SQL = readFileSync("supabase/migrations/0114_story_quests.sql", "utf8");
/** ('s01_chao', 1, 1, 'Chào làng', '…', 'bac_ba_lang', 'co_ba', 'talk', …) rows of story_quests. */
const SQL_STEPS = [...SQL.matchAll(/\('(s\d\d_\w+)',\s+(\d+),\s+(\d+),\s+'[^']*',\s*'[^']*',\s+'(\w+)',\s+'(\w+)',\s+'(\w+)'/g)]
  .map((m) => ({ id: m[1], chapter: Number(m[2]), giver: m[4], turnin: m[5], kind: m[6] }));
const SQL_NPCS = [...SQL.matchAll(/\('(\w+)',\s+'[^']+',\s+'(\w+)',\s+(\d+),\s+(\d+),\s+(\d+)\)/g)]
  .map((m) => ({ id: m[1], map: m[2], x: Number(m[3]), y: Number(m[4]), reach: Number(m[5]) }));

describe("story scripts", () => {
  it("has the migration's steps, in order, each with offer / progress / turn-in lines", () => {
    expect(SQL_STEPS.map((s) => s.id)).toEqual(STORY_STEPS.map((s) => s.id));
    for (const s of STORY_STEPS) {
      expect(s.offer.length, s.id).toBeGreaterThan(0);
      expect(s.progress.length, s.id).toBeGreaterThan(0);
      expect(s.turnIn.length, s.id).toBeGreaterThan(0);
      expect(s.hint, s.id).not.toBe("");
      expect(CHAPTERS[s.chapter], s.id).toBeTruthy();
      expect(SQL_STEPS.find((x) => x.id === s.id)?.chapter).toBe(s.chapter);
    }
  });

  it("every speaker exists and every line has text", () => {
    const all = [...STORY_STEPS.flatMap((s) => [...s.offer, ...s.progress, ...s.turnIn]), ...Object.values(IDLE).flat()];
    for (const l of all) {
      expect(SPEAKERS[l.speaker], l.text).toBeTruthy();
      expect(l.text.trim().length).toBeGreaterThan(0);
    }
  });

  it("the offer is spoken by the giver and the hand-in by the turn-in NPC", () => {
    for (const s of STORY_STEPS) {
      const q = SQL_STEPS.find((x) => x.id === s.id)!;
      expect(s.offer.some((l) => l.speaker === q.giver), s.id).toBe(true);
      expect(s.turnIn.some((l) => l.speaker === q.turnin), s.id).toBe(true);
    }
  });

  it("the NPCs match the migration and stand where their interactable is used", () => {
    expect(SQL_NPCS.map((n) => n.id).sort()).toEqual(Object.keys(STORY_NPCS).sort());
    for (const n of SQL_NPCS) {
      const c = STORY_NPCS[n.id as StoryNpcId];
      expect({ map: c.map, x: c.x, y: c.y, reach: c.reach }).toEqual({ map: n.map, x: n.x, y: n.y, reach: n.reach });
      const it = getMap(c.map).interactables.find((i) => i.kind === c.kind);
      expect(it?.use, n.id).toEqual({ x: c.x, y: c.y });
      expect(npcOfKind(c.kind)).toBe(c.id);
      expect(IDLE[c.id].length).toBeGreaterThan(0);
    }
    for (const q of SQL_STEPS) {
      expect(STORY_NPCS[q.giver as StoryNpcId], q.id).toBeTruthy();
      expect(STORY_NPCS[q.turnin as StoryNpcId], q.id).toBeTruthy();
    }
  });

  it("sends the newcomer to sell at cô Ba first, Chợ Lớn later", () => {
    const sell = SQL_STEPS.find((s) => s.kind === "sell_pond")!;
    const market = SQL_STEPS.find((s) => s.kind === "sell_market")!;
    expect(sell.turnin).toBe("co_ba");
    expect(SQL_STEPS.indexOf(sell)).toBeLessThan(SQL_STEPS.indexOf(market));
    expect(SQL_STEPS.findIndex((s) => s.kind === "buy_bait")).toBeLessThan(SQL_STEPS.findIndex((s) => s.kind === "catch"));
    expect(SQL_STEPS.find((s) => s.kind === "buy_bait")!.turnin).toBe("chu_tu");
  });

  it("knows the way between the maps", () => {
    for (const a of ["hall", "pond", "field", "market"] as const)
      for (const b of ["hall", "pond", "field", "market"] as const) expect(routeHint(a, b) === "").toBe(a === b);
  });
});

const raw = (over: Record<string, unknown>[]) => ({
  current: "s01_chao", finished: false, veteran: false,
  quests: STORY_STEPS.map((s, i) => {
    const q = SQL_STEPS[i];
    return { id: s.id, chapter: s.chapter, title: s.id, objective: "obj", giver: q.giver, turnin: q.turnin, kind: q.kind,
      goal: 1, progress: 0, status: "locked", coins: 20, xp: 20, item: null, item_qty: 0, ...(over[i] ?? {}) };
  }),
});

describe("story model", () => {
  it("parses and rejects an envelope", () => {
    expect(parseStoryState({ ok: false })).toBeNull();
    const s = parseStoryState(raw([{ status: "available" }]))!;
    expect(s.quests).toHaveLength(STORY_STEPS.length);
    expect(s.current).toBe("s01_chao");
  });

  it("picks the talk: offer at the giver, hint while under way, hand-in at the turn-in NPC, else chatter", () => {
    const avail = parseStoryState(raw([{ status: "available" }])) as StoryState;
    expect(talkTo(avail, "bac_ba_lang")?.mode).toBe("offer");
    expect(talkTo(avail, "co_ba")?.mode).toBe("idle");
    const s3 = parseStoryState({ ...raw([{ status: "claimed" }, { status: "claimed" }, { status: "active" }]), current: "s03_moi" })!;
    expect(talkTo(s3, "chu_tu")?.mode).toBe("progress");
    const s4 = parseStoryState({ ...raw([{}, {}, {}, { status: "done" }]), current: "s04_cau" })!;
    expect(talkTo(s4, "co_ba")?.mode).toBe("turnin");
    expect(talkTo(s4, "chu_tu")?.mode).toBe("idle");
    expect(talkTo(null, "co_ba")).toBeNull();
  });

  it("points the way: route on another map, arrow and distance on the same, 'here' within reach", () => {
    const s = parseStoryState(raw([{ status: "active" }]))!;           // s01: to cô Ba at the pond
    const q = s.quests[0];
    expect(guidance(q, "hall", { x: 0, y: 0 }).route).toContain("Bến câu cá");
    const far = guidance(q, "pond", { x: 570, y: 340 });
    expect(far.arrow).toBe("↑");
    expect(far.dist).toBe(200);
    expect(guidance(q, "pond", { x: 560, y: 150 }).here).toBe(true);
  });
});
