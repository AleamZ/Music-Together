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
    <div className="flex gap-1 font-vt text-base leading-none">
      <button
        type="button"
        className="pch-btn relative flex items-center gap-1 px-2 py-1 text-sm shadow-xs"
        data-hotkey="zoom"
        onClick={() => setCam(cyclePreset(getCam()))}
        title="Tầm camera: Gần / Vừa / Xa (Z) — lăn chuột hoặc chụm hai ngón để zoom"
        aria-label="Đổi tầm camera"
      >
        <span>🎥</span>
        <span>{first ? "Mắt" : CAM_PRESET_LABEL[cam.preset]}</span>
        <KeyBadge id="zoom" />
      </button>
      <button
        type="button"
        className={`pch-btn relative flex items-center gap-1 px-2 py-1 text-sm shadow-xs ${first ? "pch-btn-primary" : ""}`}
        data-hotkey="camView"
        aria-pressed={first}
        onClick={() => setCam(toggleView(getCam()))}
        title={first ? "Về góc nhìn thứ ba (8)" : "Góc nhìn thứ nhất (8)"}
        aria-label="Đổi góc nhìn thứ nhất / thứ ba"
      >
        <span>{first ? "👁️" : "🧍"}</span>
        <KeyBadge id="camView" />
      </button>
    </div>
  );
}
