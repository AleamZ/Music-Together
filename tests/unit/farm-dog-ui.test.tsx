import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { DogView } from "@/lib/game/dog";
import { parseFieldState } from "@/lib/game/farm/state";

const rpc = vi.hoisted(() => ({ dogState: vi.fn(), adoptDog: vi.fn(), renameDog: vi.fn(), feedDog: vi.fn() }));
vi.mock("@/lib/game/farm/rpc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/game/farm/rpc")>()),
  ...rpc,
}));

import CoopPanel from "@/components/game/farm/CoopPanel";
import DogPanel from "@/components/game/farm/DogPanel";
import { useDog } from "@/hooks/useDog";

const NOW = Date.parse("2026-09-26T03:00:00Z");
const iso = (h: number) => new Date(NOW + h * 3_600_000).toISOString();
const MUC: DogView = { name: "Mực", coat: "muc", adoptedAt: Date.parse("2026-09-26T01:00:00Z"), fedUntil: NOW + 18 * 3_600_000, nextHuntAt: null, catches: 12 };
const answer = (dog: DogView | null, food = 3, at = NOW) => ({ serverNow: at, dog, food, coins: 500 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const f of Object.values(rpc)) f.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

describe("useDog (v17 §7.3)", () => {
  function setup(field: Parameters<typeof useDog>[0]["field"] = null) {
    const opts = { token: "tok", field, petDog: vi.fn(), setPresenceDog: vi.fn(), toast: vi.fn(), onCoinsChanged: vi.fn() };
    const view = renderHook((o) => useDog(o), { initialProps: opts });
    return { ...opts, ...view };
  }

  it("learns the dog on entering game mode and publishes it to presence", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(MUC));
    const { result, setPresenceDog } = setup();
    await flush();
    expect(rpc.dogState).toHaveBeenCalledWith("tok");
    expect(result.current).toMatchObject({ dog: MUC, food: 3, hungry: false });
    expect(setPresenceDog).toHaveBeenLastCalledWith({ name: "Mực", coat: "muc" });
  });

  it("has no dog before 0019, and publishes none", async () => {
    rpc.dogState.mockRejectedValueOnce({ code: "PGRST202", message: "Could not find the function public.dog_state" });
    const { result, setPresenceDog } = setup();
    await flush();
    expect(result.current.dog).toBeNull();
    expect(setPresenceDog).toHaveBeenLastCalledWith(null);
  });

  it("takes the field's dog when its answer is newer", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(MUC, 3, NOW - 1000));
    const field = parseFieldState({
      server_now: iso(0), plots: [], drying: [],
      mine: { items: { food_dog: 7 }, rice: {}, coins: 1, gift_claimed: true, dog: { name: "Ki", coat: "dom", adopted_at: iso(-5), fed_until: iso(-1), next_hunt_at: null, catches: 0 } },
    });
    const { result } = setup(field);
    await flush();
    expect(result.current).toMatchObject({ dog: { name: "Ki", coat: "dom" }, food: 7, hungry: true });
  });

  it("adopts, renames and feeds with their toasts; a refusal says why", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(null));
    const { result, toast, onCoinsChanged } = setup();
    await flush();
    rpc.adoptDog.mockResolvedValueOnce(answer(MUC));
    await act(async () => { expect(await result.current.adopt("Mực", "muc")).toBe(true); });
    expect(rpc.adoptDog).toHaveBeenCalledWith("tok", "Mực", "muc");
    expect(toast).toHaveBeenLastCalledWith("🐕 Chào mừng Mực về nhà! Nó sẽ theo bạn khắp nơi.");
    expect(onCoinsChanged).toHaveBeenCalled();
    rpc.renameDog.mockResolvedValueOnce(answer({ ...MUC, name: "Ki" }));
    await act(async () => { await result.current.rename("Ki"); });
    expect(toast).toHaveBeenLastCalledWith("\u270f\ufe0f Đã đổi tên thành Ki.");
    rpc.feedDog.mockRejectedValueOnce({ message: "dog full" });
    await act(async () => { expect(await result.current.feed()).toBe(false); });
    expect(toast).toHaveBeenLastCalledWith("Chó còn no — chưa ăn thêm được.");
    rpc.feedDog.mockResolvedValueOnce(answer({ ...MUC, name: "Ki" }, 2));
    await act(async () => { await result.current.feed(); });
    expect(toast).toHaveBeenLastCalledWith("🦴 Ki ăn ngon lành — no 24 giờ.");
  });

  it("pets at most once every 3 s", async () => {
    rpc.dogState.mockResolvedValueOnce(answer(MUC));
    const { result, petDog } = setup();
    await flush();
    expect(result.current.pet()).toBe(true);
    expect(result.current.pet()).toBe(false);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.pet()).toBe(true);
    expect(petDog).toHaveBeenCalledTimes(2);
  });
});

