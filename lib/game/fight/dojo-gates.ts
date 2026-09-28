// v20.2: what the dojo panel may offer, from the server's state (the server re-checks everything; these only explain
// a disabled button and count down to when it opens). Pure.

import { formatXu } from "@/lib/game/fishing/catalog";
import type { Look } from "@/lib/game/types";
import { MARTIAL, TUITION, beltOf, examFor, martialByKey, uniformStyle } from "./dojo";
import type { DojoState, Enrollment } from "./rpc";

/** "1 giờ 5 phút", "12 phút", "40 giây". */
export function waitText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} giây`;
  const m = Math.ceil(s / 60);
  if (m >= 48 * 60) return `${Math.floor(m / 1440)} ngày`;
  const h = Math.floor(m / 60);
  return h > 0 ? `${h} giờ ${m % 60} phút` : `${m} phút`;
}

export const enrollmentOf = (state: DojoState | null, key: string): Enrollment | null =>
  state?.enrollments.find((e) => e.style === key) ?? null;

export interface Gate {
  enabled: boolean;
  label: string;
  /** Why it is disabled (null when enabled). */
  reason: string | null;
  /** An exam of this style is live: resume it instead. */
  resume?: "kata" | "spar";
}

export function enrollGate(state: DojoState | null, key: string, coins: number | null): Gate {
  const label = `Nhập môn · ${formatXu(TUITION)}`;
  if (!state) return { enabled: false, label, reason: "Đang tải…" };
  if (enrollmentOf(state, key)) return { enabled: false, label, reason: "Đã nhập môn" };
  if (coins !== null && coins < TUITION) return { enabled: false, label, reason: "Không đủ xu" };
  return { enabled: true, label, reason: null };
}

export function examGate(state: DojoState | null, key: string, coins: number | null, nowMs: number): Gate {
  const m = martialByKey(key);
  const e = enrollmentOf(state, key);
  if (!state || !m) return { enabled: false, label: "Thi lên đai", reason: "Đang tải…" };
  if (!e) return { enabled: false, label: "Thi lên đai", reason: "Chưa nhập môn" };
  if (e.rank >= 4) return { enabled: false, label: "Thi lên đai", reason: "Đã lên đai cao nhất" };
  const exam = examFor(e.rank + 1)!;
  const label = `Thi lên ${beltOf(m.id, e.rank + 1).name} · ${formatXu(exam.fee)}`;
  if (state.exam) {
    if (state.exam.style === key) {
      const resume = state.exam.status;
      return { enabled: true, label: resume === "spar" ? "Vào sàn tập với thầy" : "Tiếp tục bài quyền", reason: null, resume };
    }
    return { enabled: false, label, reason: `Đang thi dở ${martialByKey(state.exam.style)?.name ?? ""}`.trim() };
  }
  if (e.cooldownUntilMs !== null && e.cooldownUntilMs > nowMs) {
    return { enabled: false, label, reason: `Thi lại sau ${waitText(e.cooldownUntilMs - nowMs)}` };
  }
  if (e.nextExamMs !== null && e.nextExamMs > nowMs) {
    return { enabled: false, label, reason: `Thi được sau ${waitText(e.nextExamMs - nowMs)}` };
  }
  if (state.wearing !== m.uniform) return { enabled: false, label, reason: "Mặc võ phục để thi" };
  if (coins !== null && coins < exam.fee) return { enabled: false, label, reason: "Không đủ xu" };
  return { enabled: true, label, reason: null };
}

export function practiceGate(state: DojoState | null, key: string): Gate {
  const m = martialByKey(key);
  if (!state || !m) return { enabled: false, label: "Luyện tập", reason: "Đang tải…" };
  if (!enrollmentOf(state, key)) return { enabled: false, label: "Luyện tập", reason: "Chưa nhập môn" };
  if (state.wearing !== m.uniform) return { enabled: false, label: "Luyện tập", reason: "Mặc võ phục trước" };
  return { enabled: true, label: "Luyện tập", reason: null };
}

/** Practice fights as the worn uniform's style at its rank when enrolled, else Tự do (plan ruling P15). */
export function practiceFighter(look: Look, state: DojoState | null): { fighter: { style: number; rank: number }; styleName: string } {
  const m = uniformStyle(look.outfit);
  const e = m ? enrollmentOf(state, m.key) : null;
  if (!m || !e) return { fighter: { style: 0, rank: 0 }, styleName: "Tự do" };
  return { fighter: { style: m.id, rank: e.rank }, styleName: `${m.name} · ${beltOf(m.id, e.rank).name}` };
}

export const MARTIAL_TABS = MARTIAL.map((m) => ({ id: m.id, key: m.key, name: m.name }));
