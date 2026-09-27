import { supabase } from "@/lib/supabase";
import { parseHeat, type HeatState } from "@/lib/game/heat/model";
import { parseRain, type RainState } from "@/lib/game/rain/model";

/** `heat` (v18.10): the heat and swim state the heartbeat returns (absent from the other vitals answers). */
export interface VitalsState {
  hunger: number; thirst: number; faintedUntilMs: number | null; serverNowMs: number; heat?: HeatState | null; rain?: RainState | null;
  /** Faint ladder (0045): today's faints, how long the next one would last (null: the lock), the lock's end (VN midnight). */
  faintCount?: number; nextFaintS?: number | null; lockedUntilMs?: number | null;
}

/** Where I stand, for the heat (v18.10): the map and my rounded position (null: unknown, which counts as shade). */
export interface VitalsWhere { map: string; x: number; y: number }

export function parseVitals(raw: unknown): VitalsState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const hunger = n(r.hunger), thirst = n(r.thirst), now = n(r.server_now_ms);
  if (hunger === null || thirst === null || now === null) return null;
  const f = r.fainted_until_ms === null || r.fainted_until_ms === undefined ? null : n(r.fainted_until_ms);
  const out: VitalsState = { hunger, thirst, faintedUntilMs: f, serverNowMs: now };
  if (r.heat !== undefined) out.heat = parseHeat(r.heat);
  if (r.rain !== undefined) out.rain = parseRain(r.rain);                              // v18.9
  if (r.faint_count !== undefined) {                                                    // faint ladder
    out.faintCount = Math.max(0, n(r.faint_count) ?? 0);
    out.nextFaintS = n(r.next_faint_s);
    out.lockedUntilMs = n(r.locked_until_ms);
  }
  return out;
}

export function vitalsErrorMessage(msg: string): string | null {
  if (msg.includes("exhausted")) return "Bạn đã kiệt sức 5 lần hôm nay — mai quay lại nhé.";
  if (msg.includes("too hungry")) return "Bạn đói lả rồi — ra Chợ Lớn ăn gì đi đã!";
  if (msg.includes("too thirsty")) return "Bạn khát khô cổ — ra Chợ Lớn uống nước đi đã!";
  if (msg.includes("fainted")) return "Bạn đang ngất, chờ hồi sinh…";
  return null;
}

/** The heartbeat (0030: with the room the player is in, whose weather sets the thirst rate; 0033: and where I stand,
 *  for the heat). */
export async function vitalsTick(token: string, roomId: string, where?: VitalsWhere | null): Promise<VitalsState | null> {
  const { data, error } = await supabase.rpc("vitals_tick", {
    p_session_token: token, p_room_id: roomId,
    p_map: where?.map ?? null, p_x: where ? Math.round(where.x) : null, p_y: where ? Math.round(where.y) : null,
  });
  if (error) throw error;
  return parseVitals(data);
}
