// Hòm thư and gift codes (supabase/migrations/0111_mailbox.sql): what the server answers, parsed defensively, and the
// Vietnamese texts of its refusals. Every rule is the server's; these are display copies (tests/unit/mailbox.test.ts
// pins them to the SQL). Pure.

/** A mail lives this many days; an unclaimed trade mail then goes back to its giver, any other one is dropped. */
export const MAIL_DAYS = 30;
/** Gift codes: this many failed attempts … */
export const CODE_MAX_FAILS = 10;
/** … within this many minutes lock the box until the oldest of them is this old. */
export const CODE_WINDOW_MIN = 60;
/** What an admin gift or a code may carry. */
export const GIFT_MAX_XU = 1_000_000;
export const GIFT_MAX_ITEMS = 8;
export const GIFT_ITEM_MAX_QTY = 99;

export type MailKind = "trade" | "gift" | "admin" | "code" | "market" | "return";
export type MailItemKind = "item" | "fashion" | "fish" | "produce";

export interface MailItem { kind: MailItemKind; ref: string; qty: number; name: string; value: number; rarity: number | null }
export interface Mail {
  id: number; kind: MailKind; senderKind: "system" | "admin" | "player"; senderName: string | null;
  title: string; body: string; xu: number; items: MailItem[];
  read: boolean; claimed: boolean; createdMs: number; expiresMs: number;
}
export interface MailBox { unread: number; claimable: number; mails: Mail[]; serverNowMs: number; coins: number | null }
export interface ClaimAll { n: number; xu: number; failed: { id: number; error: string }[] }
export interface RedeemResult { ok: boolean; error: string | null; left: number | null; retryS: number | null; title: string | null; box: MailBox | null }

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

const MAIL_KINDS: readonly MailKind[] = ["trade", "gift", "admin", "code", "market", "return"];
const ITEM_KINDS: readonly MailItemKind[] = ["item", "fashion", "fish", "produce"];

export function parseMailItem(v: unknown): MailItem | null {
  const o = obj(v);
  const kind = o ? str(o.kind) : null, ref = o ? str(o.ref) : null;
  if (!o || !kind || !ITEM_KINDS.includes(kind as MailItemKind) || ref === null) return null;
  return { kind: kind as MailItemKind, ref, qty: Math.max(1, num(o.qty) ?? 1), name: str(o.name) ?? ref, value: num(o.value) ?? 0, rarity: num(o.rarity) };
}

export function parseMail(v: unknown): Mail | null {
  const o = obj(v);
  const id = o ? num(o.id) : null, kind = o ? str(o.kind) : null;
  if (!o || id === null || !kind || !MAIL_KINDS.includes(kind as MailKind)) return null;
  const sk = str(o.sender_kind);
  return {
    id, kind: kind as MailKind,
    senderKind: sk === "admin" || sk === "player" ? sk : "system",
    senderName: str(o.sender_name),
    title: str(o.title) ?? "✉️", body: str(o.body) ?? "", xu: Math.max(0, num(o.xu) ?? 0),
    items: arr(o.items).map(parseMailItem).filter((x): x is MailItem => x !== null),
    read: o.read === true, claimed: o.claimed === true,
    createdMs: num(o.created_ms) ?? 0, expiresMs: num(o.expires_ms) ?? 0,
  };
}

export function parseMailBox(data: unknown): MailBox | null {
  const r = obj(data);
  const now = r ? num(r.server_now_ms) : null;
  if (!r || now === null) return null;
  return {
    unread: Math.max(0, num(r.unread) ?? 0),
    claimable: Math.max(0, num(r.claimable) ?? 0),
    mails: arr(r.mails).map(parseMail).filter((x): x is Mail => x !== null),
    serverNowMs: now,
    coins: num(r.coins),
  };
}

export function parseClaimAll(data: unknown): ClaimAll | null {
  const c = obj(obj(data)?.claimed_all);
  if (!c) return null;
  return {
    n: num(c.n) ?? 0, xu: num(c.xu) ?? 0,
    failed: arr(c.failed).map((f) => { const o = obj(f); const id = o ? num(o.id) : null; return id === null ? null : { id, error: str(o?.error) ?? "" }; })
      .filter((x): x is { id: number; error: string } => x !== null),
  };
}

export function parseRedeem(data: unknown): RedeemResult | null {
  const r = obj(data);
  if (!r || typeof r.ok !== "boolean") return null;
  return {
    ok: r.ok, error: str(r.error), left: num(r.left), retryS: num(r.retry_s), title: str(r.title),
    box: r.ok ? parseMailBox(r) : null,
  };
}

/** Is there anything to claim in this mail? */
export const hasAttachments = (m: Mail): boolean => m.xu > 0 || m.items.length > 0;
export const claimable = (m: Mail): boolean => !m.claimed && hasAttachments(m);
/** Only a claimed mail or one with nothing in it may be deleted. */
export const deletable = (m: Mail): boolean => m.claimed || !hasAttachments(m);

