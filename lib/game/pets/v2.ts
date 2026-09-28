// v21 Pets v2 + combat pets + battle fish + the aquarium: a display copy of 0074_pets_aquarium.sql (authoritative — the
// server rolls the eggs, resolves the turns and pays; the client only picks a skill per turn). tests/unit/pets-v2.test.ts
// pins these literals to the SQL.
import { supabase } from "@/lib/supabase";
import type { PetSpecies } from "./catalog";
import { parsePetsState, type PetsState } from "./rpc";

// ---------------------------------------------------------------- rules (0074's _pv2 and friends)

export const GACHA_PRICE = 1500;
/** The 40th egg without a Legendary or better is one. */
export const GACHA_PITY = 40;
export const MAX_PETS_V2 = 12;
export const MAX_LEVEL = 50;
/** Care + follow XP per Vietnam day. */
export const DAY_XP = 300;
export const MAX_FISH_FIGHTERS = 6;
/** A fish of at least this rarity can be kept as a fighter. */
export const FISH_FIGHTER_RARITY = 3;
export const PVE_PER_DAY = 40;
export const PVE_PAID_WINS = 10;
export const MAX_STAKE = 1000;
export const MAX_DECOR = 4;
export const MAX_TURNS = 30;
export const PAT_COOLDOWN_S = 60;
export const TRAIN_COOLDOWN_S = 20;
/** The PvP pot goes to the winner less this share. */
export const PVP_CUT = 0.1;

export const xpNeed = (level: number): number => 20 * level;
export const trainCost = (points: number): number => 100 + 50 * points;
export const trainCap = (level: number): number => Math.min(30, 5 + level);

/** Evolution to the next form: level and affection needed (null: already at form 2). */
export function evolveNeeds(form: number): { level: number; affection: number } | null {
  if (form === 0) return { level: 10, affection: 40 };
  if (form === 1) return { level: 25, affection: 80 };
  return null;
}

export interface Rarity { tier: number; name: string; color: string; odds: number }
/** The egg machine's odds (0074 _gacha_tier). */
export const RARITIES: readonly Rarity[] = [
  { tier: 1, name: "Thường", color: "#8a8a8a", odds: 0.60 },
  { tier: 2, name: "Hiếm", color: "#3d86a8", odds: 0.27 },
  { tier: 3, name: "Sử thi", color: "#8a4ab0", odds: 0.10 },
  { tier: 4, name: "Huyền thoại", color: "#e0a020", odds: 0.025 },
  { tier: 5, name: "Thần thoại", color: "#d9362b", odds: 0.005 },
];
export const rarityOf = (tier: number): Rarity => RARITIES[Math.min(5, Math.max(1, tier)) - 1];
/** The species an egg of that tier can hatch (tiers 4–5: any). */
export const GACHA_POOLS: Readonly<Record<number, readonly PetSpecies[]>> = {
  1: ["hamster", "tho"], 2: ["soc", "meo"], 3: ["cho", "vet"],
  4: ["hamster", "tho", "soc", "meo", "cho", "vet"], 5: ["hamster", "tho", "soc", "meo", "cho", "vet"],
};
export const FORM_NAMES = ["Thường", "Tiến hóa", "Tối thượng"] as const;

// ---------------------------------------------------------------- skills, NPCs, decor

