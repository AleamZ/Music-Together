import type { MapId } from "@/lib/game/maps/types";

// The per-browser graphics setting "Đồ hoạ: 2D | 3D (thử)". 2D by default; 3D only swaps the renderer of the maps that
// have a diorama (the pond, the hall, Chợ Lớn, Khu nhà, the field, Bãi đất, Mỏ đá, Sông Cái and the Hầm đấu ngầm). A view preference only: nothing is sent anywhere.

export type GfxMode = "2d" | "3d";

export const GFX_KEY = "mt.gfx";
const EVENT = "mt:gfx";

/** The maps that have a diorama renderer. */
export const DIORAMA_MAPS: ReadonlySet<MapId> = new Set<MapId>(["pond", "hall", "market", "khu_nha", "field", "bai_dat", "mo_da", "song_cai", "ham_ngam"]);

/** A stored value → the mode (anything unknown is 2D). */
export function parseGfx(raw: string | null | undefined): GfxMode {
  return raw === "3d" ? "3d" : "2d";
}

/** Does `map` render as a diorama under `mode`? */
export function usesDiorama(mode: GfxMode, map: MapId): boolean {
  return mode === "3d" && DIORAMA_MAPS.has(map);
}

export function readGfx(): GfxMode {
  try {
    return parseGfx(window.localStorage.getItem(GFX_KEY));
  } catch {
    return "2d";
  }
}

export function writeGfx(mode: GfxMode): void {
  try {
    window.localStorage.setItem(GFX_KEY, mode);
  } catch {
    // private window / blocked storage: the change lasts for this page only
  }
  window.dispatchEvent(new Event(EVENT));
}

/** For useSyncExternalStore: this tab's changes (the event) and other tabs' (storage). */
export function subscribeGfx(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === GFX_KEY) cb(); };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

// ---- the 3D quality the player picks (Tự động / Cao / Thấp): a view preference, kept per browser

export type GfxQuality = "auto" | "high" | "low";
export const QUALITY_KEY = "mt.gfxq";
const Q_EVENT = "mt:gfxq";

export function parseQuality(raw: string | null | undefined): GfxQuality {
  return raw === "high" || raw === "low" ? raw : "auto";
}

export function readQuality(): GfxQuality {
  try {
    return parseQuality(window.localStorage.getItem(QUALITY_KEY));
  } catch {
    return "auto";
  }
}

export function writeQuality(q: GfxQuality): void {
  try {
    window.localStorage.setItem(QUALITY_KEY, q);
  } catch {
    // blocked storage: this page only
  }
  window.dispatchEvent(new Event(Q_EVENT));
}

export function subscribeQuality(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => { if (e.key === QUALITY_KEY) cb(); };
  window.addEventListener(Q_EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(Q_EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}
