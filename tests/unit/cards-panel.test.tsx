import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CardTablePanel, { ringOrder } from "@/components/game/cards/CardTablePanel";
import type { CardTable } from "@/hooks/useCardTable";
import type { CardGame } from "@/lib/game/cards/deck";
import type { CardHand, CardState } from "@/lib/game/cards/state";
import { syncClock } from "@/lib/game/farm/clock";
import { caoRaw, cs, ID, parsed, pkRaw, seatRaw, T0, tlRaw } from "./helpers/card-states";

beforeEach(() => syncClock(T0, Date.now()));
afterEach(cleanup);

const handOf = (game: CardGame, seat: number, codes: string[], handNo = 3): CardHand =>
  ({ serverNow: Date.parse(T0), game, handNo, seat, cards: cs(...codes) });
const tableOf = (state: CardState, hand: CardHand | null = null): CardTable => ({
  game: state.game, state, hand, failed: false, notOpen: false, busy: false,
  refetch: async () => {}, tick: async () => {}, act: async () => null,
});
function show(state: CardState, me: string, hand: CardHand | null = null, act = vi.fn(async () => null)) {
  render(<CardTablePanel game={state.game} table={tableOf(state, hand)} me={me} coins={500_000} act={act} onOpenRules={() => {}}
    onClose={() => {}} />);
  return act;
}

