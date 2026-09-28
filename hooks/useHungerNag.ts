import { useEffect, useRef } from "react";
import { NAG_EVERY_MS, nagLine, shouldNag } from "@/lib/game/hunger-nag";
import type { VitalsState } from "@/lib/game/vitals-rpc";

/** 0047: while hunger or thirst is at or below NAG_AT and nothing holds the screen (`paused`: a faint, a panel, a
 *  minigame), `say` a nag line at once and then every NAG_EVERY_MS. `say` shows a local bubble over my head only. */
export function useHungerNag(vitals: VitalsState | null, paused: boolean, say: (text: string) => void): void {
  const low = vitals !== null && vitals.faintedUntilMs === null && shouldNag(vitals);
  const active = low && !paused;
  const vitalsRef = useRef(vitals);
  const sayRef = useRef(say);
  const count = useRef(0);
  useEffect(() => { vitalsRef.current = vitals; }, [vitals]);
  useEffect(() => { sayRef.current = say; }, [say]);
  useEffect(() => {
    if (!active) return;
    const nag = () => {
      const v = vitalsRef.current;
      const line = v ? nagLine(v, count.current) : null;
      if (line) {
        count.current++;
        sayRef.current(line);
      }
    };
    nag();
    const id = setInterval(nag, NAG_EVERY_MS);
    return () => clearInterval(id);
  }, [active]);
}
