"use client";

import { useEffect, useState } from "react";
import KeyBadge from "./KeyBadge";

export const ZOOM_PRESETS: ReadonlyArray<{ factor: number; label: string }> = [
  { factor: 0.25, label: "0.25x (Cực xa)" },
  { factor: 0.5, label: "0.5x (Rất xa)" },
  { factor: 0.75, label: "0.75x (Xa)" },
  { factor: 1.0, label: "1.0x (Chuẩn)" },
  { factor: 1.25, label: "1.25x (Gần)" },
  { factor: 1.5, label: "1.5x (Rất gần)" },
];

const STORAGE_KEY = "music-together:game-zoom";

function getInitialZoom(): number {
  if (typeof window === "undefined") return 1.0;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const val = parseFloat(saved);
      if (!isNaN(val) && val >= 0.2 && val <= 2.5) return val;
    }
  } catch {
    // ignore
  }
  return 1.0;
}

export interface CameraZoomControlProps {
  mapWidth?: number;
  mapHeight?: number;
  onZoomChange: (z: number) => void;
}

export function getMinZoomForMap(mapW?: number, mapH?: number): number {
  if (!mapW || !mapH) return 0.5;
  // TARGET_W = 300, TARGET_H = 180 world px
  return Math.max(300 / mapW, 180 / mapH);
}

export default function CameraZoomControl({ mapWidth, mapHeight, onZoomChange }: CameraZoomControlProps) {
  const [zoom, setZoom] = useState<number>(getInitialZoom);
  const [open, setOpen] = useState(false);

  const minZoomThreshold = getMinZoomForMap(mapWidth, mapHeight);
  // Filter presets so we don't present options that would show map edges
  const availablePresets = ZOOM_PRESETS.filter((p) => p.factor >= minZoomThreshold - 0.05);
  const effectiveMinZoom = availablePresets[0]?.factor ?? 0.5;

  useEffect(() => {
    if (zoom < effectiveMinZoom) {
      setZoom(effectiveMinZoom);
      onZoomChange(effectiveMinZoom);
      try {
        localStorage.setItem(STORAGE_KEY, String(effectiveMinZoom));
      } catch {
        // ignore
      }
    }
  }, [effectiveMinZoom, zoom, onZoomChange]);

  useEffect(() => {
    onZoomChange(zoom);
  }, [zoom, onZoomChange]);

  const selectZoom = (val: number) => {
    setZoom(val);
    setOpen(false);
    try {
      localStorage.setItem(STORAGE_KEY, String(val));
    } catch {
      // ignore
    }
  };

  return (
    <div className="relative font-vt text-base leading-none">
      <button
        type="button"
        className={`pch-btn relative flex items-center gap-1 px-2 py-1 text-sm shadow-xs ${open ? "pch-btn-primary" : ""}`}
        data-hotkey="zoom"
        onClick={() => setOpen(!open)}
        title="Chỉnh góc nhìn Camera (Zoom) (Z)"
        aria-label="Chỉnh góc nhìn Camera"
      >
        <span>🔍</span>
        <span>{`${zoom}x`}</span>
        <KeyBadge id="zoom" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="pch absolute top-full left-0 mt-1 flex min-w-[130px] flex-col gap-1 p-1 text-sm shadow-lg z-50 whitespace-nowrap"
            role="menu"
          >
            <div className="px-1 py-0.5 text-xs opacity-75 font-bold">Tầm nhìn Camera:</div>
            {availablePresets.map((p) => (
              <button
                key={p.factor}
                type="button"
                className={`pch-btn text-left text-xs ${zoom === p.factor ? "pch-btn-primary" : ""}`}
                onClick={() => selectZoom(p.factor)}
              >
                {p.factor === effectiveMinZoom && p.factor <= 0.5 ? `${p.factor}x (Toàn cảnh)` : p.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
