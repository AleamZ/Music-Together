import { supabase } from "@/lib/supabase";
import { parseBetaMe, type BetaMe } from "./frame";

/** 0118 beta_me: my Beta tier, title and running boosts (a read). A database without 0118 answers "not Beta". */
export async function fetchBetaMe(token: string): Promise<BetaMe> {
  const { data, error } = await supabase.rpc("beta_me", { p_session_token: token });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return parseBetaMe(null);
    throw error;
  }
  return parseBetaMe(data);
}

/** The β tiers of these accounts (characters.beta_tier); accounts without one are absent. Empty without 0118. */
export async function fetchBetaTiers(accountIds: readonly string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (accountIds.length === 0) return out;
  const { data, error } = await supabase.from("characters").select("account_id, beta_tier").in("account_id", [...accountIds]);
  if (error) return out;
  for (const r of (data ?? []) as { account_id: string; beta_tier: number | null }[]) {
    if (typeof r.beta_tier === "number") out.set(r.account_id, r.beta_tier);
  }
  return out;
}

export interface BetaPlayer {
  username: string; net_worth: number; tier: number; eligible: boolean; is_root: boolean; is_banned: boolean;
  breakdown: Record<string, number>; xu: number; items: string[]; granted: boolean;
}
export interface BetaStatus {
  snapshot_at: string | null; snapshot_runs: number; applied_at: string | null; summary: Record<string, unknown> | null;
  unclassified: string[]; accounts_now: number; new_since_snapshot: number;
  tiers: { tier: number; eligible: number; excluded: number; xu: number; items: string[] }[];
  totals: { accounts: number; eligible: number; excluded: number; net_worth: number; starter_xu: number };
  top: { username: string; net_worth: number; tier: number; eligible: boolean }[];
  players: BetaPlayer[];
}

export async function adminBetaStatus(token: string): Promise<BetaStatus> {
  const { data, error } = await supabase.rpc("admin_beta_status", { p_session_token: token });
  if (error) throw error;
  return data as BetaStatus;
}
export async function adminBetaSnapshot(token: string): Promise<BetaStatus> {
  const { data, error } = await supabase.rpc("admin_beta_snapshot", { p_session_token: token });
  if (error) throw error;
  return data as BetaStatus;
}
export async function adminBetaReset(token: string, confirm: string): Promise<{ ok: boolean; already: boolean; summary: unknown }> {
  const { data, error } = await supabase.rpc("admin_beta_reset", { p_session_token: token, p_confirm: confirm });
  if (error) throw error;
  return data as { ok: boolean; already: boolean; summary: unknown };
}

/** Vietnamese text for the reset RPCs' errors. */
export function betaErrText(e: unknown): string {
  const msg = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  if (msg.includes("confirm phrase")) return "Cụm xác nhận chưa đúng — gõ chính xác: RESET BETA";
  if (msg.includes("no snapshot")) return "Chưa chốt sổ (bước 1) — hãy chạy chốt sổ trước.";
  if (msg.includes("already applied")) return "Đã reset rồi — không thể chốt sổ lại.";
  if (msg.includes("unclassified tables")) return `Có bảng dữ liệu chưa được phân loại, reset bị chặn: ${msg}`;
  if (msg.includes("root role required")) return "Chỉ tài khoản root được làm việc này.";
  return msg;
}
