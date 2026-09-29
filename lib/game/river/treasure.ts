// Máy dò kho báu (v22, 0086): the detector's distance bands (public._treasure_band) and how they sound and look. The
// server answers only the band where I stand; the spot itself never leaves it. Pure.

/** The band's upper distances (px): band k covers (DETECTOR_BANDS[k-1], DETECTOR_BANDS[k]]; past the last is band 7. */
export const DETECTOR_BANDS: readonly number[] = [16, 32, 48, 72, 96, 120, 180];
export const COLD_BAND = 7;

export function treasureBand(d: number): number {
  const k = DETECTOR_BANDS.findIndex((b) => d <= b);
  return k === -1 ? COLD_BAND : k;
}

/** The beep's period (ms) for a band: a steady tone on the spot, faster the closer, silent when cold. */
export function beepMs(band: number | null): number | null {
  if (band === null || band >= COLD_BAND) return null;
  return [0, 140, 220, 340, 520, 760, 1200][band] ?? null;
}

/** 0 … 7 lit bars of the signal meter. */
export const signalBars = (band: number | null): number => (band === null ? 0 : Math.max(0, COLD_BAND - band));

export const BAND_TEXT: readonly string[] = [
  "📍 Ngay dưới chân! Đào đi!",
  "🔥 Sát lắm rồi!",
  "🔥 Rất gần!",
  "🌤️ Gần rồi…",
  "🌤️ Âm ấm…",
  "🌥️ Có tín hiệu yếu.",
  "❄️ Tín hiệu rất yếu.",
  "❄️ Không có tín hiệu.",
];

/** Ping the server at most this often, and only after moving this far (or after PING_IDLE_MS standing still). */
export const PING_MS = 500;
export const PING_MOVE_PX = 6;
export const PING_IDLE_MS = 2500;

/** The shovel dig (0072's dig sim, 0086's need and window). */
export const SHOVEL = { need: 3, win: 120 } as const;
