"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { drawGroundbaitSpot } from "@/lib/game/art/groundbait";
import { spotLabel, tintOf, type GroundbaitSpotView } from "@/lib/game/fishing/groundbait-spots";
import { getMap, paintMap } from "@/lib/game/maps/registry";
import GroundbaitHud from "./GroundbaitHud";

// Dev only (app/dev/groundbait): Ao làng painted with three ổ thính on it, as the engine draws them in 2D (the patch, the
// bubbles, the label over each), the minimap's dots, and the HUD's line for the one I stand in. No network.

const S = 2;

export default function GroundbaitPreview() {
  const ref = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const [spots] = useState<GroundbaitSpotView[]>(() => {
    const now = Date.now();
    return [
      { id: 1, item: "gb_cam", name: "Thính cám gạo", map: "pond", x: 300, y: 204, stacks: 2, untilMs: now + 432_000, by: "Lan", mine: false },
      { id: 2, item: "gb_tom", name: "Thính tôm khô", map: "pond", x: 236, y: 140, stacks: 1, untilMs: now + 185_000, by: null, mine: true },
      { id: 3, item: "gb_tanh", name: "Thính tanh", map: "pond", x: 396, y: 132, stacks: 3, untilMs: now + 1_140_000, by: "Tuấn", mine: false },
    ];
  });
  const fake = useMemo(() => ({ setGroundbait: () => {}, groundbaitHere: () => spots[0] }), [spots]);
  useEffect(() => {
    const map = getMap("pond");
    const bg = paintMap(map).background;
    let raf = 0;
    const draw = (t: number) => {
      const c = ref.current?.getContext("2d"), m = mini.current?.getContext("2d");
      if (c) {
        c.imageSmoothingEnabled = false;
        c.setTransform(S, 0, 0, S, 0, 0);
        c.drawImage(bg, 0, 0);
        for (const g of spots) drawGroundbaitSpot(c, g.x, g.y, tintOf(g.item), g.stacks, t, false);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.font = `${4 * S * 2}px monospace`;
        c.textAlign = "center";
        c.textBaseline = "middle";
        const now = Date.now();
        for (const g of spots) {
          const text = spotLabel(g, now), x = g.x * S, y = (g.y - 46) * S;
          const w = Math.round(c.measureText(text).width + 6 * S), h = Math.round(9.6 * S);
          c.fillStyle = "rgba(24, 58, 72, 0.86)";
          c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
          c.fillStyle = tintOf(g.item);
          c.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), 2 * S, h);
          c.fillStyle = "#fbf3dc";
          c.fillText(text, x, y + S * 0.6);
        }
      }
      if (m) {
        m.drawImage(bg, 0, 0, 192, 120);
        for (const g of spots) {
          m.fillStyle = tintOf(g.item);
          m.strokeStyle = "#1f4e5f";
          m.lineWidth = 1.5;
          m.beginPath();
          m.arc(g.x * 0.3, g.y * 0.3, 3, 0, Math.PI * 2);
          m.fill();
          m.stroke();
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [spots]);
  return (
    <main className="relative min-h-screen bg-[#1d2b22] p-2" data-testid="groundbait-preview">
      <div className="relative inline-block">
        <canvas ref={ref} width={640 * S} height={400 * S} style={{ width: 640 * S, height: 400 * S, imageRendering: "pixelated" }} />
        <GroundbaitHud spots={spots} canvas={() => fake} />
        <canvas ref={mini} width={192} height={120} className="absolute bottom-2 right-2 rounded-sm border-2 border-ink" />
      </div>
    </main>
  );
}
