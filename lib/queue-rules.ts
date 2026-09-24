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

export const DEFAULT_RECENT_HISTORY_LIMIT = 20;

/**
 * Calculates adaptive cooldown based on total songs in room history:
 * - 0 songs: 0
 * - 1..3 songs: 1 (only the track that literally just finished)
 * - 4..40 songs: floor(historyLength / 2) (50% of history)
 * - 40+ songs: maxLimit (capped at default 20)
 */
export function getEffectiveHistoryCooldown(
  historyLength: number,
  maxLimit = DEFAULT_RECENT_HISTORY_LIMIT
): number {
  if (historyLength <= 0) return 0;
  if (historyLength <= 3) return 1;
  return Math.min(maxLimit, Math.floor(historyLength / 2));
}

export function isDuplicateInQueue(
  queue: Array<{ youtube_video_id: string }>,
  currentVideoId: string | null | undefined,
  videoId: string
): boolean {
  if (!videoId) return false;
  if (currentVideoId && currentVideoId === videoId) return true;
  return queue.some((item) => item.youtube_video_id === videoId);
}

export function findRecentInHistory(
  history: Array<{ youtube_video_id: string }>,
  videoId: string,
  maxLimit = DEFAULT_RECENT_HISTORY_LIMIT
): { isRecent: boolean; index: number; effectiveLimit: number } {
  if (!videoId || history.length === 0) return { isRecent: false, index: -1, effectiveLimit: 0 };
  const effectiveLimit = getEffectiveHistoryCooldown(history.length, maxLimit);
  if (effectiveLimit <= 0) return { isRecent: false, index: -1, effectiveLimit: 0 };
  const idx = history.slice(0, effectiveLimit).findIndex((item) => item.youtube_video_id === videoId);
  return { isRecent: idx !== -1, index: idx, effectiveLimit };
}

export type DuplicateCheckResult =
  | { duplicate: "queue"; isCurrent?: boolean }
  | { duplicate: "history"; index: number }
  | null;

export function checkDuplicateTrack(
  videoId: string,
  queue: Array<{ youtube_video_id: string }> = [],
  currentVideoId: string | null | undefined = null,
  history: Array<{ youtube_video_id: string }> = [],
  maxHistoryLimit = DEFAULT_RECENT_HISTORY_LIMIT
): DuplicateCheckResult {
  if (!videoId) return null;
  if (currentVideoId && currentVideoId === videoId) {
    return { duplicate: "queue", isCurrent: true };
  }
  if (queue.some((item) => item.youtube_video_id === videoId)) {
    return { duplicate: "queue", isCurrent: false };
  }
  const hist = findRecentInHistory(history, videoId, maxHistoryLimit);
  if (hist.isRecent) {
    return { duplicate: "history", index: hist.index };
  }
  return null;
}

export function duplicateMessage(check: DuplicateCheckResult): string {
  if (!check) return "";
  if (check.duplicate === "queue") {
    return check.isCurrent ? "Bài này đang được phát trong phòng." : "Bài này đã có trong hàng chờ.";
  }
  return `Bài này vừa mới phát gần đây (${check.index === 0 ? "vừa phát xong" : `${check.index + 1} bài trước`}). Hãy chọn bài khác nhé!`;
}

export interface PlaylistDeduplicationResult<T extends { videoId: string }> {
  validItems: T[];
  internalDuplicates: number;
  queueDuplicates: number;
  historyDuplicates: number;
}

export function deduplicatePlaylistItems<T extends { videoId: string }>(
  items: T[],
  queue: Array<{ youtube_video_id: string }> = [],
  currentVideoId: string | null | undefined = null,
  history: Array<{ youtube_video_id: string }> = [],
  maxHistoryLimit = DEFAULT_RECENT_HISTORY_LIMIT
): PlaylistDeduplicationResult<T> {
  const seenIds = new Set<string>();
  let internalDuplicates = 0;
  let queueDuplicates = 0;
  let historyDuplicates = 0;
  const validItems: T[] = [];

  const queueSet = new Set<string>();
  if (currentVideoId) queueSet.add(currentVideoId);
  for (const q of queue) {
    if (q.youtube_video_id) queueSet.add(q.youtube_video_id);
  }

  const effectiveLimit = getEffectiveHistoryCooldown(history.length, maxHistoryLimit);
  const recentHistorySet = new Set<string>();
  for (const h of history.slice(0, effectiveLimit)) {
    if (h.youtube_video_id) recentHistorySet.add(h.youtube_video_id);
  }

  for (const item of items) {
    if (seenIds.has(item.videoId)) {
      internalDuplicates++;
      continue;
    }
    seenIds.add(item.videoId);

    if (queueSet.has(item.videoId)) {
      queueDuplicates++;
      continue;
    }

    if (recentHistorySet.has(item.videoId)) {
      historyDuplicates++;
      continue;
    }

    validItems.push(item);
  }

  return {
    validItems,
    internalDuplicates,
    queueDuplicates,
    historyDuplicates,
  };
}

