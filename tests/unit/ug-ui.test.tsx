import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// the transports and fight_state are not the UI's business here
const transport = vi.hoisted(() => ({
  spectator: vi.fn(),
  topic: vi.fn(),
}));
vi.mock("@/lib/game/fight/transport", () => ({
  matchTopic: (room: string, id: string) => `fight:${room}:m${id.replace(/-/g, "").slice(0, 8)}`,
  topicTransport: (...a: unknown[]) => {
    transport.topic(...a);
    return { onPacket: () => {}, send: () => {}, close: () => {} };
  },
  spectatorTransport: (...a: unknown[]) => {
    transport.spectator(...a);
    return { close: () => {} };
  },
}));
vi.mock("@/lib/game/fight/rpc", async (orig) => ({
  ...(await orig<typeof import("@/lib/game/fight/rpc")>()),
  fightState: () => new Promise(() => {}),
}));
vi.mock("@/components/game/fight/Arena", () => ({
  default: ({ names, controls }: { names: [string, string]; controls?: boolean }) => (
    <div data-testid="arena" data-controls={String(controls !== false)}>{names.join(" v ")}</div>
  ),
}));

import DojoPanel, { UG_HINT_LINE } from "@/components/game/fight/DojoPanel";
import SpectatorView from "@/components/game/fight/SpectatorView";
import UgCall from "@/components/game/fight/UgCall";
import UndergroundPanel from "@/components/game/fight/UndergroundPanel";
import type { UndergroundHook } from "@/hooks/useUnderground";
import { isCalled, myCup } from "@/hooks/useUnderground";
import { BOSSES, bossMatchParams, ratedWin } from "@/lib/game/fight/underground";
import type { UgCup, UgLive, UgMine, UgState } from "@/lib/game/fight/ug-rpc";
import { formatXu } from "@/lib/game/fishing/catalog";
import { DEFAULT_LOOK } from "@/lib/game/look";

afterEach(cleanup);

const NOW = 1_800_000_000_000;
const PARAMS = bossMatchParams(1, { style: 1, rank: 1 }, 7);

function state(over: Partial<UgState> = {}): UgState {
  return {
    unlocked: true, season: 2, seasonEndsMs: null,
    me: { rating: 1240, rated: 12, tier: "ca_loc", peak: 1300, bestTier: "ca_loc", titles: [], ratedToday: 3, ladderToday: 1, cupsToday: 0 },
    queue: null, queued: { "500": 1, "2000": 0, "5000": 0 },
    bosses: BOSSES.map((b) => ({
      floor: b.floor, name: b.name, style: b.style, level: b.level, hpPct: b.hpPct, entry: b.entry, prize: b.prize,
      styleByRound: b.styleByRound ? [...b.styleByRound] : null, cleared: b.floor <= 2, clears: 0, attempts: 0,
    })),
    cups: [], mine: null, live: [], serverNowMs: NOW, refused: null, match: null, ...over,
  };
}
function hook(s: UgState | null, over: Partial<UndergroundHook> = {}): UndergroundHook {
  const fn = () => vi.fn(async () => s);
  return {
    state: s, board: null, busy: false, active: null, clock: { now: (x: number) => x } as unknown as UndergroundHook["clock"], hidden: [],
    reload: fn(), enter: vi.fn(async () => true), queueJoin: fn(), queueLeave: fn(), ready: fn(), ladderStart: fn(), cupJoin: fn(), cupLeave: fn(),
    loadBoard: vi.fn(async () => {}), finish: vi.fn(), ...over,
  } as UndergroundHook;
}
function mine(over: Partial<UgMine> = {}): UgMine {
  return {
    id: "0123abcd-0000-0000-0000-000000000000", kind: "ug_rated", roomId: "room", side: 1, params: PARAMS, entry: 2000, ready: 0,
    startedAtMs: 0, callUntilMs: NOW + 25_000, ref: null, foe: { id: "foe", name: "Tí Sún", rating: 1210 }, ...over,
  };
}

describe("useUnderground helpers", () => {
  it("knows a called match and my cup", () => {
    expect(isCalled(null)).toBe(false);
    expect(isCalled(state({ mine: mine() }))).toBe(true);
    expect(isCalled(state({ mine: mine({ ready: 3 }) }))).toBe(false);
    expect(isCalled(state({ mine: mine({ kind: "ug_ladder", ready: 3 }) }))).toBe(false);
    const cup: UgCup = {
      id: "c", tier: 1000, status: "running", createdAtMs: NOW, bracket: null, currentMatch: null,
      entries: [{ id: "me", name: "Tôi", seed: 1, placed: null, rating: 1200 }, { id: "x", name: "X", seed: 2, placed: 3, rating: 1100 }],
    };
    expect(myCup(state({ cups: [cup] }), "me")).toBe(cup);
    expect(myCup(state({ cups: [cup] }), "x")).toBeNull();                         // knocked out
    expect(myCup(state({ cups: [{ ...cup, status: "done" }] }), "me")).toBeNull();
  });
});

