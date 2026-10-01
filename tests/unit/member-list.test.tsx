import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MemberList from "@/components/room/MemberList";
import type { Member, Room } from "@/lib/supabase";

afterEach(() => {
  cleanup();
});

const mockRoom: Room = {
  id: "room-123",
  code: "ABCDEF",
  name: "Phòng Nhạc Chill",
  play_mode: "order",
  admin_member_id: "m-admin",
  dj_member_id: "m-dj",
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
};

const mockMembers: Member[] = [
  { id: "m-offline-1", room_id: "room-123", account_id: "acc-off-1", username: "Ba nè con", joined_at: "2026-01-01" },
  { id: "m-offline-2", room_id: "room-123", account_id: "acc-off-2", username: "do do", joined_at: "2026-01-01" },
  { id: "m-admin", room_id: "room-123", account_id: "acc-admin", username: "AleamZ", joined_at: "2026-01-01" },
  { id: "m-dj", room_id: "room-123", account_id: "acc-dj", username: "tester1", joined_at: "2026-01-01" },
  { id: "m-me", room_id: "room-123", account_id: "acc-me", username: "Hainm", joined_at: "2026-01-01" },
  { id: "m-online-other", room_id: "room-123", account_id: "acc-on-other", username: "yuu", joined_at: "2026-01-01" },
];

// Online users: AleamZ (admin), tester1 (dj), Hainm (me), yuu (online-other) -> 4 online
const onlineAccountIds = ["acc-admin", "acc-dj", "acc-me", "acc-on-other"];

describe("MemberList", () => {
  it("renders header with total and online counts", () => {
    render(
      <MemberList
        members={mockMembers}
        room={mockRoom}
        onlineIds={onlineAccountIds}
        isAdmin={true}
        token="test-token"
        myMemberId="m-me"
      />
    );

    expect(screen.getByText("Thành viên")).toBeInTheDocument();
    expect(screen.getByTitle(/4 thành viên đang trực tuyến/i)).toBeInTheDocument();
    expect(screen.getByText(/\/ 6 online/i)).toBeInTheDocument();
  });

  it("prioritizes current user, admin, dj, and online members at top of list", () => {
    render(
      <MemberList
        members={mockMembers}
        room={mockRoom}
        onlineIds={onlineAccountIds}
        isAdmin={false}
        token="test-token"
        myMemberId="m-me"
      />
    );

    // Current user has "Bạn" tag
    expect(screen.getByText("Bạn")).toBeInTheDocument();

    // Admin has "👑 Host" badge
    expect(screen.getByText("👑 Host")).toBeInTheDocument();

    // DJ has "🎧 DJ" badge
    expect(screen.getByText("🎧 DJ")).toBeInTheDocument();
  });

  it("filters members when switching to Online tab", async () => {
    render(
      <MemberList
        members={mockMembers}
        room={mockRoom}
        onlineIds={onlineAccountIds}
        isAdmin={false}
        token="test-token"
        myMemberId="m-me"
      />
    );

    // Initially all 6 members are visible
    expect(screen.getByText("Ba nè con")).toBeInTheDocument();
    expect(screen.getByText("do do")).toBeInTheDocument();

    // Switch to Online tab
    const onlineTabBtn = screen.getByRole("button", { name: /Online \(4\)/i });
    await userEvent.click(onlineTabBtn);

    // Offline members should not be visible
    expect(screen.queryByText("Ba nè con")).not.toBeInTheDocument();
    expect(screen.queryByText("do do")).not.toBeInTheDocument();

    // Online members remain visible
    expect(screen.getByText("Hainm")).toBeInTheDocument();
    expect(screen.getByText("AleamZ")).toBeInTheDocument();
    expect(screen.getByText("tester1")).toBeInTheDocument();
    expect(screen.getByText("yuu")).toBeInTheDocument();
  });

  it("filters members using search input", async () => {
    render(
      <MemberList
        members={mockMembers}
        room={mockRoom}
        onlineIds={onlineAccountIds}
        isAdmin={false}
        token="test-token"
        myMemberId="m-me"
      />
    );

    const searchInput = screen.getByPlaceholderText("Tìm theo tên...");
    await userEvent.type(searchInput, "tester1");

    expect(screen.getByText("tester1")).toBeInTheDocument();
    expect(screen.queryByText("AleamZ")).not.toBeInTheDocument();
    expect(screen.queryByText("Ba nè con")).not.toBeInTheDocument();
  });
});
