import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import { ringRefusalText } from "@/lib/game/fight/messages";
import { anyOccupied, myCorner, parseRingState, recordText, ringLabel, stakeText, winnings } from "@/lib/game/fight/rings";
import { parseAdminFightLog, parseBoard, parsePushAnswer } from "@/lib/game/fight/rpc";

const fighter = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, style: "karate", idx: 3, rank: 2, wins: 3, losses: 1, draws: 0, ...extra });

describe("the rings' money (owner ruling: a 5 % burned fee)", () => {
  it("the winner takes the pot less 5 %", () => {
    expect(winnings(1000)).toEqual({ pot: 2000, fee: 100, won: 1900 });
    expect(winnings(100)).toEqual({ pot: 200, fee: 10, won: 190 });
    expect(winnings(0)).toEqual({ pot: 0, fee: 0, won: 0 });
    expect(stakeText(0)).toBe("Giao hữu");
    expect(stakeText(5000)).toContain("5");
  });
});

describe("ring_state", () => {
  const raw = {
    server_now_ms: 1000, live_room: 1, live_all: 2, locked_until_ms: null, config: { fee_pct: 5 },
    rings: [
      { ring: 2, v: 7, red: fighter("a", "Lan"), blue: fighter("b", "Hùng", { style: "judo", idx: 6 }), red_since_ms: 5, blue_since_ms: 6,
        offer: { stake: 500, by: 1, v: 3, at_ms: 900, red_ok: true, blue_ok: false, red_n: 3, blue_n: null }, match: null },
      { ring: 1, v: 1, red: null, blue: null, offer: null, match: null },
      { ring: 3, v: 2, red: fighter("c", "Tí"), blue: fighter("d", "Tèo"), offer: null,
        match: { id: "m", status: "live", stake: 1000, started_at_ms: 1, round: 2, phase: 1, w1: 1, w2: 0 } },
      { ring: 4, v: 0, red: null, blue: fighter("e", "Bé"), offer: null, match: null },
      { ring: 9 },
    ],
    mine: { id: "m", room_id: "r", ring: 3, side: 1, params: { seed: 1, delay: 4 }, stake: 1000, started_at_ms: 1, foe: fighter("d", "Tèo") },
    refused: "not enough xu", who: "blue",
  };

  it("parses rings in order, the offer, the match, mine and a refusal", () => {
    const s = parseRingState(raw)!;
    expect(s.rings.map((r) => r.ring)).toEqual([1, 2, 3, 4]);
    expect(s.rings[1].offer).toEqual({ stake: 500, by: 1, v: 3, atMs: 900, redOk: true, blueOk: false, redN: 3, blueN: null });
    expect(s.rings[2].match).toMatchObject({ id: "m", round: 2, w1: 1, w2: 0, stake: 1000 });
    expect(s.mine).toMatchObject({ id: "m", ring: 3, side: 1, stake: 1000, roomId: "r", foe: { name: "Tèo" } });
    expect(s).toMatchObject({ refused: "not enough xu", who: "blue", liveRoom: 1, liveAll: 2, feePct: 5, match: null });
    expect(parseRingState({ rings: [] })).toBeNull();
    expect(anyOccupied(s)).toBe(true);
    expect(anyOccupied(parseRingState({ server_now_ms: 1, rings: [{ ring: 1 }] }))).toBe(false);
  });

  it("finds my corner and labels the rings for bystanders", () => {
    const s = parseRingState(raw)!;
    expect(myCorner(s, "b")).toMatchObject({ ring: 2, corner: "blue" });
    expect(myCorner(s, "zz")).toBeNull();
    expect(s.rings.map(ringLabel)).toEqual([
      null,
      "Lan ⚔ Hùng · 500 xu?".replace("500 xu", stakeText(500)),
      `⚔️ Hiệp 2 · 1–0 · ${stakeText(1000)}`,
      "Góc Xanh: Bé · chờ đối thủ",
    ]);
    expect(recordText(s.rings[1].red!)).toBe("3 thắng · 1 thua · 0 hòa");
  });

  it("a refusal names whose side it concerns", () => {
    expect(ringRefusalText("not enough xu", "blue", "red")).toBe("Đối thủ không đủ xu cho mức cược này.");
    expect(ringRefusalText("not enough xu", "red", "red")).toBe("Bạn không đủ xu cho mức cược này.");
    expect(ringRefusalText("too hungry to fight", "blue", "red")).toMatch(/^Đối thủ: đói quá/);
    expect(ringRefusalText("ring busy", null, "red")).toContain("Sàn đang bận");
  });
});

describe("PvP answers", () => {
  it("a void result, the seen frontier, a claim", () => {
    const p = parsePushAnswer({
      status: "void", side: 2, sim_frame: 30, frontiers: [40, 50], seen: [10, 44], server_now_ms: 5, claimed: false, wait_ms: 1200,
      result: { winner: null, void: true, end_reason: "abandon", rounds: [], rounds_played: 0, vitals: { hunger: 0, thirst: 0 },
        pvp: { stake: 500, pot: 1000, fee: 0, won: 0, refund: 500 } },
    })!;
    expect(p).toMatchObject({ frontier: 50, seenFrontier: 44, claimed: false, waitMs: 1200 });
    expect(p.result).toMatchObject({ void: true, winner: 0, endReason: "abandon", pvp: { stake: 500, won: 0, records: null } });
    const won = parsePushAnswer({ status: "done", side: 1, server_now_ms: 1, result: { winner: 1, end_reason: "ko", rounds: [],
      pvp: { stake: 1000, pot: 2000, fee: 100, won: 1900, records: { 1: { wins: 2, losses: 0, draws: 1 }, 2: { wins: 0, losses: 3, draws: 0 } } } } })!;
    expect(won.result!.pvp).toEqual({ stake: 1000, pot: 2000, fee: 100, won: 1900, records: { 1: { wins: 2, losses: 0, draws: 1 }, 2: { wins: 0, losses: 3, draws: 0 } } });
    expect(won.result!.void).toBeUndefined();
  });

  it("the board and the admin log", () => {
    expect(parseBoard({ rows: [{ name: "Lan", wins: 3, losses: 1, draws: 0 }, {}] })).toEqual([
      { name: "Lan", wins: 3, losses: 1, draws: 0 }, { name: "?", wins: 0, losses: 0, draws: 0 },
    ]);
    const l = parseAdminFightLog({ id: "m", status: "disputed", params: { seed: 1 }, p1: "A", p2: "B", sim_frame: 120,
      logs: [{ side: 1, runs: [0, 120], frontier: 119, seen_runs: null, seen_frontier: null, stall_frames: 3, bad_hashes: 0 }],
      conflicts: [{ reporter: "B", reported: "A", from_frame: 50, to_frame: 119 }] })!;
    expect(l.logs[0]).toMatchObject({ runs: [0, 120], seenRuns: [], frontier: 119 });
    expect(l.conflicts).toEqual([{ reporter: "B", reported: "A", fromFrame: 50, toFrame: 119 }]);
  });
});
