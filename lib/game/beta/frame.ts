// Pure (0118, the end of Beta): the Beta name frame, the title and the boost countdown text.

export const BETA_TITLE = "Người khai hoang Beta";
export const BETA_FRAME_MARK = "β";
const OPEN = "〔", CLOSE = "〕";

/** A Beta player's name between the β marks ("β〔Lan〕"); others unchanged. Text, so the 2D and 3D nameplates, the HUD
 *  and the chat all carry it; the nameplates also draw a gold border round a framed tag (isBetaTag). */
export const betaFrame = (name: string, tier: number | null | undefined): string =>
  typeof tier === "number" && tier >= 0 && tier <= 5 ? `${BETA_FRAME_MARK}${OPEN}${name}${CLOSE}` : name;

/** Does a name tag carry the Beta frame? */
export const isBetaTag = (text: string): boolean => text.includes(`${BETA_FRAME_MARK}${OPEN}`);

/** The gold of the frame's border. */
export const BETA_GOLD = "#d4a72c";

/** "6 ngày 3 giờ" / "5 giờ 12 phút" / "42 phút" / "hết hạn": the time left until `until` (ms epoch) at `now`. */
export function boostLeft(until: number, now: number): string {
  const ms = until - now;
  if (!(ms > 0)) return "hết hạn";
  const m = Math.floor(ms / 60_000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d} ngày ${h % 24} giờ`;
  if (h > 0) return `${h} giờ ${m % 60} phút`;
  return `${Math.max(1, m)} phút`;
}

export interface BetaBoost { kind: "xp" | "npc_quota"; pct: number; until: string }
export interface BetaMe { beta: boolean; tier: number | null; title: string | null; boosts: BetaBoost[]; serverNow: string | null }

/** beta_me's answer, defensively parsed. */
export function parseBetaMe(raw: unknown): BetaMe {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const boosts = Array.isArray(r.boosts) ? r.boosts.flatMap((b): BetaBoost[] => {
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    return (o.kind === "xp" || o.kind === "npc_quota") && typeof o.pct === "number" && typeof o.until === "string"
      ? [{ kind: o.kind, pct: o.pct, until: o.until }] : [];
  }) : [];
  return {
    beta: r.beta === true,
    tier: typeof r.tier === "number" ? r.tier : null,
    title: typeof r.title === "string" ? r.title : null,
    boosts,
    serverNow: typeof r.server_now === "string" ? r.server_now : null,
  };
}

/** The boost chip's text: "⚡ +50% KN · +25% thương lái · còn 6 ngày 3 giờ" (null when no boost is running). */
export function boostText(me: BetaMe, now: number): string | null {
  const live = me.boosts.filter((b) => Date.parse(b.until) > now);
  if (live.length === 0) return null;
  const xp = live.find((b) => b.kind === "xp"), q = live.find((b) => b.kind === "npc_quota");
  const until = Math.min(...live.map((b) => Date.parse(b.until)));
  const parts = [xp ? `+${xp.pct}% KN` : null, q ? `+${q.pct}% thương lái` : null].filter(Boolean);
  return `⚡ ${parts.join(" · ")} · còn ${boostLeft(until, now)}`;
}
