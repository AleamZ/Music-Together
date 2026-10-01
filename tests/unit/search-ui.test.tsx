import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ScrollTitle from "@/components/room/ScrollTitle";
import SearchResults from "@/components/room/SearchResults";
import type { SearchResult } from "@/lib/youtube/search";
import type { RoomRules } from "@/lib/queue-rules";

afterEach(() => {
  cleanup();
});

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

describe("ScrollTitle", () => {
  it("renders song title with title attribute", () => {
    render(<ScrollTitle text="Sơn Tùng M-TP - Đừng Làm Trái Tim Anh Đau" />);
    const el = screen.getByTestId("scroll-title");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("title", "Sơn Tùng M-TP - Đừng Làm Trái Tim Anh Đau");
    expect(el.textContent).toBe("Sơn Tùng M-TP - Đừng Làm Trái Tim Anh Đau");
  });

  it("renders with custom HTML tag (as='h2')", () => {
    const { container } = render(
      <ScrollTitle as="h2" text="Custom Tag Title" className="my-class" />
    );
    const h2 = container.querySelector("h2");
    expect(h2).toBeInTheDocument();
    expect(h2?.className).toContain("my-class");
    expect(h2?.textContent).toBe("Custom Tag Title");
  });
});

describe("SearchResults overlay card", () => {
  const dummyResults: SearchResult[] = [
    {
      videoId: "vid-1",
      title: "Bài hát rất dài cần cuộn khi rê chuột trên danh sách kết quả tìm kiếm",
      channel: "Ca sĩ A",
      durationText: "03:45",
      durationSeconds: 225,
      thumb: "https://i.ytimg.com/vi/vid-1/mqdefault.jpg",
    },
    {
      videoId: "vid-2",
      title: "Bài hát ngắn",
      channel: "Ca sĩ B",
      durationText: "04:10",
      durationSeconds: 250,
      thumb: "https://i.ytimg.com/vi/vid-2/mqdefault.jpg",
    },
  ];

  const dummyRules: RoomRules = {
    max_duration_seconds: 600,
    banned_keywords: [],
    max_orders_per_member: 5,
  };

  it("renders floating overlay card with query, count, and results list", () => {
    const onClose = vi.fn();
    render(
      <SearchResults
        query="Sơn Tùng"
        results={dummyResults}
        roomId="room-1"
        token="token-1"
        rules={dummyRules}
        willPend={false}
        orderLimit={{ mine: 1, exempt: false }}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog.className).toContain("absolute");
    expect(screen.getByText(/Kết quả: “Sơn Tùng”/i)).toBeInTheDocument();
    expect(screen.getByText("2 bài")).toBeInTheDocument();
    expect(screen.getByText("Ca sĩ A")).toBeInTheDocument();
    expect(screen.getByText("03:45")).toBeInTheDocument();
  });

  it("closes when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <SearchResults
        query="Sơn Tùng"
        results={dummyResults}
        roomId="room-1"
        token="token-1"
        rules={dummyRules}
        willPend={false}
        orderLimit={{ mine: 1, exempt: false }}
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByRole("button", { name: /đóng kết quả tìm kiếm/i });
    await userEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when Escape key is pressed", () => {
    const onClose = vi.fn();
    render(
      <SearchResults
        query="Sơn Tùng"
        results={dummyResults}
        roomId="room-1"
        token="token-1"
        rules={dummyRules}
        willPend={false}
        orderLimit={{ mine: 1, exempt: false }}
        onClose={onClose}
      />
    );

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when clicking outside the dialog", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside-area">Outside area</div>
        <SearchResults
          query="Sơn Tùng"
          results={dummyResults}
          roomId="room-1"
          token="token-1"
          rules={dummyRules}
          willPend={false}
          orderLimit={{ mine: 1, exempt: false }}
          onClose={onClose}
        />
      </div>
    );

    // Fast-forward listener registration timer
    vi.advanceTimersByTime(20);

    const outsideEl = screen.getByTestId("outside-area");
    fireEvent.mouseDown(outsideEl);
    expect(onClose).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("paginates results with 5 items per page and navigates pages", async () => {
    const manyResults: SearchResult[] = Array.from({ length: 12 }, (_, i) => ({
      videoId: `vid-${i + 1}`,
      title: `Bài hát số ${i + 1}`,
      channel: `Ca sĩ ${i + 1}`,
      durationText: "03:00",
      durationSeconds: 180,
      thumb: `https://i.ytimg.com/vi/vid-${i + 1}/mqdefault.jpg`,
    }));

    render(
      <SearchResults
        query="Tuyển tập"
        results={manyResults}
        roomId="room-1"
        token="token-1"
        rules={dummyRules}
        willPend={false}
        orderLimit={{ mine: 0, exempt: false }}
        onClose={vi.fn()}
      />
    );

    // Initial page 1: displays items 1 to 5
    expect(screen.getByText(/Hiển thị/i).textContent).toContain("1–5");
    expect(screen.getByText(/Hiển thị/i).textContent).toContain("12");
    expect(screen.getByText("Bài hát số 1")).toBeInTheDocument();
    expect(screen.getByText("Bài hát số 5")).toBeInTheDocument();
    expect(screen.queryByText("Bài hát số 6")).not.toBeInTheDocument();

    // Check pagination buttons
    const prevBtn = screen.getByRole("button", { name: /trang trước/i });
    const nextBtn = screen.getByRole("button", { name: /trang sau/i });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    // Navigate to page 2 via Next button
    await userEvent.click(nextBtn);
    expect(screen.getByText(/Hiển thị/i).textContent).toContain("6–10");
    expect(screen.getByText("Bài hát số 6")).toBeInTheDocument();
    expect(screen.getByText("Bài hát số 10")).toBeInTheDocument();
    expect(screen.queryByText("Bài hát số 1")).not.toBeInTheDocument();
    expect(prevBtn).toBeEnabled();

    // Jump to page 3 via page number button
    const page3Btn = screen.getByRole("button", { name: "Trang 3" });
    await userEvent.click(page3Btn);
    expect(screen.getByText(/Hiển thị/i).textContent).toContain("11–12");
    expect(screen.getByText("Bài hát số 11")).toBeInTheDocument();
    expect(screen.getByText("Bài hát số 12")).toBeInTheDocument();
    expect(nextBtn).toBeDisabled();
  });

  it("renders Load More button when continuation token exists and loads more results", async () => {
    const initialResults: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
      videoId: `init-${i + 1}`,
      title: `Bài ban đầu ${i + 1}`,
      channel: "Ca sĩ Test",
      durationText: "03:00",
      durationSeconds: 180,
      thumb: `https://i.ytimg.com/vi/init-${i + 1}/mqdefault.jpg`,
    }));

    const moreResults: SearchResult[] = Array.from({ length: 5 }, (_, i) => ({
      videoId: `more-${i + 1}`,
      title: `Bài tải thêm ${i + 1}`,
      channel: "Ca sĩ Test",
      durationText: "04:00",
      durationSeconds: 240,
      thumb: `https://i.ytimg.com/vi/more-${i + 1}/mqdefault.jpg`,
    }));

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: moreResults, continuation: null }),
    } as Response);

    render(
      <SearchResults
        query="Test query"
        results={initialResults}
        continuation="token-xyz-123"
        roomId="room-1"
        token="token-1"
        rules={dummyRules}
        willPend={false}
        orderLimit={{ mine: 0, exempt: false }}
        onClose={vi.fn()}
      />
    );

    // Verify "Tải thêm" button is present
    const loadMoreBtn = screen.getByRole("button", { name: /tải thêm.*youtube/i });
    expect(loadMoreBtn).toBeInTheDocument();

    await userEvent.click(loadMoreBtn);

    // Verify fetch was called with continuation
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("continuation=token-xyz-123"),
      expect.anything()
    );

    // Results should now have 10 items (page 2 with "Bài tải thêm 1")
    expect(screen.getByText(/Hiển thị/i).textContent).toContain("10");
    expect(screen.getByText("Bài tải thêm 1")).toBeInTheDocument();

    fetchSpy.mockRestore();
  });

  it("handles windowed pagination for many items without overflowing (e.g. 60 items / 12 pages)", async () => {
    // 60 items => 12 pages (5 items per page)
    const sixtyResults: SearchResult[] = Array.from({ length: 60 }, (_, i) => ({
      videoId: `song-${i + 1}`,
      title: `Bài hát ${i + 1}`,
      channel: "Ca sĩ Test",
      durationText: "03:30",
      durationSeconds: 210,
      thumb: `https://i.ytimg.com/vi/song-${i + 1}/mqdefault.jpg`,
    }));

    render(
      <SearchResults
        query="Test query"
        results={sixtyResults}
        roomId="room-1"
        token="token-1"
        rules={dummyRules}
        willPend={false}
        orderLimit={{ mine: 0, exempt: false }}
        onClose={vi.fn()}
      />
    );

    // Initial page 1 shows window [1, 2, 3, 4, 5, "...", 12]
    expect(screen.getByRole("button", { name: "Trang 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang 5" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang 12" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Trang 6" })).not.toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();

    // Navigate to page 9 (like in user screenshot)
    // Page 12 is visible, jump there or click Next multiple times
    const page12Btn = screen.getByRole("button", { name: "Trang 12" });
    await userEvent.click(page12Btn);

    // On page 12: window is [1, "...", 8, 9, 10, 11, 12]
    expect(screen.getByRole("button", { name: "Trang 9" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Trang 9" }));

    // On page 9: shows items 41 to 45 of 60
    expect(screen.getByText(/Hiển thị/i).textContent).toContain("41–45");
    expect(screen.getByText(/Hiển thị/i).textContent).toContain("60");
    expect(screen.getByText("Bài hát 41")).toBeInTheDocument();
    expect(screen.getByText("Bài hát 45")).toBeInTheDocument();

    // Window items: [1, "...", 8, 9, 10, 11, 12]
    expect(screen.getByRole("button", { name: "Trang 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang 8" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang 9" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Trang 10" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang 11" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Trang 12" })).toBeInTheDocument();
    // Buttons for 2, 3, 4, 5, 6, 7 are hidden under ellipsis
    expect(screen.queryByRole("button", { name: "Trang 2" })).not.toBeInTheDocument();
  });
});
