import { supabase } from "@/lib/supabase";

// 0088's app_flags(): the server's switches. 'unified_world' (default off) says the server judges positions in world px
// and takes pos_report_w. Read once per page; a failure (an older server without 0088) reads as off.

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

/** Tests: forget the cached flags. */
export function resetAppFlags(): void {
  flags = null;
}
