// v21 "world" (0075): the pure half — the static tables the SQL owns (tests/unit/world-sql.test.ts pins them equal),
// the wander path of a wild animal, the VN day/night and a few geometry checks. Display only: every outcome is the
// server's.
import type { MapId } from "../maps/types";
import type { Vec } from "../types";

export type WildSpeciesId = "rabbit" | "bird" | "deer" | "fox" | "wolf" | "bear" | "firefly"
  // 0097 (forest-content): the rừng tràm's own — three for the pot, three for the album only (protected)
  | "chuot_dong" | "ga_rung" | "ran_ri_ca" | "cay_huong" | "co_trang" | "rua_hop_lung_den";
export type WildAction = "hunt" | "trap" | "photo";

export interface WildSpecies {
  id: WildSpeciesId;
  name: string;
  active: "day" | "night" | "any";
  maps: Array<MapId | "wild">;
  weight: number;
  /** % a hunt succeeds (0: cannot). */
  hunt: number;
  /** % a trap succeeds (0: cannot). */
  trap: number;
  /** % a failed hunt at night faints you (> 0 also knocks you back). */
  danger: number;
  /** null: photo only. */
  drop: WildItemId | null;
  dropMin: number;
  dropMax: number;
  radius: number;
  xp: number;
}

export const WILD_SPECIES: readonly WildSpecies[] = [
  { id: "rabbit", name: "Thỏ rừng", active: "any", maps: ["field", "pond", "bai_dat"], weight: 30, hunt: 70, trap: 85, danger: 0, drop: "thit_tho", dropMin: 1, dropMax: 2, radius: 40, xp: 6 },
  { id: "bird", name: "Chim sẻ", active: "day", maps: ["field", "pond"], weight: 25, hunt: 35, trap: 60, danger: 0, drop: "long_vu", dropMin: 1, dropMax: 3, radius: 60, xp: 5 },
  { id: "deer", name: "Hươu sao", active: "day", maps: ["field", "bai_dat"], weight: 14, hunt: 45, trap: 0, danger: 0, drop: "sung_huou", dropMin: 1, dropMax: 1, radius: 50, xp: 12 },
  { id: "fox", name: "Cáo", active: "night", maps: ["field", "bai_dat"], weight: 18, hunt: 45, trap: 70, danger: 0, drop: "da_cao", dropMin: 1, dropMax: 1, radius: 45, xp: 10 },
  { id: "wolf", name: "Sói xám", active: "night", maps: ["field", "bai_dat"], weight: 14, hunt: 40, trap: 0, danger: 10, drop: "da_soi", dropMin: 1, dropMax: 1, radius: 55, xp: 16 },
  { id: "bear", name: "Gấu đen", active: "night", maps: ["bai_dat"], weight: 6, hunt: 25, trap: 0, danger: 20, drop: "vuot_gau", dropMin: 1, dropMax: 2, radius: 35, xp: 24 },
  { id: "firefly", name: "Đom đóm", active: "night", maps: ["pond", "field"], weight: 22, hunt: 0, trap: 90, danger: 0, drop: "dom_dom", dropMin: 1, dropMax: 3, radius: 30, xp: 4 },
  { id: "chuot_dong", name: "Chuột đồng", active: "any", maps: ["wild"], weight: 26, hunt: 85, trap: 80, danger: 0, drop: "thit_chuot_dong", dropMin: 1, dropMax: 2, radius: 35, xp: 5 },
  { id: "ga_rung", name: "Gà rừng", active: "day", maps: ["wild"], weight: 14, hunt: 80, trap: 60, danger: 0, drop: "thit_ga_rung", dropMin: 1, dropMax: 2, radius: 50, xp: 12 },
  { id: "ran_ri_ca", name: "Rắn ri cá", active: "any", maps: ["wild"], weight: 10, hunt: 75, trap: 0, danger: 0, drop: "thit_ran_ri_ca", dropMin: 1, dropMax: 1, radius: 30, xp: 14 },
  { id: "cay_huong", name: "Cầy hương", active: "night", maps: ["wild"], weight: 8, hunt: 0, trap: 0, danger: 0, drop: null, dropMin: 0, dropMax: 0, radius: 45, xp: 8 },
  { id: "co_trang", name: "Cò trắng", active: "day", maps: ["wild"], weight: 12, hunt: 0, trap: 0, danger: 0, drop: null, dropMin: 0, dropMax: 0, radius: 60, xp: 6 },
  { id: "rua_hop_lung_den", name: "Rùa hộp lưng đen", active: "any", maps: ["wild"], weight: 3, hunt: 0, trap: 0, danger: 0, drop: null, dropMin: 0, dropMax: 0, radius: 15, xp: 20 },
];
/** 0097: an animal only the camera may take (protected). */
export const photoOnly = (sp: WildSpecies): boolean => sp.hunt === 0 && sp.trap === 0;

