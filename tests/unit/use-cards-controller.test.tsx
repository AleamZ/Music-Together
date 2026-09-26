import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { GameCanvasHandle } from "@/components/game/GameCanvas";
import { syncClock } from "@/lib/game/farm/clock";
import { getMap } from "@/lib/game/maps/registry";
import type { MapId } from "@/lib/game/maps/types";
import { caoRaw, ID, parsed, seatRaw, T0, tlRaw } from "./helpers/card-states";

const rpc = vi.hoisted(() => ({
  fetchCardLobby: vi.fn(), fetchCardState: vi.fn(), fetchCardHand: vi.fn(), tickCardTable: vi.fn(), cardAction: vi.fn(),
}));
vi.mock("@/lib/game/cards/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/cards/rpc")>()),
  ...rpc,
}));
vi.mock("@/lib/game/cards/channel", () => ({ joinCardChannel: () => ({ send: () => {}, leave: () => {} }) }));

import { LOBBY_POLL_MS } from "@/hooks/useCardLobby";
import { useCardsController } from "@/hooks/useCardsController";

const ME = ID[0];
const lobby = (seats: Array<{ game: string; ids: string[] }> = []) => ({
  serverNow: Date.parse(T0),
  tables: (["tienlen", "cao", "poker"] as const).map((game) => {
    const ids = seats.find((s) => s.game === game)?.ids ?? [];
    return { game, stake: ids.length ? 1000 : null, phase: "idle" as const, max: game === "tienlen" ? 4 : 6,
      seats: ids.map((id, i) => ({ seat: i + 1, id, name: `P${i + 1}` })) };
  }),
});
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const canvas = { setCardTables: vi.fn() };
const it_ = (id: string) => getMap("hall").interactables.find((i) => i.id === id)!;

function mount(mapId: MapId = "hall", toast = vi.fn()) {
  return renderHook((p: { mapId: MapId }) => useCardsController({
    token: "tok", roomId: "r", accountId: ME, mapId: p.mapId, canvas: () => canvas as unknown as GameCanvasHandle, toast,
    isMember: () => true, onCoinsChanged: () => {},
  }), { initialProps: { mapId } });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.parse(T0));
  syncClock(T0);
  for (const f of Object.values(rpc)) f.mockReset();
  canvas.setCardTables.mockReset();
  rpc.fetchCardLobby.mockResolvedValue(lobby());
  rpc.fetchCardHand.mockResolvedValue({ serverNow: Date.parse(T0), game: "tienlen", handNo: 3, seat: 1, cards: [] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCardsController (spec §13.1)", () => {
  it("reads the lobby every 20 s on the hall only, and labels the tables on the canvas", async () => {
    rpc.fetchCardLobby.mockResolvedValue(lobby([{ game: "tienlen", ids: [ID[1], ID[2]] }]));
    const { rerender } = mount("pond");
    await flush();
    expect(rpc.fetchCardLobby).not.toHaveBeenCalled();
    rerender({ mapId: "hall" });
    await flush();
    expect(rpc.fetchCardLobby).toHaveBeenCalledWith("r", "tok");
    expect(canvas.setCardTables).toHaveBeenLastCalledWith({ tienlen: "Tiến lên · 2/4 · 1.000", cao: "Trống", poker: "Trống" });
    await advance(LOBBY_POLL_MS);
    expect(rpc.fetchCardLobby).toHaveBeenCalledTimes(2);
  });

  it("opens a table's panel from its table, the rules book from the sign, and says when 0017 is missing", async () => {
    const toast = vi.fn();
    rpc.fetchCardState.mockResolvedValue(parsed(caoRaw({ deadline: null, seats: [seatRaw(2), seatRaw(3)] })));
    const { result } = mount("hall", toast);
    await flush();
    act(() => { expect(result.current.interact(it_("cards_cao"))).toBe(true); });
    expect(result.current.panel).toBe("cao");
    await flush();
    expect(result.current.table.state?.game).toBe("cao");
    act(() => { result.current.interact(it_("cards_sign")); });
    expect(result.current.rules).toEqual({ game: "tienlen", stake: 1000 });
    expect(result.current.interact(it_("dj_booth"))).toBe(false);
    rpc.fetchCardLobby.mockRejectedValue({ code: "PGRST202", message: "Could not find the function public.card_lobby" });
    await advance(LOBBY_POLL_MS);
    act(() => { result.current.interact(it_("cards_poker")); });
    expect(toast).toHaveBeenLastCalledWith("Góc đánh bài chưa mở — chủ phòng cần chạy migration 0017.");
  });

  it("keeps the table I sit at, finds it again from the lobby, and toasts once per turn while its panel is closed", async () => {
    const toast = vi.fn();
    rpc.fetchCardLobby.mockResolvedValue(lobby([{ game: "tienlen", ids: [ME, ID[1]] }]));
    const mine = parsed(tlRaw({ turn: 1, deadline: null, seats: [seatRaw(1), seatRaw(2)] }));
    rpc.fetchCardState.mockResolvedValue(mine);
    const { result, rerender } = mount("hall", toast);
    await flush();
    await flush();
    expect(result.current.seated).toBe("tienlen");
    expect(result.current.seatTable.state?.v).toBe(10);
    expect(toast).toHaveBeenCalledWith("🃏 Đến lượt bạn ở bàn Tiến lên!");
    await act(async () => { await result.current.seatTable.refetch(); });
    expect(toast).toHaveBeenCalledTimes(1);
    // on the pond the table stays with me
    rerender({ mapId: "pond" });
    rpc.fetchCardState.mockResolvedValueOnce(parsed(tlRaw({ v: 11, seq: 6, turn: 1, deadline: null, seats: [seatRaw(1), seatRaw(2)] })));
    await act(async () => { await result.current.seatTable.refetch(); });
    expect(toast).toHaveBeenCalledTimes(2);
    // standing up (a leaving seat) ends it
    rpc.fetchCardState.mockResolvedValueOnce(parsed(tlRaw({ v: 12, deadline: null, seats: [seatRaw(1, { leaving: true }), seatRaw(2)] })));
    await act(async () => { await result.current.seatTable.refetch(); });
    expect(result.current.seated).toBeNull();
  });

  it("sitting at the table I watch makes it my table without a new fetch, and refreshes the labels", async () => {
    rpc.fetchCardState.mockResolvedValue(parsed(tlRaw({ deadline: null, seats: [seatRaw(2)] })));
    const { result } = mount();
    await flush();
    act(() => result.current.openPanel("tienlen"));
    await flush();
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    rpc.cardAction.mockResolvedValueOnce({ changed: true, state: parsed(tlRaw({ v: 11, deadline: null, seats: [seatRaw(1), seatRaw(2)] })),
      hand: null, coins: 5000 });
    await act(async () => { await result.current.act({ kind: "sit", seat: 1, stake: 1000, buyin: null }); });
    expect(result.current.seated).toBe("tienlen");
    expect(result.current.table).toBe(result.current.seatTable);
    expect(result.current.table.state?.v).toBe(11);
    expect(rpc.fetchCardState).toHaveBeenCalledTimes(1);
    await flush();
    expect(rpc.fetchCardLobby).toHaveBeenCalledTimes(2);
  });
});
