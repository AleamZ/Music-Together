// v21 "world" (0075): my party members' server positions, for the minimap (written by the world HUD's poll, read by
// MiniMap every frame). A module-level snapshot: no React state, no re-render.
import type { MapId } from "../maps/types";

export interface PartyDot { name: string; map: MapId; x: number; y: number }

let dots: readonly PartyDot[] = [];
export const setPartyDots = (d: readonly PartyDot[]): void => { dots = d; };
export const partyDotsOn = (map: MapId): readonly PartyDot[] => dots.filter((d) => d.map === map);
