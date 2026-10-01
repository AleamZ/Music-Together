import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, renderHook } from "@testing-library/react";
import RoomResizeHandle from "@/components/room/RoomResizeHandle";
import { useMediaQuery, useIsDesktop } from "@/hooks/useMediaQuery";

afterEach(() => {
  cleanup();
});

import { Group, Panel } from "react-resizable-panels";

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

describe("RoomResizeHandle component", () => {
  it("renders a horizontal separator handle correctly inside a Group", () => {
    const { container } = render(
      <Group orientation="horizontal">
        <Panel id="panel-a">A</Panel>
        <RoomResizeHandle id="test-handle" orientation="horizontal" title="Resize handle test" />
        <Panel id="panel-b">B</Panel>
      </Group>
    );

    const separator = container.querySelector('[role="separator"]');
    expect(separator).toBeInTheDocument();
    expect(separator).toHaveAttribute("id", "test-handle");
    expect(separator).toHaveAttribute("title", "Resize handle test");
    expect(separator?.className).toContain("cursor-col-resize");
  });

  it("renders a vertical separator handle correctly inside a Group", () => {
    const { container } = render(
      <Group orientation="vertical">
        <Panel id="panel-1">1</Panel>
        <RoomResizeHandle id="test-v-handle" orientation="vertical" title="Vertical test" />
        <Panel id="panel-2">2</Panel>
      </Group>
    );

    const separator = container.querySelector('[role="separator"]');
    expect(separator).toBeInTheDocument();
    expect(separator?.className).toContain("cursor-row-resize");
  });
});

describe("useMediaQuery and useIsDesktop hooks", () => {
  it("defaults to matching when matchMedia is true", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1024px"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(true);
  });

  it("returns false for narrow screens", () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));

    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });
});

import Header from "@/components/room/Header";
import userEvent from "@testing-library/user-event";
import type { Room } from "@/lib/supabase";

describe("Header reset layout button", () => {
  const dummyRoom: Room = {
    id: "test-room-1",
    code: "test",
    name: "Test Room",
    play_mode: "order",
    admin_member_id: "mem-1",
    dj_member_id: null,
    current_item_id: null,
    is_playing: false,
    started_at: null,
    paused_elapsed_ms: 0,
    created_at: new Date().toISOString(),
    max_duration_seconds: 600,
    require_approval: false,
    banned_keywords: [],
    max_orders_per_member: 5,
    auto_replay_history: false,
    kind: "public",
  };

  it("calls onResetLayout when clicked", async () => {
    const onReset = vi.fn();
    render(
      <Header
        room={dummyRoom}
        members={[]}
        isAdmin={true}
        isDj={true}
        roomId={dummyRoom.id}
        token="test-token"
        myMemberId="mem-1"
        onResetLayout={onReset}
      />
    );

    const resetBtn = screen.getByRole("button", { name: /đặt lại bố cục/i });
    expect(resetBtn).toBeInTheDocument();
    await userEvent.click(resetBtn);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders chat button with unread count and server notice badge in Header", async () => {
    const onToggleChat = vi.fn();
    render(
      <Header
        room={dummyRoom}
        members={[]}
        isAdmin={true}
        isDj={true}
        roomId={dummyRoom.id}
        token="test-token"
        myMemberId="mem-1"
        onToggleChat={onToggleChat}
        chatUnreadCount={5}
        chatHasServerNotice={true}
      />
    );

    const chatBtn = screen.getByRole("button", { name: /phòng trò chuyện/i });
    expect(chatBtn).toBeInTheDocument();
    expect(chatBtn.textContent).toContain("5");
    expect(chatBtn.textContent).toContain("🔔");
    await userEvent.click(chatBtn);
    expect(onToggleChat).toHaveBeenCalledTimes(1);
  });
});

import ChatDrawer from "@/components/room/ChatDrawer";

