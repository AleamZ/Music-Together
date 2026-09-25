import type { NextConfig } from "next";

/** The client build sent in X-Client-Info (anti-cheat spec §12.6): the host's commit, else the build time (UTC). */
function clientBuild(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.CF_PAGES_COMMIT_SHA;
  if (sha) return sha.slice(0, 7);
  return new Date().toISOString().replace(/\D/g, "").slice(0, 12);
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_CLIENT_BUILD: clientBuild() },
};

export default nextConfig;