describe("DogPanel (v17 §12.3)", () => {
  const show = (dog: DogView, food = 3) => {
    const p = { onFeed: vi.fn(), onRename: vi.fn().mockResolvedValue(true), onPet: vi.fn(), onClose: vi.fn() };
    render(<DogPanel dog={dog} food={food} busy={false} {...p} />);
    return p;
  };

  it("shows the coat, the day, food, hunting and catches", () => {
    show(MUC);
    expect(screen.getByText("Chó cỏ lông mực · nuôi từ 26/9")).toBeInTheDocument();
    expect(screen.getByText("🍖 No — còn 18 giờ")).toBeInTheDocument();
    expect(screen.getByText("🐀 Sẵn sàng — ra đồng, đứng gần chuột là nó vồ")).toBeInTheDocument();
    expect(screen.getByText("🏅 Đã bắt 12 con chuột")).toBeInTheDocument();
  });

  it("counts a rest down, and shows a hungry dog", () => {
    cleanup();
    show({ ...MUC, nextHuntAt: NOW + 192_000 });
    expect(screen.getByText("🐀 Nghỉ — vồ tiếp sau 3:12")).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("🐀 Nghỉ — vồ tiếp sau 3:10")).toBeInTheDocument();
    cleanup();
    show({ ...MUC, fedUntil: NOW - 1 });
    expect(screen.getByText("🍖 Đói — cho ăn để nó đi săn")).toBeInTheDocument();
    expect(screen.getByText("🐀 Đói nên không săn")).toBeInTheDocument();
  });

  it("feeds, or says why not", () => {
    const p = show({ ...MUC, fedUntil: NOW + 6 * 3_600_000 });
    fireEvent.click(screen.getByRole("button", { name: "🦴 Cho ăn (3 bịch)" }));
    expect(p.onFeed).toHaveBeenCalled();
    cleanup();
    show(MUC);
    expect(screen.getByRole("button", { name: "🦴 Cho ăn (3 bịch)" })).toBeDisabled();
    expect(screen.getByText("Còn no hơn 12 giờ — chưa ăn thêm được.")).toBeInTheDocument();
    cleanup();
    show({ ...MUC, fedUntil: NOW }, 0);
    expect(screen.getByText("Hết thức ăn chó — mua ở tiệm anh Hai.")).toBeInTheDocument();
  });

  it("renames with hints, and pets", async () => {
    const p = show(MUC);
    fireEvent.click(screen.getByRole("button", { name: "🤚 Vuốt ve" }));
    expect(p.onPet).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "\u270f\ufe0f Đổi tên" }));
    const input = screen.getByRole("textbox");
    expect(screen.getByText("2–16 ký tự")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "K" } });
    expect(screen.getByText("Tên cần 2–16 ký tự.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lưu" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "Ao cá" } });
    expect(screen.getByText("Tên này dành riêng — chọn tên khác nhé.")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "Ki" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Lưu" })); });
    expect(p.onRename).toHaveBeenCalledWith("Ki");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("CoopPanel, 🐕 Chó cỏ (v17 §12.3)", () => {
  const STATE = parseFieldState({
    server_now: iso(0), plots: [], drying: [],
    mine: { items: {}, rice: {}, coins: 25_000, gift_claimed: true, owned_plot: null, farming: [], my_offers: [], incoming_offers: [] },
  });
  const show = (dog: DogView | null, onAdopt = vi.fn().mockResolvedValue(true), onOpenDog = vi.fn()) => {
    render(<CoopPanel state={STATE} failed={false} me="me" busy={false} now={NOW} onAct={vi.fn()} onReload={vi.fn()} onClose={vi.fn()}
      dog={{ dog, busy: false, onAdopt, onOpenDog }} />);
    fireEvent.click(screen.getByRole("tab", { name: "🐕 Chó cỏ" }));
    return { onAdopt, onOpenDog };
  };

  it("sits before Của tôi, and is not there without its part", () => {
    show(null);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Đất làng", "Đất tư", "Chợ đất", "Máy gặt", "🐕 Chó cỏ", "Của tôi"]);
    cleanup();
    render(<CoopPanel state={STATE} failed={false} me="me" busy={false} now={NOW} onAct={vi.fn()} onReload={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByRole("tab", { name: "🐕 Chó cỏ" })).toBeNull();
  });

  it("picks a coat, names the dog after it, and adopts after asking", () => {
    const { onAdopt } = show(null);
    expect(screen.getByText(/Chó cỏ nhà chú mới đẻ một bầy/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vàng" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mực" }));
    expect(screen.getByRole("button", { name: "Mực" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox")).toHaveValue("Mực");
    fireEvent.click(screen.getByRole("button", { name: "Nhận nuôi · 20.000 xu" }));
    expect(screen.getByText(/Nhận nuôi Mực \(lông mực\) với giá 20\.000 xu\? Mỗi người chỉ nuôi một con\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Vẫn làm" }));
    expect(onAdopt).toHaveBeenCalledWith("Mực", "muc");
  });

  it("says a dog is owned, and opens its panel", () => {
    const { onOpenDog } = show(MUC);
    expect(screen.getByText("Bạn đã nuôi Mực rồi — mỗi người một con thôi.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở bảng chó" }));
    expect(onOpenDog).toHaveBeenCalled();
  });
});