export const itemIcon = (k: MailItemKind): string => (k === "fish" ? "🐟" : k === "fashion" ? "👕" : k === "produce" ? "🥔" : "📦");

export function senderText(m: Mail): string {
  if (m.senderKind === "admin") return "Ban quản trị";
  if (m.senderKind === "player") return m.senderName ?? "Người chơi";
  if (m.kind === "market") return "Chợ người chơi";
  if (m.kind === "code") return "Code quà tặng";
  return "Hệ thống";
}

/** "Món quà: 1 000 xu, Trùn đất ×5". */
export function attachmentText(m: Mail): string {
  const parts: string[] = [];
  if (m.xu > 0) parts.push(`${m.xu.toLocaleString("vi-VN")} xu`);
  for (const i of m.items) parts.push(i.kind === "item" && i.qty > 1 ? `${i.name} ×${i.qty}` : i.name);
  return parts.join(", ");
}

/** Days (or hours) left before a mail expires. */
export function expiresText(expiresMs: number, nowMs: number): string {
  const h = Math.max(0, Math.floor((expiresMs - nowMs) / 3_600_000));
  return h >= 48 ? `còn ${Math.floor(h / 24)} ngày` : h >= 1 ? `còn ${h} giờ` : "sắp hết hạn";
}

/** A code as the server takes it: trimmed, upper case, A–Z 0–9 _ -, 3 to 32 characters (null when it cannot be one). */
export function normalizeCode(s: string): string | null {
  const c = s.trim().toUpperCase();
  return /^[A-Z0-9_-]{3,32}$/.test(c) ? c : null;
}

/** "an, Bình ; chi" → ["an", "Bình", "chi"] (no blank, no duplicate, case kept). */
export function parseUsernames(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of s.split(/[\s,;]+/)) {
    const u = raw.trim();
    if (u && !seen.has(u.toLowerCase())) { seen.add(u.toLowerCase()); out.push(u); }
  }
  return out;
}

// ---------------------------------------------------------------- texts

const REFUSALS: ReadonlyArray<[string, string]> = [
  ["already claimed", "Thư này đã nhận quà rồi."],
  ["mail expired", `Thư đã quá hạn ${MAIL_DAYS} ngày.`],
  ["no mail", "Không tìm thấy thư."],
  ["not claimed", "Hãy nhận quà trong thư trước khi xoá."],
  ["bucket full", "Giỏ cá đã đầy — bán bớt cá hoặc mua giỏ lớn hơn rồi nhận nhé. Thư vẫn còn đó."],
  ["bait full", "Hộp mồi đã đầy — dùng bớt mồi hoặc mua hộp lớn hơn rồi nhận nhé. Thư vẫn còn đó."],
  ["bag full", `Túi đồ chỉ chứa tối đa ${GIFT_ITEM_MAX_QTY} món mỗi loại — dùng bớt rồi nhận nhé. Thư vẫn còn đó.`],
  ["already owned", "Bạn đã có món đồ này rồi — bán hoặc tặng món đang có rồi nhận nhé."],
  ["asset gone", "Món đồ trong thư không còn."],
  ["invalid code", "Code không đúng."],
  ["code expired", "Code đã hết hạn."],
  ["code not started", "Code chưa đến ngày dùng."],
  ["code used up", "Code đã hết lượt."],
  ["already redeemed", "Bạn đã nhập code này rồi."],
  ["too many attempts", `Nhập sai quá ${CODE_MAX_FAILS} lần trong ${CODE_WINDOW_MIN} phút — chờ một lúc rồi thử lại nhé.`],
  // admin
  ["root role required", "Cần quyền quản trị."],
  ["bad title", "Tiêu đề 1–120 ký tự, nội dung tối đa 2 000 ký tự."],
  ["bad xu", `Xu từ 0 đến ${GIFT_MAX_XU.toLocaleString("vi-VN")}.`],
  ["bad items", `Tối đa ${GIFT_MAX_ITEMS} món, mỗi món 1–${GIFT_ITEM_MAX_QTY} (mồi, hạt giống, phân, thuốc, đạn, thức ăn thú; hoặc đồ thời trang).`],
  ["bad target", "Chọn gửi cho tất cả, hoặc nhập ít nhất một tên (tối đa 500)."],
  ["bad code", "Code gồm 3–32 ký tự A–Z, 0–9, _ hoặc -."],
  ["bad uses", "Số lượt từ 1 đến 1 000 000."],
  ["bad dates", "Ngày hết hạn phải sau ngày bắt đầu và sau bây giờ."],
  ["empty gift", "Code phải có xu hoặc ít nhất một món."],
  ["code exists", "Code này đã có."],
  ["not found", "Không tìm thấy."],
  ["account locked", "Tài khoản đang bị tạm khoá."],
  ["rate limited", "Thao tác quá nhanh — chờ một chút rồi thử lại nhé."],
  ["client outdated", "Trang đã cũ — tải lại trang nhé."],
];

