import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import HudNowPlaying from "@/components/game/HudNowPlaying";
import MapCounts from "@/components/game/MapCounts";
import type { PlaybackController } from "@/hooks/usePlayback";
import type { QueueItem, Room } from "@/lib/supabase";

afterEach(cleanup);

const room: Room = {
  id: "r", code: "ABC", name: "Phòng", play_mode: "order", admin_member_id: null, dj_member_id: null,
  current_item_id: "q1", is_playing: true, started_at: null, paused_elapsed_ms: 0, created_at: "",
  max_duration_seconds: 600, require_approval: false, banned_keywords: [], max_orders_per_member: 3, auto_replay_history: false,
};
const current: QueueItem = {
  id: "q1", room_id: "r", youtube_video_id: "v", title: "Lý cây bông", thumbnail_url: null, duration_seconds: 200,
  added_by_account_id: null, added_by_name: "An", position: 0, created_at: "", status: "approved",
};
const playback: PlaybackController = {
  durationMs: 200_000, volume: 50, unlocked: true, unlock: vi.fn(), playError: null,
  togglePlay: vi.fn(), skip: vi.fn(), seekMs: vi.fn(), setVolume: vi.fn(),
};
const noop = () => {};

describe("HudNowPlaying on a phone", () => {
  it("starts as a one-line chip that expands into the card and collapses again", () => {
    render(
      <HudNowPlaying room={room} current={current} djName="An" canControl playback={playback} canOpenSettings={false}
        onOpenQueue={noop} onOpenBoard={noop} onOpenSettings={noop} />,
    );
    const chip = screen.getByRole("button", { name: "Mở thẻ đang phát" }).parentElement!;
    const card = screen.getByRole("button", { name: "Thu gọn" }).closest(".w-72")!;
    expect(chip.className).toMatch(/(^|\s)flex(\s|$)/);
    expect(card.className).toMatch(/hidden sm:flex/);
    fireEvent.click(screen.getByRole("button", { name: "Mở thẻ đang phát" }));
    expect(chip.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(card.className).not.toMatch(/hidden/);
    fireEvent.click(screen.getByRole("button", { name: "Thu gọn" }));
    expect(card.className).toMatch(/hidden sm:flex/);
  });
  it("keeps the DJ's play/pause in the chip", () => {
    render(
      <HudNowPlaying room={room} current={current} djName="An" canControl playback={playback} canOpenSettings={false}
        onOpenQueue={noop} onOpenBoard={noop} onOpenSettings={noop} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Tạm dừng" })[0]);
    expect(playback.togglePlay).toHaveBeenCalledTimes(1);
  });
});

describe("MapCounts", () => {
  it("counts each map and lists the names on tap, classic members marked", () => {
    render(<MapCounts counts={{
      hall: [{ accountId: "a", name: "An", classic: true }, { accountId: "b", name: "Bình", classic: false }],
      pond: [{ accountId: "c", name: "Chi", classic: false }],
    }} />);
    const chip = screen.getByRole("button", { name: "🎵 Sảnh 2 · 🎣 Ao cá 1" });
    expect(screen.queryByText("🖥️ An")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText("🖥️ An")).toBeInTheDocument();
    expect(screen.getByText("Bình")).toBeInTheDocument();
    expect(screen.getByText("Chi")).toBeInTheDocument();
  });
});
