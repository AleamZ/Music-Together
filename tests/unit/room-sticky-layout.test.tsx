import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import RoomShell from "@/components/room/RoomShell";
import type { RoomView } from "@/hooks/useRoom";
import type { RoomDerived } from "@/lib/room-derived";
import type { PlaybackController } from "@/hooks/usePlayback";
import type { UseSponsorBlockResult } from "@/hooks/useSponsorBlock";
import type { Room } from "@/lib/supabase";

vi.stubGlobal("ResizeObserver", class {
  observe() {}
  unobserve() {}
  disconnect() {}
});

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsDesktop: () => true,
  useMediaQuery: () => true,
}));

vi.mock("@/lib/supabase", async () => {
  const actual = await vi.importActual<object>("@/lib/supabase");
  return {
    ...actual,
    fetchPlayHistory: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@/components/room/Header", () => ({
  default: () => <div data-testid="mock-header">Header</div>,
}));
vi.mock("@/components/room/MemberList", () => ({
  default: () => <div data-testid="mock-member-list">MemberList</div>,
}));
vi.mock("@/components/room/NowPlaying", () => ({
  default: () => <div data-testid="mock-now-playing">NowPlaying</div>,
}));
vi.mock("@/components/room/RoomLeaderboard", () => ({
  default: () => <div data-testid="mock-leaderboard">RoomLeaderboard</div>,
}));
vi.mock("@/components/room/AddSong", () => ({
  default: () => <div data-testid="mock-add-song">AddSong</div>,
}));
vi.mock("@/components/room/Queue", () => ({
  default: () => <div data-testid="mock-queue">Queue</div>,
}));
vi.mock("@/components/room/PendingQueue", () => ({
  default: () => <div data-testid="mock-pending-queue">PendingQueue</div>,
}));
vi.mock("@/components/room/MyPending", () => ({
  default: () => <div data-testid="mock-my-pending">MyPending</div>,
}));
vi.mock("@/components/room/ChatDrawer", () => ({
  default: () => <div data-testid="mock-chat-drawer">ChatDrawer</div>,
}));
vi.mock("@/components/room/ChatToast", () => ({
  default: () => <div data-testid="mock-chat-toast">ChatToast</div>,
}));
vi.mock("@/components/room/Reactions", () => ({
  default: () => <div data-testid="mock-reactions">Reactions</div>,
}));

afterEach(() => {
  cleanup();
});