export type WildItemId = "thit_tho" | "long_vu" | "sung_huou" | "da_cao" | "da_soi" | "vuot_gau" | "dom_dom"
  | "thit_chuot_dong" | "thit_ga_rung" | "thit_ran_ri_ca";
export const WILD_ITEMS: Readonly<Record<WildItemId, { name: string; icon: string; price: number }>> = {
  thit_tho: { name: "Thịt thỏ", icon: "🍖", price: 25 },
  long_vu: { name: "Lông vũ", icon: "🪶", price: 12 },
  sung_huou: { name: "Sừng hươu", icon: "🦌", price: 90 },
  da_cao: { name: "Da cáo", icon: "🦊", price: 70 },
  da_soi: { name: "Da sói", icon: "🐺", price: 120 },
  vuot_gau: { name: "Vuốt gấu", icon: "🐾", price: 220 },
  dom_dom: { name: "Hũ đom đóm", icon: "✨", price: 15 },
  thit_chuot_dong: { name: "Thịt chuột đồng", icon: "🍖", price: 35 },   // 0097
  thit_ga_rung: { name: "Thịt gà rừng", icon: "🍗", price: 85 },
  thit_ran_ri_ca: { name: "Thịt rắn ri cá", icon: "🥩", price: 100 },
};
export const isWildItem = (v: unknown): v is WildItemId => typeof v === "string" && Object.hasOwn(WILD_ITEMS, v);
/** The night market pays 30 % more (integer division as in the SQL). */
export const sellPrice = (item: WildItemId, qty: number, night: boolean): number =>
  night ? Math.floor((WILD_ITEMS[item].price * qty * 13) / 10) : WILD_ITEMS[item].price * qty;

export const WILD_AREAS: ReadonlyArray<{ map: MapId; x: number; y: number; w: number; h: number }> = [
  { map: "field", x: 60, y: 48, w: 600, h: 22 }, { map: "field", x: 60, y: 448, w: 440, h: 20 },
  { map: "pond", x: 500, y: 60, w: 110, h: 280 }, { map: "pond", x: 20, y: 60, w: 70, h: 280 },
  { map: "bai_dat", x: 100, y: 215, w: 600, h: 30 }, { map: "bai_dat", x: 700, y: 60, w: 40, h: 300 },
];
/** 0096/0097 _wild_cap: the animals live in the rừng tràm only (the wild; Rừng tràm, the 2D window, shares them). */
export const WILD_CAP: Readonly<Record<string, number>> = { wild: 24, rung_tram: 24 };

export const speciesOf = (id: string): WildSpecies | null => WILD_SPECIES.find((s) => s.id === id) ?? null;

/** Where an animal is `tSec` seconds after it spawned (the SQL's _wild_xy). */
export function wildXY(hx: number, hy: number, seed: number, radius: number, tSec: number): Vec {
  return {
    x: hx + radius * Math.sin((tSec * 2 * Math.PI) / (20 + (seed % 13)) + (seed % 628) / 100),
    y: hy + radius * 0.6 * Math.sin((tSec * 2 * Math.PI) / (27 + (seed % 11)) + (seed % 314) / 50),
  };
}

/** Reach of the actions, as the server checks it (px from my server position to the animal). */
export const ACT_RANGE: Readonly<Record<WildAction, number>> = { hunt: 64, trap: 64, photo: 140 };

/** 18:00–06:00 VN (UTC+7, no DST) is night. */
export function isNightVN(ms: number): boolean {
  const h = Math.floor(((ms / 3_600_000 + 7) % 24 + 24) % 24);
  return h >= 18 || h < 6;
}

// ---------------------------------------------------------------- places on Bãi đất trống
/** The hunter's stall (by night: the night market). */
export const STALL = { map: "bai_dat" as MapId, x: 460, y: 56 };
/** The dungeon's gate. */
export const GATE = { map: "bai_dat" as MapId, x: 60, y: 120 };
export const NEAR_PX = 48;
export const near = (map: MapId, p: Vec | null, at: { map: MapId; x: number; y: number }, r = NEAR_PX): boolean =>
  p !== null && map === at.map && Math.hypot(p.x - at.x, p.y - at.y) <= r;

