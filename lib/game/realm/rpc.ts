// v21 "world" (0075): the RPCs and the parser of world_state. The client sends intents and where it stands; the
// server decides every outcome.
import { AnticheatError, parseAnticheat, reportAnticheat } from "@/lib/anticheat";
import { parseNpcQuota } from "@/lib/game/economy/npc";
import { supabase } from "@/lib/supabase";
import type { MapId } from "../maps/types";
import {
  isWildItem, type BossId, type WildAction, type WildItemId, type WildSpeciesId, bossDef, speciesOf, WILD_DAILY_KILLS,
} from "./model";

export interface WildAnimal { id: number; species: WildSpeciesId; hx: number; hy: number; seed: number; bornMs: number; expiresMs: number; photographed: boolean }
export interface WildState { animals: WildAnimal[]; bag: Partial<Record<WildItemId, number>>; album: Record<string, number>; killsToday: number }
export interface PartyMember { id: string; name: string; map: MapId | null; x: number; y: number }
export interface Party { id: number; leader: string; members: PartyMember[]; chat: Array<{ id: number; name: string; body: string; atMs: number }> }
export interface BossFight {
  id: number; boss: BossId; name: string; kind: string; map: MapId; arena: { x: number; y: number; w: number; h: number };
  hp: number; maxHp: number; phase: number; status: "up" | "dead" | "gone"; cap: number; startsMs: number; endsMs: number;
  killer: string | null; myDmg: number; myCombo: number; fighters: number; top: Array<{ name: string; dmg: number }>;
}
export interface DungeonRun {
  id: number; room: number; mobs: number[]; mobMax: number[]; status: "open" | "cleared" | "failed"; expiresMs: number;
  leader: string | null; joined: boolean; members: Array<{ name: string; dmg: number }>;
}
export interface WorldState {
  serverNowMs: number; night: boolean; snowUntilMs: number | null; wild: WildState | null;
  fights: BossFight[]; next: Array<{ boss: BossId; name: string; atMs: number }>;
  party: Party | null; invites: Array<{ partyId: number; from: string }>;
  dungeon: DungeonRun | null; clearsToday: number;
}

type R = Record<string, unknown>;
const obj = (v: unknown): R => (v && typeof v === "object" && !Array.isArray(v) ? (v as R) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const MAPS = new Set(["hall", "pond", "field", "market", "khu_nha", "bai_dat", "ham_ngam"]);
const mapOf = (v: unknown): MapId | null => (typeof v === "string" && MAPS.has(v) ? (v as MapId) : null);

export function parseWild(raw: unknown): WildState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = obj(raw);
  const animals: WildAnimal[] = [];
  for (const a0 of arr(r.animals)) {
    const a = obj(a0);
    const sp = speciesOf(String(a.species));
    if (!sp) continue;
    animals.push({ id: num(a.id), species: sp.id, hx: num(a.hx), hy: num(a.hy), seed: num(a.seed), bornMs: num(a.born_ms), expiresMs: num(a.expires_ms), photographed: a.photographed === true });
  }
  const bag: Partial<Record<WildItemId, number>> = {};
  for (const [k, v] of Object.entries(obj(r.bag))) if (isWildItem(k) && num(v) > 0) bag[k] = num(v);
  const album: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.album))) album[k] = num(v);
  return { animals, bag, album, killsToday: num(r.kills_today) };
}

export function parseParty(r: R): { party: Party | null; invites: WorldState["invites"] } {
  const p = r.party && typeof r.party === "object" ? obj(r.party) : null;
  const party: Party | null = p ? {
    id: num(p.id), leader: String(p.leader ?? ""),
    members: arr(p.members).map((m0) => { const m = obj(m0); return { id: String(m.id ?? ""), name: String(m.name ?? ""), map: mapOf(m.map), x: num(m.x), y: num(m.y) }; }),
    chat: arr(p.chat).map((c0) => { const c = obj(c0); return { id: num(c.id), name: String(c.name ?? "?"), body: String(c.body ?? ""), atMs: num(c.at_ms) }; }),
  } : null;
  const invites = arr(r.invites).map((i0) => { const i = obj(i0); return { partyId: num(i.party_id), from: String(i.from ?? "?") }; });
  return { party, invites };
}