export type SkillKind = "hit" | "guard" | "heal";
export interface Skill { id: string; name: string; kind: SkillKind; power: number; acc: number; minLevel: number; minForm: number; price: number; who: "pet" | "fish" | "both" }
export const SKILLS: readonly Skill[] = [
  { id: "tackle", name: "Húc", kind: "hit", power: 10, acc: 100, minLevel: 1, minForm: 0, price: 0, who: "both" },
  { id: "splash", name: "Quẫy nước", kind: "hit", power: 14, acc: 95, minLevel: 1, minForm: 0, price: 0, who: "fish" },
  { id: "guard", name: "Thủ thế", kind: "guard", power: 0, acc: 100, minLevel: 2, minForm: 0, price: 250, who: "both" },
  { id: "bite", name: "Cắn", kind: "hit", power: 16, acc: 90, minLevel: 3, minForm: 0, price: 300, who: "both" },
  { id: "heal", name: "Liếm vết thương", kind: "heal", power: 0, acc: 100, minLevel: 5, minForm: 0, price: 500, who: "pet" },
  { id: "fury", name: "Cuồng nộ", kind: "hit", power: 26, acc: 75, minLevel: 10, minForm: 0, price: 1200, who: "both" },
  { id: "ultimate", name: "Tuyệt kỹ", kind: "hit", power: 40, acc: 70, minLevel: 15, minForm: 1, price: 3000, who: "pet" },
];
export const skillOf = (id: string): Skill | undefined => SKILLS.find((s) => s.id === id);
export const SKILL_NOTE: Record<SkillKind, string> = {
  hit: "Tấn công", guard: "Giảm 60% sát thương lượt này", heal: "Hồi 25% máu (2 lần/trận)",
};

export interface Npc { id: string; name: string; kind: "wild" | "trainer"; species: PetSpecies; variant: string; level: number; hp: number; atk: number; def: number; spd: number; skills: string[]; reward: number }
export const NPCS: readonly Npc[] = [
  { id: "meo_hoang", name: "Mèo hoang", kind: "wild", species: "meo", variant: "den", level: 3, hp: 60, atk: 12, def: 9, spd: 12, skills: ["tackle", "bite"], reward: 40 },
  { id: "cho_co", name: "Chó cỏ", kind: "wild", species: "cho", variant: "vang", level: 6, hp: 80, atk: 15, def: 12, spd: 11, skills: ["tackle", "bite", "guard"], reward: 70 },
  { id: "soc_nui", name: "Sóc núi", kind: "wild", species: "soc", variant: "do", level: 9, hp: 85, atk: 17, def: 12, spd: 18, skills: ["tackle", "bite", "guard"], reward: 90 },
  { id: "thay_tu", name: "Thầy Tư", kind: "trainer", species: "cho", variant: "nau", level: 14, hp: 120, atk: 22, def: 17, spd: 14, skills: ["tackle", "bite", "guard", "heal"], reward: 150 },
  { id: "co_bay", name: "Cô Bảy", kind: "trainer", species: "vet", variant: "lam", level: 22, hp: 160, atk: 30, def: 22, spd: 22, skills: ["tackle", "bite", "heal", "fury"], reward: 250 },
  { id: "ho_than", name: "Hổ thần", kind: "wild", species: "meo", variant: "cam", level: 32, hp: 240, atk: 42, def: 32, spd: 20, skills: ["bite", "fury", "guard", "heal"], reward: 450 },
];

export interface Decor { id: string; name: string; price: number }
export const AQUA_DECOR: readonly Decor[] = [
  { id: "rong", name: "Rong biển", price: 150 },
  { id: "da", name: "Đá cuội", price: 100 },
  { id: "san_ho", name: "San hô", price: 300 },
  { id: "ruong", name: "Rương báu", price: 350 },
  { id: "lau_dai", name: "Lâu đài", price: 400 },
];

/** The damage of one hit (0074 _battle_dmg), for the tooltip's estimate: `roll` ∈ [0,1). */
export function battleDmg(power: number, atk: number, def: number, roll: number, crit: boolean, guard: boolean): number {
  const v = power * atk / Math.max(1, atk + def) * 2.2 * (0.85 + roll * 0.3) * (crit ? 1.5 : 1) * (guard ? 0.4 : 1);
  return Math.max(1, Math.round(v));
}

// ---------------------------------------------------------------- battle state

