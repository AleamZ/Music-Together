import type { FishSpecies } from "./catalog";

/** The room's fish price index from fishing_board (economy spec §5): the multiplier, the average wealth behind it,
 *  when the 3-hour period ends, and each species' season factor. */
export interface FishPrices {
  mult: number;
  wealth: number;
  endsAt: string;
  factors: Record<string, number>;
}

/** A species' price per kg now: base × the room's multiplier × its season factor (a missing factor counts as 1). */
export function nowPricePerKg(species: Pick<FishSpecies, "id" | "pricePerKg">, prices: FishPrices): number {
  return Math.round(species.pricePerKg * prices.mult * (prices.factors[species.id] ?? 1));
}

/** ▲ when the season factor is above 1, ▼ below 1, nothing at exactly 1. */
export function trend(factor: number): "▲" | "▼" | "" {
  return factor > 1 ? "▲" : factor < 1 ? "▼" : "";
}

/** "×2,24": two decimals with the Vietnamese comma. */
export function formatMult(m: number): string {
  return `×${m.toFixed(2).replace(".", ",")}`;
}

/** "15:00": when the period ends, in Vietnam time; "—" for an unreadable time. */
export function endsAtText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Ho_Chi_Minh" }).format(d);
}

/** fishing_board's `prices`, read defensively: anything malformed gives null (a server without the index). */
export function parseFishPrices(v: unknown): FishPrices | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const mult = Number(o.mult);
  if (!Number.isFinite(mult) || mult < 1 || typeof o.ends_at !== "string") return null;
  const wealth = Number(o.wealth);
  const factors: Record<string, number> = {};
  if (o.factors && typeof o.factors === "object") {
    for (const [id, f] of Object.entries(o.factors as Record<string, unknown>)) {
      const n = Number(f);
      if (Number.isFinite(n) && n > 0) factors[id] = n;
    }
  }
  return { mult, wealth: Number.isFinite(wealth) ? wealth : 0, endsAt: o.ends_at, factors };
}
