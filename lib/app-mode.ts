/**
 * The app's mode, from NEXT_PUBLIC_APP_MODE ("dev" | "prod"). Unset: "prod" in a production build, "dev" under
 * `next dev` — so forgetting the variable on the host never leaves the dev tools open.
 *
 * prod turns on the DevtoolsGuard (blocks the DevTools shortcuts and the context menu, covers the game while
 * DevTools is open, switches off the React DevTools hook) and strips console.log from the bundle. It is a deterrent
 * only: the browser is the player's, so anything that matters is checked on the server (e.g. the reel replay).
 */
export type AppMode = "dev" | "prod";

export function appMode(raw = process.env.NEXT_PUBLIC_APP_MODE, nodeEnv = process.env.NODE_ENV): AppMode {
  if (raw === "dev" || raw === "prod") return raw;
  return nodeEnv === "production" ? "prod" : "dev";
}

export const APP_MODE: AppMode = appMode();
export const IS_PROD = APP_MODE === "prod";
