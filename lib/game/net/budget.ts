import type { GameEvent } from "./protocol";

// Per-sender receive budgets (anti-cheat spec §14). The server never sees Broadcast, so each client drops what an
// honest sender could never send: token buckets keyed by sender and kind. Pure.

/** `rate` tokens a second, at most `burst` saved up. */
export interface Bucket { rate: number; burst: number }

export interface ReceiveBudget {
  /** May a `kind` message from `sender` pass at `now` (ms)? It spends a token when it does. A kind without a budget
   *  always passes. */
  take(sender: string, kind: string, now: number): boolean;
  /** How many buckets are kept. */
  size(): number;
}

interface Level { tokens: number; at: number }

function level(b: Level | undefined, lim: Bucket, now: number): number {
  return b ? Math.min(lim.burst, b.tokens + (Math.max(0, now - b.at) / 1000) * lim.rate) : lim.burst;
}

/** Buckets per sender and kind. Past `maxKeys` buckets, the full ones are forgotten (and all of them past twice as
 *  many), so a flood of made-up senders cannot grow it without end. */
export function createBudget(limits: Readonly<Record<string, Bucket>>, maxKeys = 256): ReceiveBudget {
  const buckets = new Map<string, Level>();
  const prune = (now: number) => {
    for (const [key, b] of buckets) {
      const lim = limits[key.slice(0, key.indexOf("|"))];
      if (!lim || level(b, lim, now) >= lim.burst) buckets.delete(key);
    }
    if (buckets.size > 2 * maxKeys) buckets.clear();
  };
  return {
    take(sender, kind, now) {
      const lim = limits[kind];
      if (!lim) return true;
      const key = `${kind}|${sender}`;
      const tokens = level(buckets.get(key), lim, now);
      const ok = tokens >= 1;
      buckets.set(key, { tokens: ok ? tokens - 1 : tokens, at: now });
      if (buckets.size > maxKeys) prune(now);
      return ok;
    },
    size: () => buckets.size,
  };
}

/** The game channel (anti-cheat spec §14): movement 5 a second, burst 5; hello and bye 1 per 10 s; fs and fa 2 a second,
 *  burst 3. */
export const GAME_LIMITS = {
  move: { rate: 5, burst: 5 },
  hello: { rate: 0.1, burst: 1 },
  bye: { rate: 0.1, burst: 1 },
  fs: { rate: 2, burst: 3 },
  fa: { rate: 2, burst: 3 },
} as const satisfies Record<string, Bucket>;

/** The budget a game message counts against; null for `lk` and `fp`, which are capped where they are handled. */
export function budgetKind(t: GameEvent): keyof typeof GAME_LIMITS | null {
  switch (t) {
    case "st":
    case "mv":
    case "pa":
      return "move";
    case "hello":
    case "bye":
    case "fs":
    case "fa":
      return t;
    default:
      return null;
  }
}

/** Reactions: 4 a second per sender, burst 4; at most 12 a second in all. */
export const REACTION_LIMITS = { sender: { rate: 4, burst: 4 }, total: { rate: 12, burst: 12 } } as const;

export interface ReactionBudget {
  take(sender: { accountId?: string; username?: string }, now: number): boolean;
}

/** The reaction budget, keyed by the account id, else the name, else one shared bucket; a drop spends nothing. */
export function createReactionBudget(): ReactionBudget {
  const senders = createBudget({ react: REACTION_LIMITS.sender });
  let total: Level | undefined;
  return {
    take(sender, now) {
      const all = level(total, REACTION_LIMITS.total, now);
      if (all < 1) return false;
      const key = sender.accountId ? `a:${sender.accountId}` : sender.username ? `u:${sender.username}` : "*";
      if (!senders.take(key, "react", now)) return false;
      total = { tokens: all - 1, at: now };
      return true;
    },
  };
}
