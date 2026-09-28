// v20.4 Khu bí mật + giải ngầm: the underground's rules as the client shows them (spec §v20.4, plan
// docs/superpowers/plans/2026-09-28-v20-4-underground.md rulings U1–U18). 0052_underground.sql is authoritative: the
// rating is computed there only; tests/unit/fight-ug-sql.test.ts pins these numbers (bosses, tiers, clocks, limits)
// against it. Pure.

import { fighterParams, makeParams, type MatchParams } from "./engine";
import { styleId, type StyleKey } from "./styles";

// ---------- entries and limits ----------
/** Kèo ngầm entry tiers (xu), held at join (ledger ug_entry). */
export const QUEUE_TIERS = [500, 2000, 5000] as const;
/** Giải đêm entry tiers. */
export const CUP_TIERS = [1000, 5000] as const;
/** The burned fee on every pot moved between players (owner ruling; plan ruling U1). */
export const UG_FEE_PCT = 5;
/** Per account per VN day: rated matches, ladder attempts, cups; rated matches per pair per day. */
export const RATED_DAY = 10;
export const PAIR_DAY = 2;
export const LADDER_DAY = 6;
export const CUPS_DAY = 3;
/** A pair's 4th and later rated meetings in 7 days move rating × 0.5. */
export const PAIR_HALF_AFTER = 3;
/** The queue gives up (and refunds) after this long; a called pair has READY_MS to press "Sẵn sàng" (a cup match
 *  CUP_READY_MS); a cup that has not filled in CUP_FILL_MS refunds everyone. */
export const QUEUE_TIMEOUT_MS = 5 * 60_000;
export const READY_MS = 30_000;
export const CUP_READY_MS = 60_000;
export const CUP_FILL_MS = 15 * 60_000;
/** Frame 0 comes this long after both pressed "Sẵn sàng"; a ladder match's frame 0 this long after it starts. */
export const UG_START_DELAY_S = 3;
export const LADDER_START_DELAY_S = 8;
/** Polls of ug_status: while queued (or signed up), and while a match of mine is called. */
export const UG_POLL_MS = 5000;
export const UG_CALLED_POLL_MS = 1000;

// ---------- spectating ----------
/** A spectator runs this many frames behind the newest frame both logs cover. */
export const SPECTATE_BUFFER = 30;
/** Clients stop joining a match topic once its presence shows this many spectators. */
export const SPECTATOR_CAP = 6;
/** "E · Xem trận" within this many px of the cage. */
export const CAGE_RANGE = 64;

// ---------- rating ----------
export const RATING_START = 1000;
export const RATING_FLOOR = 800;
export const K_NEW = 40;
export const K_SETTLED = 24;
/** K is K_NEW for a player's first this-many rated matches. */
export const K_NEW_MATCHES = 10;

export type TierKey = "tep_riu" | "ca_ro" | "ca_loc" | "ca_map" | "thuy_quai";
export interface Tier { key: TierKey; name: string; icon: string; min: number }
export const TIERS: readonly Tier[] = [
  { key: "tep_riu", name: "Tép riu", icon: "🦐", min: -Infinity },
  { key: "ca_ro", name: "Cá rô", icon: "🐟", min: 1100 },
  { key: "ca_loc", name: "Cá lóc", icon: "🐠", min: 1250 },
  { key: "ca_map", name: "Cá mập", icon: "🦈", min: 1400 },
  { key: "thuy_quai", name: "Thủy quái", icon: "🐉", min: 1550 },
];

export function tierOf(rating: number): Tier {
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}

export const kFor = (rated: number): number => (rated < K_NEW_MATCHES ? K_NEW : K_SETTLED);

/** Rounds half away from zero, as PostgreSQL's round(numeric) does. */
const roundSql = (v: number): number => Math.sign(v) * Math.round(Math.abs(v));

/** My rating change: score 1 / 0.5 / 0, my K, the pair factor (0.5 on the pair rule). */
export function eloDelta(mine: number, theirs: number, score: number, k: number, f = 1): number {
  const expected = 1 / (1 + 10 ** ((theirs - mine) / 400));
  return roundSql(k * f * (score - expected));
}

// ---------- seasons ----------
export const SEASON_EPOCH = "2026-10-01";
export const SEASON_DAYS = 28;

/** The season (0-based) of a VN day "YYYY-MM-DD": 28-day seasons from SEASON_EPOCH, season 0 before it. */
export function seasonOf(vnDay: string): number {
  const days = Math.round((Date.parse(`${vnDay}T00:00:00Z`) - Date.parse(`${SEASON_EPOCH}T00:00:00Z`)) / 86_400_000);
  return Math.trunc(Math.max(0, days) / SEASON_DAYS);
}

/** A new season's rating: halfway back to 1 000 (never under the floor). */
export const softReset = (r: number): number => Math.max(RATING_FLOOR, RATING_START + Math.trunc((r - RATING_START) / 2));

