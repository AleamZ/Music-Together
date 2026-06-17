"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage } from "@/lib/chat";
import { newFromOthers } from "@/lib/chat-notify";
import { playTing } from "@/lib/sound";
import { ensureNotifyPermission, notifyDesktop } from "@/lib/notify";

const NOTIFY_KEY = "music-together:notify";

export default function ChatPanel({ roomId, token, accountId, isAdmin }: {
  roomId: string; token: string; accountId: string; isAdmin: boolean;
}) {
  const { messages, send, remove, canDelete } = useChat(roomId, token, { accountId, isAdmin });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [notifyOn, setNotifyOn] = useState(true);

  const listRef = useRef<HTMLDivElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const atBottomRef = useRef(true);
  const initializedRef = useRef(false);
  const notifyOnRef = useRef(notifyOn);
  const permAskedRef = useRef(false);

  // Hydrate the notify preference from localStorage (default ON). Effect-only → no SSR mismatch.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { const v = localStorage.getItem(NOTIFY_KEY); if (v !== null) setNotifyOn(v === "1"); } catch { /* ignore */ }
  }, []);
  useEffect(() => { notifyOnRef.current = notifyOn; }, [notifyOn]);

  // Clear unread when the tab becomes visible while already scrolled to the bottom.
  useEffect(() => {
    function onVis() { if (!document.hidden && atBottomRef.current) setUnread(0); }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // React to new messages: notify when "away", auto-scroll only when at bottom / own message.
  useEffect(() => {
    const list = listRef.current;
    // Wait for the first non-empty batch (history loads async) before baselining
    // "seen" — otherwise the whole history would notify when the room opens in a
    // background tab.
    if (!initializedRef.current) {
      if (messages.length === 0) return;
      messages.forEach((m) => seenRef.current.add(m.id));
      initializedRef.current = true;
      list?.scrollTo({ top: list.scrollHeight });
      return;
    }
    const fresh = newFromOthers(messages, seenRef.current, accountId);
    messages.forEach((m) => seenRef.current.add(m.id));
    const lastMsg = messages[messages.length - 1];
    const ownLast = !!lastMsg && lastMsg.account_id === accountId;
    const away = !atBottomRef.current || (typeof document !== "undefined" && document.hidden);
    if (fresh.length > 0 && away) {
      setUnread((u) => u + fresh.length);
      if (notifyOnRef.current) {
        playTing();
        const latest = fresh[fresh.length - 1];
        notifyDesktop(latest.username, latest.body);
      }
    }
    if (atBottomRef.current || ownLast) list?.scrollTo({ top: list.scrollHeight });
    if (atBottomRef.current && !document.hidden) setUnread(0);
  }, [messages, accountId]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    atBottomRef.current = atBottom;
    if (atBottom && !document.hidden) setUnread(0);
  }

  function jumpToBottom() {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight });
    atBottomRef.current = true;
    setUnread(0);
  }

  function toggleNotify() {
    const next = !notifyOn;
    setNotifyOn(next);
    try { localStorage.setItem(NOTIFY_KEY, next ? "1" : "0"); } catch { /* ignore */ }
    if (next) void ensureNotifyPermission();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setError(null);
    if (notifyOnRef.current && !permAskedRef.current) { permAskedRef.current = true; void ensureNotifyPermission(); }
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
      <h3 className="mb-2 flex items-center justify-between font-cormorant text-lg text-burgundy">
        <span>Trò chuyện{unread > 0 ? ` (${unread})` : ""}</span>
        <button type="button" onClick={toggleNotify} title={notifyOn ? "Tắt thông báo" : "Bật thông báo"}
          className="text-base leading-none">{notifyOn ? "🔔" : "🔕"}</button>
      </h3>
      <div ref={listRef} onScroll={onScroll}
        className="flex h-48 flex-col gap-1 overflow-y-auto rounded-lg border border-gold-200 bg-cream/60 p-2 text-sm">
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
      {unread > 0 && (
        <button type="button" onClick={jumpToBottom}
          className="mt-1 w-full rounded-lg bg-burgundy/90 py-1 text-xs text-cream">↓ {unread} tin mới</button>
      )}
      {error && <p className="mt-1 text-xs text-burgundy-accent">{error}</p>}
      <form onSubmit={submit} className="mt-2 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Nhắn gì đó…"
          className="flex-1 rounded-lg border border-gold-200 bg-cream px-2 py-1.5 text-sm text-ink" />
        <button type="submit" className="rounded-lg bg-burgundy px-3 text-cream">Gửi</button>
      </form>
    </div>
  );
}
