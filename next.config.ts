import type { NextConfig } from "next";

/** The client build sent in X-Client-Info (anti-cheat spec §12.6): the host's commit, else the build time (UTC). */
function clientBuild(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  return new Date().toISOString().replace(/\D/g, "").slice(0, 12);
}

/** NEXT_PUBLIC_APP_MODE (lib/app-mode.ts): unset = prod for a production build. */
const prod = process.env.NEXT_PUBLIC_APP_MODE ? process.env.NEXT_PUBLIC_APP_MODE === "prod" : process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_CLIENT_BUILD: clientBuild() },
  // prod: no browser source maps, and console.log/info gone from the bundle (errors, warnings and the guard's debug stay)
  productionBrowserSourceMaps: false,
  compiler: prod ? { removeConsole: { exclude: ["error", "warn", "debug"] } } : {},
};

export default nextConfig;
