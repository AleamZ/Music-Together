// Anti-cheat v2 (0057): the server keeps where each account stands. Every place the client says where it is — the
// heartbeat, an arrival on a map (pos_report), a cast, a net throw, a jump, a rescue, a sale at Chợ Lớn — is a claim the
// server checks against the last one it accepted: reachable over the town's portals in the time since, at VMAX. The
// constants mirror 0057_server_position.sql (tests/unit/anticheat-v2-position.test.ts pins them, and the SQL geometry
// against lib/game/maps).
import { screenAnswer } from "@/lib/anticheat";
import { supabase } from "@/lib/supabase";
import { unifiedWorldOn } from "@/lib/game/world/flag";
import { toWorld, type ZoneId } from "@/lib/game/world/zones";

export const POS = {
  /** px/s: walk 70 × car 2.8 × pet 1.2 × rest 1.07 ≈ 252, rounded up. */
  vmax: 260,
  /** Slack: px off every path, px more per portal hop, seconds on top of the time since the last claim. */
  slackPx: 64,
  hopSlackPx: 40,
  slackS: 1,
  /** A road hop takes at least this share of the fastest trip the account could take. */
  roadFactor: 0.9,
  /** The refusal within an hour that is a hard flag. */
  repeat: 30,
  /** Always accepted: the hall's spawn (entering game mode, a faint), within this many px. */
  hallSpawn: { x: 612, y: 300 },
  spawnTol: 16,
  /** Where the market sales claim to stand: Vựa cá and Vựa nông sản's counters. */
  fishDepot: { x: 80, y: 360 },
  farmDepot: { x: 720, y: 360 },
  /** The real seconds a vitals gap drains, at most (0057: was 120). */
  drainCapS: 1800,
} as const;

/** Tells the server where I arrived (every map change). Best effort: a failure only means the next claim is judged
 *  against an older position, which is more lenient. A strike's envelope still reaches the modal (screenAnswer). */
export async function posReport(token: string, map: string, x: number, y: number): Promise<void> {
  try {
    // 0088: with the unified world on, a map that is a zone reports its world px (pos_report_w); else the old claim
    const w = (await unifiedWorldOn()) ? toWorld(map as ZoneId, { x, y }) : null;
    const { data, error } = w
      ? await supabase.rpc("pos_report_w", { p_session_token: token, p_wx: Math.round(w.x), p_wy: Math.round(w.y) })
      : await supabase.rpc("pos_report", { p_session_token: token, p_map: map, p_x: Math.round(x), p_y: Math.round(y) });
    screenAnswer(data, error);
  } catch {
    /* the next claim is judged against the older position */
  }
}

/** P2 world mode: where I stand in world px (pos_report_w: the server finds the zone). The heartbeat while walking the
 *  world, and an arrival onto it that is not a zone's own spot (the mine mouth). Best effort, like posReport. */
export async function posReportWorld(token: string, wx: number, wy: number): Promise<void> {
  try {
    const { data, error } = await supabase.rpc("pos_report_w", { p_session_token: token, p_wx: Math.round(wx), p_wy: Math.round(wy) });
    screenAnswer(data, error);
  } catch {
    /* the next claim is judged against the older position */
  }
}

/** The Vietnamese text of a refused position claim; null for any other message. */
export function positionErrorText(msg: string): string | null {
  if (msg === "too far") return "Bạn đứng xa chỗ đó quá — lại gần rồi thử lại nhé.";
  if (msg === "not at market") return "Phải ra tận vựa ở Chợ Lớn mới bán được.";
  return null;
}
