import { describe, it, expect } from "vitest";
import {
  computeContributorRanking,
  computeTopTracks,
  computeShuffleLuck,
  formatRelativeTime,
  type PlayHistoryItem,
} from "@/lib/room-stats";
import type { QueueItem } from "@/lib/supabase";

describe("computeContributorRanking", () => {
  it("computes rankings, percentages, and assigns top badges", () => {
    const history: PlayHistoryItem[] = [
      { id: "1", room_id: "r1", youtube_video_id: "v1", title: "Song 1", added_by_name: "Alice", played_at: new Date().toISOString() },
      { id: "2", room_id: "r1", youtube_video_id: "v2", title: "Song 2", added_by_name: "Alice", played_at: new Date().toISOString() },
      { id: "3", room_id: "r1", youtube_video_id: "v3", title: "Song 3", added_by_name: "Bob", played_at: new Date().toISOString() },
      { id: "4", room_id: "r1", youtube_video_id: "v4", title: "Song 4", added_by_name: "Charlie", played_at: new Date().toISOString() },
      { id: "5", room_id: "r1", youtube_video_id: "v5", title: "Song 5", added_by_name: "Dave", played_at: new Date().toISOString() },
    ];

    const queue: QueueItem[] = [
      { id: "q1", room_id: "r1", youtube_video_id: "v6", title: "Song 6", added_by_name: "Bob", added_by_account_id: "b1", position: 1, created_at: "", status: "approved", thumbnail_url: null, duration_seconds: null },
    ];

    const result = computeContributorRanking(history, queue);

    expect(result.length).toBe(4);
    // Rank 1: Alice (2 played, 0 queued = 2 total, 40%)
    expect(result[0].name).toBe("Alice");
    expect(result[0].playedCount).toBe(2);
    expect(result[0].percentage).toBe(40);
    expect(result[0].badge?.title).toBe("Bá Chủ Âm Nhạc");
    expect(result[0].badge?.icon).toBe("👑");

    // Rank 2: Bob (1 played, 1 queued = 2 total, 20%)
    expect(result[1].name).toBe("Bob");
    expect(result[1].playedCount).toBe(1);
    expect(result[1].queuedCount).toBe(1);
    expect(result[1].badge?.title).toBe("Chiến Thần Đóng Góp");
    expect(result[1].badge?.icon).toBe("🥈");

    // Rank 3: Charlie (1 played, 0 queued)
    expect(result[2].badge?.title).toBe("Gout Đỉnh Chóp");
    expect(result[2].badge?.icon).toBe("🥉");

    // Rank 4: Dave (no badge)
    expect(result[3].badge).toBeUndefined();
  });

  it("handles empty history cleanly", () => {
    const result = computeContributorRanking([]);
    expect(result).toEqual([]);
  });
});

describe("computeTopTracks", () => {
  it("groups repeated tracks and sorts by playCount", () => {
    const history: PlayHistoryItem[] = [
      { id: "1", room_id: "r1", youtube_video_id: "vA", title: "Hit Track", added_by_name: "Alice", played_at: "2026-09-20T10:00:00Z" },
      { id: "2", room_id: "r1", youtube_video_id: "vB", title: "Chill Beats", added_by_name: "Bob", played_at: "2026-09-20T11:00:00Z" },
      { id: "3", room_id: "r1", youtube_video_id: "vA", title: "Hit Track", added_by_name: "Charlie", played_at: "2026-09-20T12:00:00Z" },
    ];

    const top = computeTopTracks(history);
    expect(top.length).toBe(2);
    expect(top[0].videoId).toBe("vA");
    expect(top[0].playCount).toBe(2);
    expect(top[0].lastAddedBy).toBe("Charlie"); // most recent
    expect(top[1].videoId).toBe("vB");
    expect(top[1].playCount).toBe(1);
  });
});

describe("computeShuffleLuck", () => {
  it("calculates shuffle pick share per user", () => {
    const history: PlayHistoryItem[] = [
      { id: "1", room_id: "r1", youtube_video_id: "v1", title: "T1", added_by_name: "Alice", played_at: "" },
      { id: "2", room_id: "r1", youtube_video_id: "v2", title: "T2", added_by_name: "Alice", played_at: "" },
      { id: "3", room_id: "r1", youtube_video_id: "v3", title: "T3", added_by_name: "Alice", played_at: "" },
      { id: "4", room_id: "r1", youtube_video_id: "v4", title: "T4", added_by_name: "Bob", played_at: "" },
    ];

    const luck = computeShuffleLuck(history);
    expect(luck[0].name).toBe("Alice");
    expect(luck[0].pickedCount).toBe(3);
    expect(luck[0].percentage).toBe(75);
    expect(luck[1].name).toBe("Bob");
    expect(luck[1].percentage).toBe(25);
  });
});

describe("formatRelativeTime", () => {
  it("formats recent timestamps to Vietnamese relative text", () => {
    const now = Date.now();
    expect(formatRelativeTime(new Date(now - 10 * 1000).toISOString())).toBe("vừa xong");
    expect(formatRelativeTime(new Date(now - 5 * 60 * 1000).toISOString())).toBe("5 phút trước");
    expect(formatRelativeTime(new Date(now - 2 * 3600 * 1000).toISOString())).toBe("2 giờ trước");
    expect(formatRelativeTime(new Date(now - 25 * 3600 * 1000).toISOString())).toBe("hôm qua");
  });
});
