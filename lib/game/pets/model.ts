// v18.12 Thú cưng: the care rules, the buffs, the pet's name and the `pt` code other players receive. The rates are
// those of 0036_pets.sql (authoritative; the client only shows what the server returned). Pinned by
// tests/unit/pets.test.ts.

import { isPetSpecies, petItem, variantOk, type PetSlot, type PetSpecies } from "./catalog";

/** no (fullness): 100 → 0 in 48 h. */
export const NO_PER_S = 100 / 172800;
/** vui (happiness): 100 → 0 in 36 h; a hamster's at half that speed. */
export const VUI_PER_S = 100 / 129600;
export const HAMSTER_VUI_FACTOR = 0.5;
export const FEED_NO = 40;
export const FEED_VUI = 5;
export const PLAY_VUI = 25;
export const PLAY_COOLDOWN_S = 600;
/** The buffs work only above this vui. */
export const BUFF_VUI = 50;
export const FORAGE_EVERY_S = 600;
export const FORAGE_MIN = 5;
export const FORAGE_MAX = 30;
/** Economy v2 (0104 pet_tick): 150 xu a day (was 300), and only while the owner moved within FORAGE_MOVE_S. */
export const FORAGE_DAY_CAP = 150;
export const FORAGE_MOVE_S = 300;
/** mèo: the owner's hunger and thirst drain × this. */
export const CAT_DRAIN = 0.9;
export const NAME_MAX = 16;
/** How often the client calls pet_tick (the sóc's forage is decided there). */
export const PET_TICK_MS = 60000;
/** A parrot repeats a line this long after its owner said it. */
export const PARROT_ECHO_MS = 2500;

export interface PetStats { no: number; vui: number }

/** The stats `dtSec` after they were `s` (never below 0). */
export function decay(species: PetSpecies, s: PetStats, dtSec: number): PetStats {
  const dt = Math.max(0, dtSec);
  const vr = VUI_PER_S * (species === "hamster" ? HAMSTER_VUI_FACTOR : 1);
  return { no: Math.max(0, s.no - dt * NO_PER_S), vui: Math.max(0, s.vui - dt * vr) };
}

/** A starving pet sulks: it stays in the shop until fed. */
export const sulking = (s: Pick<PetStats, "no">): boolean => s.no <= 0;
/** Its buff works: following (not sulking) and vui above 50. */
export const buffActive = (s: PetStats): boolean => !sulking(s) && s.vui > BUFF_VUI;

/** The walk-speed factor a following pet gives (chó +5 %, thỏ +3 %; 1 otherwise or when unhappy). */
export function petSpeed(look: Pick<PetLook, "species" | "happy"> | null): number {
  if (!look || !look.happy) return 1;
  return look.species === "cho" ? 1.05 : look.species === "tho" ? 1.03 : 1;
}

/** The name as the server stores it: control characters and <> removed, spaces collapsed, trimmed; null when empty
 *  or longer than 16 characters (mirrors _pet_name). */
export function sanitizePetName(raw: string): string | null {
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim();
  const n = [...s].length;
  return n >= 1 && n <= NAME_MAX ? s : null;
}

/** What other players need to draw my pet. */
export interface PetLook {
  species: PetSpecies;
  variant: string;
  head: string | null;
  neck: string | null;
  body: string | null;
  /** vui > 50 and not sulking (the parrot talks, the tail wags). */
  happy: boolean;
  /** v21 evolution: 0 (or absent) base, 1 and 2 evolved forms. */
  form?: number;
}

const ITEM_ID = /^[a-z0-9_]{1,24}$/;

/** `species.variant.head.neck.body.happy`, "0" for an empty slot, then `.form` for an evolved pet (v21; ≤ 90 chars). */
export function encodePet(p: PetLook): string {
  const parts = [p.species, p.variant, p.head ?? "0", p.neck ?? "0", p.body ?? "0", p.happy ? "1" : "0"];
  if (p.form === 1 || p.form === 2) parts.push(String(p.form));
  return parts.join(".");
}

/** A received `pt`: null when malformed. An item this client does not know (or not for this species/slot) is dropped. */
export function parsePetCode(v: unknown): PetLook | null {
  if (typeof v !== "string" || v.length > 90) return null;
  const parts = v.split(".");
  if (parts.length !== 6 && parts.length !== 7) return null;
  const [sp, variant, head, neck, body, happy, formPart] = parts;
  if (formPart !== undefined && formPart !== "1" && formPart !== "2") return null;
  if (!isPetSpecies(sp) || !variantOk(sp, variant) || (happy !== "0" && happy !== "1")) return null;
  const slot = (id: string, s: PetSlot): string | null | false => {
    if (id === "0") return null;
    if (!ITEM_ID.test(id)) return false;
    const it = petItem(id);
    return it && it.species === sp && it.kind === s ? id : null;
  };
  const h = slot(head, "head"), n = slot(neck, "neck"), b = slot(body, "body");
  if (h === false || n === false || b === false) return null;
  const out: PetLook = { species: sp, variant, head: h, neck: n, body: b, happy: happy === "1" };
  if (formPart !== undefined) out.form = Number(formPart);
  return out;
}

/** Does this line get repeated by the speaker's parrot? The same pick on every client (a third of the lines). */
export function parrotEchoes(speaker: string, text: string): boolean {
  let h = 5381;
  for (const ch of `${speaker}|${text}`) h = ((h * 33) ^ ch.codePointAt(0)!) >>> 0;
  return h % 3 === 0;
}

/** Vietnamese toasts for the pet RPCs' errors. */
export function petErrorMessage(msg: string): string {
  if (msg.includes("insufficient funds")) return "Không đủ xu.";
  if (msg.includes("too many pets")) return "Bạn nuôi tối đa 6 bé thôi.";
  if (msg.includes("bad name")) return "Tên từ 1 đến 16 ký tự nhé.";
  if (msg.includes("no food")) return "Hết đồ ăn cho bé rồi — mua thêm ở tiệm nhé.";
  if (msg.includes("no toy")) return "Cần đồ chơi hợp với bé — mua ở tiệm nhé.";
  if (msg.includes("too soon")) return "Bé vừa chơi xong, nghỉ chút đã.";
  if (msg.includes("sulking")) return "Bé đang dỗi vì đói — cho ăn trước đã.";
  if (msg.includes("not owned")) return "Bạn chưa có món này.";
  if (msg.includes("already owned")) return "Bạn có món này rồi.";
  if (msg.includes("wrong species")) return "Món này không hợp với bé.";
  if (msg.includes("unknown")) return "Tiệm không có món này.";
  if (msg.includes("not your pet")) return "Không tìm thấy bé này.";
  return "Không được, thử lại nhé.";
}
