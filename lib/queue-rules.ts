/** Client-side mirror of the SQL `_check_queue_rules` — for friendly messages BEFORE the RPC. The RPC remains the authority. */
export interface RoomRules { max_duration_seconds: number; banned_keywords: string[] }

export type RuleViolation =
  | { code: "too_long"; maxSeconds: number }
  | { code: "unknown_duration"; maxSeconds: number }
  | { code: "banned"; keyword: string };

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

const minutes = (s: number) => Math.round(s / 60);

export function ruleMessage(v: RuleViolation): string {
  switch (v.code) {
    case "too_long": return `Video dài hơn giới hạn ${minutes(v.maxSeconds)} phút của phòng.`;
    case "unknown_duration": return `Không xác định được thời lượng — phòng đang giới hạn ${minutes(v.maxSeconds)} phút.`;
    case "banned": return `Tiêu đề chứa từ khóa bị cấm: "${v.keyword}".`;
  }
}

/** Map a Supabase RPC error raised by `_check_queue_rules` (errcode 23514) to a violation; anything else → null. */
export function violationFromRpcError(err: unknown, rules: RoomRules): RuleViolation | null {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (!e || typeof e !== "object" || e.code !== "23514" || typeof e.message !== "string") return null;
  if (e.message === "video too long") return { code: "too_long", maxSeconds: rules.max_duration_seconds };
  if (e.message === "duration unknown") return { code: "unknown_duration", maxSeconds: rules.max_duration_seconds };
  const m = /^banned keyword: (.+)$/.exec(e.message);
  return m ? { code: "banned", keyword: m[1] } : null;
}