function parseFight(f0: unknown): BossFight | null {
  const f = obj(f0);
  const def = bossDef(String(f.boss));
  const map = mapOf(f.map);
  if (!def || !map) return null;
  const a = obj(f.arena);
  const st = f.status === "dead" || f.status === "gone" ? f.status : "up";
  return {
    id: num(f.id), boss: def.id, name: String(f.name ?? def.name), kind: String(f.kind ?? def.kind), map,
    arena: { x: num(a.x), y: num(a.y), w: num(a.w), h: num(a.h) }, hp: num(f.hp), maxHp: num(f.max_hp, 1), phase: num(f.phase, 1),
    status: st, cap: num(f.cap), startsMs: num(f.starts_ms), endsMs: num(f.ends_ms), killer: str(f.killer),
    myDmg: num(f.my_dmg), myCombo: num(f.my_combo), fighters: num(f.fighters),
    top: arr(f.top).map((t0) => { const t = obj(t0); return { name: String(t.name ?? "?"), dmg: num(t.dmg) }; }),
  };
}

export function parseDungeon(raw: unknown): { dungeon: DungeonRun | null; clearsToday: number } {
  const r = obj(raw);
  const d = r.run && typeof r.run === "object" ? obj(r.run) : null;
  const st = d?.status === "cleared" || d?.status === "failed" ? d.status : "open";
  return {
    dungeon: d ? {
      id: num(d.id), room: num(d.room, 1), mobs: arr(d.mobs).map((x) => num(x)), mobMax: arr(d.mob_max).map((x) => num(x)),
      status: st, expiresMs: num(d.expires_ms), leader: str(d.leader), joined: d.joined === true,
      members: arr(d.members).map((m0) => { const m = obj(m0); return { name: String(m.name ?? "?"), dmg: num(m.dmg) }; }),
    } : null,
    clearsToday: num(r.clears_today),
  };
}

export function parseWorld(raw: unknown): WorldState {
  const r = obj(raw);
  const b = obj(r.bosses);
  const fights: BossFight[] = [];
  for (const f of arr(b.fights)) { const x = parseFight(f); if (x) fights.push(x); }
  const next = arr(b.next).flatMap((n0) => {
    const n = obj(n0); const def = bossDef(String(n.boss));
    return def ? [{ boss: def.id, name: String(n.name ?? def.name), atMs: num(n.at_ms) }] : [];
  });
  return {
    serverNowMs: num(r.server_now_ms, Date.now()), night: r.night === true,
    snowUntilMs: r.snow_until_ms == null ? null : num(r.snow_until_ms),
    wild: parseWild(r.wild), fights, next, ...parseParty(r), ...parseDungeon(r.dungeon),
  };
}

/** An RPC; an anti-cheat envelope is reported to the shell and thrown as its refusal. */
async function call(fn: string, args: Record<string, unknown>): Promise<R> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  const ac = parseAnticheat(data);
  if (ac) {
    reportAnticheat(ac);
    throw new AnticheatError(ac);
  }
  return obj(data);
}

export const worldState = async (token: string, roomId: string, map: MapId | "wild") =>
  parseWorld(await call("world_state", { p_session_token: token, p_room_id: roomId, p_map: map }));

