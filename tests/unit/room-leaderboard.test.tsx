import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RoomLeaderboard from "@/components/room/RoomLeaderboard";
import type { Room, QueueItem } from "@/lib/supabase";
import type { PlayHistoryItem } from "@/lib/room-stats";

afterEach(() => {
  cleanup();
});

const mockRoom: Room = {
  id: "room-lb-1",
  code: "LB1234",
  name: "Phòng Âm Nhạc",
  play_mode: "order",
  admin_member_id: "m-1",
  dj_member_id: "m-1",
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

const mockHistory: PlayHistoryItem[] = [
  // bexuanmailonton: 3 songs (Rank 1)
  { id: "h1", room_id: "room-lb-1", youtube_video_id: "v1", title: "Song 1", added_by_name: "bexuanmailonton", played_at: "2026-01-01T10:00:00Z" },
  { id: "h2", room_id: "room-lb-1", youtube_video_id: "v2", title: "Song 2", added_by_name: "bexuanmailonton", played_at: "2026-01-01T10:05:00Z" },
  { id: "h3", room_id: "room-lb-1", youtube_video_id: "v3", title: "Song 3", added_by_name: "bexuanmailonton", played_at: "2026-01-01T10:10:00Z" },
  // hunglt: 2 songs (Rank 2)
  { id: "h4", room_id: "room-lb-1", youtube_video_id: "v4", title: "Song 4", added_by_name: "hunglt", played_at: "2026-01-01T10:15:00Z" },
  { id: "h5", room_id: "room-lb-1", youtube_video_id: "v5", title: "Song 5", added_by_name: "hunglt", played_at: "2026-01-01T10:20:00Z" },
  // yuu: 1 song (Rank 3)
  { id: "h6", room_id: "room-lb-1", youtube_video_id: "v6", title: "Song 6", added_by_name: "yuu", played_at: "2026-01-01T10:25:00Z" },
];

describe("RoomLeaderboard", () => {
  it("renders header with history count and Olympic podium for top 3", () => {
    render(
      <RoomLeaderboard
        room={mockRoom}
        queue={[]}
        current={null}
        roomId="room-lb-1"
        token="token-xyz"
        history={mockHistory}
      />
    );

    // Title and total songs
    expect(screen.getByText("Bảng Vàng Âm Nhạc")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();

    // Top 1: bexuanmailonton (Quán Quân)
    expect(screen.getByText(/#1 Quán Quân/i)).toBeInTheDocument();
    expect(screen.getByText("bexuanmailonton")).toBeInTheDocument();
    expect(screen.getByText("3 bài")).toBeInTheDocument();

    // Top 2: hunglt (Á Quân)
    expect(screen.getByText(/#2 Á Quân/i)).toBeInTheDocument();
    expect(screen.getByText("hunglt")).toBeInTheDocument();
    expect(screen.getByText("2 bài")).toBeInTheDocument();

    // Top 3: yuu (Hạng Ba)
    expect(screen.getByText(/#3 Hạng Ba/i)).toBeInTheDocument();
    expect(screen.getByText("yuu")).toBeInTheDocument();
    expect(screen.getByText("1 bài")).toBeInTheDocument();
  });

  it("switches to Random / Shuffle Luck tab cleanly", async () => {
    render(
      <RoomLeaderboard
        room={mockRoom}
        queue={[]}
        current={null}
        roomId="room-lb-1"
        token="token-xyz"
        history={mockHistory}
      />
    );

    const randomTabBtn = screen.getByRole("button", { name: /🎲 Random/i });
    await userEvent.click(randomTabBtn);

    expect(screen.getByText(/Vận may Random/i)).toBeInTheDocument();
  });

  it("switches to Vừa Phát (History) tab cleanly", async () => {
    render(
      <RoomLeaderboard
        room={mockRoom}
        queue={[]}
        current={null}
        roomId="room-lb-1"
        token="token-xyz"
        history={mockHistory}
      />
    );

    const historyTabBtn = screen.getByRole("button", { name: /📜 Vừa Phát/i });
    await userEvent.click(historyTabBtn);

    expect(screen.getByText(/Vừa lên sóng gần đây/i)).toBeInTheDocument();
    expect(screen.getByText("Song 1")).toBeInTheDocument();
    expect(screen.getByText("Song 6")).toBeInTheDocument();
  });
});
