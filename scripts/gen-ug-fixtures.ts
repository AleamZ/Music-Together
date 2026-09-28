// Builds tests/fixtures/ug-boss-cases.json (v20.4, ruling R1): bot-ladder matches against the bosses of floors 1, 5 and 10
// (Trùm Hầm changes style each round: the engine's styleByRound), recorded from the TS with scripts/gen-dojo-fixtures.ts's
// player agents and replayed by 0052's _fx_new / _fx_reset in tests/sql/v20-4-smoke.sql.
//   WRITE_UG_FIXTURES=1 pnpm vitest run tests/unit/ug-fixtures.test.ts

import { bossMatchParams } from "@/lib/game/fight/underground";
import { botCase, shadowBot, type BotCase } from "./gen-dojo-fixtures";

export function buildBossCases(): BotCase[] {
  const idle = () => 0;
  return [
    botCase("floor1-strong", bossMatchParams(1, { style: 1, rank: 2 }, 1001), "p1", shadowBot(0, 8, 41)),
    botCase("floor5-middling", bossMatchParams(5, { style: 3, rank: 3 }, 1005), "p1", shadowBot(0, 5, 42)),
    botCase("floor10-strong", bossMatchParams(10, { style: 2, rank: 4 }, 1010), "p1", shadowBot(0, 8, 43)),
    botCase("floor10-idle", bossMatchParams(10, { style: 6, rank: 2 }, 1011), "p1", idle),
  ];
}