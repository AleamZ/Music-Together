// v18.5: Chợ Lớn's own depots (Vựa cá Chợ Lớn, Vựa nông sản) pay more than the pond's and the field's, the reward for
// making the trip. Mirrors MARKET_DEPOT_PCT in supabase/migrations/0100_econ_core.sql (was 120 in 0028; integer arithmetic,
// rounded down).

export const MARKET_DEPOT_PCT = 110;
/** "+10%": the premium as shown on the stalls and panels. */
export const MARKET_DEPOT_LABEL = `+${MARKET_DEPOT_PCT - 100}%`;

/** What the market depot pays for a sale the old depot pays `xu` for. */
export const marketPrice = (xu: number): number => Math.floor((xu * MARKET_DEPOT_PCT) / 100);
