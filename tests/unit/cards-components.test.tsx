import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import CardHand from "@/components/game/cards/CardHand";
import PlayingCard from "@/components/game/cards/PlayingCard";
import RulesBook from "@/components/game/cards/RulesBook";
import SitDialog from "@/components/game/cards/SitDialog";
import { cardsOf } from "@/lib/game/cards/deck";

afterEach(cleanup);

describe("PlayingCard and CardHand (spec §13.2)", () => {
  it("draws a face with its aria label, red for hearts and diamonds, and a back without one", () => {
    render(<><PlayingCard card={cardsOf(["10H"])[0]} /><PlayingCard card={cardsOf(["AS"])[0]} /><PlayingCard card={null} /></>);
    expect(screen.getByRole("img", { name: "10 cơ" })).toHaveTextContent("10♥");
    expect(screen.getByRole("img", { name: "10 cơ" }).className).toContain("text-[#c0392b]");
    expect(screen.getByRole("img", { name: "A bích" }).className).not.toContain("text-[#c0392b]");
    expect(screen.getByRole("img", { name: "Lá úp" })).toHaveTextContent("");
  });

  it("toggles cards: a selected card is pressed and lifted; hidden cards stay face down", () => {
    const onToggle = vi.fn();
    const hand = cardsOf(["3S", "7D", "2H"]);
    render(<CardHand cards={hand} selected={[hand[1]]} hidden={[hand[2]]} onToggle={onToggle} />);
    const seven = screen.getByRole("button", { name: "7 rô" });
    expect(seven).toHaveAttribute("aria-pressed", "true");
    expect(seven.className).toContain("-translate-y-2");
    expect(screen.getByRole("button", { name: "3 bích" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Lá úp" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "3 bích" }));
    expect(onToggle).toHaveBeenCalledWith(hand[0]);
  });
});

describe("SitDialog (spec §13.2)", () => {
  it("offers the stake only at an empty table, with each hand's hold and the play-money line", () => {
    const onSit = vi.fn();
    const { unmount } = render(<SitDialog game="tienlen" seat={2} stake={null} coins={1_000_000} onSit={onSit} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "100 xu" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "10.000 xu" }));
    expect(screen.getByText("Mỗi ván giữ tạm 100.000 để trả thua — hết ván trả lại phần dư.")).toBeInTheDocument();
    expect(screen.getByText("🪙 Xu chỉ là điểm trong trò chơi — không mua bằng tiền thật, không đổi ra tiền thật.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ngồi xuống" }));
    expect(onSit).toHaveBeenCalledWith(10000, null);
    unmount();
    render(<SitDialog game="cao" seat={4} stake={1000} coins={50_000} onSit={onSit} onClose={() => {}} />);
    expect(screen.queryByRole("group", { name: "Mức cược" })).toBeNull();
    expect(screen.getByText("Mức cược 1.000 xu")).toBeInTheDocument();
    expect(screen.getByText("Mỗi ván giữ tạm 1.000; khi làm cái giữ 1.000 × số nhà con.")).toBeInTheDocument();
  });

  it("bounds poker's buy-in to 50–200 big blinds and the wallet", () => {
    const onSit = vi.fn();
    const { unmount } = render(<SitDialog game="poker" seat={1} stake={1000} coins={80_000} onSit={onSit} onClose={() => {}} />);
    const slider = screen.getByRole("slider", { name: "Mang vào bàn" });
    expect(slider).toHaveAttribute("min", "50000");
    expect(slider).toHaveAttribute("max", "80000");
    fireEvent.change(slider, { target: { value: "60000" } });
    fireEvent.click(screen.getByRole("button", { name: "Ngồi xuống" }));
    expect(onSit).toHaveBeenCalledWith(1000, 60000);
    unmount();
    render(<SitDialog game="poker" seat={1} stake={1000} coins={40_000} onSit={onSit} onClose={() => {}} />);
    expect(screen.getByText("Không đủ xu.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ngồi xuống" })).toBeDisabled();
  });

  it("refuses a table the wallet cannot cover", () => {
    render(<SitDialog game="tienlen" seat={1} stake={1000} coins={9_999} onSit={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Ngồi xuống" })).toBeDisabled();
  });
});

describe("RulesBook (spec §14)", () => {
  it("opens on the table's tab, switches tabs, and shows the examples at the table's stake", () => {
    render(<RulesBook initial="cao" stake={100} onClose={() => {}} />);
    expect(screen.getByRole("tab", { name: "Cào" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Bài đặc biệt" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Kết quả")[0]).toHaveTextContent("A +100 · B −200 · C +100 · D +100 · E −100");
    fireEvent.click(screen.getByRole("tab", { name: "Tiến lên" }));
    expect(screen.getByRole("heading", { name: "Luật đặc biệt" })).toBeInTheDocument();
    expect(screen.getAllByLabelText("Kết quả")).toHaveLength(4);
    const combos = screen.getByRole("heading", { name: "Các bộ" }).closest("section")!;
    expect(within(combos).getAllByRole("img", { name: "9 bích" }).length).toBeGreaterThan(0);
    expect(screen.getByText("🪙 Xu là điểm chơi trong Music Together — kiếm được khi câu cá, làm ruộng, điểm danh và nghe nhạc.")).toBeInTheDocument();
  });
});
