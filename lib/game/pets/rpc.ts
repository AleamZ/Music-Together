// v18.12 Thú cưng: the pet RPCs of 0036_pets.sql. The server owns the prices, the stats and the forage.
import { supabase } from "@/lib/supabase";
import { isPetSpecies, type PetSlot, type PetSpecies } from "./catalog";
import { buffActive, encodePet, type PetLook } from "./model";

export interface Pet {
  id: number;
  species: PetSpecies;
  variant: string;
  name: string;
  fullness: number;
  happy: number;
  sulking: boolean;
  head: string | null;
  neck: string | null;
  body: string | null;
  /** Play again from (epoch ms); null = ready. */
  playReadyMs: number | null;
  // v21 (0074): Pets v2 — the server's numbers, shown as they come.
  /** 1 Thường … 5 Thần thoại. */
  rarity: number;
  level: number;
  xp: number;
  xpNeed: number;
  affection: number;
  /** 0 base, 1 and 2 evolved. */
  form: number;
  skills: string[];
  trn: { hp: number; atk: number; def: number; spd: number };
  stats: { hp: number; atk: number; def: number; spd: number };
  /** Pat again from (epoch ms); null = ready. */
  patReadyMs: number | null;
}

export interface PetsState {
  pets: Pet[];
  active: number | null;
  items: Record<string, number>;
  forageToday: number;
  /** v21: eggs since the last Legendary or better. */
  pity: number;
  /** v21: care + follow XP given today (capped by the server). */
  xpToday: number;
  serverNowMs: number;
  /** pet_tick: xu the sóc just found (0 = none). */
  found?: number;
  coins?: number;
  /** pet_tick (0066): why the sóc did not forage — no live heartbeat, or not a member of the room. */
  idle?: "no_heartbeat" | "not_member";
}

const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const quad = (v: unknown) => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { hp: num(o.hp), atk: num(o.atk), def: num(o.def), spd: num(o.spd) };
};

export function parsePetsState(data: unknown): PetsState {
  const r = (data ?? {}) as Record<string, unknown>;
  const pets: Pet[] = [];
  for (const raw of Array.isArray(r.pets) ? r.pets : []) {
    const p = (raw ?? {}) as Record<string, unknown>;
    if (!isPetSpecies(p.species)) continue;
    pets.push({
      id: num(p.id), species: p.species, variant: String(p.variant ?? ""), name: String(p.name ?? ""),
      fullness: num(p.fullness), happy: num(p.happy), sulking: p.sulking === true,
      head: str(p.head), neck: str(p.neck), body: str(p.body),
      playReadyMs: p.play_ready_ms == null ? null : num(p.play_ready_ms),
      rarity: Math.min(5, Math.max(1, num(p.rarity, 1))), level: num(p.level, 1), xp: num(p.xp), xpNeed: num(p.xp_need, 20),
      affection: num(p.affection), form: Math.min(2, Math.max(0, num(p.form))),
      skills: Array.isArray(p.skills) ? p.skills.filter((s): s is string => typeof s === "string") : ["tackle"],
      trn: quad(p.trn), stats: quad(p.stats),
      patReadyMs: p.pat_ready_ms == null ? null : num(p.pat_ready_ms),
    });
  }
  const items: Record<string, number> = {};
  if (r.items && typeof r.items === "object") for (const [k, v] of Object.entries(r.items as Record<string, unknown>)) items[k] = num(v);
  const out: PetsState = {
    pets, active: r.active == null ? null : num(r.active), items, forageToday: num(r.forage_today),
    pity: num(r.pity), xpToday: num(r.xp_today), serverNowMs: num(r.server_now_ms, Date.now()),
  };
  if (r.found !== undefined) out.found = num(r.found);
  if (r.coins !== undefined) out.coins = num(r.coins);
  if (r.idle === "no_heartbeat" || r.idle === "not_member") out.idle = r.idle;
  return out;
}

/** The pet that follows me (active, not sulking), or null. */
export const followingPet = (s: PetsState | null): Pet | null => {
  const p = s?.active != null ? s.pets.find((x) => x.id === s.active) ?? null : null;
  return p && !p.sulking ? p : null;
};

export const lookOf = (p: Pet): PetLook => ({
  species: p.species, variant: p.variant, head: p.head, neck: p.neck, body: p.body,
  happy: buffActive({ no: p.fullness, vui: p.happy }), form: p.form,
});

/** My `pt` code (null: no pet follows). */
export const myPetCode = (s: PetsState | null): string | null => {
  const p = followingPet(s);
  return p ? encodePet(lookOf(p)) : null;
};

async function call(fn: string, args: Record<string, unknown>): Promise<PetsState> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return parsePetsState(data);
}

export const petsState = (token: string) => call("pets_state", { p_session_token: token });
/** The minute heartbeat (0066): the sóc forages only while this room's game is live (a recent heartbeat, a member). */
export const petTick = (token: string, roomId: string) => call("pet_tick", { p_session_token: token, p_room_id: roomId });
export const buyPet = (token: string, species: PetSpecies, variant: string, name: string | null) =>
  call("pet_buy", { p_session_token: token, p_species: species, p_variant: variant, p_name: name });
export const buyPetItem = (token: string, item: string, qty = 1) =>
  call("pet_buy_item", { p_session_token: token, p_item: item, p_qty: qty });
export const feedPet = (token: string, pet: number) => call("pet_feed", { p_session_token: token, p_pet: pet });
export const playPet = (token: string, pet: number) => call("pet_play", { p_session_token: token, p_pet: pet });
export const setActivePet = (token: string, pet: number | null) => call("pet_set_active", { p_session_token: token, p_pet: pet });
export const renamePet = (token: string, pet: number, name: string) =>
  call("pet_rename", { p_session_token: token, p_pet: pet, p_name: name });
export const equipPet = (token: string, pet: number, slot: PetSlot, item: string | null) =>
  call("pet_equip", { p_session_token: token, p_pet: pet, p_slot: slot, p_item: item });
