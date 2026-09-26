"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isMissingRpc } from "@/lib/game/cards/messages";
import { fetchCardLobby } from "@/lib/game/cards/rpc";
import type { CardLobby } from "@/lib/game/cards/state";

/** The hall's table labels are fetched this often while I am on the hall (spec R27). */
export const LOBBY_POLL_MS = 20_000;

export interface CardLobbyData {
  lobby: CardLobby | null;
  /** Migration 0017 is not run. */
  notOpen: boolean;
  reload: () => Promise<void>;
}

/** card_lobby every 20 s while `active` (on the hall): every table's stake, phase and seats. No realtime. */
export function useCardLobby(roomId: string, token: string, active: boolean, onLobby?: (l: CardLobby) => void): CardLobbyData {
  const [lobby, setLobby] = useState<CardLobby | null>(null);
  const [notOpen, setNotOpen] = useState(false);
  const live = useRef({ roomId, token, onLobby });
  useEffect(() => {
    live.current = { roomId, token, onLobby };
  });
  const seq = useRef(0);
  const applied = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    // the room and the session the call is made for: an answer for ones I have left is dropped (a room change
    // remounts the page today; this keeps an in-place switch safe)
    const { roomId: room, token: tok } = live.current;
    const still = () => live.current.roomId === room && live.current.token === tok;
    try {
      const l = await fetchCardLobby(room, tok);
      if (n < applied.current || !still()) return;
      applied.current = n;
      setLobby(l);
      setNotOpen(false);
      live.current.onLobby?.(l);
    } catch (err) {
      if (still() && isMissingRpc(err)) setNotOpen(true);
    }
  }, []);
  useEffect(() => {
    if (!active) return;
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), LOBBY_POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [active, roomId, reload]);
  return { lobby, notOpen, reload };
}
