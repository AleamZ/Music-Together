"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchRecentMessages, subscribeChat, sendChatMessage, deleteChatMessage, type ChatMessage,
} from "@/lib/chat";

export function useChat(roomId: string, token: string, viewer: { accountId: string; isAdmin: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  useEffect(() => {
    let active = true;
    fetchRecentMessages(roomId).then((m) => { if (active) setMessages(m); }).catch(() => {});
    const unsub = subscribeChat(roomId, {
      onInsert: (msg) => setMessages((prev) => (prev.some((p) => p.id === msg.id) ? prev : [...prev, msg])),
      onDelete: (id) => setMessages((prev) => prev.filter((p) => p.id !== id)),
    });
    return () => { active = false; unsub(); };
  }, [roomId]);

  const send = useCallback((body: string) => sendChatMessage(token, roomId, body), [token, roomId]);
  const remove = useCallback((id: string) => deleteChatMessage(token, roomId, id), [token, roomId]);
  const canDelete = useCallback(
    (m: ChatMessage) => viewer.isAdmin || (!!viewer.accountId && m.account_id === viewer.accountId),
    [viewer.isAdmin, viewer.accountId],
  );
  return { messages, send, remove, canDelete };
}
