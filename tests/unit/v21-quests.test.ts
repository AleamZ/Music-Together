import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildHallMap } from "@/lib/game/maps/hall";
import { LOGIN_REWARDS, PHOTO_MAX_CHARS, PHOTO_MAX_COUNT, QUEST_GIVER, nextLoginSlot, questErrorMessage } from "@/lib/game/quests/model";
import { fitShot } from "@/lib/game/quests/photo";
import { parseArenaState, parseLoginState, parseQuestState } from "@/lib/game/quests/rpc";
import { SHELL_KINDS, SHELL_PANEL_OF } from "@/lib/game/shell-kinds";
import { QUEST_PANELS, isQuestPanel } from "@/components/game/quests/QuestPanels";

const SQL = readFileSync(join(process.cwd(), "supabase/migrations/0071_quests.sql"), "utf8");

describe("v21 quests — pinned to 0071", () => {
  it("the quest giver", () => {
    expect(SQL).toContain(`values ('${QUEST_GIVER.map}', ${QUEST_GIVER.x}, ${QUEST_GIVER.y}, ${QUEST_GIVER.reach})`);
    const hall = buildHallMap();
    const it = hall.interactables.find((i) => i.kind === "quest_giver");
    expect(it).toBeDefined();
    expect(Math.hypot(it!.use.x - QUEST_GIVER.x, it!.use.y - QUEST_GIVER.y)).toBeLessThan(QUEST_GIVER.reach);
    // the use point is walkable
    const c = Math.floor(it!.use.x / hall.cell), r = Math.floor(it!.use.y / hall.cell);
    expect(hall.blocked[r * hall.cols + c]).toBe(0);
    expect(hall.npcs.some((n) => n.id === "bac_ba_lang")).toBe(true);
  });

  it("the login calendar and album limits", () => {
    expect(SQL).toContain(`array[${LOGIN_REWARDS.join(", ")}]`);
    expect(SQL).toContain(`length(p_data) > ${PHOTO_MAX_CHARS}`);
    expect(SQL).toContain(`>= ${PHOTO_MAX_COUNT} then`);
  });

  it("GameShell handles quest_giver with the quest log", () => {
    expect(SHELL_PANEL_OF.quest_giver).toBe("quests");
    expect(SHELL_KINDS).toContain("quest_giver");
    const shell = readFileSync(join(process.cwd(), "components/game/GameShell.tsx"), "utf8");
    expect(shell).toContain('case "quest_giver":');
    expect(shell).toContain("<QuestPanels ");
    expect(QUEST_PANELS.every(isQuestPanel)).toBe(true);
    expect(isQuestPanel("pet_shop")).toBe(false);
  });
});

describe("v21 quests — pure pieces", () => {
  it("nextLoginSlot", () => {
    expect(nextLoginSlot(0, false)).toBe(1);
    expect(nextLoginSlot(1, false)).toBe(2);
    expect(nextLoginSlot(6, false)).toBe(7);
    expect(nextLoginSlot(7, false)).toBe(1);
    expect(nextLoginSlot(7, true)).toBe(7);
    expect(nextLoginSlot(8, true)).toBe(1);
  });

  it("fitShot picks the biggest shot under the limit", () => {
    const enc = (w: number, _h: number, q: number) => "data:image/jpeg;base64," + "A".repeat(Math.round(w * 300 * q));
    const s = fitShot(1280, 800, enc)!;
    expect(s.dataUrl.length).toBeLessThanOrEqual(PHOTO_MAX_CHARS);
    expect(s.w).toBe(640);
    expect(s.h).toBe(400);
    expect(fitShot(1280, 800, () => "data:image/png;base64,AAAA")).toBeNull();
    expect(fitShot(8, 8, enc)).toBeNull();
  });

  it("parses the quest state and drops unknown rows", () => {
    const s = parseQuestState({
      quests: [
        { id: "d_fish5", cat: "daily", title: "Câu", descr: "", goal: 5, progress: 2, coins: 40, xp: 30, chain: null, status: "active" },
        { id: "x", cat: "bogus", status: "active" },
      ],
      company: { id: 3, title: "Hội", goal: "500", progress: 10, coins: 150, xp: 150, mine: 2, contributors: 4 },
      company_claimable: [{ id: 2, title: "Cũ", coins: 150, xp: 150 }],
      visited: ["hall", "pond", 3],
      paid: 40,
    });
    expect(s.quests).toHaveLength(1);
    expect(s.company?.goal).toBe(500);
    expect(s.companyClaimable[0].id).toBe(2);
    expect(s.visited).toEqual(["hall", "pond"]);
    expect(s.paid).toBe(40);
  });

  it("parses login and arena states", () => {
    const l = parseLoginState({ claimed_today: true, streak: 3, total: 9, rewards: LOGIN_REWARDS, claimed: true, amount: 40, paid: 20, slot: 3 });
    expect(l).toMatchObject({ claimedToday: true, streak: 3, slot: 3, paid: 20 });
    const a = parseArenaState({
      team: { id: "t", name: "Rồng", code: "ABC123", rating: 1016, wins: 1, losses: 0, a: "an", b: "binh", leader: true },
      series: [{ id: "s", status: "live", stake: 100, bout: 2, score_a: 1, score_b: 0, team_a: { id: "t", name: "Rồng" },
                 team_b: { id: "u", name: "Hổ" }, pair: ["binh", "dung"] }, { id: "z", status: "weird" }],
      ranking: [{ id: "t", name: "Rồng", rating: 1016, wins: 1, losses: 0, full: true, a: "an", b: "binh" }],
    });
    expect(a.team?.rating).toBe(1016);
    expect(a.series).toHaveLength(1);
    expect(a.series[0].pair).toEqual(["binh", "dung"]);
  });

  it("error messages", () => {
    expect(questErrorMessage("too far")).toMatch(/bác Ba Làng/);
    expect(questErrorMessage("album full")).toMatch(/24/);
    expect(questErrorMessage("whatever")).toMatch(/lỗi/);
  });
});
