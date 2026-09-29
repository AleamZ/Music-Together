// v22 (0086): tiny Web Audio blips for the minigames (the detector's beep, a paddle splash, the chest's chime).
// SSR-safe; silent when audio is unavailable or blocked. Kept apart from lib/sound.ts (the chat's "ting").

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, ms: number, type: OscillatorType, vol: number, delayS = 0): void {
  const c = audio();
  if (!c) return;
  try {
    const t = c.currentTime + delayS;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
    osc.connect(gain).connect(c.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
  } catch { /* blocked — silent */ }
}

/** The detector's beep: higher the closer (band 0 … 6). */
export const detectorBeep = (band: number): void => tone(1400 - band * 120, 70, "square", 0.05);
/** A paddle stroke: a soft low splash; `good` adds a bright tick. */
export function paddleSplash(good: boolean): void {
  tone(180, 120, "triangle", 0.08);
  if (good) tone(990, 60, "sine", 0.06, 0.02);
}
/** The shovel hitting dirt (miss) or wood (hit). */
export const shovelThud = (hit: boolean): void => tone(hit ? 520 : 140, hit ? 90 : 140, hit ? "square" : "triangle", 0.07);
/** A little fanfare: the chest opens, a battle is won. */
export function fanfare(): void {
  [523, 659, 784, 1047].forEach((f, i) => tone(f, 180, "square", 0.05, i * 0.11));
}
/** A coin's clink. */
export const coinClink = (): void => tone(1760, 80, "sine", 0.05);
