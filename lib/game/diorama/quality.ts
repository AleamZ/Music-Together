import type { Quality } from "./types";

// Pure: picks "low" quality when the frame rate stays poor. A rolling window of frame times; after the warm-up, an
// average under `minFps` for a full window drops to low (once — it never flips back by itself, to avoid oscillating).

export interface FpsMonitor {
  /** Feed one frame's duration (ms); returns the quality to use now. */
  sample(dtMs: number): Quality;
  /** The average fps over the last window (0 before any sample). */
  fps(): number;
  quality(): Quality;
  /** A manual choice (turns the auto pick off). */
  force(q: Quality): void;
  /** Back to the auto pick, from high (the window starts again). */
  auto(): void;
}

/** `warmupMs`: the first frames (shader compiles, the first texture uploads) are slow on every machine — not counted. */
export function createFpsMonitor(opts: { minFps?: number; window?: number; warmupMs?: number; start?: Quality } = {}): FpsMonitor {
  const minFps = opts.minFps ?? 40, size = opts.window ?? 90, warmupMs = opts.warmupMs ?? 3000;
  const buf: number[] = [];
  let sum = 0, elapsed = 0, q: Quality = opts.start ?? "high", auto = true;
  const fps = () => (buf.length ? 1000 / (sum / buf.length) : 0);
  return {
    sample(dtMs) {
      if (!(dtMs > 0) || dtMs > 250) return q;                 // a hidden/throttled tab's gap is not a slow frame
      elapsed += dtMs;
      if (elapsed < warmupMs) return q;
      buf.push(dtMs); sum += dtMs;
      if (buf.length > size) sum -= buf.shift() ?? 0;
      if (auto && q === "high" && buf.length === size && fps() < minFps) q = "low";
      return q;
    },
    fps,
    quality: () => q,
    force(next) { q = next; auto = false; },
    auto() { q = "high"; auto = true; buf.length = 0; sum = 0; },
  };
}