describe("UndergroundPanel", () => {
  it("offers the queue's tiers and joins one", () => {
    const ug = hook(state());
    render(<UndergroundPanel ug={ug} accountId="me" tab="queue" onTab={() => {}} nowMs={NOW} onClose={() => {}} />);
    expect(screen.getByTestId("ug-tier").textContent).toContain("1240");
    expect(screen.getByText(/Hôm nay: 3\/10 trận/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Vào kèo · ${formatXu(2000)}`) }));
    expect(ug.queueJoin).toHaveBeenCalledWith(2000);
  });

  it("shows the wait while queued and leaves with a refund", () => {
    const ug = hook(state({ queue: { tier: 500, rating: 1240, joinedAtMs: NOW - 65_000, head: true } }));
    render(<UndergroundPanel ug={ug} accountId="me" tab="queue" onTab={() => {}} nowMs={NOW} onClose={() => {}} />);
    expect(screen.getByText(/đã chờ 1:05/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Rời hàng/ }));
    expect(ug.queueLeave).toHaveBeenCalled();
  });

  it("lists the ladder: cleared floors, the next one open, the rest locked", () => {
    const ug = hook(state());
    render(<UndergroundPanel ug={ug} accountId="me" tab="ladder" onTab={() => {}} nowMs={NOW} onClose={() => {}} />);
    expect(screen.getByTestId("ug-floor-1").textContent).toContain("✅");
    const open = screen.getByTestId("ug-floor-3").querySelector("button")!;
    expect(open.disabled).toBe(false);
    fireEvent.click(open);
    expect(ug.ladderStart).toHaveBeenCalledWith(3);
    expect(screen.getByTestId("ug-floor-4").querySelector("button")!.disabled).toBe(true);
    expect(screen.getByTestId("ug-floor-4").textContent).toContain("Hạ tầng dưới trước");
  });

  it("loads the board on its tab and switches tabs", () => {
    const ug = hook(state());
    const onTab = vi.fn();
    render(<UndergroundPanel ug={ug} accountId="me" tab="board" onTab={onTab} nowMs={NOW} onClose={() => {}} />);
    expect(ug.loadBoard).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: /Giải đêm/ }));
    expect(onTab).toHaveBeenCalledWith("cup");
  });
});

describe("UgCall", () => {
  it("shows the opponent, the prize, the countdown and sends Sẵn sàng", async () => {
    const m = mine();
    const ug = hook(state({ mine: m }));
    render(<UgCall ug={ug} mine={m} roomId="room" accountId="me" nowMs={NOW} />);
    const box = screen.getByTestId("ug-call");
    expect(box.textContent).toContain("Tí Sún");
    expect(box.textContent).toContain(formatXu(ratedWin(2000).won));
    expect(screen.getByRole("timer").textContent).toContain("25 giây");
    expect(transport.topic).toHaveBeenCalledWith("fight:room:m0123abcd", "foe");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Sẵn sàng" })));
    expect(ug.ready).toHaveBeenCalledWith(m.id, 6);                                // unmeasured: 6 frames
  });

  it("waits for the opponent once I am ready", () => {
    const m = mine({ ready: 1 });
    render(<UgCall ug={hook(state({ mine: m }))} mine={m} roomId="room" accountId="me" nowMs={NOW} />);
    expect((screen.getByRole("button", { name: /Đã sẵn sàng/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("SpectatorView", () => {
  it("watches receive-only, without controls", () => {
    const live: UgLive = {
      id: "0123abcd-1111-0000-0000-000000000000", kind: "ug_cup", p1: "a", p2: "b", p1Name: "Tèo", p2Name: "Tí", ready: 3,
      round: 1, w1: 0, w2: 0, params: PARAMS, startedAtMs: NOW,
    };
    const onClose = vi.fn();
    render(<SpectatorView token="t" roomId="room" me="me" match={live} looks={[DEFAULT_LOOK, DEFAULT_LOOK]} onClose={onClose} />);
    expect(screen.getByTestId("spectate-bar").textContent).toContain("Giải đêm");
    expect(screen.getByTestId("arena").dataset.controls).toBe("false");
    expect(transport.spectator).toHaveBeenCalledWith("fight:room:m0123abcd", "me", ["a", "b"], expect.anything());
    fireEvent.click(screen.getByRole("button", { name: /Thôi xem/ }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("thầy Lâm's hint", () => {
  it("shows once earned, not before", () => {
    const props = {
      state: null, error: null, coins: 0, tab: 1, nowMs: NOW, busy: false, onTab: () => {}, onEnroll: () => {}, onWear: () => {},
      onUnwear: () => {}, onPractice: () => {}, onExam: () => {}, onClose: () => {},
    };
    const { rerender } = render(<DojoPanel {...props} />);
    expect(screen.queryByTestId("ug-hint")).toBeNull();
    rerender(<DojoPanel {...props} ugHint />);
    expect(screen.getByTestId("ug-hint").textContent).toContain(UG_HINT_LINE);
  });
});