describe("ChatDrawer left alignment and accessibility", () => {
  const dummyRoom: Room = {
    id: "test-room-1",
    code: "test",
    name: "Test Room",
    play_mode: "order",
    admin_member_id: "mem-1",
    dj_member_id: null,
    current_item_id: null,
    is_playing: false,
    started_at: null,
    paused_elapsed_ms: 0,
    created_at: new Date().toISOString(),
    max_duration_seconds: 600,
    require_approval: false,
    banned_keywords: [],
    max_orders_per_member: 5,
    auto_replay_history: false,
    kind: "public",
  };

  it("renders anchored to the left with border-r-2 and translate-x-0 when open", () => {
    const onClose = vi.fn();
    const { container } = render(
      <ChatDrawer
        isOpen={true}
        onClose={onClose}
        roomId="room-1"
        token="token-1"
        accountId="acc-1"
        isAdmin={false}
        members={[]}
        room={dummyRoom}
      />
    );

    const rootWrapper = container.firstElementChild as HTMLElement;
    expect(rootWrapper.className).toContain("justify-start");
    const aside = container.querySelector("aside");
    expect(aside).toBeInTheDocument();
    expect(aside?.className).toContain("border-r-2");
    expect(aside?.className).toContain("translate-x-0");
  });
});

import ChatToast from "@/components/room/ChatToast";

describe("ChatToast component", () => {
  it("renders user message toast at top-left with username, body and icon", () => {
    const onDismiss = vi.fn();
    const onClick = vi.fn();
    const { container } = render(
      <ChatToast
        toast={{
          id: "msg-1",
          username: "Alice",
          body: "Xin chào mọi người!",
          system: false,
        }}
        onDismiss={onDismiss}
        onClick={onClick}
      />
    );

    const toastEl = container.querySelector("aside");
    expect(toastEl).toBeInTheDocument();
    expect(toastEl?.className).toContain("top-4");
    expect(toastEl?.className).toContain("left-4");
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Xin chào mọi người!")).toBeInTheDocument();
    expect(screen.getByText("💬")).toBeInTheDocument();
    expect(screen.getByText("Nhấp để mở khung chat")).toBeInTheDocument();
  });

  it("renders system notification with bell icon and 'Hệ thống'", () => {
    const { container } = render(
      <ChatToast
        toast={{
          id: "sys-1",
          username: "Server",
          body: "Bài hát mới đã được thêm vào hàng đợi.",
          system: true,
        }}
        onDismiss={vi.fn()}
        onClick={vi.fn()}
      />
    );

    expect(screen.getByText("Hệ thống")).toBeInTheDocument();
    expect(screen.getByText("Bài hát mới đã được thêm vào hàng đợi.")).toBeInTheDocument();
    expect(screen.getByText("🔔")).toBeInTheDocument();
  });

  it("calls onClick when clicking the toast card", async () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ChatToast
        toast={{
          id: "msg-2",
          username: "Bob",
          body: "Nghe bài này hay quá!",
          system: false,
        }}
        onDismiss={onDismiss}
        onClick={onClick}
      />
    );

    const toastEl = screen.getByRole("status");
    await userEvent.click(toastEl);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("calls onDismiss and does not trigger onClick when close button is clicked", async () => {
    const onClick = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ChatToast
        toast={{
          id: "msg-3",
          username: "Charlie",
          body: "Tắt nhạc nhé?",
          system: false,
        }}
        onDismiss={onDismiss}
        onClick={onClick}
      />
    );

    const closeBtn = screen.getByRole("button", { name: /đóng thông báo/i });
    await userEvent.click(closeBtn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("auto-dismisses after durationMs", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();
    render(
      <ChatToast
        toast={{
          id: "msg-4",
          username: "Daisy",
          body: "Hello!",
          system: false,
        }}
        onDismiss={onDismiss}
        onClick={vi.fn()}
        durationMs={2000}
      />
    );

    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2000);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

