/** Client-side mirror of the SQL `_check_queue_rules` — for friendly messages BEFORE the RPC. The RPC remains the authority. */
export interface RoomRules { max_duration_seconds: number; banned_keywords: string[]; max_orders_per_member: number }

export type RuleViolation =
  | { code: "too_long"; maxSeconds: number }
  | { code: "unknown_duration"; maxSeconds: number }
  | { code: "banned"; keyword: string }
  | { code: "order_limit"; max: number };

/** lower-case + strip diacritics (NFD, drop combining marks) + đ→d, matching Postgres `lower(unaccent(...))`. */
export function normalizeForMatch(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

export function checkQueueRules(
  rules: RoomRules,
  item: { title: string; durationSeconds: number | null },
): RuleViolation | null {
  const max = rules.max_duration_seconds;
  if (max > 0) {
    if (item.durationSeconds == null) return { code: "unknown_duration", maxSeconds: max };
    if (item.durationSeconds > max) return { code: "too_long", maxSeconds: max };
  }
  const title = normalizeForMatch(item.title ?? "");
  for (const kw of rules.banned_keywords) {
    const k = normalizeForMatch(kw.trim());
    if (k && title.includes(k)) return { code: "banned", keyword: kw };
  }
  return null;
}

/** Rows this account has waiting (pending + approved), excluding the playing one — mirrors SQL `_order_count`. */
export function countMyOrders(
  queue: Array<{ id: string; added_by_account_id: string | null }>,
  accountId: string | null, currentId: string | null,
): number {
  if (!accountId) return 0;
  return queue.filter((q) => q.added_by_account_id === accountId && q.id !== currentId).length;
}

/** null = unlimited (limit 0, or admin/dj); else max(0, limit - mine) — mirrors SQL `_orders_remaining`. */
export function ordersRemaining(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): number | null {
  const max = rules.max_orders_per_member;
  if (max <= 0 || exempt) return null;
  return Math.max(0, max - mine);
}

export function orderLimitViolation(rules: Pick<RoomRules, "max_orders_per_member">, mine: number, exempt: boolean): RuleViolation | null {
  return ordersRemaining(rules, mine, exempt) === 0 ? { code: "order_limit", max: rules.max_orders_per_member } : null;
}

const minutes = (s: number) => Math.round(s / 60);

export function ruleMessage(v: RuleViolation): string {
  switch (v.code) {
    case "too_long": return `Video dài hơn giới hạn ${minutes(v.maxSeconds)} phút của phòng.`;
    case "unknown_duration": return `Không xác định được thời lượng — phòng đang giới hạn ${minutes(v.maxSeconds)} phút.`;
    case "banned": return `Tiêu đề chứa từ khóa bị cấm: "${v.keyword}".`;
    case "order_limit": return `Bạn đã đặt đủ ${v.max} bài — chờ bài phát xong rồi đặt tiếp.`;
  }
}

/** Map a Supabase RPC error raised by `_check_queue_rules` or the order limit (errcode 23514) to a violation; anything else → null. */
export function violationFromRpcError(err: unknown, rules: RoomRules): RuleViolation | null {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object" || e.code !== "23514" || typeof e.message !== "string") return null;
  if (e.message === "video too long") return { code: "too_long", maxSeconds: rules.max_duration_seconds };
  if (e.message === "duration unknown") return { code: "unknown_duration", maxSeconds: rules.max_duration_seconds };
  if (e.message === "order limit reached") return { code: "order_limit", max: rules.max_orders_per_member };
  const m = /^banned keyword: (.+)$/.exec(e.message);
  return m ? { code: "banned", keyword: m[1] } : null;
}
