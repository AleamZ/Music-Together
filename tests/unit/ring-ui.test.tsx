import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ReadyScreen, { networkLine } from "@/components/game/fight/ReadyScreen";
import ResultCard, { resultLines } from "@/components/game/fight/ResultCard";
import WaitingBanner from "@/components/game/fight/WaitingBanner";
import type { RingFighter, RingView } from "@/lib/game/fight/rings";
import type { MatchResult } from "@/lib/game/fight/rpc";
import { DEFAULT_LOOK } from "@/lib/game/look";

afterEach(cleanup);

const NOW = 1_800_000_000_000;

function fighter(over: Partial<RingFighter> = {}): RingFighter {
  return { id: "a", name: "Tèo", style: null, idx: null, rank: null, wins: 3, losses: 1, draws: 0, lockedUntilMs: null, ...over };
}
function view(over: Partial<RingView> = {}): RingView {
  return {
    ring: 2, v: 7, red: fighter({ id: "me", name: "Tôi" }), blue: fighter({ id: "foe", name: "Tí" }),
    redSinceMs: NOW, blueSinceMs: NOW, offer: null, match: null, ...over,
  };
}
function result(over: Partial<MatchResult> = {}): MatchResult {
  return {
    winner: 1, endReason: "ko", rounds: [{ reason: 1, winner: 1, hp1: 50, hp2: 0, frame: 900 }], roundsPlayed: 1,
    vitals: { hunger: 4, thirst: 6 }, exam: null,
    pvp: { stake: 1000, pot: 2000, fee: 100, won: 1900, records: { "1": { wins: 4, losses: 1, draws: 0 }, "2": { wins: 0, losses: 2, draws: 1 } } },
    ...over,
  };
}

function ready(props: Partial<Parameters<typeof ReadyScreen>[0]> = {}) {
  const onOffer = vi.fn();
  const onAccept = vi.fn();
  const onLeave = vi.fn();
  render(
    <ReadyScreen view={view()} me="red" myLook={DEFAULT_LOOK} foeLook={null} rtt={80} busy={false} lockedUntilMs={null} nowMs={NOW}
      onOffer={onOffer} onAccept={onAccept} onLeave={onLeave} onClose={() => {}} {...props} />,
  );
  return { onOffer, onAccept, onLeave };
}

describe("networkLine", () => {
  it("measures, then shows ping and delay, or refuses a slow link", () => {
    expect(networkLine(null)).toEqual({ text: "📶 Đang đo mạng…", ok: false, n: null });
    const ok = networkLine(80);
    expect(ok.ok).toBe(true);
    expect(ok.n).toBeGreaterThanOrEqual(2);
    expect(ok.text).toBe(`📶 Ping 80 ms · Trễ ${ok.n} khung`);
    const bad = networkLine(2000);
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain("Mạng hai bên chậm quá");
  });
});

describe("ReadyScreen", () => {
  it("waits for an opponent with an empty corner and no stake controls", () => {
    ready({ view: view({ blue: null }) });
    expect(screen.getByText("Đang chờ đối thủ…")).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByTestId("ring-net").textContent).toBe("📶 Đang đo mạng…");
  });

  it("offers a picked stake with the measured delay", () => {
    const { onOffer } = ready();
    fireEvent.click(screen.getByRole("radio", { name: /1\.000|1000|1k/i }));
    const btn = screen.getByRole("button", { name: /^Đề nghị/ });
    fireEvent.click(btn);
    expect(onOffer).toHaveBeenCalledTimes(1);
    expect(onOffer.mock.calls[0][0]).toBe(1000);
    expect(onOffer.mock.calls[0][1]).toBe(networkLine(80).n);
  });

  it("accepts the opponent's offer and shows who agreed and the winnings", () => {
    const { onAccept } = ready({ view: view({ offer: { stake: 1000, by: 2, v: 9, atMs: NOW, redOk: false, blueOk: true, redN: null, blueN: 3 } }) });
    expect(screen.getByText(/Tí đề nghị/)).toBeTruthy();
    expect(screen.getByText(/⏳ Bạn · ✅ Tí/)).toBeTruthy();
    expect(screen.getByText(/5% phí/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Đồng ý/ }));
    expect(onAccept).toHaveBeenCalledWith(9, networkLine(80).n);
  });

  it("disables playing on a slow link and staked stakes while locked", () => {
    ready({ rtt: 2000, lockedUntilMs: NOW + 3_600_000 });
    expect((screen.getByRole("button", { name: /^Đề nghị/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Tạm khóa đấu cược/)).toBeTruthy();
    const radios = screen.getAllByRole("radio") as HTMLButtonElement[];
    expect(radios[0].disabled).toBe(false);
    expect(radios.slice(1).every((r) => r.disabled)).toBe(true);
  });

  it("leaves the ring", () => {
    const { onLeave } = ready();
    fireEvent.click(screen.getByRole("button", { name: "Rời sàn" }));
    expect(onLeave).toHaveBeenCalled();
  });
});

describe("resultLines / ResultCard", () => {
  it("words a staked win, a loss, a draw and a void", () => {
    const win = resultLines(result(), 1);
    expect(win.title).toBe("🏆 Bạn thắng!");
    expect(win.money).toContain("+");
    expect(win.record).toBe("4 thắng · 1 thua · 0 hòa");
    const loss = resultLines(result(), 2);
    expect(loss.title).toBe("😵 Bạn thua");
    expect(loss.money.startsWith("−")).toBe(true);
    expect(resultLines(result({ winner: 0 }), 1).title).toBe("🤝 Hòa!");
    const v = resultLines(result({ winner: 0, void: true, endReason: "conflict" }), 2);
    expect(v.title).toContain("không khớp");
    expect(v.money).toContain("Hoàn cược");
    expect(v.record).toBeNull();
    expect(resultLines(result({ pvp: { stake: 0, pot: 0, fee: 0, won: 0, records: null } }), 1).money).toBe("Giao hữu");
  });

  it("offers a rematch at the same stake and leaving", () => {
    const onRematch = vi.fn();
    const onLeave = vi.fn();
    render(<ResultCard result={result()} side={1} onRematch={onRematch} onLeave={onLeave} onClose={() => {}} />);
    expect(screen.getByTestId("pvp-money").textContent).toContain("+");
    fireEvent.click(screen.getByRole("button", { name: /^Tái đấu/ }));
    fireEvent.click(screen.getByRole("button", { name: "Rời sàn" }));
    expect(onRematch).toHaveBeenCalled();
    expect(onLeave).toHaveBeenCalled();
  });
});

describe("WaitingBanner", () => {
  it("hides under 3 s, counts down, then offers the claim", () => {
    const onClaim = vi.fn();
    const { rerender } = render(<WaitingBanner stalledMs={1000} claiming={false} onClaim={onClaim} />);
    expect(screen.queryByTestId("pvp-waiting")).toBeNull();
    rerender(<WaitingBanner stalledMs={5000} claiming={false} onClaim={onClaim} />);
    expect(screen.getByText("(xử thắng được sau 15 giây)")).toBeTruthy();
    rerender(<WaitingBanner stalledMs={20_000} claiming={false} onClaim={onClaim} />);
    fireEvent.click(screen.getByRole("button", { name: /Xử thắng/ }));
    expect(onClaim).toHaveBeenCalled();
  });
});
