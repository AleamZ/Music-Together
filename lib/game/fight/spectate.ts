// v20.4 spectating the cage (spec §v20.4 "Spectating the cage", plan ruling U13). A spectator hears both fighters' `fi`
// packets on the match topic, receive-only. It keeps each side's inputs as far as they are known contiguously from frame
// 0, steps a "lead" engine over the frames both sides cover (confirmed inputs only: nothing is predicted, so nothing is
// ever rolled back) and shows the lead's state SPECTATE_BUFFER frames behind, from snapshots. A late joiner (or a gap
// from a lost packet) is filled from fight_state: the server's sim at min(frontiers) and both runs up to it. Pure.

import { createMatch, isOver, step, type MatchParams, type State } from "./engine";
import type { FiBody } from "./rollback";
import { SPECTATE_BUFFER } from "./underground";

/** At most this many frames are stepped per tick (a late join catches up over a few ticks). */
export const SPECTATE_CATCH_UP = 240;
/** Frames of snapshots kept behind the lead. */
const KEEP = SPECTATE_BUFFER + 34;
const MAX_FRAMES = 40_000;

export class SpectatorFeed {
  /** Each side's inputs by frame (known contiguously for frames < known[side]). */
  private readonly masks: [number[], number[]] = [[], []];
  readonly known: [number, number] = [0, 0];
  /** The engine over confirmed inputs; its frame is `lead[0]`. */
  lead: State;
  private readonly snaps = new Map<number, State>();
  private shownFrame = -1;
  /** The state shown last (a gap or a jump keeps it frozen rather than show a frame inside the buffer). */
  private last: State;

  constructor(readonly params: MatchParams) {
    this.lead = createMatch(params);
    this.snaps.set(0, this.lead);
    this.last = this.lead;
  }

  /** The state shown last (the HUD reads it: never a frame inside the buffer). */
  get shown(): State {
    return this.last;
  }

  /** The newest frame both sides' inputs cover (frames below it are confirmed). */
  get confirmedFrame(): number {
    return Math.min(this.known[0], this.known[1]);
  }

  private add(side: 0 | 1, from: number, runs: readonly number[]): void {
    if (from > this.known[side]) return;                    // a gap: wait for a resend or fight_state
    const m = this.masks[side];
    let f = from;
    for (let i = 0; i + 1 < runs.length && f < MAX_FRAMES; i += 2) {
      for (let k = 0; k < runs[i + 1] && f < MAX_FRAMES; k++, f++) {
        if (f >= this.known[side]) m[f] = runs[i];          // frames already known are final (pushed inputs never change)
      }
    }
    if (f > this.known[side]) this.known[side] = f;
  }

  /** A fighter's packet (`side` 0 = red / p1, 1 = blue / p2). */
  onPacket(side: 0 | 1, p: FiBody): void {
    this.add(side, p.f, p.r);
  }

  /** fight_state's answer: the server's sim at `simFrame` and both runs from frame 0 up to min(frontiers). */
  seed(sim: readonly number[], simFrame: number, runs1: readonly number[], runs2: readonly number[]): void {
    this.add(0, 0, runs1);
    this.add(1, 0, runs2);
    if (simFrame > this.lead[0] && sim.length === this.lead.length) {
      this.lead = sim.slice();
      this.snaps.clear();
      this.snaps.set(simFrame, this.lead);
    }
  }

  /** Steps the lead over the confirmed frames and returns the state to show (SPECTATE_BUFFER frames behind; at the end
   *  it plays out to the last frame). */
  tick(): State {
    const target = this.confirmedFrame;
    let n = 0;
    while (!isOver(this.lead) && this.lead[0] < target && n < SPECTATE_CATCH_UP) {
      const f = this.lead[0];
      this.lead = step(this.lead, this.masks[0][f] ?? 0, this.masks[1][f] ?? 0);
      this.snaps.set(this.lead[0], this.lead);
      this.snaps.delete(this.lead[0] - KEEP);
      n++;
    }
    const lead = this.lead[0];
    const want = isOver(this.lead) ? lead : lead - SPECTATE_BUFFER;
    const oldest = lead - KEEP + 1;
    if (this.shownFrame < oldest) this.shownFrame = Math.max(oldest, Math.min(want, oldest + 2));
    if (this.shownFrame < want) this.shownFrame = Math.min(want, this.shownFrame + 2);
    const s = this.snaps.get(this.shownFrame);
    if (s && s[0] >= this.last[0]) this.last = s;
    return this.last;                                       // never backwards, never inside the buffer
  }
}
