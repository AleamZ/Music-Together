"use client";

import { useState, useRef, useCallback } from "react";
import type { Card } from "@/lib/game/cards/deck";
import { caoHandName } from "@/lib/game/cards/messages";
import PlayingCard from "./PlayingCard";

type DragPoint = { x: number; y: number };

export default function CaoSqueezeView({
  cards,
}: {
  cards: readonly Card[];
}) {
  const [step, setStep] = useState<"squeeze" | "revealed">("squeeze");
  const [flippedIdx] = useState<number>(0);

  // Manual step count for "Nặn bài" button clicks (0 -> 1 -> 2 -> 3)
  const [btnClicks, setBtnClicks] = useState<number>(0);

  // Card offsets:
  // Card 1 (top, flipped): drag1
  // Card 2 (middle): drag2
  // Card 3 (bottom): fixed at (0, 0)
  const [drag1, setDrag1] = useState<DragPoint>({ x: 0, y: 0 });
  const [drag2, setDrag2] = useState<DragPoint>({ x: 0, y: 0 });

  const activeDrag = useRef<"card1" | "card2" | null>(null);
  const dragStart = useRef<DragPoint>({ x: 0, y: 0 });
  const initialOffset = useRef<DragPoint>({ x: 0, y: 0 });

  // Button "Nặn bài" handler (supports 3-click test requirement: 1: peek card 2, 2: peek card 3, 3: reveal result)
  const stepTurn = () => {
    const nextClicks = btnClicks + 1;
    setBtnClicks(nextClicks);

    if (nextClicks === 1) {
      // Step 1: partially drag card 1 away to reveal card 2
      setDrag1({ x: 45, y: 12 });
      setDrag2({ x: 0, y: 0 });
    } else if (nextClicks === 2) {
      // Step 2: drag card 1 further and drag card 2 away to reveal card 3
      setDrag1({ x: 85, y: 22 });
      setDrag2({ x: 45, y: 12 });
    } else if (nextClicks >= 3) {
      // Step 3: reveal all cards and display result
      setDrag1({ x: 120, y: 30 });
      setDrag2({ x: 60, y: 15 });
      setStep("revealed");
    }
  };

  const revealAll = () => {
    setBtnClicks(3);
    setStep("revealed");
  };

  const resetSqueeze = () => {
    setDrag1({ x: 0, y: 0 });
    setDrag2({ x: 0, y: 0 });
    setBtnClicks(0);
    setStep("squeeze");
  };

  // Pointer drag handling
  const onPointerDown = (cardTarget: "card1" | "card2", e: React.PointerEvent) => {
    activeDrag.current = cardTarget;
    dragStart.current = { x: e.clientX, y: e.clientY };
    initialOffset.current = cardTarget === "card1" ? { ...drag1 } : { ...drag2 };
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!activeDrag.current) return;

    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    if (activeDrag.current === "card1") {
      const newX1 = initialOffset.current.x + dx;
      const newY1 = initialOffset.current.y + dy;
      setDrag1({ x: newX1, y: newY1 });

      // When card 1 is dragged far enough (> 50px), card 2 naturally follows to reveal card 3
      const dist1 = Math.hypot(newX1, newY1);
      if (dist1 > 50) {
        const factor = (dist1 - 50) / dist1;
        setDrag2({
          x: newX1 * factor * 0.55,
          y: newY1 * factor * 0.55,
        });
      }

      // If dragged very far (> 140px), auto-complete squeeze
      if (dist1 > 140) {
        setBtnClicks(3);
      }
    } else if (activeDrag.current === "card2") {
      const newX2 = initialOffset.current.x + dx;
      const newY2 = initialOffset.current.y + dy;
      setDrag2({ x: newX2, y: newY2 });

      // Also push card 1 if card 2 moves past it
      if (Math.hypot(newX2, newY2) > Math.hypot(drag1.x, drag1.y)) {
        setDrag1({ x: newX2 + 30, y: newY2 + 10 });
      }
    }
  }, [drag1.x, drag1.y]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    activeDrag.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    const dist1 = Math.hypot(drag1.x, drag1.y);
    const dist2 = Math.hypot(drag2.x, drag2.y);

    if (dist1 > 120 || (dist1 > 60 && dist2 > 40)) {
      setBtnClicks(3);
    }
  }, [drag1, drag2]);

  if (cards.length < 3) return null;

  const actualFlippedIdx = flippedIdx !== null ? flippedIdx : 0;
  const remainingIndices = [0, 1, 2].filter((i) => i !== actualFlippedIdx);
  const card1 = cards[actualFlippedIdx];
  const card2 = cards[remainingIndices[0]];
  const card3 = cards[remainingIndices[1]];

  const dist1 = Math.hypot(drag1.x, drag1.y);
  const dist2 = Math.hypot(drag2.x, drag2.y);
  const card2Revealed = dist1 > 25 || btnClicks >= 2;
  const card3Revealed = dist2 > 25 || (dist1 > 75 && dist2 > 15) || btnClicks >= 3;

  return (
    <div className="flex flex-col items-center gap-2.5 rounded-lg border-2 border-gold-200 bg-[#16432b]/90 p-3 sm:p-4 font-vt text-cream shadow-2xl select-none max-w-full">
      {/* Title & Controls Header */}
      <div className="flex w-full items-center justify-between border-b border-cream/20 pb-1.5">
        <span className="text-lg sm:text-xl font-bold tracking-wide text-gold-200">
          {step === "squeeze" && "🤏 3 lá đè lên nhau — Kéo để nặn bài"}
          {step === "revealed" && "🎉 Kết quả bài của bạn"}
        </span>
        <div className="flex items-center gap-2">
          {step === "squeeze" && (
            <button
              type="button"
              className="pch-btn text-xs text-ink"
              onClick={stepTurn}
            >
              Nặn bài
            </button>
          )}
          {step === "squeeze" && (
            <button
              type="button"
              className="pch-btn text-xs text-ink"
              onClick={revealAll}
            >
              Lật hết
            </button>
          )}
          {step === "revealed" && (
            <button
              type="button"
              className="pch-btn text-xs text-ink"
              onClick={resetSqueeze}
            >
              Nặn lại
            </button>
          )}
        </div>
      </div>

      {/* Step 2: 3 cards stacked directly on top of each other */}
      {step === "squeeze" && (
        <div
          className="flex flex-col items-center gap-2.5 py-1 w-full"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* Dynamic Instructions */}
          <div className="text-xs sm:text-sm font-bold text-center">
            {!card2Revealed && (
              <span className="text-gold-200 animate-pulse">
                👉 Kéo lá trên cùng từ từ lệch sang một bên để nặn lá thứ 2...
              </span>
            )}
            {card2Revealed && !card3Revealed && (
              <span className="text-amber-300">
                ✨ Đã thấy lá thứ 2! Tiếp tục kéo thêm để nặn lá thứ 3...
              </span>
            )}
            {card2Revealed && card3Revealed && (
              <span className="text-green-300 font-bold">
                🎉 Đã nặn xong cả 3 lá!
              </span>
            )}
          </div>

          {/* Squeeze Table Deck Area: 3 cards stacked */}
          <div className="relative flex h-36 w-60 items-center justify-center sm:h-48 sm:w-72 overflow-visible my-2">
            {/* Card 3: Bottom card (fixed at center, revealed as Card 2 slides off) */}
            <div
              className="absolute z-10 transition-transform duration-75 shadow-lg"
              style={{
                transform: "translate(0px, 0px)",
              }}
            >
              <div className="rounded-sm shadow-md ring-1 ring-black/40">
                <PlayingCard card={card3} faceDown={false} size="large" />
              </div>
              <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[11px] opacity-70 text-cream whitespace-nowrap">
                Lá 3 (Đáy)
              </span>
            </div>

            {/* Card 2: Middle card (stacked directly on Card 3, draggable or drags with Card 1) */}
            <div
              className="absolute z-20 cursor-grab touch-none active:cursor-grabbing transition-transform duration-75 shadow-xl"
              style={{
                transform: `translate(${drag2.x}px, ${drag2.y}px) rotate(${drag2.x * 0.03}deg)`,
              }}
              onPointerDown={(e) => onPointerDown("card2", e)}
            >
              <div className="rounded-sm shadow-lg ring-1 ring-gold-400/40">
                <PlayingCard card={card2} faceDown={false} size="large" />
              </div>
              <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[11px] opacity-70 text-cream whitespace-nowrap">
                Lá 2 (Giữa)
              </span>
            </div>

            {/* Card 1: Top card (flipped first, stacked on top, dragged to reveal Card 2 & 3) */}
            <div
              className="absolute z-30 cursor-grab touch-none active:cursor-grabbing transition-transform duration-75 shadow-2xl"
              style={{
                transform: `translate(${drag1.x}px, ${drag1.y}px) rotate(${drag1.x * 0.05}deg)`,
              }}
              onPointerDown={(e) => onPointerDown("card1", e)}
            >
              <div className="rounded-sm ring-2 ring-gold-300 shadow-2xl">
                <PlayingCard card={card1} faceDown={false} size="large" />
              </div>
              <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-[11px] font-bold text-gold-200 whitespace-nowrap">
                Lá 1 (Kéo lá này)
              </span>
            </div>
          </div>

          {/* Partial Score Preview if both cards are revealed during squeeze */}
          {card2Revealed && card3Revealed && (
            <div className="flex items-center gap-2 mt-2 animate-in fade-in">
              <span className="text-xl font-bold text-gold-200">
                {caoHandName(cards)}
              </span>
              <button
                type="button"
                className="pch-btn pch-btn-primary text-xs text-ink"
                onClick={revealAll}
              >
                Xem toàn bộ
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 3: Fully revealed cards in a row with total score */}
      {step === "revealed" && (
        <div className="flex flex-col items-center gap-3 py-2 animate-in fade-in duration-200">
          <div className="flex items-center gap-2 sm:gap-3">
            {cards.map((c, i) => (
              <div key={i} className="animate-in zoom-in-95 duration-200 shadow-xl">
                <PlayingCard card={c} faceDown={false} size="large" />
              </div>
            ))}
          </div>
          <div className="rounded-md border-2 border-gold-300 bg-gold-500/20 px-5 py-1 text-2xl font-bold text-gold-200 shadow-lg tracking-wider">
            {caoHandName(cards)}
          </div>
        </div>
      )}
    </div>
  );
}

