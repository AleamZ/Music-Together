import { supabase } from "@/lib/supabase";
import { readGfx, type GfxMode } from "@/lib/game/diorama/flag";

// 0088's app_flags(): the server's switches. 0090 (dual mode): 'unified_world' means "world mode is AVAILABLE" (default
// on) — the server judges each claim by the model of the client that sent it (pos_report_w = the world, pos_report = the
// portal graph), so 2D and 3D clients coexist on the same data. Read once per page; a failure (an older server without
// 0088) reads as off.

let flags: Promise<Record<string, boolean>> | null = null;

export function appFlags(): Promise<Record<string, boolean>> {
  if (!flags) {
    flags = (async () => {
      try {
        const { data, error } = await supabase.rpc("app_flags");
        return !error && data && typeof data === "object" ? (data as Record<string, boolean>) : {};
      } catch {
        return {};
      }
    })();
  }
  return flags;
}

export async function unifiedWorldOn(): Promise<boolean> {
  return (await appFlags()).unified_world === true;
}

/** 0090: this client plays the world (one world map, pos_report_w, vehicles at speed_mul) only when the player picked
 *  the 3D graphics AND the server offers world mode; everything else is the 2D per-map game, exactly as before. */
export function worldModeFor(gfx: GfxMode, flagOn: boolean): boolean {
  return gfx === "3d" && flagOn;
}

// The 3D world failed to load on this page (GameShell's worldFailed): the client falls back to 2D entirely — the
// per-map game AND the 2D claims (pos_report) — until the page reloads.
let worldFailed = false;

/** GameShell: the world view could not be built; from now on this page plays (and reports) 2D. */
export function markWorldFailed(): void {
  worldFailed = true;
}

/** worldModeFor with this browser's graphics setting and the server's flag (never after the world failed to load). */
export async function worldModeOn(): Promise<boolean> {
  if (worldFailed) return false;
  const on = await unifiedWorldOn();
  return !worldFailed && worldModeFor(readGfx(), on);
}

/** Tests: forget the cached flags (and a world failure). */
export function resetAppFlags(): void {
  flags = null;
  worldFailed = false;
}
