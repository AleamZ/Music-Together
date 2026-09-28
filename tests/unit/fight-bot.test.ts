import { describe, expect, it } from "vitest";
import { BOT_LEVELS, botInput, recordBots, stepWithBots } from "@/lib/game/fight/bot";
import {
  BOT_DUMMY, F_MOVE, G_PHASE, G_RESULT, PH_OVER, createMatch, curMove, fb, fighterParams, hash, makeParams, roundResults,
  runFrames, type State,
} from "@/lib/game/fight/engine";
import { encodeRuns } from "@/lib/game/fight/log";
import { M_SLOT, mv } from "@/lib/game/fight/moves";

const bot = (level: number, style = 0, rank = 0, en0 = 0) => fighterParams(style, rank, { bot: level, en0 });

function runBots(p: ReturnType<typeof makeParams>, n: number, each?: (s: State) => void): State {
  let s = createMatch(p);
  for (let k = 0; k < n && s[G_PHASE] !== PH_OVER; k++) {
    s = stepWithBots(s, 0, 0);
    each?.(s);
  }
  return s;
}

describe("fight bot", () => {
  it("has the spec's level table", () => {
    expect(BOT_LEVELS.slice(1).map((l) => l?.d)).toEqual([24, 20, 16, 13, 11, 9, 8, 7]);
    expect(BOT_LEVELS[8]).toMatchObject({ block: 82, aa: 88, special: 45, tech: 70 });
  });

  it("level 1 never uses a Tuyệt kỹ, even at full energy", () => {
    let supers = 0;
    runBots(makeParams(bot(1, 3, 4, 1000), bot(3, 5, 4, 1000), { seed: 5 }), 12_000, (s) => {
      const id = curMove(s, fb(0));
      if (id >= 0 && mv(id, M_SLOT) === 5) supers++;
    });
    expect(supers).toBe(0);
  });

  it("level 8 knocks out the standing dummy within one round", () => {
    const s = runBots(makeParams(bot(8), bot(BOT_DUMMY), { seed: 11, rounds: 1 }), 90 + 5940 + 150);
    expect(s[G_PHASE]).toBe(PH_OVER);
    expect(s[G_RESULT]).toBe(1);
    expect(roundResults(s)[0].reason).toBe(1);
  });

  it("the dummy never acts", () => {
    let s = createMatch(makeParams(bot(BOT_DUMMY), bot(BOT_DUMMY)));
    for (let k = 0; k < 400; k++) {
      expect(botInput(s.slice(), 0)).toBe(0);
      s = stepWithBots(s, 0, 0);
    }
    expect(s[fb(0) + F_MOVE]).toBe(0);
  });

  it("is deterministic per seed, and its recorded inputs replay to the same fight", () => {
    const p = makeParams(bot(5, 1, 4), bot(4, 2, 3), { seed: 77 });
    const a = runBots(p, 3000), b = runBots(p, 3000);
    expect(hash(a)).toBe(hash(b));
    const c = runBots({ ...p, seed: 78 }, 3000);
    expect(hash(c)).not.toBe(hash(a));
    // the logs a bot match produced, replayed as plain inputs, give the same fight (bots write only their own memory)
    const rec = recordBots(createMatch(p), 3000);
    const plain = makeParams({ ...p.p1, bot: 0 }, { ...p.p2, bot: 0 }, { seed: 77 });
    const replay = runFrames(createMatch(plain), encodeRuns(rec.masks[0]), encodeRuns(rec.masks[1]), 3000);
    expect(roundResults(replay)).toEqual(roundResults(rec.state));
    expect(replay[fb(0) + 5]).toBe(rec.state[fb(0) + 5]);
    expect(replay[fb(1) + 5]).toBe(rec.state[fb(1) + 5]);
  });
});
