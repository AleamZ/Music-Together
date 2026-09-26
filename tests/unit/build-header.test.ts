import { afterEach, describe, it, expect, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetModules();
});

const build = async () => {
  vi.resetModules();
  return (await import("@/next.config")).default.env?.NEXT_PUBLIC_CLIENT_BUILD;
};

describe("the client build id (anti-cheat spec §12.6)", () => {
  it("is the host's commit, cut to 7 characters", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "0123456789abcdef");
    vi.stubEnv("CF_PAGES_COMMIT_SHA", "fedcba9876543210");
    expect(await build()).toBe("0123456");
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    expect(await build()).toBe("fedcba9");
  });

  it("is the build time in UTC without a commit", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("CF_PAGES_COMMIT_SHA", "");
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-02T03:04:05Z"));
    expect(await build()).toBe("202610020304");
  });
});

describe("the X-Client-Info header", () => {
  const header = async () => {
    vi.resetModules();
    const { supabase } = await import("@/lib/supabase");
    return (supabase as unknown as { headers: Record<string, string> }).headers["X-Client-Info"];
  };

  it("names the app and its build instead of the supabase-js default", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_BUILD", "abc1234");
    expect(await header()).toBe("music-together/abc1234");
  });

  it("says dev without a build id", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLIENT_BUILD", undefined);
    expect(await header()).toBe("music-together/dev");
  });
});
