import { describe, it, expect } from "vitest";
import { pickReplayCandidate } from "@/lib/replay-history";
import type { PlayHistoryItem } from "@/lib/room-stats";

describe("pickReplayCandidate", () => {
  it("returns null if history is empty", () => {
    expect(pickReplayCandidate([])).toBeNull();
  });

  it("picks the least recently played track in 'order' mode", () => {
    const history: PlayHistoryItem[] = [
      { id: "1", room_id: "r", youtube_video_id: "vid_recent", title: "Recent", added_by_name: "A", played_at: "2026-09-23T12:00:00Z" },
      { id: "2", room_id: "r", youtube_video_id: "vid_oldest", title: "Oldest", added_by_name: "B", played_at: "2026-09-23T10:00:00Z" },
      { id: "3", room_id: "r", youtube_video_id: "vid_middle", title: "Middle", added_by_name: "C", played_at: "2026-09-23T11:00:00Z" },
    ];

    const picked = pickReplayCandidate(history, null, "order");
    expect(picked?.youtube_video_id).toBe("vid_oldest");
  });

  it("excludes current track if other tracks exist in history", () => {
    const history: PlayHistoryItem[] = [
      { id: "1", room_id: "r", youtube_video_id: "vid_old", title: "Old", added_by_name: "A", played_at: "2026-09-23T10:00:00Z" },
      { id: "2", room_id: "r", youtube_video_id: "vid_new", title: "New", added_by_name: "B", played_at: "2026-09-23T11:00:00Z" },
    ];

    // Even though vid_old is oldest, if current track was vid_old, it should pick vid_new
    const picked = pickReplayCandidate(history, "vid_old", "order");
    expect(picked?.youtube_video_id).toBe("vid_new");
  });

  it("falls back to the current track if only 1 unique video exists in history", () => {
    const history: PlayHistoryItem[] = [
      { id: "1", room_id: "r", youtube_video_id: "single_vid", title: "Single", added_by_name: "A", played_at: "2026-09-23T10:00:00Z" },
      { id: "2", room_id: "r", youtube_video_id: "single_vid", title: "Single 2", added_by_name: "A", played_at: "2026-09-23T11:00:00Z" },
    ];

    const picked = pickReplayCandidate(history, "single_vid", "order");
    expect(picked?.youtube_video_id).toBe("single_vid");
  });

  it("picks random track in 'shuffle' mode", () => {
    const history: PlayHistoryItem[] = [
      { id: "1", room_id: "r", youtube_video_id: "vid1", title: "Song 1", added_by_name: "A", played_at: "2026-09-23T10:00:00Z" },
      { id: "2", room_id: "r", youtube_video_id: "vid2", title: "Song 2", added_by_name: "B", played_at: "2026-09-23T11:00:00Z" },
    ];

    // Mock random returning 0.99 (index 1)
    const picked1 = pickReplayCandidate(history, null, "shuffle", () => 0.99);
    expect(picked1?.youtube_video_id).toBe("vid2");

    // Mock random returning 0 (index 0)
    const picked0 = pickReplayCandidate(history, null, "shuffle", () => 0);
    expect(picked0?.youtube_video_id).toBe("vid1");
  });
});