describe("RoomShell sticky columns and scrollable layout", () => {
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

  const dummyView: RoomView = {
    state: {
      room: dummyRoom,
      members: [],
      queue: [],
    },
    role: {
      isAdmin: true,
      isDj: false,
      canControlPlayback: true,
      canManageQueue: true,
    },
    onlineIds: [],
    token: "test-token",
    myMemberId: "mem-1",
    accountId: "acc-1",
    username: "TestUser",
    loading: false,
    kicked: false,
    setPresenceMode: vi.fn(),
    presence: [],
    setPresenceMap: vi.fn(),
    setPresenceDog: vi.fn(),
  };

  const dummyDerived: RoomDerived = {
    current: null,
    approved: [],
    pending: [],
    myPending: [],
    rules: {
      max_duration_seconds: 600,
      banned_keywords: [],
      max_orders_per_member: 5,
    },
    willPend: false,
    orderLimit: { mine: 0, exempt: true },
    djAccountId: null,
    djOnline: false,
  };

  const dummyPlayback: PlaybackController = {
    durationMs: 0,
    volume: 80,
    unlocked: true,
    unlock: vi.fn(),
    playError: null,
    togglePlay: vi.fn(),
    skip: vi.fn(),
    seekMs: vi.fn(),
    setVolume: vi.fn(),
  };

  const dummySponsorBlock: UseSponsorBlockResult = {
    segments: [],
    enabled: false,
    loading: false,
    toggleEnabled: vi.fn(),
    lastSkippedToast: null,
    clearSkipToast: vi.fn(),
    triggerSkipToast: vi.fn(),
  };

  it("renders main container with h-screen flex flex-col overflow-hidden for desktop app layout", () => {
    const { container } = render(
      <RoomShell
        view={dummyView}
        derived={dummyDerived}
        playback={dummyPlayback}
        sponsorBlock={dummySponsorBlock}
        onEnterGame={vi.fn()}
      />
    );

    const mainEl = container.querySelector("main");
    expect(mainEl).toBeInTheDocument();
    expect(mainEl?.className).toContain("h-screen");
    expect(mainEl?.className).toContain("max-h-screen");
    expect(mainEl?.className).toContain("overflow-hidden");
  });

  it("keeps left column (members) pinned with consistent bg-cream/70 and h-full", () => {
    const { container } = render(
      <RoomShell
        view={dummyView}
        derived={dummyDerived}
        playback={dummyPlayback}
        sponsorBlock={dummySponsorBlock}
        onEnterGame={vi.fn()}
      />
    );

    const leftPanel = container.querySelector('[data-panel][id="left-col"]');
    expect(leftPanel).toBeInTheDocument();
    const inner = leftPanel?.firstElementChild as HTMLElement;
    expect(inner?.className).toContain("h-full");
    const leftSection = leftPanel?.querySelector("section");
    expect(leftSection).toBeInTheDocument();
    expect(leftSection?.className).toContain("bg-cream/70");
    expect(leftSection?.className).toContain("h-full");
  });

  it("keeps right column (queue) pinned with consistent bg-cream/70 and h-full", () => {
    const { container } = render(
      <RoomShell
        view={dummyView}
        derived={dummyDerived}
        playback={dummyPlayback}
        sponsorBlock={dummySponsorBlock}
        onEnterGame={vi.fn()}
      />
    );

    const rightPanel = container.querySelector('[data-panel][id="right-col"]');
    expect(rightPanel).toBeInTheDocument();
    const inner = rightPanel?.firstElementChild as HTMLElement;
    expect(inner?.className).toContain("h-full");
    const rightSection = rightPanel?.querySelector("section");
    expect(rightSection).toBeInTheDocument();
    expect(rightSection?.className).toContain("bg-cream/70");
    expect(rightSection?.className).toContain("h-full");
  });

  it("enables overflow-y-auto on center column so leaderboard is fully scrollable and visible", () => {
    const { container } = render(
      <RoomShell
        view={dummyView}
        derived={dummyDerived}
        playback={dummyPlayback}
        sponsorBlock={dummySponsorBlock}
        onEnterGame={vi.fn()}
      />
    );

    const centerPanel = container.querySelector('[data-panel][id="center-col"]');
    expect(centerPanel).toBeInTheDocument();
    const inner = centerPanel?.firstElementChild as HTMLElement;
    expect(inner?.className).toContain("h-full");
    const centerInner = centerPanel?.querySelector('.overflow-y-auto');
    expect(centerInner).toBeInTheDocument();
    expect(centerInner?.className).toContain("overflow-y-auto");
  });

  it("renders resizable group and handles with full height for smooth drag resizing", () => {
    const { container } = render(
      <RoomShell
        view={dummyView}
        derived={dummyDerived}
        playback={dummyPlayback}
        sponsorBlock={dummySponsorBlock}
        onEnterGame={vi.fn()}
      />
    );

    const groupEl = container.querySelector('[data-group]');
    expect(groupEl).toBeInTheDocument();
    expect(groupEl?.className).toContain("flex-1");
    expect(groupEl?.className).toContain("items-stretch");

    const separators = container.querySelectorAll('[role="separator"]');
    expect(separators.length).toBe(2);
    expect(separators[0].className).toContain("cursor-col-resize");
    expect(separators[1].className).toContain("cursor-col-resize");
  });
});
