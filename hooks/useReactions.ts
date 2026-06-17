"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { joinReactions, throttled, type ReactionEmoji, type ReactionsHandle } from "@/lib/reactions";

export interface FloatingEmote { id: string; emoji: ReactionEmoji; x: number; }

export function useReactions(roomId: string) {
  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const handleRef = useRef<ReactionsHandle | null>(null);
  const lastSentRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const spawn = useCallback((emoji: ReactionEmoji) => {
    const id = `${Date.now()}_${seqRef.current++}`;
    const x = Math.round(Math.random() * 80) - 40; // -40..40 px horizontal jitter
    setEmotes((prev) => [...prev, { id, emoji, x }].slice(-30));
    setTimeout(() => setEmotes((prev) => prev.filter((e) => e.id !== id)), 2000);
  }, []);

  useEffect(() => {
    const handle = joinReactions(roomId, (emoji) => spawn(emoji));
    handleRef.current = handle;
    return () => { handle.unsubscribe(); handleRef.current = null; };
  }, [roomId, spawn]);

  const react = useCallback((emoji: ReactionEmoji) => {
    const now = Date.now();
    if (throttled(lastSentRef.current, now)) return;
    lastSentRef.current = now;
    spawn(emoji);                    // optimistic local render (self:false → no echo)
    handleRef.current?.send(emoji);  // broadcast to others
  }, [spawn]);

  return { emotes, react };
}
