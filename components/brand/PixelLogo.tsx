// Pixel boombox/radio logo. 24x15 grid → rects. Fills use theme tokens so it
// matches the active theme. Chars: h/b/k=outline+handle+knobs (ink), o=body
// (burgundy/terracotta), s=speaker rim (ink), g=speaker cone (gold/green),
// d=speaker centre (cream), c=screen (green-vintage/sky), '.'=transparent.
const GRID = [
  "......hhhhhhhhhhhh......",
  "......h..........h......",
  ".bbbbbbbbbbbbbbbbbbbbbb.",
  ".boooooooooooooooooooob.",
  ".booooooobbbbbbooooooob.",
  ".b..sss..bccccb..sss..b.",
  ".b.sgggs.bccccb.sgggs.b.",
  ".bsgggggsbbbbbbsgggggsb.",
  ".bsggdggsoooooosggdggsb.",
  ".bsgggggsokookosgggggsb.",
  ".b.sgggs.okkkko.sgggs.b.",
  ".b..sss..oooooo..sss..b.",
  ".boooooooooooooooooooob.",
  ".boooooooooooooooooooob.",
  ".bbbbbbbbbbbbbbbbbbbbbb.",
];
const FILL: Record<string, string> = {
  h: "var(--color-ink)",
  b: "var(--color-ink)",
  k: "var(--color-ink)",
  o: "var(--color-burgundy)",
  s: "var(--color-ink)",
  g: "var(--color-gold)",
  d: "var(--color-cream)",
  c: "var(--color-green-vintage)",
};
const COLS = GRID[0].length;
const ROWS = GRID.length;

export default function PixelLogo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={(size * ROWS) / COLS} viewBox={`0 0 ${COLS} ${ROWS}`}
      shapeRendering="crispEdges" role="img" aria-label="Music Together">
      {GRID.flatMap((row, y) =>
        [...row].map((ch, x) => {
          const f = FILL[ch];
          return f ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={f} /> : null;
        }),
      )}
    </svg>
  );
}
