import { createMatch, isOver, step, type MatchParams, type State } from "./engine";

/** v20.3 admin "Xem lại trận": plays both stored input logs (RLE runs `[mask, count, …]`) through the engine, read-only,
 *  at `speed` × 60 Hz from the first tick. Stepping is incremental (a cursor per side); past a log's end the mask is 0,
 *  as in the server's replay. Pausing freezes the frame; `seek(0)` restarts. */
export class ReplayPlayer {
  private s: State;
  private frame = 0;
  private i1 = 0; private c1 = 0; private i2 = 0; private c2 = 0;
  private t0: number | null = null;
  private base = 0;
  private rate = 1;

  constructor(private readonly params: MatchParams, private readonly runs1: readonly number[], private readonly runs2: readonly number[],
    /** Stop here (the server's settled frame); defaults to the end of the fight. */
    private readonly last = Number.POSITIVE_INFINITY) {
    this.s = createMatch(params);
  }

  get at(): number { return this.frame; }
  get state(): State { return this.s; }
  get speed(): number { return this.rate; }
  /** A new speed counts from the current frame. */
  set speed(v: number) {
    this.rate = v;
    this.t0 = null;
  }

  private one(): void {
    const r1 = this.runs1, r2 = this.runs2;
    while (this.i1 < r1.length && this.c1 >= r1[this.i1 + 1]) { this.i1 += 2; this.c1 = 0; }
    while (this.i2 < r2.length && this.c2 >= r2[this.i2 + 1]) { this.i2 += 2; this.c2 = 0; }
    const a = this.i1 < r1.length ? r1[this.i1] : 0;
    const b = this.i2 < r2.length ? r2[this.i2] : 0;
    this.c1++;
    this.c2++;
    this.s = step(this.s, a, b);
    this.frame++;
  }

  /** Steps up to frame `f` (never backwards, never past the end). */
  advanceTo(f: number): State {
    const target = Math.min(f, this.last);
    while (this.frame < target && !isOver(this.s)) this.one();
    return this.s;
  }

  /** Back to frame 0 (then forward to `f`). */
  seek(f: number): State {
    this.s = createMatch(this.params);
    this.frame = 0;
    this.i1 = this.c1 = this.i2 = this.c2 = 0;
    this.t0 = null;
    this.base = 0;
    return this.advanceTo(f);
  }

  /** The Arena's tick: animation time `now`; paused holds the frame (and resumes from it). */
  tick(now: number, paused: boolean): State {
    if (paused || this.t0 === null) {
      this.t0 = now;
      this.base = this.frame;
      return this.s;
    }
    return this.advanceTo(this.base + Math.floor(((now - this.t0) * this.rate * 60) / 1000 + 1e-9));
  }
}
