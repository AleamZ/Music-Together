// v18.5: Chợ Lớn's own depots (Vựa cá Chợ Lớn, Vựa nông sản) pay more than the pond's and the field's, the reward for
// making the trip. Mirrors MARKET_DEPOT_PCT in supabase/migrations/0028_market_depots.sql (integer arithmetic, rounded down).

export const MARKET_DEPOT_PCT = 120;

/** What the market depot pays for a sale the old depot pays `xu` for. */
export const marketPrice = (xu: number): number => Math.floor((xu * MARKET_DEPOT_PCT) / 100);
