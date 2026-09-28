import { useEffect, useRef, useState } from "react";
import { battleState } from "@/lib/game/pets/v2";

const POLL_MS = 20000;

/** v21: how many pet/fish battle challenges wait for me (polled every 20 s while in game mode); `onNew` hears a new one
 *  (the challenger's name). Before 0074 (or on an error) it stays 0. */
export function usePetChallenges(token: string | null, roomId: string, onNew?: (from: string) => void): number {
  const [count, setCount] = useState(0);
  const seen = useRef(new Set<number>());
  const cb = useRef(onNew);
  useEffect(() => { cb.current = onNew; }, [onNew]);
  useEffect(() => {
    if (!token) return;
    let stop = false;
    const poll = () => {
      battleState(token, null).then((s) => {
        if (stop) return;
        setCount(s.incoming.length);
        for (const c of s.incoming) {
          if (!seen.current.has(c.id)) { seen.current.add(c.id); cb.current?.(c.from); }
        }
      }, () => { /* before 0074 */ });
    };
    const first = setTimeout(poll, 3000);
    const id = setInterval(poll, POLL_MS);
    return () => { stop = true; clearTimeout(first); clearInterval(id); };
  }, [token, roomId]);
  return count;
}