export interface Stats { hp: number; atk: number; def: number; spd: number }
export interface Fighter extends Stats { kind: "pet" | "fish" | "npc"; id: string | number; name: string; species: string; variant: string; rarity: number; form: number; level: number; skills: string[] }
export interface LogLine { who: 1 | 2; skill: string; dmg?: number; crit?: boolean; guarded?: boolean; miss?: boolean; heal?: number; guard?: boolean; fail?: boolean }
export interface Battle {
  id: number; mode: "pve" | "pvp"; status: "pending" | "active" | "done"; side: 1 | 2; npc: string | null; turn: number;
  f1: Fighter | null; f2: Fighter | null; hp1: number; hp2: number; log: LogLine[]; stake: number; winner: 0 | 1 | 2 | null;
  reward: number; p1Name: string | null; p2Name: string | null; acted: boolean; foeActed: boolean; deadlineMs: number;
}
export interface FishFighter { id: number; speciesId: string; weightG: number; name: string; level: number; xp: number; xpNeed: number; skills: string[]; trn: Stats; stats: Stats & { rarity: number } }
export interface BattleState {
  battle: Battle | null; last: Battle | null;
  incoming: Array<{ id: number; from: string; stake: number }>;
  outgoing: { id: number; to: string; stake: number } | null;
  fish: FishFighter[]; winsToday: number; battlesToday: number;
  rivals: Array<{ id: string; name: string }>;
  serverNowMs: number;
  /** An action's new balance. */
  coins?: number;
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const stats = (v: unknown): Stats => { const o = rec(v); return { hp: num(o.hp), atk: num(o.atk), def: num(o.def), spd: num(o.spd) }; };

function parseFighter(v: unknown): Fighter | null {
  const o = rec(v);
  if (o.kind !== "pet" && o.kind !== "fish" && o.kind !== "npc") return null;
  return {
    kind: o.kind, id: typeof o.id === "string" ? o.id : num(o.id), name: str(o.name), species: str(o.species), variant: str(o.variant),
    rarity: num(o.rarity), form: num(o.form), level: num(o.level, 1), skills: strs(o.skills), ...stats(o),
  };
}

export function parseBattle(v: unknown): Battle | null {
  const o = rec(v);
  if (v == null || o.id == null) return null;
  const log: LogLine[] = [];
  for (const raw of Array.isArray(o.log) ? o.log : []) {
    const l = rec(raw);
    if (l.who !== 1 && l.who !== 2) continue;
    log.push({
      who: l.who, skill: str(l.skill), dmg: l.dmg == null ? undefined : num(l.dmg), crit: l.crit === true, guarded: l.guarded === true,
      miss: l.miss === true, heal: l.heal == null ? undefined : num(l.heal), guard: l.guard === true, fail: l.fail === true,
    });
  }
  const w = o.winner;
  return {
    id: num(o.id), mode: o.mode === "pvp" ? "pvp" : "pve", status: o.status === "done" ? "done" : o.status === "pending" ? "pending" : "active",
    side: o.side === 2 ? 2 : 1, npc: typeof o.npc === "string" ? o.npc : null, turn: num(o.turn, 1),
    f1: parseFighter(o.f1), f2: parseFighter(o.f2), hp1: num(o.hp1), hp2: num(o.hp2), log, stake: num(o.stake),
    winner: w === 0 || w === 1 || w === 2 ? w : null, reward: num(o.reward),
    p1Name: typeof o.p1_name === "string" ? o.p1_name : null, p2Name: typeof o.p2_name === "string" ? o.p2_name : null,
    acted: o.acted === true, foeActed: o.foe_acted === true, deadlineMs: num(o.deadline_ms),
  };
}

export function parseBattleState(data: unknown): BattleState {
  const r = rec(data);
  const fish: FishFighter[] = [];
  for (const raw of Array.isArray(r.fish) ? r.fish : []) {
    const f = rec(raw);
    fish.push({
      id: num(f.id), speciesId: str(f.species_id), weightG: num(f.weight_g), name: str(f.name), level: num(f.level, 1),
      xp: num(f.xp), xpNeed: num(f.xp_need, 20), skills: strs(f.skills), trn: stats(f.trn), stats: { ...stats(f.stats), rarity: num(rec(f.stats).rarity) },
    });
  }
  const out: BattleState = {
    battle: parseBattle(r.battle_now && rec(r.battle_now).status === "active" ? r.battle_now : r.battle),
    last: parseBattle(r.battle_now && rec(r.battle_now).status === "done" ? r.battle_now : r.last),
    incoming: (Array.isArray(r.incoming) ? r.incoming : []).map((x) => { const o = rec(x); return { id: num(o.id), from: str(o.from), stake: num(o.stake) }; }),
    outgoing: r.outgoing ? { id: num(rec(r.outgoing).id), to: str(rec(r.outgoing).to), stake: num(rec(r.outgoing).stake) } : null,
    fish, winsToday: num(r.wins_today), battlesToday: num(r.battles_today),
    rivals: (Array.isArray(r.rivals) ? r.rivals : []).map((x) => { const o = rec(x); return { id: str(o.id), name: str(o.name) }; }),
    serverNowMs: num(r.server_now_ms, Date.now()),
  };
  if (r.coins !== undefined) out.coins = num(r.coins);
  return out;
}

/** "Mèo cắn: −12" and friends, for the battle log. */
export function logText(l: LogLine, names: [string, string]): string {
  const who = names[l.who - 1];
  const sk = skillOf(l.skill)?.name ?? l.skill;
  if (l.guard) return `${who} ${sk}.`;
  if (l.heal !== undefined) return `${who} ${sk}: +${l.heal} máu.`;
  if (l.fail) return `${who} hết lượt hồi máu!`;
  if (l.miss) return `${who} dùng ${sk} — trượt!`;
  return `${who} dùng ${sk}: −${l.dmg ?? 0}${l.crit ? " (chí mạng!)" : ""}${l.guarded ? " (bị đỡ)" : ""}`;
}

// ---------------------------------------------------------------- aquarium

export interface TankFish { id: string | null; speciesId: string; weightG: number; rarity: number }
export interface Tank { tank: number; item: string; cap: number; placed: boolean; decor: string[]; fish: TankFish[] }
export interface AquaView { tanks: Tank[]; showcase: TankFish[] }

function parseTank(v: unknown): Tank {
  const o = rec(v);
  return {
    tank: num(o.tank), item: str(o.item), cap: num(o.cap), placed: o.placed === true, decor: strs(o.decor),
    fish: (Array.isArray(o.fish) ? o.fish : []).map(parseTankFish),
  };
}
function parseTankFish(v: unknown): TankFish {
  const o = rec(v);
  return { id: typeof o.id === "string" ? o.id : null, speciesId: str(o.species_id), weightG: num(o.weight_g), rarity: num(o.rarity, 1) };
}
export function parseAquaView(data: unknown): AquaView & { coins?: number } {
  const r = rec(data);
  const out: AquaView & { coins?: number } = {
    tanks: (Array.isArray(r.tanks) ? r.tanks : []).map(parseTank),
    showcase: (Array.isArray(r.showcase) ? r.showcase : []).map(parseTankFish),
  };
  if (r.coins !== undefined) out.coins = num(r.coins);
  return out;
}

// ---------------------------------------------------------------- errors

export function v2ErrorMessage(msg: string): string {
  if (msg.includes("insufficient funds")) return "Không đủ xu.";
  if (msg.includes("too many pets")) return `Bạn nuôi tối đa ${MAX_PETS_V2} bé thôi.`;
  if (msg.includes("too many fighters")) return `Tối đa ${MAX_FISH_FIGHTERS} cá chiến.`;
  if (msg.includes("too soon")) return "Chậm thôi, đợi chút nhé.";
  if (msg.includes("sulking")) return "Bé đang dỗi vì đói — cho ăn trước đã.";
  if (msg.includes("hungry")) return "Bé đói quá, không đánh/tập được — cho ăn trước.";
  if (msg.includes("level too low")) return "Chưa đủ cấp.";
  if (msg.includes("affection too low")) return "Bé chưa đủ thân thiết — vuốt ve, cho ăn, chơi với bé thêm.";
  if (msg.includes("max form")) return "Bé đã ở dạng tối thượng.";
  if (msg.includes("train cap")) return "Chỉ số này đã tập tối đa ở cấp hiện tại.";
  if (msg.includes("already known")) return "Đã biết chiêu này.";
  if (msg.includes("wrong kind")) return "Chiêu này không hợp.";
  if (msg.includes("not rare")) return "Chỉ cá hiếm (từ ★3) mới làm cá chiến được.";
  if (msg.includes("in battle")) return "Đang trong một trận đấu.";
  if (msg.includes("daily limit")) return `Hôm nay đã đấu ${PVE_PER_DAY} trận rồi.`;
  if (msg.includes("already challenging")) return "Bạn đang chờ một lời thách đấu.";
  if (msg.includes("already acted")) return "Đã chọn chiêu, chờ đối thủ.";
  if (msg.includes("no challenge") || msg.includes("no battle")) return "Trận đấu không còn nữa.";
  if (msg.includes("challenger broke")) return "Người thách đấu không đủ xu cược — trận bị hủy.";
  if (msg.includes("not in room")) return "Hai bạn phải cùng phòng nhạc.";
  if (msg.includes("bad stake")) return `Tiền cược từ 0 đến ${MAX_STAKE} xu.`;
  if (msg.includes("not placed")) return "Đặt bể cá trong nhà trước đã.";
  if (msg.includes("tank full")) return "Bể đầy rồi.";
  if (msg.includes("bag full")) return "Giỏ cá đầy.";
  if (msg.includes("too many")) return "Đã đủ số lượng tối đa.";
  if (msg.includes("already owned")) return "Đã có món này.";
  if (msg.includes("no access")) return "Bạn chưa được vào nhà này.";
  if (msg.includes("account locked")) return "Tài khoản đang bị khóa tạm.";
  if (msg.includes("not your") || msg.includes("not owned")) return "Không tìm thấy.";
  return "Không được, thử lại nhé.";
}
export const errText = (e: unknown): string =>
  v2ErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

// ---------------------------------------------------------------- RPCs

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}
type FKind = "pet" | "fish";

