import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trackPresence } from "@/lib/realtime";
import type { PresenceMode } from "@/lib/presence-modes";

// Fake Realtime channel: records every track() call (time + mode) and answers with queued replies ("ok" by default).
const h = vi.hoisted(() => {
  const state = {
    subscribeCb: null as ((s: string) => void) | null,
    calls: [] as { at: number; mode: unknown }[],
    replies: [] as Array<string | Promise<string>>,
    removed: 0,
  };
  const channel = {
    on() { return channel; },
    subscribe(cb: (s: string) => void) { state.subscribeCb = cb; return channel; },
    presenceState() { return {}; },
    track(payload: { mode: unknown }) {
      state.calls.push({ at: Date.now(), mode: payload.mode });
      return Promise.resolve(state.replies.shift() ?? "ok");
    },
  };
  return { state, channel };
});
vi.mock("@/lib/supabase", () => ({
  supabase: { channel: () => h.channel, removeChannel: async () => { h.state.removed++; return "ok"; } },
}));

const adv = (ms: number) => vi.advanceTimersByTimeAsync(ms);
const sub = (s = "SUBSCRIBED") => h.state.subscribeCb!(s);
const modes = () => h.state.calls.map((c) => c.mode);
const times = () => h.state.calls.map((c) => c.at);

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(0);
  h.state.calls = []; h.state.replies = []; h.state.removed = 0; h.state.subscribeCb = null;
});
afterEach(() => { vi.useRealTimers(); });

describe("trackPresence scheduler", () => {
  it("first track carries the initial mode, only after SUBSCRIBED, and an acked mode is never re-sent", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game" }, () => {});
    await adv(5000); expect(h.state.calls).toHaveLength(0);
    sub(); await adv(0); expect(modes()).toEqual(["game"]);
    hd.setMode("game"); await adv(60_000); expect(h.state.calls).toHaveLength(1);
    hd.unsubscribe();
  });

  it("A→B→A inside the 1 s merge window sends nothing", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    sub(); await adv(0);
    hd.setMode("game"); await adv(500); hd.setMode("classic"); await adv(10_000);
    expect(modes()).toEqual(["classic"]);
    hd.unsubscribe();
  });

  it.each([14, 15, 40])("never exceeds 4 track() calls in any 30 s window and converges on the last mode (%i toggles)", async (n) => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    sub(); await adv(0);
    let m: PresenceMode = "classic";
    for (let i = 0; i < n; i++) { m = m === "classic" ? "game" : "classic"; hd.setMode(m); await adv(2000); }
    await adv(120_000);
    const ts = times();
    for (const t of ts) expect(ts.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(4);
    expect(h.state.calls.at(-1)!.mode).toBe(m);
    for (let i = 1; i < h.state.calls.length; i++) expect(h.state.calls[i].mode).not.toBe(h.state.calls[i - 1].mode);
    hd.unsubscribe();
  });

  it("retries a failed / timed-out track after ≥ 1 s until it is acknowledged", async () => {
    h.state.replies = ["timed out", "error", "ok"];
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game" }, () => {});
    sub(); await adv(0); expect(h.state.calls).toHaveLength(1);
    await adv(999); expect(h.state.calls).toHaveLength(1);
    await adv(1); expect(h.state.calls).toHaveLength(2);
    await adv(1000); expect(h.state.calls).toHaveLength(3);
    await adv(60_000); expect(h.state.calls).toHaveLength(3);
    expect(modes()).toEqual(["game", "game", "game"]);
    hd.unsubscribe();
  });

  it("re-tracks the wanted mode after a rejoin", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    sub(); await adv(0);
    hd.setMode("game"); await adv(1000);
    sub("CHANNEL_ERROR"); await adv(5000); sub(); await adv(0);
    expect(modes()).toEqual(["classic", "game", "game"]);
    hd.unsubscribe();
  });

  it("after 4 mode changes inside 30 s, a rejoin re-tracks at once (the reserved 5th call) and the next setMode waits for the window", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    sub(); await adv(0);
    await adv(40_000); // the initial track (t = 0) has left the 30 s window
    let m: PresenceMode = "classic";
    for (let i = 0; i < 4; i++) { m = m === "classic" ? "game" : "classic"; hd.setMode(m); await adv(2000); }
    expect(times()).toEqual([0, 41_000, 43_000, 45_000, 47_000]);

    sub("CHANNEL_ERROR"); sub(); await adv(0);
    expect(times().at(-1)).toBe(48_000); // no wait: the 5th call inside the window
    expect(modes().at(-1)).toBe(m);

    hd.setMode(m === "classic" ? "game" : "classic");
    // 5 calls are now inside the window; a mode change may only be the 4th, so it waits past the oldest call
    // (41 s → leaves at 71 s) until the next one leaves too (43 s → 73 s).
    await adv(71_000 - 48_000); expect(h.state.calls).toHaveLength(6);
    await adv(1_999); expect(h.state.calls).toHaveLength(6);
    await adv(1); expect(times().at(-1)).toBe(73_000);
    const ts = times();
    for (const t of ts) expect(ts.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(5);
    hd.unsubscribe();
  });

  it("a change made before SUBSCRIBED is sent on SUBSCRIBED; unsubscribe cancels pending and future sends", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    hd.setMode("game"); await adv(2000); expect(h.state.calls).toHaveLength(0);
    sub(); await adv(0); expect(modes()).toEqual(["game"]);
    hd.setMode("classic"); hd.unsubscribe(); await adv(5000);
    expect(h.state.calls).toHaveLength(1); expect(h.state.removed).toBe(1);
    hd.setMode("game"); await adv(5000); expect(h.state.calls).toHaveLength(1);
  });

  it("a change made while a track is in flight is sent once that call resolves", async () => {
    let resolveFirst!: (s: string) => void;
    h.state.replies = [new Promise<string>((r) => { resolveFirst = r; })];
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    sub(); await adv(0);
    hd.setMode("game"); await adv(5000); expect(h.state.calls).toHaveLength(1);
    resolveFirst("ok"); await adv(0);
    expect(modes()).toEqual(["classic", "game"]);
    hd.unsubscribe();
  });

  it("unsubscribe while a track is in flight sends nothing afterwards (even if it failed)", async () => {
    let resolveFirst!: (s: string) => void;
    h.state.replies = [new Promise<string>((r) => { resolveFirst = r; })];
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    sub(); await adv(0);
    hd.unsubscribe(); resolveFirst("error"); await adv(60_000);
    expect(h.state.calls).toHaveLength(1);
  });
});
