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

  // Fetch card details whenever the SET of active room ids changes. We track the
  // latest-requested key in a ref and apply a fetch result only if it is still
  // current — instead of cancelling via effect cleanup. (The old cleanup-cancel
  // cancelled the in-flight fetch when presence re-fired with the SAME id-set,
  // while the key-guard skipped starting a new one → setCards never ran → 0 rooms.)
  useEffect(() => {
    const ids = [...presence.keys()].sort();
    const key = ids.join(",");
    if (key === lastKeyRef.current) return; // same id-set: existing fetch/cards stand
    lastKeyRef.current = key;
    // fetchRoomCards([]) resolves to an empty map (no query); applying in .then
    // keeps setState async (no synchronous setState-in-effect).
    fetchRoomCards(ids).then((next) => {
      if (lastKeyRef.current === key) setCards(next); // only apply if still the latest set
    });
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