export const gachaRoll = async (token: string): Promise<PetsState & { rolled?: { rarity: number; species: string; variant: string } }> => {
  const d = await rpc("pet_gacha_roll", { p_session_token: token });
  const r = rec(rec(d).rolled);
  return { ...parsePetsState(d), rolled: { rarity: num(r.rarity, 1), species: str(r.species), variant: str(r.variant) } };
};
export const petRelease = async (token: string, pet: number) => parsePetsState(await rpc("pet_release", { p_session_token: token, p_pet: pet }));
export const petPat = async (token: string, pet: number) => parsePetsState(await rpc("pet_pat", { p_session_token: token, p_pet: pet }));
export const petEvolve = async (token: string, pet: number) => parsePetsState(await rpc("pet_evolve", { p_session_token: token, p_pet: pet }));

/** Training and skills answer both states (and the balance). */
async function both(fn: string, args: Record<string, unknown>): Promise<{ pets: PetsState; battle: BattleState }> {
  const d = await rpc(fn, args);
  return { pets: parsePetsState(d), battle: parseBattleState(d) };
}
export const fighterTrain = (token: string, kind: FKind, id: number, stat: keyof Stats) =>
  both("fighter_train", { p_session_token: token, p_kind: kind, p_id: id, p_stat: stat });
