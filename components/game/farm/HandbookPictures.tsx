"use client";

import { useEffect, useRef } from "react";
import { drawStepScene, STEP_H, STEP_W } from "@/lib/game/art/handbook-art";
import type { CardSection, StepScene } from "@/lib/game/farm/handbook-pics";

const SCALE = 2;

/** One step's pixel picture, drawn once on mount at 1 px a pixel and scaled up by an integer. */
function StepPicture({ scene }: { scene: StepScene }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current?.getContext("2d");
    if (c) drawStepScene(c, scene);
  }, [scene]);
  return (
    <canvas ref={ref} width={STEP_W} height={STEP_H} aria-hidden="true" className="block border-2 border-[#8b5a33] bg-[#f3e6c4]"
      style={{ width: STEP_W * SCALE, height: STEP_H * SCALE, imageRendering: "pixelated" }} />
  );
}

/** The Sổ tay's picture view: a card per step (picture, big number, short caption, number chips), arrows between the
 *  steps of a numbered section, two cards a row on a phone. Only the open tab is rendered. */
export default function HandbookPictures({ sections }: { sections: readonly CardSection[] }) {
  return (
    <div className="flex flex-col gap-3">
      {sections.map((sec) => (
        <section key={sec.title} className="flex flex-col gap-1">
          <h3 className="text-xl text-burgundy">{sec.title}</h3>
          <ol className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {sec.cards.map((card, i) => (
              <li key={`${i}-${card.caption}`} data-testid="hb-card" className="relative flex flex-col items-center gap-1 rounded border border-[#c8a46a] bg-[#fbf3de] p-1">
                <div className="relative">
                  <StepPicture scene={card.scene} />
                  <span className="absolute left-0 top-0 bg-burgundy px-1 text-2xl leading-none text-[#fbf3de]">{card.n}</span>
                </div>
                <p className="text-center leading-tight">{card.caption}</p>
                {card.chips.length > 0 && (
                  <div className="flex flex-wrap justify-center gap-1">
                    {card.chips.map((ch) => (
                      <span key={ch} className={`rounded px-1 text-base leading-tight ${ch.startsWith("−") ? "bg-[#f2c4b8] text-[#8e2a1f]" : "bg-[#dfe9c4] text-[#3f5f1e]"}`}>{ch}</span>
                    ))}
                  </div>
                )}
                {sec.flow && i < sec.cards.length - 1 && (
                  <span aria-hidden="true" className="absolute -right-4 top-1/3 z-10 text-xl text-burgundy">➜</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
