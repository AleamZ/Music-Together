import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CODE_LABEL, holdingsLine } from "@/components/admin/AnticheatTab";
import CardOverlays from "@/components/game/cards/CardOverlays";
import CardSeatChip from "@/components/game/cards/CardSeatChip";
import type { CardsController } from "@/hooks/useCardsController";
import type { CardTable } from "@/hooks/useCardTable";
import type { AnticheatHoldings } from "@/lib/admin";
import type { CardHand, CardState } from "@/lib/game/cards/state";
import { syncClock } from "@/lib/game/farm/clock";
import { caoRaw, cs, ID, parsed, T0, tlRaw } from "./helpers/card-states";

beforeEach(() => syncClock(T0, Date.now()));
afterEach(cleanup);

const tableOf = (state: CardState | null, hand: CardHand | null = null): CardTable => ({
  game: state?.game ?? null, state, hand, failed: false, notOpen: false, busy: false,
  refetch: async () => {}, tick: async () => {}, act: async () => null,
});
const hand3 = (seat: number): CardHand => ({ serverNow: Date.parse(T0), game: "tienlen", handNo: 3, seat, cards: cs("3S") });

describe("CardSeatChip (spec §13.1)", () => {
  it("pulses on my turn with the seconds left, else says whether I play or wait; a tap opens the table", () => {
    const onOpen = vi.fn();
    render(<CardSeatChip table={tableOf(parsed(tlRaw()), hand3(1))} me={ID[0]} onOpen={onOpen} />);
    const chip = screen.getByRole("button", { name: "🃏 Tiến lên · Đến lượt bạn! 15s" });
    expect(chip.className).toContain("animate-pulse");
    fireEvent.click(chip);
    expect(onOpen).toHaveBeenCalled();
    cleanup();
    render(<CardSeatChip table={tableOf(parsed(tlRaw()), hand3(2))} me={ID[1]} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "🃏 Tiến lên · Đang chơi" })).toBeInTheDocument();
    cleanup();
    render(<CardSeatChip table={tableOf(parsed(caoRaw({ phase: "result" })))} me={ID[1]} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: "🃏 Cào · Chờ ván mới" })).toBeInTheDocument();
    cleanup();
    const { container } = render(<CardSeatChip table={tableOf(parsed(tlRaw()))} me={ID[5]} onOpen={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("CardOverlays", () => {
  const controller = (over: Partial<CardsController>): CardsController => ({
    lobby: null, notOpen: false, panel: null, openPanel: vi.fn(), closePanel: vi.fn(), rules: null, openRules: vi.fn(),
    closeRules: vi.fn(), table: tableOf(parsed(tlRaw())), seated: null, seatTable: tableOf(null), act: vi.fn(async () => null),
    interact: () => false, ...over,
  });

  it("shows the open table's panel, and the rules book above it; Esc closes the book first", () => {
    const cards = controller({ panel: "tienlen" });
    const { rerender } = render(<CardOverlays cards={cards} me={ID[5]} coins={1234} />);
    expect(screen.getByRole("dialog", { name: "🃏 Bàn Tiến lên" })).toHaveTextContent("🪙 1.234");
    fireEvent.click(screen.getByRole("button", { name: "📜 Sổ luật" }));
    expect(cards.openRules).toHaveBeenCalledWith("tienlen");
    const withBook = { ...cards, rules: { game: "tienlen" as const, stake: 1000 } };
    rerender(<CardOverlays cards={withBook} me={ID[5]} coins={1234} />);
    expect(screen.getByRole("dialog", { name: "📜 Sổ luật" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cards.closeRules).toHaveBeenCalled();
    expect(cards.closePanel).not.toHaveBeenCalled();
    rerender(<CardOverlays cards={cards} me={ID[5]} coins={1234} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(cards.closePanel).toHaveBeenCalled();
  });
});

describe("the admin tab (spec §11.5)", () => {
  it("names the card signals", () => {
    expect([CODE_LABEL.bad_game, CODE_LABEL.bad_seat, CODE_LABEL.bad_stake, CODE_LABEL.bad_cards, CODE_LABEL.bad_bet, CODE_LABEL.bad_move])
      .toEqual(["Sai bàn bài", "Số ghế sai", "Mức cược sai", "Lá bài sai", "Tiền cược sai", "Nước đi sai"]);
  });

  it("counts the seats at the card tables in a wipe's preview", () => {
    const h: AnticheatHoldings = {
      wallet: { coins: 100 }, inventory: [], fish: [], personal_bests: [], rice: [], plots: [], leases: [], offers: [], crops: [],
      drying: [], announcements: 0,
    };
    expect(holdingsLine(h)).not.toContain("bàn bài");
    expect(holdingsLine({ ...h, cards: [{ room_id: "r", game: "poker", seat: 2, chips: 50_000, escrow: 0 },
      { room_id: "q", game: "tienlen", seat: 1, chips: 0, escrow: 10_000 }] })).toContain("2 ghế bàn bài (60.000 xu)");
  });
});
