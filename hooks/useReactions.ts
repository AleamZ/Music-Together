"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { loadSession } from "@/lib/session";
import {
  joinReactions,
  throttled,
  type ReactionEmoji,
  type ReactionData,
  type ReactionsHandle,
} from "@/lib/reactions";

export interface FloatingEmote {
  id: string;
  emoji: ReactionEmoji;
  username?: string;
  x: number;
}

export interface UseReactionsOptions {
  /** Called for every reaction, mine (optimistic) and others' — game mode floats them over characters. */
  onEvent?: (data: ReactionData) => void;
}

export function useReactions(roomId: string, currentUsername?: string, options: UseReactionsOptions = {}) {
  const { account } = useAuth();
  const onEventRef = useRef(options.onEvent);
  useEffect(() => {
    onEventRef.current = options.onEvent;
  });
  const sessionUsername = typeof window !== "undefined" ? loadSession()?.username : undefined;
  const effectiveUsername = (currentUsername || account?.username || sessionUsername || "").trim();

  const usernameRef = useRef(effectiveUsername);
  useEffect(() => {
    usernameRef.current = effectiveUsername;
  }, [effectiveUsername]);

  const [emotes, setEmotes] = useState<FloatingEmote[]>([]);
  const handleRef = useRef<ReactionsHandle | null>(null);
  const lastSentRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const spawn = useCallback((data: ReactionData) => {
    onEventRef.current?.(data);
    const id = `${Date.now()}_${seqRef.current++}`;
    const x = Math.round(Math.random() * 90) - 45; // -45..45 px horizontal jitter
    setEmotes((prev) =>
      [...prev, { id, emoji: data.emoji, username: data.username, x }].slice(-30),
    );
    setTimeout(() => setEmotes((prev) => prev.filter((e) => e.id !== id)), 2000);
  }, []);

  useEffect(() => {
    const handle = joinReactions(roomId, (data) => spawn(data));
    handleRef.current = handle;
    return () => {
      handle.unsubscribe();
      handleRef.current = null;
    };
  }, [roomId, spawn]);

  const react = useCallback(
    (emoji: ReactionEmoji) => {
      const now = Date.now();
      if (throttled(lastSentRef.current, now)) return;
      lastSentRef.current = now;
      const uname =
        usernameRef.current ||
        effectiveUsername ||
        account?.username ||
        (typeof window !== "undefined" ? loadSession()?.username : undefined);
      const data: ReactionData = { emoji, username: uname?.trim() || undefined, accountId: account?.accountId || undefined };
      spawn(data); // optimistic local render (self:false → no echo)
      handleRef.current?.send(data); // broadcast to others
    },
    [spawn, effectiveUsername, account?.username, account?.accountId],
  );

  return { emotes, react };
}
