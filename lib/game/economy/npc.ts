// Thương lái (econ v2, 0100_econ_core.sql `_npc_sale` / `_npc_quota`): each Vietnam day an NPC buys an account's grind
// goods (fish, crabs & snails, rats, ores, logs, wild goods, dishes) at full price up to `full` xu of catalog value, at 50 %
// up to `half`, and at `tailPct` % beyond. Sale RPCs answer `npc` (the day after the sale) and `npc_cut` (the xu the
// thương lái kept on that sale); farm harvests are not counted.

export interface NpcQuota { gross: number; full: number; half: number; tailPct: number }

/** `npc` from a sale or state answer; anything malformed gives null (a server before econ v2). */
export function parseNpcQuota(v: unknown): NpcQuota | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const gross = Number(o.gross), full = Number(o.full), half = Number(o.half), tailPct = Number(o.tail_pct);
  if (![gross, full, half, tailPct].every(Number.isFinite)) return null;
  return { gross, full, half: Math.max(full, half), tailPct };
}

/** What the NPC pays per 100 xu of goods right now: 100, 50 or the tail. */
export function npcRate(q: NpcQuota): number {
  return q.gross < q.full ? 100 : q.gross < q.half ? 50 : q.tailPct;
}

/** What `gross` xu of goods pay now, the same split as `_npc_sale` (rounded down once, like the SQL). */
export function npcPay(q: NpcQuota, gross: number): number {
  if (gross <= 0) return 0;
  const a = Math.max(0, Math.min(q.gross + gross, q.full) - q.gross);
  const b = Math.max(0, Math.min(q.gross + gross, q.half) - Math.max(q.gross, q.full));
  return Math.floor(a + b * 0.5 + (gross - a - b) * q.tailPct / 100);
}

const xu = (n: number): string => n.toLocaleString("vi-VN");

/** "Thương lái hôm nay: đã mua 12.300 / 20.000 xu đủ giá" — or, past the mark, what the NPC pays now. */
export function npcQuotaLine(q: NpcQuota): string {
  if (q.gross < q.full) return `Thương lái hôm nay: đã mua ${xu(q.gross)} / ${xu(q.full)} xu đủ giá`;
  return `Thương lái hôm nay đã mua ${xu(q.gross)} xu hàng: giờ chỉ trả ${npcRate(q)}% giá`;
}

/** The note after a sale the thương lái cut, or null when it paid in full. */
export function npcCutNote(cut: number): string | null {
  return cut > 0 ? `Thương lái đã mua nhiều hôm nay nên bớt ${xu(cut)} xu.` : null;
}
