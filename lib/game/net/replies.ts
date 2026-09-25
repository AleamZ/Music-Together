/** Answers to `hello` are spread over this window (ms) so a crowd doesn't reply in the same instant. It grows with
 *  the number of players in the world, since every answer reaches every player. */
export function replyWindowMs(worldSize: number): number {
  return 1500 + 150 * Math.max(0, worldSize);
}

/** A walking member with no state yet is hidden this long (ms): the answers to their `hello` arrive within the window. */
export function unseenGraceMs(worldSize: number): number {
  return replyWindowMs(worldSize) + 500;
}

export interface ReplyScheduler {
  /** Someone said `hello`: make sure one answer is on its way. */
  onHello(): void;
  dispose(): void;
}

export interface ReplySchedulerOptions {
  /** Send my current state (the answer). */
  send: () => void;
  /** The answer window, read at each `hello`. */
  windowMs: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** At most one pending answer per client: every `hello` that arrives before it goes out is served by that one
 *  answer (it carries my full current state), sent after a random delay inside the window. */
export function createReplyScheduler(opts: ReplySchedulerOptions): ReplyScheduler {
  const random = opts.random ?? Math.random;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let timer: unknown = null;
  let disposed = false;
  return {
    onHello() {
      if (disposed || timer !== null) return;
      timer = setTimer(() => {
        timer = null;
        opts.send();
      }, random() * opts.windowMs());
    },
    dispose() {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
  };
}
