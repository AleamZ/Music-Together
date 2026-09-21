"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage } from "@/lib/chat";
import { newFromOthers } from "@/lib/chat-notify";
import { formatChatMessageBody, cleanNotificationText } from "@/lib/chat-helpers";
import { playTing } from "@/lib/sound";
import { ensureNotifyPermission, notifyDesktop } from "@/lib/notify";
import type { Member, Room } from "@/lib/supabase";
import ChatMessageItem from "./ChatMessageItem";
import EmojiPickerPopover from "./EmojiPickerPopover";
import MentionAutocomplete from "./MentionAutocomplete";

const NOTIFY_KEY = "music-together:notify";

interface ChatPanelProps {
  roomId: string;
  token: string;
  accountId: string;
  isAdmin: boolean;
  members?: Member[];
  room?: Room | null;
  onExpand?: () => void;
  isDrawer?: boolean;
  onCloseDrawer?: () => void;
}

export default function ChatPanel({
  roomId,
  token,
  accountId,
  isAdmin,
  members = [],
  room = null,
  onExpand,
  isDrawer = false,
  onCloseDrawer,
}: ChatPanelProps) {
  const { messages, send, remove, canDelete } = useChat(roomId, token, { accountId, isAdmin });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [notifyOn, setNotifyOn] = useState(true);

  // Replying state
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; body: string } | null>(null);

  // Mention autocomplete state
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);

  // Emoji picker state
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

  // Highlight message on jump
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const seenRef = useRef<Set<string>>(new Set());
  const atBottomRef = useRef(true);
  const initializedRef = useRef(false);
  const notifyOnRef = useRef(notifyOn);
  const permAskedRef = useRef(false);

  // Current username
  const currentUsername = useMemo(() => {
    return members.find((m) => m.account_id === accountId)?.username;
  }, [members, accountId]);

  // Hydrate notify preference
  useEffect(() => {
    try {
      const v = localStorage.getItem(NOTIFY_KEY);
      if (v !== null) setNotifyOn(v === "1");
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    notifyOnRef.current = notifyOn;
  }, [notifyOn]);

  // Clear unread on visibility change when scrolled down
  useEffect(() => {
    function onVis() {
      if (!document.hidden && atBottomRef.current) setUnread(0);
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Handle incoming messages
  useEffect(() => {
    const list = listRef.current;
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
        notifyDesktop(latest.username, cleanNotificationText(latest.body));
      }
    }

    if (atBottomRef.current || ownLast) {
      list?.scrollTo({ top: list.scrollHeight, behavior: ownLast ? "smooth" : "auto" });
    }
    if (atBottomRef.current && !document.hidden) setUnread(0);
  }, [messages, accountId]);

  function onScroll() {
    const list = listRef.current;
    if (!list) return;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 50;
    atBottomRef.current = atBottom;
    if (atBottom && !document.hidden) setUnread(0);
  }

  function jumpToBottom() {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    atBottomRef.current = true;
    setUnread(0);
  }

  function toggleNotify() {
    const next = !notifyOn;
    setNotifyOn(next);
    try {
      localStorage.setItem(NOTIFY_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (next) void ensureNotifyPermission();
  }

  // Handle jump to quoted message
  function handleJumpToReply(targetId: string) {
    const el = document.getElementById(`chat-msg-${targetId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(targetId);
      setTimeout(() => setHighlightedId(null), 2200);
    }
  }

  // Start replying to message
  function handleReply(message: ChatMessage) {
    setReplyingTo({
      id: message.id,
      username: message.username,
      body: message.body,
    });
    textareaRef.current?.focus();
  }

  // Quick mention user
  function handleMentionUser(name: string) {
    setText((prev) => {
      const trimmed = prev.trimEnd();
      return trimmed ? `${trimmed} @${name} ` : `@${name} `;
    });
    textareaRef.current?.focus();
  }

  // Filtered members for autocomplete
  const filteredMentionMembers = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members.filter((m) => m.username && m.username.toLowerCase().includes(q)).slice(0, 6);
  }, [members, mentionQuery]);

  // Text input change with @mention detection
  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setText(val);

    const cursorPos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, cursorPos);
    const match = textBeforeCursor.match(/@([a-zA-Z0-9_\u00C0-\u1EF9]*)$/);

    if (match) {
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  // Select a mention candidate
  function handleSelectMention(username: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const cursorPos = textarea.selectionStart ?? text.length;
    const textBefore = text.slice(0, cursorPos);
    const textAfter = text.slice(cursorPos);

    const match = textBefore.match(/@([a-zA-Z0-9_\u00C0-\u1EF9]*)$/);
    if (match) {
      const matchStart = textBefore.length - match[0].length;
      const newText = textBefore.slice(0, matchStart) + `@${username} ` + textAfter;
      setText(newText);
      setMentionQuery(null);
      setTimeout(() => {
        const nextPos = matchStart + username.length + 2;
        textarea.focus();
        textarea.setSelectionRange(nextPos, nextPos);
      }, 0);
    }
  }

  // Insert emoji
  function handleSelectEmoji(emoji: string) {
    const textarea = textareaRef.current;
    if (!textarea) {
      setText((prev) => prev + emoji);
      return;
    }
    const start = textarea.selectionStart ?? text.length;
    const end = textarea.selectionEnd ?? text.length;
    const newText = text.slice(0, start) + emoji + text.slice(end);
    setText(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }

  // Submit message
  async function submit() {
    const raw = text.trim();
    if (!raw) return;

    setError(null);
    if (notifyOnRef.current && !permAskedRef.current) {
      permAskedRef.current = true;
      void ensureNotifyPermission();
    }

    const payload = formatChatMessageBody(raw, replyingTo);

    try {
      await send(payload);
      setText("");
      setReplyingTo(null);
      setMentionQuery(null);
      setEmojiPickerOpen(false);
      jumpToBottom();
    } catch (err) {
      const m = (err as { message?: string }).message ?? "Không gửi được";
      setError(
        m.includes("too many messages")
          ? "Bạn nhắn quá nhanh, chờ chút nhé."
          : m.includes("invalid message")
          ? "Tin nhắn không hợp lệ (tối đa 500 ký tự)."
          : m.includes("not a member")
          ? "Bạn cần ở trong phòng để nhắn."
          : m,
      );
    }
  }

  // Keydown handler: enter sends, arrows navigate mention autocomplete
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredMentionMembers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => (i + 1) % filteredMentionMembers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => (i - 1 + filteredMentionMembers.length) % filteredMentionMembers.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = filteredMentionMembers[mentionIndex];
        if (selected?.username) {
          handleSelectMention(selected.username);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full overflow-hidden">
      {/* Header bar */}
      <div className="mb-2 flex shrink-0 items-center justify-between border-b border-gold-200/50 pb-2">
        <div className="flex items-center gap-2">
          <span className="font-playfair text-lg font-bold text-burgundy">
            Trò chuyện
          </span>
          {unread > 0 && (
            <span className="rounded-full bg-burgundy px-2 py-0.5 text-xs font-bold text-cream animate-pulse">
              {unread} mới
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Notification sound toggle */}
          <button
            type="button"
            onClick={toggleNotify}
            title={notifyOn ? "Tắt âm thanh thông báo" : "Bật âm thanh thông báo"}
            className="rounded p-1 text-base leading-none hover:bg-gold-200/30 transition-colors"
          >
            {notifyOn ? "🔔" : "🔕"}
          </button>

          {/* Expand drawer button (if not in drawer) */}
          {!isDrawer && onExpand && (
            <button
              type="button"
              onClick={onExpand}
              title="Phóng to khung chat (Drawer)"
              className="rounded p-1 text-sm text-burgundy hover:bg-gold-200/40 transition-colors"
            >
              ⤢
            </button>
          )}

          {/* Close drawer button (if in drawer) */}
          {isDrawer && onCloseDrawer && (
            <button
              type="button"
              onClick={onCloseDrawer}
              title="Thu nhỏ khung chat"
              className="rounded p-1 text-sm font-bold text-burgundy hover:bg-gold-200/40 transition-colors"
            >
              ⤡
            </button>
          )}
        </div>
      </div>

      {/* Message List */}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="flex-1 min-h-0 flex flex-col gap-1.5 overflow-y-auto rounded-xl border border-gold-200 bg-cream/70 p-2.5 shadow-inner"
      >
        {messages.length === 0 ? (
          <div className="m-auto flex flex-col items-center justify-center text-center py-8">
            <span className="text-3xl mb-2">💬</span>
            <p className="font-playfair text-sm text-burgundy">Chưa có tin nhắn nào</p>
            <p className="text-xs text-ink/50 mt-0.5">Hãy là người đầu tiên mở lời trò chuyện!</p>
          </div>
        ) : (
          messages.map((m: ChatMessage) => (
            <ChatMessageItem
              key={m.id}
              message={m}
              allMessages={messages}
              currentAccountId={accountId}
              currentUsername={currentUsername}
              members={members}
              room={room}
              isHighlighted={highlightedId === m.id}
              canDelete={canDelete(m)}
              onReply={handleReply}
              onDelete={(id) => remove(id).catch(() => {})}
              onJumpToReply={handleJumpToReply}
              onMentionUser={handleMentionUser}
            />
          ))
        )}
      </div>

      {/* Floating Unread Scroll-to-Bottom Banner */}
      {unread > 0 && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="mt-1.5 flex shrink-0 items-center justify-center gap-1.5 w-full rounded-lg bg-burgundy/90 hover:bg-burgundy py-1.5 text-xs font-semibold text-cream shadow-md transition-all active:scale-[0.99]"
        >
          <span>↓</span> {unread} tin nhắn mới
        </button>
      )}

      {error && <p className="mt-1 shrink-0 text-xs text-burgundy-accent px-1">{error}</p>}

      {/* Replying Banner */}
      {replyingTo && (
        <div className="mt-2 flex shrink-0 items-center justify-between rounded-t-lg border-x border-t border-gold-200 bg-gold-200/40 px-3 py-1.5 text-xs text-burgundy animate-in fade-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-bold shrink-0">↩ Trả lời @{replyingTo.username}:</span>
            <span className="truncate text-ink/70">
              {cleanNotificationText(replyingTo.body)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setReplyingTo(null)}
            className="ml-2 shrink-0 rounded p-0.5 text-xs font-bold text-burgundy-accent hover:bg-burgundy/10"
            title="Hủy trả lời"
          >
            ✕
          </button>
        </div>
      )}

      {/* Composer Input Area */}
      <div className={`relative mt-2 flex shrink-0 flex-col ${replyingTo ? "mt-0" : ""}`}>
        {/* Mention Autocomplete Menu */}
        {mentionQuery !== null && (
          <MentionAutocomplete
            query={mentionQuery}
            members={members}
            room={room}
            selectedIndex={mentionIndex}
            onSelect={handleSelectMention}
            onClose={() => setMentionQuery(null)}
          />
        )}

        {/* Emoji Picker Popover */}
        <EmojiPickerPopover
          isOpen={emojiPickerOpen}
          onClose={() => setEmojiPickerOpen(false)}
          onSelectEmoji={handleSelectEmoji}
        />

        {/* Text Input Row */}
        <div className="flex items-end gap-1.5 rounded-xl border border-gold-200 bg-cream p-1.5 shadow-sm focus-within:border-burgundy focus-within:ring-1 focus-within:ring-burgundy/30 transition-all">
          {/* Emoji button */}
          <button
            type="button"
            onClick={() => setEmojiPickerOpen((v) => !v)}
            className={`rounded-lg p-1.5 text-lg leading-none transition-colors ${
              emojiPickerOpen ? "bg-gold-200/60 text-burgundy" : "text-ink/70 hover:bg-gold-200/40"
            }`}
            title="Thư viện Emoji"
          >
            😊
          </button>

          {/* Auto-resizing textarea */}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            maxLength={500}
            rows={2}
            placeholder="Nhắn gì đó… (gõ @ để tag bạn bè)"
            className="flex-1 resize-none bg-transparent py-1 px-1 text-sm text-ink outline-none placeholder:text-ink/40 font-serif leading-relaxed"
          />

          {/* Send Button */}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!text.trim()}
            className="shrink-0 rounded-lg bg-burgundy px-3 py-1.5 text-xs font-semibold text-cream shadow-sm transition-all hover:bg-burgundy-accent disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
          >
            Gửi
          </button>
        </div>

        {/* Bottom helper info */}
        <div className="mt-1 flex shrink-0 items-center justify-between px-1 text-[10px] text-ink/40">
          <span>Enter để gửi, Shift+Enter xuống dòng</span>
          <span>{text.length}/500</span>
        </div>
      </div>
    </div>
  );
}