export function mailErrorMessage(msg: string): string {
  for (const [k, text] of REFUSALS) if (msg.includes(k)) return text;
  return "Có lỗi, thử lại sau nhé.";
}

export const mailErrText = (e: unknown): string =>
  mailErrorMessage(e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e));

/** The line under the code box after a refused code. */
export function redeemText(r: RedeemResult): string {
  if (r.ok) return `🎁 Đã nhận "${r.title ?? "quà"}" — mở thư để lấy quà nhé!`;
  const base = mailErrorMessage(r.error ?? "");
  if (r.error === "too many attempts" && r.retryS !== null) return `${base} (còn ${Math.ceil(r.retryS / 60)} phút)`;
  if (r.left !== null && r.error !== "already redeemed" && r.left <= 3) return `${base} Còn ${r.left} lần thử.`;
  return base;
}

// ---------------------------------------------------------------- admin

export interface GiftItemInput { kind: "item" | "fashion"; ref: string; qty: number }
export interface GiftCode {
  id: number; code: string; title: string; xu: number; items: GiftItemInput[]; maxUses: number; uses: number;
  startsAt: string; expiresAt: string; enabled: boolean; createdBy: string | null;
}
export interface GiftBatch { id: number; title: string; xu: number; items: GiftItemInput[]; all: boolean; usernames: string[]; recipients: number; claimed: number; createdAt: string; sentBy: string | null }
export interface AdminCodes { codes: GiftCode[]; gifts: GiftBatch[] }

const giftItems = (v: unknown): GiftItemInput[] => arr(v).map((x) => {
  const o = obj(x);
  const kind = o ? str(o.kind) : null, ref = o ? str(o.ref) : null;
  return o && (kind === "item" || kind === "fashion") && ref ? { kind, ref, qty: num(o.qty) ?? 1 } as GiftItemInput : null;
}).filter((x): x is GiftItemInput => x !== null);

export function parseAdminCodes(data: unknown): AdminCodes | null {
  const r = obj(data);
  if (!r) return null;
  const codes = arr(r.codes).map((x) => {
    const o = obj(x);
    const id = o ? num(o.id) : null, code = o ? str(o.code) : null;
    if (!o || id === null || !code) return null;
    return {
      id, code, title: str(o.title) ?? "", xu: num(o.xu) ?? 0, items: giftItems(o.items), maxUses: num(o.max_uses) ?? 0,
      uses: num(o.uses) ?? 0, startsAt: str(o.starts_at) ?? "", expiresAt: str(o.expires_at) ?? "", enabled: o.enabled === true,
      createdBy: str(o.created_by),
    } satisfies GiftCode;
  }).filter((x): x is GiftCode => x !== null);
  const gifts = arr(r.gifts).map((x) => {
    const o = obj(x);
    const id = o ? num(o.id) : null;
    if (!o || id === null) return null;
    const t = obj(o.target);
    return {
      id, title: str(o.title) ?? "", xu: num(o.xu) ?? 0, items: giftItems(o.items), all: t?.all === true,
      usernames: arr(t?.usernames).map(str).filter((s): s is string => s !== null), recipients: num(o.recipients) ?? 0,
      claimed: num(o.claimed) ?? 0, createdAt: str(o.created_at) ?? "", sentBy: str(o.sent_by),
    } satisfies GiftBatch;
  }).filter((x): x is GiftBatch => x !== null);
  return { codes, gifts };
}

export interface SendResult { sent: number; missing: string[] }
export function parseSendResult(data: unknown): SendResult | null {
  const r = obj(data);
  const sent = r ? num(r.sent) : null;
  if (!r || sent === null) return null;
  return { sent, missing: arr(r.missing).map(str).filter((s): s is string => s !== null) };
}

/** "bait_worm x5, fert_urea x2, hat_red" → items (a ref starting with a shop kind's prefix is taken as a shop item
 *  unless marked "fashion:"). Unparseable parts are returned in `bad`. */
export function parseGiftItems(s: string): { items: GiftItemInput[]; bad: string[] } {
  const items: GiftItemInput[] = [];
  const bad: string[] = [];
  for (const raw of s.split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(/^(?:(item|fashion):)?\s*([a-z0-9_]+)\s*(?:[x×*]\s*(\d+))?$/i);
    if (!m) { bad.push(part); continue; }
    const kind = (m[1]?.toLowerCase() as "item" | "fashion" | undefined) ?? "item";
    const qty = m[3] ? Number(m[3]) : 1;
    if (qty < 1 || qty > GIFT_ITEM_MAX_QTY || (kind === "fashion" && qty !== 1)) { bad.push(part); continue; }
    items.push({ kind, ref: m[2], qty });
  }
  return { items, bad };
}
