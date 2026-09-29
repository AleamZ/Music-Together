"use client";

// The 3D world's camera buttons (lib/game/diorama/world/game-camera.ts): the preset (Z cycles near → mid → far; the
// wheel or a pinch zooms between them) and first / third person (8). The choice is kept in this browser.
import { useSyncExternalStore } from "react";
import {
  CAM_PRESET_LABEL, cyclePreset, DEFAULT_CAM, getCam, setCam, subscribeCam, toggleView, type GameCam,
} from "@/lib/game/diorama/world/game-camera";
import KeyBadge from "./KeyBadge";

const serverCam = (): GameCam => DEFAULT_CAM;

export default function Camera3dControl() {
  const cam = useSyncExternalStore(subscribeCam, getCam, serverCam);
  const first = cam.view === "first";
  return (
    <div className="flex gap-1 font-vt text-base leading-none" role="group" aria-label="Góc camera" data-testid="cam3d">
      <button
        type="button"
        className={`pch-btn relative flex min-h-9 items-center gap-1 px-2 py-1 text-sm shadow-xs ${first ? "" : "pch-btn-primary"}`}
        data-hotkey="zoom"
        aria-pressed={!first}
        onClick={() => setCam(first ? toggleView(getCam()) : cyclePreset(getCam()))}
        title="Góc 3 (cố định): Gần / Vừa / Xa (Z) — lăn chuột hoặc chụm hai ngón để zoom"
        aria-label={`Góc thứ ba, tầm ${CAM_PRESET_LABEL[cam.preset]}`}
      >
        <span aria-hidden>👁</span>
        <span>Góc 3 · {CAM_PRESET_LABEL[cam.preset]}</span>
        <KeyBadge id="zoom" />
      </button>
      <button
        type="button"
        className={`pch-btn relative flex min-h-9 items-center gap-1 px-2 py-1 text-sm shadow-xs ${first ? "pch-btn-primary" : ""}`}
        data-hotkey="camView"
        aria-pressed={first}
        onClick={() => setCam(toggleView(getCam()))}
        title={first ? "Về góc thứ ba (8)" : "Góc thứ nhất — kéo chuột để nhìn quanh (8)"}
        aria-label="Góc nhìn thứ nhất"
      >
        <span aria-hidden>🎥</span>
        <span>Góc 1</span>
        <KeyBadge id="camView" />
      </button>
    </div>
  );
}
