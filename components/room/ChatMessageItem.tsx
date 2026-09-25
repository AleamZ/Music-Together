"use client";

import { useMemo } from "react";
import type { ChatMessage } from "@/lib/chat";
import { parseChatMessageBody, MENTION_REGEX } from "@/lib/chat-helpers";
import { parseAnnouncement } from "@/lib/game/fishing/announce";
import type { Member, Room } from "@/lib/supabase";

interface ChatMessageItemProps {
  message: ChatMessage;
  allMessages: ChatMessage[];
  currentAccountId: string;
  currentUsername?: string;
  members: Member[];
  room?: Room | null;
  isHighlighted?: boolean;
  canDelete: boolean;
  onReply: (message: ChatMessage) => void;
  onDelete: (id: string) => void;
  onJumpToReply: (messageId: string) => void;
  onMentionUser?: (username: string) => void;
}

export default function ChatMessageItem({
  message,
  allMessages,
  currentAccountId,
  currentUsername,
  members,
  room,
  isHighlighted = false,
  canDelete,
  onReply,
  onDelete,
  onJumpToReply,
  onMentionUser,
}: ChatMessageItemProps) {
  const isMe = !!message.account_id && message.account_id === currentAccountId;
  // A rare catch (v14) or a land sale (v15) posted by the server: a system line — no avatar, no reply; the room admin
  // may still delete it.
  const announcement = useMemo(() => parseAnnouncement(message), [message]);

  // Find member info for role badges
  const member = members.find((m) => m.account_id === message.account_id);
  const isAdmin = room?.admin_member_id && member?.id === room.admin_member_id;
  const isDj = room?.dj_member_id && member?.id === room.dj_member_id;

  // Parse reply & text
  const { replyToId, replyToUsername, text } = useMemo(
    () => parseChatMessageBody(message.body),
    [message.body],
  );

  // Look up quoted message in current loaded history if available
  const quotedMessage = useMemo(() => {
    if (!replyToId) return null;
    return allMessages.find((m) => m.id === replyToId) ?? null;
  }, [replyToId, allMessages]);

  // Format time (HH:mm)
  const timeFormatted = useMemo(() => {
    try {
      const date = new Date(message.created_at);
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  }, [message.created_at]);

  // Render text with @mentions highlighted
  const renderedText = useMemo(() => {
    if (!text) return null;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    const matches = Array.from(text.matchAll(MENTION_REGEX));

    matches.forEach((match, idx) => {
      const matchIndex = match.index ?? 0;
      if (matchIndex > lastIndex) {
        parts.push(text.slice(lastIndex, matchIndex));
      }

      const mentionedName = match[1];
      const isMentionMe =
        currentUsername &&
        mentionedName.toLowerCase() === currentUsername.toLowerCase();

      parts.push(
        <button
          key={`mention-${idx}-${mentionedName}`}
          type="button"
          onClick={() => onMentionUser?.(mentionedName)}
          className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold transition-transform hover:scale-105 ${
            isMentionMe
              ? "bg-gold-200 text-burgundy ring-1 ring-gold shadow-xs font-bold"
              : "bg-burgundy/10 text-burgundy hover:bg-burgundy/20"
          }`}
          title={`Nhắc tới @${mentionedName}`}
        >
          @{mentionedName}
        </button>,
      );

      lastIndex = matchIndex + match[0].length;
    });

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return parts;
  }, [text, currentUsername, onMentionUser]);

  if (announcement) {
    return (
      <div
        id={`chat-msg-${message.id}`}
        className={`group relative flex items-center justify-center gap-2 rounded-xl px-2.5 py-1.5 text-center ${
          isHighlighted ? "bg-gold-200/50 ring-2 ring-gold" : ""
        }`}
      >
        <p className="text-xs italic leading-relaxed text-burgundy font-serif">{announcement.text}</p>
        {timeFormatted && <span className="text-[10px] text-ink/40 font-mono">{timeFormatted}</span>}
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            className="rounded p-1 text-xs text-burgundy-accent opacity-0 transition-opacity hover:bg-burgundy/10 group-hover:opacity-100"
            title="Xóa tin nhắn"
          >
            ✕
          </button>
        )}
      </div>
    );
  }

  return (
    <div
      id={`chat-msg-${message.id}`}
      className={`group relative flex gap-2.5 rounded-xl px-2.5 py-2 transition-all duration-300 ${
        isHighlighted
          ? "bg-gold-200/50 ring-2 ring-gold shadow-md scale-[1.01]"
          : isMe
          ? "bg-parchment-200/45 hover:bg-parchment-200/65"
          : "hover:bg-cream/80"
      }`}
    >
      {/* Avatar */}
      <div className="shrink-0 pt-0.5">
        <div
          className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold shadow-xs ${
            isAdmin
              ? "bg-burgundy text-cream ring-2 ring-gold"
              : isDj
              ? "bg-green-vintage text-cream ring-2 ring-green-vintage/40"
              : isMe
              ? "bg-burgundy-accent text-cream"
              : "bg-gold-200 text-ink"
          }`}
          title={message.username}
        >
          {message.username ? message.username.charAt(0).toUpperCase() : "?"}
        </div>
      </div>

      {/* Message Body & Info */}
      <div className="min-w-0 flex-1">
        {/* Header: Author + Badges + Time */}
        <div className="flex flex-wrap items-baseline gap-1.5 leading-none mb-1">
          <span className="font-playfair text-xs font-bold text-burgundy">
            {message.username}
          </span>

          {isMe && (
            <span className="rounded bg-burgundy/15 px-1 py-0.2 text-[9px] font-medium text-burgundy">
              Bạn
            </span>
          )}

          {isAdmin && (
            <span className="rounded bg-burgundy px-1.5 py-0.2 text-[9px] text-cream">
              👑 Admin
            </span>
          )}

          {isDj && (
            <span className="rounded bg-green-vintage px-1.5 py-0.2 text-[9px] text-cream">
              🎧 DJ
            </span>
          )}

          {timeFormatted && (
            <span className="text-[10px] text-ink/40 font-mono ml-auto">
              {timeFormatted}
            </span>
          )}
        </div>

        {/* Quoted Reply box (if message is a reply) */}
        {(replyToId || replyToUsername) && (
          <div
            onClick={() => replyToId && onJumpToReply(replyToId)}
            className={`mb-1.5 flex items-center gap-1.5 rounded-lg border-l-3 border-burgundy bg-gold-200/30 px-2 py-1 text-xs text-ink/80 transition-colors ${
              replyToId ? "cursor-pointer hover:bg-gold-200/50" : ""
            }`}
            title={replyToId ? "Nhấn để chuyển đến tin nhắn gốc" : undefined}
          >
            <span className="text-burgundy font-medium text-[11px] shrink-0">
              ↩ {replyToUsername ? `@${replyToUsername}` : "Trả lời"}:
            </span>
            <span className="truncate text-ink/70 text-[11px]">
              {quotedMessage ? parseChatMessageBody(quotedMessage.body).text : "Tin nhắn gốc…"}
            </span>
          </div>
        )}

        {/* Message Content */}
        <div className="whitespace-pre-wrap break-words text-sm text-ink leading-relaxed font-serif">
          {renderedText}
        </div>
      </div>

      {/* Floating Hover Action Toolbar */}
      <div className="absolute right-2 top-1 flex items-center gap-1 rounded-lg border border-gold-200 bg-cream px-1.5 py-0.5 shadow-sm opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => onReply(message)}
          className="rounded p-1 text-xs text-burgundy hover:bg-gold-200/50 active:scale-95"
          title="Trả lời tin nhắn"
        >
          ↩ Trả lời
        </button>

        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(message.id)}
            className="rounded p-1 text-xs text-burgundy-accent hover:bg-burgundy/10 active:scale-95"
            title="Xóa tin nhắn"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
