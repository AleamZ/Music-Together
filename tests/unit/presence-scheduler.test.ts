import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { trackPresence } from "@/lib/realtime";
import type { PresenceMode } from "@/lib/presence-modes";

// Fake Realtime channel: records every track() call (time + mode) and answers with queued replies ("ok" by default;
// an Error reply makes that call reject).
const h = vi.hoisted(() => {
  const state = {
    subscribeCb: null as ((s: string) => void) | null,
    calls: [] as { at: number; mode: unknown; map: unknown; dog: unknown }[],
    replies: [] as Array<string | Promise<string> | Error>,
    removed: 0,
  };
  const channel = {
    on() { return channel; },
    subscribe(cb: (s: string) => void) { state.subscribeCb = cb; return channel; },
    presenceState() { return {}; },
    track(payload: { mode: unknown; map?: unknown; dog?: unknown }) {
      state.calls.push({ at: Date.now(), mode: payload.mode, map: payload.map, dog: payload.dog });
      const reply = state.replies.shift() ?? "ok";
      return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
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

  it("retries a rejected track like a failed one, and the retry publishes the mode", async () => {
    h.state.replies = [new Error("socket closed")];
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game" }, () => {});
    sub(); await adv(0); expect(h.state.calls).toHaveLength(1);
    await adv(1000); expect(modes()).toEqual(["game", "game"]);
    await adv(60_000); expect(h.state.calls).toHaveLength(2); // acknowledged → never re-sent
    hd.setMode("classic"); await adv(1000); expect(modes()).toEqual(["game", "game", "classic"]);
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

  it("a rejoin while a mode change waits on a budget timer re-tracks the wanted mode at once (reserved call)", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "classic" }, () => {});
    sub(); await adv(0);
    for (const m of ["game", "classic", "game"] as const) { hd.setMode(m); await adv(2000); }
    expect(times()).toEqual([0, 1000, 3000, 5000]); // 4-call budget used up until t = 30 s
    hd.setMode("classic"); await adv(1000);          // waits on a budget timer (would fire at 30 s)
    expect(h.state.calls).toHaveLength(4);

    sub("CHANNEL_ERROR"); sub(); await adv(0);
    expect(times().at(-1)).toBe(7000);               // sent at once: the reserved 5th call in the window
    expect(modes().at(-1)).toBe("classic");          // …carrying the wanted (pending) mode
    await adv(60_000); expect(h.state.calls).toHaveLength(5); // the cleared budget timer sends nothing extra
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

  it("a rejoin while a track is in flight re-tracks at once (reserved call), even when that older call then succeeds", async () => {
    let resolveOld!: (s: string) => void;
    h.state.replies = ["ok", "ok", "ok", new Promise<string>((r) => { resolveOld = r; })];
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "hall" }, () => {});
    sub(); await adv(0);
    for (const m of ["pond", "hall", "pond"] as const) { hd.setMap(m); await adv(1000); }
    expect(times()).toEqual([0, 1000, 2000, 3000]); // the 4th call (pond) is left in flight; the 4-call budget is used up
    sub("CHANNEL_ERROR"); sub(); await adv(500);    // (re)join: the new session has none of our presence
    expect(h.state.calls).toHaveLength(4);
    resolveOld("ok"); await adv(0);                 // …and the old session's 'ok' does not change that
    expect(times().at(-1)).toBe(3500);              // re-tracked at once: the reserved 5th call
    expect(h.state.calls.at(-1)).toMatchObject({ mode: "game", map: "pond" });
    await adv(60_000); expect(h.state.calls).toHaveLength(5); // acknowledged in the new session → never re-sent
    const ts = times();
    for (const t of ts) expect(ts.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(5);
    hd.unsubscribe();
  });

  it("publishes the map with the mode in one merged track, and never re-sends an acknowledged state", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "hall" }, () => {});
    sub(); await adv(0);
    expect(h.state.calls.map((c) => c.map)).toEqual(["hall"]);
    hd.setMap("pond"); await adv(400); hd.setMode("game"); await adv(1000);
    expect(h.state.calls.map((c) => [c.mode, c.map])).toEqual([["game", "hall"], ["game", "pond"]]);
    hd.setMap("pond"); await adv(60_000); expect(h.state.calls).toHaveLength(2);
    hd.setMap("hall"); await adv(300); hd.setMap("pond"); await adv(10_000); expect(h.state.calls).toHaveLength(2);
    hd.unsubscribe();
  });

  it("publishes map null in the classic view, whatever the last map was", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "pond" }, () => {});
    sub(); await adv(0);
    hd.setMode("classic"); await adv(1000);
    expect(h.state.calls.map((c) => [c.mode, c.map])).toEqual([["game", "pond"], ["classic", null]]);
    hd.setMap("hall"); await adv(10_000); expect(h.state.calls).toHaveLength(2); // nothing visible changed
    hd.setMode("game"); await adv(1000);
    expect(h.state.calls.at(-1)).toMatchObject({ mode: "game", map: "hall" });
    hd.unsubscribe();
  });

  it("shares the 4-per-30 s budget between map and mode changes", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "hall" }, () => {});
    sub(); await adv(0);
    for (let i = 0; i < 12; i++) {
      if (i % 2) hd.setMap(i % 4 === 1 ? "pond" : "hall");
      else hd.setMode(i % 4 === 0 ? "classic" : "game");
      await adv(1500);
    }
    await adv(120_000);
    const ts = times();
    for (const t of ts) expect(ts.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(4);
    hd.unsubscribe();
  });

  it("publishes the dog as {n, c} with the mode and the map, in game mode only (v17 §7.3)", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "field", dog: { name: "Mực", coat: "muc" } }, () => {});
    sub(); await adv(0);
    expect(h.state.calls.map((c) => c.dog)).toEqual([{ n: "Mực", c: "muc" }]);
    hd.setDog({ name: "Mực", coat: "muc" }); await adv(10_000); expect(h.state.calls).toHaveLength(1); // the same dog
    hd.setDog({ name: "Ki", coat: "muc" }); await adv(400); hd.setMap("hall"); await adv(1000);
    expect(h.state.calls.map((c) => [c.map, c.dog])).toEqual([["field", { n: "Mực", c: "muc" }], ["hall", { n: "Ki", c: "muc" }]]);
    hd.setMode("classic"); await adv(1000);
    expect(h.state.calls.at(-1)).toMatchObject({ mode: "classic", map: null, dog: null });
    hd.setDog(null); await adv(10_000); expect(h.state.calls).toHaveLength(3); // nothing visible changed
    hd.setMode("game"); await adv(1000);
    expect(h.state.calls.at(-1)).toMatchObject({ mode: "game", map: "hall", dog: null });
    hd.unsubscribe();
  });

  it("shares the 4-per-30 s budget between dog, map and mode changes", async () => {
    const hd = trackPresence("r", { memberId: "a", name: "Ann", mode: "game", map: "hall" }, () => {});
    sub(); await adv(0);
    for (let i = 0; i < 12; i++) {
      if (i % 3 === 0) hd.setDog(i % 2 ? null : { name: "Ki", coat: "vang" });
      else if (i % 3 === 1) hd.setMap(i % 2 ? "pond" : "field");
      else hd.setMode(i % 2 ? "classic" : "game");
      await adv(1500);
    }
    await adv(120_000);
    const ts = times();
    for (const t of ts) expect(ts.filter((x) => x >= t && x < t + 30_000).length).toBeLessThanOrEqual(4);
    hd.unsubscribe();
  });
});
