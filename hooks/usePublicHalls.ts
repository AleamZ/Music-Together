"use client";

import { useEffect, useState } from "react";
import { subscribeActiveRooms, type RoomPresence } from "@/lib/lobby";
import { fetchPublicHalls, type PublicHall } from "@/lib/halls";

export interface HallWithCount extends PublicHall { online: number; }

/** The public halls with their live member counts (lobby presence). */
export function usePublicHalls(): { halls: HallWithCount[]; loading: boolean; error: boolean } {
  const [halls, setHalls] = useState<PublicHall[]>([]);
  const [presence, setPresence] = useState<Map<string, RoomPresence>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => subscribeActiveRooms(setPresence), []);
  useEffect(() => {
    let alive = true;
    fetchPublicHalls()
      .then((h) => { if (alive) { setHalls(h); setLoading(false); } })
      .catch(() => { if (alive) { setError(true); setLoading(false); } });
    return () => { alive = false; };
  }, []);

  return { halls: halls.map((h) => ({ ...h, online: presence.get(h.id)?.count ?? 0 })), loading, error };
}
