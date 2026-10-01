"use client";

import { useEffect, useMemo, useRef } from "react";
import { fightPose3D, fightPoseAt, lerpPose } from "@/lib/game/diorama/character/fight-pose";
import { drawFight3D, fightLook } from "@/lib/game/diorama/character/fight-preview";
import type { PoseId } from "@/lib/game/fight/render/poses";
import type { Look } from "@/lib/game/types";
import { prefersReduced } from "./Arena";

/** RigPreview's 3D view: the chibi easing between the keyframes (~20 fps through the one shared renderer). `step`
 *  eases to that keyframe (the kata advances it per note). */
export default function RigPreview3D({ look, style, rank, poses, w, h, ms, step, dim, label }: {
  look: Look; style: number; rank: number; poses: readonly string[]; w: number; h: number; ms: number;
  step: number | null; dim: boolean; label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const fl = useMemo(() => fightLook(look, style, rank), [look, style, rank]);
  const prev = useRef<{ id: PoseId; at: number } | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || poses.length === 0) return;
    const reduced = prefersReduced();
    if (step !== null) {
      const id = poses[step % poses.length];
      const from = prev.current?.id ?? id, t0 = performance.now();
      prev.current = { id, at: t0 };
      let raf = 0;
      const tick = () => {
        const k = reduced ? 1 : Math.min(1, (performance.now() - t0) / 150);
        drawFight3D(cv, fl, lerpPose(fightPose3D(from), fightPose3D(id), k * k * (3 - 2 * k)));
        if (k < 1) raf = requestAnimationFrame(tick);
      };
      tick();
      return () => cancelAnimationFrame(raf);
    }
    if (reduced) {
      drawFight3D(cv, fl, fightPoseAt(poses, 0, 1, true));
      return;
    }
    const t0 = performance.now();
    const id = window.setInterval(() => drawFight3D(cv, fl, fightPoseAt(poses, (performance.now() - t0) / 1000, ms / 1000)), 50);
    return () => window.clearInterval(id);
  }, [poses, fl, ms, step]);
  return <canvas ref={ref} width={w} height={h} aria-label={label} className={dim ? "opacity-40 grayscale" : ""} style={{ width: w, height: h }} />;
}