// v22 (0083): the wild minigames — a start and a finish (only my input ticks; the server replays). 0087: the round stays
// on the server (mg_sync('world') reveals it, lib/game/mglive.ts); the start answers only the aim's sweep (a hunt).
// `nonce` is a client-side random number that picks the flavour lines.
export interface WildRound { game: WildAction; spawn: number; species: WildSpeciesId; danger: boolean; reticle: number; nonce: number }
const nonce = () => Math.floor(Math.random() * 1_000_000);
export interface WildResult {
  result: "ok" | "fail" | "lost"; why: string | null; outcome: string | null; score: number; chance: number;
  item: WildItemId | null; qty: number; xp: number; saved: boolean; knocked: boolean; fainted: boolean; wild: WildState | null;
}
export const wildStart = async (token: string, spawn: number, action: WildAction, map: MapId | "wild", x: number, y: number): Promise<WildRound> => {
  const r = obj((await call("wild_start", { p_session_token: token, p_spawn: spawn, p_action: action, p_map: map, p_x: Math.round(x), p_y: Math.round(y) })).round);
  return { game: action, spawn: num(r.spawn), species: speciesOf(String(r.species))?.id ?? "rabbit", danger: r.danger === true, reticle: num(r.reticle, 120), nonce: nonce() };
};
export const wildFinish = async (token: string, a: readonly number[], b: readonly number[], ticks: number): Promise<WildResult> => {
  const r = await call("wild_finish", { p_session_token: token, p_a: a, p_b: b, p_ticks: ticks });
  const res = r.result === "ok" || r.result === "fail" ? r.result : "lost";
  return {
    result: res, why: str(r.why), outcome: str(r.outcome), score: num(r.score), chance: num(r.chance),
    item: isWildItem(r.item) ? r.item : null, qty: num(r.qty), xp: num(r.xp), saved: r.saved === true,
    knocked: r.knocked === true, fainted: r.fainted === true, wild: parseWild(r.wild),
  };
};
/** A sale at the stall (0103: through the thương lái — `cut` what it kept back, `npc` its day, null before econ v2). */
export const wildSell = async (token: string, item: WildItemId, qty: number) => {
  const r = await call("wild_sell", { p_session_token: token, p_item: item, p_qty: qty });
  return { earned: num(r.earned), coins: num(r.coins), cut: num(r.npc_cut), npc: parseNpcQuota(r.npc), wild: parseWild(r.wild) };
};

const party = async (fn: string, args: Record<string, unknown>) => parseParty(await call(fn, args));
export const partyCreate = (token: string) => party("party_create", { p_session_token: token });
export const partyInvite = (token: string, username: string) => party("party_invite", { p_session_token: token, p_username: username });
export const partyAccept = (token: string, id: number) => party("party_accept", { p_session_token: token, p_party: id });
export const partyDecline = (token: string, id: number) => party("party_decline", { p_session_token: token, p_party: id });
export const partyLeave = (token: string) => party("party_leave", { p_session_token: token });
export const partyKick = (token: string, account: string) => party("party_kick", { p_session_token: token, p_account: account });
export const partySay = (token: string, body: string) => party("party_say", { p_session_token: token, p_body: body });

// v22 (0083): the combo strike (bosses and the dungeon) — six rhythm arrows and a slam to dodge, replayed by the server
export type ComboKind = "boss" | "dungeon";
export interface ComboRound { kind: ComboKind; ref: number; target: number; nonce: number }
export interface ComboResult {
  result: "ok" | "lost"; why: string | null; dmg: number; judges: string[]; best: number; stunned: boolean;
  hp: number; killed: boolean; myDmg: number; cap: number; cleared: boolean; target: number;
}
export const comboStart = async (token: string, kind: ComboKind, ref: number, target: number, map: MapId, x: number, y: number): Promise<ComboRound> => {
  const r = obj((await call("combo_start", { p_session_token: token, p_kind: kind, p_ref: ref, p_target: target, p_map: map, p_x: Math.round(x), p_y: Math.round(y) })).round);
  return { kind, ref: num(r.ref), target: num(r.target), nonce: nonce() };
};
export const comboFinish = async (token: string, keys: readonly number[], dodges: readonly number[], ticks: number): Promise<ComboResult> => {
  const r = await call("combo_finish", { p_session_token: token, p_keys: keys, p_dodges: dodges, p_ticks: ticks });
  return {
    result: r.result === "ok" ? "ok" : "lost", why: str(r.why), dmg: num(r.dmg), judges: arr(r.judges).map(String), best: num(r.best),
    stunned: r.stunned === true, hp: num(r.hp), killed: r.killed === true, myDmg: num(r.my_dmg), cap: num(r.cap),
    cleared: r.cleared === true, target: num(r.target),
  };
};
export const bossSummon = (token: string, map: MapId, x: number, y: number) =>
  call("boss_summon", { p_session_token: token, p_map: map, p_x: Math.round(x), p_y: Math.round(y) });

