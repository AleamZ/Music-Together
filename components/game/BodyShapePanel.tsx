"use client";

import { useEffect, useRef, useState } from "react";
import {
  BEARDS, BEARD_FOR, BEARD_LABELS, BODY_LABELS, defaultBody, EYE_COLORS, EYE_COLOR_HEX, EYE_COLOR_LABELS, GENDER_ONLY,
  normalizeBody, randomBody, slidersFor, type BodyShape, type BodySlider,
} from "@/lib/game/body";
import type { Gender, Look } from "@/lib/game/types";

type Preview = { setLook: (look: Look) => void; dispose: () => void };

/** The wardrobe's "Dáng người" tab: a slider per body proportion, the eye colour, and a rotatable live 3D chibi. */
export default function BodyShapePanel({ look, onChange }: { look: Look; onChange: (body: BodyShape) => void }) {
  const gender: Gender = look.gender === "nu" ? "nu" : "nam";
  const body = normalizeBody(look.body, gender);
  const own = GENDER_ONLY[gender];
  const shown = slidersFor(gender);
  const shared = shown.filter((k) => !own.includes(k));
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewRef = useRef<Preview | null>(null);
  const lookRef = useRef(look);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    lookRef.current = look;
    previewRef.current?.setLook(look);
  }, [look]);

  useEffect(() => {
    let disposed = false;
    // Loaded on demand so the 3D code (three.js) stays out of the editor's first paint.
    import("@/lib/game/diorama/character/preview")
      .then(({ mountChibiPreview }) => {
        if (disposed || !canvasRef.current) return;
        try {
          previewRef.current = mountChibiPreview(canvasRef.current, lookRef.current);
        } catch {
          setFailed(true);
        }
      })
      .catch(() => { if (!disposed) setFailed(true); });
    return () => {
      disposed = true;
      previewRef.current?.dispose();
      previewRef.current = null;
    };
  }, []);

  const setSlider = (k: BodySlider, v: number) => onChange({ ...body, [k]: v });
  const sliderRow = (k: BodySlider) => {
    const [title, lo, hi] = BODY_LABELS[k];
    return (
      <label key={k} className="block">
        <span className="leading-none">{title}</span>
        <div className="mt-1 flex items-center gap-2 text-base">
          <span className="w-12 shrink-0 text-right opacity-80">{lo}</span>
          <input
            type="range" min={-1} max={1} step={0.05} value={body[k]}
            onChange={(e) => setSlider(k, Number(e.target.value))}
            className="min-w-0 flex-1 accent-burgundy"
            aria-valuetext={`${title}: ${body[k]}`}
          />
          <span className="w-12 shrink-0 opacity-80">{hi}</span>
        </div>
      </label>
    );
  };

  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="flex shrink-0 flex-col items-center gap-1 self-center sm:self-start">
        <div className="rounded-sm border-2 border-gold-200 bg-parchment p-1">
          {failed
            ? <p className="flex h-60 w-48 items-center justify-center text-center text-base opacity-80">Không hiển thị được hình 3D trên máy này.</p>
            : <canvas ref={canvasRef} width={192} height={240} className="block h-60 w-48 cursor-grab touch-none" aria-label="Xem trước nhân vật 3D" />}
        </div>
        {!failed && <p className="text-base leading-tight opacity-80">Kéo để xoay</p>}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {shared.map(sliderRow)}
        <p className="mt-1 border-t border-gold-200 pt-1 text-base leading-none opacity-80">{gender === "nam" ? "Riêng nam" : "Riêng nữ"}</p>
        {own.map(sliderRow)}
        {gender === BEARD_FOR && (
          <div>
            <p className="leading-none">Râu: <span className="opacity-80">{BEARD_LABELS[body.beard]}</span></p>
            <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Râu">
              {BEARDS.map((bd) => (
                <button
                  key={bd}
                  type="button"
                  aria-pressed={body.beard === bd}
                  onClick={() => onChange({ ...body, beard: bd })}
                  className={`rounded-sm border-2 bg-cream px-2 py-1 text-base leading-none ${body.beard === bd ? "border-burgundy ring-2 ring-gold" : "border-gold-200"}`}
                >
                  {BEARD_LABELS[bd]}
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          <p className="leading-none">Màu mắt: <span className="opacity-80">{EYE_COLOR_LABELS[body.eyeColor]}</span></p>
          <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Màu mắt">
            {EYE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={body.eyeColor === c}
                title={EYE_COLOR_LABELS[c]}
                onClick={() => onChange({ ...body, eyeColor: c })}
                className={`h-9 w-9 rounded-sm border-2 ${body.eyeColor === c ? "border-burgundy ring-2 ring-gold" : "border-gold-200"}`}
                style={{ background: `linear-gradient(${EYE_COLOR_HEX[c][0]}, ${EYE_COLOR_HEX[c][1]})` }}
              >
                <span className="sr-only">{EYE_COLOR_LABELS[c]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="pch-btn text-sm" onClick={() => onChange(randomBody(Math.random, gender))}>🎲 Ngẫu nhiên</button>
          <button type="button" className="pch-btn text-sm" onClick={() => onChange(defaultBody(gender))}>↺ Mặc định</button>
        </div>
      </div>
    </div>
  );
}
