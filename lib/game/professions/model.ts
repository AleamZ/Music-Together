// Pure rules of the professions panel and the stamina bar (0077_professions.sql is authoritative).
import { MAX_LEVEL, SKILL_NODES, type BuffKey, type ProfId, type SkillNode } from "./catalog";

/** Total xp the level L needs: 50·L·(L+1) (0077 _prof_level). */
export const xpForLevel = (level: number): number => 50 * level * (level + 1);

export function levelOf(xp: number): number {
  const x = Math.max(0, Math.floor(xp || 0));
  return Math.min(MAX_LEVEL, Math.floor((Math.sqrt(1 + (4 * x) / 50) - 1) / 2));
}

/** The progress toward the next level, 0..1 (1 at the cap). */
export function levelProgress(xp: number): number {
  const l = levelOf(xp);
  if (l >= MAX_LEVEL) return 1;
  const a = xpForLevel(l), b = xpForLevel(l + 1);
  return Math.max(0, Math.min(1, (xp - a) / (b - a)));
}

export interface ProfRow { id: ProfId; xp: number; level: number; spent: number }
export interface StaminaState { value: number; max: number; ratePerS: number; resting: boolean; serverNowMs: number }
export interface BuffRow { key: BuffKey; value: number; untilMs: number }
export interface ProfState {
  main: ProfId | null; switchAtMs: number | null; switchFee: number; resetFee: number;
  profs: ProfRow[]; skills: string[]; buffs: BuffRow[]; stamina: StaminaState | null; serverNowMs: number;
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

export function parseStamina(raw: unknown): StaminaState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const value = num(r.value), max = num(r.max), rate = num(r.rate_per_s), now = num(r.server_now_ms);
  if (value === null || max === null || rate === null || now === null) return null;
  return { value, max, ratePerS: rate, resting: r.resting === true, serverNowMs: now };
}

export function parseProfState(raw: unknown): ProfState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.profs) || !Array.isArray(r.skills)) return null;
  const profs: ProfRow[] = [];
  for (const p of r.profs as Record<string, unknown>[]) {
    if (typeof p?.id !== "string") continue;
    profs.push({ id: p.id as ProfId, xp: num(p.xp) ?? 0, level: num(p.level) ?? 0, spent: num(p.spent) ?? 0 });
  }
  const buffs: BuffRow[] = Array.isArray(r.buffs)
    ? (r.buffs as Record<string, unknown>[]).flatMap((b) =>
      typeof b?.key === "string" && num(b.value) !== null && num(b.until_ms) !== null
        ? [{ key: b.key as BuffKey, value: num(b.value)!, untilMs: num(b.until_ms)! }] : [])
    : [];
  return {
    main: typeof r.main === "string" ? (r.main as ProfId) : null,
    switchAtMs: num(r.switch_at_ms), switchFee: num(r.switch_fee) ?? 0, resetFee: num(r.reset_fee) ?? 0,
    profs, skills: (r.skills as unknown[]).filter((s): s is string => typeof s === "string"), buffs,
    stamina: parseStamina(r.stamina), serverNowMs: num(r.server_now_ms) ?? Date.now(),
  };
}

/** The bar now: the server's value plus the regen since it answered (`elapsedMs`), capped. */
export function staminaNow(s: StaminaState, elapsedMs: number): number {
  return Math.min(s.max, Math.max(0, s.value + (Math.max(0, elapsedMs) / 1000) * s.ratePerS));
}

export type NodeStatus = "learned" | "open" | "locked" | "poor";

/** A node for the panel: learned; open (learnable now); poor (prerequisite met, not enough points); locked. */
export function nodeStatus(node: SkillNode, learned: ReadonlySet<string>, pointsLeft: number): NodeStatus {
  if (learned.has(node.id)) return "learned";
  if (node.req !== null && !learned.has(node.req)) return "locked";
  return pointsLeft >= node.cost ? "open" : "poor";
}

export const nodesOf = (prof: ProfId): SkillNode[] => SKILL_NODES.filter((n) => n.prof === prof);

export const pointsLeft = (row: ProfRow | undefined): number => (row ? Math.max(0, row.level - row.spent) : 0);

/** The speed buff's walk factor (≤ +10 %), for the engine. */
export function speedBuffFactor(buffs: readonly BuffRow[], nowMs: number): number {
  const b = buffs.find((x) => x.key === "speed" && x.untilMs > nowMs);
  return 1 + Math.min(10, Math.max(0, b?.value ?? 0)) / 100;
}

export function professionErrorMessage(msg: string): string {
  if (msg.includes("switch cooldown")) return "Mới đổi nghề — chờ đủ 24 giờ rồi đổi tiếp nhé.";
  if (msg.includes("same profession")) return "Bạn đang làm nghề này rồi.";
  if (msg.includes("insufficient funds")) return "Không đủ xu.";
  if (msg.includes("skill locked")) return "Cần học kỹ năng trước đó đã.";
  if (msg.includes("not enough points")) return "Chưa đủ điểm kỹ năng — lên cấp nghề thêm nhé.";
  if (msg.includes("already learned")) return "Đã học kỹ năng này rồi.";
  if (msg.includes("nothing to reset")) return "Chưa học kỹ năng nào để tẩy.";
  if (msg.includes("account locked")) return "Tài khoản đang bị khóa tạm thời.";
  return "Có lỗi, thử lại sau nhé.";
}
