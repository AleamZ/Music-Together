"use client";

import { useEffect, useRef, useState } from "react";
import { getCharacterFrames } from "@/lib/game/art/raster";
import { DEFAULT_LOOK } from "@/lib/game/look";
import { getMap, paintMap } from "@/lib/game/maps/registry";
import { drawBoatRider } from "@/lib/game/river/art";
import type { Facing } from "@/lib/game/types";
import { ChestReveal, DetectorHud, ShovelGame } from "./TreasureHunt";
import RowGame from "./RowGame";

const BOATS: ReadonlyArray<{ x: number; y: number; f: Facing; moving: boolean }> = [
  { x: 80, y: 240, f: "right", moving: false }, { x: 250, y: 300, f: "left", moving: true },
  { x: 560, y: 150, f: "up", moving: true }, { x: 860, y: 210, f: "down", moving: false },
];

/** Dev only: the painted river with four boats (bobbing, wakes), and each minigame on a fixed seed. */
export default function RiverArtPreview() {
  const cv = useRef<HTMLCanvasElement | null>(null);
  const [game, setGame] = useState<"none" | "row" | "dig" | "chest" | "detector">("none");
  useEffect(() => {
    const map = getMap("song_cai");
    const art = paintMap(map);
    const c = cv.current?.getContext("2d");
    if (!c) return;
    let raf = requestAnimationFrame(function loop(t: number) {
      c.drawImage(art.background, 0, 0);
      art.drawAnimated(c, t, 0, 0, false);
      for (const p of art.props) c.drawImage(p.canvas, p.x, p.y);
      const frames = getCharacterFrames(DEFAULT_LOOK);
      for (const b of BOATS) drawBoatRider(c, b.x, b.y, b.f, t, b.moving, false, (dy) => c.drawImage(frames[b.f][0], b.x - 12, b.y - 46 + dy));
      raf = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <main className="flex flex-col items-center gap-2 bg-[#2e2c2a] p-3 font-vt text-lg text-parchment">
      <canvas ref={cv} width={960} height={480} className="max-w-full" style={{ imageRendering: "pixelated" }} />
      <div className="flex gap-2">
        {(["row", "dig", "chest", "detector"] as const).map((g) => (
          <button key={g} type="button" className="pch-btn" onClick={() => setGame(g)}>{g}</button>
        ))}
      </div>
      {game === "row" && <RowGame view={{ dir: "out", phase: "playing", seed: 12345, need: 8, result: null }} onEnd={() => setGame("none")} onClose={() => setGame("none")} />}
      {game === "dig" && <ShovelGame view={{ phase: "playing", mapId: "m", seed: 777, need: 3, win: 120, message: "" }} onEnd={() => setGame("none")} onClose={() => setGame("none")} />}
      {game === "chest" && <ChestReveal view={{ loot: 1840, jackpot: false, clean: true }} onClose={() => setGame("none")} />}
      {game === "detector" && <div className="relative h-60 w-full"><DetectorHud view={{ mapId: "m", map: "pond", band: 2, wrongMap: false }} busy={false} onDig={() => {}} onStop={() => setGame("none")} /></div>}
    </main>
  );
}