export type TitleKind = "thuy_quai" | "trum_ham";
export const seasonTitle = (kind: TitleKind, season: number): string =>
  `${kind === "thuy_quai" ? "Thủy quái" : "Trùm hầm"} mùa ${season + 1}`;

// ---------- pots ----------
const feeOf = (pot: number): number => Math.floor((pot * UG_FEE_PCT) / 100);

export function ratedWin(entry: number): { pot: number; fee: number; won: number } {
  const pot = 2 * entry, fee = feeOf(pot);
  return { pot, fee, won: pot - fee };
}

export function cupPayout(entry: number): { pot: number; fee: number; pool: number; champion: number; runnerUp: number } {
  const pot = 4 * entry, fee = feeOf(pot), pool = pot - fee, champion = Math.floor((pool * 70) / 100);
  return { pot, fee, pool, champion, runnerUp: pool - champion };
}

export const noShowPay = (entry: number): number => entry - feeOf(entry);

// ---------- the queue and the cup ----------
/** The rating window after waiting `waitedMs` in the queue. */
export const windowFor = (waitedMs: number): number => Math.min(400, 150 + 50 * Math.floor(Math.max(0, waitedMs) / 15_000));

/** The cup's draw: seeds by rating (ties by account id), semifinals 1 v 4 and 2 v 3. */
export function seedBracket(entries: readonly { id: string; rating: number }[]): { seeds: string[]; semis: [string, string][] } {
  const seeds = [...entries].sort((a, b) => b.rating - a.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((e) => e.id);
  return { seeds, semis: [[seeds[0], seeds[3]], [seeds[1], seeds[2]]] };
}

// ---------- the bot ladder ----------
export interface Boss {
  floor: number;
  name: string;
  style: StyleKey;
  level: number;
  hpPct: number;
  entry: number;
  /** The first clear of the season (half the spec's figure: owner ruling). */
  prize: number;
  styleByRound?: readonly StyleKey[];
  /** A one-line taunt in the panel. */
  line: string;
}

export const BOSSES: readonly Boss[] = [
  { floor: 1, name: "Cu Tí Lì Lợm", style: "boxing", level: 1, hpPct: 100, entry: 100, prize: 200, line: "Nhỏ con mà lì đòn." },
  { floor: 2, name: "Bảy Chợ Cá", style: "vovinam", level: 2, hpPct: 100, entry: 200, prize: 350, line: "Tay quen vác thúng cá." },
  { floor: 3, name: "Mèo Muay", style: "muaythai", level: 3, hpPct: 100, entry: 300, prize: 500, line: "Chỏ gối nhanh như mèo vồ." },
  { floor: 4, name: "Hắc Đai Lùn", style: "karate", level: 4, hpPct: 105, entry: 500, prize: 750, line: "Thấp mà cứng như gạch." },
  { floor: 5, name: "Cước Phong", style: "taekwondo", level: 5, hpPct: 105, entry: 800, prize: 1200, line: "Chân nhanh hơn gió." },
  { floor: 6, name: "Găng Đồng", style: "boxing", level: 5, hpPct: 110, entry: 1000, prize: 1500, line: "Găng nặng như đồng." },
  { floor: 7, name: "Gấu Quật", style: "judo", level: 6, hpPct: 115, entry: 1500, prize: 2250, line: "Ôm được là quật." },
  { floor: 8, name: "Mộc Nhân", style: "vinhxuan", level: 7, hpPct: 115, entry: 2000, prize: 3000, line: "Đứng yên như cọc gỗ." },
  { floor: 9, name: "Ba Mù", style: "karate", level: 7, hpPct: 125, entry: 3000, prize: 4500, line: "Không nhìn vẫn đánh trúng." },
  {
    floor: 10, name: "Trùm Hầm", style: "muaythai", level: 8, hpPct: 130, entry: 5000, prize: 7500,
    styleByRound: ["muaythai", "judo", "vinhxuan", "muaythai", "judo"], line: "Mỗi hiệp một môn võ.",
  },
];

export const bossOf = (floor: number): Boss | null => BOSSES.find((b) => b.floor === floor) ?? null;

/** The prize of a win on `floor`: the full prize on the season's first clear, else 10 %. */
export function ladderPrize(floor: number, firstClear: boolean): number {
  const b = bossOf(floor);
  if (!b) return 0;
  return firstClear ? b.prize : Math.floor(b.prize / 10);
}

/** A ladder match's params as 0052's ug_ladder_start builds them: me (red) at my rank's unlocks, the boss (blue) at
 *  rank 4 with every special, its HP and bot level (and its style list on floor 10); 3 rounds. */
export function bossMatchParams(floor: number, me: { style: number; rank: number }, seed: number): MatchParams {
  const b = bossOf(floor);
  if (!b) throw new Error(`no floor ${floor}`);
  const more: Parameters<typeof fighterParams>[2] = { hpPct: b.hpPct, bot: b.level };
  if (b.styleByRound) more.styleByRound = b.styleByRound.map(styleId);
  return makeParams(fighterParams(me.style, me.rank), fighterParams(styleId(b.style), 4, more), { seed, rounds: 3, maxRounds: 5 });
}
