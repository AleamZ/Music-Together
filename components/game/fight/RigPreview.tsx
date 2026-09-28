"use client";

import { useEffect, useMemo, useRef } from "react";
import { RIG_H, RIG_W, poseData, type PoseId } from "@/lib/game/fight/render/poses";
import { paintFighter } from "@/lib/game/fight/render/rig";
import { paintChibiFighter } from "@/lib/game/fight/render/chibi";
import { readFighterArt } from "@/lib/game/fight/render/fighter-art";
import type { Look } from "@/lib/game/types";
import { prefersReduced } from "./Arena";

/** A fighter on a small canvas cycling through keyframes (a special's preview, the master performing a kata). Reduced
 *  motion shows the middle keyframe still. `step` forces a keyframe (the kata advances it per note). */
export default function RigPreview({ look, style, rank, poses, scale = 2, ms = 180, step = null, dim = false, label }: {
  look: Look;
  style: number;
  rank: number;
  poses: readonly PoseId[];
  scale?: number;
  ms?: number;
  step?: number | null;
  dim?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const key = poses.join(",");
  const list = useMemo(() => (key === "" ? [] : key.split(",")), [key]);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d") ?? null;
    if (!cv || !ctx || list.length === 0) return;
    ctx.imageSmoothingEnabled = false;
    const draw = (i: number) => {
      ctx.clearRect(0, 0, RIG_W, RIG_H);
      const id = list[i % list.length];
      if (readFighterArt() === "chibi") paintChibiFighter(ctx, id, { look, style, rank }, 0, 0, false);
      else paintFighter(ctx, poseData(id, style), { look, style, rank }, 0, 0, false);
    };
    if (step !== null) {
      draw(step);
      return;
    }
    if (prefersReduced()) {
      draw(Math.floor(list.length / 2));
      return;
    }
    let i = 0;
    draw(0);
    const id = window.setInterval(() => draw(++i), ms);
    return () => window.clearInterval(id);
  }, [list, look, style, rank, ms, step]);
  return (
    <canvas
      ref={ref}
      width={RIG_W}
      height={RIG_H}
      aria-label={label}
      className={dim ? "opacity-40 grayscale" : ""}
      style={{ width: RIG_W * scale, height: RIG_H * scale, imageRendering: "pixelated" }}
    />
  );
}
