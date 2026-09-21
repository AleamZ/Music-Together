/** Pure timing helpers for listen-along playback. The room row is the clock; players follow it. */
export type PlaybackClock = { is_playing: boolean; started_at: string | null; paused_elapsed_ms: number };

/** Where the room is right now, in whole seconds (never negative). */
export function targetSeconds(room: PlaybackClock, now: number = Date.now()): number {
  const elapsedMs = room.is_playing && room.started_at
    ? now - new Date(room.started_at).getTime()
    : room.paused_elapsed_ms;
  return Math.max(0, Math.floor(elapsedMs / 1000));
}

/** True when a player has drifted more than `toleranceSec` from the room clock. */
export function needsResync(playerSec: number, room: PlaybackClock, now: number = Date.now(), toleranceSec = 2): boolean {
  return Math.abs(playerSec - targetSeconds(room, now)) > toleranceSec;
}

/** A device may produce sound only when the room plays, the autoplay gate is open and a track is loaded. */
export function shouldPlay(room: { is_playing: boolean }, unlocked: boolean, hasCurrent: boolean): boolean {
  return room.is_playing && unlocked && hasCurrent;
}