export const fighterLearn = (token: string, kind: FKind, id: number, skill: string) =>
  both("fighter_learn", { p_session_token: token, p_kind: kind, p_id: id, p_skill: skill });

export const battleState = async (token: string, roomId: string | null) =>
  parseBattleState(await rpc("battle_state", { p_session_token: token, p_room_id: roomId }));
export const battleStartPve = async (token: string, kind: FKind, id: number, npc: string) =>
  parseBattleState(await rpc("battle_start_pve", { p_session_token: token, p_kind: kind, p_id: id, p_npc: npc }));
export const battleChallenge = async (token: string, roomId: string, target: string, kind: FKind, id: number, stake: number) =>
  parseBattleState(await rpc("battle_challenge", { p_session_token: token, p_room_id: roomId, p_target: target, p_kind: kind, p_id: id, p_stake: stake }));
export const battleAccept = async (token: string, battle: number, kind: FKind, id: number) =>
  parseBattleState(await rpc("battle_accept", { p_session_token: token, p_battle: battle, p_kind: kind, p_id: id }));
export const battleDecline = async (token: string, battle: number) =>
  parseBattleState(await rpc("battle_decline", { p_session_token: token, p_battle: battle }));
export const battleAct = async (token: string, battle: number, skill: string) =>
  parseBattleState(await rpc("battle_act", { p_session_token: token, p_battle: battle, p_skill: skill }));