export const dungeonStart = async (token: string) => parseDungeon(await call("dungeon_start", { p_session_token: token }));
export const dungeonJoin = async (token: string, run: number) => parseDungeon(await call("dungeon_join", { p_session_token: token, p_run: run }));

export const snowStart = (token: string, roomId: string, minutes: number) =>
  call("snow_event_start", { p_session_token: token, p_room_id: roomId, p_minutes: minutes });
export const snowStop = (token: string, roomId: string) => call("snow_event_stop", { p_session_token: token, p_room_id: roomId });

const TEXTS: Record<string, string> = {
  "too far": "Còn xa quá — lại gần hơn nhé.",
  "not in forest": "Muốn săn thì vô rừng tràm nha!",   // 0096 (0097: forest-content copy)
  "no bow": "Cần có cung mới đi săn được nghen!",   // 0097
  gone: "Con vật đã chạy mất.",
  cooldown: "Chậm lại một nhịp…",
  cannot: "Không làm vậy với con này được.",
  "daily cap": `Hôm nay bạn săn đủ rồi (${WILD_DAILY_KILLS} con).`,
  "already photographed": "Bạn đã chụp con này rồi.",
  "not at stall": "Hãy đến sạp thợ săn ở Bãi đất trống.",
  "not enough": "Không đủ hàng để bán.",
  "no party": "Bạn chưa có tổ đội.",
  "in party": "Bạn đang ở trong một tổ đội.",
  "not leader": "Chỉ đội trưởng mới làm được.",
  "party full": "Tổ đội đã đủ 4 người.",
  "no such player": "Không tìm thấy người chơi này.",
  "already in": "Người này đã ở trong đội.",
  "no invite": "Lời mời đã hết hạn.",
  "too fast": "Chậm lại chút nhé.",
  "invalid message": "Tin nhắn không hợp lệ.",
  "boss not up": "Boss chưa xuất hiện hoặc đã đi.",
  "not in arena": "Hãy vào trong đấu trường boss.",
  "damage cap": "Bạn đã góp đủ phần — nhường đồng đội đánh tiếp!",
  "need 3": "Cần ít nhất 3 thành viên tổ đội đứng trong đấu trường.",
  "raid up": "Một trận boss tổ đội đang diễn ra.",
  "not at gate": "Hãy đứng ở cổng hầm ngục (Bãi đất trống).",
  "run open": "Tổ đội đang có một lượt hầm ngục.",
  "run over": "Lượt hầm ngục đã kết thúc.",
  "not joined": "Bạn chưa vào lượt hầm ngục này.",
  "not in room": "Boss này thuộc phòng khác.",                                   // v21 fixes (0078)
  "not in party": "Bạn không còn trong tổ đội của lượt này.",                   // v21 fixes (0078)
  "insufficient funds": "Không đủ xu.",
  "not owner": "Chỉ chủ phòng mới gọi tuyết được.",
  "too soon": "Chưa thể làm lại — đợi thêm một lúc.",
  fainted: "Bạn đang bất tỉnh.",
  "too hungry": "Bạn đói quá, ăn gì đã.",
  "too thirsty": "Bạn khát quá, uống gì đã.",
  exhausted: "Hôm nay bạn kiệt sức rồi.",
  "account locked": "Tài khoản đang bị tạm khóa.",
  outdated: "Trò chơi đã cập nhật — tải lại trang nhé.",                        // v22 (0083)
  stunned: "Bạn đang choáng — đợi một chút!",
  "round not found": "Lượt chơi đã hết.",
  "too tired": "Bạn mệt quá — nghỉ một lát đã.",
  "no boss": "Boss đã đi.",
};
export function worldErrorText(err: unknown): string {
  const m = err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string" ? (err as { message: string }).message : "";
  return TEXTS[m] ?? "Có lỗi, thử lại sau.";
}
