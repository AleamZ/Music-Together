// The game's 3D camera (pure; no Three): a third-person follow at one of three presets (near / mid / far), zoomed with
// the wheel or a pinch between limits, or a first-person view (the 8 key; my own head and hat are hidden). No free
// camera in the game — only the /dev pages build a WorldView with `allowFree`. The choice is kept per browser
// (localStorage, every access guarded: a private window or blocked storage just starts at the default).

export type CamView = "third" | "first";
export type CamPreset = "near" | "mid" | "far";

export interface GameCam {
  view: CamView;
  /** The last preset picked (the wheel moves the distance off it; the button cycles from it). */
  preset: CamPreset;
  /** Third-person distance from the look point (world units). */
  distance: number;
}

export const CAM_PRESETS: Readonly<Record<CamPreset, number>> = { near: 16, mid: 30, far: 54 };
export const CAM_PRESET_ORDER: readonly CamPreset[] = ["near", "mid", "far"];
export const CAM_PRESET_LABEL: Readonly<Record<CamPreset, string>> = { near: "Gần", mid: "Vừa", far: "Xa" };
/** The zoom limits (units): never inside the head, never so far the world thins out. */
export const CAM_ZOOM = { min: 10, max: 70 } as const;
export const DEFAULT_CAM: GameCam = { view: "third", preset: "mid", distance: CAM_PRESETS.mid };
export const CAM_STORAGE_KEY = "music-together:cam3d";

const clampDist = (d: number): number => Math.min(CAM_ZOOM.max, Math.max(CAM_ZOOM.min, d));

/** Next preset (near → mid → far → near), snapping the distance to it. */
export function cyclePreset(c: GameCam): GameCam {
  const i = CAM_PRESET_ORDER.indexOf(c.preset);
  const preset = CAM_PRESET_ORDER[(i + 1) % CAM_PRESET_ORDER.length];
  return { ...c, view: "third", preset, distance: CAM_PRESETS[preset] };
}

export function pickPreset(c: GameCam, preset: CamPreset): GameCam {
  return { ...c, view: "third", preset, distance: CAM_PRESETS[preset] };
}

/** The mouse wheel (deltaY > 0 = away). Ignored in first person. */
export function zoomBy(c: GameCam, deltaY: number): GameCam {
  if (c.view === "first" || !Number.isFinite(deltaY)) return c;
  return { ...c, distance: clampDist(c.distance * Math.exp(Math.max(-500, Math.min(500, deltaY)) * 0.001)) };
}

/** A pinch: `ratio` = the fingers' new spread / the old (> 1 = spreading = closer). Ignored in first person. */
export function pinchBy(c: GameCam, ratio: number): GameCam {
  if (c.view === "first" || !(ratio > 0) || !Number.isFinite(ratio)) return c;
  return { ...c, distance: clampDist(c.distance / ratio) };
}

export function toggleView(c: GameCam): GameCam {
  return { ...c, view: c.view === "first" ? "third" : "first" };
}

/** A stored value back to a camera (anything malformed → the default). */
export function parseCam(raw: string | null | undefined): GameCam {
  if (!raw) return DEFAULT_CAM;
  try {
    const o = JSON.parse(raw) as Partial<GameCam> | null;
    if (!o || typeof o !== "object") return DEFAULT_CAM;
    const preset = CAM_PRESET_ORDER.includes(o.preset as CamPreset) ? (o.preset as CamPreset) : DEFAULT_CAM.preset;
    const view: CamView = o.view === "first" ? "first" : "third";
    const distance = typeof o.distance === "number" && Number.isFinite(o.distance) ? clampDist(o.distance) : CAM_PRESETS[preset];
    return { view, preset, distance };
  } catch {
    return DEFAULT_CAM;
  }
}

type Store = Pick<Storage, "getItem" | "setItem">;
const browserStore = (): Store | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

export function loadCam(store: Store | null = browserStore()): GameCam {
  try {
    return parseCam(store?.getItem(CAM_STORAGE_KEY));
  } catch {
    return DEFAULT_CAM;
  }
}

export function saveCam(c: GameCam, store: Store | null = browserStore()): void {
  try {
    store?.setItem(CAM_STORAGE_KEY, JSON.stringify(c));
  } catch {
    // storage full or blocked: the choice lasts this session only
  }
}

// ---------- the shared state: the HUD control and the world view both read and write it ----------
let current: GameCam | null = null;
const listeners = new Set<(c: GameCam) => void>();

export function getCam(): GameCam {
  current ??= loadCam();
  return current;
}

export function setCam(c: GameCam): void {
  const prev = getCam();
  if (prev.view === c.view && prev.preset === c.preset && prev.distance === c.distance) return;
  current = c;
  saveCam(c);
  for (const fn of listeners) fn(c);
}

export function subscribeCam(fn: (c: GameCam) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Tests: forget the in-memory state (the next getCam reads the storage again). */
export function resetCamForTests(): void {
  current = null;
  listeners.clear();
}
