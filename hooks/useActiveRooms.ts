"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeActiveRooms, fetchRoomCards, type RoomPresence, type RoomCard } from "@/lib/lobby";

export interface ActiveRoom extends RoomCard { online: number; usernames: string[]; }

export function useActiveRooms(): { rooms: ActiveRoom[]; loading: boolean } {
  const [presence, setPresence] = useState<Map<string, RoomPresence>>(new Map());
  const [cards, setCards] = useState<Map<string, RoomCard>>(new Map());
  const [loading, setLoading] = useState(true);
  const lastKeyRef = useRef("");

  useEffect(() => subscribeActiveRooms((rooms) => { setPresence(rooms); setLoading(false); }), []);

  useEffect(() => {
    const ids = [...presence.keys()].sort();
    const key = ids.join(",");
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    let active = true;
    (async () => { const next = await fetchRoomCards(ids); if (active) setCards(next); })();
    return () => { active = false; };
  }, [presence]);

  const rooms: ActiveRoom[] = [];
  for (const [roomId, p] of presence) {
    const card = cards.get(roomId);
    if (!card) continue;
    rooms.push({ ...card, online: p.count, usernames: p.usernames });
  }
  rooms.sort((a, b) => b.online - a.online || a.name.localeCompare(b.name));
  return { rooms, loading };
}