describe("CardTablePanel (spec §13.2)", () => {
  it("draws my seat at the bottom, the others counter-clockwise", () => {
    expect(ringOrder(4, 3)).toEqual([3, 4, 1, 2]);
    expect(ringOrder(6, 1)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("a spectator sees no hand and no actions", () => {
    show(parsed(tlRaw()), ID[5]);
    expect(screen.getByText("👀 Đang xem")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Bài của bạn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Đánh" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Lượt An · 15s");
    expect(within(screen.getByLabelText("Ghế 2")).getByText("13 lá")).toBeInTheDocument();
  });

  it("disables Đánh for an illegal selection and plays a legal one with the table's seq", () => {
    const state = parsed(tlRaw({}, { top: { type: "pair", len: 2, key: cs("9H")[0], cards: cs("9S", "9H"), seat: 4, done: false } }));
    const act = show(state, ID[0], handOf("tienlen", 1, ["3S", "7D", "JC", "JH", "2H"]));
    expect(screen.getByRole("status")).toHaveTextContent("Đến lượt bạn! 15s");
    const play = screen.getByRole("button", { name: "Đánh" });
    expect(play).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "3 bích" }));
    expect(play).toBeDisabled();
    expect(screen.getByText("Bài này không chặn được.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 bích" }));
    fireEvent.click(screen.getByRole("button", { name: "J chuồn" }));
    fireEvent.click(screen.getByRole("button", { name: "J cơ" }));
    expect(play).toBeEnabled();
    fireEvent.click(play);
    expect(act).toHaveBeenCalledWith({ kind: "tl_play", seq: 5, cards: cs("JC", "JH") });
    fireEvent.click(screen.getByRole("button", { name: "Bỏ lượt" }));
    expect(act).toHaveBeenLastCalledWith({ kind: "tl_pass", seq: 5 });
  });

  it("a first lead must include `must`; Gợi ý picks a legal play", () => {
    const state = parsed(tlRaw({}, { first: true, must: cs("3C")[0] }));
    show(state, ID[0], handOf("tienlen", 1, ["3C", "5D", "5H", "KS"]));
    expect(screen.getByRole("button", { name: "Bỏ lượt" })).toBeDisabled();
    expect(screen.getByLabelText("Giữa bàn")).toHaveTextContent("Ván đầu phải đánh kèm lá 3♣.");
    fireEvent.click(screen.getByRole("button", { name: "K bích" }));
    expect(screen.getByRole("button", { name: "Đánh" })).toHaveAttribute("title", "Ván đầu phải đánh kèm lá 3♣.");
    fireEvent.click(screen.getByRole("button", { name: "Bỏ chọn" }));
    fireEvent.click(screen.getByRole("button", { name: "💡 Gợi ý" }));
    expect(screen.getByRole("button", { name: "3 chuồn" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Đánh" })).toBeEnabled();
  });

  it("shows 💣 Chặt! only out of turn, with a 4 đôi thông that beats the top", () => {
    const slam = ["4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H", "9S"];
    const over = (top: string[], key: string, turn = 1) =>
      parsed(tlRaw({ turn }, { top: { type: "single", len: 1, key: cs(key)[0], cards: cs(...top), seat: 2, done: false } }));
    const act = show(over(["2H"], "2H"), ID[2], handOf("tienlen", 3, slam));
    fireEvent.click(screen.getByRole("button", { name: "💣 Chặt!" }));
    expect(act).toHaveBeenCalledWith({ kind: "tl_play", seq: 5, cards: cs("4S", "4D", "5C", "5H", "6S", "6D", "7C", "7H") });
    cleanup();
    show(over(["8C"], "8C"), ID[2], handOf("tienlen", 3, slam));
    expect(screen.queryByRole("button", { name: "💣 Chặt!" })).toBeNull();
    cleanup();
    show(over(["2H"], "2H", 3), ID[2], handOf("tienlen", 3, slam));
    expect(screen.queryByRole("button", { name: "💣 Chặt!" })).toBeNull();
  });

  it("bounds the poker slider and names my hand", () => {
    const state = parsed(pkRaw({ turn: 1, seats: [seatRaw(1, { chips: 10_000 }), seatRaw(2, { chips: 50_000 }), seatRaw(3, { chips: 50_000 })] }, {
      street: "flop", board: cs("KD", "7C", "2S"), cur: 4000, raise: 4000, pot: 9000,
      players: {
        1: { id: ID[0], bet: 0, put: 1000, fold: false, allin: false, acted: null, pending: true, last: null },
        2: { id: ID[1], bet: 4000, put: 5000, fold: false, allin: false, acted: 4000, pending: false, last: "bet" },
        3: { id: ID[2], bet: 0, put: 1000, fold: true, allin: false, acted: null, pending: false, last: "fold" },
      },
    }));
    const act = show(state, ID[0], handOf("poker", 1, ["KS", "KH"]));
    expect(screen.getByText("Bạn đang có: Sám K")).toBeInTheDocument();
    const slider = screen.getByRole("slider", { name: "Mức tố" });
    expect(slider).toHaveAttribute("min", "8000");
    expect(slider).toHaveAttribute("max", "10000");
    fireEvent.click(screen.getByRole("button", { name: "Pot" }));
    fireEvent.click(screen.getByRole("button", { name: "Tố lên 10.000" }));
    expect(act).toHaveBeenLastCalledWith({ kind: "pk_act", seq: 5, action: "raise", amount: 10000 });
    fireEvent.click(screen.getByRole("button", { name: "Theo 4.000" }));
    expect(act).toHaveBeenLastCalledWith({ kind: "pk_act", seq: 5, action: "call", amount: null });
    expect(within(screen.getByLabelText("Ghế 3")).getByText("Úp bài")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Ghế 1")).getByText("D")).toBeInTheDocument();
  });

  it("shows 🃏 Chia bài only to the dealer, and keeps the dealer seated during the peek", () => {
    const wait = (dealer: number) => parsed(caoRaw({ phase: "deal_wait", turn: dealer }, { dealer, order: [] }));
    const act = show(wait(1), ID[0]);
    fireEvent.click(screen.getByRole("button", { name: "🃏 Chia bài" }));
    expect(act).toHaveBeenCalledWith({ kind: "cao_deal", seq: 5 });
    cleanup();
    show(wait(2), ID[0]);
    expect(screen.queryByRole("button", { name: "🃏 Chia bài" })).toBeNull();
    cleanup();
    show(parsed(caoRaw({}, { dealer: 1 })), ID[0], handOf("cao", 1, ["9S", "8C", "2H"]));
    expect(screen.getByRole("button", { name: /Đứng dậy/ })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Lật bài sau 15 giây");
    fireEvent.click(screen.getByRole("button", { name: "Nặn bài" }));
    fireEvent.click(screen.getByRole("button", { name: "Nặn bài" }));
    fireEvent.click(screen.getByRole("button", { name: "Nặn bài" }));
    expect(screen.getByText("9 nút")).toBeInTheDocument();
  });

  it("asks before standing up in a live hand; offers the empty seats to a spectator", () => {
    const act = show(parsed(tlRaw()), ID[0], handOf("tienlen", 1, ["3S"]));
    fireEvent.click(screen.getByRole("button", { name: "Đứng dậy" }));
    expect(screen.getByText(/Rời bàn giữa ván sẽ bị xử thua… Hết ván này bạn mới ngồi lại được\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(act).toHaveBeenCalledWith({ kind: "leave" });
    cleanup();
    show(parsed(tlRaw({ phase: "idle", turn: null, deadline: null, seats: [seatRaw(2)] }, {})), ID[0]);
    expect(screen.getAllByRole("button", { name: "Ngồi đây" })).toHaveLength(3);
    fireEvent.click(screen.getAllByRole("button", { name: "Ngồi đây" })[0]);
    expect(screen.getByRole("dialog", { name: "🪑 Ngồi ghế 1 · Tiến lên" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Mức cược" })).toBeNull();
  });

  it("shows the result: the places, the lines and the nets; a cancelled Cào hand", () => {
    show(parsed(tlRaw({ phase: "result", turn: null, last: {
      hand_no: 3, trang: null, places: [1, 2, 3, 4], out: { 1: "done", 2: "done", 3: "done" }, hands: { 4: cs("2S") },
      lines: [{ from: 4, to: 1, xu: 1000, paid: 1000, why: "bet" }, { from: 4, to: 3, xu: 500, paid: 500, why: "thoi" }],
      net: { 1: 1000, 2: 0, 3: 500, 4: -1500 },
    } })), ID[5]);
    const result = screen.getByLabelText("Kết quả ván");
    expect(within(result).getByText("Thối heo: Dũng trả Chi 500")).toBeInTheDocument();
    expect(within(result).getByText("An +1.000 · Bình 0 · Chi +500 · Dũng −1.500")).toBeInTheDocument();
    cleanup();
    show(parsed(caoRaw({ phase: "result", last: { hand_no: 3, dealer: 2, cancelled: true, hands: {}, lines: [], net: { 1: 0, 2: 0, 3: 0 } } })), ID[5]);
    expect(screen.getByText("Ván huỷ — đã trả lại tiền giữ")).toBeInTheDocument();
  });
});
