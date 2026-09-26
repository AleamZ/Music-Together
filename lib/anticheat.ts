import { serverNow, syncClock } from "@/lib/game/farm/clock";

// The client half of the anti-cheat layer (spec §12.1): the envelope a flagged RPC returns instead of raising, the lock
// a guarded RPC raises, the Vietnamese texts of the warning, the lock and the ban (§12.2), and a small hub the game
// shell listens to. Pure, apart from the hub and screenAnswer.

/** The `anticheat` envelope of a flagged answer (§9.1). Times are ms since the epoch on the server's clock. */
export interface AnticheatInfo {
  /** The signal (§7.2, §7.4). */
  code: string;
  /** 0 recorded only · 1 warning and a 5-minute lock · 2 ban. */
  strike: 0 | 1 | 2;
  /** The refusal the call stands for; null for finish_cast. */
  error: string | null;
  /** Strike 1: the end of the lock. */
  lockedUntil: number | null;
  banned: boolean;
  serverNow: number | null;
}

const time = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** The envelope of an RPC answer; null when there is none or it cannot be read. */
export function parseAnticheat(data: unknown): AnticheatInfo | null {
  const a = data && typeof data === "object" ? (data as { anticheat?: unknown }).anticheat : null;
  if (!a || typeof a !== "object") return null;
  const r = a as Record<string, unknown>;
  const code = r.code;
  const strike = r.strike;
  if (typeof code !== "string" || (strike !== 0 && strike !== 1 && strike !== 2)) return null;
  return {
    code, strike, error: typeof r.error === "string" ? r.error : null, lockedUntil: time(r.locked_until),
    banned: r.banned === true, serverNow: time(r.server_now),
  };
}

/** A flagged call's refusal. Its message is the refusal the call stands for, so the fishing and farm error texts
 *  translate a strike-0 envelope as before (§13). */
export class AnticheatError extends Error {
  readonly info: AnticheatInfo;
  constructor(info: AnticheatInfo) {
    super(info.error ?? "anticheat");
    this.name = "AnticheatError";
    this.info = info;
  }
}

/** The seconds left of the lock an `account locked` refusal reports in its details; null for any other error. */
export function lockSeconds(err: unknown): number | null {
  const e = (err && typeof err === "object" ? err : {}) as { message?: unknown; details?: unknown };
  const n = typeof e.details === "number" ? e.details
    : typeof e.details === "string" && e.details.trim() !== "" ? Number(e.details) : NaN;
  return e.message === "account locked" && Number.isFinite(n) ? n : null;
}

export const WARN_TITLE = "⚠️ Cảnh báo gian lận";
export const WARN_BODY = "Hệ thống vừa ghi nhận một thao tác mà trò chơi bình thường không thể tạo ra (ví dụ: sửa dữ liệu bằng DevTools).";
export const WARN_LOCK = "Tài khoản của bạn bị tạm khoá câu cá, làm ruộng, bắt cua mò ốc, săn chuột, mua bán đất, mua bán ở các tiệm và đánh bài trong 5 phút. Trò chuyện và nghe nhạc vẫn dùng bình thường.";
export const WARN_REPEAT = "Nếu tái phạm trong 30 ngày, tài khoản sẽ bị khoá vĩnh viễn và dữ liệu trò chơi có thể bị xoá.";
export const WARN_OK = "Tôi đã hiểu";
export const BAN_TITLE = "🚫 Tài khoản bị khoá vĩnh viễn";
export const BAN_BODY = "Hệ thống ghi nhận thao tác gian lận lần thứ hai trong 30 ngày, nên tài khoản đã bị khoá.";
export const BAN_WIPE = "Quản trị viên sẽ xem xét và có thể xoá toàn bộ dữ liệu trò chơi của tài khoản (xu, đồ câu, cá, kỷ lục, lúa, đất, chó).";
export const BAN_OK = "Đăng xuất";

/** Whole seconds, at least 1. */
const whole = (sec: number): number => Math.max(1, Math.ceil(Number.isFinite(sec) ? sec : 0));

/** "59 giây", "1 phút", "2 phút 5 giây". */
export function durationVi(sec: number): string {
  const n = whole(sec);
  const m = Math.floor(n / 60);
  const s = n % 60;
  if (m === 0) return `${s} giây`;
  return s === 0 ? `${m} phút` : `${m} phút ${s} giây`;
}

/** The toast of an action refused during the lock. */
export function lockText(sec: number): string {
  return `🔒 Tài khoản đang bị tạm khoá vì thao tác bất thường — còn ${durationVi(sec)}.`;
}

/** The player card's countdown: "🔒 4:07". */
export function chipText(sec: number): string {
  const n = whole(sec);
  return `🔒 ${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

/** The chip's title and aria-label. */
export function chipLabel(sec: number): string {
  return `Tạm khoá trò chơi — còn ${durationVi(sec)}`;
}

/** Why the warning or the ban came, for the modal's "Lý do:" line. */
export function reasonText(code: string): string {
  switch (code) {
    case "reel_too_fast": return "Báo kéo được cá nhanh hơn mức trò chơi cho phép.";
    case "quality_range": return "Gửi điểm cấy/gặt ngoài phạm vi của trò chơi.";
    default: return "Gửi dữ liệu mà giao diện trò chơi không thể tạo ra.";
  }
}

/** What the hub passes on: a strike (1 or 2) from an envelope, a running lock, or that no lock runs. The code of a lock
 *  is known from fishing_state's `lock`, and unknown (null) when the lock comes from an `account locked` refusal. */
export type AnticheatEvent =
  | { kind: "strike"; info: AnticheatInfo }
  | { kind: "lock"; until: number; code: string | null }
  | { kind: "unlock" };

const listeners = new Set<(e: AnticheatEvent) => void>();

function emit(e: AnticheatEvent): void {
  for (const fn of [...listeners]) fn(e);
}

export function reportAnticheat(info: AnticheatInfo): void {
  emit({ kind: "strike", info });
}

/** A lock running until `untilMs` on the server's clock. */
export function reportLock(untilMs: number, code: string | null): void {
  emit({ kind: "lock", until: untilMs, code });
}

/** A fishing state without a lock: a pardon or a switch to log mode may have ended it early, so the chip goes. */
export function reportNoLock(): void {
  emit({ kind: "unlock" });
}

export function subscribeAnticheat(fn: (e: AnticheatEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** What the fishing and farm `call()` do first with an RPC answer (§12.1): an `account locked` refusal reports the
 *  lock; an envelope sets the server clock and reports a strike of 1 or 2. Returns the envelope, or null. */
export function screenAnswer(data: unknown, error: unknown): AnticheatInfo | null {
  const sec = lockSeconds(error);
  if (sec !== null) reportLock(serverNow() + sec * 1000, null);
  if (error) return null;
  const info = parseAnticheat(data);
  if (!info) return null;
  syncClock(info.serverNow);
  if (info.strike > 0) reportAnticheat(info);
  return info;
}