export const battleForfeit = async (token: string, battle: number) =>
  parseBattleState(await rpc("battle_forfeit", { p_session_token: token, p_battle: battle }));
export const fishToFighter = async (token: string, fishId: string) =>
  parseBattleState(await rpc("fish_to_fighter", { p_session_token: token, p_fish_id: fishId }));
export const fishFighterRelease = async (token: string, id: number) =>
  parseBattleState(await rpc("fish_fighter_release", { p_session_token: token, p_id: id }));

export const aquariumMine = async (token: string) => parseAquaView(await rpc("aquarium_mine", { p_session_token: token }));
export const aquariumPut = async (token: string, tank: number, fishId: string) =>
  parseAquaView(await rpc("aquarium_put", { p_session_token: token, p_tank: tank, p_fish_id: fishId }));
export const aquariumTake = async (token: string, fishId: string) =>
  parseAquaView(await rpc("aquarium_take", { p_session_token: token, p_fish_id: fishId }));
export const aquariumDecor = async (token: string, tank: number, decor: string, add: boolean) =>
  parseAquaView(await rpc("aquarium_decor", { p_session_token: token, p_tank: tank, p_decor: decor, p_add: add }));
export const aquariumView = async (token: string, roomId: string, kind: "apt" | "house", no: number) =>
  parseAquaView(await rpc("aquarium_view", { p_session_token: token, p_room_id: roomId, p_kind: kind, p_no: no }));

export interface HouseKnocks { knocks: Array<{ accountId: string; name: string }>; guests: Array<{ accountId: string; name: string; untilMs: number }> }
function parseKnocks(d: unknown): HouseKnocks {
  const r = rec(d);
  return {
    knocks: (Array.isArray(r.knocks) ? r.knocks : []).map((x) => ({ accountId: str(rec(x).account_id), name: str(rec(x).name) })),
    guests: (Array.isArray(r.guests) ? r.guests : []).map((x) => ({ accountId: str(rec(x).account_id), name: str(rec(x).name), untilMs: num(rec(x).until_ms) })),
  };
}
export const houseKnock = async (token: string, roomId: string, lot: number) =>
  Boolean(await rpc("house_knock", { p_session_token: token, p_room_id: roomId, p_lot: lot }));
export const houseKnocks = async (token: string) => parseKnocks(await rpc("house_knocks", { p_session_token: token }));
export const houseAdmit = async (token: string, account: string, accept: boolean) =>
  parseKnocks(await rpc("house_admit", { p_session_token: token, p_account: account, p_accept: accept }));
