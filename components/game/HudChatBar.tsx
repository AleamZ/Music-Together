"use client";

import { useState, type FormEvent } from "react";
import { REACTION_EMOJIS, type ReactionEmoji } from "@/lib/reactions";

/** Bottom bar: quick chat (hidden under 640 px — use 💬), reactions, chat drawer, members, back to classic. */
export default function HudChatBar({ onSend, onReact, onOpenChat, onOpenMembers, onlineCount, onExitGame }: {
  onSend: (text: string) => Promise<void>;
  onReact: (emoji: ReactionEmoji) => void;
  onOpenChat: () => void;
  onOpenMembers: () => void;
  onlineCount: number;
  onExitGame: () => void;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend(body);
      setText("");
    } catch {
      setError("Không gửi được — thử lại nhé.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="pointer-events-auto flex flex-col items-center gap-1 font-vt text-lg">
      {picker && (
        <div className="pch flex gap-1 p-1" role="group" aria-label="Thả cảm xúc">
          {REACTION_EMOJIS.map((emoji) => (
            <button key={emoji} type="button" className="pch-btn text-2xl" onClick={() => onReact(emoji)} title={`Thả ${emoji}`}>
              {emoji}
            </button>
          ))}
        </div>
      )}
      {error && <p className="pch px-2 py-0.5 text-base text-burgundy-accent" role="alert">{error}</p>}
      <div className="pch flex w-[min(40rem,calc(100vw-1rem))] items-center gap-1.5 p-1.5">
        <form onSubmit={(e) => void submit(e)} className="hidden min-w-0 flex-1 gap-1.5 sm:flex">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="Nhắn gì đó… (Enter để gửi)"
            className="min-w-0 flex-1 rounded-sm border-2 border-gold-200 bg-parchment px-2 py-1 text-lg leading-none outline-none focus:border-burgundy"
            aria-label="Tin nhắn"
          />
          <button type="submit" className="pch-btn" disabled={sending || !text.trim()}>Gửi</button>
        </form>
        <div className="ml-auto flex shrink-0 gap-1.5 sm:ml-0">
          <button type="button" className="pch-btn" aria-pressed={picker} onClick={() => setPicker((p) => !p)} aria-label="Thả cảm xúc">😊</button>
          <button type="button" className="pch-btn" onClick={onOpenChat} aria-label="Mở phòng chat">💬</button>
          <button type="button" className="pch-btn" onClick={onOpenMembers} aria-label="Thành viên">👥 {onlineCount}</button>
          <button type="button" className="pch-btn" onClick={onExitGame} title="Quay về giao diện cũ">🖥️ <span className="hidden sm:inline">Giao diện cũ</span></button>
        </div>
      </div>
    </div>
  );
}
