// Anti-cheat v2 part 3 (0064): the page's build and the server's minimum. A game RPC from a build older than the minimum
// raises `client outdated` (hint `build`); the supabase client's fetch notices it and raises OUTDATED_EVENT, and
// OutdatedBanner asks for a reload. Pure, apart from notifyOutdated.

/** This page's build as sent in X-Client-Info (next.config.ts: YYYYMMDDHHmm[-sha]; "dev" without one). */
export const CLIENT_BUILD: string = process.env.NEXT_PUBLIC_CLIENT_BUILD ?? "dev";

/** The orderable number of a build (its 12 leading digits), 0 when it has none — what 0064's _client_build() reads. */
export function buildNumber(build: string | null | undefined): number {
  const m = /^([0-9]{12})/.exec(build ?? "");
  return m ? Number(m[1]) : 0;
}

/** The window event of a refused old page. */
export const OUTDATED_EVENT = "mt:outdated";
export const OUTDATED_TITLE = "Trang đã cũ";
export const OUTDATED_TEXT = "Phiên bản trang này đã cũ nên không nhận thưởng được nữa. Cập nhật trang để chơi tiếp nhé.";
export const OUTDATED_BUTTON = "Cập nhật trang";

/** A supabase error (or its JSON body) that is the minimum build's refusal. */
export function isOutdatedError(err: unknown): boolean {
  if (typeof err === "string") return err.includes("client outdated");
  const m = err && typeof err === "object" ? (err as { message?: unknown }).message : null;
  return m === "client outdated";
}

export function notifyOutdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(OUTDATED_EVENT));
}

/** The supabase client's fetch: an error answer carrying the minimum build's refusal raises OUTDATED_EVENT. */
export function outdatedFetch(base: typeof fetch = (...a) => fetch(...a)): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (!res.ok && res.status >= 400 && res.status < 500) {
      try {
        if (isOutdatedError(await res.clone().text())) notifyOutdated();
      } catch { /* the caller reads the body itself */ }
    }
    return res;
  };
}
