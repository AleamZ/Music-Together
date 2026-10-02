import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { outdatedFetch } from "@/lib/client-build";

/** The Supabase Auth client (email accounts, 0112) — separate from the game client in lib/supabase.ts on purpose.
 *  The game client stays anon with no persisted session: every table read and realtime policy is `to anon`, so a
 *  signed-in JWT on it would hide the game's rows. This one persists the Supabase Auth session (its own storage key,
 *  PKCE) and is used only for supabase.auth.* and the three auth-only RPCs (game_session_from_auth,
 *  account_create_for_auth, account_link_auth), which read auth.uid() from its JWT. The /auth pages handle the
 *  redirect themselves, so it does not read the URL on its own. */
export const AUTH_STORAGE_KEY = "music-together:sb-auth";

export const authClient: SupabaseClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storageKey: AUTH_STORAGE_KEY,
    },
    global: {
      headers: { "X-Client-Info": `music-together/${process.env.NEXT_PUBLIC_CLIENT_BUILD ?? "dev"}` },
      fetch: outdatedFetch(),
    },
  },
);
