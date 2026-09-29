import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const auth = vi.hoisted(() => ({ account: { username: "Dat", isRoot: false } as { username: string; isRoot: boolean }, token: "t", logout: vi.fn() }));
const halls = vi.hoisted(() => ({ value: { halls: [] as unknown[], loading: false, error: false } }));
const push = vi.hoisted(() => vi.fn());
const joinRoom = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/hooks/usePublicHalls", () => ({ usePublicHalls: () => halls.value }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/supabase", () => ({ createRoom: vi.fn(), joinRoom }));
vi.mock("@/components/brand/Logo", () => ({ default: () => null }));
vi.mock("@/components/brand/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/feedback/FeedbackButton", () => ({ default: () => null }));

import Lobby from "@/components/lobby/Lobby";
import ClosedRoom from "@/components/room/ClosedRoom";
import JoinGate from "@/components/room/JoinGate";
import { isRoomClosedFor, PUBLIC_HALLS } from "@/lib/halls";

beforeEach(() => { push.mockReset(); joinRoom.mockReset(); auth.account = { username: "Dat", isRoot: false }; });
afterEach(cleanup);

describe("public rooms (0093)", () => {
  it("home lists the halls with live counts and no create form", () => {
    halls.value = { loading: false, error: false, halls: [
      { id: "1", code: "salon-592539", name: "Sảnh Chính", is_playing: true, pinned_order: 1, online: 4 },
      { id: "2", code: "salon-cho-dem", name: "Sảnh Chợ Đêm", is_playing: false, pinned_order: 2, online: 0 },
      { id: "3", code: "salon-song-que", name: "Sảnh Sông Quê", is_playing: false, pinned_order: 3, online: 1 },
    ] };
    render(<Lobby />);
    expect(screen.getAllByTestId("hall-card")).toHaveLength(3);
    expect(screen.getByText("👥 4 đang ở đây")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /Tạo phòng riêng — sắp ra mắt/ });
    expect(create).toBeDisabled();
    expect(screen.queryByPlaceholderText("Mật khẩu phòng")).toBeNull();
    expect(screen.queryByText(/Tạo phòng \(quản trị\)/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Vào ▸" })[1]);
    expect(push).toHaveBeenCalledWith("/room/salon-cho-dem");
  });

  it("root keeps the admin create path", () => {
    auth.account = { username: "root", isRoot: true };
    render(<Lobby />);
    fireEvent.click(screen.getByText(/Tạo phòng \(quản trị\)/));
    expect(screen.getByPlaceholderText("Mật khẩu phòng")).toBeInTheDocument();
  });

  it("an old room is closed to everyone but its admin and root", () => {
    expect(isRoomClosedFor({ kind: "private" }, { isRoot: false, isAdmin: false })).toBe(true);
    expect(isRoomClosedFor({ kind: undefined }, { isRoot: false, isAdmin: false })).toBe(true);
    expect(isRoomClosedFor({ kind: "private" }, { isRoot: false, isAdmin: true })).toBe(false);
    expect(isRoomClosedFor({ kind: "private" }, { isRoot: true, isAdmin: false })).toBe(false);
    expect(isRoomClosedFor({ kind: "public" }, { isRoot: false, isAdmin: false })).toBe(false);
  });

  it("the closed screen links to every hall", () => {
    render(<ClosedRoom name="Phòng cũ" />);
    expect(screen.getByText(/đã tạm đóng/)).toBeInTheDocument();
    for (const h of PUBLIC_HALLS) expect(screen.getByRole("link", { name: `${h.name} ▸` })).toHaveAttribute("href", `/room/${h.code}`);
  });

  it("a hall joins without a password", async () => {
    joinRoom.mockResolvedValue({});
    const onJoined = vi.fn();
    render(<JoinGate code="salon-cho-dem" token="t" name="Sảnh Chợ Đêm" isPublic onJoined={onJoined} />);
    expect(screen.queryByPlaceholderText("Mật khẩu phòng")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Vào sảnh" }));
    await waitFor(() => expect(onJoined).toHaveBeenCalled());
    expect(joinRoom).toHaveBeenCalledWith("salon-cho-dem", "", "t");
  });
});
