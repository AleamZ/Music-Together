const GRID = [
  "....bbbbbbbb....",
  "....b......b....",
  ".bbbbbbbbbbbbbb.",
  ".boooooooooooob.",
  ".bsssoccccosssb.",
  ".bsksoccccosksb.",
  ".bsksoccccosksb.",
  ".bsssoooooosssb.",
  ".boookkkkkkooob.",
  ".boooooooooooob.",
  ".bbbbbbbbbbbbbb.",
];
const FILL: Record<string, string> = {
  b: "var(--color-ink)",
  o: "var(--color-burgundy)",
  s: "var(--color-gold)",
  k: "var(--color-ink)",
  c: "var(--color-green-vintage)",
};
const COLS = 16;
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