// ---------------------------------------------------------------- bosses
export type BossId = "trau_tinh" | "soi_ma" | "heo_rung" | "thuy_quai" | "nguoi_tuyet";
export interface BossDef {
  id: BossId; name: string; kind: "world" | "night" | "raid" | "weather" | "snow"; map: MapId;
  arena: { x: number; y: number; w: number; h: number }; hp: number; capPct: number; pool: number; durMin: number; xp: number;
}
const ARENA_BAI = { x: 316, y: 60, w: 168, h: 316 };
const ARENA_POND = { x: 490, y: 60, w: 140, h: 300 };
export const BOSS_DEFS: readonly BossDef[] = [
  { id: "trau_tinh", name: "Trâu Tinh", kind: "world", map: "bai_dat", arena: ARENA_BAI, hp: 40000, capPct: 20, pool: 3000, durMin: 30, xp: 120 },
  { id: "soi_ma", name: "Sói Ma", kind: "night", map: "bai_dat", arena: ARENA_BAI, hp: 30000, capPct: 25, pool: 2000, durMin: 30, xp: 100 },
  { id: "heo_rung", name: "Vua Heo Rừng", kind: "raid", map: "bai_dat", arena: ARENA_BAI, hp: 24000, capPct: 25, pool: 1200, durMin: 20, xp: 90 },   // econ v2 (0104)
  { id: "thuy_quai", name: "Thủy Quái", kind: "weather", map: "pond", arena: ARENA_POND, hp: 15000, capPct: 34, pool: 900, durMin: 20, xp: 70 },
  { id: "nguoi_tuyet", name: "Người Tuyết", kind: "snow", map: "pond", arena: ARENA_POND, hp: 15000, capPct: 34, pool: 900, durMin: 20, xp: 70 },
];
export const BOSS_SCHEDULE: ReadonlyArray<{ boss: BossId; at: string }> = [
  { boss: "trau_tinh", at: "12:00" }, { boss: "trau_tinh", at: "20:00" }, { boss: "soi_ma", at: "22:00" },
];
export const bossDef = (id: string): BossDef | null => BOSS_DEFS.find((b) => b.id === id) ?? null;
/** Economy v2 (0104 _boss_payout): a raid or a weather boss (rain or snow) pays an account's share of the pool for this many
 *  kills a Vietnam day; after that the hitter gets the XP only. The scheduled world and night bosses are not capped. */
export const BOSS_PAID_PER_DAY = 2;
export const bossPaidCapped = (kind: BossDef["kind"]): boolean => kind === "raid" || kind === "weather" || kind === "snow";
/** The line after a kill: how the reward is shared (and the daily cap, where there is one). */
export function bossRewardNote(id: string): string {
  const d = bossDef(id);
  return d && bossPaidCapped(d.kind)
    ? `Phần thưởng chia theo công sức (mỗi ngày chỉ ${BOSS_PAID_PER_DAY} trận ${d.kind === "raid" ? "boss tổ đội" : "boss mưa/tuyết"} có xu, sau đó chỉ có kinh nghiệm).`
    : "Phần thưởng chia theo công sức.";
}
/** The raid arena (where the party summons Vua Heo Rừng). */
export const RAID_ARENA = { map: "bai_dat" as MapId, ...ARENA_BAI };
/** In the arena, with the server's 16 px margin. */
export const inArena = (map: MapId, p: Vec | null, a: { map: MapId; x: number; y: number; w: number; h: number }): boolean =>
  p !== null && map === a.map && p.x >= a.x - 16 && p.x <= a.x + a.w + 16 && p.y >= a.y - 16 && p.y <= a.y + a.h + 16;

// ---------------------------------------------------------------- the attack rhythm (boss and dungeon)
/** A strike sooner than this is refused. */
export const COOLDOWN_MS = 900;
/** A strike 0.9–2 s after the last builds the combo (up to 5, +15 % each). */
export const RHYTHM_MS = 2000;
export const MAX_COMBO = 5;
/** Where the beat is: "wait" (cooling down), "beat" (in the combo window), "late" (the combo would reset). */
export function beat(sinceMs: number): "wait" | "beat" | "late" {
  if (sinceMs < COOLDOWN_MS) return "wait";
  return sinceMs <= RHYTHM_MS ? "beat" : "late";
}

// ---------------------------------------------------------------- the dungeon
/** Economy v2 (0104 _dg_pay_fee; was 150). */
export const DUNGEON_FEE = 100;
/** The cleared runs a day that pay (0104 _dg_payout; was 5). */
export const DUNGEON_PAID_PER_DAY = 3;
/** What a clear pays a member (0104 _dg_payout): DUNGEON_BASE + floor(DUNGEON_POT × n × share) — n the members this clear
 *  pays (the fee paid, some damage, under the day's cap), share the member's part of the damage. Equal hitters earn the same
 *  in any party. */
export const DUNGEON_BASE = 50;
export const DUNGEON_POT = 250;
export const dungeonReward = (nPaid: number, share: number): number => DUNGEON_BASE + Math.floor(DUNGEON_POT * nPaid * share);
export const DUNGEON_ROOMS: ReadonlyArray<{ room: number; mob: string; name: string; hp: number; n: number }> = [
  { room: 1, mob: "doi", name: "Dơi hang", hp: 300, n: 3 },
  { room: 2, mob: "ran", name: "Rắn hang", hp: 450, n: 3 },
  { room: 3, mob: "nhen", name: "Nhện độc", hp: 700, n: 2 },
  { room: 4, mob: "doi_chua", name: "Dơi Chúa", hp: 3000, n: 1 },
];
export const PARTY_MAX = 4;
