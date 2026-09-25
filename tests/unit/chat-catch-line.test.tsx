import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ChatMessageItem from "@/components/room/ChatMessageItem";
import type { ChatMessage } from "@/lib/chat";

afterEach(cleanup);

const ACC = "0b6a4c3e-1d2f-4a5b-8c7d-9e0f1a2b3c4d";
const BODY = `[catch:${ACC}|ca_tra|3150] 🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!`;
const msg = (over: Partial<ChatMessage>): ChatMessage => ({
  id: "m1", room_id: "r", account_id: null, username: "Ao cá", body: BODY, created_at: "2026-09-24T10:00:00Z", ...over,
});
const renderItem = (message: ChatMessage, canDelete: boolean, onDelete = vi.fn()) => {
  render(
    <ChatMessageItem message={message} allMessages={[message]} currentAccountId="me" members={[]} canDelete={canDelete}
      onReply={() => {}} onDelete={onDelete} onJumpToReply={() => {}} />,
  );
  return onDelete;
};

describe("ChatMessageItem — catch announcements", () => {
  it("shows a server catch as a system line without reply, and lets the admin delete it", () => {
    const onDelete = renderItem(msg({}), true);
    expect(screen.getByText("🎣 Dat vừa câu được Cá tra 3,2 kg (Hiếm)!")).toBeInTheDocument();
    expect(screen.queryByTitle("Trả lời tin nhắn")).toBeNull();
    expect(screen.queryByTitle("Ao cá")).toBeNull(); // no avatar
    fireEvent.click(screen.getByTitle("Xóa tin nhắn"));
    expect(onDelete).toHaveBeenCalledWith("m1");
  });
  it("hides the delete button from members", () => {
    renderItem(msg({}), false);
    expect(screen.queryByTitle("Xóa tin nhắn")).toBeNull();
  });
  it("shows a land sale by the co-op as a system line too", () => {
    renderItem(msg({ username: "Hợp tác xã", body: "[land:3] 🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu." }), false);
    expect(screen.getByText("🏡 Lan đã mua thửa 3 của Dat với giá 8.500 xu.")).toBeInTheDocument();
    expect(screen.queryByTitle("Trả lời tin nhắn")).toBeNull();
  });
  it("renders a member typing the prefix as a normal message", () => {
    renderItem(msg({ account_id: ACC, username: "Dat" }), false);
    expect(screen.getByTitle("Trả lời tin nhắn")).toBeInTheDocument();
    expect(screen.getByText(BODY)).toBeInTheDocument();
  });
});
