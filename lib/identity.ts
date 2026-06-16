/** Progress in ms derived from room playback fields (no streaming/heartbeat). */
export function computeElapsedMs(p: {
  is_playing: boolean;
  started_at: string | null;
  paused_elapsed_ms: number;
}): number {
  if (!p.is_playing || !p.started_at) return p.paused_elapsed_ms;
  return Date.now() - new Date(p.started_at).getTime();
}
