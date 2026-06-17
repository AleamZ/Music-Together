"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage } from "@/lib/chat";

export default function ChatPanel({ roomId, token, accountId, isAdmin }: {
  roomId: string; token: string; accountId: string; isAdmin: boolean;
}) {
  const { messages, send, remove, canDelete } = useChat(roomId, token, { accountId, isAdmin });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError(null);
    try { await send(body); setText(""); }
    catch (err) {
      const m = (err as { message?: string }).message ?? "Không gửi được";
      setError(
        m.includes("too many messages") ? "Bạn nhắn quá nhanh, chờ chút nhé."
        : m.includes("invalid message") ? "Tin nhắn không hợp lệ (tối đa 500 ký tự)."
        : m.includes("not a member") ? "Bạn cần ở trong phòng để nhắn."
        : m,
      );
    }
  }

  return (
    <div className="mt-4">
      <h3 className="mb-2 font-cormorant text-lg text-burgundy">Trò chuyện</h3>
      <div ref={listRef} className="flex h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-gold-200 bg-cream/60 p-2 text-sm">
        {messages.length === 0 && <p className="m-auto text-xs text-ink/50">Chưa có tin nhắn nào.</p>}
        {messages.map((m: ChatMessage) => (
          <div key={m.id} className="group flex items-start gap-1">
            <span className="min-w-0 text-ink">
              <b className="text-burgundy">{m.username}</b>{" "}
              <span className="whitespace-pre-wrap wrap-break-word">{m.body}</span>
            </span>
            {canDelete(m) && (
              <button type="button" onClick={() => remove(m.id).catch(() => {})}
                className="ml-auto shrink-0 px-1 text-xs text-burgundy-accent opacity-0 group-hover:opacity-100">✕</button>
            )}
          </div>
        ))}
      </div>
      {error && <p className="mt-1 text-xs text-burgundy-accent">{error}</p>}
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Nhắn gì đó…"
          className="flex-1 rounded-lg border border-gold-200 bg-cream px-2 py-1.5 text-sm text-ink" />
        <button type="submit" className="rounded-lg bg-burgundy px-3 text-cream">Gửi</button>
      </form>
    </div>
  );
}
