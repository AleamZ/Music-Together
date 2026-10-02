import { GROUNDBAIT_RADIUS_PX } from "@/lib/game/fishing/gear";

// 0117: an ổ thính on the water in 2D — a faint patch of the bag's colour as wide as the spot works (48 px), a ring of
// bobbing bubbles at its edge and a few bubbles rising in the middle (more when topped up). Drawn on the water under the
// people; under reduced motion one still frame. Buffer px, the camera already subtracted by the caller.

/** "#rrggbb" → "rgba(r, g, b, a)". */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** The bubbles' positions at time `t` (ms): `ring` around the edge, `mid` rising in the middle. Pure (tests). */
export function bubbleRing(stacks: number, t: number, reduced: boolean, r = GROUNDBAIT_RADIUS_PX): {
  ring: Array<{ x: number; y: number; s: number }>; mid: Array<{ x: number; y: number; s: number; a: number }>;
} {
  const tt = reduced ? 0 : t;
  const n = 14, ring = [] as Array<{ x: number; y: number; s: number }>;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + tt / 9000;
    const wob = Math.sin(tt / 420 + i * 1.7) * 1.5;
    ring.push({ x: Math.cos(a) * (r - 3 + wob), y: Math.sin(a) * (r - 3 + wob) * 0.8, s: 1 + ((i + Math.floor(tt / 600)) % 3 === 0 ? 1 : 0) });
  }
  const mid = [] as Array<{ x: number; y: number; s: number; a: number }>;
  const m = 4 + 3 * Math.max(1, Math.min(3, stacks));
  for (let i = 0; i < m; i++) {
    const period = 1400 + (i * 337) % 900, k = ((tt + i * 613) % period) / period;
    const ang = i * 2.399, rad = (r * 0.62) * Math.sqrt(((i * 0.618) % 1));
    mid.push({ x: Math.cos(ang) * rad, y: Math.sin(ang) * rad * 0.8 - k * 3, s: k > 0.75 ? 2 : 1, a: 1 - k * 0.8 });
  }
  return { ring, mid };
}

/** One spot at buffer px (x, y): its patch, its ring of bubbles, its rising bubbles. */
export function drawGroundbaitSpot(b: CanvasRenderingContext2D, x: number, y: number, tint: string, stacks: number, t: number, reduced: boolean): void {
  const r = GROUNDBAIT_RADIUS_PX;
  b.save();
  b.fillStyle = rgba(tint, 0.18 + 0.05 * Math.max(0, stacks - 1));
  b.beginPath();
  b.ellipse(x, y, r, r * 0.8, 0, 0, Math.PI * 2);
  b.fill();
  b.fillStyle = rgba(tint, 0.22);
  b.beginPath();
  b.ellipse(x, y, r * 0.55, r * 0.44, 0, 0, Math.PI * 2);
  b.fill();
  const { ring, mid } = bubbleRing(stacks, t, reduced, r);
  b.fillStyle = "rgba(250, 252, 255, 0.85)";
  for (const p of ring) b.fillRect(Math.round(x + p.x), Math.round(y + p.y), p.s, p.s);
  b.fillStyle = rgba(tint, 0.95);
  for (const p of ring) b.fillRect(Math.round(x + p.x) + 1, Math.round(y + p.y) + 1, 1, 1);
  for (const p of mid) {
    b.globalAlpha = p.a;
    b.fillStyle = "#ffffff";
    b.fillRect(Math.round(x + p.x), Math.round(y + p.y), p.s, p.s);
  }
  b.restore();
}
